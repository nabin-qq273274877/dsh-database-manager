import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/**
 * Measure the SQL tree's rows to find why the trailing number is cut off.
 *
 * A MEASUREMENT, not a guess: the question is geometric (does the row's content
 * exceed its box?) and the answer is in the rendered widths. The panel is driven
 * with a real browser so the numbers come from the real layout, including the
 * shell's own width for the sidebar.
 *
 * What it reports, per row:
 *   - the row's client width vs its scroll width (overflow shows as scrollWidth
 *     being larger);
 *   - the number element's right edge vs the row's right edge (a cut-off number
 *     has the element extending past the row, or clipped by an ancestor's
 *     overflow);
 *   - 'box-sizing', because a 100%-width flex row with padding and
 *     content-box sizing is wider than its container by the padding.
 *
 * Usage: node scripts/measure-tree-number.mjs <baseUrl-with-token> <sqliteFile>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9353

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/measure-tree-number.mjs <baseUrl-with-token> <sqliteFile>')
  process.exit(2)
}

/** Seed a database with a longish name and several tables, like the screenshot. */
function seed(file) {
  const db = new DatabaseSync(file)
  for (const name of ['my_about', 'my_about_new', 'my_activity', 'my_activity_detail']) {
    db.exec(`DROP TABLE IF EXISTS ${name}`)
    db.exec(`CREATE TABLE ${name}(id INTEGER PRIMARY KEY, v TEXT)`)
    db.exec(`INSERT INTO ${name}(v) VALUES ('x'), ('y'), ('z')`)
  }
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
const profile = mkdtempSync(join(tmpdir(), 'dbm-measure-'))
const child = spawn(EDGE, [
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1600,1000',
  'about:blank',
], { stdio: 'ignore' })

let socket
try {
  let target
  for (let attempt = 0; attempt < 80 && target === undefined; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      target = list.find(entry => entry.type === 'page')?.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    if (target === undefined) await wait(250)
  }
  if (target === undefined) throw new Error('the debugger endpoint never came up')

  socket = new WebSocket(target, { maxPayload: 64 * 1024 * 1024 })
  await new Promise((resolve, reject) => { socket.on('open', resolve); socket.on('error', reject) })
  const session = new Session(socket)
  await session.send('Page.enable')
  await session.send('Runtime.enable')
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })

  seed(sqliteFile)
  await session.send('Page.navigate', { url: baseUrl })
  await wait(4500)

  const report = await session.evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(120); } };
    const byIncludes = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
    const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };

    const row = Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim()));
    if (!row) return { fatal: 'sidebar row never rendered' };
    click(row);
    await sleep(1800);

    // Create a source over the seeded file.
    const newBtn = await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000);
    click(newBtn);
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
    const setInput = (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setInput(inputs[0], 'Measure Tree ${process.pid}');
    setInput(inputs.find((i) => (i.getAttribute('placeholder') || '').includes('D:/data')), ${JSON.stringify(sqliteFile)});
    await sleep(200);
    click(Array.from(modal.querySelectorAll('.dbm-modal-foot .dbm-btn')).find((b) => /保存|Save/.test(b.textContent)));

    const listed = await waitFor(() => byIncludes('.dbm-table td', 'Measure Tree ${process.pid}'), 10000);
    if (!listed) return { fatal: 'the created source is not listed' };
    const connect = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn'))
      .find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
    click(connect);

    // Expand the database so its tables (and their counts) render.
    const dbNode = await waitFor(() => document.querySelector('.dbm-side-body .dbm-tree-item'), 15000);
    if (!dbNode) return { fatal: 'no database node in the tree' };
    const caret = dbNode.querySelector('.dbm-caret-btn');
    if (caret) click(caret);
    else click(dbNode);
    await sleep(2000);

    const sideBody = document.querySelector('.dbm-side-body');
    const side = document.querySelector('.dbm-side');
    const measure = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        text: (el.textContent || '').trim().slice(0, 30),
        className: el.className,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        boxSizing: style.boxSizing,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        overflowX: style.overflowX,
        flexShrink: style.flexShrink,
      };
    };

    const rows = Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item'));
    return {
      sideWidth: side === null ? null : Math.round(side.getBoundingClientRect().width),
      sideBody: sideBody === null ? null : {
        clientWidth: sideBody.clientWidth,
        scrollWidth: sideBody.scrollWidth,
        overflowX: getComputedStyle(sideBody).overflowX,
      },
      rows: rows.map(measure),
      metas: rows.map((r) => {
        const meta = r.querySelector('.dbm-tree-meta');
        if (meta === null) return null;
        const m = measure(meta);
        const rowRect = r.getBoundingClientRect();
        return {
          text: m.text,
          right: m.right,
          rowRight: Math.round(rowRect.right),
          pastRowRight: m.right - rowRect.right,
          marginLeft: getComputedStyle(meta).marginLeft,
          flexShrink: m.flexShrink,
          width: m.width,
        };
      }).filter(Boolean),
    };
  })()`)

  console.log(JSON.stringify(report, null, 2))
} finally {
  try { socket?.close() } catch { /* gone */ }
  child.kill()
  await wait(1000)
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}
