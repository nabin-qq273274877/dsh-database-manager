import * as React from 'react'
/**
 * The 浏览 tab: a paged, sortable data grid with phpMyAdmin's row operations.
 *
 * The operations and the reasoning behind each:
 *
 * - **Double-click a cell to edit it.** `ENTER`/`Tab` and losing focus both save;
 *   `Escape` cancels. Editing in place is what makes a data grid usable for
 *   fixing one value — a modal per cell would need a click to open, a click to
 *   submit and a re-read in between.
 * - **Sort by an index.** A table with no primary key still has indexes, and
 *   sorting by one is how a user asks "show me the duplicates" or "is this index
 *   actually used". The list comes from the table's own indexes.
 * - **Multi-select with batch delete.** Restricted to tables that have a primary
 *   key: a row is identified by its key, and without one a "delete these three"
 *   has no way to say WHICH three — a match on every column would also delete a
 *   duplicate row the user never selected.
 * - **Go to a page by number.** The page count is unbounded on a large table, so
 *   a field is what a user with a specific page in mind actually wants.
 */

import type { ColumnInfo, IndexInfo, RowFilter, TablePage } from '../protocol.ts'
import type { DbApi } from './api.ts'
import {
  Empty,
  ErrorBanner,
  Modal,
  PageJump,
  SortMark,
  copyText,
  isNull,
  renderCell,
  t,
} from './ui.ts'

/** One row's identity, as the wire represents it. */
type KeyValue = string | number | boolean | null

/** A row's primary key, ready to send as `RowKey[]`. */
type RowKey = Array<{ column: string; value: KeyValue }>

/** Layout of one browse read; kept out of state so a reload cannot lose it. */
export interface BrowseQuery {
  page: number
  pageSize: number
  orderBy?: string
  orderByColumns?: string[]
  orderDir: 'asc' | 'desc'
  filters?: RowFilter[]
  filterJoin?: 'and' | 'or'
}

/** Props for {@link SqlBrowseTab}. */
export interface SqlBrowseTabProps {
  api: DbApi
  sourceId: string
  schema: string
  table: string
  /** The page as loaded last, or undefined while the first read is in flight. */
  rows: { page: TablePage; loading: boolean; error?: string } | undefined
  /** The read that produced `rows`, so a reload repeats it exactly. */
  query: BrowseQuery
  /** The current search conditions, so they survive a page change and an edit. */
  onQuery(next: Partial<BrowseQuery>): void
  /** Re-read the current page, after a write that invalidated it. */
  onReload(): void
  /** Open the export dialog for the whole table, or for the selected rows. */
  onExport(options?: { rowsOnly?: boolean; selectedKeys?: RowKey[] }): void
  /** Open the import dialog. */
  onImport(): void
  /** Structure changes elsewhere may have changed the table; reported upward. */
  onNotice(message: string | undefined): void
  onError(message: string | undefined): void
  /** Whether the 结构 tab has loaded this table's columns (a fallback source). */
  knownColumns?: ColumnInfo[]
}

/**
 * Whether a set of key columns can identify a row.
 *
 * The primary key is what makes row editing and batch deletion well defined: a
 * row is addressed by its key, so a table without one cannot have either. A
 * UNIQUE index is deliberately NOT accepted as a substitute — it may hold NULLs,
 * and `IS ?` would then match every row with a NULL in that column.
 */
export function rowKeyOf(columns: ColumnInfo[], primaryKey: string[], row: Record<string, KeyValue>): RowKey | undefined {
  if (primaryKey.length === 0) return undefined
  const known = new Set(columns.map(column => column.name))
  if (!primaryKey.every(name => known.has(name))) return undefined
  return primaryKey.map(column => ({ column, value: row[column] ?? null }))
}

/** The SQL text of one value, as phpMyAdmin's 复制 provides it. */
function cellText(value: KeyValue): string {
  return value === null ? '' : String(value)
}

/**
 * The type classifiers, re-exported so call sites keep one import.
 *
 * They live in `column-kinds.ts` (no React, no i18n) because the RULES are what
 * is worth testing, and a component cannot be reached by a unit test without a
 * DOM.
 */
export { isNumericType, isDateType, isBooleanType, fieldKind, operatorsFor } from './column-kinds.ts'

/** The 浏览 tab. */
export function SqlBrowseTab(props: SqlBrowseTabProps): React.ReactElement {
  const { api, sourceId, schema, table, rows, query, onQuery, onReload, onExport, onImport, onNotice, onError } = props
  /** The cell being edited, by row index and column name. */
  const [editing, setEditing] = React.useState<{ row: number; column: string; value: string } | undefined>(undefined)
  /** Keys of the rows selected for a batch action, serialized for set membership. */
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [confirming, setConfirming] = React.useState<{ kind: 'row' | 'batch'; keys: RowKey[] } | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)

  const page = rows?.page
  const columns = page?.columns ?? props.knownColumns ?? []
  const primaryKey = page?.primaryKey ?? []
  const indexes = page?.indexes ?? []
  // A read is in flight: the grid keeps its rows (they are still the best
  // information available) but every control that would write is disabled.
  const loading = rows?.loading === true

  /** A stable string for one row's key, so a selection survives a re-read. */
  const keyId = React.useCallback((keys: RowKey | undefined): string | undefined => {
    if (keys === undefined) return undefined
    return keys.map(key => `${key.column}=${key.value === null ? '\u0000null' : String(key.value)}`).join('\u0001')
  }, [])

  /**
   * A row's key from the loaded page.
   *
   * `rows.page.rows[index]` is the row the grid is showing, which is what the
   * user selected — reading the key from anywhere else would risk acting on a
   * row that has since moved between pages.
   */
  const keyAt = (index: number): RowKey | undefined => {
    const row = page?.rows[index]
    return row === undefined ? undefined : rowKeyOf(columns, primaryKey, row)
  }

  const selectedKeys = React.useMemo(() => {
    if (page === undefined) return [] as RowKey[]
    const out: RowKey[] = []
    for (const [index] of page.rows.entries()) {
      const keys = keyAt(index)
      const id = keyId(keys)
      if (keys !== undefined && id !== undefined && selected.has(id)) out.push(keys)
    }
    return out
  }, [page, selected, columns, primaryKey, keyId])

  // A selection is per PAGE, and per table: carrying it across a page change
  // would let "delete selected" act on rows the user can no longer see.
  React.useEffect(() => { setSelected(new Set()) }, [table, schema, page?.page, query.orderBy, query.orderByColumns, query.filters])

  /** Save one cell, addressed by its row's key. */
  const saveCell = async (index: number, column: string, value: string): Promise<void> => {
    const keys = keyAt(index)
    if (keys === undefined) {
      onError(t('browse.noPk'))
      return
    }
    setEditing(undefined)
    const current = page?.rows[index]?.[column] ?? null
    // An unchanged value is not worth a round trip, and reporting "saved" for one
    // that was not even sent would be a lie the user cannot check.
    if (String(current ?? '') === value) return
    setBusy(true)
    try {
      await api.updateRow(sourceId, {
        schema,
        table,
        values: [{ column, value }],
        keys,
      })
      onNotice(t('browse.cellSaved'))
      onError(undefined)
      onReload()
    } catch (failure) {
      onError(t('browse.cellSaveFailed', { error: failure instanceof Error ? failure.message : String(failure) }))
    } finally {
      setBusy(false)
    }
  }

  /** Delete one row, or every selected row, in one request. */
  const runDelete = async (keys: RowKey[]): Promise<void> => {
    setBusy(true)
    try {
      if (keys.length === 1) {
        await api.deleteRow(sourceId, { schema, table, keys: keys[0]! })
      } else {
        await api.deleteRows(sourceId, { schema, table, keySets: keys })
      }
      setConfirming(undefined)
      setSelected(new Set())
      onNotice(t('browse.deleteSelected'))
      onError(undefined)
      onReload()
    } catch (failure) {
      setConfirming(undefined)
      onError(t('db.action.failed', { error: failure instanceof Error ? failure.message : String(failure) }))
    } finally {
      setBusy(false)
    }
  }

  /** Ask the host how many distinct values one column holds. */
  const copyValue = async (value: KeyValue): Promise<void> => {
    const failure = await copyText(cellText(value))
    if (failure === null) {
      onNotice(t('browse.copied'))
      onError(undefined)
    } else {
      onError(t('browse.copyFailed', { error: failure }))
    }
  }

  /**
   * The sort list: one entry per index PER DIRECTION, the primary key first.
   *
   * Both directions are separate entries rather than a name plus a direction
   * toggle, because the direction is part of what is being chosen — "sort by
   * goodsid descending" is one decision, and splitting it across two controls
   * leaves the second one meaningless until the first is set.
   *
   * The label is `name (direction)` and deliberately NOT the index's column
   * list: the name identifies the index, and a long column list would push the
   * direction — the only part that differs between two adjacent rows — out of
   * view.
   */
  const sortOptions: Array<{ label: string; value: string; columns: string[]; dir: 'asc' | 'desc' }> = []
  const sortTargets: Array<{ name: string; columns: string[] }> = []
  if (primaryKey.length > 0) {
    // Named `PRIMARY`, which is what the key's own index is called. On SQLite the
    // implicit index is `sqlite_autoindex_<table>_<n>`; showing that name would
    // describe the storage rather than the thing the user is sorting by.
    sortTargets.push({ name: 'PRIMARY', columns: primaryKey })
  }
  for (const index of indexes) {
    if (index.columns.length === 0) continue
    // The primary key's own index is already listed as PRIMARY. Adding it again
    // would offer the same sort twice under two different names.
    if (index.primary === true) continue
    sortTargets.push({ name: index.name, columns: index.columns })
  }
  for (const target of sortTargets) {
    for (const dir of ['asc', 'desc'] as const) {
      sortOptions.push({
        label: `${target.name} (${dir === 'asc' ? t('browse.sortAsc') : t('browse.sortDesc')})`,
        // Direction and columns in one value, so selecting an entry carries both.
        // The separator is NUL, which cannot occur in an identifier.
        value: `${dir}\u0000${target.columns.join('\u0000')}`,
        columns: target.columns,
        dir,
      })
    }
  }
  const activeSort = query.orderByColumns === undefined
    ? undefined
    : sortOptions.find(option => option.dir === query.orderDir && option.columns.join('\u0000') === query.orderByColumns!.join('\u0000'))

  if (rows === undefined) return React.createElement(Empty, { message: t('common.loading') })
  if (rows.error !== undefined && page === undefined) return React.createElement(ErrorBanner, { message: rows.error })

  const pages = page === undefined ? 1 : Math.max(1, Math.ceil(page.total / page.pageSize))
  // Selection and in-cell editing both need a row KEY: a row is addressed by its primary
  // key, and without one there is no way to say which row a write means. A table with no
  // key is therefore browsable but not editable.
  const canSelectRows = primaryKey.length > 0
  const canEditCells = primaryKey.length > 0
  const canActOnRows = canSelectRows

  /** One action button in the 操作 cell. */
  const rowAction = (key: string, label: string, onClick: () => void, danger = false, title?: string): React.ReactElement =>
    React.createElement('button', {
      key,
      type: 'button',
      className: `dbm-row-action${danger ? ' dbm-row-action-danger' : ''}`,
      disabled: busy,
      ...(title === undefined ? {} : { title }),
      onClick,
    }, label)

  const header: unknown[] = []
  if (canActOnRows) {
    const allSelected = page !== undefined && page.rows.length > 0 && selectedKeys.length === page.rows.length
    header.push(
      React.createElement(
        'th',
        { key: '__select', className: 'dbm-select-col' },
        React.createElement('input', {
          type: 'checkbox',
          checked: allSelected,
          disabled: page === undefined || page.rows.length === 0,
          'aria-label': t('browse.selectAll'),
          title: allSelected ? t('browse.selectNone') : t('browse.selectAll'),
          onChange: (event: { target: { checked: boolean } }) => {
            if (page === undefined) return
            if (!event.target.checked) { setSelected(new Set()); return }
            const next = new Set<string>()
            for (const [index] of page.rows.entries()) {
              const id = keyId(keyAt(index))
              if (id !== undefined) next.add(id)
            }
            setSelected(next)
          },
        }),
      ),
    )
  }
  for (const column of page?.columns ?? []) {
    const sorted = query.orderBy === column.name
    header.push(
      React.createElement(
        'th',
        { key: column.name },
        React.createElement(
          'button',
          {
            type: 'button',
            title: t('browse.sortByColumn'),
            onClick: () => {
              // Same column: flip the direction. A different column starts
              // ascending, which is what a header click means everywhere else.
              const nextDir = sorted && query.orderDir === 'asc' ? 'desc' : 'asc'
              onQuery({ page: 1, orderBy: column.name, orderByColumns: undefined, orderDir: nextDir })
            },
          },
          column.name,
          React.createElement(SortMark, { direction: sorted ? query.orderDir : 'none' }),
        ),
      ),
    )
  }
  header.push(React.createElement('th', { key: '__actions', className: 'dbm-row-actions' }, t('browse.actions')))

  const body: unknown[] = []
  for (const [index, row] of (page?.rows ?? []).entries()) {
    const keys = keyAt(index)
    const id = keyId(keys)
    const isSelected = id !== undefined && selected.has(id)
    const cells: unknown[] = []
    if (canActOnRows) {
      cells.push(
        React.createElement(
          'td',
          { key: '__select', className: 'dbm-select-col' },
          React.createElement('input', {
            type: 'checkbox',
            checked: isSelected,
            disabled: id === undefined,
            'aria-label': t('browse.select'),
            onChange: (event: { target: { checked: boolean } }) => {
              if (id === undefined) return
              setSelected(current => {
                const next = new Set(current)
                if (event.target.checked) next.add(id)
                else next.delete(id)
                return next
              })
            },
          }),
        ),
      )
    }
    for (const column of page?.columns ?? []) {
      const value = row[column.name] ?? null
      const isEditing = editing !== undefined && editing.row === index && editing.column === column.name
      if (isEditing) {
        cells.push(
          React.createElement(
            'td',
            { key: column.name },
            /*
             * A one-line TEXTAREA, not an input.
             *
             * A text column can hold far more than a 380px cell shows, and an
             * `<input>` cannot grow: editing a long value meant seeing a few
             * characters at a time with no way to widen the view. A textarea
             * starts at one row and is `resize: vertical`, so the user drags it
             * taller when the value needs it — which is the only way to give "let
             * the user size it" without guessing a height in advance.
             *
             * Enter still saves (see onKeyDown) rather than inserting a newline:
             * inside a grid, Enter has always meant "commit this cell", and a
             * newline in the middle of a value is rare enough that Shift+Enter is
             * the better trade.
             */
            React.createElement('textarea', {
              className: 'dbm-cell-input',
              rows: 1,
              autoFocus: true,
              value: editing.value,
              'aria-label': column.name,
              spellcheck: false,
              onChange: (event: { target: { value: string } }) => setEditing({ row: index, column: column.name, value: event.target.value }),
              onKeyDown: (event: { key: string; preventDefault(): void; currentTarget: { value: string }; shiftKey: boolean }) => {
                if (event.key === 'Escape') { event.preventDefault(); setEditing(undefined); return }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void saveCell(index, column.name, event.currentTarget.value)
                }
              },
              /*
               * Losing focus saves, which is what makes the gesture a single
               * action rather than one that needs a confirmation click.
               *
               * The value is read from the ELEMENT, not from `editing.value`.
               * The handler closes over the state of the render that created it,
               * so a blur arriving before React has committed a keystroke would
               * save the PREVIOUS value — and the unchanged-value guard in
               * `saveCell` would then skip the write entirely, silently discarding
               * the edit.
               */
              onBlur: (event: { target: { value: string } }) => { void saveCell(index, column.name, event.target.value) },
            }),
          ),
        )
        continue
      }
      cells.push(
        React.createElement(
          'td',
          {
            key: column.name,
            className: `${isNull(value) ? 'dbm-null' : ''}${canEditCells ? ' dbm-cell-editable' : ''}`.trim() || undefined,
            title: canEditCells ? t('browse.cellHint') : renderCell(value),
            ...(canEditCells ? { 'data-dbm-cell': `${index}:${column.name}` } : {}),
            ...(canEditCells
              ? {
                  onDoubleClick: () => {
                    setEditing({ row: index, column: column.name, value: value === null ? '' : String(value) })
                  },
                }
              : {}),
          },
          renderCell(value),
        ),
      )
    }
    cells.push(
      React.createElement(
        'td',
        { key: '__actions', className: 'dbm-row-actions' },
        React.createElement(
          'div',
          { className: 'dbm-actions' },
          rowAction('edit', t('browse.editRow'), () => {
            // 编辑 focuses the first cell, which is the behaviour a user gets
            // from a spreadsheet's Enter key and the fastest path to a change.
            const first = page?.columns[0]
            if (first === undefined) return
            setEditing({ row: index, column: first.name, value: row[first.name] === null ? '' : String(row[first.name] ?? '') })
          }, false, canActOnRows ? undefined : t('browse.noPk')),
          rowAction('copy', t('browse.copyCell'), () => { void copyValue(row[page?.columns[0]?.name ?? ''] ?? null) }),
          rowAction('copyRow', t('browse.copyRow'), () => {
            // The whole row as one tab-separated line, which is what pastes into
            // a spreadsheet as a row rather than as a single cell.
            const line = (page?.columns ?? []).map(column => cellText(row[column.name] ?? null)).join('\t')
            void copyText(line).then(failure => {
              if (failure === null) { onNotice(t('browse.copied')); onError(undefined) }
              else onError(t('browse.copyFailed', { error: failure }))
            })
          }, false, t('browse.copyRow')),
          rowAction('delete', t('browse.deleteRow'), () => {
            if (keys === undefined) { onError(t('browse.noPk')); return }
            setConfirming({ kind: 'row', keys: [keys] })
          }, true),
        ),
      ),
    )
    body.push(React.createElement('tr', { key: index, 'data-selected': String(isSelected) }, ...cells as never[]))
  }

  /**
   * The 搜索 tab's conditions, when the grid is showing a filtered read.
   *
   * Shown because the grid now receives searches from another tab: landing here with
   * "共 2 行" on a table of thousands is indistinguishable from a broken table unless
   * the page says the rows are filtered — and offers the way back to all of them. The
   * count is of CONDITIONS rather than of rows, because that is what the user typed.
   */
  const filterBar = (query.filters === undefined || query.filters.length === 0) ? null : React.createElement(
    'div',
    { className: 'dbm-batch-bar', 'data-dbm-browse-filters': '' },
    React.createElement('span', null, t('browse.filtered', { n: query.filters.length })),
    ...query.filters.map(filter => React.createElement('span', { key: filter.column, className: 'dbm-hint dbm-mono' },
      `${filter.column} ${t(`search.op.${filter.operator}` as never)}${filter.value === undefined ? '' : ` ${filter.value}`}`)),
    React.createElement('span', { className: 'dbm-spacer' }),
    React.createElement('button', {
      type: 'button',
      className: 'dbm-btn dbm-btn-sm',
      'data-dbm-browse-clear-filters': '',
      onClick: () => onQuery({ page: 1, filters: undefined, filterJoin: undefined }),
    }, t('browse.clearFilters')),
  )

  const toolbar = React.createElement(
    'div',
    { className: 'dbm-row', style: { padding: '8px 12px' } },
    React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', disabled: loading, onClick: onReload }, t('browse.refresh')),
    React.createElement('label', { className: 'dbm-hint' }, `${t('browse.pageSize')}:`),
    React.createElement(
      'select',
      {
        className: 'dbm-select',
        value: String(query.pageSize),
        onChange: (event: { target: { value: string } }) => onQuery({ page: 1, pageSize: Number(event.target.value) }),
      },
      [50, 100, 200, 500, 1000].map(size => React.createElement('option', { key: size, value: String(size) }, String(size))),
    ),
    sortOptions.length === 0
      ? null
      : [
          React.createElement('label', { key: 'sortlabel', className: 'dbm-hint' }, `${t('browse.sortByIndex')}:`),
          React.createElement(
            'select',
            {
              key: 'sort',
              className: 'dbm-select',
              // The entry that is currently in effect; 「无」 when the page is
              // unsorted or sorted by a column header instead (a header click
              // sets `orderBy`, which is not one of these entries).
              value: activeSort === undefined ? '' : activeSort.value,
              title: t('browse.sortTitle'),
              onChange: (event: { target: { value: string } }) => {
                const value = event.target.value
                // 「无」 clears the sort entirely, so the read falls back to the
                // engine's own row order.
                if (value === '') { onQuery({ page: 1, orderByColumns: undefined, orderBy: undefined }); return }
                const [dir, ...columns] = value.split('\u0000')
                onQuery({
                  page: 1,
                  // A header sort and an index sort are exclusive: the driver
                  // prefers `orderByColumns`, so leaving `orderBy` set would make
                  // the header appear to do nothing.
                  orderBy: undefined,
                  orderByColumns: columns,
                  orderDir: dir === 'desc' ? 'desc' : 'asc',
                })
              },
            },
            [
              ...sortOptions.map(option => React.createElement('option', { key: option.value, value: option.value }, option.label)),
              // 「无」 sits LAST, so the list opens on the indexes and the way to
              // turn sorting off is at the end rather than in the way.
              React.createElement('option', { key: '__none__', value: '' }, t('browse.sortIndexNone')),
            ],
          ),
        ],
    React.createElement('span', { className: 'dbm-hint' }, page === undefined ? '' : t('browse.total', { n: page.total })),
    React.createElement('span', { className: 'dbm-spacer' }),
    React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', onClick: () => onExport() }, t('export.title')),
    React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', onClick: onImport }, t('import.title')),
    loading ? React.createElement('span', { className: 'dbm-hint' }, t('common.loading')) : null,
  )

  const batchBar = selectedKeys.length === 0 ? null : React.createElement(
    'div',
    { className: 'dbm-batch-bar' },
    React.createElement('span', null, t('browse.selected', { n: selectedKeys.length })),
    React.createElement('button', {
      type: 'button',
      className: 'dbm-btn dbm-btn-sm dbm-btn-danger',
      disabled: busy,
      onClick: () => setConfirming({ kind: 'batch', keys: selectedKeys }),
    }, t('browse.deleteSelected')),
    React.createElement('button', {
      type: 'button',
      className: 'dbm-btn dbm-btn-sm',
      onClick: () => onExport({ rowsOnly: true, selectedKeys }),
    }, t('browse.exportSelected')),
    React.createElement('span', { className: 'dbm-spacer' }),
    React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', onClick: () => setSelected(new Set()) }, t('browse.selectNone')),
  )

  const pager = React.createElement(
    'div',
    { className: 'dbm-pager' },
    React.createElement('button', {
      type: 'button',
      className: 'dbm-btn dbm-btn-sm',
      disabled: page === undefined || page.page <= 1 || loading,
      onClick: () => onQuery({ page: Math.max(1, (page?.page ?? 1) - 1) }),
    }, t('browse.prev')),
    React.createElement('span', null, page === undefined ? '' : t('browse.page', { page: page.page, pages })),
    React.createElement('button', {
      type: 'button',
      className: 'dbm-btn dbm-btn-sm',
      disabled: page === undefined || page.page >= pages || loading,
      onClick: () => onQuery({ page: Math.min(pages, (page?.page ?? 1) + 1) }),
    }, t('browse.next')),
    React.createElement(PageJump, {
      page: page?.page ?? 1,
      pages,
      onGo: next => onQuery({ page: next }),
    }),
    page === undefined || page.total === 0
      ? null
      : React.createElement('span', { className: 'dbm-hint' }, t('browse.rowCount', {
          from: (page.page - 1) * page.pageSize + 1,
          to: (page.page - 1) * page.pageSize + page.rows.length,
          total: page.total,
        })),
    !canActOnRows && page !== undefined && page.columns.length > 0
      ? React.createElement('span', { className: 'dbm-hint' }, t('browse.noPk'))
      : null,
  )

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    toolbar,
    // A read error is shown above the grid rather than replacing it: the rows on
    // screen are still the last good answer, and blanking them would lose the
    // user's place for a transient failure.
    rows.error === undefined ? null : React.createElement(ErrorBanner, { message: rows.error }),
    filterBar,
    batchBar,
    page === undefined || page.columns.length === 0
      ? React.createElement(Empty, { message: t('browse.empty') })
      : React.createElement(
          'div',
          { className: 'dbm-data' },
          React.createElement(
            'table',
            null,
            React.createElement('thead', null, React.createElement('tr', null, ...header as never[])),
            React.createElement('tbody', null, ...body as never[]),
          ),
        ),
    pager,
    confirming === undefined
      ? null
      : React.createElement(Modal, {
          title: confirming.kind === 'row' ? t('browse.deleteRow') : t('browse.deleteManyTitle'),
          onClose: () => setConfirming(undefined),
          footer: [
            React.createElement('button', { key: 'cancel', type: 'button', className: 'dbm-btn', disabled: busy, onClick: () => setConfirming(undefined) }, t('common.cancel')),
            React.createElement('button', {
              key: 'ok',
              type: 'button',
              className: 'dbm-btn dbm-btn-danger',
              disabled: busy,
              onClick: () => { void runDelete(confirming.keys) },
            }, busy ? t('common.loading') : t('browse.deleteRow')),
          ],
          children: React.createElement(
            'div',
            null,
            confirming.kind === 'row'
              ? t('delete.confirm')
              : t('browse.deleteManyBody', { n: confirming.keys.length }),
          ),
        }),
  )
}
