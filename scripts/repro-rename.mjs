/*
 * Reproduce the two reported bugs against a real MySQL server, before touching code.
 *
 * Reported:
 *   1. after 重命名 the original database is still there;
 *   3. (for reference) 修改字符集 does not prefill the current charset.
 *
 * Both a database WITH tables and an EMPTY one are tried, because they take different
 * branches in the driver and only one of them may be broken. Guessing which would
 * risk fixing the wrong path.
 *
 * Usage: node scripts/repro-rename.mjs <baseUrl> <host:port:user:password>
 */
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = connection.split(':')

const request = async (path, options) => {
  const response = await fetch(`${baseUrl}${path}`, options)
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}
const post = (path, body) => request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const tag = process.pid
const source = (await post('/api/dsh-database/sources', {
  kind: 'mysql', name: `Repro Rename ${tag}`, host, port: Number(port), user, password,
})).body.source
const id = source.id
console.log(`source ${id}\n`)

const schemas = async () => {
  const { body } = await request(`/api/dsh-database/sources/${id}/schemas`)
  return body.schemas.map(entry => entry.name)
}
const tablesOf = async database => {
  const { body } = await request(`/api/dsh-database/sources/${id}/tables?schema=${encodeURIComponent(database)}`)
  return body.tables === undefined ? null : body.tables.map(entry => entry.name)
}
const write = (sql) => post(`/api/dsh-database/sources/${id}/query`, { sql, allowWrite: true })

/** Try one rename and report what the server actually holds afterwards. */
const tryRename = async (label, database, newName, seed) => {
  console.log(`--- ${label}: ${database} -> ${newName} ---`)
  await post(`/api/dsh-database/sources/${id}/database`, { op: 'create', name: database })
  if (seed) {
    await write(`CREATE TABLE ${database}.t1(id INT PRIMARY KEY, v VARCHAR(10))`)
    await write(`INSERT INTO ${database}.t1 VALUES (1,'a'),(2,'b')`)
    await write(`CREATE TABLE ${database}.t2(id INT PRIMARY KEY)`)
  }
  const before = await tablesOf(database)
  console.log(`  before: ${database} has ${before === null ? '??' : before.length} table(s) ${JSON.stringify(before)}`)

  const renamed = await post(`/api/dsh-database/sources/${id}/database`, { op: 'rename', name: newName, from: database })
  console.log(`  rename response: ${renamed.status}${renamed.body && renamed.body.error ? ' — ' + renamed.body.error : ''}`)

  const all = await schemas()
  const oldThere = all.includes(database)
  const newThere = all.includes(newName)
  const newTables = newThere ? await tablesOf(newName) : null
  console.log(`  after: old present=${oldThere}  new present=${newThere}  new tables=${JSON.stringify(newTables)}`)
  console.log(`  VERDICT: ${oldThere ? 'BUG — the original database is still there' : 'ok — the original is gone'}`)
  console.log()
  return { oldThere, newThere, newTables }
}

const withTables = `dbm_repro_${tag}_a`
const withTablesNew = `dbm_repro_${tag}_a_renamed`
const empty = `dbm_repro_${tag}_b`
const emptyNew = `dbm_repro_${tag}_b_renamed`

const results = {}
try {
  results.withTables = await tryRename('database WITH tables', withTables, withTablesNew, true)
  results.empty = await tryRename('EMPTY database', empty, emptyNew, false)

  // Does the moved data survive?
  if (results.withTables.newThere) {
    const rows = await post(`/api/dsh-database/sources/${id}/query`, { sql: `SELECT COUNT(*) FROM ${withTablesNew}.t1` })
    console.log(`  data check: ${withTablesNew}.t1 has ${rows.body === null ? '?' : JSON.stringify(rows.body.result.rows)} row(s)`)
  }

  console.log('\n=== SUMMARY ===')
  console.log(JSON.stringify(results, null, 2))
} finally {
  for (const database of [withTables, withTablesNew, empty, emptyNew]) {
    await post(`/api/dsh-database/sources/${id}/database`, { op: 'drop', name: database })
  }
  await request(`/api/dsh-database/sources/${id}`, { method: 'DELETE' })
  console.error('note: cleaned up the run\'s databases and source')
}
