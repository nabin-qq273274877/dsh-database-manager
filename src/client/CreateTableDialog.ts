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
/*
 * The rules that do not need React live in `column-defaults.ts` so they can be tested directly.
 * A rule stated twice — once here, once there — is two places to get it wrong.
 */
import { autoIncrementBlocker, defaultToWire, nullDefaultNeedsNullable, requiresLengthOrValues, supportsCurrentTimestamp, takesLength, type DefaultMode } from './column-defaults.ts'
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
  /**
   * Which kind of default this column has.
   *
   * `none` emits no DEFAULT clause; `custom` with an empty text emits `DEFAULT ''`; `custom`
   * with text emits that text; `null` emits `DEFAULT NULL`; `currentTimestamp` emits
   * `DEFAULT CURRENT_TIMESTAMP`.
   */
  defaultMode: DefaultMode
  /** The literal, for `defaultMode === 'custom'`. Empty means the empty string. */
  defaultText: string
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

/**
 * Column types, GROUPED as the type dropdown presents them.
 *
 * A flat list of thirty types is hard to scan, and the choice is naturally two-step
 * ("a number, then which number"). Grouping is what was asked for.
 */
const TYPE_GROUPS: Record<string, Array<{ label: string; types: string[] }>> = {
  mysql: [
    { label: 'createTable.group.integer', types: ['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT'] },
    { label: 'createTable.group.float', types: ['FLOAT', 'DOUBLE', 'DECIMAL'] },
    { label: 'createTable.group.string', types: ['CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'ENUM', 'SET', 'JSON'] },
    { label: 'createTable.group.binary', types: ['BIT', 'BINARY', 'VARBINARY', 'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB'] },
    { label: 'createTable.group.temporal', types: ['DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR'] },
    { label: 'createTable.group.spatial', types: ['GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON', 'MULTIPOINT', 'MULTILINESTRING', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION'] },
  ],
  /*
   * SQLite has no type system — a type name is an affinity hint — so these are the
   * conventional names rather than an exhaustive set. Writing a length into the type
   * (`VARCHAR(20)`) is the normal thing to do there, so a couple of those are listed.
   */
  sqlite: [
    { label: 'createTable.group.integer', types: ['INTEGER', 'INT', 'TINYINT', 'SMALLINT', 'BIGINT'] },
    { label: 'createTable.group.float', types: ['REAL', 'DOUBLE', 'FLOAT', 'NUMERIC', 'DECIMAL'] },
    { label: 'createTable.group.string', types: ['TEXT', 'VARCHAR(255)', 'CHAR(1)', 'CLOB'] },
    { label: 'createTable.group.binary', types: ['BLOB'] },
    { label: 'createTable.group.temporal', types: ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME'] },
    { label: 'createTable.group.other', types: ['BOOLEAN'] },
  ],
}

/** Column attributes, as the attribute dropdown lists them. */
const ATTRIBUTE_ITEMS: Array<{ id: ColumnAttribute; label: string }> = [
  { id: 'unsigned', label: 'UNSIGNED' },
  { id: 'zerofill', label: 'ZEROFILL' },
  { id: 'binary', label: 'BINARY' },
  { id: 'onUpdateCurrentTimestamp', label: 'ON UPDATE CURRENT_TIMESTAMP' },
]

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

/**
 * A blank starting row.
 *
 * Every row starts as an integer with NOTHING pre-filled beyond that, which is a change
 * from the earlier VARCHAR(255)-nullable-already-ticked row. Reported as three separate
 * complaints about 添加字段: the length arrived as a filled-in 255 so it looked typed by
 * the user and could not be left out, the type arrived as VARCHAR when a numeric key is
 * what a new column usually is, and 允许空 arrived TICKED so the form silently asked for
 * a nullable column. A default that decides three answers for the user is not a default,
 * it is an unasked-for decision — so nothing is decided here except "a column, for now an
 * integer", and the placeholder on the length field says 255 is the usual value.
 */
let nextRowId = 1
const blank = (kind: string, first: boolean): DraftColumn => ({
  id: nextRowId++,
  name: first ? 'id' : '',
  /*
   * SQLite spells the same idea INTEGER. `INT` is also an accepted type name there, but
   * INTEGER is the affinity it actually acts on (and the only one AUTOINCREMENT works
   * with), so the suggestion matches the engine rather than the MySQL habit.
   */
  type: kind === 'sqlite' ? 'INTEGER' : 'INT',
  // Empty, NOT '255'. The value is the user's to type; '255' lives in the placeholder.
  length: '',
  collate: '',
  attributes: [],
  // Unchecked: a new column is NOT NULL until the user says otherwise.
  nullable: false,
  // No default: that is what an empty field produced before, and it is the common case.
  defaultMode: 'none' as const,
  defaultText: '',
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
/**
 * Whether ANOTHER column already claims the table's single auto-increment slot.
 *
 * The form used to allow ticking a second 自增 and only refused at submit, with
 * "只能有一个自增字段，当前勾选了：id, seq" — reported by the user as "建表时可以选两个自增",
 * and reproduced: both boxes ended up ticked and nothing on screen mentioned the limit.
 *
 * Knowing about the OTHER rows is what this adds; `autoIncrementBlocker` cannot see them.
 * The UI uses it to disable the other checkboxes and say why, so the rule is enforced where
 * it is decided instead of after the form is filled in.
 */
function autoIncrementTakenBy(columns: DraftColumn[], self: DraftColumn): DraftColumn | undefined {
  return columns.find(column => column.id !== self.id && column.autoIncrement)
}

/** Whether an auto-increment column is expressible on this engine. */
function autoIncrementAllowed(kind: string, column: DraftColumn): boolean {
  return autoIncrementBlocker(kind, column) === undefined
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
  const { api, sourceId, schema, kind, existingTables, onClose, onCreated } = props
  const isSqlite = kind === 'sqlite'
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
      /*
       * A type MySQL cannot declare without parentheses, with none given.
       *
       * This became reachable the moment the length stopped being pre-filled with 255: the form
       * answers with the column that needs it, instead of letting the server answer with
       * "syntax error near 'NOT NULL'", which names neither the column nor the cause.
       *
       * MySQL only. SQLite accepts a bare `VARCHAR` (it stores the whole thing as the declared
       * type with no width), and its length field is DISABLED — requiring one there would ask
       * for something the form does not let the user type.
       */
      if (!isSqlite && requiresLengthOrValues(column.type) && column.length.trim() === '') {
        return { error: t('createTable.lengthRequired', { name: columnName, type: column.type.trim() }) }
      }

      /*
       * The default, as the engine should receive it.
       *
       * The mode decides the shape, and the three "empty-looking" cases are deliberately
       * different: `none` emits nothing, `custom` with no text emits `''`, and `null` emits
       * `NULL`. A single text field could not express that distinction — measured, a blank
       * field meant no DEFAULT at all, so "the empty string" was unreachable from the form.
       */
      /*
       * The default, as the engine should receive it.
       *
       * `defaultToWire` states the mode-to-value mapping once: the three "empty-looking" modes
       * are deliberately different (`none` emits nothing, `custom` with no text emits `''`, and
       * `null` emits `NULL`), and re-deriving that here would be a second place to get it wrong.
       * A single text field could not express the difference at all — measured, a blank field
       * meant no DEFAULT clause, so "the empty string" was unreachable from the form.
       */
      const defaultValue = defaultToWire(column.defaultMode, column.defaultText)

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
        // `{name}` is required by this template: a call without it renders the literal
        // "{name}" on screen. The locale guard now checks that too.
        return { error: t('createTable.autoNeedsNumeric', { name: columnName }) }
      }
      // An auto-increment column cannot also carry a default: both engines refuse it, and
      // the refusal does not say which of the two fields to drop.
      if (autoIncrement && defaultValue !== undefined) {
        return { error: t('createTable.autoIncrementDefault', { name: columnName }) }
      }
      if (column.indexKind === 'primary') key.push(columnName)
      if (column.indexKind !== '' && !indexKindAvailable(column.indexKind, column)) {
        // Each states what the index needs AND what this column is, so the fix is clear
        // without opening the server's own error.
        if (column.indexKind === 'fulltext') return { error: t('createTable.fulltextNeedsText', { name: columnName, type: column.type }) }
        if (column.indexKind === 'spatial') return { error: t('createTable.spatialNeedsGeometry', { name: columnName }) }
      }
      /*
       * 默认值 = NULL together with 允许空 unticked.
       *
       * MySQL refuses `v VARCHAR(50) NOT NULL DEFAULT NULL` with "Invalid default value for 'v'",
       * which names neither of the two fields that contradict each other. This became reachable
       * once a new column stopped arriving with 允许空 ticked: every added row is NOT NULL until
       * the user says otherwise, so 默认值 = NULL alone is now an easy mistake to make.
       *
       * The EFFECTIVE nullability is what matters, not the checkbox: a key column is forced NOT
       * NULL further down, so a row that was made nullable and then set as the PRIMARY key would
       * otherwise pass this check and still emit the statement MySQL refuses.
       */
      const effectiveNullable = column.indexKind === 'primary' ? false : column.nullable
      if (nullDefaultNeedsNullable(kind, effectiveNullable, column.defaultMode)) {
        return { error: t('createTable.nullDefaultNeedsNullable', { name: columnName }) }
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
        ...(defaultValue === undefined ? {} : { defaultValue }),
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

  /**
   * Which type cells are showing their text field instead of the dropdown.
   *
   * Keyed by column id and held here rather than on the column, because it is a view
   * state: whether the custom field is open is not part of the table being defined.
   */
  const [customTypeRows, setCustomTypeRows] = React.useState<Set<number>>(new Set())

  /** The grouped type dropdown, or the text field it swaps to, for one cell. */
  const typeCell = (column: DraftColumn, index: number): React.ReactElement => {
    const groups = TYPE_GROUPS[kind] ?? TYPE_GROUPS.mysql!
    const offered = groups.flatMap(group => group.types)
    const isListed = offered.includes(column.type)
    /*
     * Edit mode is VIEW state, and a blank type counts as editing.
     *
     * It used to also be true whenever the type was not in the list, which made the
     * back-to-list button pointless for a custom value: the select would immediately swap
     * back out to the text field. Keeping the two conditions separate is what lets a
     * custom value live in the list as its own entry.
     */
    const isCustom = customTypeRows.has(column.id) || column.type.trim() === ''

    if (isCustom) {
      return React.createElement(
        'div',
        { className: 'dbm-type-cell' },
        React.createElement('input', {
          className: 'dbm-input dbm-mono',
          value: column.type,
          placeholder: t('createTable.typeCustomPlaceholder'),
          'aria-label': t('createTable.typeText'),
          'data-dbm-newtable-coltype-text': String(index),
          spellcheck: false,
          // The element mounts when the cell switches to custom mode, so this focuses it
          // once — which is what makes typing immediately possible after choosing 自定义.
          autoFocus: true,
          onChange: (event: { target: { value: string } }) => patch(column.id, { type: event.target.value }),
        }),
        /*
         * A way back to the list.
         *
         * Without it, choosing 自定义 is one-way: the dropdown is gone and the only way to
         * a listed type is the 删除该字段 button. A small button rather than a second
         * dropdown, to keep the cell one control wide.
         *
         * It does NOT change the type: the first version reset it to the first listed
         * type, which silently discarded what the user had typed (measured: DECIMAL(10,2)
         * became TINYINT). The value is kept, and the list shows it as its own entry.
         */
        React.createElement('button', {
          type: 'button',
          className: 'dbm-btn dbm-btn-sm',
          title: t('createTable.typeBackToList'),
          'data-dbm-newtable-coltype-list': String(index),
          onClick: () => {
            setCustomTypeRows(current => {
              const next = new Set(current)
              next.delete(column.id)
              return next
            })
          },
        }, '↺'),
      )
    }

    return React.createElement(
      'select',
      {
        className: 'dbm-select dbm-mono',
        // A custom value has no option of its own, so it is represented by the synthetic
        // entry below; without that the controlled select would show an unrelated type
        // while the state still held the custom one.
        value: isListed ? column.type : '__customValue__',
        'aria-label': t('createTable.columnType'),
        'data-dbm-newtable-coltype': String(index),
        onChange: (event: { target: { value: string } }) => {
          const value = event.target.value
          if (value === '__custom__' || value === '__customValue__') {
            // Choosing the custom entry (or the current custom value) opens the text field
            // so it can be edited, rather than replacing it with anything.
            setCustomTypeRows(current => new Set(current).add(column.id))
            return
          }
          /*
           * Changing the type CLEARS a length the new type cannot take.
           *
           * A length belongs to the type, and carrying one across is how the form produced
           * `TIMESTAMP(255)` — a statement the server rejects with "Invalid default value for
           * 'v'", which points at the DEFAULT and says nothing about the length. Rows no longer
           * START with 255, but a user who typed one into VARCHAR and then switched the type will
           * otherwise carry it into a type that cannot hold it.
           */
          patch(column.id, {
            type: value,
            ...(takesLength(value) ? {} : { length: '' }),
          })
        },
      },
      [
        ...groups.map(group => React.createElement(
          'optgroup',
          { key: group.label, label: t(group.label as never) },
          ...group.types.map(value => React.createElement('option', { key: value, value }, value)),
        )),
        // The current custom value, kept selectable so returning to the list does not
        // discard it and the dropdown can still show what will be declared.
        isListed
          ? null
          : React.createElement('option', { key: '__customValue__', value: '__customValue__' }, `${column.type} ${t('createTable.typeCustomMark')}`),
        React.createElement('option', { key: '__custom__', value: '__custom__' }, t('createTable.typeCustom')),
      ].filter(entry => entry !== null),
    )
  }

  /**
   * The attribute dropdown for one column.
   *
   * A `multiple` select is the direct reading of "use a dropdown, not checkboxes", but
   * it is awkward with a mouse (ctrl-click to add) and its closed state shows only one
   * value. This keeps the dropdown shape and makes each option a TOGGLE, with the closed
   * state listing what is chosen — so `UNSIGNED ZEROFILL` is expressible and visible.
   *
   * Attributes the current type cannot carry are DISABLED and their option text says so,
   * rather than being hidden: a user who expects ZEROFILL on a text column is told why
   * they cannot have it.
   */
  /**
   * The 默认值 cell: a dropdown, which becomes a text field once 自定义 is chosen.
   *
   * Four states, because they are four different things:
   *   不设置      → no DEFAULT clause at all
   *   自定义 + 空  → DEFAULT '' (the empty string)
   *   自定义 + 文本 → DEFAULT 'text'
   *   NULL        → DEFAULT NULL
   *   CURRENT_TIMESTAMP → DEFAULT CURRENT_TIMESTAMP
   *
   * A plain text field could only express the third and part of the fourth, and left the
   * first three indistinguishable.
   *
   * The literal box REPLACES the dropdown rather than sitting beside it. It used to be
   * appended after it inside a flex cell (`.dbm-type-cell`), and in a 7%-wide column the two
   * controls squeezed each other down to nothing — reported as "填写值的框框和选择框都挤的看不
   * 见了". The mode is what decides which control belongs in the cell, so exactly one is
   * rendered and neither can crush the other; a small ↺ button is the way back to the list,
   * the same shape the 类型 cell already uses. The swap also focuses the box, which is the
   * phpMyAdmin behaviour that was asked for ("选择框在选择自定义后直接就可以输入").
   */
  const defaultCell = (column: DraftColumn, index: number): React.ReactElement => {
    if (column.defaultMode === 'custom') {
      return React.createElement(
        'div',
        { className: 'dbm-type-cell' },
        React.createElement('input', {
          className: 'dbm-input dbm-mono',
          value: column.defaultText,
          // Empty is a real answer here — it means the empty string — so the placeholder says
          // so instead of showing a "nothing" hint.
          placeholder: t('createTable.default.emptyString'),
          'aria-label': t('createTable.default.text'),
          'data-dbm-newtable-coldefault-text': String(index),
          spellcheck: false,
          // The box mounts when the cell switches to 自定义, so this focuses it once — which
          // is what makes typing possible straight after picking the entry.
          autoFocus: true,
          onChange: (event: { target: { value: string } }) => patch(column.id, { defaultText: event.target.value }),
        }),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dbm-btn dbm-btn-sm',
            title: t('createTable.default.backToList'),
            'data-dbm-newtable-coldefault-list': String(index),
            onClick: () => {
              /*
               * Back to the list AND back to 不设置.
               *
               * The dropdown's meaning IS the mode, so the mode has to move with it: leaving it
               * at `custom` while showing the list would emit `DEFAULT ''` for a cell that reads
               * as 不设置 — the one confusion this four-state design exists to prevent. What was
               * typed stays in `defaultText`, so choosing 自定义 again brings it back.
               */
              patch(column.id, { defaultMode: 'none' })
            },
          },
          '↺',
        ),
      )
    }

    return React.createElement(
      'select',
      {
        className: 'dbm-select',
        value: column.defaultMode,
        'aria-label': t('createTable.columnDefault'),
        'data-dbm-newtable-coldefault-mode': String(index),
        onChange: (event: { target: { value: string } }) => patch(column.id, { defaultMode: event.target.value as DefaultMode }),
      },
      [
        React.createElement('option', { key: 'none', value: 'none' }, t('common.none')),
        React.createElement('option', { key: 'custom', value: 'custom' }, t('createTable.default.custom')),
        React.createElement('option', { key: 'null', value: 'null' }, 'NULL'),
        // Only offered for a type that accepts it. MySQL refuses it elsewhere with
        // "Invalid default value", measured on VARCHAR and INT. The rule comes from the shared
        // module so the form and any test read the same one.
        React.createElement(
          'option',
          { key: 'currentTimestamp', value: 'currentTimestamp', disabled: !supportsCurrentTimestamp(column.type) },
          supportsCurrentTimestamp(column.type)
            ? 'CURRENT_TIMESTAMP'
            : `CURRENT_TIMESTAMP（${t('createTable.default.needsTemporal')}）`,
        ),
      ],
    )
  }

  const attributeSelect = (column: DraftColumn, index: number): React.ReactElement => {
    const chosen = column.attributes
    const summary = chosen.length === 0
      ? t('common.none')
      : chosen.map(id => ATTRIBUTE_ITEMS.find(item => item.id === id)?.label ?? id).join(' ')
    return React.createElement(
      'select',
      {
        className: 'dbm-select',
        // The select's own value is unused (options are toggles), so it always shows the
        // placeholder; the summary is rendered as the option text below.
        value: '',
        'aria-label': t('createTable.columnAttributes'),
        'data-dbm-newtable-attr-select': String(index),
        title: t('createTable.attributesHint'),
        onChange: (event: { target: { value: string } }) => {
          const value = event.target.value as ColumnAttribute | '__clear__'
          if (value === '__clear__') { patch(column.id, { attributes: [] }); return }
          const next = chosen.includes(value) ? chosen.filter(entry => entry !== value) : [...chosen, value]
          patch(column.id, { attributes: next })
        },
      },
      [
        React.createElement('option', { key: '__summary__', value: '' }, summary),
        ...ATTRIBUTE_ITEMS.map(item => {
          const available = attributeAvailable(item.id, column)
          return React.createElement(
            'option',
            {
              key: item.id,
              value: item.id,
              disabled: !available,
              // The reason is the option's own text, so it is readable in the open list
              // instead of hidden in a tooltip.
              'data-dbm-newtable-attr-option': `${index}:${item.id}`,
            },
            available
              ? `${chosen.includes(item.id) ? '✓ ' : ''}${item.label}`
              : `${item.label} — ${t('createTable.attributeUnavailable')}`,
          )
        }),
        chosen.length === 0
          ? null
          : React.createElement('option', { key: '__clear__', value: '__clear__' }, t('createTable.attributesClear')),
      ].filter(entry => entry !== null),
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
  const rowFor = (column: DraftColumn, index: number): React.ReactElement => {
    const autoBlocker = autoIncrementBlocker(kind, column)
    // Another column already has 自增. This row's checkbox is disabled so the second one
    // cannot be ticked at all.
    const autoHolder = column.autoIncrement ? undefined : autoIncrementTakenBy(columns, column)
    /**
     * The sentence shown when 自增 cannot be used; nothing when it can.
     *
     * ON SCREEN, not in a title, for the rules the user has to act on: a checkbox that cannot
     * be ticked and gives no reason in text is a control that looks broken.
     *
     * The "another column already has it" case is deliberately NOT one of them. It is
     * self-evident from the form — one row's box is ticked, this one is not — and the sentence
     * naming that column sat under every other row of the table, reported as noise to delete.
     * Its explanation lives in the checkbox's `title` instead: available when asked for, out
     * of the way when not.
     */
    const autoHint = autoHolder !== undefined
      ? null
      : autoBlocker === undefined
        ? null
        : autoBlocker === 'notKey'
          ? t('createTable.autoNeedsKey')
          : autoBlocker === 'notInteger'
            ? t('createTable.autoNeedsInteger', { name: column.name.trim() === '' ? t('createTable.thisColumn') : column.name.trim() })
            : t('createTable.autoNeedsNumeric', { name: column.name.trim() === '' ? t('createTable.thisColumn') : column.name.trim() })

    return React.createElement(
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
      /*
       * 类型: a GROUPED dropdown, which swaps to a text field IN THE SAME CELL.
       *
       * Grouped because a flat list of thirty types is hard to scan and the choice is
       * two-step ("a number, then which"). The custom entry is needed because MySQL
       * accepts more type text than any list holds (`decimal(10,2) unsigned`,
       * `enum('a','b')`) and SQLite accepts essentially anything.
       *
       * The swap is in place rather than a separate column: the form is already wide and
       * width was the complaint, so the custom affordance must not add a column.
       */
      React.createElement('td', null, typeCell(column, index)),
      /* 长度/值 */
      /*
       * The length is the USER's to type: the field starts EMPTY and 255 is only the
       * placeholder. It used to arrive pre-filled with 255, which made the value look like
       * something the form had decided — reported as "长度/值新增一个条目时不要默认 255，让用户
       * 自己填". A placeholder carries the same hint without putting a value in the payload.
       */
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
      /* 属性: a dropdown, as asked */
      React.createElement('td', null, attributeSelect(column, index)),
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
      /*
       * 默认值: a dropdown, with a text field shown only for 自定义.
       *
       * The four options are the four things a default can be, and they were not all
       * reachable with one text field: leaving it blank meant NO default clause (an omitted
       * column then inserts NULL), so "the empty string" could not be asked for at all, and
       * NULL was only expressible by knowing to type the word.
       *
       * The text field appears in the same cell rather than as another column, because the
       * form is already wide.
       */
      React.createElement('td', null, defaultCell(column, index)),
      /*
       * 自增, WITH ITS REASON ON SCREEN for the rules the user must act on.
       *
       * The combination the engine cannot express is still refused, but the user is told what
       * to change instead of facing a control that silently does nothing. "Another column
       * already has it" is the exception: it is visible in the form itself, so it explains
       * itself through the checkbox's title rather than a sentence under every row.
       */
      React.createElement('td', { className: 'dbm-auto-cell' },
        /*
         * The explanation rides on the LABEL, not the checkbox.
         *
         * A `disabled` input does not fire mouse events, so its own `title` does not reliably
         * appear — measured earlier in this form, which is why the reasons were moved to
         * visible text in the first place. The label is not disabled, so hovering the cell
         * still answers "why is this box greyed out?" without a sentence under every row.
         */
        React.createElement('label', {
          className: 'dbm-check',
          title: autoHolder === undefined
            ? undefined
            : t('createTable.autoAlreadyTaken', { name: autoHolder.name.trim() === '' ? t('createTable.thisColumn') : autoHolder.name.trim() }),
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: column.autoIncrement,
            disabled: autoBlocker !== undefined || autoHolder !== undefined,
            'data-dbm-newtable-auto': String(index),
            // Only one column may own it, so every other row's checkbox is disabled rather
            // than left clickable until submit.
            'data-dbm-newtable-auto-blocked-by': autoHolder === undefined ? undefined : 'other',
            onChange: (event: { target: { checked: boolean } }) => patch(column.id, { autoIncrement: event.target.checked }),
          }),
        ),
        autoHint === null
          ? null
          : React.createElement(
              'div',
              { className: 'dbm-hint dbm-auto-hint', 'data-dbm-newtable-auto-hint': String(index) },
              autoHint,
            ),
      ),
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
  }

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
    /* ---- the table itself ------------------------------------------------ *
     *
     * One grid: label on the left, control on the right, two fields per row. The dialog
     * is wide enough for two, and a single column of fields at this width left long empty
     * stretches beside every control.
     */
    React.createElement(
      'div',
      { className: 'dbm-grid2' },
      React.createElement(
        'div',
        { className: 'dbm-grid-row' },
        React.createElement('label', { className: 'dbm-grid-label', htmlFor: 'dbm-newtable-name' }, t('createTable.tableName')),
        React.createElement('input', {
          className: 'dbm-input dbm-mono dbm-grid-control',
          id: 'dbm-newtable-name',
          value: name,
          placeholder: 'my_table',
          'aria-label': t('createTable.tableName'),
          'data-dbm-newtable-name': '',
          spellcheck: false,
          autoFocus: true,
          onChange: (event: { target: { value: string } }) => setName(event.target.value),
        }),
      ),
      React.createElement(
        'div',
        { className: 'dbm-grid-row' },
        React.createElement('label', { className: 'dbm-grid-label', htmlFor: 'dbm-newtable-tablecomment' }, t('createTable.tableComment')),
        React.createElement('input', {
          className: 'dbm-input dbm-grid-control',
          id: 'dbm-newtable-tablecomment',
          value: tableComment,
          disabled: isSqlite,
          placeholder: isSqlite ? t('createTable.sqliteNoTableCommentShort') : t('common.none'),
          'data-dbm-newtable-tablecomment': '',
          title: isSqlite ? t('createTable.sqliteNoTableComment') : t('createTable.tableCommentHint'),
          onChange: (event: { target: { value: string } }) => setTableComment(event.target.value),
        }),
      ),
      React.createElement(
        'div',
        { className: 'dbm-grid-row' },
        React.createElement('label', { className: 'dbm-grid-label', htmlFor: 'dbm-newtable-tableengine' }, t('createTable.tableEngine')),
        isSqlite
          ? React.createElement('input', {
              className: 'dbm-input dbm-mono dbm-grid-control',
              id: 'dbm-newtable-tableengine',
              value: '',
              disabled: true,
              placeholder: t('createTable.sqliteNoEngineShort'),
              'data-dbm-newtable-tableengine': '',
              title: t('createTable.sqliteNoEngine'),
            })
          : React.createElement(
              'select',
              {
                className: 'dbm-select dbm-grid-control',
                id: 'dbm-newtable-tableengine',
                value: tableEngine,
                'data-dbm-newtable-tableengine': '',
                onChange: (event: { target: { value: string } }) => setTableEngine(event.target.value),
              },
              ENGINES.map(value => React.createElement('option', { key: value, value }, value)),
            ),
      ),
      React.createElement(
        'div',
        { className: 'dbm-grid-row' },
        React.createElement('label', { className: 'dbm-grid-label', htmlFor: 'dbm-newtable-tablecollate' }, t('createTable.tableCollate')),
        isSqlite
          ? React.createElement('input', {
              className: 'dbm-input dbm-mono dbm-grid-control',
              id: 'dbm-newtable-tablecollate',
              value: '',
              disabled: true,
              placeholder: t('createTable.sqliteNoTableCollateShort'),
              'data-dbm-newtable-tablecollate': '',
              title: t('createTable.sqliteNoTableCollate'),
            })
          : React.createElement(
              'select',
              {
                className: 'dbm-select dbm-grid-control',
                id: 'dbm-newtable-tablecollate',
                value: tableCollate,
                'data-dbm-newtable-tablecollate': '',
                onChange: (event: { target: { value: string } }) => setTableCollate(event.target.value),
              },
              collationList.map(value => React.createElement('option', { key: value === '' ? '__none__' : value, value }, value === '' ? t('createTable.tableCollateDefault') : value)),
            ),
      ),
      /*
       * SQLite's own trailing keywords, which have no MySQL equivalent. Two checkboxes in
       * ONE grid row, so the grid's column count stays even.
       */
      isSqlite
        ? React.createElement(
            'div',
            { className: 'dbm-grid-row' },
            React.createElement('span', { className: 'dbm-grid-label' }, t('createTable.tableTail')),
            React.createElement(
              'div',
              { className: 'dbm-grid-control dbm-check-group' },
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
            ),
          )
        : null,
    ),

    /* ---- the columns ---- */
    React.createElement(
      'div',
      { className: 'dbm-field' },
      React.createElement('label', { className: 'dbm-field-label' }, t('createTable.columns')),
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
      /*
       * The default-value explanation, where the control is.
       *
       * "No default" and "the empty string" look the same in a form and are not the same in
       * the database, so the difference is stated rather than left to be discovered.
       */
      React.createElement('div', { className: 'dbm-hint' }, t('createTable.default.hint')),
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
