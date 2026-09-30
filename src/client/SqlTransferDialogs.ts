import * as React from 'react'
/**
 * The 导出 and 导入 dialogs.
 *
 * Both are shaped by one constraint: the host cannot write to the user's disk and
 * the browser cannot read the database, so the file crosses in the browser. An
 * export comes back as text the browser turns into a download; an import is read
 * with a `FileReader` and posted as text. That is why the export dialog reports
 * the size it produced and the import dialog reports what it ran — neither
 * transfer passes through the agent, and saying so is what makes it explicable.
 *
 * Export and import are the two operations here that can destroy data (an import
 * of a dump containing `DROP TABLE` replaces tables; a CSV import adds rows with
 * no undo), so each states its blast radius in the dialog rather than in a
 * confirmation afterwards.
 */

import type { DataSourceSummary } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { Modal, formatBytes, t } from './ui.ts'

/** Props for {@link ExportDialog}. */
export interface ExportDialogProps {
  api: DbApi
  source: DataSourceSummary
  /** The database the export reads from. */
  schema: string
  /** The table the panel is showing, if any. */
  table?: string
  /** How many tables the schema holds, for the scope label. */
  tableCount: number
  /** Rows the user selected in the grid, when the scope is a selection. */
  selectedKeys?: Array<Array<{ column: string; value: string | number | boolean | null }>>
  /**
   * Tables to export, when the caller already knows the set.
   *
   * The batch 导出所选 passes the ticked table names. Absent means "whatever the
   * scope select says" — the whole schema, or the open table.
   */
  tables?: string[]
  /** Whether the dialog opened in the rows-only mode the batch bar uses. */
  rowsOnly?: boolean
  onClose(): void
  onDone(message: string): void
  onError(message: string): void
}

/** The 导出 dialog. */
export function ExportDialog(props: ExportDialogProps): React.ReactElement {
  const { api, source, schema, table, tableCount, selectedKeys, tables: presetTables, rowsOnly, onClose, onDone, onError } = props
  const hasTable = table !== undefined && table !== ''
  const hasSelection = selectedKeys !== undefined && selectedKeys.length > 0
  const [format, setFormat] = React.useState<'sql' | 'csv'>(rowsOnly === true ? 'csv' : 'sql')
  const [scope, setScope] = React.useState<'schema' | 'table' | 'selected'>(
    hasSelection ? 'selected' : rowsOnly === true ? 'table' : 'table',
  )
  const [includeStructure, setIncludeStructure] = React.useState(true)
  const [includeData, setIncludeData] = React.useState(true)
  const [drop, setDrop] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<{ filename: string; size: number; truncated: string[] } | undefined>(undefined)

  // CSV is one grid, so a schema-wide or selection-scoped CSV is not a thing the
  // format can express. Switching the format moves the scope rather than leaving
  // a combination the host would refuse.
  React.useEffect(() => {
    if (format === 'csv' && scope === 'schema') setScope('table')
  }, [format, scope])

  const run = async (): Promise<void> => {
    if (format === 'csv' && !hasTable) { onError(t('export.csvOneTable')); return }
    setBusy(true)
    try {
      /*
       * Which tables to export.
       *
       * `presetTables` (the batch 导出所选) wins: it is the set the user ticked, and
       * re-deriving it from the scope select would export something else. Otherwise a
       * CSV is always the one open table — a CSV cannot hold more than one — and a SQL
       * dump follows the scope select.
       */
      const chosen = presetTables !== undefined && presetTables.length > 0
        ? presetTables
        : format === 'csv'
          ? (hasTable ? [table!] : [])
          : scope === 'table' && hasTable ? [table] : []
      const payload = {
        schema,
        includeStructure: format === 'csv' ? false : includeStructure,
        includeData,
        // A selection export is rows only: the table already exists at the other
        // end, and re-creating it would collide with it.
        drop: scope === 'selected' ? false : drop,
        format,
        ...(chosen.length === 0 ? {} : { tables: chosen }),
      }
      const response = await api.exportData(source.id, payload as never)
      // The browser saves it. A Blob rather than a data: URL: a dump can be
      // megabytes, and a data: URL of that size is refused by some browsers.
      const blob = new Blob([response.text], { type: response.contentType })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = response.filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      // Revoked on the next tick: revoking synchronously can cancel the download
      // in some browsers before it has read the blob.
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setResult({ filename: response.filename, size: response.byteLength, truncated: response.truncated })
      onDone(t('export.done', { name: response.filename, size: formatBytes(response.byteLength) }))
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const row = (label: string, control: unknown): React.ReactElement =>
    React.createElement(
      'div',
      { className: 'dbm-row' },
      React.createElement('span', { className: 'dbm-hint', style: { width: 110, flex: 'none' } }, label),
      control as never,
    )

  /*
   * The finished state.
   *
   * Reported: 导出完成了，但浮窗还在，不知道有没有成功. Both halves were true — the dialog
   * stayed open (it must: it carries the truncation warning) and the only feedback was a
   * small line at the BOTTOM of the body, under the form, while the primary button still
   * said 导出并下载 as if nothing had happened.
   *
   * So a completed export now says so in three places, in the order the eye travels: a
   * banner at the TOP of the dialog, the primary button relabelled 导出完成 (disabled,
   * because there is nothing left for it to do), and the panel's own notice behind the
   * dialog. 再次导出 re-runs with the settings on screen, so a second export in another
   * format is still one dialog.
   */
  const finished = result !== undefined

  return React.createElement(Modal, {
    title: t('export.title'),
    onClose: onClose,
    footer: [
      React.createElement('button', { key: 'close', type: 'button', className: `dbm-btn${finished ? ' dbm-btn-primary' : ''}`, disabled: busy, onClick: onClose }, t('common.close')),
      finished
        ? React.createElement('button', {
            key: 'again',
            type: 'button',
            className: 'dbm-btn',
            disabled: busy,
            'data-dbm-export-again': '',
            onClick: () => { setResult(undefined); void run() },
          }, t('export.again'))
        : null,
      React.createElement('button', {
        key: 'go',
        type: 'button',
        className: 'dbm-btn dbm-btn-primary',
        disabled: busy || finished || (!includeStructure && !includeData),
        'data-dbm-export-submit': '',
        'aria-busy': busy ? 'true' : undefined,
        onClick: () => { void run() },
      }, busy
        ? [React.createElement('span', { key: 'spin', className: 'dbm-spinner' }), t('export.busy')]
        : finished ? t('export.finished') : t('export.submit')),
    ].filter(entry => entry !== null),
    children: React.createElement(
      'div',
      null,
      /*
       * The SUCCESS BANNER, first in the body.
       *
       * Above the form rather than below it: this is the answer to "did it work", and an
       * answer placed under four controls is one the user has to look for. It states the
       * file name and size, which is also what proves the export ran against the scope on
       * screen.
       */
      result === undefined
        ? null
        : React.createElement(
            'div',
            { className: 'dbm-ok dbm-export-done', 'data-dbm-export-done': '' },
            `✔ ${t('export.done', { name: result.filename, size: formatBytes(result.size) })}`,
            result.truncated.length === 0
              ? null
              : React.createElement('div', { className: 'dbm-hint' }, t('export.truncated', { n: result.truncated.length })),
          ),
      row(t('export.format'), React.createElement(
        'select',
        {
          className: 'dbm-select',
          value: format,
          'data-dbm-export-format': '',
          onChange: (event: { target: { value: string } }) => setFormat(event.target.value === 'csv' ? 'csv' : 'sql'),
        },
        React.createElement('option', { value: 'sql' }, t('export.format.sql')),
        React.createElement('option', { value: 'csv' }, t('export.format.csv')),
      )),
      format === 'csv'
        ? null
        : row(t('export.scope'), React.createElement(
            'select',
            {
              className: 'dbm-select',
              value: scope,
              'data-dbm-export-scope': '',
              // A preset set of tables IS the scope, so the select is disabled rather
              // than offering choices that would be ignored.
              disabled: presetTables !== undefined && presetTables.length > 0,
              onChange: (event: { target: { value: string } }) => setScope(event.target.value as 'schema' | 'table' | 'selected'),
            },
            [
              React.createElement('option', { key: 'schema', value: 'schema' }, t('export.scope.schema', { n: tableCount })),
              hasTable ? React.createElement('option', { key: 'table', value: 'table' }, t('export.scope.table')) : null,
              hasSelection ? React.createElement('option', { key: 'selected', value: 'selected' }, t('export.scope.selected')) : null,
            ].filter(entry => entry !== null)),
          ),
      presetTables !== undefined && presetTables.length > 0
        ? React.createElement(
            'div',
            { className: 'dbm-hint dbm-mono', 'data-dbm-export-tables': '', style: { wordBreak: 'break-all' } },
            `${t('export.scope.chosen', { n: presetTables.length })}: ${presetTables.join('、')}`,
          )
        : null,
      row('', React.createElement('label', { className: 'dbm-check' },
        React.createElement('input', {
          type: 'checkbox',
          checked: includeStructure,
          disabled: format === 'csv',
          onChange: (event: { target: { checked: boolean } }) => setIncludeStructure(event.target.checked),
        }),
        t('export.includeStructure'))),
      row('', React.createElement('label', { className: 'dbm-check' },
        React.createElement('input', {
          type: 'checkbox',
          checked: includeData,
          onChange: (event: { target: { checked: boolean } }) => setIncludeData(event.target.checked),
        }),
        t('export.includeData'))),
      row('', React.createElement('label', { className: 'dbm-check' },
        React.createElement('input', {
          type: 'checkbox',
          checked: drop,
          disabled: format === 'csv' || !includeStructure,
          onChange: (event: { target: { checked: boolean } }) => setDrop(event.target.checked),
        }),
        t('export.dropTable'))),
      drop ? React.createElement('div', { className: 'dbm-hint' }, t('export.dropWarn')) : null,
      // The outcome is reported ONCE, in the banner at the top — a second copy at the
      // bottom of the form was the version nobody read.
      React.createElement('div', { className: 'dbm-hint' }, t('export.hint')),
    ),
  })
}

/** Props for {@link ImportDialog}. */
export interface ImportDialogProps {
  api: DbApi
  source: DataSourceSummary
  schema: string
  /** The table the panel is showing, used as the CSV target's default. */
  table?: string
  /** Every table in the schema, for the CSV target's list. */
  tables: Array<{ name: string; type: string }>
  onClose(): void
  onDone(message: string): void
  onError(message: string): void
}

/**
 * The 导入 dialog.
 *
 * The file is read in the browser and posted as text, so the size is checked
 * before the read rather than after: a 200 MiB file that cannot be sent should
 * not first be loaded into the tab's memory.
 */
export function ImportDialog(props: ImportDialogProps): React.ReactElement {
  const { api, source, schema, table, tables, onClose, onDone, onError } = props
  const [format, setFormat] = React.useState<'sql' | 'csv'>('sql')
  const [target, setTarget] = React.useState(table ?? tables[0]?.name ?? '')
  const [hasHeader, setHasHeader] = React.useState(true)
  const [emptyAsNull, setEmptyAsNull] = React.useState(true)
  const [file, setFile] = React.useState<{ name: string; size: number; text: string } | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<string | undefined>(undefined)

  /** Read the chosen file, refusing one the host would reject anyway. */
  const read = (chosen: File): void => {
    if (chosen.size > IMPORT_FILE_CAP) {
      setFile(undefined)
      onError(t('import.refuseTooBig', { size: formatBytes(chosen.size), limit: formatBytes(IMPORT_FILE_CAP) }))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => onError(`the file could not be read: ${reader.error?.message ?? 'unknown error'}`)
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setFile({ name: chosen.name, size: chosen.size, text })
      onError('')
    }
    reader.readAsText(chosen, 'utf-8')
  }

  const run = async (): Promise<void> => {
    if (file === undefined) { onError(t('import.needFile')); return }
    if (format === 'csv' && target === '') { onError(t('import.needTable')); return }
    setBusy(true)
    try {
      const response = await api.importData(source.id, {
        schema,
        format,
        content: file.text,
        ...(format === 'csv' ? { table: target, hasHeader, emptyAsNull } : {}),
      })
      const message = format === 'csv'
        ? t('import.doneRows', { n: response.rows })
        : t('import.done', { n: response.statements })
      const skipped = response.skipped.length === 0
        ? ''
        : `；${t('import.skipped', { n: response.skipped.length, lines: response.skipped.map(entry => entry.line).join(', ') })}`
      setResult(`${message}${skipped}`)
      onDone(`${message}${skipped}`)
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const row = (label: string, control: unknown): React.ReactElement =>
    React.createElement(
      'div',
      { className: 'dbm-row' },
      React.createElement('span', { className: 'dbm-hint', style: { width: 110, flex: 'none' } }, label),
      control as never,
    )

  /*
   * The finished state, in the same shape the 导出 dialog uses — see its own comment. An
   * import is the longer-running of the two, so leaving the button reading 导入 with a
   * result line buried under the form was the same "did it work?" for a slower operation.
   */
  const finished = result !== undefined

  return React.createElement(Modal, {
    title: t('import.title'),
    onClose,
    footer: [
      React.createElement('button', { key: 'close', type: 'button', className: `dbm-btn${finished ? ' dbm-btn-primary' : ''}`, disabled: busy, onClick: onClose }, t('common.close')),
      finished
        ? React.createElement('button', {
            key: 'again',
            type: 'button',
            className: 'dbm-btn',
            disabled: busy,
            'data-dbm-import-again': '',
            onClick: () => { setResult(undefined); void run() },
          }, t('import.again'))
        : null,
      React.createElement('button', {
        key: 'go',
        type: 'button',
        className: 'dbm-btn dbm-btn-primary',
        disabled: busy || finished || file === undefined,
        'data-dbm-import-submit': '',
        'aria-busy': busy ? 'true' : undefined,
        onClick: () => { void run() },
      }, busy
        ? [React.createElement('span', { key: 'spin', className: 'dbm-spinner' }), t('import.busy')]
        : finished ? t('import.finished') : t('import.submit')),
    ].filter(entry => entry !== null),
    children: React.createElement(
      'div',
      null,
      result === undefined
        ? null
        : React.createElement('div', { className: 'dbm-ok dbm-import-done', 'data-dbm-import-done': '' }, `✔ ${result}`),
      row(t('import.format'), React.createElement(
        'select',
        {
          className: 'dbm-select',
          value: format,
          'data-dbm-import-format': '',
          onChange: (event: { target: { value: string } }) => setFormat(event.target.value === 'csv' ? 'csv' : 'sql'),
        },
        React.createElement('option', { value: 'sql' }, t('import.format.sql')),
        React.createElement('option', { value: 'csv' }, t('import.format.csv')),
      )),
      format === 'csv'
        ? [
            row(t('import.table'), React.createElement(
              'select',
              {
                key: 'target',
                className: 'dbm-select',
                value: target,
                'data-dbm-import-table': '',
                onChange: (event: { target: { value: string } }) => setTarget(event.target.value),
              },
              tables.filter(entry => entry.type !== 'view').map(entry => React.createElement('option', { key: entry.name, value: entry.name }, entry.name)),
            )),
            React.createElement('div', { key: 'hint', className: 'dbm-hint' }, t('import.tableHint')),
            row('', React.createElement('label', { key: 'header', className: 'dbm-check' },
              React.createElement('input', {
                type: 'checkbox',
                checked: hasHeader,
                onChange: (event: { target: { checked: boolean } }) => setHasHeader(event.target.checked),
              }),
              t('import.hasHeader'))),
            hasHeader ? null : React.createElement('div', { key: 'hh', className: 'dbm-hint' }, t('import.hasHeaderHint')),
            row('', React.createElement('label', { key: 'null', className: 'dbm-check' },
              React.createElement('input', {
                type: 'checkbox',
                checked: emptyAsNull,
                onChange: (event: { target: { checked: boolean } }) => setEmptyAsNull(event.target.checked),
              }),
              t('import.emptyAsNull'))),
            React.createElement('div', { key: 'nh', className: 'dbm-hint' }, t('import.emptyAsNullHint')),
          ]
        : null,
      row(t('import.file'), React.createElement('input', {
        type: 'file',
        className: 'dbm-input',
        accept: format === 'csv' ? '.csv,text/csv' : '.sql,text/plain',
        'data-dbm-import-file': '',
        onChange: (event: { target: { files: FileList | null; value: string } }) => {
          const chosen = event.target.files?.[0]
          if (chosen === undefined) return
          read(chosen)
        },
      })),
      file === undefined
        ? React.createElement('div', { className: 'dbm-hint' }, t('import.noFile'))
        : React.createElement('div', { className: 'dbm-hint' }, `${file.name} · ${formatBytes(file.size)}`),
      React.createElement('div', { className: 'dbm-hint' }, t('import.warn')),
      // Reported once, in the banner at the top — see the 导出 dialog's own note.
      React.createElement('div', { className: 'dbm-hint' }, t('import.hint')),
    ),
  })
}

/**
 * The size past which the import dialog refuses a file before reading it.
 *
 * Matches the host's own cap (32 MiB) so the refusal names the same limit; a file
 * the host would reject should not be loaded into the tab's memory first.
 */
const IMPORT_FILE_CAP = 32 * 1024 * 1024
