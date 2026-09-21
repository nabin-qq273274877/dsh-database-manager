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
  prefillForm,
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

/**
 * 浏览 页「复制」的目标：一行数据变成一份填好的插入表单。
 *
 * 每一条规则都有一个只在界面上才看得见的失败形态，所以逐条钉住：
 *
 *   - 自增列填了值 → 提交就撞上原行的主键（复制一行的意义就是再写一行）；
 *   - NULL 变成文字 "null" → 库里存的是四个字母；
 *   - 日期原样是 `2024-01-02 03:04:05` → `datetime-local` 控件显示为空，但提交的
 *     仍是那个值，用户看到的和写下去的不是一回事；
 *   - 二进制值原样回填 → 把 `<binary 4 bytes>` 这个占位符当值存进库，而它看上去和
 *     「这一列本来就没值」一模一样，所以要一并报出来。
 */
describe('prefillForm: one grid row becomes a filled-in insert form', () => {
  it('leaves an AUTO_INCREMENT column blank so the engine assigns the next id', () => {
    const id = column({ name: 'id', type: 'int', nullable: false, key: 'PRI', extra: 'auto_increment' })
    const name = column({ name: 'name', type: 'varchar(20)', nullable: true })
    const { values, skipped } = prefillForm('mysql', [id, name], { id: 7, name: 'copied' })
    expect(values.id).toBeUndefined()
    expect(values.name).toEqual({ text: 'copied', kind: 'value' })
    // 自增列是「有意留空」，不该出现在「没能复制过来」的名单里，否则每一行都会报警。
    expect(skipped).toEqual([])
  })

  it('leaves SQLite’s rowid alias blank too', () => {
    // `INTEGER PRIMARY KEY` is SQLite's auto-assignment; a plain `INT` is not.
    const alias = column({ name: 'id', type: 'INTEGER', nullable: false, key: 'PRI', primaryKeyPosition: 1 })
    expect(prefillForm('sqlite', [alias], { id: 3 }).values.id).toBeUndefined()
    const plain = column({ name: 'id', type: 'INT', nullable: false, key: 'PRI', primaryKeyPosition: 1 })
    expect(prefillForm('sqlite', [plain], { id: 3 }).values.id).toEqual({ text: '3', kind: 'value' })
  })

  it('carries a NULL over as a ticked box, not as the text "null"', () => {
    const { values } = prefillForm('mysql', [column({ name: 'note', type: 'text', nullable: true })], { note: null })
    expect(values.note).toEqual({ text: '', kind: 'null' })
  })

  it('leaves a NULL in a NOT NULL column unfilled rather than sending NULL', () => {
    // The wire cannot produce that row, and a ticked NULL box on a NOT NULL column
    // is refused by buildRow with a message about a column the user never touched.
    const { values, skipped } = prefillForm(
      'mysql',
      [column({ name: 'note', type: 'text', nullable: false, defaultValue: "'x'" })],
      { note: null },
    )
    expect(values.note).toBeUndefined()
    expect(skipped).toEqual(['note'])
  })

  it('keeps an empty string only where the form has the 空字符串 box for it', () => {
    const forced = column({ name: 'a', type: 'varchar(10)', nullable: false })
    expect(needsEmptyChoice(forced)).toBe(true)
    const kept = prefillForm('mysql', [forced], { a: '' })
    expect(kept.values.a).toEqual({ text: '', kind: 'empty' })
    expect(kept.skipped).toEqual([])

    // A nullable column would fall back to NULL if the state said 'empty' while
    // its checkbox was not rendered — a control the user could not clear.
    const free = column({ name: 'b', type: 'varchar(10)', nullable: true })
    expect(needsEmptyChoice(free)).toBe(false)
    const dropped = prefillForm('mysql', [free], { b: '' })
    expect(dropped.values.b).toBeUndefined()
    expect(dropped.skipped).toEqual(['b'])
  })

  it('skips a binary column, whose grid value is only a placeholder', () => {
    // The grid shows `<binary 4 bytes>`; stored back as text it would be that
    // literal string rather than the four bytes.
    const blob = column({ name: 'payload', type: 'blob', nullable: true })
    const { values, skipped } = prefillForm('mysql', [blob], { payload: '<binary 4 bytes>' })
    expect(values).toEqual({})
    expect(skipped).toEqual(['payload'])
  })

  it('fills an enum only with a value the dropdown actually offers', () => {
    const status = column({ name: 'status', type: "enum('a','b')", nullable: false, options: ['a', 'b'] })
    expect(prefillForm('mysql', [status], { status: 'b' }).values.status).toEqual({ text: 'b', kind: 'value' })
    // A controlled select whose value matches no option renders the FIRST member
    // while its state says something else: shown one value, submitted another.
    expect(prefillForm('mysql', [status], { status: 'gone' }).skipped).toEqual(['status'])
  })

  it('fills a boolean-ish column only with a value the two choices can express', () => {
    const flag = column({ name: 'flag', type: 'boolean', nullable: false })
    expect(prefillForm('sqlite', [flag], { flag: 0 }).values.flag).toEqual({ text: '0', kind: 'value' })
    expect(prefillForm('sqlite', [flag], { flag: true }).values.flag).toEqual({ text: '1', kind: 'value' })
    expect(prefillForm('sqlite', [flag], { flag: 7 }).skipped).toEqual(['flag'])
  })

  it('rewrites a MySQL datetime into the shape datetime-local requires', () => {
    // Measured: MySQL answers `2024-01-02 03:04:05`, and an input[type=datetime-local]
    // holding that space renders EMPTY while still submitting the value.
    const at = column({ name: 'at', type: 'datetime', nullable: true })
    expect(prefillForm('mysql', [at], { at: '2024-01-02 03:04:05' }).values.at)
      .toEqual({ text: '2024-01-02T03:04:05', kind: 'value' })
  })

  it('pads a single-digit hour, which input[type=time] rejects', () => {
    const at = column({ name: 'at', type: 'time', nullable: true })
    expect(prefillForm('mysql', [at], { at: '3:04:05' }).values.at).toEqual({ text: '03:04:05', kind: 'value' })
  })

  it('leaves a temporal value blank when its control could not show it', () => {
    // MySQL accepts a TIME beyond a day; input[type=time] does not. Passing it
    // through would put a value in the form that is submitted but never seen.
    const at = column({ name: 'at', type: 'time', nullable: true })
    expect(prefillForm('mysql', [at], { at: '100:00:00' }).skipped).toEqual(['at'])
    const day = column({ name: 'd', type: 'date', nullable: true })
    expect(prefillForm('mysql', [day], { d: 'not a date' }).skipped).toEqual(['d'])
  })

  it('keeps a date-only value and a datetime with fractional seconds', () => {
    const day = column({ name: 'd', type: 'date', nullable: true })
    expect(prefillForm('mysql', [day], { d: '2024-01-02' }).values.d).toEqual({ text: '2024-01-02', kind: 'value' })
    const at = column({ name: 'at', type: 'timestamp', nullable: true })
    expect(prefillForm('mysql', [at], { at: '2024-01-02 03:04:05.678' }).values.at)
      .toEqual({ text: '2024-01-02T03:04:05.678', kind: 'value' })
  })

  it('numbers a number as text and leaves an absent column untouched', () => {
    const { values, skipped } = prefillForm('mysql', [
      column({ name: 'age', type: 'int', nullable: true }),
      column({ name: 'extra', type: 'int', nullable: true }),
    ], { age: 42 })
    expect(values.age).toEqual({ text: '42', kind: 'value' })
    // Absent means "leave the column out of the INSERT", the same as not touching it
    // — and it is NOT reported, because nothing was lost: the page never carried it.
    expect(values.extra).toBeUndefined()
    expect(skipped).toEqual([])
  })

  it('reports every lost column by name, in table order', () => {
    // The notice names them, so a silently blank column cannot be submitted as if
    // it matched the row that was copied.
    const { skipped } = prefillForm('mysql', [
      column({ name: 'payload', type: 'blob', nullable: true }),
      column({ name: 'name', type: 'varchar(10)', nullable: true }),
      column({ name: 'gone', type: "enum('a')", nullable: false, options: ['a'] }),
    ], { payload: '<binary 2 bytes>', name: 'kept', gone: 'z' })
    expect(skipped).toEqual(['payload', 'gone'])
  })

  it('produces values the untouched-form test does not read as blank', () => {
    // The prefill has to make the form count as FILLED IN, or a single-row submit
    // would be skipped as an empty form and insert nothing.
    const columns = [column({ name: 'name', type: 'varchar(10)', nullable: false })]
    const { values } = prefillForm('mysql', columns, { name: 'x' })
    expect(isUntouchedForm(columns, values)).toBe(false)
  })
})
