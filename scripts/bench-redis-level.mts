/**
 * Benchmark the Redis level scanner against a real database.
 *
 * Exists because the previous whole-keyspace design failed on production-sized
 * data (a 480k-key database produced a capped 20k tree after a per-key TYPE/TTL
 * round trip each). This measures the replacement directly: time and payload for
 * one level of a large database, so a regression shows up as numbers rather than
 * as "it felt slow".
 *
 * Usage: npx tsx scripts/bench-redis-level.ts [port] [db] [prefix]
 */

const { RedisDriver } = await import('../src/drivers/redis.ts')

const port = Number(process.argv[2] ?? 6379)
const db = Number(process.argv[3] ?? 1)
const prefix = process.argv[4] ?? ''

const entry = {
  id: 'bench', kind: 'redis', name: 'bench', group: '', tags: [], description: '',
  host: '127.0.0.1', port, db, readonly: false, connectTimeoutMs: 30000,
  createdAt: Date.now(), updatedAt: Date.now(),
}

const driver = new RedisDriver(entry)
try {
  const info = await driver.info()
  const inDb = info.databases.find(item => item.db === db)?.keys ?? 0
  console.log(`db${db}: ${inDb} keys total`)

  for (const withTypes of [false, true]) {
    const started = Date.now()
    const page = await driver.level({ db, prefix, withTypes })
    const elapsed = Date.now() - started
    const bytes = Buffer.byteLength(JSON.stringify(page))
    console.log(
      `level prefix=${JSON.stringify(prefix)} withTypes=${withTypes}: ` +
      `${elapsed} ms, ${page.folders.length} folders, ${page.keys.length} keys, ` +
      `${(bytes / 1024).toFixed(1)} KiB, truncated=${page.truncated}`,
    )
    if (page.folders.length > 0) {
      const top = [...page.folders].sort((a, b) => b.keys - a.keys).slice(0, 5)
      console.log(`  largest: ${top.map(f => `${f.name}=${f.keys}`).join(', ')}`)
    }
  }

  // Expanding one of the biggest folders is the operation a user actually
  // triggers by clicking, so it must also be quick.
  const first = await driver.level({ db, prefix, withTypes: false })
  const biggest = [...first.folders].sort((a, b) => b.keys - a.keys)[0]
  if (biggest !== undefined) {
    const started = Date.now()
    const page = await driver.level({ db, prefix: biggest.path, withTypes: true })
    console.log(
      `expand ${JSON.stringify(biggest.path)}: ${Date.now() - started} ms, ` +
      `${page.folders.length} folders, ${page.keys.length} keys, truncated=${page.truncated}`,
    )
  }
} catch (error) {
  console.error('BENCH ERROR:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await driver.close()
}
