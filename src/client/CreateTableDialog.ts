import * as React from 'react'

/**
 * The 新建表 dialog.
 *
 * Reported: a freshly created database had no way to get a table — the panel could
 * browse, alter and drop tables but could not bring one into existence, so the only
 * route was the 导入 tab with a hand-written dump or the SQL tab with hand-written
 * DDL. This is the missing entry point.
 *
 * The column rows reuse the same {@link ColumnSpecPayload} the 结构 tab sends, and the
 * host validates them through the same `readColumnSpec`, so a column created here is
 * held to exactly the rules a column added later is. Two paths, one validator.
 */

import type { ColumnSpecPayload, DbKind } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { Modal, t } from './ui.ts'

/** One editable column row in the new-table form. */
interface DraftColumn {
  /** A stable key for React; a fresh uuid per row so reordering/removal cannot collide. */
  id: number
  name: string
  type: string
  nullable: boolean
  defaultValue: string
  autoIncrement: boolean
  /** Whether this column is part of the primary key. */
  key: boolean
}

/** Common column types per engine, matching the 结构 tab's own list. */
const TYPES: Record<string, string[]> = {
  mysql: [
    'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'DECIMAL(10,2)', 'FLOAT', 'DOUBLE',
    'VARCHAR(255)', 'VARCHAR(64)', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
    'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
    'BOOLEAN', 'JSON', 'BLOB', 'CHAR(36)',
  ],
  sqlite: [
    'INTEGER', 'REAL', 'TEXT', 'BLOB', 'NUMERIC',
    'VARCHAR(255)', 'BOOLEAN', 'DATE', 'DATETIME',
  ],
}

/** A blank starting row. */
let nextRowId = 1
const blank = (kind: string, first: boolean): DraftColumn => ({
  id: nextRowId++,
  name: first ? 'id' : '',
  type: kind === 'sqlite' ? 'INTEGER' : 'INT',
  nullable: !first,
  defaultValue: '',
  // Only the first column starts as an auto-increment key: that is the shape almost
  // every table wants, and starting from it saves the two clicks it would otherwise
  // take every time.
  autoIncrement: first,
  key: first,
})

/** Props for {@link CreateTableDialog}. */
export interface CreateTableDialogProps {
  api: DbApi
  sourceId: string
  schema: string
  /** The engine, which decides the type list and the auto-increment rules. */
  kind: DbKind
  /** Existing table names, so a clash is reported before the request is sent. */
  existingTables: string[]
  onClose(): void
  onCreated(table: string): void
  onError(message: string): void
}

/**
 * Whether an auto-increment column is expressible on this engine.
 *
 * Not the same rule for both, and getting it wrong means a create that fails with an
 * engine message about the key rather than a form that says what it needs:
 *
 * - MySQL: the column must be a KEY. A table can have only one auto column, and it
 *   must be indexed — so the checkbox is only offered on a column that is in the key.
 * - SQLite: `AUTOINCREMENT` is legal only on an `INTEGER PRIMARY KEY` (the rowid
 *   alias), so it requires the key flag AND the exact type `INTEGER` — `INT` is
 *   accepted as a type name but is not the rowid alias, so it would silently not
 *   auto-increment.
 */
function autoIncrementAllowed(kind: string, column: DraftColumn): boolean {
  if (!column.key) return false
  if (kind === 'sqlite') return column.type.trim().toUpperCase() === 'INTEGER'
  return true
}

export function CreateTableDialog(props: CreateTableDialogProps): React.ReactElement {
  const { api, sourceId, schema, kind, existingTables, onClose, onCreated, onError } = props
  const typeList = TYPES[kind] ?? TYPES.mysql!
  const [name, setName] = React.useState('')
  const [columns, setColumns] = React.useState<DraftColumn[]>(() => [blank(kind, true)])
  const [busy, setBusy] = React.useState(false)
  const [localError, setLocalError] = React.useState<string | undefined>(undefined)

  /** Replace one column by id, so a stale index cannot edit the wrong row. */
  const patch = (id: number, next: Partial<DraftColumn>): void => {
    setColumns(current => current.map(column => (column.id === id ? { ...column, ...next } : column)))
  }

  const addRow = (): void => {
    setColumns(current => [...current, { ...blank(kind, false), id: nextRowId++ }])
  }

  const removeRow = (id: number): void => {
    setColumns(current => {
      // The last row is not removable: a table needs at least one column, and an empty
      // form looks like a rendering fault rather than a state the user chose.
      if (current.length <= 1) return current
      return current.filter(column => column.id !== id)
    })
  }

  /**
   * Check the draft and turn it into the wire payload.
   *
   * Returns the error to show rather than throwing: every case here is a normal user
   * mistake, and each names the field it is about so the message can be acted on.
   */
  const build = (): { payload: { table: string; specs: ColumnSpecPayload[]; primaryKey: string[] } } | { error: string } => {
    const tableName = name.trim()
    if (tableName === '') return { error: t('createTable.nameRequired') }
    // Checked here as well as by the host, so the message names the field instead of
    // arriving as an engine syntax error.
    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(tableName)) return { error: t('createTable.nameInvalid') }
    if (existingTables.some(existing => existing.toLowerCase() === tableName.toLowerCase())) {
      return { error: t('createTable.nameTaken', { table: tableName }) }
    }

    const specs: ColumnSpecPayload[] = []
    const key: string[] = []
    const seen = new Set<string>()
    for (const [index, column] of columns.entries()) {
      const columnName = column.name.trim()
      const position = index + 1
      if (columnName === '') return { error: t('createTable.columnNameRequired', { n: position }) }
      if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(columnName)) return { error: t('createTable.columnNameInvalid', { name: columnName }) }
      if (seen.has(columnName.toLowerCase())) return { error: t('createTable.columnDuplicated', { name: columnName }) }
      seen.add(columnName.toLowerCase())
      if (column.type.trim() === '') return { error: t('createTable.columnTypeRequired', { name: columnName }) }

      const autoIncrement = column.autoIncrement && autoIncrementAllowed(kind, column)
      // An auto-increment column cannot also carry a literal default: both engines
      // refuse it, and the refusal does not say which of the two fields to drop.
      if (autoIncrement && column.defaultValue.trim() !== '') {
        return { error: t('createTable.autoIncrementDefault', { name: columnName }) }
      }
      if (column.key) key.push(columnName)

      specs.push({
        name: columnName,
        type: column.type.trim(),
        // A key column is never nullable in either engine, so the flag is forced
        // rather than left to produce a statement the server rejects.
        nullable: column.key ? false : column.nullable,
        ...(column.defaultValue.trim() === '' ? {} : { defaultValue: column.defaultValue.trim() }),
        ...(autoIncrement ? { autoIncrement: true } : {}),
        // `unique` is expressed through the key list here; a single-column UNIQUE
        // is left to the 结构 tab's index tools, which can name the index.
      })
    }

    /*
     * More than one auto-increment column is refused up front.
     *
     * MySQL allows exactly one per table and SQLite one rowid alias, and the engine
     * message ("there can be only one auto column") does not say which of the ticked
     * columns to untick.
     */
    const autos = columns.filter(column => column.autoIncrement && autoIncrementAllowed(kind, column) && column.key)
    if (autos.length > 1) {
      return { error: t('createTable.oneAutoIncrement', { names: autos.map(column => column.name.trim()).join(', ') }) }
    }

    return { payload: { table: tableName, specs, primaryKey: key } }
  }

  const submit = async (): Promise<void> => {
    const built = build()
    if ('error' in built) { setLocalError(built.error); return }
    setLocalError(undefined)
    setBusy(true)
    try {
      await api.changeSchema(sourceId, {
        schema,
        table: built.payload.table,
        action: 'createTable',
        specs: built.payload.specs,
        ...(built.payload.primaryKey.length === 0 ? {} : { primaryKey: built.payload.primaryKey }),
        /*
         * No `as never` here.
         *
         * The first version cast the payload, which suppressed the one check that would
         * have caught the field being named `specs` on this side and read as `columns`
         * on the other: the two are both arrays, so the mistake only surfaced as a
         * runtime refusal. Letting the compiler type the object against
         * SchemaChangePayload is what keeps the two sides in step.
         */
      })
      onCreated(built.payload.table)
    } catch (failure) {
      // Reported in the dialog rather than only as a page banner: the form is still
      // open, and whatever the engine objected to is something the user can fix here.
      setLocalError(failure instanceof Error ? failure.message : String(failure))
      onError('')
    } finally {
      setBusy(false)
    }
  }

  /** One row of the column table: name, type, the flags, and a way to drop it. */
  const rowFor = (column: DraftColumn, index: number): React.ReactElement =>
    React.createElement(
      'tr',
      { key: column.id, 'data-dbm-newtable-row': column.name },
      React.createElement(
        'td',
        null,
        React.createElement('input', {
          className: 'dbm-input dbm-mono',
          value: column.name,
          placeholder: t('createTable.columnNamePlaceholder'),
          'aria-label': t('createTable.columnName'),
          'data-dbm-newtable-colname': String(index),
          spellcheck: false,
          onChange: (event: { target: { value: string } }) => patch(column.id, { name: event.target.value }),
        }),
      ),
      React.createElement(
        'td',
        null,
        React.createElement(
          'input',
          {
            className: 'dbm-input dbm-mono',
            value: column.type,
            placeholder: typeList[0],
            'aria-label': t('createTable.columnType'),
            'data-dbm-newtable-coltype': String(index),
            spellcheck: false,
            list: `dbm-types-${kind}`,
            onChange: (event: { target: { value: string } }) => patch(column.id, { type: event.target.value }),
          },
        ),
      ),
      React.createElement(
        'td',
        { className: 'dbm-mono' },
        React.createElement('label', { className: 'dbm-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: column.key,
            'data-dbm-newtable-key': String(index),
            // A key column cannot be nullable, so ticking the key turns the nullable
            // flag off; the checkbox below reflects that rather than lying.
            onChange: (event: { target: { checked: boolean } }) => patch(column.id, {
              key: event.target.checked,
              ...(event.target.checked ? { nullable: false } : {}),
            }),
          }),
          t('createTable.columnKey'),
        ),
      ),
      React.createElement(
        'td',
        null,
        React.createElement('label', { className: 'dbm-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: column.key ? false : column.nullable,
            disabled: column.key,
            title: column.key ? t('createTable.keyNotNullable') : undefined,
            onChange: (event: { target: { checked: boolean } }) => patch(column.id, { nullable: event.target.checked }),
          }),
          t('createTable.columnNullable'),
        ),
      ),
      React.createElement(
        'td',
        null,
        React.createElement('input', {
          className: 'dbm-input dbm-mono',
          value: column.defaultValue,
          placeholder: t('common.none'),
          'aria-label': t('createTable.columnDefault'),
          spellcheck: false,
          onChange: (event: { target: { value: string } }) => patch(column.id, { defaultValue: event.target.value }),
        }),
      ),
      React.createElement(
        'td',
        null,
        React.createElement('label', { className: 'dbm-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: column.autoIncrement,
            // Disabled where the engine cannot express it, with the reason — see
            // `autoIncrementAllowed`. Both engines also require the key flag.
            disabled: !autoIncrementAllowed(kind, column),
            title: column.key
              ? (kind === 'sqlite' ? t('createTable.autoNeedsInteger') : undefined)
              : t('createTable.autoNeedsKey'),
            onChange: (event: { target: { checked: boolean } }) => patch(column.id, { autoIncrement: event.target.checked }),
          }),
          t('createTable.columnAuto'),
        ),
      ),
      React.createElement(
        'td',
        null,
        React.createElement('button', {
          type: 'button',
          className: 'dbm-btn dbm-btn-sm',
          disabled: columns.length <= 1,
          title: columns.length <= 1 ? t('createTable.lastColumn') : t('createTable.removeColumn'),
          'data-dbm-newtable-remove': String(index),
          onClick: () => removeRow(column.id),
        }, '×'),
      ),
    )

  const body = React.createElement(
    'div',
    null,
    React.createElement(
      'div',
      { className: 'dbm-field' },
      React.createElement('label', { className: 'dbm-field-label' }, t('createTable.tableName')),
      React.createElement('input', {
        className: 'dbm-input dbm-mono',
        value: name,
        placeholder: 'my_table',
        'aria-label': t('createTable.tableName'),
        'data-dbm-newtable-name': '',
        spellcheck: false,
        autoFocus: true,
        onChange: (event: { target: { value: string } }) => setName(event.target.value),
      }),
      React.createElement('div', { className: 'dbm-hint' }, t('createTable.intoSchema', { schema })),
    ),
    React.createElement(
      'div',
      { className: 'dbm-field' },
      React.createElement('label', { className: 'dbm-field-label' }, t('createTable.columns')),
      // The datalist gives the type field suggestions without constraining it: SQLite
      // accepts any type name and MySQL has more types than a list can hold.
      React.createElement(
        'datalist',
        { id: `dbm-types-${kind}` },
        ...typeList.map(value => React.createElement('option', { key: value, value })),
      ),
      React.createElement(
        'div',
        { className: 'dbm-scroll' },
        React.createElement(
          'table',
          { className: 'dbm-table dbm-newtable-cols' },
          React.createElement(
            'thead',
            null,
            React.createElement(
              'tr',
              null,
              ...[
                t('createTable.columnName'),
                t('createTable.columnType'),
                t('createTable.columnKey'),
                t('createTable.columnNullable'),
                t('createTable.columnDefault'),
                t('createTable.columnAuto'),
                '',
              ].map((label, index) => React.createElement('th', { key: `${label}-${index}` }, label)),
            ),
          ),
          React.createElement('tbody', null, ...columns.map(rowFor)),
        ),
      ),
      React.createElement('div', { className: 'dbm-hint' }, t('createTable.hint')),
    ),
    React.createElement(
      'button',
      { type: 'button', className: 'dbm-btn dbm-btn-sm', 'data-dbm-newtable-add': '', onClick: addRow },
      t('createTable.addColumn'),
    ),
    localError === undefined
      ? null
      : React.createElement('div', { className: 'dbm-error dbm-pad', role: 'alert', 'data-dbm-newtable-error': '' }, localError),
  )

  return React.createElement(Modal, {
    title: t('createTable.title'),
    onClose: busy ? () => { /* inert while the create is running */ } : onClose,
    footer: [
      React.createElement('button', { key: 'cancel', type: 'button', className: 'dbm-btn', disabled: busy, onClick: onClose }, t('common.cancel')),
      React.createElement(
        'button',
        {
          key: 'ok',
          type: 'button',
          className: `dbm-btn dbm-btn-primary${busy ? ' dbm-btn-busy' : ''}`,
          disabled: busy,
          'aria-busy': busy ? 'true' : undefined,
          'data-dbm-newtable-submit': '',
          onClick: () => { void submit() },
        },
        busy
          ? [React.createElement('span', { key: 'spin', className: 'dbm-spinner' }), t('common.loading')]
          : t('createTable.submit'),
      ),
    ],
    children: body,
  })
}
