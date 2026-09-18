import * as React from 'react'
/**
 * The 插入 tab: one ordinary form per row, laid out the way phpMyAdmin's insert
 * page is.
 *
 * Every column is a row of its own — name on the left, a control that suits its
 * declared type on the right — and the user types or picks in it directly. A
 * date gets a date picker, an `enum` a list of exactly its members, a boolean
 * two labelled choices, a long text a textarea, a BLOB a hex prompt. A column the
 * engine generates is not offered at all, since no value could be written to it.
 *
 * What an untouched control MEANS, and why the choices beside it exist, is in
 * `insert-values.ts` — the rules are there, the wording and the layout are here.
 * In one line: a blank control leaves the column out of the INSERT so the engine
 * supplies it, a NULL tick box sends SQL NULL, and the empty-string tick box
 * exists only for the textual NOT NULL column whose empty string would otherwise
 * be unreachable from a form.
 *
 * The number of rows is chosen at the top, phpMyAdmin style ("要插入的行数"), and
 * every row becomes its own independent form — one request in one transaction, so
 * a failure on the third row leaves no first and second behind.
 */

import type { ColumnInfo, DataSourceSummary } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { autoAssigns, fieldKind } from './column-kinds.ts'
import {
  blankField,
  buildRow,
  isUntouchedForm,
  MAX_INSERT_FORMS,
  mayOmit,
  needsEmptyChoice,
  parseFormCount,
  placeholderValue,
  resizeForms,
  type FieldValue,
  type RowFailure,
} from './insert-values.ts'
import { t } from './ui.ts'

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
  /**
   * What the row-count box shows, kept as TEXT.
   *
   * The box is a count the user is typing, and holding it as a number would make
   * every intermediate state of typing one illegal: an empty box, or "1" on the
   * way to "12". The count is applied only when 应用 is pressed, so the forms
   * never change under a keystroke — a typed 12 on the way to 120 must not throw
   * away a filled-in row.
   */
  const [countText, setCountText] = React.useState('1')
  const [busy, setBusy] = React.useState(false)

  // A new table means a new structure, so nothing typed for the previous one may
  // survive: a column name that happens to match would otherwise carry a value
  // into a table it was never meant for.
  React.useEffect(() => { setForms([{}]); setCountText('1') }, [table, schema])

  const fieldOf = (form: Record<string, FieldValue>, column: ColumnInfo): FieldValue =>
    form[column.name] ?? blankField()

  const setField = (index: number, column: string, value: FieldValue): void => {
    setForms(current => current.map((form, at) => (at === index ? { ...form, [column]: value } : form)))
  }

  /** The message for a rule the pure layer refused. */
  const failureText = (failure: RowFailure): string => {
    if (failure.reason === 'notNumber') return t('insert.numberInvalid', { column: failure.column })
    if (failure.reason === 'tooLong') return t('insert.valueTooLong', { column: failure.column, max: failure.max })
    return t('insert.required', { column: failure.column })
  }

  /**
   * Send every non-empty form as one batch.
   *
   * `keepCount` is the whole difference between the two submit buttons: 插入
   * leaves the tab ready for a single row, while 插入并再填一行 leaves the SAME
   * number of blank forms, so a batch of ten can be entered again without
   * pressing 应用 first.
   */
  const submit = async (keepCount: boolean): Promise<void> => {
    const payloads: Array<Array<{ column: string; value: string | null }>> = []
    for (const [index, form] of forms.entries()) {
      /*
       * A form nobody touched is skipped, not validated.
       *
       * Asking for more rows than you fill in has to be harmless: validating the
       * blank ones would report a missing NOT NULL column and refuse the WHOLE
       * submit, so filling in one row of a three-row batch would insert nothing
       * while naming a column the user never opened. Measured: exactly that.
       */
      if (forms.length > 1 && isUntouchedForm(editable, form)) continue
      const built = buildRow(source.kind, editable, form)
      if ('failure' in built) {
        onError(forms.length > 1 ? `${t('insert.formOf', { n: index + 1 })}: ${failureText(built.failure)}` : failureText(built.failure))
        return
      }
      if (built.values.length === 0) {
        // Every column of a form that was NOT skipped can be omitted, so it asked
        // for nothing at all: an all-defaults row is not what a blank form means.
        onError(t('insert.hint'))
        return
      }
      payloads.push(built.values)
    }
    if (payloads.length === 0) { onError(t('insert.hint')); return }

    setBusy(true)
    try {
      // One request for all the forms: the host inserts them in one transaction,
      // so a failure on the third leaves no first and second behind.
      const result = payloads.length === 1
        ? await api.insertRow(source.id, { schema, table, values: payloads[0]! })
        : await api.insertRows(source.id, { schema, table, rows: payloads })
      onError(undefined)
      onDone(payloads.length > 1 ? t('insert.rowsDone', { n: result.affected, forms: payloads.length }) : t('insert.done', { n: result.affected }))
      // A batch keeps its size so the next set of rows can be typed straight in;
      // a single insert goes back to one form.
      const next = keepCount ? forms.length : 1
      setForms(Array.from({ length: next }, () => ({})))
      setCountText(String(next))
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  /** Replace the forms with `count` blank ones, or report why the count is not one. */
  const applyCount = (): void => {
    const count = parseFormCount(countText)
    if (count === undefined) {
      // Refused with the range rather than clamped: silently turning 99999 into
      // 50 would leave the box showing a number the form is not using.
      onError(t('insert.rowsRange', { max: MAX_INSERT_FORMS }))
      return
    }
    onError(undefined)
    setForms(current => resizeForms(current, count))
    setCountText(String(count))
  }

  /** Append one blank form, so "+ 再加一行" cannot exceed the ceiling either. */
  const addForm = (): void => {
    if (forms.length >= MAX_INSERT_FORMS) {
      onError(t('insert.rowsRange', { max: MAX_INSERT_FORMS }))
      return
    }
    setForms(current => [...current, {}])
    setCountText(String(forms.length + 1))
  }

  const removeForm = (index: number): void => {
    setForms(current => current.filter((_, at) => at !== index))
    setCountText(String(Math.max(1, forms.length - 1)))
  }

  if (columns.length === 0) {
    return React.createElement('div', { className: 'dbm-pad dbm-hint' }, loading ? t('common.loading') : t('search.needStructure'))
  }

  /** One control for one column, always enabled: the form asks nothing first. */
  const control = (index: number, form: Record<string, FieldValue>, column: ColumnInfo): React.ReactElement => {
    const field = fieldOf(form, column)
    const kind = fieldKind(column)
    // A ticked NULL (or empty-string) box is what the column's value IS, so the
    // text box beside it has nothing left to say and is disabled rather than left
    // editable and ignored.
    const locked = field.kind !== 'value' || busy
    const apply = (patch: Partial<FieldValue>): void => setField(index, column.name, { ...field, ...patch })
    const testId = { 'data-dbm-insert-for': `${index}:${column.name}` }

    if (kind.kind === 'enum') {
      const blank = placeholderValue(kind.options)
      return React.createElement(
        'select',
        {
          ...testId,
          className: 'dbm-select',
          value: field.text,
          disabled: locked,
          // Choosing the blank entry puts the state back to NOTHING, not to the
          // placeholder's own characters: `buildRow` reads `''` as "nothing was
          // chosen", and a NUL sent through as a value would be a string no enum
          // declares.
          onChange: (event: { target: { value: string } }) => apply({ kind: 'value', text: event.target.value === blank ? '' : event.target.value }),
        },
        /*
         * The blank entry is ALWAYS rendered, whatever the column allows.
         *
         * A controlled select whose value matches no option renders the first
         * real option while its state stays empty — so omitting the placeholder
         * here would show "是（1）" for a column that is still unset, and the
         * submit would then be refused for a value the user can see on screen.
         * The wording is what changes: where a blank answer is legal it reads as
         * the way to use the default, and where it is not it reads as "choose
         * one", which is the truth.
         *
         * Its value comes from `placeholderValue`, not a bare '', so an enum that
         * declares '' as a member cannot collide with it.
         */
        [
          React.createElement('option', { key: '', value: blank }, mayOmit(source.kind, column) ? t('insert.blankHint') : t('insert.chooseHint')),
          ...kind.options.map(option => React.createElement('option', { key: option, value: option }, option)),
        ],
      )
    }
    if (kind.kind === 'boolean') {
      // The boolean list has no members to collide with, so '' is already free.
      const blank = placeholderValue([])
      return React.createElement(
        'select',
        {
          ...testId,
          className: 'dbm-select',
          value: field.text,
          disabled: locked,
          onChange: (event: { target: { value: string } }) => apply({ kind: 'value', text: event.target.value === blank ? '' : event.target.value }),
        },
        [
          React.createElement('option', { key: '', value: blank }, mayOmit(source.kind, column) ? t('insert.blankHint') : t('insert.chooseHint')),
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
        disabled: locked,
        onChange: (event: { target: { value: string } }) => apply({ kind: 'value', text: event.target.value }),
      })
    }
    if (kind.kind === 'binary') {
      // A BLOB is written as hex, which is the one textual form both engines
      // accept and which cannot be corrupted by a text encoding.
      return React.createElement('textarea', {
        ...testId,
        className: 'dbm-textarea dbm-mono',
        rows: 1,
        value: field.text,
        disabled: locked,
        placeholder: 'x\'DEADBEEF\'',
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => apply({ kind: 'value', text: event.target.value }),
      })
    }
    if (kind.kind === 'text' && kind.multiline) {
      return React.createElement('textarea', {
        ...testId,
        className: 'dbm-textarea',
        rows: 3,
        value: field.text,
        disabled: locked,
        maxLength: kind.maxLength,
        onChange: (event: { target: { value: string } }) => apply({ kind: 'value', text: event.target.value }),
      })
    }
    return React.createElement('input', {
      ...testId,
      className: `dbm-input${kind.kind === 'number' ? ' dbm-mono' : ''}`,
      value: field.text,
      disabled: locked,
      maxLength: kind.kind === 'text' ? kind.maxLength : undefined,
      ...(kind.kind === 'number' ? { inputMode: kind.integer ? 'numeric' : 'decimal' } : {}),
      ...(autoAssigns(source.kind, column) ? { placeholder: t('insert.autoAssign') } : {}),
      onChange: (event: { target: { value: string } }) => apply({ kind: 'value', text: event.target.value }),
    })
  }

  /**
   * The tick boxes beside a control.
   *
   * At most one of them can apply to a column — NULL needs the column to accept
   * it, the empty-string choice needs it to refuse it — so they never compete for
   * the same slot, and a column that has neither simply shows its control alone.
   */
  const choices = (index: number, form: Record<string, FieldValue>, column: ColumnInfo): React.ReactNode[] => {
    const field = fieldOf(form, column)
    const out: React.ReactNode[] = []
    if (column.nullable) {
      out.push(
        React.createElement('label', { className: 'dbm-check', key: 'null', title: t('insert.nullHint') },
          React.createElement('input', {
            type: 'checkbox',
            'data-dbm-insert-null': `${index}:${column.name}`,
            checked: field.kind === 'null',
            disabled: busy,
            // The text already typed is kept, so unticking restores it instead of
            // making the user retype it.
            onChange: (event: { target: { checked: boolean } }) => setField(index, column.name, { ...field, kind: event.target.checked ? 'null' : 'value' }),
          }),
          'NULL'),
      )
    } else if (needsEmptyChoice(column)) {
      out.push(
        React.createElement('label', { className: 'dbm-check', key: 'empty', title: t('insert.emptyHint') },
          React.createElement('input', {
            type: 'checkbox',
            'data-dbm-insert-empty': `${index}:${column.name}`,
            checked: field.kind === 'empty',
            disabled: busy,
            onChange: (event: { target: { checked: boolean } }) => setField(index, column.name, { ...field, kind: event.target.checked ? 'empty' : 'value' }),
          }),
          t('insert.setEmpty')),
      )
    }
    return out
  }

  /** The name cell of one column's row. */
  const nameCell = (column: ColumnInfo): React.ReactElement =>
    React.createElement(
      'div',
      { className: 'dbm-insert-name', key: `name-${column.name}`, title: column.comment },
      column.name,
      React.createElement('span', { className: 'dbm-hint' }, ` · ${column.type === '' ? t('common.none') : column.type}${column.nullable ? '' : ' NOT NULL'}${column.key === 'PRI' ? ' PK' : ''}`),
      autoAssigns(source.kind, column)
        ? React.createElement('span', { className: 'dbm-hint' }, ` · ${t('insert.autoAssign')}`)
        : null,
      column.defaultValue === undefined
        ? null
        : React.createElement('span', { className: 'dbm-hint' }, ` · ${t('insert.defaultSuffix', { value: column.defaultValue })}`),
    )

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
        React.createElement(
          'div',
          { className: 'dbm-row' },
          React.createElement(
            'label',
            { className: 'dbm-field-inline' },
            React.createElement('span', null, t('insert.rowsLabel')),
            React.createElement('input', {
              className: 'dbm-input dbm-mono',
              type: 'number',
              min: 1,
              max: MAX_INSERT_FORMS,
              'data-dbm-insert-count': true,
              value: countText,
              disabled: busy,
              onChange: (event: { target: { value: string } }) => setCountText(event.target.value),
              onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') applyCount() },
            }),
          ),
          React.createElement('button', {
            type: 'button',
            className: 'dbm-btn dbm-btn-sm',
            'data-dbm-insert-apply': true,
            disabled: busy,
            onClick: applyCount,
          }, t('insert.rowsApply')),
          React.createElement('button', {
            type: 'button',
            className: 'dbm-btn dbm-btn-sm',
            disabled: busy,
            onClick: addForm,
          }, `+ ${t('insert.addRow')}`),
        ),
        ...forms.map((form, index) => React.createElement(
          'div',
          { key: index, className: 'dbm-insert-form', 'data-dbm-insert-form': String(index) },
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
                  onClick: () => removeForm(index),
                }, '✕')
              : null,
          ),
          React.createElement(
            'div',
            { className: 'dbm-insert-grid' },
            ...editable.flatMap(column => [
              nameCell(column),
              React.createElement(
                'div',
                { className: 'dbm-insert-value', key: `value-${column.name}` },
                control(index, form, column),
                ...choices(index, form, column),
              ),
            ]),
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
        ),
      ),
    ),
  )
}
