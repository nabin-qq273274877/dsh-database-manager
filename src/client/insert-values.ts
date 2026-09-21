/**
 * The 插入 tab's field model, and the rules that turn filled-in forms into the
 * values that go on the wire.
 *
 * phpMyAdmin's insert page is the reference here: every column is ONE ordinary
 * row — its name on the left, a control that suits its declared type on the
 * right — and the user types or picks in it directly. There is no "choose a mode
 * first" step, because a control that has to be unlocked before it can be typed
 * into reads as a broken form rather than as one asking a question.
 *
 * The several things a blank control could mean are therefore separated by the
 * CONTROLS BESIDE it instead of by a mode in front of it:
 *
 *   untouched            the column is left out of the INSERT entirely, so the
 *                        engine applies its own DEFAULT (or NULL). This is the
 *                        only reading of an untouched box that is never wrong.
 *   NULL ticked          the column is sent as SQL NULL. phpMyAdmin's "Null".
 *   empty-string ticked  the column is sent as ''. Offered only where that value
 *                        is otherwise UNREACHABLE — a textual NOT NULL column
 *                        with no default, where a blank box cannot be told apart
 *                        from a deliberate empty string. Sending '' for a numeric
 *                        column is an error about the wrong thing, which is why
 *                        the choice is not offered there.
 *
 * Deliberately free of React and of i18n, following `column-kinds.ts` and
 * `column-defaults.ts`: these are the rules worth testing directly, and one
 * inlined into a component is only reachable through a browser. Failures come
 * back as a reason code rather than as a sentence, so the component owns the
 * wording.
 */

import type { ColumnInfo } from '../protocol.ts'
import { autoAssigns, fieldKind } from './column-kinds.ts'

/** One column's value in one form, as the user left it. */
export interface FieldValue {
  /** What was typed; `''` means nothing was. */
  text: string
  /** `value` sends `text`, `null` sends SQL NULL, `empty` sends the empty string. */
  kind: 'value' | 'null' | 'empty'
}

/** One column/value pair, the shape the API takes. */
export interface InsertValue {
  column: string
  value: string | null
}

/**
 * Why one form cannot be sent.
 *
 * A code plus the column it is about, not a rendered sentence: the component
 * knows the language and this module does not.
 */
export type RowFailure =
  | { reason: 'required'; column: string }
  | { reason: 'notNumber'; column: string }
  | { reason: 'tooLong'; column: string; max: number }

/**
 * How many value forms one submit may carry.
 *
 * The route accepts 5000 rows in a batch, but that ceiling exists for CSV
 * imports. Fifty forms is already more than anyone fills in by hand, and the
 * limit is here so a mistyped 99999 cannot commit the browser to rendering
 * 99999 rows of controls.
 */
export const MAX_INSERT_FORMS = 50

/** A field the user has not touched. */
export function blankField(): FieldValue {
  return { text: '', kind: 'value' }
}

/**
 * Whether an untouched control for this column means "leave the column out".
 *
 * True when somebody else can supply the value: the engine's DEFAULT, NULL, or
 * the engine's own assignment (SQLite's rowid alias, MySQL's AUTO_INCREMENT). A
 * NOT NULL column with no default and no auto-assignment is the one case where a
 * blank box is a missing value rather than a deliberate omission.
 */
export function mayOmit(engine: string, column: ColumnInfo): boolean {
  return column.nullable || column.defaultValue !== undefined || autoAssigns(engine, column)
}

/**
 * Whether this column needs the explicit "empty string" choice.
 *
 * Only a textual NOT NULL column with no default can be sent `''` in a way the
 * user could not reach by typing: type nothing and the value is missing (which
 * is an error), so without this choice the empty string simply would not be
 * insertable from the form. Every other column either has a default to fall back
 * on, accepts NULL, or would reject `''` outright.
 */
export function needsEmptyChoice(column: ColumnInfo): boolean {
  if (column.nullable || column.defaultValue !== undefined) return false
  return fieldKind(column).kind === 'text'
}

/**
 * Validate and convert ONE form into the wire payload.
 *
 * An empty result (`values.length === 0`) means every column was left out — an
 * untouched form, not "insert a row of defaults". The caller decides what that
 * means, because "the form you are looking at is empty" and "one of the five
 * forms you filled in is empty" are different things to say.
 */
export function buildRow(
  engine: string,
  columns: ColumnInfo[],
  fields: Record<string, FieldValue>,
): { values: InsertValue[] } | { failure: RowFailure } {
  const values: InsertValue[] = []
  for (const column of columns) {
    const field = fields[column.name] ?? blankField()
    if (field.kind === 'null') {
      if (!column.nullable) return { failure: { reason: 'required', column: column.name } }
      values.push({ column: column.name, value: null })
      continue
    }
    if (field.kind === 'empty') {
      values.push({ column: column.name, value: '' })
      continue
    }
    if (field.text === '') {
      // Nothing typed: leave the column out so the engine supplies it, unless
      // nothing can supply it — then say which column is missing rather than
      // letting the engine report it about a placeholder.
      if (!mayOmit(engine, column)) return { failure: { reason: 'required', column: column.name } }
      continue
    }
    const kind = fieldKind(column)
    if (kind.kind === 'number') {
      const text = field.text.trim()
      // The engine would accept some of these (MySQL coerces '12abc' to 12 with
      // a warning); refusing here is what keeps a typo from being stored as a
      // different number than the one on screen.
      if (!(kind.integer ? /^-?\d+$/ : /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/).test(text)) {
        return { failure: { reason: 'notNumber', column: column.name } }
      }
    }
    if (kind.kind === 'text' && kind.maxLength !== undefined && [...field.text].length > kind.maxLength) {
      return { failure: { reason: 'tooLong', column: column.name, max: kind.maxLength } }
    }
    values.push({ column: column.name, value: field.text })
  }
  return { values }
}

/**
 * What one grid row turned into: the values to fill in, and what could not be
 * carried over.
 *
 * `skipped` is reported rather than left implicit because a column that silently
 * arrives blank is indistinguishable from one whose value WAS blank — and the
 * user is about to submit a row believing it matches the one they copied. Only
 * columns whose value is actually lost are listed; an auto-assigned column is
 * deliberately blank and is therefore NOT in this list.
 */
export interface PrefillResult {
  values: Record<string, FieldValue>
  /** Columns whose value could not be carried over, in table order. */
  skipped: string[]
}

/**
 * One row from the 浏览 grid, turned into a filled-in insert form.
 *
 * This is phpMyAdmin's row 复制: the grid hands over a row's values and the
 * insert page opens with them already filled in, so a near-duplicate row can be
 * written without retyping it. The rules, and why each is what it is:
 *
 * - An AUTO-ASSIGNED column is left BLANK. This is the column the whole gesture
 *   is about: the point of copying a row is to write another one, and a filled-in
 *   id would collide with the row it came from. The engine assigns the next value
 *   only when the column is left out of the INSERT, which is exactly what a blank
 *   control means.
 * - SQL NULL is carried over as a TICKED NULL BOX, not as the four characters
 *   `null` typed into a text field, which is what the text box would store. A
 *   NULL in a NOT NULL column is not a value that can be written back, so that
 *   column is left alone.
 * - An empty string is carried over ONLY where the form can express it — the
 *   explicit 空字符串 box `needsEmptyChoice` offers. Everywhere else it is left
 *   blank and REPORTED: the model's third state (`kind: 'empty'`) renders as a
 *   DISABLED text box, and on a column whose checkbox is not shown that would be
 *   a control the user cannot clear.
 * - A BINARY column is reported and left blank. The grid shows `<binary N bytes>`
 *   — a placeholder for a value the wire cannot carry — and sent back as text it
 *   would be stored as that literal string.
 * - An `enum` whose value is no longer a declared member is reported. A
 *   controlled select whose value matches no option renders the FIRST member
 *   while its state says something else, so the form would show one value and
 *   send another. The same applies to a boolean-ish column holding a value the
 *   two-choice dropdown cannot express.
 * - A temporal value is rewritten into the shape the date controls require
 *   (`2024-01-02T03:04:05`). MySQL answers `2024-01-02 03:04:05`, and an
 *   `<input type="datetime-local">` holding a space renders EMPTY — the value
 *   would look lost while still being submitted. A value in no recognisable shape
 *   (a TIME of `100:00:00` or `-838:59:59`, both legal on MySQL) is reported for
 *   the same reason: a control that shows nothing while holding a value is worse
 *   than one the user can see and retype.
 *
 * A column absent from `row` is simply not filled in and NOT reported: the wire
 * omits nothing it could read, so this means the page did not carry the column —
 * the same as not touching its control.
 */
export function prefillForm(
  engine: string,
  columns: ColumnInfo[],
  row: Record<string, string | number | boolean | null>,
): PrefillResult {
  const out: Record<string, FieldValue> = {}
  const skipped: string[] = []
  for (const column of columns) {
    if (autoAssigns(engine, column)) continue
    if (!Object.prototype.hasOwnProperty.call(row, column.name)) continue
    const value = row[column.name]
    if (value === null) {
      if (column.nullable) out[column.name] = { text: '', kind: 'null' }
      else skipped.push(column.name)
      continue
    }
    const kind = fieldKind(column)
    if (kind.kind === 'binary') { skipped.push(column.name); continue }
    const text = typeof value === 'string' ? value : String(value)
    if (text === '') {
      if (needsEmptyChoice(column)) out[column.name] = { text: '', kind: 'empty' }
      else skipped.push(column.name)
      continue
    }
    if (kind.kind === 'enum') {
      if (kind.options.includes(text)) out[column.name] = { text, kind: 'value' }
      else skipped.push(column.name)
      continue
    }
    if (kind.kind === 'boolean') {
      // Only the two values the dropdown actually offers.
      const mapped = value === true || text === '1' ? '1' : value === false || text === '0' ? '0' : undefined
      if (mapped === undefined) skipped.push(column.name)
      else out[column.name] = { text: mapped, kind: 'value' }
      continue
    }
    if (kind.kind === 'date' || kind.kind === 'datetime' || kind.kind === 'time') {
      const controlText = controlShape(kind.kind, text)
      if (controlText === undefined) skipped.push(column.name)
      else out[column.name] = { text: controlText, kind: 'value' }
      continue
    }
    out[column.name] = { text, kind: 'value' }
  }
  return { values: out, skipped }
}

/**
 * Restate a temporal value in the exact shape its control requires, or undefined
 * when it cannot be — see the last rule in {@link prefillForm}.
 *
 * The date part is anchored at the START and the clock at a separator or the
 * start, so a MySQL TIME beyond a day (`100:00:00`) is not silently read as
 * `00:00:00` by a clock pattern that would happily match its tail.
 */
function controlShape(kind: 'date' | 'datetime' | 'time', text: string): string | undefined {
  if (kind === 'date') return /^(\d{4}-\d{2}-\d{2})(?:[ T]|$)/.exec(text)?.[1]
  const clock = /(?:^|[ T])(\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/.exec(text)
  if (clock === null) return undefined
  // `<input type="time">` requires two-digit hours; `3:04:05` is not a value it
  // accepts, so a single-digit hour has to be padded rather than passed through.
  const normalized = `${clock[1]!.padStart(2, '0')}:${clock[2]}${clock[3] === undefined ? '' : `:${clock[3]}${clock[4] ?? ''}`}`
  if (kind === 'time') return normalized
  const day = /^(\d{4}-\d{2}-\d{2})(?:[ T]|$)/.exec(text)?.[1]
  return day === undefined ? undefined : `${day}T${normalized}`
}

/**
 * Whether a form was left completely alone.
 *
 * These are SKIPPED rather than validated, which is what makes asking for more
 * rows than you fill in harmless: phpMyAdmin's insert page does the same, and the
 * difference is not cosmetic. Validated instead, a blank third form would be
 * reported as a missing NOT NULL column and would REFUSE the whole submit — so
 * filling in one row of a three-row batch would insert nothing at all, and the
 * message would name a column the user never opened. Measured: exactly that,
 * before this rule existed.
 *
 * "Untouched" means every control is in its blank state: nothing typed, no NULL
 * ticked, no empty-string ticked. A form with ONE field filled in is not
 * untouched, so its missing required columns are still reported — which is the
 * case that has to stay an error, because the user clearly meant to insert it.
 */
export function isUntouchedForm(columns: ColumnInfo[], fields: Record<string, FieldValue>): boolean {
  return columns.every(column => {
    const field = fields[column.name]
    if (field === undefined) return true
    return field.kind === 'value' && field.text === ''
  })
}

/**
 * The `option` value that stands for "nothing chosen yet", given a list's real
 * members.
 *
 * A select is controlled by `field.text`, so its blank entry needs a value that
 * no real member can collide with: with a plain `''` and an enum that HAS `''`
 * as a member (measured accepted on MySQL 8.0 — `enum('','b')` is created
 * without complaint), the two options would share a value, one member would be
 * unselectable, and React would render whichever came first under a state that
 * says something else.
 *
 * So `''` while it is free, and a NUL appended until it is unique. The
 * characters are never displayed — a blank box is what the user sees — they only
 * have to be distinct from the members.
 */
export function placeholderValue(options: readonly string[]): string {
  let candidate = ''
  while (options.includes(candidate)) candidate += '\u0000'
  return candidate
}

/**
 * How many forms the "要插入的行数" box asks for, or undefined when it asks for
 * something that is not a count.
 *
 * Refused rather than clamped: silently turning 99999 into 50, or 0 into 1,
 * leaves the box showing a number the form is not using. The caller reports it
 * with the range and leaves the forms alone.
 */
export function parseFormCount(raw: string): number | undefined {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return undefined
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_INSERT_FORMS) return undefined
  return value
}

/**
 * Grow or shrink the list of forms to `count` entries.
 *
 * Growing appends blank forms; shrinking drops the ones at the end, which is
 * what makes a smaller count mean "fewer rows", and is why the count box is a
 * deliberate action (a button) rather than something that happens on every
 * keystroke: typing 12 on the way to 120 must not throw away a filled-in form.
 */
export function resizeForms(
  forms: Array<Record<string, FieldValue>>,
  count: number,
): Array<Record<string, FieldValue>> {
  if (count === forms.length) return forms
  if (count < forms.length) return forms.slice(0, count)
  const next = [...forms]
  while (next.length < count) next.push({})
  return next
}
