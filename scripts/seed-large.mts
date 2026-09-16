/**
 * Seed a LOCAL Redis database with a large number of keys, for index verification.
 *
 * Uses pipelined SET commands rather than `DEBUG POPULATE`, which a stock Redis
 * refuses unless `enable-debug-command` is set. Pipelines keep it to one round trip
 * per batch, so a million keys takes a few seconds instead of minutes.
 *
 * LOCAL ONLY. This writes a large number of keys, which is exactly the kind of load
 * that must never be applied to a shared or production server (see AGENTS.md).
 *
 * Usage: npx tsx scripts/seed-large.mts <port> <db> <count> <prefix>
 */

const { default: Redis } = await import('ioredis')

const [portArg, dbArg, countArg, prefix] = process.argv.slice(2)
if (portArg === undefined || dbArg === undefined || countArg === undefined) {
  console.error('usage: npx tsx scripts/seed-large.mts <port> <db> <count> <prefix>')
  process.exit(2)
}
const port = Number(portArg)
const db = Number(dbArg)
const count = Number(countArg)
const root = prefix ?? 'seed'

const client = new Redis(port, '127.0.0.1', { db, maxRetriesPerRequest: 2 })
client.on('error', () => { /* surfaced by the failing command */ })

/** Shapes the keys the way a real keyspace looks, so the tree has something to show. */
function keyFor(i: number): string {
  const shape = i % 10
  if (shape === 0) return `${root}:order:${i}`
  if (shape === 1) return `${root}:user:${i}`
  if (shape === 2) return `${root}:order:item:${i}`
  if (shape === 3) return `${root}:deep:nested:leaf:${i}`
  if (shape === 4) return `${root}:top-${i}`
  if (shape === 5) return `other:${root}:${i}`
  if (shape === 6) return `${root}:rare:${i}`
  if (shape === 7) return `plain-${i}`
  if (shape === 8) return `${root}:order:item:sub:${i}`
  return `${root}:misc:${i}`
}

try {
  const started = Date.now()
  await client.flushdb()
  const BATCH = 10_000
  for (let from = 0; from < count; from += BATCH) {
    const pipeline = client.pipeline()
    const to = Math.min(from + BATCH, count)
    for (let i = from; i < to; i++) pipeline.set(keyFor(i), 'v')
    await pipeline.exec()
    if (from % 200_000 === 0 && from > 0) {
      console.log(`  ${from.toLocaleString('en-US')} keys, ${((Date.now() - started) / 1000).toFixed(1)}s`)
    }
  }
  const size = await client.dbsize()
  console.log(`seeded db${db} on 127.0.0.1:${port}: DBSIZE=${size} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
} catch (error) {
  console.error('SEED ERROR:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  client.disconnect()
}
