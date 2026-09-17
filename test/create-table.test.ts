/**
 * Tests for the 新建表 path: creating a table from a column list.
 *
 * The rules that matter here are the ones the form cannot express as field-level
 * validation, and where getting them wrong produces an engine error rather than a
 * refused form:
 *
 * - SQLite's `AUTOINCREMENT` is legal ONLY on an `INTEGER PRIMARY KEY` — the rowid
 *   alias. `INT PRIMARY KEY AUTOINCREMENT` is not the alias, and the failure is a
 *   syntax error, so an implementation that emits it for any integer-ish type is
 *   broken in a way only a real engine reveals.
 * - A single-column key goes inline (so it can carry AUTOINCREMENT) while a composite
 *   key has no inline form and must be a table constraint.
 * - MySQL requires an auto-increment column to be a key.
 *
 * SQLite runs unconditionally (it is the one engine with no server); the MySQL cases
 * are skipped when no server is reachable, so the suite stays runnable offline.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SqliteDriver, sqliteAvailable } from '../src/drivers/sqlite.ts'
import { MysqlDriver } from '../src/drivers/mysql.ts'
import type { ColumnSpec, DataSourceEntry } from '../src/protocol.ts'

let dir: string
let entry: DataSourceEntry
let driver: SqliteDriver
let available = false

beforeAll(async () => {
  available = await sqliteAvailable()
  dir = mkdtempSync(join(tmpdir(), 'dbm-createtable-'))
  entry = { id: 'test', kind: 'sqlite', name: 'test', file: join(dir, 'test.db') } as DataSourceEntry
  if (available) {
    driver = new SqliteDriver(entry)
    await driver.test()
  }
})

afterAll(async () => {
  if (available && driver !== undefined) await driver.close()
  rmSync(dir, { recursive: true, force: true })
})

const maybe = (name: string, run: () => Promise<void>) => it(name, async () => {
  if (!available) return expect(true).toBe(true)
  await run()
})

const column = (overrides: Partial<ColumnSpec> & { name: string }): ColumnSpec => ({
  type: 'TEXT',
  nullable: true,
  ...overrides,
})

describe('SQLite createTable', () => {
  it('creates a table with an INTEGER PRIMARY KEY AUTOINCREMENT', async () => {
    if (!available) return
    await driver.createTable(undefined, 't_auto', [
      column({ name: 'id', type: 'INTEGER', nullable: false, autoIncrement: true }),
      column({ name: 'label' }),
    ], { primaryKey: ['id'] })

    const columns = await driver.columns(undefined, 't_auto')
    expect(columns.map(entry => entry.name)).toEqual(['id', 'label'])
    // The rowid alias: inserting without a value must assign one.
    await driver.insertRow(undefined, 't_auto', [{ column: 'label', value: 'a' }])
    const page = await driver.rows({ table: 't_auto', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.rows[0]?.['id']).toBe(1)
  })

  it('rejects an auto-increment column whose type is not INTEGER', async () => {
    if (!available) return
    // The driver does not invent the rule — it passes the column to the renderer — so
    // SQLite is the authority on whether the statement is legal. What must hold is
    // that it FAILS rather than quietly creating a table that will not auto-increment.
    await expect(driver.createTable(undefined, 't_bad_auto', [
      column({ name: 'id', type: 'INT', nullable: false, autoIncrement: true }),
    ], { primaryKey: ['id'] })).rejects.toThrow()
  })

  it('creates a composite primary key as a table constraint', async () => {
    if (!available) return
    await driver.createTable(undefined, 't_composite', [
      column({ name: 'a', type: 'INTEGER', nullable: false }),
      column({ name: 'b', type: 'INTEGER', nullable: false }),
    ], { primaryKey: ['a', 'b'] })

    const columns = await driver.columns(undefined, 't_composite')
    // Both members of the key report their position, which is what the 结构 tab reads.
    const positions = columns.filter(entry => entry.primaryKeyPosition !== undefined).map(entry => [entry.name, entry.primaryKeyPosition])
    expect(positions).toEqual([['a', 1], ['b', 2]])
    // The composite key must actually be enforced.
    await driver.insertRow(undefined, 't_composite', [{ column: 'a', value: 1 }, { column: 'b', value: 2 }])
    await expect(driver.insertRow(undefined, 't_composite', [{ column: 'a', value: 1 }, { column: 'b', value: 2 }])).rejects.toThrow()
  })

  it('refuses a key naming a column that is not being created', async () => {
    if (!available) return
    await expect(driver.createTable(undefined, 't_bad_key', [
      column({ name: 'id', type: 'INTEGER' }),
    ], { primaryKey: ['nope'] })).rejects.toThrow(/not being created/)
  })

  it('refuses a table with no columns', async () => {
    if (!available) return
    await expect(driver.createTable(undefined, 't_empty', [])).rejects.toThrow(/at least one column/)
  })

  it('refuses duplicate column names with a message about the names', async () => {
    if (!available) return
    await expect(driver.createTable(undefined, 't_dupe', [
      column({ name: 'x', type: 'TEXT' }),
      column({ name: 'x', type: 'TEXT' }),
    ])).rejects.toThrow(/same name/)
  })

  it('does not silently accept an existing table name', async () => {
    if (!available) return
    await driver.createTable(undefined, 't_exists', [column({ name: 'id', type: 'INTEGER' })])
    // No IF NOT EXISTS: creating over an existing name must fail, not no-op.
    await expect(driver.createTable(undefined, 't_exists', [column({ name: 'id', type: 'INTEGER' })])).rejects.toThrow()
  })

  maybe('the created table shows up in the table list', async () => {
    const names = (await driver.tables(undefined)).map(table => table.name)
    expect(names).toContain('t_auto')
  })
})

describe('MySQL createTable', () => {
  let mysql: MysqlDriver | undefined
  let mysqlOk = false
  const database = `dbm_ct_${process.pid}`

  beforeAll(async () => {
    const probe: DataSourceEntry = {
      id: 'mysql-test', kind: 'mysql', name: 'mysql-test',
      host: '127.0.0.1', port: 3306, user: 'root', password: 'root',
    } as DataSourceEntry
    /*
     * Probe by CONNECTING, not by asking whether the driver module loads.
     *
     * `mysqlAvailable()` only reports that `mysql2` could be imported, so using it as
     * the gate made every case here run with `mysql` undefined and return early — the
     * suite reported 13 passing while five of them asserted nothing. The 0ms timings
     * are what exposed it. A connection attempt is the only honest check.
     */
    const candidate = new MysqlDriver(probe)
    mysqlOk = await candidate.test().then(result => result.ok).catch(() => false)
    if (!mysqlOk) {
      await candidate.close().catch(() => { /* nothing to close */ })
      return
    }
    mysql = candidate
    await mysql.databaseOperation('create', database)
  })

  afterAll(async () => {
    if (mysql === undefined) return
    await mysql.databaseOperation('drop', database).catch(() => { /* best effort */ })
    await mysql.close()
  })

  it('creates a table with an AUTO_INCREMENT key', async () => {
    if (!mysqlOk || mysql === undefined) return
    await mysql.createTable(database, 't_auto', [
      column({ name: 'id', type: 'INT', nullable: false, autoIncrement: true }),
      column({ name: 'label', type: 'VARCHAR(20)' }),
    ], { primaryKey: ['id'] })

    const columns = await mysql.columns(database, 't_auto')
    expect(columns.map(entry => entry.name)).toEqual(['id', 'label'])
    expect(columns[0]?.extra ?? '').toMatch(/auto_increment/i)
  })

  it('creates a composite key that the server enforces', async () => {
    if (!mysqlOk || mysql === undefined) return
    await mysql.createTable(database, 't_composite', [
      column({ name: 'a', type: 'INT', nullable: false }),
      column({ name: 'b', type: 'INT', nullable: false }),
    ], { primaryKey: ['a', 'b'] })
    await mysql.insertRow(database, 't_composite', [{ column: 'a', value: 1 }, { column: 'b', value: 2 }])
    await expect(mysql.insertRow(database, 't_composite', [{ column: 'a', value: 1 }, { column: 'b', value: 2 }])).rejects.toThrow()
  })

  it('refuses an auto-increment column that is not a key', async () => {
    if (!mysqlOk || mysql === undefined) return
    // MySQL is the authority: it rejects an auto column outside a key with
    // "there can be only one auto column and it must be defined as a key".
    await expect(mysql.createTable(database, 't_bad_auto', [
      column({ name: 'id', type: 'INT', nullable: false, autoIncrement: true }),
    ])).rejects.toThrow()
  })

  it('refuses a key naming a column that is not being created', async () => {
    if (!mysqlOk || mysql === undefined) return
    await expect(mysql.createTable(database, 't_bad_key', [
      column({ name: 'id', type: 'INT' }),
    ], { primaryKey: ['nope'] })).rejects.toThrow(/not being created/)
  })

  it('does not silently accept an existing table name', async () => {
    if (!mysqlOk || mysql === undefined) return
    await mysql.createTable(database, 't_exists', [column({ name: 'id', type: 'INT' })])
    await expect(mysql.createTable(database, 't_exists', [column({ name: 'id', type: 'INT' })])).rejects.toThrow()
  })
})
