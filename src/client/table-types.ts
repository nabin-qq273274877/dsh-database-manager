/**
 * The column types offered as a GROUPED list, shared by 新建表 and the 结构 tab's
 * column editor.
 *
 * Shared rather than duplicated because the two forms are meant to offer the same
 * choice: 结构 was asked to align with 新建表's type control, and a second copy of the
 * list would drift the first time one of them gained a type. The grouping is the point
 * — a flat list of thirty types is hard to scan and the choice is naturally two-step
 * ("a number, then which number").
 *
 * The values are what the engine receives; a type that needs a length is listed WITHOUT
 * one (`VARCHAR`, not `VARCHAR(255)`) because the length has its own field and a
 * pre-filled 255 looked like something the form had decided. The two SQLite entries
 * that spell their length into the name (`VARCHAR(255)`, `CHAR(1)`) are the exception:
 * SQLite has no separate length field, so writing it into the type is the normal form
 * there.
 */

import type { ColumnAttribute } from '../protocol.ts'

/** The grouped type list, per engine. */
export const TYPE_GROUPS: Record<string, Array<{ label: string; types: string[] }>> = {
  mysql: [
    { label: 'createTable.group.integer', types: ['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT'] },
    { label: 'createTable.group.float', types: ['FLOAT', 'DOUBLE', 'DECIMAL'] },
    { label: 'createTable.group.string', types: ['CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'ENUM', 'SET', 'JSON'] },
    { label: 'createTable.group.binary', types: ['BIT', 'BINARY', 'VARBINARY', 'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB'] },
    { label: 'createTable.group.temporal', types: ['DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR'] },
    { label: 'createTable.group.spatial', types: ['GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON', 'MULTIPOINT', 'MULTILINESTRING', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION'] },
  ],
  /*
   * SQLite has no type system — a type name is an affinity hint — so these are the
   * conventional names rather than an exhaustive set.
   */
  sqlite: [
    { label: 'createTable.group.integer', types: ['INTEGER', 'INT', 'TINYINT', 'SMALLINT', 'BIGINT'] },
    { label: 'createTable.group.float', types: ['REAL', 'DOUBLE', 'FLOAT', 'NUMERIC', 'DECIMAL'] },
    { label: 'createTable.group.string', types: ['TEXT', 'VARCHAR(255)', 'CHAR(1)', 'CLOB'] },
    { label: 'createTable.group.binary', types: ['BLOB'] },
    { label: 'createTable.group.temporal', types: ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME'] },
    { label: 'createTable.group.other', types: ['BOOLEAN'] },
  ],
}

/** The groups for one engine, falling back to MySQL's list. */
export function typeGroupsFor(kind: string): Array<{ label: string; types: string[] }> {
  return TYPE_GROUPS[kind] ?? TYPE_GROUPS.mysql!
}

/** Every type name one engine's list offers, in list order. */
export function offeredTypes(kind: string): string[] {
  return typeGroupsFor(kind).flatMap(group => group.types)
}

/**
 * Column attributes, as the attribute dropdown lists them.
 *
 * Shared with 新建表 for the same reason as the type list, and because the RULE that
 * decides which of them a type can carry (`attributeAllowed`) is already shared — a
 * second copy of the labels would be a second place to edit when one is added.
 */
export const ATTRIBUTE_ITEMS: Array<{ id: ColumnAttribute; label: string }> = [
  { id: 'unsigned', label: 'UNSIGNED' },
  { id: 'zerofill', label: 'ZEROFILL' },
  { id: 'binary', label: 'BINARY' },
  { id: 'onUpdateCurrentTimestamp', label: 'ON UPDATE CURRENT_TIMESTAMP' },
]

/** Every attribute, for the editor's list. Re-exported so callers need one import. */
export { COLUMN_ATTRIBUTES } from '../protocol.ts'

/**
 * The collations offered per engine, as a starting point.
 *
 * Shared with 新建表 for the same reason as the type list: the 结构 tab's column editor
 * was asked to offer the same controls, and a second copy would drift. These are only
 * the COMMON ones — the server's real list is far longer, which is why the field is a
 * dropdown of starting points rather than validation.
 */
const COLLATIONS: Record<string, string[]> = {
  mysql: [
    '', 'utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_0900_ai_ci', 'utf8mb4_bin',
    'utf8_general_ci', 'utf8_bin', 'latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin',
    'ascii_general_ci', 'binary',
  ],
  // SQLite's built-in collations. A different vocabulary from MySQL's on purpose: these
  // are the only ones it has without an application-registered collation.
  sqlite: ['', 'BINARY', 'NOCASE', 'RTRIM'],
}

/** The collations one engine offers, falling back to MySQL's list. */
export function collationsFor(kind: string): string[] {
  return COLLATIONS[kind] ?? COLLATIONS.mysql!
}

/** The storage engines MySQL supports here, with InnoDB first as the default. */
export const STORAGE_ENGINES = ['InnoDB', 'MyISAM', 'MEMORY', 'ARCHIVE', 'CSV', 'BLACKHOLE', 'MRG_MYISAM']
