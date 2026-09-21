import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebSocket } from 'ws'

/**
 * 结构页列多时的横向溢出量测。
 *
 * 报的现象是「列多的时候超出了页面，超出的部分看不到」。这类描述可以指三种不同的
 * 坏法，而修法完全不同，所以先量出来是哪种：
 *
 *   1. 容器根本没出横向滚动条（scrollWidth > clientWidth 却不滚）→ 右侧整块不可达；
 *   2. 滚动条在，但**操作列**在表格最右端，要一路滚到底才够得着，滚过去又丢了列名；
 *   3. 滚动条与 sticky 都在，只是操作列被 sticky 的其它单元格盖住。
 *
 * 量的是几何而不是类名：客户的抱怨是「看不到」，那就量「右边缘在第几像素、在不在可视
 * 区内」。断言 scrollLeft=0 与 scrollLeft=max 两种状态下操作列是否可见。
 *
 * 用法：node scripts/measure-structure-overflow.mjs <baseUrl-with-token> <sqliteFile> [列数]
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9417

const baseUrl = process.argv[2]
const sqliteFile = process.argv[3]
const columnCount = Number(process.argv[4] ?? 30)
if (baseUrl === undefined || sqliteFile === undefined) {
  console.error('usage: node scripts/measure-structure-overflow.mjs <baseUrl-with-token> <sqliteFile> [columns]')
  process.exit(2)
}

const TAG = process.pid
const SOURCE_NAME = `Measure Overflow ${TAG}`
const TABLE = 'wide_table'

/**
 * 造一张列很多的表：列名与默认值都刻意加宽，让总宽度稳稳超过面板。
 *
 * 能撑宽结构表的只有**单元格内容**：它的表格列数是固定的十列（列名/类型/可空/键/
 * 默认值/额外/非重复值/注释/操作），字段个数再多也只是行数变多。
 *
 * SQLite 不报告列注释，`COMMENT` 也不是它的语法（实测报 syntax error near "COMMENT"），
 * 所以宽度来自列名与默认值——这两个在 SQLite 上都真的显示出来。
 */
function seed(file) {
  const db = new DatabaseSync(file)
  db.exec(`DROP TABLE IF EXISTS ${TABLE}`)
  const longName = (index) => `column_with_a_deliberately_very_long_name_number_${String(index).padStart(2, '0')}_padded`
  const columns = Array.from(
    { length: columnCount },
    (_, index) => `${longName(index)} VARCHAR(191) NOT NULL DEFAULT 'a-fairly-long-default-value-${index}'`,
  )
  db.exec(`CREATE TABLE ${TABLE} (id INTEGER PRIMARY KEY, ${columns.join(', ')})`)
  db.exec(`INSERT INTO ${TABLE}(id) VALUES (1)`)
  db.close()
}

class Session {
  constructor(socket) {
    this.socket = socket
    this.next = 1
    this.pending = new Map()
    socket.on('message', data => {
      const message = JSON.parse(String(data))
      if (message.id === undefined) return
      const entry = this.pending.get(message.id)
      if (entry === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = this.next++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails !== undefined) {
      throw new Error(`page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result.value
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const PRELUDE = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byText = (sel, text) =>
  Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
const byIncludes = (sel, text) =>
  Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').includes(text)) || null;
const waitFor = async (fn, ms) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(150);
  }
};
const setInput = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
const api = async (path) => {
  const response = await fetch(path);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error('API ' + path + ' -> ' + response.status + ': ' + (body && body.error ? body.error : 'no body'));
  return body;
};
const round = (n) => Math.round(n * 10) / 10;
`;

const profile = mkdtempSync(join(tmpdir(), 'dbm-overflow-'))
const child = spawn(EDGE, [
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1600,1000',
  'about:blank',
], { stdio: 'ignore' })

const origin = baseUrl.replace(/\/\?.*$/, '')
let socket
try {
  seed(sqliteFile)

  let target
  for (let attempt = 0; attempt < 80 && target === undefined; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      target = list.find(entry => entry.type === 'page')?.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    if (target === undefined) await wait(250)
  }
  if (target === undefined) throw new Error('the debugger endpoint never came up')

  socket = new WebSocket(target, { maxPayload: 64 * 1024 * 1024 })
  await new Promise((resolve, reject) => { socket.on('open', resolve); socket.on('error', reject) })
  const session = new Session(socket)
  await session.send('Page.enable')
  await session.send('Runtime.enable')
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })

  await session.send('Page.navigate', { url: baseUrl })
  await wait(4500)

  const report = await session.evaluate(`(async () => {
${PRELUDE}
  const out = { notes: [] };
  try {
    const row = Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim()));
    if (!row) return { fatal: 'sidebar row never rendered' };
    click(row);
    await sleep(1800);
    click(await waitFor(() => byIncludes('.dbm-btn', '新增数据库') || byIncludes('.dbm-btn', 'New database'), 5000));
    const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
    if (!modal) return { fatal: 'the create dialog did not open' };
    const inputs = Array.from(modal.querySelectorAll('input.dbm-input'));
    setInput(inputs[0], ${JSON.stringify(SOURCE_NAME)});
    setInput(inputs.find((i) => (i.getAttribute('placeholder') || '').includes('D:/data')), ${JSON.stringify(sqliteFile)});
    await sleep(200);
    click(byText('.dbm-modal-foot .dbm-btn', '保存') || byText('.dbm-modal-foot .dbm-btn', 'Save'));
    const listed = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(SOURCE_NAME)}), 15000);
    if (!listed) return { fatal: 'the created source is not listed', error: (document.querySelector('.dbm-error') || {}).textContent };

    /* 数据源必须按 id 精确定位，不能回退到第一行：那会静默连到另一个库。 */
    const sources = await api('/api/dsh-database/sources');
    const matches = sources.sources.filter((s) => s.name === ${JSON.stringify(SOURCE_NAME)});
    if (matches.length !== 1) return { fatal: 'the run data source did not resolve to one entry', n: matches.length };

    const connect = Array.from(listed.closest('tr').querySelectorAll('.dbm-actions .dbm-btn'))
      .find((b) => ['连接', 'Connect'].includes(b.textContent.trim()));
    click(connect);
    await sleep(3500);

    const dbNode = await waitFor(() => {
      return Array.from(document.querySelectorAll('.dbm-side-body .dbm-tree-item')).find((el) => {
        const label = el.querySelector('.dbm-node-name');
        return label !== null && (label.textContent || '').trim() === 'main';
      }) || null;
    }, 15000);
    if (dbNode === null) return { fatal: 'the database node is not in the tree' };
    click(dbNode);
    await sleep(1800);

    const tableLink = await waitFor(() => byText('.dbm-table .dbm-link', ${JSON.stringify(TABLE)}), 12000);
    if (!tableLink) return { fatal: 'the seeded table is not in the overview' };
    click(tableLink);
    await sleep(1800);
    click(byText('.dbm-tab', '结构') || byText('.dbm-tab', 'Structure'));
    await sleep(2000);

    const scroll = document.querySelector('.dbm-tab-body .dbm-scroll');
    const table = document.querySelector('.dbm-tab-body .dbm-scroll > table.dbm-table');
    if (scroll === null || table === null) {
      return { fatal: 'the structure scroll box or its column table is missing',
        found: { scroll: scroll !== null, table: table !== null } };
    }

    out.scroll = {
      clientWidth: scroll.clientWidth,
      scrollWidth: scroll.scrollWidth,
      clientHeight: scroll.clientHeight,
      scrollHeight: scroll.scrollHeight,
      overflowX: getComputedStyle(scroll).overflowX,
      canScrollX: scroll.scrollWidth > scroll.clientWidth,
      canScrollY: scroll.scrollHeight > scroll.clientHeight,
    };
    out.table = { offsetWidth: table.offsetWidth, scrollWidth: table.scrollWidth };

    /*
     * Whether the horizontal scrollbar is actually reachable.
     *
     * A scroll container's scrollbars sit at the edges of ITS OWN box, so this asks
     * whether the container's bottom edge — where its horizontal scrollbar is — lies
     * inside the window, and whether a horizontal scrollbar is even being rendered
     * (measured as the difference between offsetHeight and clientHeight, which is the
     * height the scrollbar takes away).
     */
    const scrollRect = scroll.getBoundingClientRect();
    out.scrollBox = {
      top: round(scrollRect.top),
      bottom: round(scrollRect.bottom),
      viewportHeight: window.innerHeight,
      bottomInViewport: scrollRect.bottom <= window.innerHeight + 1,
      horizontalScrollbarHeight: scroll.offsetHeight - scroll.clientHeight,
      verticalScrollbarWidth: scroll.offsetWidth - scroll.clientWidth,
      atTop: Math.round(scroll.scrollTop),
    };

    /*
     * The table's own wrapper: with the actions column pinned, this is where the
     * pinning has to take effect, so its geometry is what decides whether the fix works.
     */
    out.tableParent = {
      className: table.parentElement === null ? null : table.parentElement.className,
      overflowX: table.parentElement === null ? null : getComputedStyle(table.parentElement).overflowX,
    };

    /*
     * Where the table's own right edge is, relative to the scroll container.
     *
     * If the table is WIDER than the container, the container must scroll; if it is
     * narrower, the table is fitting itself to the container and there is nothing to
     * scroll — which would mean the columns are being squeezed rather than overflowing.
     */
    const tableRect = table.getBoundingClientRect();
    out.tableBox = {
      left: round(tableRect.left),
      right: round(tableRect.right),
      width: round(tableRect.width),
      containerRight: round(scrollRect.right),
      overflowsContainer: tableRect.right > scrollRect.right + 1,
    };

    const headerCells = Array.from(table.querySelectorAll('thead th'));
    out.headerCount = headerCells.length;
    out.headerLabels = headerCells.map((th) => (th.textContent || '').trim());

    /* 表头最后一格（操作列）与它的 sticky 状态。 */
    const lastHeader = headerCells[headerCells.length - 1];
    out.actionHeader = {
      label: (lastHeader.textContent || '').trim(),
      position: getComputedStyle(lastHeader).position,
      right: getComputedStyle(lastHeader).right,
    };

    /* 正文里操作列的按钮。 */
    const firstBodyRow = table.querySelector('tbody tr');
    const actionCell = firstBodyRow === null ? null : firstBodyRow.lastElementChild;
    out.actionCell = actionCell === null ? null : {
      className: actionCell.className,
      position: getComputedStyle(actionCell).position,
      right: getComputedStyle(actionCell).right,
      buttons: Array.from(actionCell.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
    };

    /* 三个位置的几何：滚到最左、中间、最右。 */
    const measureAt = (left) => {
      scroll.scrollLeft = left;
      const box = scroll.getBoundingClientRect();
      const header = lastHeader.getBoundingClientRect();
      const cell = actionCell === null ? null : actionCell.getBoundingClientRect();
      return {
        scrollLeft: Math.round(scroll.scrollLeft),
        viewport: { left: round(box.left), right: round(box.right) },
        headerRight: round(header.right),
        headerVisible: header.right <= box.right + 1 && header.left >= box.left - 1,
        cellRight: cell === null ? null : round(cell.right),
        cellVisible: cell === null ? null : (cell.right <= box.right + 1 && cell.left >= box.left - 1),
      };
    };

    out.atLeft = measureAt(0);
    await sleep(250);
    out.atMiddle = measureAt(Math.floor(scroll.scrollWidth / 2));
    await sleep(250);
    out.atRight = measureAt(scroll.scrollWidth);
    await sleep(250);
    scroll.scrollLeft = 0;

    /* 有没有真正的横向滚动条：量 clientHeight 与 offsetHeight 的差。 */
    out.scrollbarHeight = scroll.offsetHeight - scroll.clientHeight;

    /*
     * 第一列（列名）在滚到最右时还看不看得见。
     *
     * 「滚过去就丢了是哪一列」是操作列不 sticky 时最容易踩的坏法：即便够到了按钮，
     * 也不再知道自己在改哪一行。
     */
    const firstName = firstBodyRow === null ? null : firstBodyRow.children[0];
    scroll.scrollLeft = scroll.scrollWidth;
    if (firstName !== null) {
      const box = scroll.getBoundingClientRect();
      const rect = firstName.getBoundingClientRect();
      out.nameCellAtRight = { right: round(rect.right), visible: rect.right >= box.left - 1 };
    }
    scroll.scrollLeft = 0;

    return out;
  } catch (error) {
    return { fatal: 'threw', detail: String(error && error.stack ? error.stack : error) };
  }
})()`)

  if (report.fatal !== undefined) {
    console.error(`\nfatal: ${report.fatal}`)
    if (report.detail !== undefined) console.error(report.detail)
    process.exitCode = 1
  } else {
    console.log(JSON.stringify(report, null, 2))
  }
} finally {
  try {
    const sources = await (await fetch(`${origin}/api/dsh-database/sources`)).json()
    for (const source of sources.sources.filter(entry => entry.name === SOURCE_NAME)) {
      await fetch(`${origin}/api/dsh-database/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' })
      console.error(`note: removed the run's data source (${source.id})`)
    }
  } catch { /* best effort */ }
  try { socket?.close() } catch { /* gone */ }
  child.kill()
  await wait(1000)
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}
