/**
 * End-to-end check that the TTL countdown actually counts down.
 *
 * The arithmetic is unit-tested, but a countdown is a temporal behaviour: it can
 * be perfectly correct per frame and still never repaint (a broken effect, a
 * reading that never re-anchors, a timer that gets cleared immediately). This
 * watches the rendered label change over real elapsed seconds, and confirms it
 * tracks the SERVER's clock rather than only its own ticks — by comparing the
 * drop against how long the page actually waited.
 *
 * Usage: node scripts/e2e-ttl-countdown.mjs <baseUrl-with-token> <sourceId> <db> <namespace> <keyLabel>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9342

const [baseUrl, sourceId, dbArg, namespace, keyLabel] = process.argv.slice(2)
if (baseUrl === undefined || sourceId === undefined || dbArg === undefined || namespace === undefined || keyLabel === undefined) {
  console.error('usage: node scripts/e2e-ttl-countdown.mjs <baseUrl-with-token> <sourceId> <db> <namespace> <keyLabel>')
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
    for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(80); }
  };
  const click = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
  const keyRow = (label) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="key"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === label) || null;
  const folderRow = (label) => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === label) || null;
  /**
   * The countdown label's text, or null when none is shown.
   *
   * The countdown replaces the static TTL value, so this is the dbm-countdown
   * span inside the TTL row — the same element the "TTL: " prefix sits beside.
   */
  const countdown = () => {
    const el = document.querySelector('.dbm-main .dbm-countdown');
    return el ? (el.textContent || '').trim() : null;
  };
  /** The whole TTL row's text, for reporting. */
  const ttlRow = () => {
    const el = document.querySelector('.dbm-main .dbm-countdown');
    const row = el ? el.closest('.dbm-row') : null;
    return row ? (row.textContent || '').replace(/\\s+/g, ' ').trim() : null;
  };
  /**
   * Whether the TTL line prints a SECOND, static duration alongside the
   * countdown — the duplication this design removes.
   *
   * The check is structural, not textual: a single duration can legitimately
   * contain two numbers ("29m 57s" is one value in two units), so counting
   * digit-unit pairs would flag a correct row. What matters is whether a
   * duration exists OUTSIDE the countdown element.
   */
  const showsTwoValues = () => {
    const el = document.querySelector('.dbm-main .dbm-countdown');
    if (!el) return false;
    const row = el.closest('.dbm-row');
    if (!row) return false;
    // Take the row's text with the countdown's own text removed; anything that
    // still looks like a duration is a second value.
    const full = (row.textContent || '').replace(/\\s+/g, ' ');
    const withoutCountdown = full.replace(el.textContent || '', ' ');
    return /\\d+\\s*[dhms]\\b/.test(withoutCountdown) && /\\d/.test(withoutCountdown.replace(/[^0-9]/g, ''));
  };
  /**
   * The countdown's value in seconds.
   *
   * The label is a formatted duration ("28m 0s", "1h 2m", "45s"), so every unit
   * it can contain must be summed — matching just the first "Ns" would read
   * "28m 0s" as 0 and make a working countdown look broken.
   */
  const countdownSeconds = () => {
    const text = countdown();
    if (text === null) return null;
    const days = /(\\d+)\\s*d/.exec(text);
    const hours = /(\\d+)\\s*h/.exec(text);
    const minutes = /(\\d+)\\s*m/.exec(text);
    const secs = /(\\d+)\\s*s/.exec(text);
    if (!days && !hours && !minutes && !secs) return null;
    return (days ? Number(days[1]) * 86400 : 0)
      + (hours ? Number(hours[1]) * 3600 : 0)
      + (minutes ? Number(minutes[1]) * 60 : 0)
      + (secs ? Number(secs[1]) : 0);
  };

  const report = { steps: [] };
  const step = (name, detail) => report.steps.push({ name, detail });

  const sidebar = await waitFor(
    () => Array.from(document.querySelectorAll('nav button[aria-label]'))
      .find((b) => ['数据库管理', 'Database'].includes((b.getAttribute('aria-label') || '').trim())), 20000);
  if (!sidebar) return JSON.stringify({ ...report, fatal: 'no sidebar row' });
  click(sidebar);
  await waitFor(() => document.querySelector('.dbm-root'), 10000);

  const cell = await waitFor(() => byIncludes('.dbm-table td', ${JSON.stringify(sourceId)}), 10000)
    || await waitFor(() => document.querySelector('.dbm-table tbody tr'), 5000);
  const dataRow = cell ? cell.closest('tr') : null;
  const connect = dataRow ? (byText('.dbm-actions .dbm-btn', '连接') || byText('.dbm-actions .dbm-btn', 'Connect')) : null;
  if (!connect) return JSON.stringify({ ...report, fatal: 'no connect button' });
  click(connect);

  const targetDb = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))
    .find((el) => ((el.querySelector('.dbm-tree-name') || {}).textContent || '').trim() === ${JSON.stringify(`db${db}`)}), 20000);
  if (!targetDb) return JSON.stringify({ ...report, fatal: 'no db root' });
  for (const other of Array.from(document.querySelectorAll('.dbm-side-body [data-kind="db"]'))) {
    if (other !== targetDb && other.getAttribute('aria-expanded') === 'true') click(other);
  }
  await sleep(200);
  if (targetDb.getAttribute('aria-expanded') !== 'true') click(targetDb);

  /**
   * Open every folder along the key's path.
   *
   * The tree loads one level at a time, so a key nested two folders deep needs
   * both levels opened — in order, waiting for each level's rows to actually
   * arrive before the next folder even exists to click. Addressing folders by
   * data-path (not label) keeps it unambiguous when labels repeat.
   */
  const openPath = async (path) => {
    const segments = path.split(':');
    for (let i = 1; i <= segments.length; i++) {
      const folderPath = segments.slice(0, i).join(':');
      const el = await waitFor(() => Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
        .find((node) => (node.getAttribute('data-path') || '') === folderPath), 20000);
      if (!el) return folderPath;
      if (el.getAttribute('aria-expanded') !== 'true') click(el);
      await waitFor(() => {
        const now = Array.from(document.querySelectorAll('.dbm-side-body [data-kind="folder"]'))
          .find((node) => (node.getAttribute('data-path') || '') === folderPath);
        return now && now.getAttribute('aria-expanded') === 'true' ? true : null;
      }, 20000);
    }
    return null;
  };

  const missingFolder = await openPath(${JSON.stringify(`${namespace.replace(/:$/, '')}:session`)});
  if (missingFolder !== null) {
    return JSON.stringify({ ...report, fatal: 'folder missing: ' + missingFolder });
  }

  const row = await waitFor(() => keyRow(${JSON.stringify(keyLabel)}), 20000);
  if (!row) return JSON.stringify({ ...report, fatal: 'key row missing' });
  click(row);

  // Wait for the value pane; the countdown appears with it.
  await waitFor(() => document.querySelector('.dbm-main strong.dbm-mono'), 15000);
  await sleep(400);

  const first = countdownSeconds();
  report.firstCountdown = countdown();
  report.ttlRow = ttlRow();
  if (first === null) {
    return JSON.stringify({ ...report, fatal: 'no countdown rendered (is the key permanent?)' });
  }

  // The row must show the countdown INSTEAD of a static reading, not as well as
  // it: two different numbers for one fact is the confusing state this avoids.
  step('TTL row shows a single value', !showsTwoValues());

  // Watch it for ~4 s and record what the label says each second.
  const samples = [{ at: Date.now(), seconds: first, text: countdown() }];
  for (let i = 0; i < 4; i++) {
    await sleep(1000);
    samples.push({ at: Date.now(), seconds: countdownSeconds(), text: countdown() });
  }
  report.samples = samples;

  const elapsedMs = samples[samples.length - 1].at - samples[0].at;
  const dropped = first - samples[samples.length - 1].seconds;
  // The countdown must advance roughly with real time. A tolerance of ±1 s
  // absorbs sampling jitter without letting a stuck or double-speed counter pass.
  report.elapsedMs = elapsedMs;
  report.dropped = dropped;
  step('countdown decreases over real time', Math.abs(dropped - Math.round(elapsedMs / 1000)) <= 1);

  // And it must be strictly decreasing somewhere in the window: a label that
  // merely renders the same number is not a countdown.
  const distinct = new Set(samples.map((s) => s.seconds)).size;
  step('countdown repaints with new values', distinct >= 3);

  // Setting a fresh TTL must re-anchor the countdown to the new value.
  const ttlBtn = await waitFor(() => Array.from(document.querySelectorAll('.dbm-main .dbm-btn'))
      .find((b) => (b.textContent || '').includes('改 TTL') || (b.textContent || '').includes('Edit TTL')), 5000);
  if (ttlBtn) {
    click(ttlBtn);
    const box = await waitFor(() => document.querySelector('.dbm-main input.dbm-input'), 5000);
    if (box) {
      report.editSeededWith = box.value;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(box, '600');
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(150);
      const save = Array.from(document.querySelectorAll('.dbm-main .dbm-btn'))
        .find((b) => (b.textContent || '').trim() === '保存' || (b.textContent || '').trim() === 'Save');
      if (save) {
        click(save);
        await waitFor(() => (document.querySelector('.dbm-root').textContent || '').includes('TTL 已设为')
          || /TTL set to/.test(document.querySelector('.dbm-root').textContent || '') ? true : null, 15000);
        // After saving, the editor closes and the countdown label returns. Wait
        // for it rather than sampling immediately, or the read is null.
        const after = await waitFor(() => {
          const seconds = countdownSeconds();
          return seconds !== null && seconds > 0 ? seconds : null;
        }, 15000);
        report.afterReset = { text: countdown(), seconds: after };
        step('countdown re-anchors after setting a TTL', after !== null && after > 590 && after <= 600);
      } else {
        step('countdown re-anchors after setting a TTL', 'no save button');
      }
    } else {
      step('countdown re-anchors after setting a TTL', 'no ttl input');
    }
  } else {
    step('countdown re-anchors after setting a TTL', 'no TTL control');
  }

  // The edit box must pre-fill with the LIVE remainder, not the load-time value.
  // The countdown label is read BEFORE opening the editor: the editor replaces
  // that row, so the label is gone once the box is showing.
  const shownBeforeSeed = countdownSeconds();
  const ttlBtn2 = await waitFor(() => Array.from(document.querySelectorAll('.dbm-main .dbm-btn'))
    .find((b) => (b.textContent || '').includes('改 TTL') || (b.textContent || '').includes('Edit TTL')), 5000);
  if (ttlBtn2) {
    click(ttlBtn2);
    await sleep(400);
    const box = await waitFor(() => document.querySelector('.dbm-main input.dbm-input'), 5000);
    if (box) {
      const seed = Number(box.value);
      report.seedAfterReset = { seed, shown: shownBeforeSeed };
      step('edit box seeds with the live remainder',
        Number.isFinite(seed) && shownBeforeSeed !== null && Math.abs(seed - shownBeforeSeed) <= 2);
    } else {
      step('edit box seeds with the live remainder', 'no input');
    }
  } else {
    step('edit box seeds with the live remainder', 'no TTL control');
  }

  return JSON.stringify(report, null, 2);
})()`

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.nextId = 1; this.pending = new Map()
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)); const s = this.pending.get(msg.id)
      if (s !== undefined) { this.pending.delete(msg.id); s(msg) }
    })
  }
  ready() { return new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej) }) }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })) })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails !== undefined) throw new Error(r.result.exceptionDetails.exception?.description ?? '')
    return r.result?.result?.value
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

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-ttl-'))
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
    if (Date.now() > boot) throw new Error('never booted')
    await new Promise((r) => setTimeout(r, 1000))
  }
  const parsed = JSON.parse(await cdp.evaluate(FLOW))
  console.log(JSON.stringify(parsed, null, 2))
  if (parsed.fatal !== undefined) failed = true
  if (Array.isArray(parsed.steps) && parsed.steps.some((s) => s.detail !== true)) failed = true
} catch (error) {
  console.error('E2E ERROR:', error instanceof Error ? error.message : String(error))
  failed = true
} finally {
  cdp?.close(); edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
}

process.exit(failed ? 1 : 0)
