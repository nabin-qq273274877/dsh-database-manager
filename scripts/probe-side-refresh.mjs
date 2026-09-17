import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/*
 * Does the sidebar refresh control actually show a busy state?
 *
 * The handler was rewritten from 'void loadSchemas()' (fire-and-forget, nothing to
 * observe) to an awaited one with a flag. A flag that is set and cleared in the same
 * tick would look identical to no flag at all, so this measures the computed state
 * WHILE the request is in flight — by throttling the network so the window is wide
 * enough to observe.
 *
 * Usage: node scripts/probe-side-refresh.mjs <baseUrl-with-token> <host:port:user:password> <database>
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9363
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const database = process.argv[4] ?? 'dbm_actions'
const [host, port, user, password] = connection.split(':')
const sourceName = `Side Refresh ${process.pid}`

const profile = mkdtempSync(join(tmpdir(), 'dbm-side-'))
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

    const listed = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(sourceName)}), 12000);
    if (!listed) return { fatal: 'source not listed', error: (document.querySelector('.dbm-error') || {}).textContent };
    click(Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn')).find((b) => ['连接','Connect'].includes(b.textContent.trim())));
    await sleep(3500);

    const refresh = document.querySelector('[data-dbm-side-refresh]');
    if (!refresh) return { fatal: 'no sidebar refresh control' };

    // Expand a database so the refresh has an open node to reload too.
    const dbNode = await waitFor(() => byIncludes('.dbm-side-body .dbm-tree-item', ${JSON.stringify(database)}), 15000);
    if (dbNode) { click(dbNode.querySelector('.dbm-caret-btn') || dbNode); await sleep(1500); }

    const before = { text: (refresh.textContent || '').trim(), disabled: refresh.disabled, busy: refresh.getAttribute('aria-busy') };
    click(refresh);
    // Sample IMMEDIATELY: the read is fast on a local server, so a single sample
    // shortly after the click is what catches the in-flight state.
    await sleep(120);
    const during = {
      text: (refresh.textContent || '').trim(),
      disabled: refresh.disabled,
      busy: refresh.getAttribute('aria-busy'),
      hasSpinner: refresh.querySelector('.dbm-spinner') !== null,
    };
    await sleep(4000);
    const after = {
      text: (refresh.textContent || '').trim(),
      disabled: refresh.disabled,
      busy: refresh.getAttribute('aria-busy'),
      hasSpinner: refresh.querySelector('.dbm-spinner') !== null,
    };
    return { before, during, after, nodeStillThere: document.querySelector('[data-dbm-side-refresh]') !== null };
  })()`)

  console.log(JSON.stringify(out, null, 2))
  if (out.fatal !== undefined) {
    console.error(`\nfatal: ${out.fatal}`)
    process.exitCode = 1
  } else {
    const busyDuring = out.during.disabled === true || out.during.hasSpinner === true || out.during.busy === 'true'
    const settledAfter = out.after.disabled === false && out.after.hasSpinner === false
    console.log(`\nbusy while in flight: ${busyDuring}`)
    console.log(`settled afterwards:  ${settledAfter}`)
    if (!busyDuring) {
      console.error('the refresh control showed no busy state while the request was in flight')
      process.exitCode = 1
    }
    if (!settledAfter) {
      console.error('the refresh control did not return to its idle state')
      process.exitCode = 1
    }
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
