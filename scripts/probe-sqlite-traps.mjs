import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * The SQLite "silent acceptance" traps, checked specifically.
 *
 * The previous probe showed SQLite ACCEPTING 'INT UNSIGNED' and 'COMMENT 'x''. That
 * is worse than refusing: the column ends up with a type NAME that contains the word
 * but no behaviour, so a panel that offered the attribute would produce a table the
 * user believes is unsigned. What each of these actually stored is the question here.
 */
const dir = mkdtempSync(join(tmpdir(), 'sqlite-trap-'))
const db = new DatabaseSync(join(dir, 'trap.db'))

const create = (table, definition) => {
  try {
    db.exec(`CREATE TABLE ${table}(${definition})`)
  } catch (error) {
    console.log(`\n${table}: ${definition}`)
    console.log(`  REFUSED: ${error.message}`)
    return
  }
  const info = db.prepare(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}')`).all()
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table).sql
  console.log(`\n${table}: ${definition}`)
  console.log(`  stored type: ${JSON.stringify(info.map(r => r.type))}`)
  console.log(`  notnull=${JSON.stringify(info.map(r => r.notnull))} pk=${JSON.stringify(info.map(r => r.pk))}`)
  console.log(`  sql: ${sql}`)
}

create('t_unsigned', 'x INT UNSIGNED')
create('t_zerofill', 'x INT ZEROFILL')
create('t_len', 'x VARCHAR(20)')
create('t_len_int', 'x INT(11)')
create('t_comment', "x INT COMMENT 'hello'")
create('t_comment_and_len', "x VARCHAR(20) COMMENT 'hi'")
create('t_collate', 'x TEXT COLLATE NOCASE')

console.log('\n=== does the stored collate actually take effect? ===')
db.exec('CREATE TABLE c1(v TEXT COLLATE NOCASE); CREATE TABLE c2(v TEXT)')
db.exec("INSERT INTO c1 VALUES ('ABC')")
db.exec("INSERT INTO c2 VALUES ('ABC')")
const nocase = db.prepare("SELECT COUNT(*) AS n FROM c1 WHERE v = 'abc'").get().n
const binary = db.prepare("SELECT COUNT(*) AS n FROM c2 WHERE v = 'abc'").get().n
console.log(`  COLLATE NOCASE match 'abc' vs 'ABC': ${nocase} (want 1)`)
console.log(`  default BINARY-ish match:              ${binary} (want 0)`)

console.log('\n=== is a column comment recoverable at all? ===')
// The comment went into the type name. Re-parsing it back is possible but it is NOT a
// comment: SQLite treats the whole thing as the type.
console.log(`  pragma type of t_comment: ${JSON.stringify(db.prepare("SELECT type FROM pragma_table_info('t_comment')").all())}`)

console.log('\n=== UNIQUE / composite behaviours ===')
db.exec('CREATE TABLE u1(a INT, b INT, UNIQUE(a,b))')
const indexList = db.prepare("SELECT name, \"unique\", origin FROM pragma_index_list('u1')").all()
console.log(`  pragma_index_list: ${JSON.stringify(indexList)}`)
for (const index of indexList) {
  console.log(`  ${index.name} columns: ${JSON.stringify(db.prepare(`SELECT name FROM pragma_index_info('${index.name}') ORDER BY seqno`).all().map(r => r.name))}`)
}

console.log('\n=== FULLTEXT alternative: FTS5 virtual table? ===')
try {
  db.exec("CREATE VIRTUAL TABLE fts USING fts5(body)")
  console.log('  FTS5 is available (a different object type, not an index on a normal table)')
  const type = db.prepare("SELECT type FROM sqlite_master WHERE name='fts'").get().type
  console.log(`  it is registered as type: ${type}`)
} catch (error) {
  console.log(`  FTS5 unavailable: ${error.message}`)
}

db.close()
rmSync(dir, { recursive: true, force: true })
console.log('\ncleaned up')
