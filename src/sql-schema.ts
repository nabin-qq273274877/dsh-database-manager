/**
 * Dialect-aware type/default validation and `CREATE TABLE` rewriting, shared by
 * the SQLite and MySQL drivers.
 *
 * ## Why this module exists
 *
 * The 结构 tab lets a user change a column, add or drop a primary key, and
 * create or drop indexes. Every one of those reaches an engine as STATEMENT
 * TEXT: an identifier, a type name and a default expression cannot be
 * parameter-bound in any of these engines. So each piece is validated here and
 * re-emitted in canonical form — nothing typed by a user is pasted into a
 * statement.
 *
 * ## Why the table is parsed rather than described by `PRAGMA table_info`
 *
 * SQLite cannot change a column's declared type, its nullability, or its
 * primary-key membership; the documented way to do any of those is the 12-step
 * table rebuild — create a replacement with the wanted shape, copy the rows,
 * drop the original, rename the replacement. Building that replacement from
 * `PRAGMA table_info` would silently LOSE every clause that pragma does not
 * report: `CHECK` constraints, `FOREIGN KEY` clauses, `COLLATE`, generated
 * columns, `WITHOUT ROWID`, `STRICT`. So the original `CREATE TABLE` text is
 * split into top-level items and re-emitted with only the edited item replaced.
 *
 * Anything this module cannot parse confidently is refused, not guessed at: a
 * rebuild that quietly drops a foreign key is worse than a button that says it
 * cannot do the job.
 */

import { quoteMysql, quoteSqlite, requireIdentifier } from './sql-util.ts'

/** Which engine's quoting and grammar rules apply. */
export type SqlDialect = 'sqlite' | 'mysql'

/** One column definition, as parsed out of a `CREATE TABLE` item. */
export interface ColumnDefinition {
  name: string
  /**
   * The DECLARED type text (`varchar(20)`, `int unsigned`, `enum('a','b')`), or
   * `''` when the column has none (legal on SQLite, where it means BLOB
   * affinity).
   */
  type: string
  nullable: boolean
  /** Default expression text, or undefined when the column has no default. */
  defaultValue?: string
  /** MySQL `AUTO_INCREMENT`, or SQLite's `INTEGER PRIMARY KEY` rowid alias. */
  autoIncrement?: boolean
  /** Position within the primary key, 1-based; 0 or absent when not part of it. */
  primaryKeyPosition?: number
  /** True when a UNIQUE constraint is attached directly to the column. */
  unique?: boolean
  /** A `CHECK (…)` clause attached to the column, verbatim. */
  check?: string
  /** Everything else in the column's clause, preserved verbatim and in order. */
  extras: string[]
  /** True when the column's value is computed by the engine. */
  generated?: boolean
  /** Column comment (MySQL only; SQLite has none). */
  comment?: string
  /**
   * True for SQLite's `AUTOINCREMENT` keyword, which is distinct from the rowid
   * alias `INTEGER PRIMARY KEY` implies: without it, SQLite reuses the ids of
   * deleted rows, and with it the sequence is monotonic.
   */
  sqliteAutoincrement?: boolean
}

/** A table-level constraint item, preserved verbatim. */
export interface TableConstraint {
  /** `PRIMARY KEY (a, b)`, `UNIQUE (a)`, `FOREIGN KEY (x) REFERENCES y(z)`, … */
  sql: string
  kind: 'primary' | 'unique' | 'foreign' | 'check' | 'other'
}

/** One parsed `CREATE TABLE`, ready to be re-emitted with edits applied. */
export interface TableShape {
  name: string
  /** True when the original head said `IF NOT EXISTS`. */
  ifNotExists: boolean
  columns: ColumnDefinition[]
  /** Table-level constraints, in their original order. */
  constraints: TableConstraint[]
  /** Trailing keywords after the closing bracket: `WITHOUT ROWID`, `STRICT`, … */
  tail: string
}

/**
 * Assert a name is an identifier this plugin will quote, and return it quoted.
 * @throws when the name is outside the conservative grammar in sql-util.ts.
 */
export function identifier(name: string, what: string, dialect: SqlDialect): string {
  return requireIdentifier(name, what, dialect === 'mysql' ? quoteMysql : quoteSqlite)
}

// ---- lexical helpers ------------------------------------------------------

/**
 * Whether the character at `at` opens a quoted region, and its terminator.
 *
 * Backticks are MySQL's identifier quote; double quotes are an identifier quote
 * in both engines here; single quotes are a string literal everywhere. Treating
 * all three as "skip to the matching quote" is what lets a comma inside
 * `enum('a,b')` or `CHECK (v <> ',')` be ignored by a comma-based split.
 */
function quoteAt(text: string, at: number): string | undefined {
  const ch = text[at]
  if (ch === "'" || ch === '"' || ch === '`') return ch
  return undefined
}

/** Advance past a quoted region starting at `from` (the opening quote). */
function skipQuoted(text: string, from: number, quote: string): number {
  const n = text.length
  // A double quote opens an identifier, where a backslash is NOT an escape in
  // SQLite's convention; a single quote opens a MySQL string, where it is.
  const backslashEscapes = quote === "'"
  let i = from + 1
  while (i < n) {
    if (backslashEscapes && text[i] === '\\') { i += 2; continue }
    if (text[i] === quote) {
      // A doubled quote is an escaped one, not a terminator.
      if (text[i + 1] === quote) { i += 2; continue }
      return i + 1
    }
    i++
  }
  return n
}

/** Index of the `)` matching the `(` at `open`, or -1 when unbalanced. */
export function matchingBracket(text: string, open: number): number {
  let depth = 0
  let i = open
  const n = text.length
  while (i < n) {
    const ch = text[i]!
    if (ch === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? n : end + 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    const quote = quoteAt(text, i)
    if (quote !== undefined) { i = skipQuoted(text, i, quote); continue }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/**
 * Split text on single-character separators that sit outside quotes, brackets
 * and comments.
 *
 * The one primitive everything else is built on: `a int, b text CHECK (b <>
 * ',')` has two top-level items and a comma that is not a separator, and no
 * regular expression distinguishes them.
 */
export function splitTopLevel(text: string, separators = ','): string[] {
  const items: string[] = []
  let depth = 0
  let start = 0
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]!
    if (ch === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? n : end + 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    const quote = quoteAt(text, i)
    if (quote !== undefined) { i = skipQuoted(text, i, quote); continue }
    if (ch === '(') { depth++; i++; continue }
    if (ch === ')') { depth = depth > 0 ? depth - 1 : 0; i++; continue }
    if (depth === 0 && separators.includes(ch)) {
      items.push(text.slice(start, i))
      start = i + 1
    }
    i++
  }
  items.push(text.slice(start))
  return items.map(item => item.trim()).filter(item => item !== '')
}

/** Split on whitespace at depth 0, so a bracket group stays one token. */
function splitWords(text: string): string[] {
  const items: string[] = []
  let depth = 0
  let start = -1
  let i = 0
  const n = text.length
  while (i <= n) {
    const ch = i === n ? ' ' : text[i]!
    if (ch === '(') depth++
    else if (ch === ')') depth = depth > 0 ? depth - 1 : 0
    const isSpace = depth === 0 && /\s/.test(ch)
    if (isSpace) {
      if (start !== -1) { items.push(text.slice(start, i)); start = -1 }
    } else if (start === -1) start = i
    i++
  }
  return items
}

// ---- type validation ------------------------------------------------------

/** Type names MySQL accepts, checked case-insensitively on collapsed whitespace. */
const MYSQL_TYPE_BASE = [
  'tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint',
  'decimal', 'numeric', 'float', 'double', 'real', 'bit', 'bool', 'boolean',
  'date', 'datetime', 'timestamp', 'time', 'year',
  'char', 'varchar', 'binary', 'varbinary',
  'tinytext', 'text', 'mediumtext', 'longtext',
  'tinyblob', 'blob', 'mediumblob', 'longblob',
  'enum', 'set', 'json', 'geometry', 'point', 'linestring', 'polygon',
  'multipoint', 'multilinestring', 'multipolygon', 'geometrycollection',
  'inet4', 'inet6', 'uuid', 'vector',
] as const

/**
 * Type names SQLite is offered. SQLite itself accepts any word as a type name,
 * but an unchecked free-text type field is a statement-injection surface, so the
 * 结构 tab offers this list and the driver refuses anything outside it.
 */
const SQLITE_TYPE_BASE = [
  'integer', 'int', 'tinyint', 'smallint', 'mediumint', 'bigint',
  'unsigned big int', 'int2', 'int8',
  'character', 'varchar', 'varying character', 'nchar', 'native character',
  'nvarchar', 'text', 'clob', 'blob', 'real', 'double', 'double precision',
  'float', 'numeric', 'decimal', 'boolean', 'date', 'datetime', 'time',
  'timestamp', 'json', 'uuid', 'year',
] as const

/** Digits, optionally `,digits`: `(10)` / `(10,2)`. */
const NUMERIC_ARG_RE = /^\d{1,4}(,\d{1,4})?$/
/** Digits only: a length. */
const LENGTH_ARG_RE = /^\d{1,6}$/
/** MySQL modifiers that follow a type. */
const MYSQL_MODIFIERS = ['unsigned', 'zerofill'] as const

/** A `'…'`-quoted literal with backslash escapes and doubled quotes escaped. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

/** Undo {@link quoteLiteral} for the members of an existing `enum(...)`. */
function unquoteLiteral(text: string): string {
  const body = text.trim().slice(1, -1)
  return body.replace(/''/g, "'")
}

/** A `DECIMAL`/`FLOAT`/`ENUM`-style type, split into its parts. */
interface ParsedType {
  base: string
  args?: string
  modifiers: string[]
}

/** Split a type expression into base / bracket args / trailing modifiers. */
function splitType(type: string, base: readonly string[]): ParsedType {
  const text = type.trim().replace(/\s+/g, ' ')
  if (text === '') return { base: '', modifiers: [] }
  const open = text.indexOf('(')
  const withoutArgs = open === -1 ? text : text.slice(0, open).trim()
  let args: string | undefined
  let after = ''
  if (open !== -1) {
    const close = matchingBracket(text, open)
    if (close === -1) throw new Error(`unbalanced brackets in column type: ${JSON.stringify(type)}`)
    args = text.slice(open + 1, close).trim()
    after = text.slice(close + 1).trim()
  }

  const words = `${withoutArgs}${after === '' ? '' : ' ' + after}`.split(' ').filter(word => word !== '')
  const modifiers: string[] = []
  while (words.length > 1 && (MYSQL_MODIFIERS as readonly string[]).includes(words[words.length - 1]!.toLowerCase())) {
    modifiers.unshift(words.pop()!)
  }
  const name = words.join(' ')
  // Case-insensitive membership, but the caller's own casing is what is
  // re-emitted: a table rebuild must not rewrite `TEXT` as `text` merely
  // because it happened to touch an unrelated column, since that would make an
  // otherwise no-op edit show up in a schema diff.
  if (name === '' || !base.includes(name.toLowerCase())) {
    throw new Error(`unsupported column type: ${JSON.stringify(type)}`)
  }
  const canonical = base.find(entry => entry === name.toLowerCase())
  if (canonical === undefined) throw new Error(`unsupported column type: ${JSON.stringify(type)}`)
  if (new Set(modifiers.map(modifier => modifier.toLowerCase())).size !== modifiers.length) {
    throw new Error(`repeated type modifier in ${JSON.stringify(type)}`)
  }
  return { base: name, ...(args === undefined ? {} : { args }), modifiers }
}

/**
 * Validate and canonicalize a MySQL type expression.
 * @throws when the text is not a type this plugin will write into a statement.
 */
export function normalizeMysqlType(type: string): string {
  const raw = type.trim()
  if (raw === '') throw new Error('column type is required')
  if (raw.length > 200) throw new Error(`column type is too long: ${JSON.stringify(type)}`)
  const { base, args, modifiers } = splitType(raw, MYSQL_TYPE_BASE)
  const suffix = modifiers.length === 0 ? '' : ' ' + modifiers.join(' ')

  if (args === undefined) {
    if (base === 'enum' || base === 'set') throw new Error(`${base} requires a member list`)
    return base + suffix
  }

  if (base === 'enum' || base === 'set') {
    const members = splitTopLevel(args)
    if (members.length === 0) throw new Error(`${base} requires at least one member`)
    if (members.length > 1024) throw new Error(`${base} accepts at most 1024 members`)
    const rendered = members.map(member => {
      const value = member.startsWith("'") ? unquoteLiteral(member) : member
      if (/[\u0000-\u001f]/.test(value)) throw new Error(`a ${base} member cannot contain a control character`)
      return quoteLiteral(value)
    })
    return `${base}(${rendered.join(',')})`
  }

  const compact = args.replace(/\s+/g, '')
  if (base === 'decimal' || base === 'numeric' || base === 'float' || base === 'double' || base === 'real') {
    if (!NUMERIC_ARG_RE.test(compact)) throw new Error(`invalid size for ${base}: ${JSON.stringify(args)}`)
    return `${base}(${compact})${suffix}`
  }
  if (base === 'bit') {
    if (!LENGTH_ARG_RE.test(args)) throw new Error(`invalid length for bit: ${JSON.stringify(args)}`)
    return `bit(${args})`
  }
  if (!LENGTH_ARG_RE.test(args)) throw new Error(`invalid length for ${base}: ${JSON.stringify(args)}`)
  return `${base}(${args})${suffix}`
}

/**
 * Validate and canonicalize a SQLite type expression.
 *
 * `''` is accepted and means "no declared type", which is legal SQLite and is
 * offered in the 结构 tab as the BLOB-affinity option.
 */
export function normalizeSqliteType(type: string): string {
  const raw = type.trim()
  if (raw === '') return ''
  if (raw.length > 200) throw new Error(`column type is too long: ${JSON.stringify(type)}`)
  const { base, args, modifiers } = splitType(raw, SQLITE_TYPE_BASE)
  if (modifiers.length > 0) throw new Error(`SQLite does not accept the modifier in ${JSON.stringify(type)}`)
  if (args === undefined) return base
  const compact = args.replace(/\s+/g, '')
  if (!LENGTH_ARG_RE.test(args) && !NUMERIC_ARG_RE.test(compact)) {
    throw new Error(`invalid length for ${base}: ${JSON.stringify(args)}`)
  }
  return `${base}(${compact})`
}

/** Canonicalize a type for one dialect. */
export function normalizeType(type: string, dialect: SqlDialect): string {
  return dialect === 'mysql' ? normalizeMysqlType(type) : normalizeSqliteType(type)
}

// ---- default validation ---------------------------------------------------

/**
 * Keywords a default may be, per dialect.
 *
 * A default is the hardest field to keep safe: MySQL accepts arbitrary
 * expressions there, and copying one into a statement is copying user text into
 * DDL. An allowlist of keywords plus a literal grammar covers every default the
 * 结构 tab offers; anything else is refused with a message naming the reason.
 */
const DEFAULT_KEYWORDS = new Set([
  'null', 'true', 'false',
  'current_timestamp', 'current_timestamp()',
  'current_date', 'current_date()',
  'current_time', 'current_time()',
  'localtimestamp', 'localtimestamp()', 'localtime',
  'now()', 'uuid()',
])

/**
 * Validate a default expression and return the text to emit.
 *
 * @param value - the expression as typed; undefined or '' means "no default".
 * @returns the canonical text, or undefined when there is no default.
 * @throws when the text is neither a literal nor an allowlisted keyword.
 */
export function normalizeDefault(value: string | undefined, dialect: SqlDialect): string | undefined {
  if (value === undefined) return undefined
  const text = value.trim()
  if (text === '') return undefined
  if (text.length > 200) throw new Error(`default value is too long: ${JSON.stringify(value)}`)
  if (/[\u0000-\u001f;]/.test(text)) throw new Error('a default value cannot contain a control character or a semicolon')

  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    const body = text.slice(1, -1)
    // Re-emit through the engine's own escaping rather than trusting the input.
    const value = dialect === 'mysql' ? body.replace(/''/g, "'").replace(/\\(.)/g, '$1') : body.replace(/''/g, "'")
    return dialect === 'mysql' ? quoteLiteral(value) : `'${value.replace(/'/g, "''")}'`
  }
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text)) return text
  if (text.startsWith('(')) {
    throw new Error('a parenthesised default expression is not accepted; use a literal or a supported keyword')
  }
  const lower = text.toLowerCase().replace(/\s+/g, ' ')
  if (DEFAULT_KEYWORDS.has(lower)) return lower
  throw new Error(`unsupported default value: ${JSON.stringify(value)}`)
}

// ---- CREATE TABLE parsing -------------------------------------------------

/**
 * Keywords that introduce a table-level constraint rather than a column.
 *
 * Shared by both dialects. `KEY` / `INDEX` / `FULLTEXT` / `SPATIAL` are absent
 * on purpose: MySQL rejects them as column names, so `KEY ix (a)` can only be a
 * constraint there, but SQLite accepts `key` as a column name and has no such
 * constraint syntax at all — parsing `key int` as a constraint would delete the
 * column from the rebuilt table. They are added per dialect in
 * {@link isTableConstraint}.
 */
const TABLE_CONSTRAINT_RE = /^(?:(?:CONSTRAINT\s+\S+\s+)?(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK))\b/i

/** MySQL's index-defining constraint forms: `KEY ix (a)`, `INDEX ix (a)`, `FULLTEXT KEY …`. */
const MYSQL_INDEX_CONSTRAINT_RE = /^(?:KEY|INDEX|FULLTEXT|SPATIAL)\b[\s\S]*\(/i

/** Whether an item is a table-level constraint rather than a column definition. */
export function isTableConstraint(item: string, dialect: SqlDialect): boolean {
  const text = item.trim()
  if (TABLE_CONSTRAINT_RE.test(text)) return true
  return dialect === 'mysql' && MYSQL_INDEX_CONSTRAINT_RE.test(text)
}

/** Classify a table-level constraint item. */
function classifyConstraint(sql: string): TableConstraint['kind'] {
  const match = /^\s*(?:CONSTRAINT\s+\S+\s+)?([A-Za-z]+)/i.exec(sql)
  const keyword = (match?.[1] ?? '').toLowerCase()
  if (keyword === 'primary') return 'primary'
  if (keyword === 'unique') return 'unique'
  if (keyword === 'foreign') return 'foreign'
  if (keyword === 'check') return 'check'
  return 'other'
}
function unquoteIdentifier(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]!
    const last = trimmed[trimmed.length - 1]!
    if (first === '"' && last === '"') return trimmed.slice(1, -1).replace(/""/g, '"')
    if (first === '`' && last === '`') return trimmed.slice(1, -1).replace(/``/g, '`')
    if (first === '[' && last === ']') return trimmed.slice(1, -1)
  }
  return trimmed
}

/** The leading identifier of a column item, and the rest of the item. */
function readLeadingIdentifier(item: string): { name: string; rest: string } | undefined {
  const text = item.trim()
  if (text === '') return undefined
  const first = text[0]!
  const quote = quoteAt(text, 0)
  if (quote !== undefined) {
    const end = skipQuoted(text, 0, quote)
    if (end >= text.length) return undefined
    return { name: unquoteIdentifier(text.slice(0, end)), rest: text.slice(end).trim() }
  }
  const match = /^([A-Za-z_\u0080-\uffff][A-Za-z0-9_$\u0080-\uffff]*)\s*([\s\S]*)$/.exec(text)
  if (match === null) return undefined
  return { name: match[1]!, rest: match[2]!.trim() }
}

/** Keywords that begin a column's trailing flags rather than its type. */
const COLUMN_FLAG_KEYWORDS = new Set([
  'not', 'null', 'default', 'primary', 'unique', 'check', 'collate',
  'references', 'constraint', 'generated', 'auto_increment', 'autoincrement',
  'comment', 'on', 'as', 'stored', 'virtual', 'deferrable', 'initially',
  'conflict', 'using',
])

/**
 * Split a column's clause into its type text and its flag phrases.
 *
 * The type is decided by trying progressively longer prefixes of the clause
 * against the dialect's type grammar, and taking the longest one that
 * validates. A keyword list alone is not enough: `INT UNSIGNED` and SQLite's
 * `UNSIGNED BIG INT` both begin with a token that can also start a flag
 * (`UNSIGNED`), and `NOT NULL` must not be read as a type named `NOT NULL`.
 * Asking the grammar where the boundary is settles both.
 *
 * `flags` holds WHOLE phrases (`NOT NULL`, `DEFAULT 5`), already grouped. The
 * caller must not group them a second time: running the grouping over grouped
 * phrases merges them back into one, which turns `NOT NULL DEFAULT 5` into a
 * single unrecognized flag and re-renders as invalid SQL.
 */
export function splitTypeAndFlags(rest: string, dialect: SqlDialect): { type: string; flags: string[] } {
  const words = splitWords(rest)
  if (words.length === 0) return { type: '', flags: [] }

  // The longest prefix that is a valid type wins. An empty type is legal on
  // SQLite, so it is the fallback rather than an error there.
  let best = -1
  for (let length = 1; length <= words.length; length++) {
    try {
      normalizeType(words.slice(0, length).join(' '), dialect)
      best = length
    } catch {
      // Not a type at this length; try a longer one.
    }
  }
  if (best === -1) {
    if (dialect === 'sqlite') return { type: '', flags: groupFlags(words) }
    // Nothing validated: keep the whole clause as the type so the caller's own
    // re-render fails loudly rather than silently dropping the column's flags.
    return { type: rest, flags: [] }
  }
  return { type: words.slice(0, best).join(' '), flags: groupFlags(words.slice(best)) }
}

/** First word of a flag phrase, lower-cased. */
function flagKeyword(phrase: string): string {
  return (/^([A-Za-z_]+)/.exec(phrase)?.[1] ?? '').toLowerCase()
}

/**
 * Whether the flag phrase built so far is complete, i.e. the next starter
 * belongs to a new flag.
 *
 * The multi-word flags are why this exists. Grouping on "the next starter"
 * alone splits `NOT NULL`, `PRIMARY KEY` and `DEFAULT 5` apart, and the
 * resulting `NOT`+`NULL` pair re-renders as two separate clauses — which the
 * engine rejects with a syntax error naming a token rather than the field.
 */
function flagComplete(words: string[]): boolean {
  if (words.length === 0) return false
  const keyword = flagKeyword(words[0]!)
  switch (keyword) {
    case 'not':
      // `NOT NULL`, or `NOT DEFERRABLE`.
      return words.length >= 2
    case 'primary':
      return words.length >= 2 && flagKeyword(words[1]!) === 'key'
    case 'default':
      return words.length >= 2
    case 'check':
      return words.length >= 2 && words[1]!.startsWith('(')
    case 'collate':
      return words.length >= 2
    case 'references':
      // `REFERENCES t(c)` then any number of `ON DELETE …` / `MATCH …` clauses,
      // so the phrase is only complete once the whole clause is consumed — which
      // is decided by whether the NEXT word is another starter.
      return words.length >= 2
    case 'comment':
      return words.length >= 2
    case 'generated':
    case 'as':
      return words.some(word => word.startsWith('('))
    case 'constraint':
      // `CONSTRAINT name <flags>`: the name follows, then the real flags.
      return words.length >= 2
    default:
      return true
  }
}

/**
 * Whether a token can begin a NEW flag phrase.
 *
 * `NULL` is deliberately absent from the starters: it only ever appears as the
 * second half of `NOT NULL` or as a column's own trailing `NULL`, and listing
 * it would split the first into two flags that re-render as invalid SQL.
 */
const FLAG_STARTERS = new Set([
  'not', 'default', 'primary', 'unique', 'check', 'collate', 'references',
  'constraint', 'generated', 'auto_increment', 'autoincrement', 'comment',
  'on', 'match', 'deferrable', 'initially', 'as', 'signed', 'unsigned',
  'zerofill', 'stored', 'virtual', 'using',
])

/** Whether a token begins a flag phrase. */
function startsFlag(token: string): boolean {
  return FLAG_STARTERS.has(flagKeyword(token))
}

/** Group a token list into flag phrases (`NOT NULL`, `DEFAULT 5`, `PRIMARY KEY`). */
function groupFlags(words: string[]): string[] {
  const flags: string[] = []
  let pending: string[] = []
  for (const word of words) {
    if (pending.length > 0 && startsFlag(word) && flagComplete(pending)) {
      flags.push(pending.join(' '))
      pending = []
    }
    pending.push(word)
  }
  if (pending.length > 0) flags.push(pending.join(' '))
  return flags
}

/** Parse one column item into a definition, or undefined when it is not one. */
export function parseColumnItem(item: string, dialect: SqlDialect): ColumnDefinition | undefined {
  if (isTableConstraint(item, dialect)) return undefined
  const leading = readLeadingIdentifier(item)
  if (leading === undefined) return undefined

  const { type, flags } = splitTypeAndFlags(leading.rest, dialect)
  const lower = flags.map(flag => flag.toLowerCase().replace(/\s+/g, ' '))
  const nullableFlag = lower.some(flag => flag === 'not null')
  const primaryKey = lower.some(flag => flag.startsWith('primary key'))
  const autoIncrement = lower.some(flag => flag === 'auto_increment' || flag === 'autoincrement')
  // SQLite's own keyword, meaning "never reuse a deleted id". Kept apart from
  // the rowid alias: `INTEGER PRIMARY KEY` alone already auto-assigns ids, so
  // conflating the two would add AUTOINCREMENT to tables that never had it.
  const sqliteAutoincrement = dialect === 'sqlite' && lower.some(flag => flag.includes('autoincrement'))
  const unique = lower.some(flag => flag === 'unique')
  const check = flags.find(flag => /^check\s*\(/i.test(flag))
  const comment = /^comment\s+'([\s\S]*)'$/i.exec(flags.find(flag => /^comment\s+/i.test(flag)) ?? '')?.[1]
  const generated = lower.some(flag => flag.startsWith('generated') || /^as\s*\(/.test(flag))

  /** Flags this parser re-emits itself; anything else is preserved verbatim. */
  const handled = (flag: string): boolean => {
    if (flag === '' || flag === 'not null' || flag === 'null') return true
    if (flag.startsWith('default ')) return true
    if (flag === 'auto_increment' || flag === 'autoincrement') return true
    if (flag.startsWith('primary key')) return true
    if (flag === 'unique') return true
    if (/^check\s*\(/i.test(flag)) return true
    if (/^comment\s+/i.test(flag)) return true
    return false
  }
  const extras = flags.filter(flag => !handled(flag.toLowerCase().replace(/\s+/g, ' ')))

  const defaultValue = flags.map(flag => /^default\s+([\s\S]+)$/i.exec(flag)).find(match => match !== null)?.[1]

  const rowidAlias = dialect === 'sqlite' && primaryKey && type.trim().toLowerCase().replace(/\s+/g, ' ') === 'integer'
  const isAuto = autoIncrement || rowidAlias

  return {
    name: leading.name,
    type,
    // A primary-key column is NOT NULL whether or not the statement said so;
    // reporting it as nullable would make the 结构 tab's checkbox lie.
    nullable: !nullableFlag && !primaryKey,
    ...(defaultValue === undefined ? {} : { defaultValue }),
    ...(isAuto ? { autoIncrement: true } : {}),
    ...(sqliteAutoincrement ? { sqliteAutoincrement: true } : {}),
    ...(primaryKey ? { primaryKeyPosition: 1 } : {}),
    ...(unique ? { unique: true } : {}),
    ...(check === undefined ? {} : { check }),
    ...(comment === undefined ? {} : { comment }),
    extras,
    ...(generated ? { generated: true } : {}),
  }
}

/**
 * Parse a `CREATE TABLE` statement into editable pieces.
 * @throws when the statement cannot be split.
 */
export function parseCreateTable(sql: string, dialect: SqlDialect): TableShape {
  const text = sql.trim().replace(/;+\s*$/, '')
  const open = text.indexOf('(')
  if (open === -1) throw new Error(`cannot read the table definition: ${JSON.stringify(sql.slice(0, 120))}`)
  const close = matchingBracket(text, open)
  if (close === -1) throw new Error('unbalanced brackets in the table definition')

  const head = text.slice(0, open).trim()
  const tail = text.slice(close + 1).trim()

  const headMatch = /^CREATE\s+(?:(?:TEMP|TEMPORARY|VIRTUAL)\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(.+)$/i.exec(head)
  if (headMatch === null) throw new Error(`not a CREATE TABLE statement: ${JSON.stringify(head.slice(0, 120))}`)
  const ifNotExists = headMatch[1] !== undefined
  // A virtual table carries `USING <module>` and has no editable columns here.
  if (/CREATE\s+VIRTUAL\s+TABLE/i.test(head)) throw new Error('a virtual table cannot be rebuilt')

  const parts = splitTopLevel(headMatch[2]!, '.')
  const name = unquoteIdentifier(parts[parts.length - 1]!)

  const columns: ColumnDefinition[] = []
  const constraints: TableConstraint[] = []
  for (const item of splitTopLevel(text.slice(open + 1, close))) {
    const column = parseColumnItem(item, dialect)
    if (column !== undefined) columns.push(column)
    else constraints.push({ sql: item, kind: classifyConstraint(item) })
  }
  if (columns.length === 0) throw new Error('the table definition lists no columns')

  // Position the primary-key columns: an inline `PRIMARY KEY` is a one-column
  // key, a table constraint's column list gives the order of a composite one.
  const primary = constraints.find(constraint => constraint.kind === 'primary')
  if (primary !== undefined) {
    const listMatch = /\(\s*([\s\S]*)\)\s*$/.exec(primary.sql)
    if (listMatch !== null) {
      const names = splitTopLevel(listMatch[1]!).map(part => unquoteIdentifier(/^([^\s]*)/.exec(part.trim())?.[1] ?? ''))
      for (const [index, columnName] of names.entries()) {
        const column = columns.find(candidate => candidate.name.toLowerCase() === columnName.toLowerCase())
        if (column !== undefined) column.primaryKeyPosition = index + 1
      }
    }
  }
  for (const column of columns) if (column.primaryKeyPosition !== undefined && column.primaryKeyPosition > 1) column.nullable = false

  return { name, ifNotExists, columns, constraints, tail }
}

/**
 * Whether a column definition is SQLite's rowid alias.
 *
 * `INTEGER PRIMARY KEY` — exactly that declared type — is the one column in
 * SQLite that behaves like MySQL's AUTO_INCREMENT: inserting NULL makes the
 * engine pick the next value. `INT PRIMARY KEY` does not, and offering a blank
 * field for it would produce an INSERT of NULL into a NOT NULL column.
 */
export function isSqliteRowidAlias(column: ColumnDefinition): boolean {
  return column.primaryKeyPosition === 1 && column.type.trim().toLowerCase().replace(/\s+/g, ' ') === 'integer'
}

// ---- CREATE TABLE rendering -----------------------------------------------

/** Emit one column's clause. */
export function renderColumn(column: ColumnDefinition, dialect: SqlDialect): string {
  const parts: string[] = [identifier(column.name, 'column name', dialect)]
  const type = column.type.trim() === '' ? '' : normalizeType(column.type, dialect)
  if (type !== '') parts.push(type)
  parts.push(...column.extras)
  // A generated column's `AS (…)` clause lives in `extras`, so nothing is added
  // for it here; the flags below would be illegal on one.
  if (column.generated !== true) {
    parts.push(column.nullable ? 'NULL' : 'NOT NULL')
    if (column.defaultValue !== undefined) {
      const value = normalizeDefault(column.defaultValue, dialect)
      if (value !== undefined) parts.push(`DEFAULT ${value}`)
    }
    if (column.unique === true) parts.push('UNIQUE')
    if (column.autoIncrement === true && dialect === 'mysql') parts.push('AUTO_INCREMENT')
    if (column.check !== undefined) parts.push(column.check)
  }
  if (column.comment !== undefined && dialect === 'mysql') parts.push(`COMMENT ${quoteLiteral(column.comment)}`)
  return parts.join(' ')
}

/**
 * Render a `CREATE TABLE` from a shape.
 *
 * A single-column primary key is emitted inline; a composite one is emitted as
 * a table constraint by {@link ensurePrimaryKeyConstraint}, so its column order
 * is explicit.
 */
export function renderCreateTable(
  shape: TableShape,
  dialect: SqlDialect,
  options: { name?: string; ifNotExists?: boolean } = {},
): string {
  const name = options.name ?? shape.name
  const columns = shape.columns
  const keyed = columns.filter(column => column.primaryKeyPosition !== undefined)
  const inlineKey = keyed.length === 1 ? keyed[0] : undefined

  const items = columns.map(column => {
    const rendered = renderColumn(column, dialect)
    if (column !== inlineKey) return rendered
    const sqliteAuto = dialect === 'sqlite' && column.sqliteAutoincrement === true ? ' AUTOINCREMENT' : ''
    return `${rendered} PRIMARY KEY${sqliteAuto}`
  })

  const constraints = shape.constraints.map(constraint => constraint.sql)
  const body = [...items, ...constraints].map(item => `  ${item}`).join(',\n')
  const tail = shape.tail === '' ? '' : ` ${shape.tail}`
  // Parenthesised on purpose: `options.ifNotExists ?? shape.ifNotExists ? … : ''`
  // parses as `(options.ifNotExists ?? shape.ifNotExists) ? …`, which is what is
  // wanted, but the unambiguous form is worth the brackets here.
  const flag = (options.ifNotExists ?? shape.ifNotExists) === true ? 'IF NOT EXISTS ' : ''
  return `CREATE TABLE ${flag}${identifier(name, 'table name', dialect)} (\n${body}\n)${tail}`
}

/** Read the columns an inline or table-level primary key covers, in key order. */
export function primaryKeyColumns(shape: TableShape): string[] {
  return shape.columns
    .filter(column => column.primaryKeyPosition !== undefined)
    .sort((a, b) => a.primaryKeyPosition! - b.primaryKeyPosition!)
    .map(column => column.name)
}

/**
 * Replace the shape's primary key with the given columns, in order.
 *
 * The table-level `PRIMARY KEY` constraint (if any) is dropped and rebuilt from
 * the positions, so a shape cannot end up carrying both an inline marker and a
 * table constraint for the same key — which the engine would reject as two
 * primary keys, or silently read as a different key than the one on screen.
 *
 * @param columns - key columns in key order; empty drops the key entirely.
 */
export function setPrimaryKey(shape: TableShape, columns: string[], dialect: SqlDialect): void {
  for (const column of shape.columns) delete column.primaryKeyPosition
  shape.constraints = shape.constraints.filter(constraint => constraint.kind !== 'primary')
  if (columns.length === 0) return

  for (const [index, name] of columns.entries()) {
    const column = shape.columns.find(candidate => candidate.name === name)
    if (column === undefined) throw new Error(`no such column: ${JSON.stringify(name)}`)
    column.primaryKeyPosition = index + 1
    // A key column is NOT NULL in every engine here, whether or not the original
    // statement said so. Leaving it nullable would let the rebuild create a
    // table whose key column accepts NULL.
    column.nullable = false
  }

  // A one-column key stays inline (see renderCreateTable); a composite one needs
  // a table constraint, because the inline form cannot express the order.
  if (columns.length > 1) {
    shape.constraints.push({
      sql: `PRIMARY KEY (${columns.map(name => identifier(name, 'column name', dialect)).join(', ')})`,
      kind: 'primary',
    })
  }
}

