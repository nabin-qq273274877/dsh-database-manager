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
    if (ch === ';') return true
    i++
  }
  return false
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
