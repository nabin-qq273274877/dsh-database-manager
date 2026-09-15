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
import { assertSingleStatement, looksReadOnly, qualifySqlite, quoteSqlite, requireIdentifier, toWireValue } from '../sql-util.ts'
import type { RowKey, RowQuery, RowValue, SqlDriver } from './types.ts'

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
    try {
      const version = await this.run(db => {
        const row = db.prepare('SELECT sqlite_version() AS v').get() as { v?: unknown } | undefined
        return row?.v === undefined ? undefined : String(row.v)
      })
      return { ok: true, latencyMs: Date.now() - started, ...(version === undefined ? {} : { serverVersion: `SQLite ${version}` }) }
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

  async tables(schema?: string): Promise<TableInfo[]> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    requireIdentifier(target, 'schema name', quoteSqlite)
    return this.run(db => {
      const statement = db.prepare(
        `SELECT name, type FROM ${quoteSqlite(target)}.sqlite_master ` +
          `WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name`,
      )
      const rows = statement.all() as Array<{ name?: unknown; type?: unknown }>
      return rows
        .filter(row => typeof row.name === 'string')
        .map(row => ({
          name: String(row.name),
          type: row.type === 'view' ? 'view' : 'table',
        }) satisfies TableInfo)
    })
  }

  async columns(schema: string | undefined, table: string): Promise<ColumnInfo[]> {
    const target = schema === undefined || schema === '' ? 'main' : schema
    const qualified = qualifySqlite(target === 'main' ? undefined : target, table)
    return this.run(db => {
      const rows = db.prepare(`PRAGMA ${quoteSqlite(target)}.table_info(${quoteSqlite(table)})`).all() as Array<Record<string, unknown>>
      return rows.map(row => {
        const name = String(row['name'] ?? '')
        const pk = Number(row['pk'] ?? 0)
        return {
          name,
          type: String(row['type'] ?? ''),
          nullable: Number(row['notnull'] ?? 0) === 0,
          ...(row['dflt_value'] === null || row['dflt_value'] === undefined ? {} : { defaultValue: String(row['dflt_value']) }),
          key: pk > 0 ? 'PRI' : '',
          extra: '',
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
        return {
          name,
          unique: Number(entry['unique'] ?? 0) === 1,
          columns,
          type: String(entry['origin'] ?? ''),
        } satisfies IndexInfo
      })
    })
  }

  async rows(query: RowQuery): Promise<TablePage> {
    const schema = query.schema === undefined || query.schema === '' ? 'main' : query.schema
    const columns = await this.columns(schema, query.table)
    if (columns.length === 0) throw new Error(`no such table: ${query.table}`)
    const known = new Set(columns.map(column => column.name))
    const qualified = qualifySqlite(schema === 'main' ? undefined : schema, query.table)

    const { where, params } = this.buildFilter(query, columns.map(column => column.name), known)
    const order = query.orderBy !== undefined && known.has(query.orderBy)
      ? ` ORDER BY ${quoteSqlite(query.orderBy)} ${query.orderDir === 'desc' ? 'DESC' : 'ASC'}`
      : ''
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

  /** Build the WHERE clause and its bound parameters for a table read. */
  private buildFilter(query: RowQuery, allColumns: string[], known: Set<string>): { where: string; params: unknown[] } {
    if (query.mode === 'search') {
      const term = query.term ?? ''
      if (term === '') return { where: '', params: [] }
      // Match against every column: SQLite has no per-column type guarantee,
      // so casting through TEXT is the only filter that cannot error.
      const clauses = allColumns.map(column => `CAST(${quoteSqlite(column)} AS TEXT) LIKE ?`)
      return { where: ` WHERE (${clauses.join(' OR ')})`, params: allColumns.map(() => `%${term}%`) }
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
    return this.exec(sql, params, schema, limit)
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
}

/** Project one raw SQLite row onto the wire shape. */
function projectRow(row: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(row)) out[key] = toWireValue(value)
  return out
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
