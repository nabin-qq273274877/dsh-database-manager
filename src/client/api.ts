/**
 * Browser-side API client for the /api/dsh-database route family. The only
 * data access path the panel components use — plain fetch, same origin.
 */

import {
  DB_API,
  DB_API_BASE,
  type DataSourcePayload,
  type DataSourceSummary,
  type EngineAvailability,
  type GateSettingsView,
  type QueryResult,
  type RedisCreateKey,
  type RedisCreateResult,
  type RedisDeletePrefixResult,
  type RedisDeleteResult,
  type RedisElementEdit,
  type RedisInfo,
  type RedisIndexEstimate,
  type RedisIndexLevel,
  type RedisIndexStatus,
  type RedisKeyPage,
  type RedisLevelPage,
  type RedisMutationResult,
  type RedisPrefixCount,
  type RedisSearchPage,
  type RedisValue,
  type SchemaInfo,
  type ColumnInfo,
  type IndexInfo,
  type TableInfo,
  type TablePage,
  type TestResult,
  type RowFilter,
  type SchemaChangePayload,
  type SchemaChangeResult,
  type ExportPayload,
  type ExportResponse,
  type ImportPayload,
  type ImportResponse,
  type MaintenanceOpView,
  type MaintenanceOutcome,
  type DatabaseOpView,
  type TableActionOp,
  type TableOptionInfo,
  type TableOptionPatch,
  type TableTarget,
} from '../protocol.ts'

/** Error carrying the route's JSON error message. */
/**
 * Error carrying the route's JSON error message.
 *
 * `status` is kept because callers act on specific codes rather than on the text: a
 * 409 from the index route means "nothing indexed yet", which is a normal state the
 * panel handles by falling back, not something to show the user.
 */
export class DbApiError extends Error {
  /** HTTP status, when the failure came from a response. */
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'DbApiError'
    this.status = status
  }
}

/**
 * Parse a JSON response or throw a DbApiError carrying the server's message.
 *
 * A non-Response argument is reported as such instead of as a status code. That
 * is not hypothetical: a double-parse bug (calling this on an already-parsed
 * object) produced "HTTP undefined: invalid JSON response" for requests the
 * server had answered with 200, which sent the investigation to the host when
 * the fault was entirely in the client.
 */
async function readJson<T>(response: Response): Promise<T> {
  if (typeof (response as { json?: unknown } | null | undefined)?.json !== 'function') {
    throw new DbApiError(
      'internal error: readJson was given a value that is not a Response ' +
      '(the response was most likely already parsed)',
    )
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new DbApiError(`HTTP ${response.status}: invalid JSON response`, response.status)
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${response.status}`
    throw new DbApiError(message, response.status)
  }
  return body as T
}

/** Build a query string from defined parameters. */
function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  return search.toString()
}

/** One JSON POST/PATCH/DELETE helper. */
async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return readJson<T>(response)
}

/** The panel's complete API surface. */
export class DbApi {
  /** List every configured data source plus the live write posture. */
  async listSources(): Promise<{ sources: DataSourceSummary[]; settings: GateSettingsView }> {
    return readJson(await fetch(DB_API.sources))
  }

  /** Which engines this host can actually drive (a missing dependency shows here). */
  async engines(): Promise<EngineAvailability[]> {
    return (await readJson<{ engines: EngineAvailability[] }>(await fetch(`${DB_API_BASE}/engines`))).engines
  }

  /** Read the write posture. */
  async getSettings(): Promise<GateSettingsView> {
    return (await readJson<{ settings: GateSettingsView }>(await fetch(`${DB_API_BASE}/settings`))).settings
  }

  /**
   * Patch the write posture.
   *
   * `send` already parses the response, so the result is destructured directly.
   * Wrapping it in another `readJson` (as this did) called `.json()` on a plain
   * object: the throw was then reported as "HTTP undefined: invalid JSON
   * response", because the caught value had no `status` — a misleading message
   * for a request the server had in fact answered with 200.
   */
  async setSettings(patch: Partial<GateSettingsView>): Promise<GateSettingsView> {
    return (await send<{ settings: GateSettingsView }>(`${DB_API_BASE}/settings`, 'PATCH', patch)).settings
  }

  /** Create a data source. */
  async createSource(payload: DataSourcePayload): Promise<DataSourceSummary> {
    return (await send<{ source: DataSourceSummary }>(DB_API.sources, 'POST', payload)).source
  }

  /** Update a data source; an omitted password keeps the stored one. */
  async updateSource(id: string, payload: DataSourcePayload): Promise<DataSourceSummary> {
    return (await send<{ source: DataSourceSummary }>(`${DB_API.sources}/${encodeURIComponent(id)}`, 'PATCH', payload)).source
  }

  /** Delete a data source. */
  async deleteSource(id: string): Promise<void> {
    await send(`${DB_API.sources}/${encodeURIComponent(id)}`, 'DELETE')
  }

  /** Test connectivity. */
  async test(id: string): Promise<TestResult> {
    return (await send<{ result: TestResult }>(DB_API.test(id), 'POST')).result
  }

  /**
   * Test an UNSAVED payload. Nothing is stored, so the dialog can verify a
   * connection before the user commits the form.
   * @param payload - the draft fields.
   * @param baseId - the entry being edited, so an untouched password falls back
   *   to the stored one (the browser never receives it).
   */
  async testConnection(payload: DataSourcePayload, baseId?: string): Promise<TestResult> {
    return (await send<{ result: TestResult }>(DB_API.testConnection, 'POST', {
      ...payload,
      ...(baseId === undefined ? {} : { baseId }),
    })).result
  }

  /** Connect and fetch the opening payload for the database panel. */
  async connect(id: string): Promise<{
    ok: boolean
    result: TestResult
    source?: DataSourceSummary
    schemas?: SchemaInfo[]
    redis?: RedisInfo
  }> {
    return send(DB_API.database(id), 'POST')
  }

  /** Databases/schemas of a SQL source. */
  async schemas(id: string): Promise<SchemaInfo[]> {
    return (await readJson<{ schemas: SchemaInfo[] }>(await fetch(DB_API.schemas(id)))).schemas
  }

  /** Tables and views of one schema. `stats` also fills in row counts and sizes. */
  async tables(id: string, schema?: string, stats?: boolean): Promise<TableInfo[]> {
    const params = query({ schema, stats: stats === true ? '1' : undefined })
    return (await readJson<{ tables: TableInfo[] }>(await fetch(DB_API.tables(id, params)))).tables
  }

  /** Columns of one table. */
  async columns(id: string, table: string, schema?: string): Promise<ColumnInfo[]> {
    return (await readJson<{ columns: ColumnInfo[] }>(await fetch(DB_API.columns(id, query({ schema, table }))))).columns
  }

  /** Indexes of one table. */
  async indexes(id: string, table: string, schema?: string): Promise<IndexInfo[]> {
    return (await readJson<{ indexes: IndexInfo[] }>(await fetch(DB_API.indexes(id, query({ schema, table }))))).indexes
  }

  /** One page of table rows. */
  async rows(id: string, options: {
    schema?: string
    table: string
    page: number
    pageSize: number
    mode: 'browse' | 'search'
    term?: string
    condition?: string
    orderBy?: string
    orderByColumns?: string[]
    orderDir?: 'asc' | 'desc'
    filters?: RowFilter[]
    filterJoin?: 'and' | 'or'
    /** Also return the table's index list, so 按索引排序 needs one request. */
    withIndexes?: boolean
  }): Promise<TablePage> {
    const url = `${DB_API.rows(id)}?${query({
      ...options,
      // A condition list is one JSON parameter rather than a parameter per
      // field: the shape is a list, and flattening it into repeated names would
      // lose the association between a condition's column and its operand.
      filters: options.filters === undefined || options.filters.length === 0 ? undefined : JSON.stringify(options.filters),
      orderByColumns: options.orderByColumns === undefined || options.orderByColumns.length === 0
        ? undefined
        : options.orderByColumns.join(','),
      withIndexes: options.withIndexes === true ? '1' : undefined,
    })}`
    return (await readJson<{ page: TablePage }>(await fetch(url))).page
  }

  /** Delete several rows in one request and one transaction. */
  async deleteRows(id: string, body: {
    schema?: string
    table: string
    keySets: Array<Array<{ column: string; value: string | number | boolean | null }>>
  }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(DB_API.deleteRows(id), 'POST', body)).result
  }

  /** How many distinct values a column holds. */
  async distinctCount(id: string, options: { schema?: string; table: string; column: string }): Promise<number> {
    return (await readJson<{ count: number }>(await fetch(DB_API.distinct(id, query(options))))).count
  }

  /** One schema change: add / alter / drop a column, set the key, manage an index. */
  async changeSchema(id: string, body: SchemaChangePayload): Promise<SchemaChangeResult> {
    return (await send<{ result: SchemaChangeResult }>(DB_API.schema(id), 'POST', body)).result
  }

  /** Export a schema or one table. The text comes back for the browser to save. */
  async exportData(id: string, body: ExportPayload): Promise<ExportResponse> {
    return send<ExportResponse>(DB_API.exportData(id), 'POST', body)
  }

  /** Import a SQL dump or a CSV file. */
  async importData(id: string, body: ImportPayload): Promise<ImportResponse> {
    return (await send<{ result: ImportResponse }>(DB_API.importData(id), 'POST', body)).result
  }

  /** Which table-maintenance operations this engine can actually perform. */
  async maintenanceSupport(id: string): Promise<MaintenanceOpView[]> {
    return (await readJson<{ support: MaintenanceOpView[] }>(await fetch(DB_API.maintenanceSupport(id)))).support
  }

  /** Run table maintenance on one or many tables. */
  async maintain(id: string, body: { schema?: string; tables: string[]; op: MaintenanceOpView }): Promise<MaintenanceOutcome[]> {
    return (await send<{ results: MaintenanceOutcome[] }>(DB_API.maintain(id), 'POST', body)).results
  }

  /** Run one database-level operation (create / drop / rename / copy / charset). */
  async databaseOperation(id: string, body: {
    op: DatabaseOpView
    /** The new / target database name. */
    name: string
    /** The existing database, for rename and copy. */
    from?: string
    charset?: string
    collate?: string
    includeData?: boolean
  }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(DB_API.databaseOp(id), 'POST', body)).result
  }

  /** Insert one row. */
  async insertRow(id: string, body: { schema?: string; table: string; values: Array<{ column: string; value: string | number | boolean | null }> }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(DB_API.row(id), 'POST', body)).result
  }

  /** Insert several rows in one transaction; the host validates they share columns. */
  async insertRows(id: string, body: { schema?: string; table: string; rows: Array<Array<{ column: string; value: string | number | boolean | null }>> }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(`${DB_API.row(id)}/batch`, 'POST', body)).result
  }

  /** Update rows matched by keys. */
  async updateRow(id: string, body: { schema?: string; table: string; values: Array<{ column: string; value: string | number | boolean | null }>; keys: Array<{ column: string; value: string | number | boolean | null }> }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(DB_API.row(id), 'PATCH', body)).result
  }

  /** Delete rows matched by keys. */
  async deleteRow(id: string, body: { schema?: string; table: string; keys: Array<{ column: string; value: string | number | boolean | null }> }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(DB_API.row(id), 'DELETE', body)).result
  }

  /** Empty a table or drop it.
   *
   * `op` is explicit rather than inferred from the HTTP method: both actions
   * are destructive and irreversible, so a malformed request must not be able
   * to become a dropped table by omission.
   */
  async tableAction(id: string, body: { schema?: string; table: string; op: 'truncate' | 'drop'; isView?: boolean }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(DB_API.table(id), 'POST', body)).result
  }

  /** Which of the 操作 tab's three blocks this engine can actually perform. */
  async tableActionSupport(id: string): Promise<TableActionOp[]> {
    return (await readJson<{ support: TableActionOp[] }>(await fetch(DB_API.tableActions(id)))).support
  }

  /** Move a table to another database. Irreversible for the source: the object moves. */
  async moveTable(id: string, body: { schema?: string; table: string; target: TableTarget }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(DB_API.tableMove(id), 'POST', body)).result
  }

  /** Copy a table's structure, and optionally its rows, into another database. */
  async copyTable(id: string, body: {
    schema?: string
    table: string
    target: TableTarget
    includeData?: boolean
    isView?: boolean
  }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(DB_API.tableCopy(id), 'POST', body)).result
  }

  /**
   * The option values one existing table reports.
   *
   * Read fresh each time the 表选项 block is opened, rather than cached: the values
   * are what the form is filled in against, and a cached copy would let the form
   * submit a value the server has since changed.
   */
  async tableOptions(id: string, options: { schema?: string; table: string }): Promise<TableOptionInfo> {
    return (await readJson<{ options: TableOptionInfo }>(await fetch(DB_API.tableOptions(id, query(options))))).options
  }

  /** Change an existing table's options; absent fields are left alone. */
  async setTableOptions(id: string, body: { schema?: string; table: string; patch: TableOptionPatch }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(
      DB_API.tableOptions(id, query({ schema: body.schema, table: body.table })),
      'POST',
      body.patch,
    )).result
  }

  /** Run one SQL statement. `allowWrite` is the 允许写入 checkbox. */
  async runSql(id: string, body: { sql: string; params?: unknown[]; schema?: string; limit?: number; allowWrite?: boolean }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(DB_API.query(id), 'POST', body)).result
  }

  /** Redis server overview. */
  async redisInfo(id: string): Promise<RedisInfo> {
    return (await readJson<{ info: RedisInfo }>(await fetch(DB_API.redisInfo(id)))).info
  }

  /** One SCAN page of Redis keys. */
  async redisKeys(id: string, options: { pattern: string; cursor: string; count: number; db: number }): Promise<RedisKeyPage> {
    return (await readJson<{ page: RedisKeyPage }>(await fetch(DB_API.redisKeys(id, query(options))))).page
  }

  /** One Redis key's value. */
  async redisValue(id: string, options: { key: string; db: number; limit?: number }): Promise<RedisValue> {
    return (await readJson<{ value: RedisValue }>(await fetch(DB_API.redisValue(id, query(options))))).value
  }

  /** Run one Redis command. `allowWrite` is the 允许写入 checkbox. */
  async redisCommand(id: string, body: { args: string[]; db: number; allowWrite?: boolean }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(`${DB_API.redisCommand(id)}?${query({ db: body.db })}`, 'POST', {
      args: body.args,
      allowWrite: body.allowWrite,
    })).result
  }

  /**
   * Search one database for keys matching a Redis glob pattern.
   *
   * Server-side `SCAN MATCH`, so the pattern is real Redis glob syntax and the
   * search covers folders that are not expanded. Distinct from
   * {@link redisLevel}, which reads one level of the tree.
   */
  async redisSearch(id: string, options: { db: number; pattern: string }): Promise<RedisSearchPage> {
    return (await readJson<{ page: RedisSearchPage }>(
      await fetch(DB_API.redisSearch(id, query({ db: options.db, pattern: options.pattern }))),
    )).page
  }

  /**
   * What a keyspace walk would cost, before anything is scanned.
   *
   * Exists so the panel can warn before loading the server: a walk of a huge
   * database takes tens of seconds and holds the server's CPU, and the user should
   * decide that consciously rather than discover it.
   */
  async redisIndexEstimate(id: string, options: { db: number }): Promise<RedisIndexEstimate> {
    return (await readJson<{ estimate: RedisIndexEstimate }>(
      await fetch(DB_API.redisIndexEstimate(id, query({ db: options.db }))),
    )).estimate
  }

  /**
   * Start (or resume) the keyspace walk for one database, returning its status.
   *
   * Idempotent on the host, so calling it again while a walk runs just reports
   * progress — the panel polls this rather than tracking progress itself.
   */
  async redisIndexStart(id: string, options: { db: number }): Promise<RedisIndexStatus> {
    return (await readJson<{ status: RedisIndexStatus }>(
      await fetch(DB_API.redisIndex(id, query({ db: options.db }))),
    )).status
  }

  /** Drop a cached index, so the next read rebuilds it. */
  async redisIndexInvalidate(id: string, options: { db: number }): Promise<void> {
    await readJson(await fetch(DB_API.redisIndex(id, query({ db: options.db })), { method: 'DELETE' }))
  }

  /**
   * One level of the cached keyspace index.
   *
   * Answers from memory on the host, so expanding a level costs no scanning at all —
   * which is the entire reason the index exists. Throws on 409 when no index has
   * been built, letting the caller decide to build one.
   */
  async redisIndexLevel(id: string, options: { db: number; prefix: string; withTypes: boolean }): Promise<RedisIndexLevel> {
    return (await readJson<{ level: RedisIndexLevel }>(
      await fetch(DB_API.redisIndexLevel(id, query({
        db: options.db,
        prefix: options.prefix,
        withTypes: options.withTypes ? '1' : '0',
      }))),
    )).level
  }

  /**
   * One folder level of one database.
   *
   * The tree loads this way rather than whole-database: a level scan is bounded
   * by the level's own size, and a folder the user never opens is never read.
   * `withTypes: false` skips the TYPE/TTL round trips (useful for a level that
   * is all folders).
   */
  async redisLevel(id: string, options: { db: number; prefix: string; withTypes: boolean }): Promise<RedisLevelPage> {
    return (await readJson<{ page: RedisLevelPage }>(
      await fetch(DB_API.redisLevel(id, query({
        db: options.db,
        prefix: options.prefix,
        withTypes: options.withTypes ? '1' : '0',
      }))),
    )).page
  }

  /** Replace a string key's value; TTL is preserved. */
  async redisSetString(id: string, body: { key: string; value: string; db: number }): Promise<RedisMutationResult> {
    return (await send<{ result: RedisMutationResult }>(
      `${DB_API.redisString(id)}?${query({ db: body.db })}`, 'POST',
      { key: body.key, value: body.value },
    )).result
  }

  /** Set a key's TTL; `ttl: null` means no expiry (PERSIST, not EXPIRE 0). */
  async redisSetTtl(id: string, body: { key: string; ttl: number | null; db: number }): Promise<RedisMutationResult> {
    return (await send<{ result: RedisMutationResult }>(
      `${DB_API.redisTtl(id)}?${query({ db: body.db })}`, 'POST',
      { key: body.key, ttl: body.ttl },
    )).result
  }

  /** Add, change or remove one element of a collection key. */
  async redisEditElement(id: string, body: {
    key: string
    db: number
    edit: RedisElementEdit
  }): Promise<RedisMutationResult> {
    return (await send<{ result: RedisMutationResult }>(
      `${DB_API.redisElement(id)}?${query({ db: body.db })}`, 'POST',
      { key: body.key, ...body.edit },
    )).result
  }

  /** Create one or more keys; resolves with the names that were created. */
  async redisCreateKeys(id: string, options: { db: number; keys: RedisCreateKey[] }): Promise<string[]> {
    return (await send<RedisCreateResult>(`${DB_API.redisCreate(id)}?${query({ db: options.db })}`, 'POST', {
      keys: options.keys,
    })).created
  }

  /** Delete one key; resolves with whether it existed. */
  async redisDeleteKey(id: string, options: { key: string; db: number }): Promise<boolean> {
    return (await send<RedisDeleteResult>(DB_API.redisDeleteKey(id, query(options)), 'DELETE')).removed
  }

  /** How many keys a folder holds, for the delete confirmation. */
  async redisPrefixCount(id: string, options: { prefix: string; db: number }): Promise<number> {
    return (await readJson<RedisPrefixCount>(await fetch(DB_API.redisPrefixCount(id, query(options))))).count
  }

  /** Delete a folder: its own key plus every descendant. Irreversible. */
  async redisDeletePrefix(id: string, options: { prefix: string; db: number }): Promise<RedisDeletePrefixResult> {
    return (await send<{ result: RedisDeletePrefixResult }>(
      `${DB_API.redisDeletePrefix(id)}?${query({ prefix: options.prefix, db: options.db })}`,
      'DELETE',
    )).result
  }
}
