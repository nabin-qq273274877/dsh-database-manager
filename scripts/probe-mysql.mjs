/**
 * Dev aid: verify the MySQL browser against a real server.
 *
 * The reported request was "no default database, and after connecting the left
 * side should list databases that expand to show their tables, like phpMyAdmin".
 * Both halves are behavioural, so this drives a real browser: it creates a MySQL
 * source through the dialog (leaving the schema field absent), presses 连接, then
 * checks that the tree lists MORE THAN ONE database and that opening two of them
 * shows each one's own tables.
 *
 * Usage: node scripts/probe-mysql.mjs <baseUrl-with-token>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9341
const baseUrl = process.argv[2]
if (baseUrl === undefined) {
  console.error('usage: node scripts/probe-mysql.mjs <baseUrl-with-token>')
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
const waitFor = async (fn, ms) => { const end = Date.now()+ms; for(;;){ const v = fn(); if(v) return v; if(Date.now()>end) return null; await sleep(150) } };
const setInput = (el, v) => { const proto = el.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})) };
const setSelect = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,v);
  el.dispatchEvent(new Event('change',{bubbles:true})) };
const fieldFor = (modal, re) => {
  const label = Array.from(modal.querySelectorAll('label.dbm-label'))
    .find((l) => re.test((l.querySelector('span')?.textContent || '').trim()));
  return label ? label.querySelector('input.dbm-input') : null;
};
`

const dir = mkdtempSync(join(tmpdir(), 'dsh-mysql-'))
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1600,1000', baseUrl,
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

  // Open the panel.
  const rowPoint = await cdp.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((x) => ['数据库管理','Database'].includes((x.getAttribute('aria-label')||'').trim()));
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) };
  })()`)
  await cdp.click(rowPoint.x, rowPoint.y)
  await new Promise((r) => setTimeout(r, 1200))

  // Create a MySQL source, asserting the schema field is absent.
  const formResult = await cdp.evaluate(`(async () => {
    ${PRELUDE}
    const newBtn = Array.from(document.querySelectorAll('.dbm-btn')).find((b) => /新增数据库|New database/.test(b.textContent||''));
    newBtn.click();
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 6000);
    if (!modal) return JSON.stringify({ fatal: 'dialog did not open' });
    setSelect(modal.querySelector('select.dbm-select'), 'mysql');
    await sleep(350);

    const labels = Array.from(modal.querySelectorAll('label.dbm-label > span')).map((s)=> (s.textContent||'').trim());
    setInput(fieldFor(modal, /^名称$|^Name$/), 'Probe MySQL');
    setInput(fieldFor(modal, /^ID$/), 'probe-mysql');
    setInput(fieldFor(modal, /^主机$|^Host$/), '127.0.0.1');
    setInput(fieldFor(modal, /^端口$|^Port$/), '3306');
    setInput(fieldFor(modal, /^用户$|^User$/), 'root');
    // The password input lives outside a .dbm-label.
    const pw = modal.querySelector('input[type=password]');
    if (pw) setInput(pw, 'root');
    await sleep(250);

    const hint = Array.from(modal.querySelectorAll('.dbm-hint')).map((h)=> (h.textContent||'').trim()).find((x)=> /默认库|default database/i.test(x));
    const testBtn = Array.from(modal.querySelectorAll('button')).find((b) => /测试连接|Test connection/.test(b.textContent||''));
    testBtn.click();
    const ok = await waitFor(() => modal.querySelector('.dbm-ok'), 20000);
    const err = modal.querySelector('.dbm-error');
    const outcome = ok ? (ok.textContent||'').trim() : (err ? 'ERR: ' + (err.textContent||'').trim().slice(0,120) : 'no result');

    const save = Array.from(modal.querySelectorAll('button')).find((b) => /保存|Save/.test((b.textContent||'').trim()));
    save.click();
    return JSON.stringify({ labels, hasDefaultDatabaseField: labels.some((l)=>/默认数据库|Default database/.test(l)), noDefaultHint: hint ?? null, testOutcome: outcome }, null, 2);
  })()`)
  console.log('=== MySQL dialog ===')
  console.log(formResult)

  // Connect and inspect the tree.
  const treeResult = await cdp.evaluate(`(async () => {
    ${PRELUDE}
    const row = await waitFor(() => Array.from(document.querySelectorAll('.dbm-table tbody tr'))
      .find((tr) => /Probe MySQL/.test(tr.textContent||'')), 10000);
    if (!row) return JSON.stringify({ fatal: 'created source not listed' });
    const connect = Array.from(row.querySelectorAll('.dbm-actions .dbm-btn')).find((b) => /连接|Connect/.test(b.textContent||''));
    connect.click();

    const node = await waitFor(() => document.querySelector('.dbm-side-body .dbm-tree-item'), 25000);
    if (!node) {
      const err = document.querySelector('.dbm-error');
      return JSON.stringify({ fatal: 'tree never appeared', error: err ? (err.textContent||'').trim() : null });
    }
    await sleep(500);

    // Top-level nodes = databases (they are the ones with a caret and no indent).
    const nodes = Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item'));
    const databases = nodes.filter((n) => !n.classList.contains('dbm-tree-indent-1')).map((n)=>(n.textContent||'').trim());
    return JSON.stringify({ databaseCount: databases.length, databases: databases.slice(0, 12) }, null, 2);
  })()`)
  console.log('=== left tree: databases ===')
  console.log(treeResult)

  // Expand two databases and check each shows its own tables.
  const expandResult = await cdp.evaluate(`(async () => {
    ${PRELUDE}
    const before = Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item'));
    const dbs = before.filter((n) => !n.classList.contains('dbm-tree-indent-1'));
    // The text includes the caret glyph ("▸name"), so match on a substring
    // rather than anchoring to the start.
    const nameOf = (n) => (n.textContent||'').replace(/^[▸▾]\s*/, '').replace(/\d+$/, '').trim();
    const names = dbs.map(nameOf);
    const indexOf = (needle) => names.indexOf(needle);
    const iA = indexOf('dbm_probe_a');
    const iB = indexOf('dbm_probe_b');
    if (iA < 0 || iB < 0) return JSON.stringify({ fatal: 'probe databases not in tree', names });

    const clickNode = (el) => { el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); el.click(); };
    clickNode(dbs[iA]);
    await sleep(1500);
    clickNode(dbs[iB]);
    await sleep(1500);

    // Group the rendered rows by database using the tree order.
    const all = Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item'));
    const groups = {};
    let current = null;
    for (const n of all) {
      const text = (n.textContent||'').trim();
      if (!n.classList.contains('dbm-tree-indent-1')) { current = text; groups[current] = []; }
      else if (current) groups[current].push(text);
    }
    return JSON.stringify({
      databasesWithTables: Object.keys(groups).filter((k)=> groups[k].length > 0),
      tablesInA: groups[names[iA]] ?? null,
      tablesInB: groups[names[iB]] ?? null,
      bothOpenAtOnce: (groups[names[iA]] ?? []).length > 0 && (groups[names[iB]] ?? []).length > 0,
    }, null, 2);
  })()`)
  console.log('=== expanding two databases ===')
  console.log(expandResult)

  // Open the SAME-named table `t` in each database and confirm the right pane
  // shows each database's own columns — the whole reason the schema has to be
  // threaded through every operation.
  const paneResult = await cdp.evaluate(`(async () => {
    ${PRELUDE}
    const readPane = () => {
      const heads = Array.from(document.querySelectorAll('.dbm-data th')).map((t)=> (t.textContent||'').trim());
      const firstRow = Array.from(document.querySelectorAll('.dbm-data tbody tr'))[0];
      const cells = firstRow ? Array.from(firstRow.querySelectorAll('td')).map((td)=> (td.textContent||'').trim()) : [];
      const err = document.querySelector('.dbm-error');
      return { heads, cells, error: err ? (err.textContent||'').trim().slice(0,120) : null };
    };

    // Read names from the dedicated name element rather than the whole node:
    // a node's text also carries the caret glyph and a trailing count, and
    // parsing those out by regex is guesswork that a name ending in a digit
    // would break.
    const nameOf = (node) => {
      const span = node.querySelector('.dbm-tree-name');
      return span ? (span.textContent || '').trim() : '';
    };
    const rows = Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item'));
    const owner = [];
    let current = null;
    for (const n of rows) {
      const isTable = n.classList.contains('dbm-tree-indent-1');
      const text = nameOf(n);
      if (!isTable) current = text;
      else if (current !== null) owner.push({ el: n, db: current, table: text });
    }
    const tInA = owner.find((o) => o.db === 'dbm_probe_a' && o.table === 't');
    const tInB = owner.find((o) => o.db === 'dbm_probe_b' && o.table === 't');
    if (!tInA || !tInB) {
      return JSON.stringify({
        fatal: 'did not find table t in both databases',
        // Show the parsed pairs so a naming mismatch is diagnosable rather
        // than a mystery. (String concatenation, not a template literal: this
        // code is itself inside a template literal, so nested interpolation
        // would be resolved here rather than in the page.)
        found: owner.map((o) => o.db + '.' + o.table),
      });
    }

    tInA.el.click();
    await waitFor(() => document.querySelector('.dbm-data th'), 15000);
    await sleep(800);
    const fromA = readPane();

    tInB.el.click();
    await waitFor(() => document.querySelector('.dbm-data th'), 15000);
    await sleep(800);
    const fromB = readPane();

    return JSON.stringify({
      'dbm_probe_a.t': fromA,
      'dbm_probe_b.t': fromB,
      columnsDiffer: JSON.stringify(fromA.heads) !== JSON.stringify(fromB.heads),
    }, null, 2);
  })()`)
  console.log('=== same table name in two databases ===')
  console.log(paneResult)
} finally {
  cdp?.close()
  edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
}
