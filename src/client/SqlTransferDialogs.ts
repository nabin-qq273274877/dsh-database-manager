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
  /** Whether the dialog opened in the rows-only mode the batch bar uses. */
  rowsOnly?: boolean
  onClose(): void
  onDone(message: string): void
  onError(message: string): void
}

/** The 导出 dialog. */
export function ExportDialog(props: ExportDialogProps): React.ReactElement {
  const { api, source, schema, table, tableCount, selectedKeys, rowsOnly, onClose, onDone, onError } = props
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
      const payload = {
        schema,
        includeStructure: format === 'csv' ? false : includeStructure,
        includeData,
        // A selection export is rows only: the table already exists at the other
        // end, and re-creating it would collide with it.
        drop: scope === 'selected' ? false : drop,
        format,
        ...(scope === 'schema' || format === 'csv'
          ? (hasTable ? { tables: [table!] } : {})
          : hasTable ? { tables: [table] } : {}),
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

  return React.createElement(Modal, {
    title: t('export.title'),
    onClose: onClose,
    footer: [
      React.createElement('button', { key: 'close', type: 'button', className: 'dbm-btn', disabled: busy, onClick: onClose }, t('common.close')),
      React.createElement('button', {
        key: 'go',
        type: 'button',
        className: 'dbm-btn dbm-btn-primary',
        disabled: busy || (!includeStructure && !includeData),
        'data-dbm-export-submit': '',
        onClick: () => { void run() },
      }, busy ? t('export.busy') : t('export.submit')),
    ],
    children: React.createElement(
      'div',
      null,
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
              onChange: (event: { target: { value: string } }) => setScope(event.target.value as 'schema' | 'table' | 'selected'),
            },
            [
              React.createElement('option', { key: 'schema', value: 'schema' }, t('export.scope.schema', { n: tableCount })),
              hasTable ? React.createElement('option', { key: 'table', value: 'table' }, t('export.scope.table')) : null,
              hasSelection ? React.createElement('option', { key: 'selected', value: 'selected' }, t('export.scope.selected')) : null,
            ].filter(entry => entry !== null)),
          ),
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
      result === undefined
        ? null
        : React.createElement(
            'div',
            { className: 'dbm-ok' },
            t('export.done', { name: result.filename, size: formatBytes(result.size) }),
            result.truncated.length === 0
              ? null
              : React.createElement('div', { className: 'dbm-hint' }, t('export.truncated', { n: result.truncated.length })),
          ),
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

  return React.createElement(Modal, {
    title: t('import.title'),
    onClose,
    footer: [
      React.createElement('button', { key: 'close', type: 'button', className: 'dbm-btn', disabled: busy, onClick: onClose }, t('common.close')),
      React.createElement('button', {
        key: 'go',
        type: 'button',
        className: 'dbm-btn dbm-btn-primary',
        disabled: busy || file === undefined,
        'data-dbm-import-submit': '',
        onClick: () => { void run() },
      }, busy ? t('import.busy') : t('import.submit')),
    ],
    children: React.createElement(
      'div',
      null,
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
      result === undefined ? null : React.createElement('div', { className: 'dbm-ok' }, result),
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
