import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/**
 * Does the collation list really follow the chosen character set?
 *
 * The change replaced a free-text collation field with a select filtered by character
 * set. What has to hold, and what this measures:
 *
 *   1. with no character set chosen, the collation field offers nothing to pick;
 *   2. picking 'utf8mb4' offers ONLY utf8mb4 collations — checked against the
 *      server's own list, not against a count, so a list that happens to be the wrong
 *      character set cannot pass;
 *   3. switching to 'latin1' replaces the options AND the selected value: a collation
 *      belongs to one character set, and a leftover utf8mb4 value would be rejected
 *      by MySQL at submit time;
 *   4. the character set's own default collation is marked.
 *
 * The options are compared with the server's 'information_schema.COLLATIONS' output,
 * fetched over the API, so the expectation is the server's truth rather than a
 * hard-coded list that could drift with the server version.
 *
 * Usage: node scripts/probe-collate-link.mjs <baseUrl-with-token> <host:port:user:password>
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9367
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = connection.split(':')
const sourceName = `Collate Link ${process.pid}`

const profile = mkdtempSync(join(tmpdir(), 'dbm-collate-'))
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

  // Create and connect the source through the UI, then open 新建数据库 from the sidebar.
  const flow = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(150); } };
    const byIncludes = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(t)) || null;
    const byExact = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === t) || null;
    const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
    const setInput = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const setSelect = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const out = { steps: [], failures: [] };
    const step = (n, d) => out.steps.push({ name: n, detail: d === undefined ? null : d });
    const fail = (n, d) => out.failures.push({ name: n, detail: d === undefined ? null : d });

    const row = Array.from(document.querySelectorAll('nav button[aria-label]')).find((b) => ['数据库管理','Database'].includes((b.getAttribute('aria-label')||'').trim()));
    if (!row) { fail('no sidebar entry'); return out; }
    click(row); await sleep(1800);
    click(await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000));
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    if (!modal) { fail('no create dialog'); return out; }
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
    click(Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn')).find((b) => ['连接','Connect'].includes(b.textContent.trim())));
    await sleep(3500);
    step('connected');

    // Open 新建数据库 from the sidebar header.
    const plus = document.querySelector('[data-dbm-side-create]');
    if (!plus) { fail('no sidebar create control'); return out; }
    click(plus);
    const dialog = await waitFor(() => document.querySelector('[data-dbm-dbop-charset]'), 6000);
    if (!dialog) { fail('the create dialog did not open'); return out; }
    const dlg = dialog.closest('.dbm-modal');
    step('create dialog open');

    const readCollate = () => {
      const el = dlg.querySelector('[data-dbm-dbop-collate]');
      if (el === null) return null;
      if (el.tagName === 'SELECT') {
        return {
          kind: 'select',
          value: el.value,
          disabled: el.disabled,
          options: Array.from(el.options).map((o) => o.value).filter((v) => v !== ''),
          defaultMarked: Array.from(el.options).some((o) => o.selected === false && o.textContent.includes('（默认）')) ||
            Array.from(el.options).some((o) => o.textContent.includes('（默认）')),
        };
      }
      return { kind: 'input', value: el.value, disabled: el.disabled, placeholder: el.getAttribute('placeholder') };
    };

    // 1. nothing chosen yet
    const before = readCollate();
    step('collation field before choosing a charset', before);

    // 2. choose utf8mb4
    const charsetEl = dlg.querySelector('[data-dbm-dbop-charset]');
    if (charsetEl === null) { fail('no charset control'); return out; }
    setSelect(charsetEl, 'utf8mb4');
    await sleep(600);
    const afterUtf8 = readCollate();
    step('collation field for utf8mb4', { kind: afterUtf8.kind, value: afterUtf8.value, count: afterUtf8.options ? afterUtf8.options.length : null });

    // 3. switch to latin1
    setSelect(charsetEl, 'latin1');
    await sleep(600);
    const afterLatin1 = readCollate();
    step('collation field for latin1', { kind: afterLatin1.kind, value: afterLatin1.value, count: afterLatin1.options ? afterLatin1.options.length : null });

    out.before = before;
    out.afterUtf8 = afterUtf8;
    out.afterLatin1 = afterLatin1;
    out.charsetOptions = Array.from(charsetEl.options).map((o) => o.value).filter((v) => v !== '').length;
    return out;
  })()`)

  for (const step of flow.steps ?? []) console.log(`  · ${step.name}${step.detail === null ? '' : ' → ' + JSON.stringify(step.detail)}`)
  if ((flow.failures ?? []).length > 0) {
    for (const failure of flow.failures) check(`flow: ${failure.name}`, false, failure.detail)
  } else {
    // Fetch the server's own collation grouping, to compare against.
    const origin = baseUrl.replace(/\/\?.*$/, '')
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    const source = sources.sources.find(entry => entry.name.startsWith(sourceName))
    const query = async sql => {
      const response = await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}/query`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql, limit: 3000 }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'query failed')
      return body.result.rows
    }
    const serverUtf8mb4 = (await query("SELECT COLLATION_NAME FROM information_schema.COLLATIONS WHERE CHARACTER_SET_NAME = 'utf8mb4'")).map(r => String(r[0]))
    const serverLatin1 = (await query("SELECT COLLATION_NAME FROM information_schema.COLLATIONS WHERE CHARACTER_SET_NAME = 'latin1'")).map(r => String(r[0]))
    const serverDefault = Object.fromEntries((await query("SELECT CHARACTER_SET_NAME, DEFAULT_COLLATE_NAME FROM information_schema.CHARACTER_SETS WHERE CHARACTER_SET_NAME IN ('utf8mb4','latin1')")).map(r => [String(r[0]), String(r[1])]))

    check('the character set list came from the server', (flow.charsetOptions ?? 0) > 20, { offered: flow.charsetOptions })

    const before = flow.before ?? {}
    check('with no charset chosen the collation field offers no collation', before.kind === 'input' && before.disabled === true, before)

    const utf8 = flow.afterUtf8 ?? {}
    check('choosing utf8mb4 turns the collation field into a list', utf8.kind === 'select', { kind: utf8.kind })
    const utf8Set = new Set(utf8.options ?? [])
    const wrongForUtf8 = (utf8.options ?? []).filter(name => !serverUtf8mb4.includes(name))
    check('every offered collation really belongs to utf8mb4', wrongForUtf8.length === 0, { offending: wrongForUtf8.slice(0, 5), offered: (utf8.options ?? []).length, serverHas: serverUtf8mb4.length })
    check('the utf8mb4 list is the server\'s whole list', utf8Set.size === serverUtf8mb4.length, { offered: utf8Set.size, server: serverUtf8mb4.length })
    check('the utf8mb4 default collation is preselected', utf8.value === serverDefault.utf8mb4, { selected: utf8.value, default: serverDefault.utf8mb4 })

    const latin1 = flow.afterLatin1 ?? {}
    const wrongForLatin1 = (latin1.options ?? []).filter(name => !serverLatin1.includes(name))
    check('switching to latin1 replaces the list', latin1.kind === 'select' && wrongForLatin1.length === 0, { offending: wrongForLatin1.slice(0, 5), offered: (latin1.options ?? []).length })
    check('the latin1 list is the server\'s whole list', new Set(latin1.options ?? []).size === serverLatin1.length, { offered: new Set(latin1.options ?? []).size, server: serverLatin1.length })
    // The critical one: the utf8mb4 selection must NOT survive the switch.
    check('the utf8mb4 selection does not survive a switch to latin1', latin1.value !== utf8.value && serverLatin1.includes(latin1.value), { was: utf8.value, now: latin1.value })
    check('the latin1 default collation is preselected', latin1.value === serverDefault.latin1, { selected: latin1.value, default: serverDefault.latin1 })
  }
} finally {
  try {
    const origin = baseUrl.replace(/\/\?.*$/, '')
    const s = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const src of s.sources.filter(e => e.name.startsWith(sourceName))) {
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(src.id)}`, { method: 'DELETE' })
      console.error(`note: removed ${src.id}`)
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
