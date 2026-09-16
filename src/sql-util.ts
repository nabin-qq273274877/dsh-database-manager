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
