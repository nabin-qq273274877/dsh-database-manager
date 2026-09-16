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
  /**
   * Redis: logical database index the key browser opens on.
   *
   * MySQL deliberately has no default-schema field: connecting without one lets
   * the browser list every database, which is the phpMyAdmin behaviour users
   * expect, and a schema is chosen per operation instead. A stored `database`
   * from an older version is ignored and dropped on the next save.
   */
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
  /**
   * Row count.
   *
   * MySQL reads it from `information_schema.TABLES`, which is an estimate the
   * server keeps; SQLite has no such statistic, so it is a real `COUNT(*)` and
   * is only filled in when the caller asked for stats AND the walk stayed
   * inside its budget. ABSENT MEANS UNKNOWN, not zero — the panel renders that
   * as `—` rather than claiming a table is empty.
   */
  rows?: number
  /** On-disk size in bytes, when it is cheap for the engine to report. */
  size?: number
  comment?: string
  /** Storage engine (MySQL `ENGINE`); absent on SQLite, which has only one. */
  engine?: string
  /** Default collation, MySQL `TABLE_COLLATION`. */
  collation?: string
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

/**
 * A keyspace index's state, as reported to the panel.
 *
 * The index is a complete folder tree for one database, built by walking the
 * keyspace once. It exists because Redis has no prefix index and `SCAN MATCH p:*`
 * still traverses everything, so listing each level separately would cost one full
 * traversal per level opened. Building it once makes every later level immediate.
 *
 * `visited` against `dbSize` is the progress signal: a 19.5M-key database takes
 * about a minute to walk, and showing real progress is what makes that tolerable
 * instead of a spinner of unknown length.
 */
export interface RedisIndexStatus {
  db: number
  /** Keys the database holds (DBSIZE), i.e. the walk's total work. */
  dbSize: number
  /** Keys examined so far. */
  visited: number
  /** How many folders have been found. */
  folders: number
  /** True once the walk has covered the whole keyspace. */
  done: boolean
  /** Set when the walk cannot proceed (for example the server rejects EVAL). */
  error?: string
}

/** One level of the index: its child folders and its own keys. */
export interface RedisIndexLevel {
  folders: Array<{ name: string; path: string; keys: number }>
  /** Full key names sitting directly at this level. */
  keys: RedisKeyInfo[]
  /** How many keys sit at this level, which may exceed `keys.length`. */
  keysAtLevel: number
  /** True while the walk is still running, so this level may gain rows. */
  partial: boolean
  /**
   * Keys walked so far and the database's total, present only while `partial`.
   *
   * The "counts are lower bounds" notice needs them; without them a mid-walk
   * level announced a database size of zero.
   */
  visited?: number
  dbSize?: number
}

/** What a keyspace walk is expected to cost, so a caller can warn before starting. */
export interface RedisIndexEstimate {
  keys: number
  estimatedSeconds: number
  isLarge: boolean
}

/** A page of Redis keys (SCAN cursor based). */
export interface RedisKeyPage {
  keys: RedisKeyInfo[]
  /** Next SCAN cursor; '0' means the scan finished. */
  cursor: string
}

/**
 * One database's search results for a Redis glob pattern.
 *
 * A SEARCH, not a filter: the pattern is evaluated by the server with
 * `SCAN MATCH`, so it understands Redis glob syntax (`jd:*`, `*session*`, `?`)
 * and finds keys inside folders that were never expanded. A client-side
 * substring match over loaded rows can do neither — it reads `jd:*` as literal
 * text and cannot see keys it never fetched.
 *
 * Scoped to ONE database on purpose: a pattern evaluated across all 16 logical
 * databases would sweep the whole instance, which is far too slow to run while
 * someone is typing.
 */
export interface RedisSearchPage {
  /** Matching keys, with type and TTL, sorted by name. */
  keys: RedisKeyInfo[]
  /** True when the scan stopped at the cap, so `keys` is incomplete. */
  truncated: boolean
  /** How many keys the scan visited, so "scanned N" can be shown. */
  scanned: number
  /** Total keys the database holds (DBSIZE), for context. */
  dbSize: number
}

/**
 * Every key in one database matching a pattern, with type and TTL.
 *
 * NOT what the tree loads — the tree loads one level at a time
 * ({@link RedisLevelPage}). This is for callers that need the whole matching set
 * in one shot (exports, tests asserting what a folder operation left behind), and
 * it is capped: past the cap `truncated` is true and `keys` is incomplete.
 */
export interface RedisTreePage {
  keys: RedisKeyInfo[]
  /** Total keys the database holds (DBSIZE), whatever the pattern matched. */
  dbSize: number
  /** True when the scan stopped at the cap, so `keys` is incomplete. */
  truncated: boolean
}

/**
 * One folder level of one database — how the tree is actually built.
 *
 * A whole-keyspace scan cannot serve a large database: 480k keys is tens of
 * megabytes of JSON and a per-key TYPE/TTL round trip each. Instead the tree
 * asks for one level at a time, so expanding a folder costs one bounded scan of
 * that folder's prefix and only its immediate children cross the wire. A folder
 * that is never opened is never scanned.
 */
export interface RedisLevelPage {
  /**
   * Immediate sub-folders of the requested prefix, with the number of keys each
   * holds in total (including nested folders). Sorted by name.
   */
  folders: Array<{ name: string; path: string; keys: number }>
  /**
   * Keys that live exactly at the requested level. Their type and TTL are
   * fetched, but NOT their values — reading 20k values to draw a tree would be
   * the same mistake in a different place.
   */
  keys: RedisKeyInfo[]
  /**
   * True when this level was cut short — either the scan hit its work ceiling,
   * or the level holds more key rows than were sent. `keysAtLevel` is the true
   * count either way, so the UI can state what was withheld.
   */
  truncated: boolean
  /**
   * How many keys live exactly at this level, whether or not all were returned.
   * A flat prefix of 200k keys reports 200000 here while `keys` holds the first
   * page, so "showing the first N of M" is accurate rather than a guess.
   */
  keysAtLevel: number
  /** Total keys the database holds (DBSIZE), independent of this level. */
  dbSize: number
  /**
   * True when the folder counts below are LOWER BOUNDS rather than exact.
   *
   * Set when the level's scan stopped at its key budget. A complete walk of a
   * huge database is not possible within a click: the production db1 holds 19.5M
   * keys, needing ~4 minutes and ~600 MiB of transferred key names. The folders
   * found are the ones holding most of the keys (a bounded pass visits keys in
   * hash-table order, effectively a sample), but a rare folder can be absent — so
   * the UI must not present the list as complete.
   */
  countsApproximate: boolean
  /**
   * How many keys the scan actually visited (the sample size, when partial).
   *
   * Reported so the UI can state the basis of an approximate count — "counted
   * from N scanned keys" is checkable, whereas a bare estimate is not.
   */
  scannedKeys?: number
}

/** One element edit to apply to a collection key. */
export interface RedisElementEdit {
  /** Which kind of edit this is. */
  op: 'set' | 'delete' | 'push' | 'add'
  /**
   * list: the 0-based index to write.
   * hash / zset / set: unused (the field/member identifies the element).
   */
  index?: number
  /** hash field, or zset/set member. */
  member?: string
  /** The new value: list/hash element, or a zset score. */
  value?: string
}

/** Outcome of a key mutation (value, element, or TTL). */
export interface RedisMutationResult {
  /** Rows/fields/elements the server reported as changed. */
  affected: number
  /** The key's TTL after the mutation, so the panel can redraw truthfully. */
  ttl: number
  /** True when the mutation removed the key entirely (deleting the last element). */
  removed: boolean
}

/** Key types this plugin can create from the new-key form. */
export type RedisCreatableType = 'string' | 'list' | 'set' | 'hash' | 'zset'

/** Every creatable type, for validation and the form's select. */
export const REDIS_CREATABLE_TYPES: readonly RedisCreatableType[] = ['string', 'list', 'set', 'hash', 'zset']

/**
 * One key to create, already parsed and validated by the caller.
 *
 * The shape mirrors {@link RedisValue} so the same renderer can read it back,
 * which is what makes "create then inspect" round-trip without a second model.
 */
export interface RedisCreateKey {
  /** The full key name. */
  key: string
  type: RedisCreatableType
  /** string: the value. */
  value?: string
  /** list | set: the elements, in order for a list. */
  items?: string[]
  /** hash: the fields to set. */
  fields?: Array<{ field: string; value: string }>
  /** zset: the scored members to add. */
  members?: Array<{ member: string; score: string }>
  /** Expiry in seconds; absent, 0 or negative means no expiry. */
  ttl?: number
}

/** Outcome of one create request (several keys when the form named several). */
export interface RedisCreateResult {
  created: string[]
}

/** Outcome of deleting one key. */
export interface RedisDeleteResult {
  /** Whether a key was actually removed. */
  removed: boolean
}

/** Outcome of deleting every key under one folder prefix. */
export interface RedisDeletePrefixResult {
  deleted: number
  /**
   * True when the scan hit its safety ceiling, so keys may remain. Reported
   * rather than hidden: a partial delete that claims success is worse than one
   * the user knows to repeat.
   */
  truncated: boolean
}

/** How many keys sit under one folder prefix (computed host-side for the dialog). */
export interface RedisPrefixCount {
  /** Keys whose name is the prefix itself, or starts with `prefix:` . */
  count: number
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
  table: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/table`,
  query: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/query`,
  redisInfo: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/info`,
  redisKeys: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/keys?${params}`,
  redisValue: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/value?${params}`,
  redisCommand: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/command`,
  /** One database's whole key set for the folder tree. */
  redisTree: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/tree?${params}`,
  /** One folder level of one database (the tree's lazy-load endpoint). */
  redisLevel: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/level?${params}`,
  /** Search one database with a Redis glob pattern (server-side SCAN MATCH). */
  redisSearch: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/search?${params}`,
  /**
   * The cached keyspace index for one database: start a walk, read its progress, or
   * read one level of it. `/redis/index` (POST) begins or resumes; `/redis/index`
   * (DELETE) drops the cache after writes that cannot be applied incrementally.
   */
  redisIndex: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/index?${params}`,
  /** One indexed level: `/redis/index/level`. */
  redisIndexLevel: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/index/level?${params}`,
  /** What a walk would cost, before anything is scanned: `/redis/index/estimate`. */
  redisIndexEstimate: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/index/estimate?${params}`,
  /** Replace a string key's value. */
  redisString: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/string`,
  /** Set or clear a key's TTL. */
  redisTtl: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/ttl`,
  /** Add, change or remove one element of a collection key. */
  redisElement: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/element`,
  /** Create one or more keys. */
  redisCreate: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/key`,
  /** Delete one key (query param `key`) — DELETE on the same path as create. */
  redisDeleteKey: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/key?${params}`,
  /** Delete every key under one folder prefix. */
  redisDeletePrefix: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/prefix`,
  /** Count the keys under one folder prefix (the delete dialog's warning). */
  redisPrefixCount: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/prefix?${params}`,
} as const
