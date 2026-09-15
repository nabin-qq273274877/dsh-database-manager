/**
 * End-to-end browser check of the panel's real interaction path.
 *
 * Drives a live dsh web UI with a headless Edge over CDP and walks the flow a
 * user actually takes: open the panel from the sidebar row, create a data
 * source through the dialog, press 连接, then verify the SQL panel rendered its
 * tree and its data grid. It asserts on rendered geometry and computed style,
 * so a missing stylesheet or a broken slot shows up as a failure rather than as
 * something a human has to notice.
 *
 * Usage: node scripts/e2e-panel.mjs <baseUrl-with-token> <sqliteFile>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9335

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/e2e-panel.mjs <baseUrl-with-token> <sqliteFile>')
  process.exit(2)
}

/** Merge a wait helper into each evaluated snippet. */
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
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
`

/** The whole flow, run as one awaited promise inside the page. */
const FLOW = `(async () => {
${PRELUDE}
  const report = { steps: [] };
  const step = (name, detail) => report.steps.push({ name, detail });

  // 1. The sidebar row exists and its label is the localized copy.
  const row = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())),
    20000,
  );
  if (!row) return JSON.stringify({ ...report, fatal: 'sidebar row never rendered' });
  step('sidebar row found', row.getAttribute('aria-label'));

  // 2. Open the panel.
  click(row);
  const root = await waitFor(() => document.querySelector('.dbm-root'), 10000);
  if (!root) return JSON.stringify({ ...report, fatal: 'panel did not mount after clicking the row' });
  step('panel mounted', { w: root.getBoundingClientRect().width, h: root.getBoundingClientRect().height });

  // 3. The panel is styled, not naked markup.
  const probe = document.querySelector('.dbm-btn');
  const probeStyle = probe ? getComputedStyle(probe) : null;
  report.styled = {
    styleTag: !!document.querySelector('style[data-plugin-css="dsh-database-manager"]'),
    buttonRadius: probeStyle ? probeStyle.borderRadius : null,
    buttonDisplay: probeStyle ? probeStyle.display : null,
    headerPadding: (() => {
      const h = document.querySelector('.dbm-header');
      return h ? getComputedStyle(h).padding : null;
    })(),
  };
  step('styled', report.styled);

  // 4. Open the create dialog.
  const newBtn = await waitFor(() => byText('.dbm-btn', '+ 新增数据库') || byText('.dbm-btn', '+ New database'), 5000);
  if (!newBtn) return JSON.stringify({ ...report, fatal: 'no New database button' });
  click(newBtn);
  const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
  if (!modal) return JSON.stringify({ ...report, fatal: 'create dialog did not open' });
  step('dialog open', getComputedStyle(modal).borderRadius);

  // 5. Fill it: name + file (sqlite is the default engine).
  const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
  const nameInput = inputs[0];
  const fileInput = inputs.find((i) => (i.getAttribute('placeholder') || '').includes('D:/data'));
  if (!nameInput || !fileInput) return JSON.stringify({ ...report, fatal: 'dialog inputs not found' });
  setInput(nameInput, 'E2E App');
  setInput(fileInput, ${JSON.stringify(sqliteFile)});
  await sleep(200);

  // 6. Save.
  const save = byText('.dbm-modal-foot .dbm-btn', '保存') || byText('.dbm-modal-foot .dbm-btn', 'Save');
  if (!save) return JSON.stringify({ ...report, fatal: 'no Save button' });
  click(save);

  // 7. The list should now show the row.
  const listed = await waitFor(() => byIncludes('.dbm-table td', 'E2E App'), 10000);
  if (!listed) return JSON.stringify({ ...report, fatal: 'created source not listed' });
  step('source listed', listed.textContent.trim());

  // 8. Press 连接 on that row.
  const dataRow = listed.closest('tr');
  const connect = dataRow ? byText('.dbm-actions .dbm-btn', '连接') || byText('.dbm-actions .dbm-btn', 'Connect') : null;
  if (!connect) return JSON.stringify({ ...report, fatal: 'no Connect button' });
  click(connect);

  // 9. The SQL panel should render its table tree.
  const tableRow = await waitFor(() => byIncludes('.dbm-side-body .dbm-tree-item', 'users'), 15000);
  if (!tableRow) {
    const err = document.querySelector('.dbm-error');
    return JSON.stringify({ ...report, fatal: 'table tree never appeared', error: err ? err.textContent : null });
  }
  step('table tree shows users', tableRow.textContent.trim());

  // 10. Open it and read the data grid.
  click(tableRow);
  const cell = await waitFor(() => {
    const tds = Array.from(document.querySelectorAll('.dbm-data td'));
    return tds.find((td) => (td.textContent || '').includes('alice')) || null;
  }, 10000);
  if (!cell) {
    const err = document.querySelector('.dbm-error');
    return JSON.stringify({ ...report, fatal: 'browse grid showed no rows', error: err ? err.textContent : null });
  }
  step('browse grid shows alice', cell.textContent.trim());

  report.tabs = Array.from(document.querySelectorAll('.dbm-tab')).map((t) => t.textContent.trim());
  report.gridHeaders = Array.from(document.querySelectorAll('.dbm-data th')).map((t) => t.textContent.trim());
  const firstCell = document.querySelector('.dbm-data td');
  report.gridCellStyle = firstCell
    ? { fontFamily: getComputedStyle(firstCell).fontFamily.slice(0, 30), border: getComputedStyle(firstCell).borderTopWidth }
    : null;
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

  // Wait for the app shell before starting the flow.
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
