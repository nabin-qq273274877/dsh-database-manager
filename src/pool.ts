/**
 * Connection pool: one live driver per data source, created on demand and
 * reused across the GUI, the routes, and the agent tools — so a source the
 * user just tested is immediately warm for the model, and vice versa.
 *
 * Idle drivers are released after a quiet period, mirroring dsh-ssh's pool
 * behaviour (a held MySQL/Redis connection is a real resource on the server).
 */

import type { DataSourceEntry, DbKind } from './protocol.ts'
import { MysqlDriver } from './drivers/mysql.ts'
import { RedisDriver } from './drivers/redis.ts'
import { SqliteDriver } from './drivers/sqlite.ts'
import type { Driver } from './drivers/types.ts'
import type { DataSourceStore } from './store.ts'

/** How long an unused driver is kept before it is released (ms). */
const IDLE_TTL_MS = 30 * 60 * 1000

interface PoolEntry {
  driver: Driver
  /** Fingerprint of the connection fields; a change forces a fresh driver. */
  fingerprint: string
  lastUsed: number
  dispose: ReturnType<typeof setTimeout> | undefined
}

/** The fields that, when changed, require a reconnect. */
function fingerprintOf(entry: DataSourceEntry): string {
  return JSON.stringify([
    entry.kind,
    entry.file ?? '',
    entry.host ?? '',
    entry.port ?? 0,
    entry.user ?? '',
    entry.password ?? '',
    entry.database ?? '',
    entry.db ?? 0,
    entry.tls === true,
    entry.connectTimeoutMs ?? 0,
  ])
}

/** Create the driver for one entry. */
function createDriver(entry: DataSourceEntry): Driver {
  switch (entry.kind) {
    case 'sqlite':
      return new SqliteDriver(entry)
    case 'mysql':
      return new MysqlDriver(entry)
    case 'redis':
      return new RedisDriver(entry)
    default: {
      const never: never = entry.kind
      throw new Error(`unsupported database kind: ${String(never)}`)
    }
  }
}

/**
 * Live-driver pool. Pure lifecycle management — the authorization decision and
 * the route surface live elsewhere.
 */
export class ConnectionPool {
  private readonly store: DataSourceStore
  private readonly entries = new Map<string, PoolEntry>()

  constructor(store: DataSourceStore) {
    this.store = store
  }

  /**
   * The live driver for one entry, connecting on first use.
   * @param entry - the stored record (already resolved by the caller).
   */
  acquire(entry: DataSourceEntry): Driver {
    const fingerprint = fingerprintOf(entry)
    const existing = this.entries.get(entry.id)
    if (existing !== undefined && existing.fingerprint === fingerprint) {
      existing.lastUsed = Date.now()
      this.rearm(existing, entry.id)
      return existing.driver
    }
    // Connection fields changed (or this is the first use): drop the stale
    // driver before handing out a new one, so the old socket is not leaked.
    if (existing !== undefined) this.drop(entry.id)
    const driver = createDriver(entry)
    const record: PoolEntry = { driver, fingerprint, lastUsed: Date.now(), dispose: undefined }
    this.entries.set(entry.id, record)
    this.rearm(record, entry.id)
    return driver
  }

  /** Resolve one entry by id from the store and hand out its driver. */
  acquireById(id: string): { entry: DataSourceEntry; driver: Driver } {
    const entry = this.store.find(id)
    if (entry === undefined) throw new Error(`no data source with id "${id}"`)
    return { entry, driver: this.acquire(entry) }
  }

  /** Arm (or re-arm) the idle release timer for one pooled driver. */
  private rearm(record: PoolEntry, id: string): void {
    if (record.dispose !== undefined) clearTimeout(record.dispose)
    record.dispose = setTimeout(() => { this.drop(id) }, IDLE_TTL_MS)
    // A pending idle timer must never keep the host process alive.
    if (typeof record.dispose.unref === 'function') record.dispose.unref()
  }

  /** Release and forget one driver. */
  drop(id: string): void {
    const record = this.entries.get(id)
    if (record === undefined) return
    this.entries.delete(id)
    if (record.dispose !== undefined) clearTimeout(record.dispose)
    void record.driver.close().catch(() => { /* a failed close is not actionable */ })
  }

  /** Which data sources currently hold a live driver. */
  live(): string[] {
    return [...this.entries.keys()]
  }

  /** Release every driver (plugin shutdown). */
  dispose(): void {
    for (const id of [...this.entries.keys()]) this.drop(id)
  }
}

/** Engine capability report shown in the GUI so a missing dependency is visible. */
export interface EngineAvailability {
  kind: DbKind
  available: boolean
  /** Why it is unavailable, when it is. */
  detail?: string
}

/** Whether a driver kind can be used in this host process. */
export async function probeEngines(): Promise<EngineAvailability[]> {
  const report: EngineAvailability[] = []
  try {
    const { sqliteAvailable } = await import('./drivers/sqlite.ts')
    report.push({ kind: 'sqlite', available: await sqliteAvailable() })
  } catch (error) {
    report.push({ kind: 'sqlite', available: false, detail: error instanceof Error ? error.message : String(error) })
  }
  try {
    const { mysqlAvailable } = await import('./drivers/mysql.ts')
    report.push({ kind: 'mysql', available: await mysqlAvailable() })
  } catch (error) {
    report.push({ kind: 'mysql', available: false, detail: error instanceof Error ? error.message : String(error) })
  }
  try {
    const { redisAvailable } = await import('./drivers/redis.ts')
    report.push({ kind: 'redis', available: await redisAvailable() })
  } catch (error) {
    report.push({ kind: 'redis', available: false, detail: error instanceof Error ? error.message : String(error) })
  }
  return report
}
