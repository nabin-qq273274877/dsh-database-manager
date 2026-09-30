/**
 * Where the panel's hover tooltip is placed.
 *
 * The box exists because the browser's own `title` produced nothing in the desktop app
 * (reported: 结构页鼠标放在字段名上不显示注释 — the attribute was on the cell and the text was in
 * the DOM), so the placement is now the panel's responsibility. That makes it worth pinning:
 * a box that lands under the cell covers the next row's data, and one that hangs off the right
 * edge is unreadable — neither throws, so neither would be noticed by a test that only checks
 * that SOMETHING rendered.
 *
 * The function lives in `hover-tip.ts` rather than beside the hook: `ui.ts` imports React, which
 * this checkout keeps external for the browser half, so a test cannot load it at all. The module
 * is pure and takes the viewport as an argument, so this runs in plain Node with no jsdom.
 */

import { describe, expect, it } from 'vitest'
import { hoverTipPosition } from '../src/client/hover-tip.ts'

/** A 1680×1050 window, the size the panel was measured in. */
const VIEWPORT = { width: 1680, height: 1050 }

/** The 结构 tab's name cell as measured: 99px wide, starting at x=602, rows 38px tall. */
function nameCell(top: number, left = 602): { left: number; right: number; top: number; height: number } {
  return { left, right: left + 99, top, height: 38 }
}

describe('hoverTipPosition', () => {
  it('places the box beside the anchor, centred on its row', () => {
    const { x, y } = hoverTipPosition(nameCell(236), VIEWPORT)
    // 8px past the cell's right edge…
    expect(x).toBe(701 + 8)
    // …and at the row's vertical centre, so the caller's translateY(-50%) lines them up.
    expect(y).toBe(236 + 19)
  })

  it('never places the box under the anchor, where it would cover the next row', () => {
    const first = hoverTipPosition(nameCell(236), VIEWPORT)
    const second = hoverTipPosition(nameCell(274), VIEWPORT)
    // The two rows' boxes must not overlap: each belongs to its own row.
    expect(second.y - first.y).toBeGreaterThanOrEqual(38)
  })

  it('pulls the box back inside the window when the anchor is at the right edge', () => {
    const { x } = hoverTipPosition({ left: 1500, right: 1599, top: 100, height: 38 }, VIEWPORT)
    // 1599 + 8 would end at 1947, past the window, and so would 1500 + 8 (1848), so the box is
    // clamped to the rightmost position that fits: 1680 - 340 - 12 = 1328.
    expect(x).toBe(1328)
    expect(x + 340).toBeLessThanOrEqual(VIEWPORT.width - 12)
  })

  it('keeps a box on a narrow window inside it too, by wrapping rather than overflowing', () => {
    const narrow = { width: 320, height: 800 }
    const { x } = hoverTipPosition({ left: 10, right: 60, top: 40, height: 30 }, narrow)
    // 320 - 304 - 12 = 4 is below the 8px floor, so the floor wins — still on screen.
    expect(x).toBe(8)
    expect(x + 304).toBeLessThanOrEqual(narrow.width)
  })

  it('follows the anchor down the list, so every row gets its own position', () => {
    const tops = [236, 274, 312, 848]
    const ys = tops.map(top => hoverTipPosition(nameCell(top), VIEWPORT).y)
    expect(ys).toEqual(tops.map(top => top + 19))
  })
})
