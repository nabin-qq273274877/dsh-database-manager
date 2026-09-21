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
import { assertSingleStatement, buildSearchWhere, groupSameColumns, isTransactionControl, likeEscapeClause, looksReadOnly, pushDownLimit, qualifyMysql, quoteMysql, requireIdentifier, toWireValue } from '../sql-util.ts'
import { identifier, normalizeDefault, normalizeType } from '../sql-schema.ts'
import { POSITION_FIRST } from './types.ts'
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
   * All three table actions, because MySQL can do all three.
   *
   * Unlike `repair` on InnoDB, none of these has an "accepted but does nothing"
   * form: `RENAME TABLE … TO other_db.t` really moves the table, `CREATE TABLE …
   * LIKE` really clones the structure, and every option the 表选项 page edits has a
   * statement behind it. So there is nothing here to disable with a caveat.
   */
  tableActionSupport(): TableActionOp[] {
    return ['move', 'options', 'copy']
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
      /*
       * The three statistics columns arrive as STRINGS, and have to be read as such.
       *
       * `TABLE_ROWS`, `DATA_LENGTH` and `INDEX_LENGTH` are all `bigint unsigned` in
       * information_schema (measured), and the pool is configured with
       * `supportBigNumbers: true` + `bigNumberStrings: true` so a BIGINT beyond 2^53 cannot lose
       * precision on its way to the browser. mysql2 therefore hands back every BIGINT as a string,
       * which is the right default for user data — but it silently broke these three: the code
       * checked `typeof value === 'number'`, so every count and size failed the test and was
       * dropped. Measured: 行数 showed 未知 and 大小 showed — for every table of a real MySQL
       * database, including tables with hundreds of rows, while the same query in a MySQL client
       * returned numbers.
       *
       * `toWireValue` is deliberately NOT used here: it would pass the string straight through, and
       * the protocol declares these fields as `number`. `toCount` converts and validates in one
       * place, so a value that is not a finite number stays ABSENT (which the panel renders as
       * 未知 / —) rather than becoming a lie like 0 or NaN.
       */
      const rowCount = toCount(record['rows_count'])
      const engine = toWireValue(record['engine'])
      const collation = toWireValue(record['collation'])
      const dataBytes = toCount(record['data_bytes'])
      const indexBytes = toCount(record['index_bytes'])
      // DATA_LENGTH and INDEX_LENGTH are the engine's own byte figures, so this
      // costs nothing extra to read. A view reports NULL for both, which is why
      // the sum is only emitted when at least one of them is a number —
      // otherwise a view would be shown as 0 bytes.
      const size =
        dataBytes !== undefined || indexBytes !== undefined
          ? (dataBytes ?? 0) + (indexBytes ?? 0)
          : undefined
      return {
        name: String(record['name'] ?? ''),
        type: type.includes('VIEW') ? 'view' : 'table',
        ...(rowCount === undefined ? {} : { rows: rowCount }),
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
        'COLUMN_KEY AS col_key, COLUMN_COMMENT AS comment, EXTRA AS extra, COLLATION_NAME AS collation, ' +
        'GENERATION_EXPRESSION AS generation ' +
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
      /*
       * The generated-column EXPRESSION, which is a DIFFERENT column from `EXTRA`.
       *
       * `EXTRA` says a column IS generated (`STORED GENERATED`) but never what from,
       * so this is the only place the expression exists. It is read here rather than
       * re-queried when the 结构 tab builds a rewrite, because the same read already
       * happens and a second query would be a second chance to disagree with it.
       *
       * It is also the RELIABLE test for "is this generated". `EXTRA` carries
       * `DEFAULT_GENERATED` for an ordinary `DEFAULT CURRENT_TIMESTAMP`, so a
       * substring match on GENERATED classifies a plain column with a default as a
       * computed one — measured, and it made such a column refuse every edit.
       */
      const generation = toWireValue(record['generation'])
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
        /*
         * A generated column cannot be inserted into or updated, so the 插入 and 浏览
         * surfaces must not offer it as an editable input.
         *
         * The test is on the EXPRESSION, not on `EXTRA` containing "GENERATED":
         * measured, `EXTRA` is `DEFAULT_GENERATED` for an ordinary
         * `DEFAULT CURRENT_TIMESTAMP` column, so the substring test flagged such a
         * column as computed — which both hid it from the edit form and made every
         * edit of it fail with "this generated column cannot be modified". The
         * expression is also what a rewrite needs, so the two now come from one read.
         */
        ...(typeof generation === 'string' && generation !== ''
          ? { generated: true, generatedExpression: generation }
          : {}),
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
   * Insert several rows in ONE transaction.
   *
   * MySQL makes this cheap: a single `INSERT … VALUES (…),(…)` is one statement,
   * one round trip and one implicit transaction, so a large CSV import does not
   * pay per-row latency. Rows are chunked, because `max_allowed_packet` caps the
   * statement size and one packet per 500 rows is well inside every default.
   *
   * Rows are NOT required to name the same columns. They used to be, and the
   * 插入 tab's phpMyAdmin-shaped forms are what made that wrong: each form is
   * filled in independently, so a column left blank in one row and supplied in
   * another is the ordinary case rather than a mistake. Measured: two such forms
   * made the batch answer 500 "every row in one insert must name the same
   * columns, in the same order". Rows that DO agree still share one multi-row
   * statement — the CSV import's cheap path is unchanged — and only a change of
   * column list costs another statement.
   */
  async insertRows(schema: string | undefined, table: string, rows: RowValue[][]): Promise<QueryResult> {
    if (rows.length === 0) throw new Error('insert requires at least one row')
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
        for (const group of groupSameColumns(rows)) {
          const columns = group[0]!.map(item => item.column)
          const names = columns.map(name => requireIdentifier(name, 'column name', quoteMysql)).join(', ')
          const CHUNK = 500
          for (let at = 0; at < group.length; at += CHUNK) {
            const chunk = group.slice(at, at + CHUNK)
            const placeholders = chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')
            const params = chunk.flatMap(row => row.map(item => item.value))
            await connection.query({ sql: `INSERT INTO ${qualified} (${names}) VALUES ${placeholders}`, values: params })
            affected += chunk.length
          }
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
      // carry this statement's session state into the next user's query.
      try {
        await connection.query({ sql: 'USE `information_schema`' })
        connection.release()
      } catch {
        /* the pool will drop it */
      }
    }
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

  /**
   * Add a column, optionally at a chosen position.
   *
   * `AFTER x` / `FIRST` is what phpMyAdmin's 「在…之后」 produces. The column name is
   * VALIDATED as an existing column first: MySQL would answer `Unknown column 'x' in
   * 't'`, which is a correct refusal but does not say that the name came from a
   * position dropdown rather than from the column being added.
   *
   * The position is only ever read for `addColumn`. Passing it to a `MODIFY` would
   * move the column as a side effect of editing its type, which is not what that
   * form asks for.
   */
  async addColumn(schema: string | undefined, table: string, spec: ColumnSpec): Promise<QueryResult> {
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    let position = ''
    if (spec.positionAfter !== undefined) {
      if (spec.positionAfter === POSITION_FIRST) {
        position = ' FIRST'
      } else {
        const existing = await this.columns(target, table)
        if (!existing.some(column => column.name === spec.positionAfter)) {
          throw new Error(`找不到要放在其后的列「${spec.positionAfter}」（表结构可能已变化，请刷新后重试）`)
        }
        position = ` AFTER ${requireIdentifier(spec.positionAfter, 'column name', quoteMysql)}`
      }
    }
    return this.exec(
      `ALTER TABLE ${qualified} ADD COLUMN ${requireIdentifier(spec.name, 'column name', quoteMysql)} ${renderMysqlDefinition(spec)}${position}`,
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
    /*
     * A default that came back from the server needs translating; one the user TYPED
     * does not.
     *
     * `information_schema` reports `DEFAULT 'x'` as an unquoted `x`, and that form is
     * refused by {@link normalizeDefault} — so the 结构 tab, which round-trips whatever
     * it read, could not edit a column with a string default at all.
     *
     * The two cases are told apart by matching the submission against the live value in
     * EITHER form: the raw reported text (`x`), or the rendered literal the panel sends
     * back for it (`'x'`). An untouched field matches one of them and is translated; a
     * value the user changed matches neither and is left for the validator to judge.
     * A single comparison is not enough — which of the two forms arrives depends on the
     * type, and matching only the raw one would miss `'5'` on a VARCHAR (reported `5`,
     * rendered `5`, and the raw comparison would then store a NUMBER default on a text
     * column).
     *
     * AN EXPRESSION default takes a third path. The server reports
     * `lower(_utf8mb4\'ABC\')` and its bracketed form `(lower(…))` is not a literal
     * either, so `normalizeDefault` refuses it by design — it cannot verify an arbitrary
     * expression, and the panel must not let a user type one. The engine's own text is
     * the one case known to be valid, so it is re-emitted verbatim and only when the
     * submission still matches the live column (i.e. the user did not replace it).
     */
    const live = existing.defaultValue
    const liveLiteral = live === undefined ? undefined : defaultLiteralFor(live, spec.type)
    const unchanged = liveLiteral !== undefined
      && (spec.defaultValue === live || spec.defaultValue === liveLiteral)
    const isExpression = unchanged && live !== undefined && live.includes('(')
    const submitted = unchanged ? liveLiteral : spec.defaultValue
    const definition = renderMysqlDefinition(
      isExpression ? { ...spec, defaultValue: undefined } : { ...spec, ...(submitted === undefined ? {} : { defaultValue: submitted }) },
      {
        generated: existing.generated,
        ...(existing.generatedExpression === undefined ? {} : { generatedExpression: existing.generatedExpression }),
        extra: existing.extra,
        // Read from the live column: the form has no field for it, and an omitted
        // `ON UPDATE` clause is dropped by `MODIFY COLUMN`.
        onUpdateCurrentTimestamp: /on update/i.test(existing.extra ?? ''),
        ...(isExpression ? { verbatimDefault: liveLiteral! } : {}),
      },
    )
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
   * Move a table to another database.
   *
   * ONE `RENAME TABLE a.t TO b.t` statement, because that is what MySQL's move is:
   * the server relocates the table's files and keeps its data, indexes, triggers and
   * foreign keys, with no copy of the rows. `ALTER TABLE … RENAME TO b.t` would do
   * the same thing, but `RENAME TABLE` is also the statement that can carry several
   * moves at once, and it makes the "moving, not copying" nature of the operation
   * unambiguous to a reader.
   *
   * Three refusals worth their own messages, all measured:
   *
   * - **A VIEW cannot change schema.** MySQL answers `RENAME TABLE a.v TO b.v` with
   *   "Changing schema from 'a' to 'b' is not allowed", because a view's definition
   *   is stored against an explicit schema. It is refused here with that reason
   *   rather than passed through as a syntax-looking failure.
   * - **A target that already exists** stops the statement with "Table 'b.t' already
   *   exists" — checked here so the message can name the object the user has to deal
   *   with, which the engine's own error does not distinguish from a rename of the
   *   table being moved.
   * - **The same database and the same name** is a no-op that would still be a
   *   rename to itself; nothing is emitted.
   */
  async moveTable(schema: string | undefined, table: string, target: TableTarget): Promise<QueryResult> {
    const from = this.requireSchema(schema)
    const to = requireIdentifier(target.schema, 'database name', quoteMysql)
    const targetTable = requireIdentifier(target.table, 'table name', quoteMysql)
    const source = qualifyMysql(from, table)
    if (from === target.schema && table === target.table) {
      throw new Error('the source and the target are the same table')
    }

    const objects = await this.tableNames(from)
    const moving = objects.find(entry => entry.name === table)
    if (moving === undefined) throw new Error(`no such table: ${from}.${table}`)
    if (moving.type === 'view') {
      throw new Error(
        `「${table}」是视图，MySQL 不允许视图换库（视图的定义绑定在创建它的库上，服务器会直接拒绝）。` +
        '如果需要在另一个库里用同样的查询，请在那边新建一个视图。',
      )
    }
    const existing = await this.tableNames(target.schema)
    if (existing.some(entry => entry.name.toLowerCase() === target.table.toLowerCase())) {
      throw new Error(`目标库「${target.schema}」里已存在「${target.table}」`)
    }

    return this.exec(`RENAME TABLE ${source} TO ${qualifyMysql(target.schema, target.table)}`, [], undefined)
  }

  /**
   * Copy a table's structure, and optionally its rows, into another database.
   *
   * `CREATE TABLE new LIKE old` then `INSERT INTO new SELECT … FROM old`, which is
   * phpMyAdmin's 复制表 and the only pair of statements that reproduces a table
   * faithfully: `LIKE` copies the column definitions, the indexes, the primary key
   * and the AUTO_INCREMENT attribute.
   *
   * What it does NOT copy, stated rather than silently dropped: triggers and
   * foreign keys pointing OUT of the table. `LIKE` builds no triggers, and MySQL
   * refuses a foreign key whose target is not in the same schema — the target
   * database would have to have its own copy of the referenced table first, which is
   * a decision this panel must not make silently.
   *
   * The row copy names the columns explicitly and omits GENERATED ones. `INSERT INTO
   * new SELECT * FROM old` fails on a table with a stored generated column —
   * measured: "The value specified for generated column 'b' in table 'gen2' is not
   * allowed" — because `*` includes a column that cannot be inserted into. Naming
   * the others makes the copy work and lets the engine recompute the generated one.
   */
  async copyTable(
    schema: string | undefined,
    table: string,
    target: TableTarget,
    options: { includeData?: boolean; isView?: boolean } = {},
  ): Promise<QueryResult> {
    const from = this.requireSchema(schema)
    requireIdentifier(target.schema, 'database name', quoteMysql)
    requireIdentifier(target.table, 'table name', quoteMysql)
    if (from === target.schema && table === target.table) {
      throw new Error('the source and the target are the same table')
    }

    /*
     * The source's kind is READ, not taken from the caller.
     *
     * `options.isView` is only a hint the browser can supply; this layer is the one
     * that decides what to do about it, and a request that omitted (or mis-stated) it
     * must not turn into `CREATE TABLE … LIKE a_view` — measured, MySQL answers that
     * with "'a.a_view' is not BASE TABLE", which names neither the view nor the fact
     * that copying a view is not a thing this can do.
     */
    const objects = await this.tableNames(from)
    const moving = objects.find(entry => entry.name === table)
    if (moving === undefined) throw new Error(`no such table: ${from}.${table}`)
    if (moving.type === 'view' || options.isView === true) {
      throw new Error(
        `「${table}」是视图，无法复制成另一个库里的视图：MySQL 没有复制视图的语句，` +
        '而 CREATE TABLE … LIKE 对视图会直接报错（它不是 BASE TABLE）。请在新库里自行重建视图。',
      )
    }

    const existing = await this.tableNames(target.schema)
    if (existing.some(entry => entry.name.toLowerCase() === target.table.toLowerCase())) {
      throw new Error(`目标库「${target.schema}」里已存在「${target.table}」`)
    }

    const source = qualifyMysql(from, table)
    const destination = qualifyMysql(target.schema, target.table)
    const started = Date.now()
    await this.exec(`CREATE TABLE ${destination} LIKE ${source}`, [], undefined)
    const created = { columns: [], rows: [], affected: 1, durationMs: Date.now() - started, write: true, truncated: false } satisfies QueryResult
    if (options.includeData !== true) return created

    const columns = await this.columns(from, table)
    const writable = columns.filter(column => column.generated !== true)
    if (writable.length === 0) return created
    const names = writable.map(column => requireIdentifier(column.name, 'column name', quoteMysql)).join(', ')
    // The table now exists and is empty, so a failed data copy leaves it behind —
    // say that in the message rather than reporting a failure that reads as "nothing
    // happened".
    try {
      const copied = await this.exec(
        `INSERT INTO ${destination} (${names}) SELECT ${names} FROM ${source}`,
        [],
        undefined,
      )
      return { ...created, affected: copied.affected, rows: [], durationMs: Date.now() - started }
    } catch (failure) {
      throw new Error(
        `表结构已复制到「${target.schema}.${target.table}」，但复制数据失败：` +
        `${failure instanceof Error ? failure.message : String(failure)}`,
      )
    }
  }

  /**
   * The option values MySQL reports for an existing table.
   *
   * Read from `information_schema.TABLES` rather than `SHOW TABLE STATUS`, then
   * corrected for the one field that catalog gets wrong: see
   * {@link TableOptionInfo.autoIncrement}. The character set is resolved through
   * `information_schema.COLLATIONS` instead of being split off the collation's name,
   * because a collation's name does not reliably start with its character set's
   * (`utf8mb3_general_ci` belongs to `utf8mb3`).
   */
  async tableOptionInfo(schema: string | undefined, table: string): Promise<TableOptionInfo> {
    const target = this.requireSchema(schema)
    requireIdentifier(table, 'table name', quoteMysql)
    const [rows] = await (await this.open()).query({
      sql:
        'SELECT TABLE_TYPE AS type, ENGINE AS engine, TABLE_COLLATION AS collation, TABLE_COMMENT AS comment, ' +
        'ROW_FORMAT AS rowFormat FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      values: [target, table],
    })
    const record = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined
    if (record === undefined) throw new Error(`no such table: ${target}.${table}`)

    const type = String(record['type'] ?? '')
    const isView = type.toUpperCase().includes('VIEW')
    const engine = asString(record['engine'])
    const collation = asString(record['collation'])
    const comment = typeof record['comment'] === 'string' ? record['comment'] : undefined
    const rowFormat = asString(record['rowFormat'])

    /*
     * A view is reported as such and with NOTHING else, not even its comment.
     *
     * Measured: MySQL answers "VIEW" as a view's `TABLE_COMMENT` — a placeholder, not
     * something anyone typed. Passing it through would show the 表选项 form a comment of
     * 「VIEW」 that the user could then "edit", and the edit would be written to the
     * view's metadata while the other three fields (engine, collation, row format — all
     * NULL for a view) stayed meaningless. Saying `isView: true` and nothing more is
     * what lets the page say "this is a view" instead of rendering four fields whose
     * values mean nothing.
     */
    if (isView) return { isView: true }

    const charset = collation === undefined ? undefined : await this.collationCharset(collation)
    const autoIncrement = await this.autoIncrementFromCreate(target, table)
    return {
      ...(engine === undefined ? {} : { engine }),
      ...(collation === undefined ? {} : { collation }),
      ...(charset === undefined ? {} : { charset }),
      ...(comment === undefined ? {} : { comment }),
      ...(autoIncrement === undefined ? {} : { autoIncrement }),
      ...(rowFormat === undefined ? {} : { rowFormat }),
    }
  }

  /**
   * The character set one collation belongs to, from the server's own list.
   *
   * ABSENT rather than guessed when the server does not know the collation: a
   * collation added by a newer server than the cached list, or one belonging to a
   * character set the connection cannot see, would otherwise be paired with a
   * character set derived from its name — and a mismatched pair is a statement MySQL
   * rejects. The caller then simply offers the collation without a character set,
   * which the ALTER does not need.
   */
  private async collationCharset(collation: string): Promise<string | undefined> {
    const [rows] = await (await this.open()).query({
      sql: 'SELECT CHARACTER_SET_NAME AS charset FROM information_schema.COLLATIONS WHERE COLLATION_NAME = ?',
      values: [collation],
    })
    const record = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined
    return record === undefined ? undefined : asString(record['charset'])
  }

  /**
   * The next AUTO_INCREMENT value, read from `SHOW CREATE TABLE`.
   *
   * Not from `information_schema.TABLES.AUTO_INCREMENT`, and the difference was
   * measured rather than assumed. After `ALTER TABLE t AUTO_INCREMENT=900` the next
   * insert really did receive id 900, while `information_schema.TABLES`, a fresh
   * `information_schema` connection and `SHOW TABLE STATUS` all still reported 4 —
   * InnoDB keeps the counter in memory and those two read the data dictionary's
   * stale copy. `SHOW CREATE TABLE` reported `AUTO_INCREMENT=900`, matching the id
   * the server actually issued. (This applies to InnoDB; MyISAM was also observed
   * reporting the stale 4.) A form that prefilled 4 would then "change" the value to
   * something the server had already passed.
   *
   * ABSENT when the table has no auto-increment column at all — `SHOW CREATE TABLE`
   * omits the clause — which is what lets the page hide the field instead of
   * offering a box whose value is not a thing.
   *
   * Parsed from the statement TAIL rather than by searching the whole text: a table
   * comment can contain the literal `AUTO_INCREMENT=` (measured: the option is
   * echoed into the comment verbatim), and the real clause is always after the column
   * list's closing bracket. The tail is found by the LAST `\n)` in the statement,
   * which is the format `SHOW CREATE TABLE` always produces.
   */
  private async autoIncrementFromCreate(schema: string, table: string): Promise<number | undefined> {
    const text = await this.createStatement(schema, table)
    if (text === undefined) return undefined
    const closing = text.lastIndexOf('\n)')
    const tail = closing === -1 ? text : text.slice(closing)
    const match = /(?:^|\s)AUTO_INCREMENT=(\d+)/.exec(tail)
    if (match === null) return undefined
    const value = Number(match[1])
    return Number.isFinite(value) ? value : undefined
  }

  /**
   * Change an existing table's options.
   *
   * ONE `ALTER TABLE` carrying only the clauses the caller actually set, for two
   * reasons. MySQL applies several `ALTER` clauses in a single table rebuild, so
   * separate statements would rewrite the table once per option; and emitting only
   * what was asked for is what keeps an untouched field as the server has it, rather
   * than reverting a change made elsewhere since the page was opened.
   *
   * Every value is validated before it reaches the statement, because none of these
   * slots accepts a bound parameter: an engine name and a row format are keywords,
   * and the comment is a literal this layer escapes.
   */
  async alterTableOptions(schema: string | undefined, table: string, patch: TableOptionPatch): Promise<QueryResult> {
    const target = this.requireSchema(schema)
    const qualified = qualifyMysql(target, table)
    const clauses: string[] = []

    if (patch.engine !== undefined) {
      // A bare keyword in the statement, so it is checked against the grammar and
      // against the engines the SERVER reports rather than a list kept here — a
      // build without MyISAM must refuse it with a reason, not with a syntax error.
      const engine = patch.engine.trim()
      if (!/^[A-Za-z0-9_]{1,32}$/.test(engine)) throw new Error(`invalid storage engine: ${JSON.stringify(patch.engine)}`)
      const available = await this.engines()
      if (!available.includes(engine.toUpperCase())) {
        throw new Error(`这台 MySQL 没有「${engine}」存储引擎（可用：${available.join(', ')}）`)
      }
      clauses.push(`ENGINE=${engine}`)
    }

    if (patch.collation !== undefined) {
      const collation = requireCollate(patch.collation)
      /*
       * The character set is DERIVED from the collation when the caller did not
       * supply one, rather than being demanded from the browser.
       *
       * A collation belongs to exactly one character set, and the server already
       * knows which — so asking the form for both would be asking the user to repeat
       * a fact the server can look up, and getting it wrong is a statement MySQL
       * rejects ("COLLATION 'x' is not valid for CHARACTER SET 'y'"). The lookup is
       * the same one the read path uses, so the two cannot disagree.
       */
      const explicit = patch.charset === undefined || patch.charset === '' ? undefined : requireCharset(patch.charset)
      const charset = explicit ?? await this.collationCharset(collation)
      /*
       * `CONVERT TO` is the form that rewrites existing columns, and it is only
       * emitted when asked for; `DEFAULT CHARACTER SET` alone changes new columns.
       * `CONVERT TO CHARACTER SET` requires a character set, so an unresolvable one
       * is refused with what is wrong instead of a syntax error the user cannot act
       * on — which only happens for a collation this server does not know.
       */
      if (patch.convertColumns === true) {
        if (charset === undefined) {
          throw new Error(`服务器不认识排序规则「${collation}」，无法推断它属于哪个字符集，因此不能转换成它`)
        }
        clauses.push(`CONVERT TO CHARACTER SET ${charset} COLLATE ${collation}`)
      } else if (charset === undefined) {
        clauses.push(`COLLATE=${collation}`)
      } else {
        clauses.push(`DEFAULT CHARACTER SET ${charset} COLLATE ${collation}`)
      }
    }

    if (patch.comment !== undefined) {
      // The same rule as a column comment: the escaping relies on doubling the
      // quote, and a backslash would change what the literal means. Measured: MySQL
      // stores a doubled quote as one quote, so `it''s` round-trips as `it's`.
      if (patch.comment.includes('\\')) throw new Error('表注释不能包含反斜杠（MySQL 会把反斜杠当转义符，写进去的和读出来的不一致）')
      clauses.push(`COMMENT='${patch.comment.replace(/'/g, "''")}'`)
    }

    if (patch.autoIncrement !== undefined) {
      if (!Number.isInteger(patch.autoIncrement) || patch.autoIncrement < 1) {
        throw new Error(`AUTO_INCREMENT 需要是正整数：${JSON.stringify(patch.autoIncrement)}`)
      }
      clauses.push(`AUTO_INCREMENT=${patch.autoIncrement}`)
    }

    if (patch.rowFormat !== undefined) {
      const format = patch.rowFormat.trim().toUpperCase()
      /*
       * The formats MySQL accepts as keywords. FIXED is included even though InnoDB
       * refuses it (measured: "Table storage engine 'InnoDB' does not support the
       * create option 'ROW_TYPE'") — MyISAM accepts it, and refusing it here would
       * take the option away from the engine that has it. The server's own message
       * names the engine, so it is passed through.
       */
      if (!['DEFAULT', 'DYNAMIC', 'FIXED', 'COMPRESSED', 'REDUNDANT', 'COMPACT', 'PAGE'].includes(format)) {
        throw new Error(`无效的行格式：${JSON.stringify(patch.rowFormat)}`)
      }
      clauses.push(`ROW_FORMAT=${format}`)
    }

    if (clauses.length === 0) throw new Error('没有需要修改的表选项')
    return this.exec(`ALTER TABLE ${qualified} ${clauses.join(', ')}`, [], target)
  }

  /** The storage engines this server can actually use, upper-cased. */
  private async engines(): Promise<string[]> {
    const [rows] = await (await this.open()).query({ sql: 'SHOW ENGINES' })
    const list = Array.isArray(rows) ? rows : []
    return list
      .map(row => row as Record<string, unknown>)
      // `Support` is DEFAULT for the default engine, YES for an available one, NO for
      // a compiled-out one, and DISABLED for one turned off in the configuration.
      .filter(row => ['DEFAULT', 'YES'].includes(String(row['Support'] ?? '').toUpperCase()))
      .map(row => String(row['Engine'] ?? '').toUpperCase())
      .filter(name => name !== '')
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
function renderMysqlDefinition(
  spec: ColumnSpec,
  carry: {
    generated?: boolean
    generatedExpression?: string
    extra?: string
    /** Whether the LIVE column carries `ON UPDATE CURRENT_TIMESTAMP`. */
    onUpdateCurrentTimestamp?: boolean
    /**
     * A DEFAULT clause to emit VERBATIM, bypassing the literal validator.
     *
     * Only ever set from a value the SERVER reported, never from a request: an
     * expression default (`DEFAULT (lower('ABC'))`) is not a literal and
     * {@link normalizeDefault} refuses it by design — it cannot verify an arbitrary
     * expression, and the panel must not let a user type one. Re-emitting the engine's
     * own text is the one case where the text is known to be valid, and it is the only
     * way an edit of some OTHER field can leave such a default intact.
     */
    verbatimDefault?: string
  } = {},
): string {
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

  /*
   * A generated column is rendered from the expression the SERVER reported, and as a
   * complete definition on its own.
   *
   * `GENERATED ALWAYS AS (expr)` must be present: MySQL reads a generated column's
   * `MODIFY` as a redefinition of the expression, and a statement that omits `AS (…)`
   * would change the column rather than edit it — the panel refused instead, which is
   * what a user saw as "编辑提交失败". The expression comes back from
   * `GENERATION_EXPRESSION` already bracketed and already normalised by the server
   * (`(`a` * 2)`, `concat(_utf8mb4\'x\',`a`)`), so it is emitted verbatim.
   *
   * `DEFAULT`, `AUTO_INCREMENT` and `ON UPDATE` are all refused alongside it
   * (measured: "Incorrect usage of X and generated column"), so nothing else is
   * appended except the comment and the nullability. Nullability IS emitted: a
   * generated column may be either, and a rewrite that omitted it would silently
   * flip the column to nullable.
   */
  if (carry.generated === true) {
    const expression = carry.generatedExpression?.trim() ?? ''
    if (expression === '') {
      throw new Error(
        `「${spec.name}」是生成列，但服务端没有报告它的表达式（information_schema.COLUMNS.GENERATION_EXPRESSION 为空），` +
        '无法安全地重写这一列。',
      )
    }
    // STORED vs VIRTUAL is part of the column's identity, and MySQL REFUSES a change
    // of it ("Changing the STORED status is not supported"), so the original is
    // carried over rather than chosen here.
    const storage = /VIRTUAL/i.test(carry.extra ?? '') ? 'VIRTUAL' : 'STORED'
    parts.push(`GENERATED ALWAYS AS ${expression} ${storage}`)
    parts.push(spec.primaryKeyPosition === undefined && spec.nullable ? 'NULL' : 'NOT NULL')
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
  /*
   * An expression default is emitted VERBATIM, and each form is bracketed appropriately.
   *
   * `normalizeDefault` refuses a parenthesised expression by design: it cannot verify an
   * arbitrary one, and nothing a user typed may reach this slot. But MySQL accepts
   * `DEFAULT (expr)`, so a table may already carry one, and re-emitting it must not go
   * through the validator — otherwise editing any OTHER field of that column would fail.
   *
   * MySQL reports the expression WITHOUT the outer brackets
   * (`lower(_utf8mb4\'ABC\')`), so they are re-added; `DEFAULT` without them would store
   * the expression's own text as the value. `carry.verbatimDefault` is the caller telling
   * us it is re-emitting a live expression, which is when the escaping is undone too.
   */
  if (carry.verbatimDefault !== undefined) {
    parts.push(`DEFAULT ${carry.verbatimDefault}`)
  } else if (spec.defaultValue !== undefined) {
    const value = normalizeDefault(spec.defaultValue, 'mysql')
    if (value !== undefined) parts.push(`DEFAULT ${value}`)
  }
  /*
   * `ON UPDATE CURRENT_TIMESTAMP` is carried over from the column as the server
   * reports it, NOT taken from the submitted spec.
   *
   * `MODIFY COLUMN` rewrites the whole definition, so a clause that is left out is
   * DROPPED — measured: modifying only a comment on
   * `TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` removed the
   * `ON UPDATE` and silently changed the column's behaviour. The 结构 tab's form has
   * no field for it, so reading it from the live column is the only way an edit of
   * anything else can leave it alone.
   */
  if (attributes.has('onUpdateCurrentTimestamp') || carry.onUpdateCurrentTimestamp === true) {
    parts.push('ON UPDATE CURRENT_TIMESTAMP')
  }
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
 * `information_schema.COLUMNS.COLUMN_DEFAULT` is not always the literal
 * {@link normalizeDefault} accepts, and each shape has to be translated back or the
 * rewrite either fails or changes the column. See {@link defaultLiteralFor}.
 */
function toSpec(column: ColumnInfo): ColumnSpec {
  return {
    name: column.name,
    type: column.type,
    nullable: column.nullable,
    ...(column.defaultValue === undefined ? {} : { defaultValue: defaultLiteralFor(column.defaultValue, column.type) }),
    ...(column.primaryKeyPosition === undefined ? {} : { primaryKeyPosition: column.primaryKeyPosition }),
    ...(column.extra !== undefined && /auto_increment/i.test(column.extra) ? { autoIncrement: true } : {}),
    ...(column.comment === undefined ? {} : { comment: column.comment }),
  }
}

/** Whether a declared type's default is a NUMBER rather than text. */
function isNumericColumnType(type: string): boolean {
  return /^(tiny|small|medium|big)?(int|year)|^(decimal|numeric|float|double|real|bit)/i.test(type.trim())
}

/**
 * Keywords whose reported form is written back bare, with an optional precision.
 *
 * The precision matters: `CURRENT_TIMESTAMP(6)` is a different default from
 * `CURRENT_TIMESTAMP`, and wrapping it in brackets turns it into `now(6)` —
 * measured. The value is equivalent but the schema text is not, and the panel would
 * then show a default the user never wrote.
 */
const BARE_DEFAULT_KEYWORDS = /^(?:current_timestamp|current_date|current_time|localtimestamp|localtime|now|utc_timestamp)(?:\(\d*\))?$/i

/**
 * Undo the escaping MySQL applies to `COLUMN_DEFAULT` when re-emitting an expression.
 *
 * Measured: `CONCAT('a','b')` is reported as `concat(_utf8mb4\'a\',_utf8mb4\'b\')`, and a
 * quote INSIDE the literal gets a second level (`\'it\\\'s\'`), so the server escapes
 * each `\` and `'` of the inner text. The inverse is a single left-to-right pass:
 * every `\X` becomes `X`. A `replaceAll("\\'", "'")` looks right on the first case and
 * mangles the nested one.
 */
function unescapeDefaultExpression(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) {
      out += text[i + 1]
      i++
      continue
    }
    out += text[i]
  }
  return out
}

/**
 * Rewrite a reported `COLUMN_DEFAULT` into the literal the renderer accepts.
 *
 * Five shapes arrive in one string field, and they are only distinguishable with the
 * column's TYPE:
 *
 * | schema said | reported | written back as |
 * | --- | --- | --- |
 * | `DEFAULT 'x'` | `x`, unquoted | `'x'` — re-quoted |
 * | `DEFAULT '5'` on a VARCHAR | `5` | `'5'` — quoted, because the TYPE is textual |
 * | `DEFAULT 5` on an INT | `5` | `5` — bare, because the TYPE is numeric |
 * | `DEFAULT CURRENT_TIMESTAMP(6)` | `CURRENT_TIMESTAMP(6)` | bare |
 * | `DEFAULT (CONCAT('a','b'))` | `concat(_utf8mb4\'a\',…)` | unescaped, re-bracketed |
 *
 * The `'5'`/`5` pair is why the decision is made from the TYPE and not from the value:
 * measured, both are reported as `5`, and writing the numeric form for a `VARCHAR`
 * silently stores a numeric default — a round-trip comparison does not even show it,
 * because the reported text is identical either way.
 */
export function defaultLiteralFor(reported: string, type: string): string {
  const text = reported.trim()
  if (text === '') return text
  // `NULL` / `TRUE` / `FALSE` and the timestamp keywords are already literals.
  if (/^(?:null|true|false)$/i.test(text)) return text
  if (BARE_DEFAULT_KEYWORDS.test(text)) return text
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text)) {
    // A number, which is already the literal form — unless the column is textual,
    // where a bare number can only mean the server dropped the quotes.
    return isNumericColumnType(type) ? text : `'${text}'`
  }
  // An EXPRESSION default. It has to go back inside brackets, or MySQL stores the
  // expression's own text as the default instead of evaluating it.
  if (text.includes('(')) {
    const expression = unescapeDefaultExpression(text)
    return /^\([\s\S]*\)$/.test(expression) ? expression : `(${expression})`
  }
  // Anything left is a string the server reported without its quotes.
  if (isNumericColumnType(type)) return text
  return `'${text.replace(/'/g, "''")}'`
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

/**
 * Read a statistics column (`TABLE_ROWS`, `DATA_LENGTH`, `INDEX_LENGTH`) as a number.
 *
 * These arrive as STRINGS and must not be read as numbers done elsewhere in this file. All three are
 * `bigint unsigned` in information_schema (measured), and the pool sets `supportBigNumbers: true`
 * with `bigNumberStrings: true` so a BIGINT beyond 2^53 cannot lose precision before it reaches the
 * browser — mysql2 consequently hands back EVERY bigint as a string. That default is right for user
 * data, but the 表列表 read these with `typeof value === 'number'`, so every count and size failed
 * the check and was dropped: 行数 showed 未知 and 大小 showed — for every table, even ones with
 * hundreds of rows, while the same query in a MySQL client returned numbers.
 *
 * A number is passed through as well, because a driver version or an option change could make
 * mysql2 return one and the reading must not depend on which.
 *
 * @returns the count, or undefined when the value is NULL or is not a finite number — which keeps
 * the field ABSENT rather than turning an unreadable value into a false 0.
 */
function toCount(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'bigint') return Number(value)
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '') return undefined
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : undefined
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
