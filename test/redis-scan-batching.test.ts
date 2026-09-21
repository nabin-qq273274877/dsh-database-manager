/**
 * A key level must be scanned in a number of round trips that survives latency.
 *
 * Why this file exists: a level scan timed out at 30 s against a production Redis
 * (830k keys, ~17 ms RTT) while the same data scanned in 3 s locally. The cause
 * was `TREE_SCAN_COUNT = 1000`, which divides a full traversal into 831 round
 * trips — measured at 24.8 s, only 5 s under the deadline. The batch size is a
 * LATENCY parameter, and treating it as a throughput one is what broke on a
 * remote server.
 *
 * These assertions are on the SHAPE of the scan (how many round trips it takes),
 * not on wall-clock time, so they hold on a fast machine and a slow one alike.
 */

import { describe, expect, it, vi } from 'vitest'
import { RedisDriver } from '../src/drivers/redis.ts'

/** A driver entry pointing anywhere; the client is stubbed before it is used. */
function entry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'stub', kind: 'redis' as const, name: 'stub', group: '', tags: [], description: '',
    host: '127.0.0.1', port: 6379, db: 0, readonly: false,
    createdAt: Date.now(), updatedAt: Date.now(),
    ...overrides,
  }
}

/**
 * A fake ioredis client whose SCAN returns `keys` across several batches.
 *
 * Records the COUNT of every SCAN so the test can assert how the traversal is
 * batched, which is the property that actually changed.
 */
function stubClient(totalKeys: number): { client: Record<string, unknown>; scanCounts: number[] } {
  const keys = Array.from({ length: totalKeys }, (_, i) => `jd:order:${i}`)
  const scanCounts: number[] = []
  let cursor = 0

  const client = {
    scan: vi.fn(async (at: string, _match: string, _pattern: string, _count: string, count: number) => {
      scanCounts.push(count)
      const from = Number(at) === 0 ? 0 : cursor
      // Honour COUNT, which is what makes the batch count meaningful.
      const slice = keys.slice(from, from + count)
      cursor = from + slice.length
      const next = cursor >= keys.length ? '0' : String(cursor)
      return [next, slice]
    }),
    dbsize: vi.fn(async () => keys.length),
    type: vi.fn(async () => 'none'),
    pipeline: vi.fn(() => {
      const results: Array<[null, unknown]> = []
      return {
        type: () => { results.push([null, 'string']); return undefined },
        ttl: () => { results.push([null, -1]); return undefined },
        exec: async () => results,
      }
    }),
  }
  return { client, scanCounts }
}

/** A driver whose Redis client is replaced by a stub. */
function driverWith(client: Record<string, unknown>): RedisDriver {
  const driver = new RedisDriver(entry() as never)
  // The private client cache is the seam; no network is involved.
  ;(driver as unknown as { clients: Map<number, unknown> }).clients.set(0, client)
  return driver
}

describe('level scan batching', () => {
  it('uses a batch size large enough to keep a remote scan inside its deadline', async () => {
    // 830k keys is the measured production size, and the number of batches is
    // what latency multiplies. At the old COUNT of 1000 this was 831 round trips
    // (24.8 s measured, against a 30 s budget); it must now be far fewer.
    const { client, scanCounts } = stubClient(830_000)
    const driver = driverWith(client)

    await driver.level({ db: 0, prefix: '', withTypes: false })

    const batches = scanCounts.length
    const batchSize = scanCounts[0]
    expect(batchSize).toBeGreaterThanOrEqual(10_000)
    // Round trips, not seconds: at 17 ms RTT each batch costs ~17 ms, so staying
    // under ~100 batches keeps one level's fetch near 1.5 s instead of ~14 s.
    // This now also reflects the key budget stopping the walk early — the two
    // limits point the same way, and either one holding keeps the call fast.
    expect(batches).toBeLessThanOrEqual(100)
  })

  it('a full traversal still completes, so counts remain exact', async () => {
    // A level must be walked completely: a partial pass produces a WRONG folder
    // count and can omit a folder entirely, which is worse than a slow answer. This
    // is the invariant that made the earlier 151142-vs-200000 bug possible.
    const { client } = stubClient(25_000)
    const driver = driverWith(client)

    const page = await driver.level({ db: 0, prefix: '', withTypes: false })

    expect(page.dbSize).toBe(25_000)
    expect(page.folders).toHaveLength(1)
    expect(page.folders[0]!.keys).toBe(25_000)
    expect(page.truncated).toBe(false)
  })

  it('walks a level of any size to the END, with no key budget', async () => {
    // The regression this pins: a 200k-key budget stopped the scan early, so a
    // 485k-key database reported "此处仅扫描了 200,012 个：目录可能不全，计数是下限"
    // — a correct warning about a defect, on the number a user reads before
    // deleting a folder. No size may now cut the walk short; the database size that
    // makes a complete pass too slow is served by the cached index instead.
    for (const total of [200_000, 485_073]) {
      const { client } = stubClient(total)
      const driver = driverWith(client)

      const page = await driver.level({ db: 0, prefix: '', withTypes: false })

      // Every key was visited, so the folder count is the level's true size.
      expect(page.folders).toHaveLength(1)
      expect(page.folders[0]!.keys).toBe(total)
      expect(page.truncated).toBe(false)
      expect(page.dbSize).toBe(total)
    }
  })

  it('never reports a capped level as a truncated directory listing', async () => {
    // `truncated` now means ONE thing: the row list was capped. It must not be set
    // by the scan's coverage, because the scan covers everything — conflating the
    // two is what let an incomplete folder list read as a display limit.
    const { client } = stubClient(300_000)
    const driver = driverWith(client)

    const page = await driver.level({ db: 0, prefix: '', withTypes: false })

    expect(page.keys.length).toBe(0)
    expect(page.keysAtLevel).toBe(0)
    // No keys at this level, so nothing was withheld — and the single folder holds
    // all 300k of them.
    expect(page.truncated).toBe(false)
    expect(page.folders[0]!.keys).toBe(300_000)
  })

  it('the dedup guard survives, so an at-least-once duplicate is not double-counted', async () => {
    // SCAN may return the same key twice while the hash table rehashes. Counting
    // occurrences as they stream would over-report, so the visited names are
    // retained and deduplicated. This asserts the guard still works after the
    // memory rework — a duplicate must not inflate a folder's count.
    const keys = ['jd:a', 'jd:b', 'jd:a', 'jd:c', 'jd:b']
    const client = {
      scan: (() => {
        let served = false
        return async () => {
          if (served) return ['0', []]
          served = true
          // The same five entries, two of them repeats.
          return ['42', keys]
        }
      })(),
      dbsize: async () => 3,
      // `jd` is a folder, not a key, so no own-key adjustment applies.
      type: async () => 'none',
    }
    const driver = driverWith(client)

    const page = await driver.level({ db: 0, prefix: '', withTypes: false })

    expect(page.folders).toHaveLength(1)
    expect(page.folders[0]!.name).toBe('jd')
    // Three DISTINCT keys, not the five entries the scan returned.
    expect(page.folders[0]!.keys).toBe(3)
  })

  it('scales the round-trip count linearly, not per key', async () => {
    // The point of the fix: batch count must be (keys / COUNT), not (keys).
    // A regression to a per-key scan would show up as thousands of SCAN calls.
    for (const total of [10_000, 50_000]) {
      const { client, scanCounts } = stubClient(total)
      const driver = driverWith(client)
      await driver.level({ db: 0, prefix: '', withTypes: false })
      expect(scanCounts.length).toBeLessThanOrEqual(Math.ceil(total / 10_000) + 1)
    }
  })
})

describe('scan timeout messages', () => {
  it('does not blame the handshake or TLS when a level scan times out', async () => {
    // The old text was shared by every operation and said the server "did not
    // complete the handshake", directing the reader to ports and TLS for what is
    // actually a too-large keyspace. The wording is asserted because it is the
    // only thing a user sees.
    //
    // Fake timers: the tree deadline has a 30 s floor, and waiting that long to
    // read a string would make the suite unusable. The timer is the seam, so
    // advancing it drives the real code path.
    vi.useFakeTimers()
    try {
      const hanging = {
        // A SCAN that never settles is the shape of a stalled large traversal.
        scan: () => new Promise(() => { /* never settles */ }),
        dbsize: async () => 1,
        type: async () => 'none',
      }
      const driver = new RedisDriver(entry({ connectTimeoutMs: 1000 }) as never)
      ;(driver as unknown as { clients: Map<number, unknown> }).clients.set(0, hanging)

      const pending = driver.level({ db: 0, prefix: '', withTypes: false })
        .catch((failure: unknown) => failure)
      // Let the async body reach the timer, then trip it.
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(31_000)

      const error = await pending
      expect(error).toBeInstanceOf(Error)
      const message = (error as Error).message
      expect(message).toMatch(/scanning a key level/)
      expect(message).toMatch(/timed out/)
      // The misleading parts must be gone from a scan timeout.
      expect(message).not.toMatch(/handshake/)
      expect(message).not.toMatch(/TLS/)
      // And it must point at the real cause and the lever that helps.
      expect(message).toMatch(/timeout setting/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the connection wording for an operation with no scan hint', async () => {
    // The connection case still deserves the connection explanation, so the hint
    // parameter must not have replaced it everywhere. `test()` races a PING and
    // passes no hint, so it keeps the default text.
    vi.useFakeTimers()
    try {
      const hanging = { ping: () => new Promise(() => { /* never settles */ }) }
      const driver = new RedisDriver(entry({ connectTimeoutMs: 800 }) as never)
      ;(driver as unknown as { clients: Map<number, unknown> }).clients.set(0, hanging)

      const pending = driver.test()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(2000)
      const outcome = await pending

      // `test()` reports a failed connection as a result rather than throwing.
      const message = (outcome as { error?: string }).error ?? ''
      expect(message).toMatch(/connecting to Redis/)
      expect(message).toMatch(/handshake/)
    } finally {
      vi.useRealTimers()
    }
  })
})
