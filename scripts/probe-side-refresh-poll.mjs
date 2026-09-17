import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/*
 * Did the refresh control EVER enter its busy state?
 *
 * A single sample 120ms after the click proves nothing on a fast local server: the
 * request may have completed already. This polls every 20ms for two seconds and
 * records the first non-idle sample, which distinguishes "the state is never set"
 * from "it was set and cleared before the sample".
 *
 * Usage: node scripts/probe-side-refresh-poll.mjs <baseUrl-with-token> <connection> <database>
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9365
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const database = process.argv[4] ?? 'dbm_actions'
const [host, port, user, password] = connection.split(':')
const sourceName = `Side Poll ${process.pid}`

const profile = mkdtempSync(join(tmpdir(), 'dbm-side-poll-'))
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

  // Set up: create the source, connect, expand a database.
  const setup = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(150); } };
    const byIncludes = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(t)) || null;
    const byExact = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === t) || null;
    const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
    const setInput = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const setSelect = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
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
    if (!listed) return { fatal: 'source not listed' };
    click(Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn')).find((b) => ['连接','Connect'].includes(b.textContent.trim())));
    await sleep(3500);
    const dbNode = await waitFor(() => byIncludes('.dbm-side-body .dbm-tree-item', ${JSON.stringify(database)}), 15000);
    if (dbNode) { click(dbNode.querySelector('.dbm-caret-btn') || dbNode); await sleep(1500); }

    // Install an observer that records every state the control passes through.
    const refresh = document.querySelector('[data-dbm-side-refresh]');
    if (!refresh) return { fatal: 'no refresh control' };
    window.__dbmSamples = [];
    const sample = () => {
      const el = document.querySelector('[data-dbm-side-refresh]');
      if (el === null) return;
      window.__dbmSamples.push({
        t: Math.round(performance.now()),
        text: (el.textContent || '').trim(),
        disabled: el.disabled,
        busy: el.getAttribute('aria-busy'),
        spinner: el.querySelector('.dbm-spinner') !== null,
      });
    };
    const timer = setInterval(sample, 10);
    sample();
    // Click, and let it run.
    refresh.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    refresh.click();
    await sleep(3000);
    clearInterval(timer);
    sample();
    return { samples: window.__dbmSamples.length };
  })()`)

  if (setup.fatal !== undefined) {
    console.error(`setup failed: ${setup.fatal}`)
    process.exitCode = 1
  } else {
    const samples = await evaluate('window.__dbmSamples')
    const busy = samples.filter(s => s.disabled === true || s.spinner === true || s.busy === 'true')
    console.log(`samples: ${samples.length}, busy samples: ${busy.length}`)
    console.log('first 5:', JSON.stringify(samples.slice(0, 5)))
    if (busy.length > 0) {
      console.log('busy sample:', JSON.stringify(busy[0]))
      console.log('last 3:', JSON.stringify(samples.slice(-3)))
      console.log('\nVERDICT: the control DOES show a busy state.')
    } else {
      console.log('distinct texts seen:', JSON.stringify([...new Set(samples.map(s => s.text))]))
      console.log('\nVERDICT: the control never entered a busy state.')
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
