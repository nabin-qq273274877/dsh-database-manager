/**
 * Dev aid: measure the sidebar rows of a running dsh web UI in a real browser.
 *
 * The sidebar entry rows are produced by two different code paths — the SSH
 * plugin injects plain DOM, this plugin renders through the shell's
 * `sidebar.panellist` slot — so "make them line up" cannot be settled by
 * reading CSS: the two rows sit in different containers with different
 * padding and gap rules. This script boots a headless Edge against a live
 * instance, drives CDP, and prints the measured geometry of both rows so a
 * padding/gap change can be judged against numbers instead of guesses.
 *
 * Usage:
 *   node scripts/measure-sidebar.mjs <baseUrl> [--keep-open]
 *
 * <baseUrl> must include the auth token, e.g.
 *   http://127.0.0.1:57561/?token=XXXX
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEBUG_PORT = 9333

const baseUrl = process.argv[2]
if (baseUrl === undefined) {
  console.error('usage: node scripts/measure-sidebar.mjs <baseUrl-with-token>')
  process.exit(2)
}

/** The expression evaluated in the page: returns a JSON string of measurements. */
const MEASURE = `(() => {
  const round = (n) => Math.round(n * 100) / 100
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) }
  }
  const style = (el) => {
    if (!el) return null
    const s = getComputedStyle(el)
    return {
      display: s.display, padding: s.padding, gap: s.gap,
      margin: s.margin, fontSize: s.fontSize, lineHeight: s.lineHeight,
      minHeight: s.minHeight, alignItems: s.alignItems, borderRadius: s.borderRadius,
    }
  }

  // This plugin's row: the shell renders a button per panellist registration,
  // using the label we supplied as its aria-label.
  const labels = Array.from(document.querySelectorAll('nav button[aria-label]'))
  const mine = labels.find((b) => {
    const t = (b.getAttribute('aria-label') || '').trim()
    return t === '数据库管理' || t === 'Database'
  }) || null

  // The SSH plugin's row is plain DOM carrying its own attribute.
  const ssh = document.querySelector('[data-dsh-ssh-entry]')

  // The New Session button: the shared visual anchor both rows sit beside.
  const newSession = document.querySelector('button[class*="newSession"]')

  // Select each row's parts precisely, so the glyph box, the drawing, and the
  // text can be compared separately. Mixing them up is how a 5px misalignment
  // hides behind an "icon aligned" reading.
  const mineGlyphBox = mine ? mine.querySelector('.dbm-entry-glyph') : null
  const mineSvg = mineGlyphBox ? mineGlyphBox.querySelector('svg') : null
  const mineTitle = mine ? mine.querySelector('[class*="panelTitle"]') : null

  const sshGlyphBox = ssh ? ssh.querySelector('span') : null
  const sshSvg = sshGlyphBox ? sshGlyphBox.querySelector('svg') : null
  const sshTitle = ssh ? ssh.querySelector('span:last-child') : null

  return JSON.stringify({
    found: { mine: !!mine, ssh: !!ssh, newSession: !!newSession },
    mine: {
      row: rect(mine), style: style(mine),
      glyphBox: rect(mineGlyphBox), glyphBoxStyle: style(mineGlyphBox),
      svg: rect(mineSvg),
      title: rect(mineTitle),
    },
    ssh: {
      row: rect(ssh), style: style(ssh),
      glyphBox: rect(sshGlyphBox),
      svg: rect(sshSvg),
      title: rect(sshTitle),
    },
    newSession: { row: rect(newSession), style: style(newSession) },
    // Whether our stylesheet actually landed, and whether it is winning.
    styles: {
      ourTag: !!document.querySelector('style[data-plugin-css="dsh-database-manager"]'),
      ourRuleCount: (() => {
        const tag = document.querySelector('style[data-plugin-css="dsh-database-manager"]')
        return tag ? (tag.textContent || '').split('{').length - 1 : 0
      })(),
    },
  }, null, 2)
})()`

/** Minimal CDP client over one WebSocket. */
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

  /** Evaluate an expression in the page and return its value. */
  async evaluate(expression) {
    const reply = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (reply.result?.exceptionDetails !== undefined) {
      throw new Error(`page exception: ${JSON.stringify(reply.result.exceptionDetails)}`)
    }
    return reply.result?.result?.value
  }

  close() {
    this.ws.close()
  }
}

/** Poll an HTTP JSON endpoint until it answers. */
async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-measure-'))
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--window-size=1440,900',
  baseUrl,
], { stdio: 'ignore' })

let cdp
try {
  await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`, 30000)

  // Find the page target (the tab we launched) rather than creating one, so the
  // app boots exactly once.
  let target
  const deadline = Date.now() + 30000
  for (;;) {
    const list = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`, 10000)
    target = list.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string')
    if (target !== undefined) break
    if (Date.now() > deadline) throw new Error('no page target appeared')
    await new Promise((r) => setTimeout(r, 300))
  }

  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.ready()
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')

  // The app is a heavy React boot; poll until our row exists.
  let measured
  const bootDeadline = Date.now() + 90000
  for (;;) {
    const raw = await cdp.evaluate(MEASURE)
    measured = JSON.parse(raw)
    if (measured.found.mine && measured.found.ssh) break
    if (Date.now() > bootDeadline) {
      console.error('TIMED OUT waiting for both rows. Last measurement:')
      console.error(raw)
      process.exit(1)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }

  console.log(measured ? JSON.stringify(measured, null, 2) : '(no measurement)')
} finally {
  cdp?.close()
  if (!process.argv.includes('--keep-open')) {
    edge.kill()
    await new Promise((r) => setTimeout(r, 500))
    try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}
