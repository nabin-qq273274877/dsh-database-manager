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

import type { ColumnInfo, DataSourceSummary, IndexInfo, MaintenanceOpView, MaintenanceOutcome, QueryResult, RowFilter, TableActionOp, TableInfo, TablePage } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { SqlBrowseTab, type BrowseQuery } from './SqlBrowseTab.ts'
import { SqlInsertTab } from './SqlInsertTab.ts'
import { SqlOperationsTab } from './SqlOperationsTab.ts'
import { SqlSearchTab } from './SqlSearchTab.ts'
import { SqlStructureTab } from './SqlStructureTab.ts'
import { DatabaseActionDialog, MaintenanceReportDialog, TableBatchBar } from './SqlTableActions.ts'
import { CreateTableDialog } from './CreateTableDialog.ts'
import { ExportDialog, ImportDialog } from './SqlTransferDialogs.ts'
import { BackButton, ErrorBanner, Empty, Modal, TabStrip, formatBytes, isNull, renderCell, t } from './ui.ts'

/** The right-hand tabs of a SQL database panel. */
type SqlTab = 'browse' | 'structure' | 'sql' | 'search' | 'insert' | 'operation'

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

/**
 * Which transfer dialog is open, and what it is scoped to.
 *
 * `tables` narrows a SQL dump to a chosen set (the batch 导出所选); absent means the
 * whole scope the dialog is opened on.
 */
type TransferDialog =
  | {
      kind: 'export'
      rowsOnly?: boolean
      selectedKeys?: Array<Array<{ column: string; value: string | number | boolean | null }>>
      /** Tables to export instead of the whole schema. */
      tables?: string[]
    }
  | { kind: 'import' }

/**
 * What a destructive table action is confirmed from.
 *
 * Two shapes, because the confirmation differs: one table (named in the body) versus
 * a batch (counted). A single dialog taking a list of one would have to guess which
 * wording to use.
 */
type TableConfirm =
  | { kind: 'single'; table: TableInfo; schema: string; op: 'truncate' | 'drop' }
  | { kind: 'batch'; tables: TableInfo[]; schema: string; op: 'truncate' | 'drop' }

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
  /**
   * Whether a structure read is in flight.
   *
   * A real flag rather than "the column list is empty": those differ. A refresh of
   * a table that already has columns leaves the list non-empty while the new read
   * runs, so an emptiness test showed no busy state for exactly the refresh a user
   * would notice taking time.
   */
  const [structureLoading, setStructureLoading] = React.useState(false)
  /**
   * The SQL tab's editor text and its write switch.
   *
   * Held HERE rather than inside {@link SqlTabView} because that component unmounts
   * whenever another tab is shown — and running a SELECT now switches to 浏览, so
   * local state would clear the statement the user just ran. Going back to the SQL
   * tab to tweak it is the normal next step, and finding an empty editor there would
   * be losing their work.
   */
  const [sqlText, setSqlText] = React.useState('')
  const [sqlAllowWrite, setSqlAllowWrite] = React.useState(false)
  /**
   * The last SELECT run from the SQL tab, so the 浏览 tab can show its result.
   *
   * A result set is not a table read: it has columns but no types, no keys and no
   * paging. It is kept separately from `rows` (the 浏览 read of a real table) so the
   * two cannot be confused, and the 浏览 tab renders one or the other — never a mix.
   */
  const [sqlResult, setSqlResult] = React.useState<{
    sql: string
    result: QueryResult
  } | undefined>(undefined)
  /** The open transfer dialog, if any. */
  const [transfer, setTransfer] = React.useState<TransferDialog | undefined>(undefined)
  /** The schema's table list, read when a transfer dialog needs it. */
  const [schemaTables, setSchemaTables] = React.useState<Array<{ name: string; type: string }>>([])
  /**
   * Tables ticked in the overview list, by name.
   *
   * Keyed by name within ONE schema, and cleared when the schema changes: a
   * selection that outlived its schema would let "drop selected" act on names from a
   * database the user is no longer looking at.
   */
  const [selectedTables, setSelectedTables] = React.useState<Set<string>>(new Set())
  /** Which maintenance operations this engine supports, read once per source. */
  const [maintenanceSupport, setMaintenanceSupport] = React.useState<MaintenanceOpView[]>([])
  /**
   * Which of the 操作 tab's three blocks this engine supports.
   *
   * `undefined` while the read is in flight, which is deliberately different from an
   * empty list: "not known yet" must not be rendered as "this engine can do none of
   * them", or every block would flash a disabled-with-reason state on open.
   */
  const [tableActionSupport, setTableActionSupport] = React.useState<TableActionOp[] | undefined>(undefined)
  /** Set when the support read failed, so the 操作 tab can say so rather than guess. */
  const [tableActionSupportError, setTableActionSupportError] = React.useState<string | undefined>(undefined)
  /** The maintenance report dialog's state. */
  const [maintenance, setMaintenance] = React.useState<{ op?: MaintenanceOpView; outcomes: MaintenanceOutcome[]; running: boolean } | undefined>(undefined)
  /** Which database-level action dialog is open, if any. */
  const [databaseAction, setDatabaseAction] = React.useState<'create' | 'rename' | 'copy' | 'drop' | 'charset' | undefined>(undefined)
  /** Whether a batch or database action is in flight. */
  const [batchBusy, setBatchBusy] = React.useState(false)
  /** Whether the 新建表 dialog is open. */
  const [creatingTable, setCreatingTable] = React.useState(false)

  /**
   * Table statistics for the overview pane, per database.
   *
   * Separate from `tablesBySchema` because it is a different, more expensive
   * request (`stats=1` walks the file's page map on SQLite). The tree keeps its
   * cheap name-only list; the overview asks for the counts when it is opened.
   */
  const [statsBySchema, setStatsBySchema] = React.useState<Record<string, TableInfo[] | undefined>>({})
  /**
   * The same map, readable without becoming a dependency.
   *
   * `loadStats` needs to know whether a database's statistics are already cached, but
   * taking `statsBySchema` as a dependency gave the callback a new identity on every
   * update, which cascaded into every effect listing it. The ref answers the same
   * question without that.
   */
  const statsBySchemaRef = React.useRef(statsBySchema)
  statsBySchemaRef.current = statsBySchema
  const [statsLoading, setStatsLoading] = React.useState(false)
  /** Which destructive action is awaiting confirmation. */
  const [confirming, setConfirming] = React.useState<TableConfirm | undefined>(undefined)
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
  /**
   * Read which maintenance operations this engine supports, once per source.
   *
   * Asked of the host rather than inferred from the engine name in the browser: the
   * driver is where the answer lives, and a second copy of it here would be a second
   * thing to keep in step.
   */
  React.useEffect(() => {
    let live = true
    void api.maintenanceSupport(source.id)
      .then(support => { if (live) setMaintenanceSupport(support) })
      .catch(() => { if (live) setMaintenanceSupport([]) })
    return () => { live = false }
  }, [api, source.id])
  /**
   * Read the 操作 tab's support, once per source.
   *
   * A failure is KEPT rather than turned into an empty list: the two mean different
   * things to the page — an engine that supports nothing shows a disabled block with
   * the reason, whereas a read that failed must say the list could not be read rather
   * than claim the engine is incapable.
   */
  React.useEffect(() => {
    let live = true
    void api.tableActionSupport(source.id)
      .then(support => { if (live) { setTableActionSupport(support); setTableActionSupportError(undefined) } })
      .catch((failure: unknown) => {
        if (!live) return
        setTableActionSupport([])
        setTableActionSupportError(failure instanceof Error ? failure.message : String(failure))
      })
    return () => { live = false }
  }, [api, source.id])
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
    /*
     * The cache check reads a REF, not the state value.
     *
     * Depending on `statsBySchema` made this callback's identity change on every
     * statistics update, which cascaded into every effect that lists it as a
     * dependency. A ref answers the same question without that churn.
     */
    if (!force && statsBySchemaRef.current[schema] !== undefined) return
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
  }, [api, source.id])

  /**
   * Fetch statistics for whatever database is open, whenever it has none.
   *
   * This is what makes "clear the cache" a safe thing to do anywhere. Without it,
   * dropping a database's cached statistics left the pane showing 正在读取表和统计信息…
   * forever: clearing the cache is not a reload, and only an explicit call site could
   * start one. Measured — the pane was still on the loading text 5s after a rename
   * with nothing in flight.
   *
   * An effect rather than a call added to each operation: the invariant is "an open
   * database has statistics", and stating it once means a future operation that
   * invalidates them cannot forget to reload.
   */
  React.useEffect(() => {
    if (activeSchema === undefined) return
    // Already loading, or already known: nothing to do.
    if (statsLoading) return
    if (statsBySchema[activeSchema] !== undefined) return
    void loadStats(activeSchema)
  }, [activeSchema, statsBySchema, statsLoading, loadStats])

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
   * Run one batch action over several tables.
   *
   * ONE REQUEST PER TABLE, and the outcome of each is kept. A single request covering
   * all of them would report only the first failure, and a partial success would be
   * indistinguishable from a whole one — so the report names which table failed and
   * why. The reads are refreshed once at the end rather than per table.
   *
   * Emptying skips views: a view has no rows of its own, and asking the engine to
   * empty one is an error it answers about the object rather than about the intent.
   */
  const runBatchAction = async (schema: string, tables: TableInfo[], op: 'truncate' | 'drop'): Promise<void> => {
    setBatchBusy(true)
    const failures: string[] = []
    let ok = 0
    try {
      for (const table of tables) {
        if (op === 'truncate' && table.type === 'view') continue
        try {
          await api.tableAction(source.id, { schema, table: table.name, op, isView: table.type === 'view' })
          ok++
          // A dropped table must not stay open on the right.
          if (op === 'drop' && activeTable === table.name && activeSchema === schema) setActiveTable(undefined)
        } catch (failure) {
          failures.push(t('db.batch.failedOn', { table: table.name, error: failure instanceof Error ? failure.message : String(failure) }))
        }
      }
      setSelectedTables(new Set())
      setConfirming(undefined)
      setError(failures.length === 0 ? undefined : failures.join('\n'))
      setNotice(failures.length === 0
        ? t(`db.batch.done.${op}` as never, { n: ok })
        : t('db.batch.partial', { ok, failed: failures.length }))
      await loadTables(schema, true)
      await loadStats(schema, true)
    } finally {
      setBatchBusy(false)
    }
  }

  /**
   * Run one maintenance operation over several tables.
   *
   * The report stays open with the engine's own messages. `repair` on InnoDB is the
   * case that makes this necessary: the server answers with a note saying the engine
   * does not support it, which is not an error and would be lost in a one-line notice.
   */
  const runMaintenance = async (schema: string, tables: string[], op: MaintenanceOpView): Promise<void> => {
    setMaintenance({ op, outcomes: [], running: true })
    try {
      const outcomes = await api.maintain(source.id, { schema, tables, op })
      setMaintenance({ op, outcomes, running: false })
      setError(undefined)
      // ANALYZE changes the row-count statistics, which is what the list shows — so a
      // stale count would contradict the operation the user just ran.
      if (op === 'analyze') await loadStats(schema, true)
    } catch (failure) {
      setMaintenance(undefined)
      setError(t('db.action.failed', { error: failure instanceof Error ? failure.message : String(failure) }))
    }
  }

  /**
   * Refresh what a database-level operation invalidated.
   *
   * Passed the databases that CHANGED, rather than clearing everything: a rename
   * moves a database's tables to a new name, so only the two names involved are
   * stale, and only those are re-read. Clearing the whole map would leave every other
   * open database re-fetching for no reason.
   *
   * `nowOpen` is the database to select afterwards — the operation may have removed
   * the one that was open (rename, drop) or added a new one, and leaving the pane
   * pointed at a name that no longer exists is what produced 正在读取表和统计信息…
   * indefinitely.
   */
  const reloadAfterDatabaseOp = async (changed: { stale?: string[]; nowOpen?: string | undefined }): Promise<void> => {
    await loadSchemas()
    // Forget the statistics of the databases whose contents or names changed.
    if (changed.stale !== undefined && changed.stale.length > 0) {
      const forget = new Set(changed.stale)
      setStatsBySchema(current => {
        const next: Record<string, TableInfo[] | undefined> = {}
        for (const [name, tables] of Object.entries(current)) if (!forget.has(name)) next[name] = tables
        return next
      })
      // The tree's cached table lists too: a rename leaves the old name holding a
      // stale list, and the new name absent.
      setTablesBySchema(current => {
        const next: Record<string, TableInfo[]> = {}
        for (const [name, tables] of Object.entries(current)) if (!forget.has(name)) next[name] = tables
        return next
      })
      setOpenSchemas(current => {
        const next = { ...current }
        for (const name of forget) delete next[name]
        return next
      })
    }
    setSelectedTables(new Set())
    // Point the pane at whatever should be showing now. `setActiveTable(undefined)`
    // because the table that was open belonged to the old name.
    setActiveTable(undefined)
    setActiveSchema(changed.nowOpen)
    if (changed.nowOpen !== undefined) {
      setOpenSchemas(current => (current[changed.nowOpen!] === true ? current : { ...current, [changed.nowOpen!]: true }))
      void loadTables(changed.nowOpen)
    }
  }

  /**
   * Load one page of one table.
   *
   * The schema is a required field of `options`, not read from state: the caller may
   * be loading a table in a database other than the active one (opening a table from
   * the tree sets both together), and a stale `activeSchema` here would silently read
   * the wrong database.
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
    setStructureLoading(true)
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
    } finally {
      setStructureLoading(false)
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
    // Opening a table replaces whatever was on screen, including a SQL result set
    // shown in 浏览: the grid is about to show a different table's rows.
    setSqlResult(undefined)
    // A new table starts unsorted on its first page: a sort carried over from the
    // previous table would order by a column this one may not have.
    setBrowse(current => ({ ...current, page: 1, orderBy: undefined, orderByColumns: undefined, filters: undefined }))
    setError(undefined)
    setNotice(undefined)
    if (nextTab === 'structure' || nextTab === 'insert' || nextTab === 'search') void loadStructure(schema, table)
    if (nextTab === 'browse') void loadRows({ schema, table, page: 1, pageSize: browse.pageSize, mode: 'browse', withIndexes: true })
  }

  /**
   * Switch tabs, loading whatever the target tab needs.
   *
   * 操作 loads the structure too: its 表选项 block needs to know whether the object is
   * a view, and the tab strip only knows the name.
   */
  const changeTab = (next: SqlTab, options: { keepSqlResult?: boolean; browse?: BrowseQuery } = {}): void => {
    setTab(next)
    setError(undefined)
    setNotice(undefined)
    /*
     * A result set belongs to the 浏览 tab and is dropped the moment the user navigates
     * away from it.
     *
     * NOT cleared when the SQL tab itself switches here (`keepSqlResult`): there the
     * result is the destination, and clearing it would throw away the rows just
     * fetched. Any other tab change is the user asking for that tab's content, and a
     * stale result reappearing later — under a toolbar whose controls all act on a
     * TABLE — would make the same grid mean two different things.
     */
    if (options.keepSqlResult !== true) setSqlResult(undefined)
    if (activeTable === undefined || activeSchema === undefined) return
    /*
     * A table read is skipped when a result set is being shown: the grid on screen is
     * the query's own output, so re-reading the table would fetch rows nothing renders
     * and leave the tab with two sources of truth for what it contains.
     */
    if (next === 'browse' && options.keepSqlResult === true) return
    // The 搜索 tab needs the column list too, not only 结构 and 插入: its form is a
    // list of columns with per-type operators, so without them it renders an empty
    // condition row and offers nothing to search by.
    if (next === 'structure' || next === 'insert' || next === 'search' || next === 'operation') {
      void loadStructure(activeSchema, activeTable)
    }
    /*
     * The read uses the query the CALLER passed, when there is one.
     *
     * A caller that sets `browse` and immediately switches tabs (the 搜索 tab does) cannot
     * rely on this closure: `setBrowse` has not been applied yet, so reading `browse`
     * here would issue the read with the PREVIOUS filters — the form would say "3
     * conditions" and the grid would show the whole table.
     */
    const layout = options.browse ?? browse
    if (next === 'browse') void loadRows({
      schema: activeSchema,
      table: activeTable,
      page: layout.page,
      pageSize: layout.pageSize,
      mode: 'browse',
      ...(layout.orderBy === undefined ? {} : { orderBy: layout.orderBy }),
      ...(layout.orderByColumns === undefined ? {} : { orderByColumns: layout.orderByColumns }),
      ...(layout.filters === undefined ? {} : { filters: layout.filters }),
      ...(layout.filterJoin === undefined ? {} : { filterJoin: layout.filterJoin }),
      orderDir: layout.orderDir,
      withIndexes: true,
    })
  }

  /**
   * Follow a table that the 操作 tab moved.
   *
   * A same-database move is a RENAME: the tree's cached list for that database holds
   * the old name, so it is re-read and the pane stays open on the new name. A
   * cross-database move takes the table out of the open database altogether, so the
   * pane returns to that database's TABLE LIST rather than following it into a
   * database the user was not looking at — and whose tree node may not even be loaded.
   * phpMyAdmin does the same: a move lands you on the target database's structure
   * page, not inside the moved table.
   */
  const followMovedTable = (from: { schema: string; table: string }, to: { schema: string; table: string }): void => {
    setSelectedTables(new Set())
    if (from.schema === to.schema) {
      // A rename: same database, new name. Nothing else about the pane changes.
      setActiveTable(to.table)
      setOpenSchemas(current => (current[to.schema] === true ? current : { ...current, [to.schema]: true }))
      void loadTables(to.schema, true)
      void loadStats(to.schema, true)
      return
    }
    // The table left this database: both databases' cached lists are stale.
    setActiveTable(undefined)
    setActiveSchema(to.schema)
    setOpenSchemas(current => (current[to.schema] === true ? current : { ...current, [to.schema]: true }))
    void loadTables(from.schema, true)
    void loadStats(from.schema, true)
    void loadTables(to.schema)
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
        /*
         * The count is the database's TOTAL, not the filtered subset.
         *
         * This number sits on the database's own row, so it answers "how many
         * tables does this database hold". Showing the filtered count made the
         * row claim `dbm_tree 0` while the database held five tables and the
         * filter was simply excluding all of them — a number that contradicted
         * what the API returns for the same database. The filter's effect is
         * already visible in the list below the row.
         */
        tables === undefined
          ? null
          : React.createElement('span', { className: 'dbm-tree-meta' }, String(tables.length)),
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
          /*
           * "No tables" and "your filter excluded them all" are different facts,
           * and conflating them misleads in exactly the case a filter is used: a
           * database with tables reported as having none. The filter's own text is
           * quoted in the message so the reason is not left to be inferred.
           */
          (tables !== undefined && tables.length > 0 && tableFilter !== '')
            ? t('db.noTablesFiltered', { filter: tableFilter })
            : t('db.noTables'),
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

  /**
   * Whether the sidebar's refresh is running.
   *
   * A real flag: the previous handler fired its reads with `void` and returned, so
   * there was nothing to show a busy state for — the button looked inert for as long
   * as the reads took, which on a server with many databases is seconds.
   */
  const [sideRefreshing, setSideRefreshing] = React.useState(false)

  /**
   * Refresh the sidebar: the database list, plus every database that is expanded.
   *
   * A collapsed database is skipped on purpose — it reloads when it is next opened,
   * and reloading all of them would pay for tables nobody is looking at.
   *
   * `await`ed (not `void`ed) so the caller can show that the work is in flight and
   * finish when it is actually done.
   */
  const refreshSide = React.useCallback(async (): Promise<void> => {
    setSideRefreshing(true)
    try {
      await loadSchemas()
      // Only the databases currently expanded, read from the state at call time.
      const open = schemas.filter(schema => openSchemas[schema] === true)
      await Promise.all(open.map(schema => loadTables(schema, true)))
    } finally {
      setSideRefreshing(false)
    }
  }, [loadSchemas, loadTables, schemas, openSchemas])

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
      /*
       * 新建数据库 sits here, immediately left of the refresh control.
       *
       * It was a labelled button in the overview toolbar, which is a long way from
       * where a database is chosen and reads as an action on the tables below it.
       * A "+" beside the refresh control is where a user looks for "add another one
       * of the things this list holds" — the list is the database tree, so the
       * button belongs to the tree's own header.
       *
       * Absent on SQLite, where there is no `CREATE DATABASE`: a SQLite database is a
       * file, so creating one means creating a data source. Offering the control
       * there would be a button whose only outcome is an explanation.
       */
      source.kind === 'mysql'
        ? React.createElement('button', {
            type: 'button',
            className: 'dbm-btn dbm-btn-sm',
            title: t('db.op.create'),
            'aria-label': t('db.op.create'),
            'data-dbm-side-create': '',
            onClick: () => setDatabaseAction('create'),
          }, '+')
        : null,
      React.createElement(
        'button',
        {
          type: 'button',
          className: `dbm-btn dbm-btn-sm${sideRefreshing ? ' dbm-btn-busy' : ''}`,
          title: t('common.refresh'),
          disabled: sideRefreshing,
          'aria-busy': sideRefreshing ? 'true' : undefined,
          'data-dbm-side-refresh': '',
          onClick: () => { void refreshSide() },
        },
        sideRefreshing ? React.createElement('span', { className: 'dbm-spinner' }) : '⟳',
      ),
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
        onTruncate: table => setConfirming({ kind: 'single', table, schema: activeSchema, op: 'truncate' }),
        onDrop: table => setConfirming({ kind: 'single', table, schema: activeSchema, op: 'drop' }),
        onRefresh: () => { void loadTables(activeSchema, true); void loadStats(activeSchema, true) },
        selected: selectedTables,
        onSelect: setSelectedTables,
        maintenanceSupport,
        engineKind: source.kind,
        busy: batchBusy || acting,
        onBatchTruncate: tables => setConfirming({ kind: 'batch', schema: activeSchema, tables, op: 'truncate' }),
        onBatchDrop: tables => setConfirming({ kind: 'batch', schema: activeSchema, tables, op: 'drop' }),
        onBatchExport: tables => setTransfer({ kind: 'export', tables: tables.map(table => table.name) }),
        onMaintain: (op, tables) => { void runMaintenance(activeSchema, tables, op) },
        onExportDatabase: () => setTransfer({ kind: 'export' }),
        onImportDatabase: () => { void openImport(activeSchema) },
        onCreateTable: () => setCreatingTable(true),
        onDatabaseAction: action => setDatabaseAction(action),
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
          // 操作 (phpMyAdmin's own name for this page) goes LAST, after 插入: it is where
          // the table-level operations live, and a tab that can drop the table should
          // not sit between the ones that only read or write rows.
          { id: 'operation' as SqlTab, label: t('tab.operation') },
        ],
        onChange: (next: SqlTab) => changeTab(next),
      }),
    )

    if (tab === 'browse') {
      /*
       * A SQL result set takes over this tab until the user runs another table read.
       *
       * The two are mutually exclusive rather than stacked: a result set describes no
       * table, so the toolbar's paging, index sorting and export/import would be
       * addressing a table the grid is not showing. `changeTab('browse')` and any
       * toolbar action clear it (see `clearSqlResult`).
       */
      if (sqlResult !== undefined) {
        body.push(
          React.createElement(
            'div',
            { key: 'sql-result', className: 'dbm-tab-body', 'data-dbm-sql-result-page': '' },
            React.createElement(
              'div',
              { className: 'dbm-row', style: { padding: '8px 12px' } },
              React.createElement('span', { className: 'dbm-hint' }, t('sql.resultFrom', { schema: activeSchema ?? '', n: sqlResult.result.rows.length })),
              React.createElement('span', { className: 'dbm-spacer' }),
              React.createElement('button', {
                type: 'button',
                className: 'dbm-btn dbm-btn-sm',
                'data-dbm-sql-result-table': '',
                onClick: () => {
                  // Back to the table read. The result set is dropped rather than kept
                  // behind the grid, because the toolbar's controls all act on the
                  // TABLE — leaving a stale result one click away would make the same
                  // grid mean two things.
                  setSqlResult(undefined)
                  void loadRows({
                    schema: selection.schema,
                    table: selection.table,
                    page: 1,
                    pageSize: browse.pageSize,
                    mode: 'browse',
                    withIndexes: true,
                  })
                },
              }, t('sql.showTable', { table: selection.table })),
            ),
            React.createElement('div', { className: 'dbm-pad dbm-hint dbm-mono', style: { paddingTop: 0 } }, sqlResult.sql),
            React.createElement(SqlResultGrid, { result: sqlResult.result }),
          ),
        )
      } else {
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
        // The real in-flight flag, so a REFRESH of a table that already has columns
        // also shows its busy state.
        loading: structureLoading,
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
          sql: sqlText,
          allowWrite: sqlAllowWrite,
          onSql: setSqlText,
          onAllowWrite: setSqlAllowWrite,
          /*
           * A SELECT switches to 浏览 and shows its result THERE.
           *
           * Both halves matter and in this order: `changeTab` clears the notice, so the
           * "returned N rows" message has to be set after the switch — the same
           * ordering the insert flow needs. The result is stored before switching so the
           * grid has it on its first render.
           */
          onSelect: (ranSql, result) => {
            setSqlResult({ sql: ranSql, result })
            changeTab('browse', { keepSqlResult: true })
            setNotice(`${t('sql.resultShownInBrowse', { n: result.rows.length })} · ${t('sql.rerun')}`)
          },
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
          loading: rows?.loading === true,
          ...(rows?.page === undefined ? {} : { total: rows.page.total }),
          /*
           * A search runs in the 浏览 tab, not under the form.
           *
           * The conditions are stored in `browse` and the read is issued BY `changeTab`,
           * so there is exactly one path that reads a table and one place the result
           * appears. `mode` is plain 浏览: with filters in hand the driver builds the
           * same WHERE either way, and the browse mode is what lets the grid page,
           * sort and (on a table with a key) edit the matching rows — all of which the
           * separate search mode had to give up.
           *
           * An EMPTY list is a real search and not a no-op: phpMyAdmin sends no `WHERE`
           * when no row holds a value, so "search with nothing filled in" means every
           * row. The filter list is DROPPED from the query state in that case rather
           * than stored as `[]`, because the two are indistinguishable to the drivers
           * and `undefined` is what a plain read uses.
           */
          onSearch: filters => {
            // Built once and handed to BOTH the state and the read, so the form's
            // conditions and the grid's rows cannot disagree (see `changeTab`).
            const next: BrowseQuery = {
              ...browse,
              page: 1,
              // A new search redefines the result set, so a sort carried over from the
              // previous one would order by the wrong thing — and on a filtered set the
              // index it named may no longer be the useful one.
              orderBy: undefined,
              orderByColumns: undefined,
              ...(filters.length === 0 ? { filters: undefined, filterJoin: undefined } : { filters, filterJoin: 'and' as const }),
            }
            setBrowse(next)
            changeTab('browse', { browse: next })
            setNotice(filters.length === 0
              ? t('search.jumpedAll')
              : t('search.jumpedWith', { n: filters.length }))
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
          /*
           * A single-row insert lands on 浏览; a batch stays on the form.
           *
           * This is what was reported: 插入后还停留在插入 tab. The two submit buttons
           * mean different things and so deserve different outcomes — 插入完成了一次
           * 写入，用户接着要看的是写进去的那一行；而「插入并再填一行」的存在理由就是
           * 继续填同批数据，跳走会让这个按钮失去意义（phpMyAdmin 同样是这个行为）。
           */
          onDone: (message, outcome) => {
            setError(undefined)
            // An INSERT can change the row count the tree shows, so refresh it,
            // and the grid's total is now wrong too.
            void loadTables(selection.schema, true)
            void loadStats(selection.schema, true)
            if (outcome === 'inserted') {
              /*
               * The switch comes FIRST, and the notice after it.
               *
               * `changeTab` clears the notice — a manual tab switch must not leave a
               * stale message from the previous tab on screen — and that wiped the
               * insert's own confirmation when the two were written the other way
               * round. Measured: the form vanished, the grid appeared, and there was
               * nothing at all saying the row had been written. Writing the notice last
               * keeps both behaviours: a manual switch still clears, while the message
               * belonging to the operation that CAUSED the switch survives it.
               */
              changeTab('browse')
              setNotice(message)
            } else {
              setNotice(message)
            }
          },
          onError: (message) => { setError(message); if (message !== undefined) setNotice(undefined) },
        }),
      )
    }

    if (tab === 'operation') {
      /*
       * The open table, as the tree's cached list knows it.
       *
       * `TableInfo` carries the object's kind (table vs view), which the destructive
       * and copy blocks need — but the cached list is not guaranteed to hold this
       * table: the pane can be opened from a list that has since been re-read, or from
       * a database whose node was never expanded. The fallback is a plain table, and
       * the 操作 tab reads the real kind from the server anyway; this value is only what
       * the confirmation dialog names.
       */
      const info = (tablesBySchema[selection.schema] ?? []).find(candidate => candidate.name === selection.table)
        ?? { name: selection.table, type: 'table' } satisfies TableInfo
      body.push(
        React.createElement(SqlOperationsTab, {
          key: 'operation-body',
          api,
          sourceId: source.id,
          engineKind: source.kind,
          schema: selection.schema,
          table: selection.table,
          schemas,
          // Passed through UNSET rather than defaulted to an empty list: the tab tells
          // "this engine supports none of them" from "not read yet" by it, and an empty
          // list would make every block flash a disabled-with-reason state on open.
          support: tableActionSupport,
          ...(tableActionSupportError === undefined ? {} : { supportError: tableActionSupportError }),
          maintenanceSupport,
          busy: batchBusy,
          onBusy: setBatchBusy,
          onNotice: message => { setNotice(message); if (message !== undefined) setError(undefined) },
          onError: message => { setError(message); if (message !== undefined) setNotice(undefined) },
          onMaintain: op => { void runMaintenance(selection.schema, [selection.table], op) },
          onAskDanger: op => setConfirming({ kind: 'single', table: info, schema: selection.schema, op }),
          onMoved: next => followMovedTable({ schema: selection.schema, table: selection.table }, next),
          onTablesChanged: () => {
            void loadTables(selection.schema, true)
            void loadStats(selection.schema, true)
          },
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
          busy: acting || batchBusy,
          onCancel: () => setConfirming(undefined),
          onConfirm: () => {
            if (confirming.kind === 'single') void runTableAction(confirming.schema, confirming.table, confirming.op)
            else void runBatchAction(confirming.schema, confirming.tables, confirming.op)
          },
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
            ...(transfer.tables === undefined ? {} : { tables: transfer.tables }),
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
    maintenance === undefined
      ? null
      : React.createElement(MaintenanceReportDialog, {
          key: 'maintenance',
          outcomes: maintenance.outcomes,
          running: maintenance.running,
          ...(maintenance.op === undefined ? {} : { op: maintenance.op }),
          engineKind: source.kind,
          onClose: () => setMaintenance(undefined),
        }),
    creatingTable && activeSchema !== undefined
      ? React.createElement(CreateTableDialog, {
          key: 'create-table',
          api,
          sourceId: source.id,
          schema: activeSchema,
          kind: source.kind,
          existingTables: (statsBySchema[activeSchema] ?? []).map(table => table.name),
          onClose: () => setCreatingTable(false),
          onCreated: table => {
            setCreatingTable(false)
            setNotice(t('createTable.done', { table }))
            setError(undefined)
            // The new table must appear in the tree and the list, and it has no
            // statistics yet — so both are re-read rather than patched.
            void loadTables(activeSchema, true)
            void loadStats(activeSchema, true)
          },
          onError: message => { if (message !== '') setError(message) },
        })
      : null,
    databaseAction === undefined
      ? null
      : React.createElement(DatabaseActionDialog, {
          key: 'db-action',
          api,
          sourceId: source.id,
          engineKind: source.kind,
          ...(activeSchema === undefined ? {} : { schema: activeSchema }),
          schemas,
          action: databaseAction,
          busy: batchBusy,
          onBusy: setBatchBusy,
          onClose: () => setDatabaseAction(undefined),
          onDone: (message, changed) => {
            setDatabaseAction(undefined)
            setNotice(message)
            setError(undefined)
            // A create/rename/copy/drop changes the database list and can take the open
            // table with it, so what it touched is re-read and the pane lands on a
            // database that actually exists.
            void reloadAfterDatabaseOp(changed)
          },
          onError: message => { setError(message === '' ? undefined : message); if (message !== '') setNotice(undefined) },
        }),
  )
}

/**
 * The confirmation for 清空 / 删除, for one table or for a batch.
 *
 * A separate dialog from the row-editing one because the blast radius is different:
 * these destroy data without a way back, so what will be destroyed is stated in the
 * body and the confirm button is the danger variant rather than the primary one.
 *
 * A batch says HOW MANY and lists the names. "Drop the selected tables?" without the
 * names would ask the user to trust a selection they can no longer see behind the
 * dialog.
 */
function TableActionDialog(props: {
  state: TableConfirm
  busy: boolean
  onCancel(): void
  onConfirm(): void
}): React.ReactElement {
  const { state, busy, onCancel, onConfirm } = props
  const truncate = state.op === 'truncate'

  if (state.kind === 'batch') {
    // A view has no rows of its own, so a batch 清空 silently skips those; say so
    // rather than letting the user think every selected table was emptied.
    const views = state.tables.filter(table => table.type === 'view')
    return React.createElement(Modal, {
      title: t(truncate ? 'db.batch.truncateTitle' : 'db.batch.dropTitle'),
      onClose: onCancel,
      footer: [
        React.createElement('button', { key: 'cancel', type: 'button', className: 'dbm-btn', disabled: busy, onClick: onCancel }, t('common.cancel')),
        React.createElement(
          'button',
          { key: 'ok', type: 'button', className: 'dbm-btn dbm-btn-danger', disabled: busy, 'data-dbm-batch-confirm': '', onClick: onConfirm },
          busy ? t('common.loading') : t(truncate ? 'db.batch.truncate' : 'db.batch.drop'),
        ),
      ],
      children: React.createElement(
        'div',
        null,
        React.createElement('div', null, t(truncate ? 'db.batch.truncateBody' : 'db.batch.dropBody', { n: state.tables.length })),
        React.createElement('div', { className: 'dbm-hint dbm-mono', style: { marginTop: 8, wordBreak: 'break-all' } },
          state.tables.map(table => table.name).join('、')),
        truncate && views.length > 0
          ? React.createElement('div', { className: 'dbm-hint', style: { marginTop: 8 } }, t('db.batch.truncateSkipped', { n: views.length }))
          : null,
      ),
    })
  }

  const single = state.table
  const isView = single.type === 'view'
  // A view has no rows of its own, so emptying one is not a thing to confirm —
  // say why instead of offering a button that would fail.
  const body = truncate
    ? isView
      ? t('db.truncate.bodyView', { table: single.name })
      : t('db.truncate.body', { table: single.name })
    : isView
      ? t('db.drop.bodyView', { table: single.name })
      : t('db.drop.body', { table: single.name })

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
          'data-dbm-single-confirm': '',
          onClick: onConfirm,
        },
        busy ? t('common.loading') : t(truncate ? 'db.action.truncate' : 'db.action.drop'),
      ),
    ],
    children: React.createElement('div', null, body),
  })
}

/**
 * The database overview: one row per table, phpMyAdmin's structure page.
 *
 * This is what a click on a database shows. It carries three things the tree cannot:
 * each table's row count and size, the per-table actions, and — the reason for the
 * tick boxes — the BATCH actions, which need a selection to act on.
 *
 * It is also where the DATABASE-level actions live (create, rename, copy, drop,
 * charset, export, import): they act on the database this page is about, so this is
 * where a user looks for them.
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
  /** Tables ticked for a batch action, by name. */
  selected: Set<string>
  onSelect(next: Set<string>): void
  /** Which maintenance operations this engine supports. */
  maintenanceSupport: MaintenanceOpView[]
  engineKind: string
  busy: boolean
  onBatchTruncate(tables: TableInfo[]): void
  onBatchDrop(tables: TableInfo[]): void
  onBatchExport(tables: TableInfo[]): void
  onMaintain(op: MaintenanceOpView, tables: string[]): void
  /** Open the export dialog for the whole database. */
  onExportDatabase(): void
  /** Open the import dialog, targeting this database. */
  onImportDatabase(): void
  /** Open one database-level action dialog. */
  onDatabaseAction(action: 'create' | 'rename' | 'copy' | 'drop' | 'charset'): void
  /** Open the 新建表 dialog. */
  onCreateTable(): void
}): React.ReactElement {
  const {
    schema, tables, filter, onFilter, loading, onOpen, onTruncate, onDrop, onRefresh,
    selected, onSelect, maintenanceSupport, engineKind, busy,
    onBatchTruncate, onBatchDrop, onBatchExport, onMaintain,
    onExportDatabase, onImportDatabase, onDatabaseAction, onCreateTable,
  } = props

  if (tables === undefined) {
    return React.createElement(
      'div',
      { className: 'dbm-tab-body' },
      React.createElement('div', { className: 'dbm-pad dbm-hint' }, t('db.loadingStats')),
    )
  }

  const needle = filter.trim().toLowerCase()
  const list = needle === '' ? tables : tables.filter(table => table.name.toLowerCase().includes(needle))

  /*
   * A selection is pruned to what is VISIBLE.
   *
   * The filter hides rows, and acting on a hidden table would be acting on something
   * the user cannot see. Deriving the effective selection from the rendered list is
   * what keeps "drop selected" bounded by what is on screen.
   */
  const visibleSelected = list.filter(table => selected.has(table.name))
  const allSelected = list.length > 0 && visibleSelected.length === list.length

  /** Toggle one table's selection. */
  const toggle = (name: string, checked: boolean): void => {
    const next = new Set(selected)
    if (checked) next.add(name)
    else next.delete(name)
    onSelect(next)
  }

  /** One action button in the 操作 cell. */
  const action = (key: string, label: string, onClick: () => void, danger = false, disabled = false, title?: string): React.ReactElement =>
    React.createElement(
      'button',
      {
        key,
        type: 'button',
        className: `dbm-btn dbm-btn-sm${danger ? ' dbm-btn-danger' : ''}`,
        disabled,
        ...(title === undefined ? {} : { title }),
        onClick,
      },
      label,
    )

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    /*
     * The database-level toolbar.
     *
     * Separate from the table filter below it, because these act on the DATABASE
     * rather than on a table: mixing them into one row made the actions sit next to
     * "filter tables", which reads as if they filtered something.
     *
     * 新建数据库 is NOT here: it lives in the sidebar header beside the refresh
     * control, next to the database list it adds to. See the sidebar's own comment.
     */
    React.createElement(
      'div',
      { className: 'dbm-toolbar', 'data-dbm-db-toolbar': '' },
      React.createElement('span', { className: 'dbm-hint' }, `${t('db.op.title')}：`),
      React.createElement('button', {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        disabled: busy,
        'data-dbm-dbop': 'export',
        onClick: onExportDatabase,
      }, t('db.op.exportDb')),
      React.createElement('button', {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        'data-dbm-dbop': 'import',
        onClick: onImportDatabase,
      }, t('db.op.importDb')),
      React.createElement('span', { className: 'dbm-batch-sep' }),
      React.createElement('button', {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        disabled: busy,
        'data-dbm-dbop': 'rename',
        onClick: () => onDatabaseAction('rename'),
      }, t('db.op.rename')),
      React.createElement('button', {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        disabled: busy,
        'data-dbm-dbop': 'copy',
        onClick: () => onDatabaseAction('copy'),
      }, t('db.op.copy')),
      // SQLite has no per-database charset, so the button is disabled with the reason
      // rather than hidden: a missing control the docs mention is harder to explain.
      React.createElement('button', {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        disabled: busy || engineKind === 'sqlite',
        title: engineKind === 'sqlite' ? t('db.op.charsetNoSqlite') : undefined,
        'data-dbm-dbop': 'charset',
        onClick: () => onDatabaseAction('charset'),
      }, t('db.op.charset')),
      React.createElement('span', { className: 'dbm-spacer' }),
      React.createElement('button', {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm dbm-btn-danger',
        disabled: busy,
        'data-dbm-dbop': 'drop',
        onClick: () => onDatabaseAction('drop'),
      }, t('db.op.drop')),
    ),
    React.createElement(
      'div',
      { className: 'dbm-toolbar' },
      React.createElement('span', { className: 'dbm-hint' }, t('db.filterPlaceholder')),
      React.createElement('input', {
        className: 'dbm-input',
        value: filter,
        // No placeholder here: the tree's own filter box already says
        // "search table names"; two identical hints a column apart read as a
        // duplicated control rather than two different ones.
        onChange: (event: { target: { value: string } }) => onFilter(event.target.value),
      }),
      React.createElement('span', { className: 'dbm-hint' }, t('db.overviewFor', { schema, n: tables.length })),
      React.createElement('span', { className: 'dbm-spacer' }),
      /*
       * 新建表 sits on the ROW OF TABLE controls, not with the database actions above.
       *
       * It creates a table in this database, so it belongs beside the table list and
       * its filter — the row whose subject it shares. Putting it among 重命名/复制/
       * 删除 would file it under "things that act on the database", which it is not.
       *
       * A freshly created database has no tables, and until now no way to get one: the
       * panel could browse, alter and drop tables but had no way to create one.
       */
      React.createElement('button', {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        disabled: busy,
        'data-dbm-dbop': 'create-table',
        onClick: onCreateTable,
      }, `+ ${t('db.op.createTable')}`),
      /*
       * The refresh control carries its own busy state, rather than a hint sitting
       * beside it. A listing of a large database can take seconds (the SQLite side
       * walks the file's page map for the sizes), and a control that looks inert for
       * that long reads as a broken button.
       */
      React.createElement(
        'button',
        {
          type: 'button',
          className: `dbm-btn dbm-btn-sm${loading ? ' dbm-btn-busy' : ''}`,
          disabled: loading,
          'aria-busy': loading ? 'true' : undefined,
          'data-dbm-overview-refresh': '',
          onClick: onRefresh,
        },
        loading
          ? [React.createElement('span', { key: 'spin', className: 'dbm-spinner' }), t('common.loading')]
          : t('common.refresh'),
      ),
    ),
    React.createElement(TableBatchBar, {
      key: 'batch',
      selected: visibleSelected.map(table => table.name),
      tables: list,
      schema,
      busy,
      support: maintenanceSupport,
      engineKind,
      allSelected,
      onToggleAll: (checked: boolean) => onSelect(checked ? new Set(list.map(table => table.name)) : new Set()),
      onExport: () => onBatchExport(visibleSelected),
      onTruncate: () => onBatchTruncate(visibleSelected),
      onDrop: () => onBatchDrop(visibleSelected),
      onMaintain: (op: MaintenanceOpView) => onMaintain(op, visibleSelected.map(table => table.name)),
      onClear: () => onSelect(new Set()),
    }),
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
                React.createElement('th', { key: '__select', className: 'dbm-table-select-col' },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: allSelected,
                    disabled: list.length === 0,
                    'aria-label': t('db.selectAll'),
                    title: allSelected ? t('db.selectNone') : t('db.selectAll'),
                    onChange: (event: { target: { checked: boolean } }) => onSelect(
                      event.target.checked ? new Set(list.map(table => table.name)) : new Set(),
                    ),
                  })),
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
                  { key: table.name, 'data-selected': String(selected.has(table.name)) },
                  React.createElement('td', { className: 'dbm-table-select-col' },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: selected.has(table.name),
                      'aria-label': t('db.select'),
                      'data-dbm-table-select': table.name,
                      onChange: (event: { target: { checked: boolean } }) => toggle(table.name, event.target.checked),
                    })),
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
                      action('truncate', t('db.action.truncate'), () => onTruncate(table), false, table.type === 'view',
                        table.type === 'view' ? t('db.truncate.bodyView', { table: table.name }) : undefined),
                      action('drop', t('db.action.drop'), () => onDrop(table), true),
                    ),
                  ),
                  /*
                   * An absent count means UNKNOWN, not zero. SQLite keeps no
                   * row-count statistic until ANALYZE runs, and this panel does not
                   * run it as a side effect of listing — the 分析 batch action is how
                   * a user asks for it. Rendering 0 there would state something false
                   * about a table that may hold millions.
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
                    // MyISAM). SQLite has exactly one storage engine and reports
                    // none, so it falls back to the object kind — which is the
                    // distinction that actually varies there.
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

/**
 * A query result set, as a grid.
 *
 * This is NOT the browse grid, and deliberately so. A `SELECT` result has column
 * NAMES but no declared types, no primary key and no total count, so none of what the
 * browse grid adds on top of a `TablePage` is available here: no paging (the driver
 * already applied its own row limit), no sorting, no in-cell editing, no row keys.
 * Offering any of them would promise something the result of an arbitrary query cannot
 * support — a join has no single table to write a row back to.
 *
 * What it does share is how a NULL is rendered and the read-only cell text, so a value
 * looks the same in both grids.
 */
function SqlResultGrid(props: { result: QueryResult }): React.ReactElement {
  const { result } = props
  if (result.columns.length === 0) {
    return React.createElement('div', { className: 'dbm-pad dbm-hint' }, t('sql.noColumns'))
  }
  return React.createElement(
    'div',
    { className: 'dbm-data', 'data-dbm-sql-result': '' },
    React.createElement(
      'table',
      null,
      React.createElement(
        'thead',
        null,
        React.createElement('tr', null, ...result.columns.map(column => React.createElement('th', { key: column }, column))),
      ),
      React.createElement(
        'tbody',
        null,
        ...result.rows.map((row, index) =>
          React.createElement(
            'tr',
            { key: index },
            ...row.map((cell, cellIndex) =>
              React.createElement(
                'td',
                // The same ellipsis and code font as the browse grid, and the full
                // value in the tooltip, so a long value is inspectable without a
                // column that can be widened.
                { key: cellIndex, className: isNull(cell) ? 'dbm-null' : undefined, title: renderCell(cell) },
                renderCell(cell),
              ),
            ),
          ),
        ),
      ),
    ),
  )
}

/**
 * The SQL tab: an editor for one statement.
 *
 * It no longer renders a result grid of its own. A `SELECT` hands its result to the
 * caller, which shows it in the 浏览 tab — the same place every other read in this
 * panel is shown. Keeping a second grid here meant the same rows appeared in two
 * different shapes depending on which tab you were on.
 *
 * A statement that returns no rows (an `INSERT`, an `UPDATE`, a `DDL`) has nothing to
 * put in a grid, so it stays here and reports what it did. Switching tabs would hide
 * the message that says the write happened.
 */
function SqlTabView(props: {
  api: DbApi
  source: DataSourceSummary
  schema: string | undefined
  sql: string
  allowWrite: boolean
  onSql(text: string): void
  onAllowWrite(next: boolean): void
  /** A SELECT produced rows: show them in the 浏览 tab. */
  onSelect(sql: string, result: QueryResult): void
  onResult(message: string): void
  onError(message: string): void
}): React.ReactElement {
  const { api, source, schema, sql, allowWrite, onSql, onAllowWrite, onSelect, onResult, onError } = props
  const [message, setMessage] = React.useState<string | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)

  const run = async (): Promise<void> => {
    if (sql.trim() === '') return
    setBusy(true)
    setMessage(undefined)
    try {
      const value = await api.runSql(source.id, {
        sql,
        ...(schema === undefined ? {} : { schema }),
        allowWrite,
      })
      if (value.write) {
        const text = t('sql.affected', { n: value.affected, ms: value.durationMs })
        setMessage(text)
        onResult(text)
      } else {
        const text = `${t('sql.rows', { n: value.rows.length, ms: value.durationMs })}${value.truncated ? ` · ${t('sql.truncated')}` : ''}`
        /*
         * A statement that returned a result set leaves for the 浏览 tab, WITH its
         * message, so the notice survives the switch. `changeTab` clears notices, and
         * the caller sets this one AFTER switching — the same ordering the insert
         * flow needs.
         */
        onSelect(sql, value)
        onResult(text)
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
        'data-dbm-sql-editor': '',
        onChange: (event: { target: { value: string } }) => onSql(event.target.value),
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
        React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-primary', disabled: busy, 'data-dbm-sql-run': '', onClick: () => { void run() } }, busy ? t('sql.running') : t('sql.run')),
        React.createElement(
          'label',
          { className: 'dbm-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: allowWrite,
            onChange: (event: { target: { checked: boolean } }) => onAllowWrite(event.target.checked),
          }),
          t('sql.allowWrite'),
        ),
        React.createElement('span', { className: 'dbm-hint' }, t('sql.allowWrite.hint')),
      ),
      message === undefined ? null : React.createElement('div', { className: 'dbm-hint', 'data-dbm-sql-message': '' }, message),
    ),
  )
}

/** Re-exported for the row editor, which the browse grid opens. */
export { Modal }
