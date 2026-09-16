/**
 * Redis key tree: grouping, escaping, filtering and form parsing.
 *
 * The escaping rules get the most attention here on purpose. A folder's keys
 * are selected by a glob `MATCH` pattern derived from the folder's own name,
 * and that same pattern drives a DELETE — so a key name that is read as a
 * wildcard would silently destroy keys outside the folder. Every metacharacter
 * is therefore asserted explicitly.
 */

import { describe, expect, it } from 'vitest'
import type { RedisKeyInfo } from '../src/protocol.ts'
import {
  buildRedisTree,
  contentPlaceholder,
  countFolderKeys,
  createPrefix,
  escapeGlob,
  filterTree,
  isUnderPrefix,
  keyPattern,
  parseElements,
  parseKeyNames,
  prefixPattern,
  usesElementLines,
} from '../src/client/redis-tree.ts'

/** A key row with just the fields the tree reads. */
function key(key: string, type = 'string', ttl = -1): RedisKeyInfo {
  return { key, type, ttl }
}

describe('buildRedisTree', () => {
  it('groups keys by their : segments into nested folders', () => {
    const tree = buildRedisTree([key('a:b:c'), key('a:b:d'), key('a:x'), key('plain')])

    expect(tree.keys.map(item => item.key)).toEqual(['plain'])
    expect(tree.folders.map(folder => folder.name)).toEqual(['a'])

    const a = tree.folders[0]!
    expect(a.path).toBe('a')
    // `a:x` lives directly under `a`; `a:b:*` goes one level deeper.
    expect(a.keys.map(item => item.key)).toEqual(['a:x'])
    expect(a.folders.map(folder => folder.name)).toEqual(['b'])

    const b = a.folders[0]!
    expect(b.path).toBe('a:b')
    expect(b.keys.map(item => item.key)).toEqual(['a:b:c', 'a:b:d'])
  })

  it('keeps a key that doubles as a folder visible at both levels', () => {
    // `a:b` is a string, AND `a:b:c` puts a folder `b` inside folder `a`. Both
    // are shown, as siblings under `a`: a folder leaf `b` and a key leaf `b`.
    // Hiding either would make the tree disagree with KEYS.
    const tree = buildRedisTree([key('a:b'), key('a:b:c')])
    const a = tree.folders[0]!
    const b = a.folders[0]!

    // The key `a:b` hangs off folder `a` (its leaf is `b`), not off folder
    // `a:b` — its own name is not one of its ancestors.
    expect(a.keys.map(item => item.key)).toEqual(['a:b'])
    expect(b.path).toBe('a:b')
    expect(b.keys.map(item => item.key)).toEqual(['a:b:c'])
  })

  it('shows the folder and the same-named key as siblings', () => {
    const tree = buildRedisTree([key('a:b'), key('a:b:c')])
    const a = tree.folders[0]!
    // Both exist at this level: one folder node, one key node.
    expect(a.folders.map(folder => folder.name)).toEqual(['b'])
    expect(a.keys.map(item => item.key)).toEqual(['a:b'])
  })

  it('treats a key named with a trailing separator as a folder level', () => {
    // `a:` splits into ['a',''] — the empty leaf is a key inside folder `a`.
    const tree = buildRedisTree([key('a:')])
    expect(tree.folders.map(folder => folder.name)).toEqual(['a'])
    expect(tree.folders[0]!.keys.map(item => item.key)).toEqual(['a:'])
  })

  it('orders folders case-insensitively, keeping distinct names distinct', () => {
    // `A` and `a` are different folders in Redis; the sort only decides the
    // order, it must not merge them.
    const tree = buildRedisTree([key('b:1'), key('A:1'), key('a:1'), key('B:1')])
    const names = tree.folders.map(folder => folder.name)
    expect(names).toHaveLength(4)
    expect(names.map(name => name.toLowerCase())).toEqual(['a', 'a', 'b', 'b'])
  })

  it('reports the total and the truncation flag it was given', () => {
    const tree = buildRedisTree([key('x'), key('y')], true)
    expect(tree.total).toBe(2)
    expect(tree.truncated).toBe(true)
  })

  it('counts keys recursively, including nested folders', () => {
    const tree = buildRedisTree([key('a:b:c'), key('a:b:d'), key('a:x'), key('a:b')])
    // folder a: x, plus b's own key, plus b's two children = 4
    expect(countFolderKeys(tree.folders[0]!)).toBe(4)
  })
})

describe('escapeGlob', () => {
  it('escapes every Redis glob metacharacter', () => {
    expect(escapeGlob('a*b')).toBe('a\\*b')
    expect(escapeGlob('a?b')).toBe('a\\?b')
    expect(escapeGlob('a[b]')).toBe('a\\[b\\]')
    expect(escapeGlob('a\\b')).toBe('a\\\\b')
  })

  it('leaves ordinary characters alone', () => {
    expect(escapeGlob('orders:2024:')).toBe('orders:2024:')
  })

  it('builds a prefix pattern that cannot widen past the folder', () => {
    // Without escaping, `a*b:*` would also match `aXXb:...`, and the folder
    // delete would take those keys with it.
    expect(prefixPattern('a*b')).toBe('a\\*b:*')
    expect(prefixPattern('sessions')).toBe('sessions:*')
    expect(keyPattern('a*b')).toBe('a\\*b')
  })
})

describe('isUnderPrefix', () => {
  it('matches the folder key itself and its descendants only', () => {
    expect(isUnderPrefix('a:b', 'a:b')).toBe(true)
    expect(isUnderPrefix('a:b:c', 'a:b')).toBe(true)
    expect(isUnderPrefix('a:b:c:d', 'a:b')).toBe(true)
  })

  it('rejects a sibling that merely shares a prefix', () => {
    // `a:bc` must NOT be treated as inside `a:b` — this is exactly the bug a
    // naive startsWith(prefix) would introduce.
    expect(isUnderPrefix('a:bc', 'a:b')).toBe(false)
    expect(isUnderPrefix('x:a:b', 'a:b')).toBe(false)
  })
})

describe('filterTree', () => {
  it('keeps the folder path to a match instead of flattening the tree', () => {
    const tree = buildRedisTree([key('a:b:orders'), key('a:b:users'), key('c:d:orders')])
    const filtered = filterTree(tree, 'orders')

    expect(filtered.folders.map(folder => folder.name)).toEqual(['a', 'c'])
    const a = filtered.folders[0]!
    expect(a.folders.map(folder => folder.name)).toEqual(['b'])
    expect(a.folders[0]!.keys.map(item => item.key)).toEqual(['a:b:orders'])
  })

  it('returns the tree unchanged for an empty filter', () => {
    const tree = buildRedisTree([key('a:b')])
    expect(filterTree(tree, '')).toBe(tree)
  })

  it('drops folders with nothing left under them', () => {
    const tree = buildRedisTree([key('a:b:1'), key('c:d:2')])
    const filtered = filterTree(tree, 'd:2')
    expect(filtered.folders.map(folder => folder.name)).toEqual(['c'])
  })

  it('matches case-insensitively', () => {
    const tree = buildRedisTree([key('App:Sessions')])
    expect(filterTree(tree, 'app').folders).toHaveLength(1)
  })
})

describe('createPrefix and parseKeyNames', () => {
  it('prefixes the folder path with a separator at the root of a folder', () => {
    expect(createPrefix('a:b')).toBe('a:b:')
    expect(createPrefix(undefined)).toBe('')
    expect(createPrefix('')).toBe('')
  })

  it('splits one key per line and applies the prefix', () => {
    expect(parseKeyNames('x\ny\n', 'a:')).toEqual(['a:x', 'a:y'])
  })

  it('drops blank lines and trims surrounding whitespace', () => {
    expect(parseKeyNames('\n  x  \n\n\n y\n', '')).toEqual(['x', 'y'])
  })

  it('preserves spaces inside a name, which Redis allows', () => {
    expect(parseKeyNames('my key', '')).toEqual(['my key'])
  })

  it('yields nothing for an empty box', () => {
    expect(parseKeyNames('   \n \n', 'p:')).toEqual([])
  })
})

describe('parseElements', () => {
  it('takes the whole box as the value for a string, newlines included', () => {
    const parsed = parseElements('string', 'line1\nline2', 'k')
    expect(parsed).toEqual({ ok: true, content: { value: 'line1\nline2' } })
  })

  it('splits a list into elements in order', () => {
    const parsed = parseElements('list', 'a\nb\nc', 'k')
    expect(parsed).toEqual({ ok: true, content: { items: ['a', 'b', 'c'] } })
  })

  it('splits a hash on the first whitespace run', () => {
    const parsed = parseElements('hash', 'field  value with spaces', 'k')
    expect(parsed).toEqual({ ok: true, content: { fields: [{ field: 'field', value: 'value with spaces' }] } })
  })

  it('reads a zset as score-then-member, matching ZADD', () => {
    const parsed = parseElements('zset', '1.5 alice\n2 bob', 'k')
    expect(parsed).toEqual({
      ok: true,
      content: { members: [{ member: 'alice', score: '1.5' }, { member: 'bob', score: '2' }] },
    })
  })

  it('rejects a non-numeric zset score and names the line', () => {
    const parsed = parseElements('zset', 'abc alice', 'mykey')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/mykey/)
      expect(parsed.error).toMatch(/第 1 行/)
    }
  })

  it('rejects a hash line with no value', () => {
    const parsed = parseElements('hash', 'lonefield', 'k')
    expect(parsed.ok).toBe(false)
  })

  it('requires at least one element for a collection', () => {
    expect(parseElements('list', '', 'k').ok).toBe(false)
    expect(parseElements('set', '\n\n', 'k').ok).toBe(false)
    expect(parseElements('hash', '', 'k').ok).toBe(false)
    expect(parseElements('zset', '', 'k').ok).toBe(false)
  })

  it('allows an empty string value', () => {
    expect(parseElements('string', '', 'k')).toEqual({ ok: true, content: { value: '' } })
  })

  it('reports an unknown type rather than guessing', () => {
    expect(parseElements('stream', 'x', 'k').ok).toBe(false)
  })
})

describe('form copy helpers', () => {
  it('names the expected line shape per type', () => {
    expect(contentPlaceholder('hash')).toMatch(/字段/)
    expect(contentPlaceholder('zset')).toMatch(/分值/)
    expect(contentPlaceholder('string')).toMatch(/字符串/)
  })

  it('marks only the per-line types as line-based', () => {
    expect(usesElementLines('list')).toBe(true)
    expect(usesElementLines('hash')).toBe(true)
    expect(usesElementLines('string')).toBe(false)
  })
})
