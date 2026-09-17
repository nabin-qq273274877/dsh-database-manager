/**
 * Export / import over a real SQLite file.
 *
 * The point of these tests is the two things that cannot be checked in a unit
 * test of the text handling: that a dump produced from one table can be loaded
 * back into another and reproduce the data exactly, and that a failed import
 * leaves the target untouched.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SqliteDriver } from '../src/drivers/sqlite.ts'
import { isTransactionControl } from '../src/sql-util.ts'
import { EXPORT_ROW_CAP, exportSql, importSql, splitSqlScript } from '../src/sql-transfer.ts'
import type { DataSourceEntry } from '../src/protocol.ts'

let dir: string
let open: SqliteDriver[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dbm-transfer-'))
  open = []
})

afterEach(async () => {
  await Promise.all(open.map(driver => driver.close().catch(() => {})))
  rmSync(dir, { recursive: true, force: true })
})

/** A SQLite entry for a file inside the test's own temp directory. */
function entryFor(name: string): DataSourceEntry {
  return {
    id: 'test',
    kind: 'sqlite',
    name: 'test',
    group: '',
    tags: [],
    description: '',
    file: join(dir, name),
    readonly: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

/** Open a driver and remember it for the afterEach close. */
function driverFor(name: string): { driver: SqliteDriver; entry: DataSourceEntry } {
  const entry = entryFor(name)
  const driver = new SqliteDriver(entry)
  open.push(driver)
  return { driver, entry }
}

describe('splitSqlScript', () => {
  it('splits on real statement boundaries only', () => {
    expect(splitSqlScript('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2'])
    // A semicolon inside a literal is not a boundary.
    expect(splitSqlScript("INSERT INTO t VALUES ('a;b');")).toEqual(["INSERT INTO t VALUES ('a;b')"])
    expect(splitSqlScript('INSERT INTO t VALUES ("a;b");')).toEqual(['INSERT INTO t VALUES ("a;b")'])
    // Nor is one inside a comment.
    expect(splitSqlScript('-- a; b\nSELECT 1;')).toEqual(['SELECT 1'])
    expect(splitSqlScript('# a; b\nSELECT 1;')).toEqual(['SELECT 1'])
    expect(splitSqlScript('/* a; b */ SELECT 1;')).toEqual(['SELECT 1'])
    // A doubled quote is an escaped quote, not a terminator.
    expect(splitSqlScript("SELECT 'it''s; ok';")).toEqual(["SELECT 'it''s; ok'"])
    // A trailing statement without a terminator still counts.
    expect(splitSqlScript('SELECT 1;\nSELECT 2')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('refuses a file that uses DELIMITER rather than truncating it', () => {
    expect(() => splitSqlScript('DELIMITER //\nCREATE PROCEDURE p() BEGIN END//')).toThrow(/DELIMITER/)
  })

  it('recognises transaction control in every spelling the engines accept', () => {
    for (const statement of [
      'BEGIN', 'begin;', 'BEGIN TRANSACTION;', 'BEGIN DEFERRED;', 'BEGIN IMMEDIATE TRANSACTION;',
      'START TRANSACTION;', 'COMMIT;', 'COMMIT WORK;', 'END;', 'END TRANSACTION;', 'ROLLBACK;',
    ]) {
      expect(isTransactionControl(statement), statement).toBe(true)
    }
    // A savepoint is a real thing a script may want, and an ordinary statement
    // must not be mistaken for control.
    for (const statement of ['SAVEPOINT sp;', 'INSERT INTO t VALUES (1);', 'SELECT 1;', 'BEGINNING;']) {
      expect(isTransactionControl(statement), statement).toBe(false)
    }
  })
})

describe('export', () => {
  it('dumps structure and data, and re-imports into a fresh database', async () => {
    const { driver, entry } = driverFor('source.db')
    await driver.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT, n NUMERIC)', [])
    await driver.exec("INSERT INTO t VALUES (1, 'a', 1.5), (2, 'it''s', NULL), (3, 'line\nbreak', -2)", [])
    await driver.exec('CREATE INDEX ix ON t(v)', [])

    const dump = await exportSql(driver, entry, {
      includeData: true,
      includeStructure: true,
      drop: true,
      format: 'sql',
    })
    expect(dump.filename).toMatch(/\.sql$/)
    // The engine's OWN text, verbatim: re-deriving it here would drop whatever
    // this module does not model.
    expect(dump.text).toContain('CREATE TABLE t(')
    expect(dump.text).toContain('CREATE INDEX ix ON t(v)')
    expect(dump.text).toContain("'it''s'")
    expect(dump.truncated).toEqual([])

    // Load it into a different file and compare the rows.
    const target = driverFor('target.db')
    const result = await importSql(target.driver, { schema: 'main', content: dump.text, format: 'sql' })
    expect(result.statements).toBeGreaterThan(0)

    const original = await driver.allRows('main', 't', 100)
    const restored = await target.driver.allRows('main', 't', 100)
    expect(restored.columns).toEqual(original.columns)
    expect(restored.rows).toEqual(original.rows)
    // The index came back too, from the dump's own CREATE INDEX.
    expect((await target.driver.indexes('main', 't')).map(index => index.name)).toContain('ix')
  })

  it('exports a CSV with a BOM, and refuses a multi-table CSV', async () => {
    const { driver, entry } = driverFor('csv.db')
    await driver.exec('CREATE TABLE t(a TEXT, b TEXT)', [])
    await driver.exec("INSERT INTO t VALUES ('x,y', 'q\"r')", [])

    const csv = await exportSql(driver, entry, {
      tables: ['t'],
      includeData: true,
      includeStructure: false,
      drop: false,
      format: 'csv',
    })
    expect(csv.filename).toMatch(/\.csv$/)
    expect(csv.text.charCodeAt(0)).toBe(0xfeff)
    expect(csv.text).toContain('"x,y"')
    expect(csv.text).toContain('"q""r"')

    await expect(exportSql(driver, entry, {
      tables: ['t', 'u'],
      includeData: true,
      includeStructure: false,
      drop: false,
      format: 'csv',
    })).rejects.toThrow(/one table/)
  })

  it('exports a whole schema when no table is named, and can omit the data', async () => {
    const { driver, entry } = driverFor('schema.db')
    await driver.exec('CREATE TABLE a(x INT)', [])
    await driver.exec('CREATE TABLE b(y INT)', [])
    await driver.exec('INSERT INTO a VALUES (1)', [])

    const structureOnly = await exportSql(driver, entry, {
      includeData: false,
      includeStructure: true,
      drop: false,
      format: 'sql',
    })
    expect(structureOnly.text).toContain('CREATE TABLE a(')
    expect(structureOnly.text).toContain('CREATE TABLE b(')
    expect(structureOnly.text).not.toContain('INSERT INTO')
    expect(structureOnly.text).not.toContain('DROP TABLE')
  })

  it('marks a table whose rows hit the export cap', async () => {
    const { driver, entry } = driverFor('cap.db')
    await driver.exec('CREATE TABLE t(x INT)', [])
    // Emit one row past the cap by generating them in SQLite itself, so the test
    // does not pay for 200 001 inserts from here.
    await driver.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${EXPORT_ROW_CAP + 1}) INSERT INTO t SELECT n FROM seq`, [])
    const dump = await exportSql(driver, entry, {
      includeData: true,
      includeStructure: true,
      drop: false,
      format: 'sql',
    })
    expect(dump.truncated).toEqual(['t'])
    expect(dump.text).toContain('截断')
  }, 60_000)

  it('reports a schema with nothing in it rather than producing an empty dump', async () => {
    const { driver, entry } = driverFor('empty.db')
    await expect(exportSql(driver, entry, {
      includeData: true,
      includeStructure: true,
      drop: false,
      format: 'sql',
    })).rejects.toThrow(/no tables/)
  })
})

describe('import', () => {
  it('inserts CSV rows, mapping by header and name', async () => {
    const { driver } = driverFor('csv-import.db')
    await driver.exec('CREATE TABLE t(id INTEGER, name TEXT)', [])

    const result = await importSql(driver, {
      schema: 'main',
      table: 't',
      format: 'csv',
      hasHeader: true,
      content: 'name,id\r\nalice,1\r\nbob,2\r\n',
    })
    expect(result.rows).toBe(2)
    const page = await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })
    // The file's column ORDER is irrelevant: the mapping is by name.
    expect(page.rows.map(row => `${row['id']}:${row['name']}`)).toEqual(['1:alice', '2:bob'])
  })

  it('maps a headerless file onto the table columns in order', async () => {
    const { driver } = driverFor('headerless.db')
    await driver.exec('CREATE TABLE t(id INTEGER, name TEXT)', [])
    await importSql(driver, { schema: 'main', table: 't', format: 'csv', hasHeader: false, content: '1,alice\r\n' })
    const page = await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.rows[0]).toEqual({ id: 1, name: 'alice' })
  })

  it('treats an empty field as NULL by default, and as text when told to', async () => {
    const { driver } = driverFor('empty-null.db')
    await driver.exec('CREATE TABLE t(a TEXT, b TEXT)', [])
    await importSql(driver, { schema: 'main', table: 't', format: 'csv', hasHeader: true, content: 'a,b\r\n,text\r\n' })
    let page = await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.rows[0]).toEqual({ a: null, b: 'text' })

    await driver.exec('DELETE FROM t', [])
    await importSql(driver, { schema: 'main', table: 't', format: 'csv', hasHeader: true, emptyAsNull: false, content: 'a,b\r\n,text\r\n' })
    page = await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.rows[0]).toEqual({ a: '', b: 'text' })
  })

  it('reports malformed records instead of inserting a guessed mapping', async () => {
    const { driver } = driverFor('malformed.db')
    await driver.exec('CREATE TABLE t(a TEXT, b TEXT)', [])
    const result = await importSql(driver, {
      schema: 'main',
      table: 't',
      format: 'csv',
      hasHeader: true,
      content: 'a,b\r\n1,2\r\n3\r\n',
    })
    expect(result.rows).toBe(1)
    expect(result.skipped).toEqual([{ line: 3, fields: 1 }])
  })

  it('refuses a file naming a column the table does not have', async () => {
    const { driver } = driverFor('unknown-column.db')
    await driver.exec('CREATE TABLE t(a TEXT)', [])
    await expect(importSql(driver, {
      schema: 'main',
      table: 't',
      format: 'csv',
      hasHeader: true,
      content: 'a,nope\r\n1,2\r\n',
    })).rejects.toThrow(/does not exist/)
    // Nothing was written.
    const page = await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.rows).toEqual([])
  })

  it('rolls a failed SQL script back entirely', async () => {
    const { driver } = driverFor('rollback.db')
    await driver.exec('CREATE TABLE t(x INT)', [])
    await driver.exec('INSERT INTO t VALUES (1)', [])

    // Statement 2 is invalid. Statement 1 must not survive.
    await expect(importSql(driver, {
      schema: 'main',
      content: 'INSERT INTO t VALUES (2);\nINSERT INTO t VALUES (oops);',
      format: 'sql',
    })).rejects.toThrow()

    const page = await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.rows.map(row => row['x'])).toEqual([1])
  })

  it('tolerates the BEGIN/COMMIT a dump of its own contains', async () => {
    const { driver, entry } = driverFor('round-trip.db')
    await driver.exec('CREATE TABLE t(x INT)', [])
    await driver.exec('INSERT INTO t VALUES (1), (2)', [])
    const dump = await exportSql(driver, entry, { includeData: true, includeStructure: true, drop: true, format: 'sql' })

    const target = driverFor('round-trip-target.db')
    const result = await importSql(target.driver, { schema: 'main', content: dump.text, format: 'sql' })
    expect(result.statements).toBeGreaterThan(0)
    const page = await target.driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.rows.map(row => row['x'])).toEqual([1, 2])
    // The wrapper's transaction is what ran, and it is closed: a later write
    // must be able to open its own.
    await target.driver.exec('INSERT INTO t VALUES (3)', [])
    expect((await target.driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })).rows).toHaveLength(3)
  })

  it('refuses an empty file and an oversized one', async () => {
    const { driver } = driverFor('refuse.db')
    await expect(importSql(driver, { schema: 'main', content: '   \n-- just a comment\n', format: 'sql' })).rejects.toThrow(/no SQL statements/)
    const huge = 'a'.repeat(33 * 1024 * 1024)
    await expect(importSql(driver, { schema: 'main', content: huge, format: 'sql' })).rejects.toThrow(/import limit/)
  })
})
