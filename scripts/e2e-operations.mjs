import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/**
 * 「操作」tab 的端到端：真实浏览器里走完移动表 / 表选项 / 复制表 / 删除数据或表。
 *
 * 单元与驱动测试证明 SQL 是对的；它们证明不了面板把这些手势接对了——tab 出现的位置、
 * 块在引擎不支持时是否禁用并写明原因、表选项表单预填的是不是服务端的实时值、保存后
 * 是否只提交改过的字段、移动后右侧是否跟着走。那些是 DOM 事件问题，所以在真实浏览器里
 * 用真实鼠标事件回答，而且每一次写入都回读服务端核对。
 *
 * 两个转义陷阱：
 *  1. 页面代码是本模块的模板字面量，正则里的反斜杠会被外层吃掉；用字符串方法或
 *     RegExp 构造器（反斜杠写两遍）。
 *  2. 页面代码里的美元符号只在后面不是花括号时安全；URL 用拼接。
 *
 * 用法：
 *   node scripts/e2e-operations.mjs <baseUrl-with-token> <sqliteFile>
 *   node scripts/e2e-operations.mjs <baseUrl-with-token> <sqliteFile> mysql <host:port:user:password> <database>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9371

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
const engine = process.argv[4] ?? 'sqlite'
const connection = process.argv[5] ?? '127.0.0.1:3306:root:root'
const targetDatabase = process.argv[6] ?? 'dbm_e2e_ops'
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-operations.mjs <baseUrl-with-token> <sqliteFile> [sqlite|mysql] [host:port:user:password] [database]')
  process.exit(2)
}
const [host, port, user, password] = connection.split(':')

/** 本运行创建的名字，都带 pid，避免残留被误认成自己的。 */
const TAG = process.pid
const SOURCE_NAME = `E2E Ops ${TAG}`
/** 本运行可能创建的数据库，结束时清理。 */
const createdDatabases = [`${targetDatabase}_copy_${TAG}`]

/**
 * MySQL 侧的造数：一个带自增键、唯一列、索引与注释的表，一个视图，以及一个空的
 * 目标库。
 *
 * 目标库在这里就建出来，而不是等跑到复制那一步再建：面板的「目标（库.表）」是一个
 * **下拉**，选项来自面板打开时已知的库列表；库在之后才出现的话，那个选项根本不在下拉里，
 * setSelect 设一个不存在的值等于什么都没做——实测就是这样，随后的复制被 MySQL 以
 * "Unknown database" 拒绝，而错误条没人看，直到读目标库时才以一句「no such table」
 * 暴露出来，指向一个从没建成的库。
 */
async function seedMysql(database, copyDatabase) {
  const mysql = await import('mysql2/promise')
  const connection = await mysql.createConnection({
    host: host ?? '127.0.0.1',
    port: Number(port ?? 3306),
    user: user ?? 'root',
    password: password ?? '',
  })
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${copyDatabase}\``)
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await connection.query(`CREATE DATABASE \`${database}\` DEFAULT CHARACTER SET utf8mb4`)
    await connection.query(`CREATE DATABASE \`${copyDatabase}\` DEFAULT CHARACTER SET utf8mb4`)
    await connection.query(
      `CREATE TABLE \`${database}\`.ops_target (id INT PRIMARY KEY AUTO_INCREMENT, v VARCHAR(20) UNIQUE, KEY ix_ops_v (v)) ENGINE=InnoDB COMMENT='before' ROW_FORMAT=DYNAMIC`,
    )
    await connection.query(`INSERT INTO \`${database}\`.ops_target (v) VALUES ('a'),('b'),('c')`)
    await connection.query(`CREATE VIEW \`${database}\`.ops_view AS SELECT * FROM \`${database}\`.ops_target`)
  } finally {
    await connection.end()
  }
}

/** SQLite 侧的造数：同样的形状，加上一个视图。 */
function seedSqlite(file) {
  const db = new DatabaseSync(file)
  db.exec('DROP VIEW IF EXISTS ops_view')
  db.exec('DROP TABLE IF EXISTS ops_target')
  db.exec("CREATE TABLE ops_target (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT UNIQUE, note TEXT DEFAULT 'x')")
  db.exec('CREATE INDEX ix_ops_v ON ops_target(v)')
  db.exec("INSERT INTO ops_target(v) VALUES ('a'), ('b'), ('c')")
  db.exec('CREATE VIEW ops_view AS SELECT id, v FROM ops_target')
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

/** 页面侧的前置工具。 */
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
/*
 * 按库名找树里的库节点，不看 data-active，也不看整行的文本。
 *
 * 两处都踩过：
 *  1. data-active 每一行都会渲染（值是真或假两种字符串），所以 [data-active] 匹配「所有」库节点，
 *     querySelector 还回列表里的第一个 —— 实测点到了字母序在前的另一个库，随后整段断言都在读
 *     那个库的表。
 *  2. 整行文本以展开箭头开头（"▾库名"），startsWith(库名) 因此永远不成立。用 .dbm-node-name
 *     里的名字比对。
 */
const dbNodeByName = (name) =>
  Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item'))
    .find((el) => {
      const label = el.querySelector('.dbm-node-name');
      return label !== null && (label.textContent || '').trim() === name;
    }) || null;
/** 面板顶部的错误条内容，或 null。 */
const errorText = () => {
  const banner = document.querySelector('.dbm-error');
  return banner === null ? null : (banner.textContent || '').trim();
};
/** 面板顶部的成功提示内容，或 null。 */
const noticeText = () => {
  const banner = document.querySelector('.dbm-ok');
  return banner === null ? null : (banner.textContent || '').trim();
};
const api = async (path, options) => {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error('API ' + path + ' -> ' + response.status + ': ' + (body && body.error ? body.error : 'no body'));
  return body;
};
`

const profile = mkdtempSync(join(tmpdir(), 'dbm-ops-'))
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
  if (engine === 'mysql') await seedMysql(targetDatabase, createdDatabases[0])
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
  const out = { failures: [], notes: [], steps: [] };
  const check = (name, ok, detail) => { if (ok) out.notes.push(name); else out.failures.push({ name, detail }); };
  const step = (name) => out.steps.push(name);

  const engine = ${JSON.stringify(engine)};
  const dbName = ${JSON.stringify(engine === 'mysql' ? targetDatabase : 'main')};
  const otherDb = ${JSON.stringify(engine === 'mysql' ? `${targetDatabase}_copy_${TAG}` : 'other')};

  try {
    // ---- 打开面板并创建数据源 -------------------------------------------
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
    if (matches.length !== 1) return { fatal: 'the run data source did not resolve to one entry', n: matches.length };
    const sourceId = matches[0].id;

    const connect = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn'))
      .find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
    click(connect);
    await sleep(3500);

    const dbNode = await waitFor(() => byIncludes('.dbm-side-body .dbm-tree-item', dbName), 15000);
    if (!dbNode) return { fatal: 'the database node is not in the tree', error: (document.querySelector('.dbm-error') || {}).textContent };
    click(dbNode);
    await sleep(1500);

    // ---- requirement 1: 操作 tab 存在，且排在最后 -------------------------
    const tableLink = await waitFor(() => byText('.dbm-table .dbm-link', 'ops_target'), 12000);
    if (!tableLink) return { fatal: 'the seeded table is not in the overview', text: (document.querySelector('.dbm-table tbody') || {}).textContent };
    click(tableLink);
    await sleep(1800);

    const tabs = Array.from(document.querySelectorAll('.dbm-tab')).map((el) => (el.textContent || '').trim());
    out.tabs = tabs;
    const opLabels = ['操作', 'Operations'];
    const opTab = Array.from(document.querySelectorAll('.dbm-tab')).find((el) => opLabels.includes((el.textContent || '').trim()));
    check('the 操作 tab is rendered', opTab !== undefined, tabs);
    // 位置：排在所有 tab 的最后一位。一个「能删表」的页签不该夹在只读写行的页签之间。
    check('the 操作 tab is the LAST tab', tabs.length > 0 && opLabels.includes(tabs[tabs.length - 1]), tabs);

    if (!opTab) return out;
    click(opTab);
    await sleep(1500);

    const page = document.querySelector('[data-dbm-op-page]');
    check('clicking it opens the operations page', page !== null);
    if (page === null) return out;

    // ---- requirement 1: 五个区块齐备 --------------------------------------
    const blocks = Array.from(document.querySelectorAll('[data-dbm-op-block]')).map((el) => el.getAttribute('data-dbm-op-block'));
    out.blocks = blocks;
    for (const name of ['move', 'options', 'copy', 'maintain', 'danger']) {
      check('the block is present: ' + name, blocks.includes(name), blocks);
    }
    // 顺序与 phpMyAdmin 一致：先移动、再表选项、再复制、再维护、最后删除。
    check('the blocks are in phpMyAdmin\\u0027s order', blocks.join(',') === 'move,options,copy,maintain,danger', blocks);

    // 标题文案用的是 phpMyAdmin 的说法，用户是按这名字找过来的。
    const text = page.textContent || '';
    for (const wanted of ['将数据表移动到', '表选项', '将数据表复制到', '表维护', '删除数据或数据表']) {
      check('the heading is present: ' + wanted, text.includes(wanted));
    }

    // ---- requirement 1: 维护四个按钮 + 危险两个 ---------------------------
    const maint = {};
    for (const op of ['check', 'optimize', 'repair', 'analyze']) {
      const btn = page.querySelector('[data-dbm-op-maint="' + op + '"]');
      maint[op] = btn === null ? null : { disabled: btn.disabled, supported: btn.getAttribute('data-dbm-op-maint-supported') === 'true' };
      check('a maintenance button is rendered: ' + op, btn !== null);
    }
    out.maintenance = maint;
    // SQLite 没有 REPAIR：按钮仍在（请求里点名要的四个），但标记为不支持。
    const wantRepair = engine === 'mysql';
    check('the repair button matches the engine', maint.repair !== null && maint.repair.supported === wantRepair, maint.repair);
    for (const key of ['truncate', 'drop']) {
      check('a destructive button is present: ' + key, page.querySelector('[data-dbm-op-danger="' + key + '"]') !== null);
    }

    // ---- requirement 1: 引擎不支持时要禁用并写明原因 -----------------------
    if (engine === 'sqlite') {
      const moveSubmit = page.querySelector('[data-dbm-op-submit="move"]');
      const copySubmit = page.querySelector('[data-dbm-op-submit="copy"]');
      check('SQLite does not offer the move form', moveSubmit === null);
      check('SQLite does not offer the copy form', copySubmit === null);
      check('SQLite says why moving is unavailable', text.includes('SQLite 的库就是一个文件'));
      check('SQLite says why copying is unavailable', text.includes('SQLite 没有忠实的复制表语句'));
      check('SQLite says why table options are unavailable', text.includes('SQLite 没有可修改的表选项'));
      // 但危险区块仍可用：清空和删除在 SQLite 上是能做且做过的事。
      const drop = page.querySelector('[data-dbm-op-danger="drop"]');
      check('the destructive block is still usable on SQLite', drop !== null && drop.disabled === false);
    }

    // ---- requirement 1: 视图上不该出现可点的清空 ---------------------------
    // 回表列表，打开视图，再进操作页。
    const dbNode2 = dbNodeByName(dbName);
    if (dbNode2 !== null) { click(dbNode2); await sleep(1600); }
    /*
     * 回表列表后先确认它真的渲染了。
     *
     * 失败过的写法是直接 waitFor 视图名：视图没出现时只留下「视图不在列表里」一条，
     * 分不清是「列表没渲染」还是「列表里确实没有视图」——而这两者的原因完全不同。
     * 这里把列表的内容一并记录下来，下一步的失败就能自己说明是哪种。
     */
    const overviewLinks = await waitFor(
      () => {
        const links = Array.from(document.querySelectorAll('.dbm-table .dbm-link')).map((el) => (el.textContent || '').trim());
        return links.length > 0 ? links : null;
      },
      10000,
    );
    out.overviewLinks = overviewLinks;
    check('clicking the database returns to the table list', overviewLinks !== null, overviewLinks);
    check('the view is listed in the overview', (overviewLinks || []).includes('ops_view'), overviewLinks);

    const viewLink = (overviewLinks || []).includes('ops_view')
      ? byText('.dbm-table .dbm-link', 'ops_view')
      : null;
    if (viewLink !== null) {
      click(viewLink);
      await sleep(1500);
      const opTab2 = Array.from(document.querySelectorAll('.dbm-tab')).find((el) => opLabels.includes((el.textContent || '').trim()));
      click(opTab2);
      await sleep(1600);
      const viewPage = document.querySelector('[data-dbm-op-page]');
      const viewTruncate = viewPage === null ? null : viewPage.querySelector('[data-dbm-op-danger="truncate"]');
      out.viewTruncate = viewTruncate === null ? null : { disabled: viewTruncate.disabled, title: viewTruncate.title };
      check('emptying is disabled on a view', viewTruncate !== null && viewTruncate.disabled === true, out.viewTruncate);
      check('the reason is stated on the control', viewTruncate !== null && (viewTruncate.title || '').includes('视图'), out.viewTruncate);
      check('the page says the object is a view', (viewPage.textContent || '').includes('是视图'), null);
      // 回到表上继续。
      const dbNode3 = dbNodeByName(dbName);
      if (dbNode3 !== null) { click(dbNode3); await sleep(1600); }
      const tableLink2 = await waitFor(() => byText('.dbm-table .dbm-link', 'ops_target'), 8000);
      if (tableLink2 !== null) {
        click(tableLink2);
        await sleep(1500);
        const opTab3 = Array.from(document.querySelectorAll('.dbm-tab')).find((el) => opLabels.includes((el.textContent || '').trim()));
        click(opTab3);
        await sleep(1600);
      }
    }

    const ops = document.querySelector('[data-dbm-op-page]');
    if (engine === 'mysql' && ops !== null) {
      // ---- 表选项：预填的是服务端的实时值，且只提交改过的字段 ------------
      const engineSelect = await waitFor(() => ops.querySelector('[data-dbm-op-option="engine"]'), 8000);
      const collation = ops.querySelector('[data-dbm-op-option="collation"]');
      const comment = ops.querySelector('[data-dbm-op-option="comment"]');
      const ai = ops.querySelector('[data-dbm-op-option="autoIncrement"]');
      const rowFormat = ops.querySelector('[data-dbm-op-option="rowFormat"]');
      out.optionControls = {
        engine: engineSelect ? engineSelect.value : null,
        collation: collation ? collation.value : null,
        comment: comment ? comment.value : null,
        autoIncrement: ai ? ai.value : null,
        rowFormat: rowFormat ? rowFormat.value : null,
      };
      check('the options form is prefilled with the server\\u0027s engine', engineSelect !== null && engineSelect.value === 'InnoDB', out.optionControls);
      check('the options form is prefilled with the comment', comment !== null && comment.value === 'before', out.optionControls);
      check('the options form is prefilled with the row format', rowFormat !== null && (rowFormat.value || '').length > 0, out.optionControls);
      // 自增值来自 SHOW CREATE TABLE —— information_schema 与 SHOW TABLE STATUS 都会
      // 读到旧值（实测），所以它是唯一与「下一个 id」一致的那一列。
      check('the options form offers the auto-increment value', ai !== null && Number(ai.value) === 4, out.optionControls);

      // 只改注释 → 引擎 / 整理 / 行格式必须原样保留。
      setInput(comment, 'after');
      await sleep(200);
      click(ops.querySelector('[data-dbm-op-submit="options"]'));
      await sleep(2500);
      const info = await api('/api/dsh-database/sources/' + sourceId + '/table/options?schema=' + encodeURIComponent(dbName) + '&table=ops_target');
      out.optionsAfterSave = info.options;
      check('the comment was saved', info.options.comment === 'after', info.options);
      check('the untouched engine was left alone', info.options.engine === 'InnoDB', info.options);
      check('the untouched row format was left alone', info.options.rowFormat === 'Dynamic', info.options);
      check('the form was re-read after saving', (ops.querySelector('[data-dbm-op-option="comment"]') || {}).value === 'after');
      step('table options saved');

      /*
       * 两个区块的目标字段用同一组 data 属性，所以必须按区块取。
       *
       * 踩过：用 ops.querySelector('[data-dbm-op-target-schema]') 取到的是**移动**区块那个
       * 下拉，于是复制区块的库压根没被改，提交时面板正确地报了「源和目标不能是同一张表」。
       * 区块自己有 data-dbm-op-block，按它取是唯一不会串的取法。
       */
      const copyBlock = ops.querySelector('[data-dbm-op-block="copy"]');
      const moveBlock = ops.querySelector('[data-dbm-op-block="move"]');

      // ---- 复制表：结构与数据都到，且原表不动 ----------------------------
      const copyTarget = copyBlock === null ? null : copyBlock.querySelector('[data-dbm-op-target-schema]');
      const copyName = copyBlock === null ? null : copyBlock.querySelector('[data-dbm-op-target-table]');
      if (copyTarget !== null && copyName !== null) {
        // 目标库在下拉里必须真的存在，否则 setSelect 设了个不存在的值，看着像提交了
        // 其实什么都没改——断言的是「提交前后面板报告了什么」，而不是「我们设过什么」。
        out.copyTargetOptions = Array.from(copyTarget.options).map((o) => o.value);
        check('the copy target offers the seeded database', out.copyTargetOptions.includes(otherDb), out.copyTargetOptions);
        setSelect(copyTarget, otherDb);
        setInput(copyName, 'ops_target');
        await sleep(300);
        // 提交前读回控件的值：这样「面板报同一张表」的失败能立刻指出是设置没生效。
        out.copyForm = { schema: copyTarget.value, table: copyName.value };
        check('the copy form holds the chosen target', copyTarget.value === otherDb && copyName.value === 'ops_target', out.copyForm);
        click(copyBlock.querySelector('[data-dbm-op-submit="copy"]'));
        await sleep(3500);
        out.copyNotice = noticeText();
        out.copyError = errorText();
        check('copying reports success', out.copyError === null, { notice: out.copyNotice, error: out.copyError });
        const copied = await api('/api/dsh-database/sources/' + sourceId + '/rows?schema=' + encodeURIComponent(otherDb) + '&table=ops_target&page=1&pageSize=10&mode=browse');
        out.copiedTotal = copied.page.total;
        check('the copy carries the rows', copied.page.total === 3, out.copiedTotal);
        const stillThere = await api('/api/dsh-database/sources/' + sourceId + '/rows?schema=' + encodeURIComponent(dbName) + '&table=ops_target&page=1&pageSize=10&mode=browse');
        check('copying leaves the original in place', stillThere.page.total === 3, stillThere.page.total);
        step('table copied');
      } else {
        check('the copy form has a target', false);
      }

      // ---- 移动表：表从原库消失，出现在目标库 ----------------------------
      const moveTarget = moveBlock === null ? null : moveBlock.querySelector('[data-dbm-op-target-schema]');
      const moveName = moveBlock === null ? null : moveBlock.querySelector('[data-dbm-op-target-table]');
      if (moveTarget !== null && moveName !== null) {
        setSelect(moveTarget, otherDb);
        setInput(moveName, 'moved_here');
        await sleep(300);
        out.moveForm = { schema: moveTarget.value, table: moveName.value };
        check('the move form holds the chosen target', moveTarget.value === otherDb && moveName.value === 'moved_here', out.moveForm);
        click(moveBlock.querySelector('[data-dbm-op-submit="move"]'));
        await sleep(3500);
        out.moveNotice = noticeText();
        out.moveError = errorText();
        check('moving reports success', out.moveError === null, { notice: out.moveNotice, error: out.moveError });
        const target = await api('/api/dsh-database/sources/' + sourceId + '/rows?schema=' + encodeURIComponent(otherDb) + '&table=moved_here&page=1&pageSize=10&mode=browse');
        out.movedRows = target.page.total;
        check('the moved table arrived in the target with its rows', target.page.total === 3, out.movedRows);
        // 原库里必须没有了 —— 只查目标会漏掉「其实是复制」的实现。
        let gone = null;
        try {
          await api('/api/dsh-database/sources/' + sourceId + '/rows?schema=' + encodeURIComponent(dbName) + '&table=ops_target&page=1&pageSize=10&mode=browse');
          gone = false;
        } catch { gone = true; }
        check('the moved table is gone from the source database', gone === true, gone);
        // 而且右侧跟着走了：面板落在目标库，不再停在已经被移走的表上。
        await sleep(1500);
        out.afterMove = { error: errorText(), stillOnOldTable: document.querySelector('.dbm-tabs') !== null };
        check('the pane did not stay on the moved-away table', out.afterMove.error === null && out.afterMove.stillOnOldTable === false, out.afterMove);
        step('table moved');
      } else {
        check('the move form has a target', false);
      }
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
    if (report.tabs !== undefined) console.log(`tabs: ${JSON.stringify(report.tabs)}`)
    if (report.blocks !== undefined) console.log(`blocks: ${JSON.stringify(report.blocks)}`)
    if (report.maintenance !== undefined) console.log(`maintenance: ${JSON.stringify(report.maintenance)}`)
    if (report.overviewLinks !== undefined) console.log(`overview: ${JSON.stringify(report.overviewLinks)}`)
    if (report.viewTruncate !== undefined) console.log(`view truncate: ${JSON.stringify(report.viewTruncate)}`)
    if (report.optionControls !== undefined) console.log(`option controls: ${JSON.stringify(report.optionControls)}`)
    if (report.optionsAfterSave !== undefined) console.log(`options after save: ${JSON.stringify(report.optionsAfterSave)}`)
    if (report.copyTargetOptions !== undefined) console.log(`copy target options: ${JSON.stringify(report.copyTargetOptions)}`)
    if (report.copyForm !== undefined) console.log(`copy form: ${JSON.stringify(report.copyForm)}`)
    if (report.copyNotice !== undefined || report.copyError !== undefined) console.log(`copy: notice=${JSON.stringify(report.copyNotice)} error=${JSON.stringify(report.copyError)}`)
    if (report.copiedTotal !== undefined) console.log(`copied rows: ${report.copiedTotal}`)
    if (report.moveForm !== undefined) console.log(`move form: ${JSON.stringify(report.moveForm)}`)
    if (report.moveNotice !== undefined || report.moveError !== undefined) console.log(`move: notice=${JSON.stringify(report.moveNotice)} error=${JSON.stringify(report.moveError)}`)
    if (report.movedRows !== undefined) console.log(`moved rows: ${report.movedRows}`)
    if (report.afterMove !== undefined) console.log(`after move: ${JSON.stringify(report.afterMove)}`)
    for (const note of report.notes) check(note, true)
    for (const failure of report.failures) check(failure.name, false, failure.detail)
  }
} finally {
  // 数据源与本运行创建的库都要清掉，否则下一次跑到重名的对象。
  //
  // 顺序是「先丢库、再删数据源」：DROP DATABASE 要通过这个数据源的连接执行，把数据源删在
  // 前面会让三条 DROP 全部静默失败，在服务器上留下两个库——实测过一次，正是这个顺序。
  //
  // 只在 MySQL 运行里丢库：SQLite 的「库」是 ATTACH 进来的 schema，DROP DATABASE 在它上面
  // 只会返回 500，凭空多出两条看着像失败的提示。
  const databases = engine === 'mysql' ? [targetDatabase, ...createdDatabases] : []
  try {
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name === SOURCE_NAME)) {
      for (const database of databases) {
        const response = await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}/query`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sql: `DROP DATABASE IF EXISTS \`${database}\``, allowWrite: true }),
        }).catch(() => undefined)
        if (response !== undefined && !response.ok) {
          console.error(`note: could not drop ${database}: HTTP ${response.status}`)
        }
      }
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
