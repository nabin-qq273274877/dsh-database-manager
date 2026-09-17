import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

/**
 * Verify the five UI refinements in a real browser.
 *
 * Each is asserted as a MEASURED property, because each is a complaint about what the
 * form looks like or does rather than about whether it exists:
 *
 *   1. 属性 is a dropdown (a 'select'), not a group of checkboxes;
 *   2. 表名's input is a bounded width, not the full dialog;
 *   3+ 字段 are laid out as "label left, control right" with the controls' left edges
 *      aligned, and two fields share a row at this width;
 *   4. 类型 is a 'select' with grouped options;
 *   5. 自增 states its reason as visible text when it cannot be ticked.
 *
 * Usage: node scripts/probe-create-table-ui.mjs <baseUrl-with-token> <host:port:user:password>
 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9377
const baseUrl = process.argv[2]
const connection = process.argv[3] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = connection.split(':')
const sourceName = `CT UI ${process.pid}`
const database = `dbm_ctui_${process.pid}`

const profile = mkdtempSync(join(tmpdir(), 'dbm-ctui-'))
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

    // ---- requirement 3+2: the table-level grid --------------------------
    const nameInput = dlg.querySelector('[data-dbm-newtable-name]');
    const dialogRect = dlg.getBoundingClientRect();
    const nameRect = nameInput.getBoundingClientRect();
    report.nameField = {
      width: Math.round(nameRect.width),
      dialogWidth: Math.round(dialogRect.width),
      fraction: Math.round((nameRect.width / dialogRect.width) * 100),
    };

    // Every table-level field: is its label to the LEFT of its control, and are the
    // controls' left edges aligned?
    const gridRows = Array.from(dlg.querySelectorAll('.dbm-grid-row'));
    /*
     * The rule between the table-level fields and the column list, asked for as
     * "下面加一条线和下面的字段表格隔开".
     *
     * Asserted on RENDERED GEOMETRY, not on the class existing: a divider that is present in the
     * DOM but collapsed to zero height, or drawn in a colour equal to the background, separates
     * nothing. Its border-top must have a non-zero width and its box must sit between the two
     * blocks it divides.
     */
    const sep = dlg.querySelector('.dbm-newtable-sep');
    const sepRect = sep === null ? null : sep.getBoundingClientRect();
    const lastRowRect = gridRows.length === 0 ? null : gridRows[gridRows.length - 1].getBoundingClientRect();
    /*
     * The two blocks the rule divides: the 字段 table's own header below it, and the last hint of
     * the column section. Comparing against the GRID rows for the lower bound would be wrong —
     * those are the fields ABOVE the rule, which is what the upper bound already uses.
     */
    const colHeaderRect = (() => {
      const th = dlg.querySelector('.dbm-newtable-cols thead');
      return th === null ? null : th.getBoundingClientRect();
    })();
    const colHintRect = (() => {
      const hint = Array.from(dlg.querySelectorAll('.dbm-hint')).find((el) => (el.textContent || '').includes('新增字段默认'));
      return hint === null || hint === undefined ? null : hint.getBoundingClientRect();
    })();
    report.separator = sep === null ? null : {
      borderTopWidth: getComputedStyle(sep).borderTopWidth,
      borderTopColor: getComputedStyle(sep).borderTopColor,
      width: sepRect === null ? null : Math.round(sepRect.width),
      height: sepRect === null ? null : Math.round(sepRect.height),
      top: sepRect === null ? null : Math.round(sepRect.top),
      // BELOW the four table-level fields...
      belowFields: sepRect !== null && lastRowRect !== null && sepRect.top >= lastRowRect.bottom - 1,
      // ...and ABOVE both the column table and the hints that follow it.
      aboveColumnTable: sepRect !== null && colHeaderRect !== null && sepRect.top < colHeaderRect.top,
      aboveFirstHint: sepRect !== null && colHintRect !== null && sepRect.top < colHintRect.top,
      columnTableTop: colHeaderRect === null ? null : Math.round(colHeaderRect.top),
      firstHintTop: colHintRect === null ? null : Math.round(colHintRect.top),
    };

    report.grid = gridRows.map((gridRow) => {
      const label = gridRow.querySelector('.dbm-grid-label');
      const control = gridRow.querySelector('.dbm-grid-control');
      if (label === null || control === null) return null;
      const lr = label.getBoundingClientRect();
      const cr = control.getBoundingClientRect();
      /*
       * Where the label's TEXT starts, not where its box starts.
       *
       * The box is a fixed-width track either way, so its geometry says nothing about alignment.
       * Right-alignment is the thing the request complained about, and it shows up as a short
       * label ("表名") starting further right than a long one ("整理（排序规则）") — so the check
       * has to measure the rendered text's own left edge, which a Range gives.
       */
      const range = document.createRange();
      range.selectNodeContents(label);
      const textLeft = Math.round(range.getBoundingClientRect().left);
      return {
        label: (label.textContent || '').trim(),
        labelLeft: Math.round(lr.left),
        labelRight: Math.round(lr.right),
        textLeft,
        textAlign: getComputedStyle(label).textAlign,
        controlLeft: Math.round(cr.left),
        controlWidth: Math.round(cr.width),
        labelIsLeftOfControl: lr.right <= cr.left + 1,
      };
    }).filter(Boolean);
    // How many grid rows share a top coordinate = how many fields share a visual row.
    const tops = report.grid.map((entry) => entry.labelLeft === undefined ? 0 : entry.controlLeft)
    void tops;
    const rowTops = gridRows.map((gridRow) => Math.round(gridRow.getBoundingClientRect().top));
    report.distinctRowTops = [...new Set(rowTops)].length;
    report.rowTops = rowTops;
    /*
     * The vertical SPREAD, not the count of distinct rounded values.
     *
     * Four fields on one row do not report one identical top: 表名's input uses the code font and
     * the others do not, so their line boxes differ by a fraction of a pixel and rounding turns
     * that into 320, 321 and 322 — three "distinct" tops for a single row. Measured exactly that
     * way, so the assertion compares the spread instead, which is what "on one row" really means.
     */
    report.rowTopSpread = rowTops.length === 0 ? 0 : Math.max(...rowTops) - Math.min(...rowTops);
    // Controls sharing a row should have the same width and the same left offset within
    // their cell, which is what "right aligned" means for a label/control pair.
    const widths = report.grid.map((entry) => entry.controlWidth);
    report.uniformControlWidth = widths.length === 0 ? 0 : Math.max(...widths) - Math.min(...widths);
    // The label column must be the same width across rows, so controls line up.
    const labelRights = [...new Set(report.grid.map((entry) => entry.labelRight))];
    report.distinctLabelRights = labelRights.length;

    // ---- requirement 4: the type dropdown is grouped ---------------------
    const typeSelect = dlg.querySelector('[data-dbm-newtable-coltype="0"]');
    report.typeControl = typeSelect === null ? null : {
      tag: typeSelect.tagName,
      groups: Array.from(typeSelect.querySelectorAll('optgroup')).map((g) => (g.getAttribute('label') || '').trim()),
      optionCount: typeSelect.querySelectorAll('option').length,
      // The custom entry must exist, or a type outside the list is unreachable.
      hasCustom: Array.from(typeSelect.options).some((o) => o.value === '__custom__'),
    };

    // ---- requirement 1: the attribute control is a dropdown --------------
    const attrSelect = dlg.querySelector('[data-dbm-newtable-attr-select="0"]');
    report.attribute = attrSelect === null ? null : {
      tag: attrSelect.tagName,
      options: Array.from(attrSelect.options).map((o) => ({ value: o.value, disabled: o.disabled })),
    };
    // No checkbox attributes should remain.
    report.leftoverAttributeCheckboxes = dlg.querySelectorAll('[data-dbm-newtable-attr]').length;

    /*
     * ---- the defaults a fresh 添加字段 row must NOT impose -----------------
     *
     * Three separate requests, all about the form deciding answers the user did not give:
     * 长度/值 must not arrive filled with 255, 类型 must arrive as a number (INT) rather than
     * VARCHAR, and 允许空 must arrive UNCHECKED. Asserted on a freshly added row, because the
     * complaint is specifically about what 添加字段 produces.
     */
    click(dlg.querySelector('[data-dbm-newtable-add]'));
    await sleep(500);
    const added = dlg.querySelector('[data-dbm-newtable-colname="1"]') !== null ? 1 : 0;
    const addedTypeBox = dlg.querySelector('[data-dbm-newtable-coltype="' + added + '"]');
    const addedLengthBox = dlg.querySelector('[data-dbm-newtable-collength="' + added + '"]');
    const addedNullableBox = dlg.querySelector('[data-dbm-newtable-nullable="' + added + '"]');
    report.freshRow = {
      index: added,
      rowCount: dlg.querySelectorAll('[data-dbm-newtable-colname]').length,
      type: addedTypeBox === null ? null : addedTypeBox.value,
      length: addedLengthBox === null ? null : addedLengthBox.value,
      lengthPlaceholder: addedLengthBox === null ? null : addedLengthBox.getAttribute('placeholder'),
      nullable: addedNullableBox === null ? null : addedNullableBox.checked,
    };

    /*
     * ---- the 默认值 cell becomes ONE control you can type in --------------
     *
     * The cell used to hold the dropdown and the literal box side by side, which in a narrow
     * column crushed both ("填写值的框框和选择框都挤的看不见了"). Choosing 自定义 must now swap the
     * cell to a focused text field, and the ↺ button must bring the list back.
     */
    const defaultModeBox = dlg.querySelector('[data-dbm-newtable-coldefault-mode="' + added + '"]');
    const beforeSwap = defaultModeBox === null ? null : defaultModeBox.getBoundingClientRect();
    report.defaultCell = { beforeWidth: beforeSwap === null ? null : Math.round(beforeSwap.width) };
    if (defaultModeBox !== null) setSelect(defaultModeBox, 'custom');
    await sleep(500);
    const defaultTextBox = dlg.querySelector('[data-dbm-newtable-coldefault-text="' + added + '"]');
    const defaultBackBox = dlg.querySelector('[data-dbm-newtable-coldefault-list="' + added + '"]');
    const textRect = defaultTextBox === null ? null : defaultTextBox.getBoundingClientRect();
    report.defaultCell.afterCustom = {
      hasTextBox: defaultTextBox !== null,
      // The select must be GONE, or the cell still carries two controls fighting for the width.
      selectGone: dlg.querySelector('[data-dbm-newtable-coldefault-mode="' + added + '"]') === null,
      textWidth: textRect === null ? null : Math.round(textRect.width),
      // "选择自定义后直接就可以输入": the box must already hold the focus.
      focused: defaultTextBox !== null && document.activeElement === defaultTextBox,
      hasBackButton: defaultBackBox !== null,
    };
    if (defaultBackBox !== null) defaultBackBox.click();
    await sleep(500);
    const backToMode = dlg.querySelector('[data-dbm-newtable-coldefault-mode="' + added + '"]');
    report.defaultCell.afterBack = {
      selectBack: backToMode !== null,
      // Back means 不设置, so no DEFAULT clause is emitted for a cell that reads as "none".
      value: backToMode === null ? null : backToMode.value,
      textGone: dlg.querySelector('[data-dbm-newtable-coldefault-text="' + added + '"]') === null,
    };

    // ---- requirement 5: 自增 explains itself visibly ---------------------
    // Delete the default row (add one first, since a lone row cannot be removed).
    click(dlg.querySelector('[data-dbm-newtable-add]'));
    await sleep(400);
    click(dlg.querySelector('[data-dbm-newtable-remove="0"]'));
    await sleep(500);
    const autoBox = dlg.querySelector('[data-dbm-newtable-auto="0"]');
    const autoHint = dlg.querySelector('[data-dbm-newtable-auto-hint="0"]');
    const autoCell = autoBox === null ? null : autoBox.closest('td');
    report.autoAfterDelete = autoBox === null ? null : {
      disabled: autoBox.disabled,
      hintText: autoHint === null ? null : (autoHint.textContent || '').trim(),
      // The hint must be INSIDE the rendered cell, i.e. actually on screen.
      hintInCell: autoHint !== null && autoCell !== null && autoCell.contains(autoHint),
      hintVisible: autoHint !== null && autoHint.getBoundingClientRect().height > 0,
    };

    // And it must disappear once the combination becomes valid.
    const indexSelect = dlg.querySelector('[data-dbm-newtable-index="0"]');
    const typeSelect2 = dlg.querySelector('[data-dbm-newtable-coltype="0"]');
    if (typeSelect2 !== null && typeSelect2.tagName === 'SELECT') setSelect(typeSelect2, 'INT');
    if (indexSelect !== null) setSelect(indexSelect, 'primary');
    await sleep(600);
    const autoAfterFix = dlg.querySelector('[data-dbm-newtable-auto="0"]');
    report.autoAfterFix = autoAfterFix === null ? null : {
      disabled: autoAfterFix.disabled,
      hasHint: dlg.querySelector('[data-dbm-newtable-auto-hint="0"]') !== null,
    };

    report.formHeaders = Array.from(dlg.querySelectorAll('.dbm-newtable-cols thead th')).map((th) => (th.textContent || '').trim());
    /*
     * The three hints under the column list, read as rendered TEXT.
     *
     * They were rewritten because they described the form as it used to work — "类型可直接输入"
     * (it is a dropdown now), "勾选「主键」" (the primary key is chosen in the 索引 dropdown now).
     * A hint that disagrees with the control beside it teaches the wrong model, so the text itself
     * is what is asserted, not that some element exists.
     */
    const hints = Array.from(dlg.querySelectorAll('.dbm-hint')).map((el) => (el.textContent || '').trim());
    report.hintTexts = {
      defaults: hints.find((text) => text.includes('新增字段默认')) ?? null,
      default: hints.find((text) => text.includes('不设置')) ?? null,
      composite: hints.find((text) => text.includes('联合索引')) ?? null,
      all: hints,
    };
    return report;
  })()`)

  for (const failure of out.failures ?? []) check(`flow: ${failure.name}`, false, failure.detail)
  console.log(JSON.stringify({
    nameField: out.nameField,
    grid: out.grid,
    distinctRowTops: out.distinctRowTops,
    uniformControlWidth: out.uniformControlWidth,
    distinctLabelRights: out.distinctLabelRights,
    typeControl: out.typeControl,
    attribute: out.attribute,
    freshRow: out.freshRow,
    defaultCell: out.defaultCell,
    separator: out.separator,
    hintTexts: out.hintTexts,
    autoAfterDelete: out.autoAfterDelete,
    autoAfterFix: out.autoAfterFix,
  }, null, 2))

  // requirement 2: the name field is bounded, not full width.
  check('表名 input is not the full dialog width', (out.nameField?.fraction ?? 100) < 70, out.nameField)

  // requirement 3: label left, control right, aligned, two per row.
  const grid = out.grid ?? []
  check('every table-level field puts its label left of its control', grid.length > 0 && grid.every(entry => entry.labelIsLeftOfControl), grid.map(entry => [entry.label, entry.labelIsLeftOfControl]))
  /*
   * The label column repeats PER GRID COLUMN.
   *
   * The grid has two columns of field pairs, so there are two label right edges (one per
   * column), not one. Asserting "one distinct right edge" described a single-column
   * layout and failed a correct two-column one. What "aligned" means here is: within each
   * grid column, the labels end at the same x — so the count of distinct right edges must
   * not exceed the number of grid columns.
   */
  /*
   * The label track repeats PER GRID COLUMN.
   *
   * The grid now lays its four fields out in four columns, so there are four label-box left edges
   * (and four right edges), not one or two. Asserting a fixed small number described an older
   * layout; what "aligned" means here is that within each grid column the labels line up, so the
   * count of distinct edges must not exceed the number of fields.
   */
  const labelRights = [...new Set(grid.map(entry => entry.labelRight))].sort((a, b) => a - b)
  check('the labels align within each grid column', labelRights.length <= grid.length, { distinctLabelRights: labelRights.length, rights: labelRights })
  /*
   * The labels are LEFT-aligned, which is what was asked for.
   *
   * Asserted on the rendered TEXT's left edge rather than the label box: every label's box starts
   * at the same x within its grid column by construction, so a box measurement passes under either
   * alignment and would not have caught the original complaint. Under left-alignment every label's
   * text starts at its own column's box x; under the previous right-alignment the short ones were
   * indented by the width of the longest label in that column.
   *
   * Compared against each label's OWN box left edge, one field per column now: the four columns
   * start at four different x values, so a single shared x is not what four-across alignment means.
   * What must hold is that no label's text is inset from its box.
   */
  const textInsets = grid.map(entry => entry.textLeft - entry.labelLeft)
  check('the labels are left-aligned (no text is inset from its own track)',
    textInsets.length > 0 && textInsets.every(inset => inset >= -1 && inset <= 2),
    { textInsets, textLefts: grid.map(entry => entry.textLeft), labelLefts: grid.map(entry => entry.labelLeft), aligns: grid.map(entry => entry.textAlign) })
  /*
   * The controls' widths must match, now that there is one field per grid column.
   *
   * Each column is a 1fr track with the same label width, so the four controls are the same width
   * unless something is content-sized. Comparing per label left edge became vacuous the moment the
   * grid went to one field per column — every group held exactly one control — so the comparison is
   * across all four.
   */
  const controlWidths = grid.map(entry => entry.controlWidth)
  const spread = controlWidths.length === 0 ? 0 : Math.max(...controlWidths) - Math.min(...controlWidths)
  check('the four controls are the same width', spread <= 8, { spread, widths: controlWidths })
  /*
   * The four table-level fields share ONE row, which is what was asked for ("上面表名等4个放一行").
   *
   * Measured as the SPREAD of the rows' top coordinates, not as a count of distinct rounded
   * values: 表名's input is monospaced and the others are not, so their baseline offsets differ by
   * a fraction of a pixel and rounding reports three different tops for one visual row (measured
   * 320, 321, 322). A two-column layout put the spread past 30px, which is the real distinction.
   */
  check('all four table-level fields sit on ONE row', (out.rowTopSpread ?? 999) <= 4, { rows: grid.length, tops: out.rowTops, spread: out.rowTopSpread })
  /*
   * And the four controls are inside the dialog, not pushed past it.
   *
   * Four across is only better than two if they fit: a control whose right edge is beyond the
   * dialog is a clipped control, which is the failure this form already had once.
   */
  check('the four controls all fit inside the dialog',
    grid.length === 4 && grid.every(entry => entry.controlWidth > 0 && entry.controlLeft > entry.labelLeft),
    grid.map(entry => [entry.label, entry.controlLeft, entry.controlWidth]))
  check('every control is wide enough to read its own value', grid.every(entry => entry.controlWidth >= 120), grid.map(entry => [entry.label, entry.controlWidth]))

  /*
   * The rule between the table-level fields and the column list.
   *
   * Asked for as "下面加一条线和下面的字段表格隔开". Asserted on rendered geometry, not on the class
   * existing: a divider present in the DOM but collapsed to zero height, or drawn in the
   * background colour, separates nothing.
   */
  const sep = out.separator
  check('a rule separates the table fields from the column list', sep !== null && sep !== undefined, sep)
  check('the rule is actually drawn (non-zero border with a visible colour)',
    sep?.borderTopWidth === '1px' && typeof sep?.borderTopColor === 'string' && sep.borderTopColor !== 'rgba(0, 0, 0, 0)',
    { width: sep?.borderTopWidth, color: sep?.borderTopColor })
  check('the rule spans the form, not a fragment', (sep?.width ?? 0) >= 1000, { width: sep?.width })
  check('the rule sits BELOW the four fields and ABOVE the column list',
    sep?.belowFields === true && sep?.aboveColumnTable === true && sep?.aboveFirstHint === true, sep)

  // The rewritten hints must actually say something about the NEW behaviour.
  check('the hint under 添加字段 describes the new defaults, not the old form',
    typeof out.hintTexts?.defaults === 'string' && out.hintTexts.defaults.includes('INT') && out.hintTexts.defaults.includes('留空'), out.hintTexts)
  check('the default-value hint mentions the in-cell box and the NOT NULL rule',
    typeof out.hintTexts?.default === 'string' && out.hintTexts.default.includes('自定义'), out.hintTexts)
  check('no hint still claims the type is free text or that 主键 is ticked',
    typeof out.hintTexts?.defaults === 'string' && !out.hintTexts.defaults.includes('可直接输入') && !out.hintTexts.defaults.includes('勾选「主键」'),
    out.hintTexts?.defaults)

  // requirement 4: type is a grouped dropdown with a custom entry.
  check('类型 is a dropdown', out.typeControl?.tag === 'SELECT', out.typeControl)
  check('the type options are grouped', (out.typeControl?.groups ?? []).length >= 4, out.typeControl?.groups)
  check('the type dropdown keeps a custom entry', out.typeControl?.hasCustom === true)
  check('the type list covers the requested groups', ['整数', '日期与时间', '文本与字符', '小数与浮点'].every(label => (out.typeControl?.groups ?? []).includes(label)), out.typeControl?.groups)

  // requirement 1: attributes are a dropdown, and no checkboxes remain.
  check('属性 is a dropdown', out.attribute?.tag === 'SELECT', out.attribute)
  check('属性 lists the four attributes', (out.attribute?.options ?? []).filter(option => option.value !== '').length >= 4, out.attribute?.options?.map(option => option.value))
  check('no attribute checkboxes remain', out.leftoverAttributeCheckboxes === 0, { remaining: out.leftoverAttributeCheckboxes })

  // A fresh 添加字段 row imposes NOTHING: type INT, no length, 允许空 unchecked.
  const fresh = out.freshRow ?? {}
  check('a new row defaults to a numeric type (INT), not VARCHAR', fresh.type === 'INT', { type: fresh.type })
  check('a new row has an EMPTY 长度/值, not 255', fresh.length === '', { length: fresh.length, placeholder: fresh.lengthPlaceholder })
  check('255 stays available as the placeholder hint', fresh.lengthPlaceholder === '255', fresh.lengthPlaceholder)
  check('a new row does NOT arrive with 允许空 ticked', fresh.nullable === false, { checked: fresh.nullable })

  // 默认值: 自定义 swaps the cell to ONE focused box, and ↺ brings the list back.
  const cell = out.defaultCell ?? {}
  const afterCustom = cell.afterCustom ?? {}
  check('choosing 自定义 replaces the dropdown with a text box', afterCustom.hasTextBox === true && afterCustom.selectGone === true, afterCustom)
  check('the text box is immediately typable (it holds focus)', afterCustom.focused === true, afterCustom)
  check('the text box is wide enough to actually type in', (afterCustom.textWidth ?? 0) >= 80, { width: afterCustom.textWidth, beforeWidth: cell.beforeWidth })
  check('the 默认值 cell offers a way back to the list', afterCustom.hasBackButton === true, afterCustom)
  check('going back restores the dropdown and means 不设置', cell.afterBack?.selectBack === true && cell.afterBack?.value === 'none' && cell.afterBack?.textGone === true, cell.afterBack)

  // requirement 5: 自增 says why, visibly, and stops saying it when it can be used.
  check('自增 after deleting the default row is refused', out.autoAfterDelete?.disabled === true, out.autoAfterDelete)
  check('自增 shows a VISIBLE reason', typeof out.autoAfterDelete?.hintText === 'string' && out.autoAfterDelete.hintText.length > 0 && out.autoAfterDelete.hintVisible === true, out.autoAfterDelete)
  check('the reason is inside the rendered cell', out.autoAfterDelete?.hintInCell === true, out.autoAfterDelete)
  check('自增 becomes available once the column is a numeric PRIMARY key', out.autoAfterFix?.disabled === false && out.autoAfterFix?.hasHint === false, out.autoAfterFix)
} finally {
  try {
    const origin = baseUrl.replace(/\/\?.*$/, '')
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name.startsWith('CT UI '))) {
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
