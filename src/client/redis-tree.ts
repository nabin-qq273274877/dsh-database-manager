/**
 * Redis key tree: turn a flat key list into the folder hierarchy
 * RedisDesktopManager shows, and derive the queries that operate on a folder.
 *
 * Pure and React-free on purpose — the grouping rules (separator, escaping,
 * sorting, the key-that-is-also-a-folder case) are the part most likely to be
 * subtly wrong, so they must be testable without a DOM.
 *
 * The prefix/glob rules themselves live in `../redis-util.ts` because the host
 * half deletes by the very patterns this file renders; one implementation
 * keeps what the user sees and what the server removes identical.
 */

import type { RedisKeyInfo } from '../protocol.ts'
import {
  SEPARATOR,
  createPrefix,
  escapeGlob,
  isUnderPrefix,
  keyPattern,
  parseKeyNames,
  prefixPattern,
} from '../redis-util.ts'

export { SEPARATOR, createPrefix, escapeGlob, isUnderPrefix, keyPattern, parseKeyNames, prefixPattern }

/** One folder in the tree. */
export interface RedisFolderNode {
  /** This level's own label, e.g. `b` for the folder `a:b`. */
  name: string
  /** The full path from the root, e.g. `a:b`. Also the delete/match prefix. */
  path: string
  /** Sub-folders, sorted by name. */
  folders: RedisFolderNode[]
  /**
   * Keys that live exactly at this level. A key may share its name with a
   * folder — `a:b` can be a string AND have children under `a:b:` — and both
   * must be visible, which is why a folder carries keys of its own rather than
   * being purely a grouping.
   */
  keys: RedisKeyInfo[]
}

/** The whole tree for one logical database. */
export interface RedisTree {
  /** Top-level folders, sorted by name. */
  folders: RedisFolderNode[]
  /** Keys with no separator at all. */
  keys: RedisKeyInfo[]
  /** Total keys considered (the scan's own count). */
  total: number
  /** True when the source scan was capped, so folders may lack members. */
  truncated: boolean
}

/** Sort keys the way the tree renders them: by name, case-insensitively. */
function byName(a: RedisKeyInfo, b: RedisKeyInfo): number {
  return a.key.localeCompare(b.key, undefined, { sensitivity: 'base' })
}

/**
 * Build the folder tree from a flat key list.
 *
 * A key is split on {@link SEPARATOR}; each piece is one folder level and the
 * last piece is the key itself. `a:b:c` therefore becomes folder `a` → folder
 * `b` → key `c`, and the leaf key keeps its FULL name (`a:b:c`) because that is
 * what every Redis command needs — the tree is a view, not a renaming.
 *
 * @param keys - keys from a whole-database scan.
 * @param truncated - whether the scan that produced `keys` was itself capped.
 */
export function buildRedisTree(keys: readonly RedisKeyInfo[], truncated = false): RedisTree {
  const root: RedisFolderNode = { name: '', path: '', folders: [], keys: [] }
  /** path -> node, so a shared prefix is walked once. */
  const folders = new Map<string, RedisFolderNode>([['', root]])

  for (const info of keys) {
    const parts = info.key.split(SEPARATOR)
    if (parts.length === 1) {
      root.keys.push(info)
      continue
    }
    // Every piece but the last is a folder; the last is the key's own name.
    let parent = root
    let path = ''
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i]!
      path = path === '' ? segment : `${path}${SEPARATOR}${segment}`
      let node = folders.get(path)
      if (node === undefined) {
        node = { name: segment, path, folders: [], keys: [] }
        folders.set(path, node)
        parent.folders.push(node)
      }
      parent = node
    }
    parent.keys.push(info)
  }

  sortNode(root)
  return { folders: root.folders, keys: root.keys, total: keys.length, truncated }
}

/** Recursively order a node's children: folders first, then keys, both by name. */
function sortNode(node: RedisFolderNode): void {
  node.folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  node.keys.sort(byName)
  for (const folder of node.folders) sortNode(folder)
}

/** How many keys a folder holds in total, including nested folders. */
export function countFolderKeys(folder: RedisFolderNode): number {
  let total = folder.keys.length
  for (const child of folder.folders) total += countFolderKeys(child)
  return total
}

/** Whether a key name matches the tree filter (empty filter matches all). */
export function matchesFilter(key: string, filter: string): boolean {
  if (filter === '') return true
  return key.toLowerCase().includes(filter.toLowerCase())
}

/**
 * Prune a tree to the keys matching a filter.
 *
 * A folder is kept when any key beneath it matches, so filtering narrows the
 * tree instead of flattening it — the folder structure stays visible while the
 * user types, which is the point of having one.
 */
export function filterTree(tree: RedisTree, filter: string): RedisTree {
  if (filter === '') return tree
  const prune = (node: RedisFolderNode): RedisFolderNode | undefined => {
    const folders: RedisFolderNode[] = []
    for (const child of node.folders) {
      const kept = prune(child)
      if (kept !== undefined) folders.push(kept)
    }
    const keys = node.keys.filter(info => matchesFilter(info.key, filter))
    if (folders.length === 0 && keys.length === 0) return undefined
    return { ...node, folders, keys }
  }
  const root: RedisFolderNode = { name: '', path: '', folders: tree.folders, keys: tree.keys }
  const kept = prune(root)
  return {
    folders: kept?.folders ?? [],
    keys: kept?.keys ?? [],
    total: tree.total,
    truncated: tree.truncated,
  }
}

/** One parsed line of the elements textarea. */
export interface ParsedElements {
  value?: string
  items?: string[]
  fields?: Array<{ field: string; value: string }>
  members?: Array<{ member: string; score: string }>
}

/** Result of parsing the form's content box. */
export type ParseOutcome =
  | { ok: true; content: ParsedElements }
  | { ok: false; error: string }

/**
 * Parse the content box for a type.
 *
 * The grammar is one entry per line, which is the least surprising thing for a
 * text box and keeps the form usable without a full editor:
 *
 * - `string`  the whole box is the value (newlines preserved)
 * - `list`    one element per line
 * - `set`     one element per line
 * - `hash`    `field value` — split on the first whitespace run
 * - `zset`    `score member` — score first, matching `ZADD key score member`
 *
 * Values are taken literally: no quoting, no escapes. Redis values are binary
 * and a quoting layer would only make some of them untypeable.
 *
 * @param type - the selected type.
 * @param text - the textarea contents.
 * @param key - the key name, used only to make error messages specific.
 */
export function parseElements(type: string, text: string, key: string): ParseOutcome {
  if (type === 'string') return { ok: true, content: { value: text } }

  const lines = text.split(/\r?\n/).map(line => line.trimEnd()).filter(line => line.trim() !== '')

  if (type === 'list' || type === 'set') {
    if (lines.length === 0) return { ok: false, error: `「${key}」需要一个元素（每行一个）` }
    return { ok: true, content: { items: lines } }
  }

  if (type === 'hash') {
    const fields: Array<{ field: string; value: string }> = []
    for (const [index, line] of lines.entries()) {
      const match = /^(\S+)[ \t]+(.*)$/.exec(line)
      if (match === null) return { ok: false, error: `「${key}」第 ${index + 1} 行格式应为：字段 值` }
      fields.push({ field: match[1]!, value: match[2]! })
    }
    if (fields.length === 0) return { ok: false, error: `「${key}」需要一个字段（每行「字段 值」）` }
    return { ok: true, content: { fields } }
  }

  if (type === 'zset') {
    const members: Array<{ member: string; score: string }> = []
    for (const [index, line] of lines.entries()) {
      const match = /^(\S+)[ \t]+(.+)$/.exec(line)
      if (match === null) return { ok: false, error: `「${key}」第 ${index + 1} 行格式应为：分值 成员` }
      const score = Number(match[1])
      if (!Number.isFinite(score)) return { ok: false, error: `「${key}」第 ${index + 1} 行的分值不是数字：${match[1]}` }
      members.push({ member: match[2]!, score: match[1]! })
    }
    if (members.length === 0) return { ok: false, error: `「${key}」需要一个成员（每行「分值 成员」）` }
    return { ok: true, content: { members } }
  }

  return { ok: false, error: `不支持的类型：${type}` }
}

/** The placeholder copy for the content box of each type. */
export function contentPlaceholder(type: string): string {
  switch (type) {
    case 'list': return '每行一个元素'
    case 'set': return '每行一个成员'
    case 'hash': return '每行一个字段：字段 值'
    case 'zset': return '每行一个成员：分值 成员'
    default: return '字符串值'
  }
}

/** Whether the content box takes one entry per line for a type. */
export function usesElementLines(type: string): boolean {
  return type === 'list' || type === 'set' || type === 'hash' || type === 'zset'
}
