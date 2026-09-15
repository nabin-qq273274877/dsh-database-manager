import * as React from 'react'
/**
 * The data-source list: the panel's landing view.
 *
 * Toolbar left = search + grouping, toolbar right = 新增数据库. Below is the
 * table with the columns the request named: 数据库类型 / 名称 / 主机 / 用户 /
 * 认证 / 标签 / 操作, where 操作 carries 测试 / 连接 / 编辑 / 删除.
 */

import type { DataSourceSummary, DbKind, EngineAvailability, GateSettingsView, TestResult } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { SourceFormDialog } from './SourceFormDialog.ts'
import { ErrorBanner, Empty, Modal, t } from './ui.ts'

/** Grouping modes offered by the toolbar select. */
type GroupMode = 'none' | 'kind' | 'group' | 'tag'

/** Props for {@link SourceListView}. */
export interface SourceListViewProps {
  api: DbApi
  sources: DataSourceSummary[]
  settings: GateSettingsView
  engines: EngineAvailability[]
  /** Re-read the source list from the host. */
  reload(): Promise<void>
  /** Persist a write-posture patch. */
  saveGate(patch: Partial<GateSettingsView>): Promise<void>
  /** Open one data source's database panel. */
  onConnect(source: DataSourceSummary): void
}

/** The host/credential cells shown for one source. */
function hostOf(source: DataSourceSummary): string {
  if (source.kind === 'sqlite') return source.file ?? t('common.none')
  const port = source.port === undefined ? '' : `:${source.port}`
  return `${source.host ?? t('common.none')}${port}`
}

/** The 认证 cell for one source. */
function authOf(source: DataSourceSummary): string {
  if (source.auth === 'file') return t('auth.file')
  if (source.auth === 'password') return t('auth.password')
  return t('auth.none')
}

/** Group a list by the active mode, preserving a stable order. */
function groupSources(sources: DataSourceSummary[], mode: GroupMode): Array<{ label: string; items: DataSourceSummary[] }> {
  if (mode === 'none') return [{ label: '', items: sources }]
  const groups = new Map<string, DataSourceSummary[]>()
  const push = (label: string, source: DataSourceSummary): void => {
    const bucket = groups.get(label)
    if (bucket === undefined) groups.set(label, [source])
    else bucket.push(source)
  }
  for (const source of sources) {
    if (mode === 'kind') push(source.kind, source)
    else if (mode === 'group') push(source.group === '' ? t('common.none') : source.group, source)
    else if (source.tags.length === 0) push(t('common.none'), source)
    else for (const tag of source.tags) push(tag, source)
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, items]) => ({ label, items }))
}

/** Whether a source matches the search term. */
function matches(source: DataSourceSummary, term: string): boolean {
  if (term === '') return true
  const needle = term.toLowerCase()
  return [
    source.id,
    source.name,
    source.group,
    source.kind,
    source.host ?? '',
    source.file ?? '',
    source.user ?? '',
    source.tags.join(' '),
    source.description,
  ].some(field => field.toLowerCase().includes(needle))
}

/** One 测试 outcome, keyed by source id. */
type TestState = { status: 'running' } | { status: 'done'; result: TestResult }

/** The data-source list view. */
export function SourceListView(props: SourceListViewProps): React.ReactElement {
  const { api, sources, settings, engines, reload, saveGate, onConnect } = props
  const [term, setTerm] = React.useState('')
  const [groupMode, setGroupMode] = React.useState<GroupMode>('none')
  const [tests, setTests] = React.useState<Record<string, TestState>>({})
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [editing, setEditing] = React.useState<DataSourceSummary | undefined>(undefined)
  const [creating, setCreating] = React.useState(false)
  const [deleting, setDeleting] = React.useState<DataSourceSummary | undefined>(undefined)

  const filtered = sources.filter(source => matches(source, term.trim()))
  const grouped = groupSources(filtered, groupMode)

  /** Run a connectivity test and keep its outcome next to the row. */
  const runTest = async (source: DataSourceSummary): Promise<void> => {
    setTests(current => ({ ...current, [source.id]: { status: 'running' } }))
    try {
      const result = await api.test(source.id)
      setTests(current => ({ ...current, [source.id]: { status: 'done', result } }))
    } catch (failure) {
      setTests(current => ({ ...current, [source.id]: { status: 'done', result: { ok: false, error: failure instanceof Error ? failure.message : String(failure) } } }))
    }
  }

  const remove = async (source: DataSourceSummary): Promise<void> => {
    try {
      await api.deleteSource(source.id)
      setDeleting(undefined)
      await reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const unavailable = engines.filter(engine => !engine.available)

  const rows: unknown[] = []
  for (const group of grouped) {
    if (group.label !== '') {
      rows.push(
        React.createElement(
          'tr',
          { key: `group-${group.label}` },
          React.createElement(
            'td',
            { colSpan: 7, className: 'dbm-hint', style: { background: 'var(--dsw-alias-interactive-bg-hover)', fontWeight: 500 } },
            `${group.label} (${group.items.length})`,
          ),
        ),
      )
    }
    for (const source of group.items) {
      const test = tests[source.id]
      rows.push(
        React.createElement(
          'tr',
          { key: source.id },
          React.createElement('td', null, React.createElement('span', { className: `dbm-badge dbm-badge-${source.kind}` }, source.kind)),
          React.createElement(
            'td',
            null,
            React.createElement('div', { style: { fontWeight: 500 } }, source.name),
            source.description === '' ? null : React.createElement('div', { className: 'dbm-hint' }, source.description),
            React.createElement('div', { className: 'dbm-hint dbm-mono' }, source.id),
          ),
          React.createElement('td', { className: 'dbm-mono' }, hostOf(source)),
          React.createElement('td', null, source.kind === 'mysql' ? (source.user ?? t('common.none')) : t('common.none')),
          React.createElement(
            'td',
            null,
            authOf(source),
            source.readonly ? React.createElement('span', { className: 'dbm-badge', style: { marginLeft: 6 } }, t('form.readonly')) : null,
          ),
          React.createElement(
            'td',
            null,
            source.tags.length === 0
              ? t('common.none')
              : React.createElement(
                  'span',
                  { className: 'dbm-tags' },
                  source.tags.map(tag => React.createElement('span', { key: tag, className: 'dbm-badge' }, tag)),
                ),
          ),
          React.createElement(
            'td',
            null,
            React.createElement(
              'div',
              { className: 'dbm-actions' },
              React.createElement(
                'button',
                { type: 'button', className: 'dbm-btn dbm-btn-sm', disabled: test?.status === 'running', onClick: () => { void runTest(source) } },
                test?.status === 'running' ? t('action.testing') : t('action.test'),
              ),
              React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm dbm-btn-primary', onClick: () => onConnect(source) }, t('action.connect')),
              React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', onClick: () => setEditing(source) }, t('action.edit')),
              React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm dbm-btn-danger', onClick: () => setDeleting(source) }, t('action.delete')),
            ),
            test === undefined ? null : TestOutcome(test),
          ),
        ),
      )
    }
  }

  const children: unknown[] = [
    React.createElement(
      'div',
      { className: 'dbm-toolbar', key: 'toolbar' },
      React.createElement('input', {
        className: 'dbm-input',
        value: term,
        placeholder: t('list.search'),
        onChange: (event: { target: { value: string } }) => setTerm(event.target.value),
      }),
      React.createElement(
        'select',
        {
          className: 'dbm-select',
          value: groupMode,
          title: t('list.groupBy'),
          onChange: (event: { target: { value: string } }) => setGroupMode(event.target.value as GroupMode),
        },
        React.createElement('option', { value: 'none' }, `${t('list.groupBy')}: ${t('list.group.none')}`),
        React.createElement('option', { value: 'kind' }, `${t('list.groupBy')}: ${t('list.group.kind')}`),
        React.createElement('option', { value: 'group' }, `${t('list.groupBy')}: ${t('list.group.group')}`),
        React.createElement('option', { value: 'tag' }, `${t('list.groupBy')}: ${t('list.group.tag')}`),
      ),
      React.createElement('span', { className: 'dbm-hint' }, t('list.count', { n: filtered.length })),
      React.createElement('span', { className: 'dbm-spacer' }),
      React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-primary', onClick: () => setCreating(true) }, `+ ${t('list.new')}`),
    ),
  ]

  if (error !== undefined) {
    children.push(React.createElement(ErrorBanner, { key: 'error', message: error }))
  }

  // A missing driver is a configuration fact the user must see, not a hidden log.
  if (unavailable.length > 0) {
    children.push(
      React.createElement(
        'div',
        { className: 'dbm-error', key: 'engines' },
        unavailable.map(engine => t('panel.engine.missing', { kind: engine.kind, detail: engine.detail ?? '' })).join('\n'),
      ),
    )
  }

  children.push(
    React.createElement(
      'div',
      { className: 'dbm-scroll', key: 'scroll' },
      sources.length === 0
        ? React.createElement(Empty, { message: t('list.empty') })
        : filtered.length === 0
          ? React.createElement(Empty, { message: t('list.emptyFiltered') })
          : React.createElement(
              'table',
              { className: 'dbm-table' },
              React.createElement(
                'thead',
                null,
                React.createElement(
                  'tr',
                  null,
                  ...[t('col.kind'), t('col.name'), t('col.host'), t('col.user'), t('col.auth'), t('col.tags'), t('col.actions')].map(label =>
                    React.createElement('th', { key: label }, label),
                  ),
                ),
              ),
              React.createElement('tbody', null, rows as never),
            ),
    ),
  )

  children.push(GateStrip({ settings, saveGate }))

  if (creating || editing !== undefined) {
    children.push(
      React.createElement(SourceFormDialog, {
        key: 'form',
        ...(editing === undefined ? {} : { source: editing }),
        onSubmit: async (payload: Record<string, unknown>) => {
          if (editing === undefined) await api.createSource(payload as never)
          else await api.updateSource(editing.id, payload as never)
          setCreating(false)
          setEditing(undefined)
          await reload()
        },
        onClose: () => { setCreating(false); setEditing(undefined) },
      }),
    )
  }

  if (deleting !== undefined) {
    children.push(
      React.createElement(Modal, {
        key: 'delete',
        title: t('delete.title'),
        onClose: () => setDeleting(undefined),
        footer: [
          React.createElement('button', { key: 'cancel', type: 'button', className: 'dbm-btn', onClick: () => setDeleting(undefined) }, t('common.cancel')),
          React.createElement('button', { key: 'ok', type: 'button', className: 'dbm-btn dbm-btn-danger', onClick: () => { void remove(deleting) } }, t('delete.confirm')),
        ],
        children: React.createElement('div', null, t('delete.body', { name: deleting.name })),
      }),
    )
  }

  return React.createElement('div', { className: 'dbm-root' },
    React.createElement(
      'div',
      { className: 'dbm-header' },
      React.createElement('span', { className: 'dbm-title' }, t('panel.title')),
      React.createElement('span', { className: 'dbm-subtitle' }, t('panel.subtitle')),
      React.createElement('span', { className: 'dbm-spacer' }),
      React.createElement(
        'span',
        { className: 'dbm-hint' },
        `${t('panel.engines')}: ${engines.map(engine => `${engine.kind}${engine.available ? '' : ' ✗'}`).join(' · ')}`,
      ),
    ),
    ...children as never[],
  )
}

/** The one-line result of a 测试 click. */
function TestOutcome(state: TestState): React.ReactElement {
  if (state.status === 'running') {
    return React.createElement('div', { className: 'dbm-hint' }, t('common.loading'))
  }
  const { result } = state
  if (result.ok) {
    return React.createElement(
      'div',
      { className: 'dbm-ok' },
      t('test.ok', { ms: result.latencyMs ?? 0, version: result.serverVersion ?? '' }).trim(),
    )
  }
  return React.createElement('div', { className: 'dbm-error' }, t('test.fail', { error: result.error ?? '' }))
}

/** The agent write-posture strip. */
function GateStrip(props: { settings: GateSettingsView; saveGate(patch: Partial<GateSettingsView>): Promise<void> }): React.ReactElement {
  const [busy, setBusy] = React.useState(false)
  const [savedAt, setSavedAt] = React.useState<number | undefined>(undefined)
  const { settings, saveGate } = props

  const toggle = async (patch: Partial<GateSettingsView>): Promise<void> => {
    setBusy(true)
    try {
      await saveGate(patch)
      setSavedAt(Date.now())
    } finally {
      setBusy(false)
    }
  }

  return React.createElement(
    'div',
    { className: 'dbm-toolbar', style: { borderTop: '1px solid var(--dsw-alias-border-l3)', borderBottom: 'none' } },
    React.createElement(
      'label',
      { className: 'dbm-check' },
      React.createElement('input', {
        type: 'checkbox',
        checked: settings.allowAgentWrite,
        disabled: busy,
        onChange: (event: { target: { checked: boolean } }) => { void toggle({ allowAgentWrite: event.target.checked }) },
      }),
      t('gate.allowWrite'),
    ),
    React.createElement(
      'label',
      { className: 'dbm-check', style: settings.allowAgentWrite ? undefined : { opacity: .45 } },
      React.createElement('input', {
        type: 'checkbox',
        checked: settings.requireApproval,
        disabled: busy || !settings.allowAgentWrite,
        onChange: (event: { target: { checked: boolean } }) => { void toggle({ requireApproval: event.target.checked }) },
      }),
      t('gate.requireApproval'),
    ),
    React.createElement('span', { className: 'dbm-spacer' }),
    React.createElement('span', { className: 'dbm-hint' }, savedAt === undefined ? t('gate.hint') : t('gate.saved')),
  )
}
