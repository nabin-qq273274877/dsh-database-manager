/**
 * MySQL driver tests against a real server.
 *
 * These cover the behaviour that motivated removing the default-schema field:
 * connecting with NO schema must succeed and make every database visible, and
 * every operation must require an explicit schema rather than silently falling
 * back to one. That fallback is the dangerous part — a statement silently
 * running against a database the user never chose is how data gets lost — so it
 * is asserted to fail loudly.
 *
 * Runs only when a MySQL server is reachable; configure with:
 *   DBM_TEST_MYSQL=host:port:user:password
 * Defaults to the local Docker container (127.0.0.1:3306 root/root).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MysqlDriver, mysqlAvailable } from '../src/drivers/mysql.ts'
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

/** An entry with no `database`, i.e. how the plugin now connects. */
function entry(): DataSourceEntry {
  return {
    id: 'mysql-test',
    kind: 'mysql',
    name: 'mysql-test',
    group: '',
    tags: [],
    description: '',
    host,
    port,
    user,
    password,
    tls: false,
    readonly: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

const DB_A = 'dbm_probe_a'
const DB_B = 'dbm_probe_b'

let driver: MysqlDriver | undefined

beforeAll(async () => {
  if (!reachable) return
  driver = new MysqlDriver(entry())
  // Two databases, so "which one am I talking to" is never ambiguous.
  for (const db of [DB_A, DB_B]) {
    await driver.exec(`DROP DATABASE IF EXISTS \`${db}\``, [])
    await driver.exec(`CREATE DATABASE \`${db}\` DEFAULT CHARACTER SET utf8mb4`, [])
  }
  await driver.exec(`CREATE TABLE \`${DB_A}\`.t (id INT PRIMARY KEY, name VARCHAR(50), note TEXT)`, [])
  await driver.exec(`INSERT INTO \`${DB_A}\`.t (id, name, note) VALUES (1, 'alice', 'first'), (2, 'bob', NULL)`, [])
  await driver.exec(`CREATE TABLE \`${DB_B}\`."t" (id INT PRIMARY KEY, other VARCHAR(50))`.replace('"t"', 't'), [])
  await driver.exec(`INSERT INTO \`${DB_B}\`.t (id, other) VALUES (1, 'second-db')`, [])
}, 60000)

afterAll(async () => {
  if (driver === undefined) return
  for (const db of [DB_A, DB_B]) {
    await driver.exec(`DROP DATABASE IF EXISTS \`${db}\``, []).catch(() => undefined)
  }
  await driver.close()
})

describe.skipIf(!reachable)('MysqlDriver without a default schema', () => {
  it('connects and reports a version', async () => {
    const result = await driver!.test()
    expect(result.ok).toBe(true)
    expect(result.serverVersion).toMatch(/MySQL/)
  })

  it('lists every database, not just one', async () => {
    const names = (await driver!.schemas()).map(item => item.name)
    // The point of dropping the default schema: both probe databases are
    // visible from a single connection.
    expect(names).toContain(DB_A)
    expect(names).toContain(DB_B)
    // System schemas stay hidden so the tree is about the user's data.
    expect(names).not.toContain('information_schema')
    expect(names).not.toContain('mysql')
  })

  it('lists each database\u2019s own tables independently', async () => {
    const tablesA = await driver!.tables(DB_A)
    const tablesB = await driver!.tables(DB_B)
    expect(tablesA.map(table => table.name)).toContain('t')
    expect(tablesB.map(table => table.name)).toContain('t')
    expect(tablesA[0]?.type).toBe('table')
  })

  /*
   * The row count and size are read from BIGINT columns, which mysql2 returns as STRINGS.
   *
   * The pool sets `supportBigNumbers: true` with `bigNumberStrings: true` so a BIGINT beyond 2^53
   * cannot lose precision on its way to the browser, and mysql2 therefore hands back every bigint
   * as a string. `TABLE_ROWS`, `DATA_LENGTH` and `INDEX_LENGTH` are all `bigint unsigned` in
   * information_schema, so the old `typeof value === 'number'` test rejected every one of them:
   * the table list showed 行数 未知 and a blank 大小 for every table, on every MySQL server, while
   * the same query in a client returned numbers.
   *
   * Both halves are asserted, because either alone would pass on a broken implementation: with
   * stats the numbers must be present AND be actual numbers, and without stats they must be absent
   * (the tree calls this on every expand and must not pay for them).
   */
  it('fills in the row count and size when statistics are asked for', async () => {
    const tables = await driver!.tables(DB_A, { stats: true })
    const table = tables.find(entry => entry.name === 't')
    expect(table).toBeDefined()
    /*
     * The exact count of the two rows `beforeAll` inserted.
     *
     * `TABLE_ROWS` is an ESTIMATE that InnoDB refreshes from its own statistics, so this is not
     * always exact for a large table — but it is exact for a two-row one (measured stable across
     * five consecutive reads), and demanding the real number is what fails an implementation that
     * returns a parseable-but-wrong 0.
     */
    expect(table!.rows).toBe(2)
    expect(typeof table!.rows).toBe('number')
    // Every non-empty InnoDB table occupies at least one page.
    expect(typeof table!.size).toBe('number')
    expect(table!.size).toBeGreaterThan(0)
  })

  it('omits the row count and size when statistics are not asked for', async () => {
    const tables = await driver!.tables(DB_A)
    const table = tables.find(entry => entry.name === 't')
    expect(table).toBeDefined()
    // ABSENT means UNKNOWN, which the panel renders as 未知 / — rather than claiming 0.
    expect(table!.rows).toBeUndefined()
    expect(table!.size).toBeUndefined()
    // The cheap columns are still there, since the overview shows them.
    expect(table!.engine).toBeDefined()
  })

  it('refuses to enumerate tables with no schema named', async () => {
    // No silent fallback: the caller must say which database.
    await expect(driver!.tables(undefined)).rejects.toThrow(/schema is required/)
  })

  it('refuses a read/write with no schema named', async () => {
    await expect(driver!.columns(undefined, 't')).rejects.toThrow(/schema is required/)
    await expect(driver!.insertRow(undefined, 't', [{ column: 'id', value: 9 }])).rejects.toThrow(/schema is required/)
    await expect(driver!.deleteRow(undefined, 't', [{ column: 'id', value: 9 }])).rejects.toThrow(/schema is required/)
  })

  it('reads the right database when two share a table name', async () => {
    // This is what the shared `t` name in DB_A and DB_B is for: a stale or
    // guessed schema would return the other database's rows.
    const pageA = await driver!.rows({ schema: DB_A, table: 't', page: 1, pageSize: 10, mode: 'browse' })
    const pageB = await driver!.rows({ schema: DB_B, table: 't', page: 1, pageSize: 10, mode: 'browse' })
    expect(pageA.total).toBe(2)
    expect(pageB.total).toBe(1)
    expect(pageA.columns.map(column => column.name)).toEqual(['id', 'name', 'note'])
    expect(pageB.columns.map(column => column.name)).toEqual(['id', 'other'])
  })

  it('describes the columns of a specific database\u2019s table', async () => {
    const columns = await driver!.columns(DB_A, 't')
    expect(columns.map(column => column.name)).toEqual(['id', 'name', 'note'])
    const id = columns.find(column => column.name === 'id')
    expect(id?.key).toBe('PRI')
  })

  it('runs a statement scoped to the named schema', async () => {
    // `t` exists in both databases; naming the schema decides which one runs.
    const result = await driver!.exec('SELECT other FROM t', [], DB_B)
    expect(result.rows).toEqual([['second-db']])
  })

  it('does not leak the scoped schema into the next statement', async () => {
    // `USE` persists on a pooled connection, so without a session reset the next
    // statement to borrow this connection would run against the database a
    // PREVIOUS statement chose. Measured before the reset: this exact assertion
    // failed with dbm_probe_b.
    //
    // The property that matters is user-visible: an unscoped statement must not
    // silently resolve `t` to the other database's table.
    await driver!.exec('SELECT * FROM t', [], DB_B)
    await expect(driver!.exec('SELECT * FROM t', [])).rejects.toThrow()

    // And the connection is still healthy afterwards (it was released, not
    // destroyed), so the reset does not trade a leak for a leak of sockets.
    const schemas = await driver!.schemas()
    expect(schemas.map(item => item.name)).toContain(DB_A)
  })

  it('inserts, updates and deletes within one database', async () => {
    const inserted = await driver!.insertRow(DB_A, 't', [
      { column: 'id', value: 3 },
      { column: 'name', value: 'carol' },
      { column: 'note', value: null },
    ])
    expect(inserted.affected).toBe(1)

    const updated = await driver!.updateRow(DB_A, 't', [{ column: 'name', value: 'carol2' }], [{ column: 'id', value: 3 }])
    expect(updated.affected).toBe(1)

    const after = await driver!.rows({ schema: DB_A, table: 't', page: 1, pageSize: 10, mode: 'search', term: 'carol2' })
    expect(after.total).toBe(1)

    const deleted = await driver!.deleteRow(DB_A, 't', [{ column: 'id', value: 3 }])
    expect(deleted.affected).toBe(1)

    // DB_B was never touched by any of it.
    const bTotal = await driver!.rows({ schema: DB_B, table: 't', page: 1, pageSize: 10, mode: 'browse' })
    expect(bTotal.total).toBe(1)
  })

  it('matches a NULL key through the null-safe operator', async () => {
    await driver!.insertRow(DB_A, 't', [{ column: 'id', value: 4 }, { column: 'name', value: 'dave' }, { column: 'note', value: null }])
    // `<=>` is used for keys so a NULL key matches a NULL column.
    const updated = await driver!.updateRow(DB_A, 't', [{ column: 'note', value: 'now set' }], [{ column: 'note', value: null }])
    expect(updated.affected).toBeGreaterThan(0)
    await driver!.deleteRow(DB_A, 't', [{ column: 'id', value: 4 }])
  })

  it('keeps the read-only surface read-only', async () => {
    await expect(driver!.query('DELETE FROM t', [], 10, DB_A)).rejects.toThrow(/read-only/)
    await expect(driver!.exec('SELECT 1; DROP DATABASE ' + DB_A, [])).rejects.toThrow(/one statement/)
  })

  it('reports no tables for a database that does not exist, and stays usable', async () => {
    // Querying information_schema for an unknown schema is not an error — it
    // simply matches nothing. What matters is that the pool connection was
    // released and the driver keeps working.
    expect(await driver!.tables('no_such_db_here')).toEqual([])
    const schemas = await driver!.schemas()
    expect(schemas.map(item => item.name)).toContain(DB_A)
  })
})
