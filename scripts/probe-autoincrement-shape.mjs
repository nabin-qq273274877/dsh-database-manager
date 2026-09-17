/*
 * The exact shape MySQL requires of an AUTO_INCREMENT column.
 *
 * The first probe showed two things that matter for the panel's rules, and both are
 * narrower questions than "how many auto columns":
 *
 *   1. 'a INT PRIMARY KEY, b INT AUTO_INCREMENT UNIQUE' was ACCEPTED — so the auto column
 *      does not have to be the PRIMARY key. The panel currently refuses anything that is
 *      not 'primary', which would be stricter than the engine.
 *   2. 'a INT AUTO_INCREMENT, b INT, PRIMARY KEY(a,b)' was ACCEPTED — so an auto column may
 *      be a member of a COMPOSITE key. The panel allows that (it checks only that the
 *      column is part of the key), but MySQL may require it to be the FIRST member, which
 *      the panel does not check.
 *
 * Both are checked here, because a panel rule that is wrong in either direction is a
 * defect: too strict refuses valid tables, too loose produces a server error.
 */
const mysql = await import('mysql2/promise')
const db = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'root' })
const database = `dbm_autoshape_${process.pid}`
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

console.log('=== is a UNIQUE key enough, without PRIMARY? ===')
await attempt('no primary at all, AUTO_INCREMENT + UNIQUE', 'CREATE TABLE u1(a INT AUTO_INCREMENT UNIQUE)')
await attempt('primary on another column, AUTO_INCREMENT + UNIQUE', 'CREATE TABLE u2(a INT PRIMARY KEY, b INT AUTO_INCREMENT UNIQUE)')
await attempt('primary on another column, AUTO_INCREMENT + plain INDEX', 'CREATE TABLE u3(a INT PRIMARY KEY, b INT AUTO_INCREMENT, INDEX(b))')
await attempt('AUTO_INCREMENT with no key at all', 'CREATE TABLE u4(a INT PRIMARY KEY, b INT AUTO_INCREMENT)')

console.log('\n=== position inside a COMPOSITE key ===')
await attempt('auto column FIRST in the composite key', 'CREATE TABLE c1(a INT AUTO_INCREMENT, b INT, PRIMARY KEY(a,b))')
await attempt('auto column SECOND in the composite key', 'CREATE TABLE c2(a INT, b INT AUTO_INCREMENT, PRIMARY KEY(a,b))')
await attempt('auto column SECOND but also UNIQUE alone', 'CREATE TABLE c3(a INT, b INT AUTO_INCREMENT, PRIMARY KEY(a,b), UNIQUE(b))')

console.log('\n=== the type / engine requirements ===')
await attempt('BIGINT AUTO_INCREMENT', 'CREATE TABLE t1(a BIGINT AUTO_INCREMENT PRIMARY KEY)')
await attempt('SMALLINT AUTO_INCREMENT', 'CREATE TABLE t2(a SMALLINT AUTO_INCREMENT PRIMARY KEY)')
await attempt('DECIMAL AUTO_INCREMENT', 'CREATE TABLE t3(a DECIMAL(10,2) AUTO_INCREMENT PRIMARY KEY)')
await attempt('TEXT AUTO_INCREMENT', 'CREATE TABLE t4(a TEXT AUTO_INCREMENT PRIMARY KEY)')
await attempt('MyISAM AUTO_INCREMENT', 'CREATE TABLE t5(a INT AUTO_INCREMENT PRIMARY KEY) ENGINE=MyISAM')

// What does the panel's own rule need to express? Record the answer for a composite key.
console.log('\n=== what the server reports for a composite-key auto column ===')
await db.query('CREATE TABLE r1(a INT AUTO_INCREMENT, b INT, PRIMARY KEY(a,b))')
const [cols] = await db.query(`SELECT COLUMN_NAME, COLUMN_KEY, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='r1' ORDER BY ORDINAL_POSITION`)
console.log(' ', JSON.stringify(cols))
const [stats] = await db.query(`SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='r1' ORDER BY SEQ_IN_INDEX`)
console.log(' ', JSON.stringify(stats))

await db.query(`DROP DATABASE ${database}`)
await db.end()
console.log('\ncleaned up')
