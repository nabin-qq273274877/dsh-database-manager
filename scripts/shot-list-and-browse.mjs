import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/*
 * Screenshot the data-source list and the browse grid, for a visual read of two changes:
 * the list's column headings (they were out of step with the cells), and the browse tab's
 * column comments / table comment / scrollbar.
 *
 * Usage:
 *   node scripts/shot-list-and-browse.mjs <baseUrl-with-token> <sqliteFile>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9467
const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/shot-list-and-browse.mjs <baseUrl-with-token> <sqliteFile>')
  process.exit(2)
}

const OUT = join(process.cwd(), '.shots')
const TAG = process.pid
const SOURCE_NAME = `Shot List ${TAG}`

function seed(file) {
  const db = new DatabaseSync(file)
  db.exec('DROP TABLE IF EXISTS shot_browse')
  db.exec(`CREATE TABLE shot_browse (
    id INTEGER PRIMARY KEY, uid INTEGER, type INTEGER, price NUMERIC(10,2), content TEXT,
    time TEXT, status TEXT, is_del INTEGER, created_time INTEGER, updated_time INTEGER, deleted_time INTEGER
  )`)
  db.exec(`INSERT INTO shot_browse (id, uid, type, price, content, time, status, is_del, created_time, updated_time, deleted_time)
    VALUES (1, 1, 1, 20.00, 'adfsa纟式苦葳工工工工工工工葳', 'Sun Sep 20 2026 00:35:05 GMT+0800 (中国标准时间)', 'on', 0, 0, 0, 0)`)
  db.close()
}

class Session {
  constructor(socket) {
    this.socket = socket
    this.next = 1
    this.pending = new Map()
    socket.on('message', data => {
      const message = JSON.parse(String(data))
      if (message.id === undefined) return
      const entry = this.pending.get(message.id)
      if (entry === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = this.next++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails !== undefined) {
      throw new Error(`page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result.value
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const profile = mkdtempSync(join(tmpdir(), 'dbm-shotlist-'))
const child = spawn(EDGE, [
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--force-device-scale-factor=1',
  '--window-size=1600,1000',
  'about:blank',
], { stdio: 'ignore' })

const origin = baseUrl.replace(/\/\?.*$/, '')
let socket
try {
  seed(sqliteFile)
  let target
  for (let attempt = 0; attempt < 80 && target === undefined; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      target = list.find(entry => entry.type === 'page')?.webSocketDebuggerUrl
    } catch { /* not up */ }
    if (target === undefined) await wait(250)
  }
  if (target === undefined) throw new Error('the debugger endpoint never came up')
  socket = new WebSocket(target, { maxPayload: 64 * 1024 * 1024 })
  await new Promise((resolve, reject) => { socket.on('open', resolve); socket.on('error', reject) })
  const session = new Session(socket)
  await session.send('Page.enable')
  await session.send('Runtime.enable')
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await session.send('Page.navigate', { url: baseUrl })
  await wait(4500)

  const shot = async (name) => {
    const result = await session.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(result.data, 'base64'))
    console.log(`wrote .shots/${name}.png`)
  }

  // The list, with its headings — the thing problem 1 was about.
  const listed = await session.evaluate(`(async () => {
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byIncludes = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
const row = Array.from(document.querySelectorAll('nav button[aria-label]')).find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim()));
if (row) click(row);
await sleep(1500);
const headings = Array.from(document.querySelectorAll('.dbm-table thead th')).map((th) => (th.textContent || '').trim());
return { headings };
})()`)
  console.log('list headings:', JSON.stringify(listed.headings))
  await shot('source-list')

  // Now create a source and open the browse tab.
  await session.evaluate(`(async () => {
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byText = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
const byIncludes = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(150); } };
const setInput = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
click(await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000));
const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
setInput(inputs[0], ${JSON.stringify(SOURCE_NAME)});
setInput(inputs.find((i) => (i.getAttribute('placeholder') || '').includes('D:/data')), ${JSON.stringify(sqliteFile)});
await sleep(200);
click(byText('.dbm-modal-foot .dbm-btn', '保存') || byText('.dbm-modal-foot .dbm-btn', 'Save'));
const listed = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(SOURCE_NAME)}), 15000);
const connect = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn')).find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
click(connect);
await sleep(3500);
const dbNode = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => {
  const label = el.querySelector('.dbm-node-name');
  return label !== null && (label.textContent || '').trim() === 'main';
}) || null, 15000);
click(dbNode);
await sleep(1800);
const tableLink = await waitFor(() => byText('.dbm-table .dbm-link', 'shot_browse'), 12000);
if (tableLink) click(tableLink);
await sleep(2500);
return true;
})()`)
  await shot('browse-with-comments')
} finally {
  try {
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name === SOURCE_NAME)) {
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' })
    }
  } catch { /* best effort */ }
  try { socket?.close() } catch { /* gone */ }
  child.kill()
  await wait(1000)
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}
