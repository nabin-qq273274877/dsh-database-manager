/**
 * Driver contract every engine adapter implements. The route layer and the
 * agent tools speak only this interface, so adding an engine never touches
 * them.
 */

import type {
  ColumnInfo,
  IndexInfo,
  QueryResult,
  RedisInfo,
  RedisKeyPage,
  RedisValue,
  SchemaInfo,
  TableInfo,
  TablePage,
  TestResult,
  DataSourceEntry,
} from '../protocol.ts'

/** Filters and paging for one table read. */
export interface RowQuery {
  schema?: string
  table: string
  page: number
  pageSize: number
  /** Column to sort by; must be an existing column of the table. */
  orderBy?: string
  orderDir?: 'asc' | 'desc'
  /**
   * Which tab produced this read, which decides how the filter is applied:
   * - 'browse' — no filter.
   * - 'search' — `where` is a free-text term matched against every text column.
   * - 'sql'    — `where` is a raw SQL condition appended verbatim to WHERE.
   */
  mode: 'browse' | 'search'
  /** Search term (mode 'search'). */
  term?: string
  /** Raw SQL condition (privileged path used only by the row editor's SQL box). */
  condition?: string
}

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
  tables(schema?: string): Promise<TableInfo[]>
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
  /** Update rows matched by `keys`. */
  updateRow(schema: string | undefined, table: string, values: RowValue[], keys: RowKey[]): Promise<QueryResult>
  /** Delete rows matched by `keys`. */
  deleteRow(schema: string | undefined, table: string, keys: RowKey[]): Promise<QueryResult>
}

/** Redis-specific driver surface. */
export interface RedisDriver {
  readonly kind: 'redis'
  test(): Promise<TestResult>
  close(): Promise<void>
  info(): Promise<RedisInfo>
  /** SCAN one page of keys. */
  keys(input: { pattern: string; cursor: string; count: number; db: number }): Promise<RedisKeyPage>
  /** Read one key's full value (bounded by `limit` per collection). */
  value(key: string, db: number, limit: number): Promise<RedisValue>
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
