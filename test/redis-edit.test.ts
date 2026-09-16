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

  describe('search', () => {
    beforeAll(async () => {
      await driver.deletePrefix(`${ROOT}srch`, DB)
      await driver.createKey({ key: `${PREFIX}srch:jd:order:1`, type: 'string', value: 'v' }, DB)
      await driver.createKey({ key: `${PREFIX}srch:jd:order:2`, type: 'string', value: 'v' }, DB)
      await driver.createKey({ key: `${PREFIX}srch:jd:user:1`, type: 'string', value: 'v' }, DB)
      await driver.createKey({ key: `${PREFIX}srch:other:1`, type: 'string', value: 'v' }, DB)
      await driver.createKey({ key: `${PREFIX}srch:top`, type: 'string', value: 'v' }, DB)
      // Deliberately not a string, so the type in the results is exercised.
      await driver.createKey({ key: `${PREFIX}srch:jd:hash`, type: 'hash', fields: [{ field: 'f', value: 'v' }] }, DB)
    })

    it('evaluates a Redis glob, not a literal substring', async () => {
      // The regression: a client-side `includes('jd:*')` never matches anything,
      // because `*` is not a wildcard to String#includes. Only the server's
      // SCAN MATCH gives the pattern its Redis meaning.
      const page = await driver.search({ db: DB, pattern: `${PREFIX}srch:jd:*` })
      const keys = page.keys.map(item => item.key).sort()
      expect(keys).toEqual([
        `${PREFIX}srch:jd:hash`,
        `${PREFIX}srch:jd:order:1`,
        `${PREFIX}srch:jd:order:2`,
        `${PREFIX}srch:jd:user:1`,
      ])
      expect(page.truncated).toBe(false)
    })

    it('finds keys that no level scan has loaded', async () => {
      // A search is answered from the whole database, so it reaches keys under
      // folders that were never expanded — the other half of the regression.
      const page = await driver.search({ db: DB, pattern: `${PREFIX}srch:jd:user:*` })
      expect(page.keys.map(item => item.key)).toEqual([`${PREFIX}srch:jd:user:1`])
    })

    it('supports the other glob metacharacters', async () => {
      const middle = await driver.search({ db: DB, pattern: `${PREFIX}srch:*:order:*` })
      expect(middle.keys.map(item => item.key).sort()).toEqual([
        `${PREFIX}srch:jd:order:1`,
        `${PREFIX}srch:jd:order:2`,
      ])

      // `?` matches exactly one character.
      const single = await driver.search({ db: DB, pattern: `${PREFIX}srch:other:?` })
      expect(single.keys.map(item => item.key)).toEqual([`${PREFIX}srch:other:1`])

      // A character class.
      const klass = await driver.search({ db: DB, pattern: `${PREFIX}srch:jd:order:[12]` })
      expect(klass.keys).toHaveLength(2)
    })

    it('carries the type and TTL of each match', async () => {
      const page = await driver.search({ db: DB, pattern: `${PREFIX}srch:jd:hash` })
      expect(page.keys[0]?.type).toBe('hash')
      expect(page.keys[0]?.ttl).toBe(-1)
    })

    it('sorts results by name', async () => {
      const page = await driver.search({ db: DB, pattern: `${PREFIX}srch:jd:order:*` })
      expect(page.keys.map(item => item.key)).toEqual([
        `${PREFIX}srch:jd:order:1`,
        `${PREFIX}srch:jd:order:2`,
      ])
    })

    it('reports how many matches the scan returned, and the database size', async () => {
      const page = await driver.search({ db: DB, pattern: `${PREFIX}srch:jd:*` })
      // SCAN MATCH filters SERVER-side, so the scan only ever hands back
      // matching keys: `scanned` counts those, not the whole keyspace it walked.
      // dbSize is what gives the "N of M" context in the UI.
      expect(page.scanned).toBe(page.keys.length)
      expect(page.dbSize).toBeGreaterThan(page.keys.length)
    })

    it('reports a truncated result rather than passing off a partial list', async () => {
      // Past the cap the UI must be able to say "showing the first N". This is
      // asserted structurally (the flag exists and is false for a small result)
      // because seeding 5000+ keys to trip it would dominate the suite.
      const page = await driver.search({ db: DB, pattern: `${PREFIX}srch:jd:*` })
      expect(page.truncated).toBe(false)
    })

    it('returns nothing for a pattern that matches nothing, without erroring', async () => {
      const page = await driver.search({ db: DB, pattern: `${PREFIX}srch:nope:*` })
      expect(page.keys).toEqual([])
      expect(page.truncated).toBe(false)
    })

    it('treats an empty pattern as match-all', async () => {
      const page = await driver.search({ db: DB, pattern: '' })
      expect(page.keys.length).toBeGreaterThan(0)
      expect(page.dbSize).toBeGreaterThan(0)
    })

    it('searches only the database it is told to', async () => {
      // Scoping matters: a pattern run against the wrong db silently returns the
      // wrong keys, which is worse than an error.
      const other = 11
      await driver.createKey({ key: `${PREFIX}srch:jd:elsewhere`, type: 'string', value: 'v' }, other)
      try {
        const inNine = await driver.search({ db: DB, pattern: `${PREFIX}srch:jd:elsewhere` })
        const inEleven = await driver.search({ db: other, pattern: `${PREFIX}srch:jd:elsewhere` })
        expect(inNine.keys).toHaveLength(0)
        expect(inEleven.keys).toHaveLength(1)
      } finally {
        await driver.deletePrefix(`${PREFIX}srch:jd:elsewhere`, other)
      }
    })

    it('escaped metacharacters in a literal pattern are honoured', async () => {
      // A user searching for a literal `*` in a key name must be able to say so,
      // and the server's own escaping is what makes that work.
      await driver.createKey({ key: `${PREFIX}srch:lit*eral`, type: 'string', value: 'v' }, DB)
      await driver.createKey({ key: `${PREFIX}srch:litXeral`, type: 'string', value: 'v' }, DB)
      try {
        const escaped = await driver.search({ db: DB, pattern: `${PREFIX}srch:lit\\*eral` })
        expect(escaped.keys.map(item => item.key)).toEqual([`${PREFIX}srch:lit*eral`])
      } finally {
        await driver.deleteKey(`${PREFIX}srch:lit*eral`, DB)
        await driver.deleteKey(`${PREFIX}srch:litXeral`, DB)
      }
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

  describe('level (the tree\'s lazy-load scan)', () => {
    beforeAll(async () => {
      // A level-shaped fixture: two branches with known counts.
      await driver.deletePrefix(`${ROOT}lv`, DB)
      for (let i = 0; i < 5; i++) {
        await driver.createKey({ key: `${PREFIX}lv:alpha:${i}`, type: 'string', value: 'v' }, DB)
        await driver.createKey({ key: `${PREFIX}lv:beta:${i}`, type: 'string', value: 'v' }, DB)
      }
      // A leaf directly at the `lv` level, plus a key that doubles as a folder.
      await driver.createKey({ key: `${PREFIX}lv:leaf`, type: 'list', items: ['a'] }, DB)
      await driver.createKey({ key: `${PREFIX}lv:alpha`, type: 'string', value: 'doubles' }, DB)
    })

    it('reports sub-folders with key counts that match what deleting them removes', async () => {
      const page = await driver.level({ db: DB, prefix: `${PREFIX}lv`, withTypes: true })

      const folders = Object.fromEntries(page.folders.map(folder => [folder.name, folder.keys]))
      // Each branch holds 5 children, plus the same-named key `lv:alpha` which
      // the folder delete also removes — so alpha is 6, beta is 5.
      expect(folders['alpha']).toBe(6)
      expect(folders['beta']).toBe(5)
      expect(page.folders.map(folder => folder.name).sort()).toEqual(['alpha', 'beta'])

      // The direct leaf is a key at this level, not a folder.
      expect(page.keys.map(key => key.key)).toContain(`${PREFIX}lv:leaf`)
      expect(page.keys.find(key => key.key === `${PREFIX}lv:leaf`)?.type).toBe('list')
      // `lv:alpha` is ALSO a direct child key of `lv` (it has no separator after
      // the prefix), so it is listed here as well as counted into folder alpha.
      // Listing it is what makes it clickable; counting it into alpha is what
      // makes the folder row's number equal the deletion scope.
      expect(page.keys.map(key => key.key)).toContain(`${PREFIX}lv:alpha`)
      expect(page.keysAtLevel).toBe(2)
      expect(page.truncated).toBe(false)
    })

    it('counts a folder\'s same-named key into that folder, not only the parent level', async () => {
      // The property that matters: the number on the folder row equals what
      // deleting it destroys.
      const atLv = await driver.level({ db: DB, prefix: `${PREFIX}lv`, withTypes: false })
      const alpha = atLv.folders.find(folder => folder.name === 'alpha')!
      expect(alpha.keys).toBe(await driver.countPrefix(alpha.path, DB))

      // Opening alpha shows its five children AND the same-named key.
      const atAlpha = await driver.level({ db: DB, prefix: `${PREFIX}lv:alpha`, withTypes: false })
      const alphaKeys = atAlpha.keys.map(key => key.key)
      expect(alphaKeys).toContain(`${PREFIX}lv:alpha`)
      expect(alphaKeys).toContain(`${PREFIX}lv:alpha:0`)
      expect(atAlpha.keysAtLevel).toBe(6)
    })

    it('counts a folder exactly, matching what deleting it removes', async () => {
      // This is the assertion that caught the truncated-count bug (a 200k folder
      // reported as 151142) and then the same-named-key bug (a folder showing one
      // fewer than the delete would destroy).
      const page = await driver.level({ db: DB, prefix: `${PREFIX}lv`, withTypes: false })
      for (const folder of page.folders) {
        const counted = await driver.countPrefix(folder.path, DB)
        expect(folder.keys).toBe(counted)
      }
    })

    it('does not sweep in a sibling that merely shares a name prefix', async () => {
      // Folder `lv` must not pull in `lvX:*`.
      await driver.createKey({ key: `${PREFIX}lvX:other`, type: 'string', value: 'v' }, DB)
      const page = await driver.level({ db: DB, prefix: `${PREFIX}lv`, withTypes: false })
      expect(page.folders.map(folder => folder.name)).not.toContain('lvX')
      expect(page.keys.map(key => key.key)).not.toContain(`${PREFIX}lvX:other`)
      await driver.deletePrefix(`${PREFIX}lvX`, DB)
    })

    it('reports a level with no keys without inventing entries', async () => {
      const page = await driver.level({ db: DB, prefix: `${PREFIX}does-not-exist`, withTypes: true })
      expect(page.folders).toEqual([])
      expect(page.keys).toEqual([])
      expect(page.keysAtLevel).toBe(0)
      expect(page.truncated).toBe(false)
      // DBSIZE is whole-database, so it still reports the real total.
      expect(page.dbSize).toBeGreaterThan(0)
    })

    it('caps the returned rows but still reports the true count', async () => {
      // A flat prefix larger than the display cap: the UI must be able to say
      // "showing the first N of M" rather than implying the folder is small.
      const many = 5200
      const args: string[] = ['MSET']
      for (let i = 0; i < many; i++) args.push(`${PREFIX}flat:${i}`, 'v')
      await driver.command(args, DB)

      const page = await driver.level({ db: DB, prefix: `${PREFIX}flat`, withTypes: true })
      expect(page.keysAtLevel).toBe(many)
      expect(page.keys.length).toBe(5000)
      expect(page.truncated).toBe(true)
      // The rows that ARE returned must be real and typed.
      expect(page.keys.every(key => key.type === 'string')).toBe(true)

      await driver.deletePrefix(`${PREFIX}flat`, DB)
    }, 60000)

    it('types only the keys it returns, and skips typing when not asked', async () => {
      const withTypes = await driver.level({ db: DB, prefix: `${PREFIX}lv:beta`, withTypes: true })
      expect(withTypes.keys.every(key => key.type === 'string')).toBe(true)

      // The root of a huge database is all folders; the caller can skip the
      // TYPE/TTL round trips entirely.
      const withoutTypes = await driver.level({ db: DB, prefix: `${PREFIX}lv:beta`, withTypes: false })
      expect(withoutTypes.keys.every(key => key.type === 'unknown')).toBe(true)
      expect(withoutTypes.keys).toHaveLength(withTypes.keys.length)
    })
  })

  describe('setString', () => {
    it('replaces a string value and keeps its TTL', async () => {
      await driver.createKey({ key: `${PREFIX}s1`, type: 'string', value: 'before', ttl: 300 }, DB)
      const result = await driver.setString(`${PREFIX}s1`, 'after', DB)

      const value = await driver.value(`${PREFIX}s1`, DB, 10)
      expect(value.value).toBe('after')
      // Saving a value must not silently clear an expiry the user set.
      expect(result.ttl).toBeGreaterThan(0)
      expect(result.removed).toBe(false)
    })

    it('refuses to write a string over a non-string key', async () => {
      // SET on a list would replace the whole key: data loss behind a "save".
      await driver.createKey({ key: `${PREFIX}s2`, type: 'list', items: ['a'] }, DB)
      await expect(driver.setString(`${PREFIX}s2`, 'oops', DB)).rejects.toThrow(/类型是 list/)
      // The list must be intact.
      const value = await driver.value(`${PREFIX}s2`, DB, 10)
      expect(value.type).toBe('list')
      expect(value.items).toEqual(['a'])
    })

    it('refuses to write a missing key', async () => {
      await expect(driver.setString(`${PREFIX}ghost`, 'x', DB)).rejects.toThrow(/不存在/)
    })

    it('accepts an empty and a large value', async () => {
      await driver.createKey({ key: `${PREFIX}s3`, type: 'string', value: 'x' }, DB)
      await driver.setString(`${PREFIX}s3`, '', DB)
      expect((await driver.value(`${PREFIX}s3`, DB, 10)).value).toBe('')

      const big = 'x'.repeat(200000)
      await driver.setString(`${PREFIX}s3`, big, DB)
      expect((await driver.value(`${PREFIX}s3`, DB, 10)).value?.length).toBe(200000)
    })
  })

  describe('setTtl', () => {
    it('sets an expiry and clears it back to permanent', async () => {
      await driver.createKey({ key: `${PREFIX}t1`, type: 'string', value: 'v' }, DB)

      const set = await driver.setTtl(`${PREFIX}t1`, 120, DB)
      expect(set.ttl).toBeGreaterThan(0)
      expect(set.removed).toBe(false)

      // Clearing must use PERSIST: `EXPIRE key 0` DELETES the key, which is a
      // very different thing from "make it permanent".
      const cleared = await driver.setTtl(`${PREFIX}t1`, 0, DB)
      expect(cleared.ttl).toBe(-1)
      const value = await driver.value(`${PREFIX}t1`, DB, 10)
      expect(value.type).toBe('string')
      expect(value.value).toBe('v')
    })

    it('treats a negative TTL as permanent rather than deleting', async () => {
      await driver.createKey({ key: `${PREFIX}t2`, type: 'string', value: 'v', ttl: 60 }, DB)
      await driver.setTtl(`${PREFIX}t2`, -1, DB)
      const value = await driver.value(`${PREFIX}t2`, DB, 10)
      expect(value.ttl).toBe(-1)
      expect(value.value).toBe('v')
    })

    it('refuses a missing key', async () => {
      await expect(driver.setTtl(`${PREFIX}ghost-ttl`, 60, DB)).rejects.toThrow(/不存在/)
    })
  })

  describe('editElement', () => {
    it('changes a list element in place, by index', async () => {
      await driver.createKey({ key: `${PREFIX}el-list`, type: 'list', items: ['a', 'b', 'c'] }, DB)
      await driver.editElement(`${PREFIX}el-list`, { op: 'set', index: 1, value: 'B' }, DB)
      expect((await driver.value(`${PREFIX}el-list`, DB, 10)).items).toEqual(['a', 'B', 'c'])
    })

    it('deletes a list element by index, not by value', async () => {
      // The list deliberately repeats a value: removing index 0 must remove ONE
      // element, not every occurrence of it.
      await driver.createKey({ key: `${PREFIX}el-dup`, type: 'list', items: ['x', 'y', 'x'] }, DB)
      await driver.editElement(`${PREFIX}el-dup`, { op: 'delete', index: 0 }, DB)
      expect((await driver.value(`${PREFIX}el-dup`, DB, 10)).items).toEqual(['y', 'x'])
    })

    it('appends to a list', async () => {
      await driver.createKey({ key: `${PREFIX}el-push`, type: 'list', items: ['a'] }, DB)
      await driver.editElement(`${PREFIX}el-push`, { op: 'push', value: 'b' }, DB)
      expect((await driver.value(`${PREFIX}el-push`, DB, 10)).items).toEqual(['a', 'b'])
    })

    it('rejects an out-of-range list index with the real length', async () => {
      await driver.createKey({ key: `${PREFIX}el-range`, type: 'list', items: ['a', 'b'] }, DB)
      await expect(driver.editElement(`${PREFIX}el-range`, { op: 'set', index: 9, value: 'z' }, DB))
        .rejects.toThrow(/下标 9 超出范围（列表长度 2）/)
    })

    it('adds, renames and removes a set member', async () => {
      await driver.createKey({ key: `${PREFIX}el-set`, type: 'set', items: ['a', 'b'] }, DB)

      await driver.editElement(`${PREFIX}el-set`, { op: 'add', value: 'c' }, DB)
      expect([...((await driver.value(`${PREFIX}el-set`, DB, 10)).items ?? [])].sort()).toEqual(['a', 'b', 'c'])

      // A set has no in-place edit: renaming means remove + add.
      await driver.editElement(`${PREFIX}el-set`, { op: 'delete', member: 'a', value: 'A' }, DB)
      const renamed = [...((await driver.value(`${PREFIX}el-set`, DB, 10)).items ?? [])].sort()
      expect(renamed).toEqual(['A', 'b', 'c'])

      await driver.editElement(`${PREFIX}el-set`, { op: 'delete', member: 'b' }, DB)
      expect([...((await driver.value(`${PREFIX}el-set`, DB, 10)).items ?? [])].sort()).toEqual(['A', 'c'])
    })

    it('sets, changes and deletes a hash field', async () => {
      await driver.createKey({ key: `${PREFIX}el-hash`, type: 'hash', fields: [{ field: 'f', value: '1' }] }, DB)

      await driver.editElement(`${PREFIX}el-hash`, { op: 'set', member: 'g', value: '2' }, DB)
      await driver.editElement(`${PREFIX}el-hash`, { op: 'set', member: 'f', value: 'changed' }, DB)
      const fields = Object.fromEntries(
        ((await driver.value(`${PREFIX}el-hash`, DB, 10)).fields ?? []).map(item => [item.field, item.value]),
      )
      expect(fields).toEqual({ f: 'changed', g: '2' })

      await driver.editElement(`${PREFIX}el-hash`, { op: 'delete', member: 'f' }, DB)
      const after = Object.fromEntries(
        ((await driver.value(`${PREFIX}el-hash`, DB, 10)).fields ?? []).map(item => [item.field, item.value]),
      )
      expect(after).toEqual({ g: '2' })
    })

    it('changes a zset score, adds a member, and removes one', async () => {
      await driver.createKey({ key: `${PREFIX}el-zset`, type: 'zset', members: [{ member: 'm', score: '1' }] }, DB)

      // ZADD with an existing member updates its score in place.
      await driver.editElement(`${PREFIX}el-zset`, { op: 'set', member: 'm', value: '9' }, DB)
      await driver.editElement(`${PREFIX}el-zset`, { op: 'add', member: 'n', value: '5' }, DB)

      const members = Object.fromEntries(
        ((await driver.value(`${PREFIX}el-zset`, DB, 10)).members ?? []).map(item => [item.member, item.score]),
      )
      expect(members).toEqual({ m: '9', n: '5' })

      await driver.editElement(`${PREFIX}el-zset`, { op: 'delete', member: 'm' }, DB)
      const left = ((await driver.value(`${PREFIX}el-zset`, DB, 10)).members ?? []).map(item => item.member)
      expect(left).toEqual(['n'])
    })

    it('refuses a non-numeric zset score', async () => {
      await driver.createKey({ key: `${PREFIX}el-bad`, type: 'zset', members: [{ member: 'm', score: '1' }] }, DB)
      await expect(driver.editElement(`${PREFIX}el-bad`, { op: 'set', member: 'm', value: 'abc' }, DB))
        .rejects.toThrow(/分值不是数字/)
    })

    it('refuses a mismatched operation for the key\'s real type', async () => {
      await driver.createKey({ key: `${PREFIX}el-mismatch`, type: 'string', value: 'v' }, DB)
      await expect(driver.editElement(`${PREFIX}el-mismatch`, { op: 'set', index: 0, value: 'x' }, DB))
        .rejects.toThrow(/不支持元素编辑/)
    })

    it('reports when the last element\'s removal deleted the key', async () => {
      await driver.createKey({ key: `${PREFIX}el-last`, type: 'list', items: ['only'] }, DB)
      const result = await driver.editElement(`${PREFIX}el-last`, { op: 'delete', index: 0 }, DB)
      // Redis removes a collection key once its last element goes; the panel has
      // to know so it does not keep showing a key that is gone.
      expect(result.removed).toBe(true)
      expect(result.ttl).toBe(-2)
    })

    it('refuses to edit a missing key', async () => {
      await expect(driver.editElement(`${PREFIX}ghost-el`, { op: 'push', value: 'x' }, DB)).rejects.toThrow(/不存在/)
    })
  })
})
