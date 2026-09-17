/**
 * What the panel's auto-increment rule should be, checked against the engine.
 *
 * Probing MySQL directly showed the rule is narrower AND wider than what the panel
 * enforces, in two specific ways:
 *
 *   1. WIDER: the auto column needs to be A key, not necessarily the PRIMARY key.
 *      `b INT AUTO_INCREMENT UNIQUE` and even `b INT AUTO_INCREMENT, INDEX(b)` are accepted,
 *      while `b INT AUTO_INCREMENT` with no key is refused. The panel requires `primary`.
 *   2. NARROWER: inside a COMPOSITE key the auto column must be the FIRST member.
 *      `PRIMARY KEY(a, b)` with `a` auto works; with `b` auto it is refused unless `b` also
 *      has a key of its own. The panel does not check the position, so it will happily
 *      build a table the server rejects.
 *
 * Both directions are defects — too strict rejects valid tables, too loose produces a
 * server error — so this test pins the correct rule against real MySQL.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MysqlDriver } from '../src/drivers/mysql.ts'
import { SqliteDriver, sqliteAvailable } from '../src/drivers/sqlite.ts'
import type { ColumnSpec, DataSourceEntry } from '../src/protocol.ts'

const column = (overrides: Partial<ColumnSpec> & { name: string }): ColumnSpec => ({
  type: 'INT',
  nullable: false,
  ...overrides,
})

describe('MySQL: an auto-increment column needs A key, not the PRIMARY key', () => {
  let mysql: MysqlDriver | undefined
  let ok = false
  const database = `dbm_auto3_${process.pid}`

  beforeAll(async () => {
    const entry: DataSourceEntry = {
      id: 'mysql-test', kind: 'mysql', name: 'mysql-test',
      host: '127.0.0.1', port: 3306, user: 'root', password: 'root',
    } as DataSourceEntry
    const candidate = new MysqlDriver(entry)
    // Probe by CONNECTING; the module-loading check would let these cases skip silently.
    ok = await candidate.test().then(result => result.ok).catch(() => false)
    if (!ok) { await candidate.close().catch(() => {}); return }
    mysql = candidate
    await mysql.databaseOperation('create', database)
  })

  afterAll(async () => {
    if (mysql === undefined) return
    await mysql.databaseOperation('drop', database).catch(() => { /* best effort */ })
    await mysql.close()
  })

  it('accepts an auto-increment column that is UNIQUE but not the primary key', async () => {
    if (!ok || mysql === undefined) return
    await mysql.createTable(database, 't_unique', [
      column({ name: 'id' }),
      column({ name: 'seq', autoIncrement: true }),
    ], {
      primaryKey: ['id'],
      indexes: [{ kind: 'unique', name: 'uq_seq', columns: ['seq'] }],
    })
    const columns = await mysql.columns(database, 't_unique')
    expect(String(columns.find(entry => entry.name === 'seq')?.extra ?? '')).toMatch(/auto_increment/i)
  })

  it('refuses two auto-increment columns, naming the limit', async () => {
    if (!ok || mysql === undefined) return
    // The engine refuses it too, but its message does not say which column to change.
    await expect(mysql.createTable(database, 't_two', [
      column({ name: 'a', autoIncrement: true }),
      column({ name: 'b', autoIncrement: true }),
    ], { primaryKey: ['a'], indexes: [{ kind: 'unique', name: 'uq_b', columns: ['b'] }] })).rejects.toThrow(/only one/i)
  })

  it('refuses an auto-increment column that is not a key at all', async () => {
    if (!ok || mysql === undefined) return
    await expect(mysql.createTable(database, 't_nokey', [
      column({ name: 'id' }),
      column({ name: 'seq', autoIncrement: true }),
    ], { primaryKey: ['id'] })).rejects.toThrow(/so it must be a key/i)
  })

  it('accepts an auto-increment column as the FIRST member of a composite key', async () => {
    if (!ok || mysql === undefined) return
    await mysql.createTable(database, 't_first', [
      column({ name: 'a', autoIncrement: true }),
      column({ name: 'b' }),
    ], { primaryKey: ['a', 'b'] })
    const columns = await mysql.columns(database, 't_first')
    expect(String(columns.find(entry => entry.name === 'a')?.extra ?? '')).toMatch(/auto_increment/i)
  })

  it('refuses an auto-increment column that is NOT the first member of a composite key', async () => {
    if (!ok || mysql === undefined) return
    // MySQL: "there can be only one auto column and it must be defined as a key" — the
    // key it is a member of does not count unless the column leads it.
    await expect(mysql.createTable(database, 't_second', [
      column({ name: 'a' }),
      column({ name: 'b', autoIncrement: true }),
    ], { primaryKey: ['a', 'b'] })).rejects.toThrow(/first column of a key/i)
  })

  it('accepts an auto-increment column that is second in the key but keyed on its own', async () => {
    if (!ok || mysql === undefined) return
    // The engine allows this because `b` has its own index; the position rule applies to
    // the key the column actually relies on.
    await mysql.createTable(database, 't_second_own', [
      column({ name: 'a' }),
      column({ name: 'b', autoIncrement: true }),
    ], { primaryKey: ['a', 'b'], indexes: [{ kind: 'index', name: 'ix_b', columns: ['b'] }] })
    const columns = await mysql.columns(database, 't_second_own')
    expect(String(columns.find(entry => entry.name === 'b')?.extra ?? '')).toMatch(/auto_increment/i)
  })
})

describe('SQLite: an auto-increment column must be the INTEGER PRIMARY KEY itself', () => {
  let dir: string
  let driver: SqliteDriver
  let ok = false

  beforeAll(async () => {
    ok = await sqliteAvailable()
    dir = mkdtempSync(join(tmpdir(), 'dbm-auto3-'))
    if (ok) {
      driver = new SqliteDriver({ id: 'test', kind: 'sqlite', name: 'test', file: join(dir, 'a.db') } as DataSourceEntry)
      await driver.test()
    }
  })

  afterAll(async () => {
    if (ok && driver !== undefined) await driver.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses two auto-increment columns', async () => {
    if (!ok) return
    // SQLite has only one rowid, so a second AUTOINCREMENT has nowhere to live.
    await expect(driver.createTable(undefined, 's_two', [
      column({ name: 'a', type: 'INTEGER', autoIncrement: true }),
      column({ name: 'b', type: 'INTEGER', autoIncrement: true }),
    ], { primaryKey: ['a', 'b'] })).rejects.toThrow(/only one/i)
  })

  it('refuses auto-increment on a column that is not the whole primary key', async () => {
    if (!ok) return
    // `a` is auto but the key is composite, so `a` is not the rowid alias.
    await expect(driver.createTable(undefined, 's_composite', [
      column({ name: 'a', type: 'INTEGER', autoIncrement: true }),
      column({ name: 'b', type: 'INTEGER' }),
    ], { primaryKey: ['a', 'b'] })).rejects.toThrow(/only primary key|rowid/i)
  })
})
