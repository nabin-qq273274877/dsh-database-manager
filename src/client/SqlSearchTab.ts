import * as React from 'react'
/**
 * The 搜索 tab: a column / operator / value form, not a SQL box.
 *
 * phpMyAdmin's own search page is this shape, and the reason is not style: a raw
 * `WHERE` box makes the user responsible for quoting, for the column names and
 * for not breaking out of the condition. A structured form binds every operand as
 * a parameter and lets the operator decide the SQL, so `100%` searches for a
 * literal percent sign and a value of `' OR 1=1 --` searches for that text.
 *
 * The SQL tab remains the escape hatch for a query this form cannot express;
 * that is where arbitrary SQL belongs, behind an explicit 允许写入 checkbox.
 *
 * Conditions combine with AND or OR over the whole list. There is deliberately no
 * per-row connector and no parenthesis nesting: one join per search is what the
 * request shape supports, and offering a UI that implies otherwise would promise
 * a grouping the server does not implement.
 */

import type { ColumnInfo, RowFilter, RowFilterOperator } from '../protocol.ts'
import { ROW_FILTER_OPERATORS, UNARY_FILTER_OPERATORS } from '../protocol.ts'
import { Empty, t } from './ui.ts'

/** One editable condition row. */
interface ConditionRow {
  /** A stable key for React, so removing a middle row does not remount others. */
  id: number
  column: string
  operator: RowFilterOperator
  value: string
  value2: string
}

/** Props for {@link SqlSearchTab}. */
export interface SqlSearchTabProps {
  columns: ColumnInfo[]
  /** The conditions the last search ran with, so the form shows what produced the grid. */
  filters: RowFilter[]
  join: 'and' | 'or'
  loading: boolean
  /** Rows the last search matched, for the count line. */
  total?: number
  onSearch(filters: RowFilter[], join: 'and' | 'or'): void
  onError(message: string | undefined): void
}

/** Whether an operator takes no operand. */
function isUnary(operator: RowFilterOperator): boolean {
  return UNARY_FILTER_OPERATORS.includes(operator)
}

/** The operators that make sense for a column's declared type. */
export function operatorsFor(type: string): RowFilterOperator[] {
  const text = type.trim().toLowerCase()
  const orderLike = /^(tiny|small|medium|big)?(int|decimal|numeric|float|double|real|bit|year)|^(date|datetime|timestamp|time)/.test(text)
  const textual = /char|text|enum|set|json|blob|binary|uuid/.test(text)
  if (orderLike) {
    // An ordered type has no meaningful "contains": `LIKE` on an int casts it,
    // which cannot use an index and reads as a different question.
    return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'isNull', 'isNotNull']
  }
  if (textual) {
    return ['contains', 'notContains', 'startsWith', 'endsWith', 'eq', 'neq', 'in', 'isNull', 'isNotNull']
  }
  return [...ROW_FILTER_OPERATORS]
}

/** The 搜索 tab. */
export function SqlSearchTab(props: SqlSearchTabProps): React.ReactElement {
  const { columns, filters, join, loading, total, onSearch, onError } = props
  const nextId = React.useRef(1)
  /** The form's rows. Kept local so a half-typed condition is not a search. */
  const [rows, setRows] = React.useState<ConditionRow[]>([])
  const [localJoin, setLocalJoin] = React.useState<'and' | 'or'>(join)

  // The form follows what the last search ran with — including one issued from
  // elsewhere (a column's 非重复值 shortcut) — so the grid and the form never
  // disagree about what is being shown.
  React.useEffect(() => {
    setRows(filters.map(filter => ({
      id: nextId.current++,
      column: filter.column,
      operator: filter.operator,
      value: filter.value ?? '',
      value2: filter.value2 ?? '',
    })))
    setLocalJoin(join)
  }, [filters, join])

  const addRow = (): void => {
    const first = columns[0]
    setRows(current => [...current, {
      id: nextId.current++,
      column: first?.name ?? '',
      operator: first === undefined ? 'eq' : operatorsFor(first.type)[0] ?? 'eq',
      value: '',
      value2: '',
    }])
  }

  /** What the form would search for, or a message naming the first problem. */
  const toFilters = (): { filters: RowFilter[] } | { error: string } => {
    const out: RowFilter[] = []
    for (const [index, row] of rows.entries()) {
      if (row.column === '') return { error: t('search.needCondition') }
      if (isUnary(row.operator)) { out.push({ column: row.column, operator: row.operator }); continue }
      if (row.operator === 'between') {
        if (row.value.trim() === '' || row.value2.trim() === '') {
          return { error: t('search.needCondition') }
        }
        out.push({ column: row.column, operator: 'between', value: row.value, value2: row.value2 })
        continue
      }
      if (row.operator === 'in') {
        if (row.value.split(',').every(member => member.trim() === '')) return { error: t('search.needCondition') }
        out.push({ column: row.column, operator: 'in', value: row.value })
        continue
      }
      // An empty operand is refused rather than dropped: silently searching for
      // `= ''` when the user meant to type something is a wrong answer, and
      // silently ignoring the row makes the grid disagree with the form.
      if (row.value.trim() === '') return { error: t('search.needCondition') }
      out.push({ column: row.column, operator: row.operator, value: row.value })
      void index
    }
    if (out.length === 0) return { error: t('search.needCondition') }
    return { filters: out }
  }

  const submit = (): void => {
    const parsed = toFilters()
    if ('error' in parsed) { onError(parsed.error); return }
    onError(undefined)
    onSearch(parsed.filters, localJoin)
  }

  const update = (id: number, patch: Partial<ConditionRow>): void => {
    setRows(current => current.map(row => (row.id === id ? { ...row, ...patch } : row)))
  }

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    React.createElement(
      'div',
      { className: 'dbm-pad' },
      React.createElement('div', { className: 'dbm-hint' }, t('search.join')),
      React.createElement(
        'select',
        {
          className: 'dbm-select',
          style: { width: 180 },
          value: localJoin,
          onChange: (event: { target: { value: string } }) => setLocalJoin(event.target.value === 'or' ? 'or' : 'and'),
        },
        React.createElement('option', { value: 'and' }, t('search.join.and')),
        React.createElement('option', { value: 'or' }, t('search.join.or')),
      ),
      rows.length === 0
        ? React.createElement('div', { className: 'dbm-hint' }, t('search.noConditions'))
        : React.createElement(
            'div',
            { className: 'dbm-pad', style: { padding: 0 } },
            ...rows.map((row, index) => {
              const column = columns.find(candidate => candidate.name === row.column)
              const operators = column === undefined ? [...ROW_FILTER_OPERATORS] : operatorsFor(column.type)
              return React.createElement(
                'div',
                { key: row.id, className: 'dbm-row', 'data-dbm-condition': String(index) },
                React.createElement(
                  'select',
                  {
                    className: 'dbm-select',
                    'aria-label': t('search.column'),
                    value: row.column,
                    onChange: (event: { target: { value: string } }) => {
                      const next = columns.find(candidate => candidate.name === event.target.value)
                      // The operator list depends on the type, so switching to a
                      // column that cannot do `contains` moves the operator to one
                      // it can rather than leaving an invalid pair selected.
                      const allowed = next === undefined ? [...ROW_FILTER_OPERATORS] : operatorsFor(next.type)
                      update(row.id, {
                        column: event.target.value,
                        operator: allowed.includes(row.operator) ? row.operator : allowed[0] ?? 'eq',
                      })
                    },
                  },
                  columns.map(candidate => React.createElement('option', { key: candidate.name, value: candidate.name },
                    `${candidate.name}（${candidate.type === '' ? t('common.none') : candidate.type}）`)),
                ),
                React.createElement(
                  'select',
                  {
                    className: 'dbm-select',
                    'aria-label': t('search.operator'),
                    value: row.operator,
                    onChange: (event: { target: { value: string } }) => update(row.id, { operator: event.target.value as RowFilterOperator }),
                  },
                  operators.map(operator => React.createElement('option', { key: operator, value: operator }, t(`search.op.${operator}` as never))),
                ),
                isUnary(row.operator)
                  ? null
                  : React.createElement('input', {
                      className: 'dbm-input',
                      style: { flex: 1, minWidth: 120 },
                      value: row.value,
                      'aria-label': t('search.value'),
                      placeholder: row.operator === 'in' ? t('search.valuePlaceholder.in') : t('search.valuePlaceholder'),
                      ...(row.operator === 'in' ? {} : {
                        // A numeric or date column gets the browser's own stepper
                        // and picker, which is what keeps a typed date in the
                        // format the engine parses.
                        ...(column === undefined ? {} : inputHints(column)),
                      }),
                      onChange: (event: { target: { value: string } }) => update(row.id, { value: event.target.value }),
                      onKeyDown: (event: { key: string; preventDefault(): void }) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        submit()
                      },
                    }),
                row.operator === 'between'
                  ? [
                      React.createElement('span', { key: 'sep', className: 'dbm-hint' }, '—'),
                      React.createElement('input', {
                        key: 'value2',
                        className: 'dbm-input',
                        style: { flex: 1, minWidth: 100 },
                        value: row.value2,
                        'aria-label': t('search.value2'),
                        placeholder: t('search.value2'),
                        ...(column === undefined ? {} : inputHints(column)),
                        onChange: (event: { target: { value: string } }) => update(row.id, { value2: event.target.value }),
                      }),
                    ]
                  : null,
                React.createElement('button', {
                  type: 'button',
                  className: 'dbm-btn dbm-btn-sm dbm-btn-danger',
                  title: t('search.removeCondition'),
                  onClick: () => setRows(current => current.filter(candidate => candidate.id !== row.id)),
                }, '✕'),
              )
            }),
          ),
      React.createElement(
        'div',
        { className: 'dbm-row' },
        React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', onClick: addRow }, `+ ${t('search.addCondition')}`),
        React.createElement('button', {
          type: 'button',
          className: 'dbm-btn dbm-btn-sm dbm-btn-primary',
          disabled: loading || columns.length === 0,
          onClick: submit,
        }, loading ? t('common.loading') : t('search.run')),
        React.createElement('button', {
          type: 'button',
          className: 'dbm-btn dbm-btn-sm',
          disabled: rows.length === 0,
          onClick: () => { setRows([]); onError(undefined); onSearch([], localJoin) },
        }, t('search.reset')),
        React.createElement('span', { className: 'dbm-spacer' }),
        total === undefined ? null : React.createElement('span', { className: 'dbm-hint' }, t('search.matched', { n: total })),
      ),
    ),
    React.createElement(
      'div',
      { className: 'dbm-pad' },
      React.createElement('div', { className: 'dbm-hint' }, t('search.hint')),
    ),
  )
}

/** The `inputMode` / `type` a browser needs for a column's declared type. */
function inputHints(column: ColumnInfo): Record<string, string> {
  const type = column.type.trim().toLowerCase()
  if (/^(tiny|small|medium|big)?(int|bit|year)/.test(type)) return { inputMode: 'numeric' }
  if (/^(decimal|numeric|float|double|real)/.test(type)) return { inputMode: 'decimal' }
  if (/^date$/.test(type)) return { type: 'date' }
  if (/^datetime|^timestamp/.test(type)) return { type: 'datetime-local' }
  if (/^time$/.test(type)) return { type: 'time' }
  return {}
}

/** The 搜索 tab's empty-result placeholder, re-exported for the view's use. */
export function SearchEmpty(): React.ReactElement {
  return React.createElement(Empty, { message: t('browse.empty') })
}
