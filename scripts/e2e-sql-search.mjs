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
 * 'new Event("input")' leaves the DOM correct while React's state stays EMPTY —
 * the form then refuses a condition whose box visibly holds the text. So the
 * typing here goes through the browser with 'Input.insertText', which is the only
 * way to exercise a controlled input honestly.
 *
 * Every case is an ASSERTION with an exit code, not a printed observation: the
 * earlier version printed what it saw and left the reader to decide, which is not
 * a test. The cases, chosen because each one distinguishes this form from the raw
 * WHERE box it replaced:
 *
 *   - CONTAINS finds exactly the matching rows;
 *   - a PERCENT SIGN is a character to find, not a wildcard: searching '%' on a
 *     column holding '100%' returns that one row, where interpolation would
 *     return every row;
 *   - an INJECTION-SHAPED value matches nothing, because it is bound as a value;
 *   - IS NULL returns only the NULL rows, which no text operand can express;
 *   - the tab has no raw-WHERE input at all.
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

/**
 * Seed the values the cases need.
 *
 * 'note' is where the wildcard and null cases point: a literal '100%' and two
 * NULLs. Pointing them at 'name' would have made the wildcard case pass for the
 * wrong reason — a '%' that matched nothing because the value was not there.
 */
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

/** Accumulated outcomes, printed and used for the exit code. */
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail === undefined ? '' : ' → ' + JSON.stringify(detail)}`)
}

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

  /**
   * Run one search and return what the grid shows.
   *
   * @param column - the field to search.
   * @param operator - 'contains' or 'isNull', by the operator's option VALUE
   *   (which is the wire name, not the label).
   * @param text - what to type, or undefined for a unary operator.
   */
  const runSearch = async (column, operator, text) => {
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

      // The field, by the wire value of its option.
      const selects = cond.querySelectorAll('select');
      const fieldOption = Array.from(selects[0].options).find((o) => o.value === ${JSON.stringify(column)});
      if (!fieldOption) return { fatal: 'the form offers no ' + ${JSON.stringify(column)} + ' column', options: Array.from(selects[0].options).map((o) => o.value) };
      setSelect(selects[0], fieldOption.value);
      await sleep(400);

      const ops = cond.querySelectorAll('select')[1];
      const opOption = Array.from(ops.options).find((o) => o.value === ${JSON.stringify(operator)});
      if (!opOption) return { fatal: 'the form offers no ' + ${JSON.stringify(operator)} + ' operator', options: Array.from(ops.options).map((o) => o.value) };
      setSelect(ops, opOption.value);
      await sleep(300);

      // Type real input into the value field, or skip it for a unary operator.
      const valueField = cond.querySelector('input.dbm-input');
      ${text === undefined
        ? 'if (valueField) return { fatal: "a unary operator still shows a value field" };'
        : `if (!valueField) return { fatal: 'the operator has no value field' };
      valueField.focus();
      window.__dbmWaitingForTyping = true;
      window.__dbmTyped = () => { window.__dbmWaitingForTyping = false; };
      const started = Date.now();
      while (window.__dbmWaitingForTyping && Date.now() - started < 20000) await sleep(120);`}

      const searchBtn = Array.from(document.querySelectorAll('.dbm-btn'))
        .find((b) => (b.textContent || '').trim() === '搜索' || (b.textContent || '').trim() === 'Search');
      if (!searchBtn) return { fatal: 'no search button' };
      click(searchBtn);

      // Wait for the reported count, which is what identifies the NEW result: the
      // grid keeps the previous page while the query runs.
      const countLine = await waitFor(() => {
        const el = Array.from(document.querySelectorAll('.dbm-hint'))
          .find((e) => /(匹配到|matched)\\s*\\d/.test(e.textContent || ''));
        return el || null;
      }, 10000);
      await sleep(400);

      return {
        hasRawWhere,
        countText: countLine === null ? null : countLine.textContent.trim(),
        rows: Array.from(document.querySelectorAll('.dbm-data tbody tr')).map((tr) => (tr.textContent || '').trim()),
        errors: Array.from(document.querySelectorAll('.dbm-error')).map((el) => el.textContent.trim()),
      };
    })()`

    const flowPromise = session.evaluate(flow)
    // Type with the browser as soon as the flow asks for it. Skipped for a unary
    // operator, which has no value field.
    if (text !== undefined) {
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
    }
    return flowPromise
  }

  /** Reload so each case starts from a fresh panel with its own source. */
  const reset = async () => {
    await session.evaluate('location.reload()')
    await wait(4500)
  }

  // ---- case 1: contains finds exactly the matching row ---------------------
  const contains = await runSearch('name', 'contains', 'alph')
  check('the search tab has no raw-WHERE box', contains.hasRawWhere === false, contains.hasRawWhere)
  check('contains matched the single expected row', contains.rows.length === 1 && contains.rows[0].includes('alpha'), contains.rows)
  await reset()

  // ---- case 2: a wildcard character is a literal --------------------------
  // '100%' is in the note column, so a wildcard interpretation would also match
  // the rows whose note is non-null — and 'x' contains no percent at all.
  const percent = await runSearch('note', 'contains', '%')
  check('a percent sign matches only the literal 100% row', percent.rows.length === 1 && percent.rows[0].includes('100%'), percent.rows)
  await reset()

  // ---- case 3: an injection-shaped operand is a value ---------------------
  const injection = await runSearch('name', 'contains', "' OR 1=1 --")
  check('an injection-shaped value matches nothing', injection.rows.length === 0, { rows: injection.rows, count: injection.countText })
  await reset()

  // ---- case 4: is NULL, which no text operand can express ----------------
  const nulls = await runSearch('note', 'isNull', undefined)
  check('is NULL returned exactly the two NULL rows', nulls.rows.length === 2, nulls.rows)
  await reset()

  const failed = checks.filter(entry => !entry.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  if (failed.length > 0) process.exitCode = 1
} finally {
  try { socket?.close() } catch { /* gone */ }
  child.kill()
  await wait(1000)
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}
