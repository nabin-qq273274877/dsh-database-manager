/**
 * Screenshot the search results, for visual review.
 *
 * Usage: node scripts/shot-search.mjs <baseUrl-with-token> <sourceId> <db> <pattern> [outFile]
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9353

const [baseUrl, sourceId, dbArg, pattern, outFile] = process.argv.slice(2)
if (baseUrl === undefined || pattern === undefined) {
  console.error('usage: node scripts/shot-search.mjs <baseUrl-with-token> <sourceId> <db> <pattern> [outFile]')
  process.exit(2)
}
const db = Number(dbArg)
const output = outFile ?? '.shots/search-tree.png'

const FLOW = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const byIncludes = (sel, text, scope) =>
    Array.from((scope || document).querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;

  const sidebar = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())), 20000);
  if (!sidebar) return 'no sidebar';
  click(sidebar);
  await waitFor(() => document.querySelector('.dbm-root'), 10000);

  const sourceRow = await waitFor(() => Array.from(document.querySelectorAll('.dbm-table tbody tr'))
    .find((row) => (row.textContent || '').includes(${JSON.stringify(sourceId ?? '')})) ?? null, 15000);
  if (!sourceRow) return 'source row not found';
  const connect = Array.from(sourceRow.querySelectorAll('.dbm-actions .dbm-btn'))
    .find((b) => ['连接', 'Connect'].includes((b.textContent || '').trim())) || null;
  if (!connect) return 'no connect button';
  click(connect);

  const targetDb = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === ${JSON.stringify(`db${db}`)}), 20000);
  if (!targetDb) return 'no db root';
  for (const other of Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))) {
    if (other !== targetDb && other.getAttribute('aria-expanded') === 'true') click(other);
  }
  await sleep(300);
  if (targetDb.getAttribute('aria-expanded') !== 'true') click(targetDb);
  await sleep(800);

  // Point the search at this database, type the pattern, run it.
  const dbSelect = document.querySelector('.dbm-side-head select.dbm-select');
  if (dbSelect) {
    const selSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    selSetter.call(dbSelect, '${db}');
    dbSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
  }
  const box = document.querySelector('.dbm-side-head input.dbm-input');
  if (!box) return 'no search box';
  setInput(box, ${JSON.stringify(pattern)});
  await sleep(200);
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await waitFor(() => document.querySelector('.dbm-side-body [data-kind="key"]'), 20000);
  await sleep(900);
  return 'ok';
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

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-shot-search-'))
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1400,880', baseUrl,
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
  console.log('flow:', await cdp.evaluate(FLOW))
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(output, Buffer.from(shot.result.data, 'base64'))
  console.log('saved:', output)
} catch (error) {
  console.error('SHOT ERROR:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  cdp?.close(); edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
}
