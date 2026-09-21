import * as React from 'react'
/**
 * The 结构 tab: columns and indexes, with phpMyAdmin's editing operations.
 *
 * Every change here is DDL and cannot be undone, so each one is a deliberate
 * gesture with its own confirmation — and the destructive ones repeat what they
 * will destroy. Three engine differences are surfaced rather than hidden:
 *
 * - A change SQLite can only make by rebuilding the table says so, and says that
 *   the rebuild runs in one transaction. A user who does not know their 40M-row
 *   table is about to be copied needs to know before pressing the button, not
 *   after.
 * - A column the engine computes (a generated column) is marked and cannot be
 *   changed into an ordinary one: its expression is not this panel's to invent.
 * - The primary key's own index is not droppable as an index; the key editor is
 *   where it changes.
 */

import type { ColumnAttribute, ColumnInfo, ColumnSpecPayload, IndexInfo } from '../protocol.ts'
import { COLUMN_ATTRIBUTES, POSITION_FIRST } from '../protocol.ts'
import type { DbApi } from './api.ts'
import {
  DEFAULT_MODES,
  attributeAllowed,
  autoIncrementBlocker,
  defaultToWire,
  inferDefault,
  requiresLengthOrValues,
  supportsCurrentTimestamp,
  takesLength,
  type DefaultMode,
} from './column-defaults.ts'
import {
  attributesFromColumn,
  joinTypeParts,
  splitTypeParts,
} from './column-spec-form.ts'
import {
  generatedIndexName,
  indexChoiceOf,
  planIndexChange,
  type ColumnIndexChoice,
} from './column-index-plan.ts'
import { ATTRIBUTE_ITEMS, collationsFor, offeredTypes, typeGroupsFor } from './table-types.ts'
import { ErrorBanner, Modal, t } from './ui.ts'

/**
 * The 默认值 control's state, mirroring the 新建表 form's four modes.
 *
 * `opened` records what the control was seeded with, so "the user left it alone" is
 * distinguishable from "the user picked the same thing". That matters because an
 * untouched default is sent back VERBATIM: the raw value the server reported may be
 * an expression this form cannot re-render, and re-emitting it from the mode would
 * turn `lower('ABC')` into the string literal `'lower(''ABC'')'`.
 */
interface DefaultDraft {
  mode: DefaultMode
  text: string
  opened: { mode: DefaultMode; text: string }
}

/**
 * The editor's working copy of one column.
 *
 * The type is held as three parts rather than one string because that is what the
 * aligned form edits — a base, a length and a modifier list — and the engine receives
 * ONE expression that already contains all three. See `column-spec-form.ts` for why
 * the split has to happen at all: emitting the reported type AND an attribute list
 * would send `INT UNSIGNED UNSIGNED`.
 */
interface ColumnDraft {
  name: string
  /** The base type name, without brackets or modifiers. */
  type: string
  length: string
  collate: string
  attributes: ColumnAttribute[]
  nullable: boolean
  autoIncrement: boolean
  comment: string
  /** The index role shown in the 索引 dropdown. */
  index: ColumnIndexChoice
  /** The name for a new index; blank means "generate one". */
  indexName: string
  /** Whether the 类型 cell is showing its text field instead of the grouped list. */
  typeCustom: boolean
}

/** Props for {@link SqlStructureTab}. */
export interface SqlStructureTabProps {
  api: DbApi
  sourceId: string
  schema: string
  table: string
  kind: string
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  /** Whether the columns are still being read. */
  loading: boolean
  error?: string
  /** Re-read columns and indexes after a change. */
  onReload(): void
  /** Also re-read the rows: a rebuild can change them. */
  onReloadRows(): void
  onNotice(message: string | undefined): void
  onError(message: string | undefined): void
}

/**
 * The types the 结构 tab offers, per engine.
 *
 * Removed: the editor now offers the SAME grouped list 新建表 does (see
 * `table-types.ts`), because a flat list of thirty types is hard to scan and the two
 * forms are meant to offer the same choice. The separate 「类型文本」 field is gone with
 * it — the grouped dropdown swaps to a text box in place for a custom type, which is
 * the shape the create form already uses.
 */
/**
 * Whether a change to this table needs a full rebuild on the given engine.
 *
 * Only SQLite rebuilds, and only for the changes its `ALTER TABLE` cannot make:
 * a rename is native, an append is native. The panel uses this to warn before the
 * fact — the copy is proportional to the table's size, which the user knows and
 * the panel does not.
 */
export function needsRebuild(kind: string, change: 'add' | 'alter' | 'drop' | 'key'): boolean {
  if (kind !== 'sqlite') return false
  return change === 'alter' || change === 'drop' || change === 'key'
}

/** What the column editor is working on. */
interface EditorState {
  mode: 'add' | 'edit'
  /** The column's name as it stands now; empty for a new one. */
  original: string
  draft: ColumnDraft
  default: DefaultDraft
  /** The index the column had when the editor opened, so a change can be detected. */
  indexAtOpen: ColumnIndexChoice
  /**
   * Where a NEW column goes, as the 放在 dropdown shows it.
   *
   * `''` means 「最后」, which is the same as not specifying one — so an untouched
   * form and one that picked the last column produce the same statement.
   */
  position: string
}

/** The 结构 tab. */
export function SqlStructureTab(props: SqlStructureTabProps): React.ReactElement {
  const { api, sourceId, schema, table, kind, columns, indexes, loading, error, onReload, onReloadRows, onNotice, onError } = props
  /** The column editor: a new column, or an existing one being changed. */
  const [editor, setEditor] = React.useState<EditorState | undefined>(undefined)
  const [confirming, setConfirming] = React.useState<
    | { op: 'dropColumn'; column: string; rebuild: boolean }
    | { op: 'dropColumns'; columns: string[]; rebuild: boolean }
    | { op: 'dropIndex'; name: string }
    | undefined
  >(undefined)
  /** Which columns are selected for a batch operation. */
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  /** The distinct-value count being shown, if any. */
  const [distinct, setDistinct] = React.useState<{ column: string; count?: number; error?: string } | undefined>(undefined)
  /** The primary-key editor's working order. */
  const [keyEditor, setKeyEditor] = React.useState<string[] | undefined>(undefined)
  /** The index creator's form. */
  const [indexForm, setIndexForm] = React.useState<{ name: string; columns: string[]; unique: boolean } | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)

  // A selection is per table: carrying it across a table change would let "drop
  // selected columns" act on names from a different table.
  React.useEffect(() => { setSelected(new Set()); setEditor(undefined); setIndexForm(undefined) }, [table, schema])

  /**
   * Run one schema change, then reload what it invalidated.
   *
   * @returns true when the change was applied. The caller needs to know, because a
   *   failure in one step of a multi-step edit (a column change followed by an index
   *   change) must STOP the rest: trying to create an index on a column whose own
   *   change just failed would report a second, misleading error.
   */
  const run = async (
    body: Record<string, unknown>,
    options: { rows?: boolean; keepEditor?: boolean } = {},
  ): Promise<boolean> => {
    setBusy(true)
    try {
      await api.changeSchema(sourceId, { schema, table, ...body } as never)
      setConfirming(undefined)
      if (options.keepEditor !== true) setEditor(undefined)
      setIndexForm(undefined)
      setKeyEditor(undefined)
      onNotice(t('structure.done'))
      onError(undefined)
      onReload()
      // A column change can rewrite the rows (a rebuild copies them, a dropped
      // column removes one), so the grid is re-read rather than left showing
      // cells that no longer exist.
      if (options.rows !== false) onReloadRows()
      return true
    } catch (failure) {
      setConfirming(undefined)
      onError(t('db.action.failed', { error: failure instanceof Error ? failure.message : String(failure) }))
      return false
    } finally {
      setBusy(false)
    }
  }

  const showDistinct = async (column: string): Promise<void> => {
    setDistinct({ column })
    try {
      const count = await api.distinctCount(sourceId, { schema, table, column })
      setDistinct({ column, count })
    } catch (failure) {
      setDistinct({ column, error: failure instanceof Error ? failure.message : String(failure) })
    }
  }

  /** Seed the editor's draft from an existing column. */
  const draftFrom = (column: ColumnInfo): ColumnDraft => {
    const parts = splitTypeParts(column.type)
    return {
      name: column.name,
      type: parts.base,
      length: parts.length,
      /*
       * The collation is taken from the column's own report.
       *
       * MySQL gives it as `COLLATION_NAME`; SQLite has no such catalog column (its
       * per-column COLLATE lives in the CREATE text and is not reported here), so the
       * field starts blank there and an unchanged column keeps whatever it had — the
       * rebuild re-emits the original definition.
       */
      collate: column.collation ?? '',
      // UNSIGNED / ZEROFILL are already part of the reported TYPE, which is why the
      // split exists: carrying both would emit `INT UNSIGNED UNSIGNED`, which MySQL
      // ACCEPTS and normalises, so nothing would report the mistake. See
      // `column-spec-form.ts`.
      attributes: attributesFromColumn(column),
      nullable: column.nullable,
      autoIncrement: column.extra !== undefined && /auto_increment/i.test(column.extra),
      comment: column.comment ?? '',
      index: indexChoiceOf(column, indexes),
      indexName: '',
      // A type outside the grouped list opens the text field, so a value the list does
      // not know is editable rather than silently swapped for a listed one.
      typeCustom: !offeredTypes(kind).includes(parts.base),
    }
  }

  const startEdit = (column: ColumnInfo): void => {
    /*
     * The default is converted into the same four-state control 新建表 uses.
     *
     * Before this the editor had a bare text box, and two things went wrong with it.
     * A column whose default IS the empty string showed as an empty box, so submitting
     * it dropped the default to NULL — measured. And a MySQL column with
     * `DEFAULT CURRENT_TIMESTAMP` could not be touched at all, because the reported
     * text was not a literal the validator accepts.
     *
     * `inferDefault` reads the ENGINE's own reporting shape, so the seeding is right on
     * both: SQLite keeps a string's quotes and reports `NULL` explicitly, MySQL strips
     * the quotes and reports `DEFAULT NULL` as nothing.
     */
    const seeded = inferDefault(kind, column.defaultValue)
    const draft = draftFrom(column)
    setEditor({
      mode: 'edit',
      original: column.name,
      draft,
      default: { ...seeded, opened: seeded },
      indexAtOpen: draft.index,
      position: '',
    })
  }

  const startAdd = (): void => {
    setEditor({
      mode: 'add',
      original: '',
      default: { mode: 'none', text: '', opened: { mode: 'none', text: '' } },
      /*
       * Aligned with 新建表: an INTEGER type with an empty length, NOT nullable, no
       * default.
       *
       * 「允许空」 is NOT ticked, which is what the create form was reported to need
       * ("允许空默认不要选"). On SQLite that makes a NOT NULL column with no default the
       * default state for an append, and SQLite REFUSES that on a table with rows
       * ("Cannot add a NOT NULL column with default value NULL", measured) — so the
       * submit path catches that one case and says what to change instead of passing the
       * engine's sentence through. See `submitEditor`.
       */
      draft: {
        name: '',
        type: kind === 'sqlite' ? 'INTEGER' : 'INT',
        length: '',
        collate: '',
        attributes: [],
        nullable: false,
        autoIncrement: false,
        comment: '',
        index: '',
        indexName: '',
        typeCustom: false,
      },
      indexAtOpen: '',
      // 「最后」: the engine's own append, and the only position SQLite has.
      position: '',
    })
  }

  /**
   * Whether SQLite will refuse this append, so the refusal can name the fix.
   *
   * Measured: `ALTER TABLE t ADD COLUMN c TEXT NOT NULL` on a table with rows answers
   * "Cannot add a NOT NULL column with default value NULL". Aligning 允许空 with 新建表
   * (unticked) is what made this reachable, so it is answered in the form rather than
   * passed on: the engine's message names neither 允许空 nor the default.
   *
   * Only for a NEW column: changing an existing one goes through the rebuild path, which
   * re-creates the table from the rows and therefore has no such restriction.
   */
  const sqliteAddRefused = (draft: ColumnDraft): boolean =>
    kind === 'sqlite'
    && !draft.nullable
    && defaultToWire(editor?.default.mode ?? 'none', editor?.default.text ?? '') === undefined

  /** Save the column editor's spec. */
  const submitEditor = async (): Promise<void> => {
    if (editor === undefined) return
    const draft = editor.draft
    const name = draft.name.trim()
    if (name === '') { onError(t('structure.colNameRequired')); return }
    const taken = columns.some(column => column.name.toLowerCase() === name.toLowerCase() && column.name !== editor.original)
    if (taken) { onError(t('structure.colNameTaken', { name })); return }
    if (editor.mode === 'add' && sqliteAddRefused(draft)) {
      onError(t('structure.addNotNullOnSqlite'))
      return
    }

    /*
     * An untouched control sends the RAW reported default; a changed one sends the
     * mode's rendering.
     *
     * The exception that makes this necessary is an EXPRESSION default. The server
     * reports `lower('ABC')` and neither engine's modes can rebuild it: rendering it as
     * 自定义 would quote the whole expression and store its TEXT as the default. So an
     * expression is passed through exactly as read, and only the four modes' own values
     * are re-rendered.
     *
     * The empty-string default must NOT take that path. MySQL reports `DEFAULT ''` as an
     * empty string, so passing it through raw means the driver sees `''` as "no value"
     * and drops the clause — which is how the default was being lost. It is
     * representable (自定义 with a blank box), so it goes through the mode.
     */
    const untouched = editor.default.mode === editor.default.opened.mode
      && editor.default.text === editor.default.opened.text
    const existing = columns.find(column => column.name === editor.original)
    const raw = existing?.defaultValue
    const isExpression = raw !== undefined && /[(]/.test(raw) && !/^'/.test(raw)
    const defaultValue = untouched && isExpression
      ? raw
      : defaultToWire(editor.default.mode, editor.default.text)

    /*
     * The type goes back as ONE expression, and the attributes are re-attached from the
     * list rather than left inside the base.
     *
     * `joinTypeParts` is the inverse of the split the draft was seeded from, so a column
     * reported as `int unsigned` and left alone round-trips as `int unsigned` — with the
     * modifier emitted ONCE, from the list.
     */
    const type = joinTypeParts({ base: draft.type, length: draft.length, attributes: draft.attributes })
    if (type === '') { onError(t('structure.lengthRequired', { type: draft.type || t('common.none'), column: name })); return }
    if (requiresLengthOrValues(draft.type) && draft.length.trim() === '' && !draft.type.includes('(')) {
      onError(t('structure.lengthRequired', { type: draft.type, column: name }))
      return
    }
    /*
     * A length belongs to the type. A stale one is dropped when the new type cannot take
     * it, the same rule 新建表 applies to a changed type: carrying 255 into a type
     * without a width produced `TIMESTAMP(255)`, which MySQL refuses with a message
     * about the DEFAULT.
     */
    if (draft.length.trim() !== '' && !takesLength(draft.type) && !/^'/.test(draft.length.trim())) {
      onError(t('structure.lengthInvalid', { name: draft.type }))
      return
    }

    const column: ColumnSpecPayload = {
      name,
      type,
      nullable: draft.nullable,
      ...(defaultValue === undefined ? {} : { defaultValue }),
      ...(draft.comment.trim() === '' ? {} : { comment: draft.comment.trim() }),
      ...(draft.autoIncrement ? { autoIncrement: true } : {}),
      ...(draft.collate.trim() === '' ? {} : { collate: draft.collate.trim() }),
      // SQLite has no column attributes at all: it ACCEPTS the words and stores them as
      // part of the type name with no effect (measured), which is worse than refusing
      // them. The controls are disabled there; this is the second line of defence.
      ...(kind === 'sqlite' || draft.attributes.length === 0 ? {} : { attributes: draft.attributes }),
      // Only for a new column: on an edit the clause would MOVE the column as a side
      // effect of changing its type, which this form is not asking for.
      ...(editor.mode === 'add' && editor.position !== '' ? { positionAfter: editor.position } : {}),
    }

    /*
     * The index change, as a sequence of separate calls AFTER the column itself.
     *
     * Order matters: on MySQL a primary key must be dropped before another is added
     * (a table has one), and the column has to EXIST before an index can name it. The
     * plan is computed from the choice the editor OPENED with, not from what the table
     * currently reports — a re-read mid-edit would otherwise look like "nothing changed"
     * and silently skip the drop.
     */
    const plan = editor.mode === 'edit'
      ? planIndexChange({
          columnName: name,
          from: editor.indexAtOpen,
          to: draft.index,
          indexes,
          indexName: draft.indexName,
        })
      : planIndexChange({
          columnName: name,
          // A new column has no index yet, whatever the dropdown was left on.
          from: '',
          to: draft.index,
          indexes,
          indexName: draft.indexName,
        })

    if (editor.mode === 'add') {
      if (!await run({ action: 'addColumn', column }, { keepEditor: true })) return
      // The column exists only after the call above, so an index it asked for is a
      // second request. `keepEditor` is what lets a failure here leave the form open
      // with the index still chosen, rather than looking like a silent success.
      await runIndexPlan(plan)
      return
    }

    const body = {
      action: 'alterColumn',
      column: { ...column, name: editor.original },
      ...(name === editor.original ? {} : { rename: name }),
    }
    if (!await run(body, { keepEditor: true })) return
    await runIndexPlan(plan)
  }

  /**
   * Carry out an index plan, one call at a time.
   *
   * Sequential rather than parallel: a drop has to finish before the create that
   * replaces it, and on SQLite each of these can be a whole-table rebuild. It stops at
   * the first failure, which is left reported — continuing would describe the fallout of
   * a step that did not happen.
   */
  const runIndexPlan = async (plan: ReturnType<typeof planIndexChange>): Promise<void> => {
    for (const operation of plan) {
      const done = operation.op === 'setPrimaryKey'
        ? await run({ action: 'setPrimaryKey', columns: operation.columns }, { keepEditor: true })
        : operation.op === 'dropIndex'
          ? await run({ action: 'dropIndex', name: operation.name }, { rows: false, keepEditor: true })
          : await run(
              { action: 'createIndex', index: { name: operation.name, columns: operation.columns, unique: operation.unique } },
              { rows: false, keepEditor: true },
            )
      if (!done) return
    }
    // The editor closes only once the whole plan has run, so a failure part-way leaves
    // the form on screen rather than looking like a silent success.
    setEditor(undefined)
  }

  const primaryColumns = columns
    .filter(column => column.key === 'PRI')
    .sort((a, b) => (a.primaryKeyPosition ?? 0) - (b.primaryKeyPosition ?? 0))
    .map(column => column.name)

  const kindLabel = (column: ColumnInfo): string => {
    if (column.generated === true) return `${column.key === '' ? '' : column.key + ' '}${t('structure.generated')}`.trim()
    return column.key === '' ? t('common.none') : column.key
  }

  const header = React.createElement(
    'tr',
    null,
    React.createElement('th', { className: 'dbm-select-col' },
      React.createElement('input', {
        type: 'checkbox',
        checked: selected.size > 0 && selected.size === columns.filter(column => column.generated !== true).length,
        disabled: columns.length === 0,
        'aria-label': t('structure.select'),
        onChange: (event: { target: { checked: boolean } }) => {
          if (!event.target.checked) { setSelected(new Set()); return }
          setSelected(new Set(columns.filter(column => column.generated !== true).map(column => column.name)))
        },
      })),
    ...[
      t('structure.col.name'), t('structure.col.type'), t('structure.col.nullable'),
      t('structure.col.key'), t('structure.col.default'), t('structure.col.extra'),
      t('structure.col.distinct'), t('structure.col.comment'), t('structure.col.actions'),
    ].map((label, index, all) => React.createElement(
      'th',
      {
        key: label,
        /*
         * The LAST header carries the actions column's class.
         *
         * The body's cells already had it, but the header did not — so the 操作 heading
         * scrolled away with the rest of the row while its buttons stayed pinned. The
         * label a user needs to identify the column was the one thing that left the
         * screen. Measured before this: the header's right edge was at x=1729.3 (outside
         * the 1568 viewport) while the cell beneath it was correctly pinned at 1568.
         */
        ...(index === all.length - 1 ? { className: 'dbm-row-actions' } : {}),
      },
      label,
    )),
  )

  const rows: unknown[] = columns.map(column =>
    React.createElement(
      'tr',
      { key: column.name, 'data-selected': String(selected.has(column.name)) },
      React.createElement('td', { className: 'dbm-select-col' },
        React.createElement('input', {
          type: 'checkbox',
          checked: selected.has(column.name),
          // A generated column's value cannot be supplied, so it is not a
          // candidate for the operations this selection feeds.
          disabled: column.generated === true,
          'aria-label': t('structure.select'),
          title: column.generated === true ? t('structure.generatedHint') : undefined,
          onChange: (event: { target: { checked: boolean } }) => {
            setSelected(current => {
              const next = new Set(current)
              if (event.target.checked) next.add(column.name)
              else next.delete(column.name)
              return next
            })
          },
        })),
      React.createElement('td', { className: 'dbm-mono' }, column.name),
      React.createElement('td', { className: 'dbm-mono' }, column.type === '' ? t('common.none') : column.type),
      React.createElement('td', null, column.nullable ? t('common.yes') : t('common.no')),
      React.createElement(
        'td',
        null,
        kindLabel(column),
        column.primaryKeyPosition !== undefined && primaryColumns.length > 1
          ? React.createElement('span', { className: 'dbm-key-note' }, ` ${t('structure.keyOrder', { n: column.primaryKeyPosition })}`)
          : null,
      ),
      React.createElement('td', { className: 'dbm-mono' }, column.defaultValue ?? t('common.none')),
      React.createElement('td', { className: 'dbm-mono' }, column.extra ?? t('common.none')),
      React.createElement('td', null,
        React.createElement('button', {
          type: 'button',
          className: 'dbm-link',
          onClick: () => { void showDistinct(column.name) },
        }, t('structure.col.distinct'))),
      React.createElement('td', null, column.comment ?? ''),
      React.createElement('td', { className: 'dbm-row-actions' },
        React.createElement('div', { className: 'dbm-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'dbm-btn dbm-btn-sm',
            disabled: busy,
            // A generated column's definition is not fully reported, so changing
            // it would lose the expression it is computed from.
            title: column.generated === true ? t('structure.generatedHint') : undefined,
            onClick: () => startEdit(column),
          }, t('structure.edit')),
          React.createElement('button', {
            type: 'button',
            className: 'dbm-btn dbm-btn-sm dbm-btn-danger',
            disabled: busy || columns.length <= 1,
            onClick: () => setConfirming({ op: 'dropColumn', column: column.name, rebuild: needsRebuild(kind, 'drop') }),
          }, t('structure.drop')),
          React.createElement('button', {
            type: 'button',
            className: 'dbm-btn dbm-btn-sm',
            disabled: busy || column.generated === true,
            title: t('structure.unique'),
            onClick: () => {
              // A UNIQUE constraint on SQLite needs `CREATE UNIQUE INDEX`;
              // `ALTER TABLE` cannot add one, so it goes through the index path
              // and the rebuild is not needed.
              const current = column.key === 'UNI'
              if (current) {
                const index = indexes.find(entry => entry.unique && entry.columns.length === 1 && entry.columns[0] === column.name)
                if (index === undefined) { onError(t('structure.refreshFirst')); return }
                void run({ action: 'dropIndex', name: index.name }, { rows: false })
                return
              }
              void run({ action: 'createIndex', index: { name: uniqueIndexName(column.name, indexes), columns: [column.name], unique: true } }, { rows: false })
            },
          }, `U${column.key === 'UNI' ? '✓' : ''}`),
        )),
    ),
  )

  const indexHeader = React.createElement(
    'tr',
    null,
    ...[t('structure.index.name'), t('structure.index.unique'), t('structure.index.columns'), t('structure.index.type'), t('structure.index.actions')]
      .map((label, index, all) => React.createElement(
        'th',
        // The last header is the 操作 column, pinned like the body's cell beneath it —
        // see the note on the column table's header.
        { key: label, ...(index === all.length - 1 ? { className: 'dbm-row-actions' } : {}) },
        label,
      )),
  )
  const indexRows: unknown[] = indexes.map(index =>
    React.createElement(
      'tr',
      { key: index.name },
      React.createElement('td', { className: 'dbm-mono' }, index.name),
      React.createElement('td', null, index.unique ? t('common.yes') : t('common.no')),
      React.createElement('td', { className: 'dbm-mono' }, index.columns.join(', ')),
      React.createElement('td', null, index.primary === true ? t('structure.primaryKey') : (index.type ?? t('common.none'))),
      React.createElement('td', { className: 'dbm-row-actions' },
        React.createElement('button', {
          type: 'button',
          className: 'dbm-btn dbm-btn-sm dbm-btn-danger',
          // The primary key's own index cannot be dropped on its own: dropping
          // it IS dropping the key, which is what the key editor is for.
          disabled: busy || index.primary === true,
          title: index.primary === true ? t('structure.primaryNotDroppable') : undefined,
          onClick: () => setConfirming({ op: 'dropIndex', name: index.name }),
        }, t('structure.drop'))),
    ),
  )

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    React.createElement(
      'div',
      { className: 'dbm-scroll' },
      React.createElement(
        'div',
        { className: 'dbm-row', style: { padding: '8px 12px' } },
        React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm dbm-btn-primary', disabled: busy, onClick: startAdd }, `+ ${t('structure.addColumn')}`),
        React.createElement('button', {
          type: 'button',
          className: 'dbm-btn dbm-btn-sm',
          disabled: busy || columns.length === 0,
          onClick: () => setKeyEditor(primaryColumns),
        }, t('structure.editKey')),
        React.createElement('button', {
          type: 'button',
          className: 'dbm-btn dbm-btn-sm',
          disabled: busy || columns.length === 0,
          onClick: () => setIndexForm({ name: '', columns: [], unique: false }),
        }, `+ ${t('structure.addIndex')}`),
        selected.size === 0
          ? null
          : [
              React.createElement('span', { key: 'count', className: 'dbm-hint' }, t('structure.selected', { n: selected.size })),
              React.createElement('button', {
                key: 'drop',
                type: 'button',
                className: 'dbm-btn dbm-btn-sm dbm-btn-danger',
                disabled: busy,
                onClick: () => setConfirming({
                  op: 'dropColumns',
                  columns: columns.filter(column => selected.has(column.name)).map(column => column.name),
                  rebuild: needsRebuild(kind, 'drop'),
                }),
              }, t('structure.dropSelected')),
              React.createElement('button', {
                key: 'clear',
                type: 'button',
                className: 'dbm-btn dbm-btn-sm',
                onClick: () => setSelected(new Set()),
              }, t('common.cancel')),
            ],
        React.createElement('span', { className: 'dbm-spacer' }),
        React.createElement(
          'button',
          {
            type: 'button',
            className: `dbm-btn dbm-btn-sm${loading ? ' dbm-btn-busy' : ''}`,
            // Disabled while a READ is running, so a second click cannot stack the
            // same request. `busy` is a write and is tracked separately: a write
            // must not disable the refresh control, and a refresh must not look
            // like a write.
            disabled: loading,
            'aria-busy': loading ? 'true' : undefined,
            'data-dbm-structure-refresh': '',
            onClick: () => { onReload(); onReloadRows() },
          },
          loading
            ? [React.createElement('span', { key: 'spin', className: 'dbm-spinner' }), t('common.loading')]
            : t('common.refresh'),
        ),
      ),
      error === undefined ? null : React.createElement(ErrorBanner, { message: error }),
      editor === undefined
        ? null
        : React.createElement(ColumnEditor, {
            key: 'editor',
            editor,
            kind,
            columns,
            indexes,
            busy,
            onChange: (next: Partial<EditorState>) => setEditor({ ...editor, ...next }),
            onSubmit: () => { void submitEditor() },
            onCancel: () => setEditor(undefined),
            onError,
          }),
      React.createElement(
        'div',
        { className: 'dbm-pad' },
        React.createElement('strong', null, `${t('structure.columns')}（${columns.length}）`),
      ),
      React.createElement(
        'table',
        { className: 'dbm-table' },
        React.createElement('thead', null, header),
        React.createElement('tbody', null, ...rows as never[]),
      ),
      React.createElement(
        'div',
        { className: 'dbm-pad' },
        React.createElement('strong', null, `${t('structure.indexes')}（${indexes.length}）`),
      ),
      indexForm === undefined
        ? null
        : React.createElement(IndexCreator, {
            key: 'index-form',
            form: indexForm,
            columns,
            indexes,
            busy,
            onChange: setIndexForm,
            onSubmit: () => {
              const name = indexForm.name.trim()
              if (name === '') { onError(t('structure.indexNameRequired')); return }
              if (indexes.some(index => index.name.toLowerCase() === name.toLowerCase())) {
                onError(t('structure.indexNameTaken', { name }))
                return
              }
              if (indexForm.columns.length === 0) { onError(t('structure.noColumnsSelected')); return }
              void run({ action: 'createIndex', index: { name, columns: indexForm.columns, unique: indexForm.unique } }, { rows: false })
            },
            onCancel: () => setIndexForm(undefined),
            onError,
          }),
      indexes.length === 0
        ? React.createElement('div', { className: 'dbm-pad dbm-hint' }, t('structure.noIndexes'))
        : React.createElement(
            'table',
            { className: 'dbm-table' },
            React.createElement('thead', null, indexHeader),
            React.createElement('tbody', null, ...indexRows as never[]),
          ),
      keyEditor === undefined
        ? null
        : React.createElement(KeyEditor, {
            key: 'key-editor',
            columns,
            order: keyEditor,
            busy,
            onChange: setKeyEditor,
            onSubmit: () => { void run({ action: 'setPrimaryKey', columns: keyEditor }) },
            onCancel: () => setKeyEditor(undefined),
            rebuild: needsRebuild(kind, 'key'),
          }),
    ),
    distinct === undefined
      ? null
      : React.createElement(Modal, {
          title: t('structure.distinctTitle'),
          onClose: () => setDistinct(undefined),
          footer: [React.createElement('button', { key: 'ok', type: 'button', className: 'dbm-btn', onClick: () => setDistinct(undefined) }, t('common.close'))],
          children: React.createElement(
            'div',
            null,
            distinct.count === undefined && distinct.error === undefined
              ? t('structure.distinctLoading')
              : distinct.error !== undefined
                ? t('structure.distinctFailed', { error: distinct.error })
                : t('structure.distinctBody', { column: distinct.column, n: distinct.count ?? 0 }),
          ),
        }),
    confirming === undefined
      ? null
      : React.createElement(ConfirmChange, {
          key: 'confirm',
          confirming,
          busy,
          kind,
          onCancel: () => setConfirming(undefined),
          onConfirm: () => {
            if (confirming.op === 'dropIndex') { void run({ action: 'dropIndex', name: confirming.name }, { rows: false }); return }
            if (confirming.op === 'dropColumn') { void run({ action: 'dropColumn', column: confirming.column }); return }
            // A multi-column drop is one request per column, in the order on
            // screen: SQLite rebuilds once per drop, so batching them into one
            // request would rebuild several times inside what the user thinks is
            // one action, with no way to report progress between them.
            void (async () => {
              for (const column of confirming.columns) {
                await run({ action: 'dropColumn', column }, { rows: false })
              }
              setSelected(new Set())
              onReloadRows()
            })()
          },
        }),
  )
}

/** A name for the UNIQUE index a per-column toggle creates. */
function uniqueIndexName(column: string, indexes: IndexInfo[]): string {
  const base = `uniq_${column.replace(/[^A-Za-z0-9_]/g, '_')}`
  if (!indexes.some(index => index.name === base)) return base
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}_${n}`
    if (!indexes.some(index => index.name === candidate)) return candidate
  }
  return `${base}_${Date.now()}`
}

/** The confirmation for the destructive structure actions. */
function ConfirmChange(props: {
  confirming: { op: 'dropColumn'; column: string; rebuild: boolean } | { op: 'dropColumns'; columns: string[]; rebuild: boolean } | { op: 'dropIndex'; name: string }
  busy: boolean
  kind: string
  onCancel(): void
  onConfirm(): void
}): React.ReactElement {
  const { confirming, busy, onCancel, onConfirm } = props
  void props.kind
  const isIndex = confirming.op === 'dropIndex'
  const isBatch = confirming.op === 'dropColumns'
  const title = isIndex ? t('structure.dropIndexTitle') : isBatch ? t('structure.dropManyTitle') : t('structure.dropTitle')
  const body = isIndex
    ? t('structure.dropIndexBody', { name: confirming.name })
    : isBatch
      ? t('structure.dropManyBody', { n: confirming.columns.length })
      : t('structure.dropBody', { column: confirming.column })
  // The rebuild warning is shown where it applies and nowhere else: on SQLite a
  // dropped column means the whole table is copied, which on a large table is
  // minutes of work the user should agree to rather than discover.
  const showRebuild = !isIndex && confirming.rebuild

  return React.createElement(Modal, {
    title,
    onClose: onCancel,
    footer: [
      React.createElement('button', { key: 'cancel', type: 'button', className: 'dbm-btn', disabled: busy, onClick: onCancel }, t('common.cancel')),
      React.createElement('button', {
        key: 'ok',
        type: 'button',
        className: 'dbm-btn dbm-btn-danger',
        disabled: busy,
        onClick: onConfirm,
      }, busy ? t('common.loading') : t('structure.drop')),
    ],
    children: React.createElement(
      'div',
      null,
      React.createElement('div', null, body),
      isBatch
        ? React.createElement('div', { className: 'dbm-hint', style: { marginTop: 8 } }, confirming.columns.join('、'))
        : null,
      showRebuild ? React.createElement('div', { className: 'dbm-hint', style: { marginTop: 8 } }, t('structure.dropRebuildNote')) : null,
    ),
  })
}

/**
 * The add / change form for one column.
 *
 * A normal vertical form — one labelled field per row — rather than a line of
 * controls. Laid out inline it wrapped at the panel's real width, at which point
 * "which label goes with which box" stopped being readable.
 *
 * It is a dialog because it has several fields and a commit step: an inline panel
 * pushes the column table down, and that table is the context you compare the new
 * column against.
 */
function ColumnEditor(props: {
  editor: EditorState
  kind: string
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  busy: boolean
  /** Patch the editor's own state; the draft and the default live inside it. */
  onChange(next: Partial<EditorState>): void
  onSubmit(): void
  onCancel(): void
  onError(message: string | undefined): void
}): React.ReactElement {
  const { editor, kind, columns, indexes, busy, onChange, onSubmit, onCancel } = props
  const draft = editor.draft
  const defaultDraft = editor.default
  const groups = typeGroupsFor(kind)
  const offered = offeredTypes(kind)
  // An enum's members are what the user has to supply, so the list is a set of starting
  // points and the text box is the authority for anything it does not hold.
  const isListed = offered.includes(draft.type)
  const existing = editor.mode === 'edit' ? columns.find(column => column.name === editor.original) : undefined
  const isSqlite = kind === 'sqlite'
  // A primary-key column is NOT NULL in both engines, so the box is disabled where it
  // would mean nothing.
  const keyed = editor.mode === 'edit' && existing?.primaryKeyPosition !== undefined
  /** Patch the column draft. */
  const patch = (next: Partial<ColumnDraft>): void => onChange({ draft: { ...draft, ...next } })
  /** Patch the default control. */
  const patchDefault = (next: Partial<DefaultDraft>): void => onChange({ default: { ...defaultDraft, ...next } })

  /**
   * The 类型 cell: a GROUPED dropdown that swaps to a text box in place.
   *
   * The same control 新建表 uses, and grouped for the same reason — a flat list of
   * thirty types is hard to scan and the choice is naturally two-step ("a number, then
   * which number"). The old editor had a flat list PLUS a permanently visible 类型文本
   * field, which was reported as the field that should not be there: two controls for
   * one value, and the second one always editable so it was never clear which was
   * authoritative.
   *
   * The swap is in place rather than a separate field, so the cell is one control wide.
   * A custom type is kept as its own entry in the list, which is what lets ↺ return
   * without discarding it (the create form learned this: resetting to the first listed
   * type silently turned DECIMAL(10,2) into TINYINT).
   */
  const typeCell = (): React.ReactElement => {
    if (draft.typeCustom) {
      return React.createElement(
        'div',
        { className: 'dbm-type-cell' },
        React.createElement('input', {
          className: 'dbm-input dbm-mono',
          value: draft.type,
          placeholder: t('structure.typeOtherPlaceholder'),
          'aria-label': t('structure.col.type'),
          'data-dbm-column-type': '',
          spellcheck: false,
          autoFocus: true,
          onChange: (event: { target: { value: string } }) => patch({ type: event.target.value }),
        }),
        React.createElement('button', {
          type: 'button',
          className: 'dbm-btn dbm-btn-sm',
          title: t('createTable.typeBackToList'),
          'data-dbm-column-type-list': '',
          onClick: () => patch({ typeCustom: false }),
        }, '↺'),
      )
    }
    return React.createElement(
      'select',
      {
        className: 'dbm-select dbm-mono',
        value: isListed ? draft.type : '__customValue__',
        'aria-label': t('structure.col.type'),
        'data-dbm-column-type-select': '',
        onChange: (event: { target: { value: string } }) => {
          const value = event.target.value
          if (value === '__custom__' || value === '__customValue__') { patch({ typeCustom: true }); return }
          /*
           * Changing the type DROPS a length it cannot take.
           *
           * A length belongs to the type, and carrying one across is how `TIMESTAMP(255)`
           * used to be produced — refused by MySQL with a message about the DEFAULT that
           * says nothing about the length. A type that spells its length into its own
           * name (`VARCHAR(255)` in the SQLite list) is unaffected: the length was empty.
           */
          patch({ type: value, ...(takesLength(value) || value.includes('(') ? {} : { length: '' }) })
        },
      },
      [
        ...groups.map(group => React.createElement(
          'optgroup',
          { key: group.label, label: t(group.label as never) },
          ...group.types.map(value => React.createElement('option', { key: value, value }, value)),
        )),
        // The current custom value stays selectable, so returning to the list does not
        // discard it and the dropdown can still show what will be declared.
        isListed
          ? null
          : React.createElement('option', { key: '__customValue__', value: '__customValue__' }, `${draft.type} ${t('structure.typeCustomMark')}`),
        React.createElement('option', { key: '__custom__', value: '__custom__' }, t('createTable.typeCustom')),
      ].filter(entry => entry !== null),
    )
  }

  /**
   * The 属性 dropdown: a list of TOGGLES rather than a multiple select.
   *
   * The same control 新建表 uses, for the same reason: a `multiple` select is awkward
   * with a mouse (ctrl-click to add) and its closed state shows only one value, so the
   * closed state here lists what is chosen. Attributes the current type cannot carry are
   * DISABLED with the reason as their option text rather than hidden — a user who expects
   * ZEROFILL on a text column is told why they cannot have it.
   */
  const attributeControl = (): React.ReactElement => {
    const chosen = draft.attributes
    const summary = chosen.length === 0
      ? t('common.none')
      : chosen.map(id => ATTRIBUTE_ITEMS.find(item => item.id === id)?.label ?? id).join(' ')
    return React.createElement(
      'select',
      {
        className: 'dbm-select',
        // The select's own value is unused (its options are toggles), so it always shows
        // the summary entry.
        value: '',
        'aria-label': t('structure.colAttributes'),
        'data-dbm-column-attr-select': '',
        title: t('structure.attributesHint'),
        disabled: isSqlite,
        onChange: (event: { target: { value: string } }) => {
          const value = event.target.value as ColumnAttribute | '__clear__'
          if (value === '__clear__') { patch({ attributes: [] }); return }
          const next = chosen.includes(value) ? chosen.filter(entry => entry !== value) : [...chosen, value]
          patch({ attributes: next })
        },
      },
      [
        React.createElement('option', { key: '__summary__', value: '' }, isSqlite ? t('structure.attributesSqlite') : summary),
        ...ATTRIBUTE_ITEMS.map(item => {
          // SQLite has no column attributes at all: it stores the words as part of the
          // type name with no effect (measured), so every one of them is unavailable
          // there rather than silently useless.
          const available = !isSqlite && attributeAllowed(item.id, joinTypeParts({ base: draft.type, length: '', attributes: [] }))
          return React.createElement(
            'option',
            { key: item.id, value: item.id, disabled: !available },
            available
              ? `${chosen.includes(item.id) ? '✓ ' : ''}${item.label}`
              : `${item.label} — ${t('structure.attributeUnavailable')}`,
          )
        }),
        chosen.length === 0 ? null : React.createElement('option', { key: '__clear__', value: '__clear__' }, t('structure.attributesClear')),
      ].filter(entry => entry !== null),
    )
  }

  /** The 索引 dropdown: the same roles 新建表 offers one column. */
  const indexControl = (): React.ReactElement =>
    React.createElement(
      'select',
      {
        className: 'dbm-select',
        value: draft.index,
        'aria-label': t('structure.colIndex'),
        'data-dbm-column-index': '',
        onChange: (event: { target: { value: string } }) => patch({ index: event.target.value as ColumnIndexChoice }),
      },
      [
        React.createElement('option', { key: '', value: '' }, t('common.none')),
        ...(['primary', 'unique', 'index'] as ColumnIndexChoice[]).map(value =>
          React.createElement('option', { key: value, value }, t(`createTable.index.${value}` as never))),
      ],
    )

  /**
   * The 默认值 control — the SAME four-state one the 新建表 form uses.
   *
   * Asked for by name ("默认值要和建表一样，可选，定义时可以输入"), and the four states
   * are load-bearing rather than decorative: 不设置 and 自定义-with-an-empty-box are
   * different values in the database (`no DEFAULT` versus `DEFAULT ''`), and a single
   * text box cannot express both — which is exactly how the empty-string default was
   * being lost.
   *
   * The mode swaps the cell to a single text box, the same shape 新建表 already uses,
   * so the dropdown and the box never squeeze each other at this dialog's width.
   */
  const defaultControl = (): React.ReactElement => {
    if (defaultDraft.mode === 'custom') {
      return React.createElement(
        'div',
        { className: 'dbm-type-cell' },
        React.createElement('input', {
          className: 'dbm-input dbm-mono',
          value: defaultDraft.text,
          // Empty IS a real answer in this mode — it means the empty string — so the
          // placeholder says so rather than showing a "nothing" hint.
          placeholder: t('createTable.default.emptyString'),
          'aria-label': t('createTable.default.text'),
          'data-dbm-column-default-text': '',
          spellcheck: false,
          autoFocus: true,
          onChange: (event: { target: { value: string } }) => patchDefault({ text: event.target.value }),
        }),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dbm-btn dbm-btn-sm',
            title: t('createTable.default.backToList'),
            'data-dbm-column-default-list': '',
            onClick: () => patchDefault({ mode: 'none' }),
          },
          '↺',
        ),
      )
    }
    return React.createElement(
      'select',
      {
        className: 'dbm-select',
        value: defaultDraft.mode,
        'aria-label': t('structure.col.default'),
        'data-dbm-column-default-mode': '',
        onChange: (event: { target: { value: string } }) => patchDefault({ mode: event.target.value as DefaultMode }),
      },
      ...DEFAULT_MODES.map(mode => {
        const label = mode === 'none'
          ? t('common.none')
          : mode === 'custom'
            ? t('createTable.default.custom')
            : mode === 'null' ? 'NULL' : 'CURRENT_TIMESTAMP'
        // CURRENT_TIMESTAMP is only offered for a type that accepts it; MySQL refuses
        // it elsewhere with "Invalid default value", measured on VARCHAR and INT.
        const unavailable = mode === 'currentTimestamp'
          && !supportsCurrentTimestamp(joinTypeParts({ base: draft.type, length: '', attributes: [] }))
        return React.createElement(
          'option',
          { key: mode, value: mode, disabled: unavailable },
          unavailable ? `${label}（${t('createTable.default.needsTemporal')}）` : label,
        )
      }),
    )
  }

  /**
   * Why 自增 cannot be used for this column as it now stands, or undefined.
   *
   * `autoIncrementBlocker` is the same rule 新建表 uses — MySQL wants the column to BE a
   * key and be numeric; SQLite wants an `INTEGER PRIMARY KEY`. It is fed the index role
   * the user has CHOSEN in this dialog rather than what the table currently reports:
   * picking 主键 here and then ticking 自增 is a valid combination, and reading only the
   * stored key would refuse it until the form was saved and reopened.
   */
  const autoBlocked = autoIncrementBlocker(kind, {
    indexKind: draft.index,
    type: joinTypeParts({ base: draft.type, length: '', attributes: [] }),
  })

  /**
   * The sentence under 自增.
   *
   * The reason is ON SCREEN rather than in a `title`, because a disabled checkbox with no
   * text reads as a broken control — which is what the create form was reported to have.
   * An already-ticked box keeps its explanation too: unticking is what the user has to do,
   * and the sentence says which of the three rules is in the way.
   */
  const autoHint = autoBlocked === undefined
    ? t('structure.autoHint')
    : autoBlocked === 'notKey'
      ? t('structure.autoNeedsKey')
      : autoBlocked === 'notInteger'
        ? t('structure.autoNeedsInteger')
        : t('structure.autoNeedsNumeric')

  /** One labelled field, stacked, with an optional hint under its control. */
  const field = (key: string, label: string, control: unknown, hint?: string): React.ReactElement =>
    React.createElement(
      'div',
      { className: 'dbm-field', key },
      React.createElement('label', { className: 'dbm-field-label' }, label),
      control as never,
      hint === undefined ? null : React.createElement('div', { className: 'dbm-hint' }, hint),
    )

  return React.createElement(Modal, {
    title: editor.mode === 'add' ? t('structure.newColumn') : t('structure.editColumn', { column: editor.original }),
    // A wider dialog, like 新建表's: the field set is the same now, and the default
    // width squeezed the paired controls.
    wide: true,
    onClose: onCancel,
    footer: [
      React.createElement('button', { key: 'cancel', type: 'button', className: 'dbm-btn', disabled: busy, onClick: onCancel }, t('common.cancel')),
      React.createElement(
        'button',
        {
          key: 'ok',
          type: 'button',
          className: 'dbm-btn dbm-btn-primary',
          disabled: busy,
          'data-dbm-column-submit': '',
          onClick: onSubmit,
        },
        busy ? t('common.loading') : (editor.mode === 'add' ? t('structure.addSubmit') : t('structure.saveSubmit')),
      ),
    ],
    children: React.createElement(
      'div',
      null,
      field('name', t('structure.colName'), React.createElement('input', {
        className: 'dbm-input',
        value: draft.name,
        'aria-label': t('structure.colName'),
        'data-dbm-column-name': '',
        onChange: (event: { target: { value: string } }) => patch({ name: event.target.value }),
      })),
      field('type', t('structure.col.type'), typeCell()),
      /*
       * 长度/值, disabled on SQLite for the same reason 新建表 disables it: SQLite stores a
       * length but never enforces it, and the normal way to write one there is inside the
       * type name. A field that silently does nothing is worse than a disabled one that
       * says so.
       */
      field('length', t('structure.colLength'), React.createElement('input', {
        className: 'dbm-input dbm-mono',
        value: draft.length,
        placeholder: isSqlite ? t('createTable.sqliteLengthHint') : '255',
        'aria-label': t('structure.colLength'),
        'data-dbm-column-length': '',
        spellcheck: false,
        disabled: isSqlite,
        title: isSqlite ? t('createTable.sqliteLengthHint') : t('structure.lengthHint'),
        onChange: (event: { target: { value: string } }) => patch({ length: event.target.value }),
      })),
      field('collate', t('structure.colCollate'), React.createElement(
        'select',
        {
          className: 'dbm-select',
          value: draft.collate,
          'aria-label': t('structure.colCollate'),
          'data-dbm-column-collate': '',
          onChange: (event: { target: { value: string } }) => patch({ collate: event.target.value }),
        },
        collationsFor(kind).map(value => React.createElement('option', { key: value === '' ? '__none__' : value, value }, value === '' ? t('common.none') : value)),
      )),
      field('attributes', t('structure.colAttributes'), attributeControl(), t('structure.attributesHint')),
      field('index', t('structure.colIndex'), indexControl()),
      // The index name is only meaningful for an index of the column's own, which is
      // exactly the two non-key roles just above.
      field('indexName', t('structure.indexNameInline'), React.createElement('input', {
        className: 'dbm-input dbm-mono',
        value: draft.indexName,
        placeholder: generatedIndexName(draft.name.trim() === '' ? 'col' : draft.name.trim(), draft.index, indexes),
        'aria-label': t('structure.indexNameInline'),
        'data-dbm-column-indexname': '',
        spellcheck: false,
        disabled: draft.index === '' || draft.index === 'primary',
        title: t('structure.indexNameInlineHint'),
        onChange: (event: { target: { value: string } }) => patch({ indexName: event.target.value }),
      }), t('structure.indexNameInlineHint')),
      field('nullable', t('structure.col.nullable'),
        React.createElement('label', { className: 'dbm-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: keyed ? false : draft.nullable,
            disabled: keyed,
            'data-dbm-column-nullable': '',
            title: keyed ? t('structure.nullableKeyHint') : undefined,
            onChange: (event: { target: { checked: boolean } }) => patch({ nullable: event.target.checked }),
          }),
          t('structure.col.nullable')),
        keyed ? t('structure.nullableKeyHint') : undefined,
      ),
      field('default', t('structure.col.default'), defaultControl(), t('structure.defaultHint')),
      field('auto', t('structure.colAuto'),
        React.createElement('label', { className: 'dbm-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: draft.autoIncrement,
            disabled: autoBlocked !== undefined && !draft.autoIncrement,
            'data-dbm-column-auto': '',
            onChange: (event: { target: { checked: boolean } }) => patch({ autoIncrement: event.target.checked }),
          })),
        autoHint),
      field('comment', t('structure.col.comment'), React.createElement('input', {
        className: 'dbm-input',
        value: draft.comment,
        placeholder: t('structure.commentPlaceholder'),
        'aria-label': t('structure.col.comment'),
        'data-dbm-column-comment': '',
        disabled: isSqlite,
        title: isSqlite ? t('createTable.sqliteNoComment', { name: draft.name || '—' }) : undefined,
        onChange: (event: { target: { value: string } }) => patch({ comment: event.target.value }),
      })),
      /*
       * 放在…之后, for a NEW column only.
       *
       * An existing column's position is not this form's business: the clause would MOVE
       * the column as a side effect of changing its type, and the intent of "change this
       * column's type" does not include "put it somewhere else".
       *
       * Disabled on SQLite, and deliberately so rather than omitted: its `ADD COLUMN` has
       * no position clause, and passing one is worse than useless — measured, SQLite
       * ACCEPTS `ADD COLUMN c TEXT AFTER a` and folds `AFTER a` into the declared TYPE, so
       * the column does not move and its type name becomes a string nothing else expects.
       */
      editor.mode === 'add'
        ? field('position', t('structure.positionAfter'), React.createElement(
            'select',
            {
              className: 'dbm-select',
              value: editor.position,
              'aria-label': t('structure.positionAfter'),
              'data-dbm-column-position': '',
              disabled: isSqlite,
              title: isSqlite ? t('structure.positionUnsupported') : t('structure.positionAfterHint'),
              onChange: (event: { target: { value: string } }) => onChange({ position: event.target.value }),
            },
            [
              React.createElement('option', { key: '', value: '' }, t('structure.positionEnd')),
              React.createElement('option', { key: '__first__', value: POSITION_FIRST }, t('structure.positionFirst')),
              ...columns.map(column => React.createElement('option', { key: column.name, value: column.name }, column.name)),
            ],
          ), isSqlite ? t('structure.positionUnsupported') : t('structure.positionAfterHint'))
        : null,
      editor.mode === 'edit' && existing?.generated === true
        ? React.createElement('div', { className: 'dbm-hint' }, t('structure.generatedHint'))
        : null,
      /*
       * The SQLite append refusal, predicted rather than passed on.
       *
       * Aligning 允许空 with 新建表 (unticked) made this reachable: an append of a NOT NULL
       * column with no default is refused by SQLite on a table that holds rows, and its
       * message names neither field. The form knows both, so it says which to change.
       */
      editor.mode === 'add' && isSqlite && !draft.nullable && defaultToWire(defaultDraft.mode, defaultDraft.text) === undefined
        ? React.createElement('div', { className: 'dbm-hint', 'data-dbm-column-sqlite-warning': '' }, t('structure.addNotNullOnSqlite'))
        : null,
    ),
  })
}

/**
 * The index creator, as a dialog with the table's columns to pick from.
 *
 * It was an inline strip BELOW the column table, which put the form and the thing
 * it describes on opposite sides of the table it was about — and a strip has no
 * room for the field list, so the columns appeared as one long wrapped line.
 *
 * The columns are checkboxes in table order, and the order they are TICKED is the
 * index's column order: a prefix of that order is what the index can serve, so the
 * sequence is not something the dialog may normalise away. The tick order is shown
 * as a leading number so it is visible rather than implied.
 */
function IndexCreator(props: {
  form: { name: string; columns: string[]; unique: boolean }
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  busy: boolean
  onChange(next: { name: string; columns: string[]; unique: boolean }): void
  onSubmit(): void
  onCancel(): void
  onError(message: string | undefined): void
}): React.ReactElement {
  const { form, columns, busy, onChange, onSubmit, onCancel } = props
  return React.createElement(Modal, {
    title: t('structure.addIndex'),
    onClose: onCancel,
    footer: [
      React.createElement('button', { key: 'cancel', type: 'button', className: 'dbm-btn', disabled: busy, onClick: onCancel }, t('common.cancel')),
      React.createElement(
        'button',
        { key: 'ok', type: 'button', className: 'dbm-btn dbm-btn-primary', disabled: busy, 'data-dbm-index-submit': '', onClick: onSubmit },
        busy ? t('common.loading') : t('structure.createIndex'),
      ),
    ],
    children: React.createElement(
      'div',
      null,
      React.createElement(
        'div',
        { className: 'dbm-field' },
        React.createElement('label', { className: 'dbm-field-label' }, t('structure.indexName')),
        React.createElement('input', {
          className: 'dbm-input',
          value: form.name,
          'aria-label': t('structure.indexName'),
          'data-dbm-index-name': '',
          onChange: (event: { target: { value: string } }) => onChange({ ...form, name: event.target.value }),
        }),
      ),
      React.createElement(
        'div',
        { className: 'dbm-field' },
        React.createElement('label', { className: 'dbm-field-label' }, t('structure.indexColumns')),
        React.createElement(
          'div',
          { className: 'dbm-column-picker' },
          ...columns.map((column, position) => {
            const at = form.columns.indexOf(column.name)
            return React.createElement(
              'label',
              { key: column.name, className: 'dbm-check dbm-column-picker-row' },
              React.createElement('input', {
                type: 'checkbox',
                checked: at !== -1,
                'data-dbm-index-column': column.name,
                onChange: (event: { target: { checked: boolean } }) => {
                  const next = form.columns.filter(name => name !== column.name)
                  if (event.target.checked) next.push(column.name)
                  onChange({ ...form, columns: next })
                },
              }),
              React.createElement('span', { className: 'dbm-column-order' }, at === -1 ? '' : String(at + 1)),
              React.createElement('span', { className: 'dbm-mono' }, column.name),
              React.createElement('span', { className: 'dbm-hint' }, column.type === '' ? '' : column.type),
              void position,
            )
          }),
        ),
        React.createElement('div', { className: 'dbm-hint' }, t('structure.indexColumnsHint')),
      ),
      React.createElement(
        'div',
        { className: 'dbm-field' },
        React.createElement('label', { className: 'dbm-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: form.unique,
            onChange: (event: { target: { checked: boolean } }) => onChange({ ...form, unique: event.target.checked }),
          }),
          t('structure.indexUnique'),
        ),
      ),
      form.columns.length === 0
        ? null
        : React.createElement('div', { className: 'dbm-hint' }, `${t('structure.indexOrderPreview')}: ${form.columns.join(', ')}`),
    ),
  })
}

/** The primary-key editor: tick the columns, in the order they should key. */
function KeyEditor(props: {
  columns: ColumnInfo[]
  order: string[]
  busy: boolean
  rebuild: boolean
  onChange(next: string[]): void
  onSubmit(): void
  onCancel(): void
}): React.ReactElement {
  const { columns, order, busy, rebuild, onChange, onSubmit, onCancel } = props
  return React.createElement(Modal, {
    title: t('structure.keyTitle'),
    onClose: onCancel,
    footer: [
      React.createElement('button', { key: 'cancel', type: 'button', className: 'dbm-btn', disabled: busy, onClick: onCancel }, t('common.cancel')),
      React.createElement('button', { key: 'ok', type: 'button', className: 'dbm-btn dbm-btn-primary', disabled: busy, onClick: onSubmit },
        busy ? t('common.loading') : t('structure.keySave')),
    ],
    children: React.createElement(
      'div',
      null,
      React.createElement('div', { className: 'dbm-hint' }, t('structure.keyBody')),
      ...columns.map(column => {
        const at = order.indexOf(column.name)
        return React.createElement('label', { key: column.name, className: 'dbm-check', style: { display: 'flex', marginTop: 6 } },
          React.createElement('input', {
            type: 'checkbox',
            checked: at !== -1,
            // A generated column can take part in a key in MySQL but not in
            // SQLite, and the difference is the engine's to enforce; the panel
            // offers every column and reports the refusal.
            onChange: (event: { target: { checked: boolean } }) => {
              const next = order.filter(name => name !== column.name)
              if (event.target.checked) next.push(column.name)
              onChange(next)
            },
          }),
          React.createElement('span', { className: 'dbm-mono' }, column.name),
          React.createElement('span', { className: 'dbm-hint' }, ` ${column.type}`),
          at === -1 ? null : React.createElement('span', { className: 'dbm-key-note' }, ` — ${t('structure.keyOrder', { n: at + 1 })}`))
      }),
      rebuild
        ? React.createElement('div', { className: 'dbm-hint', style: { marginTop: 10 } }, t('structure.dropRebuildNote'))
        : null,
    ),
  })
}

