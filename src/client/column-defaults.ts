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
 * Used to drop a stale length when the type changes. The form's rows now start with an EMPTY
 * length, but changing a filled-in one still has to be dropped: switching `VARCHAR(255)` to a
 * type without a character width left `TIMESTAMP(255)` behind — which MySQL refuses with
 * "Invalid default value for 'v'", a message about the DEFAULT that says nothing about the
 * length.
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
 * Types MySQL REFUSES without parentheses, measured one by one against 8.0.
 *
 * The form no longer pre-fills the length with 255 (the value is the user's to type), which
 * makes this reachable in a way it was not before: pick VARCHAR, type a name, submit — and the
 * engine answers with
 *
 *   You have an error in your SQL syntax; check the manual ... near 'NOT NULL',
 *
 * a message that names neither the column nor the missing length. Measured on 8.0:
 *
 *   VARCHAR, VARBINARY, ENUM, SET  → syntax error with no parentheses
 *   CHAR, BINARY, DECIMAL, FLOAT, DOUBLE, INT, BIGINT, TEXT, BLOB,
 *   TIMESTAMP, DATETIME, BIT       → accepted with no parentheses
 *
 * `CHAR` and `BINARY` are the surprising ones: both DEFAULT to 1, so a bare `CHAR` is legal.
 * Only the four above are genuinely required, and guessing a default for them (`VARCHAR` → 255)
 * is exactly what the form just stopped doing — so the form asks instead.
 *
 * A type that already carries its own parentheses needs nothing: `enum('a','b')` and
 * `varchar(30)` are complete types, and the driver already ignores a separate length for them
 * rather than rendering `VARCHAR(30)(255)`.
 */
const REQUIRES_PARENS_TYPES = /^(VARCHAR|VARBINARY|ENUM|SET)\b/

/**
 * Whether a type still needs the user to supply a length or value list.
 *
 * @param type - the declared type, which may be free text.
 * @returns true when the statement would be a syntax error without parentheses.
 */
export function requiresLengthOrValues(type: string): boolean {
  const upper = type.trim().toUpperCase()
  if (upper === '') return false
  // A type that carries its own parentheses is already complete.
  if (upper.includes('(')) return false
  return REQUIRES_PARENS_TYPES.test(upper)
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

/**
 * Which mode and text an EXISTING column's reported default corresponds to.
 *
 * Exists so the 结构 tab's column editor can offer the same four-state control the
 * 新建表 form does (不设置 / 自定义 / NULL / CURRENT_TIMESTAMP) while editing a column
 * that already has one. Without it the editor has only a text box, and a column whose
 * default IS the empty string is indistinguishable from one with no default at all —
 * measured: `DEFAULT ''` renders as an empty box, and submitting that box drops the
 * default to NULL.
 *
 * The two engines report the same value in DIFFERENT forms, which is why this takes
 * the engine:
 *
 *   MySQL     `''` → `''` as a value   `'x'` → `x`      `NULL` → (absent)
 *   SQLite    `''` → `''` (quoted)     `'x'` → `'x'`    `NULL` → `NULL`
 *
 * MySQL strips the quotes and reports `DEFAULT NULL` as no value at all; SQLite keeps
 * the literal text and reports `NULL` explicitly. A single rule would misread one of
 * them — SQLite's `''` is a two-character string that must not be shown as an empty box
 * meaning "no default", and MySQL's `NULL`-as-absent must not be shown as the empty
 * string.
 *
 * `text` is returned in the form the user should see and edit, which for a string is
 * unquoted: the quoting is `defaultToWire`'s job, and showing `'x'` in a box labelled
 * 自定义 invites the user to type the quotes themselves.
 */
export function inferDefault(kind: string, raw: string | undefined): { mode: DefaultMode; text: string } {
  if (raw === undefined) return { mode: 'none', text: '' }
  const text = raw.trim()
  if (text === '') {
    // MySQL's way of reporting `DEFAULT ''`: present, and an empty string.
    return kind === 'mysql' ? { mode: 'custom', text: '' } : { mode: 'none', text: '' }
  }
  if (/^null$/i.test(text)) return { mode: 'null', text: '' }
  if (/^current_timestamp(\(\d*\))?$/i.test(text)) return { mode: 'currentTimestamp', text: '' }
  // SQLite keeps a string's quotes; MySQL has already stripped them.
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return { mode: 'custom', text: text.slice(1, -1).replace(/''/g, "'") }
  }
  // A number, keyword or expression: shown verbatim, and re-emitted verbatim.
  return { mode: 'custom', text }
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

/**
 * Whether `DEFAULT NULL` on a NOT NULL column is a combination the engine refuses.
 *
 * Measured on MySQL 8.0: `v VARCHAR(50) NOT NULL DEFAULT NULL` is refused with "Invalid default
 * value for 'v'" — a message that names neither 允许空 nor the fact that the two settings
 * contradict each other. SQLite ACCEPTS the same DDL (measured; it only fails at INSERT time),
 * so this is deliberately MySQL-only rather than applied to both.
 *
 * This became reachable when 允许空 stopped arriving ticked on a new row: every added column is
 * NOT NULL until the user says otherwise, so a user who picks 默认值 = NULL without also ticking
 * 允许空 is asking for two settings that cannot both hold. The form answers with both fields
 * named, instead of letting the server answer with a message about the DEFAULT alone.
 *
 * @param kind - the engine, since the two do not agree.
 * @param nullable - whether the column accepts NULL (允许空).
 * @param mode - the chosen default mode.
 */
export function nullDefaultNeedsNullable(kind: string, nullable: boolean, mode: DefaultMode): boolean {
  if (kind === 'sqlite') return false
  return mode === 'null' && !nullable
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
