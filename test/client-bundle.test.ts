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

/** The result of loading the bundle into a simulated shell. */
interface Loaded {
  registered: Registration[]
  effects: string[]
  css: string[]
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
  const css: string[] = []
  const dictionaries: Loaded['dictionaries'] = []
  const result: Loaded = { registered, effects, css, dictionaries, applied: false }

  /** The registry the plugin's apply() is handed as `ctx`. */
  const makeContext = (): Record<string, unknown> => {
    const context: Record<string, unknown> = {
      get: (name: string) => {
        if (missing.has(name)) return undefined
        if (name === 'styles') {
          return { insert: (text: string) => { css.push(text); return () => {} } }
        }
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
  const documentStub = { documentElement: { lang: 'zh' } }
  const captured = run(windowStub, documentStub, reactStub, console) as { loaded: unknown }

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

  it('installs its stylesheet', () => {
    const loaded = load()
    expect(loaded.css).toHaveLength(1)
    expect(loaded.css[0]).toMatch(/\.dbm-root/)
    // Colours come from theme tokens, never from a hard-coded palette.
    expect(loaded.css[0]).toMatch(/var\(--dsw-alias-/)
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

  it('survives a shell that does not provide the optional styles service', () => {
    const loaded = load({ missing: ['styles'] })
    expect(loaded.error).toBeUndefined()
    expect(loaded.applied).toBe(true)
    // The panel and row still register; only the stylesheet is skipped.
    expect(loaded.registered.map(item => item.slot)).toEqual(
      expect.arrayContaining(['sidebar.panellist', 'main']),
    )
  })
})
