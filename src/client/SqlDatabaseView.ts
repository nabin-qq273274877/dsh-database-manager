import * as React from 'react'
/**
 * SQL database panel, styled after phpMyAdmin: a left tree of schemas and
 * tables, and a right area with 浏览 / 结构 / SQL / 搜索 / 插入 tabs.
 *
 * Used for both SQLite and MySQL — the two drivers expose the same contract, so
 * the only per-engine difference is the label of the schema level.
 */

import type { ColumnInfo, DataSourceSummary, IndexInfo, TableInfo, TablePage } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { ErrorBanner, Empty, Modal, TabStrip, isNull, renderCell, t } from './ui.ts'

/** The right-hand tabs of a SQL database panel. */
type SqlTab = 'browse' | 'structure' | 'sql' | 'search' | 'insert'

/** Props for {@link SqlDatabaseView}. */
export interface SqlDatabaseViewProps {
  api: DbApi
  source: DataSourceSummary
  /** Schemas known at connect time; refreshed by the view. */
  initialSchemas: string[]
  /** Leave the database panel and return to the list. */
  onBack(): void
}

/** One page of rows plus the mode that produced it. */
interface RowsState {
  page: TablePage
  loading: boolean
  error?: string
}

/** The SQL database panel. */
export function SqlDatabaseView(props: SqlDatabaseViewProps): React.ReactElement {
  const { api, source, initialSchemas, onBack } = props
  const [schemas, setSchemas] = React.useState<string[]>(initialSchemas)
  const [activeSchema, setActiveSchema] = React.useState<string | undefined>(initialSchemas[0])
  const [tables, setTables] = React.useState<TableInfo[]>([])
  const [tableFilter, setTableFilter] = React.useState('')
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [activeTable, setActiveTable] = React.useState<string | undefined>(undefined)
  const [tab, setTab] = React.useState<SqlTab>('browse')
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [notice, setNotice] = React.useState<string | undefined>(undefined)

  const [rows, setRows] = React.useState<RowsState | undefined>(undefined)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(200)
  const [orderBy, setOrderBy] = React.useState<string | undefined>(undefined)
  const [orderDir, setOrderDir] = React.useState<'asc' | 'desc'>('asc')

  const [columns, setColumns] = React.useState<ColumnInfo[]>([])
  const [indexes, setIndexes] = React.useState<IndexInfo[]>([])

  /** Refresh the schema list. */
  const loadSchemas = React.useCallback(async (): Promise<void> => {
    if (source.kind === 'sqlite') return
    try {
      const list = await api.schemas(source.id)
      const names = list.map(item => item.name)
      setSchemas(names)
      setActiveSchema(current => (current !== undefined && names.includes(current) ? current : names[0]))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [api, source.id, source.kind])

  /** Refresh the table list for one schema. */
  const loadTables = React.useCallback(async (schema: string | undefined): Promise<void> => {
    try {
      const list = await api.tables(source.id, schema)
      setTables(list)
      setActiveTable(current => (current !== undefined && list.some(item => item.name === current) ? current : undefined))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [api, source.id])

  React.useEffect(() => { void loadSchemas() }, [loadSchemas])
  React.useEffect(() => { void loadTables(activeSchema) }, [loadTables, activeSchema])

  /** Load one page of the active table. */
  const loadRows = React.useCallback(async (options: {
    table: string
    page: number
    pageSize: number
    mode: 'browse' | 'search'
    term?: string
    condition?: string
    orderBy?: string
    orderDir?: 'asc' | 'desc'
  }): Promise<void> => {
    setRows(current => ({ page: current?.page ?? emptyPage(), loading: true, ...(current?.error === undefined ? {} : { error: current.error }) }))
    try {
      const result = await api.rows(source.id, {
        ...(activeSchema === undefined ? {} : { schema: activeSchema }),
        table: options.table,
        page: options.page,
        pageSize: options.pageSize,
        mode: options.mode,
        ...(options.term === undefined ? {} : { term: options.term }),
        ...(options.condition === undefined ? {} : { condition: options.condition }),
        ...(options.orderBy === undefined ? {} : { orderBy: options.orderBy }),
        orderDir: options.orderDir ?? 'asc',
      })
      setRows({ page: result, loading: false })
      setColumns(result.columns)
    } catch (failure) {
      setRows(current => ({ page: current?.page ?? emptyPage(), loading: false, error: failure instanceof Error ? failure.message : String(failure) }))
    }
  }, [api, source.id, activeSchema])

  /** Load structure metadata for the active table. */
  const loadStructure = React.useCallback(async (table: string): Promise<void> => {
    try {
      const [cols, idx] = await Promise.all([
        api.columns(source.id, table, activeSchema),
        api.indexes(source.id, table, activeSchema).catch(() => [] as IndexInfo[]),
      ])
      setColumns(cols)
      setIndexes(idx)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [api, source.id, activeSchema])

  /** Open one table in the given tab. */
  const openTable = (table: string, nextTab: SqlTab = 'browse'): void => {
    setActiveTable(table)
    setTab(nextTab)
    setOrderBy(undefined)
    setPage(1)
    setError(undefined)
    setNotice(undefined)
    if (nextTab === 'structure') void loadStructure(table)
    if (nextTab === 'browse') void loadRows({ table, page: 1, pageSize, mode: 'browse' })
  }

  /** Switch tabs, loading whatever the target tab needs. */
  const changeTab = (next: SqlTab): void => {
    setTab(next)
    setError(undefined)
    setNotice(undefined)
    if (activeTable === undefined) return
    if (next === 'structure') void loadStructure(activeTable)
    if (next === 'browse') void loadRows({ table: activeTable, page: 1, pageSize, mode: 'browse' })
    if (next === 'insert') void loadStructure(activeTable)
  }

  const filteredTables = tables.filter(table => tableFilter === '' || table.name.toLowerCase().includes(tableFilter.toLowerCase()))

  // ---- left tree ---------------------------------------------------------
  const tree: unknown[] = []
  for (const schema of schemas.length === 0 ? [undefined] : schemas) {
    const label = schema ?? (source.kind === 'sqlite' ? 'main' : t('common.none'))
    const isOpen = expanded[label] ?? schemas.length <= 1
    if (schemas.length > 1 || source.kind !== 'sqlite') {
      tree.push(
        React.createElement(
          'button',
          {
            key: `schema-${label}`,
            type: 'button',
            className: 'dbm-tree-item',
            onClick: () => {
              setExpanded(current => ({ ...current, [label]: !isOpen }))
              setActiveSchema(schema)
            },
          },
          React.createElement('span', { className: 'dbm-tree-caret' }, isOpen ? '▾' : '▸'),
          React.createElement('span', { className: 'dbm-tree-name' }, label),
        ),
      )
    }
    if (!isOpen) continue
    if (activeSchema !== schema && schemas.length > 1) continue
    const list = filteredTables
    if (list.length === 0) {
      tree.push(React.createElement('div', { key: `empty-${label}`, className: 'dbm-tree-item dbm-tree-indent-1 dbm-hint' }, t('db.noTables')))
      continue
    }
    for (const table of list) {
      tree.push(
        React.createElement(
          'button',
          {
            key: `table-${label}-${table.name}`,
            type: 'button',
            className: 'dbm-tree-item dbm-tree-indent-1',
            'data-active': String(activeTable === table.name),
            title: table.comment ?? table.name,
            onClick: () => openTable(table.name),
          },
          React.createElement('span', { className: 'dbm-tree-caret' }, table.type === 'view' ? '◫' : '▤'),
          React.createElement('span', { className: 'dbm-tree-name' }, table.name),
          table.rows === undefined ? null : React.createElement('span', { className: 'dbm-tree-meta' }, String(table.rows)),
        ),
      )
    }
  }

  const left = React.createElement(
    'div',
    { className: 'dbm-side' },
    React.createElement(
      'div',
      { className: 'dbm-side-head' },
      React.createElement('input', {
        className: 'dbm-input',
        style: { flex: 1 },
        value: tableFilter,
        placeholder: t('db.searchTable'),
        onChange: (event: { target: { value: string } }) => setTableFilter(event.target.value),
      }),
      React.createElement('button', {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        title: t('common.refresh'),
        onClick: () => { void loadSchemas(); void loadTables(activeSchema) },
      }, '⟳'),
    ),
    React.createElement('div', { className: 'dbm-side-body' }, tree as never),
  )

  // ---- right area --------------------------------------------------------
  const body: unknown[] = []
  if (activeTable === undefined) {
    body.push(React.createElement(Empty, { key: 'empty', message: t('redis.selectKey') }))
  } else {
    body.push(
      React.createElement(TabStrip, {
        key: 'tabs',
        active: tab,
        tabs: [
          { id: 'browse' as SqlTab, label: t('tab.browse') },
          { id: 'structure' as SqlTab, label: t('tab.structure') },
          { id: 'sql' as SqlTab, label: t('tab.sql') },
          { id: 'search' as SqlTab, label: t('tab.search') },
          { id: 'insert' as SqlTab, label: t('tab.insert') },
        ],
        onChange: (next: SqlTab) => changeTab(next),
      }),
    )

    if (tab === 'browse') {
      body.push(React.createElement(BrowseTab, {
        key: 'browse-body',
        rows,
        orderBy,
        orderDir,
        pageSize,
        onSort: (column) => {
          const nextDir = orderBy === column && orderDir === 'asc' ? 'desc' : 'asc'
          setOrderBy(column)
          setOrderDir(nextDir)
          void loadRows({ table: activeTable, page, pageSize, mode: 'browse', orderBy: column, orderDir: nextDir })
        },
        onPage: (next) => {
          setPage(next)
          void loadRows({ table: activeTable, page: next, pageSize, mode: 'browse', ...(orderBy === undefined ? {} : { orderBy, orderDir }) })
        },
        onPageSize: (size) => {
          setPageSize(size)
          setPage(1)
          void loadRows({ table: activeTable, page: 1, pageSize: size, mode: 'browse' })
        },
        onRefresh: () => { void loadRows({ table: activeTable, page, pageSize, mode: 'browse', ...(orderBy === undefined ? {} : { orderBy, orderDir }) }) },
      }))
    }

    if (tab === 'structure') {
      body.push(React.createElement(StructureTab, { key: 'structure-body', columns, indexes }))
    }

    if (tab === 'sql') {
      body.push(
        React.createElement(SqlTabView, {
          key: 'sql-body',
          source,
          schema: activeSchema,
          api,
          onResult: (message) => { setNotice(message); setError(undefined) },
          onError: (message) => { setError(message); setNotice(undefined) },
        }),
      )
    }

    if (tab === 'search') {
      body.push(
        React.createElement(SearchTab, {
          key: 'search-body',
          onSearch: (payload) => {
            void loadRows({
              table: activeTable,
              page: 1,
              pageSize,
              mode: 'search',
              ...(payload.term === undefined ? {} : { term: payload.term }),
              ...(payload.condition === undefined ? {} : { condition: payload.condition }),
            })
          },
          rows,
        }),
      )
    }

    if (tab === 'insert') {
      body.push(
        React.createElement(InsertTab, {
          key: 'insert-body',
          api,
          source,
          schema: activeSchema,
          table: activeTable,
          columns,
          onDone: (message) => {
            setNotice(message)
            setError(undefined)
            void loadRows({ table: activeTable, page: 1, pageSize, mode: 'browse' })
          },
          onError: (message) => { setError(message); setNotice(undefined) },
        }),
      )
    }
  }

  return React.createElement(
    'div',
    { className: 'dbm-root' },
    React.createElement(
      'div',
      { className: 'dbm-header' },
      React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', onClick: onBack }, `← ${t('panel.close')}`),
      React.createElement('span', { className: 'dbm-title' }, source.name),
      React.createElement('span', { className: `dbm-badge dbm-badge-${source.kind}` }, source.kind),
      React.createElement('span', { className: 'dbm-subtitle dbm-mono' }, source.kind === 'sqlite' ? (source.file ?? '') : `${source.host ?? ''}:${source.port ?? ''}`),
    ),
    error === undefined ? null : React.createElement(ErrorBanner, { message: error }),
    notice === undefined ? null : React.createElement('div', { className: 'dbm-ok', style: { padding: '6px 14px' } }, notice),
    React.createElement('div', { className: 'dbm-split' }, left as never, React.createElement('div', { className: 'dbm-main' }, body as never)),
  )
}

/** An empty placeholder page for the first render. */
function emptyPage(): TablePage {
  return { columns: [], rows: [], total: 0, page: 1, pageSize: 200, primaryKey: [] }
}

/** The 浏览 tab: a paged, sortable data grid. */
function BrowseTab(props: {
  rows: RowsState | undefined
  orderBy: string | undefined
  orderDir: 'asc' | 'desc'
  pageSize: number
  onSort(column: string): void
  onPage(page: number): void
  onPageSize(size: number): void
  onRefresh(): void
}): React.ReactElement {
  const { rows, orderBy, orderDir, pageSize, onSort, onPage, onPageSize, onRefresh } = props
  if (rows === undefined) return React.createElement(Empty, { message: t('common.loading') })
  if (rows.error !== undefined) return React.createElement(ErrorBanner, { message: rows.error })

  const page = rows.page
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize))
  const columns = page.columns.map(column => column.name)

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    React.createElement(
      'div',
      { className: 'dbm-row', style: { padding: '8px 12px' } },
      React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', onClick: onRefresh }, t('browse.refresh')),
      React.createElement('label', { className: 'dbm-hint' }, `${t('browse.pageSize')}: ${''}`),
      React.createElement(
        'select',
        {
          className: 'dbm-select',
          value: String(pageSize),
          onChange: (event: { target: { value: string } }) => onPageSize(Number(event.target.value)),
        },
        [50, 100, 200, 500, 1000].map(size => React.createElement('option', { key: size, value: String(size) }, String(size))),
      ),
      React.createElement('span', { className: 'dbm-hint' }, t('browse.total', { n: page.total })),
      React.createElement('span', { className: 'dbm-spacer' }),
      rows.loading ? React.createElement('span', { className: 'dbm-hint' }, t('common.loading')) : null,
    ),
    page.columns.length === 0
      ? React.createElement(Empty, { message: t('browse.empty') })
      : React.createElement(
          'div',
          { className: 'dbm-data' },
          React.createElement(
            'table',
            null,
            React.createElement(
              'thead',
              null,
              React.createElement(
                'tr',
                null,
                page.columns.map(column =>
                  React.createElement(
                    'th',
                    { key: column.name },
                    React.createElement(
                      'button',
                      { type: 'button', onClick: () => onSort(column.name) },
                      `${column.name}${orderBy === column.name ? (orderDir === 'asc' ? ' ▲' : ' ▼') : ''}`,
                    ),
                  ),
                ),
              ),
            ),
            React.createElement(
              'tbody',
              null,
              page.rows.map((row, index) =>
                React.createElement(
                  'tr',
                  { key: index },
                  columns.map(column =>
                    React.createElement(
                      'td',
                      { key: column, className: isNull(row[column] ?? null) ? 'dbm-null' : undefined, title: renderCell(row[column] ?? null) },
                      renderCell(row[column] ?? null),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
    React.createElement(
      'div',
      { className: 'dbm-pager' },
      React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', disabled: page.page <= 1, onClick: () => onPage(page.page - 1) }, t('browse.prev')),
      React.createElement('span', null, t('browse.page', { page: page.page, pages })),
      React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', disabled: page.page >= pages, onClick: () => onPage(page.page + 1) }, t('browse.next')),
      page.primaryKey.length === 0 ? React.createElement('span', { className: 'dbm-hint' }, t('browse.noPk')) : null,
    ),
  )
}

/** The 结构 tab: columns and indexes. */
function StructureTab(props: { columns: ColumnInfo[]; indexes: IndexInfo[] }): React.ReactElement {
  const { columns, indexes } = props
  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    React.createElement(
      'div',
      { className: 'dbm-scroll' },
      React.createElement('div', { className: 'dbm-pad' }, React.createElement('strong', null, t('structure.columns'))),
      React.createElement(
        'table',
        { className: 'dbm-table' },
        React.createElement(
          'thead',
          null,
          React.createElement(
            'tr',
            null,
            ...[t('structure.col.name'), t('structure.col.type'), t('structure.col.nullable'), t('structure.col.key'), t('structure.col.default'), t('structure.col.extra'), t('structure.col.comment')].map(label =>
              React.createElement('th', { key: label }, label),
            ),
          ),
        ),
        React.createElement(
          'tbody',
          null,
          columns.map(column =>
            React.createElement(
              'tr',
              { key: column.name },
              React.createElement('td', { className: 'dbm-mono' }, column.name),
              React.createElement('td', { className: 'dbm-mono' }, column.type),
              React.createElement('td', null, column.nullable ? t('common.yes') : t('common.no')),
              React.createElement('td', null, column.key === '' ? t('common.none') : column.key),
              React.createElement('td', { className: 'dbm-mono' }, column.defaultValue ?? t('common.none')),
              React.createElement('td', { className: 'dbm-mono' }, column.extra ?? t('common.none')),
              React.createElement('td', null, column.comment ?? ''),
            ),
          ),
        ),
      ),
      React.createElement('div', { className: 'dbm-pad' }, React.createElement('strong', null, t('structure.indexes'))),
      indexes.length === 0
        ? React.createElement('div', { className: 'dbm-pad dbm-hint' }, t('structure.noIndexes'))
        : React.createElement(
            'table',
            { className: 'dbm-table' },
            React.createElement(
              'thead',
              null,
              React.createElement(
                'tr',
                null,
                ...[t('structure.index.name'), t('structure.index.unique'), t('structure.index.columns'), t('structure.index.type')].map(label =>
                  React.createElement('th', { key: label }, label),
                ),
              ),
            ),
            React.createElement(
              'tbody',
              null,
              indexes.map(index =>
                React.createElement(
                  'tr',
                  { key: index.name },
                  React.createElement('td', { className: 'dbm-mono' }, index.name),
                  React.createElement('td', null, index.unique ? t('common.yes') : t('common.no')),
                  React.createElement('td', { className: 'dbm-mono' }, index.columns.join(', ')),
                  React.createElement('td', null, index.type ?? t('common.none')),
                ),
              ),
            ),
          ),
    ),
  )
}

/** The SQL tab: an editor plus its result grid. */
function SqlTabView(props: {
  api: DbApi
  source: DataSourceSummary
  schema: string | undefined
  onResult(message: string): void
  onError(message: string): void
}): React.ReactElement {
  const { api, source, schema, onResult, onError } = props
  const [sql, setSql] = React.useState('')
  const [allowWrite, setAllowWrite] = React.useState(false)
  const [result, setResult] = React.useState<{ columns: string[]; rows: Array<Array<string | number | boolean | null>>; message: string } | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)

  const run = async (): Promise<void> => {
    if (sql.trim() === '') return
    setBusy(true)
    setResult(undefined)
    try {
      const value = await api.runSql(source.id, {
        sql,
        ...(schema === undefined ? {} : { schema }),
        allowWrite,
      })
      if (value.write) {
        setResult({ columns: [], rows: [], message: t('sql.affected', { n: value.affected, ms: value.durationMs }) })
        onResult(t('sql.affected', { n: value.affected, ms: value.durationMs }))
      } else {
        const message = `${t('sql.rows', { n: value.rows.length, ms: value.durationMs })}${value.truncated ? ` · ${t('sql.truncated')}` : ''}`
        setResult({ columns: value.columns, rows: value.rows, message })
        onResult(message)
      }
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    React.createElement(
      'div',
      { className: 'dbm-pad' },
      React.createElement('textarea', {
        className: 'dbm-textarea',
        rows: 6,
        value: sql,
        placeholder: t('sql.placeholder'),
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => setSql(event.target.value),
        onKeyDown: (event: { key: string; ctrlKey: boolean; metaKey: boolean; preventDefault(): void }) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void run()
          }
        },
      }),
      React.createElement(
        'div',
        { className: 'dbm-row' },
        React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-primary', disabled: busy, onClick: () => { void run() } }, busy ? t('sql.running') : t('sql.run')),
        React.createElement(
          'label',
          { className: 'dbm-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: allowWrite,
            onChange: (event: { target: { checked: boolean } }) => setAllowWrite(event.target.checked),
          }),
          t('sql.allowWrite'),
        ),
        React.createElement('span', { className: 'dbm-hint' }, t('sql.allowWrite.hint')),
      ),
    ),
    result === undefined
      ? null
      : React.createElement(
          'div',
          { className: 'dbm-tab-body', style: { minHeight: 0 } },
          React.createElement('div', { className: 'dbm-pad dbm-hint' }, result.message),
          result.columns.length === 0
            ? null
            : React.createElement(
                'div',
                { className: 'dbm-data' },
                React.createElement(
                  'table',
                  null,
                  React.createElement('thead', null, React.createElement('tr', null, result.columns.map(column => React.createElement('th', { key: column }, column)))),
                  React.createElement(
                    'tbody',
                    null,
                    result.rows.map((row, index) =>
                      React.createElement(
                        'tr',
                        { key: index },
                        row.map((cell, cellIndex) =>
                          React.createElement(
                            'td',
                            { key: cellIndex, className: isNull(cell) ? 'dbm-null' : undefined, title: renderCell(cell) },
                            renderCell(cell),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
        ),
  )
}

/** The 搜索 tab: free-text across text columns, or a raw WHERE condition. */
function SearchTab(props: {
  onSearch(payload: { term?: string; condition?: string }): void
  rows: RowsState | undefined
}): React.ReactElement {
  const { onSearch, rows } = props
  const [term, setTerm] = React.useState('')
  const [condition, setCondition] = React.useState('')

  const submit = (): void => {
    if (condition.trim() !== '') onSearch({ condition: condition.trim() })
    else if (term.trim() !== '') onSearch({ term: term.trim() })
  }

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    React.createElement(
      'div',
      { className: 'dbm-pad' },
      React.createElement(
        'div',
        { className: 'dbm-row' },
        React.createElement('input', {
          className: 'dbm-input',
          style: { flex: 1, minWidth: 200 },
          value: term,
          placeholder: t('search.placeholder'),
          onChange: (event: { target: { value: string } }) => setTerm(event.target.value),
          onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') submit() },
        }),
        React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-primary', onClick: submit }, t('search.run')),
      ),
      React.createElement(
        'div',
        { className: 'dbm-row' },
        React.createElement('span', { className: 'dbm-hint' }, t('search.condition')),
        React.createElement('input', {
          className: 'dbm-input dbm-mono',
          style: { flex: 1 },
          value: condition,
          placeholder: t('search.conditionPlaceholder'),
          spellcheck: false,
          onChange: (event: { target: { value: string } }) => setCondition(event.target.value),
          onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') submit() },
        }),
      ),
    ),
    rows === undefined
      ? null
      : rows.error !== undefined
        ? React.createElement(ErrorBanner, { message: rows.error })
        : React.createElement(
            'div',
            { className: 'dbm-tab-body', style: { minHeight: 0 } },
            React.createElement('div', { className: 'dbm-pad dbm-hint' }, t('browse.total', { n: rows.page.total })),
            React.createElement(
              'div',
              { className: 'dbm-data' },
              React.createElement(
                'table',
                null,
                React.createElement('thead', null, React.createElement('tr', null, rows.page.columns.map(column => React.createElement('th', { key: column.name }, column.name)))),
                React.createElement(
                  'tbody',
                  null,
                  rows.page.rows.map((row, index) =>
                    React.createElement(
                      'tr',
                      { key: index },
                      rows.page.columns.map(column =>
                        React.createElement(
                          'td',
                          { key: column.name, className: isNull(row[column.name] ?? null) ? 'dbm-null' : undefined, title: renderCell(row[column.name] ?? null) },
                          renderCell(row[column.name] ?? null),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
  )
}

/** The 插入 tab: one row form derived from the table's columns. */
function InsertTab(props: {
  api: DbApi
  source: DataSourceSummary
  schema: string | undefined
  table: string
  columns: ColumnInfo[]
  onDone(message: string): void
  onError(message: string): void
}): React.ReactElement {
  const { api, source, schema, table, columns, onDone, onError } = props
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [useNull, setUseNull] = React.useState<Record<string, boolean>>({})
  const [busy, setBusy] = React.useState(false)

  const submit = async (): Promise<void> => {
    // Only the columns the user actually filled are sent, so the engine applies
    // its own defaults for everything else.
    const payload: Array<{ column: string; value: string | null }> = []
    for (const column of columns) {
      const raw = values[column.name] ?? ''
      if (useNull[column.name] === true) payload.push({ column: column.name, value: null })
      else if (raw !== '') payload.push({ column: column.name, value: raw })
      else if (!column.nullable && column.defaultValue === undefined) {
        onError(t('insert.required', { column: column.name }))
        return
      }
    }
    if (payload.length === 0) {
      onError(t('insert.required', { column: columns[0]?.name ?? table }))
      return
    }
    setBusy(true)
    try {
      const result = await api.insertRow(source.id, {
        ...(schema === undefined ? {} : { schema }),
        table,
        values: payload,
      })
      setValues({})
      setUseNull({})
      onDone(t('insert.done', { n: result.affected }))
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
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
        React.createElement(
          'div',
          { className: 'dbm-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' } },
          columns.map(column =>
            React.createElement(
              'label',
              { className: 'dbm-label', key: column.name },
              React.createElement(
                'span',
                null,
                column.name,
                React.createElement('span', { className: 'dbm-hint' }, ` · ${column.type}${column.nullable ? '' : ' NOT NULL'}${column.key === 'PRI' ? ' PK' : ''}`),
              ),
              React.createElement('input', {
                className: 'dbm-input dbm-mono',
                value: values[column.name] ?? '',
                disabled: useNull[column.name] === true,
                placeholder: column.defaultValue ?? (column.nullable ? t('common.null') : ''),
                onChange: (event: { target: { value: string } }) => setValues(current => ({ ...current, [column.name]: event.target.value })),
              }),
              column.nullable
                ? React.createElement(
                    'span',
                    { className: 'dbm-check' },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: useNull[column.name] === true,
                      onChange: (event: { target: { checked: boolean } }) => setUseNull(current => ({ ...current, [column.name]: event.target.checked })),
                    }),
                    t('common.null'),
                  )
                : null,
            ),
          ),
        ),
        React.createElement(
          'div',
          { className: 'dbm-row' },
          React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-primary', disabled: busy, onClick: () => { void submit() } }, busy ? t('common.loading') : t('insert.submit')),
        ),
      ),
    ),
  )
}

/** Re-exported for the row editor, which the browse grid opens. */
export { Modal }
