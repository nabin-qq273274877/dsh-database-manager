/**
 * Dev aid: verify the data-source dialog in a real browser.
 *
 * Checks the four things a screenshot would not settle: the footer layout (test
 * on the left, cancel/save on the right), that the timeout field no longer
 * wraps, that the TLS hint is present, and that 测试连接 actually reports a
 * result — proven by pointing it at a real SQLite file and at a dead port.
 *
 * Usage: node scripts/probe-dialog.mjs <baseUrl-with-token> <sqliteFile>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9340
const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/probe-dialog.mjs <baseUrl-with-token> <sqliteFile>')
  process.exit(2)
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw))
      const settle = this.pending.get(msg.id)
      if (settle !== undefined) { this.pending.delete(msg.id); settle(msg) }
    })
  }
  ready() { return new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej) }) }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve) => { this.pending.set(id, resolve); this.ws.send(JSON.stringify({ id, method, params })) })
  }
  async evaluate(expression) {
    const reply = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (reply.result?.exceptionDetails !== undefined) {
      throw new Error(String(reply.result.exceptionDetails.exception?.description ?? JSON.stringify(reply.result.exceptionDetails)))
    }
    return reply.result?.result?.value
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  close() { this.ws.close() }
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try { const r = await fetch(url); if (r.ok) return await r.json() } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error(`timed out: ${url}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

const PRELUDE = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byText = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent||'').trim() === text) || null;
const waitFor = async (fn, ms) => { const end = Date.now()+ms; for(;;){ const v = fn(); if(v) return v; if(Date.now()>end) return null; await sleep(120) } };
const setInput = (el, v) => { const proto = el.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})) };
`

const dir = mkdtempSync(join(tmpdir(), 'dsh-dialog-'))
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,900', baseUrl,
], { stdio: 'ignore' })

let cdp
try {
  await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`, 30000)
  let target
  const deadline = Date.now() + 30000
  for (;;) {
    const list = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`, 10000)
    target = list.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string')
    if (target !== undefined) break
    if (Date.now() > deadline) throw new Error('no page target')
    await new Promise((r) => setTimeout(r, 300))
  }
  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.ready()
  await cdp.send('Runtime.enable')

  const boot = Date.now() + 90000
  for (;;) {
    if (await cdp.evaluate(`!!document.querySelector('nav button[aria-label]')`) === true) break
    if (Date.now() > boot) throw new Error('the app never booted')
    await new Promise((r) => setTimeout(r, 1000))
  }

  const rowPoint = await cdp.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((x) => ['数据库管理','Database'].includes((x.getAttribute('aria-label')||'').trim()));
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) };
  })()`)
  await cdp.click(rowPoint.x, rowPoint.y)
  await new Promise((r) => setTimeout(r, 1200))

  const newBtn = await cdp.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('.dbm-btn'))
      .find((x) => /新增数据库|New database/.test(x.textContent||''));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) };
  })()`)
  if (newBtn === null) throw new Error('no New database button')
  await cdp.click(newBtn.x, newBtn.y)
  await new Promise((r) => setTimeout(r, 900))

  // Baseline: the SQLite dialog's layout.
  const layout = await cdp.evaluate(`(async () => {
    ${PRELUDE}
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    if (!modal) return JSON.stringify({ fatal: 'dialog did not open' });
    const nameInput = Array.from(modal.querySelectorAll('input.dbm-input'))[0];
    setInput(nameInput, 'Dialog Check');
    const fileInput = Array.from(modal.querySelectorAll('input.dbm-input'))
      .find((i) => /D:\\/data|data\\/app/.test(i.getAttribute('placeholder')||''));
    if (fileInput) setInput(fileInput, ${JSON.stringify(sqliteFile)});
    await sleep(250);

    const rect = (el) => { if(!el) return null; const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };

    const foot = modal.querySelector('.dbm-modal-foot, .dbm-modal-foot-split');
    const left = modal.querySelector('.dbm-modal-foot-left');
    const right = modal.querySelector('.dbm-modal-foot-right');
    const testBtn = Array.from(modal.querySelectorAll('button')).find((b) => /测试连接|Test connection/.test(b.textContent||''));
    const cancelBtn = Array.from(modal.querySelectorAll('button')).find((b) => /取消|Cancel/.test((b.textContent||'').trim()));
    const saveBtn = Array.from(modal.querySelectorAll('button')).find((b) => /保存|Save/.test((b.textContent||'').trim()));
    const tlsCheck = Array.from(modal.querySelectorAll('label.dbm-check')).find((l) => /TLS/.test(l.textContent||''));
    const tlsHint = Array.from(modal.querySelectorAll('.dbm-hint')).find((h) => /中间人|man in the middle|certificate/i.test(h.textContent||''));
    const timeoutRow = modal.querySelector('.dbm-field-inline');
    // A wrapped row is detectable by its height: one line of controls fits well
    // under ~40px; a wrapped row is taller.
    return JSON.stringify({
      footerTag: foot ? foot.className : null,
      test: rect(testBtn), cancel: rect(cancelBtn), save: rect(saveBtn),
      leftRect: rect(left), rightRect: rect(right),
      footerRect: rect(foot),
      testIsLeftOfCancel: (testBtn && cancelBtn) ? testBtn.getBoundingClientRect().x < cancelBtn.getBoundingClientRect().x : null,
      tlsLabel: tlsCheck ? (tlsCheck.textContent||'').trim() : null,
      tlsHint: tlsHint ? (tlsHint.textContent||'').trim().slice(0, 70) : null,
      timeoutRow: rect(timeoutRow),
      timeoutRowDisplay: timeoutRow ? getComputedStyle(timeoutRow).display : null,
      // The redis "database index" field must be gone for a sqlite dialog, and
      // these are labels present in the body.
      bodyLabels: Array.from(modal.querySelectorAll('label.dbm-label > span')).map((s)=> (s.textContent||'').trim()),
    }, null, 2);
  })()`)
  console.log('=== SQLite dialog layout ===')
  console.log(layout)

  // Exercise the test button against the real file, then against a dead port.
  const testOutcome = await cdp.evaluate(`(async () => {
    ${PRELUDE}
    const modal = document.querySelector('.dbm-modal');
    const btn = Array.from(modal.querySelectorAll('button')).find((b) => /测试连接|Test connection/.test(b.textContent||''));
    if (!btn) return JSON.stringify({ fatal: 'no test button' });
    btn.click();
    const ok = await waitFor(() => modal.querySelector('.dbm-ok'), 15000);
    const err = modal.querySelector('.dbm-error');
    return JSON.stringify({ ok: ok ? (ok.textContent||'').trim() : null, err: err ? (err.textContent||'').trim().slice(0,120) : null });
  })()`)
  console.log('=== test against a real SQLite file ===')
  console.log(testOutcome)

  // Switch to redis and confirm the "database index" field is gone and the TLS
  // hint is shown there too.
  const redisForm = await cdp.evaluate(`(async () => {
    ${PRELUDE}
    const modal = document.querySelector('.dbm-modal');
    const kind = modal.querySelector('select.dbm-select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
    setter.call(kind, 'redis');
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(400);

    // Address fields by their LABEL, not by index: the password input is not
    // inside a .dbm-label, so positional indexing silently addressed the wrong
    // box and the test validated a different field than intended.
    const fieldFor = (labelPattern) => {
      const label = Array.from(modal.querySelectorAll('label.dbm-label'))
        .find((l) => labelPattern.test((l.querySelector('span')?.textContent || '').trim()));
      return label ? label.querySelector('input.dbm-input') : null;
    };

    const labels = Array.from(modal.querySelectorAll('label.dbm-label > span')).map((s)=> (s.textContent||'').trim());
    const tlsHint = Array.from(modal.querySelectorAll('.dbm-hint')).find((h) => /中间人|man in the middle/i.test(h.textContent||''));
    const timeoutRow = modal.querySelector('.dbm-field-inline');
    const r = timeoutRow ? timeoutRow.getBoundingClientRect() : null;

    const nameInput = fieldFor(/^名称$|^Name$/);
    if (nameInput) setInput(nameInput, 'Dead Redis');
    const hostInput = fieldFor(/^主机$|^Host$/);
    if (hostInput) setInput(hostInput, '127.0.0.1');
    const portInput = fieldFor(/^端口$|^Port$/);
    if (portInput) setInput(portInput, '1');
    await sleep(250);

    const hostValue = hostInput ? hostInput.value : null;
    const portValue = portInput ? portInput.value : null;

    const btn = Array.from(modal.querySelectorAll('button')).find((b) => /测试连接|Test connection/.test(b.textContent||''));
    btn.click();
    const err = await waitFor(() => modal.querySelector('.dbm-error'), 25000);
    let resultText = null;
    if (err) resultText = (err.textContent||'').trim();
    // Clear any validation error from a previous state so the reading is fresh.
    return JSON.stringify({
      labels,
      hasDatabaseIndexField: labels.some((l) => /数据库编号|Database index/.test(l)),
      tlsHintPresent: !!tlsHint,
      timeoutRowHeight: r ? Math.round(r.height) : null,
      hostValue, portValue,
      deadPortResult: resultText ? resultText.slice(0,140) : null,
    }, null, 2);
  })()`)
  console.log('=== Redis form shape + dead-port test ===')
  console.log(redisForm)
} finally {
  cdp?.close()
  edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
}
