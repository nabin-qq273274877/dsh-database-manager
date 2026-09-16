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
		var React10 = __toESM(require("react"), 1);

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
		  constructor(message) {
		    super(message);
		    this.name = "DbApiError";
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
		    throw new DbApiError(`HTTP ${response.status}: invalid JSON response`);
		  }
		  if (!response.ok) {
		    const message = typeof body === "object" && body !== null && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
		    throw new DbApiError(message);
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
		  /** Tables and views of one schema. */
		  async tables(id, schema) {
		    return (await readJson(await fetch(DB_API.tables(id, query({ schema }))))).tables;
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
		    const url = `${DB_API.rows(id)}?${query(options)}`;
		    return (await readJson(await fetch(url))).page;
		  }
		  /** Insert one row. */
		  async insertRow(id, body) {
		    return (await send(DB_API.row(id), "POST", body)).result;
		  }
		  /** Update rows matched by keys. */
		  async updateRow(id, body) {
		    return (await send(DB_API.row(id), "PATCH", body)).result;
		  }
		  /** Delete rows matched by keys. */
		  async deleteRow(id, body) {
		    return (await send(DB_API.row(id), "DELETE", body)).result;
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
		var React9 = __toESM(require("react"), 1);

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
		  "db.searchTable": "\u641C\u7D22\u8868\u540D\u2026",
		  "db.selectTable": "\u4ECE\u5DE6\u4FA7\u9009\u62E9\u4E00\u4E2A\u5E93\uFF0C\u518D\u70B9\u5F00\u4E00\u5F20\u8868",
		  "db.multipleDatabases": "\u6BCF\u4E2A\u5E93\u90FD\u53EF\u5C55\u5F00\uFF0C\u70B9\u5E93\u540D\u770B\u8868\u5217\u8868",
		  "tab.browse": "\u6D4F\u89C8",
		  "tab.structure": "\u7ED3\u6784",
		  "tab.sql": "SQL",
		  "tab.search": "\u641C\u7D22",
		  "tab.insert": "\u63D2\u5165",
		  "browse.refresh": "\u5237\u65B0",
		  "browse.pageSize": "\u6BCF\u9875",
		  "browse.total": "\u5171 {n} \u884C",
		  "browse.page": "\u7B2C {page} / {pages} \u9875",
		  "browse.prev": "\u4E0A\u4E00\u9875",
		  "browse.next": "\u4E0B\u4E00\u9875",
		  "browse.empty": "\u6CA1\u6709\u6570\u636E",
		  "browse.noPk": "\u8BE5\u8868\u6CA1\u6709\u4E3B\u952E\uFF0C\u65E0\u6CD5\u5728\u6D4F\u89C8\u9875\u76F4\u63A5\u7F16\u8F91\u884C\uFF1B\u8BF7\u4F7F\u7528 SQL \u6807\u7B7E\u9875\u3002",
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
		  "structure.index.name": "\u7D22\u5F15\u540D",
		  "structure.index.unique": "\u552F\u4E00",
		  "structure.index.columns": "\u5217",
		  "structure.index.type": "\u7C7B\u578B",
		  "sql.placeholder": "\u8F93\u5165\u4E00\u6761 SQL \u8BED\u53E5\uFF0CCtrl+Enter \u6267\u884C",
		  "sql.run": "\u6267\u884C",
		  "sql.running": "\u6267\u884C\u4E2D\u2026",
		  "sql.allowWrite": "\u5141\u8BB8\u5199\u5165",
		  "sql.allowWrite.hint": "\u672A\u52FE\u9009\u65F6\u53EA\u5141\u8BB8 SELECT / SHOW / DESCRIBE / EXPLAIN \u7B49\u53EA\u8BFB\u8BED\u53E5\u3002",
		  "sql.affected": "{n} \u884C\u53D7\u5F71\u54CD\uFF0C\u8017\u65F6 {ms} ms",
		  "sql.rows": "{n} \u884C\uFF0C\u8017\u65F6 {ms} ms",
		  "sql.truncated": "\u7ED3\u679C\u5DF2\u622A\u65AD",
		  "search.placeholder": "\u5728\u5168\u8868\u6587\u672C\u5217\u4E2D\u641C\u7D22\u2026",
		  "search.run": "\u641C\u7D22",
		  "search.condition": "\u6216\u76F4\u63A5\u586B\u5199 WHERE \u6761\u4EF6",
		  "search.conditionPlaceholder": "\u4F8B\u5982 id > 100 AND status = 1",
		  "insert.title": "\u63D2\u5165\u4E00\u884C",
		  "insert.hint": "\u7559\u7A7A\u7684\u5217\u4F1A\u4F7F\u7528\u6570\u636E\u5E93\u9ED8\u8BA4\u503C\u6216 NULL\u3002",
		  "insert.submit": "\u63D2\u5165",
		  "insert.done": "\u5DF2\u63D2\u5165 {n} \u884C",
		  "insert.required": "\u5217\u300C{column}\u300D\u4E0D\u5141\u8BB8\u4E3A\u7A7A",
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
		  "db.searchTable": "Filter tables\u2026",
		  "db.selectTable": "Pick a database on the left, then open a table",
		  "db.multipleDatabases": "Every database expands independently \u2014 click one to see its tables",
		  "tab.browse": "Browse",
		  "tab.structure": "Structure",
		  "tab.sql": "SQL",
		  "tab.search": "Search",
		  "tab.insert": "Insert",
		  "browse.refresh": "Refresh",
		  "browse.pageSize": "Per page",
		  "browse.total": "{n} row(s)",
		  "browse.page": "Page {page} / {pages}",
		  "browse.prev": "Previous",
		  "browse.next": "Next",
		  "browse.empty": "No data",
		  "browse.noPk": "This table has no primary key, so rows cannot be edited from Browse; use the SQL tab.",
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
		  "structure.index.name": "Index",
		  "structure.index.unique": "Unique",
		  "structure.index.columns": "Columns",
		  "structure.index.type": "Type",
		  "sql.placeholder": "Type one SQL statement; Ctrl+Enter runs it",
		  "sql.run": "Run",
		  "sql.running": "Running\u2026",
		  "sql.allowWrite": "Allow writes",
		  "sql.allowWrite.hint": "While unticked only read-only statements (SELECT / SHOW / DESCRIBE / EXPLAIN) are accepted.",
		  "sql.affected": "{n} row(s) affected in {ms} ms",
		  "sql.rows": "{n} row(s) in {ms} ms",
		  "sql.truncated": "Result truncated",
		  "search.placeholder": "Search across every text column\u2026",
		  "search.run": "Search",
		  "search.condition": "Or type a raw WHERE condition",
		  "search.conditionPlaceholder": "e.g. id > 100 AND status = 1",
		  "insert.title": "Insert a row",
		  "insert.hint": "A blank column takes the database default or NULL.",
		  "insert.submit": "Insert",
		  "insert.done": "{n} row(s) inserted",
		  "insert.required": "Column \u201C{column}\u201D cannot be empty",
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
		      { className: "dbm-modal", role: "dialog", "aria-modal": "true", "aria-label": title },
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
		    if (level.truncated) {
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
		function RedisDatabaseView(props) {
		  const { api, source, initialInfo, onBack, onClose } = props;
		  const [info, setInfo] = React5.useState(initialInfo);
		  const [pattern, setPattern] = React5.useState("");
		  const [searchDb, setSearchDb] = React5.useState(source.db ?? 0);
		  const [search, setSearch] = React5.useState(void 0);
		  const [levels, setLevels] = React5.useState({});
		  const [openDbs, setOpenDbs] = React5.useState(() => ({ [source.db ?? 0]: true }));
		  const [openFolders, setOpenFolders] = React5.useState({});
		  const [selection, setSelection] = React5.useState(void 0);
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
		  const loadLevel = React5.useCallback(async (db, prefix) => {
		    const key = levelKey(db, prefix);
		    setLevels((current) => ({
		      ...current,
		      [key]: current[key] === void 0 ? { folders: [], keys: [], truncated: false, keysAtLevel: 0, loading: true } : { ...current[key], loading: true, error: void 0 }
		    }));
		    try {
		      const page = await api.redisLevel(source.id, { db, prefix, withTypes: prefix !== "" });
		      setLevels((current) => ({
		        ...current,
		        [key]: {
		          folders: page.folders,
		          keys: page.keys,
		          truncated: page.truncated,
		          keysAtLevel: page.keysAtLevel
		        }
		      }));
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
		  React5.useEffect(() => {
		    void loadLevel(initialDb, "");
		  }, [initialDb, loadLevel]);
		  const toggleDb = (db) => {
		    const next = openDbs[db] !== true;
		    setOpenDbs((current) => ({ ...current, [db]: next }));
		    if (next && levels[levelKey(db, "")] === void 0) void loadLevel(db, "");
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
		    const activeDb2 = activeKey?.db ?? initialDb;
		    body.push(
		      value === void 0 ? React5.createElement(Empty, { key: "empty", message: valueLoading ? t("common.loading") : t("redis.selectKey") }) : React5.createElement(RedisValueEditor, {
		        key: `value-${activeDb2}-${value.key}`,
		        api,
		        source,
		        db: activeDb2,
		        value,
		        onReload: () => {
		          void loadValue(activeDb2, value.key);
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
		          void loadLevel(activeDb2, value.key.includes(":") ? value.key.slice(0, value.key.lastIndexOf(":")) : "");
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
		        db: selection?.db ?? initialDb,
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
		  const activeDb = selection?.db ?? initialDb;
		  return React5.createElement(
		    "div",
		    { className: "dbm-root" },
		    React5.createElement(
		      "div",
		      { className: "dbm-header" },
		      React5.createElement(BackButton, { onBack, label: t("panel.backToList") }),
		      React5.createElement("span", { className: "dbm-title" }, source.name),
		      React5.createElement("span", { className: "dbm-badge dbm-badge-redis" }, "redis"),
		      React5.createElement("span", { className: "dbm-subtitle dbm-mono" }, `${source.host ?? ""}:${source.port ?? ""}/db${activeDb}`),
		      React5.createElement("span", { className: "dbm-spacer" }),
		      React5.createElement(BackButton, { onBack: onClose })
		    ),
		    error === void 0 ? null : React5.createElement(ErrorBanner, { message: error }),
		    notice === void 0 ? null : React5.createElement("div", { className: "dbm-ok", style: { padding: "6px 14px" } }, notice),
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
		    })
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
		  const { api, source, db, onResult, onError, onMutated } = props;
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
		        React5.createElement("span", { className: "dbm-hint" }, `db${db} \xB7 ${allowWrite ? t("redis.allowWrite.hint") : t("redis.readonlyNotice")}`)
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
		            { colSpan: 7, className: "dbm-hint", style: { background: "var(--dsw-alias-interactive-bg-hover)", fontWeight: 500 } },
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
		              React7.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm dbm-btn-primary", onClick: () => onConnect(source) }, t("action.connect")),
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
		            ...[t("col.kind"), t("col.name"), t("col.host"), t("col.user"), t("col.auth"), t("col.tags"), t("col.actions")].map(
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
		      React7.createElement("span", { className: "dbm-spacer" }),
		      React7.createElement(
		        "span",
		        { className: "dbm-hint" },
		        `${t("panel.engines")}: ${engines.map((engine) => `${engine.kind}${engine.available ? "" : " \u2717"}`).join(" \xB7 ")}`
		      )
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
		var React8 = __toESM(require("react"), 1);
		function SqlDatabaseView(props) {
		  const { api, source, initialSchemas, onBack, onClose } = props;
		  const [schemas, setSchemas] = React8.useState(initialSchemas);
		  const [tableFilter, setTableFilter] = React8.useState("");
		  const [openSchemas, setOpenSchemas] = React8.useState({});
		  const [tablesBySchema, setTablesBySchema] = React8.useState({});
		  const [loadingSchemas, setLoadingSchemas] = React8.useState({});
		  const [activeSchema, setActiveSchema] = React8.useState(void 0);
		  const [activeTable, setActiveTable] = React8.useState(void 0);
		  const [tab, setTab] = React8.useState("browse");
		  const [error, setError] = React8.useState(void 0);
		  const [notice, setNotice] = React8.useState(void 0);
		  const [rows, setRows] = React8.useState(void 0);
		  const [page, setPage] = React8.useState(1);
		  const [pageSize, setPageSize] = React8.useState(200);
		  const [orderBy, setOrderBy] = React8.useState(void 0);
		  const [orderDir, setOrderDir] = React8.useState("asc");
		  const [columns, setColumns] = React8.useState([]);
		  const [indexes, setIndexes] = React8.useState([]);
		  const loadSchemas = React8.useCallback(async () => {
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
		  const loadTables = React8.useCallback(async (schema, force = false) => {
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
		  React8.useEffect(() => {
		    void loadSchemas();
		  }, [loadSchemas]);
		  React8.useEffect(() => {
		    if (schemas.length !== 1) return;
		    const only = schemas[0];
		    setOpenSchemas((current) => current[only] === void 0 ? { ...current, [only]: true } : current);
		    void loadTables(only);
		  }, [schemas, loadTables]);
		  const toggleSchema = (schema) => {
		    const next = !(openSchemas[schema] ?? false);
		    setOpenSchemas((current) => ({ ...current, [schema]: next }));
		    if (next) void loadTables(schema);
		  };
		  const loadRows = React8.useCallback(async (options) => {
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
		        orderDir: options.orderDir ?? "asc"
		      });
		      setRows({ page: result, loading: false });
		      setColumns(result.columns);
		    } catch (failure) {
		      setRows((current) => ({ page: current?.page ?? emptyPage(), loading: false, error: failure instanceof Error ? failure.message : String(failure) }));
		    }
		  }, [api, source.id]);
		  const loadStructure = React8.useCallback(async (schema, table) => {
		    try {
		      const [cols, idx] = await Promise.all([
		        api.columns(source.id, table, schema),
		        api.indexes(source.id, table, schema).catch(() => [])
		      ]);
		      setColumns(cols);
		      setIndexes(idx);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    }
		  }, [api, source.id, activeSchema]);
		  const openTable = (schema, table, nextTab = "browse") => {
		    setActiveSchema(schema);
		    setActiveTable(table);
		    setTab(nextTab);
		    setOrderBy(void 0);
		    setPage(1);
		    setError(void 0);
		    setNotice(void 0);
		    if (nextTab === "structure") void loadStructure(schema, table);
		    if (nextTab === "browse") void loadRows({ schema, table, page: 1, pageSize, mode: "browse" });
		  };
		  const changeTab = (next) => {
		    setTab(next);
		    setError(void 0);
		    setNotice(void 0);
		    if (activeTable === void 0 || activeSchema === void 0) return;
		    if (next === "structure") void loadStructure(activeSchema, activeTable);
		    if (next === "browse") void loadRows({ schema: activeSchema, table: activeTable, page: 1, pageSize, mode: "browse" });
		    if (next === "insert") void loadStructure(activeSchema, activeTable);
		  };
		  const matchesFilter = (name) => tableFilter === "" || name.toLowerCase().includes(tableFilter.toLowerCase());
		  const tree = [];
		  for (const schema of schemas) {
		    const isOpen = openSchemas[schema] ?? false;
		    const tables = tablesBySchema[schema];
		    const loading = loadingSchemas[schema] === true;
		    tree.push(
		      React8.createElement(
		        "button",
		        {
		          key: `schema-${schema}`,
		          type: "button",
		          className: "dbm-tree-item",
		          "data-active": String(activeSchema === schema && activeTable === void 0),
		          title: schema,
		          onClick: () => toggleSchema(schema)
		        },
		        React8.createElement("span", { className: "dbm-tree-caret" }, isOpen ? "\u25BE" : "\u25B8"),
		        React8.createElement("span", { className: "dbm-tree-name" }, schema),
		        tables === void 0 ? null : React8.createElement("span", { className: "dbm-tree-meta" }, String(tables.filter((table) => matchesFilter(table.name)).length))
		      )
		    );
		    if (!isOpen) continue;
		    if (loading && tables === void 0) {
		      tree.push(React8.createElement("div", { key: `loading-${schema}`, className: "dbm-tree-item dbm-tree-indent-1 dbm-hint" }, t("common.loading")));
		      continue;
		    }
		    const list = (tables ?? []).filter((table) => matchesFilter(table.name));
		    if (list.length === 0) {
		      tree.push(
		        React8.createElement(
		          "div",
		          { key: `empty-${schema}`, className: "dbm-tree-item dbm-tree-indent-1 dbm-hint" },
		          t("db.noTables")
		        )
		      );
		      continue;
		    }
		    for (const table of list) {
		      tree.push(
		        React8.createElement(
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
		          React8.createElement("span", { className: "dbm-tree-caret" }, table.type === "view" ? "\u25EB" : "\u25A4"),
		          React8.createElement("span", { className: "dbm-tree-name" }, table.name),
		          table.rows === void 0 ? null : React8.createElement("span", { className: "dbm-tree-meta" }, String(table.rows))
		        )
		      );
		    }
		  }
		  const left = React8.createElement(
		    "div",
		    { className: "dbm-side" },
		    React8.createElement(
		      "div",
		      { className: "dbm-side-head" },
		      React8.createElement("input", {
		        className: "dbm-input",
		        style: { flex: 1 },
		        value: tableFilter,
		        placeholder: t("db.searchTable"),
		        onChange: (event) => setTableFilter(event.target.value)
		      }),
		      React8.createElement("button", {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        title: t("common.refresh"),
		        onClick: () => {
		          void loadSchemas();
		          for (const schema of schemas) if (openSchemas[schema] === true) void loadTables(schema, true);
		        }
		      }, "\u27F3")
		    ),
		    React8.createElement("div", { className: "dbm-side-body" }, tree)
		  );
		  const selection = activeSchema !== void 0 && activeTable !== void 0 ? { schema: activeSchema, table: activeTable } : void 0;
		  const body = [];
		  if (selection === void 0) {
		    body.push(React8.createElement(Empty, { key: "empty", message: t("db.selectTable") }));
		  } else {
		    body.push(
		      React8.createElement(TabStrip, {
		        key: "tabs",
		        active: tab,
		        tabs: [
		          { id: "browse", label: t("tab.browse") },
		          { id: "structure", label: t("tab.structure") },
		          { id: "sql", label: t("tab.sql") },
		          { id: "search", label: t("tab.search") },
		          { id: "insert", label: t("tab.insert") }
		        ],
		        onChange: (next) => changeTab(next)
		      })
		    );
		    if (tab === "browse") {
		      body.push(React8.createElement(BrowseTab, {
		        key: "browse-body",
		        rows,
		        orderBy,
		        orderDir,
		        pageSize,
		        onSort: (column) => {
		          const nextDir = orderBy === column && orderDir === "asc" ? "desc" : "asc";
		          setOrderBy(column);
		          setOrderDir(nextDir);
		          void loadRows({ schema: selection.schema, table: selection.table, page, pageSize, mode: "browse", orderBy: column, orderDir: nextDir });
		        },
		        onPage: (next) => {
		          setPage(next);
		          void loadRows({ schema: selection.schema, table: selection.table, page: next, pageSize, mode: "browse", ...orderBy === void 0 ? {} : { orderBy, orderDir } });
		        },
		        onPageSize: (size) => {
		          setPageSize(size);
		          setPage(1);
		          void loadRows({ schema: selection.schema, table: selection.table, page: 1, pageSize: size, mode: "browse" });
		        },
		        onRefresh: () => {
		          void loadRows({ schema: selection.schema, table: selection.table, page, pageSize, mode: "browse", ...orderBy === void 0 ? {} : { orderBy, orderDir } });
		        }
		      }));
		    }
		    if (tab === "structure") {
		      body.push(React8.createElement(StructureTab, { key: "structure-body", columns, indexes }));
		    }
		    if (tab === "sql") {
		      body.push(
		        React8.createElement(SqlTabView, {
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
		        React8.createElement(SearchTab, {
		          key: "search-body",
		          onSearch: (payload) => {
		            void loadRows({
		              schema: selection.schema,
		              table: selection.table,
		              page: 1,
		              pageSize,
		              mode: "search",
		              ...payload.term === void 0 ? {} : { term: payload.term },
		              ...payload.condition === void 0 ? {} : { condition: payload.condition }
		            });
		          },
		          rows
		        })
		      );
		    }
		    if (tab === "insert") {
		      body.push(
		        React8.createElement(InsertTab, {
		          key: "insert-body",
		          api,
		          source,
		          schema: selection.schema,
		          table: selection.table,
		          columns,
		          onDone: (message) => {
		            setNotice(message);
		            setError(void 0);
		            void loadTables(selection.schema, true);
		            void loadRows({ schema: selection.schema, table: selection.table, page: 1, pageSize, mode: "browse" });
		          },
		          onError: (message) => {
		            setError(message);
		            setNotice(void 0);
		          }
		        })
		      );
		    }
		  }
		  return React8.createElement(
		    "div",
		    { className: "dbm-root" },
		    React8.createElement(
		      "div",
		      { className: "dbm-header" },
		      React8.createElement(BackButton, { onBack, label: t("panel.backToList") }),
		      React8.createElement("span", { className: "dbm-title" }, source.name),
		      React8.createElement("span", { className: `dbm-badge dbm-badge-${source.kind}` }, source.kind),
		      React8.createElement("span", { className: "dbm-subtitle dbm-mono" }, source.kind === "sqlite" ? source.file ?? "" : `${source.host ?? ""}:${source.port ?? ""}`),
		      React8.createElement("span", { className: "dbm-spacer" }),
		      React8.createElement(BackButton, { onBack: onClose })
		    ),
		    error === void 0 ? null : React8.createElement(ErrorBanner, { message: error }),
		    notice === void 0 ? null : React8.createElement("div", { className: "dbm-ok", style: { padding: "6px 14px" } }, notice),
		    React8.createElement("div", { className: "dbm-split" }, left, React8.createElement("div", { className: "dbm-main" }, body))
		  );
		}
		function emptyPage() {
		  return { columns: [], rows: [], total: 0, page: 1, pageSize: 200, primaryKey: [] };
		}
		function BrowseTab(props) {
		  const { rows, orderBy, orderDir, pageSize, onSort, onPage, onPageSize, onRefresh } = props;
		  if (rows === void 0) return React8.createElement(Empty, { message: t("common.loading") });
		  if (rows.error !== void 0) return React8.createElement(ErrorBanner, { message: rows.error });
		  const page = rows.page;
		  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
		  const columns = page.columns.map((column) => column.name);
		  return React8.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React8.createElement(
		      "div",
		      { className: "dbm-row", style: { padding: "8px 12px" } },
		      React8.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", onClick: onRefresh }, t("browse.refresh")),
		      React8.createElement("label", { className: "dbm-hint" }, `${t("browse.pageSize")}: ${""}`),
		      React8.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: String(pageSize),
		          onChange: (event) => onPageSize(Number(event.target.value))
		        },
		        [50, 100, 200, 500, 1e3].map((size) => React8.createElement("option", { key: size, value: String(size) }, String(size)))
		      ),
		      React8.createElement("span", { className: "dbm-hint" }, t("browse.total", { n: page.total })),
		      React8.createElement("span", { className: "dbm-spacer" }),
		      rows.loading ? React8.createElement("span", { className: "dbm-hint" }, t("common.loading")) : null
		    ),
		    page.columns.length === 0 ? React8.createElement(Empty, { message: t("browse.empty") }) : React8.createElement(
		      "div",
		      { className: "dbm-data" },
		      React8.createElement(
		        "table",
		        null,
		        React8.createElement(
		          "thead",
		          null,
		          React8.createElement(
		            "tr",
		            null,
		            page.columns.map(
		              (column) => React8.createElement(
		                "th",
		                { key: column.name },
		                React8.createElement(
		                  "button",
		                  { type: "button", onClick: () => onSort(column.name) },
		                  `${column.name}${orderBy === column.name ? orderDir === "asc" ? " \u25B2" : " \u25BC" : ""}`
		                )
		              )
		            )
		          )
		        ),
		        React8.createElement(
		          "tbody",
		          null,
		          page.rows.map(
		            (row, index) => React8.createElement(
		              "tr",
		              { key: index },
		              columns.map(
		                (column) => React8.createElement(
		                  "td",
		                  { key: column, className: isNull(row[column] ?? null) ? "dbm-null" : void 0, title: renderCell(row[column] ?? null) },
		                  renderCell(row[column] ?? null)
		                )
		              )
		            )
		          )
		        )
		      )
		    ),
		    React8.createElement(
		      "div",
		      { className: "dbm-pager" },
		      React8.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", disabled: page.page <= 1, onClick: () => onPage(page.page - 1) }, t("browse.prev")),
		      React8.createElement("span", null, t("browse.page", { page: page.page, pages })),
		      React8.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", disabled: page.page >= pages, onClick: () => onPage(page.page + 1) }, t("browse.next")),
		      page.primaryKey.length === 0 ? React8.createElement("span", { className: "dbm-hint" }, t("browse.noPk")) : null
		    )
		  );
		}
		function StructureTab(props) {
		  const { columns, indexes } = props;
		  return React8.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React8.createElement(
		      "div",
		      { className: "dbm-scroll" },
		      React8.createElement("div", { className: "dbm-pad" }, React8.createElement("strong", null, t("structure.columns"))),
		      React8.createElement(
		        "table",
		        { className: "dbm-table" },
		        React8.createElement(
		          "thead",
		          null,
		          React8.createElement(
		            "tr",
		            null,
		            ...[t("structure.col.name"), t("structure.col.type"), t("structure.col.nullable"), t("structure.col.key"), t("structure.col.default"), t("structure.col.extra"), t("structure.col.comment")].map(
		              (label) => React8.createElement("th", { key: label }, label)
		            )
		          )
		        ),
		        React8.createElement(
		          "tbody",
		          null,
		          columns.map(
		            (column) => React8.createElement(
		              "tr",
		              { key: column.name },
		              React8.createElement("td", { className: "dbm-mono" }, column.name),
		              React8.createElement("td", { className: "dbm-mono" }, column.type),
		              React8.createElement("td", null, column.nullable ? t("common.yes") : t("common.no")),
		              React8.createElement("td", null, column.key === "" ? t("common.none") : column.key),
		              React8.createElement("td", { className: "dbm-mono" }, column.defaultValue ?? t("common.none")),
		              React8.createElement("td", { className: "dbm-mono" }, column.extra ?? t("common.none")),
		              React8.createElement("td", null, column.comment ?? "")
		            )
		          )
		        )
		      ),
		      React8.createElement("div", { className: "dbm-pad" }, React8.createElement("strong", null, t("structure.indexes"))),
		      indexes.length === 0 ? React8.createElement("div", { className: "dbm-pad dbm-hint" }, t("structure.noIndexes")) : React8.createElement(
		        "table",
		        { className: "dbm-table" },
		        React8.createElement(
		          "thead",
		          null,
		          React8.createElement(
		            "tr",
		            null,
		            ...[t("structure.index.name"), t("structure.index.unique"), t("structure.index.columns"), t("structure.index.type")].map(
		              (label) => React8.createElement("th", { key: label }, label)
		            )
		          )
		        ),
		        React8.createElement(
		          "tbody",
		          null,
		          indexes.map(
		            (index) => React8.createElement(
		              "tr",
		              { key: index.name },
		              React8.createElement("td", { className: "dbm-mono" }, index.name),
		              React8.createElement("td", null, index.unique ? t("common.yes") : t("common.no")),
		              React8.createElement("td", { className: "dbm-mono" }, index.columns.join(", ")),
		              React8.createElement("td", null, index.type ?? t("common.none"))
		            )
		          )
		        )
		      )
		    )
		  );
		}
		function SqlTabView(props) {
		  const { api, source, schema, onResult, onError } = props;
		  const [sql, setSql] = React8.useState("");
		  const [allowWrite, setAllowWrite] = React8.useState(false);
		  const [result, setResult] = React8.useState(void 0);
		  const [busy, setBusy] = React8.useState(false);
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
		  return React8.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React8.createElement(
		      "div",
		      { className: "dbm-pad" },
		      React8.createElement("textarea", {
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
		      React8.createElement(
		        "div",
		        { className: "dbm-row" },
		        React8.createElement("button", { type: "button", className: "dbm-btn dbm-btn-primary", disabled: busy, onClick: () => {
		          void run();
		        } }, busy ? t("sql.running") : t("sql.run")),
		        React8.createElement(
		          "label",
		          { className: "dbm-check" },
		          React8.createElement("input", {
		            type: "checkbox",
		            checked: allowWrite,
		            onChange: (event) => setAllowWrite(event.target.checked)
		          }),
		          t("sql.allowWrite")
		        ),
		        React8.createElement("span", { className: "dbm-hint" }, t("sql.allowWrite.hint"))
		      )
		    ),
		    result === void 0 ? null : React8.createElement(
		      "div",
		      { className: "dbm-tab-body", style: { minHeight: 0 } },
		      React8.createElement("div", { className: "dbm-pad dbm-hint" }, result.message),
		      result.columns.length === 0 ? null : React8.createElement(
		        "div",
		        { className: "dbm-data" },
		        React8.createElement(
		          "table",
		          null,
		          React8.createElement("thead", null, React8.createElement("tr", null, result.columns.map((column) => React8.createElement("th", { key: column }, column)))),
		          React8.createElement(
		            "tbody",
		            null,
		            result.rows.map(
		              (row, index) => React8.createElement(
		                "tr",
		                { key: index },
		                row.map(
		                  (cell, cellIndex) => React8.createElement(
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
		function SearchTab(props) {
		  const { onSearch, rows } = props;
		  const [term, setTerm] = React8.useState("");
		  const [condition, setCondition] = React8.useState("");
		  const submit = () => {
		    if (condition.trim() !== "") onSearch({ condition: condition.trim() });
		    else if (term.trim() !== "") onSearch({ term: term.trim() });
		  };
		  return React8.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React8.createElement(
		      "div",
		      { className: "dbm-pad" },
		      React8.createElement(
		        "div",
		        { className: "dbm-row" },
		        React8.createElement("input", {
		          className: "dbm-input",
		          style: { flex: 1, minWidth: 200 },
		          value: term,
		          placeholder: t("search.placeholder"),
		          onChange: (event) => setTerm(event.target.value),
		          onKeyDown: (event) => {
		            if (event.key === "Enter") submit();
		          }
		        }),
		        React8.createElement("button", { type: "button", className: "dbm-btn dbm-btn-primary", onClick: submit }, t("search.run"))
		      ),
		      React8.createElement(
		        "div",
		        { className: "dbm-row" },
		        React8.createElement("span", { className: "dbm-hint" }, t("search.condition")),
		        React8.createElement("input", {
		          className: "dbm-input dbm-mono",
		          style: { flex: 1 },
		          value: condition,
		          placeholder: t("search.conditionPlaceholder"),
		          spellcheck: false,
		          onChange: (event) => setCondition(event.target.value),
		          onKeyDown: (event) => {
		            if (event.key === "Enter") submit();
		          }
		        })
		      )
		    ),
		    rows === void 0 ? null : rows.error !== void 0 ? React8.createElement(ErrorBanner, { message: rows.error }) : React8.createElement(
		      "div",
		      { className: "dbm-tab-body", style: { minHeight: 0 } },
		      React8.createElement("div", { className: "dbm-pad dbm-hint" }, t("browse.total", { n: rows.page.total })),
		      React8.createElement(
		        "div",
		        { className: "dbm-data" },
		        React8.createElement(
		          "table",
		          null,
		          React8.createElement("thead", null, React8.createElement("tr", null, rows.page.columns.map((column) => React8.createElement("th", { key: column.name }, column.name)))),
		          React8.createElement(
		            "tbody",
		            null,
		            rows.page.rows.map(
		              (row, index) => React8.createElement(
		                "tr",
		                { key: index },
		                rows.page.columns.map(
		                  (column) => React8.createElement(
		                    "td",
		                    { key: column.name, className: isNull(row[column.name] ?? null) ? "dbm-null" : void 0, title: renderCell(row[column.name] ?? null) },
		                    renderCell(row[column.name] ?? null)
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
		function InsertTab(props) {
		  const { api, source, schema, table, columns, onDone, onError } = props;
		  const [values, setValues] = React8.useState({});
		  const [useNull, setUseNull] = React8.useState({});
		  const [busy, setBusy] = React8.useState(false);
		  const submit = async () => {
		    const payload = [];
		    for (const column of columns) {
		      const raw = values[column.name] ?? "";
		      if (useNull[column.name] === true) payload.push({ column: column.name, value: null });
		      else if (raw !== "") payload.push({ column: column.name, value: raw });
		      else if (!column.nullable && column.defaultValue === void 0) {
		        onError(t("insert.required", { column: column.name }));
		        return;
		      }
		    }
		    if (payload.length === 0) {
		      onError(t("insert.required", { column: columns[0]?.name ?? table }));
		      return;
		    }
		    setBusy(true);
		    try {
		      const result = await api.insertRow(source.id, {
		        ...schema === void 0 ? {} : { schema },
		        table,
		        values: payload
		      });
		      setValues({});
		      setUseNull({});
		      onDone(t("insert.done", { n: result.affected }));
		    } catch (failure) {
		      onError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setBusy(false);
		    }
		  };
		  return React8.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React8.createElement(
		      "div",
		      { className: "dbm-scroll" },
		      React8.createElement(
		        "div",
		        { className: "dbm-pad" },
		        React8.createElement("strong", null, `${t("insert.title")} \u2014 ${table}`),
		        React8.createElement("div", { className: "dbm-hint" }, t("insert.hint")),
		        React8.createElement(
		          "div",
		          { className: "dbm-grid", style: { gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" } },
		          columns.map(
		            (column) => React8.createElement(
		              "label",
		              { className: "dbm-label", key: column.name },
		              React8.createElement(
		                "span",
		                null,
		                column.name,
		                React8.createElement("span", { className: "dbm-hint" }, ` \xB7 ${column.type}${column.nullable ? "" : " NOT NULL"}${column.key === "PRI" ? " PK" : ""}`)
		              ),
		              React8.createElement("input", {
		                className: "dbm-input dbm-mono",
		                value: values[column.name] ?? "",
		                disabled: useNull[column.name] === true,
		                placeholder: column.defaultValue ?? (column.nullable ? t("common.null") : ""),
		                onChange: (event) => setValues((current) => ({ ...current, [column.name]: event.target.value }))
		              }),
		              column.nullable ? React8.createElement(
		                "span",
		                { className: "dbm-check" },
		                React8.createElement("input", {
		                  type: "checkbox",
		                  checked: useNull[column.name] === true,
		                  onChange: (event) => setUseNull((current) => ({ ...current, [column.name]: event.target.checked }))
		                }),
		                t("common.null")
		              ) : null
		            )
		          )
		        ),
		        React8.createElement(
		          "div",
		          { className: "dbm-row" },
		          React8.createElement("button", { type: "button", className: "dbm-btn dbm-btn-primary", disabled: busy, onClick: () => {
		            void submit();
		          } }, busy ? t("common.loading") : t("insert.submit"))
		        )
		      )
		    )
		  );
		}

		// src/client/DatabasePanel.ts
		function DatabasePanel(props) {
		  const { controller, api, localeTick, onClose } = props;
		  const [snapshot, setSnapshot] = React9.useState(() => controller.getSnapshot());
		  const [sources, setSources] = React9.useState(void 0);
		  const [settings, setSettings] = React9.useState({ allowAgentWrite: false, requireApproval: true });
		  const [engines, setEngines] = React9.useState([]);
		  const [error, setError] = React9.useState(void 0);
		  void localeTick;
		  React9.useEffect(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller]);
		  const reload = React9.useCallback(async () => {
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
		  React9.useEffect(() => {
		    void reload();
		  }, [reload]);
		  React9.useEffect(() => {
		    void api.engines().then(setEngines).catch(() => setEngines([]));
		  }, [api]);
		  const saveGate = React9.useCallback(async (patch) => {
		    try {
		      setSettings(await api.setSettings(patch));
		      setError(void 0);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    }
		  }, [api]);
		  const connect = React9.useCallback(async (source) => {
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
		    body = React9.createElement(SqlDatabaseView, {
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
		    body = React9.createElement(RedisDatabaseView, {
		      api,
		      source: screen.source,
		      initialInfo: screen.info,
		      onBack: () => controller.showList(),
		      onClose
		    });
		  } else if (sources === void 0) {
		    body = React9.createElement(Empty, { message: t("common.loading") });
		  } else {
		    body = React9.createElement(SourceListView, {
		      api,
		      sources,
		      settings,
		      engines,
		      reload,
		      saveGate,
		      onConnect: (source) => {
		        void connect(source);
		      },
		      onBack: onClose
		    });
		  }
		  return React9.createElement(
		    "div",
		    { className: "dbm-shell" },
		    error === void 0 ? null : React9.createElement(ErrorBanner, { message: error }),
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
		.dbm-tree-item {
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
		.dbm-tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
		          (props) => React10.createElement("span", {
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
		          () => React10.createElement(PanelHost, { controller, api, localeListeners, onClose: close })
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
		  const [localeTick, setLocaleTick] = React10.useState(0);
		  React10.useEffect(() => {
		    const listener = () => setLocaleTick((value) => value + 1);
		    localeListeners.add(listener);
		    return () => {
		      localeListeners.delete(listener);
		    };
		  }, [localeListeners]);
		  return React10.createElement(DatabasePanel, { controller, api, localeTick, onClose });
		}

		return module.exports;
	}
});
