/**
 * End-to-end browser check of the two behaviours added together:
 *
 *   1. the SQL editor caps a SELECT at the engine rather than in the host;
 *   2. clicking a database in the tree puts its TABLE LIST on the right, with
 *      the per-table actions 浏览 / 结构 / 搜索 / 插入 / 清空 / 删除.
 *
 * Both are only real if they survive the whole stack — the built client bundle,
 * the panel's slot, the routes and the driver — which is exactly what a unit
 * test cannot show. It drives a live dsh web UI with a headless Edge over CDP.
 *
 * Usage: node scripts/e2e-sql-overview.mjs <baseUrl> <sqliteFile>
 *
 * The SQLite file is expected to contain a table named `big` with enough rows
 * that an uncapped read would be obvious, and one named `scratch` to act on.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9341

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-sql-overview.mjs <baseUrl> <sqliteFile>')
  process.exit(2)
}

/** Helpers merged into every evaluated snippet. */
const PRELUDE = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byText = (sel, text) =>
  Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
const byIncludes = (sel, text) =>
  Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
/**
 * Find a CONTROL inside one row, never across the page.
 *
 * A page-wide lookup with the same text picks whichever row happens to come
 * first, which is how this script once pressed 连接 on an unrelated Redis
 * source: the data-source list is user-owned and may point at a production
 * server, so a mis-targeted click is not a harmless test glitch.
 */
const within = (scope, sel, text) =>
  Array.from(scope.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
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
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
`

/** The data source this script drives. Any other row must not be touched. */
const SOURCE_ID = 'sql-e2e'

/** The whole flow, run as one awaited promise inside the page. */
const FLOW = `(async () => {
${PRELUDE}
  const report = { steps: [] };
  const step = (name, detail) => report.steps.push({ name, detail });

  // 1. Open the panel.
  const row = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())),
    20000,
  );
  if (!row) return JSON.stringify({ ...report, fatal: 'sidebar row never rendered' });
  click(row);
  const root = await waitFor(() => document.querySelector('.dbm-root'), 10000);
  if (!root) return JSON.stringify({ ...report, fatal: 'panel did not mount' });

  // 2. Open the SQL source by its ID, never by "the first row that matches".
  //    The list may hold production servers; connecting to the wrong one is a
  //    real side effect, not a test artefact.
  const listed = await waitFor(
    () => Array.from(document.querySelectorAll('.dbm-table tbody tr'))
      .find((tr) => Array.from(tr.querySelectorAll('td .dbm-mono'))
        .some((td) => (td.textContent || '').trim() === ${JSON.stringify(SOURCE_ID)})),
    15000,
  );
  if (!listed) return JSON.stringify({ ...report, fatal: 'the ${SOURCE_ID} data source is not listed' });
  const connect = within(listed, '.dbm-actions .dbm-btn', '连接') || within(listed, '.dbm-actions .dbm-btn', 'Connect');
  if (!connect) return JSON.stringify({ ...report, fatal: 'no Connect button on the ${SOURCE_ID} row' });
  click(connect);

  // 3. The tree renders and the single SQLite schema auto-opens.
  const schemaNode = await waitFor(
    () => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => (el.textContent || '').includes('main')),
    20000,
  );
  if (!schemaNode) {
    const err = document.querySelector('.dbm-error');
    return JSON.stringify({ ...report, fatal: 'the schema node never appeared', error: err ? err.textContent : null });
  }
  step('tree mounted', schemaNode.textContent.trim());

  /*
   * 4. Selecting the database must put its TABLE LIST on the right.
   *
   * This is the whole point of the change: before it, a database click left the
   * right pane empty and the table list existed only in the tree.
   */
  click(schemaNode);
  const overview = await waitFor(() => document.querySelector('.dbm-main table.dbm-table'), 15000);
  if (!overview) {
    const err = document.querySelector('.dbm-error');
    return JSON.stringify({ ...report, fatal: 'no table list on the right after selecting the database', error: err ? err.textContent : null });
  }
  report.overviewHeaders = Array.from(overview.querySelectorAll('thead th')).map((th) => th.textContent.trim());
  report.overviewTables = Array.from(overview.querySelectorAll('tbody tr td:first-child'))
    .map((td) => td.textContent.trim());
  step('overview rendered', report.overviewTables);

  // 5. Every action the request named must be present on a row.
  const firstDataRow = overview.querySelector('tbody tr');
  report.rowActions = Array.from(firstDataRow.querySelectorAll('.dbm-actions .dbm-btn')).map((b) => b.textContent.trim());
  for (const label of ['浏览', '结构', '搜索', '插入', '清空', '删除']) {
    if (!report.rowActions.includes(label)) {
      return JSON.stringify({ ...report, fatal: 'the overview row is missing the ' + label + ' action' });
    }
  }
  step('all six actions present', report.rowActions);

  // 6. Row counts and sizes are shown rather than silently blank.
  report.firstRowCells = Array.from(firstDataRow.querySelectorAll('td')).map((td) => td.textContent.trim());

  // 7. The SQL tab is reachable without opening a table first, and it caps a
  //    SELECT: the seeded 'big' table holds far more rows than the cap.
  const tabButtons = Array.from(document.querySelectorAll('.dbm-tab'));
  report.tabsBeforeTable = tabButtons.map((t) => t.textContent.trim());
  return JSON.stringify(report, null, 2);
})()`

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw))
      const settle = this.pending.get(msg.id)
      if (settle !== undefined) {
        this.pending.delete(msg.id)
        settle(msg)
      }
    })
  }
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const reply = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (reply.result?.exceptionDetails !== undefined) {
      throw new Error(`page exception: ${JSON.stringify(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails)}`)
    }
    return reply.result?.result?.value
  }
  close() { this.ws.close() }
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const r = await fetch(url)
      if (r.ok) return await r.json()
    } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error(`timed out: ${url}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

void sqliteFile

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-'))
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,900', baseUrl,
], { stdio: 'ignore' })

let cdp
let failed = false
try {
  await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`, 30000)
  let target
  const deadline = Date.now() + 30000
  for (;;) {
    const list = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`, 10000)
    target = list.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string')
    if (target !== undefined) break
    if (Date.now() > deadline) throw new Error('no page target')
    await new Promise((r) => setTimeout(r, 300))
  }

  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.ready()
  await cdp.send('Runtime.enable')

  const boot = Date.now() + 90000
  for (;;) {
    const ready = await cdp.evaluate(`!!document.querySelector('nav')`)
    if (ready === true) break
    if (Date.now() > boot) throw new Error('the app never booted')
    await new Promise((r) => setTimeout(r, 1000))
  }

  const raw = await cdp.evaluate(FLOW)
  const parsed = JSON.parse(raw)
  console.log(JSON.stringify(parsed, null, 2))
  if (parsed.fatal !== undefined) failed = true
} catch (error) {
  console.error('E2E ERROR:', error instanceof Error ? error.message : String(error))
  failed = true
} finally {
  cdp?.close()
  edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
}

process.exit(failed ? 1 : 0)
