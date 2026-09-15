/**
 * MySQL / MariaDB driver on mysql2. Uses a connection pool per data source so
 * the GUI's browsing and an agent's queries share warm connections.
 *
 * `mysql2` and `ioredis` are optional peers: a deployment can run the plugin
 * with only SQLite, and a missing dependency is reported per data source
 * instead of failing the plugin boot. The import is therefore lazy and its
 * failure is translated into an actionable message.
 */

import type { ColumnInfo, DataSourceEntry, IndexInfo, QueryResult, SchemaInfo, TableInfo, TablePage, TestResult } from '../protocol.ts'
import { assertSingleStatement, looksReadOnly, qualifyMysql, quoteMysql, requireIdentifier, toWireValue } from '../sql-util.ts'
import type { RowKey, RowQuery, RowValue, SqlDriver } from './types.ts'

/** Structural view of the mysql2/promise surface this driver uses. */
interface MysqlConnection {
  query(options: { sql: string; values?: unknown[] }): Promise<[unknown, unknown]>
  execute(options: { sql: string; values?: unknown[] }): Promise<[unknown, unknown]>
  release(): void
  destroy(): void
}

interface MysqlPool {
  getConnection(): Promise<MysqlConnection>
  query(options: { sql: string; values?: unknown[] }): Promise<[unknown, unknown]>
  end(): Promise<void>
  on(event: string, listener: (...args: unknown[]) => void): void
}

interface MysqlModule {
  createPool(config: Record<string, unknown>): MysqlPool
}

/** Load mysql2/promise lazily, or throw an actionable message. */
async function loadMysql(): Promise<MysqlModule> {
  try {
    const specifier = 'mysql2/promise'
    const mod = (await import(/* @vite-ignore */ specifier)) as unknown as MysqlModule & { default?: MysqlModule }
    const resolved = typeof mod.createPool === 'function' ? mod : mod.default
    if (resolved === undefined || typeof resolved.createPool !== 'function') {
      throw new Error('module does not export createPool')
    }
    return resolved
  } catch (error) {
    throw new Error(
      'MySQL support requires the optional dependency "mysql2". ' +
      `Install it next to this plugin (npm install mysql2). Detail: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Whether mysql2 is importable in this process. */
export async function mysqlAvailable(): Promise<boolean> {
  try {
    await loadMysql()
    return true
  } catch {
    return false
  }
}

/** MySQL driver bound to one stored entry. */
export class MysqlDriver implements SqlDriver {
  readonly kind = 'mysql' as const
  private readonly entry: DataSourceEntry
  private pool: MysqlPool | undefined

  constructor(entry: DataSourceEntry) {
    this.entry = entry
  }

  /** Create (once) and return the pool. */
  private async open(): Promise<MysqlPool> {
    if (this.pool !== undefined) return this.pool
    const host = this.entry.host
    if (host === undefined || host === '') throw new Error('mysql data source has no host configured')
    const { createPool } = await loadMysql()
    const timeout = this.entry.connectTimeoutMs ?? 10000
    const pool = createPool({
      host,
      port: this.entry.port ?? 3306,
      user: this.entry.user ?? 'root',
      password: this.entry.password ?? '',
      database: this.entry.database,
      connectTimeout: timeout,
      waitForConnections: true,
      connectionLimit: 4,
      maxIdle: 2,
      idleTimeout: 60000,
      queueLimit: 0,
      charset: 'utf8mb4',
      // Dates arrive as ISO-ish strings rather than JS Date objects so the
      // wire projection stays lossless and timezone-free.
      dateStrings: true,
      // Keep big integers as strings; a BIGINT beyond 2^53 would otherwise
      // silently lose precision before it reaches the browser.
      supportBigNumbers: true,
      bigNumberStrings: true,
      ...(this.entry.tls === true ? { ssl: { rejectUnauthorized: false } } : {}),
    })
    // A pool-level error listener is mandatory: without it a dropped backend
    // connection raises an unhandled 'error' event and kills the host process.
    pool.on('error', () => { /* surfaced per query instead */ })
    this.pool = pool
    return pool
  }

  async test(): Promise<TestResult> {
    const started = Date.now()
    try {
      const [rows] = await (await this.open()).query({
        sql: 'SELECT VERSION() AS v, CONNECTION_ID() AS cid',
      })
      const first = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined
      const version = first === undefined ? undefined : toWireValue(first['v'])
      return {
        ok: true,
        latencyMs: Date.now() - started,
        ...(typeof version === 'string' ? { serverVersion: `MySQL ${version}` } : {}),
      }
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, error: describeMysqlError(error) }
    }
  }

  async close(): Promise<void> {
    const pool = this.pool
    this.pool = undefined
    if (pool === undefined) return
    try {
      await pool.end()
    } catch {
      /* already closed */
    }
  }

  async schemas(): Promise<SchemaInfo[]> {
    const [rows] = await (await this.open()).query({
      sql:
        'SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA ' +
        "WHERE SCHEMA_NAME NOT IN ('information_schema','performance_schema','mysql','sys') " +
        'ORDER BY SCHEMA_NAME',
    })
    const list = Array.isArray(rows) ? rows : []
    return list
      .map(row => String((row as Record<string, unknown>)['name'] ?? ''))
      .filter(name => name !== '')
      .map(name => ({ name }) satisfies SchemaInfo)
  }

  async tables(schema?: string): Promise<TableInfo[]> {
    const target = schema !== undefined && schema !== '' ? schema : this.entry.database
    if (target === undefined || target === '') throw new Error('a schema is required')
    requireIdentifier(target, 'schema name', quoteMysql)
    const [rows] = await (await this.open()).query({
      sql:
        'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS rows_count, TABLE_COMMENT AS comment ' +
        'FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME',
      values: [target],
    })
    const list = Array.isArray(rows) ? rows : []
    return list.map(row => {
      const record = row as Record<string, unknown>
      const type = String(record['type'] ?? '')
      const comment = toWireValue(record['comment'])
      const rowCount = toWireValue(record['rows_count'])
      return {
        name: String(record['name'] ?? ''),
        type: type.includes('VIEW') ? 'view' : 'table',
        ...(typeof rowCount === 'number' ? { rows: rowCount } : {}),
        ...(typeof comment === 'string' && comment !== '' ? { comment } : {}),
      } satisfies TableInfo
    })
  }

  async columns(schema: string | undefined, table: string): Promise<ColumnInfo[]> {
    const target = schema !== undefined && schema !== '' ? schema : this.entry.database
    if (target === undefined || target === '') throw new Error('a schema is required')
    requireIdentifier(target, 'schema name', quoteMysql)
    requireIdentifier(table, 'table name', quoteMysql)
    const [rows] = await (await this.open()).query({
      sql:
        'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt, ' +
        'COLUMN_KEY AS col_key, COLUMN_COMMENT AS comment, EXTRA AS extra ' +
        'FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      values: [target, table],
    })
    const list = Array.isArray(rows) ? rows : []
    return list.map(row => {
      const record = row as Record<string, unknown>
      const dflt = toWireValue(record['dflt'])
      const comment = toWireValue(record['comment'])
      const extra = toWireValue(record['extra'])
      return {
        name: String(record['name'] ?? ''),
        type: String(record['type'] ?? ''),
        nullable: String(record['nullable'] ?? 'YES').toUpperCase() === 'YES',
        ...(dflt === null ? {} : { defaultValue: String(dflt) }),
        key: String(record['col_key'] ?? ''),
        ...(typeof comment === 'string' && comment !== '' ? { comment } : {}),
        ...(typeof extra === 'string' && extra !== '' ? { extra } : {}),
      } satisfies ColumnInfo
    })
  }

  async indexes(schema: string | undefined, table: string): Promise<IndexInfo[]> {
    const target = schema !== undefined && schema !== '' ? schema : this.entry.database
    if (target === undefined || target === '') throw new Error('a schema is required')
    requireIdentifier(target, 'schema name', quoteMysql)
    requireIdentifier(table, 'table name', quoteMysql)
    const [rows] = await (await this.open()).query({
      sql:
        'SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, COLUMN_NAME AS column_name, ' +
        'SEQ_IN_INDEX AS seq, INDEX_TYPE AS index_type ' +
        'FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ' +
        'ORDER BY INDEX_NAME, SEQ_IN_INDEX',
      values: [target, table],
    })
    const list = Array.isArray(rows) ? rows : []
    const byName = new Map<string, { unique: boolean; columns: Array<{ seq: number; name: string }>; type?: string }>()
    for (const row of list) {
      const record = row as Record<string, unknown>
      const name = String(record['name'] ?? '')
      if (name === '') continue
      const entry = byName.get(name) ?? { unique: Number(record['non_unique'] ?? 1) === 0, columns: [], type: asString(record['index_type']) }
      const column = asString(record['column_name'])
      if (column !== undefined) entry.columns.push({ seq: Number(record['seq'] ?? 0), name: column })
      byName.set(name, entry)
    }
    return [...byName.entries()].map(([name, entry]) => ({
      name,
      unique: entry.unique,
      columns: entry.columns.sort((a, b) => a.seq - b.seq).map(item => item.name),
      ...(entry.type === undefined ? {} : { type: entry.type }),
    }) satisfies IndexInfo)
  }

  async rows(query: RowQuery): Promise<TablePage> {
    const schema = query.schema !== undefined && query.schema !== '' ? query.schema : this.entry.database
    if (schema === undefined || schema === '') throw new Error('a schema is required')
    const columns = await this.columns(schema, query.table)
    if (columns.length === 0) throw new Error(`no such table: ${schema}.${query.table}`)
    const qualified = qualifyMysql(schema, query.table)
    const known = new Set(columns.map(column => column.name))
    const { where, params } = buildFilter(query, columns)

    const [countRows] = await (await this.open()).query({
      sql: `SELECT COUNT(*) AS n FROM ${qualified}${where}`,
      values: params,
    })
    const first = Array.isArray(countRows) ? (countRows[0] as Record<string, unknown> | undefined) : undefined
    const total = Number(toWireValue(first?.['n'] ?? 0) ?? 0)

    const order = query.orderBy !== undefined && known.has(query.orderBy)
      ? ` ORDER BY ${quoteMysql(query.orderBy)} ${query.orderDir === 'desc' ? 'DESC' : 'ASC'}`
      : ''
    const limit = Math.max(1, Math.min(query.pageSize, 5000))
    const offset = Math.max(0, (query.page - 1) * limit)
    const [dataRows] = await (await this.open()).query({
      sql: `SELECT * FROM ${qualified}${where}${order} LIMIT ${limit} OFFSET ${offset}`,
      values: params,
    })
    const list = Array.isArray(dataRows) ? dataRows : []
    return {
      columns,
      rows: list.map(row => projectRow(row as Record<string, unknown>)),
      total: Number.isFinite(total) ? total : 0,
      page: query.page,
      pageSize: limit,
      primaryKey: columns.filter(column => column.key === 'PRI').map(column => column.name),
    }
  }

  async query(sql: string, params: unknown[], limit: number, schema?: string): Promise<QueryResult> {
    assertSingleStatement(sql)
    if (!looksReadOnly(sql)) {
      throw new Error('only read-only statements (SELECT / WITH / SHOW / DESCRIBE / EXPLAIN) are allowed on this surface')
    }
    return this.runQuery(sql, params, limit, schema)
  }

  async exec(sql: string, params: unknown[], schema?: string): Promise<QueryResult> {
    assertSingleStatement(sql)
    if (schema !== undefined && schema !== '') {
      // Pin the session's default schema so an unqualified statement lands in
      // the schema the user is looking at.
      requireIdentifier(schema, 'schema name', quoteMysql)
      return this.runQuery(`USE ${quoteMysql(schema)}`, [], 0)
        .then(() => this.runQuery(sql, params, 0))
    }
    return this.runQuery(sql, params, 0)
  }

  /** One statement round trip with timing and result-set shaping. */
  private async runQuery(sql: string, params: unknown[], limit: number, _schema?: string): Promise<QueryResult> {
    const started = Date.now()
    const [result, fields] = await (await this.open()).query({ sql, values: params })
    const durationMs = Date.now() - started
    if (Array.isArray(result)) {
      const fieldList = Array.isArray(fields) ? fields : []
      const columns = fieldList
        .map(field => (typeof (field as { name?: unknown }).name === 'string' ? String((field as { name: unknown }).name) : ''))
        .filter(name => name !== '')
      const rows = result as Array<Record<string, unknown>>
      const truncated = limit > 0 && rows.length > limit
      const sliced = truncated ? rows.slice(0, limit) : rows
      const projected = columns.length > 0 ? columns : sliced.length > 0 ? Object.keys(sliced[0]!) : []
      return {
        columns: projected,
        rows: sliced.map(row => projected.map(column => toWireValue(row[column]))),
        affected: sliced.length,
        durationMs,
        write: false,
        truncated,
      }
    }
    const summary = (result ?? {}) as Record<string, unknown>
    return {
      columns: [],
      rows: [],
      affected: Number(toWireValue(summary['affectedRows'] ?? 0) ?? 0),
      durationMs,
      write: true,
      truncated: false,
    }
  }

  async insertRow(schema: string | undefined, table: string, values: RowValue[]): Promise<QueryResult> {
    if (values.length === 0) throw new Error('insert requires at least one column value')
    const target = schema !== undefined && schema !== '' ? schema : this.entry.database
    const qualified = qualifyMysql(target, table)
    const names = values.map(item => requireIdentifier(item.column, 'column name', quoteMysql)).join(', ')
    const placeholders = values.map(() => '?').join(', ')
    return this.exec(`INSERT INTO ${qualified} (${names}) VALUES (${placeholders})`, values.map(item => item.value), target)
  }

  async updateRow(schema: string | undefined, table: string, values: RowValue[], keys: RowKey[]): Promise<QueryResult> {
    if (values.length === 0) throw new Error('update requires at least one column value')
    if (keys.length === 0) throw new Error('update requires a row key')
    const target = schema !== undefined && schema !== '' ? schema : this.entry.database
    const qualified = qualifyMysql(target, table)
    const assignments = values.map(item => `${requireIdentifier(item.column, 'column name', quoteMysql)} = ?`).join(', ')
    const where = keys.map(item => `${requireIdentifier(item.column, 'column name', quoteMysql)} <=> ?`).join(' AND ')
    return this.exec(
      `UPDATE ${qualified} SET ${assignments} WHERE ${where}`,
      [...values.map(item => item.value), ...keys.map(item => item.value)],
      target,
    )
  }

  async deleteRow(schema: string | undefined, table: string, keys: RowKey[]): Promise<QueryResult> {
    if (keys.length === 0) throw new Error('delete requires a row key')
    const target = schema !== undefined && schema !== '' ? schema : this.entry.database
    const qualified = qualifyMysql(target, table)
    const where = keys.map(item => `${requireIdentifier(item.column, 'column name', quoteMysql)} <=> ?`).join(' AND ')
    return this.exec(`DELETE FROM ${qualified} WHERE ${where}`, keys.map(item => item.value), target)
  }
}

/** Build the WHERE clause for a table read (searches match every textual column). */
function buildFilter(query: RowQuery, columns: ColumnInfo[]): { where: string; params: unknown[] } {
  if (query.mode === 'search') {
    const term = query.term ?? ''
    if (term === '') return { where: '', params: [] }
    const target = columns.filter(column => isTextual(column.type))
    const chosen = target.length > 0 ? target : columns
    const clauses = chosen.map(column => `${quoteMysql(column.name)} LIKE ?`)
    return { where: ` WHERE (${clauses.join(' OR ')})`, params: chosen.map(() => `%${term}%`) }
  }
  if (query.condition !== undefined && query.condition.trim() !== '') {
    assertSingleStatement(`SELECT 1 WHERE ${query.condition}`)
    return { where: ` WHERE (${query.condition})`, params: [] }
  }
  return { where: '', params: [] }
}

/** Whether a MySQL column type is textual enough for a LIKE search. */
function isTextual(type: string): boolean {
  return /char|text|enum|set|json|blob|binary/i.test(type)
}

/** Project one raw MySQL row onto the wire shape. */
function projectRow(row: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(row)) out[key] = toWireValue(value)
  return out
}

/** Coerce a value to a non-empty string, or undefined. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Human-readable MySQL error, keeping the engine's own error code visible. */
function describeMysqlError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown; errno?: unknown; sqlMessage?: unknown; message?: unknown }
    const code = typeof record.code === 'string' ? record.code : undefined
    const sqlMessage = typeof record.sqlMessage === 'string' ? record.sqlMessage : undefined
    if (sqlMessage !== undefined) return code === undefined ? sqlMessage : `${sqlMessage} (${code})`
    if (typeof record.message === 'string') return code === undefined ? record.message : `${record.message} (${code})`
  }
  return error instanceof Error ? error.message : String(error)
}
