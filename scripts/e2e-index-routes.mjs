/**
 * End-to-end check of the keyspace index over HTTP, against a LOCAL Redis.
 *
 * This exercises the real route surface — estimate, start, poll, read a level — and
 * then verifies the indexed tree against the database it was built from. The point
 * is to catch integration mistakes the unit tests cannot see: a route that is
 * registered but unreachable, a level that comes back in the wrong shape, or an
 * index that reports "done" while still missing folders.
 *
 * LOCAL ONLY. A walk of a big database is CPU-heavy on the server (see AGENTS.md);
 * this seeds and walks a small local database on purpose.
 *
 * Usage: node scripts/e2e-index-routes.mjs <baseUrl-with-token> <port> <db>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9356

const [baseUrl, portArg, dbArg] = process.argv.slice(2)
if (baseUrl === undefined || portArg === undefined || dbArg === undefined) {
  console.error('usage: node scripts/e2e-index-routes.mjs <baseUrl-with-token> <port> <db>')
  process.exit(2)
}
const redisPort = Number(portArg)
const db = Number(dbArg)

/**
 * The walk is driven through the PANEL's own endpoints, not by importing the host
 * half: the routes are the contract, and importing internals would test a different
 * thing than the browser actually uses.
 *
 * The page itself is only used to obtain an authenticated origin; the fetches below
 * run in it so they carry the session cookie the token set up.
 */
const FLOW = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const report = { steps: [] };
  const step = (name, detail) => report.steps.push({ name, detail });

  const base = '/api/dsh-database';
  const sourceId = 'index-e2e';

  // A source pointing at the local Redis, created through the panel's own API so
  // the whole path (validation, storage, pool) is exercised.
  const created = await fetch(base + '/sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'redis', id: sourceId, name: 'index-e2e',
      host: '127.0.0.1', port: ${redisPort}, db: ${db},
    }),
  });
  if (created.status !== 201 && created.status !== 409) {
    return JSON.stringify({ ...report, fatal: 'could not create the source: HTTP ' + created.status + ' ' + (await created.text()).slice(0, 200) });
  }

  // 1. The estimate must come back WITHOUT walking anything (it uses DBSIZE).
  const estimateStarted = Date.now();
  const estimateRes = await fetch(base + '/sources/' + sourceId + '/redis/index/estimate?db=${db}');
  const estimateMs = Date.now() - estimateStarted;
  if (!estimateRes.ok) {
    return JSON.stringify({ ...report, fatal: 'estimate failed: HTTP ' + estimateRes.status + ' ' + (await estimateRes.text()).slice(0, 200) });
  }
  const estimate = (await estimateRes.json()).estimate;
  report.estimate = { ...estimate, ms: estimateMs };
  step('estimate returns a key count', estimate.keys > 0);
  step('estimate does not walk the keyspace (fast)', estimateMs < 1000);

  // 2. Starting the walk returns progress, and repeating it must not restart it.
  const startRes = await fetch(base + '/sources/' + sourceId + '/redis/index?db=${db}');
  if (!startRes.ok) {
    return JSON.stringify({ ...report, fatal: 'start failed: HTTP ' + startRes.status + ' ' + (await startRes.text()).slice(0, 200) });
  }
  const first = (await startRes.json()).status;
  report.firstStatus = first;
  step('start reports a database size to walk against', first.dbSize === estimate.keys);

  // 3. Poll until done, bounded so a hang fails rather than spins.
  let status = first;
  const deadline = Date.now() + 60000;
  const samples = [];
  while (!status.done && Date.now() < deadline) {
    await sleep(150);
    status = (await (await fetch(base + '/sources/' + sourceId + '/redis/index?db=${db}')).json()).status;
    samples.push({ visited: status.visited, folders: status.folders });
  }
  report.pollSamples = samples.length;
  report.finalStatus = status;
  step('the walk finishes', status.done === true);
  step('the walk visited every key', status.visited === status.dbSize);
  step('no error was recorded', status.error === undefined);

  // 4. Read the root level from the index and compare with the direct scan, which
  //    is the implementation already pinned by the other suites.
  const indexedRes = await fetch(base + '/sources/' + sourceId + '/redis/index/level?db=${db}&prefix=&withTypes=0');
  if (!indexedRes.ok) {
    return JSON.stringify({ ...report, fatal: 'index/level failed: HTTP ' + indexedRes.status + ' ' + (await indexedRes.text()).slice(0, 200) });
  }
  const indexed = (await indexedRes.json()).level;
  const scanned = (await (await fetch(base + '/sources/' + sourceId + '/redis/level?db=${db}&prefix=&withTypes=0')).json()).page;

  report.indexedRoot = { folders: indexed.folders, keys: indexed.keys.map(k => k.key), keysAtLevel: indexed.keysAtLevel };
  report.scannedRoot = { folders: scanned.folders, keys: scanned.keys.map(k => k.key), keysAtLevel: scanned.keysAtLevel };

  const norm = (list) => JSON.stringify(list.map(f => f.name + '=' + f.keys).sort());
  step('root folders match the direct scan', norm(indexed.folders) === norm(scanned.folders));
  step('root keys match the direct scan', JSON.stringify(indexed.keys.map(k => k.key).sort()) === JSON.stringify(scanned.keys.map(k => k.key).sort()));
  step('the finished index is not flagged as still building', indexed.partial === false);

  // 5. A nested level must work from the cache, with no further scanning.
  const nestedRes = await fetch(base + '/sources/' + sourceId + '/redis/index/level?db=${db}&prefix=jd:order&withTypes=0');
  const nested = (await nestedRes.json()).level;
  const nestedScan = (await (await fetch(base + '/sources/' + sourceId + '/redis/level?db=${db}&prefix=jd:order&withTypes=0')).json()).page;
  report.nested = { indexed: nested.keys.map(k => k.key).slice(0, 5), count: nested.keysAtLevel };
  step('a nested level matches the direct scan',
    JSON.stringify(nested.keys.map(k => k.key).sort()) === JSON.stringify(nestedScan.keys.map(k => k.key).sort()));

  // 6. The index caches: reading the same level twice must not re-walk.
  const before = (await (await fetch(base + '/sources/' + sourceId + '/redis/index?db=${db}')).json()).status;
  await fetch(base + '/sources/' + sourceId + '/redis/index/level?db=${db}&prefix=&withTypes=0');
  const after = (await (await fetch(base + '/sources/' + sourceId + '/redis/index?db=${db}')).json()).status;
  step('reading a level does not restart the walk',
    after.visited === before.visited && after.done === true);

  // 7. Invalidate drops it, so the next read says "not indexed" rather than serving
  //    a tree that may no longer be true.
  await fetch(base + '/sources/' + sourceId + '/redis/index?db=${db}', { method: 'DELETE' });
  const afterDelete = await fetch(base + '/sources/' + sourceId + '/redis/index/level?db=${db}&prefix=');
  report.afterInvalidate = afterDelete.status;
  step('an invalidated index reports as not built', afterDelete.status === 409);

  // Clean up the source this run created.
  await fetch(base + '/sources/' + sourceId, { method: 'DELETE' });
  return JSON.stringify(report, null, 2);
})()`

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.nextId = 1; this.pending = new Map()
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)); const s = this.pending.get(msg.id)
      if (s !== undefined) { this.pending.delete(msg.id); s(msg) }
    })
  }
  ready() { return new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej) }) }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })) })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails !== undefined) throw new Error(r.result.exceptionDetails.exception?.description ?? '')
    return r.result?.result?.value
  }
  close() { this.ws.close() }
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try { const r = await fetch(url); if (r.ok) return await r.json() } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error(`timed out: ${url}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-index-'))
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1280,800', baseUrl,
], { stdio: 'ignore' })

let cdp
let failed = false
try {
  await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`, 30000)
  let target
  const deadline = Date.now() + 30000
  for (;;) {
    const list = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`, 10000)
    target = list.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string')
    if (target !== undefined) break
    if (Date.now() > deadline) throw new Error('no page target')
    await new Promise((r) => setTimeout(r, 300))
  }
  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.ready()
  await cdp.send('Runtime.enable')
  const boot = Date.now() + 90000
  for (;;) {
    const ready = await cdp.evaluate(`!!document.querySelector('nav')`)
    if (ready === true) break
    if (Date.now() > boot) throw new Error('never booted')
    await new Promise((r) => setTimeout(r, 1000))
  }
  const parsed = JSON.parse(await cdp.evaluate(FLOW))
  console.log(JSON.stringify(parsed, null, 2))
  if (parsed.fatal !== undefined) failed = true
  if (Array.isArray(parsed.steps) && parsed.steps.some((s) => s.detail !== true)) failed = true
} catch (error) {
  console.error('E2E ERROR:', error instanceof Error ? error.message : String(error))
  failed = true
} finally {
  cdp?.close(); edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
}

process.exit(failed ? 1 : 0)
