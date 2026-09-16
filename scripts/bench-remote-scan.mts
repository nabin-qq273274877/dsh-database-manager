/**
 * Measure a REMOTE key space safely: latency, size, and how COUNT affects the
 * number of SCAN round trips.
 *
 * A level scan's floor is (number of SCAN batches) x (round-trip latency). On a
 * local instance the latency term is negligible, which is why a database that
 * scans in 3 s locally can time out at 30 s remotely. This measures both terms
 * and the effect of raising COUNT, because COUNT is the one lever that reduces
 * the batch count without changing what is scanned.
 *
 * Every command here is read-only: PING, DBSIZE, and SCAN. Nothing is written and
 * no key is fetched, so it is safe to point at a production server.
 *
 * Usage: npx tsx scripts/bench-remote-scan.mts <host> <port> <db> [password] [--full]
 *   --full also walks the whole keyspace (read-only) to time it end to end.
 */

const { default: Redis } = await import('ioredis')

const argv = process.argv.slice(2)
const full = argv.includes('--full')
const [host, portArg, dbArg, password] = argv.filter(a => a !== '--full')
if (host === undefined || portArg === undefined || dbArg === undefined) {
  console.error('usage: npx tsx scripts/bench-remote-scan.mts <host> <port> <db> [password] [--full]')
  process.exit(2)
}
const port = Number(portArg)
const db = Number(dbArg)

const client = new Redis(port, host, {
  ...(password === undefined ? {} : { password }),
  db,
  connectTimeout: 30000,
  maxRetriesPerRequest: 2,
  retryStrategy: (attempt: number) => (attempt > 3 ? null : Math.min(attempt * 200, 1000)),
})
client.on('error', () => { /* surfaced by the failing command */ })

try {
  console.log(`target ${host}:${port}/db${db}`)

  // 1. Round-trip latency. This is the multiplier on every SCAN batch.
  const pings: number[] = []
  for (let i = 0; i < 10; i++) {
    const started = Date.now()
    await client.ping()
    pings.push(Date.now() - started)
  }
  pings.sort((a, b) => a - b)
  const median = pings[Math.floor(pings.length / 2)]!
  console.log(`PING median ${median} ms (min ${pings[0]} max ${pings[pings.length - 1]})`)

  // 2. Size. DBSIZE is O(1), so this is safe on any server.
  const dbSize = await client.dbsize()
  console.log(`DBSIZE ${dbSize}`)

  /**
   * Count the SCAN batches a full pass needs at one COUNT.
   *
   * COUNT is a hint, not a page size: Redis may return more or fewer than COUNT
   * entries per reply, so the batch count is measured rather than divided out of
   * the size.
   */
  const batchesFor = async (count: number): Promise<{ batches: number; ms: number }> => {
    const started = Date.now()
    let cursor = '0'
    let batches = 0
    do {
      const [next] = await client.scan(cursor, 'MATCH', '*', 'COUNT', count)
      cursor = String(next)
      batches++
      if (batches > 50000) break
    } while (cursor !== '0')
    return { batches, ms: Date.now() - started }
  }

  if (full) {
    console.log('\nfull pass (read-only) at each COUNT:')
    for (const count of [1000, 10000, 50000]) {
      const { batches, ms } = await batchesFor(count)
      const projected = batches * median
      console.log(
        `  COUNT ${String(count).padStart(6)}: ${String(batches).padStart(5)} batches, ${String(ms).padStart(6)} ms wall, ` +
        `~${(projected / 1000).toFixed(1)} s at median RTT` +
        (projected > 30000 ? '  EXCEEDS 30 s' : ''),
      )
    }
  } else {
    // Without walking, estimate the batch count from the size: a SCAN reply
    // typically returns about COUNT entries.
    console.log('\nestimated batches by COUNT (no traversal; pass --full to measure):')
    for (const count of [1000, 10000, 50000]) {
      const estimated = Math.ceil(dbSize / count)
      const projected = estimated * median
      console.log(
        `  COUNT ${String(count).padStart(6)}: ~${String(estimated).padStart(5)} batches, ` +
        `~${(projected / 1000).toFixed(1)} s at median RTT` +
        (projected > 30000 ? '  EXCEEDS 30 s' : ''),
      )
    }
  }
} catch (error) {
  console.error('BENCH ERROR:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  client.disconnect()
}
