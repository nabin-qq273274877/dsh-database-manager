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
}

/**
 * One condition from the 搜索 tab.
 *
 * Structured rather than a SQL fragment so the operator decides the SQL shape:
 * `contains` is `LIKE %v%` (a bound pattern), `is null` is `IS NULL` (no bound
 * value at all), `in` is a list of bound parameters. Building this as text would
 * put the user's operand back into the statement.
 */
export interface RowFilter {
  /** Column the condition applies to; must exist on the table. */
  column: string
  /** Comparison to apply. */
  operator: RowFilterOperator
  /** Operand; ignored by the unary operators (`is null`, `is not null`). */
  value?: string
  /**
   * True when the operand is a pre-built operator fragment rather than the
   * column's own type. Set by the 结构 tab's 「非重复值」 shortcut, not by a user
   * typing; it is not exposed in the 搜索 tab's operator list.
   */
  raw?: boolean
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
}

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

/** SQL engine driver. */
export interface SqlDriver {
  readonly kind: 'sqlite' | 'mysql'
  /** Connection test; also used as the connect probe. */
  test(): Promise<TestResult>
  /** Release the pooled connection. */
  close(): Promise<void>
  /** Databases/schemas visible to this connection. */
  schemas(): Promise<SchemaInfo[]>
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
