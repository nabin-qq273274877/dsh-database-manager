import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/*
 * Screenshot the structure tab and its column editor, for a visual read.
 *
 * The E2E scripts assert behaviour; this one is for EYES — "does the dialog look like
 * the create-table form" is not something a geometry assertion answers well.
 *
 * Usage: node scripts/shot-structure-aligned.mjs <baseUrl-with-token> <sqliteFile>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9437
const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/shot-structure-aligned.mjs <baseUrl-with-token> <sqliteFile>')
  process.exit(2)
}

const OUT = join(process.cwd(), '.shots')
const TAG = process.pid
const SOURCE_NAME = `Shot Aligned ${TAG}`

function seed(file) {
  const db = new DatabaseSync(file)
  db.exec('DROP TABLE IF EXISTS shot_target')
  db.exec(`CREATE TABLE shot_target (
    id INTEGER PRIMARY KEY,
    a_deliberately_long_column_name_here TEXT,
    amount INTEGER NOT NULL DEFAULT 0,
    flag TEXT,
    note TEXT
  )`)
  db.exec("INSERT INTO shot_target (id, a_deliberately_long_column_name_here, amount) VALUES (1, 'x', 3)")
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
const profile = mkdtempSync(join(tmpdir(), 'dbm-shot-'))
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

  const ready = await session.evaluate(`(async () => {
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
try {
  const row = Array.from(document.querySelectorAll('nav button[aria-label]')).find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim()));
  click(row);
  await sleep(1800);
  click(await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000));
  const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
  const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
  setInput(inputs[0], ${JSON.stringify(SOURCE_NAME)});
  setInput(inputs.find((i) => (i.getAttribute('placeholder') || '').includes('D:/data')), ${JSON.stringify(sqliteFile)});
  await sleep(200);
  click(byText('.dbm-modal-foot .dbm-btn', '保存') || byText('.dbm-modal-foot .dbm-btn', 'Save'));
  const listed = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(SOURCE_NAME)}), 15000);
  if (!listed) return { fatal: 'source not listed' };
  const sources = await (await fetch('/api/dsh-database/sources')).json();
  const matches = sources.sources.filter((s) => s.name === ${JSON.stringify(SOURCE_NAME)});
  if (matches.length !== 1) return { fatal: 'source did not resolve to one entry' };
  const connect = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn')).find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
  click(connect);
  await sleep(3500);
  const dbNode = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => {
    const label = el.querySelector('.dbm-node-name');
    return label !== null && (label.textContent || '').trim() === 'main';
  }) || null, 15000);
  click(dbNode);
  await sleep(1800);
  const tableLink = await waitFor(() => byText('.dbm-table .dbm-link', 'shot_target'), 12000);
  if (!tableLink) return { fatal: 'table not in the overview' };
  click(tableLink);
  await sleep(1800);
  click(byText('.dbm-tab', '结构') || byText('.dbm-tab', 'Structure'));
  await sleep(2000);
  return { ok: true, sourceId: matches[0].id };
} catch (error) {
  return { fatal: String(error && error.message ? error.message : error) };
}
})()`)

  if (ready.fatal !== undefined) throw new Error(ready.fatal)

  const shot = async (name) => {
    const result = await session.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(result.data, 'base64'))
    console.log(`wrote .shots/${name}.png`)
  }

  await shot('structure-tab')
  // Open the ADD COLUMN editor.
  await session.evaluate(`(() => {
    const byIncludes = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
    const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
    click(byIncludes('.dbm-btn', '新增列'));
    return true;
  })()`)
  await wait(1500)
  await shot('structure-add-column-dialog')

  // And the edit dialog for a column that carries a DEFAULT.
  await session.evaluate(`(() => {
    const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
    const close = document.querySelector('.dbm-overlay');
    if (close !== null) { const btn = Array.from(document.querySelectorAll('.dbm-modal-foot .dbm-btn')).find((b) => (b.textContent || '').trim() === '取消'); if (btn) click(btn); }
    return true;
  })()`)
  await wait(1200)
  await session.evaluate(`(() => {
    const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
    const row = Array.from(document.querySelectorAll('.dbm-table tbody tr')).find((tr) => {
      const first = tr.querySelector('td.dbm-mono');
      return first !== null && (first.textContent || '').trim() === 'amount';
    });
    const edit = row === undefined ? null : Array.from(row.querySelectorAll('button')).find((b) => ['修改', 'Change'].includes((b.textContent || '').trim()));
    if (edit) click(edit);
    return true;
  })()`)
  await wait(1500)
  await shot('structure-edit-column-dialog')
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
