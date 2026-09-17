/**
 * Guard every file that carries code inside a template literal.
 *
 * Two kinds of file in this plugin embed other languages in a JS template
 * literal:
 *
 * - the browser stylesheet (`src/client/styles.ts` holds CSS)
 * - the E2E scripts (their page flow is embedded JavaScript)
 *
 * A backtick ANYWHERE inside such a literal — including in a comment — closes it
 * early. The resulting error names the embedded language (a CSS line, or a bogus
 * "X is not defined"), not the stray backtick, so the search goes in the wrong
 * direction. That cost real time twice while this plugin was written, so it is
 * checked mechanically instead of by eye.
 *
 * `node --check` alone is not enough for the scripts: a PAIR of stray backticks
 * still parses (they open and close a second literal) and only fails at runtime.
 * Hence the explicit comment scan, which is treated as a hard error.
 *
 * Run this after editing any file listed below; `npm test` does not cover them.
 *
 * Usage: node scripts/check-template-literals.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** Files whose template literals must not contain a stray backtick. */
const files = [
  // Embedded CSS.
  'src/client/styles.ts',
  // Embedded page JavaScript.
  'scripts/e2e-redis-tree.mjs',
  'scripts/e2e-redis-edit.mjs',
  'scripts/e2e-ttl-countdown.mjs',
  'scripts/e2e-panel.mjs',
  'scripts/shot-redis-tree.mjs',
  'scripts/shot-ttl-row.mjs',
  'scripts/bench-tree-e2e.mjs',
  'scripts/dump-value-pane.mjs',
  'scripts/e2e-tree-loading.mjs',
  'scripts/e2e-db-scope.mjs',
  'scripts/e2e-index-routes.mjs',
  'scripts/e2e-index-used.mjs',
  'scripts/e2e-search-tree.mjs',
  'scripts/shot-tree-loading.mjs',
  'scripts/e2e-sql-editing.mjs',
  'scripts/e2e-sql-search.mjs',
  'scripts/e2e-table-actions.mjs',
  'scripts/probe-side-refresh.mjs',
  'scripts/probe-side-refresh-poll.mjs',
  'scripts/probe-collate-link.mjs',
  'scripts/probe-dbop-pane.mjs',
  'scripts/probe-create-table.mjs',
  'scripts/probe-create-table-full.mjs',
  'scripts/probe-create-table-ui.mjs',
  'scripts/probe-create-table-grid.mjs',
  'scripts/probe-autoincrement.mjs',
  'scripts/probe-create-table-capabilities.mjs',
  'scripts/probe-sqlite-caps.mjs',
  'scripts/probe-sqlite-traps.mjs',
  'scripts/repro-rename.mjs',
  'scripts/measure-tree-number.mjs',
  'scripts/measure-tree-mysql-counts.mjs',
  'scripts/measure-tree-long-names.mjs',
]

let failed = false
for (const relative of files) {
  const path = join(root, relative)
  let source
  try {
    source = readFileSync(path, 'utf8')
  } catch {
    console.log(`${relative}: not found, skipped`)
    continue
  }

  // A backtick inside a COMMENT line of embedded code is always a mistake: the
  // literal's own delimiters are not comments, and no comment needs a backtick.
  //
  // Leading whitespace is required before the marker, which keeps a BACKTICK
  // DELIMITER at the start of a line (`\`` alone, or `  \`,`) from being read as
  // a comment — otherwise the guard would flag its own subject.
  const commentHits = source.split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(entry => /^\s*(\*|\/\/)/.test(entry.line) && entry.line.includes('`'))

  // The parse check catches an odd number of backticks and any other syntax
  // error. `npm run typecheck` covers the .ts file too, but running it here
  // keeps this guard self-contained and lets it cover the .mjs files, which
  // tsc does not read.
  let parseError = null
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' })
  } catch (error) {
    parseError = String(error.stderr ?? error.message).split('\n').slice(0, 3).join(' ').trim()
  }

  const ok = parseError === null && commentHits.length === 0
  console.log(`${relative}: ${ok ? 'ok' : 'FAILED'}`)
  for (const hit of commentHits) {
    console.log(`  L${hit.number}: comment contains a backtick -> ${hit.line.trim()}`)
  }
  if (parseError !== null) console.log(`  ${parseError}`)
  if (!ok) failed = true
}

process.exitCode = failed ? 1 : 0
