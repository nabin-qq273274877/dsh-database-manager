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
import { assertSingleStatement, buildSearchWhere, looksReadOnly, pushDownLimit, qualifyMysql, quoteMysql, requireIdentifier, toWireValue } from '../sql-util.ts'
import { identifier, normalizeDefault, normalizeType } from '../sql-schema.ts'
import type { ColumnSpec, RowKey, RowQuery, RowValue, SqlDriver, TableListOptions } from './types.ts'

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
      // No default schema on the pool: a connection bound to one database
      // cannot see the others, and the browser must list every database. Each
      // statement qualifies its schema (or issues USE) instead.
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

  /**
   * The schema an operation applies to.
   *
   * Required rather than defaulted: this data source no longer stores a default
   * schema, precisely so the browser can list every database. Silently falling
   * back to "the first one" would run a statement against a schema the user
   * never chose, which is the kind of mistake that loses data.
   */
  private requireSchema(schema: string | undefined): string {
    const target = schema !== undefined && schema !== '' ? schema : undefined
    if (target === undefined) {
      throw new Error('a schema is required for this operation — pick a database in the browser first')
    }
    requireIdentifier(target, 'schema name', quoteMysql)
    return target
  }

  async tables(schema?: string, options?: TableListOptions): Promise<TableInfo[]> {
    const target = this.requireSchema(schema)
    const wantStats = options?.stats === true
    // The statistics columns are a wide, cheap read from information_schema, but
    // the tree calls this on every expand and only needs names — so they are
    // requested only when the overview pane asks for them.
    const [rows] = await (await this.open()).query({
      sql: wantStats
        ? 'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS rows_count, TABLE_COMMENT AS comment, ' +
          'ENGINE AS engine, TABLE_COLLATION AS collation, DATA_LENGTH AS data_bytes, INDEX_LENGTH AS index_bytes ' +
          'FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME'
        : 'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_COMMENT AS comment ' +
          'FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME',
      values: [target],
    })
    const list = Array.isArray(rows) ? rows : []
    return list.map(row => {
      const record = row as Record<string, unknown>
      const type = String(record['type'] ?? '')
      const comment = toWireValue(record['comment'])
      const rowCount = toWireValue(record['rows_count'])
      const engine = toWireValue(record['engine'])
      const collation = toWireValue(record['collation'])
      // DATA_LENGTH and INDEX_LENGTH are the engine's own byte figures, so this
      // costs nothing extra to read. A view reports NULL for both, which is why
      // the sum is only emitted when at least one of them is a number —
      // otherwise a view would be shown as 0 bytes.
      const dataBytes = toWireValue(record['data_bytes'])
      const indexBytes = toWireValue(record['index_bytes'])
      const size =
        typeof dataBytes === 'number' || typeof indexBytes === 'number'
          ? (typeof dataBytes === 'number' ? dataBytes : 0) + (typeof indexBytes === 'number' ? indexBytes : 0)
          : undefined
      return {
        name: String(record['name'] ?? ''),
        type: type.includes('VIEW') ? 'view' : 'table',
        ...(typeof rowCount === 'number' ? { rows: rowCount } : {}),
        ...(size === undefined ? {} : { size }),
        ...(typeof comment === 'string' && comment !== '' ? { comment } : {}),
        ...(typeof engine === 'string' && engine !== '' ? { engine } : {}),
        ...(typeof collation === 'string' && collation !== '' ? { collation } : {}),
      } satisfies TableInfo
    })
  }

  async columns(schema: string | undefined, table: string): Promise<ColumnInfo[]> {
    const target = this.requireSchema(schema)
    requireIdentifier(table, 'table name', quoteMysql)
    const [rows] = await (await this.open()).query({
      sql:
        'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt, ' +
        'COLUMN_KEY AS col_key, COLUMN_COMMENT AS comment, EXTRA AS extra ' +
        'FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      values: [target, table],
    })
    // The primary key's column order comes from STATISTICS, not from COLUMNS:
    // a composite key's order decides which leading subsets an index can serve,
    // and `COLUMN_KEY = 'PRI'` says only that a column takes part in it.
    const [keyRows] = await (await this.open()).query({
      sql:
        'SELECT COLUMN_NAME AS name, SEQ_IN_INDEX AS seq FROM information_schema.STATISTICS ' +
        "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX",
      values: [target, table],
    })
    const keyPositions = new Map<string, number>()
    if (Array.isArray(keyRows)) {
      for (const row of keyRows) {
        const record = row as Record<string, unknown>
        const name = String(record['name'] ?? '')
        if (name !== '') keyPositions.set(name, Number(record['seq'] ?? 0))
      }
    }

    const list = Array.isArray(rows) ? rows : []
    return list.map(row => {
      const record = row as Record<string, unknown>
      const name = String(record['name'] ?? '')
      const dflt = toWireValue(record['dflt'])
      const comment = toWireValue(record['comment'])
      const extra = toWireValue(record['extra'])
      const position = keyPositions.get(name)
      const options = readEnumOptions(String(record['type'] ?? ''))
      return {
        name,
        type: String(record['type'] ?? ''),
        nullable: String(record['nullable'] ?? 'YES').toUpperCase() === 'YES',
        ...(dflt === null ? {} : { defaultValue: String(dflt) }),
        key: String(record['col_key'] ?? ''),
        ...(typeof comment === 'string' && comment !== '' ? { comment } : {}),
        ...(typeof extra === 'string' && extra !== '' ? { extra } : {}),
        ...(position === undefined ? {} : { primaryKeyPosition: position }),
        ...(options === undefined ? {} : { options }),
        // `EXTRA` is where MySQL says a column is computed. A generated column
        // cannot be inserted into or updated, so the 插入 and 浏览 surfaces must
        // not offer it as an editable input.
        ...(typeof extra === 'string' && /GENERATED/i.test(extra) ? { generated: true } : {}),
      } satisfies ColumnInfo
    })
  }

  async indexes(schema: string | undefined, table: string): Promise<IndexInfo[]> {
    const target = this.requireSchema(schema)
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
      // MySQL reports the primary key as an ordinary index named PRIMARY. It
      // cannot be dropped as an index — that means dropping the key — so the
      // flag has to reach the browser.
      ...(name === 'PRIMARY' ? { primary: true } : {}),
    }) satisfies IndexInfo)
  }

  async rows(query: RowQuery): Promise<TablePage> {
    const schema = this.requireSchema(query.schema)
    const columns = await this.columns(schema, query.table)
    if (columns.length === 0) throw new Error(`no such table: ${schema}.${query.table}`)
    const qualified = qualifyMysql(schema, query.table)
    const pages = await this.rowsInternal(schema, qualified, query, columns, false)
    return pages
  }

  /**
   * One page of rows.
   *
   * @param forEditor - true when the caller will turn these rows into edits, so
   *   rows must be identifiable. See the primary-key caveat below.
   */
  private async rowsInternal(
    schema: string,
    qualified: string,
    query: RowQuery,
    columns: ColumnInfo[],
    forEditor: boolean,
  ): Promise<TablePage> {
    void forEditor
    const known = new Set(columns.map(column => column.name.toLowerCase()))
    const { where, params } = buildFilter(query, columns, known)

    const [countRows] = await (await this.open()).query({
      sql: `SELECT COUNT(*) AS n FROM ${qualified}${where}`,
      values: params,
    })
    const first = Array.isArray(countRows) ? (countRows[0] as Record<string, unknown> | undefined) : undefined
    const total = Number(toWireValue(first?.['n'] ?? 0) ?? 0)

    const order = buildOrder(query, columns)
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
    // Push the cap into the statement so the server stops sending rows, rather
    // than reading the whole result set and slicing it here. `pushDownLimit`
    // returns undefined for the shapes it cannot rewrite safely (SHOW,
    // DESCRIBE, EXPLAIN, a statement with its own LIMIT), which then run as
    // written and are still capped on this side.
    //
    // One row PAST the cap is requested on purpose: `shape` decides `truncated`
    // by comparing the row count against the cap, so a statement capped at
    // exactly `limit` rows would report "complete" while rows were being
    // withheld. The extra row is what proves there was more.
    const pushed = limit >= 1 ? pushDownLimit(sql, limit + 1) : undefined
    return this.runQuery(pushed ?? sql, params, limit, schema)
  }

  async exec(sql: string, params: unknown[], schema?: string): Promise<QueryResult> {
    assertSingleStatement(sql)
    if (schema !== undefined && schema !== '') requireIdentifier(schema, 'schema name', quoteMysql)
    return this.runQuery(sql, params, 0, schema)
  }

  /**
   * One statement round trip, optionally scoped to a schema.
   *
   * The schema is applied with `USE` on the SAME pooled connection that runs the
   * statement. Issuing `USE` separately and hoping for the same connection would
   * be wrong twice over: the statement could land on a different connection, and
   * the schema choice would leak into whatever else later reuses that one.
   */
  private async runQuery(sql: string, params: unknown[], limit: number, schema?: string): Promise<QueryResult> {
    const pool = await this.open()
    const connection = await pool.getConnection()
    try {
      if (schema !== undefined && schema !== '') await connection.query({ sql: `USE ${quoteMysql(schema)}` })
      const started = Date.now()
      const [result, fields] = await connection.query({ sql, values: params })
      return this.shape(result, fields, limit, Date.now() - started)
    } finally {
      // Reset the session before handing the connection back.
      //
      // `USE` changes the connection's default database for GOOD: the pool
      // reuses connections, so without this reset the next statement to borrow
      // this one would run against the database a PREVIOUS statement chose.
      // Measured: after scoping a statement to db_b, an unscoped
      // `SELECT DATABASE()` on the same pooled connection answered db_b. That is
      // a silent-wrong-database bug — exactly what removing the default-schema
      // field was meant to eliminate — so the reset is required, not an
      // optimisation.
      //
      // Note the reset must NOT `return`: a `return` inside `finally` would
      // discard the value (or the exception) the try block produced.
      try {
        await connection.query({ sql: 'USE `information_schema`' })
        connection.release()
      } catch {
        // A failed reset means the session state is unknown; dropping the
        // connection is safer than returning it to the pool polluted.
        connection.destroy()
      }
    }
  }

  /** Shape one driver reply into the wire result. */
  private shape(result: unknown, fields: unknown, limit: number, durationMs: number): QueryResult {
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
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    const names = values.map(item => requireIdentifier(item.column, 'column name', quoteMysql)).join(', ')
    const placeholders = values.map(() => '?').join(', ')
    return this.exec(`INSERT INTO ${qualified} (${names}) VALUES (${placeholders})`, values.map(item => item.value), target)
  }

  /**
   * Insert several rows as ONE multi-row statement.
   *
   * MySQL makes this cheap: a single `INSERT … VALUES (…),(…)` is one statement,
   * one round trip and one implicit transaction, so a large CSV import does not
   * pay per-row latency. Rows are chunked, because `max_allowed_packet` caps the
   * statement size and one packet per 500 rows is well inside every default.
   *
   * Column order is taken from the FIRST row and enforced for the rest: a batch
   * naming different columns per row cannot be one statement, and filling the
   * gaps with NULL would be a data-corruption bug rather than an error.
   */
  async insertRows(schema: string | undefined, table: string, rows: RowValue[][]): Promise<QueryResult> {
    if (rows.length === 0) throw new Error('insert requires at least one row')
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    const columns = rows[0]!.map(item => item.column)
    for (const row of rows) {
      if (row.length !== columns.length || row.some((item, index) => item.column !== columns[index])) {
        throw new Error('every row in one insert must name the same columns, in the same order')
      }
    }
    const names = columns.map(name => requireIdentifier(name, 'column name', quoteMysql)).join(', ')
    const started = Date.now()
    let affected = 0
    const CHUNK = 500
    for (let at = 0; at < rows.length; at += CHUNK) {
      const chunk = rows.slice(at, at + CHUNK)
      const placeholders = chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')
      const params = chunk.flatMap(row => row.map(item => item.value))
      const result = await this.runQuery(`INSERT INTO ${qualified} (${names}) VALUES ${placeholders}`, params, 0, target)
      affected += result.affected
    }
    return { columns: [], rows: [], affected, durationMs: Date.now() - started, write: true, truncated: false }
  }

  async updateRow(schema: string | undefined, table: string, values: RowValue[], keys: RowKey[]): Promise<QueryResult> {
    if (values.length === 0) throw new Error('update requires at least one column value')
    if (keys.length === 0) throw new Error('update requires a row key')
    const target = this.requireSchema(schema)
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
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    const where = keys.map(item => `${requireIdentifier(item.column, 'column name', quoteMysql)} <=> ?`).join(' AND ')
    return this.exec(`DELETE FROM ${qualified} WHERE ${where}`, keys.map(item => item.value), target)
  }

  /**
   * Delete several rows in one transaction.
   *
   * One statement per key set rather than a single `IN (…)`: a key may be
   * composite, and a composite key's tuple cannot be expressed as an `IN` over
   * one column. Wrapped in a transaction so a mid-list failure leaves the table
   * as it was, rather than half-deleted with no record of where it stopped.
   */
  async deleteRows(schema: string | undefined, table: string, keySets: RowKey[][]): Promise<QueryResult> {
    if (keySets.length === 0) throw new Error('delete requires at least one row key')
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    const started = Date.now()
    const pool = await this.open()
    const connection = await pool.getConnection()
    try {
      await connection.query({ sql: `USE ${quoteMysql(target)}` })
      await connection.query({ sql: 'START TRANSACTION' })
      let affected = 0
      try {
        for (const keys of keySets) {
          if (keys.length === 0) throw new Error('delete requires a row key')
          const where = keys.map(item => `${requireIdentifier(item.column, 'column name', quoteMysql)} <=> ?`).join(' AND ')
          const [result] = await connection.query({
            sql: `DELETE FROM ${qualified} WHERE ${where}`,
            values: keys.map(item => item.value),
          })
          const summary = (result ?? {}) as Record<string, unknown>
          affected += Number(toWireValue(summary['affectedRows'] ?? 0) ?? 0)
        }
        await connection.query({ sql: 'COMMIT' })
      } catch (error) {
        try {
          await connection.query({ sql: 'ROLLBACK' })
        } catch {
          /* the transaction is already gone */
        }
        throw error
      }
      return { columns: [], rows: [], affected, durationMs: Date.now() - started, write: true, truncated: false }
    } finally {
      // Same reset-on-release rule as runQuery: a pooled connection must not
      // carry the previous statement's default database.
      try {
        await connection.query({ sql: 'USE `information_schema`' })
        connection.release()
      } catch {
        connection.destroy()
      }
    }
  }

  /** How many distinct non-NULL values a column holds. */
  async distinctCount(schema: string | undefined, table: string, column: string): Promise<number> {
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    const quoted = requireIdentifier(column, 'column name', quoteMysql)
    const [rows] = await (await this.open()).query({ sql: `SELECT COUNT(DISTINCT ${quoted}) AS n FROM ${qualified}` })
    const first = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined
    return Number(toWireValue(first?.['n'] ?? 0) ?? 0)
  }

  // ---- schema editing ----------------------------------------------------

  /** Add a column. */
  async addColumn(schema: string | undefined, table: string, spec: ColumnSpec): Promise<QueryResult> {
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    return this.exec(`ALTER TABLE ${qualified} ADD COLUMN ${renderMysqlColumn(spec)}`, [], target)
  }

  /**
   * Change an existing column.
   *
   * `MODIFY COLUMN` rewrites the whole column definition, so the spec has to
   * carry every attribute that must survive — which is why the 结构 tab loads
   * the column first and submits what it read back, rather than sending only the
   * changed field. `CHANGE COLUMN` is used when the name also changes.
   *
   * A primary-key column's `NOT NULL` and its position in the key are added
   * here rather than trusted from the spec: MySQL rejects a nullable primary-key
   * column, and dropping one out of a composite key by accident would change
   * which rows the key can identify.
   */
  async alterColumn(schema: string | undefined, table: string, spec: ColumnSpec, options: { rename?: string } = {}): Promise<QueryResult> {
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    const existing = (await this.columns(target, table)).find(column => column.name === spec.name)
    if (existing === undefined) throw new Error(`no such column: ${spec.name}`)
    const definition = renderMysqlColumn(spec, { generated: existing.generated, extra: existing.extra })

    if (options.rename !== undefined && options.rename !== spec.name) {
      return this.exec(
        `ALTER TABLE ${qualified} CHANGE COLUMN ${requireIdentifier(spec.name, 'column name', quoteMysql)} ` +
        `${requireIdentifier(options.rename, 'column name', quoteMysql)} ${definition}`,
        [],
        target,
      )
    }
    return this.exec(
      `ALTER TABLE ${qualified} MODIFY COLUMN ${requireIdentifier(spec.name, 'column name', quoteMysql)} ${definition}`,
      [],
      target,
    )
  }

  /**
   * Drop a column.
   *
   * MySQL drops the column out of every index that covers it by itself, and
   * REFUSES the statement when the column is the only one left in an index
   * ("cannot drop column … needed in a foreign key constraint" / "check that
   * column exists"). That refusal is the right outcome and is passed through
   * unchanged, rather than pre-empted here with a guess about which index MySQL
   * would have tolerated.
   */
  async dropColumn(schema: string | undefined, table: string, column: string): Promise<QueryResult> {
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    const columns = await this.columns(target, table)
    if (columns.length <= 1) throw new Error('a table must keep at least one column')
    return this.exec(`ALTER TABLE ${qualified} DROP COLUMN ${requireIdentifier(column, 'column name', quoteMysql)}`, [], target)
  }

  /**
   * Replace the table's primary key.
   *
   * Two statements in one transaction: MySQL will not accept a table with two
   * primary keys even momentarily, so the old one is dropped first. The
   * transaction is what keeps the table key-less for anything but this caller —
   * without it, a failure between the two statements would leave a table with no
   * primary key at all.
   *
   * Every key column is made NOT NULL first, because that is a precondition
   * MySQL enforces (error 1171) and a nullable column in a key is usually a
   * leftover from a table that never had one.
   */
  async setPrimaryKey(schema: string | undefined, table: string, columns: string[]): Promise<QueryResult> {
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    const existing = await this.columns(target, table)
    const known = new Map(existing.map(column => [column.name.toLowerCase(), column]))
    for (const name of columns) {
      if (!known.has(name.toLowerCase())) throw new Error(`no such column: ${name}`)
    }

    const statements: string[] = []
    // MySQL's AUTO_INCREMENT column has to be a key. Dropping the key before
    // setting the new one would be rejected for a table whose auto-increment
    // column is not in the new key, so the column's auto-increment is removed
    // first and the caller is told by the engine if it wanted otherwise.
    for (const column of existing) {
      if (column.extra !== undefined && /auto_increment/i.test(column.extra) && !columns.includes(column.name)) {
        statements.push(
          `ALTER TABLE ${qualified} MODIFY COLUMN ${requireIdentifier(column.name, 'column name', quoteMysql)} ` +
          `${renderMysqlColumn(toSpec(column))}`,
        )
      }
    }
    for (const name of columns) {
      const column = known.get(name.toLowerCase())!
      if (!column.nullable) continue
      statements.push(`ALTER TABLE ${qualified} MODIFY COLUMN ${renderMysqlColumn({ ...toSpec(column), nullable: false })}`)
    }
    if (existing.some(column => column.key === 'PRI')) statements.push(`ALTER TABLE ${qualified} DROP PRIMARY KEY`)
    if (columns.length > 0) {
      statements.push(`ALTER TABLE ${qualified} ADD PRIMARY KEY (${columns.map(name => requireIdentifier(name, 'column name', quoteMysql)).join(', ')})`)
    }
    if (statements.length === 0) return { columns: [], rows: [], affected: 0, durationMs: 0, write: true, truncated: false }
    return this.execTransaction(statements, target)
  }

  /** Create an index on one or more existing columns. */
  async createIndex(schema: string | undefined, table: string, spec: { name: string; columns: string[]; unique: boolean }): Promise<QueryResult> {
    if (spec.columns.length === 0) throw new Error('an index needs at least one column')
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    const columns = await this.columns(target, table)
    const known = new Map(columns.map(column => [column.name.toLowerCase(), column.name]))
    const resolved = spec.columns.map(name => {
      const found = known.get(name.toLowerCase())
      if (found === undefined) throw new Error(`no such column: ${name}`)
      return found
    })
    const name = requireIdentifier(spec.name, 'index name', quoteMysql)
    return this.exec(
      `ALTER TABLE ${qualified} ADD ${spec.unique ? 'UNIQUE ' : ''}INDEX ${name} (${resolved.map(column => quoteMysql(column)).join(', ')})`,
      [],
      target,
    )
  }

  /**
   * Drop an index.
   *
   * Refuses `PRIMARY`: that index is the table's primary key, and MySQL's own
   * message for `DROP INDEX PRIMARY` ("check that column/key exists") does not
   * say so. Dropping the key is a separate action the 结构 tab offers.
   */
  async dropIndex(schema: string | undefined, table: string, name: string): Promise<QueryResult> {
    if (name.toUpperCase() === 'PRIMARY') {
      throw new Error('PRIMARY is the table\'s primary key; change the key instead of dropping it as an index')
    }
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    return this.exec(`ALTER TABLE ${qualified} DROP INDEX ${requireIdentifier(name, 'index name', quoteMysql)}`, [], target)
  }

  /**
   * Run several statements on one pooled connection, scoped to `schema`.
   *
   * Needed wherever a schema change is not expressible as one statement — a
   * primary-key replacement is the case here. MySQL's DDL is not transactional
   * (each `ALTER TABLE` commits itself), so the statements are ordered so that
   * the intermediate state is the least harmful one: dropped rather than
   * duplicated, since the engine refuses a second primary key outright.
   */
  private async execTransaction(statements: string[], schema: string): Promise<QueryResult> {
    const pool = await this.open()
    const connection = await pool.getConnection()
    const started = Date.now()
    try {
      await connection.query({ sql: `USE ${quoteMysql(schema)}` })
      for (const statement of statements) await connection.query({ sql: statement })
      return { columns: [], rows: [], affected: 0, durationMs: Date.now() - started, write: true, truncated: false }
    } finally {
      try {
        await connection.query({ sql: 'USE `information_schema`' })
        connection.release()
      } catch {
        connection.destroy()
      }
    }
  }

  /**
   * Empty a table, keeping its schema.
   *
   * TRUNCATE rather than DELETE: it is a metadata operation that drops and
   * recreates the table's data pages instead of removing rows one at a time,
   * which is the difference between instant and minutes on a large InnoDB
   * table. It also resets AUTO_INCREMENT, which is the behaviour users expect
   * from the phpMyAdmin 清空 button this mirrors.
   *
   * A view has no rows of its own, so it is refused rather than reported as
   * "0 rows affected".
   */
  async truncateTable(schema: string | undefined, table: string, isView = false): Promise<QueryResult> {
    if (isView) throw new Error('a view has no rows of its own to delete')
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    return this.exec(`TRUNCATE TABLE ${qualified}`, [], target)
  }

  /**
   * Drop a table or a view.
   *
   * The object's kind picks the statement, since MySQL rejects `DROP TABLE` on
   * a view ("'db.v' is a view").
   */
  async dropTable(schema: string | undefined, table: string, isView = false): Promise<QueryResult> {
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    return this.exec(`DROP ${isView ? 'VIEW' : 'TABLE'} ${qualified}`, [], target)
  }
}

/** The ORDER BY clause for one read, with every column checked against the table. */
function buildOrder(query: RowQuery, columns: ColumnInfo[]): string {
  const byName = new Map(columns.map(column => [column.name.toLowerCase(), column.name]))
  const direction = query.orderDir === 'desc' ? 'DESC' : 'ASC'
  if (query.orderByColumns !== undefined && query.orderByColumns.length > 0) {
    const resolved = query.orderByColumns.map(name => byName.get(name.toLowerCase()))
    if (resolved.some(name => name === undefined)) return ''
    return ` ORDER BY ${resolved.map(name => `${quoteMysql(name!)} ${direction}`).join(', ')}`
  }
  if (query.orderBy === undefined) return ''
  const resolved = byName.get(query.orderBy.toLowerCase())
  if (resolved === undefined) return ''
  return ` ORDER BY ${quoteMysql(resolved)} ${direction}`
}

/** Build the WHERE clause for a table read. */
function buildFilter(query: RowQuery, columns: ColumnInfo[], known: Set<string>): { where: string; params: unknown[] } {
  // The structured form (the 搜索 tab) wins when present: it is what the user
  // arranged, and mixing it with the free-text box would apply two filters.
  if (query.filters !== undefined && query.filters.length > 0) {
    return buildSearchWhere(query.filters, query.filterJoin === 'or' ? 'or' : 'and', quoteMysql, known)
  }
  if (query.mode === 'search') {
    const term = query.term ?? ''
    if (term === '') return { where: '', params: [] }
    const target = columns.filter(column => isTextual(column.type))
    const chosen = target.length > 0 ? target : columns
    // `%`/`_` in the term are characters to find, not wildcards, so they are
    // escaped and the clause declares the escape character.
    const pattern = `%${term.replace(/[\\%_]/g, match => `\\${match}`)}%`
    const clauses = chosen.map(column => `${quoteMysql(column.name)} LIKE ? ESCAPE '\\\\'`)
    return { where: ` WHERE (${clauses.join(' OR ')})`, params: chosen.map(() => pattern) }
  }
  if (query.condition !== undefined && query.condition.trim() !== '') {
    assertSingleStatement(`SELECT 1 WHERE ${query.condition}`)
    return { where: ` WHERE (${query.condition})`, params: [] }
  }
  return { where: '', params: [] }
}

/**
 * The enum/set members of a declared type, or undefined for every other type.
 *
 * Read on the host because the members come from MySQL's own type text with
 * MySQL's own quoting rules; a browser-side regex on the type string would have
 * to re-implement them.
 */
function readEnumOptions(type: string): string[] | undefined {
  const match = /^(enum|set)\s*\(([\s\S]*)\)$/i.exec(type.trim())
  if (match === null) return undefined
  const members: string[] = []
  const body = match[2]!
  let i = 0
  while (i < body.length) {
    if (body[i] === "'") {
      let j = i + 1
      let value = ''
      while (j < body.length) {
        if (body[j] === '\\') { value += body[j + 1] ?? ''; j += 2; continue }
        if (body[j] === "'") {
          if (body[j + 1] === "'") { value += "'"; j += 2; continue }
          break
        }
        value += body[j]
        j++
      }
      members.push(value)
      i = j + 1
      continue
    }
    i++
  }
  return members
}

/** Render a {@link ColumnSpec} as a MySQL column definition. */
function renderMysqlColumn(spec: ColumnSpec, carry: { generated?: boolean; extra?: string } = {}): string {
  const brand: string[] = [requireIdentifier(spec.name, 'column name', quoteMysql)]
  const declared = spec.type.trim() === '' ? '' : normalizeType(spec.type, 'mysql')
  if (declared === '') throw new Error('a MySQL column needs a type')
  brand.push(declared)

  // A generated column's expression lives in EXTRA. Rewriting the column
  // without it would turn a computed column into an ordinary one and lose the
  // expression, so the whole EXTRA tail is carried through verbatim.
  if (carry.generated === true) {
    if (carry.extra === undefined || carry.extra.trim() === '') {
      throw new Error('a generated column cannot be modified: its expression is not available')
    }
    brand.push(carry.extra.replace(/DEFAULT_GENERATED\s*/i, '').trim())
    return brand.join(' ')
  }

  brand.push(spec.primaryKeyPosition === undefined && spec.nullable ? 'NULL' : 'NOT NULL')
  if (spec.defaultValue !== undefined) {
    const value = normalizeDefault(spec.defaultValue, 'mysql')
    if (value !== undefined) brand.push(`DEFAULT ${value}`)
  }
  if (spec.autoIncrement === true) brand.push('AUTO_INCREMENT')
  if (spec.unique === true) brand.push('UNIQUE')
  if (spec.comment !== undefined && spec.comment !== '') {
    if (spec.comment.includes('\\')) throw new Error('a column comment cannot contain a backslash')
    brand.push(`COMMENT '${spec.comment.replace(/'/g, "''")}'`)
  }
  return brand.join(' ')
}

/** Project a {@link ColumnInfo} back onto a {@link ColumnSpec} for a rewrite. */
function toSpec(column: ColumnInfo): ColumnSpec {
  return {
    name: column.name,
    type: column.type,
    nullable: column.nullable,
    ...(column.defaultValue === undefined ? {} : { defaultValue: column.defaultValue }),
    ...(column.primaryKeyPosition === undefined ? {} : { primaryKeyPosition: column.primaryKeyPosition }),
    ...(column.extra !== undefined && /auto_increment/i.test(column.extra) ? { autoIncrement: true } : {}),
    ...(column.comment === undefined ? {} : { comment: column.comment }),
  }
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
