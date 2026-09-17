/**
 * MySQL driver probe against the local Docker MySQL.
 *
 * A live-server probe rather than a test: it is kept out of `npm test` because
 * it needs a running server, and it exists because the MySQL half of the schema
 * editor cannot be verified offline — the interesting behaviour (what
 * `SHOW CREATE TABLE` includes, which ALTER forms the engine accepts) IS the
 * server's.
 *
 * Usage: npx tsx scripts/probe-mysql-schema.mts [database]
 */

import { MysqlDriver } from '../src/drivers/mysql.ts'
import { exportSql, importSql } from '../src/sql-transfer.ts'
import type { DataSourceEntry } from '../src/protocol.ts'

const database = process.argv[2] ?? 'dbm_probe'

const entry: DataSourceEntry = {
  id: 'probe',
  kind: 'mysql',
  name: 'probe',
  group: '',
  tags: [],
  description: '',
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: 'root',
  readonly: false,
  createdAt: 0,
  updatedAt: 0,
}

const driver = new MysqlDriver(entry)

/** Report one step, keeping the script running when it fails. */
async function step(label: string, work: () => Promise<unknown>): Promise<void> {
  try {
    const value = await work()
    console.log(`OK   ${label}${value === undefined ? '' : ' → ' + JSON.stringify(value)}`)
  } catch (error) {
    console.log(`FAIL ${label} → ${error instanceof Error ? error.message : String(error)}`)
  }
}

const report: Record<string, unknown> = {}
try {
  await step('connect', async () => (await driver.test()).ok)
  await step('reset', async () => {
    await driver.exec('DROP DATABASE IF EXISTS dbm_probe_copy', [])
    await driver.exec(`DROP DATABASE IF EXISTS ${database}`, [])
    await driver.exec(`CREATE DATABASE ${database}`, [])
    return undefined
  })

  await step('create parent', () => driver.exec(
    'CREATE TABLE parent(id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(20) NOT NULL, ' +
    'u VARCHAR(10) UNIQUE, k ENUM(\'a\',\'b\') DEFAULT \'a\', base INT DEFAULT 3, ' +
    'c INT GENERATED ALWAYS AS (base * 2) STORED, ' +
    'note TEXT COMMENT \'hello\') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4', [], database))
  await step('create child with FK', () => driver.exec(
    'CREATE TABLE child(id INT PRIMARY KEY, pid INT, CONSTRAINT fk_pid FOREIGN KEY (pid) REFERENCES parent(id) ON DELETE CASCADE)', [], database))
  await step('create a one-column table for the last-column guard', () => driver.exec('CREATE TABLE single(a INT)', [], database))
  await step('seed', () => driver.exec("INSERT INTO parent(v, u, note) VALUES ('one', 'u1', 'n'), ('two', 'u2', NULL)", [], database))

  await step('columns', async () => {
    const columns = await driver.columns(database, 'parent')
    report.columns = columns.map(column => `${column.name}:${column.type}${column.key}/${column.extra ?? ''}${column.generated ? '/gen' : ''}${column.options === undefined ? '' : '/' + column.options.join('|')}`)
    console.log('     columns:', JSON.stringify(report.columns))
    return columns.length
  })
  await step('indexes', async () => {
    const indexes = await driver.indexes(database, 'parent')
    report.indexes = indexes.map(index => `${index.name}${index.unique ? '/unique' : ''}${index.primary ? '/primary' : ''}(${index.columns.join(',')})`)
    console.log('     indexes:', JSON.stringify(report.indexes))
    return indexes.length
  })

  await step('add column', () => driver.addColumn(database, 'parent', { name: 'extra', type: 'int', nullable: true }))
  await step('alter column type', () => driver.alterColumn(database, 'parent', {
    name: 'extra', type: 'bigint unsigned', nullable: true, defaultValue: '7',
  }))
  await step('verify altered', async () => {
    const column = (await driver.columns(database, 'parent')).find(candidate => candidate.name === 'extra')
    console.log('     extra:', JSON.stringify(column))
    return `${column?.type} nullable=${column?.nullable} default=${column?.defaultValue}`
  })
  await step('rename column', () => driver.alterColumn(database, 'parent', {
    name: 'extra', type: 'bigint unsigned', nullable: true, defaultValue: '7',
  }, { rename: 'extra2' }))
  await step('explain a NOT NULL refusal in terms the user can act on', async () => {
    // `extra2` holds NULLs, so MySQL refuses to make it NOT NULL. The message
    // must say so rather than report "Data truncated for column at row 1".
    try {
      await driver.alterColumn(database, 'parent', { name: 'extra2', type: 'bigint unsigned', nullable: false })
      return 'NOT REFUSED — problem'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log('     message:', message)
      return message.includes('currently holds NULL') ? 'explained' : 'NOT EXPLAINED'
    }
  })
  await step('alter column to NOT NULL after filling the rows', async () => {
    await driver.exec('UPDATE parent SET extra2 = 0 WHERE extra2 IS NULL', [], database)
    const result = await driver.alterColumn(database, 'parent', { name: 'extra2', type: 'bigint unsigned', nullable: false })
    // Put it back to nullable-with-default, so the later steps that INSERT rows
    // do not have to supply it.
    await driver.alterColumn(database, 'parent', { name: 'extra2', type: 'bigint unsigned', nullable: true, defaultValue: '7' })
    return result
  })
  await step('create index', () => driver.createIndex(database, 'parent', { name: 'ix_v', columns: ['v'], unique: false }))
  await step('create unique index', () => driver.createIndex(database, 'parent', { name: 'ux_v', columns: ['v'], unique: true }))
  await step('refuse an index on TEXT without a length', async () => {
    await driver.createIndex(database, 'parent', { name: 'ix_note', columns: ['note'], unique: false })
    return 'NOT REFUSED — problem'
  })
  await step('drop index', () => driver.dropIndex(database, 'parent', 'ix_v'))
  await step('drop the unique index again', () => driver.dropIndex(database, 'parent', 'ux_v'))
  await step('refuse drop PRIMARY as index', async () => {
    await driver.dropIndex(database, 'parent', 'PRIMARY')
    return 'NOT REFUSED — problem'
  })

  await step('distinct count', () => driver.distinctCount(database, 'parent', 'v'))
  await step('batch insert', () => driver.insertRows(database, 'parent', [
    [{ column: 'v', value: 'three' }, { column: 'u', value: 'u3' }],
    [{ column: 'v', value: 'four' }, { column: 'u', value: 'u4' }],
  ]))
  await step('batch delete', async () => {
    const page = await driver.rows({ schema: database, table: 'parent', page: 1, pageSize: 10, mode: 'browse', orderByColumns: ['v'] })
    const target = page.rows.filter(row => row['v'] === 'three' || row['v'] === 'four')
    return driver.deleteRows(database, 'parent', target.map(row => [{ column: 'id', value: row['id']! }]))
  })

  await step('structured search', async () => {
    const page = await driver.rows({
      schema: database, table: 'parent', page: 1, pageSize: 10, mode: 'search',
      filters: [{ column: 'v', operator: 'contains', value: 'n' }],
    })
    return page.rows.map(row => row['v'])
  })

  await step('set primary key to a different column', async () => {
    // On its OWN table: on `parent` the `id` column is referenced by `child`'s
    // foreign key, and MySQL refuses to change a referenced column — a correct
    // refusal this probe is not trying to test.
    await driver.exec('CREATE TABLE keyless(a INT AUTO_INCREMENT UNIQUE, b VARCHAR(10) NOT NULL, c VARCHAR(10) UNIQUE)', [], database)
    await driver.exec("INSERT INTO keyless(b, c) VALUES ('x', 'p')", [], database)
    return driver.setPrimaryKey(database, 'keyless', ['c'])
  })
  await step('verify key', async () => {
    const columns = await driver.columns(database, 'keyless')
    return columns.filter(column => column.key === 'PRI').map(column => `${column.name}@${column.primaryKeyPosition}`)
  })
  await step('verify the auto-increment was dropped', async () => {
    // `a` carries AUTO_INCREMENT and is NOT in the new key, so the driver had to
    // remove that first — MySQL refuses an AUTO_INCREMENT column that is not a
    // key, and would otherwise reject the whole key change.
    const column = (await driver.columns(database, 'keyless')).find(candidate => candidate.name === 'a')
    return { extra: column?.extra, nullable: column?.nullable }
  })

  await step('drop column', () => driver.dropColumn(database, 'parent', 'extra2'))
  await step('refuse dropping the last column', async () => {
    await driver.dropColumn(database, 'single', 'a')
    return 'NOT REFUSED — problem'
  })
  await step('report a missing table as such when dropping a column', async () => {
    await driver.dropColumn(database, 'no_such_table', 'a')
    return 'NOT REFUSED — problem'
  })
  await step('refuse dropping a FK column', async () => {
    await driver.dropColumn(database, 'child', 'pid')
    return 'NOT REFUSED — problem'
  })

  await step('show create table', async () => {
    report.create = await driver.createStatement(database, 'parent')
    console.log('     create:', JSON.stringify(report.create))
    return undefined
  })
  await step('auxiliary ddl is empty on MySQL', () => driver.auxiliaryDdl(database, 'parent'))

  await step('export sql', async () => {
    const dump = await exportSql(driver, entry, { schema: database, includeData: true, includeStructure: true, drop: true, format: 'sql' })
    report.dumpBytes = dump.text.length
    report.dumpHasEnum = dump.text.includes("enum('a','b')")
    report.dumpHasGenerated = /GENERATED/i.test(dump.text)
    report.dumpHasFk = /FOREIGN KEY/i.test(dump.text)
    console.log('     header:', JSON.stringify(dump.text.split('\n').slice(0, 4)))
    console.log('     parent fragment:', JSON.stringify(dump.text.slice(dump.text.indexOf('parent') - 40, dump.text.indexOf('parent') + 400)))
    return { bytes: dump.text.length, hasEnum: report.dumpHasEnum, hasGenerated: report.dumpHasGenerated, hasFk: report.dumpHasFk }
  })

  await step('import the dump into another database', async () => {
    const other = 'dbm_probe_copy'
    await driver.exec(`DROP DATABASE IF EXISTS ${other}`, [])
    await driver.exec(`CREATE DATABASE ${other}`, [])
    const dump = await exportSql(driver, entry, { schema: database, includeData: true, includeStructure: true, drop: true, format: 'sql' })
    const result = await importSql(driver, { schema: other, content: dump.text, format: 'sql' })
    const there = await driver.rows({ schema: other, table: 'parent', page: 1, pageSize: 20, mode: 'browse' })
    const here = await driver.rows({ schema: database, table: 'parent', page: 1, pageSize: 20, mode: 'browse' })
    report.importRows = there.rows.length
    report.rowsMatch = JSON.stringify(there.rows) === JSON.stringify(here.rows)
    console.log('     imported rows:', there.rows.length, 'match:', report.rowsMatch, 'statements:', result.statements)
    return { rows: there.rows.length, match: report.rowsMatch, statements: result.statements }
  }, )

  await step('export csv', async () => {
    const csv = await exportSql(driver, entry, { schema: database, tables: ['parent'], includeData: true, includeStructure: false, drop: false, format: 'csv' })
    console.log('     csv head:', JSON.stringify(csv.text.split('\r\n').slice(0, 2)))
    return { bom: csv.text.charCodeAt(0) === 0xfeff, lines: csv.text.split('\r\n').length }
  })

  await step('import csv', async () => {
    await driver.exec('DROP TABLE IF EXISTS csv_target', [], database)
    await driver.exec('CREATE TABLE csv_target(v VARCHAR(20), u VARCHAR(10))', [], database)
    const csv = 'v,u\r\nfrom,csv\r\n'
    const result = await importSql(driver, { schema: database, table: 'csv_target', format: 'csv', hasHeader: true, content: csv })
    const page = await driver.rows({ schema: database, table: 'csv_target', page: 1, pageSize: 10, mode: 'browse' })
    return { rows: result.rows, data: page.rows }
  })

  console.log('\n--- report ---')
  console.log(JSON.stringify(report, null, 2))
} finally {
  await driver.close()
}
