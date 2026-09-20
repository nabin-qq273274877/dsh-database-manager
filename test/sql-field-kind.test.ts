/**
 * How a column's declared type decides which control it gets, and which
 * comparison operators it can be searched with.
 *
 * Tested against `column-kinds.ts` rather than through the components: the rules
 * are the whole point, and a component would need a DOM to reach them. Every
 * branch depends on a declared type, and getting one wrong shows up as the wrong
 * input on a form rather than as a failed assertion.
 */

import { describe, expect, it } from 'vitest'

import {
  autoAssigns,
  fieldKind,
  inputHints,
  isBooleanType,
  isDateType,
  isNumericType,
  isTextualType,
  isUnaryOperator,
  operatorsFor,
  searchOperators,
  searchValueKind,
} from '../src/client/column-kinds.ts'
import type { ColumnInfo } from '../src/protocol.ts'

/** A column with the given declared type. */
function column(type: string, extra: Partial<ColumnInfo> = {}): ColumnInfo {
  return { name: 'c', type, nullable: true, key: '', ...extra }
}

describe('fieldKind', () => {
  it('gives an enum its declared members', () => {
    expect(fieldKind(column("enum('a','b')", { options: ['a', 'b'] }))).toEqual({ kind: 'enum', options: ['a', 'b'] })
    // The members come from the wire, not from parsing the type: a client-side
    // regex would have to re-implement MySQL's quoting for `enum('a''b')`.
    expect(fieldKind(column("enum('a''b')"))).toEqual({ kind: 'text', multiline: false })
  })

  it('gives a TINYINT a number box, not a boolean choice', () => {
    /*
     * `BOOL`, `BOOLEAN` and `TINYINT(1)` are the same type on the server —
     * measured: `information_schema.COLUMNS` answers `tinyint(1)` for all three —
     * so a browser cannot tell a flag from a small integer. Two labelled choices
     * would then be offered for a `TINYINT(1)` holding 2, 3 or -1, none of which
     * could be typed; a number box accepts every value the column accepts.
     */
    expect(fieldKind(column('tinyint(1)'))).toEqual({ kind: 'number', integer: true })
    expect(fieldKind(column('tinyint(4)')).kind).toBe('number')
    expect(fieldKind(column('tinyint')).kind).toBe('number')
    // SQLite's `BOOLEAN` is a declared type of its own and keeps its two choices.
    expect(fieldKind(column('boolean')).kind).toBe('boolean')
    expect(fieldKind(column('bool')).kind).toBe('boolean')
  })

  it('separates integer from fractional numbers', () => {
    expect(fieldKind(column('int'))).toEqual({ kind: 'number', integer: true })
    expect(fieldKind(column('BIGINT'))).toEqual({ kind: 'number', integer: true })
    expect(fieldKind(column('year'))).toEqual({ kind: 'number', integer: true })
    expect(fieldKind(column('decimal(10,2)'))).toEqual({ kind: 'number', integer: false })
    expect(fieldKind(column('double'))).toEqual({ kind: 'number', integer: false })
  })

  it('recognises the temporal types', () => {
    expect(fieldKind(column('date')).kind).toBe('date')
    expect(fieldKind(column('datetime')).kind).toBe('datetime')
    expect(fieldKind(column('timestamp')).kind).toBe('datetime')
    expect(fieldKind(column('time')).kind).toBe('time')
  })

  it('recognises binary and long text', () => {
    expect(fieldKind(column('blob')).kind).toBe('binary')
    expect(fieldKind(column('varbinary(255)')).kind).toBe('binary')
    // A long text needs a textarea; a bounded one needs a single line with a cap.
    expect(fieldKind(column('text'))).toMatchObject({ kind: 'text', multiline: true })
    expect(fieldKind(column('json'))).toMatchObject({ kind: 'text', multiline: true })
    expect(fieldKind(column('varchar(20)'))).toMatchObject({ kind: 'text', multiline: false, maxLength: 20 })
    expect(fieldKind(column('char(2)'))).toMatchObject({ kind: 'text', maxLength: 2 })
    // SQLite's untyped column has no length to enforce.
    expect(fieldKind(column(''))).toMatchObject({ kind: 'text', multiline: false })
    expect(fieldKind(column('')).maxLength).toBeUndefined()
  })
})

describe('the browse tab type predicates', () => {
  it('agrees with fieldKind about what is numeric, temporal or boolean', () => {
    for (const type of ['int', 'bigint', 'decimal(10,2)', 'float', 'year']) {
      expect(isNumericType(type), type).toBe(true)
    }
    for (const type of ['varchar(10)', 'text', 'blob', 'date']) {
      expect(isNumericType(type), type).toBe(false)
    }
    for (const type of ['date', 'datetime', 'timestamp', 'time']) {
      expect(isDateType(type), type).toBe(true)
    }
    expect(isDateType('int')).toBe(false)
    for (const type of ['bool', 'boolean']) expect(isBooleanType(type), type).toBe(true)
    // `tinyint(1)` is NOT reported as a boolean: it is MySQL's storage for both
    // `BOOL` and a genuine small integer, and the two are indistinguishable.
    expect(isBooleanType('tinyint(1)')).toBe(false)
    for (const type of ['varchar(10)', 'text', 'enum(\'a\')']) expect(isTextualType(type), type).toBe(true)
    expect(isTextualType('int')).toBe(false)
  })
})

describe('operatorsFor', () => {
  it('offers ranges but no pattern match on an ordered type', () => {
    const operators = operatorsFor('int')
    expect(operators).toContain('between')
    expect(operators).toContain('gt')
    // `LIKE` on an int casts every row and cannot use an index, so it is not
    // offered; a user wanting that can still use the SQL tab.
    expect(operators).not.toContain('contains')
    expect(operatorsFor('datetime')).not.toContain('contains')
  })

  it('offers pattern matches on a textual type', () => {
    const operators = operatorsFor('varchar(20)')
    expect(operators).toContain('contains')
    expect(operators).toContain('startsWith')
    expect(operators).not.toContain('between')
  })

  it('offers everything for a type it cannot classify', () => {
    // Refusing an operator the engine would accept is worse than offering one
    // that happens to return nothing.
    expect(operatorsFor('geometry').length).toBeGreaterThan(operatorsFor('int').length)
  })

  it('marks the unary operators', () => {
    expect(isUnaryOperator('isNull')).toBe(true)
    expect(isUnaryOperator('isNotNull')).toBe(true)
    expect(isUnaryOperator('eq')).toBe(false)
  })
})

/**
 * The 搜索 tab's per-column narrowing.
 *
 * An `enum`'s value control is a dropdown of its declared members, so the operators
 * have to be ones a single member can answer. `contains` would ask for part of a
 * member in a control that cannot accept one, and `in` for a comma-separated list
 * where only one member can be picked. phpMyAdmin reaches the same set from the
 * other direction: `Types::getEnumOperators()` returns exactly `=` and `!=`.
 */
describe('searchOperators', () => {
  it('gives an enum equality and the null tests only', () => {
    const operators = searchOperators(column("enum('a','b')", { options: ['a', 'b'] }))
    expect(operators).toEqual(['eq', 'neq', 'isNull', 'isNotNull'])
    expect(operators).not.toContain('contains')
    expect(operators).not.toContain('in')
    expect(operators).not.toContain('between')
  })

  it('leaves a set the text operators, because its value is not one member', () => {
    // A set holds several comma-separated members, so `contains` and `in` are both
    // meaningful there and its value is typed freely.
    const operators = searchOperators(column("set('a','b')", { options: ['a', 'b'] }))
    expect(operators).toContain('contains')
    expect(operators).toContain('in')
  })

  it('does not narrow a type whose name merely starts with "enum" -ish letters', () => {
    // `enumerate` is not a type the engine knows either; the check is on the type
    // WORD, so nothing else is caught by it.
    expect(searchOperators(column('varchar(20)'))).toEqual(operatorsFor('varchar(20)'))
    expect(searchOperators(column('int'))).toEqual(operatorsFor('int'))
  })
})

describe('searchValueKind', () => {
  it('gives an enum a dropdown of exactly its members', () => {
    expect(searchValueKind(column("enum('on','off')", { options: ['on', 'off'] })))
      .toEqual({ kind: 'members', options: ['on', 'off'] })
  })

  it('falls back to a text box when the member list could not be read', () => {
    // A dropdown with nothing in it would make the column unsearchable, so a
    // missing list is a text box rather than an empty select.
    expect(searchValueKind(column("enum('on','off')"))).toEqual({ kind: 'input' })
    expect(searchValueKind(column("enum('a')", { options: [] }))).toEqual({ kind: 'input' })
  })

  it('does not give a set a single-select dropdown', () => {
    // One member cannot express a value holding several, so a set is typed.
    expect(searchValueKind(column("set('a','b')", { options: ['a', 'b'] }))).toEqual({ kind: 'input' })
  })

  it('gives every other type a text box', () => {
    for (const type of ['int', 'varchar(20)', 'date', 'text', 'tinyint(1)']) {
      expect(searchValueKind(column(type)), type).toEqual({ kind: 'input' })
    }
  })
})

describe('inputHints', () => {
  it('hands the browser the control its own picker needs', () => {
    expect(inputHints(column('int'))).toEqual({ inputMode: 'numeric' })
    expect(inputHints(column('decimal(10,2)'))).toEqual({ inputMode: 'decimal' })
    expect(inputHints(column('date'))).toEqual({ type: 'date' })
    expect(inputHints(column('datetime'))).toEqual({ type: 'datetime-local' })
    expect(inputHints(column('time'))).toEqual({ type: 'time' })
    expect(inputHints(column('varchar(10)'))).toEqual({})
  })
})

describe('autoAssigns', () => {
  it('recognises SQLite\'s INTEGER PRIMARY KEY rowid alias', () => {
    expect(autoAssigns('sqlite', column('INTEGER', { key: 'PRI', primaryKeyPosition: 1 }))).toBe(true)
    // `INT PRIMARY KEY` is NOT a rowid alias: a blank field would insert NULL
    // into a NOT NULL column rather than assigning the next id.
    expect(autoAssigns('sqlite', column('INT', { key: 'PRI', primaryKeyPosition: 1 }))).toBe(false)
    // Position 2 of a composite key is not an alias either.
    expect(autoAssigns('sqlite', column('INTEGER', { key: 'PRI', primaryKeyPosition: 2 }))).toBe(false)
  })

  it('recognises MySQL AUTO_INCREMENT', () => {
    expect(autoAssigns('mysql', column('int', { key: 'PRI', primaryKeyPosition: 1, extra: 'auto_increment' }))).toBe(true)
    expect(autoAssigns('mysql', column('int', { key: 'PRI', primaryKeyPosition: 1 }))).toBe(false)
    // `EXTRA` is only read as MySQL's marker, so a SQLite column carrying the
    // word for some other reason is not treated as self-assigning.
    expect(autoAssigns('sqlite', column('TEXT', { extra: 'auto_increment' }))).toBe(false)
    // And a SQLite INTEGER PRIMARY KEY is, without needing the marker.
    expect(autoAssigns('sqlite', column('INTEGER', { key: 'PRI', primaryKeyPosition: 1, extra: undefined }))).toBe(true)
  })
})
