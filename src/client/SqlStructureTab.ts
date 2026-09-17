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

import type { ColumnInfo, IndexInfo } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { ErrorBanner, Modal, t } from './ui.ts'

/** One column-spec edit, as the host expects it. */
export interface ColumnSpecPayload {
  name: string
  type: string
  nullable: boolean
  defaultValue?: string
  comment?: string
  autoIncrement?: boolean
  unique?: boolean
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
  const [editor, setEditor] = React.useState<{ mode: 'add' | 'edit'; spec: ColumnSpecPayload; original: string } | undefined>(undefined)
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
    setEditor({
      mode: 'edit',
      original: column.name,
      spec: {
        name: column.name,
        type: column.type,
        nullable: column.nullable,
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
      // A new column starts nullable with no default: those are the settings that
      // cannot fail on a table that already holds rows. A NOT NULL column without
      // a default is refused by both engines when the table is not empty.
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
    const body = editor.mode === 'add'
      ? { action: 'addColumn', column: { ...spec, name } }
      : {
          action: 'alterColumn',
          column: { ...spec, name: editor.original },
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
        loading ? React.createElement('span', { className: 'dbm-hint' }, t('common.loading')) : null,
        React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', disabled: busy, onClick: () => { onReload(); onReloadRows() } }, t('common.refresh')),
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
            onChange: next => setEditor({ ...editor, spec: next }),
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

/** The inline add / change form for one column. */
function ColumnEditor(props: {
  editor: { mode: 'add' | 'edit'; spec: ColumnSpecPayload; original: string }
  kind: string
  columns: ColumnInfo[]
  busy: boolean
  onChange(next: ColumnSpecPayload): void
  onSubmit(): void
  onCancel(): void
  onError(message: string | undefined): void
}): React.ReactElement {
  const { editor, kind, columns, busy, onChange, onSubmit, onCancel } = props
  const spec = editor.spec
  const options = typeOptions(kind)
  // `enum()`/`set()` cannot be offered as a fixed list: their members are what the
  // user has to supply, so the type field is free text and the list is a set of
  // starting points.
  const inList = options.includes(spec.type)
  const existing = editor.mode === 'edit' ? columns.find(column => column.name === editor.original) : undefined

  return React.createElement(
    'div',
    { className: 'dbm-struct-editor' },
    React.createElement('strong', null, editor.mode === 'add' ? t('structure.newColumn') : t('structure.editColumn', { column: editor.original })),
    React.createElement('label', { className: 'dbm-hint' }, t('structure.colName')),
    React.createElement('input', {
      className: 'dbm-input',
      value: spec.name,
      style: { width: 120 },
      'aria-label': t('structure.colName'),
      onChange: (event: { target: { value: string } }) => onChange({ ...spec, name: event.target.value }),
    }),
    React.createElement('label', { className: 'dbm-hint' }, t('structure.col.type')),
    React.createElement(
      'select',
      {
        className: 'dbm-select',
        value: inList ? spec.type : '__other__',
        onChange: (event: { target: { value: string } }) => {
          const value = event.target.value
          onChange({ ...spec, type: value === '__other__' ? spec.type : value })
        },
      },
      [
        ...options.map(type => React.createElement('option', { key: type === '' ? '__none__' : type, value: type }, type === '' ? t('common.none') : type)),
        React.createElement('option', { key: '__other__', value: '__other__' }, t('structure.typeOther')),
      ],
    ),
    React.createElement('input', {
      className: 'dbm-input dbm-mono',
      value: spec.type,
      style: { width: 150 },
      placeholder: t('structure.typeOtherPlaceholder'),
      'aria-label': t('structure.col.type'),
      spellcheck: false,
      onChange: (event: { target: { value: string } }) => onChange({ ...spec, type: event.target.value }),
    }),
    React.createElement('label', { className: 'dbm-check' },
      React.createElement('input', {
        type: 'checkbox',
        checked: spec.nullable,
        // A primary-key column cannot be nullable in either engine, so the
        // checkbox is offered only where it means something.
        disabled: existing?.primaryKeyPosition !== undefined,
        onChange: (event: { target: { checked: boolean } }) => onChange({ ...spec, nullable: event.target.checked }),
      }),
      t('structure.col.nullable')),
    React.createElement('label', { className: 'dbm-hint' }, t('structure.col.default')),
    React.createElement('input', {
      className: 'dbm-input dbm-mono',
      value: spec.defaultValue ?? '',
      style: { width: 130 },
      placeholder: t('common.none'),
      'aria-label': t('structure.col.default'),
      spellcheck: false,
      onChange: (event: { target: { value: string } }) => onChange({ ...spec, defaultValue: event.target.value }),
    }),
    React.createElement('input', {
      className: 'dbm-input',
      value: spec.comment ?? '',
      style: { width: 130 },
      placeholder: t('structure.col.comment'),
      'aria-label': t('structure.col.comment'),
      onChange: (event: { target: { value: string } }) => onChange({ ...spec, comment: event.target.value }),
    }),
    editor.mode === 'edit' && existing?.generated === true
      ? React.createElement('span', { className: 'dbm-hint' }, t('structure.generatedHint'))
      : null,
    React.createElement('span', { className: 'dbm-spacer' }),
    React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm dbm-btn-primary', disabled: busy, onClick: onSubmit },
      editor.mode === 'add' ? t('structure.addSubmit') : t('structure.saveSubmit')),
    React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', disabled: busy, onClick: onCancel }, t('common.cancel')),
  )
}

/** The index creator's form. */
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
  return React.createElement(
    'div',
    { className: 'dbm-struct-editor' },
    React.createElement('strong', null, t('structure.addIndex')),
    React.createElement('label', { className: 'dbm-hint' }, t('structure.indexName')),
    React.createElement('input', {
      className: 'dbm-input',
      value: form.name,
      style: { width: 150 },
      'aria-label': t('structure.indexName'),
      onChange: (event: { target: { value: string } }) => onChange({ ...form, name: event.target.value }),
    }),
    React.createElement('label', { className: 'dbm-check' },
      React.createElement('input', {
        type: 'checkbox',
        checked: form.unique,
        onChange: (event: { target: { checked: boolean } }) => onChange({ ...form, unique: event.target.checked }),
      }),
      t('structure.indexUnique')),
    React.createElement('span', { className: 'dbm-hint' }, t('structure.indexColumnsHint')),
    // The columns are ticked IN ORDER, and the tick order is the index's column
    // order: a prefix of that order is what the index can serve, so the sequence
    // is not a detail the UI may normalise away.
    ...columns.map(column => {
      const at = form.columns.indexOf(column.name)
      return React.createElement('label', { key: column.name, className: 'dbm-check' },
        React.createElement('input', {
          type: 'checkbox',
          checked: at !== -1,
          onChange: (event: { target: { checked: boolean } }) => {
            const next = form.columns.filter(name => name !== column.name)
            if (event.target.checked) next.push(column.name)
            onChange({ ...form, columns: next })
          },
        }),
        at === -1 ? column.name : `${at + 1}. ${column.name}`)
    }),
    React.createElement('span', { className: 'dbm-spacer' }),
    React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm dbm-btn-primary', disabled: busy, onClick: onSubmit }, t('structure.createIndex')),
    React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', disabled: busy, onClick: onCancel }, t('common.cancel')),
  )
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
