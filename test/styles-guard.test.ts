/**
 * Guard: the panel stylesheet is a JS template literal, so a backtick anywhere
 * inside it terminates the string early and produces a syntax error whose
 * reported line points at the CSS, not at the real cause. That failure has
 * already happened twice while editing comments, so it is checked mechanically.
 *
 * Run by `npm test`; fails loudly with the offending line.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('styles.ts template literal', () => {
  it('contains no backtick inside the PANEL_CSS payload', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/client/styles.ts'), 'utf8')
    const marker = 'export const PANEL_CSS = `'
    const start = source.indexOf(marker)
    expect(start, 'PANEL_CSS declaration not found — did the export change?').toBeGreaterThan(-1)

    const rest = source.slice(start + marker.length)
    const end = rest.indexOf('`')
    expect(end, 'PANEL_CSS is not terminated').toBeGreaterThan(-1)
    const css = rest.slice(0, end)

    const offenders = css
      .split('\n')
      .map((line, index) => ({ index: index + 1, line }))
      .filter(entry => entry.line.includes('`'))

    expect(offenders.map(entry => `${entry.index}: ${entry.line.trim()}`)).toEqual([])
    // Also make sure something real is in there, so the check cannot pass on an
    // empty payload after a bad edit.
    expect(css).toMatch(/\.dbm-root\s*\{/)
  })
})
