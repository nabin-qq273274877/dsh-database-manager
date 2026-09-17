/**
 * Does the 表列表 actually show row counts and sizes on a real MySQL server?
 *
 * The defect this verifies: 行数 read 未知 and 大小 was blank for EVERY table. The cause was that
 * information_schema's TABLE_ROWS / DATA_LENGTH / INDEX_LENGTH are `bigint unsigned`, and the pool
 * sets `supportBigNumbers: true` + `bigNumberStrings: true` (so a BIGINT cannot lose precision on
 * its way to the browser), which makes mysql2 hand back every bigint as a STRING — while the driver
 * tested `typeof value === 'number'`.
 *
 * A unit test on the driver covers the conversion; this covers the whole stack, because the
 * symptom the user reported was on screen, not in the driver. It asserts the RENDERED CELLS.
 *
 * Usage: node scripts/probe-table-stats.mjs <baseUrl-with-token> <sourceName> <database>
 *
 * The database must contain a table with at least one row, so 未知 would be visibly wrong.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9403
const baseUrl = process.argv[2]
const sourceName = process.argv[3]
const database = process.argv[4]
if (baseUrl === undefined || sourceName === undefined || database === undefined) {
  console.error('usage: node scripts/probe-table-stats.mjs <baseUrl-with-token> <sourceName> <database>')
  process.exit(2)
}

const profile = mkdtempSync(join(tmpdir(), 'dbm-tstats-'))
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
  await send('Page.navigate', { url: baseUrl })
  await wait(4500)

  /*
   * The flow reads the overview's 行数 and 大小 CELLS, in the column order the header declares.
   *
   * The source is located BY NAME and a missing one fails loudly: connecting to whichever row
   * happens to be listed first would run this against an unrelated server, which is a real side
   * effect rather than a test artefact.
   */
  const out = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(150); } };
    const byExact = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === t) || null;
    const byIncludes = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(t)) || null;
    const within = (root, sel, t) => Array.from(root.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === t) || null;
    const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
    const api = async (p, o) => { const r = await fetch(p, o); const b = await r.json().catch(() => null); if (!r.ok) throw new Error(p + ' → ' + r.status); return b; };

    const report = { failures: [] };
    const fail = (n, d) => report.failures.push({ name: n, detail: d === undefined ? null : d });

    // ---- open the panel ----
    const row = await waitFor(() => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())), 20000);
    if (!row) { fail('sidebar row never rendered'); return report; }
    click(row);
    const root = await waitFor(() => document.querySelector('.dbm-root'), 10000);
    if (!root) { fail('panel did not mount'); return report; }
    /*
     * Come back to the SOURCE LIST first.
     *
     * The panel restores whatever the last session left open — a connected source, or a table —
     * so assuming the list is the landing view made this script report "the named data source is
     * not listed" while the source was listed one screen away. The 数据库列表 / back-to-list
     * control is what returns to it.
     */
    await sleep(1500);
    if (document.querySelector('.dbm-table tbody tr') === null) {
      const back = document.querySelector('[data-dsh-center-view-back]');
      if (back !== null) { click(back); await sleep(1500); }
      if (document.querySelector('.dbm-table tbody tr') === null) {
        const toList = Array.from(document.querySelectorAll('.dbm-btn'))
          .find((b) => ['数据库列表', 'Database list', '返回列表'].includes((b.textContent || '').trim()));
        if (toList) { click(toList); await sleep(1500); }
      }
    }

    /*
     * Locate the source by the ID cell, not by the row's whole text.
     *
     * The name cell renders the name, the description and the id as three stacked divs, so its
     * textContent is all three concatenated — an exact comparison against the name can never
     * match. The dedicated .dbm-mono div holds the id alone, which is also what the panel uses to
     * identify a source, so that is what is compared.
     */
    const listed = await waitFor(() => Array.from(document.querySelectorAll('.dbm-table tbody tr'))
      .find((tr) => Array.from(tr.querySelectorAll('td .dbm-mono'))
        .some((el) => (el.textContent || '').trim() === ${JSON.stringify(sourceName)})), 15000);
    if (!listed) {
      fail('the named data source is not listed', {
        wanted: ${JSON.stringify(sourceName)},
        listed: Array.from(document.querySelectorAll('.dbm-table tbody tr')).map((tr) => (tr.textContent || '').trim().slice(0, 60)),
      });
      return report;
    }
    /*
     * Connect if the row offers 连接; an already-connected source shows 编辑 / 删除 only.
     *
     * Reported as "本机密码" in the action column, which is the password indicator rather than an
     * action — so a missing 连接 is a state, not a failure, and the tree below is already loaded.
     */
    const connectBtn = Array.from(listed.querySelectorAll('.dbm-actions .dbm-btn'))
      .find((b) => ['连接', 'Connect'].includes((b.textContent || '').trim()));
    if (connectBtn !== undefined) { click(connectBtn); await sleep(4000); }

    // ---- open the named database ----
    const reload = document.querySelector('[data-dbm-side-refresh]');
    if (reload) { click(reload); await sleep(3000); }
    const node = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item'))
      /*
       * The row reads "▸dbm_stats_demo" (a collapse glyph, then the name, then its table count), so
       * the glyph and the count are stripped before the name is compared. Measured: matching the
       * whole text, or the first whitespace token, both missed while the database WAS listed.
       */
      .find((el) => (el.textContent || '').replace(/[▸▾>\\s]/g, '').startsWith(${JSON.stringify(database)})), 20000);
    if (!node) {
      fail('the database is not in the tree', {
        wanted: ${JSON.stringify(database)},
        tree: Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).map((el) => (el.textContent || '').trim().slice(0, 50)),
      });
      return report;
    }
    click(node);

    // ---- read the overview cells ----
    const overview = await waitFor(() => document.querySelector('.dbm-main table.dbm-table'), 20000);
    if (!overview) { fail('no table list rendered'); return report; }
    // Wait for the statistics request to land: the 行数 column starts as 未知 for every row.
    await waitFor(() => {
      const cells = Array.from(overview.querySelectorAll('tbody tr'));
      if (cells.length === 0) return null;
      return cells.some((tr) => !/未知|unknown/i.test(tr.textContent || '')) ? true : null;
    }, 15000);
    await sleep(500);

    const headers = Array.from(overview.querySelectorAll('thead th')).map((th) => (th.textContent || '').trim());
    const rowsIdx = headers.indexOf('行数') === -1 ? headers.findIndex((h) => h === 'Rows') : headers.indexOf('行数');
    const sizeIdx = headers.indexOf('大小') === -1 ? headers.findIndex((h) => h === 'Size') : headers.indexOf('大小');
    const nameIdx = headers.indexOf('表') === -1 ? 0 : headers.indexOf('表');
    const rows = Array.from(overview.querySelectorAll('tbody tr')).map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim());
      return { name: cells[nameIdx], rows: cells[rowsIdx], size: cells[sizeIdx], all: cells };
    });

    report.headers = headers;
    report.rowsIdx = rowsIdx;
    report.sizeIdx = sizeIdx;
    report.rows = rows.slice(0, 8);
    report.unknownCount = rows.filter((r) => /未知|unknown/i.test(r.rows || '')).length;
    report.blankSizeCount = rows.filter((r) => (r.size || '') === '').length;
    report.totalRows = rows.length;

    // The driver's own answer, for comparison: the DOM must agree with the wire.
    try {
      const sources = await api('/api/dsh-database/sources');
      const source = sources.sources.find((s) => s.name === ${JSON.stringify(sourceName)});
      if (source !== undefined) {
        const body = await api('/api/dsh-database/sources/' + encodeURIComponent(source.id) + '/tables?schema=' + encodeURIComponent(${JSON.stringify(database)}) + '&stats=1');
        report.wireWithRows = body.tables.filter((t) => t.rows !== undefined).length;
        report.wireWithSize = body.tables.filter((t) => t.size !== undefined).length;
        report.wireTotal = body.tables.length;
        report.wireSample = body.tables.slice(0, 4).map((t) => ({ name: t.name, rows: t.rows, size: t.size, rowsType: typeof t.rows, sizeType: typeof t.size }));
      }
    } catch (e) { report.wireError = String(e); }
    return report;
  })()`)

  console.log(JSON.stringify(out, null, 2))
  for (const failure of out.failures ?? []) check(`flow: ${failure.name}`, false, failure.detail)

  const rows = out.rows ?? []
  check('the overview rendered some tables', rows.length > 0, { total: out.totalRows })
  check('the 行数 column is not 未知 for every table', (out.unknownCount ?? rows.length) < rows.length, { unknownCount: out.unknownCount, total: out.totalRows })
  check('the 大小 column is not blank for every table', (out.blankSizeCount ?? rows.length) < rows.length, { blankSizeCount: out.blankSizeCount, total: out.totalRows })
  // At least one table with real rows must show a real count, which is what the user saw missing.
  const numericRows = rows.filter((r) => /^[0-9][0-9,]*$/.test(r.rows || ''))
  check('at least one table shows a real row count', numericRows.length > 0, numericRows.slice(0, 4))
  const sizedRows = rows.filter((r) => /[0-9]/.test(r.size || ''))
  check('at least one table shows a real size', sizedRows.length > 0, sizedRows.slice(0, 4))
  // The wire and the DOM must agree about how many tables carry statistics.
  check('the wire carries a count for every table', (out.wireWithRows ?? 0) === (out.wireTotal ?? -1), { wireWithRows: out.wireWithRows, wireTotal: out.wireTotal })
  check('the wire carries a size for every table', (out.wireWithSize ?? 0) === (out.wireTotal ?? -1), { wireWithSize: out.wireWithSize, wireTotal: out.wireTotal })
  check('the counts arrive as numbers, not numeric strings',
    (out.wireSample ?? []).every((t) => (t.rows === undefined || t.rowsType === 'number') && (t.size === undefined || t.sizeType === 'number')),
    out.wireSample)
  check('no table renders 未知 while the wire has a count for it', (out.unknownCount ?? 1) === 0, { unknownCount: out.unknownCount, wireWithRows: out.wireWithRows })
} finally {
  try { socket?.close() } catch { /* gone */ }
  child.kill()
  await wait(1000)
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}

const failed = checks.filter(entry => !entry.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
