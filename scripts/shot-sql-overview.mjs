/**
 * Screenshot the SQL database overview pane, for eyeballing the layout.
 *
 * Usage: node scripts/shot-sql-overview.mjs <baseUrl-with-token> <outFile>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9347
const SOURCE_ID = 'sql-e2e'

const baseUrl = process.argv[2]
const outFile = process.argv[3] ?? 'overview.png'
if (baseUrl === undefined) {
  console.error('usage: node scripts/shot-sql-overview.mjs <baseUrl-with-token> <outFile>')
  process.exit(2)
}

const FLOW = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms) => {
    const end = Date.now() + ms;
    for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(150); }
  };
  const within = (scope, sel, text) =>
    Array.from(scope.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
  const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };

  const row = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())), 20000);
  if (!row) return 'no sidebar row';
  click(row);
  const listed = await waitFor(
    () => Array.from(document.querySelectorAll('.dbm-table tbody tr'))
      .find((tr) => Array.from(tr.querySelectorAll('td .dbm-mono'))
        .some((td) => (td.textContent || '').trim() === ${JSON.stringify(SOURCE_ID)})), 15000);
  if (!listed) return 'no source row';
  click(within(listed, '.dbm-actions .dbm-btn', '连接'));
  const node = await waitFor(
    () => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => (el.textContent || '').includes('main')), 20000);
  if (!node) return 'no schema node';
  click(node);
  const table = await waitFor(() => document.querySelector('.dbm-main table.dbm-table'), 15000);
  if (!table) return 'no overview';
  await sleep(600);
  return 'ok';
})()`

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw))
      const settle = this.pending.get(msg.id)
      if (settle !== undefined) { this.pending.delete(msg.id); settle(msg) }
    })
  }
  ready() { return new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject) }) }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve) => { this.pending.set(id, resolve); this.ws.send(JSON.stringify({ id, method, params })) })
  }
  async evaluate(expression) {
    const reply = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return reply.result?.result?.value
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

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-shot-'))
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
    if ((await cdp.evaluate(`!!document.querySelector('nav')`)) === true) break
    if (Date.now() > boot) throw new Error('the app never booted')
    await new Promise((r) => setTimeout(r, 1000))
  }

  const status = await cdp.evaluate(FLOW)
  console.log('flow:', status)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const data = shot.result?.data
  if (typeof data !== 'string') throw new Error('no screenshot data')
  writeFileSync(outFile, Buffer.from(data, 'base64'))
  console.log('saved', outFile)
} catch (error) {
  console.error('SHOT ERROR:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  cdp?.close()
  edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
}
