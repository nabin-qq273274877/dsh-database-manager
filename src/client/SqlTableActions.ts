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
  /**
   * Called with a message and what the operation changed.
   *
   * `stale` names the databases whose contents or names are no longer valid (so their
   * cached statistics and table lists must be dropped); `nowOpen` is the database the
   * panel should be showing afterwards, or undefined to show the placeholder.
   */
  onDone(message: string, changed: { stale: string[]; nowOpen: string | undefined }): void
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
  /**
   * The default collation of each character set, by name.
   *
   * From `SHOW CHARACTER SET`'s own "Default collation" column. It is used to
   * preselect a sensible collation when a character set is chosen, rather than
   * leaving the field empty and letting the server decide silently.
   */
  const [defaultCollations, setDefaultCollations] = React.useState<Record<string, string>>({})
  /**
   * Every collation the server knows, with the character set it belongs to.
   *
   * Fetched ONCE and filtered in the browser, rather than asked per character set:
   * `SHOW COLLATION WHERE Charset = 'x'` cannot be parameter-bound — `SHOW` accepts
   * no placeholders — so building it would mean pasting a value into a statement.
   * Fetching the whole list (about 300 rows) once avoids that entirely and is the
   * same number of round trips.
   */
  const [collationsByCharset, setCollationsByCharset] = React.useState<Record<string, string[]>>({})
  const [collationsLoaded, setCollationsLoaded] = React.useState(false)

  // The character sets and their collations come from the SERVER rather than a
  // hard-coded list: a MySQL release may add one, and a stale list would refuse a
  // value the server accepts.
  React.useEffect(() => {
    if (action !== 'charset' && action !== 'create') return
    let live = true
    const load = async (): Promise<void> => {
      try {
        // `SHOW CHARACTER SET`: Charset | Description | Default collation | Maxlen
        const sets = await api.runSql(sourceId, { sql: 'SHOW CHARACTER SET', limit: 500 })
        if (!live) return
        const names: string[] = []
        const defaults: Record<string, string> = {}
        for (const row of sets.rows) {
          const charsetName = row[0] === undefined ? '' : String(row[0])
          if (charsetName === '') continue
          names.push(charsetName)
          const fallback = row[2] === undefined ? '' : String(row[2])
          if (fallback !== '') defaults[charsetName] = fallback
        }
        setCharsets(names)
        setDefaultCollations(defaults)
      } catch {
        // The fields fall back to free text, which is still usable.
      }
      try {
        // `SHOW COLLATION`: Collation | Charset | Id | Default | Compiled | Sortlen
        const collations = await api.runSql(sourceId, { sql: 'SHOW COLLATION', limit: 2000 })
        if (!live) return
        const grouped: Record<string, string[]> = {}
        for (const row of collations.rows) {
          const collationName = row[0] === undefined ? '' : String(row[0])
          const charsetName = row[1] === undefined ? '' : String(row[1])
          if (collationName === '' || charsetName === '') continue
          ;(grouped[charsetName] ??= []).push(collationName)
        }
        setCollationsByCharset(grouped)
      } catch {
        // Leave it empty: the collation field then stays free text.
      } finally {
        if (live) setCollationsLoaded(true)
      }
    }
    void load()
    return () => { live = false }
  }, [api, sourceId, action])

  /** The collations that belong to the chosen character set. */
  const collationChoices = React.useMemo(
    () => (charset === '' ? [] : collationsByCharset[charset] ?? []),
    [charset, collationsByCharset],
  )

  /**
   * The database's current character set and collation, once read.
   *
   * Declared before the effects that read it: both close over this state, and a
   * declaration after its first use is a temporal-dead-zone error at build time.
   */
  const [currentDefaults, setCurrentDefaults] = React.useState<{ charset: string; collate: string } | undefined>(undefined)

  /**
   * Keep the collation consistent with the character set.
   *
   * A collation belongs to exactly one character set, so one left over from a
   * previous choice is invalid: MySQL rejects `CHARACTER SET latin1 COLLATE
   * utf8mb4_general_ci` with "COLLATION 'x' is not valid for CHARACTER SET 'y'".
   * Rather than let the user submit that, the collation is reset to the new set's
   * default (or cleared) whenever the set changes.
   */
  React.useEffect(() => {
    if (collationChoices.length === 0) return
    /*
     * The database's OWN collation is kept even when the list does not offer it.
     *
     * Normally it is in the list. If the server's collation list was read partially
     * or is older than the database's collation, resetting to the set's default would
     * silently change a value the user never touched — worse than offering a value
     * that happens to be missing from the dropdown.
     */
    if (currentDefaults !== undefined && collate === currentDefaults.collate) return
    if (collationChoices.includes(collate)) return
    setCollate(defaultCollations[charset] ?? '')
  }, [charset, collationChoices, collate, defaultCollations, currentDefaults])

  /**
   * Prefill the character set and collation the database is USING.
   *
   * Reported: 修改字符集 opened with both fields empty, so the user had to remember
   * what the database was already set to before deciding what to change it to —
   * which is backwards, since the current value is what the decision is made against.
   *
   * The values come from `information_schema.SCHEMATA` rather than from the tree or a
   * cached list: those hold table statistics, not the schema's own defaults.
   *
   * Only the two actions that ACT on a database's charset prefill — `create` has no
   * current value to read, and pre-filling it with something arbitrary would be an
   * invented default.
   */
  React.useEffect(() => {
    if (action !== 'charset' || isSqlite) return
    if (schema === undefined || schema === '') return
    let live = true
    /*
     * The schema name is a VALUE, not an identifier here, so it is compared rather
     * than interpolated into the statement in a way the server would parse as one.
     * The API layer binds the parameters this surface accepts; the fallback below
     * escapes the quote itself for the same reason.
     */
    const escaped = schema.replaceAll("'", "''")
    void api.runSql(sourceId, {
      sql: `SELECT DEFAULT_CHARACTER_SET_NAME AS cs, DEFAULT_COLLATION_NAME AS co FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '${escaped}'`,
      limit: 1,
    }).then(result => {
      if (!live) return
      const row = result.rows[0]
      if (row === undefined) return
      const charsetName = row[0] === undefined ? '' : String(row[0])
      const collationName = row[1] === undefined ? '' : String(row[1])
      if (charsetName === '') return
      setCurrentDefaults({ charset: charsetName, collate: collationName })
      // Seeded only if the user has not already typed something, so a slow read
      // cannot overwrite a choice made while it was in flight.
      setCharset(current => (current === '' ? charsetName : current))
      setCollate(current => (current === '' ? collationName : current))
    }).catch(() => { /* the fields simply start empty, which is the old behaviour */ })
    return () => { live = false }
  }, [api, sourceId, action, schema, isSqlite])

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
      /*
       * The same grammar the driver enforces, and the SAME set the message describes.
       *
       * The previous regex allowed `$`, spaces, hyphens and a leading digit while the
       * message claimed only letters, digits and underscores — so a name the user was
       * told was invalid was accepted. Conservative on purpose: a database name reaches
       * the filesystem (SQLite) and command lines, where a space or a leading digit
       * turns into a quoting problem.
       */
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) { onError(t('db.op.nameInvalid')); return }
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
      /*
       * The completion notice takes the operation's own VERB, not its button label.
       *
       * The label for the charset action is the noun 字符集, and interpolating it into a
       * sentence produced 已字符集「dsh」. Each operation now has its own completion
       * phrase, keyed by the action, so a label can be reworded for the button without
       * breaking the notice that reports the outcome.
       */
      const reportName = action === 'drop' || action === 'charset' ? (schema ?? '') : trimmed
      onDone(t(`db.op.done.${action}` as never, { name: reportName }), {
        stale: action === 'create'
          // A create changes only the list; the new database has no statistics yet.
          ? []
          : action === 'drop' || action === 'charset'
            ? [schema ?? '']
            : [schema ?? '', trimmed],
        nowOpen: action === 'drop'
          ? undefined
          : action === 'charset'
            // The charset change does not move the database, so it stays open.
            ? (schema ?? '')
            : trimmed,
      })
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
        /*
         * The database's current values, stated explicitly.
         *
         * The fields below are pre-filled from them, and saying so makes the prefill
         * trustworthy: a value that appeared in a form with no explanation looks like a
         * default rather than the database's actual setting.
         */
        action === 'charset' && currentDefaults !== undefined
          ? React.createElement(
              'div',
              { className: 'dbm-hint dbm-mono', 'data-dbm-dbop-current': '' },
              t('db.op.charsetCurrent', { charset: currentDefaults.charset, collate: currentDefaults.collate }),
            )
          : null,
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
                    'data-dbm-dbop-charset': '',
                    onChange: (event: { target: { value: string } }) => setCharset(event.target.value),
                  })
                : React.createElement(
                    'select',
                    {
                      className: 'dbm-select',
                      value: charset,
                      'data-dbm-dbop-charset': '',
                      onChange: (event: { target: { value: string } }) => setCharset(event.target.value),
                    },
                    [React.createElement('option', { key: '', value: '' }, t('common.none')), ...charsets.map(value => React.createElement('option', { key: value, value }, value))],
                  ),
            )
          : null,
        /*
         * The collation is a LIST OF THE CHOSEN CHARACTER SET'S OWN COLLATIONS.
         *
         * It was a free-text field, which made an invalid pair easy to submit: a
         * collation belongs to exactly one character set, and MySQL rejects a mismatch
         * ("COLLATION 'utf8mb4_general_ci' is not valid for CHARACTER SET 'latin1'").
         * Offering only the ones that belong to the chosen set removes the possibility
         * rather than reporting it after the fact.
         *
         * Empty until a character set is chosen, because "which collations" has no
         * answer without one. When the server's list could not be read, the field falls
         * back to free text so the dialog stays usable.
         */
        action === 'create' || action === 'charset'
          ? React.createElement(
              'div',
              { className: 'dbm-field' },
              React.createElement('label', { className: 'dbm-field-label' }, t('db.op.collate')),
              collationChoices.length > 0
                ? React.createElement(
                    'select',
                    {
                      className: 'dbm-select',
                      value: collate,
                      'data-dbm-dbop-collate': '',
                      onChange: (event: { target: { value: string } }) => setCollate(event.target.value),
                    },
                    [
                      React.createElement('option', { key: '', value: '' }, t('db.op.collateDefault')),
                      ...collationChoices.map(value => React.createElement(
                        'option',
                        { key: value, value },
                        value === defaultCollations[charset] ? `${value} ${t('db.op.collateIsDefault')}` : value,
                      )),
                    ],
                  )
                : React.createElement('input', {
                    className: 'dbm-input dbm-mono',
                    value: collate,
                    // Disabled while no character set is chosen: typing a collation
                    // before knowing its set is exactly the mismatch this removes.
                    disabled: charset === '',
                    placeholder: charset === '' ? t('db.op.collateNeedsCharset') : 'utf8mb4_general_ci',
                    'data-dbm-dbop-collate': '',
                    onChange: (event: { target: { value: string } }) => setCollate(event.target.value),
                  }),
              React.createElement(
                'div',
                { className: 'dbm-hint' },
                charset === ''
                  ? t('db.op.collateNeedsCharset')
                  : collationChoices.length > 0
                    ? t('db.op.collateHint', { charset, n: collationChoices.length })
                    : t('db.op.collateUnavailable'),
              ),
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
          className: `dbm-btn dbm-btn-primary${destructive ? ' dbm-btn-danger' : ''}${busy ? ' dbm-btn-busy' : ''}`,
          disabled: busy || charsetUnsupported,
          'aria-busy': busy ? 'true' : undefined,
          'data-dbm-dbop-submit': '',
          onClick: () => { void submit() },
        },
        /*
         * A SPINNER, not just different words.
         *
         * Measured: the busy state is set and the button is disabled, so the feedback
         * was honest — but the only change was the label, and a rename of a large
         * database moves every table in one statement, which can run for a long time.
         * A label that changed once and then sits still for a minute reads as a hang;
         * the spinner keeps saying "still working".
         */
        busy
          ? [React.createElement('span', { key: 'spin', className: 'dbm-spinner' }), t('db.op.busy')]
          : t('db.op.submit'),
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
          // The operation's own in-progress phrase: interpolating the operation's NAME
          // produced 正在执行 检查…, which reads as a form being filled in.
          React.createElement('span', null, t(`db.maint.running.${op ?? 'check'}` as never)),
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
