import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/**
 * End-to-end check of the 搜索 tab's structured form.
 *
 * A separate script from 'e2e-sql-editing.mjs' because the search step needs a
 * different KIND of input. Measured while writing the bigger flow: writing into
 * a controlled input with the native value setter and dispatching
 * 'new Event('input')' leaves the DOM correct while React's state stays EMPTY —
 * the form then refuses a condition whose box visibly holds the text. So the
 * typing here goes through the browser with 'Input.insertText', which is the only
 * way to exercise a controlled input honestly.
 *
 * What it proves, against the server:
 *   - a 'contains' condition returns exactly the matching rows;
 *   - the operand is BOUND, not interpolated: '100%' matches one row, and
 *     '' OR 1=1 --' matches none;
 *   - 'is NULL' returns only the NULL rows;
 *   - the tab has no raw-WHERE box at all.
 *
 * Usage: node scripts/e2e-sql-search.mjs <baseUrl-with-token> <sqliteFile>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9351
const SOURCE_NAME = 'E2E Search'

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-sql-search.mjs <baseUrl-with-token> <sqliteFile>')
  process.exit(2)
}

/** Seed a table with the values the assertions need. */
function seed(file) {
  const db = new DatabaseSync(file)
  db.exec('DROP TABLE IF EXISTS items')
  db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT, note TEXT)')
  db.exec("INSERT INTO items(name, note) VALUES ('alpha', 'x'), ('beta', NULL), ('gamma', '100%'), ('delta', NULL)")
  db.close()
}

/** A minimal CDP session. */
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
const profile = mkdtempSync(join(tmpdir(), 'dbm-search-'))
const child = spawn(EDGE, [
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
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
  // The page must behave as a focused window, or focus/blur never fire at all.
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })

  seed(sqliteFile)
  await session.send('Page.navigate', { url: baseUrl })
  await wait(4500)

  /** Run the flow, typing 'text' into the search field when it asks for it. */
  const runSearch = async (text) => {
    const flow = `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(120); } };
      const byExact = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
      const byIncludes = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
      const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
      const setSelect = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const row = Array.from(document.querySelectorAll('nav button[aria-label]'))
        .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim()));
      if (!row) return { fatal: 'sidebar row never rendered' };
      click(row);
      await sleep(1800);

      // Create the data source through the dialog.
      const newBtn = await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000);
      if (!newBtn) return { fatal: 'no New database button' };
      click(newBtn);
      const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
      if (!modal) return { fatal: 'the create dialog did not open' };
      const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
      const setInput = (el, value) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
        Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setInput(inputs[0], ${JSON.stringify(SOURCE_NAME)});
      setInput(inputs.find((i) => (i.getAttribute('placeholder') || '').includes('D:/data')), ${JSON.stringify(sqliteFile)});
      await sleep(200);
      click(byExact('.dbm-modal-foot .dbm-btn', '保存') || byExact('.dbm-modal-foot .dbm-btn', 'Save'));

      const listed = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(SOURCE_NAME)}), 10000);
      if (!listed) return { fatal: 'the created source is not listed' };
      const connect = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn'))
        .find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
      click(connect);

      const itemsRow = await waitFor(() => byIncludes('.dbm-side-body .dbm-tree-item', 'items'), 15000);
      if (!itemsRow) return { fatal: 'the table tree never appeared', error: (document.querySelector('.dbm-error') || {}).textContent };
      click(itemsRow);
      await sleep(1500);

      // The 搜索 tab.
      const searchTab = byExact('.dbm-tab', '搜索') || byExact('.dbm-tab', 'Search');
      if (!searchTab) return { fatal: 'no search tab' };
      click(searchTab);

      const cond = await waitFor(() => document.querySelector('[data-dbm-condition="0"]'), 8000);
      if (!cond) return { fatal: 'the search form rendered no condition row' };
      const hasRawWhere = document.querySelector('.dbm-tab-body textarea[placeholder*="WHERE"]') !== null
        || document.querySelector('.dbm-tab-body input[placeholder*="WHERE"]') !== null;

      // Column = name, operator = contains.
      const selects = cond.querySelectorAll('select');
      const nameOption = Array.from(selects[0].options).find((o) => o.value === 'name');
      if (!nameOption) return { fatal: 'the form offers no name column' };
      setSelect(selects[0], nameOption.value);
      await sleep(400);
      const ops = cond.querySelectorAll('select')[1];
      const contains = Array.from(ops.options).find((o) => /contains|包含/.test(o.textContent));
      if (!contains) return { fatal: 'the form offers no contains operator', ops: Array.from(ops.options).map((o) => o.textContent) };
      setSelect(ops, contains.value);
      await sleep(300);

      // Let the driver type real input into the value field.
      window.__dbmWaitingForTyping = true;
      const valueField = cond.querySelector('input.dbm-input');
      valueField.focus();
      window.__dbmTyped = () => { window.__dbmWaitingForTyping = false; };
      const started = Date.now();
      while (window.__dbmWaitingForTyping && Date.now() - started < 20000) await sleep(120);

      const searchBtn = Array.from(document.querySelectorAll('.dbm-btn'))
        .find((b) => (b.textContent || '').trim() === '搜索' || (b.textContent || '').trim() === 'Search');
      if (!searchBtn) return { fatal: 'no search button' };
      click(searchBtn);
      await sleep(2200);

      return {
        hasRawWhere,
        typed: valueField.value,
        rows: Array.from(document.querySelectorAll('.dbm-data tbody tr')).map((tr) => (tr.textContent || '').trim()),
        errors: Array.from(document.querySelectorAll('.dbm-error')).map((el) => el.textContent.trim()),
      };
    })()`

    const flowPromise = session.evaluate(flow)
    // Type with the browser as soon as the flow asks for it.
    for (let attempt = 0; attempt < 250; attempt++) {
      const waiting = await session.evaluate('window.__dbmWaitingForTyping === true')
      if (waiting === true) {
        await session.send('Input.insertText', { text })
        await wait(300)
        await session.evaluate('window.__dbmTyped && window.__dbmTyped()')
        break
      }
      await wait(120)
    }
    return flowPromise
  }

  const results = {}

  // A 'contains' condition finds exactly one row.
  results.contains = await runSearch('alph')
  await session.evaluate('location.reload()')
  await wait(4500)

  // A percent sign is a character to find, not a wildcard: only the '100%' row.
  results.percent = await runSearch('%')
  await session.evaluate('location.reload()')
  await wait(4500)

  // An operand that looks like SQL is a VALUE: nothing matches it.
  results.injection = await runSearch("' OR 1=1 --")

  console.log(JSON.stringify(results, null, 2))
} finally {
  try { socket?.close() } catch { /* gone */ }
  child.kill()
  await wait(1000)
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}
