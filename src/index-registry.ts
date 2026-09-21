/**
 * Keyspace index registry: one cached tree per (data source, database).
 *
 * ## Why a registry rather than rebuilding per request
 *
 * A walk of a large database takes tens of seconds and loads the server. Doing it
 * per request would repeat that cost on every expand, which is exactly the problem
 * the index exists to remove. So a walk is started once, advanced in bounded steps,
 * and the finished tree is kept until something invalidates it.
 *
 * ## Why it advances in the background
 *
 * The first version advanced the walk inside the request that asked for a level.
 * That works for a small database but fails for the case the index is FOR: a huge
 * database would hold the request open for a minute, and the response would time out
 * before the tree could be shown. Background advancement decouples the two — a level
 * request answers from whatever has been indexed so far and says it is partial, and
 * the walk keeps going.
 *
 * ## Memory
 *
 * An index holds one row per FOLDER and a bounded page of key names per level, not
 * one entry per key, so a 19.5M-key database costs kilobytes rather than gigabytes.
 * An idle index is dropped after a TTL, and at most one walk runs per source at a
 * time so a user clicking around cannot stack traversals on a server.
 */

import {
  advanceIndex,
  createIndex,
  indexProgress,
  type IndexAdvance,
  type IndexBatchSource,
  type KeyspaceIndex,
} from './redis-index.ts'

/** How long a finished index is kept without use. */
const INDEX_IDLE_TTL_MS = 30 * 60 * 1000

/**
 * Pause between background steps.
 *
 * The walk deliberately does NOT run back to back: each step blocks the server
 * briefly (Redis is single-threaded), and holding the CPU continuously for a minute
 * is what made an earlier version trip a production alert. A short pause between
 * steps gives other clients room and keeps the load legible as "a burst of small
 * operations" rather than a sustained saturation.
 */
const STEP_PAUSE_MS = 50

/** One entry: the index, its walk state, and whether a step is in flight. */
interface IndexEntry {
  index: KeyspaceIndex
  /** Set while a background step is running, so steps never overlap. */
  stepping: boolean
  /** Set when the caller asked to stop; the loop exits after the current step. */
  cancelled: boolean
  /** Set when the loop is running, so only one loop exists per entry. */
  looping: boolean
  lastUsed: number
}

/**
 * The registry. One instance lives on the host half and is shared by the routes.
 */
export class IndexRegistry {
  private readonly entries = new Map<string, IndexEntry>()
  /** Resolve a source id to something whose batches can be aggregated. */
  private readonly resolveSource: (sourceId: string) => Promise<IndexBatchSource>

  constructor(resolveSource: (sourceId: string) => Promise<IndexBatchSource>) {
    this.resolveSource = resolveSource
  }

  /** Registry key: one index per source AND database. */
  private static key(sourceId: string, db: number): string {
    return `${sourceId}\u0000${db}`
  }

  /**
   * The cached index for one database, or undefined when none was built.
   *
   * @param touch - whether this counts as use, which extends the idle TTL. A status
   *   poll does, since the user is watching the walk.
   */
  get(sourceId: string, db: number, touch = true): KeyspaceIndex | undefined {
    this.evictIdle()
    const entry = this.entries.get(IndexRegistry.key(sourceId, db))
    if (entry === undefined) return undefined
    if (touch) entry.lastUsed = Date.now()
    return entry.index
  }

  /** Whether a walk is currently running for one database. */
  isBuilding(sourceId: string, db: number): boolean {
    const entry = this.entries.get(IndexRegistry.key(sourceId, db))
    return entry !== undefined && !entry.index.done && entry.index.error === undefined
  }

  /**
   * Start (or resume) a walk for one database, and return its status.
   *
   * Idempotent: calling it while a walk is running returns the current progress
   * rather than starting a second traversal — a user clicking twice must not double
   * the load on the server.
   *
   * @param dbSize - the database's key count, used for the progress denominator.
   */
  async start(sourceId: string, db: number, dbSize: number): Promise<KeyspaceIndex> {
    const key = IndexRegistry.key(sourceId, db)
    const existing = this.entries.get(key)

    if (existing !== undefined) {
      existing.lastUsed = Date.now()
      // A finished or failed index is returned as-is; a caller wanting a fresh walk
      // drops it first (see `invalidate`).
      if (existing.index.done || existing.index.error !== undefined) return existing.index
      if (!existing.looping) void this.runLoop(key, sourceId, db)
      return existing.index
    }

    const entry: IndexEntry = {
      index: createIndex(db, dbSize),
      stepping: false,
      cancelled: false,
      looping: false,
      lastUsed: Date.now(),
    }
    this.entries.set(key, entry)
    void this.runLoop(key, sourceId, db)
    return entry.index
  }

  /**
   * Advance one database's walk until it finishes or is cancelled.
   *
   * Runs detached: the caller gets progress from {@link get}, and a level request
   * answers from whatever is already indexed. Errors are recorded ON the index
   * rather than thrown, because a detached failure has no caller to catch it and an
   * index that silently stays empty would look like an empty database.
   */
  private async runLoop(key: string, sourceId: string, db: number): Promise<void> {
    const entry = this.entries.get(key)
    if (entry === undefined || entry.looping) return
    entry.looping = true

    try {
      const source = await this.resolveSource(sourceId)
      while (!entry.cancelled) {
        if (entry.stepping) break
        entry.stepping = true
        let advance: IndexAdvance
        try {
          advance = await advanceIndex(source, entry.index)
        } finally {
          entry.stepping = false
        }
        entry.lastUsed = Date.now()
        if (advance.done) break
        // A server without scripting cannot be indexed; the error is already on the
        // index, so the loop stops instead of retrying forever.
        if (entry.index.error !== undefined) break
        await new Promise(resolve => setTimeout(resolve, STEP_PAUSE_MS))
      }
    } catch (failure) {
      entry.index.error = failure instanceof Error ? failure.message : String(failure)
    } finally {
      entry.looping = false
    }
  }

  /**
   * Stop a running walk and drop the index.
   *
   * Used when a database changes in a way the incremental updates cannot express
   * (a bulk delete that exceeded its ceiling), and when the panel leaves the source.
   */
  invalidate(sourceId: string, db: number): void {
    const key = IndexRegistry.key(sourceId, db)
    const entry = this.entries.get(key)
    if (entry !== undefined) entry.cancelled = true
    this.entries.delete(key)
  }

  /** Drop every index for one source, e.g. when its connection changes. */
  invalidateSource(sourceId: string): void {
    for (const [key, entry] of this.entries) {
      if (key.startsWith(`${sourceId}\u0000`)) {
        entry.cancelled = true
        this.entries.delete(key)
      }
    }
  }

  /** Drop every index, used when the host unloads and walks must stop. */
  disposeAll(): void {
    for (const entry of this.entries.values()) entry.cancelled = true
    this.entries.clear()
  }

  /** Whether any index is being built, for a caller that must wait before writing. */
  anyBuilding(): boolean {
    for (const entry of this.entries.values()) {
      if (!entry.index.done && entry.index.error === undefined && entry.looping) return true
    }
    return false
  }

  /** Drop indexes untouched for longer than the idle TTL. */
  private evictIdle(): void {
    const cutoff = Date.now() - INDEX_IDLE_TTL_MS
    for (const [key, entry] of this.entries) {
      // A running walk is never evicted: it is actively used, and dropping it would
      // discard work that cost the server real load to produce.
      if (entry.index.done && entry.lastUsed < cutoff) this.entries.delete(key)
    }
  }

  /** Progress of one database's index, or undefined when none exists. */
  progressOf(sourceId: string, db: number): ReturnType<typeof indexProgress> | undefined {
    const index = this.get(sourceId, db)
    return index === undefined ? undefined : indexProgress(index)
  }
}
