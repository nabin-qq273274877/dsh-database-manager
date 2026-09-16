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
.dbm-tree-item {
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
.dbm-tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
