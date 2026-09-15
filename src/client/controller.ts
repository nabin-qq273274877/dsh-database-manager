/**
 * Panel controller: the single owner of the panel's view state (which screen
 * is showing, and which data source is open). Framework-free so the slot
 * registrations and the React views share one tiny subscription surface, and
 * so the state survives a React re-render of the shell.
 */

import type { DataSourceSummary } from '../protocol.ts'

/** Which screen the panel is showing. */
export type PanelScreen =
  | { name: 'list' }
  | { name: 'sql'; source: DataSourceSummary; schemas: string[] }
  | { name: 'redis'; source: DataSourceSummary; info: import('../protocol.ts').RedisInfo }

/** Immutable controller snapshot for the views to render from. */
export interface PanelSnapshot {
  screen: PanelScreen
}

/** The panel state owner the slot registrations and views read. */
export class PanelController {
  private screen: PanelScreen = { name: 'list' }
  private readonly listeners = new Set<() => void>()

  /** Current state; referentially stable until a mutation. */
  getSnapshot(): PanelSnapshot {
    return { screen: this.screen }
  }

  /** Subscribe to state changes; the returned function unsubscribes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Show the data-source list. */
  showList(): void {
    this.set({ name: 'list' })
  }

  /** Open a SQL data source. */
  showSql(source: DataSourceSummary, schemas: string[]): void {
    this.set({ name: 'sql', source, schemas })
  }

  /** Open a Redis data source. */
  showRedis(source: DataSourceSummary, info: import('../protocol.ts').RedisInfo): void {
    this.set({ name: 'redis', source, info })
  }

  /** Replace the open source's summary (after an edit). */
  updateSource(source: DataSourceSummary): void {
    const current = this.screen
    if (current.name === 'list') return
    if (current.source.id !== source.id) return
    this.set({ ...current, source })
  }

  private set(next: PanelScreen): void {
    this.screen = next
    for (const listener of [...this.listeners]) listener()
  }
}
