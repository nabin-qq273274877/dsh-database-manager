/**
 * Agent write-authorization gate — the single place that decides whether a
 * model-initiated write may run.
 *
 * Two independent layers, both fail-closed:
 *
 * 1. **Monotonic guard** (`ctx.tools.guard`): the read/write split of this
 *    plugin's own tools is enforced before dispatch. A write tool against a
 *    data source marked readonly, or with the global agent-write switch off,
 *    is denied outright — no approval is offered, because the answer is known.
 *
 * 2. **Approval waterfall** (`tools/pre-execute`): when the switch is on and
 *    the target is writable, the call is routed to the `approval` service,
 *    which raises the native DSH approval prompt. A missing approval service
 *    makes the framework deny the call, and a rejected/cancelled prompt denies
 *    it too, so "no answerer" never means "allowed".
 *
 * The GUI is deliberately outside this gate: the user clicking 保存 in the
 * panel is the authorization, exactly as it is for the shell tool.
 */

import type { DataSourceStore } from './store.ts'

/**
 * Structural view of one pending tool call, as the guard and the
 * pre-execute waterfall receive it. Only the fields this gate reads are named.
 */
export interface GateExecution {
  /** The wire tool name. */
  readonly name: string
  /** The parsed, lossless-JSON arguments. */
  readonly arguments: unknown
}

/** The tool names this plugin registers, split by whether they can write. */
export const READ_TOOLS: readonly string[] = ['db_list', 'db_schema', 'db_query']

/** Tools that can mutate a data source. Listed here so the guard knows them. */
export const WRITE_TOOLS: readonly string[] = ['db_exec']

/** Every tool this plugin owns. */
export const OWNED_TOOLS: readonly string[] = [...READ_TOOLS, ...WRITE_TOOLS]

/** Live authorization settings the gate reads on every dispatch. */
export interface GateSettings {
  /** Master switch for agent-initiated writes. Default false. */
  allowAgentWrite: boolean
  /**
   * When true, a write is permitted only after the approval prompt. Default
   * true; turning it off makes writes that pass the switch run unprompted,
   * which is only sensible for a fully trusted unattended deployment.
   */
  requireApproval: boolean
}

/** Default settings: reads allowed, writes refused. */
export const DEFAULT_GATE_SETTINGS: GateSettings = {
  allowAgentWrite: false,
  requireApproval: true,
}

/** Whether a tool name is one this plugin owns. */
export function isOwnedTool(name: string): boolean {
  return OWNED_TOOLS.includes(name)
}

/** Whether a tool name is a write tool of this plugin. */
export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.includes(name)
}

/**
 * Extract the data source id a call targets, from whichever parameter shape
 * the tool uses. Returns undefined when the call carries none — the tools all
 * require it, so that only happens for a malformed call that argument
 * validation will reject anyway.
 */
export function sourceIdOf(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const record = args as Record<string, unknown>
  for (const key of ['source', 'sourceId', 'id']) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/** Outcome of the pre-dispatch authorization check. */
export type GateDecision =
  /** Not our tool, or a read: let the registry continue. */
  | { kind: 'pass' }
  /** Refused outright; `reason` reaches the model as the tool error. */
  | { kind: 'deny'; reason: string }
  /** Needs the user's approval; `reason` is shown in the prompt. */
  | { kind: 'ask'; reason: string }

/**
 * Decide one model-initiated call.
 *
 * @param name - the wire tool name.
 * @param args - the parsed arguments (unknown; narrowed here).
 * @param store - the data-source store, for per-source readonly flags.
 * @param settings - the live settings snapshot.
 */
export function decideCall(
  name: string,
  args: unknown,
  store: DataSourceStore,
  settings: GateSettings,
): GateDecision {
  if (!isWriteTool(name)) return { kind: 'pass' }

  const sourceId = sourceIdOf(args)
  if (sourceId === undefined) {
    return { kind: 'deny', reason: `${name} requires a "source" argument` }
  }
  const entry = store.find(sourceId)
  if (entry === undefined) {
    return { kind: 'deny', reason: `no data source with id "${sourceId}"` }
  }
  if (entry.readonly) {
    return {
      kind: 'deny',
      reason:
        `data source "${entry.name}" (${entry.id}) is marked readonly. ` +
        'Ask the user to clear the readonly flag in the 数据库管理 panel before writing.',
    }
  }

  if (!settings.allowAgentWrite) {
    return {
      kind: 'deny',
      reason:
        `agent writes are disabled for data source "${entry.name}" (${entry.id}). ` +
        'The user must enable “允许 agent 写入” for the database panel (or use the GUI). ' +
        'Read-only tools (db_list / db_schema / db_query) remain available.',
    }
  }

  const target = entry.kind === 'sqlite' ? (entry.file ?? entry.id) : `${entry.host ?? ''}:${entry.port ?? ''}`
  return {
    kind: 'ask',
    reason: `run a write against ${entry.kind} data source "${entry.name}" (${target})`,
  }
}

/**
 * Register the two authorization layers on the host context.
 *
 * @param ctx - host plugin context carrying `tools`.
 * @param store - the data-source store.
 * @param settings - live settings reader.
 * @returns disposer removing both layers.
 */
export function installGate(
  ctx: unknown,
  store: DataSourceStore,
  settings: () => GateSettings,
): () => void {
  const context = ctx as {
    on: (name: string, listener: (...args: any[]) => unknown) => () => void
    get: (name: string) => unknown
  }

  // Layer 2: the monotonic guard. A returned string denies; returning
  // undefined leaves the call allowed for the next guard.
  const tools = context.get('tools') as { guard?: (guard: (exec: GateExecution) => string | undefined) => () => void } | undefined
  const disposeGuard = tools?.guard?.((exec) => {
    if (!isWriteTool(exec.name)) return undefined
    const decision = decideCall(exec.name, exec.arguments, store, settings())
    return decision.kind === 'deny' ? decision.reason : undefined
  })

  // Layer 1: the approval waterfall. Runs before the guard and only ever
  // adds an ask; a call the guard will deny still gets denied after the user
  // answers, so ordering cannot turn a denial into permission.
  const disposePre = context.on('tools/pre-execute', async (exec: GateExecution, next: () => Promise<unknown>) => {
    if (!isWriteTool(exec.name)) return next()
    const current = settings()
    const decision = decideCall(exec.name, exec.arguments, store, current)
    if (decision.kind === 'deny') {
      // Let the guard produce the denial so the reason is reported once, by
      // the layer whose contract is "deny unconditionally".
      return next()
    }
    if (decision.kind === 'ask' && current.requireApproval) {
      return { kind: 'ask', reason: decision.reason }
    }
    return next()
  })

  return () => {
    disposePre()
    disposeGuard?.()
  }
}

/** The agent-facing description of the write posture, used in the prompt section. */
export function describePosture(settings: GateSettings): string {
  if (!settings.allowAgentWrite) {
    return '当前策略：只读（agent 写入被拒绝；用户需在「数据库管理」面板开启“允许 agent 写入”）。'
  }
  return settings.requireApproval
    ? '当前策略：可写，但每次写入都会弹出审批框由用户确认。'
    : '当前策略：可写且不需审批（用户已显式关闭审批）。'
}
