/**
 * SQLite driver on Node's built-in `node:sqlite` (DatabaseSync). No native
 * dependency and no build step: the DSH host runs a Node version that ships it.
 *
 * The module is imported lazily so a host without `node:sqlite` reports a
 * clear, actionable message instead of failing the whole plugin boot.
 *
 * `node:sqlite` is synchronous. Every call is wrapped in a resolved promise so
 * the driver satisfies the async contract without changing the execution
 * model; a single SQLite statement is fast enough that blocking the host event
 * loop for its duration is acceptable, and it keeps transactions correct.
 */

import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { expandHome } from '../dsh-home.ts'
import type { ColumnInfo, DataSourceEntry, IndexInfo, QueryResult, SchemaInfo, TableInfo, TablePage, TestResult } from '../protocol.ts'
import { assertSingleStatement, buildSearchWhere, groupSameColumns, isTransactionControl, likeEscapeClause, looksReadOnly, pushDownLimit, qualifySqlite, quoteSqlite, requireIdentifier, toWireValue } from '../sql-util.ts'
import {
  type ColumnDefinition,
  type TableShape,
  identifier,
  matchingBracket,
  normalizeDefault,
  normalizeType,
  parseCreateTable,
  renderColumn,
  renderCreateTable,
  setPrimaryKey,
  splitTopLevel,
} from '../sql-schema.ts'
import type {
  ColumnSpec,
  DatabaseOp,
  DatabaseOperationOptions,
  MaintenanceOp,
  MaintenanceResult,
  RowKey,
  RowQuery,
  RowValue,
  SqlDriver,
  TableActionOp,
  TableIndexSpec,
  TableListOptions,
  TableOptionInfo,
  TableOptionPatch,
  TableOptions,
  TableTarget,
} from './types.ts'

/** Suffix of the temporary table a rebuild builds alongside the original. */
const REBUILD_SUFFIX = '__dbm_rebuild'

/** Minimal structural view of the `node:sqlite` surface this driver uses. */
interface SqliteStatement {
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  columns(): Array<{ column: string | null; name: string; type: string | null; table: string | null }>
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: Record<string, unknown>) => SqliteDatabase
}

/** Whether the `node:sqlite` builtin is importable in this process. */
export async function sqliteAvailable(): Promise<boolean> {
  try {
    await loadSqlite()
    return true
  } catch {
    return false
  }
}

/** Import `node:sqlite`, translating a missing builtin into a clear error. */
async function loadSqlite(): Promise<SqliteModule> {
  try {
    // A dynamic specifier keeps bundlers from trying to resolve the builtin.
    const specifier = 'node:sqlite'
    const mod = (await import(/* @vite-ignore */ specifier)) as unknown as SqliteModule
    if (typeof mod.DatabaseSync !== 'function') {
      throw new Error('node:sqlite does not expose DatabaseSync')
    }
    return mod
  } catch (error) {
    throw new Error(
      'SQLite support requires the Node.js built-in "node:sqlite" (Node >= 22.5). ' +
      `This host cannot load it: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Resolve a user-supplied file path: expand ~, then resolve against cwd. */
export function resolveSqliteFile(file: string): string {
  if (file === ':memory:') return file
  const expanded = expandHome(file)
  return isAbsolute(expanded) ? expanded : resolve(expanded)
}

/** SQLite driver bound to one stored entry. */
export class SqliteDriver implements SqlDriver {
  readonly kind = 'sqlite' as const
  private readonly entry: DataSourceEntry
  private db: SqliteDatabase | undefined
  /** Serializes statements so an interleaved transaction cannot corrupt. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(entry: DataSourceEntry) {
    this.entry = entry
  }

  /** Open (once) and return the connection. */
  private async open(): Promise<SqliteDatabase> {
    if (this.db !== undefined) return this.db
    const file = this.entry.file
    if (file === undefined || file.trim() === '') throw new Error('sqlite data source has no file configured')
    const path = resolveSqliteFile(file)
    if (path !== ':memory:') {
      const dir = dirname(path)
      if (!existsSync(dir)) {
        // Creating a missing parent directory would silently turn a typo into
        // a new empty database; refuse and let the user confirm the location.
        throw new Error(`the directory "${dir}" does not exist`)
      }
    }
    const { DatabaseSync } = await loadSqlite()
    const db = new DatabaseSync(path, { timeout: this.entry.connectTimeoutMs ?? 5000 })
    // WAL keeps readers from blocking the GUI while an agent writes. Ignore a
    // failure: a read-only file or a non-WAL-capable filesystem still works.
    try {
      db.exec('PRAGMA journal_mode = WAL')
    } catch {
      /* best effort */
    }
    db.exec('PRAGMA foreign_keys = ON')
    this.db = db
    return db
  }

  /** Run one unit of work on the serialization queue. */
  private run<T>(work: (db: SqliteDatabase) => T): Promise<T> {
    const next = this.queue.then(async () => {
      const db = await this.open()
      return work(db)
    })
    // Keep the chain alive after a failure so one bad statement cannot wedge
    // every later call.
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }

  async test(): Promise<TestResult> {
    const started = Date.now()
    // A SQLite "connection" is a file handle, and opening a missing file CREATES
    // it. Saying so before the first connect is the difference between "my data
    // is there" and "I just silently created an empty database next to it".
    const file = this.entry.file ?? ''
    const existedBefore = file === ':memory:' || file === '' ? true : sqliteFileStatus(file).exists
    try {
      const version = await this.run(db => {
        const row = db.prepare('SELECT sqlite_version() AS v').get() as { v?: unknown } | undefined
        return row?.v === undefined ? undefined : String(row.v)
      })
      return {
        ok: true,
        latencyMs: Date.now() - started,
        ...(version === undefined ? {} : { serverVersion: `SQLite ${version}` }),
        ...(existedBefore ? {} : { note: 'the file did not exist and has been created' }),
      }
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async close(): Promise<void> {
    const db = this.db
    this.db = undefined
    if (db === undefined) return
    try {
      db.close()
    } catch {
      /* already closed */
    }
  }

  /**
   * Which maintenance operations SQLite supports.
   *
   * Measured:
   *   - `check`    → `PRAGMA integrity_check` (the whole file, not one table);
   *   - `optimize` → `VACUUM`, which compacts the file;
   *   - `analyze`  → `ANALYZE`, which fills `sqlite_stat1` — this is what makes row
   *                  counts appear in the table list, so it is worth offering;
   *   - `repair`   → NOTHING. SQLite has no `REPAIR` statement. It is absent from
   *                  this list rather than offered as a button that can only fail.
   */
  maintenanceSupport(): MaintenanceOp[] {
    return ['check', 'optimize', 'analyze']
  }

  /**
   * None of the three, and each for its own reason — all measured.
   *
   * SQLite's "database" is a file, so the two cross-database operations have nothing
   * to act on:
   *
   * - **`move`** — `ALTER TABLE … RENAME TO other.t` is a syntax error, and there is
   *   no other statement that relocates a table between attached schemas. So a table
   *   cannot be moved out of the file it lives in, and the only same-file "move" is a
   *   rename, which the outline below explains was deliberately NOT folded in here.
   * - **`copy`** — a copy inside the same file would have to reproduce the table with
   *   a new name, and SQLite has no statement for that either: `CREATE TABLE … AS
   *   SELECT` DROPS every constraint (measured: the copy came back with `id INT` and
   *   no primary key, no UNIQUE, no COLLATE, no generated column). A faithful copy
   *   would mean rebuilding from the parsed `CREATE` text and recreating every index
   *   and trigger under a new name — a second implementation of the rebuild path, for
   *   a copy the export dialog already provides.
   * - **`options`** — there is nothing to change. SQLite's table-level PRAGMAs
   *   (`auto_vacuum`, `page_size`) are FILE-level and must be set before the tables
   *   exist, and the only CREATE TABLE tail keywords (`WITHOUT ROWID`, `STRICT`) are
   *   part of the table's identity, not an option that can be altered afterwards.
   *
   * The 结构 tab still offers everything SQLite CAN do — add, alter, drop and rename
   * columns, change the primary key, manage indexes — so nothing here is a gap in
   * capability, only a gap in naming.
   */
  tableActionSupport(): TableActionOp[] {
    return []
  }

  /**
   * Run maintenance on the database.
   *
   * Two honest limitations, both stated rather than hidden:
   *
   * 1. **Some operations are per-DATABASE, not per-table.** `integrity_check` and
   *    `VACUUM` act on the whole file; only `ANALYZE` takes a table name. So a
   *    requested set of tables returns one result each but the message says the scope
   *    was the whole database — claiming a per-table repair would be a fiction.
   * 2. **`VACUUM` cannot run inside a transaction** (measured: "cannot VACUUM from
   *    within a transaction"), and the pool hands the same connection back, so it is
   *    issued on its own rather than through `runScript`.
   */
  async maintain(schema: string | undefined, tables: string[], op: MaintenanceOp): Promise<MaintenanceResult[]> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    requireIdentifier(target, 'schema name', quoteSqlite)
    if (tables.length === 0) throw new Error('maintenance needs at least one table')
    for (const table of tables) requireIdentifier(table, 'table name', quoteSqlite)

    if (op === 'check') {
      // The thorough form; `quick_check` is faster but skips some checks. This is a
      // deliberate action on a database the user chose, so thoroughness wins.
      const rows = await this.run(db => {
        const raw = db.prepare(`PRAGMA ${quoteSqlite(target)}.integrity_check`).all() as Array<Record<string, unknown>>
        return raw.map(row => String(Object.values(row)[0] ?? ''))
      })
      const ok = rows.length === 1 && rows[0]!.toLowerCase() === 'ok'
      const messages = ok
        ? [`${target}: ok（整库检查，非单表）`]
        : rows.map(line => `${target}: ${line}`)
      return tables.map(() => ({ op, ok, messages }))
    }

    if (op === 'optimize') {
      // Outside a transaction — SQLite refuses `VACUUM` inside one.
      await this.run(db => { db.exec(`VACUUM ${quoteSqlite(target)}`) })
      return tables.map(() => ({ op, ok: true, messages: [`${target}: 已重整文件（VACUUM，作用于整库）`] }))
    }

    if (op === 'analyze') {
      // Per table IS supported here, so each requested table is analysed on its own.
      const results: MaintenanceResult[] = []
      for (const table of tables) {
        await this.run(db => { db.exec(`ANALYZE ${quoteSqlite(target)}.${quoteSqlite(table)}`) })
        results.push({ op, ok: true, messages: [`${table}: 已更新统计信息（ANALYZE）`] })
      }
      return results
    }

    throw new Error(
      `SQLite 不支持 ${op}：它没有 REPAIR 语句。表损坏时的做法是从备份恢复、或把数据导出后重建；可先用「检查」确认损坏范围。`,
    )
  }

  /**
   * Run one database-level operation.
   *
   * A SQLite "database" is a FILE, so the MySQL forms (CREATE / ALTER / DROP
   * DATABASE) have no equivalent and are not pretended:
   *
   *   - `create` — creates the file by opening it, which is what `DatabaseSync` does;
   *     a file with no tables is a valid empty database.
   *   - `drop`   — deletes the file together with its `-wal` and `-shm` siblings.
   *     Leaving those behind would make a "deleted" database reappear.
   *   - `rename` — renames the file, after closing the handle: renaming a file another
   *     handle has open is not portable, and the pool would hand back a connection to
   *     the old path.
   *   - `copy`   — `VACUUM INTO`, which produces a consistent COMPACTED copy rather
   *     than a byte clone that may have unmerged WAL pages.
   *   - `charset` — refused with the reason: SQLite is UTF-8 (or UTF-16 if compiled
   *     that way) for the file's whole lifetime, fixed at creation.
   */
  async databaseOperation(op: DatabaseOp, name: string, options: DatabaseOperationOptions = {}): Promise<QueryResult> {
    const started = Date.now()
    void options
    const file = this.entry.file
    if (file === undefined || file.trim() === '') throw new Error('this SQLite data source has no file configured')
    if (file === ':memory:') throw new Error('an in-memory SQLite database has no file to operate on')

    if (op === 'charset') {
      throw new Error(
        'SQLite 没有可修改的库编码：整个库固定为 UTF-8（或编译期选定的 UTF-16），PRAGMA encoding 在库创建时确定后不可更改。',
      )
    }

    if (op === 'create') {
      // Opening the path creates it. The panel adds a data source pointed at the new
      // file, so this is the useful form: make the file exist and be a valid database.
      await this.open()
      return { columns: [], rows: [], affected: 1, durationMs: Date.now() - started, write: true, truncated: false }
    }

    const sourcePath = resolveSqliteFile(file)

    if (op === 'copy') {
      const targetPath = resolveSqliteFile(name)
      if (existsSync(targetPath)) throw new Error(`目标文件已存在：${targetPath}`)
      this.closeHandle()
      await this.run(db => { db.exec(`VACUUM INTO ${sqliteStringLiteral(targetPath)}`) })
      return { columns: [], rows: [], affected: 1, durationMs: Date.now() - started, write: true, truncated: false }
    }

    if (op === 'rename') {
      const targetPath = resolveSqliteFile(name)
      if (existsSync(targetPath)) throw new Error(`目标文件已存在：${targetPath}`)
      this.closeHandle()
      renameWithSiblings(sourcePath, targetPath)
      return { columns: [], rows: [], affected: 1, durationMs: Date.now() - started, write: true, truncated: false }
    }

    if (op === 'drop') {
      this.closeHandle()
      dropWithSiblings(sourcePath)
      return { columns: [], rows: [], affected: 1, durationMs: Date.now() - started, write: true, truncated: false }
    }

    throw new Error(`unsupported database operation: ${op}`)
  }

  /** Close and forget the open handle, so a file operation can proceed. */
  private closeHandle(): void {
    const db = this.db
    this.db = undefined
    if (db === undefined) return
    try {
      db.close()
    } catch {
      /* already closed */
    }
  }

  async schemas(): Promise<SchemaInfo[]> {
    return this.run(db => {
      const rows = db.prepare('PRAGMA database_list').all() as Array<{ name?: unknown; file?: unknown }>
      return rows
        .filter(row => typeof row.name === 'string')
        .map(row => {
          const name = String(row.name)
          const file = typeof row.file === 'string' && row.file !== '' ? row.file : undefined
          return { name, ...(file === undefined ? {} : { detail: file }) } satisfies SchemaInfo
        })
    })
  }

  async tables(schema?: string, options?: TableListOptions): Promise<TableInfo[]> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    requireIdentifier(target, 'schema name', quoteSqlite)
    const wantStats = options?.stats === true
    return this.run(db => {
      const statement = db.prepare(
        `SELECT name, type FROM ${quoteSqlite(target)}.sqlite_master ` +
          `WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name`,
      )
      const rows = statement.all() as Array<{ name?: unknown; type?: unknown }>
      // Both statistics are opt-in: the tree expands a database on every click
      // and must stay cheap even when the file is large.
      const sizes = wantStats ? readTableSizes(db, target) : undefined
      const counts = wantStats ? readTableRowCounts(db, target) : undefined
      return rows
        .filter(row => typeof row.name === 'string')
        .map(row => {
          const name = String(row.name)
          const size = sizes?.get(name)
          const count = counts?.get(name)
          return {
            name,
            type: row.type === 'view' ? 'view' : 'table',
            ...(size === undefined ? {} : { size }),
            ...(count === undefined ? {} : { rows: count }),
          } satisfies TableInfo
        })
    })
  }

  async columns(schema: string | undefined, table: string): Promise<ColumnInfo[]> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    const qualified = qualifySqlite(target === 'main' ? undefined : target, table)
    return this.run(db => {
      /*
       * `table_xinfo`, not `table_info`.
       *
       * `PRAGMA table_info` OMITS a generated column entirely — measured on a
       * table whose middle column is `GENERATED ALWAYS AS (…) STORED`, it
       * returned only the other two. Editing a table's structure from that list
       * would build a replacement table missing the generated column and delete
       * it on drop, and the 浏览 grid would silently lose a column as well.
       *
       * `table_xinfo` adds a `hidden` flag: 0 for an ordinary column, 2 for a
       * VIRTUAL generated column, 3 for a STORED one. Hidden=1 marks a virtual
       * table's hidden column, which is not part of this plugin's editable
       * surface and is left out.
       */
      const rows = db.prepare(`PRAGMA ${quoteSqlite(target)}.table_xinfo(${quoteSqlite(table)})`).all() as Array<Record<string, unknown>>
      return rows
        .filter(row => Number(row['hidden'] ?? 0) !== 1)
        .map(row => {
          const name = String(row['name'] ?? '')
          const pk = Number(row['pk'] ?? 0)
          const hidden = Number(row['hidden'] ?? 0)
          return {
            name,
            type: String(row['type'] ?? ''),
            nullable: Number(row['notnull'] ?? 0) === 0,
            ...(row['dflt_value'] === null || row['dflt_value'] === undefined ? {} : { defaultValue: String(row['dflt_value']) }),
            key: pk > 0 ? 'PRI' : '',
            extra: '',
            ...(pk > 0 ? { primaryKeyPosition: pk } : {}),
            ...(hidden === 2 || hidden === 3 ? { generated: true } : {}),
          } satisfies ColumnInfo
        })
    }).then(async columns => {
      // `pk` marks composite primary keys too; a single-column PK additionally
      // reports its rowid alias. Nothing else to add — but verify the table
      // exists so a typo surfaces instead of returning an empty column list.
      if (columns.length === 0) {
        const exists = (await this.tables(target)).some(t => t.name === table)
        if (!exists) throw new Error(`no such table: ${qualified}`)
      }
      return columns
    })
  }

  async indexes(schema: string | undefined, table: string): Promise<IndexInfo[]> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    requireIdentifier(target, 'schema name', quoteSqlite)
    requireIdentifier(table, 'table name', quoteSqlite)
    return this.run(db => {
      const list = db.prepare(`PRAGMA ${quoteSqlite(target)}.index_list(${quoteSqlite(table)})`).all() as Array<Record<string, unknown>>
      return list.map(entry => {
        const name = String(entry['name'] ?? '')
        let columns: string[] = []
        try {
          const info = db.prepare(`PRAGMA ${quoteSqlite(target)}.index_info(${quoteSqlite(name)})`).all() as Array<Record<string, unknown>>
          columns = info
            .sort((a, b) => Number(a['seqno'] ?? 0) - Number(b['seqno'] ?? 0))
            .map(row => String(row['name'] ?? ''))
            .filter(name => name !== '')
        } catch {
          /* expression indexes report no columns here */
        }
        const origin = String(entry['origin'] ?? '')
        return {
          name,
          unique: Number(entry['unique'] ?? 0) === 1,
          columns,
          type: origin,
          // `origin = 'pk'` is the primary key's own index. It cannot be dropped
          // on its own — dropping it means dropping the key — so the flag has to
          // reach the browser.
          ...(origin === 'pk' ? { primary: true } : {}),
        } satisfies IndexInfo
      })
    })
  }

  async rows(query: RowQuery): Promise<TablePage> {
    const schema = query.schema === undefined || query.schema === '' ? 'main' : query.schema
    const columns = await this.columns(schema, query.table)
    if (columns.length === 0) throw new Error(`no such table: ${query.table}`)
    const known = new Set(columns.map(column => column.name.toLowerCase()))
    const qualified = qualifySqlite(schema === 'main' ? undefined : schema, query.table)

    const { where, params } = this.buildFilter(query, columns.map(column => column.name), known)
    const order = this.buildOrder(query, columns)
    const offset = Math.max(0, (query.page - 1) * query.pageSize)

    const total = await this.run(db => {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${qualified}${where}`).get(...params) as { n?: unknown } | undefined
      return Number(row?.n ?? 0)
    })

    const rows = await this.run(db => {
      const statement = db.prepare(`SELECT * FROM ${qualified}${where}${order} LIMIT ? OFFSET ?`)
      return statement.all(...params, query.pageSize, offset) as Array<Record<string, unknown>>
    })

    const primaryKey = columns.filter(column => column.key === 'PRI').map(column => column.name)
    return {
      columns,
      rows: rows.map(row => projectRow(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      primaryKey,
    }
  }

  /**
   * The ORDER BY clause for one read.
   *
   * Three shapes, in precedence order: an explicit column list (the 按索引排序
   * control), a single column (a header click), or nothing. Every column is
   * checked against the table's own list, so a stale browser cannot order by a
   * column that has since been renamed away.
   */
  private buildOrder(query: RowQuery, columns: ColumnInfo[]): string {
    const byName = new Map(columns.map(column => [column.name.toLowerCase(), column.name]))
    const direction = query.orderDir === 'desc' ? 'DESC' : 'ASC'

    if (query.orderByColumns !== undefined && query.orderByColumns.length > 0) {
      const resolved = query.orderByColumns.map(name => byName.get(name.toLowerCase()))
      if (resolved.some(name => name === undefined)) return ''
      return ` ORDER BY ${resolved.map(name => `${quoteSqlite(name!)} ${direction}`).join(', ')}`
    }
    if (query.orderBy === undefined) return ''
    const resolved = byName.get(query.orderBy.toLowerCase())
    if (resolved === undefined) return ''
    return ` ORDER BY ${quoteSqlite(resolved)} ${direction}`
  }

  /** Build the WHERE clause and its bound parameters for a table read. */
  private buildFilter(query: RowQuery, allColumns: string[], known: Set<string>): { where: string; params: unknown[] } {
    // The structured form (the 搜索 tab) wins when it is present: it is what the
    // user arranged on screen, and mixing it with a free-text term would apply
    // two different filters to one read.
    if (query.filters !== undefined && query.filters.length > 0) {
      return buildSearchWhere(query.filters, query.filterJoin === 'or' ? 'or' : 'and', quoteSqlite, known, 'sqlite')
    }
    if (query.mode === 'search') {
      const term = query.term ?? ''
      if (term === '') return { where: '', params: [] }
      // Match against every column: SQLite has no per-column type guarantee,
      // so casting through TEXT is the only filter that cannot error. The term
      // is bound, never interpolated; its `%`/`_` are escaped so a literal
      // percent sign is a character to find rather than a wildcard.
      const pattern = `%${term.replace(/[\\%_]/g, match => `\\${match}`)}%`
      const clauses = allColumns.map(column => `CAST(${quoteSqlite(column)} AS TEXT) LIKE ? ${likeEscapeClause('sqlite')}`)
      return { where: ` WHERE (${clauses.join(' OR ')})`, params: allColumns.map(() => pattern) }
    }
    if (query.condition !== undefined && query.condition.trim() !== '') {
      // Privileged path: a raw SQL condition typed by the user in the GUI. It
      // is not model-reachable, and it is still pinned to a single condition
      // (no statement separator) so it cannot escape the SELECT.
      assertSingleStatement(`SELECT 1 WHERE ${query.condition}`)
      return { where: ` WHERE (${query.condition})`, params: [] }
    }
    return { where: '', params: [] }
  }

  async query(sql: string, params: unknown[], limit: number, schema?: string): Promise<QueryResult> {
    assertSingleStatement(sql)
    if (!looksReadOnly(sql)) {
      throw new Error('only read-only statements (SELECT / WITH / PRAGMA / EXPLAIN) are allowed on this surface')
    }
    // Ask the engine to stop at the cap instead of materialising the whole
    // result set and slicing it here. Left uncapped, a `SELECT *` over a large
    // table pulls every row into the host's memory and then discards all but
    // the first page. The statement is run verbatim when the rewrite is not
    // safe — see `pushDownLimit` for the cases that disqualify it.
    //
    // One row PAST the cap is requested on purpose: `exec` decides `truncated`
    // by comparing the row count against the cap, so a statement capped at
    // exactly `limit` rows would report "complete" while rows were being
    // withheld. The extra row is what proves there was more.
    const pushed = limit >= 1 ? pushDownLimit(sql, limit + 1) : undefined
    return this.exec(pushed ?? sql, params, schema, limit)
  }

  async exec(sql: string, params: unknown[], schema?: string, limit?: number): Promise<QueryResult> {
    assertSingleStatement(sql)
    const target = schema === undefined || schema === '' ? 'main' : schema
    requireIdentifier(target, 'schema name', quoteSqlite)
    const started = Date.now()
    return this.run(db => {
      if (target !== 'main') db.exec(`PRAGMA ${quoteSqlite(target)}.query_only = OFF`)
      const capped = limit ?? 0
      const statement = db.prepare(sql)
      let columns: string[] = []
      try {
        columns = statement
          .columns()
          .map(column => column.name)
          .filter((name): name is string => typeof name === 'string' && name !== '')
      } catch {
        columns = []
      }
      // A statement with a projection is a read; one without is a write.
      const isRead = columns.length > 0 || looksReadOnly(sql)
      if (isRead) {
        const raw = params.length === 0 ? statement.all() : statement.all(...params)
        const truncated = capped > 0 && raw.length > capped
        const sliced = truncated ? raw.slice(0, capped) : raw
        const rows = sliced as Array<Record<string, unknown>>
        const projected = columns.length > 0 ? columns : rows.length > 0 ? Object.keys(rows[0]!) : []
        return {
          columns: projected,
          rows: rows.map(row => projected.map(column => toWireValue(row[column]))),
          affected: rows.length,
          durationMs: Date.now() - started,
          write: false,
          truncated,
        } satisfies QueryResult
      }
      const result = params.length === 0 ? statement.run() : statement.run(...params)
      return {
        columns: [],
        rows: [],
        affected: Number(result.changes ?? 0),
        durationMs: Date.now() - started,
        write: true,
        truncated: false,
      } satisfies QueryResult
    })
  }

  async insertRow(schema: string | undefined, table: string, values: RowValue[]): Promise<QueryResult> {
    if (values.length === 0) throw new Error('insert requires at least one column value')
    const qualified = qualifySqlite(schema, table)
    const names = values.map(item => requireIdentifier(item.column, 'column name', quoteSqlite)).join(', ')
    const placeholders = values.map(() => '?').join(', ')
    const sql = `INSERT INTO ${qualified} (${names}) VALUES (${placeholders})`
    const result = await this.exec(sql, values.map(item => item.value), schema)
    return result
  }

  /**
   * Insert several rows in one transaction.
   *
   * One transaction, not one autocommit per row: a 10 000-row CSV import would
   * otherwise fsync 10 000 times, and a failure halfway would leave the table
   * holding an unknown prefix of the file with no way to tell how much landed.
   * Either every row is in or none is.
   *
   * Rows are NOT required to name the same columns. They used to be, and the
   * 插入 tab's phpMyAdmin-shaped forms are what made that wrong: each form is
   * filled in on its own, so leaving a column blank in one row and supplying it in
   * another is the ordinary case rather than a mistake. Measured: two such forms
   * made the batch answer 500 "every row in one insert must name the same
   * columns", which is a refusal of the feature as designed. Each row is therefore
   * its own statement — the same shape `deleteRows` already uses — and rows that
   * DO agree still share one multi-row statement, which is the CSV import's cheap
   * path.
   */
  async insertRows(schema: string | undefined, table: string, rows: RowValue[][]): Promise<QueryResult> {
    if (rows.length === 0) throw new Error('insert requires at least one row')
    const qualified = qualifySqlite(schema, table)
    const started = Date.now()
    return this.run(db => {
      let affected = 0
      db.exec('BEGIN')
      try {
        /**
         * Consecutive rows naming the same columns, grouped.
         *
         * Grouping CONSECUTIVE rows rather than all rows with equal column lists
         * keeps the statements in the order they were given, so an AUTO_INCREMENT
         * column assigns ids in the order the forms were filled in.
         */
        for (const group of groupSameColumns(rows)) {
          const names = group[0]!.map(item => requireIdentifier(item.column, 'column name', quoteSqlite)).join(', ')
          const placeholders = group[0]!.map(() => '?').join(', ')
          if (group.length === 1) {
            const statement = db.prepare(`INSERT INTO ${qualified} (${names}) VALUES (${placeholders})`)
            affected += Number(statement.run(...group[0]!.map(item => item.value)).changes ?? 0)
            continue
          }
          const sql = `INSERT INTO ${qualified} (${names}) VALUES ${group.map(() => `(${placeholders})`).join(', ')}`
          const statement = db.prepare(sql)
          affected += Number(statement.run(...group.flatMap(row => row.map(item => item.value))).changes ?? 0)
        }
        db.exec('COMMIT')
      } catch (error) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* the transaction is already gone */
        }
        throw error
      }
      return {
        columns: [],
        rows: [],
        affected,
        durationMs: Date.now() - started,
        write: true,
        truncated: false,
      } satisfies QueryResult
    })
  }

  async updateRow(schema: string | undefined, table: string, values: RowValue[], keys: RowKey[]): Promise<QueryResult> {
    if (values.length === 0) throw new Error('update requires at least one column value')
    if (keys.length === 0) throw new Error('update requires a row key')
    const qualified = qualifySqlite(schema, table)
    const assignments = values.map(item => `${requireIdentifier(item.column, 'column name', quoteSqlite)} = ?`).join(', ')
    const where = keys.map(item => `${requireIdentifier(item.column, 'column name', quoteSqlite)} IS ?`).join(' AND ')
    const sql = `UPDATE ${qualified} SET ${assignments} WHERE ${where}`
    const params = [...values.map(item => item.value), ...keys.map(item => item.value)]
    return this.exec(sql, params, schema)
  }

  async deleteRow(schema: string | undefined, table: string, keys: RowKey[]): Promise<QueryResult> {
    if (keys.length === 0) throw new Error('delete requires a row key')
    const qualified = qualifySqlite(schema, table)
    const where = keys.map(item => `${requireIdentifier(item.column, 'column name', quoteSqlite)} IS ?`).join(' AND ')
    const sql = `DELETE FROM ${qualified} WHERE ${where}`
    return this.exec(sql, keys.map(item => item.value), schema)
  }

  /**
   * Delete several rows in one transaction.
   *
   * One `DELETE … WHERE key` per key set rather than a single statement with an
   * `IN` list: a key may be composite, and a composite key cannot be expressed
   * as an `IN` over one column. `@`-style row values are not needed either,
   * since SQLite's rowid tables have a real rowid to fall back on but a
   * `WITHOUT ROWID` table does not — so the key columns are what identifies a
   * row, always.
   */
  async deleteRows(schema: string | undefined, table: string, keySets: RowKey[][]): Promise<QueryResult> {
    if (keySets.length === 0) throw new Error('delete requires at least one row key')
    const qualified = qualifySqlite(schema, table)
    const started = Date.now()
    return this.run(db => {
      let affected = 0
      db.exec('BEGIN')
      try {
        for (const keys of keySets) {
          if (keys.length === 0) throw new Error('delete requires a row key')
          const where = keys.map(item => `${requireIdentifier(item.column, 'column name', quoteSqlite)} IS ?`).join(' AND ')
          const statement = db.prepare(`DELETE FROM ${qualified} WHERE ${where}`)
          affected += Number(statement.run(...keys.map(item => item.value)).changes ?? 0)
        }
        db.exec('COMMIT')
      } catch (error) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* the transaction is already gone */
        }
        throw error
      }
      return {
        columns: [],
        rows: [],
        affected,
        durationMs: Date.now() - started,
        write: true,
        truncated: false,
      } satisfies QueryResult
    })
  }

  /** How many distinct non-NULL values a column holds. */
  async distinctCount(schema: string | undefined, table: string, column: string): Promise<number> {
    const qualified = qualifySqlite(schema, table)
    const quoted = requireIdentifier(column, 'column name', quoteSqlite)
    const result = await this.run(db => {
      const row = db.prepare(`SELECT COUNT(DISTINCT ${quoted}) AS n FROM ${qualified}`).get() as { n?: unknown } | undefined
      return Number(row?.n ?? 0)
    })
    return result
  }

  // ---- schema editing ----------------------------------------------------

  /**
   * Add a column.
   *
   * ADD COLUMN is one of the few schema changes SQLite does natively, so it is
   * used directly rather than through a rebuild — a rebuild of a large table
   * copies every row, and there is no reason to pay that for an appended
   * column.
   *
   * SQLite's own restrictions apply and are reported as they are: a new column
   * cannot be UNIQUE or PRIMARY KEY, and a NOT NULL column needs a non-NULL
   * default.
   */
  /**
   * Create a table from a column list.
   *
   * Built as a {@link TableShape} and rendered by `renderCreateTable` — the same
   * renderer a rebuild and a dump use — rather than by string assembly here. That
   * keeps one place responsible for how a table is spelled, which matters because
   * SQLite's own quirks (the `INTEGER PRIMARY KEY` rowid alias, `AUTOINCREMENT` being
   * legal only there) live in that renderer.
   *
   * A single-column key is emitted INLINE so it can carry `AUTOINCREMENT`, which
   * SQLite only accepts on an inline `INTEGER PRIMARY KEY`; a composite key has no
   * inline form and goes in as a table constraint. That is the renderer's decision,
   * reached by giving it the key positions.
   */
  async createTable(
    schema: string | undefined,
    table: string,
    columns: ColumnSpec[],
    options: { primaryKey?: string[]; indexes?: TableIndexSpec[]; table?: TableOptions } = {},
  ): Promise<QueryResult> {
    const qualified = qualifySqlite(schema, table)
    if (columns.length === 0) throw new Error('a new table needs at least one column')

    /*
     * Refuse what SQLite would SILENTLY IGNORE.
     *
     * Measured: `CREATE TABLE t(x INT UNSIGNED)` succeeds, and `pragma_table_info`
     * then reports the type as the literal string `INT UNSIGNED` — no unsigned
     * behaviour, just a type name that reads as if there were. The same is true of
     * `ZEROFILL` and of `INT(11)`/`VARCHAR(20)` lengths, which are stored and never
     * enforced. Accepting those would produce a table the user believes has
     * constraints it does not have, which is worse than refusing the field.
     *
     * `BINARY` and `COMMENT` are outright syntax errors on some types and silently
     * absorbed into the type name on others (`INT COMMENT 'x'` parses, `VARCHAR(20)
     * COMMENT 'x'` does not) — so they are refused uniformly rather than depending on
     * which type they happen to be attached to.
     *
     * NOT refused here: `collate`, which SQLite genuinely honours (measured:
     * `COLLATE NOCASE` really does match case-insensitively).
     */
    for (const spec of columns) {
      const attributes = spec.attributes ?? []
      if (attributes.length > 0) {
        throw new Error(`SQLite 不支持列属性 ${attributes.join(', ')}：它会把这些词并入类型名而不产生任何效果`)
      }
      if (spec.charset !== undefined && spec.charset !== '') {
        throw new Error('SQLite 没有列级字符集，只有列级排序规则（COLLATE）')
      }
      if (spec.length !== undefined && spec.length.trim() !== '') {
        throw new Error(`SQLite 不支持长度/值（列 ${spec.name}）：它会保留在类型名里但没有任何约束力。请把长度直接写进类型，如 VARCHAR(20)`)
      }
      if (spec.comment !== undefined && spec.comment !== '') {
        throw new Error('SQLite 不支持列注释：它没有存储注释的地方')
      }
    }

    const tableOptions = options.table ?? {}
    if (tableOptions.engine !== undefined && tableOptions.engine.trim() !== '') {
      throw new Error('SQLite 没有存储引擎可选')
    }
    if (tableOptions.comment !== undefined && tableOptions.comment !== '') {
      throw new Error('SQLite 没有表注释：它没有存储表注释的地方')
    }
    if (tableOptions.collate !== undefined && tableOptions.collate.trim() !== '') {
      throw new Error('SQLite 没有表级排序规则，排序规则只能逐列指定')
    }
    const tail = tableOptions.tail === undefined ? '' : tableOptions.tail.trim()
    if (tail !== '' && !/^(WITHOUT ROWID|STRICT|,\s*)+$/i.test(tail) && !/^(WITHOUT ROWID|STRICT)(\s*,\s*(WITHOUT ROWID|STRICT))*$/i.test(tail)) {
      // Only SQLite's own trailing keywords: anything else in this slot would be raw
      // SQL spliced onto the statement.
      throw new Error(`invalid table keyword: ${JSON.stringify(tableOptions.tail)}`)
    }

    const key = options.primaryKey ?? []
    const names = new Set(columns.map(spec => spec.name))
    for (const name of key) {
      if (!names.has(name)) throw new Error(`the primary key names a column that is not being created: ${name}`)
    }
    // A duplicate name would make SQLite reject the statement with a message about a
    // duplicate column, without saying which list is wrong. Cheap to check here.
    if (names.size !== columns.length) throw new Error('two of the new columns have the same name')

    /*
     * SQLite's AUTOINCREMENT rules, checked here because the renderer cannot express them.
     *
     * Measured: SQLite has exactly one rowid, so
     *   - at most ONE auto-increment column, and
     *   - it must BE the primary key, not merely a member of it — a composite key has no
     *     rowid alias, so `PRIMARY KEY(a, b)` with `a` auto is refused.
     *
     * Without this check the driver emitted the statement and the server answered with
     * "AUTOINCREMENT is only allowed on an INTEGER PRIMARY KEY" or "table has more than one
     * primary key", neither of which says which of the form's rows to change. The two-auto
     * case was not caught at all: the request resolved successfully and the table was
     * created with the flag silently dropped from the second column.
     */
    const autoColumns = columns.filter(spec => spec.autoIncrement === true)
    if (autoColumns.length > 1) {
      throw new Error(`only one column can AUTOINCREMENT on SQLite (it has a single rowid); ${autoColumns.length} were requested (${autoColumns.map(spec => spec.name).join(', ')})`)
    }
    const autoColumn = autoColumns[0]
    if (autoColumn !== undefined) {
      if (key.length !== 1 || key[0] !== autoColumn.name) {
        throw new Error(
          `SQLite 的自增要求「${autoColumn.name}」就是该表的唯一主键（rowid 别名）：` +
          '复合主键没有 rowid 别名，因此复合主键下的自增无法实现',
        )
      }
    }

    /*
     * Indexes beyond the primary key become separate `CREATE INDEX` statements.
     *
     * SQLite has no inline index clause, so they cannot be part of the CREATE TABLE.
     * That makes the create multi-statement, and the two engines differ here for a real
     * reason: MySQL emits them in the same statement (one DDL), SQLite has to emit
     * several. If a later index fails, the table is already created — so the failure
     * names the index and says the table exists, rather than pretending the whole thing
     * rolled back.
     */
    for (const index of options.indexes ?? []) {
      if (index.kind === 'primary') {
        if (key.length > 0) throw new Error('the primary key was given twice')
        continue
      }
      if (index.columns.length === 0) throw new Error(`the ${index.kind} index needs at least one column`)
      for (const name of index.columns) {
        if (!names.has(name)) throw new Error(`the ${index.kind} index names a column that is not being created: ${name}`)
      }
      // Measured: SQLite has neither index type without an extension.
      if (index.kind === 'fulltext') throw new Error('SQLite 没有 FULLTEXT 索引（需 FTS5 虚拟表，那是另一种对象，不是普通表上的索引）')
      if (index.kind === 'spatial') throw new Error('SQLite 没有 SPATIAL 索引（需 R*Tree 扩展模块）')
    }

    const definitions = columns.map(spec => {
      const definition = toDefinition(spec)
      const keyPosition = key.indexOf(spec.name)
      if (keyPosition === -1) return definition
      return { ...definition, primaryKeyPosition: keyPosition + 1 }
    })

    const constraints: TableShape['constraints'] = []
    if (key.length > 1) {
      constraints.push({
        sql: `PRIMARY KEY (${key.map(name => requireIdentifier(name, 'column name', quoteSqlite)).join(', ')})`,
        kind: 'primary' as const,
      })
    }

    const shape: TableShape = {
      name: table,
      ifNotExists: false,
      columns: definitions,
      // A composite key needs a table-level constraint; the renderer puts a
      // single-column key inline and ignores this one, so it is only added when it is
      // the form that will actually be used.
      constraints,
      tail,
    }

    await this.exec(renderCreateTable(shape, 'sqlite'), [], schema)

    /*
     * Now the secondary indexes.
     *
     * `UNIQUE` from a column flag is already inline on the column; the entries here are
     * the table-level ones, which SQLite expresses only as separate statements.
     */
    let created = 0
    for (const index of options.indexes ?? []) {
      if (index.kind === 'primary') continue
      const indexName = index.name === undefined || index.name.trim() === ''
        ? `${index.kind === 'unique' ? 'uq' : 'ix'}_${table}_${index.columns.join('_')}`
        : index.name.trim()
      const columnsSql = index.columns.map(name => requireIdentifier(name, 'column name', quoteSqlite)).join(', ')
      const unique = index.kind === 'unique' ? 'UNIQUE ' : ''
      try {
        await this.exec(
          `CREATE ${unique}INDEX ${requireIdentifier(indexName, 'index name', quoteSqlite)} ON ${qualifySqlite(schema, table)} (${columnsSql})`,
          [],
          schema,
        )
        created++
      } catch (failure) {
        // The table exists by now, so saying "failed" would leave the user unsure what
        // state the database is in. State exactly what happened.
        throw new Error(
          `表已创建，但创建索引「${indexName}」失败：${failure instanceof Error ? failure.message : String(failure)}`,
        )
      }
    }

    return { columns: [], rows: [], affected: 1 + created, durationMs: 0, write: true, truncated: false }
  }

  async addColumn(schema: string | undefined, table: string, spec: ColumnSpec): Promise<QueryResult> {
    const qualified = qualifySqlite(schema, table)
    const definition = renderColumn(toDefinition(spec), 'sqlite')
    // A PRIMARY KEY cannot be added by ALTER: the column would have to be the
    // table's only key, which ALTER cannot establish. Say so rather than
    // letting the engine reject it with a message about the table's shape.
    if (spec.primaryKeyPosition !== undefined) {
      throw new Error('SQLite cannot add a PRIMARY KEY column with ALTER TABLE; set the key on an existing column instead')
    }
    return this.exec(`ALTER TABLE ${qualified} ADD COLUMN ${definition}`, [], schema)
  }

  /**
   * Change an existing column.
   *
   * Changing a name alone is native (`ALTER TABLE … RENAME COLUMN`); changing
   * the declared type, the nullability, the default or the primary key is not,
   * and goes through {@link rebuildTable}. The two are not interchangeable:
   * RENAME COLUMN updates every reference to the column in the schema, whereas
   * a rebuild recreates the table and would need those references rebuilt too,
   * so the cheap native path is taken whenever it is sufficient.
   */
  async alterColumn(schema: string | undefined, table: string, spec: ColumnSpec, options: { rename?: string } = {}): Promise<QueryResult> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    const shape = await this.readShape(target, table)
    const index = shape.columns.findIndex(column => column.name === spec.name)
    if (index === -1) throw new Error(`no such column: ${spec.name}`)
    const current = shape.columns[index]!

    /*
     * The "rename only" fast path compares the two definitions it cares about.
     *
     * The DEFAULT comparison cannot go through {@link normalizeDefault} when either side
     * is an EXPRESSION: the validator refuses a parenthesised expression by design
     * because it cannot verify an arbitrary one. So those are compared textually,
     * allowing for the BRACKETS — the two sources disagree about them (measured:
     * {@link columns} reports `lower('ABC')`, the parsed `CREATE TABLE` text gives
     * `(lower('ABC'))`).
     */
    const next = toDefinition(spec)
    const expressionForm = (value: string | undefined): string =>
      (value ?? '').trim().replace(/^\(|\)$/g, '')
    const isExpression = (value: string | undefined): boolean => {
      const text = (value ?? '').trim()
      return text !== '' && !text.startsWith("'") && /[(]/.test(text)
    }
    const sameDefault = isExpression(next.defaultValue) || isExpression(current.defaultValue)
      ? expressionForm(next.defaultValue) === expressionForm(current.defaultValue)
      : normalizeDefault(next.defaultValue, 'sqlite') === normalizeDefault(current.defaultValue, 'sqlite')

    // Validate the new definition BEFORE deciding the path, so a refusal names
    // the field rather than surfacing after a partial write.
    renderColumn(next, 'sqlite')

    const newName = options.rename ?? spec.name
    const onlyRenamed =
      newName !== spec.name
      && normalizeType(next.type, 'sqlite') === normalizeType(current.type, 'sqlite')
      && next.nullable === current.nullable
      && next.unique === current.unique
      && current.primaryKeyPosition === undefined
      && sameDefault

    if (onlyRenamed) {
      const qualified = qualifySqlite(schema, table)
      return this.exec(
        `ALTER TABLE ${qualified} RENAME COLUMN ${identifier(spec.name, 'column name', 'sqlite')} TO ${identifier(newName, 'column name', 'sqlite')}`,
        [],
        schema,
      )
    }

    /*
     * The new definition comes from the SPEC, with only the clauses this plugin does not
     * MODEL carried over from the original.
     *
     * `{ ...current, ...next }` looks equivalent and is not: a field ABSENT from `next`
     * keeps the original's value, so a default could be changed but never REMOVED —
     * measured, clearing `DEFAULT CURRENT_TIMESTAMP` left the clause in place. Only
     * `extras` and `check` are genuinely unmodelled (a CHECK constraint, a generated
     * column's expression) and have to survive verbatim.
     *
     * `generated` is one more field that has to survive: the 结构 tab marks a generated
     * column and never sends the flag, and `rebuildTable` decides from it which columns
     * to copy — so losing it made the rebuild try to `INSERT` into the generated column,
     * which SQLite refuses with "cannot INSERT into generated column". The expression
     * itself lives in `extras`, which is already carried over.
     */
    const edited: ColumnDefinition = {
      ...next,
      name: newName,
      extras: current.extras,
      ...(current.check === undefined ? {} : { check: current.check }),
      ...(current.generated === true ? { generated: true } : {}),
    }
    shape.columns[index] = edited
    return this.rebuildTable(target, table, shape)
  }
  /** Drop a column, by rebuilding the table (SQLite has no native form here). */
  async dropColumn(schema: string | undefined, table: string, column: string): Promise<QueryResult> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    const shape = await this.readShape(target, table)
    const index = shape.columns.findIndex(candidate => candidate.name === column)
    if (index === -1) throw new Error(`no such column: ${column}`)
    // A column the table's own constraints still name cannot simply vanish: the
    // rebuilt CREATE would reference a column that does not exist, and SQLite
    // would reject the whole statement with a message about the constraint.
    const remaining = shape.columns.filter((_, position) => position !== index)
    if (remaining.length === 0) throw new Error('a table must keep at least one column')
    shape.columns = remaining
    assertConstraintsUsable(shape)
    return this.rebuildTable(target, table, shape)
  }

  /** Replace the table's primary key, by rebuilding it. */
  async setPrimaryKey(schema: string | undefined, table: string, columns: string[]): Promise<QueryResult> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    const shape = await this.readShape(target, table)
    setPrimaryKey(shape, columns, 'sqlite')
    return this.rebuildTable(target, table, shape)
  }

  /** Create an index on one or more existing columns. */
  async createIndex(schema: string | undefined, table: string, spec: { name: string; columns: string[]; unique: boolean }): Promise<QueryResult> {
    if (spec.columns.length === 0) throw new Error('an index needs at least one column')
    const target = schema === undefined || schema === '' ? 'main' : schema
    const columns = await this.columns(target, table)
    const known = new Map(columns.map(column => [column.name.toLowerCase(), column.name]))
    const resolved = spec.columns.map(name => {
      const found = known.get(name.toLowerCase())
      if (found === undefined) throw new Error(`no such column: ${name}`)
      return found
    })
    // The index name lives in the same namespace as the table's, so it is
    // validated with the identifier grammar rather than trusted.
    const name = requireIdentifier(spec.name, 'index name', quoteSqlite)
    const qualified = qualifySqlite(schema, table)
    const suffix = target === 'main' ? '' : ` ON ${quoteSqlite(target)}`
    void suffix
    return this.exec(
      `CREATE ${spec.unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${qualified} (${resolved.map(column => quoteSqlite(column)).join(', ')})`,
      [],
      schema,
    )
  }

  /**
   * Drop an index.
   *
   * Refuses SQLite's implicit `sqlite_autoindex_*`: it exists only because a
   * UNIQUE or PRIMARY KEY constraint asked for it, and `DROP INDEX` on it is
   * either an error or — worse — silently leaves the constraint without its
   * index. Dropping the constraint is the way to remove it, which the 结构 tab
   * offers separately.
   */
  async dropIndex(schema: string | undefined, table: string, name: string): Promise<QueryResult> {
    if (name.startsWith('sqlite_autoindex_')) {
      throw new Error('this index belongs to a PRIMARY KEY or UNIQUE constraint; drop the constraint instead of the index')
    }
    const target = schema === undefined || schema === '' ? 'main' : schema
    requireIdentifier(name, 'index name', quoteSqlite)
    return this.exec(`DROP INDEX ${quoteSqlite(target)}.${quoteSqlite(name)}`, [], schema)
  }

  /**
   * Rename a table inside its own schema.
   *
   * A SQLite database IS a file, so `move` here can only mean "the same file, a
   * different name" — measured: `ALTER TABLE t RENAME TO aux.t` is a syntax error
   * ("near \".\": syntax error"), and there is no statement that relocates a table
   * between attached schemas, so a genuine cross-database move is refused with that
   * reason rather than attempted.
   *
   * The rename itself is SQLite's native one, and its reference-rewriting is wanted
   * here: since 3.25 `ALTER TABLE … RENAME TO` also updates the references in views,
   * triggers and foreign keys, which is exactly what a rename should do. (The 结构
   * tab's rebuild path has to work AROUND that behaviour — see {@link rebuildTable} —
   * but a rename is the case it was designed for.)
   *
   * A VIEW is refused with the engine's own reason: `ALTER TABLE v RENAME TO w` on a
   * view fails with "view v may not be altered", because a view's name is fixed by
   * its `CREATE VIEW` statement and SQLite offers no rename for one.
   */
  async moveTable(schema: string | undefined, table: string, target: TableTarget): Promise<QueryResult> {
    const from = schema === undefined || schema === '' ? 'main' : schema
    requireIdentifier(from, 'schema name', quoteSqlite)
    requireIdentifier(target.schema, 'schema name', quoteSqlite)
    const next = requireIdentifier(target.table, 'table name', quoteSqlite)
    if (from !== target.schema) {
      throw new Error(
        `SQLite 的库就是一个文件，表不能移动到另一个库：「${target.schema}」如果是另一个 .db 文件，` +
        '需要把表导出成 SQL 再导入过去。此处只能在同一库内改名。',
      )
    }
    if (table === target.table) throw new Error('the source and the target are the same table')
    requireIdentifier(table, 'table name', quoteSqlite)
    const objects = await this.tableNames(from)
    const moving = objects.find(entry => entry.name === table)
    if (moving === undefined) throw new Error(`no such table: ${table}`)
    if (moving.type === 'view') {
      throw new Error(`「${table}」是视图：SQLite 不允许重命名视图（引擎原文 "view ${table} may not be altered"）。请删除后按新的名字重建。`)
    }
    if (objects.some(entry => entry.name.toLowerCase() === target.table.toLowerCase())) {
      throw new Error(`库里已存在「${target.table}」`)
    }
    return this.exec(`ALTER TABLE ${qualifySqlite(schema, table)} RENAME TO ${next}`, [], schema)
  }

  /**
   * Refused, with the reason, rather than half-implemented.
   *
   * The two statements that could copy a table inside one file both lose something
   * that matters, and neither can be papered over:
   *
   * - **`CREATE TABLE new AS SELECT * FROM old`** copies only the column VALUES'
   *   shape. Measured: the copy came back with `id INT` — no PRIMARY KEY, no
   *   UNIQUE, no COLLATE, no generated column, no DEFAULT — and no indexes at all.
   *   A copy that silently drops a table's constraints is worse than no copy.
   * - **Re-creating from the parsed `CREATE` text** would be faithful, but every
   *   index and trigger would then have to be recreated under a new name, and
   *   SQLite's index names are GLOBAL to the schema (measured: recreating
   *   `ix_t_v` on the copy fails with "index ix_t_v already exists"), so each one
   *   needs a generated name — a second implementation of the rebuild path whose
   *   only difference from the export/import dialog is convenience.
   *
   * @throws always.
   */
  async copyTable(): Promise<QueryResult> {
    throw new Error(
      'SQLite 没有复制表的语句：CREATE TABLE … AS SELECT 会丢掉主键、唯一约束、默认值与生成列' +
      '（实测复制品只有列名和类型），而按 CREATE 文本重建又要给每个索引和触发器另起名字（索引名在库内全局唯一）。' +
      '请在「导出」里导出该表，再「导入」成新表。',
    )
  }

  /**
   * What SQLite reports as a table's options: an object kind, and nothing else.
   *
   * There is no storage engine (one is compiled in), no table-level collation (it is
   * per column), no table comment (nowhere to store one) and no AUTO_INCREMENT
   * counter separate from the rowid — so an "options" form on SQLite would be a form
   * of empty fields. The 表选项 page says this instead of offering them; see
   * {@link tableActionSupport}.
   */
  async tableOptionInfo(schema: string | undefined, table: string): Promise<TableOptionInfo> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    requireIdentifier(table, 'table name', quoteSqlite)
    const objects = await this.tableNames(target)
    const found = objects.find(entry => entry.name === table)
    if (found === undefined) throw new Error(`no such table: ${table}`)
    return { isView: found.type === 'view' }
  }

  /**
   * Refused: SQLite has no table option that can be changed after the fact.
   *
   * The two candidates are not options in this sense. `auto_vacuum`, `page_size` and
   * friends are FILE-level PRAGMAs, and `page_size` must be set before the database
   * has any tables; `WITHOUT ROWID` and `STRICT` are part of the table's identity —
   * changing either means rebuilding the table, which the 结构 tab does for the
   * column changes that need it.
   *
   * @throws always.
   */
  async alterTableOptions(): Promise<QueryResult> {
    throw new Error(
      'SQLite 没有可修改的表选项：没有存储引擎、没有表级排序规则、没有表注释的存放处；' +
      'auto_vacuum / page_size 是整库的 PRAGMA（page_size 还必须在建表前设置），' +
      'WITHOUT ROWID / STRICT 属于表本身的结构，改动等于重建表。',
    )
  }

  /**
   * Read and parse one table's `CREATE TABLE` statement.
   *
   * The statement text — not `PRAGMA table_info` — is the source for a rebuild,
   * because `table_info` omits CHECK constraints, foreign keys, COLLATE clauses
   * and the `WITHOUT ROWID` / `STRICT` keywords. A rebuild driven by it would
   * quietly drop all of them.
   */
  private async readShape(schema: string, table: string): Promise<TableShape> {
    requireIdentifier(table, 'table name', quoteSqlite)
    const sql = await this.run(db => {
      const row = db
        .prepare(`SELECT sql FROM ${quoteSqlite(schema)}.sqlite_master WHERE type = 'table' AND name = ?`)
        .get(table) as { sql?: unknown } | undefined
      return row?.sql === undefined || row.sql === null ? undefined : String(row.sql)
    })
    if (sql === undefined) throw new Error(`no such table: ${table}`)
    return parseCreateTable(sql, 'sqlite')
  }

  /**
   * Rebuild one table from an edited shape, inside a single transaction.
   *
   * This is SQLite's documented 12-step procedure. Four details are load
   * bearing, and each was reproduced in a probe before being written down:
   *
   * 1. **The replacement is created under a NEW name and the ORIGINAL is
   *    dropped, rather than renaming the original aside.** Renaming the original
   *    first is the tempting order, but the `DROP TABLE` then fails with
   *    "FOREIGN KEY constraint failed" whenever another table references it —
   *    the reference was rewritten to follow the rename and now dangles.
   *    Creating the replacement first and dropping the original keeps every
   *    reference pointing at the name being replaced.
   *
   * 2. **`legacy_alter_table` is ON for the duration.** With it off (the default
   *    since 3.25) `ALTER TABLE … RENAME TO` rewrites every reference to the
   *    renamed table — including the foreign keys and views of OTHER tables,
   *    which would be repointed at the temporary name. Worse, the rewrite makes
   *    the rename itself fail with "error in view …: no such table", leaving the
   *    database unusable in the same transaction. With it on, the rename only
   *    changes the table's own name.
   *
   * 3. **`foreign_keys` is turned OFF OUTSIDE the transaction.** SQLite
   *    SILENTLY IGNORES this pragma inside a transaction — measured: setting it
   *    after `BEGIN` left `PRAGMA foreign_keys` reading 1. Both pragmas are
   *    therefore applied before `BEGIN` and restored in a `finally`, to the
   *    value the connection already had (a user may legitimately run with them
   *    off). The pool hands this same connection back, so leaving either pragma
   *    changed would alter the behaviour of everything that runs afterwards.
   *
   * 4. **Indexes and triggers are recreated from their original SQL, and the
   *    `sqlite_sequence` row is restored.** A table's indexes and triggers are
   *    dropped along with it, so a rebuild that recreated only the table would
   *    silently remove every index and trigger on it. `AUTOINCREMENT`'s
   *    high-water mark lives in `sqlite_sequence` and would otherwise reset to
   *    the largest id still present — handing out the ids of deleted rows again.
   */
  private async rebuildTable(schema: string, table: string, shape: TableShape): Promise<QueryResult> {
    requireIdentifier(table, 'table name', quoteSqlite)
    const temporary = `${table}${REBUILD_SUFFIX}`
    if (table.endsWith(REBUILD_SUFFIX)) throw new Error(`cannot rebuild a table whose name ends with ${REBUILD_SUFFIX}`)

    const started = Date.now()
    return this.run(db => {
      const existing = db
        .prepare(`SELECT name FROM ${quoteSqlite(schema)}.sqlite_master WHERE name = ?`)
        .get(temporary) as { name?: unknown } | undefined
      if (existing !== undefined) {
        throw new Error(`"${temporary}" already exists; rename or drop it before changing this table`)
      }

      const before = readSchemaObjects(db, schema, table)
      const sequence = readSequenceValue(db, table)
      const hadForeignKeys = readPragmaFlag(db, 'foreign_keys')
      const hadLegacyAlter = readPragmaFlag(db, 'legacy_alter_table')

      // Both pragmas must be set BEFORE `BEGIN`; see point 3 above.
      if (hadForeignKeys === true) db.exec('PRAGMA foreign_keys = OFF')
      if (hadLegacyAlter !== true) db.exec('PRAGMA legacy_alter_table = ON')

      let inTransaction = false
      try {
        db.exec('BEGIN')
        inTransaction = true
        db.exec(renderCreateTable(shape, 'sqlite', { name: temporary }))
        if (shape.columns.length > 0) {
          // A generated column cannot be inserted into — SQLite answers "cannot
          // INSERT into generated column" — so it is left out of both sides of
          // the copy and the engine recomputes it from the columns that remain.
          const source = shape.columns.filter(column => column.generated !== true)
          if (source.length > 0) {
            const names = source.map(column => quoteSqlite(column.name)).join(', ')
            db.exec(`INSERT INTO ${quoteSqlite(temporary)} (${names}) SELECT ${names} FROM ${quoteSqlite(table)}`)
          }
        }
        db.exec(`DROP TABLE ${quoteSqlite(table)}`)
        db.exec(`ALTER TABLE ${quoteSqlite(temporary)} RENAME TO ${quoteSqlite(table)}`)
        // Indexes and triggers were dropped with the table; recreate them from
        // the text the engine recorded, which is the only place an expression
        // index or a trigger body exists.
        for (const object of before) {
          if (object.sql === undefined) continue
          db.exec(object.sql)
        }
        if (sequence !== undefined) {
          // The row for this table was deleted along with it. Restoring the
          // high-water mark is what keeps AUTOINCREMENT monotonic across a
          // rebuild: without it the next insert reuses a deleted row's id.
          db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(table)
          db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(table, Math.trunc(sequence))
        }
        db.exec('COMMIT')
        inTransaction = false
      } catch (error) {
        if (inTransaction) {
          try {
            db.exec('ROLLBACK')
          } catch {
            /* the transaction is already gone */
          }
        }
        throw error
      } finally {
        // Restore what the connection had, not a hard-coded default: the user's
        // session may legitimately run with foreign keys off, and forcing them
        // on would change the meaning of every later statement.
        try {
          if (hadForeignKeys === true) db.exec('PRAGMA foreign_keys = ON')
          if (hadLegacyAlter !== true) db.exec('PRAGMA legacy_alter_table = OFF')
        } catch {
          /* the connection is going away anyway */
        }
      }
      return {
        columns: [],
        rows: [],
        affected: 0,
        durationMs: Date.now() - started,
        write: true,
        truncated: false,
      } satisfies QueryResult
    })
  }

  /**
   * Run several statements as one transaction.
   *
   * A script's own `BEGIN`/`COMMIT` is neutralized rather than rejected: a dump
   * this plugin wrote wraps itself in them, and SQLite treats a nested `BEGIN`
   * as an error while a stray `COMMIT` would end the wrapper's transaction early
   * and defeat the whole point. Both are dropped, and the wrapper owns the
   * transaction — which is what makes "all or nothing" true for a foreign dump
   * as well as the plugin's own.
   */
  async runScript(statements: string[], schema: string | undefined, onStatement?: (index: number) => void): Promise<void> {
    const body = statements.filter(statement => !isTransactionControl(statement))
    if (body.length === 0) return
    for (const statement of body) assertSingleStatement(statement)
    return this.run(db => {
      db.exec('BEGIN')
      try {
        for (const [index, statement] of body.entries()) {
          db.exec(statement)
          onStatement?.(index)
        }
        db.exec('COMMIT')
      } catch (error) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* the transaction is already gone */
        }
        throw error
      }
    })
  }

  /**
   * The `CREATE INDEX` / `CREATE TRIGGER` statements a table owns.
   *
   * Needed because SQLite's `CREATE TABLE` text does not mention them: a dump
   * built from that text alone would lose every index and trigger on the table.
   * `sqlite_master` is the only place an expression index or a trigger body
   * exists, so the text is read from there and used verbatim.
   *
   * Order matters: index_before_trigger, so a trigger that references an index
   * finds it. `sqlite_autoindex_*` rows are skipped — they have no SQL and are
   * recreated by the `CREATE TABLE` itself.
   */
  async auxiliaryDdl(schema: string | undefined, table: string): Promise<string[]> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    requireIdentifier(target, 'schema name', quoteSqlite)
    requireIdentifier(table, 'table name', quoteSqlite)
    return this.run(db => {
      const rows = db
        .prepare(
          `SELECT type, sql FROM ${quoteSqlite(target)}.sqlite_master ` +
            "WHERE tbl_name = ? AND type IN ('index','trigger') AND name NOT LIKE 'sqlite_autoindex_%' " +
            "ORDER BY CASE type WHEN 'index' THEN 0 ELSE 1 END, name",
        )
        .all(table) as Array<Record<string, unknown>>
      return rows
        .map(row => (row['sql'] === null || row['sql'] === undefined ? '' : String(row['sql']).trim()))
        .filter(sql => sql !== '')
        .map(sql => (sql.endsWith(';') ? sql : `${sql};`))
    })
  }

  /** The `CREATE TABLE` text SQLite recorded, or undefined for a view. */
  async createStatement(schema: string | undefined, table: string): Promise<string | undefined> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    requireIdentifier(target, 'schema name', quoteSqlite)
    requireIdentifier(table, 'table name', quoteSqlite)
    return this.run(db => {
      const row = db
        .prepare(`SELECT sql FROM ${quoteSqlite(target)}.sqlite_master WHERE type = 'table' AND name = ?`)
        .get(table) as { sql?: unknown } | undefined
      return row?.sql === undefined || row.sql === null ? undefined : String(row.sql)
    })
  }

  /**
   * Every row of a table, capped at `limit`.
   *
   * `SELECT *` with no ORDER BY: an export of a table with no primary key has
   * no stable order to impose, and paying for a sort of the whole table to
   * produce a different arbitrary order would be worse than not paying.
   */
  async allRows(
    schema: string | undefined,
    table: string,
    limit: number,
  ): Promise<{ columns: string[]; rows: Array<Record<string, string | number | boolean | null>>; truncated: boolean }> {
    const cap = Math.max(1, Math.trunc(limit))
    const qualified = qualifySqlite(schema, table)
    // One row PAST the cap, which is what proves there was more.
    return this.run(db => {
      const statement = db.prepare(`SELECT * FROM ${qualified} LIMIT ?`)
      const raw = statement.all(cap + 1) as Array<Record<string, unknown>>
      const truncated = raw.length > cap
      const rows = truncated ? raw.slice(0, cap) : raw
      const columns = rows.length > 0 ? Object.keys(rows[0]!) : this.columnNames(db, schema, table)
      return { columns, rows: rows.map(row => projectRow(row)), truncated }
    })
  }

  /** The column names of a table, for an export with no rows to read them from. */
  private columnNames(db: SqliteDatabase, schema: string | undefined, table: string): string[] {
    const target = schema === undefined || schema === '' ? 'main' : schema
    const rows = db.prepare(`PRAGMA ${quoteSqlite(target)}.table_xinfo(${quoteSqlite(table)})`).all() as Array<Record<string, unknown>>
    return rows.filter(row => Number(row['hidden'] ?? 0) !== 1).map(row => String(row['name'] ?? ''))
  }

  /** Which tables each table references, from its own foreign-key clauses. */
  async tableReferences(schema: string | undefined): Promise<Map<string, string[]>> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    requireIdentifier(target, 'schema name', quoteSqlite)
    return this.run(db => {
      const names = db
        .prepare(`SELECT name FROM ${quoteSqlite(target)}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
        .all() as Array<Record<string, unknown>>
      const references = new Map<string, string[]>()
      for (const row of names) {
        const name = String(row['name'] ?? '')
        if (name === '') continue
        const list = db.prepare(`PRAGMA ${quoteSqlite(target)}.foreign_key_list(${quoteSqlite(name)})`).all() as Array<Record<string, unknown>>
        const targets = new Set<string>()
        for (const entry of list) {
          const table = entry['table']
          // A self-reference is not a dependency to order by: the table is its
          // own target, and treating it as one would make the walk skip it.
          if (typeof table === 'string' && table !== '' && table.toLowerCase() !== name.toLowerCase()) targets.add(table.toLowerCase())
        }
        if (targets.size > 0) references.set(name.toLowerCase(), [...targets])
      }
      return references
    })
  }

  /** Tables and views in one schema, names only — the export scope's list. */
  async tableNames(schema: string | undefined): Promise<Array<{ name: string; type: string }>> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    requireIdentifier(target, 'schema name', quoteSqlite)
    return this.run(db => {
      const rows = db
        .prepare(
          `SELECT name, type FROM ${quoteSqlite(target)}.sqlite_master ` +
            "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .all() as Array<Record<string, unknown>>
      return rows
        .filter(row => typeof row['name'] === 'string')
        .map(row => ({ name: String(row['name']), type: row['type'] === 'view' ? 'view' : 'table' }))
    })
  }

  /**
   * Empty a table, keeping its schema.
   *
   * SQLite has no TRUNCATE, so this is `DELETE FROM`. Two consequences the
   * caller should know about, and which are why this is not presented as a
   * TRUNCATE:
   *
   * - `sqlite_sequence` is NOT reset, so an AUTOINCREMENT column keeps counting
   *   up from where it was. Measured: two rows inserted, deleted, then the next
   *   insert got id 3. That is the documented SQLite behaviour and matches what
   *   `DELETE FROM` does in MySQL too, so it is left alone rather than papered
   *   over — silently resetting a primary key would break foreign references
   *   held elsewhere.
   * - It is a row-by-row delete, so it is slower than MySQL's TRUNCATE on a
   *   large table.
   */
  async truncateTable(schema: string | undefined, table: string, isView = false): Promise<QueryResult> {
    if (isView) throw new Error('a view has no rows of its own to delete')
    const qualified = qualifySqlite(schema, table)
    return this.exec(`DELETE FROM ${qualified}`, [], schema)
  }

  /**
   * Drop a table or a view.
   *
   * The object's kind decides the statement: SQLite refuses `DROP TABLE` on a
   * view ("use DROP VIEW to delete view v"), so collapsing both into one
   * DROP TABLE makes dropping a view fail with an engine error the user cannot
   * act on.
   */
  async dropTable(schema: string | undefined, table: string, isView = false): Promise<QueryResult> {
    const qualified = qualifySqlite(schema, table)
    return this.exec(`DROP ${isView ? 'VIEW' : 'TABLE'} ${qualified}`, [], schema)
  }
}

/**
 * Per-table row counts, from the `sqlite_stat1` table `ANALYZE` writes.
 *
 * SQLite keeps no row-count statistic of its own, so the only two options are
 * a real `COUNT(*)` per table — a full scan each, 49 ms for a single 1M-row
 * table and proportionally worse across many — or reading the estimate
 * `ANALYZE` already stored. This reads the estimate.
 *
 * `ANALYZE` is deliberately NOT run here. It writes to the user's database
 * file, so running it behind a "list the tables" click would mutate a
 * production database as a side effect of looking at it. A file that has never
 * been analysed therefore reports no counts, and the panel shows `—` rather
 * than a made-up zero.
 *
 * The statistic is an estimate for a multi-column index and can lag a table's
 * real contents until the next ANALYZE. It is presented as a count, not as a
 * guarantee.
 */
function readTableRowCounts(db: SqliteDatabase, schema: string): Map<string, number> {
  const counts = new Map<string, number>()
  try {
    const rows = db.prepare(`SELECT tbl, stat FROM ${quoteSqlite(schema)}.sqlite_stat1`).all() as Array<Record<string, unknown>>
    for (const row of rows) {
      const table = row['tbl']
      // `stat` is "rowcount" or "rowcount avg-per-index-key …" — the first
      // number is the table's row count.
      const first = typeof row['stat'] === 'string' ? String(row['stat']).trim().split(/\s+/)[0] : undefined
      const count = first === undefined ? Number.NaN : Number(first)
      if (typeof table === 'string' && Number.isFinite(count) && count >= 0) counts.set(table, count)
    }
  } catch {
    // `sqlite_stat1` only exists after the first ANALYZE. Its absence is the
    // normal state, not an error.
  }
  return counts
}

/**
 * The schema objects a table owns that a `DROP TABLE` would take with it.
 *
 * Indexes and triggers are dropped along with their table, so a rebuild has to
 * recreate them. Their SQL text is captured from `sqlite_master` — an
 * expression index and a trigger body exist nowhere else. The table's own
 * implicit indexes (`sqlite_autoindex_*`, from a UNIQUE or PRIMARY KEY
 * constraint) are skipped: they have no SQL and are recreated by the new
 * `CREATE TABLE` itself.
 *
 * Rows are returned in `sqlite_master` order, which puts a table's own indexes
 * before its triggers, so an index a trigger depends on exists first.
 */
function readSchemaObjects(db: SqliteDatabase, schema: string, table: string): Array<{ type: string; name: string; sql: string | undefined }> {
  const rows = db
    .prepare(
      `SELECT type, name, sql FROM ${quoteSqlite(schema)}.sqlite_master ` +
        "WHERE tbl_name = ? AND type IN ('index','trigger') AND name NOT LIKE 'sqlite_autoindex_%'",
    )
    .all(table) as Array<Record<string, unknown>>
  return rows.map(row => ({
    type: String(row['type'] ?? ''),
    name: String(row['name'] ?? ''),
    sql: row['sql'] === null || row['sql'] === undefined ? undefined : String(row['sql']),
  }))
}

/** The `AUTOINCREMENT` high-water mark a table has recorded, if any. */
function readSequenceValue(db: SqliteDatabase, table: string): number | undefined {
  try {
    const row = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table) as { seq?: unknown } | undefined
    if (row?.seq === undefined) return undefined
    const value = Number(row.seq)
    return Number.isFinite(value) ? value : undefined
  } catch {
    // `sqlite_sequence` exists only once some table uses AUTOINCREMENT.
    return undefined
  }
}

/** Whether a connection-level boolean pragma reads as ON (1). */
function readPragmaFlag(db: SqliteDatabase, name: string): boolean | undefined {
  try {
    const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined
    if (row === undefined) return undefined
    const value = Object.values(row)[0]
    return Number(value) === 1
  } catch {
    return undefined
  }
}

/** Turn a wire {@link ColumnSpec} into a renderable column definition. */
function toDefinition(spec: ColumnSpec): ColumnDefinition {
  return {
    name: spec.name,
    // The caller's own casing is kept: it is what a user typed or what the
    // engine already had, and normalizing it would make a no-op edit改写 the
    // table's definition.
    type: spec.type,
    // A primary-key column is NOT NULL by definition; the caller's checkbox is
    // not allowed to say otherwise.
    nullable: spec.primaryKeyPosition === undefined ? spec.nullable : false,
    // Passed through as given; `renderColumn` decides how to emit it, and it is the one
    // place that knows an expression default must bypass the literal validator. See its
    // comment — the short version is that SQLite rebuilds the whole table for every
    // change, so one expression default would otherwise break edits of every OTHER
    // column.
    ...(spec.defaultValue === undefined || spec.defaultValue === '' ? {} : { defaultValue: spec.defaultValue }),
    ...(spec.primaryKeyPosition === undefined ? {} : { primaryKeyPosition: spec.primaryKeyPosition }),
    ...(spec.autoIncrement === true ? { autoIncrement: true, sqliteAutoincrement: true } : {}),
    ...(spec.unique === true ? { unique: true } : {}),
    // A per-column collation. Carried into the definition, because `renderColumn` emits
    // it from there — without this the clause never reached the statement and the
    // column silently used the default collation.
    ...(spec.collate === undefined || spec.collate === '' ? {} : { collate: spec.collate }),
    extras: [],
  }
}

/**
 * Assert that every table-level constraint still names a surviving column.
 *
 * A rebuild re-emits the constraint clauses verbatim, so dropping a column a
 * UNIQUE or FOREIGN KEY clause still names would produce a `CREATE TABLE` that
 * references a column which no longer exists. The engine would reject it with a
 * message about the constraint rather than about the edit, so the failure is
 * caught here where the column can be named.
 */
function assertConstraintsUsable(shape: TableShape): void {
  const present = new Set(shape.columns.map(column => column.name.toLowerCase()))
  for (const constraint of shape.constraints) {
    if (constraint.kind === 'check') continue
    const listMatch = /\(\s*([\s\S]*?)\s*\)/.exec(constraint.sql)
    if (listMatch === null) continue
    for (const part of splitTopLevel(listMatch[1]!)) {
      const name = /^\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))/.exec(part)
      const value = name?.[1] ?? name?.[2] ?? name?.[3] ?? name?.[4]
      if (value === undefined) continue
      // `FOREIGN KEY (a) REFERENCES b(c)` names a column of the OTHER table
      // inside the same bracket group, so only the first list is checked.
      if (!present.has(value.toLowerCase())) {
        throw new Error(`"${value}" is used by a table constraint (${constraint.sql}) and cannot be dropped`)
      }
      break
    }
  }
}

/** Project one raw SQLite row onto the wire shape. */
function projectRow(row: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(row)) out[key] = toWireValue(value)
  return out
}

/**
 * Per-table on-disk size, from the `dbstat` virtual table.
 *
 * A single aggregate pass, so the cost is one walk of the database's page map
 * rather than one query per table. `dbstat` is a compile-time option; a build
 * without it (or an older file) makes this throw, and the caller then reports
 * no sizes at all instead of failing the table list.
 *
 * Only tables appear here — a view owns no pages of its own, so it is absent
 * from the map and the caller renders no size for it.
 */
function readTableSizes(db: SqliteDatabase, schema: string): Map<string, number> {
  const sizes = new Map<string, number>()
  try {
    const rows = db
      .prepare(
        'SELECT name, SUM(pgsize) AS bytes FROM dbstat ' +
          "WHERE schema = ? AND name NOT LIKE 'sqlite_%' GROUP BY name",
      )
      .all(schema) as Array<Record<string, unknown>>
    for (const row of rows) {
      const name = row['name']
      const bytes = Number(row['bytes'] ?? 0)
      if (typeof name === 'string' && Number.isFinite(bytes) && bytes > 0) sizes.set(name, bytes)
    }
  } catch {
    // No dbstat in this build: sizes are simply unavailable.
  }
  return sizes
}

/** Whether a filesystem path exists and looks like a SQLite database. */
export function sqliteFileStatus(file: string): { exists: boolean; size?: number; error?: string } {
  const path = resolveSqliteFile(file)
  if (path === ':memory:') return { exists: true }
  try {
    if (!existsSync(path)) return { exists: false }
    const stat = statSync(path)
    if (!stat.isFile()) return { exists: false, error: 'path is not a regular file' }
    return { exists: true, size: stat.size }
  } catch (error) {
    return { exists: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Ensure the parent directory of a SQLite file exists (used by the create dialog). */
export function ensureSqliteParent(file: string): void {
  const path = resolveSqliteFile(file)
  if (path === ':memory:') return
  mkdirSync(dirname(path), { recursive: true })
}

/**
 * A SQLite string literal for a path.
 *
 * Paths cannot be parameter-bound in a `VACUUM INTO` (it takes a literal), so the
 * quoting is done here: single quotes doubled, and a backslash is fine as-is because
 * `VACUUM INTO`'s argument is an SQL string literal with no escape processing beyond
 * the doubled quote. A path is normalised to forward slashes first — a Windows
 * backslash inside a SQL literal is not wrong, but it is one escaping rule fewer to
 * rely on.
 */
function sqliteStringLiteral(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (/[\u0000-\u001f]/.test(normalized)) throw new Error('a database path cannot contain a control character')
  return `'${normalized.replace(/'/g, "''")}'`
}

/** The `-wal` and `-shm` files SQLite keeps beside a database in WAL mode. */
function sqliteSiblings(path: string): string[] {
  return [`${path}-wal`, `${path}-shm`]
}

/**
 * Rename a database file, taking its WAL siblings along.
 *
 * Without the siblings the renamed database would lose committed transactions that
 * are still in the `-wal` file, and the ORIGINAL path would keep a `-wal` that no
 * database claims.
 */
function renameWithSiblings(from: string, to: string): void {
  renameSync(from, to)
  for (const [index, sibling] of sqliteSiblings(from).entries()) {
    if (!existsSync(sibling)) continue
    try {
      renameSync(sibling, sqliteSiblings(to)[index]!)
    } catch {
      // Best effort: a `-shm` file can be locked, and the database itself is already
      // moved. Reporting the whole rename as failed would be wrong.
    }
  }
}

/** Delete a database file and its WAL siblings. */
function dropWithSiblings(path: string): void {
  for (const target of [path, ...sqliteSiblings(path)]) {
    try {
      rmSync(target, { force: true })
    } catch (error) {
      // A locked file means the delete did not happen, which the caller must know:
      // silently reporting success would leave the database in place.
      throw new Error(`无法删除 ${target}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
