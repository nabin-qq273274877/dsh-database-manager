/**
 * The 新建表 form's default-value rules, and the auto-increment rule, as plain functions.
 *
 * Deliberately free of React and i18n, following `column-kinds.ts`: these are the rules worth
 * testing directly, and a component that inlined them would only be reachable through a
 * browser — where a wrong rule shows up as a confusing server error rather than as a failed
 * assertion.
 *
 * The default-value modes exist because four different things were collapsed into one text
 * field, and two of them are indistinguishable on screen:
 *
 *   `none`            no DEFAULT clause; an INSERT that omits the column stores NULL
 *   `custom` + ''     DEFAULT '' — the EMPTY STRING, which is not NULL
 *   `custom` + text   DEFAULT 'text'
 *   `null`            DEFAULT NULL
 *   `currentTimestamp` DEFAULT CURRENT_TIMESTAMP
 *
 * Measured on MySQL: a blank text field produced no DEFAULT clause at all, so the empty string
 * was unreachable from the form even though it is a different value in the database.
 */

import type { ColumnAttribute } from '../protocol.ts'

/** Which kind of default a column has. */
export type DefaultMode = 'none' | 'custom' | 'null' | 'currentTimestamp'

/** Every mode, in the order the dropdown lists them. */
export const DEFAULT_MODES: readonly DefaultMode[] = ['none', 'custom', 'null', 'currentTimestamp']

/** Types that accept `DEFAULT CURRENT_TIMESTAMP` (MySQL refuses it elsewhere). */
const TEMPORAL_TYPES = /\b(TIMESTAMP|DATETIME)\b/i

/** Types that take a character length. */
const NO_LENGTH_TYPES = /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DATE|TIME|TIMESTAMP|DATETIME|YEAR|JSON|BOOLEAN|BOOL|GEOMETRY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT)\b/

/**
 * Whether a declared type takes a length / values suffix.
 *
 * Used to drop a stale length when the type changes. The form's rows start as VARCHAR with 255
 * filled in, so switching to a type without a character width left `TIMESTAMP(255)` behind —
 * which MySQL refuses with "Invalid default value for 'v'", a message about the DEFAULT that
 * says nothing about the length.
 *
 * The temporal types do accept a fractional-seconds precision (`TIMESTAMP(6)`), but that is a
 * different number with a different meaning, so carrying 255 into it is never intended.
 */
export function takesLength(type: string): boolean {
  const upper = type.trim().toUpperCase()
  if (upper === '') return true
  return !NO_LENGTH_TYPES.test(upper)
}

/**
 * Whether `DEFAULT CURRENT_TIMESTAMP` may be offered for a type.
 *
 * MySQL refuses it on anything else ("Invalid default value"), measured on VARCHAR and INT.
 * SQLite accepts the word but has no such default for a non-temporal column in practice, so the
 * rule is applied to both engines rather than special-cased.
 */
export function supportsCurrentTimestamp(type: string): boolean {
  return TEMPORAL_TYPES.test(type)
}

/**
 * Render a custom default as something the host's validator accepts.
 *
 * 自定义 means "use this literal", so the text is quoted as a STRING — including when empty,
 * which is how `DEFAULT ''` becomes expressible. Two exceptions, both because the user is
 * plainly asking for something that is not a string:
 *
 *   - text already wrapped in single quotes passes through as typed, so an explicit `'abc'` is
 *     respected rather than double-quoted;
 *   - a plain number passes through unquoted, because `DEFAULT '0'` and `DEFAULT 0` differ for a
 *     numeric column.
 *
 * The host's `normalizeDefault` remains the authority and refuses anything else; this only
 * decides which of the two obvious readings to send.
 */
export function quoteDefaultLiteral(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(trimmed)) return trimmed
  // A quote inside the value is doubled, which is how both engines escape one.
  return `'${trimmed.replace(/'/g, "''")}'`
}

/**
 * The `defaultValue` to send for a column, or undefined for no DEFAULT clause.
 *
 * One function so the mode-to-wire mapping is stated once: the three "empty-looking" modes are
 * deliberately different, and a caller that re-derived them would be a second place to get it
 * wrong.
 */
export function defaultToWire(mode: DefaultMode, text: string): string | undefined {
  if (mode === 'none') return undefined
  if (mode === 'null') return 'NULL'
  if (mode === 'currentTimestamp') return 'CURRENT_TIMESTAMP'
  return quoteDefaultLiteral(text)
}

/** Why an auto-increment column is not possible, or undefined when it is. */
export type AutoIncrementBlocker = 'notKey' | 'notInteger' | 'notNumeric'

/** The bits of a draft column the auto-increment rule needs. */
export interface AutoIncrementInput {
  indexKind: string
  type: string
}

/** Types that can be AUTO_INCREMENT. */
const NUMERIC_TYPES = /\b(INT|INTEGER|TINYINT|SMALLINT|MEDIUMINT|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|BIT)\b/i

/**
 * Why an auto-increment column is not possible here, or undefined when it is.
 *
 * Measured against MySQL, which is more permissive than a "must be PRIMARY" rule:
 * an auto column must be A key (UNIQUE or a plain INDEX suffices), be numeric, and — inside a
 * composite key — LEAD it. SQLite is stricter still: it has one rowid, so the column must BE the
 * whole primary key.
 *
 * Returning the REASON rather than a boolean is what lets the form show it as text; a boolean
 * could only disable the checkbox, and a disabled control with the reason in a `title` gives the
 * user nothing to act on.
 */
export function autoIncrementBlocker(kind: string, column: AutoIncrementInput): AutoIncrementBlocker | undefined {
  if (column.indexKind !== 'primary') return 'notKey'
  if (kind === 'sqlite') return column.type.trim().toUpperCase() === 'INTEGER' ? undefined : 'notInteger'
  if (!NUMERIC_TYPES.test(column.type) && !/\bINTEGER\b/i.test(column.type)) return 'notNumeric'
  return undefined
}

/** Attributes that only apply to some types. */
export function attributeAllowed(attribute: ColumnAttribute, type: string): boolean {
  const isNumeric = NUMERIC_TYPES.test(type)
  const isString = /\b(CHAR|VARCHAR|TEXT|BLOB|BINARY|VARBINARY|ENUM|SET)\b/i.test(type)
  const isTemporal = TEMPORAL_TYPES.test(type)
  switch (attribute) {
    case 'unsigned':
    case 'zerofill':
      return isNumeric
    case 'binary':
      return isString
    case 'onUpdateCurrentTimestamp':
      return isTemporal
    default:
      return false
  }
}
