/**
 * Screenshot the TTL row as it renders, for visual review.
 *
 * Usage: node scripts/shot-ttl-row.mjs <baseUrl-with-token> <sourceId> <db> <folderPath> <keyLabel> <outFile>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9343

const [baseUrl, sourceId, dbArg, folderPath, keyLabel, outFile] = process.argv.slice(2)
if (baseUrl === undefined || outFile === undefined) {
  console.error('usage: node scripts/shot-ttl-row.mjs <baseUrl-with-token> <sourceId> <db> <folderPath> <keyLabel> <outFile>')
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
    for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(80); }
  };
  const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
  const keyRow = (label) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="key"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === label) || null;

  const sidebar = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())), 20000);
  click(sidebar);
  await waitFor(() => document.querySelector('.dbm-root'), 10000);

  const cell = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(sourceId)}), 10000)
    || await waitFor(() => document.querySelector('.dbm-table tbody tr'), 5000);
  const dataRow = cell ? cell.closest('tr') : null;
  const connect = dataRow ? (byText('.dbm-actions .dbm-btn', '连接') || byText('.dbm-actions .dbm-btn', 'Connect')) : null;
  if (!connect) return 'no connect';
  click(connect);

  const targetDb = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === ${JSON.stringify(`db${db}`)}), 20000);
  if (!targetDb) return 'no db root';
  for (const other of Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))) {
    if (other !== targetDb && other.getAttribute('aria-expanded') === 'true') click(other);
  }
  await sleep(200);
  if (targetDb.getAttribute('aria-expanded') !== 'true') click(targetDb);

  // Open every folder in the path, level by level (the tree loads lazily).
  const segments = ${JSON.stringify(folderPath)}.split(':');
  for (let i = 1; i <= segments.length; i++) {
    const path = segments.slice(0, i).join(':');
    const el = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
      .find((node) => (node.getAttribute('data-path') || '') === path), 20000);
    if (!el) return 'folder missing: ' + path;
    if (el.getAttribute('aria-expanded') !== 'true') click(el);
    await waitFor(() => {
      const now = Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
        .find((node) => (node.getAttribute('data-path') || '') === path);
      return now && now.getAttribute('aria-expanded') === 'true' ? true : null;
    }, 20000);
  }

  const row = await waitFor(() => keyRow(${JSON.stringify(keyLabel)}), 20000);
  if (!row) return 'key row missing';
  click(row);
  await waitFor(() => document.querySelector('.dbm-main .dbm-countdown'), 15000);
  await sleep(1200);
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

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-shot-ttl-'))
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
  await new Promise((r) => setTimeout(r, 700))
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(outFile, Buffer.from(shot.result.data, 'base64'))
  console.log('saved:', outFile)
} catch (error) {
  console.error('SHOT ERROR:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  cdp?.close(); edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
}
