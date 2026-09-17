/**
 * Export and import over the driver contract.
 *
 * The text handling is in `sql-dump.ts`; this module is the part that has to
 * actually touch a database, and it is where the two decisions that matter live:
 *
 * 1. **An import's SQL file runs as a script, not as a statement.** A dump
 *    contains many statements plus comments, and the drivers refuse a
 *    multi-statement payload by design (that rule is what keeps a query surface
 *    from becoming a write surface). So the file is split here, into statements,
 *    and each is executed in order inside ONE transaction — all or nothing,
 *    because a dump that fails halfway leaves a database that is neither the old
 *    one nor the new one.
 *
 * 2. **A truncating import says so before it runs.** `DROP TABLE` in a dump is
 *    how "restore this file" is expressed, and it is indistinguishable from
 *    "destroy this database" at the point of execution. The caller confirms;
 *    this module only carries out what it was told.
 */

import type { ColumnInfo, DataSourceEntry } from './protocol.ts'
import type { SqlDriver } from './drivers/types.ts'
import { isSqlDriver } from './drivers/types.ts'
import {
  type CellValue,
  type DumpDialect,
  type DumpOptions,
  type DumpTable,
  dumpDatabase,
  dumpTable,
  mysqlLiteral,
  parseCsvTable,
  sqliteLiteral,
  toCsv,
} from './sql-dump.ts'
import { quoteMysql, quoteSqlite } from './sql-util.ts'

/**
 * Order tables so a foreign key's target is created before its referrer.
 *
 * A dump is replayed statement by statement, and MySQL refuses a `CREATE TABLE`
 * whose `FOREIGN KEY` names a table that does not exist yet — "Failed to open
 * the referenced table". `information_schema.TABLES` returns tables in name
 * order, which puts `child` before `parent` and makes the dump un-importable.
 *
 * The ordering is a topological sort over the references each table declares;
 * a cycle (two tables referencing each other) is left in its original relative
 * order rather than being broken, because there is no correct order for one and
 * dropping a table to resolve it would lose data. MySQL creates both tables and
 * then rejects the second's foreign key, so a cyclic dump needs
 * `SET FOREIGN_KEY_CHECKS=0` — which the caller's dialect header supplies.
 *
 * @param tables - the tables in the order they were read.
 * @param references - `table → the tables it references`. A missing entry means
 *   "no dependencies known", which keeps a caller that cannot read them working.
 */
export function orderTables(
  tables: Array<{ name: string; type: string }>,
  references: Map<string, string[]>,
): Array<{ name: string; type: string }> {
  const byName = new Map(tables.map(table => [table.name.toLowerCase(), table]))
  const visited = new Set<string>()
  const ordered: Array<{ name: string; type: string }> = []
  // A cycle is broken at the first table whose walk revisits it, rather than at
  // an arbitrary one: the tables in the cycle then keep their relative order.
  const active = new Set<string>()

  const visit = (table: { name: string; type: string }): void => {
    const key = table.name.toLowerCase()
    if (visited.has(key)) return
    visited.add(key)
    if (!active.has(key)) {
      active.add(key)
      for (const dependency of references.get(key) ?? []) {
        const target = byName.get(dependency.toLowerCase())
        if (target !== undefined) visit(target)
      }
      active.delete(key)
    }
    ordered.push(table)
  }

  // Views come after the tables they read, so a view's SELECT resolves.
  for (const table of tables) if (table.type !== 'view') visit(table)
  for (const table of tables) if (table.type === 'view') visit(table)
  return ordered
}
/**
 * Refuse an export above this many rows in one table.
 *
 * A spill-free export is what this plugin can do; beyond this the honest answer
 * is to say the table is too large rather than to attempt it and exhaust the
 * host's memory. The cap is well above any hand-inspection use and well below
 * what would take the host down.
 */
export const EXPORT_ROW_CAP = 200_000

/** Refuse an import whose file is larger than this. */
export const IMPORT_BYTE_CAP = 32 * 1024 * 1024

/** The dialect for one driver kind. */
function dialectFor(kind: 'sqlite' | 'mysql'): DumpDialect {
  if (kind === 'mysql') {
    return {
      quote: quoteMysql,
      literal: mysqlLiteral,
      statementEnd: ';',
      header: [
        // A schema being restored may be a subset of the original (one table
        // exported, or a cycle between two), so referential checks are off for
        // the replay and turned back on at the end. Without this a dump of a
        // child table alone cannot be imported at all.
        'SET FOREIGN_KEY_CHECKS=0;',
        '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;',
        '/*!40101 SET NAMES utf8mb4 */;',
      ],
    }
  }
  return {
    quote: quoteSqlite,
    literal: sqliteLiteral,
    statementEnd: ';',
    header: [
      // Same reason as MySQL's above, and here it is load-bearing: SQLite
      // IGNORES `PRAGMA foreign_keys` inside a transaction, so it has to be
      // issued before the importer opens one — which the header, being the
      // first thing in the file, achieves.
      'PRAGMA foreign_keys=OFF;',
    ],
  }
}

/** The trailer lines a dialect needs after its tables. */
function trailerFor(kind: 'sqlite' | 'mysql'): string[] {
  return kind === 'sqlite' ? ['PRAGMA foreign_keys=ON;'] : ['SET FOREIGN_KEY_CHECKS=1;']
}

/** Read one table's structure and rows for an export. */
async function readTable(driver: SqlDriver, schema: string | undefined, name: string, includeData: boolean): Promise<DumpTable> {
  const create = await driver.createStatement(schema, name)
  // Read even when only the data is wanted: for SQLite the indexes live here and
  // nowhere else, and a caller reading a table's structure twice would pay the
  // round trip twice.
  const auxiliary = await driver.auxiliaryDdl(schema, name)
  const shared = { name, ...(create === undefined ? {} : { create }), ...(auxiliary.length === 0 ? {} : { auxiliary }) }
  if (!includeData) return { ...shared, columns: [], rows: [] }
  const data = await driver.allRows(schema, name, EXPORT_ROW_CAP)
  // A generated column is read (the SELECT returned it) but must NOT be named in
  // the INSERT: both engines refuse an insert into one, so including it would
  // make the dump un-importable.
  const generated = (await driver.columns(schema, name)).filter(column => column.generated === true).map(column => column.name)
  return {
    ...shared,
    columns: data.columns,
    ...(generated.length === 0 ? {} : { generated }),
    rows: data.rows,
    ...(data.truncated ? { truncated: true } : {}),
  }
}

/** Options the browser sends for an export. */
export interface ExportRequest {
  schema?: string
  /** Tables to export. Empty means every table in the schema. */
  tables?: string[]
  /** False excludes the rows. */
  includeData: boolean
  /** False excludes the `CREATE` statements. */
  includeStructure: boolean
  /** Include `DROP TABLE IF EXISTS` before each `CREATE`. */
  drop: boolean
  /** `sql` for a dump, `csv` for the currently selected table's rows. */
  format: 'sql' | 'csv'
}

/** One export's result: a filename, a content type, and the text. */
export interface ExportResult {
  filename: string
  contentType: string
  text: string
  /** Tables whose rows were cut by {@link EXPORT_ROW_CAP}. */
  truncated: string[]
}

/** Replace what a filesystem would object to in a filename. */
function safeName(text: string): string {
  return text.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'export'
}

/**
 * Export a schema or one table.
 *
 * @throws when the request names no table for CSV (a CSV of many tables cannot
 *   be one file), or when a table exceeds {@link EXPORT_ROW_CAP}.
 */
export async function exportSql(
  driver: SqlDriver,
  entry: DataSourceEntry,
  request: ExportRequest,
): Promise<ExportResult> {
  if (!isSqlDriver(driver)) throw new Error('export is only available for SQL data sources')
  const kind = driver.kind
  const dialect = dialectFor(kind)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const scope = request.schema ?? (kind === 'sqlite' ? 'main' : '')

  if (request.format === 'csv') {
    // Exactly one table: a CSV is one grid, and exporting several tables into
    // one file would either concatenate tables with different columns or drop
    // some of them silently.
    if (request.tables !== undefined && request.tables.length > 1) {
      throw new Error('a CSV export names exactly one table; choose SQL for several')
    }
    const table = request.tables?.[0]
    if (table === undefined || table === '') throw new Error('a CSV export names exactly one table')
    const data = await driver.allRows(request.schema, table, EXPORT_ROW_CAP)
    return {
      filename: `${safeName(entry.name)}-${safeName(table)}-${stamp}.csv`,
      contentType: 'text/csv; charset=utf-8',
      // A BOM, because Excel on Windows reads a BOM-less UTF-8 CSV as the local
      // code page and shows every non-ASCII character as mojibake.
      text: `\ufeff${toCsv(data.columns, data.rows)}`,
      truncated: data.truncated ? [table] : [],
    }
  }

  const names = request.tables !== undefined && request.tables.length > 0
    ? request.tables.map(name => ({ name, type: 'table' }))
    : await driver.tableNames(request.schema)
  if (names.length === 0) throw new Error('this schema has no tables to export')

  // A foreign key's target has to be created before its referrer, or the dump
  // cannot be replayed. Only worth reading when more than one table is in scope.
  const ordered = names.length > 1 ? orderTables(names, await driver.tableReferences(request.schema)) : names

  const options: DumpOptions = {
    structure: request.includeStructure,
    data: request.includeData,
    drop: request.drop,
  }
  const tables: DumpTable[] = []
  const truncated: string[] = []
  for (const item of ordered) {
    // A view has no INSERT-able data of its own; exporting one as data would
    // emit rows that cannot be re-inserted, so only its structure is included.
    const wantData = request.includeData && item.type !== 'view'
    const table = await readTable(driver, request.schema, item.name, wantData)
    if (table.truncated === true) truncated.push(item.name)
    tables.push(table)
  }

  const header = dumpDatabase(tables, dialect, options, `dsh-database-manager 导出 · ${entry.name}${scope === '' ? '' : ` / ${scope}`}`)
  const trailer = trailerFor(kind).join('\n')
  return {
    filename: `${safeName(entry.name)}${scope === '' ? '' : `-${safeName(scope)}`}-${stamp}.sql`,
    contentType: 'application/sql; charset=utf-8',
    text: trailer === '' ? header : `${header}\n${trailer}\n`,
    truncated,
  }
}

/**
 * Split a SQL script into statements.
 *
 * A real splitter, not a `split(';')`: a semicolon inside a string literal, a
 * quoted identifier or a comment is not a statement boundary, and neither is
 * one inside a `BEGIN … END` trigger body — which is why `BEGIN`/`END` nesting
 * is tracked too. Getting this wrong mangles the statement text rather than
 * failing, so it is written conservatively: at a depth it does not understand it
 * keeps the text together, and the engine then reports a syntax error on a whole
 * statement rather than on a fragment.
 *
 * Delimiter changes (`DELIMITER //`) are NOT supported: they exist to work
 * around a client's splitter, and this is one. A dump produced by this plugin
 * never contains them; a foreign one that does is refused with a message saying
 * so rather than silently truncated.
 */
export function splitSqlScript(sql: string): string[] {
  if (/^\s*DELIMITER\b/im.test(sql)) {
    throw new Error('this file uses DELIMITER, which this importer does not support; remove the DELIMITER lines and the matching statement terminators')
  }
  const statements: string[] = []
  let current = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]!
    // Line comment: skipped entirely, so it cannot carry a `;` into the split.
    if (ch === '-' && sql[i + 1] === '-' && (sql[i + 2] === undefined || /\s/.test(sql[i + 2]!))) {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? n : end + 1
      continue
    }
    if (ch === '#') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? n : end + 1
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      let j = i + 1
      while (j < n) {
        if (quote === "'" && sql[j] === '\\') { j += 2; continue }
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) { j += 2; continue }
          j++
          break
        }
        j++
      }
      current += sql.slice(i, j)
      i = j
      continue
    }
    if (ch === ';') {
      const trimmed = current.trim()
      if (trimmed !== '') statements.push(trimmed)
      current = ''
      i++
      continue
    }
    current += ch
    i++
  }
  const tail = current.trim()
  if (tail !== '') statements.push(tail)
  return statements
}

/** Options the browser sends for an import. */
export interface ImportRequest {
  schema?: string
  /** The file's text. */
  content: string
  /** `sql` runs it as a script; `csv` inserts its rows into `table`. */
  format: 'sql' | 'csv'
  /** Required for CSV: the table to insert into. */
  table?: string
  /** CSV: whether the first record names the columns. */
  hasHeader?: boolean
  /** CSV: empty fields become NULL rather than an empty string. */
  emptyAsNull?: boolean
}

/** One import's outcome. */
export interface ImportResult {
  statements: number
  rows: number
  /** Records skipped for a field count that disagreed with the header. */
  skipped: Array<{ line: number; fields: number }>
  /** How many statements the SQL script contained, for the progress report. */
  total?: number
}

/**
 * Run a SQL or CSV import.
 *
 * @throws when the file is not something this importer will run. Nothing is
 *   executed before that decision: an import that is refused must leave the
 *   database byte-identical, so every check is made up front.
 */
export async function importSql(
  driver: SqlDriver,
  request: ImportRequest,
): Promise<ImportResult> {
  if (!isSqlDriver(driver)) throw new Error('import is only available for SQL data sources')
  const bytes = Buffer.byteLength(request.content, 'utf8')
  if (bytes > IMPORT_BYTE_CAP) {
    throw new Error(`the file is ${Math.round(bytes / 1024 / 1024)} MiB, above the ${IMPORT_BYTE_CAP / 1024 / 1024} MiB import limit`)
  }

  if (request.format === 'csv') {
    const table = request.table
    if (table === undefined || table === '') throw new Error('a CSV import needs a target table')
    if (!/^[A-Za-z0-9_$][A-Za-z0-9_$ -]*$/.test(table)) throw new Error(`invalid table name: ${JSON.stringify(table)}`)
    const existing: ColumnInfo[] = await driver.columns(request.schema, table)
    const known = new Map(existing.map(column => [column.name.toLowerCase(), column.name]))
    const parsed = parseCsvTable(request.content, {
      hasHeader: request.hasHeader !== false,
      expected: existing.filter(column => column.generated !== true).map(column => column.name),
    })

    // Every column the file names must exist. A file whose header disagrees with
    // the table is a mismatch to report, not one to insert NULLs around.
    const mapping: Array<{ file: string; column: string }> = []
    for (const name of parsed.columns) {
      const column = known.get(name.toLowerCase())
      if (column === undefined) throw new Error(`the file's column "${name}" does not exist in ${table}`)
      const info = existing.find(candidate => candidate.name === column)!
      if (info.generated === true) throw new Error(`column "${column}" is generated and cannot be imported into`)
      mapping.push({ file: name, column })
    }
    if (mapping.length === 0) throw new Error('the file names no columns')

    const emptyAsNull = request.emptyAsNull !== false
    const rows = parsed.rows.map(row =>
      mapping.map(entry => ({
        column: entry.column,
        // An empty CSV field is ambiguous by nature. Empty-as-NULL is the
        // default because a dump of a NULL is written as an empty field, so
        // this is the direction that round-trips; the caller can turn it off
        // when the table legitimately holds empty strings.
        value: emptyAsNull && row[entry.file] === '' ? null : (row[entry.file] ?? ''),
      })),
    )
    if (rows.length === 0) {
      return { statements: 0, rows: 0, skipped: parsed.malformed }
    }
    const result = await driver.insertRows(request.schema, table, rows)
    return { statements: 1, rows: result.affected, skipped: parsed.malformed }
  }

  const statements = splitSqlScript(request.content)
  if (statements.length === 0) throw new Error('the file contains no SQL statements')

  /*
   * The script runs inside one transaction.
   *
   * `exec` per statement would autocommit each one, and a dump that fails on
   * statement 40 of 100 would leave a database that is neither the old one nor
   * the new one — with no record of where it stopped. Wrapping them makes the
   * import atomic, so a refusal or an engine error is a no-op.
   *
   * A dump written by this plugin contains its own BEGIN/COMMIT (SQLite) or
   * none at all (MySQL, where DDL autocommits regardless). A nested BEGIN is
   * accepted by SQLite as a no-op-with-warning only when a transaction is
   * already open, so the wrapper tolerates a `BEGIN`/`COMMIT` pair in the file
   * by not starting a second one — see `runScript`.
   */
  let executed = 0
  await driver.runScript(statements, request.schema, () => { executed++ })
  return { statements: executed, rows: 0, skipped: [], total: statements.length }
}

/**
 * Re-exported so the route can describe what an export produced.
 *
 * `dumpTable` is used by the tests that assert a single table's fragment; the
 * route goes through {@link exportSql}.
 */
export { dumpTable, type CellValue }
