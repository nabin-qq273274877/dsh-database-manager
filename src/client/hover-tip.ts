/**
 * Placement of the panel's hover tooltip.
 *
 * A module of its own, with no React and no DOM, because placement is the part with rules worth
 * pinning: the box belongs beside the anchor's row (under the cell it would cover the next row,
 * which is the row the user is reading), and it has to be pulled back inside the window at the
 * right edge. Both mistakes still render SOMETHING, so neither is caught by a test that only
 * asserts that a box appeared — hence the rules live here, where a plain Node test can reach them.
 *
 * The hook that uses this lives in `ui.ts`, which imports React and therefore cannot be imported
 * by a test in this checkout: the browser half keeps React external, supplied by the shell.
 */

/** The width past which a tooltip wraps instead of growing. */
export const TIP_MAX_WIDTH = 340

/**
 * Where the hover box goes, for one anchored cell.
 *
 * The rules, each of which was a decision:
 *
 *  - **Beside the anchor, not under it.** A table row is ~38px tall, so a box below the cell
 *    covers the next row. Beside it, the box reads as belonging to the cell it describes.
 *  - **Centred on the anchor's row**, whatever the box's own height turns out to be — the caller
 *    applies `translateY(-50%)`, since the height is only known after layout. A row that is
 *    already on screen therefore cannot push the box off the bottom.
 *  - **Pulled back inside the window** when the anchor sits near the right edge, where the box
 *    would otherwise hang off screen. Measured on the 结构 tab: the name column starts at x=602,
 *    so the box lands at x=709 for every row; only a column at the right edge ever moves. The
 *    fallback CLAMPS rather than just stepping back to the anchor's left edge — a cell at
 *    x=1500 would still push a 340px box past a 1680px window, and a tooltip half off screen is
 *    the failure this file exists to prevent.
 *
 * @param anchor - the hovered element's bounding rect (any object with these four numbers).
 * @param viewport - the window's inner size; passed in rather than read, so this is testable.
 * @returns the box's left edge and centre-y, in viewport coordinates.
 */
export function hoverTipPosition(
  anchor: { left: number; right: number; top: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const width = Math.min(TIP_MAX_WIDTH, viewport.width - 16)
  const beside = anchor.right + 8
  // The rightmost left edge at which a box of `width` still clears the window's margin.
  const limit = Math.max(8, viewport.width - width - 12)
  return {
    x: beside <= limit ? beside : Math.max(8, Math.min(anchor.left + 8, limit)),
    y: anchor.top + anchor.height / 2,
  }
}
