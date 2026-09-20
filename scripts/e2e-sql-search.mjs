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
/**
 * The data source name this run creates, unique per run.
 *
 * Unique so a leftover from an earlier run cannot be mistaken for this one's, and
 * so the cleanup at the end removes exactly what this run added. A fixed name had
 * two costs: the entry accumulated in the user's own configuration, and any
 * name-based lookup could resolve to an older entry pointing at a different
 * database file.
 */
const SOURCE_NAME = `E2E Search ${process.pid}`

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
   * Run one search through the QBE form and return what the grid shows.
   *
   * @param tag - a per-case tag appended to the source name. Each case reloads the
   *   page and creates its own source, so a SHARED name would put several
   *   same-named entries in the user's configuration at once — the ambiguity that
   *   made an earlier version of this script read the wrong database.
   * @param criteria - one entry per row to fill in: { column, operator, text }.
   *   'operator' is the wire name of the option's VALUE, 'text' the operand to type
   *   (omit it for a unary operator, which has no value control). An empty list
   *   presses 执行 with nothing filled in, which is its own case: phpMyAdmin sends
   *   no WHERE then and shows every row.
   */
  const runSearch = async (tag, criteria) => {
    /** This case's own source name, so no two entries ever share one. */
    const sourceName = `${SOURCE_NAME} ${tag}`
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
      const sourceName = ${JSON.stringify(sourceName)};
      const criteria = ${JSON.stringify(criteria)};

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
      setInput(inputs[0], sourceName);
      setInput(inputs.find((i) => (i.getAttribute('placeholder') || '').includes('D:/data')), ${JSON.stringify(sqliteFile)});
      await sleep(200);
      click(byExact('.dbm-modal-foot .dbm-btn', '保存') || byExact('.dbm-modal-foot .dbm-btn', 'Save'));

      const listed = await waitFor(() => byIncludes('.dbm-table td', sourceName), 10000);
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

      const page = await waitFor(() => document.querySelector('[data-dbm-search-page]'), 8000);
      if (!page) return { fatal: 'the search page did not render', error: (document.querySelector('.dbm-error') || {}).textContent };
      const hasRawWhere = document.querySelector('.dbm-tab-body textarea[placeholder*="WHERE"]') !== null
        || document.querySelector('.dbm-tab-body input[placeholder*="WHERE"]') !== null;
      const headers = Array.from(page.querySelectorAll('.dbm-search-table thead th')).map((th) => (th.textContent || '').trim());
      const rowNames = Array.from(page.querySelectorAll('[data-dbm-search-row]')).map((tr) => tr.getAttribute('data-dbm-search-row'));

      for (const criterion of criteria) {
        const target = page.querySelector('[data-dbm-search-row="' + criterion.column + '"]');
        if (target === null) return { fatal: 'the form has no row for ' + criterion.column, rowNames };
        const ops = target.querySelector('[data-dbm-search-operator]');
        if (ops === null) return { fatal: 'the row has no operator control' };
        if (criterion.operator !== undefined) {
          const offered = Array.from(ops.options).map((o) => o.value);
          if (!offered.includes(criterion.operator)) return { fatal: 'the row offers no ' + criterion.operator, offered };
          setSelect(ops, criterion.operator);
          await sleep(350);
        }
        if (criterion.text !== undefined) {
          const value = target.querySelector('[data-dbm-search-value]');
          if (value === null) return { fatal: 'the row has no value control for ' + criterion.operator };
          value.focus();
          // Ask the driver for real typed input: a native value setter leaves
          // React's state empty, so the form would refuse a box holding text.
          window.__dbmTypingRequest = criterion.text;
          const started = Date.now();
          while (window.__dbmTypingRequest !== null && Date.now() - started < 20000) await sleep(120);
        }
      }

      const runBtn = page.querySelector('[data-dbm-search-run]');
      if (runBtn === null) return { fatal: 'no search button' };
      /*
       * The run button must be REACHABLE without scrolling.
       *
       * Measured while checking the page visually: the whole form was the scroll
       * container, so on a seven-column table the 执行 button sat below the fold and
       * the screenshot showed no run button at all. That is a presence check's blind
       * spot — the element exists and responds to a synthetic click, so every other
       * assertion here passed. Only the geometry catches it.
       */
      const rect = runBtn.getBoundingClientRect();
      const viewport = { w: window.innerWidth, h: window.innerHeight };
      const reachable = rect.top >= 0 && rect.bottom <= viewport.h && rect.width > 0 && rect.height > 0
        && rect.top < viewport.h;
      click(runBtn);

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
        headers,
        rowNames,
        runRect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) },
        viewportH: viewport.h,
        runReachable: reachable,
        countText: countLine === null ? null : countLine.textContent.trim(),
        rows: Array.from(document.querySelectorAll('.dbm-data tbody tr')).map((tr) => (tr.textContent || '').trim()),
        errors: Array.from(document.querySelectorAll('.dbm-error')).map((el) => el.textContent.trim()),
      };
    })()`

    const flowPromise = session.evaluate(flow)
    /*
     * Serve the page's typing requests until the flow resolves.
     *
     * One request per filled-in row, and the number of them depends on the case, so
     * this cannot be a single fixed round: it loops until the flow settles. A fixed
     * loop left the second value box empty and the form then searched for the wrong
     * thing — a failure that reads as a product bug rather than as a harness one.
     */
    let settled = false
    const outcome = flowPromise.then(
      value => { settled = true; return value },
      error => { settled = true; throw error },
    )
    for (let attempt = 0; attempt < 900 && !settled; attempt++) {
      await wait(120)
      if (settled) break
      const pending = await session.evaluate('window.__dbmTypingRequest === undefined || window.__dbmTypingRequest === null ? null : window.__dbmTypingRequest')
      if (typeof pending === 'string' && pending !== '') {
        await session.send('Input.insertText', { text: pending })
        await wait(300)
        await session.evaluate('window.__dbmTypingRequest = null')
      }
    }
    return outcome
  }

  /** Reload so each case starts from a fresh panel with its own source. */
  const reset = async () => {
    await session.evaluate('location.reload()')
    await wait(4500)
  }

  // ---- case 1: the form is phpMyAdmin's QBE shape, and empty means all ----
  const shape = await runSearch('shape', [])
  check('the search tab has no raw-WHERE box', shape.hasRawWhere === false, shape.hasRawWhere)
  check('the header is 字段 / 类型 / 排序规则 / 运算符 / 值', JSON.stringify(shape.headers) === JSON.stringify(['字段', '类型', '排序规则', '运算符', '值']), shape.headers)
  /*
   * EVERY column has a row, in the table's own order. That is what makes this the
   * phpMyAdmin page rather than the "add a condition and pick a column" form it
   * replaced: the user reads the list to find the field, instead of hunting for it
   * in a dropdown.
   */
  check('every column of the table has a row', JSON.stringify(shape.rowNames) === JSON.stringify(['id', 'name', 'note']), shape.rowNames)
  // The run button must be on screen without scrolling. Only the geometry catches
  // this: the element is present and clickable either way.
  check('the run button is visible without scrolling', shape.runReachable === true, { rect: shape.runRect, viewportH: shape.viewportH })
  // phpMyAdmin builds no WHERE clause with nothing filled in, so pressing 执行 on a
  // blank form must search for everything rather than refuse.
  check('an empty search shows all rows', shape.rows.length === 4, { rows: shape.rows.length, count: shape.countText, errors: shape.errors })
  await reset()

  // ---- case 2: contains finds exactly the matching row --------------------
  const contains = await runSearch('contains', [{ column: 'name', operator: 'contains', text: 'alph' }])
  check('contains matched the single expected row', contains.rows.length === 1 && contains.rows[0].includes('alpha'), contains.rows)
  await reset()

  // ---- case 3: two filled rows combine with AND --------------------------
  // 'a' matches every name; the second row keeps only the rows with a note, so the
  // two NULL rows must be gone. A form that ORed them would return all four.
  const anded = await runSearch('anded', [
    { column: 'name', operator: 'contains', text: 'a' },
    { column: 'note', operator: 'isNotNull' },
  ])
  check('two filled rows combine with AND', anded.rows.length === 2, anded.rows)
  check('the AND excluded the NULL rows', !anded.rows.some(r => r.includes('beta') || r.includes('delta')), anded.rows)
  await reset()

  // ---- case 4: a wildcard character is a literal --------------------------
  // '100%' is in the note column, so a wildcard interpretation would also match
  // the rows whose note is non-null — and 'x' contains no percent at all.
  const percent = await runSearch('percent', [{ column: 'note', operator: 'contains', text: '%' }])
  check('a percent sign matches only the literal 100% row', percent.rows.length === 1 && percent.rows[0].includes('100%'), percent.rows)
  await reset()

  // ---- case 5: an injection-shaped operand is a value ---------------------
  const injection = await runSearch('injection', [{ column: 'name', operator: 'contains', text: "' OR 1=1 --" }])
  check('an injection-shaped value matches nothing', injection.rows.length === 0, { rows: injection.rows, count: injection.countText })
  await reset()

  // ---- case 6: is NULL, which no text operand can express ----------------
  const nulls = await runSearch('isnull', [{ column: 'note', operator: 'isNull' }])
  check('is NULL returned exactly the two NULL rows', nulls.rows.length === 2, nulls.rows)
  await reset()

  const failed = checks.filter(entry => !entry.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  if (failed.length > 0) process.exitCode = 1
} finally {
  /*
   * Delete the data sources this run created.
   *
   * Matched by PREFIX, not by the bare run name: each case appends its own tag, so
   * an equality test finds none of them and leaves them in the user's
   * configuration. The prefix is this run's unique source name, so nothing else
   * can match.
   */
  try {
    const origin = baseUrl.replace(/\/\?.*$/, '')
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name.startsWith(SOURCE_NAME))) {
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' })
      console.error(`note: removed the run's data source (${source.id})`)
    }
  } catch (error) {
    console.error(`note: the run's data sources could not be removed: ${error instanceof Error ? error.message : String(error)}`)
  }
  try { socket?.close() } catch { /* gone */ }
  child.kill()
  await wait(1000)
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}
