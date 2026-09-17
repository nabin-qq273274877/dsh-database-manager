/**
 * End-to-end browser check of the editing surfaces this plugin gained.
 *
 * The unit and driver tests prove the SQL is right. What they cannot prove is
 * that the panel WIRES the gestures up: that a double-click opens an editor, that
 * a lost focus saves, that a checkbox selects a row, that the sort mark appears
 * where the header was clicked, and that a schema change arrives in the grid.
 * Those are DOM-event questions, so they are answered in a real browser with real
 * mouse and keyboard events over CDP.
 *
 * The script drives a live dsh web UI and asserts on the SERVER'S state where a
 * write is involved — after editing a cell it re-reads the database file through
 * the API, so a panel that showed "saved" without saving fails.
 *
 * Usage: node scripts/e2e-sql-editing.mjs <baseUrl-with-token> <sqliteFile>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9341

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-sql-editing.mjs <baseUrl-with-token> <sqliteFile>')
  process.exit(2)
}

/** Helpers injected into every evaluated snippet. */
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
const setInput = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
const dblclick = (el) => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
};
/**
 * Take focus away from an element the way a user does.
 *
 * Moving real focus is the whole point. A synthetic blur or focusout event
 * does NOT update document.activeElement, and measured, the panel sent no
 * request for one while the real gesture saves — so a handler approximated that
 * way reports a product bug that does not exist.
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
/** A cell of the browse grid, located by its data attribute. */
const cellAt = (row, column) => document.querySelector('[data-dbm-cell="' + row + ':' + column + '"]');
/**
 * Call the plugin's own API from the page.
 *
 * It reports a non-OK response as a thrown error rather than returning a body
 * with no fields: a 401 or 404 body has no page field, and the resulting
 * "Cannot read properties of undefined" would point at the assertion instead of
 * at the request that actually failed.
 */
const api = async (path) => {
  const response = await fetch(path);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error('API ' + path + ' answered ' + response.status + ': ' + (body && body.error ? body.error : 'no body'));
  }
  return body;
};
/**
 * The data source this run created, by id.
 *
 * Looked up by NAME and failing loudly when it is absent: falling back to the
 * first source would silently run the later assertions against a different
 * database, which is the failure mode that makes an E2E result worse than none.
 */
const resolveSource = async () => {
  const body = await api('/api/dsh-database/sources');
  const found = body.sources.find((s) => s.name === 'E2E Edit');
  if (!found) throw new Error('the E2E data source is missing; an earlier step did not create it');
  return found.id;
};
`

/** Seed the SQLite file with the tables the flow needs. */
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
    "  bio TEXT," +
    "  kind TEXT DEFAULT 'user'" +
    ')',
  )
  db.exec("INSERT INTO people(name, age, active, joined, bio, kind) VALUES ('alice', 30, 1, '2024-01-05', 'first', 'user')")
  db.exec("INSERT INTO people(name, age, active, joined, bio, kind) VALUES ('bob', 40, 0, '2024-02-06', NULL, 'admin')")
  db.exec("INSERT INTO people(name, age, active, joined, bio, kind) VALUES ('carol', 50, 1, '2024-03-07', 'third; ok', 'user')")
  /*
   * Enough rows that a second page EXISTS at the page sizes the panel offers.
   *
   * The smallest size is 50, so a table of three rows has one page — and a
   * go-to-page control cannot be verified against a single-page table: the
   * assertion would pass whether or not the jump worked.
   */
  const insert = db.prepare('INSERT INTO people(name, age, active, joined, bio, kind) VALUES (?, ?, 1, ?, NULL, ?)')
  for (let n = 0; n < 60; n++) insert.run(`filler${String(n).padStart(3, '0')}`, 20 + n, '2024-04-01', 'user')
  db.exec('CREATE INDEX idx_people_name ON people(name)')
  // A table with no primary key, to prove row editing and batch delete are
  // refused there rather than silently acting on the wrong rows.
  db.exec('CREATE TABLE notes(body TEXT, tag TEXT)')
  db.exec("INSERT INTO notes VALUES ('n1', 'x'), ('n2', 'y')")
  db.close()
}

/** Read the database file directly, so a write is verified at the source. */
function readAll(file, table) {
  const db = new DatabaseSync(file)
  const rows = db.prepare(`SELECT * FROM ${table}`).all()
  db.close()
  return rows.map(row => ({ ...row }))
}

/** Launch headless Edge with a fresh profile. */
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
 * Page.* command at all ("Page.enable was not found"), so a session opened
 * against it cannot navigate or evaluate anything.
 */
async function debuggerUrl() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      const targets = await response.json()
      const page = targets.find(target => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string')
      if (page !== undefined) return page.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('the debugger endpoint never came up')
}

/** A minimal CDP session: send a command and await its reply. */
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

  /** Evaluate an expression in the page and return its JSON value. */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails !== undefined) {
      throw new Error(`page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result.value
  }
}

/**
 * The whole flow, run as one awaited promise inside the page.
 *
 * A module-level template literal rather than an inline argument: this module
 * substitutes the dollar-brace form here (the SQLite path), while what the page
 * compute itself is plain script, so the two cannot be confused.
 */
const FLOW = `(async () => {
${PRELUDE}
  const report = { steps: [], failures: [] };
  const step = (name, detail) => report.steps.push({ name, detail: detail === undefined ? null : detail });
  const fail = (name, detail) => report.failures.push({ name, detail });

  /** Assert a condition, recording the outcome instead of throwing. */
  const check = (name, ok, detail) => { if (ok) step(name, detail); else fail(name, detail); };

  try {
    // ---- reach the panel and create the data source ------------------------
    const row = await waitFor(
      () => Array.from(document.querySelectorAll('nav button[aria-label]'))
        .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())),
      20000,
    );
    if (!row) return JSON.stringify({ ...report, fatal: 'sidebar row never rendered' });
    click(row);
    if (!(await waitFor(() => document.querySelector('.dbm-root'), 10000))) {
      return JSON.stringify({ ...report, fatal: 'panel did not mount' });
    }

    const newBtn = await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000);
    click(newBtn);
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
    const sqlitePath = ${JSON.stringify(sqliteFile)};
    setInput(inputs[0], 'E2E Edit');
    setInput(inputs.find((i) => (i.getAttribute('placeholder') || '').includes('D:/data')), sqlitePath);
    await sleep(200);
    click(byText('.dbm-modal-foot .dbm-btn', '保存') || byText('.dbm-modal-foot .dbm-btn', 'Save'));

    const listed = await waitFor(() => byIncludes('.dbm-table td', 'E2E Edit'), 10000);
    if (!listed) return JSON.stringify({ ...report, fatal: 'created source not listed' });

    // The id the later API assertions read, resolved by name so it cannot silently
    // point at somebody else's data source.
    const sourceId = await resolveSource();
    step('resolved the source id', sourceId);

    // ---- requirement 2: the group name is a column of the list -------------
    report.listHeaders = Array.from(document.querySelectorAll('.dbm-table thead th')).map((th) => th.textContent.trim());
    check('list shows a 分组 column', report.listHeaders.some((h) => h === '分组' || h === 'Group'), report.listHeaders);

    // ---- requirement 3: the engine line is gone from the header ------------
    const header = document.querySelector('.dbm-header');
    check('header no longer spells out the engines', !/引擎|Engines/.test(header.textContent), header.textContent.trim());

    // ---- connect -----------------------------------------------------------
    const connectBtn = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn'))
      .find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
    if (!connectBtn) return JSON.stringify({ ...report, fatal: 'no Connect button on the created row' });
    click(connectBtn);
    step('connect clicked');

    const peopleRow = await waitFor(() => byIncludes('.dbm-side-body .dbm-tree-item', 'people'), 15000);
    if (!peopleRow) {
      const err = document.querySelector('.dbm-error');
      return JSON.stringify({ ...report, fatal: 'table tree never appeared', error: err ? err.textContent : null });
    }
    click(peopleRow);

    // ---- requirement 4 + 7: the browse grid, its row actions and in-cell edit
    const grid = await waitFor(() => document.querySelector('.dbm-data'), 10000);
    if (!grid) {
      const err = document.querySelector('.dbm-error');
      return JSON.stringify({ ...report, fatal: 'browse grid never rendered', error: err ? err.textContent : null });
    }
    step('browse grid rendered');
    report.gridHeaders = Array.from(document.querySelectorAll('.dbm-data thead th')).map((th) => th.textContent.trim());
    check('grid has an actions column', report.gridHeaders.includes('操作') || report.gridHeaders.includes('Actions'), report.gridHeaders);
    check('grid has a select column', document.querySelector('.dbm-data td.dbm-select-col') !== null ||
      document.querySelector('.dbm-data thead th.dbm-select-col') !== null);

    // requirement 6: the sort mark is smaller than the header text
    const sortButton = byIncludes('.dbm-data thead th button', 'name');
    if (sortButton) {
      click(sortButton);
      const mark = await waitFor(() => sortButton.querySelector('.dbm-sort-mark'), 5000);
      if (mark) {
        const markSize = parseFloat(getComputedStyle(mark).fontSize);
        const headerSize = parseFloat(getComputedStyle(sortButton).fontSize);
        check('sort mark is smaller than the header', markSize < headerSize, { markSize, headerSize });
      } else {
        fail('sort mark never appeared after clicking the header');
      }
    } else {
      fail('no sortable header button found');
    }

    // requirement 5: sort by an index
    const sortSelect = Array.from(document.querySelectorAll('.dbm-toolbar .dbm-select, .dbm-row .dbm-select'))
      .find((s) => Array.from(s.options).some((o) => /idx_people_name|按主键排序|Sort by key/.test(o.textContent)));
    if (sortSelect) {
      const indexOption = Array.from(sortSelect.options).find((o) => o.textContent.includes('idx_people_name'));
      check('the index is offered as a sort', indexOption !== undefined, Array.from(sortSelect.options).map((o) => o.textContent.trim()));
      if (indexOption) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sortSelect, indexOption.value);
        sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(800);
        const names = Array.from(document.querySelectorAll('.dbm-data tbody tr')).map((tr) => (tr.textContent || '').trim());
        check('rows came back after sorting by the index', names.length > 0, names.length);
      }
    } else {
      fail('no index sort control found');
    }

    // requirement 7: double-click a cell, edit it, blur, and verify the SERVER
    /*
     * alice's OWN row, found by her value rather than by position.
     *
     * The grid may be sorted by the index from the previous step, so row 0 is
     * not a fixed row: editing "whatever is first" would make the assertion
     * depend on the sort order instead of on the edit.
     */
    const aliceRow = Array.from(document.querySelectorAll('.dbm-data tbody tr'))
      .findIndex((tr) => (tr.textContent || '').includes('alice'));
    const target = aliceRow === -1 ? null : cellAt(aliceRow, 'name');
    if (!target) {
      fail('no editable cell found for alice');
    } else {
      dblclick(target);
      const editor = await waitFor(() => document.querySelector('.dbm-data input.dbm-cell-input'), 5000);
      if (!editor) {
        fail('double-click did not open an editor');
      } else {
        step('double-click opened an in-cell editor', editor.value);
        // Record every write the panel attempts, so a missing save can be told
        // apart from a save that reached the wrong place.
        report.editTraffic = [];
        const originalFetch = window.fetch;
        window.fetch = function (input, init) {
          const url = String(input);
          if (init && init.method && init.method !== 'GET') {
            report.editTraffic.push({ url: url.split('/api/dsh-database/')[1], method: init.method, body: String(init.body || '') });
          }
          return originalFetch.apply(this, arguments);
        };
        setInput(editor, 'alice-edited');
        report.editorValueAfterTyping = editor.value;
        blur(editor);
        await sleep(1500);
        window.fetch = originalFetch;
        report.cellInputPresent = document.querySelector('.dbm-data input.dbm-cell-input') !== null;
        // Why the save did not happen: the panel reports the reason it refused.
        report.editErrors = Array.from(document.querySelectorAll('.dbm-error')).map((el) => el.textContent.trim());
        report.editNotices = Array.from(document.querySelectorAll('.dbm-ok')).map((el) => el.textContent.trim());
        // The row the editor belonged to, and the key the panel holds for it.
        report.primaryKeySeen = (await api('/api/dsh-database/sources/' + sourceId + '/rows?table=people&page=1&pageSize=1&mode=browse')).page.primaryKey;
        report.afterEdit = (await api(\`/api/dsh-database/sources/\${sourceId}/rows?table=people&page=1&pageSize=200&mode=browse\`)).page.rows.map((r) => r.name);
        check('the edited cell reached the server', report.afterEdit.includes('alice-edited'), report.afterEdit);
      }
    }

    // requirement 4: multi-select and the batch bar
    const boxes = Array.from(document.querySelectorAll('.dbm-data td.dbm-select-col input[type=checkbox]'));
    check('every row has a selection checkbox', boxes.length >= 3, boxes.length);
    if (boxes.length >= 2) {
      click(boxes[0]);
      click(boxes[1]);
      const bar = await waitFor(() => document.querySelector('.dbm-batch-bar'), 5000);
      check('the batch bar appears with a selection', bar !== null, bar ? bar.textContent.trim() : null);
    }

    // requirement 4: page jump
    const jump = document.querySelector('[data-dbm-page-jump]');
    check('the pager has a go-to-page field', jump !== null);
    if (jump) {
      // The 50-row page size, because the smallest offered size leaves the seeded
      // table with more than one page - a jump cannot be verified on one page.
      const sizeSelect = Array.from(document.querySelectorAll('.dbm-row .dbm-select'))
        .find((s) => Array.from(s.options).some((o) => o.value === '50'));
      if (sizeSelect) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sizeSelect, '50');
        sizeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(1000);
        report.pagerText = document.querySelector('.dbm-pager').textContent.trim();
        setInput(jump, '2');
        jump.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(1200);
        report.afterJump = document.querySelector('.dbm-pager').textContent.trim();
        /*
         * Built with RegExp rather than a literal on purpose.
         *
         * This page code travels inside a template literal, so a backslash in a
         * regex LITERAL is consumed by the outer string and the pattern silently
         * changes meaning ("第s*2" instead of "第\\s*2"). A constructor takes a
         * plain string, where the escaping is unambiguous.
         */
        check('the jump moved to page 2', new RegExp('第\\\\s*2\\\\s*/|Page\\\\s*2\\\\s*/').test(report.afterJump), report.afterJump);
        // An out-of-range page is refused with the range, not silently clamped.
        setInput(jump, '999');
        jump.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(600);
        const rangeError = Array.from(document.querySelectorAll('.dbm-cell-failed')).map((el) => el.textContent.trim());
        check('an out-of-range page is refused with the range', rangeError.length > 0, rangeError);
      } else {
        fail('no page-size select found to make a second page');
      }
    }

    /*
     * The 搜索 tab is verified by 'e2e-sql-search.mjs' instead.
     *
     * Its form is a controlled input, and setting one via the native value setter
     * plus a synthetic 'input' event leaves the DOM correct while React state stays
     * empty — measured, the form then refuses a condition that looks filled in.
     * That script types with 'Input.insertText', which goes through the browser and
     * cannot be approximated wrongly, and it asserts what the SERVER returned for a
     * substring, a wildcard character and an injection-shaped value.
     */
    report.searchVerifiedBy = "e2e-sql-search.mjs";
    // requirement 10: the insert tab gives per-type controls
    const insertTab = byText('.dbm-tab', '插入') || byText('.dbm-tab', 'Insert');
    click(insertTab);
    await sleep(900);
    const kindInput = document.querySelector('[data-dbm-insert-for$=":kind"]');
    const joinedInput = document.querySelector('[data-dbm-insert-for$=":joined"]');
    const activeInput = document.querySelector('[data-dbm-insert-for$=":active"]');
    report.insertControls = {
      kind: kindInput ? kindInput.tagName + (kindInput.type ? ':' + kindInput.type : '') : null,
      joined: joinedInput ? joinedInput.tagName + (joinedInput.type ? ':' + joinedInput.type : '') : null,
      active: activeInput ? activeInput.tagName + (activeInput.type ? ':' + activeInput.type : '') : null,
    };
    // SQLite has no enum type: the members exist only on MySQL, which reports
    // them on the wire, so the expected control differs by engine rather than
    // being skipped.
    if (report.insertControls.kind !== null && report.insertControls.kind.startsWith('SELECT')) {
      step('an enum column gets a select', report.insertControls.kind);
    } else {
      check('a text column gets a text control', report.insertControls.kind === 'TEXTAREA:textarea' || report.insertControls.kind === 'INPUT:text', report.insertControls);
    }
    check('a date column gets a date input', report.insertControls.joined === 'INPUT:date', report.insertControls);
    check('a boolean column gets a select', report.insertControls.active !== null && report.insertControls.active.startsWith('SELECT'), report.insertControls);

    // Insert a row through the form, then verify the server has it.
    const nameInput = document.querySelector('[data-dbm-insert-for$=":name"]');
    if (nameInput) {
      setInput(nameInput, 'inserted-by-form');
      const ageInput = document.querySelector('[data-dbm-insert-for$=":age"]');
      setInput(ageInput, '7');
      // Two buttons both start with 插入 (插入 / 插入并再填一行), so the FIRST
      // one is chosen by its exact text.
      const insertBtn = byText('.dbm-tab-body .dbm-btn', '插入') || byText('.dbm-tab-body .dbm-btn', 'Insert');
      if (!insertBtn) fail('no insert button');
      else click(insertBtn);
      await sleep(2200);
      report.insertNotice = (document.querySelector('.dbm-ok') || {}).textContent || null;
      // Polled: the write and the re-read are separate round trips, so a single
      // read races the commit and would report a correct insert as lost.
      let afterInsert = [];
      for (let attempt = 0; attempt < 25; attempt++) {
        afterInsert = (await api(\`/api/dsh-database/sources/\${sourceId}/rows?table=people&page=1&pageSize=200&mode=browse\`)).page.rows.map((r) => r.name);
        if (afterInsert.includes('inserted-by-form')) break;
        await sleep(300);
      }
      report.afterInsert = afterInsert;
      check('the form insert reached the server', afterInsert.includes('inserted-by-form'), afterInsert.length);
    } else {
      fail('the insert form has no name field');
    }

    // requirement 8: the structure tab
    const structureTab = byText('.dbm-tab', '结构') || byText('.dbm-tab', 'Structure');
    click(structureTab);
    await sleep(1200);
    const addColumn = await waitFor(() => byIncludes('.dbm-btn', '新增列') || byIncludes('.dbm-btn', 'Add column'), 5000);
    check('the structure tab offers adding a column', addColumn !== null);
    check('the structure tab offers editing the key', (byIncludes('.dbm-btn', '编辑主键') || byIncludes('.dbm-btn', 'Edit key')) !== null);
    check('the structure tab offers adding an index', (byIncludes('.dbm-btn', '新增索引') || byIncludes('.dbm-btn', 'Add index')) !== null);
    check('the structure tab offers a distinct count per column', (byIncludes('.dbm-link', '非重复值') || byIncludes('.dbm-link', 'Distinct')) !== null);

    if (addColumn) {
      click(addColumn);
      const editor = await waitFor(() => document.querySelector('.dbm-struct-editor'), 5000);
      if (editor) {
        step('the add-column editor opened');
        const nameField = editor.querySelector('input.dbm-input');
        setInput(nameField, 'added_col');
        click(byIncludes('.dbm-struct-editor .dbm-btn', '新增') || byIncludes('.dbm-struct-editor .dbm-btn', 'Add'));
        await sleep(1800);
        report.afterAddColumn = (await api(\`/api/dsh-database/sources/\${sourceId}/columns?table=people\`)).columns.map((c) => c.name);
        check('the added column reached the server', report.afterAddColumn.includes('added_col'), report.afterAddColumn);
      } else {
        fail('the add-column editor did not open');
      }
    }

    // requirement 1: clicking the database returns to its table list
    const dbNode = document.querySelector('.dbm-side-body .dbm-tree-item[data-active]');
    const overview = document.querySelector('.dbm-table thead');
    if (dbNode) {
      click(dbNode);
      await sleep(1200);
      report.backToOverview = {
        hasTableList: byIncludes('.dbm-table thead', '行数') !== null ||
          byIncludes('.dbm-table thead', 'Rows') !== null,
        tabsGone: document.querySelector('.dbm-tabs') === null,
      };
      check('clicking the database returns to its table list', report.backToOverview.hasTableList, report.backToOverview);
      check('the table tabs are gone on the database overview', report.backToOverview.tabsGone === true, report.backToOverview);
    } else {
      fail('no active database node found');
    }
    void overview;
  } catch (error) {
    fail('the flow threw', String(error && error.stack ? error.stack : error));
  }
  return JSON.stringify(report, null, 2);
})()`

const { child, profile } = launchBrowser()
let session
try {
  const url = await debuggerUrl()
  const socket = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 })
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
   * blur / focusout listener on an input stayed silent when focus moved to
   * another element, because the page was never the active window. The panel's
   * in-cell editor saves on blur, so without this call the flow reports "the edit
   * never reached the server" for a product that works — the harness would be the
   * broken part, and a wrong bug report is worse than none.
   */
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })

  seed(sqliteFile)

  // Load the harness UI, then run the whole flow in one page-side promise so the
  // report survives even when a step bails out early.
  await session.send('Page.navigate', { url: baseUrl })
  await new Promise(resolve => setTimeout(resolve, 4000))

  const report = await session.evaluate(FLOW)

  console.log(report)
} finally {
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
   * The throwaway profile is best-effort.
   *
   * Edge keeps a few of its own files open after the process is gone (measured:
   * Default/Collections/collectionsSQLite answers EBUSY), and a failing
   * cleanup would replace the run's actual result with a filesystem error the
   * reader has to see past. The directory is under the system temp dir, so
   * leaving one behind is harmless.
   */
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  } catch {
    console.error(`note: the throwaway browser profile could not be removed: ${profile}`)
  }
  // The panel's source id is derived from its name and the dsh instance under
  // test is the caller's, so nothing else on disk is touched.
  void readAll
  void seed
}
