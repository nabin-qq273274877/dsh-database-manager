/**
 * Keyspace index tests: the pure tree logic, with no Redis involved.
 *
 * The behaviour under test is what makes a huge database usable at all. Redis has
 * no prefix index and `SCAN MATCH p:*` still walks the whole keyspace, so listing a
 * level costs a full traversal; the index pays that once and answers every later
 * level from memory. The tests therefore concentrate on the properties that would
 * make the cached tree WRONG rather than merely slow:
 *
 *  - no folder is missing, including ones holding a single key (the reason sampling
 *    was rejected: a 19.5M-key database had folders with 1 key each);
 *  - a folder's count equals what deleting it removes, which is the number a user
 *    checks before confirming a destructive action;
 *  - duplicate keys from SCAN's at-least-once behaviour do not inflate anything;
 *  - an incomplete walk is reported as incomplete rather than passed off as final.
 */

import { describe, expect, it } from 'vitest'
import {
  INDEX_KEYS_PER_LEVEL,
  INDEX_MAX_FOLDERS,
  addKey,
  advanceIndex,
  ancestorPaths,
  createIndex,
  foldNames,
  indexProgress,
  joinKey,
  keyParent,
  levelFromIndex,
  mergeBatch,
  removeKey,
  removePrefix,
  type KeyspaceIndex,
} from '../src/redis-index.ts'

/** The comparator the tree uses; code-unit order is enough for these fixtures. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Build an index from raw key names in one batch, as the host fallback would. */
function indexOf(keys: readonly string[], dbSize = keys.length): KeyspaceIndex {
  const index = createIndex(0, dbSize)
  mergeBatch(index, foldNames(keys))
  index.done = true
  return index
}

describe('ancestorPaths', () => {
  it('lists every proper prefix, which is what makes a folder count its subtree', () => {
    expect(ancestorPaths('a:b:c')).toEqual(['a', 'a:b'])
    expect(ancestorPaths('a:b')).toEqual(['a'])
    expect(ancestorPaths('plain')).toEqual([])
  })

  it('does not include the key itself', () => {
    // A key is not a folder of its own name; it is a KEY at its own level.
    expect(ancestorPaths('a')).toEqual([])
  })

  it('treats an empty segment as a real segment', () => {
    // `a::b` is a legitimate Redis key, so `a` and `a:` are both ancestors.
    expect(ancestorPaths('a::b')).toEqual(['a', 'a:'])
  })
})

describe('keyParent', () => {
  it('splits on the last separator, so a leaf name is one segment', () => {
    expect(keyParent('a:b:c')).toEqual({ parent: 'a:b', name: 'c' })
    expect(keyParent('plain')).toEqual({ parent: '', name: 'plain' })
    expect(keyParent('a:')).toEqual({ parent: 'a', name: '' })
  })
})

describe('building a level tree', () => {
  it('groups keys into folders at the root', () => {
    const index = indexOf(['jd:order:1', 'jd:order:2', 'jd:user:1', 'jd:top', 'other:key', 'plain'])

    const root = levelFromIndex(index, '', compare)
    expect(root.folders.map(folder => folder.name)).toEqual(['jd', 'other'])
    expect(root.folders.find(folder => folder.name === 'jd')!.keys).toBe(4)
    expect(root.folders.find(folder => folder.name === 'other')!.keys).toBe(1)
    // `plain` has no separator, so it is a key at the root.
    expect(root.keys).toEqual(['plain'])
    expect(root.keysAtLevel).toBe(1)
  })

  it('nests to the depth the keys require', () => {
    const index = indexOf(['a:b:c:d', 'a:b:e'])

    expect(levelFromIndex(index, 'a', compare).folders.map(f => f.name)).toEqual(['b'])
    // `a:b:e` has no further separator, so `e` is a KEY at `a:b` — alongside the
    // `c` folder that `a:b:c:d` creates. Keys are reported as FULL paths.
    const atAb = levelFromIndex(index, 'a:b', compare)
    expect(atAb.folders.map(f => f.name)).toEqual(['c'])
    expect(atAb.keys).toEqual(['a:b:e'])
    expect(levelFromIndex(index, 'a:b:c', compare).keys).toEqual(['a:b:c:d'])
  })

  it('shows a level\'s own keys alongside its child folders', () => {
    // `a:b` is both a key and a folder prefix; both must be visible at `a`'s level.
    const index = indexOf(['a:b', 'a:b:c'])

    const atA = levelFromIndex(index, 'a', compare)
    expect(atA.folders.map(folder => folder.name)).toEqual(['b'])
    expect(atA.keys).toEqual(['a:b'])
  })

  it('keeps a key visible at the only level it can be opened from', () => {
    // The value of `a:b` is reachable only by clicking the row at `a`'s level, so
    // the index must not fold it away into the `a:b` folder.
    const index = indexOf(['a:b', 'a:b:c'])
    expect(levelFromIndex(index, 'a', compare).keys).toContain('a:b')
  })
})

describe('folder counts', () => {
  it('counts a whole subtree, so the number matches what a delete removes', () => {
    const index = indexOf(['a:b:1', 'a:b:2', 'a:c:1', 'a:direct'])

    const atA = levelFromIndex(index, 'a', compare)
    // 3 keys under `a:b`, 1 under `a:c`, plus `a:direct` at a's own level = 5.
    expect(atA.folders.find(folder => folder.name === 'b')!.keys).toBe(2)
    expect(atA.folders.find(folder => folder.name === 'c')!.keys).toBe(1)
    // `a` itself counts everything below it.
    expect(index.folders.get('a')!.keys).toBe(4)
  })

  it('does not lose a folder that holds a single key', () => {
    // The property that ruled out sampling: on a real 19.5M-key database, folders
    // with one key each existed, and a sampled walk reported a shorter folder list.
    const index = indexOf(['goods:a:1', 'goods:b:1', 'rare:only'])
    const root = levelFromIndex(index, '', compare)
    expect(root.folders.map(folder => folder.name)).toEqual(['goods', 'rare'])
    expect(root.folders.find(folder => folder.name === 'rare')!.keys).toBe(1)
  })

  it('is not inflated by a key being seen twice', () => {
    // SCAN is at-least-once: a key can be returned twice while the hash table
    // rehashes. Counting occurrences would over-report every ancestor.
    const index = indexOf(['jd:a', 'jd:b', 'jd:a', 'jd:b', 'jd:a'])
    const root = levelFromIndex(index, '', compare)
    expect(root.folders.find(folder => folder.name === 'jd')!.keys).toBe(2)
  })
})

describe('incremental merging', () => {
  it('accumulates counts across batches, as a long walk arrives in pieces', () => {
    const index = createIndex(0, 4)
    mergeBatch(index, foldNames(['a:1', 'a:2']))
    mergeBatch(index, foldNames(['a:3', 'b:1']))

    const root = levelFromIndex(index, '', compare)
    expect(root.folders.find(folder => folder.name === 'a')!.keys).toBe(3)
    expect(root.folders.find(folder => folder.name === 'b')!.keys).toBe(1)
    expect(index.visited).toBe(4)
  })

  it('reports a level as partial until the walk finishes', () => {
    // An unfinished index must never claim to be complete: the folder list is what
    // a user reads to decide whether a database is empty or a folder is safe.
    const index = createIndex(0, 100)
    mergeBatch(index, foldNames(['a:1']))
    expect(levelFromIndex(index, '', compare).partial).toBe(true)
    expect(indexProgress(index).done).toBe(false)

    index.done = true
    expect(levelFromIndex(index, '', compare).partial).toBe(false)
    expect(indexProgress(index).done).toBe(true)
  })

  it('carries the progress numbers a still-building level needs for its notice', () => {
    /*
     * The UI's notice says "索引构建中：已扫描 M / N，此层的目录与计数会随进度补齐".
     * A mid-walk level must therefore report BOTH numbers; leaving them unset made
     * the renderer fall back to zeroes, so the notice announced a database size of 0
     * — a confidently wrong number on the one screen whose job is to say the walk is
     * still running. The index knows both counts; they must travel with the level.
     *
     * This is the notice that REPLACED "该库共 N 个键，此处仅扫描了 M 个：目录可能不全，
     * 计数是下限", which described a defect (the scan's 200k-key budget) rather than a
     * normal state. A still-building index is the only temporary case left.
     */
    const index = createIndex(0, 100)
    mergeBatch(index, foldNames(['a:1', 'b:2', 'b:3']))

    const partial = levelFromIndex(index, '', compare)
    expect(partial.partial).toBe(true)
    expect(partial.visited).toBe(3)
    expect(partial.dbSize).toBe(100)

    // A finished walk has covered everything, so the notice is gone and the
    // numbers with it — a level is then exact and says nothing about coverage.
    index.done = true
    const complete = levelFromIndex(index, '', compare)
    expect(complete.partial).toBe(false)
    expect(complete.visited).toBeUndefined()
    expect(complete.dbSize).toBeUndefined()
  })

  it('reports progress against DBSIZE so a long build can be shown as a percentage', () => {
    const index = createIndex(3, 1000)
    mergeBatch(index, foldNames(['a:1', 'b:2']))
    const progress = indexProgress(index)
    expect(progress).toMatchObject({ db: 3, dbSize: 1000, visited: 2, done: false })
    expect(progress.folders).toBe(2)
  })
})

describe('bounded memory', () => {
  it('caps the names retained per level while keeping the count exact', () => {
    // A level can hold millions of keys. Holding every name would defeat the point
    // of the index, but the COUNT must stay truthful so the UI can say how many
    // rows were withheld.
    const many = Array.from({ length: INDEX_KEYS_PER_LEVEL + 250 }, (_, i) => `big:key-${i}`)
    const index = indexOf(many, many.length)

    const level = levelFromIndex(index, 'big', compare)
    expect(level.keys.length).toBe(INDEX_KEYS_PER_LEVEL)
    expect(level.keysAtLevel).toBe(INDEX_KEYS_PER_LEVEL + 250)
    // The folder count is unaffected by the row cap.
    expect(levelFromIndex(index, '', compare).folders[0]!.keys).toBe(INDEX_KEYS_PER_LEVEL + 250)
  })

  it('reports the folder ceiling as an error instead of quietly dropping folders', () => {
    /*
     * The defect this pins: `mergeBatch` used to `continue` past the folder ceiling,
     * so the index came back missing entries with nothing saying so — a folder list
     * that is short and looks complete, on the screen a user reads to decide whether
     * a folder is safe to delete. A ceiling that is reached is a FAILURE, and the
     * honest answer is to say the index could not be built.
     *
     * One batch carrying more folders than the ceiling is the cheapest way to reach
     * it: the limit is checked per new folder, so it trips as the batch is folded.
     */
    const manyFolders = Array.from({ length: INDEX_MAX_FOLDERS + 1 }, (_, i) => `f${i}:k`)
    const index = createIndex(0, manyFolders.length)
    mergeBatch(index, foldNames(manyFolders))

    expect(index.error).toBeDefined()
    expect(index.error).toMatch(/distinct folders/)
    // NOT `done`: a failed walk must never read as a completed — and therefore
    // complete — result, or the panel would present a short tree as the whole one.
    expect(index.done).toBe(false)
  })

  it('does not stop a walk that stays under the folder ceiling', () => {
    // The guard must not fire on an ordinary database, or every index would report a
    // failure. A handful of folders is the normal case.
    const index = createIndex(0, 3)
    mergeBatch(index, foldNames(['a:1', 'b:2', 'c:3']))

    expect(index.error).toBeUndefined()
    expect(levelFromIndex(index, '', compare).folders).toHaveLength(3)
  })
})

describe('indexProgress', () => {
  it('excludes the synthetic root from the folder count', () => {
    // The root is an implementation detail of `levelFromIndex`, not a folder a user
    // can see, so reporting it would overstate what was found.
    const index = indexOf(['a:1'])
    expect(indexProgress(index).folders).toBe(1)
  })

  it('carries an error through, so a failed build is visible rather than empty', () => {
    const index = createIndex(0, 10)
    index.error = 'connection lost'
    expect(indexProgress(index).error).toBe('connection lost')
  })
})

describe('levels report FULL key paths', () => {
  it('matches the driver\'s shape, so the row renderer needs no special case', () => {
    // `driver.level()` returns full key names and the tree derives each row's label
    // from the last segment. The index must agree, or a level's own-name key becomes
    // unrebuildable: the leaf of `a:b` at level `a:b` is `b`, which cannot be told
    // apart from a key named `b` there.
    const index = indexOf(['jd:order:1', 'plain'])
    expect(levelFromIndex(index, '', compare).keys).toEqual(['plain'])
    expect(levelFromIndex(index, 'jd:order', compare).keys).toEqual(['jd:order:1'])
  })

  it('includes a folder\'s own-name key in its own level AND its folder count', () => {
    // `a:b` is a key and a folder. It must be clickable at level `a:b` (the only
    // place its value can be reached) and counted into the `a:b` folder row (because
    // deleting that folder removes it too).
    const index = indexOf(['a:b', 'a:b:c'])

    expect(levelFromIndex(index, 'a:b', compare).keys).toContain('a:b')
    expect(levelFromIndex(index, 'a', compare).folders.find(f => f.name === 'b')!.keys).toBe(2)
  })

  it('handles a key whose leaf name is empty', () => {
    // `trailing:` ends with the separator, so its leaf name is the empty string. It
    // belongs to the `trailing` FOLDER (its parent), not to the root, and it must
    // still be counted — an empty name is a legitimate name, and filtering empty
    // names (as an early version did) made such keys unreachable in the tree.
    const index = indexOf(['trailing:'])
    const root = levelFromIndex(index, '', compare)

    expect(root.folders.map(folder => folder.name)).toContain('trailing')
    expect(root.folders.find(folder => folder.name === 'trailing')!.keys).toBe(1)
    // At the `trailing` level it is a key whose own name is empty; the level counts
    // it even though the empty label is not a row of its own.
    expect(levelFromIndex(index, 'trailing', compare).keysAtLevel).toBe(1)
  })
})

describe('incremental updates', () => {
  it('adds a key to a finished index without a rescan', () => {
    // A create is one key, so its effect on the tree is confined to its ancestors
    // and its own level. Keeping the cache truthful this way is what lets it survive
    // writes instead of rebuilding for minutes.
    const index = indexOf(['jd:a'])
    addKey(index, 'jd:b')

    const atJd = levelFromIndex(index, 'jd', compare)
    expect(atJd.keys).toEqual(['jd:a', 'jd:b'])
    expect(levelFromIndex(index, '', compare).folders[0]!.keys).toBe(2)
    expect(index.dbSize).toBe(2)
  })

  it('creates the folders a new key implies', () => {
    const index = indexOf(['seed:x'])
    addKey(index, 'brand:new:leaf')

    expect(levelFromIndex(index, '', compare).folders.map(f => f.name)).toContain('brand')
    expect(levelFromIndex(index, 'brand', compare).folders.map(f => f.name)).toEqual(['new'])
    expect(levelFromIndex(index, 'brand:new', compare).keys).toEqual(['brand:new:leaf'])
  })

  it('ignores a repeated add, so a double create cannot double-count', () => {
    const index = indexOf(['jd:a'])
    addKey(index, 'jd:a')
    expect(levelFromIndex(index, 'jd', compare).keys).toEqual(['jd:a'])
    expect(levelFromIndex(index, '', compare).folders[0]!.keys).toBe(1)
  })

  it('removes a key and decrements every ancestor', () => {
    const index = indexOf(['jd:a', 'jd:b'])
    removeKey(index, 'jd:a')

    expect(levelFromIndex(index, 'jd', compare).keys).toEqual(['jd:b'])
    expect(levelFromIndex(index, '', compare).folders[0]!.keys).toBe(1)
    expect(index.dbSize).toBe(1)
  })

  it('ignores removing a key that is not indexed, never going negative', () => {
    const index = indexOf(['jd:a'])
    removeKey(index, 'nope:x')
    removeKey(index, 'jd:a')
    removeKey(index, 'jd:a')
    expect(levelFromIndex(index, '', compare).folders[0]!.keys).toBe(0)
    expect(index.dbSize).toBe(0)
  })

  it('drops a whole subtree after a folder delete', () => {
    const index = indexOf(['jd:order:1', 'jd:order:2', 'jd:user:1', 'other:key'])
    const removed = removePrefix(index, 'jd:order')

    expect(removed).toBe(2)
    expect(levelFromIndex(index, 'jd', compare).folders.map(f => f.name)).toEqual(['user'])
    expect(levelFromIndex(index, '', compare).folders.find(f => f.name === 'jd')!.keys).toBe(1)
    expect(levelFromIndex(index, '', compare).folders.find(f => f.name === 'other')!.keys).toBe(1)
  })

  it('removes a folder\'s own-name key along with its subtree', () => {
    // A folder delete takes the path itself as well as its descendants, so the index
    // must drop that key too or the tree would keep offering a deleted key.
    const index = indexOf(['a:b', 'a:b:c'])
    const removed = removePrefix(index, 'a:b')
    const atA = levelFromIndex(index, 'a', compare)
    expect(atA.folders).toEqual([])
    expect(atA.keys).toEqual([])
    // Both the `a:b` key and its one descendant.
    expect(removed).toBe(2)
    expect(index.dbSize).toBe(0)
  })
})

describe('advanceIndex', () => {
  /** A source that hands back one pre-built batch, then claims to be finished. */
  function oneBatch(batch: ReturnType<typeof foldNames>) {
    let served = false
    return {
      async aggregateBatch() {
        if (served) return { cursor: '0', visited: 0, folderDeltas: new Map(), directCounts: new Map(), leaves: new Map() }
        served = true
        return { cursor: '0', ...batch }
      },
    }
  }

  it('stops the walk when the folder ceiling refuses a batch', async () => {
    /*
     * A refused merge leaves the index unusable, so the walk must NOT keep going:
     * carrying on would keep loading the server to build a tree nobody can trust.
     * The reason is already on the index; what this pins is that `advanceIndex`
     * reports `done: false` rather than reading the aborted walk as a finished —
     * and therefore complete — result.
     */
    const manyFolders = Array.from({ length: INDEX_MAX_FOLDERS + 1 }, (_, i) => `f${i}:k`)
    const index = createIndex(0, manyFolders.length)

    const advance = await advanceIndex(oneBatch(foldNames(manyFolders)), index)

    expect(index.error).toBeDefined()
    expect(advance.done).toBe(false)
    expect(advance.progress.done).toBe(false)
    expect(advance.progress.error).toMatch(/distinct folders/)
  })
})
