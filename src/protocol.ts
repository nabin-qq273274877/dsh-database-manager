/**
 * Wire contract between the host half (routes.ts / tools.ts) and the browser
 * half (client/api.ts). Pure types plus a few shared literals — imported by
 * both halves, bundled into each, no runtime identity to share.
 */

/** Database engines this plugin can manage. */
export type DbKind = 'sqlite' | 'mysql' | 'redis'

/** Every supported kind, for validation and UI enumeration. */
export const DB_KINDS: readonly DbKind[] = ['sqlite', 'mysql', 'redis']

/**
 * How the connection authenticates, as shown in the list's 认证 column.
 * Derived from the credential fields actually present on an entry.
 */
export type DbAuthKind =
  /** SQLite: a local file, no credential. */
  | 'file'
  /** A password is stored. */
  | 'password'
  /** No password stored (MySQL anonymous / passwordless, or Redis without requirepass). */
  | 'none'

/**
 * One stored data source (the $DSH_HOME/dsh-database.json record shape).
 * Secret fields live here and never cross to the browser — the browser sees
 * {@link DataSourceSummary}.
 */
export interface DataSourceEntry {
  /** Stable identifier used by every operation. */
  id: string
  /** Engine. */
  kind: DbKind
  /** User-facing display name. */
  name: string
  /** Optional group label; the list can group by it. */
  group: string
  /** Free-form tags. */
  tags: string[]
  /** Free-form note. */
  description: string
  /** SQLite: absolute path to the database file (':memory:' allowed). */
  file?: string
  /** MySQL / Redis: hostname or IP. */
  host?: string
  /** MySQL / Redis: TCP port. */
  port?: number
  /** MySQL: login user. */
  user?: string
  /** MySQL / Redis: password. Stored in the user-owned store file, plaintext. */
  password?: string
  /** MySQL: default schema for the browser. */
  database?: string
  /** Redis: logical database index. */
  db?: number
  /** MySQL / Redis: connect over TLS. */
  tls?: boolean
  /** Connect timeout in milliseconds. */
  connectTimeoutMs?: number
  /**
   * Deny agent write tools against this source even when the global agent
   * write switch is on. The GUI is unaffected — the user is directly driving.
   */
  readonly?: boolean
  createdAt: number
  updatedAt: number
}

/** Secret-free projection of an entry: safe for the browser and the agent. */
export interface DataSourceSummary {
  id: string
  kind: DbKind
  name: string
  group: string
  tags: string[]
  description: string
  file?: string
  host?: string
  port?: number
  user?: string
  database?: string
  db?: number
  tls?: boolean
  connectTimeoutMs?: number
  /** Whether a password is stored (the password itself never crosses). */
  hasPassword: boolean
  /** The 认证 column value, derived host-side. */
  auth: DbAuthKind
  /** Whether agent write tools are refused for this source. */
  readonly: boolean
  createdAt: number
  updatedAt: number
}

/** One database/schema row in the browser tree. */
export interface SchemaInfo {
  name: string
  /** Engine-specific extra, e.g. SQLite file size. */
  detail?: string
}

/** One table row in the browser tree. */
export interface TableInfo {
  name: string
  /** 'table' | 'view' | 'system' — engine-normalized. */
  type: string
  /** Approximate row count when the engine reports one cheaply. */
  rows?: number
  comment?: string
}

/** One column description (the 结构 tab). */
export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  /** Default expression, rendered as text. */
  defaultValue?: string
  /** 'PRI' | 'UNI' | 'MUL' | '' — engine-normalized key marker. */
  key: string
  comment?: string
  extra?: string
}

/** One index description (the 结构 tab). */
export interface IndexInfo {
  name: string
  unique: boolean
  columns: string[]
  /** Engine-specific index algorithm/type when reported. */
  type?: string
}

/** A tabular result set. */
export interface QueryResult {
  /** Column names in projection order; empty for a non-SELECT statement. */
  columns: string[]
  /** Rows as arrays aligned with `columns`; non-JSON-safe values are stringified. */
  rows: Array<Array<string | number | boolean | null>>
  /** Rows affected (writes) or returned (reads). */
  affected: number
  /** Statement execution time in milliseconds. */
  durationMs: number
  /** True when the statement produced no result set. */
  write: boolean
  /** True when the result was cut by the row limit. */
  truncated: boolean
}

/** One page of table rows plus the metadata needed to render keys and paging. */
export interface TablePage {
  columns: ColumnInfo[]
  rows: Array<Record<string, string | number | boolean | null>>
  total: number
  page: number
  pageSize: number
  /** Primary-key column names; empty when the table has none. */
  primaryKey: string[]
}

/** Connection test outcome. */
export interface TestResult {
  ok: boolean
  latencyMs?: number
  /** Engine version / server greeting when the test succeeded. */
  serverVersion?: string
  /**
   * Extra information that is neither a failure nor a version — e.g. that a
   * SQLite file does not exist yet and will be created on connect. Rendered
   * beside the outcome so the user is not surprised by a later side effect.
   */
  note?: string
  error?: string
}

/** Redis server overview shown above the key tree. */
export interface RedisInfo {
  version?: string
  mode?: string
  uptimeSeconds?: number
  usedMemoryHuman?: string
  connectedClients?: number
  totalKeys?: number
  /** Database indexes that currently hold keys. */
  databases: Array<{ db: number; keys: number; expires: number }>
}

/** One Redis key row in the key list. */
export interface RedisKeyInfo {
  key: string
  type: string
  /** TTL in seconds; -1 = no expiry, -2 = missing. */
  ttl: number
  /** Approximate memory footprint in bytes when the server reports one. */
  size?: number
}

/** A page of Redis keys (SCAN cursor based). */
export interface RedisKeyPage {
  keys: RedisKeyInfo[]
  /** Next SCAN cursor; '0' means the scan finished. */
  cursor: string
}

/** The full value of one Redis key, shaped by its type. */
export interface RedisValue {
  key: string
  type: string
  ttl: number
  /** string */
  value?: string
  /** list / set — ordered and unordered collections of scalars. */
  items?: string[]
  /** hash — field/value pairs. */
  fields?: Array<{ field: string; value: string }>
  /** zset — scored members, ascending by score. */
  members?: Array<{ member: string; score: string }>
  /** stream — entries with their field/value pairs. */
  entries?: Array<{ id: string; fields: Array<{ field: string; value: string }> }>
  /** True when the collection was paged and more elements remain. */
  truncated?: boolean
}

/** Payload accepted on create and update (secrets omitted = keep stored value). */
export interface DataSourcePayload {
  id?: string
  kind?: DbKind
  name?: string
  group?: string
  tags?: string[]
  description?: string
  file?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  db?: number
  tls?: boolean
  connectTimeoutMs?: number
  readonly?: boolean
}

/** Whether a driver kind can be used in this host process. */
export interface EngineAvailability {
  kind: DbKind
  available: boolean
  /** Why it is unavailable, when it is. */
  detail?: string
}

/**
 * The agent write posture, as shown in and edited from the panel. Wire-safe
 * mirror of the host's internal GateSettings.
 */
export interface GateSettingsView {
  /** Master switch for agent-initiated writes. */
  allowAgentWrite: boolean
  /** Whether a permitted write additionally raises the approval prompt. */
  requireApproval: boolean
}

/** JSON error body used by every route. */
export interface ApiErrorBody {
  error: string
}

/** Route base path. */
export const DB_API_BASE = '/api/dsh-database' as const

/** Route paths the browser half calls (shared literals). */
export const DB_API = {
  sources: DB_API_BASE + '/sources',
  test: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/test`,
  /**
   * Test an UNSAVED payload. Distinct from `test(id)`: nothing is written to the
   * store, so the dialog can verify a connection before the user commits.
   */
  testConnection: DB_API_BASE + '/test-connection',
  database: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/connect`,
  schemas: (id: string, params?: string) =>
    `${DB_API_BASE}/sources/${encodeURIComponent(id)}/schemas${params === undefined ? '' : '?' + params}`,
  tables: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/tables?${params}`,
  columns: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/columns?${params}`,
  indexes: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/indexes?${params}`,
  rows: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/rows`,
  row: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/row`,
  query: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/query`,
  redisInfo: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/info`,
  redisKeys: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/keys?${params}`,
  redisValue: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/value?${params}`,
  redisCommand: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/command`,
} as const
