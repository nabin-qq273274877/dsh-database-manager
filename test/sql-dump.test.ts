/**
 * Export/import tests: SQL dump rendering and CSV encode/decode.
 *
 * The CSV decoder gets the most attention because a mistake in it does not fail
 * loudly — it splits a record in the wrong place and inserts the halves as two
 * rows. Each case here is something a real file contains: an embedded
 * separator, an embedded newline, a doubled quote, a BOM from Excel.
 */

import { describe, expect, it } from 'vitest'

import {
  csvCell,
  dumpDatabase,
  dumpInserts,
  dumpTable,
  mysqlLiteral,
  parseCsv,
  parseCsvTable,
  sqliteLiteral,
  toCsv,
  type CellValue,
  type DumpDialect,
  type DumpTable,
} from '../src/sql-dump.ts'

/** A SQLite-shaped dialect for the dump tests. */
const sqliteDialect: DumpDialect = {
  quote: name => `"${name.replace(/"/g, '""')}"`,
  literal: sqliteLiteral,
  statementEnd: ';',
  header: ['PRAGMA foreign_keys=OFF;'],
}

/** A MySQL-shaped dialect. */
const mysqlDialect: DumpDialect = {
  quote: name => `\`${name.replace(/`/g, '``')}\``,
  literal: mysqlLiteral,
  statementEnd: ';',
  header: ['SET NAMES utf8mb4;'],
}

describe('literals', () => {
  it('quotes strings and escapes the engine-specific characters', () => {
    expect(sqliteLiteral("a'b")).toBe("'a''b'")
    expect(sqliteLiteral('a\\b')).toBe("'a\\b'")
    expect(mysqlLiteral("a'b")).toBe("'a''b'")
    // A backslash must be escaped for MySQL: an unescaped trailing one inside a
    // string literal swallows the closing quote.
    expect(mysqlLiteral('a\\b')).toBe("'a\\\\b'")
    expect(mysqlLiteral('trailing\\')).toBe("'trailing\\\\'")
  })

  it('renders null, numbers and booleans', () => {
    expect(sqliteLiteral(null)).toBe('NULL')
    expect(sqliteLiteral(42)).toBe('42')
    expect(sqliteLiteral(-1.5)).toBe('-1.5')
    // SQLite stores a boolean as 0/1; emitting the word would be a syntax error.
    expect(sqliteLiteral(true)).toBe('1')
    expect(sqliteLiteral(false)).toBe('0')
    expect(mysqlLiteral(true)).toBe('1')
  })
})

describe('dumpInserts', () => {
  const table: DumpTable = {
    name: 't',
    columns: ['id', 'v'],
    rows: [
      { id: 1, v: 'a' },
      { id: 2, v: null },
      { id: 3, v: "it's" },
    ],
  }

  it('batches rows into one INSERT per chunk', () => {
    const statements = dumpInserts(table, sqliteDialect, 2)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('VALUES\n(1, \'a\'),\n(2, NULL);')
    expect(statements[1]).toContain("(3, 'it''s');")
    expect(statements[0]).toContain('INSERT INTO "t" ("id", "v")')
  })

  it('emits nothing for a table with no rows', () => {
    expect(dumpInserts({ ...table, rows: [] }, sqliteDialect)).toEqual([])
    expect(dumpInserts({ ...table, columns: [] }, sqliteDialect)).toEqual([])
  })
})

describe('dumpTable', () => {
  const table: DumpTable = {
    name: 't',
    create: 'CREATE TABLE "t" (\n  "id" INTEGER\n)',
    columns: ['id'],
    rows: [{ id: 1 }],
  }

  it('includes structure and data, with a DROP when asked', () => {
    const text = dumpTable(table, sqliteDialect, { structure: true, data: true, drop: true })
    expect(text).toContain('DROP TABLE IF EXISTS "t";')
    expect(text).toContain('CREATE TABLE "t" (')
    expect(text).toContain('INSERT INTO "t" ("id") VALUES\n(1);')
  })

  it('omits the DROP when it is not asked for', () => {
    const text = dumpTable(table, sqliteDialect, { structure: true, data: false, drop: false })
    expect(text).not.toContain('DROP TABLE')
    expect(text).not.toContain('INSERT INTO')
  })

  it('says so rather than inventing structure it could not read', () => {
    const text = dumpTable({ ...table, create: undefined }, sqliteDialect, { structure: true, data: false, drop: false })
    expect(text).toContain('未取得')
  })

  it('marks a truncated table', () => {
    const text = dumpTable({ ...table, truncated: true }, sqliteDialect, { structure: false, data: true, drop: false })
    expect(text).toContain('截断')
  })
})

describe('dumpDatabase', () => {
  it('warns when the dump would replace existing tables', () => {
    const text = dumpDatabase([{ name: 't', create: 'CREATE TABLE t(id int)', columns: ['id'], rows: [] }], mysqlDialect, { structure: true, data: true, drop: true }, 'test')
    // A DROP + data dump imported onto a live database replaces it. That has to
    // be stated in the file, not only in the dialog that produced it.
    expect(text).toContain('会先删除同名表')
    expect(text).toContain('SET NAMES utf8mb4;')
    expect(text).toContain('`t`')
  })
})

describe('csvCell', () => {
  it('quotes what has to be quoted', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('a\nb')).toBe('"a\nb"')
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"')
  })

  it('quotes a leading formula character so a spreadsheet reads it as text', () => {
    // Unquoted, Excel and Sheets would evaluate it on open.
    expect(csvCell('=1+1')).toBe('"=1+1"')
    expect(csvCell('+1')).toBe('"+1"')
    expect(csvCell('-1')).toBe('"-1"')
    expect(csvCell('@x')).toBe('"@x"')
    // A negative NUMBER is not a formula and must stay numeric: quoting it would
    // make the column text on re-import.
    expect(csvCell(-1)).toBe('-1')
    expect(csvCell(-1.5)).toBe('-1.5')
  })

  it('writes NULL as an empty field', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(true)).toBe('1')
  })
})

describe('toCsv', () => {
  it('writes a header and CRLF line endings', () => {
    const text = toCsv(['a', 'b'], [{ a: '1', b: 'x,y' }, { a: null, b: 'z' }])
    expect(text).toBe('a,b\r\n1,"x,y"\r\n,z\r\n')
  })
})

describe('parseCsv', () => {
  it('handles the shapes a real file contains', () => {
    expect(parseCsv('a,b')).toEqual([['a', 'b']])
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a,b\r1,2\r')).toEqual([['a', 'b'], ['1', '2']])
    // A trailing newline must not produce a final empty record.
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']])
    expect(parseCsv('a,b\n\n')).toEqual([['a', 'b'], ['']])
  })

  it('strips a UTF-8 BOM', () => {
    // Excel writes one; left in place it becomes part of the first column name.
    expect(parseCsv('\ufeffa,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('keeps a separator or a newline inside a quoted field', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']])
    expect(parseCsv('"a\nb",c')).toEqual([['a\nb', 'c']])
    expect(parseCsv('"a\r\nb",c')).toEqual([['a\r\nb', 'c']])
    expect(parseCsv('"a""b",c')).toEqual([['a"b', 'c']])
    expect(parseCsv('"",c')).toEqual([['', 'c']])
    expect(parseCsv('"  a  ",c')).toEqual([['  a  ', 'c']])
  })

  it('treats a quote in the middle of an unquoted field as a literal', () => {
    // A naive exporter writes this. Treating the quote as an opener would
    // swallow the rest of the record.
    expect(parseCsv('ab"cd,e')).toEqual([['ab"cd', 'e']])
  })

  it('round-trips what toCsv produced', () => {
    const rows = [
      { a: 'x,y', b: 'q"r' },
      { a: 'line\nbreak', b: '=formula' },
      { a: '', b: 'plain' },
    ]
    expect(parseCsv(toCsv(['a', 'b'], rows))).toEqual([
      ['a', 'b'],
      ['x,y', 'q"r'],
      ['line\nbreak', '=formula'],
      ['', 'plain'],
    ])
  })
})

describe('parseCsvTable', () => {
  it('keys records by the header', () => {
    const parsed = parseCsvTable('id,name\r\n1,alice\r\n2,bob\r\n', { hasHeader: true })
    expect(parsed.columns).toEqual(['id', 'name'])
    expect(parsed.rows).toEqual([{ id: '1', name: 'alice' }, { id: '2', name: 'bob' }])
    expect(parsed.malformed).toEqual([])
  })

  it('uses the table columns when the file has no header', () => {
    const parsed = parseCsvTable('1,alice\r\n2,bob\r\n', { hasHeader: false, expected: ['id', 'name'] })
    expect(parsed.columns).toEqual(['id', 'name'])
    expect(parsed.rows[0]).toEqual({ id: '1', name: 'alice' })
  })

  it('reports a record whose field count disagrees, rather than guessing', () => {
    const parsed = parseCsvTable('id,name\r\n1,alice\r\n2\r\n', { hasHeader: true })
    expect(parsed.rows).toEqual([{ id: '1', name: 'alice' }])
    // Line 3 of the file, i.e. header(1) + first record(2) + this one.
    expect(parsed.malformed).toEqual([{ line: 3, fields: 1 }])
  })

  it('refuses a file it cannot interpret', () => {
    expect(() => parseCsvTable('', { hasHeader: true })).toThrow(/no rows/)
    expect(() => parseCsvTable('id,id\r\n1,2\r\n', { hasHeader: true })).toThrow(/twice/)
    expect(() => parseCsvTable('id,,x\r\n1,2,3\r\n', { hasHeader: true })).toThrow(/empty column name/)
    expect(() => parseCsvTable('1,2\r\n', { hasHeader: false })).toThrow(/no header/)
  })

  it('accepts a header-only file as zero rows', () => {
    const parsed = parseCsvTable('id,name\r\n', { hasHeader: true })
    expect(parsed.rows).toEqual([])
  })
})

describe('a full dump/import round trip through CSV', () => {
  it('survives values with separators, quotes and newlines', () => {
    const columns = ['id', 'note']
    const original: Array<Record<string, CellValue>> = [
      { id: 1, note: 'a,b' },
      { id: 2, note: 'say "hi"' },
      { id: 3, note: 'two\nlines' },
      { id: 4, note: null },
    ]
    const csv = toCsv(columns, original)
    const parsed = parseCsvTable(csv, { hasHeader: true })
    expect(parsed.malformed).toEqual([])
    expect(parsed.rows.map(row => row['note'])).toEqual(['a,b', 'say "hi"', 'two\nlines', ''])
  })
})
