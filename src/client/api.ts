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
} from '../protocol.ts'

/** Error carrying the route's JSON error message. */
export class DbApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DbApiError'
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
    throw new DbApiError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${response.status}`
    throw new DbApiError(message)
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

  /** Tables and views of one schema. */
  async tables(id: string, schema?: string): Promise<TableInfo[]> {
    return (await readJson<{ tables: TableInfo[] }>(await fetch(DB_API.tables(id, query({ schema }))))).tables
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
    orderDir?: 'asc' | 'desc'
  }): Promise<TablePage> {
    const url = `${DB_API.rows(id)}?${query(options)}`
    return (await readJson<{ page: TablePage }>(await fetch(url))).page
  }

  /** Insert one row. */
  async insertRow(id: string, body: { schema?: string; table: string; values: Array<{ column: string; value: string | number | boolean | null }> }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(DB_API.row(id), 'POST', body)).result
  }

  /** Update rows matched by keys. */
  async updateRow(id: string, body: { schema?: string; table: string; values: Array<{ column: string; value: string | number | boolean | null }>; keys: Array<{ column: string; value: string | number | boolean | null }> }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(DB_API.row(id), 'PATCH', body)).result
  }

  /** Delete rows matched by keys. */
  async deleteRow(id: string, body: { schema?: string; table: string; keys: Array<{ column: string; value: string | number | boolean | null }> }): Promise<QueryResult> {
    return (await send<{ result: QueryResult }>(DB_API.row(id), 'DELETE', body)).result
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
