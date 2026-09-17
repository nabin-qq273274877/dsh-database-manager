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
  quoteDefaultLiteral,
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
