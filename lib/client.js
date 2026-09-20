window.__ModuleLoader__.load({
	id: "dsh-database-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		"use strict";
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name in all)
		    __defProp(target, name, { get: all[name], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
		  // If the importer is in node compatibility mode or this is not an ESM
		  // file that has been converted to a CommonJS file using a Babel-
		  // compatible transform (i.e. "__esModule" has not been set), then set
		  // "default" to the CommonJS "module.exports" for node compatibility.
		  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
		  mod
		));
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

		// src/client/index.ts
		var index_exports = {};
		__export(index_exports, {
		  PANEL_ID: () => PANEL_ID,
		  apply: () => apply,
		  inject: () => inject
		});
		module.exports = __toCommonJS(index_exports);
		var React18 = __toESM(require("react"), 1);

		// src/protocol.ts
		var DB_KINDS = ["sqlite", "mysql", "redis"];
		var ROW_FILTER_OPERATORS = [
		  "eq",
		  "neq",
		  "gt",
		  "gte",
		  "lt",
		  "lte",
		  "contains",
		  "notContains",
		  "startsWith",
		  "endsWith",
		  "between",
		  "in",
		  "isNull",
		  "isNotNull"
		];
		var UNARY_FILTER_OPERATORS = ["isNull", "isNotNull"];
		var MAINTENANCE_OPS_VIEW = ["check", "optimize", "repair", "analyze"];
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
		  /** How many distinct values a column holds (结构页的「非重复值」). */
		  distinct: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/distinct?${params}`,
		  row: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/row`,
		  /** Delete several rows in one request (浏览页的多选删除）. */
		  deleteRows: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/rows/delete`,
		  table: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/table`,
		  /** Schema changes: add / alter / drop a column, set the key, index management. */
		  schema: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/schema`,
		  /** Export a schema or one table (SQL dump or CSV). */
		  exportData: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/export`,
		  /** Import a SQL dump or a CSV file. */
		  importData: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/import`,
		  /** Table maintenance: check / optimize / repair / analyze, on one or many tables. */
		  maintain: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/maintain`,
		  /** What maintenance this engine can actually do (the UI disables the rest). */
		  maintenanceSupport: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/maintenance-support`,
		  /** Database-level operations: create / drop / rename / copy / charset. */
		  databaseOp: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/database`,
		  /** Which table-level operations this engine can perform (移动 / 表选项 / 复制). */
		  tableActions: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/table-actions`,
		  /** Move a table to another database (「将数据表移动到」). */
		  tableMove: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/table/move`,
		  /** Copy a table (structure and optionally data) into another database. */
		  tableCopy: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/table/copy`,
		  /** Read (GET) or change (POST) one existing table's options. */
		  tableOptions: (id, params) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/table/options?${params}`,
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

		// src/client/api.ts
		var DbApiError = class extends Error {
		  /** HTTP status, when the failure came from a response. */
		  status;
		  constructor(message, status) {
		    super(message);
		    this.name = "DbApiError";
		    this.status = status;
		  }
		};
		async function readJson(response) {
		  if (typeof response?.json !== "function") {
		    throw new DbApiError(
		      "internal error: readJson was given a value that is not a Response (the response was most likely already parsed)"
		    );
		  }
		  let body;
		  try {
		    body = await response.json();
		  } catch {
		    throw new DbApiError(`HTTP ${response.status}: invalid JSON response`, response.status);
		  }
		  if (!response.ok) {
		    const message = typeof body === "object" && body !== null && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
		    throw new DbApiError(message, response.status);
		  }
		  return body;
		}
		function query(params) {
		  const search = new URLSearchParams();
		  for (const [key, value] of Object.entries(params)) {
		    if (value !== void 0 && value !== "") search.set(key, String(value));
		  }
		  return search.toString();
		}
		async function send(url, method, body) {
		  const response = await fetch(url, {
		    method,
		    headers: { "content-type": "application/json" },
		    ...body === void 0 ? {} : { body: JSON.stringify(body) }
		  });
		  return readJson(response);
		}
		var DbApi = class {
		  /** List every configured data source plus the live write posture. */
		  async listSources() {
		    return readJson(await fetch(DB_API.sources));
		  }
		  /** Which engines this host can actually drive (a missing dependency shows here). */
		  async engines() {
		    return (await readJson(await fetch(`${DB_API_BASE}/engines`))).engines;
		  }
		  /** Read the write posture. */
		  async getSettings() {
		    return (await readJson(await fetch(`${DB_API_BASE}/settings`))).settings;
		  }
		  /**
		   * Patch the write posture.
		   *
		   * `send` already parses the response, so the result is destructured directly.
		   * Wrapping it in another `readJson` (as this did) called `.json()` on a plain
		   * object: the throw was then reported as "HTTP undefined: invalid JSON
		   * response", because the caught value had no `status` — a misleading message
		   * for a request the server had in fact answered with 200.
		   */
		  async setSettings(patch) {
		    return (await send(`${DB_API_BASE}/settings`, "PATCH", patch)).settings;
		  }
		  /** Create a data source. */
		  async createSource(payload) {
		    return (await send(DB_API.sources, "POST", payload)).source;
		  }
		  /** Update a data source; an omitted password keeps the stored one. */
		  async updateSource(id, payload) {
		    return (await send(`${DB_API.sources}/${encodeURIComponent(id)}`, "PATCH", payload)).source;
		  }
		  /** Delete a data source. */
		  async deleteSource(id) {
		    await send(`${DB_API.sources}/${encodeURIComponent(id)}`, "DELETE");
		  }
		  /** Test connectivity. */
		  async test(id) {
		    return (await send(DB_API.test(id), "POST")).result;
		  }
		  /**
		   * Test an UNSAVED payload. Nothing is stored, so the dialog can verify a
		   * connection before the user commits the form.
		   * @param payload - the draft fields.
		   * @param baseId - the entry being edited, so an untouched password falls back
		   *   to the stored one (the browser never receives it).
		   */
		  async testConnection(payload, baseId) {
		    return (await send(DB_API.testConnection, "POST", {
		      ...payload,
		      ...baseId === void 0 ? {} : { baseId }
		    })).result;
		  }
		  /** Connect and fetch the opening payload for the database panel. */
		  async connect(id) {
		    return send(DB_API.database(id), "POST");
		  }
		  /** Databases/schemas of a SQL source. */
		  async schemas(id) {
		    return (await readJson(await fetch(DB_API.schemas(id)))).schemas;
		  }
		  /** Tables and views of one schema. `stats` also fills in row counts and sizes. */
		  async tables(id, schema, stats) {
		    const params = query({ schema, stats: stats === true ? "1" : void 0 });
		    return (await readJson(await fetch(DB_API.tables(id, params)))).tables;
		  }
		  /** Columns of one table. */
		  async columns(id, table, schema) {
		    return (await readJson(await fetch(DB_API.columns(id, query({ schema, table }))))).columns;
		  }
		  /** Indexes of one table. */
		  async indexes(id, table, schema) {
		    return (await readJson(await fetch(DB_API.indexes(id, query({ schema, table }))))).indexes;
		  }
		  /** One page of table rows. */
		  async rows(id, options) {
		    const url = `${DB_API.rows(id)}?${query({
		      ...options,
		      // A condition list is one JSON parameter rather than a parameter per
		      // field: the shape is a list, and flattening it into repeated names would
		      // lose the association between a condition's column and its operand.
		      filters: options.filters === void 0 || options.filters.length === 0 ? void 0 : JSON.stringify(options.filters),
		      orderByColumns: options.orderByColumns === void 0 || options.orderByColumns.length === 0 ? void 0 : options.orderByColumns.join(","),
		      withIndexes: options.withIndexes === true ? "1" : void 0
		    })}`;
		    return (await readJson(await fetch(url))).page;
		  }
		  /** Delete several rows in one request and one transaction. */
		  async deleteRows(id, body) {
		    return (await send(DB_API.deleteRows(id), "POST", body)).result;
		  }
		  /** How many distinct values a column holds. */
		  async distinctCount(id, options) {
		    return (await readJson(await fetch(DB_API.distinct(id, query(options))))).count;
		  }
		  /** One schema change: add / alter / drop a column, set the key, manage an index. */
		  async changeSchema(id, body) {
		    return (await send(DB_API.schema(id), "POST", body)).result;
		  }
		  /** Export a schema or one table. The text comes back for the browser to save. */
		  async exportData(id, body) {
		    return send(DB_API.exportData(id), "POST", body);
		  }
		  /** Import a SQL dump or a CSV file. */
		  async importData(id, body) {
		    return (await send(DB_API.importData(id), "POST", body)).result;
		  }
		  /** Which table-maintenance operations this engine can actually perform. */
		  async maintenanceSupport(id) {
		    return (await readJson(await fetch(DB_API.maintenanceSupport(id)))).support;
		  }
		  /** Run table maintenance on one or many tables. */
		  async maintain(id, body) {
		    return (await send(DB_API.maintain(id), "POST", body)).results;
		  }
		  /** Run one database-level operation (create / drop / rename / copy / charset). */
		  async databaseOperation(id, body) {
		    return (await send(DB_API.databaseOp(id), "POST", body)).result;
		  }
		  /** Insert one row. */
		  async insertRow(id, body) {
		    return (await send(DB_API.row(id), "POST", body)).result;
		  }
		  /** Insert several rows in one transaction; the host validates they share columns. */
		  async insertRows(id, body) {
		    return (await send(`${DB_API.row(id)}/batch`, "POST", body)).result;
		  }
		  /** Update rows matched by keys. */
		  async updateRow(id, body) {
		    return (await send(DB_API.row(id), "PATCH", body)).result;
		  }
		  /** Delete rows matched by keys. */
		  async deleteRow(id, body) {
		    return (await send(DB_API.row(id), "DELETE", body)).result;
		  }
		  /** Empty a table or drop it.
		   *
		   * `op` is explicit rather than inferred from the HTTP method: both actions
		   * are destructive and irreversible, so a malformed request must not be able
		   * to become a dropped table by omission.
		   */
		  async tableAction(id, body) {
		    return (await send(DB_API.table(id), "POST", body)).result;
		  }
		  /** Which of the 操作 tab's three blocks this engine can actually perform. */
		  async tableActionSupport(id) {
		    return (await readJson(await fetch(DB_API.tableActions(id)))).support;
		  }
		  /** Move a table to another database. Irreversible for the source: the object moves. */
		  async moveTable(id, body) {
		    return (await send(DB_API.tableMove(id), "POST", body)).result;
		  }
		  /** Copy a table's structure, and optionally its rows, into another database. */
		  async copyTable(id, body) {
		    return (await send(DB_API.tableCopy(id), "POST", body)).result;
		  }
		  /**
		   * The option values one existing table reports.
		   *
		   * Read fresh each time the 表选项 block is opened, rather than cached: the values
		   * are what the form is filled in against, and a cached copy would let the form
		   * submit a value the server has since changed.
		   */
		  async tableOptions(id, options) {
		    return (await readJson(await fetch(DB_API.tableOptions(id, query(options))))).options;
		  }
		  /** Change an existing table's options; absent fields are left alone. */
		  async setTableOptions(id, body) {
		    return (await send(
		      DB_API.tableOptions(id, query({ schema: body.schema, table: body.table })),
		      "POST",
		      body.patch
		    )).result;
		  }
		  /** Run one SQL statement. `allowWrite` is the 允许写入 checkbox. */
		  async runSql(id, body) {
		    return (await send(DB_API.query(id), "POST", body)).result;
		  }
		  /** Redis server overview. */
		  async redisInfo(id) {
		    return (await readJson(await fetch(DB_API.redisInfo(id)))).info;
		  }
		  /** One SCAN page of Redis keys. */
		  async redisKeys(id, options) {
		    return (await readJson(await fetch(DB_API.redisKeys(id, query(options))))).page;
		  }
		  /** One Redis key's value. */
		  async redisValue(id, options) {
		    return (await readJson(await fetch(DB_API.redisValue(id, query(options))))).value;
		  }
		  /** Run one Redis command. `allowWrite` is the 允许写入 checkbox. */
		  async redisCommand(id, body) {
		    return (await send(`${DB_API.redisCommand(id)}?${query({ db: body.db })}`, "POST", {
		      args: body.args,
		      allowWrite: body.allowWrite
		    })).result;
		  }
		  /**
		   * Search one database for keys matching a Redis glob pattern.
		   *
		   * Server-side `SCAN MATCH`, so the pattern is real Redis glob syntax and the
		   * search covers folders that are not expanded. Distinct from
		   * {@link redisLevel}, which reads one level of the tree.
		   */
		  async redisSearch(id, options) {
		    return (await readJson(
		      await fetch(DB_API.redisSearch(id, query({ db: options.db, pattern: options.pattern })))
		    )).page;
		  }
		  /**
		   * What a keyspace walk would cost, before anything is scanned.
		   *
		   * Exists so the panel can warn before loading the server: a walk of a huge
		   * database takes tens of seconds and holds the server's CPU, and the user should
		   * decide that consciously rather than discover it.
		   */
		  async redisIndexEstimate(id, options) {
		    return (await readJson(
		      await fetch(DB_API.redisIndexEstimate(id, query({ db: options.db })))
		    )).estimate;
		  }
		  /**
		   * Start (or resume) the keyspace walk for one database, returning its status.
		   *
		   * Idempotent on the host, so calling it again while a walk runs just reports
		   * progress — the panel polls this rather than tracking progress itself.
		   */
		  async redisIndexStart(id, options) {
		    return (await readJson(
		      await fetch(DB_API.redisIndex(id, query({ db: options.db })))
		    )).status;
		  }
		  /** Drop a cached index, so the next read rebuilds it. */
		  async redisIndexInvalidate(id, options) {
		    await readJson(await fetch(DB_API.redisIndex(id, query({ db: options.db })), { method: "DELETE" }));
		  }
		  /**
		   * One level of the cached keyspace index.
		   *
		   * Answers from memory on the host, so expanding a level costs no scanning at all —
		   * which is the entire reason the index exists. Throws on 409 when no index has
		   * been built, letting the caller decide to build one.
		   */
		  async redisIndexLevel(id, options) {
		    return (await readJson(
		      await fetch(DB_API.redisIndexLevel(id, query({
		        db: options.db,
		        prefix: options.prefix,
		        withTypes: options.withTypes ? "1" : "0"
		      })))
		    )).level;
		  }
		  /**
		   * One folder level of one database.
		   *
		   * The tree loads this way rather than whole-database: a level scan is bounded
		   * by the level's own size, and a folder the user never opens is never read.
		   * `withTypes: false` skips the TYPE/TTL round trips (useful for a level that
		   * is all folders).
		   */
		  async redisLevel(id, options) {
		    return (await readJson(
		      await fetch(DB_API.redisLevel(id, query({
		        db: options.db,
		        prefix: options.prefix,
		        withTypes: options.withTypes ? "1" : "0"
		      })))
		    )).page;
		  }
		  /** Replace a string key's value; TTL is preserved. */
		  async redisSetString(id, body) {
		    return (await send(
		      `${DB_API.redisString(id)}?${query({ db: body.db })}`,
		      "POST",
		      { key: body.key, value: body.value }
		    )).result;
		  }
		  /** Set a key's TTL; `ttl: null` means no expiry (PERSIST, not EXPIRE 0). */
		  async redisSetTtl(id, body) {
		    return (await send(
		      `${DB_API.redisTtl(id)}?${query({ db: body.db })}`,
		      "POST",
		      { key: body.key, ttl: body.ttl }
		    )).result;
		  }
		  /** Add, change or remove one element of a collection key. */
		  async redisEditElement(id, body) {
		    return (await send(
		      `${DB_API.redisElement(id)}?${query({ db: body.db })}`,
		      "POST",
		      { key: body.key, ...body.edit }
		    )).result;
		  }
		  /** Create one or more keys; resolves with the names that were created. */
		  async redisCreateKeys(id, options) {
		    return (await send(`${DB_API.redisCreate(id)}?${query({ db: options.db })}`, "POST", {
		      keys: options.keys
		    })).created;
		  }
		  /** Delete one key; resolves with whether it existed. */
		  async redisDeleteKey(id, options) {
		    return (await send(DB_API.redisDeleteKey(id, query(options)), "DELETE")).removed;
		  }
		  /** How many keys a folder holds, for the delete confirmation. */
		  async redisPrefixCount(id, options) {
		    return (await readJson(await fetch(DB_API.redisPrefixCount(id, query(options))))).count;
		  }
		  /** Delete a folder: its own key plus every descendant. Irreversible. */
		  async redisDeletePrefix(id, options) {
		    return (await send(
		      `${DB_API.redisDeletePrefix(id)}?${query({ prefix: options.prefix, db: options.db })}`,
		      "DELETE"
		    )).result;
		  }
		};

		// src/client/DatabasePanel.ts
		var React17 = __toESM(require("react"), 1);

		// src/client/RedisDatabaseView.ts
		var React5 = __toESM(require("react"), 1);

		// src/client/command.ts
		function splitCommand(line) {
		  const args = [];
		  let current = "";
		  let quote;
		  let started = false;
		  for (let i = 0; i < line.length; i++) {
		    const ch = line[i];
		    if (quote !== void 0) {
		      if (ch === "\\" && i + 1 < line.length) {
		        current += line[i + 1];
		        i++;
		        continue;
		      }
		      if (ch === quote) {
		        quote = void 0;
		        continue;
		      }
		      current += ch;
		      continue;
		    }
		    if (ch === '"' || ch === "'") {
		      quote = ch;
		      started = true;
		      continue;
		    }
		    if (/\s/.test(ch)) {
		      if (started) args.push(current);
		      current = "";
		      started = false;
		      continue;
		    }
		    current += ch;
		    started = true;
		  }
		  if (started) args.push(current);
		  return args;
		}
		function keyFromCommand(args) {
		  if (args.length < 2) return void 0;
		  return args[1];
		}

		// src/client/RedisKeyTree.ts
		var React2 = __toESM(require("react"), 1);

		// src/redis-util.ts
		var SEPARATOR = ":";
		function createPrefix(path) {
		  if (path === void 0 || path === "") return "";
		  return `${path}${SEPARATOR}`;
		}
		function parseKeyNames(text, prefix) {
		  const names = [];
		  for (const line of text.split(/\r?\n/)) {
		    const trimmed = line.trim();
		    if (trimmed === "") continue;
		    names.push(`${prefix}${trimmed}`);
		  }
		  return names;
		}

		// src/client/redis-tree.ts
		function byName(a, b) {
		  return a.key.localeCompare(b.key, void 0, { sensitivity: "base" });
		}
		function buildRedisTree(keys, truncated = false) {
		  const root = { name: "", path: "", folders: [], keys: [] };
		  const folders = /* @__PURE__ */ new Map([["", root]]);
		  for (const info of keys) {
		    const parts = info.key.split(SEPARATOR);
		    if (parts.length === 1) {
		      root.keys.push(info);
		      continue;
		    }
		    let parent = root;
		    let path = "";
		    for (let i = 0; i < parts.length - 1; i++) {
		      const segment = parts[i];
		      path = path === "" ? segment : `${path}${SEPARATOR}${segment}`;
		      let node = folders.get(path);
		      if (node === void 0) {
		        node = { name: segment, path, folders: [], keys: [] };
		        folders.set(path, node);
		        parent.folders.push(node);
		      }
		      parent = node;
		    }
		    parent.keys.push(info);
		  }
		  sortNode(root);
		  return { folders: root.folders, keys: root.keys, total: keys.length, truncated };
		}
		function sortNode(node) {
		  node.folders.sort((a, b) => a.name.localeCompare(b.name, void 0, { sensitivity: "base" }));
		  node.keys.sort(byName);
		  for (const folder of node.folders) sortNode(folder);
		}
		function countFolderKeys(folder) {
		  let total = folder.keys.length;
		  for (const child of folder.folders) total += countFolderKeys(child);
		  return total;
		}
		function parseElements(type, text, key) {
		  if (type === "string") return { ok: true, content: { value: text } };
		  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim() !== "");
		  if (type === "list" || type === "set") {
		    if (lines.length === 0) return { ok: false, error: `\u300C${key}\u300D\u9700\u8981\u4E00\u4E2A\u5143\u7D20\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09` };
		    return { ok: true, content: { items: lines } };
		  }
		  if (type === "hash") {
		    const fields = [];
		    for (const [index, line] of lines.entries()) {
		      const match = /^(\S+)[ \t]+(.*)$/.exec(line);
		      if (match === null) return { ok: false, error: `\u300C${key}\u300D\u7B2C ${index + 1} \u884C\u683C\u5F0F\u5E94\u4E3A\uFF1A\u5B57\u6BB5 \u503C` };
		      fields.push({ field: match[1], value: match[2] });
		    }
		    if (fields.length === 0) return { ok: false, error: `\u300C${key}\u300D\u9700\u8981\u4E00\u4E2A\u5B57\u6BB5\uFF08\u6BCF\u884C\u300C\u5B57\u6BB5 \u503C\u300D\uFF09` };
		    return { ok: true, content: { fields } };
		  }
		  if (type === "zset") {
		    const members = [];
		    for (const [index, line] of lines.entries()) {
		      const match = /^(\S+)[ \t]+(.+)$/.exec(line);
		      if (match === null) return { ok: false, error: `\u300C${key}\u300D\u7B2C ${index + 1} \u884C\u683C\u5F0F\u5E94\u4E3A\uFF1A\u5206\u503C \u6210\u5458` };
		      const score = Number(match[1]);
		      if (!Number.isFinite(score)) return { ok: false, error: `\u300C${key}\u300D\u7B2C ${index + 1} \u884C\u7684\u5206\u503C\u4E0D\u662F\u6570\u5B57\uFF1A${match[1]}` };
		      members.push({ member: match[2], score: match[1] });
		    }
		    if (members.length === 0) return { ok: false, error: `\u300C${key}\u300D\u9700\u8981\u4E00\u4E2A\u6210\u5458\uFF08\u6BCF\u884C\u300C\u5206\u503C \u6210\u5458\u300D\uFF09` };
		    return { ok: true, content: { members } };
		  }
		  return { ok: false, error: `\u4E0D\u652F\u6301\u7684\u7C7B\u578B\uFF1A${type}` };
		}
		function contentPlaceholder(type) {
		  switch (type) {
		    case "list":
		      return "\u6BCF\u884C\u4E00\u4E2A\u5143\u7D20";
		    case "set":
		      return "\u6BCF\u884C\u4E00\u4E2A\u6210\u5458";
		    case "hash":
		      return "\u6BCF\u884C\u4E00\u4E2A\u5B57\u6BB5\uFF1A\u5B57\u6BB5 \u503C";
		    case "zset":
		      return "\u6BCF\u884C\u4E00\u4E2A\u6210\u5458\uFF1A\u5206\u503C \u6210\u5458";
		    default:
		      return "\u5B57\u7B26\u4E32\u503C";
		  }
		}
		function usesElementLines(type) {
		  return type === "list" || type === "set" || type === "hash" || type === "zset";
		}

		// src/client/ui.ts
		var React = __toESM(require("react"), 1);

		// src/client/locales.ts
		var zh = {
		  "entry.label": "\u6570\u636E\u5E93\u7BA1\u7406",
		  "entry.tooltip": "\u7BA1\u7406 SQLite / MySQL / Redis \u6570\u636E\u6E90",
		  "panel.title": "\u6570\u636E\u5E93\u7BA1\u7406",
		  "panel.subtitle": "SQLite / MySQL / Redis",
		  "panel.close": "\u8FD4\u56DE\u4F1A\u8BDD",
		  "panel.backToConversation": "\u8FD4\u56DE\u4F1A\u8BDD",
		  "panel.backToList": "\u6570\u636E\u5E93\u5217\u8868",
		  "panel.engines": "\u5F15\u64CE",
		  "panel.engine.missing": "{kind} \u9A71\u52A8\u4E0D\u53EF\u7528\uFF1A{detail}",
		  "gate.allowWrite": "\u5141\u8BB8 agent \u5199\u5165",
		  "gate.requireApproval": "\u5199\u5165\u9700\u5BA1\u6279",
		  "gate.hint": "\u5173\u95ED\u540E agent \u53EA\u80FD\u8BFB\u53D6\u6570\u636E\uFF08db_list / db_schema / db_query\uFF09\uFF1B\u5F00\u542F\u540E db_exec \u4F1A\u5148\u5F39\u51FA\u5BA1\u6279\u6846\u7531\u4F60\u786E\u8BA4\u3002",
		  "gate.saved": "\u5199\u5165\u7B56\u7565\u5DF2\u4FDD\u5B58",
		  "list.search": "\u641C\u7D22\u540D\u79F0\u3001\u4E3B\u673A\u3001\u6807\u7B7E\u2026",
		  "list.groupBy": "\u5206\u7EC4\u663E\u793A",
		  "list.group.none": "\u4E0D\u5206\u7EC4",
		  "list.group.kind": "\u6309\u7C7B\u578B",
		  "list.group.group": "\u6309\u5206\u7EC4",
		  "list.group.tag": "\u6309\u6807\u7B7E",
		  "list.new": "\u65B0\u589E\u6570\u636E\u5E93",
		  "list.empty": "\u8FD8\u6CA1\u6709\u6570\u636E\u6E90\uFF0C\u70B9\u51FB\u300C\u65B0\u589E\u6570\u636E\u5E93\u300D\u5F00\u59CB\u914D\u7F6E\u3002",
		  "list.emptyFiltered": "\u6CA1\u6709\u5339\u914D\u7684\u6570\u636E\u6E90\u3002",
		  "list.count": "\u5171 {n} \u4E2A\u6570\u636E\u6E90",
		  "col.kind": "\u6570\u636E\u5E93\u7C7B\u578B",
		  "col.name": "\u540D\u79F0",
		  "col.group": "\u5206\u7EC4",
		  "col.host": "\u4E3B\u673A",
		  "col.user": "\u7528\u6237",
		  "col.auth": "\u8BA4\u8BC1",
		  "col.tags": "\u6807\u7B7E",
		  "col.actions": "\u64CD\u4F5C",
		  "auth.file": "\u6587\u4EF6",
		  "auth.password": "\u5BC6\u7801",
		  "auth.none": "\u65E0",
		  "action.test": "\u6D4B\u8BD5",
		  "action.connect": "\u8FDE\u63A5",
		  "action.edit": "\u7F16\u8F91",
		  "action.delete": "\u5220\u9664",
		  "action.testing": "\u6D4B\u8BD5\u4E2D\u2026",
		  "action.copy": "\u590D\u5236 ID",
		  "test.ok": "\u8FDE\u63A5\u6210\u529F\uFF08{ms} ms\uFF09{version}",
		  "test.fail": "\u8FDE\u63A5\u5931\u8D25\uFF1A{error}",
		  "test.latency": "\u5EF6\u8FDF {ms} ms",
		  "delete.title": "\u5220\u9664\u6570\u636E\u6E90",
		  "delete.body": "\u786E\u5B9A\u5220\u9664\u6570\u636E\u6E90\u300C{name}\u300D\u5417\uFF1F\u8BE5\u64CD\u4F5C\u53EA\u79FB\u9664\u672C\u673A\u4FDD\u5B58\u7684\u8FDE\u63A5\u914D\u7F6E\uFF0C\u4E0D\u4F1A\u5220\u9664\u6570\u636E\u5E93\u91CC\u7684\u4EFB\u4F55\u6570\u636E\u3002",
		  "delete.confirm": "\u5220\u9664",
		  "form.newTitle": "\u65B0\u589E\u6570\u636E\u5E93",
		  "form.editTitle": "\u7F16\u8F91\u6570\u636E\u5E93",
		  "form.kind": "\u6570\u636E\u5E93\u7C7B\u578B",
		  "form.name": "\u540D\u79F0",
		  "form.name.placeholder": "\u7ED9\u8FD9\u4E2A\u6570\u636E\u6E90\u8D77\u4E2A\u540D\u5B57",
		  "form.id": "ID",
		  "form.id.placeholder": "\u7559\u7A7A\u5219\u6309\u540D\u79F0\u81EA\u52A8\u751F\u6210",
		  "form.group": "\u5206\u7EC4",
		  "form.group.placeholder": "\u4F8B\u5982\uFF1A\u751F\u4EA7\u73AF\u5883",
		  "form.tags": "\u6807\u7B7E",
		  "form.tags.placeholder": "\u9017\u53F7\u5206\u9694\uFF0C\u4F8B\u5982\uFF1Acore,readonly",
		  "form.description": "\u5907\u6CE8",
		  "form.file": "\u6570\u636E\u5E93\u6587\u4EF6",
		  "form.file.placeholder": "\u4F8B\u5982 D:/data/app.db \u6216 :memory:",
		  "form.host": "\u4E3B\u673A",
		  "form.port": "\u7AEF\u53E3",
		  "form.user": "\u7528\u6237",
		  "form.password": "\u5BC6\u7801",
		  "form.password.keep": "\u7559\u7A7A\u5219\u4FDD\u7559\u5DF2\u4FDD\u5B58\u7684\u5BC6\u7801",
		  "form.password.clear": "\u6E05\u7A7A\u5DF2\u4FDD\u5B58\u5BC6\u7801",
		  "form.mysql.noDefaultSchema": "\u8FDE\u63A5\u65F6\u4E0D\u6307\u5B9A\u9ED8\u8BA4\u5E93\uFF0C\u8FDB\u5165\u540E\u53EF\u770B\u5230\u5168\u90E8\u6570\u636E\u5E93\u3002",
		  "form.tls": "\u52A0\u5BC6\u8FDE\u63A5\uFF08TLS\uFF09",
		  "form.tls.hint": "\u542F\u7528\u540E\u8FDE\u63A5\u5168\u7A0B\u52A0\u5BC6\uFF0C\u4F46\u4E0D\u6821\u9A8C\u670D\u52A1\u7AEF\u8BC1\u4E66\uFF08\u81EA\u7B7E\u8BC1\u4E66\u53EF\u7528\uFF09\u3002\u9002\u7528\u4E8E\u9632\u94FE\u8DEF\u7A83\u542C\uFF1B\u5982\u9700\u9632\u4E2D\u95F4\u4EBA\uFF0C\u8BF7\u6539\u7528 SSH \u96A7\u9053\u3002",
		  "form.timeout": "\u8FDE\u63A5\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
		  "form.timeout.unit": "\u6BEB\u79D2",
		  "form.readonly": "\u53EA\u8BFB\uFF08\u62D2\u7EDD agent \u5199\u5165\uFF09",
		  "form.readonly.hint": "\u52FE\u9009\u540E\uFF0C\u5373\u4F7F\u5168\u5C40\u5F00\u542F\u4E86 agent \u5199\u5165\uFF0C\u6B64\u6570\u636E\u6E90\u4E5F\u4E0D\u4F1A\u88AB agent \u4FEE\u6539\u3002",
		  "form.test": "\u6D4B\u8BD5\u8FDE\u63A5",
		  "form.testing": "\u6D4B\u8BD5\u4E2D\u2026",
		  "form.test.ok": "\u8FDE\u63A5\u6210\u529F\uFF08{ms} ms\uFF09{version}",
		  "form.test.note": "\u6CE8\uFF1A{note}",
		  "form.save": "\u4FDD\u5B58",
		  "form.cancel": "\u53D6\u6D88",
		  "form.required": "\u8BF7\u586B\u5199\u5FC5\u586B\u9879\uFF1A{fields}",
		  "form.kindLocked": "\u7F16\u8F91\u65F6\u4E0D\u80FD\u66F4\u6362\u6570\u636E\u5E93\u7C7B\u578B\uFF1B\u5982\u9700\u66F4\u6362\u8BF7\u65B0\u5EFA\u4E00\u4E2A\u6570\u636E\u6E90\u3002",
		  "db.connecting": "\u6B63\u5728\u8FDE\u63A5\u2026",
		  "db.connectFailed": "\u8FDE\u63A5\u5931\u8D25\uFF1A{error}",
		  "db.schemas": "\u6570\u636E\u5E93",
		  "db.tables": "\u8868",
		  "db.noTables": "\uFF08\u65E0\u8868\uFF09",
		  "db.noTablesFiltered": "\uFF08\u8BE5\u5E93\u6709\u8868\uFF0C\u4F46\u6CA1\u6709\u8868\u540D\u5339\u914D\u300C{filter}\u300D\uFF1B\u7B5B\u9009\u6309\u8868\u540D\u5339\u914D\uFF09",
		  "db.searchTable": "\u641C\u7D22\u8868\u540D\u2026",
		  "db.expand": "\u5C55\u5F00",
		  "db.collapse": "\u6298\u53E0",
		  "db.selectTable": "\u4ECE\u5DE6\u4FA7\u9009\u62E9\u4E00\u4E2A\u5E93\uFF0C\u518D\u70B9\u5F00\u4E00\u5F20\u8868",
		  "db.multipleDatabases": "\u6BCF\u4E2A\u5E93\u90FD\u53EF\u5C55\u5F00\uFF0C\u70B9\u5E93\u540D\u770B\u8868\u5217\u8868",
		  "db.selectSchema": "\u4ECE\u5DE6\u4FA7\u9009\u62E9\u4E00\u4E2A\u5E93",
		  "db.overview": "\u8868\u5217\u8868",
		  "db.overviewFor": "{schema} \u2014 \u5171 {n} \u5F20\u8868",
		  "db.overviewEmpty": "\u8BE5\u5E93\u6CA1\u6709\u8868",
		  "db.filterPlaceholder": "\u5305\u542B\u6587\u5B57\uFF1A",
		  "db.select": "\u9009\u4E2D",
		  "db.selectAll": "\u5168\u9009",
		  "db.selectNone": "\u53D6\u6D88\u9009\u62E9",
		  "db.selectedCount": "\u5DF2\u9009 {n} \u5F20\u8868",
		  "db.batchActions": "\u6279\u91CF\u64CD\u4F5C",
		  "db.batch.needsSelection": "\u8BF7\u5148\u52FE\u9009\u8981\u64CD\u4F5C\u7684\u8868",
		  "db.batch.export": "\u5BFC\u51FA\u6240\u9009",
		  "db.batch.exportTitle": "\u5BFC\u51FA\u6240\u9009\u8868",
		  "db.batch.exportBody": "\u5C06\u628A\u6240\u9009\u7684 {n} \u5F20\u8868\u5BFC\u51FA\u4E3A\u4E00\u4E2A SQL \u6587\u4EF6\uFF08\u7ED3\u6784 + \u6570\u636E\uFF09\u3002",
		  "db.batch.truncate": "\u6E05\u7A7A",
		  "db.batch.truncateTitle": "\u6E05\u7A7A\u6240\u9009\u8868",
		  "db.batch.truncateBody": "\u786E\u5B9A\u6E05\u7A7A\u6240\u9009\u7684 {n} \u5F20\u8868\u7684\u5168\u90E8\u6570\u636E\u5417\uFF1F\u8868\u7ED3\u6784\u4F1A\u4FDD\u7559\uFF0C\u4F46\u6570\u636E\u4E0D\u53EF\u6062\u590D\u3002",
		  "db.batch.truncateSkipped": "\u5176\u4E2D {n} \u5F20\u662F\u89C6\u56FE\uFF0C\u6CA1\u6709\u6570\u636E\u53EF\u6E05\u7A7A\uFF0C\u5C06\u8DF3\u8FC7\u3002",
		  "db.batch.drop": "\u5220\u9664",
		  "db.batch.dropTitle": "\u5220\u9664\u6240\u9009\u8868",
		  "db.batch.dropBody": "\u786E\u5B9A\u5220\u9664\u6240\u9009\u7684 {n} \u5F20\u8868\u5417\uFF1F\u8868\u53CA\u5176\u5168\u90E8\u6570\u636E\u90FD\u4F1A\u88AB\u79FB\u9664\uFF0C\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002",
		  /* 清空/删除的完成语按动作分开：「已清空 2 张表」是句子，「已对 2 张表执行 清空」像在填表。 */
		  "db.batch.done.truncate": "\u5DF2\u6E05\u7A7A {n} \u5F20\u8868",
		  "db.batch.done.drop": "\u5DF2\u5220\u9664 {n} \u5F20\u8868",
		  "db.batch.partial": "{ok} \u5F20\u6210\u529F\uFF0C{failed} \u5F20\u5931\u8D25",
		  "db.batch.failedOn": "\u300C{table}\u300D\u5931\u8D25\uFF1A{error}",
		  "db.maint.title": "\u8868\u7EF4\u62A4",
		  "db.maint.check": "\u68C0\u67E5",
		  "db.maint.optimize": "\u4F18\u5316",
		  "db.maint.repair": "\u4FEE\u590D",
		  "db.maint.analyze": "\u5206\u6790",
		  "db.maint.check.hint": "\u68C0\u67E5\u8868\u662F\u5426\u6709\u9519\u8BEF",
		  "db.maint.optimize.hint": "\u56DE\u6536\u672A\u4F7F\u7528\u7684\u7A7A\u95F4\u3001\u6574\u7406\u6570\u636E\u6587\u4EF6",
		  "db.maint.repair.hint": "\u4FEE\u590D\u635F\u574F\u7684\u8868\uFF08\u4EC5 MyISAM \u7B49\u5F15\u64CE\u652F\u6301\uFF09",
		  "db.maint.analyze.hint": "\u66F4\u65B0\u7D22\u5F15\u7EDF\u8BA1\u4FE1\u606F\uFF0C\u4E4B\u540E\u884C\u6570\u624D\u4F1A\u663E\u793A",
		  "db.maint.unsupported": "\u8BE5\u5F15\u64CE\u4E0D\u652F\u6301\u6B64\u64CD\u4F5C",
		  /* 维护的进行中文案按动作分开：把动作名插进「正在执行 {}…」读起来像在填表。 */
		  "db.maint.running.check": "\u6B63\u5728\u68C0\u67E5\u2026",
		  "db.maint.running.optimize": "\u6B63\u5728\u4F18\u5316\u2026",
		  "db.maint.running.repair": "\u6B63\u5728\u4FEE\u590D\u2026",
		  "db.maint.running.analyze": "\u6B63\u5728\u5206\u6790\u2026",
		  "db.maint.resultCount": "\u5171 {n} \u5F20\u8868\uFF1A{ok} \u5F20\u6B63\u5E38\uFF0C{failed} \u5F20\u6709\u95EE\u9898",
		  "db.maint.scopeWholeDb": "\u6CE8\uFF1A\u8BE5\u64CD\u4F5C\u4F5C\u7528\u4E8E\u6574\u4E2A\u6570\u636E\u5E93\u6587\u4EF6\uFF0C\u4E0D\u662F\u5355\u5F20\u8868",
		  "db.maint.repairMissing": "SQLite \u6CA1\u6709 REPAIR \u8BED\u53E5\uFF1B\u8868\u635F\u574F\u65F6\u8BF7\u4ECE\u5907\u4EFD\u6062\u590D\u6216\u5BFC\u51FA\u540E\u91CD\u5EFA\uFF0C\u53EF\u5148\u7528\u300C\u68C0\u67E5\u300D\u786E\u8BA4\u8303\u56F4\u3002",
		  "db.op.title": "\u6570\u636E\u5E93\u64CD\u4F5C",
		  "db.op.create": "\u65B0\u5EFA\u6570\u636E\u5E93",
		  "db.op.createTitle": "\u65B0\u5EFA\u6570\u636E\u5E93",
		  "db.op.createBody": "\u5728\u540C\u4E00\u53F0\u670D\u52A1\u5668\u4E0A\u521B\u5EFA\u4E00\u4E2A\u65B0\u6570\u636E\u5E93\u3002",
		  "db.op.name": "\u6570\u636E\u5E93\u540D",
		  "db.op.charset": "\u5B57\u7B26\u96C6",
		  "db.op.collate": "\u6392\u5E8F\u89C4\u5219",
		  "db.op.collateHint": "\u300C{charset}\u300D\u5171\u6709 {n} \u4E2A\u6392\u5E8F\u89C4\u5219\u53EF\u9009\u3002",
		  "db.op.collateDefault": "\uFF08\u4F7F\u7528\u8BE5\u5B57\u7B26\u96C6\u7684\u9ED8\u8BA4\u6392\u5E8F\u89C4\u5219\uFF09",
		  "db.op.collateIsDefault": "\uFF08\u9ED8\u8BA4\uFF09",
		  "db.op.collateNeedsCharset": "\u8BF7\u5148\u9009\u62E9\u5B57\u7B26\u96C6\uFF0C\u6392\u5E8F\u89C4\u5219\u7531\u5B57\u7B26\u96C6\u51B3\u5B9A\u3002",
		  "db.op.collateUnavailable": "\u672A\u53D6\u5F97\u8BE5\u5B57\u7B26\u96C6\u7684\u6392\u5E8F\u89C4\u5219\u5217\u8868\uFF0C\u53EF\u76F4\u63A5\u586B\u5199\u6216\u7559\u7A7A\u3002",
		  "db.op.rename": "\u91CD\u547D\u540D",
		  "db.op.renameTitle": "\u91CD\u547D\u540D\u6570\u636E\u5E93\u300C{from}\u300D",
		  "db.op.renameBody": "MySQL \u6CA1\u6709 RENAME DATABASE\uFF0C\u8FD9\u4E00\u6B65\u4F1A\u65B0\u5EFA\u76EE\u6807\u5E93\u3001\u628A\u6240\u6709\u8868\u79FB\u8FC7\u53BB\u3001\u518D\u5220\u9664\u539F\u5E93\u3002\u5927\u5E93\u4E0A\u9700\u8981\u65F6\u95F4\u3002",
		  "db.op.copy": "\u590D\u5236\u6570\u636E\u5E93",
		  "db.op.copyTitle": "\u590D\u5236\u6570\u636E\u5E93\u300C{from}\u300D",
		  "db.op.copyBody": "\u628A\u7ED3\u6784\u4E0E\u6570\u636E\u590D\u5236\u5230\u4E00\u4E2A\u65B0\u5E93\u3002\u89C6\u56FE\u4E0D\u4F1A\u88AB\u590D\u5236\uFF08MySQL \u7684 CREATE TABLE \u2026 LIKE \u65E0\u6CD5\u590D\u5236\u89C6\u56FE\uFF09\u3002",
		  "db.op.copyData": "\u540C\u65F6\u590D\u5236\u6570\u636E",
		  "db.op.drop": "\u5220\u9664\u6570\u636E\u5E93",
		  "db.op.dropTitle": "\u5220\u9664\u6570\u636E\u5E93\u300C{from}\u300D",
		  "db.op.dropBody": "\u8BE5\u5E93\u53CA\u5176\u6240\u6709\u8868\u3001\u6240\u6709\u6570\u636E\u90FD\u4F1A\u88AB\u5220\u9664\uFF0C\u4E0D\u53EF\u6062\u590D\u3002\u8BF7\u8F93\u5165\u5E93\u540D\u4EE5\u786E\u8BA4\uFF1A",
		  "db.op.dropConfirm": "\u8BF7\u8F93\u5165\u300C{from}\u300D\u4EE5\u786E\u8BA4",
		  "db.op.charsetTitle": "\u4FEE\u6539\u6570\u636E\u5E93\u300C{from}\u300D\u7684\u5B57\u7B26\u96C6",
		  "db.op.charsetBody": "\u8FD9\u53EA\u6539\u6570\u636E\u5E93\u7684\u9ED8\u8BA4\u5B57\u7B26\u96C6\uFF0C\u4E0D\u4F1A\u8F6C\u6362\u5DF2\u6709\u8868\u4E0E\u5217\u3002",
		  "db.op.charsetCurrent": "\u5F53\u524D\uFF1A\u5B57\u7B26\u96C6 {charset}\uFF0C\u6392\u5E8F\u89C4\u5219 {collate}",
		  "db.op.charsetNoSqlite": "SQLite \u6CA1\u6709\u53EF\u4FEE\u6539\u7684\u5E93\u7F16\u7801\uFF1A\u6574\u4E2A\u5E93\u56FA\u5B9A\u4E3A UTF-8\u3002",
		  "db.op.newName": "\u65B0\u540D\u79F0",
		  "db.op.submit": "\u6267\u884C",
		  "db.op.busy": "\u6B63\u5728\u6267\u884C\u2026",
		  /*
		   * The completion phrase per operation, kept SEPARATE from the button label.
		   *
		   * The shared `db.op.done` template used to interpolate the button label, and for
		   * 修改字符集 that label is the noun 字符集 — so the notice read 已字符集「dsh」. A button
		   * label is what a control is CALLED; a completion message needs a verb. Sharing one
		   * key forced a noun into a verb slot. Each operation now names its own completion,
		   * so a label can be reworded for the button without breaking the notice.
		   */
		  "db.op.done.create": "\u5DF2\u521B\u5EFA\u6570\u636E\u5E93\u300C{name}\u300D",
		  "db.op.done.rename": "\u5DF2\u628A\u6570\u636E\u5E93\u91CD\u547D\u540D\u4E3A\u300C{name}\u300D",
		  "db.op.done.copy": "\u5DF2\u590D\u5236\u4E3A\u6570\u636E\u5E93\u300C{name}\u300D",
		  "db.op.done.drop": "\u5DF2\u5220\u9664\u6570\u636E\u5E93\u300C{name}\u300D",
		  "db.op.done.charset": "\u5DF2\u4FEE\u6539\u6570\u636E\u5E93\u300C{name}\u300D\u7684\u5B57\u7B26\u96C6",
		  "db.op.nameTaken": "\u5DF2\u5B58\u5728\u540C\u540D\u6570\u636E\u5E93",
		  "db.op.nameRequired": "\u8BF7\u586B\u5199\u6570\u636E\u5E93\u540D",
		  /*
		   * The message states the rule the check ACTUALLY applies, character for character.
		   *
		   * It used to say "letters, digits and underscores, and may not start with a digit",
		   * while the regex also accepted `$`, spaces and hyphens and DID allow a leading
		   * digit — so `my-db` and `123db` were accepted despite the message saying otherwise.
		   * A validation message that disagrees with its validation is worse than no message:
		   * it teaches the user a rule that is not the one in force. The regex was tightened to
		   * match this text, and the accepted set is deliberately conservative because a
		   * database name reaches the filesystem and the command line on some setups.
		   */
		  "db.op.nameInvalid": "\u6570\u636E\u5E93\u540D\u53EA\u80FD\u7528\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\uFF0C\u4E14\u4E0D\u80FD\u4EE5\u6570\u5B57\u5F00\u5934",
		  "db.op.notSupported": "\u8BE5\u5F15\u64CE\u4E0D\u652F\u6301\u6B64\u64CD\u4F5C",
		  "db.op.createHint": "SQLite \u7684\u5E93\u662F\u4E00\u4E2A\u6587\u4EF6\uFF0C\u56E0\u6B64\u300C\u65B0\u5EFA\u5E93\u300D= \u65B0\u5EFA\u6570\u636E\u6E90\u5E76\u6307\u5411\u4E00\u4E2A\u65B0\u6587\u4EF6\u3002",
		  "db.op.exportDb": "\u5BFC\u51FA\u6574\u5E93",
		  "db.op.importDb": "\u5BFC\u5165\u5230\u672C\u5E93",
		  "db.op.refreshSchemas": "\u5237\u65B0\u5E93\u5217\u8868",
		  "db.op.createTable": "\u65B0\u5EFA\u8868",
		  /*
		   * 操作 tab: the table-level page phpMyAdmin's 操作 offers.
		   *
		   * The wording follows phpMyAdmin's own, because the user asked for that page by
		   * name ("像 phpmyadmin 一样") — 「将数据表移动到」、「表选项」、「将数据表复制到」. A
		   * clearer phrasing invented here would make the user hunt for the control they
		   * described.
		   *
		   * The block titles are the actions, and the reason a block is disabled is stated in
		   * the block itself rather than only in a tooltip: a tooltip needs a hover, and a
		   * control that reads as broken until hovered is the thing this avoids.
		   */
		  "tableop.title": "\u8868\u64CD\u4F5C",
		  "tableop.scope": "{schema} \xB7 {table}",
		  "tableop.viewHint": "\u300C{table}\u300D\u662F\u89C6\u56FE\uFF0C\u4E0B\u9762\u8FD9\u4E9B\u64CD\u4F5C\u53EA\u5BF9\u8868\u6709\u6548\u3002",
		  "tableop.move.title": "\u5C06\u6570\u636E\u8868\u79FB\u52A8\u5230",
		  "tableop.move.body": "\u628A\u8FD9\u5F20\u8868\u548C\u5B83\u7684\u5168\u90E8\u6570\u636E\u6574\u4F53\u79FB\u52A8\u5230\u53E6\u4E00\u4E2A\u5E93\uFF1B\u539F\u5E93\u4E2D\u4E0D\u518D\u6709\u8FD9\u5F20\u8868\u3002",
		  "tableop.move.target": "\u76EE\u6807\uFF08\u6570\u636E\u5E93.\u6570\u636E\u8868\uFF09",
		  "tableop.move.submit": "\u79FB\u52A8",
		  "tableop.move.busy": "\u6B63\u5728\u79FB\u52A8\u2026",
		  "tableop.move.done": "\u5DF2\u628A\u300C{from}\u300D\u79FB\u52A8\u5230\u300C{to}\u300D",
		  "tableop.move.same": "\u8FD9\u5C31\u662F\u5B83\u73B0\u5728\u7684\u4F4D\u7F6E\uFF0C\u8BF7\u6362\u4E00\u4E2A\u5E93\u6216\u6362\u4E00\u4E2A\u8868\u540D",
		  "tableop.move.needsName": "\u8BF7\u586B\u5199\u76EE\u6807\u8868\u540D",
		  "tableop.options.title": "\u8868\u9009\u9879",
		  "tableop.options.body": "\u6539\u8FD9\u5F20\u8868\u81EA\u8EAB\u7684\u9009\u9879\uFF1B\u53EA\u63D0\u4EA4\u4F60\u6539\u8FC7\u7684\u5B57\u6BB5\uFF0C\u6CA1\u52A8\u8FC7\u7684\u4FDD\u6301\u539F\u6837\u3002",
		  "tableop.options.loading": "\u6B63\u5728\u8BFB\u53D6\u8868\u9009\u9879\u2026",
		  "tableop.options.engine": "\u5B58\u50A8\u5F15\u64CE",
		  "tableop.options.collation": "\u6574\u7406\uFF08\u6392\u5E8F\u89C4\u5219\uFF09",
		  "tableop.options.collationHint": "\u5B57\u7B26\u96C6\u7531\u6392\u5E8F\u89C4\u5219\u51B3\u5B9A\uFF0C\u4F1A\u81EA\u52A8\u4E00\u5E76\u8BBE\u7F6E\u3002",
		  "tableop.options.convert": "\u540C\u65F6\u8F6C\u6362\u5DF2\u6709\u5217\u7684\u5B57\u7B26\u96C6\uFF08CONVERT TO\uFF0C\u4F1A\u91CD\u5199\u6574\u8868\u6570\u636E\uFF09",
		  "tableop.options.convertHint": "\u4E0D\u52FE\u9009\u65F6\u53EA\u6539\u8868\u7684\u9ED8\u8BA4\u503C\uFF0C\u5DF2\u6709\u5217\u4E0D\u53D8\uFF1B\u52FE\u9009\u540E\u6309\u65B0\u5B57\u7B26\u96C6\u91CD\u5199\u6BCF\u4E00\u5217\uFF0C\u8017\u65F6\u4E0E\u8868\u5927\u5C0F\u6210\u6B63\u6BD4\u3002",
		  "tableop.options.comment": "\u8868\u6CE8\u91CA",
		  "tableop.options.autoIncrement": "\u4E0B\u4E00\u4E2A AUTO_INCREMENT \u503C",
		  "tableop.options.autoIncrementHint": "\u53EA\u5728\u8FD9\u5F20\u8868\u6709\u81EA\u589E\u5217\u65F6\u51FA\u73B0\u3002\u6BD4\u5F53\u524D\u5DF2\u7528\u8FC7\u7684\u503C\u5C0F\u65F6\uFF0CMySQL \u4F1A\u5FFD\u7565\u4E0B\u8C03\u7684\u90E8\u5206\u3002",
		  "tableop.options.rowFormat": "\u884C\u683C\u5F0F",
		  "tableop.options.rowFormatDefault": "\uFF08\u4E0D\u6307\u5B9A\uFF09",
		  "tableop.options.submit": "\u4FDD\u5B58\u8868\u9009\u9879",
		  "tableop.options.busy": "\u6B63\u5728\u4FDD\u5B58\u2026",
		  "tableop.options.done": "\u5DF2\u4FDD\u5B58\u300C{table}\u300D\u7684\u8868\u9009\u9879",
		  "tableop.options.unchanged": "\u6CA1\u6709\u6539\u8FC7\u4EFB\u4F55\u5B57\u6BB5",
		  "tableop.options.aiInvalid": "AUTO_INCREMENT \u9700\u8981\u662F\u4E00\u4E2A\u4E0D\u5C0F\u4E8E 1 \u7684\u6574\u6570",
		  "tableop.options.commentBackslash": "\u8868\u6CE8\u91CA\u4E0D\u80FD\u5305\u542B\u53CD\u659C\u6760\uFF1AMySQL \u4F1A\u628A\u53CD\u659C\u6760\u5F53\u8F6C\u4E49\u7B26\uFF0C\u5199\u8FDB\u53BB\u7684\u548C\u8BFB\u51FA\u6765\u7684\u4E0D\u4E00\u81F4",
		  "tableop.copy.title": "\u5C06\u6570\u636E\u8868\u590D\u5236\u5230",
		  "tableop.copy.body": "\u628A\u7ED3\u6784\u4E0E\u6570\u636E\u590D\u5236\u6210\u53E6\u4E00\u4E2A\u5E93\u91CC\u7684\u65B0\u8868\uFF0C\u539F\u8868\u4FDD\u6301\u4E0D\u53D8\u3002\u7D22\u5F15\u3001\u4E3B\u952E\u4F1A\u4E00\u5E76\u590D\u5236\uFF1B\u89E6\u53D1\u5668\u4E0E\u6307\u5411\u5916\u90E8\u7684\u5916\u952E\u4E0D\u4F1A\u3002",
		  "tableop.copy.target": "\u76EE\u6807\uFF08\u6570\u636E\u5E93.\u6570\u636E\u8868\uFF09",
		  "tableop.copy.data": "\u540C\u65F6\u590D\u5236\u6570\u636E",
		  "tableop.copy.dataHint": "\u4E0D\u52FE\u9009\u5219\u53EA\u590D\u5236\u7ED3\u6784\uFF08phpMyAdmin \u7684\u300C\u4EC5\u7ED3\u6784\u300D\uFF09\u3002",
		  "tableop.copy.submit": "\u590D\u5236",
		  "tableop.copy.busy": "\u6B63\u5728\u590D\u5236\u2026",
		  "tableop.copy.done": "\u5DF2\u590D\u5236\u4E3A\u300C{to}\u300D",
		  "tableop.copy.needsName": "\u8BF7\u586B\u5199\u76EE\u6807\u8868\u540D",
		  "tableop.copy.same": "\u6E90\u548C\u76EE\u6807\u4E0D\u80FD\u662F\u540C\u4E00\u5F20\u8868",
		  "tableop.maint.title": "\u8868\u7EF4\u62A4",
		  "tableop.maint.body": "\u5BF9\u8FD9\u5F20\u8868\u6267\u884C\u5F15\u64CE\u7684\u7EF4\u62A4\u8BED\u53E5\uFF0C\u7ED3\u679C\u91CC\u4F1A\u539F\u6837\u5217\u51FA\u5F15\u64CE\u81EA\u5DF1\u7684\u8BF4\u660E\uFF08\u4F8B\u5982 InnoDB \u7684\u8868\u4E0D\u652F\u6301 repair\uFF09\u3002",
		  "tableop.maint.check": "\u68C0\u67E5\u8868",
		  "tableop.maint.optimize": "\u4F18\u5316\u8868",
		  "tableop.maint.repair": "\u4FEE\u590D\u8868",
		  "tableop.maint.analyze": "\u5206\u6790\u8868",
		  "tableop.maint.unsupported": "\u8BE5\u5F15\u64CE\u4E0D\u652F\u6301\u6B64\u64CD\u4F5C",
		  "tableop.maint.repairMissing": "SQLite \u6CA1\u6709 REPAIR \u8BED\u53E5\uFF1B\u8868\u635F\u574F\u65F6\u8BF7\u4ECE\u5907\u4EFD\u6062\u590D\u6216\u5BFC\u51FA\u540E\u91CD\u5EFA\uFF0C\u53EF\u5148\u7528\u300C\u68C0\u67E5\u8868\u300D\u786E\u8BA4\u8303\u56F4\u3002",
		  "tableop.danger.title": "\u5220\u9664\u6570\u636E\u6216\u6570\u636E\u8868",
		  "tableop.danger.body": "\u4E24\u4E2A\u90FD\u4E0D\u53EF\u6062\u590D\uFF1B\u6E05\u7A7A\u53EA\u5220\u6570\u636E\uFF0C\u5220\u9664\u8868\u8FDE\u7ED3\u6784\u4E00\u8D77\u53BB\u6389\u3002",
		  "tableop.danger.truncate": "\u6E05\u7A7A\u6570\u636E\uFF08\u4FDD\u7559\u8868\u7ED3\u6784\uFF09",
		  "tableop.danger.truncateHint": "SQLite \u4E0A\u662F DELETE FROM\uFF0C\u884C\u88AB\u9010\u6761\u5220\u9664\uFF0C\u4E14\u4E0D\u4F1A\u91CD\u7F6E AUTOINCREMENT \u8BA1\u6570\u3002",
		  "tableop.danger.drop": "\u5220\u9664\u8868",
		  "tableop.danger.dropHint": "\u8868\u3001\u5B83\u7684\u5168\u90E8\u6570\u636E\u3001\u7D22\u5F15\u548C\u89E6\u53D1\u5668\u90FD\u4F1A\u88AB\u79FB\u9664\u3002",
		  "tableop.danger.viewTruncate": "\u300C{table}\u300D\u662F\u89C6\u56FE\uFF0C\u6CA1\u6709\u81EA\u5DF1\u7684\u6570\u636E\u53EF\u4EE5\u6E05\u7A7A\u3002",
		  "tableop.unsupported.move": "SQLite \u7684\u5E93\u5C31\u662F\u4E00\u4E2A\u6587\u4EF6\uFF0C\u8868\u4E0D\u80FD\u79FB\u52A8\u5230\u53E6\u4E00\u4E2A\u5E93\uFF1B\u5982\u9700\u8FC1\u79FB\uFF0C\u8BF7\u5BFC\u51FA\u6210 SQL \u518D\u5BFC\u5165\u3002",
		  "tableop.unsupported.copy": "SQLite \u6CA1\u6709\u5FE0\u5B9E\u7684\u590D\u5236\u8868\u8BED\u53E5\uFF1ACREATE TABLE \u2026 AS SELECT \u4F1A\u4E22\u6389\u4E3B\u952E\u3001\u552F\u4E00\u7EA6\u675F\u4E0E\u751F\u6210\u5217\u3002\u8BF7\u7528\u300C\u5BFC\u51FA\u300D\u518D\u300C\u5BFC\u5165\u300D\u3002",
		  "tableop.unsupported.options": "SQLite \u6CA1\u6709\u53EF\u4FEE\u6539\u7684\u8868\u9009\u9879\uFF1A\u6CA1\u6709\u5B58\u50A8\u5F15\u64CE\u3001\u6CA1\u6709\u8868\u7EA7\u6392\u5E8F\u89C4\u5219\u3001\u6CA1\u6709\u8868\u6CE8\u91CA\u7684\u5B58\u653E\u5904\u3002",
		  "tableop.supportFailed": "\u672A\u80FD\u8BFB\u53D6\u8BE5\u5F15\u64CE\u652F\u6301\u7684\u8868\u64CD\u4F5C\u5217\u8868\uFF1A{error}",
		  "createTable.title": "\u65B0\u5EFA\u8868",
		  "createTable.tableName": "\u8868\u540D",
		  "createTable.columnName": "\u5B57\u6BB5\u540D",
		  "createTable.columnNamePlaceholder": "\u4F8B\u5982 id",
		  "createTable.columnType": "\u7C7B\u578B",
		  /* 类型下拉的分组与自定义项 */
		  "createTable.group.integer": "\u6574\u6570",
		  "createTable.group.float": "\u5C0F\u6570\u4E0E\u6D6E\u70B9",
		  "createTable.group.string": "\u6587\u672C\u4E0E\u5B57\u7B26",
		  "createTable.group.binary": "\u4E8C\u8FDB\u5236\u4E0E\u5927\u5BF9\u8C61",
		  "createTable.group.temporal": "\u65E5\u671F\u4E0E\u65F6\u95F4",
		  "createTable.group.spatial": "\u7A7A\u95F4\u7C7B\u578B",
		  "createTable.group.other": "\u5176\u4ED6",
		  "createTable.typeCustom": "\u81EA\u5B9A\u4E49\u2026",
		  /* Marks the synthetic entry that carries a custom value back into the list. */
		  "createTable.typeCustomMark": "\uFF08\u81EA\u5B9A\u4E49\uFF09",
		  "createTable.typeCustomPlaceholder": "\u4F8B\u5982 decimal(10,2) unsigned",
		  "createTable.typeText": "\u81EA\u5B9A\u4E49\u7C7B\u578B",
		  "createTable.typeBackToList": "\u8FD4\u56DE\u7C7B\u578B\u5217\u8868",
		  "createTable.attributesClear": "\u6E05\u9664\u5DF2\u9009\u5C5E\u6027",
		  "createTable.thisColumn": "\u672C\u5B57\u6BB5",
		  "createTable.columnLength": "\u957F\u5EA6/\u503C",
		  "createTable.lengthHint": "\u5982 255\uFF0C\u6216 DECIMAL \u7528 10,2\uFF0C\u6216 ENUM \u7528 'a','b'",
		  "createTable.lengthRequired": "\u5B57\u6BB5\u300C{name}\u300D\u7684\u7C7B\u578B {type} \u5FC5\u987B\u586B\u957F\u5EA6/\u503C\uFF1AMySQL \u4E0D\u63A5\u53D7\u4E0D\u5E26\u62EC\u53F7\u7684 {type}",
		  "createTable.sqliteLengthHint": "SQLite \u8BF7\u76F4\u63A5\u5199\u8FDB\u7C7B\u578B",
		  "createTable.sqliteNoLength": "SQLite \u4E0D\u652F\u6301\u72EC\u7ACB\u7684\u957F\u5EA6/\u503C\uFF08\u5217\u300C{name}\u300D\uFF09\uFF1A\u5B83\u4F1A\u628A\u957F\u5EA6\u7559\u5728\u7C7B\u578B\u540D\u91CC\u4F46\u6CA1\u6709\u4EFB\u4F55\u7EA6\u675F\u529B\u3002\u8BF7\u628A\u957F\u5EA6\u76F4\u63A5\u5199\u8FDB\u7C7B\u578B\uFF0C\u5982 VARCHAR(20)\u3002",
		  "createTable.columnCollate": "\u6392\u5E8F\u89C4\u5219",
		  "createTable.columnAttributes": "\u5C5E\u6027",
		  "createTable.attributeUnavailable": "\u5F53\u524D\u7C7B\u578B\u4E0D\u652F\u6301\u8BE5\u5C5E\u6027",
		  "createTable.attributesHint": "\u5C5E\u6027\u7684\u53EF\u7528\u6027\u53D6\u51B3\u4E8E\u7C7B\u578B\uFF1AUNSIGNED/ZEROFILL \u9650\u6570\u503C\uFF0CBINARY \u9650\u5B57\u7B26\u7C7B\u578B\uFF0CON UPDATE \u9650\u65F6\u95F4\u7C7B\u578B",
		  "createTable.attributeNotForType": "\u5B57\u6BB5\u300C{name}\u300D\u7684\u7C7B\u578B {type} \u4E0D\u652F\u6301\u6240\u9009\u5C5E\u6027",
		  "createTable.attrOnUpdate": "ON UPDATE",
		  "createTable.columnIndex": "\u7D22\u5F15",
		  "createTable.index.primary": "PRIMARY",
		  "createTable.index.unique": "UNIQUE",
		  "createTable.index.index": "INDEX",
		  "createTable.index.fulltext": "FULLTEXT",
		  "createTable.index.spatial": "SPATIAL",
		  "createTable.indexUnavailable": "\u5F53\u524D\u7C7B\u578B\u4E0D\u652F\u6301",
		  "createTable.indexName": "\u7D22\u5F15\u540D",
		  "createTable.indexNamePlaceholder": "\u53EF\u7559\u7A7A",
		  "createTable.indexNameHint": "\u7559\u7A7A\u5219\u81EA\u52A8\u547D\u540D\uFF1B\u591A\u4E2A\u5B57\u6BB5\u586B\u540C\u4E00\u4E2A\u7D22\u5F15\u540D\u5373\u7EC4\u6210\u8054\u5408\u7D22\u5F15\uFF0C\u987A\u5E8F\u6309\u5B57\u6BB5\u987A\u5E8F",
		  "createTable.compositeHint": "\u8054\u5408\u7D22\u5F15\uFF1A\u5728\u300C\u7D22\u5F15\u300D\u4E0B\u62C9\u91CC\u4E3A\u8FD9\u4E9B\u5B57\u6BB5\u9009\u540C\u4E00\u79CD\u7D22\u5F15\u7C7B\u578B\uFF0C\u518D\u628A\u5B83\u4EEC\u7684\u300C\u7D22\u5F15\u540D\u300D\u586B\u6210\u540C\u4E00\u4E2A\u540D\u5B57\uFF0C\u8FD9\u4E9B\u5B57\u6BB5\u5C31\u7EC4\u6210\u4E00\u4E2A\u8054\u5408\u7D22\u5F15\uFF0C\u5B57\u6BB5\u987A\u5E8F\u5373\u7D22\u5F15\u5217\u987A\u5E8F\u3002\u7D22\u5F15\u540D\u7559\u7A7A\u5219\u8BE5\u5B57\u6BB5\u5355\u72EC\u5EFA\u4E00\u4E2A\u7D22\u5F15\u3002",
		  "createTable.fulltextNeedsText": "FULLTEXT \u7D22\u5F15\u9700\u8981\u6587\u672C\u7C7B\u578B\uFF0C\u5B57\u6BB5\u300C{name}\u300D\u662F {type}",
		  "createTable.spatialNeedsGeometry": "SPATIAL \u7D22\u5F15\u9700\u8981\u7A7A\u95F4\u7C7B\u578B\u4E14\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u5B57\u6BB5\u300C{name}\u300D\u4E0D\u6EE1\u8DB3",
		  "createTable.columnComment": "\u6CE8\u91CA",
		  "createTable.sqliteNoCommentShort": "SQLite \u65E0\u6CE8\u91CA",
		  "createTable.sqliteNoComment": "SQLite \u4E0D\u652F\u6301\u5217\u6CE8\u91CA\uFF08\u5217\u300C{name}\u300D\uFF09\uFF1A\u5B83\u6CA1\u6709\u5B58\u50A8\u6CE8\u91CA\u7684\u5730\u65B9",
		  "createTable.tableComment": "\u8868\u6CE8\u91CA",
		  "createTable.tableCommentHint": "MySQL \u7684\u8868\u6CE8\u91CA",
		  "createTable.sqliteNoTableComment": "SQLite \u4E0D\u652F\u6301\u8868\u6CE8\u91CA\uFF1A\u5B83\u6CA1\u6709\u5B58\u50A8\u8868\u6CE8\u91CA\u7684\u5730\u65B9",
		  "createTable.sqliteNoTableCommentShort": "SQLite \u65E0\u8868\u6CE8\u91CA",
		  "createTable.tableCollate": "\u6574\u7406\uFF08\u6392\u5E8F\u89C4\u5219\uFF09",
		  "createTable.tableCollateDefault": "\uFF08\u7528\u9ED8\u8BA4\uFF09",
		  "createTable.sqliteNoTableCollate": "SQLite \u6CA1\u6709\u8868\u7EA7\u6392\u5E8F\u89C4\u5219\uFF0C\u6392\u5E8F\u89C4\u5219\u53EA\u80FD\u9010\u5217\u6307\u5B9A",
		  "createTable.sqliteNoTableCollateShort": "SQLite \u65E0\u8868\u7EA7\u6392\u5E8F\u89C4\u5219",
		  "createTable.tableEngine": "\u5B58\u50A8\u5F15\u64CE",
		  "createTable.sqliteNoEngine": "SQLite \u6CA1\u6709\u5B58\u50A8\u5F15\u64CE\u53EF\u9009",
		  "createTable.sqliteNoEngineShort": "SQLite \u65E0\u5F15\u64CE",
		  "createTable.tableTail": "\u8868\u9009\u9879",
		  "createTable.lengthInvalid": "\u5B57\u6BB5\u300C{name}\u300D\u7684\u957F\u5EA6/\u503C\u4E0D\u5408\u6CD5\uFF1A\u53EA\u652F\u6301\u6570\u5B57\uFF08\u5982 255 \u6216 10,2\uFF09\u6216\u5F15\u53F7\u5305\u88F9\u7684\u503C\uFF08\u5982 'a','b'\uFF09",
		  "createTable.autoNeedsNumeric": "{name} \u8981\u81EA\u589E\uFF0C\u7C7B\u578B\u987B\u4E3A\u6570\u503C\u7C7B\u578B",
		  "createTable.attributeSqliteUnsupported": "SQLite \u4E0D\u652F\u6301\u5217\u5C5E\u6027\uFF0C\u8FD9\u4E9B\u8BCD\u4F1A\u88AB\u5E76\u5165\u7C7B\u578B\u540D\u800C\u4E0D\u4EA7\u751F\u4EFB\u4F55\u6548\u679C",
		  "createTable.columnKey": "\u4E3B\u952E",
		  "createTable.columnNullable": "\u5141\u8BB8\u7A7A",
		  "createTable.columnDefault": "\u9ED8\u8BA4\u503C",
		  "createTable.default.custom": "\u81EA\u5B9A\u4E49\u2026",
		  "createTable.default.text": "\u9ED8\u8BA4\u503C\u5185\u5BB9",
		  "createTable.default.backToList": "\u8FD4\u56DE\u9ED8\u8BA4\u503C\u5217\u8868\uFF08\u4E0D\u8BBE\u7F6E\uFF09",
		  "createTable.default.emptyString": "\u7559\u7A7A\u5373\u7A7A\u5B57\u7B26\u4E32 ''",
		  "createTable.default.needsTemporal": "\u4EC5\u65F6\u95F4\u7C7B\u578B\u53EF\u7528",
		  "createTable.default.hint": "\u4E0D\u8BBE\u7F6E\uFF1D\u6CA1\u6709\u9ED8\u8BA4\u503C\uFF1B\u8981\u7A7A\u5B57\u7B26\u4E32\u8BF7\u9009\u300C\u81EA\u5B9A\u4E49\u2026\u300D\u5E76\u7559\u7A7A\uFF0C\u8BE5\u683C\u4F1A\u76F4\u63A5\u53D8\u6210\u8F93\u5165\u6846\uFF0C\u586B\u5B8C\u53EF\u70B9 \u21BA \u8FD4\u56DE\u3002\u4E0D\u5141\u8BB8\u7A7A\u7684\u5B57\u6BB5\u4E0D\u80FD\u9009 NULL\u3002",
		  "createTable.columnAuto": "\u81EA\u589E",
		  "createTable.addColumn": "+ \u6DFB\u52A0\u5B57\u6BB5",
		  "createTable.removeColumn": "\u5220\u9664\u8BE5\u5B57\u6BB5",
		  "createTable.lastColumn": "\u81F3\u5C11\u8981\u4FDD\u7559\u4E00\u4E2A\u5B57\u6BB5",
		  "createTable.keyNotNullable": "\u4E3B\u952E\u5B57\u6BB5\u4E0D\u80FD\u4E3A\u7A7A",
		  "createTable.autoNeedsKey": "\u8981\u81EA\u589E\uFF0C\u8BE5\u5B57\u6BB5\u987B\u8BBE\u4E3A PRIMARY \u4E3B\u952E",
		  "createTable.autoAlreadyTaken": "\u4E00\u5F20\u8868\u53EA\u80FD\u6709\u4E00\u4E2A\u81EA\u589E\u5B57\u6BB5\uFF0C\u5DF2\u7531\u300C{name}\u300D\u5360\u7528",
		  "createTable.autoNeedsInteger": "SQLite \u4E0A {name} \u987B\u4E3A INTEGER \u624D\u80FD\u81EA\u589E\uFF08INT \u4E0D\u662F rowid \u522B\u540D\uFF09",
		  "createTable.hint": "\u65B0\u589E\u5B57\u6BB5\u9ED8\u8BA4 INT\u3001\u957F\u5EA6/\u503C\u7559\u7A7A\u3001\u4E0D\u5141\u8BB8\u7A7A\uFF1B\u7C7B\u578B\u4ECE\u4E0B\u62C9\u9009\uFF0C\u672B\u9879\u300C\u81EA\u5B9A\u4E49\u2026\u300D\u53EF\u8F93\u5165\u4EFB\u610F\u7C7B\u578B\u3002VARCHAR / VARBINARY / ENUM / SET \u5FC5\u987B\u81EA\u5DF1\u586B\u957F\u5EA6\u6216\u53D6\u503C\u3002",
		  "createTable.submit": "\u521B\u5EFA",
		  "createTable.nameRequired": "\u8BF7\u586B\u5199\u8868\u540D",
		  "createTable.nameInvalid": "\u8868\u540D\u53EA\u80FD\u7528\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\uFF0C\u4E14\u4E0D\u4EE5\u6570\u5B57\u5F00\u5934",
		  "createTable.nameTaken": "\u5DF2\u5B58\u5728\u540D\u4E3A\u300C{table}\u300D\u7684\u8868",
		  "createTable.columnNameRequired": "\u7B2C {n} \u4E2A\u5B57\u6BB5\u8FD8\u6CA1\u586B\u5B57\u6BB5\u540D",
		  "createTable.columnNameInvalid": "\u5B57\u6BB5\u540D\u300C{name}\u300D\u4E0D\u5408\u6CD5\uFF1A\u53EA\u80FD\u7528\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\uFF0C\u4E14\u4E0D\u4EE5\u6570\u5B57\u5F00\u5934",
		  "createTable.columnDuplicated": "\u5B57\u6BB5\u540D\u300C{name}\u300D\u91CD\u590D\u4E86",
		  "createTable.columnTypeRequired": "\u5B57\u6BB5\u300C{name}\u300D\u8FD8\u6CA1\u586B\u7C7B\u578B",
		  "createTable.autoIncrementDefault": "\u5B57\u6BB5\u300C{name}\u300D\u662F\u81EA\u589E\uFF0C\u4E0D\u80FD\u518D\u8BBE\u9ED8\u8BA4\u503C",
		  "createTable.nullDefaultNeedsNullable": "\u5B57\u6BB5\u300C{name}\u300D\u7684\u9ED8\u8BA4\u503C\u662F NULL\uFF0C\u4F46\u300C\u5141\u8BB8\u7A7A\u300D\u6CA1\u52FE\u9009\uFF1AMySQL \u4E0D\u63A5\u53D7 NOT NULL \u5217\u9ED8\u8BA4 NULL\u3002\u8BF7\u52FE\u4E0A\u300C\u5141\u8BB8\u7A7A\u300D\uFF0C\u6216\u628A\u9ED8\u8BA4\u503C\u6539\u6210\u522B\u7684\u3002",
		  "createTable.oneAutoIncrement": "\u53EA\u80FD\u6709\u4E00\u4E2A\u81EA\u589E\u5B57\u6BB5\uFF0C\u5F53\u524D\u52FE\u9009\u4E86\uFF1A{names}",
		  "createTable.done": "\u5DF2\u521B\u5EFA\u8868\u300C{table}\u300D",
		  "db.col.table": "\u8868",
		  "db.col.rows": "\u884C\u6570",
		  "db.col.type": "\u7C7B\u578B",
		  "db.col.collation": "\u6392\u5E8F\u89C4\u5219",
		  "db.col.size": "\u5927\u5C0F",
		  "db.col.comment": "\u5907\u6CE8",
		  "db.col.actions": "\u64CD\u4F5C",
		  "db.type.table": "\u8868",
		  "db.type.view": "\u89C6\u56FE",
		  "db.rowsUnknown": "\u672A\u77E5",
		  "db.rowsUnknown.hint": "SQLite \u6CA1\u6709\u884C\u6570\u7EDF\u8BA1\uFF0C\u9700\u8981\u6267\u884C ANALYZE \u540E\u624D\u4F1A\u663E\u793A\uFF1B\u6B64\u5904\u4E0D\u4F1A\u66FF\u4F60\u4FEE\u6539\u6570\u636E\u5E93\u6587\u4EF6\u3002",
		  "db.loadingStats": "\u6B63\u5728\u8BFB\u53D6\u8868\u548C\u7EDF\u8BA1\u4FE1\u606F\u2026",
		  "db.action.browse": "\u6D4F\u89C8",
		  "db.action.structure": "\u7ED3\u6784",
		  "db.action.search": "\u641C\u7D22",
		  "db.action.insert": "\u63D2\u5165",
		  "db.action.truncate": "\u6E05\u7A7A",
		  "db.action.drop": "\u5220\u9664",
		  "db.truncate.title": "\u6E05\u7A7A\u8868",
		  "db.truncate.body": "\u786E\u5B9A\u6E05\u7A7A\u8868\u300C{table}\u300D\u7684\u5168\u90E8\u6570\u636E\u5417\uFF1F\u8868\u7ED3\u6784\u4F1A\u4FDD\u7559\uFF0C\u4F46\u6570\u636E\u4E0D\u53EF\u6062\u590D\u3002",
		  "db.truncate.bodyView": "\u300C{table}\u300D\u662F\u89C6\u56FE\uFF0C\u6CA1\u6709\u81EA\u5DF1\u7684\u6570\u636E\u53EF\u4EE5\u6E05\u7A7A\u3002",
		  "db.truncate.done": "\u5DF2\u6E05\u7A7A\u300C{table}\u300D",
		  "db.drop.title": "\u5220\u9664\u8868",
		  "db.drop.body": "\u786E\u5B9A\u5220\u9664\u300C{table}\u300D\u5417\uFF1F\u8868\u53CA\u5176\u5168\u90E8\u6570\u636E\u90FD\u4F1A\u88AB\u79FB\u9664\uFF0C\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002",
		  "db.drop.bodyView": "\u786E\u5B9A\u5220\u9664\u89C6\u56FE\u300C{table}\u300D\u5417\uFF1F\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002",
		  "db.drop.done": "\u5DF2\u5220\u9664\u300C{table}\u300D",
		  "db.action.failed": "\u64CD\u4F5C\u5931\u8D25\uFF1A{error}",
		  "tab.browse": "\u6D4F\u89C8",
		  "tab.structure": "\u7ED3\u6784",
		  "tab.sql": "SQL",
		  "tab.search": "\u641C\u7D22",
		  "tab.insert": "\u63D2\u5165",
		  "tab.operation": "\u64CD\u4F5C",
		  "browse.refresh": "\u5237\u65B0",
		  "browse.pageSize": "\u6BCF\u9875",
		  "browse.total": "\u5171 {n} \u884C",
		  "browse.page": "\u7B2C {page} / {pages} \u9875",
		  "browse.prev": "\u4E0A\u4E00\u9875",
		  "browse.next": "\u4E0B\u4E00\u9875",
		  "browse.empty": "\u6CA1\u6709\u6570\u636E",
		  "browse.noPk": "\u8BE5\u8868\u6CA1\u6709\u4E3B\u952E\uFF0C\u65E0\u6CD5\u5728\u6D4F\u89C8\u9875\u76F4\u63A5\u7F16\u8F91\u884C\uFF1B\u8BF7\u4F7F\u7528 SQL \u6807\u7B7E\u9875\u3002",
		  "browse.jumpTo": "\u8DF3\u8F6C\u5230",
		  "browse.jumpHint": "\u8F93\u5165\u9875\u7801\u540E\u56DE\u8F66\u8DF3\u5230\u8BE5\u9875",
		  "browse.jumpOutOfRange": "\u9875\u7801\u9700\u5728 1 \u5230 {pages} \u4E4B\u95F4",
		  "browse.sortByIndex": "\u6309\u7D22\u5F15\u6392\u5E8F",
		  "browse.sortIndexNone": "\u65E0",
		  "browse.sortAsc": "\u9012\u589E",
		  "browse.sortDesc": "\u9012\u51CF",
		  "browse.sortTitle": "\u9009\u62E9\u6309\u54EA\u4E2A\u7D22\u5F15\u3001\u4EE5\u54EA\u4E2A\u65B9\u5411\u6392\u5E8F",
		  "browse.sortByColumn": "\u70B9\u51FB\u8BE5\u5217\u6392\u5E8F\uFF0C\u518D\u6B21\u70B9\u51FB\u5207\u6362\u9012\u589E / \u9012\u51CF",
		  "browse.actions": "\u64CD\u4F5C",
		  "browse.select": "\u9009\u4E2D",
		  "browse.selectAll": "\u5168\u9009\u672C\u9875",
		  "browse.selectNone": "\u53D6\u6D88\u9009\u62E9",
		  "browse.selected": "\u5DF2\u9009 {n} \u884C",
		  "browse.copy": "\u590D\u5236",
		  "browse.copyRow": "\u590D\u5236\u6574\u884C",
		  "browse.copyCell": "\u590D\u5236\u9996\u5217",
		  "browse.copied": "\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F",
		  "browse.copyFailed": "\u590D\u5236\u5931\u8D25\uFF1A{error}",
		  "browse.editRow": "\u7F16\u8F91",
		  "browse.deleteRow": "\u5220\u9664",
		  "browse.deleteSelected": "\u5220\u9664\u6240\u9009",
		  "browse.deleteManyTitle": "\u5220\u9664\u6240\u9009\u884C",
		  "browse.deleteManyBody": "\u786E\u5B9A\u5220\u9664\u6240\u9009\u7684 {n} \u884C\u5417\uFF1F\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
		  "browse.deleteManyNoPk": "\u8BE5\u8868\u6CA1\u6709\u4E3B\u952E\uFF0C\u65E0\u6CD5\u6279\u91CF\u5220\u9664\uFF1B\u8BF7\u7528 SQL \u6807\u7B7E\u9875\u81EA\u884C\u6307\u5B9A\u6761\u4EF6\u3002",
		  "browse.distinctValues": "{n} \u4E2A\u4E0D\u540C\u7684\u503C",
		  "browse.cellHint": "\u53CC\u51FB\u5355\u5143\u683C\u53EF\u76F4\u63A5\u7F16\u8F91\uFF0C\u5931\u53BB\u7126\u70B9\u65F6\u81EA\u52A8\u4FDD\u5B58",
		  "browse.editCellTitle": "\u7F16\u8F91\u6B64\u5355\u5143\u683C",
		  "browse.cellSaved": "\u5DF2\u4FDD\u5B58",
		  "browse.cellSaveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF1A{error}",
		  "browse.exportSelected": "\u5BFC\u51FA\u6240\u9009",
		  "browse.rowCount": "\u7B2C {from}\u2013{to} \u884C\uFF0C\u5171 {total} \u884C",
		  "structure.columns": "\u5217",
		  "structure.indexes": "\u7D22\u5F15",
		  "structure.noIndexes": "\u6CA1\u6709\u7D22\u5F15",
		  "structure.col.name": "\u5217\u540D",
		  "structure.col.type": "\u7C7B\u578B",
		  "structure.col.nullable": "\u53EF\u7A7A",
		  "structure.col.key": "\u952E",
		  "structure.col.default": "\u9ED8\u8BA4\u503C",
		  "structure.col.extra": "\u989D\u5916",
		  "structure.col.comment": "\u6CE8\u91CA",
		  "structure.col.distinct": "\u975E\u91CD\u590D\u503C",
		  "structure.col.actions": "\u64CD\u4F5C",
		  "structure.index.name": "\u7D22\u5F15\u540D",
		  "structure.index.unique": "\u552F\u4E00",
		  "structure.index.columns": "\u5217",
		  "structure.index.type": "\u7C7B\u578B",
		  "structure.index.actions": "\u64CD\u4F5C",
		  "structure.select": "\u9009\u4E2D",
		  "structure.selected": "\u5DF2\u9009 {n} \u5217",
		  "structure.edit": "\u4FEE\u6539",
		  "structure.drop": "\u5220\u9664",
		  "structure.addColumn": "\u65B0\u589E\u5217",
		  "structure.newColumn": "\u65B0\u589E\u5217",
		  "structure.editColumn": "\u4FEE\u6539\u5217\u300C{column}\u300D",
		  "structure.colName": "\u5217\u540D",
		  "structure.colNameRequired": "\u8BF7\u586B\u5199\u5217\u540D",
		  "structure.colNameTaken": "\u5217\u540D\u300C{name}\u300D\u5DF2\u5B58\u5728",
		  "structure.typeOther": "\u5176\u4ED6\u7C7B\u578B\uFF08\u624B\u586B\uFF09",
		  "structure.typeOtherPlaceholder": "\u4F8B\u5982 decimal(10,2)",
		  "structure.typeText": "\u7C7B\u578B\u6587\u672C",
		  "structure.typeEditableHint": "\u53EF\u76F4\u63A5\u7F16\u8F91\uFF1B\u4E0A\u9762\u9009\u4E00\u4E2A\u5E38\u89C1\u7C7B\u578B\u4F1A\u586B\u5165\u6B64\u5904",
		  "structure.nullableKeyHint": "\u4E3B\u952E\u5217\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u6B64\u9879\u5DF2\u7981\u7528",
		  "structure.defaultHint": "\u300C\u4E0D\u8BBE\u7F6E\u300D\u4E0E\u300C\u81EA\u5B9A\u4E49 + \u7559\u7A7A\u300D\u4E0D\u540C\uFF1A\u524D\u8005\u4E0D\u52A0 DEFAULT \u5B50\u53E5\uFF0C\u540E\u8005\u662F\u7A7A\u5B57\u7B26\u4E32 ''\u3002\u5DF2\u6709\u9ED8\u8BA4\u503C\uFF08\u542B\u8868\u8FBE\u5F0F\u9ED8\u8BA4\u503C\uFF09\u4E0D\u52A8\u5B83\u5C31\u4F1A\u539F\u6837\u4FDD\u7559\u3002",
		  "structure.commentPlaceholder": "\u53EF\u7559\u7A7A",
		  "structure.indexOrderPreview": "\u7D22\u5F15\u5217\u987A\u5E8F",
		  "structure.addSubmit": "\u65B0\u589E",
		  "structure.saveSubmit": "\u4FDD\u5B58",
		  "structure.dropTitle": "\u5220\u9664\u5217",
		  "structure.dropBody": "\u786E\u5B9A\u5220\u9664\u5217\u300C{column}\u300D\u5417\uFF1F\u8BE5\u5217\u7684\u6570\u636E\u4F1A\u4E00\u5E76\u4E22\u5931\uFF0C\u4E0D\u53EF\u6062\u590D\u3002",
		  "structure.dropRebuildNote": "SQLite \u7684\u5220\u9664\u5217\u9700\u8981\u6574\u8868\u91CD\u5EFA\uFF1A\u672C\u63D2\u4EF6\u4F1A\u5728\u4E00\u4E2A\u4E8B\u52A1\u5185\u65B0\u5EFA\u8868\u3001\u642C\u8FD0\u6570\u636E\u3001\u5220\u9664\u65E7\u8868\u5E76\u6539\u540D\uFF0C\u5931\u8D25\u4F1A\u6574\u4F53\u56DE\u6EDA\u3002\u5927\u8868\u4E0A\u8FD9\u4E00\u6B65\u9700\u8981\u65F6\u95F4\u3002",
		  "structure.dropManyTitle": "\u5220\u9664\u6240\u9009\u5217",
		  "structure.dropManyBody": "\u786E\u5B9A\u5220\u9664\u6240\u9009\u7684 {n} \u5217\u5417\uFF1F\u8FD9\u4E9B\u5217\u7684\u6570\u636E\u4F1A\u4E00\u5E76\u4E22\u5931\uFF0C\u4E0D\u53EF\u6062\u590D\u3002",
		  "structure.setKey": "\u8BBE\u4E3A\u4E3B\u952E",
		  "structure.setKeyOne": "\u4E3B\u952E\u53EA\u80FD\u662F\u4E00\u5217\uFF1B\u591A\u5217\u4E3B\u952E\u8BF7\u7528\u300C\u7F16\u8F91\u4E3B\u952E\u300D",
		  "structure.primaryKey": "\u4E3B\u952E",
		  "structure.editKey": "\u7F16\u8F91\u4E3B\u952E",
		  "structure.keyTitle": "\u4E3B\u952E",
		  "structure.keyBody": "\u52FE\u9009\u8981\u7EC4\u6210\u4E3B\u952E\u7684\u5217\uFF0C\u987A\u5E8F\u5373\u4E3A\u4E3B\u952E\u987A\u5E8F\u3002\u5168\u90E8\u53D6\u6D88\u5219\u4E0D\u8BBE\u4E3B\u952E\u3002",
		  "structure.keyOrder": "\u7B2C {n} \u4F4D",
		  "structure.keySave": "\u4FDD\u5B58\u4E3B\u952E",
		  "structure.keyProbeOnly": "\u8BE5\u8868\u7528\u4E8E\u5C1D\u8BD5\u8FC7\u7684\u975E\u72EC\u5360\u64CD\u4F5C\uFF0C\u4E3B\u952E\u672A\u6539\u53D8\u3002",
		  "structure.unique": "\u552F\u4E00",
		  "structure.toggleUnique": "\u5207\u6362\u552F\u4E00\u7EA6\u675F",
		  "structure.distinctTitle": "\u975E\u91CD\u590D\u503C",
		  "structure.distinctBody": "\u5217\u300C{column}\u300D\u5171\u6709 {n} \u4E2A\u4E0D\u540C\u7684\u975E NULL \u503C\u3002",
		  "structure.distinctLoading": "\u6B63\u5728\u7EDF\u8BA1\u2026",
		  "structure.distinctFailed": "\u7EDF\u8BA1\u5931\u8D25\uFF1A{error}",
		  "structure.addIndex": "\u65B0\u589E\u7D22\u5F15",
		  "structure.indexName": "\u7D22\u5F15\u540D",
		  "structure.indexColumns": "\u7D22\u5F15\u5217",
		  "structure.indexColumnsHint": "\u6309\u987A\u5E8F\u52FE\u9009\uFF1B\u987A\u5E8F\u51B3\u5B9A\u7D22\u5F15\u80FD\u5426\u7528\u4E8E\u524D\u7F00\u67E5\u8BE2\u3002",
		  "structure.indexUnique": "\u552F\u4E00\u7D22\u5F15",
		  "structure.createIndex": "\u521B\u5EFA\u7D22\u5F15",
		  "structure.dropIndexTitle": "\u5220\u9664\u7D22\u5F15",
		  "structure.dropIndexBody": "\u786E\u5B9A\u5220\u9664\u7D22\u5F15\u300C{name}\u300D\u5417\uFF1F",
		  "structure.dropIndexesSelected": "\u5220\u9664\u6240\u9009\u7D22\u5F15",
		  "structure.noColumnsSelected": "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u5217",
		  "structure.indexNameRequired": "\u8BF7\u586B\u5199\u7D22\u5F15\u540D",
		  "structure.indexNameTaken": "\u7D22\u5F15\u540D\u300C{name}\u300D\u5DF2\u5B58\u5728",
		  "structure.primaryNotDroppable": "\u4E3B\u952E\u7D22\u5F15\u4E0D\u80FD\u5355\u72EC\u5220\u9664\uFF1B\u8BF7\u6539\u4E3B\u952E",
		  "structure.generated": "\u751F\u6210\u5217",
		  "structure.generatedHint": "\u8BE5\u5217\u7684\u503C\u7531\u6570\u636E\u5E93\u8BA1\u7B97\uFF0C\u4E0D\u80FD\u76F4\u63A5\u7F16\u8F91\u6216\u63D2\u5165\u3002",
		  "structure.refreshFirst": "\u8BF7\u5148\u5237\u65B0\u7ED3\u6784",
		  "structure.done": "\u7ED3\u6784\u5DF2\u66F4\u65B0",
		  "structure.dropSelected": "\u5220\u9664\u6240\u9009\u5217",
		  "structure.applyUnique": "\u552F\u4E00\u7EA6\u675F",
		  "structure.tableOptions": "\u8868\u64CD\u4F5C",
		  "structure.engine": "\u5F15\u64CE",
		  "structure.collation": "\u6392\u5E8F\u89C4\u5219",
		  "structure.comment": "\u6CE8\u91CA",
		  /*
		   * 搜索页照 phpMyAdmin 的「依例查询」（query by example）：字段一张表，每一列一行，
		   * 填了值的行才参与搜索，条件之间是 AND。
		   *
		   * 表头沿用 phpMyAdmin 的四个字，用户是按这几个字找过来的。说明文字里也把「留空即不
		   * 参与」和「全空即查全部」讲清楚——这两条不看说明是猜不出来的（phpMyAdmin 只在标题里
		   * 写了「通配符 %」）。
		   */
		  "search.column": "\u5B57\u6BB5",
		  "search.type": "\u7C7B\u578B",
		  "search.collation": "\u6392\u5E8F\u89C4\u5219",
		  "search.operator": "\u8FD0\u7B97\u7B26",
		  "search.value": "\u503C",
		  "search.value2": "\u4E0A\u9650",
		  "search.valuePlaceholder": "\u8F93\u5165\u503C",
		  "search.valuePlaceholder.in": "\u9017\u53F7\u5206\u9694\uFF0C\u4F8B\u5982 a,b,c",
		  "search.betweenFrom": "\u4E0B\u9650",
		  "search.betweenTo": "\u4E0A\u9650",
		  "search.betweenNeedsBoth": "\u300C{column}\u300D\u9009\u4E86\u300C\u4ECB\u4E8E\u300D\uFF0C\u4E0B\u9650\u548C\u4E0A\u9650\u90FD\u8981\u586B\u3002",
		  "search.qbeHint": "\u4F9D\u4F8B\u67E5\u8BE2\uFF1A\u6BCF\u5217\u4E00\u884C\uFF0C\u53EA\u5728\u8981\u7528\u7684\u884C\u91CC\u586B\u503C\uFF0C\u586B\u4E86\u7684\u884C\u624D\u53C2\u4E0E\u641C\u7D22\uFF08\u6761\u4EF6\u4E4B\u95F4\u662F AND\uFF09\u3002\u6240\u6709\u884C\u90FD\u7559\u7A7A\u5219\u663E\u793A\u5168\u90E8\u884C\u3002",
		  "search.needStructure": "\u8BE5\u8868\u7684\u7ED3\u6784\u5C1A\u672A\u8BFB\u53D6\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002",
		  "search.allRows": "\u672A\u8BBE\u7F6E\u6761\u4EF6\uFF0C\u5C06\u663E\u793A\u5168\u90E8\u884C",
		  "search.usedCount": "\u5DF2\u8BBE\u7F6E {n} \u4E2A\u6761\u4EF6",
		  "search.matched": "\u5339\u914D\u5230 {n} \u884C",
		  "search.reset": "\u6E05\u7A7A\u6761\u4EF6",
		  "search.run": "\u6267\u884C",
		  "search.hint": "\u300C\u5305\u542B / \u5F00\u5934\u662F / \u7ED3\u5C3E\u662F\u300D\u4F1A\u628A % \u4E0E _ \u5F53\u4F5C\u666E\u901A\u5B57\u7B26\u5339\u914D\uFF08\u540E\u53F0\u6309\u53C2\u6570\u7ED1\u5B9A\uFF0C\u4E0D\u62FC\u8FDB SQL\uFF09\u3002\u9700\u8981\u5199\u4EFB\u610F SQL \u8BF7\u7528 SQL \u6807\u7B7E\u9875\u3002",
		  "search.op.eq": "\u7B49\u4E8E",
		  "search.op.neq": "\u4E0D\u7B49\u4E8E",
		  "search.op.gt": "\u5927\u4E8E",
		  "search.op.gte": "\u5927\u4E8E\u7B49\u4E8E",
		  "search.op.lt": "\u5C0F\u4E8E",
		  "search.op.lte": "\u5C0F\u4E8E\u7B49\u4E8E",
		  "search.op.contains": "\u5305\u542B",
		  "search.op.notContains": "\u4E0D\u5305\u542B",
		  "search.op.startsWith": "\u5F00\u5934\u662F",
		  "search.op.endsWith": "\u7ED3\u5C3E\u662F",
		  "search.op.between": "\u4ECB\u4E8E",
		  "search.op.in": "\u5C5E\u4E8E\u96C6\u5408",
		  "search.op.isNull": "\u4E3A\u7A7A\uFF08NULL\uFF09",
		  "search.op.isNotNull": "\u4E0D\u4E3A\u7A7A",
		  "insert.title": "\u63D2\u5165\u4E00\u884C",
		  "insert.hint": "\u7559\u7A7A\u7684\u5217\u4E0D\u4F1A\u51FA\u73B0\u5728 INSERT \u91CC\uFF0C\u7531\u6570\u636E\u5E93\u586B\u9ED8\u8BA4\u503C\u6216 NULL\uFF1B\u9700\u8981\u663E\u5F0F\u5B58 NULL \u5C31\u52FE\u4E0A NULL\u3002",
		  "insert.submit": "\u63D2\u5165",
		  "insert.submitAndNew": "\u63D2\u5165\u5E76\u518D\u586B\u4E00\u884C",
		  "insert.done": "\u5DF2\u63D2\u5165 {n} \u884C",
		  /*
		   * 单行插入会跳到浏览页，完成语因此要把这一步说出来。
		   *
		   * 不说的话，表单消失、表格出现，中间没有任何解释——切换本身是反馈，但只有把「已切到
		   * 浏览」写出来，这次切换才读作结果，而不是「表单没了」。批量那个按钮留在表单上，所以
		   * 它的话术不变。
		   */
		  "insert.doneAndBrowsing": "\u5DF2\u63D2\u5165 {n} \u884C\uFF0C\u5DF2\u5207\u5230\u300C\u6D4F\u89C8\u300D",
		  "insert.rowsDoneBrowsing": "\u5DF2\u63D2\u5165 {n} \u884C\uFF08{forms} \u7EC4\uFF09\uFF0C\u5DF2\u5207\u5230\u300C\u6D4F\u89C8\u300D",
		  "insert.required": "\u5217\u300C{column}\u300D\u4E0D\u5141\u8BB8\u4E3A\u7A7A",
		  "insert.autoAssign": "\u7559\u7A7A\u5219\u81EA\u52A8\u751F\u6210",
		  "insert.blankHint": "\uFF08\u7559\u7A7A\uFF0C\u7528\u9ED8\u8BA4\u503C\uFF09",
		  "insert.chooseHint": "\uFF08\u8BF7\u9009\u62E9\uFF09",
		  "insert.nullHint": "\u663E\u5F0F\u5199\u5165 NULL\uFF08\u4E0E\u7559\u7A7A\u4E0D\u540C\uFF09",
		  "insert.setEmpty": "\u7A7A\u5B57\u7B26\u4E32",
		  "insert.emptyHint": "\u663E\u5F0F\u5199\u5165\u7A7A\u5B57\u7B26\u4E32\uFF08NOT NULL \u4E14\u65E0\u9ED8\u8BA4\u503C\uFF0C\u7559\u7A7A\u4F1A\u88AB\u62D2\u7EDD\uFF09",
		  "insert.defaultSuffix": "\u9ED8\u8BA4\uFF1A{value}",
		  "insert.boolTrue": "\u662F\uFF081\uFF09",
		  "insert.boolFalse": "\u5426\uFF080\uFF09",
		  "insert.numberInvalid": "\u5217\u300C{column}\u300D\u9700\u8981\u6570\u5B57",
		  "insert.valueTooLong": "\u5217\u300C{column}\u300D\u6700\u591A {max} \u4E2A\u5B57\u7B26",
		  "insert.rowsLabel": "\u8981\u63D2\u5165\u7684\u884C\u6570",
		  "insert.rowsApply": "\u5E94\u7528",
		  "insert.rowsRange": "\u884C\u6570\u9700\u8981\u662F 1 \u5230 {max} \u4E4B\u95F4\u7684\u6574\u6570",
		  "insert.addRow": "\u518D\u52A0\u4E00\u884C",
		  "insert.removeRow": "\u79FB\u9664\u8FD9\u4E00\u884C",
		  "insert.rowsDone": "\u5DF2\u63D2\u5165 {n} \u884C\uFF08{forms} \u7EC4\uFF09",
		  "insert.formOf": "\u7B2C {n} \u7EC4",
		  "export.title": "\u5BFC\u51FA",
		  "export.format": "\u683C\u5F0F",
		  "export.format.sql": "SQL \u8F6C\u50A8\uFF08.sql\uFF09",
		  "export.format.csv": "CSV\uFF08.csv\uFF0C\u4EC5\u5F53\u524D\u8868\uFF09",
		  "export.scope": "\u8303\u56F4",
		  "export.scope.schema": "\u6574\u4E2A\u5E93\uFF08{n} \u5F20\u8868\uFF09",
		  "export.scope.table": "\u4EC5\u5F53\u524D\u8868",
		  "export.scope.selected": "\u4EC5\u6240\u9009",
		  "export.scope.chosen": "\u5DF2\u9009 {n} \u5F20\u8868",
		  "export.includeStructure": "\u5305\u542B\u8868\u7ED3\u6784\uFF08CREATE\uFF09",
		  "export.includeData": "\u5305\u542B\u6570\u636E\uFF08INSERT\uFF09",
		  "export.dropTable": "\u5305\u542B DROP TABLE",
		  "export.dropWarn": "\u52FE\u9009\u540E\uFF0C\u5BFC\u5165\u5230\u5DF2\u6709\u6570\u636E\u5E93\u4F1A\u5148\u5220\u9664\u540C\u540D\u8868\uFF0C\u518D\u91CD\u5EFA\u3002",
		  "export.submit": "\u5BFC\u51FA\u5E76\u4E0B\u8F7D",
		  "export.busy": "\u6B63\u5728\u751F\u6210\u2026",
		  "export.done": "\u5DF2\u4E0B\u8F7D {name}\uFF08{size}\uFF09",
		  "export.empty": "\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u8868",
		  "export.truncated": "\u6709 {n} \u5F20\u8868\u7684\u884C\u6570\u8D85\u8FC7\u5BFC\u51FA\u4E0A\u9650\uFF0C\u6587\u4EF6\u4E2D\u7684\u8FD9\u4E9B\u8868\u88AB\u622A\u65AD\u3002",
		  "export.csvOneTable": "CSV \u4E00\u6B21\u53EA\u80FD\u5BFC\u51FA\u4E00\u5F20\u8868",
		  "export.hint": "\u5BFC\u51FA\u5728\u672C\u673A\u751F\u6210\uFF0C\u4E0D\u7ECF\u8FC7 agent\uFF1B\u6587\u4EF6\u76F4\u63A5\u7531\u6D4F\u89C8\u5668\u4FDD\u5B58\u3002",
		  "import.title": "\u5BFC\u5165",
		  "import.format": "\u683C\u5F0F",
		  "import.format.sql": "SQL \u6587\u4EF6\uFF08.sql\uFF09",
		  "import.format.csv": "CSV \u6587\u4EF6\uFF08.csv\uFF09",
		  "import.table": "\u76EE\u6807\u8868",
		  "import.tableHint": "CSV \u7684\u6570\u636E\u4F1A\u63D2\u5165\u8FD9\u5F20\u8868\uFF1B\u5217\u6309\u8868\u5934\u540D\u79F0\u5BF9\u5E94\u3002",
		  "import.file": "\u6587\u4EF6",
		  "import.choose": "\u9009\u62E9\u6587\u4EF6\u2026",
		  "import.noFile": "\u5C1A\u672A\u9009\u62E9\u6587\u4EF6",
		  "import.hasHeader": "\u9996\u884C\u662F\u5217\u540D",
		  "import.hasHeaderHint": "\u4E0D\u52FE\u9009\u5219\u6309\u76EE\u6807\u8868\u7684\u5217\u987A\u5E8F\u5BF9\u9F50\u3002",
		  "import.emptyAsNull": "\u7A7A\u5B57\u6BB5\u89C6\u4E3A NULL",
		  "import.emptyAsNullHint": "\u4E0D\u52FE\u9009\u5219\u5199\u5165\u7A7A\u5B57\u7B26\u4E32\u3002",
		  "import.submit": "\u5F00\u59CB\u5BFC\u5165",
		  "import.busy": "\u6B63\u5728\u5BFC\u5165\u2026",
		  "import.warn": "\u5BFC\u5165\u4F1A\u5199\u6570\u636E\u4E14\u4E0D\u53EF\u64A4\u9500\u3002SQL \u6587\u4EF6\u91CC\u7684 DROP TABLE \u4F1A\u5220\u9664\u540C\u540D\u8868\u3002",
		  "import.refuseTooBig": "\u6587\u4EF6\u8FC7\u5927\uFF1A{size}\uFF0C\u4E0A\u9650 {limit}",
		  "import.done": "\u5DF2\u6267\u884C {n} \u6761\u8BED\u53E5",
		  "import.doneRows": "\u5DF2\u5BFC\u5165 {n} \u884C",
		  "import.skipped": "\u6709 {n} \u6761\u8BB0\u5F55\u7684\u5B57\u6BB5\u6570\u4E0E\u8868\u5934\u4E0D\u4E00\u81F4\uFF0C\u5DF2\u8DF3\u8FC7\uFF1A\u7B2C {lines} \u884C",
		  "import.needTable": "\u8BF7\u9009\u62E9\u5BFC\u51FA\u7684\u76EE\u6807\u8868",
		  "import.needFile": "\u8BF7\u9009\u62E9\u8981\u5BFC\u5165\u7684\u6587\u4EF6",
		  "import.hint": "SQL \u6587\u4EF6\u6309\u8BED\u53E5\u9010\u6761\u6267\u884C\uFF1BCSV \u6309\u5217\u540D\u5BF9\u5E94\u63D2\u5165\u3002",
		  "sql.placeholder": "\u8F93\u5165\u4E00\u6761 SQL \u8BED\u53E5\uFF0CCtrl+Enter \u6267\u884C",
		  "sql.run": "\u6267\u884C",
		  "sql.running": "\u6267\u884C\u4E2D\u2026",
		  "sql.allowWrite": "\u5141\u8BB8\u5199\u5165",
		  "sql.allowWrite.hint": "\u672A\u52FE\u9009\u65F6\u53EA\u5141\u8BB8 SELECT / SHOW / DESCRIBE / EXPLAIN \u7B49\u53EA\u8BFB\u8BED\u53E5\u3002",
		  "sql.affected": "{n} \u884C\u53D7\u5F71\u54CD\uFF0C\u8017\u65F6 {ms} ms",
		  "sql.rows": "{n} \u884C\uFF0C\u8017\u65F6 {ms} ms",
		  "sql.truncated": "\u7ED3\u679C\u5DF2\u622A\u65AD",
		  "edit.title": "\u7F16\u8F91\u884C",
		  "edit.submit": "\u4FDD\u5B58",
		  "edit.delete": "\u5220\u9664\u6B64\u884C",
		  "edit.done": "\u5DF2\u66F4\u65B0 {n} \u884C",
		  "edit.deleted": "\u5DF2\u5220\u9664 {n} \u884C",
		  "redis.info": "\u670D\u52A1\u4FE1\u606F",
		  "redis.keys": "\u952E",
		  "redis.pattern": "\u5339\u914D\u6A21\u5F0F",
		  "redis.loadMore": "\u52A0\u8F7D\u66F4\u591A",
		  "redis.noMore": "\u5DF2\u5230\u672B\u5C3E",
		  "redis.scanned": "\u5DF2\u626B\u63CF {n} \u4E2A\u952E",
		  "redis.noKeys": "\u6CA1\u6709\u5339\u914D\u7684\u952E",
		  "redis.key": "\u952E",
		  "redis.type": "\u7C7B\u578B",
		  "redis.ttl": "TTL",
		  "redis.ttl.none": "\u6C38\u4E45",
		  "redis.size": "\u5927\u5C0F",
		  "redis.value": "\u503C",
		  "redis.field": "\u5B57\u6BB5",
		  "redis.member": "\u6210\u5458",
		  "redis.score": "\u5206\u503C",
		  "redis.entry": "\u6761\u76EE ID",
		  "redis.truncated": "\u8BE5\u96C6\u5408\u8F83\u5927\uFF0C\u4EC5\u663E\u793A\u524D {n} \u4E2A\u5143\u7D20",
		  "redis.selectKey": "\u4ECE\u5DE6\u4FA7\u9009\u62E9\u4E00\u4E2A\u952E\u67E5\u770B\u5185\u5BB9",
		  "redis.console": "\u547D\u4EE4\u884C",
		  "redis.consolePlaceholder": "\u8F93\u5165\u547D\u4EE4\uFF0C\u4F8B\u5982 GET mykey \u6216 HGETALL myhash",
		  "redis.consoleRun": "\u6267\u884C",
		  "redis.consoleDb": "\u76EE\u6807\u5E93\uFF1A",
		  "redis.index.title": "\u4E3A db{n} \u5EFA\u7ACB\u7D22\u5F15\uFF1F",
		  "redis.index.why": "\u8BE5\u5E93\u6709 {keys} \u4E2A\u952E\u3002Redis \u6CA1\u6709\u524D\u7F00\u7D22\u5F15\uFF0C\u5217\u51FA\u4EFB\u4F55\u4E00\u5C42\u90FD\u8981\u904D\u5386\u6574\u4E2A\u5E93\uFF0C\u6240\u4EE5\u9010\u5C42\u626B\u63CF\u5728\u8FD9\u4E2A\u89C4\u6A21\u4E0B\u65E0\u6CD5\u4F7F\u7528\u3002\u4E00\u6B21\u6027\u5EFA\u7ACB\u7D22\u5F15\u7EA6\u9700 {seconds} \u79D2\uFF0C\u4E4B\u540E\u5C55\u5F00\u4EFB\u4F55\u5C42\u7EA7\u90FD\u662F\u5373\u65F6\u7684\u3002",
		  "redis.index.warning": "\u7D22\u5F15\u671F\u95F4\u4F1A\u6301\u7EED\u5360\u7528\u8BE5 Redis \u670D\u52A1\u5668\u7684 CPU\uFF08\u5206\u6279\u63A8\u8FDB\uFF0C\u6BCF\u6B21\u8C03\u7528\u4EC5\u77ED\u6682\u963B\u585E\uFF09\u3002\u82E5\u662F\u751F\u4EA7\u670D\u52A1\u5668\uFF0C\u5EFA\u8BAE\u5728\u4F4E\u5CF0\u671F\u8FDB\u884C\u3002",
		  "redis.index.confirm": "\u5EFA\u7ACB\u7D22\u5F15",
		  "redis.index.skip": "\u6682\u4E0D\u5EFA\u7ACB",
		  "redis.index.building": "\u6B63\u5728\u4E3A db{n} \u5EFA\u7ACB\u7D22\u5F15\uFF1A\u5DF2\u626B\u63CF {visited} / {total}\uFF0C\u53D1\u73B0 {folders} \u4E2A\u76EE\u5F55\u2026",
		  "redis.allowWrite": "\u5141\u8BB8\u5199\u5165",
		  "redis.allowWrite.hint": "\u672A\u52FE\u9009\u65F6\u53EA\u6709\u8BFB\u547D\u4EE4\u53EF\u7528\uFF08GET/HGETALL/LRANGE/SCAN/INFO \u7B49\uFF09\u3002",
		  "redis.version": "\u7248\u672C",
		  "redis.mode": "\u6A21\u5F0F",
		  "redis.uptime": "\u8FD0\u884C\u65F6\u957F",
		  "redis.memory": "\u5DF2\u7528\u5185\u5B58",
		  "redis.clients": "\u8FDE\u63A5\u6570",
		  "redis.totalKeys": "\u5F53\u524D\u5E93\u952E\u6570",
		  "redis.databases": "\u6570\u636E\u5E93",
		  "redis.db": "DB",
		  "redis.db.switch": "\u6D4F\u89C8\u54EA\u4E2A\u5E93",
		  "redis.values": "\u503C\u5217\u8868",
		  "redis.stringValue": "\u5B57\u7B26\u4E32\u503C",
		  "redis.readonlyNotice": "\u5F53\u524D\u4E3A\u53EA\u8BFB\u6D4F\u89C8\uFF0C\u52FE\u9009\u300C\u5141\u8BB8\u5199\u5165\u300D\u540E\u53EF\u6267\u884C\u5199\u547D\u4EE4\u3002",
		  "redisdb.switch": "\u6D4F\u89C8\u54EA\u4E2A\u5E93",
		  "redisdb.keysInDb": "{n} \u4E2A\u952E",
		  "redisdb.filter": "\u641C\u7D22\u952E\u540D\u2026",
		  "redisdb.search.hint": "\u652F\u6301 Redis \u901A\u914D\u7B26\uFF1Ajd:* \u3001*session* \u3001? \u7B49",
		  "redisdb.search.run": "\u641C\u7D22",
		  "redisdb.search.clear": "\u6E05\u9664\u641C\u7D22",
		  "redisdb.search.running": "\u6B63\u5728\u641C\u7D22\u2026",
		  "redisdb.search.header": "db{n} \u4E2D\u5339\u914D\u300C{pattern}\u300D\u7684\u952E\uFF08\u6309\u76EE\u5F55\u5F52\u7EC4\uFF09",
		  "redisdb.search.count": "\u627E\u5230 {n} \u4E2A\u952E",
		  "redisdb.search.none": "\u6CA1\u6709\u5339\u914D\u7684\u952E\uFF08\u5DF2\u626B\u63CF {scanned} \u4E2A\uFF09",
		  "redisdb.search.truncated": "\u5339\u914D\u8F83\u591A\uFF0C\u4EC5\u663E\u793A\u524D {shown} \u4E2A\uFF1B\u8BF7\u7528\u66F4\u7CBE\u786E\u7684\u6A21\u5F0F",
		  "redisdb.search.scope.db": "\u5728 db{n} \u4E2D\u641C\u7D22",
		  "redisdb.search.clearHint": "\u6E05\u7A7A\u641C\u7D22\u6846\u56DE\u5230\u76EE\u5F55\u6811",
		  "redisdb.refresh": "\u91CD\u65B0\u626B\u63CF",
		  "redisdb.loading": "\u6B63\u5728\u626B\u63CF\u2026",
		  "redisdb.empty": "\u8BE5\u5E93\u6CA1\u6709\u952E",
		  "redisdb.truncated": "\u952E\u6570\u8D85\u8FC7\u4E0A\u9650\uFF08{n}\uFF09\uFF0C\u76EE\u5F55\u53EF\u80FD\u4E0D\u5168\uFF0C\u8BF7\u7528\u8FC7\u6EE4\u7F29\u5C0F\u8303\u56F4\u3002",
		  "redisdb.levelTruncated": "\u8BE5\u5C42\u5171 {total} \u4E2A\u952E\uFF0C\u4EC5\u663E\u793A\u524D {shown} \u4E2A\uFF1B\u7528\u8FC7\u6EE4\u7F29\u5C0F\u8303\u56F4\u3002",
		  "redisdb.levelApproximate": "\u8BE5\u5E93\u5171 {total} \u4E2A\u952E\uFF0C\u6B64\u5904\u4EC5\u626B\u63CF\u4E86 {scanned} \u4E2A\uFF1A\u76EE\u5F55\u53EF\u80FD\u4E0D\u5168\uFF0C\u8BA1\u6570\u662F\u4E0B\u9650\u3002",
		  "redisdb.dbSummary": "db{n} \xB7 {keys} \u4E2A\u952E",
		  "redisdb.folder": "\u76EE\u5F55",
		  "redisdb.keyCount": "{n}",
		  "redisnew.title": "\u65B0\u589E\u952E",
		  "redisnew.titleIn": "\u5728\u300C{path}\u300D\u4E0B\u65B0\u589E\u952E",
		  "redisnew.name": "\u952E\u540D",
		  "redisnew.name.placeholder": "\u6BCF\u884C\u4E00\u4E2A\uFF1B\u76EE\u5F55\u4F1A\u6298\u53E0\u4E3A\u6587\u4EF6\u5939",
		  "redisnew.name.hintRoot": "\u53EF\u4E00\u6B21\u586B\u591A\u4E2A\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09\uFF0C\u7528\u300C:\u300D\u5206\u5C42\u5373\u6210\u4E3A\u76EE\u5F55\u3002",
		  "redisnew.name.hintFolder": "\u524D\u7F00\u300C{prefix}\u300D\u5DF2\u81EA\u52A8\u8865\u4E0A\uFF0C\u53EA\u9700\u586B\u540E\u9762\u7684\u90E8\u5206\uFF1B\u6BCF\u884C\u4E00\u4E2A\u3002",
		  "redisnew.type": "\u7C7B\u578B",
		  "redisnew.content": "\u5185\u5BB9",
		  "redisnew.ttl": "\u8FC7\u671F\u65F6\u95F4",
		  "redisnew.ttl.unit": "\u79D2",
		  "redisnew.ttl.hint": "\u7559\u7A7A\u6216 0 \u8868\u793A\u6C38\u4E45\u3002",
		  "redisnew.submit": "\u521B\u5EFA",
		  "redisnew.busy": "\u521B\u5EFA\u4E2D\u2026",
		  "redisnew.done": "\u5DF2\u521B\u5EFA {n} \u4E2A\u952E",
		  "redisnew.nameRequired": "\u8BF7\u586B\u5199\u952E\u540D",
		  "redisnew.overwritten": "\u952E\u300C{key}\u300D\u5DF2\u5B58\u5728\uFF0C\u672A\u8986\u76D6\u3002",
		  "redisdelete.keyTitle": "\u5220\u9664\u952E",
		  "redisdelete.keyBody": "\u786E\u5B9A\u5220\u9664\u952E\u300C{key}\u300D\u5417\uFF1F\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
		  "redisdelete.folderTitle": "\u5220\u9664\u76EE\u5F55",
		  "redisdelete.folderBody": "\u76EE\u5F55\u300C{path}\u300D\u4E0B\u5171\u6709 {n} \u4E2A\u952E\uFF08\u542B\u5B50\u76EE\u5F55\uFF09\uFF0C\u5C06\u88AB\u5168\u90E8\u5220\u9664\u3002\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
		  "redisdelete.folderBodyUnknown": "\u5C06\u5220\u9664\u76EE\u5F55\u300C{path}\u300D\u53CA\u5176\u4E0B\u6240\u6709\u952E\u3002\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
		  "redisdelete.counting": "\u6B63\u5728\u7EDF\u8BA1\u2026",
		  "redisdelete.confirm": "\u5220\u9664",
		  "redisdelete.deleting": "\u5220\u9664\u4E2D\u2026",
		  "redisdelete.done": "\u5DF2\u5220\u9664 {n} \u4E2A\u952E",
		  "redisdelete.truncated": "\u5DF2\u8FBE\u5230\u672C\u6B21\u5220\u9664\u4E0A\u9650\uFF0C\u53EF\u80FD\u4ECD\u6709\u5269\u4F59\u952E\uFF1B\u8BF7\u518D\u6267\u884C\u4E00\u6B21\u3002",
		  "action.newKey": "\u65B0\u589E\u952E",
		  "action.newKeyInFolder": "\u5728\u6B64\u76EE\u5F55\u65B0\u589E\u952E",
		  "action.deleteFolder": "\u5220\u9664\u76EE\u5F55",
		  "redisedit.save": "\u4FDD\u5B58",
		  "redisedit.revert": "\u64A4\u9500",
		  "redisedit.saved": "\u5DF2\u4FDD\u5B58",
		  "redisedit.unsaved": "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539",
		  "redisedit.ctrlEnter": "Ctrl+Enter \u4FDD\u5B58",
		  "redisedit.index": "\u4E0B\u6807",
		  "redisedit.rowDeleted": "\u5DF2\u5220\u9664",
		  "redisedit.appended": "\u5DF2\u8FFD\u52A0",
		  "redisedit.append": "\u8FFD\u52A0\u5230\u672B\u5C3E",
		  "redisedit.appendPlaceholder": "\u8F93\u5165\u8981\u8FFD\u52A0\u7684\u5143\u7D20\uFF0C\u56DE\u8F66\u63D0\u4EA4",
		  "redisedit.add": "\u65B0\u589E",
		  "redisedit.added": "\u5DF2\u65B0\u589E",
		  "redisedit.addMember": "\u65B0\u589E\u6210\u5458",
		  "redisedit.addField": "\u65B0\u589E\u5B57\u6BB5",
		  "redisedit.addMemberPlaceholder": "\u8F93\u5165\u6210\u5458\uFF0C\u56DE\u8F66\u63D0\u4EA4",
		  "redisedit.scoreNotNumber": "\u5206\u503C\u4E0D\u662F\u6570\u5B57\uFF1A{score}",
		  "redisedit.ttl.edit": "\u6539 TTL",
		  "redisedit.ttl.persist": "\u8BBE\u4E3A\u6C38\u4E45",
		  "redisedit.ttl.persist.hint": "\u53BB\u6389\u8FC7\u671F\u65F6\u95F4\uFF08PERSIST\uFF09\uFF0C\u952E\u4E0E\u5176\u503C\u90FD\u4FDD\u7559\u3002",
		  "redisedit.ttl.done": "TTL \u5DF2\u8BBE\u4E3A {ttl}",
		  "redisedit.ttl.expired": "\u5DF2\u8FC7\u671F",
		  "redisedit.ttl.expired.hint": "\u8BE5\u952E\u7684\u8FC7\u671F\u65F6\u95F4\u5DF2\u5230\uFF0CRedis \u5DF2\u5220\u9664\u5B83\u3002",
		  "redisedit.ttl.expired.reload": "\u91CD\u65B0\u8BFB\u53D6",
		  "redisedit.readonlyType": "{type} \u7C7B\u578B\u4E0D\u652F\u6301\u5728\u6B64\u7F16\u8F91\uFF1A\u6D41\u7684\u6761\u76EE\u7531 XADD \u751F\u6210\uFF0C\u6539\u4E00\u6761\u4F1A\u7834\u574F\u5B83\u7684 ID \u8BED\u4E49\uFF1B\u8BF7\u7528\u547D\u4EE4\u884C\u3002",
		  "redisedit.deleted": "\u5DF2\u5220\u9664",
		  "col.delete": "\u5220\u9664",
		  "common.delete": "\u5220\u9664",
		  "common.loading": "\u52A0\u8F7D\u4E2D\u2026",
		  "common.refresh": "\u5237\u65B0",
		  "common.close": "\u5173\u95ED",
		  "common.confirm": "\u786E\u5B9A",
		  "common.cancel": "\u53D6\u6D88",
		  "common.yes": "\u662F",
		  "common.no": "\u5426",
		  "common.error": "\u51FA\u9519\u4E86\uFF1A{error}",
		  "common.null": "NULL",
		  "common.none": "\u2014"
		};
		var en = {
		  "entry.label": "Database",
		  "entry.tooltip": "Manage SQLite / MySQL / Redis data sources",
		  "panel.title": "Database Manager",
		  "panel.subtitle": "SQLite / MySQL / Redis",
		  "panel.close": "Back to conversation",
		  "panel.backToConversation": "Back to conversation",
		  "panel.backToList": "Data sources",
		  "panel.engines": "Engines",
		  "panel.engine.missing": "{kind} driver unavailable: {detail}",
		  "gate.allowWrite": "Allow agent writes",
		  "gate.requireApproval": "Writes need approval",
		  "gate.hint": "With writes off, an agent can only read (db_list / db_schema / db_query). With writes on, db_exec raises an approval prompt you must confirm.",
		  "gate.saved": "Write policy saved",
		  "list.search": "Search name, host, tags\u2026",
		  "list.groupBy": "Group by",
		  "list.group.none": "No grouping",
		  "list.group.kind": "Engine",
		  "list.group.group": "Group",
		  "list.group.tag": "Tag",
		  "list.new": "New database",
		  "list.empty": "No data sources yet \u2014 click \u201CNew database\u201D to add one.",
		  "list.emptyFiltered": "No data source matches the filter.",
		  "list.count": "{n} data source(s)",
		  "col.kind": "Engine",
		  "col.name": "Name",
		  "col.group": "Group",
		  "col.host": "Host",
		  "col.user": "User",
		  "col.auth": "Auth",
		  "col.tags": "Tags",
		  "col.actions": "Actions",
		  "auth.file": "File",
		  "auth.password": "Password",
		  "auth.none": "None",
		  "action.test": "Test",
		  "action.connect": "Connect",
		  "action.edit": "Edit",
		  "action.delete": "Delete",
		  "action.testing": "Testing\u2026",
		  "action.copy": "Copy ID",
		  "test.ok": "Connected ({ms} ms) {version}",
		  "test.fail": "Connection failed: {error}",
		  "test.latency": "{ms} ms",
		  "delete.title": "Delete data source",
		  "delete.body": "Delete data source \u201C{name}\u201D? This only removes the locally stored connection; nothing inside the database is touched.",
		  "delete.confirm": "Delete",
		  "form.newTitle": "New database",
		  "form.editTitle": "Edit database",
		  "form.kind": "Engine",
		  "form.name": "Name",
		  "form.name.placeholder": "A label for this data source",
		  "form.id": "ID",
		  "form.id.placeholder": "Leave blank to derive one from the name",
		  "form.group": "Group",
		  "form.group.placeholder": "e.g. Production",
		  "form.tags": "Tags",
		  "form.tags.placeholder": "Comma separated, e.g. core,readonly",
		  "form.description": "Note",
		  "form.file": "Database file",
		  "form.file.placeholder": "e.g. D:/data/app.db or :memory:",
		  "form.host": "Host",
		  "form.port": "Port",
		  "form.user": "User",
		  "form.password": "Password",
		  "form.password.keep": "Leave blank to keep the stored password",
		  "form.password.clear": "Clear the stored password",
		  "form.mysql.noDefaultSchema": "Connects without a default database, so every database is listed once you are in.",
		  "form.tls": "Encrypted connection (TLS)",
		  "form.tls.hint": "Encrypts the connection but does NOT verify the server certificate (self-signed works). Protects against passive eavesdropping; use an SSH tunnel if you also need to defeat a man in the middle.",
		  "form.timeout": "Connect timeout (ms)",
		  "form.timeout.unit": "ms",
		  "form.readonly": "Read-only (refuse agent writes)",
		  "form.readonly.hint": "When ticked, an agent cannot modify this source even if global agent writes are on.",
		  "form.test": "Test connection",
		  "form.testing": "Testing\u2026",
		  "form.test.ok": "Connected ({ms} ms) {version}",
		  "form.test.note": "Note: {note}",
		  "form.save": "Save",
		  "form.cancel": "Cancel",
		  "form.required": "Please fill in: {fields}",
		  "form.kindLocked": "The engine cannot be changed while editing; create a new data source instead.",
		  "db.connecting": "Connecting\u2026",
		  "db.connectFailed": "Connection failed: {error}",
		  "db.schemas": "Databases",
		  "db.tables": "Tables",
		  "db.noTables": "(no tables)",
		  "db.noTablesFiltered": "(this database has tables, but none matches \u201C{filter}\u201D; the filter matches table names)",
		  "db.select": "Select",
		  "db.selectAll": "Select all",
		  "db.selectNone": "Clear selection",
		  "db.selectedCount": "{n} table(s) selected",
		  "db.batchActions": "Batch actions",
		  "db.batch.needsSelection": "Tick the tables to operate on first",
		  "db.batch.export": "Export selected",
		  "db.batch.exportTitle": "Export the selected tables",
		  "db.batch.exportBody": "The {n} selected table(s) will be exported into one SQL file (structure + data).",
		  "db.batch.truncate": "Empty",
		  "db.batch.truncateTitle": "Empty the selected tables",
		  "db.batch.truncateBody": "Empty every row of the {n} selected table(s)? The structure is kept, but the data cannot be recovered.",
		  "db.batch.truncateSkipped": "{n} of them are views with no rows of their own; those will be skipped.",
		  "db.batch.drop": "Drop",
		  "db.batch.dropTitle": "Drop the selected tables",
		  "db.batch.dropBody": "Drop the {n} selected table(s)? The tables and all their data will be removed, and this cannot be undone.",
		  "db.batch.done.truncate": "Emptied {n} table(s)",
		  "db.batch.done.drop": "Dropped {n} table(s)",
		  "db.batch.partial": "{ok} succeeded, {failed} failed",
		  "db.batch.failedOn": "\u201C{table}\u201D failed: {error}",
		  "db.maint.title": "Table maintenance",
		  "db.maint.check": "Check",
		  "db.maint.optimize": "Optimize",
		  "db.maint.repair": "Repair",
		  "db.maint.analyze": "Analyze",
		  "db.maint.check.hint": "Check the table for errors",
		  "db.maint.optimize.hint": "Reclaim unused space and defragment the data file",
		  "db.maint.repair.hint": "Repair a corrupted table (only engines such as MyISAM support this)",
		  "db.maint.analyze.hint": "Refresh the index statistics, which is what makes row counts appear",
		  "db.maint.unsupported": "This engine does not support this operation",
		  "db.maint.running.check": "Checking\u2026",
		  "db.maint.running.optimize": "Optimizing\u2026",
		  "db.maint.running.repair": "Repairing\u2026",
		  "db.maint.running.analyze": "Analyzing\u2026",
		  "db.maint.resultCount": "{n} table(s): {ok} OK, {failed} with problems",
		  "db.maint.scopeWholeDb": "Note: this operates on the whole database file, not on one table",
		  "db.maint.repairMissing": "SQLite has no REPAIR statement; a corrupted database is restored from a backup or rebuilt from an export. Use Check first to see the extent.",
		  "db.op.title": "Database actions",
		  "db.op.create": "New database",
		  "db.op.createTitle": "New database",
		  "db.op.createBody": "Create a new database on the same server.",
		  "db.op.name": "Database name",
		  "db.op.charset": "Character set",
		  "db.op.collate": "Collation",
		  "db.op.collateHint": "\u201C{charset}\u201D has {n} collation(s) to choose from.",
		  "db.op.collateDefault": "(use the character set\u2019s default collation)",
		  "db.op.collateIsDefault": "(default)",
		  "db.op.collateNeedsCharset": "Choose a character set first; the collation belongs to it.",
		  "db.op.collateUnavailable": "The collation list for that character set could not be read; type one, or leave it blank.",
		  "db.op.rename": "Rename",
		  "db.op.renameTitle": "Rename the database \u201C{from}\u201D",
		  "db.op.renameBody": "MySQL has no RENAME DATABASE: this creates the target, moves every table into it, then drops the original. On a large database that takes time.",
		  "db.op.copy": "Copy database",
		  "db.op.copyTitle": "Copy the database \u201C{from}\u201D",
		  "db.op.copyBody": "Copies the structure and the data into a new database. Views are not copied, because MySQL\u2019s CREATE TABLE \u2026 LIKE cannot copy a view.",
		  "db.op.copyData": "Copy the data as well",
		  "db.op.drop": "Drop database",
		  "db.op.dropTitle": "Drop the database \u201C{from}\u201D",
		  "db.op.dropBody": "The database and every table and row in it will be deleted, and this cannot be undone. Type the database name to confirm:",
		  "db.op.dropConfirm": "Type \u201C{from}\u201D to confirm",
		  "db.op.charsetTitle": "Change the character set of \u201C{from}\u201D",
		  "db.op.charsetBody": "This changes the database\u2019s default character set only; existing tables and columns are not converted.",
		  "db.op.charsetCurrent": "Currently: character set {charset}, collation {collate}",
		  "db.op.charsetNoSqlite": "SQLite has no database encoding to change: the whole database is fixed at UTF-8.",
		  "db.op.newName": "New name",
		  "db.op.submit": "Run",
		  "db.op.busy": "Running\u2026",
		  "db.op.done.create": "Created the database \u201C{name}\u201D",
		  "db.op.done.rename": "Renamed the database to \u201C{name}\u201D",
		  "db.op.done.copy": "Copied to the database \u201C{name}\u201D",
		  "db.op.done.drop": "Dropped the database \u201C{name}\u201D",
		  "db.op.done.charset": "Changed the character set of \u201C{name}\u201D",
		  "db.op.nameTaken": "A database with that name already exists",
		  "db.op.nameRequired": "A database name is required",
		  "db.op.nameInvalid": "A database name may only use letters, digits and underscores, and may not start with a digit",
		  "db.op.notSupported": "This engine does not support this operation",
		  "db.op.createHint": "A SQLite database is a file, so \u201Cnew database\u201D means a new data source pointing at a new file.",
		  "db.op.exportDb": "Export database",
		  "db.op.importDb": "Import into this database",
		  "db.op.refreshSchemas": "Reload databases",
		  "db.op.createTable": "New table",
		  "createTable.title": "New table",
		  "createTable.tableName": "Table name",
		  "createTable.columnName": "Column",
		  "createTable.columnNamePlaceholder": "e.g. id",
		  "createTable.columnType": "Type",
		  "createTable.group.integer": "Integer",
		  "createTable.group.float": "Decimal / float",
		  "createTable.group.string": "Text and character",
		  "createTable.group.binary": "Binary and large objects",
		  "createTable.group.temporal": "Date and time",
		  "createTable.group.spatial": "Spatial",
		  "createTable.group.other": "Other",
		  "createTable.typeCustom": "Custom\u2026",
		  "createTable.typeCustomMark": "(custom)",
		  "createTable.typeCustomPlaceholder": "e.g. decimal(10,2) unsigned",
		  "createTable.typeText": "Custom type",
		  "createTable.typeBackToList": "Back to the type list",
		  "createTable.attributesClear": "Clear the chosen attributes",
		  "createTable.thisColumn": "this column",
		  "createTable.columnLength": "Length/values",
		  "createTable.lengthHint": "e.g. 255, or 10,2 for DECIMAL, or 'a','b' for ENUM",
		  "createTable.lengthRequired": "The type {type} of column \u201C{name}\u201D needs a length/values: MySQL does not accept {type} without parentheses",
		  "createTable.sqliteLengthHint": "write it into the type",
		  "createTable.sqliteNoLength": "SQLite has no separate length/values (column \u201C{name}\u201D): it keeps the length in the type name but never enforces it. Write it into the type instead, e.g. VARCHAR(20).",
		  "createTable.columnCollate": "Collation",
		  "createTable.columnAttributes": "Attributes",
		  "createTable.attributeUnavailable": "The current type does not support this attribute",
		  "createTable.attributesHint": "Availability depends on the type: UNSIGNED/ZEROFILL need numeric, BINARY needs a string type, ON UPDATE needs a temporal type",
		  "createTable.attributeNotForType": "Column \u201C{name}\u201D of type {type} does not support the chosen attribute",
		  "createTable.attrOnUpdate": "ON UPDATE",
		  "createTable.columnIndex": "Index",
		  "createTable.index.primary": "PRIMARY",
		  "createTable.index.unique": "UNIQUE",
		  "createTable.index.index": "INDEX",
		  "createTable.index.fulltext": "FULLTEXT",
		  "createTable.index.spatial": "SPATIAL",
		  "createTable.indexUnavailable": "not for this type",
		  "createTable.indexName": "Index name",
		  "createTable.indexNamePlaceholder": "optional",
		  "createTable.indexNameHint": "Blank gives it a generated name; giving several columns the same index name makes ONE composite index, in column order",
		  "createTable.compositeHint": "Composite index: pick the same index kind for several columns in the \u7D22\u5F15 dropdown, then give them the SAME index name \u2014 they become one index, in column order. An empty index name gives that column an index of its own.",
		  "createTable.fulltextNeedsText": "A FULLTEXT index needs a text column; \u201C{name}\u201D is {type}",
		  "createTable.spatialNeedsGeometry": "A SPATIAL index needs a geometry column that is NOT NULL; \u201C{name}\u201D is not",
		  "createTable.columnComment": "Comment",
		  "createTable.sqliteNoCommentShort": "no comments in SQLite",
		  "createTable.sqliteNoComment": "SQLite has no column comments (column \u201C{name}\u201D): there is nowhere to store one",
		  "createTable.tableComment": "Table comment",
		  "createTable.tableCommentHint": "MySQL table comment",
		  "createTable.sqliteNoTableComment": "SQLite has no table comments: there is nowhere to store one",
		  "createTable.sqliteNoTableCommentShort": "no table comment in SQLite",
		  "createTable.tableCollate": "Collation",
		  "createTable.tableCollateDefault": "(default)",
		  "createTable.sqliteNoTableCollate": "SQLite has no table-level collation; it is per column",
		  "createTable.sqliteNoTableCollateShort": "no table collation in SQLite",
		  "createTable.tableEngine": "Storage engine",
		  "createTable.sqliteNoEngine": "SQLite has no storage engine to choose",
		  "createTable.sqliteNoEngineShort": "no engine in SQLite",
		  "createTable.tableTail": "Table options",
		  "createTable.lengthInvalid": "The length/values for \u201C{name}\u201D are not valid: digits (255 or 10,2) or quoted values ('a','b') only",
		  "createTable.autoNeedsNumeric": "{name} must be a numeric type to auto-increment",
		  "createTable.attributeSqliteUnsupported": "SQLite has no column attributes; the words are absorbed into the type name with no effect",
		  "createTable.columnKey": "Key",
		  "createTable.columnNullable": "Nullable",
		  "createTable.columnDefault": "Default",
		  "createTable.default.custom": "Custom\u2026",
		  "createTable.default.text": "Default value",
		  "createTable.default.backToList": "Back to the default list (no default)",
		  "createTable.default.emptyString": "empty means the empty string ''",
		  "createTable.default.needsTemporal": "temporal types only",
		  "createTable.default.hint": "No default = no DEFAULT clause. For the empty string choose \u81EA\u5B9A\u4E49\u2026 and leave the box blank \u2014 that turns the cell itself into a text box, and \u21BA goes back. A NOT NULL column cannot default to NULL.",
		  "createTable.columnAuto": "Auto",
		  "createTable.addColumn": "+ Add column",
		  "createTable.removeColumn": "Remove this column",
		  "createTable.lastColumn": "At least one column is required",
		  "createTable.keyNotNullable": "A key column cannot be nullable",
		  "createTable.autoNeedsKey": "To auto-increment, set this column as the PRIMARY key",
		  "createTable.autoAlreadyTaken": "A table can have only one auto-increment column, and \u201C{name}\u201D already has it",
		  "createTable.autoNeedsInteger": "On SQLite {name} must be INTEGER to auto-increment (INT is not the rowid alias)",
		  "createTable.hint": "New columns default to INT, an empty length/values and NOT NULL. Pick the type from the dropdown; its last entry \u81EA\u5B9A\u4E49\u2026 accepts any type. VARCHAR / VARBINARY / ENUM / SET need a length or value list of your own.",
		  "createTable.submit": "Create",
		  "createTable.nameRequired": "A table name is required",
		  "createTable.nameInvalid": "A table name may only use letters, digits and underscores, and may not start with a digit",
		  "createTable.nameTaken": "A table named \u201C{table}\u201D already exists",
		  "createTable.columnNameRequired": "Column {n} has no name",
		  "createTable.columnNameInvalid": "The column name \u201C{name}\u201D is not valid: letters, digits and underscores only, and it may not start with a digit",
		  "createTable.columnDuplicated": "The column name \u201C{name}\u201D is used twice",
		  "createTable.columnTypeRequired": "Column \u201C{name}\u201D has no type",
		  "createTable.autoIncrementDefault": "Column \u201C{name}\u201D is auto-increment and cannot also have a default",
		  "createTable.nullDefaultNeedsNullable": "Column \u201C{name}\u201D defaults to NULL but \u5141\u8BB8\u7A7A / Nullable is unticked: MySQL does not accept a NOT NULL column defaulting to NULL. Tick Nullable, or choose another default.",
		  "createTable.oneAutoIncrement": "Only one auto-increment column is allowed; ticked: {names}",
		  "createTable.done": "Created the table \u201C{table}\u201D",
		  "db.searchTable": "Filter tables\u2026",
		  "db.expand": "Expand",
		  "db.collapse": "Collapse",
		  "db.selectTable": "Pick a database on the left, then open a table",
		  "db.multipleDatabases": "Every database expands independently \u2014 click one to see its tables",
		  "db.selectSchema": "Pick a database on the left",
		  "db.overview": "Tables",
		  "db.overviewFor": "{schema} \u2014 {n} table(s)",
		  "db.overviewEmpty": "This database has no tables",
		  "db.filterPlaceholder": "Containing text:",
		  "db.col.table": "Table",
		  "db.col.rows": "Rows",
		  "db.col.type": "Type",
		  "db.col.collation": "Collation",
		  "db.col.size": "Size",
		  "db.col.comment": "Comment",
		  "db.col.actions": "Actions",
		  "db.type.table": "Table",
		  "db.type.view": "View",
		  "db.rowsUnknown": "unknown",
		  "db.rowsUnknown.hint": "SQLite keeps no row-count statistic until ANALYZE runs; this panel will not modify your database file to get one.",
		  "db.loadingStats": "Reading tables and statistics\u2026",
		  "db.action.browse": "Browse",
		  "db.action.structure": "Structure",
		  "db.action.search": "Search",
		  "db.action.insert": "Insert",
		  "db.action.truncate": "Empty",
		  "db.action.drop": "Drop",
		  "db.truncate.title": "Empty table",
		  "db.truncate.body": "Empty every row of \u201C{table}\u201D? The table structure is kept, but the data cannot be recovered.",
		  "db.truncate.bodyView": "\u201C{table}\u201D is a view, so it holds no rows of its own to empty.",
		  "db.truncate.done": "Emptied \u201C{table}\u201D",
		  "db.drop.title": "Drop table",
		  "db.drop.body": "Drop \u201C{table}\u201D? The table and all of its data will be removed, and this cannot be undone.",
		  "db.drop.bodyView": "Drop the view \u201C{table}\u201D? This cannot be undone.",
		  "db.drop.done": "Dropped \u201C{table}\u201D",
		  "db.action.failed": "Action failed: {error}",
		  "tab.browse": "Browse",
		  "tab.structure": "Structure",
		  "tab.sql": "SQL",
		  "tab.search": "Search",
		  "tab.insert": "Insert",
		  "tab.operation": "Operations",
		  "tableop.title": "Table operations",
		  "tableop.scope": "{schema} \xB7 {table}",
		  "tableop.viewHint": "\u201C{table}\u201D is a view; the blocks below apply to tables only.",
		  "tableop.move.title": "Move table to",
		  "tableop.move.body": "Move this table and all of its data to another database; it will no longer exist in this one.",
		  "tableop.move.target": "Target (database.table)",
		  "tableop.move.submit": "Move",
		  "tableop.move.busy": "Moving\u2026",
		  "tableop.move.done": "Moved \u201C{from}\u201D to \u201C{to}\u201D",
		  "tableop.move.same": "That is where it already is; pick another database or another table name",
		  "tableop.move.needsName": "A target table name is required",
		  "tableop.options.title": "Table options",
		  "tableop.options.body": "Change this table\u2019s own options. Only the fields you changed are submitted; the rest are left as the server has them.",
		  "tableop.options.loading": "Reading the table options\u2026",
		  "tableop.options.engine": "Storage engine",
		  "tableop.options.collation": "Collation",
		  "tableop.options.collationHint": "The character set is derived from the collation and set along with it.",
		  "tableop.options.convert": "Also convert the existing columns (CONVERT TO \u2014 rewrites the whole table)",
		  "tableop.options.convertHint": "Unticked changes the table default only; ticked re-encodes every column, which costs time proportional to the table\u2019s size.",
		  "tableop.options.comment": "Table comment",
		  "tableop.options.autoIncrement": "Next AUTO_INCREMENT value",
		  "tableop.options.autoIncrementHint": "Shown only when this table has an auto-increment column. A value below the highest one already used is partly ignored by MySQL.",
		  "tableop.options.rowFormat": "Row format",
		  "tableop.options.rowFormatDefault": "(unspecified)",
		  "tableop.options.submit": "Save table options",
		  "tableop.options.busy": "Saving\u2026",
		  "tableop.options.done": "Saved the options of \u201C{table}\u201D",
		  "tableop.options.unchanged": "Nothing was changed",
		  "tableop.options.aiInvalid": "AUTO_INCREMENT must be an integer of at least 1",
		  "tableop.options.commentBackslash": "A table comment cannot contain a backslash: MySQL reads it as an escape, so what is stored differs from what is typed",
		  "tableop.copy.title": "Copy table to",
		  "tableop.copy.body": "Copy the structure and the data into a new table in another database; the original is left alone. Indexes and the primary key come along; triggers and foreign keys pointing out of the table do not.",
		  "tableop.copy.target": "Target (database.table)",
		  "tableop.copy.data": "Copy the data too",
		  "tableop.copy.dataHint": "Unticked copies the structure only (phpMyAdmin\u2019s \u4EC5\u7ED3\u6784).",
		  "tableop.copy.submit": "Copy",
		  "tableop.copy.busy": "Copying\u2026",
		  "tableop.copy.done": "Copied to \u201C{to}\u201D",
		  "tableop.copy.needsName": "A target table name is required",
		  "tableop.copy.same": "The source and the target cannot be the same table",
		  "tableop.maint.title": "Table maintenance",
		  "tableop.maint.body": "Run the engine\u2019s maintenance statements on this table. The result lists the engine\u2019s own notes (for example that InnoDB tables do not support repair).",
		  "tableop.maint.check": "Check table",
		  "tableop.maint.optimize": "Optimize table",
		  "tableop.maint.repair": "Repair table",
		  "tableop.maint.analyze": "Analyze table",
		  "tableop.maint.unsupported": "This engine does not support it",
		  "tableop.maint.repairMissing": "SQLite has no REPAIR statement; recover from a backup or export and rebuild, and use \u68C0\u67E5\u8868 first to see how far the damage goes.",
		  "tableop.danger.title": "Delete data or table",
		  "tableop.danger.body": "Neither can be undone: emptying removes the rows only, dropping takes the structure with them.",
		  "tableop.danger.truncate": "Empty the data (keep the table)",
		  "tableop.danger.truncateHint": "On SQLite this is DELETE FROM: rows go one at a time and the AUTOINCREMENT counter is not reset.",
		  "tableop.danger.drop": "Drop the table",
		  "tableop.danger.dropHint": "The table, all of its data, its indexes and its triggers are removed.",
		  "tableop.danger.viewTruncate": "\u201C{table}\u201D is a view and has no rows of its own to empty.",
		  "tableop.unsupported.move": "A SQLite database is one file, so a table cannot be moved into another one; export to SQL and import it there instead.",
		  "tableop.unsupported.copy": "SQLite has no faithful table copy: CREATE TABLE \u2026 AS SELECT drops the primary key, the UNIQUE constraints and every generated column. Export and import instead.",
		  "tableop.unsupported.options": "SQLite has no table options to change: no storage engine, no table-level collation and nowhere to store a table comment.",
		  "tableop.supportFailed": "Could not read the table operations this engine supports: {error}",
		  "browse.refresh": "Refresh",
		  "browse.pageSize": "Per page",
		  "browse.total": "{n} row(s)",
		  "browse.page": "Page {page} / {pages}",
		  "browse.prev": "Previous",
		  "browse.next": "Next",
		  "browse.empty": "No data",
		  "browse.noPk": "This table has no primary key, so rows cannot be edited from Browse; use the SQL tab.",
		  "browse.jumpTo": "Go to",
		  "browse.jumpHint": "Type a page number and press Enter",
		  "browse.jumpOutOfRange": "The page must be between 1 and {pages}",
		  "browse.sortByIndex": "Sort by index",
		  "browse.sortIndexNone": "None",
		  "browse.sortAsc": "asc",
		  "browse.sortDesc": "desc",
		  "browse.sortTitle": "Pick an index and a direction",
		  "browse.sortByColumn": "Click to sort by this column; click again to switch asc / desc",
		  "browse.actions": "Actions",
		  "browse.select": "Select",
		  "browse.selectAll": "Select this page",
		  "browse.selectNone": "Clear selection",
		  "browse.selected": "{n} row(s) selected",
		  "browse.copy": "Copy",
		  "browse.copyRow": "Copy row",
		  "browse.copyCell": "Copy cell",
		  "browse.copied": "Copied to the clipboard",
		  "browse.copyFailed": "Copy failed: {error}",
		  "browse.editRow": "Edit",
		  "browse.deleteRow": "Delete",
		  "browse.deleteSelected": "Delete selected",
		  "browse.deleteManyTitle": "Delete selected rows",
		  "browse.deleteManyBody": "Delete the {n} selected rows? This cannot be undone.",
		  "browse.deleteManyNoPk": "This table has no primary key, so rows cannot be deleted in a batch; use the SQL tab with your own condition.",
		  "browse.distinctValues": "{n} distinct value(s)",
		  "browse.cellHint": "Double-click a cell to edit it; it saves when the field loses focus",
		  "browse.editCellTitle": "Edit this cell",
		  "browse.cellSaved": "Saved",
		  "browse.cellSaveFailed": "Save failed: {error}",
		  "browse.exportSelected": "Export selected",
		  "browse.rowCount": "Rows {from}\u2013{to} of {total}",
		  "structure.columns": "Columns",
		  "structure.indexes": "Indexes",
		  "structure.noIndexes": "No indexes",
		  "structure.col.name": "Column",
		  "structure.col.type": "Type",
		  "structure.col.nullable": "Null",
		  "structure.col.key": "Key",
		  "structure.col.default": "Default",
		  "structure.col.extra": "Extra",
		  "structure.col.comment": "Comment",
		  "structure.col.distinct": "Distinct",
		  "structure.col.actions": "Actions",
		  "structure.index.name": "Index",
		  "structure.index.unique": "Unique",
		  "structure.index.columns": "Columns",
		  "structure.index.type": "Type",
		  "structure.index.actions": "Actions",
		  "structure.select": "Select",
		  "structure.selected": "{n} column(s) selected",
		  "structure.edit": "Change",
		  "structure.drop": "Drop",
		  "structure.addColumn": "Add column",
		  "structure.newColumn": "Add a column",
		  "structure.editColumn": "Change \u201C{column}\u201D",
		  "structure.colName": "Name",
		  "structure.colNameRequired": "A column name is required",
		  "structure.colNameTaken": "The column \u201C{name}\u201D already exists",
		  "structure.typeOther": "Other type (type it)",
		  "structure.typeOtherPlaceholder": "e.g. decimal(10,2)",
		  "structure.typeText": "Type text",
		  "structure.typeEditableHint": "Editable directly; picking a common type above fills it in",
		  "structure.nullableKeyHint": "A key column cannot be nullable, so this is disabled",
		  "structure.defaultHint": "\u201Cunspecified\u201D and \u201Ccustom + blank\u201D are different: the first adds no DEFAULT clause, the second is the empty string ''. An existing default \u2014 including an expression \u2014 is kept as-is when you leave this alone.",
		  "structure.commentPlaceholder": "Optional",
		  "structure.indexOrderPreview": "Index column order",
		  "structure.addSubmit": "Add",
		  "structure.saveSubmit": "Save",
		  "structure.dropTitle": "Drop column",
		  "structure.dropBody": "Drop the column \u201C{column}\u201D? Its data goes with it, and this cannot be undone.",
		  "structure.dropRebuildNote": "SQLite can only drop a column by rebuilding the whole table: this plugin creates a replacement, copies the rows across, drops the original and renames the replacement \u2014 all in one transaction, so a failure rolls back. On a large table that step takes time.",
		  "structure.dropManyTitle": "Drop selected columns",
		  "structure.dropManyBody": "Drop the {n} selected columns? Their data goes with them, and this cannot be undone.",
		  "structure.setKey": "Make primary key",
		  "structure.setKeyOne": "A primary key is set from the key editor when it has several columns",
		  "structure.primaryKey": "Primary key",
		  "structure.editKey": "Edit key",
		  "structure.keyTitle": "Primary key",
		  "structure.keyBody": "Tick the columns that form the key, in order. Clearing every tick removes the key.",
		  "structure.keyOrder": "Position {n}",
		  "structure.keySave": "Save key",
		  "structure.keyProbeOnly": "This table is used to probe non-exclusive operations; the key was not changed.",
		  "structure.unique": "Unique",
		  "structure.toggleUnique": "Toggle the UNIQUE constraint",
		  "structure.distinctTitle": "Distinct values",
		  "structure.distinctBody": "Column \u201C{column}\u201D holds {n} distinct non-NULL value(s).",
		  "structure.distinctLoading": "Counting\u2026",
		  "structure.distinctFailed": "Count failed: {error}",
		  "structure.addIndex": "Add index",
		  "structure.indexName": "Index name",
		  "structure.indexColumns": "Columns",
		  "structure.indexColumnsHint": "Tick them in order; the order decides which prefixes the index can serve.",
		  "structure.indexUnique": "Unique index",
		  "structure.createIndex": "Create index",
		  "structure.dropIndexTitle": "Drop index",
		  "structure.dropIndexBody": "Drop the index \u201C{name}\u201D?",
		  "structure.dropIndexesSelected": "Drop selected indexes",
		  "structure.noColumnsSelected": "Pick at least one column",
		  "structure.indexNameRequired": "An index name is required",
		  "structure.indexNameTaken": "The index \u201C{name}\u201D already exists",
		  "structure.primaryNotDroppable": "The primary key's index cannot be dropped on its own; change the key instead",
		  "structure.generated": "Generated",
		  "structure.generatedHint": "The database computes this column; it cannot be edited or inserted directly.",
		  "structure.refreshFirst": "Refresh the structure first",
		  "structure.done": "Structure updated",
		  "structure.dropSelected": "Drop selected columns",
		  "structure.applyUnique": "UNIQUE",
		  "structure.tableOptions": "Table",
		  "structure.engine": "Engine",
		  "structure.collation": "Collation",
		  "structure.comment": "Comment",
		  "search.column": "Column",
		  "search.type": "Type",
		  "search.collation": "Collation",
		  "search.operator": "Operator",
		  "search.value": "Value",
		  "search.value2": "Upper bound",
		  "search.valuePlaceholder": "Type a value",
		  "search.valuePlaceholder.in": "Comma separated, e.g. a,b,c",
		  "search.betweenFrom": "from",
		  "search.betweenTo": "to",
		  "search.betweenNeedsBoth": "\u201C{column}\u201D uses \u4ECB\u4E8E / between, so both bounds are required.",
		  "search.qbeHint": "Query by example: one row per column \u2014 fill in only the rows you are searching for, and only those take part (combined with AND). Leaving every row blank shows all rows.",
		  "search.needStructure": "This table's structure has not been read yet; refresh and try again.",
		  "search.allRows": "No condition set \u2014 all rows will be shown",
		  "search.usedCount": "{n} condition(s) set",
		  "search.matched": "{n} row(s) matched",
		  "search.reset": "Clear conditions",
		  "search.run": "Go",
		  "search.hint": "\u201Ccontains / starts with / ends with\u201D treat % and _ as ordinary characters, and every value is bound as a parameter rather than written into the SQL. Use the SQL tab for arbitrary SQL.",
		  "search.op.eq": "equals",
		  "search.op.neq": "not equal",
		  "search.op.gt": "greater than",
		  "search.op.gte": "greater or equal",
		  "search.op.lt": "less than",
		  "search.op.lte": "less or equal",
		  "search.op.contains": "contains",
		  "search.op.notContains": "does not contain",
		  "search.op.startsWith": "starts with",
		  "search.op.endsWith": "ends with",
		  "search.op.between": "between",
		  "search.op.in": "in list",
		  "search.op.isNull": "is NULL",
		  "search.op.isNotNull": "is not NULL",
		  "insert.title": "Insert a row",
		  "insert.hint": "A blank column is left out of the INSERT, so the database fills in its default or NULL. Tick NULL to store NULL explicitly.",
		  "insert.submit": "Insert",
		  "insert.submitAndNew": "Insert and add another",
		  "insert.done": "{n} row(s) inserted",
		  "insert.doneAndBrowsing": "{n} row(s) inserted \u2014 switched to Browse",
		  "insert.rowsDoneBrowsing": "{n} row(s) inserted ({forms} form(s)) \u2014 switched to Browse",
		  "insert.required": "Column \u201C{column}\u201D cannot be empty",
		  "insert.autoAssign": "Leave blank to assign automatically",
		  "insert.blankHint": "(blank \u2014 use the default)",
		  "insert.chooseHint": "(choose one)",
		  "insert.nullHint": "Store NULL explicitly (unlike leaving it blank)",
		  "insert.setEmpty": "Empty string",
		  "insert.emptyHint": "Store the empty string explicitly (the column is NOT NULL with no default, so blank is refused)",
		  "insert.defaultSuffix": "default: {value}",
		  "insert.boolTrue": "Yes (1)",
		  "insert.boolFalse": "No (0)",
		  "insert.numberInvalid": "Column \u201C{column}\u201D needs a number",
		  "insert.valueTooLong": "Column \u201C{column}\u201D holds at most {max} characters",
		  "insert.rowsLabel": "Number of rows",
		  "insert.rowsApply": "Apply",
		  "insert.rowsRange": "The row count must be a whole number from 1 to {max}",
		  "insert.addRow": "Add a row",
		  "insert.removeRow": "Remove this row",
		  "insert.rowsDone": "{n} row(s) inserted ({forms} form(s))",
		  "insert.formOf": "Set {n}",
		  "export.title": "Export",
		  "export.format": "Format",
		  "export.format.sql": "SQL dump (.sql)",
		  "export.format.csv": "CSV (.csv, current table only)",
		  "export.scope": "Scope",
		  "export.scope.schema": "Whole database ({n} table(s))",
		  "export.scope.table": "Current table only",
		  "export.scope.selected": "Selected rows only",
		  "export.scope.chosen": "{n} table(s) chosen",
		  "export.includeStructure": "Include the structure (CREATE)",
		  "export.includeData": "Include the data (INSERT)",
		  "export.dropTable": "Include DROP TABLE",
		  "export.dropWarn": "With this on, importing into an existing database deletes same-named tables first and rebuilds them.",
		  "export.submit": "Export and download",
		  "export.busy": "Generating\u2026",
		  "export.done": "Downloaded {name} ({size})",
		  "export.empty": "There is no table to export",
		  "export.truncated": "{n} table(s) exceeded the export row cap and were truncated in the file.",
		  "export.csvOneTable": "CSV can only export one table at a time",
		  "export.hint": "The export is generated locally and never goes through the agent; the browser saves the file directly.",
		  "import.title": "Import",
		  "import.format": "Format",
		  "import.format.sql": "SQL file (.sql)",
		  "import.format.csv": "CSV file (.csv)",
		  "import.table": "Target table",
		  "import.tableHint": "The CSV rows go into this table, matched by the header names.",
		  "import.file": "File",
		  "import.choose": "Choose a file\u2026",
		  "import.noFile": "No file chosen",
		  "import.hasHeader": "The first line names the columns",
		  "import.hasHeaderHint": "Unticked, the fields are matched to the target table's column order.",
		  "import.emptyAsNull": "Treat an empty field as NULL",
		  "import.emptyAsNullHint": "Unticked, an empty field becomes an empty string.",
		  "import.submit": "Start the import",
		  "import.busy": "Importing\u2026",
		  "import.warn": "An import writes data and cannot be undone. A DROP TABLE in a SQL file deletes same-named tables.",
		  "import.refuseTooBig": "The file is too large: {size}, above the {limit} limit",
		  "import.done": "{n} statement(s) executed",
		  "import.doneRows": "{n} row(s) imported",
		  "import.skipped": "{n} record(s) had a field count that disagreed with the header and were skipped: line(s) {lines}",
		  "import.needTable": "Pick the table to import into",
		  "import.needFile": "Choose a file to import",
		  "import.hint": "A SQL file runs statement by statement; a CSV file is inserted by column name.",
		  "sql.placeholder": "Type one SQL statement; Ctrl+Enter runs it",
		  "sql.run": "Run",
		  "sql.running": "Running\u2026",
		  "sql.allowWrite": "Allow writes",
		  "sql.allowWrite.hint": "While unticked only read-only statements (SELECT / SHOW / DESCRIBE / EXPLAIN) are accepted.",
		  "sql.affected": "{n} row(s) affected in {ms} ms",
		  "sql.rows": "{n} row(s) in {ms} ms",
		  "sql.truncated": "Result truncated",
		  "edit.title": "Edit row",
		  "edit.submit": "Save",
		  "edit.delete": "Delete this row",
		  "edit.done": "{n} row(s) updated",
		  "edit.deleted": "{n} row(s) deleted",
		  "redis.info": "Server info",
		  "redis.keys": "Keys",
		  "redis.pattern": "Pattern",
		  "redis.loadMore": "Load more",
		  "redis.noMore": "End of scan",
		  "redis.scanned": "{n} key(s) scanned",
		  "redis.noKeys": "No matching keys",
		  "redis.key": "Key",
		  "redis.type": "Type",
		  "redis.ttl": "TTL",
		  "redis.ttl.none": "no expiry",
		  "redis.size": "Size",
		  "redis.value": "Value",
		  "redis.field": "Field",
		  "redis.member": "Member",
		  "redis.score": "Score",
		  "redis.entry": "Entry ID",
		  "redis.truncated": "This collection is large; showing the first {n} element(s)",
		  "redis.selectKey": "Select a key on the left to inspect it",
		  "redis.console": "Console",
		  "redis.consolePlaceholder": "Type a command, e.g. GET mykey or HGETALL myhash",
		  "redis.consoleRun": "Run",
		  "redis.consoleDb": "Database:",
		  "redis.index.title": "Build an index for db{n}?",
		  "redis.index.why": "This database holds {keys} keys. Redis has no prefix index, so listing any level walks the whole keyspace \u2014 per-level scanning cannot work at this size. Building the index once takes about {seconds}s, and every level is then instant.",
		  "redis.index.warning": "The walk keeps this Redis server busy while it runs (in small batches, each pausing the server only briefly). On a production server, prefer an off-peak time.",
		  "redis.index.confirm": "Build the index",
		  "redis.index.skip": "Not now",
		  "redis.index.building": "Indexing db{n}: {visited} / {total} scanned, {folders} folders found\u2026",
		  "redis.allowWrite": "Allow writes",
		  "redis.allowWrite.hint": "While unticked only read commands are accepted (GET/HGETALL/LRANGE/SCAN/INFO \u2026).",
		  "redis.version": "Version",
		  "redis.mode": "Mode",
		  "redis.uptime": "Uptime",
		  "redis.memory": "Used memory",
		  "redis.clients": "Clients",
		  "redis.totalKeys": "Keys in current db",
		  "redis.databases": "Databases",
		  "redis.db": "DB",
		  "redis.db.switch": "Database to browse",
		  "redis.values": "Values",
		  "redis.stringValue": "String value",
		  "redis.readonlyNotice": "Browsing read-only; tick \u201CAllow writes\u201D to run write commands.",
		  "redisdb.switch": "Database to browse",
		  "redisdb.keysInDb": "{n} keys",
		  "redisdb.filter": "Search key names\u2026",
		  "redisdb.search.hint": "Redis wildcards work: jd:* , *session* , ? \u2026",
		  "redisdb.search.run": "Search",
		  "redisdb.search.clear": "Clear search",
		  "redisdb.search.running": "Searching\u2026",
		  "redisdb.search.header": "Keys in db{n} matching \u201C{pattern}\u201D (grouped by folder)",
		  "redisdb.search.count": "{n} key(s) found",
		  "redisdb.search.none": "No matching keys ({scanned} scanned)",
		  "redisdb.search.truncated": "Many matches; showing the first {shown} \u2014 narrow the pattern",
		  "redisdb.search.scope.db": "Search in db{n}",
		  "redisdb.search.clearHint": "Clear the box to return to the folder tree",
		  "redisdb.refresh": "Rescan",
		  "redisdb.loading": "Scanning\u2026",
		  "redisdb.empty": "This database has no keys",
		  "redisdb.truncated": "More keys than the {n} cap; folders may be incomplete \u2014 narrow the filter.",
		  "redisdb.levelTruncated": "This level holds {total} keys; showing the first {shown}. Narrow the filter.",
		  "redisdb.levelApproximate": "This database holds {total} keys and only {scanned} were scanned here: folders may be missing and counts are lower bounds.",
		  "redisdb.dbSummary": "db{n} \xB7 {keys} keys",
		  "redisdb.folder": "Folder",
		  "redisdb.keyCount": "{n}",
		  "redisnew.title": "New key",
		  "redisnew.titleIn": "New key under \u201C{path}\u201D",
		  "redisnew.name": "Key name",
		  "redisnew.name.placeholder": "One per line; \u201C:\u201D creates folders",
		  "redisnew.name.hintRoot": "Several at once is fine (one per line). A \u201C:\u201D in the name creates folders.",
		  "redisnew.name.hintFolder": "The prefix \u201C{prefix}\u201D is filled in; just type the rest. One per line.",
		  "redisnew.type": "Type",
		  "redisnew.content": "Content",
		  "redisnew.ttl": "Expiry",
		  "redisnew.ttl.unit": "seconds",
		  "redisnew.ttl.hint": "Blank or 0 means no expiry.",
		  "redisnew.submit": "Create",
		  "redisnew.busy": "Creating\u2026",
		  "redisnew.done": "{n} key(s) created",
		  "redisnew.nameRequired": "A key name is required",
		  "redisnew.overwritten": "Key \u201C{key}\u201D already exists and was not overwritten.",
		  "redisdelete.keyTitle": "Delete key",
		  "redisdelete.keyBody": "Delete the key \u201C{key}\u201D? This cannot be undone.",
		  "redisdelete.folderTitle": "Delete folder",
		  "redisdelete.folderBody": "Folder \u201C{path}\u201D holds {n} key(s) including sub-folders; all of them will be deleted. This cannot be undone.",
		  "redisdelete.folderBodyUnknown": "Every key under \u201C{path}\u201D will be deleted. This cannot be undone.",
		  "redisdelete.counting": "Counting\u2026",
		  "redisdelete.confirm": "Delete",
		  "redisdelete.deleting": "Deleting\u2026",
		  "redisdelete.done": "{n} key(s) deleted",
		  "redisdelete.truncated": "Reached this run\u2019s deletion limit; keys may remain \u2014 run it again.",
		  "action.newKey": "New key",
		  "action.newKeyInFolder": "New key in this folder",
		  "action.deleteFolder": "Delete folder",
		  "redisedit.save": "Save",
		  "redisedit.revert": "Revert",
		  "redisedit.saved": "Saved",
		  "redisedit.unsaved": "Unsaved changes",
		  "redisedit.ctrlEnter": "Ctrl+Enter to save",
		  "redisedit.index": "#",
		  "redisedit.rowDeleted": "Deleted",
		  "redisedit.appended": "Appended",
		  "redisedit.append": "Append",
		  "redisedit.appendPlaceholder": "Element to append; Enter to submit",
		  "redisedit.add": "Add",
		  "redisedit.added": "Added",
		  "redisedit.addMember": "Add member",
		  "redisedit.addField": "Add field",
		  "redisedit.addMemberPlaceholder": "Member to add; Enter to submit",
		  "redisedit.scoreNotNumber": "Score is not a number: {score}",
		  "redisedit.ttl.edit": "Edit TTL",
		  "redisedit.ttl.persist": "Make permanent",
		  "redisedit.ttl.persist.hint": "Removes the expiry (PERSIST); the key and its value are kept.",
		  "redisedit.ttl.done": "TTL set to {ttl}",
		  "redisedit.ttl.expired": "expired",
		  "redisedit.ttl.expired.hint": "The expiry time passed and Redis deleted this key.",
		  "redisedit.ttl.expired.reload": "Re-read",
		  "redisedit.readonlyType": "{type} cannot be edited here: stream entries are produced by XADD and rewriting one would break its ID semantics. Use the console.",
		  "redisedit.deleted": "Deleted",
		  "col.delete": "Delete",
		  "common.delete": "Delete",
		  "common.loading": "Loading\u2026",
		  "common.refresh": "Refresh",
		  "common.close": "Close",
		  "common.confirm": "OK",
		  "common.cancel": "Cancel",
		  "common.yes": "Yes",
		  "common.no": "No",
		  "common.error": "Error: {error}",
		  "common.null": "NULL",
		  "common.none": "\u2014"
		};

		// src/client/ttl.ts
		function readTtl(seconds, now = Date.now()) {
		  return { seconds, at: now };
		}
		function remainingSeconds(reading, now = Date.now()) {
		  if (reading.seconds < 0) return reading.seconds;
		  const elapsed = Math.floor((now - reading.at) / 1e3);
		  return Math.max(0, reading.seconds - elapsed);
		}
		function countsDown(reading) {
		  return reading.seconds >= 0;
		}
		function formatDuration(seconds) {
		  if (seconds < 60) return `${seconds}s`;
		  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
		  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
		  return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h`;
		}

		// src/client/ui.ts
		function dictionary() {
		  const lang = typeof document !== "undefined" ? document.documentElement.lang : "zh";
		  return lang.toLowerCase().startsWith("en") ? en : zh;
		}
		function t(key, values) {
		  const template = dictionary()[key] ?? key;
		  if (values === void 0) return template;
		  return template.replace(
		    /\{(\w+)\}/g,
		    (match, name) => Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
		  );
		}
		function errorText(error) {
		  return error instanceof Error ? error.message : String(error);
		}
		function formatBytes(bytes) {
		  if (bytes === void 0) return t("common.none");
		  if (bytes < 1024) return `${bytes} B`;
		  const units = ["KB", "MB", "GB", "TB"];
		  let value = bytes / 1024;
		  let unit = 0;
		  while (value >= 1024 && unit < units.length - 1) {
		    value /= 1024;
		    unit++;
		  }
		  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
		}
		function formatTtl(seconds) {
		  if (seconds === -1) return t("redis.ttl.none");
		  if (seconds === -2) return t("common.none");
		  return formatDuration(seconds);
		}
		function formatUptime(seconds) {
		  if (seconds === void 0) return t("common.none");
		  return formatTtl(seconds);
		}
		function renderCell(value) {
		  if (value === null) return t("common.null");
		  return String(value);
		}
		function isNull(value) {
		  return value === null;
		}
		function Modal(props) {
		  const { title, onClose, footer, children } = props;
		  React.useEffect(() => {
		    const onKey = (event) => {
		      if (event.key === "Escape") onClose();
		    };
		    document.addEventListener("keydown", onKey);
		    return () => document.removeEventListener("keydown", onKey);
		  }, [onClose]);
		  return React.createElement(
		    "div",
		    {
		      className: "dbm-overlay",
		      onMouseDown: (event) => {
		        if (event.target === event.currentTarget) onClose();
		      }
		    },
		    React.createElement(
		      "div",
		      { className: `dbm-modal${props.wide === true ? " dbm-modal-wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
		      React.createElement("div", { className: "dbm-modal-head" }, title),
		      React.createElement("div", { className: "dbm-modal-body" }, children),
		      // The footer wrapper owns the top border and nothing else: button layout
		      // belongs to the caller, so a dialog that needs its own arrangement
		      // (e.g. a secondary action on the left) is not fighting this row. It was
		      // previously right-aligned here, which nested a second flex row inside it
		      // and quietly broke the split layout.
		      footer === void 0 ? null : React.createElement("div", { className: "dbm-modal-foot" }, footer)
		    )
		  );
		}
		function TabStrip(props) {
		  return React.createElement(
		    "div",
		    { className: "dbm-tabs", role: "tablist" },
		    props.tabs.map(
		      (tab) => React.createElement(
		        "button",
		        {
		          key: tab.id,
		          type: "button",
		          role: "tab",
		          className: "dbm-tab",
		          "data-active": String(props.active === tab.id),
		          "aria-selected": props.active === tab.id,
		          onClick: () => props.onChange(tab.id)
		        },
		        tab.label
		      )
		    )
		  );
		}
		function ErrorBanner(props) {
		  return React.createElement("div", { className: "dbm-error" }, props.message);
		}
		function BackButton(props) {
		  const label = props.label ?? t("panel.backToConversation");
		  return React.createElement(
		    "button",
		    {
		      type: "button",
		      className: "dbm-btn dbm-btn-ghost dbm-back",
		      "aria-label": label,
		      "data-dsh-center-view-back": "",
		      onClick: props.onBack
		    },
		    React.createElement("span", { "aria-hidden": "true" }, "\u2039"),
		    React.createElement("span", null, label)
		  );
		}
		function Empty(props) {
		  return React.createElement("div", { className: "dbm-empty" }, props.message);
		}
		async function copyText(text) {
		  try {
		    if (typeof navigator === "undefined" || navigator.clipboard === void 0) {
		      return "the clipboard API is unavailable (a secure origin is required)";
		    }
		    await navigator.clipboard.writeText(text);
		    return null;
		  } catch (failure) {
		    return errorText(failure);
		  }
		}
		function PageJump(props) {
		  const { page, pages, onGo } = props;
		  const [text, setText] = React.useState(String(page));
		  const [error, setError] = React.useState(void 0);
		  React.useEffect(() => {
		    setText(String(page));
		    setError(void 0);
		  }, [page]);
		  const submit = () => {
		    const wanted = Number(text.trim());
		    if (!Number.isFinite(wanted) || Math.trunc(wanted) !== wanted || wanted < 1 || wanted > pages) {
		      setError(t("browse.jumpOutOfRange", { pages }));
		      return;
		    }
		    setError(void 0);
		    if (wanted !== page) onGo(wanted);
		  };
		  return React.createElement(
		    "span",
		    { className: "dbm-row", style: { gap: 4 } },
		    React.createElement("label", { className: "dbm-hint" }, t("browse.jumpTo")),
		    React.createElement("input", {
		      className: "dbm-input",
		      style: { width: 64 },
		      value: text,
		      inputMode: "numeric",
		      title: t("browse.jumpHint"),
		      "aria-label": t("browse.jumpTo"),
		      "data-dbm-page-jump": "",
		      onChange: (event) => setText(event.target.value),
		      onKeyDown: (event) => {
		        if (event.key !== "Enter") return;
		        event.preventDefault();
		        submit();
		      },
		      onBlur: submit
		    }),
		    error === void 0 ? null : React.createElement("span", { className: "dbm-cell-failed" }, error)
		  );
		}
		function SortMark(props) {
		  const { direction } = props;
		  if (direction === "none") return null;
		  return React.createElement(
		    "span",
		    { className: "dbm-sort-mark", "aria-label": direction === "asc" ? t("browse.sortAsc") : t("browse.sortDesc") },
		    direction === "asc" ? "\u25B2" : "\u25BC"
		  );
		}

		// src/client/RedisKeyTree.ts
		function typeGlyph(type) {
		  switch (type) {
		    case "string":
		      return "T";
		    case "list":
		      return "L";
		    case "set":
		      return "S";
		    case "zset":
		      return "Z";
		    case "hash":
		      return "H";
		    case "stream":
		      return "X";
		    default:
		      return "?";
		  }
		}
		function leafName(key) {
		  const at = key.lastIndexOf(":");
		  return at === -1 ? key : key.slice(at + 1);
		}
		function levelKey(db, prefix) {
		  return `${db}\0${prefix}`;
		}
		function RedisKeyTree(props) {
		  const { databases, levels, openDbs, openFolders, search, searchDb, selection, activeKey } = props;
		  const renderKey = (db, info, depth, stale = false) => React2.createElement(
		    "div",
		    {
		      key: `key-${db}-${info.key}`,
		      className: `dbm-tree-node dbm-tree-depth-${Math.min(depth, 8)}${stale ? " dbm-tree-stale" : ""}`,
		      "data-active": String(activeKey?.db === db && activeKey.key === info.key),
		      "data-kind": "key",
		      "data-key": info.key,
		      title: info.key,
		      role: "treeitem",
		      onClick: () => props.onSelectKey(db, info.key)
		    },
		    React2.createElement("span", { className: "dbm-tree-caret" }, typeGlyph(info.type)),
		    React2.createElement("span", { className: "dbm-tree-glyph" }, "\u{1F511}"),
		    // Only the last segment: the folder rows above already name the prefix, in
		    // the tree and in search results alike (both are built from the same
		    // grouping), so repeating it in every leaf would make a deep key unreadable.
		    React2.createElement("span", { className: "dbm-tree-name dbm-mono" }, leafName(info.key)),
		    info.ttl === -1 ? null : React2.createElement("span", { className: "dbm-tree-meta" }, `${info.ttl}s`),
		    React2.createElement(
		      "span",
		      { className: "dbm-tree-actions" },
		      React2.createElement(
		        "button",
		        {
		          type: "button",
		          className: "dbm-icon-btn dbm-icon-btn-danger",
		          title: t("action.delete"),
		          "aria-label": t("action.delete"),
		          onClick: (event) => {
		            event.stopPropagation();
		            props.onDeleteKey(db, info.key);
		          }
		        },
		        "\u{1F5D1}"
		      )
		    )
		  );
		  const renderFolder = (db, name, path, count, depth, isOpen, stale, actions) => React2.createElement(
		    "div",
		    {
		      key: `folder-${db}-${path}`,
		      className: `dbm-tree-node dbm-tree-depth-${Math.min(depth, 8)}${stale ? " dbm-tree-stale" : ""}`,
		      "data-active": String(selection?.kind === "folder" && selection.db === db && selection.path === path),
		      "data-kind": "folder",
		      "data-path": path,
		      title: path,
		      role: "treeitem",
		      "aria-expanded": isOpen,
		      // Announced while a refresh is in flight, so the state is not conveyed
		      // by the dimming alone.
		      "aria-busy": stale ? "true" : void 0,
		      // A folder row is both "select it" (so an action can target it) and
		      // "open it". The row does both on one click, which is what RDM does.
		      onClick: () => {
		        props.onSelectFolder(db, path, name);
		        props.onToggleFolder(db, path);
		      }
		    },
		    React2.createElement("span", { className: "dbm-tree-caret" }, isOpen ? "\u25BE" : "\u25B8"),
		    React2.createElement("span", { className: "dbm-tree-glyph" }, isOpen ? "\u{1F4C2}" : "\u{1F4C1}"),
		    React2.createElement("span", { className: "dbm-tree-name dbm-mono" }, name),
		    React2.createElement("span", { className: "dbm-tree-meta" }, String(count)),
		    actions ? React2.createElement(
		      "span",
		      { className: "dbm-tree-actions" },
		      React2.createElement(
		        "button",
		        {
		          type: "button",
		          className: "dbm-icon-btn",
		          title: t("action.newKeyInFolder"),
		          "aria-label": t("action.newKeyInFolder"),
		          onClick: (event) => {
		            event.stopPropagation();
		            props.onCreate(db, path);
		          }
		        },
		        "\uFF0B"
		      ),
		      React2.createElement(
		        "button",
		        {
		          type: "button",
		          className: "dbm-icon-btn dbm-icon-btn-danger",
		          title: t("action.deleteFolder"),
		          "aria-label": t("action.deleteFolder"),
		          onClick: (event) => {
		            event.stopPropagation();
		            props.onDeleteFolder(db, path);
		          }
		        },
		        "\u{1F5D1}"
		      )
		    ) : null
		  );
		  const renderLevel = (db, prefix, depth) => {
		    const level = levels[levelKey(db, prefix)];
		    const rows2 = [];
		    if (level === void 0) {
		      rows2.push(React2.createElement("div", {
		        key: `loading-${db}-${prefix}`,
		        className: `dbm-tree-hint dbm-tree-depth-${Math.min(depth, 8)} dbm-hint dbm-tree-pending`
		      }, t("redisdb.loading")));
		      return rows2;
		    }
		    const refreshing = level.loading === true;
		    if (refreshing && level.folders.length === 0 && level.keys.length === 0) {
		      rows2.push(React2.createElement("div", {
		        key: `loading-${db}-${prefix}`,
		        className: `dbm-tree-hint dbm-tree-depth-${Math.min(depth, 8)} dbm-hint dbm-tree-pending`
		      }, t("redisdb.loading")));
		      return rows2;
		    }
		    if (level.error !== void 0) {
		      rows2.push(React2.createElement("div", {
		        key: `err-${db}-${prefix}`,
		        className: `dbm-tree-hint dbm-tree-depth-${Math.min(depth, 8)} dbm-error`
		      }, level.error));
		      return rows2;
		    }
		    const folders = level.folders;
		    const keys = level.keys;
		    if (folders.length === 0 && keys.length === 0) {
		      rows2.push(React2.createElement("div", {
		        key: `empty-${db}-${prefix}`,
		        className: `dbm-tree-hint dbm-tree-depth-${Math.min(depth, 8)} dbm-hint`
		      }, t("redisdb.empty")));
		      return rows2;
		    }
		    for (const folder of folders) {
		      const isOpen = openFolders[db]?.[folder.path] === true;
		      rows2.push(renderFolder(db, folder.name, folder.path, folder.keys, depth, isOpen, refreshing, true));
		      if (isOpen) rows2.push(...renderLevel(db, folder.path, depth + 1));
		    }
		    for (const info of keys) rows2.push(renderKey(db, info, depth, refreshing));
		    if (level.countsApproximate === true) {
		      rows2.push(React2.createElement("div", {
		        key: `approx-${db}-${prefix}`,
		        className: `dbm-tree-hint dbm-tree-depth-${Math.min(depth, 8)} dbm-hint`
		      }, t("redisdb.levelApproximate", {
		        scanned: (level.scannedKeys ?? 0).toLocaleString(),
		        total: (level.dbSize ?? 0).toLocaleString()
		      })));
		    } else if (level.truncated) {
		      rows2.push(React2.createElement("div", {
		        key: `trunc-${db}-${prefix}`,
		        className: `dbm-tree-hint dbm-tree-depth-${Math.min(depth, 8)} dbm-hint`
		      }, t("redisdb.levelTruncated", { shown: level.keys.length, total: level.keysAtLevel })));
		    }
		    return rows2;
		  };
		  if (search !== void 0) {
		    const rows2 = [];
		    rows2.push(React2.createElement("div", {
		      key: "search-header",
		      className: "dbm-tree-hint dbm-hint dbm-search-header"
		      // The placeholder must match the locale template exactly: it reads
		      // 'db{n} … {pattern}', so the number is passed as `n`. Passing `db` (as
		      // this did) left the header showing a literal "db{n}" — caught by reading
		      // the RENDERED text in the E2E rather than trusting the call site.
		    }, t("redisdb.search.header", { n: searchDb, pattern: search.pattern })));
		    if (search.loading) {
		      rows2.push(React2.createElement("div", {
		        key: "search-loading",
		        className: "dbm-tree-hint dbm-hint dbm-tree-pending"
		      }, t("redisdb.search.running")));
		      return React2.createElement("div", { role: "tree" }, rows2);
		    }
		    if (search.error !== void 0) {
		      rows2.push(React2.createElement("div", { key: "search-error", className: "dbm-tree-hint dbm-error" }, search.error));
		      return React2.createElement("div", { role: "tree" }, rows2);
		    }
		    const matches2 = search.keys ?? [];
		    if (matches2.length === 0) {
		      rows2.push(React2.createElement("div", {
		        key: "search-empty",
		        className: "dbm-tree-hint dbm-hint"
		      }, t("redisdb.search.none", { scanned: search.scanned ?? 0 })));
		      return React2.createElement("div", { role: "tree" }, rows2);
		    }
		    rows2.push(React2.createElement("div", {
		      key: "search-count",
		      className: "dbm-tree-hint dbm-hint"
		    }, search.truncated === true ? t("redisdb.search.truncated", { shown: matches2.length }) : t("redisdb.search.count", { n: matches2.length })));
		    const renderSearchFolder = (node, depth) => {
		      const out = [
		        // Count comes from the built subtree, not from the server: a search
		        // result's folder holds only its MATCHES, so the server's key count for
		        // that prefix would be a much larger number than what is on screen.
		        renderFolder(searchDb, node.name, node.path, countFolderKeys(node), depth, true, false, false)
		      ];
		      for (const child of node.folders) out.push(...renderSearchFolder(child, depth + 1));
		      for (const info of node.keys) out.push(renderKey(searchDb, info, depth + 1));
		      return out;
		    };
		    const built = buildRedisTree(matches2, search.truncated === true);
		    for (const node of built.folders) rows2.push(...renderSearchFolder(node, 0));
		    for (const info of built.keys) rows2.push(renderKey(searchDb, info, 0));
		    return React2.createElement("div", { role: "tree" }, rows2);
		  }
		  const rows = [];
		  for (const node of databases) {
		    const isOpen = openDbs[node.db] === true;
		    const selected = selection?.kind === "db" && selection.db === node.db;
		    const rootLoading = levels[levelKey(node.db, "")]?.loading === true;
		    rows.push(
		      React2.createElement(
		        "div",
		        {
		          key: `db-${node.db}`,
		          className: `dbm-tree-node dbm-tree-depth-0${rootLoading ? " dbm-tree-stale" : ""}`,
		          "data-active": String(selected),
		          "data-kind": "db",
		          "data-db": String(node.db),
		          "aria-busy": rootLoading ? "true" : void 0,
		          title: t("redisdb.dbSummary", { n: node.db, keys: node.keys }),
		          role: "treeitem",
		          "aria-expanded": isOpen,
		          onClick: () => props.onToggleDb(node.db)
		        },
		        React2.createElement("span", { className: "dbm-tree-caret" }, isOpen ? "\u25BE" : "\u25B8"),
		        React2.createElement("span", { className: "dbm-tree-glyph" }, "\u{1F5C4}"),
		        React2.createElement("span", { className: "dbm-tree-name" }, `db${node.db}`),
		        rootLoading ? React2.createElement("span", { className: "dbm-tree-meta dbm-spinner", "aria-label": t("redisdb.loading") }) : React2.createElement("span", { className: "dbm-tree-meta" }, String(node.keys)),
		        React2.createElement(
		          "span",
		          { className: "dbm-tree-actions" },
		          React2.createElement(
		            "button",
		            {
		              type: "button",
		              className: "dbm-icon-btn",
		              title: t("action.newKey"),
		              "aria-label": t("action.newKey"),
		              onClick: (event) => {
		                event.stopPropagation();
		                props.onCreate(node.db, void 0);
		              }
		            },
		            "\uFF0B"
		          )
		        )
		      )
		    );
		    if (isOpen) rows.push(...renderLevel(node.db, "", 1));
		  }
		  return React2.createElement("div", { role: "tree" }, rows);
		}
		function NewKeyDialog(props) {
		  const prefix = createPrefix(props.folderPath);
		  const [names, setNames] = React2.useState("");
		  const [type, setType] = React2.useState("string");
		  const [content, setContent] = React2.useState("");
		  const [ttl, setTtl] = React2.useState("");
		  const [problem, setProblem] = React2.useState(void 0);
		  const submit = async () => {
		    const keys = parseKeyNames(names, prefix);
		    if (keys.length === 0) {
		      setProblem(t("redisnew.nameRequired"));
		      return;
		    }
		    let ttlSeconds;
		    if (ttl.trim() !== "") {
		      const parsed = Number(ttl);
		      if (!Number.isFinite(parsed) || parsed < 0) {
		        setProblem(t("redisnew.ttl.hint"));
		        return;
		      }
		      if (parsed > 0) ttlSeconds = Math.trunc(parsed);
		    }
		    const payload = [];
		    for (const key of keys) {
		      const parsed = parseElements(type, content, key);
		      if (!parsed.ok) {
		        setProblem(parsed.error);
		        return;
		      }
		      payload.push({
		        key,
		        type,
		        ...parsed.content,
		        ...ttlSeconds === void 0 ? {} : { ttl: ttlSeconds }
		      });
		    }
		    setProblem(void 0);
		    await props.onSubmit(payload);
		  };
		  const title = prefix === "" ? t("redisnew.title") : t("redisnew.titleIn", { path: props.folderPath ?? "" });
		  return React2.createElement(
		    Modal,
		    {
		      title: `db${props.db} \xB7 ${title}`,
		      onClose: props.onClose,
		      footer: React2.createElement(
		        React2.Fragment,
		        null,
		        React2.createElement("button", { type: "button", className: "dbm-btn", onClick: props.onClose }, t("common.cancel")),
		        React2.createElement(
		          "button",
		          { type: "button", className: "dbm-btn dbm-btn-primary", disabled: props.busy, onClick: () => {
		            void submit();
		          } },
		          props.busy ? t("redisnew.busy") : t("redisnew.submit")
		        )
		      )
		    },
		    problem === void 0 ? null : React2.createElement("div", { className: "dbm-error" }, problem),
		    React2.createElement(
		      "label",
		      { className: "dbm-label" },
		      React2.createElement("span", null, t("redisnew.name")),
		      React2.createElement("textarea", {
		        className: "dbm-textarea dbm-mono",
		        rows: 2,
		        value: names,
		        placeholder: t("redisnew.name.placeholder"),
		        spellcheck: false,
		        autoFocus: true,
		        onChange: (event) => setNames(event.target.value)
		      }),
		      React2.createElement(
		        "span",
		        { className: "dbm-hint" },
		        prefix === "" ? t("redisnew.name.hintRoot") : t("redisnew.name.hintFolder", { prefix })
		      )
		    ),
		    React2.createElement(
		      "label",
		      { className: "dbm-label" },
		      React2.createElement("span", null, t("redisnew.type")),
		      React2.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: type,
		          onChange: (event) => setType(event.target.value)
		        },
		        REDIS_CREATABLE_TYPES.map(
		          (candidate) => React2.createElement("option", { key: candidate, value: candidate }, candidate)
		        )
		      )
		    ),
		    React2.createElement(
		      "label",
		      { className: "dbm-label" },
		      React2.createElement("span", null, t("redisnew.content")),
		      React2.createElement("textarea", {
		        className: "dbm-textarea dbm-mono",
		        rows: usesElementLines(type) ? 5 : 3,
		        value: content,
		        placeholder: contentPlaceholder(type),
		        spellcheck: false,
		        onChange: (event) => setContent(event.target.value)
		      })
		    ),
		    React2.createElement(
		      "div",
		      { className: "dbm-field-inline" },
		      React2.createElement("span", null, t("redisnew.ttl")),
		      React2.createElement("input", {
		        className: "dbm-input",
		        value: ttl,
		        placeholder: "0",
		        inputMode: "numeric",
		        onChange: (event) => setTtl(event.target.value)
		      }),
		      React2.createElement("span", { className: "dbm-hint" }, t("redisnew.ttl.unit")),
		      React2.createElement("span", { className: "dbm-hint" }, t("redisnew.ttl.hint"))
		    )
		  );
		}
		function DeleteDialog(props) {
		  const { target, count, busy } = props;
		  const isFolder = target.kind === "folder";
		  let body;
		  if (target.kind === "key") {
		    body = t("redisdelete.keyBody", { key: target.key });
		  } else if (count === void 0) {
		    body = `${t("redisdelete.folderBodyUnknown", { path: target.path })} ${t("redisdelete.counting")}`;
		  } else {
		    body = t("redisdelete.folderBody", { path: target.path, n: count });
		  }
		  return React2.createElement(
		    Modal,
		    {
		      title: `db${target.db} \xB7 ${isFolder ? t("redisdelete.folderTitle") : t("redisdelete.keyTitle")}`,
		      onClose: props.onClose,
		      footer: React2.createElement(
		        React2.Fragment,
		        null,
		        React2.createElement("button", { type: "button", className: "dbm-btn", onClick: props.onClose }, t("common.cancel")),
		        React2.createElement(
		          "button",
		          {
		            type: "button",
		            className: "dbm-btn dbm-btn-danger",
		            disabled: busy,
		            onClick: props.onConfirm
		          },
		          busy ? t("redisdelete.deleting") : t("redisdelete.confirm")
		        )
		      )
		    },
		    React2.createElement("div", null, body),
		    React2.createElement(
		      "div",
		      { className: "dbm-hint dbm-mono" },
		      target.kind === "key" ? target.key : target.path
		    )
		  );
		}

		// src/client/RedisValueEditor.ts
		var React4 = __toESM(require("react"), 1);

		// src/client/useTtlCountdown.ts
		var React3 = __toESM(require("react"), 1);
		function useTtlCountdown(reading) {
		  const [left, setLeft] = React3.useState(() => remainingSeconds(reading));
		  React3.useEffect(() => {
		    setLeft(remainingSeconds(reading));
		    if (!countsDown(reading)) return;
		    const timer = setInterval(() => {
		      const next = remainingSeconds(reading);
		      setLeft((current) => current === next ? current : next);
		    }, 1e3);
		    return () => clearInterval(timer);
		  }, [reading]);
		  return left;
		}

		// src/client/RedisValueEditor.ts
		function RedisValueEditor(props) {
		  const { value } = props;
		  const head = React4.createElement(
		    "div",
		    { className: "dbm-pad" },
		    React4.createElement("div", { className: "dbm-row" }, React4.createElement("strong", { className: "dbm-mono" }, value.key)),
		    React4.createElement(
		      "div",
		      { className: "dbm-row" },
		      React4.createElement("span", {
		        className: `dbm-badge dbm-badge-${value.type === "string" ? "ok" : "sqlite"}`
		      }, value.type),
		      React4.createElement(TtlEditor, {
		        key: "ttl",
		        api: props.api,
		        source: props.source,
		        db: props.db,
		        value: props.value,
		        onDone: props.onDone,
		        onError: props.onError,
		        onReload: props.onReload
		      }),
		      value.truncated === true ? React4.createElement("span", { className: "dbm-hint" }, t("redis.truncated", { n: 1e3 })) : null
		    )
		  );
		  const body = (() => {
		    switch (value.type) {
		      case "string":
		        return React4.createElement(StringEditor, { ...props, content: value.value ?? "" });
		      case "list":
		        return React4.createElement(ListEditor, { ...props, items: value.items ?? [] });
		      case "set":
		        return React4.createElement(SetEditor, { ...props, items: value.items ?? [] });
		      case "hash":
		        return React4.createElement(HashEditor, { ...props, fields: value.fields ?? [] });
		      case "zset":
		        return React4.createElement(ZsetEditor, { ...props, members: value.members ?? [] });
		      default:
		        return React4.createElement(
		          React4.Fragment,
		          null,
		          React4.createElement(StreamView, { value }),
		          React4.createElement("div", { className: "dbm-pad dbm-hint" }, t("redisedit.readonlyType", { type: value.type }))
		        );
		    }
		  })();
		  return React4.createElement("div", { className: "dbm-tab-body" }, head, body);
		}
		function TtlEditor(props) {
		  const { api, source, db, value } = props;
		  const [editing, setEditing] = React4.useState(false);
		  const [seconds, setSeconds] = React4.useState("");
		  const [busy, setBusy] = React4.useState(false);
		  const reading = React4.useMemo(() => readTtl(value.ttl), [value]);
		  const left = useTtlCountdown(reading);
		  const apply2 = async (ttl) => {
		    setBusy(true);
		    try {
		      const result = await api.redisSetTtl(source.id, { key: value.key, ttl, db });
		      props.onDone(t("redisedit.ttl.done", { ttl: formatTtl(result.ttl) }));
		      setEditing(false);
		      setSeconds("");
		      props.onReload();
		    } catch (failure) {
		      props.onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  if (!editing) {
		    const expiring = countsDown(reading);
		    const expired = expiring && left === 0;
		    return React4.createElement(
		      "span",
		      { className: "dbm-row", style: { gap: "6px" } },
		      // ONE number, and it is the live remainder.
		      //
		      // Showing the load-time reading next to the countdown ("TTL: 29m 57s
		      // 倒计时 29m 55s") put two different values for the same fact side by side,
		      // which only invites the question of which one is true. The countdown IS
		      // the TTL; a permanent key says so instead of counting.
		      React4.createElement(
		        "span",
		        { className: "dbm-hint" },
		        `${t("redis.ttl")}: `,
		        // One value, and it is the live remainder. An expired key shows the
		        // badge alone rather than also printing "0s": the badge already says it.
		        expired ? null : expiring ? React4.createElement("span", { className: "dbm-countdown" }, formatTtl(left)) : React4.createElement("span", null, formatTtl(reading.seconds))
		      ),
		      expired ? React4.createElement(
		        React4.Fragment,
		        null,
		        React4.createElement("span", { className: "dbm-badge dbm-badge-err" }, t("redisedit.ttl.expired")),
		        React4.createElement("span", { className: "dbm-hint" }, t("redisedit.ttl.expired.hint"))
		      ) : null,
		      React4.createElement(
		        "button",
		        {
		          type: "button",
		          className: "dbm-btn dbm-btn-sm",
		          onClick: () => {
		            setSeconds(countsDown(reading) && left > 0 ? String(left) : "");
		            setEditing(true);
		          }
		        },
		        t("redisedit.ttl.edit")
		      ),
		      expired ? React4.createElement(
		        "button",
		        {
		          type: "button",
		          className: "dbm-btn dbm-btn-sm",
		          onClick: props.onReload
		        },
		        t("redisedit.ttl.expired.reload")
		      ) : null
		    );
		  }
		  return React4.createElement(
		    "span",
		    { className: "dbm-row", style: { gap: "6px" } },
		    React4.createElement("input", {
		      className: "dbm-input",
		      style: { width: "110px" },
		      value: seconds,
		      placeholder: "0",
		      inputMode: "numeric",
		      autoFocus: true,
		      onChange: (event) => setSeconds(event.target.value),
		      onKeyDown: (event) => {
		        if (event.key === "Enter") void apply2(seconds.trim() === "" ? null : Number(seconds));
		        if (event.key === "Escape") setEditing(false);
		      }
		    }),
		    React4.createElement("span", { className: "dbm-hint" }, t("redisnew.ttl.unit")),
		    React4.createElement(
		      "button",
		      {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm dbm-btn-primary",
		        disabled: busy,
		        onClick: () => {
		          void apply2(seconds.trim() === "" ? null : Number(seconds));
		        }
		      },
		      t("redisedit.save")
		    ),
		    React4.createElement(
		      "button",
		      {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        disabled: busy,
		        // Explicit "permanent" rather than an empty box: the box being empty is
		        // also what a user who just cleared it by accident sees.
		        title: t("redisedit.ttl.persist.hint"),
		        onClick: () => {
		          void apply2(null);
		        }
		      },
		      t("redisedit.ttl.persist")
		    ),
		    React4.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", disabled: busy, onClick: () => setEditing(false) }, t("common.cancel"))
		  );
		}
		function StringEditor(props) {
		  const { api, source, db, value } = props;
		  const [draft, setDraft] = React4.useState(props.content);
		  const [busy, setBusy] = React4.useState(false);
		  React4.useEffect(() => {
		    setDraft(props.content);
		  }, [props.content, value.key]);
		  const dirty = draft !== props.content;
		  const save = async () => {
		    setBusy(true);
		    try {
		      await api.redisSetString(source.id, { key: value.key, value: draft, db });
		      props.onDone(t("redisedit.saved"));
		      props.onReload();
		    } catch (failure) {
		      props.onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  return React4.createElement(
		    "div",
		    { className: "dbm-scroll" },
		    React4.createElement(
		      "div",
		      { className: "dbm-pad" },
		      React4.createElement(
		        "div",
		        { className: "dbm-row" },
		        React4.createElement(
		          "span",
		          { className: "dbm-hint" },
		          `${t("redis.stringValue")} \xB7 ${formatBytes(draft.length)}`
		        ),
		        dirty ? React4.createElement("span", { className: "dbm-hint dbm-dirty" }, t("redisedit.unsaved")) : null
		      ),
		      React4.createElement("textarea", {
		        className: "dbm-textarea dbm-mono",
		        rows: 10,
		        value: draft,
		        spellcheck: false,
		        onChange: (event) => setDraft(event.target.value),
		        onKeyDown: (event) => {
		          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
		            event.preventDefault();
		            void save();
		          }
		        }
		      }),
		      React4.createElement(
		        "div",
		        { className: "dbm-row" },
		        React4.createElement(
		          "button",
		          {
		            type: "button",
		            className: "dbm-btn dbm-btn-primary",
		            disabled: busy || !dirty,
		            onClick: () => {
		              void save();
		            }
		          },
		          busy ? t("common.loading") : t("redisedit.save")
		        ),
		        React4.createElement("button", {
		          type: "button",
		          className: "dbm-btn",
		          disabled: busy || !dirty,
		          onClick: () => setDraft(props.content)
		        }, t("redisedit.revert")),
		        React4.createElement("span", { className: "dbm-hint" }, t("redisedit.ctrlEnter"))
		      )
		    )
		  );
		}
		function ListEditor(props) {
		  const { api, source, db, value, items } = props;
		  const [drafts, setDrafts] = React4.useState({});
		  const [busy, setBusy] = React4.useState(false);
		  const [append, setAppend] = React4.useState("");
		  React4.useEffect(() => {
		    setDrafts({});
		  }, [value.key, items.length]);
		  const run = async (work, done) => {
		    setBusy(true);
		    try {
		      const result = await work();
		      props.onDone(done);
		      if (result.removed) props.onRemoved();
		      else props.onReload();
		    } catch (failure) {
		      props.onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  const saveRow = (index) => {
		    const next = drafts[index];
		    if (next === void 0 || next === items[index]) return;
		    void run(
		      () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: "set", index, value: next } }),
		      t("redisedit.saved")
		    );
		  };
		  return React4.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React4.createElement(
		      "div",
		      { className: "dbm-data" },
		      items.length === 0 ? React4.createElement(Empty, { message: t("redis.noKeys") }) : React4.createElement(
		        "table",
		        null,
		        React4.createElement(
		          "thead",
		          null,
		          React4.createElement(
		            "tr",
		            null,
		            React4.createElement("th", { style: { width: "60px" } }, t("redisedit.index")),
		            React4.createElement("th", null, t("redis.value")),
		            React4.createElement("th", { style: { width: "120px" } }, t("col.actions"))
		          )
		        ),
		        React4.createElement(
		          "tbody",
		          null,
		          items.map((item, index) => {
		            const draft = drafts[index] ?? item;
		            const dirty = draft !== item;
		            return React4.createElement(
		              "tr",
		              { key: `${value.key}-${index}` },
		              React4.createElement("td", { className: "dbm-hint" }, String(index)),
		              React4.createElement(
		                "td",
		                null,
		                React4.createElement("input", {
		                  className: "dbm-input dbm-mono",
		                  style: { width: "100%" },
		                  value: draft,
		                  spellcheck: false,
		                  onChange: (event) => setDrafts((current) => ({ ...current, [index]: event.target.value })),
		                  onKeyDown: (event) => {
		                    if (event.key === "Enter") saveRow(index);
		                  }
		                })
		              ),
		              React4.createElement(
		                "td",
		                { className: "dbm-actions" },
		                React4.createElement(
		                  "button",
		                  {
		                    type: "button",
		                    className: "dbm-btn dbm-btn-sm dbm-btn-primary",
		                    disabled: busy || !dirty,
		                    onClick: () => saveRow(index)
		                  },
		                  t("redisedit.save")
		                ),
		                React4.createElement(
		                  "button",
		                  {
		                    type: "button",
		                    className: "dbm-btn dbm-btn-sm dbm-btn-danger",
		                    disabled: busy,
		                    onClick: () => {
		                      void run(
		                        () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: "delete", index } }),
		                        t("redisedit.rowDeleted")
		                      );
		                    }
		                  },
		                  t("common.delete")
		                )
		              )
		            );
		          })
		        )
		      )
		    ),
		    React4.createElement(
		      "div",
		      { className: "dbm-pad dbm-row" },
		      React4.createElement("input", {
		        className: "dbm-input dbm-mono",
		        style: { flex: 1, minWidth: "200px" },
		        value: append,
		        placeholder: t("redisedit.appendPlaceholder"),
		        onChange: (event) => setAppend(event.target.value),
		        onKeyDown: (event) => {
		          if (event.key === "Enter" && append !== "") {
		            const pushed = append;
		            setAppend("");
		            void run(
		              () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: "push", value: pushed } }),
		              t("redisedit.appended")
		            );
		          }
		        }
		      }),
		      React4.createElement(
		        "button",
		        {
		          type: "button",
		          className: "dbm-btn dbm-btn-primary",
		          disabled: busy || append === "",
		          onClick: () => {
		            const pushed = append;
		            setAppend("");
		            void run(
		              () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: "push", value: pushed } }),
		              t("redisedit.appended")
		            );
		          }
		        },
		        t("redisedit.append")
		      )
		    )
		  );
		}
		function SetEditor(props) {
		  const { api, source, db, value, items } = props;
		  const [busy, setBusy] = React4.useState(false);
		  const [drafts, setDrafts] = React4.useState({});
		  const [add, setAdd] = React4.useState("");
		  React4.useEffect(() => {
		    setDrafts({});
		    setAdd("");
		  }, [value.key, items.length]);
		  const run = async (work, done) => {
		    setBusy(true);
		    try {
		      const result = await work();
		      props.onDone(done);
		      if (result.removed) props.onRemoved();
		      else props.onReload();
		    } catch (failure) {
		      props.onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  const sorted = [...items].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
		  return React4.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React4.createElement(
		      "div",
		      { className: "dbm-data" },
		      items.length === 0 ? React4.createElement(Empty, { message: t("redis.noKeys") }) : React4.createElement(
		        "table",
		        null,
		        React4.createElement(
		          "thead",
		          null,
		          React4.createElement(
		            "tr",
		            null,
		            React4.createElement("th", null, t("redis.member")),
		            React4.createElement("th", { style: { width: "180px" } }, t("col.actions"))
		          )
		        ),
		        React4.createElement(
		          "tbody",
		          null,
		          sorted.map((member) => {
		            const draft = drafts[member] ?? member;
		            const dirty = draft !== member;
		            return React4.createElement(
		              "tr",
		              { key: member },
		              React4.createElement(
		                "td",
		                null,
		                React4.createElement("input", {
		                  className: "dbm-input dbm-mono",
		                  style: { width: "100%" },
		                  value: draft,
		                  spellcheck: false,
		                  onChange: (event) => setDrafts((current) => ({ ...current, [member]: event.target.value }))
		                })
		              ),
		              React4.createElement(
		                "td",
		                { className: "dbm-actions" },
		                React4.createElement(
		                  "button",
		                  {
		                    type: "button",
		                    className: "dbm-btn dbm-btn-sm dbm-btn-primary",
		                    disabled: busy || !dirty || draft === "",
		                    // A set member IS its value: renaming is remove + add.
		                    onClick: () => {
		                      void run(
		                        () => api.redisEditElement(source.id, {
		                          key: value.key,
		                          db,
		                          edit: { op: "delete", member, value: draft }
		                        }),
		                        t("redisedit.saved")
		                      );
		                    }
		                  },
		                  t("redisedit.save")
		                ),
		                React4.createElement(
		                  "button",
		                  {
		                    type: "button",
		                    className: "dbm-btn dbm-btn-sm dbm-btn-danger",
		                    disabled: busy,
		                    onClick: () => {
		                      void run(
		                        () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: "delete", member } }),
		                        t("redisedit.rowDeleted")
		                      );
		                    }
		                  },
		                  t("common.delete")
		                )
		              )
		            );
		          })
		        )
		      )
		    ),
		    React4.createElement(
		      "div",
		      { className: "dbm-pad dbm-row" },
		      React4.createElement("input", {
		        className: "dbm-input dbm-mono",
		        style: { flex: 1, minWidth: "200px" },
		        value: add,
		        placeholder: t("redisedit.addMember"),
		        onChange: (event) => setAdd(event.target.value),
		        onKeyDown: (event) => {
		          if (event.key === "Enter" && add !== "") {
		            const added = add;
		            setAdd("");
		            void run(
		              () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: "add", value: added } }),
		              t("redisedit.added")
		            );
		          }
		        }
		      }),
		      React4.createElement(
		        "button",
		        {
		          type: "button",
		          className: "dbm-btn dbm-btn-primary",
		          disabled: busy || add === "",
		          onClick: () => {
		            const added = add;
		            setAdd("");
		            void run(
		              () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: "add", value: added } }),
		              t("redisedit.added")
		            );
		          }
		        },
		        t("redisedit.add")
		      )
		    )
		  );
		}
		function HashEditor(props) {
		  const { api, source, db, value, fields } = props;
		  const [busy, setBusy] = React4.useState(false);
		  const [drafts, setDrafts] = React4.useState({});
		  const [add, setAdd] = React4.useState({ field: "", value: "" });
		  React4.useEffect(() => {
		    setDrafts({});
		    setAdd({ field: "", value: "" });
		  }, [value.key, fields.length]);
		  const run = async (work, done) => {
		    setBusy(true);
		    try {
		      const result = await work();
		      props.onDone(done);
		      if (result.removed) props.onRemoved();
		      else props.onReload();
		    } catch (failure) {
		      props.onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  return React4.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React4.createElement(
		      "div",
		      { className: "dbm-data" },
		      fields.length === 0 ? React4.createElement(Empty, { message: t("redis.noKeys") }) : React4.createElement(
		        "table",
		        null,
		        React4.createElement(
		          "thead",
		          null,
		          React4.createElement(
		            "tr",
		            null,
		            React4.createElement("th", null, t("redis.field")),
		            React4.createElement("th", null, t("redis.value")),
		            React4.createElement("th", { style: { width: "190px" } }, t("col.actions"))
		          )
		        ),
		        React4.createElement(
		          "tbody",
		          null,
		          fields.map((entry) => {
		            const draft = drafts[entry.field] ?? { field: entry.field, value: entry.value };
		            const dirty = draft.field !== entry.field || draft.value !== entry.value;
		            const setDraft = (patch) => setDrafts((current) => ({ ...current, [entry.field]: { ...draft, ...patch } }));
		            return React4.createElement(
		              "tr",
		              { key: entry.field },
		              React4.createElement(
		                "td",
		                null,
		                React4.createElement("input", {
		                  className: "dbm-input dbm-mono",
		                  style: { width: "100%" },
		                  value: draft.field,
		                  spellcheck: false,
		                  onChange: (event) => setDraft({ field: event.target.value })
		                })
		              ),
		              React4.createElement(
		                "td",
		                null,
		                React4.createElement("input", {
		                  className: "dbm-input dbm-mono",
		                  style: { width: "100%" },
		                  value: draft.value,
		                  spellcheck: false,
		                  onChange: (event) => setDraft({ value: event.target.value })
		                })
		              ),
		              React4.createElement(
		                "td",
		                { className: "dbm-actions" },
		                React4.createElement(
		                  "button",
		                  {
		                    type: "button",
		                    className: "dbm-btn dbm-btn-sm dbm-btn-primary",
		                    disabled: busy || !dirty || draft.field === "",
		                    onClick: () => {
		                      void run(async () => {
		                        if (draft.field !== entry.field) {
		                          await api.redisEditElement(source.id, {
		                            key: value.key,
		                            db,
		                            edit: { op: "delete", member: entry.field }
		                          });
		                        }
		                        return api.redisEditElement(source.id, {
		                          key: value.key,
		                          db,
		                          edit: { op: "set", member: draft.field, value: draft.value }
		                        });
		                      }, t("redisedit.saved"));
		                    }
		                  },
		                  t("redisedit.save")
		                ),
		                React4.createElement(
		                  "button",
		                  {
		                    type: "button",
		                    className: "dbm-btn dbm-btn-sm dbm-btn-danger",
		                    disabled: busy,
		                    onClick: () => {
		                      void run(
		                        () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: "delete", member: entry.field } }),
		                        t("redisedit.rowDeleted")
		                      );
		                    }
		                  },
		                  t("common.delete")
		                )
		              )
		            );
		          })
		        )
		      )
		    ),
		    React4.createElement(
		      "div",
		      { className: "dbm-pad dbm-row" },
		      React4.createElement("input", {
		        className: "dbm-input dbm-mono",
		        style: { width: "200px" },
		        value: add.field,
		        placeholder: t("redis.field"),
		        spellcheck: false,
		        onChange: (event) => setAdd((current) => ({ ...current, field: event.target.value }))
		      }),
		      React4.createElement("input", {
		        className: "dbm-input dbm-mono",
		        style: { flex: 1, minWidth: "200px" },
		        value: add.value,
		        placeholder: t("redis.value"),
		        spellcheck: false,
		        onChange: (event) => setAdd((current) => ({ ...current, value: event.target.value }))
		      }),
		      React4.createElement(
		        "button",
		        {
		          type: "button",
		          className: "dbm-btn dbm-btn-primary",
		          disabled: busy || add.field === "",
		          onClick: () => {
		            const entry = add;
		            setAdd({ field: "", value: "" });
		            void run(
		              () => api.redisEditElement(source.id, {
		                key: value.key,
		                db,
		                edit: { op: "set", member: entry.field, value: entry.value }
		              }),
		              t("redisedit.added")
		            );
		          }
		        },
		        t("redisedit.addField")
		      )
		    )
		  );
		}
		function ZsetEditor(props) {
		  const { api, source, db, value, members } = props;
		  const [busy, setBusy] = React4.useState(false);
		  const [drafts, setDrafts] = React4.useState({});
		  const [add, setAdd] = React4.useState({ member: "", score: "" });
		  const [problem, setProblem] = React4.useState(void 0);
		  React4.useEffect(() => {
		    setDrafts({});
		    setAdd({ member: "", score: "" });
		    setProblem(void 0);
		  }, [value.key, members.length]);
		  const run = async (work, done) => {
		    setBusy(true);
		    try {
		      const result = await work();
		      props.onDone(done);
		      if (result.removed) props.onRemoved();
		      else props.onReload();
		    } catch (failure) {
		      props.onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  return React4.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    problem === void 0 ? null : React4.createElement("div", { className: "dbm-pad dbm-error" }, problem),
		    React4.createElement(
		      "div",
		      { className: "dbm-data" },
		      members.length === 0 ? React4.createElement(Empty, { message: t("redis.noKeys") }) : React4.createElement(
		        "table",
		        null,
		        React4.createElement(
		          "thead",
		          null,
		          React4.createElement(
		            "tr",
		            null,
		            React4.createElement("th", { style: { width: "140px" } }, t("redis.score")),
		            React4.createElement("th", null, t("redis.member")),
		            React4.createElement("th", { style: { width: "190px" } }, t("col.actions"))
		          )
		        ),
		        React4.createElement(
		          "tbody",
		          null,
		          members.map((entry) => {
		            const draft = drafts[entry.member] ?? { member: entry.member, score: entry.score };
		            const dirty = draft.member !== entry.member || draft.score !== entry.score;
		            const setDraft = (patch) => setDrafts((current) => ({ ...current, [entry.member]: { ...draft, ...patch } }));
		            return React4.createElement(
		              "tr",
		              { key: entry.member },
		              React4.createElement(
		                "td",
		                null,
		                React4.createElement("input", {
		                  className: "dbm-input dbm-mono",
		                  style: { width: "100%" },
		                  value: draft.score,
		                  inputMode: "decimal",
		                  onChange: (event) => setDraft({ score: event.target.value })
		                })
		              ),
		              React4.createElement(
		                "td",
		                null,
		                React4.createElement("input", {
		                  className: "dbm-input dbm-mono",
		                  style: { width: "100%" },
		                  value: draft.member,
		                  spellcheck: false,
		                  onChange: (event) => setDraft({ member: event.target.value })
		                })
		              ),
		              React4.createElement(
		                "td",
		                { className: "dbm-actions" },
		                React4.createElement(
		                  "button",
		                  {
		                    type: "button",
		                    className: "dbm-btn dbm-btn-sm dbm-btn-primary",
		                    disabled: busy || !dirty,
		                    onClick: () => {
		                      if (!Number.isFinite(Number(draft.score))) {
		                        setProblem(t("redisedit.scoreNotNumber", { score: draft.score }));
		                        return;
		                      }
		                      setProblem(void 0);
		                      void run(async () => {
		                        if (draft.member !== entry.member) {
		                          await api.redisEditElement(source.id, {
		                            key: value.key,
		                            db,
		                            edit: { op: "delete", member: entry.member }
		                          });
		                        }
		                        return api.redisEditElement(source.id, {
		                          key: value.key,
		                          db,
		                          edit: { op: "add", member: draft.member, value: draft.score }
		                        });
		                      }, t("redisedit.saved"));
		                    }
		                  },
		                  t("redisedit.save")
		                ),
		                React4.createElement(
		                  "button",
		                  {
		                    type: "button",
		                    className: "dbm-btn dbm-btn-sm dbm-btn-danger",
		                    disabled: busy,
		                    onClick: () => {
		                      void run(
		                        () => api.redisEditElement(source.id, { key: value.key, db, edit: { op: "delete", member: entry.member } }),
		                        t("redisedit.rowDeleted")
		                      );
		                    }
		                  },
		                  t("common.delete")
		                )
		              )
		            );
		          })
		        )
		      )
		    ),
		    React4.createElement(
		      "div",
		      { className: "dbm-pad dbm-row" },
		      React4.createElement("input", {
		        className: "dbm-input dbm-mono",
		        style: { width: "140px" },
		        value: add.score,
		        placeholder: t("redis.score"),
		        inputMode: "decimal",
		        onChange: (event) => setAdd((current) => ({ ...current, score: event.target.value }))
		      }),
		      React4.createElement("input", {
		        className: "dbm-input dbm-mono",
		        style: { flex: 1, minWidth: "200px" },
		        value: add.member,
		        placeholder: t("redis.member"),
		        spellcheck: false,
		        onChange: (event) => setAdd((current) => ({ ...current, member: event.target.value }))
		      }),
		      React4.createElement(
		        "button",
		        {
		          type: "button",
		          className: "dbm-btn dbm-btn-primary",
		          disabled: busy || add.member === "",
		          onClick: () => {
		            if (!Number.isFinite(Number(add.score))) {
		              setProblem(t("redisedit.scoreNotNumber", { score: add.score }));
		              return;
		            }
		            setProblem(void 0);
		            const entry = add;
		            setAdd({ member: "", score: "" });
		            void run(
		              () => api.redisEditElement(source.id, {
		                key: value.key,
		                db,
		                edit: { op: "add", member: entry.member, value: entry.score || "0" }
		              }),
		              t("redisedit.added")
		            );
		          }
		        },
		        t("redisedit.addMember")
		      )
		    )
		  );
		}
		function StreamView(props) {
		  const entries = props.value.entries ?? [];
		  return React4.createElement(
		    "div",
		    { className: "dbm-data" },
		    entries.length === 0 ? React4.createElement(Empty, { message: t("redis.noKeys") }) : React4.createElement(
		      "table",
		      null,
		      React4.createElement(
		        "thead",
		        null,
		        React4.createElement(
		          "tr",
		          null,
		          React4.createElement("th", null, t("redis.entry")),
		          React4.createElement("th", null, t("redis.field")),
		          React4.createElement("th", null, t("redis.value"))
		        )
		      ),
		      React4.createElement(
		        "tbody",
		        null,
		        entries.flatMap(
		          (entry) => entry.fields.map(
		            (field, index) => React4.createElement(
		              "tr",
		              { key: `${entry.id}-${index}` },
		              React4.createElement("td", { className: "dbm-mono" }, index === 0 ? entry.id : ""),
		              React4.createElement("td", { className: "dbm-mono" }, field.field),
		              React4.createElement("td", { className: "dbm-mono", title: field.value }, field.value)
		            )
		          )
		        )
		      )
		    )
		  );
		}

		// src/client/RedisDatabaseView.ts
		var DB_COUNT = 16;
		var LARGE_DB_KEYS = 1e6;
		function RedisDatabaseView(props) {
		  const { api, source, initialInfo, onBack, onClose } = props;
		  const [info, setInfo] = React5.useState(initialInfo);
		  const [pattern, setPattern] = React5.useState("");
		  const [searchDb, setSearchDb] = React5.useState(source.db ?? 0);
		  const [search, setSearch] = React5.useState(void 0);
		  const [levels, setLevels] = React5.useState({});
		  const [openDbs, setOpenDbs] = React5.useState({});
		  const [openFolders, setOpenFolders] = React5.useState({});
		  const [selection, setSelection] = React5.useState(void 0);
		  const [consoleDb, setConsoleDb] = React5.useState(source.db ?? 0);
		  const [activeKey, setActiveKey] = React5.useState(void 0);
		  const [value, setValue] = React5.useState(void 0);
		  const [valueLoading, setValueLoading] = React5.useState(false);
		  const [tab, setTab] = React5.useState("value");
		  const [error, setError] = React5.useState(void 0);
		  const [notice, setNotice] = React5.useState(void 0);
		  const [createFor, setCreateFor] = React5.useState(void 0);
		  const [deleteFor, setDeleteFor] = React5.useState(void 0);
		  const [busy, setBusy] = React5.useState(false);
		  const [refreshing, setRefreshing] = React5.useState(false);
		  const indexDbsRef = React5.useRef(/* @__PURE__ */ new Set());
		  const addIndexDb = React5.useCallback((db) => {
		    indexDbsRef.current = new Set(indexDbsRef.current).add(db);
		  }, []);
		  const dropIndexDb = React5.useCallback((db) => {
		    const next = new Set(indexDbsRef.current);
		    next.delete(db);
		    indexDbsRef.current = next;
		  }, []);
		  const [indexProgress, setIndexProgress] = React5.useState({});
		  const [indexPrompt, setIndexPrompt] = React5.useState(void 0);
		  const loadLevel = React5.useCallback(async (db, prefix) => {
		    const key = levelKey(db, prefix);
		    setLevels((current) => ({
		      ...current,
		      [key]: current[key] === void 0 ? { folders: [], keys: [], truncated: false, keysAtLevel: 0, loading: true } : { ...current[key], loading: true, error: void 0 }
		    }));
		    const apply2 = (level) => {
		      const partial = level.countsApproximate ?? level.partial === true;
		      setLevels((current) => ({
		        ...current,
		        [key]: {
		          folders: level.folders,
		          keys: level.keys,
		          truncated: level.truncated ?? false,
		          keysAtLevel: level.keysAtLevel,
		          // An index still being built is the same situation the scan reports with
		          // `countsApproximate`: the level may gain rows, and saying so is what stops
		          // a partial tree from looking complete.
		          countsApproximate: partial,
		          /*
		           * The notice's two numbers, from whichever path answered.
		           *
		           * The scan reports `scannedKeys`/`dbSize`; an unfinished index reports
		           * `visited`/`dbSize`. Both mean "this much of the database was covered",
		           * and the notice reads one pair. Leaving the index's pair unset made the
		           * renderer fall back to zeroes, so a mid-walk level announced
		           * "该库共 0 个键，此处仅扫描了 0 个" — a wrong database size, stated
		           * confidently, on the very screen whose purpose is to say the numbers
		           * may be short.
		           */
		          scannedKeys: level.scannedKeys ?? level.visited,
		          dbSize: level.dbSize
		        }
		      }));
		    };
		    try {
		      if (indexDbsRef.current.has(db)) {
		        try {
		          const level = await api.redisIndexLevel(source.id, { db, prefix, withTypes: prefix !== "" });
		          apply2(level);
		          setError(void 0);
		          return;
		        } catch (failure) {
		          if (!(failure instanceof DbApiError) || failure.status !== 409) throw failure;
		        }
		      }
		      const page = await api.redisLevel(source.id, { db, prefix, withTypes: prefix !== "" });
		      apply2(page);
		      setError(void 0);
		    } catch (failure) {
		      setLevels((current) => ({
		        ...current,
		        [key]: {
		          folders: [],
		          keys: [],
		          truncated: false,
		          keysAtLevel: 0,
		          error: failure instanceof Error ? failure.message : String(failure)
		        }
		      }));
		    }
		  }, [api, source.id]);
		  const refreshAll = React5.useCallback(async (extra) => {
		    setRefreshing(true);
		    try {
		      try {
		        setInfo(await api.redisInfo(source.id));
		      } catch (failure) {
		        setError(failure instanceof Error ? failure.message : String(failure));
		      }
		      const targets = /* @__PURE__ */ new Map();
		      for (const key of Object.keys(levels)) {
		        const at = key.indexOf("\0");
		        targets.set(key, { db: Number(key.slice(0, at)), prefix: key.slice(at + 1) });
		      }
		      for (const item of extra ?? []) targets.set(levelKey(item.db, item.prefix), item);
		      await Promise.all([...targets.values()].map((item) => loadLevel(item.db, item.prefix)));
		    } finally {
		      setRefreshing(false);
		    }
		  }, [api, source.id, levels, loadLevel]);
		  const initialDb = source.db ?? 0;
		  const buildIndex = React5.useCallback(async (db) => {
		    addIndexDb(db);
		    setIndexPrompt(void 0);
		    try {
		      const first = await api.redisIndexStart(source.id, { db });
		      setIndexProgress((current) => ({ ...current, [db]: first }));
		      let status = first;
		      const deadline = Date.now() + 10 * 60 * 1e3;
		      while (!status.done && status.error === void 0 && Date.now() < deadline) {
		        await new Promise((resolve) => setTimeout(resolve, 400));
		        status = await api.redisIndexStart(source.id, { db });
		        setIndexProgress((current) => ({ ...current, [db]: status }));
		      }
		      setIndexProgress((current) => ({ ...current, [db]: void 0 }));
		      if (status.error !== void 0) {
		        setError(status.error);
		        return;
		      }
		      await loadLevel(db, "");
		      await refreshAll();
		    } catch (failure) {
		      dropIndexDb(db);
		      setIndexProgress((current) => ({ ...current, [db]: void 0 }));
		      setError(failure instanceof Error ? failure.message : String(failure));
		    }
		  }, [api, source.id, refreshAll, loadLevel, addIndexDb, dropIndexDb]);
		  const toggleDb = (db) => {
		    const next = openDbs[db] !== true;
		    setOpenDbs((current) => ({ ...current, [db]: next }));
		    if (next) setSelection({ kind: "db", db });
		    if (!next) return;
		    if (indexDbsRef.current.has(db)) {
		      if (levels[levelKey(db, "")] === void 0) void loadLevel(db, "");
		      return;
		    }
		    const size = databases.find((node) => node.db === db)?.keys ?? 0;
		    if (size < LARGE_DB_KEYS) {
		      if (levels[levelKey(db, "")] === void 0) void loadLevel(db, "");
		      return;
		    }
		    void api.redisIndexEstimate(source.id, { db }).then((estimate) => setIndexPrompt({ db, estimate })).catch(() => {
		      if (levels[levelKey(db, "")] === void 0) void loadLevel(db, "");
		    });
		  };
		  const toggleFolder = (db, path) => {
		    const next = openFolders[db]?.[path] !== true;
		    setOpenFolders((current) => {
		      const forDb = current[db] ?? {};
		      return { ...current, [db]: { ...forDb, [path]: next } };
		    });
		    if (next && levels[levelKey(db, path)] === void 0) void loadLevel(db, path);
		  };
		  const loadValue = React5.useCallback(async (db, key) => {
		    setValueLoading(true);
		    setError(void 0);
		    try {
		      setValue(await api.redisValue(source.id, { key, db }));
		    } catch (failure) {
		      setValue(void 0);
		      setError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setValueLoading(false);
		    }
		  }, [api, source.id]);
		  const selectKey = (db, key) => {
		    setSelection({ kind: "key", db, key });
		    setActiveKey({ db, key });
		    setTab("value");
		    void loadValue(db, key);
		  };
		  const databases = React5.useMemo(() => {
		    const byDb = new Map(info.databases.map((entry) => [entry.db, entry.keys]));
		    const configured = source.db ?? 0;
		    const highest = Math.max(DB_COUNT - 1, configured, ...info.databases.map((entry) => entry.db));
		    return Array.from({ length: highest + 1 }, (_, db) => ({ db, keys: byDb.get(db) ?? 0 }));
		  }, [info.databases, source.db]);
		  const submitCreate = async (keys) => {
		    if (createFor === void 0) return;
		    setBusy(true);
		    try {
		      await api.redisCreateKeys(source.id, { db: createFor.db, keys });
		      setError(void 0);
		      setCreateFor(void 0);
		      setNotice(t("redisnew.done", { n: keys.length }));
		      setOpenDbs((current) => ({ ...current, [createFor.db]: true }));
		      if (createFor.folderPath !== void 0) {
		        setOpenFolders((current) => {
		          const forDb = current[createFor.db] ?? {};
		          return { ...current, [createFor.db]: { ...forDb, [createFor.folderPath]: true } };
		        });
		      }
		      await refreshAll([{ db: createFor.db, prefix: createFor.folderPath ?? "" }]);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  const askDeleteKey = (db, key) => {
		    setDeleteFor({ target: { kind: "key", db, key }, count: void 0 });
		  };
		  const askDeleteFolder = (db, path) => {
		    setDeleteFor({ target: { kind: "folder", db, path }, count: void 0 });
		    void api.redisPrefixCount(source.id, { prefix: path, db }).then((count) => setDeleteFor(
		      (current) => current !== void 0 && current.target.kind === "folder" && current.target.path === path ? { ...current, count } : current
		    )).catch(() => {
		    });
		  };
		  const confirmDelete = async () => {
		    if (deleteFor === void 0) return;
		    setBusy(true);
		    try {
		      let affected = [];
		      if (deleteFor.target.kind === "key") {
		        const { db, key } = deleteFor.target;
		        const removed = await api.redisDeleteKey(source.id, { key, db });
		        setNotice(removed ? t("redisdelete.done", { n: 1 }) : t("redis.noKeys"));
		        if (activeKey?.db === db && activeKey.key === key) {
		          setActiveKey(void 0);
		          setValue(void 0);
		        }
		        affected = [{ db, prefix: key.includes(":") ? key.slice(0, key.lastIndexOf(":")) : "" }];
		      } else {
		        const { db, path } = deleteFor.target;
		        const result = await api.redisDeletePrefix(source.id, { prefix: path, db });
		        setNotice(result.truncated ? `${t("redisdelete.done", { n: result.deleted })} \xB7 ${t("redisdelete.truncated")}` : t("redisdelete.done", { n: result.deleted }));
		        if (activeKey?.db === db && (activeKey.key === path || activeKey.key.startsWith(`${path}:`))) {
		          setActiveKey(void 0);
		          setValue(void 0);
		        }
		        const parent = path.includes(":") ? path.slice(0, path.lastIndexOf(":")) : "";
		        affected = [{ db, prefix: parent }, { db, prefix: path }];
		      }
		      setError(void 0);
		      setDeleteFor(void 0);
		      if (search !== void 0) await runSearch(searchDb, search.pattern);
		      else await refreshAll(affected);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  const runSearch = React5.useCallback(async (db, pattern2) => {
		    const trimmed = pattern2.trim();
		    if (trimmed === "") return;
		    setSearch({ pattern: trimmed, loading: true });
		    setSearchDb(db);
		    try {
		      const page = await api.redisSearch(source.id, { db, pattern: trimmed });
		      setSearch({
		        pattern: trimmed,
		        loading: false,
		        keys: page.keys,
		        truncated: page.truncated,
		        scanned: page.scanned
		      });
		      setError(void 0);
		    } catch (failure) {
		      setSearch({
		        pattern: trimmed,
		        loading: false,
		        error: failure instanceof Error ? failure.message : String(failure)
		      });
		    }
		  }, [api, source.id]);
		  const clearSearch = () => {
		    setSearch(void 0);
		    setPattern("");
		  };
		  const searching = search !== void 0;
		  const left = React5.createElement(
		    "div",
		    { className: "dbm-side" },
		    React5.createElement(
		      "div",
		      { className: "dbm-side-head" },
		      React5.createElement("input", {
		        className: "dbm-input",
		        style: { flex: 1 },
		        value: pattern,
		        placeholder: t("redisdb.filter"),
		        title: t("redisdb.search.hint"),
		        spellcheck: false,
		        onChange: (event) => {
		          const next = event.target.value;
		          setPattern(next);
		          if (next.trim() === "") setSearch(void 0);
		        },
		        // Enter runs the search. Typing alone does not: a search scans the whole
		        // database on the server, so one request per keystroke would be abusive.
		        onKeyDown: (event) => {
		          if (event.key === "Enter") void runSearch(searchDb, pattern);
		          if (event.key === "Escape") {
		            setPattern("");
		            setSearch(void 0);
		          }
		        }
		      }),
		      // Which database to search. A compact select rather than a separate
		      // control per db row: the scope must be visible BEFORE running the search,
		      // and the tree's db rows are replaced by results while searching.
		      React5.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: String(searchDb),
		          title: t("redisdb.search.scope.db", { n: searchDb }),
		          "aria-label": t("redisdb.search.scope.db", { n: searchDb }),
		          onChange: (event) => setSearchDb(Number(event.target.value))
		        },
		        databases.map(
		          (node) => React5.createElement("option", { key: node.db, value: String(node.db) }, `db${node.db}`)
		        )
		      ),
		      React5.createElement("button", {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        title: t("redisdb.search.run"),
		        "aria-label": t("redisdb.search.run"),
		        disabled: pattern.trim() === "" || search?.loading === true,
		        onClick: () => {
		          void runSearch(searchDb, pattern);
		        }
		      }, "\u{1F50D}"),
		      searching ? React5.createElement("button", {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        title: t("redisdb.search.clear"),
		        "aria-label": t("redisdb.search.clear"),
		        onClick: clearSearch
		      }, "\u2715") : React5.createElement("button", {
		        type: "button",
		        className: `dbm-btn dbm-btn-sm${refreshing ? " dbm-btn-busy" : ""}`,
		        title: t("redisdb.refresh"),
		        "aria-label": t("redisdb.refresh"),
		        // A second press while a refresh is running would stack another round
		        // of scans on the same levels.
		        disabled: refreshing,
		        "aria-busy": refreshing ? "true" : void 0,
		        onClick: () => {
		          void refreshAll();
		        }
		      }, refreshing ? React5.createElement("span", { className: "dbm-spinner" }) : "\u27F3")
		    ),
		    React5.createElement(
		      "div",
		      { className: "dbm-side-body" },
		      React5.createElement(RedisKeyTree, {
		        databases,
		        levels,
		        openDbs,
		        openFolders,
		        search,
		        searchDb,
		        selection,
		        activeKey,
		        onToggleDb: toggleDb,
		        onToggleFolder: toggleFolder,
		        onSelectKey: selectKey,
		        onSelectFolder: (db, path, name) => setSelection({ kind: "folder", db, path, name }),
		        // Opening a dialog clears the previous outcome. Without this, the
		        // notice from an EARLIER create ("已创建 1 个键") stayed on screen while
		        // this one failed — success and failure shown at once, which reads as
		        // "the create silently did nothing".
		        onCreate: (db, folderPath) => {
		          setNotice(void 0);
		          setError(void 0);
		          setCreateFor({ db, folderPath });
		        },
		        onDeleteKey: askDeleteKey,
		        onDeleteFolder: askDeleteFolder
		      })
		    )
		  );
		  const body = [
		    React5.createElement(TabStrip, {
		      key: "tabs",
		      active: tab,
		      tabs: [
		        { id: "value", label: t("redis.value") },
		        { id: "info", label: t("redis.info") },
		        { id: "console", label: t("redis.console") }
		      ],
		      onChange: (next) => setTab(next)
		    })
		  ];
		  if (tab === "value") {
		    const activeDb = activeKey?.db ?? initialDb;
		    body.push(
		      value === void 0 ? React5.createElement(Empty, { key: "empty", message: valueLoading ? t("common.loading") : t("redis.selectKey") }) : React5.createElement(RedisValueEditor, {
		        key: `value-${activeDb}-${value.key}`,
		        api,
		        source,
		        db: activeDb,
		        value,
		        onReload: () => {
		          void loadValue(activeDb, value.key);
		        },
		        onDone: (message) => {
		          setNotice(message);
		          setError(void 0);
		        },
		        onError: (message) => {
		          setError(message);
		          setNotice(void 0);
		        },
		        onRemoved: () => {
		          setActiveKey(void 0);
		          setValue(void 0);
		          setNotice(t("redisedit.deleted"));
		          void loadLevel(activeDb, value.key.includes(":") ? value.key.slice(0, value.key.lastIndexOf(":")) : "");
		        }
		      })
		    );
		  }
		  if (tab === "info") {
		    body.push(React5.createElement(InfoView, {
		      key: "info",
		      info,
		      onRefresh: () => {
		        void refreshAll();
		      }
		    }));
		  }
		  if (tab === "console") {
		    body.push(
		      React5.createElement(ConsoleView, {
		        key: "console",
		        api,
		        source,
		        // The console's own target database — see `consoleDb`. Kept independent
		        // of the tree selection so that inspecting a key elsewhere cannot
		        // silently redirect a write.
		        db: consoleDb,
		        databases,
		        onSelectDb: setConsoleDb,
		        onResult: (message) => {
		          setNotice(message);
		          setError(void 0);
		        },
		        onError: (message) => {
		          setError(message);
		          setNotice(void 0);
		        },
		        onMutated: (key) => {
		          void refreshAll();
		          if (key !== void 0 && activeKey?.key === key) void loadValue(activeKey.db, key);
		        }
		      })
		    );
		  }
		  return React5.createElement(
		    "div",
		    { className: "dbm-root" },
		    React5.createElement(
		      "div",
		      { className: "dbm-header" },
		      React5.createElement(BackButton, { onBack, label: t("panel.backToList") }),
		      React5.createElement("span", { className: "dbm-title" }, source.name),
		      React5.createElement("span", { className: "dbm-badge dbm-badge-redis" }, "redis"),
		      // The connection's address only. A db number used to sit here and it
		      // misled: it was rendered from the last KEY or FOLDER clicked, so browsing
		      // db0 read "/db2" as soon as a key in db2 had been opened, and expanding a
		      // database did not update it at all. The panel shows every expanded
		      // database at once, so no single number can honestly describe it. Where a
		      // database DOES matter it is now named at the point of use — the console
		      // states the db its command will run against.
		      React5.createElement("span", { className: "dbm-subtitle dbm-mono" }, `${source.host ?? ""}:${source.port ?? ""}`),
		      React5.createElement("span", { className: "dbm-spacer" }),
		      React5.createElement(BackButton, { onBack: onClose })
		    ),
		    error === void 0 ? null : React5.createElement(ErrorBanner, { message: error }),
		    notice === void 0 ? null : React5.createElement("div", { className: "dbm-ok", style: { padding: "6px 14px" } }, notice),
		    ...Object.entries(indexProgress).filter(([, status]) => status !== void 0 && !status.done).map(([db, status]) => React5.createElement(IndexProgressBanner, {
		      key: `idx-${db}`,
		      db: Number(db),
		      status
		    })),
		    React5.createElement("div", { className: "dbm-split" }, left, React5.createElement("div", { className: "dbm-main" }, body)),
		    createFor === void 0 ? null : React5.createElement(NewKeyDialog, {
		      db: createFor.db,
		      folderPath: createFor.folderPath,
		      busy,
		      onSubmit: submitCreate,
		      onClose: () => setCreateFor(void 0)
		    }),
		    deleteFor === void 0 ? null : React5.createElement(DeleteDialog, {
		      target: deleteFor.target,
		      count: deleteFor.count,
		      busy,
		      onConfirm: () => {
		        void confirmDelete();
		      },
		      onClose: () => setDeleteFor(void 0)
		    }),
		    /**
		     * The confirmation for indexing a large database.
		     *
		     * Deliberately a prompt rather than an automatic decision: the walk is read-only
		     * but it holds the server's CPU for about a minute, and on a production server
		     * that is the user's call to make, not the panel's.
		     */
		    indexPrompt === void 0 ? null : React5.createElement(IndexPromptDialog, {
		      db: indexPrompt.db,
		      estimate: indexPrompt.estimate,
		      onConfirm: () => {
		        void buildIndex(indexPrompt.db);
		      },
		      onCancel: () => {
		        const db = indexPrompt.db;
		        setIndexPrompt(void 0);
		        if (levels[levelKey(db, "")] === void 0) void loadLevel(db, "");
		      }
		    })
		  );
		}
		function IndexProgressBanner(props) {
		  const { db, status } = props;
		  const pct = status.dbSize === 0 ? 0 : Math.min(100, Math.round(status.visited / status.dbSize * 100));
		  return React5.createElement(
		    "div",
		    { className: "dbm-index-progress" },
		    React5.createElement("span", null, t("redis.index.building", {
		      // The template names the database as {n}, so the value must be supplied
		      // under that name. Passing `db` left {n} untouched — the interpolator
		      // keeps unknown placeholders verbatim — and the banner read
		      // "正在为 db{n} 建立索引".
		      n: db,
		      visited: status.visited.toLocaleString(),
		      total: status.dbSize.toLocaleString(),
		      folders: status.folders.toLocaleString()
		    })),
		    React5.createElement(
		      "span",
		      { className: "dbm-index-bar", "aria-hidden": "true" },
		      React5.createElement("span", { className: "dbm-index-fill", style: { width: `${pct}%` } })
		    )
		  );
		}
		function IndexPromptDialog(props) {
		  const { db, estimate, onConfirm, onCancel } = props;
		  return React5.createElement(
		    "div",
		    { className: "dbm-modal-backdrop" },
		    React5.createElement(
		      "div",
		      { className: "dbm-modal", role: "dialog", "aria-modal": true },
		      React5.createElement("div", { className: "dbm-modal-head" }, t("redis.index.title", { n: db })),
		      React5.createElement(
		        "div",
		        { className: "dbm-modal-body" },
		        React5.createElement("p", null, t("redis.index.why", {
		          keys: estimate.keys.toLocaleString(),
		          seconds: estimate.estimatedSeconds
		        })),
		        React5.createElement("p", { className: "dbm-hint" }, t("redis.index.warning"))
		      ),
		      React5.createElement(
		        "div",
		        { className: "dbm-modal-foot" },
		        React5.createElement("button", { type: "button", className: "dbm-btn", onClick: onCancel }, t("redis.index.skip")),
		        React5.createElement("button", { type: "button", className: "dbm-btn dbm-btn-primary", onClick: onConfirm }, t("redis.index.confirm"))
		      )
		    )
		  );
		}
		function InfoView(props) {
		  const { info, onRefresh } = props;
		  const facts = [];
		  if (info.version !== void 0) facts.push([t("redis.version"), info.version]);
		  if (info.mode !== void 0) facts.push([t("redis.mode"), info.mode]);
		  if (info.uptimeSeconds !== void 0) facts.push([t("redis.uptime"), formatUptime(info.uptimeSeconds)]);
		  if (info.usedMemoryHuman !== void 0) facts.push([t("redis.memory"), info.usedMemoryHuman]);
		  if (info.connectedClients !== void 0) facts.push([t("redis.clients"), String(info.connectedClients)]);
		  if (info.totalKeys !== void 0) facts.push([t("redis.totalKeys"), String(info.totalKeys)]);
		  return React5.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React5.createElement(
		      "div",
		      { className: "dbm-scroll" },
		      React5.createElement(
		        "div",
		        { className: "dbm-pad" },
		        React5.createElement(
		          "div",
		          { className: "dbm-row" },
		          React5.createElement("strong", null, t("redis.info")),
		          React5.createElement("span", { className: "dbm-spacer" }),
		          React5.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", onClick: onRefresh }, t("common.refresh"))
		        ),
		        React5.createElement(
		          "div",
		          { className: "dbm-grid" },
		          facts.map(
		            ([label, val]) => React5.createElement(
		              "div",
		              { key: label },
		              React5.createElement("div", { className: "dbm-hint" }, label),
		              React5.createElement("div", { className: "dbm-mono" }, val)
		            )
		          )
		        ),
		        React5.createElement("strong", null, t("redis.databases")),
		        info.databases.length === 0 ? React5.createElement("div", { className: "dbm-hint" }, t("redis.noKeys")) : React5.createElement(
		          "table",
		          { className: "dbm-table" },
		          React5.createElement("thead", null, React5.createElement("tr", null, React5.createElement("th", null, t("redis.db")), React5.createElement("th", null, t("redis.keys")))),
		          React5.createElement(
		            "tbody",
		            null,
		            info.databases.map(
		              (entry) => React5.createElement(
		                "tr",
		                { key: entry.db },
		                React5.createElement("td", null, `db${entry.db}`),
		                React5.createElement("td", null, String(entry.keys))
		              )
		            )
		          )
		        )
		      )
		    )
		  );
		}
		function ConsoleView(props) {
		  const { api, source, db, databases, onSelectDb, onResult, onError, onMutated } = props;
		  const [command, setCommand] = React5.useState("");
		  const [allowWrite, setAllowWrite] = React5.useState(false);
		  const [result, setResult] = React5.useState(void 0);
		  const [busy, setBusy] = React5.useState(false);
		  const run = async () => {
		    const args = splitCommand(command);
		    if (args.length === 0) return;
		    setBusy(true);
		    setResult(void 0);
		    try {
		      const value = await api.redisCommand(source.id, { args, db, allowWrite });
		      const message = t("sql.rows", { n: value.rows.length, ms: value.durationMs });
		      setResult({ columns: value.columns, rows: value.rows, message });
		      onResult(message);
		      onMutated(keyFromCommand(args));
		    } catch (failure) {
		      onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  return React5.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React5.createElement(
		      "div",
		      { className: "dbm-pad" },
		      React5.createElement("input", {
		        className: "dbm-input dbm-mono",
		        value: command,
		        placeholder: t("redis.consolePlaceholder"),
		        spellcheck: false,
		        onChange: (event) => setCommand(event.target.value),
		        onKeyDown: (event) => {
		          if (event.key === "Enter") void run();
		        }
		      }),
		      React5.createElement(
		        "div",
		        { className: "dbm-row" },
		        React5.createElement("button", { type: "button", className: "dbm-btn dbm-btn-primary", disabled: busy, onClick: () => {
		          void run();
		        } }, busy ? t("common.loading") : t("redis.consoleRun")),
		        React5.createElement(
		          "label",
		          { className: "dbm-check" },
		          React5.createElement("input", {
		            type: "checkbox",
		            checked: allowWrite,
		            onChange: (event) => setAllowWrite(event.target.checked)
		          }),
		          t("redis.allowWrite")
		        ),
		        // Which database the command runs against, stated AND settable. The
		        // console can write, so an unstated or inherited target is a hazard: this
		        // used to read from the last key clicked, so typing a write while looking
		        // at db0 could have landed it in db2.
		        React5.createElement(
		          "label",
		          { className: "dbm-check" },
		          t("redis.consoleDb"),
		          React5.createElement(
		            "select",
		            {
		              className: "dbm-select",
		              value: String(db),
		              title: t("redisdb.search.scope.db", { n: db }),
		              "aria-label": t("redis.consoleDb"),
		              onChange: (event) => onSelectDb(Number(event.target.value))
		            },
		            databases.map(
		              (node) => React5.createElement("option", { key: node.db, value: String(node.db) }, `db${node.db}`)
		            )
		          )
		        ),
		        React5.createElement("span", { className: "dbm-hint" }, allowWrite ? t("redis.allowWrite.hint") : t("redis.readonlyNotice"))
		      )
		    ),
		    result === void 0 ? null : React5.createElement(
		      "div",
		      { className: "dbm-tab-body", style: { minHeight: 0 } },
		      React5.createElement("div", { className: "dbm-pad dbm-hint" }, result.message),
		      React5.createElement(
		        "div",
		        { className: "dbm-data" },
		        React5.createElement(
		          "table",
		          null,
		          React5.createElement("thead", null, React5.createElement("tr", null, result.columns.map((column) => React5.createElement("th", { key: column }, column)))),
		          React5.createElement(
		            "tbody",
		            null,
		            result.rows.map(
		              (row, index) => React5.createElement(
		                "tr",
		                { key: index },
		                row.map(
		                  (cell, cellIndex) => React5.createElement(
		                    "td",
		                    { key: cellIndex, className: isNull(cell) ? "dbm-null" : void 0, title: renderCell(cell) },
		                    renderCell(cell)
		                  )
		                )
		              )
		            )
		          )
		        )
		      )
		    )
		  );
		}

		// src/client/SourceListView.ts
		var React7 = __toESM(require("react"), 1);

		// src/client/SourceFormDialog.ts
		var React6 = __toESM(require("react"), 1);
		function defaultPort(kind) {
		  return kind === "mysql" ? "3306" : "6379";
		}
		function initialState(source, initialKind) {
		  if (source === void 0) {
		    return {
		      kind: initialKind,
		      id: "",
		      name: "",
		      group: "",
		      tags: "",
		      description: "",
		      file: "",
		      host: "",
		      port: initialKind === "sqlite" ? "" : defaultPort(initialKind),
		      user: "",
		      password: "",
		      clearPassword: false,
		      tls: false,
		      connectTimeoutMs: "",
		      readonly: false
		    };
		  }
		  return {
		    kind: source.kind,
		    id: source.id,
		    name: source.name,
		    group: source.group,
		    tags: source.tags.join(","),
		    description: source.description,
		    file: source.file ?? "",
		    host: source.host ?? "",
		    port: source.port === void 0 ? "" : String(source.port),
		    user: source.user ?? "",
		    password: "",
		    clearPassword: false,
		    tls: source.tls === true,
		    connectTimeoutMs: source.connectTimeoutMs === void 0 ? "" : String(source.connectTimeoutMs),
		    readonly: source.readonly
		  };
		}
		function toPayload(state, isEdit) {
		  const tags = state.tags.split(",").map((item) => item.trim()).filter((item) => item !== "");
		  const payload = {
		    kind: state.kind,
		    name: state.name.trim(),
		    group: state.group.trim(),
		    tags,
		    description: state.description.trim(),
		    readonly: state.readonly
		  };
		  if (!isEdit) {
		    const id = state.id.trim();
		    if (id !== "") payload.id = id;
		  }
		  if (state.connectTimeoutMs.trim() !== "") payload.connectTimeoutMs = Number(state.connectTimeoutMs);
		  if (state.kind === "sqlite") {
		    payload.file = state.file.trim();
		  } else {
		    payload.host = state.host.trim();
		    if (state.port.trim() !== "") payload.port = Number(state.port);
		    if (state.kind === "mysql") {
		      payload.user = state.user.trim();
		    }
		    if (state.clearPassword) payload.password = "";
		    else if (state.password !== "") payload.password = state.password;
		    payload.tls = state.tls;
		  }
		  return payload;
		}
		function missingFields(state) {
		  const missing = [];
		  if (state.name.trim() === "") missing.push(t("form.name"));
		  if (state.kind === "sqlite") {
		    if (state.file.trim() === "") missing.push(t("form.file"));
		  } else {
		    if (state.host.trim() === "") missing.push(t("form.host"));
		    if (state.port.trim() === "" || !/^\d+$/.test(state.port.trim())) missing.push(t("form.port"));
		  }
		  return missing;
		}
		function SourceFormDialog(props) {
		  const { source, initialKind, onTest, onSubmit, onClose } = props;
		  const isEdit = source !== void 0;
		  const [state, setState] = React6.useState(() => initialState(source, initialKind ?? "sqlite"));
		  const [busy, setBusy] = React6.useState(false);
		  const [testing, setTesting] = React6.useState(false);
		  const [error, setError] = React6.useState(void 0);
		  const [testResult, setTestResult] = React6.useState(void 0);
		  const patch = (next) => {
		    setState((current) => ({ ...current, ...next }));
		    setTestResult(void 0);
		  };
		  const submit = async () => {
		    const missing = missingFields(state);
		    if (missing.length > 0) {
		      setError(t("form.required", { fields: missing.join("\u3001") }));
		      return;
		    }
		    setBusy(true);
		    setError(void 0);
		    try {
		      await onSubmit(toPayload(state, isEdit));
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		      setBusy(false);
		    }
		  };
		  const runTest = async () => {
		    if (onTest === void 0) return;
		    const missing = missingFields(state);
		    if (missing.length > 0) {
		      setError(t("form.required", { fields: missing.join("\u3001") }));
		      setTestResult(void 0);
		      return;
		    }
		    setTesting(true);
		    setError(void 0);
		    setTestResult(void 0);
		    try {
		      setTestResult(await onTest(toPayload(state, isEdit), isEdit ? source.id : void 0));
		    } catch (failure) {
		      setTestResult({ ok: false, error: failure instanceof Error ? failure.message : String(failure) });
		    } finally {
		      setTesting(false);
		    }
		  };
		  const field = (label, control, key) => React6.createElement("label", { className: "dbm-label", key: key ?? label }, React6.createElement("span", null, label), control);
		  const input = (value, onChange, extra = {}) => React6.createElement("input", {
		    className: "dbm-input",
		    value,
		    onChange: (event) => onChange(event.target.value),
		    ...extra
		  });
		  const children = [];
		  children.push(
		    field(
		      t("form.kind"),
		      React6.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: state.kind,
		          disabled: isEdit,
		          onChange: (event) => {
		            const kind = event.target.value;
		            patch({ kind, port: kind === "sqlite" ? "" : defaultPort(kind) });
		          }
		        },
		        DB_KINDS.map((kind) => React6.createElement("option", { key: kind, value: kind }, kind))
		      ),
		      "kind"
		    )
		  );
		  if (isEdit) {
		    children.push(React6.createElement("div", { className: "dbm-hint", key: "kind-hint" }, t("form.kindLocked")));
		  }
		  children.push(
		    React6.createElement(
		      "div",
		      { className: "dbm-grid", key: "identity" },
		      field(t("form.name"), input(state.name, (value) => patch({ name: value }), { placeholder: t("form.name.placeholder") }), "name"),
		      isEdit ? field(t("form.id"), React6.createElement("div", { className: "dbm-mono" }, state.id), "id") : field(t("form.id"), input(state.id, (value) => patch({ id: value }), { placeholder: t("form.id.placeholder") }), "id"),
		      field(t("form.group"), input(state.group, (value) => patch({ group: value }), { placeholder: t("form.group.placeholder") }), "group"),
		      field(t("form.tags"), input(state.tags, (value) => patch({ tags: value }), { placeholder: t("form.tags.placeholder") }), "tags")
		    )
		  );
		  if (state.kind === "sqlite") {
		    children.push(
		      field(t("form.file"), input(state.file, (value) => patch({ file: value }), { placeholder: t("form.file.placeholder"), spellcheck: false }), "file")
		    );
		  } else {
		    const connection = [
		      field(t("form.host"), input(state.host, (value) => patch({ host: value }), { placeholder: "127.0.0.1", spellcheck: false }), "host"),
		      field(t("form.port"), input(state.port, (value) => patch({ port: value }), { inputMode: "numeric" }), "port")
		    ];
		    if (state.kind === "mysql") {
		      connection.push(
		        field(t("form.user"), input(state.user, (value) => patch({ user: value }), { placeholder: "root" }), "user")
		      );
		    }
		    children.push(React6.createElement("div", { className: "dbm-grid", key: "connection" }, connection));
		    if (state.kind === "mysql") {
		      children.push(React6.createElement("div", { className: "dbm-hint", key: "schemaless-hint" }, t("form.mysql.noDefaultSchema")));
		    }
		    children.push(
		      field(
		        t("form.password"),
		        React6.createElement("input", {
		          className: "dbm-input",
		          type: "password",
		          value: state.password,
		          disabled: state.clearPassword,
		          placeholder: isEdit && source.hasPassword ? t("form.password.keep") : "",
		          onChange: (event) => patch({ password: event.target.value }),
		          autoComplete: "new-password"
		        }),
		        "password"
		      )
		    );
		    if (isEdit && source.hasPassword) {
		      children.push(
		        React6.createElement(
		          "label",
		          { className: "dbm-check", key: "clear" },
		          React6.createElement("input", {
		            type: "checkbox",
		            checked: state.clearPassword,
		            onChange: (event) => patch({ clearPassword: event.target.checked, password: "" })
		          }),
		          t("form.password.clear")
		        )
		      );
		    }
		    children.push(
		      React6.createElement(
		        "label",
		        { className: "dbm-check", key: "tls" },
		        React6.createElement("input", {
		          type: "checkbox",
		          checked: state.tls,
		          onChange: (event) => patch({ tls: event.target.checked })
		        }),
		        t("form.tls")
		      )
		    );
		    children.push(React6.createElement("div", { className: "dbm-hint", key: "tls-hint" }, t("form.tls.hint")));
		    children.push(
		      React6.createElement(
		        "div",
		        { className: "dbm-field-inline", key: "timeout" },
		        React6.createElement("span", null, t("form.timeout")),
		        React6.createElement("input", {
		          className: "dbm-input",
		          value: state.connectTimeoutMs,
		          inputMode: "numeric",
		          placeholder: "10000",
		          onChange: (event) => patch({ connectTimeoutMs: event.target.value })
		        }),
		        React6.createElement("span", { className: "dbm-hint" }, t("form.timeout.unit"))
		      )
		    );
		  }
		  children.push(
		    React6.createElement(
		      "label",
		      { className: "dbm-check", key: "readonly" },
		      React6.createElement("input", {
		        type: "checkbox",
		        checked: state.readonly,
		        onChange: (event) => patch({ readonly: event.target.checked })
		      }),
		      t("form.readonly")
		    )
		  );
		  children.push(React6.createElement("div", { className: "dbm-hint", key: "readonly-hint" }, t("form.readonly.hint")));
		  children.push(
		    field(
		      t("form.description"),
		      React6.createElement("textarea", {
		        className: "dbm-textarea",
		        rows: 2,
		        value: state.description,
		        onChange: (event) => patch({ description: event.target.value })
		      }),
		      "description"
		    )
		  );
		  if (error !== void 0) children.push(React6.createElement(ErrorBanner, { key: "error", message: error }));
		  if (testResult !== void 0) {
		    children.push(
		      testResult.ok ? React6.createElement(
		        "div",
		        { className: "dbm-ok", key: "test-ok" },
		        t("form.test.ok", { ms: testResult.latencyMs ?? 0, version: testResult.serverVersion ?? "" }).trim(),
		        testResult.note === void 0 ? null : React6.createElement("div", { className: "dbm-hint" }, t("form.test.note", { note: testResult.note }))
		      ) : React6.createElement(ErrorBanner, { key: "test-fail", message: t("test.fail", { error: testResult.error ?? "" }) })
		    );
		  }
		  const footerBusy = busy || testing;
		  return React6.createElement(Modal, {
		    title: isEdit ? t("form.editTitle") : t("form.newTitle"),
		    // A close during a test would drop the in-flight request's UI, so the same
		    // guard covers both buttons.
		    onClose: () => {
		      if (!footerBusy) onClose();
		    },
		    footer: React6.createElement(
		      "div",
		      { className: "dbm-modal-foot-split" },
		      // Left: test the draft. Right: commit or discard.
		      React6.createElement(
		        "div",
		        { className: "dbm-modal-foot-left" },
		        onTest === void 0 ? null : React6.createElement(
		          "button",
		          {
		            key: "test",
		            type: "button",
		            className: "dbm-btn",
		            disabled: footerBusy,
		            onClick: () => {
		              void runTest();
		            }
		          },
		          testing ? t("form.testing") : t("form.test")
		        )
		      ),
		      React6.createElement(
		        "div",
		        { className: "dbm-modal-foot-right" },
		        React6.createElement("button", { key: "cancel", type: "button", className: "dbm-btn", disabled: footerBusy, onClick: onClose }, t("form.cancel")),
		        React6.createElement("button", { key: "save", type: "button", className: "dbm-btn dbm-btn-primary", disabled: footerBusy, onClick: () => {
		          void submit();
		        } }, busy ? t("common.loading") : t("form.save"))
		      )
		    ),
		    children
		  });
		}

		// src/client/SourceListView.ts
		function hostOf(source) {
		  if (source.kind === "sqlite") return source.file ?? t("common.none");
		  const port = source.port === void 0 ? "" : `:${source.port}`;
		  return `${source.host ?? t("common.none")}${port}`;
		}
		function authOf(source) {
		  if (source.auth === "file") return t("auth.file");
		  if (source.auth === "password") return t("auth.password");
		  return t("auth.none");
		}
		function groupSources(sources, mode) {
		  if (mode === "none") return [{ label: "", items: sources }];
		  const groups = /* @__PURE__ */ new Map();
		  const push = (label, source) => {
		    const bucket = groups.get(label);
		    if (bucket === void 0) groups.set(label, [source]);
		    else bucket.push(source);
		  };
		  for (const source of sources) {
		    if (mode === "kind") push(source.kind, source);
		    else if (mode === "group") push(source.group === "" ? t("common.none") : source.group, source);
		    else if (source.tags.length === 0) push(t("common.none"), source);
		    else for (const tag of source.tags) push(tag, source);
		  }
		  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, items]) => ({ label, items }));
		}
		function matches(source, term) {
		  if (term === "") return true;
		  const needle = term.toLowerCase();
		  return [
		    source.id,
		    source.name,
		    source.group,
		    source.kind,
		    source.host ?? "",
		    source.file ?? "",
		    source.user ?? "",
		    source.tags.join(" "),
		    source.description
		  ].some((field) => field.toLowerCase().includes(needle));
		}
		function SourceListView(props) {
		  const { api, sources, settings, engines, reload, saveGate, onConnect } = props;
		  const [term, setTerm] = React7.useState("");
		  const [groupMode, setGroupMode] = React7.useState("none");
		  const [tests, setTests] = React7.useState({});
		  const [connecting, setConnecting] = React7.useState(void 0);
		  const [error, setError] = React7.useState(void 0);
		  const [editing, setEditing] = React7.useState(void 0);
		  const [creating, setCreating] = React7.useState(false);
		  const [deleting, setDeleting] = React7.useState(void 0);
		  const filtered = sources.filter((source) => matches(source, term.trim()));
		  const grouped = groupSources(filtered, groupMode);
		  const runTest = async (source) => {
		    setTests((current) => ({ ...current, [source.id]: { status: "running" } }));
		    try {
		      const result = await api.test(source.id);
		      setTests((current) => ({ ...current, [source.id]: { status: "done", result } }));
		    } catch (failure) {
		      setTests((current) => ({ ...current, [source.id]: { status: "done", result: { ok: false, error: failure instanceof Error ? failure.message : String(failure) } } }));
		    }
		  };
		  const connect = async (source) => {
		    if (connecting !== void 0) return;
		    setConnecting(source.id);
		    try {
		      await onConnect(source);
		    } finally {
		      setConnecting(void 0);
		    }
		  };
		  const remove = async (source) => {
		    try {
		      await api.deleteSource(source.id);
		      setDeleting(void 0);
		      await reload();
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    }
		  };
		  const unavailable = engines.filter((engine) => !engine.available);
		  const rows = [];
		  for (const group of grouped) {
		    if (group.label !== "") {
		      rows.push(
		        React7.createElement(
		          "tr",
		          { key: `group-${group.label}` },
		          React7.createElement(
		            "td",
		            { colSpan: 8, className: "dbm-hint", style: { background: "var(--dsw-alias-interactive-bg-hover)", fontWeight: 500 } },
		            `${group.label} (${group.items.length})`
		          )
		        )
		      );
		    }
		    for (const source of group.items) {
		      const test = tests[source.id];
		      rows.push(
		        React7.createElement(
		          "tr",
		          { key: source.id },
		          React7.createElement("td", null, React7.createElement("span", { className: `dbm-badge dbm-badge-${source.kind}` }, source.kind)),
		          React7.createElement(
		            "td",
		            null,
		            React7.createElement("div", { style: { fontWeight: 500 } }, source.name),
		            source.description === "" ? null : React7.createElement("div", { className: "dbm-hint" }, source.description),
		            React7.createElement("div", { className: "dbm-hint dbm-mono" }, source.id)
		          ),
		          React7.createElement("td", { className: "dbm-mono" }, hostOf(source)),
		          React7.createElement("td", null, source.kind === "mysql" ? source.user ?? t("common.none") : t("common.none")),
		          /*
		           * 分组 as its own column, not only as the grouping header.
		           *
		           * The group was previously reachable ONLY by switching the toolbar to
		           * 「按分组」, so a source's group was invisible in the default list — the
		           * one thing a user scans the list to learn. Showing it per row also
		           * makes 「按分组」 a rearrangement of information already on screen
		           * rather than the only way to see it.
		           */
		          React7.createElement("td", null, source.group === "" ? t("common.none") : source.group),
		          React7.createElement(
		            "td",
		            null,
		            authOf(source),
		            source.readonly ? React7.createElement("span", { className: "dbm-badge", style: { marginLeft: 6 } }, t("form.readonly")) : null
		          ),
		          React7.createElement(
		            "td",
		            null,
		            source.tags.length === 0 ? t("common.none") : React7.createElement(
		              "span",
		              { className: "dbm-tags" },
		              source.tags.map((tag) => React7.createElement("span", { key: tag, className: "dbm-badge" }, tag))
		            )
		          ),
		          React7.createElement(
		            "td",
		            null,
		            React7.createElement(
		              "div",
		              { className: "dbm-actions" },
		              React7.createElement(
		                "button",
		                { type: "button", className: "dbm-btn dbm-btn-sm", disabled: test?.status === "running", onClick: () => {
		                  void runTest(source);
		                } },
		                test?.status === "running" ? t("action.testing") : t("action.test")
		              ),
		              /*
		               * The connect button shows its own progress, in the same way the
		               * 测试 button does. A spinner is added rather than only swapping
		               * the label, because on a dead host the wait is the driver's full
		               * deadline and a word alone reads as a state, not as activity.
		               */
		              React7.createElement(
		                "button",
		                {
		                  type: "button",
		                  className: `dbm-btn dbm-btn-sm dbm-btn-primary${connecting === source.id ? " dbm-btn-busy" : ""}`,
		                  disabled: connecting !== void 0,
		                  "aria-busy": connecting === source.id ? "true" : void 0,
		                  onClick: () => {
		                    void connect(source);
		                  }
		                },
		                connecting === source.id ? [
		                  React7.createElement("span", { key: "spin", className: "dbm-spinner" }),
		                  t("db.connecting")
		                ] : t("action.connect")
		              ),
		              React7.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", onClick: () => setEditing(source) }, t("action.edit")),
		              React7.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm dbm-btn-danger", onClick: () => setDeleting(source) }, t("action.delete"))
		            ),
		            test === void 0 ? null : TestOutcome(test)
		          )
		        )
		      );
		    }
		  }
		  const children = [
		    React7.createElement(
		      "div",
		      { className: "dbm-toolbar", key: "toolbar" },
		      React7.createElement("input", {
		        className: "dbm-input",
		        value: term,
		        placeholder: t("list.search"),
		        onChange: (event) => setTerm(event.target.value)
		      }),
		      React7.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: groupMode,
		          title: t("list.groupBy"),
		          onChange: (event) => setGroupMode(event.target.value)
		        },
		        React7.createElement("option", { value: "none" }, `${t("list.groupBy")}: ${t("list.group.none")}`),
		        React7.createElement("option", { value: "kind" }, `${t("list.groupBy")}: ${t("list.group.kind")}`),
		        React7.createElement("option", { value: "group" }, `${t("list.groupBy")}: ${t("list.group.group")}`),
		        React7.createElement("option", { value: "tag" }, `${t("list.groupBy")}: ${t("list.group.tag")}`)
		      ),
		      React7.createElement("span", { className: "dbm-hint" }, t("list.count", { n: filtered.length })),
		      React7.createElement("span", { className: "dbm-spacer" }),
		      React7.createElement("button", { type: "button", className: "dbm-btn dbm-btn-primary", onClick: () => setCreating(true) }, `+ ${t("list.new")}`)
		    )
		  ];
		  if (error !== void 0) {
		    children.push(React7.createElement(ErrorBanner, { key: "error", message: error }));
		  }
		  if (unavailable.length > 0) {
		    children.push(
		      React7.createElement(
		        "div",
		        { className: "dbm-error", key: "engines" },
		        unavailable.map((engine) => t("panel.engine.missing", { kind: engine.kind, detail: engine.detail ?? "" })).join("\n")
		      )
		    );
		  }
		  children.push(
		    React7.createElement(
		      "div",
		      { className: "dbm-scroll", key: "scroll" },
		      sources.length === 0 ? React7.createElement(Empty, { message: t("list.empty") }) : filtered.length === 0 ? React7.createElement(Empty, { message: t("list.emptyFiltered") }) : React7.createElement(
		        "table",
		        { className: "dbm-table" },
		        React7.createElement(
		          "thead",
		          null,
		          React7.createElement(
		            "tr",
		            null,
		            ...[t("col.kind"), t("col.name"), t("col.group"), t("col.host"), t("col.user"), t("col.auth"), t("col.tags"), t("col.actions")].map(
		              (label) => React7.createElement("th", { key: label }, label)
		            )
		          )
		        ),
		        React7.createElement("tbody", null, rows)
		      )
		    )
		  );
		  children.push(GateStrip({ settings, saveGate }));
		  if (creating || editing !== void 0) {
		    children.push(
		      React7.createElement(SourceFormDialog, {
		        key: "form",
		        ...editing === void 0 ? {} : { source: editing },
		        // Tests the draft against the host without saving it, so a wrong host
		        // or password is caught before the entry exists.
		        onTest: (payload, baseId) => api.testConnection(payload, baseId),
		        onSubmit: async (payload) => {
		          if (editing === void 0) await api.createSource(payload);
		          else await api.updateSource(editing.id, payload);
		          setCreating(false);
		          setEditing(void 0);
		          await reload();
		        },
		        onClose: () => {
		          setCreating(false);
		          setEditing(void 0);
		        }
		      })
		    );
		  }
		  if (deleting !== void 0) {
		    children.push(
		      React7.createElement(Modal, {
		        key: "delete",
		        title: t("delete.title"),
		        onClose: () => setDeleting(void 0),
		        footer: [
		          React7.createElement("button", { key: "cancel", type: "button", className: "dbm-btn", onClick: () => setDeleting(void 0) }, t("common.cancel")),
		          React7.createElement("button", { key: "ok", type: "button", className: "dbm-btn dbm-btn-danger", onClick: () => {
		            void remove(deleting);
		          } }, t("delete.confirm"))
		        ],
		        children: React7.createElement("div", null, t("delete.body", { name: deleting.name }))
		      })
		    );
		  }
		  return React7.createElement(
		    "div",
		    { className: "dbm-root" },
		    React7.createElement(
		      "div",
		      { className: "dbm-header" },
		      React7.createElement(BackButton, { onBack: props.onBack }),
		      React7.createElement("span", { className: "dbm-title" }, t("panel.title")),
		      React7.createElement("span", { className: "dbm-subtitle" }, t("panel.subtitle")),
		      React7.createElement("span", { className: "dbm-spacer" })
		      /*
		       * The engine-availability line used to sit in this corner, spelling out
		       * 「引擎: sqlite · mysql · redis」 on every screen — which repeats the
		       * Engine column of the list right below it and says nothing at all when
		       * all three are present. A MISSING driver is the only fact worth
		       * surfacing here, and it is already rendered as its own banner above the
		       * table (see the `unavailable` block), where it names the reason.
		       */
		    ),
		    ...children
		  );
		}
		function TestOutcome(state) {
		  if (state.status === "running") {
		    return React7.createElement("div", { className: "dbm-hint" }, t("common.loading"));
		  }
		  const { result } = state;
		  if (result.ok) {
		    return React7.createElement(
		      "div",
		      { className: "dbm-ok" },
		      t("test.ok", { ms: result.latencyMs ?? 0, version: result.serverVersion ?? "" }).trim()
		    );
		  }
		  return React7.createElement("div", { className: "dbm-error" }, t("test.fail", { error: result.error ?? "" }));
		}
		function GateStrip(props) {
		  const [busy, setBusy] = React7.useState(false);
		  const [savedAt, setSavedAt] = React7.useState(void 0);
		  const { settings, saveGate } = props;
		  const toggle = async (patch) => {
		    setBusy(true);
		    try {
		      await saveGate(patch);
		      setSavedAt(Date.now());
		    } finally {
		      setBusy(false);
		    }
		  };
		  return React7.createElement(
		    "div",
		    { className: "dbm-toolbar", style: { borderTop: "1px solid var(--dsw-alias-border-l3)", borderBottom: "none" } },
		    React7.createElement(
		      "label",
		      { className: "dbm-check" },
		      React7.createElement("input", {
		        type: "checkbox",
		        checked: settings.allowAgentWrite,
		        disabled: busy,
		        onChange: (event) => {
		          void toggle({ allowAgentWrite: event.target.checked });
		        }
		      }),
		      t("gate.allowWrite")
		    ),
		    React7.createElement(
		      "label",
		      { className: "dbm-check", style: settings.allowAgentWrite ? void 0 : { opacity: 0.45 } },
		      React7.createElement("input", {
		        type: "checkbox",
		        checked: settings.requireApproval,
		        disabled: busy || !settings.allowAgentWrite,
		        onChange: (event) => {
		          void toggle({ requireApproval: event.target.checked });
		        }
		      }),
		      t("gate.requireApproval")
		    ),
		    React7.createElement("span", { className: "dbm-spacer" }),
		    React7.createElement("span", { className: "dbm-hint" }, savedAt === void 0 ? t("gate.hint") : t("gate.saved"))
		  );
		}

		// src/client/SqlDatabaseView.ts
		var React16 = __toESM(require("react"), 1);

		// src/client/SqlBrowseTab.ts
		var React8 = __toESM(require("react"), 1);

		// src/client/column-kinds.ts
		function fieldKind(column) {
		  if (column.options !== void 0 && column.options.length > 0) {
		    return { kind: "enum", options: column.options };
		  }
		  const type = column.type.trim().toLowerCase();
		  if (/^(bool|boolean)$/.test(type)) return { kind: "boolean" };
		  if (/^(tiny|small|medium|big)?(int|year)/.test(type)) return { kind: "number", integer: true };
		  if (/^(decimal|numeric|float|double|real|bit)/.test(type)) return { kind: "number", integer: false };
		  if (/^date$/.test(type)) return { kind: "date" };
		  if (/^datetime|^timestamp/.test(type)) return { kind: "datetime" };
		  if (/^time$/.test(type)) return { kind: "time" };
		  if (/blob|binary/.test(type)) return { kind: "binary" };
		  const maxLength = /\((\d{1,6})\)/.exec(type)?.[1];
		  return {
		    kind: "text",
		    ...maxLength === void 0 ? {} : { maxLength: Number(maxLength) },
		    // A `TEXT`/`JSON` column holds prose or a document, so it gets a textarea;
		    // a bounded `VARCHAR` gets one line with the length enforced.
		    multiline: /(text|json|clob)/.test(type)
		  };
		}
		function isNumericType(type) {
		  return /^(tiny|small|medium|big)?(int|decimal|numeric|float|double|real|bit|year)\b/i.test(type.trim());
		}
		function isDateType(type) {
		  return /^(date|datetime|timestamp|time)\b/i.test(type.trim());
		}
		function isTextualType(type) {
		  return /char|text|enum|set|json|blob|binary|uuid/i.test(type);
		}
		function operatorsFor(type) {
		  if (isNumericType(type) || isDateType(type)) {
		    return ["eq", "neq", "gt", "gte", "lt", "lte", "between", "in", "isNull", "isNotNull"];
		  }
		  if (isTextualType(type)) {
		    return ["contains", "notContains", "startsWith", "endsWith", "eq", "neq", "in", "isNull", "isNotNull"];
		  }
		  return [...ROW_FILTER_OPERATORS];
		}
		function searchOperators(column) {
		  if (/^enum\b/.test(column.type.trim().toLowerCase())) {
		    return ["eq", "neq", "isNull", "isNotNull"];
		  }
		  return operatorsFor(column.type);
		}
		function searchValueKind(column) {
		  if (!/^enum\b/.test(column.type.trim().toLowerCase())) return { kind: "input" };
		  if (column.options === void 0 || column.options.length === 0) return { kind: "input" };
		  return { kind: "members", options: column.options };
		}
		function isUnaryOperator(operator) {
		  return UNARY_FILTER_OPERATORS.includes(operator);
		}
		function inputHints(column) {
		  const type = column.type.trim().toLowerCase();
		  if (/^(tiny|small|medium|big)?(int|bit|year)/.test(type)) return { inputMode: "numeric" };
		  if (/^(decimal|numeric|float|double|real)/.test(type)) return { inputMode: "decimal" };
		  if (/^date$/.test(type)) return { type: "date" };
		  if (/^datetime|^timestamp/.test(type)) return { type: "datetime-local" };
		  if (/^time$/.test(type)) return { type: "time" };
		  return {};
		}
		function autoAssigns(kind, column) {
		  if (kind === "sqlite") {
		    if (column.key !== "PRI" || column.primaryKeyPosition !== 1) return false;
		    return column.type.trim().toLowerCase().replace(/\s+/g, " ") === "integer";
		  }
		  if (kind === "mysql") {
		    return column.extra !== void 0 && /auto_increment/i.test(column.extra);
		  }
		  return false;
		}

		// src/client/SqlBrowseTab.ts
		function rowKeyOf(columns, primaryKey, row) {
		  if (primaryKey.length === 0) return void 0;
		  const known = new Set(columns.map((column) => column.name));
		  if (!primaryKey.every((name) => known.has(name))) return void 0;
		  return primaryKey.map((column) => ({ column, value: row[column] ?? null }));
		}
		function cellText(value) {
		  return value === null ? "" : String(value);
		}
		function SqlBrowseTab(props) {
		  const { api, sourceId, schema, table, rows, query: query2, onQuery, onReload, onExport, onImport, readOnly, onNotice, onError } = props;
		  const [editing, setEditing] = React8.useState(void 0);
		  const [selected, setSelected] = React8.useState(/* @__PURE__ */ new Set());
		  const [confirming, setConfirming] = React8.useState(void 0);
		  const [busy, setBusy] = React8.useState(false);
		  const page = rows?.page;
		  const columns = page?.columns ?? props.knownColumns ?? [];
		  const primaryKey = page?.primaryKey ?? [];
		  const indexes = page?.indexes ?? [];
		  const loading = rows?.loading === true;
		  const keyId = React8.useCallback((keys) => {
		    if (keys === void 0) return void 0;
		    return keys.map((key) => `${key.column}=${key.value === null ? "\0null" : String(key.value)}`).join("");
		  }, []);
		  const keyAt = (index) => {
		    const row = page?.rows[index];
		    return row === void 0 ? void 0 : rowKeyOf(columns, primaryKey, row);
		  };
		  const selectedKeys = React8.useMemo(() => {
		    if (page === void 0) return [];
		    const out = [];
		    for (const [index] of page.rows.entries()) {
		      const keys = keyAt(index);
		      const id = keyId(keys);
		      if (keys !== void 0 && id !== void 0 && selected.has(id)) out.push(keys);
		    }
		    return out;
		  }, [page, selected, columns, primaryKey, keyId]);
		  React8.useEffect(() => {
		    setSelected(/* @__PURE__ */ new Set());
		  }, [table, schema, page?.page, query2.orderBy, query2.orderByColumns, query2.filters]);
		  const saveCell = async (index, column, value) => {
		    const keys = keyAt(index);
		    if (keys === void 0) {
		      onError(t("browse.noPk"));
		      return;
		    }
		    setEditing(void 0);
		    const current = page?.rows[index]?.[column] ?? null;
		    if (String(current ?? "") === value) return;
		    setBusy(true);
		    try {
		      await api.updateRow(sourceId, {
		        schema,
		        table,
		        values: [{ column, value }],
		        keys
		      });
		      onNotice(t("browse.cellSaved"));
		      onError(void 0);
		      onReload();
		    } catch (failure) {
		      onError(t("browse.cellSaveFailed", { error: failure instanceof Error ? failure.message : String(failure) }));
		    } finally {
		      setBusy(false);
		    }
		  };
		  const runDelete = async (keys) => {
		    setBusy(true);
		    try {
		      if (keys.length === 1) {
		        await api.deleteRow(sourceId, { schema, table, keys: keys[0] });
		      } else {
		        await api.deleteRows(sourceId, { schema, table, keySets: keys });
		      }
		      setConfirming(void 0);
		      setSelected(/* @__PURE__ */ new Set());
		      onNotice(t("browse.deleteSelected"));
		      onError(void 0);
		      onReload();
		    } catch (failure) {
		      setConfirming(void 0);
		      onError(t("db.action.failed", { error: failure instanceof Error ? failure.message : String(failure) }));
		    } finally {
		      setBusy(false);
		    }
		  };
		  const copyValue = async (value) => {
		    const failure = await copyText(cellText(value));
		    if (failure === null) {
		      onNotice(t("browse.copied"));
		      onError(void 0);
		    } else {
		      onError(t("browse.copyFailed", { error: failure }));
		    }
		  };
		  const sortOptions = [];
		  const sortTargets = [];
		  if (primaryKey.length > 0) {
		    sortTargets.push({ name: "PRIMARY", columns: primaryKey });
		  }
		  for (const index of indexes) {
		    if (index.columns.length === 0) continue;
		    if (index.primary === true) continue;
		    sortTargets.push({ name: index.name, columns: index.columns });
		  }
		  for (const target of sortTargets) {
		    for (const dir of ["asc", "desc"]) {
		      sortOptions.push({
		        label: `${target.name} (${dir === "asc" ? t("browse.sortAsc") : t("browse.sortDesc")})`,
		        // Direction and columns in one value, so selecting an entry carries both.
		        // The separator is NUL, which cannot occur in an identifier.
		        value: `${dir}\0${target.columns.join("\0")}`,
		        columns: target.columns,
		        dir
		      });
		    }
		  }
		  const activeSort = query2.orderByColumns === void 0 ? void 0 : sortOptions.find((option) => option.dir === query2.orderDir && option.columns.join("\0") === query2.orderByColumns.join("\0"));
		  if (rows === void 0) return React8.createElement(Empty, { message: t("common.loading") });
		  if (rows.error !== void 0 && page === void 0) return React8.createElement(ErrorBanner, { message: rows.error });
		  const pages = page === void 0 ? 1 : Math.max(1, Math.ceil(page.total / page.pageSize));
		  const canSelectRows = primaryKey.length > 0 && readOnly !== true;
		  const canEditCells = primaryKey.length > 0 && readOnly !== true;
		  const canActOnRows = canSelectRows;
		  const rowAction = (key, label, onClick, danger = false, title) => React8.createElement("button", {
		    key,
		    type: "button",
		    className: `dbm-row-action${danger ? " dbm-row-action-danger" : ""}`,
		    disabled: busy,
		    ...title === void 0 ? {} : { title },
		    onClick
		  }, label);
		  const header = [];
		  if (canActOnRows) {
		    const allSelected = page !== void 0 && page.rows.length > 0 && selectedKeys.length === page.rows.length;
		    header.push(
		      React8.createElement(
		        "th",
		        { key: "__select", className: "dbm-select-col" },
		        React8.createElement("input", {
		          type: "checkbox",
		          checked: allSelected,
		          disabled: page === void 0 || page.rows.length === 0,
		          "aria-label": t("browse.selectAll"),
		          title: allSelected ? t("browse.selectNone") : t("browse.selectAll"),
		          onChange: (event) => {
		            if (page === void 0) return;
		            if (!event.target.checked) {
		              setSelected(/* @__PURE__ */ new Set());
		              return;
		            }
		            const next = /* @__PURE__ */ new Set();
		            for (const [index] of page.rows.entries()) {
		              const id = keyId(keyAt(index));
		              if (id !== void 0) next.add(id);
		            }
		            setSelected(next);
		          }
		        })
		      )
		    );
		  }
		  for (const column of page?.columns ?? []) {
		    const sorted = query2.orderBy === column.name;
		    header.push(
		      React8.createElement(
		        "th",
		        { key: column.name },
		        React8.createElement(
		          "button",
		          {
		            type: "button",
		            title: t("browse.sortByColumn"),
		            onClick: () => {
		              const nextDir = sorted && query2.orderDir === "asc" ? "desc" : "asc";
		              onQuery({ page: 1, orderBy: column.name, orderByColumns: void 0, orderDir: nextDir });
		            }
		          },
		          column.name,
		          React8.createElement(SortMark, { direction: sorted ? query2.orderDir : "none" })
		        )
		      )
		    );
		  }
		  header.push(React8.createElement("th", { key: "__actions", className: "dbm-row-actions" }, t("browse.actions")));
		  if (readOnly === true) header.pop();
		  const body = [];
		  for (const [index, row] of (page?.rows ?? []).entries()) {
		    const keys = keyAt(index);
		    const id = keyId(keys);
		    const isSelected = id !== void 0 && selected.has(id);
		    const cells = [];
		    if (canActOnRows) {
		      cells.push(
		        React8.createElement(
		          "td",
		          { key: "__select", className: "dbm-select-col" },
		          React8.createElement("input", {
		            type: "checkbox",
		            checked: isSelected,
		            disabled: id === void 0,
		            "aria-label": t("browse.select"),
		            onChange: (event) => {
		              if (id === void 0) return;
		              setSelected((current) => {
		                const next = new Set(current);
		                if (event.target.checked) next.add(id);
		                else next.delete(id);
		                return next;
		              });
		            }
		          })
		        )
		      );
		    }
		    for (const column of page?.columns ?? []) {
		      const value = row[column.name] ?? null;
		      const isEditing = editing !== void 0 && editing.row === index && editing.column === column.name;
		      if (isEditing) {
		        cells.push(
		          React8.createElement(
		            "td",
		            { key: column.name },
		            /*
		             * A one-line TEXTAREA, not an input.
		             *
		             * A text column can hold far more than a 380px cell shows, and an
		             * `<input>` cannot grow: editing a long value meant seeing a few
		             * characters at a time with no way to widen the view. A textarea
		             * starts at one row and is `resize: vertical`, so the user drags it
		             * taller when the value needs it — which is the only way to give "let
		             * the user size it" without guessing a height in advance.
		             *
		             * Enter still saves (see onKeyDown) rather than inserting a newline:
		             * inside a grid, Enter has always meant "commit this cell", and a
		             * newline in the middle of a value is rare enough that Shift+Enter is
		             * the better trade.
		             */
		            React8.createElement("textarea", {
		              className: "dbm-cell-input",
		              rows: 1,
		              autoFocus: true,
		              value: editing.value,
		              "aria-label": column.name,
		              spellcheck: false,
		              onChange: (event) => setEditing({ row: index, column: column.name, value: event.target.value }),
		              onKeyDown: (event) => {
		                if (event.key === "Escape") {
		                  event.preventDefault();
		                  setEditing(void 0);
		                  return;
		                }
		                if (event.key === "Enter" && !event.shiftKey) {
		                  event.preventDefault();
		                  void saveCell(index, column.name, event.currentTarget.value);
		                }
		              },
		              /*
		               * Losing focus saves, which is what makes the gesture a single
		               * action rather than one that needs a confirmation click.
		               *
		               * The value is read from the ELEMENT, not from `editing.value`.
		               * The handler closes over the state of the render that created it,
		               * so a blur arriving before React has committed a keystroke would
		               * save the PREVIOUS value — and the unchanged-value guard in
		               * `saveCell` would then skip the write entirely, silently discarding
		               * the edit.
		               */
		              onBlur: (event) => {
		                void saveCell(index, column.name, event.target.value);
		              }
		            })
		          )
		        );
		        continue;
		      }
		      cells.push(
		        React8.createElement(
		          "td",
		          {
		            key: column.name,
		            className: `${isNull(value) ? "dbm-null" : ""}${canEditCells ? " dbm-cell-editable" : ""}`.trim() || void 0,
		            title: canEditCells ? t("browse.cellHint") : renderCell(value),
		            ...canEditCells ? { "data-dbm-cell": `${index}:${column.name}` } : {},
		            ...canEditCells ? {
		              onDoubleClick: () => {
		                setEditing({ row: index, column: column.name, value: value === null ? "" : String(value) });
		              }
		            } : {}
		          },
		          renderCell(value)
		        )
		      );
		    }
		    if (readOnly === true) {
		      body.push(React8.createElement("tr", { key: index, "data-selected": String(isSelected) }, ...cells));
		      continue;
		    }
		    cells.push(
		      React8.createElement(
		        "td",
		        { key: "__actions", className: "dbm-row-actions" },
		        React8.createElement(
		          "div",
		          { className: "dbm-actions" },
		          rowAction("edit", t("browse.editRow"), () => {
		            const first = page?.columns[0];
		            if (first === void 0) return;
		            setEditing({ row: index, column: first.name, value: row[first.name] === null ? "" : String(row[first.name] ?? "") });
		          }, false, canActOnRows ? void 0 : t("browse.noPk")),
		          rowAction("copy", t("browse.copyCell"), () => {
		            void copyValue(row[page?.columns[0]?.name ?? ""] ?? null);
		          }),
		          rowAction("copyRow", t("browse.copyRow"), () => {
		            const line = (page?.columns ?? []).map((column) => cellText(row[column.name] ?? null)).join("	");
		            void copyText(line).then((failure) => {
		              if (failure === null) {
		                onNotice(t("browse.copied"));
		                onError(void 0);
		              } else onError(t("browse.copyFailed", { error: failure }));
		            });
		          }, false, t("browse.copyRow")),
		          rowAction("delete", t("browse.deleteRow"), () => {
		            if (keys === void 0) {
		              onError(t("browse.noPk"));
		              return;
		            }
		            setConfirming({ kind: "row", keys: [keys] });
		          }, true)
		        )
		      )
		    );
		    body.push(React8.createElement("tr", { key: index, "data-selected": String(isSelected) }, ...cells));
		  }
		  const toolbar = React8.createElement(
		    "div",
		    { className: "dbm-row", style: { padding: "8px 12px" } },
		    React8.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", disabled: loading, onClick: onReload }, t("browse.refresh")),
		    React8.createElement("label", { className: "dbm-hint" }, `${t("browse.pageSize")}:`),
		    React8.createElement(
		      "select",
		      {
		        className: "dbm-select",
		        value: String(query2.pageSize),
		        onChange: (event) => onQuery({ page: 1, pageSize: Number(event.target.value) })
		      },
		      [50, 100, 200, 500, 1e3].map((size) => React8.createElement("option", { key: size, value: String(size) }, String(size)))
		    ),
		    sortOptions.length === 0 ? null : [
		      React8.createElement("label", { key: "sortlabel", className: "dbm-hint" }, `${t("browse.sortByIndex")}:`),
		      React8.createElement(
		        "select",
		        {
		          key: "sort",
		          className: "dbm-select",
		          // The entry that is currently in effect; 「无」 when the page is
		          // unsorted or sorted by a column header instead (a header click
		          // sets `orderBy`, which is not one of these entries).
		          value: activeSort === void 0 ? "" : activeSort.value,
		          title: t("browse.sortTitle"),
		          onChange: (event) => {
		            const value = event.target.value;
		            if (value === "") {
		              onQuery({ page: 1, orderByColumns: void 0, orderBy: void 0 });
		              return;
		            }
		            const [dir, ...columns2] = value.split("\0");
		            onQuery({
		              page: 1,
		              // A header sort and an index sort are exclusive: the driver
		              // prefers `orderByColumns`, so leaving `orderBy` set would make
		              // the header appear to do nothing.
		              orderBy: void 0,
		              orderByColumns: columns2,
		              orderDir: dir === "desc" ? "desc" : "asc"
		            });
		          }
		        },
		        [
		          ...sortOptions.map((option) => React8.createElement("option", { key: option.value, value: option.value }, option.label)),
		          // 「无」 sits LAST, so the list opens on the indexes and the way to
		          // turn sorting off is at the end rather than in the way.
		          React8.createElement("option", { key: "__none__", value: "" }, t("browse.sortIndexNone"))
		        ]
		      )
		    ],
		    React8.createElement("span", { className: "dbm-hint" }, page === void 0 ? "" : t("browse.total", { n: page.total })),
		    React8.createElement("span", { className: "dbm-spacer" }),
		    React8.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", onClick: () => onExport() }, t("export.title")),
		    React8.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", onClick: onImport }, t("import.title")),
		    loading ? React8.createElement("span", { className: "dbm-hint" }, t("common.loading")) : null
		  );
		  const batchBar = selectedKeys.length === 0 ? null : React8.createElement(
		    "div",
		    { className: "dbm-batch-bar" },
		    React8.createElement("span", null, t("browse.selected", { n: selectedKeys.length })),
		    React8.createElement("button", {
		      type: "button",
		      className: "dbm-btn dbm-btn-sm dbm-btn-danger",
		      disabled: busy,
		      onClick: () => setConfirming({ kind: "batch", keys: selectedKeys })
		    }, t("browse.deleteSelected")),
		    React8.createElement("button", {
		      type: "button",
		      className: "dbm-btn dbm-btn-sm",
		      onClick: () => onExport({ rowsOnly: true, selectedKeys })
		    }, t("browse.exportSelected")),
		    React8.createElement("span", { className: "dbm-spacer" }),
		    React8.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", onClick: () => setSelected(/* @__PURE__ */ new Set()) }, t("browse.selectNone"))
		  );
		  const pager = React8.createElement(
		    "div",
		    { className: "dbm-pager" },
		    React8.createElement("button", {
		      type: "button",
		      className: "dbm-btn dbm-btn-sm",
		      disabled: page === void 0 || page.page <= 1 || loading,
		      onClick: () => onQuery({ page: Math.max(1, (page?.page ?? 1) - 1) })
		    }, t("browse.prev")),
		    React8.createElement("span", null, page === void 0 ? "" : t("browse.page", { page: page.page, pages })),
		    React8.createElement("button", {
		      type: "button",
		      className: "dbm-btn dbm-btn-sm",
		      disabled: page === void 0 || page.page >= pages || loading,
		      onClick: () => onQuery({ page: Math.min(pages, (page?.page ?? 1) + 1) })
		    }, t("browse.next")),
		    React8.createElement(PageJump, {
		      page: page?.page ?? 1,
		      pages,
		      onGo: (next) => onQuery({ page: next })
		    }),
		    page === void 0 || page.total === 0 ? null : React8.createElement("span", { className: "dbm-hint" }, t("browse.rowCount", {
		      from: (page.page - 1) * page.pageSize + 1,
		      to: (page.page - 1) * page.pageSize + page.rows.length,
		      total: page.total
		    })),
		    !canActOnRows && page !== void 0 && page.columns.length > 0 ? React8.createElement("span", { className: "dbm-hint" }, t("browse.noPk")) : null
		  );
		  return React8.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    toolbar,
		    // A read error is shown above the grid rather than replacing it: the rows on
		    // screen are still the last good answer, and blanking them would lose the
		    // user's place for a transient failure.
		    rows.error === void 0 ? null : React8.createElement(ErrorBanner, { message: rows.error }),
		    batchBar,
		    page === void 0 || page.columns.length === 0 ? React8.createElement(Empty, { message: t("browse.empty") }) : React8.createElement(
		      "div",
		      { className: "dbm-data" },
		      React8.createElement(
		        "table",
		        null,
		        React8.createElement("thead", null, React8.createElement("tr", null, ...header)),
		        React8.createElement("tbody", null, ...body)
		      )
		    ),
		    pager,
		    confirming === void 0 ? null : React8.createElement(Modal, {
		      title: confirming.kind === "row" ? t("browse.deleteRow") : t("browse.deleteManyTitle"),
		      onClose: () => setConfirming(void 0),
		      footer: [
		        React8.createElement("button", { key: "cancel", type: "button", className: "dbm-btn", disabled: busy, onClick: () => setConfirming(void 0) }, t("common.cancel")),
		        React8.createElement("button", {
		          key: "ok",
		          type: "button",
		          className: "dbm-btn dbm-btn-danger",
		          disabled: busy,
		          onClick: () => {
		            void runDelete(confirming.keys);
		          }
		        }, busy ? t("common.loading") : t("browse.deleteRow"))
		      ],
		      children: React8.createElement(
		        "div",
		        null,
		        confirming.kind === "row" ? t("delete.confirm") : t("browse.deleteManyBody", { n: confirming.keys.length })
		      )
		    })
		  );
		}

		// src/client/SqlInsertTab.ts
		var React9 = __toESM(require("react"), 1);

		// src/client/insert-values.ts
		var MAX_INSERT_FORMS = 50;
		function blankField() {
		  return { text: "", kind: "value" };
		}
		function mayOmit(engine, column) {
		  return column.nullable || column.defaultValue !== void 0 || autoAssigns(engine, column);
		}
		function needsEmptyChoice(column) {
		  if (column.nullable || column.defaultValue !== void 0) return false;
		  return fieldKind(column).kind === "text";
		}
		function buildRow(engine, columns, fields) {
		  const values = [];
		  for (const column of columns) {
		    const field = fields[column.name] ?? blankField();
		    if (field.kind === "null") {
		      if (!column.nullable) return { failure: { reason: "required", column: column.name } };
		      values.push({ column: column.name, value: null });
		      continue;
		    }
		    if (field.kind === "empty") {
		      values.push({ column: column.name, value: "" });
		      continue;
		    }
		    if (field.text === "") {
		      if (!mayOmit(engine, column)) return { failure: { reason: "required", column: column.name } };
		      continue;
		    }
		    const kind = fieldKind(column);
		    if (kind.kind === "number") {
		      const text = field.text.trim();
		      if (!(kind.integer ? /^-?\d+$/ : /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/).test(text)) {
		        return { failure: { reason: "notNumber", column: column.name } };
		      }
		    }
		    if (kind.kind === "text" && kind.maxLength !== void 0 && [...field.text].length > kind.maxLength) {
		      return { failure: { reason: "tooLong", column: column.name, max: kind.maxLength } };
		    }
		    values.push({ column: column.name, value: field.text });
		  }
		  return { values };
		}
		function isUntouchedForm(columns, fields) {
		  return columns.every((column) => {
		    const field = fields[column.name];
		    if (field === void 0) return true;
		    return field.kind === "value" && field.text === "";
		  });
		}
		function placeholderValue(options) {
		  let candidate = "";
		  while (options.includes(candidate)) candidate += "\0";
		  return candidate;
		}
		function parseFormCount(raw) {
		  const text = raw.trim();
		  if (!/^\d+$/.test(text)) return void 0;
		  const value = Number(text);
		  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_INSERT_FORMS) return void 0;
		  return value;
		}
		function resizeForms(forms, count) {
		  if (count === forms.length) return forms;
		  if (count < forms.length) return forms.slice(0, count);
		  const next = [...forms];
		  while (next.length < count) next.push({});
		  return next;
		}

		// src/client/SqlInsertTab.ts
		function SqlInsertTab(props) {
		  const { api, source, schema, table, columns, loading, onDone, onError } = props;
		  const editable = React9.useMemo(() => columns.filter((column) => column.generated !== true), [columns]);
		  const [forms, setForms] = React9.useState([{}]);
		  const [countText, setCountText] = React9.useState("1");
		  const [busy, setBusy] = React9.useState(false);
		  React9.useEffect(() => {
		    setForms([{}]);
		    setCountText("1");
		  }, [table, schema]);
		  const fieldOf = (form, column) => form[column.name] ?? blankField();
		  const setField = (index, column, value) => {
		    setForms((current) => current.map((form, at) => at === index ? { ...form, [column]: value } : form));
		  };
		  const failureText = (failure) => {
		    if (failure.reason === "notNumber") return t("insert.numberInvalid", { column: failure.column });
		    if (failure.reason === "tooLong") return t("insert.valueTooLong", { column: failure.column, max: failure.max });
		    return t("insert.required", { column: failure.column });
		  };
		  const submit = async (keepCount) => {
		    const payloads = [];
		    for (const [index, form] of forms.entries()) {
		      if (forms.length > 1 && isUntouchedForm(editable, form)) continue;
		      const built = buildRow(source.kind, editable, form);
		      if ("failure" in built) {
		        onError(forms.length > 1 ? `${t("insert.formOf", { n: index + 1 })}: ${failureText(built.failure)}` : failureText(built.failure));
		        return;
		      }
		      if (built.values.length === 0) {
		        onError(t("insert.hint"));
		        return;
		      }
		      payloads.push(built.values);
		    }
		    if (payloads.length === 0) {
		      onError(t("insert.hint"));
		      return;
		    }
		    setBusy(true);
		    try {
		      const result = payloads.length === 1 ? await api.insertRow(source.id, { schema, table, values: payloads[0] }) : await api.insertRows(source.id, { schema, table, rows: payloads });
		      onError(void 0);
		      const inserted = payloads.length > 1 ? t(keepCount ? "insert.rowsDone" : "insert.rowsDoneBrowsing", { n: result.affected, forms: payloads.length }) : t(keepCount ? "insert.done" : "insert.doneAndBrowsing", { n: result.affected });
		      onDone(inserted, keepCount ? "again" : "inserted");
		      const next = keepCount ? forms.length : 1;
		      setForms(Array.from({ length: next }, () => ({})));
		      setCountText(String(next));
		    } catch (failure) {
		      onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  const applyCount = () => {
		    const count = parseFormCount(countText);
		    if (count === void 0) {
		      onError(t("insert.rowsRange", { max: MAX_INSERT_FORMS }));
		      return;
		    }
		    onError(void 0);
		    setForms((current) => resizeForms(current, count));
		    setCountText(String(count));
		  };
		  const addForm = () => {
		    if (forms.length >= MAX_INSERT_FORMS) {
		      onError(t("insert.rowsRange", { max: MAX_INSERT_FORMS }));
		      return;
		    }
		    setForms((current) => [...current, {}]);
		    setCountText(String(forms.length + 1));
		  };
		  const removeForm = (index) => {
		    setForms((current) => current.filter((_, at) => at !== index));
		    setCountText(String(Math.max(1, forms.length - 1)));
		  };
		  if (columns.length === 0) {
		    return React9.createElement("div", { className: "dbm-pad dbm-hint" }, loading ? t("common.loading") : t("search.needStructure"));
		  }
		  const control = (index, form, column) => {
		    const field = fieldOf(form, column);
		    const kind = fieldKind(column);
		    const locked = field.kind !== "value" || busy;
		    const apply2 = (patch) => setField(index, column.name, { ...field, ...patch });
		    const testId = { "data-dbm-insert-for": `${index}:${column.name}` };
		    if (kind.kind === "enum") {
		      const blank2 = placeholderValue(kind.options);
		      return React9.createElement(
		        "select",
		        {
		          ...testId,
		          className: "dbm-select",
		          value: field.text,
		          disabled: locked,
		          // Choosing the blank entry puts the state back to NOTHING, not to the
		          // placeholder's own characters: `buildRow` reads `''` as "nothing was
		          // chosen", and a NUL sent through as a value would be a string no enum
		          // declares.
		          onChange: (event) => apply2({ kind: "value", text: event.target.value === blank2 ? "" : event.target.value })
		        },
		        /*
		         * The blank entry is ALWAYS rendered, whatever the column allows.
		         *
		         * A controlled select whose value matches no option renders the first
		         * real option while its state stays empty — so omitting the placeholder
		         * here would show "是（1）" for a column that is still unset, and the
		         * submit would then be refused for a value the user can see on screen.
		         * The wording is what changes: where a blank answer is legal it reads as
		         * the way to use the default, and where it is not it reads as "choose
		         * one", which is the truth.
		         *
		         * Its value comes from `placeholderValue`, not a bare '', so an enum that
		         * declares '' as a member cannot collide with it.
		         */
		        [
		          React9.createElement("option", { key: "", value: blank2 }, mayOmit(source.kind, column) ? t("insert.blankHint") : t("insert.chooseHint")),
		          ...kind.options.map((option) => React9.createElement("option", { key: option, value: option }, option))
		        ]
		      );
		    }
		    if (kind.kind === "boolean") {
		      const blank2 = placeholderValue([]);
		      return React9.createElement(
		        "select",
		        {
		          ...testId,
		          className: "dbm-select",
		          value: field.text,
		          disabled: locked,
		          onChange: (event) => apply2({ kind: "value", text: event.target.value === blank2 ? "" : event.target.value })
		        },
		        [
		          React9.createElement("option", { key: "", value: blank2 }, mayOmit(source.kind, column) ? t("insert.blankHint") : t("insert.chooseHint")),
		          React9.createElement("option", { key: "1", value: "1" }, t("insert.boolTrue")),
		          React9.createElement("option", { key: "0", value: "0" }, t("insert.boolFalse"))
		        ]
		      );
		    }
		    if (kind.kind === "date" || kind.kind === "datetime" || kind.kind === "time") {
		      const type = kind.kind === "date" ? "date" : kind.kind === "datetime" ? "datetime-local" : "time";
		      return React9.createElement("input", {
		        ...testId,
		        className: "dbm-input dbm-mono",
		        type,
		        value: field.text,
		        disabled: locked,
		        onChange: (event) => apply2({ kind: "value", text: event.target.value })
		      });
		    }
		    if (kind.kind === "binary") {
		      return React9.createElement("textarea", {
		        ...testId,
		        className: "dbm-textarea dbm-mono",
		        rows: 1,
		        value: field.text,
		        disabled: locked,
		        placeholder: "x'DEADBEEF'",
		        spellcheck: false,
		        onChange: (event) => apply2({ kind: "value", text: event.target.value })
		      });
		    }
		    if (kind.kind === "text" && kind.multiline) {
		      return React9.createElement("textarea", {
		        ...testId,
		        className: "dbm-textarea",
		        rows: 3,
		        value: field.text,
		        disabled: locked,
		        maxLength: kind.maxLength,
		        onChange: (event) => apply2({ kind: "value", text: event.target.value })
		      });
		    }
		    return React9.createElement("input", {
		      ...testId,
		      className: `dbm-input${kind.kind === "number" ? " dbm-mono" : ""}`,
		      value: field.text,
		      disabled: locked,
		      maxLength: kind.kind === "text" ? kind.maxLength : void 0,
		      ...kind.kind === "number" ? { inputMode: kind.integer ? "numeric" : "decimal" } : {},
		      ...autoAssigns(source.kind, column) ? { placeholder: t("insert.autoAssign") } : {},
		      onChange: (event) => apply2({ kind: "value", text: event.target.value })
		    });
		  };
		  const choices = (index, form, column) => {
		    const field = fieldOf(form, column);
		    const out = [];
		    if (column.nullable) {
		      out.push(
		        React9.createElement(
		          "label",
		          { className: "dbm-check", key: "null", title: t("insert.nullHint") },
		          React9.createElement("input", {
		            type: "checkbox",
		            "data-dbm-insert-null": `${index}:${column.name}`,
		            checked: field.kind === "null",
		            disabled: busy,
		            // The text already typed is kept, so unticking restores it instead of
		            // making the user retype it.
		            onChange: (event) => setField(index, column.name, { ...field, kind: event.target.checked ? "null" : "value" })
		          }),
		          "NULL"
		        )
		      );
		    } else if (needsEmptyChoice(column)) {
		      out.push(
		        React9.createElement(
		          "label",
		          { className: "dbm-check", key: "empty", title: t("insert.emptyHint") },
		          React9.createElement("input", {
		            type: "checkbox",
		            "data-dbm-insert-empty": `${index}:${column.name}`,
		            checked: field.kind === "empty",
		            disabled: busy,
		            onChange: (event) => setField(index, column.name, { ...field, kind: event.target.checked ? "empty" : "value" })
		          }),
		          t("insert.setEmpty")
		        )
		      );
		    }
		    return out;
		  };
		  const nameCell = (column) => React9.createElement(
		    "div",
		    { className: "dbm-insert-name", key: `name-${column.name}`, title: column.comment },
		    column.name,
		    React9.createElement("span", { className: "dbm-hint" }, ` \xB7 ${column.type === "" ? t("common.none") : column.type}${column.nullable ? "" : " NOT NULL"}${column.key === "PRI" ? " PK" : ""}`),
		    autoAssigns(source.kind, column) ? React9.createElement("span", { className: "dbm-hint" }, ` \xB7 ${t("insert.autoAssign")}`) : null,
		    column.defaultValue === void 0 ? null : React9.createElement("span", { className: "dbm-hint" }, ` \xB7 ${t("insert.defaultSuffix", { value: column.defaultValue })}`)
		  );
		  return React9.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React9.createElement(
		      "div",
		      { className: "dbm-scroll" },
		      React9.createElement(
		        "div",
		        { className: "dbm-pad" },
		        React9.createElement("strong", null, `${t("insert.title")} \u2014 ${table}`),
		        React9.createElement("div", { className: "dbm-hint" }, t("insert.hint")),
		        React9.createElement(
		          "div",
		          { className: "dbm-row" },
		          React9.createElement(
		            "label",
		            { className: "dbm-field-inline" },
		            React9.createElement("span", null, t("insert.rowsLabel")),
		            React9.createElement("input", {
		              className: "dbm-input dbm-mono",
		              type: "number",
		              min: 1,
		              max: MAX_INSERT_FORMS,
		              "data-dbm-insert-count": true,
		              value: countText,
		              disabled: busy,
		              onChange: (event) => setCountText(event.target.value),
		              onKeyDown: (event) => {
		                if (event.key === "Enter") applyCount();
		              }
		            })
		          ),
		          React9.createElement("button", {
		            type: "button",
		            className: "dbm-btn dbm-btn-sm",
		            "data-dbm-insert-apply": true,
		            disabled: busy,
		            onClick: applyCount
		          }, t("insert.rowsApply")),
		          React9.createElement("button", {
		            type: "button",
		            className: "dbm-btn dbm-btn-sm",
		            disabled: busy,
		            onClick: addForm
		          }, `+ ${t("insert.addRow")}`)
		        ),
		        ...forms.map((form, index) => React9.createElement(
		          "div",
		          { key: index, className: "dbm-insert-form", "data-dbm-insert-form": String(index) },
		          React9.createElement(
		            "div",
		            { className: "dbm-row" },
		            React9.createElement("strong", null, forms.length > 1 ? t("insert.formOf", { n: index + 1 }) : t("insert.title")),
		            forms.length > 1 ? React9.createElement("button", {
		              type: "button",
		              className: "dbm-btn dbm-btn-sm dbm-btn-danger",
		              disabled: busy,
		              title: t("insert.removeRow"),
		              onClick: () => removeForm(index)
		            }, "\u2715") : null
		          ),
		          React9.createElement(
		            "div",
		            { className: "dbm-insert-grid" },
		            ...editable.flatMap((column) => [
		              nameCell(column),
		              React9.createElement(
		                "div",
		                { className: "dbm-insert-value", key: `value-${column.name}` },
		                control(index, form, column),
		                ...choices(index, form, column)
		              )
		            ])
		          )
		        )),
		        React9.createElement(
		          "div",
		          { className: "dbm-row" },
		          React9.createElement("button", {
		            type: "button",
		            className: "dbm-btn dbm-btn-primary",
		            disabled: busy || loading,
		            onClick: () => {
		              void submit(false);
		            }
		          }, busy ? t("common.loading") : t("insert.submit")),
		          React9.createElement("button", {
		            type: "button",
		            className: "dbm-btn",
		            disabled: busy || loading,
		            onClick: () => {
		              void submit(true);
		            }
		          }, t("insert.submitAndNew"))
		        )
		      )
		    )
		  );
		}

		// src/client/SqlOperationsTab.ts
		var React10 = __toESM(require("react"), 1);
		function TargetFields(props) {
		  const { idPrefix, schemas, schema, table, disabled, onSchema, onTable } = props;
		  return React10.createElement(
		    "div",
		    { className: "dbm-row" },
		    React10.createElement(
		      "label",
		      { className: "dbm-field-inline" },
		      React10.createElement("span", null, t("tableop.move.target")),
		      React10.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: schema,
		          disabled,
		          "data-dbm-op-target-schema": "",
		          id: `${idPrefix}-schema`,
		          onChange: (event) => onSchema(event.target.value)
		        },
		        ...schemas.map((name) => React10.createElement("option", { key: name, value: name }, name))
		      )
		    ),
		    React10.createElement("span", { className: "dbm-hint" }, "."),
		    React10.createElement(
		      "input",
		      {
		        className: "dbm-input dbm-mono",
		        value: table,
		        disabled,
		        "data-dbm-op-target-table": "",
		        "aria-label": t("tableop.move.target"),
		        onChange: (event) => onTable(event.target.value)
		      }
		    )
		  );
		}
		function SqlOperationsTab(props) {
		  const {
		    api,
		    sourceId,
		    engineKind,
		    schema,
		    table,
		    schemas,
		    support,
		    supportError,
		    maintenanceSupport,
		    busy,
		    onBusy,
		    onNotice,
		    onError,
		    onMaintain,
		    onAskDanger,
		    onMoved,
		    onTablesChanged
		  } = props;
		  const has = (op) => support?.includes(op) === true;
		  const known = support !== void 0;
		  const [isView, setIsView] = React10.useState(void 0);
		  const [moveSchema, setMoveSchema] = React10.useState(schema);
		  const [moveTable, setMoveTable] = React10.useState(table);
		  const [copySchema, setCopySchema] = React10.useState(schema);
		  const [copyTable, setCopyTable] = React10.useState(`${table}_copy`);
		  const [copyData, setCopyData] = React10.useState(true);
		  const [options, setOptions] = React10.useState(void 0);
		  const [optionsError, setOptionsError] = React10.useState(void 0);
		  const [draft, setDraft] = React10.useState(void 0);
		  React10.useEffect(() => {
		    setMoveSchema(schema);
		    setMoveTable(table);
		    setCopySchema(schema);
		    setCopyTable(`${table}_copy`);
		    setOptions(void 0);
		    setDraft(void 0);
		    setOptionsError(void 0);
		    setIsView(void 0);
		  }, [schema, table]);
		  React10.useEffect(() => {
		    let live = true;
		    void api.tableOptions(sourceId, { schema, table }).then((value) => {
		      if (!live) return;
		      setIsView(value.isView === true);
		      setOptions(value);
		      setDraft({
		        engine: value.engine ?? "",
		        collation: value.collation ?? "",
		        comment: value.comment ?? "",
		        autoIncrement: value.autoIncrement === void 0 ? "" : String(value.autoIncrement),
		        rowFormat: value.rowFormat ?? "",
		        convert: false
		      });
		      setOptionsError(void 0);
		    }).catch((failure) => {
		      if (!live) return;
		      setOptionsError(failure instanceof Error ? failure.message : String(failure));
		    });
		    return () => {
		      live = false;
		    };
		  }, [api, sourceId, schema, table]);
		  const run = async (what) => {
		    onBusy(true);
		    try {
		      await what();
		      onError(void 0);
		    } catch (failure) {
		      onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      onBusy(false);
		    }
		  };
		  const submitMove = () => {
		    if (moveTable.trim() === "") {
		      onError(t("tableop.move.needsName"));
		      return;
		    }
		    if (moveSchema === schema && moveTable.trim() === table) {
		      onError(t("tableop.move.same"));
		      return;
		    }
		    const next = { schema: moveSchema, table: moveTable.trim() };
		    const fromName = `${schema}.${table}`;
		    const toName = `${next.schema}.${next.table}`;
		    void run(async () => {
		      await api.moveTable(sourceId, { schema, table, target: next });
		      onNotice(t("tableop.move.done", { from: fromName, to: toName }));
		      onMoved(next);
		    });
		  };
		  const submitCopy = () => {
		    if (copyTable.trim() === "") {
		      onError(t("tableop.copy.needsName"));
		      return;
		    }
		    if (copySchema === schema && copyTable.trim() === table) {
		      onError(t("tableop.copy.same"));
		      return;
		    }
		    const copyTarget = { schema: copySchema, table: copyTable.trim() };
		    const toName = `${copyTarget.schema}.${copyTarget.table}`;
		    void run(async () => {
		      await api.copyTable(sourceId, {
		        schema,
		        table,
		        target: copyTarget,
		        includeData: copyData,
		        isView
		      });
		      onNotice(t("tableop.copy.done", { to: toName }));
		      onTablesChanged();
		    });
		  };
		  const submitOptions = () => {
		    if (options === void 0 || draft === void 0) return;
		    const patch = {};
		    if (draft.engine !== (options.engine ?? "")) patch["engine"] = draft.engine;
		    if (draft.collation !== (options.collation ?? "")) {
		      patch["collation"] = draft.collation;
		      if (draft.convert && draft.collation !== "") patch["convertColumns"] = true;
		    }
		    if (draft.comment !== (options.comment ?? "")) patch["comment"] = draft.comment;
		    if (draft.autoIncrement !== "") {
		      const value = Number(draft.autoIncrement);
		      if (!Number.isInteger(value) || value < 1) {
		        onError(t("tableop.options.aiInvalid"));
		        return;
		      }
		      if (value !== options.autoIncrement) patch["autoIncrement"] = value;
		    }
		    if (draft.rowFormat !== (options.rowFormat ?? "")) patch["rowFormat"] = draft.rowFormat;
		    if (Object.keys(patch).length === 0) {
		      onNotice(t("tableop.options.unchanged"));
		      return;
		    }
		    void run(async () => {
		      await api.setTableOptions(sourceId, { schema, table, patch });
		      onNotice(t("tableop.options.done", { table }));
		      const fresh = await api.tableOptions(sourceId, { schema, table });
		      setOptions(fresh);
		      setDraft({
		        engine: fresh.engine ?? "",
		        collation: fresh.collation ?? "",
		        comment: fresh.comment ?? "",
		        autoIncrement: fresh.autoIncrement === void 0 ? "" : String(fresh.autoIncrement),
		        rowFormat: fresh.rowFormat ?? "",
		        convert: false
		      });
		    });
		  };
		  const maintenance = (op) => {
		    const supported = maintenanceSupport.includes(op);
		    return React10.createElement(
		      "button",
		      {
		        key: op,
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        disabled: busy || !supported,
		        title: supported ? t(`db.maint.${op}.hint`) : t("tableop.maint.unsupported"),
		        "data-dbm-op-maint": op,
		        "data-dbm-op-maint-supported": supported ? "true" : "false",
		        onClick: () => onMaintain(op)
		      },
		      t(`tableop.maint.${op}`)
		    );
		  };
		  return React10.createElement(
		    "div",
		    { className: "dbm-tab-body", "data-dbm-op-page": "" },
		    React10.createElement(
		      "div",
		      { className: "dbm-scroll" },
		      React10.createElement(
		        "div",
		        { className: "dbm-pad" },
		        React10.createElement("strong", null, t("tableop.title")),
		        React10.createElement("span", { className: "dbm-hint dbm-mono" }, t("tableop.scope", { schema, table })),
		        supportError === void 0 ? null : React10.createElement("span", { className: "dbm-hint" }, t("tableop.supportFailed", { error: supportError })),
		        // A view has no rows, no structure to copy and no table options; saying so
		        // once at the top is clearer than four blocks each failing on click. `false`
		        // while the kind is still being read, so no stale hint is left behind.
		        isView === true ? React10.createElement("span", { className: "dbm-hint" }, t("tableop.viewHint", { table })) : null,
		        React10.createElement("div", { className: "dbm-newtable-sep" }),
		        // ---- 1. 将数据表移动到 ------------------------------------------
		        React10.createElement(
		          "div",
		          { className: "dbm-op-block", "data-dbm-op-block": "move" },
		          React10.createElement("strong", null, t("tableop.move.title")),
		          React10.createElement("span", { className: "dbm-hint" }, t("tableop.move.body")),
		          has("move") ? [
		            React10.createElement(
		              "div",
		              { key: "target" },
		              React10.createElement(TargetFields, {
		                idPrefix: "move",
		                schemas,
		                schema: moveSchema,
		                table: moveTable,
		                disabled: busy || isView === true,
		                onSchema: setMoveSchema,
		                onTable: setMoveTable
		              })
		            ),
		            React10.createElement(
		              "div",
		              { key: "actions", className: "dbm-row" },
		              React10.createElement("button", {
		                type: "button",
		                className: `dbm-btn${busy ? " dbm-btn-busy" : ""}`,
		                disabled: busy || isView === true,
		                "data-dbm-op-submit": "move",
		                title: isView === true ? t("tableop.viewHint", { table }) : void 0,
		                onClick: submitMove
		              }, busy ? [React10.createElement("span", { key: "spin", className: "dbm-spinner" }), t("tableop.move.busy")] : t("tableop.move.submit"))
		            )
		          ] : React10.createElement("span", { className: "dbm-hint" }, t(known ? "tableop.unsupported.move" : "common.loading"))
		        ),
		        React10.createElement("div", { className: "dbm-newtable-sep" }),
		        // ---- 2. 表选项 ----------------------------------------------------
		        React10.createElement(
		          "div",
		          { className: "dbm-op-block", "data-dbm-op-block": "options" },
		          React10.createElement("strong", null, t("tableop.options.title")),
		          React10.createElement("span", { className: "dbm-hint" }, t("tableop.options.body")),
		          !has("options") ? React10.createElement("span", { className: "dbm-hint" }, t(known ? "tableop.unsupported.options" : "common.loading")) : optionsError !== void 0 ? React10.createElement("span", { className: "dbm-hint" }, optionsError) : options === void 0 || draft === void 0 ? React10.createElement("span", { className: "dbm-hint" }, t("tableop.options.loading")) : React10.createElement(
		            "div",
		            null,
		            React10.createElement(
		              "div",
		              { className: "dbm-grid2" },
		              // 存储引擎
		              React10.createElement(
		                "div",
		                { className: "dbm-grid-row" },
		                React10.createElement("label", { className: "dbm-grid-label", htmlFor: "dbm-op-engine" }, t("tableop.options.engine")),
		                React10.createElement("select", {
		                  id: "dbm-op-engine",
		                  className: "dbm-select dbm-grid-control",
		                  value: draft.engine,
		                  disabled: busy,
		                  "data-dbm-op-option": "engine",
		                  onChange: (event) => setDraft({ ...draft, engine: event.target.value })
		                }, ...ENGINES.map((value) => React10.createElement("option", { key: value, value }, value)))
		              ),
		              // 整理（排序规则）
		              React10.createElement(
		                "div",
		                { className: "dbm-grid-row" },
		                React10.createElement("label", { className: "dbm-grid-label", htmlFor: "dbm-op-collation" }, t("tableop.options.collation")),
		                React10.createElement(
		                  "select",
		                  {
		                    id: "dbm-op-collation",
		                    className: "dbm-select dbm-grid-control",
		                    value: draft.collation,
		                    disabled: busy,
		                    "data-dbm-op-option": "collation",
		                    onChange: (event) => setDraft({ ...draft, collation: event.target.value })
		                  },
		                  ...[.../* @__PURE__ */ new Set([draft.collation, ...COLLATIONS])].filter((name) => name !== "").map((value) => React10.createElement("option", { key: value, value }, value))
		                )
		              ),
		              // 表注释
		              React10.createElement(
		                "div",
		                { className: "dbm-grid-row" },
		                React10.createElement("label", { className: "dbm-grid-label", htmlFor: "dbm-op-comment" }, t("tableop.options.comment")),
		                React10.createElement("input", {
		                  id: "dbm-op-comment",
		                  className: "dbm-input dbm-grid-control",
		                  value: draft.comment,
		                  disabled: busy,
		                  "data-dbm-op-option": "comment",
		                  onChange: (event) => setDraft({ ...draft, comment: event.target.value })
		                })
		              ),
		              // 下一个 AUTO_INCREMENT 值 — only when the table HAS one, which
		              // is what an absent value means.
		              options.autoIncrement === void 0 ? null : React10.createElement(
		                "div",
		                { className: "dbm-grid-row" },
		                React10.createElement("label", { className: "dbm-grid-label", htmlFor: "dbm-op-ai" }, t("tableop.options.autoIncrement")),
		                React10.createElement("input", {
		                  id: "dbm-op-ai",
		                  className: "dbm-input dbm-mono dbm-grid-control",
		                  type: "number",
		                  min: 1,
		                  value: draft.autoIncrement,
		                  disabled: busy,
		                  "data-dbm-op-option": "autoIncrement",
		                  onChange: (event) => setDraft({ ...draft, autoIncrement: event.target.value })
		                })
		              ),
		              // 行格式
		              React10.createElement(
		                "div",
		                { className: "dbm-grid-row" },
		                React10.createElement("label", { className: "dbm-grid-label", htmlFor: "dbm-op-rowformat" }, t("tableop.options.rowFormat")),
		                React10.createElement(
		                  "select",
		                  {
		                    id: "dbm-op-rowformat",
		                    className: "dbm-select dbm-grid-control",
		                    value: draft.rowFormat,
		                    disabled: busy,
		                    "data-dbm-op-option": "rowFormat",
		                    onChange: (event) => setDraft({ ...draft, rowFormat: event.target.value })
		                  },
		                  ...[.../* @__PURE__ */ new Set([draft.rowFormat, ...ROW_FORMATS])].map((value) => React10.createElement("option", { key: value === "" ? "__none__" : value, value }, value === "" ? t("tableop.options.rowFormatDefault") : value))
		                )
		              )
		            ),
		            React10.createElement("span", { className: "dbm-hint" }, t("tableop.options.collationHint")),
		            options.autoIncrement === void 0 ? null : React10.createElement("span", { className: "dbm-hint" }, t("tableop.options.autoIncrementHint")),
		            React10.createElement(
		              "label",
		              { className: "dbm-check" },
		              React10.createElement("input", {
		                type: "checkbox",
		                checked: draft.convert,
		                disabled: busy,
		                "data-dbm-op-option": "convert",
		                onChange: (event) => setDraft({ ...draft, convert: event.target.checked })
		              }),
		              t("tableop.options.convert")
		            ),
		            React10.createElement("span", { className: "dbm-hint" }, t("tableop.options.convertHint")),
		            React10.createElement(
		              "div",
		              { className: "dbm-row" },
		              React10.createElement("button", {
		                type: "button",
		                className: `dbm-btn dbm-btn-primary${busy ? " dbm-btn-busy" : ""}`,
		                disabled: busy,
		                "data-dbm-op-submit": "options",
		                onClick: submitOptions
		              }, busy ? [React10.createElement("span", { key: "spin", className: "dbm-spinner" }), t("tableop.options.busy")] : t("tableop.options.submit"))
		            )
		          )
		        ),
		        React10.createElement("div", { className: "dbm-newtable-sep" }),
		        // ---- 3. 将数据表复制到 --------------------------------------------
		        React10.createElement(
		          "div",
		          { className: "dbm-op-block", "data-dbm-op-block": "copy" },
		          React10.createElement("strong", null, t("tableop.copy.title")),
		          React10.createElement("span", { className: "dbm-hint" }, t("tableop.copy.body")),
		          has("copy") ? [
		            React10.createElement(
		              "div",
		              { key: "target" },
		              React10.createElement(TargetFields, {
		                idPrefix: "copy",
		                schemas,
		                schema: copySchema,
		                table: copyTable,
		                disabled: busy || isView === true,
		                onSchema: setCopySchema,
		                onTable: setCopyTable
		              })
		            ),
		            React10.createElement(
		              "label",
		              { key: "data", className: "dbm-check" },
		              React10.createElement("input", {
		                type: "checkbox",
		                checked: copyData,
		                disabled: busy || isView === true,
		                "data-dbm-op-copy-data": "",
		                onChange: (event) => setCopyData(event.target.checked)
		              }),
		              t("tableop.copy.data")
		            ),
		            React10.createElement("span", { key: "dataHint", className: "dbm-hint" }, t("tableop.copy.dataHint")),
		            React10.createElement(
		              "div",
		              { key: "actions", className: "dbm-row" },
		              React10.createElement("button", {
		                type: "button",
		                className: `dbm-btn${busy ? " dbm-btn-busy" : ""}`,
		                disabled: busy || isView === true,
		                "data-dbm-op-submit": "copy",
		                title: isView === true ? t("tableop.viewHint", { table }) : void 0,
		                onClick: submitCopy
		              }, busy ? [React10.createElement("span", { key: "spin", className: "dbm-spinner" }), t("tableop.copy.busy")] : t("tableop.copy.submit"))
		            )
		          ] : React10.createElement("span", { className: "dbm-hint" }, t("tableop.unsupported.copy"))
		        ),
		        React10.createElement("div", { className: "dbm-newtable-sep" }),
		        // ---- 4. 表维护 ----------------------------------------------------
		        React10.createElement(
		          "div",
		          { className: "dbm-op-block", "data-dbm-op-block": "maintain" },
		          React10.createElement("strong", null, t("tableop.maint.title")),
		          React10.createElement("span", { className: "dbm-hint" }, t("tableop.maint.body")),
		          React10.createElement("div", { className: "dbm-row" }, ...MAINTENANCE_OPS_VIEW.map(maintenance)),
		          engineKind === "sqlite" ? React10.createElement("span", { className: "dbm-hint" }, t("tableop.maint.repairMissing")) : null
		        ),
		        React10.createElement("div", { className: "dbm-newtable-sep" }),
		        // ---- 5. 删除数据或数据表 ------------------------------------------
		        React10.createElement(
		          "div",
		          { className: "dbm-op-block", "data-dbm-op-block": "danger" },
		          React10.createElement("strong", null, t("tableop.danger.title")),
		          React10.createElement("span", { className: "dbm-hint" }, t("tableop.danger.body")),
		          React10.createElement(
		            "div",
		            { className: "dbm-row" },
		            React10.createElement("button", {
		              type: "button",
		              className: "dbm-btn dbm-btn-sm",
		              // A view has no rows of its own, so emptying one is refused with the
		              // reason rather than reported as "0 rows removed".
		              disabled: busy || isView === true,
		              title: isView === true ? t("tableop.danger.viewTruncate", { table }) : t("tableop.danger.truncateHint"),
		              "data-dbm-op-danger": "truncate",
		              onClick: () => onAskDanger("truncate")
		            }, t("tableop.danger.truncate")),
		            React10.createElement("button", {
		              type: "button",
		              className: "dbm-btn dbm-btn-sm dbm-btn-danger",
		              disabled: busy,
		              title: t("tableop.danger.dropHint"),
		              "data-dbm-op-danger": "drop",
		              onClick: () => onAskDanger("drop")
		            }, t("tableop.danger.drop"))
		          )
		        )
		      )
		    )
		  );
		}
		var ENGINES = ["InnoDB", "MyISAM", "MEMORY", "ARCHIVE", "CSV", "BLACKHOLE", "MRG_MYISAM"];
		var COLLATIONS = [
		  "utf8mb4_general_ci",
		  "utf8mb4_unicode_ci",
		  "utf8mb4_0900_ai_ci",
		  "utf8mb4_bin",
		  "utf8_general_ci",
		  "utf8_bin",
		  "latin1_swedish_ci",
		  "latin1_general_ci",
		  "latin1_bin",
		  "ascii_general_ci",
		  "binary"
		];
		var ROW_FORMATS = ["", "DYNAMIC", "COMPACT", "COMPRESSED", "REDUNDANT", "FIXED", "PAGE"];

		// src/client/SqlSearchTab.ts
		var React11 = __toESM(require("react"), 1);
		function firstOperator(column) {
		  return searchOperators(column)[0] ?? "eq";
		}
		function criteriaFrom(filters) {
		  const out = {};
		  for (const filter of filters) {
		    out[filter.column] = {
		      operator: filter.operator,
		      value: filter.value ?? "",
		      value2: filter.value2 ?? ""
		    };
		  }
		  return out;
		}
		function SqlSearchTab(props) {
		  const { columns, filters, loading, total, onSearch, onError, results } = props;
		  const [criteria, setCriteria] = React11.useState(() => criteriaFrom(filters));
		  const resultsRef = React11.useRef(null);
		  const filterKey = JSON.stringify(filters);
		  const lastApplied = React11.useRef(filterKey);
		  React11.useEffect(() => {
		    if (lastApplied.current === filterKey) return;
		    lastApplied.current = filterKey;
		    setCriteria(criteriaFrom(filters));
		  }, [filterKey]);
		  const criterionOf = (column) => criteria[column.name] ?? { operator: firstOperator(column), value: "", value2: "" };
		  const update = (name, patch) => {
		    setCriteria((current) => {
		      const column = columns.find((candidate) => candidate.name === name);
		      const base = current[name] ?? { operator: column === void 0 ? "eq" : firstOperator(column), value: "", value2: "" };
		      return { ...current, [name]: { ...base, ...patch } };
		    });
		  };
		  const isUsed = (column, criterion) => {
		    if (isUnaryOperator(criterion.operator)) return true;
		    if (criterion.operator === "between") return criterion.value.trim() !== "" && criterion.value2.trim() !== "";
		    if (criterion.operator === "in") return criterion.value.split(",").some((member) => member.trim() !== "");
		    return criterion.value.trim() !== "";
		  };
		  const toFilters = () => {
		    const out = [];
		    for (const column of columns) {
		      const criterion = criterionOf(column);
		      if (isUnaryOperator(criterion.operator)) {
		        out.push({ column: column.name, operator: criterion.operator });
		        continue;
		      }
		      if (criterion.operator === "between") {
		        if (criterion.value.trim() === "" && criterion.value2.trim() === "") continue;
		        if (criterion.value.trim() === "" || criterion.value2.trim() === "") {
		          throw new Error(t("search.betweenNeedsBoth", { column: column.name }));
		        }
		        out.push({ column: column.name, operator: "between", value: criterion.value, value2: criterion.value2 });
		        continue;
		      }
		      if (!isUsed(column, criterion)) continue;
		      out.push({ column: column.name, operator: criterion.operator, value: criterion.value });
		    }
		    return out;
		  };
		  const submit = () => {
		    let parsed;
		    try {
		      parsed = toFilters();
		    } catch (failure) {
		      onError(failure instanceof Error ? failure.message : String(failure));
		      return;
		    }
		    onError(void 0);
		    onSearch(parsed);
		    requestAnimationFrame(() => {
		      resultsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		    });
		  };
		  const clear = () => {
		    setCriteria({});
		    onError(void 0);
		    onSearch([]);
		  };
		  const usedCount = columns.filter((column) => isUsed(column, criterionOf(column))).length;
		  const valueControl = (column, criterion) => {
		    if (isUnaryOperator(criterion.operator)) {
		      return React11.createElement("span", { className: "dbm-hint" }, t(`search.op.${criterion.operator}`));
		    }
		    const members = searchValueKind(column);
		    const common = {
		      className: "dbm-input",
		      "data-dbm-search-value": column.name,
		      "aria-label": `${t("search.value")} \u2014 ${column.name}`
		    };
		    const set = (value) => update(column.name, { value });
		    if (members.kind === "members") {
		      return React11.createElement(
		        "select",
		        {
		          className: "dbm-select dbm-search-value",
		          "data-dbm-search-value": column.name,
		          "aria-label": `${t("search.value")} \u2014 ${column.name}`,
		          value: criterion.value,
		          onChange: (event) => set(event.target.value)
		        },
		        [
		          React11.createElement("option", { key: "", value: "" }, ""),
		          ...members.options.map((option) => React11.createElement("option", { key: option, value: option }, option))
		        ]
		      );
		    }
		    return React11.createElement("input", {
		      ...common,
		      value: criterion.value,
		      // A numeric or date column gets the browser's own stepper and picker, which
		      // is what keeps a typed date in the format the engine parses.
		      ...inputHints(column),
		      placeholder: criterion.operator === "between" ? t("search.betweenFrom") : criterion.operator === "in" ? t("search.valuePlaceholder.in") : t("search.valuePlaceholder"),
		      onChange: (event) => set(event.target.value),
		      onKeyDown: (event) => {
		        if (event.key !== "Enter") return;
		        event.preventDefault();
		        submit();
		      }
		    });
		  };
		  if (columns.length === 0) {
		    return React11.createElement("div", { className: "dbm-pad dbm-hint" }, loading ? t("common.loading") : t("search.needStructure"));
		  }
		  return React11.createElement(
		    "div",
		    { className: "dbm-tab-body", "data-dbm-search-page": "" },
		    React11.createElement(
		      "div",
		      { className: "dbm-search-form" },
		      React11.createElement("div", { className: "dbm-hint" }, t("search.qbeHint")),
		      React11.createElement(
		        /*
		         * The field table, shown in FULL: no inner scroll box.
		         *
		         * It used to be a 45%-capped scroll area, which on a 25-column table showed
		         * four rows and hid twenty-one — measured. An inner scrollbar on a list of
		         * fields reads as "these are the fields" rather than "there is more below",
		         * so the user concludes the column they want does not exist. The page scrolls
		         * instead; see the styles for the measurement and for why the 执行 button is
		         * still not inside a box.
		         */
		        "div",
		        { className: "dbm-search-scroll" },
		        React11.createElement(
		          "table",
		          { className: "dbm-table dbm-search-table" },
		          React11.createElement(
		            "thead",
		            null,
		            React11.createElement(
		              "tr",
		              null,
		              ...[
		                t("search.column"),
		                t("search.type"),
		                t("search.collation"),
		                t("search.operator"),
		                t("search.value")
		              ].map((label) => React11.createElement("th", { key: label }, label))
		            )
		          ),
		          React11.createElement(
		            "tbody",
		            null,
		            ...columns.map((column) => {
		              const criterion = criterionOf(column);
		              const operators = searchOperators(column);
		              const used = isUsed(column, criterion);
		              return React11.createElement(
		                "tr",
		                {
		                  key: column.name,
		                  "data-dbm-search-row": column.name,
		                  "data-used": String(used),
		                  "data-dbm-condition": column.name
		                },
		                React11.createElement("th", { scope: "row", className: "dbm-mono" }, column.name),
		                React11.createElement("td", { className: "dbm-mono" }, column.type === "" ? t("common.none") : column.type),
		                React11.createElement("td", { className: "dbm-mono" }, column.collation ?? t("common.none")),
		                React11.createElement(
		                  "td",
		                  null,
		                  React11.createElement(
		                    "select",
		                    {
		                      className: "dbm-select dbm-search-operator",
		                      "data-dbm-search-operator": column.name,
		                      "aria-label": `${t("search.operator")} \u2014 ${column.name}`,
		                      value: criterion.operator,
		                      onChange: (event) => update(column.name, { operator: event.target.value })
		                    },
		                    operators.map((operator) => React11.createElement("option", { key: operator, value: operator }, t(`search.op.${operator}`)))
		                  )
		                ),
		                React11.createElement(
		                  "td",
		                  { className: "dbm-search-value-cell" },
		                  valueControl(column, criterion),
		                  criterion.operator === "between" && !isUnaryOperator(criterion.operator) ? [
		                    React11.createElement("span", { key: "sep", className: "dbm-hint" }, "\u2014"),
		                    React11.createElement("input", {
		                      key: "value2",
		                      className: "dbm-input",
		                      style: { width: 120 },
		                      value: criterion.value2,
		                      "data-dbm-search-value2": column.name,
		                      "aria-label": `${t("search.value2")} \u2014 ${column.name}`,
		                      placeholder: t("search.betweenTo"),
		                      ...inputHints(column),
		                      onChange: (event) => update(column.name, { value2: event.target.value })
		                    })
		                  ] : null
		                )
		              );
		            })
		          )
		        )
		      ),
		      React11.createElement(
		        "div",
		        { className: "dbm-row dbm-search-actions" },
		        React11.createElement("button", {
		          type: "button",
		          className: "dbm-btn dbm-btn-primary",
		          disabled: loading,
		          "data-dbm-search-run": "",
		          onClick: submit
		        }, loading ? t("common.loading") : t("search.run")),
		        React11.createElement("button", {
		          type: "button",
		          className: "dbm-btn",
		          disabled: usedCount === 0,
		          "data-dbm-search-clear": "",
		          onClick: clear
		        }, t("search.reset")),
		        React11.createElement("span", { className: "dbm-spacer" }),
		        usedCount === 0 ? React11.createElement("span", { className: "dbm-hint", "data-dbm-search-note": "all" }, t("search.allRows")) : React11.createElement("span", { className: "dbm-hint" }, t("search.usedCount", { n: usedCount })),
		        total === void 0 ? null : React11.createElement("span", { className: "dbm-hint" }, t("search.matched", { n: total }))
		      ),
		      React11.createElement("div", { className: "dbm-hint" }, t("search.hint"))
		    ),
		    // The result grid, in its own box under the form. The page scrolls as a whole
		    // (see the styles), so the grid only needs a height it can lay rows out in.
		    results === void 0 ? null : React11.createElement("div", { className: "dbm-search-results", ref: resultsRef }, results)
		  );
		}

		// src/client/SqlStructureTab.ts
		var React12 = __toESM(require("react"), 1);

		// src/client/column-defaults.ts
		var DEFAULT_MODES = ["none", "custom", "null", "currentTimestamp"];
		var TEMPORAL_TYPES = /\b(TIMESTAMP|DATETIME)\b/i;
		var NO_LENGTH_TYPES = /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DATE|TIME|TIMESTAMP|DATETIME|YEAR|JSON|BOOLEAN|BOOL|GEOMETRY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT)\b/;
		function takesLength(type) {
		  const upper = type.trim().toUpperCase();
		  if (upper === "") return true;
		  return !NO_LENGTH_TYPES.test(upper);
		}
		var REQUIRES_PARENS_TYPES = /^(VARCHAR|VARBINARY|ENUM|SET)\b/;
		function requiresLengthOrValues(type) {
		  const upper = type.trim().toUpperCase();
		  if (upper === "") return false;
		  if (upper.includes("(")) return false;
		  return REQUIRES_PARENS_TYPES.test(upper);
		}
		function supportsCurrentTimestamp(type) {
		  return TEMPORAL_TYPES.test(type);
		}
		function quoteDefaultLiteral(text) {
		  const trimmed = text.trim();
		  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed;
		  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(trimmed)) return trimmed;
		  return `'${trimmed.replace(/'/g, "''")}'`;
		}
		function defaultToWire(mode, text) {
		  if (mode === "none") return void 0;
		  if (mode === "null") return "NULL";
		  if (mode === "currentTimestamp") return "CURRENT_TIMESTAMP";
		  return quoteDefaultLiteral(text);
		}
		function inferDefault(kind, raw) {
		  if (raw === void 0) return { mode: "none", text: "" };
		  const text = raw.trim();
		  if (text === "") {
		    return kind === "mysql" ? { mode: "custom", text: "" } : { mode: "none", text: "" };
		  }
		  if (/^null$/i.test(text)) return { mode: "null", text: "" };
		  if (/^current_timestamp(\(\d*\))?$/i.test(text)) return { mode: "currentTimestamp", text: "" };
		  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
		    return { mode: "custom", text: text.slice(1, -1).replace(/''/g, "'") };
		  }
		  return { mode: "custom", text };
		}
		var NUMERIC_TYPES = /\b(INT|INTEGER|TINYINT|SMALLINT|MEDIUMINT|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|BIT)\b/i;
		function autoIncrementBlocker(kind, column) {
		  if (column.indexKind !== "primary") return "notKey";
		  if (kind === "sqlite") return column.type.trim().toUpperCase() === "INTEGER" ? void 0 : "notInteger";
		  if (!NUMERIC_TYPES.test(column.type) && !/\bINTEGER\b/i.test(column.type)) return "notNumeric";
		  return void 0;
		}
		function nullDefaultNeedsNullable(kind, nullable, mode) {
		  if (kind === "sqlite") return false;
		  return mode === "null" && !nullable;
		}

		// src/client/SqlStructureTab.ts
		var TYPES = {
		  mysql: [
		    "tinyint",
		    "smallint",
		    "mediumint",
		    "int",
		    "bigint",
		    "decimal(10,2)",
		    "float",
		    "double",
		    "char(1)",
		    "varchar(191)",
		    "text",
		    "mediumtext",
		    "longtext",
		    "binary(16)",
		    "varbinary(255)",
		    "blob",
		    "date",
		    "datetime",
		    "timestamp",
		    "time",
		    "year",
		    "enum()",
		    "set()",
		    "json",
		    "bool"
		  ],
		  sqlite: [
		    "INTEGER",
		    "INT",
		    "BIGINT",
		    "TEXT",
		    "VARCHAR(191)",
		    "REAL",
		    "NUMERIC",
		    "DECIMAL(10,2)",
		    "BLOB",
		    "BOOLEAN",
		    "DATE",
		    "DATETIME",
		    "JSON",
		    ""
		  ]
		};
		function typeOptions(kind) {
		  return TYPES[kind] ?? TYPES["sqlite"];
		}
		function needsRebuild(kind, change) {
		  if (kind !== "sqlite") return false;
		  return change === "alter" || change === "drop" || change === "key";
		}
		function SqlStructureTab(props) {
		  const { api, sourceId, schema, table, kind, columns, indexes, loading, error, onReload, onReloadRows, onNotice, onError } = props;
		  const [editor, setEditor] = React12.useState(void 0);
		  const [confirming, setConfirming] = React12.useState(void 0);
		  const [selected, setSelected] = React12.useState(/* @__PURE__ */ new Set());
		  const [distinct, setDistinct] = React12.useState(void 0);
		  const [keyEditor, setKeyEditor] = React12.useState(void 0);
		  const [indexForm, setIndexForm] = React12.useState(void 0);
		  const [busy, setBusy] = React12.useState(false);
		  React12.useEffect(() => {
		    setSelected(/* @__PURE__ */ new Set());
		    setEditor(void 0);
		    setIndexForm(void 0);
		  }, [table, schema]);
		  const run = async (body, options = {}) => {
		    setBusy(true);
		    try {
		      await api.changeSchema(sourceId, { schema, table, ...body });
		      setConfirming(void 0);
		      setEditor(void 0);
		      setIndexForm(void 0);
		      setKeyEditor(void 0);
		      onNotice(t("structure.done"));
		      onError(void 0);
		      onReload();
		      if (options.rows !== false) onReloadRows();
		    } catch (failure) {
		      setConfirming(void 0);
		      onError(t("db.action.failed", { error: failure instanceof Error ? failure.message : String(failure) }));
		    } finally {
		      setBusy(false);
		    }
		  };
		  const showDistinct = async (column) => {
		    setDistinct({ column });
		    try {
		      const count = await api.distinctCount(sourceId, { schema, table, column });
		      setDistinct({ column, count });
		    } catch (failure) {
		      setDistinct({ column, error: failure instanceof Error ? failure.message : String(failure) });
		    }
		  };
		  const startEdit = (column) => {
		    const seeded = inferDefault(kind, column.defaultValue);
		    setEditor({
		      mode: "edit",
		      original: column.name,
		      default: { ...seeded, opened: seeded },
		      spec: {
		        name: column.name,
		        type: column.type,
		        nullable: column.nullable,
		        // Kept VERBATIM and used only when the user leaves the control alone: the raw
		        // text round-trips exactly, whereas re-rendering it from the mode would turn
		        // an expression default into a string literal. See `submitEditor`.
		        ...column.defaultValue === void 0 ? {} : { defaultValue: column.defaultValue },
		        ...column.comment === void 0 ? {} : { comment: column.comment },
		        ...column.extra !== void 0 && /auto_increment/i.test(column.extra) ? { autoIncrement: true } : {}
		      }
		    });
		  };
		  const startAdd = () => {
		    setEditor({
		      mode: "add",
		      original: "",
		      // A new column starts with no default and nullable: those are the settings that
		      // cannot fail on a table that already holds rows. A NOT NULL column without
		      // a default is refused by both engines when the table is not empty.
		      default: { mode: "none", text: "", opened: { mode: "none", text: "" } },
		      spec: { name: "", type: kind === "sqlite" ? "TEXT" : "varchar(191)", nullable: true }
		    });
		  };
		  const submitEditor = async () => {
		    if (editor === void 0) return;
		    const spec = editor.spec;
		    const name = spec.name.trim();
		    if (name === "") {
		      onError(t("structure.colNameRequired"));
		      return;
		    }
		    const taken = columns.some((column2) => column2.name.toLowerCase() === name.toLowerCase() && column2.name !== editor.original);
		    if (taken) {
		      onError(t("structure.colNameTaken", { name }));
		      return;
		    }
		    const untouched = editor.default.mode === editor.default.opened.mode && editor.default.text === editor.default.opened.text;
		    const raw = spec.defaultValue;
		    const isExpression = raw !== void 0 && /[(]/.test(raw) && !/^'/.test(raw);
		    const defaultValue = untouched && isExpression ? raw : defaultToWire(editor.default.mode, editor.default.text);
		    const column = {
		      ...spec,
		      name,
		      ...defaultValue === void 0 ? { defaultValue: void 0 } : { defaultValue }
		    };
		    const body = editor.mode === "add" ? { action: "addColumn", column } : {
		      action: "alterColumn",
		      column: { ...column, name: editor.original },
		      ...name === editor.original ? {} : { rename: name }
		    };
		    await run(body);
		  };
		  const primaryColumns = columns.filter((column) => column.key === "PRI").sort((a, b) => (a.primaryKeyPosition ?? 0) - (b.primaryKeyPosition ?? 0)).map((column) => column.name);
		  const kindLabel = (column) => {
		    if (column.generated === true) return `${column.key === "" ? "" : column.key + " "}${t("structure.generated")}`.trim();
		    return column.key === "" ? t("common.none") : column.key;
		  };
		  const header = React12.createElement(
		    "tr",
		    null,
		    React12.createElement(
		      "th",
		      { className: "dbm-select-col" },
		      React12.createElement("input", {
		        type: "checkbox",
		        checked: selected.size > 0 && selected.size === columns.filter((column) => column.generated !== true).length,
		        disabled: columns.length === 0,
		        "aria-label": t("structure.select"),
		        onChange: (event) => {
		          if (!event.target.checked) {
		            setSelected(/* @__PURE__ */ new Set());
		            return;
		          }
		          setSelected(new Set(columns.filter((column) => column.generated !== true).map((column) => column.name)));
		        }
		      })
		    ),
		    ...[
		      t("structure.col.name"),
		      t("structure.col.type"),
		      t("structure.col.nullable"),
		      t("structure.col.key"),
		      t("structure.col.default"),
		      t("structure.col.extra"),
		      t("structure.col.distinct"),
		      t("structure.col.comment"),
		      t("structure.col.actions")
		    ].map((label) => React12.createElement("th", { key: label }, label))
		  );
		  const rows = columns.map(
		    (column) => React12.createElement(
		      "tr",
		      { key: column.name, "data-selected": String(selected.has(column.name)) },
		      React12.createElement(
		        "td",
		        { className: "dbm-select-col" },
		        React12.createElement("input", {
		          type: "checkbox",
		          checked: selected.has(column.name),
		          // A generated column's value cannot be supplied, so it is not a
		          // candidate for the operations this selection feeds.
		          disabled: column.generated === true,
		          "aria-label": t("structure.select"),
		          title: column.generated === true ? t("structure.generatedHint") : void 0,
		          onChange: (event) => {
		            setSelected((current) => {
		              const next = new Set(current);
		              if (event.target.checked) next.add(column.name);
		              else next.delete(column.name);
		              return next;
		            });
		          }
		        })
		      ),
		      React12.createElement("td", { className: "dbm-mono" }, column.name),
		      React12.createElement("td", { className: "dbm-mono" }, column.type === "" ? t("common.none") : column.type),
		      React12.createElement("td", null, column.nullable ? t("common.yes") : t("common.no")),
		      React12.createElement(
		        "td",
		        null,
		        kindLabel(column),
		        column.primaryKeyPosition !== void 0 && primaryColumns.length > 1 ? React12.createElement("span", { className: "dbm-key-note" }, ` ${t("structure.keyOrder", { n: column.primaryKeyPosition })}`) : null
		      ),
		      React12.createElement("td", { className: "dbm-mono" }, column.defaultValue ?? t("common.none")),
		      React12.createElement("td", { className: "dbm-mono" }, column.extra ?? t("common.none")),
		      React12.createElement(
		        "td",
		        null,
		        React12.createElement("button", {
		          type: "button",
		          className: "dbm-link",
		          onClick: () => {
		            void showDistinct(column.name);
		          }
		        }, t("structure.col.distinct"))
		      ),
		      React12.createElement("td", null, column.comment ?? ""),
		      React12.createElement(
		        "td",
		        { className: "dbm-row-actions" },
		        React12.createElement(
		          "div",
		          { className: "dbm-actions" },
		          React12.createElement("button", {
		            type: "button",
		            className: "dbm-btn dbm-btn-sm",
		            disabled: busy,
		            // A generated column's definition is not fully reported, so changing
		            // it would lose the expression it is computed from.
		            title: column.generated === true ? t("structure.generatedHint") : void 0,
		            onClick: () => startEdit(column)
		          }, t("structure.edit")),
		          React12.createElement("button", {
		            type: "button",
		            className: "dbm-btn dbm-btn-sm dbm-btn-danger",
		            disabled: busy || columns.length <= 1,
		            onClick: () => setConfirming({ op: "dropColumn", column: column.name, rebuild: needsRebuild(kind, "drop") })
		          }, t("structure.drop")),
		          React12.createElement("button", {
		            type: "button",
		            className: "dbm-btn dbm-btn-sm",
		            disabled: busy || column.generated === true,
		            title: t("structure.unique"),
		            onClick: () => {
		              const current = column.key === "UNI";
		              if (current) {
		                const index = indexes.find((entry) => entry.unique && entry.columns.length === 1 && entry.columns[0] === column.name);
		                if (index === void 0) {
		                  onError(t("structure.refreshFirst"));
		                  return;
		                }
		                void run({ action: "dropIndex", name: index.name }, { rows: false });
		                return;
		              }
		              void run({ action: "createIndex", index: { name: uniqueIndexName(column.name, indexes), columns: [column.name], unique: true } }, { rows: false });
		            }
		          }, `U${column.key === "UNI" ? "\u2713" : ""}`)
		        )
		      )
		    )
		  );
		  const indexHeader = React12.createElement(
		    "tr",
		    null,
		    ...[t("structure.index.name"), t("structure.index.unique"), t("structure.index.columns"), t("structure.index.type"), t("structure.index.actions")].map((label) => React12.createElement("th", { key: label }, label))
		  );
		  const indexRows = indexes.map(
		    (index) => React12.createElement(
		      "tr",
		      { key: index.name },
		      React12.createElement("td", { className: "dbm-mono" }, index.name),
		      React12.createElement("td", null, index.unique ? t("common.yes") : t("common.no")),
		      React12.createElement("td", { className: "dbm-mono" }, index.columns.join(", ")),
		      React12.createElement("td", null, index.primary === true ? t("structure.primaryKey") : index.type ?? t("common.none")),
		      React12.createElement(
		        "td",
		        { className: "dbm-row-actions" },
		        React12.createElement("button", {
		          type: "button",
		          className: "dbm-btn dbm-btn-sm dbm-btn-danger",
		          // The primary key's own index cannot be dropped on its own: dropping
		          // it IS dropping the key, which is what the key editor is for.
		          disabled: busy || index.primary === true,
		          title: index.primary === true ? t("structure.primaryNotDroppable") : void 0,
		          onClick: () => setConfirming({ op: "dropIndex", name: index.name })
		        }, t("structure.drop"))
		      )
		    )
		  );
		  return React12.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React12.createElement(
		      "div",
		      { className: "dbm-scroll" },
		      React12.createElement(
		        "div",
		        { className: "dbm-row", style: { padding: "8px 12px" } },
		        React12.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm dbm-btn-primary", disabled: busy, onClick: startAdd }, `+ ${t("structure.addColumn")}`),
		        React12.createElement("button", {
		          type: "button",
		          className: "dbm-btn dbm-btn-sm",
		          disabled: busy || columns.length === 0,
		          onClick: () => setKeyEditor(primaryColumns)
		        }, t("structure.editKey")),
		        React12.createElement("button", {
		          type: "button",
		          className: "dbm-btn dbm-btn-sm",
		          disabled: busy || columns.length === 0,
		          onClick: () => setIndexForm({ name: "", columns: [], unique: false })
		        }, `+ ${t("structure.addIndex")}`),
		        selected.size === 0 ? null : [
		          React12.createElement("span", { key: "count", className: "dbm-hint" }, t("structure.selected", { n: selected.size })),
		          React12.createElement("button", {
		            key: "drop",
		            type: "button",
		            className: "dbm-btn dbm-btn-sm dbm-btn-danger",
		            disabled: busy,
		            onClick: () => setConfirming({
		              op: "dropColumns",
		              columns: columns.filter((column) => selected.has(column.name)).map((column) => column.name),
		              rebuild: needsRebuild(kind, "drop")
		            })
		          }, t("structure.dropSelected")),
		          React12.createElement("button", {
		            key: "clear",
		            type: "button",
		            className: "dbm-btn dbm-btn-sm",
		            onClick: () => setSelected(/* @__PURE__ */ new Set())
		          }, t("common.cancel"))
		        ],
		        React12.createElement("span", { className: "dbm-spacer" }),
		        React12.createElement(
		          "button",
		          {
		            type: "button",
		            className: `dbm-btn dbm-btn-sm${loading ? " dbm-btn-busy" : ""}`,
		            // Disabled while a READ is running, so a second click cannot stack the
		            // same request. `busy` is a write and is tracked separately: a write
		            // must not disable the refresh control, and a refresh must not look
		            // like a write.
		            disabled: loading,
		            "aria-busy": loading ? "true" : void 0,
		            "data-dbm-structure-refresh": "",
		            onClick: () => {
		              onReload();
		              onReloadRows();
		            }
		          },
		          loading ? [React12.createElement("span", { key: "spin", className: "dbm-spinner" }), t("common.loading")] : t("common.refresh")
		        )
		      ),
		      error === void 0 ? null : React12.createElement(ErrorBanner, { message: error }),
		      editor === void 0 ? null : React12.createElement(ColumnEditor, {
		        key: "editor",
		        editor,
		        kind,
		        columns,
		        busy,
		        onChange: (next) => setEditor({ ...editor, spec: next.spec, default: next.default }),
		        onSubmit: () => {
		          void submitEditor();
		        },
		        onCancel: () => setEditor(void 0),
		        onError
		      }),
		      React12.createElement(
		        "div",
		        { className: "dbm-pad" },
		        React12.createElement("strong", null, `${t("structure.columns")}\uFF08${columns.length}\uFF09`)
		      ),
		      React12.createElement(
		        "table",
		        { className: "dbm-table" },
		        React12.createElement("thead", null, header),
		        React12.createElement("tbody", null, ...rows)
		      ),
		      React12.createElement(
		        "div",
		        { className: "dbm-pad" },
		        React12.createElement("strong", null, `${t("structure.indexes")}\uFF08${indexes.length}\uFF09`)
		      ),
		      indexForm === void 0 ? null : React12.createElement(IndexCreator, {
		        key: "index-form",
		        form: indexForm,
		        columns,
		        indexes,
		        busy,
		        onChange: setIndexForm,
		        onSubmit: () => {
		          const name = indexForm.name.trim();
		          if (name === "") {
		            onError(t("structure.indexNameRequired"));
		            return;
		          }
		          if (indexes.some((index) => index.name.toLowerCase() === name.toLowerCase())) {
		            onError(t("structure.indexNameTaken", { name }));
		            return;
		          }
		          if (indexForm.columns.length === 0) {
		            onError(t("structure.noColumnsSelected"));
		            return;
		          }
		          void run({ action: "createIndex", index: { name, columns: indexForm.columns, unique: indexForm.unique } }, { rows: false });
		        },
		        onCancel: () => setIndexForm(void 0),
		        onError
		      }),
		      indexes.length === 0 ? React12.createElement("div", { className: "dbm-pad dbm-hint" }, t("structure.noIndexes")) : React12.createElement(
		        "table",
		        { className: "dbm-table" },
		        React12.createElement("thead", null, indexHeader),
		        React12.createElement("tbody", null, ...indexRows)
		      ),
		      keyEditor === void 0 ? null : React12.createElement(KeyEditor, {
		        key: "key-editor",
		        columns,
		        order: keyEditor,
		        busy,
		        onChange: setKeyEditor,
		        onSubmit: () => {
		          void run({ action: "setPrimaryKey", columns: keyEditor });
		        },
		        onCancel: () => setKeyEditor(void 0),
		        rebuild: needsRebuild(kind, "key")
		      })
		    ),
		    distinct === void 0 ? null : React12.createElement(Modal, {
		      title: t("structure.distinctTitle"),
		      onClose: () => setDistinct(void 0),
		      footer: [React12.createElement("button", { key: "ok", type: "button", className: "dbm-btn", onClick: () => setDistinct(void 0) }, t("common.close"))],
		      children: React12.createElement(
		        "div",
		        null,
		        distinct.count === void 0 && distinct.error === void 0 ? t("structure.distinctLoading") : distinct.error !== void 0 ? t("structure.distinctFailed", { error: distinct.error }) : t("structure.distinctBody", { column: distinct.column, n: distinct.count ?? 0 })
		      )
		    }),
		    confirming === void 0 ? null : React12.createElement(ConfirmChange, {
		      key: "confirm",
		      confirming,
		      busy,
		      kind,
		      onCancel: () => setConfirming(void 0),
		      onConfirm: () => {
		        if (confirming.op === "dropIndex") {
		          void run({ action: "dropIndex", name: confirming.name }, { rows: false });
		          return;
		        }
		        if (confirming.op === "dropColumn") {
		          void run({ action: "dropColumn", column: confirming.column });
		          return;
		        }
		        void (async () => {
		          for (const column of confirming.columns) {
		            await run({ action: "dropColumn", column }, { rows: false });
		          }
		          setSelected(/* @__PURE__ */ new Set());
		          onReloadRows();
		        })();
		      }
		    })
		  );
		}
		function uniqueIndexName(column, indexes) {
		  const base = `uniq_${column.replace(/[^A-Za-z0-9_]/g, "_")}`;
		  if (!indexes.some((index) => index.name === base)) return base;
		  for (let n = 2; n < 1e3; n++) {
		    const candidate = `${base}_${n}`;
		    if (!indexes.some((index) => index.name === candidate)) return candidate;
		  }
		  return `${base}_${Date.now()}`;
		}
		function ConfirmChange(props) {
		  const { confirming, busy, onCancel, onConfirm } = props;
		  void props.kind;
		  const isIndex = confirming.op === "dropIndex";
		  const isBatch = confirming.op === "dropColumns";
		  const title = isIndex ? t("structure.dropIndexTitle") : isBatch ? t("structure.dropManyTitle") : t("structure.dropTitle");
		  const body = isIndex ? t("structure.dropIndexBody", { name: confirming.name }) : isBatch ? t("structure.dropManyBody", { n: confirming.columns.length }) : t("structure.dropBody", { column: confirming.column });
		  const showRebuild = !isIndex && confirming.rebuild;
		  return React12.createElement(Modal, {
		    title,
		    onClose: onCancel,
		    footer: [
		      React12.createElement("button", { key: "cancel", type: "button", className: "dbm-btn", disabled: busy, onClick: onCancel }, t("common.cancel")),
		      React12.createElement("button", {
		        key: "ok",
		        type: "button",
		        className: "dbm-btn dbm-btn-danger",
		        disabled: busy,
		        onClick: onConfirm
		      }, busy ? t("common.loading") : t("structure.drop"))
		    ],
		    children: React12.createElement(
		      "div",
		      null,
		      React12.createElement("div", null, body),
		      isBatch ? React12.createElement("div", { className: "dbm-hint", style: { marginTop: 8 } }, confirming.columns.join("\u3001")) : null,
		      showRebuild ? React12.createElement("div", { className: "dbm-hint", style: { marginTop: 8 } }, t("structure.dropRebuildNote")) : null
		    )
		  });
		}
		function ColumnEditor(props) {
		  const { editor, kind, columns, busy, onChange, onSubmit, onCancel } = props;
		  const spec = editor.spec;
		  const draft = editor.default;
		  const options = typeOptions(kind);
		  const inList = options.includes(spec.type);
		  const existing = editor.mode === "edit" ? columns.find((column) => column.name === editor.original) : void 0;
		  const patchSpec = (next) => onChange({ spec: { ...spec, ...next }, default: draft });
		  const patchDefault = (next) => onChange({ spec, default: { ...draft, ...next } });
		  const defaultControl = () => {
		    if (draft.mode === "custom") {
		      return React12.createElement(
		        "div",
		        { className: "dbm-type-cell" },
		        React12.createElement("input", {
		          className: "dbm-input dbm-mono",
		          value: draft.text,
		          // Empty IS a real answer in this mode — it means the empty string — so the
		          // placeholder says so rather than showing a "nothing" hint.
		          placeholder: t("createTable.default.emptyString"),
		          "aria-label": t("createTable.default.text"),
		          "data-dbm-column-default-text": "",
		          spellcheck: false,
		          autoFocus: true,
		          onChange: (event) => patchDefault({ text: event.target.value })
		        }),
		        React12.createElement(
		          "button",
		          {
		            type: "button",
		            className: "dbm-btn dbm-btn-sm",
		            title: t("createTable.default.backToList"),
		            "data-dbm-column-default-list": "",
		            onClick: () => patchDefault({ mode: "none" })
		          },
		          "\u21BA"
		        )
		      );
		    }
		    return React12.createElement(
		      "select",
		      {
		        className: "dbm-select",
		        value: draft.mode,
		        "aria-label": t("structure.col.default"),
		        "data-dbm-column-default-mode": "",
		        onChange: (event) => patchDefault({ mode: event.target.value })
		      },
		      ...DEFAULT_MODES.map((mode) => {
		        const label = mode === "none" ? t("common.none") : mode === "custom" ? t("createTable.default.custom") : mode === "null" ? "NULL" : "CURRENT_TIMESTAMP";
		        const disabled = mode === "currentTimestamp" && !supportsCurrentTimestamp(spec.type);
		        return React12.createElement(
		          "option",
		          { key: mode, value: mode, disabled },
		          disabled ? `${label}\uFF08${t("createTable.default.needsTemporal")}\uFF09` : label
		        );
		      })
		    );
		  };
		  const field = (key, label, control, hint) => React12.createElement(
		    "div",
		    { className: "dbm-field", key },
		    React12.createElement("label", { className: "dbm-field-label" }, label),
		    control,
		    hint === void 0 ? null : React12.createElement("div", { className: "dbm-hint" }, hint)
		  );
		  return React12.createElement(Modal, {
		    title: editor.mode === "add" ? t("structure.newColumn") : t("structure.editColumn", { column: editor.original }),
		    onClose: onCancel,
		    footer: [
		      React12.createElement("button", { key: "cancel", type: "button", className: "dbm-btn", disabled: busy, onClick: onCancel }, t("common.cancel")),
		      React12.createElement(
		        "button",
		        {
		          key: "ok",
		          type: "button",
		          className: "dbm-btn dbm-btn-primary",
		          disabled: busy,
		          "data-dbm-column-submit": "",
		          onClick: onSubmit
		        },
		        busy ? t("common.loading") : editor.mode === "add" ? t("structure.addSubmit") : t("structure.saveSubmit")
		      )
		    ],
		    children: React12.createElement(
		      "div",
		      null,
		      field("name", t("structure.colName"), React12.createElement("input", {
		        className: "dbm-input",
		        value: spec.name,
		        "aria-label": t("structure.colName"),
		        "data-dbm-column-name": "",
		        onChange: (event) => patchSpec({ name: event.target.value })
		      })),
		      /*
		       * The type is a LIST plus a text field, not one or the other.
		       *
		       * The list is a convenience: SQLite accepts any type name, and MySQL has more
		       * than a fixed list can hold (decimal(10,2) unsigned, enum('a','b')). So the
		       * text field is always editable and the list fills it in.
		       */
		      field(
		        "type",
		        t("structure.col.type"),
		        React12.createElement(
		          "select",
		          {
		            className: "dbm-select",
		            value: inList ? spec.type : "__other__",
		            "aria-label": t("structure.col.type"),
		            onChange: (event) => {
		              const value = event.target.value;
		              patchSpec({ type: value === "__other__" ? spec.type : value });
		            }
		          },
		          [
		            ...options.map((type) => React12.createElement("option", { key: type === "" ? "__none__" : type, value: type }, type === "" ? t("common.none") : type)),
		            React12.createElement("option", { key: "__other__", value: "__other__" }, t("structure.typeOther"))
		          ]
		        )
		      ),
		      field("typeText", t("structure.typeText"), React12.createElement("input", {
		        className: "dbm-input dbm-mono",
		        value: spec.type,
		        placeholder: t("structure.typeOtherPlaceholder"),
		        "aria-label": t("structure.typeText"),
		        spellcheck: false,
		        "data-dbm-column-type": "",
		        onChange: (event) => patchSpec({ type: event.target.value })
		      })),
		      field(
		        "nullable",
		        t("structure.col.nullable"),
		        React12.createElement(
		          "label",
		          { className: "dbm-check" },
		          React12.createElement("input", {
		            type: "checkbox",
		            checked: spec.nullable,
		            // A primary-key column cannot be nullable in either engine, so the
		            // checkbox is disabled where it would mean nothing.
		            disabled: existing?.primaryKeyPosition !== void 0,
		            onChange: (event) => patchSpec({ nullable: event.target.checked })
		          }),
		          t("structure.col.nullable")
		        ),
		        existing?.primaryKeyPosition === void 0 ? void 0 : t("structure.nullableKeyHint")
		      ),
		      field("default", t("structure.col.default"), defaultControl(), t("structure.defaultHint")),
		      field("comment", t("structure.col.comment"), React12.createElement("input", {
		        className: "dbm-input",
		        value: spec.comment ?? "",
		        placeholder: t("structure.commentPlaceholder"),
		        "aria-label": t("structure.col.comment"),
		        onChange: (event) => patchSpec({ comment: event.target.value })
		      })),
		      editor.mode === "edit" && existing?.generated === true ? React12.createElement("div", { className: "dbm-hint" }, t("structure.generatedHint")) : null
		    )
		  });
		}
		function IndexCreator(props) {
		  const { form, columns, busy, onChange, onSubmit, onCancel } = props;
		  return React12.createElement(Modal, {
		    title: t("structure.addIndex"),
		    onClose: onCancel,
		    footer: [
		      React12.createElement("button", { key: "cancel", type: "button", className: "dbm-btn", disabled: busy, onClick: onCancel }, t("common.cancel")),
		      React12.createElement(
		        "button",
		        { key: "ok", type: "button", className: "dbm-btn dbm-btn-primary", disabled: busy, "data-dbm-index-submit": "", onClick: onSubmit },
		        busy ? t("common.loading") : t("structure.createIndex")
		      )
		    ],
		    children: React12.createElement(
		      "div",
		      null,
		      React12.createElement(
		        "div",
		        { className: "dbm-field" },
		        React12.createElement("label", { className: "dbm-field-label" }, t("structure.indexName")),
		        React12.createElement("input", {
		          className: "dbm-input",
		          value: form.name,
		          "aria-label": t("structure.indexName"),
		          "data-dbm-index-name": "",
		          onChange: (event) => onChange({ ...form, name: event.target.value })
		        })
		      ),
		      React12.createElement(
		        "div",
		        { className: "dbm-field" },
		        React12.createElement("label", { className: "dbm-field-label" }, t("structure.indexColumns")),
		        React12.createElement(
		          "div",
		          { className: "dbm-column-picker" },
		          ...columns.map((column, position) => {
		            const at = form.columns.indexOf(column.name);
		            return React12.createElement(
		              "label",
		              { key: column.name, className: "dbm-check dbm-column-picker-row" },
		              React12.createElement("input", {
		                type: "checkbox",
		                checked: at !== -1,
		                "data-dbm-index-column": column.name,
		                onChange: (event) => {
		                  const next = form.columns.filter((name) => name !== column.name);
		                  if (event.target.checked) next.push(column.name);
		                  onChange({ ...form, columns: next });
		                }
		              }),
		              React12.createElement("span", { className: "dbm-column-order" }, at === -1 ? "" : String(at + 1)),
		              React12.createElement("span", { className: "dbm-mono" }, column.name),
		              React12.createElement("span", { className: "dbm-hint" }, column.type === "" ? "" : column.type),
		              void position
		            );
		          })
		        ),
		        React12.createElement("div", { className: "dbm-hint" }, t("structure.indexColumnsHint"))
		      ),
		      React12.createElement(
		        "div",
		        { className: "dbm-field" },
		        React12.createElement(
		          "label",
		          { className: "dbm-check" },
		          React12.createElement("input", {
		            type: "checkbox",
		            checked: form.unique,
		            onChange: (event) => onChange({ ...form, unique: event.target.checked })
		          }),
		          t("structure.indexUnique")
		        )
		      ),
		      form.columns.length === 0 ? null : React12.createElement("div", { className: "dbm-hint" }, `${t("structure.indexOrderPreview")}: ${form.columns.join(", ")}`)
		    )
		  });
		}
		function KeyEditor(props) {
		  const { columns, order, busy, rebuild, onChange, onSubmit, onCancel } = props;
		  return React12.createElement(Modal, {
		    title: t("structure.keyTitle"),
		    onClose: onCancel,
		    footer: [
		      React12.createElement("button", { key: "cancel", type: "button", className: "dbm-btn", disabled: busy, onClick: onCancel }, t("common.cancel")),
		      React12.createElement(
		        "button",
		        { key: "ok", type: "button", className: "dbm-btn dbm-btn-primary", disabled: busy, onClick: onSubmit },
		        busy ? t("common.loading") : t("structure.keySave")
		      )
		    ],
		    children: React12.createElement(
		      "div",
		      null,
		      React12.createElement("div", { className: "dbm-hint" }, t("structure.keyBody")),
		      ...columns.map((column) => {
		        const at = order.indexOf(column.name);
		        return React12.createElement(
		          "label",
		          { key: column.name, className: "dbm-check", style: { display: "flex", marginTop: 6 } },
		          React12.createElement("input", {
		            type: "checkbox",
		            checked: at !== -1,
		            // A generated column can take part in a key in MySQL but not in
		            // SQLite, and the difference is the engine's to enforce; the panel
		            // offers every column and reports the refusal.
		            onChange: (event) => {
		              const next = order.filter((name) => name !== column.name);
		              if (event.target.checked) next.push(column.name);
		              onChange(next);
		            }
		          }),
		          React12.createElement("span", { className: "dbm-mono" }, column.name),
		          React12.createElement("span", { className: "dbm-hint" }, ` ${column.type}`),
		          at === -1 ? null : React12.createElement("span", { className: "dbm-key-note" }, ` \u2014 ${t("structure.keyOrder", { n: at + 1 })}`)
		        );
		      }),
		      rebuild ? React12.createElement("div", { className: "dbm-hint", style: { marginTop: 10 } }, t("structure.dropRebuildNote")) : null
		    )
		  });
		}

		// src/client/SqlTableActions.ts
		var React13 = __toESM(require("react"), 1);
		function TableBatchBar(props) {
		  const { selected, tables, busy, support, engineKind, onExport, onTruncate, onDrop, onMaintain, onClear, allSelected, onToggleAll } = props;
		  if (selected.length === 0) return null;
		  const selectedTables = tables.filter((table) => selected.includes(table.name));
		  const hasView = selectedTables.some((table) => table.type === "view");
		  const maintenance = (op) => {
		    const supported = support.includes(op);
		    return React13.createElement(
		      "button",
		      {
		        key: op,
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        // Rendered even when unsupported, but disabled and carrying the reason. All
		        // four were asked for in the batch bar, so REMOVING one would leave a user
		        // looking for a control that is not there; a disabled button whose tooltip
		        // names the engine's limit answers the question instead.
		        disabled: busy || !supported,
		        title: supported ? t(`db.maint.${op}.hint`) : t("db.maint.unsupported"),
		        "data-dbm-maint": op,
		        "data-dbm-maint-supported": supported ? "true" : "false",
		        onClick: () => onMaintain(op)
		      },
		      t(`db.maint.${op}`)
		    );
		  };
		  return React13.createElement(
		    "div",
		    { className: "dbm-batch-bar", "data-dbm-table-batch": "" },
		    React13.createElement("span", null, t("db.selectedCount", { n: selected.length })),
		    React13.createElement(
		      "label",
		      { className: "dbm-check" },
		      React13.createElement("input", {
		        type: "checkbox",
		        checked: allSelected,
		        "aria-label": allSelected ? t("db.selectNone") : t("db.selectAll"),
		        onChange: (event) => onToggleAll(event.target.checked)
		      }),
		      allSelected ? t("db.selectNone") : t("db.selectAll")
		    ),
		    React13.createElement("span", { className: "dbm-batch-sep" }),
		    React13.createElement(
		      "button",
		      { type: "button", className: "dbm-btn dbm-btn-sm", disabled: busy, "data-dbm-batch": "export", onClick: onExport },
		      t("db.batch.export")
		    ),
		    // 清空 is offered but disabled when every selected object is a view: a view has
		    // no rows of its own, so there is nothing to empty and the dialog would have to
		    // say so after the click.
		    React13.createElement(
		      "button",
		      {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        disabled: busy || selectedTables.every((table) => table.type === "view"),
		        title: hasView ? t("db.batch.truncateSkipped", { n: selectedTables.filter((table) => table.type === "view").length }) : void 0,
		        "data-dbm-batch": "truncate",
		        onClick: onTruncate
		      },
		      t("db.batch.truncate")
		    ),
		    React13.createElement("span", { className: "dbm-batch-sep" }),
		    ...MAINTENANCE_OPS_VIEW.map(maintenance),
		    // `repair` absent from the engine's list is explained where the user is looking,
		    // rather than left as a mystery: a disabled button with no reason reads as a bug.
		    engineKind === "sqlite" ? React13.createElement("span", { className: "dbm-hint" }, t("db.maint.repairMissing")) : null,
		    React13.createElement("span", { className: "dbm-spacer" }),
		    React13.createElement(
		      "button",
		      { type: "button", className: "dbm-btn dbm-btn-sm dbm-btn-danger", disabled: busy, "data-dbm-batch": "drop", onClick: onDrop },
		      t("db.batch.drop")
		    ),
		    React13.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", disabled: busy, onClick: onClear }, t("common.cancel"))
		  );
		}
		function DatabaseActionDialog(props) {
		  const { api, sourceId, engineKind, schema, schemas, action, busy, onClose, onDone, onError, onBusy } = props;
		  const isSqlite = engineKind === "sqlite";
		  const [name, setName] = React13.useState("");
		  const [charset, setCharset] = React13.useState("");
		  const [collate, setCollate] = React13.useState("");
		  const [includeData, setIncludeData] = React13.useState(true);
		  const [confirmText, setConfirmText] = React13.useState("");
		  const [charsets, setCharsets] = React13.useState([]);
		  const [defaultCollations, setDefaultCollations] = React13.useState({});
		  const [collationsByCharset, setCollationsByCharset] = React13.useState({});
		  const [collationsLoaded, setCollationsLoaded] = React13.useState(false);
		  React13.useEffect(() => {
		    if (action !== "charset" && action !== "create") return;
		    let live = true;
		    const load = async () => {
		      try {
		        const sets = await api.runSql(sourceId, { sql: "SHOW CHARACTER SET", limit: 500 });
		        if (!live) return;
		        const names = [];
		        const defaults = {};
		        for (const row of sets.rows) {
		          const charsetName = row[0] === void 0 ? "" : String(row[0]);
		          if (charsetName === "") continue;
		          names.push(charsetName);
		          const fallback = row[2] === void 0 ? "" : String(row[2]);
		          if (fallback !== "") defaults[charsetName] = fallback;
		        }
		        setCharsets(names);
		        setDefaultCollations(defaults);
		      } catch {
		      }
		      try {
		        const collations = await api.runSql(sourceId, { sql: "SHOW COLLATION", limit: 2e3 });
		        if (!live) return;
		        const grouped = {};
		        for (const row of collations.rows) {
		          const collationName = row[0] === void 0 ? "" : String(row[0]);
		          const charsetName = row[1] === void 0 ? "" : String(row[1]);
		          if (collationName === "" || charsetName === "") continue;
		          (grouped[charsetName] ??= []).push(collationName);
		        }
		        setCollationsByCharset(grouped);
		      } catch {
		      } finally {
		        if (live) setCollationsLoaded(true);
		      }
		    };
		    void load();
		    return () => {
		      live = false;
		    };
		  }, [api, sourceId, action]);
		  const collationChoices = React13.useMemo(
		    () => charset === "" ? [] : collationsByCharset[charset] ?? [],
		    [charset, collationsByCharset]
		  );
		  const [currentDefaults, setCurrentDefaults] = React13.useState(void 0);
		  React13.useEffect(() => {
		    if (collationChoices.length === 0) return;
		    if (currentDefaults !== void 0 && collate === currentDefaults.collate) return;
		    if (collationChoices.includes(collate)) return;
		    setCollate(defaultCollations[charset] ?? "");
		  }, [charset, collationChoices, collate, defaultCollations, currentDefaults]);
		  React13.useEffect(() => {
		    if (action !== "charset" || isSqlite) return;
		    if (schema === void 0 || schema === "") return;
		    let live = true;
		    const escaped = schema.replaceAll("'", "''");
		    void api.runSql(sourceId, {
		      sql: `SELECT DEFAULT_CHARACTER_SET_NAME AS cs, DEFAULT_COLLATION_NAME AS co FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '${escaped}'`,
		      limit: 1
		    }).then((result) => {
		      if (!live) return;
		      const row = result.rows[0];
		      if (row === void 0) return;
		      const charsetName = row[0] === void 0 ? "" : String(row[0]);
		      const collationName = row[1] === void 0 ? "" : String(row[1]);
		      if (charsetName === "") return;
		      setCurrentDefaults({ charset: charsetName, collate: collationName });
		      setCharset((current) => current === "" ? charsetName : current);
		      setCollate((current) => current === "" ? collationName : current);
		    }).catch(() => {
		    });
		    return () => {
		      live = false;
		    };
		  }, [api, sourceId, action, schema, isSqlite]);
		  const charsetUnsupported = action === "charset" && isSqlite;
		  const title = action === "create" ? t("db.op.createTitle") : action === "rename" ? t("db.op.renameTitle", { from: schema ?? "" }) : action === "copy" ? t("db.op.copyTitle", { from: schema ?? "" }) : action === "drop" ? t("db.op.dropTitle", { from: schema ?? "" }) : t("db.op.charsetTitle", { from: schema ?? "" });
		  const submit = async () => {
		    const trimmed = name.trim();
		    if (action !== "drop" && action !== "charset") {
		      if (trimmed === "") {
		        onError(t("db.op.nameRequired"));
		        return;
		      }
		      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
		        onError(t("db.op.nameInvalid"));
		        return;
		      }
		      if (schemas.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
		        onError(t("db.op.nameTaken"));
		        return;
		      }
		    }
		    if (action === "drop" && confirmText.trim() !== (schema ?? "")) {
		      onError(t("db.op.dropConfirm", { from: schema ?? "" }));
		      return;
		    }
		    const op = action === "charset" && isSqlite ? void 0 : action;
		    if (op === void 0) {
		      onError(t("db.op.charsetNoSqlite"));
		      return;
		    }
		    onBusy(true);
		    try {
		      await api.databaseOperation(sourceId, {
		        op,
		        name: action === "drop" || action === "charset" ? schema ?? "" : trimmed,
		        ...action === "rename" || action === "copy" || action === "drop" || action === "charset" ? { from: schema ?? "" } : {},
		        ...charset === "" ? {} : { charset },
		        ...collate === "" ? {} : { collate },
		        ...action === "copy" ? { includeData } : {}
		      });
		      const reportName = action === "drop" || action === "charset" ? schema ?? "" : trimmed;
		      onDone(t(`db.op.done.${action}`, { name: reportName }), {
		        stale: action === "create" ? [] : action === "drop" || action === "charset" ? [schema ?? ""] : [schema ?? "", trimmed],
		        nowOpen: action === "drop" ? void 0 : action === "charset" ? schema ?? "" : trimmed
		      });
		      onError("");
		    } catch (failure) {
		      onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      onBusy(false);
		    }
		  };
		  const body = charsetUnsupported ? React13.createElement("div", { className: "dbm-hint" }, t("db.op.charsetNoSqlite")) : React13.createElement(
		    "div",
		    null,
		    React13.createElement("div", { className: "dbm-hint" }, t(action === "create" ? "db.op.createBody" : action === "rename" ? "db.op.renameBody" : action === "copy" ? "db.op.copyBody" : action === "drop" ? "db.op.dropBody" : "db.op.charsetBody")),
		    /*
		     * The database's current values, stated explicitly.
		     *
		     * The fields below are pre-filled from them, and saying so makes the prefill
		     * trustworthy: a value that appeared in a form with no explanation looks like a
		     * default rather than the database's actual setting.
		     */
		    action === "charset" && currentDefaults !== void 0 ? React13.createElement(
		      "div",
		      { className: "dbm-hint dbm-mono", "data-dbm-dbop-current": "" },
		      t("db.op.charsetCurrent", { charset: currentDefaults.charset, collate: currentDefaults.collate })
		    ) : null,
		    React13.createElement(
		      "div",
		      { className: "dbm-field" },
		      React13.createElement("label", { className: "dbm-field-label" }, t(action === "rename" ? "db.op.newName" : "db.op.name")),
		      React13.createElement("input", {
		        className: "dbm-input dbm-mono",
		        value: name,
		        "data-dbm-dbop-name": "",
		        placeholder: action === "create" ? "my_new_database" : schema ?? "",
		        autoFocus: action === "create" || action === "rename" || action === "copy",
		        onChange: (event) => setName(event.target.value)
		      }),
		      action === "rename" ? React13.createElement("div", { className: "dbm-hint" }, `\u2190 ${schema ?? ""}`) : null
		    ),
		    action === "create" || action === "charset" ? React13.createElement(
		      "div",
		      { className: "dbm-field" },
		      React13.createElement("label", { className: "dbm-field-label" }, t("db.op.charset")),
		      charsets.length === 0 ? React13.createElement("input", {
		        className: "dbm-input dbm-mono",
		        value: charset,
		        placeholder: "utf8mb4",
		        "data-dbm-dbop-charset": "",
		        onChange: (event) => setCharset(event.target.value)
		      }) : React13.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: charset,
		          "data-dbm-dbop-charset": "",
		          onChange: (event) => setCharset(event.target.value)
		        },
		        [React13.createElement("option", { key: "", value: "" }, t("common.none")), ...charsets.map((value) => React13.createElement("option", { key: value, value }, value))]
		      )
		    ) : null,
		    /*
		     * The collation is a LIST OF THE CHOSEN CHARACTER SET'S OWN COLLATIONS.
		     *
		     * It was a free-text field, which made an invalid pair easy to submit: a
		     * collation belongs to exactly one character set, and MySQL rejects a mismatch
		     * ("COLLATION 'utf8mb4_general_ci' is not valid for CHARACTER SET 'latin1'").
		     * Offering only the ones that belong to the chosen set removes the possibility
		     * rather than reporting it after the fact.
		     *
		     * Empty until a character set is chosen, because "which collations" has no
		     * answer without one. When the server's list could not be read, the field falls
		     * back to free text so the dialog stays usable.
		     */
		    action === "create" || action === "charset" ? React13.createElement(
		      "div",
		      { className: "dbm-field" },
		      React13.createElement("label", { className: "dbm-field-label" }, t("db.op.collate")),
		      collationChoices.length > 0 ? React13.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: collate,
		          "data-dbm-dbop-collate": "",
		          onChange: (event) => setCollate(event.target.value)
		        },
		        [
		          React13.createElement("option", { key: "", value: "" }, t("db.op.collateDefault")),
		          ...collationChoices.map((value) => React13.createElement(
		            "option",
		            { key: value, value },
		            value === defaultCollations[charset] ? `${value} ${t("db.op.collateIsDefault")}` : value
		          ))
		        ]
		      ) : React13.createElement("input", {
		        className: "dbm-input dbm-mono",
		        value: collate,
		        // Disabled while no character set is chosen: typing a collation
		        // before knowing its set is exactly the mismatch this removes.
		        disabled: charset === "",
		        placeholder: charset === "" ? t("db.op.collateNeedsCharset") : "utf8mb4_general_ci",
		        "data-dbm-dbop-collate": "",
		        onChange: (event) => setCollate(event.target.value)
		      }),
		      React13.createElement(
		        "div",
		        { className: "dbm-hint" },
		        charset === "" ? t("db.op.collateNeedsCharset") : collationChoices.length > 0 ? t("db.op.collateHint", { charset, n: collationChoices.length }) : t("db.op.collateUnavailable")
		      )
		    ) : null,
		    action === "copy" ? React13.createElement(
		      "label",
		      { className: "dbm-check" },
		      React13.createElement("input", {
		        type: "checkbox",
		        checked: includeData,
		        onChange: (event) => setIncludeData(event.target.checked)
		      }),
		      t("db.op.copyData")
		    ) : null,
		    action === "drop" ? React13.createElement(
		      "div",
		      { className: "dbm-field" },
		      React13.createElement("label", { className: "dbm-field-label" }, t("db.op.dropConfirm", { from: schema ?? "" })),
		      React13.createElement("input", {
		        className: "dbm-input dbm-mono",
		        value: confirmText,
		        "data-dbm-dbop-confirm": "",
		        autoFocus: true,
		        onChange: (event) => setConfirmText(event.target.value)
		      })
		    ) : null
		  );
		  const destructive = action === "drop";
		  return React13.createElement(Modal, {
		    title,
		    onClose: busy ? () => {
		    } : onClose,
		    footer: [
		      React13.createElement("button", { key: "cancel", type: "button", className: "dbm-btn", disabled: busy, onClick: onClose }, t("common.cancel")),
		      React13.createElement(
		        "button",
		        {
		          key: "ok",
		          type: "button",
		          className: `dbm-btn dbm-btn-primary${destructive ? " dbm-btn-danger" : ""}${busy ? " dbm-btn-busy" : ""}`,
		          disabled: busy || charsetUnsupported,
		          "aria-busy": busy ? "true" : void 0,
		          "data-dbm-dbop-submit": "",
		          onClick: () => {
		            void submit();
		          }
		        },
		        /*
		         * A SPINNER, not just different words.
		         *
		         * Measured: the busy state is set and the button is disabled, so the feedback
		         * was honest — but the only change was the label, and a rename of a large
		         * database moves every table in one statement, which can run for a long time.
		         * A label that changed once and then sits still for a minute reads as a hang;
		         * the spinner keeps saying "still working".
		         */
		        busy ? [React13.createElement("span", { key: "spin", className: "dbm-spinner" }), t("db.op.busy")] : t("db.op.submit")
		      )
		    ],
		    children: body
		  });
		}
		function MaintenanceReportDialog(props) {
		  const { outcomes, running, op, engineKind, onClose } = props;
		  const ok = outcomes.filter((outcome) => outcome.ok).length;
		  const failed = outcomes.length - ok;
		  return React13.createElement(Modal, {
		    title: t("db.maint.title"),
		    onClose: running ? () => {
		    } : onClose,
		    footer: [
		      React13.createElement("button", { key: "close", type: "button", className: "dbm-btn", disabled: running, onClick: onClose }, t("common.close"))
		    ],
		    children: running ? React13.createElement(
		      "div",
		      { className: "dbm-row" },
		      React13.createElement("span", { className: "dbm-spinner" }),
		      // The operation's own in-progress phrase: interpolating the operation's NAME
		      // produced 正在执行 检查…, which reads as a form being filled in.
		      React13.createElement("span", null, t(`db.maint.running.${op ?? "check"}`))
		    ) : React13.createElement(
		      "div",
		      null,
		      outcomes.length === 0 ? React13.createElement(ErrorBanner, { message: t("common.error", { error: "\u2014" }) }) : React13.createElement("div", { className: "dbm-ok" }, t("db.maint.resultCount", { n: outcomes.length, ok, failed })),
		      // SQLite's maintenance acts on the whole file, which the user must know to
		      // read the per-table lines correctly.
		      engineKind === "sqlite" ? React13.createElement("div", { className: "dbm-hint" }, t("db.maint.scopeWholeDb")) : null,
		      React13.createElement(
		        "div",
		        { className: "dbm-maint-report" },
		        ...outcomes.map((outcome) => React13.createElement(
		          "div",
		          { key: `${outcome.op}-${outcome.table}`, className: "dbm-maint-entry" },
		          React13.createElement(
		            "div",
		            { className: "dbm-row" },
		            React13.createElement("span", { className: `dbm-badge${outcome.ok ? " dbm-badge-ok" : " dbm-badge-err"}` }, outcome.ok ? t("common.yes") : t("common.no")),
		            React13.createElement("strong", { className: "dbm-mono" }, outcome.table)
		          ),
		          ...outcome.messages.map((message, index) => React13.createElement("div", { key: index, className: "dbm-hint dbm-mono" }, message))
		        ))
		      )
		    )
		  });
		}

		// src/client/CreateTableDialog.ts
		var React14 = __toESM(require("react"), 1);
		var TYPE_GROUPS = {
		  mysql: [
		    { label: "createTable.group.integer", types: ["TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT"] },
		    { label: "createTable.group.float", types: ["FLOAT", "DOUBLE", "DECIMAL"] },
		    { label: "createTable.group.string", types: ["CHAR", "VARCHAR", "TINYTEXT", "TEXT", "MEDIUMTEXT", "LONGTEXT", "ENUM", "SET", "JSON"] },
		    { label: "createTable.group.binary", types: ["BIT", "BINARY", "VARBINARY", "TINYBLOB", "BLOB", "MEDIUMBLOB", "LONGBLOB"] },
		    { label: "createTable.group.temporal", types: ["DATE", "TIME", "DATETIME", "TIMESTAMP", "YEAR"] },
		    { label: "createTable.group.spatial", types: ["GEOMETRY", "POINT", "LINESTRING", "POLYGON", "MULTIPOINT", "MULTILINESTRING", "MULTIPOLYGON", "GEOMETRYCOLLECTION"] }
		  ],
		  /*
		   * SQLite has no type system — a type name is an affinity hint — so these are the
		   * conventional names rather than an exhaustive set. Writing a length into the type
		   * (`VARCHAR(20)`) is the normal thing to do there, so a couple of those are listed.
		   */
		  sqlite: [
		    { label: "createTable.group.integer", types: ["INTEGER", "INT", "TINYINT", "SMALLINT", "BIGINT"] },
		    { label: "createTable.group.float", types: ["REAL", "DOUBLE", "FLOAT", "NUMERIC", "DECIMAL"] },
		    { label: "createTable.group.string", types: ["TEXT", "VARCHAR(255)", "CHAR(1)", "CLOB"] },
		    { label: "createTable.group.binary", types: ["BLOB"] },
		    { label: "createTable.group.temporal", types: ["DATE", "DATETIME", "TIMESTAMP", "TIME"] },
		    { label: "createTable.group.other", types: ["BOOLEAN"] }
		  ]
		};
		var ATTRIBUTE_ITEMS = [
		  { id: "unsigned", label: "UNSIGNED" },
		  { id: "zerofill", label: "ZEROFILL" },
		  { id: "binary", label: "BINARY" },
		  { id: "onUpdateCurrentTimestamp", label: "ON UPDATE CURRENT_TIMESTAMP" }
		];
		var COLLATIONS2 = {
		  mysql: [
		    "",
		    "utf8mb4_general_ci",
		    "utf8mb4_unicode_ci",
		    "utf8mb4_0900_ai_ci",
		    "utf8mb4_bin",
		    "utf8_general_ci",
		    "utf8_bin",
		    "latin1_swedish_ci",
		    "latin1_general_ci",
		    "latin1_bin",
		    "ascii_general_ci",
		    "binary"
		  ],
		  // SQLite's built-in collations. A different vocabulary from MySQL's on purpose: these
		  // are the only ones it has without an application-registered collation.
		  sqlite: ["", "BINARY", "NOCASE", "RTRIM"]
		};
		var ENGINES2 = ["InnoDB", "MyISAM", "MEMORY", "ARCHIVE", "CSV", "BLACKHOLE", "MRG_MYISAM"];
		var FULLTEXT_TYPES = /\b(CHAR|VARCHAR|TEXT)\b/i;
		var SPATIAL_TYPES = /\b(GEOMETRY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\b/i;
		var NUMERIC_TYPES2 = /\b(INT|INTEGER|TINYINT|SMALLINT|MEDIUMINT|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|BIT)\b/i;
		var STRING_TYPES = /\b(CHAR|VARCHAR|TEXT|BLOB|BINARY|VARBINARY|ENUM|SET)\b/i;
		var TEMPORAL_TYPES2 = /\b(TIMESTAMP|DATETIME)\b/i;
		var nextRowId = 1;
		var blank = (kind, first) => ({
		  id: nextRowId++,
		  name: first ? "id" : "",
		  /*
		   * SQLite spells the same idea INTEGER. `INT` is also an accepted type name there, but
		   * INTEGER is the affinity it actually acts on (and the only one AUTOINCREMENT works
		   * with), so the suggestion matches the engine rather than the MySQL habit.
		   */
		  type: kind === "sqlite" ? "INTEGER" : "INT",
		  // Empty, NOT '255'. The value is the user's to type; '255' lives in the placeholder.
		  length: "",
		  collate: "",
		  attributes: [],
		  // Unchecked: a new column is NOT NULL until the user says otherwise.
		  nullable: false,
		  // No default: that is what an empty field produced before, and it is the common case.
		  defaultMode: "none",
		  defaultText: "",
		  // Only the first column starts as an auto-increment key: that is the shape almost
		  // every table wants, so starting from it saves two clicks every time.
		  autoIncrement: first,
		  comment: "",
		  indexKind: first ? "primary" : "",
		  indexName: ""
		});
		function autoIncrementTakenBy(columns, self) {
		  return columns.find((column) => column.id !== self.id && column.autoIncrement);
		}
		function autoIncrementAllowed(kind, column) {
		  return autoIncrementBlocker(kind, column) === void 0;
		}
		function CreateTableDialog(props) {
		  const { api, sourceId, schema, kind, existingTables, onClose, onCreated } = props;
		  const isSqlite = kind === "sqlite";
		  const collationList = COLLATIONS2[kind] ?? COLLATIONS2.mysql;
		  const [name, setName] = React14.useState("");
		  const [columns, setColumns] = React14.useState(() => [blank(kind, true)]);
		  const [tableComment, setTableComment] = React14.useState("");
		  const [tableCollate, setTableCollate] = React14.useState("");
		  const [tableEngine, setTableEngine] = React14.useState(isSqlite ? "" : "InnoDB");
		  const [withoutRowid, setWithoutRowid] = React14.useState(false);
		  const [strict, setStrict] = React14.useState(false);
		  const [busy, setBusy] = React14.useState(false);
		  const [localError, setLocalError] = React14.useState(void 0);
		  const patch = (id, next) => {
		    setColumns((current) => current.map((column) => column.id === id ? { ...column, ...next } : column));
		  };
		  const addRow = () => {
		    setColumns((current) => [...current, { ...blank(kind, false), id: nextRowId++ }]);
		  };
		  const removeRow = (id) => {
		    setColumns((current) => {
		      if (current.length <= 1) return current;
		      return current.filter((column) => column.id !== id);
		    });
		  };
		  const attributeAvailable = (attribute, column) => {
		    if (isSqlite) return false;
		    switch (attribute) {
		      case "unsigned":
		      case "zerofill":
		        return NUMERIC_TYPES2.test(column.type);
		      case "binary":
		        return STRING_TYPES.test(column.type);
		      case "onUpdateCurrentTimestamp":
		        return TEMPORAL_TYPES2.test(column.type);
		      default:
		        return false;
		    }
		  };
		  const indexKindAvailable = (indexKind, column) => {
		    if (indexKind === "fulltext") return !isSqlite && FULLTEXT_TYPES.test(column.type);
		    if (indexKind === "spatial") return !isSqlite && SPATIAL_TYPES.test(column.type) && !column.nullable;
		    return true;
		  };
		  const build = () => {
		    const tableName = name.trim();
		    if (tableName === "") return { error: t("createTable.nameRequired") };
		    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(tableName)) return { error: t("createTable.nameInvalid") };
		    if (existingTables.some((existing) => existing.toLowerCase() === tableName.toLowerCase())) {
		      return { error: t("createTable.nameTaken", { table: tableName }) };
		    }
		    const specs = [];
		    const key = [];
		    const seen = /* @__PURE__ */ new Set();
		    for (const [index, column] of columns.entries()) {
		      const columnName = column.name.trim();
		      const position = index + 1;
		      if (columnName === "") return { error: t("createTable.columnNameRequired", { n: position }) };
		      if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(columnName)) return { error: t("createTable.columnNameInvalid", { name: columnName }) };
		      if (seen.has(columnName.toLowerCase())) return { error: t("createTable.columnDuplicated", { name: columnName }) };
		      seen.add(columnName.toLowerCase());
		      if (column.type.trim() === "") return { error: t("createTable.columnTypeRequired", { name: columnName }) };
		      for (const attribute of column.attributes) {
		        if (!attributeAvailable(attribute, column)) {
		          return { error: t("createTable.attributeNotForType", { name: columnName, type: column.type }) };
		        }
		      }
		      if (isSqlite && column.length.trim() !== "") {
		        return { error: t("createTable.sqliteNoLength", { name: columnName }) };
		      }
		      if (isSqlite && column.comment.trim() !== "") {
		        return { error: t("createTable.sqliteNoComment", { name: columnName }) };
		      }
		      if (column.length.trim() !== "" && !/^[0-9]{1,10}(\s*,\s*[0-9]{1,10})?$/.test(column.length.trim())) {
		        if (!/^'([^'\\]|'')*'(\s*,\s*'([^'\\]|'')*')*$/.test(column.length.trim())) {
		          return { error: t("createTable.lengthInvalid", { name: columnName }) };
		        }
		      }
		      if (!isSqlite && requiresLengthOrValues(column.type) && column.length.trim() === "") {
		        return { error: t("createTable.lengthRequired", { name: columnName, type: column.type.trim() }) };
		      }
		      const defaultValue = defaultToWire(column.defaultMode, column.defaultText);
		      const autoIncrement = column.autoIncrement && autoIncrementAllowed(kind, column);
		      if (column.autoIncrement && !autoIncrementAllowed(kind, column)) {
		        if (column.indexKind !== "primary") return { error: t("createTable.autoNeedsKey") };
		        if (isSqlite) return { error: t("createTable.autoNeedsInteger", { name: columnName }) };
		        return { error: t("createTable.autoNeedsNumeric", { name: columnName }) };
		      }
		      if (autoIncrement && defaultValue !== void 0) {
		        return { error: t("createTable.autoIncrementDefault", { name: columnName }) };
		      }
		      if (column.indexKind === "primary") key.push(columnName);
		      if (column.indexKind !== "" && !indexKindAvailable(column.indexKind, column)) {
		        if (column.indexKind === "fulltext") return { error: t("createTable.fulltextNeedsText", { name: columnName, type: column.type }) };
		        if (column.indexKind === "spatial") return { error: t("createTable.spatialNeedsGeometry", { name: columnName }) };
		      }
		      const effectiveNullable = column.indexKind === "primary" ? false : column.nullable;
		      if (nullDefaultNeedsNullable(kind, effectiveNullable, column.defaultMode)) {
		        return { error: t("createTable.nullDefaultNeedsNullable", { name: columnName }) };
		      }
		      const attributes = isSqlite ? [] : column.attributes;
		      specs.push({
		        name: columnName,
		        type: column.type.trim(),
		        // A key column is never nullable in either engine, so the flag is forced rather
		        // than left to produce a statement the server rejects.
		        nullable: column.indexKind === "primary" ? false : column.nullable,
		        ...column.length.trim() === "" ? {} : { length: column.length.trim() },
		        ...column.collate === "" ? {} : { collate: column.collate },
		        ...attributes.length === 0 ? {} : { attributes },
		        ...defaultValue === void 0 ? {} : { defaultValue },
		        ...autoIncrement ? { autoIncrement: true } : {},
		        ...column.comment.trim() === "" ? {} : { comment: column.comment.trim() }
		      });
		    }
		    const indexes = [];
		    const groups = /* @__PURE__ */ new Map();
		    for (const column of columns) {
		      if (column.indexKind === "" || column.indexKind === "primary") continue;
		      const columnName = column.name.trim();
		      const explicit = column.indexName.trim();
		      const groupKey = explicit === "" ? `__solo_${column.id}` : `${column.indexKind}:${explicit}`;
		      const existing = groups.get(groupKey);
		      if (existing === void 0) {
		        groups.set(groupKey, { kind: column.indexKind, name: explicit, columns: [columnName] });
		      } else {
		        existing.columns.push(columnName);
		      }
		    }
		    for (const group of groups.values()) {
		      indexes.push({
		        kind: group.kind,
		        ...group.name === "" ? {} : { name: group.name },
		        columns: group.columns
		      });
		    }
		    const autos = columns.filter((column) => column.autoIncrement);
		    if (autos.length > 1) {
		      const valid = autos.filter((column) => autoIncrementAllowed(kind, column));
		      if (valid.length > 1) {
		        return { error: t("createTable.oneAutoIncrement", { names: valid.map((column) => column.name.trim()).join(", ") }) };
		      }
		    }
		    const tableOptions = {
		      ...isSqlite || tableEngine === "" ? {} : { engine: tableEngine },
		      ...isSqlite || tableCollate === "" ? {} : { collate: tableCollate },
		      ...isSqlite || tableComment.trim() === "" ? {} : { comment: tableComment.trim() },
		      ...isSqlite && (withoutRowid || strict) ? { tail: [withoutRowid ? "WITHOUT ROWID" : "", strict ? "STRICT" : ""].filter(Boolean).join(", ") } : {}
		    };
		    return { payload: { table: tableName, specs, primaryKey: key, indexes, tableOptions } };
		  };
		  const submit = async () => {
		    const built = build();
		    if ("error" in built) {
		      setLocalError(built.error);
		      return;
		    }
		    setLocalError(void 0);
		    setBusy(true);
		    try {
		      await api.changeSchema(sourceId, {
		        schema,
		        table: built.payload.table,
		        action: "createTable",
		        specs: built.payload.specs,
		        ...built.payload.primaryKey.length === 0 ? {} : { primaryKey: built.payload.primaryKey },
		        ...built.payload.indexes.length === 0 ? {} : { indexes: built.payload.indexes },
		        ...Object.keys(built.payload.tableOptions).length === 0 ? {} : { tableOptions: built.payload.tableOptions }
		      });
		      onCreated(built.payload.table);
		    } catch (failure) {
		      setLocalError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  const [customTypeRows, setCustomTypeRows] = React14.useState(/* @__PURE__ */ new Set());
		  const typeCell = (column, index) => {
		    const groups = TYPE_GROUPS[kind] ?? TYPE_GROUPS.mysql;
		    const offered = groups.flatMap((group) => group.types);
		    const isListed = offered.includes(column.type);
		    const isCustom = customTypeRows.has(column.id) || column.type.trim() === "";
		    if (isCustom) {
		      return React14.createElement(
		        "div",
		        { className: "dbm-type-cell" },
		        React14.createElement("input", {
		          className: "dbm-input dbm-mono",
		          value: column.type,
		          placeholder: t("createTable.typeCustomPlaceholder"),
		          "aria-label": t("createTable.typeText"),
		          "data-dbm-newtable-coltype-text": String(index),
		          spellcheck: false,
		          // The element mounts when the cell switches to custom mode, so this focuses it
		          // once — which is what makes typing immediately possible after choosing 自定义.
		          autoFocus: true,
		          onChange: (event) => patch(column.id, { type: event.target.value })
		        }),
		        /*
		         * A way back to the list.
		         *
		         * Without it, choosing 自定义 is one-way: the dropdown is gone and the only way to
		         * a listed type is the 删除该字段 button. A small button rather than a second
		         * dropdown, to keep the cell one control wide.
		         *
		         * It does NOT change the type: the first version reset it to the first listed
		         * type, which silently discarded what the user had typed (measured: DECIMAL(10,2)
		         * became TINYINT). The value is kept, and the list shows it as its own entry.
		         */
		        React14.createElement("button", {
		          type: "button",
		          className: "dbm-btn dbm-btn-sm",
		          title: t("createTable.typeBackToList"),
		          "data-dbm-newtable-coltype-list": String(index),
		          onClick: () => {
		            setCustomTypeRows((current) => {
		              const next = new Set(current);
		              next.delete(column.id);
		              return next;
		            });
		          }
		        }, "\u21BA")
		      );
		    }
		    return React14.createElement(
		      "select",
		      {
		        className: "dbm-select dbm-mono",
		        // A custom value has no option of its own, so it is represented by the synthetic
		        // entry below; without that the controlled select would show an unrelated type
		        // while the state still held the custom one.
		        value: isListed ? column.type : "__customValue__",
		        "aria-label": t("createTable.columnType"),
		        "data-dbm-newtable-coltype": String(index),
		        onChange: (event) => {
		          const value = event.target.value;
		          if (value === "__custom__" || value === "__customValue__") {
		            setCustomTypeRows((current) => new Set(current).add(column.id));
		            return;
		          }
		          patch(column.id, {
		            type: value,
		            ...takesLength(value) ? {} : { length: "" }
		          });
		        }
		      },
		      [
		        ...groups.map((group) => React14.createElement(
		          "optgroup",
		          { key: group.label, label: t(group.label) },
		          ...group.types.map((value) => React14.createElement("option", { key: value, value }, value))
		        )),
		        // The current custom value, kept selectable so returning to the list does not
		        // discard it and the dropdown can still show what will be declared.
		        isListed ? null : React14.createElement("option", { key: "__customValue__", value: "__customValue__" }, `${column.type} ${t("createTable.typeCustomMark")}`),
		        React14.createElement("option", { key: "__custom__", value: "__custom__" }, t("createTable.typeCustom"))
		      ].filter((entry) => entry !== null)
		    );
		  };
		  const defaultCell = (column, index) => {
		    if (column.defaultMode === "custom") {
		      return React14.createElement(
		        "div",
		        { className: "dbm-type-cell" },
		        React14.createElement("input", {
		          className: "dbm-input dbm-mono",
		          value: column.defaultText,
		          // Empty is a real answer here — it means the empty string — so the placeholder says
		          // so instead of showing a "nothing" hint.
		          placeholder: t("createTable.default.emptyString"),
		          "aria-label": t("createTable.default.text"),
		          "data-dbm-newtable-coldefault-text": String(index),
		          spellcheck: false,
		          // The box mounts when the cell switches to 自定义, so this focuses it once — which
		          // is what makes typing possible straight after picking the entry.
		          autoFocus: true,
		          onChange: (event) => patch(column.id, { defaultText: event.target.value })
		        }),
		        React14.createElement(
		          "button",
		          {
		            type: "button",
		            className: "dbm-btn dbm-btn-sm",
		            title: t("createTable.default.backToList"),
		            "data-dbm-newtable-coldefault-list": String(index),
		            onClick: () => {
		              patch(column.id, { defaultMode: "none" });
		            }
		          },
		          "\u21BA"
		        )
		      );
		    }
		    return React14.createElement(
		      "select",
		      {
		        className: "dbm-select",
		        value: column.defaultMode,
		        "aria-label": t("createTable.columnDefault"),
		        "data-dbm-newtable-coldefault-mode": String(index),
		        onChange: (event) => patch(column.id, { defaultMode: event.target.value })
		      },
		      [
		        React14.createElement("option", { key: "none", value: "none" }, t("common.none")),
		        React14.createElement("option", { key: "custom", value: "custom" }, t("createTable.default.custom")),
		        React14.createElement("option", { key: "null", value: "null" }, "NULL"),
		        // Only offered for a type that accepts it. MySQL refuses it elsewhere with
		        // "Invalid default value", measured on VARCHAR and INT. The rule comes from the shared
		        // module so the form and any test read the same one.
		        React14.createElement(
		          "option",
		          { key: "currentTimestamp", value: "currentTimestamp", disabled: !supportsCurrentTimestamp(column.type) },
		          supportsCurrentTimestamp(column.type) ? "CURRENT_TIMESTAMP" : `CURRENT_TIMESTAMP\uFF08${t("createTable.default.needsTemporal")}\uFF09`
		        )
		      ]
		    );
		  };
		  const attributeSelect = (column, index) => {
		    const chosen = column.attributes;
		    const summary = chosen.length === 0 ? t("common.none") : chosen.map((id) => ATTRIBUTE_ITEMS.find((item) => item.id === id)?.label ?? id).join(" ");
		    return React14.createElement(
		      "select",
		      {
		        className: "dbm-select",
		        // The select's own value is unused (options are toggles), so it always shows the
		        // placeholder; the summary is rendered as the option text below.
		        value: "",
		        "aria-label": t("createTable.columnAttributes"),
		        "data-dbm-newtable-attr-select": String(index),
		        title: t("createTable.attributesHint"),
		        onChange: (event) => {
		          const value = event.target.value;
		          if (value === "__clear__") {
		            patch(column.id, { attributes: [] });
		            return;
		          }
		          const next = chosen.includes(value) ? chosen.filter((entry) => entry !== value) : [...chosen, value];
		          patch(column.id, { attributes: next });
		        }
		      },
		      [
		        React14.createElement("option", { key: "__summary__", value: "" }, summary),
		        ...ATTRIBUTE_ITEMS.map((item) => {
		          const available = attributeAvailable(item.id, column);
		          return React14.createElement(
		            "option",
		            {
		              key: item.id,
		              value: item.id,
		              disabled: !available,
		              // The reason is the option's own text, so it is readable in the open list
		              // instead of hidden in a tooltip.
		              "data-dbm-newtable-attr-option": `${index}:${item.id}`
		            },
		            available ? `${chosen.includes(item.id) ? "\u2713 " : ""}${item.label}` : `${item.label} \u2014 ${t("createTable.attributeUnavailable")}`
		          );
		        }),
		        chosen.length === 0 ? null : React14.createElement("option", { key: "__clear__", value: "__clear__" }, t("createTable.attributesClear"))
		      ].filter((entry) => entry !== null)
		    );
		  };
		  const indexSelect = (column, index) => React14.createElement(
		    "select",
		    {
		      className: "dbm-select",
		      value: column.indexKind,
		      "aria-label": t("createTable.columnIndex"),
		      // The ROW index, like every other control in this table. It used to be
		      // `column.id`, which is a different number — so anything addressing the form by
		      // row (the E2E probes) selected the wrong row's control.
		      "data-dbm-newtable-index": String(index),
		      onChange: (event) => patch(column.id, { indexKind: event.target.value })
		    },
		    [
		      React14.createElement("option", { key: "", value: "" }, t("common.none")),
		      ...["primary", "unique", "index", "fulltext", "spatial"].map((value) => {
		        const available = indexKindAvailable(value, column);
		        return React14.createElement(
		          "option",
		          { key: value, value, disabled: !available },
		          available ? t(`createTable.index.${value}`) : `${t(`createTable.index.${value}`)}\uFF08${t("createTable.indexUnavailable")}\uFF09`
		        );
		      })
		    ]
		  );
		  const rowFor = (column, index) => {
		    const autoBlocker = autoIncrementBlocker(kind, column);
		    const autoHolder = column.autoIncrement ? void 0 : autoIncrementTakenBy(columns, column);
		    const autoHint = autoHolder !== void 0 ? null : autoBlocker === void 0 ? null : autoBlocker === "notKey" ? t("createTable.autoNeedsKey") : autoBlocker === "notInteger" ? t("createTable.autoNeedsInteger", { name: column.name.trim() === "" ? t("createTable.thisColumn") : column.name.trim() }) : t("createTable.autoNeedsNumeric", { name: column.name.trim() === "" ? t("createTable.thisColumn") : column.name.trim() });
		    return React14.createElement(
		      "tr",
		      { key: column.id, "data-dbm-newtable-row": String(index) },
		      /* 字段名 */
		      React14.createElement("td", null, React14.createElement("input", {
		        className: "dbm-input dbm-mono",
		        value: column.name,
		        placeholder: t("createTable.columnNamePlaceholder"),
		        "aria-label": t("createTable.columnName"),
		        "data-dbm-newtable-colname": String(index),
		        spellcheck: false,
		        onChange: (event) => patch(column.id, { name: event.target.value })
		      })),
		      /*
		       * 类型: a GROUPED dropdown, which swaps to a text field IN THE SAME CELL.
		       *
		       * Grouped because a flat list of thirty types is hard to scan and the choice is
		       * two-step ("a number, then which"). The custom entry is needed because MySQL
		       * accepts more type text than any list holds (`decimal(10,2) unsigned`,
		       * `enum('a','b')`) and SQLite accepts essentially anything.
		       *
		       * The swap is in place rather than a separate column: the form is already wide and
		       * width was the complaint, so the custom affordance must not add a column.
		       */
		      React14.createElement("td", null, typeCell(column, index)),
		      /* 长度/值 */
		      /*
		       * The length is the USER's to type: the field starts EMPTY and 255 is only the
		       * placeholder. It used to arrive pre-filled with 255, which made the value look like
		       * something the form had decided — reported as "长度/值新增一个条目时不要默认 255，让用户
		       * 自己填". A placeholder carries the same hint without putting a value in the payload.
		       */
		      React14.createElement("td", null, React14.createElement("input", {
		        className: "dbm-input dbm-mono",
		        value: column.length,
		        placeholder: isSqlite ? t("createTable.sqliteLengthHint") : "255",
		        "aria-label": t("createTable.columnLength"),
		        "data-dbm-newtable-collength": String(index),
		        title: isSqlite ? t("createTable.sqliteLengthHint") : t("createTable.lengthHint"),
		        spellcheck: false,
		        disabled: isSqlite,
		        onChange: (event) => patch(column.id, { length: event.target.value })
		      })),
		      /* 排序规则 */
		      React14.createElement("td", null, React14.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: column.collate,
		          "aria-label": t("createTable.columnCollate"),
		          "data-dbm-newtable-colcollate": String(index),
		          onChange: (event) => patch(column.id, { collate: event.target.value })
		        },
		        collationList.map((value) => React14.createElement("option", { key: value === "" ? "__none__" : value, value }, value === "" ? t("common.none") : value))
		      )),
		      /* 属性: a dropdown, as asked */
		      React14.createElement("td", null, attributeSelect(column, index)),
		      /* 索引 */
		      React14.createElement("td", null, indexSelect(column, index)),
		      /* 索引名（联合索引用） */
		      React14.createElement("td", null, React14.createElement("input", {
		        className: "dbm-input dbm-mono",
		        value: column.indexName,
		        // Only meaningful when an index kind is chosen, and meaningless for PRIMARY:
		        // there is exactly one key, so it has no name of its own.
		        disabled: column.indexKind === "" || column.indexKind === "primary",
		        placeholder: t("createTable.indexNamePlaceholder"),
		        "aria-label": t("createTable.indexName"),
		        "data-dbm-newtable-indexname": String(index),
		        title: t("createTable.indexNameHint"),
		        spellcheck: false,
		        onChange: (event) => patch(column.id, { indexName: event.target.value })
		      })),
		      /* 允许空 */
		      React14.createElement("td", null, React14.createElement(
		        "label",
		        { className: "dbm-check" },
		        React14.createElement("input", {
		          type: "checkbox",
		          checked: column.indexKind === "primary" ? false : column.nullable,
		          disabled: column.indexKind === "primary",
		          title: column.indexKind === "primary" ? t("createTable.keyNotNullable") : void 0,
		          "data-dbm-newtable-nullable": String(index),
		          onChange: (event) => patch(column.id, { nullable: event.target.checked })
		        })
		      )),
		      /*
		       * 默认值: a dropdown, with a text field shown only for 自定义.
		       *
		       * The four options are the four things a default can be, and they were not all
		       * reachable with one text field: leaving it blank meant NO default clause (an omitted
		       * column then inserts NULL), so "the empty string" could not be asked for at all, and
		       * NULL was only expressible by knowing to type the word.
		       *
		       * The text field appears in the same cell rather than as another column, because the
		       * form is already wide.
		       */
		      React14.createElement("td", null, defaultCell(column, index)),
		      /*
		       * 自增, WITH ITS REASON ON SCREEN for the rules the user must act on.
		       *
		       * The combination the engine cannot express is still refused, but the user is told what
		       * to change instead of facing a control that silently does nothing. "Another column
		       * already has it" is the exception: it is visible in the form itself, so it explains
		       * itself through the checkbox's title rather than a sentence under every row.
		       */
		      React14.createElement(
		        "td",
		        { className: "dbm-auto-cell" },
		        /*
		         * The explanation rides on the LABEL, not the checkbox.
		         *
		         * A `disabled` input does not fire mouse events, so its own `title` does not reliably
		         * appear — measured earlier in this form, which is why the reasons were moved to
		         * visible text in the first place. The label is not disabled, so hovering the cell
		         * still answers "why is this box greyed out?" without a sentence under every row.
		         */
		        React14.createElement(
		          "label",
		          {
		            className: "dbm-check",
		            title: autoHolder === void 0 ? void 0 : t("createTable.autoAlreadyTaken", { name: autoHolder.name.trim() === "" ? t("createTable.thisColumn") : autoHolder.name.trim() })
		          },
		          React14.createElement("input", {
		            type: "checkbox",
		            checked: column.autoIncrement,
		            disabled: autoBlocker !== void 0 || autoHolder !== void 0,
		            "data-dbm-newtable-auto": String(index),
		            // Only one column may own it, so every other row's checkbox is disabled rather
		            // than left clickable until submit.
		            "data-dbm-newtable-auto-blocked-by": autoHolder === void 0 ? void 0 : "other",
		            onChange: (event) => patch(column.id, { autoIncrement: event.target.checked })
		          })
		        ),
		        autoHint === null ? null : React14.createElement(
		          "div",
		          { className: "dbm-hint dbm-auto-hint", "data-dbm-newtable-auto-hint": String(index) },
		          autoHint
		        )
		      ),
		      /* 注释 */
		      React14.createElement("td", null, React14.createElement("input", {
		        className: "dbm-input",
		        value: column.comment,
		        disabled: isSqlite,
		        placeholder: isSqlite ? t("createTable.sqliteNoCommentShort") : t("common.none"),
		        "aria-label": t("createTable.columnComment"),
		        "data-dbm-newtable-colcomment": String(index),
		        title: isSqlite ? t("createTable.sqliteNoComment", { name: column.name || "\u2014" }) : void 0,
		        onChange: (event) => patch(column.id, { comment: event.target.value })
		      })),
		      /* 删除该行 */
		      React14.createElement("td", null, React14.createElement("button", {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        disabled: columns.length <= 1,
		        title: columns.length <= 1 ? t("createTable.lastColumn") : t("createTable.removeColumn"),
		        "data-dbm-newtable-remove": String(index),
		        onClick: () => removeRow(column.id)
		      }, "\xD7"))
		    );
		  };
		  const columnHeaders = [
		    t("createTable.columnName"),
		    t("createTable.columnType"),
		    t("createTable.columnLength"),
		    t("createTable.columnCollate"),
		    t("createTable.columnAttributes"),
		    t("createTable.columnIndex"),
		    t("createTable.indexName"),
		    t("createTable.columnNullable"),
		    t("createTable.columnDefault"),
		    t("createTable.columnAuto"),
		    t("createTable.columnComment"),
		    ""
		  ];
		  const body = React14.createElement(
		    "div",
		    null,
		    /* ---- the table itself ------------------------------------------------ *
		     *
		     * One grid: label on the left, control on the right, all four fields on one row at this
		     * dialog's width. The column count is adaptive (see `.dbm-grid2`) rather than fixed, so the
		     * fields reflow to three, two then one as the window narrows instead of sitting in two
		     * short rows with empty stretches beside them.
		     */
		    React14.createElement(
		      "div",
		      { className: "dbm-grid2" },
		      React14.createElement(
		        "div",
		        { className: "dbm-grid-row" },
		        React14.createElement("label", { className: "dbm-grid-label", htmlFor: "dbm-newtable-name" }, t("createTable.tableName")),
		        React14.createElement("input", {
		          className: "dbm-input dbm-mono dbm-grid-control",
		          id: "dbm-newtable-name",
		          value: name,
		          placeholder: "my_table",
		          "aria-label": t("createTable.tableName"),
		          "data-dbm-newtable-name": "",
		          spellcheck: false,
		          autoFocus: true,
		          onChange: (event) => setName(event.target.value)
		        })
		      ),
		      React14.createElement(
		        "div",
		        { className: "dbm-grid-row" },
		        React14.createElement("label", { className: "dbm-grid-label", htmlFor: "dbm-newtable-tablecomment" }, t("createTable.tableComment")),
		        React14.createElement("input", {
		          className: "dbm-input dbm-grid-control",
		          id: "dbm-newtable-tablecomment",
		          value: tableComment,
		          disabled: isSqlite,
		          placeholder: isSqlite ? t("createTable.sqliteNoTableCommentShort") : t("common.none"),
		          "data-dbm-newtable-tablecomment": "",
		          title: isSqlite ? t("createTable.sqliteNoTableComment") : t("createTable.tableCommentHint"),
		          onChange: (event) => setTableComment(event.target.value)
		        })
		      ),
		      React14.createElement(
		        "div",
		        { className: "dbm-grid-row" },
		        React14.createElement("label", { className: "dbm-grid-label", htmlFor: "dbm-newtable-tableengine" }, t("createTable.tableEngine")),
		        isSqlite ? React14.createElement("input", {
		          className: "dbm-input dbm-mono dbm-grid-control",
		          id: "dbm-newtable-tableengine",
		          value: "",
		          disabled: true,
		          placeholder: t("createTable.sqliteNoEngineShort"),
		          "data-dbm-newtable-tableengine": "",
		          title: t("createTable.sqliteNoEngine")
		        }) : React14.createElement(
		          "select",
		          {
		            className: "dbm-select dbm-grid-control",
		            id: "dbm-newtable-tableengine",
		            value: tableEngine,
		            "data-dbm-newtable-tableengine": "",
		            onChange: (event) => setTableEngine(event.target.value)
		          },
		          ENGINES2.map((value) => React14.createElement("option", { key: value, value }, value))
		        )
		      ),
		      React14.createElement(
		        "div",
		        { className: "dbm-grid-row" },
		        React14.createElement("label", { className: "dbm-grid-label", htmlFor: "dbm-newtable-tablecollate" }, t("createTable.tableCollate")),
		        isSqlite ? React14.createElement("input", {
		          className: "dbm-input dbm-mono dbm-grid-control",
		          id: "dbm-newtable-tablecollate",
		          value: "",
		          disabled: true,
		          placeholder: t("createTable.sqliteNoTableCollateShort"),
		          "data-dbm-newtable-tablecollate": "",
		          title: t("createTable.sqliteNoTableCollate")
		        }) : React14.createElement(
		          "select",
		          {
		            className: "dbm-select dbm-grid-control",
		            id: "dbm-newtable-tablecollate",
		            value: tableCollate,
		            "data-dbm-newtable-tablecollate": "",
		            onChange: (event) => setTableCollate(event.target.value)
		          },
		          collationList.map((value) => React14.createElement("option", { key: value === "" ? "__none__" : value, value }, value === "" ? t("createTable.tableCollateDefault") : value))
		        )
		      ),
		      /*
		       * SQLite's own trailing keywords, which have no MySQL equivalent. Two checkboxes in
		       * ONE grid row, so the grid's column count stays even.
		       */
		      isSqlite ? React14.createElement(
		        "div",
		        { className: "dbm-grid-row" },
		        React14.createElement("span", { className: "dbm-grid-label" }, t("createTable.tableTail")),
		        React14.createElement(
		          "div",
		          { className: "dbm-grid-control dbm-check-group" },
		          React14.createElement(
		            "label",
		            { className: "dbm-check" },
		            React14.createElement("input", {
		              type: "checkbox",
		              checked: withoutRowid,
		              "data-dbm-newtable-withoutrowid": "",
		              onChange: (event) => setWithoutRowid(event.target.checked)
		            }),
		            "WITHOUT ROWID"
		          ),
		          React14.createElement(
		            "label",
		            { className: "dbm-check" },
		            React14.createElement("input", {
		              type: "checkbox",
		              checked: strict,
		              "data-dbm-newtable-strict": "",
		              onChange: (event) => setStrict(event.target.checked)
		            }),
		            "STRICT"
		          )
		        )
		      ) : null
		    ),
		    /*
		     * The rule that separates the table's own options from its column list.
		     *
		     * The two are different subjects — "which table is this" then "what is in it" — and the rule is
		     * what divides them now that the 字段 heading above the list is gone. Asked for as
		     * "下面加一条线和下面的字段表格隔开".
		     */
		    React14.createElement("div", { className: "dbm-newtable-sep" }),
		    /* ---- the columns ---- */
		    /*
		     * No 字段 heading above the list.
		     *
		     * There used to be one (`dbm-field-label`), asked to be removed: the table's own fields above
		     * the rule already carry their own labels, and the column table's header row (字段名 / 类型 /
		     * 长度/值 …) names the block better than a heading could — so the heading was a third level of
		     * labelling for the same thing, and the space it took pushed the list down. The rule stays as
		     * the visual divider in its place.
		     */
		    React14.createElement(
		      "div",
		      { className: "dbm-field" },
		      React14.createElement(
		        "div",
		        { className: "dbm-scroll" },
		        React14.createElement(
		          "table",
		          { className: "dbm-table dbm-newtable-cols" },
		          React14.createElement("thead", null, React14.createElement(
		            "tr",
		            null,
		            ...columnHeaders.map((label, index) => React14.createElement(
		              "th",
		              { key: `${label}-${index}`, title: index === 4 ? t("createTable.attributesHint") : index === 6 ? t("createTable.indexNameHint") : void 0 },
		              label
		            ))
		          )),
		          React14.createElement("tbody", null, ...columns.map(rowFor))
		        )
		      ),
		      React14.createElement(
		        "div",
		        { className: "dbm-row" },
		        React14.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", "data-dbm-newtable-add": "", onClick: addRow }, t("createTable.addColumn"))
		      ),
		      React14.createElement("div", { className: "dbm-hint" }, t("createTable.hint")),
		      /*
		       * The composite-index explanation, stated where the index controls are.
		       *
		       * The rule ("columns sharing an index name form one index, in column order") is
		       * not discoverable from the form: a user who wants a two-column index has no way
		       * to know they must type the SAME name twice.
		       */
		      /*
		       * The default-value explanation, where the control is.
		       *
		       * "No default" and "the empty string" look the same in a form and are not the same in
		       * the database, so the difference is stated rather than left to be discovered.
		       */
		      React14.createElement("div", { className: "dbm-hint" }, t("createTable.default.hint")),
		      React14.createElement("div", { className: "dbm-hint" }, t("createTable.compositeHint"))
		    ),
		    localError === void 0 ? null : React14.createElement("div", { className: "dbm-error dbm-pad", role: "alert", "data-dbm-newtable-error": "" }, localError)
		  );
		  return React14.createElement(Modal, {
		    title: t("createTable.title"),
		    // A wider dialog: the form has one control per table column, and at the default
		    // width it needed an inner scrollbar, which is what "显示不全" was.
		    wide: true,
		    onClose: busy ? () => {
		    } : onClose,
		    footer: [
		      React14.createElement("button", { key: "cancel", type: "button", className: "dbm-btn", disabled: busy, onClick: onClose }, t("common.cancel")),
		      React14.createElement(
		        "button",
		        {
		          key: "ok",
		          type: "button",
		          className: `dbm-btn dbm-btn-primary${busy ? " dbm-btn-busy" : ""}`,
		          disabled: busy,
		          "aria-busy": busy ? "true" : void 0,
		          "data-dbm-newtable-submit": "",
		          onClick: () => {
		            void submit();
		          }
		        },
		        busy ? [React14.createElement("span", { key: "spin", className: "dbm-spinner" }), t("common.loading")] : t("createTable.submit")
		      )
		    ],
		    children: body
		  });
		}

		// src/client/SqlTransferDialogs.ts
		var React15 = __toESM(require("react"), 1);
		function ExportDialog(props) {
		  const { api, source, schema, table, tableCount, selectedKeys, tables: presetTables, rowsOnly, onClose, onDone, onError } = props;
		  const hasTable = table !== void 0 && table !== "";
		  const hasSelection = selectedKeys !== void 0 && selectedKeys.length > 0;
		  const [format, setFormat] = React15.useState(rowsOnly === true ? "csv" : "sql");
		  const [scope, setScope] = React15.useState(
		    hasSelection ? "selected" : rowsOnly === true ? "table" : "table"
		  );
		  const [includeStructure, setIncludeStructure] = React15.useState(true);
		  const [includeData, setIncludeData] = React15.useState(true);
		  const [drop, setDrop] = React15.useState(false);
		  const [busy, setBusy] = React15.useState(false);
		  const [result, setResult] = React15.useState(void 0);
		  React15.useEffect(() => {
		    if (format === "csv" && scope === "schema") setScope("table");
		  }, [format, scope]);
		  const run = async () => {
		    if (format === "csv" && !hasTable) {
		      onError(t("export.csvOneTable"));
		      return;
		    }
		    setBusy(true);
		    try {
		      const chosen = presetTables !== void 0 && presetTables.length > 0 ? presetTables : format === "csv" ? hasTable ? [table] : [] : scope === "table" && hasTable ? [table] : [];
		      const payload = {
		        schema,
		        includeStructure: format === "csv" ? false : includeStructure,
		        includeData,
		        // A selection export is rows only: the table already exists at the other
		        // end, and re-creating it would collide with it.
		        drop: scope === "selected" ? false : drop,
		        format,
		        ...chosen.length === 0 ? {} : { tables: chosen }
		      };
		      const response = await api.exportData(source.id, payload);
		      const blob = new Blob([response.text], { type: response.contentType });
		      const url = URL.createObjectURL(blob);
		      const anchor = document.createElement("a");
		      anchor.href = url;
		      anchor.download = response.filename;
		      document.body.appendChild(anchor);
		      anchor.click();
		      anchor.remove();
		      setTimeout(() => URL.revokeObjectURL(url), 0);
		      setResult({ filename: response.filename, size: response.byteLength, truncated: response.truncated });
		      onDone(t("export.done", { name: response.filename, size: formatBytes(response.byteLength) }));
		    } catch (failure) {
		      onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  const row = (label, control) => React15.createElement(
		    "div",
		    { className: "dbm-row" },
		    React15.createElement("span", { className: "dbm-hint", style: { width: 110, flex: "none" } }, label),
		    control
		  );
		  return React15.createElement(Modal, {
		    title: t("export.title"),
		    onClose,
		    footer: [
		      React15.createElement("button", { key: "close", type: "button", className: "dbm-btn", disabled: busy, onClick: onClose }, t("common.close")),
		      React15.createElement("button", {
		        key: "go",
		        type: "button",
		        className: "dbm-btn dbm-btn-primary",
		        disabled: busy || !includeStructure && !includeData,
		        "data-dbm-export-submit": "",
		        onClick: () => {
		          void run();
		        }
		      }, busy ? t("export.busy") : t("export.submit"))
		    ],
		    children: React15.createElement(
		      "div",
		      null,
		      row(t("export.format"), React15.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: format,
		          "data-dbm-export-format": "",
		          onChange: (event) => setFormat(event.target.value === "csv" ? "csv" : "sql")
		        },
		        React15.createElement("option", { value: "sql" }, t("export.format.sql")),
		        React15.createElement("option", { value: "csv" }, t("export.format.csv"))
		      )),
		      format === "csv" ? null : row(
		        t("export.scope"),
		        React15.createElement(
		          "select",
		          {
		            className: "dbm-select",
		            value: scope,
		            "data-dbm-export-scope": "",
		            // A preset set of tables IS the scope, so the select is disabled rather
		            // than offering choices that would be ignored.
		            disabled: presetTables !== void 0 && presetTables.length > 0,
		            onChange: (event) => setScope(event.target.value)
		          },
		          [
		            React15.createElement("option", { key: "schema", value: "schema" }, t("export.scope.schema", { n: tableCount })),
		            hasTable ? React15.createElement("option", { key: "table", value: "table" }, t("export.scope.table")) : null,
		            hasSelection ? React15.createElement("option", { key: "selected", value: "selected" }, t("export.scope.selected")) : null
		          ].filter((entry) => entry !== null)
		        )
		      ),
		      presetTables !== void 0 && presetTables.length > 0 ? React15.createElement(
		        "div",
		        { className: "dbm-hint dbm-mono", "data-dbm-export-tables": "", style: { wordBreak: "break-all" } },
		        `${t("export.scope.chosen", { n: presetTables.length })}: ${presetTables.join("\u3001")}`
		      ) : null,
		      row("", React15.createElement(
		        "label",
		        { className: "dbm-check" },
		        React15.createElement("input", {
		          type: "checkbox",
		          checked: includeStructure,
		          disabled: format === "csv",
		          onChange: (event) => setIncludeStructure(event.target.checked)
		        }),
		        t("export.includeStructure")
		      )),
		      row("", React15.createElement(
		        "label",
		        { className: "dbm-check" },
		        React15.createElement("input", {
		          type: "checkbox",
		          checked: includeData,
		          onChange: (event) => setIncludeData(event.target.checked)
		        }),
		        t("export.includeData")
		      )),
		      row("", React15.createElement(
		        "label",
		        { className: "dbm-check" },
		        React15.createElement("input", {
		          type: "checkbox",
		          checked: drop,
		          disabled: format === "csv" || !includeStructure,
		          onChange: (event) => setDrop(event.target.checked)
		        }),
		        t("export.dropTable")
		      )),
		      drop ? React15.createElement("div", { className: "dbm-hint" }, t("export.dropWarn")) : null,
		      result === void 0 ? null : React15.createElement(
		        "div",
		        { className: "dbm-ok" },
		        t("export.done", { name: result.filename, size: formatBytes(result.size) }),
		        result.truncated.length === 0 ? null : React15.createElement("div", { className: "dbm-hint" }, t("export.truncated", { n: result.truncated.length }))
		      ),
		      React15.createElement("div", { className: "dbm-hint" }, t("export.hint"))
		    )
		  });
		}
		function ImportDialog(props) {
		  const { api, source, schema, table, tables, onClose, onDone, onError } = props;
		  const [format, setFormat] = React15.useState("sql");
		  const [target, setTarget] = React15.useState(table ?? tables[0]?.name ?? "");
		  const [hasHeader, setHasHeader] = React15.useState(true);
		  const [emptyAsNull, setEmptyAsNull] = React15.useState(true);
		  const [file, setFile] = React15.useState(void 0);
		  const [busy, setBusy] = React15.useState(false);
		  const [result, setResult] = React15.useState(void 0);
		  const read = (chosen) => {
		    if (chosen.size > IMPORT_FILE_CAP) {
		      setFile(void 0);
		      onError(t("import.refuseTooBig", { size: formatBytes(chosen.size), limit: formatBytes(IMPORT_FILE_CAP) }));
		      return;
		    }
		    const reader = new FileReader();
		    reader.onerror = () => onError(`the file could not be read: ${reader.error?.message ?? "unknown error"}`);
		    reader.onload = () => {
		      const text = typeof reader.result === "string" ? reader.result : "";
		      setFile({ name: chosen.name, size: chosen.size, text });
		      onError("");
		    };
		    reader.readAsText(chosen, "utf-8");
		  };
		  const run = async () => {
		    if (file === void 0) {
		      onError(t("import.needFile"));
		      return;
		    }
		    if (format === "csv" && target === "") {
		      onError(t("import.needTable"));
		      return;
		    }
		    setBusy(true);
		    try {
		      const response = await api.importData(source.id, {
		        schema,
		        format,
		        content: file.text,
		        ...format === "csv" ? { table: target, hasHeader, emptyAsNull } : {}
		      });
		      const message = format === "csv" ? t("import.doneRows", { n: response.rows }) : t("import.done", { n: response.statements });
		      const skipped = response.skipped.length === 0 ? "" : `\uFF1B${t("import.skipped", { n: response.skipped.length, lines: response.skipped.map((entry) => entry.line).join(", ") })}`;
		      setResult(`${message}${skipped}`);
		      onDone(`${message}${skipped}`);
		    } catch (failure) {
		      onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  const row = (label, control) => React15.createElement(
		    "div",
		    { className: "dbm-row" },
		    React15.createElement("span", { className: "dbm-hint", style: { width: 110, flex: "none" } }, label),
		    control
		  );
		  return React15.createElement(Modal, {
		    title: t("import.title"),
		    onClose,
		    footer: [
		      React15.createElement("button", { key: "close", type: "button", className: "dbm-btn", disabled: busy, onClick: onClose }, t("common.close")),
		      React15.createElement("button", {
		        key: "go",
		        type: "button",
		        className: "dbm-btn dbm-btn-primary",
		        disabled: busy || file === void 0,
		        "data-dbm-import-submit": "",
		        onClick: () => {
		          void run();
		        }
		      }, busy ? t("import.busy") : t("import.submit"))
		    ],
		    children: React15.createElement(
		      "div",
		      null,
		      row(t("import.format"), React15.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: format,
		          "data-dbm-import-format": "",
		          onChange: (event) => setFormat(event.target.value === "csv" ? "csv" : "sql")
		        },
		        React15.createElement("option", { value: "sql" }, t("import.format.sql")),
		        React15.createElement("option", { value: "csv" }, t("import.format.csv"))
		      )),
		      format === "csv" ? [
		        row(t("import.table"), React15.createElement(
		          "select",
		          {
		            key: "target",
		            className: "dbm-select",
		            value: target,
		            "data-dbm-import-table": "",
		            onChange: (event) => setTarget(event.target.value)
		          },
		          tables.filter((entry) => entry.type !== "view").map((entry) => React15.createElement("option", { key: entry.name, value: entry.name }, entry.name))
		        )),
		        React15.createElement("div", { key: "hint", className: "dbm-hint" }, t("import.tableHint")),
		        row("", React15.createElement(
		          "label",
		          { key: "header", className: "dbm-check" },
		          React15.createElement("input", {
		            type: "checkbox",
		            checked: hasHeader,
		            onChange: (event) => setHasHeader(event.target.checked)
		          }),
		          t("import.hasHeader")
		        )),
		        hasHeader ? null : React15.createElement("div", { key: "hh", className: "dbm-hint" }, t("import.hasHeaderHint")),
		        row("", React15.createElement(
		          "label",
		          { key: "null", className: "dbm-check" },
		          React15.createElement("input", {
		            type: "checkbox",
		            checked: emptyAsNull,
		            onChange: (event) => setEmptyAsNull(event.target.checked)
		          }),
		          t("import.emptyAsNull")
		        )),
		        React15.createElement("div", { key: "nh", className: "dbm-hint" }, t("import.emptyAsNullHint"))
		      ] : null,
		      row(t("import.file"), React15.createElement("input", {
		        type: "file",
		        className: "dbm-input",
		        accept: format === "csv" ? ".csv,text/csv" : ".sql,text/plain",
		        "data-dbm-import-file": "",
		        onChange: (event) => {
		          const chosen = event.target.files?.[0];
		          if (chosen === void 0) return;
		          read(chosen);
		        }
		      })),
		      file === void 0 ? React15.createElement("div", { className: "dbm-hint" }, t("import.noFile")) : React15.createElement("div", { className: "dbm-hint" }, `${file.name} \xB7 ${formatBytes(file.size)}`),
		      React15.createElement("div", { className: "dbm-hint" }, t("import.warn")),
		      result === void 0 ? null : React15.createElement("div", { className: "dbm-ok" }, result),
		      React15.createElement("div", { className: "dbm-hint" }, t("import.hint"))
		    )
		  });
		}
		var IMPORT_FILE_CAP = 32 * 1024 * 1024;

		// src/client/SqlDatabaseView.ts
		function SqlDatabaseView(props) {
		  const { api, source, initialSchemas, onBack, onClose } = props;
		  const [schemas, setSchemas] = React16.useState(initialSchemas);
		  const [tableFilter, setTableFilter] = React16.useState("");
		  const [openSchemas, setOpenSchemas] = React16.useState({});
		  const [tablesBySchema, setTablesBySchema] = React16.useState({});
		  const [loadingSchemas, setLoadingSchemas] = React16.useState({});
		  const [activeSchema, setActiveSchema] = React16.useState(void 0);
		  const [activeTable, setActiveTable] = React16.useState(void 0);
		  const [tab, setTab] = React16.useState("browse");
		  const [error, setError] = React16.useState(void 0);
		  const [notice, setNotice] = React16.useState(void 0);
		  const [rows, setRows] = React16.useState(void 0);
		  const [browse, setBrowse] = React16.useState({ page: 1, pageSize: 200, orderDir: "asc" });
		  const [columns, setColumns] = React16.useState([]);
		  const [indexes, setIndexes] = React16.useState([]);
		  const [structureLoading, setStructureLoading] = React16.useState(false);
		  const [transfer, setTransfer] = React16.useState(void 0);
		  const [schemaTables, setSchemaTables] = React16.useState([]);
		  const [selectedTables, setSelectedTables] = React16.useState(/* @__PURE__ */ new Set());
		  const [maintenanceSupport, setMaintenanceSupport] = React16.useState([]);
		  const [tableActionSupport, setTableActionSupport] = React16.useState(void 0);
		  const [tableActionSupportError, setTableActionSupportError] = React16.useState(void 0);
		  const [maintenance, setMaintenance] = React16.useState(void 0);
		  const [databaseAction, setDatabaseAction] = React16.useState(void 0);
		  const [batchBusy, setBatchBusy] = React16.useState(false);
		  const [creatingTable, setCreatingTable] = React16.useState(false);
		  const [statsBySchema, setStatsBySchema] = React16.useState({});
		  const statsBySchemaRef = React16.useRef(statsBySchema);
		  statsBySchemaRef.current = statsBySchema;
		  const [statsLoading, setStatsLoading] = React16.useState(false);
		  const [confirming, setConfirming] = React16.useState(void 0);
		  const [acting, setActing] = React16.useState(false);
		  const loadSchemas = React16.useCallback(async () => {
		    if (source.kind === "sqlite") return;
		    try {
		      const list = await api.schemas(source.id);
		      const names = list.map((item) => item.name);
		      setSchemas(names);
		      setTablesBySchema((current) => {
		        const next = {};
		        for (const [name, tables] of Object.entries(current)) if (names.includes(name)) next[name] = tables;
		        return next;
		      });
		      setActiveSchema((current) => current !== void 0 && names.includes(current) ? current : void 0);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    }
		  }, [api, source.id, source.kind]);
		  const loadTables = React16.useCallback(async (schema, force = false) => {
		    if (schema === void 0) return;
		    if (!force && tablesBySchema[schema] !== void 0) return;
		    setLoadingSchemas((current) => ({ ...current, [schema]: true }));
		    try {
		      const list = await api.tables(source.id, schema);
		      setTablesBySchema((current) => ({ ...current, [schema]: list }));
		      setError(void 0);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		      setTablesBySchema((current) => ({ ...current, [schema]: [] }));
		    } finally {
		      setLoadingSchemas((current) => ({ ...current, [schema]: false }));
		    }
		  }, [api, source.id, tablesBySchema]);
		  React16.useEffect(() => {
		    void loadSchemas();
		  }, [loadSchemas]);
		  React16.useEffect(() => {
		    let live = true;
		    void api.maintenanceSupport(source.id).then((support) => {
		      if (live) setMaintenanceSupport(support);
		    }).catch(() => {
		      if (live) setMaintenanceSupport([]);
		    });
		    return () => {
		      live = false;
		    };
		  }, [api, source.id]);
		  React16.useEffect(() => {
		    let live = true;
		    void api.tableActionSupport(source.id).then((support) => {
		      if (live) {
		        setTableActionSupport(support);
		        setTableActionSupportError(void 0);
		      }
		    }).catch((failure) => {
		      if (!live) return;
		      setTableActionSupport([]);
		      setTableActionSupportError(failure instanceof Error ? failure.message : String(failure));
		    });
		    return () => {
		      live = false;
		    };
		  }, [api, source.id]);
		  React16.useEffect(() => {
		    if (schemas.length !== 1) return;
		    const only = schemas[0];
		    setOpenSchemas((current) => current[only] === void 0 ? { ...current, [only]: true } : current);
		    void loadTables(only);
		  }, [schemas, loadTables]);
		  const loadStats = React16.useCallback(async (schema, force = false) => {
		    if (!force && statsBySchemaRef.current[schema] !== void 0) return;
		    setStatsLoading(true);
		    try {
		      const list = await api.tables(source.id, schema, true);
		      setStatsBySchema((current) => ({ ...current, [schema]: list }));
		      setError(void 0);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		      setStatsBySchema((current) => ({ ...current, [schema]: [] }));
		    } finally {
		      setStatsLoading(false);
		    }
		  }, [api, source.id]);
		  React16.useEffect(() => {
		    if (activeSchema === void 0) return;
		    if (statsLoading) return;
		    if (statsBySchema[activeSchema] !== void 0) return;
		    void loadStats(activeSchema);
		  }, [activeSchema, statsBySchema, statsLoading, loadStats]);
		  const selectSchema = (schema) => {
		    setActiveTable(void 0);
		    setActiveSchema(schema);
		    setOpenSchemas((current) => current[schema] === true ? current : { ...current, [schema]: true });
		    setError(void 0);
		    void loadTables(schema);
		    void loadStats(schema);
		  };
		  const toggleSchema = (schema) => {
		    const next = !(openSchemas[schema] ?? false);
		    setOpenSchemas((current) => ({ ...current, [schema]: next }));
		    if (next) void loadTables(schema);
		  };
		  const runTableAction = async (schema, table, op) => {
		    setActing(true);
		    try {
		      await api.tableAction(source.id, {
		        schema,
		        table: table.name,
		        op,
		        isView: table.type === "view"
		      });
		      if (op === "drop" && activeTable === table.name && activeSchema === schema) setActiveTable(void 0);
		      setConfirming(void 0);
		      setNotice(t(op === "truncate" ? "db.truncate.done" : "db.drop.done", { table: table.name }));
		      setError(void 0);
		      await loadTables(schema, true);
		      await loadStats(schema, true);
		    } catch (failure) {
		      setError(t("db.action.failed", { error: failure instanceof Error ? failure.message : String(failure) }));
		      setConfirming(void 0);
		    } finally {
		      setActing(false);
		    }
		  };
		  const runBatchAction = async (schema, tables, op) => {
		    setBatchBusy(true);
		    const failures = [];
		    let ok = 0;
		    try {
		      for (const table of tables) {
		        if (op === "truncate" && table.type === "view") continue;
		        try {
		          await api.tableAction(source.id, { schema, table: table.name, op, isView: table.type === "view" });
		          ok++;
		          if (op === "drop" && activeTable === table.name && activeSchema === schema) setActiveTable(void 0);
		        } catch (failure) {
		          failures.push(t("db.batch.failedOn", { table: table.name, error: failure instanceof Error ? failure.message : String(failure) }));
		        }
		      }
		      setSelectedTables(/* @__PURE__ */ new Set());
		      setConfirming(void 0);
		      setError(failures.length === 0 ? void 0 : failures.join("\n"));
		      setNotice(failures.length === 0 ? t(`db.batch.done.${op}`, { n: ok }) : t("db.batch.partial", { ok, failed: failures.length }));
		      await loadTables(schema, true);
		      await loadStats(schema, true);
		    } finally {
		      setBatchBusy(false);
		    }
		  };
		  const runMaintenance = async (schema, tables, op) => {
		    setMaintenance({ op, outcomes: [], running: true });
		    try {
		      const outcomes = await api.maintain(source.id, { schema, tables, op });
		      setMaintenance({ op, outcomes, running: false });
		      setError(void 0);
		      if (op === "analyze") await loadStats(schema, true);
		    } catch (failure) {
		      setMaintenance(void 0);
		      setError(t("db.action.failed", { error: failure instanceof Error ? failure.message : String(failure) }));
		    }
		  };
		  const reloadAfterDatabaseOp = async (changed) => {
		    await loadSchemas();
		    if (changed.stale !== void 0 && changed.stale.length > 0) {
		      const forget = new Set(changed.stale);
		      setStatsBySchema((current) => {
		        const next = {};
		        for (const [name, tables] of Object.entries(current)) if (!forget.has(name)) next[name] = tables;
		        return next;
		      });
		      setTablesBySchema((current) => {
		        const next = {};
		        for (const [name, tables] of Object.entries(current)) if (!forget.has(name)) next[name] = tables;
		        return next;
		      });
		      setOpenSchemas((current) => {
		        const next = { ...current };
		        for (const name of forget) delete next[name];
		        return next;
		      });
		    }
		    setSelectedTables(/* @__PURE__ */ new Set());
		    setActiveTable(void 0);
		    setActiveSchema(changed.nowOpen);
		    if (changed.nowOpen !== void 0) {
		      setOpenSchemas((current) => current[changed.nowOpen] === true ? current : { ...current, [changed.nowOpen]: true });
		      void loadTables(changed.nowOpen);
		    }
		  };
		  const loadRows = React16.useCallback(async (options) => {
		    setRows((current) => ({ page: current?.page ?? emptyPage(), loading: true, ...current?.error === void 0 ? {} : { error: current.error } }));
		    try {
		      const result = await api.rows(source.id, {
		        schema: options.schema,
		        table: options.table,
		        page: options.page,
		        pageSize: options.pageSize,
		        mode: options.mode,
		        ...options.term === void 0 ? {} : { term: options.term },
		        ...options.condition === void 0 ? {} : { condition: options.condition },
		        ...options.orderBy === void 0 ? {} : { orderBy: options.orderBy },
		        ...options.orderByColumns === void 0 ? {} : { orderByColumns: options.orderByColumns },
		        ...options.filters === void 0 ? {} : { filters: options.filters },
		        ...options.filterJoin === void 0 ? {} : { filterJoin: options.filterJoin },
		        ...options.withIndexes === true ? { withIndexes: true } : {},
		        orderDir: options.orderDir ?? "asc"
		      });
		      setRows({ page: result, loading: false });
		      if (result.indexes !== void 0) setIndexes(result.indexes);
		    } catch (failure) {
		      setRows((current) => ({ page: current?.page ?? emptyPage(), loading: false, error: failure instanceof Error ? failure.message : String(failure) }));
		    }
		  }, [api, source.id]);
		  const loadStructure = React16.useCallback(async (schema, table) => {
		    setStructureLoading(true);
		    try {
		      const [cols, idx] = await Promise.all([
		        api.columns(source.id, table, schema),
		        api.indexes(source.id, table, schema).catch(() => [])
		      ]);
		      setColumns(cols);
		      setIndexes(idx);
		      setError(void 0);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setStructureLoading(false);
		    }
		  }, [api, source.id]);
		  const reloadCurrent = React16.useCallback(() => {
		    if (activeSchema === void 0 || activeTable === void 0) return;
		    if (tab === "structure" || tab === "insert") void loadStructure(activeSchema, activeTable);
		    if (tab === "browse") {
		      void loadRows({
		        schema: activeSchema,
		        table: activeTable,
		        page: browse.page,
		        pageSize: browse.pageSize,
		        mode: "browse",
		        ...browse.orderBy === void 0 ? {} : { orderBy: browse.orderBy },
		        ...browse.orderByColumns === void 0 ? {} : { orderByColumns: browse.orderByColumns },
		        ...browse.filters === void 0 ? {} : { filters: browse.filters },
		        ...browse.filterJoin === void 0 ? {} : { filterJoin: browse.filterJoin },
		        orderDir: browse.orderDir,
		        withIndexes: true
		      });
		    }
		  }, [activeSchema, activeTable, tab, browse, loadStructure, loadRows]);
		  const openTable = (schema, table, nextTab = "browse") => {
		    setActiveSchema(schema);
		    setActiveTable(table);
		    setTab(nextTab);
		    setBrowse((current) => ({ ...current, page: 1, orderBy: void 0, orderByColumns: void 0, filters: void 0 }));
		    setError(void 0);
		    setNotice(void 0);
		    if (nextTab === "structure" || nextTab === "insert" || nextTab === "search") void loadStructure(schema, table);
		    if (nextTab === "browse") void loadRows({ schema, table, page: 1, pageSize: browse.pageSize, mode: "browse", withIndexes: true });
		  };
		  const changeTab = (next) => {
		    setTab(next);
		    setError(void 0);
		    setNotice(void 0);
		    if (activeTable === void 0 || activeSchema === void 0) return;
		    if (next === "structure" || next === "insert" || next === "search" || next === "operation") {
		      void loadStructure(activeSchema, activeTable);
		    }
		    if (next === "browse") void loadRows({
		      schema: activeSchema,
		      table: activeTable,
		      page: browse.page,
		      pageSize: browse.pageSize,
		      mode: "browse",
		      ...browse.orderBy === void 0 ? {} : { orderBy: browse.orderBy },
		      ...browse.orderByColumns === void 0 ? {} : { orderByColumns: browse.orderByColumns },
		      ...browse.filters === void 0 ? {} : { filters: browse.filters },
		      ...browse.filterJoin === void 0 ? {} : { filterJoin: browse.filterJoin },
		      orderDir: browse.orderDir,
		      withIndexes: true
		    });
		  };
		  const followMovedTable = (from, to) => {
		    setSelectedTables(/* @__PURE__ */ new Set());
		    if (from.schema === to.schema) {
		      setActiveTable(to.table);
		      setOpenSchemas((current) => current[to.schema] === true ? current : { ...current, [to.schema]: true });
		      void loadTables(to.schema, true);
		      void loadStats(to.schema, true);
		      return;
		    }
		    setActiveTable(void 0);
		    setActiveSchema(to.schema);
		    setOpenSchemas((current) => current[to.schema] === true ? current : { ...current, [to.schema]: true });
		    void loadTables(from.schema, true);
		    void loadStats(from.schema, true);
		    void loadTables(to.schema);
		  };
		  const matchesFilter = (name) => tableFilter === "" || name.toLowerCase().includes(tableFilter.toLowerCase());
		  const openImport = async (schema) => {
		    try {
		      const tables = await api.tables(source.id, schema);
		      setSchemaTables(tables.map((table) => ({ name: table.name, type: table.type })));
		    } catch (failure) {
		      setSchemaTables([]);
		      void failure;
		    }
		    setTransfer({ kind: "import" });
		  };
		  const tree = [];
		  for (const schema of schemas) {
		    const isOpen = openSchemas[schema] ?? false;
		    const tables = tablesBySchema[schema];
		    const loading = loadingSchemas[schema] === true;
		    tree.push(
		      React16.createElement(
		        "div",
		        {
		          key: `schema-${schema}`,
		          className: "dbm-tree-item",
		          // Active whenever the database is the selected one, regardless of
		          // whether a table inside it is open: the right pane shows this
		          // database's overview until a table is picked, so the node has to
		          // stay lit across both.
		          "data-active": String(activeSchema === schema),
		          title: schema,
		          role: "button",
		          tabIndex: 0,
		          onClick: () => selectSchema(schema),
		          onKeyDown: (event) => {
		            if (event.key !== "Enter" && event.key !== " ") return;
		            event.preventDefault();
		            selectSchema(schema);
		          }
		        },
		        React16.createElement(
		          "button",
		          {
		            type: "button",
		            className: "dbm-caret-btn",
		            "aria-label": isOpen ? t("db.collapse") : t("db.expand"),
		            "aria-expanded": isOpen,
		            onClick: (event) => {
		              event.stopPropagation();
		              toggleSchema(schema);
		            }
		          },
		          isOpen ? "\u25BE" : "\u25B8"
		        ),
		        React16.createElement("span", { className: "dbm-node-name" }, schema),
		        /*
		         * The count is the database's TOTAL, not the filtered subset.
		         *
		         * This number sits on the database's own row, so it answers "how many
		         * tables does this database hold". Showing the filtered count made the
		         * row claim `dbm_tree 0` while the database held five tables and the
		         * filter was simply excluding all of them — a number that contradicted
		         * what the API returns for the same database. The filter's effect is
		         * already visible in the list below the row.
		         */
		        tables === void 0 ? null : React16.createElement("span", { className: "dbm-tree-meta" }, String(tables.length))
		      )
		    );
		    if (!isOpen) continue;
		    if (loading && tables === void 0) {
		      tree.push(React16.createElement("div", { key: `loading-${schema}`, className: "dbm-tree-item dbm-tree-indent-1 dbm-hint" }, t("common.loading")));
		      continue;
		    }
		    const list = (tables ?? []).filter((table) => matchesFilter(table.name));
		    if (list.length === 0) {
		      tree.push(
		        React16.createElement(
		          "div",
		          { key: `empty-${schema}`, className: "dbm-tree-item dbm-tree-indent-1 dbm-hint" },
		          /*
		           * "No tables" and "your filter excluded them all" are different facts,
		           * and conflating them misleads in exactly the case a filter is used: a
		           * database with tables reported as having none. The filter's own text is
		           * quoted in the message so the reason is not left to be inferred.
		           */
		          tables !== void 0 && tables.length > 0 && tableFilter !== "" ? t("db.noTablesFiltered", { filter: tableFilter }) : t("db.noTables")
		        )
		      );
		      continue;
		    }
		    for (const table of list) {
		      tree.push(
		        React16.createElement(
		          "button",
		          {
		            key: `table-${schema}-${table.name}`,
		            type: "button",
		            className: "dbm-tree-item dbm-tree-indent-1",
		            // A table name alone is ambiguous across databases; the active
		            // pair is what the right-hand pane is showing.
		            "data-active": String(activeTable === table.name && activeSchema === schema),
		            title: `${schema}.${table.name}${table.comment === void 0 ? "" : ` \u2014 ${table.comment}`}`,
		            onClick: () => openTable(schema, table.name)
		          },
		          React16.createElement("span", { className: "dbm-tree-caret" }, table.type === "view" ? "\u25EB" : "\u25A4"),
		          React16.createElement("span", { className: "dbm-tree-name" }, table.name),
		          table.rows === void 0 ? null : React16.createElement("span", { className: "dbm-tree-meta" }, String(table.rows))
		        )
		      );
		    }
		  }
		  const [sideRefreshing, setSideRefreshing] = React16.useState(false);
		  const refreshSide = React16.useCallback(async () => {
		    setSideRefreshing(true);
		    try {
		      await loadSchemas();
		      const open = schemas.filter((schema) => openSchemas[schema] === true);
		      await Promise.all(open.map((schema) => loadTables(schema, true)));
		    } finally {
		      setSideRefreshing(false);
		    }
		  }, [loadSchemas, loadTables, schemas, openSchemas]);
		  const left = React16.createElement(
		    "div",
		    { className: "dbm-side" },
		    React16.createElement(
		      "div",
		      { className: "dbm-side-head" },
		      React16.createElement("input", {
		        className: "dbm-input",
		        style: { flex: 1 },
		        value: tableFilter,
		        placeholder: t("db.searchTable"),
		        onChange: (event) => setTableFilter(event.target.value)
		      }),
		      /*
		       * 新建数据库 sits here, immediately left of the refresh control.
		       *
		       * It was a labelled button in the overview toolbar, which is a long way from
		       * where a database is chosen and reads as an action on the tables below it.
		       * A "+" beside the refresh control is where a user looks for "add another one
		       * of the things this list holds" — the list is the database tree, so the
		       * button belongs to the tree's own header.
		       *
		       * Absent on SQLite, where there is no `CREATE DATABASE`: a SQLite database is a
		       * file, so creating one means creating a data source. Offering the control
		       * there would be a button whose only outcome is an explanation.
		       */
		      source.kind === "mysql" ? React16.createElement("button", {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        title: t("db.op.create"),
		        "aria-label": t("db.op.create"),
		        "data-dbm-side-create": "",
		        onClick: () => setDatabaseAction("create")
		      }, "+") : null,
		      React16.createElement(
		        "button",
		        {
		          type: "button",
		          className: `dbm-btn dbm-btn-sm${sideRefreshing ? " dbm-btn-busy" : ""}`,
		          title: t("common.refresh"),
		          disabled: sideRefreshing,
		          "aria-busy": sideRefreshing ? "true" : void 0,
		          "data-dbm-side-refresh": "",
		          onClick: () => {
		            void refreshSide();
		          }
		        },
		        sideRefreshing ? React16.createElement("span", { className: "dbm-spinner" }) : "\u27F3"
		      )
		    ),
		    React16.createElement("div", { className: "dbm-side-body" }, tree)
		  );
		  const selection = activeSchema !== void 0 && activeTable !== void 0 ? { schema: activeSchema, table: activeTable } : void 0;
		  const body = [];
		  if (activeSchema === void 0) {
		    body.push(React16.createElement(Empty, { key: "empty", message: t("db.selectSchema") }));
		  } else if (selection === void 0) {
		    body.push(
		      React16.createElement(TableOverview, {
		        key: "overview",
		        schema: activeSchema,
		        tables: statsBySchema[activeSchema],
		        filter: tableFilter,
		        onFilter: setTableFilter,
		        loading: statsLoading,
		        onOpen: (table, nextTab) => openTable(activeSchema, table.name, nextTab),
		        onTruncate: (table) => setConfirming({ kind: "single", table, schema: activeSchema, op: "truncate" }),
		        onDrop: (table) => setConfirming({ kind: "single", table, schema: activeSchema, op: "drop" }),
		        onRefresh: () => {
		          void loadTables(activeSchema, true);
		          void loadStats(activeSchema, true);
		        },
		        selected: selectedTables,
		        onSelect: setSelectedTables,
		        maintenanceSupport,
		        engineKind: source.kind,
		        busy: batchBusy || acting,
		        onBatchTruncate: (tables) => setConfirming({ kind: "batch", schema: activeSchema, tables, op: "truncate" }),
		        onBatchDrop: (tables) => setConfirming({ kind: "batch", schema: activeSchema, tables, op: "drop" }),
		        onBatchExport: (tables) => setTransfer({ kind: "export", tables: tables.map((table) => table.name) }),
		        onMaintain: (op, tables) => {
		          void runMaintenance(activeSchema, tables, op);
		        },
		        onExportDatabase: () => setTransfer({ kind: "export" }),
		        onImportDatabase: () => {
		          void openImport(activeSchema);
		        },
		        onCreateTable: () => setCreatingTable(true),
		        onDatabaseAction: (action) => setDatabaseAction(action)
		      })
		    );
		  } else {
		    body.push(
		      React16.createElement(TabStrip, {
		        key: "tabs",
		        active: tab,
		        tabs: [
		          { id: "browse", label: t("tab.browse") },
		          { id: "structure", label: t("tab.structure") },
		          { id: "sql", label: t("tab.sql") },
		          { id: "search", label: t("tab.search") },
		          { id: "insert", label: t("tab.insert") },
		          // 操作 (phpMyAdmin's own name for this page) goes LAST, after 插入: it is where
		          // the table-level operations live, and a tab that can drop the table should
		          // not sit between the ones that only read or write rows.
		          { id: "operation", label: t("tab.operation") }
		        ],
		        onChange: (next) => changeTab(next)
		      })
		    );
		    if (tab === "browse") {
		      body.push(React16.createElement(SqlBrowseTab, {
		        key: "browse-body",
		        api,
		        sourceId: source.id,
		        schema: selection.schema,
		        table: selection.table,
		        rows,
		        query: browse,
		        knownColumns: columns,
		        /**
		         * A layout change re-reads from page 1 unless it is a page move.
		         *
		         * Sorting, filtering and a page-size change all redefine what "page 1" is,
		         * so staying on page 7 of the old ordering would show an arbitrary slice.
		         */
		        onQuery: (next) => {
		          const merged = { ...browse, ...next };
		          setBrowse(merged);
		          void loadRows({
		            schema: selection.schema,
		            table: selection.table,
		            page: merged.page,
		            pageSize: merged.pageSize,
		            mode: "browse",
		            ...merged.orderBy === void 0 ? {} : { orderBy: merged.orderBy },
		            ...merged.orderByColumns === void 0 ? {} : { orderByColumns: merged.orderByColumns },
		            ...merged.filters === void 0 ? {} : { filters: merged.filters },
		            ...merged.filterJoin === void 0 ? {} : { filterJoin: merged.filterJoin },
		            orderDir: merged.orderDir,
		            withIndexes: true
		          });
		        },
		        onReload: reloadCurrent,
		        onExport: (options) => setTransfer({
		          kind: "export",
		          ...options?.rowsOnly === true ? { rowsOnly: true } : {},
		          ...options?.selectedKeys === void 0 ? {} : { selectedKeys: options.selectedKeys }
		        }),
		        onImport: () => {
		          void openImport(selection.schema);
		        },
		        onNotice: (message) => {
		          setNotice(message);
		          if (message !== void 0) setError(void 0);
		        },
		        onError: (message) => {
		          setError(message);
		          if (message !== void 0) setNotice(void 0);
		        }
		      }));
		    }
		    if (tab === "structure") {
		      body.push(React16.createElement(SqlStructureTab, {
		        key: "structure-body",
		        api,
		        sourceId: source.id,
		        schema: selection.schema,
		        table: selection.table,
		        kind: source.kind,
		        columns,
		        indexes,
		        // The real in-flight flag, so a REFRESH of a table that already has columns
		        // also shows its busy state.
		        loading: structureLoading,
		        ...error === void 0 ? {} : { error },
		        onReload: () => {
		          void loadStructure(selection.schema, selection.table);
		        },
		        onReloadRows: () => {
		          void loadTables(selection.schema, true);
		          reloadCurrent();
		        },
		        onNotice: (message) => {
		          setNotice(message);
		          if (message !== void 0) setError(void 0);
		        },
		        onError: (message) => {
		          setError(message);
		          if (message !== void 0) setNotice(void 0);
		        }
		      }));
		    }
		    if (tab === "sql") {
		      body.push(
		        React16.createElement(SqlTabView, {
		          key: "sql-body",
		          source,
		          schema: activeSchema,
		          api,
		          onResult: (message) => {
		            setNotice(message);
		            setError(void 0);
		          },
		          onError: (message) => {
		            setError(message);
		            setNotice(void 0);
		          }
		        })
		      );
		    }
		    if (tab === "search") {
		      body.push(
		        React16.createElement(SqlSearchTab, {
		          key: "search-body",
		          columns,
		          filters: browse.filters ?? [],
		          loading: rows?.loading === true,
		          ...rows?.page === void 0 ? {} : { total: rows.page.total },
		          onSearch: (filters) => {
		            const merged = {
		              ...browse,
		              page: 1,
		              ...filters.length === 0 ? { filters: void 0, filterJoin: void 0 } : { filters, filterJoin: "and" }
		            };
		            setBrowse(merged);
		            void loadRows({
		              schema: selection.schema,
		              table: selection.table,
		              page: 1,
		              pageSize: merged.pageSize,
		              mode: "search",
		              ...filters.length === 0 ? {} : { filters, filterJoin: "and" }
		            });
		          },
		          onError: (message) => {
		            setError(message);
		            if (message !== void 0) setNotice(void 0);
		          },
		          /*
		           * The RESULTS, rendered by the browse grid in read-only mode.
		           *
		           * Without this the tab was a form with nothing under it: a search ran,
		           * the rows came back, and the user saw no result at all. Reusing the
		           * grid keeps the paging, the sort and the cell copy identical to 浏览 —
		           * and the rows are shown WITHOUT editing, because a result set is a
		           * view onto a query rather than a table with stable keys.
		           */
		          results: React16.createElement(SqlBrowseTab, {
		            key: "search-results",
		            api,
		            sourceId: source.id,
		            schema: selection.schema,
		            table: selection.table,
		            rows,
		            query: { ...browse, mode: "search" },
		            knownColumns: columns,
		            readOnly: true,
		            onQuery: (next) => {
		              const merged = { ...browse, ...next };
		              setBrowse(merged);
		              void loadRows({
		                schema: selection.schema,
		                table: selection.table,
		                page: merged.page,
		                pageSize: merged.pageSize,
		                mode: "search",
		                ...merged.filters === void 0 ? {} : { filters: merged.filters },
		                ...merged.filterJoin === void 0 ? {} : { filterJoin: merged.filterJoin },
		                ...merged.orderBy === void 0 ? {} : { orderBy: merged.orderBy },
		                ...merged.orderByColumns === void 0 ? {} : { orderByColumns: merged.orderByColumns },
		                orderDir: merged.orderDir,
		                withIndexes: true
		              });
		            },
		            onReload: reloadCurrent,
		            onExport: (options) => setTransfer({
		              kind: "export",
		              ...options?.rowsOnly === true ? { rowsOnly: true } : {},
		              ...options?.selectedKeys === void 0 ? {} : { selectedKeys: options.selectedKeys }
		            }),
		            onImport: () => {
		              void openImport(selection.schema);
		            },
		            onNotice: (message) => {
		              setNotice(message);
		              if (message !== void 0) setError(void 0);
		            },
		            onError: (message) => {
		              setError(message);
		              if (message !== void 0) setNotice(void 0);
		            }
		          })
		        })
		      );
		    }
		    if (tab === "insert") {
		      body.push(
		        React16.createElement(SqlInsertTab, {
		          key: "insert-body",
		          api,
		          source,
		          schema: selection.schema,
		          table: selection.table,
		          columns,
		          loading: columns.length === 0,
		          /*
		           * A single-row insert lands on 浏览; a batch stays on the form.
		           *
		           * This is what was reported: 插入后还停留在插入 tab. The two submit buttons
		           * mean different things and so deserve different outcomes — 插入完成了一次
		           * 写入，用户接着要看的是写进去的那一行；而「插入并再填一行」的存在理由就是
		           * 继续填同批数据，跳走会让这个按钮失去意义（phpMyAdmin 同样是这个行为）。
		           */
		          onDone: (message, outcome) => {
		            setError(void 0);
		            void loadTables(selection.schema, true);
		            void loadStats(selection.schema, true);
		            if (outcome === "inserted") {
		              changeTab("browse");
		              setNotice(message);
		            } else {
		              setNotice(message);
		            }
		          },
		          onError: (message) => {
		            setError(message);
		            if (message !== void 0) setNotice(void 0);
		          }
		        })
		      );
		    }
		    if (tab === "operation") {
		      const info = (tablesBySchema[selection.schema] ?? []).find((candidate) => candidate.name === selection.table) ?? { name: selection.table, type: "table" };
		      body.push(
		        React16.createElement(SqlOperationsTab, {
		          key: "operation-body",
		          api,
		          sourceId: source.id,
		          engineKind: source.kind,
		          schema: selection.schema,
		          table: selection.table,
		          schemas,
		          // Passed through UNSET rather than defaulted to an empty list: the tab tells
		          // "this engine supports none of them" from "not read yet" by it, and an empty
		          // list would make every block flash a disabled-with-reason state on open.
		          support: tableActionSupport,
		          ...tableActionSupportError === void 0 ? {} : { supportError: tableActionSupportError },
		          maintenanceSupport,
		          busy: batchBusy,
		          onBusy: setBatchBusy,
		          onNotice: (message) => {
		            setNotice(message);
		            if (message !== void 0) setError(void 0);
		          },
		          onError: (message) => {
		            setError(message);
		            if (message !== void 0) setNotice(void 0);
		          },
		          onMaintain: (op) => {
		            void runMaintenance(selection.schema, [selection.table], op);
		          },
		          onAskDanger: (op) => setConfirming({ kind: "single", table: info, schema: selection.schema, op }),
		          onMoved: (next) => followMovedTable({ schema: selection.schema, table: selection.table }, next),
		          onTablesChanged: () => {
		            void loadTables(selection.schema, true);
		            void loadStats(selection.schema, true);
		          }
		        })
		      );
		    }
		  }
		  return React16.createElement(
		    "div",
		    { className: "dbm-root" },
		    React16.createElement(
		      "div",
		      { className: "dbm-header" },
		      React16.createElement(BackButton, { onBack, label: t("panel.backToList") }),
		      React16.createElement("span", { className: "dbm-title" }, source.name),
		      React16.createElement("span", { className: `dbm-badge dbm-badge-${source.kind}` }, source.kind),
		      React16.createElement("span", { className: "dbm-subtitle dbm-mono" }, source.kind === "sqlite" ? source.file ?? "" : `${source.host ?? ""}:${source.port ?? ""}`),
		      React16.createElement("span", { className: "dbm-spacer" }),
		      React16.createElement(BackButton, { onBack: onClose })
		    ),
		    error === void 0 ? null : React16.createElement(ErrorBanner, { message: error }),
		    notice === void 0 ? null : React16.createElement("div", { className: "dbm-ok", style: { padding: "6px 14px" } }, notice),
		    React16.createElement("div", { className: "dbm-split" }, left, React16.createElement("div", { className: "dbm-main" }, body)),
		    confirming === void 0 ? null : React16.createElement(TableActionDialog, {
		      key: "confirm",
		      state: confirming,
		      busy: acting || batchBusy,
		      onCancel: () => setConfirming(void 0),
		      onConfirm: () => {
		        if (confirming.kind === "single") void runTableAction(confirming.schema, confirming.table, confirming.op);
		        else void runBatchAction(confirming.schema, confirming.tables, confirming.op);
		      }
		    }),
		    transfer === void 0 ? null : transfer.kind === "export" ? React16.createElement(ExportDialog, {
		      key: "export",
		      api,
		      source,
		      schema: activeSchema ?? "",
		      ...activeTable === void 0 ? {} : { table: activeTable },
		      tableCount: schemaTables.length,
		      ...transfer.selectedKeys === void 0 ? {} : { selectedKeys: transfer.selectedKeys },
		      ...transfer.rowsOnly === true ? { rowsOnly: true } : {},
		      ...transfer.tables === void 0 ? {} : { tables: transfer.tables },
		      onClose: () => setTransfer(void 0),
		      onDone: (message) => {
		        setNotice(message);
		        setError(void 0);
		      },
		      onError: (message) => {
		        setError(message);
		        setNotice(void 0);
		      }
		    }) : React16.createElement(ImportDialog, {
		      key: "import",
		      api,
		      source,
		      schema: activeSchema ?? "",
		      ...activeTable === void 0 ? {} : { table: activeTable },
		      tables: schemaTables,
		      onClose: () => setTransfer(void 0),
		      onDone: (message) => {
		        setNotice(message);
		        setError(void 0);
		        if (activeSchema !== void 0) {
		          void loadTables(activeSchema, true);
		          void loadStats(activeSchema, true);
		        }
		      },
		      onError: (message) => {
		        setError(message);
		        setNotice(void 0);
		      }
		    }),
		    maintenance === void 0 ? null : React16.createElement(MaintenanceReportDialog, {
		      key: "maintenance",
		      outcomes: maintenance.outcomes,
		      running: maintenance.running,
		      ...maintenance.op === void 0 ? {} : { op: maintenance.op },
		      engineKind: source.kind,
		      onClose: () => setMaintenance(void 0)
		    }),
		    creatingTable && activeSchema !== void 0 ? React16.createElement(CreateTableDialog, {
		      key: "create-table",
		      api,
		      sourceId: source.id,
		      schema: activeSchema,
		      kind: source.kind,
		      existingTables: (statsBySchema[activeSchema] ?? []).map((table) => table.name),
		      onClose: () => setCreatingTable(false),
		      onCreated: (table) => {
		        setCreatingTable(false);
		        setNotice(t("createTable.done", { table }));
		        setError(void 0);
		        void loadTables(activeSchema, true);
		        void loadStats(activeSchema, true);
		      },
		      onError: (message) => {
		        if (message !== "") setError(message);
		      }
		    }) : null,
		    databaseAction === void 0 ? null : React16.createElement(DatabaseActionDialog, {
		      key: "db-action",
		      api,
		      sourceId: source.id,
		      engineKind: source.kind,
		      ...activeSchema === void 0 ? {} : { schema: activeSchema },
		      schemas,
		      action: databaseAction,
		      busy: batchBusy,
		      onBusy: setBatchBusy,
		      onClose: () => setDatabaseAction(void 0),
		      onDone: (message, changed) => {
		        setDatabaseAction(void 0);
		        setNotice(message);
		        setError(void 0);
		        void reloadAfterDatabaseOp(changed);
		      },
		      onError: (message) => {
		        setError(message === "" ? void 0 : message);
		        if (message !== "") setNotice(void 0);
		      }
		    })
		  );
		}
		function TableActionDialog(props) {
		  const { state, busy, onCancel, onConfirm } = props;
		  const truncate = state.op === "truncate";
		  if (state.kind === "batch") {
		    const views = state.tables.filter((table) => table.type === "view");
		    return React16.createElement(Modal, {
		      title: t(truncate ? "db.batch.truncateTitle" : "db.batch.dropTitle"),
		      onClose: onCancel,
		      footer: [
		        React16.createElement("button", { key: "cancel", type: "button", className: "dbm-btn", disabled: busy, onClick: onCancel }, t("common.cancel")),
		        React16.createElement(
		          "button",
		          { key: "ok", type: "button", className: "dbm-btn dbm-btn-danger", disabled: busy, "data-dbm-batch-confirm": "", onClick: onConfirm },
		          busy ? t("common.loading") : t(truncate ? "db.batch.truncate" : "db.batch.drop")
		        )
		      ],
		      children: React16.createElement(
		        "div",
		        null,
		        React16.createElement("div", null, t(truncate ? "db.batch.truncateBody" : "db.batch.dropBody", { n: state.tables.length })),
		        React16.createElement(
		          "div",
		          { className: "dbm-hint dbm-mono", style: { marginTop: 8, wordBreak: "break-all" } },
		          state.tables.map((table) => table.name).join("\u3001")
		        ),
		        truncate && views.length > 0 ? React16.createElement("div", { className: "dbm-hint", style: { marginTop: 8 } }, t("db.batch.truncateSkipped", { n: views.length })) : null
		      )
		    });
		  }
		  const single = state.table;
		  const isView = single.type === "view";
		  const body = truncate ? isView ? t("db.truncate.bodyView", { table: single.name }) : t("db.truncate.body", { table: single.name }) : isView ? t("db.drop.bodyView", { table: single.name }) : t("db.drop.body", { table: single.name });
		  return React16.createElement(Modal, {
		    title: t(truncate ? "db.truncate.title" : "db.drop.title"),
		    onClose: onCancel,
		    footer: [
		      React16.createElement("button", { key: "cancel", type: "button", className: "dbm-btn", disabled: busy, onClick: onCancel }, t("common.cancel")),
		      React16.createElement(
		        "button",
		        {
		          key: "ok",
		          type: "button",
		          className: "dbm-btn dbm-btn-danger",
		          // Refused before it is attempted when the engine cannot do it at all.
		          disabled: busy || truncate && isView,
		          "data-dbm-single-confirm": "",
		          onClick: onConfirm
		        },
		        busy ? t("common.loading") : t(truncate ? "db.action.truncate" : "db.action.drop")
		      )
		    ],
		    children: React16.createElement("div", null, body)
		  });
		}
		function TableOverview(props) {
		  const {
		    schema,
		    tables,
		    filter,
		    onFilter,
		    loading,
		    onOpen,
		    onTruncate,
		    onDrop,
		    onRefresh,
		    selected,
		    onSelect,
		    maintenanceSupport,
		    engineKind,
		    busy,
		    onBatchTruncate,
		    onBatchDrop,
		    onBatchExport,
		    onMaintain,
		    onExportDatabase,
		    onImportDatabase,
		    onDatabaseAction,
		    onCreateTable
		  } = props;
		  if (tables === void 0) {
		    return React16.createElement(
		      "div",
		      { className: "dbm-tab-body" },
		      React16.createElement("div", { className: "dbm-pad dbm-hint" }, t("db.loadingStats"))
		    );
		  }
		  const needle = filter.trim().toLowerCase();
		  const list = needle === "" ? tables : tables.filter((table) => table.name.toLowerCase().includes(needle));
		  const visibleSelected = list.filter((table) => selected.has(table.name));
		  const allSelected = list.length > 0 && visibleSelected.length === list.length;
		  const toggle = (name, checked) => {
		    const next = new Set(selected);
		    if (checked) next.add(name);
		    else next.delete(name);
		    onSelect(next);
		  };
		  const action = (key, label, onClick, danger = false, disabled = false, title) => React16.createElement(
		    "button",
		    {
		      key,
		      type: "button",
		      className: `dbm-btn dbm-btn-sm${danger ? " dbm-btn-danger" : ""}`,
		      disabled,
		      ...title === void 0 ? {} : { title },
		      onClick
		    },
		    label
		  );
		  return React16.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    /*
		     * The database-level toolbar.
		     *
		     * Separate from the table filter below it, because these act on the DATABASE
		     * rather than on a table: mixing them into one row made the actions sit next to
		     * "filter tables", which reads as if they filtered something.
		     *
		     * 新建数据库 is NOT here: it lives in the sidebar header beside the refresh
		     * control, next to the database list it adds to. See the sidebar's own comment.
		     */
		    React16.createElement(
		      "div",
		      { className: "dbm-toolbar", "data-dbm-db-toolbar": "" },
		      React16.createElement("span", { className: "dbm-hint" }, `${t("db.op.title")}\uFF1A`),
		      React16.createElement("button", {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        disabled: busy,
		        "data-dbm-dbop": "export",
		        onClick: onExportDatabase
		      }, t("db.op.exportDb")),
		      React16.createElement("button", {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        "data-dbm-dbop": "import",
		        onClick: onImportDatabase
		      }, t("db.op.importDb")),
		      React16.createElement("span", { className: "dbm-batch-sep" }),
		      React16.createElement("button", {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        disabled: busy,
		        "data-dbm-dbop": "rename",
		        onClick: () => onDatabaseAction("rename")
		      }, t("db.op.rename")),
		      React16.createElement("button", {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        disabled: busy,
		        "data-dbm-dbop": "copy",
		        onClick: () => onDatabaseAction("copy")
		      }, t("db.op.copy")),
		      // SQLite has no per-database charset, so the button is disabled with the reason
		      // rather than hidden: a missing control the docs mention is harder to explain.
		      React16.createElement("button", {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        disabled: busy || engineKind === "sqlite",
		        title: engineKind === "sqlite" ? t("db.op.charsetNoSqlite") : void 0,
		        "data-dbm-dbop": "charset",
		        onClick: () => onDatabaseAction("charset")
		      }, t("db.op.charset")),
		      React16.createElement("span", { className: "dbm-spacer" }),
		      React16.createElement("button", {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm dbm-btn-danger",
		        disabled: busy,
		        "data-dbm-dbop": "drop",
		        onClick: () => onDatabaseAction("drop")
		      }, t("db.op.drop"))
		    ),
		    React16.createElement(
		      "div",
		      { className: "dbm-toolbar" },
		      React16.createElement("span", { className: "dbm-hint" }, t("db.filterPlaceholder")),
		      React16.createElement("input", {
		        className: "dbm-input",
		        value: filter,
		        // No placeholder here: the tree's own filter box already says
		        // "search table names"; two identical hints a column apart read as a
		        // duplicated control rather than two different ones.
		        onChange: (event) => onFilter(event.target.value)
		      }),
		      React16.createElement("span", { className: "dbm-hint" }, t("db.overviewFor", { schema, n: tables.length })),
		      React16.createElement("span", { className: "dbm-spacer" }),
		      /*
		       * 新建表 sits on the ROW OF TABLE controls, not with the database actions above.
		       *
		       * It creates a table in this database, so it belongs beside the table list and
		       * its filter — the row whose subject it shares. Putting it among 重命名/复制/
		       * 删除 would file it under "things that act on the database", which it is not.
		       *
		       * A freshly created database has no tables, and until now no way to get one: the
		       * panel could browse, alter and drop tables but had no way to create one.
		       */
		      React16.createElement("button", {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        disabled: busy,
		        "data-dbm-dbop": "create-table",
		        onClick: onCreateTable
		      }, `+ ${t("db.op.createTable")}`),
		      /*
		       * The refresh control carries its own busy state, rather than a hint sitting
		       * beside it. A listing of a large database can take seconds (the SQLite side
		       * walks the file's page map for the sizes), and a control that looks inert for
		       * that long reads as a broken button.
		       */
		      React16.createElement(
		        "button",
		        {
		          type: "button",
		          className: `dbm-btn dbm-btn-sm${loading ? " dbm-btn-busy" : ""}`,
		          disabled: loading,
		          "aria-busy": loading ? "true" : void 0,
		          "data-dbm-overview-refresh": "",
		          onClick: onRefresh
		        },
		        loading ? [React16.createElement("span", { key: "spin", className: "dbm-spinner" }), t("common.loading")] : t("common.refresh")
		      )
		    ),
		    React16.createElement(TableBatchBar, {
		      key: "batch",
		      selected: visibleSelected.map((table) => table.name),
		      tables: list,
		      schema,
		      busy,
		      support: maintenanceSupport,
		      engineKind,
		      allSelected,
		      onToggleAll: (checked) => onSelect(checked ? new Set(list.map((table) => table.name)) : /* @__PURE__ */ new Set()),
		      onExport: () => onBatchExport(visibleSelected),
		      onTruncate: () => onBatchTruncate(visibleSelected),
		      onDrop: () => onBatchDrop(visibleSelected),
		      onMaintain: (op) => onMaintain(op, visibleSelected.map((table) => table.name)),
		      onClear: () => onSelect(/* @__PURE__ */ new Set())
		    }),
		    list.length === 0 ? React16.createElement(Empty, { message: tables.length === 0 ? t("db.overviewEmpty") : t("list.emptyFiltered") }) : React16.createElement(
		      "div",
		      { className: "dbm-scroll" },
		      React16.createElement(
		        "table",
		        { className: "dbm-table" },
		        React16.createElement(
		          "thead",
		          null,
		          React16.createElement(
		            "tr",
		            null,
		            React16.createElement(
		              "th",
		              { key: "__select", className: "dbm-table-select-col" },
		              React16.createElement("input", {
		                type: "checkbox",
		                checked: allSelected,
		                disabled: list.length === 0,
		                "aria-label": t("db.selectAll"),
		                title: allSelected ? t("db.selectNone") : t("db.selectAll"),
		                onChange: (event) => onSelect(
		                  event.target.checked ? new Set(list.map((table) => table.name)) : /* @__PURE__ */ new Set()
		                )
		              })
		            ),
		            ...[t("db.col.table"), t("db.col.actions"), t("db.col.rows"), t("db.col.type"), t("db.col.collation"), t("db.col.size"), t("db.col.comment")].map(
		              (label) => React16.createElement("th", { key: label }, label)
		            )
		          )
		        ),
		        React16.createElement(
		          "tbody",
		          null,
		          list.map(
		            (table) => React16.createElement(
		              "tr",
		              { key: table.name, "data-selected": String(selected.has(table.name)) },
		              React16.createElement(
		                "td",
		                { className: "dbm-table-select-col" },
		                React16.createElement("input", {
		                  type: "checkbox",
		                  checked: selected.has(table.name),
		                  "aria-label": t("db.select"),
		                  "data-dbm-table-select": table.name,
		                  onChange: (event) => toggle(table.name, event.target.checked)
		                })
		              ),
		              React16.createElement(
		                "td",
		                null,
		                React16.createElement(
		                  "button",
		                  { type: "button", className: "dbm-link", onClick: () => onOpen(table, "browse") },
		                  table.name
		                )
		              ),
		              React16.createElement(
		                "td",
		                null,
		                React16.createElement(
		                  "div",
		                  { className: "dbm-actions" },
		                  action("browse", t("db.action.browse"), () => onOpen(table, "browse")),
		                  action("structure", t("db.action.structure"), () => onOpen(table, "structure")),
		                  action("search", t("db.action.search"), () => onOpen(table, "search")),
		                  action("insert", t("db.action.insert"), () => onOpen(table, "insert")),
		                  // A view has no rows of its own, so 清空 would be a lie;
		                  // it stays visible but disabled, with the dialog saying why.
		                  action(
		                    "truncate",
		                    t("db.action.truncate"),
		                    () => onTruncate(table),
		                    false,
		                    table.type === "view",
		                    table.type === "view" ? t("db.truncate.bodyView", { table: table.name }) : void 0
		                  ),
		                  action("drop", t("db.action.drop"), () => onDrop(table), true)
		                )
		              ),
		              /*
		               * An absent count means UNKNOWN, not zero. SQLite keeps no
		               * row-count statistic until ANALYZE runs, and this panel does not
		               * run it as a side effect of listing — the 分析 batch action is how
		               * a user asks for it. Rendering 0 there would state something false
		               * about a table that may hold millions.
		               */
		              React16.createElement(
		                "td",
		                { className: "dbm-mono" },
		                table.rows === void 0 ? React16.createElement("span", { className: "dbm-hint", title: t("db.rowsUnknown.hint") }, t("db.rowsUnknown")) : table.rows.toLocaleString()
		              ),
		              React16.createElement(
		                "td",
		                null,
		                // phpMyAdmin's 类型 column is the storage engine (InnoDB,
		                // MyISAM). SQLite has exactly one storage engine and reports
		                // none, so it falls back to the object kind — which is the
		                // distinction that actually varies there.
		                table.engine ?? (table.type === "view" ? t("db.type.view") : t("db.type.table"))
		              ),
		              React16.createElement("td", { className: "dbm-mono" }, table.collation ?? t("common.none")),
		              React16.createElement("td", { className: "dbm-mono" }, formatBytes(table.size)),
		              React16.createElement("td", { title: table.comment ?? "" }, table.comment ?? "")
		            )
		          )
		        )
		      )
		    )
		  );
		}
		function emptyPage() {
		  return { columns: [], rows: [], total: 0, page: 1, pageSize: 200, primaryKey: [] };
		}
		function SqlTabView(props) {
		  const { api, source, schema, onResult, onError } = props;
		  const [sql, setSql] = React16.useState("");
		  const [allowWrite, setAllowWrite] = React16.useState(false);
		  const [result, setResult] = React16.useState(void 0);
		  const [busy, setBusy] = React16.useState(false);
		  const run = async () => {
		    if (sql.trim() === "") return;
		    setBusy(true);
		    setResult(void 0);
		    try {
		      const value = await api.runSql(source.id, {
		        sql,
		        ...schema === void 0 ? {} : { schema },
		        allowWrite
		      });
		      if (value.write) {
		        setResult({ columns: [], rows: [], message: t("sql.affected", { n: value.affected, ms: value.durationMs }) });
		        onResult(t("sql.affected", { n: value.affected, ms: value.durationMs }));
		      } else {
		        const message = `${t("sql.rows", { n: value.rows.length, ms: value.durationMs })}${value.truncated ? ` \xB7 ${t("sql.truncated")}` : ""}`;
		        setResult({ columns: value.columns, rows: value.rows, message });
		        onResult(message);
		      }
		    } catch (failure) {
		      onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  return React16.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React16.createElement(
		      "div",
		      { className: "dbm-pad" },
		      React16.createElement("textarea", {
		        className: "dbm-textarea",
		        rows: 6,
		        value: sql,
		        placeholder: t("sql.placeholder"),
		        spellcheck: false,
		        onChange: (event) => setSql(event.target.value),
		        onKeyDown: (event) => {
		          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
		            event.preventDefault();
		            void run();
		          }
		        }
		      }),
		      React16.createElement(
		        "div",
		        { className: "dbm-row" },
		        React16.createElement("button", { type: "button", className: "dbm-btn dbm-btn-primary", disabled: busy, onClick: () => {
		          void run();
		        } }, busy ? t("sql.running") : t("sql.run")),
		        React16.createElement(
		          "label",
		          { className: "dbm-check" },
		          React16.createElement("input", {
		            type: "checkbox",
		            checked: allowWrite,
		            onChange: (event) => setAllowWrite(event.target.checked)
		          }),
		          t("sql.allowWrite")
		        ),
		        React16.createElement("span", { className: "dbm-hint" }, t("sql.allowWrite.hint"))
		      )
		    ),
		    result === void 0 ? null : React16.createElement(
		      "div",
		      { className: "dbm-tab-body", style: { minHeight: 0 } },
		      React16.createElement("div", { className: "dbm-pad dbm-hint" }, result.message),
		      result.columns.length === 0 ? null : React16.createElement(
		        "div",
		        { className: "dbm-data" },
		        React16.createElement(
		          "table",
		          null,
		          React16.createElement("thead", null, React16.createElement("tr", null, result.columns.map((column) => React16.createElement("th", { key: column }, column)))),
		          React16.createElement(
		            "tbody",
		            null,
		            result.rows.map(
		              (row, index) => React16.createElement(
		                "tr",
		                { key: index },
		                row.map(
		                  (cell, cellIndex) => React16.createElement(
		                    "td",
		                    { key: cellIndex, className: isNull(cell) ? "dbm-null" : void 0, title: renderCell(cell) },
		                    renderCell(cell)
		                  )
		                )
		              )
		            )
		          )
		        )
		      )
		    )
		  );
		}

		// src/client/DatabasePanel.ts
		function DatabasePanel(props) {
		  const { controller, api, localeTick, onClose } = props;
		  const [snapshot, setSnapshot] = React17.useState(() => controller.getSnapshot());
		  const [sources, setSources] = React17.useState(void 0);
		  const [settings, setSettings] = React17.useState({ allowAgentWrite: false, requireApproval: true });
		  const [engines, setEngines] = React17.useState([]);
		  const [error, setError] = React17.useState(void 0);
		  void localeTick;
		  React17.useEffect(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller]);
		  const reload = React17.useCallback(async () => {
		    try {
		      const payload = await api.listSources();
		      setSources(payload.sources);
		      setSettings(payload.settings);
		      setError(void 0);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		      setSources((current) => current ?? []);
		    }
		  }, [api]);
		  React17.useEffect(() => {
		    void reload();
		  }, [reload]);
		  React17.useEffect(() => {
		    void api.engines().then(setEngines).catch(() => setEngines([]));
		  }, [api]);
		  const saveGate = React17.useCallback(async (patch) => {
		    try {
		      setSettings(await api.setSettings(patch));
		      setError(void 0);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    }
		  }, [api]);
		  const connect = React17.useCallback(async (source) => {
		    try {
		      const payload = await api.connect(source.id);
		      if (!payload.ok) {
		        setError(t("db.connectFailed", { error: payload.result.error ?? "" }));
		        return;
		      }
		      setError(void 0);
		      const summary = payload.source ?? source;
		      if (summary.kind === "redis") {
		        controller.showRedis(summary, payload.redis ?? { databases: [] });
		      } else {
		        controller.showSql(summary, (payload.schemas ?? []).map((item) => item.name));
		      }
		      void reload();
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    }
		  }, [api, controller, reload]);
		  const screen = snapshot.screen;
		  let body;
		  if (screen.name === "sql") {
		    body = React17.createElement(SqlDatabaseView, {
		      api,
		      source: screen.source,
		      initialSchemas: screen.schemas,
		      // Inside a data source the back control steps out to the list; the list's
		      // own control is the one that leaves the panel, mirroring how a file
		      // manager separates "up a level" from "close".
		      onBack: () => controller.showList(),
		      onClose
		    });
		  } else if (screen.name === "redis") {
		    body = React17.createElement(RedisDatabaseView, {
		      api,
		      source: screen.source,
		      initialInfo: screen.info,
		      onBack: () => controller.showList(),
		      onClose
		    });
		  } else if (sources === void 0) {
		    body = React17.createElement(Empty, { message: t("common.loading") });
		  } else {
		    body = React17.createElement(SourceListView, {
		      api,
		      sources,
		      settings,
		      engines,
		      reload,
		      saveGate,
		      onConnect: (source) => connect(source),
		      onBack: onClose
		    });
		  }
		  return React17.createElement(
		    "div",
		    { className: "dbm-shell" },
		    error === void 0 ? null : React17.createElement(ErrorBanner, { message: error }),
		    body
		  );
		}

		// src/client/controller.ts
		var PanelController = class {
		  screen = { name: "list" };
		  listeners = /* @__PURE__ */ new Set();
		  /** Current state; referentially stable until a mutation. */
		  getSnapshot() {
		    return { screen: this.screen };
		  }
		  /** Subscribe to state changes; the returned function unsubscribes. */
		  subscribe(listener) {
		    this.listeners.add(listener);
		    return () => {
		      this.listeners.delete(listener);
		    };
		  }
		  /** Show the data-source list. */
		  showList() {
		    this.set({ name: "list" });
		  }
		  /** Open a SQL data source. */
		  showSql(source, schemas) {
		    this.set({ name: "sql", source, schemas });
		  }
		  /** Open a Redis data source. */
		  showRedis(source, info) {
		    this.set({ name: "redis", source, info });
		  }
		  /** Replace the open source's summary (after an edit). */
		  updateSource(source) {
		    const current = this.screen;
		    if (current.name === "list") return;
		    if (current.source.id !== source.id) return;
		    this.set({ ...current, source });
		  }
		  set(next) {
		    this.screen = next;
		    for (const listener of [...this.listeners]) listener();
		  }
		};

		// src/client/styles.ts
		var PANEL_CSS = `
		/*
		 * The panel's outer shell. It exists only to stack an optional error banner
		 * above the active screen, which owns the real .dbm-root column \u2014 nesting two
		 * 100%-height flex columns doubled the layout, so this one stays a plain
		 * full-height box.
		 */
		.dbm-shell {
		  display: flex;
		  flex-direction: column;
		  height: 100%;
		  min-height: 0;
		  background: var(--dsw-alias-bg-base);
		  color: var(--dsw-alias-label-primary);
		}

		.dbm-root {
		  display: flex;
		  flex-direction: column;
		  height: 100%;
		  min-height: 0;
		  background: var(--dsw-alias-bg-base);
		  color: var(--dsw-alias-label-primary);
		  font-size: 13px;
		}

		/* ---- sidebar entry glyph ------------------------------------------------ */
		/*
		 * The shell lays this row out with padding 7px 8px and gap 8px, while the SSH
		 * plugin's own injected row uses padding 0 10px and gap 10px around a 24px icon
		 * box. Measured in a real browser, the shell's row started its glyph 5px left of
		 * SSH's and 8px left of its label. This box adopts SSH's 24px geometry and adds
		 * the 2px per side the shell's smaller padding lacks, so the glyph and the label
		 * both land on the same x as the SSH entry.
		 */
		.dbm-entry-glyph {
		  display: inline-flex;
		  align-items: center;
		  justify-content: center;
		  box-sizing: border-box;
		  width: 24px;
		  height: 24px;
		  margin: 0 2px;
		  flex: none;
		}
		.dbm-entry-glyph > svg { display: block; }

		/* ---- header ------------------------------------------------------------ */
		/*
		 * Deliberately close to the SSH panel's header (its .panelHeader/.panelTitle):
		 * horizontal padding 14px and a 15-16px bold title, so the two panels read as
		 * the same product rather than two different takes on a header.
		 */
		.dbm-header {
		  display: flex;
		  align-items: center;
		  gap: 10px;
		  padding: 12px 14px;
		  border-bottom: 1px solid var(--dsw-alias-border-l3);
		  flex: none;
		}
		.dbm-title { font-size: 16px; font-weight: 700; }
		.dbm-subtitle { color: var(--dsw-alias-label-secondary); font-size: 12px; }
		.dbm-spacer { flex: 1; }

		/* The back control: a quiet outlined button, matching dsh-ssh's ghost button. */
		.dbm-back { padding: 5px 12px; font-size: 12px; }
		.dbm-btn-ghost {
		  background: transparent;
		  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l3));
		  color: var(--dsw-alias-label-primary);
		}
		.dbm-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }

		/* ---- controls ---------------------------------------------------------- */
		.dbm-btn {
		  font: inherit;
		  display: inline-flex;
		  align-items: center;
		  gap: 6px;
		  padding: 5px 11px;
		  border-radius: 8px;
		  border: 1px solid var(--dsw-alias-border-l3);
		  background: var(--dsw-alias-button-elevated-fill);
		  color: var(--dsw-alias-label-primary);
		  cursor: pointer;
		  white-space: nowrap;
		}
		/*
		 * Hover states are written per-variant, never on the base class.
		 *
		 * A base .dbm-btn:hover:not(:disabled) rule scores (0,3,0) and therefore beats
		 * a plain .dbm-btn-primary (0,1,0) on background \u2014 which made the primary
		 * button swap to the light hover fill while keeping its inverted (white) text,
		 * i.e. it vanished on hover. Keeping each variant's background in a rule of
		 * matching specificity removes that trap.
		 */
		.dbm-btn:disabled { opacity: .5; cursor: default; }
		.dbm-btn-primary {
		  background: var(--dsw-alias-label-primary);
		  color: var(--dsw-alias-label-primary-inverted);
		  border-color: transparent;
		}
		.dbm-btn:hover:not(:disabled):not(.dbm-btn-primary) { background: var(--dsw-alias-button-floating-hover); }
		.dbm-btn-primary:hover:not(:disabled) { filter: brightness(1.15); }
		.dbm-btn-danger { color: var(--dsw-alias-label-danger, #d33); }
		.dbm-btn-sm { padding: 3px 8px; font-size: 12px; border-radius: 6px; }

		.dbm-input, .dbm-select, .dbm-textarea {
		  font: inherit;
		  padding: 5px 9px;
		  border-radius: 8px;
		  border: 1px solid var(--dsw-alias-border-l3);
		  background: var(--dsw-alias-bg-base);
		  color: var(--dsw-alias-label-primary);
		  min-width: 0;
		}
		.dbm-input:focus, .dbm-select:focus, .dbm-textarea:focus {
		  outline: 2px solid var(--dsw-alias-label-primary);
		  outline-offset: -1px;
		}
		.dbm-textarea { font-family: var(--ds-font-family-code); resize: vertical; }
		.dbm-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
		.dbm-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
		.dbm-label > span { font-weight: 500; }

		/* ---- toolbar (search / group / new) ----------------------------------- */
		.dbm-toolbar {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  padding: 10px 14px;
		  border-bottom: 1px solid var(--dsw-alias-border-l3);
		  flex: none;
		  flex-wrap: wrap;
		}
		.dbm-toolbar .dbm-input { width: 220px; }

		/* ---- table ------------------------------------------------------------- */
		.dbm-scroll { flex: 1; min-height: 0; overflow: auto; }
		.dbm-table { width: 100%; border-collapse: collapse; }
		.dbm-table th, .dbm-table td {
		  text-align: left;
		  padding: 7px 10px;
		  border-bottom: 1px solid var(--dsw-alias-border-l3);
		  white-space: nowrap;
		}
		.dbm-table th {
		  position: sticky;
		  top: 0;
		  background: var(--dsw-alias-bg-base);
		  color: var(--dsw-alias-label-secondary);
		  font-weight: 500;
		  z-index: 1;
		}
		.dbm-table tbody tr:hover { background: var(--dsw-alias-interactive-bg-hover); }
		.dbm-table td.dbm-mono, .dbm-mono { font-family: var(--ds-font-family-code); font-size: 12px; }
		.dbm-empty {
		  padding: 36px 16px;
		  text-align: center;
		  color: var(--dsw-alias-label-secondary);
		}
		.dbm-actions { display: flex; gap: 4px; }
		.dbm-link {
		  font: inherit;
		  background: none;
		  border: none;
		  color: var(--dsw-alias-label-primary);
		  cursor: pointer;
		  padding: 2px 4px;
		  border-radius: 4px;
		  text-decoration: underline;
		  text-decoration-color: var(--dsw-alias-border-l3);
		}
		.dbm-link:hover { background: var(--dsw-alias-interactive-bg-hover); }

		/* ---- badges ------------------------------------------------------------ */
		.dbm-badge {
		  display: inline-block;
		  padding: 1px 7px;
		  border-radius: 999px;
		  font-size: 11px;
		  border: 1px solid var(--dsw-alias-border-l3);
		  color: var(--dsw-alias-label-secondary);
		}
		.dbm-badge-sqlite { color: #2b7bbb; border-color: #2b7bbb55; }
		.dbm-badge-mysql { color: #c1720a; border-color: #c1720a55; }
		.dbm-badge-redis { color: #c13535; border-color: #c1353555; }
		.dbm-badge-ok { color: #1a8a4a; border-color: #1a8a4a55; }
		.dbm-badge-err { color: var(--dsw-alias-label-danger, #d33); border-color: currentColor; }
		.dbm-tags { display: inline-flex; gap: 4px; flex-wrap: wrap; }

		/* ---- database panel: tree + content ----------------------------------- */
		.dbm-split { display: flex; flex: 1; min-height: 0; }
		.dbm-side {
		  width: 280px;
		  flex: none;
		  border-right: 1px solid var(--dsw-alias-border-l3);
		  display: flex;
		  flex-direction: column;
		  min-height: 0;
		}
		.dbm-side-head {
		  padding: 8px 10px;
		  border-bottom: 1px solid var(--dsw-alias-border-l3);
		  display: flex;
		  gap: 6px;
		  align-items: center;
		  flex: none;
		}
		.dbm-side-body { flex: 1; min-height: 0; overflow: auto; padding: 4px 0; }
		.dbm-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }

		/* ---- tree rows --------------------------------------------------------- */
		/*
		 * box-sizing: border-box is load-bearing here, not stylistic.
		 *
		 * The row is width:100% with 10px of horizontal padding, and the sidebar's body
		 * is overflow:auto. Under the default content-box the padding was ADDED to the
		 * 100%, so each row measured 20px wider than its container: measured, the body's
		 * clientWidth was 280 while its scrollWidth was 300. The right-hand number \u2014 which
		 * sits at the row's trailing edge \u2014 was therefore pushed into the 20px-wide strip
		 * that overflow:auto clips, so its last characters were cut off. Every row was
		 * affected; the number was simply the only thing whose value sat flush against
		 * that edge.
		 *
		 * The Redis tree's rows already set this (dbm-tree-node), which is why only this
		 * tree showed the clipping.
		 */
		.dbm-tree-item {
		  box-sizing: border-box;
		  display: flex;
		  align-items: center;
		  gap: 6px;
		  padding: 4px 10px;
		  cursor: pointer;
		  border: none;
		  background: none;
		  color: inherit;
		  font: inherit;
		  width: 100%;
		  text-align: left;
		}
		.dbm-tree-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
		.dbm-tree-item[data-active="true"] {
		  background: var(--dsw-alias-interactive-bg-active);
		  font-weight: 500;
		}
		.dbm-tree-indent-1 { padding-left: 24px; }
		.dbm-tree-indent-2 { padding-left: 40px; }
		.dbm-tree-caret {
		  width: 14px;
		  display: inline-flex;
		  justify-content: center;
		  color: var(--dsw-alias-label-secondary);
		  flex: none;
		}
		/*
		 * The name takes the space left over and gives it back when the row is narrow.
		 *
		 * flex:1 with min-width:0 is what makes the ellipsis actually happen: a flex
		 * item's default min-width:auto refuses to shrink below its content, so a long
		 * table name pushed the trailing count out of the row instead of being truncated.
		 */
		.dbm-tree-name {
		  overflow: hidden;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		  flex: 1;
		  min-width: 0;
		}
		/*
		 * The trailing number never shrinks and never wraps.
		 *
		 * flex:none because it is the one thing in the row whose full value is always
		 * needed \u2014 a truncated count is worse than a truncated name. Tabular figures keep
		 * it a fixed width, so a row does not shift as the number changes.
		 */
		.dbm-tree-item .dbm-tree-meta {
		  flex: none;
		  white-space: nowrap;
		  font-variant-numeric: tabular-nums;
		}

		/*
		 * The caret and the label on a database row.
		 *
		 * The row is now a div with a caret button inside it (see the component for
		 * why), so the label is a plain span carrying the ellipsis and the caret is
		 * stripped back to its glyph \u2014 the row itself owns the hover and active
		 * backgrounds, and a control that painted its own would break that up.
		 *
		 * The caret gets a wider hit area than its 14px glyph because a small triangle
		 * is fiddly to hit. Stretching it to the row's full height keeps it reachable
		 * without aiming at the baseline.
		 */
		.dbm-caret-btn {
		  font: inherit;
		  border: none;
		  background: none;
		  color: var(--dsw-alias-label-secondary);
		  cursor: pointer;
		  padding: 0;
		  width: 16px;
		  flex: none;
		  display: inline-flex;
		  justify-content: center;
		  align-items: center;
		  align-self: stretch;
		}
		.dbm-caret-btn:hover { color: var(--dsw-alias-label-primary); }
		.dbm-node-name {
		  overflow: hidden;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		  flex: 1;
		  min-width: 0;
		}
		.dbm-tree-meta { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 11px; }

		/* ---- Redis key tree ----------------------------------------------------- */
		/*
		 * The Redis tree has more levels than the SQL one (database > folder > \u2026 > key)
		 * and its rows carry hover controls, so it does not reuse .dbm-tree-item. The
		 * rows are divs rather than buttons because a row can contain buttons, and a
		 * button inside a button is invalid HTML that browsers re-parent in surprising
		 * ways.
		 */
		.dbm-tree-node {
		  display: flex;
		  align-items: center;
		  gap: 6px;
		  padding: 3px 10px;
		  cursor: pointer;
		  color: inherit;
		  font: inherit;
		  width: 100%;
		  text-align: left;
		  box-sizing: border-box;
		}
		.dbm-tree-node:hover { background: var(--dsw-alias-interactive-bg-hover); }
		.dbm-tree-node[data-active="true"] {
		  background: var(--dsw-alias-interactive-bg-active);
		  font-weight: 500;
		}
		/*
		 * One indent step per tree depth, applied by class rather than inline style so
		 * the whole ladder is visible in one place. Depth is capped at 6 in the
		 * component: a 12-segment key name would otherwise indent past the panel.
		 */
		.dbm-tree-depth-1 { padding-left: 24px; }
		.dbm-tree-depth-2 { padding-left: 40px; }
		.dbm-tree-depth-3 { padding-left: 56px; }
		.dbm-tree-depth-4 { padding-left: 72px; }
		.dbm-tree-depth-5 { padding-left: 88px; }
		.dbm-tree-depth-6 { padding-left: 104px; }
		.dbm-tree-glyph { flex: none; width: 16px; text-align: center; font-size: 12px; }
		.dbm-tree-hint { padding-top: 3px; padding-bottom: 3px; }

		/*
		 * Row actions appear on hover (and on keyboard focus, so they are reachable
		 * without a mouse). Always-visible controls turned the tree into a wall of
		 * icons; hidden ones with no focus path would make the feature mouse-only.
		 */
		.dbm-tree-actions {
		  margin-left: auto;
		  display: none;
		  align-items: center;
		  gap: 2px;
		  flex: none;
		}
		.dbm-tree-node:hover > .dbm-tree-actions,
		.dbm-tree-node:focus-within > .dbm-tree-actions { display: inline-flex; }
		/* With actions shown, the count must not also claim the auto margin. */
		.dbm-tree-node:hover > .dbm-tree-meta,
		.dbm-tree-node:focus-within > .dbm-tree-meta { margin-left: 0; }

		.dbm-icon-btn {
		  font: inherit;
		  font-size: 12px;
		  line-height: 1;
		  padding: 2px 5px;
		  border: 1px solid var(--dsw-alias-border-l3);
		  border-radius: 6px;
		  background: var(--dsw-alias-button-elevated-fill);
		  color: var(--dsw-alias-label-secondary);
		  cursor: pointer;
		}
		.dbm-icon-btn:hover { background: var(--dsw-alias-button-floating-hover); color: var(--dsw-alias-label-primary); }
		.dbm-icon-btn-danger:hover { color: var(--dsw-alias-label-danger, #d33); border-color: currentColor; }

		/* ---- keyspace index progress ------------------------------------------- */
		/*
		 * A progress banner for a running keyspace walk, with a thin bar under it.
		 *
		 * It deliberately does NOT reuse .dbm-ok. That class means "the operation
		 * succeeded" and carries display: block; the banner used to wear both, and
		 * since the two selectors have identical specificity (0,1,0) .dbm-ok won on
		 * source order. The measured result was display: block \u2014 so gap did nothing,
		 * and the bar below was an inline span, where height is ignored. It then took
		 * its 16px line box instead of the 3px it asks for and hung ~10px past the
		 * banner's bottom edge, over the tree below it. An own class with its own
		 * layout removes the dependence on which rule happens to come last.
		 *
		 * flex: none keeps the banner's height when the tree underneath grows, the
		 * same way the header and the other banners are held at their natural size.
		 *
		 * The percentage is real work done (keys visited over the database's size), which
		 * is what makes a minute-long index build on a huge database legible instead of
		 * looking frozen. The bar is decorative \u2014 the sentence carries the same numbers \u2014
		 * so it is hidden from assistive tech rather than announced twice.
		 */
		.dbm-index-progress {
		  display: flex;
		  flex-direction: column;
		  gap: 4px;
		  padding: 6px 14px;
		  font-size: 12px;
		  color: #1a8a4a;
		  flex: none;
		}

		.dbm-index-bar {
		  /* height only applies to a block box; as an inline span this was ignored. */
		  display: block;
		  height: 3px;
		  border-radius: 2px;
		  background: var(--dsw-alias-interactive-bg-hover);
		  overflow: hidden;
		}

		.dbm-index-fill {
		  display: block;
		  height: 100%;
		  background: var(--dsw-alias-brand-primary, #4c8bf5);
		  transition: width .3s ease;
		}

		/* ---- search results ---------------------------------------------------- */
		/*
		 * The search header states the scope (which database) and the pattern, because
		 * the results replace the tree: without it, a flat list of keys gives no clue
		 * that it came from db3 rather than the db the user was just browsing.
		 */
		.dbm-search-header {
		  padding: 8px 12px;
		  border-bottom: 1px solid var(--dsw-alias-border-l3);
		  background: var(--dsw-alias-interactive-bg-hover);
		  word-break: break-all;
		}

		/* ---- busy / refresh feedback ------------------------------------------- */
		/*
		 * Rows kept on screen while their level is re-fetched.
		 *
		 * Dimmed rather than replaced: after a create or a delete the existing rows are
		 * still the best information available, and blanking them would collapse the
		 * tree and lose the user's place. The dimming is what distinguishes "current"
		 * from "about to change", which was missing while a write appeared to do
		 * nothing for a moment.
		 *
		 * pointer-events is set to none because a row being reloaded may no longer
		 * exist on the server \u2014 acting on it would target a stale key. The container's
		 * own controls stay usable.
		 */
		.dbm-tree-stale {
		  opacity: .5;
		  pointer-events: none;
		}

		/*
		 * An indeterminate spinner. Sized in em so it sits on the baseline of whatever
		 * row it replaces (the key count, the \u27F3 glyph) without shifting the layout.
		 */
		.dbm-spinner {
		  display: inline-block;
		  width: 10px;
		  height: 10px;
		  border: 2px solid var(--dsw-alias-border-l3);
		  border-top-color: var(--dsw-alias-label-secondary);
		  border-radius: 50%;
		  animation: dbm-spin .7s linear infinite;
		}
		@keyframes dbm-spin {
		  to { transform: rotate(360deg); }
		}
		/*
		 * A spinner that cannot be seen moving is just a strange dot, so when motion is
		 * unwelcome it becomes a pulse instead \u2014 still clearly "working", never moving.
		 */
		@media (prefers-reduced-motion: reduce) {
		  .dbm-spinner { animation: dbm-pulse 1.2s ease-in-out infinite; }
		  @keyframes dbm-pulse {
		    0%, 100% { opacity: .35; }
		    50% { opacity: 1; }
		  }
		}
		/* A control that is busy keeps its width, so the header does not jitter. */
		.dbm-btn-busy { cursor: progress; }

		/* ---- tabs -------------------------------------------------------------- */
		.dbm-tabs {
		  display: flex;
		  gap: 2px;
		  padding: 6px 10px 0;
		  border-bottom: 1px solid var(--dsw-alias-border-l3);
		  flex: none;
		  flex-wrap: wrap;
		}
		.dbm-tab {
		  font: inherit;
		  padding: 6px 12px;
		  border: none;
		  background: none;
		  color: var(--dsw-alias-label-secondary);
		  cursor: pointer;
		  border-radius: 8px 8px 0 0;
		  border-bottom: 2px solid transparent;
		}
		.dbm-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
		.dbm-tab[data-active="true"] {
		  color: var(--dsw-alias-label-primary);
		  font-weight: 500;
		  border-bottom-color: var(--dsw-alias-label-primary);
		}
		.dbm-tab-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
		.dbm-pad { padding: 10px 14px; display: flex; flex-direction: column; gap: 10px; }
		.dbm-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
		.dbm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
		.dbm-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }

		/*
		 * ---- the insert form (phpMyAdmin-shaped) -------------------------------
		 *
		 * ONE COLUMN PER ROW: the column name in a fixed left track, its control
		 * filling everything to the right. That is the shape phpMyAdmin's insert page
		 * has, and it is what makes a wide table readable \u2014 a card grid puts the fields
		 * in an order that depends on the viewport width, so which control follows which
		 * changes when the window is resized.
		 *
		 * The name track is a FIXED length rather than max-content: max-content is
		 * resolved per row, so a short name and a long one would put their controls at
		 * different x positions. One width for every row is what makes the controls line
		 * up as a column, which is the whole reason the two-track layout exists.
		 *
		 * 280px fits the longest realistic name cell on one line: at 240px measured, the
		 * DEFAULT note on "ordered_at \xB7 TEXT NOT NULL \xB7 \u9ED8\u8BA4\uFF1Adatetime('now')" wrapped to a
		 * second line, making that row twice as tall as its neighbours and reading as a
		 * broken table. The control loses 40px, which the 560px cap above makes free.
		 */
		.dbm-insert-form {
		  border: 1px solid var(--dsw-alias-border-l3);
		  border-radius: 8px;
		  padding: 8px 10px;
		  display: flex;
		  flex-direction: column;
		  gap: 8px;
		}
		.dbm-insert-grid {
		  display: grid;
		  grid-template-columns: 280px minmax(0, 1fr);
		  gap: 6px 12px;
		  align-items: center;
		}
		/*
		 * The name cell: name and type on ONE line, wrapping only when the pair is too
		 * long for the track. No overflow-wrap:anywhere \u2014 breaking mid-identifier turns
		 * "ordered_at" into "ordered_" / "at", which is unreadable and which the wider
		 * track above is what avoids.
		 */
		.dbm-insert-name {
		  display: flex;
		  align-items: baseline;
		  flex-wrap: wrap;
		  gap: 0 6px;
		  font-weight: 500;
		  font-size: 12px;
		  min-width: 0;
		}
		.dbm-insert-name > .dbm-hint { font-weight: 400; }
		/*
		 * The control and its tick boxes share the right-hand cell, control first.
		 *
		 * The control is capped rather than stretched: a 1000px-wide text box beside a
		 * 48px label is the shape of a form nobody reads, and the cap is also what keeps
		 * the NULL box near the box it applies to instead of at the far end of the row.
		 * The cap is a max-width, so a narrow panel still shrinks the control with it.
		 */
		.dbm-insert-value { display: flex; align-items: center; gap: 10px; min-width: 0; }
		.dbm-insert-value > .dbm-input,
		.dbm-insert-value > .dbm-select,
		.dbm-insert-value > .dbm-textarea { flex: 1 1 auto; min-width: 0; max-width: 560px; }
		.dbm-insert-value > .dbm-check { flex: none; white-space: nowrap; }
		/*
		 * Below the width where a 240px name track leaves a usable control, the name
		 * goes ABOVE its control instead of beside it. The single track keeps the form
		 * usable on a narrow panel rather than squeezing a date picker into 80px.
		 */
		@media (max-width: 720px) {
		  .dbm-insert-grid { grid-template-columns: minmax(0, 1fr); }
		  .dbm-insert-value { align-items: flex-start; }
		}
		.dbm-error {
		  color: var(--dsw-alias-label-danger, #d33);
		  background: color-mix(in srgb, currentColor 8%, transparent);
		  border: 1px solid currentColor;
		  border-radius: 8px;
		  padding: 8px 10px;
		  font-size: 12px;
		  white-space: pre-wrap;
		  word-break: break-word;
		}

		/* ---- data grid --------------------------------------------------------- */
		.dbm-data { flex: 1; min-height: 0; overflow: auto; }
		.dbm-data table { border-collapse: collapse; font-size: 12px; }
		.dbm-data th, .dbm-data td {
		  border: 1px solid var(--dsw-alias-border-l3);
		  padding: 4px 8px;
		  max-width: 380px;
		  overflow: hidden;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		  font-family: var(--ds-font-family-code);
		}
		.dbm-data th {
		  position: sticky;
		  top: 0;
		  background: var(--dsw-alias-bg-base);
		  z-index: 1;
		  font-family: inherit;
		  font-weight: 500;
		}
		.dbm-data th button {
		  font: inherit;
		  background: none;
		  border: none;
		  color: inherit;
		  cursor: pointer;
		  padding: 0;
		}
		/*
		 * The multi-select checkbox column. It is narrow, it does not sort, and it has to
		 * stay put while the rest of the row scrolls sideways \u2014 so it is sticky on the
		 * left, the mirror of the sticky header row.
		 */
		.dbm-data th.dbm-select-col, .dbm-data td.dbm-select-col {
		  width: 30px;
		  max-width: 30px;
		  padding: 4px 6px;
		  text-align: center;
		  position: sticky;
		  left: 0;
		  background: var(--dsw-alias-bg-base);
		}
		.dbm-data td.dbm-select-col { z-index: 0; }
		.dbm-data th.dbm-select-col { z-index: 2; }
		/* The row controls: edit / copy / delete, revealed on hover like the tree's. */
		/*
		 * The actions column is pinned to the RIGHT edge of the viewport.
		 *
		 * The grid scrolls horizontally on a wide table, and the actions sat at the end
		 * of the row \u2014 so reaching them meant scrolling all the way right, then losing the
		 * row's identity off the left edge. Pinning the column keeps "which row" and "what
		 * can I do to it" on screen together, which is the same reason the select column
		 * is pinned left.
		 *
		 * 'right: 0' plus a background is what makes a sticky cell work: without an opaque
		 * background the scrolled columns show through it.
		 */
		.dbm-data th.dbm-row-actions, .dbm-data td.dbm-row-actions {
		  white-space: nowrap;
		  width: 1%;
		  position: sticky;
		  right: 0;
		  background: var(--dsw-alias-bg-base);
		}
		/* The header row's own sticky cells need to sit above the body's. */
		.dbm-data th.dbm-row-actions { z-index: 2; }
		.dbm-data td.dbm-row-actions { z-index: 1; }
		/* A selected row's tint must show through its pinned cells, so they inherit it. */
		.dbm-data tr[data-selected="true"] > td.dbm-row-actions {
		  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8bf5) 14%, var(--dsw-alias-bg-base));
		}
		/* A divider, because the pinned column floats over the columns it covers. */
		.dbm-data td.dbm-row-actions, .dbm-data th.dbm-row-actions {
		  border-left: 1px solid var(--dsw-alias-border-l3);
		}
		.dbm-row-action {
		  font: inherit;
		  font-size: 11px;
		  padding: 1px 6px;
		  margin-right: 3px;
		  border: 1px solid var(--dsw-alias-border-l3);
		  border-radius: 5px;
		  background: var(--dsw-alias-button-elevated-fill);
		  color: var(--dsw-alias-label-secondary);
		  cursor: pointer;
		}
		.dbm-row-action:hover { background: var(--dsw-alias-button-floating-hover); color: var(--dsw-alias-label-primary); }
		.dbm-row-action-danger:hover { color: var(--dsw-alias-label-danger, #d33); border-color: currentColor; }
		/*
		 * A row selected for a batch action. Kept visibly distinct from the hover tint,
		 * because "these are the rows that will be deleted" is a different claim from
		 * "the pointer is here".
		 */
		.dbm-data tr[data-selected="true"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8bf5) 14%, transparent); }
		.dbm-data tr[data-selected="true"]:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8bf5) 20%, transparent); }
		/*
		 * The sort indicator.
		 *
		 * Sized in font-size 8px rather than left at the inherited 12px: at the header's
		 * own size the triangles were visually as loud as the column name, which reads as
		 * if the arrow were the label. The 4px left margin is what keeps them from
		 * touching the last letter.
		 */
		.dbm-sort-mark {
		  font-size: 8px;
		  margin-left: 4px;
		  color: var(--dsw-alias-label-secondary);
		  vertical-align: 1px;
		}
		.dbm-data th .dbm-sort-mark { color: var(--dsw-alias-label-primary); }
		/*
		 * A cell being edited in place.
		 *
		 * The editor fills the cell rather than sitting inside it, so the row keeps its
		 * height and the grid does not jump when a value is double-clicked.
		 */
		.dbm-cell-input {
		  font: inherit;
		  font-family: var(--ds-font-family-code);
		  font-size: 12px;
		  box-sizing: border-box;
		  width: 100%;
		  min-width: 90px;
		  padding: 2px 5px;
		  border: 1px solid var(--dsw-alias-label-primary);
		  border-radius: 4px;
		  background: var(--dsw-alias-bg-base);
		  color: var(--dsw-alias-label-primary);
		}
		/* The cell is a double-click target, which has to be discoverable. */
		.dbm-cell-editable { cursor: text; }
		.dbm-cell-editable:hover { outline: 1px dashed var(--dsw-alias-border-l3); outline-offset: -2px; }
		/*
		 * The in-cell editor is a one-row TEXTAREA (see SqlBrowseTab for why), so its own
		 * chrome has to be taken off for it to sit in a cell like an input did.
		 *
		 * 'resize: vertical' only: the point is a taller view of a long value, and
		 * horizontal resizing inside a table cell would fight the column widths. No
		 * wrapping, so a long value stays one line until the user grows the box.
		 */
		textarea.dbm-cell-input {
		  resize: vertical;
		  white-space: pre;
		  line-height: 1.4;
		  overflow-x: auto;
		  overflow-y: hidden;
		  min-height: 22px;
		  /* The default textarea font is monospace-ish and small; keep the grid's. */
		  font-family: var(--ds-font-family-code);
		  font-size: 12px;
		}
		/*
		 * A grown editor must be able to show its resize handle.
		 *
		 * The cells set 'overflow: hidden' for the ellipsis, which would clip the handle
		 * at the box's bottom-right corner. Scoped with ':has()' so only the cell
		 * actually holding an editor loses its clipping.
		 */
		.dbm-data td:has(> textarea.dbm-cell-input) { overflow: visible; }
		.dbm-cell-saving { opacity: .6; }
		.dbm-cell-failed { color: var(--dsw-alias-label-danger, #d33); font-style: normal; }
		.dbm-null { color: var(--dsw-alias-label-secondary); font-style: italic; }
		/*
		 * The value editor puts inputs inside the data grid. They must fill the cell
		 * rather than sit in it, so an editable row reads as a table row and not as a
		 * form dropped into a column.
		 */
		.dbm-data input.dbm-input {
		  box-sizing: border-box;
		  border-radius: 6px;
		  padding: 3px 7px;
		}
		/* An edited-but-unsaved cell is called out, so \u4FDD\u5B58 is never a guess. */
		.dbm-dirty { color: #c1720a; }

		/*
		 * The batch-action bar. It appears above the grid only while rows are selected,
		 * so the grid does not permanently lose a row of height to controls that are
		 * usually inapplicable \u2014 and its appearance is itself the feedback that a
		 * selection is active.
		 */
		.dbm-batch-bar {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  padding: 6px 12px;
		  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8bf5) 12%, transparent);
		  border-bottom: 1px solid var(--dsw-alias-border-l3);
		  flex: none;
		  font-size: 12px;
		  flex-wrap: wrap;
		}

		/*
		 * A structure editor row: a column being added or changed, laid out as one line
		 * of fields. Wrapping is enabled because the type list plus the flags do not fit
		 * a narrow panel, and a horizontal scrollbar inside a table row is worse than a
		 * second line.
		 */
		/*
		 * A stacked form field: label above its control, hint below.
		 *
		 * Replaces the one-line arrangement the column and index forms used, which wrapped
		 * at the panel's real width and left the reader unable to pair a label with its box.
		 */
		.dbm-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
		.dbm-field-label { font-weight: 500; font-size: 12px; }
		.dbm-field > .dbm-input, .dbm-field > .dbm-select { width: 100%; box-sizing: border-box; }

		/*
		 * The column picker in the index dialog.
		 *
		 * A bordered, scrollable list in the table's own column order. A checked row shows
		 * its position, because the TICK order is the index's column order \u2014 a prefix of
		 * that order is what the index can serve, so the sequence must be visible rather
		 * than implied by which boxes happen to be ticked.
		 */
		.dbm-column-picker {
		  border: 1px solid var(--dsw-alias-border-l3);
		  border-radius: 8px;
		  max-height: 260px;
		  overflow: auto;
		  padding: 6px 8px;
		}
		.dbm-column-picker-row {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  width: 100%;
		  padding: 3px 2px;
		}
		.dbm-column-order {
		  display: inline-flex;
		  justify-content: center;
		  align-items: center;
		  width: 18px;
		  height: 18px;
		  flex: none;
		  border-radius: 50%;
		  font-size: 11px;
		  background: var(--dsw-alias-interactive-bg-hover);
		  color: var(--dsw-alias-label-secondary);
		}
		/* A checked row marks its position, so the tick order is legible. */
		.dbm-column-picker-row input[type="checkbox"]:checked ~ .dbm-column-order {
		  background: var(--dsw-alias-label-primary);
		  color: var(--dsw-alias-label-primary-inverted);
		}

		/*
		 * A separator between groups of batch actions, so "export/empty" and the four
		 * maintenance statements do not read as one undifferentiated run of buttons.
		 */
		.dbm-batch-sep {
		  width: 1px;
		  height: 18px;
		  background: var(--dsw-alias-border-l3);
		  flex: none;
		}

		/* The select checkbox column of the table list: narrow and centred. */
		.dbm-table-select-col { width: 30px; text-align: center; }
		/* The table list needs the batch bar's wrap behaviour, since it carries more. */
		.dbm-batch-bar { row-gap: 6px; }

		/*
		 * The maintenance report: one block per table, each with its own verdict and the
		 * engine's message lines underneath. Scrollable, because a run can cover many
		 * tables and the dialog must stay usable.
		 */
		.dbm-maint-report {
		  display: flex;
		  flex-direction: column;
		  gap: 10px;
		  max-height: 45vh;
		  overflow: auto;
		  margin-top: 8px;
		}
		.dbm-maint-entry {
		  border: 1px solid var(--dsw-alias-border-l3);
		  border-radius: 8px;
		  padding: 6px 8px;
		}
		.dbm-maint-entry > .dbm-row { gap: 8px; }
		/* A long engine message must wrap rather than widen the dialog. */
		.dbm-maint-entry .dbm-hint { word-break: break-word; }

		/*
		 * The table-level fields: label on the LEFT, control on the RIGHT, ALL FOUR on one row.
		 *
		 * Reported before: \u8868\u540D's input was too long and the fields were laid out inconsistently (a
		 * full-width input, then labels ABOVE controls in a wrapping flex row). One grid replaced both.
		 *
		 * The column count is adaptive rather than fixed at two: asked for as "\u4E0A\u9762\u8868\u540D\u7B494\u4E2A\u653E\u4E00\u884C",
		 * because a two-column grid left the four fields as two short rows with an empty stretch beside
		 * each control. auto-fit gives four columns at this dialog's own width; the two media queries
		 * below take it down to a balanced 2x2 and then to one column as the window narrows, instead of
		 * letting auto-fit produce an orphan row.
		 *
		 * Each field is still label-left/control-right with a FIXED label track, so the controls inside a
		 * column are the same width and every label starts at the same x.
		 */
		.dbm-grid2 {
		  display: grid;
		  /*
		   * 240px is the floor a field may shrink to: the 104px label track, the 8px gap, and ~128px of
		   * control. Below that the collation dropdown cannot show a name like utf8mb4_unicode_ci.
		   */
		  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		  gap: 8px 20px;
		  align-items: center;
		  /*
		   * Reserve the scrollbar's width on BOTH columns.
		   *
		   * The body scrolls vertically, and without this the scrollbar takes its width from the
		   * right-hand column only \u2014 measured as a 6px difference between the two columns'
		   * controls, which reads as misalignment. The stable value keeps the two columns equal
		   * whether or not a scrollbar is present.
		   */
		  scrollbar-gutter: stable;
		}
		/*
		 * Each field is its own two-part row inside the grid cell.
		 *
		 * The label track is a FIXED width, not max-content: max-content is resolved per row, so
		 * a short label ("\u5B58\u50A8\u5F15\u64CE") and a long one ("\u6574\u7406\uFF08\u6392\u5E8F\u89C4\u5219\uFF09") put their controls at
		 * different x positions \u2014 measured 884 vs 890, a visible misalignment of the very thing
		 * that was supposed to line up. One width for every row is what makes the controls
		 * align, and it is why the value is a length rather than a fit.
		 *
		 * 104px is set by the LONGEST label in this grid, "\u6574\u7406\uFF08\u6392\u5E8F\u89C4\u5219\uFF09" \u2014 eight characters at
		 * 12px is ~96px, so anything narrower ellipsises the very label the track exists to align.
		 * Nothing narrower is available without shrinking the controls the four-across row already
		 * made tight, which is the trade this width is chosen against.
		 */
		.dbm-grid-row {
		  display: grid;
		  grid-template-columns: 104px minmax(0, 1fr);
		  gap: 8px;
		  align-items: center;
		  min-width: 0;
		}
		.dbm-grid-label {
		  font-weight: 500;
		  font-size: 12px;
		  /*
		   * LEFT-aligned, so the labels read as a column of their own and each one starts at the same
		   * x as the \u5B57\u6BB5 table's header above it. Right-alignment put every label's START at a
		   * different x, which looked ragged next to the left-aligned header and the left-aligned
		   * \u5B57\u6BB5\u540D below \u2014 reported as "\u4E0A\u9762\u7684\u8868\u540D\u3001\u5B58\u50A8\u5F15\u64CE\u7B49 label \u5DE6\u5BF9\u9F50".
		   *
		   * The track width above stays FIXED, so the controls' left edges still line up: alignment of
		   * the labels was the complaint, not the alignment of the controls.
		   */
		  text-align: left;
		  white-space: nowrap;
		  overflow: hidden;
		  text-overflow: ellipsis;
		}
		/* The control fills its cell, so widths are uniform rather than content-driven. */
		.dbm-grid-control { width: 100%; min-width: 0; box-sizing: border-box; }
		.dbm-check-group { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
		/*
		 * Below the width where four tracks still fit, go straight to TWO columns.
		 *
		 * auto-fit alone produced an ORPHAN row here \u2014 measured at a 1000px and 900px viewport, three
		 * fields on one row and the fourth alone below \u2014 because 928px of content holds three 240px
		 * tracks but not four. A balanced 2x2 reads as a deliberate grid; 3+1 reads as a mistake.
		 *
		 * The breakpoint is where four tracks stop fitting: the dialog is min(1180px, 96vw), so its content
		 * box reaches 4 x 240 = 960px only from roughly 1040px of viewport. Verified per width afterwards:
		 * 1600px and 1200px give 4 across, 1000px and 900px give 2x2, 800px and 600px stay 2x2.
		 */
		@media (max-width: 1040px) {
		  .dbm-grid2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		}
		/*
		 * One column once two get too narrow to hold a 104px label AND a readable control.
		 *
		 * At a 560px viewport two columns leave each control ~110px, which is the point where the
		 * collation dropdown can no longer show a value \u2014 the same floor the 240px track encodes.
		 */
		@media (max-width: 620px) {
		  .dbm-grid2 { grid-template-columns: minmax(0, 1fr); }
		}
		/*
		 * The rule between the table-level fields and the column list.
		 *
		 * Asked for as "\u4E0B\u9762\u52A0\u4E00\u6761\u7EBF\u548C\u4E0B\u9762\u7684\u5B57\u6BB5\u8868\u683C\u9694\u5F00": the four fields and the \u5B57\u6BB5 grid are two
		 * different subjects \u2014 the table's own options, then its columns \u2014 and without a rule the
		 * \u5B57\u6BB5 header read as a fifth label of the same block. A plain border-top on an empty div rather
		 * than an hr element, so it uses the theme's border token and takes no default browser styling.
		 *
		 * The bottom margin is the larger one because the rule now also does the job the removed \u5B57\u6BB5
		 * heading did \u2014 introducing the block below \u2014 so it needs air beneath it rather than sitting flush
		 * on the header row. Measured before this: the header started 2px under the rule, which read as the
		 * rule being underlined by the table.
		 *
		 * These margins are what sets the spacing at all: .dbm-modal-body's gap applies only between
		 * its DIRECT children, and this rule is a sibling of .dbm-field inside an inner div \u2014 so the gap
		 * contributes nothing here and the value below is the whole distance.
		 */
		.dbm-newtable-sep {
		  border-top: 1px solid var(--dsw-alias-border-l3);
		  margin: 2px 0 8px;
		}

		/*
		 * The type cell swaps between a dropdown and a text field in place.
		 *
		 * A separate "custom type" column would have widened a form whose width was the
		 * complaint, so the custom field replaces the dropdown in the same cell, with a small
		 * button back to the list (otherwise choosing \u81EA\u5B9A\u4E49 is one-way).
		 */
		.dbm-type-cell { display: flex; gap: 4px; align-items: center; min-width: 0; }
		.dbm-type-cell .dbm-input { flex: 1 1 auto; min-width: 0; }
		.dbm-type-cell .dbm-btn { flex: none; padding: 2px 6px; }

		/*
		 * The \u81EA\u589E cell: the checkbox plus, when the combination is impossible, the reason.
		 *
		 * The reason used to be a title attribute only, which a user does not see without
		 * a DISABLED input does not reliably show one at all, so the control appeared inert with
		 * no explanation. It is now text, wrapped under the checkbox.
		 */
		.dbm-auto-cell { min-width: 0; }
		.dbm-auto-hint {
		  margin-top: 2px;
		  font-size: 10px;
		  line-height: 1.3;
		  /* The column is narrow; let a long reason wrap instead of forcing the table wider. */
		  white-space: normal;
		  word-break: break-word;
		}

		/*
		 * A column that is part of the primary key, called out in the structure table.
		 */
		.dbm-key-note { color: var(--dsw-alias-label-secondary); font-size: 11px; }

		/*
		 * ---- the \u64CD\u4F5C tab -------------------------------------------------------
		 *
		 * One block per operation, each with its own heading, its own explanation and its own
		 * submit button. Not one toolbar of buttons: every block names a target or a value
		 * before it does anything, and the two destructive ones state what they destroy \u2014
		 * a single click that moves a table into another database is not a proportionate
		 * gesture for something with no undo.
		 *
		 * The blocks are separated by the same rule the \u65B0\u5EFA\u8868 dialog uses between its
		 * table-level fields and its column list, so the two forms read as one family.
		 */
		.dbm-op-block {
		  display: flex;
		  flex-direction: column;
		  gap: 6px;
		  /*
		   * Capped, not full width. A form stretched across a 1600px panel puts a table name
		   * field a screen away from its label; phpMyAdmin's own page is capped for the same
		   * reason. The cap is a max-width, so a narrow panel still shrinks with it.
		   */
		  max-width: 720px;
		}
		/* The block's heading reads as a heading, not as a field label. */
		.dbm-op-block > strong { font-size: 13px; }
		/* A disabled block's reason is prose, so it wraps instead of forcing a scrollbar. */
		.dbm-op-block > .dbm-hint { white-space: normal; word-break: break-word; }
		/* The target fields sit on one line and stay there: there are only ever two. */
		.dbm-op-block .dbm-field-inline > .dbm-select { width: 160px; }
		.dbm-op-block .dbm-field-inline > .dbm-input { width: 160px; }

		/*
		 * ---- the \u641C\u7D22 tab (phpMyAdmin's query by example) ----------------------
		 *
		 * One row per column under a \u5B57\u6BB5 / \u7C7B\u578B / \u6392\u5E8F\u89C4\u5219 / \u8FD0\u7B97\u7B26 / \u503C header \u2014 the shape
		 * of phpMyAdmin's search page, and the reason the form is a TABLE rather than a
		 * list of controls: the column, its type and its collation are what the user reads
		 * to decide which row to fill in, so they belong on the same line as the operator
		 * and the value.
		 *
		 * THE FIELD LIST IS NEVER SCROLLED. Every column of the table is visible, and the
		 * whole PAGE scrolls if the list is long.
		 *
		 * This was reported as a usability defect and it was one: the field list had its own
		 * scroll box, capped at 45% of the tab, and a 25-column table showed FOUR rows with
		 * the other 21 hidden inside it \u2014 measured, the box was 235px against 1182px of
		 * content. A scrollbar inside a list of fields does not read as "there is more
		 * below"; it reads as "these are the fields", so the user concludes the column they
		 * want does not exist and stops looking. The rows of a table's field list are its
		 * content, and content that answers "which fields are there" has to be shown whole.
		 *
		 * The earlier reason for the cap is still honoured, one level up: the \u6267\u884C button
		 * must not be reachable only by scrolling INSIDE a box the user cannot see the end
		 * of. With the page as the scroller the button sits in normal flow after the list \u2014
		 * the arrangement phpMyAdmin itself has \u2014 and the section headings and hints that
		 * follow tell the user there is more below.
		 */
		.dbm-search-form {
		  padding: 10px 14px;
		  display: flex;
		  flex-direction: column;
		  gap: 8px;
		  /* Natural height: the form is content, not a viewport onto content. */
		  flex: none;
		}
		/*
		 * The field table's wrapper, kept as a hook but no longer a scroll container.
		 *
		 * It used to be overflow:auto with flex:1 1 auto, which is what produced the 235px
		 * box. The name stays so the geometry assertions in the e2e still address the same
		 * element \u2014 the thing they check is that this area is NOT scrolled.
		 */
		.dbm-search-scroll { min-height: 0; }
		/*
		 * The whole search page scrolls, and the result grid keeps its own height.
		 *
		 * min-height rather than flex-basis on the results: a long field list must not
		 * squeeze the grid away, so the grid holds a usable height and the page scrolls
		 * past it. Below that it behaves like the \u6D4F\u89C8 tab's grid, which it reuses.
		 */
		[data-dbm-search-page] { overflow: auto; }
		/*
		 * The action row rides the bottom of the viewport while the field list is in view.
		 *
		 * Showing every field and keeping \u6267\u884C reachable pull in opposite directions: a full
		 * field list makes the form taller than the panel, so a button in normal flow after it
		 * ends up below the fold \u2014 measured at 24 columns, where the button sat at y=1316 in an
		 * 804px viewport. That was the ORIGINAL complaint this page had, so the fix must not
		 * trade one known defect for the other.
		 *
		 * Sticky resolves it: the field list is complete and scrolls with the page, and the
		 * action row stays on screen the whole time the list is being read. bottom:0 is
		 * against the page scrollport, and the form is its containing block, so once the list
		 * ends the bar settles into its own place rather than covering the results.
		 *
		 * The solid background is required, not cosmetic: field rows scroll UNDER the bar, and
		 * without it the two would overlap and read as a rendering fault.
		 */
		.dbm-search-actions {
		  position: sticky;
		  bottom: 0;
		  z-index: 2;
		  flex: none;
		  /* Full-bleed, so the bar reads as its own surface rather than as a table row. */
		  margin-left: -14px;
		  margin-right: -14px;
		  padding: 8px 14px;
		  background: var(--dsw-alias-bg-base);
		  border-top: 1px solid var(--dsw-alias-border-l3);
		}
		.dbm-search-results { flex: 1 1 auto; min-height: 240px; min-width: 0; }
		.dbm-search-table { width: auto; }
		/*
		 * A fixed layout for the four control columns.
		 *
		 * Without it the browser sizes each column from its own content, which differs per
		 * row: a decimal(10,2) type cell is wider than int, so the operator dropdowns of two
		 * rows do not line up \u2014 and lining up is the whole reason the column, its type and
		 * its collation sit on the same line as the controls. Column 1 (the name) is the only
		 * one that sizes to content.
		 */
		.dbm-search-table { table-layout: fixed; }
		.dbm-search-table th:first-child { width: 200px; }
		.dbm-search-table th:nth-child(2) { width: 130px; }
		.dbm-search-table th:nth-child(3) { width: 150px; }
		.dbm-search-table th:nth-child(4) { width: 150px; }
		.dbm-search-table th:nth-child(5) { width: auto; }
		/* The name is a row header, so it is not bold-shrunken like a data cell. */
		.dbm-search-table tbody th { font-weight: 500; text-align: left; }
		/* The operator and the value fill their column; the value cell holds up to two. */
		.dbm-search-operator { width: 100%; box-sizing: border-box; }
		.dbm-search-value-cell { display: flex; align-items: center; gap: 6px; }
		.dbm-search-value-cell > .dbm-input,
		.dbm-search-value-cell > .dbm-select { flex: 1 1 auto; min-width: 0; max-width: 320px; }
		/*
		 * A row that holds a condition is marked.
		 *
		 * The whole point of this form is "which rows are taking part", and without a mark
		 * the user has to re-read every value box to find out \u2014 on a 40-column table that
		 * is the difference between a usable page and a guessing game.
		 */
		.dbm-search-table tbody tr[data-used="true"] > th:first-child { color: var(--dsw-alias-label-primary); font-weight: 600; }
		.dbm-search-table tbody tr[data-used="true"] { background: var(--dsw-alias-interactive-bg-hover); }

		/*
		 * The TTL countdown. Tabular figures so a ticking number does not make the row
		 * jitter as digits change width, and the code font so it reads as a value rather
		 * than as prose.
		 */
		.dbm-countdown {
		  font-family: var(--ds-font-family-code);
		  font-size: 12px;
		  font-variant-numeric: tabular-nums;
		  color: var(--dsw-alias-label-secondary);
		}
		.dbm-pager {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  padding: 6px 12px;
		  border-top: 1px solid var(--dsw-alias-border-l3);
		  flex: none;
		  font-size: 12px;
		  color: var(--dsw-alias-label-secondary);
		}

		/* ---- modal ------------------------------------------------------------- */
		.dbm-overlay {
		  position: fixed;
		  inset: 0;
		  background: rgba(0, 0, 0, .35);
		  display: flex;
		  align-items: center;
		  justify-content: center;
		  z-index: 40;
		}
		.dbm-modal {
		  background: var(--dsw-alias-bg-base);
		  color: var(--dsw-alias-label-primary);
		  border: 1px solid var(--dsw-alias-border-l3);
		  border-radius: 12px;
		  width: min(560px, 92vw);
		  max-height: 88vh;
		  display: flex;
		  flex-direction: column;
		  overflow: hidden;
		  box-shadow: 0 12px 40px rgba(0, 0, 0, .3);
		}

		/*
		 * A wide dialog, for a form with genuinely many columns.
		 *
		 * MUST come after the .dbm-modal rule above, not before: both selectors have the same
		 * specificity (one class), so the later one wins. Placed earlier it was silently ignored
		 * and the dialog stayed 560px wide \u2014 measured at 562px, which is how the bug was found.
		 */
		.dbm-modal-wide { width: min(1180px, 96vw); }
		/* The form's own column grid may still exceed the dialog on a small window; let it
		 * scroll as a last resort rather than widening the dialog past the viewport. */
		.dbm-modal-wide .dbm-modal-body { overflow: auto; }
		/*
		 * The column grid is SIZED TO FIT, not left to its content.
		 *
		 * With one control per field and twelve fields, every input's min-width summed past the
		 * dialog and the last five columns were cut off (measured: a 1684px table inside a
		 * 1182px dialog). table-layout: fixed plus per-column widths makes the table honour the
		 * available width instead of growing to its content, and the inputs then shrink with
		 * their cells. The per-column widths below are in the header's own field order.
		 */
		.dbm-newtable-cols { table-layout: fixed; width: 100%; }
		.dbm-newtable-cols .dbm-input, .dbm-newtable-cols .dbm-select {
		  /* Fill the cell rather than setting a floor: a floor is what pushed the table wider
		     than its container. */
		  width: 100%;
		  min-width: 0;
		  box-sizing: border-box;
		}
		/* \u5B57\u6BB5\u540D \u7C7B\u578B \u957F\u5EA6 \u6392\u5E8F\u89C4\u5219 \u5C5E\u6027 \u7D22\u5F15 \u7D22\u5F15\u540D \u5141\u8BB8\u7A7A \u9ED8\u8BA4\u503C \u81EA\u589E \u6CE8\u91CA \u5220\u9664.
		 * \u7C7B\u578B is a select now (wider text), \u5C5E\u6027 is ONE dropdown instead of four checkboxes
		 * (much narrower), and \u81EA\u589E holds its reason as well as the box.
		 *
		 * \u9ED8\u8BA4\u503C was widened from 7% to 11%, taken from \u5C5E\u6027, \u7D22\u5F15\u540D, \u5141\u8BB8\u7A7A and \u6CE8\u91CA. The cell used to
		 * hold a dropdown AND a text field side by side, which in a 7% column left both of them a few
		 * pixels wide \u2014 reported as "\u586B\u5199\u503C\u7684\u6846\u6846\u548C\u9009\u62E9\u6846\u90FD\u6324\u7684\u770B\u4E0D\u89C1\u4E86". The cell now holds exactly one
		 * control, and this width is what makes that one control usable: measured at 1182px, the literal
		 * box comes out 90px rather than the 68px an 9% column gave, which is the difference between
		 * being able to read 'abc' and having to scroll a three-character literal. */
		.dbm-newtable-cols th:nth-child(1) { width: 10%; }
		.dbm-newtable-cols th:nth-child(2) { width: 13%; }
		.dbm-newtable-cols th:nth-child(3) { width: 7%; }
		.dbm-newtable-cols th:nth-child(4) { width: 11%; }
		.dbm-newtable-cols th:nth-child(5) { width: 10%; }
		.dbm-newtable-cols th:nth-child(6) { width: 8%; }
		.dbm-newtable-cols th:nth-child(7) { width: 8%; }
		.dbm-newtable-cols th:nth-child(8) { width: 4%; }
		.dbm-newtable-cols th:nth-child(9) { width: 11%; }
		.dbm-newtable-cols th:nth-child(10) { width: 8%; }
		.dbm-newtable-cols th:nth-child(11) { width: 8%; }
		.dbm-newtable-cols th:nth-child(12) { width: 2%; }
		.dbm-newtable-cols th, .dbm-newtable-cols td { padding: 4px 4px; vertical-align: middle; overflow: hidden; }
		/* The attribute cell holds four checkboxes stacked, so it does not set a wide floor. */
		.dbm-attrs { display: flex; flex-direction: column; gap: 2px; }
		.dbm-attrs .dbm-check { white-space: nowrap; font-size: 11px; }

		.dbm-modal-head {
		  padding: 12px 16px;
		  border-bottom: 1px solid var(--dsw-alias-border-l3);
		  font-weight: 600;
		  flex: none;
		}
		.dbm-modal-body { padding: 14px 16px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
		/*
		 * The footer wrapper carries the separator only. Button alignment is the
		 * caller's business: a dialog with its own arrangement (a secondary action on
		 * the left) must not have to fight a right-alignment imposed here. The wrapper
		 * is a flex row so a caller that passes a plain button list still lays out
		 * horizontally.
		 */
		.dbm-modal-foot {
		  padding: 12px 16px;
		  border-top: 1px solid var(--dsw-alias-border-l3);
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  flex: none;
		}
		/* A footer that is just a list of actions keeps the classic right alignment. */
		.dbm-modal-foot > .dbm-btn { margin-left: 0; }
		.dbm-modal-foot > :first-child:not(.dbm-modal-foot-split) { margin-left: auto; }
		/*
		 * Split footer: the test action sits on the left, away from the commit pair, so
		 * "check this" is never mistaken for "confirm this".
		 */
		.dbm-modal-foot-split {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  width: 100%;
		}
		.dbm-modal-foot-left { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; }
		.dbm-modal-foot-right { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }

		/*
		 * A labelled field on one line: label / control / optional unit. Used for the
		 * connect timeout, which previously shared a wrapping row with the TLS checkbox
		 * and broke onto a second line at the dialog's real width.
		 */
		.dbm-field-inline {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  font-size: 12px;
		  color: var(--dsw-alias-label-secondary);
		}
		.dbm-field-inline > .dbm-input { width: 110px; }

		/*
		 * Success messages can carry a note on its own line. The block display keeps
		 * the note off the same baseline as the headline, which is what made a long
		 * success line look like two unrelated fragments.
		 */
		.dbm-ok { color: #1a8a4a; font-size: 12px; display: block; }
		`;

		// src/client/index.ts
		var NS = "dsh-database-manager";
		var PANEL_ID = "database-manager";
		var ENTRY_ID = "database-manager";
		var PANEL_ROOT_SELECTOR = ".dbm-root";
		var ENTRY_GLYPH_ATTRIBUTE = "data-dsh-dbm-entry";
		var ENTRY_GLYPH_SELECTOR = `[${ENTRY_GLYPH_ATTRIBUTE}]`;
		var ACTIVATE_EVENT = "dsh-panel-activate";
		var SIBLING_ACTIVATION = { ssh: "ssh", taskboard: "taskboard" };
		var SIBLING_HTML_ATTRIBUTES = { ssh: "data-dsh-ssh-active", taskboard: "data-dsh-taskboard-active" };
		var SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]';
		var ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="8" cy="3.6" rx="5.1" ry="2.1"/><path d="M2.9 3.6v8.8c0 1.16 2.28 2.1 5.1 2.1s5.1-.94 5.1-2.1V3.6"/><path d="M2.9 8c0 1.16 2.28 2.1 5.1 2.1s5.1-.94 5.1-2.1"/></svg>';
		var inject = ["slots", "locale", "layout"];
		function apply(ctx) {
		  const context = ctx;
		  const api = new DbApi();
		  const controller = new PanelController();
		  context.effect(() => installStyles(PANEL_CSS, "dsh-database-manager"), "dsh-database-manager: styles");
		  context.effect(() => {
		    try {
		      return context.locale.register(NS, { zh, en });
		    } catch {
		      return () => {
		      };
		    }
		  }, "dsh-database-manager: dictionaries");
		  let localeTick = 0;
		  const localeListeners = /* @__PURE__ */ new Set();
		  context.effect(() => {
		    try {
		      return context.locale.subscribe(() => {
		        localeTick++;
		        for (const listener of [...localeListeners]) listener();
		      });
		    } catch {
		      return () => {
		      };
		    }
		  }, "dsh-database-manager: locale refresh");
		  const container = context.slots;
		  context.effect(() => {
		    try {
		      return container.inject(
		        "sidebar.panellist",
		        () => container.register(
		          {
		            name: "sidebar.panellist",
		            id: ENTRY_ID,
		            order: 20,
		            label: () => labelOf(context, "entry.label", "\u6570\u636E\u5E93\u7BA1\u7406")
		          },
		          (props) => React18.createElement("span", {
		            className: "dbm-entry-glyph",
		            [ENTRY_GLYPH_ATTRIBUTE]: ENTRY_ID,
		            "data-size": String(props.size),
		            dangerouslySetInnerHTML: { __html: ICON }
		          })
		        )
		      );
		    } catch (failure) {
		      console.warn("[dsh-database-manager] sidebar entry mount failed:", failure);
		      return () => {
		      };
		    }
		  }, "dsh-database-manager: sidebar entry");
		  const rowButton = () => {
		    const glyph = document.querySelector(ENTRY_GLYPH_SELECTOR);
		    return glyph === null ? null : glyph.closest("button");
		  };
		  const isShellActive = () => {
		    const button = rowButton();
		    return button !== null && button.getAttribute("aria-current") === "page";
		  };
		  const isVisible = () => {
		    const root = document.querySelector(PANEL_ROOT_SELECTOR);
		    if (root === null) return false;
		    const rect = root.getBoundingClientRect();
		    return rect.width > 0 && rect.height > 0;
		  };
		  const close = () => {
		    if (context.layout !== void 0) context.layout.selectPanel(null);
		  };
		  context.effect(() => {
		    const onKeyDown = (event) => {
		      if (event.key === "Escape" && isVisible()) close();
		    };
		    const onDocumentClick = (event) => {
		      if (!isShellActive()) return;
		      const target = event.target;
		      if (target === null) return;
		      if (target.closest(SIDEBAR_ROW_SELECTOR) === null) return;
		      if (isOurRowPress(target)) return;
		      close();
		    };
		    const onSiblingActivate = (event) => {
		      if (!isShellActive()) return;
		      const detail = event.detail;
		      if (detail === SIBLING_ACTIVATION.ssh || detail === SIBLING_ACTIVATION.taskboard) close();
		    };
		    document.addEventListener("keydown", onKeyDown);
		    document.addEventListener("click", onDocumentClick, true);
		    document.addEventListener(ACTIVATE_EVENT, onSiblingActivate);
		    return () => {
		      document.removeEventListener("keydown", onKeyDown);
		      document.removeEventListener("click", onDocumentClick, true);
		      document.removeEventListener(ACTIVATE_EVENT, onSiblingActivate);
		    };
		  }, "dsh-database-manager: centre-column arbitration");
		  context.effect(() => {
		    const onRowPress = (event) => {
		      const target = event.target;
		      if (target === null || !isOurRowPress(target)) return;
		      if (isVisible()) {
		        event.preventDefault();
		        event.stopPropagation();
		        close();
		        return;
		      }
		      if (document.documentElement.hasAttribute(SIBLING_HTML_ATTRIBUTES.ssh)) {
		        document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: SIBLING_ACTIVATION.taskboard }));
		      }
		      if (!isShellActive() && context.layout !== void 0) context.layout.selectPanel(PANEL_ID);
		    };
		    document.addEventListener("click", onRowPress, true);
		    return () => document.removeEventListener("click", onRowPress, true);
		  }, "dsh-database-manager: entry toggle");
		  context.effect(() => {
		    try {
		      return container.inject(
		        "main",
		        () => container.register(
		          { name: "main", key: PANEL_ID },
		          () => React18.createElement(PanelHost, { controller, api, localeListeners, onClose: close })
		        )
		      );
		    } catch (failure) {
		      console.warn("[dsh-database-manager] panel mount failed:", failure);
		      return () => {
		      };
		    }
		  }, "dsh-database-manager: panel");
		}
		function isOurRowPress(target) {
		  if (target.querySelector?.(ENTRY_GLYPH_SELECTOR) != null) return true;
		  return target.matches?.(ENTRY_GLYPH_SELECTOR) === true;
		}
		function labelOf(ctx, key, fallback) {
		  try {
		    return ctx.locale.bind(NS)(key) || fallback;
		  } catch {
		    return fallback;
		  }
		}
		function installStyles(css, pluginId) {
		  if (typeof document === "undefined") return () => {
		  };
		  const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(pluginId)}]`);
		  if (existing !== null) return () => {
		  };
		  const tag = document.createElement("style");
		  tag.dataset["plugin"] = pluginId;
		  tag.dataset["pluginCss"] = pluginId;
		  tag.textContent = css;
		  document.head.appendChild(tag);
		  return () => {
		    tag.remove();
		  };
		}
		function PanelHost(props) {
		  const { controller, api, localeListeners, onClose } = props;
		  const [localeTick, setLocaleTick] = React18.useState(0);
		  React18.useEffect(() => {
		    const listener = () => setLocaleTick((value) => value + 1);
		    localeListeners.add(listener);
		    return () => {
		      localeListeners.delete(listener);
		    };
		  }, [localeListeners]);
		  return React18.createElement(DatabasePanel, { controller, api, localeTick, onClose });
		}

		return module.exports;
	}
});
