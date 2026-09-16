/**
 * Guard the E2E scripts' embedded page code.
 *
 * Each E2E script carries its page flow inside a JS template literal, so an
 * unescaped backtick anywhere inside it closes the literal and the script dies
 * at parse time with a misleading error ("X is not defined", "Unexpected
 * identifier"). That happened repeatedly while these scripts were written, and
 * each time was diagnosed by hand, so it is checked mechanically here instead.
 *
 * Run this after editing any script listed below. `npm test` does not cover
 * these files.
 *
 * Usage: node scripts/check-e2e-scripts.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))

const files = [
  'e2e-redis-tree.mjs',
  'e2e-redis-edit.mjs',
  'e2e-ttl-countdown.mjs',
  'e2e-panel.mjs',
  'shot-redis-tree.mjs',
  'bench-tree-e2e.mjs',
  'dump-value-pane.mjs',
]

let failed = false
for (const name of files) {
  const path = join(here, name)
  let source
  try {
    source = readFileSync(path, 'utf8')
  } catch {
    console.log(`${name}: not found, skipped`)
    continue
  }

  // A backtick inside a COMMENT line of the embedded code is always a mistake:
  // the template literal's own delimiters are not comments, and no comment needs
  // a backtick.
  //
  // This is a FAILURE, not a warning. `node --check` cannot be relied on to catch
  // it: a pair of stray backticks in comments still parses (they open and close a
  // second template literal), and the damage only shows at RUNTIME as a bogus
  // "X is not defined". That is exactly how this defect slipped through once
  // already, so it is reported as a hard error here.
  const commentHits = source.split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(entry => /^\s*(\*|\/\/)/.test(entry.line) && entry.line.includes('`'))

  // Does Node parse the file at all? Catches an odd number of backticks, and any
  // other syntax error.
  let parseError = null
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' })
  } catch (error) {
    parseError = String(error.stderr ?? error.message).split('\n').slice(0, 3).join(' ').trim()
  }

  const ok = parseError === null && commentHits.length === 0
  console.log(`${name}: ${ok ? 'ok' : 'FAILED'}`)
  for (const hit of commentHits) {
    console.log(`  L${hit.number}: comment contains a backtick -> ${hit.line.trim()}`)
  }
  if (parseError !== null) console.log(`  ${parseError}`)
  if (!ok) failed = true
}

process.exitCode = failed ? 1 : 0
