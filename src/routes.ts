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
import type {
  ExportResponse,
  ImportResponse,
  QueryResult,
  RedisCreatableType,
  RedisCreateKey,
  RedisCreateResult,
  RedisDeletePrefixResult,
  RedisDeleteResult,
  RedisElementEdit,
  RedisKeyInfo,
  RedisPrefixCount,
  SchemaChangeResult,
} from './protocol.ts'
import { REDIS_CREATABLE_TYPES } from './protocol.ts'
import type { ColumnSpec, RowFilter, RowFilterOperator } from './drivers/types.ts'
import { MAINTENANCE_OPS, ROW_FILTER_OPERATORS } from './drivers/types.ts'
import type { DatabaseOperationOptions, MaintenanceOp } from './drivers/types.ts'
import { isRedisDriver, isSqlDriver, type Driver, type SqlDriver } from './drivers/types.ts'
import { isRedisReadCommand } from './drivers/redis.ts'
import type { IndexRegistry } from './index-registry.ts'
import { estimateIndexCost, indexProgress, levelFromIndex } from './redis-index.ts'
import { compareKeyNames } from './redis-util.ts'
import { looksReadOnly } from './sql-util.ts'
import { EXPORT_ROW_CAP, IMPORT_BYTE_CAP, exportSql, importSql, type ExportRequest } from './sql-transfer.ts'

/** Everything the routes need from the plugin. */
export interface RoutesDeps {
  store: DataSourceStore
  pool: ConnectionPool
  /**
   * Cached keyspace trees, one per source and database.
   *
   * Optional so an older caller (or a test) can omit it: the index routes then
   * report "not built" instead of failing, and the panel falls back to the per-level
   * scan. That keeps the feature additive rather than load-bearing.
   */
  indexes?: IndexRegistry
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
/**
 * Cap on rows one batch delete may carry.
 *
 * A select-all over a page is bounded by the page size, which is bounded by
 * {@link MAX_PAGE_SIZE}, so this is the ceiling for "delete everything I can see
 * at once" and not a limit a normal interaction meets.
 */
const MAX_BATCH_ROWS = 5000
/**
 * Cap on tables one maintenance request may name.
 *
 * A select-all over a table list is bounded by how many tables a database has, so
 * this is a guard against a pathological schema rather than a limit a normal
 * selection meets.
 */
const MAX_BATCH_TABLES = 500
/**
 * Body cap for an import request.
 *
 * Larger than the family default (1 MiB) because the body IS the file, base64 of
 * it as JSON text. It is above the importer's own
 * {@link IMPORT_BYTE_CAP} so a file the importer would have refused is refused
 * by the importer, with a message naming the limit, rather than by a silent
 * body-length rejection.
 */
const IMPORT_BODY_MAX_BYTES = IMPORT_BYTE_CAP + 1024 * 1024

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

/**
 * Validate a filter list from the wire.
 *
 * `operator` is checked against the closed set here, not only in the driver:
 * a mistyped operator must be a 400 naming the field rather than a driver error
 * that reads like an SQL failure.
 *
 * @throws when an entry is not an object with a usable column and operator.
 */
function parseFilters(value: unknown): RowFilter[] {
  if (!Array.isArray(value)) throw new Error('must be an array of conditions')
  if (value.length > 50) throw new Error('too many conditions (max 50)')
  return value.map((entry, index) => {
    const record = asJsonObject(entry)
    if (record === undefined) throw new Error(`[${index}] must be an object`)
    const column = record['column']
    if (typeof column !== 'string' || column === '') throw new Error(`[${index}].column must be a non-empty string`)
    const operator = record['operator']
    if (typeof operator !== 'string' || !(ROW_FILTER_OPERATORS as readonly string[]).includes(operator)) {
      throw new Error(`[${index}].operator must be one of ${ROW_FILTER_OPERATORS.join(', ')}`)
    }
    const read = (name: string): string | undefined => {
      const raw = record[name]
      if (raw === undefined || raw === null) return undefined
      if (typeof raw === 'string') return raw
      if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
      throw new Error(`[${index}].${name} must be a scalar`)
    }
    return {
      column,
      operator: operator as RowFilterOperator,
      ...(read('value') === undefined ? {} : { value: read('value')! }),
      ...(read('value2') === undefined ? {} : { value2: read('value2')! }),
    }
  })
}

/** Read a {@link ColumnSpec} out of a request body field. */
function readColumnSpec(value: unknown, what: string): ColumnSpec {
  const record = asJsonObject(value)
  if (record === undefined) throw new Error(`${what} must be an object`)
  const name = record['name']
  if (typeof name !== 'string' || name === '') throw new Error(`${what}.name must be a non-empty string`)
  const type = typeof record['type'] === 'string' ? record['type'] : ''
  // An omitted `nullable` means NOT NULL, which is the safe reading: a column
  // presented as nullable but stored NOT NULL is a data-loss surprise, whereas
  // the reverse is a refused insert the user can see.
  const nullable = record['nullable'] === true
  const defaultValue = typeof record['defaultValue'] === 'string' ? record['defaultValue'] : undefined
  const comment = typeof record['comment'] === 'string' ? record['comment'] : undefined
  let primaryKeyPosition: number | undefined
  if (record['primaryKeyPosition'] !== undefined && record['primaryKeyPosition'] !== null) {
    if (typeof record['primaryKeyPosition'] !== 'number' || !Number.isInteger(record['primaryKeyPosition']) || record['primaryKeyPosition'] < 1) {
      throw new Error(`${what}.primaryKeyPosition must be a positive integer`)
    }
    primaryKeyPosition = record['primaryKeyPosition']
  }
  return {
    name,
    type,
    nullable,
    ...(defaultValue === undefined ? {} : { defaultValue }),
    ...(comment === undefined ? {} : { comment }),
    ...(primaryKeyPosition === undefined ? {} : { primaryKeyPosition }),
    ...(record['autoIncrement'] === true ? { autoIncrement: true } : {}),
    ...(record['unique'] === true ? { unique: true } : {}),
  }
}

/** One validated schema change. */
interface SchemaChange {
  action: string
  schema?: string
  table: string
  column?: string
  spec?: ColumnSpec
  rename?: string
  columns?: string[]
  index?: { name: string; columns: string[]; unique: boolean }
  /** `createTable`: the columns to create. */
  specs?: ColumnSpec[]
  /** `createTable`: a table-level primary key over these columns. */
  primaryKey?: string[]
}

/**
 * Validate a schema-change request into a {@link SchemaChange}.
 *
 * The action decides which fields are required, so a request missing one fails
 * with a message naming it instead of reaching a driver with an undefined field.
 */
function parseSchemaChange(body: Record<string, unknown>): { change: SchemaChange } | { error: string } {
  try {
    const table = body['table']
    if (typeof table !== 'string' || table === '') return { error: 'table is required' }
    const schema = typeof body['schema'] === 'string' && body['schema'] !== '' ? body['schema'] : undefined
    const action = body['action']
    if (typeof action !== 'string') return { error: 'action is required' }
    const base = { action, table, ...(schema === undefined ? {} : { schema }) }

    switch (action) {
      case 'createTable': {
        /*
         * A new table: the column list is the whole request.
         *
         * Read from `specs`, NOT from `columns`. `columns` already means "a list of
         * column NAMES" for `setPrimaryKey`, so using it for full column specs made one
         * key carry two shapes — and the mismatch was silent in the types (both are
         * arrays) but fatal at runtime: the first version read `columns`, the client
         * sent `specs`, and every create failed with "columns must be a non-empty
         * array". Caught by an end-to-end create, not by the type checker.
         *
         * Each column goes through `readColumnSpec`, the validator `addColumn` uses, so
         * a column created here cannot bypass the checks the column editor is held to.
         */
        const columns = body['specs']
        if (!Array.isArray(columns) || columns.length === 0) {
          return { error: 'specs must be a non-empty array of column specs for createTable' }
        }
        const specs: ColumnSpec[] = []
        for (const [index, entry] of columns.entries()) {
          specs.push(readColumnSpec(entry, `columns[${index}]`))
        }
        const primaryKey = body['primaryKey']
        if (primaryKey !== undefined && (!Array.isArray(primaryKey) || primaryKey.some(entry => typeof entry !== 'string' || entry === ''))) {
          return { error: 'primaryKey must be an array of column names when present' }
        }
        return { change: { ...base, specs, ...(primaryKey === undefined ? {} : { primaryKey: primaryKey as string[] }) } }
      }
      case 'addColumn':
        return { change: { ...base, spec: readColumnSpec(body['column'], 'column') } }
      case 'alterColumn': {
        const spec = readColumnSpec(body['column'], 'column')
        const rename = body['rename']
        if (rename !== undefined && (typeof rename !== 'string' || rename === '')) {
          return { error: 'rename must be a non-empty string when present' }
        }
        return { change: { ...base, spec, ...(rename === undefined ? {} : { rename }) } }
      }
      case 'dropColumn': {
        const column = body['column']
        if (typeof column !== 'string' || column === '') return { error: 'column is required for dropColumn' }
        return { change: { ...base, column } }
      }
      case 'setPrimaryKey': {
        const columns = body['columns']
        if (!Array.isArray(columns) || columns.some(entry => typeof entry !== 'string' || entry === '')) {
          return { error: 'columns must be an array of column names' }
        }
        return { change: { ...base, columns: columns as string[] } }
      }
      case 'createIndex': {
        const index = asJsonObject(body['index'])
        if (index === undefined) return { error: 'index must be an object' }
        const name = index['name']
        const columns = index['columns']
        if (typeof name !== 'string' || name === '') return { error: 'index.name is required' }
        if (!Array.isArray(columns) || columns.length === 0 || columns.some(entry => typeof entry !== 'string' || entry === '')) {
          return { error: 'index.columns must be a non-empty array of column names' }
        }
        return { change: { ...base, index: { name, columns: columns as string[], unique: index['unique'] === true } } }
      }
      case 'dropIndex': {
        const name = body['name']
        if (typeof name !== 'string' || name === '') return { error: 'name is required for dropIndex' }
        return { change: { ...base, column: name } }
      }
      default:
        return { error: `unsupported action: ${JSON.stringify(action)}` }
    }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

/** Carry out one validated schema change, and report what it invalidated. */
async function applySchemaChange(driver: SqlDriver, change: SchemaChange): Promise<SchemaChangeResult> {
  const started = Date.now()
  const finish = (result: QueryResult, reload: SchemaChangeResult['reload']): SchemaChangeResult => ({
    affected: result.affected,
    durationMs: Date.now() - started,
    reload,
  })

  switch (change.action) {
    case 'createTable': {
      const result = await driver.createTable(change.schema, change.table, change.specs ?? [], {
        ...(change.primaryKey === undefined ? {} : { primaryKey: change.primaryKey }),
      })
      // A brand-new table: its columns, indexes and rows are all being seen for the
      // first time, and the database's table list has one more entry.
      return finish(result, ['columns', 'indexes', 'rows', 'tables'])
    }
    case 'addColumn': {
      // The 浏览 grid gains a column, and the overview's row count is unaffected.
      const result = await driver.addColumn(change.schema, change.table, change.spec!)
      return finish(result, ['columns'])
    }
    case 'alterColumn': {
      const result = await driver.alterColumn(change.schema, change.table, change.spec!, {
        ...(change.rename === undefined ? {} : { rename: change.rename }),
      })
      // A rebuild may have replaced the table, so its rows are re-read rather
      // than patched: a stale grid would show the old column's values under the
      // new column's name.
      return finish(result, ['columns', 'indexes', 'rows'])
    }
    case 'dropColumn': {
      const result = await driver.dropColumn(change.schema, change.table, change.column!)
      return finish(result, ['columns', 'indexes', 'rows'])
    }
    case 'setPrimaryKey': {
      const result = await driver.setPrimaryKey(change.schema, change.table, change.columns!)
      // The key decides which rows the 浏览 tab can identify, so both surfaces
      // change together.
      return finish(result, ['columns', 'indexes', 'rows'])
    }
    case 'createIndex': {
      const result = await driver.createIndex(change.schema, change.table, change.index!)
      return finish(result, ['indexes'])
    }
    case 'dropIndex': {
      const result = await driver.dropIndex(change.schema, change.table, change.column!)
      return finish(result, ['indexes'])
    }
    default:
      throw new Error(`unsupported action: ${JSON.stringify(change.action)}`)
  }
}

/** A no-op result, for a route that reports success without an engine change. */
const NO_CHANGE: SchemaChangeResult = { affected: 0, durationMs: 0, reload: [] }
void NO_CHANGE
void EXPORT_ROW_CAP

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

/** Read a list of strings, rejecting a non-array or a non-string member. */
function readStringArray(value: unknown, what: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${what} must be an array of strings`)
  return value.map((item, index) => {
    if (typeof item !== 'string') throw new Error(`${what}[${index}] must be a string`)
    return item
  })
}

/** Whether an unknown value is one of the creatable Redis key types. */
function isCreatableType(value: unknown): value is RedisCreatableType {
  return typeof value === 'string' && (REDIS_CREATABLE_TYPES as readonly string[]).includes(value)
}

/**
 * Validate one element-edit request.
 *
 * The driver re-checks each op against the key's live type; this layer rejects
 * the shapes that cannot be valid at all, so a malformed request fails with a
 * field name instead of reaching an engine.
 *
 * @param body - the parsed JSON request body.
 * @returns the edit, or a message naming the first problem.
 */
function parseElementEdit(body: Record<string, unknown>): { edit: RedisElementEdit } | { error: string } {
  const rawOp = body['op']
  if (rawOp !== 'set' && rawOp !== 'delete' && rawOp !== 'push' && rawOp !== 'add') {
    return { error: 'op must be one of set, delete, push, add' }
  }

  let index: number | undefined
  if (body['index'] !== undefined && body['index'] !== null) {
    if (typeof body['index'] !== 'number' || !Number.isInteger(body['index']) || body['index'] < 0) {
      return { error: 'index must be a non-negative integer' }
    }
    index = body['index']
  }

  let member: string | undefined
  if (body['member'] !== undefined && body['member'] !== null) {
    if (typeof body['member'] !== 'string') return { error: 'member must be a string' }
    member = body['member']
  }

  let value: string | undefined
  if (body['value'] !== undefined && body['value'] !== null) {
    if (typeof body['value'] !== 'string') return { error: 'value must be a string' }
    value = body['value']
  }

  return {
    edit: {
      op: rawOp,
      ...(index === undefined ? {} : { index }),
      ...(member === undefined ? {} : { member }),
      ...(value === undefined ? {} : { value }),
    },
  }
}

/**
 * Validate one create request into the driver's shape.
 *
 * Validation lives here, not in the browser: the browser is not a trust
 * boundary, and a hand-rolled request must not be able to create a
 * half-specified key (an empty hash, a zset member with a non-numeric score).
 *
 * @param body - the parsed JSON request body.
 * @returns the keys to create, or a message naming the first problem.
 */
function parseCreateRequest(body: Record<string, unknown>): { keys: RedisCreateKey[] } | { error: string } {
  const rawKeys = body['keys']
  if (!Array.isArray(rawKeys) || rawKeys.length === 0) return { error: 'keys must be a non-empty array' }
  if (rawKeys.length > 1000) return { error: 'too many keys in one request (max 1000)' }

  const keys: RedisCreateKey[] = []
  for (const [index, item] of rawKeys.entries()) {
    const record = asJsonObject(item)
    if (record === undefined) return { error: `keys[${index}] must be an object` }

    const key = typeof record['key'] === 'string' ? record['key'] : ''
    if (key === '') return { error: `keys[${index}].key is required` }

    const rawType = record['type']
    if (!isCreatableType(rawType)) {
      return { error: `keys[${index}].type must be one of ${REDIS_CREATABLE_TYPES.join(', ')}` }
    }
    const type = rawType

    let ttl: number | undefined
    if (record['ttl'] !== undefined && record['ttl'] !== null) {
      if (typeof record['ttl'] !== 'number' || !Number.isFinite(record['ttl'])) {
        return { error: `keys[${index}].ttl must be a number of seconds` }
      }
      if (record['ttl'] < 0) return { error: `keys[${index}].ttl cannot be negative` }
      if (record['ttl'] > 0) ttl = Math.trunc(record['ttl'])
    }

    try {
      if (type === 'string') {
        const value = record['value']
        if (value !== undefined && typeof value !== 'string') return { error: `keys[${index}].value must be a string` }
        keys.push({ key, type, value: value ?? '', ...(ttl === undefined ? {} : { ttl }) })
        continue
      }

      if (type === 'list' || type === 'set') {
        const items = readStringArray(record['items'], `keys[${index}].items`)
        if (items === undefined || items.length === 0) return { error: `keys[${index}].items must be a non-empty array for a ${type}` }
        keys.push({ key, type, items, ...(ttl === undefined ? {} : { ttl }) })
        continue
      }

      if (type === 'hash') {
        const raw = record['fields']
        if (!Array.isArray(raw) || raw.length === 0) return { error: `keys[${index}].fields must be a non-empty array for a hash` }
        const fields: Array<{ field: string; value: string }> = []
        for (const [position, entry] of raw.entries()) {
          const pair = asJsonObject(entry)
          if (pair === undefined) return { error: `keys[${index}].fields[${position}] must be an object` }
          const field = pair['field']
          const value = pair['value']
          if (typeof field !== 'string' || field === '') return { error: `keys[${index}].fields[${position}].field must be a non-empty string` }
          if (typeof value !== 'string') return { error: `keys[${index}].fields[${position}].value must be a string` }
          fields.push({ field, value })
        }
        keys.push({ key, type, fields, ...(ttl === undefined ? {} : { ttl }) })
        continue
      }

      // zset
      const raw = record['members']
      if (!Array.isArray(raw) || raw.length === 0) return { error: `keys[${index}].members must be a non-empty array for a zset` }
      const members: Array<{ member: string; score: string }> = []
      for (const [position, entry] of raw.entries()) {
        const pair = asJsonObject(entry)
        if (pair === undefined) return { error: `keys[${index}].members[${position}] must be an object` }
        const member = pair['member']
        const score = pair['score']
        if (typeof member !== 'string' || member === '') return { error: `keys[${index}].members[${position}].member must be a non-empty string` }
        if (typeof score !== 'string' || score === '') return { error: `keys[${index}].members[${position}].score must be a string` }
        // The score reaches ZADD verbatim; reject a non-numeric one here so the
        // failure names the field instead of surfacing as a Redis syntax error.
        if (!Number.isFinite(Number(score))) return { error: `keys[${index}].members[${position}].score must be a number` }
        members.push({ member, score })
      }
      keys.push({ key, type, members, ...(ttl === undefined ? {} : { ttl }) })
    } catch (error) {
      return { error: errorMessage(error) }
    }
  }
  return { keys }
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
        // Statistics are opt-in because they are not free — SQLite walks the
        // file's page map. The tree expands a database on every click and gets
        // names only; the overview pane asks for stats and shows a loading
        // state while it waits.
        const stats = queryParam(url, 'stats') === '1'
        writeJson(res, 200, { tables: await driver.tables(schema, { stats }) })
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
          // The 浏览 tab's structured filter is sent as JSON in one query
          // parameter, so a filter list does not have to be encoded into the
          // parameter names. Invalid JSON is a 400 naming the parameter.
          let filters: RowFilter[] | undefined
          const rawFilters = queryParam(url, 'filters')
          if (rawFilters !== undefined) {
            try {
              filters = parseFilters(JSON.parse(rawFilters) as unknown)
            } catch (error) {
              writeError(res, 400, `filters: ${errorMessage(error)}`)
              return
            }
          }
          const orderByColumns = queryParam(url, 'orderByColumns')
          const page = await driver.rows({
            ...(queryParam(url, 'schema') === undefined ? {} : { schema: queryParam(url, 'schema')! }),
            table,
            page: Math.max(1, queryInt(url, 'page', 1)),
            pageSize: clampPageSize(queryInt(url, 'pageSize', DEFAULT_PAGE_SIZE)),
            ...(queryParam(url, 'orderBy') === undefined ? {} : { orderBy: queryParam(url, 'orderBy')! }),
            ...(orderByColumns === undefined ? {} : { orderByColumns: orderByColumns.split(',').filter(name => name !== '') }),
            ...(queryParam(url, 'orderDir') === 'desc' ? { orderDir: 'desc' as const } : {}),
            mode: mode === 'search' ? 'search' : 'browse',
            ...(queryParam(url, 'term') === undefined ? {} : { term: queryParam(url, 'term')! }),
            ...(queryParam(url, 'condition') === undefined ? {} : { condition: queryParam(url, 'condition')! }),
            ...(filters === undefined ? {} : { filters }),
            ...(queryParam(url, 'filterJoin') === 'or' ? { filterJoin: 'or' as const } : {}),
          })
          // The index list rides along when the caller asks for it, so 按索引排序
          // is one request rather than two.
          const indexes = queryParam(url, 'withIndexes') === '1' ? await driver.indexes(queryParam(url, 'schema'), table) : undefined
          writeJson(res, 200, { page: indexes === undefined ? page : { ...page, indexes } })
          return
        }
        writeError(res, 405, `${method} is not allowed on ${path}`)
        return
      }

      // Multi-row delete, in one request and one transaction. A separate path
      // from `/row`, whose DELETE takes one key set: this one takes a list, so
      // the panel's multi-select is one round trip rather than one per row.
      if (action === 'rows/delete' && method === 'POST') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'rows/delete is only available for SQL data sources')
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
        if (!Array.isArray(body['keySets']) || body['keySets'].length === 0) {
          writeError(res, 400, 'keySets must be a non-empty array')
          return
        }
        if (body['keySets'].length > MAX_BATCH_ROWS) {
          writeError(res, 400, `too many rows in one request (max ${MAX_BATCH_ROWS})`)
          return
        }
        const keySets = (body['keySets'] as unknown[]).map((entry, index) => readPairs(entry, `keySets[${index}]`))
        writeJson(res, 200, { result: await driver.deleteRows(schema, table, keySets) })
        return
      }

      // How many distinct values a column holds — the 结构 tab's 「非重复值」.
      if (action === 'distinct' && method === 'GET') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'distinct is only available for SQL data sources')
          return
        }
        const table = queryParam(url, 'table')
        const column = queryParam(url, 'column')
        if (table === undefined || column === undefined) {
          writeError(res, 400, 'table and column are required')
          return
        }
        writeJson(res, 200, { count: await driver.distinctCount(queryParam(url, 'schema'), table, column) })
        return
      }

      // ---- schema changes (the 结构 tab) ----------------------------------
      // The user surface, like the row routes: the click is the authorization.
      // Every field that reaches a statement is validated by the driver, not
      // here — this layer only decides the ACTION and shapes the reply.
      if (action === 'schema' && method === 'POST') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'schema is only available for SQL data sources')
          return
        }
        const body = asJsonObject(await readJsonBody(req))
        if (body === undefined) {
          writeError(res, 400, 'body must be a JSON object')
          return
        }
        const parsed = parseSchemaChange(body)
        if ('error' in parsed) {
          writeError(res, 400, parsed.error)
          return
        }
        const change = parsed.change
        const result = await applySchemaChange(driver, change)
        writeJson(res, 200, { result })
        return
      }

      // ---- table maintenance (the 表列表 的批量操作) -------------------------
      // Same user surface as the other write routes: the click is the
      // authorization. The engine's own message lines are returned verbatim,
      // because they carry what actually happened (MySQL's `repair` on InnoDB says
      // the engine does not support it, which is not an error and is worth seeing).
      if (action === 'maintenance-support' && method === 'GET') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'maintenance-support is only available for SQL data sources')
          return
        }
        writeJson(res, 200, { support: driver.maintenanceSupport() })
        return
      }

      if (action === 'maintain' && method === 'POST') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'maintain is only available for SQL data sources')
          return
        }
        const body = asJsonObject(await readJsonBody(req))
        if (body === undefined) {
          writeError(res, 400, 'body must be a JSON object')
          return
        }
        const tables = body['tables']
        if (!Array.isArray(tables) || tables.length === 0 || tables.some(entry => typeof entry !== 'string' || entry === '')) {
          writeError(res, 400, 'tables must be a non-empty array of table names')
          return
        }
        if (tables.length > MAX_BATCH_TABLES) {
          writeError(res, 400, `too many tables in one request (max ${MAX_BATCH_TABLES})`)
          return
        }
        const op = body['op']
        if (typeof op !== 'string' || !(MAINTENANCE_OPS as readonly string[]).includes(op)) {
          writeError(res, 400, `op must be one of ${MAINTENANCE_OPS.join(', ')}`)
          return
        }
        const schema = typeof body['schema'] === 'string' && body['schema'] !== '' ? body['schema'] : undefined
        // Refused up front when the engine cannot do it at all, rather than letting
        // every table fail with the same engine error.
        const support = driver.maintenanceSupport()
        if (!support.includes(op as MaintenanceOp)) {
          writeError(res, 400, `${driver.kind} 不支持 ${op}（可用：${support.join(', ')}）`)
          return
        }
        const results = await driver.maintain(schema, tables as string[], op as MaintenanceOp)
        // The table name is attached here: the driver returns one outcome per
        // requested table in order, and pairing them is this layer's job.
        writeJson(res, 200, { results: results.map((result, index) => ({ ...result, table: tables[index] })) })
        return
      }

      // ---- database-level operations --------------------------------------
      if (action === 'database' && method === 'POST') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'database is only available for SQL data sources')
          return
        }
        const body = asJsonObject(await readJsonBody(req))
        if (body === undefined) {
          writeError(res, 400, 'body must be a JSON object')
          return
        }
        const op = body['op']
        if (op !== 'create' && op !== 'drop' && op !== 'rename' && op !== 'copy' && op !== 'charset') {
          writeError(res, 400, 'op must be one of create, drop, rename, copy, charset')
          return
        }
        const name = typeof body['name'] === 'string' ? body['name'].trim() : ''
        // `create` needs the new name; the rest need the database they act on, which
        // `name` carries except for rename/copy where it is the NEW name and `from`
        // is the existing one.
        if (name === '' && op !== 'drop' && op !== 'charset') {
          writeError(res, 400, 'name is required')
          return
        }
        const from = typeof body['from'] === 'string' && body['from'] !== '' ? body['from'] : undefined
        const options: DatabaseOperationOptions = {
          ...(from === undefined ? {} : { from }),
          ...(typeof body['charset'] === 'string' && body['charset'] !== '' ? { charset: body['charset'] } : {}),
          ...(typeof body['collate'] === 'string' && body['collate'] !== '' ? { collate: body['collate'] } : {}),
          ...(body['includeData'] === undefined ? {} : { includeData: body['includeData'] === true }),
        }
        // A pool entry for the source is now stale when its schema changed shape.
        // `invalidateSource` is the driver-agnostic way: the next call re-acquires.
        if (op === 'drop' || op === 'rename') pool.drop(id)
        writeJson(res, 200, { result: await driver.databaseOperation(op, name, options) })
        return
      }

      // ---- export / import ------------------------------------------------
      if (action === 'export' && method === 'POST') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'export is only available for SQL data sources')
          return
        }
        const body = asJsonObject(await readJsonBody(req))
        if (body === undefined) {
          writeError(res, 400, 'body must be a JSON object')
          return
        }
        const request: ExportRequest = {
          ...(typeof body['schema'] === 'string' && body['schema'] !== '' ? { schema: body['schema'] } : {}),
          ...(Array.isArray(body['tables'])
            ? { tables: body['tables'].filter((name): name is string => typeof name === 'string' && name !== '') }
            : {}),
          includeData: body['includeData'] !== false,
          includeStructure: body['includeStructure'] !== false,
          drop: body['drop'] === true,
          format: body['format'] === 'csv' ? 'csv' : 'sql',
        }
        const result = await exportSql(driver, entry, request)
        writeJson(res, 200, {
          filename: result.filename,
          contentType: result.contentType,
          text: result.text,
          truncated: result.truncated,
          byteLength: Buffer.byteLength(result.text, 'utf8'),
        } satisfies ExportResponse)
        return
      }

      if (action === 'import' && method === 'POST') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'import is only available for SQL data sources')
          return
        }
        const body = asJsonObject(await readJsonBody(req, { maxBytes: IMPORT_BODY_MAX_BYTES }))
        if (body === undefined) {
          writeError(res, 400, `body must be a JSON object under ${Math.trunc(IMPORT_BODY_MAX_BYTES / 1024 / 1024)} MiB`)
          return
        }
        const content = body['content']
        if (typeof content !== 'string' || content === '') {
          writeError(res, 400, 'content is required')
          return
        }
        const result = await importSql(driver, {
          ...(typeof body['schema'] === 'string' && body['schema'] !== '' ? { schema: body['schema'] } : {}),
          ...(typeof body['table'] === 'string' && body['table'] !== '' ? { table: body['table'] } : {}),
          format: body['format'] === 'csv' ? 'csv' : 'sql',
          ...(typeof body['hasHeader'] === 'boolean' ? { hasHeader: body['hasHeader'] } : {}),
          ...(typeof body['emptyAsNull'] === 'boolean' ? { emptyAsNull: body['emptyAsNull'] } : {}),
          content,
        })
        writeJson(res, 200, { result: { statements: result.statements, rows: result.rows, skipped: result.skipped } satisfies ImportResponse })
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

      // Several rows in one request, inserted in ONE transaction. The 插入 tab's
      // "add another row" and a CSV import both land here, and both need the
      // all-or-nothing guarantee: a failure on the third row must not leave the
      // first two behind with no record of where it stopped.
      if (action === 'row/batch' && method === 'POST') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'row/batch is only available for SQL data sources')
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
        if (!Array.isArray(body['rows']) || body['rows'].length === 0) {
          writeError(res, 400, 'rows must be a non-empty array')
          return
        }
        if (body['rows'].length > MAX_BATCH_ROWS) {
          writeError(res, 400, `too many rows in one request (max ${MAX_BATCH_ROWS})`)
          return
        }
        const schema = typeof body['schema'] === 'string' && body['schema'] !== '' ? body['schema'] : undefined
        const rows = (body['rows'] as unknown[]).map((entry, index) => readPairs(entry, `rows[${index}]`))
        writeJson(res, 200, { result: await driver.insertRows(schema, table, rows) })
        return
      }

      if (action === 'table') {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, 'table is only available for SQL data sources')
          return
        }
        if (method !== 'POST') {
          writeError(res, 405, `${method} is not allowed on ${path}`)
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
        const isView = body['isView'] === true
        const op = body['op']
        // Both operations destroy data and neither is undoable, so the caller
        // has to say which one it means. Defaulting would turn a malformed
        // request into a dropped table.
        if (op === 'truncate') {
          writeJson(res, 200, { result: await driver.truncateTable(schema, table, isView) })
          return
        }
        if (op === 'drop') {
          writeJson(res, 200, { result: await driver.dropTable(schema, table, isView) })
          return
        }
        writeError(res, 400, 'op must be "truncate" or "drop"')
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

      // A server-side search for keys matching a Redis glob, within ONE
      // database. Distinct from the tree's per-level loads: a search must see
      // keys inside folders that were never expanded, which only the server can
      // do. Scoped to one db because evaluating a pattern across all 16 would
      // sweep the whole instance.
      if (action === 'redis/search' && method === 'GET') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/search is only available for Redis data sources')
          return
        }
        const pattern = queryParam(url, 'pattern')
        if (pattern === undefined) {
          writeError(res, 400, 'pattern is required')
          return
        }
        const page = await driver.search({
          db: queryInt(url, 'db', entry.db ?? 0),
          pattern,
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

      // ---- Redis tree and key editing (the USER surface) -------------------
      // Everything below is the panel acting on the user's direct input, the
      // same authorization model as the SQL row routes: the click IS the
      // authorization. Model-initiated writes never come through here — they
      // go through the agent tools and the auth gate.
      if (action === 'redis/tree' && method === 'GET') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/tree is only available for Redis data sources')
          return
        }
        const page = await driver.tree({
          db: queryInt(url, 'db', entry.db ?? 0),
          ...(queryParam(url, 'pattern') === undefined ? {} : { pattern: queryParam(url, 'pattern')! }),
        })
        writeJson(res, 200, { page })
        return
      }

      // The tree's lazy-load endpoint: one folder level, one bounded scan.
      // ---- Redis keyspace index -------------------------------------------
      //
      // A cached tree for one database, built by ONE walk of the keyspace. It
      // exists because Redis has no prefix index and `SCAN MATCH p:*` still
      // traverses everything, so listing each level separately would cost a full
      // traversal per level opened. Three endpoints: estimate the cost, start or
      // poll the walk, read one level.
      if (action === 'redis/index/estimate' && method === 'GET') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/index/estimate is only available for Redis data sources')
          return
        }
        const db = queryInt(url, 'db', entry.db ?? 0)
        // DBSIZE is O(1), so asking what a walk would cost does not itself load the
        // server — which is the point of offering an estimate at all.
        const dbSize = await driver.keyCount(db)
        writeJson(res, 200, { estimate: estimateIndexCost(dbSize) })
        return
      }

      if (action === 'redis/index/level' && method === 'GET') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/index/level is only available for Redis data sources')
          return
        }
        const db = queryInt(url, 'db', entry.db ?? 0)
        const prefix = queryParam(url, 'prefix') ?? ''
        const index = deps.indexes?.get(id, db)
        if (index === undefined) {
          writeError(res, 409, 'no index has been built for this database yet')
          return
        }
        const level = levelFromIndex(index, prefix, compareKeyNames)
        // A level reports row METADATA (type/TTL) for the keys it lists. That is one
        // pipelined round trip per batch over at most a page of keys, and only for a
        // level the user actually opened — unlike a per-key fetch over the whole
        // database, which is the cost the index exists to avoid.
        const keys = queryParam(url, 'withTypes') === '0'
          ? level.keys.map(key => ({ key, type: 'unknown', ttl: -1 } satisfies RedisKeyInfo))
          : await driver.describeKeysPublic(db, level.keys)
        writeJson(res, 200, {
          level: {
            folders: level.folders,
            keys,
            keysAtLevel: level.keysAtLevel,
            partial: level.partial,
            // Present only for an unfinished walk; the UI's "counts are lower
            // bounds" notice needs them to state how much was covered.
            visited: level.visited,
            dbSize: level.dbSize,
          },
        })
        return
      }

      if (action === 'redis/index') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/index is only available for Redis data sources')
          return
        }
        const db = queryInt(url, 'db', entry.db ?? 0)
        if (method === 'DELETE') {
          // Drops the cache, so the next GET rebuilds. Used after a bulk change the
          // incremental updates cannot express.
          deps.indexes?.invalidate(id, db)
          writeJson(res, 200, { invalidated: true })
          return
        }
        if (method !== 'GET') {
          writeError(res, 405, `${method} is not allowed on ${path}`)
          return
        }
        const indexes = deps.indexes
        if (indexes === undefined) {
          writeError(res, 503, 'keyspace indexing is not available in this host')
          return
        }
        const dbSize = await driver.keyCount(db)
        // Idempotent: a second call while a walk is running returns its progress
        // rather than starting another traversal of the same database.
        const index = await indexes.start(id, db, dbSize)
        writeJson(res, 200, { status: indexProgress(index) })
        return
      }

      if (action === 'redis/level' && method === 'GET') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/level is only available for Redis data sources')
          return
        }
        const page = await driver.level({
          db: queryInt(url, 'db', entry.db ?? 0),
          prefix: queryParam(url, 'prefix') ?? '',
          // Fetching TYPE/TTL costs a round trip per batch; a caller that only
          // wants the folder shape (the root of a huge database) can skip it.
          withTypes: queryParam(url, 'withTypes') !== '0',
        })
        writeJson(res, 200, { page })
        return
      }

      // ---- Redis value editing (the USER surface) -------------------------
      // Same authorization model as the row editor: the user pressing 保存 in
      // the panel is the authorization. Model-initiated writes still go through
      // the agent tools and the auth gate.
      if (action === 'redis/string' && method === 'POST') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/string is only available for Redis data sources')
          return
        }
        const body = asJsonObject(await readJsonBody(req))
        if (body === undefined) {
          writeError(res, 400, 'body must be a JSON object')
          return
        }
        const key = typeof body['key'] === 'string' && body['key'] !== '' ? body['key'] : undefined
        if (key === undefined) {
          writeError(res, 400, 'key is required')
          return
        }
        if (typeof body['value'] !== 'string') {
          writeError(res, 400, 'value must be a string')
          return
        }
        const result = await driver.setString(key, body['value'], queryInt(url, 'db', entry.db ?? 0))
        writeJson(res, 200, { result })
        return
      }

      if (action === 'redis/ttl' && method === 'POST') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/ttl is only available for Redis data sources')
          return
        }
        const body = asJsonObject(await readJsonBody(req))
        if (body === undefined) {
          writeError(res, 400, 'body must be a JSON object')
          return
        }
        const key = typeof body['key'] === 'string' && body['key'] !== '' ? body['key'] : undefined
        if (key === undefined) {
          writeError(res, 400, 'key is required')
          return
        }
        // `null`/absent means "no expiry"; a number is seconds. Both are
        // explicit, so an empty form field is never silently a delete.
        let seconds: number
        if (body['ttl'] === null || body['ttl'] === undefined) seconds = -1
        else if (typeof body['ttl'] === 'number' && Number.isFinite(body['ttl'])) seconds = body['ttl']
        else {
          writeError(res, 400, 'ttl must be a number of seconds, or null for no expiry')
          return
        }
        const result = await driver.setTtl(key, seconds, queryInt(url, 'db', entry.db ?? 0))
        writeJson(res, 200, { result })
        return
      }

      if (action === 'redis/element' && method === 'POST') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/element is only available for Redis data sources')
          return
        }
        const body = asJsonObject(await readJsonBody(req))
        if (body === undefined) {
          writeError(res, 400, 'body must be a JSON object')
          return
        }
        const key = typeof body['key'] === 'string' && body['key'] !== '' ? body['key'] : undefined
        if (key === undefined) {
          writeError(res, 400, 'key is required')
          return
        }
        const edit = parseElementEdit(body)
        if ('error' in edit) {
          writeError(res, 400, edit.error)
          return
        }
        const result = await driver.editElement(key, edit.edit, queryInt(url, 'db', entry.db ?? 0))
        writeJson(res, 200, { result })
        return
      }

      if (action === 'redis/key') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/key is only available for Redis data sources')
          return
        }
        const db = queryInt(url, 'db', entry.db ?? 0)

        if (method === 'POST') {
          const body = asJsonObject(await readJsonBody(req))
          if (body === undefined) {
            writeError(res, 400, 'body must be a JSON object')
            return
          }
          const parsed = parseCreateRequest(body)
          if ('error' in parsed) {
            writeError(res, 400, parsed.error)
            return
          }
          // Created one at a time on purpose: a multi-key form must report
          // exactly which names landed, so a partial failure is not hidden by
          // an all-or-nothing bulk call.
          const created: string[] = []
          for (const candidate of parsed.keys) {
            await driver.createKey(candidate, db)
            created.push(candidate.key)
          }
          writeJson(res, 201, { created } satisfies RedisCreateResult)
          return
        }

        if (method === 'DELETE') {
          const key = queryParam(url, 'key')
          if (key === undefined) {
            writeError(res, 400, 'key is required')
            return
          }
          writeJson(res, 200, { removed: await driver.deleteKey(key, db) } satisfies RedisDeleteResult)
          return
        }

        writeError(res, 405, `${method} is not allowed on ${path}`)
        return
      }

      if (action === 'redis/prefix') {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, 'redis/prefix is only available for Redis data sources')
          return
        }
        const prefix = queryParam(url, 'prefix')
        if (prefix === undefined) {
          writeError(res, 400, 'prefix is required')
          return
        }
        const db = queryInt(url, 'db', entry.db ?? 0)

        if (method === 'GET') {
          writeJson(res, 200, { count: await driver.countPrefix(prefix, db) } satisfies RedisPrefixCount)
          return
        }
        if (method === 'DELETE') {
          writeJson(res, 200, { result: await driver.deletePrefix(prefix, db) })
          return
        }
        writeError(res, 405, `${method} is not allowed on ${path}`)
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
