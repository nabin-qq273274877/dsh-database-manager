import * as React from 'react'
/**
 * Redis panel, styled after RedisDesktopManager: a left key list driven by
 * SCAN (with pattern filter and a logical-database switcher) and a right area
 * showing the selected key's value, shape-routed by its Redis type, plus a
 * console for arbitrary commands.
 */

import type { DataSourceSummary, RedisInfo, RedisKeyInfo, RedisValue } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { keyFromCommand, splitCommand } from './command.ts'
import { BackButton, ErrorBanner, Empty, TabStrip, formatBytes, formatTtl, formatUptime, isNull, renderCell, t } from './ui.ts'

/** The right-hand tabs of a Redis panel. */
type RedisTab = 'value' | 'info' | 'console'

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
  const [db, setDb] = React.useState(source.db ?? 0)
  const [pattern, setPattern] = React.useState('*')
  const [appliedPattern, setAppliedPattern] = React.useState('*')
  const [keys, setKeys] = React.useState<RedisKeyInfo[]>([])
  const [cursor, setCursor] = React.useState('0')
  const [loading, setLoading] = React.useState(false)
  const [scanned, setScanned] = React.useState(0)
  const [activeKey, setActiveKey] = React.useState<string | undefined>(undefined)
  const [value, setValue] = React.useState<RedisValue | undefined>(undefined)
  const [valueLoading, setValueLoading] = React.useState(false)
  const [tab, setTab] = React.useState<RedisTab>('value')
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [notice, setNotice] = React.useState<string | undefined>(undefined)

  /** Load one SCAN page; `reset` restarts the scan from cursor 0. */
  const scan = React.useCallback(async (options: { pattern: string; cursor: string; reset: boolean }): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const page = await api.redisKeys(source.id, {
        pattern: options.pattern,
        cursor: options.reset ? '0' : options.cursor,
        count: 200,
        db,
      })
      setKeys(current => (options.reset ? page.keys : [...current, ...page.keys]))
      setCursor(page.cursor)
      setScanned(current => (options.reset ? page.keys.length : current + page.keys.length))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }, [api, source.id, db])

  // A db switch restarts the scan: keys are not comparable across databases.
  React.useEffect(() => {
    setActiveKey(undefined)
    setValue(undefined)
    setScanned(0)
    void scan({ pattern: appliedPattern, cursor: '0', reset: true })
  }, [db, appliedPattern, scan])

  React.useEffect(() => { void scan({ pattern: '*', cursor: '0', reset: true }) }, [scan])

  /** Load one key's value. */
  const loadValue = React.useCallback(async (key: string): Promise<void> => {
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
  }, [api, source.id, db])

  const refreshInfo = async (): Promise<void> => {
    try {
      setInfo(await api.redisInfo(source.id))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  // ---- left: key list ----------------------------------------------------
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
        placeholder: t('redis.pattern'),
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => setPattern(event.target.value),
        onKeyDown: (event: { key: string }) => {
          if (event.key === 'Enter') {
            setScanned(0)
            setAppliedPattern(pattern === '' ? '*' : pattern)
          }
        },
      }),
      React.createElement(
        'select',
        {
          className: 'dbm-select',
          value: String(db),
          title: t('redis.db'),
          onChange: (event: { target: { value: string } }) => setDb(Number(event.target.value)),
        },
        Array.from({ length: 16 }, (_, index) => index).map(index =>
          React.createElement('option', { key: index, value: String(index) }, `db${index}`),
        ),
      ),
    ),
    React.createElement(
      'div',
      { className: 'dbm-side-body' },
      keys.length === 0
        ? React.createElement('div', { className: 'dbm-hint', style: { padding: '10px 12px' } }, loading ? t('common.loading') : t('redis.noKeys'))
        : keys.map(item =>
            React.createElement(
              'button',
              {
                key: item.key,
                type: 'button',
                className: 'dbm-tree-item',
                'data-active': String(activeKey === item.key),
                title: item.key,
                onClick: () => { setActiveKey(item.key); setTab('value'); void loadValue(item.key) },
              },
              React.createElement('span', { className: 'dbm-tree-caret' }, typeGlyph(item.type)),
              React.createElement('span', { className: 'dbm-tree-name dbm-mono' }, item.key),
              React.createElement('span', { className: 'dbm-tree-meta' }, item.ttl === -1 ? '' : formatTtl(item.ttl)),
            ),
          ),
    ),
    React.createElement(
      'div',
      { className: 'dbm-pager' },
      React.createElement('span', null, t('redis.scanned', { n: scanned })),
      React.createElement('span', { className: 'dbm-spacer' }),
      cursor === '0'
        ? React.createElement('span', { className: 'dbm-hint' }, t('redis.noMore'))
        : React.createElement(
            'button',
            {
              type: 'button',
              className: 'dbm-btn dbm-btn-sm',
              disabled: loading,
              onClick: () => { void scan({ pattern: appliedPattern, cursor, reset: false }) },
            },
            t('redis.loadMore'),
          ),
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
    body.push(React.createElement(InfoView, { key: 'info', info, onRefresh: () => { void refreshInfo() } }))
  }

  if (tab === 'console') {
    body.push(
      React.createElement(ConsoleView, {
        key: 'console',
        api,
        source,
        db,
        onResult: (message) => { setNotice(message); setError(undefined) },
        onError: (message) => { setError(message); setNotice(undefined) },
        onMutated: (key) => {
          // A write can create, change or remove the key being shown; re-read
          // both the selection and the scan page so the tree stays truthful.
          void refreshInfo()
          if (key !== undefined && key === activeKey) void loadValue(key)
          void scan({ pattern: appliedPattern, cursor: '0', reset: true })
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
      React.createElement('span', { className: 'dbm-subtitle dbm-mono' }, `${source.host ?? ''}:${source.port ?? ''}/db${db}`),
      React.createElement('span', { className: 'dbm-spacer' }),
      React.createElement(BackButton, { onBack: onClose }),
    ),
    error === undefined ? null : React.createElement(ErrorBanner, { message: error }),
    notice === undefined ? null : React.createElement('div', { className: 'dbm-ok', style: { padding: '6px 14px' } }, notice),
    React.createElement('div', { className: 'dbm-split' }, left as never, React.createElement('div', { className: 'dbm-main' }, body as never)),
  )
}

/** A one-character glyph hinting a Redis type. */
function typeGlyph(type: string): string {
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

