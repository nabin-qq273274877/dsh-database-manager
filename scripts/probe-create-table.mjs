import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/**
 * Verify the two NEW surfaces of this round, through the UI, against real MySQL.
 *
 *   requirement 2 — 新建表: a freshly created database must have a way to get a table.
 *   requirement 3 — 修改字符集 must open with the database's CURRENT charset and
 *                   collation already filled in.
 *
 * Both are checked against the SERVER afterwards: the table's existence and its
 * column/key shape come from 'information_schema', not from the dialog saying "done".
 * A create that reports success without creating, or that loses the primary key, is
 * invisible to a UI-only assertion.
 *
 * Usage: node scripts/probe-create-table.mjs <baseUrl-with-token> <host:port:user:password>
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9371
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = connection.split(':')
const sourceName = `Create Table ${process.pid}`
const database = `dbm_ctprobe_${process.pid}`

const profile = mkdtempSync(join(tmpdir(), 'dbm-ct-'))
const child = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
  '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' })
const wait = ms => new Promise(r => setTimeout(r, ms))

const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail === undefined ? '' : ' → ' + JSON.stringify(detail)}`)
}

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
    const out = { failures: [], notes: [] };
    const fail = (n, d) => out.failures.push({ name: n, detail: d === undefined ? null : d });

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
    if (!listed) { fail('source not listed', (document.querySelector('.dbm-error')||{}).textContent); return out; }
    const sources = await api('/api/dsh-database/sources');
    const matches = sources.sources.filter((s) => s.name === ${JSON.stringify(sourceName)});
    if (matches.length !== 1) { fail('source id not unique', matches.length); return out; }
    const sid = matches[0].id;
    out.sourceId = sid;
    click(Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn')).find((b) => ['连接','Connect'].includes(b.textContent.trim())));
    await sleep(3500);

    // A fresh, empty database: exactly the case with no way to create a table.
    await api('/api/dsh-database/sources/' + sid + '/database', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'create', name: ${JSON.stringify(database)} , charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' }) });
    await sleep(800);
    const reload = document.querySelector('[data-dbm-side-refresh]');
    if (reload) { click(reload); await sleep(2500); }
    const node = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => (el.textContent || '').includes(${JSON.stringify(database)})), 15000);
    if (!node) { fail('the new database is not in the tree'); return out; }
    click(node);
    await sleep(2500);

    // ---- requirement 2: the 新建表 entry exists on the table row ----------
    out.createTableButton = document.querySelector('[data-dbm-dbop="create-table"]') !== null;
    out.toolbarText = (document.querySelector('.dbm-main') || {}).textContent?.slice(0, 120);

    // ---- requirement 3: 修改字符集 prefills the CURRENT values -----------
    const charsetBtn = document.querySelector('[data-dbm-dbop="charset"]');
    if (charsetBtn === null) { fail('no charset control'); return out; }
    click(charsetBtn);
    const charsetDialog = await waitFor(() => document.querySelector('[data-dbm-dbop-charset]'), 6000);
    if (charsetDialog === null) { fail('the charset dialog did not open'); return out; }
    // Wait for the async read of the schema's defaults to land.
    await waitFor(() => (document.querySelector('[data-dbm-dbop-charset]') || {}).value !== '', 6000);
    await sleep(400);
    const dlg = charsetDialog.closest('.dbm-modal');
    const charsetEl = dlg.querySelector('[data-dbm-dbop-charset]');
    const collateEl = dlg.querySelector('[data-dbm-dbop-collate]');
    out.prefill = {
      charset: charsetEl ? charsetEl.value : null,
      collate: collateEl ? collateEl.value : null,
      currentHint: (dlg.querySelector('[data-dbm-dbop-current]') || {}).textContent || null,
    };
    click(dlg.querySelector('.dbm-btn'));

    // ---- requirement 2 (continued): create a table through the dialog -----
    if (!out.createTableButton) return out;
    const createTable = document.querySelector('[data-dbm-dbop="create-table"]');
    click(createTable);
    const ctDialog = await waitFor(() => document.querySelector('[data-dbm-newtable-name]'), 6000);
    if (ctDialog === null) { fail('the new-table dialog did not open'); return out; }
    const ct = ctDialog.closest('.dbm-modal');
    out.initialRows = ct.querySelectorAll('[data-dbm-newtable-colname]').length;
    setInput(ct.querySelector('[data-dbm-newtable-name]'), 'people');
    // First row defaults to id INTEGER key auto-increment; fill a second column.
    click(ct.querySelector('[data-dbm-newtable-add]'));
    await sleep(300);
    const names = Array.from(ct.querySelectorAll('[data-dbm-newtable-colname]'));
    const types = Array.from(ct.querySelectorAll('[data-dbm-newtable-coltype]'));
    setInput(names[0], 'id');
    setInput(types[0], 'INT');
    setInput(names[1], 'name');
    setInput(types[1], 'VARCHAR(50)');
    await sleep(200);
    out.beforeSubmit = {
      names: names.map((el) => el.value),
      types: types.map((el) => el.value),
      keyTicked: Array.from(ct.querySelectorAll('[data-dbm-newtable-key]')).map((el) => el.checked),
      autoTicked: Array.from(ct.querySelectorAll('input[type=checkbox]')).map((el) => el.checked),
    };
    // Watch for a busy state while it runs.
    const submit = ct.querySelector('[data-dbm-newtable-submit]');
    click(submit);
    const samples = [];
    const timer = setInterval(() => {
      const btn = document.querySelector('[data-dbm-newtable-submit]');
      if (btn === null) return;
      if (btn.disabled === true || btn.querySelector('.dbm-spinner') !== null) samples.push(1);
    }, 15);
    const closed = await waitFor(() => document.querySelector('[data-dbm-newtable-submit]') === null ? true : null, 20000);
    clearInterval(timer);
    out.submitBusySamples = samples.length;
    out.submitClosed = closed === true;
    // An error left in the dialog would mean the create was refused.
    out.dialogError = (document.querySelector('[data-dbm-newtable-error]') || {}).textContent || null;
    await sleep(2000);

    // The table must now be listed.
    out.listedAfter = (document.querySelector('.dbm-main') || {}).textContent?.slice(0, 160);
    return out;
  })()`)

  console.log(JSON.stringify(out, null, 2))

  // ---- verify against the SERVER, not against the panel's report --------
  const origin = baseUrl.replace(/\/\?.*$/, '')
  const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
  const source = sources.sources.find(entry => entry.name.startsWith(sourceName))
  if (source === undefined) {
    check('the run data source exists', false)
  } else {
    const query = async sql => {
      const response = await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}/query`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql, limit: 100 }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'query failed')
      return body.result.rows
    }

    // requirement 2: the table really exists with the right shape.
    check('the 新建表 entry is present', out.createTableButton === true, out.toolbarText)
    check('the table was created on the server', await query(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='people'`).then(rows => String(rows[0][0]) === '1'), out.listedAfter)
    const columns = await query(`SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='people' ORDER BY ORDINAL_POSITION`)
    check('the created table has both columns', columns.length === 2, columns.map(row => row[0]))
    check('the key landed on the first column', String(columns[0]?.[2] ?? '') === 'PRI', columns.map(row => [row[0], row[2], row[3]]))
    check('the key column auto-increments', /auto_increment/i.test(String(columns[0]?.[3] ?? '')), columns[0])

    // The table must be usable: insert without the key and read it back.
    await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}/query`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql: `INSERT INTO ${database}.people(name) VALUES ('x')`, allowWrite: true }),
    })
    const inserted = await query(`SELECT id, name FROM ${database}.people`)
    check('the auto-increment assigned a key', String(inserted[0]?.[0] ?? '') === '1' && String(inserted[0]?.[1] ?? '') === 'x', inserted)

    // requirement 3: the prefill matched what the server holds.
    const actual = await query(`SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${database}'`)
    const serverCharset = String(actual[0]?.[0] ?? '')
    const serverCollate = String(actual[0]?.[1] ?? '')
    check('修改字符集 prefilled the CURRENT charset', out.prefill?.charset === serverCharset, { prefilled: out.prefill?.charset, server: serverCharset })
    check('修改字符集 prefilled the CURRENT collation', out.prefill?.collate === serverCollate, { prefilled: out.prefill?.collate, server: serverCollate })
    check('the dialog states the current values', typeof out.prefill?.currentHint === 'string' && out.prefill.currentHint.includes(serverCharset), out.prefill?.currentHint)
  }
} finally {
  try {
    const origin = baseUrl.replace(/\/\?.*$/, '')
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    const source = sources.sources.find(entry => entry.name.startsWith(sourceName))
    if (source !== undefined) {
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}/database`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'drop', name: database }),
      }).catch(() => {})
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' })
      console.error(`note: dropped ${database} and removed the source`)
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
