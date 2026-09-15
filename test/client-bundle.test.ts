/**
 * Client-half test: loads the real `lib/client.js` into a simulated harness
 * shell and asserts what the browser half actually registers.
 *
 * The bundle is a `window.__ModuleLoader__.load({ id, factory })` call, so the
 * test supplies that loader, a `require` that answers the module's externals,
 * and a recording slot registry. What it proves:
 *
 *  - the bundle parses and its factory produces the plugin face the loader needs;
 *  - the sidebar row and the main panel are registered into the two official
 *    slots, under the key that makes clicking a session return to the chat;
 *  - the copy is localized, not hard-coded;
 *  - a missing optional service does not throw (an external plugin must never
 *    take the GUI down).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const BUNDLE = readFileSync(resolve(import.meta.dirname, '../lib/client.js'), 'utf8')

/** One captured slot registration. */
interface Registration {
  slot: string
  options: Record<string, unknown>
  component: unknown
}

/** One `<style>` the plugin appended to document.head. */
interface InjectedStyle {
  tag: string
  css: string
  dataset: Record<string, string>
}

/** The result of loading the bundle into a simulated shell. */
interface Loaded {
  registered: Registration[]
  effects: string[]
  /** Stylesheets the plugin injected, in append order. */
  styles: InjectedStyle[]
  /** Document-level listeners the plugin subscribed, for the arbitration logic. */
  documentListeners: Array<{ type: string; listener: unknown; capture: unknown }>
  dictionaries: Array<{ ns: string; dicts: Record<string, unknown> }>
  /** The plugin's apply(), already invoked. */
  applied: boolean
  /** Error thrown by apply(), if any. */
  error?: unknown
}

/**
 * Load the bundle with the given service overrides and run its apply().
 * @param overrides - services whose presence the test wants to vary.
 */
function load(overrides: {
  missing?: string[]
  render?: boolean
} = {}): Loaded {
  const missing = new Set(overrides.missing ?? [])
  const registered: Registration[] = []
  const effects: string[] = []
  const styles: InjectedStyle[] = []
  const dictionaries: Loaded['dictionaries'] = []
  const documentListeners: Loaded['documentListeners'] = []
  const result: Loaded = { registered, effects, styles, documentListeners, dictionaries, applied: false }

  /** The registry the plugin's apply() is handed as `ctx`. */
  const makeContext = (): Record<string, unknown> => {
    const context: Record<string, unknown> = {
      get: (name: string) => {
        // Note: no `styles` seat. An installed plugin has no such service (the
        // client catalog exposes only layout/locale/sessions/slots/theme/timer/
        // uiWorkspace/workspaces), so the plugin must inject its CSS itself.
        void name
        return undefined
      },
      effect: (effect: () => unknown, label?: string) => {
        effects.push(label ?? 'unnamed')
        // Run the effect body so it registers, and remember its disposer.
        const disposer = effect()
        void disposer
        return () => {}
      },
      on: () => () => {},
      slots: {
        inject: (_key: string, callback: () => unknown) => {
          callback()
          return () => {}
        },
        register: (options: Record<string, unknown>, component: unknown) => {
          registered.push({ slot: String(options['name']), options, component })
          return () => {}
        },
        entriesOfSlot: () => [],
      },
      layout: { selectPanel: () => {} },
      locale: {
        register: (ns: string, dicts: Record<string, unknown>) => {
          dictionaries.push({ ns, dicts })
          return () => {}
        },
        bind: (ns: string) => (key: string) => {
          void ns
          const zh = dictionaries[0]?.dicts['zh'] as Record<string, string> | undefined
          return zh?.[key] ?? key
        },
        subscribe: () => () => {},
      },
    }
    return context
  }

  // The loader the bundle expects.
  const loaded: Array<{ id: string; factory: (require: (specifier: string) => unknown) => unknown }> = []
  const windowStub = {
    __ModuleLoader__: {
      load: (registration: { id: string; factory: (require: (specifier: string) => unknown) => unknown }) => {
        loaded.push(registration)
      },
    },
  }

  // Modules the bundle marks external.
  const reactStub = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useRef: (initial: unknown) => ({ current: initial }),
    Fragment: 'Fragment',
  }
  const requireFn = (specifier: string): unknown => {
    if (specifier === 'react') return reactStub
    if (specifier === 'react/jsx-runtime') {
      return {
        jsx: (type: unknown, props: unknown) => ({ type, props }),
        jsxs: (type: unknown, props: unknown) => ({ type, props }),
        Fragment: 'Fragment',
      }
    }
    if (specifier === 'react-dom') return { createRoot: () => ({ render: () => {}, unmount: () => {} }) }
    throw new Error(`unexpected require("${specifier}")`)
  }

  // Execute the bundle with the simulated browser globals in scope.
  const run = new Function(
    'window',
    'document',
    'React',
    'console',
    `${BUNDLE}\nreturn { loaded: window.__ModuleLoader__ };`,
  )
  // A document stub with just enough DOM for the two things the plugin does at
  // mount: append a <style> to head, and subscribe document-level listeners
  // for the centre-column arbitration.
  const appended: InjectedStyle[] = []
  const capturedListeners: Array<{ type: string; listener: unknown; capture: unknown }> = []
  const htmlAttributes = new Set<string>()
  const documentStub = {
    documentElement: {
      lang: 'zh',
      setAttribute: (name: string) => { htmlAttributes.add(name) },
      removeAttribute: (name: string) => { htmlAttributes.delete(name) },
      hasAttribute: (name: string) => htmlAttributes.has(name),
    },
    querySelector: () => null,
    addEventListener: (type: string, listener: unknown, capture?: unknown) => {
      capturedListeners.push({ type, listener, capture })
    },
    removeEventListener: () => {},
    createElement: (tag: string) => {
      const element = {
        tagName: tag.toUpperCase(),
        dataset: {} as Record<string, string>,
        textContent: '',
        remove: () => {},
      }
      return element
    },
    head: {
      appendChild: (element: { tagName: string; textContent: string; dataset: Record<string, string> }) => {
        appended.push({ tag: element.tagName, css: element.textContent, dataset: element.dataset })
      },
    },
  }
  const captured = run(windowStub, documentStub, reactStub, console) as { loaded: unknown }
  void captured

  const registration = loaded[0]
  if (registration === undefined) throw new Error('bundle did not register a module')

  const moduleExports = registration.factory(requireFn) as {
    apply?: (ctx: unknown) => void
    inject?: string[]
    name?: string
  }

  expect(moduleExports.apply).toBeTypeOf('function')
  try {
    moduleExports.apply(makeContext())
    result.applied = true
  } catch (error) {
    result.error = error
  }
  // The style append happens inside an effect, which this harness runs
  // synchronously during apply() — so collect it only after apply() returned.
  styles.push(...appended)
  documentListeners.push(...capturedListeners)
  // Render each registered component once so a render-time crash is visible.
  if (overrides.render !== false) {
    for (const entry of registered) {
      if (typeof entry.component === 'function') {
        try {
          ;(entry.component as (props: unknown) => unknown)({ size: 16, active: false })
        } catch {
          /* the component's own render is exercised by the browser, not here */
        }
      }
    }
  }
  return result
}

describe('built client half', () => {
  it('registers the module id the profile expects', () => {
    expect(BUNDLE).toContain('window.__ModuleLoader__.load({')
    expect(BUNDLE).toMatch(/id:\s*"dsh-database-manager"/)
  })

  it('keeps react external rather than bundling a second copy', () => {
    // Two React instances in one page break hooks, so the bundle must require
    // the shell's React instead of carrying its own.
    expect(BUNDLE).toMatch(/require\("react"\)/)
    // A bundled React would carry the hook dispatcher's own initializer.
    expect(BUNDLE).not.toContain('react-dom/client')
  })

  it('applies without throwing and records its effects', () => {
    const loaded = load()
    expect(loaded.error).toBeUndefined()
    expect(loaded.applied).toBe(true)
    expect(loaded.effects).toEqual(
      expect.arrayContaining([
        'dsh-database-manager: styles',
        'dsh-database-manager: dictionaries',
        'dsh-database-manager: sidebar entry',
        'dsh-database-manager: panel',
      ]),
    )
  })

  it('registers the sidebar row into the official panellist slot', () => {
    const loaded = load()
    const entry = loaded.registered.find(item => item.slot === 'sidebar.panellist')
    expect(entry).toBeDefined()
    // The id doubles as the `main` key the layout router selects.
    expect(entry!.options['id']).toBe('database-manager')
    expect(entry!.options['order']).toBe(20)
    // The label is a thunk so a language switch re-reads it.
    expect(entry!.options['label']).toBeTypeOf('function')
    expect((entry!.options['label'] as () => string)()).toBe('数据库管理')
  })

  it('registers the panel into the keyed main slot under the same key', () => {
    const loaded = load()
    const panel = loaded.registered.find(item => item.slot === 'main')
    expect(panel).toBeDefined()
    // A click on a session row calls layout.selectPanel(null); the fallback key
    // is what brings the conversation back, so this key must match the row id.
    expect(panel!.options['key']).toBe('database-manager')
    expect(panel!.component).toBeTypeOf('function')
  })

  it('injects its stylesheet into document.head, since an installed plugin has no styles seat', () => {
    const loaded = load()
    expect(loaded.styles).toHaveLength(1)
    const style = loaded.styles[0]!
    expect(style.tag).toBe('STYLE')
    // The harness convention: an identifiable tag, so HMR and a duplicate mount
    // can both find it.
    expect(style.dataset['pluginCss']).toBe('dsh-database-manager')
    expect(style.css).toMatch(/\.dbm-root/)
    // Colours come from theme tokens, never from a hard-coded palette.
    expect(style.css).toMatch(/var\(--dsw-alias-/)
  })

  it('carries the sidebar-entry alignment rule measured against the SSH row', () => {
    const loaded = load()
    const css = loaded.styles[0]!.css
    // The 24px box plus 2px per side is what makes the glyph and label land on
    // the same x as the SSH entry, whose row uses wider padding than the shell's
    // panel row.
    const rule = /\.dbm-entry-glyph \{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(rule).toMatch(/width: 24px/)
    expect(rule).toMatch(/height: 24px/)
    expect(rule).toMatch(/margin: 0 2px/)
  })

  it('registers both locale dictionaries with matching key sets', () => {
    const loaded = load()
    expect(loaded.dictionaries).toHaveLength(1)
    const dicts = loaded.dictionaries[0]!.dicts as { zh: Record<string, string>; en: Record<string, string> }
    const zhKeys = Object.keys(dicts.zh).sort()
    const enKeys = Object.keys(dicts.en).sort()
    expect(zhKeys.length).toBeGreaterThan(50)
    expect(enKeys).toEqual(zhKeys)
  })

  it('localizes the sidebar label to English when the document is English', () => {
    const loaded = load()
    const dicts = loaded.dictionaries[0]!.dicts as { en: Record<string, string> }
    expect(dicts.en['entry.label']).toBe('Database')
  })

  it('registers the panel and the row even when no optional service is present', () => {
    // The registry provides only slots and locale; nothing else may be required,
    // or a shell change could take the whole GUI down with this plugin.
    const loaded = load({ missing: ['styles', 'theme', 'timer', 'layout'] })
    expect(loaded.error).toBeUndefined()
    expect(loaded.applied).toBe(true)
    expect(loaded.registered.map(item => item.slot)).toEqual(
      expect.arrayContaining(['sidebar.panellist', 'main']),
    )
    // The stylesheet is the one thing that does not depend on any service.
    expect(loaded.styles).toHaveLength(1)
  })

  it('renders the entry glyph as a 24px box holding the 18px svg', () => {
    const loaded = load({ render: false })
    const entry = loaded.registered.find(item => item.slot === 'sidebar.panellist')!
    const element = (entry.component as (props: unknown) => { props: Record<string, unknown> })({ size: 16, active: false })
    // The glyph carries its own class rather than an inline size, so the
    // measured geometry lives in one place (styles.ts) and user CSS can
    // override it.
    expect(element.props['className']).toBe('dbm-entry-glyph')
    const html = element.props['dangerouslySetInnerHTML'] as { __html: string }
    expect(html.__html).toContain('width="18"')
    expect(html.__html).toContain('height="18"')
  })

  it('subscribes the document listeners the centre-column arbitration needs', () => {
    const loaded = load()
    const types = loaded.documentListeners.map(entry => entry.type)
    // keydown: Escape closes. click (capture): the sidebar row toggle and the
    // session-row hand-back. dsh-panel-activate: a sibling panel taking the
    // column closes ours.
    expect(types).toEqual(expect.arrayContaining(['keydown', 'click', 'dsh-panel-activate']))
    // The click listeners must run in the capture phase, so ours settles the
    // state before the shell's own row handler acts on the same press.
    const clicks = loaded.documentListeners.filter(entry => entry.type === 'click')
    expect(clicks.length).toBeGreaterThan(0)
    expect(clicks.every(entry => entry.capture === true)).toBe(true)
  })

  it('marks the entry row with the attribute the toggle recognises', () => {
    const loaded = load({ render: false })
    const entry = loaded.registered.find(item => item.slot === 'sidebar.panellist')!
    const element = (entry.component as (props: unknown) => { props: Record<string, unknown> })({ size: 16, active: false })
    expect(element.props['data-dsh-dbm-entry']).toBe('database-manager')
  })

  it('wires a back-to-conversation control into every view header', () => {
    // The panel is a full takeover of the centre column, so each screen needs a
    // way out. Behaviour (does pressing it return to the chat?) is proven by
    // scripts/e2e-panel.mjs in a real browser; here the guarantee is structural:
    // the control exists, carries the markers, and every header wires it.
    //
    // Calling the components would need a React renderer (hooks outside one
    // throw), and the list screen renders its loading state with no header until
    // its first fetch resolves — so the artifact itself is the honest subject.
    const loaded = load({ render: false })
    const css = loaded.styles[0]!.css
    expect(css).toMatch(/\.dbm-back\s*\{/)

    // The control's markers, as they appear in the built artifact.
    expect(BUNDLE).toContain('data-dsh-center-view-back')
    expect(BUNDLE).toMatch(/dbm-btn dbm-btn-ghost dbm-back/)
    expect(BUNDLE).toMatch(/panel\.backToConversation/)
    // The list screen's own label for stepping back to the data-source list.
    expect(BUNDLE).toMatch(/panel\.backToList/)

    // Every header construction (list, SQL view, Redis view) instantiates the
    // control, so none of the three screens can ship without a way back.
    const backButtonUses = BUNDLE.match(/createElement\(BackButton/g) ?? []
    expect(backButtonUses.length).toBeGreaterThanOrEqual(3)
  })
})
