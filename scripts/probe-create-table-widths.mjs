import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/**
 * Sweep the create-table dialog across viewport widths and report every overflow.
 *
 * The earlier probes measured ONE wide viewport (1500px), which cannot answer "does it
 * overflow at other widths". An overflow is a property of width, so the only honest check
 * is to sweep the range and look at each one — a layout that fits at 1500 and breaks at
 * 1000 is a layout that breaks.
 *
 * Reported per width, for the table-level grid AND the column table:
 *   - the dialog's own width and whether it stays inside the viewport;
 *   - whether the column table's content is wider than its container (a cut-off column);
 *   - whether any control's right edge passes the dialog's;
 *   - the narrowest column, so "fits but is unusable" is visible too.
 *
 * Usage: node scripts/probe-create-table-widths.mjs <baseUrl-with-token> <host:port:user:password>
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9383
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = connection.split(':')
const sourceName = `CT Widths ${process.pid}`
const database = `dbm_ctw_${process.pid}`

/** The widths to sweep: the panel's own sizes plus the breakpoint and just below it. */
const WIDTHS = [1600, 1400, 1200, 1000, 950, 900, 850, 800, 700, 600, 520]

const profile = mkdtempSync(join(tmpdir(), 'dbm-widths-'))
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

  const setup = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(150); } };
    const byIncludes = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(t)) || null;
    const byExact = (sel, t) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === t) || null;
    const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
    const setInput = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const setSelect = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const api = async (path, options) => { const r = await fetch(path, options); const b = await r.json().catch(() => null); if (!r.ok) throw new Error(path + ' → ' + r.status); return b; };

    const row = Array.from(document.querySelectorAll('nav button[aria-label]')).find((b) => ['数据库管理','Database'].includes((b.getAttribute('aria-label')||'').trim()));
    if (!row) return { fatal: 'no sidebar entry' };
    click(row); await sleep(1800);
    click(await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000));
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    if (!modal) return { fatal: 'no create dialog' };
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
    if (!listed) return { fatal: 'source not listed', error: (document.querySelector('.dbm-error')||{}).textContent };
    const sources = await api('/api/dsh-database/sources');
    const sid = sources.sources.find((s) => s.name === ${JSON.stringify(sourceName)}).id;
    click(Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn')).find((b) => ['连接','Connect'].includes(b.textContent.trim())));
    await sleep(3500);
    await api('/api/dsh-database/sources/' + sid + '/database', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'create', name: ${JSON.stringify(database)} }) });
    await sleep(700);
    const reload = document.querySelector('[data-dbm-side-refresh]');
    if (reload) { click(reload); await sleep(2500); }
    const node = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => (el.textContent || '').includes(${JSON.stringify(database)})), 15000);
    if (!node) return { fatal: 'database not in tree' };
    click(node); await sleep(2500);
    click(await waitFor(() => document.querySelector('[data-dbm-dbop="create-table"]'), 6000));
    const dialog = await waitFor(() => document.querySelector('[data-dbm-newtable-name]'), 6000);
    if (!dialog) return { fatal: 'create-table dialog did not open' };
    return { ok: true, sourceId: sid };
  })()`)

  if (setup.fatal !== undefined) throw new Error(`setup failed: ${setup.fatal}${setup.error === undefined ? '' : ' — ' + setup.error}`)

  const rows = []
  for (const width of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    await wait(600)
    const measured = await evaluate(`(() => {
      const grid = document.querySelector('.dbm-grid2');
      const dialog = document.querySelector('.dbm-modal-wide');
      if (grid === null || dialog === null) return { fatal: 'the dialog is no longer open' };
      const dialogRect = dialog.getBoundingClientRect();
      const body = dialog.querySelector('.dbm-modal-body');
      const columnTable = dialog.querySelector('.dbm-newtable-cols');
      const headers = Array.from(dialog.querySelectorAll('.dbm-newtable-cols thead th'));

      /*
       * How the four table-level fields are arranged at THIS width.
       *
       * The requested four-across must not degrade into an ORPHAN row: auto-fit alone gave 3+1 at a
       * 1000px viewport (measured), which reads as a layout mistake rather than a grid, so the
       * shape is reported per width and asserted below. Grouped by a 5px tolerance because the rows'
       * tops differ by a sub-pixel amount when a field's control uses the code font.
       */
      const fieldRows = Array.from(grid.querySelectorAll('.dbm-grid-row'));
      const fieldTops = fieldRows.map((row) => Math.round(row.getBoundingClientRect().top));
      const shape = [];
      for (const top of fieldTops) {
        if (shape.length === 0 || top - shape[shape.length - 1][0] > 5) shape.push([top]);
        else shape[shape.length - 1].push(top);
      }
      const perRow = shape.map((group) => group.length);

      const controls = Array.from(dialog.querySelectorAll('.dbm-grid-control')).map((control) => ({
        width: Math.round(control.getBoundingClientRect().width),
        past: Math.round(control.getBoundingClientRect().right - dialogRect.right),
      }));
      const headerInfo = headers.map((th) => ({
        label: (th.textContent || '').trim(),
        width: Math.round(th.getBoundingClientRect().width),
        past: Math.round(th.getBoundingClientRect().right - dialogRect.right),
      }));

      /*
       * Content CLIPPING, which an overflow check cannot see.
       *
       * The column table uses table-layout: fixed with overflow: hidden, so a control whose
       * content is wider than its cell is cut off while the table still "fits" its
       * container. That is the same user-visible symptom as a cut-off column, by a
       * different mechanism, so it is measured separately: scrollWidth beyond clientWidth
       * on any input or select in the form.
       */
      const clipped = [];
      for (const control of dialog.querySelectorAll('.dbm-newtable-cols input, .dbm-newtable-cols select, .dbm-grid-control')) {
        const element = control;
        // A select always reports some overflow because of its arrow; only a real excess counts.
        const excess = element.scrollWidth - element.clientWidth;
        if (excess > 4) {
          clipped.push({
            tag: element.tagName,
            what: element.getAttribute('aria-label') || element.className,
            excess,
            value: (element.value || '').slice(0, 24),
          });
        }
      }

      return {
        viewport: window.innerWidth,
        dialogWidth: Math.round(dialogRect.width),
        dialogPastViewport: Math.round(dialogRect.right - window.innerWidth),
        gridColumns: getComputedStyle(grid).gridTemplateColumns,
        gridRowCount: grid.querySelectorAll('.dbm-grid-row').length,
        /*
         * The number of VISUAL rows, grouped with a tolerance.
         *
         * The old count was of distinct ROUNDED tops, which reported 3 "rows" for the four fields
         * that all sit on one line — 表名's monospaced control shifts its line box by a fraction of
         * a pixel, so rounding produced 320, 321 and 322. Grouping is what makes the number mean
         * what its name says.
         */
        distinctGridTops: shape.length,
        fieldsPerRow: perRow,
        narrowestControl: controls.length === 0 ? null : Math.min(...controls.map((c) => c.width)),
        controlsPastDialog: controls.filter((c) => c.past > 1).length,
        worstControlPast: controls.length === 0 ? 0 : Math.max(...controls.map((c) => c.past)),
        columnTableScrollWidth: columnTable === null ? null : columnTable.scrollWidth,
        columnTableClientWidth: columnTable === null ? null : columnTable.clientWidth,
        columnTableOverflows: columnTable === null ? null : columnTable.scrollWidth > columnTable.clientWidth + 1,
        columnsPastDialog: headerInfo.filter((h) => h.past > 1).map((h) => h.label),
        narrowestColumn: headerInfo.length === 0 ? null : Math.min(...headerInfo.map((h) => h.width)),
        clippedCount: clipped.length,
        clipped: clipped.slice(0, 6),
        bodyScrollWidth: body === null ? null : body.scrollWidth,
        bodyClientWidth: body === null ? null : body.clientWidth,
        bodyOverflows: body === null ? null : body.scrollWidth > body.clientWidth + 1,
      };
    })()`)
    rows.push({ width, ...measured })
    const status = measured.fatal !== undefined
      ? `FATAL ${measured.fatal}`
      : [
        measured.dialogPastViewport > 1 ? `dialog +${measured.dialogPastViewport}px past viewport` : 'dialog ok',
        measured.columnsPastDialog.length > 0 ? `cut-off columns: ${measured.columnsPastDialog.join(',')}` : 'columns ok',
        measured.controlsPastDialog > 0 ? `${measured.controlsPastDialog} control(s) past dialog (+${measured.worstControlPast}px)` : 'controls ok',
        measured.columnTableOverflows ? `column table scrolls (${measured.columnTableScrollWidth}>${measured.columnTableClientWidth})` : 'column table fits',
        measured.clippedCount > 0 ? `${measured.clippedCount} control(s) with clipped content` : 'no clipped content',
        `narrowest col ${measured.narrowestColumn}px`,
        `fields/row ${JSON.stringify(measured.fieldsPerRow)}`,
      ].join(' | ')
    console.log(`${String(width).padStart(5)}px  ${status}`)
  }

  console.log('')
  const broken = rows.filter(row => row.fatal === undefined && (
    row.dialogPastViewport > 1 ||
    (row.columnsPastDialog ?? []).length > 0 ||
    row.controlsPastDialog > 0 ||
    row.columnTableOverflows === true ||
    row.bodyOverflows === true ||
    // A wider row than the one above it is an orphan: 3+1 for four fields reads as a fault.
    (row.fieldsPerRow ?? []).some(count => count < Math.max(...(row.fieldsPerRow ?? [1])))
  ))
  if (broken.length === 0) {
    console.log('no overflow at any measured width, and no width leaves an ORPHAN row of fields')
  } else {
    console.log(`OVERFLOW or ORPHAN at ${broken.length} width(s):`)
    console.log(JSON.stringify(broken.map(row => ({
      width: row.width,
      fieldsPerRow: row.fieldsPerRow,
      dialogPastViewport: row.dialogPastViewport,
      controlsPastDialog: row.controlsPastDialog,
      clippedCount: row.clippedCount,
    })), null, 2))
  }
} finally {
  try {
    const origin = baseUrl.replace(/\/\?.*$/, '')
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name.startsWith('CT Widths '))) {
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
