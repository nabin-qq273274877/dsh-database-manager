/*
 * The three defects the default-value probe exposed, pinned down precisely.
 *
 * 1. CURRENT_TIMESTAMP is REFUSED by MySQL on the type the form suggests.
 *    The probe used VARCHAR, where MySQL indeed rejects it ("Invalid default value"). The
 *    question is whether it works on the temporal types it is meant for — if so the panel
 *    is fine and the probe was simply asking the wrong type; if not, the form cannot
 *    express the single most common default in a MySQL schema.
 *
 * 2. SQLite reports the default with its quotes still on: '"'abc'"'. The question is
 *    whether that is how SQLite always reports defaults (harmless) or something the
 *    driver's projection added (a display bug). 'pragma_table_info.dflt_value' is the
 *    authority.
 *
 * 3. 'DEFAULT NULL' on a NOT NULL column is refused by MySQL but ACCEPTED by SQLite, so the
 *    two engines disagree about the same form input. Worth knowing which one the panel
 *    should follow, and whether SQLite's acceptance is meaningful (a NULL default on a NOT
 *    NULL column cannot ever take effect).
 */
const { DatabaseSync } = await import('node:sqlite')
const { mkdtempSync, rmSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const mysql = await import('mysql2/promise')

const dir = mkdtempSync(join(tmpdir(), 'dbm-deffix-'))
const raw = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'root' })
const database = `dbm_deffix_${process.pid}`
await raw.query(`CREATE DATABASE ${database}`)
await raw.query(`USE ${database}`)

console.log('=== 1. does CURRENT_TIMESTAMP work on the temporal types it is for? ===')
const tryMysql = async (label, definition) => {
  const table = `c_${Math.abs(label.length)}${label.charCodeAt(1) % 26}`
  try {
    await raw.query(`DROP TABLE IF EXISTS ${table}`)
    await raw.query(`CREATE TABLE ${table}(v ${definition})`)
    const [rows] = await raw.query(`SELECT COLUMN_DEFAULT, IS_NULLABLE, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='${table}'`)
    console.log(`  OK    ${label.padEnd(52)} → ${JSON.stringify(rows[0])}`)
  } catch (error) {
    console.log(`  FAIL  ${label.padEnd(52)} → ${error.message.slice(0, 70)}`)
  }
}
await tryMysql('TIMESTAMP DEFAULT CURRENT_TIMESTAMP', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
await tryMysql('DATETIME DEFAULT CURRENT_TIMESTAMP', 'DATETIME DEFAULT CURRENT_TIMESTAMP')
await tryMysql('DATE DEFAULT CURRENT_DATE', 'DATE DEFAULT CURRENT_DATE')
await tryMysql('TIME DEFAULT CURRENT_TIME', 'TIME DEFAULT CURRENT_TIME')
await tryMysql('TIMESTAMP DEFAULT now()', 'TIMESTAMP DEFAULT now()')
await tryMysql('TIMESTAMP DEFAULT CURRENT_TIMESTAMP()', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP()')
await tryMysql('TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
// And what the panel's engine would do for NON-temporal types, which the form also allows.
await tryMysql('VARCHAR DEFAULT CURRENT_TIMESTAMP (the probe case)', 'VARCHAR(40) DEFAULT CURRENT_TIMESTAMP')
await tryMysql('INT DEFAULT CURRENT_TIMESTAMP', 'INT DEFAULT CURRENT_TIMESTAMP')

console.log('\n=== 2. how does SQLite itself report a text default? ===')
const lite = new DatabaseSync(join(dir, 'd.db'))
lite.exec("CREATE TABLE d1(v TEXT DEFAULT 'abc')")
lite.exec("CREATE TABLE d2(v TEXT DEFAULT '')")
lite.exec('CREATE TABLE d3(v TEXT DEFAULT 0)')
lite.exec('CREATE TABLE d4(v TEXT)')
for (const table of ['d1', 'd2', 'd3', 'd4']) {
  const rows = lite.prepare(`SELECT name, dflt_value, "notnull" FROM pragma_table_info('${table}')`).all()
  console.log(`  ${table}: ${JSON.stringify(rows)}`)
}
// The CREATE text is the other witness.
console.log('  CREATE text d1:', JSON.stringify(lite.prepare("SELECT sql FROM sqlite_master WHERE name='d1'").get().sql))
// And what a value inserted by default actually is.
lite.exec('INSERT INTO d1 DEFAULT VALUES')
lite.exec('INSERT INTO d2 DEFAULT VALUES')
lite.exec('INSERT INTO d4 DEFAULT VALUES')
console.log('  d1 inserted value:', JSON.stringify(lite.prepare('SELECT v, typeof(v) AS t FROM d1').all()))
console.log('  d2 inserted value:', JSON.stringify(lite.prepare('SELECT v, typeof(v) AS t FROM d2').all()))
console.log('  d4 (no default) value:', JSON.stringify(lite.prepare('SELECT v, typeof(v) AS t FROM d4').all()))

console.log('\n=== 3. NOT NULL + DEFAULT NULL: the engines disagree ===')
await tryMysql('NOT NULL + DEFAULT NULL', 'VARCHAR(40) NOT NULL DEFAULT NULL')
const tryLite = (label, definition) => {
  const table = `n_${Math.abs(label.length)}`
  try {
    lite.exec(`CREATE TABLE ${table}(v ${definition})`)
    const rows = lite.prepare(`SELECT name, dflt_value, "notnull" FROM pragma_table_info('${table}')`).all()
    console.log(`  OK    ${label.padEnd(52)} → ${JSON.stringify(rows)}`)
  } catch (error) {
    console.log(`  FAIL  ${label.padEnd(52)} → ${error.message.slice(0, 70)}`)
  }
}
tryLite('NOT NULL + DEFAULT NULL', 'TEXT NOT NULL DEFAULT NULL')
tryLite('NOT NULL + DEFAULT 0', 'TEXT NOT NULL DEFAULT 0')

await raw.query(`DROP DATABASE ${database}`)
await raw.end()
lite.close()
rmSync(dir, { recursive: true, force: true })
console.log('\ncleaned up')
