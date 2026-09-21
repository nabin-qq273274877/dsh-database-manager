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

import type {
  DataSourceSummary,
  RedisIndexStatus,
  RedisInfo,
  RedisKeyInfo,
  RedisValue,
} from '../protocol.ts'
import type { DbApi } from './api.ts'
import { DbApiError } from './api.ts'
import { keyFromCommand, splitCommand } from './command.ts'
import {
  DeleteDialog,
  NewKeyDialog,
  RedisKeyTree,
  levelKey,
  type RedisCreatePayload,
  type RedisDbNode,
  type RedisFolderRow,
  type RedisLevel,
  type RedisSearchState,
  type RedisSelection,
} from './RedisKeyTree.ts'
import { RedisValueEditor } from './RedisValueEditor.ts'
import { BackButton, ErrorBanner, Empty, TabStrip, formatTtl, formatUptime, isNull, renderCell, t } from './ui.ts'

/** The right-hand tabs of a Redis panel. */
type RedisTab = 'value' | 'info' | 'console'

/** Every logical database a Redis server exposes by default. */
const DB_COUNT = 16

/**
 * Key count at which a database is indexed rather than scanned per level.
 *
 * The distinction is not about speed but about whether per-level scanning works AT
 * ALL. Redis has no prefix index, so listing a level walks the whole keyspace: at
 * this size one level already means scanning a million keys, which a click cannot
 * wait for. Below it, the scan is a single bounded request and an upfront index
 * build would be pure overhead.
 */
const LARGE_DB_KEYS = 1_000_000

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
  /**
   * The search box's contents. Typing does NOT search: the pattern is sent when
   * the user asks for it (Enter or the button), because a search scans the whole
   * database server-side and firing one per keystroke would hammer the server.
   */
  const [pattern, setPattern] = React.useState('')
  /** The database a search applies to. */
  const [searchDb, setSearchDb] = React.useState<number>(source.db ?? 0)
  /** The active search, or undefined when the tree shows its structure. */
  const [search, setSearch] = React.useState<RedisSearchState | undefined>(undefined)
  /**
   * Loaded levels, keyed by `${db}\0${prefix}`.
   *
   * A level is fetched the first time its folder is opened, never before — the
   * whole point of the design, since a production database cannot be scanned up
   * front.
   */
  const [levels, setLevels] = React.useState<Record<string, RedisLevel | undefined>>({})
  /**
   * Databases start COLLAPSED — every one of them, including the source's own.
   *
   * Auto-expanding that one used to look helpful, but its cost is a full scan of
   * whatever database the source points at, and that database can be huge: a db
   * with 485k keys made the panel sit there scanning before the list appeared.
   * The database list is cheap and always useful, so the panel shows that and
   * scans only what the user actually opens.
   */
  const [openDbs, setOpenDbs] = React.useState<Record<number, boolean>>({})
  const [openFolders, setOpenFolders] = React.useState<Record<number, Record<string, boolean> | undefined>>({})
  /**
   * What the user last selected in the tree: a key, a folder, or a database.
   *
   * Undefined until something is selected. Nothing is expanded on open, so
   * claiming a database was "in view" would be inventing a state the user never
   * chose.
   */
  const [selection, setSelection] = React.useState<RedisSelection>(undefined)
  /**
   * The database the console's commands run against.
   *
   * Deliberately NOT a view of `selection`, and that separation is a safety
   * property: the console can WRITE, so its target must not silently change
   * because a key in another database was clicked for inspection. It changes only
   * through its own selector.
   */
  const [consoleDb, setConsoleDb] = React.useState<number>(source.db ?? 0)
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
  /** A dialog's own submit/confirm action is in flight. */
  const [busy, setBusy] = React.useState(false)
  /**
   * A tree-wide refresh is in flight (a write just happened, or ⟳ was pressed).
   *
   * Surfaced on the refresh control so the wait is visible even when the branch
   * that changed is scrolled out of view — the level's own row marker only helps
   * if that row is on screen.
   */
  const [refreshing, setRefreshing] = React.useState(false)

  /**
   * Databases whose levels are served from a cached keyspace index.
   *
   * A set rather than a boolean per database because the level loader reads it to
   * choose its source, and it must be stable across renders (it is a dependency of
   * that callback). A database joins it as soon as a walk is started, so levels open
   * from the index while it is still filling in.
   */
  /**
   * Databases whose levels are served from a cached keyspace index.
   *
   * A REF, not state, and deliberately so. The level loader reads it to choose
   * its source; `loadLevel` is a useCallback, so it would close over the
   * `indexDbs` of the render that created it. `buildIndex` marks the database
   * and then, in the SAME invocation, asks for its root level — but a state
   * update has not produced a new render yet, so the loader still saw the old
   * set, concluded no index existed and fell back to a scan. Measured on db1
   * (2M keys) with the walk already `done`: the tree was answered by
   * `/redis/level` and reported its counts as lower bounds ("此处仅扫描了
   * 200,010 个") — the one notice a finished index is supposed to eliminate.
   *
   * A ref is updated synchronously, so the loader cannot read a set that
   * predates the walk it was just told about. There is no matching state
   * variable: nothing renders from this set, and keeping a state copy would
   * only suggest a re-render dependency that does not exist.
   */
  const indexDbsRef = React.useRef<Set<number>>(new Set())

  /** Mark one database as index-served. */
  const addIndexDb = React.useCallback((db: number): void => {
    indexDbsRef.current = new Set(indexDbsRef.current).add(db)
  }, [])

  /** Undo {@link addIndexDb}, e.g. when a walk failed and must fall back. */
  const dropIndexDb = React.useCallback((db: number): void => {
    const next = new Set(indexDbsRef.current)
    next.delete(db)
    indexDbsRef.current = next
  }, [])

  /**
   * Index walk progress, per database, while a walk is running.
   *
   * Kept for the progress display: on a huge database the walk takes about a minute,
   * and a real percentage is what makes that wait legible. Removed once the walk
   * finishes, since a finished index needs no banner.
   */
  const [indexProgress, setIndexProgress] = React.useState<Record<number, RedisIndexStatus | undefined>>({})

  /**
   * Load one level.
   *
   * Two sources, and the choice matters on a large database:
   *
   * - The **keyspace index**, when one exists for this database. It answers from
   *   memory on the host, so expanding a level costs nothing at all. This is the
   *   path that makes a 19.5M-key database browsable: a per-level scan there is a
   *   full traversal of the keyspace (Redis has no prefix index), measured in
   *   minutes, whereas the index pays that once and reuses it.
   * - A **per-level scan** otherwise. For a small or medium database it is one
   *   bounded request and needs no upfront walk, so the panel does not impose an
   *   index build on someone browsing a few thousand keys.
   *
   * A 409 from the index route means "nothing built yet"; that is not an error the
   * user should see, so the scan answers instead.
   *
   * @param prefix - '' for the database root.
   */
  const loadLevel = React.useCallback(async (db: number, prefix: string): Promise<void> => {
    const key = levelKey(db, prefix)
    setLevels(current => ({
      ...current,
      [key]: current[key] === undefined
        ? { folders: [], keys: [], truncated: false, keysAtLevel: 0, loading: true }
        : { ...current[key]!, loading: true, error: undefined },
    }))

    /** Apply a level from either source, normalising the two reply shapes. */
    const apply = (level: {
      folders: RedisFolderRow[]
      keys: RedisKeyInfo[]
      keysAtLevel: number
      truncated?: boolean
      partial?: boolean
      visited?: number
      dbSize?: number
    }): void => {
      setLevels(current => ({
        ...current,
        [key]: {
          folders: level.folders,
          keys: level.keys,
          truncated: level.truncated ?? false,
          keysAtLevel: level.keysAtLevel,
          /*
           * An index still being built is the only remaining source of an
           * incomplete level, and it is temporary — the walk covers the whole
           * keyspace, so the rows fill in and the notice disappears at `done`.
           *
           * The per-level scan has no equivalent flag any more: it reads its level
           * to the end, so a finished answer is exact. The `countsApproximate`
           * field that used to carry "the folder list may be short" is gone with
           * the key budget that produced it.
           */
          partial: level.partial === true,
          /*
           * The building notice's progress numbers. The index reports
           * `visited`/`dbSize` and the notice reads one pair; leaving them unset
           * made the renderer fall back to zeroes, so a mid-walk level announced
           * "该库共 0 个键，此处仅扫描了 0 个" — a wrong database size, stated
           * confidently, on the very screen whose purpose is to say the numbers
           * may be short.
           */
          visited: level.visited,
          dbSize: level.dbSize,
        },
      }))
    }

    try {
      if (indexDbsRef.current.has(db)) {
        try {
          const level = await api.redisIndexLevel(source.id, { db, prefix, withTypes: prefix !== '' })
          apply(level)
          setError(undefined)
          return
        } catch (failure) {
          // 409 = no index yet (and any other index problem degrades the same way).
          // Falling back keeps the panel usable rather than showing an error for a
          // cache that simply is not there.
          if (!(failure instanceof DbApiError) || failure.status !== 409) throw failure
        }
      }
      const page = await api.redisLevel(source.id, { db, prefix, withTypes: prefix !== '' })
      apply(page)
      setError(undefined)
    } catch (failure) {
      setLevels(current => ({
        ...current,
        [key]: {
          folders: [], keys: [], truncated: false, keysAtLevel: 0,
          error: failure instanceof Error ? failure.message : String(failure),
        },
      }))
    }
  }, [api, source.id])

  /**
   * Refresh the server overview and every loaded level.
   *
   * AWAITS every reload rather than firing them off. The callers are the write
   * paths, and their whole point is to leave the tree showing the new truth
   * before they clear their busy flag — returning early let the flag drop while
   * the tree was still fetching, which is precisely the "nothing happened for a
   * moment" gap this is meant to close.
   *
   * @param extra - levels to reload as well, for a target that is not loaded yet
   *   (a folder a create just opened, so it is absent from `levels`). Deduped
   *   against the loaded ones, so nothing is fetched twice.
   */
  const refreshAll = React.useCallback(async (extra?: Array<{ db: number; prefix: string }>): Promise<void> => {
    setRefreshing(true)
    try {
      try {
        setInfo(await api.redisInfo(source.id))
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
      // Only the loaded levels: a collapsed folder's data is discarded anyway,
      // and re-scanning it would defeat the lazy design.
      const targets = new Map<string, { db: number; prefix: string }>()
      for (const key of Object.keys(levels)) {
        const at = key.indexOf('\u0000')
        targets.set(key, { db: Number(key.slice(0, at)), prefix: key.slice(at + 1) })
      }
      for (const item of extra ?? []) targets.set(levelKey(item.db, item.prefix), item)
      await Promise.all([...targets.values()].map(item => loadLevel(item.db, item.prefix)))
    } finally {
      setRefreshing(false)
    }
  }, [api, source.id, levels, loadLevel])

  /** The database the source is configured for; the console and value pane fall back to it. */
  const initialDb = source.db ?? 0

  /*
   * Nothing is scanned on open. There used to be a `loadLevel(initialDb, '')`
   * here, which fired the moment the panel appeared — a full SCAN of that
   * database before the user had asked for anything. On a db holding 485k keys
   * that is a visible stall on every entry into the panel, for a level the user
   * may never look at. The database list comes from `INFO`/`DBSIZE` (cheap) and
   * is what the panel shows; a level is scanned only when its database is opened.
   */

  /**
   * Start a keyspace walk and follow it to completion.
   *
   * Polls rather than streaming: the walk runs on the host in bounded steps, so
   * asking for progress is a cheap request, and polling keeps the client free of any
   * assumption about how long the walk takes.
   *
   * The database is marked index-served FIRST, so levels opened while the walk is
   * still running read from whatever has been indexed instead of falling back to a
   * full traversal — that is what makes the tree appear immediately on a huge
   * database rather than after the walk.
   */
  const buildIndex = React.useCallback(async (db: number): Promise<void> => {
    addIndexDb(db)
    try {
      const first = await api.redisIndexStart(source.id, { db })
      setIndexProgress(current => ({ ...current, [db]: first }))

      let status = first
      // Bounded so a stalled walk surfaces as a stop rather than an endless poll.
      const deadline = Date.now() + 10 * 60 * 1000
      while (!status.done && status.error === undefined && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 400))
        status = await api.redisIndexStart(source.id, { db })
        setIndexProgress(current => ({ ...current, [db]: status }))
      }

      setIndexProgress(current => ({ ...current, [db]: undefined }))
      if (status.error !== undefined) {
        setError(status.error)
        return
      }
      /*
       * Bring the tree up to date from the finished index.
       *
       * `refreshAll` alone is not enough: it reloads only levels that were ALREADY
       * loaded, and the root level of this database typically is not — the user
       * opened the database, which started the walk, and no level request has
       * happened yet. Loading it explicitly is what makes the folders appear as soon
       * as the walk finishes instead of after a second click.
       */
      await loadLevel(db, '')
      await refreshAll()
    } catch (failure) {
      // A failed walk must not leave the database stuck on the index path, or every
      // level would keep failing instead of falling back to the scan.
      dropIndexDb(db)
      setIndexProgress(current => ({ ...current, [db]: undefined }))
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [api, source.id, refreshAll, loadLevel, addIndexDb, dropIndexDb])

  /**
   * Expand one database, indexing it first when it is large enough to need it.
   *
   * A small database needs no index: the per-level scan is one bounded request and
   * imposes no upfront cost. A large one cannot be scanned per level at all (each
   * level is a full traversal), so the walk starts immediately.
   *
   * There is no confirmation prompt. There used to be one, explaining the cost in
   * seconds before the walk began — and it asked the user to weigh a number the
   * panel had measured on their behalf, for an operation that is read-only, runs in
   * bounded steps, and whose only real alternative is not browsing the database at
   * all. Progress is reported while it runs, which is what the user actually needs;
   * a dialog before it was a gate in front of the one thing they asked for.
   */
  const toggleDb = (db: number): void => {
    const next = openDbs[db] !== true
    setOpenDbs(current => ({ ...current, [db]: next }))
    if (next) setSelection({ kind: 'db', db })
    if (!next) return

    if (indexDbsRef.current.has(db)) {
      if (levels[levelKey(db, '')] === undefined) void loadLevel(db, '')
      return
    }

    const size = databases.find(node => node.db === db)?.keys ?? 0
    // Below the threshold, scanning a level is cheap and an index would be a
    // pointless upfront cost. At or above it, per-level scanning cannot work at all.
    if (size < LARGE_DB_KEYS) {
      if (levels[levelKey(db, '')] === undefined) void loadLevel(db, '')
      return
    }

    // Large: start the walk. `buildIndex` marks the database as index-served first,
    // so the tree fills in from the index as it is built rather than waiting.
    void buildIndex(db)
  }

  /** Expand or collapse one folder, loading its level on first open. */
  const toggleFolder = (db: number, path: string): void => {
    const next = openFolders[db]?.[path] !== true
    setOpenFolders(current => {
      const forDb = current[db] ?? {}
      return { ...current, [db]: { ...forDb, [path]: next } }
    })
    if (next && levels[levelKey(db, path)] === undefined) void loadLevel(db, path)
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
      // ONE refresh covering every loaded level PLUS the target folder. Passing
      // the target matters when the key went into a folder that was not loaded
      // yet: it is absent from `levels`, so refreshAll alone would leave the new
      // key invisible. A separate loadLevel call after this one (as it used to
      // be) re-fetched that same level twice.
      await refreshAll([{ db: createFor.db, prefix: createFor.folderPath ?? '' }])
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
      // The levels this delete changes, so the refresh covers them even if they
      // were never loaded (a collapsed folder's rows are not in `levels`).
      let affected: Array<{ db: number; prefix: string }> = []
      if (deleteFor.target.kind === 'key') {
        const { db, key } = deleteFor.target
        const removed = await api.redisDeleteKey(source.id, { key, db })
        setNotice(removed ? t('redisdelete.done', { n: 1 }) : t('redis.noKeys'))
        if (activeKey?.db === db && activeKey.key === key) {
          setActiveKey(undefined)
          setValue(undefined)
        }
        // The key's own level is the one whose row disappeared.
        affected = [{ db, prefix: key.includes(':') ? key.slice(0, key.lastIndexOf(':')) : '' }]
      } else {
        const { db, path } = deleteFor.target
        const result = await api.redisDeletePrefix(source.id, { prefix: path, db })
        setNotice(result.truncated
          ? `${t('redisdelete.done', { n: result.deleted })} · ${t('redisdelete.truncated')}`
          : t('redisdelete.done', { n: result.deleted }))
        // The open key may have just been deleted; drop it rather than leaving
        // a stale value on screen.
        if (activeKey?.db === db && (activeKey.key === path || activeKey.key.startsWith(`${path}:`))) {
          setActiveKey(undefined)
          setValue(undefined)
        }
        // Two levels changed: the folder's parent (the folder row is gone) and
        // the folder itself (which may still be expanded in the UI).
        const parent = path.includes(':') ? path.slice(0, path.lastIndexOf(':')) : ''
        affected = [{ db, prefix: parent }, { db, prefix: path }]
      }
      setError(undefined)
      setDeleteFor(undefined)
      // Which view needs updating depends on what is on screen. In search mode
      // the tree's levels are not what the user is looking at, so reloading them
      // would leave the just-deleted key still listed. Re-running the same search
      // is what keeps the visible rows true.
      if (search !== undefined) await runSearch(searchDb, search.pattern)
      else await refreshAll(affected)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Run a search against ONE database.
   *
   * The pattern is evaluated by the server (`SCAN MATCH`), so a Redis glob works
   * and keys inside unexpanded folders are found. Scoped to `db` because a
   * pattern applied across all 16 logical databases would sweep the whole
   * instance — far too slow to be useful.
   *
   * @param db - the database to search.
   * @param pattern - the Redis glob to match.
   */
  const runSearch = React.useCallback(async (db: number, pattern: string): Promise<void> => {
    const trimmed = pattern.trim()
    if (trimmed === '') return
    setSearch({ pattern: trimmed, loading: true })
    setSearchDb(db)
    try {
      const page = await api.redisSearch(source.id, { db, pattern: trimmed })
      setSearch({
        pattern: trimmed,
        loading: false,
        keys: page.keys,
        truncated: page.truncated,
        scanned: page.scanned,
      })
      setError(undefined)
    } catch (failure) {
      setSearch({
        pattern: trimmed,
        loading: false,
        error: failure instanceof Error ? failure.message : String(failure),
      })
    }
  }, [api, source.id])

  /** Leave search mode and go back to the tree. */
  const clearSearch = (): void => {
    setSearch(undefined)
    setPattern('')
  }

  // ---- left: the tree ----------------------------------------------------
  const searching = search !== undefined
  const left = React.createElement(
    'div',
    { className: 'dbm-side' },
    React.createElement(
      'div',
      { className: 'dbm-side-head' },
      React.createElement('input', {
        className: 'dbm-input',
        style: { flex: 1 },
        value: pattern,
        placeholder: t('redisdb.filter'),
        title: t('redisdb.search.hint'),
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => {
          const next = event.target.value
          setPattern(next)
          // Emptying the box returns to the tree. Leaving a stale result set on
          // screen with an empty box gave no way back to the normal view except
          // a separate control, and the box being empty reads as "no search".
          if (next.trim() === '') setSearch(undefined)
        },
        // Enter runs the search. Typing alone does not: a search scans the whole
        // database on the server, so one request per keystroke would be abusive.
        onKeyDown: (event: { key: string }) => {
          if (event.key === 'Enter') void runSearch(searchDb, pattern)
          // Esc clears, matching the usual convention for a search field.
          if (event.key === 'Escape') {
            setPattern('')
            setSearch(undefined)
          }
        },
      }),
      // Which database to search. A compact select rather than a separate
      // control per db row: the scope must be visible BEFORE running the search,
      // and the tree's db rows are replaced by results while searching.
      React.createElement(
        'select',
        {
          className: 'dbm-select',
          value: String(searchDb),
          title: t('redisdb.search.scope.db', { n: searchDb }),
          'aria-label': t('redisdb.search.scope.db', { n: searchDb }),
          onChange: (event: { target: { value: string } }) => setSearchDb(Number(event.target.value)),
        },
        databases.map(node =>
          React.createElement('option', { key: node.db, value: String(node.db) }, `db${node.db}`),
        ),
      ),
      React.createElement('button', {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        title: t('redisdb.search.run'),
        'aria-label': t('redisdb.search.run'),
        disabled: pattern.trim() === '' || search?.loading === true,
        onClick: () => { void runSearch(searchDb, pattern) },
      }, '🔍'),
      searching
        ? React.createElement('button', {
            type: 'button',
            className: 'dbm-btn dbm-btn-sm',
            title: t('redisdb.search.clear'),
            'aria-label': t('redisdb.search.clear'),
            onClick: clearSearch,
          }, '✕')
        : React.createElement('button', {
            type: 'button',
            className: `dbm-btn dbm-btn-sm${refreshing ? ' dbm-btn-busy' : ''}`,
            title: t('redisdb.refresh'),
            'aria-label': t('redisdb.refresh'),
            // A second press while a refresh is running would stack another round
            // of scans on the same levels.
            disabled: refreshing,
            'aria-busy': refreshing ? 'true' : undefined,
            onClick: () => { void refreshAll() },
          }, refreshing ? React.createElement('span', { className: 'dbm-spinner' }) : '⟳'),
    ),
    React.createElement(
      'div',
      { className: 'dbm-side-body' },
      React.createElement(RedisKeyTree, {
        databases,
        levels,
        openDbs,
        openFolders,
        search,
        searchDb,
        selection,
        activeKey,
        onToggleDb: toggleDb,
        onToggleFolder: toggleFolder,
        onSelectKey: selectKey,
        onSelectFolder: (db, path, name) => setSelection({ kind: 'folder', db, path, name }),
        // Opening a dialog clears the previous outcome. Without this, the
        // notice from an EARLIER create ("已创建 1 个键") stayed on screen while
        // this one failed — success and failure shown at once, which reads as
        // "the create silently did nothing".
        onCreate: (db, folderPath) => {
          setNotice(undefined)
          setError(undefined)
          setCreateFor({ db, folderPath })
        },
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
    const activeDb = activeKey?.db ?? initialDb
    body.push(
      value === undefined
        ? React.createElement(Empty, { key: 'empty', message: valueLoading ? t('common.loading') : t('redis.selectKey') })
        : React.createElement(RedisValueEditor, {
            key: `value-${activeDb}-${value.key}`,
            api,
            source,
            db: activeDb,
            value,
            onReload: () => { void loadValue(activeDb, value.key) },
            onDone: (message) => { setNotice(message); setError(undefined) },
            onError: (message) => { setError(message); setNotice(undefined) },
            onRemoved: () => {
              // Removing a collection's last element deletes the key; the tree
              // must drop it rather than keep offering a key that is gone.
              setActiveKey(undefined)
              setValue(undefined)
              setNotice(t('redisedit.deleted'))
              void loadLevel(activeDb, value.key.includes(':') ? value.key.slice(0, value.key.lastIndexOf(':')) : '')
            },
          }),
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
        // The console's own target database — see `consoleDb`. Kept independent
        // of the tree selection so that inspecting a key elsewhere cannot
        // silently redirect a write.
        db: consoleDb,
        databases,
        onSelectDb: setConsoleDb,
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

  return React.createElement(
    'div',
    { className: 'dbm-root' },
    React.createElement(
      'div',
      { className: 'dbm-header' },
      React.createElement(BackButton, { onBack, label: t('panel.backToList') }),
      React.createElement('span', { className: 'dbm-title' }, source.name),
      React.createElement('span', { className: 'dbm-badge dbm-badge-redis' }, 'redis'),
      // The connection's address only. A db number used to sit here and it
      // misled: it was rendered from the last KEY or FOLDER clicked, so browsing
      // db0 read "/db2" as soon as a key in db2 had been opened, and expanding a
      // database did not update it at all. The panel shows every expanded
      // database at once, so no single number can honestly describe it. Where a
      // database DOES matter it is now named at the point of use — the console
      // states the db its command will run against.
      React.createElement('span', { className: 'dbm-subtitle dbm-mono' }, `${source.host ?? ''}:${source.port ?? ''}`),
      React.createElement('span', { className: 'dbm-spacer' }),
      React.createElement(BackButton, { onBack: onClose }),
    ),
    error === undefined ? null : React.createElement(ErrorBanner, { message: error }),
    notice === undefined ? null : React.createElement('div', { className: 'dbm-ok', style: { padding: '6px 14px' } }, notice),
    /**
     * Progress for a keyspace walk, per database.
     *
     * Shown because a big database takes about a minute to index, and the walk keeps
     * loading the server for that whole time. A real percentage is what makes the
     * wait understandable; without it the panel would look frozen while it worked.
     */
    ...Object.entries(indexProgress)
      .filter(([, status]) => status !== undefined && !status.done)
      .map(([db, status]) => React.createElement(IndexProgressBanner, {
        key: `idx-${db}`,
        db: Number(db),
        status: status!,
      })),
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

/**
 * A one-line progress bar for a running keyspace walk.
 *
 * The percentage is `visited / dbSize` — a real measure of work done, not a spinner
 * of unknown length. It also names the database, because several may be walked.
 *
 * It carries only `.dbm-index-progress`: that class owns the padding, the colour
 * and the column layout. It used to also carry `.dbm-ok` for the green text, which
 * brought `display: block` with it and — at equal specificity, later in the sheet —
 * flattened the layout, leaving the bar to overflow its box and sit on the tree.
 */
function IndexProgressBanner(props: { db: number; status: RedisIndexStatus }): React.ReactElement {
  const { db, status } = props
  const pct = status.dbSize === 0 ? 0 : Math.min(100, Math.round((status.visited / status.dbSize) * 100))
  return React.createElement(
    'div',
    { className: 'dbm-index-progress' },
    React.createElement('span', null, t('redis.index.building', {
      // The template names the database as {n}, so the value must be supplied
      // under that name. Passing `db` left {n} untouched — the interpolator
      // keeps unknown placeholders verbatim — and the banner read
      // "正在为 db{n} 建立索引".
      n: db,
      visited: status.visited.toLocaleString(),
      total: status.dbSize.toLocaleString(),
      folders: status.folders.toLocaleString(),
    })),
    React.createElement(
      'span',
      { className: 'dbm-index-bar', 'aria-hidden': 'true' },
      React.createElement('span', { className: 'dbm-index-fill', style: { width: `${pct}%` } }),
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
  /** Every database to offer as a target. */
  databases: RedisDbNode[]
  /** Change which database commands run against. */
  onSelectDb(db: number): void
  onResult(message: string): void
  onError(message: string): void
  onMutated(key?: string): void
}): React.ReactElement {
  const { api, source, db, databases, onSelectDb, onResult, onError, onMutated } = props
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
        // Which database the command runs against, stated AND settable. The
        // console can write, so an unstated or inherited target is a hazard: this
        // used to read from the last key clicked, so typing a write while looking
        // at db0 could have landed it in db2.
        React.createElement(
          'label',
          { className: 'dbm-check' },
          t('redis.consoleDb'),
          React.createElement(
            'select',
            {
              className: 'dbm-select',
              value: String(db),
              title: t('redisdb.search.scope.db', { n: db }),
              'aria-label': t('redis.consoleDb'),
              onChange: (event: { target: { value: string } }) => onSelectDb(Number(event.target.value)),
            },
            databases.map(node =>
              React.createElement('option', { key: node.db, value: String(node.db) }, `db${node.db}`),
            ),
          ),
        ),
        React.createElement('span', { className: 'dbm-hint' }, allowWrite ? t('redis.allowWrite.hint') : t('redis.readonlyNotice')),
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
export type { RedisDbNode, RedisLevel, RedisSelection }
