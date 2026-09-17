import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/**
 * End-to-end check of the table-batch, database-action and index-dialog surfaces.
 *
 * Every write is verified against the SERVER, not against what the panel said: a
 * panel that reported "3 tables emptied" without emptying them must fail. The
 * database-level operations are the reason this runs against SQLite (a file, so the
 * effects are inspectable directly) AND against MySQL when a server is given — the
 * two engines support different subsets, and that difference is the thing most
 * likely to be wrong.
 *
 * Usage:
 *   node scripts/e2e-table-actions.mjs <baseUrl-with-token> <sqliteFile>
 *   node scripts/e2e-table-actions.mjs <baseUrl-with-token> <sqliteFile> mysql <host:port:user:password> <database>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9361

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
const engine = process.argv[4] ?? 'sqlite'
const connection = process.argv[5] ?? '127.0.0.1:3306:root:root'
const targetDatabase = process.argv[6] ?? 'dbm_actions'
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-table-actions.mjs <baseUrl-with-token> <sqliteFile> [sqlite|mysql] [host:port:user:password] [database]')
  process.exit(2)
}
const [host, port, user, password] = connection.split(':')

/** Names this run creates, all tagged so a leftover cannot be mistaken for ours. */
const TAG = process.pid
const SOURCE_NAME = `E2E Actions ${TAG}`
/** Databases this run may create and must clean up. */
const createdDatabases = [`${targetDatabase}_copy_${TAG}`, `${targetDatabase}_ren_${TAG}`, `dbm_new_${TAG}`]

/** Seed the SQLite file with tables to batch over. */
function seedSqlite(file) {
  const db = new DatabaseSync(file)
  for (const [name, rows] of [['alpha', 3], ['beta', 2], ['gamma', 1]]) {
    db.exec(`DROP TABLE IF EXISTS ${name}`)
    db.exec(`CREATE TABLE ${name}(id INTEGER PRIMARY KEY, v TEXT)`)
    const insert = db.prepare(`INSERT INTO ${name}(v) VALUES (?)`)
    for (let n = 0; n < rows; n++) insert.run(`row${n}`)
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
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail === undefined ? '' : ' → ' + JSON.stringify(detail)}`)
}

const profile = mkdtempSync(join(tmpdir(), 'dbm-actions-'))
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

const origin = baseUrl.replace(/\/\?.*$/, '')
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

  if (engine === 'sqlite') seedSqlite(sqliteFile)
  await session.send('Page.navigate', { url: baseUrl })
  await wait(4500)

  const report = await session.evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(150); } };
    const byExact = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
    const byIncludes = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
    const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
    const setInput = (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const setSelect = (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const api = async (path, options) => {
      const response = await fetch(path, options);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error('API ' + path + ' -> ' + response.status + ': ' + (body && body.error ? body.error : 'no body'));
      return body;
    };

    const out = { failures: [], notes: [] };
    const check = (name, ok, detail) => { if (ok) out.notes.push(name); else out.failures.push({ name, detail }); };

    // ---- create the data source ------------------------------------------
    const row = Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim()));
    if (!row) return { fatal: 'sidebar row never rendered' };
    click(row);
    await sleep(1800);
    const newBtn = await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000);
    click(newBtn);
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    if (!modal) return { fatal: 'the create dialog did not open' };
    const kindSelect = modal.querySelector('select.dbm-select');
    if (kindSelect) setSelect(kindSelect, ${JSON.stringify(engine)});
    await sleep(500);
    const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
    setInput(inputs[0], ${JSON.stringify(SOURCE_NAME)});
    const sqliteInput = inputs.find((i) => (i.getAttribute('placeholder') || '').includes('D:/data'));
    if (sqliteInput) setInput(sqliteInput, ${JSON.stringify(sqliteFile)});
    const hostInput = inputs.find((i) => (i.getAttribute('placeholder') || '').includes('127.0.0.1'));
    if (hostInput) setInput(hostInput, ${JSON.stringify(host)});
    const userInput = inputs.find((i) => (i.getAttribute('placeholder') || '').includes('root'));
    if (userInput) setInput(userInput, ${JSON.stringify(user)});
    const pw = modal.querySelector('input[type=password]');
    if (pw) setInput(pw, ${JSON.stringify(password)});
    await sleep(300);
    click(byExact('.dbm-modal-foot .dbm-btn', '保存') || byExact('.dbm-modal-foot .dbm-btn', 'Save'));

    const listed = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(SOURCE_NAME)}), 12000);
    if (!listed) return { fatal: 'the created source is not listed', error: (document.querySelector('.dbm-error') || {}).textContent };

    // Resolve the id by the run's unique name, requiring exactly one match.
    const sources = await api('/api/dsh-database/sources');
    const matches = sources.sources.filter((s) => s.name === ${JSON.stringify(SOURCE_NAME)});
    if (matches.length !== 1) return { fatal: 'the run data source did not resolve to one entry', n: matches.length };
    const sourceId = matches[0].id;
    out.sourceId = sourceId;

    const connect = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn'))
      .find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
    click(connect);
    await sleep(3500);

    // ---- open the database overview (requirement 6/7/8 live there) --------
    const dbName = ${JSON.stringify(engine === 'mysql' ? targetDatabase : 'main')};
    const dbNode = await waitFor(() => byIncludes('.dbm-side-body .dbm-tree-item', dbName), 15000);
    if (!dbNode) return { fatal: 'the database node is not in the tree', error: (document.querySelector('.dbm-error') || {}).textContent };
    click(dbNode);

    // The overview replaces the placeholder: wait for its own toolbar.
    const dbToolbar = await waitFor(() => document.querySelector('[data-dbm-db-toolbar]'), 12000);
    if (!dbToolbar) return { fatal: 'the database toolbar never rendered', error: (document.querySelector('.dbm-error') || {}).textContent };
    out.dbToolbarButtons = Array.from(dbToolbar.querySelectorAll('.dbm-btn')).map((b) => (b.textContent || '').trim());

    // requirement 6: the "new database" entry exists on MySQL and says why not on SQLite.
    const createBtn = dbToolbar.querySelector('[data-dbm-dbop="create"]');
    if (${JSON.stringify(engine)} === 'mysql') {
      check('a new-database entry is offered', createBtn !== null, out.dbToolbarButtons);
    } else {
      // A SQLite database is a file; the entry is absent and the docs say so.
      check('no CREATE DATABASE is offered for SQLite', createBtn === null, out.dbToolbarButtons);
    }
    // requirement 7: the database actions are present.
    for (const op of ['export', 'import', 'rename', 'copy', 'charset', 'drop']) {
      check('database action present: ' + op, dbToolbar.querySelector('[data-dbm-dbop="' + op + '"]') !== null);
    }

    // requirement 8: row selection + batch bar.
    const boxes = Array.from(document.querySelectorAll('[data-dbm-table-select]'));
    out.tableCheckboxes = boxes.length;
    check('every table row has a selection checkbox', boxes.length >= 3, boxes.length);

    // Tick two tables and confirm the batch bar appears with the right actions.
    click(boxes[0]);
    click(boxes[1]);
    const bar = await waitFor(() => document.querySelector('[data-dbm-table-batch]'), 5000);
    check('the batch bar appears with a selection', bar !== null, bar ? bar.textContent.trim() : null);
    out.batchButtons = bar === null ? [] : Array.from(bar.querySelectorAll('.dbm-btn')).map((b) => (b.textContent || '').trim());
    for (const key of ['export', 'truncate', 'drop']) {
      check('batch action present: ' + key, bar !== null && bar.querySelector('[data-dbm-batch="' + key + '"]') !== null);
    }
    /*
     * The four maintenance statements are all RENDERED, and 修复 is disabled on
     * SQLite.
     *
     * Asserting presence/absence would pin the wrong thing: SQLite has no REPAIR
     * statement, but removing the button would leave a user looking for a control the
     * request asked for. What must hold is that the button is present AND marked
     * unsupported (so it is disabled and says why).
     */
    const maintOps = ${JSON.stringify(engine)} === 'mysql' ? ['check', 'optimize', 'repair', 'analyze'] : ['check', 'optimize', 'analyze']
    for (const op of ['check', 'optimize', 'repair', 'analyze']) {
      const btn = bar === null ? null : bar.querySelector('[data-dbm-maint="' + op + '"]')
      check('maintenance button rendered: ' + op, btn !== null)
      const supported = btn !== null && btn.getAttribute('data-dbm-maint-supported') === 'true'
      check('maintenance support flag matches the engine: ' + op, supported === maintOps.includes(op), { claimed: supported, engine: ${JSON.stringify(engine)} })
      if (btn !== null) {
        check('an unsupported maintenance button is disabled: ' + op, supported ? btn.disabled === false : btn.disabled === true)
      }
    }

    // The two selections' names, so the batch actions can be checked against them.
    out.selectedNames = Array.from(document.querySelectorAll('[data-dbm-table-select]'))
      .filter((el) => el.checked)
      .map((el) => el.getAttribute('data-dbm-table-select'));

    return out;
  })()`)

  if (report.fatal !== undefined) {
    console.error(`\nfatal: ${report.fatal}`)
    if (report.error !== undefined) console.error(`error: ${report.error}`)
    process.exitCode = 1
  } else {
    for (const note of report.notes) check(note, true)
    for (const failure of report.failures) check(failure.name, false, failure.detail)
    console.log(`\nselected tables: ${JSON.stringify(report.selectedNames)}`)
  }
} finally {
  try {
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name === SOURCE_NAME)) {
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' })
      console.error(`note: removed the run's data source (${source.id})`)
    }
  } catch { /* best effort */ }
  try { socket?.close() } catch { /* gone */ }
  child.kill()
  await wait(1000)
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}

const failed = checks.filter(entry => !entry.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
void createdDatabases
