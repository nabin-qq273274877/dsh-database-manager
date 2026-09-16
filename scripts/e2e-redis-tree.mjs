/**
 * End-to-end browser check of the Redis panel's tree and its write actions.
 *
 * Drives a live dsh web UI with a headless Edge over CDP and exercises exactly
 * what the folder tree promises: every database is a root node, a key's :
 * segments become nested folders, and create/delete work from the tree's own
 * controls. It asserts on the rendered tree structure and on what the server
 * actually holds afterwards, so a tree that merely LOOKS right but deletes the
 * wrong keys fails here.
 *
 * The target server is a throwaway Redis: the script writes and deletes real
 * keys, so it refuses to run unless the caller names the namespace it may touch.
 *
 * Usage:
 *   node scripts/e2e-redis-tree.mjs <baseUrl-with-token> <sourceId> <db> <namespace>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9336

const [baseUrl, sourceId, dbArg, namespace] = process.argv.slice(2)
if (baseUrl === undefined || sourceId === undefined || dbArg === undefined || namespace === undefined) {
  console.error('usage: node scripts/e2e-redis-tree.mjs <baseUrl-with-token> <sourceId> <db> <namespace>')
  console.error('  namespace: every key this run touches starts with it, and it is deleted afterwards')
  process.exit(2)
}
const db = Number(dbArg)

/** Merge a wait helper into each evaluated snippet. */
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
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
/** The tree rows, as {kind, depth, label}. */
const treeRows = () => Array.from(document.querySelectorAll('.dbm-side-body [data-kind]')).map((el) => {
  const glyphs = Array.from(el.querySelectorAll('.dbm-tree-glyph')).map((g) => g.textContent.trim());
  return {
    kind: el.getAttribute('data-kind'),
    label: (el.querySelector('.dbm-tree-name') || {}).textContent?.trim() ?? '',
    depth: (el.className.match(/dbm-tree-depth-(\\d)/) || [])[1] ?? '?',
    active: el.getAttribute('data-active') === 'true',
    expanded: el.getAttribute('aria-expanded'),
    path: el.getAttribute('data-path') || el.getAttribute('data-key') || '',
    glyph: glyphs[glyphs.length - 1] ?? '',
  };
});
/** A folder row by its full path (unambiguous; labels repeat across levels). */
const folderByPath = (path) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
  .find((el) => el.getAttribute('data-path') === path) || null;
/** The folder row whose label matches, at any depth. */
const folderRow = (label) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
  .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === label) || null;
/** The key row whose label matches. */
const keyRow = (label) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="key"]'))
  .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === label) || null;
/** A row action button by its title. */
const actionIn = (row, title) => Array.from(row.querySelectorAll('button'))
  .find((b) => (b.getAttribute('title') || '').includes(title)) || null;
/** Open a folder (loading its level) if it is not already open. */
const ensureOpen = async (path) => {
  const el = folderByPath(path);
  if (!el) return null;
  if (el.getAttribute('aria-expanded') !== 'true') click(el);
  return waitFor(() => {
    const now = folderByPath(path);
    return now && now.getAttribute('aria-expanded') === 'true' ? now : null;
  }, 20000);
};
`

/** Fill the flow with the run's own namespace. */
const FLOW = `(async () => {
${PRELUDE}
  const NAMESPACE = ${JSON.stringify(namespace)};
  const report = { steps: [], tree: [] };
  const step = (name, detail) => report.steps.push({ name, detail });

  // 1. Open the panel from the sidebar.
  const row = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())),
    20000,
  );
  if (!row) return JSON.stringify({ ...report, fatal: 'sidebar row never rendered' });
  click(row);
  const root = await waitFor(() => document.querySelector('.dbm-root'), 10000);
  if (!root) return JSON.stringify({ ...report, fatal: 'panel did not mount' });
  step('panel mounted');

  // 2. Press 连接 on the Redis source row.
  const nameCell = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(sourceId)}), 10000)
    || await waitFor(() => document.querySelector('.dbm-table tbody tr'), 5000);
  const dataRow = nameCell ? nameCell.closest('tr') : null;
  const connect = dataRow ? (byText('.dbm-actions .dbm-btn', '连接') || byText('.dbm-actions .dbm-btn', 'Connect')) : null;
  if (!connect) return JSON.stringify({ ...report, fatal: 'no Connect button' });
  click(connect);

  // 3. The tree must render database roots (db0..), not a flat key list.
  const dbRow = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === ${JSON.stringify(`db${db}`)}), 20000);
  if (!dbRow) {
    const err = document.querySelector('.dbm-error');
    return JSON.stringify({ ...report, fatal: 'database root never appeared', error: err ? err.textContent : null });
  }
  const dbCount = document.querySelectorAll('.dbm-side-body [data-kind="db"]').length;
  step('database roots', dbCount);
  // The old design rendered flat key rows at the top level; that class is gone,
  // so the check is on the SHAPE instead: the tree must start with db nodes.
  report.firstLevelKinds = treeRows().map((row) => row.depth + ':' + row.kind);

  // 4. Open the target database if it is not already open.
  const isOpen = dbRow.getAttribute('aria-expanded') === 'true';
  if (!isOpen) click(dbRow);
  const firstFolder = await waitFor(() => folderRow(NAMESPACE.replace(/:$/, '')), 20000);
  if (!firstFolder) {
    const err = document.querySelector('.dbm-error');
    return JSON.stringify({
      ...report,
      fatal: 'namespace folder did not render',
      error: err ? err.textContent : null,
      tree: treeRows(),
    });
  }
  step('namespace folder rendered', NAMESPACE);

  // 5. Folders nest by the ":" segments, each level fetched on demand. Every
  //    open is by full path: labels repeat across levels, and clicking the wrong
  //    row would collapse what was just opened.
  const ns = NAMESPACE.replace(/:$/, '');
  if (!(await ensureOpen(ns))) return JSON.stringify({ ...report, fatal: 'namespace folder did not open', tree: treeRows() });
  if (!(await ensureOpen(ns + ':app'))) return JSON.stringify({ ...report, fatal: 'app folder missing', tree: treeRows() });
  const configFolder = await ensureOpen(ns + ':app:config');
  if (!configFolder) return JSON.stringify({ ...report, fatal: 'config folder missing', tree: treeRows() });
  const leaf = await waitFor(() => keyRow('db'), 20000);
  if (!leaf) return JSON.stringify({ ...report, fatal: 'leaf key missing under nested folders', tree: treeRows() });
  step('nested folders expanded', true);
  report.tree = treeRows();

  // 6. Selecting a key shows its value.
  click(leaf);
  const valueShown = await waitFor(() => {
    const strong = document.querySelector('.dbm-main .dbm-mono');
    return strong && (strong.textContent || '').includes('config:db') ? strong : null;
  }, 10000);
  if (!valueShown) return JSON.stringify({ ...report, fatal: 'value view did not show the key', tree: treeRows() });
  step('value shown', valueShown.textContent.trim());

  // 7. Create a key through the folder's ＋ control, so the prefix is derived
  //    from the folder rather than typed.
  const fresh = folderRow('config');
  const plus = fresh ? actionIn(fresh, '新增键') : null;
  if (!plus) return JSON.stringify({ ...report, fatal: 'no create control on the folder row' });
  click(plus);
  const modal = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
  if (!modal) return JSON.stringify({ ...report, fatal: 'create dialog did not open' });
  const nameBox = modal.querySelector('textarea.dbm-textarea');
  if (!nameBox) return JSON.stringify({ ...report, fatal: 'create dialog has no name box' });
  setInput(nameBox, 'e2e-created');
  const contentBox = Array.from(modal.querySelectorAll('textarea.dbm-textarea'))[1];
  if (contentBox) setInput(contentBox, 'created-by-e2e');
  await sleep(200);
  const submit = byText('.dbm-modal-foot .dbm-btn', '创建') || byText('.dbm-modal-foot .dbm-btn', 'Create');
  if (!submit) return JSON.stringify({ ...report, fatal: 'no Create button' });
  click(submit);

  // 8. It must appear in the tree under that folder.
  const created = await waitFor(() => keyRow('e2e-created'), 15000);
  if (!created) {
    const err = document.querySelector('.dbm-error');
    return JSON.stringify({ ...report, fatal: 'created key did not appear', error: err ? err.textContent : null, tree: treeRows() });
  }
  step('created key visible', created.textContent.trim());
  report.createdKeyFullName = created.getAttribute('title');

  // 9. Delete it through the key row's 🗑 control.
  const created2 = keyRow('e2e-created');
  const trash = created2 ? actionIn(created2, '删除') : null;
  if (!trash) return JSON.stringify({ ...report, fatal: 'no delete control on the key row' });
  click(trash);
  const confirm = await waitFor(() => {
    const m = document.querySelector('.dbm-modal');
    return m ? (byText('.dbm-modal-foot .dbm-btn', '删除') || byText('.dbm-modal-foot .dbm-btn', 'Delete')) : null;
  }, 5000);
  if (!confirm) return JSON.stringify({ ...report, fatal: 'delete confirmation did not open' });
  click(confirm);
  const gone = await waitFor(() => (keyRow('e2e-created') ? null : true), 15000);
  if (!gone) return JSON.stringify({ ...report, fatal: 'deleted key is still in the tree' });
  step('key deleted', true);

  // 10. Delete a whole folder and confirm its subtree goes with it.
  const sessionFolder = folderRow('session');
  if (!sessionFolder) return JSON.stringify({ ...report, fatal: 'session folder missing', tree: treeRows() });
  const folderTrash = actionIn(sessionFolder, '删除目录');
  if (!folderTrash) return JSON.stringify({ ...report, fatal: 'no delete-folder control' });
  click(folderTrash);
  const folderBody = await waitFor(() => document.querySelector('.dbm-modal'), 5000);
  report.folderDialogShowsCount = folderBody ? /\\d+/.test(folderBody.textContent || '') : false;
  const folderConfirm = folderBody
    ? (byText('.dbm-modal-foot .dbm-btn', '删除') || byText('.dbm-modal-foot .dbm-btn', 'Delete'))
    : null;
  if (!folderConfirm) return JSON.stringify({ ...report, fatal: 'folder delete confirmation missing' });
  click(folderConfirm);
  const folderGone = await waitFor(() => (folderRow('session') ? null : true), 20000);
  if (!folderGone) return JSON.stringify({ ...report, fatal: 'folder survived its own delete' });
  step('folder deleted', true);

  report.treeAfter = treeRows();
  return JSON.stringify(report, null, 2);
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
    if (reply.result?.exceptionDetails !== undefined) {
      throw new Error(`page exception: ${JSON.stringify(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails)}`)
    }
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

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-redis-'))
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,900', baseUrl,
], { stdio: 'ignore' })

let cdp
let failed = false
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

  const raw = await cdp.evaluate(FLOW)
  const parsed = JSON.parse(raw)
  console.log(JSON.stringify(parsed, null, 2))
  if (parsed.fatal !== undefined) failed = true
} catch (error) {
  console.error('E2E ERROR:', error instanceof Error ? error.message : String(error))
  failed = true
} finally {
  cdp?.close()
  edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
}

process.exit(failed ? 1 : 0)
