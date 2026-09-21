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

/**
 * One condition from the 搜索 tab.
 *
 * Structured rather than a SQL fragment so the operator decides the SQL shape:
 * `contains` is `LIKE %v%` (a bound pattern), `is null` is `IS NULL` (no bound
 * value at all), `in` is a list of bound parameters. Building this as text would
 * put the user's operand back into the statement.
 *
 * Lives in the shared protocol because both halves name it: the browser builds
 * the list, the driver compiles it.
 */
export interface RowFilter {
  /** Column the condition applies to; must exist on the table. */
  column: string
  /** Comparison to apply. */
  operator: RowFilterOperator
  /** Operand; ignored by the unary operators (`is null`, `is not null`). */
  value?: string
  /** For `between`: the upper bound. */
  value2?: string
}

/**
 * The comparison operators the 搜索 tab offers.
 *
 * Deliberately a closed set: each one maps to a SQL shape this plugin writes,
 * so the operand is always a bound parameter and never part of the statement.
 */
export type RowFilterOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'notContains' | 'startsWith' | 'endsWith'
  | 'isNull' | 'isNotNull' | 'between' | 'in'

/** Canonical operator order, for validation and the UI's select. */
export const ROW_FILTER_OPERATORS: readonly RowFilterOperator[] = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'contains', 'notContains', 'startsWith', 'endsWith',
  'between', 'in', 'isNull', 'isNotNull',
]

/**
 * Operators that need no operand.
 *
 * The browser uses this to hide an unused input rather than showing a field it
 * will ignore, and the compiler uses it to decide whether a missing operand is a
 * user error.
 */
export const UNARY_FILTER_OPERATORS: readonly RowFilterOperator[] = ['isNull', 'isNotNull']

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
  /**
   * 1-based position of this column inside the table's primary key.
   *
   * Present only for primary-key columns. `key === 'PRI'` says a column takes
   * part in the key but not where: a composite key's ORDER decides which
   * leading subsets an index can serve, so the 结构 tab needs the positions to
   * say "index (a, b)" truthfully and to let a user drop just one column of a
   * composite key.
   */
  primaryKeyPosition?: number
  /**
   * enum/set members, in declared order (MySQL). Absent for every other type.
   *
   * Carried on the wire rather than parsed by the browser: the members come
   * from the column's declared type, and a client-side regex on a type string
   * would have to re-implement MySQL's quoting rules for `enum('a''b')`.
   */
  options?: string[]
  /**
   * The column's value is computed by the engine and cannot be inserted or
   * updated. MySQL marks it in `EXTRA`; SQLite reports a generated column only
   * in the table's `CREATE` text.
   */
  generated?: boolean
  /**
   * The expression a generated column is computed from, as the engine reports it.
   *
   * MySQL: `information_schema.COLUMNS.GENERATION_EXPRESSION`, brackets included
   * (`(`a` * 2)`). Needed because `EXTRA` reports only that the column IS generated
   * (`STORED GENERATED` / `VIRTUAL GENERATED`) and never what from — and a `MODIFY`
   * that omits the expression would change the column instead of editing it.
   *
   * ABSENT for every ordinary column. It is also the RELIABLE test for "is this a
   * generated column": `EXTRA` carries `DEFAULT_GENERATED` for a plain
   * `DEFAULT CURRENT_TIMESTAMP`, so a substring match on `GENERATED` classifies an
   * ordinary column with a default as a computed one (measured).
   */
  generatedExpression?: string
  /**
   * The collation this column was declared with.
   *
   * MySQL: `information_schema.COLUMNS.COLLATION_NAME`. SQLite has no such catalog
   * column — a per-column `COLLATE` lives in the table's `CREATE` text — so it is
   * absent there rather than reported as empty, which would read as "no collation".
   */
  collation?: string
}

/** One index description (the 结构 tab). */
export interface IndexInfo {
  name: string
  unique: boolean
  columns: string[]
  /** Engine-specific index algorithm/type when reported. */
  type?: string
  /**
   * True for a primary key's own index.
   *
   * MySQL reports it as an ordinary index named `PRIMARY`; SQLite reports the
   * implicit `sqlite_autoindex_*` with `origin = 'pk'`. A user must not be able
   * to drop it as if it were a separate index — dropping it means dropping the
   * primary key — so the distinction has to survive normalization.
   */
  primary?: boolean
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
  /**
   * Indexes of the table, so the 浏览 tab can offer 按索引排序 without a second
   * request. Present only when the caller asked for them (`withIndexes=1`): an
   * index list costs a round trip on MySQL and the tree does not need it.
   */
  indexes?: IndexInfo[]
}

/**
 * The result of a schema change, plus what the panel must reload.
 *
 * A separate shape from {@link QueryResult} because a schema change invalidates
 * things a row write does not: a dropped column changes the grid's column list,
 * and a table rebuild changes everything about it. Naming what changed lets the
 * panel refresh exactly that instead of guessing.
 */
export interface SchemaChangeResult {
  /** Rows/steps the engine reported, for the confirmation message. */
  affected: number
  durationMs: number
  /**
   * What the caller should re-read: the table's structure, its rows, or the
   * schema's table list (a rebuild can rename the table it touched).
   */
  reload: Array<'columns' | 'indexes' | 'rows' | 'tables'>
}

/** One export request as the browser sends it. */
export interface ExportPayload {
  schema?: string
  tables?: string[]
  includeData: boolean
  includeStructure: boolean
  drop: boolean
  format: 'sql' | 'csv'
}

/** One export's outcome (the text itself, for the browser to save). */
export interface ExportResponse {
  filename: string
  contentType: string
  text: string
  truncated: string[]
  byteLength: number
}

/** One import request as the browser sends it. */
export interface ImportPayload {
  schema?: string
  table?: string
  format: 'sql' | 'csv'
  hasHeader?: boolean
  emptyAsNull?: boolean
  content: string
}

/** One import's outcome. */
export interface ImportResponse {
  statements: number
  rows: number
  skipped: Array<{ line: number; fields: number }>
}

/**
 * A table-maintenance operation.
 *
 * Mirrors the driver's list; kept here too because the browser names it and the
 * labels live in the locale files.
 */
export type MaintenanceOpView = 'check' | 'optimize' | 'repair' | 'analyze'

/** Every maintenance operation, in the order phpMyAdmin lists them. */
export const MAINTENANCE_OPS_VIEW: readonly MaintenanceOpView[] = ['check', 'optimize', 'repair', 'analyze']

/** One table's maintenance outcome. */
export interface MaintenanceOutcome {
  op: MaintenanceOpView
  ok: boolean
  /** The engine's own message lines, verbatim. */
  messages: string[]
  /** Which table this outcome belongs to, so many can be shown in one report. */
  table: string
}

/** One database-level operation. */
export type DatabaseOpView = 'create' | 'drop' | 'rename' | 'copy' | 'charset'

/**
 * Re-exported from the driver contract.
 *
 * These cross the wire — the browser sends column attributes, index kinds and table
 * options — so they belong to the shared protocol. Re-exporting rather than
 * redefining keeps ONE definition: two copies of `IndexKind` would be two lists to keep
 * in step, and the browser half would happily send a kind the host does not know.
 */
export type { ColumnAttribute, IndexKind, TableIndexSpec, TableOptions } from './drivers/types.ts'
export { COLUMN_ATTRIBUTES, INDEX_KINDS } from './drivers/types.ts'
/**
 * Re-exported so the browser and the driver agree on one definition.
 *
 * The sentinel means 「放在最前面」 in `positionAfter`; it lives next to the
 * driver contract because the driver is what interprets it.
 */
export { POSITION_FIRST, type ColumnSpecPositionAfter } from './drivers/types.ts'

/**
 * The 操作 tab's own contract, re-exported for the same reason.
 *
 * `TableActionOp` is what the panel enables and disables its blocks by, and
 * `TableOptionInfo` / `TableOptionPatch` are the 表选项 form's read and write shapes —
 * all three cross the wire, so all three live in one place.
 */
export type { TableActionOp, TableOptionInfo, TableOptionPatch, TableTarget } from './drivers/types.ts'
export { TABLE_ACTION_OPS } from './drivers/types.ts'

/**
 * One column-spec edit, as the host expects it.
 *
 * Lives here rather than in a client module because it crosses the wire: the 结构
 * tab sends it, and the table-creation dialog sends the same shape. Two definitions
 * would be two things to keep in step.
 */
import type { ColumnSpecPositionAfter } from './drivers/types.ts'

export interface ColumnSpecPayload {
  name: string
  type: string
  nullable: boolean
  defaultValue?: string
  comment?: string
  autoIncrement?: boolean
  unique?: boolean
  /** The declared length / values, as written inside the parentheses. */
  length?: string
  /** A per-column collation. */
  collate?: string
  /** MySQL column attributes (UNSIGNED, BINARY, …). */
  attributes?: import('./drivers/types.ts').ColumnAttribute[]
  /**
   * Where a NEW column goes: immediately after this existing column's name.
   *
   * MySQL's `ADD COLUMN … AFTER x`, which is how phpMyAdmin's 「在…之后」 offers a
   * position for a column being appended. `FIRST` is expressed as the sentinel
   * {@link POSITION_FIRST} rather than by a second field, because "at the very
   * beginning" and "after the column named nothing" are the same decision.
   *
   * Only meaningful for `addColumn`. Absent means "wherever the engine appends
   * it", which is the end — so an unchanged form and a form that picked the last
   * column produce the SAME statement rather than two that differ by nothing.
   *
   * NOT sent to SQLite: its `ALTER TABLE … ADD COLUMN` has no position clause,
   * and passing one is worse than useless — measured, SQLite ACCEPTS
   * `ADD COLUMN c TEXT AFTER a` and swallows `AFTER a` into the declared TYPE
   * (`c TEXT AFTER a`), so the column does not move and its type name is now a
   * string no other tool expects.
   */
  positionAfter?: ColumnSpecPositionAfter
}

/** A table-level schema-change request. */
export interface SchemaChangePayload {
  schema?: string
  table: string
  /** `isView` guards the whole schema surface: a view has no columns to alter. */
  isView?: boolean
  action:
    | 'addColumn'
    | 'alterColumn'
    | 'dropColumn'
    | 'setPrimaryKey'
    | 'createIndex'
    | 'dropIndex'
    | 'createTable'
  /**
   * A new table's columns, for `createTable`.
   *
   * Named `specs` rather than `columns` on purpose: `columns` already carries a list
   * of column NAMES for `setPrimaryKey`, and one key with two shapes is how the create
   * request came to be read from the wrong field. Reuses the column shape the other
   * actions take, so a table created here and a column added later go through the same
   * validation and rendering.
   */
  specs?: ColumnSpecPayload[]
  /** `createTable`: a table-level PRIMARY KEY over these columns. */
  primaryKey?: string[]
  /**
   * `createTable`: the indexes to create, including composite ones.
   *
   * Named separately from the columns' own key/unique flags because a composite index
   * spans columns: its ORDER is what a prefix scan depends on, so it cannot be a flag
   * on any single column.
   */
  indexes?: import('./drivers/types.ts').TableIndexSpec[]
  /**
   * `createTable`: table-level options.
   *
   * `tableOptions`, not `table`: `table` on this payload is already the table's NAME,
   * and one key cannot carry both a string and an object — TypeScript reported them as
   * duplicate identifiers, which is the check that caught it.
   */
  tableOptions?: import('./drivers/types.ts').TableOptions
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
  sources: DB_API_BASE + '/sources',  test: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/test`,
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
  /** How many distinct values a column holds (结构页的「非重复值」). */
  distinct: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/distinct?${params}`,
  row: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/row`,
  /** Delete several rows in one request (浏览页的多选删除）. */
  deleteRows: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/rows/delete`,
  table: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/table`,
  /** Schema changes: add / alter / drop a column, set the key, index management. */
  schema: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/schema`,
  /** Export a schema or one table (SQL dump or CSV). */
  exportData: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/export`,
  /** Import a SQL dump or a CSV file. */
  importData: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/import`,
  /** Table maintenance: check / optimize / repair / analyze, on one or many tables. */
  maintain: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/maintain`,
  /** What maintenance this engine can actually do (the UI disables the rest). */
  maintenanceSupport: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/maintenance-support`,
  /** Database-level operations: create / drop / rename / copy / charset. */
  databaseOp: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/database`,
  /** Which table-level operations this engine can perform (移动 / 表选项 / 复制). */
  tableActions: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/table-actions`,
  /** Move a table to another database (「将数据表移动到」). */
  tableMove: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/table/move`,
  /** Copy a table (structure and optionally data) into another database. */
  tableCopy: (id: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/table/copy`,
  /** Read (GET) or change (POST) one existing table's options. */
  tableOptions: (id: string, params: string) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/table/options?${params}`,
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
