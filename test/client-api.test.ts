/**
 * Client API layer tests, against a stubbed `fetch`.
 *
 * The bug this file exists for: `setSettings` wrapped `send()` — which already
 * parses the response — in a second `readJson()`. Calling `.json()` on a plain
 * object threw, and the error surfaced as "HTTP undefined: invalid JSON
 * response" for a request the server had answered with 200. The message pointed
 * at the host; the fault was a double parse in the client.
 *
 * `api.ts` imports nothing but `protocol.ts`, so it runs in plain Node with a
 * fake `fetch` — no DOM and no React needed. That makes it cheap to assert the
 * real request each method sends AND the way each reply is unwrapped, which is
 * where this class of mistake lives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DbApi, DbApiError } from '../src/client/api.ts'

/** One recorded call to fetch. */
interface Call {
  url: string
  method: string
  body: unknown
}

let calls: Call[] = []

/**
 * Install a fake fetch that answers every request with the given JSON body.
 *
 * @param body - the parsed body to return.
 * @param init - status and headers overrides.
 */
function stubFetch(body: unknown, init: { status?: number; contentType?: string } = {}): void {
  const status = init.status ?? 200
  const contentType = init.contentType ?? 'application/json; charset=utf-8'
  globalThis.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
    calls.push({
      url: String(input),
      method: options?.method ?? 'GET',
      body: options?.body === undefined ? undefined : JSON.parse(String(options.body)),
    })
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return new Response(text, { status, headers: { 'content-type': contentType } })
  }) as typeof fetch
}

beforeEach(() => { calls = [] })
afterEach(() => { vi.restoreAllMocks() })

describe('DbApi.setSettings', () => {
  it('unwraps the settings object from a successful PATCH', async () => {
    // The exact shape the route returns.
    stubFetch({ settings: { allowAgentWrite: true, requireApproval: false } })

    const result = await new DbApi().setSettings({ allowAgentWrite: true })

    expect(result).toEqual({ allowAgentWrite: true, requireApproval: false })
    // And it must have PATCHed the settings route with just the patch.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      body: { allowAgentWrite: true },
    })
    expect(calls[0]!.url).toContain('/api/dsh-database/settings')
  })

  it('does not wrap the reply in a second parse', async () => {
    // The regression: a double parse threw on a plain object and reported
    // "HTTP undefined". Any rejection here means the reply is being parsed
    // twice, whatever the message says.
    stubFetch({ settings: { allowAgentWrite: false, requireApproval: true } })
    await expect(new DbApi().setSettings({ requireApproval: true })).resolves.toBeDefined()
  })

  it('surfaces the server message when the PATCH is rejected', async () => {
    stubFetch({ error: 'settings file is read-only' }, { status: 500 })
    await expect(new DbApi().setSettings({ allowAgentWrite: true })).rejects.toThrow('settings file is read-only')
  })
})

describe('DbApi read paths', () => {
  it('lists sources and the posture together', async () => {
    stubFetch({ sources: [], settings: { allowAgentWrite: false, requireApproval: true } })
    const payload = await new DbApi().listSources()
    expect(payload.settings).toEqual({ allowAgentWrite: false, requireApproval: true })
    expect(calls[0]!.url).toContain('/api/dsh-database/sources')
  })

  it('unwraps the engines array', async () => {
    stubFetch({ engines: [{ kind: 'redis', available: true }] })
    expect(await new DbApi().engines()).toEqual([{ kind: 'redis', available: true }])
  })
})

describe('DbApi redis calls', () => {
  it('sends a search pattern to the db-scoped search route', async () => {
    stubFetch({ page: { keys: [], truncated: false, scanned: 0, dbSize: 0 } })

    const page = await new DbApi().redisSearch('src', { db: 3, pattern: 'jd:*' })

    expect(page).toEqual({ keys: [], truncated: false, scanned: 0, dbSize: 0 })
    const call = calls[0]!
    expect(call.url).toContain('/sources/src/redis/search')
    // The pattern and the db must both reach the server: a search run against
    // the wrong database returns the wrong keys, which is worse than an error.
    expect(call.url).toContain('db=3')
    expect(call.url).toContain('pattern=jd')
  })

  it('unwraps a level page', async () => {
    stubFetch({ page: { folders: [], keys: [], truncated: false, keysAtLevel: 0, dbSize: 0, countsApproximate: false } })
    const page = await new DbApi().redisLevel('src', { db: 0, prefix: 'a:b', withTypes: true })
    expect(page.keysAtLevel).toBe(0)
    expect(calls[0]!.url).toContain('withTypes=1')
  })

  it('unwraps a mutation result', async () => {
    stubFetch({ result: { affected: 1, ttl: -1, removed: false } })
    const result = await new DbApi().redisSetTtl('src', { key: 'k', ttl: null, db: 0 })
    expect(result).toEqual({ affected: 1, ttl: -1, removed: false })
    // `null` must be sent explicitly: it is what distinguishes "make permanent"
    // from an omitted field.
    expect(calls[0]!.body).toEqual({ key: 'k', ttl: null })
  })
})

describe('readJson guards', () => {
  it('reports a non-Response as an internal error, not as a status code', async () => {
    // A non-JSON body must name the status it actually got, so the distinction
    // between "the server sent garbage" and "we parsed the wrong thing" stays
    // visible in the message.
    stubFetch('<html>gateway error</html>', { status: 502, contentType: 'text/html' })
    await expect(new DbApi().listSources()).rejects.toThrow(/HTTP 502/)
    await expect(new DbApi().listSources()).rejects.toBeInstanceOf(DbApiError)
  })
})
