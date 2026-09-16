/**
 * Screenshot the tree's loading state.
 *
 * The busy state on a local Redis lasts a few milliseconds, so it cannot be
 * captured by clicking and shooting. CDP network throttling stretches the level
 * fetch enough to photograph it — the widget under review is unchanged, only the
 * transport is slowed, which is exactly the situation the feedback exists for
 * (a slow or remote server).
 *
 * Usage: node scripts/shot-tree-loading.mjs <baseUrl-with-token> <sourceId> <db> <folderPath> <outFile>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9345

const [baseUrl, sourceId, dbArg, folderPath, outFile] = process.argv.slice(2)
if (baseUrl === undefined || outFile === undefined) {
  console.error('usage: node scripts/shot-tree-loading.mjs <baseUrl-with-token> <sourceId> <db> <folderPath> <outFile>')
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
  const byPath = (kind, path) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="' + kind + '"]'))
    .find((el) => (el.getAttribute(kind === 'folder' ? 'data-path' : 'data-key') || '') === path) || null;

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

  const ns = ${JSON.stringify(folderPath)};
  const folder = await waitFor(() => byPath('folder', ns), 20000);
  if (!folder) return 'folder missing';
  if (folder.getAttribute('aria-expanded') !== 'true') click(folder);
  await waitFor(() => document.querySelector('.dbm-side-body [data-kind="key"]'), 15000);
  await sleep(400);
  return 'ready';
})()`

const TRIGGER = `(() => {
  const btn = document.querySelector('.dbm-side-head button');
  if (!btn) return 'no refresh control';
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  btn.click();
  return 'clicked';
})()`

/** Whether the busy marker is currently on screen. */
const BUSY = `!!document.querySelector('.dbm-side-body .dbm-tree-stale') || !!document.querySelector('.dbm-side-body .dbm-spinner')`

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

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-shot-loading-'))
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
  await cdp.send('Network.enable')

  const boot = Date.now() + 90000
  for (;;) {
    const ready = await cdp.evaluate(`!!document.querySelector('nav')`)
    if (ready === true) break
    if (Date.now() > boot) throw new Error('never booted')
    await new Promise((r) => setTimeout(r, 1000))
  }

  const flow = await cdp.evaluate(FLOW)
  console.log('flow:', flow)
  if (flow !== 'ready') throw new Error(`setup failed: ${flow}`)

  // Slow the transport so the busy window lasts long enough to photograph. The
  // widget is untouched; only its input is delayed.
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 1200,
    downloadThroughput: 200 * 1024,
    uploadThroughput: 200 * 1024,
  })

  console.log('trigger:', await cdp.evaluate(TRIGGER))

  // Wait for the busy marker itself rather than sleeping a fixed time: that is
  // the state being photographed, so it is the only honest readiness signal.
  let busy = false
  for (let i = 0; i < 60; i++) {
    busy = await cdp.evaluate(BUSY) === true
    if (busy) break
    await new Promise((r) => setTimeout(r, 50))
  }
  console.log('busy visible:', busy)
  if (!busy) throw new Error('never observed the busy state')

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
