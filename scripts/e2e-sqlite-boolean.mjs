import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/**
 * 「SQLite 的 BOOLEAN 仍给是/否下拉」的端到端验证。
 *
 * 存在的原因：把 MySQL 的 tinyint 改成输入框时，判据必须落在「声明类型名」上而不是
 * 「像不像布尔」。MySQL 的 BOOL 读回来就是 tinyint(1)，而 SQLite 的 BOOLEAN 是它自己
 * 的声明类型（NUMERIC 亲和），类型名会原样留在 ColumnInfo.type 里 —— 这一条断言就是
 * 守住这个分界：改一个引擎的行为，不能顺手改掉另一个。
 *
 * 用法：node scripts/e2e-sqlite-boolean.mjs <baseUrl-with-token> <sqliteFile>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9387

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-sqlite-boolean.mjs <baseUrl-with-token> <sqliteFile>')
  process.exit(2)
}

const TAG = process.pid
const SOURCE_NAME = `E2E SqliteBool ${TAG}`

function seed(file) {
  const db = new DatabaseSync(file)
  db.exec('DROP TABLE IF EXISTS kinds')
  db.exec('CREATE TABLE kinds (id INTEGER PRIMARY KEY, flag BOOLEAN, tiny TINYINT, txt TEXT)')
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
const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
`

const profile = mkdtempSync(join(tmpdir(), 'dbm-sqlitebool-'))
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
    const connect = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn'))
      .find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
    click(connect);
    await sleep(3500);

    const dbNode = await waitFor(() => {
      return Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => {
        const label = el.querySelector('.dbm-node-name');
        return label !== null && (label.textContent || '').trim() === 'main';
      }) || null;
    }, 15000);
    if (!dbNode) return { fatal: 'the database node is not in the tree' };
    click(dbNode);
    await sleep(1600);

    const tableLink = await waitFor(() => byText('.dbm-table .dbm-link', 'kinds'), 12000);
    if (!tableLink) return { fatal: 'the table is not in the overview' };
    click(tableLink);
    await sleep(1600);

    click(byText('.dbm-tab', '插入') || byText('.dbm-tab', 'Insert'));
    await sleep(1600);

    const controlOf = (column) => {
      const el = document.querySelector('[data-dbm-insert-for$=":' + column + '"]');
      if (el === null) return null;
      if (el.tagName === 'SELECT') {
        return 'SELECT:' + Array.from(el.options).map((o) => (o.textContent || '').trim()).join('/');
      }
      return el.tagName + (el.type ? ':' + el.type : '');
    };
    out.controls = { flag: controlOf('flag'), tiny: controlOf('tiny'), txt: controlOf('txt') };
    for (const key of Object.keys(out.controls)) if (out.controls[key] === null) delete out.controls[key];

    // SQLite 的 BOOLEAN 仍是两项下拉。
    check('SQLite 的 BOOLEAN 仍是下拉', (out.controls.flag || '').startsWith('SELECT'), out.controls.flag);
    // 而且下拉里是「是(1) / 否(0)」两项加一个空白项 —— 这既是它没被改成输入框的证据，
    // 也说明它没被改成别的下拉。
    const flag = out.controls.flag || '';
    check('下拉里是是/否两项', flag.includes('（1）') && flag.includes('（0）'), flag);
    // SQLite 的 TINYINT 是普通数值列，两种引擎上都不该是下拉。
    check('SQLite 的 TINYINT 是输入框', (out.controls.tiny || '').startsWith('INPUT'), out.controls.tiny);
    check('TEXT 仍是文本框', (out.controls.txt || '').startsWith('INPUT') || (out.controls.txt || '').startsWith('TEXTAREA'), out.controls.txt);

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
