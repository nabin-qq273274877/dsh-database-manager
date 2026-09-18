/**
 * Panel stylesheet. Every colour comes from a harness theme token so the panel
 * follows the active light/dark palette instead of pinning its own.
 */

export const PANEL_CSS = `
/*
 * The panel's outer shell. It exists only to stack an optional error banner
 * above the active screen, which owns the real .dbm-root column — nesting two
 * 100%-height flex columns doubled the layout, so this one stays a plain
 * full-height box.
 */
.dbm-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.dbm-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}

/* ---- sidebar entry glyph ------------------------------------------------ */
/*
 * The shell lays this row out with padding 7px 8px and gap 8px, while the SSH
 * plugin's own injected row uses padding 0 10px and gap 10px around a 24px icon
 * box. Measured in a real browser, the shell's row started its glyph 5px left of
 * SSH's and 8px left of its label. This box adopts SSH's 24px geometry and adds
 * the 2px per side the shell's smaller padding lacks, so the glyph and the label
 * both land on the same x as the SSH entry.
 */
.dbm-entry-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  margin: 0 2px;
  flex: none;
}
.dbm-entry-glyph > svg { display: block; }

/* ---- header ------------------------------------------------------------ */
/*
 * Deliberately close to the SSH panel's header (its .panelHeader/.panelTitle):
 * horizontal padding 14px and a 15-16px bold title, so the two panels read as
 * the same product rather than two different takes on a header.
 */
.dbm-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  flex: none;
}
.dbm-title { font-size: 16px; font-weight: 700; }
.dbm-subtitle { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dbm-spacer { flex: 1; }

/* The back control: a quiet outlined button, matching dsh-ssh's ghost button. */
.dbm-back { padding: 5px 12px; font-size: 12px; }
.dbm-btn-ghost {
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l3));
  color: var(--dsw-alias-label-primary);
}
.dbm-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }

/* ---- controls ---------------------------------------------------------- */
.dbm-btn {
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-button-elevated-fill);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  white-space: nowrap;
}
/*
 * Hover states are written per-variant, never on the base class.
 *
 * A base .dbm-btn:hover:not(:disabled) rule scores (0,3,0) and therefore beats
 * a plain .dbm-btn-primary (0,1,0) on background — which made the primary
 * button swap to the light hover fill while keeping its inverted (white) text,
 * i.e. it vanished on hover. Keeping each variant's background in a rule of
 * matching specificity removes that trap.
 */
.dbm-btn:disabled { opacity: .5; cursor: default; }
.dbm-btn-primary {
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-label-primary-inverted);
  border-color: transparent;
}
.dbm-btn:hover:not(:disabled):not(.dbm-btn-primary) { background: var(--dsw-alias-button-floating-hover); }
.dbm-btn-primary:hover:not(:disabled) { filter: brightness(1.15); }
.dbm-btn-danger { color: var(--dsw-alias-label-danger, #d33); }
.dbm-btn-sm { padding: 3px 8px; font-size: 12px; border-radius: 6px; }

.dbm-input, .dbm-select, .dbm-textarea {
  font: inherit;
  padding: 5px 9px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  min-width: 0;
}
.dbm-input:focus, .dbm-select:focus, .dbm-textarea:focus {
  outline: 2px solid var(--dsw-alias-label-primary);
  outline-offset: -1px;
}
.dbm-textarea { font-family: var(--ds-font-family-code); resize: vertical; }
.dbm-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.dbm-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dbm-label > span { font-weight: 500; }

/* ---- toolbar (search / group / new) ----------------------------------- */
.dbm-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  flex: none;
  flex-wrap: wrap;
}
.dbm-toolbar .dbm-input { width: 220px; }

/* ---- table ------------------------------------------------------------- */
.dbm-scroll { flex: 1; min-height: 0; overflow: auto; }
.dbm-table { width: 100%; border-collapse: collapse; }
.dbm-table th, .dbm-table td {
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  white-space: nowrap;
}
.dbm-table th {
  position: sticky;
  top: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  font-weight: 500;
  z-index: 1;
}
.dbm-table tbody tr:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dbm-table td.dbm-mono, .dbm-mono { font-family: var(--ds-font-family-code); font-size: 12px; }
.dbm-empty {
  padding: 36px 16px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
}
.dbm-actions { display: flex; gap: 4px; }
.dbm-link {
  font: inherit;
  background: none;
  border: none;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  text-decoration: underline;
  text-decoration-color: var(--dsw-alias-border-l3);
}
.dbm-link:hover { background: var(--dsw-alias-interactive-bg-hover); }

/* ---- badges ------------------------------------------------------------ */
.dbm-badge {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
}
.dbm-badge-sqlite { color: #2b7bbb; border-color: #2b7bbb55; }
.dbm-badge-mysql { color: #c1720a; border-color: #c1720a55; }
.dbm-badge-redis { color: #c13535; border-color: #c1353555; }
.dbm-badge-ok { color: #1a8a4a; border-color: #1a8a4a55; }
.dbm-badge-err { color: var(--dsw-alias-label-danger, #d33); border-color: currentColor; }
.dbm-tags { display: inline-flex; gap: 4px; flex-wrap: wrap; }

/* ---- database panel: tree + content ----------------------------------- */
.dbm-split { display: flex; flex: 1; min-height: 0; }
.dbm-side {
  width: 280px;
  flex: none;
  border-right: 1px solid var(--dsw-alias-border-l3);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.dbm-side-head {
  padding: 8px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  display: flex;
  gap: 6px;
  align-items: center;
  flex: none;
}
.dbm-side-body { flex: 1; min-height: 0; overflow: auto; padding: 4px 0; }
.dbm-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }

/* ---- tree rows --------------------------------------------------------- */
/*
 * box-sizing: border-box is load-bearing here, not stylistic.
 *
 * The row is width:100% with 10px of horizontal padding, and the sidebar's body
 * is overflow:auto. Under the default content-box the padding was ADDED to the
 * 100%, so each row measured 20px wider than its container: measured, the body's
 * clientWidth was 280 while its scrollWidth was 300. The right-hand number — which
 * sits at the row's trailing edge — was therefore pushed into the 20px-wide strip
 * that overflow:auto clips, so its last characters were cut off. Every row was
 * affected; the number was simply the only thing whose value sat flush against
 * that edge.
 *
 * The Redis tree's rows already set this (dbm-tree-node), which is why only this
 * tree showed the clipping.
 */
.dbm-tree-item {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  cursor: pointer;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  width: 100%;
  text-align: left;
}
.dbm-tree-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dbm-tree-item[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-active);
  font-weight: 500;
}
.dbm-tree-indent-1 { padding-left: 24px; }
.dbm-tree-indent-2 { padding-left: 40px; }
.dbm-tree-caret {
  width: 14px;
  display: inline-flex;
  justify-content: center;
  color: var(--dsw-alias-label-secondary);
  flex: none;
}
/*
 * The name takes the space left over and gives it back when the row is narrow.
 *
 * flex:1 with min-width:0 is what makes the ellipsis actually happen: a flex
 * item's default min-width:auto refuses to shrink below its content, so a long
 * table name pushed the trailing count out of the row instead of being truncated.
 */
.dbm-tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
/*
 * The trailing number never shrinks and never wraps.
 *
 * flex:none because it is the one thing in the row whose full value is always
 * needed — a truncated count is worse than a truncated name. Tabular figures keep
 * it a fixed width, so a row does not shift as the number changes.
 */
.dbm-tree-item .dbm-tree-meta {
  flex: none;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/*
 * The caret and the label on a database row.
 *
 * The row is now a div with a caret button inside it (see the component for
 * why), so the label is a plain span carrying the ellipsis and the caret is
 * stripped back to its glyph — the row itself owns the hover and active
 * backgrounds, and a control that painted its own would break that up.
 *
 * The caret gets a wider hit area than its 14px glyph because a small triangle
 * is fiddly to hit. Stretching it to the row's full height keeps it reachable
 * without aiming at the baseline.
 */
.dbm-caret-btn {
  font: inherit;
  border: none;
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  padding: 0;
  width: 16px;
  flex: none;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  align-self: stretch;
}
.dbm-caret-btn:hover { color: var(--dsw-alias-label-primary); }
.dbm-node-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.dbm-tree-meta { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 11px; }

/* ---- Redis key tree ----------------------------------------------------- */
/*
 * The Redis tree has more levels than the SQL one (database > folder > … > key)
 * and its rows carry hover controls, so it does not reuse .dbm-tree-item. The
 * rows are divs rather than buttons because a row can contain buttons, and a
 * button inside a button is invalid HTML that browsers re-parent in surprising
 * ways.
 */
.dbm-tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  cursor: pointer;
  color: inherit;
  font: inherit;
  width: 100%;
  text-align: left;
  box-sizing: border-box;
}
.dbm-tree-node:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dbm-tree-node[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-active);
  font-weight: 500;
}
/*
 * One indent step per tree depth, applied by class rather than inline style so
 * the whole ladder is visible in one place. Depth is capped at 6 in the
 * component: a 12-segment key name would otherwise indent past the panel.
 */
.dbm-tree-depth-1 { padding-left: 24px; }
.dbm-tree-depth-2 { padding-left: 40px; }
.dbm-tree-depth-3 { padding-left: 56px; }
.dbm-tree-depth-4 { padding-left: 72px; }
.dbm-tree-depth-5 { padding-left: 88px; }
.dbm-tree-depth-6 { padding-left: 104px; }
.dbm-tree-glyph { flex: none; width: 16px; text-align: center; font-size: 12px; }
.dbm-tree-hint { padding-top: 3px; padding-bottom: 3px; }

/*
 * Row actions appear on hover (and on keyboard focus, so they are reachable
 * without a mouse). Always-visible controls turned the tree into a wall of
 * icons; hidden ones with no focus path would make the feature mouse-only.
 */
.dbm-tree-actions {
  margin-left: auto;
  display: none;
  align-items: center;
  gap: 2px;
  flex: none;
}
.dbm-tree-node:hover > .dbm-tree-actions,
.dbm-tree-node:focus-within > .dbm-tree-actions { display: inline-flex; }
/* With actions shown, the count must not also claim the auto margin. */
.dbm-tree-node:hover > .dbm-tree-meta,
.dbm-tree-node:focus-within > .dbm-tree-meta { margin-left: 0; }

.dbm-icon-btn {
  font: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 2px 5px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 6px;
  background: var(--dsw-alias-button-elevated-fill);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dbm-icon-btn:hover { background: var(--dsw-alias-button-floating-hover); color: var(--dsw-alias-label-primary); }
.dbm-icon-btn-danger:hover { color: var(--dsw-alias-label-danger, #d33); border-color: currentColor; }

/* ---- keyspace index progress ------------------------------------------- */
/*
 * A progress banner for a running keyspace walk, with a thin bar under it.
 *
 * It deliberately does NOT reuse .dbm-ok. That class means "the operation
 * succeeded" and carries display: block; the banner used to wear both, and
 * since the two selectors have identical specificity (0,1,0) .dbm-ok won on
 * source order. The measured result was display: block — so gap did nothing,
 * and the bar below was an inline span, where height is ignored. It then took
 * its 16px line box instead of the 3px it asks for and hung ~10px past the
 * banner's bottom edge, over the tree below it. An own class with its own
 * layout removes the dependence on which rule happens to come last.
 *
 * flex: none keeps the banner's height when the tree underneath grows, the
 * same way the header and the other banners are held at their natural size.
 *
 * The percentage is real work done (keys visited over the database's size), which
 * is what makes a minute-long index build on a huge database legible instead of
 * looking frozen. The bar is decorative — the sentence carries the same numbers —
 * so it is hidden from assistive tech rather than announced twice.
 */
.dbm-index-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 14px;
  font-size: 12px;
  color: #1a8a4a;
  flex: none;
}

.dbm-index-bar {
  /* height only applies to a block box; as an inline span this was ignored. */
  display: block;
  height: 3px;
  border-radius: 2px;
  background: var(--dsw-alias-interactive-bg-hover);
  overflow: hidden;
}

.dbm-index-fill {
  display: block;
  height: 100%;
  background: var(--dsw-alias-brand-primary, #4c8bf5);
  transition: width .3s ease;
}

/* ---- search results ---------------------------------------------------- */
/*
 * The search header states the scope (which database) and the pattern, because
 * the results replace the tree: without it, a flat list of keys gives no clue
 * that it came from db3 rather than the db the user was just browsing.
 */
.dbm-search-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-interactive-bg-hover);
  word-break: break-all;
}

/* ---- busy / refresh feedback ------------------------------------------- */
/*
 * Rows kept on screen while their level is re-fetched.
 *
 * Dimmed rather than replaced: after a create or a delete the existing rows are
 * still the best information available, and blanking them would collapse the
 * tree and lose the user's place. The dimming is what distinguishes "current"
 * from "about to change", which was missing while a write appeared to do
 * nothing for a moment.
 *
 * pointer-events is set to none because a row being reloaded may no longer
 * exist on the server — acting on it would target a stale key. The container's
 * own controls stay usable.
 */
.dbm-tree-stale {
  opacity: .5;
  pointer-events: none;
}

/*
 * An indeterminate spinner. Sized in em so it sits on the baseline of whatever
 * row it replaces (the key count, the ⟳ glyph) without shifting the layout.
 */
.dbm-spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid var(--dsw-alias-border-l3);
  border-top-color: var(--dsw-alias-label-secondary);
  border-radius: 50%;
  animation: dbm-spin .7s linear infinite;
}
@keyframes dbm-spin {
  to { transform: rotate(360deg); }
}
/*
 * A spinner that cannot be seen moving is just a strange dot, so when motion is
 * unwelcome it becomes a pulse instead — still clearly "working", never moving.
 */
@media (prefers-reduced-motion: reduce) {
  .dbm-spinner { animation: dbm-pulse 1.2s ease-in-out infinite; }
  @keyframes dbm-pulse {
    0%, 100% { opacity: .35; }
    50% { opacity: 1; }
  }
}
/* A control that is busy keeps its width, so the header does not jitter. */
.dbm-btn-busy { cursor: progress; }

/* ---- tabs -------------------------------------------------------------- */
.dbm-tabs {
  display: flex;
  gap: 2px;
  padding: 6px 10px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  flex: none;
  flex-wrap: wrap;
}
.dbm-tab {
  font: inherit;
  padding: 6px 12px;
  border: none;
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  border-bottom: 2px solid transparent;
}
.dbm-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dbm-tab[data-active="true"] {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
  border-bottom-color: var(--dsw-alias-label-primary);
}
.dbm-tab-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.dbm-pad { padding: 10px 14px; display: flex; flex-direction: column; gap: 10px; }
.dbm-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dbm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.dbm-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }

/*
 * ---- the insert form (phpMyAdmin-shaped) -------------------------------
 *
 * ONE COLUMN PER ROW: the column name in a fixed left track, its control
 * filling everything to the right. That is the shape phpMyAdmin's insert page
 * has, and it is what makes a wide table readable — a card grid puts the fields
 * in an order that depends on the viewport width, so which control follows which
 * changes when the window is resized.
 *
 * The name track is a FIXED length rather than max-content: max-content is
 * resolved per row, so a short name and a long one would put their controls at
 * different x positions. One width for every row is what makes the controls line
 * up as a column, which is the whole reason the two-track layout exists.
 *
 * 280px fits the longest realistic name cell on one line: at 240px measured, the
 * DEFAULT note on "ordered_at · TEXT NOT NULL · 默认：datetime('now')" wrapped to a
 * second line, making that row twice as tall as its neighbours and reading as a
 * broken table. The control loses 40px, which the 560px cap above makes free.
 */
.dbm-insert-form {
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dbm-insert-grid {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 6px 12px;
  align-items: center;
}
/*
 * The name cell: name and type on ONE line, wrapping only when the pair is too
 * long for the track. No overflow-wrap:anywhere — breaking mid-identifier turns
 * "ordered_at" into "ordered_" / "at", which is unreadable and which the wider
 * track above is what avoids.
 */
.dbm-insert-name {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 6px;
  font-weight: 500;
  font-size: 12px;
  min-width: 0;
}
.dbm-insert-name > .dbm-hint { font-weight: 400; }
/*
 * The control and its tick boxes share the right-hand cell, control first.
 *
 * The control is capped rather than stretched: a 1000px-wide text box beside a
 * 48px label is the shape of a form nobody reads, and the cap is also what keeps
 * the NULL box near the box it applies to instead of at the far end of the row.
 * The cap is a max-width, so a narrow panel still shrinks the control with it.
 */
.dbm-insert-value { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dbm-insert-value > .dbm-input,
.dbm-insert-value > .dbm-select,
.dbm-insert-value > .dbm-textarea { flex: 1 1 auto; min-width: 0; max-width: 560px; }
.dbm-insert-value > .dbm-check { flex: none; white-space: nowrap; }
/*
 * Below the width where a 240px name track leaves a usable control, the name
 * goes ABOVE its control instead of beside it. The single track keeps the form
 * usable on a narrow panel rather than squeezing a date picker into 80px.
 */
@media (max-width: 720px) {
  .dbm-insert-grid { grid-template-columns: minmax(0, 1fr); }
  .dbm-insert-value { align-items: flex-start; }
}
.dbm-error {
  color: var(--dsw-alias-label-danger, #d33);
  background: color-mix(in srgb, currentColor 8%, transparent);
  border: 1px solid currentColor;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---- data grid --------------------------------------------------------- */
.dbm-data { flex: 1; min-height: 0; overflow: auto; }
.dbm-data table { border-collapse: collapse; font-size: 12px; }
.dbm-data th, .dbm-data td {
  border: 1px solid var(--dsw-alias-border-l3);
  padding: 4px 8px;
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ds-font-family-code);
}
.dbm-data th {
  position: sticky;
  top: 0;
  background: var(--dsw-alias-bg-base);
  z-index: 1;
  font-family: inherit;
  font-weight: 500;
}
.dbm-data th button {
  font: inherit;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
}
/*
 * The multi-select checkbox column. It is narrow, it does not sort, and it has to
 * stay put while the rest of the row scrolls sideways — so it is sticky on the
 * left, the mirror of the sticky header row.
 */
.dbm-data th.dbm-select-col, .dbm-data td.dbm-select-col {
  width: 30px;
  max-width: 30px;
  padding: 4px 6px;
  text-align: center;
  position: sticky;
  left: 0;
  background: var(--dsw-alias-bg-base);
}
.dbm-data td.dbm-select-col { z-index: 0; }
.dbm-data th.dbm-select-col { z-index: 2; }
/* The row controls: edit / copy / delete, revealed on hover like the tree's. */
/*
 * The actions column is pinned to the RIGHT edge of the viewport.
 *
 * The grid scrolls horizontally on a wide table, and the actions sat at the end
 * of the row — so reaching them meant scrolling all the way right, then losing the
 * row's identity off the left edge. Pinning the column keeps "which row" and "what
 * can I do to it" on screen together, which is the same reason the select column
 * is pinned left.
 *
 * 'right: 0' plus a background is what makes a sticky cell work: without an opaque
 * background the scrolled columns show through it.
 */
.dbm-data th.dbm-row-actions, .dbm-data td.dbm-row-actions {
  white-space: nowrap;
  width: 1%;
  position: sticky;
  right: 0;
  background: var(--dsw-alias-bg-base);
}
/* The header row's own sticky cells need to sit above the body's. */
.dbm-data th.dbm-row-actions { z-index: 2; }
.dbm-data td.dbm-row-actions { z-index: 1; }
/* A selected row's tint must show through its pinned cells, so they inherit it. */
.dbm-data tr[data-selected="true"] > td.dbm-row-actions {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8bf5) 14%, var(--dsw-alias-bg-base));
}
/* A divider, because the pinned column floats over the columns it covers. */
.dbm-data td.dbm-row-actions, .dbm-data th.dbm-row-actions {
  border-left: 1px solid var(--dsw-alias-border-l3);
}
.dbm-row-action {
  font: inherit;
  font-size: 11px;
  padding: 1px 6px;
  margin-right: 3px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 5px;
  background: var(--dsw-alias-button-elevated-fill);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dbm-row-action:hover { background: var(--dsw-alias-button-floating-hover); color: var(--dsw-alias-label-primary); }
.dbm-row-action-danger:hover { color: var(--dsw-alias-label-danger, #d33); border-color: currentColor; }
/*
 * A row selected for a batch action. Kept visibly distinct from the hover tint,
 * because "these are the rows that will be deleted" is a different claim from
 * "the pointer is here".
 */
.dbm-data tr[data-selected="true"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8bf5) 14%, transparent); }
.dbm-data tr[data-selected="true"]:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8bf5) 20%, transparent); }
/*
 * The sort indicator.
 *
 * Sized in font-size 8px rather than left at the inherited 12px: at the header's
 * own size the triangles were visually as loud as the column name, which reads as
 * if the arrow were the label. The 4px left margin is what keeps them from
 * touching the last letter.
 */
.dbm-sort-mark {
  font-size: 8px;
  margin-left: 4px;
  color: var(--dsw-alias-label-secondary);
  vertical-align: 1px;
}
.dbm-data th .dbm-sort-mark { color: var(--dsw-alias-label-primary); }
/*
 * A cell being edited in place.
 *
 * The editor fills the cell rather than sitting inside it, so the row keeps its
 * height and the grid does not jump when a value is double-clicked.
 */
.dbm-cell-input {
  font: inherit;
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  box-sizing: border-box;
  width: 100%;
  min-width: 90px;
  padding: 2px 5px;
  border: 1px solid var(--dsw-alias-label-primary);
  border-radius: 4px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
/* The cell is a double-click target, which has to be discoverable. */
.dbm-cell-editable { cursor: text; }
.dbm-cell-editable:hover { outline: 1px dashed var(--dsw-alias-border-l3); outline-offset: -2px; }
/*
 * The in-cell editor is a one-row TEXTAREA (see SqlBrowseTab for why), so its own
 * chrome has to be taken off for it to sit in a cell like an input did.
 *
 * 'resize: vertical' only: the point is a taller view of a long value, and
 * horizontal resizing inside a table cell would fight the column widths. No
 * wrapping, so a long value stays one line until the user grows the box.
 */
textarea.dbm-cell-input {
  resize: vertical;
  white-space: pre;
  line-height: 1.4;
  overflow-x: auto;
  overflow-y: hidden;
  min-height: 22px;
  /* The default textarea font is monospace-ish and small; keep the grid's. */
  font-family: var(--ds-font-family-code);
  font-size: 12px;
}
/*
 * A grown editor must be able to show its resize handle.
 *
 * The cells set 'overflow: hidden' for the ellipsis, which would clip the handle
 * at the box's bottom-right corner. Scoped with ':has()' so only the cell
 * actually holding an editor loses its clipping.
 */
.dbm-data td:has(> textarea.dbm-cell-input) { overflow: visible; }
.dbm-cell-saving { opacity: .6; }
.dbm-cell-failed { color: var(--dsw-alias-label-danger, #d33); font-style: normal; }
.dbm-null { color: var(--dsw-alias-label-secondary); font-style: italic; }
/*
 * The value editor puts inputs inside the data grid. They must fill the cell
 * rather than sit in it, so an editable row reads as a table row and not as a
 * form dropped into a column.
 */
.dbm-data input.dbm-input {
  box-sizing: border-box;
  border-radius: 6px;
  padding: 3px 7px;
}
/* An edited-but-unsaved cell is called out, so 保存 is never a guess. */
.dbm-dirty { color: #c1720a; }

/*
 * The batch-action bar. It appears above the grid only while rows are selected,
 * so the grid does not permanently lose a row of height to controls that are
 * usually inapplicable — and its appearance is itself the feedback that a
 * selection is active.
 */
.dbm-batch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8bf5) 12%, transparent);
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  flex: none;
  font-size: 12px;
  flex-wrap: wrap;
}

/*
 * A structure editor row: a column being added or changed, laid out as one line
 * of fields. Wrapping is enabled because the type list plus the flags do not fit
 * a narrow panel, and a horizontal scrollbar inside a table row is worse than a
 * second line.
 */
/*
 * A stacked form field: label above its control, hint below.
 *
 * Replaces the one-line arrangement the column and index forms used, which wrapped
 * at the panel's real width and left the reader unable to pair a label with its box.
 */
.dbm-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.dbm-field-label { font-weight: 500; font-size: 12px; }
.dbm-field > .dbm-input, .dbm-field > .dbm-select { width: 100%; box-sizing: border-box; }

/*
 * The column picker in the index dialog.
 *
 * A bordered, scrollable list in the table's own column order. A checked row shows
 * its position, because the TICK order is the index's column order — a prefix of
 * that order is what the index can serve, so the sequence must be visible rather
 * than implied by which boxes happen to be ticked.
 */
.dbm-column-picker {
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
  max-height: 260px;
  overflow: auto;
  padding: 6px 8px;
}
.dbm-column-picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 3px 2px;
}
.dbm-column-order {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 50%;
  font-size: 11px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
/* A checked row marks its position, so the tick order is legible. */
.dbm-column-picker-row input[type="checkbox"]:checked ~ .dbm-column-order {
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-label-primary-inverted);
}

/*
 * A separator between groups of batch actions, so "export/empty" and the four
 * maintenance statements do not read as one undifferentiated run of buttons.
 */
.dbm-batch-sep {
  width: 1px;
  height: 18px;
  background: var(--dsw-alias-border-l3);
  flex: none;
}

/* The select checkbox column of the table list: narrow and centred. */
.dbm-table-select-col { width: 30px; text-align: center; }
/* The table list needs the batch bar's wrap behaviour, since it carries more. */
.dbm-batch-bar { row-gap: 6px; }

/*
 * The maintenance report: one block per table, each with its own verdict and the
 * engine's message lines underneath. Scrollable, because a run can cover many
 * tables and the dialog must stay usable.
 */
.dbm-maint-report {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 45vh;
  overflow: auto;
  margin-top: 8px;
}
.dbm-maint-entry {
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
  padding: 6px 8px;
}
.dbm-maint-entry > .dbm-row { gap: 8px; }
/* A long engine message must wrap rather than widen the dialog. */
.dbm-maint-entry .dbm-hint { word-break: break-word; }

/*
 * The table-level fields: label on the LEFT, control on the RIGHT, ALL FOUR on one row.
 *
 * Reported before: 表名's input was too long and the fields were laid out inconsistently (a
 * full-width input, then labels ABOVE controls in a wrapping flex row). One grid replaced both.
 *
 * The column count is adaptive rather than fixed at two: asked for as "上面表名等4个放一行",
 * because a two-column grid left the four fields as two short rows with an empty stretch beside
 * each control. auto-fit gives four columns at this dialog's own width; the two media queries
 * below take it down to a balanced 2x2 and then to one column as the window narrows, instead of
 * letting auto-fit produce an orphan row.
 *
 * Each field is still label-left/control-right with a FIXED label track, so the controls inside a
 * column are the same width and every label starts at the same x.
 */
.dbm-grid2 {
  display: grid;
  /*
   * 240px is the floor a field may shrink to: the 104px label track, the 8px gap, and ~128px of
   * control. Below that the collation dropdown cannot show a name like utf8mb4_unicode_ci.
   */
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 8px 20px;
  align-items: center;
  /*
   * Reserve the scrollbar's width on BOTH columns.
   *
   * The body scrolls vertically, and without this the scrollbar takes its width from the
   * right-hand column only — measured as a 6px difference between the two columns'
   * controls, which reads as misalignment. The stable value keeps the two columns equal
   * whether or not a scrollbar is present.
   */
  scrollbar-gutter: stable;
}
/*
 * Each field is its own two-part row inside the grid cell.
 *
 * The label track is a FIXED width, not max-content: max-content is resolved per row, so
 * a short label ("存储引擎") and a long one ("整理（排序规则）") put their controls at
 * different x positions — measured 884 vs 890, a visible misalignment of the very thing
 * that was supposed to line up. One width for every row is what makes the controls
 * align, and it is why the value is a length rather than a fit.
 *
 * 104px is set by the LONGEST label in this grid, "整理（排序规则）" — eight characters at
 * 12px is ~96px, so anything narrower ellipsises the very label the track exists to align.
 * Nothing narrower is available without shrinking the controls the four-across row already
 * made tight, which is the trade this width is chosen against.
 */
.dbm-grid-row {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.dbm-grid-label {
  font-weight: 500;
  font-size: 12px;
  /*
   * LEFT-aligned, so the labels read as a column of their own and each one starts at the same
   * x as the 字段 table's header above it. Right-alignment put every label's START at a
   * different x, which looked ragged next to the left-aligned header and the left-aligned
   * 字段名 below — reported as "上面的表名、存储引擎等 label 左对齐".
   *
   * The track width above stays FIXED, so the controls' left edges still line up: alignment of
   * the labels was the complaint, not the alignment of the controls.
   */
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* The control fills its cell, so widths are uniform rather than content-driven. */
.dbm-grid-control { width: 100%; min-width: 0; box-sizing: border-box; }
.dbm-check-group { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
/*
 * Below the width where four tracks still fit, go straight to TWO columns.
 *
 * auto-fit alone produced an ORPHAN row here — measured at a 1000px and 900px viewport, three
 * fields on one row and the fourth alone below — because 928px of content holds three 240px
 * tracks but not four. A balanced 2x2 reads as a deliberate grid; 3+1 reads as a mistake.
 *
 * The breakpoint is where four tracks stop fitting: the dialog is min(1180px, 96vw), so its content
 * box reaches 4 x 240 = 960px only from roughly 1040px of viewport. Verified per width afterwards:
 * 1600px and 1200px give 4 across, 1000px and 900px give 2x2, 800px and 600px stay 2x2.
 */
@media (max-width: 1040px) {
  .dbm-grid2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
/*
 * One column once two get too narrow to hold a 104px label AND a readable control.
 *
 * At a 560px viewport two columns leave each control ~110px, which is the point where the
 * collation dropdown can no longer show a value — the same floor the 240px track encodes.
 */
@media (max-width: 620px) {
  .dbm-grid2 { grid-template-columns: minmax(0, 1fr); }
}
/*
 * The rule between the table-level fields and the column list.
 *
 * Asked for as "下面加一条线和下面的字段表格隔开": the four fields and the 字段 grid are two
 * different subjects — the table's own options, then its columns — and without a rule the
 * 字段 header read as a fifth label of the same block. A plain border-top on an empty div rather
 * than an hr element, so it uses the theme's border token and takes no default browser styling.
 *
 * The bottom margin is the larger one because the rule now also does the job the removed 字段
 * heading did — introducing the block below — so it needs air beneath it rather than sitting flush
 * on the header row. Measured before this: the header started 2px under the rule, which read as the
 * rule being underlined by the table.
 *
 * These margins are what sets the spacing at all: .dbm-modal-body's gap applies only between
 * its DIRECT children, and this rule is a sibling of .dbm-field inside an inner div — so the gap
 * contributes nothing here and the value below is the whole distance.
 */
.dbm-newtable-sep {
  border-top: 1px solid var(--dsw-alias-border-l3);
  margin: 2px 0 8px;
}

/*
 * The type cell swaps between a dropdown and a text field in place.
 *
 * A separate "custom type" column would have widened a form whose width was the
 * complaint, so the custom field replaces the dropdown in the same cell, with a small
 * button back to the list (otherwise choosing 自定义 is one-way).
 */
.dbm-type-cell { display: flex; gap: 4px; align-items: center; min-width: 0; }
.dbm-type-cell .dbm-input { flex: 1 1 auto; min-width: 0; }
.dbm-type-cell .dbm-btn { flex: none; padding: 2px 6px; }

/*
 * The 自增 cell: the checkbox plus, when the combination is impossible, the reason.
 *
 * The reason used to be a title attribute only, which a user does not see without
 * a DISABLED input does not reliably show one at all, so the control appeared inert with
 * no explanation. It is now text, wrapped under the checkbox.
 */
.dbm-auto-cell { min-width: 0; }
.dbm-auto-hint {
  margin-top: 2px;
  font-size: 10px;
  line-height: 1.3;
  /* The column is narrow; let a long reason wrap instead of forcing the table wider. */
  white-space: normal;
  word-break: break-word;
}

/* A column that is part of the primary key, called out in the structure table. */
.dbm-key-note { color: var(--dsw-alias-label-secondary); font-size: 11px; }

/*
 * The TTL countdown. Tabular figures so a ticking number does not make the row
 * jitter as digits change width, and the code font so it reads as a value rather
 * than as prose.
 */
.dbm-countdown {
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}
.dbm-pager {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-top: 1px solid var(--dsw-alias-border-l3);
  flex: none;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

/* ---- modal ------------------------------------------------------------- */
.dbm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, .35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
}
.dbm-modal {
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 12px;
  width: min(560px, 92vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, .3);
}

/*
 * A wide dialog, for a form with genuinely many columns.
 *
 * MUST come after the .dbm-modal rule above, not before: both selectors have the same
 * specificity (one class), so the later one wins. Placed earlier it was silently ignored
 * and the dialog stayed 560px wide — measured at 562px, which is how the bug was found.
 */
.dbm-modal-wide { width: min(1180px, 96vw); }
/* The form's own column grid may still exceed the dialog on a small window; let it
 * scroll as a last resort rather than widening the dialog past the viewport. */
.dbm-modal-wide .dbm-modal-body { overflow: auto; }
/*
 * The column grid is SIZED TO FIT, not left to its content.
 *
 * With one control per field and twelve fields, every input's min-width summed past the
 * dialog and the last five columns were cut off (measured: a 1684px table inside a
 * 1182px dialog). table-layout: fixed plus per-column widths makes the table honour the
 * available width instead of growing to its content, and the inputs then shrink with
 * their cells. The per-column widths below are in the header's own field order.
 */
.dbm-newtable-cols { table-layout: fixed; width: 100%; }
.dbm-newtable-cols .dbm-input, .dbm-newtable-cols .dbm-select {
  /* Fill the cell rather than setting a floor: a floor is what pushed the table wider
     than its container. */
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
/* 字段名 类型 长度 排序规则 属性 索引 索引名 允许空 默认值 自增 注释 删除.
 * 类型 is a select now (wider text), 属性 is ONE dropdown instead of four checkboxes
 * (much narrower), and 自增 holds its reason as well as the box.
 *
 * 默认值 was widened from 7% to 11%, taken from 属性, 索引名, 允许空 and 注释. The cell used to
 * hold a dropdown AND a text field side by side, which in a 7% column left both of them a few
 * pixels wide — reported as "填写值的框框和选择框都挤的看不见了". The cell now holds exactly one
 * control, and this width is what makes that one control usable: measured at 1182px, the literal
 * box comes out 90px rather than the 68px an 9% column gave, which is the difference between
 * being able to read 'abc' and having to scroll a three-character literal. */
.dbm-newtable-cols th:nth-child(1) { width: 10%; }
.dbm-newtable-cols th:nth-child(2) { width: 13%; }
.dbm-newtable-cols th:nth-child(3) { width: 7%; }
.dbm-newtable-cols th:nth-child(4) { width: 11%; }
.dbm-newtable-cols th:nth-child(5) { width: 10%; }
.dbm-newtable-cols th:nth-child(6) { width: 8%; }
.dbm-newtable-cols th:nth-child(7) { width: 8%; }
.dbm-newtable-cols th:nth-child(8) { width: 4%; }
.dbm-newtable-cols th:nth-child(9) { width: 11%; }
.dbm-newtable-cols th:nth-child(10) { width: 8%; }
.dbm-newtable-cols th:nth-child(11) { width: 8%; }
.dbm-newtable-cols th:nth-child(12) { width: 2%; }
.dbm-newtable-cols th, .dbm-newtable-cols td { padding: 4px 4px; vertical-align: middle; overflow: hidden; }
/* The attribute cell holds four checkboxes stacked, so it does not set a wide floor. */
.dbm-attrs { display: flex; flex-direction: column; gap: 2px; }
.dbm-attrs .dbm-check { white-space: nowrap; font-size: 11px; }

.dbm-modal-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  font-weight: 600;
  flex: none;
}
.dbm-modal-body { padding: 14px 16px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
/*
 * The footer wrapper carries the separator only. Button alignment is the
 * caller's business: a dialog with its own arrangement (a secondary action on
 * the left) must not have to fight a right-alignment imposed here. The wrapper
 * is a flex row so a caller that passes a plain button list still lays out
 * horizontally.
 */
.dbm-modal-foot {
  padding: 12px 16px;
  border-top: 1px solid var(--dsw-alias-border-l3);
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
/* A footer that is just a list of actions keeps the classic right alignment. */
.dbm-modal-foot > .dbm-btn { margin-left: 0; }
.dbm-modal-foot > :first-child:not(.dbm-modal-foot-split) { margin-left: auto; }
/*
 * Split footer: the test action sits on the left, away from the commit pair, so
 * "check this" is never mistaken for "confirm this".
 */
.dbm-modal-foot-split {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.dbm-modal-foot-left { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; }
.dbm-modal-foot-right { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }

/*
 * A labelled field on one line: label / control / optional unit. Used for the
 * connect timeout, which previously shared a wrapping row with the TLS checkbox
 * and broke onto a second line at the dialog's real width.
 */
.dbm-field-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dbm-field-inline > .dbm-input { width: 110px; }

/*
 * Success messages can carry a note on its own line. The block display keeps
 * the note off the same baseline as the headline, which is what made a long
 * success line look like two unrelated fragments.
 */
.dbm-ok { color: #1a8a4a; font-size: 12px; display: block; }
`
