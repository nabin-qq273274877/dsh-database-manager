import * as React from 'react'
/**
 * The Redis key tree: RedisDesktopManager's shape, where every logical database
 * is a root node and each database's keys are grouped into folders by their
 * `:`-separated name segments.
 *
 * Folders are loaded ONE LEVEL AT A TIME from the host. That is the difference
 * that makes a production-sized database usable: an earlier version scanned the
 * whole keyspace up front and grouped it here, which capped a 480k-key database
 * at 20k keys and paid a TYPE/TTL round trip per key before anything rendered.
 * Now, expanding a folder costs one bounded scan of that folder, and a folder
 * nobody opens is never read.
 *
 * The database level lives in this component rather than in a separate picker
 * because that is what the reference UI does, and because it is the only layout
 * in which a key's full identity — database AND name — is visible at once. The
 * selection therefore carries its database, so an action can never be applied to
 * the wrong one.
 */

import type { RedisKeyInfo, RedisCreatableType } from '../protocol.ts'
import { REDIS_CREATABLE_TYPES } from '../protocol.ts'
import { buildRedisTree, contentPlaceholder, countFolderKeys, createPrefix, parseElements, parseKeyNames, usesElementLines, type RedisFolderNode } from './redis-tree.ts'
import { Modal, t } from './ui.ts'

/** One database root node. */
export interface RedisDbNode {
  db: number
  /** Keys this database holds (from INFO keyspace; 0 when it holds none). */
  keys: number
}

/** One folder row, as the host reported it for its level. */
export interface RedisFolderRow {
  name: string
  path: string
  /** Keys under it, INCLUDING a key that shares its name — i.e. what deleting it removes. */
  keys: number
}

/** One loaded level (or the absence of it before it is loaded). */
export interface RedisLevel {
  folders: RedisFolderRow[]
  keys: RedisKeyInfo[]
  /** True when the row list was cut short. */
  truncated: boolean
  /** How many keys live at this level, whether or not all were returned. */
  keysAtLevel: number
  /**
   * True while a fetch for this level is in flight.
   *
   * Reached in two situations, which the tree renders differently on purpose:
   *
   * - FIRST load (no rows yet): a placeholder block, because there is nothing to
   *   show and the level's contents are unknown.
   * - REFRESH (rows already present, e.g. straight after a create or a delete):
   *   the existing rows stay, dimmed, with a spinner on the branch. Blanking
   *   them would make the tree jump and lose the user's place, but showing them
   *   unmarked is what made a create/delete look like nothing had happened until
   *   the new data arrived.
   */
  loading?: boolean
  /** Set when the fetch failed. */
  error?: string
}

/**
 * A search in progress, or its outcome, for one database.
 *
 * Searching is a SERVER operation (`SCAN MATCH`), not a filter over loaded rows:
 * that is what makes a Redis glob work and what lets a match be found inside a
 * folder nobody expanded. It is therefore asynchronous with its own state,
 * unlike the instant local filter it replaces.
 */
export interface RedisSearchState {
  /** The pattern the results belong to. */
  pattern: string
  /** True while the scan is running. */
  loading: boolean
  /** Matching keys, once loaded. */
  keys?: RedisKeyInfo[]
  /** True when the result list hit the cap. */
  truncated?: boolean
  /** How many keys the scan visited. */
  scanned?: number
  /** Set when the search failed. */
  error?: string
}

/**
 * Which tree node is selected.
 *
 * Every variant carries its `db`: the tree spans databases, so a selection
 * without one would be ambiguous, and reading a key's value from the wrong
 * database is a silent, plausible-looking error.
 */
export type RedisSelection =
  | { kind: 'db'; db: number }
  | { kind: 'folder'; db: number; path: string; name: string }
  | { kind: 'key'; db: number; key: string }
  | undefined

/** One-character glyph per Redis type, matching the value view's vocabulary. */
export function typeGlyph(type: string): string {
  switch (type) {
    case 'string': return 'T'
    case 'list': return 'L'
    case 'set': return 'S'
    case 'zset': return 'Z'
    case 'hash': return 'H'
    case 'stream': return 'X'
    default: return '?'
  }
}

/** A key's last `:`-separated segment, i.e. what the leaf row displays. */
export function leafName(key: string): string {
  const at = key.lastIndexOf(':')
  return at === -1 ? key : key.slice(at + 1)
}

/** Props for {@link RedisKeyTree}. */
export interface RedisKeyTreeProps {
  /** Every database the server exposes, in order. */
  databases: RedisDbNode[]
  /** Levels by `${db}\u0000${prefix}`; absent = not loaded yet. */
  levels: Record<string, RedisLevel | undefined>
  /** Expanded databases. */
  openDbs: Record<number, boolean>
  /** Expanded folder paths, per database. */
  openFolders: Record<number, Record<string, boolean> | undefined>
  /**
   * The active search, or undefined when the tree is showing its normal
   * structure. A search REPLACES the tree view while it is active: its results
   * may live anywhere in the database, so mixing them into a lazily-loaded tree
   * would be misleading about where the keys actually are.
   */
  search: RedisSearchState | undefined
  /** The database a search applies to. */
  searchDb: number
  selection: RedisSelection
  /** The key whose value is on screen, marked active. */
  activeKey: { db: number; key: string } | undefined
  onToggleDb(db: number): void
  onToggleFolder(db: number, path: string): void
  onSelectKey(db: number, key: string): void
  onSelectFolder(db: number, path: string, name: string): void
  /** Create a key in a database, optionally under a folder prefix. */
  onCreate(db: number, folderPath: string | undefined): void
  onDeleteKey(db: number, key: string): void
  onDeleteFolder(db: number, path: string): void
}

/** The key used to look one level up. */
export function levelKey(db: number, prefix: string): string {
  return `${db}\u0000${prefix}`
}

/** The key tree, spanning every database and loading one level at a time. */
export function RedisKeyTree(props: RedisKeyTreeProps): React.ReactElement {
  const { databases, levels, openDbs, openFolders, search, searchDb, selection, activeKey } = props

  /**
   * One key leaf.
   *
   * @param stale - dim the row while its level is being re-fetched.
   */
  const renderKey = (db: number, info: RedisKeyInfo, depth: number, stale = false): unknown =>
    React.createElement(
      'div',
      {
        key: `key-${db}-${info.key}`,
        className: `dbm-tree-node dbm-tree-depth-${Math.min(depth, 8)}${stale ? ' dbm-tree-stale' : ''}`,
        'data-active': String(activeKey?.db === db && activeKey.key === info.key),
        'data-kind': 'key',
        'data-key': info.key,
        title: info.key,
        role: 'treeitem',
        onClick: () => props.onSelectKey(db, info.key),
      },
      React.createElement('span', { className: 'dbm-tree-caret' }, typeGlyph(info.type)),
      React.createElement('span', { className: 'dbm-tree-glyph' }, '🔑'),
      // Only the last segment: the folder rows above already name the prefix, in
      // the tree and in search results alike (both are built from the same
      // grouping), so repeating it in every leaf would make a deep key unreadable.
      React.createElement('span', { className: 'dbm-tree-name dbm-mono' }, leafName(info.key)),
      info.ttl === -1 ? null : React.createElement('span', { className: 'dbm-tree-meta' }, `${info.ttl}s`),
      React.createElement(
        'span',
        { className: 'dbm-tree-actions' },
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dbm-icon-btn dbm-icon-btn-danger',
            title: t('action.delete'),
            'aria-label': t('action.delete'),
            onClick: (event: { stopPropagation(): void }) => {
              event.stopPropagation()
              props.onDeleteKey(db, info.key)
            },
          },
          '🗑',
        ),
      ),
    )

  /**
   * One folder row.
   *
   * Extracted so the search results can render the SAME rows as the tree: both
   * views are the same widget over different data, and duplicating the markup
   * would let them drift apart.
   *
   * @param count - the number to show on the right. For a level from the server
   *   this is its key count; for a search result it is how many MATCHES are
   *   behind the folder, so the two are computed by the caller.
   * @param actions - whether to offer the folder's write controls. FALSE for
   *   search results, and that is a safety decision rather than a simplification:
   *   a search-built folder counts only its matches, while deleting it removes
   *   every key under its prefix. A row reading "order (1)" would destroy three
   *   keys. Grouping is not a place from which to offer a destructive action.
   */
  const renderFolder = (
    db: number,
    name: string,
    path: string,
    count: number,
    depth: number,
    isOpen: boolean,
    stale: boolean,
    actions: boolean,
  ): unknown =>
    React.createElement(
      'div',
      {
        key: `folder-${db}-${path}`,
        className: `dbm-tree-node dbm-tree-depth-${Math.min(depth, 8)}${stale ? ' dbm-tree-stale' : ''}`,
        'data-active': String(selection?.kind === 'folder' && selection.db === db && selection.path === path),
        'data-kind': 'folder',
        'data-path': path,
        title: path,
        role: 'treeitem',
        'aria-expanded': isOpen,
        // Announced while a refresh is in flight, so the state is not conveyed
        // by the dimming alone.
        'aria-busy': stale ? 'true' : undefined,
        // A folder row is both "select it" (so an action can target it) and
        // "open it". The row does both on one click, which is what RDM does.
        onClick: () => {
          props.onSelectFolder(db, path, name)
          props.onToggleFolder(db, path)
        },
      },
      React.createElement('span', { className: 'dbm-tree-caret' }, isOpen ? '▾' : '▸'),
      React.createElement('span', { className: 'dbm-tree-glyph' }, isOpen ? '📂' : '📁'),
      React.createElement('span', { className: 'dbm-tree-name dbm-mono' }, name),
      React.createElement('span', { className: 'dbm-tree-meta' }, String(count)),
      actions
        ? React.createElement(
            'span',
            { className: 'dbm-tree-actions' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dbm-icon-btn',
                title: t('action.newKeyInFolder'),
                'aria-label': t('action.newKeyInFolder'),
                onClick: (event: { stopPropagation(): void }) => {
                  event.stopPropagation()
                  props.onCreate(db, path)
                },
              },
              '＋',
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dbm-icon-btn dbm-icon-btn-danger',
                title: t('action.deleteFolder'),
                'aria-label': t('action.deleteFolder'),
                onClick: (event: { stopPropagation(): void }) => {
                  event.stopPropagation()
                  props.onDeleteFolder(db, path)
                },
              },
              '🗑',
            ),
          )
        : null,
    )

  /** One loaded level's folder rows and key rows, at a given depth. */
  const renderLevel = (db: number, prefix: string, depth: number): unknown[] => {
    const level = levels[levelKey(db, prefix)]
    const rows: unknown[] = []

    if (level === undefined) {
      rows.push(React.createElement('div', {
        key: `loading-${db}-${prefix}`,
        className: `dbm-tree-hint dbm-tree-depth-${Math.min(depth, 8)} dbm-hint dbm-tree-pending`,
      }, t('redisdb.loading')))
      return rows
    }
    /**
     * A refresh is in flight over rows that are already on screen.
     *
     * The rows are kept and dimmed rather than replaced by a placeholder: they
     * are still the best information available, and swapping them out would make
     * the tree collapse and jump under the cursor. They are marked so the user
     * can tell the difference between "this is current" and "this is about to
     * change" — which is exactly what was missing when a create or delete
     * appeared to do nothing for a moment.
     */
    const refreshing = level.loading === true

    if (refreshing && level.folders.length === 0 && level.keys.length === 0) {
      rows.push(React.createElement('div', {
        key: `loading-${db}-${prefix}`,
        className: `dbm-tree-hint dbm-tree-depth-${Math.min(depth, 8)} dbm-hint dbm-tree-pending`,
      }, t('redisdb.loading')))
      return rows
    }
    if (level.error !== undefined) {
      rows.push(React.createElement('div', {
        key: `err-${db}-${prefix}`,
        className: `dbm-tree-hint dbm-tree-depth-${Math.min(depth, 8)} dbm-error`,
      }, level.error))
      return rows
    }

    const folders = level.folders
    const keys = level.keys

    if (folders.length === 0 && keys.length === 0) {
      rows.push(React.createElement('div', {
        key: `empty-${db}-${prefix}`,
        className: `dbm-tree-hint dbm-tree-depth-${Math.min(depth, 8)} dbm-hint`,
      }, t('redisdb.empty')))
      return rows
    }

    for (const folder of folders) {
      const isOpen = openFolders[db]?.[folder.path] === true
      rows.push(renderFolder(db, folder.name, folder.path, folder.keys, depth, isOpen, refreshing, true))
      if (isOpen) rows.push(...renderLevel(db, folder.path, depth + 1))
    }

    for (const info of keys) rows.push(renderKey(db, info, depth, refreshing))

    if (level.truncated) {
      rows.push(React.createElement('div', {
        key: `trunc-${db}-${prefix}`,
        className: `dbm-tree-hint dbm-tree-depth-${Math.min(depth, 8)} dbm-hint`,
      }, t('redisdb.levelTruncated', { shown: level.keys.length, total: level.keysAtLevel })))
    }
    return rows
  }

  /**
   * Search results, rendered as the SAME tree.
   *
   * A search is answered by the server from the whole database, so its matches
   * can sit anywhere — including under folders that are collapsed or were never
   * loaded. Showing them as a separate flat list made a second kind of view to
   * learn and lost the folder structure that makes a keyspace readable; instead
   * the matches are regrouped by prefix with the same builder the tree uses
   * ({@link buildRedisTree}) and drawn with the same rows.
   *
   * Every folder is shown EXPANDED, and folder rows are informational here: the
   * structure exists to organise the matches, and making the user open folders
   * one by one to find the keys a search already located would be backwards.
   */
  if (search !== undefined) {
    const rows: unknown[] = []

    rows.push(React.createElement('div', {
      key: 'search-header',
      className: 'dbm-tree-hint dbm-hint dbm-search-header',
      // The placeholder must match the locale template exactly: it reads
      // 'db{n} … {pattern}', so the number is passed as `n`. Passing `db` (as
      // this did) left the header showing a literal "db{n}" — caught by reading
      // the RENDERED text in the E2E rather than trusting the call site.
    }, t('redisdb.search.header', { n: searchDb, pattern: search.pattern })))

    if (search.loading) {
      rows.push(React.createElement('div', {
        key: 'search-loading',
        className: 'dbm-tree-hint dbm-hint dbm-tree-pending',
      }, t('redisdb.search.running')))
      return React.createElement('div', { role: 'tree' }, rows as never)
    }

    if (search.error !== undefined) {
      rows.push(React.createElement('div', { key: 'search-error', className: 'dbm-tree-hint dbm-error' }, search.error))
      return React.createElement('div', { role: 'tree' }, rows as never)
    }

    const matches = search.keys ?? []
    if (matches.length === 0) {
      rows.push(React.createElement('div', {
        key: 'search-empty',
        className: 'dbm-tree-hint dbm-hint',
      }, t('redisdb.search.none', { scanned: search.scanned ?? 0 })))
      return React.createElement('div', { role: 'tree' }, rows as never)
    }

    rows.push(React.createElement('div', {
      key: 'search-count',
      className: 'dbm-tree-hint dbm-hint',
    }, search.truncated === true
      ? t('redisdb.search.truncated', { shown: matches.length })
      : t('redisdb.search.count', { n: matches.length })))

    /** Draw one built folder node and everything under it, all expanded. */
    const renderSearchFolder = (node: RedisFolderNode, depth: number): unknown[] => {
      const out: unknown[] = [
        // Count comes from the built subtree, not from the server: a search
        // result's folder holds only its MATCHES, so the server's key count for
        // that prefix would be a much larger number than what is on screen.
        renderFolder(searchDb, node.name, node.path, countFolderKeys(node), depth, true, false, false),
      ]
      for (const child of node.folders) out.push(...renderSearchFolder(child, depth + 1))
      for (const info of node.keys) out.push(renderKey(searchDb, info, depth + 1))
      return out
    }

    const built = buildRedisTree(matches, search.truncated === true)
    for (const node of built.folders) rows.push(...renderSearchFolder(node, 0))
    // Matches with no separator sit at the root, alongside the top-level folders.
    for (const info of built.keys) rows.push(renderKey(searchDb, info, 0))

    return React.createElement('div', { role: 'tree' }, rows as never)
  }

  const rows: unknown[] = []
  for (const node of databases) {
    const isOpen = openDbs[node.db] === true
    const selected = selection?.kind === 'db' && selection.db === node.db
    /**
     * Whether this database's ROOT level is being fetched.
     *
     * Checked here as well as inside renderLevel because the spinner belongs on
     * the database row itself: when a create or delete refreshes the tree, the
     * user's eye is on the branch they acted in, and a marker only on the child
     * level would be easy to miss.
     */
    const rootLoading = levels[levelKey(node.db, '')]?.loading === true

    rows.push(
      React.createElement(
        'div',
        {
          key: `db-${node.db}`,
          className: `dbm-tree-node dbm-tree-depth-0${rootLoading ? ' dbm-tree-stale' : ''}`,
          'data-active': String(selected),
          'data-kind': 'db',
          'data-db': String(node.db),
          'aria-busy': rootLoading ? 'true' : undefined,
          title: t('redisdb.dbSummary', { n: node.db, keys: node.keys }),
          role: 'treeitem',
          'aria-expanded': isOpen,
          onClick: () => props.onToggleDb(node.db),
        },
        React.createElement('span', { className: 'dbm-tree-caret' }, isOpen ? '▾' : '▸'),
        React.createElement('span', { className: 'dbm-tree-glyph' }, '🗄'),
        React.createElement('span', { className: 'dbm-tree-name' }, `db${node.db}`),
        rootLoading
          ? React.createElement('span', { className: 'dbm-tree-meta dbm-spinner', 'aria-label': t('redisdb.loading') })
          : React.createElement('span', { className: 'dbm-tree-meta' }, String(node.keys)),
        React.createElement(
          'span',
          { className: 'dbm-tree-actions' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dbm-icon-btn',
              title: t('action.newKey'),
              'aria-label': t('action.newKey'),
              onClick: (event: { stopPropagation(): void }) => {
                event.stopPropagation()
                props.onCreate(node.db, undefined)
              },
            },
            '＋',
          ),
        ),
      ),
    )

    if (isOpen) rows.push(...renderLevel(node.db, '', 1))
  }

  return React.createElement('div', { role: 'tree' }, rows as never)
}

/** Props for {@link NewKeyDialog}. */
export interface NewKeyDialogProps {
  /** The database the key goes into (shown so the target is never in doubt). */
  db: number
  /** The open folder, whose prefix is pre-filled; undefined at the root. */
  folderPath: string | undefined
  busy: boolean
  /** Create the keys; resolves once the request settled. */
  onSubmit(keys: RedisCreatePayload[]): Promise<void>
  onClose(): void
}

/** One key as the dialog hands it to the caller. */
export interface RedisCreatePayload {
  key: string
  type: RedisCreatableType
  ttl?: number
  value?: string
  items?: string[]
  fields?: Array<{ field: string; value: string }>
  members?: Array<{ member: string; score: string }>
}

/** The 新增键 dialog: name(s), type, content, optional TTL. */
export function NewKeyDialog(props: NewKeyDialogProps): React.ReactElement {
  const prefix = createPrefix(props.folderPath)
  const [names, setNames] = React.useState('')
  const [type, setType] = React.useState<RedisCreatableType>('string')
  const [content, setContent] = React.useState('')
  const [ttl, setTtl] = React.useState('')
  const [problem, setProblem] = React.useState<string | undefined>(undefined)

  const submit = async (): Promise<void> => {
    const keys = parseKeyNames(names, prefix)
    if (keys.length === 0) {
      setProblem(t('redisnew.nameRequired'))
      return
    }

    let ttlSeconds: number | undefined
    if (ttl.trim() !== '') {
      const parsed = Number(ttl)
      if (!Number.isFinite(parsed) || parsed < 0) {
        setProblem(t('redisnew.ttl.hint'))
        return
      }
      if (parsed > 0) ttlSeconds = Math.trunc(parsed)
    }

    // Parse the content box once per key: the message must name the offending
    // key, and for several keys the parse can legitimately differ (a blank line
    // is legal for `string`, not for a hash).
    const payload: RedisCreatePayload[] = []
    for (const key of keys) {
      const parsed = parseElements(type, content, key)
      if (!parsed.ok) {
        setProblem(parsed.error)
        return
      }
      payload.push({
        key,
        type,
        ...parsed.content,
        ...(ttlSeconds === undefined ? {} : { ttl: ttlSeconds }),
      })
    }

    setProblem(undefined)
    await props.onSubmit(payload)
  }

  const title = prefix === ''
    ? t('redisnew.title')
    : t('redisnew.titleIn', { path: props.folderPath ?? '' })

  return React.createElement(
    Modal,
    {
      title: `db${props.db} · ${title}`,
      onClose: props.onClose,
      footer: React.createElement(
        React.Fragment,
        null,
        React.createElement('button', { type: 'button', className: 'dbm-btn', onClick: props.onClose }, t('common.cancel')),
        React.createElement(
          'button',
          { type: 'button', className: 'dbm-btn dbm-btn-primary', disabled: props.busy, onClick: () => { void submit() } },
          props.busy ? t('redisnew.busy') : t('redisnew.submit'),
        ),
      ),
    },
    problem === undefined ? null : React.createElement('div', { className: 'dbm-error' }, problem),
    React.createElement(
      'label',
      { className: 'dbm-label' },
      React.createElement('span', null, t('redisnew.name')),
      React.createElement('textarea', {
        className: 'dbm-textarea dbm-mono',
        rows: 2,
        value: names,
        placeholder: t('redisnew.name.placeholder'),
        spellcheck: false,
        autoFocus: true,
        onChange: (event: { target: { value: string } }) => setNames(event.target.value),
      }),
      React.createElement('span', { className: 'dbm-hint' },
        prefix === '' ? t('redisnew.name.hintRoot') : t('redisnew.name.hintFolder', { prefix })),
    ),
    React.createElement(
      'label',
      { className: 'dbm-label' },
      React.createElement('span', null, t('redisnew.type')),
      React.createElement(
        'select',
        {
          className: 'dbm-select',
          value: type,
          onChange: (event: { target: { value: string } }) => setType(event.target.value as RedisCreatableType),
        },
        REDIS_CREATABLE_TYPES.map(candidate =>
          React.createElement('option', { key: candidate, value: candidate }, candidate),
        ),
      ),
    ),
    React.createElement(
      'label',
      { className: 'dbm-label' },
      React.createElement('span', null, t('redisnew.content')),
      React.createElement('textarea', {
        className: 'dbm-textarea dbm-mono',
        rows: usesElementLines(type) ? 5 : 3,
        value: content,
        placeholder: contentPlaceholder(type),
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => setContent(event.target.value),
      }),
    ),
    React.createElement(
      'div',
      { className: 'dbm-field-inline' },
      React.createElement('span', null, t('redisnew.ttl')),
      React.createElement('input', {
        className: 'dbm-input',
        value: ttl,
        placeholder: '0',
        inputMode: 'numeric',
        onChange: (event: { target: { value: string } }) => setTtl(event.target.value),
      }),
      React.createElement('span', { className: 'dbm-hint' }, t('redisnew.ttl.unit')),
      React.createElement('span', { className: 'dbm-hint' }, t('redisnew.ttl.hint')),
    ),
  )
}

/** Props for {@link DeleteDialog}. */
export interface DeleteDialogProps {
  /** What is being deleted; the database is part of the identity. */
  target: { kind: 'key'; db: number; key: string } | { kind: 'folder'; db: number; path: string }
  /** Keys under a folder; undefined while still counting. */
  count: number | undefined
  busy: boolean
  onConfirm(): void
  onClose(): void
}

/**
 * The delete confirmation.
 *
 * A key delete is a plain confirm; a folder delete counts what is about to go
 * first, because "delete folder a" gives no sense of whether that is one key or
 * ten thousand.
 */
export function DeleteDialog(props: DeleteDialogProps): React.ReactElement {
  const { target, count, busy } = props
  const isFolder = target.kind === 'folder'

  let body: string
  if (target.kind === 'key') {
    body = t('redisdelete.keyBody', { key: target.key })
  } else if (count === undefined) {
    body = `${t('redisdelete.folderBodyUnknown', { path: target.path })} ${t('redisdelete.counting')}`
  } else {
    body = t('redisdelete.folderBody', { path: target.path, n: count })
  }

  return React.createElement(
    Modal,
    {
      title: `db${target.db} · ${isFolder ? t('redisdelete.folderTitle') : t('redisdelete.keyTitle')}`,
      onClose: props.onClose,
      footer: React.createElement(
        React.Fragment,
        null,
        React.createElement('button', { type: 'button', className: 'dbm-btn', onClick: props.onClose }, t('common.cancel')),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dbm-btn dbm-btn-danger',
            disabled: busy,
            onClick: props.onConfirm,
          },
          busy ? t('redisdelete.deleting') : t('redisdelete.confirm'),
        ),
      ),
    },
    React.createElement('div', null, body),
    React.createElement('div', { className: 'dbm-hint dbm-mono' },
      target.kind === 'key' ? target.key : target.path),
  )
}
