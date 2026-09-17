import { spawn } from 'node:child_process'

/*
 * Start `dsh web` detached and wait for it to listen, then print the URL.
 *
 * A separate helper because `Start-Process` from a transient PowerShell invocation
 * did not survive the parent exiting (measured: the port was listening, then the
 * process was gone with an empty log and no error). Detaching with `child_process`
 * and `unref()` keeps it alive independently of this script.
 *
 * Usage: node scripts/start-debug-web.mjs [port]
 */
const port = process.argv[2] ?? '3080'
const out = `${process.env.TEMP}\\dsh-dbm-e2e\\web-${port}.log`

const child = spawn('dsh', ['web', '--port', String(port), '--no-open'], {
  // DSH_HOME must be cleared so the home resolves to ~/.dsh: the agent shell derives
  // from the desktop app and inherits DSH_HOME, which would point this instance at
  // the desktop's own data directory instead.
  env: { ...process.env, DSH_HOME: undefined },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
})

let text = ''
child.stdout.on('data', data => { text += String(data) })
child.stderr.on('data', data => { text += String(data) })
child.unref()

const started = Date.now()
const deadline = started + 120_000
let found
while (Date.now() < deadline && found === undefined) {
  // `dsh web` prints its URL on the first line; a fresh token each start.
  found = /https?:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/.exec(text)?.[0]
  if (found === undefined) await new Promise(resolve => setTimeout(resolve, 300))
}

if (found === undefined) {
  console.error(`the service never printed a URL within 120s; output so far:`)
  console.error(text)
  process.exit(1)
}
// Record the log so a later failure can be read rather than guessed at.
const fs = await import('node:fs')
fs.writeFileSync(out, text, 'utf8')
console.log(found)
console.log(`(pid ${child.pid}, log ${out})`)
