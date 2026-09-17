/**
 * SQL identifier/value helpers shared by the SQL drivers.
 *
 * Identifiers can never be parameter-bound in any of these engines, so every
 * identifier that reaches a statement is quoted with the engine's own escape
 * rule AND validated against a conservative grammar first. Values always use
 * bound parameters — a value never reaches the statement text.
 */

/** Conservative identifier grammar accepted from the browser and the model. */
const IDENTIFIER_RE = /^[A-Za-z0-9_$][A-Za-z0-9_$ -]*$/

/** MySQL identifier quoting: backticks, with an internal backtick doubled. */
export function quoteMysql(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

/** SQLite / standard identifier quoting: double quotes, internal quote doubled. */
export function quoteSqlite(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

/** Whether a name is safe to quote (no control characters, no comment openers). */
export function isSafeIdentifier(name: string): boolean {
  if (name === '' || name.length > 128) return false
  if (!IDENTIFIER_RE.test(name)) return false
  // Reject the sequences that could terminate a quoted identifier context on
  // engines with backslash escapes even though we double the quote character.
  if (name.includes('\\')) return false
  return true
}

/**
 * Assert an identifier is safe and return it quoted.
 * @throws when the name is outside the accepted grammar.
 */
export function requireIdentifier(name: string, what: string, quote: (n: string) => string): string {
  if (!isSafeIdentifier(name)) throw new Error(`invalid ${what}: ${JSON.stringify(name)}`)
  return quote(name)
}

/** Qualified `schema`.`table` (MySQL) with both parts quoted. */
export function qualifyMysql(schema: string | undefined, table: string): string {
  const quotedTable = requireIdentifier(table, 'table name', quoteMysql)
  if (schema === undefined || schema === '') return quotedTable
  return requireIdentifier(schema, 'schema name', quoteMysql) + '.' + quotedTable
}

/** Qualified `schema`.`table` (SQLite: attaches are rarely used, so schema is a bare prefix). */
export function qualifySqlite(schema: string | undefined, table: string): string {
  const quotedTable = requireIdentifier(table, 'table name', quoteSqlite)
  if (schema === undefined || schema === '' || schema === 'main') return quotedTable
  return requireIdentifier(schema, 'schema name', quoteSqlite) + '.' + quotedTable
}

/**
 * Which statements the read path accepts. Deliberately a leading-keyword
 * allowlist: a statement not starting with one of these is refused before it
 * reaches the engine, so a "read" surface cannot be used to write.
 */
const READ_PREFIXES = ['select', 'with', 'show', 'describe', 'desc', 'explain', 'pragma', 'values', 'table'] as const

/** Strip leading whitespace and line comments so the first keyword is visible. */
function leadingKeyword(sql: string): string {
  let text = sql.replace(/^\s+/, '')
  for (;;) {
    if (text.startsWith('--')) {
      const end = text.indexOf('\n')
      if (end === -1) return ''
      text = text.slice(end + 1).replace(/^\s+/, '')
      continue
    }
    if (text.startsWith('/*')) {
      const end = text.indexOf('*/')
      if (end === -1) return ''
      text = text.slice(end + 2).replace(/^\s+/, '')
      continue
    }
    break
  }
  const match = /^[A-Za-z_]+/.exec(text)
  return match === null ? '' : match[0]!.toLowerCase()
}

/**
 * Whether a statement is a read-only statement by its leading keyword.
 * This is a guardrail for the read tools, not a security sandbox: a `WITH`
 * statement can still contain a data-modifying CTE on engines that allow it,
 * which is why the write tools exist separately and the agent write switch is
 * the real boundary.
 */
export function looksReadOnly(sql: string): boolean {
  const keyword = leadingKeyword(sql)
  return keyword !== '' && (READ_PREFIXES as readonly string[]).includes(keyword)
}

/**
 * Visit every character of `sql` that is real code — that is, outside string
 * literals, quoted identifiers, and comments. `depth` is the bracket nesting
 * level at that character.
 *
 * Returning `true` from `visit` stops the walk. This is a lexical guard rather
 * than a parser: it exists so a `;` or a keyword sitting inside a literal or a
 * comment cannot be mistaken for syntax. Where the text is ambiguous it errs
 * toward treating it as non-code, which makes a caller refuse a statement
 * rather than rewrite the wrong one.
 */
function forEachCodeChar(sql: string, visit: (char: string, index: number, depth: number) => boolean | void): void {
  let depth = 0
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]!
    // Line comment
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? n : end + 1
      continue
    }
    // Block comment
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    // Quoted literal / identifier (backslash escapes only outside SQLite's
    // doubled-quote convention; ignoring them here errs toward refusing).
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < n) {
        if (sql[i] === '\\') { i += 2; continue }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue }
          i++
          break
        }
        i++
      }
      continue
    }
    if (ch === '(') { depth++; i++; continue }
    if (ch === ')') { depth = depth > 0 ? depth - 1 : 0; i++; continue }
    if (visit(ch, i, depth) === true) return
    i++
  }
}

/** One word character — the grammar a keyword is matched against. */
const WORD_CHAR_RE = /[A-Za-z0-9_$]/

/**
 * Whether a keyword occurs at bracket depth 0, outside literals and comments.
 *
 * Depth matters because a subquery's own `LIMIT` is not the statement's: the
 * append in {@link pushDownLimit} is only illegal when the OUTER statement
 * already carries one.
 */
function hasTopLevelKeyword(sql: string, keyword: string): boolean {
  const target = keyword.toLowerCase()
  let found = false
  forEachCodeChar(sql, (char, index, depth) => {
    if (depth !== 0 || !/[A-Za-z_]/.test(char)) return
    // Match at a word start only, so a word is not tested once per letter.
    const previous = index === 0 ? '' : sql[index - 1]!
    if (previous !== '' && WORD_CHAR_RE.test(previous)) return
    let end = index + 1
    while (end < sql.length && WORD_CHAR_RE.test(sql[end]!)) end++
    if (sql.slice(index, end).toLowerCase() === target) {
      found = true
      return true
    }
  })
  return found
}

/**
 * Clauses that must stay at the very end of a statement. Appending `LIMIT`
 * after one of them is a syntax error, and each also marks a statement whose
 * row budget is not really ours to change.
 */
const TRAILING_CLAUSES = ['into', 'for', 'lock', 'procedure'] as const

/**
 * Move a row cap into the statement itself, as `LIMIT n`, so the engine — not
 * this process — is what stops reading.
 *
 * The cap has been applied on the host until now: a driver reads the whole
 * result set and only then slices it. That bounds what the browser receives but
 * not what the host materialises, so `SELECT * FROM` over a large table still
 * pulls every row into memory and discards all but the first page afterwards.
 * Rewriting the statement bounds the work at the source.
 *
 * Returns `undefined` — meaning "run it exactly as written" — whenever the cap
 * cannot be expressed safely:
 *
 * - its leading keyword is not SELECT/WITH, which also excludes writes. PRAGMA,
 *   EXPLAIN, SHOW, DESCRIBE, TABLE and a bare VALUES either reject a trailing
 *   LIMIT outright or mean something else by it;
 * - it already carries an outer LIMIT, which is the author's own budget;
 * - it ends in a clause that has to stay last.
 *
 * A subquery's inner LIMIT is not an outer one and does not block the rewrite.
 *
 * @param sql - one statement, as typed by the user or the model.
 * @param limit - the row cap; a value below 1 disables the rewrite.
 * @returns the capped statement, or `undefined` to leave it alone.
 */
export function pushDownLimit(sql: string, limit: number): string | undefined {
  if (!Number.isFinite(limit) || limit < 1) return undefined
  const keyword = leadingKeyword(sql)
  if (keyword !== 'select' && keyword !== 'with') return undefined
  if (hasTopLevelKeyword(sql, 'limit')) return undefined
  for (const clause of TRAILING_CLAUSES) {
    if (hasTopLevelKeyword(sql, clause)) return undefined
  }
  // A trailing terminator or blank line would otherwise sit between the
  // statement and the clause we append.
  const body = sql.replace(/[\s;]+$/, '')
  if (body === '') return undefined
  return `${body}\nLIMIT ${Math.trunc(limit)}`
}

/**
 * Reject a multi-statement payload. Every engine here executes one statement
 * per call unless explicitly told otherwise; refusing semicolons in the middle
 * keeps a "single statement" contract honest. A trailing semicolon is fine.
 */
export function assertSingleStatement(sql: string): void {
  const withoutTrailing = sql.replace(/;\s*$/, '')
  if (containsStatementSeparator(withoutTrailing)) {
    throw new Error('only one statement per call is allowed')
  }
}

/**
 * Whether the text contains a `;` outside of a string literal, a quoted
 * identifier, or a comment.
 */
function containsStatementSeparator(sql: string): boolean {
  let found = false
  forEachCodeChar(sql, char => {
    if (char !== ';') return
    found = true
    return true
  })
  return found
}

/**
 * Whether a statement is a transaction-control statement.
 *
 * Used by the importer, which runs a script inside a transaction of its own: a
 * script's own `BEGIN` would be a nested `BEGIN` ("cannot start a transaction
 * within a transaction") and its `COMMIT` would end the wrapper's transaction
 * early, defeating the all-or-nothing guarantee. Both are dropped so the wrapper
 * owns the transaction unconditionally, which is what makes a foreign dump as
 * atomic as one this plugin wrote.
 *
 * The forms are enumerated rather than pattern-guessed: SQLite accepts `BEGIN`,
 * `BEGIN TRANSACTION` and `BEGIN [DEFERRED|IMMEDIATE|EXCLUSIVE] [TRANSACTION]`,
 * MySQL accepts `BEGIN [WORK]` and `START TRANSACTION`, and a savepoint is
 * deliberately NOT included — a savepoint is a real thing a script may want.
 */
export function isTransactionControl(statement: string): boolean {
  const text = statement.trim().replace(/;+\s*$/, '').trim()
  return /^(?:BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE))?(?:\s+TRANSACTION)?|COMMIT(?:\s+(?:TRANSACTION|WORK))?|END(?:\s+TRANSACTION)?|ROLLBACK(?:\s+(?:TRANSACTION|WORK))?|START\s+TRANSACTION)$/i.test(text)
}

/**
 * Coerce an engine value into the JSON-safe scalar the wire accepts. Buffers
 * and bigints become strings, Dates become ISO text, and anything unknown
 * falls back to its string form so a result set can always be serialized.
 */
export function toWireValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value as string | boolean
  if (type === 'number') {
    const numeric = value as number
    return Number.isFinite(numeric) ? numeric : String(numeric)
  }
  if (type === 'bigint') return (value as bigint).toString()
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return `<binary ${value.byteLength} bytes>`
  if (value instanceof Buffer) return `<binary ${value.byteLength} bytes>`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

import type { RowFilter } from './protocol.ts'
export type { RowFilter }

/** Which engine's identifier quoting and escaping rules apply. */
export type SqlDialect = 'sqlite' | 'mysql'

/**
 * The `ESCAPE` clause for a `LIKE`.
 *
 * Engine-specific on purpose. `likePattern` escapes `%` and `_` with a
 * backslash, and each engine needs to be TOLD that the backslash is the escape
 * character — but the way that is spelled differs: MySQL treats a backslash
 * inside a string literal as an escape itself, so the literal has to be written
 * `'\\'` for the server to see a single backslash, whereas SQLite takes `'\'`
 * as-is. Emitting MySQL's spelling to SQLite (or the reverse) makes the clause
 * look for a double backslash, and every escaped search silently matches
 * nothing.
 */
export function likeEscapeClause(dialect: SqlDialect): string {
  return dialect === 'mysql' ? "ESCAPE '\\\\'" : "ESCAPE '\\'"
}

/** The comparison operators a search filter may name. */
const FILTER_OPERATORS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'contains', 'notContains', 'startsWith', 'endsWith',
  'isNull', 'isNotNull', 'between', 'in',
])

/** A `LIKE` pattern with the pattern's own wildcards escaped. */
function likePattern(value: string, position: 'contains' | 'startsWith' | 'endsWith'): string {
  // `%` and `_` typed by the user are characters to find, not wildcards — a
  // search for `100%` must not match every row. The escape character itself
  // goes first, or it would escape the escapes added after it.
  const escaped = value.replace(/[\\%_]/g, match => `\\${match}`)
  if (position === 'startsWith') return `${escaped}%`
  if (position === 'endsWith') return `%${escaped}`
  return `%${escaped}%`
}

/**
 * Build a `WHERE` clause from the 搜索 tab's structured conditions.
 *
 * Every operand is a bound parameter and every column name is quoted after
 * validation, so the shape — not the text — decides the SQL. That is the whole
 * difference from the raw-condition path this replaced: a user can no longer
 * put a fragment of SQL into a search box and have it reach the engine.
 *
 * @param filters - the conditions, in the order the user arranged them.
 * @param join - how the conditions combine; nested parentheses keep `OR` from
 *   leaking across the `AND`s around it.
 * @param quote - the dialect's identifier quoter.
 * @param known - the table's column names, lower-cased, for validation.
 * @returns the clause text (empty when nothing applies) and its parameters.
 * @throws when a filter names an unknown column or operator, or omits a value.
 */
export function buildSearchWhere(
  filters: readonly RowFilter[],
  join: 'and' | 'or',
  quote: (name: string) => string,
  known: ReadonlySet<string>,
  dialect: SqlDialect = 'sqlite',
): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  for (const filter of filters) {
    const column = filter.column
    if (!known.has(column.toLowerCase())) throw new Error(`no such column: ${JSON.stringify(column)}`)
    if (!FILTER_OPERATORS.has(filter.operator)) throw new Error(`unsupported operator: ${JSON.stringify(filter.operator)}`)
    const quoted = quote(column)
    const value = filter.value ?? ''

    switch (filter.operator) {
      case 'isNull':
        clauses.push(`${quoted} IS NULL`)
        continue
      case 'isNotNull':
        clauses.push(`${quoted} IS NOT NULL`)
        continue
      case 'between': {
        if (value === '' || (filter.value2 ?? '') === '') throw new Error('between needs two values')
        clauses.push(`${quoted} BETWEEN ? AND ?`)
        params.push(value, filter.value2)
        continue
      }
      case 'in': {
        // A comma-separated list, each member its own bound parameter.
        const members = value.split(',').map((member: string) => member.trim()).filter((member: string) => member !== '')
        if (members.length === 0) throw new Error('in needs at least one value')
        clauses.push(`${quoted} IN (${members.map(() => '?').join(', ')})`)
        params.push(...members)
        continue
      }
      case 'contains':
      case 'notContains':
      case 'startsWith':
      case 'endsWith': {
        const position = filter.operator === 'contains' || filter.operator === 'notContains'
          ? 'contains'
          : filter.operator === 'startsWith' ? 'startsWith' : 'endsWith'
        const negated = filter.operator === 'notContains'
        // `ESCAPE` so the escaping in `likePattern` is honoured, spelled the way
        // this engine's string literals require.
        clauses.push(`${quoted} ${negated ? 'NOT ' : ''}LIKE ? ${likeEscapeClause(dialect)}`)
        params.push(likePattern(value, position))
        continue
      }
      default: {
        const operator = filter.operator === 'eq' ? '='
          : filter.operator === 'neq' ? '<>'
            : filter.operator === 'gt' ? '>'
              : filter.operator === 'gte' ? '>='
                : filter.operator === 'lt' ? '<' : '<='
        if (value === '') throw new Error(`${filter.operator} needs a value`)
        clauses.push(`${quoted} ${operator} ?`)
        params.push(value)
      }
    }
  }

  if (clauses.length === 0) return { where: '', params: [] }
  const joiner = join === 'or' ? ' OR ' : ' AND '
  // One pair of brackets around the whole conjunction: without them a caller
  // appending another `AND` (a mode's own scope) would bind to the last clause
  // only.
  return { where: ` WHERE (${clauses.join(joiner)})`, params }
}
