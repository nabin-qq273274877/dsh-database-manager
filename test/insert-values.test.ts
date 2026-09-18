/**
 * Unit tests for the 插入 tab's rules, which live in `insert-values.ts`.
 *
 * The whole point of that module is the mapping from "what the user left in the
 * form" to "what goes into the INSERT", and every branch of it has a failure
 * mode that is invisible on screen:
 *
 *   - An untouched control must leave the column OUT of the statement, so the
 *     engine's DEFAULT applies. Sending `''` instead is what stores an empty
 *     string where the schema said `DEFAULT 'pending'`.
 *   - A ticked NULL must send SQL NULL, which is a different value from both.
 *   - A column that nothing can supply has to be refused by NAME, because the
 *     engine's own complaint would be about a NOT NULL constraint the user cannot
 *     see from this form.
 *   - The row count has to be refused rather than clamped: a box showing 99999
 *     while the form holds 50 is a lie about what is being submitted.
 *
 * No browser and no server: the rules are pure, so they are tested directly.
 */

import { describe, expect, it } from 'vitest'

import type { ColumnInfo } from '../src/protocol.ts'
import {
  blankField,
  buildRow,
  isUntouchedForm,
  MAX_INSERT_FORMS,
  mayOmit,
  needsEmptyChoice,
  parseFormCount,
  placeholderValue,
  resizeForms,
} from '../src/client/insert-values.ts'

/** A column, with just enough set for these rules. */
function column(overrides: Partial<ColumnInfo> & { name: string }): ColumnInfo {
  return { type: 'TEXT', nullable: true, key: '', ...overrides }
}

describe('mayOmit: whether an untouched control can just leave the column out', () => {
  it('allows a nullable column', () => {
    expect(mayOmit('mysql', column({ name: 'a', nullable: true }))).toBe(true)
  })

  it('allows a column with a default, even though it is NOT NULL', () => {
    // The one case a blank box is a deliberate omission rather than a missing value.
    expect(mayOmit('mysql', column({ name: 'a', nullable: false, defaultValue: "'pending'" }))).toBe(true)
  })

  it('refuses a NOT NULL column with no default and no auto-assignment', () => {
    // Measured shape: `product TEXT NOT NULL` with nothing else. The engine refuses the INSERT,
    // so the form has to say which column is missing first.
    expect(mayOmit('mysql', column({ name: 'a', nullable: false }))).toBe(false)
  })

  it('allows MySQL AUTO_INCREMENT, which the engine fills in', () => {
    const auto = column({ name: 'id', nullable: false, type: 'INT', key: 'PRI', extra: 'auto_increment' })
    expect(mayOmit('mysql', auto)).toBe(true)
    // The same column read on SQLite has no auto-assignment at all: INT is not the rowid alias.
    expect(mayOmit('sqlite', column({ name: 'id', nullable: false, type: 'INT', key: 'PRI' }))).toBe(false)
  })

  it('allows the SQLite INTEGER PRIMARY KEY rowid alias', () => {
    const id = column({ name: 'id', nullable: false, type: 'INTEGER', key: 'PRI', primaryKeyPosition: 1 })
    expect(mayOmit('sqlite', id)).toBe(true)
    // BIGINT PRIMARY KEY is not the alias, so nothing assigns it.
    expect(mayOmit('sqlite', column({ name: 'id', nullable: false, type: 'BIGINT', key: 'PRI', primaryKeyPosition: 1 }))).toBe(false)
  })
})

describe('needsEmptyChoice: where the empty string would otherwise be unreachable', () => {
  it('asks for the choice on a NOT NULL text column with no default', () => {
    expect(needsEmptyChoice(column({ name: 'a', type: 'TEXT', nullable: false }))).toBe(true)
    expect(needsEmptyChoice(column({ name: 'a', type: 'VARCHAR(20)', nullable: false }))).toBe(true)
  })

  it('does not ask when a blank box already means something legal', () => {
    // A default or a NULL both make the untouched box a valid answer, so there is
    // no unreachable value to rescue.
    expect(needsEmptyChoice(column({ name: 'a', type: 'TEXT', nullable: false, defaultValue: "''" }))).toBe(false)
    expect(needsEmptyChoice(column({ name: 'a', type: 'TEXT', nullable: true }))).toBe(false)
  })

  it('does not ask it of a numeric column, which would reject the empty string', () => {
    // Sending '' for an INT is an error reported about the wrong thing; offering
    // the choice would be offering a failure.
    expect(needsEmptyChoice(column({ name: 'a', type: 'INT', nullable: false }))).toBe(false)
    expect(needsEmptyChoice(column({ name: 'a', type: 'DATE', nullable: false }))).toBe(false)
  })
})

describe('buildRow: what actually goes into the INSERT', () => {
  const engine = 'mysql'

  it('leaves an untouched column out entirely', () => {
    // THE rule that matters most: not '' and not NULL. A missing key is what lets
    // the engine apply DEFAULT 'pending'.
    const built = buildRow(engine, [column({ name: 'a', nullable: true })], {})
    expect(built).toEqual({ values: [] })
  })

  it('leaves a column with a default out even when its box was touched and cleared', () => {
    const built = buildRow(engine, [column({ name: 'a', nullable: false, defaultValue: "'x'" })], { a: { text: '', kind: 'value' } })
    expect(built).toEqual({ values: [] })
  })

  it('sends NULL for a ticked NULL box', () => {
    const built = buildRow(engine, [column({ name: 'a', nullable: true })], { a: { text: 'ignored', kind: 'null' } })
    expect(built).toEqual({ values: [{ column: 'a', value: null }] })
  })

  it('sends the empty string for a ticked empty-string box', () => {
    // The distinct third value, which is why the choice exists at all.
    const built = buildRow(engine, [column({ name: 'a', type: 'TEXT', nullable: false })], { a: { text: '', kind: 'empty' } })
    expect(built).toEqual({ values: [{ column: 'a', value: '' }] })
  })

  it('sends a typed value as text', () => {
    const built = buildRow(engine, [column({ name: 'a', nullable: true })], { a: { text: 'hello', kind: 'value' } })
    expect(built).toEqual({ values: [{ column: 'a', value: 'hello' }] })
  })

  it('names a required column instead of letting the engine complain', () => {
    const built = buildRow(engine, [column({ name: 'product', nullable: false })], {})
    expect(built).toEqual({ failure: { reason: 'required', column: 'product' } })
  })

  it('refuses NULL for a NOT NULL column', () => {
    // The checkbox is not rendered there, but a stale tick must not become a
    // failed INSERT either.
    const built = buildRow(engine, [column({ name: 'a', nullable: false, defaultValue: '1' })], { a: { text: '', kind: 'null' } })
    expect(built).toEqual({ failure: { reason: 'required', column: 'a' } })
  })

  it('refuses a number that is not one', () => {
    // MySQL would coerce '12abc' to 12 with a warning, storing a different number
    // from the one on screen.
    const int = column({ name: 'age', type: 'INT', nullable: true })
    expect(buildRow(engine, [int], { age: { text: '12abc', kind: 'value' } }))
      .toEqual({ failure: { reason: 'notNumber', column: 'age' } })
    expect(buildRow(engine, [int], { age: { text: '12', kind: 'value' } }))
      .toEqual({ values: [{ column: 'age', value: '12' }] })
    expect(buildRow(engine, [int], { age: { text: '-3', kind: 'value' } }))
      .toEqual({ values: [{ column: 'age', value: '-3' }] })
  })

  it('accepts a decimal and an exponent, and trims before testing', () => {
    const real = column({ name: 'amount', type: 'DECIMAL(10,2)', nullable: true })
    expect(buildRow(engine, [real], { amount: { text: ' 1.5 ', kind: 'value' } }))
      .toEqual({ values: [{ column: 'amount', value: ' 1.5 ' }] })
    expect(buildRow(engine, [real], { amount: { text: '1e3', kind: 'value' } }))
      .toEqual({ values: [{ column: 'amount', value: '1e3' }] })
  })

  it('refuses a decimal for an integer column', () => {
    const int = column({ name: 'age', type: 'INT', nullable: true })
    expect(buildRow(engine, [int], { age: { text: '1.5', kind: 'value' } }))
      .toEqual({ failure: { reason: 'notNumber', column: 'age' } })
  })

  it('refuses a value longer than the declared width', () => {
    const narrow = column({ name: 'code', type: 'VARCHAR(3)', nullable: true })
    expect(buildRow(engine, [narrow], { code: { text: 'abcd', kind: 'value' } }))
      .toEqual({ failure: { reason: 'tooLong', column: 'code', max: 3 } })
    expect(buildRow(engine, [narrow], { code: { text: 'abc', kind: 'value' } }))
      .toEqual({ values: [{ column: 'code', value: 'abc' }] })
  })

  it('counts characters the way a user does, not UTF-16 units', () => {
    // '😀' is two UTF-16 units; a `VARCHAR(1)` holds one such character.
    const narrow = column({ name: 'code', type: 'VARCHAR(1)', nullable: true })
    expect(buildRow(engine, [narrow], { code: { text: '😀', kind: 'value' } }))
      .toEqual({ values: [{ column: 'code', value: '😀' }] })
  })

  it('keeps the column order of the table, not of the form', () => {
    const built = buildRow(engine, [column({ name: 'b', nullable: true }), column({ name: 'a', nullable: true })], {
      a: { text: '1', kind: 'value' },
      b: { text: '2', kind: 'value' },
    })
    expect(built).toEqual({ values: [{ column: 'b', value: '2' }, { column: 'a', value: '1' }] })
  })
})

describe('isUntouchedForm: the blank forms a batch skips', () => {
  const nullable = column({ name: 'a', nullable: true })
  const required = column({ name: 'code', type: 'TEXT', nullable: false })

  it('is untouched when no control was set', () => {
    expect(isUntouchedForm([nullable, required], {})).toBe(true)
    // An explicit blank value is the same state as no entry at all.
    expect(isUntouchedForm([nullable], { a: blankField() })).toBe(true)
  })

  it('is touched as soon as ONE field has text', () => {
    // This is the case that has to stay an error: the user clearly meant to
    // insert this row, so its missing required column must be reported.
    expect(isUntouchedForm([nullable, required], { a: { text: 'x', kind: 'value' } })).toBe(false)
  })

  it('counts a ticked NULL or empty-string box as touched', () => {
    expect(isUntouchedForm([nullable], { a: { text: '', kind: 'null' } })).toBe(false)
    expect(isUntouchedForm([required], { code: { text: '', kind: 'empty' } })).toBe(false)
  })

  it('is untouched when the table has no editable columns at all', () => {
    // Vacuously true, so a table of only generated columns skips its blank forms
    // rather than reporting a column that could not be written anyway.
    expect(isUntouchedForm([], {})).toBe(true)
  })
})

describe('placeholderValue: a blank entry no member can collide with', () => {
  it('uses the empty string when nothing declares it', () => {
    expect(placeholderValue([])).toBe('')
    expect(placeholderValue(['a', 'b'])).toBe('')
  })

  it('avoids a collision when the list itself contains the empty string', () => {
    // Measured on MySQL 8.0: `enum('','b')` is created without complaint, so this
    // is a real schema and not a hypothetical. Sharing a value would make one
    // member unselectable and render a state that says something else.
    expect(placeholderValue(['', 'b'])).not.toBe('')
    expect(placeholderValue(['', 'b'])).not.toContain('b')
  })

  it('keeps avoiding it when the first fallback is also taken', () => {
    const taken = ['', '\u0000']
    const value = placeholderValue(taken)
    expect(taken.includes(value)).toBe(false)
  })
})

describe('parseFormCount: refused rather than clamped', () => {
  it('accepts a plain count', () => {
    expect(parseFormCount('1')).toBe(1)
    expect(parseFormCount('12')).toBe(12)
    expect(parseFormCount(' 3 ')).toBe(3)
    expect(parseFormCount(String(MAX_INSERT_FORMS))).toBe(MAX_INSERT_FORMS)
  })

  it('refuses zero, negatives and fractions', () => {
    expect(parseFormCount('0')).toBeUndefined()
    expect(parseFormCount('-2')).toBeUndefined()
    expect(parseFormCount('1.5')).toBeUndefined()
  })

  it('refuses text and an empty box', () => {
    expect(parseFormCount('')).toBeUndefined()
    expect(parseFormCount('abc')).toBeUndefined()
    expect(parseFormCount('1e3')).toBeUndefined()
  })

  it('refuses a count above the ceiling instead of silently using the ceiling', () => {
    // Clamping would leave the box showing a number the form is not using.
    expect(parseFormCount(String(MAX_INSERT_FORMS + 1))).toBeUndefined()
    expect(parseFormCount('99999')).toBeUndefined()
  })
})

describe('resizeForms: growing appends, shrinking drops from the end', () => {
  it('keeps the filled-in forms and appends blanks when growing', () => {
    const filled = [{ name: { text: 'kept', kind: 'value' as const } }]
    const grown = resizeForms(filled, 3)
    expect(grown.length).toBe(3)
    expect(grown[0]).toEqual(filled[0])
    expect(grown[1]).toEqual({})
    expect(grown[2]).toEqual({})
  })

  it('drops the LAST forms when shrinking, never the first', () => {
    // The first form is the one the user was editing; dropping it would lose the
    // value they were looking at.
    const forms = [
      { name: { text: 'first', kind: 'value' as const } },
      { name: { text: 'second', kind: 'value' as const } },
    ]
    const shrunk = resizeForms(forms, 1)
    expect(shrunk.length).toBe(1)
    expect(shrunk[0]).toEqual(forms[0])
  })

  it('returns the same array when the count is unchanged', () => {
    // Same reference: an unnecessary state update would re-render every control
    // and drop the focus the user is typing in.
    const forms = [{}]
    expect(resizeForms(forms, 1)).toBe(forms)
  })

  it('does not share the appended objects', () => {
    const grown = resizeForms([], 2)
    grown[0]!.x = { text: 'a', kind: 'value' }
    expect(grown[1]).toEqual({})
  })
})

describe('blankField', () => {
  it('is an empty value, so an untouched column may be omitted', () => {
    expect(blankField()).toEqual({ text: '', kind: 'value' })
  })
})
