/**
 * Redis key-name conventions shared by both halves.
 *
 * Lives outside `client/` because the host needs the same rules: the folder
 * pattern the browser shows must be byte-identical to the one the server
 * *deletes* with, and a second implementation is exactly how those two drift
 * apart.
 */

/** The separator Redis GUIs group on. */
export const SEPARATOR = ':'

/**
 * Escape a literal string for use inside a Redis glob `MATCH` pattern.
 *
 * Key names are arbitrary bytes, so a folder called `a*b` (or one containing
 * `?`, `[`, `]`, `\`) would otherwise be read as wildcards — and because the
 * folder operations DELETE what the pattern matches, an unescaped metacharacter
 * would silently destroy keys outside the folder. Backslash and the four glob
 * metacharacters are the complete escape set.
 */
export function escapeGlob(literal: string): string {
  return literal.replace(/[\\*?[\]]/g, match => `\\${match}`)
}

/**
 * The `MATCH` pattern selecting everything under a folder: the folder's own
 * key (`a:b`) plus its descendants (`a:b:c`, `a:b:c:d`).
 *
 * Both are included deliberately. RDM shows a key that doubles as a folder, and
 * deleting the folder must remove that key too — otherwise the folder would
 * reappear on the next scan, apparently un-deletable.
 */
export function prefixPattern(path: string): string {
  return `${escapeGlob(path)}${SEPARATOR}*`
}

/** The exact-match pattern for one key, glob-escaped. */
export function keyPattern(key: string): string {
  return escapeGlob(key)
}

/**
 * Whether a key belongs to a folder — its own key, or any descendant.
 * Mirrors {@link prefixPattern} exactly, so a dialog's count and the delete
 * agree on what "this folder" means.
 */
export function isUnderPrefix(key: string, path: string): boolean {
  return key === path || key.startsWith(`${path}${SEPARATOR}`)
}

/**
 * The name to pre-fill in the new-key form for a folder.
 *
 * An empty path means the root, where the user types a free name; otherwise the
 * folder path plus a separator, so the common case is just typing the leaf.
 */
export function createPrefix(path: string | undefined): string {
  if (path === undefined || path === '') return ''
  return `${path}${SEPARATOR}`
}

/**
 * Split the new-key form's name field into the keys to create.
 *
 * One line per key, so a folder can be seeded several keys at a time. Blank
 * lines are dropped and surrounding whitespace trimmed; a name is otherwise
 * taken literally (spaces inside it are preserved, since Redis allows them).
 *
 * @param text - the textarea contents.
 * @param prefix - the folder prefix to prepend, from {@link createPrefix}.
 */
export function parseKeyNames(text: string, prefix: string): string[] {
  const names: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    names.push(`${prefix}${trimmed}`)
  }
  return names
}
