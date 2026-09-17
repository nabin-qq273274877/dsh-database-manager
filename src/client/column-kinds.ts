/**
 * How a column's declared type decides which control it gets, and which
 * comparison operators it can be searched with.
 *
 * Deliberately free of React and of any i18n: the rules are the whole point of
 * this module, and they are the part worth testing directly. A component that
 * inlined them would only be reachable through a browser, which is where a
 * wrong classification shows up as the wrong input on a form rather than as a
 * failed assertion.
 *
 * Everything here reads the DECLARED type text, with one exception: an enum's
 * members come from the wire. They cannot be parsed reliably on the client —
 * `enum('a''b')` needs MySQL's own quoting rules — so the host reports them.
 */

import type { ColumnInfo, RowFilterOperator } from '../protocol.ts'
import { ROW_FILTER_OPERATORS, UNARY_FILTER_OPERATORS } from '../protocol.ts'

/** Which kind of control a column's type deserves. */
export type FieldKind =
  | { kind: 'enum'; options: string[] }
  | { kind: 'boolean' }
  | { kind: 'number'; integer: boolean }
  | { kind: 'date' }
  | { kind: 'datetime' }
  | { kind: 'time' }
  | { kind: 'text'; maxLength?: number; multiline: boolean }
  | { kind: 'binary' }

/** Decide which control a column's declared type gets. */
export function fieldKind(column: ColumnInfo): FieldKind {
  // An enum's members decide the control before the type name does: MySQL spells
  // it `enum('a','b')` and the list is exactly what the user may choose from.
  if (column.options !== undefined && column.options.length > 0) {
    return { kind: 'enum', options: column.options }
  }
  const type = column.type.trim().toLowerCase()
  if (/^(bool|boolean)$/.test(type)) return { kind: 'boolean' }
  // MySQL's conventional boolean is `TINYINT(1)`. A different width is a number:
  // treating `TINYINT(4)` as a flag would offer two choices for a small integer.
  if (/^tinyint\(1\)/.test(type)) return { kind: 'boolean' }
  if (/^(tiny|small|medium|big)?(int|year)/.test(type)) return { kind: 'number', integer: true }
  if (/^(decimal|numeric|float|double|real|bit)/.test(type)) return { kind: 'number', integer: false }
  if (/^date$/.test(type)) return { kind: 'date' }
  if (/^datetime|^timestamp/.test(type)) return { kind: 'datetime' }
  if (/^time$/.test(type)) return { kind: 'time' }
  if (/blob|binary/.test(type)) return { kind: 'binary' }
  const maxLength = /\((\d{1,6})\)/.exec(type)?.[1]
  return {
    kind: 'text',
    ...(maxLength === undefined ? {} : { maxLength: Number(maxLength) }),
    // A `TEXT`/`JSON` column holds prose or a document, so it gets a textarea;
    // a bounded `VARCHAR` gets one line with the length enforced.
    multiline: /(text|json|clob)/.test(type),
  }
}

/** Whether a declared type is an ordered number. */
export function isNumericType(type: string): boolean {
  return /^(tiny|small|medium|big)?(int|decimal|numeric|float|double|real|bit|year)\b/i.test(type.trim())
}

/** Whether a declared type is temporal. */
export function isDateType(type: string): boolean {
  return /^(date|datetime|timestamp|time)\b/i.test(type.trim())
}

/** Whether a declared type is boolean-ish. */
export function isBooleanType(type: string): boolean {
  return /^(bool|boolean)\b/i.test(type.trim())
}

/** Whether a declared type is textual (what a `LIKE` search makes sense on). */
export function isTextualType(type: string): boolean {
  return /char|text|enum|set|json|blob|binary|uuid/i.test(type)
}

/**
 * The comparison operators that make sense for a column's declared type.
 *
 * An ordered type gets the range operators and NOT `contains`: a `LIKE` on an int
 * casts every row, which cannot use an index and answers a different question
 * than the one a range asks. A textual type gets the pattern operators instead.
 * A type this module does not recognise gets everything, since refusing an
 * operator the engine would accept is worse than offering one that returns
 * nothing.
 */
export function operatorsFor(type: string): RowFilterOperator[] {
  if (isNumericType(type) || isDateType(type)) {
    return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'isNull', 'isNotNull']
  }
  if (isTextualType(type)) {
    return ['contains', 'notContains', 'startsWith', 'endsWith', 'eq', 'neq', 'in', 'isNull', 'isNotNull']
  }
  return [...ROW_FILTER_OPERATORS]
}

/** Whether an operator takes no operand (so its input field is hidden). */
export function isUnaryOperator(operator: RowFilterOperator): boolean {
  return UNARY_FILTER_OPERATORS.includes(operator)
}

/**
 * The `type` / `inputMode` attributes a browser needs for a column's type.
 *
 * Returns attributes rather than a value: the point is to hand the user the
 * platform's own date picker and numeric keyboard, which is what keeps a typed
 * date in the format the engine parses.
 */
export function inputHints(column: ColumnInfo): Record<string, string> {
  const type = column.type.trim().toLowerCase()
  if (/^(tiny|small|medium|big)?(int|bit|year)/.test(type)) return { inputMode: 'numeric' }
  if (/^(decimal|numeric|float|double|real)/.test(type)) return { inputMode: 'decimal' }
  if (/^date$/.test(type)) return { type: 'date' }
  if (/^datetime|^timestamp/.test(type)) return { type: 'datetime-local' }
  if (/^time$/.test(type)) return { type: 'time' }
  return {}
}

/**
 * Whether the engine assigns this column's value when an insert omits it.
 *
 * Two different mechanisms, so the check is per engine rather than a single
 * "does EXTRA mention auto_increment": SQLite has no `EXTRA` at all — its
 * self-assigning column is the `INTEGER PRIMARY KEY` rowid alias — while MySQL
 * reports `AUTO_INCREMENT` there. Reading either marker on the other engine
 * would claim a blank field is correct for a column that needs a value.
 */
export function autoAssigns(kind: string, column: ColumnInfo): boolean {
  if (kind === 'sqlite') {
    if (column.key !== 'PRI' || column.primaryKeyPosition !== 1) return false
    // Exactly `INTEGER`, not `INT`: only that declared type is a rowid alias.
    return column.type.trim().toLowerCase().replace(/\s+/g, ' ') === 'integer'
  }
  if (kind === 'mysql') {
    return column.extra !== undefined && /auto_increment/i.test(column.extra)
  }
  return false
}
