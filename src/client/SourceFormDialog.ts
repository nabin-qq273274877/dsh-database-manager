import * as React from 'react'
/**
 * Create / edit dialog for one data source. The engine choice decides which
 * connection fields the form shows, and on edit the engine is fixed — changing
 * it would silently repurpose an entry, so the user is asked to create a new
 * one instead.
 */

import type { DataSourcePayload, DataSourceSummary, DbKind } from '../protocol.ts'
import { DB_KINDS } from '../protocol.ts'
import { ErrorBanner, Modal, t } from './ui.ts'

/** Props for {@link SourceFormDialog}. */
export interface SourceFormDialogProps {
  /** The entry being edited, or undefined when creating. */
  source?: DataSourceSummary
  /** Preselected engine for a create. */
  initialKind?: DbKind
  onSubmit(payload: DataSourcePayload): Promise<void>
  onClose(): void
}

/** The dialog's editable state, all strings so the inputs stay controlled. */
interface FormState {
  kind: DbKind
  id: string
  name: string
  group: string
  tags: string
  description: string
  file: string
  host: string
  port: string
  user: string
  password: string
  clearPassword: boolean
  database: string
  db: string
  tls: boolean
  connectTimeoutMs: string
  readonly: boolean
}

/** Default TCP port per engine. */
function defaultPort(kind: DbKind): string {
  return kind === 'mysql' ? '3306' : '6379'
}

/** Build the initial form state from an existing entry or a blank create. */
function initialState(source: DataSourceSummary | undefined, initialKind: DbKind): FormState {
  if (source === undefined) {
    return {
      kind: initialKind,
      id: '',
      name: '',
      group: '',
      tags: '',
      description: '',
      file: '',
      host: '',
      port: initialKind === 'sqlite' ? '' : defaultPort(initialKind),
      user: '',
      password: '',
      clearPassword: false,
      database: '',
      db: initialKind === 'redis' ? '0' : '',
      tls: false,
      connectTimeoutMs: '',
      readonly: false,
    }
  }
  return {
    kind: source.kind,
    id: source.id,
    name: source.name,
    group: source.group,
    tags: source.tags.join(','),
    description: source.description,
    file: source.file ?? '',
    host: source.host ?? '',
    port: source.port === undefined ? '' : String(source.port),
    user: source.user ?? '',
    password: '',
    clearPassword: false,
    database: source.database ?? '',
    db: source.db === undefined ? '' : String(source.db),
    tls: source.tls === true,
    connectTimeoutMs: source.connectTimeoutMs === undefined ? '' : String(source.connectTimeoutMs),
    readonly: source.readonly,
  }
}

/** Convert the form state into the wire payload. */
function toPayload(state: FormState, isEdit: boolean): DataSourcePayload {
  const tags = state.tags
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '')

  const payload: DataSourcePayload = {
    kind: state.kind,
    name: state.name.trim(),
    group: state.group.trim(),
    tags,
    description: state.description.trim(),
    readonly: state.readonly,
  }
  if (!isEdit) {
    const id = state.id.trim()
    if (id !== '') payload.id = id
  }
  if (state.connectTimeoutMs.trim() !== '') payload.connectTimeoutMs = Number(state.connectTimeoutMs)

  if (state.kind === 'sqlite') {
    payload.file = state.file.trim()
  } else {
    payload.host = state.host.trim()
    if (state.port.trim() !== '') payload.port = Number(state.port)
    if (state.kind === 'mysql') {
      payload.user = state.user.trim()
      if (state.database.trim() !== '') payload.database = state.database.trim()
    } else if (state.db.trim() !== '') {
      payload.db = Number(state.db)
    }
    // An untouched password field means "keep the stored one"; an explicit
    // clear is an explicit empty string.
    if (state.clearPassword) payload.password = ''
    else if (state.password !== '') payload.password = state.password
    payload.tls = state.tls
  }
  return payload
}

/** Which required fields the current state is missing. */
function missingFields(state: FormState): string[] {
  const missing: string[] = []
  if (state.name.trim() === '') missing.push(t('form.name'))
  if (state.kind === 'sqlite') {
    if (state.file.trim() === '') missing.push(t('form.file'))
  } else {
    if (state.host.trim() === '') missing.push(t('form.host'))
    if (state.port.trim() === '' || !/^\d+$/.test(state.port.trim())) missing.push(t('form.port'))
  }
  return missing
}

/** Create / edit dialog for one data source. */
export function SourceFormDialog(props: SourceFormDialogProps): React.ReactElement {
  const { source, initialKind, onSubmit, onClose } = props
  const isEdit = source !== undefined
  const [state, setState] = React.useState<FormState>(() => initialState(source, initialKind ?? 'sqlite'))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>(undefined)

  const patch = (next: Partial<FormState>): void => {
    setState(current => ({ ...current, ...next }))
  }

  const submit = async (): Promise<void> => {
    const missing = missingFields(state)
    if (missing.length > 0) {
      setError(t('form.required', { fields: missing.join('、') }))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await onSubmit(toPayload(state, isEdit))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }

  const field = (label: string, control: React.ReactNode, key?: string): React.ReactElement =>
    React.createElement('label', { className: 'dbm-label', key: key ?? label }, React.createElement('span', null, label), control)

  const input = (value: string, onChange: (next: string) => void, extra: Record<string, unknown> = {}): React.ReactElement =>
    React.createElement('input', {
      className: 'dbm-input',
      value,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      ...extra,
    })

  const children: React.ReactNode[] = []

  // Engine picker
  children.push(
    field(
      t('form.kind'),
      React.createElement(
        'select',
        {
          className: 'dbm-select',
          value: state.kind,
          disabled: isEdit,
          onChange: (event: { target: { value: string } }) => {
            const kind = event.target.value as DbKind
            patch({ kind, port: kind === 'sqlite' ? '' : defaultPort(kind), db: kind === 'redis' ? (state.db === '' ? '0' : state.db) : '' })
          },
        },
        DB_KINDS.map(kind => React.createElement('option', { key: kind, value: kind }, kind)),
      ),
      'kind',
    ),
  )
  if (isEdit) {
    children.push(React.createElement('div', { className: 'dbm-hint', key: 'kind-hint' }, t('form.kindLocked')))
  }

  children.push(
    React.createElement(
      'div',
      { className: 'dbm-grid', key: 'identity' },
      field(t('form.name'), input(state.name, value => patch({ name: value }), { placeholder: t('form.name.placeholder') }), 'name'),
      isEdit
        ? field(t('form.id'), React.createElement('div', { className: 'dbm-mono' }, state.id), 'id')
        : field(t('form.id'), input(state.id, value => patch({ id: value }), { placeholder: t('form.id.placeholder') }), 'id'),
      field(t('form.group'), input(state.group, value => patch({ group: value }), { placeholder: t('form.group.placeholder') }), 'group'),
      field(t('form.tags'), input(state.tags, value => patch({ tags: value }), { placeholder: t('form.tags.placeholder') }), 'tags'),
    ),
  )

  if (state.kind === 'sqlite') {
    children.push(
      field(t('form.file'), input(state.file, value => patch({ file: value }), { placeholder: t('form.file.placeholder'), spellcheck: false }), 'file'),
    )
  } else {
    const connection: unknown[] = [
      field(t('form.host'), input(state.host, value => patch({ host: value }), { placeholder: '127.0.0.1', spellcheck: false }), 'host'),
      field(t('form.port'), input(state.port, value => patch({ port: value }), { inputMode: 'numeric' }), 'port'),
    ]
    if (state.kind === 'mysql') {
      connection.push(
        field(t('form.user'), input(state.user, value => patch({ user: value }), { placeholder: 'root' }), 'user'),
        field(t('form.database'), input(state.database, value => patch({ database: value })), 'database'),
      )
    } else {
      connection.push(field(t('form.db'), input(state.db, value => patch({ db: value }), { inputMode: 'numeric' }), 'db'))
    }
    children.push(React.createElement('div', { className: 'dbm-grid', key: 'connection' }, connection as never))

    const passwordLabel = state.kind === 'mysql' ? t('form.user') : undefined
    void passwordLabel
    children.push(
      field(
        t('form.password'),
        React.createElement('input', {
          className: 'dbm-input',
          type: 'password',
          value: state.password,
          disabled: state.clearPassword,
          placeholder: isEdit && source.hasPassword ? t('form.password.keep') : '',
          onChange: (event: { target: { value: string } }) => patch({ password: event.target.value }),
          autoComplete: 'new-password',
        }),
        'password',
      ),
    )
    if (isEdit && source.hasPassword) {
      children.push(
        React.createElement(
          'label',
          { className: 'dbm-check', key: 'clear' },
          React.createElement('input', {
            type: 'checkbox',
            checked: state.clearPassword,
            onChange: (event: { target: { checked: boolean } }) => patch({ clearPassword: event.target.checked, password: '' }),
          }),
          t('form.password.clear'),
        ),
      )
    }
    children.push(
      React.createElement(
        'div',
        { className: 'dbm-row', key: 'tls' },
        React.createElement(
          'label',
          { className: 'dbm-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: state.tls,
            onChange: (event: { target: { checked: boolean } }) => patch({ tls: event.target.checked }),
          }),
          t('form.tls'),
        ),
        field(t('form.timeout'), input(state.connectTimeoutMs, value => patch({ connectTimeoutMs: value }), { inputMode: 'numeric', placeholder: '10000' }), 'timeout'),
      ),
    )
  }

  children.push(
    React.createElement(
      'label',
      { className: 'dbm-check', key: 'readonly' },
      React.createElement('input', {
        type: 'checkbox',
        checked: state.readonly,
        onChange: (event: { target: { checked: boolean } }) => patch({ readonly: event.target.checked }),
      }),
      t('form.readonly'),
    ),
  )
  children.push(React.createElement('div', { className: 'dbm-hint', key: 'readonly-hint' }, t('form.readonly.hint')))

  children.push(
    field(
      t('form.description'),
      React.createElement('textarea', {
        className: 'dbm-textarea',
        rows: 2,
        value: state.description,
        onChange: (event: { target: { value: string } }) => patch({ description: event.target.value }),
      }),
      'description',
    ),
  )

  if (error !== undefined) children.push(React.createElement(ErrorBanner, { key: 'error', message: error }))

  return React.createElement(Modal, {
    title: isEdit ? t('form.editTitle') : t('form.newTitle'),
    onClose: () => { if (!busy) onClose() },
    footer: [
      React.createElement('button', { key: 'cancel', type: 'button', className: 'dbm-btn', disabled: busy, onClick: onClose }, t('form.cancel')),
      React.createElement('button', { key: 'save', type: 'button', className: 'dbm-btn dbm-btn-primary', disabled: busy, onClick: () => { void submit() } }, busy ? t('common.loading') : t('form.save')),
    ],
    children,
  })
}
