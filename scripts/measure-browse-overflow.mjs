import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/**
 * 浏览页的横向几何：固定的操作列盖上最后一列、以及滚动条是否可被发现。
 *
 * 报的现象：「看不到最后的字段了，但滚动条还没显示，被操作列遮在下面」。量出来的实情
 * 与猜测有一处重要出入，所以这个脚本既报数也断言：
 *
 *   容器 clientWidth 1007 < scrollWidth 1031  → 确实溢出，溢出量 24px
 *   横向滚动条高 12px、top 851（视口高 904）  → 它**在视口内**，并不是没显示
 *   scrollLeft=0 时最后一列被操作列盖住 24px   → 恰好等于溢出量
 *   scrollLeft=最大 后被盖 0px                 → 滚满就完全可见
 *
 * 于是有一个干净的不变量：**被盖住的宽度 == 溢出量**（两者都是 tableWidth - clientWidth），
 * 滚满后归零。所以最后一列并非够不到，而是「滚动范围只有二十几像素、滑块看起来是满的」
 * 加上平台浮层滚动条平时不画出来 —— 用户根本无法知道该滚。修法是让滚动条始终绘制且明显
 * （见 styles.ts 的 ::-webkit-scrollbar 一段），而不是给表格预留槽位：那会给本来装得下的
 * 表凭空造出滚动条。
 *
 * 用法：node scripts/measure-browse-overflow.mjs <baseUrl-with-token> <sqliteFile> [mysql|sqlite]
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9457

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
const engine = process.argv[4] ?? 'sqlite'
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/measure-browse-overflow.mjs <baseUrl-with-token> <sqliteFile> [mysql|sqlite]')
  process.exit(2)
}

const TAG = process.pid
/** 复现用的是用户报的那张表；SQLite 侧没有它，所以造一张同形状的。 */
const SOURCE_NAME = `Measure Browse ${TAG}`
const MySQL_DATABASE = 'dsh'
const MySQL_TABLE = 'c_type_move'
const SQLITE_TABLE = 'c_type_move'

/** SQLite 侧的等价表：11 列、每列带注释位（SQLite 无注释，故只用长值撑宽）。 */
function seedSqlite(file) {
  const db = new DatabaseSync(file)
  db.exec(`DROP TABLE IF EXISTS ${SQLITE_TABLE}`)
  db.exec(`CREATE TABLE ${SQLITE_TABLE} (
    id INTEGER PRIMARY KEY,
    uid INTEGER, type INTEGER, price NUMERIC(10,2), content TEXT, time TEXT,
    status TEXT, is_del INTEGER, created_time INTEGER, updated_time INTEGER, deleted_time INTEGER
  )`)
  db.exec(`INSERT INTO ${SQLITE_TABLE} (id, uid, type, price, content, time, status, is_del, created_time, updated_time, deleted_time)
    VALUES (1, 1, 1, 20.00, 'adfsa纟式苦葳工工工工工工工葳', 'Sun Sep 20 2026 00:35:05 GMT+0800 (中国标准时间)', 'on', 0, 0, 0, 0)`)
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
const profile = mkdtempSync(join(tmpdir(), 'dbm-browse-overflow-'))
const child = spawn(EDGE, [
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--force-device-scale-factor=1',
  '--window-size=1600,1000',
  'about:blank',
], { stdio: 'ignore' })

const origin = baseUrl.replace(/\/\?.*$/, '')
let socket
try {
  seedSqlite(sqliteFile)

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
const round = (n) => Math.round(n * 10) / 10;
const engine = ${JSON.stringify(engine)};
/** 用户报的那张表：MySQL 侧在 dsh 库里；SQLite 侧是造的同形状表。 */
const targetDb = engine === 'mysql' ? ${JSON.stringify(MySQL_DATABASE)} : 'main';
const targetTable = ${JSON.stringify(engine === 'mysql' ? MySQL_TABLE : SQLITE_TABLE)};
const out = { steps: [], failures: [] };
const step = (name) => out.steps.push(name);
const fail = (name, detail) => out.failures.push({ name, detail });

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
  if (hostInput) setInput(hostInput, '127.0.0.1');
  const portInput = inputs.find((i) => (i.getAttribute('placeholder') || '').includes('3306'));
  if (portInput) setInput(portInput, '3306');
  const userInput = inputs.find((i) => (i.getAttribute('placeholder') || '').includes('root'));
  if (userInput) setInput(userInput, 'root');
  const pw = modal.querySelector('input[type=password]');
  if (pw) setInput(pw, 'root');
  await sleep(300);
  click(byText('.dbm-modal-foot .dbm-btn', '保存') || byText('.dbm-modal-foot .dbm-btn', 'Save'));
  const listed = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(SOURCE_NAME)}), 15000);
  if (!listed) return { fatal: 'the created source is not listed', error: (document.querySelector('.dbm-error') || {}).textContent };

  const sources = await (await fetch('/api/dsh-database/sources')).json();
  const matches = sources.sources.filter((s) => s.name === ${JSON.stringify(SOURCE_NAME)});
  if (matches.length !== 1) return { fatal: 'the run data source did not resolve to one entry', n: matches.length };

  const connect = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn')).find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
  click(connect);
  await sleep(3500);

  const dbNode = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => {
    const label = el.querySelector('.dbm-node-name');
    return label !== null && (label.textContent || '').trim() === targetDb;
  }) || null, 15000);
  if (dbNode === null) {
    const treeText = Array.from(document.querySelectorAll('.dbm-side-body .dbm-node-name')).map((el) => (el.textContent || '').trim());
    return { fatal: 'the database node is not in the tree', wanted: targetDb, inTree: treeText.slice(0, 30), error: (document.querySelector('.dbm-error') || {}).textContent };
  }
  click(dbNode);
  await sleep(1800);

  const tableLink = await waitFor(() => byText('.dbm-table .dbm-link', targetTable), 12000);
  if (!tableLink) {
    const tableText = Array.from(document.querySelectorAll('.dbm-table .dbm-link')).map((el) => (el.textContent || '').trim());
    return { fatal: 'the target table is not in the overview', wanted: targetTable, inOverview: tableText.slice(0, 40) };
  }
  click(tableLink);
  await sleep(2500);
  step('opened the browse tab on the target table');

  const scroll = document.querySelector('.dbm-data');
  const table = scroll === null ? null : scroll.querySelector('table');
  if (scroll === null || table === null) return { fatal: 'the browse grid is missing' };

  out.columnCount = table.querySelectorAll('thead th').length;
  out.headers = Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent || '').trim());

  out.container = {
    clientWidth: scroll.clientWidth,
    scrollWidth: scroll.scrollWidth,
    clientHeight: scroll.clientHeight,
    offsetHeight: scroll.offsetHeight,
    horizontalScrollbarHeight: scroll.offsetHeight - scroll.clientHeight,
    canScrollX: scroll.scrollWidth > scroll.clientWidth,
    overflowX: getComputedStyle(scroll).overflowX,
  };

  /*
   * 容器自身的几何 —— 尤其是它的**底边**在不在视口内。
   *
   * 这是「滚动条还没显示」这个说法唯一需要回答的问题：横向滚动条贴着容器底边，容器若
   * 伸出视口下方，那根条就真的不可见（也被下面的分页行压住），面板看起来像"没有滚动条"。
   * 只断言 scrollWidth > clientWidth 会漏掉这一整种坏法。
   */
  const scrollRect = scroll.getBoundingClientRect();
  out.scrollBox = {
    top: round(scrollRect.top),
    bottom: round(scrollRect.bottom),
    height: round(scrollRect.height),
    viewportHeight: window.innerHeight,
    bottomInViewport: scrollRect.bottom <= window.innerHeight + 1,
    bottomOverflowPx: round(Math.max(0, scrollRect.bottom - window.innerHeight)),
    // 滚动条那 8px 落在何处；它自身是否可见才是用户看到的那件事。
    scrollbarTop: round(scrollRect.bottom - (scroll.offsetHeight - scroll.clientHeight)),
    scrollbarInViewport: scrollRect.bottom <= window.innerHeight + 1,
    pagerBelow: (() => {
      const pager = document.querySelector('.dbm-pager');
      if (pager === null) return null;
      const rect = pager.getBoundingClientRect();
      return { top: round(rect.top), bottom: round(rect.bottom), visible: rect.top < window.innerHeight };
    })(),
  };
  out.tableNatural = { offsetWidth: table.offsetWidth, scrollWidth: table.scrollWidth };

  const headerCells = Array.from(table.querySelectorAll('thead th'));
  const bodyRow = table.querySelector('tbody tr');
  const bodyCells = bodyRow === null ? [] : Array.from(bodyRow.children);
  const actionHeader = headerCells[headerCells.length - 1];
  const actionCell = bodyCells[bodyCells.length - 1];
  const lastDataHeader = headerCells[headerCells.length - 2];
  const lastDataCell = bodyCells[bodyCells.length - 2];

  out.actionColumn = {
    position: getComputedStyle(actionCell).position,
    right: getComputedStyle(actionCell).right,
    className: actionCell.className,
  };

  /*
   * 在 scrollLeft = 0 与 最右 两个位置量同一组数。
   *
   * 「被遮住」的判据是**几何包含**：最后一列的右边缘若超出操作列的左边缘，那一段就看不见。
   * 两个位置都量，是因为 sticky 列在能滚动与不能滚动时的行为不同。
   */
  const measure = (label, left) => {
    scroll.scrollLeft = left;
    const box = scroll.getBoundingClientRect();
    const actionRect = actionCell.getBoundingClientRect();
    const dataHeaderRect = lastDataHeader.getBoundingClientRect();
    const dataCellRect = lastDataCell.getBoundingClientRect();
    return {
      label,
      scrollLeft: Math.round(scroll.scrollLeft),
      viewport: { left: round(box.left), right: round(box.right) },
      actionLeft: round(actionRect.left),
      actionRight: round(actionRect.right),
      lastHeader: { left: round(dataHeaderRect.left), right: round(dataHeaderRect.right) },
      lastCell: { left: round(dataCellRect.left), right: round(dataCellRect.right) },
      // 被操作列盖住的宽度（正数表示真的看不见）
      headerCoveredBy: round(Math.max(0, dataHeaderRect.right - actionRect.left)),
      cellCoveredBy: round(Math.max(0, dataCellRect.right - actionRect.left)),
      lastHeaderFullyVisible: dataHeaderRect.right <= actionRect.left + 1,
      lastCellFullyVisible: dataCellRect.right <= actionRect.left + 1,
      // 最后一列是否被推出可视区右侧（另一种坏法）
      lastHeaderBeyondViewport: round(Math.max(0, dataHeaderRect.right - box.right)),
    };
  };

  out.atLeft = measure('scrollLeft=0', 0);
  await sleep(300);
  out.atRight = measure('scrollLeft=max', scroll.scrollWidth);
  await sleep(300);
  scroll.scrollLeft = 0;

  /*
   * 每个数据列自身的宽度与右边缘，用来找出「哪几列落在操作列下面」。
   * 只报前若干列即可看出规律。
   */
  out.columnEdges = headerCells.map((th, index) => {
    const rect = th.getBoundingClientRect();
    const actionRect = actionCell.getBoundingClientRect();
    return {
      i: index,
      name: (th.textContent || '').trim(),
      left: round(rect.left),
      right: round(rect.right),
      width: round(rect.width),
      underAction: rect.right > actionRect.left + 1,
    };
  });

  /*
   * 正文各格的渲染宽度 vs 内容需要多宽 —— 判断「看不到」是不是因为单元格被压窄后
   * 用 ellipsis 截断（那是另一回事，且会给出省略号）。
   */
  out.cellTruncation = bodyCells.map((td, index) => ({
    i: index,
    clientWidth: td.clientWidth,
    scrollWidth: td.scrollWidth,
    truncated: td.scrollWidth > td.clientWidth + 1,
  }));

  // ---- 断言 ---------------------------------------------------------------
  const check = (name, ok, detail) => { if (ok) out.notes.push(name); else out.failures.push({ name, detail }); };
  out.notes = [];

  /*
   * 那个不变量：被盖住的宽度 == 溢出量，滚满后归零。
   *
   * 这条是「最后一列够得到」的精确判据。它成立时，滚动条就是唯一的入口 —— 所以下一条
   * 断言（滚动条真的画出来、且在视口内）才是修复的核心。
   */
  const overflow = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
  out.overflowPx = overflow;
  check('the covered width equals the overflow, so the column is reachable by scrolling',
    Math.abs(out.atLeft.cellCoveredBy - overflow) <= 2, { covered: out.atLeft.cellCoveredBy, overflow });
  check('scrolling fully right brings the last column out from under the actions column',
    out.atRight.lastCellFullyVisible === true, out.atRight);
  /*
   * 未滚动时最后一列在视口外，这**不是**缺陷。
   *
   * 表格比容器宽时，scrollLeft=0 就意味着右侧的内容在视口之外 —— 那正是「有内容可滚」的
   * 定义。断言它等于 0 是错的（第一版就这么写的，在 SQLite 的 200px 溢出上误报了一次）。
   * 真正要断言的是它**能通过滚动进入视口**，也就是下一条。
   */
  check('the last data column can be brought into the viewport by scrolling',
    out.atRight.lastHeaderBeyondViewport === 0 && out.atRight.lastCellFullyVisible === true, out.atRight);

  /*
   * 滚动条必须**真的画出来**，而且**在视口内**。
   *
   * 报的现象是「滚动条还没显示」。这两条合起来才是那句话的答案：原先它高 8px（平台的
   * 浮层样式，鼠标不在上面就不画），修复后是显式绘制的 12px，且底边在视口里。
   * 只断言 scrollWidth > clientWidth 会把「有滚动条但看不见」当成通过。
   */
  check('the grid actually overflows horizontally', overflow > 0, { clientWidth: scroll.clientWidth, scrollWidth: scroll.scrollWidth });
  check('a horizontal scrollbar is rendered, not the platform overlay',
    out.container.horizontalScrollbarHeight >= 10, out.container);
  check('the scrollbar sits inside the viewport', out.scrollBox.scrollbarInViewport === true, out.scrollBox);

  /*
   * 问题 3：列注释在列名下方，表注释在分页行右侧。
   *
   * 断言的是「渲染出来了」而不是「数据里有」——注释就在 ColumnInfo/TablePage 上，通路一直
   * 存在，缺的只是把它显示出来。所以必须查 DOM。
   */
  out.columnComments = Array.from(table.querySelectorAll('[data-dbm-col-comment]'))
    .map((el) => ({ column: el.getAttribute('data-dbm-col-comment'), text: (el.textContent || '').trim() }));
  if (engine === 'mysql') {
    check('column comments are rendered in the header', out.columnComments.length > 0, out.columnComments.slice(0, 3));
    // 用户报的那张表每列都有注释，所以这里应当一列不缺。
    const expected = ['id', 'uid', 'type', 'price', 'content', 'time', 'status', 'is_del', 'created_time', 'updated_time', 'deleted_time'];
    const shown = out.columnComments.map((entry) => entry.column);
    const missing = expected.filter((name) => !shown.includes(name));
    check('every column of the target table shows its comment', missing.length === 0, { missing, shown });
    const sample = out.columnComments.find((entry) => entry.column === 'is_del');
    check('a comment with Chinese text survives intact', sample !== undefined && sample.text === '是否删除，0否1是', sample);
  } else {
    /*
     * SQLite 没有列注释，所以那里必须一个都不渲染 —— 而不是渲染成空的。
     *
     * 断言「没有」而不是「有」：这一侧的检查点正好相反，把 mysql 那条无条件跑会在
     * SQLite 上误报（第一版就是这样，把「引擎不支持」报成了面板的缺陷）。
     */
    check('SQLite renders no column comments at all', out.columnComments.length === 0, out.columnComments);
  }

  const tableCommentEl = document.querySelector('[data-dbm-table-comment]');
  out.tableComment = tableCommentEl === null ? null : (tableCommentEl.textContent || '').trim();
  const pager = document.querySelector('.dbm-pager');
  if (engine === 'mysql') {
    check('the table comment is rendered', out.tableComment !== null, out.tableComment);
    check('the table comment reads as the server reports it', out.tableComment === '字段类型测试表', out.tableComment);
    /*
     * 「在分页那行右侧」是位置要求：所以量的是它是否**在分页行内**、且在该行的**右半边**。
     * 只查「页面上有这段文字」发现不了它被放到了别处。
     */
    if (tableCommentEl !== null && pager !== null) {
      const commentRect = tableCommentEl.getBoundingClientRect();
      const pagerRect = pager.getBoundingClientRect();
      out.tableCommentGeometry = {
        insidePagerRow: commentRect.top >= pagerRect.top - 2 && commentRect.bottom <= pagerRect.bottom + 2,
        inRightHalf: commentRect.left > pagerRect.left + pagerRect.width / 2,
      };
      check('the table comment sits in the pager row', out.tableCommentGeometry.insidePagerRow === true, out.tableCommentGeometry);
      check('the table comment is on the RIGHT of the pager row', out.tableCommentGeometry.inRightHalf === true, out.tableCommentGeometry);
    }
  } else {
    // SQLite 没有表注释，所以那条线必须**不出现**，而不是渲染成空的。
    check('SQLite renders no table comment line at all', tableCommentEl === null, out.tableComment);
  }

  return out;
} catch (error) {
  return { fatal: 'threw', detail: String(error && error.stack ? error.stack : error) };
}
})()`)

  if (report.fatal !== undefined) {
    console.error(`\nfatal: ${report.fatal}`)
    if (report.detail !== undefined) console.error(report.detail)
    if (report.error !== undefined) console.error(`error: ${report.error}`)
    if (report.inTree !== undefined) console.error(`in tree: ${JSON.stringify(report.inTree)}`)
    if (report.inOverview !== undefined) console.error(`in overview: ${JSON.stringify(report.inOverview)}`)
    process.exitCode = 1
  } else {
    for (const key of ['columnCount', 'overflowPx', 'tableComment', 'headers', 'columnComments', 'tableCommentGeometry',
      'container', 'scrollBox', 'atLeft', 'atRight', 'actionColumn', 'tableNatural']) {
      if (report[key] !== undefined) console.log(`${key}: ${JSON.stringify(report[key])}`)
    }
    for (const failure of report.failures ?? []) {
      console.log(`FAIL ${failure.name} → ${JSON.stringify(failure.detail)}`)
    }
    for (const note of report.notes ?? []) console.log(`OK   ${note}`)
    const failed = (report.failures ?? []).length
    const total = failed + (report.notes ?? []).length
    console.log(`\n${total - failed}/${total} checks passed`)
    if (failed > 0) process.exitCode = 1
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
