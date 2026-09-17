/**
 * Schema-editing tests: type/default validation, `CREATE TABLE` parsing, and
 * the SQLite table rebuild.
 *
 * The rebuild is the risky part of the 结构 tab — it DROPS and re-creates a
 * user's table — so it is exercised against a real SQLite file rather than a
 * mock: a mock would agree with whatever the implementation believes about
 * `PRAGMA legacy_alter_table`, foreign keys and `sqlite_sequence`, which is
 * exactly what these tests are here to check.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  isSqliteRowidAlias,
  normalizeDefault,
  normalizeType,
  parseColumnItem,
  parseCreateTable,
  renderColumn,
  renderCreateTable,
  setPrimaryKey,
  splitTopLevel,
  splitTypeAndFlags,
} from '../src/sql-schema.ts'
import { SqliteDriver } from '../src/drivers/sqlite.ts'
import type { DataSourceEntry } from '../src/protocol.ts'

let dir: string
/** Drivers opened by the current test, closed in afterEach so a temp file is never locked. */
let open: SqliteDriver[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dbm-schema-'))
  open = []
})

afterEach(async () => {
  // Closing is not tidiness: sqlite holds the file open, so a locked file makes
  // rmSync fail and the REAL assertion failure gets buried under an EBUSY.
  await Promise.all(open.map(driver => driver.close().catch(() => {})))
  rmSync(dir, { recursive: true, force: true })
})

/** A SQLite driver on a file inside the test's own temp directory. */
function driverFor(name: string): SqliteDriver {
  const entry: DataSourceEntry = {
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
  const driver = new SqliteDriver(entry)
  open.push(driver)
  return driver
}

describe('splitTopLevel', () => {
  it('ignores separators inside quotes, brackets and comments', () => {
    expect(splitTopLevel("a int, b text CHECK (b <> ','), c text")).toEqual([
      'a int',
      "b text CHECK (b <> ',')",
      'c text',
    ])
    expect(splitTopLevel('a int -- x, y\n, b')).toEqual(['a int -- x, y', 'b'])
    expect(splitTopLevel('a /* , */ int, b')).toEqual(['a /* , */ int', 'b'])
    expect(splitTopLevel("enum('a,b')", ',')).toEqual(["enum('a,b')"])
    // A doubled quote is an escaped quote, not a terminator.
    expect(splitTopLevel("'it''s, fine', b")).toEqual(["'it''s, fine'", 'b'])
  })
})

describe('normalizeType', () => {
  it('accepts the offered types, keeping the caller casing and canonicalizing spacing', () => {
    // Casing is preserved, not normalized: a rebuild must not rewrite `TEXT` as
    // `text` merely because it touched an unrelated column, since that would
    // make an otherwise no-op edit show up in a schema diff.
    expect(normalizeType('int unsigned', 'mysql')).toBe('int unsigned')
    expect(normalizeType('INT   UNSIGNED', 'mysql')).toBe('INT UNSIGNED')
    expect(normalizeType('varchar(20)', 'mysql')).toBe('varchar(20)')
    expect(normalizeType('decimal( 10 , 2 )', 'mysql')).toBe('decimal(10,2)')
    expect(normalizeType("enum('a','b')", 'mysql')).toBe("enum('a','b')")
    expect(normalizeType('bigint(20) unsigned', 'mysql')).toBe('bigint(20) unsigned')
    expect(normalizeType('UNSIGNED BIG INT', 'sqlite')).toBe('UNSIGNED BIG INT')
    expect(normalizeType('', 'sqlite')).toBe('')
  })

  it('refuses anything that is not a type', () => {
    // The whole reason the type field is validated: it lands in statement text.
    expect(() => normalizeType('text; DROP TABLE users', 'mysql')).toThrow(/unsupported column type/)
    expect(() => normalizeType('int) ; DROP TABLE users --', 'mysql')).toThrow()
    expect(() => normalizeType('int REFERENCES x', 'mysql')).toThrow(/unsupported column type/)
    expect(() => normalizeType('varchar(20) NOT NULL', 'mysql')).toThrow(/unsupported column type/)
    expect(() => normalizeType('enum', 'mysql')).toThrow(/member list/)
    expect(() => normalizeType('nonexistenttype', 'sqlite')).toThrow(/unsupported column type/)
    expect(() => normalizeType('int unsigned unsigned', 'mysql')).toThrow()
  })
})

describe('normalizeDefault', () => {
  it('accepts literals and allowlisted keywords', () => {
    expect(normalizeDefault("'hi'", 'mysql')).toBe("'hi'")
    expect(normalizeDefault('5', 'mysql')).toBe('5')
    expect(normalizeDefault('-1.5', 'mysql')).toBe('-1.5')
    expect(normalizeDefault('CURRENT_TIMESTAMP', 'mysql')).toBe('current_timestamp')
    expect(normalizeDefault("'hi'", 'sqlite')).toBe("'hi'")
    expect(normalizeDefault('NULL', 'sqlite')).toBe('null')
    expect(normalizeDefault(undefined, 'mysql')).toBeUndefined()
    expect(normalizeDefault('  ', 'mysql')).toBeUndefined()
  })

  it('re-escapes a quote in a string literal rather than copying it through', () => {
    expect(normalizeDefault("'it''s'", 'mysql')).toBe("'it''s'")
    expect(normalizeDefault("'it''s'", 'sqlite')).toBe("'it''s'")
  })

  it('refuses an expression it cannot prove is a literal', () => {
    // A default value is user text headed for DDL; a subquery or a statement
    // separator must never survive the trip.
    expect(() => normalizeDefault("'; DROP TABLE users --", 'mysql')).toThrow()
    expect(() => normalizeDefault('(SELECT 1)', 'mysql')).toThrow(/parenthesised/)
    expect(() => normalizeDefault('some_column', 'mysql')).toThrow(/unsupported default/)
    expect(() => normalizeDefault("5'; DROP TABLE t --", 'mysql')).toThrow()
  })
})

describe('parseCreateTable', () => {
  it('reads a SQLite table with a single-column primary key', () => {
    const shape = parseCreateTable('CREATE TABLE "users"(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)', 'sqlite')
    expect(shape.name).toBe('users')
    expect(shape.columns.map(column => column.name)).toEqual(['id', 'name'])
    const id = shape.columns[0]!
    expect(id.primaryKeyPosition).toBe(1)
    expect(id.autoIncrement).toBe(true)
    expect(id.nullable).toBe(false)
    expect(shape.columns[1]!.nullable).toBe(false)
  })

  it('preserves clauses `PRAGMA table_info` does not report', () => {
    const sql =
      'CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT REFERENCES u(x) ON DELETE CASCADE, ' +
      'c TEXT COLLATE NOCASE, d INTEGER CHECK (d > 0), UNIQUE (c))'
    const shape = parseCreateTable(sql, 'sqlite')
    const rendered = renderCreateTable(shape, 'sqlite')
    expect(rendered).toContain('REFERENCES u(x) ON DELETE CASCADE')
    expect(rendered).toContain('COLLATE NOCASE')
    expect(rendered).toContain('CHECK (d > 0)')
    expect(rendered).toContain('UNIQUE (c)')
    expect(shape.constraints.some(constraint => constraint.sql === 'UNIQUE (c)')).toBe(true)
  })

  it('keeps a MySQL table-level constraint, an index and a collation', () => {
    const sql =
      "CREATE TABLE `t` (\n  `s` enum('a','b,c') NOT NULL DEFAULT 'a',\n  `n` int unsigned DEFAULT 5,\n" +
      '  `u` varchar(20) COLLATE utf8mb4_bin,\n  PRIMARY KEY (`s`),\n  CONSTRAINT `c1` CHECK (`n` > 0)\n) ENGINE=InnoDB'
    const shape = parseCreateTable(sql, 'mysql')
    expect(shape.columns.map(column => column.name)).toEqual(['s', 'n', 'u'])
    expect(shape.columns[0]!.type).toBe("enum('a','b,c')")
    expect(shape.columns[0]!.defaultValue).toBe("'a'")
    expect(shape.columns[1]!.type).toBe('int unsigned')
    expect(shape.constraints.map(constraint => constraint.kind)).toContain('primary')
    const rendered = renderCreateTable(shape, 'mysql')
    expect(rendered).toContain('COLLATE utf8mb4_bin')
    expect(rendered).toContain('CHECK (`n` > 0)')
    expect(rendered).toContain('ENGINE=InnoDB')
  })

  it('keeps WITHOUT ROWID and STRICT', () => {
    expect(parseCreateTable('CREATE TABLE w(a TEXT PRIMARY KEY) WITHOUT ROWID', 'sqlite').tail).toBe('WITHOUT ROWID')
    expect(parseCreateTable('CREATE TABLE s(a INT) STRICT', 'sqlite').tail).toBe('STRICT')
  })

  it('refuses a virtual table and a broken statement', () => {
    expect(() => parseCreateTable('CREATE VIRTUAL TABLE fts USING fts5(a)', 'sqlite')).toThrow(/virtual table/)
    expect(() => parseCreateTable('CREATE TABLE t(a int', 'sqlite')).toThrow(/unbalanced/)
    expect(() => parseCreateTable('SELECT 1', 'sqlite')).toThrow()
  })
})

describe('splitTypeAndFlags', () => {
  it('keeps a multi-word type whole', () => {
    expect(splitTypeAndFlags('int unsigned NOT NULL DEFAULT 5', 'mysql')).toEqual({
      type: 'int unsigned',
      flags: ['NOT NULL', 'DEFAULT 5'],
    })
    expect(splitTypeAndFlags('UNSIGNED BIG INT NOT NULL', 'sqlite').type).toBe('UNSIGNED BIG INT')
    expect(splitTypeAndFlags("enum('a','b') NOT NULL DEFAULT 'a'", 'mysql').type).toBe("enum('a','b')")
    expect(splitTypeAndFlags('INTEGER PRIMARY KEY AUTOINCREMENT', 'sqlite')).toEqual({
      type: 'INTEGER',
      // Two phrases, not one: `AUTOINCREMENT` starts a phrase of its own, and
      // merging it into `PRIMARY KEY` would make the two indistinguishable when
      // the column is re-rendered.
      flags: ['PRIMARY KEY', 'AUTOINCREMENT'],
    })
  })
})

describe('parseColumnItem', () => {
  it('reads a column with several flags', () => {
    const column = parseColumnItem('`n` int unsigned NOT NULL DEFAULT 5 COMMENT \'count\'', 'mysql')
    expect(column).toBeDefined()
    expect(column!.name).toBe('n')
    expect(column!.type).toBe('int unsigned')
    expect(column!.nullable).toBe(false)
    expect(column!.defaultValue).toBe('5')
    expect(column!.comment).toBe('count')
  })

  it('returns undefined for a table-level constraint', () => {
    expect(parseColumnItem('PRIMARY KEY (a, b)', 'sqlite')).toBeUndefined()
    expect(parseColumnItem('CONSTRAINT fk FOREIGN KEY (a) REFERENCES b(c)', 'mysql')).toBeUndefined()
    expect(parseColumnItem('KEY `ix` (`a`)', 'mysql')).toBeUndefined()
    // A COLUMN legitimately named `key` must still parse.
    expect(parseColumnItem('key int', 'mysql')?.name).toBe('key')
  })
})

describe('setPrimaryKey', () => {
  it('replaces whatever key was there', () => {
    const shape = parseCreateTable('CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT)', 'sqlite')
    setPrimaryKey(shape, ['b'])
    expect(shape.columns[0]!.primaryKeyPosition).toBeUndefined()
    expect(shape.columns[1]!.primaryKeyPosition).toBe(1)
    expect(renderCreateTable(shape, 'sqlite')).toContain('"b" TEXT NOT NULL PRIMARY KEY')
  })

  it('drops the key entirely', () => {
    const shape = parseCreateTable('CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT)', 'sqlite')
    setPrimaryKey(shape, [])
    expect(renderCreateTable(shape, 'sqlite')).not.toContain('PRIMARY KEY')
  })

  it('refuses a column that does not exist', () => {
    const shape = parseCreateTable('CREATE TABLE t(a int)', 'sqlite')
    expect(() => setPrimaryKey(shape, ['nope'])).toThrow(/no such column/)
  })
})

describe('isSqliteRowidAlias', () => {
  it('is true only for `INTEGER PRIMARY KEY`', () => {
    const shape = parseCreateTable('CREATE TABLE t(a INTEGER PRIMARY KEY, b INT PRIMARY KEY)', 'sqlite')
    expect(isSqliteRowidAlias(shape.columns[0]!)).toBe(true)
    // `INT PRIMARY KEY` is NOT a rowid alias: inserting NULL would violate
    // NOT NULL rather than auto-assign an id.
    expect(isSqliteRowidAlias(parseCreateTable('CREATE TABLE u(a INT PRIMARY KEY)', 'sqlite').columns[0]!)).toBe(false)
  })
})

describe('SqliteDriver schema editing', () => {
  it('changes a column type by rebuilding the table', async () => {
    const driver = driverFor('rebuild.db')
    await driver.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, age INT NOT NULL)', [])
    await driver.exec("INSERT INTO t VALUES (1, 30), (2, 40)", [])

    const before = await driver.columns('main', 't')
    const age = before.find(column => column.name === 'age')!
    await driver.alterColumn('main', 't', { ...age, type: 'TEXT' })

    const after = await driver.columns('main', 't')
    expect(after.find(column => column.name === 'age')!.type).toBe('TEXT')
    // The INTEGER PRIMARY KEY must survive as a rowid alias, and the rows with it.
    const page = await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.rows).toHaveLength(2)
    expect(page.primaryKey).toEqual(['id'])
  })

  it('drops a column, keeping the other data', async () => {
    const driver = driverFor('dropcol.db')
    await driver.exec('CREATE TABLE t(a INT, b TEXT, c INT)', [])
    await driver.exec("INSERT INTO t VALUES (1, 'x', 9)", [])

    await driver.dropColumn('main', 't', 'c')
    const columns = await driver.columns('main', 't')
    expect(columns.map(column => column.name)).toEqual(['a', 'b'])
    const page = await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.rows[0]).toEqual({ a: 1, b: 'x' })
  })

  it('keeps a foreign key pointing at the rebuilt table', async () => {
    // The regression this guards: SQLite's default RENAME rewrites references
    // to follow the rename, so a rebuild that renamed the OLD table aside would
    // leave every foreign key and view pointing at the temp name.
    const driver = driverFor('fk.db')
    await driver.exec('PRAGMA foreign_keys = ON', [])
    await driver.exec('CREATE TABLE p(id INTEGER PRIMARY KEY, v TEXT)', [])
    await driver.exec('CREATE TABLE c(id INTEGER PRIMARY KEY, pid INTEGER REFERENCES p(id))', [])
    await driver.exec("INSERT INTO p VALUES (1, 'a')", [])
    await driver.exec('INSERT INTO c VALUES (1, 1)', [])
    await driver.exec('CREATE VIEW vp AS SELECT id, v FROM p', [])
    await driver.exec('CREATE INDEX ixp ON p(v)', [])

    const v = (await driver.columns('main', 'p')).find(column => column.name === 'v')!
    await driver.alterColumn('main', 'p', { ...v, type: 'TEXT', nullable: false })

    const check = await driver.query('PRAGMA foreign_key_check', [], 100, 'main')
    expect(check.rows).toEqual([])
    const master = await driver.query("SELECT sql FROM sqlite_master WHERE name = 'c'", [], 10, 'main')
    expect(String(master.rows[0]![0])).toContain('REFERENCES p(id)')
    const view = await driver.query("SELECT sql FROM sqlite_master WHERE name = 'vp'", [], 10, 'main')
    expect(String(view.rows[0]![0])).toContain('FROM p')
    // The index has to be recreated; dropping the table took it with it.
    const indexes = await driver.indexes('main', 'p')
    expect(indexes.map(index => index.name)).toContain('ixp')
  })

  it('preserves AUTOINCREMENT and its sequence across a rebuild', async () => {
    const driver = driverFor('autoinc.db')
    await driver.exec('CREATE TABLE ai(id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)', [])
    await driver.exec("INSERT INTO ai(v) VALUES ('a'), ('b'), ('c')", [])
    await driver.exec('DELETE FROM ai WHERE id = 3', [])

    const v = (await driver.columns('main', 'ai')).find(column => column.name === 'v')!
    await driver.alterColumn('main', 'ai', { ...v, type: 'TEXT', nullable: false })
    await driver.exec("INSERT INTO ai(v) VALUES ('d')", [])

    const page = await driver.rows({ schema: 'main', table: 'ai', page: 1, pageSize: 10, mode: 'browse' })
    // 4, not 2: the sequence must not be reset by the rebuild.
    expect(page.rows.map(row => row['id'])).toEqual([1, 2, 4])
  })

  it('leaves the table untouched when the rebuild fails', async () => {
    const driver = driverFor('rollback.db')
    await driver.exec('CREATE TABLE t(a INT, b TEXT)', [])
    await driver.exec("INSERT INTO t VALUES (1, 'x')", [])

    // A type this plugin refuses is caught before anything is executed.
    const a = (await driver.columns('main', 't')).find(column => column.name === 'a')!
    await expect(driver.alterColumn('main', 't', { ...a, type: 'text; DROP TABLE t' })).rejects.toThrow()

    const page = await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.rows).toEqual([{ a: 1, b: 'x' }])
  })

  it('adds and drops a primary key', async () => {
    const driver = driverFor('pk.db')
    await driver.exec('CREATE TABLE t(a INT NOT NULL, b TEXT, c TEXT)', [])
    await driver.exec("INSERT INTO t VALUES (1, 'x', 'p')", [])

    await driver.setPrimaryKey('main', 't', ['a'])
    expect((await driver.columns('main', 't')).find(column => column.name === 'a')!.key).toBe('PRI')
    expect((await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })).primaryKey).toEqual(['a'])

    // A composite key is a table constraint, and its ORDER has to survive: it
    // decides which leading subsets an index can serve.
    await driver.setPrimaryKey('main', 't', ['a', 'c'])
    const columns = await driver.columns('main', 't')
    expect(columns.find(column => column.name === 'a')!.primaryKeyPosition).toBe(1)
    expect(columns.find(column => column.name === 'c')!.primaryKeyPosition).toBe(2)
    expect((await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })).primaryKey).toEqual(['a', 'c'])

    await driver.setPrimaryKey('main', 't', [])
    expect((await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })).primaryKey).toEqual([])
    const after = await driver.query("SELECT sql FROM sqlite_master WHERE name = 't'", [], 10, 'main')
    expect(String(after.rows[0]![0])).not.toContain('PRIMARY KEY')
  })

  /**
   * A table-level `PRIMARY KEY (a)` over an `INTEGER` column is also a rowid
   * alias, so a blank value in the 插入 form must mean "assign the next id" —
   * the same as the inline spelling. Getting this wrong inserts NULL into a
   * NOT NULL column.
   */
  it('treats a table-level INTEGER primary key as a rowid alias', async () => {
    const driver = driverFor('rowid-alias.db')
    await driver.exec('CREATE TABLE t(a INTEGER, b TEXT, PRIMARY KEY(a))', [])
    expect((await driver.columns('main', 't')).find(column => column.name === 'a')!.primaryKeyPosition).toBe(1)
    await driver.insertRow('main', 't', [{ column: 'b', value: 'x' }])
    const page = await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.rows[0]!['a']).toBe(1)
  })

  /**
   * `PRAGMA table_info` OMITS a generated column; `table_xinfo` reports it with
   * `hidden` set. Reading the former would make a generated column vanish from
   * the 结构 tab and then be deleted by the next rebuild.
   */
  it('reports a generated column that table_info hides', async () => {
    const driver = driverFor('hidden-generated.db')
    await driver.exec('CREATE TABLE t(a INT, g INT GENERATED ALWAYS AS (a * 2) STORED, b INT)', [])
    const columns = await driver.columns('main', 't')
    expect(columns.map(column => column.name)).toEqual(['a', 'g', 'b'])
    expect(columns.find(column => column.name === 'g')!.generated).toBe(true)
    expect(columns.find(column => column.name === 'a')!.generated).toBeUndefined()
  })

  /**
   * A rebuild copies the row data, so a generated column must be excluded from
   * the copy — SQLite refuses to insert into one. What this pins is both that
   * the rebuild succeeds and that the generated column is still there
   * afterwards, recomputed by the engine.
   */
  it('rebuilds a table that has a generated column', async () => {
    const driver = driverFor('rebuild-generated.db')
    await driver.exec('CREATE TABLE t(a INT, g INT GENERATED ALWAYS AS (a * 2) STORED, b INT)', [])
    await driver.exec('INSERT INTO t(a, b) VALUES (1, 5), (2, 6)', [])

    const a = (await driver.columns('main', 't')).find(column => column.name === 'a')!
    await driver.alterColumn('main', 't', { ...a, type: 'BIGINT' })

    const page = await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.rows).toEqual([
      { a: 1, g: 2, b: 5 },
      { a: 2, g: 4, b: 6 },
    ])
  })

  it('refuses to drop a column a table constraint still names', async () => {
    const driver = driverFor('constraint-guard.db')
    await driver.exec('CREATE TABLE t(a INT, b INT, UNIQUE (b))', [])
    await expect(driver.dropColumn('main', 't', 'b')).rejects.toThrow(/used by a table constraint/)
  })

  it('creates, drops and reports indexes', async () => {
    const driver = driverFor('index.db')
    await driver.exec('CREATE TABLE t(a INT, b TEXT)', [])

    await driver.createIndex('main', 't', { name: 'idx_a', columns: ['a'], unique: false })
    let indexes = await driver.indexes('main', 't')
    expect(indexes.find(index => index.name === 'idx_a')).toMatchObject({ unique: false, columns: ['a'] })

    await driver.dropIndex('main', 't', 'idx_a')
    indexes = await driver.indexes('main', 't')
    expect(indexes.map(index => index.name)).not.toContain('idx_a')

    await driver.createIndex('main', 't', { name: 'uniq_b', columns: ['b'], unique: true })
    indexes = await driver.indexes('main', 't')
    expect(indexes.find(index => index.name === 'uniq_b')!.unique).toBe(true)
    // A duplicate must be refused by the engine, not silently accepted.
    await driver.exec("INSERT INTO t VALUES (1, 'x')", [])
    await expect(driver.exec("INSERT INTO t VALUES (2, 'x')", [])).rejects.toThrow()
  })

  it('refuses to drop an implicit primary-key index', async () => {
    const driver = driverFor('autoindex.db')
    await driver.exec('CREATE TABLE t(a TEXT PRIMARY KEY)', [])
    const indexes = await driver.indexes('main', 't')
    const implicit = indexes.find(index => index.name.startsWith('sqlite_autoindex_'))
    expect(implicit, 'SQLite reports an implicit index for a non-rowid primary key').toBeDefined()
    expect(implicit!.primary).toBe(true)
    await expect(driver.dropIndex('main', 't', implicit!.name)).rejects.toThrow(/primary key/i)
  })

  it('counts distinct values', async () => {
    const driver = driverFor('distinct.db')
    await driver.exec('CREATE TABLE t(a INT)', [])
    await driver.exec('INSERT INTO t VALUES (1), (1), (2), (NULL)', [])
    expect(await driver.distinctCount('main', 't', 'a')).toBe(2)
  })

  it('deletes several rows in one transaction, or none on a failure', async () => {
    const driver = driverFor('batch-delete.db')
    await driver.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)', [])
    await driver.exec("INSERT INTO t VALUES (1, 'a'), (2, 'b'), (3, 'c')", [])

    const affected = await driver.deleteRows('main', 't', [
      [{ column: 'id', value: 1 }],
      [{ column: 'id', value: 3 }],
    ])
    expect(affected.affected).toBe(2)
    expect((await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })).rows.map(row => row['id'])).toEqual([2])

    // A batch naming a column that does not exist must leave the table as it
    // was, rather than deleting the first row and failing on the second.
    await expect(driver.deleteRows('main', 't', [
      [{ column: 'id', value: 2 }],
      [{ column: 'nope', value: 1 }],
    ])).rejects.toThrow()
    expect((await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse' })).rows.map(row => row['id'])).toEqual([2])
  })

  it('inserts many rows in one transaction', async () => {
    const driver = driverFor('batch-insert.db')
    await driver.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)', [])
    const result = await driver.insertRows('main', 't', [
      [{ column: 'id', value: 1 }, { column: 'v', value: 'a' }],
      [{ column: 'id', value: 2 }, { column: 'v', value: 'b' }],
    ])
    expect(result.affected).toBe(2)

    // Rows naming different columns cannot be one statement; filling the gaps
    // with NULL would be a corruption bug rather than an error.
    await expect(driver.insertRows('main', 't', [
      [{ column: 'id', value: 3 }, { column: 'v', value: 'c' }],
      [{ column: 'id', value: 4 }],
    ])).rejects.toThrow(/same columns/)
  })

  it('sorts by a column list, in the order given', async () => {
    const driver = driverFor('sort.db')
    await driver.exec('CREATE TABLE t(a INT, b TEXT)', [])
    await driver.exec("INSERT INTO t VALUES (2, 'y'), (1, 'x'), (2, 'a')", [])
    const page = await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse', orderByColumns: ['a', 'b'] })
    expect(page.rows.map(row => `${row['a']}${row['b']}`)).toEqual(['1x', '2a', '2y'])
  })

  /** phpMyAdmin's 「按主键排序」: the key's own column order, not the table's. */
  it('orders by a composite primary key', async () => {
    const driver = driverFor('order-pk.db')
    await driver.exec('CREATE TABLE t(part TEXT, seq INT, note TEXT, PRIMARY KEY (part, seq))', [])
    await driver.exec("INSERT INTO t VALUES ('b', 1, 'x'), ('a', 2, 'y'), ('a', 1, 'z')", [])
    const page = await driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'browse', orderByColumns: ['part', 'seq'] })
    expect(page.rows.map(row => `${row['part']}${row['seq']}`)).toEqual(['a1', 'a2', 'b1'])
  })

  it('applies the 搜索 tab conditions with bound operands', async () => {
    const driver = driverFor('search.db')
    await driver.exec('CREATE TABLE t(a INT, b TEXT)', [])
    await driver.exec("INSERT INTO t VALUES (1, 'alpha'), (2, 'beta'), (3, NULL)", [])

    const search = (filters: Array<{ column: string; operator: string; value?: string; value2?: string }>) =>
      driver.rows({ schema: 'main', table: 't', page: 1, pageSize: 10, mode: 'search', filters })

    expect((await search([{ column: 'b', operator: 'contains', value: 'lph' }])).rows.map(row => row['a'])).toEqual([1])
    expect((await search([{ column: 'b', operator: 'isNull' }])).rows.map(row => row['a'])).toEqual([3])
    expect((await search([{ column: 'b', operator: 'isNotNull' }])).rows.map(row => row['a'])).toEqual([1, 2])
    expect((await search([{ column: 'a', operator: 'between', value: '1', value2: '2' }])).rows.map(row => row['a'])).toEqual([1, 2])
    expect((await search([{ column: 'a', operator: 'in', value: '1, 3' }])).rows.map(row => row['a'])).toEqual([1, 3])
    expect((await search([{ column: 'b', operator: 'startsWith', value: 'be' }])).rows.map(row => row['a'])).toEqual([2])

    // An operand that looks like SQL is a value, not a fragment.
    expect((await search([{ column: 'b', operator: 'eq', value: "' OR 1=1 --" }])).rows).toEqual([])

    // A percent sign is a character to find, not a wildcard.
    await driver.exec("INSERT INTO t VALUES (4, '100%')", [])
    expect((await search([{ column: 'b', operator: 'contains', value: '%' }])).rows.map(row => row['a'])).toEqual([4])

    // `OR` between two conditions must not leak into the search's own scope.
    expect((await search([
      { column: 'a', operator: 'eq', value: '1' },
      { column: 'a', operator: 'eq', value: '3' },
    ])).rows).toEqual([])

    await expect(search([{ column: 'nope', operator: 'eq', value: '1' }])).rejects.toThrow(/no such column/)
    await expect(search([{ column: 'a', operator: 'dropTable', value: '1' }])).rejects.toThrow(/unsupported operator/)
  })

  it('combines conditions with OR when asked', async () => {
    const driver = driverFor('search-or.db')
    await driver.exec('CREATE TABLE t(a INT)', [])
    await driver.exec('INSERT INTO t VALUES (1), (2), (3)', [])
    const page = await driver.rows({
      schema: 'main',
      table: 't',
      page: 1,
      pageSize: 10,
      mode: 'search',
      filterJoin: 'or',
      filters: [
        { column: 'a', operator: 'eq', value: '1' },
        { column: 'a', operator: 'eq', value: '3' },
      ],
    })
    expect(page.rows.map(row => row['a'])).toEqual([1, 3])
  })
})

describe('renderColumn', () => {
  it('refuses an unsafe column name', () => {
    expect(() =>
      renderColumn({ name: 'a"; DROP TABLE t --', type: 'int', nullable: true, extras: [] }, 'mysql'),
    ).toThrow(/invalid column name/)
  })

  it('is idempotent for a parsed definition', () => {
    const shape = parseCreateTable("CREATE TABLE t(a int unsigned NOT NULL DEFAULT 5, b varchar(10))", 'mysql')
    const once = renderCreateTable(shape, 'mysql')
    const twice = renderCreateTable(parseCreateTable(once, 'mysql'), 'mysql')
    expect(twice).toBe(once)
  })
})
