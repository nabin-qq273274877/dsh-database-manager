/**
 * The /api/dsh-database route family — everything the browser panel calls.
 *
 * Authorization model: routes are the USER surface. The user clicking in the
 * panel is the authorization for a write, exactly as it is for the terminal.
 * Model-initiated writes never come through here; they go through the agent
 * tools and the {@link decideCall} gate in auth.ts.
 *
 * Secrets never leave: an entry is projected through `summarize()` on the way
 * out, and a password is only ever read from a request body, never returned.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute, WebUpgradeRoute } from './webserver-types.ts'
import { type GateSettings, decideCall } from './auth.ts'
import type { ConnectionPool } from './pool.ts'
import { probeEngines } from './pool.ts'
import type { DataSourceStore, StoredSettings } from './store.ts'
import { summarize, validatePayload } from './store.ts'
import { asJsonObject, errorMessage, readJsonBody, writeError, writeJson } from './http.ts'
import type { QueryResult } from './protocol.ts'
import { isRedisDriver, isSqlDriver, type Driver } from './drivers/types.ts'
import { isRedisReadCommand } from './drivers/redis.ts'
import { looksReadOnly } from './sql-util.ts'

/** Everything the routes need from the plugin. */
export interface RoutesDeps {
  store: DataSourceStore
  pool: ConnectionPool
  /** Live agent-write posture, echoed to the panel's settings strip. */
  gate: () => GateSettings
  /** Persist a settings patch. */
  saveGate: (patch: Partial<StoredSettings>) => GateSettings
}

/** Default page size when the caller names none. */
const DEFAULT_PAGE_SIZE = 200
/** Hard cap on one page, so a huge table cannot exhaust the host. */
const MAX_PAGE_SIZE = 5000
/** Default row cap on an arbitrary SQL read. */
const DEFAULT_SQL_LIMIT = 1000
/** Default SCAN page size. */
const DEFAULT_KEY_COUNT = 200

/** Read one query-string value. */
function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null || value === '' ? undefined : value
}

/** Read one integer query-string value, or the fallback. */
function queryInt(url: URL, name: string, fallback: number): number {
  const raw = queryParam(url, name)
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

/** Clamp a page size into the accepted range. */
function clampPageSize(value: number): number {
  if (!Number.isFinite(value) || value < 1) return DEFAULT_PAGE_SIZE
  return Math.min(Math.trunc(value), MAX_PAGE_SIZE)
}

/** Narrow a JSON value to a wire scalar, rejecting structured values. */
function isWireScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/** Extract a `{ column, value }` list from a request body field. */
function readPairs(value: unknown, what: string): Array<{ column: string; value: string | number | boolean | null }> {
  if (!Array.isArray(value)) throw new Error(`${what} must be an array of { column, value }`)
  return value.map((item, index) => {
    const record = asJsonObject(item)
    if (record === undefined) throw new Error(`${what}[${index}] must be an object`)
    const column = record['column']
    if (typeof column !== 'string' || column === '') throw new Error(`${what}[${index}].column must be a non-empty string`)
    const cell = record['value']
    if (!isWireScalar(cell)) throw new Error(`${what}[${index}].value must be a scalar`)
    return { column, value: cell }
  })
}

/**
 * Build the route table.
 * @param deps - store, pool, and the live gate accessor.
 * @returns routes plus their disposers, ready for `ctx.webServer.register`.
 */
export function makeRoutes(deps: RoutesDeps): { routes: WebRoute[]; upgrade: WebUpgradeRoute | undefined } {
  const { store, pool } = deps

  /** Route the request by its suffix under the sources prefix. */
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      writeError(res, 400, 'malformed request URL')
      return
    }
    const path = url.pathname
    const method = req.method ?? 'GET'

    try {
      // ---- Collection: /sources -------------------------------------------
      if (path === '/api/dsh-database/sources') {
        if (method === 'GET') {
          writeJson(res, 200, {
            sources: store.list().map(summarize),
            settings: deps.gate(),
          })
          return
        }
        if (method === 'POST') {
          const body = asJsonObject(await readJsonBody(req))
          if (body === undefined) {
            writeError(res, 400, 'body must be a JSON object')
            return
          }
          const payload = body as Record<string, unknown>
          const problem = validatePayload(payload as never)
          if (problem !== undefined) {
            writeError(res, 400, problem)
            return
          }
          const entry = store.create(payload as never)
          writeJson(res, 201, { source: summarize(entry) })
          return
        }
        writeError(res, 405, `${method} is not allowed on ${path}`)
        return
      }

      // ---- Unsaved connection test: /test-connection -----------------------
      // The dialog's 测试连接 button. Nothing is written to the store and no
      // driver is pooled, so a user can check a connection mid-edit without
      // committing it or disturbing the pool entry behind the open panel.
      if (path === '/api/dsh-database/test-connection') {
        if (method !== 'POST') {
          writeError(res, 405, `${method} is not allowed on ${path}`)
          return
        }
        const body = asJsonObject(await readJsonBody(req))
        if (body === undefined) {
          writeError(res, 400, 'body must be a JSON object')
          return
        }
        const baseId = typeof body['baseId'] === 'string' && body['baseId'] !== '' ? body['baseId'] : undefined
        let entry
        try {
          entry = store.draftEntry(body as never, baseId)
        } catch (error) {
          // A draft that cannot even be validated is reported as a failed TEST
          // rather than an HTTP error: the dialog shows it inline, next to the
          // button the user just pressed.
          writeJson(res, 200, { result: { ok: false, error: errorMessage(error) } })
          return
        }
        writeJson(res, 200, { result: await pool.testTransient(entry) })
        return
      }

      // ---- Engine availability: /engines ----------------------------------
      if (path === '/api/dsh-database/engines') {
        if (method !== 'GET') {
          writeError(res, 405, `${method} is not allowed on ${path}`)
          return
        }
        writeJson(res, 200, { engines: await probeEngines() })
        return
      }

      // ---- Settings: /settings --------------------------------------------
      if (path === '/api/dsh-database/settings') {
        if (method === 'GET') {
          writeJson(res, 200, { settings: deps.gate() })
          return
        }
        if (method === 'PATCH' || method === 'POST') {
          const body = asJsonObject(await readJsonBody(req))
          if (body === undefined) {
            writeError(res, 400, 'body must be a JSON object')
            return
          }
          const patch: Partial<StoredSettings> = {}
          if (typeof body['allowAgentWrite'] === 'boolean') patch.allowAgentWrite = body['allowAgentWrite']
          if (typeof body['requireApproval'] === 'boolean') patch.requireApproval = body['requireApproval']
          writeJson(res, 200, { settings: deps.saveGate(patch) })
          return
        }
        writeError(res, 405, `${method} is not allowed on ${path}`)
        return
      }

      // ---- Single source: /sources/<id>[/<action>] -------------------------
      const match = /^\/api\/dsh-database\/sources\/([^/]+)(?:\/(.+))?$/.exec(path)
      if (match === null) {
        writeError(res, 404, `no route for ${path}`)
        return
      }
      const id = decodeURIComponent(match[1]!)
      const action = match[2] ?? ''

      if (action === '') {
        if (method === 'GET') {
          const entry = store.find(id)
          if (entry === undefined) {
            writeError(res, 404, `no data source with id "${id}"`)
            return
          }
          writeJson(res, 200, { source: summarize(entry) })
          return
        }
        if (method === 'PATCH' || method === 'PUT') {
          const body = asJsonObject(await readJsonBody(req))
          if (body === undefined) {
            writeError(res, 400, 'body must be a JSON object')
            return
          }
          // Connection fields may have changed: release the pooled driver so
          // the next operation reconnects with the new values.
          pool.drop(id)
          const entry = store.update(id, body as never)
          writeJson(res, 200, { source: summarize(entry) })
          return
        }
        if (method === 'DELETE') {
          pool.drop(id)
          const removed = store.remove(id)
          if (!removed) {
            writeError(res, 404, `no data source with id "${id}"`)
            return
          }
          writeJson(res, 200, { removed: true })
          return
        }
        writeError(res, 405, `${method} is not allowed on ${path}`)
        return
      }

      if (action === 'test' && method === 'POST') {
        const entry = store.find(id)
        if (entry === undefined) {
          writeError(res, 404, `no data source with id "${id}"`)
          return
        }
        const driver = pool.acquire(entry)
        writeJson(res, 200, { result: await driver.test() })
        return
      }

      if (action === 'connect' && method === 'POST') {
        const entry = store.find(id)
        if (entry === undefined) {
          writeError(res, 404, `no data source with id "${id}"`)
          return
        }
        const driver = pool.acquire(entry)
        const result = await driver.test()
        if (!result.ok) {
          writeJson(res, 200, { ok: false, result })
          return
        }
        writeJson(res, 200, {
          ok: true,
          result,
          source: summarize(entry),
          ...(isRedisDriver(driver) ? { redis: await driver.info() } : {}),
          ...(isSqlDriver(driver) ? { schemas: await driver.schemas() } : {}),
        })
        return
      }

      // Everything below operates on a live driver.
      const entry = store.find(id)
      if (entry === undefined) {
        writeError(res, 404, `no data source with id "${id}"`)
        return
      }
      const driver: Driver = pool.acquire(entry)

      if (action === 'schemas' && method === 'GET') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'schemas is only available for SQL data sources')
          return
        }
        writeJson(res, 200, { schemas: await driver.schemas() })
        return
      }

      if (action === 'tables' && method === 'GET') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'tables is only available for SQL data sources')
          return
        }
        const schema = queryParam(url, 'schema')
        writeJson(res, 200, { tables: await driver.tables(schema) })
        return
      }

      if (action === 'columns' && method === 'GET') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'columns is only available for SQL data sources')
          return
        }
        const table = queryParam(url, 'table')
        if (table === undefined) {
          writeError(res, 400, 'table is required')
          return
        }
        writeJson(res, 200, { columns: await driver.columns(queryParam(url, 'schema'), table) })
        return
      }

      if (action === 'indexes' && method === 'GET') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'indexes is only available for SQL data sources')
          return
        }
        const table = queryParam(url, 'table')
        if (table === undefined) {
          writeError(res, 400, 'table is required')
          return
        }
        writeJson(res, 200, { indexes: await driver.indexes(queryParam(url, 'schema'), table) })
        return
      }

      if (action === 'rows') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'rows is only available for SQL data sources')
          return
        }
        if (method === 'GET') {
          const table = queryParam(url, 'table')
          if (table === undefined) {
            writeError(res, 400, 'table is required')
            return
          }
          const mode = queryParam(url, 'mode')
          const page = await driver.rows({
            ...(queryParam(url, 'schema') === undefined ? {} : { schema: queryParam(url, 'schema')! }),
            table,
            page: Math.max(1, queryInt(url, 'page', 1)),
            pageSize: clampPageSize(queryInt(url, 'pageSize', DEFAULT_PAGE_SIZE)),
            ...(queryParam(url, 'orderBy') === undefined ? {} : { orderBy: queryParam(url, 'orderBy')! }),
            ...(queryParam(url, 'orderDir') === 'desc' ? { orderDir: 'desc' as const } : {}),
            mode: mode === 'search' ? 'search' : 'browse',
            ...(queryParam(url, 'term') === undefined ? {} : { term: queryParam(url, 'term')! }),
            ...(queryParam(url, 'condition') === undefined ? {} : { condition: queryParam(url, 'condition')! }),
          })
          writeJson(res, 200, { page })
          return
        }
        writeError(res, 405, `${method} is not allowed on ${path}`)
        return
      }

      if (action === 'row') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'row is only available for SQL data sources')
          return
        }
        const body = asJsonObject(await readJsonBody(req))
        if (body === undefined) {
          writeError(res, 400, 'body must be a JSON object')
          return
        }
        const table = typeof body['table'] === 'string' ? body['table'] : undefined
        if (table === undefined || table === '') {
          writeError(res, 400, 'table is required')
          return
        }
        const schema = typeof body['schema'] === 'string' && body['schema'] !== '' ? body['schema'] : undefined

        if (method === 'POST') {
          const values = readPairs(body['values'], 'values')
          writeJson(res, 200, { result: await driver.insertRow(schema, table, values) })
          return
        }
        const keys = readPairs(body['keys'], 'keys')
        if (method === 'PATCH' || method === 'PUT') {
          const values = readPairs(body['values'], 'values')
          writeJson(res, 200, { result: await driver.updateRow(schema, table, values, keys) })
          return
        }
        if (method === 'DELETE') {
          writeJson(res, 200, { result: await driver.deleteRow(schema, table, keys) })
          return
        }
        writeError(res, 405, `${method} is not allowed on ${path}`)
        return
      }

      if (action === 'query') {
        if (method !== 'POST') {
          writeError(res, 405, `${method} is not allowed on ${path}`)
          return
        }
        const body = asJsonObject(await readJsonBody(req))
        if (body === undefined) {
          writeError(res, 400, 'body must be a JSON object')
          return
        }
        const sql = typeof body['sql'] === 'string' ? body['sql'] : undefined
        if (sql === undefined || sql.trim() === '') {
          writeError(res, 400, 'sql is required')
          return
        }
        const params = Array.isArray(body['params']) ? body['params'].filter(isWireScalar) : []
        const limit = clampPageSize(typeof body['limit'] === 'number' ? body['limit'] : DEFAULT_SQL_LIMIT)
        const schema = typeof body['schema'] === 'string' && body['schema'] !== '' ? body['schema'] : undefined
        const allowWrite = body['allowWrite'] === true
        if (isRedisDriver(driver)) {
          if (!allowWrite) {
            writeError(res, 400, 'use the redis/command route for Redis')
            return
          }
        }
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'query is only available for SQL data sources')
          return
        }
        // The 写入 checkbox in the SQL tab is the user's explicit authorization
        // for a write statement; without it the read-only surface applies.
        const result: QueryResult = allowWrite
          ? await driver.exec(sql, params, schema)
          : await driver.query(sql, params, limit, schema)
        writeJson(res, 200, { result })
        return
      }

      // ---- Redis-specific surface -----------------------------------------
      if (action === 'redis/info' && method === 'GET') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/info is only available for Redis data sources')
          return
        }
        writeJson(res, 200, { info: await driver.info() })
        return
      }

      if (action === 'redis/keys' && method === 'GET') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/keys is only available for Redis data sources')
          return
        }
        const page = await driver.keys({
          pattern: queryParam(url, 'pattern') ?? '*',
          cursor: queryParam(url, 'cursor') ?? '0',
          count: queryInt(url, 'count', DEFAULT_KEY_COUNT),
          db: queryInt(url, 'db', entry.db ?? 0),
        })
        writeJson(res, 200, { page })
        return
      }

      if (action === 'redis/value' && method === 'GET') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/value is only available for Redis data sources')
          return
        }
        const key = queryParam(url, 'key')
        if (key === undefined) {
          writeError(res, 400, 'key is required')
          return
        }
        const value = await driver.value(key, queryInt(url, 'db', entry.db ?? 0), queryInt(url, 'limit', 1000))
        writeJson(res, 200, { value })
        return
      }

      if (action === 'redis/command' && method === 'POST') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/command is only available for Redis data sources')
          return
        }
        const body = asJsonObject(await readJsonBody(req))
        if (body === undefined) {
          writeError(res, 400, 'body must be a JSON object')
          return
        }
        const args = Array.isArray(body['args']) ? body['args'].filter((item): item is string => typeof item === 'string') : []
        if (args.length === 0) {
          writeError(res, 400, 'args must be a non-empty array of strings')
          return
        }
        const allowWrite = body['allowWrite'] === true
        if (!allowWrite && !isRedisReadCommand(args[0]!)) {
          writeError(res, 403, `"${args[0]}" is a write command; tick 允许写入 in the console to run it`)
          return
        }
        writeJson(res, 200, { result: await driver.command(args, queryInt(url, 'db', entry.db ?? 0)) })
        return
      }

      writeError(res, 404, `no route for ${path}`)
    } catch (error) {
      // Every failure is reported as a JSON error with the engine's own
      // message intact — a driver error is the most useful thing we have.
      writeError(res, 500, errorMessage(error))
    }
  }

  const routes: WebRoute[] = [
    { kind: 'prefix', path: '/api/dsh-database', handler },
  ]
  return { routes, upgrade: undefined }
}

/** Names the agent tools use, re-exported so a route test can assert the split. */
export { decideCall, isRedisReadCommand, looksReadOnly }
