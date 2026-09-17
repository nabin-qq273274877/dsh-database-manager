import * as React from 'react'
/**
 * The database-level and batch-table surfaces of the overview pane.
 *
 * Two things phpMyAdmin puts on its database page and this panel was missing:
 *
 * 1. **Batch table operations** — tick several tables and act on all of them:
 *    export, empty, drop, and the four maintenance statements.
 * 2. **Database actions** — create, rename, copy, drop, and change the character
 *    set of the database itself, plus whole-database export/import.
 *
 * Both are dialogs rather than inline controls. Every action here is destructive or
 * long-running, and both need to state their scope before running: "drop 7 tables"
 * and "rename this database by moving every table" are not decisions to make by
 * clicking a button in a toolbar.
 *
 * The engine differences are surfaced, not smoothed over — see `MaintenanceOp`'s
 * documentation in the driver contract. SQLite has no `repair` and no charset to
 * change; MySQL's `rename` is a create-and-move because the server has no
 * `RENAME DATABASE`.
 */

import type { ColumnInfo, MaintenanceOpView, TableInfo } from '../protocol.ts'
import { MAINTENANCE_OPS_VIEW } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { ErrorBanner, Modal, t } from './ui.ts'

/** One table's maintenance outcome, as the panel shows it. */
interface MaintenanceOutcomeView {
  table: string
  op: MaintenanceOpView
  ok: boolean
  messages: string[]
}

/** Props for {@link TableBatchBar}. */
export interface TableBatchBarProps {
  selected: string[]
  /** The selected tables' metadata, so an action can skip a view where needed. */
  tables: TableInfo[]
  schema: string
  busy: boolean
  /** Which maintenance operations this engine supports. */
  support: MaintenanceOpView[]
  engineKind: string
  onExport(): void
  onTruncate(): void
  onDrop(): void
  onMaintain(op: MaintenanceOpView): void
  onClear(): void
  /** Whether everything on the page is currently ticked. */
  allSelected: boolean
  onToggleAll(checked: boolean): void
}

/**
 * The batch-action bar for the table list.
 *
 * It only appears with a selection, for the same reason the row grid's does: a
 * permanently visible row of destructive buttons is both noise and a hazard, and the
 * bar's appearance is itself the feedback that a selection is active.
 */
export function TableBatchBar(props: TableBatchBarProps): React.ReactElement | null {
  const { selected, tables, busy, support, engineKind, onExport, onTruncate, onDrop, onMaintain, onClear, allSelected, onToggleAll } = props
  if (selected.length === 0) return null

  const selectedTables = tables.filter(table => selected.includes(table.name))
  const hasView = selectedTables.some(table => table.type === 'view')

  /** One maintenance button, disabled with the reason when unsupported. */
  const maintenance = (op: MaintenanceOpView): React.ReactElement => {
    const supported = support.includes(op)
    return React.createElement(
      'button',
      {
        key: op,
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        // Rendered even when unsupported, but disabled and carrying the reason. All
        // four were asked for in the batch bar, so REMOVING one would leave a user
        // looking for a control that is not there; a disabled button whose tooltip
        // names the engine's limit answers the question instead.
        disabled: busy || !supported,
        title: supported ? t(`db.maint.${op}.hint` as never) : t('db.maint.unsupported'),
        'data-dbm-maint': op,
        'data-dbm-maint-supported': supported ? 'true' : 'false',
        onClick: () => onMaintain(op),
      },
      t(`db.maint.${op}` as never),
    )
  }

  return React.createElement(
    'div',
    { className: 'dbm-batch-bar', 'data-dbm-table-batch': '' },
    React.createElement('span', null, t('db.selectedCount', { n: selected.length })),
    React.createElement('label', { className: 'dbm-check' },
      React.createElement('input', {
        type: 'checkbox',
        checked: allSelected,
        'aria-label': allSelected ? t('db.selectNone') : t('db.selectAll'),
        onChange: (event: { target: { checked: boolean } }) => onToggleAll(event.target.checked),
      }),
      allSelected ? t('db.selectNone') : t('db.selectAll'),
    ),
    React.createElement('span', { className: 'dbm-batch-sep' }),
    React.createElement(
      'button',
      { type: 'button', className: 'dbm-btn dbm-btn-sm', disabled: busy, 'data-dbm-batch': 'export', onClick: onExport },
      t('db.batch.export'),
    ),
    // 清空 is offered but disabled when every selected object is a view: a view has
    // no rows of its own, so there is nothing to empty and the dialog would have to
    // say so after the click.
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        disabled: busy || selectedTables.every(table => table.type === 'view'),
        title: hasView ? t('db.batch.truncateSkipped', { n: selectedTables.filter(table => table.type === 'view').length }) : undefined,
        'data-dbm-batch': 'truncate',
        onClick: onTruncate,
      },
      t('db.batch.truncate'),
    ),
    React.createElement('span', { className: 'dbm-batch-sep' }),
    ...MAINTENANCE_OPS_VIEW.map(maintenance),
    // `repair` absent from the engine's list is explained where the user is looking,
    // rather than left as a mystery: a disabled button with no reason reads as a bug.
    engineKind === 'sqlite' ? React.createElement('span', { className: 'dbm-hint' }, t('db.maint.repairMissing')) : null,
    React.createElement('span', { className: 'dbm-spacer' }),
    React.createElement(
      'button',
      { type: 'button', className: 'dbm-btn dbm-btn-sm dbm-btn-danger', disabled: busy, 'data-dbm-batch': 'drop', onClick: onDrop },
      t('db.batch.drop'),
    ),
    React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', disabled: busy, onClick: onClear }, t('common.cancel')),
  )
}

/** Props for {@link DatabaseActionDialog}. */
export interface DatabaseActionDialogProps {
  api: DbApi
  sourceId: string
  engineKind: string
  /** The database the actions apply to; absent for `create`. */
  schema?: string
  /** Every database this connection can see, so a name clash is caught early. */
  schemas: string[]
  action: 'create' | 'rename' | 'copy' | 'drop' | 'charset'
  busy: boolean
  onClose(): void
  onDone(message: string): void
  onError(message: string): void
  onBusy(value: boolean): void
}

/**
 * The dialog for one database-level action.
 *
 * One component for all five because they share the same shape — a name, an optional
 * character set, a confirmation — and differ only in which fields apply. Five
 * near-identical dialogs would be five places for the "does this engine support it"
 * rule to drift.
 *
 * `drop` requires the name to be TYPED. It is the only action here that destroys a
 * whole database, and a single click on a button labelled 删除 is not a proportionate
 * confirmation for it.
 */
export function DatabaseActionDialog(props: DatabaseActionDialogProps): React.ReactElement {
  const { api, sourceId, engineKind, schema, schemas, action, busy, onClose, onDone, onError, onBusy } = props
  const isSqlite = engineKind === 'sqlite'
  const [name, setName] = React.useState('')
  const [charset, setCharset] = React.useState('')
  const [collate, setCollate] = React.useState('')
  const [includeData, setIncludeData] = React.useState(true)
  const [confirmText, setConfirmText] = React.useState('')
  const [charsets, setCharsets] = React.useState<string[]>([])

  // The character sets come from the SERVER rather than a hard-coded list: a MySQL
  // release may add one, and a stale list would refuse a value the server accepts.
  React.useEffect(() => {
    if (action !== 'charset' && action !== 'create') return
    let live = true
    // `SHOW CHARACTER SET` is the authority; the query surface is read-only, which
    // is what this is.
    void api.runSql(sourceId, { sql: 'SHOW CHARACTER SET', limit: 500 })
      .then(result => {
        if (!live) return
        // The first column is the charset name.
        setCharsets(result.rows.map(row => String(row[0] ?? '')).filter(value => value !== ''))
      })
      .catch(() => { /* the field stays free text, which is still usable */ })
    return () => { live = false }
  }, [api, sourceId, action])

  // SQLite has no charset to change: say so instead of offering a form that fails.
  const charsetUnsupported = action === 'charset' && isSqlite

  const title = action === 'create'
    ? t('db.op.createTitle')
    : action === 'rename'
      ? t('db.op.renameTitle', { from: schema ?? '' })
      : action === 'copy'
        ? t('db.op.copyTitle', { from: schema ?? '' })
        : action === 'drop'
          ? t('db.op.dropTitle', { from: schema ?? '' })
          : t('db.op.charsetTitle', { from: schema ?? '' })

  /** Validate, then run. Returns nothing; failures land in `onError`. */
  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (action !== 'drop' && action !== 'charset') {
      if (trimmed === '') { onError(t('db.op.nameRequired')); return }
      // The same grammar the driver enforces, checked here so the message names the
      // field instead of arriving as an engine syntax error.
      if (!/^[A-Za-z0-9_$][A-Za-z0-9_$ -]*$/.test(trimmed)) { onError(t('db.op.nameInvalid')); return }
      if (schemas.some(existing => existing.toLowerCase() === trimmed.toLowerCase())) {
        onError(t('db.op.nameTaken'))
        return
      }
    }
    if (action === 'drop' && confirmText.trim() !== (schema ?? '')) {
      onError(t('db.op.dropConfirm', { from: schema ?? '' }))
      return
    }
    const op = action === 'charset' && isSqlite ? undefined : action
    if (op === undefined) { onError(t('db.op.charsetNoSqlite')); return }

    onBusy(true)
    try {
      await api.databaseOperation(sourceId, {
        op,
        name: action === 'drop' || action === 'charset' ? (schema ?? '') : trimmed,
        ...(action === 'rename' || action === 'copy' || action === 'drop' || action === 'charset'
          ? { from: schema ?? '' }
          : {}),
        ...(charset === '' ? {} : { charset }),
        ...(collate === '' ? {} : { collate }),
        ...(action === 'copy' ? { includeData } : {}),
      })
      const label = action === 'create' ? t('db.op.create')
        : action === 'rename' ? t('db.op.rename')
          : action === 'copy' ? t('db.op.copy')
            : action === 'drop' ? t('db.op.drop')
              : t('db.op.charset')
      onDone(t('db.op.done', { op: label, name: action === 'drop' || action === 'charset' ? (schema ?? '') : trimmed }))
      onError('')
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      onBusy(false)
    }
  }

  const body = charsetUnsupported
    ? React.createElement('div', { className: 'dbm-hint' }, t('db.op.charsetNoSqlite'))
    : React.createElement(
        'div',
        null,
        React.createElement('div', { className: 'dbm-hint' }, t(action === 'create' ? 'db.op.createBody'
          : action === 'rename' ? 'db.op.renameBody'
            : action === 'copy' ? 'db.op.copyBody'
              : action === 'drop' ? 'db.op.dropBody'
                : 'db.op.charsetBody' as never)),
        React.createElement(
          'div',
          { className: 'dbm-field' },
          React.createElement('label', { className: 'dbm-field-label' }, t(action === 'rename' ? 'db.op.newName' : 'db.op.name')),
          React.createElement('input', {
            className: 'dbm-input dbm-mono',
            value: name,
            'data-dbm-dbop-name': '',
            placeholder: action === 'create' ? 'my_new_database' : (schema ?? ''),
            autoFocus: action === 'create' || action === 'rename' || action === 'copy',
            onChange: (event: { target: { value: string } }) => setName(event.target.value),
          }),
          action === 'rename' ? React.createElement('div', { className: 'dbm-hint' }, `← ${schema ?? ''}`) : null,
        ),
        action === 'create' || action === 'charset'
          ? React.createElement(
              'div',
              { className: 'dbm-field' },
              React.createElement('label', { className: 'dbm-field-label' }, t('db.op.charset')),
              charsets.length === 0
                ? React.createElement('input', {
                    className: 'dbm-input dbm-mono',
                    value: charset,
                    placeholder: 'utf8mb4',
                    onChange: (event: { target: { value: string } }) => setCharset(event.target.value),
                  })
                : React.createElement(
                    'select',
                    {
                      className: 'dbm-select',
                      value: charset,
                      onChange: (event: { target: { value: string } }) => setCharset(event.target.value),
                    },
                    [React.createElement('option', { key: '', value: '' }, t('common.none')), ...charsets.map(value => React.createElement('option', { key: value, value }, value))],
                  ),
            )
          : null,
        action === 'create' || action === 'charset'
          ? React.createElement(
              'div',
              { className: 'dbm-field' },
              React.createElement('label', { className: 'dbm-field-label' }, t('db.op.collate')),
              React.createElement('input', {
                className: 'dbm-input dbm-mono',
                value: collate,
                placeholder: 'utf8mb4_general_ci',
                onChange: (event: { target: { value: string } }) => setCollate(event.target.value),
              }),
              React.createElement('div', { className: 'dbm-hint' }, t('db.op.collateHint')),
            )
          : null,
        action === 'copy'
          ? React.createElement('label', { className: 'dbm-check' },
              React.createElement('input', {
                type: 'checkbox',
                checked: includeData,
                onChange: (event: { target: { checked: boolean } }) => setIncludeData(event.target.checked),
              }),
              t('db.op.copyData'))
          : null,
        action === 'drop'
          ? React.createElement(
              'div',
              { className: 'dbm-field' },
              React.createElement('label', { className: 'dbm-field-label' }, t('db.op.dropConfirm', { from: schema ?? '' })),
              React.createElement('input', {
                className: 'dbm-input dbm-mono',
                value: confirmText,
                'data-dbm-dbop-confirm': '',
                autoFocus: true,
                onChange: (event: { target: { value: string } }) => setConfirmText(event.target.value),
              }),
            )
          : null,
      )

  /** A destructive action is the danger variant, so it never looks ordinary. */
  const destructive = action === 'drop'

  return React.createElement(Modal, {
    title,
    onClose: busy ? () => { /* ignore while running */ } : onClose,
    footer: [
      React.createElement('button', { key: 'cancel', type: 'button', className: 'dbm-btn', disabled: busy, onClick: onClose }, t('common.cancel')),
      React.createElement(
        'button',
        {
          key: 'ok',
          type: 'button',
          className: `dbm-btn dbm-btn-primary${destructive ? ' dbm-btn-danger' : ''}`,
          disabled: busy || charsetUnsupported,
          'data-dbm-dbop-submit': '',
          onClick: () => { void submit() },
        },
        busy ? t('db.op.busy') : t('db.op.submit'),
      ),
    ],
    children: body,
  })
}

/** Props for {@link MaintenanceReportDialog}. */
export interface MaintenanceReportDialogProps {
  outcomes: MaintenanceOutcomeView[]
  running: boolean
  /** The operation being run, so the running line can name it. */
  op?: MaintenanceOpView
  engineKind: string
  onClose(): void
}

/**
 * The result of a maintenance run.
 *
 * A dialog rather than a one-line notice because the engine's messages ARE the
 * answer: MySQL's `repair` on an InnoDB table reports "The storage engine for the
 * table doesn't support repair" and its `optimize` reports that it is doing a
 * recreate + analyze instead. Summarising those into "done" would claim work that did
 * not happen.
 */
export function MaintenanceReportDialog(props: MaintenanceReportDialogProps): React.ReactElement {
  const { outcomes, running, op, engineKind, onClose } = props
  const ok = outcomes.filter(outcome => outcome.ok).length
  const failed = outcomes.length - ok

  return React.createElement(Modal, {
    title: t('db.maint.title'),
    onClose: running ? () => { /* keep it open while running */ } : onClose,
    footer: [
      React.createElement('button', { key: 'close', type: 'button', className: 'dbm-btn', disabled: running, onClick: onClose }, t('common.close')),
    ],
    children: running
      ? React.createElement('div', { className: 'dbm-row' },
          React.createElement('span', { className: 'dbm-spinner' }),
          React.createElement('span', null, t('db.maint.running', { op: t(`db.maint.${op ?? 'check'}` as never) })),
        )
      : React.createElement(
          'div',
          null,
          outcomes.length === 0
            ? React.createElement(ErrorBanner, { message: t('common.error', { error: '—' }) })
            : React.createElement('div', { className: 'dbm-ok' }, t('db.maint.resultCount', { n: outcomes.length, ok, failed })),
          // SQLite's maintenance acts on the whole file, which the user must know to
          // read the per-table lines correctly.
          engineKind === 'sqlite'
            ? React.createElement('div', { className: 'dbm-hint' }, t('db.maint.scopeWholeDb'))
            : null,
          React.createElement(
            'div',
            { className: 'dbm-maint-report' },
            ...outcomes.map(outcome => React.createElement(
              'div',
              { key: `${outcome.op}-${outcome.table}`, className: 'dbm-maint-entry' },
              React.createElement('div', { className: 'dbm-row' },
                React.createElement('span', { className: `dbm-badge${outcome.ok ? ' dbm-badge-ok' : ' dbm-badge-err'}` }, outcome.ok ? t('common.yes') : t('common.no')),
                React.createElement('strong', { className: 'dbm-mono' }, outcome.table),
              ),
              ...outcome.messages.map((message, index) => React.createElement('div', { key: index, className: 'dbm-hint dbm-mono' }, message)),
            )),
          ),
        ),
  })
}

/** The tick box that selects one table in the overview list. */
export function TableSelectBox(props: {
  checked: boolean
  onChange(checked: boolean): void
  label: string
}): React.ReactElement {
  return React.createElement('input', {
    type: 'checkbox',
    checked: props.checked,
    'aria-label': props.label,
    'data-dbm-table-select': '',
    onChange: (event: { target: { checked: boolean } }) => props.onChange(event.target.checked),
  })
}

/** Re-exported so the view has one import for the maintenance label lookup. */
export type { ColumnInfo }
