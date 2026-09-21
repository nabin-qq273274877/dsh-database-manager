/**
 * Unit tests for the 结构 tab's column-editor rules.
 *
 * Two modules are covered, and both exist because the 结构 tab's editor was aligned
 * with 新建表's — which is what makes the pieces non-obvious:
 *
 *  - `column-spec-form.ts` SPLITS the one type string the engine reports into the base
 *    type, the length and the attribute list, because the aligned form edits those as
 *    three controls. Getting the split wrong emits `INT UNSIGNED UNSIGNED`, which MySQL
 *    ACCEPTS and normalises — so the mistake is invisible in the column and only shows
 *    up in the statement.
 *  - `column-index-plan.ts` turns the 索引 dropdown into the sequence of calls that
 *    changes an existing column's index. Every branch there is a real DDL mistake: a
 *    no-op that rebuilds a table, a key left behind beside its replacement, or a
 *    composite constraint silently narrowed to one column.
 *
 * No browser and no server: the rules are pure, so they are tested directly.
 */

import { describe, expect, it } from 'vitest'

import type { IndexInfo } from '../src/protocol.ts'
import { attributesFromColumn, joinTypeParts, splitTypeParts } from '../src/client/column-spec-form.ts'
import { backingIndex, generatedIndexName, indexChoiceOf, planIndexChange } from '../src/client/column-index-plan.ts'
import { typeGroupsFor } from '../src/client/table-types.ts'

/** An index, with just enough set for these rules. */
function index(name: string, columns: string[], options: { unique?: boolean; primary?: boolean } = {}): IndexInfo {
  return {
    name,
    unique: options.unique === true,
    columns,
    ...(options.primary === true ? { primary: true } : {}),
  }
}

describe('splitTypeParts: the one reported type becomes the form\'s three controls', () => {
  it('splits a plain type with no brackets or modifiers', () => {
    expect(splitTypeParts('int')).toEqual({ base: 'int', length: '', attributes: [] })
  })

  it('splits a length out of the brackets', () => {
    expect(splitTypeParts('varchar(191)')).toEqual({ base: 'varchar', length: '191', attributes: [] })
  })

  it('splits a two-part numeric size', () => {
    expect(splitTypeParts('decimal(10,2)')).toEqual({ base: 'decimal', length: '10,2', attributes: [] })
  })

  it('pulls UNSIGNED out, because the engine folds it into the type text', () => {
    // Measured on MySQL 8.0: information_schema reports `int unsigned` for
    // `a INT UNSIGNED`. Leaving it in the base AND listing it as an attribute would emit
    // the modifier twice.
    expect(splitTypeParts('int unsigned')).toEqual({ base: 'int', length: '', attributes: ['unsigned'] })
  })

  it('pulls both modifiers out, in MySQL\'s own order', () => {
    // Measured shape for `INT(10) UNSIGNED ZEROFILL`.
    expect(splitTypeParts('int(10) unsigned zerofill')).toEqual({
      base: 'int',
      length: '10',
      attributes: ['unsigned', 'zerofill'],
    })
  })

  it('keeps a type with no length but a modifier intact apart from the modifier', () => {
    expect(splitTypeParts('bigint unsigned')).toEqual({ base: 'bigint', length: '', attributes: ['unsigned'] })
  })

  it('keeps an enum\'s members inside the length slot', () => {
    // The members live in the same parentheses slot the create form puts a length in,
    // so they are not flattened into the base.
    expect(splitTypeParts("enum('a','b')")).toEqual({ base: 'enum', length: "'a','b'", attributes: [] })
  })

  it('handles a member that itself contains a bracket or the word unsigned', () => {
    // The bracket matcher must skip over quoted members, or `enum('x)y')` would split in
    // the wrong place; and a member named `unsigned` must not be mistaken for a modifier.
    expect(splitTypeParts("enum('x)y','unsigned')")).toEqual({ base: 'enum', length: "'x)y','unsigned'", attributes: [] })
  })

  it('handles a doubled quote inside a member, which is how one is escaped', () => {
    expect(splitTypeParts("enum('it''s')")).toEqual({ base: 'enum', length: "'it''s'", attributes: [] })
  })

  it('keeps a lone word whole when there is nothing to split off', () => {
    // `unsigned` alone must not be consumed as a modifier: that would leave an empty base.
    expect(splitTypeParts('unsigned')).toEqual({ base: 'unsigned', length: '', attributes: [] })
  })

  it('passes an unbalanced type through as a base rather than dropping it', () => {
    // A malformed value must not make the form lose the column's real type.
    expect(splitTypeParts('varchar(191')).toEqual({ base: 'varchar(191', length: '', attributes: [] })
  })

  it('treats an empty type as nothing at all', () => {
    expect(splitTypeParts('')).toEqual({ base: '', length: '', attributes: [] })
  })

  it('keeps the caller\'s own casing, so an untouched column is not rewritten', () => {
    // Re-emitting `VARCHAR` as `varchar` would show up in a schema diff as a change
    // nobody made.
    expect(splitTypeParts('VARCHAR(20)').base).toBe('VARCHAR')
  })
})

describe('joinTypeParts: the three controls go back as one type expression', () => {
  it('joins a base and a length', () => {
    expect(joinTypeParts({ base: 'varchar', length: '191', attributes: [] })).toBe('varchar(191)')
  })

  it('joins the modifiers in MySQL\'s order', () => {
    expect(joinTypeParts({ base: 'int', length: '10', attributes: ['unsigned', 'zerofill'] }))
      .toBe('int(10) unsigned zerofill')
  })

  it('adds no brackets when the length is empty', () => {
    expect(joinTypeParts({ base: 'int', length: '', attributes: [] })).toBe('int')
  })

  it('does not double the brackets of a type that already carries them', () => {
    // A custom type typed whole (`enum('a','b')`) must not become `enum('a','b')(255)`.
    expect(joinTypeParts({ base: "enum('a','b')", length: '255', attributes: [] })).toBe("enum('a','b')")
  })

  it('round-trips what the engine reported, with the modifier emitted once', () => {
    // The property the whole split exists for. Both of these are strings MySQL really
    // reports, and neither may come back with a doubled modifier.
    for (const reported of ['int unsigned', 'int(10) unsigned zerofill', 'varchar(191)', "enum('a','b')"]) {
      const parts = splitTypeParts(reported)
      expect(joinTypeParts(parts), reported).toBe(reported)
    }
  })

  it('is empty for an empty base, so a missing type is caught rather than emitted', () => {
    expect(joinTypeParts({ base: '', length: '10', attributes: [] })).toBe('')
  })
})

describe('attributesFromColumn: what an existing column\'s attribute list starts as', () => {
  it('reads UNSIGNED and ZEROFILL out of the reported type', () => {
    expect(attributesFromColumn({ type: 'int(10) unsigned zerofill' })).toEqual(['unsigned', 'zerofill'])
  })

  it('reads ON UPDATE CURRENT_TIMESTAMP out of EXTRA, where it actually lives', () => {
    // Measured: `EXTRA` is `DEFAULT_GENERATED on update CURRENT_TIMESTAMP` for such a
    // column, and the type text says nothing about it.
    expect(attributesFromColumn({ type: 'timestamp', extra: 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP' }))
      .toEqual(['onUpdateCurrentTimestamp'])
  })

  it('does not claim BINARY, which MySQL reports as a collation instead', () => {
    // Measured: `CHAR(4) BINARY` reads back as type `char(4)` with COLLATION_NAME
    // `utf8mb4_bin`, which is indistinguishable from a column explicitly declared with
    // that collation. Guessing would put BINARY on columns that never had it.
    expect(attributesFromColumn({ type: 'char(4)' })).toEqual([])
  })

  it('is empty for an ordinary column', () => {
    expect(attributesFromColumn({ type: 'int' })).toEqual([])
  })

  it('does not fold DEFAULT_GENERATED alone into ON UPDATE', () => {
    // The substring trap the column reader already documents: `EXTRA` carries
    // `DEFAULT_GENERATED` for a plain `DEFAULT CURRENT_TIMESTAMP`, which is not an
    // ON UPDATE clause.
    expect(attributesFromColumn({ type: 'timestamp', extra: 'DEFAULT_GENERATED' })).toEqual([])
  })
})

describe('indexChoiceOf: what the 索引 dropdown opens on', () => {
  it('shows 主键 for a key column, ahead of any unique index', () => {
    // A primary-key column IS uniquely indexed, so testing unique first would show 唯一
    // and a save would then DROP the key.
    const indexes = [index('PRIMARY', ['id'], { unique: true, primary: true })]
    expect(indexChoiceOf({ name: 'id', key: 'PRI' }, indexes)).toBe('primary')
  })

  it('shows 唯一 for a UNIQUE index covering exactly this column', () => {
    expect(indexChoiceOf({ name: 'email', key: 'UNI' }, [index('email', ['email'], { unique: true })])).toBe('unique')
  })

  it('shows 普通 for a plain index covering exactly this column', () => {
    expect(indexChoiceOf({ name: 'a', key: 'MUL' }, [index('ix_a', ['a'])])).toBe('index')
  })

  it('shows nothing for a column with no index of its own', () => {
    expect(indexChoiceOf({ name: 'a', key: '' }, [index('ix_ab', ['a', 'b'])])).toBe('')
  })

  it('does not call a composite unique index "this column is unique"', () => {
    // Measured: MySQL reports `key = 'UNI'` for the FIRST column of a composite unique
    // index. Selecting 唯一 from that state must not replace a two-column constraint.
    const indexes = [index('uniq_ab', ['a', 'b'], { unique: true })]
    expect(indexChoiceOf({ name: 'a', key: 'UNI' }, indexes)).toBe('')
  })

  it('does not call a composite plain index an index of this column either', () => {
    expect(indexChoiceOf({ name: 'a', key: 'MUL' }, [index('ix_ab', ['a', 'b'])])).toBe('')
  })
})

describe('backingIndex: the index a drop would have to name', () => {
  it('finds the single-column index on the column', () => {
    expect(backingIndex({ name: 'a' }, [index('ix_a', ['a'])])?.name).toBe('ix_a')
  })

  it('ignores the primary key, which is changed through the key editor', () => {
    expect(backingIndex({ name: 'a' }, [index('PRIMARY', ['a'], { primary: true })])).toBeUndefined()
  })

  it('ignores a composite index, which is not this column\'s to drop', () => {
    expect(backingIndex({ name: 'a' }, [index('ix_ab', ['a', 'b'])])).toBeUndefined()
  })
})

describe('planIndexChange: the 索引 dropdown becomes a sequence of calls', () => {
  const base = { columnName: 'a', indexes: [] as IndexInfo[], indexName: '' }

  it('does nothing when the choice is unchanged', () => {
    // The common case, and the one that must be FREE: on SQLite a primary-key change is
    // a full table rebuild, so a no-op that emitted setPrimaryKey would copy the whole
    // table for nothing.
    expect(planIndexChange({ ...base, from: '', to: '' })).toEqual([])
    expect(planIndexChange({ ...base, from: 'index', to: 'index' })).toEqual([])
    expect(planIndexChange({ ...base, from: 'primary', to: 'primary' })).toEqual([])
    expect(planIndexChange({ ...base, from: 'unique', to: 'unique' })).toEqual([])
  })

  it('makes a column the primary key', () => {
    expect(planIndexChange({ ...base, from: '', to: 'primary' }))
      .toEqual([{ op: 'setPrimaryKey', columns: ['a'] }])
  })

  it('drops the key when the choice moves away from 主键', () => {
    // The drop comes FIRST: MySQL refuses a table with two keys, so an ADD before the
    // DROP would fail after the column had already been modified.
    expect(planIndexChange({ ...base, from: 'primary', to: '' }))
      .toEqual([{ op: 'setPrimaryKey', columns: [] }])
  })

  it('drops the key and creates the unique index when moving 主键 → 唯一', () => {
    const plan = planIndexChange({ ...base, from: 'primary', to: 'unique', indexName: 'uq_a' })
    expect(plan).toEqual([
      { op: 'setPrimaryKey', columns: [] },
      { op: 'createIndex', name: 'uq_a', columns: ['a'], unique: true },
    ])
  })

  it('drops the old index before creating the new one when the kind changes', () => {
    const plan = planIndexChange({
      ...base,
      from: 'unique',
      to: 'index',
      indexName: 'ix_a',
      indexes: [index('uniq_a', ['a'], { unique: true })],
    })
    expect(plan).toEqual([
      { op: 'dropIndex', name: 'uniq_a' },
      { op: 'createIndex', name: 'ix_a', columns: ['a'], unique: false },
    ])
  })

  it('creates an index from nothing', () => {
    expect(planIndexChange({ ...base, from: '', to: 'index', indexName: 'ix_a' }))
      .toEqual([{ op: 'createIndex', name: 'ix_a', columns: ['a'], unique: false }])
  })

  it('generates a name when the form did not supply one', () => {
    // A `CREATE INDEX` with no name is not a statement either engine accepts.
    const plan = planIndexChange({ ...base, from: '', to: 'unique' })
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ op: 'createIndex', unique: true })
    expect((plan[0] as { name: string }).name).toMatch(/^uniq_a/)
  })

  it('refuses to emit a drop for SQLite\'s implicit constraint index', () => {
    // `sqlite_autoindex_*` exists because a table constraint asked for it; DROP INDEX on
    // it either fails or silently leaves the constraint without its index. The plan
    // leaves it alone so the caller reports the refusal rather than attempting it.
    const plan = planIndexChange({
      ...base,
      from: 'unique',
      to: 'index',
      indexName: 'ix_a',
      indexes: [index('sqlite_autoindex_a_1', ['a'], { unique: true })],
    })
    expect(plan).toEqual([{ op: 'createIndex', name: 'ix_a', columns: ['a'], unique: false }])
  })

  it('uses the NEW column name, so a rename keeps the index attached', () => {
    // The index has to be created against the name the column will have.
    expect(planIndexChange({ ...base, columnName: 'renamed', from: '', to: 'index', indexName: 'ix_r' }))
      .toEqual([{ op: 'createIndex', name: 'ix_r', columns: ['renamed'], unique: false }])
  })
})

describe('generatedIndexName: a name for an index the form did not name', () => {
  it('uses uniq_ for unique and ix_ otherwise', () => {
    expect(generatedIndexName('a', 'unique', [])).toBe('uniq_a')
    expect(generatedIndexName('a', 'index', [])).toBe('ix_a')
  })

  it('avoids a name that is taken, rather than letting the engine refuse it', () => {
    // The user did not ask for a name at all, so "that name is taken" would be a
    // question they cannot answer.
    expect(generatedIndexName('a', 'index', [index('ix_a', ['b'])])).toBe('ix_a_2')
    expect(generatedIndexName('a', 'index', [index('ix_a', ['b']), index('ix_a_2', ['c'])])).toBe('ix_a_3')
  })

  it('strips characters an identifier cannot hold', () => {
    expect(generatedIndexName('a b-c', 'index', [])).toBe('ix_a_b_c')
  })
})

describe('the shared type list', () => {
  it('groups the types rather than listing them flat, which is what was asked for', () => {
    for (const kind of ['mysql', 'sqlite']) {
      const groups = typeGroupsFor(kind)
      expect(groups.length, kind).toBeGreaterThan(1)
      for (const group of groups) expect(group.types.length, group.label).toBeGreaterThan(0)
    }
  })

  it('offers no type with a pre-filled length, except where SQLite spells it into the name', () => {
    // A pre-filled 255 in the create form looked like a value the form had decided, and
    // the length has its own field — so MySQL's list must not carry one.
    for (const type of typeGroupsFor('mysql').flatMap(group => group.types)) {
      expect(type, type).not.toMatch(/\(\d/)
    }
  })
})
