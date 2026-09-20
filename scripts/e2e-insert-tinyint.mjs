import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/**
 * 「插入页的 tinyint 必须是输入框」的端到端验证（只对 MySQL 有意义的那个引擎）。
 *
 * 断言的是**控件形态**而不是文案：tinyint(1) 那一格必须是 INPUT，不是 SELECT。
 * 只查「页面上有这个字段」是发现不了的——两版都有这个字段，区别只在于它是不是下拉。
 *
 * 顺带把同一张表里的其它类型也量一遍，因为这次改动的风险正是「改到了不该改的列」：
 * MySQL 的 BOOL / BOOLEAN / TINYINT(1) 三种写法读回来都是 tinyint(1)（实测），所以它们
 * 必须一起变成输入框；而 SQLite 的 BOOLEAN 是另一种声明类型，仍该是「是/否」下拉。
 *
 * 用法：
 *   node scripts/e2e-insert-tinyint.mjs <baseUrl-with-token> <sqliteFile> mysql <host:port:user:password> <database>
 *   node scripts/e2e-insert-tinyint.mjs <baseUrl-with-token> <sqliteFile>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9381

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
const engine = process.argv[4] ?? 'sqlite'
const connection = process.argv[5] ?? '127.0.0.1:3306:root:root'
const targetDatabase = process.argv[6] ?? 'dbm_e2e_tinyint'
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-insert-tinyint.mjs <baseUrl-with-token> <sqliteFile> [sqlite|mysql] [host:port:user:password] [database]')
  process.exit(2)
}
const [host, port, user, password] = connection.split(':')

const TAG = process.pid
const SOURCE_NAME = `E2E Tinyint ${TAG}`

/** MySQL 侧的造数：把三种写法与其它常见类型放在一张表里。 */
async function seedMysql(database) {
  const mysql = await import('mysql2/promise')
  const c = await mysql.createConnection({
    host: host ?? '127.0.0.1', port: Number(port ?? 3306), user: user ?? 'root', password: password ?? '',
  })
  try {
    await c.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await c.query(`CREATE DATABASE \`${database}\` DEFAULT CHARACTER SET utf8mb4`)
    await c.query(
      `CREATE TABLE \`${database}\`.kinds (
        id INT PRIMARY KEY AUTO_INCREMENT,
        bool_col BOOL,
        boolean_col BOOLEAN,
        tiny1 TINYINT(1),
        tiny TINYINT,
        big BIGINT,
        dec_col DECIMAL(10,2),
        d DATE,
        dt DATETIME,
        v VARCHAR(20),
        t TEXT,
        e ENUM('on','off')
      )`,
    )
  } finally {
    await c.end()
  }
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
};
const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
const api = async (path) => {
  const response = await fetch(path);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error('API ' + path + ' -> ' + response.status + ': ' + (body && body.error ? body.error : 'no body'));
  return body;
};
`

const profile = mkdtempSync(join(tmpdir(), 'dbm-tinyint-'))
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
  const out = { failures: [], notes: [] };
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
    if (!listed) return { fatal: 'the created source is not listed', error: (document.querySelector('.dbm-error') || {}).textContent };
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

    const tableName = engine === 'mysql' ? 'kinds' : 'kinds';
    const tableLink = await waitFor(() => byText('.dbm-table .dbm-link', tableName), 12000);
    if (!tableLink) return { fatal: 'the table is not in the overview', text: (document.querySelector('.dbm-table tbody') || {}).textContent };
    click(tableLink);
    await sleep(1600);

    click(byText('.dbm-tab', '插入') || byText('.dbm-tab', 'Insert'));
    await sleep(1600);

    /*
     * 每个字段的控件：标签名 + type + inputMode。
     *
     * 三个都要记，因为数值输入框不带 type —— 组件只给它 inputMode（手机上弹数字键盘），
     * 所以它在 DOM 里就是一个 INPUT:text，和普通文本框长得一模一样。只记 tagName+type
     * 的话，「数值框」与「文本框」无法区分，而这两者的区别正是这次改动的一部分。
     */
    const controlOf = (column) => {
      const el = document.querySelector('[data-dbm-insert-for$=":' + column + '"]');
      if (el === null) return null;
      if (el.tagName === 'SELECT') return 'SELECT';
      const tag = el.tagName + (el.type ? ':' + el.type : '');
      return el.inputMode ? tag + '|inputMode=' + el.inputMode : tag;
    };
    out.controls = {};
    for (const column of ['id', 'big', 'dec_col', 'd', 'dt', 'v', 't', 'e']) {
      out.controls[column] = controlOf(column);
    }
    for (const column of ['bool_col', 'boolean_col', 'tiny1', 'tiny']) {
      out.controls[column] = controlOf(column);
    }
    for (const key of Object.keys(out.controls)) {
      if (out.controls[key] === null) delete out.controls[key];
    }
    out.mysql = {
      bool_col: out.controls.bool_col ?? null,
      boolean_col: out.controls.boolean_col ?? null,
      tiny1: out.controls.tiny1 ?? null,
      tiny: out.controls.tiny ?? null,
    }

    if (engine === 'mysql') {
      /*
       * 这张表的三列都在服务端是 tinyint(1)，所以三列必须是数值输入框。
       *
       * 断言逐列给出，而不是只断言其中一列：改动要覆盖的正是「三种写法」，只量
       * TINYINT(1) 那一列的话，BOOL 与 BOOLEAN 两列是否跟着改就没人检查了。
       */
      for (const column of ['bool_col', 'boolean_col', 'tiny1', 'tiny']) {
        // 判据是 tagName：这一列要的是「能自己填值的输入框」，而不是「两个选项的下拉」。
        check('tinyint 列是输入框而不是下拉: ' + column, out.mysql[column] !== null && out.mysql[column].startsWith('INPUT'), out.mysql[column]);
      }
      // 而且它接受 2 这种非布尔值——这正是改成输入框的理由。
      const tinyField = document.querySelector('[data-dbm-insert-for$=":tiny1"]');
      if (tinyField !== null) {
        setInput(tinyField, '2');
        await sleep(200);
        click(byText('.dbm-tab-body .dbm-btn', '插入') || byText('.dbm-tab-body .dbm-btn', 'Insert'));
        await sleep(2500);
        const stored = await api('/api/dsh-database/sources/' + sourceId + '/rows?schema=' + encodeURIComponent(dbName) + '&table=kinds&page=1&pageSize=10&mode=browse');
        out.storedTiny = stored.page.rows[0] === undefined ? null : stored.page.rows[0]['tiny1'];
        check('tinyint(1) 真的存下了 2', Number(out.storedTiny) === 2, { stored: out.storedTiny, error: (document.querySelector('.dbm-error') || {}).textContent || null });
      } else {
        check('the tiny1 field is present', false);
      }
      // 枚举仍然是下拉，别的类型没有被这次改动波及。
      check('enum 仍是下拉', out.controls.e === 'SELECT', out.controls.e);
      check('date 仍是日期选择器', out.controls.d === 'INPUT:date', out.controls.d);
      check('datetime 仍是日期时间选择器', out.controls.dt === 'INPUT:datetime-local', out.controls.dt);
      /*
       * 数值列（整数、小数）弹数字键盘，文本列不弹 —— 用 inputMode 判定，不是因为它是
       * 更好的写法，而是因为别处判不出来：两种控件在 DOM 里都是 INPUT:text。
       */      check('整数列弹数字键盘', out.controls.big === 'INPUT:text|inputMode=numeric', out.controls.big);
      check('小数列弹小数键盘', out.controls.dec_col === 'INPUT:text|inputMode=decimal', out.controls.dec_col);
      check('varchar 是普通文本框', out.controls.v === 'INPUT:text', out.controls.v);
      check('text 是多行框', out.controls.t === 'TEXTAREA:textarea', out.controls.t);
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
    if (report.controls !== undefined) console.log(`controls: ${JSON.stringify(report.controls)}`)
    if (report.mysql !== undefined) console.log(`mysql tinyint-ish: ${JSON.stringify(report.mysql)}`)
    if (report.storedTiny !== undefined) console.log(`stored tiny1: ${JSON.stringify(report.storedTiny)}`)
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
