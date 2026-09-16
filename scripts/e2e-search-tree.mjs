/**
 * Verify the search returns a TREE and that clearing the box restores the tree.
 *
 * Two behaviours that a flat result list would fail:
 *
 *  1. matches are regrouped into folders, so a key like jd:order:1 shows under a
 *     jd folder with an order folder inside it — the same structure the normal
 *     tree draws;
 *  2. emptying the search box goes back to the ordinary lazily-loaded tree,
 *     without needing a second control.
 *
 * Usage: node scripts/e2e-search-tree.mjs <baseUrl-with-token> <sourceId> <db> <pattern> <folderPath>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9352

const [baseUrl, sourceId, dbArg, pattern, folderPath] = process.argv.slice(2)
if (baseUrl === undefined || folderPath === undefined) {
  console.error('usage: node scripts/e2e-search-tree.mjs <baseUrl-with-token> <sourceId> <db> <pattern> <folderPath>')
  process.exit(2)
}
const db = Number(dbArg)

const FLOW = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /**
   * Find an element by its exact text, optionally within a scope.
   *
   * The scope matters: several rows carry a 连接 button, so a document-wide
   * lookup would click whichever came first rather than the row that was just
   * located.
   */
  const byText = (sel, text, scope) =>
    Array.from((scope || document).querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
  const byIncludes = (sel, text, scope) =>
    Array.from((scope || document).querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
  const waitFor = async (fn, ms) => {
    const end = Date.now() + ms;
    for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(60); }
  };
  const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
  const setInput = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const byPath = (kind, path) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="' + kind + '"]'))
    .find((el) => (el.getAttribute(kind === 'folder' ? 'data-path' : 'data-key') || '') === path) || null;

  /** The visible rows, as a shape that reveals nesting. */
  const shape = () => Array.from(document.querySelectorAll('.dbm-side-body [data-kind]')).map((el) => ({
    kind: el.getAttribute('data-kind'),
    path: el.getAttribute('data-path') || el.getAttribute('data-key') || '',
    depth: (el.className.match(/dbm-tree-depth-(\\d)/) || [])[1] ?? '?',
    label: (el.querySelector('.dbm-tree-name') || {}).textContent || '',
    meta: (el.querySelector('.dbm-tree-meta') || {}).textContent || null,
  }));

  const report = { steps: [] };
  const step = (name, detail) => report.steps.push({ name, detail });

  const sidebar = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())), 20000);
  if (!sidebar) return JSON.stringify({ ...report, fatal: 'no sidebar row' });
  click(sidebar);
  await waitFor(() => document.querySelector('.dbm-root'), 10000);

  /**
   * Find the data source's row by its ID, and connect.
   *
   * No fallback to "the first row": that silently connected to whichever source
   * sorted first and made the whole run measure the wrong server — the symptom
   * was a target database holding 2 keys instead of the 7 that were seeded.
   * Failing loudly is the only safe behaviour when the target is in doubt.
   */
  const sourceRow = await waitFor(() => {
    const cells = Array.from(document.querySelectorAll('.dbm-table tbody tr'));
    return cells.find((row) => (row.textContent || '').includes(${JSON.stringify(sourceId ?? '')})) ?? null;
  }, 15000);
  if (!sourceRow) {
    return JSON.stringify({
      ...report,
      fatal: 'data source row not found: ' + ${JSON.stringify(sourceId ?? '')},
      rows: Array.from(document.querySelectorAll('.dbm-table tbody tr')).map((row) => (row.textContent || '').trim().slice(0, 80)),
    });
  }
  const connect = byText('.dbm-actions .dbm-btn', '连接', sourceRow) || byText('.dbm-actions .dbm-btn', 'Connect', sourceRow);
  if (!connect) return JSON.stringify({ ...report, fatal: 'no connect button on the source row' });
  click(connect);

  const targetDb = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === ${JSON.stringify(`db${db}`)}), 20000);
  if (!targetDb) return JSON.stringify({ ...report, fatal: 'no db root' });
  for (const other of Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))) {
    if (other !== targetDb && other.getAttribute('aria-expanded') === 'true') click(other);
  }
  await sleep(300);
  if (targetDb.getAttribute('aria-expanded') !== 'true') click(targetDb);

  // Open the folder so the pre-search tree state is a real, expanded tree.
  const segments = ${JSON.stringify(folderPath)}.split(':');
  for (let i = 1; i <= segments.length; i++) {
    const path = segments.slice(0, i).join(':');
    const el = await waitFor(() => byPath('folder', path), 20000);
    if (!el) {
      // Report what IS on screen, so a missing folder is attributable rather
      // than mysterious: a collapsed database looks identical to a missing one.
      const dbRowNow = Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
        .find((row) => (row.getAttribute('data-db') || '') === '${db}');
      return JSON.stringify({
        ...report,
        fatal: 'folder missing: ' + path,
        targetDbExpanded: dbRowNow ? dbRowNow.getAttribute('aria-expanded') : 'db row absent',
        rows: shape(),
      });
    }
    if (el.getAttribute('aria-expanded') !== 'true') click(el);
    await waitFor(() => {
      const now = byPath('folder', path);
      return now && now.getAttribute('aria-expanded') === 'true' ? true : null;
    }, 20000);
  }
  await waitFor(() => document.querySelector('.dbm-side-body [data-kind="key"]'), 15000);
  await sleep(500);

  const treeBefore = shape();
  report.treeBefore = treeBefore;
  step('tree has folders before searching', treeBefore.some((row) => row.kind === 'folder'));

  // Point the search at the right database, then run it.
  const dbSelect = document.querySelector('.dbm-side-head select.dbm-select');
  if (!dbSelect) return JSON.stringify({ ...report, fatal: 'no db selector' });
  const selSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  selSetter.call(dbSelect, '${db}');
  dbSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(200);

  const box = document.querySelector('.dbm-side-head input.dbm-input');
  if (!box) return JSON.stringify({ ...report, fatal: 'no search box' });
  setInput(box, ${JSON.stringify(pattern)});
  await sleep(200);
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(3000);

  const duringSearch = shape();
  report.duringSearch = duringSearch;
  report.searchHeader = ((document.querySelector('.dbm-search-header') || {}).textContent || '').trim() || null;

  const keysFound = duringSearch.filter((row) => row.kind === 'key');
  const foldersFound = duringSearch.filter((row) => row.kind === 'folder');
  step('search found keys', keysFound.length > 0);
  // The point of this round: results are a TREE, so folders must be present.
  step('search results are grouped into folders', foldersFound.length > 0);

  // Every folder is expanded, so a match is never hidden behind a row the user
  // would have to open: the search already located it.
  report.folderExpandedStates = Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
    .map((el) => el.getAttribute('aria-expanded'));
  step('result folders are all expanded',
    report.folderExpandedStates.length > 0 && report.folderExpandedStates.every((state) => state === 'true'));

  /**
   * Search-result folder rows must NOT offer the folder's write controls.
   *
   * A search-built folder counts only its matches, while deleting that prefix
   * removes every key under it — so a row reading "order (1)" could destroy far
   * more than it shows. This is asserted on the rendered buttons, because the
   * risk is a data-loss one and a later change could quietly re-add them.
   */
  const folderActions = Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
    .map((el) => ({
      path: el.getAttribute('data-path'),
      buttons: Array.from(el.querySelectorAll('button')).map((b) => b.getAttribute('title') || ''),
    }))
    .filter((entry) => entry.buttons.length > 0);
  report.folderActionsDuringSearch = folderActions;
  step('search-result folders offer no write controls', folderActions.length === 0);

  // A leaf must show only its last segment, because the folder row above supplies
  // the prefix — the same convention as the normal tree.
  const nested = keysFound.filter((row) => row.depth !== '0');
  report.nestedLeafLabels = nested.map((row) => row.label);
  step('leaves are shown as their own segment, under their folder',
    nested.length > 0 && nested.every((row) => !row.label.includes(':')));

  // Both folder and key rows must carry the db the search targeted, so a result
  // can be acted on without ambiguity.
  const dbRows = shape().filter((row) => row.kind === 'db');
  report.dbRowsDuringSearch = dbRows;
  step('no database roots are shown while searching', dbRows.length === 0);

  // ---- clearing the box returns to the tree ----
  setInput(box, '');
  await sleep(2500);
  const afterClear = shape();
  report.afterClear = afterClear;
  step('clearing the box restores the database roots', afterClear.some((row) => row.kind === 'db'));
  step('clearing the box drops the search header',
    document.querySelector('.dbm-search-header') === null);

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

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-search-'))
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
