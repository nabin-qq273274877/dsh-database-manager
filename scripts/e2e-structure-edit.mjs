import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/**
 * 结构页「编辑列」的端到端：编辑必须能提交成功，且默认值控件与建表时一样可选可输入。
 *
 * 复现的是用户报的那条：「编辑提交提示 操作失败：this generated column cannot be modified」。
 * 触发它的列其实是**普通的有默认值的列**（MySQL 对 DEFAULT CURRENT_TIMESTAMP 报的 EXTRA
 * 是 DEFAULT_GENERATED，被误判成生成列），所以脚本里同时放普通列、时间戳默认值列、真正的
 * 生成列，逐列提交并回读服务端。
 *
 * 默认值控件断言的是**行为**：模式下拉存在、选「自定义」后能输入、留空即空字符串、不动它就
 * 原样保留。只看「页面上有这个字段」是发现不了的——改动前那个字段也在，只是变成空框就会把
 * 默认值丢掉。
 *
 * 用法：
 *   node scripts/e2e-structure-edit.mjs <baseUrl-with-token> <sqliteFile>
 *   node scripts/e2e-structure-edit.mjs <baseUrl-with-token> <sqliteFile> mysql <host:port:user:password> <database>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9391

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
const engine = process.argv[4] ?? 'sqlite'
const connection = process.argv[5] ?? '127.0.0.1:3306:root:root'
const targetDatabase = process.argv[6] ?? 'dbm_e2e_edit'
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-structure-edit.mjs <baseUrl-with-token> <sqliteFile> [sqlite|mysql] [host:port:user:password] [database]')
  process.exit(2)
}
const [host, port, user, password] = connection.split(':')

const TAG = process.pid
const SOURCE_NAME = `E2E Edit ${TAG}`

/**
 * 造数：一张表放齐各类默认值，外加真正与「疑似」的生成列。
 *
 * 要覆盖的是这几类：
 *   - 普通 INT 默认 5（无误判风险，作为对照）
 *   - TIMESTAMP DEFAULT CURRENT_TIMESTAMP（MySQL 上 EXTRA=DEFAULT_GENERATED，曾经的误判源）
 *   - 字符串默认值（服务端读回来不带引号，曾经提交即被拒）
 *   - 空字符串默认值（曾经整段丢失）
 *   - 表达式默认值（曾经被当成字面量拒掉）
 *   - 真生成列（曾经完全不能改）
 */
async function seedMysql(database) {
  const mysql = await import('mysql2/promise')
  const c = await mysql.createConnection({
    host: host ?? '127.0.0.1', port: Number(port ?? 3306), user: user ?? 'root', password: password ?? '',
  })
  try {
    await c.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await c.query(`CREATE DATABASE \`${database}\` DEFAULT CHARACTER SET utf8mb4`)
    await c.query(`CREATE TABLE \`${database}\`.editable (
      id INT PRIMARY KEY AUTO_INCREMENT,
      plain INT NULL DEFAULT 5,
      ts TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      ts_on TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      s VARCHAR(20) NULL DEFAULT 'x',
      empty_s VARCHAR(20) NULL DEFAULT '',
      expr VARCHAR(20) NULL DEFAULT (LOWER('ABC')),
      gen_v INT GENERATED ALWAYS AS (plain + 1) VIRTUAL,
      gen_s INT GENERATED ALWAYS AS (plain * 2) STORED
    ) ENGINE=InnoDB`)
  } finally {
    await c.end()
  }
}

function seedSqlite(file) {
  const db = new DatabaseSync(file)
  db.exec('DROP TABLE IF EXISTS editable')
  db.exec(`CREATE TABLE editable (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plain INT DEFAULT 5,
    s TEXT DEFAULT 'x',
    empty_s TEXT DEFAULT '',
    expr TEXT DEFAULT (lower('ABC')),
    gen_v INT GENERATED ALWAYS AS (plain + 1) VIRTUAL,
    gen_s INT GENERATED ALWAYS AS (plain * 2) STORED
  )`)
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

const PRELUDE = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byText = (sel, text) =>
  Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
const byIncludes = (sel, text) =>
  Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
const waitFor = async (fn, ms) => {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(150); }
};
const setInput = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const setSelect = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
};const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
const errorText = () => {
  const banner = document.querySelector('.dbm-error');
  return banner === null ? null : (banner.textContent || '').trim();
};
const api = async (path, options) => {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error('API ' + path + ' -> ' + response.status + ': ' + (body && body.error ? body.error : 'no body'));
  return body;
};
`

const profile = mkdtempSync(join(tmpdir(), 'dbm-edit-'))
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
  if (engine === 'mysql') await seedMysql(targetDatabase)
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
${PRELUDE}
  const out = { failures: [], notes: [], rows: {} };
  const check = (name, ok, detail) => { if (ok) out.notes.push(name); else out.failures.push({ name, detail }); };
  const engine = ${JSON.stringify(engine)};
  const dbName = ${JSON.stringify(engine === 'mysql' ? targetDatabase : 'main')};

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
    if (!listed) return { fatal: 'the created source is not listed', error: errorText() };
    const sources = await api('/api/dsh-database/sources');
    const matches = sources.sources.filter((s) => s.name === ${JSON.stringify(SOURCE_NAME)});
    if (matches.length !== 1) return { fatal: 'the data source did not resolve to one entry' };
    const sourceId = matches[0].id;

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
    if (!dbNode) return { fatal: 'the database node is not in the tree' };
    click(dbNode);
    await sleep(1600);

    const tableLink = await waitFor(() => byText('.dbm-table .dbm-link', 'editable'), 12000);
    if (!tableLink) return { fatal: 'the table is not in the overview' };
    click(tableLink);
    await sleep(1600);

    click(byText('.dbm-tab', '结构') || byText('.dbm-tab', 'Structure'));
    await sleep(1800);

    /*
     * 编辑器必须一次只开一个。
     *
     * 踩过：第一段没关掉对话框，第二段再点「修改」时点击落在遮罩上，waitFor 于是返回了
     * **上一个**对话框，而它的 spec 属于另一列 —— 后续每一列的提交都在发上一列的定义，报出
     * 一串看似产品缺陷的错误（「不支持括号默认值」），而真正的原因在脚本里。
     */
    const closeDialog = async () => {
      const dialog = document.querySelector('.dbm-modal');
      if (dialog === null) return;
      const cancel = Array.from(dialog.querySelectorAll('.dbm-modal-foot .dbm-btn'))
        .find((b) => ['取消', 'Cancel'].includes((b.textContent || '').trim()));
      if (cancel !== undefined) click(cancel);
      await waitFor(() => document.querySelector('.dbm-modal') === null, 3000);
      await sleep(200);
    };

    /** 打开某一列的编辑器，先确保没有别的对话框开着。 */
    const openEditor = async (column) => {
      await closeDialog();
      const cell = await waitFor(() => {
        return Array.from(document.querySelectorAll('.dbm-table tbody tr')).find((tr) => {
          const nameCell = tr.querySelector('td.dbm-mono');
          return nameCell !== null && (nameCell.textContent || '').trim() === column;
        }) || null;
      }, 8000);
      if (cell === null) return null;
      // 按钮文案是「修改」/「Change」，不是「编辑」——照着 locales 里的键值取，
      // 否则会得到一个「打开不了编辑器」的假失败。
      const edit = Array.from(cell.querySelectorAll('.dbm-btn')).find((b) => ['修改', 'Change'].includes((b.textContent || '').trim()));
      if (edit === undefined) return null;
      click(edit);
      const dialog = await waitFor(() => document.querySelector('[data-dbm-column-submit]') === null ? null : document.querySelector('.dbm-modal'), 5000);
      if (dialog === null) return null;
      // 记下这一列的名字，下一步据此断言对话框确实是给它的 —— 这正是上面踩过的坑。
      out.opened = column;
      return dialog;
    };

    /** 提交编辑器，返回错误条内容（null 表示成功）。 */
    const submitEditor = async (dialog) => {
      click(dialog.querySelector('[data-dbm-column-submit]'));
      await sleep(2500);
      return errorText();
    };

    /** 编辑器里「注释」那一格。 */
    const commentControl = (dialog) => {
      const field = Array.from(dialog.querySelectorAll('.dbm-field')).find((f) => {
        const label = (f.querySelector('.dbm-field-label') || {}).textContent;
        return label === '注释' || label === 'Comment';
      });
      return field === undefined ? null : field.querySelector('input.dbm-input');
    };

    /**
     * 改这一列的类型，用**当前**的类型控件。
     *
     * 类型控件从「扁平下拉 + 常驻的类型文本框」改成了建表页那种**分组下拉**，文本框只在
     * 选「自定义」时出现（见上面的类型控件断言）。所以要改类型，得从下拉里选一个列表内的
     * 类型，而不是往文本框里打字。
     *
     * 返回实际用上的控件，好让调用方能在 null 上给出可读的失败。
     */
    const setType = (dialog, type) => {
      const select = dialog.querySelector('[data-dbm-column-type-select]');
      if (select !== null) {
        const option = Array.from(select.options).find((o) => o.value === type);
        if (option !== undefined) { setSelect(select, type); return select }
      }
      // 列表里没有（或已经处于自定义态）：退回文本框，它此时才是可用的那个控件。
      const text = dialog.querySelector('[data-dbm-column-type]');
      if (text === null) return null;
      setInput(text, type);
      return text;
    };

    /* ---- 1. 默认值控件是「模式下拉 + 可输入」，与建表一致 ---- */
    const probe = await openEditor('plain');
    if (probe === null) return { fatal: 'could not open the editor for plain' };
    /*
     * 「自定义」这一态下渲染的是输入框，不是下拉 —— 和建表表单的形态一致。
     * 所以要看下拉，得先点 ↺ 回到列表。不了解这一点会得出「没有模式下拉」的错误结论。
     */
    const customText = probe.querySelector('[data-dbm-column-default-text]');
    out.defaultControl = { customMode: customText !== null, prefill: customText === null ? null : customText.value };
    check('已有默认值直接进入可输入态', customText !== null, out.defaultControl)
    check('输入框预填了现有默认值 5', customText !== null && customText.value === '5', out.defaultControl.prefill)

    const backToList = probe.querySelector('[data-dbm-column-default-list]');
    check('有返回默认值列表的按钮', backToList !== null, null)
    if (backToList !== null) {
      click(backToList);
      await sleep(400);
      const modeSelect = probe.querySelector('[data-dbm-column-default-mode]');
      out.defaultControl.modeOptions = modeSelect === null ? null : Array.from(modeSelect.options).map((o) => o.value)
      out.defaultControl.modeValue = modeSelect === null ? null : modeSelect.value
      check('返回后出现模式下拉', modeSelect !== null, out.defaultControl)
      // 「不设置 / 自定义… / NULL / CURRENT_TIMESTAMP」四态，与建表同一套。
      check('下拉提供四态', JSON.stringify(out.defaultControl.modeOptions) === JSON.stringify(['none', 'custom', 'null', 'currentTimestamp']), out.defaultControl.modeOptions)
      check('返回列表后落在「不设置」上', out.defaultControl.modeValue === 'none', out.defaultControl.modeValue)
    }
    await closeDialog();

    /* ---- 2. 各类列都能提交成功（用户报的失败就是这里） ---- */
    const columns = ['plain', 's', 'empty_s', 'expr', 'gen_v', 'gen_s'];
    if (engine === 'mysql') columns.push('ts', 'ts_on');
    for (const column of columns) {
      const dialog = await openEditor(column);
      if (dialog === null) { check('可以打开「' + column + '」的编辑器', false); continue }
      /*
       * 改一样真正存在的东西：MySQL 改注释，SQLite 改类型。
       *
       * SQLite 没有列注释（COMMENT 子句不存在），拿注释去试会得到一个「提交成功但什么
       * 都没变」的结果，而这不是这次要验的东西。类型两边都有，改完还能回读核对。
       */
      if (engine === 'mysql') {
        const comment = commentControl(dialog);
        if (comment === null) { check('「' + column + '」的对话框里有注释字段', false); await closeDialog(); continue }
        setInput(comment, 'touched-' + column);
      } else {
        /*
         * SQLite: change the type through the grouped dropdown.
         *
         * The type control is a LIST now (aligned with 新建表), so the change is a
         * selection rather than typing into a text box. BIGINT is in the integer group on
         * both engines' lists.
         */
        const control = setType(dialog, 'BIGINT');
        if (control === null) { check('「' + column + '」的对话框里有类型控件', false); await closeDialog(); continue }
      }
      await sleep(200);
      const failure = await submitEditor(dialog);
      out.rows[column] = failure;
      check('「' + column + '」改一处能提交成功', failure === null, failure)
    }

    /* ---- 3. 服务端核对：改动写进去了，且其它定义没被改动 ---- */
    const after = await api('/api/dsh-database/sources/' + sourceId + '/columns?schema=' + encodeURIComponent(dbName) + '&table=editable');
    const byName = {};
    for (const column of after.columns) byName[column.name] = column;
    /*
     * 注释只对 MySQL 有意义 —— SQLite 没有列注释（COMMENT 子句根本不存在），
     * 所以那边的改动换成类型，断言也跟着换。否则会得到一串「注释没保存」的假失败。
     */
    for (const column of columns) {
      const info = byName[column];
      if (info === undefined) { check('服务端仍有「' + column + '」', false); continue }
      if (engine === 'mysql') check('「' + column + '」的注释已保存', info.comment === 'touched-' + column, info.comment)
      // 生成列的类型会被重建带过去 —— 这是「改动确实落库」的证据。
      else if (column.startsWith('gen_')) check('「' + column + '」的类型改动已保存', info.type === 'BIGINT', info.type)
    }
    out.after = Object.fromEntries(columns.map((n) => [n, { type: byName[n] && byName[n].type, default: byName[n] && byName[n].defaultValue, generated: byName[n] && byName[n].generated }]));
    // 生成列仍是生成列，表达式没被替换掉。
    for (const column of ['gen_v', 'gen_s']) {
      check('「' + column + '」仍然是生成列', byName[column] !== undefined && byName[column].generated === true, out.after[column])
    }
    /*
     * 默认值必须还在，且空字符串默认值不能被并成「没有默认值」。
     *
     * 两个引擎的形态不同，所以要按引擎比对：SQLite 保留字面量文本（双引号包着的空串、
     * 单引号包着的 x），MySQL 把引号去掉（空值、裸 x）。
     * 用同一套期望去套两边，必然有一边是假失败。
     */
    const expectedEmpty = engine === 'mysql' ? '' : "''";
    const expectedStr = engine === 'mysql' ? 'x' : "'x'";
    const empty = byName['empty_s'];
    check('空字符串默认值没有被丢掉', empty !== undefined && empty.defaultValue === expectedEmpty, empty === undefined ? null : empty.defaultValue)
    const str = byName['s'];
    check('字符串默认值 x 还在', str !== undefined && str.defaultValue === expectedStr, str === undefined ? null : str.defaultValue)
    // 表达式默认值也必须还在。
    const expr = byName['expr'];
    if (engine === 'mysql') {
      check('表达式默认值还在', expr !== undefined && /lower/i.test(String(expr.defaultValue)), expr === undefined ? null : expr.defaultValue)
    } else {
      check('表达式默认值还在', expr !== undefined && /lower/i.test(String(expr.defaultValue)), expr === undefined ? null : expr.defaultValue)
    }
    check('普通默认值 5 还在', byName['plain'] !== undefined && String(byName['plain'].defaultValue) === '5', byName['plain'] === undefined ? null : byName['plain'].defaultValue)
    if (engine === 'mysql') {
      check('ON UPDATE 子句没被丢掉', /on update/i.test(String(byName['ts_on'] && byName['ts_on'].extra)), byName['ts_on'] === undefined ? null : byName['ts_on'].extra)
    }

    /**
     * Set the default control to a mode that is not 自定义.
     *
     * 自定义 renders a text box INSTEAD of the dropdown (the same swap the 新建表 form
     * makes), so getting back to the list means pressing ↺ first — there is no dropdown
     * to select from while it is in that state.
     */
    const chooseMode = async (dialog, mode) => {
      const back = dialog.querySelector('[data-dbm-column-default-list]');
      if (back !== null) {
        click(back);
        await sleep(400);
      }
      const select = dialog.querySelector('[data-dbm-column-default-mode]');
      if (select === null) return null;
      setSelect(select, mode);
      await sleep(400);
      return select;
    };

    /** Put the default control into 自定义 and type the value ('' means the empty string). */
    const typeCustom = async (dialog, value) => {
      await chooseMode(dialog, 'custom');
      const text = dialog.querySelector('[data-dbm-column-default-text]');
      if (text === null) return false;
      setInput(text, value);
      await sleep(200);
      return true;
    };

    /** Read one column's reported default back from the server. */
    const defaultOf = async (sourceId, dbName, column) => {
      const reread = await api('/api/dsh-database/sources/' + sourceId + '/columns?schema=' + encodeURIComponent(dbName) + '&table=editable');
      const found = reread.columns.find((c) => c.name === column);
      return found === undefined ? undefined : found.defaultValue;
    };

    /* ---- 4. 能把默认值改成别的（「定义时可以输入」） ---- */
    const editDialog = await openEditor('plain');
    if (editDialog !== null) {
      const typed = await typeCustom(editDialog, '42');
      check('切到自定义后出现输入框', typed === true, null);
      const failure = await submitEditor(editDialog);
      check('改成 42 能提交成功', failure === null, failure);
      const stored = await defaultOf(sourceId, dbName, 'plain');
      check('服务端默认值确实是 42', String(stored) === '42', stored);
    }

    /* ---- 5. 能把默认值改成空字符串（不是「没有默认值」） ---- */
    /*
     * 用 TEXT 列，不用 INT 列。
     *
     * MySQL 对整数列拒绝空字符串默认值（实测 "Invalid default value for 'plain'"），
     * 那是引擎的正确行为而不是缺陷；空字符串默认值只对文本列有意义，这也正是四态控件里
     * 「自定义 + 留空」存在的理由。
     */
    const emptyTarget = engine === 'mysql' ? 's' : 'plain';
    const emptyDialog = await openEditor(emptyTarget);
    if (emptyDialog !== null) {
      const typed = await typeCustom(emptyDialog, '');
      check('空字符串也能输入', typed === true, null);
      const failure = await submitEditor(emptyDialog);
      check('改成空字符串能提交成功', failure === null, failure);
      const stored = await defaultOf(sourceId, dbName, emptyTarget);
      /*
       * 关键区别：空字符串是「有默认值」，不能变成 NULL/无默认值。
       * 两个引擎的形态不同 —— SQLite 保留字面量文本，MySQL 去掉引号变成空值。
       */
      const expected = engine === 'mysql' ? '' : "''";
      check('服务端存的是空字符串而不是 NULL', stored === expected, JSON.stringify(stored));
    }

    /* ---- 6. 能把默认值改成「不设置」 ---- */
    const noneDialog = await openEditor('plain');
    if (noneDialog !== null) {
      const select = await chooseMode(noneDialog, 'none');
      check('能选到「不设置」', select !== null, null);
      const failure = await submitEditor(noneDialog);
      check('改成不设置能提交成功', failure === null, failure);
      const stored = await defaultOf(sourceId, dbName, 'plain');
      check('服务端已经没有默认值', stored === undefined, JSON.stringify(stored));
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
    process.exitCode = 1
  } else {
    if (report.defaultControl !== undefined) console.log(`default control: ${JSON.stringify(report.defaultControl)}`)
    if (report.rows !== undefined) console.log(`submit results: ${JSON.stringify(report.rows, null, 1)}`)
    if (report.after !== undefined) console.log(`after: ${JSON.stringify(report.after, null, 1)}`)
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
  try { socket?.close() } catch { /* gone */ }
  child.kill()
  await wait(1000)
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}

const failed = checks.filter(entry => !entry.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
