/**
 * Time the tree's real interaction on a large database, in a real browser.
 *
 * The whole point of the level-by-level design is that opening a folder in a
 * production-sized database is fast and complete. This measures that end to end
 * — click to first painted row — rather than trusting a server-side benchmark,
 * because the browser's own work (JSON parse, render) is part of the cost.
 *
 * Usage: node scripts/bench-tree-e2e.mjs <baseUrl-with-token> <sourceId> <db>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9338

const [baseUrl, sourceId, dbArg] = process.argv.slice(2)
if (baseUrl === undefined || sourceId === undefined || dbArg === undefined) {
  console.error('usage: node scripts/bench-tree-e2e.mjs <baseUrl-with-token> <sourceId> <db>')
  process.exit(2)
}
const db = Number(dbArg)

const FLOW = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byText = (sel, text) =>
    Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
  const byIncludes = (sel, text) =>
    Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
  const waitFor = async (fn, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(50);
    }
  };
  const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
  const byPath = (kind, path) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="' + kind + '"]'))
    .find((el) => (el.getAttribute(kind === 'folder' ? 'data-path' : 'data-key') || '') === path) || null;
  const rowCount = () => document.querySelectorAll('.dbm-side-body [data-kind]').length;

  const report = { steps: [] };
  const step = (name, detail) => report.steps.push({ name, detail });

  const sidebar = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())),
    20000,
  );
  if (!sidebar) return JSON.stringify({ ...report, fatal: 'no sidebar row' });
  click(sidebar);
  await waitFor(() => document.querySelector('.dbm-root'), 10000);

  const cell = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(sourceId)}), 10000)
    || await waitFor(() => document.querySelector('.dbm-table tbody tr'), 5000);
  const dataRow = cell ? cell.closest('tr') : null;
  const connect = dataRow ? (byText('.dbm-actions .dbm-btn', '连接') || byText('.dbm-actions .dbm-btn', 'Connect')) : null;
  if (!connect) return JSON.stringify({ ...report, fatal: 'no connect button' });
  click(connect);

  // Opening the database root of a large database. The panel expands the
  // SOURCE's configured database on connect, which may be a different one, so
  // the target is collapsed first if some other db is the open one — otherwise
  // the folder query below would measure the wrong database.
  const dbRow = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === ${JSON.stringify(`db${db}`)}), 20000);
  if (!dbRow) return JSON.stringify({ ...report, fatal: 'no db root' });

  // Close whatever the panel opened by default, so the measurement below is of
  // this database alone and its folders are the only ones on screen.
  for (const other of Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))) {
    if (other !== dbRow && other.getAttribute('aria-expanded') === 'true') click(other);
  }
  await sleep(200);

  let t0 = performance.now();
  if (dbRow.getAttribute('aria-expanded') !== 'true') click(dbRow);
  const firstFolder = await waitFor(() => document.querySelector('.dbm-side-body [data-kind="folder"]'), 60000);
  const rootMs = Math.round(performance.now() - t0);
  step('open db root', { ms: rootMs, rows: rowCount() });
  if (!firstFolder) return JSON.stringify({ ...report, fatal: 'root level never painted', tree: rowCount() });

  // Every top-level folder, with its displayed key count.
  report.rootFolders = Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]')).map((el) => ({
    path: el.getAttribute('data-path'),
    shown: ((el.querySelector('.dbm-tree-meta') || {}).textContent || '').trim(),
  }));

  // Opening the largest folder: the case that used to hang.
  const biggest = document.querySelector('.dbm-side-body [data-kind="folder"]');
  if (biggest) {
    const path = biggest.getAttribute('data-path');
    t0 = performance.now();
    click(biggest);
    await waitFor(() => {
      const el = byPath('folder', path);
      return el && el.getAttribute('aria-expanded') === 'true' ? el : null;
    }, 60000);
    // Its children must actually be on screen, not just "expanded".
    await waitFor(() => (byPath('folder', path) ? document.querySelectorAll('.dbm-tree-depth-2').length > 0 : true), 60000);
    await sleep(300);
    step('open ' + path, { ms: Math.round(performance.now() - t0), rows: rowCount() });
  }

  // A flat folder holding more keys than the display cap.
  const flat = Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
    .find((el) => (el.getAttribute('data-path') || '').endsWith('item'));
  if (flat) {
    const path = flat.getAttribute('data-path');
    t0 = performance.now();
    click(flat);
    await waitFor(() => {
      const el = byPath('folder', path);
      return el && el.getAttribute('aria-expanded') === 'true' ? el : null;
    }, 120000);
    await sleep(500);
    step('open flat leaf folder', {
      ms: Math.round(performance.now() - t0),
      rows: rowCount(),
      keys: document.querySelectorAll('.dbm-side-body [data-kind="key"]').length,
      note: (byIncludes('.dbm-hint', '仅显示') || {}).textContent?.trim() ?? null,
    });
  }

  report.finalRows = rowCount();
  return JSON.stringify(report, null, 2);
})()`

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw))
      const settle = this.pending.get(msg.id)
      if (settle !== undefined) {
        this.pending.delete(msg.id)
        settle(msg)
      }
    })
  }
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const reply = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (reply.result?.exceptionDetails !== undefined) {
      throw new Error(`page exception: ${reply.result.exceptionDetails.exception?.description ?? ''}`)
    }
    return reply.result?.result?.value
  }
  close() { this.ws.close() }
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const r = await fetch(url)
      if (r.ok) return await r.json()
    } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error(`timed out: ${url}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-bench-tree-'))
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
    if (Date.now() > boot) throw new Error('the app never booted')
    await new Promise((r) => setTimeout(r, 1000))
  }

  const parsed = JSON.parse(await cdp.evaluate(FLOW))
  console.log(JSON.stringify(parsed, null, 2))
  if (parsed.fatal !== undefined) failed = true
} catch (error) {
  console.error('BENCH ERROR:', error instanceof Error ? error.message : String(error))
  failed = true
} finally {
  cdp?.close()
  edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
}

process.exit(failed ? 1 : 0)
