/*
 * What do the two engines actually support for the requested create-table fields?
 *
 * Asked before designing, because several of these are conditional in ways that are
 * easy to get wrong from memory:
 *   - FULLTEXT / SPATIAL index support differs by engine and by column type;
 *   - SPATIAL requires the column to be NOT NULL;
 *   - UNSIGNED / ZEROFILL / BINARY are MySQL-only attributes;
 *   - 'on update CURRENT_TIMESTAMP' is only legal on a temporal type;
 *   - SQLite has per-column COLLATE but no engine, no table comment, and no FULLTEXT
 *     without an extension.
 *
 * Usage: node scripts/probe-create-table-capabilities.mjs <host:port:user:password>
 */
const connection = process.argv[2] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = connection.split(':')

const mysql = await import('mysql2/promise')
const db = await mysql.createConnection({ host, port: Number(port), user, password, multipleStatements: false })
const database = `dbm_caps_${process.pid}`
await db.query(`CREATE DATABASE ${database}`)
await db.query(`USE ${database}`)

const tryDdl = async (label, sql) => {
  try {
    await db.query(sql)
    console.log(`OK   ${label}`)
    return true
  } catch (error) {
    console.log(`FAIL ${label}\n       ${error.message}`)
    return false
  }
}

console.log('=== MySQL version / sql_mode ===')
const [[version]] = await db.query('SELECT VERSION() AS v, @@sql_mode AS m')
console.log(`  ${version.v}\n  sql_mode: ${version.m}\n`)

console.log('=== column attributes ===')
await tryDdl('UNSIGNED', `CREATE TABLE c1(a INT UNSIGNED)`)
await tryDdl('ZEROFILL (implies UNSIGNED)', `CREATE TABLE c2(a INT ZEROFILL)`)
await tryDdl('UNSIGNED ZEROFILL', `CREATE TABLE c3(a INT UNSIGNED ZEROFILL)`)
await tryDdl('BINARY attribute on VARCHAR', `CREATE TABLE c4(a VARCHAR(10) BINARY)`)
await tryDdl('BINARY attribute on CHAR', `CREATE TABLE c5(a CHAR(10) BINARY)`)
await tryDdl('BINARY attribute on INT (should fail)', `CREATE TABLE c6(a INT BINARY)`)
await tryDdl('on update CURRENT_TIMESTAMP on TIMESTAMP', `CREATE TABLE c7(a TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`)
await tryDdl('on update on DATETIME', `CREATE TABLE c8(a DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`)
await tryDdl('on update on INT (should fail)', `CREATE TABLE c9(a INT ON UPDATE CURRENT_TIMESTAMP)`)
await tryDdl('per-column COLLATE', `CREATE TABLE c10(a VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin)`)
await tryDdl('per-column COMMENT', `CREATE TABLE c11(a INT COMMENT 'hello')`)
await tryDdl('AUTO_INCREMENT inline', `CREATE TABLE c12(a INT NOT NULL AUTO_INCREMENT PRIMARY KEY)`)

console.log('\n=== index types ===')
await tryDdl('PRIMARY KEY (2 cols)', `CREATE TABLE i1(a INT, b INT, PRIMARY KEY(a,b))`)
await tryDdl('UNIQUE (2 cols, composite)', `CREATE TABLE i2(a INT, b INT, UNIQUE KEY uq_ab(a,b))`)
await tryDdl('INDEX (2 cols, composite)', `CREATE TABLE i3(a INT, b INT, INDEX ix_ab(a,b))`)
await tryDdl('FULLTEXT on VARCHAR (InnoDB)', `CREATE TABLE i4(a VARCHAR(200), FULLTEXT KEY ft_a(a))`)
await tryDdl('FULLTEXT on TEXT', `CREATE TABLE i5(a TEXT, FULLTEXT KEY ft_a(a))`)
await tryDdl('FULLTEXT on INT (should fail)', `CREATE TABLE i6(a INT, FULLTEXT KEY ft_a(a))`)
await tryDdl('SPATIAL on NOT NULL POINT', `CREATE TABLE i7(a POINT NOT NULL SRID 0, SPATIAL KEY sp_a(a))`)
await tryDdl('SPATIAL on nullable POINT (should fail)', `CREATE TABLE i8(a POINT NULL, SPATIAL KEY sp_a(a))`)
await tryDdl('named index with explicit type USING BTREE', `CREATE TABLE i9(a INT, INDEX ix_a(a) USING BTREE)`)

console.log('\n=== table options ===')
await tryDdl('ENGINE + COLLATE + COMMENT', `CREATE TABLE t1(a INT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='表注释'`)
const [[t1]] = await db.query(`SELECT ENGINE, TABLE_COLLATION, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='t1'`)
console.log(`       engine=${t1.ENGINE} collation=${t1.TABLE_COLLATION} comment=${JSON.stringify(t1.TABLE_COMMENT)}`)
await tryDdl('RENAME TABLE', `RENAME TABLE ${database}.t1 TO ${database}.t1b`)

// What engines does this server offer?
const [engines] = await db.query('SELECT ENGINE, SUPPORT FROM information_schema.ENGINES ORDER BY ENGINE')
console.log(`\n  engines available: ${engines.map(e => `${e.ENGINE}(${e.SUPPORT})`).join(' ')}`)

// Does a composite index preserve order?
await db.query(`CREATE TABLE iorder(a INT, b INT, INDEX ix(a,b))`)
const [idx] = await db.query(`SELECT COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='iorder' AND INDEX_NAME='ix' ORDER BY SEQ_IN_INDEX`)
console.log(`  composite index order: ${idx.map(r => `${r.SEQ_IN_INDEX}=${r.COLUMN_NAME}`).join(' ')}`)

await db.query(`DROP DATABASE ${database}`)
await db.end()
console.log('\ncleaned up')
