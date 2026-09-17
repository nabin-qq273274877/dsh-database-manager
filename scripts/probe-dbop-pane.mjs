import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/**
 * What is the right-hand pane showing after 重命名 / 复制?
 *
 * Reported: it stays on "正在读取表和统计信息…". A screenshot-equivalent claim like
 * that has to be measured in the browser, because the state depends on three pieces of
 * React state interacting (activeSchema, statsBySchema, and the loading flag) and
 * reading the code only says which branch SHOULD render.
 *
 * Both operations are exercised for both a database WITH tables and an EMPTY one,
 * since the driver takes different paths there.
 *
 * Usage: node scripts/probe-dbop-pane.mjs <baseUrl-with-token> <host:port:user:password>
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9369
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = connection.split(':')
const sourceName = `DbOp Pane ${process.pid}`

const profile = mkdtempSync(join(tmpdir(), 'dbm-pane-'))
const child = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
  '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' })
const wait = ms => new Promise(r => setTimeout(r, ms))

let socket
try {
  let target
  for (let i = 0; i < 80 && target === undefined; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find(e => e.type === 'page')?.webSocketDebuggerUrl
    } catch { /* not up */ }
    if (target === undefined) await wait(250)
  }
  socket = new WebSocket(target, { maxPayload: 64 * 1024 * 1024 })
  await new Promise((res, rej) => { socket.on('open', res); socket.on('error', rej) })
  let id = 1
  const pending = new Map()
  socket.on('message', data => {
    const m = JSON.parse(String(data))
    if (m.id === undefined) return
    const e = pending.get(m.id)
    if (e) { pending.delete(m.id); m.error ? e.reject(new Error(m.error.message)) : e.resolve(m.result) }
  })
  const send = (method, params = {}) => new Promise((res, rej) => {
    pending.set(id, { resolve: res, reject: rej })
    socket.send(JSON.stringify({ id: id++, method, params }))
  })
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await send('Page.navigate', { url: baseUrl })
  await wait(4500)

  const out = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(150); } };
    const byIncludes = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(t)) || null;
    const byExact = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === t) || null;
    const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
    const setInput = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const setSelect = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const api = async (path, options) => {
      const r = await fetch(path, options);
      const b = await r.json().catch(() => null);
      if (!r.ok) throw new Error(path + ' -> ' + r.status + ': ' + (b && b.error ? b.error : ''));
      return b;
    };

    const report = { operations: [], failures: [] };
    const record = (entry) => report.operations.push(entry);

    // What the right pane is showing, in the panel's own words.
    const paneState = () => {
      const main = document.querySelector('.dbm-main');
      const text = (main ? main.textContent : '').replace(/\\s+/g, ' ').trim();
      return {
        text: text.slice(0, 160),
        loadingStats: text.includes('正在读取表和统计信息') || text.includes('Loading tables and statistics'),
        pickDatabase: text.includes('从左侧选择一个库') || text.includes('Pick a database'),
        hasTableList: main !== null && main.querySelector('tbody tr') !== null,
        tabsGone: document.querySelector('.dbm-tabs') === null,
      };
    };

    // Sign in and connect.
    const row = Array.from(document.querySelectorAll('nav button[aria-label]')).find((b) => ['数据库管理','Database'].includes((b.getAttribute('aria-label')||'').trim()));
    click(row); await sleep(1800);
    click(await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000));
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    const kindSelect = modal.querySelector('select.dbm-select');
    if (kindSelect) setSelect(kindSelect, 'mysql');
    await sleep(400);
    const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
    setInput(inputs[0], ${JSON.stringify(sourceName)});
    const hi = inputs.find((i) => (i.getAttribute('placeholder') || '').includes('127.0.0.1'));
    const ui = inputs.find((i) => (i.getAttribute('placeholder') || '').includes('root'));
    if (hi) setInput(hi, ${JSON.stringify(host)});
    if (ui) setInput(ui, ${JSON.stringify(user)});
    const pw = modal.querySelector('input[type=password]');
    if (pw) setInput(pw, ${JSON.stringify(password)});
    await sleep(300);
    click(byExact('.dbm-modal-foot .dbm-btn', '保存') || byExact('.dbm-modal-foot .dbm-btn', 'Save'));
    const listed = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(sourceName)}), 12000);
    if (!listed) { report.failures.push({ name: 'source not listed', detail: (document.querySelector('.dbm-error')||{}).textContent }); return report; }
    const sources = await api('/api/dsh-database/sources');
    const matches = sources.sources.filter((s) => s.name === ${JSON.stringify(sourceName)});
    if (matches.length !== 1) { report.failures.push({ name: 'source id not unique', n: matches.length }); return report; }
    report.sourceId = matches[0].id;
    click(Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn')).find((b) => ['连接','Connect'].includes(b.textContent.trim())));
    await sleep(3500);

    const sid = report.sourceId;
    const TAG = ${process.pid};

    /** Open the pane for one database by clicking its tree node. */
    const openDatabase = async (name) => {
      const node = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => (el.textContent || '').includes(name)), 15000);
      if (!node) return false;
      click(node);
      await sleep(2200);
      return true;
    };

    /** Drive one database-level operation through the dialog. */
    const runDialog = async (op, values) => {
      const trigger = document.querySelector('[data-dbm-dbop="' + op + '"]');
      if (trigger === null) { report.failures.push({ name: 'no control for ' + op }); return false; }
      click(trigger);
      const dialog = await waitFor(() => document.querySelector('.dbm-modal [data-dbm-dbop-submit]'), 6000);
      if (dialog === null) { report.failures.push({ name: 'dialog did not open for ' + op }); return false; }
      const dlg = dialog.closest('.dbm-modal');
      for (const [selector, value] of Object.entries(values)) {
        const el = dlg.querySelector(selector);
        if (el === null) { report.failures.push({ name: 'missing field ' + selector + ' in ' + op }); continue; }
        if (el.tagName === 'SELECT') setSelect(el, value);
        else setInput(el, value);
      }
      await sleep(400);
      const submit = dlg.querySelector('[data-dbm-dbop-submit]');
      const before = performance.now();
      click(submit);
      // Watch for ANY busy indication while it runs.
      const busySamples = [];
      const timer = setInterval(() => {
        const btn = document.querySelector('[data-dbm-dbop-submit]');
        if (btn === null) return;
        const text = (btn.textContent || '').trim();
        if (btn.disabled === true || /执行中|Running/.test(text)) busySamples.push({ t: Math.round(performance.now() - before), text, disabled: btn.disabled });
      }, 15);
      // Wait for the dialog to close, which is what "finished" looks like.
      const closed = await waitFor(() => document.querySelector('.dbm-modal') === null ? true : null, 25000);
      clearInterval(timer);
      await sleep(2500);
      return { closed: closed === true, busySamples: busySamples.length, busyFirst: busySamples[0] ?? null, elapsedMs: Math.round(performance.now() - before) };
    };

    // ---- case A: rename an EMPTY database (what 新建库 produces) ----------
    const emptyDb = 'dbm_pane_' + TAG + '_empty';
    await api('/api/dsh-database/sources/' + sid + '/database', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'create', name: emptyDb }) });
    await sleep(1200);
    // Reload the panel's own list so the new database appears in the tree.
    const reload = document.querySelector('[data-dbm-side-refresh]');
    if (reload) { click(reload); await sleep(2500); }
    if (!(await openDatabase(emptyDb))) { report.failures.push({ name: 'could not open ' + emptyDb }); return report; }
    record({ case: 'A: empty db opened', pane: paneState() });

    const renameResult = await runDialog('rename', { '[data-dbm-dbop-name]': emptyDb + '_new' });
    record({ case: 'A: rename empty db', result: renameResult, pane: paneState() });
    const afterRename = await api('/api/dsh-database/sources/' + sid + '/schemas');
    report.emptyAfterRename = {
      oldStillThere: afterRename.schemas.some((s) => s.name === emptyDb),
      newThere: afterRename.schemas.some((s) => s.name === emptyDb + '_new'),
    };

    // ---- case B: copy a database with tables ------------------------------
    const copySrc = 'dbm_pane_' + TAG + '_src';
    await api('/api/dsh-database/sources/' + sid + '/database', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'create', name: copySrc, charset: 'utf8mb4' }) });
    await api('/api/dsh-database/sources/' + sid + '/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: 'CREATE TABLE ' + copySrc + '.t1(id INT PRIMARY KEY)', allowWrite: true }) });
    if (reload) { click(reload); await sleep(2500); }
    await openDatabase(copySrc);
    // Expand it in the tree too, so the pane is genuinely "on" this database.
    const node = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => (el.textContent || '').includes(copySrc)), 10000);
    if (node) { const caret = node.querySelector('.dbm-caret-btn'); if (caret) { click(caret); await sleep(1500); } }
    record({ case: 'B: source db opened', pane: paneState() });

    const copyResult = await runDialog('copy', { '[data-dbm-dbop-name]': copySrc + '_copy' });
    record({ case: 'B: copy db', result: copyResult, pane: paneState() });

    // ---- case C: rename a database WITH tables ----------------------------
    const renameResult2 = await runDialog('rename', { '[data-dbm-dbop-name]': copySrc + '_ren' });
    record({ case: 'C: rename db with tables', result: renameResult2, pane: paneState() });
    const afterRename2 = await api('/api/dsh-database/sources/' + sid + '/schemas');
    report.tabledAfterRename = {
      oldStillThere: afterRename2.schemas.some((s) => s.name === copySrc),
      newThere: afterRename2.schemas.some((s) => s.name === copySrc + '_ren'),
    };

    // After the dust settles, does the pane ever recover on its own?
    await sleep(5000);
    record({ case: 'final state (after 5s idle)', pane: paneState() });

    report.cleanup = [emptyDb, emptyDb + '_new', copySrc, copySrc + '_copy', copySrc + '_ren'];
    return report;
  })()`)

  console.log(JSON.stringify(out, null, 2))
} finally {
  try {
    const origin = baseUrl.replace(/\/\?.*$/, '')
    const s = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    const source = s.sources.find(entry => entry.name.startsWith(sourceName))
    if (source !== undefined) {
      const schemas = await (await fetch(`${origin}/api/dsh-database/sources/${source.id}/schemas`)).json()
      for (const schema of schemas.schemas) {
        if (schema.name.startsWith('dbm_pane_')) {
          await fetch(`${origin}/api/dsh-database/sources/${source.id}/database`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ op: 'drop', name: schema.name }),
          })
          console.error(`note: dropped ${schema.name}`)
        }
      }
      await fetch(`${origin}/api/dsh-database/sources/${source.id}`, { method: 'DELETE' })
      console.error(`note: removed ${source.id}`)
    }
  } catch { /* best effort */ }
  try { socket?.close() } catch { /* gone */ }
  child.kill()
  await wait(1000)
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}
