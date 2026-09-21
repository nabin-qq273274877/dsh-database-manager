import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/**
 * 结构页列编辑对齐建表页的端到端，以及对齐暴露的两条引擎陷阱。
 *
 * 断言的是**写进服务端的结果**，不是表单的样子：每一项都在提交后回读，因为这一类改动
 * 是 DDL，错了没有撤销。
 *
 * 覆盖的分支，每个都对应一条实测出来的引擎行为：
 *
 *   1. 类型是**分组**下拉（有 optgroup），且没有那个「类型文本」字段；
 *   2. 长度框真的有，且填进去会落进类型（`varchar(191)`）；
 *   3. 「允许空」**默认不勾选** —— 与建表页一致；
 *   4. 「放在 xx 之后」：MySQL 上真的生效；SQLite 上**禁用**并说明原因，因为它的
 *      ADD COLUMN 会把 `AFTER x` 当作类型名的一部分静默接受（实测），列不动、类型被污染；
 *   5. SQLite 上「允许空」不勾选 + 无默认值，要在**提交前**就说明会被引擎拒绝；
 *   6. UNSIGNED / ZEROFILL 往返**不重复发出**（实测 MySQL 会静默归一化，所以只能靠
 *      回读 COLUMN_TYPE 断言）；
 *   7. 索引下拉能改索引：把列设成主键 / 唯一，回读到真的生效。
 *
 * 用法：
 *   node scripts/e2e-structure-aligned.mjs <baseUrl-with-token> <sqliteFile>
 *   node scripts/e2e-structure-aligned.mjs <baseUrl-with-token> <sqliteFile> mysql <host:port:user:password>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9427

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
const engine = process.argv[4] ?? 'sqlite'
const connection = process.argv[5] ?? '127.0.0.1:3306:root:root'
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-structure-aligned.mjs <baseUrl-with-token> <sqliteFile> [sqlite|mysql] [host:port:user:password]')
  process.exit(2)
}

const [host, port, user, password] = connection.split(':')
const TAG = process.pid
const SOURCE_NAME = `E2E Aligned ${TAG}`
const DB_NAME = engine === 'mysql' ? `dbm_aligned_${TAG}` : 'main'
const TABLE = 'aligned_target'

function seedSqlite(file) {
  const db = new DatabaseSync(file)
  db.exec(`DROP TABLE IF EXISTS ${TABLE}`)
  db.exec(`CREATE TABLE ${TABLE} (id INTEGER PRIMARY KEY, first_col TEXT, last_col TEXT)`)
  db.exec(`INSERT INTO ${TABLE}(id, first_col, last_col) VALUES (1, 'a', 'z')`)
  db.close()
}

async function seedMysql() {
  const mysql = await import('mysql2/promise')
  const connection = await mysql.createConnection({ host, port: Number(port), user, password })
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``)
    await connection.query(`CREATE DATABASE \`${DB_NAME}\``)
    await connection.query(`USE \`${DB_NAME}\``)
    await connection.query(`CREATE TABLE ${TABLE} (
      id INT NOT NULL AUTO_INCREMENT,
      first_col VARCHAR(20) NULL,
      last_col VARCHAR(20) NULL,
      amount INT UNSIGNED NULL,
      flag INT(10) UNSIGNED ZEROFILL NULL,
      PRIMARY KEY (id)
    )`)
    await connection.query(`INSERT INTO ${TABLE} (first_col, last_col, amount, flag) VALUES ('a', 'z', 1, 2)`)
  } finally {
    await connection.end()
  }
}

/** Read the real column shapes back from the server, not from the panel. */
async function inspectColumns() {
  if (engine === 'mysql') {
    const mysql = await import('mysql2/promise')
    const c = await mysql.createConnection({ host, port: Number(port), user, password })
    try {
      const [rows] = await c.query(
        `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_KEY AS keyName, EXTRA AS extra
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [DB_NAME, TABLE],
      )
      return rows.map(row => ({ name: row.name, type: row.type, nullable: row.nullable === 'YES', key: row.keyName, extra: row.extra }))
    } finally {
      await c.end()
    }
  }
  const db = new DatabaseSync(sqliteFile)
  const info = db.prepare(`PRAGMA table_info(${TABLE})`).all()
  const keys = db.prepare(`PRAGMA index_list(${TABLE})`).all()
  const primary = db.prepare(`PRAGMA table_info(${TABLE})`).all().filter(row => row.pk > 0).sort((a, b) => a.pk - b.pk).map(row => row.name)
  void keys
  db.close()
  return info.map(row => ({
    name: row.name,
    type: row.type,
    nullable: row.notnull === 0,
    key: row.pk > 0 ? 'PRI' : '',
    extra: '',
  })).map(row => ({ ...row, key: primary.includes(row.name) ? 'PRI' : row.key }))
}

/** The table's index list, read from the server. */
async function inspectIndexes() {
  if (engine === 'mysql') {
    const mysql = await import('mysql2/promise')
    const c = await mysql.createConnection({ host, port: Number(port), user, password })
    try {
      const [rows] = await c.query(
        `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS seq
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [DB_NAME, TABLE],
      )
      const byName = new Map()
      for (const row of rows) {
        const entry = byName.get(row.name) ?? { name: row.name, unique: row.nonUnique === 0, columns: [] }
        entry.columns.push({ seq: row.seq, name: row.columnName })
        byName.set(row.name, entry)
      }
      return [...byName.values()].map(entry => ({ ...entry, columns: entry.columns.sort((a, b) => a.seq - b.seq).map(item => item.name) }))
    } finally {
      await c.end()
    }
  }
  const db = new DatabaseSync(sqliteFile)
  const list = db.prepare(`PRAGMA index_list(${TABLE})`).all()
  const out = list.map(entry => {
    const info = db.prepare(`PRAGMA index_info(${entry.name})`).all()
    return { name: entry.name, unique: entry.unique === 1, columns: info.sort((a, b) => a.seqno - b.seqno).map(row => row.name) }
  })
  db.close()
  return out
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

const profile = mkdtempSync(join(tmpdir(), 'dbm-aligned-'))
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
    } catch { /* not up yet */ }
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byText = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
const byIncludes = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(150); } };
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
const api = async (path, options) => {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error('API ' + path + ' -> ' + response.status + ': ' + (body && body.error ? body.error : 'no body'));
  return body;
};
const engine = ${JSON.stringify(engine)};
const dbName = ${JSON.stringify(DB_NAME)};
const tableName = ${JSON.stringify(TABLE)};
const out = { failures: [], notes: [] };
const check = (name, ok, detail) => { if (ok) out.notes.push(name); else out.failures.push({ name, detail }); };
/** The column editor's controls, by their data attributes. */
const editorEl = () => document.querySelector('.dbm-modal');
const colName = () => editorEl().querySelector('[data-dbm-column-name]');
const colTypeSelect = () => editorEl().querySelector('[data-dbm-column-type-select]');
const colTypeText = () => editorEl().querySelector('[data-dbm-column-type]');
const colLength = () => editorEl().querySelector('[data-dbm-column-length]');
const colNullable = () => editorEl().querySelector('[data-dbm-column-nullable]');
const colCollate = () => editorEl().querySelector('[data-dbm-column-collate]');
const colAttr = () => editorEl().querySelector('[data-dbm-column-attr-select]');
const colIndex = () => editorEl().querySelector('[data-dbm-column-index]');
const colPosition = () => editorEl().querySelector('[data-dbm-column-position]');
const submitEditor = () => editorEl().querySelector('[data-dbm-column-submit]');
/** Find the 修改 button of a column's row. */
const editRow = (column) => {
  const cell = Array.from(document.querySelectorAll('.dbm-table tbody tr')).find((tr) => {
    const first = tr.querySelector('td.dbm-mono');
    return first !== null && (first.textContent || '').trim() === column;
  });
  if (cell === undefined) return null;
  return Array.from(cell.querySelectorAll('button')).find((b) => ['修改', 'Change'].includes((b.textContent || '').trim())) || null;
};

try {
  const row = Array.from(document.querySelectorAll('nav button[aria-label]')).find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim()));
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

  /* 数据源必须按 id 精确定位，不能回退到第一行。 */
  const sources = await api('/api/dsh-database/sources');
  const matches = sources.sources.filter((s) => s.name === ${JSON.stringify(SOURCE_NAME)});
  if (matches.length !== 1) return { fatal: 'the run data source did not resolve to one entry', n: matches.length };

  const connect = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn')).find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
  click(connect);
  await sleep(3500);

  const dbNode = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => {
    const label = el.querySelector('.dbm-node-name');
    return label !== null && (label.textContent || '').trim() === dbName;
  }) || null, 15000);
  if (dbNode === null) return { fatal: 'the database node is not in the tree', error: (document.querySelector('.dbm-error') || {}).textContent };
  click(dbNode);
  await sleep(1800);

  const tableLink = await waitFor(() => byText('.dbm-table .dbm-link', tableName), 12000);
  if (!tableLink) return { fatal: 'the seeded table is not in the overview', text: (document.querySelector('.dbm-table tbody') || {}).textContent };
  click(tableLink);
  await sleep(1800);
  click(byText('.dbm-tab', '结构') || byText('.dbm-tab', 'Structure'));
  await sleep(2000);

  // ---- 1. 新增列对话框：控件与建表页对齐 ---------------------------------
  click(byText('.dbm-btn', '+ ' + '新增列') || byIncludes('.dbm-btn', '新增列'));
  const editor = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
  if (editor === null) return { ...out, fatal: 'the add-column editor did not open' };

  /*
   * 弹窗宽度：一个竖排字段的表单不需要 1180px。
   *
   * 量的是**实际渲染宽度**而不是类名 —— 报的现象就是「那么宽」，所以用像素回答。
   * 参照是同一个面板里的默认宽度（560px），允许一点余量。
   */
  const modalBox = editor.querySelector('.dbm-modal') ?? editor;
  out.modalWidth = Math.round(modalBox.getBoundingClientRect().width);
  out.modalIsWide = modalBox.className.includes('dbm-modal-wide');
  check('the add-column dialog is not the extra-wide variant', out.modalIsWide === false, out.modalIsWide);
  check('the add-column dialog is about the default width, not 1180px', out.modalWidth <= 620, out.modalWidth);

  /*
   * 类型是分组下拉：optgroup 的存在就是「分组」的证据，而分组是这次明确要求的。
   * 同时那个「类型文本」字段必须不在了 —— 它被单独报告为「不需要」。
   */
  const typeSelect = colTypeSelect();
  out.hasTypeSelect = typeSelect !== null;
  check('the type control is a dropdown', out.hasTypeSelect === true);
  out.typeGroupCount = typeSelect === null ? 0 : typeSelect.querySelectorAll('optgroup').length;
  check('the type dropdown is GROUPED', out.typeGroupCount > 1, out.typeGroupCount);
  out.typeOptions = typeSelect === null ? [] : Array.from(typeSelect.querySelectorAll('option')).map((o) => o.value);
  check('the grouped list offers real types', out.typeOptions.includes('VARCHAR') || out.typeOptions.includes('TEXT'), out.typeOptions.slice(0, 6));
  out.hasSeparateTypeTextField = colTypeText() !== null;
  check('there is no separate 类型文本 field', out.hasSeparateTypeTextField === false);

  /*
   * 提交失败时，消息必须显现在**弹窗内部**。
   *
   * 报的现象是「提示没显示在弹窗里，显示在页面上，但页面又被弹窗遮挡了看不见」。所以
   * 判据有两半：消息存在，且它的**几何位置在弹窗内**、并且在视口里 —— 只查「页面上有
   * 一段错误文字」会漏掉被遮挡这个唯一的关键。
   */
  setInput(colName(), 'probe_fail');
  if (engine === 'mysql') {
    setSelect(colTypeSelect(), 'INT');
    await sleep(200);
    setInput(colLength(), 'not-a-number');
  } else {
    // SQLite：长度框禁用，所以用「列名为空」触发一次本地拒绝。
    setInput(colName(), '');
  }
  await sleep(200);
  click(submitEditor());
  await sleep(1200);
  const modalAfterRefusal = document.querySelector('.dbm-modal');
  const banner = modalAfterRefusal === null ? null : modalAfterRefusal.querySelector('.dbm-error');
  out.refusalInDialog = banner !== null;
  check('a refusal is shown INSIDE the dialog', out.refusalInDialog === true);
  if (banner !== null) {
    const bannerRect = banner.getBoundingClientRect();
    const modalRect = modalAfterRefusal.getBoundingClientRect();
    out.refusalGeometry = {
      text: (banner.textContent || '').slice(0, 80),
      insideModal: bannerRect.top >= modalRect.top - 1 && bannerRect.bottom <= modalRect.bottom + 1,
      inViewport: bannerRect.top >= 0 && bannerRect.bottom <= window.innerHeight + 1,
    };
    check('the refusal sits inside the dialog box', out.refusalGeometry.insideModal === true, out.refusalGeometry);
    check('the refusal is inside the viewport, not behind the overlay', out.refusalGeometry.inViewport === true, out.refusalGeometry);
  }
  /*
   * 改动表单会清掉上一条拒绝。
   *
   * 改的必须是拒绝所针对的**那个**字段：重新输入一个相同的值不会触发 onChange，测出来的
   * 会是「没清掉」而其实是「什么都没发生」——这一条第一次就是这样误报的。
   */
  if (engine === 'mysql') setInput(colLength(), '11');
  else setInput(colName(), 'probe_fail_2');
  await sleep(400);
  out.refusalClearedOnEdit = document.querySelector('.dbm-modal .dbm-error') === null;
  check('editing the form clears the stale refusal', out.refusalClearedOnEdit === true);

  // 长度框在（SQLite 上存在但禁用，MySQL 上可填）
  out.hasLengthField = colLength() !== null;
  check('the length field exists', out.hasLengthField === true);
  out.lengthDisabled = colLength() === null ? null : colLength().disabled;
  check('the length field is disabled exactly on SQLite', out.lengthDisabled === (engine === 'sqlite'), out.lengthDisabled);

  // 允许空默认不勾选
  out.nullableDefault = colNullable() === null ? null : colNullable().checked;
  check('允许空 is NOT ticked by default', out.nullableDefault === false, out.nullableDefault);

  // 排序规则与属性控件都在
  check('a collation control is offered', colCollate() !== null);
  check('an attribute control is offered', colAttr() !== null);

  // 「放在 xx 之后」：SQLite 上禁用并说明，MySQL 上可用
  out.positionDisabled = colPosition() === null ? null : colPosition().disabled;
  check('the 放在…之后 control exists for a new column', colPosition() !== null);
  check('it is disabled exactly on SQLite', out.positionDisabled === (engine === 'sqlite'), out.positionDisabled);

  // SQLite 上的 NOT NULL 无默认值必须在提交前就有提示；MySQL 上没有这条限制，所以不提示。
  out.sqliteWarning = editor.querySelector('[data-dbm-column-sqlite-warning]') !== null;
  check('the SQLite append refusal is warned about exactly on SQLite',
    out.sqliteWarning === (engine === 'sqlite'), out.sqliteWarning);

  /*
   * 报的那条 bug：往 INT 列的长度框里填**纯数字**被拒绝。
   *
   * 原来这里还有一道 takesLength(type) 判断，而 takesLength('INT') 是 **false**（INT
   * 在「不取长度」表里），所以合法输入被拦；并且消息的 {name} 传的是**类型**，于是提示写成
   * 「列「INT」的长度/值不合法」。两条都要钉住：提交必须**成功**，且提示里不该出现类型名。
   *
   * MySQL 侧的最终证据在下面回读 INT 列的类型；这里先确认对话框没有拒绝。
   */
  if (engine === 'mysql') {
    setInput(colName(), 'int_with_length');
    setSelect(colTypeSelect(), 'INT');
    await sleep(200);
    setInput(colLength(), '11');
    await sleep(200);
    click(submitEditor());
    await sleep(2800);
    const refusal = document.querySelector('.dbm-modal .dbm-error');
    out.intLengthRefusal = refusal === null ? null : (refusal.textContent || '');
    /*
     * No apostrophe in this label.
     *
     * The payload below is a template literal in the OUTER module, so a backslash-escaped
     * quote is UNESCAPED before the browser parses it: the string ends early and the whole
     * payload fails to parse, with the reported line pointing somewhere unhelpful. The same
     * hazard applies to backticks and to a dollar-brace, both of which appear in this file's
     * own header warning — which is why this sentence is spelled out rather than quoted.
     */
    check('a plain digit in the length box of an INT column is NOT refused', out.intLengthRefusal === null, out.intLengthRefusal);
    out.intLengthStillOpen = document.querySelector('.dbm-modal') !== null;
    check('the dialog closed, so the change was accepted', out.intLengthStillOpen === false, out.intLengthStillOpen);
  }

  // ---- 2. 真的加一列，并验证位置与允许空 --------------------------------
  if (document.querySelector('.dbm-modal') === null) {
    click(byText('.dbm-btn', '+ ' + '新增列') || byIncludes('.dbm-btn', '新增列'));
    await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    await sleep(300);
  }
  setInput(colName(), 'added_col');
  if (engine === 'mysql') {
    setSelect(colTypeSelect(), 'VARCHAR');
    await sleep(200);
    setInput(colLength(), '64');
    await sleep(200);
  } else {
    setInput(colName(), 'added_col');
  }
  // 允许空勾上，避免 SQLite 上必然的拒绝（这一条已在上面单独断言）
  if (!colNullable().checked) click(colNullable());
  await sleep(200);
  if (engine === 'mysql') {
    // 放在 first_col 之后：这是这次要求新增的能力，且只有 MySQL 真的支持。
    const positionOptions = Array.from(colPosition().querySelectorAll('option')).map((o) => o.value);
    check('the position dropdown lists the existing columns', positionOptions.includes('first_col'), positionOptions);
    setSelect(colPosition(), 'first_col');
    await sleep(200);
  }
  click(submitEditor());
  await sleep(3000);
  out.addError = (document.querySelector('.dbm-modal .dbm-error') ?? document.querySelector('.dbm-error') ?? {}).textContent || null;
  check('adding the column reported no error', out.addError === null, out.addError);

  const afterAdd = await api('/api/dsh-database/sources/' + matches[0].id + '/columns?schema=' + encodeURIComponent(dbName) + '&table=' + tableName);
  out.columnsAfterAdd = afterAdd.columns.map((c) => c.name);
  check('the new column exists', out.columnsAfterAdd.includes('added_col'), out.columnsAfterAdd);
  if (engine === 'mysql') {
    out.addedType = afterAdd.columns.find((c) => c.name === 'added_col').type;
    check('the length reached the declared type', /64/.test(out.addedType), out.addedType);
    check('the new column is AFTER first_col, not appended', out.columnsAfterAdd.indexOf('added_col') === out.columnsAfterAdd.indexOf('first_col') + 1, out.columnsAfterAdd);
  }

  // ---- 3. UNSIGNED / ZEROFILL 往返不重复发出 ---------------------------
  if (engine === 'mysql') {
    const amountTypes = afterAdd.columns.find((c) => c.name === 'amount');
    check('the reported type carries its modifier', amountTypes !== undefined && /unsigned/i.test(amountTypes.type), amountTypes);
    click(editRow('amount'));
    const editModal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    if (editModal === null) return { ...out, fatal: 'the edit-column editor did not open' };
    out.editorOpenedOn = colName().value;
    check('the editor opened on the column that was clicked', out.editorOpenedOn === 'amount', out.editorOpenedOn);
    /*
     * 编辑一个 UNSIGNED 列但**不动它**，提交后类型必须原样。
     *
     * 这是「属性」对齐的核心风险：如果既把 COLUMN_TYPE（'int unsigned'）原样当类型
     * 发回、又单独发 attributes 里的 unsigned，语句就变成 INT UNSIGNED UNSIGNED。
     * 实测 MySQL 接受并归一化，所以服务端不会报错 —— 只能靠回读断言。
     */
    check('the attribute list starts from the reported modifier', /unsigned/i.test(colAttr().textContent || '') || (colAttr().value === ''), (colAttr().textContent || '').slice(0, 60));
    const commentField = document.querySelector('[data-dbm-column-comment]');
    setInput(commentField, 'touched');
    await sleep(200);
    click(submitEditor());
    await sleep(2500);
    out.editError = (document.querySelector('.dbm-error') || {}).textContent || null;
    check('editing an UNSIGNED column reported no error', out.editError === null, out.editError);
  }

  return out;
} catch (error) {
  out.failures.push({ name: 'the flow threw', detail: String(error && error.stack ? error.stack : error) });
  return out;
}
})()`)

  if (report.fatal !== undefined) {
    console.error(`\nfatal: ${report.fatal}`)
    if (report.error !== undefined) console.error(`error: ${report.error}`)
    if (report.detail !== undefined) console.error(report.detail)
    process.exitCode = 1
  } else {
    for (const key of ['hasTypeSelect', 'typeGroupCount', 'hasSeparateTypeTextField', 'hasLengthField', 'lengthDisabled',
      'nullableDefault', 'positionDisabled', 'sqliteWarning', 'modalWidth', 'modalIsWide', 'refusalInDialog',
      'refusalClearedOnEdit', 'intLengthRefusal', 'intLengthStillOpen', 'addError', 'columnsAfterAdd', 'addedType',
      'editorOpenedOn', 'editError']) {
      if (report[key] !== undefined) console.log(`${key}: ${JSON.stringify(report[key])}`)
    }
    if (report.refusalGeometry !== undefined) console.log(`refusalGeometry: ${JSON.stringify(report.refusalGeometry)}`)
    for (const note of report.notes) check(note, true)
    for (const failure of report.failures) check(failure.name, false, failure.detail)
  }

  // ---- The server-side truth, read after the browser closed its form ------
  if (report.fatal === undefined && engine === 'mysql') {
    const columns = await inspectColumns()
    const amount = columns.find(column => column.name === 'amount')
    check('UNSIGNED was not doubled in the statement',
      amount !== undefined && amount.type.toLowerCase() === 'int unsigned', amount)
    const flag = columns.find(column => column.name === 'flag')
    check('ZEROFILL survived round-tripping untouched',
      flag !== undefined && /unsigned zerofill/i.test(flag.type), flag)
    const added = columns.find(column => column.name === 'added_col')
    check('the added column is nullable as the form asked', added !== undefined && added.nullable === true, added)
    const order = columns.map(column => column.name)
    check('the added column sits after first_col on the server too',
      order.indexOf('added_col') === order.indexOf('first_col') + 1, order)
    /*
     * 报的那条 bug 的**最终证据**：填进 INT 长度框的 11 真的落到服务端。
     *
     * 只看「对话框没报错」是不够的 —— 长度可能被丢掉而一句话都不说。MySQL 会把
     * `INT(11)` 归一化成 `int`（display width 从 8.0.19 起不再显示），所以判据是
     * 「列存在且类型仍是 int」，而不是「类型里带 (11)」。
     */
    const intColumn = columns.find(column => column.name === 'int_with_length')
    check('a digit in the length box of an INT column was accepted and reached the server',
      intColumn !== undefined && /^int$/i.test(intColumn.type), intColumn)
  }
  if (report.fatal === undefined && engine === 'sqlite') {
    const columns = await inspectColumns()
    const order = columns.map(column => column.name)
    check('SQLite appended the column at the end', order[order.length - 1] === 'added_col', order)
    const added = columns.find(column => column.name === 'added_col')
    // 这一条是「AFTER 污染类型名」那个陷阱的守门断言：类型里绝不能出现 AFTER。
    check('SQLite did not fold a position clause into the type name',
      added !== undefined && !/after/i.test(added.type), added)
  }
} finally {
  try {
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name === SOURCE_NAME)) {
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' })
      console.error(`note: removed the run's data source (${source.id})`)
    }
  } catch { /* best effort */ }
  if (engine === 'mysql') {
    try {
      const mysql = await import('mysql2/promise')
      const c = await mysql.createConnection({ host, port: Number(port), user, password })
      await c.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``)
      await c.end()
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
