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
  RedisElementEdit,
  RedisInfo,
  RedisKeyInfo,
  RedisKeyPage,
  RedisLevelPage,
  RedisMutationResult,
  RedisSearchPage,
  RedisTreePage,
  RedisValue,
  TestResult,
} from '../protocol.ts'
import { toWireValue } from '../sql-util.ts'
import { SEPARATOR, compareKeyNames, escapeGlob, keyPattern, prefixPattern } from '../redis-util.ts'
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
  /**
   * Run a Lua script. Used for the keyspace index, where folding a batch of key
   * names server-side is the difference between a few bytes and ~600 MiB crossing
   * the wire for one large database.
   */
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
  del(...keys: string[]): Promise<number>
  /** Batch commands into one round trip; used for TYPE/TTL over many keys. */
  pipeline(): RedisPipeline
  disconnect(): void
  on(event: string, listener: (...args: unknown[]) => void): void
}

/**
 * ioredis's pipeline surface: commands are queued then sent together, and
 * `exec()` resolves with one `[error, value]` pair per queued command in issue
 * order.
 */
interface RedisPipeline {
  type(key: string): RedisPipeline
  ttl(key: string): RedisPipeline
  exec(): Promise<Array<[Error | null, unknown]>>
}

/** Unwrap one pipeline reply, or undefined when the command failed. */
function replyValue(reply: [Error | null, unknown] | undefined): unknown {
  if (reply === undefined || reply[0] !== null) return undefined
  return reply[1]
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
 * Ceiling on key ROWS returned for one level.
 *
 * A flat prefix holding 200k keys is legitimate (`goods:1` … `goods:200000`), but
 * sending them all would put tens of megabytes into the browser and render rows
 * nobody reads. The level still reports its true key count, so the UI can say
 * "200000 keys, showing the first 5000" instead of pretending the folder is
 * small or that it failed.
 *
 * This caps only what is DISPLAYED — the scan itself always runs to completion,
 * because a partial scan cannot produce a correct folder count.
 */
const MAX_LEVEL_KEYS_RETURNED = 5000

/**
 * Ceiling on keys returned by one search.
 *
 * A search runs to completion so that no match is silently omitted, but the
 * RESULT is capped: a pattern like `*` against a large database would otherwise
 * put hundreds of thousands of rows into the browser. Hitting the cap is
 * reported, so a partial list is never presented as the whole answer.
 */
const MAX_SEARCH_KEYS = 5000

/** Cap for the whole-database {@link RedisDriver.tree} helper (tests, exports). */
const MAX_TREE_KEYS = 50000

/**
 * Fold a bounded batch of the keyspace into counts, inside Redis.
 *
 * Written as a script rather than host-side grouping for one measured reason: a
 * level's cost is dominated by shipping key names, not by finding them. On a
 * production database of 19.5M keys, walking 500k keys took 5.2 s while returning
 * the names and 1.5 s while returning nothing — i.e. ~70% of the time was transfer.
 * This returns only counters plus a BOUNDED sample of names, so one batch's payload
 * stays small no matter how large the database is.
 *
 * The loop is bounded by `batchKeys` so ONE call cannot stall the server for long:
 * Redis is single-threaded, so a script's duration is a pause for every other
 * client (measured 271-708 ms at a 100k batch). The caller resumes from the
 * returned cursor, which is how a complete traversal becomes many short calls
 * instead of one long one.
 *
 * Returned, as five strings:
 *   [1] next cursor ('0' when the walk finished)
 *   [2] how many keys this call examined
 *   [3] "ancestorPath<TAB>count" — each key counts into every proper prefix, so a
 *       folder's number covers its whole subtree
 *   [4] "parentPath<TAB>count" — how many keys sit DIRECTLY at each level, i.e. the
 *       "N keys" a level reports even when its rows are not all held
 *   [5] "parentPath<TAB>name<US>name..." — a bounded sample of direct key names,
 *       which is what the tree draws as rows
 *
 * The tables it builds are all keyed by PATH or LEVEL, never by key, so their size
 * is bounded by the number of folders rather than by the number of keys. That is
 * deliberate: accumulating even one entry per key would put millions of entries in
 * the server's memory, which is the same class of harm as the transfer cost this
 * script exists to remove.
 *
 * ARGV: cursor, batchKeys, separator, nameBudget.
 */
const INDEX_AGGREGATE_SCRIPT = `
local cursor = ARGV[1]
local batch = tonumber(ARGV[2])
local sep = ARGV[3]
local nameBudget = tonumber(ARGV[4])
local US = string.char(1)

local folders = {}
local direct = {}
local leaves = {}
local visited = 0
local namesSent = 0

while true do
  local reply = redis.call('SCAN', cursor, 'COUNT', 1000)
  cursor = reply[1]
  local names = reply[2]
  for i = 1, #names do
    local key = names[i]
    visited = visited + 1
    -- Fold into every proper prefix, so each ancestor folder counts this key.
    local from = 1
    while true do
      local at = string.find(key, sep, from, true)
      if at == nil then break end
      local ancestor = string.sub(key, 1, at - 1)
      folders[ancestor] = (folders[ancestor] or 0) + 1
      from = at + 1
    end
    -- The key's own level: parent path plus its leaf name.
    local last = 1
    local at = string.find(key, sep, 1, true)
    while at ~= nil do
      last = at + 1
      at = string.find(key, sep, at + 1, true)
    end
    local parent = ''
    local leaf = key
    if last > 1 then
      parent = string.sub(key, 1, last - 2)
      leaf = string.sub(key, last)
    end
    direct[parent] = (direct[parent] or 0) + 1
    -- Names are only needed to draw rows, and only a page of them, so the total
    -- sent per call is capped. The counts above are unaffected by the cap.
    if namesSent < nameBudget then
      if leaves[parent] == nil then leaves[parent] = {} end
      local bucket = leaves[parent]
      bucket[#bucket + 1] = leaf
      namesSent = namesSent + 1
    end
  end
  if cursor == '0' or visited >= batch then break end
end

local folderParts = {}
for path, n in pairs(folders) do
  folderParts[#folderParts + 1] = path .. '\\t' .. tostring(n)
end

local directParts = {}
for parent, n in pairs(direct) do
  directParts[#directParts + 1] = parent .. '\\t' .. tostring(n)
end

local leafParts = {}
for parent, bucket in pairs(leaves) do
  leafParts[#leafParts + 1] = parent .. '\\t' .. table.concat(bucket, US)
end

return {
  cursor,
  tostring(visited),
  table.concat(folderParts, '\\n'),
  table.concat(directParts, '\\n'),
  table.concat(leafParts, '\\n'),
}
`

/** One aggregated batch from {@link RedisDriver.aggregateBatch}. */
export interface AggregateBatch {
  /** Next SCAN cursor; `'0'` means the walk reached the end. */
  cursor: string
  /** How many keys this batch examined. */
  visited: number
  /** `ancestor path -> how many keys this batch found at or under it`. */
  folderDeltas: Map<string, number>
  /** `parent path -> how many keys sit directly at that level`. */
  directCounts: Map<string, number>
  /** `parent path -> a bounded sample of direct key names`. */
  leaves: Map<string, string[]>
}

/**
 * SCAN batch size for level, search and tree scans.
 *
 * COUNT is a hint for how many keys Redis gathers per reply, and it divides the
 * total work into round trips: a full pass costs roughly (keys / COUNT) x (RTT).
 * That makes it a LATENCY knob before a throughput one, which the old value of
 * 1000 got badly wrong on a remote server. Measured against a production Redis
 * (830k keys, 17 ms RTT):
 *
 *   COUNT   1000 -> 831 batches -> 24.8 s   (the tree budget is 30 s)
 *   COUNT  10000 ->  83 batches -> 16.6 s
 *   COUNT  50000 ->  17 batches -> 10.8 s
 *
 * At 1000 the scan sat 5 s under its own deadline, so any latency jitter or a
 * slightly larger database pushed it over — which is exactly how "scanning a key
 * level timed out after 30000 ms" appeared on a big remote database while the
 * same data scanned in 3 s locally (1 ms RTT).
 *
 * 10000 rather than 50000: it captures most of the win (831 -> 83 round trips is
 * 10x fewer, 50000 only reaches 17), while keeping one reply small. A SCAN reply
 * carries key names, so a very large COUNT holds every one of them in memory at
 * once on both sides, and the gain past 10000 is small because the server's own
 * traversal becomes the cost rather than the network.
 */
const TREE_SCAN_COUNT = 10000

/**
 * A level scan has NO key budget: it runs until the level is covered.
 *
 * There used to be one (200k keys), and it was wrong for the only thing the number
 * is used for. A level's folder counts are what a user reads to decide what a
 * database holds and whether a folder is safe to delete, so an early stop makes
 * them LOWER BOUNDS and can omit a folder entirely. Measured on a production db1
 * of 19.5M keys: a 500k-key sample found all four top-level folders but missed one
 * holding 12 keys — and a folder list that is silently short is the failure mode
 * this whole file exists to avoid. A 485k-key database reported "该库共 485,073 个
 * 键，此处仅扫描了 200,012 个：目录可能不全，计数是下限", which is a correct
 * warning about a defect, not a useful feature.
 *
 * What bounds the work instead is the DATABASE SIZE, not a constant: databases
 * below `LARGE_DB_KEYS` (see the client) are scanned per level, and one of those
 * is small enough that a complete pass is a few seconds — 485k keys measured
 * ~10 s over a 19 ms link, and a level with 200k keys under it measured 1.0 s
 * locally. A database big enough for a complete pass to be intolerable is served
 * by the cached keyspace index instead, which pays one traversal for every level
 * rather than one per click.
 *
 * Memory follows the same reasoning: exact deduplication needs the visited names
 * retained (SCAN is at-least-once), so a complete pass of a <1M-key database holds
 * tens of MB of names rather than the ~1.2 GB a 19.5M-key pass would — and that
 * size never reaches this path.
 *
 * A genuinely huge level under an unusual `databases` configuration still
 * terminates: {@link RedisDriver.level} races the walk against the tree deadline
 * and reports a TIMEOUT naming the cause, which is honest about the failure
 * instead of returning a short list that looks complete.
 */

/**
 * How many keys one TYPE/TTL pipeline batch covers.
 *
 * The whole batch travels as one round trip, so this trades request size against
 * the number of round trips; 1000 keys is 2000 commands per batch, which Redis
 * handles comfortably while keeping any single reply small.
 */
const TREE_PIPELINE_BATCH = 1000

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
   *
   * @param what - names the operation, in the user's terms, for the timeout text.
   * @param hint - what a timeout most likely MEANS for this operation. The
   *   connection wording ("did not complete the handshake, check the port and
   *   TLS") is only true for a connection attempt; applying it to a long scan
   *   sent the reader to inspect TLS settings when the real cause was that a
   *   large remote keyspace needed more round trips than the budget allowed.
   */
  private withDeadline<T>(work: Promise<T>, timeoutMs: number, what: string, hint?: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          `${what} timed out after ${timeoutMs} ms — ${hint ??
          'the server did not complete the handshake. Check the host, port and whether this server expects an encrypted (TLS) connection.'}`,
        ))
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
   * Search one database for keys matching a Redis glob pattern.
   *
   * Runs `SCAN MATCH` on the server, so the pattern is Redis glob syntax and the
   * search sees every key in the database — including keys inside folders that
   * are not expanded in the tree. A client-side filter over already-loaded rows
   * can do neither, which is why a pattern like `jd:*` found nothing.
   *
   * The traversal runs to completion (a partial scan would silently omit
   * matches); {@link MAX_SEARCH_KEYS} caps the RESULT so a pattern like `*` on a
   * huge database cannot return millions of rows to the browser, and hitting it
   * is reported rather than passed off as the complete answer.
   *
   * @param pattern - Redis glob pattern; empty is treated as `*`.
   */
  async search(input: { db: number; pattern: string }): Promise<RedisSearchPage> {
    return this.withDeadline(
      this.searchUnbounded(input),
      this.treeDeadlineMs(),
      'searching Redis keys',
      'the scan did not finish within the time budget. A pattern that matches many keys in a large remote ' +
      'database takes longer; try a more specific pattern or raise this data source\'s timeout setting.',
    )
  }

  /** The actual search; callers go through {@link search} for the deadline. */
  private async searchUnbounded(input: { db: number; pattern: string }): Promise<RedisSearchPage> {
    const client = await this.client(input.db)
    const pattern = input.pattern === '' ? '*' : input.pattern
    const names: string[] = []
    let cursor = '0'
    let scanned = 0
    let truncated = false

    do {
      const [next, found] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', TREE_SCAN_COUNT)
      cursor = String(next)
      scanned += found.length
      for (const name of found) {
        names.push(name)
        if (names.length >= MAX_SEARCH_KEYS) { truncated = true; break }
      }
      if (truncated) break
    } while (cursor !== '0')

    // Type and TTL per match, batched: a search result that omits the type is
    // far less useful, and one round trip per key would be the mistake this
    // whole design avoids.
    const keys = await this.describeKeys(client, names)
    keys.sort((a, b) => compareKeyNames(a.key, b.key))
    const dbSize = await client.dbsize().catch(() => scanned)
    return { keys, truncated, scanned, dbSize }
  }

  /**
   * Fold ONE bounded batch of the keyspace into ancestor counts, server-side.
   *
   * This is the primitive the keyspace index is built from, and it exists because
   * of a measured constraint: `SCAN MATCH p:*` still walks the whole keyspace, so
   * listing any level costs a full traversal — ~230 s and ~600 MiB of key names for
   * a 19.5M-key database. Folding the names into counts INSIDE the server collapses
   * that payload to a few bytes per batch (measured: ~0 KiB for 100k keys).
   *
   * Each call is bounded, and that bound is a deliberate safety limit rather than a
   * performance knob: Redis runs scripts on its single thread, so a call blocks
   * every other client for its whole duration (measured 271-708 ms at 100k keys).
   * The caller drives the cursor and chooses the batch, so the pause can be kept
   * small on a server that also serves live traffic.
   *
   * Returns `null` when the server rejects scripting (some managed offerings
   * disable EVAL), which lets the caller fall back to folding on the host.
   *
   * @param cursor - SCAN cursor to resume from; `'0'` starts a fresh walk.
   * @param batchKeys - how many matching keys this call may examine before returning.
   */
  async aggregateBatch(input: {
    db?: number
    cursor: string
    batchKeys: number
    /** Cap on key names returned by this call, so a reply stays small. */
    nameBudget: number
  }): Promise<AggregateBatch | null> {
    const client = await this.client(input.db)
    let raw: unknown
    try {
      raw = await client.eval(
        INDEX_AGGREGATE_SCRIPT,
        0,
        input.cursor,
        String(input.batchKeys),
        SEPARATOR,
        String(input.nameBudget),
      )
    } catch (error) {
      // Distinguish "this server has no scripting" from a transient failure. Only
      // the former justifies the slower host-side path; anything else is surfaced.
      const message = error instanceof Error ? error.message : String(error)
      if (/unknown command|not supported|ERR unknown|NOPERM|disabled/i.test(message)) return null
      throw error
    }
    if (!Array.isArray(raw)) return null

    const [next, visited, folderLines, directLines, leafLines] = raw as string[]

    const folderDeltas = new Map<string, number>()
    for (const line of (folderLines ?? '').split('\n')) {
      if (line === '') continue
      const tab = line.lastIndexOf('\t')
      folderDeltas.set(line.slice(0, tab), Number(line.slice(tab + 1)))
    }

    const directCounts = new Map<string, number>()
    for (const line of (directLines ?? '').split('\n')) {
      if (line === '') continue
      const tab = line.lastIndexOf('\t')
      directCounts.set(line.slice(0, tab), Number(line.slice(tab + 1)))
    }

    const leaves = new Map<string, string[]>()
    for (const line of (leafLines ?? '').split('\n')) {
      if (line === '') continue
      const tab = line.indexOf('\t')
      const parent = line.slice(0, tab)
      // No empty-name filter: a key ending in the separator (`a:`) has an EMPTY
      // leaf name and is a legitimate key. Dropping it made such keys unreachable
      // in the tree — caught by comparing against the existing scanner on a fixture
      // that includes `trailing:`.
      const names = line.slice(tab + 1).split('\u0001')
      const held = leaves.get(parent)
      if (held === undefined) leaves.set(parent, names)
      else held.push(...names)
    }

    return { cursor: String(next), visited: Number(visited), folderDeltas, directCounts, leaves }
  }

  /** DBSIZE for one logical database, used to size the index and its progress bar. */
  async keyCount(db: number): Promise<number> {
    const client = await this.client(db)
    return client.dbsize().catch(() => 0)
  }

  /**
   * One folder level of one database — how the tree is built.
   *
   * The previous design scanned the WHOLE keyspace and grouped it in the
   * browser, which cannot work on a real dataset: a 480k-key database produced a
   * capped, incomplete tree, and fetching TYPE and TTL with one round trip per
   * key meant ~1M round trips before anything rendered.
   *
   * A level scan reads exactly one level, and reads it COMPLETELY. Its cost is one
   * pass over the keys under `prefix`, and only that level's immediate children
   * cross the wire, so a folder nobody opens is never read.
   *
   * The pass is inherently O(keys under the prefix) — Redis has no "list
   * distinct prefixes" command, so SCAN is the only way to discover sub-folders.
   * What is avoided is paying it per folder: the same pass yields both the
   * sub-folder set and each sub-folder's key count.
   *
   * Completeness is the point, not an accident: a partial pass reports lower-bound
   * counts and can miss a folder, which is what the deleted key budget used to do.
   * The size where a complete pass is too slow is where the cached keyspace index
   * takes over (see the module comment where the budget was removed).
   *
   * @param prefix - folder path to list, '' for the database root.
   * @param withTypes - whether to fetch TYPE/TTL for this level's keys. The root
   *   level of a large database is all folders, so it usually needs none.
   */
  async level(input: { db: number; prefix: string; withTypes: boolean }): Promise<RedisLevelPage> {
    return this.withDeadline(
      this.levelUnbounded(input),
      this.treeDeadlineMs(),
      'scanning a key level',
      'the keyspace was too large to traverse within the time budget. Redis has no prefix index, so listing a level ' +
      'walks every key in the database. Try raising this data source\'s timeout setting, or open a narrower folder.',
    )
  }

  /** The actual level scan; callers go through {@link level} for the deadline. */
  private async levelUnbounded(input: { db: number; prefix: string; withTypes: boolean }): Promise<RedisLevelPage> {
    const client = await this.client(input.db)
    // The separator is appended so `prefix` selects only its SUBTREE: without
    // it, folder `a` would also sweep in folder `ab`.
    const prefix = input.prefix === '' ? '' : `${input.prefix}${SEPARATOR}`
    const match = `${escapeGlob(prefix)}*`

    /**
     * This level's key rows, plus a count per IMMEDIATE child folder.
     *
     * Three properties matter, and each is a decision rather than a detail:
     *
     * - Only the FIRST segment after the prefix is ever accumulated, so a level
     *   reports folders by counting segments instead of by holding every key name.
     *   The earlier version collected all names into a Set and grouped afterwards;
     *   on db1 that is ~1.2 GB of strings to draw a handful of rows.
     *
     * - The scan runs to the END of the level — there is no key budget. An early
     *   stop makes the counts LOWER BOUNDS and can omit a folder entirely, and the
     *   folder list is the number a user reads to decide what a database holds and
     *   whether a folder is safe to delete. What keeps that affordable is the
     *   database size rather than a constant: this path is only taken below
     *   `LARGE_DB_KEYS`, and a database big enough for a complete pass to hurt is
     *   served by the cached index instead (see the module comment above the
     *   deleted budget for the measurements).
     *
     * - Deduplication stays exact, because the visited names are retained in a Set.
     *   SCAN is at-least-once (a key can come back twice while the hash table
     *   rehashes), so counting occurrences as they stream would over-report.
     */
    const names = new Set<string>()
    let cursor = '0'

    do {
      const [next, found] = await client.scan(cursor, 'MATCH', match, 'COUNT', TREE_SCAN_COUNT)
      cursor = String(next)
      for (const name of found) {
        // A key that IS this level's prefix does not begin with `prefix + ':'`,
        // so `match` never returns it; it is added below instead.
        if (name.slice(prefix.length) === '') continue
        names.add(name)
      }
    } while (cursor !== '0')

    /**
     * One pass over the deduped names yields both this level's keys and the
     * sub-folder counts, so no folder is scanned twice.
     */
    const counts = new Map<string, number>()
    const keysHere: string[] = []
    for (const name of names) {
      const rest = name.slice(prefix.length)
      const at = rest.indexOf(SEPARATOR)
      if (at === -1) keysHere.push(name)
      else {
        const segment = rest.slice(0, at)
        counts.set(segment, (counts.get(segment) ?? 0) + 1)
      }
    }
    // Release them before the TYPE/TTL batch so the peak does not stack with that
    // batch's replies.
    names.clear()

    /**
     * A key whose name IS this level's prefix (`a:b` alongside `a:b:c`).
     *
     * Two separate questions, answered differently on purpose:
     *
     * - WHERE IT IS LISTED: at this level, because `a:b` has no separator after
     *   the prefix and is therefore a direct child key here. This level is the
     *   only place it can be clicked to inspect its value.
     * - HOW IT IS COUNTED: into the `a:b` FOLDER's size, because the folder row
     *   above this level must show what deleting that folder would destroy —
     *   and {@link deletePrefix} removes the path itself as well as every
     *   descendant. Counting it only here made the folder row read one lower
     *   than the destruction: a misleading number exactly where the user decides
     *   whether to trust it.
     */
    let ownKeyPresent = false
    if (input.prefix !== '') {
      ownKeyPresent = await client.type(input.prefix) !== 'none'
    }

    /**
     * Each child folder's size, made to equal what deleting that folder removes.
     *
     * A folder `a:b` whose name is ALSO a key contributes that key to its own
     * size, because {@link deletePrefix} deletes the path itself as well as its
     * descendants. Counting them separately made the row read one lower than the
     * destruction, which is the one number a user is relying on when they confirm
     * a folder delete.
     *
     * Only children of this level are probed, so this is one TYPE per visible
     * folder — not per key.
     */
    const childFolders: RedisLevelPage['folders'] = []
    for (const [segment, count] of counts) {
      const path = `${prefix}${segment}`
      const own = await client.type(path)
      childFolders.push({ name: segment, path, keys: own === 'none' ? count : count + 1 })
    }
    childFolders.sort((a, b) => compareKeyNames(a.name, b.name))

    // This level's own keys, plus the key that shares this level's own name, so
    // that opening the folder shows it (the only place it can be inspected).
    const rows = [...keysHere]
    if (ownKeyPresent) rows.push(input.prefix)
    rows.sort(compareKeyNames)
    const keysAtLevel = rows.length
    const shown = rows.length > MAX_LEVEL_KEYS_RETURNED
      ? rows.slice(0, MAX_LEVEL_KEYS_RETURNED)
      : rows

    const keys = input.withTypes
      ? await this.describeKeys(client, shown)
      : shown.map(key => ({ key, type: 'unknown', ttl: -1 }) satisfies RedisKeyInfo)

    const dbSize = await client.dbsize().catch(() => 0)
    return {
      folders: childFolders,
      keys,
      // The only way a level can now be short is the ROW list being capped: the
      // scan covers the whole level, so the counts are exact and `keysAtLevel`
      // states what was withheld from the rows.
      truncated: keysAtLevel > shown.length,
      keysAtLevel,
      dbSize,
    }
  }

  /**
   * Fetch TYPE and TTL for many keys in ONE round trip per batch.
   *
   * The per-key version cost two round trips per key, which is what made a large
   * level unusable. `pipeline()` sends the whole batch and reads the replies
   * together, so a 10k-key level costs two round trips per batch instead of 20k.
   */
  /**
   * Fetch TYPE and TTL for a list of keys, for a caller that has names but no client.
   *
   * The keyspace index route needs this: it holds key names (from the index) and
   * must add row metadata before rendering. It is a thin wrapper so the pipelining
   * rule stays in one place — one round trip per batch, never one per key.
   */
  async describeKeysPublic(db: number, names: string[]): Promise<RedisKeyInfo[]> {
    if (names.length === 0) return []
    const client = await this.client(db)
    return this.describeKeys(client, names)
  }

  private async describeKeys(client: RedisClient, names: string[]): Promise<RedisKeyInfo[]> {
    const out: RedisKeyInfo[] = []
    for (let i = 0; i < names.length; i += TREE_PIPELINE_BATCH) {
      const slice = names.slice(i, i + TREE_PIPELINE_BATCH)
      const pipeline = client.pipeline()
      for (const name of slice) pipeline.type(name)
      for (const name of slice) pipeline.ttl(name)
      const replies = await pipeline.exec()
      // Replies arrive in issue order: all TYPEs, then all TTLs.
      const half = slice.length
      for (let index = 0; index < half; index++) {
        const type = replyValue(replies[index])
        const ttl = replyValue(replies[index + half])
        out.push({
          key: slice[index]!,
          type: typeof type === 'string' ? type : 'unknown',
          // A key can vanish between the SCAN and this call; TYPE would then
          // report 'none'. -2 is Redis's own "key does not exist" TTL, which is
          // what the value view already renders.
          ttl: typeof ttl === 'number' ? ttl : -2,
        })
      }
    }
    return out
  }

  /**
   * Every key in one database matching a pattern, for the folder tree.
   *
   * Retained for callers that genuinely need a whole-database view (the tests
   * use it to assert what a folder operation left behind). The TREE does not use
   * it: see {@link level}. Still capped, and still reports truncation.
   */
  async tree(input: { db: number; pattern?: string }): Promise<RedisTreePage> {
    return this.withDeadline(
      this.treeUnbounded(input),
      this.treeDeadlineMs(),
      'scanning the key tree',
      'the keyspace was too large to traverse within the time budget. Try raising this data source\'s timeout setting.',
    )
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
    return { keys: await this.describeKeys(client, names), dbSize, truncated }
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
   * Set a string key's value.
   *
   * The type is checked first: `SET` on a list would silently REPLACE the whole
   * key with a string, which is data loss behind a button labelled "save the
   * value". Refusing with the actual type is the only safe answer.
   */
  async setString(key: string, value: string, db: number): Promise<RedisMutationResult> {
    return this.withDeadline(this.setStringUnbounded(key, value, db), this.deadlineMs(), `writing "${key}"`)
  }

  /** The actual string write; callers go through {@link setString}. */
  private async setStringUnbounded(key: string, value: string, db: number): Promise<RedisMutationResult> {
    const client = await this.client(db)
    const type = await client.type(key)
    if (type === 'none') throw new Error(`键「${key}」不存在`)
    if (type !== 'string') {
      throw new Error(`键「${key}」的类型是 ${type}，不能用字符串写入；请用元素编辑或命令行`)
    }
    // KEEPTTL so saving a value does not quietly clear an expiry the user set.
    await client.call('SET', key, value, 'KEEPTTL')
    return { affected: 1, ttl: await client.ttl(key), removed: false }
  }

  /**
   * Set or clear a key's TTL.
   *
   * `seconds <= 0` means "no expiry" and is applied with PERSIST, not
   * `EXPIRE 0` — the latter DELETES the key, which is a very different thing
   * from "make it permanent".
   */
  async setTtl(key: string, seconds: number, db: number): Promise<RedisMutationResult> {
    return this.withDeadline(this.setTtlUnbounded(key, seconds, db), this.deadlineMs(), `setting the TTL of "${key}"`)
  }

  /** The actual TTL write; callers go through {@link setTtl}. */
  private async setTtlUnbounded(key: string, seconds: number, db: number): Promise<RedisMutationResult> {
    const client = await this.client(db)
    const type = await client.type(key)
    if (type === 'none') throw new Error(`键「${key}」不存在`)

    let affected: number
    if (seconds <= 0) {
      // PERSIST reports 0 when the key already had no expiry; that is success,
      // not a failure, so the outcome is reported as one change either way.
      await client.call('PERSIST', key)
      affected = 1
    } else {
      const ok = await client.call('EXPIRE', key, Math.trunc(seconds))
      affected = Number(ok) === 1 ? 1 : 0
      if (affected === 0) throw new Error(`键「${key}」在设置过期时间时已不存在`)
    }
    return { affected, ttl: await client.ttl(key), removed: false }
  }

  /**
   * Apply one element edit to a collection key.
   *
   * Each op is checked against the key's real type before it runs, so a
   * mismatched edit names the problem instead of silently writing a second key
   * of a different type (Redis would create one on many write commands).
   */
  async editElement(key: string, edit: RedisElementEdit, db: number): Promise<RedisMutationResult> {
    return this.withDeadline(this.editElementUnbounded(key, edit, db), this.deadlineMs(), `editing "${key}"`)
  }

  /** The actual element edit; callers go through {@link editElement}. */
  private async editElementUnbounded(key: string, edit: RedisElementEdit, db: number): Promise<RedisMutationResult> {
    const client = await this.client(db)
    const type = await client.type(key)
    if (type === 'none') throw new Error(`键「${key}」不存在`)

    const after = async (affected: number): Promise<RedisMutationResult> => {
      // A collection that just lost its last element no longer exists; reporting
      // that lets the panel refresh instead of showing a key that is gone.
      const stillThere = await client.type(key)
      return {
        affected,
        ttl: stillThere === 'none' ? -2 : await client.ttl(key),
        removed: stillThere === 'none',
      }
    }

    switch (type) {
      case 'list': {
        if (edit.op === 'set') {
          if (edit.index === undefined) throw new Error('list 元素编辑需要 index')
          const total = Number(await client.call('LLEN', key))
          if (edit.index < 0 || edit.index >= total) throw new Error(`下标 ${edit.index} 超出范围（列表长度 ${total}）`)
          await client.call('LSET', key, edit.index, edit.value ?? '')
          return after(1)
        }
        if (edit.op === 'push') {
          await client.call('RPUSH', key, edit.value ?? '')
          return after(1)
        }
        if (edit.op === 'delete') {
          if (edit.index === undefined) throw new Error('list 元素删除需要 index')
          // LSET to a sentinel then LREM is the documented way to remove by
          // index; a duplicate value elsewhere in the list must not be removed
          // too, which plain LREM(value) would do.
          const sentinel = `\u0000dbm-delete-${Date.now()}-${Math.random()}`
          const total = Number(await client.call('LLEN', key))
          if (edit.index < 0 || edit.index >= total) throw new Error(`下标 ${edit.index} 超出范围（列表长度 ${total}）`)
          await client.call('LSET', key, edit.index, sentinel)
          const removed = Number(await client.call('LREM', key, 1, sentinel))
          return after(removed)
        }
        throw new Error(`list 不支持的操作：${edit.op}`)
      }

      case 'set': {
        if (edit.op === 'add') {
          const added = Number(await client.call('SADD', key, edit.value ?? ''))
          return after(added)
        }
        if (edit.op === 'delete') {
          if (edit.member === undefined) throw new Error('set 成员删除需要 member')
          // A set has no "edit in place": the member IS the value, so changing
          // one means removing it and adding the replacement.
          if (edit.value !== undefined && edit.value !== edit.member) {
            await client.call('SREM', key, edit.member)
            const added = Number(await client.call('SADD', key, edit.value))
            return after(added)
          }
          const removed = Number(await client.call('SREM', key, edit.member))
          return after(removed)
        }
        throw new Error(`set 不支持的操作：${edit.op}`)
      }

      case 'hash': {
        if (edit.member === undefined || edit.member === '') throw new Error('hash 编辑需要 field')
        if (edit.op === 'set') {
          await client.call('HSET', key, edit.member, edit.value ?? '')
          return after(1)
        }
        if (edit.op === 'delete') {
          const removed = Number(await client.call('HDEL', key, edit.member))
          return after(removed)
        }
        throw new Error(`hash 不支持的操作：${edit.op}`)
      }

      case 'zset': {
        if (edit.member === undefined || edit.member === '') throw new Error('zset 编辑需要 member')
        if (edit.op === 'set' || edit.op === 'add') {
          const score = edit.value ?? '0'
          if (!Number.isFinite(Number(score))) throw new Error(`分值不是数字：${score}`)
          // ZADD with the same member updates the score in place.
          const added = Number(await client.call('ZADD', key, score, edit.member))
          return after(added)
        }
        if (edit.op === 'delete') {
          const removed = Number(await client.call('ZREM', key, edit.member))
          return after(removed)
        }
        throw new Error(`zset 不支持的操作：${edit.op}`)
      }

      default:
        throw new Error(`键「${key}」的类型是 ${type}，不支持元素编辑`)
    }
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
    return this.withDeadline(
      this.deletePrefixUnbounded(path, db),
      this.treeDeadlineMs(),
      `deleting folder "${path}"`,
      'the traversal did not finish within the time budget. The delete is bounded and batched, so some keys may ' +
      'already be gone; re-read the folder to see what remains before retrying.',
    )
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
    return this.withDeadline(
      this.countPrefixUnbounded(path, db),
      this.treeDeadlineMs(),
      `counting folder "${path}"`,
      'the count walks every key under the folder and did not finish in time. Redis has no prefix index, so a folder ' +
      'this large cannot be counted quickly; raise this data source\'s timeout setting if the count is needed.',
    )
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
