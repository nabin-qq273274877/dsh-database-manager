import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/**
 * SQL 与搜索两个 tab 跑 SELECT 后必须跳到浏览 tab —— 而不是在下面显示结果。
 *
 * 断言的是「哪个 tab 处于激活状态」以及「结果渲染在哪里」，因为存在性断言抓不到这个
 * 缺陷：改动前两种做法下表格都在页面里、都能被合成点击命中，只有看激活的 tab 与结果的
 * 归属位置才能区分。
 *
 * 覆盖的四种情况，后两种各带一个容易漏的分支：
 *   1. SQL 页跑 SELECT → 浏览 tab 激活、结果在浏览页里、SQL 页下方没有结果表格；
 *   2. SQL 页跑写语句 → **留在** SQL 页（跳到浏览会把「已影响 N 行」这句话藏起来）；
 *   3. 搜索页带条件执行 → 浏览 tab 激活、行数确实是筛选后的、条件在浏览页可见可清除；
 *   4. 搜索页空条件执行 → 浏览 tab 激活且显示全部行。
 *
 * 用法：node scripts/e2e-select-jump.mjs <baseUrl-with-token> <sqliteFile>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9397
const SOURCE_NAME = `E2E SelectJump ${process.pid}`

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-select-jump.mjs <baseUrl-with-token> <sqliteFile>')
  process.exit(2)
}

/** 造一张有 4 行、其中 2 行 note 为 NULL 的表，两种跳转都要用到。 */
function seed(file) {
  const db = new DatabaseSync(file)
  db.exec('DROP TABLE IF EXISTS items')
  db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT, note TEXT)')
  db.exec("INSERT INTO items(name, note) VALUES ('alpha', 'x'), ('beta', NULL), ('gamma', '100%'), ('delta', NULL)")
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
const byText = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
const byIncludes = (sel, text, scope) => Array.from((scope || document).querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
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
const activeTab = () => {
  const el = document.querySelector('.dbm-tab[data-active="true"]');
  return el === null ? null : (el.textContent || '').trim();
};
const errorText = () => { const b = document.querySelector('.dbm-error'); return b === null ? null : (b.textContent || '').trim(); };
const api = async (path, options) => { const r = await fetch(path, options); const b = await r.json().catch(() => null); if (!r.ok) throw new Error('API ' + path + ' -> ' + r.status); return b; };
`

const profile = mkdtempSync(join(tmpdir(), 'dbm-jump-'))
const child = spawn(EDGE, [
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1500,950', 'about:blank',
], { stdio: 'ignore' })

const origin = baseUrl.replace(/\/\?.*$/, '')
let socket
try {
  seed(sqliteFile)

  let target
  for (let attempt = 0; attempt < 80 && target === undefined; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      target = list.find(entry => entry.type === 'page')?.webSocketDebuggerUrl
    } catch { /* not up */ }
    if (target === undefined) await wait(250)
  }
  if (target === undefined) throw new Error('the debugger endpoint never came up')

  socket = new WebSocket(target, { maxPayload: 32 * 1024 * 1024 })
  await new Promise((resolve, reject) => { socket.on('open', resolve); socket.on('error', reject) })
  const session = new Session(socket)
  await session.send('Page.enable')
  await session.send('Runtime.enable')
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await session.send('Page.navigate', { url: baseUrl })
  await wait(4500)

  // 建数据源、连上、打开 items 表。
  const opened = await session.evaluate(`(async () => {
${PRELUDE}
    const row = Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim()));
    if (!row) return { fatal: 'no sidebar' };
    click(row); await sleep(1800);
    click(await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000));
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    if (!modal) return { fatal: 'no create dialog' };
    const kindSelect = modal.querySelector('select.dbm-select');
    if (kindSelect) setSelect(kindSelect, 'sqlite');
    await sleep(500);
    const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
    setInput(inputs[0], ${JSON.stringify(SOURCE_NAME)});
    const f = inputs.find((i) => (i.getAttribute('placeholder') || '').includes('D:/data'));
    if (f) setInput(f, ${JSON.stringify(sqliteFile)});
    await sleep(300);
    click(byText('.dbm-modal-foot .dbm-btn', '保存') || byText('.dbm-modal-foot .dbm-btn', 'Save'));
    const listed = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(SOURCE_NAME)}), 15000);
    if (!listed) return { fatal: 'source not listed', error: errorText() };
    const sources = await api('/api/dsh-database/sources');
    const sourceId = sources.sources.find((s) => s.name === ${JSON.stringify(SOURCE_NAME)}).id;
    const connect = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn'))
      .find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
    click(connect); await sleep(3500);
    /*
     * 先点左侧的库节点展开，右侧才会显示表列表。
     *
     * 少这一步会以「the table is not in the overview」失败，而真正的原因是右侧还停在
     * 「请选择数据库」，看起来却像表不存在。
     */
    const dbNode = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => {
      const l = el.querySelector('.dbm-node-name');
      return l !== null && (l.textContent || '').trim() === 'main';
    }) || null, 15000);
    if (!dbNode) return { fatal: 'the database node is not in the tree' };
    click(dbNode); await sleep(1800);
    const tableLink = await waitFor(() => byText('.dbm-table .dbm-link', 'items'), 15000);
    if (!tableLink) return { fatal: 'the table is not in the overview', error: errorText() };
    click(tableLink); await sleep(1800);
    return { sourceId, tab: activeTab() };
  })()`)
  if (opened.fatal !== undefined) throw new Error(`${opened.fatal}${opened.error === undefined ? '' : ': ' + opened.error}`)

  /* ---- 1. SQL 页的 SELECT 跳到浏览页 ---- */
  const selectRun = await session.evaluate(`(async () => {
${PRELUDE}
    click(byText('.dbm-tab', 'SQL')); await sleep(1200);
    const editor = await waitFor(() => document.querySelector('[data-dbm-sql-editor]'), 5000);
    if (editor === null) return { fatal: 'no SQL editor' };
    setInput(editor, 'SELECT id, name, note FROM items ORDER BY id');
    await sleep(200);
    click(document.querySelector('[data-dbm-sql-run]'));
    await sleep(2600);
    return {
      tab: activeTab(),
      // 结果必须渲染在浏览页里。
      resultsInBrowse: document.querySelector('[data-dbm-sql-result-page]') !== null,
      resultGrid: document.querySelector('[data-dbm-sql-result]') !== null,
      // 浏览页自己的表格/工具条此时不应出现（结果集不是某个表的页）。
      browseTableToolbar: (document.querySelector('.dbm-pager') === null ? null : true),
      rowCount: document.querySelectorAll('[data-dbm-sql-result] tbody tr').length,
      notice: (document.querySelector('.dbm-ok') || {}).textContent || null,
      error: errorText(),
    };
  })()`)
  if (selectRun.fatal !== undefined) throw new Error(selectRun.fatal)
  check('SQL 跑 SELECT 后跳到浏览 tab', selectRun.tab === '浏览', { tab: selectRun.tab })
  check('结果渲染在浏览页里', selectRun.resultsInBrowse === true, null)
  check('结果表格显示 SELECT 返回的全部 4 行', selectRun.rowCount === 4, { rows: selectRun.rowCount })
  check('SELECT 结果不带浏览页的表分页工具条', selectRun.browseTableToolbar === null, null)
  check('SQL 执行没有报错', selectRun.error === null, selectRun.error)

  /* ---- 2. SQL 页的写语句留在 SQL 页 ---- */
  const writeRun = await session.evaluate(`(async () => {
${PRELUDE}
    click(byText('.dbm-tab', 'SQL')); await sleep(1200);
    const editor = await waitFor(() => document.querySelector('[data-dbm-sql-editor]'), 5000);
    if (editor === null) return { fatal: 'no SQL editor' };
    setInput(editor, "UPDATE items SET note = 'w' WHERE id = 1");
    await sleep(200);
    // 写操作需要勾选「允许写入」。
    const allow = document.querySelector('.dbm-check input[type=checkbox]');
    if (allow !== null && allow.checked !== true) { click(allow); await sleep(300); }
    click(document.querySelector('[data-dbm-sql-run]'));
    await sleep(2600);
    return {
      tab: activeTab(),
      message: (document.querySelector('[data-dbm-sql-message]') || {}).textContent || null,
      error: errorText(),
    };
  })()`)
  if (writeRun.fatal !== undefined) throw new Error(writeRun.fatal)
  check('SQL 跑写语句后留在 SQL tab', writeRun.tab === 'SQL', { tab: writeRun.tab })
  check('写语句的影响行数在 SQL 页可见', /影响/.test(String(writeRun.message)), writeRun.message)
  check('写语句没有报错', writeRun.error === null, writeRun.error)

  /* ---- 3. 搜索页带条件执行后跳到浏览页，且确实被筛选 ---- */
  const filtered = await session.evaluate(`(async () => {
${PRELUDE}
    click(byText('.dbm-tab', '搜索')); await sleep(1800);
    const page = await waitFor(() => document.querySelector('[data-dbm-search-page]'), 8000);
    if (page === null) return { fatal: 'no search page' };
    // note 列设为「为空」：items 里恰好 2 行 note 为 NULL。
    const row = page.querySelector('[data-dbm-search-row="note"]');
    if (row === null) return { fatal: 'no row for note' };
    setSelect(row.querySelector('[data-dbm-search-operator]'), 'isNull');
    await sleep(500);
    click(document.querySelector('[data-dbm-search-run]'));
    await sleep(2800);
    const pager = document.querySelector('.dbm-pager');
    return {
      tab: activeTab(),
      // 浏览页的表格出现了（这次是真正的表读，应该有分页工具条）。
      hasPager: pager !== null,
      filterBar: (document.querySelector('[data-dbm-browse-filters]') || {}).textContent || null,
      rowTexts: Array.from(document.querySelectorAll('.dbm-data tbody tr')).map((tr) => (tr.textContent || '').trim()),
      notice: (document.querySelector('.dbm-ok') || {}).textContent || null,
      error: errorText(),
      // 搜索页下方不应再有结果表格。
      searchHasOwnGrid: document.querySelector('[data-dbm-search-page] .dbm-search-results') !== null,
    };
  })()`)
  if (filtered.fatal !== undefined) throw new Error(filtered.fatal)
  check('搜索执行后跳到浏览 tab', filtered.tab === '浏览', { tab: filtered.tab })
  check('浏览页出现了表的分页工具条', filtered.hasPager === true, null)
  check('搜索页不再自带结果表格', filtered.searchHasOwnGrid === false, null)
  check('浏览页显示已应用的筛选条件', /筛选/.test(String(filtered.filterBar)), filtered.filterBar)
  /* 关键：条件真的生效了 —— 只有 beta 与 delta 的 note 为 NULL。 */
  check('结果确实是被筛选过的 2 行', filtered.rowTexts.length === 2, { rows: filtered.rowTexts })
  check('筛选结果不含 note 非空的行', !filtered.rowTexts.some(t => t.includes('alpha') || t.includes('gamma')), filtered.rowTexts)
  check('搜索执行没有报错', filtered.error === null, filtered.error)

  /* ---- 3b. 浏览页能清除筛选条件 ---- */
  const cleared = await session.evaluate(`(async () => {
${PRELUDE}
    const clear = document.querySelector('[data-dbm-browse-clear-filters]');
    if (clear === null) return { fatal: 'no clear button' };
    click(clear);
    await sleep(2600);
    return {
      filterBar: document.querySelector('[data-dbm-browse-filters]') === null ? null : true,
      rows: document.querySelectorAll('.dbm-data tbody tr').length,
      error: errorText(),
    };
  })()`)
  if (cleared.fatal !== undefined) throw new Error(cleared.fatal)
  check('清除筛选后条件条消失', cleared.filterBar === null, null)
  check('清除筛选后回到全部 4 行', cleared.rows === 4, { rows: cleared.rows })

  /* ---- 4. 搜索页空条件执行同样跳转 ---- */
  const allRows = await session.evaluate(`(async () => {
${PRELUDE}
    click(byText('.dbm-tab', '搜索')); await sleep(1800);
    await waitFor(() => document.querySelector('[data-dbm-search-page]'), 8000);
    click(document.querySelector('[data-dbm-search-run]'));
    await sleep(2800);
    return { tab: activeTab(), rows: document.querySelectorAll('.dbm-data tbody tr').length, error: errorText() };
  })()`)
  check('空条件搜索也跳到浏览 tab', allRows.tab === '浏览', { tab: allRows.tab })
  check('空条件搜索显示全部 4 行', allRows.rows === 4, { rows: allRows.rows })

  /* ---- 5. SQL 编辑器文本在跳转后仍然保留 ---- */
  const preserved = await session.evaluate(`(async () => {
${PRELUDE}
    click(byText('.dbm-tab', 'SQL')); await sleep(1400);
    const editor = await waitFor(() => document.querySelector('[data-dbm-sql-editor]'), 5000);
    return { text: editor === null ? null : editor.value };
  })()`)
  check('跳转后 SQL 编辑器仍保留之前的语句', String(preserved.text).includes('UPDATE items'), preserved.text)
} finally {
  try {
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name === SOURCE_NAME)) {
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' })
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
