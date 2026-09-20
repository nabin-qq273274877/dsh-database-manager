import * as React from 'react'
/**
 * The 操作 tab: the table-level page phpMyAdmin puts last, in the same shape.
 *
 * Five blocks, in phpMyAdmin's order and under its own headings:
 *
 *   1. 将数据表移动到 — `RENAME TABLE` across databases (MySQL) or a rename inside
 *      the one file (SQLite).
 *   2. 表选项 — engine, collation, comment, AUTO_INCREMENT, row format.
 *   3. 将数据表复制到 — structure, and optionally rows, into another database.
 *   4. 表维护 — check / optimize / repair / analyze, on THIS table only.
 *   5. 删除数据或数据表 — empty the rows, or drop the table.
 *
 * Two things about this page are deliberate and worth stating.
 *
 * **The engine's support is asked for, not inferred.** Every block reads
 * `tableActionSupport()`, and a block the engine cannot do is rendered DISABLED with
 * the reason written out beside it rather than hidden. Hiding it leaves a user
 * looking for a control they were told exists; a disabled control that explains
 * itself answers the question. This is the same rule the batch bar's maintenance
 * buttons follow.
 *
 * **A block is a form, not a button.** Each of the three table-level operations names
 * a target or a value before it runs, and the two destructive ones state what they
 * destroy. A single click that moves a table into another database is not a
 * proportionate gesture for an operation with no undo.
 */

import type { ColumnInfo, TableActionOp, TableInfo, TableOptionInfo } from '../protocol.ts'
import { MAINTENANCE_OPS_VIEW, TABLE_ACTION_OPS } from '../protocol.ts'
import type { MaintenanceOpView } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { t } from './ui.ts'

/** Props for {@link SqlOperationsTab}. */
export interface SqlOperationsTabProps {
  api: DbApi
  sourceId: string
  /** Engine kind, for the labels that differ per engine. */
  engineKind: string
  schema: string
  /** The open table's name. */
  table: string
  /** Every database this connection can see, so the target can be picked. */
  schemas: string[]
  /**
   * Which of the three blocks this engine supports.
   *
   * `undefined` means NOT KNOWN YET, which is deliberately different from an empty
   * list: "still reading" must not be rendered as "this engine can do none of them",
   * or every block would flash a disabled-with-reason state as the tab opens. A read
   * that FAILED also arrives as an empty list, with `supportError` set, so the page can
   * say the list could not be read rather than claim the engine is incapable.
   */
  support: TableActionOp[] | undefined
  /** Set when the support read failed, so the page can say so instead of guessing. */
  supportError?: string
  /** Which maintenance statements this engine supports (asked once per source). */
  maintenanceSupport: MaintenanceOpView[]
  /** Only one block may run at a time; the parent owns the flag. */
  busy: boolean
  onBusy(value: boolean): void
  onNotice(message: string | undefined): void
  onError(message: string | undefined): void
  /** Run one maintenance statement on this table; the parent owns the report dialog. */
  onMaintain(op: MaintenanceOpView): void
  /** Ask for a destructive action's confirmation; the parent owns the dialog. */
  onAskDanger(op: 'truncate' | 'drop'): void
  /**
   * The table moved somewhere else; the panel follows it.
   *
   * A same-database move is a RENAME, so the table still exists under its new name
   * and the pane stays open on it; a cross-database move takes it out of the open
   * database, which the parent handles by falling back to that database's table list.
   */
  onMoved(next: { schema: string; table: string }): void
  /** A copy was made, so the database's table list needs re-reading. */
  onTablesChanged(): void
}

/** A `schema.table` field pair, as the two target forms both use it. */
function TargetFields(props: {
  idPrefix: string
  schemas: string[]
  schema: string
  table: string
  disabled: boolean
  onSchema(value: string): void
  onTable(value: string): void
}): React.ReactElement {
  const { idPrefix, schemas, schema, table, disabled, onSchema, onTable } = props
  return React.createElement(
    'div',
    { className: 'dbm-row' },
    React.createElement(
      'label',
      { className: 'dbm-field-inline' },
      React.createElement('span', null, t('tableop.move.target')),
      React.createElement(
        'select',
        {
          className: 'dbm-select',
          value: schema,
          disabled,
          'data-dbm-op-target-schema': '',
          id: `${idPrefix}-schema`,
          onChange: (event: { target: { value: string } }) => onSchema(event.target.value),
        },
        // The current database is in the list too: a same-database move is a rename,
        // which is a legitimate use of this form.
        ...schemas.map(name => React.createElement('option', { key: name, value: name }, name)),
      ),
    ),
    React.createElement('span', { className: 'dbm-hint' }, '.'),
    React.createElement(
      'input',
      {
        className: 'dbm-input dbm-mono',
        value: table,
        disabled,
        'data-dbm-op-target-table': '',
        'aria-label': t('tableop.move.target'),
        onChange: (event: { target: { value: string } }) => onTable(event.target.value),
      },
    ),
  )
}

/** The 操作 tab. */
export function SqlOperationsTab(props: SqlOperationsTabProps): React.ReactElement {
  const {
    api, sourceId, engineKind, schema, table, schemas, support, supportError,
    maintenanceSupport, busy, onBusy, onNotice, onError, onMaintain, onAskDanger, onMoved, onTablesChanged,
  } = props

  const has = (op: TableActionOp): boolean => support?.includes(op) === true
  /** A block whose support is not yet known reads as "loading", not as "unsupported". */
  const known = support !== undefined

  /**
   * Whether the open object is a view.
   *
   * Read from the SERVER rather than passed in: the caller has the table's name and
   * possibly a cached `TableInfo`, but a table opened from the tree's own list arrives
   * with nothing, and guessing `table` there would offer 清空 on a view. The read is
   * the same `table/options` request the 表选项 block makes, so it costs no extra round
   * trip — both come from one response.
   *
   * `undefined` until it is known, and every view-sensitive control stays disabled
   * while it is: an enabled 清空 that becomes disabled a moment later is a worse
   * experience than one that waits.
   */
  const [isView, setIsView] = React.useState<boolean | undefined>(undefined)

  /** The move form's target. */
  const [moveSchema, setMoveSchema] = React.useState(schema)
  const [moveTable, setMoveTable] = React.useState(table)
  /** The copy form's target and data choice. */
  const [copySchema, setCopySchema] = React.useState(schema)
  const [copyTable, setCopyTable] = React.useState(`${table}_copy`)
  const [copyData, setCopyData] = React.useState(true)

  /**
   * The 表选项 form, and whether it has been read yet.
   *
   * `undefined` while the read is in flight, so the form shows a loading line instead
   * of four empty fields that briefly claim the table has no engine.
   */
  const [options, setOptions] = React.useState<TableOptionInfo | undefined>(undefined)
  const [optionsError, setOptionsError] = React.useState<string | undefined>(undefined)
  /** The edits, as TEXT, so a half-typed number is not corrected under the keystroke. */
  const [draft, setDraft] = React.useState<{ engine: string; collation: string; comment: string; autoIncrement: string; rowFormat: string; convert: boolean } | undefined>(undefined)

  // A new table means a new target and new option values: carrying either across
  // would move or rewrite a table using another table's answers.
  React.useEffect(() => {
    setMoveSchema(schema)
    setMoveTable(table)
    setCopySchema(schema)
    setCopyTable(`${table}_copy`)
    setOptions(undefined)
    setDraft(undefined)
    setOptionsError(undefined)
    setIsView(undefined)
  }, [schema, table])

  /**
   * Read the table's kind and options once, when the tab opens.
   *
   * The kind is read even on an engine without the 表选项 block, because the
   * destructive block needs it on every engine: emptying a view is refused by both
   * drivers, and MySQL's copy refuses one too. On an engine WITH the options block the
   * same request answers both questions.
   */
  React.useEffect(() => {
    let live = true
    void api.tableOptions(sourceId, { schema, table })
      .then(value => {
        if (!live) return
        setIsView(value.isView === true)
        setOptions(value)
        setDraft({
          engine: value.engine ?? '',
          collation: value.collation ?? '',
          comment: value.comment ?? '',
          autoIncrement: value.autoIncrement === undefined ? '' : String(value.autoIncrement),
          rowFormat: value.rowFormat ?? '',
          convert: false,
        })
        setOptionsError(undefined)
      })
      .catch(failure => {
        if (!live) return
        setOptionsError(failure instanceof Error ? failure.message : String(failure))
      })
    return () => { live = false }
  }, [api, sourceId, schema, table])

  /** Run one table-level operation, with the busy flag and the error reporting. */
  const run = async (what: () => Promise<void>): Promise<void> => {
    onBusy(true)
    try {
      await what()
      onError(undefined)
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      onBusy(false)
    }
  }

  const submitMove = (): void => {
    if (moveTable.trim() === '') { onError(t('tableop.move.needsName')); return }
    if (moveSchema === schema && moveTable.trim() === table) { onError(t('tableop.move.same')); return }
    const next = { schema: moveSchema, table: moveTable.trim() }
    /*
     * The two qualified names are built BEFORE the call.
     *
     * `t()` is read by `scripts/check-locale-placeholders.mjs`, whose argument scan
     * stops at the first `}` — so a template literal written inline inside the values
     * object (`{ from: `${schema}.${table}` }`) makes it read the interpolation instead
     * of the field list and report a missing placeholder on a correct call. Hoisting
     * keeps the guard's subject simple and the call readable.
     */
    const fromName = `${schema}.${table}`
    const toName = `${next.schema}.${next.table}`
    void run(async () => {
      await api.moveTable(sourceId, { schema, table, target: next })
      onNotice(t('tableop.move.done', { from: fromName, to: toName }))
      /*
       * The panel follows the table.
       *
       * phpMyAdmin lands on the target after a move, and the reason is concrete: the
       * pane was showing this table, and after a move that table is not here any more
       * — a grid re-read against the old name would either fail or silently show an
       * empty table. A same-database move is a rename, so the table still exists and
       * the pane stays open on it under its new name.
       */
      onMoved(next)
    })
  }

  const submitCopy = (): void => {
    if (copyTable.trim() === '') { onError(t('tableop.copy.needsName')); return }
    if (copySchema === schema && copyTable.trim() === table) { onError(t('tableop.copy.same')); return }
    // Hoisted for the same reason as the move's: see `submitMove`.
    const copyTarget = { schema: copySchema, table: copyTable.trim() }
    const toName = `${copyTarget.schema}.${copyTarget.table}`
    void run(async () => {
      await api.copyTable(sourceId, {
        schema,
        table,
        target: copyTarget,
        includeData: copyData,
        isView,
      })
      onNotice(t('tableop.copy.done', { to: toName }))
      // A copy can add a table to the database now open, so its list is re-read.
      onTablesChanged()
    })
  }

  /**
   * Submit only the fields the user actually changed.
   *
   * The comparison is against what was READ, not against an empty string: an
   * untouched field must not be emitted at all, or saving the comment would also
   * rewrite the engine and revert a change made elsewhere since the form was opened.
   */
  const submitOptions = (): void => {
    if (options === undefined || draft === undefined) return
    const patch: Record<string, unknown> = {}
    if (draft.engine !== (options.engine ?? '')) patch['engine'] = draft.engine
    if (draft.collation !== (options.collation ?? '')) {
      patch['collation'] = draft.collation
      // The character set is not asked for: a collation belongs to exactly one, and
      // the host resolves it from the server's own list. Sending one here would be a
      // second source for a fact the server already knows.
      if (draft.convert && draft.collation !== '') patch['convertColumns'] = true
    }
    if (draft.comment !== (options.comment ?? '')) patch['comment'] = draft.comment
    if (draft.autoIncrement !== '') {
      const value = Number(draft.autoIncrement)
      if (!Number.isInteger(value) || value < 1) { onError(t('tableop.options.aiInvalid')); return }
      if (value !== options.autoIncrement) patch['autoIncrement'] = value
    }
    if (draft.rowFormat !== (options.rowFormat ?? '')) patch['rowFormat'] = draft.rowFormat
    if (Object.keys(patch).length === 0) { onNotice(t('tableop.options.unchanged')); return }

    void run(async () => {
      await api.setTableOptions(sourceId, { schema, table, patch: patch as never })
      onNotice(t('tableop.options.done', { table }))
      // Re-read, so the form shows what the server now holds rather than what was
      // submitted — MySQL silently ignores parts of an AUTO_INCREMENT change, and a
      // form left showing the submitted value would contradict the table.
      const fresh = await api.tableOptions(sourceId, { schema, table })
      setOptions(fresh)
      setDraft({
        engine: fresh.engine ?? '',
        collation: fresh.collation ?? '',
        comment: fresh.comment ?? '',
        autoIncrement: fresh.autoIncrement === undefined ? '' : String(fresh.autoIncrement),
        rowFormat: fresh.rowFormat ?? '',
        convert: false,
      })
    })
  }

  /** One maintenance button, disabled with the reason when the engine lacks it. */
  const maintenance = (op: MaintenanceOpView): React.ReactElement => {
    // Asked of the host once per source; unknown until then, and the button stays
    // disabled rather than becoming enabled a moment later.
    const supported = maintenanceSupport.includes(op)
    return React.createElement(
      'button',
      {
        key: op,
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        disabled: busy || !supported,
        title: supported ? t(`db.maint.${op}.hint` as never) : t('tableop.maint.unsupported'),
        'data-dbm-op-maint': op,
        'data-dbm-op-maint-supported': supported ? 'true' : 'false',
        onClick: () => onMaintain(op),
      },
      t(`tableop.maint.${op}` as never),
    )
  }

  return React.createElement(
    'div',
    { className: 'dbm-tab-body', 'data-dbm-op-page': '' },
    React.createElement(
      'div',
      { className: 'dbm-scroll' },
      React.createElement(
        'div',
        { className: 'dbm-pad' },
        React.createElement('strong', null, t('tableop.title')),
        React.createElement('span', { className: 'dbm-hint dbm-mono' }, t('tableop.scope', { schema, table })),
        supportError === undefined
          ? null
          : React.createElement('span', { className: 'dbm-hint' }, t('tableop.supportFailed', { error: supportError })),
        // A view has no rows, no structure to copy and no table options; saying so
        // once at the top is clearer than four blocks each failing on click. `false`
        // while the kind is still being read, so no stale hint is left behind.
        isView === true ? React.createElement('span', { className: 'dbm-hint' }, t('tableop.viewHint', { table })) : null,
        React.createElement('div', { className: 'dbm-newtable-sep' }),

        // ---- 1. 将数据表移动到 ------------------------------------------
        React.createElement(
          'div',
          { className: 'dbm-op-block', 'data-dbm-op-block': 'move' },
          React.createElement('strong', null, t('tableop.move.title')),
          React.createElement('span', { className: 'dbm-hint' }, t('tableop.move.body')),
          has('move')
            ? [
                React.createElement('div', { key: 'target' },
                  React.createElement(TargetFields, {
                    idPrefix: 'move',
                    schemas,
                    schema: moveSchema,
                    table: moveTable,
                    disabled: busy || isView === true,
                    onSchema: setMoveSchema,
                    onTable: setMoveTable,
                  })),
                React.createElement('div', { key: 'actions', className: 'dbm-row' },
                  React.createElement('button', {
                    type: 'button',
                    className: `dbm-btn${busy ? ' dbm-btn-busy' : ''}`,
                    disabled: busy || isView === true,
                    'data-dbm-op-submit': 'move',
                    title: isView === true ? t('tableop.viewHint', { table }) : undefined,
                    onClick: submitMove,
                  }, busy
                    ? [React.createElement('span', { key: 'spin', className: 'dbm-spinner' }), t('tableop.move.busy')]
                    : t('tableop.move.submit'))),
              ]
            : React.createElement('span', { className: 'dbm-hint' }, t(known ? 'tableop.unsupported.move' : 'common.loading')),
        ),
        React.createElement('div', { className: 'dbm-newtable-sep' }),

        // ---- 2. 表选项 ----------------------------------------------------
        React.createElement(
          'div',
          { className: 'dbm-op-block', 'data-dbm-op-block': 'options' },
          React.createElement('strong', null, t('tableop.options.title')),
          React.createElement('span', { className: 'dbm-hint' }, t('tableop.options.body')),
          !has('options')
            ? React.createElement('span', { className: 'dbm-hint' }, t(known ? 'tableop.unsupported.options' : 'common.loading'))
            : optionsError !== undefined
              ? React.createElement('span', { className: 'dbm-hint' }, optionsError)
              : options === undefined || draft === undefined
                ? React.createElement('span', { className: 'dbm-hint' }, t('tableop.options.loading'))
                : React.createElement(
                    'div',
                    null,
                    React.createElement(
                      'div',
                      { className: 'dbm-grid2' },
                      // 存储引擎
                      React.createElement(
                        'div',
                        { className: 'dbm-grid-row' },
                        React.createElement('label', { className: 'dbm-grid-label', htmlFor: 'dbm-op-engine' }, t('tableop.options.engine')),
                        React.createElement('select', {
                          id: 'dbm-op-engine',
                          className: 'dbm-select dbm-grid-control',
                          value: draft.engine,
                          disabled: busy,
                          'data-dbm-op-option': 'engine',
                          onChange: (event: { target: { value: string } }) => setDraft({ ...draft, engine: event.target.value }),
                        }, ...ENGINES.map(value => React.createElement('option', { key: value, value }, value))),
                      ),
                      // 整理（排序规则）
                      React.createElement(
                        'div',
                        { className: 'dbm-grid-row' },
                        React.createElement('label', { className: 'dbm-grid-label', htmlFor: 'dbm-op-collation' }, t('tableop.options.collation')),
                        React.createElement(
                          'select',
                          {
                            id: 'dbm-op-collation',
                            className: 'dbm-select dbm-grid-control',
                            value: draft.collation,
                            disabled: busy,
                            'data-dbm-op-option': 'collation',
                            onChange: (event: { target: { value: string } }) => setDraft({ ...draft, collation: event.target.value }),
                          },
                          // The table's own collation is offered even when the cached list
                          // does not name it, so opening the form cannot change the value.
                          ...[...new Set([draft.collation, ...COLLATIONS])].filter(name => name !== '')
                            .map(value => React.createElement('option', { key: value, value }, value)),
                        ),
                      ),
                      // 表注释
                      React.createElement(
                        'div',
                        { className: 'dbm-grid-row' },
                        React.createElement('label', { className: 'dbm-grid-label', htmlFor: 'dbm-op-comment' }, t('tableop.options.comment')),
                        React.createElement('input', {
                          id: 'dbm-op-comment',
                          className: 'dbm-input dbm-grid-control',
                          value: draft.comment,
                          disabled: busy,
                          'data-dbm-op-option': 'comment',
                          onChange: (event: { target: { value: string } }) => setDraft({ ...draft, comment: event.target.value }),
                        }),
                      ),
                      // 下一个 AUTO_INCREMENT 值 — only when the table HAS one, which
                      // is what an absent value means.
                      options.autoIncrement === undefined
                        ? null
                        : React.createElement(
                            'div',
                            { className: 'dbm-grid-row' },
                            React.createElement('label', { className: 'dbm-grid-label', htmlFor: 'dbm-op-ai' }, t('tableop.options.autoIncrement')),
                            React.createElement('input', {
                              id: 'dbm-op-ai',
                              className: 'dbm-input dbm-mono dbm-grid-control',
                              type: 'number',
                              min: 1,
                              value: draft.autoIncrement,
                              disabled: busy,
                              'data-dbm-op-option': 'autoIncrement',
                              onChange: (event: { target: { value: string } }) => setDraft({ ...draft, autoIncrement: event.target.value }),
                            }),
                          ),
                      // 行格式
                      React.createElement(
                        'div',
                        { className: 'dbm-grid-row' },
                        React.createElement('label', { className: 'dbm-grid-label', htmlFor: 'dbm-op-rowformat' }, t('tableop.options.rowFormat')),
                        React.createElement(
                          'select',
                          {
                            id: 'dbm-op-rowformat',
                            className: 'dbm-select dbm-grid-control',
                            value: draft.rowFormat,
                            disabled: busy,
                            'data-dbm-op-option': 'rowFormat',
                            onChange: (event: { target: { value: string } }) => setDraft({ ...draft, rowFormat: event.target.value }),
                          },
                          ...[...new Set([draft.rowFormat, ...ROW_FORMATS])]
                            .map(value => React.createElement('option', { key: value === '' ? '__none__' : value, value }, value === '' ? t('tableop.options.rowFormatDefault') : value)),
                        ),
                      ),
                    ),
                    React.createElement('span', { className: 'dbm-hint' }, t('tableop.options.collationHint')),
                    options.autoIncrement === undefined
                      ? null
                      : React.createElement('span', { className: 'dbm-hint' }, t('tableop.options.autoIncrementHint')),
                    React.createElement(
                      'label',
                      { className: 'dbm-check' },
                      React.createElement('input', {
                        type: 'checkbox',
                        checked: draft.convert,
                        disabled: busy,
                        'data-dbm-op-option': 'convert',
                        onChange: (event: { target: { checked: boolean } }) => setDraft({ ...draft, convert: event.target.checked }),
                      }),
                      t('tableop.options.convert'),
                    ),
                    React.createElement('span', { className: 'dbm-hint' }, t('tableop.options.convertHint')),
                    React.createElement('div', { className: 'dbm-row' },
                      React.createElement('button', {
                        type: 'button',
                        className: `dbm-btn dbm-btn-primary${busy ? ' dbm-btn-busy' : ''}`,
                        disabled: busy,
                        'data-dbm-op-submit': 'options',
                        onClick: submitOptions,
                      }, busy
                        ? [React.createElement('span', { key: 'spin', className: 'dbm-spinner' }), t('tableop.options.busy')]
                        : t('tableop.options.submit'))),
                  ),
        ),
        React.createElement('div', { className: 'dbm-newtable-sep' }),

        // ---- 3. 将数据表复制到 --------------------------------------------
        React.createElement(
          'div',
          { className: 'dbm-op-block', 'data-dbm-op-block': 'copy' },
          React.createElement('strong', null, t('tableop.copy.title')),
          React.createElement('span', { className: 'dbm-hint' }, t('tableop.copy.body')),
          has('copy')
            ? [
                React.createElement('div', { key: 'target' },
                  React.createElement(TargetFields, {
                    idPrefix: 'copy',
                    schemas,
                    schema: copySchema,
                    table: copyTable,
                    disabled: busy || isView === true,
                    onSchema: setCopySchema,
                    onTable: setCopyTable,
                  })),
                React.createElement('label', { key: 'data', className: 'dbm-check' },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: copyData,
                    disabled: busy || isView === true,
                    'data-dbm-op-copy-data': '',
                    onChange: (event: { target: { checked: boolean } }) => setCopyData(event.target.checked),
                  }),
                  t('tableop.copy.data')),
                React.createElement('span', { key: 'dataHint', className: 'dbm-hint' }, t('tableop.copy.dataHint')),
                React.createElement('div', { key: 'actions', className: 'dbm-row' },
                  React.createElement('button', {
                    type: 'button',
                    className: `dbm-btn${busy ? ' dbm-btn-busy' : ''}`,
                    disabled: busy || isView === true,
                    'data-dbm-op-submit': 'copy',
                    title: isView === true ? t('tableop.viewHint', { table }) : undefined,
                    onClick: submitCopy,
                  }, busy
                    ? [React.createElement('span', { key: 'spin', className: 'dbm-spinner' }), t('tableop.copy.busy')]
                    : t('tableop.copy.submit'))),
              ]
            : React.createElement('span', { className: 'dbm-hint' }, t('tableop.unsupported.copy')),
        ),
        React.createElement('div', { className: 'dbm-newtable-sep' }),

        // ---- 4. 表维护 ----------------------------------------------------
        React.createElement(
          'div',
          { className: 'dbm-op-block', 'data-dbm-op-block': 'maintain' },
          React.createElement('strong', null, t('tableop.maint.title')),
          React.createElement('span', { className: 'dbm-hint' }, t('tableop.maint.body')),
          React.createElement('div', { className: 'dbm-row' }, ...MAINTENANCE_OPS_VIEW.map(maintenance)),
          engineKind === 'sqlite'
            ? React.createElement('span', { className: 'dbm-hint' }, t('tableop.maint.repairMissing'))
            : null,
        ),
        React.createElement('div', { className: 'dbm-newtable-sep' }),

        // ---- 5. 删除数据或数据表 ------------------------------------------
        React.createElement(
          'div',
          { className: 'dbm-op-block', 'data-dbm-op-block': 'danger' },
          React.createElement('strong', null, t('tableop.danger.title')),
          React.createElement('span', { className: 'dbm-hint' }, t('tableop.danger.body')),
          React.createElement('div', { className: 'dbm-row' },
            React.createElement('button', {
              type: 'button',
              className: 'dbm-btn dbm-btn-sm',
              // A view has no rows of its own, so emptying one is refused with the
              // reason rather than reported as "0 rows removed".
              disabled: busy || isView === true,
              title: isView === true ? t('tableop.danger.viewTruncate', { table }) : t('tableop.danger.truncateHint'),
              'data-dbm-op-danger': 'truncate',
              onClick: () => onAskDanger('truncate'),
            }, t('tableop.danger.truncate')),
            React.createElement('button', {
              type: 'button',
              className: 'dbm-btn dbm-btn-sm dbm-btn-danger',
              disabled: busy,
              title: t('tableop.danger.dropHint'),
              'data-dbm-op-danger': 'drop',
              onClick: () => onAskDanger('drop'),
            }, t('tableop.danger.drop'))),
        ),
      ),
    ),
  )
}

/** The storage engines offered when the table's own one is not in this list. */
const ENGINES = ['InnoDB', 'MyISAM', 'MEMORY', 'ARCHIVE', 'CSV', 'BLACKHOLE', 'MRG_MYISAM']

/**
 * The collations offered as suggestions.
 *
 * A SHORT list on purpose, and not the authority: the form also offers whatever the
 * table currently uses, so opening it can never change the value, and any name can be
 * typed into the field. The full server list is ~300 rows and belongs in a searchable
 * picker, which this is not — phpMyAdmin's own 表选项 page is a free-text collation
 * field for the same reason.
 */
const COLLATIONS = [
  'utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_0900_ai_ci', 'utf8mb4_bin',
  'utf8_general_ci', 'utf8_bin', 'latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin',
  'ascii_general_ci', 'binary',
]

/** The row formats MySQL's ALTER TABLE accepts as keywords. */
const ROW_FORMATS = ['', 'DYNAMIC', 'COMPACT', 'COMPRESSED', 'REDUNDANT', 'FIXED', 'PAGE']

/** Re-exported so the view has one import for the column list it passes through. */
export type { ColumnInfo }
