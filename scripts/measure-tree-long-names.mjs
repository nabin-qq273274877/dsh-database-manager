import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/*
 * Measure the tree with LONG names, the case where the count is most at risk.
 *
 * The fix makes the name shrink and the count never shrink, so the property to
 * verify is: with a name too long for the sidebar, the count is still complete and
 * the NAME shows the ellipsis. Measuring only short names would pass for a layout
 * that still lets a long name push the count out.
 *
 * Usage: node scripts/measure-tree-long-names.mjs <baseUrl-with-token> <host:port:user:password> <database>
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9359
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const database = process.argv[4] ?? 'dbm_tree'
const [host, port, user, password] = connection.split(':')
const sourceName = `Long Names ${process.pid}`

const profile = mkdtempSync(join(tmpdir(), 'dbm-long-'))
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

  const report = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(150); } };
    const byIncludes = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(t)) || null;
    const byExact = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === t) || null;
    const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
    const setInput = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const setSelect = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };

    const row = Array.from(document.querySelectorAll('nav button[aria-label]')).find((b) => ['数据库管理','Database'].includes((b.getAttribute('aria-label')||'').trim()));
    click(row);
    await sleep(1800);
    click(await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000));
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    const kindSelect = modal.querySelector('select.dbm-select');
    if (kindSelect) setSelect(kindSelect, 'mysql');
    await sleep(400);
    const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
    setInput(inputs[0], ${JSON.stringify(sourceName)});
    const hostInput = inputs.find((i) => (i.getAttribute('placeholder') || '').includes('127.0.0.1'));
    const userInput = inputs.find((i) => (i.getAttribute('placeholder') || '').includes('root'));
    if (hostInput) setInput(hostInput, ${JSON.stringify(host)});
    if (userInput) setInput(userInput, ${JSON.stringify(user)});
    const pw = modal.querySelector('input[type=password]');
    if (pw) setInput(pw, ${JSON.stringify(password)});
    await sleep(300);
    click(byExact('.dbm-modal-foot .dbm-btn', '保存') || byExact('.dbm-modal-foot .dbm-btn', 'Save'));

    const listed = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(sourceName)}), 10000);
    if (!listed) return { fatal: 'source not listed', error: (document.querySelector('.dbm-error')||{}).textContent };
    click(Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn')).find((b) => ['连接','Connect'].includes(b.textContent.trim())));
    await sleep(3500);

    const dbNode = await waitFor(() => byIncludes('.dbm-side-body .dbm-tree-item', ${JSON.stringify(database)}), 15000);
    if (!dbNode) return { fatal: 'no database node' };
    click(dbNode.querySelector('.dbm-caret-btn') || dbNode);
    await sleep(2500);

    const sideBody = document.querySelector('.dbm-side-body');
    const bodyRect = sideBody.getBoundingClientRect();
    const visibleRight = Math.round(bodyRect.left + sideBody.clientWidth);

    // Table rows only: the database row is measured by the other script.
    const rows = Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item'))
      .map((el) => {
        const nameEl = el.querySelector('.dbm-tree-name');
        if (nameEl === null) return null;
        const name = nameEl.textContent.trim();
        const nameRect = nameEl.getBoundingClientRect();
        const rowRect = el.getBoundingClientRect();
        return {
          name,
          nameWidth: Math.round(nameRect.width),
          nameScrollWidth: nameEl.scrollWidth,
          truncated: nameEl.scrollWidth > nameEl.clientWidth + 1,
          rowRight: Math.round(rowRect.right),
        };
      })
      .filter(Boolean);

    return {
      bodyClientWidth: sideBody.clientWidth,
      bodyScrollWidth: sideBody.scrollWidth,
      overflows: sideBody.scrollWidth > sideBody.clientWidth,
      visibleRight,
      rows,
      longRow: rows.find((r) => r.name.length > 30) || null,
    };
  })()`)

  console.log(JSON.stringify(report, null, 2))
  if (report.fatal !== undefined) {
    console.error(`\nfatal: ${report.fatal}`)
    process.exitCode = 1
  } else {
    console.log(`\ntree body: client ${report.bodyClientWidth} / scroll ${report.bodyScrollWidth} (overflows: ${report.overflows})`)
    const long = report.longRow
    if (long === null) {
      console.error('no long table name rendered, so the truncation case was not measured')
      process.exitCode = 1
    } else {
      console.log(`  long name "${long.name}": width ${long.nameWidth}, content ${long.nameScrollWidth}, truncated: ${long.truncated}`)
      if (!long.truncated) {
        console.error('the long name was not truncated, so it may still push the count out')
        process.exitCode = 1
      }
    }
    if (report.overflows) process.exitCode = 1
  }
} finally {
  try {
    const origin = baseUrl.replace(/\/\?.*$/, '')
    const s = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const src of s.sources.filter(e => e.name === sourceName)) {
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(src.id)}`, { method: 'DELETE' })
      console.error(`note: removed ${src.id}`)
    }
  } catch { /* best effort */ }
  try { socket?.close() } catch { /* gone */ }
  child.kill()
  await wait(1000)
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}
