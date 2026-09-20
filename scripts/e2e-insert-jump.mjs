import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/**
 * 需求 2 的端到端：插入表单提交后跳到「浏览」，而「插入并再填一行」留在原地。
 *
 * 断言的是**行为**而不是标记：提交前先确认当前 tab 是「插入」，提交后确认 active 的 tab
 * 变成了「浏览」，并且表格里真的出现了刚写进去的那一行。只查「消息里提到浏览」是不够的
 * ——那是文案，不是状态。
 *
 * 第二个按钮单独验证，因为两个按钮的区别就是这个需求本身：把「再填一行」也跳走，等于把
 * 这个按钮的存在理由删掉，而只测第一个按钮是发现不了的。
 *
 * 用法：node scripts/e2e-insert-jump.mjs <baseUrl-with-token> <sqliteFile>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9377

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-insert-jump.mjs <baseUrl-with-token> <sqliteFile>')
  process.exit(2)
}

const TAG = process.pid
const SOURCE_NAME = `E2E Jump ${TAG}`

function seed(file) {
  const db = new DatabaseSync(file)
  db.exec('DROP TABLE IF EXISTS jump')
  db.exec('CREATE TABLE jump (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, age INTEGER)')
  db.exec("INSERT INTO jump(name, age) VALUES ('seed', 1)")
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
const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
/** 当前选中的 tab 文案，或 null。 */
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
`

const profile = mkdtempSync(join(tmpdir(), 'dbm-jump-'))
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
  seed(sqliteFile)

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

  try {
    const row = Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim()));
    if (!row) return { fatal: 'sidebar row never rendered' };
    click(row);
    await sleep(1800);
    click(await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000));
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    if (!modal) return { fatal: 'the create dialog did not open' };
    const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
    setInput(inputs[0], ${JSON.stringify(SOURCE_NAME)});
    setInput(inputs.find((i) => (i.getAttribute('placeholder') || '').includes('D:/data')), ${JSON.stringify(sqliteFile)});
    await sleep(200);
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

    /*
     * 先在树里选中库，右侧才有表列表。
     *
     * 连接成功后右侧还是「从左侧选择一个库」的占位，直接等表名会一直等不到——就是这里第一次
     * 报的「the seeded table is not in the overview」。按库名点库节点，和用户的做法一致。
     */
    const dbNode = await waitFor(() => {
      return Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => {
        const label = el.querySelector('.dbm-node-name');
        return label !== null && (label.textContent || '').trim() === 'main';
      }) || null;
    }, 15000);
    if (dbNode === null) return { fatal: 'the database node is not in the tree', error: (document.querySelector('.dbm-error') || {}).textContent };
    click(dbNode);
    await sleep(1800);

    const tableLink = await waitFor(() => byText('.dbm-table .dbm-link', 'jump'), 12000);
    if (!tableLink) return { fatal: 'the seeded table is not in the overview', text: (document.querySelector('.dbm-table tbody') || {}).textContent };
    click(tableLink);
    await sleep(1800);

    // ---- 第一段：「插入」提交后跳到浏览 -----------------------------------
    click(byText('.dbm-tab', '插入') || byText('.dbm-tab', 'Insert'));
    await sleep(1500);
    out.tabBeforeInsert = activeTab();
    check('the insert tab is active before submitting', ['插入', 'Insert'].includes(out.tabBeforeInsert), out.tabBeforeInsert);

    const nameField = document.querySelector('[data-dbm-insert-for$=":name"]');
    if (nameField === null) return { ...out, fatal: 'the insert form has no name field' };
    setInput(nameField, 'jumped');
    setInput(document.querySelector('[data-dbm-insert-for$=":age"]'), '42');
    await sleep(200);
    // 两个按钮都以「插入」开头，所以按精确文案取第一个。
    const insertBtn = byText('.dbm-tab-body .dbm-btn', '插入') || byText('.dbm-tab-body .dbm-btn', 'Insert');
    if (insertBtn === null) return { ...out, fatal: 'no insert button' };
    click(insertBtn);
    await sleep(2500);

    out.tabAfterInsert = activeTab();
    out.insertNotice = (document.querySelector('.dbm-ok') || {}).textContent || null;
    check('submitting 插入 switches to 浏览', ['浏览', 'Browse'].includes(out.tabAfterInsert), out.tabAfterInsert);
    // 表格必须真的在：切过去却什么都没渲染，和「停在这一页」一样是坏的。
    out.gridRendered = document.querySelector('.dbm-data table') !== null || document.querySelector('.dbm-table table') !== null;
    check('the browse grid is rendered after the switch', out.gridRendered === true);
    // 而写进去的那一行必须真的在服务端，且可以在页面上看到。
    const rows = await api('/api/dsh-database/sources/' + sourceId + '/rows?table=jump&page=1&pageSize=50&mode=browse');
    out.names = rows.page.rows.map((r) => r.name);
    check('the inserted row reached the server', out.names.includes('jumped'), out.names);
    // 完成语要把这次跳转说出来，否则表单消失、表格出现，中间没有解释。
    check('the notice mentions the switch', (out.insertNotice || '').includes('浏览') || (out.insertNotice || '').toLowerCase().includes('browse'), out.insertNotice);

    // ---- 第二段：「插入并再填一行」留在插入页 -----------------------------
    click(byText('.dbm-tab', '插入') || byText('.dbm-tab', 'Insert'));
    await sleep(1500);
    const againField = document.querySelector('[data-dbm-insert-for$=":name"]');
    if (againField === null) return { ...out, fatal: 'the insert form has no name field on the second pass' };
    setInput(againField, 'stayed');
    await sleep(200);
    const againBtn = byText('.dbm-tab-body .dbm-btn', '插入并再填一行') || byText('.dbm-tab-body .dbm-btn', 'Insert and add another');
    if (againBtn === null) return { ...out, fatal: 'no 插入并再填一行 button' };
    click(againBtn);
    await sleep(2500);

    out.tabAfterAgain = activeTab();
    out.againNotice = (document.querySelector('.dbm-ok') || {}).textContent || null;
    /*
     * 这个按钮必须留在插入页 —— 它存在的理由就是继续填同批数据。跳走等于把这个按钮变成
     * 两个一样的按钮，而只测第一个按钮是发现不了的。
     */
    check('插入并再填一行 stays on the insert tab', ['插入', 'Insert'].includes(out.tabAfterAgain), out.tabAfterAgain);
    check('the insert form is still there for the next row', document.querySelector('[data-dbm-insert-for$=":name"]') !== null);
    const afterAgain = await api('/api/dsh-database/sources/' + sourceId + '/rows?table=jump&page=1&pageSize=50&mode=browse');
    out.namesAfterAgain = afterAgain.page.rows.map((r) => r.name);
    check('its row reached the server too', out.namesAfterAgain.includes('stayed'), out.namesAfterAgain);

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
    for (const key of ['tabBeforeInsert', 'tabAfterInsert', 'tabAfterAgain', 'insertNotice', 'againNotice', 'gridRendered']) {
      if (report[key] !== undefined) console.log(`${key}: ${JSON.stringify(report[key])}`)
    }
    if (report.names !== undefined) console.log(`names: ${JSON.stringify(report.names)}`)
    if (report.namesAfterAgain !== undefined) console.log(`names after again: ${JSON.stringify(report.namesAfterAgain)}`)
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
