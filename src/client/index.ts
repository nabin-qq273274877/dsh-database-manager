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

/** The panel's own root class, used to ask the DOM whether it is on screen. */
const PANEL_ROOT_SELECTOR = '.dbm-root'

/**
 * Attribute marking this plugin's sidebar glyph.
 *
 * The shell renders its own row `<button>` and our glyph *inside* it, so the row
 * is identified by looking DOWN from the click target for this attribute —
 * `closest()`, which walks ancestors, can never see it. An earlier version made
 * exactly that mistake and the row press was silently ignored in the browser.
 */
const ENTRY_GLYPH_ATTRIBUTE = 'data-dsh-dbm-entry'
const ENTRY_GLYPH_SELECTOR = `[${ENTRY_GLYPH_ATTRIBUTE}]`

/**
 * The family's cross-plugin activation event (name fixed by dsh-ssh).
 *
 * The pairing below is fixed on SSH's side — its mount core yields the column
 * only for the literal `'taskboard'` — so that is the value to broadcast when
 * this panel needs SSH to step aside.
 */
const ACTIVATE_EVENT = 'dsh-panel-activate'

/** `detail` values for ACTIVATE_EVENT, and the `<html>` attribute each panel owns. */
const SIBLING_ACTIVATION = { ssh: 'ssh', taskboard: 'taskboard' } as const
const SIBLING_HTML_ATTRIBUTES = { ssh: 'data-dsh-ssh-active', taskboard: 'data-dsh-taskboard-active' } as const

/** Sidebar rows whose press means "leave the panel and show the conversation". */
const SIDEBAR_ROW_SELECTOR =
  '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'

/** Sidebar glyph: a stacked-database mark at the size the SSH entry uses. */
const ICON =
  '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<ellipse cx="8" cy="3.6" rx="5.1" ry="2.1"/>' +
  '<path d="M2.9 3.6v8.8c0 1.16 2.28 2.1 5.1 2.1s5.1-.94 5.1-2.1V3.6"/>' +
  '<path d="M2.9 8c0 1.16 2.28 2.1 5.1 2.1s5.1-.94 5.1-2.1"/>' +
  '</svg>'

// The glyph's box geometry (24px, SSH's sizing, plus the 2px per side the
// shell's narrower row padding lacks) lives in the `.dbm-entry-glyph` rule of
// styles.ts, where the measured reasoning is recorded.

/**
 * Services this plugin hard-depends on. `layout` is a genuine dependency: the
 * panel must be able to hand the centre column back to the conversation on its
 * own (the sidebar row's second press, the back control, and Escape all need
 * it), because the shell's PanelRow only ever selects and never toggles.
 */
export const inject = ['slots', 'locale', 'layout']

/** Mount the sidebar entry and the management panel. */
export function apply(ctx: unknown): void {
  const context = ctx as {
    get(name: string): unknown
    /**
     * Run an effect and own its teardown. Cordis runs the callback immediately
     * and treats its return value as the fiber's disposer.
     */
    effect(effect: () => unknown, label?: string): () => void
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
  // Injected straight into document.head. The dynamic-plugin `styles` builtin
  // is NOT available to an installed plugin (the client service catalog has no
  // such seat), so relying on it silently produced an unstyled panel. This is
  // the same approach every shipped UI plugin uses for its own CSS module.
  context.effect(() => installStyles(PANEL_CSS, 'dsh-database-manager'), 'dsh-database-manager: styles')

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
              className: 'dbm-entry-glyph',
              [ENTRY_GLYPH_ATTRIBUTE]: ENTRY_ID,
              'data-size': String(props.size),
              dangerouslySetInnerHTML: { __html: ICON },
            }),
        ),
      )
    } catch (failure) {
      console.warn('[dsh-database-manager] sidebar entry mount failed:', failure)
      return () => {}
    }
  }, 'dsh-database-manager: sidebar entry')

  // ---- centre-column arbitration -----------------------------------------
  // The `main` slot alone is not enough for this panel to behave like the SSH
  // panel. Three gaps were reproduced with real mouse input in a browser:
  //
  //   1. Pressing our sidebar row again does nothing. The shell's PanelRow calls
  //      `layout.selectPanel(id)` unconditionally — it does not toggle — so the
  //      panel cannot be closed from the sidebar.
  //   2. Opening SSH leaves our row highlighted with SSH's UI on screen. SSH
  //      takes the column by setting `data-dsh-ssh-active` on <html> and hiding
  //      every other child of the column; our panel is one of them, so it goes
  //      invisible while the shell's `activePanelId` still names it.
  //   3. Nothing inside the panel offers a way back to the conversation.
  //
  // (3) is a control in the view headers. (1) and (2) need the open state, which
  // is read from the DOM rather than tracked in a variable: a mirrored flag can
  // drift from what the shell actually renders, and it did — the row press was
  // silently ignored because the flag was never set.
  const rowButton = (): HTMLElement | null => {
    // Our glyph lives INSIDE the shell's row button, so the row is found by
    // looking for the button that contains it.
    const glyph = document.querySelector(ENTRY_GLYPH_SELECTOR)
    return glyph === null ? null : (glyph.closest('button') as HTMLElement | null)
  }

  /** Whether the shell currently considers this panel the selected one. */
  const isShellActive = (): boolean => {
    const button = rowButton()
    return button !== null && button.getAttribute('aria-current') === 'page'
  }

  /** Whether our panel is on screen right now. */
  const isVisible = (): boolean => {
    const root = document.querySelector(PANEL_ROOT_SELECTOR)
    if (root === null) return false
    const rect = root.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  const close = (): void => {
    // Handing the column back is the shell's job; clearing the selection makes
    // it stop rendering (and highlighting) this panel.
    if (context.layout !== undefined) context.layout.selectPanel(null)
  }

  context.effect(() => {
    // Escape is the keyboard affordance the SSH panel offers too.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && isVisible()) close()
    }
    // A press on a session/workspace row means "show me that conversation".
    // The shell clears its own selection, but it does not know about a panel
    // that is showing without being selected (see the SSH case below).
    const onDocumentClick = (event: MouseEvent): void => {
      if (!isShellActive()) return
      const target = event.target as HTMLElement | null
      if (target === null) return
      if (target.closest(SIDEBAR_ROW_SELECTOR) === null) return
      // Our own row is handled by the toggle below; closing here as well would
      // make one press do two things.
      if (isOurRowPress(target)) return
      close()
    }
    // A sibling panel announcing itself takes the column. SSH does this without
    // touching the shell's selection, so the shell would otherwise keep our row
    // highlighted over SSH's UI — the "two panels stacked" symptom. Clear the
    // selection so the highlight and the visible panel agree again.
    const onSiblingActivate = (event: Event): void => {
      if (!isShellActive()) return
      const detail = (event as CustomEvent).detail
      if (detail === SIBLING_ACTIVATION.ssh || detail === SIBLING_ACTIVATION.taskboard) close()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('click', onDocumentClick, true)
    document.addEventListener(ACTIVATE_EVENT, onSiblingActivate)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('click', onDocumentClick, true)
      document.removeEventListener(ACTIVATE_EVENT, onSiblingActivate)
    }
  }, 'dsh-database-manager: centre-column arbitration')

  // The sidebar row press. A repeat press closes; the first press opens (the
  // shell selects us itself once the event reaches its own handler).
  context.effect(() => {
    const onRowPress = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (target === null || !isOurRowPress(target)) return

      if (isVisible()) {
        // Already showing: this press means "back". Stop propagation so the
        // shell's own selectPanel(id) does not immediately re-open what we just
        // closed; capture phase runs before the shell's handler, so this works.
        event.preventDefault()
        event.stopPropagation()
        close()
        return
      }

      // Opening. SSH hides us with `display:none` while it is active, and it
      // only yields for the literal `taskboard` detail (its mount core has that
      // pairing hard-coded), so ask it to step aside before the shell selects
      // us — otherwise the shell would render a panel that stays invisible.
      if (document.documentElement.hasAttribute(SIBLING_HTML_ATTRIBUTES.ssh)) {
        document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: SIBLING_ACTIVATION.taskboard }))
      }
      // A press when the shell already has us selected but SSH is covering us:
      // the event is allowed through, and the shell's selectPanel(id) is a
      // no-op, so re-assert the selection explicitly for that case.
      if (!isShellActive() && context.layout !== undefined) context.layout.selectPanel(PANEL_ID)
    }
    document.addEventListener('click', onRowPress, true)
    return () => document.removeEventListener('click', onRowPress, true)
  }, 'dsh-database-manager: entry toggle')

  // ---- panel -------------------------------------------------------------
  context.effect(() => {
    try {
      return container.inject('main', () =>
        container.register(
          { name: 'main', key: PANEL_ID },
          () => React.createElement(PanelHost, { controller, api, localeListeners, onClose: close }),
        ),
      )
    } catch (failure) {
      console.warn('[dsh-database-manager] panel mount failed:', failure)
      return () => {}
    }
  }, 'dsh-database-manager: panel')
}

/** Whether a click's target belongs to this plugin's sidebar row. */
function isOurRowPress(target: HTMLElement): boolean {
  // The shell renders its own <button class="…panelRow"> and our glyph inside
  // it. The click target is that button (or a child of it), so membership is
  // decided by looking DOWN for our glyph — `closest()`, which walks ancestors,
  // cannot see it.
  if (target.querySelector?.(ENTRY_GLYPH_SELECTOR) != null) return true
  // A click landing exactly on the glyph itself is also ours.
  return target.matches?.(ENTRY_GLYPH_SELECTOR) === true
}

/**
 * Read a label from the active dictionary, falling back to Chinese copy.
 * @param ctx - the client context.
 * @param key - dictionary key.
 * @param fallback - copy used when the dictionary is not registered yet.
 */
function labelOf(ctx: { locale: { bind(ns: string): (key: string) => string } }, key: string, fallback: string): string {
  try {
    return ctx.locale.bind(NS)(key) || fallback
  } catch {
    return fallback
  }
}

/**
 * Insert one stylesheet into the document head and return its remover.
 *
 * `data-plugin-css` is the harness convention (see ui-layout): it makes the tag
 * identifiable for HMR and for a duplicate-mount guard, and it keeps the tag
 * from being mistaken for shell chrome.
 */
function installStyles(css: string, pluginId: string): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(pluginId)}]`)
  if (existing !== null) return () => { /* already installed by an earlier mount */ }
  const tag = document.createElement('style')
  tag.dataset['plugin'] = pluginId
  tag.dataset['pluginCss'] = pluginId
  tag.textContent = css
  document.head.appendChild(tag)
  return () => { tag.remove() }
}

/**
 * The panel host component: it keeps the locale tick local so only this
 * subtree re-renders on a language switch, and it forwards the close action the
 * panel's own back controls use.
 */
function PanelHost(props: {
  controller: PanelController
  api: DbApi
  localeListeners: Set<() => void>
  onClose(): void
}): React.ReactElement {
  const { controller, api, localeListeners, onClose } = props
  const [localeTick, setLocaleTick] = React.useState(0)

  React.useEffect(() => {
    const listener = (): void => setLocaleTick(value => value + 1)
    localeListeners.add(listener)
    return () => { localeListeners.delete(listener) }
  }, [localeListeners])

  return React.createElement(DatabasePanel, { controller, api, localeTick, onClose })
}

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { DatabasePanelProps } from './DatabasePanel.ts'
export type { SourceListViewProps } from './SourceListView.ts'
export type { SqlDatabaseViewProps } from './SqlDatabaseView.ts'
export type { RedisDatabaseViewProps } from './RedisDatabaseView.ts'
export type { PanelSnapshot, PanelScreen } from './controller.ts'
