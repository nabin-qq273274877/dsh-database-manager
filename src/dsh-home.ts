/**
 * DSH_HOME resolution for the host half: the environment override wins, the
 * platform home fallback follows. Same contract as the dsh-ssh family so every
 * plugin agrees on where user-owned state lives.
 */

import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { isAbsolute as posixIsAbsolute, join as posixJoin } from 'node:path/posix'

/** Expand a leading ~ (or ~user) in a path, platform-style. */
export function expandHome(path: string, home: string = homedir()): string {
  const isPosix = home.startsWith('/')
  const j = isPosix ? posixJoin : join
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return j(home, path.slice(2))
  return path
}

/**
 * Resolve the DSH home directory.
 * @param env - process environment to read DSH_HOME from.
 * @param home - platform home directory fallback (test seam).
 * @returns the absolute DSH home path.
 */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const isPosix = home.startsWith('/')
  const j = isPosix ? posixJoin : join
  const isAbs = isPosix ? posixIsAbsolute : isAbsolute
  const raw = env.DSH_HOME
  if (raw !== undefined && raw.trim() !== '') {
    const expanded = expandHome(raw.trim(), home)
    return isAbs(expanded) ? expanded : j(process.cwd(), expanded)
  }
  return j(home, '.dsh')
}

/** Resolve the DSH home directory from the live environment. */
export function dshHome(): string {
  return resolveDshHome()
}
