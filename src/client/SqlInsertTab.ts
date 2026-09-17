import * as React from 'react'
/**
 * The 插入 tab: one row form derived from the table's structure.
 *
 * phpMyAdmin's insert page gives each column the control its TYPE deserves, and
 * that is the point of it: a date gets a date picker, an `enum` gets a list of
 * exactly its members, a boolean gets two labelled choices, and a column the
 * engine generates is shown but not offered as an input. A form of identical text
 * boxes makes the user remember every constraint the database already knows.
 *
 * A blank field means "not supplied", which is not the same as an empty string:
 * the column takes its default or NULL. The two are separated by an explicit
 * checkbox rather than by leaving a box empty, because a NOT NULL text column
 * that legitimately holds `''` is indistinguishable from an untouched field
 * otherwise — and sending `''` for an `int` is an error the engine reports about
 * the wrong thing.
 */

import type { ColumnInfo, DataSourceSummary } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { t } from './ui.ts'

/** One column's form value, as the user set it. */
interface FieldValue {
  /** What to insert; unused when `mode` is not 'value'. */
  text: string
  /** 'value' sends `text`, 'null' sends SQL NULL, 'default' omits the column. */
  mode: 'value' | 'null' | 'default'
}

/** Props for {@link SqlInsertTab}. */
export interface SqlInsertTabProps {
  api: DbApi
  source: DataSourceSummary
  schema: string
  table: string
  columns: ColumnInfo[]
  loading: boolean
  /** Refresh counts and the grid after an insert. */
  onDone(message: string): void
  onError(message: string | undefined): void
}

/** A rough type classification, for choosing a control. */
export type FieldKind =
  | { kind: 'enum'; options: string[] }
  | { kind: 'boolean' }
  | { kind: 'number'; integer: boolean; maxLength?: number }
  | { kind: 'date' }
  | { kind: 'datetime' }
  | { kind: 'time' }
  | { kind: 'text'; maxLength?: number; multiline: boolean }
  | { kind: 'binary' }

/** Decide which control a column's declared type gets. */
export function fieldKind(column: ColumnInfo): FieldKind {
  if (column.options !== undefined && column.options.length > 0) return { kind: 'enum', options: column.options }
  const type = column.type.trim().toLowerCase()
  if (/^(bool|boolean)$/.test(type)) return { kind: 'boolean' }
  if (/^tinyint\(1\)/.test(type)) return { kind: 'boolean' }
  if (/^(tiny|small|medium|big)?(int|year)/.test(type)) return { kind: 'number', integer: true }
  if (/^(decimal|numeric|float|double|real|bit)/.test(type)) return { kind: 'number', integer: false }
  if (/^date$/.test(type)) return { kind: 'date' }
  if (/^datetime|^timestamp/.test(type)) return { kind: 'datetime' }
  if (/^time$/.test(type)) return { kind: 'time' }
  if (/blob|binary/.test(type)) return { kind: 'binary' }
  const maxLength = /\((?:char|varchar|character|nvarchar|native)?\s*(\d{1,6})\)/.exec(type)?.[1]
  return {
    kind: 'text',
    ...(maxLength === undefined ? {} : { maxLength: Number(maxLength) }),
    multiline: /(text|json|clob)/.test(type),
  }
}

/** Whether a column is SQLite's `INTEGER PRIMARY KEY` rowid alias. */
function isRowidAlias(kind: string, column: ColumnInfo): boolean {
  if (kind !== 'sqlite') return false
  if (column.key !== 'PRI' || column.primaryKeyPosition !== 1) return false
  return column.type.trim().toLowerCase().replace(/\s+/g, ' ') === 'integer'
}

/** Whether the engine will assign a value when the column is omitted. */
function autoAssigns(kind: string, column: ColumnInfo): boolean {
  if (isRowidAlias(kind, column)) return true
  return column.extra !== undefined && /auto_increment/i.test(column.extra)
}

/** The 插入 tab. */
export function SqlInsertTab(props: SqlInsertTabProps): React.ReactElement {
  const { api, source, schema, table, columns, loading, onDone, onError } = props
  const editable = React.useMemo(() => columns.filter(column => column.generated !== true), [columns])
  /**
   * One set of values per row being composed.
   *
   * An ARRAY of forms, each form a map of column name to value — the same shape
   * the wire payload will take, so building it is a projection rather than a
   * transformation.
   */
  const [forms, setForms] = React.useState<Array<Record<string, FieldValue>>>([{}])
  const [busy, setBusy] = React.useState(false)

  // A new table means a new structure, so nothing typed for the previous one may
  // survive: a column name that happens to match would otherwise carry a value
  // into a table it was never meant for.
  React.useEffect(() => { setForms([{}]) }, [table, schema])

  const fieldOf = (form: Record<string, FieldValue>, column: ColumnInfo): FieldValue => {
    const held = form[column.name]
    if (held !== undefined) return held
    // The initial state is "not supplied", which lets the engine apply its own
    // default — the only reading of an untouched field that is never wrong.
    return { text: '', mode: 'default' }
  }

  const setField = (index: number, column: string, value: FieldValue): void => {
    setForms(current => current.map((form, at) => (at === index ? { ...form, [column]: value } : form)))
  }

  /** Validate and convert one form into the wire payload. */
  const buildRow = (form: Record<string, FieldValue>): { values: Array<{ column: string; value: string | null }> } | { error: string } => {
    const values: Array<{ column: string; value: string | null }> = []
    for (const column of editable) {
      const field = fieldOf(form, column)
      if (field.mode === 'default') {
        // A column that is NOT NULL with no default has to be supplied, or the
        // engine rejects the insert — say which one instead of letting the
        // engine report it about a placeholder.
        if (!column.nullable && column.defaultValue === undefined && !autoAssigns(source.kind, column)) {
          return { error: t('insert.required', { column: column.name }) }
        }
        continue
      }
      if (field.mode === 'null') {
        if (!column.nullable) return { error: t('insert.required', { column: column.name }) }
        values.push({ column: column.name, value: null })
        continue
      }
      const kind = fieldKind(column)
      if (kind.kind === 'number') {
        const text = field.text.trim()
        if (text === '') return { error: t('insert.required', { column: column.name }) }
        // The engine would accept some of these (MySQL coerces '12abc' to 12 with
        // a warning); refusing here is what keeps a typo from being stored as a
        // different number than the one on screen.
        if (!(kind.integer ? /^-?\d+$/ : /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/).test(text)) {
          return { error: t('insert.numberInvalid', { column: column.name }) }
        }
      }
      if (kind.kind === 'text' && kind.maxLength !== undefined && [...field.text].length > kind.maxLength) {
        return { error: t('insert.valueTooLong', { column: column.name, max: kind.maxLength }) }
      }
      values.push({ column: column.name, value: field.text })
    }
    return { values }
  }

  const submit = async (keepGoing: boolean): Promise<void> => {
    const payloads: Array<Array<{ column: string; value: string | null }>> = []
    for (const [index, form] of forms.entries()) {
      const built = buildRow(form)
      if ('error' in built) {
        onError(forms.length > 1 ? `${t('insert.formOf', { n: index + 1 })}: ${built.error}` : built.error)
        return
      }
      if (built.values.length === 0) {
        // A form with nothing supplied is not "insert an all-defaults row": an
        // empty form is an untouched one, and sending it would insert a row the
        // user did not ask for.
        if (forms.length === 1) { onError(t('insert.hint')); return }
        continue
      }
      payloads.push(built.values)
    }
    if (payloads.length === 0) { onError(t('insert.required', { column: editable[0]?.name ?? table })); return }

    setBusy(true)
    try {
      // One request for all the forms: the host inserts them in one transaction,
      // so a failure on the third leaves no first and second behind.
      const result = payloads.length === 1
        ? await api.insertRow(source.id, { schema, table, values: payloads[0]! })
        : await api.insertRows(source.id, { schema, table, rows: payloads })
      onError(undefined)
      onDone(payloads.length > 1 ? t('insert.rowsDone', { n: result.affected, forms: payloads.length }) : t('insert.done', { n: result.affected }))
      setForms(keepGoing ? [{}] : [{}])
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  if (columns.length === 0) {
    return React.createElement('div', { className: 'dbm-pad dbm-hint' }, loading ? t('common.loading') : t('search.needStructure'))
  }

  /** One control for one column. */
  const control = (index: number, form: Record<string, FieldValue>, column: ColumnInfo): React.ReactElement => {
    const field = fieldOf(form, column)
    const kind = fieldKind(column)
    const disabled = field.mode !== 'value'
    const apply = (patch: Partial<FieldValue>): void => setField(index, column.name, { ...field, ...patch })
    const testId = { 'data-dbm-insert-for': `${index}:${column.name}` }

    if (kind.kind === 'enum') {
      return React.createElement(
        'select',
        {
          ...testId,
          className: 'dbm-select',
          value: field.text,
          disabled: disabled || busy,
          onChange: (event: { target: { value: string } }) => apply({ mode: 'value', text: event.target.value }),
        },
        [
          React.createElement('option', { key: '', value: '' }, field.mode === 'default' ? t('insert.useDefault') : '—'),
          ...kind.options.map(option => React.createElement('option', { key: option, value: option }, option)),
        ],
      )
    }
    if (kind.kind === 'boolean') {
      return React.createElement(
        'select',
        {
          ...testId,
          className: 'dbm-select',
          value: field.text,
          disabled: disabled || busy,
          onChange: (event: { target: { value: string } }) => apply({ mode: 'value', text: event.target.value }),
        },
        [
          React.createElement('option', { key: '', value: '' }, field.mode === 'default' ? t('insert.useDefault') : '—'),
          React.createElement('option', { key: '1', value: '1' }, t('insert.boolTrue')),
          React.createElement('option', { key: '0', value: '0' }, t('insert.boolFalse')),
        ],
      )
    }
    if (kind.kind === 'date' || kind.kind === 'datetime' || kind.kind === 'time') {
      const type = kind.kind === 'date' ? 'date' : kind.kind === 'datetime' ? 'datetime-local' : 'time'
      return React.createElement('input', {
        ...testId,
        className: 'dbm-input dbm-mono',
        type,
        value: field.text,
        disabled: disabled || busy,
        onChange: (event: { target: { value: string } }) => apply({ mode: 'value', text: event.target.value }),
      })
    }
    if (kind.kind === 'binary') {
      // A BLOB is written as hex, which is the one textual form both engines
      // accept and which cannot be corrupted by a text encoding.
      return React.createElement('textarea', {
        ...testId,
        className: 'dbm-textarea dbm-mono',
        rows: 2,
        value: field.text,
        disabled: disabled || busy,
        placeholder: 'x\'DEADBEEF\'',
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => apply({ mode: 'value', text: event.target.value }),
      })
    }
    if (kind.kind === 'text' && kind.multiline) {
      return React.createElement('textarea', {
        ...testId,
        className: 'dbm-textarea',
        rows: 3,
        value: field.text,
        disabled: disabled || busy,
        maxLength: kind.maxLength,
        onChange: (event: { target: { value: string } }) => apply({ mode: 'value', text: event.target.value }),
      })
    }
    return React.createElement('input', {
      ...testId,
      className: `dbm-input${kind.kind === 'number' ? ' dbm-mono' : ''}`,
      value: field.text,
      disabled: disabled || busy,
      maxLength: kind.kind === 'text' ? kind.maxLength : undefined,
      ...(kind.kind === 'number' ? { inputMode: kind.integer ? 'numeric' : 'decimal' } : {}),
      ...(autoAssigns(source.kind, column) ? { placeholder: t('insert.autoAssign') } : {}),
      onChange: (event: { target: { value: string } }) => apply({ mode: 'value', text: event.target.value }),
    })
  }

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    React.createElement(
      'div',
      { className: 'dbm-scroll' },
      React.createElement(
        'div',
        { className: 'dbm-pad' },
        React.createElement('strong', null, `${t('insert.title')} — ${table}`),
        React.createElement('div', { className: 'dbm-hint' }, t('insert.hint')),
        forms.length > 1 ? React.createElement('div', { className: 'dbm-hint' }, t('insert.rowsHint')) : null,
        ...forms.map((form, index) => React.createElement(
          'div',
          { key: index, className: 'dbm-pad', style: { padding: 0 }, 'data-dbm-insert-form': String(index) },
          React.createElement(
            'div',
            { className: 'dbm-row' },
            React.createElement('strong', null, forms.length > 1 ? t('insert.formOf', { n: index + 1 }) : t('insert.title')),
            forms.length > 1
              ? React.createElement('button', {
                  type: 'button',
                  className: 'dbm-btn dbm-btn-sm dbm-btn-danger',
                  disabled: busy,
                  title: t('insert.removeRow'),
                  onClick: () => setForms(current => current.filter((_, at) => at !== index)),
                }, '✕')
              : null,
          ),
          React.createElement(
            'div',
            { className: 'dbm-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' } },
            ...editable.map(column => {
              const field = fieldOf(form, column)
              const kind = fieldKind(column)
              /**
               * The mode radio's setter, in this scope.
               *
               * `control()` has its own `apply`, but the mode radios live out here
               * because they belong to the column rather than to its control: the
               * mode decides whether the control is even enabled.
               */
              const setMode = (patch: Partial<FieldValue>): void => setField(index, column.name, { ...field, ...patch })
              return React.createElement(
                'label',
                { className: 'dbm-label', key: column.name },
                React.createElement(
                  'span',
                  null,
                  column.name,
                  React.createElement('span', { className: 'dbm-hint' }, ` · ${column.type === '' ? t('common.none') : column.type}${column.nullable ? '' : ' NOT NULL'}${column.key === 'PRI' ? ' PK' : ''}`),
                  autoAssigns(source.kind, column)
                    ? React.createElement('span', { className: 'dbm-hint' }, ` · ${t('insert.autoAssign')}`)
                    : null,
                  column.comment === undefined || column.comment === '' ? null : React.createElement('span', { className: 'dbm-hint' }, ` · ${column.comment}`),
                ),
                control(index, form, column),
                React.createElement(
                  'span',
                  { className: 'dbm-row', style: { gap: 8 } },
                  // The mode decides what is sent, and it is explicit: leaving the
                  // box empty would be ambiguous between "not supplied" and "the
                  // empty string", and for a numeric column the latter is an error
                  // reported about the wrong thing.
                  React.createElement('label', { className: 'dbm-check' },
                    React.createElement('input', {
                      type: 'radio',
                      name: `dbm-mode-${index}-${column.name}`,
                      checked: field.mode === 'value',
                      disabled: busy,
                      onChange: () => setMode({ mode: 'value' }),
                    }),
                    t('insert.mode.value')),
                  React.createElement('label', { className: 'dbm-check' },
                    React.createElement('input', {
                      type: 'radio',
                      name: `dbm-mode-${index}-${column.name}`,
                      checked: field.mode === 'default',
                      disabled: busy,
                      onChange: () => setMode({ mode: 'default', text: '' }),
                    }),
                    t('insert.useDefault') + (column.defaultValue === undefined ? '' : t('insert.defaultSuffix', { value: column.defaultValue }))),
                  column.nullable
                    ? React.createElement('label', { className: 'dbm-check' },
                        React.createElement('input', {
                          type: 'radio',
                          name: `dbm-mode-${index}-${column.name}`,
                          checked: field.mode === 'null',
                          disabled: busy,
                          onChange: () => setMode({ mode: 'null', text: '' }),
                        }),
                        t('insert.useNull'))
                    : null,
                  kind.kind === 'enum' ? React.createElement('span', { className: 'dbm-hint' }, t('insert.enumHint')) : null,
                ),
              )
            }),
          ),
        )),
        React.createElement(
          'div',
          { className: 'dbm-row' },
          React.createElement('button', {
            type: 'button',
            className: 'dbm-btn dbm-btn-primary',
            disabled: busy || loading,
            onClick: () => { void submit(false) },
          }, busy ? t('common.loading') : t('insert.submit')),
          React.createElement('button', {
            type: 'button',
            className: 'dbm-btn',
            disabled: busy || loading,
            onClick: () => { void submit(true) },
          }, t('insert.submitAndNew')),
          React.createElement('button', {
            type: 'button',
            className: 'dbm-btn dbm-btn-sm',
            disabled: busy,
            onClick: () => setForms(current => [...current, {}]),
          }, `+ ${t('insert.addRow')}`),
        ),
      ),
    ),
  )
}
