import * as React from 'react'
/**
 * Browser-half entry for the dsh-database-manager plugin.
 *
 * Two slot registrations, both official harness seams — no DOM injection and
 * no MutationObserver self-healing:
 *
 * - `sidebar.panellist` (list): the 数据库管理 row, rendered by the shell
 *   directly beneath New Session — the same place the SSH plugin's entry sits.
 *   Clicking it calls `ctx.layout.selectPanel('database-manager')`.
 * - `main` (keyed): the panel itself. The shell renders it in the centre
 *   column whenever `activePanelId === 'database-manager'`, and falls back to
 *   the conversation otherwise — which is why clicking any session row
 *   returns to the conversation with no work on our side.
 *
 * Failure policy: mounting problems are logged, never thrown. A throwing
 * client apply fails the whole web boot, and an external plugin must not be
 * able to take the GUI down.
 */

import type { DbApi } from './api.ts'
import { DbApi as DbApiImpl } from './api.ts'
import { DatabasePanel } from './DatabasePanel.ts'
import { PanelController } from './controller.ts'
import { en, zh } from './locales.ts'
import { PANEL_CSS } from './styles.ts'

/** Locale namespace this plugin owns. */
const NS = 'dsh-database-manager'

/** The `main` slot key the sidebar entry selects. */
export const PANEL_ID = 'database-manager'

/** The `sidebar.panellist` registration id. */
const ENTRY_ID = 'database-manager'

/** Sidebar glyph: a stacked-database mark sized to the shell's nav icons. */
const ICON =
  '<svg viewBox="0 0 16 16" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.4" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<ellipse cx="8" cy="3.6" rx="5.1" ry="2.1"/>' +
  '<path d="M2.9 3.6v8.8c0 1.16 2.28 2.1 5.1 2.1s5.1-.94 5.1-2.1V3.6"/>' +
  '<path d="M2.9 8c0 1.16 2.28 2.1 5.1 2.1s5.1-.94 5.1-2.1"/>' +
  '</svg>'

/**
 * Required services: the slot registry and the dictionary registry. `layout` is
 * deliberately NOT injected — the shell's own panel row performs the panel
 * routing, so this plugin never has to call it, and a shell without it can
 * still load the plugin.
 */
export const inject = ['slots', 'locale']

/** Mount the sidebar entry and the management panel. */
export function apply(ctx: unknown): void {
  const context = ctx as {
    get(name: string): unknown
    effect(effect: () => unknown, label?: string): void
    slots: {
      inject(key: string, callback: () => () => void): () => void
      register(options: Record<string, unknown>, component: unknown): () => void
      entriesOfSlot?(key: string): Array<{ options: Record<string, unknown> }>
    }
    layout: { selectPanel(id: string | null): void }
    locale: {
      register(ns: string, dicts: Record<string, unknown>): () => void
      bind(ns: string): (key: string, values?: Record<string, string | number>) => string
      subscribe(listener: () => void): () => void
    }
  }

  const api: DbApi = new DbApiImpl()
  const controller = new PanelController()

  // ---- styles ------------------------------------------------------------
  const styles = context.get('styles') as { insert(css: string): () => void } | undefined
  if (styles !== undefined) {
    context.effect(() => styles.insert(PANEL_CSS), 'dsh-database-manager: styles')
  }

  // ---- dictionaries ------------------------------------------------------
  context.effect(() => {
    try {
      return context.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-database-manager: dictionaries')

  // A locale switch must re-render the panel's copy; the tick is the prop that
  // makes React re-run the subtree.
  let localeTick = 0
  const localeListeners = new Set<() => void>()
  context.effect(() => {
    try {
      return context.locale.subscribe(() => {
        localeTick++
        for (const listener of [...localeListeners]) listener()
      })
    } catch {
      return () => {}
    }
  }, 'dsh-database-manager: locale refresh')

  // ---- sidebar entry -----------------------------------------------------
  const container = context.slots
  context.effect(() => {
    try {
      return container.inject('sidebar.panellist', () =>
        container.register(
          {
            name: 'sidebar.panellist',
            id: ENTRY_ID,
            order: 20,
            label: () => labelOf(context, 'entry.label', '数据库管理'),
          },
          (props: { size: number; active: boolean }) =>
            React.createElement('span', {
              style: { display: 'inline-flex', width: props.size, height: props.size },
              dangerouslySetInnerHTML: { __html: ICON },
            }),
        ),
      )
    } catch (failure) {
      console.warn('[dsh-database-manager] sidebar entry mount failed:', failure)
      return () => {}
    }
  }, 'dsh-database-manager: sidebar entry')

  // No click handler is needed here: the shell's own PanelRow calls
  // `ctx.layout.selectPanel(<our id>)` when the row is pressed, and a press on
  // any session row calls `selectPanel(null)`, which is what returns the user to
  // the conversation. Clicking the row again therefore toggles for free, exactly
  // as the shell's built-in panel rows behave.

  // ---- panel -------------------------------------------------------------
  context.effect(() => {
    try {
      return container.inject('main', () =>
        container.register(
          { name: 'main', key: PANEL_ID },
          () => React.createElement(PanelHost, { controller, api, localeListeners }),
        ),
      )
    } catch (failure) {
      console.warn('[dsh-database-manager] panel mount failed:', failure)
      return () => {}
    }
  }, 'dsh-database-manager: panel')
}

/** Read a label from the active dictionary, falling back to Chinese copy. */
function labelOf(ctx: { locale: { bind(ns: string): (key: string) => string } }, key: string, fallback: string): string {
  try {
    return ctx.locale.bind(NS)(key) || fallback
  } catch {
    return fallback
  }
}

/**
 * The panel host component: it keeps the locale tick local so only this
 * subtree re-renders on a language switch, and it wires the sidebar row's
 * click to the panel router.
 */
function PanelHost(props: {
  controller: PanelController
  api: DbApi
  localeListeners: Set<() => void>
}): React.ReactElement {
  const { controller, api, localeListeners } = props
  const [localeTick, setLocaleTick] = React.useState(0)

  React.useEffect(() => {
    const listener = (): void => setLocaleTick(value => value + 1)
    localeListeners.add(listener)
    return () => { localeListeners.delete(listener) }
  }, [localeListeners])

  return React.createElement(DatabasePanel, { controller, api, localeTick })
}

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { DatabasePanelProps } from './DatabasePanel.ts'
export type { SourceListViewProps } from './SourceListView.ts'
export type { SqlDatabaseViewProps } from './SqlDatabaseView.ts'
export type { RedisDatabaseViewProps } from './RedisDatabaseView.ts'
export type { PanelSnapshot, PanelScreen } from './controller.ts'
