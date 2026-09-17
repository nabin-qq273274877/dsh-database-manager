import * as React from 'react'
/**
 * SQL database panel, styled after phpMyAdmin: a left tree of schemas and
 * tables, and a right area with 浏览 / 结构 / SQL / 搜索 / 插入 tabs.
 *
 * Used for both SQLite and MySQL — the two drivers expose the same contract, so
 * the only per-engine difference is the label of the schema level.
 *
 * This file owns the panel's state and routing; the tabs themselves live in
 * their own modules (`SqlBrowseTab`, `SqlStructureTab`, `SqlSearchTab`,
 * `SqlInsertTab`, `SqlTransferDialogs`) because each is a self-contained editing
 * surface with its own rules about what may be changed and what must be warned
 * about. Keeping them here would mean one 2000-line component whose pieces cannot
 * be read in isolation.
 */

import type { ColumnInfo, DataSourceSummary, IndexInfo, RowFilter, TableInfo, TablePage } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { SqlBrowseTab, type BrowseQuery } from './SqlBrowseTab.ts'
import { SqlInsertTab } from './SqlInsertTab.ts'
import { SqlSearchTab } from './SqlSearchTab.ts'
import { SqlStructureTab } from './SqlStructureTab.ts'
import { ExportDialog, ImportDialog } from './SqlTransferDialogs.ts'
import { BackButton, ErrorBanner, Empty, Modal, TabStrip, formatBytes, isNull, renderCell, t } from './ui.ts'

/** The right-hand tabs of a SQL database panel. */
type SqlTab = 'browse' | 'structure' | 'sql' | 'search' | 'insert'

/** Props for {@link SqlDatabaseView}. */
export interface SqlDatabaseViewProps {
  api: DbApi
  source: DataSourceSummary
  /** Schemas known at connect time; refreshed by the view. */
  initialSchemas: string[]
  /** Step out of this data source, back to the data-source list. */
  onBack(): void
  /** Leave the panel entirely and show the conversation. */
  onClose(): void
}

/** One page of rows plus the mode that produced it. */
interface RowsState {
  page: TablePage
  loading: boolean
  error?: string
}

/** Which transfer dialog is open, and what it is scoped to. */
type TransferDialog =
  | { kind: 'export'; rowsOnly?: boolean; selectedKeys?: Array<Array<{ column: string; value: string | number | boolean | null }>> }
  | { kind: 'import' }

/** The SQL database panel. */
export function SqlDatabaseView(props: SqlDatabaseViewProps): React.ReactElement {
  const { api, source, initialSchemas, onBack, onClose } = props
  const [schemas, setSchemas] = React.useState<string[]>(initialSchemas)
  const [tableFilter, setTableFilter] = React.useState('')
  /**
   * Which databases are expanded. Independent per database, like phpMyAdmin:
   * opening one must not close another, and a database's tables are loaded the
   * first time it is opened (lazily, so a server with many databases does not
   * pay for all of them up front).
   */
  const [openSchemas, setOpenSchemas] = React.useState<Record<string, boolean>>({})
  /** Tables per database, keyed by schema name; absent = not loaded yet. */
  const [tablesBySchema, setTablesBySchema] = React.useState<Record<string, TableInfo[]>>({})
  /** Databases whose table load is in flight. */
  const [loadingSchemas, setLoadingSchemas] = React.useState<Record<string, boolean>>({})
  /**
   * The database the right-hand side operates on, and the open table. A table
   * is identified by database + name, since the same name can exist in two
   * databases.
   */
  const [activeSchema, setActiveSchema] = React.useState<string | undefined>(undefined)
  const [activeTable, setActiveTable] = React.useState<string | undefined>(undefined)
  const [tab, setTab] = React.useState<SqlTab>('browse')
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [notice, setNotice] = React.useState<string | undefined>(undefined)

  const [rows, setRows] = React.useState<RowsState | undefined>(undefined)
  /**
   * The 浏览 read's layout, as one object.
   *
   * Held together rather than as separate pieces of state because a reload must
   * repeat the SAME read: a page change or a sort that moved one field but not
   * the other would silently drop the sort, or re-read a different page than the
   * pager says.
   */
  const [browse, setBrowse] = React.useState<BrowseQuery>({ page: 1, pageSize: 200, orderDir: 'asc' })

  const [columns, setColumns] = React.useState<ColumnInfo[]>([])
  const [indexes, setIndexes] = React.useState<IndexInfo[]>([])
  /** The open transfer dialog, if any. */
  const [transfer, setTransfer] = React.useState<TransferDialog | undefined>(undefined)
  /** The schema's table list, read when a transfer dialog needs it. */
  const [schemaTables, setSchemaTables] = React.useState<Array<{ name: string; type: string }>>([])

  /**
   * Table statistics for the overview pane, per database.
   *
   * Separate from `tablesBySchema` because it is a different, more expensive
   * request (`stats=1` walks the file's page map on SQLite). The tree keeps its
   * cheap name-only list; the overview asks for the counts when it is opened.
   */
  const [statsBySchema, setStatsBySchema] = React.useState<Record<string, TableInfo[] | undefined>>({})
  const [statsLoading, setStatsLoading] = React.useState(false)
  /** Which destructive action is awaiting confirmation. */
  const [confirming, setConfirming] = React.useState<{ table: TableInfo; schema: string; op: 'truncate' | 'drop' } | undefined>(undefined)
  const [acting, setActing] = React.useState(false)

  /** Refresh the schema list. */
  const loadSchemas = React.useCallback(async (): Promise<void> => {
    if (source.kind === 'sqlite') return
    try {
      const list = await api.schemas(source.id)
      const names = list.map(item => item.name)
      setSchemas(names)
      // A database that vanished (dropped elsewhere) keeps no stale entry.
      setTablesBySchema(current => {
        const next: Record<string, TableInfo[]> = {}
        for (const [name, tables] of Object.entries(current)) if (names.includes(name)) next[name] = tables
        return next
      })
      setActiveSchema(current => (current !== undefined && names.includes(current) ? current : undefined))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [api, source.id, source.kind])

  /**
   * Load one database's tables, reusing the cached list unless `force`.
   *
   * @param schema - the database to load.
   * @param force - reload even when a list is already cached (the refresh
   *   button, and after a write that could change the table set).
   */
  const loadTables = React.useCallback(async (schema: string | undefined, force = false): Promise<void> => {
    if (schema === undefined) return
    if (!force && tablesBySchema[schema] !== undefined) return
    setLoadingSchemas(current => ({ ...current, [schema]: true }))
    try {
      const list = await api.tables(source.id, schema)
      setTablesBySchema(current => ({ ...current, [schema]: list }))
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      // Cache an empty list so a failing database does not retry on every
      // render; the refresh button clears it.
      setTablesBySchema(current => ({ ...current, [schema]: [] }))
    } finally {
      setLoadingSchemas(current => ({ ...current, [schema]: false }))
    }
  }, [api, source.id, tablesBySchema])

  React.useEffect(() => { void loadSchemas() }, [loadSchemas])
  // Single-schema engines (SQLite) have nothing to expand: open and load their
  // only schema immediately so the tree is populated without a click.
  React.useEffect(() => {
    if (schemas.length !== 1) return
    const only = schemas[0]!
    setOpenSchemas(current => (current[only] === undefined ? { ...current, [only]: true } : current))
    void loadTables(only)
  }, [schemas, loadTables])

  /**
   * Load one database's table statistics for the overview pane.
   *
   * `force` re-reads after a change that can move the numbers (a truncate, a
   * drop, an insert), because a cached count would then be a stale answer to
   * the question the user just asked.
   */
  const loadStats = React.useCallback(async (schema: string, force = false): Promise<void> => {
    if (!force && statsBySchema[schema] !== undefined) return
    setStatsLoading(true)
    try {
      const list = await api.tables(source.id, schema, true)
      setStatsBySchema(current => ({ ...current, [schema]: list }))
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      // An empty list keeps a failing database from retrying on every render;
      // the refresh button clears the cache.
      setStatsBySchema(current => ({ ...current, [schema]: [] }))
    } finally {
      setStatsLoading(false)
    }
  }, [api, source.id, statsBySchema])

  /**
   * Select a database, which is what puts its table list on the right.
   *
   * Also expands it, so the tree and the overview agree: selecting a collapsed
   * database would otherwise show its tables on the right while the tree
   * continued to claim it held none.
   *
   * Clicking a database ALWAYS returns the right pane to that database's table
   * list, including when a table of that same database is currently open. The
   * earlier version kept `activeTable` when the database was unchanged (it
   * wanted a re-click not to discard the open table), with the result that
   * there was no way back to the database overview: once a table was open, the
   * right pane stayed on that table and clicking the database did nothing
   * visible. phpMyAdmin's tree behaves the other way — the database node is the
   * way UP a level — and that is the gesture users arrive with.
   *
   * Returning to a table is one click away anyway (its name in the overview or
   * in the tree), whereas the overview had no control at all.
   */
  const selectSchema = (schema: string): void => {
    setActiveTable(undefined)
    setActiveSchema(schema)
    setOpenSchemas(current => (current[schema] === true ? current : { ...current, [schema]: true }))
    setError(undefined)
    void loadTables(schema)
    void loadStats(schema)
  }

  /**
   * Expand or collapse one database.
   *
   * Deliberately does NOT select it — selecting is the name click's job. The
   * two are separate acts so collapsing a database you are browsing does not
   * throw the right pane back to its placeholder.
   */
  const toggleSchema = (schema: string): void => {
    const next = !(openSchemas[schema] ?? false)
    setOpenSchemas(current => ({ ...current, [schema]: next }))
    if (next) void loadTables(schema)
  }

  /**
   * Run a destructive table action, then refresh everything it invalidated.
   *
   * A dropped table must not linger in the tree, and a truncated one must not
   * keep its old row count, so both the name list and the statistics are
   * re-read rather than patched in place.
   */
  const runTableAction = async (schema: string, table: TableInfo, op: 'truncate' | 'drop'): Promise<void> => {
    setActing(true)
    try {
      await api.tableAction(source.id, {
        schema,
        table: table.name,
        op,
        isView: table.type === 'view',
      })
      if (op === 'drop' && activeTable === table.name && activeSchema === schema) setActiveTable(undefined)
      setConfirming(undefined)
      setNotice(t(op === 'truncate' ? 'db.truncate.done' : 'db.drop.done', { table: table.name }))
      setError(undefined)
      await loadTables(schema, true)
      await loadStats(schema, true)
    } catch (failure) {
      setError(t('db.action.failed', { error: failure instanceof Error ? failure.message : String(failure) }))
      setConfirming(undefined)
    } finally {
      setActing(false)
    }
  }

  /**
   * Load one page of one table.
   *
   * The schema is a required field of `options`, not read from state: the caller
   * may be loading a table in a database other than the active one (opening a
   * table from the tree sets both together), and a stale `activeSchema` here
   * would silently read the wrong database.
   *
   * `withIndexes` asks for the table's index list in the same request, which is
   * what the 浏览 tab's 按索引排序 needs. It is a distinct read because the list
   * costs a round trip on MySQL and the tree's own table loads do not want it.
   */
  const loadRows = React.useCallback(async (options: {
    schema: string
    table: string
    page: number
    pageSize: number
    mode: 'browse' | 'search'
    term?: string
    condition?: string
    orderBy?: string
    orderByColumns?: string[]
    orderDir?: 'asc' | 'desc'
    filters?: RowFilter[]
    filterJoin?: 'and' | 'or'
    withIndexes?: boolean
  }): Promise<void> => {
    setRows(current => ({ page: current?.page ?? emptyPage(), loading: true, ...(current?.error === undefined ? {} : { error: current.error }) }))
    try {
      const result = await api.rows(source.id, {
        schema: options.schema,
        table: options.table,
        page: options.page,
        pageSize: options.pageSize,
        mode: options.mode,
        ...(options.term === undefined ? {} : { term: options.term }),
        ...(options.condition === undefined ? {} : { condition: options.condition }),
        ...(options.orderBy === undefined ? {} : { orderBy: options.orderBy }),
        ...(options.orderByColumns === undefined ? {} : { orderByColumns: options.orderByColumns }),
        ...(options.filters === undefined ? {} : { filters: options.filters }),
        ...(options.filterJoin === undefined ? {} : { filterJoin: options.filterJoin }),
        ...(options.withIndexes === true ? { withIndexes: true } : {}),
        orderDir: options.orderDir ?? 'asc',
      })
      setRows({ page: result, loading: false })
      // The index list rides on the page, so it is picked up here rather than
      // with a second request.
      if (result.indexes !== undefined) setIndexes(result.indexes)
      // The browse tab reads its columns from the page; the structure tab owns
      // its own copy (which carries the key positions and enum members). Only
      // the structure read overwrites this, so a browse refresh cannot downgrade
      // what the structure tab is showing.
    } catch (failure) {
      setRows(current => ({ page: current?.page ?? emptyPage(), loading: false, error: failure instanceof Error ? failure.message : String(failure) }))
    }
  }, [api, source.id])

  /** Load structure metadata for one table. */
  const loadStructure = React.useCallback(async (schema: string, table: string): Promise<void> => {
    try {
      const [cols, idx] = await Promise.all([
        api.columns(source.id, table, schema),
        api.indexes(source.id, table, schema).catch(() => [] as IndexInfo[]),
      ])
      setColumns(cols)
      setIndexes(idx)
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [api, source.id])

  /**
   * Re-read whatever the current tab is showing.
   *
   * Called after a schema change, which invalidates more than one surface: a
   * dropped column changes the grid's columns AND the tree's row counts. Each
   * tab's own needs are covered here so a caller does not have to know them.
   */
  const reloadCurrent = React.useCallback((): void => {
    if (activeSchema === undefined || activeTable === undefined) return
    if (tab === 'structure' || tab === 'insert') void loadStructure(activeSchema, activeTable)
    if (tab === 'browse') {
      void loadRows({
        schema: activeSchema,
        table: activeTable,
        page: browse.page,
        pageSize: browse.pageSize,
        mode: 'browse',
        ...(browse.orderBy === undefined ? {} : { orderBy: browse.orderBy }),
        ...(browse.orderByColumns === undefined ? {} : { orderByColumns: browse.orderByColumns }),
        ...(browse.filters === undefined ? {} : { filters: browse.filters }),
        ...(browse.filterJoin === undefined ? {} : { filterJoin: browse.filterJoin }),
        orderDir: browse.orderDir,
        withIndexes: true,
      })
    }
  }, [activeSchema, activeTable, tab, browse, loadStructure, loadRows])

  /**
   * Open one table in the given tab.
   *
   * The database is passed explicitly rather than read from state: the tree can
   * open a table in a database that is not the currently active one, and relying
   * on `activeSchema` here would query the wrong database (or none at all).
   */
  const openTable = (schema: string, table: string, nextTab: SqlTab = 'browse'): void => {
    setActiveSchema(schema)
    setActiveTable(table)
    setTab(nextTab)
    // A new table starts unsorted on its first page: a sort carried over from the
    // previous table would order by a column this one may not have.
    setBrowse(current => ({ ...current, page: 1, orderBy: undefined, orderByColumns: undefined, filters: undefined }))
    setError(undefined)
    setNotice(undefined)
    if (nextTab === 'structure' || nextTab === 'insert') void loadStructure(schema, table)
    if (nextTab === 'browse') void loadRows({ schema, table, page: 1, pageSize: browse.pageSize, mode: 'browse', withIndexes: true })
  }

  /** Switch tabs, loading whatever the target tab needs. */
  const changeTab = (next: SqlTab): void => {
    setTab(next)
    setError(undefined)
    setNotice(undefined)
    if (activeTable === undefined || activeSchema === undefined) return
    if (next === 'structure' || next === 'insert') void loadStructure(activeSchema, activeTable)
    if (next === 'browse') void loadRows({
      schema: activeSchema,
      table: activeTable,
      page: browse.page,
      pageSize: browse.pageSize,
      mode: 'browse',
      ...(browse.orderBy === undefined ? {} : { orderBy: browse.orderBy }),
      ...(browse.orderByColumns === undefined ? {} : { orderByColumns: browse.orderByColumns }),
      ...(browse.filters === undefined ? {} : { filters: browse.filters }),
      ...(browse.filterJoin === undefined ? {} : { filterJoin: browse.filterJoin }),
      orderDir: browse.orderDir,
      withIndexes: true,
    })
  }

  /** Whether a table name matches the filter (empty filter matches all). */
  const matchesFilter = (name: string): boolean =>
    tableFilter === '' || name.toLowerCase().includes(tableFilter.toLowerCase())

  /**
   * Open the import dialog, after reading the schema's table list.
   *
   * The list is a real request rather than the tree's cached names: the tree may
   * never have expanded this database, and an import needs to offer every table
   * the CSV could target — a stale or partial list would make a valid target
   * un-selectable.
   */
  const openImport = async (schema: string): Promise<void> => {
    try {
      const tables = await api.tables(source.id, schema)
      setSchemaTables(tables.map(table => ({ name: table.name, type: table.type })))
    } catch (failure) {
      // An enumeration failure must not block the dialog: a SQL import needs no
      // table list at all, and the CSV side reports its own missing target.
      setSchemaTables([])
      void failure
    }
    setTransfer({ kind: 'import' })
  }

  // ---- left tree ---------------------------------------------------------
  // phpMyAdmin shape: every database is a node that expands independently, and
  // the filter searches table names inside whichever databases are open. The
  // previous version showed tables for the ACTIVE database only, so on MySQL the
  // tree looked like a single-database browser.
  const tree: unknown[] = []
  for (const schema of schemas) {
    const isOpen = openSchemas[schema] ?? false
    const tables = tablesBySchema[schema]
    const loading = loadingSchemas[schema] === true
    /*
     * The row is a div, not a button, so the caret can be a real button inside
     * it. A button nested in a button is invalid HTML that browsers re-parent
     * unpredictably, which is why the Redis tree's rows are divs too.
     *
     * Clicking anywhere on the row selects the database — the whole row being a
     * target is what users expect from a tree. The caret is the one exception:
     * it expands or collapses without changing the selection, which is the
     * whole reason a database can be collapsed while still being the one shown
     * on the right.
     *
     * The previous single-button row did neither properly. It only toggled
     * expansion, so on SQLite — whose one schema is auto-expanded — clicking the
     * name collapsed it and never selected anything, leaving the right pane on
     * "pick a database" with no way past it.
     *
     * `role`/`tabIndex`/`onKeyDown` keep the row keyboard-operable, which a bare
     * div would not be.
     */
    tree.push(
      React.createElement(
        'div',
        {
          key: `schema-${schema}`,
          className: 'dbm-tree-item',
          // Active whenever the database is the selected one, regardless of
          // whether a table inside it is open: the right pane shows this
          // database's overview until a table is picked, so the node has to
          // stay lit across both.
          'data-active': String(activeSchema === schema),
          title: schema,
          role: 'button',
          tabIndex: 0,
          onClick: () => selectSchema(schema),
          onKeyDown: (event: { key: string; preventDefault(): void }) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            selectSchema(schema)
          },
        },
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dbm-caret-btn',
            'aria-label': isOpen ? t('db.collapse') : t('db.expand'),
            'aria-expanded': isOpen,
            onClick: (event: { stopPropagation(): void }) => {
              // Without this the row's own handler also fires, so expanding
              // would select as well — and collapsing would select, which is
              // the behaviour being fixed.
              event.stopPropagation()
              toggleSchema(schema)
            },
          },
          isOpen ? '▾' : '▸',
        ),
        React.createElement('span', { className: 'dbm-node-name' }, schema),
        tables === undefined
          ? null
          : React.createElement('span', { className: 'dbm-tree-meta' }, String(tables.filter(table => matchesFilter(table.name)).length)),
      ),
    )
    if (!isOpen) continue

    if (loading && tables === undefined) {
      tree.push(React.createElement('div', { key: `loading-${schema}`, className: 'dbm-tree-item dbm-tree-indent-1 dbm-hint' }, t('common.loading')))
      continue
    }
    const list = (tables ?? []).filter(table => matchesFilter(table.name))
    if (list.length === 0) {
      tree.push(
        React.createElement(
          'div',
          { key: `empty-${schema}`, className: 'dbm-tree-item dbm-tree-indent-1 dbm-hint' },
          t('db.noTables'),
        ),
      )
      continue
    }
    for (const table of list) {
      tree.push(
        React.createElement(
          'button',
          {
            key: `table-${schema}-${table.name}`,
            type: 'button',
            className: 'dbm-tree-item dbm-tree-indent-1',
            // A table name alone is ambiguous across databases; the active
            // pair is what the right-hand pane is showing.
            'data-active': String(activeTable === table.name && activeSchema === schema),
            title: `${schema}.${table.name}${table.comment === undefined ? '' : ` — ${table.comment}`}`,
            onClick: () => openTable(schema, table.name),
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
        onClick: () => {
          void loadSchemas()
          // Refresh every database that is open, so an expanded node reflects
          // reality after an external change. A collapsed node reloads the next
          // time it is opened anyway.
          for (const schema of schemas) if (openSchemas[schema] === true) void loadTables(schema, true)
        },
      }, '⟳'),
    ),
    React.createElement('div', { className: 'dbm-side-body' }, tree as never),
  )

  // ---- right area --------------------------------------------------------
  // The right pane has three states, in this order:
  //
  //   1. nothing selected           -> prompt to pick a database
  //   2. a database, no table       -> that database's TABLE LIST (phpMyAdmin's
  //                                    structure page), with per-table actions
  //   3. a database and a table     -> that table's tabs
  //
  // State 2 is the one that was missing: clicking a database in the tree used
  // to leave the right pane empty, so the only way to learn what a database
  // contained was to expand the tree node and count rows by eye.
  const selection = activeSchema !== undefined && activeTable !== undefined
    ? { schema: activeSchema, table: activeTable }
    : undefined

  const body: unknown[] = []
  if (activeSchema === undefined) {
    body.push(React.createElement(Empty, { key: 'empty', message: t('db.selectSchema') }))
  } else if (selection === undefined) {
    body.push(
      React.createElement(TableOverview, {
        key: 'overview',
        schema: activeSchema,
        tables: statsBySchema[activeSchema],
        filter: tableFilter,
        onFilter: setTableFilter,
        loading: statsLoading,
        onOpen: (table, nextTab) => openTable(activeSchema, table.name, nextTab),
        onTruncate: table => setConfirming({ table, schema: activeSchema, op: 'truncate' }),
        onDrop: table => setConfirming({ table, schema: activeSchema, op: 'drop' }),
        onRefresh: () => { void loadTables(activeSchema, true); void loadStats(activeSchema, true) },
      }),
    )
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
      body.push(React.createElement(SqlBrowseTab, {
        key: 'browse-body',
        api,
        sourceId: source.id,
        schema: selection.schema,
        table: selection.table,
        rows,
        query: browse,
        knownColumns: columns,
        /**
         * A layout change re-reads from page 1 unless it is a page move.
         *
         * Sorting, filtering and a page-size change all redefine what "page 1" is,
         * so staying on page 7 of the old ordering would show an arbitrary slice.
         */
        onQuery: (next) => {
          const merged: BrowseQuery = { ...browse, ...next }
          setBrowse(merged)
          void loadRows({
            schema: selection.schema,
            table: selection.table,
            page: merged.page,
            pageSize: merged.pageSize,
            mode: 'browse',
            ...(merged.orderBy === undefined ? {} : { orderBy: merged.orderBy }),
            ...(merged.orderByColumns === undefined ? {} : { orderByColumns: merged.orderByColumns }),
            ...(merged.filters === undefined ? {} : { filters: merged.filters }),
            ...(merged.filterJoin === undefined ? {} : { filterJoin: merged.filterJoin }),
            orderDir: merged.orderDir,
            withIndexes: true,
          })
        },
        onReload: reloadCurrent,
        onExport: options => setTransfer({
          kind: 'export',
          ...(options?.rowsOnly === true ? { rowsOnly: true } : {}),
          ...(options?.selectedKeys === undefined ? {} : { selectedKeys: options.selectedKeys }),
        }),
        onImport: () => { void openImport(selection.schema) },
        onNotice: message => { setNotice(message); if (message !== undefined) setError(undefined) },
        onError: message => { setError(message); if (message !== undefined) setNotice(undefined) },
      }))
    }

    if (tab === 'structure') {
      body.push(React.createElement(SqlStructureTab, {
        key: 'structure-body',
        api,
        sourceId: source.id,
        schema: selection.schema,
        table: selection.table,
        kind: source.kind,
        columns,
        indexes,
        loading: columns.length === 0,
        ...(error === undefined ? {} : { error }),
        onReload: () => { void loadStructure(selection.schema, selection.table) },
        onReloadRows: () => { void loadTables(selection.schema, true); reloadCurrent() },
        onNotice: message => { setNotice(message); if (message !== undefined) setError(undefined) },
        onError: message => { setError(message); if (message !== undefined) setNotice(undefined) },
      }))
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
        React.createElement(SqlSearchTab, {
          key: 'search-body',
          columns,
          filters: browse.filters ?? [],
          join: browse.filterJoin ?? 'and',
          loading: rows?.loading === true,
          ...(rows?.page === undefined ? {} : { total: rows.page.total }),
          onSearch: (filters, join) => {
            // A search always starts at page 1: the previous page number was a
            // position in the PREVIOUS result set, and keeping it would land the
            // user past the end of a narrower one.
            const merged: BrowseQuery = { ...browse, page: 1, filters, filterJoin: join }
            setBrowse(merged)
            void loadRows({
              schema: selection.schema,
              table: selection.table,
              page: 1,
              pageSize: merged.pageSize,
              mode: 'search',
              filters,
              filterJoin: join,
            })
          },
          onError: message => { setError(message); if (message !== undefined) setNotice(undefined) },
        }),
      )
    }

    if (tab === 'insert') {
      body.push(
        React.createElement(SqlInsertTab, {
          key: 'insert-body',
          api,
          source,
          schema: selection.schema,
          table: selection.table,
          columns,
          loading: columns.length === 0,
          onDone: (message) => {
            setNotice(message)
            setError(undefined)
            // An INSERT can change the row count the tree shows, so refresh it,
            // and the grid's total is now wrong too.
            void loadTables(selection.schema, true)
            void loadStats(selection.schema, true)
          },
          onError: (message) => { setError(message); if (message !== undefined) setNotice(undefined) },
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
      React.createElement(BackButton, { onBack, label: t('panel.backToList') }),
      React.createElement('span', { className: 'dbm-title' }, source.name),
      React.createElement('span', { className: `dbm-badge dbm-badge-${source.kind}` }, source.kind),
      React.createElement('span', { className: 'dbm-subtitle dbm-mono' }, source.kind === 'sqlite' ? (source.file ?? '') : `${source.host ?? ''}:${source.port ?? ''}`),
      React.createElement('span', { className: 'dbm-spacer' }),
      React.createElement(BackButton, { onBack: onClose }),
    ),
    error === undefined ? null : React.createElement(ErrorBanner, { message: error }),
    notice === undefined ? null : React.createElement('div', { className: 'dbm-ok', style: { padding: '6px 14px' } }, notice),
    React.createElement('div', { className: 'dbm-split' }, left as never, React.createElement('div', { className: 'dbm-main' }, body as never)),
    confirming === undefined
      ? null
      : React.createElement(TableActionDialog, {
          key: 'confirm',
          state: confirming,
          busy: acting,
          onCancel: () => setConfirming(undefined),
          onConfirm: () => { void runTableAction(confirming.schema, confirming.table, confirming.op) },
        }),
    transfer === undefined
      ? null
      : transfer.kind === 'export'
        ? React.createElement(ExportDialog, {
            key: 'export',
            api,
            source,
            schema: activeSchema ?? '',
            ...(activeTable === undefined ? {} : { table: activeTable }),
            tableCount: schemaTables.length,
            ...(transfer.selectedKeys === undefined ? {} : { selectedKeys: transfer.selectedKeys }),
            ...(transfer.rowsOnly === true ? { rowsOnly: true } : {}),
            onClose: () => setTransfer(undefined),
            onDone: message => { setNotice(message); setError(undefined) },
            onError: message => { setError(message); setNotice(undefined) },
          })
        : React.createElement(ImportDialog, {
            key: 'import',
            api,
            source,
            schema: activeSchema ?? '',
            ...(activeTable === undefined ? {} : { table: activeTable }),
            tables: schemaTables,
            onClose: () => setTransfer(undefined),
            onDone: message => {
              setNotice(message)
              setError(undefined)
              // An import can add tables and rows, so both the tree and the
              // stats are stale afterwards.
              if (activeSchema !== undefined) {
                void loadTables(activeSchema, true)
                void loadStats(activeSchema, true)
              }
            },
            onError: message => { setError(message); setNotice(undefined) },
          }),
  )
}

/** The state a destructive table action is confirmed from. */
interface TableActionState {
  table: TableInfo
  schema: string
  op: 'truncate' | 'drop'
}

/**
 * The confirmation for 清空 / 删除.
 *
 * A separate dialog from the row-editing one because the blast radius is
 * different: these are the only actions in the panel that destroy data without
 * a way back, so the table name is repeated in the body and the confirm button
 * is the danger variant rather than the primary one.
 */
function TableActionDialog(props: {
  state: TableActionState
  busy: boolean
  onCancel(): void
  onConfirm(): void
}): React.ReactElement {
  const { state, busy, onCancel, onConfirm } = props
  const isView = state.table.type === 'view'
  const truncate = state.op === 'truncate'
  // A view has no rows of its own, so emptying one is not a thing to confirm —
  // say why instead of offering a button that would fail.
  const body = truncate
    ? isView
      ? t('db.truncate.bodyView', { table: state.table.name })
      : t('db.truncate.body', { table: state.table.name })
    : isView
      ? t('db.drop.bodyView', { table: state.table.name })
      : t('db.drop.body', { table: state.table.name })

  return React.createElement(Modal, {
    title: t(truncate ? 'db.truncate.title' : 'db.drop.title'),
    onClose: onCancel,
    footer: [
      React.createElement('button', { key: 'cancel', type: 'button', className: 'dbm-btn', disabled: busy, onClick: onCancel }, t('common.cancel')),
      React.createElement(
        'button',
        {
          key: 'ok',
          type: 'button',
          className: 'dbm-btn dbm-btn-danger',
          // Refused before it is attempted when the engine cannot do it at all.
          disabled: busy || (truncate && isView),
          onClick: onConfirm,
        },
        busy ? t('common.loading') : t(truncate ? 'db.action.truncate' : 'db.action.drop'),
      ),
    ],
    children: React.createElement('div', null, body),
  })
}

/** Format a byte count without a "—" fallback of its own (the caller decides). */
/**
 * The database overview: one row per table, phpMyAdmin's structure page.
 *
 * This is what a click on a database shows. It exists because the tree can only
 * answer "what is this table called" — the row count, the size, and the actions
 * that operate on a whole table had no home.
 */
function TableOverview(props: {
  schema: string
  /** Loaded statistics, or undefined while the first read is in flight. */
  tables: TableInfo[] | undefined
  filter: string
  onFilter(value: string): void
  loading: boolean
  onOpen(table: TableInfo, tab: SqlTab): void
  onTruncate(table: TableInfo): void
  onDrop(table: TableInfo): void
  onRefresh(): void
}): React.ReactElement {
  const { schema, tables, filter, onFilter, loading, onOpen, onTruncate, onDrop, onRefresh } = props

  if (tables === undefined) {
    return React.createElement(
      'div',
      { className: 'dbm-tab-body' },
      React.createElement('div', { className: 'dbm-pad dbm-hint' }, t('db.loadingStats')),
    )
  }

  const needle = filter.trim().toLowerCase()
  const list = needle === '' ? tables : tables.filter(table => table.name.toLowerCase().includes(needle))

  /** One action button in the 操作 cell. */
  const action = (key: string, label: string, onClick: () => void, danger = false): React.ReactElement =>
    React.createElement(
      'button',
      {
        key,
        type: 'button',
        className: `dbm-btn dbm-btn-sm${danger ? ' dbm-btn-danger' : ''}`,
        onClick,
      },
      label,
    )

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    React.createElement(
      'div',
      { className: 'dbm-toolbar' },
      React.createElement('span', { className: 'dbm-hint' }, t('db.filterPlaceholder')),
      React.createElement('input', {
        className: 'dbm-input',
        value: filter,
        // No placeholder here: the tree's own filter box already says
        // "search table names", and two identical hints a column apart read as
        // a duplicated control rather than two different ones.
        onChange: (event: { target: { value: string } }) => onFilter(event.target.value),
      }),
      React.createElement('span', { className: 'dbm-hint' }, t('db.overviewFor', { schema, n: tables.length })),
      React.createElement('span', { className: 'dbm-spacer' }),
      loading ? React.createElement('span', { className: 'dbm-hint' }, t('common.loading')) : null,
      React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', onClick: onRefresh }, t('common.refresh')),
    ),
    list.length === 0
      ? React.createElement(Empty, { message: tables.length === 0 ? t('db.overviewEmpty') : t('list.emptyFiltered') })
      : React.createElement(
          'div',
          { className: 'dbm-scroll' },
          React.createElement(
            'table',
            { className: 'dbm-table' },
            React.createElement(
              'thead',
              null,
              React.createElement(
                'tr',
                null,
                ...[t('db.col.table'), t('db.col.actions'), t('db.col.rows'), t('db.col.type'), t('db.col.collation'), t('db.col.size'), t('db.col.comment')].map(label =>
                  React.createElement('th', { key: label }, label),
                ),
              ),
            ),
            React.createElement(
              'tbody',
              null,
              list.map(table =>
                React.createElement(
                  'tr',
                  { key: table.name },
                  React.createElement(
                    'td',
                    null,
                    React.createElement(
                      'button',
                      { type: 'button', className: 'dbm-link', onClick: () => onOpen(table, 'browse') },
                      table.name,
                    ),
                  ),
                  React.createElement(
                    'td',
                    null,
                    React.createElement(
                      'div',
                      { className: 'dbm-actions' },
                      action('browse', t('db.action.browse'), () => onOpen(table, 'browse')),
                      action('structure', t('db.action.structure'), () => onOpen(table, 'structure')),
                      action('search', t('db.action.search'), () => onOpen(table, 'search')),
                      action('insert', t('db.action.insert'), () => onOpen(table, 'insert')),
                      // A view has no rows of its own, so 清空 would be a lie;
                      // it stays visible but disabled, with the dialog saying why.
                      React.createElement(
                        'button',
                        {
                          key: 'truncate',
                          type: 'button',
                          className: 'dbm-btn dbm-btn-sm',
                          disabled: table.type === 'view',
                          title: table.type === 'view' ? t('db.truncate.bodyView', { table: table.name }) : undefined,
                          onClick: () => onTruncate(table),
                        },
                        t('db.action.truncate'),
                      ),
                      action('drop', t('db.action.drop'), () => onDrop(table), true),
                    ),
                  ),
                  /*
                   * An absent count means UNKNOWN, not zero. SQLite keeps no
                   * row-count statistic until ANALYZE runs, and this panel does
                   * not run it — that would write to the user's database as a
                   * side effect of listing it. Rendering 0 there would state
                   * something false about a table that may hold millions.
                   */
                  React.createElement(
                    'td',
                    { className: 'dbm-mono' },
                    table.rows === undefined
                      ? React.createElement('span', { className: 'dbm-hint', title: t('db.rowsUnknown.hint') }, t('db.rowsUnknown'))
                      : table.rows.toLocaleString(),
                  ),
                  React.createElement(
                    'td',
                    null,
                    // phpMyAdmin's 类型 column is the storage engine (InnoDB,
                    // MyISAM). SQLite has exactly one storage engine and
                    // reports none, so it falls back to the object kind — which
                    // is the distinction that actually varies there.
                    table.engine ?? (table.type === 'view' ? t('db.type.view') : t('db.type.table')),
                  ),
                  React.createElement('td', { className: 'dbm-mono' }, table.collation ?? t('common.none')),
                  React.createElement('td', { className: 'dbm-mono' }, formatBytes(table.size)),
                  React.createElement('td', { title: table.comment ?? '' }, table.comment ?? ''),
                ),
              ),
            ),
          ),
        ),
  )
}

/** An empty placeholder page for the first render. */
function emptyPage(): TablePage {
  return { columns: [], rows: [], total: 0, page: 1, pageSize: 200, primaryKey: [] }
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

/** Re-exported for the row editor, which the browse grid opens. */
export { Modal }
