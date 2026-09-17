import * as React from 'react'

/**
 * The 新建表 dialog — phpMyAdmin's table-creation form.
 *
 * It carries the fields a table actually needs, per column and for the table itself:
 * type with an optional length, collation, column attributes, an index selection, a
 * default, a comment; and for the table, its comment, collation and storage engine.
 *
 * Three engine differences are handled explicitly rather than papered over, because
 * each is a case where the field would otherwise look available and do nothing:
 *
 *  - **SQLite has no column attributes, no comments and no storage engine.** It ACCEPTS
 *    `INT UNSIGNED` and stores `INT UNSIGNED` as the type name with no unsigned
 *    behaviour (measured), and refuses `COMMENT` on some types while absorbing it into
 *    the type name on others. Those controls are therefore disabled on SQLite with the
 *    reason stated, and the driver refuses them too so a crafted request cannot slip
 *    through.
 *  - **SQLite stores a length but never enforces it** (`VARCHAR(20)` is kept as a
 *    declared type with no limit). The normal SQLite way is to write it into the type,
 *    so the length field says that instead of silently doing nothing.
 *  - **FULLTEXT / SPATIAL exist only in MySQL.** MySQL additionally requires a text
 *    column for FULLTEXT and NOT NULL for SPATIAL, both checked before submitting.
 *
 * The index model follows phpMyAdmin's: each column picks an index KIND, and columns
 * that share an index NAME form ONE composite index in column order. That is what makes
 * 联合索引 expressible without a second, separate index editor — and the column order
 * is visible in the form because it is the row order.
 */

import type { ColumnAttribute, ColumnSpecPayload, DbKind, IndexKind, TableIndexSpec, TableOptions } from '../protocol.ts'
import type { DbApi } from './api.ts'
import { Modal, t } from './ui.ts'

/** The index kinds a single column can be assigned to. */
type ColumnIndexKind = '' | IndexKind

/** One editable column row in the new-table form. */
interface DraftColumn {
  /** A stable key for React; a fresh number per row so removal cannot collide. */
  id: number
  name: string
  type: string
  length: string
  collate: string
  attributes: ColumnAttribute[]
  nullable: boolean
  defaultValue: string
  autoIncrement: boolean
  comment: string
  indexKind: ColumnIndexKind
  /**
   * The index this column belongs to, by name.
   *
   * Empty means "an index of its own"; a name shared with another column makes a
   * COMPOSITE index in column order. `primary` ignores this — there is only one key.
   */
  indexName: string
}

/** Common column types per engine, matching the 结构 tab's own list. */
const TYPES: Record<string, string[]> = {
  mysql: [
    'INT', 'BIGINT', 'SMALLINT', 'MEDIUMINT', 'TINYINT', 'DECIMAL', 'FLOAT', 'DOUBLE', 'BIT',
    'VARCHAR', 'CHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT',
    'BINARY', 'VARBINARY', 'BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB',
    'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
    'ENUM', 'SET', 'JSON', 'BOOLEAN',
    'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON',
  ],
  sqlite: ['INTEGER', 'REAL', 'TEXT', 'BLOB', 'NUMERIC', 'VARCHAR(255)', 'BOOLEAN', 'DATE', 'DATETIME'],
}

/** The collations offered per engine, as a starting point. */
const COLLATIONS: Record<string, string[]> = {
  mysql: [
    '', 'utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_0900_ai_ci', 'utf8mb4_bin',
    'utf8_general_ci', 'utf8_bin', 'latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin',
    'ascii_general_ci', 'binary',
  ],
  // SQLite's built-in collations. A different vocabulary from MySQL's on purpose: these
  // are the only ones it has without an application-registered collation.
  sqlite: ['', 'BINARY', 'NOCASE', 'RTRIM'],
}

/** The storage engines MySQL supports here, with InnoDB first as the default. */
const ENGINES = ['InnoDB', 'MyISAM', 'MEMORY', 'ARCHIVE', 'CSV', 'BLACKHOLE', 'MRG_MYISAM']

/** Types a FULLTEXT index can cover (MySQL). */
const FULLTEXT_TYPES = /\b(CHAR|VARCHAR|TEXT)\b/i
/** Types a SPATIAL index can cover (MySQL). */
const SPATIAL_TYPES = /\b(GEOMETRY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\b/i
/** Types that take UNSIGNED / ZEROFILL. */
const NUMERIC_TYPES = /\b(INT|INTEGER|TINYINT|SMALLINT|MEDIUMINT|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|BIT)\b/i
/** Types that take BINARY. */
const STRING_TYPES = /\b(CHAR|VARCHAR|TEXT|BLOB|BINARY|VARBINARY|ENUM|SET)\b/i
/** Types that take ON UPDATE CURRENT_TIMESTAMP. */
const TEMPORAL_TYPES = /\b(TIMESTAMP|DATETIME)\b/i

/** A blank starting row. */
let nextRowId = 1
const blank = (kind: string, first: boolean): DraftColumn => ({
  id: nextRowId++,
  name: first ? 'id' : '',
  type: first ? (kind === 'sqlite' ? 'INTEGER' : 'INT') : (kind === 'sqlite' ? 'TEXT' : 'VARCHAR'),
  length: first ? '' : (kind === 'sqlite' ? '' : '255'),
  collate: '',
  attributes: [],
  nullable: !first,
  defaultValue: '',
  // Only the first column starts as an auto-increment key: that is the shape almost
  // every table wants, so starting from it saves two clicks every time.
  autoIncrement: first,
  comment: '',
  indexKind: first ? 'primary' : '',
  indexName: '',
})

/**
 * Whether an auto-increment column is expressible on this engine.
 *
 * Not the same rule for both, and getting it wrong means a create that fails with an
 * engine message about the key rather than a form that says what it needs:
 *
 * - MySQL: the column must be a KEY, and it must be numeric.
 * - SQLite: `AUTOINCREMENT` is legal only on an `INTEGER PRIMARY KEY` (the rowid
 *   alias), so it needs the key AND the exact type `INTEGER` — `INT` is accepted as a
 *   type name but is NOT the rowid alias, so it would silently not auto-increment.
 */
function autoIncrementAllowed(kind: string, column: DraftColumn): boolean {
  if (column.indexKind !== 'primary') return false
  if (!NUMERIC_TYPES.test(column.type) && !/\bINTEGER\b/i.test(column.type)) return false
  if (kind === 'sqlite') return column.type.trim().toUpperCase() === 'INTEGER'
  return true
}

/** Props for {@link CreateTableDialog}. */
export interface CreateTableDialogProps {
  api: DbApi
  sourceId: string
  schema: string
  /** The engine, which decides which controls are available at all. */
  kind: DbKind
  /** Existing table names, so a clash is reported before the request is sent. */
  existingTables: string[]
  onClose(): void
  onCreated(table: string): void
  onError(message: string): void
}

export function CreateTableDialog(props: CreateTableDialogProps): React.ReactElement {
  const { api, sourceId, schema, kind, existingTables, onClose, onCreated, onError } = props
  const isSqlite = kind === 'sqlite'
  const typeList = TYPES[kind] ?? TYPES.mysql!
  const collationList = COLLATIONS[kind] ?? COLLATIONS.mysql!

  const [name, setName] = React.useState('')
  const [columns, setColumns] = React.useState<DraftColumn[]>(() => [blank(kind, true)])
  // Table-level options.
  const [tableComment, setTableComment] = React.useState('')
  const [tableCollate, setTableCollate] = React.useState('')
  const [tableEngine, setTableEngine] = React.useState(isSqlite ? '' : 'InnoDB')
  const [withoutRowid, setWithoutRowid] = React.useState(false)
  const [strict, setStrict] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [localError, setLocalError] = React.useState<string | undefined>(undefined)

  /** Replace one column by id, so a stale index cannot edit the wrong row. */
  const patch = (id: number, next: Partial<DraftColumn>): void => {
    setColumns(current => current.map(column => (column.id === id ? { ...column, ...next } : column)))
  }

  const addRow = (): void => {
    setColumns(current => [...current, { ...blank(kind, false), id: nextRowId++ }])
  }

  const removeRow = (id: number): void => {
    setColumns(current => {
      // The last row is not removable: a table needs at least one column, and an empty
      // form looks like a rendering fault rather than a state the user chose.
      if (current.length <= 1) return current
      return current.filter(column => column.id !== id)
    })
  }

  /**
   * The attributes a column's type can actually carry.
   *
   * Offering BINARY on an INT produces "Invalid ON UPDATE clause"/syntax errors from
   * the server that do not name the field to change. Each attribute is therefore gated
   * on the type in front of it, and the reason is shown on the disabled checkbox.
   */
  const attributeAvailable = (attribute: ColumnAttribute, column: DraftColumn): boolean => {
    if (isSqlite) return false
    switch (attribute) {
      case 'unsigned':
      case 'zerofill':
        return NUMERIC_TYPES.test(column.type)
      case 'binary':
        return STRING_TYPES.test(column.type)
      case 'onUpdateCurrentTimestamp':
        return TEMPORAL_TYPES.test(column.type)
      default:
        return false
    }
  }

  /** Whether an index kind can cover this column. */
  const indexKindAvailable = (indexKind: IndexKind, column: DraftColumn): boolean => {
    if (indexKind === 'fulltext') return !isSqlite && FULLTEXT_TYPES.test(column.type)
    if (indexKind === 'spatial') return !isSqlite && SPATIAL_TYPES.test(column.type) && !column.nullable
    return true
  }

  /**
   * Turn the draft into the wire payload, or return the error to show.
   *
   * Every case here is a normal user mistake and each names the field it is about, so
   * the message can be acted on without reading the engine's own error.
   */
  const build = ():
    | { payload: { table: string; specs: ColumnSpecPayload[]; primaryKey: string[]; indexes: TableIndexSpec[]; tableOptions: TableOptions } }
    | { error: string } => {
    const tableName = name.trim()
    if (tableName === '') return { error: t('createTable.nameRequired') }
    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(tableName)) return { error: t('createTable.nameInvalid') }
    if (existingTables.some(existing => existing.toLowerCase() === tableName.toLowerCase())) {
      return { error: t('createTable.nameTaken', { table: tableName }) }
    }

    const specs: ColumnSpecPayload[] = []
    const key: string[] = []
    const seen = new Set<string>()

    for (const [index, column] of columns.entries()) {
      const columnName = column.name.trim()
      const position = index + 1
      if (columnName === '') return { error: t('createTable.columnNameRequired', { n: position }) }
      if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(columnName)) return { error: t('createTable.columnNameInvalid', { name: columnName }) }
      if (seen.has(columnName.toLowerCase())) return { error: t('createTable.columnDuplicated', { name: columnName }) }
      seen.add(columnName.toLowerCase())
      if (column.type.trim() === '') return { error: t('createTable.columnTypeRequired', { name: columnName }) }

      // An attribute that the type cannot carry is refused here rather than by the
      // server, whose message would not name the field.
      for (const attribute of column.attributes) {
        if (!attributeAvailable(attribute, column)) {
          return { error: t('createTable.attributeNotForType', { name: columnName, type: column.type }) }
        }
      }
      if (isSqlite && column.length.trim() !== '') {
        return { error: t('createTable.sqliteNoLength', { name: columnName }) }
      }
      if (isSqlite && column.comment.trim() !== '') {
        return { error: t('createTable.sqliteNoComment', { name: columnName }) }
      }
      if (column.length.trim() !== '' && !/^[0-9]{1,10}(\s*,\s*[0-9]{1,10})?$/.test(column.length.trim())) {
        // `enum('a','b')` and `set('a','b')` also live in this slot, but a length is the
        // common case; anything else is passed through as values only if quoted.
        if (!/^'([^'\\]|'')*'(\s*,\s*'([^'\\]|'')*')*$/.test(column.length.trim())) {
          return { error: t('createTable.lengthInvalid', { name: columnName }) }
        }
      }

      const autoIncrement = column.autoIncrement && autoIncrementAllowed(kind, column)
      if (column.autoIncrement && !autoIncrementAllowed(kind, column)) {
        /*
         * The message says which field and why, and the reason depends on WHICH rule was
         * missed: no key at all, a key of the wrong type, or (SQLite) a key whose type is
         * not INTEGER. One generic message would leave the user guessing which box to
         * change, and the templates that carry no placeholders are passed none.
         */
        if (column.indexKind !== 'primary') return { error: t('createTable.autoNeedsKey') }
        if (isSqlite) return { error: t('createTable.autoNeedsInteger', { name: columnName }) }
        return { error: t('createTable.autoNeedsNumeric') }
      }
      // An auto-increment column cannot also carry a literal default: both engines
      // refuse it, and the refusal does not say which of the two fields to drop.
      if (autoIncrement && column.defaultValue.trim() !== '') {
        return { error: t('createTable.autoIncrementDefault', { name: columnName }) }
      }
      if (column.indexKind === 'primary') key.push(columnName)
      if (column.indexKind !== '' && !indexKindAvailable(column.indexKind, column)) {
        // Each states what the index needs AND what this column is, so the fix is clear
        // without opening the server's own error.
        if (column.indexKind === 'fulltext') return { error: t('createTable.fulltextNeedsText', { name: columnName, type: column.type }) }
        if (column.indexKind === 'spatial') return { error: t('createTable.spatialNeedsGeometry', { name: columnName }) }
      }

      const attributes = isSqlite ? [] : column.attributes
      specs.push({
        name: columnName,
        type: column.type.trim(),
        // A key column is never nullable in either engine, so the flag is forced rather
        // than left to produce a statement the server rejects.
        nullable: column.indexKind === 'primary' ? false : column.nullable,
        ...(column.length.trim() === '' ? {} : { length: column.length.trim() }),
        ...(column.collate === '' ? {} : { collate: column.collate }),
        ...(attributes.length === 0 ? {} : { attributes }),
        ...(column.defaultValue.trim() === '' ? {} : { defaultValue: column.defaultValue.trim() }),
        ...(autoIncrement ? { autoIncrement: true } : {}),
        ...(column.comment.trim() === '' ? {} : { comment: column.comment.trim() }),
      })
    }

    /*
     * Group the columns into indexes.
     *
     * The rule is phpMyAdmin's: a column with an index kind but no NAME gets an index of
     * its own, and columns sharing a name combine into ONE composite index, in column
     * order. Grouping is by (kind, name) so two columns cannot silently join an index of
     * a different kind.
     */
    const indexes: TableIndexSpec[] = []
    const groups = new Map<string, { kind: IndexKind; name: string; columns: string[] }>()
    for (const column of columns) {
      if (column.indexKind === '' || column.indexKind === 'primary') continue
      const columnName = column.name.trim()
      const explicit = column.indexName.trim()
      const groupKey = explicit === '' ? `__solo_${column.id}` : `${column.indexKind}:${explicit}`
      const existing = groups.get(groupKey)
      if (existing === undefined) {
        groups.set(groupKey, { kind: column.indexKind, name: explicit, columns: [columnName] })
      } else {
        existing.columns.push(columnName)
      }
    }
    for (const group of groups.values()) {
      indexes.push({
        kind: group.kind,
        ...(group.name === '' ? {} : { name: group.name }),
        columns: group.columns,
      })
    }

    const autos = columns.filter(column => column.autoIncrement)
    if (autos.length > 1) {
      /*
       * More than one auto-increment column is refused up front: MySQL allows exactly
       * one per table, and its message ("there can be only one auto column") does not
       * say which box to untick.
       */
      const valid = autos.filter(column => autoIncrementAllowed(kind, column))
      if (valid.length > 1) {
        return { error: t('createTable.oneAutoIncrement', { names: valid.map(column => column.name.trim()).join(', ') }) }
      }
    }

    const tableOptions: TableOptions = {
      ...(isSqlite || tableEngine === '' ? {} : { engine: tableEngine }),
      ...(isSqlite || tableCollate === '' ? {} : { collate: tableCollate }),
      ...(isSqlite || tableComment.trim() === '' ? {} : { comment: tableComment.trim() }),
      ...(isSqlite && (withoutRowid || strict)
        ? { tail: [withoutRowid ? 'WITHOUT ROWID' : '', strict ? 'STRICT' : ''].filter(Boolean).join(', ') }
        : {}),
    }

    return { payload: { table: tableName, specs, primaryKey: key, indexes, tableOptions } }
  }

  const submit = async (): Promise<void> => {
    const built = build()
    if ('error' in built) { setLocalError(built.error); return }
    setLocalError(undefined)
    setBusy(true)
    try {
      await api.changeSchema(sourceId, {
        schema,
        table: built.payload.table,
        action: 'createTable',
        specs: built.payload.specs,
        ...(built.payload.primaryKey.length === 0 ? {} : { primaryKey: built.payload.primaryKey }),
        ...(built.payload.indexes.length === 0 ? {} : { indexes: built.payload.indexes }),
        ...(Object.keys(built.payload.tableOptions).length === 0 ? {} : { tableOptions: built.payload.tableOptions }),
      })
      onCreated(built.payload.table)
    } catch (failure) {
      // Reported inside the dialog rather than only as a page banner: the form is still
      // open and whatever the engine objected to is fixable here.
      setLocalError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  /** One attribute checkbox, disabled with the reason when the type cannot carry it. */
  const attributeBox = (column: DraftColumn, attribute: ColumnAttribute, label: string): React.ReactElement => {
    const available = attributeAvailable(attribute, column)
    return React.createElement(
      'label',
      { className: 'dbm-check dbm-check-tight', key: attribute, title: available ? undefined : t('createTable.attributeUnavailable') },
      React.createElement('input', {
        type: 'checkbox',
        checked: column.attributes.includes(attribute),
        disabled: !available,
        'data-dbm-newtable-attr': `${column.id}:${attribute}`,
        onChange: (event: { target: { checked: boolean } }) => {
          const next = column.attributes.filter(entry => entry !== attribute)
          if (event.target.checked) next.push(attribute)
          patch(column.id, { attributes: next })
        },
      }),
      label,
    )
  }

  /** The index kind selector for one column. */
  const indexSelect = (column: DraftColumn, index: number): React.ReactElement =>
    React.createElement(
      'select',
      {
        className: 'dbm-select',
        value: column.indexKind,
        'aria-label': t('createTable.columnIndex'),
        // The ROW index, like every other control in this table. It used to be
        // `column.id`, which is a different number — so anything addressing the form by
        // row (the E2E probes) selected the wrong row's control.
        'data-dbm-newtable-index': String(index),
        onChange: (event: { target: { value: string } }) => patch(column.id, { indexKind: event.target.value as ColumnIndexKind }),
      },
      [
        React.createElement('option', { key: '', value: '' }, t('common.none')),
        ...(['primary', 'unique', 'index', 'fulltext', 'spatial'] as IndexKind[]).map(value => {
          const available = indexKindAvailable(value, column)
          return React.createElement(
            'option',
            { key: value, value, disabled: !available },
            available ? t(`createTable.index.${value}` as never) : `${t(`createTable.index.${value}` as never)}（${t('createTable.indexUnavailable')}）`,
          )
        }),
      ],
    )

  /** One row of the column table. */
  const rowFor = (column: DraftColumn, index: number): React.ReactElement =>
    React.createElement(
      'tr',
      { key: column.id, 'data-dbm-newtable-row': String(index) },
      /* 字段名 */
      React.createElement('td', null, React.createElement('input', {
        className: 'dbm-input dbm-mono',
        value: column.name,
        placeholder: t('createTable.columnNamePlaceholder'),
        'aria-label': t('createTable.columnName'),
        'data-dbm-newtable-colname': String(index),
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => patch(column.id, { name: event.target.value }),
      })),
      /* 类型 */
      React.createElement('td', null, React.createElement('input', {
        className: 'dbm-input dbm-mono',
        value: column.type,
        placeholder: typeList[0],
        'aria-label': t('createTable.columnType'),
        'data-dbm-newtable-coltype': String(index),
        spellcheck: false,
        list: `dbm-types-${kind}`,
        onChange: (event: { target: { value: string } }) => patch(column.id, { type: event.target.value }),
      })),
      /* 长度/值 */
      React.createElement('td', null, React.createElement('input', {
        className: 'dbm-input dbm-mono',
        value: column.length,
        placeholder: isSqlite ? t('createTable.sqliteLengthHint') : '255',
        'aria-label': t('createTable.columnLength'),
        'data-dbm-newtable-collength': String(index),
        title: isSqlite ? t('createTable.sqliteLengthHint') : t('createTable.lengthHint'),
        spellcheck: false,
        disabled: isSqlite,
        onChange: (event: { target: { value: string } }) => patch(column.id, { length: event.target.value }),
      })),
      /* 排序规则 */
      React.createElement('td', null, React.createElement(
        'select',
        {
          className: 'dbm-select',
          value: column.collate,
          'aria-label': t('createTable.columnCollate'),
          'data-dbm-newtable-colcollate': String(index),
          onChange: (event: { target: { value: string } }) => patch(column.id, { collate: event.target.value }),
        },
        collationList.map(value => React.createElement('option', { key: value === '' ? '__none__' : value, value }, value === '' ? t('common.none') : value)),
      )),
      /* 属性 */
      React.createElement(
        'td',
        { className: 'dbm-attrs' },
        attributeBox(column, 'unsigned', 'UNSIGNED'),
        attributeBox(column, 'zerofill', 'ZEROFILL'),
        attributeBox(column, 'binary', 'BINARY'),
        attributeBox(column, 'onUpdateCurrentTimestamp', t('createTable.attrOnUpdate')),
      ),
      /* 索引 */
      React.createElement('td', null, indexSelect(column, index)),
      /* 索引名（联合索引用） */
      React.createElement('td', null, React.createElement('input', {
        className: 'dbm-input dbm-mono',
        value: column.indexName,
        // Only meaningful when an index kind is chosen, and meaningless for PRIMARY:
        // there is exactly one key, so it has no name of its own.
        disabled: column.indexKind === '' || column.indexKind === 'primary',
        placeholder: t('createTable.indexNamePlaceholder'),
        'aria-label': t('createTable.indexName'),
        'data-dbm-newtable-indexname': String(index),
        title: t('createTable.indexNameHint'),
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => patch(column.id, { indexName: event.target.value }),
      })),
      /* 允许空 */
      React.createElement('td', null, React.createElement('label', { className: 'dbm-check' },
        React.createElement('input', {
          type: 'checkbox',
          checked: column.indexKind === 'primary' ? false : column.nullable,
          disabled: column.indexKind === 'primary',
          title: column.indexKind === 'primary' ? t('createTable.keyNotNullable') : undefined,
          'data-dbm-newtable-nullable': String(index),
          onChange: (event: { target: { checked: boolean } }) => patch(column.id, { nullable: event.target.checked }),
        }),
      )),
      /* 默认值 */
      React.createElement('td', null, React.createElement('input', {
        className: 'dbm-input dbm-mono',
        value: column.defaultValue,
        placeholder: t('common.none'),
        'aria-label': t('createTable.columnDefault'),
        'data-dbm-newtable-coldefault': String(index),
        spellcheck: false,
        onChange: (event: { target: { value: string } }) => patch(column.id, { defaultValue: event.target.value }),
      })),
      /* 自增 */
      React.createElement('td', null, React.createElement('label', { className: 'dbm-check' },
        React.createElement('input', {
          type: 'checkbox',
          checked: column.autoIncrement,
          // Disabled where the engine cannot express it, with the reason — see
          // `autoIncrementAllowed`.
          disabled: !autoIncrementAllowed(kind, column),
          title: column.indexKind !== 'primary'
            ? t('createTable.autoNeedsKey')
            : (isSqlite ? t('createTable.autoNeedsInteger') : t('createTable.autoNeedsNumeric')),
          'data-dbm-newtable-auto': String(index),
          onChange: (event: { target: { checked: boolean } }) => patch(column.id, { autoIncrement: event.target.checked }),
        }),
      )),
      /* 注释 */
      React.createElement('td', null, React.createElement('input', {
        className: 'dbm-input',
        value: column.comment,
        disabled: isSqlite,
        placeholder: isSqlite ? t('createTable.sqliteNoCommentShort') : t('common.none'),
        'aria-label': t('createTable.columnComment'),
        'data-dbm-newtable-colcomment': String(index),
        title: isSqlite ? t('createTable.sqliteNoComment', { name: column.name || '—' }) : undefined,
        onChange: (event: { target: { value: string } }) => patch(column.id, { comment: event.target.value }),
      })),
      /* 删除该行 */
      React.createElement('td', null, React.createElement('button', {
        type: 'button',
        className: 'dbm-btn dbm-btn-sm',
        disabled: columns.length <= 1,
        title: columns.length <= 1 ? t('createTable.lastColumn') : t('createTable.removeColumn'),
        'data-dbm-newtable-remove': String(index),
        onClick: () => removeRow(column.id),
      }, '×')),
    )

  /** The header for the column table. */
  const columnHeaders = [
    t('createTable.columnName'),
    t('createTable.columnType'),
    t('createTable.columnLength'),
    t('createTable.columnCollate'),
    t('createTable.columnAttributes'),
    t('createTable.columnIndex'),
    t('createTable.indexName'),
    t('createTable.columnNullable'),
    t('createTable.columnDefault'),
    t('createTable.columnAuto'),
    t('createTable.columnComment'),
    '',
  ]

  const body = React.createElement(
    'div',
    null,
    /* ---- the table itself ---- */
    React.createElement(
      'div',
      { className: 'dbm-field' },
      React.createElement('label', { className: 'dbm-field-label' }, t('createTable.tableName')),
      React.createElement('input', {
        className: 'dbm-input dbm-mono',
        value: name,
        placeholder: 'my_table',
        'aria-label': t('createTable.tableName'),
        'data-dbm-newtable-name': '',
        spellcheck: false,
        autoFocus: true,
        onChange: (event: { target: { value: string } }) => setName(event.target.value),
      }),
      React.createElement('div', { className: 'dbm-hint' }, t('createTable.intoSchema', { schema })),
    ),
    React.createElement(
      'div',
      { className: 'dbm-field dbm-field-row' },
      React.createElement('div', null,
        React.createElement('label', { className: 'dbm-field-label' }, t('createTable.tableComment')),
        React.createElement('input', {
          className: 'dbm-input',
          value: tableComment,
          disabled: isSqlite,
          placeholder: isSqlite ? t('createTable.sqliteNoTableCommentShort') : t('common.none'),
          'data-dbm-newtable-tablecomment': '',
          title: isSqlite ? t('createTable.sqliteNoTableComment') : t('createTable.tableCommentHint'),
          onChange: (event: { target: { value: string } }) => setTableComment(event.target.value),
        }),
      ),
      React.createElement('div', null,
        React.createElement('label', { className: 'dbm-field-label' }, t('createTable.tableCollate')),
        isSqlite
          ? React.createElement('input', {
              className: 'dbm-input dbm-mono',
              value: '',
              disabled: true,
              placeholder: t('createTable.sqliteNoTableCollateShort'),
              'data-dbm-newtable-tablecollate': '',
              title: t('createTable.sqliteNoTableCollate'),
            })
          : React.createElement(
              'select',
              {
                className: 'dbm-select',
                value: tableCollate,
                'data-dbm-newtable-tablecollate': '',
                onChange: (event: { target: { value: string } }) => setTableCollate(event.target.value),
              },
              collationList.map(value => React.createElement('option', { key: value === '' ? '__none__' : value, value }, value === '' ? t('createTable.tableCollateDefault') : value)),
            ),
      ),
      React.createElement('div', null,
        React.createElement('label', { className: 'dbm-field-label' }, t('createTable.tableEngine')),
        isSqlite
          ? React.createElement('input', {
              className: 'dbm-input dbm-mono',
              value: '',
              disabled: true,
              placeholder: t('createTable.sqliteNoEngineShort'),
              'data-dbm-newtable-tableengine': '',
              title: t('createTable.sqliteNoEngine'),
            })
          : React.createElement(
              'select',
              {
                className: 'dbm-select',
                value: tableEngine,
                'data-dbm-newtable-tableengine': '',
                onChange: (event: { target: { value: string } }) => setTableEngine(event.target.value),
              },
              ENGINES.map(value => React.createElement('option', { key: value, value }, value)),
            ),
      ),
      // SQLite's own trailing keywords, which have no MySQL equivalent.
      isSqlite
        ? React.createElement('div', null,
            React.createElement('label', { className: 'dbm-field-label' }, t('createTable.tableTail')),
            React.createElement('label', { className: 'dbm-check' },
              React.createElement('input', {
                type: 'checkbox',
                checked: withoutRowid,
                'data-dbm-newtable-withoutrowid': '',
                onChange: (event: { target: { checked: boolean } }) => setWithoutRowid(event.target.checked),
              }),
              'WITHOUT ROWID',
            ),
            React.createElement('label', { className: 'dbm-check' },
              React.createElement('input', {
                type: 'checkbox',
                checked: strict,
                'data-dbm-newtable-strict': '',
                onChange: (event: { target: { checked: boolean } }) => setStrict(event.target.checked),
              }),
              'STRICT',
            ),
          )
        : null,
    ),

    /* ---- the columns ---- */
    React.createElement(
      'div',
      { className: 'dbm-field' },
      React.createElement('label', { className: 'dbm-field-label' }, t('createTable.columns')),
      // The datalist suggests types without constraining them: SQLite accepts any type
      // name and MySQL has more types than a list can hold.
      React.createElement('datalist', { id: `dbm-types-${kind}` }, ...typeList.map(value => React.createElement('option', { key: value, value }))),
      React.createElement(
        'div',
        { className: 'dbm-scroll' },
        React.createElement(
          'table',
          { className: 'dbm-table dbm-newtable-cols' },
          React.createElement('thead', null, React.createElement(
            'tr',
            null,
            ...columnHeaders.map((label, index) => React.createElement(
              'th',
              { key: `${label}-${index}`, title: index === 4 ? t('createTable.attributesHint') : index === 6 ? t('createTable.indexNameHint') : undefined },
              label,
            )),
          )),
          React.createElement('tbody', null, ...columns.map(rowFor)),
        ),
      ),
      React.createElement(
        'div',
        { className: 'dbm-row' },
        React.createElement('button', { type: 'button', className: 'dbm-btn dbm-btn-sm', 'data-dbm-newtable-add': '', onClick: addRow }, t('createTable.addColumn')),
      ),
      React.createElement('div', { className: 'dbm-hint' }, t('createTable.hint')),
      /*
       * The composite-index explanation, stated where the index controls are.
       *
       * The rule ("columns sharing an index name form one index, in column order") is
       * not discoverable from the form: a user who wants a two-column index has no way
       * to know they must type the SAME name twice.
       */
      React.createElement('div', { className: 'dbm-hint' }, t('createTable.compositeHint')),
    ),

    localError === undefined
      ? null
      : React.createElement('div', { className: 'dbm-error dbm-pad', role: 'alert', 'data-dbm-newtable-error': '' }, localError),
  )

  return React.createElement(Modal, {
    title: t('createTable.title'),
    // A wider dialog: the form has one control per table column, and at the default
    // width it needed an inner scrollbar, which is what "显示不全" was.
    wide: true,
    onClose: busy ? () => { /* inert while the create is running */ } : onClose,
    footer: [
      React.createElement('button', { key: 'cancel', type: 'button', className: 'dbm-btn', disabled: busy, onClick: onClose }, t('common.cancel')),
      React.createElement(
        'button',
        {
          key: 'ok',
          type: 'button',
          className: `dbm-btn dbm-btn-primary${busy ? ' dbm-btn-busy' : ''}`,
          disabled: busy,
          'aria-busy': busy ? 'true' : undefined,
          'data-dbm-newtable-submit': '',
          onClick: () => { void submit() },
        },
        busy
          ? [React.createElement('span', { key: 'spin', className: 'dbm-spinner' }), t('common.loading')]
          : t('createTable.submit'),
      ),
    ],
    children: body,
  })
}
