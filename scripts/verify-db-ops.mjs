/*
 * Exercise the new host operations against real servers and verify the EFFECT.
 *
 * The UI E2E proves the buttons are wired; this proves the operations do what they
 * claim. Every step is checked against the server's own state — a batch empty that
 * reports success without emptying, or a copy that loses rows, is exactly the kind of
 * failure a UI-level assertion cannot see.
 *
 * Usage: node scripts/verify-db-ops.mjs <baseUrl> <host:port:user:password>
 */
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = connection.split(':')

const api = async (path, options) => {
  const response = await fetch(`${baseUrl}${path}`, options)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${body && body.error ? body.error : 'no body'}`)
  return body
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail === undefined ? '' : ' → ' + JSON.stringify(detail)}`)
}

const tag = process.pid
const sourceName = `Verify Ops ${tag}`
const db = `dbm_verify_${tag}`
const copy = `${db}_copy`
const renamed = `${db}_ren`
const fresh = `dbm_fresh_${tag}`
const created = [db, copy, renamed, fresh]

const source = (await post('/api/dsh-database/sources', {
  kind: 'mysql', name: sourceName, host, port: Number(port), user, password,
})).source
console.log(`source ${source.id}, database ${db}\n`)

try {
  // ---- create -------------------------------------------------------------
  await post(`/api/dsh-database/sources/${source.id}/database`, { op: 'create', name: db, charset: 'utf8mb4' })
  const schemas = (await api(`/api/dsh-database/sources/${source.id}/schemas`)).schemas.map(s => s.name)
  check('create made the database', schemas.includes(db), { want: db, has: schemas.includes(db) })

  // A second create with the same name must fail rather than silently succeed.
  let duplicate = null
  try { await post(`/api/dsh-database/sources/${source.id}/database`, { op: 'create', name: db }) } catch (error) { duplicate = String(error) }
  check('creating a duplicate name is refused', duplicate !== null, duplicate)

  // ---- make some tables ---------------------------------------------------
  await post(`/api/dsh-database/sources/${source.id}/query`, {
    sql: `CREATE TABLE ${db}.alpha(id INT PRIMARY KEY, v VARCHAR(10))`, allowWrite: true,
  })
  await post(`/api/dsh-database/sources/${source.id}/query`, {
    sql: `INSERT INTO ${db}.alpha VALUES (1,'a'),(2,'b'),(3,'c')`, allowWrite: true,
  })
  await post(`/api/dsh-database/sources/${source.id}/query`, {
    sql: `CREATE TABLE ${db}.beta(id INT PRIMARY KEY, v VARCHAR(10))`, allowWrite: true,
  })
  await post(`/api/dsh-database/sources/${source.id}/query`, {
    sql: `INSERT INTO ${db}.beta VALUES (1,'x')`, allowWrite: true,
  })

  /** Count the rows of a table through the panel's own read path. */
  const rowCount = async (database, table) => {
    const page = await api(`/api/dsh-database/sources/${source.id}/rows?schema=${database}&table=${table}&page=1&pageSize=10&mode=browse`)
    return page.page.total
  }

  // ---- maintenance --------------------------------------------------------
  const support = (await api(`/api/dsh-database/sources/${source.id}/maintenance-support`)).support
  check('maintenance support is reported', support.length === 4, support)

  const checked = (await post(`/api/dsh-database/sources/${source.id}/maintain`, { schema: db, tables: ['alpha', 'beta'], op: 'check' })).results
  check('check reports per table', checked.length === 2 && checked.every(r => r.ok), checked.map(r => r.table))
  check('check carries the server messages', checked.every(r => r.messages.length > 0), checked[0].messages)

  // REPAIR on InnoDB answers with a NOTE saying the engine cannot repair: it must NOT
  // be reported as an error, and the message must survive to the caller.
  const repaired = (await post(`/api/dsh-database/sources/${source.id}/maintain`, { schema: db, tables: ['alpha'], op: 'repair' })).results
  check('repair on InnoDB reports the engine note rather than failing', repaired[0].ok === true && repaired[0].messages.some(m => /doesn't support repair|does not support repair/i.test(m)), repaired[0].messages)

  const analyzed = (await post(`/api/dsh-database/sources/${source.id}/maintain`, { schema: db, tables: ['alpha', 'beta'], op: 'analyze' })).results
  check('analyze reports per table', analyzed.length === 2, analyzed.map(r => r.table))

  // an unsupported op must be refused before any table is touched
  let refused = null
  try { await post(`/api/dsh-database/sources/${source.id}/maintain`, { schema: db, tables: ['alpha'], op: 'vacuum' }) } catch (error) { refused = String(error) }
  check('an unknown maintenance op is refused', refused !== null, refused)

  // ---- batch empty --------------------------------------------------------
  const beforeAlpha = await rowCount(db, 'alpha')
  await api(`/api/dsh-database/sources/${source.id}/rows/delete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
  // Empty through the same route the batch bar uses.
  await post(`/api/dsh-database/sources/${source.id}/table`, { schema: db, table: 'alpha', op: 'truncate' })
  const afterAlpha = await rowCount(db, 'alpha')
  check('batch empty actually removed the rows', beforeAlpha === 3 && afterAlpha === 0, { beforeAlpha, afterAlpha })
  check('the emptied table still exists', (await api(`/api/dsh-database/sources/${source.id}/tables?schema=${db}`)).tables.some(t => t.name === 'alpha'))

  // ---- copy ---------------------------------------------------------------
  await post(`/api/dsh-database/sources/${source.id}/database`, { op: 'copy', name: copy, from: db, includeData: true })
  const copiedTables = (await api(`/api/dsh-database/sources/${source.id}/tables?schema=${copy}`)).tables.map(t => t.name).sort()
  check('copy brought the tables over', copiedTables.join(',') === 'alpha,beta', copiedTables)
  check('copy brought the rows over', await rowCount(copy, 'beta') === 1, { rows: await rowCount(copy, 'beta') })

  // A structure-only copy must NOT have the rows.
  const structureOnly = `${copy}_s`
  created.push(structureOnly)
  await post(`/api/dsh-database/sources/${source.id}/database`, { op: 'copy', name: structureOnly, from: db, includeData: false })
  check('a structure-only copy has no rows', await rowCount(structureOnly, 'beta') === 0, { rows: await rowCount(structureOnly, 'beta') })

  // ---- rename -------------------------------------------------------------
  await post(`/api/dsh-database/sources/${source.id}/database`, { op: 'rename', name: renamed, from: db })
  const afterRename = (await api(`/api/dsh-database/sources/${source.id}/schemas`)).schemas.map(s => s.name)
  check('rename created the new database', afterRename.includes(renamed), { has: afterRename.includes(renamed) })
  check('rename removed the old database', !afterRename.includes(db), { oldStillThere: afterRename.includes(db) })
  check('rename carried the tables', (await api(`/api/dsh-database/sources/${source.id}/tables?schema=${renamed}`)).tables.length === 2)
  check('rename carried the rows', await rowCount(renamed, 'beta') === 1)

  // ---- charset ------------------------------------------------------------
  await post(`/api/dsh-database/sources/${source.id}/database`, { op: 'charset', name: fresh, from: fresh, charset: 'utf8mb4', collate: 'utf8mb4_general_ci' }).catch(() => {})
  await post(`/api/dsh-database/sources/${source.id}/database`, { op: 'create', name: fresh, charset: 'utf8mb4', collate: 'utf8mb4_general_ci' })
  await post(`/api/dsh-database/sources/${source.id}/database`, { op: 'charset', name: fresh, from: fresh, charset: 'latin1', collate: 'latin1_swedish_ci' })
  const charsetQuery = await post(`/api/dsh-database/sources/${source.id}/query`, {
    sql: "SELECT DEFAULT_CHARACTER_SET_NAME AS cs FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '" + fresh + "'",
  })
  check('charset change reached the server', String(charsetQuery.result.rows[0][0]) === 'latin1', charsetQuery.result.rows[0])

  let badCharset = null
  try { await post(`/api/dsh-database/sources/${source.id}/database`, { op: 'charset', name: fresh, from: fresh, charset: 'not a charset' }) } catch (error) { badCharset = String(error) }
  check('an invalid character set is refused', badCharset !== null, badCharset)
} finally {
  for (const database of created) {
    await fetch(`${baseUrl}/api/dsh-database/sources/${source.id}/database`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'drop', name: database }),
    }).catch(() => {})
  }
  await fetch(`${baseUrl}/api/dsh-database/sources/${source.id}`, { method: 'DELETE' }).catch(() => {})
  console.error(`note: dropped ${created.join(', ')} and removed the source`)
}

const failed = checks.filter(entry => !entry.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
