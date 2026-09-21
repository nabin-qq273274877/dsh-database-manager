/**
 * The 结构 tab's column editor, part 2: what a chosen 索引 means when the column is
 * saved.
 *
 * The editor offers the same 索引 control 新建表 does, but the two forms differ in one
 * way that matters: a new table declares its indexes and keys TOGETHER with the
 * columns, in one statement, while an existing column's index is changed by separate
 * calls. So the choice has to be translated into a SEQUENCE of operations, and that
 * translation is where the mistakes live:
 *
 *   - A column that already IS the primary key, saving with 索引 = 主键, must do
 *     NOTHING. Emitting `setPrimaryKey([self])` would drop and re-add the key on a
 *     table that did not need touching — on SQLite that is a full table REBUILD, which
 *     on a large table is minutes of copying for a no-op.
 *   - Changing from 主键 to 唯一 must DROP the key and CREATE the index. Leaving the
 *     key in place produces a table with both, which is not what the dropdown says.
 *   - Changing from 唯一 to 普通 on the SAME index is not a drop-and-create: it can be
 *     one operation, but only when the name is known — otherwise the old index would
 *     be left behind under its old name alongside the new one.
 *   - Choosing 无 must remove what the column had, and 无 on a column that had nothing
 *     must do nothing.
 *
 * Deliberately free of React and i18n so every one of those branches is testable
 * without a browser. The operations are returned as data (not performed) so the
 * caller keeps control of error handling and reloading.
 */

import type { IndexInfo } from '../protocol.ts'

/** The index roles the editor offers. */
export type ColumnIndexChoice = '' | 'primary' | 'unique' | 'index'

/** One call the editor must make, in order. */
export type ColumnIndexOperation =
  | { op: 'setPrimaryKey'; columns: string[] }
  | { op: 'createIndex'; name: string; columns: string[]; unique: boolean }
  | { op: 'dropIndex'; name: string }

/**
 * What index state a column currently has, as the editor should show it.
 *
 * `primary` wins over everything: a primary-key column is also uniquely indexed, and
 * showing it as 唯一 would make saving it drop the key.
 */
export function indexChoiceOf(column: { name: string; key: string }, indexes: IndexInfo[]): ColumnIndexChoice {
  if (column.key === 'PRI') return 'primary'
  /*
   * A UNIQUE index covering exactly this column, and nothing else.
   *
   * The "exactly one column" test is load-bearing: a composite UNIQUE index that
   * HAPPENS to start with this column is not "this column is unique", and selecting
   * 唯一 from that dropdown would replace a two-column constraint with a one-column
   * one. `key === 'UNI'` alone is not enough either — MySQL reports `UNI` for the
   * FIRST column of a composite unique index.
   */
  const unique = indexes.find(index =>
    index.unique === true
    && index.primary !== true
    && index.columns.length === 1
    && index.columns[0] === column.name)
  if (unique !== undefined) return 'unique'
  const plain = indexes.find(index =>
    index.unique !== true
    && index.primary !== true
    && index.columns.length === 1
    && index.columns[0] === column.name)
  return plain === undefined ? '' : 'index'
}

/**
 * The index a column's choice is currently backed by, if any.
 *
 * Needed rather than re-derived at the call site because dropping requires the NAME,
 * and the name is the only handle a drop has.
 */
export function backingIndex(column: { name: string }, indexes: IndexInfo[]): IndexInfo | undefined {
  return indexes.find(index =>
    index.primary !== true
    && index.columns.length === 1
    && index.columns[0] === column.name)
}

/**
 * The operations that move a column's index from what it has to what was chosen.
 *
 * @param columnName - the column's CURRENT name (a rename is the caller's business; the
 *   index has to be built against the name the column will have, so the caller passes
 *   the new one).
 * @param from - the choice the editor opened with, i.e. `indexChoiceOf` on the column.
 * @param to - the choice the user left behind.
 * @param indexes - the table's indexes, so a drop can name what it drops.
 * @param indexName - the name typed into 索引名, for a new index. Empty means "generate
 *   one" (see {@link generatedIndexName}), because a `CREATE INDEX` with no name is not
 *   a statement either engine accepts.
 *
 * @returns the calls to make, in order. Empty when nothing needs to change.
 */
export function planIndexChange(options: {
  columnName: string
  from: ColumnIndexChoice
  to: ColumnIndexChoice
  indexes: IndexInfo[]
  indexName: string
}): ColumnIndexOperation[] {
  const { columnName, from, to, indexes, indexName } = options
  const name = indexName.trim()
  // Nothing chosen and nothing present: an ordinary column stays ordinary. This is the
  // common case and it has to cost no calls at all.
  if (from === to) return []

  const operations: ColumnIndexOperation[] = []

  /*
   * Remove what is there, unless the next state is the SAME non-primary index.
   *
   * A primary key is always removed first when it is not wanted, because MySQL refuses
   * a table with two keys and the `ADD` would otherwise fail after the column was
   * already modified. When the target is still an index of the same kind, the drop is
   * skipped so a rename of the column does not needlessly recreate it under the same
   * name — the index follows a rename on both engines.
   */
  if (from === 'primary' && to !== 'primary') {
    operations.push({ op: 'setPrimaryKey', columns: [] })
  } else if (from !== '' && from !== 'primary' && to !== from) {
    const backing = backingIndex({ name: columnName }, indexes)
    // A backing index the engine names `sqlite_autoindex_*` cannot be dropped on its
    // own: it exists because a table constraint asked for it. The drivers refuse it,
    // so it is left alone here and the caller reports the refusal rather than
    // emitting an operation that cannot succeed.
    if (backing !== undefined && !backing.name.startsWith('sqlite_autoindex_')) {
      operations.push({ op: 'dropIndex', name: backing.name })
    }
  }

  if (to === 'primary') operations.push({ op: 'setPrimaryKey', columns: [columnName] })
  else if (to === 'unique' || to === 'index') {
    const resolved = name === ''
      // Left to the driver's own default when the caller supplies nothing: a generated
      // name here would have to reproduce that rule, and two rules drift.
      ? generatedIndexName(columnName, to, indexes)
      : name
    operations.push({ op: 'createIndex', name: resolved, columns: [columnName], unique: to === 'unique' })
  }

  return operations
}

/**
 * A name for an index the form did not name.
 *
 * The shape is `uniq_<column>` / `ix_<column>`, with a numeric suffix when that is
 * taken. Index names are unique per table, so a collision has to be resolved BEFORE the
 * statement rather than reported by the engine: the user did not ask for a name at all,
 * so "that name is taken" would be a question they cannot answer.
 */
export function generatedIndexName(column: string, kind: ColumnIndexChoice, indexes: IndexInfo[]): string {
  const base = `${kind === 'unique' ? 'uniq' : 'ix'}_${column.replace(/[^A-Za-z0-9_]/g, '_')}`
  const taken = new Set(indexes.map(index => index.name))
  if (!taken.has(base)) return base
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}_${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}_${Date.now()}`
}

/**
 * Whether a kind of index can be created from this tab at all, and why not.
 *
 * FULLTEXT and SPATIAL are refused on both engines, for different reasons: MySQL
 * supports them but the index route this tab calls takes no kind, and SQLite implements
 * both as separate VIRTUAL-TABLE mechanisms (FTS5, R*Tree) rather than as indexes on an
 * ordinary table. Offering them in the dropdown would promise a statement neither path
 * can run, so they are not offered.
 */
export function indexChoiceBlocked(kind: string, engine: string): boolean {
  if (kind === 'fulltext' || kind === 'spatial') return true
  return false
}
