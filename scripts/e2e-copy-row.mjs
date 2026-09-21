import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/**
 * 浏览页行操作「复制」的端到端：把一行的值填进插入表单，自增列留空。
 *
 * 断言的是**行为**而不是按钮存在：点完之后必须是插入 tab 处于激活状态，表单里必须
 * 真的出现那一行的值，自增列必须**空**，而提交之后服务端必须多出**一行新 id 的数据**
 * ——只查「表单里填了值」发现不了自增列被一起填过去（那样提交会撞主键），只查「按钮
 * 存在」则什么都发现不了。
 *
 * 覆盖的分支，每一个都有只在界面上才看得见的失败形态：
 *   1. 复制 → 插入 tab 激活，name/age 已填，id（自增）留空；
 *   2. 提交 → 新行的 id 与原行不同，说明自增列确实交给了数据库；
 *   3. 复制会把行数框折回 1，且值落在第 1 组（先改成 3 组再复制）；
 *   4. 离开插入页再回来 → 表单是空的，不会把上一次复制的行又摆出来；
 *   5. NULL 列 → 勾上 NULL 复选框，而不是文字 "null"；
 *   6. 剪贴板按钮已经不在了（`复制整行` / `复制首列` 两个都已去掉）。
 *
 * MySQL 侧额外验证两件只在那个引擎上才成立的事：`datetime` 在 `dateStrings: true`
 * 下返回 `2024-01-02 03:04:05`（带空格），必须改写成 `datetime-local` 要求的形状，
 * 否则控件显示为空而提交的仍是原值；BLOB 在 wire 上是 `<binary N bytes>`，回填会把
 * 这个占位符当值存进去，所以它必须被跳过、并在提示语里点名。
 *
 * 用法：
 *   node scripts/e2e-copy-row.mjs <baseUrl-with-token> <sqliteFile>
 *   node scripts/e2e-copy-row.mjs <baseUrl-with-token> <sqliteFile> mysql <host:port:user:password>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9408

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
const engine = process.argv[4] ?? 'sqlite'
const connection = process.argv[5] ?? '127.0.0.1:3306:root:root'
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-copy-row.mjs <baseUrl-with-token> <sqliteFile> [sqlite|mysql] [host:port:user:password]')
  process.exit(2)
}

const [host, port, user, password] = connection.split(':')
const TAG = process.pid
const SOURCE_NAME = `E2E CopyRow ${TAG}`
/** MySQL 侧的表建在这个库里；SQLite 侧是 `main`。 */
const DB_NAME = engine === 'mysql' ? `dbm_copyrow_${TAG}` : 'main'
const TABLE = 'copyrow'

/**
 * SQLite 侧的造数：自增主键 + NOT NULL 列 + 可空列。
 *
 * `seed` 是唯一一行：复制它就必须得到一个 id 不同、其余相同的第二行。
 */
function seedSqlite(file) {
  const db = new DatabaseSync(file)
  db.exec(`DROP TABLE IF EXISTS ${TABLE}`)
  db.exec(`CREATE TABLE ${TABLE} (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, age INTEGER, note TEXT)`)
  db.exec(`INSERT INTO ${TABLE}(name, age, note) VALUES ('seed', 7, NULL)`)
  db.close()
}

/**
 * MySQL 侧的造数：覆盖复制时每一类特殊列。
 *
 * `at` 是 DATETIME，用来验证 `datetime-local` 的形状改写；`st` 是 ENUM，验证下拉能
 * 接受的值；`payload` 是 BLOB，验证它被**跳过并点名**而不是把 `<binary N bytes>`
 * 存进去。
 */
async function seedMysql() {
  const mysql = await import('mysql2/promise')
  const connection = await mysql.createConnection({
    host: host ?? '127.0.0.1',
    port: Number(port ?? 3306),
    user: user ?? 'root',
    password: password ?? '',
  })
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``)
    await connection.query(`CREATE DATABASE \`${DB_NAME}\``)
    await connection.query(`USE \`${DB_NAME}\``)
    await connection.query(`CREATE TABLE ${TABLE} (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(20) NOT NULL,
      age INT NULL,
      at DATETIME NULL,
      st ENUM('a','b') NULL,
      payload BLOB NULL,
      PRIMARY KEY (id)
    )`)
    await connection.query(
      `INSERT INTO ${TABLE} (name, age, at, st, payload) VALUES ('seed', 7, '2024-01-02 03:04:05', 'b', X'DEADBEEF')`,
    )
  } finally {
    await connection.end()
  }
}

/** Read the rows back through the panel's own API, so the verification is of what it wrote. */
async function rowsOf(sourceId) {
  const response = await fetch(`${origin}/api/dsh-database/sources/${sourceId}/rows?schema=${encodeURIComponent(DB_NAME)}&table=${TABLE}&page=1&pageSize=50&mode=browse`)
  const body = await response.json()
  if (!response.ok) throw new Error(`rows read failed: ${body.error}`)
  return body.page.rows
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
    await sleep(150);
  }
};
const setInput = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const setSelect = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
const activeTab = () => {
  const el = document.querySelector('.dbm-tab[data-active="true"]');
  return el === null ? null : (el.textContent || '').trim();
};
const api = async (path) => {
  const response = await fetch(path);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error('API ' + path + ' -> ' + response.status + ': ' + (body && body.error ? body.error : 'no body'));
  return body;
};
/** 插入表单里某一列控件的值（select/input/textarea 都按 value 读）。 */
const insertValueOf = (suffix) => {
  const el = document.querySelector('[data-dbm-insert-for$=":' + suffix + '"]');
  return el === null ? null : el.value;
};
/** 行操作按钮的文案，按顺序。 */
const rowActions = () => Array.from(document.querySelectorAll('.dbm-data tbody tr .dbm-actions .dbm-row-action'))
  .map((b) => (b.textContent || '').trim());
const copyButton = () => Array.from(document.querySelectorAll('.dbm-data tbody tr .dbm-actions .dbm-row-action'))
  .find((b) => ['复制', 'Copy'].includes((b.textContent || '').trim()));
`;

const profile = mkdtempSync(join(tmpdir(), 'dbm-copyrow-'))
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
  if (engine === 'mysql') await seedMysql()
  else seedSqlite(sqliteFile)

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

  await session.send('Page.navigate', { url: baseUrl })
  await wait(4500)

  const report = await session.evaluate(`(async () => {
${PRELUDE}
  const engine = ${JSON.stringify(engine)};
  const dbName = ${JSON.stringify(DB_NAME)};
  const out = { failures: [], notes: [] };
  const check = (name, ok, detail) => { if (ok) out.notes.push(name); else out.failures.push({ name, detail }); };

  try {
    const row = Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim()));
    if (!row) return { fatal: 'sidebar row never rendered' };
    click(row);
    await sleep(1800);
    click(await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000));
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    if (!modal) return { fatal: 'the create dialog did not open' };
    const kindSelect = modal.querySelector('select.dbm-select');
    if (kindSelect) setSelect(kindSelect, engine);
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
    click(byText('.dbm-modal-foot .dbm-btn', '保存') || byText('.dbm-modal-foot .dbm-btn', 'Save'));
    const listed = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(SOURCE_NAME)}), 15000);
    if (!listed) return { fatal: 'the created source is not listed', error: (document.querySelector('.dbm-error') || {}).textContent };

    /*
     * 数据源必须按 ID 精确定位，不能回退到第一行：那会静默连到另一个库，
     * 把「没连上」报成别的现象。
     */
    const sources = await api('/api/dsh-database/sources');
    const matches = sources.sources.filter((s) => s.name === ${JSON.stringify(SOURCE_NAME)});
    if (matches.length !== 1) return { fatal: 'the run data source did not resolve to one entry', n: matches.length };
    const sourceId = matches[0].id;
    out.sourceId = sourceId;

    const connect = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn'))
      .find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
    click(connect);
    await sleep(3500);

    const dbNode = await waitFor(() => {
      return Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => {
        const label = el.querySelector('.dbm-node-name');
        return label !== null && (label.textContent || '').trim() === dbName;
      }) || null;
    }, 15000);
    if (dbNode === null) return { fatal: 'the database node is not in the tree', error: (document.querySelector('.dbm-error') || {}).textContent };
    click(dbNode);
    await sleep(1800);

    const tableLink = await waitFor(() => byText('.dbm-table .dbm-link', ${JSON.stringify(TABLE)}), 12000);
    if (!tableLink) return { fatal: 'the seeded table is not in the overview', text: (document.querySelector('.dbm-table tbody') || {}).textContent };
    click(tableLink);
    await sleep(2200);

    // ---- 行操作里只剩一个「复制」，剪贴板那两个已经不在了 ------------------
    out.actionLabels = rowActions();
    check('the row actions offer 复制', out.actionLabels.includes('复制') || out.actionLabels.includes('Copy'), out.actionLabels);
    check('复制首列 is gone', !out.actionLabels.includes('复制首列') && !out.actionLabels.includes('Copy cell'), out.actionLabels);
    check('复制整行 is gone', !out.actionLabels.includes('复制整行') && !out.actionLabels.includes('Copy row'), out.actionLabels);

    // ---- 第一段：复制 → 插入表单已填、自增列留空 -------------------------
    const copyBtn = copyButton();
    if (copyBtn === undefined) return { ...out, fatal: 'no 复制 button in the row actions' };
    click(copyBtn);
    await sleep(2200);

    out.tabAfterCopy = activeTab();
    check('复制 switches to the insert tab', ['插入', 'Insert'].includes(out.tabAfterCopy), out.tabAfterCopy);
    check('the insert form rendered', document.querySelector('[data-dbm-insert-for$=":name"]') !== null);

    out.name = insertValueOf('name');
    out.age = insertValueOf('age');
    out.id = insertValueOf('id');
    check('the name value was carried over', out.name === 'seed', out.name);
    check('the age value was carried over', out.age === '7', out.age);
    // 自增列必须空 —— 填了就会在提交时撞上原行的 id。
    check('the auto-increment column is left blank', out.id === '', out.id);

    out.notice = (document.querySelector('.dbm-ok') || {}).textContent || null;
    check('the notice says the row went to the insert form', (out.notice || '').includes('插入'), out.notice);

    if (engine === 'sqlite') {
      // NULL 是勾选框，不是文字 "null"。
      const nullBox = document.querySelector('[data-dbm-insert-null$=":note"]');
      out.nullBox = nullBox === null ? null : nullBox.checked;
      check('a NULL column is ticked as NULL, not typed as the text null', out.nullBox === true, out.nullBox);
      check('the note field shows no literal "null"', insertValueOf('note') !== 'null', insertValueOf('note'));
    } else {
      /*
       * MySQL：datetime 在 dateStrings 下是 '2024-01-02 03:04:05'，而
       * input[type=datetime-local] 拿着带空格的值会渲染成**空**，提交的却仍是那个值。
       * 断言的是控件里真的看得见这个日期，而不是只断言状态里存了它。
       */
      out.at = insertValueOf('at');
      check('the datetime is shown in the control the way datetime-local requires', out.at === '2024-01-02T03:04:05', out.at);
      const atEl = document.querySelector('[data-dbm-insert-for$=":at"]');
      out.atInputVisible = atEl !== null && /T/.test(atEl.value);
      check('the datetime control is not the empty-rendering form', out.atInputVisible === true, out.at);

      // ENUM 下拉只接受声明的成员。
      out.st = insertValueOf('st');
      check('the enum member was carried over', out.st === 'b', out.st);

      // BLOB 的值在 wire 上是 <binary 4 bytes>，回填会把它当值存进去：必须跳过并点名。
      out.payload = insertValueOf('payload');
      check('the blob field is left blank, not filled with the placeholder', out.payload === '', out.payload);
      check('the notice names the column whose value could not be copied',
        (out.notice || '').includes('payload'), out.notice);
    }

    // ---- 第二段：提交 → 服务端多出一行新 id 的数据 -----------------------
    const insertBtn = byText('.dbm-tab-body .dbm-btn', '插入') || byText('.dbm-tab-body .dbm-btn', 'Insert');
    if (insertBtn === null) return { ...out, fatal: 'no insert button' };
    click(insertBtn);
    await sleep(3000);
    out.insertError = (document.querySelector('.dbm-error') || {}).textContent || null;

    const afterInsert = await api('/api/dsh-database/sources/' + sourceId + '/rows?schema=' + encodeURIComponent(dbName) + '&table=${TABLE}&page=1&pageSize=50&mode=browse');
    out.rows = afterInsert.page.rows;
    check('the copy produced a second row', afterInsert.page.rows.length === 2, afterInsert.page.rows.length);
    const copied = afterInsert.page.rows.find((r) => r.name === 'seed' && r.age === 7 && String(r.id) !== '1');
    check('the new row has its own id (the engine assigned it)', copied !== undefined, afterInsert.page.rows);
    if (engine === 'mysql' && copied !== undefined) {
      check('the enum value survived the insert', copied.st === 'b', copied);
    }

    // ---- 第三段：复制填的是第一个表单，不是第 N 个 ------------------------
    click(byText('.dbm-tab', '浏览') || byText('.dbm-tab', 'Browse'));
    await sleep(2000);
    click(byText('.dbm-tab', '插入') || byText('.dbm-tab', 'Insert'));
    await sleep(1500);
    // 先把行数改成 3，再回到浏览复制：目标行必须落在第 1 组，而不是被留在某一组空白里。
    setInput(document.querySelector('[data-dbm-insert-count]'), '3');
    click(document.querySelector('[data-dbm-insert-apply]'));
    await sleep(800);
    out.formsAfterApply = document.querySelectorAll('[data-dbm-insert-form]').length;

    click(byText('.dbm-tab', '浏览') || byText('.dbm-tab', 'Browse'));
    await sleep(2000);
    const copyAgain = copyButton();
    if (copyAgain === undefined) return { ...out, fatal: 'no 复制 button on the second pass' };
    click(copyAgain);
    await sleep(2200);
    out.formsAfterCopy = document.querySelectorAll('[data-dbm-insert-form]').length;
    const firstFormName = document.querySelector('[data-dbm-insert-form="0"] [data-dbm-insert-for$=":name"]');
    out.firstFormNameValue = firstFormName === null ? null : firstFormName.value;
    check('the copy collapses the batch back to one form', out.formsAfterCopy === 1, { before: out.formsAfterApply, after: out.formsAfterCopy });
    check('the copied value lands in the FIRST form', out.firstFormNameValue === 'seed', out.firstFormNameValue);

    // ---- 第四段：离开插入页再回来，表单应是空的 --------------------------
    click(byText('.dbm-tab', '浏览') || byText('.dbm-tab', 'Browse'));
    await sleep(2000);
    click(byText('.dbm-tab', '插入') || byText('.dbm-tab', 'Insert'));
    await sleep(1500);
    out.nameAfterRevisit = insertValueOf('name');
    check('revisiting the insert tab gives a blank form, not the old copy', out.nameAfterRevisit === '', out.nameAfterRevisit);

    return out;
  } catch (error) {
    out.failures.push({ name: 'the flow threw', detail: String(error && error.stack ? error.stack : error) });
    return out;
  }
})()`)

  if (report.fatal !== undefined) {
    console.error(`\nfatal: ${report.fatal}`)
    if (report.error !== undefined) console.error(`error: ${report.error}`)
    process.exitCode = 1
  } else {
    for (const key of ['actionLabels', 'tabAfterCopy', 'name', 'age', 'id', 'nullBox', 'at', 'st', 'payload', 'notice',
      'insertError', 'formsAfterApply', 'formsAfterCopy', 'firstFormNameValue', 'nameAfterRevisit']) {
      if (report[key] !== undefined) console.log(`${key}: ${JSON.stringify(report[key])}`)
    }
    if (report.rows !== undefined) console.log(`rows: ${JSON.stringify(report.rows)}`)
    for (const note of report.notes) check(note, true)
    for (const failure of report.failures) check(failure.name, false, failure.detail)
  }
} finally {
  try {
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name === SOURCE_NAME)) {
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' })
      console.error(`note: removed the run's data source (${source.id})`)
    }
  } catch { /* best effort */ }
  // MySQL 侧的库要显式删掉：留着会在树里多出一个只有本次运行看得到的库。
  if (engine === 'mysql') {
    try {
      const mysql = await import('mysql2/promise')
      const connection = await mysql.createConnection({ host: host ?? '127.0.0.1', port: Number(port ?? 3306), user: user ?? 'root', password: password ?? '' })
      await connection.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``)
      await connection.end()
      console.error(`note: dropped ${DB_NAME}`)
    } catch { /* best effort */ }
  }
  try { socket?.close() } catch { /* gone */ }
  child.kill()
  await wait(1000)
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}

const failed = checks.filter(entry => !entry.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
