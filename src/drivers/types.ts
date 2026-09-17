/**
 * Driver contract every engine adapter implements. The route layer and the
 * agent tools speak only this interface, so adding an engine never touches
 * them.
 */

import type {
  ColumnInfo,
  IndexInfo,
  QueryResult,
  RedisCreateKey,
  RedisDeletePrefixResult,
  RedisElementEdit,
  RedisInfo,
  RedisKeyInfo,
  RedisKeyPage,
  RedisLevelPage,
  RedisMutationResult,
  RedisSearchPage,
  RedisTreePage,
  RedisValue,
  RowFilter,
  SchemaInfo,
  TableInfo,
  TablePage,
  TestResult,
  DataSourceEntry,
} from '../protocol.ts'
import type { AggregateBatch } from './redis.ts'

/** Filters and paging for one table read. */
export interface RowQuery {
  schema?: string
  table: string
  page: number
  pageSize: number
  /**
   * Column to sort by; must be an existing column of the table.
   *
   * `orderByIndex` takes precedence when set: sorting by the table's PRIMARY KEY
   * is the common case (phpMyAdmin's 「按主键排序」) and an index's column list is
   * not the same as the key's, so the two are named separately.
   */
  orderBy?: string
  orderDir?: 'asc' | 'desc'
  /**
   * Sort by the given columns, in order, instead of `orderBy`.
   *
   * Used by the 浏览 tab's 按索引排序: a table with no primary key still has
   * indexes, and sorting by one is how a user answers "show me the duplicates"
   * or "is this index actually used". Each entry is an existing column name.
   */
  orderByColumns?: string[]
  /**
   * Which filter this read applies:
   * - 'browse' — no filter unless `condition` is set.
   * - 'search' — the structured `filters` list, ANDed or ORed by `filterJoin`.
   * - 'sql'    — a raw SQL condition appended verbatim (the SQL tab's own path).
   */
  mode: 'browse' | 'search'
  /** Free-text term matched against every text column (the quick search box). */
  term?: string
  /** Raw SQL condition (privileged path; single condition, no separator). */
  condition?: string
  /** Structured search conditions from the 搜索 tab's column form. */
  filters?: RowFilter[]
  /** How the structured filters combine. Defaults to 'AND'. */
  filterJoin?: 'and' | 'or'
  /**
   * Skip the `COUNT(*)` that normally accompanies a page.
   *
   * For a caller that walks the whole table a page at a time — the SQL/CSV
   * exporter — the count is pure overhead: it is computed again for every page
   * and thrown away. `total` comes back as -1, which is a value no count can
   * produce, so a caller that forgot this option cannot mistake it for "empty".
   */
  skipCount?: boolean
}

/**
 * One condition from the 搜索 tab.
 *
 * Re-exported from the shared protocol so the driver contract and the browser
 * cannot drift; the definition lives there because both halves name it.
 */
export type { RowFilter, RowFilterOperator } from '../protocol.ts'
export { ROW_FILTER_OPERATORS, UNARY_FILTER_OPERATORS } from '../protocol.ts'

/** A key/value pair identifying one row for an update or delete. */
export interface RowKey {
  column: string
  value: string | number | boolean | null
}

/** A column/value assignment for an insert or update. */
export interface RowValue {
  column: string
  value: string | number | boolean | null
}

/**
 * One column's definition for a schema change.
 *
 * Distinct from {@link RowValue}: this is DDL, so `defaultValue` is an
 * expression and `type` is a declared type — both validated by the driver
 * before they reach a statement.
 */
export interface ColumnSpec {
  name: string
  type: string
  nullable: boolean
  defaultValue?: string
  /** Part of the primary key, in the position given. */
  primaryKeyPosition?: number
  /** Autoincrement / rowid alias. */
  autoIncrement?: boolean
  /** Attached UNIQUE constraint. */
  unique?: boolean
  comment?: string
  /** True when this column starts a new one rather than replacing an existing one. */
  added?: boolean
  /**
   * The character set / collation to declare for this column.
   *
   * MySQL accepts a per-column charset and collation; SQLite accepts a per-column
   * COLLATE (measured to take effect: `COLLATE NOCASE` really does match
   * case-insensitively). Only the collation is offered for SQLite — it has no
   * per-column character set to set.
   */
  collate?: string
  charset?: string
  /**
   * Extra attributes spliced after the type.
   *
   * `UNSIGNED`, `ZEROFILL`, `BINARY`, `ON UPDATE CURRENT_TIMESTAMP` and friends. Kept
   * as discrete flags rather than one free-text field so the panel can offer it only
   * where the engine honours it — SQLite ACCEPTS the words but stores them as part of
   * the type name with no effect (measured), which is worse than refusing them.
   */
  attributes?: ColumnAttribute[]
  /**
   * The declared length / values, as written inside the parentheses.
   *
   * A string, not a number: `VARCHAR(255)`, `DECIMAL(10,2)` and
   * `ENUM('a','b')` all use the same slot and only the first is an integer.
   */
  length?: string
}

/** A column attribute the engines treat as a keyword. */
export type ColumnAttribute =
  | 'unsigned'
  | 'zerofill'
  | 'binary'
  | 'onUpdateCurrentTimestamp'

/** Every column attribute, for validation and the UI's list. */
export const COLUMN_ATTRIBUTES: readonly ColumnAttribute[] = ['unsigned', 'zerofill', 'binary', 'onUpdateCurrentTimestamp']

/** The kind of index a table-level index is. */
export type IndexKind = 'primary' | 'unique' | 'index' | 'fulltext' | 'spatial'

/** Every index kind, in phpMyAdmin's order. */
export const INDEX_KINDS: readonly IndexKind[] = ['primary', 'unique', 'index', 'fulltext', 'spatial']

/** One index to create alongside a new table. */
export interface TableIndexSpec {
  kind: IndexKind
  /** A name; ignored for `primary`, whose name is always PRIMARY. */
  name?: string
  /** The columns, in index order — the order is what a prefix scan depends on. */
  columns: string[]
  /** `fulltext`/`spatial` accept a parser / prefix length in MySQL; passed through. */
  options?: string
}

/**
 * Table-level options for a new table.
 *
 * Each is optional because the engines differ: SQLite has no storage engine, no table
 * comment and no table-level collation (all three are refused by the server — measured),
 * and a panel that offered them there would be offering a field whose value is
 * discarded.
 */
export interface TableOptions {
  /** MySQL only. */
  engine?: string
  /** MySQL: the table's default collation. SQLite has none (it is per column). */
  collate?: string
  charset?: string
  /** MySQL only. */
  comment?: string
  /** SQLite's own trailing keywords: `WITHOUT ROWID`, `STRICT`. */
  tail?: string
}

/**
 * Whether a table-maintenance operation actually does anything on InnoDB.
 *
 * `repair` is a MyISAM-era statement: on InnoDB the server answers with a NOTE
 * ("The storage engine for the table doesn't support repair") and reports the table
 * as OK, so a panel that showed "repaired" would be claiming work that did not
 * happen. This is why the raw messages travel to the UI.
 */
export type MaintenanceNoteKind = 'note' | 'status' | 'error' | 'warning'

/** Options for a table listing. */
export interface TableListOptions {
  /**
   * Also fill in each table's row count and size.
   *
   * Off by default because it is not free: MySQL reads estimates from
   * `information_schema` (cheap but still a second column set), while SQLite
   * walks the database's btree page map through `dbstat`, whose cost grows with
   * the FILE size — measured 86 ms on a 26 MB database, so roughly 3.4 s on a
   * 1 GB one. The tree expands a database on every click and must not pay that;
   * the overview pane asks for it explicitly and shows a loading state.
   */
  stats?: boolean
}

/**
 * A table-maintenance operation, as phpMyAdmin's 操作 tab offers them.
 *
 * The two engines support different subsets, and the panel reports which — see
 * {@link SqlDriver.maintenanceSupport}. Nothing here is pretended to work: a
 * `repair` on SQLite is refused with the reason, and MySQL's InnoDB answers
 * `repair` with a note rather than an error, which is passed through.
 */
export type MaintenanceOp = 'check' | 'optimize' | 'repair' | 'analyze'

/** Every maintenance operation, for validation and the UI's list. */
export const MAINTENANCE_OPS: readonly MaintenanceOp[] = ['check', 'optimize', 'repair', 'analyze']

/** What one maintenance run reported. */
export interface MaintenanceResult {
  op: MaintenanceOp
  /** Whether the engine reported the table as healthy / the operation as a success. */
  ok: boolean
  /**
   * The engine's own message lines.
   *
   * Kept verbatim because they carry the information a user acts on: MySQL's
   * `optimize` says "Table does not support optimize, doing recreate + analyze
   * instead", and its `repair` on InnoDB says the engine does not support it —
   * neither is an error, and both explain what actually happened.
   */
  messages: string[]
}

/** One database-level operation. */
export type DatabaseOp =
  | 'create'
  | 'drop'
  | 'rename'
  /** Copy the structure and the data into a new database. */
  | 'copy'
  /** Change the database's default character set / collation. */
  | 'charset'

/** Options for {@link SqlDriver.databaseOperation}. */
export interface DatabaseOperationOptions {
  /**
   * The database being operated ON, for the ops that need one.
   *
   * `rename` and `copy` have both a source and a target, and `charset` and `drop`
   * act on an existing database. `create` is the only op with no source.
   */
  from?: string
  /** `charset`: the character set to set as the database default. */
  charset?: string
  /** `charset`: the collation, which must belong to the character set. */
  collate?: string
  /** `copy`: whether to copy the rows as well as the structure. */
  includeData?: boolean
}

/** SQL engine driver. */
export interface SqlDriver {
  readonly kind: 'sqlite' | 'mysql'
  /** Connection test; also used as the connect probe. */
  test(): Promise<TestResult>
  /** Release the pooled connection. */
  close(): Promise<void>
  /** Databases/schemas visible to this connection. */
  schemas(): Promise<SchemaInfo[]>
  /**
   * Which maintenance operations this engine can actually perform.
   *
   * Explicit rather than inferred from a failed statement: the panel disables what
   * is unsupported and says why, instead of offering a button whose only outcome is
   * an engine error message.
   */
  maintenanceSupport(): MaintenanceOp[]
  /** Run maintenance on one or more tables. */
  maintain(schema: string | undefined, tables: string[], op: MaintenanceOp): Promise<MaintenanceResult[]>
  /**
   * Run one database-level operation.
   *
   * `name` is the target (the new database, or the new name for a rename); `options`
   * carries the arguments a specific op needs (`charset`, `collate`, `includeData`).
   */
  databaseOperation(op: DatabaseOp, name: string, options?: DatabaseOperationOptions): Promise<QueryResult>
  /** Tables and views in one schema. */
  tables(schema?: string, options?: TableListOptions): Promise<TableInfo[]>
  /** Column metadata for one table. */
  columns(schema: string | undefined, table: string): Promise<ColumnInfo[]>
  /** Index metadata for one table. */
  indexes(schema: string | undefined, table: string): Promise<IndexInfo[]>
  /** One page of table rows. */
  rows(query: RowQuery): Promise<TablePage>
  /** Run a read-only statement (the 浏览 / SQL / 搜索 surfaces). */
  query(sql: string, params: unknown[], limit: number, schema?: string): Promise<QueryResult>
  /** Run any statement; the caller owns the write-authorisation decision. */
  exec(sql: string, params: unknown[], schema?: string): Promise<QueryResult>
  /** Insert one row. */
  insertRow(schema: string | undefined, table: string, values: RowValue[]): Promise<QueryResult>
  /** Insert several rows in one transaction; returns the total rows affected. */
  insertRows(schema: string | undefined, table: string, rows: RowValue[][]): Promise<QueryResult>
  /** Update rows matched by `keys`. */
  updateRow(schema: string | undefined, table: string, values: RowValue[], keys: RowKey[]): Promise<QueryResult>
  /** Delete rows matched by `keys`. */
  deleteRow(schema: string | undefined, table: string, keys: RowKey[]): Promise<QueryResult>
  /**
   * Delete every row matched by any of `keySets`, in ONE transaction.
   *
   * The batch form of {@link deleteRow}, for the 浏览 tab's multi-select. One
   * statement per key set rather than an `IN` list, because a key may be
   * composite or contain NULL and neither survives an `IN (…)` unchanged.
   */
  deleteRows(schema: string | undefined, table: string, keySets: RowKey[][]): Promise<QueryResult>
  /**
   * How many distinct values a column holds (COUNT(DISTINCT col)).
   *
   * Nullable columns report the count of non-NULL distinct values; the UI says
   * SO rather than adding one for the NULL group, which would be a different
   * number from what the query returns.
   */
  distinctCount(schema: string | undefined, table: string, column: string): Promise<number>

  // ---- schema editing (the 结构 tab) ------------------------------------
  /**
   * Create a table from a column list.
   *
   * A dedicated method rather than "run this SQL": the panel has to be usable without
   * the user writing DDL, and building the statement in the driver means the
   * identifier quoting and the type/default validation are exactly the ones the column
   * editor already goes through.
   *
   * `indexes` is separate from the columns' own key/unique flags because a COMPOSITE
   * index spans several columns — its column ORDER is what a prefix scan depends on,
   * so it cannot be expressed as a flag on any one of them.
   */
  createTable(
    schema: string | undefined,
    table: string,
    columns: ColumnSpec[],
    options?: { primaryKey?: string[]; indexes?: TableIndexSpec[]; table?: TableOptions },
  ): Promise<QueryResult>
  /** Add a column. */
  addColumn(schema: string | undefined, table: string, spec: ColumnSpec): Promise<QueryResult>
  /** Change an existing column's name, type, nullability, default or comment. */
  alterColumn(schema: string | undefined, table: string, spec: ColumnSpec, options?: { rename?: string }): Promise<QueryResult>
  /** Drop a column. */
  dropColumn(schema: string | undefined, table: string, column: string): Promise<QueryResult>
  /** Replace the table's primary key with `columns`, in that order (empty drops it). */
  setPrimaryKey(schema: string | undefined, table: string, columns: string[]): Promise<QueryResult>
  /** Create an index. */
  createIndex(schema: string | undefined, table: string, spec: { name: string; columns: string[]; unique: boolean }): Promise<QueryResult>
  /** Drop an index. Refuses a primary key's own index. */
  dropIndex(schema: string | undefined, table: string, name: string): Promise<QueryResult>
  /**
   * The `CREATE TABLE` statement for a table, as the engine stores it.
   *
   * Read rather than reconstructed: the export has to reproduce the table
   * (`CHECK`, foreign keys, collation, generated columns, engine options) and
   * the engine's own text is the only complete description of it. `undefined`
   * for a view or a missing table.
   */
  createStatement(schema: string | undefined, table: string): Promise<string | undefined>
  /**
   * The DDL a table needs BEYOND its `CREATE TABLE`.
   *
   * Engine-specific and not cosmetic. SQLite keeps an index (and a trigger) as a
   * separate schema object, so its `CREATE TABLE` text does not mention them —
   * a dump built from that text alone would silently lose every index on the
   * table. MySQL's `SHOW CREATE TABLE` already inlines its keys, so it returns
   * nothing here and a caller that emitted both would create them twice.
   *
   * @returns statements to run after the `CREATE TABLE`, in dependency order.
   */
  auxiliaryDdl(schema: string | undefined, table: string): Promise<string[]>
  /**
   * Run several statements as ONE atomic unit.
   *
   * The import path, and distinct from `exec` in the two ways that matter to it:
   * the statements share a transaction (so a failure half way is a no-op rather
   * than a half-imported database), and each is reported through `onStatement`
   * as it runs, so a long import has progress instead of one silent pause.
   *
   * A script's own `BEGIN`/`COMMIT` is tolerated rather than rejected: a dump
   * written by this plugin contains them, and refusing them would make the
   * plugin's own exports un-importable.
   */
  runScript(statements: string[], schema: string | undefined, onStatement?: (index: number) => void): Promise<void>
  /**
   * Every row of a table, in one array.
   *
   * For the exporter, which must see all of them. Deliberately NOT the 浏览
   * tab's path: loading a million rows into the host's memory to render 200 of
   * them is the mistake the paged read exists to prevent.
   *
   * @param limit - stop after this many rows; `truncated` says whether it hit.
   */
  allRows(schema: string | undefined, table: string, limit: number): Promise<{ columns: string[]; rows: Array<Record<string, string | number | boolean | null>>; truncated: boolean }>
  /** List the tables and views in one schema (names only, for an export scope). */
  tableNames(schema: string | undefined): Promise<Array<{ name: string; type: string }>>
  /**
   * Which tables each table references, keyed by lower-cased table name.
   *
   * For the exporter's ordering: a dump replays statement by statement, and a
   * `CREATE TABLE` whose foreign key names a table that does not exist yet is
   * refused. `information_schema.TABLES` returns name order, which puts a
   * referrer before its target often enough to make an unordered dump
   * un-importable.
   */
  tableReferences(schema: string | undefined): Promise<Map<string, string[]>>
  /**
   * Remove every row of a table, keeping the table itself.
   *
   * `isView` picks the engine-legal form: a view has no rows of its own, so
   * emptying it is refused rather than silently reported as "0 rows removed".
   */
  truncateTable(schema: string | undefined, table: string, isView?: boolean): Promise<QueryResult>
  /** Drop a table or a view, whichever `isView` says this object is. */
  dropTable(schema: string | undefined, table: string, isView?: boolean): Promise<QueryResult>
}

/** Redis-specific driver surface. */
export interface RedisDriver {
  readonly kind: 'redis'
  test(): Promise<TestResult>
  close(): Promise<void>
  info(): Promise<RedisInfo>
  /** SCAN one page of keys. */
  keys(input: { pattern: string; cursor: string; count: number; db: number }): Promise<RedisKeyPage>
  /** One folder level of one database — what the tree lazily loads. */
  level(input: { db: number; prefix: string; withTypes: boolean }): Promise<RedisLevelPage>
  /** Search one database with a Redis glob pattern (server-side SCAN MATCH). */
  search(input: { db: number; pattern: string }): Promise<RedisSearchPage>
  /**
   * Fold one bounded batch of the keyspace into counts, server-side.
   *
   * Null when the server rejects scripting (EVAL), which lets the host fall back to
   * folding on the host instead of failing outright. See the driver's documentation
   * for why the fold happens server-side at all.
   */
  aggregateBatch(input: {
    db?: number
    cursor: string
    batchKeys: number
    nameBudget: number
  }): Promise<AggregateBatch | null>
  /** One database's key count (DBSIZE), O(1) — used to size an index walk. */
  keyCount(db: number): Promise<number>
  /** TYPE and TTL for a list of key names, in batched round trips. */
  describeKeysPublic(db: number, names: string[]): Promise<RedisKeyInfo[]>
  /** Every key in one database matching a pattern (bounded; reports truncation). */
  tree(input: { db: number; pattern?: string }): Promise<RedisTreePage>
  /** Read one key's full value (bounded by `limit` per collection). */
  value(key: string, db: number, limit: number): Promise<RedisValue>
  /** Create one key; refuses to overwrite an existing one. */
  createKey(input: RedisCreateKey, db: number): Promise<void>
  /** Delete one key; returns whether it existed. */
  deleteKey(key: string, db: number): Promise<boolean>
  /** Replace a string key's value, keeping its TTL. */
  setString(key: string, value: string, db: number): Promise<RedisMutationResult>
  /** Set a key's TTL; a non-positive value means "no expiry" (PERSIST). */
  setTtl(key: string, seconds: number, db: number): Promise<RedisMutationResult>
  /** Add, change or remove one element of a collection key. */
  editElement(key: string, edit: RedisElementEdit, db: number): Promise<RedisMutationResult>
  /** Delete a folder: its own key plus every descendant, scanned fresh here. */
  deletePrefix(path: string, db: number): Promise<RedisDeletePrefixResult>
  /** How many keys a folder holds (the delete dialog's warning). */
  countPrefix(path: string, db: number): Promise<number>
  /** Run one command; the caller owns the write-authorisation decision. */
  command(args: string[], db: number): Promise<QueryResult>
}

/** Any driver the pool can hand out. */
export type Driver = SqlDriver | RedisDriver

/** Whether a driver speaks SQL. */
export function isSqlDriver(driver: Driver): driver is SqlDriver {
  return driver.kind === 'sqlite' || driver.kind === 'mysql'
}

/** Whether a driver speaks the Redis protocol. */
export function isRedisDriver(driver: Driver): driver is RedisDriver {
  return driver.kind === 'redis'
}

/** Build the driver for one stored entry. */
export type DriverFactory = (entry: DataSourceEntry) => Driver
