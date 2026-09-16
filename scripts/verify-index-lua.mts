/**
 * Verify the Lua aggregation against the EXISTING level scanner, on a local Redis.
 *
 * The index is a second implementation of the same tree, which is exactly the
 * situation where two code paths silently disagree. This is the check that they
 * agree: for each level of a fixture keyspace it compares
 *
 *   - the folder set and each folder's key count, against `driver.level()`, whose
 *     behaviour is already pinned by the tree and edit test suites, and
 *   - the direct key names at each level.
 *
 * A local database only. `aggregateBatch` walks the keyspace, which is CPU-heavy on
 * the server, so pointing this at production would repeat a mistake that already
 * caused an incident — see AGENTS.md.
 *
 * Usage: npx tsx scripts/verify-index-lua.mts [port] [db]
 */

import { SEPARATOR } from '../src/redis-util.ts'
import { createIndex, indexProgress, levelFromIndex, mergeBatch } from '../src/redis-index.ts'

const { RedisDriver } = await import('../src/drivers/redis.ts')

const port = Number(process.argv[2] ?? 6379)
const db = Number(process.argv[3] ?? 12)

const entry = {
  id: 'verify', kind: 'redis' as const, name: 'verify', group: '', tags: [], description: '',
  host: '127.0.0.1', port, db, readonly: false, connectTimeoutMs: 15000,
  createdAt: Date.now(), updatedAt: Date.now(),
}

/** The fixture: nesting, a key that is also a folder, a 1-key folder, odd segments. */
const FIXTURE = [
  'jd:order:1', 'jd:order:2', 'jd:user:1', 'jd:top', 'jd:deep:nested:key',
  'other:key', 'plain',
  'a:b', 'a:b:c', 'a:b:c:d',
  'rare:only',
  'weird::double', 'trailing:',
  'goods:item:100', 'goods:item:200', 'goods:item:300',
]

const driver = new RedisDriver(entry as never)
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

try {
  // Seed on the local instance only. `createKey` rather than `setString`: the
  // latter edits an existing key's value and refuses to invent one.
  await driver.deletePrefix('', db).catch(() => undefined)
  for (const key of FIXTURE) {
    await driver.createKey({ key, type: 'string', value: 'v' }, db)
  }
  const dbSize = await driver.keyCount(db)
  console.log(`seeded db${db} on 127.0.0.1:${port}: DBSIZE=${dbSize}\n`)

  // ---- Build the index from the Lua aggregation, resuming the cursor. ----
  const index = createIndex(db, dbSize)
  let cursor = '0'
  let calls = 0
  let usedLua = true
  do {
    const batch = await driver.aggregateBatch({ db, cursor, batchKeys: 5, nameBudget: 1000 })
    if (batch === null) { usedLua = false; break }
    calls++
    cursor = batch.cursor
    mergeBatch(index, {
      folderDeltas: batch.folderDeltas,
      directCounts: batch.directCounts,
      leaves: batch.leaves,
      visited: batch.visited,
    })
  } while (cursor !== '0')
  index.done = true

  if (!usedLua) {
    console.log('EVAL is unavailable on this server — the Lua path cannot be verified here')
    process.exit(0)
  }

  const progress = indexProgress(index)
  console.log(`index built from ${calls} Lua calls: ${progress.folders} folders, ` +
    `visited ${progress.visited}/${dbSize}\n`)

  // ---- Compare EVERY level against driver.level(), the trusted implementation. ----
  const levelsToCheck = ['', 'jd', 'jd:order', 'jd:deep', 'jd:deep:nested', 'a', 'a:b', 'a:b:c', 'goods', 'goods:item', 'rare', 'weird']
  let failures = 0

  for (const prefix of levelsToCheck) {
    const fromIndex = levelFromIndex(index, prefix, compare)
    const fromDriver = await driver.level({ db, prefix, withTypes: false })

    const indexFolders = fromIndex.folders.map(f => `${f.name}=${f.keys}`).sort()
    const driverFolders = fromDriver.folders.map(f => `${f.name}=${f.keys}`).sort()
    // The driver adds a folder's own-name key to its count; the index derives the
    // same rule from its own data, so the numbers must match exactly.
    const foldersMatch = JSON.stringify(indexFolders) === JSON.stringify(driverFolders)

    // Both sides report FULL key names, so no normalisation is needed. Joining
    // again here (as an earlier version of this check did) produced names like
    // `jd:jd:top` and reported nine false mismatches.
    const indexKeys = fromIndex.keys.slice().sort()
    const driverKeys = fromDriver.keys.map(k => k.key).sort()
    const keysMatch = JSON.stringify(indexKeys) === JSON.stringify(driverKeys)
    const countMatches = fromIndex.keysAtLevel === fromDriver.keysAtLevel

    const ok = foldersMatch && keysMatch && countMatches
    if (!ok) failures++
    console.log(`${ok ? 'OK  ' : 'FAIL'} level ${JSON.stringify(prefix)}: ` +
      `${indexFolders.length} folders, ${indexKeys.length} keys (keysAtLevel ${fromIndex.keysAtLevel})`)
    if (!foldersMatch) {
      console.log(`       index  folders: ${indexFolders.join(', ')}`)
      console.log(`       driver folders: ${driverFolders.join(', ')}`)
    }
    if (!keysMatch) {
      console.log(`       index  keys: ${indexKeys.join(', ')}`)
      console.log(`       driver keys: ${driverKeys.join(', ')}`)
    }
    if (!countMatches) {
      console.log(`       keysAtLevel index=${fromIndex.keysAtLevel} driver=${fromDriver.keysAtLevel}`)
    }
  }

  // ---- The tree must be complete: every seeded key reachable from the root. ----
  //
  // `levelFromIndex` returns FULL key names (as `driver.level()` does), so the walk
  // records them directly rather than re-joining with the prefix — joining again
  // produced names like `jd:jd:order:1` and reported every key as missing.
  const reachable = new Set<string>()
  const walk = (prefix: string): void => {
    const level = levelFromIndex(index, prefix, compare)
    for (const key of level.keys) reachable.add(key)
    for (const folder of level.folders) walk(folder.path)
  }
  walk('')

  const missing = FIXTURE.filter(key => !reachable.has(key))
  console.log(`\nreachable from the root: ${reachable.size}/${FIXTURE.length}`)
  if (missing.length > 0) {
    console.log(`MISSING: ${missing.join(', ')}`)
    failures++
  }

  console.log(failures === 0
    ? '\nALL LEVELS AGREE — the Lua index matches the trusted scanner'
    : `\n${failures} MISMATCH(ES)`)
} catch (error) {
  console.error('VERIFY ERROR:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  try {
    for (const key of FIXTURE) await driver.deleteKey(key, db)
  } catch { /* best effort */ }
  await driver.close()
}
