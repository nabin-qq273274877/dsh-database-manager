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
  // a backtick. This is the exact shape that broke the scripts.
  const commentHits = source.split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(entry => /^\s*(\*|\/\/)/.test(entry.line) && entry.line.includes('`'))

  // The authoritative check: does Node parse the file at all?
  let parseError = null
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' })
  } catch (error) {
    parseError = String(error.stderr ?? error.message).split('\n').slice(0, 3).join(' ').trim()
  }

  console.log(`${name}: ${parseError === null ? 'ok' : 'PARSE FAILED'}`)
  for (const hit of commentHits) {
    console.log(`  L${hit.number}: comment contains a backtick -> ${hit.line.trim()}`)
  }
  if (parseError !== null) {
    console.log(`  ${parseError}`)
    failed = true
  }
}

process.exitCode = failed ? 1 : 0
