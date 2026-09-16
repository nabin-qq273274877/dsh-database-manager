/**
 * End-to-end check of the Redis value editor in a real browser.
 *
 * Edits are staged in the form and written on 保存, so the only meaningful
 * assertion is that a change typed into the panel actually lands in Redis — and
 * that the shapes which must NOT be silently rewritten (a mismatched type, a
 * zset score that is not a number) are refused.
 *
 * Usage: node scripts/e2e-redis-edit.mjs <baseUrl-with-token> <sourceId> <db> <namespace>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9339

const [baseUrl, sourceId, dbArg, namespace] = process.argv.slice(2)
if (baseUrl === undefined || sourceId === undefined || dbArg === undefined || namespace === undefined) {
  console.error('usage: node scripts/e2e-redis-edit.mjs <baseUrl-with-token> <sourceId> <db> <namespace>')
  process.exit(2)
}
const db = Number(dbArg)

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
      await sleep(80);
    }
  };
  const setInput = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
  const byPath = (kind, path) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="' + kind + '"]'))
    .find((el) => (el.getAttribute(kind === 'folder' ? 'data-path' : 'data-key') || '') === path) || null;
  const folderRow = (label) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === label) || null;
  /**
   * The key row for a key, by its FULL name.
   *
   * Matching on the leaf label is ambiguous once several folders are open (a
   * config key can exist under two different prefixes), and the row carries
   * its full name in data-key precisely so it can be addressed unambiguously.
   */
  const keyByPath = (path) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="key"]'))
    .find((el) => (el.getAttribute('data-key') || '') === path) || null;
  const keyRow = (label) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="key"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === label) || null;
  /** Close any open inline editor row (the TTL editor) so later lookups are unambiguous. */
  const closeInlineEditors = async () => {
    for (const cancel of Array.from(document.querySelectorAll('.dbm-main .dbm-btn'))
      .filter((b) => (b.textContent || '').trim() === '取消' || (b.textContent || '').trim() === 'Cancel')) {
      cancel.click();
      await sleep(120);
    }
    await sleep(200);
  };

  /**
   * Select a key and wait for ITS editor to be mounted.
   *
   * Wraps the two steps that must always happen together: close any inline
   * editor left open by the previous key (its buttons would otherwise satisfy a
   * later lookup), then click the key and wait for the type badge AND the key
   * header to agree. Doing this by hand at each call site is what made the
   * failure move from key to key instead of being fixed.
   *
   * @returns null on success, or a short reason the caller can report.
   */
  const selectKey = async (label, type) => {
    const row = keyRow(label);
    if (!row) return 'key row not found';
    await closeInlineEditors();
    click(row);
    if (!(await waitForEditor(type, label))) return 'editor did not mount';
    return null;
  };
  /** The panel's visible text, INCLUDING the notice/error strip. */
  const panelText = () => (document.querySelector('.dbm-root') || {}).textContent || '';
  /** The main pane's text only. Used to assert on copy, never on field values. */
  const mainText = () => (document.querySelector('.dbm-main') || {}).textContent || '';
  /**
   * The values currently shown in the pane's editable fields.
   *
   * Field values are NOT part of textContent — an input's value is a
   * property, not a child node — so a check like
   * mainText().includes('saved-value') can never pass for the input-based
   * editors (list, set, hash, zset) even when the write succeeded. A textarea is
   * the exception: React renders its value as a child, which is why the string
   * assertion appeared to work and hid the mistake.
   */
  const fieldValues = () => [
    ...Array.from(document.querySelectorAll('.dbm-main input.dbm-input')).map((el) => el.value),
    ...Array.from(document.querySelectorAll('.dbm-main textarea.dbm-textarea')).map((el) => el.value),
  ];
  /** A button in the main pane by label. */
  const mainBtn = (text) => Array.from(document.querySelectorAll('.dbm-main .dbm-btn'))
    .find((b) => (b.textContent || '').trim() === text) || null;
  /**
   * The "which editor is mounted" probe, and what it currently sees.
   *
   * Returned alongside a failure so a timeout is explained by real DOM state
   * rather than by re-reading the assertion. Written as one function so the
   * waited-on condition and the reported condition cannot drift apart.
   */
  const editorProbe = (type, keyName) => {
    const badge = document.querySelector('.dbm-main .dbm-badge');
    const header = document.querySelector('.dbm-main strong.dbm-mono');
    const badgeText = badge ? (badge.textContent || '').trim() : null;
    const headerText = header ? (header.textContent || '').trim() : null;
    const ok = badgeText === type
      && (keyName === undefined || headerText === null || headerText.includes(keyName));
    return { ok, badgeText, headerText, expected: { type, keyName } };
  };

  /**
   * Wait until the main pane shows the editor for a given key type.
   *
   * Switching keys is asynchronous, so acting on the grid's inputs without this
   * grabs the PREVIOUS editor's inputs — which silently sends an edit to the
   * wrong key. The type BADGE is the reliable marker: it is a dedicated element
   * (a dbm-badge span holding just the type name), whereas matching on the
   * pane's text would also match a value that merely contains that name.
   */
  const waitForEditor = async (type, keyName) => {
    const ok = await waitFor(() => (editorProbe(type, keyName).ok ? true : null), 20000);
    if (!ok) return false;
    // Let the editor's own state settle (drafts reset, effects run) before the
    // caller starts touching inputs.
    await sleep(400);
    return true;
  };

  const report = { steps: [] };
  const step = (name, detail) => report.steps.push({ name, detail });

  const sidebar = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())),
    20000,
  );
  if (!sidebar) return JSON.stringify({ ...report, fatal: 'no sidebar row' });
  click(sidebar);
  await waitFor(() => document.querySelector('.dbm-root'), 10000);

  const cell = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(sourceId)}), 10000)
    || await waitFor(() => document.querySelector('.dbm-table tbody tr'), 5000);
  const dataRow = cell ? cell.closest('tr') : null;
  const connect = dataRow ? (byText('.dbm-actions .dbm-btn', '连接') || byText('.dbm-actions .dbm-btn', 'Connect')) : null;
  if (!connect) return JSON.stringify({ ...report, fatal: 'no connect button' });
  click(connect);

  // Open the target database, closing whatever the panel expanded by default.
  const nsLabel = ${JSON.stringify(namespace.replace(/:$/, ''))};
  const targetDb = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === ${JSON.stringify(`db${db}`)}), 20000);
  if (!targetDb) return JSON.stringify({ ...report, fatal: 'no db root' });
  for (const other of Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))) {
    if (other !== targetDb && other.getAttribute('aria-expanded') === 'true') click(other);
  }
  await sleep(200);
  if (targetDb.getAttribute('aria-expanded') !== 'true') click(targetDb);
  const nsFolder = await waitFor(() => folderRow(nsLabel), 20000);
  if (!nsFolder) return JSON.stringify({ ...report, fatal: 'namespace folder missing', tree: mainText().slice(0, 200) });
  // The keys live UNDER the namespace folder, so it must be opened before any
  // key row exists to click.
  if (nsFolder.getAttribute('aria-expanded') !== 'true') click(nsFolder);
  await waitFor(() => keyRow('str-demo'), 20000);

  // ---- string: change the value, save, verify the panel reloaded ----
  const strKey = await waitFor(() => keyRow('str-demo'), 15000);
  if (!strKey) return JSON.stringify({ ...report, fatal: 'string key missing', tree: mainText().slice(0, 200) });
  const strErr = await selectKey('str-demo', 'string');
  if (strErr !== null) return JSON.stringify({ ...report, fatal: 'string editor: ' + strErr, probe: editorProbe('string', 'str-demo') });
  const strBox = document.querySelector('.dbm-main textarea.dbm-textarea');
  if (!strBox) return JSON.stringify({ ...report, fatal: 'string editor has no textarea' });
  step('string editor rendered', true);

  // 保存 must be disabled until something actually changes, or "save" means
  // nothing and a stray click rewrites the key.
  const saveBefore = mainBtn('保存') || mainBtn('Save');
  report.stringSaveDisabledBeforeEdit = saveBefore ? saveBefore.disabled : null;
  step('save disabled before an edit', report.stringSaveDisabledBeforeEdit);

  setInput(strBox, 'edited-by-e2e');
  await sleep(200);
  const saveStr = mainBtn('保存') || mainBtn('Save');
  if (!saveStr) return JSON.stringify({ ...report, fatal: 'no save button for string' });
  if (saveStr.disabled) return JSON.stringify({ ...report, fatal: 'save stayed disabled after an edit' });
  click(saveStr);
  // The notice is rendered above the screen, not inside it.
  const strOk = await waitFor(() => (panelText().includes('已保存') || panelText().includes('Saved') ? true : null), 15000);
  step('string saved', strOk === true);
  // The reload must show the new value, not the stale one.
  const strReloaded = await waitFor(() => (fieldValues().includes('edited-by-e2e') || mainText().includes('edited-by-e2e') ? true : null), 15000);
  step('string value reloaded', strReloaded === true);

  // ---- TTL: set 600, then make permanent ----
  const ttlBtn = await waitFor(() => Array.from(document.querySelectorAll('.dbm-main .dbm-btn'))
    .find((b) => (b.textContent || '').includes('改 TTL') || (b.textContent || '').includes('Edit TTL')), 5000);
  if (!ttlBtn) return JSON.stringify({ ...report, fatal: 'no TTL edit control' });
  click(ttlBtn);
  const ttlBox = await waitFor(() => document.querySelector('.dbm-main input.dbm-input'), 5000);
  if (!ttlBox) return JSON.stringify({ ...report, fatal: 'no TTL input' });
  setInput(ttlBox, '600');
  await sleep(150);
  // In TTL edit mode the first 保存 belongs to the TTL row.
  const ttlSave = mainBtn('保存') || mainBtn('Save');
  if (!ttlSave) return JSON.stringify({ ...report, fatal: 'no TTL save' });
  click(ttlSave);
  const ttlSet = await waitFor(() => (panelText().includes('TTL 已设为') || /TTL set to/.test(panelText()) ? true : null), 15000);
  step('ttl set', ttlSet === true);

  // "Make permanent" lives inside the TTL editor, so it has to be re-opened.
  const ttlBtn2 = await waitFor(() => Array.from(document.querySelectorAll('.dbm-main .dbm-btn'))
    .find((b) => (b.textContent || '').includes('改 TTL') || (b.textContent || '').includes('Edit TTL')), 8000);
  if (!ttlBtn2) {
    step('ttl cleared to permanent', 'edit control missing after save');
  } else {
    click(ttlBtn2);
    const persistBtn = await waitFor(() => Array.from(document.querySelectorAll('.dbm-main .dbm-btn'))
      .find((b) => (b.textContent || '').includes('设为永久') || (b.textContent || '').includes('Make permanent')), 5000);
    if (!persistBtn) {
      step('ttl cleared to permanent', 'persist control missing');
    } else {
      click(persistBtn);
      const persisted = await waitFor(() => {
        const text = mainText();
        return text.includes('永久') || text.includes('no expiry') ? true : null;
      }, 15000);
      step('ttl cleared to permanent', persisted === true);
    }
  }

  // ---- list: append an element through the editor ----
  const listKey = await waitFor(() => keyRow('list-demo'), 10000);
  if (!listKey) return JSON.stringify({ ...report, fatal: 'list key missing' });
  const listErr = await selectKey('list-demo', 'list');
  if (listErr !== null) {
    return JSON.stringify({ ...report, fatal: 'list editor: ' + listErr, probe: editorProbe('list', 'list-demo') });
  }
  // The append box is the LAST input in the pane (the row inputs come first).
  const appendBox = (() => {
    const boxes = Array.from(document.querySelectorAll('.dbm-main input.dbm-input'));
    return boxes.length > 0 ? boxes[boxes.length - 1] : null;
  })();
  if (!appendBox) return JSON.stringify({ ...report, fatal: 'no append box for list' });
  setInput(appendBox, 'e2e-appended');
  await sleep(200);
  const appendBtn = mainBtn('追加到末尾') || mainBtn('Append');
  if (!appendBtn) return JSON.stringify({ ...report, fatal: 'no append button' });
  if (appendBtn.disabled) return JSON.stringify({ ...report, fatal: 'append button stayed disabled' });
  click(appendBtn);
  const appended = await waitFor(() => (fieldValues().includes('e2e-appended') ? true : null), 15000);
  step('list append landed', appended === true);

  // ---- hash: change a field's value ----
  const hashKey = await waitFor(() => keyRow('hash-demo'), 10000);
  if (!hashKey) {
    step('hash field saved', 'key missing');
  } else {
    const hashErr = await selectKey('hash-demo', 'hash');
    if (hashErr !== null) {
      step('hash field saved', hashErr);
      report.hashProbe = editorProbe('hash', 'hash-demo');
    } else {
      const inputs = Array.from(document.querySelectorAll('.dbm-main .dbm-data input.dbm-input'));
      if (inputs.length < 2) {
        step('hash field saved', 'hash rows not rendered');
      } else {
        // Row layout is field, value, so the value box is the second input.
        setInput(inputs[1], 'changed-by-e2e');
        await sleep(200);
        const saveHash = mainBtn('保存') || mainBtn('Save');
        if (!saveHash || saveHash.disabled) {
          step('hash field saved', 'save disabled after an edit');
        } else {
          click(saveHash);
          const hashOk = await waitFor(() => (fieldValues().includes('changed-by-e2e') ? true : null), 15000);
          step('hash field saved', hashOk === true);
        }
      }
    }
  }

  // ---- zset: a non-numeric score must be refused, not sent ----
  const zsetKey = await waitFor(() => keyRow('zset-demo'), 10000);
  if (!zsetKey) {
    step('zset rejects a bad score in the UI', 'key missing');
  } else {
    const zsetErr = await selectKey('zset-demo', 'zset');
    if (zsetErr !== null) {
      step('zset rejects a bad score in the UI', zsetErr);
      report.zsetProbe = editorProbe('zset', 'zset-demo');
    } else {
      const scoreInput = document.querySelector('.dbm-main .dbm-data input.dbm-input');
      if (!scoreInput) {
        step('zset rejects a bad score in the UI', 'no score input');
      } else {
        setInput(scoreInput, 'not-a-number');
        await sleep(200);
        const saveZ = mainBtn('保存') || mainBtn('Save');
        if (!saveZ || saveZ.disabled) {
          step('zset rejects a bad score in the UI', 'save disabled after an edit');
        } else {
          click(saveZ);
          const refused = await waitFor(() => {
            const text = panelText();
            return text.includes('分值不是数字') || /Score is not a number/.test(text) ? true : null;
          }, 8000);
          step('zset rejects a bad score in the UI', refused === true);
        }
      }
    }
  }

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
      throw new Error(`page exception: ${reply.result.exceptionDetails.exception?.description ?? ''}`)
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

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-edit-'))
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

  const parsed = JSON.parse(await cdp.evaluate(FLOW))
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
