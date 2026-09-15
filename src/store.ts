/**
 * Data-source config store: one JSON file (`$DSH_HOME/dsh-database.json`)
 * holding every data source entry, written atomically (tmp + rename).
 *
 * Secrets (passwords, TLS material) live in this user-owned file in
 * plaintext — the same trust model as dsh-ssh's host store. Document it,
 * never log it, and never project it onto a summary that reaches the browser
 * or the model.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { dshHome } from './dsh-home.ts'
import type {
  DataSourceEntry,
  DataSourcePayload,
  DataSourceSummary,
  DbAuthKind,
  DbKind,
} from './protocol.ts'
import { DB_KINDS } from './protocol.ts'

/** File format version. */
const FORMAT_VERSION = 1

/** Store file location: $DSH_HOME/dsh-database.json. */
export function storePath(): string {
  return join(dshHome(), 'dsh-database.json')
}

/** Persisted plugin settings that outlive the browser session. */
export interface StoredSettings {
  /**
   * Master switch for agent-initiated writes. Default false: the model may
   * read every configured source, and must be explicitly granted write access
   * by the user before a mutating tool can reach an engine.
   */
  allowAgentWrite: boolean
  /**
   * Whether a permitted write additionally raises the native approval prompt
   * each time. Default true.
   */
  requireApproval: boolean
}

/** Settings applied when the file carries none. */
export const DEFAULT_SETTINGS: StoredSettings = { allowAgentWrite: false, requireApproval: true }

interface StoreFile {
  version: number
  sources: DataSourceEntry[]
  settings?: StoredSettings
}

/** Stable id charset: letters/digits plus dots, hyphens, underscores. */
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** Whether a string is a usable id. */
export function isValidId(id: string): boolean {
  return ID_RE.test(id)
}

/** Default TCP port per engine. */
export function defaultPort(kind: DbKind): number {
  return kind === 'mysql' ? 3306 : 6379
}

/** Coerce an unknown value to a trimmed string, or undefined when empty. */
function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Coerce an unknown value to a string array (empty array when absent). */
function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(item => item !== '')
}

/** Derive the 认证 column value from an entry's credential fields. */
export function authKindOf(entry: DataSourceEntry): DbAuthKind {
  if (entry.kind === 'sqlite') return 'file'
  return entry.password !== undefined && entry.password !== '' ? 'password' : 'none'
}

/** Secret-free projection for the browser and agent surfaces. */
export function summarize(entry: DataSourceEntry): DataSourceSummary {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    group: entry.group,
    tags: [...entry.tags],
    description: entry.description,
    ...(entry.file === undefined ? {} : { file: entry.file }),
    ...(entry.host === undefined ? {} : { host: entry.host }),
    ...(entry.port === undefined ? {} : { port: entry.port }),
    ...(entry.user === undefined ? {} : { user: entry.user }),
    ...(entry.database === undefined ? {} : { database: entry.database }),
    ...(entry.db === undefined ? {} : { db: entry.db }),
    ...(entry.tls === undefined ? {} : { tls: entry.tls }),
    ...(entry.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: entry.connectTimeoutMs }),
    hasPassword: entry.password !== undefined && entry.password !== '',
    auth: authKindOf(entry),
    readonly: entry.readonly === true,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

/**
 * Validate a create/update payload.
 * @param payload - candidate payload.
 * @param existing - the entry being updated, when this is an update.
 * @returns a human-readable message, or undefined when valid.
 */
export function validatePayload(payload: DataSourcePayload, existing?: DataSourceEntry): string | undefined {
  const kind = payload.kind ?? existing?.kind
  if (kind === undefined) return 'kind is required'
  if (!DB_KINDS.includes(kind)) return `kind must be one of ${DB_KINDS.join(', ')}`

  const file = payload.file ?? existing?.file
  const host = payload.host ?? existing?.host

  if (kind === 'sqlite') {
    if (file === undefined || file.trim() === '') return 'file is required for sqlite'
  } else {
    if (host === undefined || host.trim() === '') return 'host is required'
    const port = payload.port ?? existing?.port ?? defaultPort(kind)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 'port must be an integer in 1..65535'
  }

  if (kind === 'mysql' && payload.user !== undefined && typeof payload.user !== 'string') {
    return 'user must be a string'
  }
  if (payload.db !== undefined) {
    if (!Number.isInteger(payload.db) || payload.db < 0 || payload.db > 15) return 'db must be an integer in 0..15'
    if (kind !== 'redis') return 'db is only valid for redis'
  }
  if (payload.tags !== undefined && (!Array.isArray(payload.tags) || payload.tags.some(t => typeof t !== 'string'))) {
    return 'tags must be an array of strings'
  }
  if (payload.connectTimeoutMs !== undefined && (!Number.isInteger(payload.connectTimeoutMs) || payload.connectTimeoutMs < 1000 || payload.connectTimeoutMs > 300000)) {
    return 'connectTimeoutMs must be an integer in 1000..300000'
  }
  return undefined
}

/** Merge a payload onto an entry, applying per-kind field rules. */
function applyPayload(base: DataSourceEntry, payload: DataSourcePayload, kind: DbKind, now: number): DataSourceEntry {
  const next: DataSourceEntry = {
    ...base,
    kind,
    name: str(payload.name) ?? base.name,
    group: payload.group === undefined ? base.group : (str(payload.group) ?? ''),
    tags: payload.tags === undefined ? base.tags : strArray(payload.tags),
    description: payload.description === undefined ? base.description : (str(payload.description) ?? ''),
    readonly: payload.readonly === undefined ? base.readonly : payload.readonly === true,
    updatedAt: now,
  }

  // Per-kind fields are fully rebuilt so switching an entry's engine cannot
  // leave a stale field from the previous kind behind.
  if (kind === 'sqlite') {
    next.file = str(payload.file) ?? base.file
    delete next.host
    delete next.port
    delete next.user
    delete next.password
    delete next.database
    delete next.db
    delete next.tls
  } else if (kind === 'mysql') {
    next.host = str(payload.host) ?? base.host
    next.port = payload.port ?? base.port ?? defaultPort('mysql')
    next.user = payload.user === undefined ? base.user : str(payload.user)
    next.database = payload.database === undefined ? base.database : str(payload.database)
    next.tls = payload.tls === undefined ? base.tls : payload.tls === true
    // An omitted password keeps the stored one; an explicit empty string clears it.
    if (payload.password !== undefined) next.password = payload.password === '' ? undefined : payload.password
    else next.password = base.password
    delete next.file
    delete next.db
  } else {
    next.host = str(payload.host) ?? base.host
    next.port = payload.port ?? base.port ?? defaultPort('redis')
    next.db = payload.db ?? base.db ?? 0
    next.tls = payload.tls === undefined ? base.tls : payload.tls === true
    if (payload.password !== undefined) next.password = payload.password === '' ? undefined : payload.password
    else next.password = base.password
    delete next.file
    delete next.user
    delete next.database
  }

  if (payload.connectTimeoutMs !== undefined) next.connectTimeoutMs = payload.connectTimeoutMs
  return next
}

/** A blank entry for a fresh create. */
function blankEntry(kind: DbKind, now: number): DataSourceEntry {
  return {
    id: '',
    kind,
    name: '',
    group: '',
    tags: [],
    description: '',
    readonly: false,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * The data-source store. Pure file I/O — no cordis dependency, unit-testable.
 */
export class DataSourceStore {
  /** The JSON file path. */
  readonly path: string

  constructor(path?: string) {
    this.path = resolve(path ?? storePath())
  }

  /** Read the whole file, tolerating an absent or damaged one. */
  private load(): StoreFile {
    if (!existsSync(this.path)) return { version: FORMAT_VERSION, sources: [] }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch {
      return { version: FORMAT_VERSION, sources: [] }
    }
    if (typeof parsed !== 'object' || parsed === null) return { version: FORMAT_VERSION, sources: [] }
    const file = parsed as Partial<StoreFile>
    return {
      version: typeof file.version === 'number' ? file.version : FORMAT_VERSION,
      sources: Array.isArray(file.sources) ? file.sources.filter(isValidEntryShape) : [],
      settings: file.settings,
    }
  }

  /** Load all entries (empty store when the file is absent or unreadable). */
  list(): DataSourceEntry[] {
    return this.load().sources
  }

  /** The persisted settings, with defaults applied. */
  settings(): StoredSettings {
    const raw = this.load().settings
    return {
      allowAgentWrite: raw?.allowAgentWrite === true,
      requireApproval: raw?.requireApproval !== false,
    }
  }

  /** Patch the persisted settings; omitted fields keep their stored value. */
  saveSettings(patch: Partial<StoredSettings>): StoredSettings {
    const file = this.load()
    const next: StoredSettings = {
      allowAgentWrite: patch.allowAgentWrite ?? file.settings?.allowAgentWrite === true,
      requireApproval: patch.requireApproval ?? file.settings?.requireApproval !== false,
    }
    this.writeFile({ ...file, settings: next })
    return next
  }

  /** Find one entry by id. */
  find(id: string): DataSourceEntry | undefined {
    return this.list().find(entry => entry.id === id)
  }

  /**
   * Build the id for a new entry: the payload's id when supplied and free,
   * otherwise a slug of the name with a numeric suffix on collision.
   */
  allocateId(payload: DataSourcePayload, existing: DataSourceEntry[]): string {
    const taken = new Set(existing.map(entry => entry.id))
    const requested = str(payload.id)
    if (requested !== undefined) {
      if (!isValidId(requested)) throw new Error('id must be letters, digits, dots, hyphens or underscores')
      if (taken.has(requested)) throw new Error(`id "${requested}" already exists`)
      return requested
    }
    const seeded = (str(payload.name) ?? payload.kind ?? 'db')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const base = seeded === '' || !/^[a-z0-9]/.test(seeded) ? `db-${Date.now().toString(36)}` : seeded
    if (!taken.has(base)) return base
    for (let n = 2; n < 1000; n++) {
      const candidate = `${base}-${n}`
      if (!taken.has(candidate)) return candidate
    }
    return `${base}-${Date.now().toString(36)}`
  }

  /** Create one entry; returns the stored record. */
  create(payload: DataSourcePayload): DataSourceEntry {
    const existing = this.list()
    const kind = (payload.kind ?? 'sqlite') as DbKind
    const problem = validatePayload(payload)
    if (problem !== undefined) throw new Error(problem)
    const now = Date.now()
    const id = this.allocateId(payload, existing)
    const entry = applyPayload({ ...blankEntry(kind, now), id, name: str(payload.name) ?? id }, payload, kind, now)
    if (entry.name.trim() === '') entry.name = entry.id
    this.write([...existing, entry])
    return entry
  }

  /** Update one entry in place; returns the stored record. */
  update(id: string, payload: DataSourcePayload): DataSourceEntry {
    const existing = this.list()
    const index = existing.findIndex(entry => entry.id === id)
    if (index === -1) throw new Error(`no data source with id "${id}"`)
    const current = existing[index]!
    const kind = (payload.kind ?? current.kind) as DbKind
    const problem = validatePayload(payload, current)
    if (problem !== undefined) throw new Error(problem)
    const now = Date.now()
    const entry = applyPayload(current, payload, kind, now)
    if (entry.name.trim() === '') entry.name = entry.id
    const next = [...existing]
    next[index] = entry
    this.write(next)
    return entry
  }

  /** Remove one entry; returns whether it existed. */
  remove(id: string): boolean {
    const existing = this.list()
    const next = existing.filter(entry => entry.id !== id)
    if (next.length === existing.length) return false
    this.write(next)
    return true
  }

  /**
   * Atomically replace the store file, preserving its settings section. The
   * mode is pinned to 0600 on POSIX so the plaintext secrets inside are not
   * group/world readable.
   */
  private write(sources: DataSourceEntry[]): void {
    this.writeFile({ ...this.load(), sources })
  }

  /** Atomically write one complete store file. */
  private writeFile(file: StoreFile): void {
    const payload: StoreFile = { version: FORMAT_VERSION, sources: file.sources, settings: file.settings ?? DEFAULT_SETTINGS }
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, this.path)
  }
}

/** Structural check for one entry read back from disk. */
function isValidEntryShape(value: unknown): value is DataSourceEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry['id'] === 'string' &&
    entry['id'] !== '' &&
    typeof entry['kind'] === 'string' &&
    (DB_KINDS as readonly string[]).includes(entry['kind']) &&
    typeof entry['name'] === 'string'
  )
}

/** Normalize a partial record read from an older file into a full entry. */
export function normalizeEntry(entry: DataSourceEntry): DataSourceEntry {
  return {
    ...entry,
    group: entry.group ?? '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    description: entry.description ?? '',
    readonly: entry.readonly === true,
    createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
    updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
  }
}
