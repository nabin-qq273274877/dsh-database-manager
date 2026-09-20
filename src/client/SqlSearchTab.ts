import * as React from 'react'
/**
 * The 搜索 tab: phpMyAdmin's "query by example" page, not a SQL box.
 *
 * The shape is phpMyAdmin's own, because that is the page it is modelled on and
 * the one users arrive knowing (see the screenshot in the README): ONE ROW PER
 * COLUMN of the table, under a header of 字段 / 类型 / 排序规则 / 运算符 / 值.
 * You fill in the row you are interested in and leave the rest alone; only the
 * rows with a value take part in the search. There is no "add a condition" step
 * and no column picker — every column is already on the page.
 *
 * Four behaviours are phpMyAdmin's and are deliberate:
 *
 *   - **An empty value means "do not use this row".** Nothing typed → the row
 *     contributes no condition. Checking a row's operand with a typo left in a
 *     different row must not refuse the search.
 *   - **No conditions at all is not an error** — it shows every row. phpMyAdmin
 *     builds no `WHERE` clause in that case, and so does this: the request is sent
 *     with an empty filter list, which the drivers already read as "no filter".
 *   - **Conditions are combined with AND**, with no per-row connector and no
 *     parenthesis nesting. phpMyAdmin joins its own criteria that way
 *     (`implode(' AND ', …)`) and offers no OR, so a control implying otherwise
 *     would promise a grouping the request shape does not carry. A query that needs
 *     OR belongs in the SQL tab.
 *   - **A row with a unary operator needs no value** (`为空` / `不为空`), which is
 *     the one case where an empty operand still means something.
 *
 * Everything else follows the rules already in this plugin: every operand is a
 * bound parameter, the operator decides the SQL shape (so `100%` searches for a
 * literal percent sign), and the value control follows the column's declared type
 * — a date gets the browser's date picker, an enum a list of exactly its members.
 * The SQL tab remains the escape hatch for a query this form cannot express.
 */

import type { ColumnInfo, RowFilter, RowFilterOperator } from '../protocol.ts'
import { inputHints, isUnaryOperator, searchOperators, searchValueKind } from './column-kinds.ts'
import { t } from './ui.ts'

/**
 * One column's criterion, as the user left it.
 *
 * Held keyed by COLUMN NAME rather than as a list of rows: the page shows every
 * column, in the table's own order, so a row cannot be added or removed — only the
 * operator and the operand of a row can change. A list would have to be kept in
 * step with the column list on every structural reload.
 */
interface Criterion {
  operator: RowFilterOperator
  value: string
  /** The upper bound of `介于`. */
  value2: string
}

/** Props for {@link SqlSearchTab}. */
export interface SqlSearchTabProps {
  columns: ColumnInfo[]
  /** The conditions the last search ran with, so the form shows what produced the grid. */
  filters: RowFilter[]
  loading: boolean
  /** Rows the last search matched, for the count line. */
  total?: number
  /** Send the criteria; an empty list means "no filter", i.e. every row. */
  onSearch(filters: RowFilter[]): void
  onError(message: string | undefined): void
  /**
   * The result grid, rendered by the caller.
   *
   * Passed in rather than built here because it is the 浏览 tab's grid in
   * read-only mode — the same paging, sorting and cell copy. A second grid
   * implementation would be a second place for those to differ.
   */
  results?: React.ReactNode
}

/** The starting operator for a column, so a fresh row is already usable. */
function firstOperator(column: ColumnInfo): RowFilterOperator {
  return searchOperators(column)[0] ?? 'eq'
}

/** The criteria a filter list represents, keyed by column. */
function criteriaFrom(filters: RowFilter[]): Record<string, Criterion> {
  const out: Record<string, Criterion> = {}
  for (const filter of filters) {
    out[filter.column] = {
      operator: filter.operator,
      value: filter.value ?? '',
      value2: filter.value2 ?? '',
    }
  }
  return out
}

/** The 搜索 tab. */
export function SqlSearchTab(props: SqlSearchTabProps): React.ReactElement {
  const { columns, filters, loading, total, onSearch, onError, results } = props
  /**
   * The typed criteria, keyed by column name.
   *
   * UNSET for a column means the user has not touched that row, which is what lets
   * the operator default follow the column's type without the state having to be
   * seeded for every column on every structural reload.
   */
  const [criteria, setCriteria] = React.useState<Record<string, Criterion>>(() => criteriaFrom(filters))

  /**
   * The form adopts a search issued from elsewhere — a column's 非重复值 shortcut,
   * or a cleared search — so the grid and the form never disagree about what is
   * being shown.
   *
   * Keyed on a SERIALIZATION of the filters rather than on the array: `filters` is a
   * fresh array on every parent render, so depending on it re-seeded the form
   * constantly and discarded what the user had typed.
   */
  const filterKey = JSON.stringify(filters)
  const lastApplied = React.useRef(filterKey)
  React.useEffect(() => {
    if (lastApplied.current === filterKey) return
    lastApplied.current = filterKey
    setCriteria(criteriaFrom(filters))
  }, [filterKey])

  const criterionOf = (column: ColumnInfo): Criterion =>
    criteria[column.name] ?? { operator: firstOperator(column), value: '', value2: '' }

  const update = (name: string, patch: Partial<Criterion>): void => {
    setCriteria(current => {
      const column = columns.find(candidate => candidate.name === name)
      const base = current[name] ?? { operator: column === undefined ? 'eq' as const : firstOperator(column), value: '', value2: '' }
      return { ...current, [name]: { ...base, ...patch } }
    })
  }

  /** Whether a row currently holds something that would become a condition. */
  const isUsed = (column: ColumnInfo, criterion: Criterion): boolean => {
    if (isUnaryOperator(criterion.operator)) return true
    if (criterion.operator === 'between') return criterion.value.trim() !== '' && criterion.value2.trim() !== ''
    if (criterion.operator === 'in') return criterion.value.split(',').some(member => member.trim() !== '')
    return criterion.value.trim() !== ''
  }

  /** The criteria to send. An empty list means "no filter". */
  const toFilters = (): RowFilter[] => {
    const out: RowFilter[] = []
    for (const column of columns) {
      const criterion = criterionOf(column)
      if (isUnaryOperator(criterion.operator)) {
        out.push({ column: column.name, operator: criterion.operator })
        continue
      }
      if (criterion.operator === 'between') {
        // A half-filled range is refused rather than sent: `BETWEEN a AND ''` is a
        // comparison against the empty string, which MySQL coerces to 0 and which
        // silently answers a different question than the one on screen.
        if (criterion.value.trim() === '' && criterion.value2.trim() === '') continue
        if (criterion.value.trim() === '' || criterion.value2.trim() === '') {
          throw new Error(t('search.betweenNeedsBoth', { column: column.name }))
        }
        out.push({ column: column.name, operator: 'between', value: criterion.value, value2: criterion.value2 })
        continue
      }
      if (!isUsed(column, criterion)) continue
      out.push({ column: column.name, operator: criterion.operator, value: criterion.value })
    }
    return out
  }

  const submit = (): void => {
    let parsed: RowFilter[]
    try {
      parsed = toFilters()
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure))
      return
    }
    onError(undefined)
    onSearch(parsed)
  }

  const clear = (): void => {
    setCriteria({})
    onError(undefined)
    onSearch([])
  }

  /** Whether any row currently holds a condition, for the 清空 button's state. */
  const usedCount = columns.filter(column => isUsed(column, criterionOf(column))).length

  /** One row's value control, which follows the column's declared type. */
  const valueControl = (column: ColumnInfo, criterion: Criterion): React.ReactNode => {
    if (isUnaryOperator(criterion.operator)) {
      // A unary operator IS the whole condition, so the cell shows what it means
      // rather than an input the engine would ignore.
      return React.createElement('span', { className: 'dbm-hint' }, t(`search.op.${criterion.operator}` as never))
    }
    const members = searchValueKind(column)
    const common = {
      className: 'dbm-input',
      'data-dbm-search-value': column.name,
      'aria-label': `${t('search.value')} — ${column.name}`,
    }
    const set = (value: string): void => update(column.name, { value })
    if (members.kind === 'members') {
      // A dropdown of exactly the declared members, like phpMyAdmin's. The blank
      // entry is how a row is left out of the search.
      return React.createElement(
        'select',
        {
          className: 'dbm-select dbm-search-value',
          'data-dbm-search-value': column.name,
          'aria-label': `${t('search.value')} — ${column.name}`,
          value: criterion.value,
          onChange: (event: { target: { value: string } }) => set(event.target.value),
        },
        [
          React.createElement('option', { key: '', value: '' }, ''),
          ...members.options.map(option => React.createElement('option', { key: option, value: option }, option)),
        ],
      )
    }
    return React.createElement('input', {
      ...common,
      value: criterion.value,
      // A numeric or date column gets the browser's own stepper and picker, which
      // is what keeps a typed date in the format the engine parses.
      ...inputHints(column),
      placeholder: criterion.operator === 'between'
        ? t('search.betweenFrom')
        : criterion.operator === 'in' ? t('search.valuePlaceholder.in') : t('search.valuePlaceholder'),
      onChange: (event: { target: { value: string } }) => set(event.target.value),
      onKeyDown: (event: { key: string; preventDefault(): void }) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        submit()
      },
    })
  }

  if (columns.length === 0) {
    return React.createElement('div', { className: 'dbm-pad dbm-hint' }, loading ? t('common.loading') : t('search.needStructure'))
  }

  return React.createElement(
    'div',
    { className: 'dbm-tab-body', 'data-dbm-search-page': '' },
    React.createElement(
      'div',
      { className: 'dbm-search-form' },
      React.createElement('div', { className: 'dbm-hint' }, t('search.qbeHint')),
      React.createElement(
        // Only this part scrolls, so the buttons below stay visible however many
        // columns the table has. See the styles for the measurement.
        'div',
        { className: 'dbm-search-scroll' },
        React.createElement(
          'table',
          { className: 'dbm-table dbm-search-table' },
        React.createElement(
          'thead',
          null,
          React.createElement(
            'tr',
            null,
            ...[
              t('search.column'),
              t('search.type'),
              t('search.collation'),
              t('search.operator'),
              t('search.value'),
            ].map(label => React.createElement('th', { key: label }, label)),
          ),
        ),
        React.createElement(
          'tbody',
          null,
          ...columns.map(column => {
            const criterion = criterionOf(column)
            const operators = searchOperators(column)
            const used = isUsed(column, criterion)
            return React.createElement(
              'tr',
              {
                key: column.name,
                'data-dbm-search-row': column.name,
                'data-used': String(used),
                'data-dbm-condition': column.name,
              },
              React.createElement('th', { scope: 'row', className: 'dbm-mono' }, column.name),
              React.createElement('td', { className: 'dbm-mono' }, column.type === '' ? t('common.none') : column.type),
              React.createElement('td', { className: 'dbm-mono' }, column.collation ?? t('common.none')),
              React.createElement(
                'td',
                null,
                React.createElement(
                  'select',
                  {
                    className: 'dbm-select dbm-search-operator',
                    'data-dbm-search-operator': column.name,
                    'aria-label': `${t('search.operator')} — ${column.name}`,
                    value: criterion.operator,
                    onChange: (event: { target: { value: string } }) => update(column.name, { operator: event.target.value as RowFilterOperator }),
                  },
                  operators.map(operator => React.createElement('option', { key: operator, value: operator }, t(`search.op.${operator}` as never))),
                ),
              ),
              React.createElement(
                'td',
                { className: 'dbm-search-value-cell' },
                valueControl(column, criterion),
                criterion.operator === 'between' && !isUnaryOperator(criterion.operator)
                  ? [
                      React.createElement('span', { key: 'sep', className: 'dbm-hint' }, '—'),
                      React.createElement('input', {
                        key: 'value2',
                        className: 'dbm-input',
                        style: { width: 120 },
                        value: criterion.value2,
                        'data-dbm-search-value2': column.name,
                        'aria-label': `${t('search.value2')} — ${column.name}`,
                        placeholder: t('search.betweenTo'),
                        ...inputHints(column),
                        onChange: (event: { target: { value: string } }) => update(column.name, { value2: event.target.value }),
                      }),
                    ]
                  : null,
              ),
            )
          }),
        ),
      ),
      ),
      React.createElement(
        'div',
        { className: 'dbm-row dbm-search-actions' },
        React.createElement('button', {
          type: 'button',
          className: 'dbm-btn dbm-btn-primary',
          disabled: loading,
          'data-dbm-search-run': '',
          onClick: submit,
        }, loading ? t('common.loading') : t('search.run')),
        React.createElement('button', {
          type: 'button',
          className: 'dbm-btn',
          disabled: usedCount === 0,
          'data-dbm-search-clear': '',
          onClick: clear,
        }, t('search.reset')),
        React.createElement('span', { className: 'dbm-spacer' }),
        usedCount === 0
          ? React.createElement('span', { className: 'dbm-hint', 'data-dbm-search-note': 'all' }, t('search.allRows'))
          : React.createElement('span', { className: 'dbm-hint' }, t('search.usedCount', { n: usedCount })),
        total === undefined ? null : React.createElement('span', { className: 'dbm-hint' }, t('search.matched', { n: total })),
      ),
      React.createElement('div', { className: 'dbm-hint' }, t('search.hint')),
    ),
    // The result grid, in its own scroll area so the form above keeps its height
    // and the rows get the rest of the tab.
    results === undefined ? null : React.createElement('div', { className: 'dbm-tab-body', style: { minHeight: 0 } }, results),
  )
}
