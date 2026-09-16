import * as React from 'react'
/**
 * The Redis 值 tab: one key's content, rendered by its type, and editable.
 *
 * Editing is where Redis types differ most, so each shape gets the interaction
 * its type actually supports rather than one generic grid:
 *
 * - `string`  one textarea; 保存 replaces the value (TTL preserved server-side)
 * - `list`   每行一个元素，可改内容、可删行、可在末尾追加
 * - `set`    每行一个成员，可删除、可新增一行
 * - `hash`   每个字段一行，字段名与值都可改、可删、可新增
 * - `zset`   每个成员一行，可改分值、可删、可新增
 * - `stream` 只读：条目由 XADD 生成，改一条会破坏它的 ID 语义
 *
 * Every write goes through the panel's own API (the user surface), so the agent
 * write gate is not involved — the same authorization model as the SQL row
 * editor.
 *
 * The edits are staged locally and sent on 保存, so a mis-typed value does not
 * immediately become the server's truth. A deletion is sent as soon as it is
 * confirmed, because there is nothing to stage.
 */

import type { DataSourceSummary, RedisValue } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { Empty, Modal, formatBytes, formatTtl, t } from './ui.ts'

/** Props for {@link RedisValueEditor}. */
export interface RedisValueEditorProps {
  api: DbApi
  source: DataSourceSummary
  db: number
  value: RedisValue
  /** Re-read the key after a successful write. */
  onReload(): void
  /** Report a success line. */
  onDone(message: string): void
  /** Report a failure. */
  onError(message: string): void
  /** The key is gone (last element removed) — the tree must forget it. */
  onRemoved(): void
}

/** The 值 tab. */
export function RedisValueEditor(props: RedisValueEditorProps): React.ReactElement {
  const { value } = props
  const head = React.createElement(
    'div',
    { className: 'dbm-pad' },
    React.createElement('div', { className: 'dbm-row' }, React.createElement('strong', { className: 'dbm-mono' }, value.key)),
    React.createElement(
      'div',
      { className: 'dbm-row' },
      React.createElement('span', {
        className: `dbm-badge dbm-badge-${value.type === 'string' ? 'ok' : 'sqlite'}`,
      }, value.type),
      React.createElement(TtlEditor, {
        key: 'ttl',
        api: props.api,
        source: props.source,
        db: props.db,
        value: props.value,
        onDone: props.onDone,
        onError: props.onError,
        onReload: props.onReload,
      }),
      value.truncated === true ? React.createElement('span', { className: 'dbm-hint' }, t('redis.truncated', { n: 1000 })) : null,
    ),
  )

  const body = (() => {
    switch (value.type) {
      case 'string':
        return React.createElement(StringEditor, { ...props, content: value.value ?? '' })
      case 'list':
        return React.createElement(ListEditor, { ...props, items: value.items ?? [] })
      case 'set':
        return React.createElement(SetEditor, { ...props, items: value.items ?? [] })
      case 'hash':
        return React.createElement(HashEditor, { ...props, fields: value.fields ?? [] })
      case 'zset':
        return React.createElement(ZsetEditor, { ...props, members: value.members ?? [] })
      default:
        // stream and anything else: read-only, with the reason stated rather
        // than a silently inert form.
        return React.createElement(
          React.Fragment,
          null,
          React.createElement(StreamView, { value }),
          React.createElement('div', { className: 'dbm-pad dbm-hint' }, t('redisedit.readonlyType', { type: value.type })),
        )
    }
  })()

  return React.createElement('div', { className: 'dbm-tab-body' }, head, body)
}

/** The TTL control: shows the current expiry and lets it be changed or cleared. */
function TtlEditor(props: {
  api: DbApi
  source: DataSourceSummary
  db: number
  value: RedisValue
  onDone(message: string): void
  onError(message: string): void
  onReload(): void
}): React.ReactElement {
  const { api, source, db, value } = props
  const [editing, setEditing] = React.useState(false)
  const [seconds, setSeconds] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const apply = async (ttl: number | null): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.redisSetTtl(source.id, { key: value.key, ttl, db })
      props.onDone(t('redisedit.ttl.done', { ttl: formatTtl(result.ttl) }))
      setEditing(false)
      setSeconds('')
      props.onReload()
    } catch (failure) {
      props.onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return React.createElement(
      'span',
      { className: 'dbm-row', style: { gap: '6px' } },
      React.createElement('span', { className: 'dbm-hint' }, `${t('redis.ttl')}: ${formatTtl(value.ttl)}`),
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dbm-btn dbm-btn-sm',
          onClick: () => {
            // Seed the box with the remaining seconds so "change" starts from
            // the real value, and an immediate 保存 does not clear the expiry.
            setSeconds(value.ttl > 0 ? String(value.ttl) : '')
            setEditing(true)
          },
        },
        t('redisedit.ttl.edit'),
      ),
    )
  }

  return React.createElement(
    'span',
    { className: 'dbm-row', style: { gap: '6px' } },
    React.createElement('input', {
      className: 'dbm-input',
      style: { width: '110px' },
      value: seconds,
      placeholder: '0',
      inputMode: 'numeric',
      autoFocus: true,
      onChange: (event: { target: { value: string } }) => setSeconds(event.target.value),
      onKeyDown: (event: { key: string }) => {
        if (event.key === 'Enter') void apply(seconds.trim() === '' ? null : Number(seconds))
        if (event.key === 'Escape') setEditing(false)
      },
    }),
    React.createElement('span', { className: 'dbm-hint' }, t('redisnew.ttl.unit')),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm dbm-btn-primary',
        disabled: busy,
        onClick: () => { void apply(seconds.trim() === '' ? null : Number(seconds)) },
      },
      t('redisedit.save'),
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        disabled: busy,
        // Explicit "permanent" rather than an empty box: the box being empty is
        // also what a user who just cleared it by accident sees.
        title: t('redisedit.ttl.persist.hint'),
        onClick: () => { void apply(null) },
      },
      t('redisedit.ttl.persist'),
    ),
    React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', disabled: busy, onClick: () => setEditing(false) }, t('common.cancel')),
  )
}

/** The string editor: one box, saved as a whole. */
function StringEditor(props: RedisValueEditorProps & { content: string }): React.ReactElement {
  const { api, source, db, value } = props
  const [draft, setDraft] = React.useState(props.content)
  const [busy, setBusy] = React.useState(false)

  // A different key (or a reload after a write) replaces the draft; otherwise a
  // stale edit would be applied to the new key.
  React.useEffect(() => { setDraft(props.content) }, [props.content, value.key])

  const dirty = draft !== props.content

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.redisSetString(source.id, { key: value.key, value: draft, db })
      props.onDone(t('redisedit.saved'))
      props.onReload()
    } catch (failure) {
      props.onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return React.createElement(
    'div',
    { className: 'dbm-scroll' },
    React.createElement(
      'div',
      { className: 'dbm-pad' },
      React.createElement(
        'div',
        { className: 'dbm-row' },
        React.createElement('span', { className: 'dbm-hint' },
          `${t('redis.stringValue')} · ${formatBytes(draft.length)}`),
        dirty ? React.createElement('span', { className: 'dbm-hint dbm-dirty' }, t('redisedit.unsaved')) : null,
      ),
      React.createElement('textarea', {
        className: 'dbm-textarea dbm-mono',
        rows: 10,
        value: draft,
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
        onKeyDown: (event: { key: string; ctrlKey: boolean; metaKey: boolean; preventDefault(): void }) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void save()
          }
        },
      }),
      React.createElement(
        'div',
        { className: 'dbm-row' },
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dbm-btn dbm-btn-primary',
            disabled: busy || !dirty,
            onClick: () => { void save() },
          },
          busy ? t('common.loading') : t('redisedit.save'),
        ),
        React.createElement('button', {
          type: 'button',
          className: 'dbm-btn',
          disabled: busy || !dirty,
          onClick: () => setDraft(props.content),
        }, t('redisedit.revert')),
        React.createElement('span', { className: 'dbm-hint' }, t('redisedit.ctrlEnter')),
      ),
    ),
  )
}

/** The list editor: index-stable rows, editable value, per-row delete, append. */
function ListEditor(props: RedisValueEditorProps & { items: string[] }): React.ReactElement {
  const { api, source, db, value, items } = props
  // Drafts keyed by INDEX, so an edit stays attached to the element it was
  // typed into. Index is the only stable identity a list element has.
  const [drafts, setDrafts] = React.useState<Record<number, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [append, setAppend] = React.useState('')

  React.useEffect(() => { setDrafts({}) }, [value.key, items.length])

  const run = async (work: () => Promise<{ affected: number; removed: boolean }>, done: string): Promise<void> => {
    setBusy(true)
    try {
      const result = await work()
      props.onDone(done)
      if (result.removed) props.onRemoved()
      else props.onReload()
    } catch (failure) {
      props.onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const saveRow = (index: number): void => {
    const next = drafts[index]
    if (next === undefined || next === items[index]) return
    void run(
      () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: 'set', index, value: next } }),
      t('redisedit.saved'),
    )
  }

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    React.createElement(
      'div',
      { className: 'dbm-data' },
      items.length === 0
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
                React.createElement('th', { style: { width: '60px' } }, t('redisedit.index')),
                React.createElement('th', null, t('redis.value')),
                React.createElement('th', { style: { width: '120px' } }, t('col.actions')),
              ),
            ),
            React.createElement(
              'tbody',
              null,
              items.map((item, index) => {
                const draft = drafts[index] ?? item
                const dirty = draft !== item
                return React.createElement(
                  'tr',
                  { key: `${value.key}-${index}` },
                  React.createElement('td', { className: 'dbm-hint' }, String(index)),
                  React.createElement(
                    'td',
                    null,
                    React.createElement('input', {
                      className: 'dbm-input dbm-mono',
                      style: { width: '100%' },
                      value: draft,
                      spellcheck: false,
                      onChange: (event: { target: { value: string } }) =>
                        setDrafts(current => ({ ...current, [index]: event.target.value })),
                      onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') saveRow(index) },
                    }),
                  ),
                  React.createElement(
                    'td',
                    { className: 'dbm-actions' },
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'dbm-btn dbm-btn-sm dbm-btn-primary',
                        disabled: busy || !dirty,
                        onClick: () => saveRow(index),
                      },
                      t('redisedit.save'),
                    ),
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'dbm-btn dbm-btn-sm dbm-btn-danger',
                        disabled: busy,
                        onClick: () => {
                          void run(
                            () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: 'delete', index } }),
                            t('redisedit.rowDeleted'),
                          )
                        },
                      },
                      t('common.delete'),
                    ),
                  ),
                )
              }),
            ),
          ),
    ),
    React.createElement(
      'div',
      { className: 'dbm-pad dbm-row' },
      React.createElement('input', {
        className: 'dbm-input dbm-mono',
        style: { flex: 1, minWidth: '200px' },
        value: append,
        placeholder: t('redisedit.appendPlaceholder'),
        onChange: (event: { target: { value: string } }) => setAppend(event.target.value),
        onKeyDown: (event: { key: string }) => {
          if (event.key === 'Enter' && append !== '') {
            const pushed = append
            setAppend('')
            void run(
              () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: 'push', value: pushed } }),
              t('redisedit.appended'),
            )
          }
        },
      }),
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dbm-btn dbm-btn-primary',
          disabled: busy || append === '',
          onClick: () => {
            const pushed = append
            setAppend('')
            void run(
              () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: 'push', value: pushed } }),
              t('redisedit.appended'),
            )
          },
        },
        t('redisedit.append'),
      ),
    ),
  )
}

/** The set editor: members are their own identity, so a row is add/remove only. */
function SetEditor(props: RedisValueEditorProps & { items: string[] }): React.ReactElement {
  const { api, source, db, value, items } = props
  const [busy, setBusy] = React.useState(false)
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [add, setAdd] = React.useState('')

  React.useEffect(() => { setDrafts({}); setAdd('') }, [value.key, items.length])

  const run = async (work: () => Promise<{ affected: number; removed: boolean }>, done: string): Promise<void> => {
    setBusy(true)
    try {
      const result = await work()
      props.onDone(done)
      if (result.removed) props.onRemoved()
      else props.onReload()
    } catch (failure) {
      props.onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const sorted = [...items].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    React.createElement(
      'div',
      { className: 'dbm-data' },
      items.length === 0
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
                React.createElement('th', null, t('redis.member')),
                React.createElement('th', { style: { width: '180px' } }, t('col.actions')),
              ),
            ),
            React.createElement(
              'tbody',
              null,
              sorted.map(member => {
                const draft = drafts[member] ?? member
                const dirty = draft !== member
                return React.createElement(
                  'tr',
                  { key: member },
                  React.createElement(
                    'td',
                    null,
                    React.createElement('input', {
                      className: 'dbm-input dbm-mono',
                      style: { width: '100%' },
                      value: draft,
                      spellcheck: false,
                      onChange: (event: { target: { value: string } }) =>
                        setDrafts(current => ({ ...current, [member]: event.target.value })),
                    }),
                  ),
                  React.createElement(
                    'td',
                    { className: 'dbm-actions' },
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'dbm-btn dbm-btn-sm dbm-btn-primary',
                        disabled: busy || !dirty || draft === '',
                        // A set member IS its value: renaming is remove + add.
                        onClick: () => {
                          void run(
                            () => api.redisEditElement(source.id, {
                              key: value.key, db,
                              edit: { op: 'delete', member, value: draft },
                            }),
                            t('redisedit.saved'),
                          )
                        },
                      },
                      t('redisedit.save'),
                    ),
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'dbm-btn dbm-btn-sm dbm-btn-danger',
                        disabled: busy,
                        onClick: () => {
                          void run(
                            () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: 'delete', member } }),
                            t('redisedit.rowDeleted'),
                          )
                        },
                      },
                      t('common.delete'),
                    ),
                  ),
                )
              }),
            ),
          ),
    ),
    React.createElement(
      'div',
      { className: 'dbm-pad dbm-row' },
      React.createElement('input', {
        className: 'dbm-input dbm-mono',
        style: { flex: 1, minWidth: '200px' },
        value: add,
        placeholder: t('redisedit.addMember'),
        onChange: (event: { target: { value: string } }) => setAdd(event.target.value),
        onKeyDown: (event: { key: string }) => {
          if (event.key === 'Enter' && add !== '') {
            const added = add
            setAdd('')
            void run(
              () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: 'add', value: added } }),
              t('redisedit.added'),
            )
          }
        },
      }),
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dbm-btn dbm-btn-primary',
          disabled: busy || add === '',
          onClick: () => {
            const added = add
            setAdd('')
            void run(
              () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: 'add', value: added } }),
              t('redisedit.added'),
            )
          },
        },
        t('redisedit.add'),
      ),
    ),
  )
}

/** The hash editor: field name and value both editable. */
function HashEditor(props: RedisValueEditorProps & { fields: Array<{ field: string; value: string }> }): React.ReactElement {
  const { api, source, db, value, fields } = props
  const [busy, setBusy] = React.useState(false)
  const [drafts, setDrafts] = React.useState<Record<string, { field: string; value: string }>>({})
  const [add, setAdd] = React.useState({ field: '', value: '' })

  React.useEffect(() => { setDrafts({}); setAdd({ field: '', value: '' }) }, [value.key, fields.length])

  const run = async (work: () => Promise<{ affected: number; removed: boolean }>, done: string): Promise<void> => {
    setBusy(true)
    try {
      const result = await work()
      props.onDone(done)
      if (result.removed) props.onRemoved()
      else props.onReload()
    } catch (failure) {
      props.onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    React.createElement(
      'div',
      { className: 'dbm-data' },
      fields.length === 0
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
                React.createElement('th', null, t('redis.field')),
                React.createElement('th', null, t('redis.value')),
                React.createElement('th', { style: { width: '190px' } }, t('col.actions')),
              ),
            ),
            React.createElement(
              'tbody',
              null,
              fields.map(entry => {
                const draft = drafts[entry.field] ?? { field: entry.field, value: entry.value }
                const dirty = draft.field !== entry.field || draft.value !== entry.value
                const setDraft = (patch: Partial<{ field: string; value: string }>): void =>
                  setDrafts(current => ({ ...current, [entry.field]: { ...draft, ...patch } }))

                return React.createElement(
                  'tr',
                  { key: entry.field },
                  React.createElement(
                    'td',
                    null,
                    React.createElement('input', {
                      className: 'dbm-input dbm-mono',
                      style: { width: '100%' },
                      value: draft.field,
                      spellcheck: false,
                      onChange: (event: { target: { value: string } }) => setDraft({ field: event.target.value }),
                    }),
                  ),
                  React.createElement(
                    'td',
                    null,
                    React.createElement('input', {
                      className: 'dbm-input dbm-mono',
                      style: { width: '100%' },
                      value: draft.value,
                      spellcheck: false,
                      onChange: (event: { target: { value: string } }) => setDraft({ value: event.target.value }),
                    }),
                  ),
                  React.createElement(
                    'td',
                    { className: 'dbm-actions' },
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'dbm-btn dbm-btn-sm dbm-btn-primary',
                        disabled: busy || !dirty || draft.field === '',
                        onClick: () => {
                          void run(async () => {
                            // A renamed field means the old one must go; HSET
                            // alone would leave both.
                            if (draft.field !== entry.field) {
                              await api.redisEditElement(source.id, {
                                key: value.key, db, edit: { op: 'delete', member: entry.field },
                              })
                            }
                            return api.redisEditElement(source.id, {
                              key: value.key, db, edit: { op: 'set', member: draft.field, value: draft.value },
                            })
                          }, t('redisedit.saved'))
                        },
                      },
                      t('redisedit.save'),
                    ),
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'dbm-btn dbm-btn-sm dbm-btn-danger',
                        disabled: busy,
                        onClick: () => {
                          void run(
                            () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: 'delete', member: entry.field } }),
                            t('redisedit.rowDeleted'),
                          )
                        },
                      },
                      t('common.delete'),
                    ),
                  ),
                )
              }),
            ),
          ),
    ),
    React.createElement(
      'div',
      { className: 'dbm-pad dbm-row' },
      React.createElement('input', {
        className: 'dbm-input dbm-mono',
        style: { width: '200px' },
        value: add.field,
        placeholder: t('redis.field'),
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => setAdd(current => ({ ...current, field: event.target.value })),
      }),
      React.createElement('input', {
        className: 'dbm-input dbm-mono',
        style: { flex: 1, minWidth: '200px' },
        value: add.value,
        placeholder: t('redis.value'),
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => setAdd(current => ({ ...current, value: event.target.value })),
      }),
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dbm-btn dbm-btn-primary',
          disabled: busy || add.field === '',
          onClick: () => {
            const entry = add
            setAdd({ field: '', value: '' })
            void run(
              () => api.redisEditElement(source.id, {
                key: value.key, db, edit: { op: 'set', member: entry.field, value: entry.value },
              }),
              t('redisedit.added'),
            )
          },
        },
        t('redisedit.addField'),
      ),
    ),
  )
}

/** The zset editor: member and score both editable. */
function ZsetEditor(props: RedisValueEditorProps & { members: Array<{ member: string; score: string }> }): React.ReactElement {
  const { api, source, db, value, members } = props
  const [busy, setBusy] = React.useState(false)
  const [drafts, setDrafts] = React.useState<Record<string, { member: string; score: string }>>({})
  const [add, setAdd] = React.useState({ member: '', score: '' })
  const [problem, setProblem] = React.useState<string | undefined>(undefined)

  React.useEffect(() => { setDrafts({}); setAdd({ member: '', score: '' }); setProblem(undefined) }, [value.key, members.length])

  const run = async (work: () => Promise<{ affected: number; removed: boolean }>, done: string): Promise<void> => {
    setBusy(true)
    try {
      const result = await work()
      props.onDone(done)
      if (result.removed) props.onRemoved()
      else props.onReload()
    } catch (failure) {
      props.onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return React.createElement(
    'div',
    { className: 'dbm-tab-body' },
    problem === undefined ? null : React.createElement('div', { className: 'dbm-pad dbm-error' }, problem),
    React.createElement(
      'div',
      { className: 'dbm-data' },
      members.length === 0
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
                React.createElement('th', { style: { width: '140px' } }, t('redis.score')),
                React.createElement('th', null, t('redis.member')),
                React.createElement('th', { style: { width: '190px' } }, t('col.actions')),
              ),
            ),
            React.createElement(
              'tbody',
              null,
              members.map(entry => {
                const draft = drafts[entry.member] ?? { member: entry.member, score: entry.score }
                const dirty = draft.member !== entry.member || draft.score !== entry.score
                const setDraft = (patch: Partial<{ member: string; score: string }>): void =>
                  setDrafts(current => ({ ...current, [entry.member]: { ...draft, ...patch } }))

                return React.createElement(
                  'tr',
                  { key: entry.member },
                  React.createElement(
                    'td',
                    null,
                    React.createElement('input', {
                      className: 'dbm-input dbm-mono',
                      style: { width: '100%' },
                      value: draft.score,
                      inputMode: 'decimal',
                      onChange: (event: { target: { value: string } }) => setDraft({ score: event.target.value }),
                    }),
                  ),
                  React.createElement(
                    'td',
                    null,
                    React.createElement('input', {
                      className: 'dbm-input dbm-mono',
                      style: { width: '100%' },
                      value: draft.member,
                      spellcheck: false,
                      onChange: (event: { target: { value: string } }) => setDraft({ member: event.target.value }),
                    }),
                  ),
                  React.createElement(
                    'td',
                    { className: 'dbm-actions' },
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'dbm-btn dbm-btn-sm dbm-btn-primary',
                        disabled: busy || !dirty,
                        onClick: () => {
                          if (!Number.isFinite(Number(draft.score))) {
                            setProblem(t('redisedit.scoreNotNumber', { score: draft.score }))
                            return
                          }
                          setProblem(undefined)
                          void run(async () => {
                            // Renaming a member means removing the old one: ZADD
                            // with a new name would add a second member.
                            if (draft.member !== entry.member) {
                              await api.redisEditElement(source.id, {
                                key: value.key, db, edit: { op: 'delete', member: entry.member },
                              })
                            }
                            return api.redisEditElement(source.id, {
                              key: value.key, db, edit: { op: 'add', member: draft.member, value: draft.score },
                            })
                          }, t('redisedit.saved'))
                        },
                      },
                      t('redisedit.save'),
                    ),
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'dbm-btn dbm-btn-sm dbm-btn-danger',
                        disabled: busy,
                        onClick: () => {
                          void run(
                            () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: 'delete', member: entry.member } }),
                            t('redisedit.rowDeleted'),
                          )
                        },
                      },
                      t('common.delete'),
                    ),
                  ),
                )
              }),
            ),
          ),
    ),
    React.createElement(
      'div',
      { className: 'dbm-pad dbm-row' },
      React.createElement('input', {
        className: 'dbm-input dbm-mono',
        style: { width: '140px' },
        value: add.score,
        placeholder: t('redis.score'),
        inputMode: 'decimal',
        onChange: (event: { target: { value: string } }) => setAdd(current => ({ ...current, score: event.target.value })),
      }),
      React.createElement('input', {
        className: 'dbm-input dbm-mono',
        style: { flex: 1, minWidth: '200px' },
        value: add.member,
        placeholder: t('redis.member'),
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => setAdd(current => ({ ...current, member: event.target.value })),
      }),
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dbm-btn dbm-btn-primary',
          disabled: busy || add.member === '',
          onClick: () => {
            if (!Number.isFinite(Number(add.score))) {
              setProblem(t('redisedit.scoreNotNumber', { score: add.score }))
              return
            }
            setProblem(undefined)
            const entry = add
            setAdd({ member: '', score: '' })
            void run(
              () => api.redisEditElement(source.id, {
                key: value.key, db, edit: { op: 'add', member: entry.member, value: entry.score || '0' },
              }),
              t('redisedit.added'),
            )
          },
        },
        t('redisedit.addMember'),
      ),
    ),
  )
}

/** Read-only rendering of a stream's entries. */
function StreamView(props: { value: RedisValue }): React.ReactElement {
  const entries = props.value.entries ?? []
  return React.createElement(
    'div',
    { className: 'dbm-data' },
    entries.length === 0
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
              React.createElement('th', null, t('redis.entry')),
              React.createElement('th', null, t('redis.field')),
              React.createElement('th', null, t('redis.value')),
            ),
          ),
          React.createElement(
            'tbody',
            null,
            entries.flatMap(entry =>
              entry.fields.map((field, index) =>
                React.createElement(
                  'tr',
                  { key: `${entry.id}-${index}` },
                  React.createElement('td', { className: 'dbm-mono' }, index === 0 ? entry.id : ''),
                  React.createElement('td', { className: 'dbm-mono' }, field.field),
                  React.createElement('td', { className: 'dbm-mono', title: field.value }, field.value),
                ),
              ),
            ),
          ),
        ),
  )
}

/** Re-exported so the view file keeps one import site. */
export { Modal }
