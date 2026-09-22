/**
 * Agent tool outputs must satisfy the schema the tool itself declares.
 *
 * The host validates every tool's return value against its declared output
 * schema, and `additionalProperties: false` makes an undeclared key a hard
 * failure: the whole call dies with INVALID_TOOL_OUTPUT before the model sees
 * any of it. `db_list` shipped broken exactly that way — it returned
 * `summarize()` verbatim, while the schema declared only part of
 * `DataSourceSummary`, so every call failed on `tls` / `hasPassword` /
 * `createdAt` / `updatedAt` and the agent never received the source list.
 *
 * These tests run the real projections against the real validator
 * (`valueSchemaSpecToJsonSchema` + `validateJsonSchemaValue` from
 * `@deepseek-ai/dsh-tools`), so a field added to `DataSourceSummary` or to a
 * driver's `ColumnInfo` cannot silently break a tool again. They assert on the
 * raw `execute()` return value, which is what the host validates — not on the
 * rendered text, which is not.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterAll, beforeAll } from 'vitest'
import { validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools'

interface CapturedTool {
  name: string
  /**
   * Already converted by `defineTool` (`valueSchemaSpecToJsonSchema`) before the
   * registration is handed to the host — so this is a plain JSON Schema, which
   * is exactly what the host validates the return value against.
   */
  output: { schema: JsonSchemaNode }
  execute(args: unknown): Promise<unknown>
}

interface Mount {
  tools: CapturedTool[]
  dispose(): void
}

/** Mount the built host half into a fake cordis context that records the tools. */
async function mountTools(storeFile: string): Promise<Mount> {
  // The store path is derived from DSH_HOME when the plugin reads it, so the
  // environment has to point at the scratch directory first.
  process.env['DSH_HOME'] = join(storeFile, '..')

  const tools: CapturedTool[] = []
  const disposers: Array<() => void> = []
  const makeContext = (): Record<string, unknown> => ({
    get: (name: string) => (name === 'tools'
      ? {
          register: (definition: unknown) => { tools.push(definition as CapturedTool); return () => {} },
          guard: () => () => {},
        }
      : undefined),
    on: () => () => {},
    effect: (effect: () => unknown) => {
      const disposer = effect()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
      return () => {}
    },
    inject: (_names: string[], callback: (ctx: unknown) => void) => { callback(makeContext()) },
    webServer: { register: () => () => {} },
    tools: {
      register: (definition: unknown) => { tools.push(definition as CapturedTool); return () => {} },
      guard: () => () => {},
    },
    systemPrompt: { section: () => () => {} },
  })

  const module = (await import('../lib/index.js')) as { apply(ctx: unknown, config?: unknown): void }
  module.apply(makeContext(), { announceToAgent: true, enabled: true })

  return { tools, dispose: () => { for (const disposer of disposers.splice(0)) disposer() } }
}

/** Assert one tool's real output satisfies its own declared schema. */
function expectValidOutput(tool: CapturedTool, value: unknown): void {
  expect(validateJsonSchemaValue(tool.output.schema, value)).toEqual([])
}

describe('agent tool output schemas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbm-tool-schema-'))
  const storeFile = join(dir, 'dsh-database.json')
  const sqliteFile = join(dir, 'probe.db')
  let mount: Mount
  let tools: Map<string, CapturedTool>

  beforeAll(async () => {
    // Sources chosen to exercise every optional summary field: a TLS flag, a
    // stored password, a connect timeout, tags, a readonly flag and a file
    // path. The first is the one whose extra keys broke `db_list`.
    const sources = [
      {
        id: 'redis-2', kind: 'redis', name: '内网redis', group: '05', tags: ['B', 'C', 'D'],
        description: '', host: '192.168.0.5', port: 6379, db: 0, tls: false,
        password: 'sekret', readonly: false, createdAt: 1789524099775, updatedAt: 1789528068127,
      },
      {
        id: 'docker-mysql', kind: 'mysql', name: 'docker-mysql', group: '本机', tags: [],
        description: '', host: '127.0.0.1', port: 3306, user: 'root', tls: false,
        password: 'pw', connectTimeoutMs: 5000, readonly: true,
        createdAt: 1789605400724, updatedAt: 1789605400724,
      },
      {
        id: 'local-sqlite', kind: 'sqlite', name: 'test1', group: 'test', tags: ['T', 'S'],
        description: '', file: sqliteFile, readonly: false,
        createdAt: 1789566697023, updatedAt: 1789566718671,
      },
    ]
    writeFileSync(storeFile, JSON.stringify({ version: 1, sources }), 'utf8')

    // A real SQLite database holding exactly the features that used to leak
    // past the schema: a composite primary key and a generated column.
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(sqliteFile)
    db.exec(`CREATE TABLE probe (
      a INTEGER NOT NULL,
      b TEXT NOT NULL,
      total INTEGER GENERATED ALWAYS AS (a * 2) VIRTUAL,
      PRIMARY KEY (a, b)
    )`)
    db.exec('CREATE INDEX probe_b ON probe (b)')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    db.close()

    mount = await mountTools(storeFile)
    tools = new Map(mount.tools.map(tool => [tool.name, tool]))
  })

  afterAll(() => {
    mount?.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('registers the four tools', () => {
    expect([...tools.keys()].sort()).toEqual(['db_exec', 'db_list', 'db_query', 'db_schema'])
  })

  it('db_list output satisfies its schema, including the fields that broke it', async () => {
    const out = (await tools.get('db_list')!.execute({})) as { sources: Array<Record<string, unknown>> }
    expect(out.sources).toHaveLength(3)
    expectValidOutput(tools.get('db_list')!, out)

    // Present and correct, rather than rejected as undeclared.
    expect(out.sources[0]!['tls']).toBe(false)
    expect(out.sources[0]!['hasPassword']).toBe(true)
    expect(out.sources[0]!['createdAt']).toBe(1789524099775)
    expect(out.sources[1]!['readonly']).toBe(true)

    // And the schema still rejects the keys it does not declare, so the
    // projection has to keep dropping them.
    expect(out.sources[1]).not.toHaveProperty('connectTimeoutMs')
    expect(out.sources[0]).not.toHaveProperty('password')
  })

  it('db_list narrows the list with a query term', async () => {
    const list = tools.get('db_list')!
    const all = (await list.execute({})) as { sources: unknown[] }
    const filtered = (await list.execute({ query: 'mysql' })) as { sources: Array<{ id: string }> }
    expect(all.sources.length).toBeGreaterThan(filtered.sources.length)
    expect(filtered.sources.map(source => source.id)).toEqual(['docker-mysql'])
    expectValidOutput(list, filtered)
  })

  it('db_schema carries the column and index fields its schema declares', async () => {
    const schemaTool = tools.get('db_schema')!
    const out = (await schemaTool.execute({ source: 'local-sqlite', schema: 'main', table: 'probe' })) as {
      columns: Array<Record<string, unknown>>
      indexes: Array<Record<string, unknown>>
    }
    expectValidOutput(schemaTool, out)

    const a = out.columns.find(column => column['name'] === 'a')!
    expect(a['primaryKeyPosition']).toBe(1)
    expect(out.columns.some(column => column['generated'] === true)).toBe(true)
    expect(out.indexes.some(index => index['name'] === 'probe_b')).toBe(true)
  })

  it('db_query and db_exec satisfy their schemas on a real read and write', async () => {
    const query = tools.get('db_query')!
    const exec = tools.get('db_exec')!

    const written = await exec.execute({ source: 'local-sqlite', sql: 'INSERT INTO t (v) VALUES (?)', params: ['x'] })
    expectValidOutput(exec, written)

    const read = await query.execute({ source: 'local-sqlite', sql: 'SELECT id, v FROM t' })
    expectValidOutput(query, read)
    const shaped = read as { rows: unknown[][]; rowCount: number }
    expect(shaped.rowCount).toBe(shaped.rows.length)
  })
})
