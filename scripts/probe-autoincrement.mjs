import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/**
 * Reproduce the reported 自增 problem before changing anything.
 *
 * Reported: after deleting the default (first) column, 自增 can no longer be ticked, and
 * nothing says why. The rule is "an auto-increment column must be part of the PRIMARY
 * key", and 'attributeAvailable'-style gating DISABLES the checkbox when that is not
 * met — so the likely shape is a disabled control whose only explanation is a 'title',
 * which a user does not see unless they hover. That is a guess until measured, so this
 * records:
 *
 *   - the 自增 checkbox's 'disabled' state after each step;
 *   - whether ANY text in the dialog explains why;
 *   - the 'title' attribute, which is the only place the reason may live.
 *
 * Usage: node scripts/probe-autoincrement.mjs <baseUrl-with-token> <host:port:user:password>
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9375
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = connection.split(':')
const sourceName = `AutoInc ${process.pid}`
/**
 * The database this run creates, defined OUT here and injected below.
 *
 * Writing it inside the page script meant nesting a template literal inside one, and every
 * attempt at that produced a syntax error in the probe itself — the outer backticks and
 * the inner ones cannot both be escaped cleanly in this shape.
 */
const database = `dbm_auto_${process.pid}`

const profile = mkdtempSync(join(tmpdir(), 'dbm-auto-'))
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
    const api = async (path, options) => { const r = await fetch(path, options); const b = await r.json().catch(() => null); if (!r.ok) throw new Error(path + ' → ' + r.status); return b; };

    const report = { steps: [], failures: [] };
    const step = (name, detail) => report.steps.push({ name, detail: detail === undefined ? null : detail });
    const fail = (name, detail) => report.failures.push({ name, detail: detail === undefined ? null : detail });

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

    const database = ${JSON.stringify(database)};
    await api('/api/dsh-database/sources/' + sid + '/database', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'create', name: database }) });
    await sleep(700);
    const reload = document.querySelector('[data-dbm-side-refresh]');
    if (reload) { click(reload); await sleep(2500); }
    const node = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => (el.textContent || '').includes(database)), 15000);
    if (!node) { fail('database not in tree'); return report; }
    click(node); await sleep(2500);
    click(await waitFor(() => document.querySelector('[data-dbm-dbop="create-table"]'), 6000));
    const dialog = await waitFor(() => document.querySelector('[data-dbm-newtable-name]'), 6000);
    if (!dialog) { fail('new-table dialog did not open'); return report; }
    const dlg = dialog.closest('.dbm-modal');

    /** The auto checkbox of a row, plus everything the user can see about it. */
    const autoState = (index) => {
      const box = dlg.querySelector('[data-dbm-newtable-auto="' + index + '"]');
      if (box === null) return { index, present: false };
      const label = box.closest('label');
      /*
       * The VISIBLE hint, which is the point of the report.
       *
       * The old implementation explained itself only through a title attribute, which a
       * user sees only by hovering — and a disabled input does not reliably show one at
       * all. The check therefore reads the rendered hint element, not the tooltip: a
       * control that cannot be ticked must say why in text.
       */
      const hint = dlg.querySelector('[data-dbm-newtable-auto-hint="' + index + '"]');
      return {
        index,
        present: true,
        disabled: box.disabled,
        checked: box.checked,
        title: box.getAttribute('title'),
        // The text beside the control, which is what a user actually reads.
        visibleHint: hint ? (hint.textContent || '').trim() : null,
        labelText: label ? (label.textContent || '').trim() : null,
      };
    };

    // Step 1: the default single row (id INTEGER/INT primary, auto ticked).
    report.rowCount1 = dlg.querySelectorAll('[data-dbm-newtable-colname]').length;
    step('initial state', { auto: autoState(0), indexKind: dlg.querySelector('[data-dbm-newtable-index="0"]') ? dlg.querySelector('[data-dbm-newtable-index="0"]').value : null });

    // Step 2: delete that default row — the report says this is where it breaks.
    const remove = dlg.querySelector('[data-dbm-newtable-remove="0"]');
    if (remove === null) { fail('no remove button on the default row'); return report; }
    // A single row cannot be removed (the button is disabled); add one first, then
    // delete the FIRST row, which is the reported sequence.
    click(dlg.querySelector('[data-dbm-newtable-add]'));
    await sleep(400);
    report.afterAdd = { rows: dlg.querySelectorAll('[data-dbm-newtable-colname]').length, auto: autoState(1) };
    const removeFirst = dlg.querySelector('[data-dbm-newtable-remove="0"]');
    click(removeFirst);
    await sleep(400);
    report.afterDelete = { rows: dlg.querySelectorAll('[data-dbm-newtable-colname]').length, auto: autoState(0) };
    step('after deleting the default row', report.afterDelete);

    // Step 3: can a user make the remaining column auto-increment at all? Try setting it
    // as PRIMARY first, which is the documented requirement.
    const indexSelect = dlg.querySelector('[data-dbm-newtable-index="0"]');
    report.indexOptions = indexSelect ? Array.from(indexSelect.options).map((o) => ({ value: o.value, disabled: o.disabled })) : null;
    if (indexSelect) { setSelect(indexSelect, 'primary'); await sleep(400); }
    report.afterPrimary = autoState(0);
    step('after marking the remaining column as PRIMARY', report.afterPrimary);

    // Step 4: the same for a freshly added row that is NOT a key.
    click(dlg.querySelector('[data-dbm-newtable-add]'));
    await sleep(400);
    report.newRowNotKey = autoState(1);

    return report;
  })()`)

  console.log(JSON.stringify(out, null, 2))
} finally {
  try {
    const origin = baseUrl.replace(/\/\?.*$/, '')
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name.startsWith(sourceName))) {
      const schemas = await (await fetch(`${origin}/api/dsh-database/sources/${source.id}/schemas`)).json().catch(() => ({ schemas: [] }))
      for (const schema of schemas.schemas ?? []) {
        if (schema.name.startsWith('dbm_auto_')) {
          await fetch(`${origin}/api/dsh-database/sources/${source.id}/database`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'drop', name: schema.name }),
          }).catch(() => {})
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
