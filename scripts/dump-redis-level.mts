/**
 * Print one level of the tree, to inspect the scanner's output by eye.
 *
 * Usage: npx tsx scripts/dump-redis-level.mts [port] [db] [prefix]
 */

const { RedisDriver } = await import('../src/drivers/redis.ts')

const port = Number(process.argv[2] ?? 6379)
const db = Number(process.argv[3] ?? 1)
const prefix = process.argv[4] ?? ''

const entry = {
  id: 'dump', kind: 'redis', name: 'dump', group: '', tags: [], description: '',
  host: '127.0.0.1', port, db, readonly: false, connectTimeoutMs: 30000,
  createdAt: Date.now(), updatedAt: Date.now(),
}

const driver = new RedisDriver(entry)
try {
  const started = Date.now()
  const page = await driver.level({ db, prefix, withTypes: true })
  console.log(`prefix=${JSON.stringify(prefix)} in ${Date.now() - started} ms`)
  console.log(`dbSize=${page.dbSize} keysAtLevel=${page.keysAtLevel} truncated=${page.truncated}`)
  console.log(`folders (${page.folders.length}):`)
  for (const folder of page.folders) console.log(`  ${folder.path}  -> ${folder.keys} keys`)
  console.log(`keys (${page.keys.length}):`)
  for (const key of page.keys.slice(0, 20)) console.log(`  ${key.key}  [${key.type}] ttl=${key.ttl}`)
  if (page.keys.length > 20) console.log(`  … ${page.keys.length - 20} more`)
} catch (error) {
  console.error('ERROR:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await driver.close()
}
