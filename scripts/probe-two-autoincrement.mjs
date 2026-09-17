import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/**
 * Reproduce: the form lets TWO columns be marked 自增.
 *
 * The driver refuses it — that was fixed — but the report is about the FORM, so the
 * question is whether the UI prevents the second tick or only complains at submit time.
 * Those are different experiences: an error at submit means the user fills in the whole
 * form before learning about a rule that could have been enforced at the tick.
 *
 * Recorded per row, after ticking the first: whether the second row's checkbox is still
 * clickable, whether it actually became ticked, and whether any text explains the limit.
 *
 * Usage: node scripts/probe-two-autoincrement.mjs <baseUrl-with-token> <host:port:user:password>
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9385
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = connection.split(':')
const sourceName = `Two Auto ${process.pid}`
const database = `dbm_twoauto_${process.pid}`

const profile = mkdtempSync(join(tmpdir(), 'dbm-twoauto-'))
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

    /** The state of one row's 自增 control, plus anything explaining it. */
    const autoState = (index) => {
      const box = dlg.querySelector('[data-dbm-newtable-auto="' + index + '"]');
      if (box === null) return { index, present: false };
      const hint = dlg.querySelector('[data-dbm-newtable-auto-hint="' + index + '"]');
      return {
        index,
        present: true,
        disabled: box.disabled,
        checked: box.checked,
        visibleHint: hint ? (hint.textContent || '').trim() : null,
      };
    };

    setInput(dlg.querySelector('[data-dbm-newtable-name]'), 'two_auto');
    // Row 1 is the default id INT PRIMARY auto row. Make it INT (numeric) and add a second
    // numeric PRIMARY-capable row, then try to tick both.
    click(dlg.querySelector('[data-dbm-newtable-add]'));
    await sleep(400);
    const names = Array.from(dlg.querySelectorAll('[data-dbm-newtable-colname]'));
    const types = Array.from(dlg.querySelectorAll('[data-dbm-newtable-coltype]'));
    setInput(names[0], 'id');
    setSelect(types[0], 'INT');
    setInput(names[1], 'seq');
    setSelect(types[1], 'INT');
    await sleep(300);
    report.rows = dlg.querySelectorAll('[data-dbm-newtable-colname]').length;

    // Row 1 is auto+primary by default; mark row 2 as primary too so its 自增 becomes
    // AVAILABLE — which is the case the report is about.
    const index2 = dlg.querySelector('[data-dbm-newtable-index="1"]');
    if (index2 !== null) setSelect(index2, 'primary');
    await sleep(400);
    report.beforeSecondTick = { row0: autoState(0), row1: autoState(1) };

    // Now tick the second one.
    const second = dlg.querySelector('[data-dbm-newtable-auto="1"]');
    if (second === null) { fail('no second auto control'); return report; }
    report.secondDisabledBefore = second.disabled;
    if (!second.disabled) second.click();
    await sleep(400);
    report.afterSecondTick = { row0: autoState(0), row1: autoState(1) };

    // Any text anywhere in the dialog about the one-auto limit?
    const dialogText = (dlg.textContent || '').replace(/\\s+/g, ' ');
    report.mentionsLimit = /只能有一个自增|one auto|只有一个自增|已由/.test(dialogText);
    report.limitHintTexts = Array.from(dlg.querySelectorAll('[data-dbm-newtable-auto-hint]')).map((el) => (el.textContent || '').trim());

    // Submit and see what the form says.
    click(dlg.querySelector('[data-dbm-newtable-submit]'));
    await sleep(2500);
    report.dialogError = (document.querySelector('[data-dbm-newtable-error]') || {}).textContent || null;
    report.stillOpen = document.querySelector('[data-dbm-newtable-submit]') !== null;
    return report;
  })()`)

  console.log(JSON.stringify(out, null, 2))

  const before = out.beforeSecondTick ?? {}
  const after = out.afterSecondTick ?? {}
  console.log('\n--- 结论 ---')
  console.log(`添加第二行后、勾选前：row0 auto=${before.row0?.checked} row1 checkbox disabled=${before.row1?.disabled}`)
  console.log(`勾选第二个后：        row0=${after.row0?.checked} row1=${after.row1?.checked}`)
  console.log(`第二个复选框勾选前是否可点: ${out.secondDisabledBefore === false ? '可点（问题存在）' : '被禁用'}`)
  console.log(`对话框里是否说明了"只能一个自增": ${out.mentionsLimit}`)
  console.log(`自增单元格的可见提示: ${JSON.stringify(out.limitHintTexts)}`)
  console.log(`提交后提示: ${JSON.stringify(out.dialogError)}`)
} finally {
  try {
    const origin = baseUrl.replace(/\/\?.*$/, '')
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name.startsWith('Two Auto '))) {
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
