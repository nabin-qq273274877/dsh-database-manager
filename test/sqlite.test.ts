/**
 * End-to-end driver tests against a real SQLite file.
 *
 * SQLite is the one engine available with no external server, so it is the
 * place where the full read/write path — connect, schemas, tables, columns,
 * indexes, paged rows, insert, update, delete, and the read-only refusal — is
 * exercised for real rather than mocked.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SqliteDriver, sqliteAvailable } from '../src/drivers/sqlite.ts'
import type { DataSourceEntry } from '../src/protocol.ts'

let dir: string
let entry: DataSourceEntry
let driver: SqliteDriver
let available = false

beforeAll(async () => {
  available = await sqliteAvailable()
  if (!available) return
  dir = mkdtempSync(join(tmpdir(), 'dbm-sqlite-'))
  entry = {
    id: 'test',
    kind: 'sqlite',
    name: 'test',
    group: '',
    tags: [],
    description: '',
    file: join(dir, 'app.db'),
    readonly: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  driver = new SqliteDriver(entry)
  // Seed a table with a primary key, a nullable column and an index.
  await driver.exec(
    'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, age INTEGER)',
    [],
  )
  await driver.exec('CREATE INDEX idx_users_name ON users(name)', [])
  await driver.exec(
    'INSERT INTO users (name, email, age) VALUES (?, ?, ?)',
    ['alice', 'alice@example.com', 30],
  )
  await driver.exec('INSERT INTO users (name, email, age) VALUES (?, ?, ?)', ['bob', null, 25])
  await driver.exec("INSERT INTO users (name, email, age) VALUES (?, ?, ?)", ['carol', 'carol@example.com', 41])
})

afterAll(async () => {
  if (driver !== undefined) await driver.close()
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
})

describe('SqliteDriver', () => {
  it('reports a version when the connection works', async () => {
    if (!available) return
    const result = await driver.test()
    expect(result.ok).toBe(true)
    expect(result.serverVersion).toMatch(/SQLite/)
  })

  it('lists schemas and tables, excluding sqlite internals', async () => {
    if (!available) return
    const schemas = await driver.schemas()
    expect(schemas.map(item => item.name)).toContain('main')

    const tables = await driver.tables('main')
    expect(tables.map(table => table.name)).toContain('users')
    expect(tables.every(table => !table.name.startsWith('sqlite_'))).toBe(true)
  })

  it('describes columns with types, nullability and the primary key', async () => {
    if (!available) return
    const columns = await driver.columns('main', 'users')
    const byName = Object.fromEntries(columns.map(column => [column.name, column]))
    expect(columns.map(column => column.name)).toEqual(['id', 'name', 'email', 'age'])
    expect(byName['id']?.key).toBe('PRI')
    expect(byName['name']?.nullable).toBe(false)
    expect(byName['email']?.nullable).toBe(true)
  })

  it('reports indexes with their columns', async () => {
    if (!available) return
    const indexes = await driver.indexes('main', 'users')
    const named = indexes.find(index => index.name === 'idx_users_name')
    expect(named?.columns).toEqual(['name'])
    expect(named?.unique).toBe(false)
  })

  it('pages rows and reports the true total', async () => {
    if (!available) return
    const page = await driver.rows({ schema: 'main', table: 'users', page: 1, pageSize: 2, mode: 'browse' })
    expect(page.total).toBe(3)
    expect(page.rows).toHaveLength(2)
    expect(page.primaryKey).toEqual(['id'])

    const second = await driver.rows({ schema: 'main', table: 'users', page: 2, pageSize: 2, mode: 'browse' })
    expect(second.rows).toHaveLength(1)
  })

  it('sorts on a named column', async () => {
    if (!available) return
    const page = await driver.rows({
      schema: 'main', table: 'users', page: 1, pageSize: 10, mode: 'browse', orderBy: 'age', orderDir: 'desc',
    })
    expect(page.rows.map(row => row['age'])).toEqual([41, 30, 25])
  })

  it('searches across the text columns', async () => {
    if (!available) return
    const page = await driver.rows({ schema: 'main', table: 'users', page: 1, pageSize: 10, mode: 'search', term: 'alice' })
    expect(page.total).toBe(1)
    expect(page.rows[0]?.['name']).toBe('alice')
  })

  it('applies a raw WHERE condition (the GUI search box path)', async () => {
    if (!available) return
    const page = await driver.rows({
      schema: 'main', table: 'users', page: 1, pageSize: 10, mode: 'browse', condition: 'age > 28',
    })
    expect(page.total).toBe(2)
  })

  it('reports a missing table instead of an empty column list', async () => {
    if (!available) return
    await expect(driver.columns('main', 'nope')).rejects.toThrow(/no such table/)
  })

  it('runs a read-only query and returns a projected grid', async () => {
    if (!available) return
    const result = await driver.query('SELECT name, age FROM users ORDER BY id', [], 100, 'main')
    expect(result.write).toBe(false)
    expect(result.columns).toEqual(['name', 'age'])
    expect(result.rows).toEqual([['alice', 30], ['bob', 25], ['carol', 41]])
  })

  it('refuses a write on the read-only query surface', async () => {
    if (!available) return
    await expect(driver.query('DELETE FROM users', [], 100)).rejects.toThrow(/read-only/)
    await expect(driver.exec('SELECT 1; DELETE FROM users', [])).rejects.toThrow(/one statement/)
  })

  it('truncates a result past the limit', async () => {
    if (!available) return
    const result = await driver.query('SELECT * FROM users', [], 2, 'main')
    expect(result.rows).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('inserts, updates and deletes through the row helpers', async () => {
    if (!available) return
    const inserted = await driver.insertRow('main', 'users', [
      { column: 'name', value: 'dave' },
      { column: 'email', value: 'dave@example.com' },
      { column: 'age', value: 52 },
    ])
    expect(inserted.affected).toBe(1)

    const found = await driver.rows({ schema: 'main', table: 'users', page: 1, pageSize: 10, mode: 'search', term: 'dave' })
    const id = found.rows[0]?.['id']
    expect(id).toBeTypeOf('number')

    const updated = await driver.updateRow('main', 'users', [{ column: 'age', value: 53 }], [{ column: 'id', value: id as number }])
    expect(updated.affected).toBe(1)

    const after = await driver.rows({ schema: 'main', table: 'users', page: 1, pageSize: 10, mode: 'search', term: 'dave' })
    expect(after.rows[0]?.['age']).toBe(53)

    const deleted = await driver.deleteRow('main', 'users', [{ column: 'id', value: id as number }])
    expect(deleted.affected).toBe(1)
  })

  it('matches a NULL key through IS, not =', async () => {
    if (!available) return
    // bob's email is NULL; binding NULL with `IS` is what makes this work.
    const result = await driver.updateRow('main', 'users', [{ column: 'age', value: 26 }], [{ column: 'email', value: null }])
    expect(result.affected).toBe(1)
    const bob = await driver.rows({ schema: 'main', table: 'users', page: 1, pageSize: 10, mode: 'search', term: 'bob' })
    expect(bob.rows[0]?.['age']).toBe(26)
    await driver.updateRow('main', 'users', [{ column: 'age', value: 25 }], [{ column: 'email', value: null }])
  })

  it('rejects an identifier that could escape a quoted context', async () => {
    if (!available) return
    await expect(
      driver.exec('SELECT * FROM users WHERE "name`; DROP TABLE users; --" = 1', []),
    ).rejects.toThrow()
    // The table must still exist after the attempt.
    const tables = await driver.tables('main')
    expect(tables.map(table => table.name)).toContain('users')
  })
})
