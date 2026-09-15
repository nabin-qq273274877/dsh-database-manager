/**
 * Redis driver on ioredis. One client per data source plus a separate client
 * for the logical database currently being browsed, since a Redis connection
 * is pinned to a database index for its lifetime.
 *
 * `ioredis` is an optional dependency: a deployment running only SQLite must
 * boot fine, so the import is lazy and its failure is an actionable message.
 */

import type { DataSourceEntry, QueryResult, RedisInfo, RedisKeyInfo, RedisKeyPage, RedisValue, TestResult } from '../protocol.ts'
import { toWireValue } from '../sql-util.ts'
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
    const client = new Redis(this.entry.port ?? 6379, host, {
      password: this.entry.password === '' ? undefined : this.entry.password,
      db: index,
      connectTimeout: this.entry.connectTimeoutMs ?? 10000,
      // Fail a command rather than queueing it forever when the server is down;
      // a UI action must always settle.
      maxRetriesPerRequest: 2,
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

  async test(): Promise<TestResult> {
    const started = Date.now()
    try {
      const client = await this.client()
      const pong = await client.ping()
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
    const client = await this.client(db)
    const started = Date.now()
    const [name, ...rest] = args
    const result = await client.call(name!, ...rest)
    return shapeRedisReply(result, Date.now() - started)
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

/** Human-readable ioredis error, keeping the server's own message. */
function describeRedisError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown; message?: unknown }
    const message = typeof record.message === 'string' ? record.message : undefined
    const code = typeof record.code === 'string' ? record.code : undefined
    if (message !== undefined) return code === undefined ? message : `${message} (${code})`
  }
  return error instanceof Error ? error.message : String(error)
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
