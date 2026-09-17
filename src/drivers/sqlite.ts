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

import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { expandHome } from '../dsh-home.ts'
import type { ColumnInfo, DataSourceEntry, IndexInfo, QueryResult, SchemaInfo, TableInfo, TablePage, TestResult } from '../protocol.ts'
import { assertSingleStatement, buildSearchWhere, looksReadOnly, pushDownLimit, qualifySqlite, quoteSqlite, requireIdentifier, toWireValue } from '../sql-util.ts'
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
import type { ColumnSpec, RowKey, RowQuery, RowValue, SqlDriver, TableListOptions } from './types.ts'

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
      return buildSearchWhere(query.filters, query.filterJoin === 'or' ? 'or' : 'and', quoteSqlite, known)
    }
    if (query.mode === 'search') {
      const term = query.term ?? ''
      if (term === '') return { where: '', params: [] }
      // Match against every column: SQLite has no per-column type guarantee,
      // so casting through TEXT is the only filter that cannot error. The term
      // is bound, never interpolated; its `%`/`_` are escaped so a literal
      // percent sign is a character to find rather than a wildcard.
      const pattern = `%${term.replace(/[\\%_]/g, match => `\\${match}`)}%`
      const clauses = allColumns.map(column => `CAST(${quoteSqlite(column)} AS TEXT) LIKE ? ESCAPE '\\'`)
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
   */
  async insertRows(schema: string | undefined, table: string, rows: RowValue[][]): Promise<QueryResult> {
    if (rows.length === 0) throw new Error('insert requires at least one row')
    const qualified = qualifySqlite(schema, table)
    // Column order is taken from the FIRST row and enforced for the rest: a
    // batch that names different columns per row cannot be one statement, and
    // silently inserting NULLs for the columns a later row omitted would be a
    // data-corruption bug rather than an error.
    const columns = rows[0]!.map(item => item.column)
    for (const row of rows) {
      if (row.length !== columns.length || row.some((item, index) => item.column !== columns[index])) {
        throw new Error('every row in one insert must name the same columns, in the same order')
      }
    }
    const names = columns.map(name => requireIdentifier(name, 'column name', quoteSqlite)).join(', ')
    const placeholders = columns.map(() => '?').join(', ')
    const sql = `INSERT INTO ${qualified} (${names}) VALUES (${placeholders})`
    const started = Date.now()
    return this.run(db => {
      let affected = 0
      db.exec('BEGIN')
      try {
        const statement = db.prepare(sql)
        for (const row of rows) affected += Number(statement.run(...row.map(item => item.value)).changes ?? 0)
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

    // Validate the new definition BEFORE deciding the path, so a refusal names
    // the field rather than surfacing after a partial write.
    const next = toDefinition(spec)
    renderColumn(next, 'sqlite')

    const newName = options.rename ?? spec.name
    const onlyRenamed =
      newName !== spec.name
      && normalizeType(next.type, 'sqlite') === normalizeType(current.type, 'sqlite')
      && next.nullable === current.nullable
      && normalizeDefault(next.defaultValue, 'sqlite') === normalizeDefault(current.defaultValue, 'sqlite')
      && next.unique === current.unique
      && current.primaryKeyPosition === undefined

    if (onlyRenamed) {
      const qualified = qualifySqlite(schema, table)
      return this.exec(
        `ALTER TABLE ${qualified} RENAME COLUMN ${identifier(spec.name, 'column name', 'sqlite')} TO ${identifier(newName, 'column name', 'sqlite')}`,
        [],
        schema,
      )
    }

    const edited: ColumnDefinition = {
      ...current,
      ...next,
      name: newName,
      // `extras` and `check` belong to the ORIGINAL column, not to the new
      // spec: they are clauses this plugin does not model, and dropping them
      // because the type changed would silently delete a CHECK constraint.
      extras: current.extras,
      ...(current.check === undefined ? {} : { check: current.check }),
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
    ...(spec.defaultValue === undefined || spec.defaultValue === '' ? {} : { defaultValue: spec.defaultValue }),
    ...(spec.primaryKeyPosition === undefined ? {} : { primaryKeyPosition: spec.primaryKeyPosition }),
    ...(spec.autoIncrement === true ? { autoIncrement: true, sqliteAutoincrement: true } : {}),
    ...(spec.unique === true ? { unique: true } : {}),
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
