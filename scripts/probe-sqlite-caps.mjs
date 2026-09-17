import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * What does SQLite support for the requested create-table fields?
 *
 * The interesting part is what it does NOT support: SQLite has no storage engine, no
 * table comment, no FULLTEXT/SPATIAL index types without an extension. And the parts
 * it does support often behave by ACCEPTING anything — a type name is just a string,
 * so 'INT(11) UNSIGNED' parses and is silently ignored rather than refused. Worth
 * measuring, because the panel must decide what to offer and what to say it cannot.
 */
const dir = mkdtempSync(join(tmpdir(), 'sqlite-caps-'))
const db = new DatabaseSync(join(dir, 'caps.db'))

const attempt = (label, run) => {
  try {
    const value = run()
    const shown = value === undefined ? 'undefined' : JSON.stringify(value).slice(0, 220)
    console.log(`OK   ${label}\n       ${shown}`)
    return true
  } catch (error) {
    console.log(`FAIL ${label}\n       ${error.message}`)
    return false
  }
}

console.log('=== version / features ===')
attempt('sqlite_version', () => db.prepare('SELECT sqlite_version() AS v').all())

console.log('\n=== column attributes (MySQL-only ones) ===')
attempt('UNSIGNED is accepted?', () => db.exec('CREATE TABLE a1(x INT UNSIGNED)'))
attempt('ZEROFILL accepted?', () => db.exec('CREATE TABLE a2(x INT ZEROFILL)'))
attempt('BINARY attribute accepted?', () => db.exec('CREATE TABLE a3(x VARCHAR(10) BINARY)'))
attempt('ON UPDATE accepted?', () => db.exec('CREATE TABLE a4(x TEXT ON UPDATE CURRENT_TIMESTAMP)'))
attempt('type with length INT(11)', () => db.exec('CREATE TABLE a5(x INT(11))'))
attempt('type with length+unsigned VARCHAR(20)', () => db.exec('CREATE TABLE a6(x VARCHAR(20))'))
// What did the type become? This is the point: no error does not mean it was honoured.
const shape = db.prepare("SELECT name, type FROM pragma_table_info('a5')").all()
console.log(`       stored type for INT(11): ${JSON.stringify(shape)}`)
const shape6 = db.prepare("SELECT name, type FROM pragma_table_info('a6')").all()
console.log(`       stored type for VARCHAR(20): ${JSON.stringify(shape6)}`)

console.log('\n=== things SQLite genuinely has ===')
attempt('per-column COLLATE', () => db.exec('CREATE TABLE b1(x TEXT COLLATE NOCASE)'))
const coll = db.prepare("SELECT name, type FROM pragma_table_info('b1')").all()
console.log(`       with collate: ${JSON.stringify(coll)}`)
attempt('inline COMMENT is NOT valid SQL', () => db.exec("CREATE TABLE b2(x INT COMMENT 'hello')"))
attempt('inline PRIMARY KEY', () => db.exec('CREATE TABLE b3(x INTEGER PRIMARY KEY AUTOINCREMENT)'))
attempt('composite PRIMARY KEY as table constraint', () => db.exec('CREATE TABLE b4(a INT, b INT, PRIMARY KEY(a,b))'))
attempt('UNIQUE table constraint (composite)', () => db.exec('CREATE TABLE b5(a INT, b INT, UNIQUE(a,b))'))
attempt('CHECK constraint', () => db.exec('CREATE TABLE b6(a INT CHECK(a > 0))'))

console.log('\n=== index types ===')
attempt('plain CREATE INDEX', () => db.exec('CREATE TABLE i1(a INT, b INT); CREATE INDEX ix_ab ON i1(a,b)'))
attempt('CREATE UNIQUE INDEX', () => db.exec('CREATE TABLE i2(a INT, b INT); CREATE UNIQUE INDEX uq_ab ON i2(a,b)'))
attempt('FULLTEXT index (should fail without extension)', () => db.exec('CREATE TABLE i3(a TEXT); CREATE FULLTEXT INDEX ft ON i3(a)'))
attempt('SPATIAL index (should fail without extension)', () => db.exec('CREATE TABLE i4(a BLOB); CREATE SPATIAL INDEX sp ON i4(a)'))
attempt('index with DESC', () => db.exec('CREATE TABLE i5(a INT); CREATE INDEX ix_desc ON i5(a DESC)'))
attempt('partial index WHERE', () => db.exec('CREATE TABLE i6(a INT, b INT); CREATE INDEX ix_part ON i6(a) WHERE b > 0'))
attempt('expression index', () => db.exec("CREATE TABLE i7(a TEXT); CREATE INDEX ix_lower ON i7(lower(a))"))
// Does the composite order survive?
attempt('composite index order', () => db.prepare("SELECT name, seqno, cid FROM pragma_index_info('ix_ab') ORDER BY seqno").all())

console.log('\n=== table WITH-clause (SQLite has no ENGINE) ===')
attempt('WITHOUT ROWID', () => db.exec('CREATE TABLE w1(a TEXT PRIMARY KEY, b INT) WITHOUT ROWID'))
attempt('STRICT', () => db.exec('CREATE TABLE w2(a INT) STRICT'))
attempt('ENGINE= (should fail)', () => db.exec('CREATE TABLE w3(a INT) ENGINE=InnoDB'))
attempt('COMMENT= (should fail)', () => db.exec("CREATE TABLE w4(a INT) COMMENT='x'"))
attempt('table-level COLLATE (should fail)', () => db.exec('CREATE TABLE w5(a INT) COLLATE=utf8mb4_bin'))

console.log('\n=== is a table comment storable at all? ===')
// No comment storage, but is there a way to attach one? A convention used elsewhere.
attempt('sqlite_master holds only the SQL text', () => db.prepare("SELECT sql FROM sqlite_master WHERE name='a1'").all())

db.close()
rmSync(dir, { recursive: true, force: true })
console.log('\ncleaned up')
