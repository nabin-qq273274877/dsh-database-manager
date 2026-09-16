/**
 * Redis key editing against a REAL server.
 *
 * The operations under test are destructive and irreversible, and their
 * correctness depends on server behaviour that a mock cannot show: the exact
 * glob semantics of `SCAN MATCH`, whether `DEL` reports keys that were already
 * gone, and whether a folder holding a key that doubles as its own name is
 * fully removed. Those are precisely the cases where a plausible-looking
 * implementation leaves keys behind, so the tests run against a live Redis.
 *
 * Skipped when nothing listens on REDIS_TEST_PORT (default 6379), so a checkout
 * without Docker still runs the rest of the suite.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RedisDriver, redisAvailable } from '../src/drivers/redis.ts'
import type { DataSourceEntry } from '../src/protocol.ts'
import { buildRedisTree } from '../src/client/redis-tree.ts'

/** Port to test against; the local Docker Redis by default. */
const PORT = Number(process.env['REDIS_TEST_PORT'] ?? 6379)

/** The database used by these tests. Kept odd so it is unlikely to hold the
 * user's own keys; everything it touches is namespaced under the prefix below
 * and deleted before and after. */
const DB = 9

/**
 * The namespace every key in this suite lives under.
 *
 * ROOT carries NO trailing separator: it is passed to the driver's
 * folder operations the same way the UI passes a folder path (`a:b`, never
 * `a:b:`), so the cleanup exercises the real call shape. PREFIX is the same
 * string with the separator, for building key names.
 */
const ROOT = 'dbm-test'
const PREFIX = `${ROOT}:`

const available = await redisAvailable()

/** Whether a server actually answers on PORT. */
async function serverUp(): Promise<boolean> {
  if (!available) return false
  const driver = new RedisDriver(entry())
  try {
    const result = await driver.test()
    return result.ok
  } catch {
    return false
  } finally {
    await driver.close()
  }
}

/** One entry aimed at the test server and database. */
function entry(): DataSourceEntry {
  return {
    id: 'test-redis',
    kind: 'redis',
    name: 'test-redis',
    group: '',
    tags: [],
    description: '',
    host: '127.0.0.1',
    port: PORT,
    db: DB,
    readonly: false,
    connectTimeoutMs: 4000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

const up = await serverUp()

describe.skipIf(!up)('Redis key editing (live server)', () => {
  let driver: RedisDriver

  beforeAll(async () => {
    driver = new RedisDriver(entry())
    // Start from a clean slate in case a previous run was interrupted. ROOT has
    // no trailing separator, exactly as a UI folder path is passed.
    await driver.deletePrefix(ROOT, DB)
  })

  afterAll(async () => {
    if (driver !== undefined) {
      await driver.deletePrefix(ROOT, DB)
      await driver.close()
    }
  })

  /** Every key under the test root, via the driver's own tree scan. */
  async function scan(): Promise<string[]> {
    const page = await driver.tree({ db: DB, pattern: `${PREFIX}*` })
    return page.keys.map(item => item.key).sort()
  }

  describe('createKey', () => {
    it('creates a string with its value and TTL', async () => {
      await driver.createKey({ key: `${PREFIX}s`, type: 'string', value: 'hello', ttl: 120 }, DB)
      const value = await driver.value(`${PREFIX}s`, DB, 100)
      expect(value.type).toBe('string')
      expect(value.value).toBe('hello')
      expect(value.ttl).toBeGreaterThan(0)
      expect(value.ttl).toBeLessThanOrEqual(120)
    })

    it('creates a list whose order matches the form', async () => {
      await driver.createKey({ key: `${PREFIX}l`, type: 'list', items: ['one', 'two', 'three'] }, DB)
      const value = await driver.value(`${PREFIX}l`, DB, 100)
      expect(value.type).toBe('list')
      expect(value.items).toEqual(['one', 'two', 'three'])
    })

    it('creates a set', async () => {
      await driver.createKey({ key: `${PREFIX}set`, type: 'set', items: ['a', 'b'] }, DB)
      const value = await driver.value(`${PREFIX}set`, DB, 100)
      expect(value.type).toBe('set')
      expect([...(value.items ?? [])].sort()).toEqual(['a', 'b'])
    })

    it('creates a hash with several fields', async () => {
      await driver.createKey({
        key: `${PREFIX}h`,
        type: 'hash',
        fields: [{ field: 'f1', value: 'v1' }, { field: 'f2', value: 'v2' }],
      }, DB)
      const value = await driver.value(`${PREFIX}h`, DB, 100)
      expect(value.type).toBe('hash')
      expect(Object.fromEntries((value.fields ?? []).map(item => [item.field, item.value]))).toEqual({ f1: 'v1', f2: 'v2' })
    })

    it('creates a zset with scores', async () => {
      await driver.createKey({
        key: `${PREFIX}z`,
        type: 'zset',
        members: [{ member: 'low', score: '1' }, { member: 'high', score: '9' }],
      }, DB)
      const value = await driver.value(`${PREFIX}z`, DB, 100)
      expect(value.type).toBe('zset')
      expect((value.members ?? []).map(item => item.member)).toEqual(['low', 'high'])
    })

    it('creates a key with no expiry when the TTL is absent or zero', async () => {
      await driver.createKey({ key: `${PREFIX}permanent`, type: 'string', value: 'x' }, DB)
      const value = await driver.value(`${PREFIX}permanent`, DB, 10)
      expect(value.ttl).toBe(-1)
    })

    it('refuses to overwrite an existing key, leaving its value intact', async () => {
      await driver.createKey({ key: `${PREFIX}keep`, type: 'string', value: 'original' }, DB)
      await expect(
        driver.createKey({ key: `${PREFIX}keep`, type: 'string', value: 'replacement' }, DB),
      ).rejects.toThrow(/已存在/)
      // The whole point: the original value must survive the refusal.
      const value = await driver.value(`${PREFIX}keep`, DB, 10)
      expect(value.value).toBe('original')
    })

    it('rejects a create with no key name', async () => {
      await expect(driver.createKey({ key: '', type: 'string', value: 'x' }, DB)).rejects.toThrow(/required/)
    })
  })

  describe('deleteKey', () => {
    it('removes one key and reports whether it existed', async () => {
      await driver.createKey({ key: `${PREFIX}gone`, type: 'string', value: 'x' }, DB)
      expect(await driver.deleteKey(`${PREFIX}gone`, DB)).toBe(true)
      // A second delete is a no-op, not an error, and must report false.
      expect(await driver.deleteKey(`${PREFIX}gone`, DB)).toBe(false)
    })
  })

  describe('deletePrefix', () => {
    it('deletes a folder and everything nested beneath it', async () => {
      await driver.createKey({ key: `${PREFIX}tree:a:1`, type: 'string', value: 'x' }, DB)
      await driver.createKey({ key: `${PREFIX}tree:a:2`, type: 'string', value: 'x' }, DB)
      await driver.createKey({ key: `${PREFIX}tree:a:b:3`, type: 'string', value: 'x' }, DB)
      await driver.createKey({ key: `${PREFIX}tree:keep`, type: 'string', value: 'x' }, DB)

      const result = await driver.deletePrefix(`${PREFIX}tree:a`, DB)
      expect(result.deleted).toBe(3)
      expect(result.truncated).toBe(false)

      const left = await scan()
      // The sibling `tree:keep` must survive: it is not under `tree:a`.
      expect(left).toContain(`${PREFIX}tree:keep`)
      expect(left.filter(key => key.startsWith(`${PREFIX}tree:a`))).toEqual([])
    })

    it('also removes a key whose name IS the folder', async () => {
      // `tree:self` is both a key and the parent of `tree:self:child`. A delete
      // that only matched `tree:self:*` would leave the key behind and the
      // folder would reappear, looking un-deletable.
      await driver.createKey({ key: `${PREFIX}tree:self`, type: 'string', value: 'x' }, DB)
      await driver.createKey({ key: `${PREFIX}tree:self:child`, type: 'string', value: 'x' }, DB)

      const result = await driver.deletePrefix(`${PREFIX}tree:self`, DB)
      expect(result.deleted).toBe(2)

      const left = await scan()
      expect(left.filter(key => key.startsWith(`${PREFIX}tree:self`))).toEqual([])
    })

    it('does not touch a sibling that merely shares a name prefix', async () => {
      // `tree:x` and `tree:xyz` share a string prefix but are different
      // folders. Deleting `tree:x` must not take `tree:xyz` with it.
      await driver.createKey({ key: `${PREFIX}tree:x:1`, type: 'string', value: 'x' }, DB)
      await driver.createKey({ key: `${PREFIX}tree:xyz:1`, type: 'string', value: 'x' }, DB)

      await driver.deletePrefix(`${PREFIX}tree:x`, DB)

      const left = await scan()
      expect(left).toContain(`${PREFIX}tree:xyz:1`)
      expect(left).not.toContain(`${PREFIX}tree:x:1`)
    })

    it('escapes glob metacharacters in a folder name', async () => {
      // The dangerous case: a folder literally named `a*b`. Read as a wildcard,
      // `a*b:*` also matches `aXXb:*`, so an unescaped delete would destroy
      // keys the user never selected.
      await driver.createKey({ key: `${PREFIX}glob:a*b:1`, type: 'string', value: 'x' }, DB)
      await driver.createKey({ key: `${PREFIX}glob:aXXb:1`, type: 'string', value: 'x' }, DB)

      const result = await driver.deletePrefix(`${PREFIX}glob:a*b`, DB)

      expect(result.deleted).toBe(1)
      const left = await scan()
      // The literal folder is gone; the lookalike must be untouched.
      expect(left).not.toContain(`${PREFIX}glob:a*b:1`)
      expect(left).toContain(`${PREFIX}glob:aXXb:1`)
    })

    it('escapes a folder name containing a question mark', async () => {
      await driver.createKey({ key: `${PREFIX}q:a?b:1`, type: 'string', value: 'x' }, DB)
      await driver.createKey({ key: `${PREFIX}q:aXb:1`, type: 'string', value: 'x' }, DB)

      await driver.deletePrefix(`${PREFIX}q:a?b`, DB)

      const left = await scan()
      expect(left).not.toContain(`${PREFIX}q:a?b:1`)
      expect(left).toContain(`${PREFIX}q:aXb:1`)
    })

    it('treats a trailing separator as a real, distinct folder level', async () => {
      // `a::1` splits into segments ['a', '', '1'], so the tree renders it as
      // folder `a` → folder `a:` (empty segment) → key `1`. Folder `a:` is
      // therefore reachable from the UI and must mean `a::*`, NOT `a:*`.
      //
      // Both patterns were verified against the server: `a:*` matches `a:1`
      // AND `a::1`, while `a::*` matches only `a::1`.
      await driver.createKey({ key: `${PREFIX}trail:1`, type: 'string', value: 'x' }, DB)
      await driver.createKey({ key: `${PREFIX}trail::nested`, type: 'string', value: 'x' }, DB)

      // Folder `...trail` owns both keys (one directly, one via its child).
      // NB: the path passed to a folder operation is the joined segments with
      // no trailing separator, so it is `${PREFIX}trail` — not `${ROOT}trail`,
      // which would concatenate without a separator and match nothing.
      expect(await driver.countPrefix(`${PREFIX}trail`, DB)).toBe(2)
      // Folder `...trail:` owns only the double-separator key.
      expect(await driver.countPrefix(`${PREFIX}trail:`, DB)).toBe(1)

      // Deleting the inner folder must leave the sibling key alone.
      await driver.deletePrefix(`${PREFIX}trail:`, DB)
      const left = await scan()
      expect(left).not.toContain(`${PREFIX}trail::nested`)
      expect(left).toContain(`${PREFIX}trail:1`)
    })

    it('reports zero for a folder that holds nothing', async () => {
      const result = await driver.deletePrefix(`${PREFIX}never-existed`, DB)
      expect(result.deleted).toBe(0)
      expect(result.truncated).toBe(false)
    })

    it('clears a folder holding more keys than one scan batch returns', async () => {
      // More than TREE_SCAN_COUNT (1000) so a single-pass implementation would
      // leave keys behind. Written in one pipeline-equivalent burst through the
      // console path to keep the test fast.
      const total = 1200
      const args: string[] = ['MSET']
      for (let i = 0; i < total; i++) args.push(`${PREFIX}big:${i}`, 'v')
      await driver.command(args, DB)

      const before = (await scan()).filter(key => key.startsWith(`${PREFIX}big:`)).length
      expect(before).toBe(total)

      const result = await driver.deletePrefix(`${PREFIX}big`, DB)
      expect(result.truncated).toBe(false)
      expect(result.deleted).toBe(total)

      expect((await scan()).filter(key => key.startsWith(`${PREFIX}big:`))).toEqual([])
    }, 60000)
  })

  describe('countPrefix', () => {
    it('counts the folder key and every descendant', async () => {
      await driver.createKey({ key: `${PREFIX}count:1`, type: 'string', value: 'x' }, DB)
      await driver.createKey({ key: `${PREFIX}count:2`, type: 'string', value: 'x' }, DB)
      await driver.createKey({ key: `${PREFIX}count`, type: 'string', value: 'x' }, DB)

      // Two children plus the same-named key itself.
      expect(await driver.countPrefix(`${PREFIX}count`, DB)).toBe(3)
    })

    it('agrees with what deletePrefix then removes', async () => {
      await driver.createKey({ key: `${PREFIX}agree:a:1`, type: 'string', value: 'x' }, DB)
      await driver.createKey({ key: `${PREFIX}agree:a:deep:2`, type: 'string', value: 'x' }, DB)
      await driver.createKey({ key: `${PREFIX}agree:a`, type: 'string', value: 'x' }, DB)

      const counted = await driver.countPrefix(`${PREFIX}agree:a`, DB)
      const removed = await driver.deletePrefix(`${PREFIX}agree:a`, DB)
      // A count that disagreed with the delete would make the confirmation
      // dialog lie about what is about to happen.
      expect(removed.deleted).toBe(counted)
    })
  })

  describe('tree', () => {
    it('returns every key in the database and reports the size', async () => {
      const page = await driver.tree({ db: DB })
      expect(page.truncated).toBe(false)
      expect(page.dbSize).toBeGreaterThanOrEqual(page.keys.length)
      // It must have caught the keys this suite created.
      expect(page.keys.some(item => item.key.startsWith(PREFIX))).toBe(true)
    })

    it('carries a type and a TTL for each key', async () => {
      await driver.createKey({ key: `${PREFIX}typed`, type: 'hash', fields: [{ field: 'f', value: 'v' }] }, DB)
      const page = await driver.tree({ db: DB, pattern: `${PREFIX}typed` })
      const found = page.keys.find(item => item.key === `${PREFIX}typed`)
      expect(found?.type).toBe('hash')
      expect(found?.ttl).toBe(-1)
    })

    it('groups the real keys into the folders the UI renders', async () => {
      await driver.deletePrefix(`${PREFIX}shape`, DB)
      await driver.createKey({ key: `${PREFIX}shape:a:b:1`, type: 'string', value: 'x' }, DB)
      await driver.createKey({ key: `${PREFIX}shape:a:b:2`, type: 'string', value: 'x' }, DB)

      const page = await driver.tree({ db: DB, pattern: `${PREFIX}shape:*` })
      const tree = buildRedisTree(page.keys)
      // The key `dbm-test:shape:a:b:1` splits into four folder levels and a
      // leaf, so the outermost folder is the test prefix itself.
      const outer = tree.folders.find(folder => folder.name === 'dbm-test')
      expect(outer).toBeDefined()
      const shape = outer!.folders.find(folder => folder.name === 'shape')
      expect(shape).toBeDefined()
      expect(shape!.folders[0]!.name).toBe('a')
      expect(shape!.folders[0]!.folders[0]!.name).toBe('b')
      expect(shape!.folders[0]!.folders[0]!.keys).toHaveLength(2)
    })
  })

  describe('database isolation', () => {
    it('does not see or delete keys in another database', async () => {
      // The tree spans databases in the UI, so a crossed wire here would show
      // one database's keys under another and delete the wrong ones.
      const other = 10
      await driver.createKey({ key: `${PREFIX}iso`, type: 'string', value: 'in-db9' }, DB)
      await driver.createKey({ key: `${PREFIX}iso`, type: 'string', value: 'in-db10' }, other)

      const inNine = await driver.value(`${PREFIX}iso`, DB, 10)
      const inTen = await driver.value(`${PREFIX}iso`, other, 10)
      expect(inNine.value).toBe('in-db9')
      expect(inTen.value).toBe('in-db10')

      await driver.deletePrefix(`${PREFIX}iso`, DB)
      const both = await driver.tree({ db: DB, pattern: `${PREFIX}iso` })
      const ten = await driver.tree({ db: other, pattern: `${PREFIX}iso` })
      expect(both.keys).toHaveLength(0)
      expect(ten.keys).toHaveLength(1)

      await driver.deletePrefix(`${PREFIX}iso`, other)
    })
  })
})
