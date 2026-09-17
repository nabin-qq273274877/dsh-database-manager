/**
 * Check that every t('key', {...}) call supplies the placeholders its template uses.
 *
 * The bug this catches: `t('redisdb.search.header', { db: 3, pattern: 'jd:*' })`
 * against a template `'db{n} 中匹配「{pattern}」的键'` — the interpolator leaves
 * unknown names alone, so the header rendered a literal "db{n}" instead of "db3".
 * Nothing throws; only reading the rendered text reveals it.
 *
 * A missing placeholder is a hard error here (it always shows as `{name}`), while
 * an EXTRA name is reported as informational, since it is harmless.
 *
 * Usage: node scripts/check-locale-placeholders.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** The zh dictionary, which the `Dict` type makes the key-set source of truth. */
function loadTemplates() {
  const source = readFileSync(join(root, 'src/client/locales.ts'), 'utf8')
  const templates = new Map()
  // Match `'key': 'template',` pairs; the file is a flat object literal.
  const re = /'([a-zA-Z0-9._]+)':\s*'((?:[^'\\]|\\.)*)'/g
  let match
  while ((match = re.exec(source)) !== null) {
    // The English dictionary repeats the keys; the zh entry comes first and is
    // the one with the placeholders that matter, so keep the first.
    if (!templates.has(match[1])) templates.set(match[1], match[2])
  }
  return templates
}

/** Every .ts under src/, recursively. */
function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (entry.endsWith('.ts')) out.push(path)
  }
  return out
}

/**
 * Blank out comments, preserving every other character and every newline.
 *
 * Without this the scan reads braces that live in prose. The banner's own doc
 * comment explains the bug by quoting "{n}" and "db{n}", and since `[^}]*` stops
 * at the first `}`, the call below it parsed as an argument list containing none
 * of its real names — a false "missing 'n'" on correct code. A checker that cries
 * wolf is worse than no checker, because the next real report gets ignored. A
 * false alarm also costs the reader time to disprove, every time.
 *
 * Offsets are preserved (comment bytes become spaces, newlines stay) so the line
 * number derived from the match index still points at the real call site.
 *
 * This is a scanner, not a parser: string and template contents are skipped so a
 * URL's `//` is not read as a comment. A regex literal containing a quote could
 * still confuse it, and that risk is only ever to UNDER-report, never to invent a
 * finding — the direction that matters for a guard.
 */
function maskComments(source) {
  const out = source.split('')
  let i = 0
  let state = 'code'
  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]
    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; out[i] = out[i + 1] = ' '; i += 2; continue }
      if (c === '/' && next === '*') { state = 'block'; out[i] = out[i + 1] = ' '; i += 2; continue }
      if (c === "'" || c === '"' || c === '`') { state = c; i += 1; continue }
      i += 1
      continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code' } else { out[i] = ' ' }
      i += 1
      continue
    }
    if (state === 'block') {
      if (c === '*' && next === '/') { out[i] = out[i + 1] = ' '; i += 2; state = 'code'; continue }
      if (c !== '\n') out[i] = ' '
      i += 1
      continue
    }
    // Inside a string or template literal: skip escapes so `\'` cannot end it.
    if (c === '\\') { i += 2; continue }
    if (c === state) state = 'code'
    i += 1
  }
  return out.join('')
}

const templates = loadTemplates()
let failed = false

for (const file of sourceFiles(join(root, 'src'))) {
  const source = maskComments(readFileSync(file, 'utf8'))

  /**
   * Scan the WHOLE file, not one line at a time.
   *
   * This check used to run per line, which silently missed every call whose
   * argument object is written across several lines — the shape used wherever a
   * template takes more than one value. `t('redis.index.building', { db, ... })`
   * was exactly that, and it shipped: the template names {n}, the call supplied
   * `db`, and the banner rendered the literal "正在为 db{n} 建立索引". A guard that
   * only recognises the one-line spelling of the very pattern it guards is a
   * guard against a fraction of the problem.
   *
   * `[^}]*` already spans newlines, so matching the full text is enough; the
   * line number is recovered from the match offset for a usable message.
   */
  const re = /\bt\('([a-zA-Z0-9._]*\.[a-zA-Z0-9._]+)'\s*,\s*\{([^}]*)\}/g
  let call
  while ((call = re.exec(source)) !== null) {
    const line = source.slice(0, call.index).split('\n').length
    const key = call[1]
    const template = templates.get(key)
    if (template === undefined) {
      console.log(`${file.replace(root, '')}:${line}: t('${key}') has no zh template`)
      failed = true
      continue
    }

    const needs = new Set([...template.matchAll(/\{(\w+)\}/g)].map(m => m[1]))
    /**
     * The names supplied by the call's object literal.
     *
     * Covers both `name: value` and the SHORTHAND `{ prefix }`, which is plain
     * `prefix:` with the value elided. Missing the shorthand form reported two
     * correct call sites as broken (`{ prefix }`, `{ pages }`) — the check has to
     * understand the syntax it is reading, not just the shape it expects.
     */
    const supplies = new Set(
      call[2]
        .split(',')
        .map(part => part.trim())
        .filter(part => part !== '')
        .map(part => {
          const colon = /^([A-Za-z_$][\w$]*)\s*:/.exec(part)
          if (colon !== null) return colon[1]
          // Shorthand or a spread; a bare identifier is a shorthand property.
          const bare = /^([A-Za-z_$][\w$]*)$/.exec(part)
          return bare !== null ? bare[1] : undefined
        })
        .filter(name => name !== undefined),
    )

    const missing = [...needs].filter(name => !supplies.has(name))
    if (missing.length > 0) {
      console.log(
        `${file.replace(root, '')}:${line}: t('${key}') is missing ${missing.map(n => `'${n}'`).join(', ')}` +
        ` (template needs {${[...needs].join('} {')}})`,
      )
      failed = true
    }

    const extra = [...supplies].filter(name => !needs.has(name))
    if (extra.length > 0) {
      // Informational: an unused value is harmless, but it is usually a typo for
      // a real placeholder, which is exactly what the check above catches.
      console.log(
        `${file.replace(root, '')}:${line}: t('${key}') also passes unused ${extra.map(n => `'${n}'`).join(', ')}`,
      )
    }
  }

  /*
   * Calls that pass NO second argument at all.
   *
   * The regex above REQUIRES a `{...}` object, so `t('k')` was never examined — and that is
   * the shape that shipped a literal `{name}` on screen in the create-table dialog:
   * `t('createTable.autoNeedsNumeric')` against a template of `'{name} 要自增…'`. A guard
   * whose pattern demands the very argument that is missing cannot see the omission, which
   * made it blind to the simplest form of the bug it exists to catch.
   *
   * Scanned separately rather than by loosening the main regex: that one also extracts the
   * supplied names, so making the object optional would complicate that extraction for no
   * gain. Two clear scans beat one clever pattern.
   */
  const bare = /\bt\('([a-zA-Z0-9._]*\.[a-zA-Z0-9._]+)'\)/g
  let bareCall
  while ((bareCall = bare.exec(source)) !== null) {
    const line = source.slice(0, bareCall.index).split('\n').length
    const key = bareCall[1]
    const template = templates.get(key)
    if (template === undefined) {
      console.log(`${file.replace(root, '')}:${line}: t('${key}') has no zh template`)
      failed = true
      continue
    }
    const needs = [...template.matchAll(/\{(\w+)\}/g)].map(m => m[1])
    if (needs.length === 0) continue
    console.log(
      `${file.replace(root, '')}:${line}: t('${key}') passes no values but the template needs ` +
      `{${needs.join('} {')}} — it would render the literal placeholder`,
    )
    failed = true
  }
}

console.log(failed ? 'FAILED' : 'ok')
process.exitCode = failed ? 1 : 0
