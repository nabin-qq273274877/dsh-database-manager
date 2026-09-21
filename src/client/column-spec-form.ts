/**
 * The 结构 tab's column editor: turning an EXISTING column into a form, and a form
 * back into the spec that changes it.
 *
 * Deliberately free of React and of i18n, following `column-defaults.ts` and
 * `column-kinds.ts`: these are the rules worth testing directly, and a rule inlined
 * into a component is only reachable through a browser — where a wrong one shows up
 * as a subtly wrong DDL statement rather than as a failed assertion.
 *
 * The editor is aligned with 新建表's form (type groups, a length, a collation, an
 * attribute list, an index choice, 自增), and that alignment is what makes SPLITTING
 * necessary: the engine reports ONE `type` string that already contains most of those
 * pieces.
 *
 * Measured on MySQL 8.0, the pairs are:
 *
 *   information_schema.COLUMNS.COLUMN_TYPE   `int unsigned`            → type + UNSIGNED
 *                                            `int(10) unsigned zerofill` → type + length + both
 *                                            `varchar(191)`            → type + length
 *                                            `enum('a','b')`           → type (members stay inside)
 *   EXTRA                                    `on update CURRENT_TIMESTAMP`
 *   COLLATION_NAME                           `utf8mb4_bin`
 *
 * So a form that carried `type` verbatim AND sent its own 属性 list would emit
 * `INT UNSIGNED UNSIGNED`. MySQL ACCEPTS that and normalises it back (measured: the
 * column still reads `int unsigned`), which is what makes the mistake silent — the
 * form looks right, the column looks right, and the statement carries the modifier
 * twice. The split below is therefore not cosmetic: it is what keeps the modifier
 * emitted exactly once.
 */

import type { ColumnAttribute } from '../protocol.ts'

/** The pieces of a column's declared type, as the aligned form needs them. */
export interface TypeParts {
  /** The base type name, without its length or its modifiers: `varchar`, `int`. */
  base: string
  /** The text inside the parentheses: `191`, `10,2`, `'a','b'`. */
  length: string
  /** `unsigned` / `zerofill`, which the engine folds into the type text. */
  attributes: ColumnAttribute[]
}

/** MySQL's trailing type modifiers, which `COLUMN_TYPE` carries. */
const MYSQL_MODIFIERS = ['unsigned', 'zerofill'] as const

/**
 * Split a declared type into base / length / trailing modifiers.
 *
 * The base keeps the caller's own CASING (`VARCHAR` stays `VARCHAR`), because it is
 * re-emitted: normalising it would make an edit of an unrelated field rewrite the
 * column's declared type, which shows up in a schema diff as a change nobody made.
 *
 * An `enum('a','b')` / `set('a','b')` keeps its members in `length` rather than being
 * flattened: they live in the same parentheses slot, and the shared `length` field is
 * what both the create form and this one already use for it.
 *
 * A type with unbalanced brackets is passed through as a base with no length, so a
 * malformed value cannot make the form drop the column's real type.
 */
export function splitTypeParts(type: string): TypeParts {
  const text = type.trim()
  if (text === '') return { base: '', length: '', attributes: [] }

  const open = text.indexOf('(')
  let base = text
  let length = ''
  let after = ''
  if (open !== -1) {
    const close = matchingClose(text, open)
    if (close === -1) return { base: text, length: '', attributes: [] }
    base = text.slice(0, open).trim()
    length = text.slice(open + 1, close).trim()
    after = text.slice(close + 1).trim()
  }

  // The modifiers trail the whole expression, so they follow the brackets when there
  // are any: `int(10) unsigned zerofill`.
  const words = `${base}${after === '' ? '' : ` ${after}`}`.split(/\s+/).filter(word => word !== '')
  const attributes: ColumnAttribute[] = []
  while (words.length > 1 && (MYSQL_MODIFIERS as readonly string[]).includes(words[words.length - 1]!.toLowerCase())) {
    const modifier = words.pop()!.toLowerCase() as ColumnAttribute
    // `unshift`, so the order the user sees is the order the engine writes them in.
    attributes.unshift(modifier)
  }
  return { base: words.join(' '), length, attributes }
}

/** The index of the bracket closing the one at `open`, or -1. */
function matchingClose(text: string, open: number): number {
  let depth = 0
  for (let at = open; at < text.length; at++) {
    const character = text[at]
    // A quoted member may itself contain a bracket: `enum('a)b')`. Doubled quotes
    // escape one, which is how both engines spell it.
    if (character === "'") {
      for (at += 1; at < text.length; at++) {
        if (text[at] !== "'") continue
        if (text[at + 1] === "'") { at += 1; continue }
        break
      }
      continue
    }
    if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      if (depth === 0) return at
    }
  }
  return -1
}

/**
 * Put base / length / modifiers back into ONE type expression.
 *
 * The inverse of {@link splitTypeParts}, and the reason a form can offer "a type, a
 * length and an attribute list" as three controls while the engine still receives the
 * single string it expects.
 *
 * The order is MySQL's own: `base(length) unsigned zerofill`. A modifier is emitted
 * once, from the list, because the base no longer contains any — the two halves are
 * produced together by the split, so a caller cannot accidentally feed a base that
 * still carries `unsigned` alongside the list that names it.
 *
 * A base that ALREADY carries parentheses inside it (a value the split could not
 * divide, or a type the user typed whole) is left alone rather than given a second
 * pair: `varchar(30)` plus a length would otherwise render `varchar(30)(255)`.
 */
export function joinTypeParts(parts: TypeParts): string {
  const base = parts.base.trim()
  const length = parts.length.trim()
  const modifiers = parts.attributes.filter(id => (MYSQL_MODIFIERS as readonly string[]).includes(id))
  const suffix = modifiers.length === 0 ? '' : ` ${modifiers.join(' ')}`
  if (base === '') return ''
  if (length === '' || base.includes('(')) return `${base}${suffix}`
  return `${base}(${length})${suffix}`
}

/**
 * The attributes an existing column reports, as the form's starting list.
 *
 * Read from the SPLIT type (not from `ColumnInfo`) because that is where the engine
 * puts them, plus `ON UPDATE CURRENT_TIMESTAMP` from `EXTRA` — the one attribute
 * that lives elsewhere. `BINARY` is deliberately absent: MySQL reports it by changing
 * the column's COLLATION to a `_bin` one (measured: `CHAR(4) BINARY` reads back
 * `char(4)` with `COLLATION_NAME = utf8mb4_bin`), so it cannot be told apart from a
 * column explicitly declared with that collation. Guessing would put a `BINARY` on
 * columns that never had one, and the collation is what the form shows anyway.
 */
export function attributesFromColumn(column: { type: string; extra?: string }): ColumnAttribute[] {
  const collected = [...splitTypeParts(column.type).attributes]
  if (column.extra !== undefined && /on update current_timestamp/i.test(column.extra)) {
    collected.push('onUpdateCurrentTimestamp')
  }
  return collected
}
