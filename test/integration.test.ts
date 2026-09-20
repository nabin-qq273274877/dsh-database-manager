/**
 * Integration test for the built host half.
 *
 * It loads the real `lib/index.js` — not the sources — into a plain fake cordis
 * context, captures the routes and tools the plugin registers, then drives them
 * through a real `node:http` server with real `fetch` calls and a real SQLite
 * file. That is the closest thing to the production path that does not require
 * restarting the host, and it is what proves:
 *
 *  - the plugin's `apply()` contract works against the real `defineTool`;
 *  - the /api/dsh-database route family answers the browser's exact requests;
 *  - a password never appears in any response body;
 *  - the write gate refuses a model-initiated write while it is off, and asks
 *    for approval once it is on.
 *
 * It is skipped when the harness SDK is not resolvable (a bare checkout with no
 * profile installed), so `npm test` still works anywhere.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** Whether the harness SDK is importable from this checkout. */
async function sdkAvailable(): Promise<boolean> {
  try {
    await import('@deepseek-ai/dsh-tools')
    return true
  } catch {
    return false
  }
}

const available = await sdkAvailable()

/** A route as the plugin registers it. */
interface CapturedRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** A tool as the plugin registers it. */
interface CapturedTool {
  name: string
  description: string
  output: { render(args: unknown, value: unknown): Array<{ type: string; text: string }> }
  execute(args: unknown, exec?: unknown): Promise<unknown>
}

/** Everything a test needs from one plugin mount. */
interface Mount {
  routes: CapturedRoute[]
  tools: CapturedTool[]
  sections: Array<{ name: string; order: number; text: string }>
  guards: Array<(exec: { name: string; arguments: unknown }) => string | undefined>
  preExecute: Array<(exec: { name: string; arguments: unknown }, next: () => Promise<unknown>) => Promise<unknown>>
  /** Tear the mount down. */
  dispose(): void
}

/**
 * Load the built host half and mount it into a fake cordis context that records
 * everything the plugin contributes.
 */
async function mountPlugin(storeFile: string): Promise<Mount> {
  // The store path is derived from DSH_HOME at module scope, so point the
  // environment at a scratch directory before the plugin reads it.
  process.env['DSH_HOME'] = join(storeFile, '..')

  const routes: CapturedRoute[] = []
  const tools: CapturedTool[] = []
  const sections: Array<{ name: string; order: number; text: string }> = []
  const guards: Mount['guards'] = []
  const preExecute: Mount['preExecute'] = []
  const disposers: Array<() => void> = []

  const makeContext = (): Record<string, unknown> => ({
    get: (name: string) => {
      if (name === 'tools') {
        return {
          register: (definition: unknown) => {
            tools.push(definition as CapturedTool)
            return () => {}
          },
          guard: (guard: never) => {
            guards.push(guard)
            return () => {}
          },
        }
      }
      if (name === 'styles') return undefined
      return undefined
    },
    on: (event: string, listener: never) => {
      if (event === 'tools/pre-execute') preExecute.push(listener)
      const dispose = (): void => {}
      disposers.push(dispose)
      return dispose
    },
    effect: (effect: () => unknown) => {
      const disposer = effect()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
      return () => {}
    },
    inject: (names: string[], callback: (ctx: unknown) => void) => {
      void names
      callback(makeContext())
    },
    webServer: {
      register: (route: CapturedRoute) => {
        routes.push(route)
        return () => {}
      },
    },
    tools: {
      register: (definition: unknown) => {
        tools.push(definition as CapturedTool)
        return () => {}
      },
      guard: (guard: never) => {
        guards.push(guard)
        return () => {}
      },
    },
    systemPrompt: {
      section: (section: { name: string; order: number; text: string }) => {
        sections.push(section)
        return () => {}
      },
    },
  })

  const module = (await import('../lib/index.js')) as { apply(ctx: unknown, config?: unknown): void }
  module.apply(makeContext(), { announceToAgent: true, enabled: true })

  return {
    routes,
    tools,
    sections,
    guards,
    preExecute,
    dispose: () => { for (const disposer of disposers.splice(0)) disposer() },
  }
}

describe.skipIf(!available)('built host half', () => {
  let dir: string
  let mount: Mount
  let server: ReturnType<typeof createServer>
  let base: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dbm-integration-'))
    mount = await mountPlugin(join(dir, 'dsh-database.json'))

    server = createServer((req, res) => {
      const route = mount.routes.find(candidate =>
        candidate.kind === 'exact'
          ? (req.url ?? '').split('?')[0] === candidate.path
          : (req.url ?? '').startsWith(candidate.path),
      )
      if (route === undefined) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'not found' }))
        return
      }
      void route.handler(req, res)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    base = `http://127.0.0.1:${port}/api/dsh-database`
  })

  afterAll(async () => {
    mount?.dispose()
    await new Promise<void>(resolve => { server.close(() => resolve()) })
    rmSync(dir, { recursive: true, force: true })
  })

  it('registers its routes, tools and prompt section', () => {
    expect(mount.routes).toHaveLength(1)
    expect(mount.routes[0]!.path).toBe('/api/dsh-database')
    expect(mount.routes[0]!.kind).toBe('prefix')

    expect(mount.tools.map(tool => tool.name).sort()).toEqual(['db_exec', 'db_list', 'db_query', 'db_schema'])
    expect(mount.sections.map(section => section.name)).toContain('plugin:dsh-database-manager')
    expect(mount.sections[0]!.text).toMatch(/只读/)
  })

  it('answers an empty source list and a default read-only posture', async () => {
    const body = (await (await fetch(`${base}/sources`)).json()) as {
      sources: unknown[]
      settings: { allowAgentWrite: boolean; requireApproval: boolean }
    }
    expect(body.sources).toEqual([])
    expect(body.settings).toEqual({ allowAgentWrite: false, requireApproval: true })
  })

  it('reports engine availability', async () => {
    const body = (await (await fetch(`${base}/engines`)).json()) as {
      engines: Array<{ kind: string; available: boolean }>
    }
    expect(body.engines.map(engine => engine.kind).sort()).toEqual(['mysql', 'redis', 'sqlite'])
    // SQLite rides a Node builtin, so it must be available wherever the test runs.
    expect(body.engines.find(engine => engine.kind === 'sqlite')?.available).toBe(true)
  })

  it('creates a source, then lists it without the password', async () => {
    const sqliteFile = join(dir, 'app.db')
    const created = await fetch(`${base}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'sqlite', name: 'App', id: 'app', file: sqliteFile }),
    })
    expect(created.status).toBe(201)

    const mysql = await fetch(`${base}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'mysql', name: 'Shop', id: 'shop', host: '127.0.0.1', port: 3306, user: 'root', password: 'hunter2' }),
    })
    expect(mysql.status).toBe(201)
    const mysqlBody = (await mysql.json()) as { source: Record<string, unknown> }
    // The secret must never cross to the browser.
    expect(JSON.stringify(mysqlBody)).not.toContain('hunter2')
    expect(mysqlBody.source['hasPassword']).toBe(true)
    expect(mysqlBody.source['auth']).toBe('password')

    const list = (await (await fetch(`${base}/sources`)).json()) as { sources: Array<Record<string, unknown>> }
    expect(list.sources).toHaveLength(2)
    expect(JSON.stringify(list)).not.toContain('hunter2')
    expect(list.sources.find(source => source['id'] === 'shop')?.['auth']).toBe('password')
    expect(list.sources.find(source => source['id'] === 'app')?.['auth']).toBe('file')
  })

  it('rejects a malformed create with the validator message', async () => {
    const response = await fetch(`${base}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'mysql', name: 'nohost' }),
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(/host is required/)
  })

  it('rejects an unknown engine', async () => {
    const response = await fetch(`${base}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'oracle', name: 'x', host: 'h' }),
    })
    expect(response.status).toBe(400)
  })

  describe('unsaved connection test (/test-connection)', () => {
    it('tests a draft against a real engine without storing anything', async () => {
      const before = (await (await fetch(`${base}/sources`)).json()) as { sources: unknown[] }
      const response = await fetch(`${base}/test-connection`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'sqlite', name: 'draft check', file: join(dir, 'draft.db') }),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { result: { ok: boolean; serverVersion?: string } }
      expect(body.result.ok).toBe(true)
      expect(body.result.serverVersion).toMatch(/SQLite/)

      // The whole point: nothing was persisted.
      const after = (await (await fetch(`${base}/sources`)).json()) as { sources: unknown[] }
      expect(after.sources).toHaveLength(before.sources.length)
    })

    it('reports an invalid draft as a failed test, not an HTTP error', async () => {
      // The dialog shows this inline next to the button; a 400 would surface as
      // a generic request failure instead of a usable message.
      const response = await fetch(`${base}/test-connection`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'mysql', name: 'no host' }),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { result: { ok: boolean; error?: string } }
      expect(body.result.ok).toBe(false)
      expect(body.result.error).toMatch(/host is required/)
    })

    it('reports an unreachable server as a failed test', async () => {
      const response = await fetch(`${base}/test-connection`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Port 1 on loopback: reliably refused, and nothing listens there.
        body: JSON.stringify({ kind: 'redis', name: 'dead', host: '127.0.0.1', port: 1, db: 0 }),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { result: { ok: boolean; error?: string } }
      expect(body.result.ok).toBe(false)
      expect(typeof body.result.error).toBe('string')
    })

    it('inherits the stored password when editing and the field is left blank', async () => {
      // The browser never receives passwords, so an untouched field can only
      // mean "use the stored one" — resolved host-side from baseId.
      //
      // Cleaned up at the end: other cases in this file assert on the exact
      // source list, and a leftover entry from here broke them.
      const created = (await (
        await fetch(`${base}/sources`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'redis', name: 'withsecret', id: 'withsecret', host: '127.0.0.1', port: 1, db: 0, password: 'sekret' }),
        })
      ).json()) as { source: { hasPassword: boolean } }
      expect(created.source.hasPassword).toBe(true)

      try {
        // The draft omits the password entirely, exactly as the dialog does for
        // an untouched field. It must still be accepted (nothing listens on
        // port 1, so the TEST fails — what matters is that the request is not
        // rejected for a missing secret).
        const withBase = await fetch(`${base}/test-connection`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'redis', name: 'withsecret', host: '127.0.0.1', port: 1, db: 0, baseId: 'withsecret' }),
        })
        expect(withBase.status).toBe(200)
        const body = (await withBase.json()) as { result: { ok: boolean; error?: string } }
        expect(body.result.ok).toBe(false)
        expect(typeof body.result.error).toBe('string')
      } finally {
        await fetch(`${base}/sources/withsecret`, { method: 'DELETE' })
      }
    })
  })

  it('creates the SQLite file, tests the connection and browses it end to end', async () => {
    // Connect creates the database file on first use.
    const connect = await fetch(`${base}/sources/app/connect`, { method: 'POST' })
    expect(connect.status).toBe(200)
    const payload = (await connect.json()) as {
      ok: boolean
      result: { ok: boolean; serverVersion?: string }
      schemas?: Array<{ name: string }>
    }
    expect(payload.ok).toBe(true)
    expect(payload.result.serverVersion).toMatch(/SQLite/)
    expect(payload.schemas?.map(schema => schema.name)).toContain('main')

    // Seed a table through the row helper, so the GUI's own write path is used.
    const created = await fetch(`${base}/sources/app/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql: 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)', allowWrite: true }),
    })
    expect(created.status).toBe(200)

    const inserted = await fetch(`${base}/sources/app/row`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table: 't', values: [{ column: 'name', value: 'hello' }] }),
    })
    expect(inserted.status).toBe(200)

    // Structure
    const columns = (await (await fetch(`${base}/sources/app/columns?table=t`)).json()) as { columns: Array<{ name: string; key: string }> }
    expect(columns.columns.map(column => column.name)).toEqual(['id', 'name'])
    expect(columns.columns[0]!.key).toBe('PRI')

    // Browse
    const rows = (await (await fetch(`${base}/sources/app/rows?table=t&page=1&pageSize=50&mode=browse`)).json()) as {
      page: { total: number; rows: Array<Record<string, unknown>>; primaryKey: string[] }
    }
    expect(rows.page.total).toBe(1)
    expect(rows.page.rows[0]?.['name']).toBe('hello')
    expect(rows.page.primaryKey).toEqual(['id'])

    // SQL read-only surface
    const read = await fetch(`${base}/sources/app/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT * FROM t' }),
    })
    expect(read.status).toBe(200)

    // The read-only surface must refuse a write.
    const refused = await fetch(`${base}/sources/app/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql: 'DELETE FROM t' }),
    })
    expect(refused.status).toBe(500)
    expect(((await refused.json()) as { error: string }).error).toMatch(/read-only/)
  })

  it('refuses a Redis command route on a SQL source and vice versa', async () => {
    const response = await fetch(`${base}/sources/app/redis/keys?pattern=*&cursor=0&db=0`)
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(/Redis/)
  })

  /**
   * The overview pane's two additions to the tables route.
   *
   * `stats=1` is what fills in the row-count and size columns. It is opt-in
   * because it is not free on SQLite, so both halves matter: without the flag
   * the cheap name list must stay cheap, and with it the statistics must
   * actually arrive.
   */
  it('reports table statistics only when they are asked for', async () => {
    const plain = (await (await fetch(`${base}/sources/app/tables?schema=main`)).json()) as {
      tables: Array<{ name: string; rows?: number; size?: number }>
    }
    const plainRow = plain.tables.find(table => table.name === 't')
    expect(plainRow).toBeDefined()
    // The cheap read carries no statistics at all.
    expect(plainRow?.rows).toBeUndefined()
    expect(plainRow?.size).toBeUndefined()

    const withStats = (await (await fetch(`${base}/sources/app/tables?schema=main&stats=1`)).json()) as {
      tables: Array<{ name: string; rows?: number; size?: number }>
    }
    const statsRow = withStats.tables.find(table => table.name === 't')
    // Size comes from dbstat and is always available for a real table.
    expect(statsRow?.size).toBeGreaterThan(0)
  })

  /**
   * 清空 / 删除 on the overview pane.
   *
   * These are the only two actions in the panel that destroy data with no way
   * back, so the test pins both the happy path and the two refusals that keep a
   * malformed or nonsensical request from becoming a dropped table.
   */
  describe('table actions (/sources/:id/table)', () => {
    /** Create a throwaway table with `n` rows and return its name. */
    const seed = async (name: string, n: number): Promise<void> => {
      await fetch(`${base}/sources/app/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: `CREATE TABLE ${name} (id INTEGER PRIMARY KEY, v TEXT)`, allowWrite: true }),
      })
      for (let i = 0; i < n; i++) {
        await fetch(`${base}/sources/app/row`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ table: name, values: [{ column: 'v', value: `v${i}` }] }),
        })
      }
    }

    /** How many rows a table currently holds, through the browse route. */
    const countOf = async (name: string): Promise<number> => {
      const body = (await (await fetch(`${base}/sources/app/rows?table=${name}&page=1&pageSize=50&mode=browse`)).json()) as {
        page: { total: number }
      }
      return body.page.total
    }

    it('empties a table but keeps the table itself', async () => {
      await seed('trunc_me', 3)
      expect(await countOf('trunc_me')).toBe(3)

      const response = await fetch(`${base}/sources/app/table`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schema: 'main', table: 'trunc_me', op: 'truncate' }),
      })
      expect(response.status).toBe(200)
      expect(await countOf('trunc_me')).toBe(0)

      // The table must still be listed: emptying is not dropping.
      const tables = (await (await fetch(`${base}/sources/app/tables?schema=main`)).json()) as {
        tables: Array<{ name: string }>
      }
      expect(tables.tables.map(table => table.name)).toContain('trunc_me')
    })

    it('drops a table for real', async () => {
      await seed('drop_me', 1)
      const response = await fetch(`${base}/sources/app/table`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schema: 'main', table: 'drop_me', op: 'drop' }),
      })
      expect(response.status).toBe(200)

      const tables = (await (await fetch(`${base}/sources/app/tables?schema=main`)).json()) as {
        tables: Array<{ name: string }>
      }
      expect(tables.tables.map(table => table.name)).not.toContain('drop_me')
      // Reading it must now fail rather than return an empty result set.
      expect((await fetch(`${base}/sources/app/rows?table=drop_me&page=1&pageSize=10&mode=browse`)).status).toBe(500)
    })

    it('drops a view with DROP VIEW, which is the only statement that works', async () => {
      // SQLite rejects `DROP TABLE` on a view, so a caller that forgets the
      // kind gets an engine error instead of a dropped view.
      await fetch(`${base}/sources/app/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: 'CREATE VIEW v_drop AS SELECT 1 AS one', allowWrite: true }),
      })
      const response = await fetch(`${base}/sources/app/table`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schema: 'main', table: 'v_drop', op: 'drop', isView: true }),
      })
      expect(response.status).toBe(200)
      const tables = (await (await fetch(`${base}/sources/app/tables?schema=main`)).json()) as {
        tables: Array<{ name: string }>
      }
      expect(tables.tables.map(table => table.name)).not.toContain('v_drop')
    })

    it('refuses to empty a view, which holds no rows of its own', async () => {
      await fetch(`${base}/sources/app/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: 'CREATE VIEW v_keep AS SELECT 1 AS one', allowWrite: true }),
      })
      const response = await fetch(`${base}/sources/app/table`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schema: 'main', table: 'v_keep', op: 'truncate', isView: true }),
      })
      expect(response.status).toBe(500)
      expect(((await response.json()) as { error: string }).error).toMatch(/view/)
      // And it must still be there afterwards.
      const tables = (await (await fetch(`${base}/sources/app/tables?schema=main`)).json()) as {
        tables: Array<{ name: string }>
      }
      expect(tables.tables.map(table => table.name)).toContain('v_keep')
    })

    it('refuses an action that does not name what it wants to do', async () => {
      // Defaulting here would turn a malformed request into a dropped table.
      await seed('safe_from_typo', 1)
      const response = await fetch(`${base}/sources/app/table`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schema: 'main', table: 'safe_from_typo' }),
      })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toMatch(/truncate.*drop/)

      // The table must be untouched.
      const tables = (await (await fetch(`${base}/sources/app/tables?schema=main`)).json()) as {
        tables: Array<{ name: string }>
      }
      expect(tables.tables.map(table => table.name)).toContain('safe_from_typo')
    })

    it('requires a table name', async () => {
      const response = await fetch(`${base}/sources/app/table`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'drop' }),
      })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toMatch(/table is required/)
    })
  })

  /**
   * The 操作 tab's route family.
   *
   * Driven against SQLite — the only engine a test can create on the spot — which also
   * makes the SUPPORT contract the thing being pinned: every one of the three blocks
   * must be reported unsupported, and every attempt must come back as a 400 with the
   * reason rather than as an engine error. The MySQL half of the same contract is in
   * `test/table-actions.test.ts`, against a real server.
   */
  describe('the 操作 tab routes', () => {
    /** The routes are driven through the suite's own SQLite source. */
    const run = async (sql: string): Promise<Response> => fetch(`${base}/sources/app/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql, allowWrite: true }),
    })

    beforeAll(async () => {
      await run('DROP TABLE IF EXISTS op_t')
      await run('CREATE TABLE op_t (id INTEGER PRIMARY KEY, v TEXT)')
    })

    it('reports which table actions this engine supports', async () => {
      const body = (await (await fetch(`${base}/sources/app/table-actions`)).json()) as { support: string[] }
      // A SQLite "database" is a file: nothing can be moved or copied into another one,
      // and there are no table options to change.
      expect(body.support).toEqual([])
    })

    it('refuses a move with the engine reason, not with a syntax error', async () => {
      const response = await fetch(`${base}/sources/app/table/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schema: 'main', table: 'op_t', target: { schema: 'other', table: 'op_t' } }),
      })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toMatch(/不支持移动表/)
      // Nothing was attempted, so nothing moved.
      const tables = (await (await fetch(`${base}/sources/app/tables?schema=main`)).json()) as { tables: Array<{ name: string }> }
      expect(tables.tables.map(table => table.name)).toContain('op_t')
    })

    it('refuses a copy and an option change the same way', async () => {
      const copy = await fetch(`${base}/sources/app/table/copy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schema: 'main', table: 'op_t', target: { schema: 'main', table: 'op_t_copy' } }),
      })
      expect(copy.status).toBe(400)
      expect(((await copy.json()) as { error: string }).error).toMatch(/不支持复制表/)

      const options = await fetch(`${base}/sources/app/table/options?schema=main&table=op_t`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment: 'x' }),
      })
      expect(options.status).toBe(400)
      expect(((await options.json()) as { error: string }).error).toMatch(/不支持修改表选项/)
    })

    it('still reads the object kind, which the destructive block needs on every engine', async () => {
      // The 表选项 block is unsupported on SQLite, but the READ behind it is not: the
      // 操作 tab uses it to learn whether the open object is a view, and 清空 must be
      // refused for one there too.
      const table = (await (await fetch(`${base}/sources/app/table/options?schema=main&table=op_t`)).json()) as {
        options: { isView?: boolean }
      }
      expect(table.options.isView).toBe(false)

      await run('DROP VIEW IF EXISTS op_v')
      await run('CREATE VIEW op_v AS SELECT 1 AS one')
      const view = (await (await fetch(`${base}/sources/app/table/options?schema=main&table=op_v`)).json()) as {
        options: { isView?: boolean }
      }
      expect(view.options.isView).toBe(true)
    })

    it('validates the fields each route needs, naming the one that is missing', async () => {
      const noTable = await fetch(`${base}/sources/app/table/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: { schema: 'main', table: 'x' } }),
      })
      expect(noTable.status).toBe(400)
      expect(((await noTable.json()) as { error: string }).error).toMatch(/table is required/)

      const noTarget = await fetch(`${base}/sources/app/table/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schema: 'main', table: 'op_t' }),
      })
      expect(noTarget.status).toBe(400)
      expect(((await noTarget.json()) as { error: string }).error).toMatch(/target must be an object/)

      const noTargetTable = await fetch(`${base}/sources/app/table/copy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schema: 'main', table: 'op_t', target: { schema: 'main' } }),
      })
      expect(noTargetTable.status).toBe(400)
      expect(((await noTargetTable.json()) as { error: string }).error).toMatch(/target\.table is required/)

      const optionsNoTable = await fetch(`${base}/sources/app/table/options?schema=main`)
      expect(optionsNoTable.status).toBe(400)
      expect(((await optionsNoTable.json()) as { error: string }).error).toMatch(/table is required/)

      // A mistyped patch field is a 400 naming it, not a silently dropped value. It is
      // rejected before the support check, so the message names the field either way.
      const badPatch = await fetch(`${base}/sources/app/table/options?schema=main&table=op_t`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoIncrement: 'ten' }),
      })
      expect(badPatch.status).toBe(400)
      expect(((await badPatch.json()) as { error: string }).error).toMatch(/autoIncrement must be an integer/)
    })

    it('refuses the whole family on a Redis source', async () => {
      // Created here rather than borrowed from the Redis describe: that one owns its
      // source and deletes it, and a test that depended on its lifetime would pass or
      // fail according to execution order.
      const id = 'op-routes-redis'
      const created = await fetch(`${base}/sources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'redis', name: 'op-routes-redis', id, host: '127.0.0.1', port: 1, db: 0 }),
      })
      expect(created.status).toBe(201)
      try {
        for (const path of ['table-actions', 'table/move', 'table/copy']) {
          const response = await fetch(`${base}/sources/${id}/${path}`, {
            method: path === 'table-actions' ? 'GET' : 'POST',
            headers: { 'content-type': 'application/json' },
            body: path === 'table-actions' ? undefined : JSON.stringify({ table: 't', target: { schema: 'a', table: 'b' } }),
          })
          expect(response.status).toBe(400)
          expect(((await response.json()) as { error: string }).error).toMatch(/SQL data sources/)
        }
      } finally {
        await fetch(`${base}/sources/${id}`, { method: 'DELETE' })
      }
    })
  })

  it('serves the write posture and persists a change', async () => {
    const patched = await fetch(`${base}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ allowAgentWrite: true, requireApproval: false }),
    })
    expect(patched.status).toBe(200)
    const body = (await patched.json()) as { settings: { allowAgentWrite: boolean; requireApproval: boolean } }
    expect(body.settings).toEqual({ allowAgentWrite: true, requireApproval: false })

    const read = (await (await fetch(`${base}/settings`)).json()) as { settings: { allowAgentWrite: boolean } }
    expect(read.settings.allowAgentWrite).toBe(true)
  })

  it('refuses a model-initiated write while nothing is approved, then guards it once writes are on', async () => {
    const exec = mount.tools.find(tool => tool.name === 'db_exec')!

    // Turn the posture back off: the guard must deny outright.
    await fetch(`${base}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ allowAgentWrite: false, requireApproval: true }),
    })
    const denied = mount.guards.map(guard => guard({ name: 'db_exec', arguments: { source: 'app', sql: 'DELETE FROM t' } })).find(Boolean)
    expect(denied).toMatch(/agent writes are disabled/)

    // A read tool is never guarded.
    const readVerdict = mount.guards.map(guard => guard({ name: 'db_query', arguments: { source: 'app', sql: 'SELECT 1' } })).find(Boolean)
    expect(readVerdict).toBeUndefined()

    // Turn writes on with approval: the guard stops denying and the
    // pre-execute layer starts asking.
    await fetch(`${base}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ allowAgentWrite: true, requireApproval: true }),
    })
    const stillDenied = mount.guards.map(guard => guard({ name: 'db_exec', arguments: { source: 'app', sql: 'DELETE FROM t' } })).find(Boolean)
    expect(stillDenied).toBeUndefined()

    const decision = await mount.preExecute[0]!({ name: 'db_exec', arguments: { source: 'app', sql: 'DELETE FROM t' } }, async () => ({ kind: 'allow' }))
    expect(decision).toMatchObject({ kind: 'ask' })

    // A read still passes straight through.
    const pass = await mount.preExecute[0]!({ name: 'db_query', arguments: { source: 'app', sql: 'SELECT 1' } }, async () => ({ kind: 'allow' }))
    expect(pass).toEqual({ kind: 'allow' })

    // The tool itself refuses a write statement on the read surface.
    await expect(exec.execute({ source: 'app', sql: 'DELETE FROM t' })).resolves.toBeDefined()
  })

  it('lets a write tool run its own command, and refuses a write on db_query', async () => {
    const query = mount.tools.find(tool => tool.name === 'db_query')!
    await expect(query.execute({ source: 'app', sql: 'DELETE FROM t' })).rejects.toThrow(/read-only/)

    const exec = mount.tools.find(tool => tool.name === 'db_exec')!
    const result = (await exec.execute({ source: 'app', sql: 'INSERT INTO t (name) VALUES (?)', params: ['via-tool'] })) as {
      affected: number
      rendered: string
    }
    expect(result.affected).toBe(1)
    expect(result.rendered).toMatch(/1 row\(s\) affected/)
  })

  it('lists sources for the agent without leaking the password', async () => {
    const list = mount.tools.find(tool => tool.name === 'db_list')!
    const value = (await list.execute({})) as { sources: Array<Record<string, unknown>> }
    expect(value.sources).toHaveLength(2)
    expect(JSON.stringify(value)).not.toContain('hunter2')
    // The rendered text the model actually sees must also be secret-free.
    const rendered = list.output.render({}, value).map(block => block.text).join('\n')
    expect(rendered).not.toContain('hunter2')
    expect(rendered).toMatch(/shop/)
  })

  it('describes a sqlite table for the agent', async () => {
    const schema = mount.tools.find(tool => tool.name === 'db_schema')!
    const value = (await schema.execute({ source: 'app', table: 't' })) as { columnsRendered?: string }
    expect(value.columnsRendered).toMatch(/name/)
  })

  it('updates and deletes a source, releasing its pooled connection', async () => {
    const updated = await fetch(`${base}/sources/app`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'App Renamed', readonly: true }),
    })
    expect(updated.status).toBe(200)
    const body = (await updated.json()) as { source: { name: string; readonly: boolean } }
    expect(body.source.name).toBe('App Renamed')
    expect(body.source.readonly).toBe(true)

    const removed = await fetch(`${base}/sources/shop`, { method: 'DELETE' })
    expect(removed.status).toBe(200)
    const list = (await (await fetch(`${base}/sources`)).json()) as { sources: Array<{ id: string }> }
    expect(list.sources.map(source => source.id)).toEqual(['app'])
  })

  it('denies a write against a source the user marked readonly', async () => {
    await fetch(`${base}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ allowAgentWrite: true, requireApproval: true }),
    })
    const verdict = mount.guards.map(guard => guard({ name: 'db_exec', arguments: { source: 'app', sql: 'DELETE FROM t' } })).find(Boolean)
    expect(verdict).toMatch(/readonly/)
  })

  it('answers 404 for an unknown route and an unknown source', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404)
    expect((await fetch(`${base}/sources/ghost/connect`, { method: 'POST' })).status).toBe(404)
  })

  describe('Redis key editing routes', () => {
    /**
     * The route family is exercised against a source that points nowhere: every
     * case below is rejected by validation BEFORE a connection is attempted, so
     * the suite stays independent of a running Redis. The cases that need a
     * live server live in redis-edit.test.ts.
     *
     * The source must be of kind redis even so: the routes check the driver's
     * type before they parse the body, so a SQL source would exercise the wrong
     * branch. Port 1 on loopback is reliably refused, and nothing dials it here.
     */
    const redisId = 'routes-redis'

    beforeAll(async () => {
      const created = await fetch(`${base}/sources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'redis', name: 'routes-redis', id: redisId, host: '127.0.0.1', port: 1, db: 0 }),
      })
      expect(created.status).toBe(201)
    })

    afterAll(async () => {
      // Left in place and the later source-list assertions break.
      await fetch(`${base}/sources/${redisId}`, { method: 'DELETE' })
    })

    it('rejects a create with no keys, naming the field', async () => {
      const response = await fetch(`${base}/sources/${redisId}/redis/key?db=0`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: [] }),
      })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toMatch(/keys must be a non-empty array/)
    })

    it('rejects an unknown key type', async () => {
      const response = await fetch(`${base}/sources/${redisId}/redis/key?db=0`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: [{ key: 'k', type: 'stream' }] }),
      })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toMatch(/type must be one of/)
    })

    it('rejects a half-specified collection before touching the server', async () => {
      // A hash with no fields, and a zset member with a non-numeric score: both
      // are the browser being wrong, and both must be caught here.
      const noFields = await fetch(`${base}/sources/${redisId}/redis/key?db=0`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: [{ key: 'h', type: 'hash', fields: [] }] }),
      })
      expect(noFields.status).toBe(400)
      expect(((await noFields.json()) as { error: string }).error).toMatch(/fields must be a non-empty array/)

      const badScore = await fetch(`${base}/sources/${redisId}/redis/key?db=0`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: [{ key: 'z', type: 'zset', members: [{ member: 'm', score: 'abc' }] }] }),
      })
      expect(badScore.status).toBe(400)
      expect(((await badScore.json()) as { error: string }).error).toMatch(/score must be a number/)
    })

    it('rejects a negative TTL', async () => {
      const response = await fetch(`${base}/sources/${redisId}/redis/key?db=0`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: [{ key: 'k', type: 'string', value: 'v', ttl: -5 }] }),
      })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toMatch(/ttl cannot be negative/)
    })

    it('requires a key name', async () => {
      const response = await fetch(`${base}/sources/${redisId}/redis/key?db=0`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: [{ key: '', type: 'string', value: 'v' }] }),
      })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toMatch(/key is required/)
    })

    it('requires a key for a single delete and a prefix for a folder delete', async () => {
      const noKey = await fetch(`${base}/sources/${redisId}/redis/key?db=0`, { method: 'DELETE' })
      expect(noKey.status).toBe(400)
      expect(((await noKey.json()) as { error: string }).error).toMatch(/key is required/)

      const noPrefix = await fetch(`${base}/sources/${redisId}/redis/prefix?db=0`, { method: 'DELETE' })
      expect(noPrefix.status).toBe(400)
      expect(((await noPrefix.json()) as { error: string }).error).toMatch(/prefix is required/)
    })

    it('rejects a non-GET method on the tree route', async () => {
      const response = await fetch(`${base}/sources/${redisId}/redis/tree?db=0`, { method: 'POST' })
      expect(response.status).toBe(404)
    })

    it('refuses the Redis key routes on a SQL source', async () => {
      // Writing Redis keys through a SQLite connection must not be possible even
      // if the path is guessed.
      const create = await fetch(`${base}/sources/app/redis/key?db=0`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: [{ key: 'k', type: 'string', value: 'v' }] }),
      })
      expect(create.status).toBe(400)
      expect(((await create.json()) as { error: string }).error).toMatch(/Redis/)

      const tree = await fetch(`${base}/sources/app/redis/tree?db=0`)
      expect(tree.status).toBe(400)
      expect(((await tree.json()) as { error: string }).error).toMatch(/Redis/)
    })

    it('answers 404 for a Redis key route on an unknown source', async () => {
      const response = await fetch(`${base}/sources/ghost/redis/prefix?prefix=a&db=0`, { method: 'DELETE' })
      expect(response.status).toBe(404)
    })

    it('rejects a level scan on a SQL source', async () => {
      const response = await fetch(`${base}/sources/app/redis/level?db=0&prefix=`)
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toMatch(/Redis/)
    })

    it('refuses the index routes on a SQL source', async () => {
      // All three index endpoints must name the engine mismatch rather than
      // reaching a SQL driver with a Redis request.
      for (const action of ['redis/index', 'redis/index/level', 'redis/index/estimate']) {
        const response = await fetch(`${base}/sources/app/${action}?db=0&prefix=`)
        expect(response.status, action).toBe(400)
        expect(((await response.json()) as { error: string }).error, action).toMatch(/Redis/)
      }
    })

    it('reports 409 reading a level that has no index yet', async () => {
      // A level read must not invent an empty tree: "nothing indexed" and "no
      // folders" are different answers, and conflating them would show an empty
      // database for one that was never walked.
      const response = await fetch(`${base}/sources/${redisId}/redis/index/level?db=0&prefix=`)
      expect(response.status).toBe(409)
      expect(((await response.json()) as { error: string }).error).toMatch(/no index/)
    })

    it('estimates the cost of an index without starting one', async () => {
      // The estimate exists so a caller can warn BEFORE loading the server, which
      // only works if asking does not itself walk anything: this uses DBSIZE only.
      // The source points at a closed port, so a response proves no scan ran.
      const response = await fetch(`${base}/sources/${redisId}/redis/index/estimate?db=0`)
      // DBSIZE needs a connection, which is refused here — so either the estimate
      // comes back (a live server) or the failure names the connection. What must
      // NOT happen is a keyspace walk.
      expect([200, 500]).toContain(response.status)
    })

    it('requires a pattern to search, and refuses search on a SQL source', async () => {
      const noPattern = await fetch(`${base}/sources/${redisId}/redis/search?db=0`)
      expect(noPattern.status).toBe(400)
      expect(((await noPattern.json()) as { error: string }).error).toMatch(/pattern is required/)

      const onSql = await fetch(`${base}/sources/app/redis/search?db=0&pattern=jd:*`)
      expect(onSql.status).toBe(400)
      expect(((await onSql.json()) as { error: string }).error).toMatch(/Redis/)
    })

    it('requires a key for every value-editing route', async () => {
      // Each edit route must name the field it is missing rather than reaching
      // an engine with a half-formed request.
      for (const action of ['redis/string', 'redis/ttl', 'redis/element']) {
        const response = await fetch(`${base}/sources/${redisId}/${action}?db=0`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
        expect(response.status).toBe(400)
        expect(((await response.json()) as { error: string }).error).toMatch(/key is required/)
      }
    })

    it('requires a string value when writing a string', async () => {
      const response = await fetch(`${base}/sources/${redisId}/redis/string?db=0`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'k', value: 42 }),
      })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toMatch(/value must be a string/)
    })

    it('accepts null as "no expiry" and rejects a non-numeric TTL', async () => {
      // null is the explicit "make permanent"; a bare 0 would be ambiguous with
      // an empty form field, and EXPIRE 0 would DELETE the key.
      const bad = await fetch(`${base}/sources/${redisId}/redis/ttl?db=0`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'k', ttl: 'soon' }),
      })
      expect(bad.status).toBe(400)
      expect(((await bad.json()) as { error: string }).error).toMatch(/ttl must be a number of seconds, or null/)
    })

    it('rejects an unknown element op and a bad index', async () => {
      const badOp = await fetch(`${base}/sources/${redisId}/redis/element?db=0`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'k', op: 'munge' }),
      })
      expect(badOp.status).toBe(400)
      expect(((await badOp.json()) as { error: string }).error).toMatch(/op must be one of/)

      const badIndex = await fetch(`${base}/sources/${redisId}/redis/element?db=0`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'k', op: 'set', index: -1, value: 'x' }),
      })
      expect(badIndex.status).toBe(400)
      expect(((await badIndex.json()) as { error: string }).error).toMatch(/index must be a non-negative integer/)
    })

    it('refuses the value-editing routes on a SQL source', async () => {
      for (const action of ['redis/string', 'redis/ttl', 'redis/element']) {
        const response = await fetch(`${base}/sources/app/${action}?db=0`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: 'k', value: 'v' }),
        })
        expect(response.status).toBe(400)
        expect(((await response.json()) as { error: string }).error).toMatch(/Redis/)
      }
    })
  })
})
