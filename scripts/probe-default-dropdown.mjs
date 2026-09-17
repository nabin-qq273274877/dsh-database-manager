import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/**
 * The 默认值 dropdown: does each state produce what it says, on the SERVER?
 *
 * The four states exist because they are four different things, and the difference is only
 * visible in the stored default — so every case is verified by reading the column back from
 * the engine, not by trusting the form:
 *
 *   不设置            → no DEFAULT clause (an omitted insert gives NULL)
 *   自定义 + 留空      → DEFAULT '' (the empty string, which is NOT NULL)
 *   自定义 + abc       → DEFAULT 'abc'
 *   NULL              → DEFAULT NULL (stored, not merely accepted)
 *   CURRENT_TIMESTAMP → DEFAULT CURRENT_TIMESTAMP, only offered for temporal types
 *
 * Usage: node scripts/probe-default-dropdown.mjs <baseUrl-with-token> <host:port:user:password>
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9387
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = connection.split(':')
const sourceName = `Def Dd ${process.pid}`
const database = `dbm_defdd_${process.pid}`

const profile = mkdtempSync(join(tmpdir(), 'dbm-defdd-'))
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
    const setInput = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const setSelect = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const api = async (path, options) => { const r = await fetch(path, options); const b = await r.json().catch(() => null); if (!r.ok) throw new Error(path + ' → ' + r.status); return b; };

    const report = { failures: [], cases: [] };
    const fail = (n, d) => report.failures.push({ name: n, detail: d === undefined ? null : d });

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
    if (!listed) { fail('source not listed', (document.querySelector('.dbm-error')||{}).textContent); return report; }
    const sources = await api('/api/dsh-database/sources');
    const sid = sources.sources.find((s) => s.name === ${JSON.stringify(sourceName)}).id;
    report.sourceId = sid;
    click(Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn')).find((b) => ['连接','Connect'].includes(b.textContent.trim())));
    await sleep(3500);
    await api('/api/dsh-database/sources/' + sid + '/database', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'create', name: ${JSON.stringify(database)} }) });
    await sleep(700);
    const reload = document.querySelector('[data-dbm-side-refresh]');
    if (reload) { click(reload); await sleep(2500); }
    const node = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => (el.textContent || '').includes(${JSON.stringify(database)})), 15000);
    if (!node) { fail('database not in tree'); return report; }
    click(node); await sleep(2500);
    click(await waitFor(() => document.querySelector('[data-dbm-dbop="create-table"]'), 6000));
    const dialog = await waitFor(() => document.querySelector('[data-dbm-newtable-name]'), 6000);
    if (!dialog) { fail('dialog did not open'); return report; }
    const dlg = dialog.closest('.dbm-modal');

    /**
     * Build one table whose single column uses the given default state.
     *
     * The dialog is reopened for each case rather than reused: the form keeps its row state
     * across submissions only in the sense that it is still mounted, and a leftover value
     * from the previous case would make the next assertion meaningless.
     */
    const buildTable = async (tableName, mode, text, columnType, tickNullable) => {
      // Reopen so each case starts from a clean form.
      if (document.querySelector('[data-dbm-newtable-submit]') === null) {
        click(document.querySelector('[data-dbm-dbop="create-table"]'));
        await waitFor(() => document.querySelector('[data-dbm-newtable-name]'), 6000);
      }
      const fresh = document.querySelector('[data-dbm-newtable-name]').closest('.dbm-modal');
      setInput(fresh.querySelector('[data-dbm-newtable-name]'), tableName);
      /*
       * The case runs on a freshly added NON-KEY row, not on row 0.
       *
       * Row 0 starts as the PRIMARY key, and MySQL refuses a default on a key column —
       * "Invalid default value for 'v'", measured. Keeping row 0 as the plain INT key and
       * putting the case on row 1 keeps the test about the DEFAULT rather than about the key
       * restriction, which is a separate rule.
       */
      setInput(fresh.querySelector('[data-dbm-newtable-colname="0"]'), 'id');
      setSelect(fresh.querySelector('[data-dbm-newtable-coltype="0"]'), 'INT');
      await sleep(200);
      click(fresh.querySelector('[data-dbm-newtable-add]'));
      await sleep(400);
      const row = 1;
      setInput(fresh.querySelector('[data-dbm-newtable-colname="' + row + '"]'), 'v');
      setSelect(fresh.querySelector('[data-dbm-newtable-coltype="' + row + '"]'), columnType ?? 'VARCHAR');
      /*
       * The length must now be TYPED, because the form no longer pre-fills it — and only for a
       * type that carries one.
       *
       * This probe used to rely on the new row arriving as VARCHAR with 255 already in the length
       * box. That pre-fill was removed on request ("长度/值新增一个条目时不要默认 255"), and a bare
       * VARCHAR is a MySQL syntax error — so the case failed with "syntax error near 'NOT NULL'"
       * while the panel was behaving correctly. Setting it here is what the user does.
       *
       * The TIMESTAMP case must NOT get one: TIMESTAMP's parentheses hold a fractional-seconds
       * precision, not a width, and 50 is refused with "Too-big precision 50 specified for 'v'.
       * Maximum is 6". The very first run of this fix failed exactly there.
       */
      const lengthBox = fresh.querySelector('[data-dbm-newtable-collength="' + row + '"]');
      if (lengthBox !== null && (columnType ?? 'VARCHAR') === 'VARCHAR') setInput(lengthBox, '50');
      /*
       * 允许空 is TICKED by default, because these cases are about the DEFAULT and not about
       * nullability.
       *
       * A new column now arrives as NOT NULL (that too was asked for), so leaving the box alone
       * would make 不设置 produce "Field 'v' doesn't have a default value" rather than the NULL
       * this probe exists to distinguish from the empty string. Ticking it keeps the two
       * comparable; the false case deliberately leaves it unticked, because the form is
       * expected to refuse 默认值 = NULL on a NOT NULL column.
       */
      if (tickNullable !== false) {
        const nullableBox = fresh.querySelector('[data-dbm-newtable-nullable="' + row + '"]');
        if (nullableBox !== null && !nullableBox.checked) { click(nullableBox); await sleep(300); }
      }
      /*
       * Re-read the mode dropdown AFTER the type change.
       *
       * Changing the type re-renders this cell — the CURRENT_TIMESTAMP option's disabled state
       * depends on the type — so a reference captured before it is stale. Reading it stale made
       * the timestamp case set the mode on an element React had already replaced, and the case
       * then failed with "Invalid default value for 'v'" while the driver was emitting the
       * correct statement all along.
       */
      await sleep(400);
      const modeSelect = await waitFor(() => fresh.querySelector('[data-dbm-newtable-coldefault-mode="' + row + '"]'), 4000);
      if (modeSelect === null) { fail('no default-mode select'); return null; }
      setSelect(modeSelect, mode);
      await sleep(300);
      if (mode === 'custom') {
        const textField = fresh.querySelector('[data-dbm-newtable-coldefault-text="' + row + '"]');
        if (textField === null) { fail('no default text field for custom'); return null; }
        // 'text' may legitimately be '' — that IS the empty-string case.
        setInput(textField, text ?? '');
        await sleep(200);
      }
      click(fresh.querySelector('[data-dbm-newtable-submit]'));
      const closed = await waitFor(() => document.querySelector('[data-dbm-newtable-submit]') === null ? true : null, 15000);
      const error = (document.querySelector('[data-dbm-newtable-error]') || {}).textContent || null;
      // A failed case leaves the dialog open; close it so the next case starts clean.
      if (error !== null) {
        const cancel = document.querySelector('.dbm-modal-foot .dbm-btn');
        if (cancel !== null) click(cancel);
        await sleep(500);
      }
      await sleep(400);
      return { closed: closed === true, error };
    }

    // The dropdown's own shape, first.
    const modeSelect = dlg.querySelector('[data-dbm-newtable-coldefault-mode="0"]');
    report.dropdown = modeSelect === null ? null : {
      tag: modeSelect.tagName,
      options: Array.from(modeSelect.options).map((o) => ({ value: o.value, disabled: o.disabled })),
    }
    // On a VARCHAR the CURRENT_TIMESTAMP option must be disabled.
    report.currentTimestampDisabledOnVarchar = modeSelect === null ? null
      : Array.from(modeSelect.options).find((o) => o.value === 'currentTimestamp')?.disabled === true;

    // Case 1: 不设置.
    report.caseNone = await buildTable('t_none', 'none');
    // Case 2: 自定义 + 留空 → the empty string.
    report.caseEmpty = await buildTable('t_empty', 'custom', '');
    // Case 3: 自定义 + abc.
    report.caseText = await buildTable('t_text', 'custom', 'abc');
    // Case 4: NULL, with 允许空 ticked (which MySQL requires — see the case below).
    report.caseNull = await buildTable('t_null', 'null');
    // Case 5: CURRENT_TIMESTAMP on a TIMESTAMP column.
    report.caseTimestamp = await buildTable('t_ts', 'currentTimestamp', undefined, 'TIMESTAMP');
    /*
     * Case 6: 默认值 = NULL with 允许空 UNTICKED, which must be refused BY THE FORM.
     *
     * A new column arrives as NOT NULL now, so this combination became easy to reach. MySQL
     * answers NOT NULL DEFAULT NULL with "Invalid default value for 'v'", naming neither of the
     * two fields that contradict each other — so the form is expected to answer first, naming both.
     */
    report.caseNullNotNull = await buildTable('t_null_nn', 'null', undefined, 'VARCHAR', false);

    return report;
  })()`)

  for (const failure of flow.failures ?? []) check(`flow: ${failure.name}`, false, failure.detail)
  console.log(JSON.stringify({ dropdown: flow.dropdown, cases: {
    none: flow.caseNone, empty: flow.caseEmpty, text: flow.caseText, null: flow.caseNull,
    timestamp: flow.caseTimestamp, nullNotNull: flow.caseNullNotNull,
  } }, null, 2))

  // ---- verify every case against the SERVER ----------------------------
  const origin = baseUrl.replace(/\/\?.*$/, '')
  const source = flow.sourceId
  const query = async sql => {
    const response = await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source)}/query`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql, limit: 50 }),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? 'query failed')
    return body.result.rows
  }
  /*
   * Read the DEFAULT of the 'v' column specifically.
   *
   * Querying without a column filter returned the FIRST column's row, which is 'id' — so every
   * case reported null and looked like the default had not been applied while the form was
   * fine. The column under test has to be named.
   */
  const defaultsOf = async table => {
    const rows = await query(`SELECT COLUMN_DEFAULT, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='${table}' AND COLUMN_NAME='v'`)
    return rows[0] === undefined ? null : { value: rows[0][0], nullable: rows[0][1] }
  }

  const dropdown = flow.dropdown ?? {}
  check('默认值 is a dropdown', dropdown.tag === 'SELECT', dropdown)
  check('it offers the four states', (dropdown.options ?? []).length === 4, dropdown.options?.map(option => option.value))
  check('CURRENT_TIMESTAMP is disabled on a non-temporal type', flow.currentTimestampDisabledOnVarchar === true, { disabled: flow.currentTimestampDisabledOnVarchar })

  const none = await defaultsOf('t_none')
  check('不设置 produces NO default', none !== null && none.value === null, none)
  const empty = await defaultsOf('t_empty')
  check("自定义 + 留空 produces the empty string, not NULL", empty !== null && empty.value === '', empty)
  const text = await defaultsOf('t_text')
  check('自定义 + abc produces abc', text !== null && text.value === 'abc', text)
  const nullCase = await defaultsOf('t_null')
  check('NULL produces a NULL default', nullCase !== null && nullCase.value === null, nullCase)
  const timestamp = await defaultsOf('t_ts')
  check('CURRENT_TIMESTAMP produces CURRENT_TIMESTAMP on a TIMESTAMP column', timestamp !== null && String(timestamp.value).toUpperCase().includes('CURRENT_TIMESTAMP'), timestamp)

  // The distinction that mattered: 不设置 and 自定义+留空 must differ in the INSERT result.
  const insertAndRead = async table => {
    const response = await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source)}/query`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql: `INSERT INTO ${database}.${table} () VALUES ()`, allowWrite: true }),
    })
    if (!response.ok) return { error: (await response.json()).error }
    const rows = await query(`SELECT v, v IS NULL AS is_null FROM ${database}.${table}`)
    return rows[0] === undefined ? null : { value: rows[0][0], isNull: rows[0][1] }
  }
  const noneInsert = await insertAndRead('t_none')
  const emptyInsert = await insertAndRead('t_empty')
  check('an omitted column with no default inserts NULL', String(noneInsert?.isNull) === '1', noneInsert)
  check('an omitted column with DEFAULT \'\' inserts the empty string', String(emptyInsert?.isNull) === '0' && emptyInsert?.value === '', emptyInsert)

  /*
   * 默认值 = NULL on a NOT NULL column must be refused by the FORM, naming both fields.
   *
   * MySQL's own answer is "Invalid default value for 'v'", which points at the default and says
   * nothing about 允许空 — so the assertion is that the dialog stayed open with a message that
   * mentions the nullability, not that the server complained.
   */
  const nullNotNull = flow.caseNullNotNull ?? {}
  check('默认值 = NULL on a NOT NULL column is refused', nullNotNull.closed === false && typeof nullNotNull.error === 'string' && nullNotNull.error.length > 0, nullNotNull)
  check('the refusal names 允许空 (the field to change), not just the default',
    typeof nullNotNull.error === 'string' && nullNotNull.error.includes('允许空'), nullNotNull.error)
} finally {
  try {
    const origin = baseUrl.replace(/\/\?.*$/, '')
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name.startsWith('Def Dd '))) {
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}/database`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'drop', name: database }),
      }).catch(() => {})
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' })
      console.error(`note: removed ${source.id}`)
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
