import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/**
 * End-to-end check of the extended 新建表 form, against real MySQL.
 *
 * Reported and therefore measured here:
 *   1. the form was cut off and needed its own scrollbar — so the assertion is GEOMETRY:
 *      every header must be inside the dialog's visible width at the real window size,
 *      and the dialog must be wider than the default. A presence check would pass for
 *      the broken layout too.
 *   2. the per-column fields (length, collation, attributes, index kind, comment) must
 *      reach the SERVER: each is read back from information_schema, not from the panel.
 *   3. a COMPOSITE index must really be created as one index over several columns in the
 *      ticked order — read back from STATISTICS with SEQ_IN_INDEX, because "it made an
 *      index" would also be true of three separate single-column indexes.
 *   4. the table options (comment, collation, engine) must be applied.
 *
 * Usage: node scripts/probe-create-table-full.mjs <baseUrl-with-token> <host:port:user:password>
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9373
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = connection.split(':')
const sourceName = `CT Full ${process.pid}`
const database = `dbm_ctfull_${process.pid}`

const profile = mkdtempSync(join(tmpdir(), 'dbm-ctfull-'))
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

  const flow = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(150); } };
    const byIncludes = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(t)) || null;
    const byExact = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === t) || null;
    const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
    const setInput = (el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const setSelect = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const setCheck = (el, v) => { if (el.checked !== v) { el.checked = v; el.dispatchEvent(new Event('click', { bubbles: true })); } };
    const api = async (path, options) => {
      const r = await fetch(path, options);
      const b = await r.json().catch(() => null);
      if (!r.ok) throw new Error(path + ' -> ' + r.status + ': ' + (b && b.error ? b.error : ''));
      return b;
    };
    const out = { failures: [], notes: [] };
    const fail = (n, d) => out.failures.push({ name: n, detail: d === undefined ? null : d });

    // Connect.
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

    await api('/api/dsh-database/sources/' + sid + '/database', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'create', name: ${JSON.stringify(database)}, charset: 'utf8mb4' }) });
    await sleep(700);
    const reload = document.querySelector('[data-dbm-side-refresh]');
    if (reload) { click(reload); await sleep(2500); }
    const node = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => (el.textContent || '').includes(${JSON.stringify(database)})), 15000);
    if (!node) { fail('the database is not in the tree'); return out; }
    click(node); await sleep(2500);
    click(await waitFor(() => document.querySelector('[data-dbm-dbop="create-table"]'), 6000));
    const dialog = await waitFor(() => document.querySelector('[data-dbm-newtable-name]'), 6000);
    if (dialog === null) { fail('the new-table dialog did not open'); return out; }
    const dlg = dialog.closest('.dbm-modal');

    // ---- requirement 1: the form fits, with no cut-off columns -----------
    const dialogRect = dlg.getBoundingClientRect();
    const scroll = dlg.querySelector('.dbm-modal-body');
    const table = dlg.querySelector('.dbm-newtable-cols');
    const headers = Array.from(dlg.querySelectorAll('.dbm-newtable-cols thead th'));
    /*
     * The visible right edge is the DIALOG's, not the table's.
     *
     * Comparing each header against the table's own client width makes the check
     * vacuous: the table is as wide as its content, so every header is "inside" it by
     * construction and the assertion passed for a 1933px table inside a 560px dialog.
     * What matters is whether the header is inside what the USER can see.
     */
    const visibleRight = dialogRect.left + dialogRect.width;
    const headerInfo = headers.map((th) => ({
      label: (th.textContent || '').trim(),
      right: Math.round(th.getBoundingClientRect().right),
      inside: th.getBoundingClientRect().right <= visibleRight + 1,
    }));
    out.layout = {
      dialogWidth: Math.round(dialogRect.width),
      dialogRight: Math.round(visibleRight),
      viewportWidth: window.innerWidth,
      headerCount: headers.length,
      headers: headerInfo.map((h) => h.label),
      cutOff: headerInfo.filter((h) => !h.inside).map((h) => h.label),
      tableScrollWidth: table.scrollWidth,
      tableClientWidth: table.clientWidth,
      bodyScrollWidth: scroll ? scroll.scrollWidth : null,
      bodyClientWidth: scroll ? scroll.clientWidth : null,
      // The widest header's right edge, so a failure says how far out it is.
      widestHeaderRight: Math.max(...headerInfo.map((h) => h.right)),
    };

    // ---- fill the form with one of everything ---------------------------
    setInput(dlg.querySelector('[data-dbm-newtable-name]'), 'people');

    // Table options.
    const tableComment = dlg.querySelector('[data-dbm-newtable-tablecomment]');
    if (tableComment) setInput(tableComment, '人员表');
    const tableCollate = dlg.querySelector('[data-dbm-newtable-tablecollate]');
    if (tableCollate && tableCollate.tagName === 'SELECT') setSelect(tableCollate, 'utf8mb4_bin');
    const tableEngine = dlg.querySelector('[data-dbm-newtable-tableengine]');
    if (tableEngine && tableEngine.tagName === 'SELECT') setSelect(tableEngine, 'MyISAM');
    await sleep(300);

    // Row 1: id INT UNSIGNED NOT NULL, PRIMARY, auto-increment, comment.
    const set = (selector, index, value) => {
      const el = dlg.querySelector('[data-dbm-newtable-' + selector + '="' + index + '"]');
      if (el === null) { fail('missing control: ' + selector + '[' + index + ']'); return null; }
      if (el.tagName === 'SELECT') setSelect(el, value);
      else if (el.type === 'checkbox') setCheck(el, value === 'true' || value === true);
      else setInput(el, value);
      return el;
    };
    set('colname', 0, 'id');
    set('coltype', 0, 'INT');
    set('collength', 0, '');
    set('coldefault', 0, '');
    set('colcomment', 0, '主键');
    await sleep(200);
    /*
     * Tick UNSIGNED through the attribute DROPDOWN.
     *
     * The attribute control changed from a group of checkboxes to a select whose options
     * are toggles, so the old '[data-dbm-newtable-attr]' checkbox lookup finds nothing and
     * the attribute is never chosen — which is what this probe reported while the panel
     * was actually fine. Selecting the option and firing 'change' is what the control now
     * listens for.
     */
    const attrSelect = dlg.querySelector('[data-dbm-newtable-attr-select="0"]');
    out.attributeOptions = attrSelect === null ? null : Array.from(attrSelect.options).map((o) => o.value);
    if (attrSelect !== null) {
      setSelect(attrSelect, 'unsigned');
    }
    await sleep(300);
    out.unsignedTicked = attrSelect === null ? null : (dlg.querySelector('[data-dbm-newtable-attr-select="0"]').value === '');

    // Add rows 2 and 3.
    click(dlg.querySelector('[data-dbm-newtable-add]'));
    await sleep(300);
    click(dlg.querySelector('[data-dbm-newtable-add]'));
    await sleep(300);
    out.rowCount = dlg.querySelectorAll('[data-dbm-newtable-colname]').length;

    // Row 2: name VARCHAR(50) with a length, collation, comment; UNIQUE with an index name.
    set('colname', 1, 'name');
    set('coltype', 1, 'VARCHAR');
    set('collength', 1, '50');
    set('colcollate', 1, '');
    set('colcomment', 1, '姓名');
    set('coldefault', 1, '');
    set('index', 1, 'unique');
    await sleep(200);
    set('indexname', 1, 'uq_name_group');
    await sleep(200);
    // Row 3: joins the SAME index -> composite (name, group).
    set('colname', 2, 'group_code');
    set('coltype', 2, 'VARCHAR');
    set('collength', 2, '20');
    set('index', 2, 'unique');
    await sleep(200);
    set('indexname', 2, 'uq_name_group');
    await sleep(400);

    out.beforeSubmit = {
      names: Array.from(dlg.querySelectorAll('[data-dbm-newtable-colname]')).map((el) => el.value),
      types: Array.from(dlg.querySelectorAll('[data-dbm-newtable-coltype]')).map((el) => el.value),
      lengths: Array.from(dlg.querySelectorAll('[data-dbm-newtable-collength]')).map((el) => el.value),
      indexKinds: Array.from(dlg.querySelectorAll('[data-dbm-newtable-index]')).map((el) => el.value),
      indexNames: Array.from(dlg.querySelectorAll('[data-dbm-newtable-indexname]')).map((el) => el.value),
      tableEngine: tableEngine ? tableEngine.value : null,
      tableCollate: tableCollate ? tableCollate.value : null,
      tableComment: tableComment ? tableComment.value : null,
    };

    click(dlg.querySelector('[data-dbm-newtable-submit]'));
    const closed = await waitFor(() => document.querySelector('[data-dbm-newtable-submit]') === null ? true : null, 20000);
    out.submitClosed = closed === true;
    out.dialogError = (document.querySelector('[data-dbm-newtable-error]') || {}).textContent || null;
    await sleep(2000);

    // The form's own columns, so the assertion can name them.
    out.formHeaders = headers.map((th) => (th.textContent || '').trim());
    return out;
  })()`)

  if ((flow.failures ?? []).length > 0) {
    for (const failure of flow.failures) check(`flow: ${failure.name}`, false, failure.detail)
  }
  console.log(JSON.stringify({
    layout: flow.layout,
    unsignedEnabled: flow.unsignedEnabled,
    unsignedTicked: flow.unsignedTicked,
    rowCount: flow.rowCount,
    beforeSubmit: flow.beforeSubmit,
    submitClosed: flow.submitClosed,
    dialogError: flow.dialogError,
    formHeaders: flow.formHeaders,
  }, null, 2))

  // ---- requirement 1: the layout ----------------------------------------
  const layout = flow.layout ?? {}
  check('the dialog is wider than the default 560px', (layout.dialogWidth ?? 0) > 700, { dialogWidth: layout.dialogWidth, viewport: layout.viewportWidth })
  check('no column of the form is cut off', (layout.cutOff ?? []).length === 0, { cutOff: layout.cutOff, headers: layout.headers, widestHeaderRight: layout.widestHeaderRight, dialogRight: layout.dialogRight })
  /*
   * The inner-scroll check compares the grid against the SCROLL CONTAINER's width.
   *
   * Comparing 'table.scrollWidth' to 'table.clientWidth' is vacuous — a table is always
   * as wide as itself, so it passed for a 1684px grid inside a 1182px dialog. The
   * question is whether the grid fits in what the body can show.
   */
  check('the form does not need an inner horizontal scroll to see its columns',
    (layout.tableScrollWidth ?? 0) <= (layout.bodyClientWidth ?? 0) + 1,
    { tableScrollWidth: layout.tableScrollWidth, bodyClientWidth: layout.bodyClientWidth, bodyScrollWidth: layout.bodyScrollWidth })
  check('the form exposes every field the request asked for',
    ['字段名', '类型', '长度/值', '排序规则', '属性', '索引', '索引名', '允许空', '默认值', '自增', '注释'].every(label => (layout.headers ?? []).includes(label)),
    layout.headers)

  // ---- requirements 2-4: verify against the SERVER ----------------------
  const origin = baseUrl.replace(/\/\?.*$/, '')
  const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
  const source = sources.sources.find(entry => entry.name.startsWith(sourceName))
  if (source === undefined) {
    check('the run data source exists', false)
  } else {
    const query = async sql => {
      const response = await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}/query`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql, limit: 200 }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'query failed')
      return body.result.rows
    }

    check('the table exists on the server', String((await query(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='people'`))[0][0]) === '1')

    // requirement 2: the column fields.
    const columns = await query(`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_COMMENT, EXTRA, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='people' ORDER BY ORDINAL_POSITION`)
    const byName = Object.fromEntries(columns.map(row => [String(row[0]), row]))
    check('the length was applied', String(byName['name']?.[1] ?? '').toLowerCase() === 'varchar(50)', byName['name']?.[1])
    check('the UNSIGNED attribute was applied', /unsigned/i.test(String(byName['id']?.[1] ?? '')), byName['id']?.[1])
    check('the column comment was applied', String(byName['name']?.[4] ?? '') === '姓名', byName['name']?.[4])
    check('the first column is the primary key and auto-increments', String(byName['id']?.[3] ?? '') === 'PRI' && /auto_increment/i.test(String(byName['id']?.[5] ?? '')), [byName['id']?.[3], byName['id']?.[5]])

    // requirement 3: the COMPOSITE index, with its order.
    const stats = await query(`SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX, NON_UNIQUE, INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='people' ORDER BY INDEX_NAME, SEQ_IN_INDEX`)
    const composite = stats.filter(row => String(row[0]) === 'uq_name_group')
    check('the composite index exists as ONE index over two columns',
      composite.length === 2,
      composite.map(row => [row[0], row[1], row[2]]))
    check('the composite index preserves the column order',
      composite.length === 2 && String(composite[0]?.[1] ?? '') === 'name' && String(composite[1]?.[1] ?? '') === 'group_code',
      composite.map(row => row[1]))
    check('the composite index is UNIQUE', composite.length > 0 && String(composite[0]?.[3] ?? '') === '0', composite[0]?.[3])

    // requirement 4: the table options.
    const tables = await query(`SELECT ENGINE, TABLE_COLLATION, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='people'`)
    check('the storage engine was applied', String(tables[0]?.[0] ?? '') === 'MyISAM', tables[0]?.[0])
    check('the table collation was applied', String(tables[0]?.[1] ?? '') === 'utf8mb4_bin', tables[0]?.[1])
    check('the table comment was applied', String(tables[0]?.[2] ?? '') === '人员表', tables[0]?.[2])

    // The composite UNIQUE must be ENFORCED, not merely declared.
    const insert = async sql => {
      const response = await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}/query`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql, allowWrite: true }),
      })
      const body = await response.json()
      return response.ok ? { ok: true } : { ok: false, error: String(body.error ?? '') }
    }
    const first = await insert(`INSERT INTO ${database}.people(name, group_code) VALUES ('a', 'x')`)
    const duplicate = await insert(`INSERT INTO ${database}.people(name, group_code) VALUES ('a', 'x')`)
    check('the composite UNIQUE index is enforced', first.ok && !duplicate.ok, { first, duplicate })
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
