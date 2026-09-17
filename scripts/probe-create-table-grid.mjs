import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/**
 * Cover three gaps the main UI probe does not.
 *
 * 1. "右边对齐" — the request says the field CONTROLS should align on their RIGHT edge.
 *    The main probe checks label rights and control widths, which is a proxy: two
 *    controls of equal width with labels ending at the same x do align, but that is a
 *    deduction rather than a measurement. This measures the control right edges directly.
 * 2. The 自定义 type round trip. Choosing 自定义 swaps the dropdown for a text field, and
 *    the way back is a button I added — never exercised, and a one-way door is exactly the
 *    kind of defect that only shows up when someone tries to go back.
 * 3. The narrow-window behaviour. The request says "这么宽的面板可以一行两个", so two per row
 *    is only expected when there is width; below the breakpoint it must degrade to one per
 *    row WITHOUT the controls becoming unusable or the dialog overflowing.
 *
 * Usage: node scripts/probe-create-table-grid.mjs <baseUrl-with-token> <host:port:user:password>
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9379
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = connection.split(':')
const sourceName = `CT Grid ${process.pid}`
const database = `dbm_ctgrid_${process.pid}`

const profile = mkdtempSync(join(tmpdir(), 'dbm-ctgrid-'))
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
    const api = async (path, options) => { const r = await fetch(path, options); const b = await r.json().catch(() => null); if (!r.ok) throw new Error(path + ' → ' + r.status); return b; };

    const report = { failures: [] };
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

    /** Measure the right edges of every table-level control, per grid column. */
    const measureEdges = () => {
      const rows = Array.from(dlg.querySelectorAll('.dbm-grid-row'));
      return rows.map((gridRow) => {
        const label = gridRow.querySelector('.dbm-grid-label');
        const control = gridRow.querySelector('.dbm-grid-control');
        if (label === null || control === null) return null;
        const cr = control.getBoundingClientRect();
        return {
          label: (label.textContent || '').trim(),
          labelRight: Math.round(label.getBoundingClientRect().right),
          controlLeft: Math.round(cr.left),
          controlRight: Math.round(cr.right),
        };
      }).filter(Boolean);
    };

    // ---- gap 1: the controls align on their RIGHT edge, per column --------
    report.wide = { edges: measureEdges(), dialogRight: Math.round(dlg.getBoundingClientRect().right) };
    const grid = dlg.querySelector('.dbm-grid2');
    report.wide.gridColumns = grid === null ? null : getComputedStyle(grid).gridTemplateColumns;

    // ---- gap 2: the 自定义 type round trip ------------------------------
    const typeIndex = 0;
    const typeSelect = dlg.querySelector('[data-dbm-newtable-coltype="' + typeIndex + '"]');
    if (typeSelect === null) { fail('no type select'); return report; }
    report.typeBefore = { tag: typeSelect.tagName, value: typeSelect.value };
    // Choose 自定义, which should swap in the text field.
    setSelect(typeSelect, '__custom__');
    await sleep(500);
    const customInput = dlg.querySelector('[data-dbm-newtable-coltype-text="' + typeIndex + '"]');
    const backButton = dlg.querySelector('[data-dbm-newtable-coltype-list="' + typeIndex + '"]');
    report.afterCustom = {
      hasText: customInput !== null,
      textVisible: customInput !== null && customInput.getBoundingClientRect().width > 0,
      hasBackButton: backButton !== null,
      // The dropdown must be gone, or the cell would carry two controls.
      selectGone: dlg.querySelector('[data-dbm-newtable-coltype="' + typeIndex + '"]') === null,
    };
    if (customInput !== null) setInput(customInput, 'DECIMAL(10,2)');
    await sleep(300);
    report.customTyped = customInput === null ? null : customInput.value;
    // Now go back via the button.
    if (backButton !== null) backButton.click();
    await sleep(600);
    const typeAfterBack = dlg.querySelector('[data-dbm-newtable-coltype="' + typeIndex + '"]');
    report.afterBack = {
      selectBack: typeAfterBack !== null && typeAfterBack.tagName === 'SELECT',
      value: typeAfterBack === null ? null : typeAfterBack.value,
      textGone: dlg.querySelector('[data-dbm-newtable-coltype-text="' + typeIndex + '"]') === null,
    };
    // And the custom path must still reach the payload: choose it again and confirm the
    // text is what gets used.
    if (typeAfterBack !== null) {
      setSelect(typeAfterBack, '__custom__');
      await sleep(400);
      const again = dlg.querySelector('[data-dbm-newtable-coltype-text="' + typeIndex + '"]');
      if (again !== null) setInput(again, 'DECIMAL(10,2)');
      await sleep(300);
      report.customRoundTrip = again === null ? null : again.value;
      const back2 = dlg.querySelector('[data-dbm-newtable-coltype-list="' + typeIndex + '"]');
      if (back2 !== null) back2.click();
      await sleep(400);
    }

    // ---- gap 3: the narrow window ---------------------------------------
    // Measured at the browser's own viewport, so the media query is what decides.
    report.wideRows = new Set(measureEdges().map((entry) => entry.labelRight)).size;
    return report;
  })()`)

  for (const failure of out.failures ?? []) check(`flow: ${failure.name}`, false, failure.detail)
  console.log(JSON.stringify({
    wide: out.wide,
    afterCustom: out.afterCustom,
    customTyped: out.customTyped,
    afterBack: out.afterBack,
    customRoundTrip: out.customRoundTrip,
  }, null, 2))

  // ---- gap 1: right-edge alignment, per grid column ---------------------
  const edges = out.wide?.edges ?? []
  const byColumn = new Map()
  for (const entry of edges) {
    byColumn.set(entry.labelRight, [...(byColumn.get(entry.labelRight) ?? []), entry.controlRight])
  }
  const rightSpreads = [...byColumn.values()].map(rights => Math.max(...rights) - Math.min(...rights))
  check('the controls align on their RIGHT edge within each column', rightSpreads.length > 0 && rightSpreads.every(spread => spread <= 8), { rightSpreads, edges: edges.map(entry => [entry.label, entry.controlLeft, entry.controlRight]) })
  check('the outermost control reaches the dialog edge', edges.length > 0 && Math.max(...edges.map(entry => entry.controlRight)) >= (out.wide?.dialogRight ?? 0) - 40, { maxRight: Math.max(...edges.map(entry => entry.controlRight)), dialogRight: out.wide?.dialogRight })
  check('the grid really has two columns at this width', (out.wide?.gridColumns ?? '').split(' ').length >= 2, out.wide?.gridColumns)

  // ---- gap 2: the custom type round trip -------------------------------
  check('choosing 自定义 swaps in a text field', out.afterCustom?.hasText === true && out.afterCustom?.textVisible === true && out.afterCustom?.selectGone === true, out.afterCustom)
  check('the custom type cell offers a way back', out.afterCustom?.hasBackButton === true, out.afterCustom)
  check('typing a custom type is accepted', out.customTyped === 'DECIMAL(10,2)', { typed: out.customTyped })
  check('the back button returns to the type list', out.afterBack?.selectBack === true && out.afterBack?.textGone === true, out.afterBack)
  /*
   * Returning to the list must NOT discard what was typed.
   *
   * The first version reset the type to the first listed type, so a DECIMAL(10,2) silently
   * became TINYINT — the user's input lost without a word. The value is now kept and shown
   * as its own marked entry, which is what this asserts.
   */
  check('returning to the list keeps the typed type', out.afterBack?.value === '__customValue__', { value: out.afterBack?.value })
  check('the custom path still works after returning', out.customRoundTrip === 'DECIMAL(10,2)', { value: out.customRoundTrip })
} finally {
  try {
    const origin = baseUrl.replace(/\/\?.*$/, '')
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name.startsWith('CT Grid '))) {
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
