import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/**
 * End-to-end check of the SQL panel's editing surfaces, in a real browser.
 *
 * The unit and driver tests prove the SQL is right. What they cannot prove is
 * that the panel WIRES the gestures up: that a double-click opens an editor, that
 * a lost focus saves, that a checkbox selects a row, that the sort control offers
 * each index in both directions, and that a schema change arrives in the grid.
 * Those are DOM-event questions, so they are answered here, with real mouse and
 * keyboard events over CDP, and every write is verified by RE-READING THE SERVER
 * — a panel that showed "saved" without saving must fail.
 *
 * Two escaping hazards live in this file, and both have already cost time:
 *
 * 1. The page code is a template literal in THIS module, so a backslash inside a
 *    regex literal is consumed by the outer string: \s arrives as plain s. Use
 *    plain string methods, or a RegExp constructor with a doubled backslash.
 * 2. A dollar sign in the page code is only safe when not followed by a brace.
 *    Avoid both where possible; build URLs by concatenation.
 *
 * Run node --check AND scripts/check-template-literals.mjs after editing.
 *
 * Usage: node scripts/e2e-sql-editing.mjs <baseUrl-with-token> <sqliteFile>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9341
/**
 * The data source name this run creates, unique per run.
 *
 * Unique because the script resolves its source back BY NAME to run the API-side
 * assertions, and a fixed name made every earlier run resolve to the FIRST match —
 * a source pointing at an older database file than the one just seeded. Every
 * "verified against the server" claim was then reading the wrong database. The
 * tag also makes the run's own leftovers identifiable.
 */
const SOURCE_NAME = `E2E Edit ${process.pid}`

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-sql-editing.mjs <baseUrl-with-token> <sqliteFile>')
  process.exit(2)
}

/** Helpers injected into the page. */
const PRELUDE = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byText = (sel, text) =>
  Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
const byIncludes = (sel, text) =>
  Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
const waitFor = async (fn, ms) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(120);
  }
};
/** Set a controlled input's value so React's onChange sees it. */
const setInput = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
/** Set a select's value so React's onChange sees it. */
const setSelect = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
const dblclick = (el) => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
};
/**
 * Take focus away the way a user does: move it to a DIFFERENT element.
 *
 * Moving real focus is the whole point. A synthetic blur or focusout event does
 * NOT update document.activeElement, and measured, the panel sent no request for
 * one while the real gesture saves — so an approximated handler reports a product
 * bug that does not exist.
 */
const blur = (el) => {
  el.focus();
  const away = document.createElement('button');
  away.setAttribute('data-dbm-blur-target', '');
  away.style.position = 'fixed';
  away.style.left = '-9999px';
  document.body.appendChild(away);
  away.focus();
  away.remove();
};
/** A browse-grid cell, located by its data attribute. */
const cellAt = (row, column) => document.querySelector('[data-dbm-cell="' + row + ':' + column + '"]');
/** Call the plugin's API, reporting a non-OK response as a thrown error. */
const api = async (path) => {
  const response = await fetch(path);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error('API ' + path + ' answered ' + response.status + ': ' + (body && body.error ? body.error : 'no body'));
  }
  return body;
};
`
void PRELUDE

/**
 * The browser launcher, debugger lookup and CDP session.
 *
 * Kept outside the flow so the flow stays about the panel.
 */
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

/**
 * Seed the SQLite file the flow drives.
 *
 * Enough rows that a second page EXISTS at the smallest page size (50): a
 * go-to-page control cannot be verified against a single-page table.
 */
function seed(file) {
  const db = new DatabaseSync(file)
  db.exec('DROP TABLE IF EXISTS people')
  db.exec('DROP TABLE IF EXISTS notes')
  db.exec(
    'CREATE TABLE people (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  name TEXT NOT NULL,' +
    '  age INTEGER,' +
    '  active BOOLEAN DEFAULT 1,' +
    '  joined DATE,' +
    '  bio TEXT,' +
    "  kind TEXT DEFAULT 'user'" +
    ')',
  )
  db.exec("INSERT INTO people(name, age, active, joined, bio, kind) VALUES ('alice', 30, 1, '2024-01-05', 'first', 'user')")
  db.exec("INSERT INTO people(name, age, active, joined, bio, kind) VALUES ('bob', 40, 0, '2024-02-06', NULL, 'admin')")
  db.exec("INSERT INTO people(name, age, active, joined, bio, kind) VALUES ('carol', 50, 1, '2024-03-07', 'third ok', 'user')")
  const insert = db.prepare('INSERT INTO people(name, age, active, joined, bio, kind) VALUES (?, ?, 1, ?, NULL, ?)')
  for (let n = 0; n < 60; n++) insert.run(`filler${String(n).padStart(3, '0')}`, 20 + n, '2024-04-01', 'user')
  db.exec('CREATE INDEX idx_people_name ON people(name)')
  // A table with no primary key, to prove row editing and batch delete are
  // refused there rather than acting on the wrong rows.
  db.exec('CREATE TABLE notes(body TEXT, tag TEXT)')
  db.exec("INSERT INTO notes VALUES ('n1', 'x'), ('n2', 'y')")
  db.close()
}

/** Launch headless Edge with a throwaway profile. */
function launchBrowser() {
  const profile = mkdtempSync(join(tmpdir(), 'dbm-e2e-'))
  const child = spawn(EDGE, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=msEdgeSidebarV2',
    'about:blank',
  ], { stdio: 'ignore' })
  return { child, profile }
}

/**
 * The DevTools websocket for a PAGE target.
 *
 * Not the /json/version endpoint, which is the BROWSER level: it accepts no
 * Page.* command at all, so a session opened against it cannot navigate.
 */
async function debuggerUrl() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      const page = list.find(entry => entry.type === 'page' && typeof entry.webSocketDebuggerUrl === 'string')
      if (page !== undefined) return page.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('the debugger endpoint never came up')
}

/**
 * The page-side flow, as one awaited promise.
 *
 * A module-level template literal so this module substitutes the SQLite path
 * while everything the page computes stays plain script. The report's failures
 * list is the verdict: the process exits non-zero when it is non-empty.
 */
const FLOW = `(async () => {
${PRELUDE}
  const report = { steps: [], failures: [] };
  const step = (name, detail) => report.steps.push({ name, detail: detail === undefined ? null : detail });
  const fail = (name, detail) => report.failures.push({ name, detail });
  const check = (name, ok, detail) => { if (ok) step(name, detail); else fail(name, detail); };

  try {
    const sqlitePath = ${JSON.stringify(sqliteFile)};

    // ---- open the panel and create the data source ------------------------
    const row = await waitFor(
      () => Array.from(document.querySelectorAll('nav button[aria-label]'))
        .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())),
      20000,
    );
    if (!row) { fail('the sidebar row never rendered'); return JSON.stringify(report, null, 2); }
    click(row);
    if (!(await waitFor(() => document.querySelector('.dbm-root'), 10000))) {
      fail('the panel did not mount after clicking the row');
      return JSON.stringify(report, null, 2);
    }
    step('panel mounted');

    const newBtn = await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000);
    if (!newBtn) { fail('no New database button'); return JSON.stringify(report, null, 2); }
    click(newBtn);
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    if (!modal) { fail('the create dialog did not open'); return JSON.stringify(report, null, 2); }
    const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
    setInput(inputs[0], ${JSON.stringify(SOURCE_NAME)});
    setInput(inputs.find((i) => (i.getAttribute('placeholder') || '').includes('D:/data')), sqlitePath);
    await sleep(200);
    click(byText('.dbm-modal-foot .dbm-btn', '保存') || byText('.dbm-modal-foot .dbm-btn', 'Save'));

    const listed = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(SOURCE_NAME)}), 10000);
    if (!listed) { fail('the created source is not listed'); return JSON.stringify(report, null, 2); }

    /*
     * The id the API assertions read, resolved by this run's UNIQUE name.
     *
     * Exactly one match is required. Falling back to the first entry with a
     * matching name is what silently ran earlier runs' assertions against an older
     * database file — the failure mode that makes an E2E result worse than none.
     */
    const sources = await api('/api/dsh-database/sources');
    const matches = sources.sources.filter((s) => s.name === ${JSON.stringify(SOURCE_NAME)});
    if (matches.length !== 1) {
      fail('the data source of this run did not resolve to exactly one entry', matches.map((s) => s.id + ' -> ' + s.file));
      return JSON.stringify(report, null, 2);
    }
    const sourceId = matches[0].id;
    // The file it points at must be the one THIS run seeded, or the assertions
    // below would be about a different database.
    report.sourceFile = matches[0].file;
    if (matches[0].file !== sqlitePath) {
      fail('the resolved source points at a different file than the seeded one', { expected: sqlitePath, actual: matches[0].file });
      return JSON.stringify(report, null, 2);
    }
    step('resolved the source id', sourceId);

    // ---- requirement 2: the group name is a column of the list -----------
    report.listHeaders = Array.from(document.querySelectorAll('.dbm-table thead th')).map((th) => th.textContent.trim());
    check('the list shows a 分组 column', report.listHeaders.includes('分组') || report.listHeaders.includes('Group'), report.listHeaders);

    // ---- requirement 3: the engine line is gone from the header ----------
    const header = document.querySelector('.dbm-header');
    check('the header no longer spells out the engines', !header.textContent.includes('引擎') && !header.textContent.includes('Engines'), header.textContent.trim());

    // ---- connect ---------------------------------------------------------
    const connectBtn = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn'))
      .find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
    if (!connectBtn) { fail('no Connect button on the created row'); return JSON.stringify(report, null, 2); }
    click(connectBtn);

    const peopleRow = await waitFor(() => byIncludes('.dbm-side-body .dbm-tree-item', 'people'), 15000);
    if (!peopleRow) {
      fail('the table tree never appeared', (document.querySelector('.dbm-error') || {}).textContent);
      return JSON.stringify(report, null, 2);
    }
    click(peopleRow);

    // ---- requirement 4 + 7: the browse grid ------------------------------
    const grid = await waitFor(() => document.querySelector('.dbm-data'), 12000);
    if (!grid) {
      fail('the browse grid never rendered', (document.querySelector('.dbm-error') || {}).textContent);
      return JSON.stringify(report, null, 2);
    }
    step('browse grid rendered');
    report.gridHeaders = Array.from(document.querySelectorAll('.dbm-data thead th')).map((th) => th.textContent.trim());
    check('the grid has an actions column', report.gridHeaders.includes('操作') || report.gridHeaders.includes('Actions'), report.gridHeaders);
    check('the grid has a select column', document.querySelector('.dbm-data th.dbm-select-col') !== null);

    // ---- requirement 6: the sort mark is smaller than the header ---------
    const sortButton = byIncludes('.dbm-data thead th button', 'name');
    if (!sortButton) {
      fail('no sortable header button found');
    } else {
      click(sortButton);
      const mark = await waitFor(() => sortButton.querySelector('.dbm-sort-mark'), 5000);
      if (!mark) {
        fail('the sort mark never appeared after clicking the header');
      } else {
        const markSize = parseFloat(getComputedStyle(mark).fontSize);
        const headerSize = parseFloat(getComputedStyle(sortButton).fontSize);
        check('the sort mark is smaller than the header', markSize < headerSize, { markSize, headerSize });
      }
    }

    // ---- requirement 5: sort by an index, both directions as entries -----
    const sortSelect = Array.from(document.querySelectorAll('.dbm-row .dbm-select'))
      .find((s) => Array.from(s.options).some((o) => o.textContent.includes('idx_people_name')));
    if (!sortSelect) {
      fail('no index sort control found', Array.from(document.querySelectorAll('.dbm-row .dbm-select')).map((s) => Array.from(s.options).map((o) => o.textContent.trim())));
    } else {
      const labels = Array.from(sortSelect.options).map((o) => o.textContent.trim());
      report.sortOptions = labels;
      const ascEntry = labels.find((l) => l.startsWith('idx_people_name (') && (l.includes('递增') || l.toLowerCase().includes('asc')));
      const descEntry = labels.find((l) => l.startsWith('idx_people_name (') && (l.includes('递减') || l.toLowerCase().includes('desc')));
      check('the index is offered in both directions', ascEntry !== undefined && descEntry !== undefined, labels);
      check('the primary key is offered first', (labels[0] || '').startsWith('PRIMARY ('), labels[0]);
      check('「无」 is the last entry', ['无', 'None'].includes(labels[labels.length - 1] || ''), labels[labels.length - 1]);
      // A separate direction toggle is what was asked to be removed: with both
      // directions in the list there is nothing left for one to do.
      const directionButtons = Array.from(document.querySelectorAll('.dbm-row .dbm-btn'))
        .map((b) => (b.textContent || '').trim())
        .filter((text) => ['递增', '递减', '升序', '降序', 'asc', 'desc'].includes(text));
      check('no separate direction button remains', directionButtons.length === 0, directionButtons);

      // Read the grid's first cell, whatever the sort produced.
      const firstCell = async () => {
        await sleep(900);
        const tr = document.querySelector('.dbm-data tbody tr');
        return tr === null ? null : (tr.textContent || '').trim();
      };
      const ascOption = Array.from(sortSelect.options).find((o) => o.textContent.trim() === ascEntry);
      setSelect(sortSelect, ascOption.value);
      const ascFirst = await firstCell();
      const descOption = Array.from(sortSelect.options).find((o) => o.textContent.trim() === descEntry);
      setSelect(sortSelect, descOption.value);
      const descFirst = await firstCell();
      report.sortOrders = { ascFirst, descFirst };
      check('ascending and descending give different first rows', ascFirst !== null && descFirst !== null && ascFirst !== descFirst, report.sortOrders);
    }

    // ---- requirement 7: double-click a cell, edit, blur, verify SERVER ---
    // alice's OWN row, found by her value: the grid may be sorted, so row 0 is
    // not a fixed row.
    const aliceIndex = Array.from(document.querySelectorAll('.dbm-data tbody tr'))
      .findIndex((tr) => (tr.textContent || '').includes('alice'));
    const target = aliceIndex === -1 ? null : cellAt(aliceIndex, 'name');
    if (!target) {
      fail('no editable cell found for alice');
    } else {
      dblclick(target);
      const editor = await waitFor(() => document.querySelector('.dbm-data input.dbm-cell-input'), 5000);
      if (!editor) {
        fail('the double-click did not open an editor');
      } else {
        step('the double-click opened an in-cell editor', editor.value);
        setInput(editor, 'alice-edited');
        // Record the writes the panel attempts, so a missing save can be told
        // apart from one that went somewhere else.
        report.editTraffic = [];
        const originalFetch = window.fetch;
        window.fetch = function (input, init) {
          if (init && init.method && init.method !== 'GET') {
            report.editTraffic.push(init.method + ' ' + String(input).split('/api/dsh-database/')[1]);
          }
          return originalFetch.apply(this, arguments);
        };
        blur(editor);
        await sleep(1500);
        window.fetch = originalFetch;
        // Polled: the write and the re-read are two round trips.
        let names = [];
        for (let attempt = 0; attempt < 25; attempt++) {
          names = (await api('/api/dsh-database/sources/' + sourceId + '/rows?table=people&page=1&pageSize=200&mode=browse')).page.rows.map((r) => r.name);
          if (names.includes('alice-edited')) break;
          await sleep(300);
        }
        report.afterEdit = names;
        check('the edited cell reached the server', names.includes('alice-edited'), { traffic: report.editTraffic, rows: names.length });
      }
    }

    // ---- requirement 4: multi-select and the batch bar -------------------
    const boxes = Array.from(document.querySelectorAll('.dbm-data td.dbm-select-col input[type=checkbox]'));
    check('every row has a selection checkbox', boxes.length >= 3, boxes.length);
    if (boxes.length >= 2) {
      click(boxes[0]);
      click(boxes[1]);
      const bar = await waitFor(() => document.querySelector('.dbm-batch-bar'), 5000);
      check('the batch bar appears with a selection', bar !== null, bar ? bar.textContent.trim() : null);
    }

    // ---- requirement 4: go to a page by number ---------------------------
    const jump = document.querySelector('[data-dbm-page-jump]');
    check('the pager has a go-to-page field', jump !== null);
    if (jump) {
      const sizeSelect = Array.from(document.querySelectorAll('.dbm-row .dbm-select'))
        .find((s) => Array.from(s.options).some((o) => o.value === '50'));
      if (!sizeSelect) {
        fail('no page-size select found to make a second page');
      } else {
        setSelect(sizeSelect, '50');
        await sleep(1000);
        report.pagerText = document.querySelector('.dbm-pager').textContent.trim();
        setInput(jump, '2');
        jump.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(1200);
        report.afterJump = document.querySelector('.dbm-pager').textContent.trim();
        check('the jump moved to page 2', report.afterJump.includes('第 2') || report.afterJump.includes('Page 2'), report.afterJump);
        // An out-of-range page is refused with the range, not silently clamped.
        setInput(jump, '999');
        jump.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(600);
        const rangeError = Array.from(document.querySelectorAll('.dbm-cell-failed')).map((el) => el.textContent.trim());
        check('an out-of-range page is refused with the range', rangeError.length > 0, rangeError);
      }
    }

    // ---- requirement 10: the insert tab gives per-type controls ----------
    const insertTab = byText('.dbm-tab', '插入') || byText('.dbm-tab', 'Insert');
    click(insertTab);
    await sleep(1200);
    const kindInput = document.querySelector('[data-dbm-insert-for$=":kind"]');
    const joinedInput = document.querySelector('[data-dbm-insert-for$=":joined"]');
    const activeInput = document.querySelector('[data-dbm-insert-for$=":active"]');
    report.insertControls = {
      kind: kindInput ? kindInput.tagName + (kindInput.type ? ':' + kindInput.type : '') : null,
      joined: joinedInput ? joinedInput.tagName + (joinedInput.type ? ':' + joinedInput.type : '') : null,
      active: activeInput ? activeInput.tagName + (activeInput.type ? ':' + activeInput.type : '') : null,
    };
    // SQLite has no enum type: its members exist only on MySQL, which reports
    // them on the wire, so the expected control differs by engine.
    if (report.insertControls.kind !== null && report.insertControls.kind.startsWith('SELECT')) {
      step('an enum column gets a select', report.insertControls.kind);
    } else {
      check('a text column gets a text control', report.insertControls.kind === 'TEXTAREA:textarea' || report.insertControls.kind === 'INPUT:text', report.insertControls);
    }
    check('a date column gets a date input', report.insertControls.joined === 'INPUT:date', report.insertControls);
    check('a boolean column gets a select', report.insertControls.active !== null && report.insertControls.active.startsWith('SELECT'), report.insertControls);

    const nameInput = document.querySelector('[data-dbm-insert-for$=":name"]');
    if (!nameInput) {
      fail('the insert form has no name field');
    } else {
      setInput(nameInput, 'inserted-by-form');
      setInput(document.querySelector('[data-dbm-insert-for$=":age"]'), '7');
      // Two buttons both start with 插入, so the first is picked by exact text.
      const insertBtn = byText('.dbm-tab-body .dbm-btn', '插入') || byText('.dbm-tab-body .dbm-btn', 'Insert');
      if (!insertBtn) fail('no insert button');
      else click(insertBtn);
      await sleep(2200);
      report.insertNotice = (document.querySelector('.dbm-ok') || {}).textContent || null;
      let afterInsert = [];
      for (let attempt = 0; attempt < 25; attempt++) {
        afterInsert = (await api('/api/dsh-database/sources/' + sourceId + '/rows?table=people&page=1&pageSize=200&mode=browse')).page.rows.map((r) => r.name);
        if (afterInsert.includes('inserted-by-form')) break;
        await sleep(300);
      }
      report.afterInsert = afterInsert.length;
      check('the form insert reached the server', afterInsert.includes('inserted-by-form'), afterInsert.length);
    }

    // ---- requirement 8: the structure tab --------------------------------
    const structureTab = byText('.dbm-tab', '结构') || byText('.dbm-tab', 'Structure');
    click(structureTab);
    await sleep(1400);
    const addColumn = await waitFor(() => byIncludes('.dbm-btn', '新增列') || byIncludes('.dbm-btn', 'Add column'), 5000);
    check('the structure tab offers adding a column', addColumn !== null);
    check('the structure tab offers editing the key', (byIncludes('.dbm-btn', '编辑主键') || byIncludes('.dbm-btn', 'Edit key')) !== null);
    check('the structure tab offers adding an index', (byIncludes('.dbm-btn', '新增索引') || byIncludes('.dbm-btn', 'Add index')) !== null);
    check('the structure tab offers a distinct count per column', (byIncludes('.dbm-link', '非重复值') || byIncludes('.dbm-link', 'Distinct')) !== null);
    check('the structure tab offers dropping a column', (byIncludes('.dbm-btn', '删除') || byIncludes('.dbm-btn', 'Drop')) !== null);

    if (addColumn) {
      click(addColumn);
      const editor = await waitFor(() => document.querySelector('.dbm-struct-editor'), 5000);
      if (!editor) {
        fail('the add-column editor did not open');
      } else {
        step('the add-column editor opened');
        setInput(editor.querySelector('input.dbm-input'), 'added_col');
        click(byIncludes('.dbm-struct-editor .dbm-btn', '新增') || byIncludes('.dbm-struct-editor .dbm-btn', 'Add'));
        await sleep(2000);
        report.afterAddColumn = (await api('/api/dsh-database/sources/' + sourceId + '/columns?table=people')).columns.map((c) => c.name);
        check('the added column reached the server', report.afterAddColumn.includes('added_col'), report.afterAddColumn);
      }
    }

    // ---- requirement 1: clicking the database returns to its table list --
    const dbNode = document.querySelector('.dbm-side-body .dbm-tree-item[data-active]');
    if (!dbNode) {
      fail('no active database node found');
    } else {
      click(dbNode);
      await sleep(1400);
      report.backToOverview = {
        hasTableList: byIncludes('.dbm-table thead', '行数') !== null || byIncludes('.dbm-table thead', 'Rows') !== null,
        tabsGone: document.querySelector('.dbm-tabs') === null,
      };
      check('clicking the database returns to its table list', report.backToOverview.hasTableList, report.backToOverview);
      check('the table tabs are gone on the database overview', report.backToOverview.tabsGone === true, report.backToOverview);
    }

    // The 搜索 tab is verified by e2e-sql-search.mjs instead: its form is a
    // controlled input, and a synthetic input event leaves React's state empty, so
    // that script types with CDP's Input.insertText.
    report.searchVerifiedBy = 'e2e-sql-search.mjs';
  } catch (error) {
    // A thrown step must not discard the steps that already ran: the report is
    // what locates the failure.
    fail('the flow threw', String(error && error.stack ? error.stack : error));
  }
  return JSON.stringify(report, null, 2);
})()`

const { child, profile } = launchBrowser()
let session
try {
  /*
   * Check the generated page code before handing it to the browser.
   *
   * The flow is assembled from a template literal in this module, so a stray
   * backslash or an unescaped quote produces a script that is merely INVALID —
   * the failure then arrives as a "page threw" with a position inside the injected
   * text, which points at the generated code rather than at the line in this file
   * that mangled it. Parsing it here turns that into a clear local error.
   */
  try {
    // eslint-disable-next-line no-new-func
    new Function(`return ${FLOW}`)
  } catch (error) {
    console.error('the generated page script is not valid JavaScript:')
    console.error(error instanceof Error ? error.message : String(error))
    console.error('Check for an unescaped quote or backslash in the FLOW literal.')
    process.exit(2)
  }

  const url = await debuggerUrl()
  const socket = new WebSocket(url, { maxPayload: 64 * 1024 * 1024 })
  await new Promise((resolve, reject) => {
    socket.on('open', resolve)
    socket.on('error', reject)
  })
  session = new Session(socket)
  await session.send('Page.enable')
  await session.send('Runtime.enable')
  /*
   * Make the headless page behave as a FOCUSED window.
   *
   * Without this a real focus move fires no blur event at all: measured, a plain
   * blur or focusout listener stayed silent when focus moved to another element,
   * because the page was never the active window. The panel's in-cell editor saves
   * on blur, so without this the flow would report "the edit never reached the
   * server" for a product that works.
   */
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })

  seed(sqliteFile)

  await session.send('Page.navigate', { url: baseUrl })
  await new Promise(resolve => setTimeout(resolve, 4500))

  const raw = await session.evaluate(FLOW)
  const report = JSON.parse(raw)
  console.log(JSON.stringify(report, null, 2))

  const failures = Array.isArray(report.failures) ? report.failures : []
  console.log(`\n${report.steps.length} checks passed, ${failures.length} failed`)
  if (report.fatal !== undefined) console.error(`fatal: ${report.fatal}`)
  if (failures.length > 0 || report.fatal !== undefined) process.exitCode = 1
} finally {
  /*
   * Delete the data source this run created.
   *
   * Left behind, one source per run accumulated in the user's own configuration —
   * 41 had built up before this was noticed, which is both clutter and the cause
   * of the name-resolution bug above. Deleting by the run's unique id removes only
   * this run's entry.
   */
  try {
    const sources = await (await fetch(`${baseUrl.replace(/\/\?.*$/, '')}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name === SOURCE_NAME)) {
      await fetch(`${baseUrl.replace(/\/\?.*$/, '')}/api/dsh-database/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' })
      console.error(`note: removed the run's data source (${source.id})`)
    }
  } catch (error) {
    console.error(`note: the run's data source could not be removed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (session !== undefined) {
    try {
      await session.send('Browser.close')
    } catch {
      /* the socket may already be gone */
    }
  }
  child.kill()
  await new Promise(resolve => setTimeout(resolve, 1000))
  /*
   * The throwaway profile is best effort.
   *
   * Edge keeps a few of its own files open after the process is gone (measured:
   * Default/Collections/collectionsSQLite answers EBUSY), and a failing cleanup
   * would replace the run's actual result with a filesystem error the reader has
   * to see past. The directory is under the system temp dir.
   */
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  } catch {
    console.error(`note: the throwaway browser profile could not be removed: ${profile}`)
  }
}
