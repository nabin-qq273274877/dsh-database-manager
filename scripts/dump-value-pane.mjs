/**
 * Dump what the Redis value pane actually renders for a key.
 *
 * Used to check the editor's real DOM/text instead of guessing at it — an E2E
 * assertion built on assumed copy fails for the wrong reason.
 *
 * Usage: node scripts/dump-value-pane.mjs <baseUrl-with-token> <sourceId> <db> <namespace> <keyLabel>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9340

const [baseUrl, sourceId, dbArg, namespace, keyLabel] = process.argv.slice(2)
const db = Number(dbArg)

const FLOW = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byText = (sel, text) =>
    Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
  const byIncludes = (sel, text) =>
    Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
  const waitFor = async (fn, ms) => {
    const end = Date.now() + ms;
    for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(80); }
  };
  const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
  const keyRow = (label) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="key"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === label) || null;
  const folderRow = (label) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === label) || null;

  const sidebar = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())), 20000);
  if (!sidebar) return JSON.stringify({ fatal: 'no sidebar' });
  click(sidebar);
  await waitFor(() => document.querySelector('.dbm-root'), 10000);

  const cell = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(sourceId)}), 10000)
    || await waitFor(() => document.querySelector('.dbm-table tbody tr'), 5000);
  const dataRow = cell ? cell.closest('tr') : null;
  const connect = dataRow ? (byText('.dbm-actions .dbm-btn', '连接') || byText('.dbm-actions .dbm-btn', 'Connect')) : null;
  if (!connect) return JSON.stringify({ fatal: 'no connect' });
  click(connect);

  const targetDb = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === ${JSON.stringify(`db${db}`)}), 20000);
  if (!targetDb) return JSON.stringify({ fatal: 'no db root' });
  for (const other of Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))) {
    if (other !== targetDb && other.getAttribute('aria-expanded') === 'true') click(other);
  }
  await sleep(200);
  if (targetDb.getAttribute('aria-expanded') !== 'true') click(targetDb);
  const nsFolder = await waitFor(() => folderRow(${JSON.stringify(namespace.replace(/:$/, ''))}), 20000);
  if (nsFolder && nsFolder.getAttribute('aria-expanded') !== 'true') click(nsFolder);
  await waitFor(() => keyRow(${JSON.stringify(keyLabel)}), 20000);

  const key = keyRow(${JSON.stringify(keyLabel)});
  if (!key) return JSON.stringify({ fatal: 'no key row', keys: Array.from(document.querySelectorAll('.dbm-side-body [data-kind="key"]')).map((el) => (el.querySelector('.dbm-tree-name') || {}).textContent) });
  click(key);
  await sleep(1500);

  const main = document.querySelector('.dbm-main');
  // Mirror the E2E's own "which editor is mounted" probe, so a failing assertion
  // can be explained by the probe's real inputs rather than by re-reading them.
  const badge = document.querySelector('.dbm-main .dbm-badge');
  const header = document.querySelector('.dbm-main strong.dbm-mono');
  return JSON.stringify({
    probe: {
      badgeText: badge ? (badge.textContent || '').trim() : null,
      headerText: header ? (header.textContent || '').trim() : null,
      strongCount: document.querySelectorAll('.dbm-main strong.dbm-mono').length,
      badgeCount: document.querySelectorAll('.dbm-main .dbm-badge').length,
    },
    mainText: (main ? main.textContent : '').replace(/\\s+/g, ' ').trim().slice(0, 600),
    buttons: Array.from(document.querySelectorAll('.dbm-main .dbm-btn')).map((b) => ({ text: (b.textContent || '').trim(), disabled: b.disabled })),
    inputs: Array.from(document.querySelectorAll('.dbm-main input')).map((i) => ({ type: i.type, cls: i.className, placeholder: i.placeholder, value: i.value.slice(0, 40) })),
    textareas: Array.from(document.querySelectorAll('.dbm-main textarea')).map((t) => ({ cls: t.className, rows: t.rows, value: t.value.slice(0, 40) })),
    tables: document.querySelectorAll('.dbm-main .dbm-data table').length,
    headers: Array.from(document.querySelectorAll('.dbm-main .dbm-data th')).map((th) => (th.textContent || '').trim()),
    badges: Array.from(document.querySelectorAll('.dbm-main .dbm-badge')).map((b) => (b.textContent || '').trim()),
  }, null, 2);
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

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-dump-pane-'))
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,900', baseUrl,
], { stdio: 'ignore' })

let cdp
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
  console.log(await cdp.evaluate(FLOW))
} catch (error) {
  console.error('DUMP ERROR:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  cdp?.close(); edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
}
