/**
 * Structural copies of the harness type surface the host half reads.
 *
 * A dual-face plugin must typecheck and build without the harness's own
 * packages installed next to it, so the few shapes it touches are restated
 * here. Only the fields this plugin actually reads are listed — a full mirror
 * would be a maintenance liability and would drift silently.
 */

/** One content block the model receives. */
export interface ContentBlock {
  type: 'text'
  text: string
}

/** The slice of the harness `Context` the host plugin uses. */
export interface HostContext {
  get(name: string): unknown
  on(name: string, listener: (...args: any[]) => unknown): () => void
  effect(effect: () => unknown, label?: string): () => void
  inject(names: string[], callback: (ctx: HostContext) => void): void
  tools?: {
    register(definition: unknown): () => void
    guard(guard: (exec: unknown) => string | undefined): () => void
  }
  webServer?: {
    register(route: unknown): () => void
  }
  systemPrompt?: {
    section(section: { name: string; order: number; text: string }): () => void
  }
  settings?: {
    installSection(
      ctx: unknown,
      ns: string,
      schema: unknown,
      entry: unknown,
      hooks: { setSource: (source: () => unknown) => void; onChange: () => void },
    ): void
    register(ns: string, schema: unknown, options: unknown): { get?: () => unknown; watch?: (listener: () => void) => void } | undefined
  }
}
