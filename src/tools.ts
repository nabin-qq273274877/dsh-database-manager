/**
 * Agent tools: the model-facing counterpart of the browser panel. Every tool
 * talks to the same store and pool the GUI uses, so a data source configured
 * in the panel is immediately operable by any agent, and vice versa.
 *
 * The read/write split is the security boundary: `db_list`, `db_schema` and
 * `db_query` can only read, and `db_exec` is the single write tool — so the
 * authorization gate in auth.ts only has to reason about one name per
 * direction. Command classification is repeated inside the tools as a second
 * line of defence, in case the gate is ever bypassed.
 */

import type { ContentBlock } from './llm-types.ts'
import type { ConnectionPool } from './pool.ts'
import type { DataSourceStore } from './store.ts'
import { summarize } from './store.ts'
import { isRedisDriver, isSqlDriver } from './drivers/types.ts'
import { isRedisReadCommand } from './drivers/redis.ts'
import { looksReadOnly } from './sql-util.ts'
import type { DataSourceSummary, QueryResult } from './protocol.ts'

/** One text content block (the only render shape these tools emit). */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** Structural tool-definition helpers, supplied by the host context. */
export interface ToolHost {
  defineTool?: (definition: unknown) => unknown
  registerTool?: (ctx: unknown, tool: unknown) => () => void
}

/** Render one query result as a compact aligned table for the model. */
export function renderResult(result: QueryResult, maxRows = 200): string {
  const head = result.write
    ? `[write] ${result.affected} row(s) affected in ${result.durationMs} ms`
    : `[read] ${result.rows.length} row(s) in ${result.durationMs} ms${result.truncated ? ' (truncated)' : ''}`
  if (result.columns.length === 0) return head

  const shown = result.rows.slice(0, maxRows)
  const cells = shown.map(row => row.map(cell => (cell === null ? 'NULL' : String(cell))))
  const widths = result.columns.map((column, index) => {
    let width = column.length
    for (const row of cells) width = Math.max(width, (row[index] ?? '').length)
    return Math.min(width, 60)
  })
  const line = (values: string[]): string =>
    values.map((value, index) => pad(value, widths[index] ?? value.length)).join(' | ')

  const lines = [head, line(result.columns), widths.map(width => '-'.repeat(width)).join('-+-')]
  for (const row of cells) lines.push(line(row.map(value => truncate(value, 60))))
  if (result.rows.length > shown.length) lines.push(`… ${result.rows.length - shown.length} more row(s) omitted`)
  return lines.join('\n')
}

/** Pad a cell to a fixed width. */
function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

/** Truncate a cell, marking the cut. */
function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`
}

/** Render the source table shared by the list and lookup surfaces. */
function renderSources(sources: DataSourceSummary[]): string {
  if (sources.length === 0) return 'no data sources configured'
  const header = 'id | kind | name | group | host/file | user | auth | tags | readonly'
  const divider = '--- | --- | --- | --- | --- | --- | --- | --- | ---'
  const rows = sources.map(source => [
    source.id,
    source.kind,
    source.name,
    source.group === '' ? '-' : source.group,
    source.kind === 'sqlite' ? (source.file ?? '-') : `${source.host ?? '-'}:${source.port ?? '-'}`,
    source.user ?? '-',
    source.auth,
    source.tags.length > 0 ? source.tags.join(',') : '-',
    source.readonly ? 'yes' : 'no',
  ].join(' | '))
  return [header, divider, ...rows].join('\n')
}

/** Render a table tree compactly. */
function renderTables(tables: Array<{ name: string; type: string; rows?: number; comment?: string }>): string {
  if (tables.length === 0) return 'no tables'
  return tables
    .map(table => {
      const bits = [table.type, table.name]
      if (table.rows !== undefined) bits.push(`~${table.rows} rows`)
      if (table.comment !== undefined) bits.push(table.comment)
      return bits.join('  ')
    })
    .join('\n')
}

/** Render a column list. */
function renderColumns(columns: Array<{ name: string; type: string; nullable: boolean; key: string; defaultValue?: string; comment?: string; extra?: string }>): string {
  if (columns.length === 0) return 'no columns'
  const header = 'column | type | null | key | default | extra | comment'
  const divider = '--- | --- | --- | --- | --- | --- | ---'
  const rows = columns.map(column => [
    column.name,
    column.type,
    column.nullable ? 'YES' : 'NO',
    column.key === '' ? '-' : column.key,
    column.defaultValue ?? '-',
    column.extra ?? '-',
    column.comment ?? '-',
  ].join(' | '))
  return [header, divider, ...rows].join('\n')
}

/**
 * The tool definitions, built against a live store and pool.
 * @param store - the data-source store.
 * @param pool - the live-driver pool.
 * @param defineTool - the registry's `defineTool` helper from the host context.
 */
export function makeTools(
  store: DataSourceStore,
  pool: ConnectionPool,
  defineTool: (definition: unknown) => unknown,
): unknown[] {
  /** Resolve one source by id or exact name, with a helpful error. */
  const resolve = (idOrName: string): { id: string } => {
    const byId = store.find(idOrName)
    if (byId !== undefined) return { id: byId.id }
    const byName = store.list().find(entry => entry.name === idOrName)
    if (byName !== undefined) return { id: byName.id }
    const known = store.list().map(entry => `${entry.id} (${entry.kind})`).join(', ')
    throw new Error(
      known === ''
        ? `no data source "${idOrName}" — none are configured; the user must add one in the 数据库管理 panel`
        : `no data source "${idOrName}"; configured: ${known}`,
    )
  }

  /** The live driver for one source, connecting on first use. */
  const driverOf = (idOrName: string) => {
    const { id } = resolve(idOrName)
    const entry = store.find(id)!
    return { entry, driver: pool.acquire(entry), summary: summarize(entry) }
  }

  // ---- db_list -----------------------------------------------------------
  const listTool = defineTool({
    name: 'db_list',
    description:
      'List the database data sources the user has configured in the 数据库管理 panel (id, engine, name, host/file, user, auth, tags, readonly). ' +
      'Use the returned id or name with the other db_* tools. Read-only. ' +
      'Triggers: list databases, configured database, data sources, 数据库列表.',
    parameters: {
      query: { type: 'string', description: 'Optional fuzzy match against id, name, group, tags, host and file.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sources: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                kind: { type: 'string', enum: ['sqlite', 'mysql', 'redis'], required: true },
                name: { type: 'string', required: true },
                group: { type: 'string', required: true },
                host: { type: 'string' },
                port: { type: 'integer' },
                file: { type: 'string' },
                user: { type: 'string' },
                database: { type: 'string' },
                db: { type: 'integer' },
                auth: { type: 'string', required: true },
                tags: { type: 'array', items: { type: 'string' }, required: true },
                readonly: { type: 'boolean', required: true },
                description: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args: unknown, value: { sources?: DataSourceSummary[] }) => text(renderSources(value.sources ?? [])),
    },
    async execute(args: { query?: string }) {
      const term = args.query?.trim().toLowerCase()
      const all = store.list().map(summarize)
      const sources = term === undefined || term === ''
        ? all
        : all.filter(source =>
            [source.id, source.name, source.group, source.host ?? '', source.file ?? '', source.tags.join(' ')]
              .some(field => field.toLowerCase().includes(term)),
          )
      return { sources }
    },
  })

  // ---- db_schema ---------------------------------------------------------
  const schemaTool = defineTool({
    name: 'db_schema',
    description:
      'Inspect the structure of a SQL data source: its schemas/databases, tables and views, and (with "table") the columns and indexes of one table. ' +
      'For Redis, returns the key count per logical database instead. Read-only. ' +
      'Triggers: table structure, describe table, schema, columns, indexes, list tables, 表结构.',
    parameters: {
      source: { type: 'string', required: true, description: 'Data source id or name from db_list.' },
      schema: { type: 'string', description: 'SQL: which database/schema to inspect. Required together with "table" on MySQL, where omitting it lists the databases.' },
      table: { type: 'string', description: 'SQL: return this table\'s columns and indexes instead of the whole tree.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          schemas: { type: 'array', items: { type: 'string' }, required: true },
          tables: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                type: { type: 'string', required: true },
                rows: { type: 'integer' },
                comment: { type: 'string' },
              },
            },
          },
          columns: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                type: { type: 'string', required: true },
                nullable: { type: 'boolean', required: true },
                key: { type: 'string', required: true },
                defaultValue: { type: 'string' },
                extra: { type: 'string' },
                comment: { type: 'string' },
              },
            },
          },
          indexes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                unique: { type: 'boolean', required: true },
                columns: { type: 'array', items: { type: 'string' }, required: true },
              },
            },
          },
          redisDatabases: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                db: { type: 'integer', required: true },
                keys: { type: 'integer', required: true },
              },
            },
          },
          tablesRendered: { type: 'string', required: true },
          columnsRendered: { type: 'string' },
          indexesRendered: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => {
        const lines: string[] = []
        const schemas = value['schemas'] as string[] | undefined
        if (schemas !== undefined && schemas.length > 0) lines.push(`schemas: ${schemas.join(', ')}`)
        if (value['tablesRendered'] !== undefined) lines.push(String(value['tablesRendered']))
        if (value['columnsRendered'] !== undefined) lines.push('', String(value['columnsRendered']))
        if (value['indexesRendered'] !== undefined) lines.push('', String(value['indexesRendered']))
        const redisDatabases = value['redisDatabases'] as Array<{ db: number; keys: number }> | undefined
        if (redisDatabases !== undefined) {
          lines.push(redisDatabases.length === 0 ? 'no databases hold keys' : redisDatabases.map(item => `db${item.db}: ${item.keys} keys`).join('\n'))
        }
        return text(lines.join('\n'))
      },
    },
    async execute(args: { source: string; schema?: string; table?: string }) {
      const { driver, summary } = driverOf(args.source)

      if (isRedisDriver(driver)) {
        const info = await driver.info()
        const redisDatabases = info.databases.map(item => ({ db: item.db, keys: item.keys }))
        return {
          kind: summary.kind,
          schemas: [],
          tables: [],
          redisDatabases,
          tablesRendered: redisDatabases.length === 0 ? 'no databases hold keys' : redisDatabases.map(item => `db${item.db}: ${item.keys} keys`).join('\n'),
        }
      }
      if (!isSqlDriver(driver)) throw new Error('unsupported data source kind')

      const schemas = (await driver.schemas()).map(item => item.name)
      // No stored default schema exists for MySQL any more (the browser lists
      // every database). For SQLite the single schema is 'main'; for MySQL an
      // unspecified schema means "describe the whole server", so only the
      // database-level listing is returned rather than silently guessing one
      // database and reporting its tables as if they were the answer.
      const schema = args.schema ?? (summary.kind === 'sqlite' ? 'main' : undefined)

      if (args.table !== undefined && args.table !== '') {
        if (schema === undefined) {
          throw new Error(
            `"table" needs a "schema" for a MySQL data source. Available: ${schemas.join(', ') || '(none)'}`,
          )
        }
        const tableName = args.table
        const [columns, indexes] = await Promise.all([
          driver.columns(schema, tableName),
          driver.indexes(schema, tableName).catch(() => []),
        ])
        return {
          kind: summary.kind,
          schemas,
          tables: [],
          columns,
          indexes: indexes.map(index => ({ name: index.name, unique: index.unique, columns: index.columns })),
          tablesRendered: `table: ${schema}.${tableName}`,
          columnsRendered: renderColumns(columns),
          indexesRendered: indexes.length === 0
            ? 'no indexes'
            : indexes.map(index => `${index.name}${index.unique ? ' (unique)' : ''}: ${index.columns.join(', ')}`).join('\n'),
        }
      }

      // No schema named: for MySQL the useful answer is the database list
      // itself, since each one would need its own round trip to enumerate.
      if (schema === undefined) {
        return {
          kind: summary.kind,
          schemas,
          tables: [],
          tablesRendered:
            schemas.length === 0
              ? 'no databases visible to this user'
              : `databases (pass "schema" to list one's tables):\n${schemas.join('\n')}`,
        }
      }

      const tables = await driver.tables(schema)
      return {
        kind: summary.kind,
        schemas,
        tables: tables.map(table => ({
          name: table.name,
          type: table.type,
          ...(table.rows === undefined ? {} : { rows: table.rows }),
          ...(table.comment === undefined ? {} : { comment: table.comment }),
        })),
        tablesRendered: `schema ${schema}:\n${renderTables(tables)}`,
      }
    },
  })

  // ---- db_query ----------------------------------------------------------
  const queryTool = defineTool({
    name: 'db_query',
    description:
      'Run a READ-ONLY statement against a data source and return the rows. SQL engines accept SELECT / WITH / SHOW / DESCRIBE / EXPLAIN / PRAGMA; Redis accepts a read command (GET, HGETALL, LRANGE, SCAN, INFO, …). ' +
      'Writes are refused here — use db_exec, which is gated by the user\'s approval. ' +
      'Triggers: query database, select, read table data, 查数据.',
    parameters: {
      source: { type: 'string', required: true, description: 'Data source id or name from db_list.' },
      sql: { type: 'string', required: true, description: 'SQL: one read-only statement. Redis: the command line, e.g. "GET mykey" or "HGETALL myhash".' },
      params: { type: 'array', items: { type: 'json' }, description: 'SQL: positional values bound to ? placeholders (never inline user data into the SQL text).' },
      schema: { type: 'string', description: 'SQL: the database/schema to run in.' },
      limit: { type: 'integer', description: 'Maximum rows returned (default 1000, max 5000).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          columns: { type: 'array', items: { type: 'string' }, required: true },
          rows: { type: 'array', items: { type: 'json' }, required: true },
          rowCount: { type: 'integer', required: true },
          durationMs: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          rendered: { type: 'string', required: true },
        },
      },
      render: (_args: unknown, value: { rendered?: string }) => text(value.rendered ?? ''),
    },
    async execute(args: { source: string; sql: string; params?: unknown[]; schema?: string; limit?: number }) {
      const { driver } = driverOf(args.source)
      const limit = Math.max(1, Math.min(args.limit ?? 1000, 5000))

      if (isRedisDriver(driver)) {
        const parts = args.sql.trim().split(/\s+/)
        const name = parts[0] ?? ''
        if (name === '') throw new Error('a Redis command is required')
        if (!isRedisReadCommand(name)) {
          throw new Error(`"${name}" is a write command and is not available to db_query; use db_exec, which requires the user\'s approval`)
        }
        const result = await driver.command(parts, 0)
        return shape(result)
      }
      if (!isSqlDriver(driver)) throw new Error('unsupported data source kind')
      if (!looksReadOnly(args.sql)) {
        throw new Error('db_query only accepts read-only statements; use db_exec (approval-gated) to write')
      }
      const params = Array.isArray(args.params) ? args.params : []
      const result = await driver.query(args.sql, params, limit, args.schema)
      return shape(result)
    },
  })

  // ---- db_exec -----------------------------------------------------------
  const execTool = defineTool({
    name: 'db_exec',
    description:
      'Run a WRITE statement against a data source (INSERT / UPDATE / DELETE / DDL for SQL, or a write command for Redis). ' +
      'This tool is gated: unless the user enabled “允许 agent 写入”, it is refused; when enabled, each call raises an approval prompt the user must confirm. ' +
      'Prefer db_query for anything that only reads. Always bind values through params instead of building SQL text. ' +
      'Triggers: update database, insert row, delete row, alter table, 改数据.',
    parameters: {
      source: { type: 'string', required: true, description: 'Data source id or name from db_list.' },
      sql: { type: 'string', required: true, description: 'SQL: one statement. Redis: the command line, e.g. "SET k v" or "DEL k".' },
      params: { type: 'array', items: { type: 'json' }, description: 'SQL: positional values bound to ? placeholders.' },
      schema: { type: 'string', description: 'SQL: the database/schema to run in.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          affected: { type: 'integer', required: true },
          durationMs: { type: 'integer', required: true },
          rendered: { type: 'string', required: true },
        },
      },
      render: (_args: unknown, value: { rendered?: string }) => text(value.rendered ?? ''),
    },
    async execute(args: { source: string; sql: string; params?: unknown[]; schema?: string }) {
      const { driver } = driverOf(args.source)

      if (isRedisDriver(driver)) {
        const parts = args.sql.trim().split(/\s+/)
        if (parts.length === 0 || parts[0] === '') throw new Error('a Redis command is required')
        const result = await driver.command(parts, 0)
        return { affected: result.affected, durationMs: result.durationMs, rendered: renderResult(result) }
      }
      if (!isSqlDriver(driver)) throw new Error('unsupported data source kind')
      const params = Array.isArray(args.params) ? args.params : []
      const result = await driver.exec(args.sql, params, args.schema)
      return { affected: result.affected, durationMs: result.durationMs, rendered: renderResult(result) }
    },
  })

  return [listTool, schemaTool, queryTool, execTool]
}

/** Project one query result onto the db_query output shape. */
function shape(result: QueryResult): {
  columns: string[]
  rows: Array<Array<string | number | boolean | null>>
  rowCount: number
  durationMs: number
  truncated: boolean
  rendered: string
} {
  return {
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rows.length,
    durationMs: result.durationMs,
    truncated: result.truncated,
    rendered: renderResult(result),
  }
}

/** Render one data source summary line (used by the connect tool's output). */
export function renderSourceLine(source: DataSourceSummary): string {
  return `${source.id} [${source.kind}] ${source.name}${source.readonly ? ' (readonly)' : ''}`
}
