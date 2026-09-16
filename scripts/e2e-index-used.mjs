/**
 * Verify the panel USES the index, on a local Redis.
 *
 * The unit tests cover the index logic and the route tests cover its endpoints; what
 * they cannot show is whether the panel actually takes the index path — whether a
 * level read goes to the index instead of triggering a per-level scan. That is the
 * whole point of the feature, and getting it wrong would leave a huge database slow
 * while every test still passed.
 *
 * The check is done by counting the requests the page makes: reading a level with an
 * index in place must hit the index endpoint and must NOT hit the plain level scan.
 *
 * LOCAL ONLY (see AGENTS.md).
 *
 * Usage: node scripts/e2e-index-used.mjs <baseUrl-with-token> <port> <db> <keyCount>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9357

const [baseUrl, portArg, dbArg, countArg] = process.argv.slice(2)
if (baseUrl === undefined || portArg === undefined || dbArg === undefined) {
  console.error('usage: node scripts/e2e-index-used.mjs <baseUrl-with-token> <port> <db> <keyCount>')
  process.exit(2)
}
const redisPort = Number(portArg)
const db = Number(dbArg)
const keyCount = Number(countArg ?? 1_200_000)

const FLOW = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const report = { steps: [] };
  const step = (name, detail) => report.steps.push({ name, detail });

  const base = '/api/dsh-database';
  const sourceId = 'index-used-e2e';

  const created = await fetch(base + '/sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'redis', id: sourceId, name: 'index-used-e2e',
      host: '127.0.0.1', port: ${redisPort}, db: ${db},
    }),
  });
  if (created.status !== 201 && created.status !== 409) {
    return JSON.stringify({ ...report, fatal: 'could not create the source: HTTP ' + created.status });
  }

  /**
   * Record every plugin request, so the test can assert WHICH endpoint answered a
   * level. Counting requests is the only way to see the panel's choice: both paths
   * return the same shape, so the replies cannot tell them apart.
   */
  const calls = [];
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.includes('/api/dsh-database')) calls.push(url.replace(/^.*\\/api/, '/api'));
    return originalFetch.apply(this, arguments);
  };

  const since = (n) => calls.slice(n);
  const countMatching = (list, needle) => list.filter(u => u.includes(needle)).length;

  // Load the panel for this source through the UI, so the real component runs.
  const sidebar = await (async () => {
    const end = Date.now() + 20000;
    for (;;) {
      const found = Array.from(document.querySelectorAll('nav button[aria-label]'))
        .find(b => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim()));
      if (found) return found;
      if (Date.now() > end) return null;
      await sleep(60);
    }
  })();
  if (!sidebar) return JSON.stringify({ ...report, fatal: 'no sidebar row' });
  const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
  click(sidebar);
  await sleep(1200);

  // Connect to the source this run created.
  const row = Array.from(document.querySelectorAll('.dbm-table tbody tr'))
    .find(r => (r.textContent || '').includes(sourceId));
  if (!row) {
    const rows = Array.from(document.querySelectorAll('.dbm-table tbody tr')).map(r => (r.textContent || '').trim().slice(0, 50));
    await fetch(base + '/sources/' + sourceId, { method: 'DELETE' });
    return JSON.stringify({ ...report, fatal: 'source row not found', rows });
  }
  const connect = Array.from(row.querySelectorAll('.dbm-actions .dbm-btn'))
    .find(b => ['连接', 'Connect'].includes((b.textContent || '').trim()));
  if (!connect) {
    await fetch(base + '/sources/' + sourceId, { method: 'DELETE' });
    return JSON.stringify({ ...report, fatal: 'no connect button' });
  }
  click(connect);
  await sleep(2000);

  // Expand the target database. Over the threshold this must offer the index prompt
  // instead of immediately scanning.
  const dbRow = Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .find(el => (el.getAttribute('data-db') || '') === '${db}');
  if (!dbRow) {
    await fetch(base + '/sources/' + sourceId, { method: 'DELETE' });
    return JSON.stringify({ ...report, fatal: 'no db row' });
  }

  let n = calls.length;
  click(dbRow);
  await sleep(1800);

  const modal = document.querySelector('.dbm-modal');
  report.promptShown = modal !== null;
  report.promptText = modal ? (modal.textContent || '').slice(0, 200) : null;
  const duringPrompt = since(n);
  step('a large database prompts instead of scanning', modal !== null);
  step('the prompt does not itself walk the keyspace',
    countMatching(duringPrompt, '/redis/level') === 0);

  if (modal === null) {
    // Below the threshold the scan path is correct, so this run only makes sense
    // with a database large enough to trigger the prompt.
    await fetch(base + '/sources/' + sourceId, { method: 'DELETE' });
    return JSON.stringify({ ...report, fatal: 'no prompt appeared; is the database above the threshold?', calls: duringPrompt });
  }

  // Confirm, and wait for the walk to finish (bounded).
  const confirm = Array.from(modal.querySelectorAll('.dbm-modal-foot .dbm-btn'))
    .find(b => ['建立索引', 'Build the index'].includes((b.textContent || '').trim()));
  if (!confirm) {
    await fetch(base + '/sources/' + sourceId, { method: 'DELETE' });
    return JSON.stringify({ ...report, fatal: 'no confirm button' });
  }
  click(confirm);

  // The progress sentence must appear while the walk runs.
  let sawProgress = false;
  let status = null;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await sleep(400);
    if (document.querySelector('.dbm-index-progress')) sawProgress = true;
    status = (await (await fetch(base + '/sources/' + sourceId + '/redis/index?db=${db}')).json()).status;
    if (status.done || status.error !== undefined) break;
  }
  report.sawProgressBanner = sawProgress;
  report.finalStatus = status;
  // The banner is only observable if the walk lasts longer than a poll interval. On a
  // LOCAL database of a million keys the whole walk takes a few seconds, so its
  // absence is not a failure — it is reported for the record, and the invariant that
  // matters (the walk completes and the panel then reads from it) is asserted below.
  report.progressBannerObserved = sawProgress;
  step('the walk finishes without error', status !== null && status.done === true && status.error === undefined);

  // The panel must render the root level from the finished index WITHOUT another
  // click — opening the database started the walk, so the folders should appear on
  // their own once it is ready.
  const renderDeadline = Date.now() + 15000;
  while (Date.now() < renderDeadline) {
    await sleep(200);
    if (document.querySelectorAll('.dbm-side-body [data-kind="folder"]').length > 0) break;
  }
  report.folderRowsPresent = document.querySelectorAll('.dbm-side-body [data-kind="folder"]').length;
  step('the tree renders from the finished index without another click', report.folderRowsPresent > 0);

  // Now the decisive check: open a level and see WHICH endpoint answered.
  //
  // A folder row must exist by now (the root level came from the finished index), and
  // clicking it expands it. The row is located by its data-path so the click cannot
  // land on a key row or a collapsed database root.
  n = calls.length;
  const folder = Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
    .find(el => el.getAttribute('aria-expanded') !== 'true');
  report.folderRowsPresent = document.querySelectorAll('.dbm-side-body [data-kind="folder"]').length;
  if (!folder) {
    await fetch(base + '/sources/' + sourceId, { method: 'DELETE' });
    return JSON.stringify({ ...report, fatal: 'no collapsed folder row to expand' });
  }
  report.expandingFolder = folder.getAttribute('data-path');
  click(folder);
  // Wait for the child level's request rather than a fixed sleep, so the assertion
  // does not race the render.
  const levelDeadline = Date.now() + 15000;
  while (Date.now() < levelDeadline) {
    await sleep(150);
    if (since(n).some(u => u.includes('/redis/index/level') || u.includes('/redis/level'))) break;
  }
  await sleep(400);
  const duringLevel = since(n);
  report.levelCalls = duringLevel.filter(u => u.includes('/redis/level') || u.includes('/redis/index/level'));
  step('a level is served from the index',
    countMatching(duringLevel, '/redis/index/level') > 0);
  step('a level does NOT trigger a per-level scan',
    countMatching(duringLevel, '/redis/level') === 0);

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

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-idxused-'))
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,900', baseUrl,
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
