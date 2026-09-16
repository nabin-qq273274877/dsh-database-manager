/**
 * End-to-end check of the tree's busy feedback on create and delete.
 *
 * The complaint this addresses was not "the refresh is slow" but "nothing tells
 * me a refresh is happening". So the assertion is on the INTERMEDIATE state: a
 * MutationObserver watches the tree across the whole write and records whether a
 * busy marker ever appeared — sampling from a polling loop would miss it, since
 * a local Redis round trip completes in milliseconds.
 *
 * It also confirms the feedback is not merely decorative: the stale rows must
 * come back non-busy, with the write's effect visible.
 *
 * Usage: node scripts/e2e-tree-loading.mjs <baseUrl-with-token> <sourceId> <db> <namespace>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9344

const [baseUrl, sourceId, dbArg, namespace] = process.argv.slice(2)
if (baseUrl === undefined || sourceId === undefined || dbArg === undefined || namespace === undefined) {
  console.error('usage: node scripts/e2e-tree-loading.mjs <baseUrl-with-token> <sourceId> <db> <namespace>')
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
    for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(50); }
  };
  const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
  const keyRow = (label) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="key"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === label) || null;
  const byPath = (kind, path) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="' + kind + '"]'))
    .find((el) => (el.getAttribute(kind === 'folder' ? 'data-path' : 'data-key') || '') === path) || null;

  const report = { steps: [] };
  const step = (name, detail) => report.steps.push({ name, detail });

  /**
   * Watch the tree for busy markers until the returned stop() is called.
   *
   * A MutationObserver is required rather than a poll: a local Redis answers in
   * a few milliseconds, so the busy state can begin and end between two samples
   * of a setInterval and be missed entirely. The observer runs on every DOM
   * change, so it records the state even when it lasts a single frame.
   */
  const watchBusy = () => {
    const seen = { staleRow: false, spinner: false, dbBusy: false, samples: 0 };
    const scan = () => {
      seen.samples++;
      if (document.querySelector('.dbm-side-body .dbm-tree-stale')) seen.staleRow = true;
      if (document.querySelector('.dbm-side-body .dbm-spinner')) seen.spinner = true;
      if (document.querySelector('.dbm-side-body [data-kind="db"][aria-busy="true"]')) seen.dbBusy = true;
    };
    const tree = document.querySelector('.dbm-side-body');
    const observer = new MutationObserver(scan);
    if (tree) observer.observe(tree, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-busy'] });
    // Also watch the refresh control, which is outside .dbm-side-body.
    const head = document.querySelector('.dbm-side-head');
    const headObserver = new MutationObserver(scan);
    if (head) headObserver.observe(head, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled', 'aria-busy'] });
    scan();
    return {
      seen,
      stop: () => { observer.disconnect(); headObserver.disconnect(); },
    };
  };

  const sidebar = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())), 20000);
  if (!sidebar) return JSON.stringify({ ...report, fatal: 'no sidebar row' });
  click(sidebar);
  await waitFor(() => document.querySelector('.dbm-root'), 10000);

  // Located by the source's own text. No fallback to the first row: that
  // silently connected to whichever source sorted first, so the run measured the
  // wrong server and reported the failure as something else entirely.
  const sourceRow = await waitFor(() => Array.from(document.querySelectorAll('.dbm-table tbody tr'))
    .find((row) => (row.textContent || '').includes(${JSON.stringify(sourceId)})) ?? null, 20000);
  if (!sourceRow) {
    return JSON.stringify({
      ...report,
      fatal: 'data source row not found',
      wanted: ${JSON.stringify(sourceId)},
      rows: Array.from(document.querySelectorAll('.dbm-table tbody tr')).map((row) => (row.textContent || '').trim().slice(0, 60)),
    });
  }
  const connect = Array.from(sourceRow.querySelectorAll('.dbm-actions .dbm-btn'))
    .find((b) => ['连接', 'Connect'].includes((b.textContent || '').trim())) || null;
  if (!connect) return JSON.stringify({ ...report, fatal: 'no connect button' });
  click(connect);

  const targetDb = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === ${JSON.stringify(`db${db}`)}), 20000);
  if (!targetDb) return JSON.stringify({ ...report, fatal: 'no db root' });
  for (const other of Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))) {
    if (other !== targetDb && other.getAttribute('aria-expanded') === 'true') click(other);
  }
  await sleep(200);
  if (targetDb.getAttribute('aria-expanded') !== 'true') click(targetDb);

  // Open the namespace folder so its keys are on screen. The wait is on the
  // level having ARRIVED (its rows rendered), not on a specific key name: the
  // fixture holds one seeded key, and naming it here would make the test depend
  // on the seeding step rather than on the behaviour under test.
  const ns = ${JSON.stringify(namespace.replace(/:$/, ''))};
  const nsFolder = await waitFor(() => byPath('folder', ns), 20000);
  if (!nsFolder) return JSON.stringify({ ...report, fatal: 'namespace folder missing' });
  if (nsFolder.getAttribute('aria-expanded') !== 'true') click(nsFolder);
  const opened = await waitFor(() => {
    const folder = byPath('folder', ns);
    if (!folder || folder.getAttribute('aria-expanded') !== 'true') return null;
    // A rendered key row inside the folder means the level loaded.
    return document.querySelector('.dbm-side-body [data-kind="key"]') ? true : null;
  }, 15000);
  if (!opened) return JSON.stringify({ ...report, fatal: 'namespace level never loaded' });
  await sleep(400);

  // ---- create: the busy marker must appear while the tree reloads ----
  const createBtn = Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
    .filter((el) => (el.getAttribute('data-path') || '') === ns)
    .map((el) => Array.from(el.querySelectorAll('button')).find((b) => (b.getAttribute('title') || '').includes('新增键')))[0];
  if (!createBtn) return JSON.stringify({ ...report, fatal: 'no create control on the folder row' });
  click(createBtn);
  const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
  if (!modal) return JSON.stringify({ ...report, fatal: 'create dialog did not open' });
  const nameBox = modal.querySelector('textarea.dbm-textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(nameBox, 'loading-probe');
  nameBox.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(150);

  const createWatch = watchBusy();
  const submit = Array.from(document.querySelectorAll('.dbm-modal-foot .dbm-btn'))
    .find((b) => (b.textContent || '').trim() === '创建' || (b.textContent || '').trim() === 'Create');
  if (!submit) { createWatch.stop(); return JSON.stringify({ ...report, fatal: 'no create submit' }); }
  click(submit);
  // Wait for the new key to be on screen, so the whole write+refresh has run.
  const created = await waitFor(() => keyRow('loading-probe'), 20000);
  const createSeen = { ...createWatch.seen };
  createWatch.stop();
  step('create shows a busy marker', createSeen.staleRow || createSeen.spinner || createSeen.dbBusy);
  report.createSeen = createSeen;
  if (!created) return JSON.stringify({ ...report, fatal: 'created key never appeared' });
  step('created key visible after refresh', true);

  // The marker must clear once the refresh settles.
  await sleep(600);
  step('busy marker clears after the refresh', !document.querySelector('.dbm-side-body .dbm-tree-stale'));

  // ---- delete: same expectation ----
  const row = keyRow('loading-probe');
  const trash = row ? Array.from(row.querySelectorAll('button')).find((b) => (b.getAttribute('title') || '').includes('删除')) : null;
  if (!trash) return JSON.stringify({ ...report, fatal: 'no delete control on the key row' });
  click(trash);
  const confirm = await waitFor(() => {
    const m = document.querySelector('.dbm-modal');
    return m ? (byText('.dbm-modal-foot .dbm-btn', '删除') || byText('.dbm-modal-foot .dbm-btn', 'Delete')) : null;
  }, 5000);
  if (!confirm) return JSON.stringify({ ...report, fatal: 'delete confirmation missing' });

  const deleteWatch = watchBusy();
  click(confirm);
  const gone = await waitFor(() => (keyRow('loading-probe') ? null : true), 20000);
  const deleteSeen = { ...deleteWatch.seen };
  deleteWatch.stop();
  step('delete shows a busy marker', deleteSeen.staleRow || deleteSeen.spinner || deleteSeen.dbBusy);
  report.deleteSeen = deleteSeen;
  if (!gone) return JSON.stringify({ ...report, fatal: 'deleted key still in the tree' });
  step('deleted key gone after refresh', true);
  await sleep(600);
  step('busy marker clears after the delete refresh', !document.querySelector('.dbm-side-body .dbm-tree-stale'));

  // ---- the manual refresh control also reports its work ----
  const refreshBtn = document.querySelector('.dbm-side-head button');
  if (!refreshBtn) return JSON.stringify({ ...report, fatal: 'no refresh control' });
  const manualWatch = watchBusy();
  click(refreshBtn);
  await sleep(900);
  const manualSeen = { ...manualWatch.seen };
  manualWatch.stop();
  step('manual refresh shows a busy marker', manualSeen.spinner || manualSeen.staleRow);
  report.manualSeen = manualSeen;

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

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-loading-'))
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
