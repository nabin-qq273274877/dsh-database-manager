/**
 * Screenshot the Redis panel's tree for visual review.
 *
 * Usage:
 *   node scripts/shot-redis-tree.mjs <baseUrl-with-token> <sourceId> <db> <outFile> [namespace]
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9337

const [baseUrl, sourceId, dbArg, outFile, namespace] = process.argv.slice(2)
if (baseUrl === undefined || sourceId === undefined || dbArg === undefined || outFile === undefined) {
  console.error('usage: node scripts/shot-redis-tree.mjs <baseUrl-with-token> <sourceId> <db> <outFile> [namespace]')
  process.exit(2)
}
const db = Number(dbArg)

/**
 * The key to select for the screenshot, as an expression evaluated in the page.
 *
 * Computed here rather than inside the page flow: the flow is a template
 * literal, and nesting another template literal inside it is what produced the
 * unbalanced-brace errors when this script was written.
 */
const jsonKeyPath = namespace === undefined || namespace === ''
  ? 'null'
  : `keyByPath(${JSON.stringify(`${namespace.replace(/:$/, '')}:config:app:db`)})`

const FLOW = `(async () => {
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
  const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
  const folderRow = (label) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === label) || null;
  /**
   * A folder by its FULL path, via the title attribute.
   *
   * Label lookup is ambiguous: nested folders repeat names (an 'a' folder can
   * exist under several parents), and clicking the wrong one collapses what was
   * just opened.
   */
  const folderByPath = (path) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
    .find((el) => (el.getAttribute('title') || '') === path) || null;
  const keyRow = (label) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="key"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === label) || null;
  const keyByPath = (path) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="key"]'))
    .find((el) => (el.getAttribute('title') || '') === path) || null;
  /** Open a folder only if it is currently collapsed. */
  const ensureOpen = async (path) => {
    const el = folderByPath(path);
    if (!el) return null;
    if (el.getAttribute('aria-expanded') !== 'true') click(el);
    await waitFor(() => {
      const now = folderByPath(path);
      return now && now.getAttribute('aria-expanded') === 'true' ? now : null;
    }, 8000);
    return folderByPath(path);
  };

  const row = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())),
    20000,
  );
  if (!row) return 'no sidebar row';
  click(row);
  await waitFor(() => document.querySelector('.dbm-root'), 10000);

  const cell = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(sourceId)}), 10000)
    || await waitFor(() => document.querySelector('.dbm-table tbody tr'), 5000);
  const dataRow = cell ? cell.closest('tr') : null;
  const connect = dataRow ? (byText('.dbm-actions .dbm-btn', '连接') || byText('.dbm-actions .dbm-btn', 'Connect')) : null;
  if (!connect) return 'no connect button';
  click(connect);

  const dbRow = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === ${JSON.stringify(`db${db}`)}), 20000);
  if (!dbRow) return 'no db root';
  if (dbRow.getAttribute('aria-expanded') !== 'true') click(dbRow);

  ${namespace === undefined ? '' : `
  // Open the namespace folder and every folder beneath it, so the shot shows
  // the nesting. Expanding is data-driven rather than a hard-coded path list:
  // the tree's shape is what is being reviewed, and a hard-coded path would
  // silently no-op when the shape differs.
  //
  // Each folder is opened by data-path, and the loop repeats because opening one
  // level reveals the next. Levels load lazily, so a pass must also WAIT for the
  // newly revealed children to arrive before deciding what is still collapsed.
  const ns = ${JSON.stringify((namespace ?? '').replace(/:$/, ''))};
  if (ns !== '') {
    const root = Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
      .find((el) => (el.getAttribute('data-path') || '') === ns);
    if (root && root.getAttribute('aria-expanded') !== 'true') click(root);
    await waitFor(() => {
      const el = Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
        .find((node) => (node.getAttribute('data-path') || '') === ns);
      return el && el.getAttribute('aria-expanded') === 'true' ? true : null;
    }, 20000);
  }

  for (let pass = 0; pass < 6; pass++) {
    const collapsed = Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
      .filter((el) => {
        const path = el.getAttribute('data-path') || '';
        const wanted = ns === '' ? true : path === ns || path.startsWith(ns + ':');
        return wanted && el.getAttribute('aria-expanded') !== 'true';
      });
    if (collapsed.length === 0) break;
    for (const el of collapsed) click(el);
    // Wait for the lazy level to actually arrive, not just for the class flip:
    // the arrow changes immediately while the rows come from the host.
    await sleep(900);
  }
  `}

  // Select a key so the value pane is populated, matching the reference shot.
  // Addressed by full name: labels repeat once several folders are open.
  const wanted = ${jsonKeyPath};
  const leaf = wanted
    || document.querySelector('.dbm-side-body [data-kind="key"]');
  if (leaf) {
    click(leaf);
    await waitFor(() => {
      const badge = document.querySelector('.dbm-main .dbm-badge');
      return badge ? true : null;
    }, 15000);
  }
  await sleep(600);
  return 'ok';
})()`

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw))
      const settle = this.pending.get(msg.id)
      if (settle !== undefined) {
        this.pending.delete(msg.id)
        settle(msg)
      }
    })
  }
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const reply = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return reply.result?.result?.value
  }
  close() { this.ws.close() }
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const r = await fetch(url)
      if (r.ok) return await r.json()
    } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error(`timed out: ${url}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-shot-'))
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1400,880', baseUrl,
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
    const ready = await cdp.evaluate(`!!document.querySelector('nav')`)
    if (ready === true) break
    if (Date.now() > boot) throw new Error('the app never booted')
    await new Promise((r) => setTimeout(r, 1000))
  }

  const result = await cdp.evaluate(FLOW)
  console.log('flow:', result)
  await new Promise((r) => setTimeout(r, 800))

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(outFile, Buffer.from(shot.result.data, 'base64'))
  console.log('saved:', outFile)
} catch (error) {
  console.error('SHOT ERROR:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  cdp?.close()
  edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
}
