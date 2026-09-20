/**
 * Unit tests for the create-table form's rules, which now live in `column-defaults.ts`.
 *
 * These are the rules that decide what gets SENT, and each has a failure mode that is invisible
 * in the form and confusing at the server:
 *
 *   - `defaultToWire` maps four modes to three different wire values, and two of them look
 *     identical on screen ("no default" vs the empty string). Getting it wrong means a column
 *     silently gets the wrong default.
 *   - `takesLength` decides when a length is dropped. Not dropping it produced `TIMESTAMP(255)`,
 *     which MySQL refuses with a message about the DEFAULT — pointing nowhere near the cause.
 *   - `requiresLengthOrValues` answers the reverse question, which became reachable once the
 *     length stopped being pre-filled: measured on 8.0, `VARCHAR` with no parentheses is a
 *     syntax error whose message names neither the column nor the cause.
 *   - `autoIncrementBlocker` is deliberately more permissive than "must be PRIMARY" (measured:
 *     UNIQUE or a plain INDEX is enough on MySQL) and stricter about position.
 *
 * No browser and no server: the rules are pure, so they are tested directly.
 */

import { describe, expect, it } from 'vitest'

import {
  autoIncrementBlocker,
  defaultToWire,
  DEFAULT_MODES,
  inferDefault,
  nullDefaultNeedsNullable,
  quoteDefaultLiteral,
  requiresLengthOrValues,
  supportsCurrentTimestamp,
  takesLength,
} from '../src/client/column-defaults.ts'

describe('defaultToWire: the four modes are three different values', () => {
  it('不设置 sends nothing at all', () => {
    // The distinction that matters: this must NOT become '' or NULL.
    expect(defaultToWire('none', '')).toBeUndefined()
    // A leftover text must not leak through either — the mode is the authority.
    expect(defaultToWire('none', 'abc')).toBeUndefined()
  })

  it('自定义 with no text sends the EMPTY STRING, not nothing and not NULL', () => {
    expect(defaultToWire('custom', '')).toBe("''")
    expect(defaultToWire('custom', '   ')).toBe("''")
  })

  it('自定义 with text sends that literal, quoted', () => {
    expect(defaultToWire('custom', 'abc')).toBe("'abc'")
  })

  it('自定义 passes an already-quoted literal through', () => {
    // Typing 'abc' means the string abc, not the string 'abc'.
    expect(defaultToWire('custom', "'abc'")).toBe("'abc'")
    expect(defaultToWire('custom', "''")).toBe("''")
  })

  it('自定义 passes a bare number through unquoted', () => {
    // DEFAULT '0' and DEFAULT 0 differ for a numeric column on MySQL.
    expect(defaultToWire('custom', '0')).toBe('0')
    expect(defaultToWire('custom', '-1.5')).toBe('-1.5')
  })

  it('自定义 escapes a quote inside the value by doubling it', () => {
    expect(defaultToWire('custom', "it's")).toBe("'it''s'")
  })

  it('NULL sends NULL', () => {
    expect(defaultToWire('null', '')).toBe('NULL')
  })

  it('CURRENT_TIMESTAMP sends the keyword', () => {
    expect(defaultToWire('currentTimestamp', '')).toBe('CURRENT_TIMESTAMP')
  })

  it('lists the modes in the order the dropdown shows them', () => {
    expect([...DEFAULT_MODES]).toEqual(['none', 'custom', 'null', 'currentTimestamp'])
  })
})

/**
 * `inferDefault` reads back what the server REPORTED, so the 结构 tab's column editor can
 * offer the same four-state control the 新建表 form uses.
 *
 * The two engines report the same value differently, and the difference is what makes a
 * single rule wrong: MySQL strips a string's quotes and reports `DEFAULT NULL` as no
 * value at all, while SQLite keeps the quotes and reports `NULL` explicitly.
 */
describe('inferDefault: what the server reported, in the form the editor shows', () => {
  it('MySQL: an empty reported value is the empty-string default, not "no default"', () => {
    /*
     * The one that matters most. MySQL reports `DEFAULT ''` as an empty string, and the
     * editor used to render that as an empty box, so submitting it dropped the default to
     * NULL — a silent data-definition change. It has to come back as 自定义 with a blank
     * box, which is the value the empty string needs.
     */
    expect(inferDefault('mysql', '')).toEqual({ mode: 'custom', text: '' })
    // And an ABSENT value really is no default. MySQL reports `DEFAULT NULL` this way
    // too, which is honest: NULL and "no DEFAULT clause" are the same state there.
    expect(inferDefault('mysql', undefined)).toEqual({ mode: 'none', text: '' })
  })

  it('MySQL: a string default comes back unquoted', () => {
    expect(inferDefault('mysql', 'x')).toEqual({ mode: 'custom', text: 'x' })
    // A number is shown as the number it is, not as a string.
    expect(inferDefault('mysql', '5')).toEqual({ mode: 'custom', text: '5' })
    // So is a keyword or an expression, which are shown verbatim.
    expect(inferDefault('mysql', 'CURRENT_TIMESTAMP')).toEqual({ mode: 'currentTimestamp', text: '' })
    expect(inferDefault('mysql', "lower(_utf8mb4\\'ABC\\')")).toEqual({ mode: 'custom', text: "lower(_utf8mb4\\'ABC\\')" })
  })

  it('SQLite: a string default keeps its quotes, so they are stripped for display', () => {
    // SQLite reports `''` as the two-character text `''`, NOT as an empty value — reading
    // it as MySQL's empty string would show an empty box for a default that is one.
    expect(inferDefault('sqlite', "''")).toEqual({ mode: 'custom', text: '' })
    expect(inferDefault('sqlite', "'x'")).toEqual({ mode: 'custom', text: 'x' })
    // A doubled quote is one quote.
    expect(inferDefault('sqlite', "'it''s'")).toEqual({ mode: 'custom', text: "it's" })
    expect(inferDefault('sqlite', '5')).toEqual({ mode: 'custom', text: '5' })
    expect(inferDefault('sqlite', 'NULL')).toEqual({ mode: 'null', text: '' })
  })

  it('round-trips through defaultToWire', () => {
    /*
     * The pairing has to be consistent, or an untouched control would change the column.
     * Checked for the shapes both formats share; MySQL's unquoted string is excluded
     * because `defaultToWire` quotes it, which is the intended difference (it turns the
     * reported `x` back into the literal `'x'`).
     */
    for (const [kind, raw] of [['sqlite', "'x'"], ['sqlite', "''"], ['sqlite', '5'], ['mysql', '5']] as const) {
      const seed = inferDefault(kind, raw)
      expect(defaultToWire(seed.mode, seed.text), `${kind} ${raw}`).toBe(raw)
    }
  })
})

describe('quoteDefaultLiteral', () => {
  it('treats a lone quote character as text', () => {
    // A single `'` is not a quoted literal, so it must be escaped rather than passed through.
    expect(quoteDefaultLiteral("'")).toBe("''''")
  })

  it('trims surrounding whitespace', () => {
    expect(quoteDefaultLiteral('  abc  ')).toBe("'abc'")
  })
})

describe('takesLength: a length belongs to its type, so it must be dropped with it', () => {
  it('keeps a length for the character types that use one', () => {
    for (const type of ['VARCHAR', 'CHAR', 'BINARY', 'VARBINARY', 'DECIMAL']) {
      expect(takesLength(type)).toBe(true)
    }
  })

  it('drops a length for types without a character width', () => {
    // Measured: TIMESTAMP(255) is refused by MySQL with "Invalid default value for 'v'", which
    // names the DEFAULT and not the length.
    for (const type of ['INT', 'BIGINT', 'TIMESTAMP', 'DATETIME', 'DATE', 'TEXT', 'LONGTEXT', 'JSON', 'BOOLEAN', 'POINT']) {
      expect(takesLength(type)).toBe(false)
    }
  })

  it('is case-insensitive and tolerant of surrounding space', () => {
    expect(takesLength('  int  ')).toBe(false)
    expect(takesLength('varchar')).toBe(true)
  })

  it('keeps the length when the type is not yet known', () => {
    // An empty type is a row being filled in; clearing its length would fight the user.
    expect(takesLength('')).toBe(true)
  })
})

describe('requiresLengthOrValues: the types MySQL refuses without parentheses', () => {
  it('requires one for the four types measured to be a syntax error without it', () => {
    // Measured on 8.0: `CREATE TABLE t (v VARCHAR NOT NULL)` is refused with "syntax error
    // near 'NOT NULL'", which names neither the column nor the missing length.
    for (const type of ['VARCHAR', 'VARBINARY', 'ENUM', 'SET']) {
      expect(requiresLengthOrValues(type)).toBe(true)
    }
  })

  it('does NOT require one for the types MySQL accepts bare', () => {
    /*
     * CHAR and BINARY are the counter-intuitive ones: both default to 1, measured accepted with
     * no parentheses. Requiring a length for them would demand input the engine does not need.
     */
    for (const type of ['CHAR', 'BINARY', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL', 'INT', 'BIGINT', 'TEXT', 'BLOB', 'TIMESTAMP', 'DATETIME', 'BIT']) {
      expect(requiresLengthOrValues(type)).toBe(false)
    }
  })

  it('accepts a type that already carries its own parentheses', () => {
    // `enum('a','b')` and `varchar(30)` are complete types; a separate length is not wanted.
    expect(requiresLengthOrValues("enum('a','b')")).toBe(false)
    expect(requiresLengthOrValues('VARCHAR(30)')).toBe(false)
    expect(requiresLengthOrValues('varchar(30)')).toBe(false)
  })

  it('asks for nothing when the type is still empty', () => {
    // The row is being filled in; the missing type has its own, earlier message.
    expect(requiresLengthOrValues('')).toBe(false)
  })

  it('is case-insensitive and tolerant of surrounding space', () => {
    expect(requiresLengthOrValues('  varchar  ')).toBe(true)
    expect(requiresLengthOrValues('VarBinary')).toBe(true)
  })
})

describe('supportsCurrentTimestamp', () => {
  it('allows the temporal types', () => {
    expect(supportsCurrentTimestamp('TIMESTAMP')).toBe(true)
    expect(supportsCurrentTimestamp('DATETIME')).toBe(true)
  })

  it('refuses everything else, which is what MySQL does', () => {
    // Measured: "Invalid default value for 'v'" on VARCHAR and INT.
    for (const type of ['VARCHAR', 'INT', 'TEXT', 'DATE', 'TIME', 'JSON']) {
      expect(supportsCurrentTimestamp(type)).toBe(false)
    }
  })
})

describe('nullDefaultNeedsNullable: NOT NULL + DEFAULT NULL, which MySQL refuses', () => {
  it('flags the combination on MySQL', () => {
    // Measured on 8.0: `v VARCHAR(50) NOT NULL DEFAULT NULL` → "Invalid default value for 'v'",
    // a message naming neither 允许空 nor the contradiction.
    expect(nullDefaultNeedsNullable('mysql', false, 'null')).toBe(true)
  })

  it('does not flag it when the column accepts NULL', () => {
    expect(nullDefaultNeedsNullable('mysql', true, 'null')).toBe(false)
  })

  it('does not flag any other default mode', () => {
    // `DEFAULT NULL` is the only mode that contradicts NOT NULL; no DEFAULT clause on a NOT NULL
    // column is perfectly ordinary (the INSERT must supply the value).
    expect(nullDefaultNeedsNullable('mysql', false, 'none')).toBe(false)
    expect(nullDefaultNeedsNullable('mysql', false, 'custom')).toBe(false)
    expect(nullDefaultNeedsNullable('mysql', false, 'currentTimestamp')).toBe(false)
  })

  it('does not flag it on SQLite, which ACCEPTS the DDL', () => {
    // Measured: SQLite creates `v TEXT NOT NULL DEFAULT NULL` without complaint and only fails if
    // a row actually inserts NULL. Refusing it in the form would reject a table SQLite allows.
    expect(nullDefaultNeedsNullable('sqlite', false, 'null')).toBe(false)
  })
})

describe('autoIncrementBlocker', () => {
  it('refuses a column that is not part of the primary key', () => {
    expect(autoIncrementBlocker('mysql', { indexKind: '', type: 'INT' })).toBe('notKey')
  })

  it('allows a numeric primary-key column on MySQL', () => {
    expect(autoIncrementBlocker('mysql', { indexKind: 'primary', type: 'INT' })).toBeUndefined()
    expect(autoIncrementBlocker('mysql', { indexKind: 'primary', type: 'BIGINT' })).toBeUndefined()
  })

  it('refuses a non-numeric primary-key column on MySQL', () => {
    expect(autoIncrementBlocker('mysql', { indexKind: 'primary', type: 'VARCHAR' })).toBe('notNumeric')
    expect(autoIncrementBlocker('mysql', { indexKind: 'primary', type: 'TEXT' })).toBe('notNumeric')
  })

  it('requires the exact type INTEGER on SQLite', () => {
    // SQLite's AUTOINCREMENT is legal only on the INTEGER PRIMARY KEY rowid alias. `INT` is
    // accepted as a type name but is NOT the alias, so it would silently not auto-increment.
    expect(autoIncrementBlocker('sqlite', { indexKind: 'primary', type: 'INTEGER' })).toBeUndefined()
    expect(autoIncrementBlocker('sqlite', { indexKind: 'primary', type: 'INT' })).toBe('notInteger')
    expect(autoIncrementBlocker('sqlite', { indexKind: 'primary', type: 'BIGINT' })).toBe('notInteger')
  })

  it('reports the key problem before the type problem, since it is fixed first', () => {
    // A VARCHAR column that is not a key has two problems; the message must name the one to
    // change first rather than a requirement that may already hold.
    expect(autoIncrementBlocker('mysql', { indexKind: '', type: 'VARCHAR' })).toBe('notKey')
  })
})
