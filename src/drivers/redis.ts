/**
 * Redis driver on ioredis. One client per data source plus a separate client
 * for the logical database currently being browsed, since a Redis connection
 * is pinned to a database index for its lifetime.
 *
 * `ioredis` is an optional dependency: a deployment running only SQLite must
 * boot fine, so the import is lazy and its failure is an actionable message.
 */

import type {
  DataSourceEntry,
  QueryResult,
  RedisCreateKey,
  RedisDeletePrefixResult,
  RedisInfo,
  RedisKeyInfo,
  RedisKeyPage,
  RedisTreePage,
  RedisValue,
  TestResult,
} from '../protocol.ts'
import { toWireValue } from '../sql-util.ts'
import { keyPattern, prefixPattern } from '../redis-util.ts'
import type { RedisDriver as RedisDriverContract } from './types.ts'

/** Structural view of the ioredis surface this driver uses. */
interface RedisClient {
  ping(): Promise<string>
  info(section?: string): Promise<string>
  dbsize(): Promise<number>
  scan(cursor: string, ...args: Array<string | number>): Promise<[string, string[]]>
  type(key: string): Promise<string>
  ttl(key: string): Promise<number>
  memory(subcommand: string, key: string): Promise<unknown>
  get(key: string): Promise<string | null>
  lrange(key: string, start: number, stop: number): Promise<string[]>
  smembers(key: string): Promise<string[]>
  hgetall(key: string): Promise<Record<string, string>>
  zrange(key: string, start: number, stop: number, withScores: 'WITHSCORES'): Promise<string[]>
  xrange(key: string, start: string, end: string, ...args: Array<string | number>): Promise<Array<[string, string[]]>>
  select(db: number): Promise<string>
  call(command: string, ...args: Array<string | number>): Promise<unknown>
  del(...keys: string[]): Promise<number>
  disconnect(): void
  on(event: string, listener: (...args: unknown[]) => void): void
}

interface RedisModule {
  default: new (port: number, host: string, options: Record<string, unknown>) => RedisClient
  Redis?: new (port: number, host: string, options: Record<string, unknown>) => RedisClient
}

/** Load ioredis lazily, or throw an actionable message. */
async function loadRedis(): Promise<RedisModule> {
  try {
    const specifier = 'ioredis'
    const mod = (await import(/* @vite-ignore */ specifier)) as unknown as RedisModule
    const ctor = typeof mod.default === 'function' ? mod.default : mod.Redis
    if (typeof ctor !== 'function') throw new Error('module does not export a Redis constructor')
    return { default: ctor }
  } catch (error) {
    throw new Error(
      'Redis support requires the optional dependency "ioredis". ' +
      `Install it next to this plugin (npm install ioredis). Detail: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Whether ioredis is importable in this process. */
export async function redisAvailable(): Promise<boolean> {
  try {
    await loadRedis()
    return true
  } catch {
    return false
  }
}

/** Cap on elements read from one collection, so a huge key cannot freeze the GUI. */
const MAX_ELEMENTS = 1000

/**
 * Ceiling on keys collected by one whole-database tree scan.
 *
 * The tree groups keys by prefix, so a partial scan would show a folder that
 * silently lacks members — worse than saying "too many". The cap is a report
 * threshold: past it the result is marked truncated and the UI says so.
 */
const MAX_TREE_KEYS = 20000

/** SCAN batch size for the tree scan. */
const TREE_SCAN_COUNT = 1000

/**
 * Ceiling on keys removed by one folder delete.
 *
 * Deleting is destructive and runs unattended, so it is bounded and the outcome
 * reports whether the ceiling was hit. A larger folder must be deleted in
 * several passes rather than in one unbounded sweep.
 */
const MAX_DELETE_KEYS = 50000

/** DEL batch size, kept small enough to stay off Redis's per-command limits. */
const DELETE_BATCH = 500

/** Fallback connection/command deadline when the entry sets none. */
const DEFAULT_TIMEOUT_MS = 10000

/**
 * How many reconnection attempts ioredis may make before a pending command is
 * failed. Kept small: this is a user-facing tool, so "it did not work" beats
 * "it is still trying".
 */
const MAX_RECONNECT_ATTEMPTS = 3

/** Redis driver bound to one stored entry. */
export class RedisDriver implements RedisDriverContract {
  readonly kind = 'redis' as const
  private readonly entry: DataSourceEntry
  /** Clients keyed by logical database index, so switching db is cheap. */
  private readonly clients = new Map<number, RedisClient>()

  constructor(entry: DataSourceEntry) {
    this.entry = entry
  }

  /** Client for one logical database index. */
  private async client(db?: number): Promise<RedisClient> {
    const index = db ?? this.entry.db ?? 0
    const cached = this.clients.get(index)
    if (cached !== undefined) return cached
    const host = this.entry.host
    if (host === undefined || host === '') throw new Error('redis data source has no host configured')
    const { default: Redis } = await loadRedis()
    const timeout = this.entry.connectTimeoutMs ?? DEFAULT_TIMEOUT_MS
    const client = new Redis(this.entry.port ?? 6379, host, {
      password: this.entry.password === '' ? undefined : this.entry.password,
      db: index,
      connectTimeout: timeout,
      // Fail a command rather than queueing it forever when the server is down;
      // a UI action must always settle.
      maxRetriesPerRequest: 2,
      // Bounded reconnection. Without this, ioredis retries forever: a WRONG
      // connection setting (measured: tls:true against a plaintext server)
      // never rejects and the caller waits indefinitely. `null` after the
      // budget stops reconnecting so the pending command fails with a reason.
      retryStrategy: (attempt: number) => (attempt > MAX_RECONNECT_ATTEMPTS ? null : Math.min(attempt * 200, 1000)),
      enableOfflineQueue: true,
      lazyConnect: false,
      ...(this.entry.tls === true ? { tls: { rejectUnauthorized: false } } : {}),
    })
    // An ioredis client emits 'error' on every reconnect attempt; without a
    // listener that surface is an unhandled event error in the host process.
    client.on('error', () => { /* surfaced per command instead */ })
    this.clients.set(index, client)
    return client
  }

  /**
   * Run one command under a hard deadline.
   *
   * `maxRetriesPerRequest` and `retryStrategy` bound what ioredis will do, but a
   * server that accepts the TCP connection and then never completes the
   * handshake (the plaintext-server-vs-TLS-client case) produces no error to
   * count — the promise simply never settles. Racing a timer is the only way to
   * guarantee the UI gets an answer, and it is cheaper than hanging forever.
   */
  private withDeadline<T>(work: Promise<T>, timeoutMs: number, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${what} timed out after ${timeoutMs} ms — the server did not complete the handshake. Check the host, port and whether this server expects an encrypted (TLS) connection.`))
      }, timeoutMs)
      work.then(
        (value) => { clearTimeout(timer); resolve(value) },
        (error) => { clearTimeout(timer); reject(error) },
      )
    })
  }

  async test(): Promise<TestResult> {
    const started = Date.now()
    const timeout = this.entry.connectTimeoutMs ?? DEFAULT_TIMEOUT_MS
    try {
      const client = await this.client()
      const pong = await this.withDeadline(client.ping(), timeout, 'connecting to Redis')
      const info = await client.info('server').catch(() => '')
      const version = /redis_version:([^\r\n]+)/.exec(info)?.[1]?.trim()
      return {
        ok: pong === 'PONG',
        latencyMs: Date.now() - started,
        ...(version === undefined ? {} : { serverVersion: `Redis ${version}` }),
      }
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, error: describeRedisError(error) }
    }
  }

  async close(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        client.disconnect()
      } catch {
        /* already gone */
      }
    }
    this.clients.clear()
  }

  async info(): Promise<RedisInfo> {
    return this.withDeadline(this.infoUnbounded(), this.deadlineMs(), 'reading Redis server info')
  }

  /** The actual info read; callers go through {@link info} for the deadline. */
  private async infoUnbounded(): Promise<RedisInfo> {
    const client = await this.client()
    const [server, memory, clients, keyspace] = await Promise.all([
      client.info('server').catch(() => ''),
      client.info('memory').catch(() => ''),
      client.info('clients').catch(() => ''),
      client.info('keyspace').catch(() => ''),
    ])
    const databases: RedisInfo['databases'] = []
    for (const line of keyspace.split(/\r?\n/)) {
      const match = /^db(\d+):keys=(\d+),expires=(\d+)/.exec(line.trim())
      if (match !== null) {
        databases.push({ db: Number(match[1]), keys: Number(match[2]), expires: Number(match[3]) })
      }
    }
    databases.sort((a, b) => a.db - b.db)
    const version = readInfoField(server, 'redis_version')
    const mode = readInfoField(server, 'redis_mode')
    const uptime = readInfoField(server, 'uptime_in_seconds')
    const usedMemory = readInfoField(memory, 'used_memory_human')
    const connected = readInfoField(clients, 'connected_clients')
    const current = databases.find(item => item.db === (this.entry.db ?? 0))
    return {
      ...(version === undefined ? {} : { version }),
      ...(mode === undefined ? {} : { mode }),
      ...(uptime === undefined ? {} : { uptimeSeconds: Number(uptime) }),
      ...(usedMemory === undefined ? {} : { usedMemoryHuman: usedMemory }),
      ...(connected === undefined ? {} : { connectedClients: Number(connected) }),
      ...(current === undefined ? {} : { totalKeys: current.keys }),
      databases,
    }
  }

  async keys(input: { pattern: string; cursor: string; count: number; db: number }): Promise<RedisKeyPage> {
    return this.withDeadline(this.keysUnbounded(input), this.deadlineMs(), 'scanning Redis keys')
  }

  /** The actual scan; callers go through {@link keys} for the deadline. */
  private async keysUnbounded(input: { pattern: string; cursor: string; count: number; db: number }): Promise<RedisKeyPage> {
    const client = await this.client(input.db)
    const pattern = input.pattern === '' ? '*' : input.pattern
    const count = Math.max(10, Math.min(input.count, 2000))
    const [cursor, found] = await client.scan(input.cursor === '' ? '0' : input.cursor, 'MATCH', pattern, 'COUNT', count)
    const keys = await Promise.all(
      found.map(async key => {
        const [type, ttl] = await Promise.all([
          client.type(key).catch(() => 'unknown'),
          client.ttl(key).catch(() => -2),
        ])
        return { key, type, ttl } satisfies RedisKeyInfo
      }),
    )
    return { keys, cursor: String(cursor) }
  }

  async value(key: string, db: number, limit: number): Promise<RedisValue> {
    return this.withDeadline(this.valueUnbounded(key, db, limit), this.deadlineMs(), `reading key "${key}"`)
  }

  /** The actual read; callers go through {@link value} for the deadline. */
  private async valueUnbounded(key: string, db: number, limit: number): Promise<RedisValue> {
    const client = await this.client(db)
    const type = await client.type(key)
    const ttl = await client.ttl(key)
    const cap = Math.min(limit > 0 ? limit : MAX_ELEMENTS, MAX_ELEMENTS)
    const head: RedisValue = { key, type, ttl }

    switch (type) {
      case 'string': {
        const value = await client.get(key)
        return { ...head, value: value ?? '' }
      }
      case 'list': {
        const total = await client.call('LLEN', key).catch(() => 0)
        const items = await client.lrange(key, 0, cap - 1)
        return { ...head, items, ...(Number(total) > cap ? { truncated: true } : {}) }
      }
      case 'set': {
        const total = await client.call('SCARD', key).catch(() => 0)
        // SSCAN is bounded; SMEMBERS on a million-member set would stall the GUI.
        const [cursor, items] = await client.call('SSCAN', key, '0', 'COUNT', cap).then(result => {
          const pair = result as [string, string[]]
          return [pair[0], pair[1]] as const
        }).catch(() => ['0', [] as string[]] as const)
        return {
          ...head,
          items,
          ...(Number(total) > items.length || cursor !== '0' ? { truncated: true } : {}),
        }
      }
      case 'hash': {
        const total = await client.call('HLEN', key).catch(() => 0)
        const flat = await client.call('HSCAN', key, '0', 'COUNT', cap).then(result => {
          const pair = result as [string, string[]]
          return pair[1]
        }).catch(() => [] as string[])
        const fields: Array<{ field: string; value: string }> = []
        for (let i = 0; i + 1 < flat.length; i += 2) fields.push({ field: flat[i]!, value: flat[i + 1]! })
        return { ...head, fields, ...(Number(total) > fields.length ? { truncated: true } : {}) }
      }
      case 'zset': {
        const total = await client.call('ZCARD', key).catch(() => 0)
        const flat = await client.zrange(key, 0, cap - 1, 'WITHSCORES')
        const members: Array<{ member: string; score: string }> = []
        for (let i = 0; i + 1 < flat.length; i += 2) members.push({ member: flat[i]!, score: flat[i + 1]! })
        return { ...head, members, ...(Number(total) > members.length ? { truncated: true } : {}) }
      }
      case 'stream': {
        const raw = await client.xrange(key, '-', '+', 'COUNT', cap).catch(() => [] as Array<[string, string[]]>)
        const entries = (Array.isArray(raw) ? raw : []).map(entry => {
          const [id, flat] = entry
          const fields: Array<{ field: string; value: string }> = []
          for (let i = 0; i + 1 < flat.length; i += 2) fields.push({ field: flat[i]!, value: flat[i + 1]! })
          return { id, fields }
        })
        return { ...head, entries, ...(entries.length >= cap ? { truncated: true } : {}) }
      }
      case 'none':
        throw new Error(`key "${key}" does not exist`)
      default:
        return head
    }
  }

  async command(args: string[], db: number): Promise<QueryResult> {
    if (args.length === 0) throw new Error('a Redis command is required')
    return this.withDeadline(this.commandUnbounded(args, db), this.deadlineMs(), `running "${args[0]}"`)
  }

  /** The actual command; callers go through {@link command} for the deadline. */
  private async commandUnbounded(args: string[], db: number): Promise<QueryResult> {
    const client = await this.client(db)
    const started = Date.now()
    const [name, ...rest] = args
    const result = await client.call(name!, ...rest)
    return shapeRedisReply(result, Date.now() - started)
  }

  /**
   * Every key in one logical database, for the folder tree.
   *
   * A tree needs the whole key set: grouping by prefix from a partial SCAN page
   * would render a folder that silently lacks members. The traversal is
   * therefore exhaustive up to {@link MAX_TREE_KEYS}, and the caller is told
   * when the cap was reached rather than being handed a plausible-looking
   * half-tree.
   *
   * Types and TTLs are fetched in bounded parallel batches: one round trip per
   * key across 20k keys would take minutes, while an unbounded Promise.all
   * would open as many sockets as the server allows.
   */
  async tree(input: { db: number; pattern?: string }): Promise<RedisTreePage> {
    return this.withDeadline(this.treeUnbounded(input), this.treeDeadlineMs(), 'scanning the key tree')
  }

  /** The actual tree scan; callers go through {@link tree} for the deadline. */
  private async treeUnbounded(input: { db: number; pattern?: string }): Promise<RedisTreePage> {
    const client = await this.client(input.db)
    const match = input.pattern === undefined || input.pattern === '' ? '*' : input.pattern
    const names: string[] = []
    let cursor = '0'
    let truncated = false

    do {
      const [next, found] = await client.scan(cursor, 'MATCH', match, 'COUNT', TREE_SCAN_COUNT)
      cursor = String(next)
      for (const name of found) {
        names.push(name)
        if (names.length >= MAX_TREE_KEYS) { truncated = true; break }
      }
      if (truncated) break
    } while (cursor !== '0')

    const dbSize = await client.dbsize().catch(() => names.length)
    const keys: RedisKeyInfo[] = []
    const BATCH = 200
    for (let i = 0; i < names.length; i += BATCH) {
      const slice = names.slice(i, i + BATCH)
      const described = await Promise.all(slice.map(async key => {
        const [type, ttl] = await Promise.all([
          client.type(key).catch(() => 'unknown'),
          client.ttl(key).catch(() => -2),
        ])
        return { key, type, ttl } satisfies RedisKeyInfo
      }))
      keys.push(...described)
    }
    return { keys, dbSize, truncated }
  }

  /**
   * Create one key, or report why it could not be.
   *
   * Refuses to overwrite: a create that silently replaced an existing key would
   * destroy data behind a dialog titled 新增. `type` is checked first so the
   * message names the real conflict rather than a type error.
   */
  async createKey(input: RedisCreateKey, db: number): Promise<void> {
    return this.withDeadline(this.createKeyUnbounded(input, db), this.deadlineMs(), `creating "${input.key}"`)
  }

  /** The actual create; callers go through {@link createKey} for the deadline. */
  private async createKeyUnbounded(input: RedisCreateKey, db: number): Promise<void> {
    const client = await this.client(db)
    const { key, type } = input
    if (key === '') throw new Error('key name is required')

    const existing = await client.type(key)
    if (existing !== 'none') {
      throw new Error(`键「${key}」已存在（类型 ${existing}）；请换一个名字，或先删除它`)
    }

    switch (type) {
      case 'string':
        await client.call('SET', key, input.value ?? '')
        break
      case 'list': {
        const items = input.items ?? []
        if (items.length === 0) throw new Error(`「${key}」需要一个元素`)
        // RPUSH keeps the form's line order as the list's order.
        await client.call('RPUSH', key, ...items)
        break
      }
      case 'set': {
        const items = input.items ?? []
        if (items.length === 0) throw new Error(`「${key}」需要一个成员`)
        await client.call('SADD', key, ...items)
        break
      }
      case 'hash': {
        const fields = input.fields ?? []
        if (fields.length === 0) throw new Error(`「${key}」需要一个字段`)
        await client.call('HSET', key, ...fields.flatMap(pair => [pair.field, pair.value]))
        break
      }
      case 'zset': {
        const members = input.members ?? []
        if (members.length === 0) throw new Error(`「${key}」需要一个成员`)
        await client.call('ZADD', key, ...members.flatMap(pair => [pair.score, pair.member]))
        break
      }
      default: {
        const never: never = type
        throw new Error(`unsupported key type: ${String(never)}`)
      }
    }

    // Only set an expiry when one was asked for: EXPIRE with 0 would delete the
    // key we just wrote.
    if (input.ttl !== undefined && input.ttl > 0) await client.call('EXPIRE', key, input.ttl)
  }

  /** Delete one key; returns whether it existed. */
  async deleteKey(key: string, db: number): Promise<boolean> {
    return this.withDeadline(this.deleteKeyUnbounded(key, db), this.deadlineMs(), `deleting "${key}"`)
  }

  /** The actual single-key delete; callers go through {@link deleteKey}. */
  private async deleteKeyUnbounded(key: string, db: number): Promise<boolean> {
    const client = await this.client(db)
    const removed = await client.del(key)
    return removed > 0
  }

  /**
   * Delete every key under one folder prefix.
   *
   * The scan runs HERE, immediately before the delete, for two reasons: the
   * browser's key list may be a capped or filtered view (deleting from it would
   * silently leave keys behind), and SCAN is not a snapshot, so the set must be
   * collected as close to the delete as possible.
   *
   * The traversal is re-run after each batch until the pattern is exhausted, so
   * a folder holding more keys than one scan pass returns is still fully
   * cleared; {@link MAX_DELETE_KEYS} is the sole ceiling and hitting it is
   * reported.
   */
  async deletePrefix(path: string, db: number): Promise<RedisDeletePrefixResult> {
    return this.withDeadline(this.deletePrefixUnbounded(path, db), this.treeDeadlineMs(), `deleting folder "${path}"`)
  }

  /** The actual prefix delete; callers go through {@link deletePrefix}. */
  private async deletePrefixUnbounded(path: string, db: number): Promise<RedisDeletePrefixResult> {
    const client = await this.client(db)
    let deleted = 0

    // The folder's own key first (`a:b` may exist alongside `a:b:*`). DEL takes
    // the literal name, NOT a glob: escaping here would target a different,
    // non-existent key.
    const own = await client.del(path)
    deleted += own

    const pattern = prefixPattern(path)
    // Passes restart from cursor 0 and delete what they find, then re-scan:
    // SCAN is not a snapshot, so a single traversal can miss keys that move
    // between hash-table slots while the delete progresses. The loop ends when
    // a pass finds nothing left to remove.
    //
    // `MAX_PASSES` bounds a pathological case where a pass finds keys but
    // removes none (a concurrent writer recreating them); without it the loop
    // could never settle. Hitting it is reported as truncated, because keys may
    // then remain.
    const MAX_PASSES = 100
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const [cursor, found] = await client.scan('0', 'MATCH', pattern, 'COUNT', TREE_SCAN_COUNT)
      if (found.length === 0) {
        // Nothing matched from the start of the keyspace: the folder is gone.
        if (cursor === '0') return { deleted, truncated: false }
        // A cursor with an empty page means this pass is spent; the next pass
        // rescans from 0.
        continue
      }

      let removedThisPass = 0
      for (let i = 0; i < found.length; i += DELETE_BATCH) {
        const batch = found.slice(i, i + DELETE_BATCH)
        if (deleted + batch.length > MAX_DELETE_KEYS) {
          const room = MAX_DELETE_KEYS - deleted
          if (room > 0) deleted += await client.del(...batch.slice(0, room))
          return { deleted, truncated: true }
        }
        // DEL reports how many keys it actually removed; a key that vanished
        // between the scan and the delete must not be counted as deleted.
        removedThisPass += await client.del(...batch)
      }
      deleted += removedThisPass

      // Nothing removed and the traversal finished: there is nothing left.
      if (removedThisPass === 0) return { deleted, truncated: false }
    }

    // Passes exhausted with keys still present: report the partial result.
    return { deleted, truncated: true }
  }

  /** How many keys sit under one folder prefix (the delete dialog's warning). */
  async countPrefix(path: string, db: number): Promise<number> {
    return this.withDeadline(this.countPrefixUnbounded(path, db), this.treeDeadlineMs(), `counting folder "${path}"`)
  }

  /** The actual prefix count; callers go through {@link countPrefix}. */
  private async countPrefixUnbounded(path: string, db: number): Promise<number> {
    const client = await this.client(db)
    // The two patterns are disjoint by construction — `prefixPattern` requires
    // a separator after the path, and `keyPattern` matches the path exactly —
    // so their counts can simply be added.
    let count = 0
    for (const pattern of [keyPattern(path), prefixPattern(path)]) {
      let cursor = '0'
      do {
        const [next, found] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', TREE_SCAN_COUNT)
        cursor = String(next)
        count += found.length
        // Past the delete ceiling the exact number stops mattering; the dialog
        // only needs to know the folder is large.
        if (count > MAX_DELETE_KEYS) return count
      } while (cursor !== '0')
    }
    return count
  }

  /** The per-operation deadline for this data source. */
  private deadlineMs(): number {
    return this.entry.connectTimeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * The deadline for a whole-database traversal.
   *
   * A tree scan and a folder delete both walk the entire keyspace, which is
   * categorically slower than one command, so the per-operation budget would
   * abort a legitimate scan of a large database. This is a ceiling on a stalled
   * server, not an expectation.
   */
  private treeDeadlineMs(): number {
    return Math.max(this.deadlineMs() * 3, 30000)
  }
}

/** Shape an arbitrary Redis reply into the tabular wire result. */
function shapeRedisReply(reply: unknown, durationMs: number): QueryResult {
  if (Array.isArray(reply)) {
    const rows = reply.map(item => [toWireValue(item)])
    return { columns: ['result'], rows, affected: rows.length, durationMs, write: false, truncated: false }
  }
  return {
    columns: [],
    rows: [[toWireValue(reply)]],
    affected: 1,
    durationMs,
    write: false,
    truncated: false,
  }
}

/** Read one `field:value` line out of a Redis INFO payload. */
function readInfoField(info: string, field: string): string | undefined {
  const match = new RegExp(`^${field}:([^\\r\\n]+)`, 'm').exec(info)
  return match?.[1]?.trim()
}

/**
 * Human-readable ioredis error.
 *
 * ioredis surfaces its own internal vocabulary, which a user cannot act on:
 * "Reached the max retries per request limit (which is 2). Refer to
 * maxRetriesPerRequest option for details." says nothing about what to change.
 * The common causes are recognised and restated; anything unrecognised keeps
 * the original text so no information is lost.
 */
function describeRedisError(error: unknown): string {
  const record = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown; message?: unknown }
  const message = typeof record.message === 'string' ? record.message : undefined
  const code = typeof record.code === 'string' ? record.code : undefined
  const base = message ?? (error instanceof Error ? error.message : String(error))

  if (base.includes('max retries per request')) {
    return 'could not reach the server, or it did not accept the connection settings (host, port, password, TLS). ' + (code === undefined ? '' : `[${code}]`).trim()
  }
  if (base.includes('WRONGPASS') || base.includes('NOAUTH') || base.includes('invalid password')) {
    return `the server rejected the password${code === undefined ? '' : ` (${code})`}`
  }
  if (base.includes('ECONNREFUSED')) {
    return `nothing is listening on that host and port (${code ?? 'ECONNREFUSED'}) — check the address and that the server is running`
  }
  if (base.includes('ENOTFOUND') || base.includes('EAI_AGAIN')) {
    return `the host name could not be resolved (${code ?? 'ENOTFOUND'})`
  }
  if (base.includes('ETIMEDOUT')) {
    return 'the connection timed out — a firewall or an encryption mismatch can both cause this'
  }
  return code === undefined ? base : `${base} (${code})`
}

/**
 * Which Redis commands are treated as writes by the authorization gate. A
 * command not listed here is treated as a write unless it appears in
 * {@link REDIS_READ_COMMANDS}, so an unknown command fails closed.
 */
export const REDIS_READ_COMMANDS: readonly string[] = [
  'get', 'mget', 'strlen', 'exists', 'type', 'ttl', 'pttl', 'keys', 'scan', 'randomkey', 'dump',
  'hget', 'hmget', 'hgetall', 'hkeys', 'hvals', 'hlen', 'hexists', 'hscan', 'hrandfield', 'hstrlen',
  'lrange', 'llen', 'lindex', 'lpos',
  'smembers', 'scard', 'sismember', 'smismember', 'srandmember', 'sscan',
  'zrange', 'zrangebyscore', 'zrevrange', 'zrevrangebyscore', 'zrangebylex', 'zcard', 'zscore',
  'zmscore', 'zcount', 'zrank', 'zrevrank', 'zscan', 'zrandmember', 'zlexcount',
  'xrange', 'xrevrange', 'xlen', 'xread', 'xinfo',
  'bitcount', 'bitpos', 'getbit', 'getrange',
  'pfcount', 'geodist', 'geohash', 'geopos', 'geosearch',
  'info', 'dbsize', 'ping', 'echo', 'time', 'lastsave', 'memory', 'object', 'command',
]

/** Whether a Redis command name is read-only by this plugin's classification. */
export function isRedisReadCommand(name: string): boolean {
  return REDIS_READ_COMMANDS.includes(name.toLowerCase())
}
