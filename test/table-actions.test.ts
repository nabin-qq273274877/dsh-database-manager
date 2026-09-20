/**
 * 操作 tab 的引擎侧测试：移动表、复制表、表选项。
 *
 * 这些行为只能对着真服务器验证——「MySQL 到底接受哪种 ALTER 写法」、「AUTO_INCREMENT
 * 的实时值该从哪读」这类问题的答案就在服务端。每条断言都来自一个先跑通的探测脚本，
 * 注释里写清是哪一个，以及不这么写会错在哪里。
 *
 * 只在能连到 MySQL 时运行；用 DBM_TEST_MYSQL=host:port:user:password 配置，
 * 默认是本地 Docker 容器（127.0.0.1:3306 root/root）。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MysqlDriver, mysqlAvailable } from '../src/drivers/mysql.ts'
import { SqliteDriver, sqliteAvailable } from '../src/drivers/sqlite.ts'
import type { DataSourceEntry } from '../src/protocol.ts'

function target(): { host: string; port: number; user: string; password: string } {
  const raw = process.env['DBM_TEST_MYSQL'] ?? '127.0.0.1:3306:root:root'
  const [host, port, user, password] = raw.split(':')
  return { host: host ?? '127.0.0.1', port: Number(port ?? 3306), user: user ?? 'root', password: password ?? '' }
}

const available = await mysqlAvailable()
const { host, port, user, password } = target()

async function serverReachable(): Promise<boolean> {
  if (!available) return false
  const net = await import('node:net')
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (ok: boolean): void => { socket.destroy(); resolve(ok) }
    socket.setTimeout(3000, () => done(false))
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
  })
}

const reachable = await serverReachable()

/** The two databases this suite owns and drops afterwards. */
const DB_A = 'dbm_tableop_a'
const DB_B = 'dbm_tableop_b'

const entry: DataSourceEntry = {
  id: 'mysql-tableop-test',
  kind: 'mysql',
  name: 'mysql-tableop-test',
  group: '',
  tags: [],
  description: '',
  host,
  port,
  user,
  password,
  readonly: false,
  createdAt: 0,
  updatedAt: 0,
}

const driver = reachable ? new MysqlDriver(entry) : undefined

beforeAll(async () => {
  if (driver === undefined) return
  for (const db of [DB_A, DB_B]) {
    await driver.exec(`DROP DATABASE IF EXISTS \`${db}\``, [])
    await driver.exec(`CREATE DATABASE \`${db}\` DEFAULT CHARACTER SET utf8mb4`, [])
  }
})

afterAll(async () => {
  if (driver === undefined) return
  for (const db of [DB_A, DB_B]) await driver.exec(`DROP DATABASE IF EXISTS \`${db}\``, []).catch(() => undefined)
  await driver.close()
})

/** Whether a table exists in a database, read from the server rather than inferred. */
async function tableExists(db: string, table: string): Promise<boolean> {
  const result = await driver!.exec(
    'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [db, table],
  )
  return Number(result.rows[0]?.[0] ?? 0) > 0
}

/** An empty table with an auto-increment key, a unique column and an index. */
async function seedTable(db: string, table: string, rows: number): Promise<void> {
  await driver!.exec(`DROP TABLE IF EXISTS \`${db}\`.\`${table}\``, [])
  await driver!.exec(
    `CREATE TABLE \`${db}\`.\`${table}\` (id INT PRIMARY KEY AUTO_INCREMENT, v VARCHAR(20) UNIQUE, KEY ix_${table}_v (v)) ENGINE=InnoDB`,
    [],
  )
  for (let n = 0; n < rows; n++) await driver!.insertRow(db, table, [{ column: 'v', value: `row${n}` }])
}

describe.skipIf(!reachable)('MySQL table actions: support', () => {
  it('reports all three blocks, because MySQL can do all three', () => {
    expect(driver!.tableActionSupport().sort()).toEqual(['copy', 'move', 'options'])
  })
})

describe.skipIf(!reachable)('MySQL table actions: move', () => {
  it('moves a table and its rows into another database, leaving nothing behind', async () => {
    await seedTable(DB_A, 'moved', 3)
    await driver!.moveTable(DB_A, 'moved', { schema: DB_B, table: 'moved' })

    // Both halves are asserted: the table is GONE from the source and PRESENT in the
    // target. A statement that copied instead of moving would pass a target-only check
    // while leaving two tables behind, which is not what 移动 means.
    expect(await tableExists(DB_A, 'moved')).toBe(false)
    expect(await tableExists(DB_B, 'moved')).toBe(true)

    // The DATA came with it: RENAME TABLE relocates the table's files, it does not
    // rebuild them, so every row must still be there.
    const page = await driver!.rows({ schema: DB_B, table: 'moved', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.total).toBe(3)

    // And so did the indexes and the AUTO_INCREMENT attribute, which is the difference
    // between a move and a structure-only copy. Three indexes, not two: the `UNIQUE`
    // on `v` gets one named after the column, alongside the named `ix_moved_v` and the
    // primary key — a list that also proves the constraints came along.
    const indexes = await driver!.indexes(DB_B, 'moved')
    expect(indexes.map(index => index.name).sort()).toEqual(['PRIMARY', 'ix_moved_v', 'v'])
    const columns = await driver!.columns(DB_B, 'moved')
    expect(columns.find(column => column.name === 'id')?.extra).toContain('auto_increment')
  })

  it('renames inside one database through the same call', async () => {
    await seedTable(DB_A, 'renamed', 2)
    await driver!.moveTable(DB_A, 'renamed', { schema: DB_A, table: 'renamed_new' })
    expect(await tableExists(DB_A, 'renamed')).toBe(false)
    expect(await tableExists(DB_A, 'renamed_new')).toBe(true)
  })

  it('refuses a view, a target that exists, and a move onto itself', async () => {
    await seedTable(DB_A, 'with_view', 1)
    await driver!.exec(`DROP VIEW IF EXISTS \`${DB_A}\`.\`a_view\``, [])
    await driver!.exec(`CREATE VIEW \`${DB_A}\`.\`a_view\` AS SELECT * FROM \`${DB_A}\`.\`with_view\``, [])

    /*
     * A view cannot change schema — MySQL answers "Changing schema from 'a' to 'b' is
     * not allowed" — so it is refused with that reason rather than passed through. The
     * check matters because the naive implementation would emit the statement and hand
     * the user a message about schemas they never mentioned.
     */
    await expect(driver!.moveTable(DB_A, 'a_view', { schema: DB_B, table: 'a_view' }))
      .rejects.toThrow(/视图/)

    await seedTable(DB_B, 'occupied', 1)
    await expect(driver!.moveTable(DB_A, 'with_view', { schema: DB_B, table: 'occupied' }))
      .rejects.toThrow(/已存在/)

    await expect(driver!.moveTable(DB_A, 'with_view', { schema: DB_A, table: 'with_view' }))
      .rejects.toThrow(/same table/)

    await expect(driver!.moveTable(DB_A, 'no_such_table_here', { schema: DB_B, table: 'x' }))
      .rejects.toThrow(/no such table/)
  })
})

describe.skipIf(!reachable)('MySQL table actions: copy', () => {
  it('copies the structure and the data, leaving the original alone', async () => {
    await seedTable(DB_A, 'copied', 4)
    await driver!.copyTable(DB_A, 'copied', { schema: DB_B, table: 'copied' }, { includeData: true })

    // The original is still there — that is what distinguishes a copy from a move,
    // and a test asserting only the target would not catch a `RENAME`.
    expect(await tableExists(DB_A, 'copied')).toBe(true)
    expect(await tableExists(DB_B, 'copied')).toBe(true)

    const page = await driver!.rows({ schema: DB_B, table: 'copied', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.total).toBe(4)
    // CREATE TABLE … LIKE copies the indexes and the key — including the implicit index
    // that the column's own UNIQUE becomes — and the rows came from the explicit INSERT.
    const indexes = await driver!.indexes(DB_B, 'copied')
    expect(indexes.map(index => index.name).sort()).toEqual(['PRIMARY', 'ix_copied_v', 'v'])
  })

  it('copies the structure only when the data is not asked for', async () => {
    await seedTable(DB_A, 'structure_only', 5)
    await driver!.copyTable(DB_A, 'structure_only', { schema: DB_B, table: 'structure_only' }, { includeData: false })
    const page = await driver!.rows({ schema: DB_B, table: 'structure_only', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.total).toBe(0)
    expect(page.columns.length).toBeGreaterThan(1)
  })

  it('copies a table with a generated column', async () => {
    /*
     * `INSERT INTO new SELECT * FROM old` FAILS on a stored generated column —
     * measured: "The value specified for generated column 'b' in table 'gen2' is not
     * allowed" — because `*` includes a column that cannot be inserted into. The
     * implementation names the writable columns instead, and this is the case that
     * proves it: a test on a table without one would pass either way.
     */
    await driver!.exec(`DROP TABLE IF EXISTS \`${DB_A}\`.\`gen\``, [])
    await driver!.exec(
      `CREATE TABLE \`${DB_A}\`.\`gen\` (a INT, b INT GENERATED ALWAYS AS (a * 2) STORED, c INT)`,
      [],
    )
    await driver!.insertRow(DB_A, 'gen', [{ column: 'a', value: 3 }, { column: 'c', value: 7 }])
    await driver!.copyTable(DB_A, 'gen', { schema: DB_B, table: 'gen' }, { includeData: true })
    const page = await driver!.rows({ schema: DB_B, table: 'gen', page: 1, pageSize: 10, mode: 'browse' })
    expect(page.total).toBe(1)
    // The generated value is recomputed by the server, so it must match the source.
    expect(page.rows[0]?.['b']).toBe(6)
  })

  it('refuses a view and a target that already exists', async () => {
    // `CREATE TABLE … LIKE a_view` is refused by MySQL ("is not BASE TABLE"), so the
    // refusal is made here with the reason instead of being passed through as a
    // syntax-looking failure.
    await expect(driver!.copyTable(DB_A, 'a_view', { schema: DB_B, table: 'a_view_copy' }, {}))
      .rejects.toThrow(/视图/)
    await seedTable(DB_B, 'taken_by_copy', 1)
    await expect(driver!.copyTable(DB_A, 'copied', { schema: DB_B, table: 'taken_by_copy' }, {}))
      .rejects.toThrow(/已存在/)
    await expect(driver!.copyTable(DB_A, 'copied', { schema: DB_A, table: 'copied' }, {}))
      .rejects.toThrow(/same table/)
  })
})

describe.skipIf(!reachable)('MySQL table actions: options', () => {
  it('reads engine, collation, charset, comment, row format and the auto-increment value', async () => {
    await driver!.exec(`DROP TABLE IF EXISTS \`${DB_A}\`.\`opts\``, [])
    await driver!.exec(
      `CREATE TABLE \`${DB_A}\`.\`opts\` (id INT PRIMARY KEY AUTO_INCREMENT, v VARCHAR(20)) ENGINE=InnoDB COMMENT='hello' ROW_FORMAT=DYNAMIC`,
      [],
    )
    await driver!.insertRow(DB_A, 'opts', [{ column: 'v', value: 'a' }])

    const info = await driver!.tableOptionInfo(DB_A, 'opts')
    expect(info.isView).toBeUndefined()
    expect(info.engine).toBe('InnoDB')
    expect(info.collation).toBe('utf8mb4_0900_ai_ci')
    // The character set is RESOLVED through the server's collation list, not split off
    // the collation's name: a name does not reliably start with its charset
    // (`utf8mb3_general_ci` belongs to `utf8mb3`), and a wrong pair is a statement the
    // server rejects.
    expect(info.charset).toBe('utf8mb4')
    expect(info.comment).toBe('hello')
    expect(info.rowFormat).toBe('Dynamic')
    expect(info.autoIncrement).toBe(2)
  })

  it('omits the auto-increment value for a table that has no auto-increment column', async () => {
    // ABSENT, not 0 and not 1: the page hides the field on this, so a wrong default
    // would offer a box whose value is not a thing.
    await driver!.exec(`DROP TABLE IF EXISTS \`${DB_A}\`.\`no_ai\``, [])
    await driver!.exec(`CREATE TABLE \`${DB_A}\`.\`no_ai\` (a INT, b INT)`, [])
    const info = await driver!.tableOptionInfo(DB_A, 'no_ai')
    expect(info.autoIncrement).toBeUndefined()
  })

  it('reports a view as a view, and not as a table with empty options', async () => {
    /*
     * Measured: MySQL reports NULL for a view's engine, collation and row format, and
     * the literal "VIEW" as its comment. Passing those through would describe a view as
     * a table whose engine is missing and whose comment is "VIEW" — a placeholder nobody
     * typed, which the 表选项 form would then offer to edit.
     */
    await driver!.exec(`DROP VIEW IF EXISTS \`${DB_A}\`.\`opts_view\``, [])
    await driver!.exec(`CREATE VIEW \`${DB_A}\`.\`opts_view\` AS SELECT * FROM \`${DB_A}\`.\`opts\``, [])
    const info = await driver!.tableOptionInfo(DB_A, 'opts_view')
    expect(info.isView).toBe(true)
    expect(info.engine).toBeUndefined()
    expect(info.collation).toBeUndefined()
    expect(info.rowFormat).toBeUndefined()
    expect(info.autoIncrement).toBeUndefined()
    // The engine's placeholder is NOT passed off as a comment the user set.
    expect(info.comment).toBeUndefined()
  })

  it('changes every option in one statement', async () => {
    await driver!.exec(`DROP TABLE IF EXISTS \`${DB_A}\`.\`multi\``, [])
    await driver!.exec(`CREATE TABLE \`${DB_A}\`.\`multi\` (id INT PRIMARY KEY AUTO_INCREMENT, v VARCHAR(20)) ENGINE=InnoDB`, [])
    await driver!.insertRow(DB_A, 'multi', [{ column: 'v', value: 'a' }])

    await driver!.alterTableOptions(DB_A, 'multi', {
      engine: 'InnoDB',
      collation: 'utf8mb4_general_ci',
      comment: 'changed',
      autoIncrement: 500,
      rowFormat: 'COMPRESSED',
    })

    const info = await driver!.tableOptionInfo(DB_A, 'multi')
    expect(info.collation).toBe('utf8mb4_general_ci')
    expect(info.comment).toBe('changed')
    expect(info.rowFormat).toBe('Compressed')
    /*
     * Read back through `SHOW CREATE TABLE`, which is the only source that agrees with
     * the id the server actually issues. Measured: `information_schema.TABLES` and
     * `SHOW TABLE STATUS` both kept reporting 4 on a fresh connection after
     * `ALTER TABLE … AUTO_INCREMENT=500`, while the next insert really did get 500.
     */
    expect(info.autoIncrement).toBe(500)
  })

  it('leaves an untouched field as the server has it', async () => {
    /*
     * The whole reason the patch is a patch: a form that submitted every field would
     * revert a change made elsewhere between opening the page and pressing save. Emitting
     * only `comment` must therefore not touch the engine, collation or row format.
     */
    await driver!.exec(`DROP TABLE IF EXISTS \`${DB_A}\`.\`partial\``, [])
    await driver!.exec(
      `CREATE TABLE \`${DB_A}\`.\`partial\` (id INT PRIMARY KEY, v VARCHAR(20)) ENGINE=InnoDB COMMENT='before' ROW_FORMAT=COMPRESSED`,
      [],
    )
    await driver!.alterTableOptions(DB_A, 'partial', { comment: 'after' })
    const info = await driver!.tableOptionInfo(DB_A, 'partial')
    expect(info.comment).toBe('after')
    expect(info.engine).toBe('InnoDB')
    expect(info.rowFormat).toBe('Compressed')
  })

  it('removes a comment with an empty string', async () => {
    // An empty string is a VALUE for the comment, not "leave it alone" — which is why
    // the patch distinguishes the two rather than treating falsy as absent.
    await driver!.alterTableOptions(DB_A, 'partial', { comment: '' })
    expect((await driver!.tableOptionInfo(DB_A, 'partial')).comment).toBe('')
  })

  it('escapes a quote in a comment and refuses a backslash', async () => {
    // The escaping doubles the quote, which round-trips: `it''s` is stored as `it's`.
    await driver!.alterTableOptions(DB_A, 'partial', { comment: "it's ok" })
    expect((await driver!.tableOptionInfo(DB_A, 'partial')).comment).toBe("it's ok")
    // A backslash cannot be written the same way round (MySQL reads it as an escape),
    // so it is refused rather than silently stored differently from what was typed.
    await expect(driver!.alterTableOptions(DB_A, 'partial', { comment: 'a\\b' })).rejects.toThrow(/反斜杠/)
  })

  it('converts the existing columns only when asked to', async () => {
    /*
     * `DEFAULT CHARACTER SET … COLLATE …` changes what a NEW column will be declared
     * as; `CONVERT TO …` re-encodes the columns that exist. Measured on one table: the
     * DEFAULT form left the column's own collation alone, the CONVERT form changed it.
     * The difference matters because CONVERT rewrites every row.
     */
    await driver!.exec(`DROP TABLE IF EXISTS \`${DB_A}\`.\`convert\``, [])
    await driver!.exec(`CREATE TABLE \`${DB_A}\`.\`convert\` (id INT PRIMARY KEY, v VARCHAR(20)) ENGINE=InnoDB`, [])

    await driver!.alterTableOptions(DB_A, 'convert', { collation: 'utf8mb4_bin', convertColumns: false })
    const afterDefault = await driver!.columns(DB_A, 'convert')
    expect(afterDefault.find(column => column.name === 'v')?.collation).not.toBe('utf8mb4_bin')
    expect((await driver!.tableOptionInfo(DB_A, 'convert')).collation).toBe('utf8mb4_bin')

    await driver!.alterTableOptions(DB_A, 'convert', { collation: 'utf8mb4_general_ci', convertColumns: true })
    const afterConvert = await driver!.columns(DB_A, 'convert')
    expect(afterConvert.find(column => column.name === 'v')?.collation).toBe('utf8mb4_general_ci')
  })

  it('refuses an impossible value with a message naming what to fix', async () => {
    await expect(driver!.alterTableOptions(DB_A, 'partial', { engine: 'NoSuchEngine' })).rejects.toThrow(/存储引擎/)
    await expect(driver!.alterTableOptions(DB_A, 'partial', { rowFormat: 'BOGUS' })).rejects.toThrow(/行格式/)
    await expect(driver!.alterTableOptions(DB_A, 'partial', { autoIncrement: 0 })).rejects.toThrow(/正整数/)
    await expect(driver!.alterTableOptions(DB_A, 'partial', {})).rejects.toThrow(/没有需要修改/)
    // A collation the server does not know cannot be resolved to a character set, so
    // the CONVERT form is refused with that reason rather than a syntax error.
    await expect(driver!.alterTableOptions(DB_A, 'partial', { collation: 'no_such_collation', convertColumns: true })).rejects.toThrow()
  })
})

/**
 * SQLite's side of the same contract.
 *
 * All three blocks are reported unsupported, and each method says WHY rather than
 * failing on a statement the engine would reject for a reason that reads as a bug.
 */
describe('SQLite table actions', () => {
  let dir: string
  let sqlite: SqliteDriver
  let usable = false

  beforeAll(async () => {
    usable = await sqliteAvailable()
    if (!usable) return
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    dir = mkdtempSync(join(tmpdir(), 'dbm-tableop-'))
    sqlite = new SqliteDriver({
      id: 'sqlite-tableop',
      kind: 'sqlite',
      name: 'sqlite-tableop',
      group: '',
      tags: [],
      description: '',
      file: join(dir, 'main.db'),
      readonly: false,
      createdAt: 0,
      updatedAt: 0,
    })
    await sqlite.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)', [])
  })

  afterAll(async () => {
    if (!usable) return
    await sqlite.close()
    const { rmSync } = await import('node:fs')
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports no support, so the page disables the blocks with a reason', async () => {
    if (!usable) return
    expect(sqlite.tableActionSupport()).toEqual([])
  })

  it('refuses a cross-schema move with the reason, but renames inside one', async () => {
    if (!usable) return
    // Measured: `ALTER TABLE t RENAME TO aux.t` is "near \".\": syntax error", and no
    // other statement relocates a table between attached schemas.
    await expect(sqlite.moveTable('main', 't', { schema: 'other', table: 't' })).rejects.toThrow(/不能移动/)
    await expect(sqlite.moveTable('main', 't', { schema: 'main', table: 't' })).rejects.toThrow(/same table/)
    await expect(sqlite.moveTable('main', 'no_such', { schema: 'main', table: 'x' })).rejects.toThrow(/no such table/)

    // A rename inside the schema does work, references included: measured, the
    // view/trigger/index SQL is rewritten to the new name.
    await sqlite.exec('CREATE INDEX ix_t_v ON t(v)', [])
    await sqlite.exec('CREATE VIEW vw AS SELECT * FROM t', [])
    await sqlite.moveTable('main', 't', { schema: 'main', table: 't2' })
    const objects = await sqlite.tableNames('main')
    expect(objects.map(entry => entry.name).sort()).toEqual(['t2', 'vw'])
    const row = await sqlite.exec("SELECT sql FROM sqlite_master WHERE name = 'vw'", [], 'main')
    expect(String(row.rows[0]?.[0])).toContain('t2')
    // And the renamed table is where the pane should look next.
    await sqlite.moveTable('main', 't2', { schema: 'main', table: 't' })
  })

  it('refuses to rename a view, with the engine\'s own reason', async () => {
    if (!usable) return
    // Measured: "view vw may not be altered". A view's name is fixed by its CREATE VIEW.
    await expect(sqlite.moveTable('main', 'vw', { schema: 'main', table: 'vw2' })).rejects.toThrow(/视图/)
  })

  it('refuses a copy and an option change, each with its reason', async () => {
    if (!usable) return
    // `CREATE TABLE … AS SELECT` drops the key, the constraints and the generated
    // columns (measured), so a faithful copy would need a second rebuild path.
    await expect(sqlite.copyTable()).rejects.toThrow(/复制表/)
    await expect(sqlite.alterTableOptions()).rejects.toThrow(/表选项/)
  })

  it('reports only the object kind, since there is nothing else to report', async () => {
    if (!usable) return
    expect(await sqlite.tableOptionInfo('main', 't')).toEqual({ isView: false })
    expect(await sqlite.tableOptionInfo('main', 'vw')).toEqual({ isView: true })
    await expect(sqlite.tableOptionInfo('main', 'nope')).rejects.toThrow(/no such table/)
  })
})
