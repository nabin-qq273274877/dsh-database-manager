/**
 * Export and import: SQL dump generation and CSV encoding/decoding.
 *
 * Pure text handling, kept out of the drivers because none of it is
 * engine-specific — a MySQL dump and a SQLite dump differ only in how
 * identifiers and values are quoted, which the caller passes in.
 *
 * ## Why the *decoder* is the risky part
 *
 * Exporting is mechanical. Importing is where a mistake destroys data, so the
 * CSV reader is written to the standard that phpMyAdmin and Excel actually
 * write, not to a simplified one: quoted fields with embedded separators and
 * newlines, `""` as an escaped quote, CRLF line endings, and a UTF-8 BOM.
 * A parser that gets any of those wrong does not fail loudly — it splits a row
 * in the wrong place and inserts the halves as two rows.
 */

/** A value as the wire and the engines represent it. */
export type CellValue = string | number | boolean | null

/** How a dialect quotes identifiers and renders literals. */
export interface DumpDialect {
  /** Quote an identifier. */
  quote(name: string): string
  /** Render a value as a SQL literal. */
  literal(value: CellValue): string
  /** Statement terminator, with the newline that follows it. */
  statementEnd: string
  /** Extra header lines for the dump (a `SET` preamble, a `PRAGMA`, …). */
  header?: string[]
  /** Whether the engine needs the table's own `CREATE` text indexed by name. */
  dropBeforeCreate?: boolean
}

/** One table's contribution to a dump. */
export interface DumpTable {
  name: string
  /** The engine's own `CREATE TABLE` text, or undefined when unavailable. */
  create?: string
  /**
   * DDL the table needs beyond its `CREATE TABLE`.
   *
   * SQLite keeps indexes and triggers as separate schema objects, so its
   * `CREATE TABLE` text does not mention them and a dump built from that text
   * alone would silently lose every index on the table. MySQL inlines them,
   * and returns nothing here.
   */
  auxiliary?: string[]
  columns: string[]
  /**
   * Columns the engine computes and an `INSERT` must not name.
   *
   * Kept separate from `columns` because the row data still carries them (the
   * SELECT returned them) while the INSERT must not: MySQL and SQLite both
   * refuse an insert into a generated column, so naming one makes the whole dump
   * un-importable.
   */
  generated?: string[]
  rows: Array<Record<string, CellValue>>
  /** True when the rows were cut by the export's cap. */
  truncated?: boolean
}

/**
 * Render a value as a SQLite literal.
 *
 * Numbers are emitted bare; strings are quoted with doubled quotes; NULL is
 * `NULL`. A `boolean` has no SQLite type of its own (SQLite stores 0/1) and is
 * emitted as such so a round trip through a dump is type-stable.
 */
export function sqliteLiteral(value: CellValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : `'${String(value)}'`
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Render a value as a MySQL literal.
 *
 * Backslashes are escaped as well as quotes, because MySQL's default
 * `NO_BACKSLASH_ESCAPES`-off mode treats a backslash inside a string as an
 * escape — a value ending in `\` would otherwise swallow its own closing quote.
 */
export function mysqlLiteral(value: CellValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : `'${String(value)}'`
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

/**
 * Render a table's rows as `INSERT` statements.
 *
 * Batched — one statement per `rowsPerStatement` rows — because a dump with one
 * statement per row is orders of magnitude slower to import on any engine: each
 * statement is its own transaction and its own round trip. phpMyAdmin's default
 * is the same shape.
 *
 * A generated column is excluded from both the column list and the tuples. That
 * is not an optimisation: MySQL refuses the insert outright ("The value
 * specified for generated column … is not allowed") and SQLite answers "cannot
 * INSERT into generated column", so a dump that included one could not be
 * imported at all. The engine recomputes it from the columns that remain, which
 * is what makes the restored table carry the same values.
 *
 * @param insertable - column names to write; defaults to `table.columns`, and is
 *   what a caller passes when it knows which columns are generated.
 */
export function dumpInserts(
  table: DumpTable,
  dialect: DumpDialect,
  rowsPerStatement = 100,
  insertable?: string[],
): string[] {
  const columns = (insertable ?? table.columns).filter(column => table.columns.includes(column))
  if (table.rows.length === 0 || columns.length === 0) return []
  const names = columns.map(column => dialect.quote(column)).join(', ')
  const terminator = dialect.statementEnd.endsWith('\n') ? dialect.statementEnd.trimEnd() : dialect.statementEnd
  const statements: string[] = []
  for (let at = 0; at < table.rows.length; at += rowsPerStatement) {
    const chunk = table.rows.slice(at, at + rowsPerStatement)
    const tuples = chunk
      .map(row => `(${columns.map(column => dialect.literal(row[column] ?? null)).join(', ')})`)
      .join(',\n')
    statements.push(`INSERT INTO ${dialect.quote(table.name)} (${names}) VALUES\n${tuples}${terminator}`)
  }
  return statements
}

/** Options for {@link dumpTable}. */
export interface DumpOptions {
  /** Include `CREATE` statements. */
  structure: boolean
  /** Include `INSERT` statements. */
  data: boolean
  /** `DROP TABLE IF EXISTS` before each `CREATE`. */
  drop: boolean
  /** Rows per `INSERT`; see {@link dumpInserts}. */
  rowsPerStatement?: number
}

/** Render one table (structure and/or data) as a SQL dump fragment. */
export function dumpTable(table: DumpTable, dialect: DumpDialect, options: DumpOptions): string {
  const parts: string[] = []
  if (options.structure) {
    parts.push(`--\n-- 表结构：${table.name}\n--`)
    if (options.drop || dialect.dropBeforeCreate === true) parts.push(`DROP TABLE IF EXISTS ${dialect.quote(table.name)}${dialect.statementEnd}`)
    if (table.create !== undefined && table.create.trim() !== '') {
      // The engine's own text, terminated. It is used verbatim on purpose: it is
      // the complete description of the table, and re-deriving it here would
      // drop whatever this module does not model.
      parts.push(`${table.create.replace(/;*\s*$/, '')}${dialect.statementEnd}`)
    } else {
      parts.push(`-- （未取得 ${table.name} 的建表语句，已跳过结构）`)
    }
    // DDL the table needs beyond its CREATE TABLE — SQLite's indexes and
    // triggers live outside it, and a dump built from the CREATE text alone
    // would lose them. It comes straight after, before any data: an index is
    // cheaper to maintain while the rows are inserted than to build afterwards,
    // and a trigger has to exist before the rows it is meant to fire on.
    for (const statement of table.auxiliary ?? []) {
      parts.push(statement.endsWith(';') ? statement : `${statement}${dialect.statementEnd}`)
    }
  }
  if (options.data) {
    if (table.rows.length > 0) {
      parts.push(`--\n-- 表数据：${table.name}${table.truncated === true ? '（已按导出上限截断）' : ''}\n--`)
      const insertable = table.generated === undefined || table.generated.length === 0
        ? table.columns
        : table.columns.filter(column => !table.generated!.includes(column))
      if (insertable.length === 0) {
        parts.push(`-- （${table.name} 的列全部由数据库计算，没有可写入的数据）`)
      } else {
        if (insertable.length !== table.columns.length) {
          // Said out loud, so a reader diffing the dump against the table is not
          // left wondering why a column is missing from the INSERT list.
          parts.push(`-- 生成列（由数据库计算，导入时自动得出）：${table.columns.filter(column => !insertable.includes(column)).join(', ')}`)
        }
        parts.push(...dumpInserts(table, dialect, options.rowsPerStatement ?? 100, insertable))
      }
    } else {
      parts.push(`--\n-- 表数据：${table.name}（无行）\n--`)
    }
  }
  return parts.join('\n')
}

/** Assemble a whole dump: a header, then each table's fragment. */
export function dumpDatabase(tables: DumpTable[], dialect: DumpDialect, options: DumpOptions, comment: string): string {
  const lines: string[] = [`-- ${comment}`, `-- 导出时间：${new Date().toISOString()}`]
  if (options.drop && options.data) {
    // Said out loud, because the DROP statements above mean importing this dump
    // onto an existing database REPLACES its tables rather than adding to them.
    lines.push('-- 注意：本文件包含 DROP TABLE，导入到已有数据库会先删除同名表。')
  }
  if (dialect.header !== undefined) lines.push(...dialect.header)
  const body = tables.map(table => dumpTable(table, dialect, options))
  return `${lines.join('\n')}\n\n${body.join('\n\n')}\n`
}

// ---- CSV ------------------------------------------------------------------

/**
 * Whether a STRING cell must be quoted to be read as text rather than a formula.
 *
 * A leading `=`/`+`/`-`/`@` is what Excel and Sheets interpret as the start of a
 * formula, so exporting a text column holding `=1+1` would hand the reader a
 * live formula. Quoting turns it back into text.
 *
 * Applies to strings only: a negative NUMBER is written by the numeric path and
 * quoting it would make the column text on re-import.
 */
function csvLooksLikeFormula(text: string): boolean {
  return /^[=+\-@\t]/.test(text)
}

/**
 * Encode a value for a CSV cell.
 *
 * NULL becomes an empty field — indistinguishable from the empty string, which
 * is the accepted CSV limitation and matches what phpMyAdmin exports. It is
 * stated here rather than papered over with a sentinel such as `\N`, because a
 * sentinel would corrupt a genuine value equal to it.
 */
export function csvCell(value: CellValue): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : `"${String(value)}"`
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return csvLooksLikeFormula(value) ? `"${value}"` : value
}

/**
 * Encode rows as CSV.
 *
 * CRLF line endings, which is what RFC 4180 specifies and what Excel expects;
 * `\n` alone is accepted by most readers but shows as a single line in Excel on
 * Windows.
 */
export function toCsv(columns: string[], rows: Array<Record<string, CellValue>>): string {
  const lines = [columns.map(column => csvCell(column)).join(',')]
  for (const row of rows) lines.push(columns.map(column => csvCell(row[column] ?? null)).join(','))
  return `${lines.join('\r\n')}\r\n`
}

/**
 * Parse CSV text into rows of fields.
 *
 * Written to what real files contain rather than to a simplified grammar:
 *
 * - a UTF-8 BOM is stripped (Excel writes one, and it would otherwise become
 *   part of the first header name);
 * - quoted fields may contain the separator, CRLF or a lone LF;
 * - `""` inside a quoted field is one literal quote;
 * - a `\r\n` or a lone `\r` or `\n` all end a record;
 * - a trailing newline does not produce a final empty record.
 *
 * @returns every record including the header, as raw fields. The caller decides
 *   whether the first record is a header.
 */
export function parseCsv(text: string): string[][] {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const n = withoutBom.length

  while (i < n) {
    const ch = withoutBom[i]!
    if (quoted) {
      if (ch === '"') {
        if (withoutBom[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && field === '') {
      // A quote only OPENS a field at its start. A quote appearing mid-field is
      // a literal character, which is what a file written by a naive exporter
      // into an unquoted cell contains — treating it as an opener would swallow
      // the rest of the record.
      quoted = true
      i++
      continue
    }
    if (ch === ',') {
      record.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      record.push(field)
      field = ''
      rows.push(record)
      record = []
      // CRLF counts as one terminator.
      i += ch === '\r' && withoutBom[i + 1] === '\n' ? 2 : 1
      continue
    }
    field += ch
    i++
  }

  // A final record only exists when the file did not end on a terminator.
  if (field !== '' || record.length > 0) {
    record.push(field)
    rows.push(record)
  }
  return rows
}

/** A parsed CSV file: its header and its records, keyed by column. */
export interface ParsedCsv {
  columns: string[]
  rows: Array<Record<string, string>>
  /** Records whose field count did not match the header's. */
  malformed: Array<{ line: number; fields: number }>
}

/**
 * Parse CSV into records keyed by the header.
 *
 * @param expected - the table's column names, when the file has no header. Used
 *   to name the fields in that case.
 * @param hasHeader - whether the first record names the columns.
 * @throws when the file is empty, or a header-named column cannot be used.
 */
export function parseCsvTable(text: string, options: { hasHeader: boolean; expected?: string[] }): ParsedCsv {
  const records = parseCsv(text)
  if (records.length === 0) throw new Error('the file contains no rows')

  let columns: string[]
  let body: string[][]
  if (options.hasHeader) {
    const header = records[0]!.map(name => name.trim())
    if (header.length === 0) throw new Error('the header line is empty')
    if (header.some(name => name === '')) throw new Error('the header line has an empty column name')
    const seen = new Set<string>()
    for (const name of header) {
      if (seen.has(name)) throw new Error(`the header names "${name}" twice`)
      seen.add(name)
    }
    columns = header
    body = records.slice(1)
  } else {
    const expected = options.expected
    if (expected === undefined || expected.length === 0) {
      throw new Error('this file has no header, so the target table must already be known')
    }
    columns = expected
    body = records
  }

  const rows: Array<Record<string, string>> = []
  const malformed: Array<{ line: number; fields: number }> = []
  for (const [index, record] of body.entries()) {
    if (record.length !== columns.length) {
      // Reported rather than coerced: a row with the wrong field count means the
      // file's quoting disagrees with its header, and guessing which column each
      // value belongs to would insert wrong data into the right columns.
      malformed.push({ line: (options.hasHeader ? index + 2 : index + 1), fields: record.length })
      continue
    }
    const row: Record<string, string> = {}
    for (const [position, column] of columns.entries()) row[column] = record[position] ?? ''
    rows.push(row)
  }
  return { columns, rows, malformed }
}
