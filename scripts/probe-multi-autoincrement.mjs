/*
 * Can a table have more than one auto-increment column?
 *
 * Asked directly, so it is measured rather than answered from memory. Both engines this
 * plugin supports are checked, and the SQLite cases are probed in several shapes because
 * its rule is about the rowid alias rather than about a flag.
 */
const mysql = await import('mysql2/promise')
const db = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'root' })
const database = `dbm_auto2_${process.pid}`
await db.query(`CREATE DATABASE ${database}`)
await db.query(`USE ${database}`)

const attempt = async (label, sql) => {
  try {
    await db.query(sql)
    console.log(`OK    ${label}`)
    return true
  } catch (error) {
    console.log(`FAIL  ${label}\n        ${error.message}`)
    return false
  }
}

console.log('=== MySQL ===')
await attempt('two AUTO_INCREMENT columns, both keys', "CREATE TABLE m1(a INT AUTO_INCREMENT PRIMARY KEY, b INT AUTO_INCREMENT UNIQUE)")
await attempt('two AUTO_INCREMENT, second one is a key', "CREATE TABLE m2(a INT PRIMARY KEY, b INT AUTO_INCREMENT UNIQUE)")
await attempt('two AUTO_INCREMENT, only one is a key', "CREATE TABLE m3(a INT AUTO_INCREMENT PRIMARY KEY, b INT AUTO_INCREMENT)")
await attempt('AUTO_INCREMENT on a composite-key member', "CREATE TABLE m4(a INT AUTO_INCREMENT, b INT, PRIMARY KEY(a,b))")
await attempt('non-numeric AUTO_INCREMENT', "CREATE TABLE m5(a VARCHAR(10) AUTO_INCREMENT PRIMARY KEY)")
// What does the server say about the column itself?
await attempt('one AUTO_INCREMENT (control)', "CREATE TABLE m6(a INT AUTO_INCREMENT PRIMARY KEY)")

console.log('\n=== SQLite ===')
const { DatabaseSync } = await import('node:sqlite')
const { mkdtempSync, rmSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const dir = mkdtempSync(join(tmpdir(), 'sqlite-auto2-'))
const lite = new DatabaseSync(join(dir, 'a.db'))

const attemptLite = (label, sql) => {
  try {
    lite.exec(sql)
    console.log(`OK    ${label}`)
    return true
  } catch (error) {
    console.log(`FAIL  ${label}\n        ${error.message}`)
    return false
  }
}

attemptLite('two INTEGER PRIMARY KEY AUTOINCREMENT', 'CREATE TABLE s1(a INTEGER PRIMARY KEY AUTOINCREMENT, b INTEGER PRIMARY KEY AUTOINCREMENT)')
attemptLite('one rowid alias + one AUTOINCREMENT elsewhere', 'CREATE TABLE s2(a INTEGER PRIMARY KEY AUTOINCREMENT, b INTEGER AUTOINCREMENT)')
attemptLite('AUTOINCREMENT on a non-key column', 'CREATE TABLE s3(a INTEGER, b INTEGER AUTOINCREMENT)')
attemptLite('AUTOINCREMENT with a composite key', 'CREATE TABLE s4(a INTEGER PRIMARY KEY AUTOINCREMENT, b INT, PRIMARY KEY(a,b))')
attemptLite('AUTOINCREMENT on INT (not INTEGER)', 'CREATE TABLE s5(a INT PRIMARY KEY AUTOINCREMENT)')
attemptLite('one INTEGER PRIMARY KEY AUTOINCREMENT (control)', 'CREATE TABLE s6(a INTEGER PRIMARY KEY AUTOINCREMENT)')

// Two ordinary INTEGER PRIMARY KEY columns would be two keys — is that even allowed?
attemptLite('two plain INTEGER PRIMARY KEY (no AUTOINCREMENT)', 'CREATE TABLE s7(a INTEGER PRIMARY KEY, b INTEGER PRIMARY KEY)')

lite.close()
rmSync(dir, { recursive: true, force: true })
await db.query(`DROP DATABASE ${database}`)
await db.end()
console.log('\ncleaned up')
