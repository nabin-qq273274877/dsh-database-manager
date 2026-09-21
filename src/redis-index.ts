/**
 * Keyspace index: a complete folder tree for one database, built once and cached.
 *
 * ## Why this exists
 *
 * Redis has no prefix index, and `SCAN MATCH p:*` still walks the ENTIRE keyspace
 * to find the keys matching `p:*`. So listing any level of a database costs a full
 * traversal — not "one level's worth". Measured on a production database of 19.5M
 * keys, listing a level meant ~600 MiB of key names over the wire and ~230 s.
 *
 * Layered lazy loading therefore does NOT make a huge database usable: opening the
 * root, then `goods`, then `goods:collect` would pay a full traversal THREE times.
 * The index inverts that: traverse once, keep the whole structure, and every later
 * level is answered from memory.
 *
 * ## Shape
 *
 * The index is FLAT — a list of folders plus direct key names per level — and a
 * level is derived by filtering on `parent`. A nested structure would nest the
 * memory too, and the flat form makes the merge trivial to test without Redis.
 *
 * ## Aggregation, not key names
 *
 * Batches arrive pre-aggregated (see the driver's Lua path): a batch reports
 * ancestor path deltas and only the direct key NAMES, so a folder holding 19M keys
 * costs a few bytes per batch rather than 19M names. Key names are retained up to a
 * display cap, because rows are what the tree shows.
 */

import { SEPARATOR } from './redis-util.ts'

/**
 * Ceiling on direct key names retained per level.
 *
 * The tree shows at most this many rows for one level (the page's own cap), so
 * retaining more would only cost memory. The COUNT is unaffected — it is tracked
 * separately, so "showing the first N of M" stays accurate.
 */
export const INDEX_KEYS_PER_LEVEL = 5000

/**
 * Ceiling on total folders held, as a guard against a pathological keyspace.
 *
 * Exceeding it is a FAILURE, not a truncation — see {@link mergeBatch}. A keyspace
 * with more folders than this is not a tree anyone can read, but the answer to that
 * is a mode that says so, never a folder list that is quietly missing entries.
 */
export const INDEX_MAX_FOLDERS = 200_000

/** One folder in the index. */
export interface IndexFolder {
  /** The last `:`-separated segment, i.e. what its row displays. */
  name: string
  /** Full path from the database root, no trailing separator. `''` is the root. */
  path: string
  /** Parent path; `''` for a top-level folder. */
  parent: string
  /** How many keys sit at or under this folder. */
  keys: number
}

/**
 * One batch of aggregation results, as produced by a server-side fold.
 *
 * `folderDeltas` counts each ANCESTOR path a key belongs to (so a folder's number
 * includes its whole subtree), `directCounts` counts the keys sitting exactly at a
 * level, and `leaves` holds a bounded sample of those keys' names for drawing rows.
 */
export interface IndexBatch {
  /** `path -> how many keys this batch found at or under it`. */
  folderDeltas: Map<string, number>
  /** `level path -> how many keys sit directly at it`. */
  directCounts: Map<string, number>
  /** `level path -> a bounded sample of direct key names`. */
  leaves: Map<string, string[]>
  /** How many keys this batch examined. */
  visited: number
}

/** The accumulated state of one database's keyspace. */
export interface KeyspaceIndex {
  db: number
  /** Folder path -> its row, including an entry for `''` (the root). */
  folders: Map<string, IndexFolder>
  /** Direct key names per level path. */
  leaves: Map<string, string[]>
  /** Direct key count per level, which may exceed the retained names. */
  leafCounts: Map<string, number>
  /** How many keys this database holds (DBSIZE). */
  dbSize: number
  /** How many keys the walk has examined so far. */
  visited: number
  /** SCAN cursor to resume from; `'0'` when the walk is finished. */
  cursor: string
  /** True once the walk reached the end of the keyspace. */
  done: boolean
  /** Set when the walk failed; the index is then unusable but honest about it. */
  error?: string
  startedAt: number
  updatedAt: number
}

/** Start an empty index for one database. */
export function createIndex(db: number, dbSize: number): KeyspaceIndex {
  return {
    db,
    folders: new Map([[ '', { name: '', path: '', parent: '', keys: 0 } ]]),
    leaves: new Map(),
    leafCounts: new Map(),
    dbSize,
    visited: 0,
    cursor: '0',
    done: false,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/**
 * Add one key to a finished index, without re-walking the keyspace.
 *
 * A create is a single key, so its effect on the tree is confined to that key's
 * ancestors and its own level — no rescan is warranted. Keeping the index truthful
 * this way is what lets the cache survive writes, which is the difference between a
 * usable large database and one that rebuilds for minutes after every edit.
 *
 * Ignored when the key is already indexed, so a repeated create cannot double-count.
 */
export function addKey(index: KeyspaceIndex, key: string): void {
  const { parent, name } = keyParent(key)

  const existingNames = index.leaves.get(parent)
  if (existingNames !== undefined && existingNames.includes(name)) return

  index.leafCounts.set(parent, (index.leafCounts.get(parent) ?? 0) + 1)
  if (existingNames === undefined) {
    index.leaves.set(parent, [name])
  } else if (existingNames.length < INDEX_KEYS_PER_LEVEL) {
    existingNames.push(name)
  }

  // Every ancestor folder grows by one, including any folder the key's own path
  // names (see `levelFromIndex` on why a folder counts its own-name key).
  for (const ancestor of ancestorPaths(key)) {
    ensureFolder(index, ancestor)
    index.folders.get(ancestor)!.keys += 1
  }
  index.dbSize += 1
  index.updatedAt = Date.now()
}

/**
 * Remove one key from the index, without re-walking the keyspace.
 *
 * The mirror of {@link addKey}. A key that is not indexed is ignored, so a repeated
 * delete cannot drive a count negative.
 */
export function removeKey(index: KeyspaceIndex, key: string): void {
  const { parent, name } = keyParent(key)
  const names = index.leaves.get(parent)
  const at = names === undefined ? -1 : names.indexOf(name)
  if (at === -1) return

  names!.splice(at, 1)
  const count = index.leafCounts.get(parent) ?? 0
  if (count <= 1) index.leafCounts.delete(parent)
  else index.leafCounts.set(parent, count - 1)

  for (const ancestor of ancestorPaths(key)) {
    const folder = index.folders.get(ancestor)
    if (folder !== undefined) folder.keys = Math.max(0, folder.keys - 1)
  }
  index.dbSize = Math.max(0, index.dbSize - 1)
  index.updatedAt = Date.now()
}

/**
 * Remove everything under one folder path from the index.
 *
 * Used after a folder delete, where the server has already removed the keys: the
 * index drops the subtree rather than re-walking the database to discover what is
 * gone. `path` itself is removed too, mirroring the delete, which takes the folder's
 * own-name key along with its descendants.
 */
export function removePrefix(index: KeyspaceIndex, path: string): number {
  const prefix = path === '' ? '' : `${path}${SEPARATOR}`
  let removedKeys = 0

  for (const [parent, names] of index.leaves) {
    if (parent !== path && !parent.startsWith(prefix)) continue
    removedKeys += names.length
    index.leaves.delete(parent)
    index.leafCounts.delete(parent)
  }

  /**
   * The delete takes the folder's own-name key too.
   *
   * `a:b` being both a folder and a key is the case this handles: `a:b` lives in
   * `leaves['a']` as the name `b`, and removing it needs an explicit edit there —
   * the loop above only clears levels AT or UNDER the path, and the key's own level
   * is its parent, which is outside the prefix.
   *
   * Missing this left a deleted key listed in the tree, which is the one outcome a
   * cache like this must never produce.
   */
  if (path !== '') {
    const { parent, name } = keyParent(path)
    const names = index.leaves.get(parent)
    const at = names === undefined ? -1 : names.indexOf(name)
    if (at !== -1) {
      names!.splice(at, 1)
      removedKeys += 1
      const count = index.leafCounts.get(parent) ?? 0
      if (count <= 1) index.leafCounts.delete(parent)
      else index.leafCounts.set(parent, count - 1)
    }
  }

  for (const key of [...index.folders.keys()]) {
    if (key === '' || key === path || key.startsWith(prefix)) index.folders.delete(key)
  }

  // Ancestors keep their identity but lose the subtree they counted. The path's own
  // ancestors are included because the own-name key above belongs to them as well.
  const affected = new Set([...ancestorPaths(path), ...ancestorPaths(prefix)])
  for (const ancestor of affected) {
    const folder = index.folders.get(ancestor)
    if (folder !== undefined) folder.keys = Math.max(0, folder.keys - removedKeys)
  }
  index.dbSize = Math.max(0, index.dbSize - removedKeys)
  index.updatedAt = Date.now()
  return removedKeys
}

/** Ensure a folder row exists for a path, creating any missing ancestors. */
function ensureFolder(index: KeyspaceIndex, path: string): void {
  if (index.folders.has(path)) return
  const at = path.lastIndexOf(SEPARATOR)
  index.folders.set(path, {
    name: at === -1 ? path : path.slice(at + 1),
    path,
    parent: at === -1 ? '' : path.slice(0, at),
    keys: 0,
  })
}

/**
 * The ancestor folder paths a key belongs to.
 *
 * For `a:b:c` this is `['a', 'a:b']` — every proper prefix, which is what makes a
 * folder's count cover its whole subtree. The full key is excluded: it is a KEY at
 * its own level, not a folder containing itself.
 *
 * A key that is ALSO a folder (`a:b` alongside `a:b:c`) is handled by the caller,
 * which counts it into the `a:b` folder because deleting that folder removes it
 * too — the number a user checks before confirming a delete.
 */
export function ancestorPaths(key: string): string[] {
  const out: string[] = []
  let at = key.indexOf(SEPARATOR)
  while (at !== -1) {
    out.push(key.slice(0, at))
    at = key.indexOf(SEPARATOR, at + 1)
  }
  return out
}

/** The parent level of a key, and the leaf name it would display. */
export function keyParent(key: string): { parent: string; name: string } {
  const at = key.lastIndexOf(SEPARATOR)
  return at === -1
    ? { parent: '', name: key }
    : { parent: key.slice(0, at), name: key.slice(at + 1) }
}

/**
 * Rebuild a full key from its level path and leaf name.
 *
 * The inverse of {@link keyParent}. An empty leaf is preserved rather than elided:
 * `trailing:` is a real key whose leaf name is the empty string, and dropping it
 * would make that key unreachable in the tree.
 */
export function joinKey(prefix: string, leaf: string): string {
  return prefix === '' ? leaf : `${prefix}${SEPARATOR}${leaf}`
}

/**
 * Fold a batch of raw key names into an aggregate, on the host.
 *
 * This is the FALLBACK for a server where Lua is unavailable. It is correct and
 * needs no special support, but it pays the cost that makes the Lua path worth
 * having: every name must cross the network, which measured ~600 MiB for one 19.5M
 * key database. Keeping both paths means the feature degrades in SPEED rather than
 * in correctness on an EVAL-disabled server (some managed Redis offerings).
 *
 * Duplicate names are collapsed, because SCAN is at-least-once: a key may be
 * returned twice while the hash table rehashes, and counting it twice would
 * over-report every ancestor folder.
 */
export function foldNames(names: readonly string[]): IndexBatch {
  const folderDeltas = new Map<string, number>()
  const directCounts = new Map<string, number>()
  const leaves = new Map<string, string[]>()
  const seen = new Set<string>()

  for (const name of names) {
    if (seen.has(name)) continue
    seen.add(name)

    const { parent, name: leaf } = keyParent(name)
    directCounts.set(parent, (directCounts.get(parent) ?? 0) + 1)
    const held = leaves.get(parent)
    if (held === undefined) leaves.set(parent, [leaf])
    else held.push(leaf)

    for (const ancestor of ancestorPaths(name)) {
      folderDeltas.set(ancestor, (folderDeltas.get(ancestor) ?? 0) + 1)
    }
  }

  return { folderDeltas, directCounts, leaves, visited: seen.size }
}

/**
 * Fold one aggregated batch into the index.
 *
 * Pure and total: it only adds, so batches may arrive in any order and a duplicate
 * batch would over-count. The caller is responsible for advancing the cursor, which
 * Redis guarantees visits each key at least once and possibly more — which is why
 * the driver dedupes within a batch and the tree is rebuilt rather than trusted
 * after writes.
 */
export function mergeBatch(index: KeyspaceIndex, batch: IndexBatch): KeyspaceIndex {
  for (const [path, delta] of batch.folderDeltas) {
    const existing = index.folders.get(path)
    if (existing === undefined) {
      /**
       * Hitting the folder ceiling ABORTS the index instead of skipping folders.
       *
       * Skipping was the earlier behaviour and it produced exactly the defect this
       * file exists to prevent: a folder list that is short with nothing saying so,
       * which is what a user reads to decide whether a database holds something and
       * whether a folder is safe to delete. A ceiling that is reached is therefore
       * reported as an error — the walk stops, `indexProgress` carries the reason,
       * and the panel shows it. "Could not build an index for this keyspace" is a
       * worse EXPERIENCE than a short list but a far better ANSWER, because it is
       * true.
       */
      if (index.folders.size >= INDEX_MAX_FOLDERS) {
        index.error =
          `this database has more than ${INDEX_MAX_FOLDERS.toLocaleString()} distinct folders, ` +
          'which is beyond what the keyspace index is built to hold. Browse it with a filter, ' +
          'or use the per-level scan on a narrower folder.'
        index.done = false
        return index
      }
      const at = path.lastIndexOf(SEPARATOR)
      index.folders.set(path, {
        name: at === -1 ? path : path.slice(at + 1),
        path,
        parent: at === -1 ? '' : path.slice(0, at),
        keys: delta,
      })
    } else {
      existing.keys += delta
    }
  }

  for (const [parent, count] of batch.directCounts) {
    index.leafCounts.set(parent, (index.leafCounts.get(parent) ?? 0) + count)
  }

  for (const [parent, names] of batch.leaves) {
    const held = index.leaves.get(parent)
    if (held === undefined) {
      index.leaves.set(parent, names.slice(0, INDEX_KEYS_PER_LEVEL))
    } else if (held.length < INDEX_KEYS_PER_LEVEL) {
      // A level may span several batches, so the retained names accumulate up to
      // the display cap; `leafCounts` keeps growing regardless, so "showing the
      // first N of M" stays accurate.
      for (const name of names) {
        if (held.length >= INDEX_KEYS_PER_LEVEL) break
        held.push(name)
      }
    }
  }

  index.visited += batch.visited
  index.updatedAt = Date.now()
  return index
}

/**
 * One folder row for a level, plus the keys sitting directly at it.
 *
 * `keys` holds FULL key paths, matching what `driver.level()` returns. The row
 * renderer derives each leaf label from the last segment, so a level's own-name key
 * reconstructs correctly — storing leaf names instead would make that one
 * unrebuildable, since it would read as a segment under its own prefix.
 */
export interface IndexLevel {
  folders: Array<{ name: string; path: string; keys: number }>
  keys: string[]
  /** How many direct keys this level holds, which may exceed `keys.length`. */
  keysAtLevel: number
  /**
   * True while the walk is unfinished, so this level is TEMPORARILY incomplete.
   *
   * The walk covers the whole keyspace, so `partial` is the only reason a level can
   * be missing rows or folders — and it resolves on its own. There is no "finished
   * but approximate" state: that would describe a truncation, which is the defect
   * this index exists to avoid.
   */
  partial: boolean
  /**
   * Keys walked so far, and the database's total, for a still-building level's notice.
   *
   * Present ONLY when `partial` is true. The notice says how much of the walk is
   * done, and these are the honest numbers for an unfinished walk. Without them the
   * UI fell back to zeroes and read "该库共 0 个键，此处仅扫描了 0 个", which is worse
   * than saying nothing: it states a wrong database size.
   */
  visited?: number
  dbSize?: number
}

/**
 * Whether a path is ALSO a key, derived from the index alone.
 *
 * `a:b` is a folder (because `a:b:c` exists) and may independently be a key. The
 * index already records that: `leaves['a']` holds the direct key names at level `a`,
 * so `a:b` being a key shows up as `'b'` appearing there.
 *
 * This matters for one number only, but it is the number a user reads before
 * confirming a delete: a folder row states what deleting it removes, and deleting
 * `a:b` takes the `a:b` key as well as everything under it. Deriving it here keeps
 * that rule in one place instead of duplicating it across add, remove and query.
 */
export function isKeyAtIndex(index: KeyspaceIndex, path: string): boolean {
  if (path === '') return false
  const { parent, name } = keyParent(path)
  const names = index.leaves.get(parent)
  return names !== undefined && names.includes(name)
}

/**
 * The children of one level, answered from the index.
 *
 * A folder's row reports its whole subtree PLUS the key of its own name, matching
 * what a delete would remove — see {@link isKeyAtIndex}.
 *
 * @param prefix - the level's path; `''` for the database root.
 */
export function levelFromIndex(index: KeyspaceIndex, prefix: string, compare: (a: string, b: string) => number): IndexLevel {
  const folders: Array<{ name: string; path: string; keys: number }> = []
  for (const folder of index.folders.values()) {
    if (folder.parent !== prefix || folder.path === '') continue
    folders.push({
      name: folder.name,
      path: folder.path,
      keys: folder.keys + (isKeyAtIndex(index, folder.path) ? 1 : 0),
    })
  }
  folders.sort((a, b) => compare(a.name, b.name))

  const keys = (index.leaves.get(prefix) ?? []).map(name => joinKey(prefix, name))
  /**
   * A level's OWN name may also be a key, and its row belongs here.
   *
   * When `prefix` is `a:b`, that key's FULL name is `a:b` — this level is the only
   * place it can be clicked, so it is listed alongside the level's other keys.
   */
  let keysAtLevel = index.leafCounts.get(prefix) ?? 0
  if (prefix !== '' && isKeyAtIndex(index, prefix)) {
    keys.push(prefix)
    keysAtLevel += 1
  }
  keys.sort(compare)

  return {
    folders,
    keys,
    keysAtLevel,
    partial: !index.done,
    // Only meaningful while the walk is unfinished; a finished index has covered
    // everything, so the UI shows no notice at all and these would be redundant.
    ...(index.done ? {} : { visited: index.visited, dbSize: index.dbSize }),
  }
}

/**
 * The index's progress, for reporting to a waiting user.
 *
 * `visited` against `dbSize` is what makes a long build tolerable: it is a real
 * measure of the work done, so the UI can show a percentage instead of a spinner
 * of unknown length.
 */
export function indexProgress(index: KeyspaceIndex): {
  db: number
  dbSize: number
  visited: number
  folders: number
  done: boolean
  error?: string
} {
  return {
    db: index.db,
    dbSize: index.dbSize,
    visited: index.visited,
    folders: Math.max(index.folders.size - 1, 0),
    done: index.done,
    ...(index.error === undefined ? {} : { error: index.error }),
  }
}

/** One aggregated batch, as the walker needs it (structurally the driver's reply). */
export interface IndexBatchSource {
  aggregateBatch(input: {
    db: number
    cursor: string
    batchKeys: number
    nameBudget: number
  }): Promise<{
    cursor: string
    visited: number
    folderDeltas: Map<string, number>
    directCounts: Map<string, number>
    leaves: Map<string, string[]>
  } | null>
}

/**
 * How many keys one aggregation call may examine.
 *
 * This is a SAFETY value, not a speed one. Redis executes a script on its single
 * thread, so every millisecond a call takes is a millisecond every other client of
 * that server waits. Measured at 100k keys a call blocked for 271-708 ms, which is
 * already noticeable on a server carrying live traffic; 20k keeps the pause in the
 * tens of milliseconds while still amortizing the round trip.
 *
 * A smaller batch does not make the walk slower in total — the server's traversal
 * rate is the limit either way — it only divides the same work into more, shorter
 * pauses.
 */
export const INDEX_BATCH_KEYS = 20_000

/** Cap on key names one call returns, so a reply stays small on a huge level. */
const INDEX_NAME_BUDGET_PER_CALL = 5_000

/** Outcome of one advance of the walk. */
export interface IndexAdvance {
  /** Progress after this step. */
  progress: ReturnType<typeof indexProgress>
  /** True when this step finished the walk. */
  done: boolean
}

/**
 * Advance a keyspace walk by ONE bounded step.
 *
 * The walk is deliberately not a single long call: it is driven from the caller so
 * the server can be paused between batches, and so a huge database can be built
 * while the user watches progress instead of waiting on one opaque request.
 *
 * Returns whether this step completed the walk, so a caller can loop. A server that
 * refuses scripting makes `aggregateBatch` return null, which is reported as an
 * error rather than silently producing an empty tree — a caller must be able to tell
 * "no folders" from "could not find out".
 */
export async function advanceIndex(
  source: IndexBatchSource,
  index: KeyspaceIndex,
): Promise<IndexAdvance> {
  if (index.done) return { progress: indexProgress(index), done: true }

  const batch = await source.aggregateBatch({
    db: index.db,
    cursor: index.cursor,
    batchKeys: INDEX_BATCH_KEYS,
    nameBudget: INDEX_NAME_BUDGET_PER_CALL,
  })

  if (batch === null) {
    index.error = 'this Redis server does not support scripting (EVAL), so a big database cannot be indexed quickly'
    // Reported, not thrown: the caller decides whether to fall back or surface it.
    return { progress: indexProgress(index), done: false }
  }

  mergeBatch(index, {
    folderDeltas: batch.folderDeltas,
    directCounts: batch.directCounts,
    leaves: batch.leaves,
    visited: batch.visited,
  })

  /**
   * A merge that refused the batch (the folder ceiling) leaves the index UNUSABLE,
   * so the walk stops here rather than advancing the cursor: carrying on would keep
   * the traversal loading the server to build a tree nobody can trust. The reason is
   * already on the index, and `done` stays false so callers do not read it as a
   * finished — and therefore complete — result.
   */
  if (index.error !== undefined) return { progress: indexProgress(index), done: false }

  index.cursor = batch.cursor
  index.done = batch.cursor === '0'
  return { progress: indexProgress(index), done: index.done }
}
