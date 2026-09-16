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

const templates = loadTemplates()
let failed = false

for (const file of sourceFiles(join(root, 'src'))) {
  const source = readFileSync(file, 'utf8')
  const lines = source.split('\n')

  lines.forEach((line, index) => {
    // Only literal call sites, and only real locale keys.
    //
    // A locale key always contains a dot ('redisdb.search.header'); a bare
    // identifier does not. Requiring the dot is what keeps `React.createElement
    // ('span', { ... })` from being read as `t('span', {...})` — the first
    // version of this check reported every element name in the codebase.
    const call = /\bt\('([a-zA-Z0-9._]*\.[a-zA-Z0-9._]+)'\s*,\s*\{([^}]*)\}/.exec(line)
    if (call === null) return
    const key = call[1]
    const template = templates.get(key)
    if (template === undefined) {
      console.log(`${file.replace(root, '')}:${index + 1}: t('${key}') has no zh template`)
      failed = true
      return
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
        `${file.replace(root, '')}:${index + 1}: t('${key}') is missing ${missing.map(n => `'${n}'`).join(', ')}` +
        ` (template needs {${[...needs].join('} {')}})`,
      )
      failed = true
    }

    const extra = [...supplies].filter(name => !needs.has(name))
    if (extra.length > 0) {
      // Informational: an unused value is harmless, but it is usually a typo for
      // a real placeholder, which is exactly what the check above catches.
      console.log(
        `${file.replace(root, '')}:${index + 1}: t('${key}') also passes unused ${extra.map(n => `'${n}'`).join(', ')}`,
      )
    }
  })
}

console.log(failed ? 'FAILED' : 'ok')
process.exitCode = failed ? 1 : 0
