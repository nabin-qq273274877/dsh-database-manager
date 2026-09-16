import * as React from 'react'
/**
 * Redis panel, shaped after RedisDesktopManager: a left tree whose roots are
 * the logical databases and whose folders come from the `:` segments of each
 * key's name, and a right area showing the selected key's value (routed by its
 * Redis type), the server overview, and a raw command console.
 *
 * The tree is the panel's primary navigation, so it also owns the two write
 * actions that belong to it — creating a key and deleting a key or a folder.
 * Both go through the route family's user surface: the user clicking in this
 * panel is the authorization, exactly as it is for the SQL row editor, and the
 * agent write gate (auth.ts) is deliberately not involved.
 */

import type { DataSourceSummary, RedisInfo, RedisKeyInfo, RedisTreePage, RedisValue } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { keyFromCommand, splitCommand } from './command.ts'
import {
  DeleteDialog,
  NewKeyDialog,
  RedisKeyTree,
  type RedisCreatePayload,
  type RedisDbNode,
  type RedisSelection,
} from './RedisKeyTree.ts'
import { buildRedisTree, filterTree, type RedisTree } from './redis-tree.ts'
import { BackButton, ErrorBanner, Empty, TabStrip, formatBytes, formatTtl, formatUptime, isNull, renderCell, t } from './ui.ts'

/** The right-hand tabs of a Redis panel. */
type RedisTab = 'value' | 'info' | 'console'

/** Every logical database a Redis server exposes by default. */
const DB_COUNT = 16

/** Props for {@link RedisDatabaseView}. */
export interface RedisDatabaseViewProps {
  api: DbApi
  source: DataSourceSummary
  /** Server overview fetched at connect time. */
  initialInfo: RedisInfo
  /** Step out of this data source, back to the data-source list. */
  onBack(): void
  /** Leave the panel entirely and show the conversation. */
  onClose(): void
}

/** The Redis panel. */
export function RedisDatabaseView(props: RedisDatabaseViewProps): React.ReactElement {
  const { api, source, initialInfo, onBack, onClose } = props
  const [info, setInfo] = React.useState<RedisInfo>(initialInfo)
  const [filter, setFilter] = React.useState('')
  const [trees, setTrees] = React.useState<Record<number, RedisTree | undefined>>({})
  const [loadingDbs, setLoadingDbs] = React.useState<Record<number, boolean>>({})
  /**
   * Databases start collapsed. Opening one scans it for the first time, so a
   * server with keys in several databases pays only for what is opened — and
   * opening all sixteen by default would scan every one on every visit.
   *
   * The connection's own database is opened automatically: that is where the
   * user configured this source to point, so it is where they expect to land.
   */
  const [openDbs, setOpenDbs] = React.useState<Record<number, boolean>>(() => ({ [source.db ?? 0]: true }))
  const [openFolders, setOpenFolders] = React.useState<Record<number, Record<string, boolean> | undefined>>({})
  const [selection, setSelection] = React.useState<RedisSelection>(undefined)
  const [activeKey, setActiveKey] = React.useState<{ db: number; key: string } | undefined>(undefined)
  const [value, setValue] = React.useState<RedisValue | undefined>(undefined)
  const [valueLoading, setValueLoading] = React.useState(false)
  const [tab, setTab] = React.useState<RedisTab>('value')
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [notice, setNotice] = React.useState<string | undefined>(undefined)

  /** The 新增键 dialog's target, or undefined when it is closed. */
  const [createFor, setCreateFor] = React.useState<{ db: number; folderPath: string | undefined } | undefined>(undefined)
  /** The delete confirmation's target, plus the count for a folder. */
  const [deleteFor, setDeleteFor] = React.useState<
    | { target: { kind: 'key'; db: number; key: string } | { kind: 'folder'; db: number; path: string }; count: number | undefined }
    | undefined
  >(undefined)
  const [busy, setBusy] = React.useState(false)

  /**
   * Load one database's whole key set and build its tree.
   *
   * A whole scan rather than a SCAN page, because the tree groups by prefix and
   * a partial page would render folders that silently lack members. The scan is
   * capped host-side and reports truncation, which the tree surfaces.
   */
  const loadTree = React.useCallback(async (db: number): Promise<void> => {
    setLoadingDbs(current => ({ ...current, [db]: true }))
    try {
      const page: RedisTreePage = await api.redisTree(source.id, { db })
      setTrees(current => ({ ...current, [db]: buildRedisTree(page.keys, page.truncated) }))
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      // An empty tree so the node does not sit on "scanning…" forever; the
      // refresh control retries.
      setTrees(current => ({ ...current, [db]: buildRedisTree([], false) }))
    } finally {
      setLoadingDbs(current => ({ ...current, [db]: false }))
    }
  }, [api, source.id])

  /** Refresh the server overview and every loaded tree. */
  const refreshAll = React.useCallback(async (): Promise<void> => {
    try {
      setInfo(await api.redisInfo(source.id))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
    for (const db of Object.keys(trees)) void loadTree(Number(db))
  }, [api, source.id, trees, loadTree])

  // Scan the connection's own database once, since it starts expanded.
  const initialDb = source.db ?? 0
  React.useEffect(() => { void loadTree(initialDb) }, [initialDb, loadTree])

  /** Expand or collapse one database, loading it on first open. */
  const toggleDb = (db: number): void => {
    const next = openDbs[db] !== true
    setOpenDbs(current => ({ ...current, [db]: next }))
    if (next && trees[db] === undefined) void loadTree(db)
  }

  /** Expand or collapse one folder. Folders hold no state of their own. */
  const toggleFolder = (db: number, path: string): void => {
    setOpenFolders(current => {
      const forDb = current[db] ?? {}
      return { ...current, [db]: { ...forDb, [path]: forDb[path] !== true } }
    })
  }

  /** Load one key's value from a specific database. */
  const loadValue = React.useCallback(async (db: number, key: string): Promise<void> => {
    setValueLoading(true)
    setError(undefined)
    try {
      setValue(await api.redisValue(source.id, { key, db }))
    } catch (failure) {
      setValue(undefined)
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setValueLoading(false)
    }
  }, [api, source.id])

  const selectKey = (db: number, key: string): void => {
    setSelection({ kind: 'key', db, key })
    setActiveKey({ db, key })
    setTab('value')
    void loadValue(db, key)
  }

  /** The databases to list: what the server reports, or the default range. */
  const databases: RedisDbNode[] = React.useMemo(() => {
    const byDb = new Map(info.databases.map(entry => [entry.db, entry.keys]))
    // A configured database outside the reported range (a narrowed `databases`
    // setting) must still be reachable, so it is folded in.
    const configured = source.db ?? 0
    const highest = Math.max(DB_COUNT - 1, configured, ...info.databases.map(entry => entry.db))
    return Array.from({ length: highest + 1 }, (_, db) => ({ db, keys: byDb.get(db) ?? 0 }))
  }, [info.databases, source.db])

  /** The trees as filtered for display. */
  const visibleTrees = React.useMemo(() => {
    const next: Record<number, RedisTree | undefined> = {}
    for (const [key, tree] of Object.entries(trees)) {
      next[Number(key)] = tree === undefined ? undefined : filterTree(tree, filter)
    }
    return next
  }, [trees, filter])

  // ---- write actions -----------------------------------------------------
  const submitCreate = async (keys: RedisCreatePayload[]): Promise<void> => {
    if (createFor === undefined) return
    setBusy(true)
    try {
      await api.redisCreateKeys(source.id, { db: createFor.db, keys })
      setError(undefined)
      setCreateFor(undefined)
      setNotice(t('redisnew.done', { n: keys.length }))
      // The folder a key was added to must be open for it to be visible.
      setOpenDbs(current => ({ ...current, [createFor.db]: true }))
      if (createFor.folderPath !== undefined) {
        setOpenFolders(current => {
          const forDb = current[createFor.db] ?? {}
          return { ...current, [createFor.db]: { ...forDb, [createFor.folderPath!]: true } }
        })
      }
      await refreshAll()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  /** Open the delete confirmation, counting a folder's keys first. */
  const askDeleteKey = (db: number, key: string): void => {
    setDeleteFor({ target: { kind: 'key', db, key }, count: undefined })
  }

  const askDeleteFolder = (db: number, path: string): void => {
    setDeleteFor({ target: { kind: 'folder', db, path }, count: undefined })
    void api.redisPrefixCount(source.id, { prefix: path, db })
      .then(count => setDeleteFor(current =>
        current !== undefined && current.target.kind === 'folder' && current.target.path === path
          ? { ...current, count }
          : current,
      ))
      .catch(() => { /* the dialog stays on its "unknown" wording */ })
  }

  const confirmDelete = async (): Promise<void> => {
    if (deleteFor === undefined) return
    setBusy(true)
    try {
      if (deleteFor.target.kind === 'key') {
        const { db, key } = deleteFor.target
        const removed = await api.redisDeleteKey(source.id, { key, db })
        setNotice(removed ? t('sql.affected', { n: 1, ms: 0 }) : t('redis.noKeys'))
        if (activeKey?.db === db && activeKey.key === key) {
          setActiveKey(undefined)
          setValue(undefined)
        }
      } else {
        const { db, path } = deleteFor.target
        const result = await api.redisDeletePrefix(source.id, { prefix: path, db })
        setNotice(result.truncated
          ? `${t('sql.affected', { n: result.deleted, ms: 0 })} · ${t('redisdelete.truncated')}`
          : t('sql.affected', { n: result.deleted, ms: 0 }))
        // The open key may have just been deleted; drop it rather than leaving
        // a stale value on screen.
        if (activeKey?.db === db && (activeKey.key === path || activeKey.key.startsWith(`${path}:`))) {
          setActiveKey(undefined)
          setValue(undefined)
        }
      }
      setError(undefined)
      setDeleteFor(undefined)
      await refreshAll()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  // ---- left: the tree ----------------------------------------------------
  const left = React.createElement(
    'div',
    { className: 'dbm-side' },
    React.createElement(
      'div',
      { className: 'dbm-side-head' },
      React.createElement('input', {
        className: 'dbm-input',
        style: { flex: 1 },
        value: filter,
        placeholder: t('redisdb.filter'),
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => setFilter(event.target.value),
      }),
      React.createElement('button', {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        title: t('redisdb.refresh'),
        'aria-label': t('redisdb.refresh'),
        onClick: () => { void refreshAll() },
      }, '⟳'),
    ),
    React.createElement(
      'div',
      { className: 'dbm-side-body' },
      React.createElement(RedisKeyTree, {
        databases,
        trees: visibleTrees,
        loadingDbs,
        openDbs,
        openFolders,
        filter,
        selection,
        activeKey,
        onToggleDb: toggleDb,
        onToggleFolder: toggleFolder,
        onSelectKey: selectKey,
        onSelectFolder: (db, path, name) => setSelection({ kind: 'folder', db, path, name }),
        onCreate: (db, folderPath) => setCreateFor({ db, folderPath }),
        onDeleteKey: askDeleteKey,
        onDeleteFolder: askDeleteFolder,
      }),
    ),
  )

  // ---- right: value / info / console ------------------------------------
  const body: unknown[] = [
    React.createElement(TabStrip, {
      key: 'tabs',
      active: tab,
      tabs: [
        { id: 'value' as RedisTab, label: t('redis.value') },
        { id: 'info' as RedisTab, label: t('redis.info') },
        { id: 'console' as RedisTab, label: t('redis.console') },
      ],
      onChange: (next: RedisTab) => setTab(next),
    }),
  ]

  if (tab === 'value') {
    body.push(
      value === undefined
        ? React.createElement(Empty, { key: 'empty', message: valueLoading ? t('common.loading') : t('redis.selectKey') })
        : React.createElement(ValueView, { key: 'value', value, source }),
    )
  }

  if (tab === 'info') {
    body.push(React.createElement(InfoView, {
      key: 'info',
      info,
      onRefresh: () => { void refreshAll() },
    }))
  }

  if (tab === 'console') {
    body.push(
      React.createElement(ConsoleView, {
        key: 'console',
        api,
        source,
        db: selection?.db ?? initialDb,
        onResult: (message) => { setNotice(message); setError(undefined) },
        onError: (message) => { setError(message); setNotice(undefined) },
        onMutated: (key) => {
          // A write can create, change or remove the key being shown; re-read
          // both the selection and the trees so they stay truthful.
          void refreshAll()
          if (key !== undefined && activeKey?.key === key) void loadValue(activeKey.db, key)
        },
      }),
    )
  }

  const activeDb = selection?.db ?? initialDb

  return React.createElement(
    'div',
    { className: 'dbm-root' },
    React.createElement(
      'div',
      { className: 'dbm-header' },
      React.createElement(BackButton, { onBack, label: t('panel.backToList') }),
      React.createElement('span', { className: 'dbm-title' }, source.name),
      React.createElement('span', { className: 'dbm-badge dbm-badge-redis' }, 'redis'),
      React.createElement('span', { className: 'dbm-subtitle dbm-mono' }, `${source.host ?? ''}:${source.port ?? ''}/db${activeDb}`),
      React.createElement('span', { className: 'dbm-spacer' }),
      React.createElement(BackButton, { onBack: onClose }),
    ),
    error === undefined ? null : React.createElement(ErrorBanner, { message: error }),
    notice === undefined ? null : React.createElement('div', { className: 'dbm-ok', style: { padding: '6px 14px' } }, notice),
    React.createElement('div', { className: 'dbm-split' }, left as never, React.createElement('div', { className: 'dbm-main' }, body as never)),
    createFor === undefined ? null : React.createElement(NewKeyDialog, {
      db: createFor.db,
      folderPath: createFor.folderPath,
      busy,
      onSubmit: submitCreate,
      onClose: () => setCreateFor(undefined),
    }),
    deleteFor === undefined ? null : React.createElement(DeleteDialog, {
      target: deleteFor.target,
      count: deleteFor.count,
      busy,
      onConfirm: () => { void confirmDelete() },
      onClose: () => setDeleteFor(undefined),
    }),
  )
}

/** The 值 tab: the selected key's content, shaped by type. */
function ValueView(props: { value: RedisValue; source: DataSourceSummary }): React.ReactElement {
  const { value } = props
  const head = React.createElement(
    'div',
    { className: 'dbm-pad' },
    React.createElement('div', { className: 'dbm-row' }, React.createElement('strong', { className: 'dbm-mono' }, value.key)),
    React.createElement(
      'div',
      { className: 'dbm-row' },
      React.createElement('span', { className: `dbm-badge dbm-badge-${value.type === 'string' ? 'ok' : 'sqlite'}` }, value.type),
      React.createElement('span', { className: 'dbm-hint' }, `${t('redis.ttl')}: ${formatTtl(value.ttl)}`),
      value.truncated === true ? React.createElement('span', { className: 'dbm-hint' }, t('redis.truncated', { n: 1000 })) : null,
    ),
  )

  if (value.type === 'string') {
    return React.createElement(
      'div',
      { className: 'dbm-tab-body' },
      head,
      React.createElement(
        'div',
        { className: 'dbm-scroll' },
        React.createElement(
          'div',
          { className: 'dbm-pad' },
          React.createElement('div', { className: 'dbm-hint' }, `${t('redis.stringValue')} · ${formatBytes((value.value ?? '').length)}`),
          React.createElement('pre', { className: 'dbm-mono', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 } }, value.value ?? ''),
        ),
      ),
    )
  }

  const rows: Array<[string, string, string | undefined]> = []
  if (value.items !== undefined) {
    value.items.forEach((item, index) => rows.push([String(index), item, undefined]))
  }
  if (value.fields !== undefined) {
    value.fields.forEach(item => rows.push([item.field, item.value, undefined]))
  }
  if (value.members !== undefined) {
    value.members.forEach(item => rows.push([item.member, item.score, item.score]))
  }
  if (value.entries !== undefined) {
    value.entries.forEach(entry => {
      for (const field of entry.fields) rows.push([`${entry.id} · ${field.field}`, field.value, entry.id])
    })
  }

  const isHash = value.fields !== undefined
  const isZset = value.members !== undefined
  const isStream = value.entries !== undefined
  const firstLabel = isHash ? t('redis.field') : isZset ? t('redis.member') : isStream ? t('redis.entry') : '#'

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    head,
    React.createElement(
      'div',
      { className: 'dbm-data' },
      rows.length === 0
        ? React.createElement(Empty, { message: t('redis.noKeys') })
        : React.createElement(
            'table',
            null,
            React.createElement(
              'thead',
              null,
              React.createElement(
                'tr',
                null,
                React.createElement('th', null, firstLabel),
                React.createElement('th', null, t('redis.value')),
                isZset ? React.createElement('th', null, t('redis.score')) : null,
              ),
            ),
            React.createElement(
              'tbody',
              null,
              rows.map(([left, right, third], index) =>
                React.createElement(
                  'tr',
                  { key: index },
                  React.createElement('td', { title: left }, left),
                  React.createElement('td', { title: right }, right),
                  isZset ? React.createElement('td', null, third ?? '') : null,
                ),
              ),
            ),
          ),
    ),
  )
}

/** The 服务信息 tab. */
function InfoView(props: { info: RedisInfo; onRefresh(): void }): React.ReactElement {
  const { info, onRefresh } = props
  const facts: Array<[string, string]> = []
  if (info.version !== undefined) facts.push([t('redis.version'), info.version])
  if (info.mode !== undefined) facts.push([t('redis.mode'), info.mode])
  if (info.uptimeSeconds !== undefined) facts.push([t('redis.uptime'), formatUptime(info.uptimeSeconds)])
  if (info.usedMemoryHuman !== undefined) facts.push([t('redis.memory'), info.usedMemoryHuman])
  if (info.connectedClients !== undefined) facts.push([t('redis.clients'), String(info.connectedClients)])
  if (info.totalKeys !== undefined) facts.push([t('redis.totalKeys'), String(info.totalKeys)])

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    React.createElement(
      'div',
      { className: 'dbm-scroll' },
      React.createElement(
        'div',
        { className: 'dbm-pad' },
        React.createElement(
          'div',
          { className: 'dbm-row' },
          React.createElement('strong', null, t('redis.info')),
          React.createElement('span', { className: 'dbm-spacer' }),
          React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', onClick: onRefresh }, t('common.refresh')),
        ),
        React.createElement(
          'div',
          { className: 'dbm-grid' },
          facts.map(([label, val]) =>
            React.createElement(
              'div',
              { key: label },
              React.createElement('div', { className: 'dbm-hint' }, label),
              React.createElement('div', { className: 'dbm-mono' }, val),
            ),
          ),
        ),
        React.createElement('strong', null, t('redis.databases')),
        info.databases.length === 0
          ? React.createElement('div', { className: 'dbm-hint' }, t('redis.noKeys'))
          : React.createElement(
              'table',
              { className: 'dbm-table' },
              React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', null, t('redis.db')), React.createElement('th', null, t('redis.keys')))),
              React.createElement(
                'tbody',
                null,
                info.databases.map(entry =>
                  React.createElement(
                    'tr',
                    { key: entry.db },
                    React.createElement('td', null, `db${entry.db}`),
                    React.createElement('td', null, String(entry.keys)),
                  ),
                ),
              ),
            ),
      ),
    ),
  )
}

/** The 命令行 tab: one raw command plus its reply. */
function ConsoleView(props: {
  api: DbApi
  source: DataSourceSummary
  db: number
  onResult(message: string): void
  onError(message: string): void
  onMutated(key?: string): void
}): React.ReactElement {
  const { api, source, db, onResult, onError, onMutated } = props
  const [command, setCommand] = React.useState('')
  const [allowWrite, setAllowWrite] = React.useState(false)
  const [result, setResult] = React.useState<{ columns: string[]; rows: Array<Array<string | number | boolean | null>>; message: string } | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)

  const run = async (): Promise<void> => {
    const args = splitCommand(command)
    if (args.length === 0) return
    setBusy(true)
    setResult(undefined)
    try {
      const value = await api.redisCommand(source.id, { args, db, allowWrite })
      const message = t('sql.rows', { n: value.rows.length, ms: value.durationMs })
      setResult({ columns: value.columns, rows: value.rows, message })
      onResult(message)
      onMutated(keyFromCommand(args))
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
      React.createElement('input', {
        className: 'dbm-input dbm-mono',
        value: command,
        placeholder: t('redis.consolePlaceholder'),
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => setCommand(event.target.value),
        onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') void run() },
      }),
      React.createElement(
        'div',
        { className: 'dbm-row' },
        React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-primary', disabled: busy, onClick: () => { void run() } }, busy ? t('common.loading') : t('redis.consoleRun')),
        React.createElement(
          'label',
          { className: 'dbm-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: allowWrite,
            onChange: (event: { target: { checked: boolean } }) => setAllowWrite(event.target.checked),
          }),
          t('redis.allowWrite'),
        ),
        React.createElement('span', { className: 'dbm-hint' }, `db${db} · ${allowWrite ? t('redis.allowWrite.hint') : t('redis.readonlyNotice')}`),
      ),
    ),
    result === undefined
      ? null
      : React.createElement(
          'div',
          { className: 'dbm-tab-body', style: { minHeight: 0 } },
          React.createElement('div', { className: 'dbm-pad dbm-hint' }, result.message),
          React.createElement(
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

/** Re-exported so the panel root keeps one import site for the dialogs. */
export { RedisKeyTree, NewKeyDialog, DeleteDialog }
export type { RedisDbNode, RedisSelection, RedisKeyInfo }
