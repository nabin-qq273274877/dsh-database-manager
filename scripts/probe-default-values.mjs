/*
 * What each 默认值 input actually produces, on both engines.
 *
 * The question: is a blank field an empty-string default, and how are NULL and
 * CURRENT_TIMESTAMP expressed? Answered by running the real create path and then asking the
 * ENGINE what the column's default is — the catalog value is what decides the behaviour of
 * an INSERT that omits the column, so it is the only thing worth reporting.
 *
 * Both engines are checked for two reasons: their catalogs differ (SQLite stores the
 * default expression as text, MySQL normalizes some of it), and the panel's own validation
 * is shared, so a form that works on one engine may be refused by the other.
 */
const { MysqlDriver } = await import('file:///D:/Project/nabin/dsh-plugins/dsh-database-manager/src/drivers/mysql.ts')
const { SqliteDriver } = await import('file:///D:/Project/nabin/dsh-plugins/dsh-database-manager/src/drivers/sqlite.ts')
const { mkdtempSync, rmSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

const dir = mkdtempSync(join(tmpdir(), 'dbm-defaults-'))

/** The inputs to try, labelled by what a user would mean by typing them. */
const INPUTS = [
  { label: '（留空）', value: '' },
  { label: 'abc（裸文本）', value: 'abc' },
  { label: "'abc'（带引号）", value: "'abc'" },
  { label: "''（空字符串）", value: "''" },
  { label: '0', value: '0' },
  { label: 'NULL', value: 'NULL' },
  { label: 'null（小写）', value: 'null' },
  { label: 'CURRENT_TIMESTAMP', value: 'CURRENT_TIMESTAMP' },
  { label: 'CURRENT_TIMESTAMP()', value: 'CURRENT_TIMESTAMP()' },
  { label: 'now()', value: 'now()' },
  { label: '不合法：1;DROP', value: '1;DROP' },
  { label: '不合法：(1+1)', value: '(1+1)' },
]

const mysql = new MysqlDriver({
  id: 'p', kind: 'mysql', name: 'p', host: '127.0.0.1', port: 3306, user: 'root', password: 'root',
})
const database = `dbm_def_${process.pid}`
await mysql.databaseOperation('create', database)

const lite = new SqliteDriver({ id: 'p', kind: 'sqlite', name: 'p', file: join(dir, 'd.db') })
await lite.test()

let counter = 0
/** Create 'v' with a default and report what the ENGINE stored. */
const tryDefault = async (engine, value, nullable) => {
  const table = `t${counter++}`
  const mysqlSpec = {
    name: 'v',
    type: 'VARCHAR',
    length: '40',
    nullable,
    ...(value === '' ? {} : { defaultValue: value }),
  }
  const sqliteSpec = { name: 'v', type: 'TEXT', nullable, ...(value === '' ? {} : { defaultValue: value }) }
  try {
    if (engine === 'mysql') await mysql.createTable(database, table, [mysqlSpec])
    else await lite.createTable(undefined, table, [sqliteSpec])
  } catch (error) {
    return `拒绝: ${error.message.slice(0, 90)}`
  }
  const columns = engine === 'mysql' ? await mysql.columns(database, table) : await lite.columns(undefined, table)
  const found = columns.find(entry => entry.name === 'v')
  // 'null' for a column with no default; the string otherwise, as the engine reports it.
  return found?.defaultValue === undefined ? '（无默认值）' : `默认值=${JSON.stringify(found.defaultValue)}`
}

console.log('=== 允许空（nullable）时，各输入的效果 ===\n')
console.log('输入'.padEnd(26) + 'MySQL'.padEnd(46) + 'SQLite')
for (const { label, value } of INPUTS) {
  const m = await tryDefault('mysql', value, true)
  const s = await tryDefault('sqlite', value, true)
  console.log(label.padEnd(26) + m.padEnd(46) + s)
}

console.log('\n=== 不允许空（NOT NULL）时，留空默认值会怎样 ===')
for (const value of ['', 'NULL', 'abc']) {
  const m = await tryDefault('mysql', value, false)
  const s = await tryDefault('sqlite', value, false)
  const label = value === '' ? '（留空）' : value
  console.log(label.padEnd(26) + m.padEnd(46) + s)
}

console.log('\n=== 插入时省略该列，实际存进去的是什么（MySQL）===')
const { default: mysql2 } = await import('mysql2/promise')
const raw = await mysql2.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'root' })
await raw.query(`USE ${database}`)
const probeInsert = async (label, definition) => {
  const table = `ins_${Math.abs(label.length)}`
  await raw.query(`DROP TABLE IF EXISTS ${table}`)
  await raw.query(`CREATE TABLE ${table}(v ${definition})`)
  try {
    await raw.query(`INSERT INTO ${table} VALUES ()`)
  } catch (error) {
    // A NOT NULL column with no default is REFUSED on an insert that omits it, which is
    // the correct behaviour and worth showing rather than crashing the probe.
    console.log(`  ${label.padEnd(34)} → 插入被拒绝: ${error.code}`)
    return
  }
  const [rows] = await raw.query(`SELECT v, v IS NULL AS is_null FROM ${table}`)
  console.log(`  ${label.padEnd(34)} → ${JSON.stringify(rows[0])}`)
}
await probeInsert('允许空 + 无 DEFAULT（留空）', 'VARCHAR(40) NULL')
await probeInsert("允许空 + DEFAULT ''", "VARCHAR(40) NULL DEFAULT ''")
await probeInsert("允许空 + DEFAULT 'abc'", "VARCHAR(40) NULL DEFAULT 'abc'")
await probeInsert('允许空 + DEFAULT NULL', 'VARCHAR(40) NULL DEFAULT NULL')
await probeInsert('NOT NULL + 无 DEFAULT', 'VARCHAR(40) NOT NULL')
await raw.end()

await mysql.databaseOperation('drop', database)
await mysql.close()
await lite.close()
rmSync(dir, { recursive: true, force: true })
console.log('\ncleaned up')
