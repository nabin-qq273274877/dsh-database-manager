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

import type { ColumnInfo, ColumnSpecPayload, IndexInfo } from '../protocol.ts'
import type { DbApi } from './api.ts'
import {
  DEFAULT_MODES,
  defaultToWire,
  inferDefault,
  supportsCurrentTimestamp,
  type DefaultMode,
} from './column-defaults.ts'
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

/** The types the 结构 tab offers, per engine. */
const TYPES: Record<string, string[]> = {
  mysql: [
    'tinyint', 'smallint', 'mediumint', 'int', 'bigint',
    'decimal(10,2)', 'float', 'double',
    'char(1)', 'varchar(191)', 'text', 'mediumtext', 'longtext',
    'binary(16)', 'varbinary(255)', 'blob',
    'date', 'datetime', 'timestamp', 'time', 'year',
    'enum()', 'set()', 'json', 'bool',
  ],
  sqlite: [
    'INTEGER', 'INT', 'BIGINT', 'TEXT', 'VARCHAR(191)', 'REAL',
    'NUMERIC', 'DECIMAL(10,2)', 'BLOB', 'BOOLEAN', 'DATE', 'DATETIME', 'JSON', '',
  ],
}

/** A readable label for the engine of one data source. */
function typeOptions(kind: string): string[] {
  return TYPES[kind] ?? TYPES['sqlite']!
}

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

/** The 结构 tab. */
export function SqlStructureTab(props: SqlStructureTabProps): React.ReactElement {
  const { api, sourceId, schema, table, kind, columns, indexes, loading, error, onReload, onReloadRows, onNotice, onError } = props
  /** The column editor: a new column, or an existing one being changed. */
  const [editor, setEditor] = React.useState<{ mode: 'add' | 'edit'; spec: ColumnSpecPayload; original: string; default: DefaultDraft } | undefined>(undefined)
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

  /** Run one schema change, then reload what it invalidated. */
  const run = async (body: Record<string, unknown>, options: { rows?: boolean } = {}): Promise<void> => {
    setBusy(true)
    try {
      await api.changeSchema(sourceId, { schema, table, ...body } as never)
      setConfirming(undefined)
      setEditor(undefined)
      setIndexForm(undefined)
      setKeyEditor(undefined)
      onNotice(t('structure.done'))
      onError(undefined)
      onReload()
      // A column change can rewrite the rows (a rebuild copies them, a dropped
      // column removes one), so the grid is re-read rather than left showing
      // cells that no longer exist.
      if (options.rows !== false) onReloadRows()
    } catch (failure) {
      setConfirming(undefined)
      onError(t('db.action.failed', { error: failure instanceof Error ? failure.message : String(failure) }))
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
    setEditor({
      mode: 'edit',
      original: column.name,
      default: { ...seeded, opened: seeded },
      spec: {
        name: column.name,
        type: column.type,
        nullable: column.nullable,
        // Kept VERBATIM and used only when the user leaves the control alone: the raw
        // text round-trips exactly, whereas re-rendering it from the mode would turn
        // an expression default into a string literal. See `submitEditor`.
        ...(column.defaultValue === undefined ? {} : { defaultValue: column.defaultValue }),
        ...(column.comment === undefined ? {} : { comment: column.comment }),
        ...(column.extra !== undefined && /auto_increment/i.test(column.extra) ? { autoIncrement: true } : {}),
      },
    })
  }

  const startAdd = (): void => {
    setEditor({
      mode: 'add',
      original: '',
      // A new column starts with no default and nullable: those are the settings that
      // cannot fail on a table that already holds rows. A NOT NULL column without
      // a default is refused by both engines when the table is not empty.
      default: { mode: 'none', text: '', opened: { mode: 'none', text: '' } },
      spec: { name: '', type: kind === 'sqlite' ? 'TEXT' : 'varchar(191)', nullable: true },
    })
  }

  /** Save the column editor's spec. */
  const submitEditor = async (): Promise<void> => {
    if (editor === undefined) return
    const spec = editor.spec
    const name = spec.name.trim()
    if (name === '') { onError(t('structure.colNameRequired')); return }
    const taken = columns.some(column => column.name.toLowerCase() === name.toLowerCase() && column.name !== editor.original)
    if (taken) { onError(t('structure.colNameTaken', { name })); return }
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
    const raw = spec.defaultValue
    const isExpression = raw !== undefined && /[(]/.test(raw) && !/^'/.test(raw)
    const defaultValue = untouched && isExpression
      ? raw
      : defaultToWire(editor.default.mode, editor.default.text)
    const column = {
      ...spec,
      name,
      ...(defaultValue === undefined ? { defaultValue: undefined } : { defaultValue }),
    }
    const body = editor.mode === 'add'
      ? { action: 'addColumn', column }
      : {
          action: 'alterColumn',
          column: { ...column, name: editor.original },
          ...(name === editor.original ? {} : { rename: name }),
        }
    await run(body)
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
    ].map(label => React.createElement('th', { key: label }, label)),
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
      .map(label => React.createElement('th', { key: label }, label)),
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
            busy,
            onChange: next => setEditor({ ...editor, spec: next.spec, default: next.default }),
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
  editor: { mode: 'add' | 'edit'; spec: ColumnSpecPayload; original: string; default: DefaultDraft }
  kind: string
  columns: ColumnInfo[]
  busy: boolean
  onChange(next: { spec: ColumnSpecPayload; default: DefaultDraft }): void
  onSubmit(): void
  onCancel(): void
  onError(message: string | undefined): void
}): React.ReactElement {
  const { editor, kind, columns, busy, onChange, onSubmit, onCancel } = props
  const spec = editor.spec
  const draft = editor.default
  const options = typeOptions(kind)
  // An enum's members are what the user has to supply, so the type list is a set of
  // starting points and the text field is the authority.
  const inList = options.includes(spec.type)
  const existing = editor.mode === 'edit' ? columns.find(column => column.name === editor.original) : undefined
  /** Patch the spec alone. */
  const patchSpec = (next: Partial<ColumnSpecPayload>): void => onChange({ spec: { ...spec, ...next }, default: draft })
  /** Patch the default control alone. */
  const patchDefault = (next: Partial<DefaultDraft>): void => onChange({ spec, default: { ...draft, ...next } })

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
    if (draft.mode === 'custom') {
      return React.createElement(
        'div',
        { className: 'dbm-type-cell' },
        React.createElement('input', {
          className: 'dbm-input dbm-mono',
          value: draft.text,
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
        value: draft.mode,
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
        const disabled = mode === 'currentTimestamp' && !supportsCurrentTimestamp(spec.type)
        return React.createElement(
          'option',
          { key: mode, value: mode, disabled },
          disabled ? `${label}（${t('createTable.default.needsTemporal')}）` : label,
        )
      }),
    )
  }

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
        value: spec.name,
        'aria-label': t('structure.colName'),
        'data-dbm-column-name': '',
        onChange: (event: { target: { value: string } }) => patchSpec({ name: event.target.value }),
      })),
      /*
       * The type is a LIST plus a text field, not one or the other.
       *
       * The list is a convenience: SQLite accepts any type name, and MySQL has more
       * than a fixed list can hold (decimal(10,2) unsigned, enum('a','b')). So the
       * text field is always editable and the list fills it in.
       */
      field('type', t('structure.col.type'),
        React.createElement('select', {
          className: 'dbm-select',
          value: inList ? spec.type : '__other__',
          'aria-label': t('structure.col.type'),
          onChange: (event: { target: { value: string } }) => {
            const value = event.target.value
            patchSpec({ type: value === '__other__' ? spec.type : value })
          },
        },
        [
          ...options.map(type => React.createElement('option', { key: type === '' ? '__none__' : type, value: type }, type === '' ? t('common.none') : type)),
          React.createElement('option', { key: '__other__', value: '__other__' }, t('structure.typeOther')),
        ]),
      ),
      field('typeText', t('structure.typeText'), React.createElement('input', {
        className: 'dbm-input dbm-mono',
        value: spec.type,
        placeholder: t('structure.typeOtherPlaceholder'),
        'aria-label': t('structure.typeText'),
        spellcheck: false,
        'data-dbm-column-type': '',
        onChange: (event: { target: { value: string } }) => patchSpec({ type: event.target.value }),
      })),
      field('nullable', t('structure.col.nullable'),
        React.createElement('label', { className: 'dbm-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: spec.nullable,
            // A primary-key column cannot be nullable in either engine, so the
            // checkbox is disabled where it would mean nothing.
            disabled: existing?.primaryKeyPosition !== undefined,
            onChange: (event: { target: { checked: boolean } }) => patchSpec({ nullable: event.target.checked }),
          }),
          t('structure.col.nullable')),
        existing?.primaryKeyPosition === undefined ? undefined : t('structure.nullableKeyHint'),
      ),
      field('default', t('structure.col.default'), defaultControl(), t('structure.defaultHint')),
      field('comment', t('structure.col.comment'), React.createElement('input', {
        className: 'dbm-input',
        value: spec.comment ?? '',
        placeholder: t('structure.commentPlaceholder'),
        'aria-label': t('structure.col.comment'),
        onChange: (event: { target: { value: string } }) => patchSpec({ comment: event.target.value }),
      })),
      editor.mode === 'edit' && existing?.generated === true
        ? React.createElement('div', { className: 'dbm-hint' }, t('structure.generatedHint'))
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

