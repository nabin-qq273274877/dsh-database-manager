/**
 * Dev aid: measure the panel's rendered geometry and computed styles in a real
 * browser.
 *
 * The panel is registered into the shell's `main` slot, so "is it styled?"
 * cannot be answered by looking at the bundle — the useful question is whether
 * our stylesheet is present AND winning over the shell's defaults. This script
 * opens the panel the way a user does (by clicking the sidebar row), then reads
 * the computed styles of the key elements.
 *
 * Usage: node scripts/measure-panel.mjs <baseUrl-with-token>
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9334

const baseUrl = process.argv[2]
if (baseUrl === undefined) {
  console.error('usage: node scripts/measure-panel.mjs <baseUrl-with-token>')
  process.exit(2)
}

const STYLE_TAG = 'style[data-plugin-css="dsh-database-manager"]'

/** Open the panel by pressing our sidebar row, then report what rendered. */
const OPEN_AND_MEASURE = `(() => {
  const round = (n) => Math.round(n * 100) / 100
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) }
  }
  const box = (el) => {
    if (!el) return null
    const s = getComputedStyle(el)
    return {
      display: s.display,
      background: s.backgroundColor,
      color: s.color,
      padding: s.padding,
      gap: s.gap,
      border: s.borderTopWidth + ' ' + s.borderTopColor,
      fontSize: s.fontSize,
      fontFamily: s.fontFamily.slice(0, 40),
      flexDirection: s.flexDirection,
    }
  }

  // Open the panel exactly as a user would.
  const row = Array.from(document.querySelectorAll('nav button[aria-label]')).find((b) => {
    const t = (b.getAttribute('aria-label') || '').trim()
    return t === '数据库管理' || t === 'Database'
  })
  if (row && !row.getAttribute('aria-current')) row.click()

  // Give React a turn to render the slot.
  return new Promise((resolve) => setTimeout(() => {
    const root = document.querySelector('.dbm-root')
    const header = document.querySelector('.dbm-header')
    const title = document.querySelector('.dbm-title')
    const toolbar = document.querySelector('.dbm-toolbar')
    const btn = document.querySelector('.dbm-btn')
    const input = document.querySelector('.dbm-input')
    const empty = document.querySelector('.dbm-empty')
    const styleTag = document.querySelector(${JSON.stringify(STYLE_TAG)})

    resolve(JSON.stringify({
      panelOpen: !!root,
      activePanelId: row ? row.getAttribute('aria-current') : null,
      styleTagPresent: !!styleTag,
      styleRuleCount: styleTag ? (styleTag.textContent || '').split('{').length - 1 : 0,
      root: { rect: rect(root), style: box(root) },
      header: { rect: rect(header), style: box(header) },
      title: { rect: rect(title), style: box(title) },
      toolbar: { rect: rect(toolbar), style: box(toolbar) },
      button: { rect: rect(btn), style: box(btn) },
      input: { rect: rect(input), style: box(input) },
      empty: { rect: rect(empty), style: box(empty), text: empty ? empty.textContent : null },
      // Any element still carrying a browser default is a styling gap.
      unstyled: Array.from(document.querySelectorAll('.dbm-root button, .dbm-root input, .dbm-root select'))
        .filter((el) => {
          const s = getComputedStyle(el)
          return s.borderRadius === '0px' && s.backgroundColor === 'rgba(0, 0, 0, 0)'
        }).map((el) => ({
          tag: el.tagName,
          cls: el.className,
          type: el.getAttribute('type'),
          text: (el.textContent || '').slice(0, 20),
        })),
    }, null, 2))
  }, 1200))
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
    const reply = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    })
    if (reply.result?.exceptionDetails !== undefined) {
      throw new Error(`page exception: ${JSON.stringify(reply.result.exceptionDetails)}`)
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

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-panel-'))
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,900', baseUrl,
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

  // Wait for the sidebar row, then open the panel and measure.
  const boot = Date.now() + 90000
  for (;;) {
    const ready = await cdp.evaluate(`!!document.querySelector('nav button[aria-label]')`)
    if (ready === true) break
    if (Date.now() > boot) throw new Error('the sidebar never rendered')
    await new Promise((r) => setTimeout(r, 1000))
  }

  const raw = await cdp.evaluate(OPEN_AND_MEASURE)
  console.log(raw)
} finally {
  cdp?.close()
  edge.kill()
  await new Promise((r) => setTimeout(r, 500))
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
}
