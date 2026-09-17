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
import { assertSingleStatement, buildSearchWhere, isTransactionControl, likeEscapeClause, looksReadOnly, pushDownLimit, qualifyMysql, quoteMysql, requireIdentifier, toWireValue } from '../sql-util.ts'
import { identifier, normalizeDefault, normalizeType } from '../sql-schema.ts'
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
  TableIndexSpec,
  TableListOptions,
  TableOptions,
} from './types.ts'

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
   * Which maintenance operations MySQL supports.
   *
   * All four have statements. What differs is whether they DO anything: `repair`
   * only applies to MyISAM, and `optimize` on InnoDB is rewritten by the server into
   * a recreate + analyze. Both are still offered, because both are legal statements
   * whose answer the user should see — see {@link maintain}.
   */
  maintenanceSupport(): MaintenanceOp[] {
    return ['check', 'optimize', 'repair', 'analyze']
  }

  /**
   * Run one maintenance statement per table.
   *
   * One statement per table rather than one covering all of them: `CHECK TABLE a, b`
   * is legal, but a per-table result is what lets the panel attribute a failure or a
   * note to the table it belongs to. The statements are cheap metadata operations,
   * so the extra round trips are not the cost that matters.
   *
   * The server's own message lines are returned verbatim. They are the answer:
   * `optimize` on InnoDB reports "Table does not support optimize, doing recreate +
   * analyze instead" and `repair` on InnoDB reports that the engine does not support
   * repair, and neither is an error — a panel that summarised them away would claim
   * work that did not happen.
   */
  async maintain(schema: string | undefined, tables: string[], op: MaintenanceOp): Promise<MaintenanceResult[]> {
    const target = this.requireSchema(schema)
    if (tables.length === 0) throw new Error('maintenance needs at least one table')
    const statement = op.toUpperCase()
    if (!/^(CHECK|OPTIMIZE|REPAIR|ANALYZE)$/.test(statement)) throw new Error(`unsupported maintenance operation: ${op}`)

    const results: MaintenanceResult[] = []
    for (const table of tables) {
      const qualified = qualifyMysql(target, table)
      const result = await this.exec(`${statement} TABLE ${qualified}`, [], target)
      /*
       * The columns these statements return, in order:
       *
       *   Table | Op | Msg_type | Msg_text
       *
       * FOUR columns, not three — and the order matters here. An earlier version read
       * three (Table, Msg_type, Msg_text), so it took `Op` for the message type and
       * `Msg_type` for the message text: the engine's actual explanation was dropped
       * and every entry came out as "... repair: note" with no reason. That is exactly
       * the information this method exists to carry.
       *
       * The header row is present in mysql2's result, so it is skipped by name rather
       * than by position: a future server that reorders the columns would otherwise
       * silently mislead again.
       */
      const messages: string[] = []
      let ok = true
      for (const row of result.rows) {
        const first = row[0] === undefined ? '' : String(row[0])
        // The header row is not a result.
        if (first.toLowerCase() === 'table') continue
        const type = row[2] === undefined ? '' : String(row[2])
        const text = row[3] === undefined ? '' : String(row[3])
        messages.push(`${first} ${type}: ${text}`.trim())
        if (type.toLowerCase() === 'error') ok = false
      }
      results.push({ op, ok, messages })
    }
    return results
  }

  /**
   * Run one database-level operation.
   *
   * Every one of these is DDL on a whole database, so the statements are built from
   * VALIDATED identifiers only — a database name cannot be parameter-bound in any of
   * these forms, which is exactly why {@link requireIdentifier} gates it.
   *
   * `drop` is the only irreversible one, and it is not special-cased here: the panel
   * confirms it, and this layer's job is to do what it was told.
   */
  /**
   * Run one database-level operation.
   *
   * Every one of these is DDL on a whole database, so the statements are built from
   * VALIDATED identifiers only — a database name cannot be parameter-bound in any of
   * these forms, which is exactly why {@link requireIdentifier} gates it.
   *
   * `rename` is a special case worth knowing about: MySQL has NO `RENAME DATABASE`
   * (it was removed in 5.1 because it could corrupt data). Renaming a database means
   * creating the new one and moving every table into it with
   * `RENAME TABLE old.t TO new.t`, which is what this does — one `RENAME TABLE`
   * statement carrying all the moves, so the server does it as a single atomic
   * operation rather than one statement per table.
   *
   * `copy` creates the target and runs `CREATE TABLE new.t LIKE old.t` plus, when
   * asked, `INSERT INTO new.t SELECT * FROM old.t`. That copies the structure and
   * the rows; it does NOT copy triggers or views, which have no `LIKE` form and
   * whose recreation is not something this panel should guess at.
   */
  async databaseOperation(op: DatabaseOp, name: string, options: DatabaseOperationOptions = {}): Promise<QueryResult> {
    const started = Date.now()
    const target = requireIdentifier(name, 'database name', quoteMysql)

    if (op === 'create') {
      const charset = options.charset === undefined || options.charset === '' ? '' : ` CHARACTER SET ${requireCharset(options.charset)}`
      const collate = options.collate === undefined || options.collate === '' ? '' : ` COLLATE ${requireCollate(options.collate)}`
      return this.exec(`CREATE DATABASE ${target}${charset}${collate}`, [])
    }

    if (op === 'drop') return this.exec(`DROP DATABASE ${target}`, [])

    if (op === 'charset') {
      if (options.charset === undefined || options.charset === '') throw new Error('a character set is required')
      const collate = options.collate === undefined || options.collate === '' ? '' : ` COLLATE ${requireCollate(options.collate)}`
      return this.exec(`ALTER DATABASE ${target} CHARACTER SET ${requireCharset(options.charset)}${collate}`, [])
    }

    const from = options.from
    if (from === undefined || from === '') throw new Error(`"${op}" needs the source database`)
    const source = requireIdentifier(from, 'database name', quoteMysql)
    if (source === name) throw new Error('the source and target database are the same')

    if (op === 'rename') {
      const tables = await this.tableNames(from)
      // The target must exist before its tables can be moved into it.
      await this.exec(`CREATE DATABASE ${target}`, [])
      if (tables.length > 0) {
        // ONE statement for every move, so the server applies it as one atomic
        // operation instead of leaving a half-moved database if a later table fails.
        const moves = tables
          .map(table => `${qualifyMysql(from, table.name)} TO ${qualifyMysql(name, table.name)}`)
          .join(', ')
        await this.exec(`RENAME TABLE ${moves}`, [])
      }
      /*
       * Drop the source, in BOTH branches.
       *
       * An earlier version returned early for a database with no tables, which meant
       * the empty original was never dropped: renaming an EMPTY database produced TWO
       * databases, the new one and the old shell. That is exactly the case a
       * freshly-created database hits, so it was the common path in practice rather
       * than an edge case — measured, not assumed.
       *
       * Leaving it behind would make 重命名 mean "copy the name and keep both", which
       * is not a rename.
       */
      await this.exec(`DROP DATABASE ${source}`, [])
      return { columns: [], rows: [], affected: tables.length, durationMs: Date.now() - started, write: true, truncated: false }
    }

    if (op === 'copy') {
      const tables = await this.tableNames(from)
      await this.exec(`CREATE DATABASE ${target}`, [])
      for (const table of tables) {
        // A view cannot be copied this way: `CREATE TABLE … LIKE` on a view creates
        // an ordinary empty TABLE, which would silently turn a view into something it
        // is not. Views are reported as skipped rather than mis-created.
        if (table.type === 'view') continue
        await this.exec(`CREATE TABLE ${qualifyMysql(name, table.name)} LIKE ${qualifyMysql(from, table.name)}`, [])
        if (options.includeData === true) {
          await this.exec(`INSERT INTO ${qualifyMysql(name, table.name)} SELECT * FROM ${qualifyMysql(from, table.name)}`, [])
        }
      }
      return { columns: [], rows: [], affected: tables.length, durationMs: Date.now() - started, write: true, truncated: false }
    }

    throw new Error(`unsupported database operation: ${op}`)
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
        /*
         * Without `stats`, the engine / collation / comment are STILL read.
         *
         * They used to be omitted, which meant the overview's 类型 and 排序规则 columns
         * showed nothing for any caller that skipped statistics — and the database
         * overview does exactly that when it only needs names. Those three columns are
         * already in `information_schema.TABLES`, so reading them costs nothing; only
         * the row counts and sizes are worth deferring.
         */
        : 'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_COMMENT AS comment, ' +
          'ENGINE AS engine, TABLE_COLLATION AS collation ' +
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
        'COLUMN_KEY AS col_key, COLUMN_COMMENT AS comment, EXTRA AS extra, COLLATION_NAME AS collation ' +
        'FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      values: [target, table],
    })
    /*
     * The primary key's column order comes from STATISTICS, and whether a key
     * EXISTS comes from COLUMNS. Neither alone is enough:
     *
     * - MySQL RAISES a UNIQUE index to the primary key when a table has none.
     *   Measured: `a INT NOT NULL UNIQUE` reports `COLUMN_KEY = 'PRI'` while
     *   `STATISTICS.INDEX_NAME` is `a` — NO row is named `PRIMARY`. So asking
     *   STATISTICS for `INDEX_NAME = 'PRIMARY'` finds no key at all.
     * - Conversely `COLUMN_KEY` says a column takes part in the key but not
     *   where, and a composite key's order decides which leading subsets an
     *   index can serve.
     *
     * So: COLUMNS decides whether a key exists (and which columns are in it),
     * STATISTICS orders them, and a column missing from STATISTICS as a key
     * column (the promoted case) falls back to its declaration order.
     */
    const primaryColumns = new Set<string>()
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const record = row as Record<string, unknown>
        if (String(record['col_key'] ?? '') !== 'PRI') continue
        const name = String(record['name'] ?? '')
        if (name !== '') primaryColumns.add(name)
      }
    }

    const [keyRows] = await (await this.open()).query({
      sql:
        'SELECT COLUMN_NAME AS name, SEQ_IN_INDEX AS seq FROM information_schema.STATISTICS ' +
        "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX",
      values: [target, table],
    })
    const orderedFromStatistics = new Map<string, number>()
    if (Array.isArray(keyRows)) {
      for (const row of keyRows) {
        const record = row as Record<string, unknown>
        const name = String(record['name'] ?? '')
        if (name !== '') orderedFromStatistics.set(name, Number(record['seq'] ?? 0))
      }
    } else {
      // `rows` is a mysql2 result; keep the reference so the guard below reads
      // naturally even when the driver hands back a non-array.
      void rows
    }

    const list = Array.isArray(rows) ? rows : []
    // Declaration order, as the fallback position for a promoted key.
    const declarationOrder = new Map<string, number>()
    list.forEach((row, index) => {
      const name = String((row as Record<string, unknown>)['name'] ?? '')
      if (name !== '') declarationOrder.set(name, index + 1)
    })

    return list.map(row => {
      const record = row as Record<string, unknown>
      const name = String(record['name'] ?? '')
      const dflt = toWireValue(record['dflt'])
      const comment = toWireValue(record['comment'])
      const extra = toWireValue(record['extra'])
      // The declared collation, so the 结构 tab can show it and a rebuild can carry it.
      const columnCollation = toWireValue(record['collation'])
      const options = readEnumOptions(String(record['type'] ?? ''))
      const inKey = primaryColumns.has(name)
      const position = inKey ? (orderedFromStatistics.get(name) ?? declarationOrder.get(name)) : undefined
      return {
        name,
        type: String(record['type'] ?? ''),
        nullable: String(record['nullable'] ?? 'YES').toUpperCase() === 'YES',
        ...(dflt === null ? {} : { defaultValue: String(dflt) }),
        key: inKey ? 'PRI' : String(record['col_key'] ?? ''),
        ...(typeof comment === 'string' && comment !== '' ? { comment } : {}),
        ...(typeof columnCollation === 'string' && columnCollation !== '' ? { collation: columnCollation } : {}),
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

  /**
   * Whether the table has a primary key at all.
   *
   * Asked through {@link SqlDriver.columns} rather than with a `STATISTICS`
   * query for `INDEX_NAME = 'PRIMARY'`: MySQL's primary key is not always named
   * `PRIMARY` — a UNIQUE index is RAISED to the primary key when the table has
   * none, and then its own name is what `STATISTICS` reports.
   */
  private async hasPrimaryKey(schema: string, table: string): Promise<boolean> {
    return (await this.columns(schema, table)).some(column => column.key === 'PRI')
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
    /*
     * Which index IS the primary key.
     *
     * Usually the one literally named `PRIMARY`, but MySQL also RAISES a UNIQUE
     * index to the primary key when a table has none — measured: a table with
     * `a INT NOT NULL UNIQUE` reports `COLUMN_KEY = 'PRI'` for `a` while the
     * index is named `a`. Flagging only the name `PRIMARY` would then leave the
     * real key droppable as if it were an ordinary unique index, and the panel
     * would offer a "drop index" that silently removes the primary key.
     *
     * Matching on the key's COLUMN LIST rather than on the index's name is what
     * makes both cases work: a single unique index covering exactly the key's
     * columns is the key, whatever it is called.
     */
    const keyColumns = (await this.columns(target, table)).filter(column => column.key === 'PRI').map(column => column.name)
    const isPrimary = (name: string, columns: string[]): boolean => {
      if (name === 'PRIMARY') return true
      if (keyColumns.length === 0 || columns.length !== keyColumns.length) return false
      return columns.every((column, index) => column === keyColumns[index])
    }

    return [...byName.entries()].map(([name, entry]) => {
      const columns = entry.columns.sort((a, b) => a.seq - b.seq).map(item => item.name)
      return {
        name,
        unique: entry.unique,
        columns,
        ...(entry.type === undefined ? {} : { type: entry.type }),
        ...(isPrimary(name, columns) ? { primary: true } : {}),
      } satisfies IndexInfo
    })
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
  /**
   * Create a table from a column list.
   *
   * The definition renderer is the SAME one `addColumn` uses, so a column created
   * here and one added later cannot diverge in how they are rendered — and both go
   * through the same type/default validation.
   *
   * A primary key is emitted as a table-level constraint rather than inline, because
   * a composite key has no inline form; using one shape for both keeps the single- and
   * multi-column cases byte-for-byte the same apart from the column list.
   *
   * No `IF NOT EXISTS`: creating a table whose name is taken should say so. Silently
   * succeeding would leave the user believing they created something.
   *
   * Indexes beyond the primary key are emitted as table-level clauses, because a
   * composite index spans columns and has no single-column form. FULLTEXT and SPATIAL
   * are only legal on suitable column types, so each is checked against the columns it
   * covers before the statement is built — the server's own message ("Column 'a' cannot
   * be part of FULLTEXT index") does not say which of the form's fields to change.
   */
  async createTable(
    schema: string | undefined,
    table: string,
    columns: ColumnSpec[],
    options: { primaryKey?: string[]; indexes?: TableIndexSpec[]; table?: TableOptions } = {},
  ): Promise<QueryResult> {
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    if (columns.length === 0) throw new Error('a new table needs at least one column')

    // Attribute/type combinations MySQL refuses, caught here so the message can name
    // the column rather than arriving as "Invalid ON UPDATE clause for 'a' column".
    for (const spec of columns) validateMysqlAttributes(spec)

    const items = columns.map(spec =>
      `${requireIdentifier(spec.name, 'column name', quoteMysql)} ${renderMysqlDefinition(spec)}`,
    )

    const names = new Set(columns.map(spec => spec.name))
    const requireKnown = (list: string[], what: string): void => {
      if (list.length === 0) throw new Error(`${what} needs at least one column`)
      for (const name of list) {
        // MySQL would reject an unknown name, but "Key column 'x' doesn't exist in
        // table" does not say which of the two lists is wrong.
        if (!names.has(name)) throw new Error(`${what} names a column that is not being created: ${name}`)
      }
    }

    const key = options.primaryKey ?? []
    if (key.length > 0) {
      requireKnown(key, 'the primary key')
      items.push(`PRIMARY KEY (${key.map(name => requireIdentifier(name, 'column name', quoteMysql)).join(', ')})`)
    }

    /*
     * At most ONE auto-increment column, checked before anything else.
     *
     * Measured: MySQL allows exactly one, and its message ("there can be only one auto
     * column and it must be defined as a key") does not say which of the columns to change.
     */
    const autoColumns = columns.filter(spec => spec.autoIncrement === true)
    if (autoColumns.length > 1) {
      throw new Error(`only one column can AUTO_INCREMENT; ${autoColumns.length} were requested (${autoColumns.map(spec => spec.name).join(', ')})`)
    }

    // The index names MySQL will already be using, so a clash is caught before the
    // server answers with a duplicate-key-name error that names neither of the two.
    const usedNames = new Set(['PRIMARY'])
    // Every key's column list, so the auto-increment rule below can see all of them.
    const keyLists: string[][] = key.length > 0 ? [key] : []
    for (const index of options.indexes ?? []) {
      requireKnown(index.columns, `the ${index.kind} index`)
      const kind = index.kind.toUpperCase()
      if (index.kind === 'spatial') {
        /*
         * Every SPATIAL column must be NOT NULL.
         *
         * Measured: MySQL refuses a nullable one with "All parts of a SPATIAL index
         * must be NOT NULL", so the requirement is stated here as what to fix.
         */
        for (const name of index.columns) {
          const spec = columns.find(column => column.name === name)
          if (spec !== undefined && spec.nullable) {
            throw new Error(`the SPATIAL index covers "${name}", which must be NOT NULL (MySQL requires it)`)
          }
        }
      }
      if (index.kind === 'fulltext') {
        /*
         * FULLTEXT needs a text column. Measured: MySQL refuses `FULLTEXT(a)` where `a`
         * is INT with "Column 'a' cannot be part of FULLTEXT index".
         */
        for (const name of index.columns) {
          const spec = columns.find(column => column.name === name)
          if (spec !== undefined && !/\b(CHAR|VARCHAR|TEXT)\b/i.test(spec.type)) {
            throw new Error(`the FULLTEXT index covers "${name}" (${spec.type}), which is not a text column`)
          }
        }
      }
      const columnsSql = index.columns.map(name => requireIdentifier(name, 'column name', quoteMysql)).join(', ')
      const optionsSql = index.options === undefined || index.options.trim() === '' ? '' : ` ${index.options.trim()}`
      if (index.kind === 'primary') {
        if (key.length > 0) throw new Error('the primary key was given twice')
        items.push(`PRIMARY KEY (${columnsSql})${optionsSql}`)
        continue
      }
      /*
       * An index needs a name; `PRIMARY` is the only exception and is handled above.
       * Generated from the columns when the user left it blank, because MySQL requires
       * one — but a generated name that clashes is reported rather than silently
       * suffixed, so the name in the resulting schema is the one that was asked for.
       */
      const indexName = index.name === undefined || index.name.trim() === ''
        ? `${index.kind === 'unique' ? 'uq' : 'ix'}_${table}_${index.columns.join('_')}`
        : index.name.trim()
      if (usedNames.has(indexName.toUpperCase())) throw new Error(`two indexes would be named ${indexName}`)
      usedNames.add(indexName.toUpperCase())
      // Recorded so the auto-increment rule can see this key too: a UNIQUE or plain INDEX
      // over the auto column satisfies MySQL, the primary key is not required.
      keyLists.push(index.columns)
      const keyword = index.kind === 'unique' ? 'UNIQUE KEY' : index.kind === 'fulltext' ? 'FULLTEXT KEY' : index.kind === 'spatial' ? 'SPATIAL KEY' : 'KEY'
      void kind
      items.push(`${keyword} ${requireIdentifier(indexName, 'index name', quoteMysql)} (${columnsSql})${optionsSql}`)
    }

    const tableOptions = options.table ?? {}
    const tail: string[] = []
    if (tableOptions.engine !== undefined && tableOptions.engine.trim() !== '') {
      // An engine name is a bare keyword in the statement, so it is checked against
      // the grammar rather than pasted.
      if (!/^[A-Za-z0-9_]{1,32}$/.test(tableOptions.engine.trim())) {
        throw new Error(`invalid storage engine: ${JSON.stringify(tableOptions.engine)}`)
      }
      tail.push(`ENGINE=${tableOptions.engine.trim()}`)
    }
    if (tableOptions.charset !== undefined && tableOptions.charset.trim() !== '') {
      tail.push(`DEFAULT CHARSET=${requireCharset(tableOptions.charset)}`)
    }
    if (tableOptions.collate !== undefined && tableOptions.collate.trim() !== '') {
      tail.push(`COLLATE=${requireCollate(tableOptions.collate)}`)
    }
    if (tableOptions.comment !== undefined && tableOptions.comment !== '') {
      // Same rule as a column comment: the escaping relies on doubling the quote, and
      // a backslash would change what the literal means.
      if (tableOptions.comment.includes('\\')) throw new Error('a table comment cannot contain a backslash')
      tail.push(`COMMENT='${tableOptions.comment.replace(/'/g, "''")}'`)
    }

    /*
     * The auto-increment column's key requirement, now that every key is known.
     *
     * Measured against MySQL: it must be A key (UNIQUE or a plain INDEX is enough, PRIMARY
     * is not required), and inside a COMPOSITE key it must be the FIRST member. The
     * position rule is the one the panel previously missed, so it produced a CREATE the
     * server rejected with the same blanket message it uses for the other two mistakes.
     */
    const autoColumn = autoColumns[0]
    if (autoColumn !== undefined) {
      /*
       * Two distinct failures, reported separately.
       *
       * They were one branch at first, which meant a column in NO key at all was told it
       * "must be the first column of a key" — true-sounding but not the thing to fix, and
       * a probe that read the actual message showed it. The order is: is it in a key, then
       * does it lead one.
       */
      const inSomeKey = keyLists.some(list => list.includes(autoColumn.name))
      if (!inSomeKey) {
        throw new Error(`column ${autoColumn.name} is AUTO_INCREMENT, so it must be a key: add it to the primary key, or give it a UNIQUE or INDEX of its own`)
      }
      if (!keyLists.some(list => list[0] === autoColumn.name)) {
        throw new Error(`column ${autoColumn.name} is AUTO_INCREMENT, so it must be the FIRST column of a key (in a composite key the auto column cannot come second unless it is also indexed on its own)`)
      }
    }

    const suffix = tail.length === 0 ? '' : ` ${tail.join(' ')}`
    return this.exec(`CREATE TABLE ${qualified} (\n  ${items.join(',\n  ')}\n)${suffix}`, [], target)
  }

  async addColumn(schema: string | undefined, table: string, spec: ColumnSpec): Promise<QueryResult> {
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    return this.exec(
      `ALTER TABLE ${qualified} ADD COLUMN ${requireIdentifier(spec.name, 'column name', quoteMysql)} ${renderMysqlDefinition(spec)}`,
      [],
      target,
    )
  }

  /**
   * Change an existing column.
   *
   * `MODIFY COLUMN` rewrites the whole column definition, so the spec has to
   * carry every attribute that must survive — which is why the 结构 tab loads
   * the column first and submits what it read back, rather than sending only the
   * changed field. `CHANGE COLUMN` is used when the name also changes.
   *
   * The column name is emitted HERE, not by the definition renderer: `MODIFY`
   * takes `name definition` and `CHANGE` takes `old new definition`, so a
   * renderer that included the name would produce `MODIFY COLUMN \`a\` \`a\`
   * int …` — a syntax error whose message points at the duplicated name rather
   * than at the caller.
   */
  async alterColumn(schema: string | undefined, table: string, spec: ColumnSpec, options: { rename?: string } = {}): Promise<QueryResult> {
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    const existing = (await this.columns(target, table)).find(column => column.name === spec.name)
    if (existing === undefined) throw new Error(`no such column: ${spec.name}`)
    const definition = renderMysqlDefinition(spec, { generated: existing.generated, extra: existing.extra })
    const current = requireIdentifier(spec.name, 'column name', quoteMysql)

    const run = async (sql: string): Promise<QueryResult> => {
      try {
        return await this.exec(sql, [], target)
      } catch (error) {
        throw explainAlterFailure(error, existing, spec)
      }
    }
    if (options.rename !== undefined && options.rename !== spec.name) {
      return run(`ALTER TABLE ${qualified} CHANGE COLUMN ${current} ${requireIdentifier(options.rename, 'column name', quoteMysql)} ${definition}`)
    }
    return run(`ALTER TABLE ${qualified} MODIFY COLUMN ${current} ${definition}`)
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
    // A table that reports no columns does not exist, and saying "a table must
    // keep at least one column" would be a wrong diagnosis of a missing table.
    if (columns.length === 0) throw new Error(`no such table: ${target}.${table}`)
    if (columns.length <= 1) throw new Error('a table must keep at least one column')
    const found = columns.find(candidate => candidate.name === column)
    if (found === undefined) throw new Error(`no such column: ${column}`)
    return this.exec(`ALTER TABLE ${qualified} DROP COLUMN ${requireIdentifier(column, 'column name', quoteMysql)}`, [], target)
  }

  /**
   * Replace the table's primary key.
   *
   * Several statements in one connection: MySQL will not accept a table with two
   * primary keys even momentarily, so the old one is dropped first — and the
   * ordering below is what keeps the intermediate state the least harmful one.
   * MySQL's DDL commits itself, so there is no rollback to lean on.
   *
   * Three engine quirks drive the details, all measured:
   *
   * 1. **An AUTO_INCREMENT column has to be a key**, so it is stripped of the
   *    attribute FIRST, while the old key still exists. Doing it later fails with
   *    "there can be only one auto column and it must be defined as a key".
   *    `autoIncrement: false` must be set explicitly: `toSpec` reads the
   *    attribute back off the live column, so passing it through unchanged would
   *    re-emit it.
   * 2. **A key column must be NOT NULL** (error 1171), so every chosen column is
   *    widened before the key is added.
   * 3. **A primary key RAISED from a UNIQUE index cannot be dropped with `DROP
   *    PRIMARY KEY`** — the server answers "Can't DROP 'PRIMARY'; check that
   *    column/key exists", because no index is actually named `PRIMARY`. It is
   *    dropped as the unique index it is instead, which is why the statement is
   *    chosen by asking what the key looks like rather than by assuming.
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
    for (const column of existing) {
      const isAuto = column.extra !== undefined && /auto_increment/i.test(column.extra)
      if (!isAuto || columns.includes(column.name)) continue
      statements.push(
        `ALTER TABLE ${qualified} MODIFY COLUMN ${requireIdentifier(column.name, 'column name', quoteMysql)} ` +
        `${renderMysqlDefinition({ ...toSpec(column), autoIncrement: false })}`,
      )
    }
    for (const name of columns) {
      const column = known.get(name.toLowerCase())!
      if (!column.nullable) continue
      statements.push(`ALTER TABLE ${qualified} MODIFY COLUMN ${requireIdentifier(column.name, 'column name', quoteMysql)} ${renderMysqlDefinition({ ...toSpec(column), nullable: false })}`)
    }

    const drop = await this.primaryKeyDropClause(target, table)
    if (drop !== undefined) statements.push(`ALTER TABLE ${qualified} ${drop}`)
    if (columns.length > 0) {
      statements.push(`ALTER TABLE ${qualified} ADD PRIMARY KEY (${columns.map(name => requireIdentifier(name, 'column name', quoteMysql)).join(', ')})`)
    }
    if (statements.length === 0) return { columns: [], rows: [], affected: 0, durationMs: 0, write: true, truncated: false }
    return this.execTransaction(statements, target)
  }

  /**
   * The clause that removes the table's current primary key, or undefined.
   *
   * `DROP PRIMARY KEY` when an index really is named `PRIMARY`; otherwise the key
   * is one MySQL RAISED from a UNIQUE index and has to be dropped under its own
   * name. The index whose column list equals the key's is the one — matched on
   * the columns rather than on a name, because the name is whatever the user (or
   * a previous tool) happened to give that unique index.
   *
   * The index is looked up through {@link SqlDriver.indexes} rather than in
   * `information_schema.STATISTICS` from scratch, so the naming rule lives in one
   * place and the two callers cannot drift.
   */
  private async primaryKeyDropClause(schema: string, table: string): Promise<string | undefined> {
    if (!(await this.hasPrimaryKey(schema, table))) return undefined
    const indexes = await this.indexes(schema, table)
    const named = indexes.find(index => index.name === 'PRIMARY')
    if (named !== undefined) return 'DROP PRIMARY KEY'
    const raised = indexes.find(index => index.primary === true)
    if (raised === undefined) return 'DROP PRIMARY KEY'
    return `DROP INDEX ${requireIdentifier(raised.name, 'index name', quoteMysql)}`
  }

  /**
   * Create an index on one or more existing columns.
   *
   * MySQL refuses an index on a `TEXT`/`BLOB` column without a prefix length
   * ("BLOB/TEXT column used in key specification without a key length"). Its own
   * message does not say what to do about it, so the refusal is caught here and
   * restated with the reason — a user typing an index name into the 结构 tab
   * cannot act on the engine's wording, which reads like a syntax problem.
   */
  async createIndex(schema: string | undefined, table: string, spec: { name: string; columns: string[]; unique: boolean }): Promise<QueryResult> {
    if (spec.columns.length === 0) throw new Error('an index needs at least one column')
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    const columns = await this.columns(target, table)
    const known = new Map(columns.map(column => [column.name.toLowerCase(), column]))
    const resolved = spec.columns.map(name => {
      const found = known.get(name.toLowerCase())
      if (found === undefined) throw new Error(`no such column: ${name}`)
      return found
    })
    const unbounded = resolved.filter(column => /^(tiny|medium|long)?(text|blob)$/i.test(column.type.trim()))
    if (unbounded.length > 0) {
      throw new Error(
        `MySQL cannot index ${unbounded.map(column => `${column.name} (${column.type})`).join(', ')} without a prefix length; ` +
        'use a shorter column type (for example VARCHAR(191)) or add the index from the SQL tab with an explicit length',
      )
    }
    const name = requireIdentifier(spec.name, 'index name', quoteMysql)
    return this.exec(
      `ALTER TABLE ${qualified} ADD ${spec.unique ? 'UNIQUE ' : ''}INDEX ${name} (${resolved.map(column => quoteMysql(column.name)).join(', ')})`,
      [],
      target,
    )
  }

  /**
   * Drop an index.
   *
   * Refuses the primary key's own index — including one MySQL raised from a
   * UNIQUE index, which is not named `PRIMARY` and would otherwise look
   * droppable. Its own message for that case ("check that column/key exists" when
   * the name is `PRIMARY`, or a silent key removal when it is not) does not say
   * what is at stake, so the refusal is made here with the reason.
   */
  async dropIndex(schema: string | undefined, table: string, name: string): Promise<QueryResult> {
    const target = this.requireSchema(schema)
    const indexes = await this.indexes(target, table)
    const found = indexes.find(index => index.name === name)
    if (found === undefined) throw new Error(`no such index: ${name}`)
    if (found.primary === true) {
      throw new Error(`"${name}" is the table's primary key; change the key instead of dropping it as an index`)
    }
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
   * Run several statements in order.
   *
   * MySQL's DDL is NOT transactional — every `CREATE`/`ALTER`/`DROP` commits
   * itself, and an implicit commit also ends any open transaction. So this
   * cannot promise the atomicity SQLite's script runner can, and it does not
   * pretend to: the statements run in order on ONE connection, and a failure
   * stops there with the earlier ones already applied.
   *
   * That is stated here rather than hidden, because it changes what a user
   * should expect from a failed import: the route reports how many statements
   * had run when it stopped, so the outcome is a known prefix rather than an
   * unknown state. The `START TRANSACTION` is still issued for the DML part of a
   * dump (the `INSERT`s), where it does work and is the common case for a
   * data-only import.
   */
  async runScript(statements: string[], schema: string | undefined, onStatement?: (index: number) => void): Promise<void> {
    const body = statements.filter(statement => !isTransactionControl(statement))
    if (body.length === 0) return
    const target = schema === undefined || schema === '' ? undefined : schema
    if (target !== undefined) requireIdentifier(target, 'schema name', quoteMysql)

    const pool = await this.open()
    const connection = await pool.getConnection()
    try {
      if (target !== undefined) await connection.query({ sql: `USE ${quoteMysql(target)}` })
      for (const [index, statement] of body.entries()) {
        await connection.query({ sql: statement })
        onStatement?.(index)
      }
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
   * Nothing, on purpose.
   *
   * MySQL's `SHOW CREATE TABLE` inlines every key and index as part of the
   * table's own definition (`KEY \`ix\` (\`v\`)` inside the statement), so a dump
   * that also emitted separate `CREATE INDEX` statements would try to create
   * them twice. Returning an empty list is the correct answer here, not an
   * unimplemented one.
   */
  async auxiliaryDdl(): Promise<string[]> {
    return []
  }

  /**
   * The table's own `CREATE TABLE` text, as MySQL stores it.
   *
   * `SHOW CREATE TABLE` is the authority rather than anything derived from
   * `information_schema`: it reflects the engine's own canonical form, including
   * the column types it widened, generated-column expressions, foreign keys,
   * partition clauses and table options that `information_schema` splits up or
   * omits. It is used verbatim by the exporter for exactly that reason.
   *
   * A view is a different statement, so the object's kind is decided first.
   * `information_schema.TABLES.TABLE_TYPE` answers it in one cheap read — the
   * earlier version asked `information_schema.VIEWS` for a `SQL_VIEW` column,
   * which does not exist on MySQL 8/9, making every export fail with
   * "Unknown column 'SQL_VIEW' in 'field list'".
   */
  async createStatement(schema: string | undefined, table: string): Promise<string | undefined> {
    const target = this.requireSchema(schema)
    requireIdentifier(table, 'table name', quoteMysql)
    const [rows] = await (await this.open()).query({
      sql: 'SELECT TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      values: [target, table],
    })
    const record = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined
    if (record === undefined) return undefined
    const isView = String(record['type'] ?? '').toUpperCase().includes('VIEW')
    // A view has no data of its own to export, but its definition is still worth
    // reproducing; `SHOW CREATE VIEW` is the statement that reports it.
    const result = await this.exec(`SHOW CREATE ${isView ? 'VIEW' : 'TABLE'} ${qualifyMysql(target, table)}`, [], target)
    const text = result.rows[0]?.[1]
    return text === undefined || text === null ? undefined : String(text)
  }

  /**
   * Every row of a table, capped at `limit`.
   *
   * Not paged: an export has to see all of them, and the caller sets the cap.
   * `mysql2`'s non-streaming query materialises the result, which is exactly
   * what the cap is for — the route refuses a table above the cap rather than
   * trying and running the host out of memory.
   */
  async allRows(
    schema: string | undefined,
    table: string,
    limit: number,
  ): Promise<{ columns: string[]; rows: Array<Record<string, string | number | boolean | null>>; truncated: boolean }> {
    const target = this.requireSchema(schema)
    const cap = Math.max(1, Math.trunc(limit))
    const qualified = qualifyMysql(target, table)
    // One row PAST the cap, which is what proves there was more.
    const [dataRows, fields] = await (await this.open()).query({ sql: `SELECT * FROM ${qualified} LIMIT ${cap + 1}` })
    const list = Array.isArray(dataRows) ? (dataRows as Array<Record<string, unknown>>) : []
    const truncated = list.length > cap
    const rows = truncated ? list.slice(0, cap) : list
    const fieldList = Array.isArray(fields) ? fields : []
    const columns = fieldList.length > 0
      ? fieldList.map(field => String((field as { name?: unknown }).name ?? '')).filter(name => name !== '')
      : rows.length > 0 ? Object.keys(rows[0]!) : (await this.columns(target, table)).map(column => column.name)
    return { columns, rows: rows.map(row => projectRow(row)), truncated }
  }

  /** Which tables each table references, from `information_schema`. */
  async tableReferences(schema: string | undefined): Promise<Map<string, string[]>> {
    const target = this.requireSchema(schema)
    const [rows] = await (await this.open()).query({
      sql:
        'SELECT TABLE_NAME AS name, REFERENCED_TABLE_NAME AS target FROM information_schema.KEY_COLUMN_USAGE ' +
        "WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL",
      values: [target],
    })
    const references = new Map<string, string[]>()
    if (!Array.isArray(rows)) return references
    for (const row of rows) {
      const record = row as Record<string, unknown>
      const name = String(record['name'] ?? '')
      const referenced = String(record['target'] ?? '')
      // A self-reference is not an ordering dependency; treating it as one would
      // make the topological walk skip the table.
      if (name === '' || referenced === '' || name.toLowerCase() === referenced.toLowerCase()) continue
      const key = name.toLowerCase()
      const list = references.get(key) ?? []
      if (!list.includes(referenced.toLowerCase())) list.push(referenced.toLowerCase())
      references.set(key, list)
    }
    return references
  }

  /** Tables and views in one schema, names only — the export scope's list. */
  async tableNames(schema: string | undefined): Promise<Array<{ name: string; type: string }>> {
    const target = this.requireSchema(schema)
    const [rows] = await (await this.open()).query({
      sql: 'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME',
      values: [target],
    })
    const list = Array.isArray(rows) ? rows : []
    return list
      .map(row => {
        const record = row as Record<string, unknown>
        const type = String(record['type'] ?? '')
        return { name: String(record['name'] ?? ''), type: type.includes('VIEW') ? 'view' : 'table' }
      })
      .filter(entry => entry.name !== '')
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
    return buildSearchWhere(query.filters, query.filterJoin === 'or' ? 'or' : 'and', quoteMysql, known, 'mysql')
  }
  if (query.mode === 'search') {
    const term = query.term ?? ''
    if (term === '') return { where: '', params: [] }
    const target = columns.filter(column => isTextual(column.type))
    const chosen = target.length > 0 ? target : columns
    // `%`/`_` in the term are characters to find, not wildcards, so they are
    // escaped and the clause declares the escape character.
    const pattern = `%${term.replace(/[\\%_]/g, match => `\\${match}`)}%`
    const clauses = chosen.map(column => `${quoteMysql(column.name)} LIKE ? ${likeEscapeClause('mysql')}`)
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

/**
 * Render a column DEFINITION — the part after the name.
 *
 * The name is deliberately absent: `ADD COLUMN` / `MODIFY COLUMN` / `CHANGE
 * COLUMN` each place the name in a different position, and a renderer that
 * supplied it would duplicate it in every one of them.
 */
function renderMysqlDefinition(spec: ColumnSpec, carry: { generated?: boolean; extra?: string } = {}): string {
  const parts: string[] = []
  const base = spec.type.trim() === '' ? '' : normalizeType(spec.type, 'mysql')
  if (base === '') throw new Error('a MySQL column needs a type')
  /*
   * The length / values suffix.
   *
   * `normalizeMysqlType` already carries whatever parentheses came WITH the type, so a
   * separate `length` must not double them up: `VARCHAR(255)` plus `length: '255'`
   * would render `VARCHAR(255)(255)`. When the type already carries parentheses they
   * win, and the explicit length is used only when it does not.
   */
  const hasParens = /\(/.test(base)
  const length = spec.length === undefined ? '' : spec.length.trim()
  if (length !== '' && !hasParens) {
    // A length is not free text: it goes inside parentheses in the statement. Checked
    // for the shapes that are genuinely lengths/values and not an injection route.
    if (!/^[0-9]{1,10}(\s*,\s*[0-9]{1,10})?$/.test(length) && !/^'([^'\\]|'')*'(\s*,\s*'([^'\\]|'')*')*$/.test(length)) {
      throw new Error(`invalid length/values for column ${spec.name}: ${JSON.stringify(spec.length)}`)
    }
    parts.push(`${base}(${length})`)
  } else {
    parts.push(base)
  }

  // A generated column's expression lives in EXTRA, and MySQL rejects a
  // definition that carries `DEFAULT` or `AUTO_INCREMENT` alongside it, so the
  // generated form is the whole definition and nothing else is appended.
  if (carry.generated === true) {
    const extra = carry.extra?.replace(/DEFAULT_GENERATED\s*/i, '').trim() ?? ''
    if (extra === '' || !/\bAS\s*\(/i.test(extra)) {
      throw new Error('this generated column cannot be modified: its expression was not reported by the server')
    }
    parts.push(extra)
    if (spec.comment !== undefined && spec.comment !== '') parts.push(renderComment(spec.comment))
    return parts.join(' ')
  }

  /*
   * The column attributes, in MySQL's own order.
   *
   * `ZEROFILL` implies `UNSIGNED` in MySQL, so emitting both is what the server
   * itself does and what `SHOW CREATE TABLE` reports back — emitting only ZEROFILL
   * would round-trip to a different string.
   *
   * The character set has to come BEFORE the collation: MySQL rejects
   * `COLLATE x CHARACTER SET y` with "COLLATION 'x' is not valid for CHARACTER SET 'y'"
   * because the collation is checked against the character set in force when it
   * appears.
   */
  const attributes = new Set(spec.attributes ?? [])
  if (attributes.has('unsigned') || attributes.has('zerofill')) parts.push('UNSIGNED')
  if (attributes.has('zerofill')) parts.push('ZEROFILL')
  if (attributes.has('binary')) parts.push('BINARY')
  if (spec.charset !== undefined && spec.charset !== '') parts.push(`CHARACTER SET ${requireCharset(spec.charset)}`)
  if (spec.collate !== undefined && spec.collate !== '') parts.push(`COLLATE ${requireCollate(spec.collate)}`)

  // A primary-key column must be NOT NULL, and MySQL refuses the key otherwise.
  parts.push(spec.primaryKeyPosition === undefined && spec.nullable ? 'NULL' : 'NOT NULL')
  if (spec.defaultValue !== undefined) {
    const value = normalizeDefault(spec.defaultValue, 'mysql')
    if (value !== undefined) parts.push(`DEFAULT ${value}`)
  }
  if (attributes.has('onUpdateCurrentTimestamp')) parts.push('ON UPDATE CURRENT_TIMESTAMP')
  if (spec.autoIncrement === true) parts.push('AUTO_INCREMENT')
  if (spec.unique === true) parts.push('UNIQUE')
  if (spec.comment !== undefined && spec.comment !== '') parts.push(renderComment(spec.comment))
  return parts.join(' ')
}

/**
 * Validate a column attribute against the type it is being attached to.
 *
 * Both engines reject some combinations, and the server's messages do not always say
 * which field to change ("Invalid ON UPDATE clause for 'a' column"). Catching them here
 * lets the message name the column and the reason.
 *
 * Measured against MySQL: `BINARY` is a syntax error on INT, and `ON UPDATE
 * CURRENT_TIMESTAMP` is refused on anything that is not a temporal type.
 */
export function validateMysqlAttributes(spec: ColumnSpec): void {
  const attributes = spec.attributes ?? []
  if (attributes.length === 0) return
  const type = spec.type.toUpperCase()
  const isTemporal = /\b(TIMESTAMP|DATETIME)\b/.test(type)
  const isString = /\b(CHAR|VARCHAR|TEXT|BLOB|ENUM|SET|BINARY|VARBINARY)\b/.test(type)
  const isNumeric = /\b(INT|INTEGER|TINYINT|SMALLINT|MEDIUMINT|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|BIT)\b/.test(type)

  for (const attribute of attributes) {
    if (attribute === 'binary' && !isString) {
      throw new Error(`column ${spec.name}: BINARY only applies to CHAR / VARCHAR / TEXT / BLOB types`)
    }
    if (attribute === 'unsigned' && !isNumeric) {
      throw new Error(`column ${spec.name}: UNSIGNED only applies to numeric types`)
    }
    if (attribute === 'zerofill' && !isNumeric) {
      throw new Error(`column ${spec.name}: ZEROFILL only applies to numeric types`)
    }
    if (attribute === 'onUpdateCurrentTimestamp' && !isTemporal) {
      throw new Error(`column ${spec.name}: ON UPDATE CURRENT_TIMESTAMP only applies to TIMESTAMP or DATETIME`)
    }
  }
}

/** Render a column comment as a MySQL string literal. */
function renderComment(text: string): string {
  if (text.includes('\\')) throw new Error('a column comment cannot contain a backslash')
  return `COMMENT '${text.replace(/'/g, "''")}'`
}

/**
 * Project a {@link ColumnInfo} back onto a {@link ColumnSpec} for a rewrite.
 *
 * `SHOW CREATE TABLE` reports a numeric default as a QUOTED string (`DEFAULT
 * '3'` for an `int`), and `information_schema.COLUMNS.COLUMN_DEFAULT` does the
 * same. Feeding that back through {@link normalizeDefault} would store the
 * column's default as the string `3` on an `int` — MySQL accepts it and coerces,
 * so the rewrite succeeds with a subtly different definition. Unquoting a
 * numeric literal restores what the user would have written.
 */
function toSpec(column: ColumnInfo): ColumnSpec {
  return {
    name: column.name,
    type: column.type,
    nullable: column.nullable,
    ...(column.defaultValue === undefined ? {} : { defaultValue: unquoteNumericDefault(column.defaultValue) }),
    ...(column.primaryKeyPosition === undefined ? {} : { primaryKeyPosition: column.primaryKeyPosition }),
    ...(column.extra !== undefined && /auto_increment/i.test(column.extra) ? { autoIncrement: true } : {}),
    ...(column.comment === undefined ? {} : { comment: column.comment }),
  }
}

/** `'3'` → `3`, leaving any non-numeric default alone. */
function unquoteNumericDefault(value: string): string {
  const match = /^'(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)'$/.exec(value.trim())
  return match === null ? value : match[1]!
}

/**
 * Restate the ALTER failures that a user cannot act on.
 *
 * `Data truncated for column 'x' at row 1` is MySQL's answer to "you asked me to
 * make a NULLable column NOT NULL, and it holds NULLs" — a correct refusal whose
 * wording names an internal row number and says nothing about what to do. The
 * panel offers a nullability checkbox, so the user needs the reason, not the
 * engine's phrasing. Every other error is passed through untouched: guessing at
 * an unknown failure would be worse than reporting it.
 */
function explainAlterFailure(error: unknown, existing: ColumnInfo, spec: ColumnSpec): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/Data truncated|Invalid use of NULL value|cannot be null/i.test(message) && existing.nullable && !spec.nullable) {
    return new Error(
      `column "${existing.name}" cannot become NOT NULL: it currently holds NULL values. ` +
      'Fill or delete those rows first, then set the column NOT NULL. ' +
      `（引擎原文：${message}）`,
    )
  }
  return error instanceof Error ? error : new Error(message)
}
/** Whether a MySQL column type is textual enough for a LIKE search. */
function isTextual(type: string): boolean {
  return /char|text|enum|set|json|blob|binary/i.test(type)
}

/**
 * A character set name, validated before it reaches a statement.
 *
 * `ALTER DATABASE … CHARACTER SET x` cannot be parameter-bound, so the name is
 * checked against a conservative grammar AND against MySQL's own list, read from the
 * server: a typo then fails here with "unknown character set" rather than as a syntax
 * error from a statement the user cannot see. The list is fetched rather than
 * hard-coded, because a MySQL release may add one and a hard-coded list would refuse
 * a value the server accepts.
 */
function requireCharset(value: string): string {
  const name = value.trim()
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new Error(`invalid character set: ${JSON.stringify(value)}`)
  return name
}

/** A collation name, validated the same way and for the same reason. */
function requireCollate(value: string): string {
  const name = value.trim()
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new Error(`invalid collation: ${JSON.stringify(value)}`)
  return name
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
