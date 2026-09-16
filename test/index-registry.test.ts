/**
 * Index registry tests: the walk's lifecycle, with a stubbed batch source.
 *
 * The registry is where the load on a Redis server is decided, so its behaviour is
 * worth pinning rather than trusting. What these tests hold down:
 *
 *  - a walk advances in bounded steps rather than one request, so a huge database
 *    does not hold the caller open (the failure that made the first design unusable);
 *  - starting twice does NOT start a second traversal, which would double the load a
 *    user can inflict by clicking twice;
 *  - a server without scripting is reported as an error instead of presenting an
 *    empty tree, because "no folders" and "could not find out" are different answers;
 *  - cancelling stops the loop, so leaving the panel does not leave a walk running.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexRegistry } from '../src/index-registry.ts'
import type { IndexBatchSource } from '../src/redis-index.ts'

/**
 * A batch source that walks a fixed set of keys, in pages of `pageSize`.
 *
 * Mirrors the real contract: a cursor in, a cursor out, `'0'` at the end. Duplicating
 * an entry would be wrong (the walk would loop forever), so the cursor is an index
 * into the array.
 */
function stubSource(keys: readonly string[], pageSize = 10): {
  source: IndexBatchSource
  calls: () => number
} {
  let calls = 0
  const source: IndexBatchSource = {
    async aggregateBatch({ cursor, batchKeys }) {
      calls++
      const from = cursor === '0' ? 0 : Number(cursor)
      // Honour whichever bound is smaller, since the real script stops at the batch
      // limit even when its COUNT hint would have returned more.
      const take = Math.min(pageSize, batchKeys, keys.length - from)
      if (take <= 0) return { cursor: '0', visited: 0, folderDeltas: new Map(), directCounts: new Map(), leaves: new Map() }

      const page = keys.slice(from, from + take)
      const folderDeltas = new Map<string, number>()
      const directCounts = new Map<string, number>()
      const leaves = new Map<string, string[]>()
      for (const key of page) {
        const segments = key.split(':')
        // Count into every proper prefix, as the Lua script does.
        for (let i = 1; i < segments.length; i++) {
          const ancestor = segments.slice(0, i).join(':')
          folderDeltas.set(ancestor, (folderDeltas.get(ancestor) ?? 0) + 1)
        }
        const parent = segments.slice(0, -1).join(':')
        const leaf = segments[segments.length - 1]!
        directCounts.set(parent, (directCounts.get(parent) ?? 0) + 1)
        const held = leaves.get(parent)
        if (held === undefined) leaves.set(parent, [leaf])
        else held.push(leaf)
      }
      const next = from + take
      return {
        cursor: next >= keys.length ? '0' : String(next),
        visited: take,
        folderDeltas,
        directCounts,
        leaves,
      }
    },
  }
  return { source, calls: () => calls }
}

/** Wait until a predicate holds, or fail — the walk is asynchronous and detached. */
async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition never became true')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('IndexRegistry', () => {
  it('walks the keyspace in bounded steps and reports progress', async () => {
    const keys = Array.from({ length: 100 }, (_, i) => `jd:order:${i}`)
    const { source } = stubSource(keys, 10)
    const registry = new IndexRegistry(async () => source)

    const index = await registry.start('src', 0, keys.length)
    expect(index.visited).toBe(0)

    await until(() => registry.get('src', 0)!.done)

    const progress = registry.progressOf('src', 0)!
    expect(progress.done).toBe(true)
    expect(progress.visited).toBe(100)
    expect(progress.dbSize).toBe(100)
    // Two folders: `jd` and `jd:order` (the level the keys actually sit at). The
    // synthetic root is excluded, which is why this is 2 and not 3.
    expect(progress.folders).toBe(2)
  })

  it('does not start a second walk when asked twice, so a double click cannot double the load', () => {
    // The load is the whole reason the index exists; a second traversal would be a
    // performance regression a user could trigger by clicking twice.
    const keys = Array.from({ length: 50 }, (_, i) => `k${i}:x`)
    const { source, calls } = stubSource(keys, 5)
    const registry = new IndexRegistry(async () => source)

    void registry.start('src', 0, keys.length)
    void registry.start('src', 0, keys.length)
    void registry.start('src', 0, keys.length)

    // Only one loop exists; calls proceed one step at a time, not three at a time.
    return until(() => registry.get('src', 0)!.done).then(() => {
      // 50 keys in pages of 5 plus the final call that returns the closing cursor.
      expect(calls()).toBeLessThanOrEqual(12)
    })
  })

  it('keeps one index per database, not per source', async () => {
    // Redis databases are independent keyspaces; sharing one index across them would
    // show db0's folders while browsing db1.
    const { source } = stubSource(['a:1'], 10)
    const registry = new IndexRegistry(async () => source)

    await registry.start('src', 0, 1)
    await until(() => registry.get('src', 0)!.done)

    expect(registry.get('src', 1)).toBeUndefined()
    await registry.start('src', 1, 3)
    // A distinct index, with its own denominator.
    expect(registry.get('src', 1)!.dbSize).toBe(3)
    expect(registry.get('src', 0)!.dbSize).toBe(1)
  })

  it('reports a server without scripting as an error, never as an empty tree', async () => {
    // `aggregateBatch` returns null when EVAL is unavailable. Treating that as "no
    // folders" would tell the user their database is empty, which is a lie the cache
    // would then keep serving.
    const source: IndexBatchSource = { aggregateBatch: async () => null }
    const registry = new IndexRegistry(async () => source)

    const index = await registry.start('src', 0, 100)
    await until(() => index.error !== undefined)

    expect(index.error).toMatch(/scripting|EVAL/i)
    const progress = registry.progressOf('src', 0)!
    expect(progress.done).toBe(false)
    expect(progress.error).toBeDefined()
  })

  it('records a transport failure on the index rather than throwing into the void', async () => {
    // The loop runs detached, so a throw has no caller to catch it. An index that
    // silently stayed empty would look like an empty database.
    const source: IndexBatchSource = {
      aggregateBatch: async () => { throw new Error('connection reset') },
    }
    const registry = new IndexRegistry(async () => source)

    const index = await registry.start('src', 0, 10)
    await until(() => index.error !== undefined)
    expect(index.error).toMatch(/connection reset/)
  })

  it('stops walking when the index is invalidated', async () => {
    const keys = Array.from({ length: 500 }, (_, i) => `k${i}:x`)
    const { source, calls } = stubSource(keys, 5)
    const registry = new IndexRegistry(async () => source)

    await registry.start('src', 0, keys.length)
    await until(() => (registry.get('src', 0)?.visited ?? 0) > 0)

    registry.invalidate('src', 0)
    expect(registry.get('src', 0)).toBeUndefined()

    // Let the loop notice the cancellation, then confirm it stopped advancing.
    const after = calls()
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(calls()).toBeLessThanOrEqual(after + 1)
  })

  it('drops every index for one source when its connection changes', async () => {
    const { source } = stubSource(['a:1', 'b:2'], 10)
    const registry = new IndexRegistry(async () => source)

    await registry.start('src', 0, 2)
    await registry.start('src', 1, 2)
    registry.invalidateSource('src')

    expect(registry.get('src', 0)).toBeUndefined()
    expect(registry.get('src', 1)).toBeUndefined()
  })

  it('stops every walk on dispose, so unloading does not leave work running', async () => {
    const keys = Array.from({ length: 500 }, (_, i) => `k${i}:x`)
    const { source, calls } = stubSource(keys, 5)
    const registry = new IndexRegistry(async () => source)

    await registry.start('src', 0, keys.length)
    await until(() => (registry.get('src', 0)?.visited ?? 0) > 0)

    registry.disposeAll()
    const after = calls()
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(calls()).toBeLessThanOrEqual(after + 1)
    expect(registry.get('src', 0)).toBeUndefined()
  })

  it('estimates cost from DBSIZE, flagging the sizes worth warning about', () => {
    const registry = new IndexRegistry(async () => { throw new Error('not used') })

    // A small database is not worth a confirmation prompt.
    expect(registry.estimate(1_000).isLarge).toBe(false)
    // 19.5M keys is the measured production case: about a minute, so a caller should
    // warn before starting it.
    const big = registry.estimate(19_500_000)
    expect(big.isLarge).toBe(true)
    expect(big.estimatedSeconds).toBeGreaterThan(30)
    expect(big.keys).toBe(19_500_000)
  })
})
