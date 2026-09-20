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
 *
 * 'wide' exists for the field-list cases. The clipping defect is INVISIBLE on a
 * three-column table: three rows fit in the old 45%-capped box, so every assertion
 * about them passed while a 25-column table showed four rows out of twenty-five.
 * A regression test for it therefore needs a table wide enough to overflow the box
 * the defect lived in.
 */
function seed(file) {
  const db = new DatabaseSync(file)
  db.exec('DROP TABLE IF EXISTS items')
  db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT, note TEXT)')
  db.exec("INSERT INTO items(name, note) VALUES ('alpha', 'x'), ('beta', NULL), ('gamma', '100%'), ('delta', NULL)")
  db.exec('DROP TABLE IF EXISTS wide')
  const wideColumns = Array.from({ length: 24 }, (_, index) => `field_${String(index + 1).padStart(2, '0')} VARCHAR(20)`)
  db.exec(`CREATE TABLE wide(id INTEGER PRIMARY KEY, ${wideColumns.join(', ')})`)
  db.exec('INSERT INTO wide(id) VALUES (1)')
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
   * @param table - which table to open. 'wide' is for the field-list geometry cases,
   *   which need more columns than fit in the old capped box.
   */
  const runSearch = async (tag, criteria, table = 'items') => {
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

      const itemsRow = await waitFor(() => byIncludes('.dbm-side-body .dbm-tree-item', ${JSON.stringify(table)}), 15000);
      if (!itemsRow) return { fatal: 'the table tree never appeared', table, error: (document.querySelector('.dbm-error') || {}).textContent };
      click(itemsRow);
      // Exact match on the tree entry: 'items' is a substring of nothing here, but a
      // table whose name is a PREFIX of another would otherwise pick the wrong one.
      const exactRow = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item'))
        .find((el) => {
          const name = el.querySelector('.dbm-tree-name');
          return name !== null && (name.textContent || '').trim() === ${JSON.stringify(table)};
        }) || null, 8000);
      if (exactRow !== null && !exactRow.classList.contains('dbm-tree-item-active')) click(exactRow);
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
       * The field list must be shown WHOLE, with no scroll box of its own.
       *
       * Reported by the user: the field list scrolled inside a capped box, and a
       * 25-column table showed four rows with twenty-one hidden — measured, a 235px box
       * holding 1182px of content. An inner scrollbar on a list of fields reads as
       * "these are the fields" rather than "there is more below", so the user concludes
       * the column they want does not exist. Asserted on the volume of visible rows and
       * on the box's own scroll state, not on the absence of a scrollbar anywhere: the
       * PAGE still scrolls, which is what makes every row reachable.
       */
      const fieldRows = Array.from(document.querySelectorAll('[data-dbm-search-row]'));
      const fieldBox = document.querySelector('.dbm-search-scroll');
      const fieldBoxScrolls = fieldBox !== null && fieldBox.scrollHeight > fieldBox.clientHeight + 1;
      /*
       * Rows must not be clipped by an INNER box. The page-level scroller is excluded:
       * on a wide table the form is legitimately taller than the viewport, and those
       * rows are reachable by scrolling the page.
       */
      const innerClipped = fieldRows.filter((tr) => {
        let node = tr.parentElement;
        const viewers = [];
        while (node !== null && node !== document.body) {
          if (node.scrollHeight > node.clientHeight + 1 && /(auto|scroll|hidden)/.test(getComputedStyle(node).overflowY)) viewers.push(node);
          node = node.parentElement;
        }
        for (const box of viewers.slice(0, -1)) {
          const outer = box.getBoundingClientRect();
          const r = tr.getBoundingClientRect();
          if (r.bottom > outer.bottom + 1 || r.top < outer.top - 1) return true;
        }
        return false;
      }).map((tr) => tr.getAttribute('data-dbm-search-row'));
      /*
       * The run button must be reachable at every scroll position.
       *
       * This is the OLD defect, and showing every field is exactly what could bring it
       * back: the button sits after the field list in normal flow, so a tall list pushes
       * it below the fold (measured at 24 columns: y=1316 in an 804px viewport). It is
       * sticky, so it must be on screen at the top, the middle and the bottom.
       */
      const reachability = () => {
        const r = runBtn.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0 && r.height > 0;
      };
      const reachAtTop = reachability();
      page.scrollTop = Math.round((page.scrollHeight - page.clientHeight) / 2);
      await sleep(250);
      const reachAtMid = reachability();
      page.scrollTop = page.scrollHeight;
      await sleep(250);
      const reachAtBottom = reachability();
      page.scrollTop = 0;
      await sleep(250);

      const rect = runBtn.getBoundingClientRect();
      const viewport = { w: window.innerWidth, h: window.innerHeight };
      const reachable = rect.top >= 0 && rect.bottom <= viewport.h && rect.width > 0 && rect.height > 0
        && rect.top < viewport.h;
      /*
       * The page's own height, measured BEFORE running.
       *
       * Running now leaves this tab (the rows appear in 浏览), so anything measured
       * afterwards would read the grid's page instead of the form's. The wide-table
       * case asserts that a long field list scrolls the PAGE rather than a box, and
       * that is a property of the form as rendered — hence before.
       */
      const pageScrollHeight = page.scrollHeight;
      const pageClientHeight = page.clientHeight;
      click(runBtn);

      /*
       * A search now lands in the 浏览 tab, so what identifies the NEW result is the
       * ACTIVE TAB plus the rows in the browse grid. The old version waited for a
       * "matched N rows" line under the form, which no longer exists — the count moved
       * to the browse toolbar (共 N 行).
       */
      const browseTab = await waitFor(() => {
        const el = document.querySelector('.dbm-tab[data-active="true"]');
        return el !== null && /浏览|Browse/.test(el.textContent || '') ? el : null;
      }, 12000);
      const countLine = await waitFor(() => {
        const el = Array.from(document.querySelectorAll('.dbm-hint'))
          .find((e) => /(共|of)\\s*\\d/.test(e.textContent || ''));
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
        fieldRowCount: fieldRows.length,
        fieldBoxScrolls,
        innerClipped,
        reachAtTop,
        reachAtMid,
        reachAtBottom,
        pageScrollHeight,
        pageClientHeight,
        // The new contract: the rows are in the browse tab, and this tab is left.
        landedOnBrowse: browseTab !== null,
        // The search page's own result box must be gone entirely.
        searchPageHasOwnGrid: document.querySelector('[data-dbm-search-page] .dbm-search-results') !== null,
        filterBar: (document.querySelector('[data-dbm-browse-filters]') || {}).textContent || null,
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
  /*
   * THE FIELD LIST IS SHOWN WHOLE. No inner scroll box, and no row clipped by one.
   *
   * The regression this pins: the list had its own scroll container capped at 45% of
   * the tab, so a wide table showed a handful of rows with the rest hidden inside it.
   * The failure mode is not "a row is missing from the DOM" — every row was there and
   * addressable, which is why the earlier assertions here all passed. It is that the
   * user cannot SEE the rest, and reads the visible handful as the complete list.
   */
  check('the field list is not scrolled inside its own box', shape.fieldBoxScrolls === false, { fields: shape.fieldRowCount })
  check('no field row is clipped by an inner box', shape.innerClipped.length === 0, shape.innerClipped)
  /*
   * And the run button stays reachable while that whole list is displayed.
   *
   * These two pull against each other — a full list makes the form taller than the
   * viewport — so both have to be asserted together. Checked at three scroll
   * positions because "visible at the top of the page" is satisfied by a button that
   * then scrolls away, which is the defect this page started with.
   */
  check('the run button is visible without scrolling', shape.runReachable === true, { rect: shape.runRect, viewportH: shape.viewportH })
  check('the run button stays visible while the field list scrolls', shape.reachAtTop === true && shape.reachAtMid === true && shape.reachAtBottom === true, { top: shape.reachAtTop, mid: shape.reachAtMid, bottom: shape.reachAtBottom })
  /*
   * Running a search lands in the 浏览 tab, and this page shows no grid of its own.
   *
   * Both halves are the point: the rows must be visible somewhere the user can page
   * and sort them, and the form must not keep a second copy underneath. Asserted on the
   * ACTIVE tab because presence checks cannot tell the two arrangements apart — both
   * render a table in the document.
   */
  check('running a search lands on the 浏览 tab', shape.landedOnBrowse === true, { count: shape.countText, errors: shape.errors })
  check('the search page keeps no result grid of its own', shape.searchPageHasOwnGrid === false, null)
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

  /*
   * ---- case 7: a WIDE table, where the field list used to hide most of itself ----
   *
   * Its own case because the defect is invisible on 'items': three rows fit in the box
   * the clipping lived in, so every assertion above passed while a 25-column table
   * showed four rows. The table has 25 columns; all 25 must be visible with no inner
   * scroll box, and the run button must stay reachable while they are.
   */
  const wide = await runSearch('wide', [], 'wide')
  check('a wide table shows every field row in its own box', wide.fieldRowCount === 25, { count: wide.fieldRowCount, clipped: wide.innerClipped })
  check('the wide field list has no scroll box of its own', wide.fieldBoxScrolls === false, { fields: wide.fieldRowCount })
  check('no wide field row is clipped by an inner box', wide.innerClipped.length === 0, wide.innerClipped)
  /*
   * The list is now taller than the viewport, so the PAGE must scroll — and the run
   * button must remain reachable at every position, which is the requirement the old
   * 45% cap was there to protect.
   */
  check('a long field list scrolls the page rather than a box', wide.pageScrollHeight > wide.pageClientHeight, { scrollHeight: wide.pageScrollHeight, clientHeight: wide.pageClientHeight })
  check('the run button is reachable at top, middle and bottom', wide.reachAtTop === true && wide.reachAtMid === true && wide.reachAtBottom === true, { top: wide.reachAtTop, mid: wide.reachAtMid, bottom: wide.reachAtBottom })
  check('a wide table still runs an empty search', wide.rows.length === 1, { rows: wide.rows.length, errors: wide.errors })

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
