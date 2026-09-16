/**
 * dsh-database-manager — host half.
 *
 * Mounts the data-source store, the live-driver pool, the /api/dsh-database
 * route family, the agent tools (db_list / db_schema / db_query / db_exec),
 * the write-authorization gate, and a system-prompt announcement. The browser
 * half (./client) renders the sidebar entry and the management panel.
 *
 * Everything rides public harness seams — `webServer`, `tools`,
 * `systemPrompt` — with no changes to the harness itself.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { DEFAULT_GATE_SETTINGS, describePosture, installGate, type GateSettings } from './auth.ts'
import { makeRoutes } from './routes.ts'
import { ConnectionPool } from './pool.ts'
import { DataSourceStore } from './store.ts'
import { makeTools } from './tools.ts'
import { IndexRegistry } from './index-registry.ts'
import { isRedisDriver } from './drivers/types.ts'
import type { HostContext } from './llm-types.ts'

/** Stable cordis plugin name. */
export const name = 'database-manager'

/** Services required before the surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 155

/** Model-facing announcement: what the plugin is, and its write posture. */
export function guidance(gate: GateSettings): string {
  return (
    '本机已安装 dsh-database-manager 插件（DSH 数据库管理）：侧边栏「数据库管理」入口，独立面板可管理 SQLite / MySQL / Redis。' +
    '数据源配置存 $DSH_HOME/dsh-database.json（含明文口令的私密文件，不要读取或转发其内容）。' +
    `能力：db_list 列出数据源、db_schema 查看库/表/列/索引结构、db_query 执行只读查询（SQL 或 Redis 读命令）、db_exec 执行写操作。${describePosture(gate)}` +
    '限制：数据源必须由用户在面板中先配置，agent 才能操作；写操作受用户开关与审批保护；结果集有行数上限，超限会被截断；db_query 拒绝写语句。' +
    '路径区分：SQLite 的 file 是本机（dsh host）路径，用本地工具读写；远程库一律通过本插件的工具操作。' +
    '用户提到「数据库 / 表 / SQL / 查询数据 / Redis / 键值 / 改数据」时即指本插件，请据此协作。'
  )
}

/** Resolved plugin config. */
export interface Config {
  /** When true, announce the plugin to every agent. Default true. */
  announceToAgent?: boolean
  /** Master switch for the whole capability (routes, tools, prompt section). */
  enabled?: boolean
}

/**
 * Mount the store, pool, routes, tools, gate, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - resolved plugin config.
 */
export const apply = mountOnce('dsh-database-manager', applyImpl)

function applyImpl(ctx: HostContext, config?: Config): void {
  const store = new DataSourceStore()
  const pool = new ConnectionPool(store)
  ctx.effect(() => () => { pool.dispose() }, 'dsh-database-manager: pool')

  /**
   * Cached keyspace trees, one per source and database.
   *
   * The resolver is lazy and goes through the pool, so the registry holds no client
   * of its own: a connection change or an idle drop is handled by the pool alone.
   * Only the Redis driver can be indexed, so anything else is rejected here rather
   * than surfacing as a confusing failure mid-walk.
   */
  const indexes = new IndexRegistry(async sourceId => {
    const { driver } = pool.acquireById(sourceId)
    if (!isRedisDriver(driver)) throw new Error(`data source "${sourceId}" is not a Redis source`)
    return driver
  })
  ctx.effect(() => () => { indexes.disposeAll() }, 'dsh-database-manager: indexes')

  // The live write posture: the persisted file is the source of truth, and the
  // in-process snapshot keeps a dispatch from touching the disk.
  let gate: GateSettings = { ...DEFAULT_GATE_SETTINGS, ...store.settings() }
  const readGate = (): GateSettings => gate
  const saveGate = (patch: Partial<GateSettings>): GateSettings => {
    gate = { ...gate, ...store.saveSettings(patch) }
    // Re-register the announcement so its posture sentence stays truthful.
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    disposeSection = announce(ctx, config, gate)
    return gate
  }

  let disposeRoutes: (() => void) | undefined
  let disposeTools: (() => void) | undefined
  let disposeGate: (() => void) | undefined
  let disposeSection: (() => void) | undefined

  const enabled = config?.enabled !== false
  if (!enabled) return

  // Authorization first: the gate must exist before any tool can be dispatched.
  disposeGate = ctx.effect(
    () => installGate(ctx, store, readGate),
    'dsh-database-manager: authorization gate',
  )

  const { routes } = makeRoutes({ store, pool, indexes, gate: readGate, saveGate })
  disposeRoutes = ctx.effect(
    () => {
      const disposers = routes.map(route => ctx.webServer!.register(route))
      return () => { for (const dispose of disposers) dispose() }
    },
    'dsh-database-manager: routes',
  )

  const tools = makeTools(store, pool, (definition) => defineTool(definition as never))
  disposeTools = ctx.effect(
    () => {
      const disposers = tools.map(tool => ctx.tools!.register(tool))
      return () => { for (const dispose of disposers) dispose() }
    },
    'dsh-database-manager: tools',
  )

  disposeSection = announce(ctx, config, gate)
}

/** Register (or skip) the system-prompt announcement. */
function announce(ctx: HostContext, config: Config | undefined, gate: GateSettings): () => void {
  if (config?.announceToAgent === false) return () => {}
  try {
    return ctx.systemPrompt?.section({
      name: 'plugin:dsh-database-manager',
      order: SECTION_ORDER,
      text: guidance(gate),
    }) ?? (() => {})
  } catch {
    // A missing systemPrompt seat must not fail the whole plugin: the routes
    // and tools are the capability, the announcement is a convenience.
    return () => {}
  }
}

/**
 * Single-instance guard: the host composes the same package only once, but a
 * duplicate install (npm copy plus a repo link) would re-register the same
 * routes and tools and throw at boot. The second mount becomes a no-op; the
 * registry rides a global symbol so two module instances share one verdict.
 */
const MOUNTED = Symbol.for('dsh-web.mounted-plugins')

function mountOnce<T extends (...args: any[]) => unknown>(packageName: string, fn: T): T {
  return ((...args: unknown[]) => {
    const registry = globalThis as { [MOUNTED]?: Set<string> }
    const mounted = (registry[MOUNTED] ??= new Set<string>())
    if (mounted.has(packageName)) return
    mounted.add(packageName)
    const ctx = args[0] as { effect?: (effect: () => unknown) => unknown } | undefined
    ctx?.effect?.(() => () => {
      mounted.delete(packageName)
    })
    return fn(...args)
  }) as T
}
