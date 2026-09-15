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
		var React7 = __toESM(require("react"), 1);

		// src/protocol.ts
		var DB_KINDS = ["sqlite", "mysql", "redis"];
		var DB_API_BASE = "/api/dsh-database";
		var DB_API = {
		  sources: DB_API_BASE + "/sources",
		  test: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/test`,
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
		  redisCommand: (id) => `${DB_API_BASE}/sources/${encodeURIComponent(id)}/redis/command`
		};

		// src/client/api.ts
		var DbApiError = class extends Error {
		  constructor(message) {
		    super(message);
		    this.name = "DbApiError";
		  }
		};
		async function readJson(response) {
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
		  /** Patch the write posture. */
		  async setSettings(patch) {
		    return (await readJson(await send(`${DB_API_BASE}/settings`, "PATCH", patch))).settings;
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
		};

		// src/client/DatabasePanel.ts
		var React6 = __toESM(require("react"), 1);

		// src/client/RedisDatabaseView.ts
		var React2 = __toESM(require("react"), 1);

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
		  "form.database": "\u9ED8\u8BA4\u6570\u636E\u5E93",
		  "form.db": "\u6570\u636E\u5E93\u7F16\u53F7",
		  "form.tls": "\u4F7F\u7528 TLS",
		  "form.timeout": "\u8FDE\u63A5\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
		  "form.readonly": "\u53EA\u8BFB\uFF08\u62D2\u7EDD agent \u5199\u5165\uFF09",
		  "form.readonly.hint": "\u52FE\u9009\u540E\uFF0C\u5373\u4F7F\u5168\u5C40\u5F00\u542F\u4E86 agent \u5199\u5165\uFF0C\u6B64\u6570\u636E\u6E90\u4E5F\u4E0D\u4F1A\u88AB agent \u4FEE\u6539\u3002",
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
		  "redis.values": "\u503C\u5217\u8868",
		  "redis.stringValue": "\u5B57\u7B26\u4E32\u503C",
		  "redis.readonlyNotice": "\u5F53\u524D\u4E3A\u53EA\u8BFB\u6D4F\u89C8\uFF0C\u52FE\u9009\u300C\u5141\u8BB8\u5199\u5165\u300D\u540E\u53EF\u6267\u884C\u5199\u547D\u4EE4\u3002",
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
		  "form.database": "Default database",
		  "form.db": "Database index",
		  "form.tls": "Use TLS",
		  "form.timeout": "Connect timeout (ms)",
		  "form.readonly": "Read-only (refuse agent writes)",
		  "form.readonly.hint": "When ticked, an agent cannot modify this source even if global agent writes are on.",
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
		  "redis.values": "Values",
		  "redis.stringValue": "String value",
		  "redis.readonlyNotice": "Browsing read-only; tick \u201CAllow writes\u201D to run write commands.",
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
		  if (seconds < 60) return `${seconds}s`;
		  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
		  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
		  return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h`;
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

		// src/client/RedisDatabaseView.ts
		function RedisDatabaseView(props) {
		  const { api, source, initialInfo, onBack, onClose } = props;
		  const [info, setInfo] = React2.useState(initialInfo);
		  const [db, setDb] = React2.useState(source.db ?? 0);
		  const [pattern, setPattern] = React2.useState("*");
		  const [appliedPattern, setAppliedPattern] = React2.useState("*");
		  const [keys, setKeys] = React2.useState([]);
		  const [cursor, setCursor] = React2.useState("0");
		  const [loading, setLoading] = React2.useState(false);
		  const [scanned, setScanned] = React2.useState(0);
		  const [activeKey, setActiveKey] = React2.useState(void 0);
		  const [value, setValue] = React2.useState(void 0);
		  const [valueLoading, setValueLoading] = React2.useState(false);
		  const [tab, setTab] = React2.useState("value");
		  const [error, setError] = React2.useState(void 0);
		  const [notice, setNotice] = React2.useState(void 0);
		  const scan = React2.useCallback(async (options) => {
		    setLoading(true);
		    setError(void 0);
		    try {
		      const page = await api.redisKeys(source.id, {
		        pattern: options.pattern,
		        cursor: options.reset ? "0" : options.cursor,
		        count: 200,
		        db
		      });
		      setKeys((current) => options.reset ? page.keys : [...current, ...page.keys]);
		      setCursor(page.cursor);
		      setScanned((current) => options.reset ? page.keys.length : current + page.keys.length);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    } finally {
		      setLoading(false);
		    }
		  }, [api, source.id, db]);
		  React2.useEffect(() => {
		    setActiveKey(void 0);
		    setValue(void 0);
		    setScanned(0);
		    void scan({ pattern: appliedPattern, cursor: "0", reset: true });
		  }, [db, appliedPattern, scan]);
		  React2.useEffect(() => {
		    void scan({ pattern: "*", cursor: "0", reset: true });
		  }, [scan]);
		  const loadValue = React2.useCallback(async (key) => {
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
		  }, [api, source.id, db]);
		  const refreshInfo = async () => {
		    try {
		      setInfo(await api.redisInfo(source.id));
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    }
		  };
		  const left = React2.createElement(
		    "div",
		    { className: "dbm-side" },
		    React2.createElement(
		      "div",
		      { className: "dbm-side-head" },
		      React2.createElement("input", {
		        className: "dbm-input",
		        style: { flex: 1 },
		        value: pattern,
		        placeholder: t("redis.pattern"),
		        spellcheck: false,
		        onChange: (event) => setPattern(event.target.value),
		        onKeyDown: (event) => {
		          if (event.key === "Enter") {
		            setScanned(0);
		            setAppliedPattern(pattern === "" ? "*" : pattern);
		          }
		        }
		      }),
		      React2.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: String(db),
		          title: t("redis.db"),
		          onChange: (event) => setDb(Number(event.target.value))
		        },
		        Array.from({ length: 16 }, (_, index) => index).map(
		          (index) => React2.createElement("option", { key: index, value: String(index) }, `db${index}`)
		        )
		      )
		    ),
		    React2.createElement(
		      "div",
		      { className: "dbm-side-body" },
		      keys.length === 0 ? React2.createElement("div", { className: "dbm-hint", style: { padding: "10px 12px" } }, loading ? t("common.loading") : t("redis.noKeys")) : keys.map(
		        (item) => React2.createElement(
		          "button",
		          {
		            key: item.key,
		            type: "button",
		            className: "dbm-tree-item",
		            "data-active": String(activeKey === item.key),
		            title: item.key,
		            onClick: () => {
		              setActiveKey(item.key);
		              setTab("value");
		              void loadValue(item.key);
		            }
		          },
		          React2.createElement("span", { className: "dbm-tree-caret" }, typeGlyph(item.type)),
		          React2.createElement("span", { className: "dbm-tree-name dbm-mono" }, item.key),
		          React2.createElement("span", { className: "dbm-tree-meta" }, item.ttl === -1 ? "" : formatTtl(item.ttl))
		        )
		      )
		    ),
		    React2.createElement(
		      "div",
		      { className: "dbm-pager" },
		      React2.createElement("span", null, t("redis.scanned", { n: scanned })),
		      React2.createElement("span", { className: "dbm-spacer" }),
		      cursor === "0" ? React2.createElement("span", { className: "dbm-hint" }, t("redis.noMore")) : React2.createElement(
		        "button",
		        {
		          type: "button",
		          className: "dbm-btn dbm-btn-sm",
		          disabled: loading,
		          onClick: () => {
		            void scan({ pattern: appliedPattern, cursor, reset: false });
		          }
		        },
		        t("redis.loadMore")
		      )
		    )
		  );
		  const body = [
		    React2.createElement(TabStrip, {
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
		    body.push(
		      value === void 0 ? React2.createElement(Empty, { key: "empty", message: valueLoading ? t("common.loading") : t("redis.selectKey") }) : React2.createElement(ValueView, { key: "value", value, source })
		    );
		  }
		  if (tab === "info") {
		    body.push(React2.createElement(InfoView, { key: "info", info, onRefresh: () => {
		      void refreshInfo();
		    } }));
		  }
		  if (tab === "console") {
		    body.push(
		      React2.createElement(ConsoleView, {
		        key: "console",
		        api,
		        source,
		        db,
		        onResult: (message) => {
		          setNotice(message);
		          setError(void 0);
		        },
		        onError: (message) => {
		          setError(message);
		          setNotice(void 0);
		        },
		        onMutated: (key) => {
		          void refreshInfo();
		          if (key !== void 0 && key === activeKey) void loadValue(key);
		          void scan({ pattern: appliedPattern, cursor: "0", reset: true });
		        }
		      })
		    );
		  }
		  return React2.createElement(
		    "div",
		    { className: "dbm-root" },
		    React2.createElement(
		      "div",
		      { className: "dbm-header" },
		      React2.createElement(BackButton, { onBack, label: t("panel.backToList") }),
		      React2.createElement("span", { className: "dbm-title" }, source.name),
		      React2.createElement("span", { className: "dbm-badge dbm-badge-redis" }, "redis"),
		      React2.createElement("span", { className: "dbm-subtitle dbm-mono" }, `${source.host ?? ""}:${source.port ?? ""}/db${db}`),
		      React2.createElement("span", { className: "dbm-spacer" }),
		      React2.createElement(BackButton, { onBack: onClose })
		    ),
		    error === void 0 ? null : React2.createElement(ErrorBanner, { message: error }),
		    notice === void 0 ? null : React2.createElement("div", { className: "dbm-ok", style: { padding: "6px 14px" } }, notice),
		    React2.createElement("div", { className: "dbm-split" }, left, React2.createElement("div", { className: "dbm-main" }, body))
		  );
		}
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
		function ValueView(props) {
		  const { value } = props;
		  const head = React2.createElement(
		    "div",
		    { className: "dbm-pad" },
		    React2.createElement("div", { className: "dbm-row" }, React2.createElement("strong", { className: "dbm-mono" }, value.key)),
		    React2.createElement(
		      "div",
		      { className: "dbm-row" },
		      React2.createElement("span", { className: `dbm-badge dbm-badge-${value.type === "string" ? "ok" : "sqlite"}` }, value.type),
		      React2.createElement("span", { className: "dbm-hint" }, `${t("redis.ttl")}: ${formatTtl(value.ttl)}`),
		      value.truncated === true ? React2.createElement("span", { className: "dbm-hint" }, t("redis.truncated", { n: 1e3 })) : null
		    )
		  );
		  if (value.type === "string") {
		    return React2.createElement(
		      "div",
		      { className: "dbm-tab-body" },
		      head,
		      React2.createElement(
		        "div",
		        { className: "dbm-scroll" },
		        React2.createElement(
		          "div",
		          { className: "dbm-pad" },
		          React2.createElement("div", { className: "dbm-hint" }, `${t("redis.stringValue")} \xB7 ${formatBytes((value.value ?? "").length)}`),
		          React2.createElement("pre", { className: "dbm-mono", style: { whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 } }, value.value ?? "")
		        )
		      )
		    );
		  }
		  const rows = [];
		  if (value.items !== void 0) {
		    value.items.forEach((item, index) => rows.push([String(index), item, void 0]));
		  }
		  if (value.fields !== void 0) {
		    value.fields.forEach((item) => rows.push([item.field, item.value, void 0]));
		  }
		  if (value.members !== void 0) {
		    value.members.forEach((item) => rows.push([item.member, item.score, item.score]));
		  }
		  if (value.entries !== void 0) {
		    value.entries.forEach((entry) => {
		      for (const field of entry.fields) rows.push([`${entry.id} \xB7 ${field.field}`, field.value, entry.id]);
		    });
		  }
		  const isHash = value.fields !== void 0;
		  const isZset = value.members !== void 0;
		  const isStream = value.entries !== void 0;
		  const firstLabel = isHash ? t("redis.field") : isZset ? t("redis.member") : isStream ? t("redis.entry") : "#";
		  return React2.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    head,
		    React2.createElement(
		      "div",
		      { className: "dbm-data" },
		      rows.length === 0 ? React2.createElement(Empty, { message: t("redis.noKeys") }) : React2.createElement(
		        "table",
		        null,
		        React2.createElement(
		          "thead",
		          null,
		          React2.createElement(
		            "tr",
		            null,
		            React2.createElement("th", null, firstLabel),
		            React2.createElement("th", null, t("redis.value")),
		            isZset ? React2.createElement("th", null, t("redis.score")) : null
		          )
		        ),
		        React2.createElement(
		          "tbody",
		          null,
		          rows.map(
		            ([left, right, third], index) => React2.createElement(
		              "tr",
		              { key: index },
		              React2.createElement("td", { title: left }, left),
		              React2.createElement("td", { title: right }, right),
		              isZset ? React2.createElement("td", null, third ?? "") : null
		            )
		          )
		        )
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
		  return React2.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React2.createElement(
		      "div",
		      { className: "dbm-scroll" },
		      React2.createElement(
		        "div",
		        { className: "dbm-pad" },
		        React2.createElement(
		          "div",
		          { className: "dbm-row" },
		          React2.createElement("strong", null, t("redis.info")),
		          React2.createElement("span", { className: "dbm-spacer" }),
		          React2.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", onClick: onRefresh }, t("common.refresh"))
		        ),
		        React2.createElement(
		          "div",
		          { className: "dbm-grid" },
		          facts.map(
		            ([label, val]) => React2.createElement(
		              "div",
		              { key: label },
		              React2.createElement("div", { className: "dbm-hint" }, label),
		              React2.createElement("div", { className: "dbm-mono" }, val)
		            )
		          )
		        ),
		        React2.createElement("strong", null, t("redis.databases")),
		        info.databases.length === 0 ? React2.createElement("div", { className: "dbm-hint" }, t("redis.noKeys")) : React2.createElement(
		          "table",
		          { className: "dbm-table" },
		          React2.createElement("thead", null, React2.createElement("tr", null, React2.createElement("th", null, t("redis.db")), React2.createElement("th", null, t("redis.keys")))),
		          React2.createElement(
		            "tbody",
		            null,
		            info.databases.map(
		              (entry) => React2.createElement(
		                "tr",
		                { key: entry.db },
		                React2.createElement("td", null, `db${entry.db}`),
		                React2.createElement("td", null, String(entry.keys))
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
		  const [command, setCommand] = React2.useState("");
		  const [allowWrite, setAllowWrite] = React2.useState(false);
		  const [result, setResult] = React2.useState(void 0);
		  const [busy, setBusy] = React2.useState(false);
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
		  return React2.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React2.createElement(
		      "div",
		      { className: "dbm-pad" },
		      React2.createElement("input", {
		        className: "dbm-input dbm-mono",
		        value: command,
		        placeholder: t("redis.consolePlaceholder"),
		        spellcheck: false,
		        onChange: (event) => setCommand(event.target.value),
		        onKeyDown: (event) => {
		          if (event.key === "Enter") void run();
		        }
		      }),
		      React2.createElement(
		        "div",
		        { className: "dbm-row" },
		        React2.createElement("button", { type: "button", className: "dbm-btn dbm-btn-primary", disabled: busy, onClick: () => {
		          void run();
		        } }, busy ? t("common.loading") : t("redis.consoleRun")),
		        React2.createElement(
		          "label",
		          { className: "dbm-check" },
		          React2.createElement("input", {
		            type: "checkbox",
		            checked: allowWrite,
		            onChange: (event) => setAllowWrite(event.target.checked)
		          }),
		          t("redis.allowWrite")
		        ),
		        React2.createElement("span", { className: "dbm-hint" }, allowWrite ? t("redis.allowWrite.hint") : t("redis.readonlyNotice"))
		      )
		    ),
		    result === void 0 ? null : React2.createElement(
		      "div",
		      { className: "dbm-tab-body", style: { minHeight: 0 } },
		      React2.createElement("div", { className: "dbm-pad dbm-hint" }, result.message),
		      React2.createElement(
		        "div",
		        { className: "dbm-data" },
		        React2.createElement(
		          "table",
		          null,
		          React2.createElement("thead", null, React2.createElement("tr", null, result.columns.map((column) => React2.createElement("th", { key: column }, column)))),
		          React2.createElement(
		            "tbody",
		            null,
		            result.rows.map(
		              (row, index) => React2.createElement(
		                "tr",
		                { key: index },
		                row.map(
		                  (cell, cellIndex) => React2.createElement(
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
		var React4 = __toESM(require("react"), 1);

		// src/client/SourceFormDialog.ts
		var React3 = __toESM(require("react"), 1);
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
		      database: "",
		      db: initialKind === "redis" ? "0" : "",
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
		    database: source.database ?? "",
		    db: source.db === void 0 ? "" : String(source.db),
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
		      if (state.database.trim() !== "") payload.database = state.database.trim();
		    } else if (state.db.trim() !== "") {
		      payload.db = Number(state.db);
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
		  const { source, initialKind, onSubmit, onClose } = props;
		  const isEdit = source !== void 0;
		  const [state, setState] = React3.useState(() => initialState(source, initialKind ?? "sqlite"));
		  const [busy, setBusy] = React3.useState(false);
		  const [error, setError] = React3.useState(void 0);
		  const patch = (next) => {
		    setState((current) => ({ ...current, ...next }));
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
		  const field = (label, control, key) => React3.createElement("label", { className: "dbm-label", key: key ?? label }, React3.createElement("span", null, label), control);
		  const input = (value, onChange, extra = {}) => React3.createElement("input", {
		    className: "dbm-input",
		    value,
		    onChange: (event) => onChange(event.target.value),
		    ...extra
		  });
		  const children = [];
		  children.push(
		    field(
		      t("form.kind"),
		      React3.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: state.kind,
		          disabled: isEdit,
		          onChange: (event) => {
		            const kind = event.target.value;
		            patch({ kind, port: kind === "sqlite" ? "" : defaultPort(kind), db: kind === "redis" ? state.db === "" ? "0" : state.db : "" });
		          }
		        },
		        DB_KINDS.map((kind) => React3.createElement("option", { key: kind, value: kind }, kind))
		      ),
		      "kind"
		    )
		  );
		  if (isEdit) {
		    children.push(React3.createElement("div", { className: "dbm-hint", key: "kind-hint" }, t("form.kindLocked")));
		  }
		  children.push(
		    React3.createElement(
		      "div",
		      { className: "dbm-grid", key: "identity" },
		      field(t("form.name"), input(state.name, (value) => patch({ name: value }), { placeholder: t("form.name.placeholder") }), "name"),
		      isEdit ? field(t("form.id"), React3.createElement("div", { className: "dbm-mono" }, state.id), "id") : field(t("form.id"), input(state.id, (value) => patch({ id: value }), { placeholder: t("form.id.placeholder") }), "id"),
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
		        field(t("form.user"), input(state.user, (value) => patch({ user: value }), { placeholder: "root" }), "user"),
		        field(t("form.database"), input(state.database, (value) => patch({ database: value })), "database")
		      );
		    } else {
		      connection.push(field(t("form.db"), input(state.db, (value) => patch({ db: value }), { inputMode: "numeric" }), "db"));
		    }
		    children.push(React3.createElement("div", { className: "dbm-grid", key: "connection" }, connection));
		    const passwordLabel = state.kind === "mysql" ? t("form.user") : void 0;
		    void passwordLabel;
		    children.push(
		      field(
		        t("form.password"),
		        React3.createElement("input", {
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
		        React3.createElement(
		          "label",
		          { className: "dbm-check", key: "clear" },
		          React3.createElement("input", {
		            type: "checkbox",
		            checked: state.clearPassword,
		            onChange: (event) => patch({ clearPassword: event.target.checked, password: "" })
		          }),
		          t("form.password.clear")
		        )
		      );
		    }
		    children.push(
		      React3.createElement(
		        "div",
		        { className: "dbm-row", key: "tls" },
		        React3.createElement(
		          "label",
		          { className: "dbm-check" },
		          React3.createElement("input", {
		            type: "checkbox",
		            checked: state.tls,
		            onChange: (event) => patch({ tls: event.target.checked })
		          }),
		          t("form.tls")
		        ),
		        field(t("form.timeout"), input(state.connectTimeoutMs, (value) => patch({ connectTimeoutMs: value }), { inputMode: "numeric", placeholder: "10000" }), "timeout")
		      )
		    );
		  }
		  children.push(
		    React3.createElement(
		      "label",
		      { className: "dbm-check", key: "readonly" },
		      React3.createElement("input", {
		        type: "checkbox",
		        checked: state.readonly,
		        onChange: (event) => patch({ readonly: event.target.checked })
		      }),
		      t("form.readonly")
		    )
		  );
		  children.push(React3.createElement("div", { className: "dbm-hint", key: "readonly-hint" }, t("form.readonly.hint")));
		  children.push(
		    field(
		      t("form.description"),
		      React3.createElement("textarea", {
		        className: "dbm-textarea",
		        rows: 2,
		        value: state.description,
		        onChange: (event) => patch({ description: event.target.value })
		      }),
		      "description"
		    )
		  );
		  if (error !== void 0) children.push(React3.createElement(ErrorBanner, { key: "error", message: error }));
		  return React3.createElement(Modal, {
		    title: isEdit ? t("form.editTitle") : t("form.newTitle"),
		    onClose: () => {
		      if (!busy) onClose();
		    },
		    footer: [
		      React3.createElement("button", { key: "cancel", type: "button", className: "dbm-btn", disabled: busy, onClick: onClose }, t("form.cancel")),
		      React3.createElement("button", { key: "save", type: "button", className: "dbm-btn dbm-btn-primary", disabled: busy, onClick: () => {
		        void submit();
		      } }, busy ? t("common.loading") : t("form.save"))
		    ],
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
		  const [term, setTerm] = React4.useState("");
		  const [groupMode, setGroupMode] = React4.useState("none");
		  const [tests, setTests] = React4.useState({});
		  const [error, setError] = React4.useState(void 0);
		  const [editing, setEditing] = React4.useState(void 0);
		  const [creating, setCreating] = React4.useState(false);
		  const [deleting, setDeleting] = React4.useState(void 0);
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
		        React4.createElement(
		          "tr",
		          { key: `group-${group.label}` },
		          React4.createElement(
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
		        React4.createElement(
		          "tr",
		          { key: source.id },
		          React4.createElement("td", null, React4.createElement("span", { className: `dbm-badge dbm-badge-${source.kind}` }, source.kind)),
		          React4.createElement(
		            "td",
		            null,
		            React4.createElement("div", { style: { fontWeight: 500 } }, source.name),
		            source.description === "" ? null : React4.createElement("div", { className: "dbm-hint" }, source.description),
		            React4.createElement("div", { className: "dbm-hint dbm-mono" }, source.id)
		          ),
		          React4.createElement("td", { className: "dbm-mono" }, hostOf(source)),
		          React4.createElement("td", null, source.kind === "mysql" ? source.user ?? t("common.none") : t("common.none")),
		          React4.createElement(
		            "td",
		            null,
		            authOf(source),
		            source.readonly ? React4.createElement("span", { className: "dbm-badge", style: { marginLeft: 6 } }, t("form.readonly")) : null
		          ),
		          React4.createElement(
		            "td",
		            null,
		            source.tags.length === 0 ? t("common.none") : React4.createElement(
		              "span",
		              { className: "dbm-tags" },
		              source.tags.map((tag) => React4.createElement("span", { key: tag, className: "dbm-badge" }, tag))
		            )
		          ),
		          React4.createElement(
		            "td",
		            null,
		            React4.createElement(
		              "div",
		              { className: "dbm-actions" },
		              React4.createElement(
		                "button",
		                { type: "button", className: "dbm-btn dbm-btn-sm", disabled: test?.status === "running", onClick: () => {
		                  void runTest(source);
		                } },
		                test?.status === "running" ? t("action.testing") : t("action.test")
		              ),
		              React4.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm dbm-btn-primary", onClick: () => onConnect(source) }, t("action.connect")),
		              React4.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", onClick: () => setEditing(source) }, t("action.edit")),
		              React4.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm dbm-btn-danger", onClick: () => setDeleting(source) }, t("action.delete"))
		            ),
		            test === void 0 ? null : TestOutcome(test)
		          )
		        )
		      );
		    }
		  }
		  const children = [
		    React4.createElement(
		      "div",
		      { className: "dbm-toolbar", key: "toolbar" },
		      React4.createElement("input", {
		        className: "dbm-input",
		        value: term,
		        placeholder: t("list.search"),
		        onChange: (event) => setTerm(event.target.value)
		      }),
		      React4.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: groupMode,
		          title: t("list.groupBy"),
		          onChange: (event) => setGroupMode(event.target.value)
		        },
		        React4.createElement("option", { value: "none" }, `${t("list.groupBy")}: ${t("list.group.none")}`),
		        React4.createElement("option", { value: "kind" }, `${t("list.groupBy")}: ${t("list.group.kind")}`),
		        React4.createElement("option", { value: "group" }, `${t("list.groupBy")}: ${t("list.group.group")}`),
		        React4.createElement("option", { value: "tag" }, `${t("list.groupBy")}: ${t("list.group.tag")}`)
		      ),
		      React4.createElement("span", { className: "dbm-hint" }, t("list.count", { n: filtered.length })),
		      React4.createElement("span", { className: "dbm-spacer" }),
		      React4.createElement("button", { type: "button", className: "dbm-btn dbm-btn-primary", onClick: () => setCreating(true) }, `+ ${t("list.new")}`)
		    )
		  ];
		  if (error !== void 0) {
		    children.push(React4.createElement(ErrorBanner, { key: "error", message: error }));
		  }
		  if (unavailable.length > 0) {
		    children.push(
		      React4.createElement(
		        "div",
		        { className: "dbm-error", key: "engines" },
		        unavailable.map((engine) => t("panel.engine.missing", { kind: engine.kind, detail: engine.detail ?? "" })).join("\n")
		      )
		    );
		  }
		  children.push(
		    React4.createElement(
		      "div",
		      { className: "dbm-scroll", key: "scroll" },
		      sources.length === 0 ? React4.createElement(Empty, { message: t("list.empty") }) : filtered.length === 0 ? React4.createElement(Empty, { message: t("list.emptyFiltered") }) : React4.createElement(
		        "table",
		        { className: "dbm-table" },
		        React4.createElement(
		          "thead",
		          null,
		          React4.createElement(
		            "tr",
		            null,
		            ...[t("col.kind"), t("col.name"), t("col.host"), t("col.user"), t("col.auth"), t("col.tags"), t("col.actions")].map(
		              (label) => React4.createElement("th", { key: label }, label)
		            )
		          )
		        ),
		        React4.createElement("tbody", null, rows)
		      )
		    )
		  );
		  children.push(GateStrip({ settings, saveGate }));
		  if (creating || editing !== void 0) {
		    children.push(
		      React4.createElement(SourceFormDialog, {
		        key: "form",
		        ...editing === void 0 ? {} : { source: editing },
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
		      React4.createElement(Modal, {
		        key: "delete",
		        title: t("delete.title"),
		        onClose: () => setDeleting(void 0),
		        footer: [
		          React4.createElement("button", { key: "cancel", type: "button", className: "dbm-btn", onClick: () => setDeleting(void 0) }, t("common.cancel")),
		          React4.createElement("button", { key: "ok", type: "button", className: "dbm-btn dbm-btn-danger", onClick: () => {
		            void remove(deleting);
		          } }, t("delete.confirm"))
		        ],
		        children: React4.createElement("div", null, t("delete.body", { name: deleting.name }))
		      })
		    );
		  }
		  return React4.createElement(
		    "div",
		    { className: "dbm-root" },
		    React4.createElement(
		      "div",
		      { className: "dbm-header" },
		      React4.createElement(BackButton, { onBack: props.onBack }),
		      React4.createElement("span", { className: "dbm-title" }, t("panel.title")),
		      React4.createElement("span", { className: "dbm-subtitle" }, t("panel.subtitle")),
		      React4.createElement("span", { className: "dbm-spacer" }),
		      React4.createElement(
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
		    return React4.createElement("div", { className: "dbm-hint" }, t("common.loading"));
		  }
		  const { result } = state;
		  if (result.ok) {
		    return React4.createElement(
		      "div",
		      { className: "dbm-ok" },
		      t("test.ok", { ms: result.latencyMs ?? 0, version: result.serverVersion ?? "" }).trim()
		    );
		  }
		  return React4.createElement("div", { className: "dbm-error" }, t("test.fail", { error: result.error ?? "" }));
		}
		function GateStrip(props) {
		  const [busy, setBusy] = React4.useState(false);
		  const [savedAt, setSavedAt] = React4.useState(void 0);
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
		  return React4.createElement(
		    "div",
		    { className: "dbm-toolbar", style: { borderTop: "1px solid var(--dsw-alias-border-l3)", borderBottom: "none" } },
		    React4.createElement(
		      "label",
		      { className: "dbm-check" },
		      React4.createElement("input", {
		        type: "checkbox",
		        checked: settings.allowAgentWrite,
		        disabled: busy,
		        onChange: (event) => {
		          void toggle({ allowAgentWrite: event.target.checked });
		        }
		      }),
		      t("gate.allowWrite")
		    ),
		    React4.createElement(
		      "label",
		      { className: "dbm-check", style: settings.allowAgentWrite ? void 0 : { opacity: 0.45 } },
		      React4.createElement("input", {
		        type: "checkbox",
		        checked: settings.requireApproval,
		        disabled: busy || !settings.allowAgentWrite,
		        onChange: (event) => {
		          void toggle({ requireApproval: event.target.checked });
		        }
		      }),
		      t("gate.requireApproval")
		    ),
		    React4.createElement("span", { className: "dbm-spacer" }),
		    React4.createElement("span", { className: "dbm-hint" }, savedAt === void 0 ? t("gate.hint") : t("gate.saved"))
		  );
		}

		// src/client/SqlDatabaseView.ts
		var React5 = __toESM(require("react"), 1);
		function SqlDatabaseView(props) {
		  const { api, source, initialSchemas, onBack, onClose } = props;
		  const [schemas, setSchemas] = React5.useState(initialSchemas);
		  const [activeSchema, setActiveSchema] = React5.useState(initialSchemas[0]);
		  const [tables, setTables] = React5.useState([]);
		  const [tableFilter, setTableFilter] = React5.useState("");
		  const [expanded, setExpanded] = React5.useState({});
		  const [activeTable, setActiveTable] = React5.useState(void 0);
		  const [tab, setTab] = React5.useState("browse");
		  const [error, setError] = React5.useState(void 0);
		  const [notice, setNotice] = React5.useState(void 0);
		  const [rows, setRows] = React5.useState(void 0);
		  const [page, setPage] = React5.useState(1);
		  const [pageSize, setPageSize] = React5.useState(200);
		  const [orderBy, setOrderBy] = React5.useState(void 0);
		  const [orderDir, setOrderDir] = React5.useState("asc");
		  const [columns, setColumns] = React5.useState([]);
		  const [indexes, setIndexes] = React5.useState([]);
		  const loadSchemas = React5.useCallback(async () => {
		    if (source.kind === "sqlite") return;
		    try {
		      const list = await api.schemas(source.id);
		      const names = list.map((item) => item.name);
		      setSchemas(names);
		      setActiveSchema((current) => current !== void 0 && names.includes(current) ? current : names[0]);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    }
		  }, [api, source.id, source.kind]);
		  const loadTables = React5.useCallback(async (schema) => {
		    try {
		      const list = await api.tables(source.id, schema);
		      setTables(list);
		      setActiveTable((current) => current !== void 0 && list.some((item) => item.name === current) ? current : void 0);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    }
		  }, [api, source.id]);
		  React5.useEffect(() => {
		    void loadSchemas();
		  }, [loadSchemas]);
		  React5.useEffect(() => {
		    void loadTables(activeSchema);
		  }, [loadTables, activeSchema]);
		  const loadRows = React5.useCallback(async (options) => {
		    setRows((current) => ({ page: current?.page ?? emptyPage(), loading: true, ...current?.error === void 0 ? {} : { error: current.error } }));
		    try {
		      const result = await api.rows(source.id, {
		        ...activeSchema === void 0 ? {} : { schema: activeSchema },
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
		  }, [api, source.id, activeSchema]);
		  const loadStructure = React5.useCallback(async (table) => {
		    try {
		      const [cols, idx] = await Promise.all([
		        api.columns(source.id, table, activeSchema),
		        api.indexes(source.id, table, activeSchema).catch(() => [])
		      ]);
		      setColumns(cols);
		      setIndexes(idx);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    }
		  }, [api, source.id, activeSchema]);
		  const openTable = (table, nextTab = "browse") => {
		    setActiveTable(table);
		    setTab(nextTab);
		    setOrderBy(void 0);
		    setPage(1);
		    setError(void 0);
		    setNotice(void 0);
		    if (nextTab === "structure") void loadStructure(table);
		    if (nextTab === "browse") void loadRows({ table, page: 1, pageSize, mode: "browse" });
		  };
		  const changeTab = (next) => {
		    setTab(next);
		    setError(void 0);
		    setNotice(void 0);
		    if (activeTable === void 0) return;
		    if (next === "structure") void loadStructure(activeTable);
		    if (next === "browse") void loadRows({ table: activeTable, page: 1, pageSize, mode: "browse" });
		    if (next === "insert") void loadStructure(activeTable);
		  };
		  const filteredTables = tables.filter((table) => tableFilter === "" || table.name.toLowerCase().includes(tableFilter.toLowerCase()));
		  const tree = [];
		  for (const schema of schemas.length === 0 ? [void 0] : schemas) {
		    const label = schema ?? (source.kind === "sqlite" ? "main" : t("common.none"));
		    const isOpen = expanded[label] ?? schemas.length <= 1;
		    if (schemas.length > 1 || source.kind !== "sqlite") {
		      tree.push(
		        React5.createElement(
		          "button",
		          {
		            key: `schema-${label}`,
		            type: "button",
		            className: "dbm-tree-item",
		            onClick: () => {
		              setExpanded((current) => ({ ...current, [label]: !isOpen }));
		              setActiveSchema(schema);
		            }
		          },
		          React5.createElement("span", { className: "dbm-tree-caret" }, isOpen ? "\u25BE" : "\u25B8"),
		          React5.createElement("span", { className: "dbm-tree-name" }, label)
		        )
		      );
		    }
		    if (!isOpen) continue;
		    if (activeSchema !== schema && schemas.length > 1) continue;
		    const list = filteredTables;
		    if (list.length === 0) {
		      tree.push(React5.createElement("div", { key: `empty-${label}`, className: "dbm-tree-item dbm-tree-indent-1 dbm-hint" }, t("db.noTables")));
		      continue;
		    }
		    for (const table of list) {
		      tree.push(
		        React5.createElement(
		          "button",
		          {
		            key: `table-${label}-${table.name}`,
		            type: "button",
		            className: "dbm-tree-item dbm-tree-indent-1",
		            "data-active": String(activeTable === table.name),
		            title: table.comment ?? table.name,
		            onClick: () => openTable(table.name)
		          },
		          React5.createElement("span", { className: "dbm-tree-caret" }, table.type === "view" ? "\u25EB" : "\u25A4"),
		          React5.createElement("span", { className: "dbm-tree-name" }, table.name),
		          table.rows === void 0 ? null : React5.createElement("span", { className: "dbm-tree-meta" }, String(table.rows))
		        )
		      );
		    }
		  }
		  const left = React5.createElement(
		    "div",
		    { className: "dbm-side" },
		    React5.createElement(
		      "div",
		      { className: "dbm-side-head" },
		      React5.createElement("input", {
		        className: "dbm-input",
		        style: { flex: 1 },
		        value: tableFilter,
		        placeholder: t("db.searchTable"),
		        onChange: (event) => setTableFilter(event.target.value)
		      }),
		      React5.createElement("button", {
		        type: "button",
		        className: "dbm-btn dbm-btn-sm",
		        title: t("common.refresh"),
		        onClick: () => {
		          void loadSchemas();
		          void loadTables(activeSchema);
		        }
		      }, "\u27F3")
		    ),
		    React5.createElement("div", { className: "dbm-side-body" }, tree)
		  );
		  const body = [];
		  if (activeTable === void 0) {
		    body.push(React5.createElement(Empty, { key: "empty", message: t("redis.selectKey") }));
		  } else {
		    body.push(
		      React5.createElement(TabStrip, {
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
		      body.push(React5.createElement(BrowseTab, {
		        key: "browse-body",
		        rows,
		        orderBy,
		        orderDir,
		        pageSize,
		        onSort: (column) => {
		          const nextDir = orderBy === column && orderDir === "asc" ? "desc" : "asc";
		          setOrderBy(column);
		          setOrderDir(nextDir);
		          void loadRows({ table: activeTable, page, pageSize, mode: "browse", orderBy: column, orderDir: nextDir });
		        },
		        onPage: (next) => {
		          setPage(next);
		          void loadRows({ table: activeTable, page: next, pageSize, mode: "browse", ...orderBy === void 0 ? {} : { orderBy, orderDir } });
		        },
		        onPageSize: (size) => {
		          setPageSize(size);
		          setPage(1);
		          void loadRows({ table: activeTable, page: 1, pageSize: size, mode: "browse" });
		        },
		        onRefresh: () => {
		          void loadRows({ table: activeTable, page, pageSize, mode: "browse", ...orderBy === void 0 ? {} : { orderBy, orderDir } });
		        }
		      }));
		    }
		    if (tab === "structure") {
		      body.push(React5.createElement(StructureTab, { key: "structure-body", columns, indexes }));
		    }
		    if (tab === "sql") {
		      body.push(
		        React5.createElement(SqlTabView, {
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
		        React5.createElement(SearchTab, {
		          key: "search-body",
		          onSearch: (payload) => {
		            void loadRows({
		              table: activeTable,
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
		        React5.createElement(InsertTab, {
		          key: "insert-body",
		          api,
		          source,
		          schema: activeSchema,
		          table: activeTable,
		          columns,
		          onDone: (message) => {
		            setNotice(message);
		            setError(void 0);
		            void loadRows({ table: activeTable, page: 1, pageSize, mode: "browse" });
		          },
		          onError: (message) => {
		            setError(message);
		            setNotice(void 0);
		          }
		        })
		      );
		    }
		  }
		  return React5.createElement(
		    "div",
		    { className: "dbm-root" },
		    React5.createElement(
		      "div",
		      { className: "dbm-header" },
		      React5.createElement(BackButton, { onBack, label: t("panel.backToList") }),
		      React5.createElement("span", { className: "dbm-title" }, source.name),
		      React5.createElement("span", { className: `dbm-badge dbm-badge-${source.kind}` }, source.kind),
		      React5.createElement("span", { className: "dbm-subtitle dbm-mono" }, source.kind === "sqlite" ? source.file ?? "" : `${source.host ?? ""}:${source.port ?? ""}`),
		      React5.createElement("span", { className: "dbm-spacer" }),
		      React5.createElement(BackButton, { onBack: onClose })
		    ),
		    error === void 0 ? null : React5.createElement(ErrorBanner, { message: error }),
		    notice === void 0 ? null : React5.createElement("div", { className: "dbm-ok", style: { padding: "6px 14px" } }, notice),
		    React5.createElement("div", { className: "dbm-split" }, left, React5.createElement("div", { className: "dbm-main" }, body))
		  );
		}
		function emptyPage() {
		  return { columns: [], rows: [], total: 0, page: 1, pageSize: 200, primaryKey: [] };
		}
		function BrowseTab(props) {
		  const { rows, orderBy, orderDir, pageSize, onSort, onPage, onPageSize, onRefresh } = props;
		  if (rows === void 0) return React5.createElement(Empty, { message: t("common.loading") });
		  if (rows.error !== void 0) return React5.createElement(ErrorBanner, { message: rows.error });
		  const page = rows.page;
		  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
		  const columns = page.columns.map((column) => column.name);
		  return React5.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React5.createElement(
		      "div",
		      { className: "dbm-row", style: { padding: "8px 12px" } },
		      React5.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", onClick: onRefresh }, t("browse.refresh")),
		      React5.createElement("label", { className: "dbm-hint" }, `${t("browse.pageSize")}: ${""}`),
		      React5.createElement(
		        "select",
		        {
		          className: "dbm-select",
		          value: String(pageSize),
		          onChange: (event) => onPageSize(Number(event.target.value))
		        },
		        [50, 100, 200, 500, 1e3].map((size) => React5.createElement("option", { key: size, value: String(size) }, String(size)))
		      ),
		      React5.createElement("span", { className: "dbm-hint" }, t("browse.total", { n: page.total })),
		      React5.createElement("span", { className: "dbm-spacer" }),
		      rows.loading ? React5.createElement("span", { className: "dbm-hint" }, t("common.loading")) : null
		    ),
		    page.columns.length === 0 ? React5.createElement(Empty, { message: t("browse.empty") }) : React5.createElement(
		      "div",
		      { className: "dbm-data" },
		      React5.createElement(
		        "table",
		        null,
		        React5.createElement(
		          "thead",
		          null,
		          React5.createElement(
		            "tr",
		            null,
		            page.columns.map(
		              (column) => React5.createElement(
		                "th",
		                { key: column.name },
		                React5.createElement(
		                  "button",
		                  { type: "button", onClick: () => onSort(column.name) },
		                  `${column.name}${orderBy === column.name ? orderDir === "asc" ? " \u25B2" : " \u25BC" : ""}`
		                )
		              )
		            )
		          )
		        ),
		        React5.createElement(
		          "tbody",
		          null,
		          page.rows.map(
		            (row, index) => React5.createElement(
		              "tr",
		              { key: index },
		              columns.map(
		                (column) => React5.createElement(
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
		    React5.createElement(
		      "div",
		      { className: "dbm-pager" },
		      React5.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", disabled: page.page <= 1, onClick: () => onPage(page.page - 1) }, t("browse.prev")),
		      React5.createElement("span", null, t("browse.page", { page: page.page, pages })),
		      React5.createElement("button", { type: "button", className: "dbm-btn dbm-btn-sm", disabled: page.page >= pages, onClick: () => onPage(page.page + 1) }, t("browse.next")),
		      page.primaryKey.length === 0 ? React5.createElement("span", { className: "dbm-hint" }, t("browse.noPk")) : null
		    )
		  );
		}
		function StructureTab(props) {
		  const { columns, indexes } = props;
		  return React5.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React5.createElement(
		      "div",
		      { className: "dbm-scroll" },
		      React5.createElement("div", { className: "dbm-pad" }, React5.createElement("strong", null, t("structure.columns"))),
		      React5.createElement(
		        "table",
		        { className: "dbm-table" },
		        React5.createElement(
		          "thead",
		          null,
		          React5.createElement(
		            "tr",
		            null,
		            ...[t("structure.col.name"), t("structure.col.type"), t("structure.col.nullable"), t("structure.col.key"), t("structure.col.default"), t("structure.col.extra"), t("structure.col.comment")].map(
		              (label) => React5.createElement("th", { key: label }, label)
		            )
		          )
		        ),
		        React5.createElement(
		          "tbody",
		          null,
		          columns.map(
		            (column) => React5.createElement(
		              "tr",
		              { key: column.name },
		              React5.createElement("td", { className: "dbm-mono" }, column.name),
		              React5.createElement("td", { className: "dbm-mono" }, column.type),
		              React5.createElement("td", null, column.nullable ? t("common.yes") : t("common.no")),
		              React5.createElement("td", null, column.key === "" ? t("common.none") : column.key),
		              React5.createElement("td", { className: "dbm-mono" }, column.defaultValue ?? t("common.none")),
		              React5.createElement("td", { className: "dbm-mono" }, column.extra ?? t("common.none")),
		              React5.createElement("td", null, column.comment ?? "")
		            )
		          )
		        )
		      ),
		      React5.createElement("div", { className: "dbm-pad" }, React5.createElement("strong", null, t("structure.indexes"))),
		      indexes.length === 0 ? React5.createElement("div", { className: "dbm-pad dbm-hint" }, t("structure.noIndexes")) : React5.createElement(
		        "table",
		        { className: "dbm-table" },
		        React5.createElement(
		          "thead",
		          null,
		          React5.createElement(
		            "tr",
		            null,
		            ...[t("structure.index.name"), t("structure.index.unique"), t("structure.index.columns"), t("structure.index.type")].map(
		              (label) => React5.createElement("th", { key: label }, label)
		            )
		          )
		        ),
		        React5.createElement(
		          "tbody",
		          null,
		          indexes.map(
		            (index) => React5.createElement(
		              "tr",
		              { key: index.name },
		              React5.createElement("td", { className: "dbm-mono" }, index.name),
		              React5.createElement("td", null, index.unique ? t("common.yes") : t("common.no")),
		              React5.createElement("td", { className: "dbm-mono" }, index.columns.join(", ")),
		              React5.createElement("td", null, index.type ?? t("common.none"))
		            )
		          )
		        )
		      )
		    )
		  );
		}
		function SqlTabView(props) {
		  const { api, source, schema, onResult, onError } = props;
		  const [sql, setSql] = React5.useState("");
		  const [allowWrite, setAllowWrite] = React5.useState(false);
		  const [result, setResult] = React5.useState(void 0);
		  const [busy, setBusy] = React5.useState(false);
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
		  return React5.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React5.createElement(
		      "div",
		      { className: "dbm-pad" },
		      React5.createElement("textarea", {
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
		      React5.createElement(
		        "div",
		        { className: "dbm-row" },
		        React5.createElement("button", { type: "button", className: "dbm-btn dbm-btn-primary", disabled: busy, onClick: () => {
		          void run();
		        } }, busy ? t("sql.running") : t("sql.run")),
		        React5.createElement(
		          "label",
		          { className: "dbm-check" },
		          React5.createElement("input", {
		            type: "checkbox",
		            checked: allowWrite,
		            onChange: (event) => setAllowWrite(event.target.checked)
		          }),
		          t("sql.allowWrite")
		        ),
		        React5.createElement("span", { className: "dbm-hint" }, t("sql.allowWrite.hint"))
		      )
		    ),
		    result === void 0 ? null : React5.createElement(
		      "div",
		      { className: "dbm-tab-body", style: { minHeight: 0 } },
		      React5.createElement("div", { className: "dbm-pad dbm-hint" }, result.message),
		      result.columns.length === 0 ? null : React5.createElement(
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
		function SearchTab(props) {
		  const { onSearch, rows } = props;
		  const [term, setTerm] = React5.useState("");
		  const [condition, setCondition] = React5.useState("");
		  const submit = () => {
		    if (condition.trim() !== "") onSearch({ condition: condition.trim() });
		    else if (term.trim() !== "") onSearch({ term: term.trim() });
		  };
		  return React5.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React5.createElement(
		      "div",
		      { className: "dbm-pad" },
		      React5.createElement(
		        "div",
		        { className: "dbm-row" },
		        React5.createElement("input", {
		          className: "dbm-input",
		          style: { flex: 1, minWidth: 200 },
		          value: term,
		          placeholder: t("search.placeholder"),
		          onChange: (event) => setTerm(event.target.value),
		          onKeyDown: (event) => {
		            if (event.key === "Enter") submit();
		          }
		        }),
		        React5.createElement("button", { type: "button", className: "dbm-btn dbm-btn-primary", onClick: submit }, t("search.run"))
		      ),
		      React5.createElement(
		        "div",
		        { className: "dbm-row" },
		        React5.createElement("span", { className: "dbm-hint" }, t("search.condition")),
		        React5.createElement("input", {
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
		    rows === void 0 ? null : rows.error !== void 0 ? React5.createElement(ErrorBanner, { message: rows.error }) : React5.createElement(
		      "div",
		      { className: "dbm-tab-body", style: { minHeight: 0 } },
		      React5.createElement("div", { className: "dbm-pad dbm-hint" }, t("browse.total", { n: rows.page.total })),
		      React5.createElement(
		        "div",
		        { className: "dbm-data" },
		        React5.createElement(
		          "table",
		          null,
		          React5.createElement("thead", null, React5.createElement("tr", null, rows.page.columns.map((column) => React5.createElement("th", { key: column.name }, column.name)))),
		          React5.createElement(
		            "tbody",
		            null,
		            rows.page.rows.map(
		              (row, index) => React5.createElement(
		                "tr",
		                { key: index },
		                rows.page.columns.map(
		                  (column) => React5.createElement(
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
		  const [values, setValues] = React5.useState({});
		  const [useNull, setUseNull] = React5.useState({});
		  const [busy, setBusy] = React5.useState(false);
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
		  return React5.createElement(
		    "div",
		    { className: "dbm-tab-body" },
		    React5.createElement(
		      "div",
		      { className: "dbm-scroll" },
		      React5.createElement(
		        "div",
		        { className: "dbm-pad" },
		        React5.createElement("strong", null, `${t("insert.title")} \u2014 ${table}`),
		        React5.createElement("div", { className: "dbm-hint" }, t("insert.hint")),
		        React5.createElement(
		          "div",
		          { className: "dbm-grid", style: { gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" } },
		          columns.map(
		            (column) => React5.createElement(
		              "label",
		              { className: "dbm-label", key: column.name },
		              React5.createElement(
		                "span",
		                null,
		                column.name,
		                React5.createElement("span", { className: "dbm-hint" }, ` \xB7 ${column.type}${column.nullable ? "" : " NOT NULL"}${column.key === "PRI" ? " PK" : ""}`)
		              ),
		              React5.createElement("input", {
		                className: "dbm-input dbm-mono",
		                value: values[column.name] ?? "",
		                disabled: useNull[column.name] === true,
		                placeholder: column.defaultValue ?? (column.nullable ? t("common.null") : ""),
		                onChange: (event) => setValues((current) => ({ ...current, [column.name]: event.target.value }))
		              }),
		              column.nullable ? React5.createElement(
		                "span",
		                { className: "dbm-check" },
		                React5.createElement("input", {
		                  type: "checkbox",
		                  checked: useNull[column.name] === true,
		                  onChange: (event) => setUseNull((current) => ({ ...current, [column.name]: event.target.checked }))
		                }),
		                t("common.null")
		              ) : null
		            )
		          )
		        ),
		        React5.createElement(
		          "div",
		          { className: "dbm-row" },
		          React5.createElement("button", { type: "button", className: "dbm-btn dbm-btn-primary", disabled: busy, onClick: () => {
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
		  const [snapshot, setSnapshot] = React6.useState(() => controller.getSnapshot());
		  const [sources, setSources] = React6.useState(void 0);
		  const [settings, setSettings] = React6.useState({ allowAgentWrite: false, requireApproval: true });
		  const [engines, setEngines] = React6.useState([]);
		  const [error, setError] = React6.useState(void 0);
		  void localeTick;
		  React6.useEffect(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller]);
		  const reload = React6.useCallback(async () => {
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
		  React6.useEffect(() => {
		    void reload();
		  }, [reload]);
		  React6.useEffect(() => {
		    void api.engines().then(setEngines).catch(() => setEngines([]));
		  }, [api]);
		  const saveGate = React6.useCallback(async (patch) => {
		    try {
		      setSettings(await api.setSettings(patch));
		      setError(void 0);
		    } catch (failure) {
		      setError(failure instanceof Error ? failure.message : String(failure));
		    }
		  }, [api]);
		  const connect = React6.useCallback(async (source) => {
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
		    body = React6.createElement(SqlDatabaseView, {
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
		    body = React6.createElement(RedisDatabaseView, {
		      api,
		      source: screen.source,
		      initialInfo: screen.info,
		      onBack: () => controller.showList(),
		      onClose
		    });
		  } else if (sources === void 0) {
		    body = React6.createElement(Empty, { message: t("common.loading") });
		  } else {
		    body = React6.createElement(SourceListView, {
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
		  return React6.createElement(
		    "div",
		    { className: "dbm-shell" },
		    error === void 0 ? null : React6.createElement(ErrorBanner, { message: error }),
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
		.dbm-ok { color: #1a8a4a; font-size: 12px; }

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
		.dbm-modal-foot {
		  padding: 12px 16px;
		  border-top: 1px solid var(--dsw-alias-border-l3);
		  display: flex;
		  gap: 8px;
		  justify-content: flex-end;
		  flex: none;
		}
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
		          (props) => React7.createElement("span", {
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
		          () => React7.createElement(PanelHost, { controller, api, localeListeners, onClose: close })
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
		  const [localeTick, setLocaleTick] = React7.useState(0);
		  React7.useEffect(() => {
		    const listener = () => setLocaleTick((value) => value + 1);
		    localeListeners.add(listener);
		    return () => {
		      localeListeners.delete(listener);
		    };
		  }, [localeListeners]);
		  return React7.createElement(DatabasePanel, { controller, api, localeTick, onClose });
		}

		return module.exports;
	}
});
