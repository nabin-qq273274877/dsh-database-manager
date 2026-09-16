var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// src/sql-util.ts
function quoteMysql(name2) {
  return "`" + name2.replace(/`/g, "``") + "`";
}
function quoteSqlite(name2) {
  return '"' + name2.replace(/"/g, '""') + '"';
}
function isSafeIdentifier(name2) {
  if (name2 === "" || name2.length > 128) return false;
  if (!IDENTIFIER_RE.test(name2)) return false;
  if (name2.includes("\\")) return false;
  return true;
}
function requireIdentifier(name2, what, quote) {
  if (!isSafeIdentifier(name2)) throw new Error(`invalid ${what}: ${JSON.stringify(name2)}`);
  return quote(name2);
}
function qualifyMysql(schema, table) {
  const quotedTable = requireIdentifier(table, "table name", quoteMysql);
  if (schema === void 0 || schema === "") return quotedTable;
  return requireIdentifier(schema, "schema name", quoteMysql) + "." + quotedTable;
}
function qualifySqlite(schema, table) {
  const quotedTable = requireIdentifier(table, "table name", quoteSqlite);
  if (schema === void 0 || schema === "" || schema === "main") return quotedTable;
  return requireIdentifier(schema, "schema name", quoteSqlite) + "." + quotedTable;
}
function leadingKeyword(sql) {
  let text2 = sql.replace(/^\s+/, "");
  for (; ; ) {
    if (text2.startsWith("--")) {
      const end = text2.indexOf("\n");
      if (end === -1) return "";
      text2 = text2.slice(end + 1).replace(/^\s+/, "");
      continue;
    }
    if (text2.startsWith("/*")) {
      const end = text2.indexOf("*/");
      if (end === -1) return "";
      text2 = text2.slice(end + 2).replace(/^\s+/, "");
      continue;
    }
    break;
  }
  const match = /^[A-Za-z_]+/.exec(text2);
  return match === null ? "" : match[0].toLowerCase();
}
function looksReadOnly(sql) {
  const keyword = leadingKeyword(sql);
  return keyword !== "" && READ_PREFIXES.includes(keyword);
}
function forEachCodeChar(sql, visit) {
  let depth = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i++;
      while (i < n) {
        if (sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "(") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")") {
      depth = depth > 0 ? depth - 1 : 0;
      i++;
      continue;
    }
    if (visit(ch, i, depth) === true) return;
    i++;
  }
}
function hasTopLevelKeyword(sql, keyword) {
  const target = keyword.toLowerCase();
  let found = false;
  forEachCodeChar(sql, (char, index, depth) => {
    if (depth !== 0 || !/[A-Za-z_]/.test(char)) return;
    const previous = index === 0 ? "" : sql[index - 1];
    if (previous !== "" && WORD_CHAR_RE.test(previous)) return;
    let end = index + 1;
    while (end < sql.length && WORD_CHAR_RE.test(sql[end])) end++;
    if (sql.slice(index, end).toLowerCase() === target) {
      found = true;
      return true;
    }
  });
  return found;
}
function pushDownLimit(sql, limit) {
  if (!Number.isFinite(limit) || limit < 1) return void 0;
  const keyword = leadingKeyword(sql);
  if (keyword !== "select" && keyword !== "with") return void 0;
  if (hasTopLevelKeyword(sql, "limit")) return void 0;
  for (const clause of TRAILING_CLAUSES) {
    if (hasTopLevelKeyword(sql, clause)) return void 0;
  }
  const body = sql.replace(/[\s;]+$/, "");
  if (body === "") return void 0;
  return `${body}
LIMIT ${Math.trunc(limit)}`;
}
function assertSingleStatement(sql) {
  const withoutTrailing = sql.replace(/;\s*$/, "");
  if (containsStatementSeparator(withoutTrailing)) {
    throw new Error("only one statement per call is allowed");
  }
}
function containsStatementSeparator(sql) {
  let found = false;
  forEachCodeChar(sql, (char) => {
    if (char !== ";") return;
    found = true;
    return true;
  });
  return found;
}
function toWireValue(value) {
  if (value === null || value === void 0) return null;
  const type = typeof value;
  if (type === "string" || type === "boolean") return value;
  if (type === "number") {
    const numeric = value;
    return Number.isFinite(numeric) ? numeric : String(numeric);
  }
  if (type === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `<binary ${value.byteLength} bytes>`;
  if (value instanceof Buffer) return `<binary ${value.byteLength} bytes>`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
var IDENTIFIER_RE, READ_PREFIXES, WORD_CHAR_RE, TRAILING_CLAUSES;
var init_sql_util = __esm({
  "src/sql-util.ts"() {
    "use strict";
    IDENTIFIER_RE = /^[A-Za-z0-9_$][A-Za-z0-9_$ -]*$/;
    READ_PREFIXES = ["select", "with", "show", "describe", "desc", "explain", "pragma", "values", "table"];
    WORD_CHAR_RE = /[A-Za-z0-9_$]/;
    TRAILING_CLAUSES = ["into", "for", "lock", "procedure"];
  }
});

// src/drivers/mysql.ts
var mysql_exports = {};
__export(mysql_exports, {
  MysqlDriver: () => MysqlDriver,
  mysqlAvailable: () => mysqlAvailable
});
async function loadMysql() {
  try {
    const specifier = "mysql2/promise";
    const mod = await import(
      /* @vite-ignore */
      specifier
    );
    const resolved = typeof mod.createPool === "function" ? mod : mod.default;
    if (resolved === void 0 || typeof resolved.createPool !== "function") {
      throw new Error("module does not export createPool");
    }
    return resolved;
  } catch (error) {
    throw new Error(
      `MySQL support requires the optional dependency "mysql2". Install it next to this plugin (npm install mysql2). Detail: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
async function mysqlAvailable() {
  try {
    await loadMysql();
    return true;
  } catch {
    return false;
  }
}
function buildFilter(query, columns) {
  if (query.mode === "search") {
    const term = query.term ?? "";
    if (term === "") return { where: "", params: [] };
    const target = columns.filter((column) => isTextual(column.type));
    const chosen = target.length > 0 ? target : columns;
    const clauses = chosen.map((column) => `${quoteMysql(column.name)} LIKE ?`);
    return { where: ` WHERE (${clauses.join(" OR ")})`, params: chosen.map(() => `%${term}%`) };
  }
  if (query.condition !== void 0 && query.condition.trim() !== "") {
    assertSingleStatement(`SELECT 1 WHERE ${query.condition}`);
    return { where: ` WHERE (${query.condition})`, params: [] };
  }
  return { where: "", params: [] };
}
function isTextual(type) {
  return /char|text|enum|set|json|blob|binary/i.test(type);
}
function projectRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) out[key] = toWireValue(value);
  return out;
}
function asString(value) {
  return typeof value === "string" && value !== "" ? value : void 0;
}
function describeMysqlError(error) {
  if (typeof error === "object" && error !== null) {
    const record = error;
    const code = typeof record.code === "string" ? record.code : void 0;
    const sqlMessage = typeof record.sqlMessage === "string" ? record.sqlMessage : void 0;
    if (sqlMessage !== void 0) return code === void 0 ? sqlMessage : `${sqlMessage} (${code})`;
    if (typeof record.message === "string") return code === void 0 ? record.message : `${record.message} (${code})`;
  }
  return error instanceof Error ? error.message : String(error);
}
var MysqlDriver;
var init_mysql = __esm({
  "src/drivers/mysql.ts"() {
    "use strict";
    init_sql_util();
    MysqlDriver = class {
      kind = "mysql";
      entry;
      pool;
      constructor(entry) {
        this.entry = entry;
      }
      /** Create (once) and return the pool. */
      async open() {
        if (this.pool !== void 0) return this.pool;
        const host = this.entry.host;
        if (host === void 0 || host === "") throw new Error("mysql data source has no host configured");
        const { createPool } = await loadMysql();
        const timeout = this.entry.connectTimeoutMs ?? 1e4;
        const pool = createPool({
          host,
          port: this.entry.port ?? 3306,
          user: this.entry.user ?? "root",
          password: this.entry.password ?? "",
          // No default schema on the pool: a connection bound to one database
          // cannot see the others, and the browser must list every database. Each
          // statement qualifies its schema (or issues USE) instead.
          connectTimeout: timeout,
          waitForConnections: true,
          connectionLimit: 4,
          maxIdle: 2,
          idleTimeout: 6e4,
          queueLimit: 0,
          charset: "utf8mb4",
          // Dates arrive as ISO-ish strings rather than JS Date objects so the
          // wire projection stays lossless and timezone-free.
          dateStrings: true,
          // Keep big integers as strings; a BIGINT beyond 2^53 would otherwise
          // silently lose precision before it reaches the browser.
          supportBigNumbers: true,
          bigNumberStrings: true,
          ...this.entry.tls === true ? { ssl: { rejectUnauthorized: false } } : {}
        });
        pool.on("error", () => {
        });
        this.pool = pool;
        return pool;
      }
      async test() {
        const started = Date.now();
        try {
          const [rows] = await (await this.open()).query({
            sql: "SELECT VERSION() AS v, CONNECTION_ID() AS cid"
          });
          const first = Array.isArray(rows) ? rows[0] : void 0;
          const version = first === void 0 ? void 0 : toWireValue(first["v"]);
          return {
            ok: true,
            latencyMs: Date.now() - started,
            ...typeof version === "string" ? { serverVersion: `MySQL ${version}` } : {}
          };
        } catch (error) {
          return { ok: false, latencyMs: Date.now() - started, error: describeMysqlError(error) };
        }
      }
      async close() {
        const pool = this.pool;
        this.pool = void 0;
        if (pool === void 0) return;
        try {
          await pool.end();
        } catch {
        }
      }
      async schemas() {
        const [rows] = await (await this.open()).query({
          sql: "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema','performance_schema','mysql','sys') ORDER BY SCHEMA_NAME"
        });
        const list = Array.isArray(rows) ? rows : [];
        return list.map((row) => String(row["name"] ?? "")).filter((name2) => name2 !== "").map((name2) => ({ name: name2 }));
      }
      /**
       * The schema an operation applies to.
       *
       * Required rather than defaulted: this data source no longer stores a default
       * schema, precisely so the browser can list every database. Silently falling
       * back to "the first one" would run a statement against a schema the user
       * never chose, which is the kind of mistake that loses data.
       */
      requireSchema(schema) {
        const target = schema !== void 0 && schema !== "" ? schema : void 0;
        if (target === void 0) {
          throw new Error("a schema is required for this operation \u2014 pick a database in the browser first");
        }
        requireIdentifier(target, "schema name", quoteMysql);
        return target;
      }
      async tables(schema, options) {
        const target = this.requireSchema(schema);
        const wantStats = options?.stats === true;
        const [rows] = await (await this.open()).query({
          sql: wantStats ? "SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS rows_count, TABLE_COMMENT AS comment, ENGINE AS engine, TABLE_COLLATION AS collation, DATA_LENGTH AS data_bytes, INDEX_LENGTH AS index_bytes FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME" : "SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME",
          values: [target]
        });
        const list = Array.isArray(rows) ? rows : [];
        return list.map((row) => {
          const record = row;
          const type = String(record["type"] ?? "");
          const comment = toWireValue(record["comment"]);
          const rowCount = toWireValue(record["rows_count"]);
          const engine = toWireValue(record["engine"]);
          const collation = toWireValue(record["collation"]);
          const dataBytes = toWireValue(record["data_bytes"]);
          const indexBytes = toWireValue(record["index_bytes"]);
          const size = typeof dataBytes === "number" || typeof indexBytes === "number" ? (typeof dataBytes === "number" ? dataBytes : 0) + (typeof indexBytes === "number" ? indexBytes : 0) : void 0;
          return {
            name: String(record["name"] ?? ""),
            type: type.includes("VIEW") ? "view" : "table",
            ...typeof rowCount === "number" ? { rows: rowCount } : {},
            ...size === void 0 ? {} : { size },
            ...typeof comment === "string" && comment !== "" ? { comment } : {},
            ...typeof engine === "string" && engine !== "" ? { engine } : {},
            ...typeof collation === "string" && collation !== "" ? { collation } : {}
          };
        });
      }
      async columns(schema, table) {
        const target = this.requireSchema(schema);
        requireIdentifier(table, "table name", quoteMysql);
        const [rows] = await (await this.open()).query({
          sql: "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt, COLUMN_KEY AS col_key, COLUMN_COMMENT AS comment, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
          values: [target, table]
        });
        const list = Array.isArray(rows) ? rows : [];
        return list.map((row) => {
          const record = row;
          const dflt = toWireValue(record["dflt"]);
          const comment = toWireValue(record["comment"]);
          const extra = toWireValue(record["extra"]);
          return {
            name: String(record["name"] ?? ""),
            type: String(record["type"] ?? ""),
            nullable: String(record["nullable"] ?? "YES").toUpperCase() === "YES",
            ...dflt === null ? {} : { defaultValue: String(dflt) },
            key: String(record["col_key"] ?? ""),
            ...typeof comment === "string" && comment !== "" ? { comment } : {},
            ...typeof extra === "string" && extra !== "" ? { extra } : {}
          };
        });
      }
      async indexes(schema, table) {
        const target = this.requireSchema(schema);
        requireIdentifier(table, "table name", quoteMysql);
        const [rows] = await (await this.open()).query({
          sql: "SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, COLUMN_NAME AS column_name, SEQ_IN_INDEX AS seq, INDEX_TYPE AS index_type FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX",
          values: [target, table]
        });
        const list = Array.isArray(rows) ? rows : [];
        const byName = /* @__PURE__ */ new Map();
        for (const row of list) {
          const record = row;
          const name2 = String(record["name"] ?? "");
          if (name2 === "") continue;
          const entry = byName.get(name2) ?? { unique: Number(record["non_unique"] ?? 1) === 0, columns: [], type: asString(record["index_type"]) };
          const column = asString(record["column_name"]);
          if (column !== void 0) entry.columns.push({ seq: Number(record["seq"] ?? 0), name: column });
          byName.set(name2, entry);
        }
        return [...byName.entries()].map(([name2, entry]) => ({
          name: name2,
          unique: entry.unique,
          columns: entry.columns.sort((a, b) => a.seq - b.seq).map((item) => item.name),
          ...entry.type === void 0 ? {} : { type: entry.type }
        }));
      }
      async rows(query) {
        const schema = this.requireSchema(query.schema);
        const columns = await this.columns(schema, query.table);
        if (columns.length === 0) throw new Error(`no such table: ${schema}.${query.table}`);
        const qualified = qualifyMysql(schema, query.table);
        const known = new Set(columns.map((column) => column.name));
        const { where, params } = buildFilter(query, columns);
        const [countRows] = await (await this.open()).query({
          sql: `SELECT COUNT(*) AS n FROM ${qualified}${where}`,
          values: params
        });
        const first = Array.isArray(countRows) ? countRows[0] : void 0;
        const total = Number(toWireValue(first?.["n"] ?? 0) ?? 0);
        const order = query.orderBy !== void 0 && known.has(query.orderBy) ? ` ORDER BY ${quoteMysql(query.orderBy)} ${query.orderDir === "desc" ? "DESC" : "ASC"}` : "";
        const limit = Math.max(1, Math.min(query.pageSize, 5e3));
        const offset = Math.max(0, (query.page - 1) * limit);
        const [dataRows] = await (await this.open()).query({
          sql: `SELECT * FROM ${qualified}${where}${order} LIMIT ${limit} OFFSET ${offset}`,
          values: params
        });
        const list = Array.isArray(dataRows) ? dataRows : [];
        return {
          columns,
          rows: list.map((row) => projectRow(row)),
          total: Number.isFinite(total) ? total : 0,
          page: query.page,
          pageSize: limit,
          primaryKey: columns.filter((column) => column.key === "PRI").map((column) => column.name)
        };
      }
      async query(sql, params, limit, schema) {
        assertSingleStatement(sql);
        if (!looksReadOnly(sql)) {
          throw new Error("only read-only statements (SELECT / WITH / SHOW / DESCRIBE / EXPLAIN) are allowed on this surface");
        }
        const pushed = limit >= 1 ? pushDownLimit(sql, limit + 1) : void 0;
        return this.runQuery(pushed ?? sql, params, limit, schema);
      }
      async exec(sql, params, schema) {
        assertSingleStatement(sql);
        if (schema !== void 0 && schema !== "") requireIdentifier(schema, "schema name", quoteMysql);
        return this.runQuery(sql, params, 0, schema);
      }
      /**
       * One statement round trip, optionally scoped to a schema.
       *
       * The schema is applied with `USE` on the SAME pooled connection that runs the
       * statement. Issuing `USE` separately and hoping for the same connection would
       * be wrong twice over: the statement could land on a different connection, and
       * the schema choice would leak into whatever else later reuses that one.
       */
      async runQuery(sql, params, limit, schema) {
        const pool = await this.open();
        const connection = await pool.getConnection();
        try {
          if (schema !== void 0 && schema !== "") await connection.query({ sql: `USE ${quoteMysql(schema)}` });
          const started = Date.now();
          const [result, fields] = await connection.query({ sql, values: params });
          return this.shape(result, fields, limit, Date.now() - started);
        } finally {
          try {
            await connection.query({ sql: "USE `information_schema`" });
            connection.release();
          } catch {
            connection.destroy();
          }
        }
      }
      /** Shape one driver reply into the wire result. */
      shape(result, fields, limit, durationMs) {
        if (Array.isArray(result)) {
          const fieldList = Array.isArray(fields) ? fields : [];
          const columns = fieldList.map((field) => typeof field.name === "string" ? String(field.name) : "").filter((name2) => name2 !== "");
          const rows = result;
          const truncated = limit > 0 && rows.length > limit;
          const sliced = truncated ? rows.slice(0, limit) : rows;
          const projected = columns.length > 0 ? columns : sliced.length > 0 ? Object.keys(sliced[0]) : [];
          return {
            columns: projected,
            rows: sliced.map((row) => projected.map((column) => toWireValue(row[column]))),
            affected: sliced.length,
            durationMs,
            write: false,
            truncated
          };
        }
        const summary = result ?? {};
        return {
          columns: [],
          rows: [],
          affected: Number(toWireValue(summary["affectedRows"] ?? 0) ?? 0),
          durationMs,
          write: true,
          truncated: false
        };
      }
      async insertRow(schema, table, values) {
        if (values.length === 0) throw new Error("insert requires at least one column value");
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        const names = values.map((item) => requireIdentifier(item.column, "column name", quoteMysql)).join(", ");
        const placeholders = values.map(() => "?").join(", ");
        return this.exec(`INSERT INTO ${qualified} (${names}) VALUES (${placeholders})`, values.map((item) => item.value), target);
      }
      async updateRow(schema, table, values, keys) {
        if (values.length === 0) throw new Error("update requires at least one column value");
        if (keys.length === 0) throw new Error("update requires a row key");
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        const assignments = values.map((item) => `${requireIdentifier(item.column, "column name", quoteMysql)} = ?`).join(", ");
        const where = keys.map((item) => `${requireIdentifier(item.column, "column name", quoteMysql)} <=> ?`).join(" AND ");
        return this.exec(
          `UPDATE ${qualified} SET ${assignments} WHERE ${where}`,
          [...values.map((item) => item.value), ...keys.map((item) => item.value)],
          target
        );
      }
      async deleteRow(schema, table, keys) {
        if (keys.length === 0) throw new Error("delete requires a row key");
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        const where = keys.map((item) => `${requireIdentifier(item.column, "column name", quoteMysql)} <=> ?`).join(" AND ");
        return this.exec(`DELETE FROM ${qualified} WHERE ${where}`, keys.map((item) => item.value), target);
      }
      /**
       * Empty a table, keeping its schema.
       *
       * TRUNCATE rather than DELETE: it is a metadata operation that drops and
       * recreates the table's data pages instead of removing rows one at a time,
       * which is the difference between instant and minutes on a large InnoDB
       * table. It also resets AUTO_INCREMENT, which is the behaviour users expect
       * from the phpMyAdmin 清空 button this mirrors.
       *
       * A view has no rows of its own, so it is refused rather than reported as
       * "0 rows affected".
       */
      async truncateTable(schema, table, isView = false) {
        if (isView) throw new Error("a view has no rows of its own to delete");
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        return this.exec(`TRUNCATE TABLE ${qualified}`, [], target);
      }
      /**
       * Drop a table or a view.
       *
       * The object's kind picks the statement, since MySQL rejects `DROP TABLE` on
       * a view ("'db.v' is a view").
       */
      async dropTable(schema, table, isView = false) {
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        return this.exec(`DROP ${isView ? "VIEW" : "TABLE"} ${qualified}`, [], target);
      }
    };
  }
});

// src/redis-util.ts
function compareKeyNames(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x < y) return -1;
  if (x > y) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
function escapeGlob(literal) {
  return literal.replace(/[\\*?[\]]/g, (match) => `\\${match}`);
}
function prefixPattern(path) {
  return `${escapeGlob(path)}${SEPARATOR}*`;
}
function keyPattern(key) {
  return escapeGlob(key);
}
var SEPARATOR;
var init_redis_util = __esm({
  "src/redis-util.ts"() {
    "use strict";
    SEPARATOR = ":";
  }
});

// src/drivers/redis.ts
var redis_exports = {};
__export(redis_exports, {
  REDIS_READ_COMMANDS: () => REDIS_READ_COMMANDS,
  RedisDriver: () => RedisDriver,
  isRedisReadCommand: () => isRedisReadCommand,
  redisAvailable: () => redisAvailable
});
function replyValue(reply) {
  if (reply === void 0 || reply[0] !== null) return void 0;
  return reply[1];
}
async function loadRedis() {
  try {
    const specifier = "ioredis";
    const mod = await import(
      /* @vite-ignore */
      specifier
    );
    const ctor = typeof mod.default === "function" ? mod.default : mod.Redis;
    if (typeof ctor !== "function") throw new Error("module does not export a Redis constructor");
    return { default: ctor };
  } catch (error) {
    throw new Error(
      `Redis support requires the optional dependency "ioredis". Install it next to this plugin (npm install ioredis). Detail: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
async function redisAvailable() {
  try {
    await loadRedis();
    return true;
  } catch {
    return false;
  }
}
function shapeRedisReply(reply, durationMs) {
  if (Array.isArray(reply)) {
    const rows = reply.map((item) => [toWireValue(item)]);
    return { columns: ["result"], rows, affected: rows.length, durationMs, write: false, truncated: false };
  }
  return {
    columns: [],
    rows: [[toWireValue(reply)]],
    affected: 1,
    durationMs,
    write: false,
    truncated: false
  };
}
function readInfoField(info, field) {
  const match = new RegExp(`^${field}:([^\\r\\n]+)`, "m").exec(info);
  return match?.[1]?.trim();
}
function describeRedisError(error) {
  const record = typeof error === "object" && error !== null ? error : {};
  const message = typeof record.message === "string" ? record.message : void 0;
  const code = typeof record.code === "string" ? record.code : void 0;
  const base = message ?? (error instanceof Error ? error.message : String(error));
  if (base.includes("max retries per request")) {
    return "could not reach the server, or it did not accept the connection settings (host, port, password, TLS). " + (code === void 0 ? "" : `[${code}]`).trim();
  }
  if (base.includes("WRONGPASS") || base.includes("NOAUTH") || base.includes("invalid password")) {
    return `the server rejected the password${code === void 0 ? "" : ` (${code})`}`;
  }
  if (base.includes("ECONNREFUSED")) {
    return `nothing is listening on that host and port (${code ?? "ECONNREFUSED"}) \u2014 check the address and that the server is running`;
  }
  if (base.includes("ENOTFOUND") || base.includes("EAI_AGAIN")) {
    return `the host name could not be resolved (${code ?? "ENOTFOUND"})`;
  }
  if (base.includes("ETIMEDOUT")) {
    return "the connection timed out \u2014 a firewall or an encryption mismatch can both cause this";
  }
  return code === void 0 ? base : `${base} (${code})`;
}
function isRedisReadCommand(name2) {
  return REDIS_READ_COMMANDS.includes(name2.toLowerCase());
}
var MAX_ELEMENTS, MAX_LEVEL_KEYS_RETURNED, MAX_SEARCH_KEYS, MAX_TREE_KEYS, INDEX_AGGREGATE_SCRIPT, TREE_SCAN_COUNT, LEVEL_SCAN_KEY_BUDGET, TREE_PIPELINE_BATCH, MAX_DELETE_KEYS, DELETE_BATCH, DEFAULT_TIMEOUT_MS, MAX_RECONNECT_ATTEMPTS, RedisDriver, REDIS_READ_COMMANDS;
var init_redis = __esm({
  "src/drivers/redis.ts"() {
    "use strict";
    init_sql_util();
    init_redis_util();
    MAX_ELEMENTS = 1e3;
    MAX_LEVEL_KEYS_RETURNED = 5e3;
    MAX_SEARCH_KEYS = 5e3;
    MAX_TREE_KEYS = 5e4;
    INDEX_AGGREGATE_SCRIPT = `
local cursor = ARGV[1]
local batch = tonumber(ARGV[2])
local sep = ARGV[3]
local nameBudget = tonumber(ARGV[4])
local US = string.char(1)

local folders = {}
local direct = {}
local leaves = {}
local visited = 0
local namesSent = 0

while true do
  local reply = redis.call('SCAN', cursor, 'COUNT', 1000)
  cursor = reply[1]
  local names = reply[2]
  for i = 1, #names do
    local key = names[i]
    visited = visited + 1
    -- Fold into every proper prefix, so each ancestor folder counts this key.
    local from = 1
    while true do
      local at = string.find(key, sep, from, true)
      if at == nil then break end
      local ancestor = string.sub(key, 1, at - 1)
      folders[ancestor] = (folders[ancestor] or 0) + 1
      from = at + 1
    end
    -- The key's own level: parent path plus its leaf name.
    local last = 1
    local at = string.find(key, sep, 1, true)
    while at ~= nil do
      last = at + 1
      at = string.find(key, sep, at + 1, true)
    end
    local parent = ''
    local leaf = key
    if last > 1 then
      parent = string.sub(key, 1, last - 2)
      leaf = string.sub(key, last)
    end
    direct[parent] = (direct[parent] or 0) + 1
    -- Names are only needed to draw rows, and only a page of them, so the total
    -- sent per call is capped. The counts above are unaffected by the cap.
    if namesSent < nameBudget then
      if leaves[parent] == nil then leaves[parent] = {} end
      local bucket = leaves[parent]
      bucket[#bucket + 1] = leaf
      namesSent = namesSent + 1
    end
  end
  if cursor == '0' or visited >= batch then break end
end

local folderParts = {}
for path, n in pairs(folders) do
  folderParts[#folderParts + 1] = path .. '\\t' .. tostring(n)
end

local directParts = {}
for parent, n in pairs(direct) do
  directParts[#directParts + 1] = parent .. '\\t' .. tostring(n)
end

local leafParts = {}
for parent, bucket in pairs(leaves) do
  leafParts[#leafParts + 1] = parent .. '\\t' .. table.concat(bucket, US)
end

return {
  cursor,
  tostring(visited),
  table.concat(folderParts, '\\n'),
  table.concat(directParts, '\\n'),
  table.concat(leafParts, '\\n'),
}
`;
    TREE_SCAN_COUNT = 1e4;
    LEVEL_SCAN_KEY_BUDGET = 2e5;
    TREE_PIPELINE_BATCH = 1e3;
    MAX_DELETE_KEYS = 5e4;
    DELETE_BATCH = 500;
    DEFAULT_TIMEOUT_MS = 1e4;
    MAX_RECONNECT_ATTEMPTS = 3;
    RedisDriver = class {
      kind = "redis";
      entry;
      /** Clients keyed by logical database index, so switching db is cheap. */
      clients = /* @__PURE__ */ new Map();
      constructor(entry) {
        this.entry = entry;
      }
      /** Client for one logical database index. */
      async client(db) {
        const index = db ?? this.entry.db ?? 0;
        const cached = this.clients.get(index);
        if (cached !== void 0) return cached;
        const host = this.entry.host;
        if (host === void 0 || host === "") throw new Error("redis data source has no host configured");
        const { default: Redis } = await loadRedis();
        const timeout = this.entry.connectTimeoutMs ?? DEFAULT_TIMEOUT_MS;
        const client = new Redis(this.entry.port ?? 6379, host, {
          password: this.entry.password === "" ? void 0 : this.entry.password,
          db: index,
          connectTimeout: timeout,
          // Fail a command rather than queueing it forever when the server is down;
          // a UI action must always settle.
          maxRetriesPerRequest: 2,
          // Bounded reconnection. Without this, ioredis retries forever: a WRONG
          // connection setting (measured: tls:true against a plaintext server)
          // never rejects and the caller waits indefinitely. `null` after the
          // budget stops reconnecting so the pending command fails with a reason.
          retryStrategy: (attempt) => attempt > MAX_RECONNECT_ATTEMPTS ? null : Math.min(attempt * 200, 1e3),
          enableOfflineQueue: true,
          lazyConnect: false,
          ...this.entry.tls === true ? { tls: { rejectUnauthorized: false } } : {}
        });
        client.on("error", () => {
        });
        this.clients.set(index, client);
        return client;
      }
      /**
       * Run one command under a hard deadline.
       *
       * `maxRetriesPerRequest` and `retryStrategy` bound what ioredis will do, but a
       * server that accepts the TCP connection and then never completes the
       * handshake (the plaintext-server-vs-TLS-client case) produces no error to
       * count — the promise simply never settles. Racing a timer is the only way to
       * guarantee the UI gets an answer, and it is cheaper than hanging forever.
       *
       * @param what - names the operation, in the user's terms, for the timeout text.
       * @param hint - what a timeout most likely MEANS for this operation. The
       *   connection wording ("did not complete the handshake, check the port and
       *   TLS") is only true for a connection attempt; applying it to a long scan
       *   sent the reader to inspect TLS settings when the real cause was that a
       *   large remote keyspace needed more round trips than the budget allowed.
       */
      withDeadline(work, timeoutMs, what, hint) {
        return new Promise((resolve3, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(
              `${what} timed out after ${timeoutMs} ms \u2014 ${hint ?? "the server did not complete the handshake. Check the host, port and whether this server expects an encrypted (TLS) connection."}`
            ));
          }, timeoutMs);
          work.then(
            (value) => {
              clearTimeout(timer);
              resolve3(value);
            },
            (error) => {
              clearTimeout(timer);
              reject(error);
            }
          );
        });
      }
      async test() {
        const started = Date.now();
        const timeout = this.entry.connectTimeoutMs ?? DEFAULT_TIMEOUT_MS;
        try {
          const client = await this.client();
          const pong = await this.withDeadline(client.ping(), timeout, "connecting to Redis");
          const info = await client.info("server").catch(() => "");
          const version = /redis_version:([^\r\n]+)/.exec(info)?.[1]?.trim();
          return {
            ok: pong === "PONG",
            latencyMs: Date.now() - started,
            ...version === void 0 ? {} : { serverVersion: `Redis ${version}` }
          };
        } catch (error) {
          return { ok: false, latencyMs: Date.now() - started, error: describeRedisError(error) };
        }
      }
      async close() {
        for (const client of this.clients.values()) {
          try {
            client.disconnect();
          } catch {
          }
        }
        this.clients.clear();
      }
      async info() {
        return this.withDeadline(this.infoUnbounded(), this.deadlineMs(), "reading Redis server info");
      }
      /** The actual info read; callers go through {@link info} for the deadline. */
      async infoUnbounded() {
        const client = await this.client();
        const [server, memory, clients, keyspace] = await Promise.all([
          client.info("server").catch(() => ""),
          client.info("memory").catch(() => ""),
          client.info("clients").catch(() => ""),
          client.info("keyspace").catch(() => "")
        ]);
        const databases = [];
        for (const line of keyspace.split(/\r?\n/)) {
          const match = /^db(\d+):keys=(\d+),expires=(\d+)/.exec(line.trim());
          if (match !== null) {
            databases.push({ db: Number(match[1]), keys: Number(match[2]), expires: Number(match[3]) });
          }
        }
        databases.sort((a, b) => a.db - b.db);
        const version = readInfoField(server, "redis_version");
        const mode = readInfoField(server, "redis_mode");
        const uptime = readInfoField(server, "uptime_in_seconds");
        const usedMemory = readInfoField(memory, "used_memory_human");
        const connected = readInfoField(clients, "connected_clients");
        const current = databases.find((item) => item.db === (this.entry.db ?? 0));
        return {
          ...version === void 0 ? {} : { version },
          ...mode === void 0 ? {} : { mode },
          ...uptime === void 0 ? {} : { uptimeSeconds: Number(uptime) },
          ...usedMemory === void 0 ? {} : { usedMemoryHuman: usedMemory },
          ...connected === void 0 ? {} : { connectedClients: Number(connected) },
          ...current === void 0 ? {} : { totalKeys: current.keys },
          databases
        };
      }
      async keys(input) {
        return this.withDeadline(this.keysUnbounded(input), this.deadlineMs(), "scanning Redis keys");
      }
      /** The actual scan; callers go through {@link keys} for the deadline. */
      async keysUnbounded(input) {
        const client = await this.client(input.db);
        const pattern = input.pattern === "" ? "*" : input.pattern;
        const count = Math.max(10, Math.min(input.count, 2e3));
        const [cursor, found] = await client.scan(input.cursor === "" ? "0" : input.cursor, "MATCH", pattern, "COUNT", count);
        const keys = await Promise.all(
          found.map(async (key) => {
            const [type, ttl] = await Promise.all([
              client.type(key).catch(() => "unknown"),
              client.ttl(key).catch(() => -2)
            ]);
            return { key, type, ttl };
          })
        );
        return { keys, cursor: String(cursor) };
      }
      async value(key, db, limit) {
        return this.withDeadline(this.valueUnbounded(key, db, limit), this.deadlineMs(), `reading key "${key}"`);
      }
      /** The actual read; callers go through {@link value} for the deadline. */
      async valueUnbounded(key, db, limit) {
        const client = await this.client(db);
        const type = await client.type(key);
        const ttl = await client.ttl(key);
        const cap = Math.min(limit > 0 ? limit : MAX_ELEMENTS, MAX_ELEMENTS);
        const head = { key, type, ttl };
        switch (type) {
          case "string": {
            const value = await client.get(key);
            return { ...head, value: value ?? "" };
          }
          case "list": {
            const total = await client.call("LLEN", key).catch(() => 0);
            const items = await client.lrange(key, 0, cap - 1);
            return { ...head, items, ...Number(total) > cap ? { truncated: true } : {} };
          }
          case "set": {
            const total = await client.call("SCARD", key).catch(() => 0);
            const [cursor, items] = await client.call("SSCAN", key, "0", "COUNT", cap).then((result) => {
              const pair = result;
              return [pair[0], pair[1]];
            }).catch(() => ["0", []]);
            return {
              ...head,
              items,
              ...Number(total) > items.length || cursor !== "0" ? { truncated: true } : {}
            };
          }
          case "hash": {
            const total = await client.call("HLEN", key).catch(() => 0);
            const flat = await client.call("HSCAN", key, "0", "COUNT", cap).then((result) => {
              const pair = result;
              return pair[1];
            }).catch(() => []);
            const fields = [];
            for (let i = 0; i + 1 < flat.length; i += 2) fields.push({ field: flat[i], value: flat[i + 1] });
            return { ...head, fields, ...Number(total) > fields.length ? { truncated: true } : {} };
          }
          case "zset": {
            const total = await client.call("ZCARD", key).catch(() => 0);
            const flat = await client.zrange(key, 0, cap - 1, "WITHSCORES");
            const members = [];
            for (let i = 0; i + 1 < flat.length; i += 2) members.push({ member: flat[i], score: flat[i + 1] });
            return { ...head, members, ...Number(total) > members.length ? { truncated: true } : {} };
          }
          case "stream": {
            const raw = await client.xrange(key, "-", "+", "COUNT", cap).catch(() => []);
            const entries = (Array.isArray(raw) ? raw : []).map((entry) => {
              const [id, flat] = entry;
              const fields = [];
              for (let i = 0; i + 1 < flat.length; i += 2) fields.push({ field: flat[i], value: flat[i + 1] });
              return { id, fields };
            });
            return { ...head, entries, ...entries.length >= cap ? { truncated: true } : {} };
          }
          case "none":
            throw new Error(`key "${key}" does not exist`);
          default:
            return head;
        }
      }
      async command(args, db) {
        if (args.length === 0) throw new Error("a Redis command is required");
        return this.withDeadline(this.commandUnbounded(args, db), this.deadlineMs(), `running "${args[0]}"`);
      }
      /** The actual command; callers go through {@link command} for the deadline. */
      async commandUnbounded(args, db) {
        const client = await this.client(db);
        const started = Date.now();
        const [name2, ...rest] = args;
        const result = await client.call(name2, ...rest);
        return shapeRedisReply(result, Date.now() - started);
      }
      /**
       * Search one database for keys matching a Redis glob pattern.
       *
       * Runs `SCAN MATCH` on the server, so the pattern is Redis glob syntax and the
       * search sees every key in the database — including keys inside folders that
       * are not expanded in the tree. A client-side filter over already-loaded rows
       * can do neither, which is why a pattern like `jd:*` found nothing.
       *
       * The traversal runs to completion (a partial scan would silently omit
       * matches); {@link MAX_SEARCH_KEYS} caps the RESULT so a pattern like `*` on a
       * huge database cannot return millions of rows to the browser, and hitting it
       * is reported rather than passed off as the complete answer.
       *
       * @param pattern - Redis glob pattern; empty is treated as `*`.
       */
      async search(input) {
        return this.withDeadline(
          this.searchUnbounded(input),
          this.treeDeadlineMs(),
          "searching Redis keys",
          "the scan did not finish within the time budget. A pattern that matches many keys in a large remote database takes longer; try a more specific pattern or raise this data source's timeout setting."
        );
      }
      /** The actual search; callers go through {@link search} for the deadline. */
      async searchUnbounded(input) {
        const client = await this.client(input.db);
        const pattern = input.pattern === "" ? "*" : input.pattern;
        const names = [];
        let cursor = "0";
        let scanned = 0;
        let truncated = false;
        do {
          const [next, found] = await client.scan(cursor, "MATCH", pattern, "COUNT", TREE_SCAN_COUNT);
          cursor = String(next);
          scanned += found.length;
          for (const name2 of found) {
            names.push(name2);
            if (names.length >= MAX_SEARCH_KEYS) {
              truncated = true;
              break;
            }
          }
          if (truncated) break;
        } while (cursor !== "0");
        const keys = await this.describeKeys(client, names);
        keys.sort((a, b) => compareKeyNames(a.key, b.key));
        const dbSize = await client.dbsize().catch(() => scanned);
        return { keys, truncated, scanned, dbSize };
      }
      /**
       * Fold ONE bounded batch of the keyspace into ancestor counts, server-side.
       *
       * This is the primitive the keyspace index is built from, and it exists because
       * of a measured constraint: `SCAN MATCH p:*` still walks the whole keyspace, so
       * listing any level costs a full traversal — ~230 s and ~600 MiB of key names for
       * a 19.5M-key database. Folding the names into counts INSIDE the server collapses
       * that payload to a few bytes per batch (measured: ~0 KiB for 100k keys).
       *
       * Each call is bounded, and that bound is a deliberate safety limit rather than a
       * performance knob: Redis runs scripts on its single thread, so a call blocks
       * every other client for its whole duration (measured 271-708 ms at 100k keys).
       * The caller drives the cursor and chooses the batch, so the pause can be kept
       * small on a server that also serves live traffic.
       *
       * Returns `null` when the server rejects scripting (some managed offerings
       * disable EVAL), which lets the caller fall back to folding on the host.
       *
       * @param cursor - SCAN cursor to resume from; `'0'` starts a fresh walk.
       * @param batchKeys - how many matching keys this call may examine before returning.
       */
      async aggregateBatch(input) {
        const client = await this.client(input.db);
        let raw;
        try {
          raw = await client.eval(
            INDEX_AGGREGATE_SCRIPT,
            0,
            input.cursor,
            String(input.batchKeys),
            SEPARATOR,
            String(input.nameBudget)
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/unknown command|not supported|ERR unknown|NOPERM|disabled/i.test(message)) return null;
          throw error;
        }
        if (!Array.isArray(raw)) return null;
        const [next, visited, folderLines, directLines, leafLines] = raw;
        const folderDeltas = /* @__PURE__ */ new Map();
        for (const line of (folderLines ?? "").split("\n")) {
          if (line === "") continue;
          const tab = line.lastIndexOf("	");
          folderDeltas.set(line.slice(0, tab), Number(line.slice(tab + 1)));
        }
        const directCounts = /* @__PURE__ */ new Map();
        for (const line of (directLines ?? "").split("\n")) {
          if (line === "") continue;
          const tab = line.lastIndexOf("	");
          directCounts.set(line.slice(0, tab), Number(line.slice(tab + 1)));
        }
        const leaves = /* @__PURE__ */ new Map();
        for (const line of (leafLines ?? "").split("\n")) {
          if (line === "") continue;
          const tab = line.indexOf("	");
          const parent = line.slice(0, tab);
          const names = line.slice(tab + 1).split("");
          const held = leaves.get(parent);
          if (held === void 0) leaves.set(parent, names);
          else held.push(...names);
        }
        return { cursor: String(next), visited: Number(visited), folderDeltas, directCounts, leaves };
      }
      /** DBSIZE for one logical database, used to size the index and its progress bar. */
      async keyCount(db) {
        const client = await this.client(db);
        return client.dbsize().catch(() => 0);
      }
      /**
       * One folder level of one database — how the tree is built.
       *
       * The previous design scanned the WHOLE keyspace and grouped it in the
       * browser, which cannot work on a real dataset: a 480k-key database produced a
       * capped, incomplete tree, and fetching TYPE and TTL with one round trip per
       * key meant ~1M round trips before anything rendered.
       *
       * A level scan reads exactly one level. Its cost is one pass over the keys
       * under `prefix`, and only that level's immediate children cross the wire, so
       * a folder nobody opens is never read.
       *
       * The pass is inherently O(keys under the prefix) — Redis has no "list
       * distinct prefixes" command, so SCAN is the only way to discover sub-folders.
       * What is avoided is paying it per folder: the same pass yields both the
       * sub-folder set and each sub-folder's key count.
       *
       * @param prefix - folder path to list, '' for the database root.
       * @param withTypes - whether to fetch TYPE/TTL for this level's keys. The root
       *   level of a large database is all folders, so it usually needs none.
       */
      async level(input) {
        return this.withDeadline(
          this.levelUnbounded(input),
          this.treeDeadlineMs(),
          "scanning a key level",
          "the keyspace was too large to traverse within the time budget. Redis has no prefix index, so listing a level walks every key in the database. Try raising this data source's timeout setting, or open a narrower folder."
        );
      }
      /** The actual level scan; callers go through {@link level} for the deadline. */
      async levelUnbounded(input) {
        const client = await this.client(input.db);
        const prefix = input.prefix === "" ? "" : `${input.prefix}${SEPARATOR}`;
        const match = `${escapeGlob(prefix)}*`;
        const names = /* @__PURE__ */ new Set();
        let cursor = "0";
        do {
          const [next, found] = await client.scan(cursor, "MATCH", match, "COUNT", TREE_SCAN_COUNT);
          cursor = String(next);
          for (const name2 of found) {
            if (name2.slice(prefix.length) === "") continue;
            names.add(name2);
          }
        } while (cursor !== "0" && names.size < LEVEL_SCAN_KEY_BUDGET);
        const scannedKeys = names.size;
        const complete = cursor === "0";
        const countsApproximate = !complete;
        const counts = /* @__PURE__ */ new Map();
        const keysHere = [];
        for (const name2 of names) {
          const rest = name2.slice(prefix.length);
          const at = rest.indexOf(SEPARATOR);
          if (at === -1) keysHere.push(name2);
          else {
            const segment = rest.slice(0, at);
            counts.set(segment, (counts.get(segment) ?? 0) + 1);
          }
        }
        names.clear();
        let ownKeyPresent = false;
        if (input.prefix !== "") {
          ownKeyPresent = await client.type(input.prefix) !== "none";
        }
        const childFolders = [];
        for (const [segment, count] of counts) {
          const path = `${prefix}${segment}`;
          const own = await client.type(path);
          childFolders.push({ name: segment, path, keys: own === "none" ? count : count + 1 });
        }
        childFolders.sort((a, b) => compareKeyNames(a.name, b.name));
        const rows = [...keysHere];
        if (ownKeyPresent) rows.push(input.prefix);
        rows.sort(compareKeyNames);
        const keysAtLevel = rows.length;
        const shown = rows.length > MAX_LEVEL_KEYS_RETURNED ? rows.slice(0, MAX_LEVEL_KEYS_RETURNED) : rows;
        const keys = input.withTypes ? await this.describeKeys(client, shown) : shown.map((key) => ({ key, type: "unknown", ttl: -1 }));
        const dbSize = await client.dbsize().catch(() => 0);
        return {
          folders: childFolders,
          keys,
          // Two different ways this level can be short, and they are reported
          // separately so the UI can say which: the ROW list may be capped (rows were
          // withheld, `keysAtLevel` is exact), or the SCAN may have stopped early
          // (counts are lower bounds, `countsApproximate` is true).
          truncated: keysAtLevel > shown.length || countsApproximate,
          keysAtLevel,
          dbSize,
          countsApproximate,
          scannedKeys
        };
      }
      /**
       * Fetch TYPE and TTL for many keys in ONE round trip per batch.
       *
       * The per-key version cost two round trips per key, which is what made a large
       * level unusable. `pipeline()` sends the whole batch and reads the replies
       * together, so a 10k-key level costs two round trips per batch instead of 20k.
       */
      /**
       * Fetch TYPE and TTL for a list of keys, for a caller that has names but no client.
       *
       * The keyspace index route needs this: it holds key names (from the index) and
       * must add row metadata before rendering. It is a thin wrapper so the pipelining
       * rule stays in one place — one round trip per batch, never one per key.
       */
      async describeKeysPublic(db, names) {
        if (names.length === 0) return [];
        const client = await this.client(db);
        return this.describeKeys(client, names);
      }
      async describeKeys(client, names) {
        const out = [];
        for (let i = 0; i < names.length; i += TREE_PIPELINE_BATCH) {
          const slice = names.slice(i, i + TREE_PIPELINE_BATCH);
          const pipeline = client.pipeline();
          for (const name2 of slice) pipeline.type(name2);
          for (const name2 of slice) pipeline.ttl(name2);
          const replies = await pipeline.exec();
          const half = slice.length;
          for (let index = 0; index < half; index++) {
            const type = replyValue(replies[index]);
            const ttl = replyValue(replies[index + half]);
            out.push({
              key: slice[index],
              type: typeof type === "string" ? type : "unknown",
              // A key can vanish between the SCAN and this call; TYPE would then
              // report 'none'. -2 is Redis's own "key does not exist" TTL, which is
              // what the value view already renders.
              ttl: typeof ttl === "number" ? ttl : -2
            });
          }
        }
        return out;
      }
      /**
       * Every key in one database matching a pattern, for the folder tree.
       *
       * Retained for callers that genuinely need a whole-database view (the tests
       * use it to assert what a folder operation left behind). The TREE does not use
       * it: see {@link level}. Still capped, and still reports truncation.
       */
      async tree(input) {
        return this.withDeadline(
          this.treeUnbounded(input),
          this.treeDeadlineMs(),
          "scanning the key tree",
          "the keyspace was too large to traverse within the time budget. Try raising this data source's timeout setting."
        );
      }
      /** The actual tree scan; callers go through {@link tree} for the deadline. */
      async treeUnbounded(input) {
        const client = await this.client(input.db);
        const match = input.pattern === void 0 || input.pattern === "" ? "*" : input.pattern;
        const names = [];
        let cursor = "0";
        let truncated = false;
        do {
          const [next, found] = await client.scan(cursor, "MATCH", match, "COUNT", TREE_SCAN_COUNT);
          cursor = String(next);
          for (const name2 of found) {
            names.push(name2);
            if (names.length >= MAX_TREE_KEYS) {
              truncated = true;
              break;
            }
          }
          if (truncated) break;
        } while (cursor !== "0");
        const dbSize = await client.dbsize().catch(() => names.length);
        return { keys: await this.describeKeys(client, names), dbSize, truncated };
      }
      /**
       * Create one key, or report why it could not be.
       *
       * Refuses to overwrite: a create that silently replaced an existing key would
       * destroy data behind a dialog titled 新增. `type` is checked first so the
       * message names the real conflict rather than a type error.
       */
      async createKey(input, db) {
        return this.withDeadline(this.createKeyUnbounded(input, db), this.deadlineMs(), `creating "${input.key}"`);
      }
      /** The actual create; callers go through {@link createKey} for the deadline. */
      async createKeyUnbounded(input, db) {
        const client = await this.client(db);
        const { key, type } = input;
        if (key === "") throw new Error("key name is required");
        const existing = await client.type(key);
        if (existing !== "none") {
          throw new Error(`\u952E\u300C${key}\u300D\u5DF2\u5B58\u5728\uFF08\u7C7B\u578B ${existing}\uFF09\uFF1B\u8BF7\u6362\u4E00\u4E2A\u540D\u5B57\uFF0C\u6216\u5148\u5220\u9664\u5B83`);
        }
        switch (type) {
          case "string":
            await client.call("SET", key, input.value ?? "");
            break;
          case "list": {
            const items = input.items ?? [];
            if (items.length === 0) throw new Error(`\u300C${key}\u300D\u9700\u8981\u4E00\u4E2A\u5143\u7D20`);
            await client.call("RPUSH", key, ...items);
            break;
          }
          case "set": {
            const items = input.items ?? [];
            if (items.length === 0) throw new Error(`\u300C${key}\u300D\u9700\u8981\u4E00\u4E2A\u6210\u5458`);
            await client.call("SADD", key, ...items);
            break;
          }
          case "hash": {
            const fields = input.fields ?? [];
            if (fields.length === 0) throw new Error(`\u300C${key}\u300D\u9700\u8981\u4E00\u4E2A\u5B57\u6BB5`);
            await client.call("HSET", key, ...fields.flatMap((pair) => [pair.field, pair.value]));
            break;
          }
          case "zset": {
            const members = input.members ?? [];
            if (members.length === 0) throw new Error(`\u300C${key}\u300D\u9700\u8981\u4E00\u4E2A\u6210\u5458`);
            await client.call("ZADD", key, ...members.flatMap((pair) => [pair.score, pair.member]));
            break;
          }
          default: {
            const never = type;
            throw new Error(`unsupported key type: ${String(never)}`);
          }
        }
        if (input.ttl !== void 0 && input.ttl > 0) await client.call("EXPIRE", key, input.ttl);
      }
      /** Delete one key; returns whether it existed. */
      async deleteKey(key, db) {
        return this.withDeadline(this.deleteKeyUnbounded(key, db), this.deadlineMs(), `deleting "${key}"`);
      }
      /** The actual single-key delete; callers go through {@link deleteKey}. */
      async deleteKeyUnbounded(key, db) {
        const client = await this.client(db);
        const removed = await client.del(key);
        return removed > 0;
      }
      /**
       * Set a string key's value.
       *
       * The type is checked first: `SET` on a list would silently REPLACE the whole
       * key with a string, which is data loss behind a button labelled "save the
       * value". Refusing with the actual type is the only safe answer.
       */
      async setString(key, value, db) {
        return this.withDeadline(this.setStringUnbounded(key, value, db), this.deadlineMs(), `writing "${key}"`);
      }
      /** The actual string write; callers go through {@link setString}. */
      async setStringUnbounded(key, value, db) {
        const client = await this.client(db);
        const type = await client.type(key);
        if (type === "none") throw new Error(`\u952E\u300C${key}\u300D\u4E0D\u5B58\u5728`);
        if (type !== "string") {
          throw new Error(`\u952E\u300C${key}\u300D\u7684\u7C7B\u578B\u662F ${type}\uFF0C\u4E0D\u80FD\u7528\u5B57\u7B26\u4E32\u5199\u5165\uFF1B\u8BF7\u7528\u5143\u7D20\u7F16\u8F91\u6216\u547D\u4EE4\u884C`);
        }
        await client.call("SET", key, value, "KEEPTTL");
        return { affected: 1, ttl: await client.ttl(key), removed: false };
      }
      /**
       * Set or clear a key's TTL.
       *
       * `seconds <= 0` means "no expiry" and is applied with PERSIST, not
       * `EXPIRE 0` — the latter DELETES the key, which is a very different thing
       * from "make it permanent".
       */
      async setTtl(key, seconds, db) {
        return this.withDeadline(this.setTtlUnbounded(key, seconds, db), this.deadlineMs(), `setting the TTL of "${key}"`);
      }
      /** The actual TTL write; callers go through {@link setTtl}. */
      async setTtlUnbounded(key, seconds, db) {
        const client = await this.client(db);
        const type = await client.type(key);
        if (type === "none") throw new Error(`\u952E\u300C${key}\u300D\u4E0D\u5B58\u5728`);
        let affected;
        if (seconds <= 0) {
          await client.call("PERSIST", key);
          affected = 1;
        } else {
          const ok = await client.call("EXPIRE", key, Math.trunc(seconds));
          affected = Number(ok) === 1 ? 1 : 0;
          if (affected === 0) throw new Error(`\u952E\u300C${key}\u300D\u5728\u8BBE\u7F6E\u8FC7\u671F\u65F6\u95F4\u65F6\u5DF2\u4E0D\u5B58\u5728`);
        }
        return { affected, ttl: await client.ttl(key), removed: false };
      }
      /**
       * Apply one element edit to a collection key.
       *
       * Each op is checked against the key's real type before it runs, so a
       * mismatched edit names the problem instead of silently writing a second key
       * of a different type (Redis would create one on many write commands).
       */
      async editElement(key, edit, db) {
        return this.withDeadline(this.editElementUnbounded(key, edit, db), this.deadlineMs(), `editing "${key}"`);
      }
      /** The actual element edit; callers go through {@link editElement}. */
      async editElementUnbounded(key, edit, db) {
        const client = await this.client(db);
        const type = await client.type(key);
        if (type === "none") throw new Error(`\u952E\u300C${key}\u300D\u4E0D\u5B58\u5728`);
        const after = async (affected) => {
          const stillThere = await client.type(key);
          return {
            affected,
            ttl: stillThere === "none" ? -2 : await client.ttl(key),
            removed: stillThere === "none"
          };
        };
        switch (type) {
          case "list": {
            if (edit.op === "set") {
              if (edit.index === void 0) throw new Error("list \u5143\u7D20\u7F16\u8F91\u9700\u8981 index");
              const total = Number(await client.call("LLEN", key));
              if (edit.index < 0 || edit.index >= total) throw new Error(`\u4E0B\u6807 ${edit.index} \u8D85\u51FA\u8303\u56F4\uFF08\u5217\u8868\u957F\u5EA6 ${total}\uFF09`);
              await client.call("LSET", key, edit.index, edit.value ?? "");
              return after(1);
            }
            if (edit.op === "push") {
              await client.call("RPUSH", key, edit.value ?? "");
              return after(1);
            }
            if (edit.op === "delete") {
              if (edit.index === void 0) throw new Error("list \u5143\u7D20\u5220\u9664\u9700\u8981 index");
              const sentinel = `\0dbm-delete-${Date.now()}-${Math.random()}`;
              const total = Number(await client.call("LLEN", key));
              if (edit.index < 0 || edit.index >= total) throw new Error(`\u4E0B\u6807 ${edit.index} \u8D85\u51FA\u8303\u56F4\uFF08\u5217\u8868\u957F\u5EA6 ${total}\uFF09`);
              await client.call("LSET", key, edit.index, sentinel);
              const removed = Number(await client.call("LREM", key, 1, sentinel));
              return after(removed);
            }
            throw new Error(`list \u4E0D\u652F\u6301\u7684\u64CD\u4F5C\uFF1A${edit.op}`);
          }
          case "set": {
            if (edit.op === "add") {
              const added = Number(await client.call("SADD", key, edit.value ?? ""));
              return after(added);
            }
            if (edit.op === "delete") {
              if (edit.member === void 0) throw new Error("set \u6210\u5458\u5220\u9664\u9700\u8981 member");
              if (edit.value !== void 0 && edit.value !== edit.member) {
                await client.call("SREM", key, edit.member);
                const added = Number(await client.call("SADD", key, edit.value));
                return after(added);
              }
              const removed = Number(await client.call("SREM", key, edit.member));
              return after(removed);
            }
            throw new Error(`set \u4E0D\u652F\u6301\u7684\u64CD\u4F5C\uFF1A${edit.op}`);
          }
          case "hash": {
            if (edit.member === void 0 || edit.member === "") throw new Error("hash \u7F16\u8F91\u9700\u8981 field");
            if (edit.op === "set") {
              await client.call("HSET", key, edit.member, edit.value ?? "");
              return after(1);
            }
            if (edit.op === "delete") {
              const removed = Number(await client.call("HDEL", key, edit.member));
              return after(removed);
            }
            throw new Error(`hash \u4E0D\u652F\u6301\u7684\u64CD\u4F5C\uFF1A${edit.op}`);
          }
          case "zset": {
            if (edit.member === void 0 || edit.member === "") throw new Error("zset \u7F16\u8F91\u9700\u8981 member");
            if (edit.op === "set" || edit.op === "add") {
              const score = edit.value ?? "0";
              if (!Number.isFinite(Number(score))) throw new Error(`\u5206\u503C\u4E0D\u662F\u6570\u5B57\uFF1A${score}`);
              const added = Number(await client.call("ZADD", key, score, edit.member));
              return after(added);
            }
            if (edit.op === "delete") {
              const removed = Number(await client.call("ZREM", key, edit.member));
              return after(removed);
            }
            throw new Error(`zset \u4E0D\u652F\u6301\u7684\u64CD\u4F5C\uFF1A${edit.op}`);
          }
          default:
            throw new Error(`\u952E\u300C${key}\u300D\u7684\u7C7B\u578B\u662F ${type}\uFF0C\u4E0D\u652F\u6301\u5143\u7D20\u7F16\u8F91`);
        }
      }
      /**
       * Delete every key under one folder prefix.
       *
       * The scan runs HERE, immediately before the delete, for two reasons: the
       * browser's key list may be a capped or filtered view (deleting from it would
       * silently leave keys behind), and SCAN is not a snapshot, so the set must be
       * collected as close to the delete as possible.
       *
       * The traversal is re-run after each batch until the pattern is exhausted, so
       * a folder holding more keys than one scan pass returns is still fully
       * cleared; {@link MAX_DELETE_KEYS} is the sole ceiling and hitting it is
       * reported.
       */
      async deletePrefix(path, db) {
        return this.withDeadline(
          this.deletePrefixUnbounded(path, db),
          this.treeDeadlineMs(),
          `deleting folder "${path}"`,
          "the traversal did not finish within the time budget. The delete is bounded and batched, so some keys may already be gone; re-read the folder to see what remains before retrying."
        );
      }
      /** The actual prefix delete; callers go through {@link deletePrefix}. */
      async deletePrefixUnbounded(path, db) {
        const client = await this.client(db);
        let deleted = 0;
        const own = await client.del(path);
        deleted += own;
        const pattern = prefixPattern(path);
        const MAX_PASSES = 100;
        for (let pass = 0; pass < MAX_PASSES; pass++) {
          const [cursor, found] = await client.scan("0", "MATCH", pattern, "COUNT", TREE_SCAN_COUNT);
          if (found.length === 0) {
            if (cursor === "0") return { deleted, truncated: false };
            continue;
          }
          let removedThisPass = 0;
          for (let i = 0; i < found.length; i += DELETE_BATCH) {
            const batch = found.slice(i, i + DELETE_BATCH);
            if (deleted + batch.length > MAX_DELETE_KEYS) {
              const room = MAX_DELETE_KEYS - deleted;
              if (room > 0) deleted += await client.del(...batch.slice(0, room));
              return { deleted, truncated: true };
            }
            removedThisPass += await client.del(...batch);
          }
          deleted += removedThisPass;
          if (removedThisPass === 0) return { deleted, truncated: false };
        }
        return { deleted, truncated: true };
      }
      /** How many keys sit under one folder prefix (the delete dialog's warning). */
      async countPrefix(path, db) {
        return this.withDeadline(
          this.countPrefixUnbounded(path, db),
          this.treeDeadlineMs(),
          `counting folder "${path}"`,
          "the count walks every key under the folder and did not finish in time. Redis has no prefix index, so a folder this large cannot be counted quickly; raise this data source's timeout setting if the count is needed."
        );
      }
      /** The actual prefix count; callers go through {@link countPrefix}. */
      async countPrefixUnbounded(path, db) {
        const client = await this.client(db);
        let count = 0;
        for (const pattern of [keyPattern(path), prefixPattern(path)]) {
          let cursor = "0";
          do {
            const [next, found] = await client.scan(cursor, "MATCH", pattern, "COUNT", TREE_SCAN_COUNT);
            cursor = String(next);
            count += found.length;
            if (count > MAX_DELETE_KEYS) return count;
          } while (cursor !== "0");
        }
        return count;
      }
      /** The per-operation deadline for this data source. */
      deadlineMs() {
        return this.entry.connectTimeoutMs ?? DEFAULT_TIMEOUT_MS;
      }
      /**
       * The deadline for a whole-database traversal.
       *
       * A tree scan and a folder delete both walk the entire keyspace, which is
       * categorically slower than one command, so the per-operation budget would
       * abort a legitimate scan of a large database. This is a ceiling on a stalled
       * server, not an expectation.
       */
      treeDeadlineMs() {
        return Math.max(this.deadlineMs() * 3, 3e4);
      }
    };
    REDIS_READ_COMMANDS = [
      "get",
      "mget",
      "strlen",
      "exists",
      "type",
      "ttl",
      "pttl",
      "keys",
      "scan",
      "randomkey",
      "dump",
      "hget",
      "hmget",
      "hgetall",
      "hkeys",
      "hvals",
      "hlen",
      "hexists",
      "hscan",
      "hrandfield",
      "hstrlen",
      "lrange",
      "llen",
      "lindex",
      "lpos",
      "smembers",
      "scard",
      "sismember",
      "smismember",
      "srandmember",
      "sscan",
      "zrange",
      "zrangebyscore",
      "zrevrange",
      "zrevrangebyscore",
      "zrangebylex",
      "zcard",
      "zscore",
      "zmscore",
      "zcount",
      "zrank",
      "zrevrank",
      "zscan",
      "zrandmember",
      "zlexcount",
      "xrange",
      "xrevrange",
      "xlen",
      "xread",
      "xinfo",
      "bitcount",
      "bitpos",
      "getbit",
      "getrange",
      "pfcount",
      "geodist",
      "geohash",
      "geopos",
      "geosearch",
      "info",
      "dbsize",
      "ping",
      "echo",
      "time",
      "lastsave",
      "memory",
      "object",
      "command"
    ];
  }
});

// src/dsh-home.ts
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { isAbsolute as posixIsAbsolute, join as posixJoin } from "node:path/posix";
function expandHome(path, home = homedir()) {
  const isPosix = home.startsWith("/");
  const j = isPosix ? posixJoin : join;
  if (path === "~") return home;
  if (path.startsWith("~/") || path.startsWith("~\\")) return j(home, path.slice(2));
  return path;
}
function resolveDshHome(env = process.env, home = homedir()) {
  const isPosix = home.startsWith("/");
  const j = isPosix ? posixJoin : join;
  const isAbs = isPosix ? posixIsAbsolute : isAbsolute;
  const raw = env.DSH_HOME;
  if (raw !== void 0 && raw.trim() !== "") {
    const expanded = expandHome(raw.trim(), home);
    return isAbs(expanded) ? expanded : j(process.cwd(), expanded);
  }
  return j(home, ".dsh");
}
function dshHome() {
  return resolveDshHome();
}
var init_dsh_home = __esm({
  "src/dsh-home.ts"() {
    "use strict";
  }
});

// src/drivers/sqlite.ts
var sqlite_exports = {};
__export(sqlite_exports, {
  SqliteDriver: () => SqliteDriver,
  ensureSqliteParent: () => ensureSqliteParent,
  resolveSqliteFile: () => resolveSqliteFile,
  sqliteAvailable: () => sqliteAvailable,
  sqliteFileStatus: () => sqliteFileStatus
});
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute as isAbsolute2, resolve } from "node:path";
async function sqliteAvailable() {
  try {
    await loadSqlite();
    return true;
  } catch {
    return false;
  }
}
async function loadSqlite() {
  try {
    const specifier = "node:sqlite";
    const mod = await import(
      /* @vite-ignore */
      specifier
    );
    if (typeof mod.DatabaseSync !== "function") {
      throw new Error("node:sqlite does not expose DatabaseSync");
    }
    return mod;
  } catch (error) {
    throw new Error(
      `SQLite support requires the Node.js built-in "node:sqlite" (Node >= 22.5). This host cannot load it: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function resolveSqliteFile(file) {
  if (file === ":memory:") return file;
  const expanded = expandHome(file);
  return isAbsolute2(expanded) ? expanded : resolve(expanded);
}
function readTableRowCounts(db, schema) {
  const counts = /* @__PURE__ */ new Map();
  try {
    const rows = db.prepare(`SELECT tbl, stat FROM ${quoteSqlite(schema)}.sqlite_stat1`).all();
    for (const row of rows) {
      const table = row["tbl"];
      const first = typeof row["stat"] === "string" ? String(row["stat"]).trim().split(/\s+/)[0] : void 0;
      const count = first === void 0 ? Number.NaN : Number(first);
      if (typeof table === "string" && Number.isFinite(count) && count >= 0) counts.set(table, count);
    }
  } catch {
  }
  return counts;
}
function projectRow2(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) out[key] = toWireValue(value);
  return out;
}
function readTableSizes(db, schema) {
  const sizes = /* @__PURE__ */ new Map();
  try {
    const rows = db.prepare(
      "SELECT name, SUM(pgsize) AS bytes FROM dbstat WHERE schema = ? AND name NOT LIKE 'sqlite_%' GROUP BY name"
    ).all(schema);
    for (const row of rows) {
      const name2 = row["name"];
      const bytes = Number(row["bytes"] ?? 0);
      if (typeof name2 === "string" && Number.isFinite(bytes) && bytes > 0) sizes.set(name2, bytes);
    }
  } catch {
  }
  return sizes;
}
function sqliteFileStatus(file) {
  const path = resolveSqliteFile(file);
  if (path === ":memory:") return { exists: true };
  try {
    if (!existsSync(path)) return { exists: false };
    const stat = statSync(path);
    if (!stat.isFile()) return { exists: false, error: "path is not a regular file" };
    return { exists: true, size: stat.size };
  } catch (error) {
    return { exists: false, error: error instanceof Error ? error.message : String(error) };
  }
}
function ensureSqliteParent(file) {
  const path = resolveSqliteFile(file);
  if (path === ":memory:") return;
  mkdirSync(dirname(path), { recursive: true });
}
var SqliteDriver;
var init_sqlite = __esm({
  "src/drivers/sqlite.ts"() {
    "use strict";
    init_dsh_home();
    init_sql_util();
    SqliteDriver = class {
      kind = "sqlite";
      entry;
      db;
      /** Serializes statements so an interleaved transaction cannot corrupt. */
      queue = Promise.resolve();
      constructor(entry) {
        this.entry = entry;
      }
      /** Open (once) and return the connection. */
      async open() {
        if (this.db !== void 0) return this.db;
        const file = this.entry.file;
        if (file === void 0 || file.trim() === "") throw new Error("sqlite data source has no file configured");
        const path = resolveSqliteFile(file);
        if (path !== ":memory:") {
          const dir = dirname(path);
          if (!existsSync(dir)) {
            throw new Error(`the directory "${dir}" does not exist`);
          }
        }
        const { DatabaseSync } = await loadSqlite();
        const db = new DatabaseSync(path, { timeout: this.entry.connectTimeoutMs ?? 5e3 });
        try {
          db.exec("PRAGMA journal_mode = WAL");
        } catch {
        }
        db.exec("PRAGMA foreign_keys = ON");
        this.db = db;
        return db;
      }
      /** Run one unit of work on the serialization queue. */
      run(work) {
        const next = this.queue.then(async () => {
          const db = await this.open();
          return work(db);
        });
        this.queue = next.then(() => void 0, () => void 0);
        return next;
      }
      async test() {
        const started = Date.now();
        const file = this.entry.file ?? "";
        const existedBefore = file === ":memory:" || file === "" ? true : sqliteFileStatus(file).exists;
        try {
          const version = await this.run((db) => {
            const row = db.prepare("SELECT sqlite_version() AS v").get();
            return row?.v === void 0 ? void 0 : String(row.v);
          });
          return {
            ok: true,
            latencyMs: Date.now() - started,
            ...version === void 0 ? {} : { serverVersion: `SQLite ${version}` },
            ...existedBefore ? {} : { note: "the file did not exist and has been created" }
          };
        } catch (error) {
          return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
        }
      }
      async close() {
        const db = this.db;
        this.db = void 0;
        if (db === void 0) return;
        try {
          db.close();
        } catch {
        }
      }
      async schemas() {
        return this.run((db) => {
          const rows = db.prepare("PRAGMA database_list").all();
          return rows.filter((row) => typeof row.name === "string").map((row) => {
            const name2 = String(row.name);
            const file = typeof row.file === "string" && row.file !== "" ? row.file : void 0;
            return { name: name2, ...file === void 0 ? {} : { detail: file } };
          });
        });
      }
      async tables(schema, options) {
        const target = schema === void 0 || schema === "" ? "main" : schema;
        requireIdentifier(target, "schema name", quoteSqlite);
        const wantStats = options?.stats === true;
        return this.run((db) => {
          const statement = db.prepare(
            `SELECT name, type FROM ${quoteSqlite(target)}.sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name`
          );
          const rows = statement.all();
          const sizes = wantStats ? readTableSizes(db, target) : void 0;
          const counts = wantStats ? readTableRowCounts(db, target) : void 0;
          return rows.filter((row) => typeof row.name === "string").map((row) => {
            const name2 = String(row.name);
            const size = sizes?.get(name2);
            const count = counts?.get(name2);
            return {
              name: name2,
              type: row.type === "view" ? "view" : "table",
              ...size === void 0 ? {} : { size },
              ...count === void 0 ? {} : { rows: count }
            };
          });
        });
      }
      async columns(schema, table) {
        const target = schema === void 0 || schema === "" ? "main" : schema;
        const qualified = qualifySqlite(target === "main" ? void 0 : target, table);
        return this.run((db) => {
          const rows = db.prepare(`PRAGMA ${quoteSqlite(target)}.table_info(${quoteSqlite(table)})`).all();
          return rows.map((row) => {
            const name2 = String(row["name"] ?? "");
            const pk = Number(row["pk"] ?? 0);
            return {
              name: name2,
              type: String(row["type"] ?? ""),
              nullable: Number(row["notnull"] ?? 0) === 0,
              ...row["dflt_value"] === null || row["dflt_value"] === void 0 ? {} : { defaultValue: String(row["dflt_value"]) },
              key: pk > 0 ? "PRI" : "",
              extra: ""
            };
          });
        }).then(async (columns) => {
          if (columns.length === 0) {
            const exists = (await this.tables(target)).some((t) => t.name === table);
            if (!exists) throw new Error(`no such table: ${qualified}`);
          }
          return columns;
        });
      }
      async indexes(schema, table) {
        const target = schema === void 0 || schema === "" ? "main" : schema;
        requireIdentifier(target, "schema name", quoteSqlite);
        requireIdentifier(table, "table name", quoteSqlite);
        return this.run((db) => {
          const list = db.prepare(`PRAGMA ${quoteSqlite(target)}.index_list(${quoteSqlite(table)})`).all();
          return list.map((entry) => {
            const name2 = String(entry["name"] ?? "");
            let columns = [];
            try {
              const info = db.prepare(`PRAGMA ${quoteSqlite(target)}.index_info(${quoteSqlite(name2)})`).all();
              columns = info.sort((a, b) => Number(a["seqno"] ?? 0) - Number(b["seqno"] ?? 0)).map((row) => String(row["name"] ?? "")).filter((name3) => name3 !== "");
            } catch {
            }
            return {
              name: name2,
              unique: Number(entry["unique"] ?? 0) === 1,
              columns,
              type: String(entry["origin"] ?? "")
            };
          });
        });
      }
      async rows(query) {
        const schema = query.schema === void 0 || query.schema === "" ? "main" : query.schema;
        const columns = await this.columns(schema, query.table);
        if (columns.length === 0) throw new Error(`no such table: ${query.table}`);
        const known = new Set(columns.map((column) => column.name));
        const qualified = qualifySqlite(schema === "main" ? void 0 : schema, query.table);
        const { where, params } = this.buildFilter(query, columns.map((column) => column.name), known);
        const order = query.orderBy !== void 0 && known.has(query.orderBy) ? ` ORDER BY ${quoteSqlite(query.orderBy)} ${query.orderDir === "desc" ? "DESC" : "ASC"}` : "";
        const offset = Math.max(0, (query.page - 1) * query.pageSize);
        const total = await this.run((db) => {
          const row = db.prepare(`SELECT COUNT(*) AS n FROM ${qualified}${where}`).get(...params);
          return Number(row?.n ?? 0);
        });
        const rows = await this.run((db) => {
          const statement = db.prepare(`SELECT * FROM ${qualified}${where}${order} LIMIT ? OFFSET ?`);
          return statement.all(...params, query.pageSize, offset);
        });
        const primaryKey = columns.filter((column) => column.key === "PRI").map((column) => column.name);
        return {
          columns,
          rows: rows.map((row) => projectRow2(row)),
          total,
          page: query.page,
          pageSize: query.pageSize,
          primaryKey
        };
      }
      /** Build the WHERE clause and its bound parameters for a table read. */
      buildFilter(query, allColumns, known) {
        if (query.mode === "search") {
          const term = query.term ?? "";
          if (term === "") return { where: "", params: [] };
          const clauses = allColumns.map((column) => `CAST(${quoteSqlite(column)} AS TEXT) LIKE ?`);
          return { where: ` WHERE (${clauses.join(" OR ")})`, params: allColumns.map(() => `%${term}%`) };
        }
        if (query.condition !== void 0 && query.condition.trim() !== "") {
          assertSingleStatement(`SELECT 1 WHERE ${query.condition}`);
          return { where: ` WHERE (${query.condition})`, params: [] };
        }
        return { where: "", params: [] };
      }
      async query(sql, params, limit, schema) {
        assertSingleStatement(sql);
        if (!looksReadOnly(sql)) {
          throw new Error("only read-only statements (SELECT / WITH / PRAGMA / EXPLAIN) are allowed on this surface");
        }
        const pushed = limit >= 1 ? pushDownLimit(sql, limit + 1) : void 0;
        return this.exec(pushed ?? sql, params, schema, limit);
      }
      async exec(sql, params, schema, limit) {
        assertSingleStatement(sql);
        const target = schema === void 0 || schema === "" ? "main" : schema;
        requireIdentifier(target, "schema name", quoteSqlite);
        const started = Date.now();
        return this.run((db) => {
          if (target !== "main") db.exec(`PRAGMA ${quoteSqlite(target)}.query_only = OFF`);
          const capped = limit ?? 0;
          const statement = db.prepare(sql);
          let columns = [];
          try {
            columns = statement.columns().map((column) => column.name).filter((name2) => typeof name2 === "string" && name2 !== "");
          } catch {
            columns = [];
          }
          const isRead = columns.length > 0 || looksReadOnly(sql);
          if (isRead) {
            const raw = params.length === 0 ? statement.all() : statement.all(...params);
            const truncated = capped > 0 && raw.length > capped;
            const sliced = truncated ? raw.slice(0, capped) : raw;
            const rows = sliced;
            const projected = columns.length > 0 ? columns : rows.length > 0 ? Object.keys(rows[0]) : [];
            return {
              columns: projected,
              rows: rows.map((row) => projected.map((column) => toWireValue(row[column]))),
              affected: rows.length,
              durationMs: Date.now() - started,
              write: false,
              truncated
            };
          }
          const result = params.length === 0 ? statement.run() : statement.run(...params);
          return {
            columns: [],
            rows: [],
            affected: Number(result.changes ?? 0),
            durationMs: Date.now() - started,
            write: true,
            truncated: false
          };
        });
      }
      async insertRow(schema, table, values) {
        if (values.length === 0) throw new Error("insert requires at least one column value");
        const qualified = qualifySqlite(schema, table);
        const names = values.map((item) => requireIdentifier(item.column, "column name", quoteSqlite)).join(", ");
        const placeholders = values.map(() => "?").join(", ");
        const sql = `INSERT INTO ${qualified} (${names}) VALUES (${placeholders})`;
        const result = await this.exec(sql, values.map((item) => item.value), schema);
        return result;
      }
      async updateRow(schema, table, values, keys) {
        if (values.length === 0) throw new Error("update requires at least one column value");
        if (keys.length === 0) throw new Error("update requires a row key");
        const qualified = qualifySqlite(schema, table);
        const assignments = values.map((item) => `${requireIdentifier(item.column, "column name", quoteSqlite)} = ?`).join(", ");
        const where = keys.map((item) => `${requireIdentifier(item.column, "column name", quoteSqlite)} IS ?`).join(" AND ");
        const sql = `UPDATE ${qualified} SET ${assignments} WHERE ${where}`;
        const params = [...values.map((item) => item.value), ...keys.map((item) => item.value)];
        return this.exec(sql, params, schema);
      }
      async deleteRow(schema, table, keys) {
        if (keys.length === 0) throw new Error("delete requires a row key");
        const qualified = qualifySqlite(schema, table);
        const where = keys.map((item) => `${requireIdentifier(item.column, "column name", quoteSqlite)} IS ?`).join(" AND ");
        const sql = `DELETE FROM ${qualified} WHERE ${where}`;
        return this.exec(sql, keys.map((item) => item.value), schema);
      }
      /**
       * Empty a table, keeping its schema.
       *
       * SQLite has no TRUNCATE, so this is `DELETE FROM`. Two consequences the
       * caller should know about, and which are why this is not presented as a
       * TRUNCATE:
       *
       * - `sqlite_sequence` is NOT reset, so an AUTOINCREMENT column keeps counting
       *   up from where it was. Measured: two rows inserted, deleted, then the next
       *   insert got id 3. That is the documented SQLite behaviour and matches what
       *   `DELETE FROM` does in MySQL too, so it is left alone rather than papered
       *   over — silently resetting a primary key would break foreign references
       *   held elsewhere.
       * - It is a row-by-row delete, so it is slower than MySQL's TRUNCATE on a
       *   large table.
       */
      async truncateTable(schema, table, isView = false) {
        if (isView) throw new Error("a view has no rows of its own to delete");
        const qualified = qualifySqlite(schema, table);
        return this.exec(`DELETE FROM ${qualified}`, [], schema);
      }
      /**
       * Drop a table or a view.
       *
       * The object's kind decides the statement: SQLite refuses `DROP TABLE` on a
       * view ("use DROP VIEW to delete view v"), so collapsing both into one
       * DROP TABLE makes dropping a view fail with an engine error the user cannot
       * act on.
       */
      async dropTable(schema, table, isView = false) {
        const qualified = qualifySqlite(schema, table);
        return this.exec(`DROP ${isView ? "VIEW" : "TABLE"} ${qualified}`, [], schema);
      }
    };
  }
});

// src/index.ts
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/auth.ts
var READ_TOOLS = ["db_list", "db_schema", "db_query"];
var WRITE_TOOLS = ["db_exec"];
var OWNED_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];
var DEFAULT_GATE_SETTINGS = {
  allowAgentWrite: false,
  requireApproval: true
};
function isWriteTool(name2) {
  return WRITE_TOOLS.includes(name2);
}
function sourceIdOf(args) {
  if (typeof args !== "object" || args === null) return void 0;
  const record = args;
  for (const key of ["source", "sourceId", "id"]) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return void 0;
}
function decideCall(name2, args, store, settings) {
  if (!isWriteTool(name2)) return { kind: "pass" };
  const sourceId = sourceIdOf(args);
  if (sourceId === void 0) {
    return { kind: "deny", reason: `${name2} requires a "source" argument` };
  }
  const entry = store.find(sourceId);
  if (entry === void 0) {
    return { kind: "deny", reason: `no data source with id "${sourceId}"` };
  }
  if (entry.readonly) {
    return {
      kind: "deny",
      reason: `data source "${entry.name}" (${entry.id}) is marked readonly. Ask the user to clear the readonly flag in the \u6570\u636E\u5E93\u7BA1\u7406 panel before writing.`
    };
  }
  if (!settings.allowAgentWrite) {
    return {
      kind: "deny",
      reason: `agent writes are disabled for data source "${entry.name}" (${entry.id}). The user must enable \u201C\u5141\u8BB8 agent \u5199\u5165\u201D for the database panel (or use the GUI). Read-only tools (db_list / db_schema / db_query) remain available.`
    };
  }
  const target = entry.kind === "sqlite" ? entry.file ?? entry.id : `${entry.host ?? ""}:${entry.port ?? ""}`;
  return {
    kind: "ask",
    reason: `run a write against ${entry.kind} data source "${entry.name}" (${target})`
  };
}
function installGate(ctx, store, settings) {
  const context = ctx;
  const tools = context.get("tools");
  const disposeGuard = tools?.guard?.((exec) => {
    if (!isWriteTool(exec.name)) return void 0;
    const decision = decideCall(exec.name, exec.arguments, store, settings());
    return decision.kind === "deny" ? decision.reason : void 0;
  });
  const disposePre = context.on("tools/pre-execute", async (exec, next) => {
    if (!isWriteTool(exec.name)) return next();
    const current = settings();
    const decision = decideCall(exec.name, exec.arguments, store, current);
    if (decision.kind === "deny") {
      return next();
    }
    if (decision.kind === "ask" && current.requireApproval) {
      return { kind: "ask", reason: decision.reason };
    }
    return next();
  });
  return () => {
    disposePre();
    disposeGuard?.();
  };
}
function describePosture(settings) {
  if (!settings.allowAgentWrite) {
    return "\u5F53\u524D\u7B56\u7565\uFF1A\u53EA\u8BFB\uFF08agent \u5199\u5165\u88AB\u62D2\u7EDD\uFF1B\u7528\u6237\u9700\u5728\u300C\u6570\u636E\u5E93\u7BA1\u7406\u300D\u9762\u677F\u5F00\u542F\u201C\u5141\u8BB8 agent \u5199\u5165\u201D\uFF09\u3002";
  }
  return settings.requireApproval ? "\u5F53\u524D\u7B56\u7565\uFF1A\u53EF\u5199\uFF0C\u4F46\u6BCF\u6B21\u5199\u5165\u90FD\u4F1A\u5F39\u51FA\u5BA1\u6279\u6846\u7531\u7528\u6237\u786E\u8BA4\u3002" : "\u5F53\u524D\u7B56\u7565\uFF1A\u53EF\u5199\u4E14\u4E0D\u9700\u5BA1\u6279\uFF08\u7528\u6237\u5DF2\u663E\u5F0F\u5173\u95ED\u5BA1\u6279\uFF09\u3002";
}

// src/pool.ts
init_mysql();
init_redis();
init_sqlite();
var IDLE_TTL_MS = 30 * 60 * 1e3;
function fingerprintOf(entry) {
  return JSON.stringify([
    entry.kind,
    entry.file ?? "",
    entry.host ?? "",
    entry.port ?? 0,
    entry.user ?? "",
    entry.password ?? "",
    entry.db ?? 0,
    entry.tls === true,
    entry.connectTimeoutMs ?? 0
  ]);
}
function createDriver(entry) {
  switch (entry.kind) {
    case "sqlite":
      return new SqliteDriver(entry);
    case "mysql":
      return new MysqlDriver(entry);
    case "redis":
      return new RedisDriver(entry);
    default: {
      const never = entry.kind;
      throw new Error(`unsupported database kind: ${String(never)}`);
    }
  }
}
var ConnectionPool = class {
  store;
  entries = /* @__PURE__ */ new Map();
  constructor(store) {
    this.store = store;
  }
  /**
   * The live driver for one entry, connecting on first use.
   * @param entry - the stored record (already resolved by the caller).
   */
  acquire(entry) {
    const fingerprint = fingerprintOf(entry);
    const existing = this.entries.get(entry.id);
    if (existing !== void 0 && existing.fingerprint === fingerprint) {
      existing.lastUsed = Date.now();
      this.rearm(existing, entry.id);
      return existing.driver;
    }
    if (existing !== void 0) this.drop(entry.id);
    const driver = createDriver(entry);
    const record = { driver, fingerprint, lastUsed: Date.now(), dispose: void 0 };
    this.entries.set(entry.id, record);
    this.rearm(record, entry.id);
    return driver;
  }
  /** Resolve one entry by id from the store and hand out its driver. */
  acquireById(id) {
    const entry = this.store.find(id);
    if (entry === void 0) throw new Error(`no data source with id "${id}"`);
    return { entry, driver: this.acquire(entry) };
  }
  /**
   * Test a connection described by an UNSAVED payload, then dispose it.
   *
   * The driver is deliberately never pooled: its id may collide with the
   * stored entry the user is editing (that is the normal case), and pooling it
   * would swap the live connection out from under the open panel. The transient
   * driver is always closed, so a failed test cannot leak a socket.
   *
   * @param entry - a full entry built from the draft payload.
   */
  async testTransient(entry) {
    const driver = createDriver(entry);
    try {
      return await driver.test();
    } finally {
      await driver.close().catch(() => {
      });
    }
  }
  /** Arm (or re-arm) the idle release timer for one pooled driver. */
  rearm(record, id) {
    if (record.dispose !== void 0) clearTimeout(record.dispose);
    record.dispose = setTimeout(() => {
      this.drop(id);
    }, IDLE_TTL_MS);
    if (typeof record.dispose.unref === "function") record.dispose.unref();
  }
  /** Release and forget one driver. */
  drop(id) {
    const record = this.entries.get(id);
    if (record === void 0) return;
    this.entries.delete(id);
    if (record.dispose !== void 0) clearTimeout(record.dispose);
    void record.driver.close().catch(() => {
    });
  }
  /** Which data sources currently hold a live driver. */
  live() {
    return [...this.entries.keys()];
  }
  /** Release every driver (plugin shutdown). */
  dispose() {
    for (const id of [...this.entries.keys()]) this.drop(id);
  }
};
async function probeEngines() {
  const report = [];
  try {
    const { sqliteAvailable: sqliteAvailable2 } = await Promise.resolve().then(() => (init_sqlite(), sqlite_exports));
    report.push({ kind: "sqlite", available: await sqliteAvailable2() });
  } catch (error) {
    report.push({ kind: "sqlite", available: false, detail: error instanceof Error ? error.message : String(error) });
  }
  try {
    const { mysqlAvailable: mysqlAvailable2 } = await Promise.resolve().then(() => (init_mysql(), mysql_exports));
    report.push({ kind: "mysql", available: await mysqlAvailable2() });
  } catch (error) {
    report.push({ kind: "mysql", available: false, detail: error instanceof Error ? error.message : String(error) });
  }
  try {
    const { redisAvailable: redisAvailable2 } = await Promise.resolve().then(() => (init_redis(), redis_exports));
    report.push({ kind: "redis", available: await redisAvailable2() });
  } catch (error) {
    report.push({ kind: "redis", available: false, detail: error instanceof Error ? error.message : String(error) });
  }
  return report;
}

// src/store.ts
init_dsh_home();
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname as dirname2, join as join2, resolve as resolve2 } from "node:path";

// src/protocol.ts
var DB_KINDS = ["sqlite", "mysql", "redis"];
var REDIS_CREATABLE_TYPES = ["string", "list", "set", "hash", "zset"];
var DB_API_BASE = "/api/dsh-database";
var DB_API = {
  sources: DB_API_BASE + "/sources",
  test: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/test`,
  /**
   * Test an UNSAVED payload. Distinct from `test(id)`: nothing is written to the
   * store, so the dialog can verify a connection before the user commits.
   */
  testConnection: DB_API_BASE + "/test-connection",
  database: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/connect`,
  schemas: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/schemas${params === void 0 ? "" : "?" + params}`,
  tables: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/tables?${params}`,
  columns: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/columns?${params}`,
  indexes: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/indexes?${params}`,
  rows: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/rows`,
  row: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/row`,
  table: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/table`,
  query: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/query`,
  redisInfo: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/info`,
  redisKeys: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/keys?${params}`,
  redisValue: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/value?${params}`,
  redisCommand: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/command`,
  /** One database's whole key set for the folder tree. */
  redisTree: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/tree?${params}`,
  /** One folder level of one database (the tree's lazy-load endpoint). */
  redisLevel: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/level?${params}`,
  /** Search one database with a Redis glob pattern (server-side SCAN MATCH). */
  redisSearch: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/search?${params}`,
  /**
   * The cached keyspace index for one database: start a walk, read its progress, or
   * read one level of it. `/redis/index` (POST) begins or resumes; `/redis/index`
   * (DELETE) drops the cache after writes that cannot be applied incrementally.
   */
  redisIndex: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/index?${params}`,
  /** One indexed level: `/redis/index/level`. */
  redisIndexLevel: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/index/level?${params}`,
  /** What a walk would cost, before anything is scanned: `/redis/index/estimate`. */
  redisIndexEstimate: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/index/estimate?${params}`,
  /** Replace a string key's value. */
  redisString: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/string`,
  /** Set or clear a key's TTL. */
  redisTtl: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/ttl`,
  /** Add, change or remove one element of a collection key. */
  redisElement: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/element`,
  /** Create one or more keys. */
  redisCreate: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/key`,
  /** Delete one key (query param `key`) — DELETE on the same path as create. */
  redisDeleteKey: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/key?${params}`,
  /** Delete every key under one folder prefix. */
  redisDeletePrefix: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/prefix`,
  /** Count the keys under one folder prefix (the delete dialog's warning). */
  redisPrefixCount: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/prefix?${params}`
};

// src/store.ts
var FORMAT_VERSION = 1;
function storePath() {
  return join2(dshHome(), "dsh-database.json");
}
var DEFAULT_SETTINGS = { allowAgentWrite: false, requireApproval: true };
var ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
function isValidId(id) {
  return ID_RE.test(id);
}
function defaultPort(kind) {
  return kind === "mysql" ? 3306 : 6379;
}
function str(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed === "" ? void 0 : trimmed;
}
function strArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter((item) => item !== "");
}
function authKindOf(entry) {
  if (entry.kind === "sqlite") return "file";
  return entry.password !== void 0 && entry.password !== "" ? "password" : "none";
}
function summarize(entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    group: entry.group,
    tags: [...entry.tags],
    description: entry.description,
    ...entry.file === void 0 ? {} : { file: entry.file },
    ...entry.host === void 0 ? {} : { host: entry.host },
    ...entry.port === void 0 ? {} : { port: entry.port },
    ...entry.user === void 0 ? {} : { user: entry.user },
    ...entry.db === void 0 ? {} : { db: entry.db },
    ...entry.tls === void 0 ? {} : { tls: entry.tls },
    ...entry.connectTimeoutMs === void 0 ? {} : { connectTimeoutMs: entry.connectTimeoutMs },
    hasPassword: entry.password !== void 0 && entry.password !== "",
    auth: authKindOf(entry),
    readonly: entry.readonly === true,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}
function validatePayload(payload, existing) {
  const kind = payload.kind ?? existing?.kind;
  if (kind === void 0) return "kind is required";
  if (!DB_KINDS.includes(kind)) return `kind must be one of ${DB_KINDS.join(", ")}`;
  const file = payload.file ?? existing?.file;
  const host = payload.host ?? existing?.host;
  if (kind === "sqlite") {
    if (file === void 0 || file.trim() === "") return "file is required for sqlite";
  } else {
    if (host === void 0 || host.trim() === "") return "host is required";
    const port = payload.port ?? existing?.port ?? defaultPort(kind);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "port must be an integer in 1..65535";
  }
  if (kind === "mysql" && payload.user !== void 0 && typeof payload.user !== "string") {
    return "user must be a string";
  }
  if (payload.db !== void 0) {
    if (!Number.isInteger(payload.db) || payload.db < 0 || payload.db > 15) return "db must be an integer in 0..15";
    if (kind !== "redis") return "db is only valid for redis";
  }
  if (payload.tags !== void 0 && (!Array.isArray(payload.tags) || payload.tags.some((t) => typeof t !== "string"))) {
    return "tags must be an array of strings";
  }
  if (payload.connectTimeoutMs !== void 0 && (!Number.isInteger(payload.connectTimeoutMs) || payload.connectTimeoutMs < 1e3 || payload.connectTimeoutMs > 3e5)) {
    return "connectTimeoutMs must be an integer in 1000..300000";
  }
  return void 0;
}
function applyPayload(base, payload, kind, now) {
  const next = {
    ...base,
    kind,
    name: str(payload.name) ?? base.name,
    group: payload.group === void 0 ? base.group : str(payload.group) ?? "",
    tags: payload.tags === void 0 ? base.tags : strArray(payload.tags),
    description: payload.description === void 0 ? base.description : str(payload.description) ?? "",
    readonly: payload.readonly === void 0 ? base.readonly : payload.readonly === true,
    updatedAt: now
  };
  if (kind === "sqlite") {
    next.file = str(payload.file) ?? base.file;
    delete next.host;
    delete next.port;
    delete next.user;
    delete next.password;
    delete next.db;
    delete next.tls;
  } else if (kind === "mysql") {
    next.host = str(payload.host) ?? base.host;
    next.port = payload.port ?? base.port ?? defaultPort("mysql");
    next.user = payload.user === void 0 ? base.user : str(payload.user);
    next.tls = payload.tls === void 0 ? base.tls : payload.tls === true;
    if (payload.password !== void 0) next.password = payload.password === "" ? void 0 : payload.password;
    else next.password = base.password;
    delete next.file;
    delete next.db;
  } else {
    next.host = str(payload.host) ?? base.host;
    next.port = payload.port ?? base.port ?? defaultPort("redis");
    next.db = payload.db ?? base.db ?? 0;
    next.tls = payload.tls === void 0 ? base.tls : payload.tls === true;
    if (payload.password !== void 0) next.password = payload.password === "" ? void 0 : payload.password;
    else next.password = base.password;
    delete next.file;
    delete next.user;
  }
  if (payload.connectTimeoutMs !== void 0) next.connectTimeoutMs = payload.connectTimeoutMs;
  return next;
}
function blankEntry(kind, now) {
  return {
    id: "",
    kind,
    name: "",
    group: "",
    tags: [],
    description: "",
    readonly: false,
    createdAt: now,
    updatedAt: now
  };
}
function dropLegacyFields(entry) {
  const legacy = entry;
  if (legacy.database === void 0) return entry;
  delete legacy.database;
  return legacy;
}
var DataSourceStore = class {
  /** The JSON file path. */
  path;
  constructor(path) {
    this.path = resolve2(path ?? storePath());
  }
  /** Read the whole file, tolerating an absent or damaged one. */
  load() {
    if (!existsSync2(this.path)) return { version: FORMAT_VERSION, sources: [] };
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(this.path, "utf8"));
    } catch {
      return { version: FORMAT_VERSION, sources: [] };
    }
    if (typeof parsed !== "object" || parsed === null) return { version: FORMAT_VERSION, sources: [] };
    const file = parsed;
    return {
      version: typeof file.version === "number" ? file.version : FORMAT_VERSION,
      sources: Array.isArray(file.sources) ? file.sources.filter(isValidEntryShape).map(dropLegacyFields) : [],
      settings: file.settings
    };
  }
  /** Load all entries (empty store when the file is absent or unreadable). */
  list() {
    return this.load().sources;
  }
  /**
   * Build a full entry from an UNSAVED payload, for a connection test that must
   * not touch the store.
   *
   * On update, an omitted secret keeps the stored value — the browser never
   * receives passwords, so "test the form as it stands" has to resolve them
   * host-side. Without `baseId` there is nothing to inherit from and an omitted
   * password simply means "no password".
   *
   * @param payload - the draft payload from the dialog.
   * @param baseId - the entry being edited, when this is an update.
   */
  draftEntry(payload, baseId) {
    const base = baseId === void 0 ? void 0 : this.find(baseId);
    const kind = payload.kind ?? base?.kind ?? "sqlite";
    const problem = validatePayload(payload, base);
    if (problem !== void 0) throw new Error(problem);
    const now = Date.now();
    const id = base?.id ?? this.allocateId(payload, this.list());
    const seeded = base ?? { ...blankEntry(kind, now), id, name: (payload.name ?? id).trim() || id };
    const entry = applyPayload(seeded, payload, kind, now);
    if (entry.name.trim() === "") entry.name = entry.id;
    return entry;
  }
  /** The persisted settings, with defaults applied. */
  settings() {
    const raw = this.load().settings;
    return {
      allowAgentWrite: raw?.allowAgentWrite === true,
      requireApproval: raw?.requireApproval !== false
    };
  }
  /** Patch the persisted settings; omitted fields keep their stored value. */
  saveSettings(patch) {
    const file = this.load();
    const next = {
      allowAgentWrite: patch.allowAgentWrite ?? file.settings?.allowAgentWrite === true,
      requireApproval: patch.requireApproval ?? file.settings?.requireApproval !== false
    };
    this.writeFile({ ...file, settings: next });
    return next;
  }
  /** Find one entry by id. */
  find(id) {
    return this.list().find((entry) => entry.id === id);
  }
  /**
   * Build the id for a new entry: the payload's id when supplied and free,
   * otherwise a slug of the name with a numeric suffix on collision.
   */
  allocateId(payload, existing) {
    const taken = new Set(existing.map((entry) => entry.id));
    const requested = str(payload.id);
    if (requested !== void 0) {
      if (!isValidId(requested)) throw new Error("id must be letters, digits, dots, hyphens or underscores");
      if (taken.has(requested)) throw new Error(`id "${requested}" already exists`);
      return requested;
    }
    const seeded = (str(payload.name) ?? payload.kind ?? "db").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    const base = seeded === "" || !/^[a-z0-9]/.test(seeded) ? `db-${Date.now().toString(36)}` : seeded;
    if (!taken.has(base)) return base;
    for (let n = 2; n < 1e3; n++) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
  /** Create one entry; returns the stored record. */
  create(payload) {
    const existing = this.list();
    const kind = payload.kind ?? "sqlite";
    const problem = validatePayload(payload);
    if (problem !== void 0) throw new Error(problem);
    const now = Date.now();
    const id = this.allocateId(payload, existing);
    const entry = applyPayload({ ...blankEntry(kind, now), id, name: str(payload.name) ?? id }, payload, kind, now);
    if (entry.name.trim() === "") entry.name = entry.id;
    this.write([...existing, entry]);
    return entry;
  }
  /** Update one entry in place; returns the stored record. */
  update(id, payload) {
    const existing = this.list();
    const index = existing.findIndex((entry2) => entry2.id === id);
    if (index === -1) throw new Error(`no data source with id "${id}"`);
    const current = existing[index];
    const kind = payload.kind ?? current.kind;
    const problem = validatePayload(payload, current);
    if (problem !== void 0) throw new Error(problem);
    const now = Date.now();
    const entry = applyPayload(current, payload, kind, now);
    if (entry.name.trim() === "") entry.name = entry.id;
    const next = [...existing];
    next[index] = entry;
    this.write(next);
    return entry;
  }
  /** Remove one entry; returns whether it existed. */
  remove(id) {
    const existing = this.list();
    const next = existing.filter((entry) => entry.id !== id);
    if (next.length === existing.length) return false;
    this.write(next);
    return true;
  }
  /**
   * Atomically replace the store file, preserving its settings section. The
   * mode is pinned to 0600 on POSIX so the plaintext secrets inside are not
   * group/world readable.
   */
  write(sources) {
    this.writeFile({ ...this.load(), sources });
  }
  /** Atomically write one complete store file. */
  writeFile(file) {
    const payload = { version: FORMAT_VERSION, sources: file.sources, settings: file.settings ?? DEFAULT_SETTINGS };
    mkdirSync2(dirname2(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}
`, { encoding: "utf8", mode: 384 });
    renameSync(tmp, this.path);
  }
};
function isValidEntryShape(value) {
  if (typeof value !== "object" || value === null) return false;
  const entry = value;
  return typeof entry["id"] === "string" && entry["id"] !== "" && typeof entry["kind"] === "string" && DB_KINDS.includes(entry["kind"]) && typeof entry["name"] === "string";
}

// src/http.ts
var DEFAULT_JSON_BODY_MAX_BYTES = 1024 * 1024;
var JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store"
};
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readJsonBody(req, opts = {}) {
  const maxBytes = opts.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk;
    size += buffer.length;
    if (size > maxBytes) {
      req.destroy();
      return null;
    }
    chunks.push(buffer);
  }
  const text2 = Buffer.concat(chunks).toString("utf8");
  if (text2 === "") return null;
  try {
    return JSON.parse(text2);
  } catch {
    return null;
  }
}
function asJsonObject(value) {
  return isJsonObject(value) ? value : void 0;
}
function writeJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...JSON_HEADERS, ...headers });
  res.end(payload);
}
function writeError(res, status, message) {
  writeJson(res, status, { error: message });
}
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

// src/drivers/types.ts
function isSqlDriver(driver) {
  return driver.kind === "sqlite" || driver.kind === "mysql";
}
function isRedisDriver(driver) {
  return driver.kind === "redis";
}

// src/routes.ts
init_redis();

// src/redis-index.ts
init_redis_util();
var INDEX_KEYS_PER_LEVEL = 5e3;
var INDEX_MAX_FOLDERS = 2e5;
function createIndex(db, dbSize) {
  return {
    db,
    folders: /* @__PURE__ */ new Map([["", { name: "", path: "", parent: "", keys: 0 }]]),
    leaves: /* @__PURE__ */ new Map(),
    leafCounts: /* @__PURE__ */ new Map(),
    dbSize,
    visited: 0,
    cursor: "0",
    done: false,
    startedAt: Date.now(),
    updatedAt: Date.now()
  };
}
function keyParent(key) {
  const at = key.lastIndexOf(SEPARATOR);
  return at === -1 ? { parent: "", name: key } : { parent: key.slice(0, at), name: key.slice(at + 1) };
}
function joinKey(prefix, leaf) {
  return prefix === "" ? leaf : `${prefix}${SEPARATOR}${leaf}`;
}
function mergeBatch(index, batch) {
  for (const [path, delta] of batch.folderDeltas) {
    const existing = index.folders.get(path);
    if (existing === void 0) {
      if (index.folders.size >= INDEX_MAX_FOLDERS) continue;
      const at = path.lastIndexOf(SEPARATOR);
      index.folders.set(path, {
        name: at === -1 ? path : path.slice(at + 1),
        path,
        parent: at === -1 ? "" : path.slice(0, at),
        keys: delta
      });
    } else {
      existing.keys += delta;
    }
  }
  for (const [parent, count] of batch.directCounts) {
    index.leafCounts.set(parent, (index.leafCounts.get(parent) ?? 0) + count);
  }
  for (const [parent, names] of batch.leaves) {
    const held = index.leaves.get(parent);
    if (held === void 0) {
      index.leaves.set(parent, names.slice(0, INDEX_KEYS_PER_LEVEL));
    } else if (held.length < INDEX_KEYS_PER_LEVEL) {
      for (const name2 of names) {
        if (held.length >= INDEX_KEYS_PER_LEVEL) break;
        held.push(name2);
      }
    }
  }
  index.visited += batch.visited;
  index.updatedAt = Date.now();
  return index;
}
function isKeyAtIndex(index, path) {
  if (path === "") return false;
  const { parent, name: name2 } = keyParent(path);
  const names = index.leaves.get(parent);
  return names !== void 0 && names.includes(name2);
}
function levelFromIndex(index, prefix, compare) {
  const folders = [];
  for (const folder of index.folders.values()) {
    if (folder.parent !== prefix || folder.path === "") continue;
    folders.push({
      name: folder.name,
      path: folder.path,
      keys: folder.keys + (isKeyAtIndex(index, folder.path) ? 1 : 0)
    });
  }
  folders.sort((a, b) => compare(a.name, b.name));
  const keys = (index.leaves.get(prefix) ?? []).map((name2) => joinKey(prefix, name2));
  let keysAtLevel = index.leafCounts.get(prefix) ?? 0;
  if (prefix !== "" && isKeyAtIndex(index, prefix)) {
    keys.push(prefix);
    keysAtLevel += 1;
  }
  keys.sort(compare);
  return {
    folders,
    keys,
    keysAtLevel,
    partial: !index.done,
    // Only meaningful while the walk is unfinished; a finished index has covered
    // everything, so the UI shows no notice at all and these would be redundant.
    ...index.done ? {} : { visited: index.visited, dbSize: index.dbSize }
  };
}
function indexProgress(index) {
  return {
    db: index.db,
    dbSize: index.dbSize,
    visited: index.visited,
    folders: Math.max(index.folders.size - 1, 0),
    done: index.done,
    ...index.error === void 0 ? {} : { error: index.error }
  };
}
var INDEX_BATCH_KEYS = 2e4;
var INDEX_NAME_BUDGET_PER_CALL = 5e3;
async function advanceIndex(source, index) {
  if (index.done) return { progress: indexProgress(index), done: true };
  const batch = await source.aggregateBatch({
    db: index.db,
    cursor: index.cursor,
    batchKeys: INDEX_BATCH_KEYS,
    nameBudget: INDEX_NAME_BUDGET_PER_CALL
  });
  if (batch === null) {
    index.error = "this Redis server does not support scripting (EVAL), so a big database cannot be indexed quickly";
    return { progress: indexProgress(index), done: false };
  }
  mergeBatch(index, {
    folderDeltas: batch.folderDeltas,
    directCounts: batch.directCounts,
    leaves: batch.leaves,
    visited: batch.visited
  });
  index.cursor = batch.cursor;
  index.done = batch.cursor === "0";
  return { progress: indexProgress(index), done: index.done };
}
function estimateIndexCost(dbSize) {
  const KEYS_PER_SECOND = 37e4;
  const estimatedSeconds = Math.ceil(dbSize / KEYS_PER_SECOND);
  return { keys: dbSize, estimatedSeconds, isLarge: estimatedSeconds >= 15 };
}

// src/routes.ts
init_redis_util();
init_sql_util();
var DEFAULT_PAGE_SIZE = 200;
var MAX_PAGE_SIZE = 5e3;
var DEFAULT_SQL_LIMIT = 1e3;
var DEFAULT_KEY_COUNT = 200;
function queryParam(url, name2) {
  const value = url.searchParams.get(name2);
  return value === null || value === "" ? void 0 : value;
}
function queryInt(url, name2, fallback) {
  const raw = queryParam(url, name2);
  if (raw === void 0) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
function clampPageSize(value) {
  if (!Number.isFinite(value) || value < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.trunc(value), MAX_PAGE_SIZE);
}
function isWireScalar(value) {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
function readPairs(value, what) {
  if (!Array.isArray(value)) throw new Error(`${what} must be an array of { column, value }`);
  return value.map((item, index) => {
    const record = asJsonObject(item);
    if (record === void 0) throw new Error(`${what}[${index}] must be an object`);
    const column = record["column"];
    if (typeof column !== "string" || column === "") throw new Error(`${what}[${index}].column must be a non-empty string`);
    const cell = record["value"];
    if (!isWireScalar(cell)) throw new Error(`${what}[${index}].value must be a scalar`);
    return { column, value: cell };
  });
}
function readStringArray(value, what) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value)) throw new Error(`${what} must be an array of strings`);
  return value.map((item, index) => {
    if (typeof item !== "string") throw new Error(`${what}[${index}] must be a string`);
    return item;
  });
}
function isCreatableType(value) {
  return typeof value === "string" && REDIS_CREATABLE_TYPES.includes(value);
}
function parseElementEdit(body) {
  const rawOp = body["op"];
  if (rawOp !== "set" && rawOp !== "delete" && rawOp !== "push" && rawOp !== "add") {
    return { error: "op must be one of set, delete, push, add" };
  }
  let index;
  if (body["index"] !== void 0 && body["index"] !== null) {
    if (typeof body["index"] !== "number" || !Number.isInteger(body["index"]) || body["index"] < 0) {
      return { error: "index must be a non-negative integer" };
    }
    index = body["index"];
  }
  let member;
  if (body["member"] !== void 0 && body["member"] !== null) {
    if (typeof body["member"] !== "string") return { error: "member must be a string" };
    member = body["member"];
  }
  let value;
  if (body["value"] !== void 0 && body["value"] !== null) {
    if (typeof body["value"] !== "string") return { error: "value must be a string" };
    value = body["value"];
  }
  return {
    edit: {
      op: rawOp,
      ...index === void 0 ? {} : { index },
      ...member === void 0 ? {} : { member },
      ...value === void 0 ? {} : { value }
    }
  };
}
function parseCreateRequest(body) {
  const rawKeys = body["keys"];
  if (!Array.isArray(rawKeys) || rawKeys.length === 0) return { error: "keys must be a non-empty array" };
  if (rawKeys.length > 1e3) return { error: "too many keys in one request (max 1000)" };
  const keys = [];
  for (const [index, item] of rawKeys.entries()) {
    const record = asJsonObject(item);
    if (record === void 0) return { error: `keys[${index}] must be an object` };
    const key = typeof record["key"] === "string" ? record["key"] : "";
    if (key === "") return { error: `keys[${index}].key is required` };
    const rawType = record["type"];
    if (!isCreatableType(rawType)) {
      return { error: `keys[${index}].type must be one of ${REDIS_CREATABLE_TYPES.join(", ")}` };
    }
    const type = rawType;
    let ttl;
    if (record["ttl"] !== void 0 && record["ttl"] !== null) {
      if (typeof record["ttl"] !== "number" || !Number.isFinite(record["ttl"])) {
        return { error: `keys[${index}].ttl must be a number of seconds` };
      }
      if (record["ttl"] < 0) return { error: `keys[${index}].ttl cannot be negative` };
      if (record["ttl"] > 0) ttl = Math.trunc(record["ttl"]);
    }
    try {
      if (type === "string") {
        const value = record["value"];
        if (value !== void 0 && typeof value !== "string") return { error: `keys[${index}].value must be a string` };
        keys.push({ key, type, value: value ?? "", ...ttl === void 0 ? {} : { ttl } });
        continue;
      }
      if (type === "list" || type === "set") {
        const items = readStringArray(record["items"], `keys[${index}].items`);
        if (items === void 0 || items.length === 0) return { error: `keys[${index}].items must be a non-empty array for a ${type}` };
        keys.push({ key, type, items, ...ttl === void 0 ? {} : { ttl } });
        continue;
      }
      if (type === "hash") {
        const raw2 = record["fields"];
        if (!Array.isArray(raw2) || raw2.length === 0) return { error: `keys[${index}].fields must be a non-empty array for a hash` };
        const fields = [];
        for (const [position, entry] of raw2.entries()) {
          const pair = asJsonObject(entry);
          if (pair === void 0) return { error: `keys[${index}].fields[${position}] must be an object` };
          const field = pair["field"];
          const value = pair["value"];
          if (typeof field !== "string" || field === "") return { error: `keys[${index}].fields[${position}].field must be a non-empty string` };
          if (typeof value !== "string") return { error: `keys[${index}].fields[${position}].value must be a string` };
          fields.push({ field, value });
        }
        keys.push({ key, type, fields, ...ttl === void 0 ? {} : { ttl } });
        continue;
      }
      const raw = record["members"];
      if (!Array.isArray(raw) || raw.length === 0) return { error: `keys[${index}].members must be a non-empty array for a zset` };
      const members = [];
      for (const [position, entry] of raw.entries()) {
        const pair = asJsonObject(entry);
        if (pair === void 0) return { error: `keys[${index}].members[${position}] must be an object` };
        const member = pair["member"];
        const score = pair["score"];
        if (typeof member !== "string" || member === "") return { error: `keys[${index}].members[${position}].member must be a non-empty string` };
        if (typeof score !== "string" || score === "") return { error: `keys[${index}].members[${position}].score must be a string` };
        if (!Number.isFinite(Number(score))) return { error: `keys[${index}].members[${position}].score must be a number` };
        members.push({ member, score });
      }
      keys.push({ key, type, members, ...ttl === void 0 ? {} : { ttl } });
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }
  return { keys };
}
function makeRoutes(deps) {
  const { store, pool } = deps;
  const handler = async (req, res) => {
    let url;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      writeError(res, 400, "malformed request URL");
      return;
    }
    const path = url.pathname;
    const method = req.method ?? "GET";
    try {
      if (path === "/api/dsh-database/sources") {
        if (method === "GET") {
          writeJson(res, 200, {
            sources: store.list().map(summarize),
            settings: deps.gate()
          });
          return;
        }
        if (method === "POST") {
          const body = asJsonObject(await readJsonBody(req));
          if (body === void 0) {
            writeError(res, 400, "body must be a JSON object");
            return;
          }
          const payload = body;
          const problem = validatePayload(payload);
          if (problem !== void 0) {
            writeError(res, 400, problem);
            return;
          }
          const entry2 = store.create(payload);
          writeJson(res, 201, { source: summarize(entry2) });
          return;
        }
        writeError(res, 405, `${method} is not allowed on ${path}`);
        return;
      }
      if (path === "/api/dsh-database/test-connection") {
        if (method !== "POST") {
          writeError(res, 405, `${method} is not allowed on ${path}`);
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const baseId = typeof body["baseId"] === "string" && body["baseId"] !== "" ? body["baseId"] : void 0;
        let entry2;
        try {
          entry2 = store.draftEntry(body, baseId);
        } catch (error) {
          writeJson(res, 200, { result: { ok: false, error: errorMessage(error) } });
          return;
        }
        writeJson(res, 200, { result: await pool.testTransient(entry2) });
        return;
      }
      if (path === "/api/dsh-database/engines") {
        if (method !== "GET") {
          writeError(res, 405, `${method} is not allowed on ${path}`);
          return;
        }
        writeJson(res, 200, { engines: await probeEngines() });
        return;
      }
      if (path === "/api/dsh-database/settings") {
        if (method === "GET") {
          writeJson(res, 200, { settings: deps.gate() });
          return;
        }
        if (method === "PATCH" || method === "POST") {
          const body = asJsonObject(await readJsonBody(req));
          if (body === void 0) {
            writeError(res, 400, "body must be a JSON object");
            return;
          }
          const patch = {};
          if (typeof body["allowAgentWrite"] === "boolean") patch.allowAgentWrite = body["allowAgentWrite"];
          if (typeof body["requireApproval"] === "boolean") patch.requireApproval = body["requireApproval"];
          writeJson(res, 200, { settings: deps.saveGate(patch) });
          return;
        }
        writeError(res, 405, `${method} is not allowed on ${path}`);
        return;
      }
      const match = /^\/api\/dsh-database\/sources\/([^/]+)(?:\/(.+))?$/.exec(path);
      if (match === null) {
        writeError(res, 404, `no route for ${path}`);
        return;
      }
      const id = decodeURIComponent(match[1]);
      const action = match[2] ?? "";
      if (action === "") {
        if (method === "GET") {
          const entry2 = store.find(id);
          if (entry2 === void 0) {
            writeError(res, 404, `no data source with id "${id}"`);
            return;
          }
          writeJson(res, 200, { source: summarize(entry2) });
          return;
        }
        if (method === "PATCH" || method === "PUT") {
          const body = asJsonObject(await readJsonBody(req));
          if (body === void 0) {
            writeError(res, 400, "body must be a JSON object");
            return;
          }
          pool.drop(id);
          const entry2 = store.update(id, body);
          writeJson(res, 200, { source: summarize(entry2) });
          return;
        }
        if (method === "DELETE") {
          pool.drop(id);
          const removed = store.remove(id);
          if (!removed) {
            writeError(res, 404, `no data source with id "${id}"`);
            return;
          }
          writeJson(res, 200, { removed: true });
          return;
        }
        writeError(res, 405, `${method} is not allowed on ${path}`);
        return;
      }
      if (action === "test" && method === "POST") {
        const entry2 = store.find(id);
        if (entry2 === void 0) {
          writeError(res, 404, `no data source with id "${id}"`);
          return;
        }
        const driver2 = pool.acquire(entry2);
        writeJson(res, 200, { result: await driver2.test() });
        return;
      }
      if (action === "connect" && method === "POST") {
        const entry2 = store.find(id);
        if (entry2 === void 0) {
          writeError(res, 404, `no data source with id "${id}"`);
          return;
        }
        const driver2 = pool.acquire(entry2);
        const result = await driver2.test();
        if (!result.ok) {
          writeJson(res, 200, { ok: false, result });
          return;
        }
        writeJson(res, 200, {
          ok: true,
          result,
          source: summarize(entry2),
          ...isRedisDriver(driver2) ? { redis: await driver2.info() } : {},
          ...isSqlDriver(driver2) ? { schemas: await driver2.schemas() } : {}
        });
        return;
      }
      const entry = store.find(id);
      if (entry === void 0) {
        writeError(res, 404, `no data source with id "${id}"`);
        return;
      }
      const driver = pool.acquire(entry);
      if (action === "schemas" && method === "GET") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "schemas is only available for SQL data sources");
          return;
        }
        writeJson(res, 200, { schemas: await driver.schemas() });
        return;
      }
      if (action === "tables" && method === "GET") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "tables is only available for SQL data sources");
          return;
        }
        const schema = queryParam(url, "schema");
        const stats = queryParam(url, "stats") === "1";
        writeJson(res, 200, { tables: await driver.tables(schema, { stats }) });
        return;
      }
      if (action === "columns" && method === "GET") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "columns is only available for SQL data sources");
          return;
        }
        const table = queryParam(url, "table");
        if (table === void 0) {
          writeError(res, 400, "table is required");
          return;
        }
        writeJson(res, 200, { columns: await driver.columns(queryParam(url, "schema"), table) });
        return;
      }
      if (action === "indexes" && method === "GET") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "indexes is only available for SQL data sources");
          return;
        }
        const table = queryParam(url, "table");
        if (table === void 0) {
          writeError(res, 400, "table is required");
          return;
        }
        writeJson(res, 200, { indexes: await driver.indexes(queryParam(url, "schema"), table) });
        return;
      }
      if (action === "rows") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "rows is only available for SQL data sources");
          return;
        }
        if (method === "GET") {
          const table = queryParam(url, "table");
          if (table === void 0) {
            writeError(res, 400, "table is required");
            return;
          }
          const mode = queryParam(url, "mode");
          const page = await driver.rows({
            ...queryParam(url, "schema") === void 0 ? {} : { schema: queryParam(url, "schema") },
            table,
            page: Math.max(1, queryInt(url, "page", 1)),
            pageSize: clampPageSize(queryInt(url, "pageSize", DEFAULT_PAGE_SIZE)),
            ...queryParam(url, "orderBy") === void 0 ? {} : { orderBy: queryParam(url, "orderBy") },
            ...queryParam(url, "orderDir") === "desc" ? { orderDir: "desc" } : {},
            mode: mode === "search" ? "search" : "browse",
            ...queryParam(url, "term") === void 0 ? {} : { term: queryParam(url, "term") },
            ...queryParam(url, "condition") === void 0 ? {} : { condition: queryParam(url, "condition") }
          });
          writeJson(res, 200, { page });
          return;
        }
        writeError(res, 405, `${method} is not allowed on ${path}`);
        return;
      }
      if (action === "row") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "row is only available for SQL data sources");
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const table = typeof body["table"] === "string" ? body["table"] : void 0;
        if (table === void 0 || table === "") {
          writeError(res, 400, "table is required");
          return;
        }
        const schema = typeof body["schema"] === "string" && body["schema"] !== "" ? body["schema"] : void 0;
        if (method === "POST") {
          const values = readPairs(body["values"], "values");
          writeJson(res, 200, { result: await driver.insertRow(schema, table, values) });
          return;
        }
        const keys = readPairs(body["keys"], "keys");
        if (method === "PATCH" || method === "PUT") {
          const values = readPairs(body["values"], "values");
          writeJson(res, 200, { result: await driver.updateRow(schema, table, values, keys) });
          return;
        }
        if (method === "DELETE") {
          writeJson(res, 200, { result: await driver.deleteRow(schema, table, keys) });
          return;
        }
        writeError(res, 405, `${method} is not allowed on ${path}`);
        return;
      }
      if (action === "table") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "table is only available for SQL data sources");
          return;
        }
        if (method !== "POST") {
          writeError(res, 405, `${method} is not allowed on ${path}`);
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const table = typeof body["table"] === "string" ? body["table"] : void 0;
        if (table === void 0 || table === "") {
          writeError(res, 400, "table is required");
          return;
        }
        const schema = typeof body["schema"] === "string" && body["schema"] !== "" ? body["schema"] : void 0;
        const isView = body["isView"] === true;
        const op = body["op"];
        if (op === "truncate") {
          writeJson(res, 200, { result: await driver.truncateTable(schema, table, isView) });
          return;
        }
        if (op === "drop") {
          writeJson(res, 200, { result: await driver.dropTable(schema, table, isView) });
          return;
        }
        writeError(res, 400, 'op must be "truncate" or "drop"');
        return;
      }
      if (action === "query") {
        if (method !== "POST") {
          writeError(res, 405, `${method} is not allowed on ${path}`);
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const sql = typeof body["sql"] === "string" ? body["sql"] : void 0;
        if (sql === void 0 || sql.trim() === "") {
          writeError(res, 400, "sql is required");
          return;
        }
        const params = Array.isArray(body["params"]) ? body["params"].filter(isWireScalar) : [];
        const limit = clampPageSize(typeof body["limit"] === "number" ? body["limit"] : DEFAULT_SQL_LIMIT);
        const schema = typeof body["schema"] === "string" && body["schema"] !== "" ? body["schema"] : void 0;
        const allowWrite = body["allowWrite"] === true;
        if (isRedisDriver(driver)) {
          if (!allowWrite) {
            writeError(res, 400, "use the redis/command route for Redis");
            return;
          }
        }
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "query is only available for SQL data sources");
          return;
        }
        const result = allowWrite ? await driver.exec(sql, params, schema) : await driver.query(sql, params, limit, schema);
        writeJson(res, 200, { result });
        return;
      }
      if (action === "redis/info" && method === "GET") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/info is only available for Redis data sources");
          return;
        }
        writeJson(res, 200, { info: await driver.info() });
        return;
      }
      if (action === "redis/keys" && method === "GET") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/keys is only available for Redis data sources");
          return;
        }
        const page = await driver.keys({
          pattern: queryParam(url, "pattern") ?? "*",
          cursor: queryParam(url, "cursor") ?? "0",
          count: queryInt(url, "count", DEFAULT_KEY_COUNT),
          db: queryInt(url, "db", entry.db ?? 0)
        });
        writeJson(res, 200, { page });
        return;
      }
      if (action === "redis/search" && method === "GET") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/search is only available for Redis data sources");
          return;
        }
        const pattern = queryParam(url, "pattern");
        if (pattern === void 0) {
          writeError(res, 400, "pattern is required");
          return;
        }
        const page = await driver.search({
          db: queryInt(url, "db", entry.db ?? 0),
          pattern
        });
        writeJson(res, 200, { page });
        return;
      }
      if (action === "redis/value" && method === "GET") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/value is only available for Redis data sources");
          return;
        }
        const key = queryParam(url, "key");
        if (key === void 0) {
          writeError(res, 400, "key is required");
          return;
        }
        const value = await driver.value(key, queryInt(url, "db", entry.db ?? 0), queryInt(url, "limit", 1e3));
        writeJson(res, 200, { value });
        return;
      }
      if (action === "redis/command" && method === "POST") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/command is only available for Redis data sources");
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const args = Array.isArray(body["args"]) ? body["args"].filter((item) => typeof item === "string") : [];
        if (args.length === 0) {
          writeError(res, 400, "args must be a non-empty array of strings");
          return;
        }
        const allowWrite = body["allowWrite"] === true;
        if (!allowWrite && !isRedisReadCommand(args[0])) {
          writeError(res, 403, `"${args[0]}" is a write command; tick \u5141\u8BB8\u5199\u5165 in the console to run it`);
          return;
        }
        writeJson(res, 200, { result: await driver.command(args, queryInt(url, "db", entry.db ?? 0)) });
        return;
      }
      if (action === "redis/tree" && method === "GET") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/tree is only available for Redis data sources");
          return;
        }
        const page = await driver.tree({
          db: queryInt(url, "db", entry.db ?? 0),
          ...queryParam(url, "pattern") === void 0 ? {} : { pattern: queryParam(url, "pattern") }
        });
        writeJson(res, 200, { page });
        return;
      }
      if (action === "redis/index/estimate" && method === "GET") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/index/estimate is only available for Redis data sources");
          return;
        }
        const db = queryInt(url, "db", entry.db ?? 0);
        const dbSize = await driver.keyCount(db);
        writeJson(res, 200, { estimate: estimateIndexCost(dbSize) });
        return;
      }
      if (action === "redis/index/level" && method === "GET") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/index/level is only available for Redis data sources");
          return;
        }
        const db = queryInt(url, "db", entry.db ?? 0);
        const prefix = queryParam(url, "prefix") ?? "";
        const index = deps.indexes?.get(id, db);
        if (index === void 0) {
          writeError(res, 409, "no index has been built for this database yet");
          return;
        }
        const level = levelFromIndex(index, prefix, compareKeyNames);
        const keys = queryParam(url, "withTypes") === "0" ? level.keys.map((key) => ({ key, type: "unknown", ttl: -1 })) : await driver.describeKeysPublic(db, level.keys);
        writeJson(res, 200, {
          level: {
            folders: level.folders,
            keys,
            keysAtLevel: level.keysAtLevel,
            partial: level.partial,
            // Present only for an unfinished walk; the UI's "counts are lower
            // bounds" notice needs them to state how much was covered.
            visited: level.visited,
            dbSize: level.dbSize
          }
        });
        return;
      }
      if (action === "redis/index") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/index is only available for Redis data sources");
          return;
        }
        const db = queryInt(url, "db", entry.db ?? 0);
        if (method === "DELETE") {
          deps.indexes?.invalidate(id, db);
          writeJson(res, 200, { invalidated: true });
          return;
        }
        if (method !== "GET") {
          writeError(res, 405, `${method} is not allowed on ${path}`);
          return;
        }
        const indexes = deps.indexes;
        if (indexes === void 0) {
          writeError(res, 503, "keyspace indexing is not available in this host");
          return;
        }
        const dbSize = await driver.keyCount(db);
        const index = await indexes.start(id, db, dbSize);
        writeJson(res, 200, { status: indexProgress(index) });
        return;
      }
      if (action === "redis/level" && method === "GET") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/level is only available for Redis data sources");
          return;
        }
        const page = await driver.level({
          db: queryInt(url, "db", entry.db ?? 0),
          prefix: queryParam(url, "prefix") ?? "",
          // Fetching TYPE/TTL costs a round trip per batch; a caller that only
          // wants the folder shape (the root of a huge database) can skip it.
          withTypes: queryParam(url, "withTypes") !== "0"
        });
        writeJson(res, 200, { page });
        return;
      }
      if (action === "redis/string" && method === "POST") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/string is only available for Redis data sources");
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const key = typeof body["key"] === "string" && body["key"] !== "" ? body["key"] : void 0;
        if (key === void 0) {
          writeError(res, 400, "key is required");
          return;
        }
        if (typeof body["value"] !== "string") {
          writeError(res, 400, "value must be a string");
          return;
        }
        const result = await driver.setString(key, body["value"], queryInt(url, "db", entry.db ?? 0));
        writeJson(res, 200, { result });
        return;
      }
      if (action === "redis/ttl" && method === "POST") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/ttl is only available for Redis data sources");
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const key = typeof body["key"] === "string" && body["key"] !== "" ? body["key"] : void 0;
        if (key === void 0) {
          writeError(res, 400, "key is required");
          return;
        }
        let seconds;
        if (body["ttl"] === null || body["ttl"] === void 0) seconds = -1;
        else if (typeof body["ttl"] === "number" && Number.isFinite(body["ttl"])) seconds = body["ttl"];
        else {
          writeError(res, 400, "ttl must be a number of seconds, or null for no expiry");
          return;
        }
        const result = await driver.setTtl(key, seconds, queryInt(url, "db", entry.db ?? 0));
        writeJson(res, 200, { result });
        return;
      }
      if (action === "redis/element" && method === "POST") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/element is only available for Redis data sources");
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const key = typeof body["key"] === "string" && body["key"] !== "" ? body["key"] : void 0;
        if (key === void 0) {
          writeError(res, 400, "key is required");
          return;
        }
        const edit = parseElementEdit(body);
        if ("error" in edit) {
          writeError(res, 400, edit.error);
          return;
        }
        const result = await driver.editElement(key, edit.edit, queryInt(url, "db", entry.db ?? 0));
        writeJson(res, 200, { result });
        return;
      }
      if (action === "redis/key") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/key is only available for Redis data sources");
          return;
        }
        const db = queryInt(url, "db", entry.db ?? 0);
        if (method === "POST") {
          const body = asJsonObject(await readJsonBody(req));
          if (body === void 0) {
            writeError(res, 400, "body must be a JSON object");
            return;
          }
          const parsed = parseCreateRequest(body);
          if ("error" in parsed) {
            writeError(res, 400, parsed.error);
            return;
          }
          const created = [];
          for (const candidate of parsed.keys) {
            await driver.createKey(candidate, db);
            created.push(candidate.key);
          }
          writeJson(res, 201, { created });
          return;
        }
        if (method === "DELETE") {
          const key = queryParam(url, "key");
          if (key === void 0) {
            writeError(res, 400, "key is required");
            return;
          }
          writeJson(res, 200, { removed: await driver.deleteKey(key, db) });
          return;
        }
        writeError(res, 405, `${method} is not allowed on ${path}`);
        return;
      }
      if (action === "redis/prefix") {
        if (!isRedisDriver(driver)) {
          writeError(res, 400, "redis/prefix is only available for Redis data sources");
          return;
        }
        const prefix = queryParam(url, "prefix");
        if (prefix === void 0) {
          writeError(res, 400, "prefix is required");
          return;
        }
        const db = queryInt(url, "db", entry.db ?? 0);
        if (method === "GET") {
          writeJson(res, 200, { count: await driver.countPrefix(prefix, db) });
          return;
        }
        if (method === "DELETE") {
          writeJson(res, 200, { result: await driver.deletePrefix(prefix, db) });
          return;
        }
        writeError(res, 405, `${method} is not allowed on ${path}`);
        return;
      }
      writeError(res, 404, `no route for ${path}`);
    } catch (error) {
      writeError(res, 500, errorMessage(error));
    }
  };
  const routes = [
    { kind: "prefix", path: "/api/dsh-database", handler }
  ];
  return { routes, upgrade: void 0 };
}

// src/tools.ts
init_redis();
init_sql_util();
function text(value) {
  return [{ type: "text", text: value }];
}
function renderResult(result, maxRows = 200) {
  const head = result.write ? `[write] ${result.affected} row(s) affected in ${result.durationMs} ms` : `[read] ${result.rows.length} row(s) in ${result.durationMs} ms${result.truncated ? " (truncated)" : ""}`;
  if (result.columns.length === 0) return head;
  const shown = result.rows.slice(0, maxRows);
  const cells = shown.map((row) => row.map((cell) => cell === null ? "NULL" : String(cell)));
  const widths = result.columns.map((column, index) => {
    let width = column.length;
    for (const row of cells) width = Math.max(width, (row[index] ?? "").length);
    return Math.min(width, 60);
  });
  const line = (values) => values.map((value, index) => pad(value, widths[index] ?? value.length)).join(" | ");
  const lines = [head, line(result.columns), widths.map((width) => "-".repeat(width)).join("-+-")];
  for (const row of cells) lines.push(line(row.map((value) => truncate(value, 60))));
  if (result.rows.length > shown.length) lines.push(`\u2026 ${result.rows.length - shown.length} more row(s) omitted`);
  return lines.join("\n");
}
function pad(value, width) {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}
function truncate(value, width) {
  return value.length <= width ? value : `${value.slice(0, width - 1)}\u2026`;
}
function renderSources(sources) {
  if (sources.length === 0) return "no data sources configured";
  const header = "id | kind | name | group | host/file | user | auth | tags | readonly";
  const divider = "--- | --- | --- | --- | --- | --- | --- | --- | ---";
  const rows = sources.map((source) => [
    source.id,
    source.kind,
    source.name,
    source.group === "" ? "-" : source.group,
    source.kind === "sqlite" ? source.file ?? "-" : `${source.host ?? "-"}:${source.port ?? "-"}`,
    source.user ?? "-",
    source.auth,
    source.tags.length > 0 ? source.tags.join(",") : "-",
    source.readonly ? "yes" : "no"
  ].join(" | "));
  return [header, divider, ...rows].join("\n");
}
function renderTables(tables) {
  if (tables.length === 0) return "no tables";
  return tables.map((table) => {
    const bits = [table.type, table.name];
    if (table.rows !== void 0) bits.push(`~${table.rows} rows`);
    if (table.comment !== void 0) bits.push(table.comment);
    return bits.join("  ");
  }).join("\n");
}
function renderColumns(columns) {
  if (columns.length === 0) return "no columns";
  const header = "column | type | null | key | default | extra | comment";
  const divider = "--- | --- | --- | --- | --- | --- | ---";
  const rows = columns.map((column) => [
    column.name,
    column.type,
    column.nullable ? "YES" : "NO",
    column.key === "" ? "-" : column.key,
    column.defaultValue ?? "-",
    column.extra ?? "-",
    column.comment ?? "-"
  ].join(" | "));
  return [header, divider, ...rows].join("\n");
}
function makeTools(store, pool, defineTool2) {
  const resolve3 = (idOrName) => {
    const byId = store.find(idOrName);
    if (byId !== void 0) return { id: byId.id };
    const byName = store.list().find((entry) => entry.name === idOrName);
    if (byName !== void 0) return { id: byName.id };
    const known = store.list().map((entry) => `${entry.id} (${entry.kind})`).join(", ");
    throw new Error(
      known === "" ? `no data source "${idOrName}" \u2014 none are configured; the user must add one in the \u6570\u636E\u5E93\u7BA1\u7406 panel` : `no data source "${idOrName}"; configured: ${known}`
    );
  };
  const driverOf = (idOrName) => {
    const { id } = resolve3(idOrName);
    const entry = store.find(id);
    return { entry, driver: pool.acquire(entry), summary: summarize(entry) };
  };
  const listTool = defineTool2({
    name: "db_list",
    description: "List the database data sources the user has configured in the \u6570\u636E\u5E93\u7BA1\u7406 panel (id, engine, name, host/file, user, auth, tags, readonly). Use the returned id or name with the other db_* tools. Read-only. Triggers: list databases, configured database, data sources, \u6570\u636E\u5E93\u5217\u8868.",
    parameters: {
      query: { type: "string", description: "Optional fuzzy match against id, name, group, tags, host and file." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          sources: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                kind: { type: "string", enum: ["sqlite", "mysql", "redis"], required: true },
                name: { type: "string", required: true },
                group: { type: "string", required: true },
                host: { type: "string" },
                port: { type: "integer" },
                file: { type: "string" },
                user: { type: "string" },
                database: { type: "string" },
                db: { type: "integer" },
                auth: { type: "string", required: true },
                tags: { type: "array", items: { type: "string" }, required: true },
                readonly: { type: "boolean", required: true },
                description: { type: "string", required: true }
              }
            }
          }
        }
      },
      render: (_args, value) => text(renderSources(value.sources ?? []))
    },
    async execute(args) {
      const term = args.query?.trim().toLowerCase();
      const all = store.list().map(summarize);
      const sources = term === void 0 || term === "" ? all : all.filter(
        (source) => [source.id, source.name, source.group, source.host ?? "", source.file ?? "", source.tags.join(" ")].some((field) => field.toLowerCase().includes(term))
      );
      return { sources };
    }
  });
  const schemaTool = defineTool2({
    name: "db_schema",
    description: 'Inspect the structure of a SQL data source: its schemas/databases, tables and views, and (with "table") the columns and indexes of one table. For Redis, returns the key count per logical database instead. Read-only. Triggers: table structure, describe table, schema, columns, indexes, list tables, \u8868\u7ED3\u6784.',
    parameters: {
      source: { type: "string", required: true, description: "Data source id or name from db_list." },
      schema: { type: "string", description: 'SQL: which database/schema to inspect. Required together with "table" on MySQL, where omitting it lists the databases.' },
      table: { type: "string", description: "SQL: return this table's columns and indexes instead of the whole tree." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", required: true },
          schemas: { type: "array", items: { type: "string" }, required: true },
          tables: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", required: true },
                type: { type: "string", required: true },
                rows: { type: "integer" },
                comment: { type: "string" }
              }
            }
          },
          columns: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", required: true },
                type: { type: "string", required: true },
                nullable: { type: "boolean", required: true },
                key: { type: "string", required: true },
                defaultValue: { type: "string" },
                extra: { type: "string" },
                comment: { type: "string" }
              }
            }
          },
          indexes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", required: true },
                unique: { type: "boolean", required: true },
                columns: { type: "array", items: { type: "string" }, required: true }
              }
            }
          },
          redisDatabases: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                db: { type: "integer", required: true },
                keys: { type: "integer", required: true }
              }
            }
          },
          tablesRendered: { type: "string", required: true },
          columnsRendered: { type: "string" },
          indexesRendered: { type: "string" }
        }
      },
      render: (_args, value) => {
        const lines = [];
        const schemas = value["schemas"];
        if (schemas !== void 0 && schemas.length > 0) lines.push(`schemas: ${schemas.join(", ")}`);
        if (value["tablesRendered"] !== void 0) lines.push(String(value["tablesRendered"]));
        if (value["columnsRendered"] !== void 0) lines.push("", String(value["columnsRendered"]));
        if (value["indexesRendered"] !== void 0) lines.push("", String(value["indexesRendered"]));
        const redisDatabases = value["redisDatabases"];
        if (redisDatabases !== void 0) {
          lines.push(redisDatabases.length === 0 ? "no databases hold keys" : redisDatabases.map((item) => `db${item.db}: ${item.keys} keys`).join("\n"));
        }
        return text(lines.join("\n"));
      }
    },
    async execute(args) {
      const { driver, summary } = driverOf(args.source);
      if (isRedisDriver(driver)) {
        const info = await driver.info();
        const redisDatabases = info.databases.map((item) => ({ db: item.db, keys: item.keys }));
        return {
          kind: summary.kind,
          schemas: [],
          tables: [],
          redisDatabases,
          tablesRendered: redisDatabases.length === 0 ? "no databases hold keys" : redisDatabases.map((item) => `db${item.db}: ${item.keys} keys`).join("\n")
        };
      }
      if (!isSqlDriver(driver)) throw new Error("unsupported data source kind");
      const schemas = (await driver.schemas()).map((item) => item.name);
      const schema = args.schema ?? (summary.kind === "sqlite" ? "main" : void 0);
      if (args.table !== void 0 && args.table !== "") {
        if (schema === void 0) {
          throw new Error(
            `"table" needs a "schema" for a MySQL data source. Available: ${schemas.join(", ") || "(none)"}`
          );
        }
        const tableName = args.table;
        const [columns, indexes] = await Promise.all([
          driver.columns(schema, tableName),
          driver.indexes(schema, tableName).catch(() => [])
        ]);
        return {
          kind: summary.kind,
          schemas,
          tables: [],
          columns,
          indexes: indexes.map((index) => ({ name: index.name, unique: index.unique, columns: index.columns })),
          tablesRendered: `table: ${schema}.${tableName}`,
          columnsRendered: renderColumns(columns),
          indexesRendered: indexes.length === 0 ? "no indexes" : indexes.map((index) => `${index.name}${index.unique ? " (unique)" : ""}: ${index.columns.join(", ")}`).join("\n")
        };
      }
      if (schema === void 0) {
        return {
          kind: summary.kind,
          schemas,
          tables: [],
          tablesRendered: schemas.length === 0 ? "no databases visible to this user" : `databases (pass "schema" to list one's tables):
${schemas.join("\n")}`
        };
      }
      const tables = await driver.tables(schema);
      return {
        kind: summary.kind,
        schemas,
        tables: tables.map((table) => ({
          name: table.name,
          type: table.type,
          ...table.rows === void 0 ? {} : { rows: table.rows },
          ...table.comment === void 0 ? {} : { comment: table.comment }
        })),
        tablesRendered: `schema ${schema}:
${renderTables(tables)}`
      };
    }
  });
  const queryTool = defineTool2({
    name: "db_query",
    description: "Run a READ-ONLY statement against a data source and return the rows. SQL engines accept SELECT / WITH / SHOW / DESCRIBE / EXPLAIN / PRAGMA; Redis accepts a read command (GET, HGETALL, LRANGE, SCAN, INFO, \u2026). Writes are refused here \u2014 use db_exec, which is gated by the user's approval. Triggers: query database, select, read table data, \u67E5\u6570\u636E.",
    parameters: {
      source: { type: "string", required: true, description: "Data source id or name from db_list." },
      sql: { type: "string", required: true, description: 'SQL: one read-only statement. Redis: the command line, e.g. "GET mykey" or "HGETALL myhash".' },
      params: { type: "array", items: { type: "json" }, description: "SQL: positional values bound to ? placeholders (never inline user data into the SQL text)." },
      schema: { type: "string", description: "SQL: the database/schema to run in." },
      limit: { type: "integer", description: "Maximum rows returned (default 1000, max 5000)." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          columns: { type: "array", items: { type: "string" }, required: true },
          rows: { type: "array", items: { type: "json" }, required: true },
          rowCount: { type: "integer", required: true },
          durationMs: { type: "integer", required: true },
          truncated: { type: "boolean", required: true },
          rendered: { type: "string", required: true }
        }
      },
      render: (_args, value) => text(value.rendered ?? "")
    },
    async execute(args) {
      const { driver } = driverOf(args.source);
      const limit = Math.max(1, Math.min(args.limit ?? 1e3, 5e3));
      if (isRedisDriver(driver)) {
        const parts = args.sql.trim().split(/\s+/);
        const name2 = parts[0] ?? "";
        if (name2 === "") throw new Error("a Redis command is required");
        if (!isRedisReadCommand(name2)) {
          throw new Error(`"${name2}" is a write command and is not available to db_query; use db_exec, which requires the user's approval`);
        }
        const result2 = await driver.command(parts, 0);
        return shape(result2);
      }
      if (!isSqlDriver(driver)) throw new Error("unsupported data source kind");
      if (!looksReadOnly(args.sql)) {
        throw new Error("db_query only accepts read-only statements; use db_exec (approval-gated) to write");
      }
      const params = Array.isArray(args.params) ? args.params : [];
      const result = await driver.query(args.sql, params, limit, args.schema);
      return shape(result);
    }
  });
  const execTool = defineTool2({
    name: "db_exec",
    description: "Run a WRITE statement against a data source (INSERT / UPDATE / DELETE / DDL for SQL, or a write command for Redis). This tool is gated: unless the user enabled \u201C\u5141\u8BB8 agent \u5199\u5165\u201D, it is refused; when enabled, each call raises an approval prompt the user must confirm. Prefer db_query for anything that only reads. Always bind values through params instead of building SQL text. Triggers: update database, insert row, delete row, alter table, \u6539\u6570\u636E.",
    parameters: {
      source: { type: "string", required: true, description: "Data source id or name from db_list." },
      sql: { type: "string", required: true, description: 'SQL: one statement. Redis: the command line, e.g. "SET k v" or "DEL k".' },
      params: { type: "array", items: { type: "json" }, description: "SQL: positional values bound to ? placeholders." },
      schema: { type: "string", description: "SQL: the database/schema to run in." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          affected: { type: "integer", required: true },
          durationMs: { type: "integer", required: true },
          rendered: { type: "string", required: true }
        }
      },
      render: (_args, value) => text(value.rendered ?? "")
    },
    async execute(args) {
      const { driver } = driverOf(args.source);
      if (isRedisDriver(driver)) {
        const parts = args.sql.trim().split(/\s+/);
        if (parts.length === 0 || parts[0] === "") throw new Error("a Redis command is required");
        const result2 = await driver.command(parts, 0);
        return { affected: result2.affected, durationMs: result2.durationMs, rendered: renderResult(result2) };
      }
      if (!isSqlDriver(driver)) throw new Error("unsupported data source kind");
      const params = Array.isArray(args.params) ? args.params : [];
      const result = await driver.exec(args.sql, params, args.schema);
      return { affected: result.affected, durationMs: result.durationMs, rendered: renderResult(result) };
    }
  });
  return [listTool, schemaTool, queryTool, execTool];
}
function shape(result) {
  return {
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rows.length,
    durationMs: result.durationMs,
    truncated: result.truncated,
    rendered: renderResult(result)
  };
}

// src/index-registry.ts
var INDEX_IDLE_TTL_MS = 30 * 60 * 1e3;
var STEP_PAUSE_MS = 50;
var IndexRegistry = class _IndexRegistry {
  entries = /* @__PURE__ */ new Map();
  /** Resolve a source id to something whose batches can be aggregated. */
  resolveSource;
  constructor(resolveSource) {
    this.resolveSource = resolveSource;
  }
  /** Registry key: one index per source AND database. */
  static key(sourceId, db) {
    return `${sourceId}\0${db}`;
  }
  /**
   * The cached index for one database, or undefined when none was built.
   *
   * @param touch - whether this counts as use, which extends the idle TTL. A status
   *   poll does, since the user is watching the walk.
   */
  get(sourceId, db, touch = true) {
    this.evictIdle();
    const entry = this.entries.get(_IndexRegistry.key(sourceId, db));
    if (entry === void 0) return void 0;
    if (touch) entry.lastUsed = Date.now();
    return entry.index;
  }
  /** Whether a walk is currently running for one database. */
  isBuilding(sourceId, db) {
    const entry = this.entries.get(_IndexRegistry.key(sourceId, db));
    return entry !== void 0 && !entry.index.done && entry.index.error === void 0;
  }
  /** What a walk of one database would cost, for a warning before starting. */
  estimate(dbSize) {
    return estimateIndexCost(dbSize);
  }
  /**
   * Start (or resume) a walk for one database, and return its status.
   *
   * Idempotent: calling it while a walk is running returns the current progress
   * rather than starting a second traversal — a user clicking twice must not double
   * the load on the server.
   *
   * @param dbSize - the database's key count, used for the progress denominator.
   */
  async start(sourceId, db, dbSize) {
    const key = _IndexRegistry.key(sourceId, db);
    const existing = this.entries.get(key);
    if (existing !== void 0) {
      existing.lastUsed = Date.now();
      if (existing.index.done || existing.index.error !== void 0) return existing.index;
      if (!existing.looping) void this.runLoop(key, sourceId, db);
      return existing.index;
    }
    const entry = {
      index: createIndex(db, dbSize),
      stepping: false,
      cancelled: false,
      looping: false,
      lastUsed: Date.now()
    };
    this.entries.set(key, entry);
    void this.runLoop(key, sourceId, db);
    return entry.index;
  }
  /**
   * Advance one database's walk until it finishes or is cancelled.
   *
   * Runs detached: the caller gets progress from {@link get}, and a level request
   * answers from whatever is already indexed. Errors are recorded ON the index
   * rather than thrown, because a detached failure has no caller to catch it and an
   * index that silently stays empty would look like an empty database.
   */
  async runLoop(key, sourceId, db) {
    const entry = this.entries.get(key);
    if (entry === void 0 || entry.looping) return;
    entry.looping = true;
    try {
      const source = await this.resolveSource(sourceId);
      while (!entry.cancelled) {
        if (entry.stepping) break;
        entry.stepping = true;
        let advance;
        try {
          advance = await advanceIndex(source, entry.index);
        } finally {
          entry.stepping = false;
        }
        entry.lastUsed = Date.now();
        if (advance.done) break;
        if (entry.index.error !== void 0) break;
        await new Promise((resolve3) => setTimeout(resolve3, STEP_PAUSE_MS));
      }
    } catch (failure) {
      entry.index.error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      entry.looping = false;
    }
  }
  /**
   * Stop a running walk and drop the index.
   *
   * Used when a database changes in a way the incremental updates cannot express
   * (a bulk delete that exceeded its ceiling), and when the panel leaves the source.
   */
  invalidate(sourceId, db) {
    const key = _IndexRegistry.key(sourceId, db);
    const entry = this.entries.get(key);
    if (entry !== void 0) entry.cancelled = true;
    this.entries.delete(key);
  }
  /** Drop every index for one source, e.g. when its connection changes. */
  invalidateSource(sourceId) {
    for (const [key, entry] of this.entries) {
      if (key.startsWith(`${sourceId}\0`)) {
        entry.cancelled = true;
        this.entries.delete(key);
      }
    }
  }
  /** Drop every index, used when the host unloads and walks must stop. */
  disposeAll() {
    for (const entry of this.entries.values()) entry.cancelled = true;
    this.entries.clear();
  }
  /** Whether any index is being built, for a caller that must wait before writing. */
  anyBuilding() {
    for (const entry of this.entries.values()) {
      if (!entry.index.done && entry.index.error === void 0 && entry.looping) return true;
    }
    return false;
  }
  /** Drop indexes untouched for longer than the idle TTL. */
  evictIdle() {
    const cutoff = Date.now() - INDEX_IDLE_TTL_MS;
    for (const [key, entry] of this.entries) {
      if (entry.index.done && entry.lastUsed < cutoff) this.entries.delete(key);
    }
  }
  /** Progress of one database's index, or undefined when none exists. */
  progressOf(sourceId, db) {
    const index = this.get(sourceId, db);
    return index === void 0 ? void 0 : indexProgress(index);
  }
};

// src/index.ts
var name = "database-manager";
var inject = ["webServer", "tools", "systemPrompt"];
var SECTION_ORDER = 155;
function guidance(gate) {
  return `\u672C\u673A\u5DF2\u5B89\u88C5 dsh-database-manager \u63D2\u4EF6\uFF08DSH \u6570\u636E\u5E93\u7BA1\u7406\uFF09\uFF1A\u4FA7\u8FB9\u680F\u300C\u6570\u636E\u5E93\u7BA1\u7406\u300D\u5165\u53E3\uFF0C\u72EC\u7ACB\u9762\u677F\u53EF\u7BA1\u7406 SQLite / MySQL / Redis\u3002\u6570\u636E\u6E90\u914D\u7F6E\u5B58 $DSH_HOME/dsh-database.json\uFF08\u542B\u660E\u6587\u53E3\u4EE4\u7684\u79C1\u5BC6\u6587\u4EF6\uFF0C\u4E0D\u8981\u8BFB\u53D6\u6216\u8F6C\u53D1\u5176\u5185\u5BB9\uFF09\u3002\u80FD\u529B\uFF1Adb_list \u5217\u51FA\u6570\u636E\u6E90\u3001db_schema \u67E5\u770B\u5E93/\u8868/\u5217/\u7D22\u5F15\u7ED3\u6784\u3001db_query \u6267\u884C\u53EA\u8BFB\u67E5\u8BE2\uFF08SQL \u6216 Redis \u8BFB\u547D\u4EE4\uFF09\u3001db_exec \u6267\u884C\u5199\u64CD\u4F5C\u3002${describePosture(gate)}\u9650\u5236\uFF1A\u6570\u636E\u6E90\u5FC5\u987B\u7531\u7528\u6237\u5728\u9762\u677F\u4E2D\u5148\u914D\u7F6E\uFF0Cagent \u624D\u80FD\u64CD\u4F5C\uFF1B\u5199\u64CD\u4F5C\u53D7\u7528\u6237\u5F00\u5173\u4E0E\u5BA1\u6279\u4FDD\u62A4\uFF1B\u7ED3\u679C\u96C6\u6709\u884C\u6570\u4E0A\u9650\uFF0C\u8D85\u9650\u4F1A\u88AB\u622A\u65AD\uFF1Bdb_query \u62D2\u7EDD\u5199\u8BED\u53E5\u3002\u8DEF\u5F84\u533A\u5206\uFF1ASQLite \u7684 file \u662F\u672C\u673A\uFF08dsh host\uFF09\u8DEF\u5F84\uFF0C\u7528\u672C\u5730\u5DE5\u5177\u8BFB\u5199\uFF1B\u8FDC\u7A0B\u5E93\u4E00\u5F8B\u901A\u8FC7\u672C\u63D2\u4EF6\u7684\u5DE5\u5177\u64CD\u4F5C\u3002\u7528\u6237\u63D0\u5230\u300C\u6570\u636E\u5E93 / \u8868 / SQL / \u67E5\u8BE2\u6570\u636E / Redis / \u952E\u503C / \u6539\u6570\u636E\u300D\u65F6\u5373\u6307\u672C\u63D2\u4EF6\uFF0C\u8BF7\u636E\u6B64\u534F\u4F5C\u3002`;
}
var apply = mountOnce("dsh-database-manager", applyImpl);
function applyImpl(ctx, config) {
  const store = new DataSourceStore();
  const pool = new ConnectionPool(store);
  ctx.effect(() => () => {
    pool.dispose();
  }, "dsh-database-manager: pool");
  const indexes = new IndexRegistry(async (sourceId) => {
    const { driver } = pool.acquireById(sourceId);
    if (!isRedisDriver(driver)) throw new Error(`data source "${sourceId}" is not a Redis source`);
    return driver;
  });
  ctx.effect(() => () => {
    indexes.disposeAll();
  }, "dsh-database-manager: indexes");
  let gate = { ...DEFAULT_GATE_SETTINGS, ...store.settings() };
  const readGate = () => gate;
  const saveGate = (patch) => {
    gate = { ...gate, ...store.saveSettings(patch) };
    if (disposeSection !== void 0) {
      disposeSection();
      disposeSection = void 0;
    }
    disposeSection = announce(ctx, config, gate);
    return gate;
  };
  let disposeRoutes;
  let disposeTools;
  let disposeGate;
  let disposeSection;
  const enabled = config?.enabled !== false;
  if (!enabled) return;
  disposeGate = ctx.effect(
    () => installGate(ctx, store, readGate),
    "dsh-database-manager: authorization gate"
  );
  const { routes } = makeRoutes({ store, pool, indexes, gate: readGate, saveGate });
  disposeRoutes = ctx.effect(
    () => {
      const disposers = routes.map((route) => ctx.webServer.register(route));
      return () => {
        for (const dispose of disposers) dispose();
      };
    },
    "dsh-database-manager: routes"
  );
  const tools = makeTools(store, pool, (definition) => defineTool(definition));
  disposeTools = ctx.effect(
    () => {
      const disposers = tools.map((tool) => ctx.tools.register(tool));
      return () => {
        for (const dispose of disposers) dispose();
      };
    },
    "dsh-database-manager: tools"
  );
  disposeSection = announce(ctx, config, gate);
}
function announce(ctx, config, gate) {
  if (config?.announceToAgent === false) return () => {
  };
  try {
    return ctx.systemPrompt?.section({
      name: "plugin:dsh-database-manager",
      order: SECTION_ORDER,
      text: guidance(gate)
    }) ?? (() => {
    });
  } catch {
    return () => {
    };
  }
}
var MOUNTED = /* @__PURE__ */ Symbol.for("dsh-web.mounted-plugins");
function mountOnce(packageName, fn) {
  return ((...args) => {
    const registry = globalThis;
    const mounted = registry[MOUNTED] ??= /* @__PURE__ */ new Set();
    if (mounted.has(packageName)) return;
    mounted.add(packageName);
    const ctx = args[0];
    ctx?.effect?.(() => () => {
      mounted.delete(packageName);
    });
    return fn(...args);
  });
}
export {
  apply,
  guidance,
  inject,
  name
};
//# sourceMappingURL=index.js.map
