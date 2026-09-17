/**
 * MySQL schema-editing and export/import tests against a real server.
 *
 * These cannot be verified offline: the interesting behaviour IS the server's —
 * which ALTER forms it accepts, what `SHOW CREATE TABLE` includes, and whether a
 * dump replayed into another database reproduces the original. Each case here
 * came out of a probe that first failed, which is recorded where the assertion
 * lives.
 *
 * Runs only when a MySQL server is reachable; configure with:
 *   DBM_TEST_MYSQL=host:port:user:password
 * Defaults to the local Docker container (127.0.0.1:3306 root/root).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MysqlDriver, mysqlAvailable } from '../src/drivers/mysql.ts'
import { exportSql, importSql } from '../src/sql-transfer.ts'
import type { DataSourceEntry } from '../src/protocol.ts'

/** Connection details, from env or the local container defaults. */
function target(): { host: string; port: number; user: string; password: string } {
  const raw = process.env['DBM_TEST_MYSQL'] ?? '127.0.0.1:3306:root:root'
  const [host, port, user, password] = raw.split(':')
  return { host: host ?? '127.0.0.1', port: Number(port ?? 3306), user: user ?? 'root', password: password ?? '' }
}

const available = await mysqlAvailable()
const { host, port, user, password } = target()

/** Whether the configured server actually answers. */
async function serverReachable(): Promise<boolean> {
  if (!available) return false
  const net = await import('node:net')
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (ok: boolean): void => { socket.destroy(); resolve(ok) }
    socket.setTimeout(3000, () => done(false))
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
  })
}

const reachable = await serverReachable()
/** Databases the suite owns, dropped afterwards. */
const DB = 'dbm_schema_test'
const COPY = 'dbm_schema_test_copy'

const entry: DataSourceEntry = {
  id: 'mysql-schema-test',
  kind: 'mysql',
  name: 'mysql-schema-test',
  group: '',
  tags: [],
  description: '',
  host,
  port,
  user,
  password,
  readonly: false,
  createdAt: 0,
  updatedAt: 0,
}

const driver = reachable ? new MysqlDriver(entry) : undefined

beforeAll(async () => {
  if (driver === undefined) return
  await driver.exec(`DROP DATABASE IF EXISTS ${COPY}`, [])
  await driver.exec(`DROP DATABASE IF EXISTS ${DB}`, [])
  await driver.exec(`CREATE DATABASE ${DB}`, [])
})

afterAll(async () => {
  if (driver === undefined) return
  await driver.exec(`DROP DATABASE IF EXISTS ${COPY}`, [])
  await driver.exec(`DROP DATABASE IF EXISTS ${DB}`, [])
  await driver.close()
})

describe.skipIf(!reachable)('MySQL schema editing', () => {
  it('reads a composite primary key in its declared order', async () => {
    await driver!.exec('CREATE TABLE composite(a VARCHAR(10) NOT NULL, b INT NOT NULL, c VARCHAR(10), PRIMARY KEY (b, a))', [], DB)
    const columns = await driver!.columns(DB, 'composite')
    // The order decides which leading subsets an index can serve, so it has to
    // come from STATISTICS rather than from the columns' declaration order.
    expect(columns.find(column => column.name === 'b')!.primaryKeyPosition).toBe(1)
    expect(columns.find(column => column.name === 'a')!.primaryKeyPosition).toBe(2)
    expect(columns.every(column => column.key === 'PRI' || column.key === '')).toBe(true)
    await driver!.exec('DROP TABLE composite', [], DB)
  })

  it('reports enum members and a generated column', async () => {
    await driver!.exec(
      "CREATE TABLE kinds(k enum('a','b,c') DEFAULT 'a', base INT DEFAULT 2, doubled INT GENERATED ALWAYS AS (base * 2) STORED)",
      [],
      DB,
    )
    const columns = await driver!.columns(DB, 'kinds')
    // The members come from the declared type, so the browser does not have to
    // re-implement MySQL's member quoting.
    expect(columns.find(column => column.name === 'k')!.options).toEqual(['a', 'b,c'])
    expect(columns.find(column => column.name === 'doubled')!.generated).toBe(true)
    expect(columns.find(column => column.name === 'base')!.generated).toBeUndefined()
    await driver!.exec('DROP TABLE kinds', [], DB)
  })

  it('adds, alters and drops a column', async () => {
    await driver!.exec('CREATE TABLE cols(a INT)', [], DB)
    await driver!.addColumn(DB, 'cols', { name: 'extra', type: 'int', nullable: true })
    let columns = await driver!.columns(DB, 'cols')
    expect(columns.find(column => column.name === 'extra')!.nullable).toBe(true)

    await driver!.alterColumn(DB, 'cols', { name: 'extra', type: 'bigint unsigned', nullable: true, defaultValue: '7', comment: 'note' })
    columns = await driver!.columns(DB, 'cols')
    const altered = columns.find(column => column.name === 'extra')!
    expect(altered.type).toBe('bigint unsigned')
    // The server reports a numeric default as a quoted string; what matters is
    // that the value survived the round trip.
    expect(altered.defaultValue).toBe('7')
    expect(altered.comment).toBe('note')

    // A rename goes through `CHANGE COLUMN`, which must not duplicate the name.
    await driver!.alterColumn(DB, 'cols', { name: 'extra', type: 'bigint unsigned', nullable: true, defaultValue: '7' }, { rename: 'extra2' })
    columns = await driver!.columns(DB, 'cols')
    expect(columns.map(column => column.name)).toEqual(['a', 'extra2'])

    await driver!.dropColumn(DB, 'cols', 'extra2')
    columns = await driver!.columns(DB, 'cols')
    expect(columns.map(column => column.name)).toEqual(['a'])
    await driver!.exec('DROP TABLE cols', [], DB)
  })

  it('explains a NOT NULL refusal in terms a user can act on', async () => {
    await driver!.exec('CREATE TABLE nullable(a INT)', [], DB)
    await driver!.exec('INSERT INTO nullable VALUES (NULL)', [], DB)
    // MySQL's own message is "Data truncated for column 'a' at row 1" (or
    // "Invalid use of NULL value"), which names an internal row and says nothing
    // about the NULLable-to-NOT-NULL change the user actually asked for.
    await expect(driver!.alterColumn(DB, 'nullable', { name: 'a', type: 'int', nullable: false }))
      .rejects.toThrow(/currently holds NULL/)
    await driver!.exec('UPDATE nullable SET a = 0', [], DB)
    await driver!.alterColumn(DB, 'nullable', { name: 'a', type: 'int', nullable: false })
    expect((await driver!.columns(DB, 'nullable')).find(column => column.name === 'a')!.nullable).toBe(false)
    await driver!.exec('DROP TABLE nullable', [], DB)
  })

  it('refuses the last column and reports a missing table as such', async () => {
    await driver!.exec('CREATE TABLE single(a INT)', [], DB)
    await expect(driver!.dropColumn(DB, 'single', 'a')).rejects.toThrow(/at least one column/)
    // A missing table must not be reported as "keep at least one column": the
    // column list comes back empty for both, and confusing them sends the user
    // looking for the wrong problem.
    await expect(driver!.dropColumn(DB, 'no_such_table', 'a')).rejects.toThrow(/no such table/)
    await driver!.exec('DROP TABLE single', [], DB)
  })

  it('creates and drops indexes, refusing the primary key', async () => {
    await driver!.exec('CREATE TABLE idx(a INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(20), t TEXT)', [], DB)
    await driver!.createIndex(DB, 'idx', { name: 'ix_v', columns: ['v'], unique: false })
    expect((await driver!.indexes(DB, 'idx')).find(index => index.name === 'ix_v')).toMatchObject({ unique: false })

    await driver!.dropIndex(DB, 'idx', 'ix_v')
    expect((await driver!.indexes(DB, 'idx')).map(index => index.name)).not.toContain('ix_v')

    await driver!.createIndex(DB, 'idx', { name: 'ux_v', columns: ['v'], unique: true })
    expect((await driver!.indexes(DB, 'idx')).find(index => index.name === 'ux_v')!.unique).toBe(true)

    // The primary key's own index cannot be dropped as an index.
    expect((await driver!.indexes(DB, 'idx')).find(index => index.name === 'PRIMARY')!.primary).toBe(true)
    await expect(driver!.dropIndex(DB, 'idx', 'PRIMARY')).rejects.toThrow(/primary key/i)

    // A TEXT index needs a prefix length; MySQL's own message does not say what
    // to do, so the refusal is restated.
    await expect(driver!.createIndex(DB, 'idx', { name: 'ix_t', columns: ['t'], unique: false })).rejects.toThrow(/prefix length/)
    await expect(driver!.dropIndex(DB, 'idx', 'no_such_index')).rejects.toThrow(/no such index/)
    await driver!.exec('DROP TABLE idx', [], DB)
  })

  /**
   * MySQL RAISES a UNIQUE index to the primary key when a table has none.
   * Measured: `a INT AUTO_INCREMENT UNIQUE` reports `COLUMN_KEY = 'PRI'` for `a`
   * while its `INDEX_NAME` is `a`, not `PRIMARY`. Reading `COLUMN_KEY` as the
   * authority therefore claims a key that `DROP PRIMARY KEY` cannot find, and
   * leaves the real key droppable as if it were an ordinary unique index.
   */
  it('recognises a primary key MySQL raised from a unique index', async () => {
    await driver!.exec('CREATE TABLE promoted(a INT NOT NULL UNIQUE, b VARCHAR(10))', [], DB)
    const columns = await driver!.columns(DB, 'promoted')
    expect(columns.find(column => column.name === 'a')!.key).toBe('PRI')
    expect(columns.find(column => column.name === 'a')!.primaryKeyPosition).toBe(1)

    const indexes = await driver!.indexes(DB, 'promoted')
    expect(indexes.find(index => index.name === 'a')!.primary).toBe(true)
    await expect(driver!.dropIndex(DB, 'promoted', 'a')).rejects.toThrow(/primary key/i)

    // And a key change must find it, so a new key can be set at all.
    await driver!.setPrimaryKey(DB, 'promoted', ['b'])
    const after = await driver!.columns(DB, 'promoted')
    expect(after.find(column => column.name === 'b')!.key).toBe('PRI')
    // `a`'s UNIQUE index WAS the raised primary key, so dropping the key removes
    // it: MySQL has nothing left to mark the column with. Asserting the exact
    // marker would pin MySQL's own behaviour rather than this driver's, so what
    // is pinned is that `a` is no longer part of the key.
    expect(after.find(column => column.name === 'a')!.key).not.toBe('PRI')
    expect(after.find(column => column.name === 'a')!.primaryKeyPosition).toBeUndefined()
    await driver!.exec('DROP TABLE promoted', [], DB)
  })

  it('removes the AUTO_INCREMENT before replacing the key it belonged to', async () => {
    await driver!.exec('CREATE TABLE auto_key(id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(10) NOT NULL UNIQUE)', [], DB)
    await driver!.exec("INSERT INTO auto_key(code) VALUES ('x')", [], DB)
    // `id` carries AUTO_INCREMENT and is not in the new key, so leaving the
    // attribute in place would make the server reject the whole change with
    // "there can be only one auto column and it must be defined as a key".
    await driver!.setPrimaryKey(DB, 'auto_key', ['code'])
    const columns = await driver!.columns(DB, 'auto_key')
    expect(columns.find(column => column.name === 'code')!.key).toBe('PRI')
    expect(columns.find(column => column.name === 'id')!.extra ?? '').not.toMatch(/auto_increment/i)
    await driver!.exec('DROP TABLE auto_key', [], DB)
  })

  it('deletes several rows atomically and inserts many at once', async () => {
    await driver!.exec('CREATE TABLE batch(id INT PRIMARY KEY, v VARCHAR(10))', [], DB)
    await driver!.exec("INSERT INTO batch VALUES (1, 'a'), (2, 'b'), (3, 'c')", [], DB)

    const inserted = await driver!.insertRows(DB, 'batch', [
      [{ column: 'id', value: 4 }, { column: 'v', value: 'd' }],
      [{ column: 'id', value: 5 }, { column: 'v', value: 'e' }],
    ])
    expect(inserted.affected).toBe(2)

    const removed = await driver!.deleteRows(DB, 'batch', [
      [{ column: 'id', value: 1 }],
      [{ column: 'id', value: 5 }],
    ])
    expect(removed.affected).toBe(2)
    const page = await driver!.rows({ schema: DB, table: 'batch', page: 1, pageSize: 10, mode: 'browse', orderByColumns: ['id'] })
    expect(page.rows.map(row => row['id'])).toEqual([2, 3, 4])

    // Rows naming different columns cannot be one statement.
    await expect(driver!.insertRows(DB, 'batch', [
      [{ column: 'id', value: 6 }, { column: 'v', value: 'f' }],
      [{ column: 'id', value: 7 }],
    ])).rejects.toThrow(/same columns/)
    await driver!.exec('DROP TABLE batch', [], DB)
  })

  it('treats a wildcard character in a search operand as a literal', async () => {
    await driver!.exec('CREATE TABLE wild(v VARCHAR(20))', [], DB)
    await driver!.exec("INSERT INTO wild VALUES ('100%'), ('100x')", [], DB)
    const page = await driver!.rows({
      schema: DB,
      table: 'wild',
      page: 1,
      pageSize: 10,
      mode: 'search',
      filters: [{ column: 'v', operator: 'contains', value: '%' }],
    })
    // The escape clause is spelled per dialect; getting it wrong makes every
    // escaped search silently match nothing.
    expect(page.rows.map(row => row['v'])).toEqual(['100%'])
    await driver!.exec('DROP TABLE wild', [], DB)
  })
})

describe.skipIf(!reachable)('MySQL export and import', () => {
  it('round-trips a schema with a foreign key, an enum and a generated column', async () => {
    await driver!.exec(`CREATE DATABASE IF NOT EXISTS ${COPY}`, [])
    await driver!.exec(
      "CREATE TABLE parent(id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(20) NOT NULL, " +
      "k ENUM('a','b') DEFAULT 'a', base INT DEFAULT 1, doubled INT GENERATED ALWAYS AS (base * 2) STORED) " +
      'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
      [],
      DB,
    )
    await driver!.exec(
      'CREATE TABLE child(id INT PRIMARY KEY, pid INT, CONSTRAINT fk_pid FOREIGN KEY (pid) REFERENCES parent(id) ON DELETE CASCADE)',
      [],
      DB,
    )
    await driver!.exec("INSERT INTO parent(v, base) VALUES ('one', 3), ('two', 4)", [], DB)
    await driver!.exec('INSERT INTO child VALUES (1, 1)', [], DB)

    const dump = await exportSql(driver!, entry, {
      schema: DB,
      includeData: true,
      includeStructure: true,
      drop: true,
      format: 'sql',
    })
    expect(dump.text).toContain("enum('a','b')")
    expect(dump.text).toContain('FOREIGN KEY')
    expect(dump.text).toContain('FOREIGN_KEY_CHECKS=0')
    // A generated column must NOT be named in an INSERT: MySQL refuses it
    // outright, which would make the whole dump un-importable.
    const parentInsert = dump.text.split('\n').find(line => line.startsWith('INSERT INTO `parent`'))
    expect(parentInsert).toBeDefined()
    expect(parentInsert).not.toContain('doubled')
    // `child` references `parent`, so it has to be created second even though
    // name order puts it first.
    expect(dump.text.indexOf('CREATE TABLE `parent`')).toBeLessThan(dump.text.indexOf('CREATE TABLE `child`'))

    const result = await importSql(driver!, { schema: COPY, content: dump.text, format: 'sql' })
    expect(result.statements).toBeGreaterThan(0)

    const source = await driver!.allRows(DB, 'parent', 100)
    const restored = await driver!.allRows(COPY, 'parent', 100)
    expect(restored.columns).toEqual(source.columns)
    expect(restored.rows).toEqual(source.rows)
    // The foreign key survived, so the child row is still valid.
    expect(Number((await driver!.query('SELECT COUNT(*) AS n FROM child', [], 10, COPY)).rows[0]![0])).toBe(1)
    await driver!.exec(`DROP DATABASE ${COPY}`, [])
    await driver!.exec('DROP TABLE child, parent', [], DB)
  })

  it('exports CSV with a BOM and imports it back by column name', async () => {
    await driver!.exec('CREATE TABLE csv_source(a VARCHAR(20), b VARCHAR(20))', [], DB)
    await driver!.exec("INSERT INTO csv_source VALUES ('x,y', 'q\"r'), ('=1+1', '')", [], DB)
    const csv = await exportSql(driver!, entry, {
      schema: DB,
      tables: ['csv_source'],
      includeData: true,
      includeStructure: false,
      drop: false,
      format: 'csv',
    })
    expect(csv.text.charCodeAt(0)).toBe(0xfeff)
    expect(csv.text).toContain('"x,y"')
    expect(csv.text).toContain('"q""r"')
    // A leading `=` would be a live formula in a spreadsheet; quoting keeps it text.
    expect(csv.text).toContain('"=1+1"')

    await driver!.exec('CREATE TABLE csv_target(a VARCHAR(20), b VARCHAR(20))', [], DB)
    // A header in the opposite order, to prove the mapping is by name.
    const result = await importSql(driver!, {
      schema: DB,
      table: 'csv_target',
      format: 'csv',
      hasHeader: true,
      content: 'b,a\r\nsecond,first\r\n',
    })
    expect(result.rows).toBe(1)
    const page = await driver!.rows({ schema: DB, table: 'csv_target', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.rows[0]).toEqual({ a: 'first', b: 'second' })
    await driver!.exec('DROP TABLE csv_source, csv_target', [], DB)
  })

  it('refuses a CSV naming a column the table does not have', async () => {
    await driver!.exec('CREATE TABLE csv_guard(a VARCHAR(10))', [], DB)
    await expect(importSql(driver!, {
      schema: DB,
      table: 'csv_guard',
      format: 'csv',
      hasHeader: true,
      content: 'a,nope\r\n1,2\r\n',
    })).rejects.toThrow(/does not exist/)
    await driver!.exec('DROP TABLE csv_guard', [], DB)
  })
})
