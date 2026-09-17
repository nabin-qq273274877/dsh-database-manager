import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/**
 * Measure the SQL tree's trailing counts against a real MySQL database.
 *
 * The reported bug was on MySQL (a database with a dozen tables), and the case
 * that matters most is the one where the NAME is long: the count must still be
 * fully visible, with the name truncated instead. The SQLite measurement in
 * 'measure-tree-number.mjs' covers the single-schema engine; this covers the
 * multi-table shape the screenshot showed.
 *
 * It exits non-zero if any count is clipped, so it can be run as a check.
 *
 * Usage: node scripts/measure-tree-mysql-counts.mjs <baseUrl-with-token> <host:port:user:password> <database>
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9355

const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const database = process.argv[4] ?? 'dbm_tree'
if (baseUrl === undefined) {
  console.error('usage: node scripts/measure-tree-mysql-counts.mjs <baseUrl-with-token> [host:port:user:password] [database]')
  process.exit(2)
}
const [host, port, user, password] = connection.split(':')

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
const profile = mkdtempSync(join(tmpdir(), 'dbm-mysql-measure-'))
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

const sourceName = `Measure MySQL ${process.pid}`
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
  await session.send('Page.navigate', { url: baseUrl })
  await wait(4500)

  const report = await session.evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(120); } };
    const byIncludes = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
    const byExact = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
    const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
    const setInput = (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const setSelect = (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const row = Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim()));
    if (!row) return { fatal: 'sidebar row never rendered' };
    click(row);
    await sleep(1800);

    const newBtn = await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000);
    click(newBtn);
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    if (!modal) return { fatal: 'the create dialog did not open' };
    // Choose MySQL.
    const kindSelect = modal.querySelector('select.dbm-select');
    if (kindSelect) setSelect(kindSelect, 'mysql');
    await sleep(400);
    const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
    setInput(inputs[0], ${JSON.stringify(sourceName)});
    const hostInput = inputs.find((i) => (i.getAttribute('placeholder') || '').includes('127.0.0.1'));
    const userInput = inputs.find((i) => (i.getAttribute('placeholder') || '').includes('root'));
    if (hostInput) setInput(hostInput, ${JSON.stringify(host)});
    if (userInput) setInput(userInput, ${JSON.stringify(user)});
    const pwInput = modal.querySelector('input[type=password]');
    if (pwInput) setInput(pwInput, ${JSON.stringify(password)});
    await sleep(300);
    click(byExact('.dbm-modal-foot .dbm-btn', '保存') || byExact('.dbm-modal-foot .dbm-btn', 'Save'));

    const listed = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(sourceName)}), 10000);
    if (!listed) return { fatal: 'the created source is not listed', error: (document.querySelector('.dbm-error') || {}).textContent };
    const connect = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn'))
      .find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
    click(connect);
    await sleep(3000);

    // Find the target database WITHOUT using the filter box: the filter matches
    // TABLE names, so typing a database name excludes every table in it and the
    // rows this script is about never render. A previous version did exactly that
    // and measured a single row, so the fix went unverified.
    const dbNode = await waitFor(() => byIncludes('.dbm-side-body .dbm-tree-item', ${JSON.stringify(database)}), 15000);
    if (!dbNode) return { fatal: 'the target database is not in the tree', error: (document.querySelector('.dbm-error') || {}).textContent };
    const caret = dbNode.querySelector('.dbm-caret-btn');
    click(caret || dbNode);
    await sleep(2500);

    const sideBody = document.querySelector('.dbm-side-body');
    const rows = Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item'));
    // Rows that HAVE a count, which are the ones the bug was about.
    const withCounts = rows.map((el) => {
      const meta = el.querySelector('.dbm-tree-meta');
      if (meta === null) return null;
      const nameEl = el.querySelector('.dbm-tree-name') || el.querySelector('.dbm-node-name');
      const metaRect = meta.getBoundingClientRect();
      const rowRect = el.getBoundingClientRect();
      const bodyRect = sideBody.getBoundingClientRect();
      return {
        label: (nameEl ? nameEl.textContent : el.textContent || '').trim().slice(0, 50),
        count: (meta.textContent || '').trim(),
        countRight: Math.round(metaRect.right),
        rowRight: Math.round(rowRect.right),
        // The visible right edge of the scroll container, minus its scrollbar.
        visibleRight: Math.round(bodyRect.left + sideBody.clientWidth),
        // Positive means the count extends past what the container can show.
        pastVisible: Math.round(metaRect.right) - Math.round(bodyRect.left + sideBody.clientWidth),
        metaWidth: Math.round(metaRect.width),
        metaScrollWidth: meta.scrollWidth,
        nameTruncated: nameEl === null ? null : nameEl.scrollWidth > nameEl.clientWidth + 1,
      };
    }).filter(Boolean);

    return {
      bodyClientWidth: sideBody.clientWidth,
      bodyScrollWidth: sideBody.scrollWidth,
      overflows: sideBody.scrollWidth > sideBody.clientWidth,
      withCounts,
    };
  })()`)

  console.log(JSON.stringify(report, null, 2))

  if (report.fatal !== undefined) {
    console.error(`\nfatal: ${report.fatal}`)
    process.exitCode = 1
  } else {
    /*
     * The DATABASE row is what this checks.
     *
     * The reported bug was the count on a database node ('my91jf  10:' with the
     * last character cut off). A table row carries a count only once the row
     * statistics have been fetched, so requiring one here would fail for a reason
     * unrelated to the bug.
     *
     * What must hold: the target database's own row rendered a count, and nothing
     * with a count extends past the visible area. Requiring that row also stops a
     * silently-empty measurement from passing — an earlier version typed the
     * database name into the tree filter, which excluded every table and measured
     * one unrelated row.
     */
    const dbRow = report.withCounts.find(entry => entry.label === database)
    const clipped = report.withCounts.filter(entry => entry.pastVisible > 0 || entry.metaWidth < entry.metaScrollWidth)
    console.log(`\ntree body: client ${report.bodyClientWidth} / scroll ${report.bodyScrollWidth}`)
    console.log(`${report.withCounts.length} row(s) with a count, ${clipped.length} clipped`)
    for (const entry of report.withCounts) {
      console.log(`  ${entry.pastVisible > 0 ? 'CLIPPED' : 'ok     '} ${entry.label} = ${entry.count} (past visible: ${entry.pastVisible}, name truncated: ${entry.nameTruncated})`)
    }
    if (dbRow === undefined) {
      console.error(`the database row "${database}" rendered no count, so the bug case was not measured`)
      process.exitCode = 1
    }
    if (clipped.length > 0 || report.overflows) process.exitCode = 1
  }
} finally {
  // Remove this run's source.
  try {
    const origin = baseUrl.replace(/\/\?.*$/, '')
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name.startsWith(sourceName))) {
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' })
      console.error(`note: removed the run's data source (${source.id})`)
    }
  } catch (error) {
    console.error(`note: cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  try { socket?.close() } catch { /* gone */ }
  child.kill()
  await wait(1000)
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}
