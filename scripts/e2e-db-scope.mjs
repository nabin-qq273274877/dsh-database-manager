/**
 * Verify the header no longer claims a database, and that a database's identity
 * appears only where it actually matters.
 *
 * Background: the header used to render a /db{n} suffix from a selection that only
 * key and folder clicks updated — so browsing db0 read "/db2" once a key in db2
 * had been opened, and expanding a database did not update it. The number is gone
 * because the panel shows every expanded database at once and no single value can
 * describe that.
 *
 * This asserts the replacement behaviour:
 *  - the header shows host:port only;
 *  - expanding a database shows it as selected (the { kind: 'db' } selection the
 *    type declared but nothing ever assigned);
 *  - the console names the database its command targets, and that target follows
 *    a database change;
 *  - refresh still rescans EVERY expanded database, which was never a bug.
 *
 * Read-only: it expands databases and switches tabs; it never writes a key.
 *
 * Usage: node scripts/e2e-db-scope.mjs <baseUrl-with-token> <sourceId> <dbA> <dbB> [sourceDb]
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9355

const [baseUrl, sourceId, dbAArg, dbBArg, sourceDbArg] = process.argv.slice(2)
if (baseUrl === undefined || sourceId === undefined || dbAArg === undefined || dbBArg === undefined) {
  console.error('usage: node scripts/e2e-db-scope.mjs <baseUrl-with-token> <sourceId> <dbA> <dbB> [sourceDb]')
  process.exit(2)
}
const dbA = Number(dbAArg)
const dbB = Number(dbBArg)
/** The database the data source is configured for — what the console defaults to. */
const sourceDb = sourceDbArg === undefined ? dbA : Number(sourceDbArg)

const FLOW = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms) => {
    const end = Date.now() + ms;
    for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(60); }
  };
  const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
  const byText = (sel, text, scope) =>
    Array.from((scope || document).querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;

  const requests = [];
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.includes('/api/dsh-database')) {
      const m = /[?&]db=(\\d+)/.exec(url);
      requests.push({ url: url.replace(/^.*\\/api/, '/api'), db: m ? Number(m[1]) : null });
    }
    return originalFetch.apply(this, arguments);
  };

  const subtitle = () => {
    const el = document.querySelector('.dbm-subtitle');
    return el ? (el.textContent || '').trim() : null;
  };
  const dbRow = (n) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .find((el) => (el.getAttribute('data-db') || '') === String(n)) || null;
  const activeDbRows = () => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .filter((el) => el.getAttribute('data-active') === 'true')
    .map((el) => el.getAttribute('data-db'));
  const expandedDbs = () => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .filter((el) => el.getAttribute('aria-expanded') === 'true')
    .map((el) => el.getAttribute('data-db'));
  const refreshBtn = () => Array.from(document.querySelectorAll('.dbm-side-head button'))
    .find((b) => ['重新扫描', 'Rescan'].includes((b.getAttribute('title') || '').trim())) || null;

  const report = { steps: [] };
  const step = (name, detail) => report.steps.push({ name, detail });
  const mark = (label) => report[label] = { subtitle: subtitle(), activeDbs: activeDbRows() };
  const levelsSince = (n) => requests.slice(n).filter((r) => r.url.includes('/redis/level')).map((r) => r.db).sort((a, b) => a - b);

  const sidebar = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())), 20000);
  if (!sidebar) return JSON.stringify({ ...report, fatal: 'no sidebar row' });
  click(sidebar);
  await waitFor(() => document.querySelector('.dbm-root'), 10000);

  const sourceRow = await waitFor(() => Array.from(document.querySelectorAll('.dbm-table tbody tr'))
    .find((row) => (row.textContent || '').includes(${JSON.stringify(sourceId)})) ?? null, 15000);
  if (!sourceRow) return JSON.stringify({ ...report, fatal: 'source row not found' });
  const connect = Array.from(sourceRow.querySelectorAll('.dbm-actions .dbm-btn'))
    .find((b) => ['连接', 'Connect'].includes((b.textContent || '').trim())) || null;
  if (!connect) return JSON.stringify({ ...report, fatal: 'no connect button' });
  click(connect);

  await waitFor(() => document.querySelector('.dbm-side-body [data-kind="db"]'), 20000);
  await sleep(1500);
  mark('afterConnect');

  // 0. Entering the panel must scan NOTHING. Auto-expanding the source's own
  //    database made entry cost a full SCAN of it — 485k keys in the worst case
  //    here — before the database list could be used.
  const levelCallsOnOpen = requests.filter((r) => r.url.includes('/redis/level'));
  report.levelCallsOnOpen = levelCallsOnOpen.map((r) => r.db);
  step('nothing is scanned on open', levelCallsOnOpen.length === 0);
  step('no database is expanded on open', expandedDbs().length === 0);

  // 1. The header must not carry a database number any more.
  const sub = subtitle();
  report.subtitleText = sub;
  step('header shows host:port without a db number',
    typeof sub === 'string' && sub.length > 0 && !/\\/db\\d/.test(sub) && !/db\\d+$/.test(sub));

  const ensureExpanded = async (n) => {
    const row = dbRow(n);
    if (!row) return false;
    if (row.getAttribute('aria-expanded') !== 'true') click(row);
    await waitFor(() => {
      const now = dbRow(n);
      return now && now.getAttribute('aria-expanded') === 'true' ? true : null;
    }, 25000);
    return true;
  };

  // 2. Expanding a database selects it, which is what makes the row highlight.
  //    Nothing is open at this point, so this also proves that opening is what
  //    drives the selection rather than the initial state.
  if (!await ensureExpanded(${dbA})) return JSON.stringify({ ...report, fatal: 'cannot expand dbA' });
  await sleep(1200);
  mark('afterOpeningDbA');
  step('opening a database scans only that database',
    levelsSince(0).length === 1 && levelsSince(0)[0] === ${dbA});
  step('opening dbA marks it active', activeDbRows().includes(String(${dbA})));

  if (!await ensureExpanded(${dbB})) return JSON.stringify({ ...report, fatal: 'cannot expand dbB' });
  await sleep(1200);
  mark('afterOpeningDbB');
  step('opening dbB moves the active mark to dbB',
    activeDbRows().includes(String(${dbB})) && !activeDbRows().includes(String(${dbA})));

  // 3. The console must state its target, and that target must NOT wander.
  const consoleTab = byText('.dbm-tab', '命令行') || byText('.dbm-tab', 'Console');
  if (!consoleTab) {
    report.tabLabels = Array.from(document.querySelectorAll('.dbm-tab')).map((el) => (el.textContent || '').trim());
    step('console tab reachable', 'no console tab found');
  } else {
    click(consoleTab);
    await sleep(900);
    const consoleSelect = () => document.querySelector('.dbm-tab-body .dbm-select');
    if (consoleSelect() === null) {
      // Report what the panel actually rendered, so a wrong selector is
      // distinguishable from a console that failed to mount.
      report.diagnostic = {
        activeTab: (document.querySelector('.dbm-tab[data-active="true"]') || {}).textContent || null,
        tabBodyClasses: Array.from(document.querySelectorAll('.dbm-tab-body')).map((el) => el.className),
        selectCount: document.querySelectorAll('select').length,
        selects: Array.from(document.querySelectorAll('select')).map((el) => el.className),
      };
      step('console offers a target selector', 'no .dbm-select rendered');
      return JSON.stringify(report, null, 2);
    }
    // Optional chaining throughout: an element that goes away mid-step must
    // surface as a null in the report rather than abort the whole run, which
    // would lose every observation gathered before it.
    report.consoleDbInitial = consoleSelect()?.value ?? null;
    step('console offers a target selector', consoleSelect() !== null);
    // Seeded from the source's own configured database, which is a fixed,
    // predictable default — not "whatever the user happened to click last".
    step('console target starts at the source database',
      (consoleSelect()?.value ?? null) === String(${sourceDb}));

    if (consoleSelect()) {
      const selSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      selSetter.call(consoleSelect(), String(${dbB}));
      consoleSelect().dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(500);
      report.consoleDbAfterChange = consoleSelect()?.value ?? null;
      step('console target follows an explicit change', (consoleSelect()?.value ?? null) === String(${dbB}));

      // The chosen database must be the one a command runs against.
      const n = requests.length;
      const input = document.querySelector('.dbm-tab-body input.dbm-input');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'PING');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(1500);
        const commandCalls = requests.slice(n).filter((r) => r.url.includes('/redis/command'));
        report.commandRequests = commandCalls;
        step('a command runs against the picked database',
          commandCalls.length > 0 && commandCalls.every((r) => r.db === ${dbB}));
      }

      // A write's target must survive inspecting a key elsewhere. This is the
      // hazard the separation exists for: the console can write, so clicking a
      // key in another database must not silently redirect it.
      //
      // Clicking a key switches the right pane to the value tab, so the console
      // has to be re-opened before its target can be read.
      const otherKey = document.querySelector('.dbm-side-body [data-kind="key"]');
      report.inspectedKey = otherKey ? otherKey.getAttribute('data-key') : null;
      if (otherKey) {
        click(otherKey);
        await sleep(1200);
        if (consoleTab) {
          click(consoleTab);
          await sleep(800);
        }
      }
      report.consoleDbAfterInspectingAKey = consoleSelect()?.value ?? null;
      step('inspecting a key elsewhere does not redirect the console',
        (consoleSelect()?.value ?? null) === String(${dbB}));
    }
  }

  // 4. Refresh still rescans every expanded database — that was never the bug.
  const n = requests.length;
  const refresh = refreshBtn();
  if (!refresh) {
    // The refresh control is replaced by the search-clear button while a search
    // is active; there is none here, so this is a genuine missing control.
    step('refresh control present', 'not found');
  } else {
    click(refresh);
    await sleep(2500);
    const reloaded = levelsSince(n);
    report.refreshReloadedDbs = reloaded;
    step('refresh rescans every expanded database',
      reloaded.includes(${dbA}) && reloaded.includes(${dbB}));
  }

  report.finalActiveDbs = activeDbRows();
  return JSON.stringify(report, null, 2);
})()`

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.nextId = 1; this.pending = new Map()
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)); const s = this.pending.get(msg.id)
      if (s !== undefined) { this.pending.delete(msg.id); s(msg) }
    })
  }
  ready() { return new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej) }) }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })) })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails !== undefined) throw new Error(r.result.exceptionDetails.exception?.description ?? '')
    return r.result?.result?.value
  }
  close() { this.ws.close() }
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try { const r = await fetch(url); if (r.ok) return await r.json() } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error(`timed out: ${url}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-dbscope-'))
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
    if (Date.now() > boot) throw new Error('never booted')
    await new Promise((r) => setTimeout(r, 1000))
  }
  const parsed = JSON.parse(await cdp.evaluate(FLOW))
  console.log(JSON.stringify(parsed, null, 2))
  if (parsed.fatal !== undefined) failed = true
  if (Array.isArray(parsed.steps) && parsed.steps.some((s) => s.detail !== true)) failed = true
} catch (error) {
  console.error('E2E ERROR:', error instanceof Error ? error.message : String(error))
  failed = true
} finally {
  cdp?.close(); edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
}

process.exit(failed ? 1 : 0)
