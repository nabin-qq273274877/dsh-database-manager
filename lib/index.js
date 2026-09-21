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
function isTransactionControl(statement) {
  const text2 = statement.trim().replace(/;+\s*$/, "").trim();
  return /^(?:BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE))?(?:\s+TRANSACTION)?|COMMIT(?:\s+(?:TRANSACTION|WORK))?|END(?:\s+TRANSACTION)?|ROLLBACK(?:\s+(?:TRANSACTION|WORK))?|START\s+TRANSACTION)$/i.test(text2);
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
function groupSameColumns(rows, columnsOf = (row) => row.map((item) => item.column)) {
  const groups = [];
  let current = [];
  let currentKey;
  for (const row of rows) {
    const key = JSON.stringify(columnsOf(row));
    if (currentKey !== key) {
      if (current.length > 0) groups.push(current);
      current = [];
      currentKey = key;
    }
    current.push(row);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
function likeEscapeClause(dialect) {
  return dialect === "mysql" ? "ESCAPE '\\\\'" : "ESCAPE '\\'";
}
function likePattern(value, position) {
  const escaped = value.replace(/[\\%_]/g, (match) => `\\${match}`);
  if (position === "startsWith") return `${escaped}%`;
  if (position === "endsWith") return `%${escaped}`;
  return `%${escaped}%`;
}
function buildSearchWhere(filters, join3, quote, known, dialect = "sqlite") {
  const clauses = [];
  const params = [];
  for (const filter of filters) {
    const column = filter.column;
    if (!known.has(column.toLowerCase())) throw new Error(`no such column: ${JSON.stringify(column)}`);
    if (!FILTER_OPERATORS.has(filter.operator)) throw new Error(`unsupported operator: ${JSON.stringify(filter.operator)}`);
    const quoted = quote(column);
    const value = filter.value ?? "";
    switch (filter.operator) {
      case "isNull":
        clauses.push(`${quoted} IS NULL`);
        continue;
      case "isNotNull":
        clauses.push(`${quoted} IS NOT NULL`);
        continue;
      case "between": {
        if (value === "" || (filter.value2 ?? "") === "") throw new Error("between needs two values");
        clauses.push(`${quoted} BETWEEN ? AND ?`);
        params.push(value, filter.value2);
        continue;
      }
      case "in": {
        const members = value.split(",").map((member) => member.trim()).filter((member) => member !== "");
        if (members.length === 0) throw new Error("in needs at least one value");
        clauses.push(`${quoted} IN (${members.map(() => "?").join(", ")})`);
        params.push(...members);
        continue;
      }
      case "contains":
      case "notContains":
      case "startsWith":
      case "endsWith": {
        const position = filter.operator === "contains" || filter.operator === "notContains" ? "contains" : filter.operator === "startsWith" ? "startsWith" : "endsWith";
        const negated = filter.operator === "notContains";
        clauses.push(`${quoted} ${negated ? "NOT " : ""}LIKE ? ${likeEscapeClause(dialect)}`);
        params.push(likePattern(value, position));
        continue;
      }
      default: {
        const operator = filter.operator === "eq" ? "=" : filter.operator === "neq" ? "<>" : filter.operator === "gt" ? ">" : filter.operator === "gte" ? ">=" : filter.operator === "lt" ? "<" : "<=";
        if (value === "") throw new Error(`${filter.operator} needs a value`);
        clauses.push(`${quoted} ${operator} ?`);
        params.push(value);
      }
    }
  }
  if (clauses.length === 0) return { where: "", params: [] };
  const joiner = join3 === "or" ? " OR " : " AND ";
  return { where: ` WHERE (${clauses.join(joiner)})`, params };
}
var IDENTIFIER_RE, READ_PREFIXES, WORD_CHAR_RE, TRAILING_CLAUSES, FILTER_OPERATORS;
var init_sql_util = __esm({
  "src/sql-util.ts"() {
    "use strict";
    IDENTIFIER_RE = /^[A-Za-z0-9_$][A-Za-z0-9_$ -]*$/;
    READ_PREFIXES = ["select", "with", "show", "describe", "desc", "explain", "pragma", "values", "table"];
    WORD_CHAR_RE = /[A-Za-z0-9_$]/;
    TRAILING_CLAUSES = ["into", "for", "lock", "procedure"];
    FILTER_OPERATORS = /* @__PURE__ */ new Set([
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
      "isNull",
      "isNotNull",
      "between",
      "in"
    ]);
  }
});

// src/sql-schema.ts
function identifier(name2, what, dialect) {
  return requireIdentifier(name2, what, dialect === "mysql" ? quoteMysql : quoteSqlite);
}
function quoteAt(text2, at) {
  const ch = text2[at];
  if (ch === "'" || ch === '"' || ch === "`") return ch;
  return void 0;
}
function skipQuoted(text2, from, quote) {
  const n = text2.length;
  const backslashEscapes = quote === "'";
  let i = from + 1;
  while (i < n) {
    if (backslashEscapes && text2[i] === "\\") {
      i += 2;
      continue;
    }
    if (text2[i] === quote) {
      if (text2[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return n;
}
function matchingBracket(text2, open) {
  let depth = 0;
  let i = open;
  const n = text2.length;
  while (i < n) {
    const ch = text2[i];
    if (ch === "-" && text2[i + 1] === "-") {
      const end = text2.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (ch === "/" && text2[i + 1] === "*") {
      const end = text2.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    const quote = quoteAt(text2, i);
    if (quote !== void 0) {
      i = skipQuoted(text2, i, quote);
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}
function splitTopLevel(text2, separators = ",") {
  const items = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const n = text2.length;
  while (i < n) {
    const ch = text2[i];
    if (ch === "-" && text2[i + 1] === "-") {
      const end = text2.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (ch === "/" && text2[i + 1] === "*") {
      const end = text2.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    const quote = quoteAt(text2, i);
    if (quote !== void 0) {
      i = skipQuoted(text2, i, quote);
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
    if (depth === 0 && separators.includes(ch)) {
      items.push(text2.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  items.push(text2.slice(start));
  return items.map((item) => item.trim()).filter((item) => item !== "");
}
function splitWords(text2) {
  const items = [];
  let depth = 0;
  let start = -1;
  let i = 0;
  const n = text2.length;
  while (i <= n) {
    const ch = i === n ? " " : text2[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = depth > 0 ? depth - 1 : 0;
    const isSpace = depth === 0 && /\s/.test(ch);
    if (isSpace) {
      if (start !== -1) {
        items.push(text2.slice(start, i));
        start = -1;
      }
    } else if (start === -1) start = i;
    i++;
  }
  return items;
}
function quoteLiteral(value) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}
function unquoteLiteral(text2) {
  const body = text2.trim().slice(1, -1);
  return body.replace(/''/g, "'");
}
function splitType(type, base) {
  const text2 = type.trim().replace(/\s+/g, " ");
  if (text2 === "") return { base: "", modifiers: [] };
  const open = text2.indexOf("(");
  const withoutArgs = open === -1 ? text2 : text2.slice(0, open).trim();
  let args;
  let after = "";
  if (open !== -1) {
    const close = matchingBracket(text2, open);
    if (close === -1) throw new Error(`unbalanced brackets in column type: ${JSON.stringify(type)}`);
    args = text2.slice(open + 1, close).trim();
    after = text2.slice(close + 1).trim();
  }
  const words = `${withoutArgs}${after === "" ? "" : " " + after}`.split(" ").filter((word) => word !== "");
  const modifiers = [];
  while (words.length > 1 && MYSQL_MODIFIERS.includes(words[words.length - 1].toLowerCase())) {
    modifiers.unshift(words.pop());
  }
  const name2 = words.join(" ");
  if (name2 === "" || !base.includes(name2.toLowerCase())) {
    throw new Error(`unsupported column type: ${JSON.stringify(type)}`);
  }
  const canonical = base.find((entry) => entry === name2.toLowerCase());
  if (canonical === void 0) throw new Error(`unsupported column type: ${JSON.stringify(type)}`);
  if (new Set(modifiers.map((modifier) => modifier.toLowerCase())).size !== modifiers.length) {
    throw new Error(`repeated type modifier in ${JSON.stringify(type)}`);
  }
  return { base: name2, ...args === void 0 ? {} : { args }, modifiers };
}
function normalizeMysqlType(type) {
  const raw = type.trim();
  if (raw === "") throw new Error("column type is required");
  if (raw.length > 200) throw new Error(`column type is too long: ${JSON.stringify(type)}`);
  const { base, args, modifiers } = splitType(raw, MYSQL_TYPE_BASE);
  const suffix = modifiers.length === 0 ? "" : " " + modifiers.join(" ");
  if (args === void 0) {
    if (base === "enum" || base === "set") throw new Error(`${base} requires a member list`);
    return base + suffix;
  }
  if (base === "enum" || base === "set") {
    const members = splitTopLevel(args);
    if (members.length === 0) throw new Error(`${base} requires at least one member`);
    if (members.length > 1024) throw new Error(`${base} accepts at most 1024 members`);
    const rendered = members.map((member) => {
      const value = member.startsWith("'") ? unquoteLiteral(member) : member;
      if (/[\u0000-\u001f]/.test(value)) throw new Error(`a ${base} member cannot contain a control character`);
      return quoteLiteral(value);
    });
    return `${base}(${rendered.join(",")})`;
  }
  const compact = args.replace(/\s+/g, "");
  if (base === "decimal" || base === "numeric" || base === "float" || base === "double" || base === "real") {
    if (!NUMERIC_ARG_RE.test(compact)) throw new Error(`invalid size for ${base}: ${JSON.stringify(args)}`);
    return `${base}(${compact})${suffix}`;
  }
  if (base === "bit") {
    if (!LENGTH_ARG_RE.test(args)) throw new Error(`invalid length for bit: ${JSON.stringify(args)}`);
    return `bit(${args})`;
  }
  if (!LENGTH_ARG_RE.test(args)) throw new Error(`invalid length for ${base}: ${JSON.stringify(args)}`);
  return `${base}(${args})${suffix}`;
}
function normalizeSqliteType(type) {
  const raw = type.trim();
  if (raw === "") return "";
  if (raw.length > 200) throw new Error(`column type is too long: ${JSON.stringify(type)}`);
  const { base, args, modifiers } = splitType(raw, SQLITE_TYPE_BASE);
  if (modifiers.length > 0) throw new Error(`SQLite does not accept the modifier in ${JSON.stringify(type)}`);
  if (args === void 0) return base;
  const compact = args.replace(/\s+/g, "");
  if (!LENGTH_ARG_RE.test(args) && !NUMERIC_ARG_RE.test(compact)) {
    throw new Error(`invalid length for ${base}: ${JSON.stringify(args)}`);
  }
  return `${base}(${compact})`;
}
function normalizeType(type, dialect) {
  return dialect === "mysql" ? normalizeMysqlType(type) : normalizeSqliteType(type);
}
function normalizeDefault(value, dialect) {
  if (value === void 0) return void 0;
  const text2 = value.trim();
  if (text2 === "") return void 0;
  if (text2.length > 200) throw new Error(`default value is too long: ${JSON.stringify(value)}`);
  if (/[\u0000-\u001f;]/.test(text2)) throw new Error("a default value cannot contain a control character or a semicolon");
  if (text2.length >= 2 && text2.startsWith("'") && text2.endsWith("'")) {
    const body = text2.slice(1, -1);
    const value2 = dialect === "mysql" ? body.replace(/''/g, "'").replace(/\\(.)/g, "$1") : body.replace(/''/g, "'");
    return dialect === "mysql" ? quoteLiteral(value2) : `'${value2.replace(/'/g, "''")}'`;
  }
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text2)) return text2;
  if (text2.startsWith("(")) {
    throw new Error("a parenthesised default expression is not accepted; use a literal or a supported keyword");
  }
  const lower = text2.toLowerCase().replace(/\s+/g, " ");
  if (DEFAULT_KEYWORDS.has(lower)) return lower;
  throw new Error(`unsupported default value: ${JSON.stringify(value)}`);
}
function isTableConstraint(item, dialect) {
  const text2 = item.trim();
  if (TABLE_CONSTRAINT_RE.test(text2)) return true;
  return dialect === "mysql" && MYSQL_INDEX_CONSTRAINT_RE.test(text2);
}
function classifyConstraint(sql) {
  const match = /^\s*(?:CONSTRAINT\s+\S+\s+)?([A-Za-z]+)/i.exec(sql);
  const keyword = (match?.[1] ?? "").toLowerCase();
  if (keyword === "primary") return "primary";
  if (keyword === "unique") return "unique";
  if (keyword === "foreign") return "foreign";
  if (keyword === "check") return "check";
  return "other";
}
function unquoteIdentifier(text2) {
  const trimmed = text2.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (first === '"' && last === '"') return trimmed.slice(1, -1).replace(/""/g, '"');
    if (first === "`" && last === "`") return trimmed.slice(1, -1).replace(/``/g, "`");
    if (first === "[" && last === "]") return trimmed.slice(1, -1);
  }
  return trimmed;
}
function readLeadingIdentifier(item) {
  const text2 = item.trim();
  if (text2 === "") return void 0;
  const first = text2[0];
  const quote = quoteAt(text2, 0);
  if (quote !== void 0) {
    const end = skipQuoted(text2, 0, quote);
    if (end >= text2.length) return void 0;
    return { name: unquoteIdentifier(text2.slice(0, end)), rest: text2.slice(end).trim() };
  }
  const match = /^([A-Za-z_\u0080-\uffff][A-Za-z0-9_$\u0080-\uffff]*)\s*([\s\S]*)$/.exec(text2);
  if (match === null) return void 0;
  return { name: match[1], rest: match[2].trim() };
}
function splitTypeAndFlags(rest, dialect) {
  const words = splitWords(rest);
  if (words.length === 0) return { type: "", flags: [] };
  let best = -1;
  for (let length = 1; length <= words.length; length++) {
    try {
      normalizeType(words.slice(0, length).join(" "), dialect);
      best = length;
    } catch {
    }
  }
  if (best === -1) {
    if (dialect === "sqlite") return { type: "", flags: groupFlags(words) };
    return { type: rest, flags: [] };
  }
  return { type: words.slice(0, best).join(" "), flags: groupFlags(words.slice(best)) };
}
function flagKeyword(phrase) {
  return (/^([A-Za-z_]+)/.exec(phrase)?.[1] ?? "").toLowerCase();
}
function flagComplete(words) {
  if (words.length === 0) return false;
  const keyword = flagKeyword(words[0]);
  switch (keyword) {
    case "not":
      return words.length >= 2;
    case "primary":
      return words.length >= 2 && flagKeyword(words[1]) === "key";
    case "default":
      return words.length >= 2;
    case "check":
      return words.length >= 2 && words[1].startsWith("(");
    case "collate":
      return words.length >= 2;
    case "references":
      return words.length >= 2;
    case "comment":
      return words.length >= 2;
    case "generated":
    case "as":
      return words.some((word) => word.startsWith("("));
    case "constraint":
      return words.length >= 2;
    default:
      return true;
  }
}
function startsFlag(token) {
  return FLAG_STARTERS.has(flagKeyword(token));
}
function groupFlags(words) {
  const flags = [];
  let pending = [];
  for (const word of words) {
    if (pending.length > 0 && startsFlag(word) && flagComplete(pending)) {
      flags.push(pending.join(" "));
      pending = [];
    }
    pending.push(word);
  }
  if (pending.length > 0) flags.push(pending.join(" "));
  return flags;
}
function parseColumnItem(item, dialect) {
  if (isTableConstraint(item, dialect)) return void 0;
  const leading = readLeadingIdentifier(item);
  if (leading === void 0) return void 0;
  const { type, flags } = splitTypeAndFlags(leading.rest, dialect);
  const lower = flags.map((flag) => flag.toLowerCase().replace(/\s+/g, " "));
  const nullableFlag = lower.some((flag) => flag === "not null");
  const primaryKey = lower.some((flag) => flag.startsWith("primary key"));
  const autoIncrement = lower.some((flag) => flag === "auto_increment" || flag === "autoincrement");
  const sqliteAutoincrement = dialect === "sqlite" && lower.some((flag) => flag.includes("autoincrement"));
  const unique = lower.some((flag) => flag === "unique");
  const check = flags.find((flag) => /^check\s*\(/i.test(flag));
  const comment = /^comment\s+'([\s\S]*)'$/i.exec(flags.find((flag) => /^comment\s+/i.test(flag)) ?? "")?.[1];
  const generated = lower.some((flag) => flag.startsWith("generated") || /^as\s*\(/.test(flag));
  const handled = (flag) => {
    if (flag === "" || flag === "not null" || flag === "null") return true;
    if (flag.startsWith("default ")) return true;
    if (flag === "auto_increment" || flag === "autoincrement") return true;
    if (flag.startsWith("primary key")) return true;
    if (flag === "unique") return true;
    if (/^check\s*\(/i.test(flag)) return true;
    if (/^comment\s+/i.test(flag)) return true;
    return false;
  };
  const extras = flags.filter((flag) => !handled(flag.toLowerCase().replace(/\s+/g, " ")));
  const defaultValue = flags.map((flag) => /^default\s+([\s\S]+)$/i.exec(flag)).find((match) => match !== null)?.[1];
  const rowidAlias = dialect === "sqlite" && primaryKey && type.trim().toLowerCase().replace(/\s+/g, " ") === "integer";
  const isAuto = autoIncrement || rowidAlias;
  return {
    name: leading.name,
    type,
    // A primary-key column is NOT NULL whether or not the statement said so;
    // reporting it as nullable would make the 结构 tab's checkbox lie.
    nullable: !nullableFlag && !primaryKey,
    ...defaultValue === void 0 ? {} : { defaultValue },
    ...isAuto ? { autoIncrement: true } : {},
    ...sqliteAutoincrement ? { sqliteAutoincrement: true } : {},
    ...primaryKey ? { primaryKeyPosition: 1 } : {},
    ...unique ? { unique: true } : {},
    ...check === void 0 ? {} : { check },
    ...comment === void 0 ? {} : { comment },
    extras,
    ...generated ? { generated: true } : {}
  };
}
function parseCreateTable(sql, dialect) {
  const text2 = sql.trim().replace(/;+\s*$/, "");
  const open = text2.indexOf("(");
  if (open === -1) throw new Error(`cannot read the table definition: ${JSON.stringify(sql.slice(0, 120))}`);
  const close = matchingBracket(text2, open);
  if (close === -1) throw new Error("unbalanced brackets in the table definition");
  const head = text2.slice(0, open).trim();
  const tail = text2.slice(close + 1).trim();
  const headMatch = /^CREATE\s+(?:(?:TEMP|TEMPORARY|VIRTUAL)\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(.+)$/i.exec(head);
  if (headMatch === null) throw new Error(`not a CREATE TABLE statement: ${JSON.stringify(head.slice(0, 120))}`);
  const ifNotExists = headMatch[1] !== void 0;
  if (/CREATE\s+VIRTUAL\s+TABLE/i.test(head)) throw new Error("a virtual table cannot be rebuilt");
  const parts = splitTopLevel(headMatch[2], ".");
  const name2 = unquoteIdentifier(parts[parts.length - 1]);
  const columns = [];
  const constraints = [];
  for (const item of splitTopLevel(text2.slice(open + 1, close))) {
    const column = parseColumnItem(item, dialect);
    if (column !== void 0) columns.push(column);
    else constraints.push({ sql: item, kind: classifyConstraint(item) });
  }
  if (columns.length === 0) throw new Error("the table definition lists no columns");
  const primary = constraints.find((constraint) => constraint.kind === "primary");
  if (primary !== void 0) {
    const listMatch = /\(\s*([\s\S]*)\)\s*$/.exec(primary.sql);
    if (listMatch !== null) {
      const names = splitTopLevel(listMatch[1]).map((part) => unquoteIdentifier(/^([^\s]*)/.exec(part.trim())?.[1] ?? ""));
      for (const [index, columnName] of names.entries()) {
        const column = columns.find((candidate) => candidate.name.toLowerCase() === columnName.toLowerCase());
        if (column !== void 0) column.primaryKeyPosition = index + 1;
      }
    }
  }
  for (const column of columns) if (column.primaryKeyPosition !== void 0 && column.primaryKeyPosition > 1) column.nullable = false;
  return { name: name2, ifNotExists, columns, constraints, tail };
}
function renderColumn(column, dialect) {
  const parts = [identifier(column.name, "column name", dialect)];
  const type = column.type.trim() === "" ? "" : normalizeType(column.type, dialect);
  if (type !== "") parts.push(type);
  parts.push(...column.extras);
  if (column.collate !== void 0 && column.collate !== "") {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(column.collate)) {
      throw new Error(`invalid collation for column ${column.name}: ${JSON.stringify(column.collate)}`);
    }
    parts.push(`COLLATE ${column.collate}`);
  }
  if (column.generated !== true) {
    parts.push(column.nullable ? "NULL" : "NOT NULL");
    if (column.defaultValue !== void 0) {
      const raw = column.defaultValue.trim();
      const isExpression = raw !== "" && !raw.startsWith("'") && /[(]/.test(raw);
      if (isExpression) {
        parts.push(`DEFAULT ${raw.startsWith("(") && raw.endsWith(")") ? raw : `(${raw})`}`);
      } else {
        const value = normalizeDefault(column.defaultValue, dialect);
        if (value !== void 0) parts.push(`DEFAULT ${value}`);
      }
    }
    if (column.unique === true) parts.push("UNIQUE");
    if (column.autoIncrement === true && dialect === "mysql") parts.push("AUTO_INCREMENT");
    if (column.check !== void 0) parts.push(column.check);
  }
  if (column.comment !== void 0 && dialect === "mysql") parts.push(`COMMENT ${quoteLiteral(column.comment)}`);
  return parts.join(" ");
}
function renderCreateTable(shape2, dialect, options = {}) {
  const name2 = options.name ?? shape2.name;
  const columns = shape2.columns;
  const keyed = columns.filter((column) => column.primaryKeyPosition !== void 0);
  const inlineKey = keyed.length === 1 ? keyed[0] : void 0;
  const items = columns.map((column) => {
    const rendered = renderColumn(column, dialect);
    if (column !== inlineKey) return rendered;
    const sqliteAuto = dialect === "sqlite" && column.sqliteAutoincrement === true ? " AUTOINCREMENT" : "";
    return `${rendered} PRIMARY KEY${sqliteAuto}`;
  });
  const constraints = shape2.constraints.map((constraint) => constraint.sql);
  const body = [...items, ...constraints].map((item) => `  ${item}`).join(",\n");
  const tail = shape2.tail === "" ? "" : ` ${shape2.tail}`;
  const flag = (options.ifNotExists ?? shape2.ifNotExists) === true ? "IF NOT EXISTS " : "";
  return `CREATE TABLE ${flag}${identifier(name2, "table name", dialect)} (
${body}
)${tail}`;
}
function setPrimaryKey(shape2, columns, dialect) {
  for (const column of shape2.columns) delete column.primaryKeyPosition;
  shape2.constraints = shape2.constraints.filter((constraint) => constraint.kind !== "primary");
  if (columns.length === 0) return;
  for (const [index, name2] of columns.entries()) {
    const column = shape2.columns.find((candidate) => candidate.name === name2);
    if (column === void 0) throw new Error(`no such column: ${JSON.stringify(name2)}`);
    column.primaryKeyPosition = index + 1;
    column.nullable = false;
  }
  if (columns.length > 1) {
    shape2.constraints.push({
      sql: `PRIMARY KEY (${columns.map((name2) => identifier(name2, "column name", dialect)).join(", ")})`,
      kind: "primary"
    });
  }
}
var MYSQL_TYPE_BASE, SQLITE_TYPE_BASE, NUMERIC_ARG_RE, LENGTH_ARG_RE, MYSQL_MODIFIERS, DEFAULT_KEYWORDS, TABLE_CONSTRAINT_RE, MYSQL_INDEX_CONSTRAINT_RE, FLAG_STARTERS;
var init_sql_schema = __esm({
  "src/sql-schema.ts"() {
    "use strict";
    init_sql_util();
    MYSQL_TYPE_BASE = [
      "tinyint",
      "smallint",
      "mediumint",
      "int",
      "integer",
      "bigint",
      "decimal",
      "numeric",
      "float",
      "double",
      "real",
      "bit",
      "bool",
      "boolean",
      "date",
      "datetime",
      "timestamp",
      "time",
      "year",
      "char",
      "varchar",
      "binary",
      "varbinary",
      "tinytext",
      "text",
      "mediumtext",
      "longtext",
      "tinyblob",
      "blob",
      "mediumblob",
      "longblob",
      "enum",
      "set",
      "json",
      "geometry",
      "point",
      "linestring",
      "polygon",
      "multipoint",
      "multilinestring",
      "multipolygon",
      "geometrycollection",
      "inet4",
      "inet6",
      "uuid",
      "vector"
    ];
    SQLITE_TYPE_BASE = [
      "integer",
      "int",
      "tinyint",
      "smallint",
      "mediumint",
      "bigint",
      "unsigned big int",
      "int2",
      "int8",
      "character",
      "varchar",
      "varying character",
      "nchar",
      "native character",
      "nvarchar",
      "text",
      "clob",
      "blob",
      "real",
      "double",
      "double precision",
      "float",
      "numeric",
      "decimal",
      "boolean",
      "date",
      "datetime",
      "time",
      "timestamp",
      "json",
      "uuid",
      "year"
    ];
    NUMERIC_ARG_RE = /^\d{1,4}(,\d{1,4})?$/;
    LENGTH_ARG_RE = /^\d{1,6}$/;
    MYSQL_MODIFIERS = ["unsigned", "zerofill"];
    DEFAULT_KEYWORDS = /* @__PURE__ */ new Set([
      "null",
      "true",
      "false",
      "current_timestamp",
      "current_timestamp()",
      "current_date",
      "current_date()",
      "current_time",
      "current_time()",
      "localtimestamp",
      "localtimestamp()",
      "localtime",
      "now()",
      "uuid()"
    ]);
    TABLE_CONSTRAINT_RE = /^(?:(?:CONSTRAINT\s+\S+\s+)?(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK))\b/i;
    MYSQL_INDEX_CONSTRAINT_RE = /^(?:KEY|INDEX|FULLTEXT|SPATIAL)\b[\s\S]*\(/i;
    FLAG_STARTERS = /* @__PURE__ */ new Set([
      "not",
      "default",
      "primary",
      "unique",
      "check",
      "collate",
      "references",
      "constraint",
      "generated",
      "auto_increment",
      "autoincrement",
      "comment",
      "on",
      "match",
      "deferrable",
      "initially",
      "as",
      "signed",
      "unsigned",
      "zerofill",
      "stored",
      "virtual",
      "using"
    ]);
  }
});

// src/protocol.ts
var DB_KINDS, ROW_FILTER_OPERATORS, REDIS_CREATABLE_TYPES, DB_API_BASE, DB_API;
var init_protocol = __esm({
  "src/protocol.ts"() {
    "use strict";
    init_types();
    init_types();
    init_types();
    DB_KINDS = ["sqlite", "mysql", "redis"];
    ROW_FILTER_OPERATORS = [
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
    REDIS_CREATABLE_TYPES = ["string", "list", "set", "hash", "zset"];
    DB_API_BASE = "/api/dsh-database";
    DB_API = {
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
  }
});

// src/drivers/types.ts
function isSqlDriver(driver) {
  return driver.kind === "sqlite" || driver.kind === "mysql";
}
function isRedisDriver(driver) {
  return driver.kind === "redis";
}
var POSITION_FIRST, COLUMN_ATTRIBUTES, INDEX_KINDS, MAINTENANCE_OPS;
var init_types = __esm({
  "src/drivers/types.ts"() {
    "use strict";
    init_protocol();
    POSITION_FIRST = "\0first";
    COLUMN_ATTRIBUTES = ["unsigned", "zerofill", "binary", "onUpdateCurrentTimestamp"];
    INDEX_KINDS = ["primary", "unique", "index", "fulltext", "spatial"];
    MAINTENANCE_OPS = ["check", "optimize", "repair", "analyze"];
  }
});

// src/drivers/mysql.ts
var mysql_exports = {};
__export(mysql_exports, {
  MysqlDriver: () => MysqlDriver,
  defaultLiteralFor: () => defaultLiteralFor,
  mysqlAvailable: () => mysqlAvailable,
  validateMysqlAttributes: () => validateMysqlAttributes
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
function buildOrder(query, columns) {
  const byName = new Map(columns.map((column) => [column.name.toLowerCase(), column.name]));
  const direction = query.orderDir === "desc" ? "DESC" : "ASC";
  if (query.orderByColumns !== void 0 && query.orderByColumns.length > 0) {
    const resolved2 = query.orderByColumns.map((name2) => byName.get(name2.toLowerCase()));
    if (resolved2.some((name2) => name2 === void 0)) return "";
    return ` ORDER BY ${resolved2.map((name2) => `${quoteMysql(name2)} ${direction}`).join(", ")}`;
  }
  if (query.orderBy === void 0) return "";
  const resolved = byName.get(query.orderBy.toLowerCase());
  if (resolved === void 0) return "";
  return ` ORDER BY ${quoteMysql(resolved)} ${direction}`;
}
function buildFilter(query, columns, known) {
  if (query.filters !== void 0 && query.filters.length > 0) {
    return buildSearchWhere(query.filters, query.filterJoin === "or" ? "or" : "and", quoteMysql, known, "mysql");
  }
  if (query.mode === "search") {
    const term = query.term ?? "";
    if (term === "") return { where: "", params: [] };
    const target = columns.filter((column) => isTextual(column.type));
    const chosen = target.length > 0 ? target : columns;
    const pattern = `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const clauses = chosen.map((column) => `${quoteMysql(column.name)} LIKE ? ${likeEscapeClause("mysql")}`);
    return { where: ` WHERE (${clauses.join(" OR ")})`, params: chosen.map(() => pattern) };
  }
  if (query.condition !== void 0 && query.condition.trim() !== "") {
    assertSingleStatement(`SELECT 1 WHERE ${query.condition}`);
    return { where: ` WHERE (${query.condition})`, params: [] };
  }
  return { where: "", params: [] };
}
function readEnumOptions(type) {
  const match = /^(enum|set)\s*\(([\s\S]*)\)$/i.exec(type.trim());
  if (match === null) return void 0;
  const members = [];
  const body = match[2];
  let i = 0;
  while (i < body.length) {
    if (body[i] === "'") {
      let j = i + 1;
      let value = "";
      while (j < body.length) {
        if (body[j] === "\\") {
          value += body[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (body[j] === "'") {
          if (body[j + 1] === "'") {
            value += "'";
            j += 2;
            continue;
          }
          break;
        }
        value += body[j];
        j++;
      }
      members.push(value);
      i = j + 1;
      continue;
    }
    i++;
  }
  return members;
}
function renderMysqlDefinition(spec, carry = {}) {
  const parts = [];
  const base = spec.type.trim() === "" ? "" : normalizeType(spec.type, "mysql");
  if (base === "") throw new Error("a MySQL column needs a type");
  const hasParens = /\(/.test(base);
  const length = spec.length === void 0 ? "" : spec.length.trim();
  if (length !== "" && !hasParens) {
    if (!/^[0-9]{1,10}(\s*,\s*[0-9]{1,10})?$/.test(length) && !/^'([^'\\]|'')*'(\s*,\s*'([^'\\]|'')*')*$/.test(length)) {
      throw new Error(`invalid length/values for column ${spec.name}: ${JSON.stringify(spec.length)}`);
    }
    parts.push(`${base}(${length})`);
  } else {
    parts.push(base);
  }
  if (carry.generated === true) {
    const expression = carry.generatedExpression?.trim() ?? "";
    if (expression === "") {
      throw new Error(
        `\u300C${spec.name}\u300D\u662F\u751F\u6210\u5217\uFF0C\u4F46\u670D\u52A1\u7AEF\u6CA1\u6709\u62A5\u544A\u5B83\u7684\u8868\u8FBE\u5F0F\uFF08information_schema.COLUMNS.GENERATION_EXPRESSION \u4E3A\u7A7A\uFF09\uFF0C\u65E0\u6CD5\u5B89\u5168\u5730\u91CD\u5199\u8FD9\u4E00\u5217\u3002`
      );
    }
    const storage = /VIRTUAL/i.test(carry.extra ?? "") ? "VIRTUAL" : "STORED";
    parts.push(`GENERATED ALWAYS AS ${expression} ${storage}`);
    parts.push(spec.primaryKeyPosition === void 0 && spec.nullable ? "NULL" : "NOT NULL");
    if (spec.comment !== void 0 && spec.comment !== "") parts.push(renderComment(spec.comment));
    return parts.join(" ");
  }
  const attributes = new Set(spec.attributes ?? []);
  if (attributes.has("unsigned") || attributes.has("zerofill")) parts.push("UNSIGNED");
  if (attributes.has("zerofill")) parts.push("ZEROFILL");
  if (attributes.has("binary")) parts.push("BINARY");
  if (spec.charset !== void 0 && spec.charset !== "") parts.push(`CHARACTER SET ${requireCharset(spec.charset)}`);
  if (spec.collate !== void 0 && spec.collate !== "") parts.push(`COLLATE ${requireCollate(spec.collate)}`);
  parts.push(spec.primaryKeyPosition === void 0 && spec.nullable ? "NULL" : "NOT NULL");
  if (carry.verbatimDefault !== void 0) {
    parts.push(`DEFAULT ${carry.verbatimDefault}`);
  } else if (spec.defaultValue !== void 0) {
    const value = normalizeDefault(spec.defaultValue, "mysql");
    if (value !== void 0) parts.push(`DEFAULT ${value}`);
  }
  if (attributes.has("onUpdateCurrentTimestamp") || carry.onUpdateCurrentTimestamp === true) {
    parts.push("ON UPDATE CURRENT_TIMESTAMP");
  }
  if (spec.autoIncrement === true) parts.push("AUTO_INCREMENT");
  if (spec.unique === true) parts.push("UNIQUE");
  if (spec.comment !== void 0 && spec.comment !== "") parts.push(renderComment(spec.comment));
  return parts.join(" ");
}
function validateMysqlAttributes(spec) {
  const attributes = spec.attributes ?? [];
  if (attributes.length === 0) return;
  const type = spec.type.toUpperCase();
  const isTemporal = /\b(TIMESTAMP|DATETIME)\b/.test(type);
  const isString = /\b(CHAR|VARCHAR|TEXT|BLOB|ENUM|SET|BINARY|VARBINARY)\b/.test(type);
  const isNumeric = /\b(INT|INTEGER|TINYINT|SMALLINT|MEDIUMINT|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|BIT)\b/.test(type);
  for (const attribute of attributes) {
    if (attribute === "binary" && !isString) {
      throw new Error(`column ${spec.name}: BINARY only applies to CHAR / VARCHAR / TEXT / BLOB types`);
    }
    if (attribute === "unsigned" && !isNumeric) {
      throw new Error(`column ${spec.name}: UNSIGNED only applies to numeric types`);
    }
    if (attribute === "zerofill" && !isNumeric) {
      throw new Error(`column ${spec.name}: ZEROFILL only applies to numeric types`);
    }
    if (attribute === "onUpdateCurrentTimestamp" && !isTemporal) {
      throw new Error(`column ${spec.name}: ON UPDATE CURRENT_TIMESTAMP only applies to TIMESTAMP or DATETIME`);
    }
  }
}
function renderComment(text2) {
  if (text2.includes("\\")) throw new Error("a column comment cannot contain a backslash");
  return `COMMENT '${text2.replace(/'/g, "''")}'`;
}
function toSpec(column) {
  return {
    name: column.name,
    type: column.type,
    nullable: column.nullable,
    ...column.defaultValue === void 0 ? {} : { defaultValue: defaultLiteralFor(column.defaultValue, column.type) },
    ...column.primaryKeyPosition === void 0 ? {} : { primaryKeyPosition: column.primaryKeyPosition },
    ...column.extra !== void 0 && /auto_increment/i.test(column.extra) ? { autoIncrement: true } : {},
    ...column.comment === void 0 ? {} : { comment: column.comment }
  };
}
function isNumericColumnType(type) {
  return /^(tiny|small|medium|big)?(int|year)|^(decimal|numeric|float|double|real|bit)/i.test(type.trim());
}
function unescapeDefaultExpression(text2) {
  let out = "";
  for (let i = 0; i < text2.length; i++) {
    if (text2[i] === "\\" && i + 1 < text2.length) {
      out += text2[i + 1];
      i++;
      continue;
    }
    out += text2[i];
  }
  return out;
}
function defaultLiteralFor(reported, type) {
  const text2 = reported.trim();
  if (text2 === "") return text2;
  if (/^(?:null|true|false)$/i.test(text2)) return text2;
  if (BARE_DEFAULT_KEYWORDS.test(text2)) return text2;
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text2)) {
    return isNumericColumnType(type) ? text2 : `'${text2}'`;
  }
  if (text2.includes("(")) {
    const expression = unescapeDefaultExpression(text2);
    return /^\([\s\S]*\)$/.test(expression) ? expression : `(${expression})`;
  }
  if (isNumericColumnType(type)) return text2;
  return `'${text2.replace(/'/g, "''")}'`;
}
function explainAlterFailure(error, existing, spec) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Data truncated|Invalid use of NULL value|cannot be null/i.test(message) && existing.nullable && !spec.nullable) {
    return new Error(
      `column "${existing.name}" cannot become NOT NULL: it currently holds NULL values. Fill or delete those rows first, then set the column NOT NULL. \uFF08\u5F15\u64CE\u539F\u6587\uFF1A${message}\uFF09`
    );
  }
  return error instanceof Error ? error : new Error(message);
}
function isTextual(type) {
  return /char|text|enum|set|json|blob|binary/i.test(type);
}
function requireCharset(value) {
  const name2 = value.trim();
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name2)) throw new Error(`invalid character set: ${JSON.stringify(value)}`);
  return name2;
}
function requireCollate(value) {
  const name2 = value.trim();
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name2)) throw new Error(`invalid collation: ${JSON.stringify(value)}`);
  return name2;
}
function projectRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) out[key] = toWireValue(value);
  return out;
}
function asString(value) {
  return typeof value === "string" && value !== "" ? value : void 0;
}
function toCount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "string") return void 0;
  const text2 = value.trim();
  if (text2 === "") return void 0;
  const parsed = Number(text2);
  return Number.isFinite(parsed) ? parsed : void 0;
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
var MysqlDriver, BARE_DEFAULT_KEYWORDS;
var init_mysql = __esm({
  "src/drivers/mysql.ts"() {
    "use strict";
    init_sql_util();
    init_sql_schema();
    init_types();
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
       * Which maintenance operations MySQL supports.
       *
       * All four have statements. What differs is whether they DO anything: `repair`
       * only applies to MyISAM, and `optimize` on InnoDB is rewritten by the server into
       * a recreate + analyze. Both are still offered, because both are legal statements
       * whose answer the user should see — see {@link maintain}.
       */
      maintenanceSupport() {
        return ["check", "optimize", "repair", "analyze"];
      }
      /**
       * All three table actions, because MySQL can do all three.
       *
       * Unlike `repair` on InnoDB, none of these has an "accepted but does nothing"
       * form: `RENAME TABLE … TO other_db.t` really moves the table, `CREATE TABLE …
       * LIKE` really clones the structure, and every option the 表选项 page edits has a
       * statement behind it. So there is nothing here to disable with a caveat.
       */
      tableActionSupport() {
        return ["move", "options", "copy"];
      }
      /**
       * Run one maintenance statement per table.
       *
       * One statement per table rather than one covering all of them: `CHECK TABLE a, b`
       * is legal, but a per-table result is what lets the panel attribute a failure or a
       * note to the table it belongs to. The statements are cheap metadata operations,
       * so the extra round trips are not the cost that matters.
       *
       * The server's own message lines are returned verbatim. They are the answer:
       * `optimize` on InnoDB reports "Table does not support optimize, doing recreate +
       * analyze instead" and `repair` on InnoDB reports that the engine does not support
       * repair, and neither is an error — a panel that summarised them away would claim
       * work that did not happen.
       */
      async maintain(schema, tables, op) {
        const target = this.requireSchema(schema);
        if (tables.length === 0) throw new Error("maintenance needs at least one table");
        const statement = op.toUpperCase();
        if (!/^(CHECK|OPTIMIZE|REPAIR|ANALYZE)$/.test(statement)) throw new Error(`unsupported maintenance operation: ${op}`);
        const results = [];
        for (const table of tables) {
          const qualified = qualifyMysql(target, table);
          const result = await this.exec(`${statement} TABLE ${qualified}`, [], target);
          const messages = [];
          let ok = true;
          for (const row of result.rows) {
            const first = row[0] === void 0 ? "" : String(row[0]);
            if (first.toLowerCase() === "table") continue;
            const type = row[2] === void 0 ? "" : String(row[2]);
            const text2 = row[3] === void 0 ? "" : String(row[3]);
            messages.push(`${first} ${type}: ${text2}`.trim());
            if (type.toLowerCase() === "error") ok = false;
          }
          results.push({ op, ok, messages });
        }
        return results;
      }
      /**
       * Run one database-level operation.
       *
       * Every one of these is DDL on a whole database, so the statements are built from
       * VALIDATED identifiers only — a database name cannot be parameter-bound in any of
       * these forms, which is exactly why {@link requireIdentifier} gates it.
       *
       * `drop` is the only irreversible one, and it is not special-cased here: the panel
       * confirms it, and this layer's job is to do what it was told.
       */
      /**
       * Run one database-level operation.
       *
       * Every one of these is DDL on a whole database, so the statements are built from
       * VALIDATED identifiers only — a database name cannot be parameter-bound in any of
       * these forms, which is exactly why {@link requireIdentifier} gates it.
       *
       * `rename` is a special case worth knowing about: MySQL has NO `RENAME DATABASE`
       * (it was removed in 5.1 because it could corrupt data). Renaming a database means
       * creating the new one and moving every table into it with
       * `RENAME TABLE old.t TO new.t`, which is what this does — one `RENAME TABLE`
       * statement carrying all the moves, so the server does it as a single atomic
       * operation rather than one statement per table.
       *
       * `copy` creates the target and runs `CREATE TABLE new.t LIKE old.t` plus, when
       * asked, `INSERT INTO new.t SELECT * FROM old.t`. That copies the structure and
       * the rows; it does NOT copy triggers or views, which have no `LIKE` form and
       * whose recreation is not something this panel should guess at.
       */
      async databaseOperation(op, name2, options = {}) {
        const started = Date.now();
        const target = requireIdentifier(name2, "database name", quoteMysql);
        if (op === "create") {
          const charset = options.charset === void 0 || options.charset === "" ? "" : ` CHARACTER SET ${requireCharset(options.charset)}`;
          const collate = options.collate === void 0 || options.collate === "" ? "" : ` COLLATE ${requireCollate(options.collate)}`;
          return this.exec(`CREATE DATABASE ${target}${charset}${collate}`, []);
        }
        if (op === "drop") return this.exec(`DROP DATABASE ${target}`, []);
        if (op === "charset") {
          if (options.charset === void 0 || options.charset === "") throw new Error("a character set is required");
          const collate = options.collate === void 0 || options.collate === "" ? "" : ` COLLATE ${requireCollate(options.collate)}`;
          return this.exec(`ALTER DATABASE ${target} CHARACTER SET ${requireCharset(options.charset)}${collate}`, []);
        }
        const from = options.from;
        if (from === void 0 || from === "") throw new Error(`"${op}" needs the source database`);
        const source = requireIdentifier(from, "database name", quoteMysql);
        if (source === name2) throw new Error("the source and target database are the same");
        if (op === "rename") {
          const tables = await this.tableNames(from);
          await this.exec(`CREATE DATABASE ${target}`, []);
          if (tables.length > 0) {
            const moves = tables.map((table) => `${qualifyMysql(from, table.name)} TO ${qualifyMysql(name2, table.name)}`).join(", ");
            await this.exec(`RENAME TABLE ${moves}`, []);
          }
          await this.exec(`DROP DATABASE ${source}`, []);
          return { columns: [], rows: [], affected: tables.length, durationMs: Date.now() - started, write: true, truncated: false };
        }
        if (op === "copy") {
          const tables = await this.tableNames(from);
          await this.exec(`CREATE DATABASE ${target}`, []);
          for (const table of tables) {
            if (table.type === "view") continue;
            await this.exec(`CREATE TABLE ${qualifyMysql(name2, table.name)} LIKE ${qualifyMysql(from, table.name)}`, []);
            if (options.includeData === true) {
              await this.exec(`INSERT INTO ${qualifyMysql(name2, table.name)} SELECT * FROM ${qualifyMysql(from, table.name)}`, []);
            }
          }
          return { columns: [], rows: [], affected: tables.length, durationMs: Date.now() - started, write: true, truncated: false };
        }
        throw new Error(`unsupported database operation: ${op}`);
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
          sql: wantStats ? "SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS rows_count, TABLE_COMMENT AS comment, ENGINE AS engine, TABLE_COLLATION AS collation, DATA_LENGTH AS data_bytes, INDEX_LENGTH AS index_bytes FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME" : "SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_COMMENT AS comment, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME",
          values: [target]
        });
        const list = Array.isArray(rows) ? rows : [];
        return list.map((row) => {
          const record = row;
          const type = String(record["type"] ?? "");
          const comment = toWireValue(record["comment"]);
          const rowCount = toCount(record["rows_count"]);
          const engine = toWireValue(record["engine"]);
          const collation = toWireValue(record["collation"]);
          const dataBytes = toCount(record["data_bytes"]);
          const indexBytes = toCount(record["index_bytes"]);
          const size = dataBytes !== void 0 || indexBytes !== void 0 ? (dataBytes ?? 0) + (indexBytes ?? 0) : void 0;
          return {
            name: String(record["name"] ?? ""),
            type: type.includes("VIEW") ? "view" : "table",
            ...rowCount === void 0 ? {} : { rows: rowCount },
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
          sql: "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt, COLUMN_KEY AS col_key, COLUMN_COMMENT AS comment, EXTRA AS extra, COLLATION_NAME AS collation, GENERATION_EXPRESSION AS generation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
          values: [target, table]
        });
        const primaryColumns = /* @__PURE__ */ new Set();
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const record = row;
            if (String(record["col_key"] ?? "") !== "PRI") continue;
            const name2 = String(record["name"] ?? "");
            if (name2 !== "") primaryColumns.add(name2);
          }
        }
        const [keyRows] = await (await this.open()).query({
          sql: "SELECT COLUMN_NAME AS name, SEQ_IN_INDEX AS seq FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX",
          values: [target, table]
        });
        const orderedFromStatistics = /* @__PURE__ */ new Map();
        if (Array.isArray(keyRows)) {
          for (const row of keyRows) {
            const record = row;
            const name2 = String(record["name"] ?? "");
            if (name2 !== "") orderedFromStatistics.set(name2, Number(record["seq"] ?? 0));
          }
        } else {
          void rows;
        }
        const list = Array.isArray(rows) ? rows : [];
        const declarationOrder = /* @__PURE__ */ new Map();
        list.forEach((row, index) => {
          const name2 = String(row["name"] ?? "");
          if (name2 !== "") declarationOrder.set(name2, index + 1);
        });
        return list.map((row) => {
          const record = row;
          const name2 = String(record["name"] ?? "");
          const dflt = toWireValue(record["dflt"]);
          const comment = toWireValue(record["comment"]);
          const extra = toWireValue(record["extra"]);
          const columnCollation = toWireValue(record["collation"]);
          const generation = toWireValue(record["generation"]);
          const options = readEnumOptions(String(record["type"] ?? ""));
          const inKey = primaryColumns.has(name2);
          const position = inKey ? orderedFromStatistics.get(name2) ?? declarationOrder.get(name2) : void 0;
          return {
            name: name2,
            type: String(record["type"] ?? ""),
            nullable: String(record["nullable"] ?? "YES").toUpperCase() === "YES",
            ...dflt === null ? {} : { defaultValue: String(dflt) },
            key: inKey ? "PRI" : String(record["col_key"] ?? ""),
            ...typeof comment === "string" && comment !== "" ? { comment } : {},
            ...typeof columnCollation === "string" && columnCollation !== "" ? { collation: columnCollation } : {},
            ...typeof extra === "string" && extra !== "" ? { extra } : {},
            ...position === void 0 ? {} : { primaryKeyPosition: position },
            ...options === void 0 ? {} : { options },
            /*
             * A generated column cannot be inserted into or updated, so the 插入 and 浏览
             * surfaces must not offer it as an editable input.
             *
             * The test is on the EXPRESSION, not on `EXTRA` containing "GENERATED":
             * measured, `EXTRA` is `DEFAULT_GENERATED` for an ordinary
             * `DEFAULT CURRENT_TIMESTAMP` column, so the substring test flagged such a
             * column as computed — which both hid it from the edit form and made every
             * edit of it fail with "this generated column cannot be modified". The
             * expression is also what a rewrite needs, so the two now come from one read.
             */
            ...typeof generation === "string" && generation !== "" ? { generated: true, generatedExpression: generation } : {}
          };
        });
      }
      /**
       * Whether the table has a primary key at all.
       *
       * Asked through {@link SqlDriver.columns} rather than with a `STATISTICS`
       * query for `INDEX_NAME = 'PRIMARY'`: MySQL's primary key is not always named
       * `PRIMARY` — a UNIQUE index is RAISED to the primary key when the table has
       * none, and then its own name is what `STATISTICS` reports.
       */
      async hasPrimaryKey(schema, table) {
        return (await this.columns(schema, table)).some((column) => column.key === "PRI");
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
        const keyColumns = (await this.columns(target, table)).filter((column) => column.key === "PRI").map((column) => column.name);
        const isPrimary = (name2, columns) => {
          if (name2 === "PRIMARY") return true;
          if (keyColumns.length === 0 || columns.length !== keyColumns.length) return false;
          return columns.every((column, index) => column === keyColumns[index]);
        };
        return [...byName.entries()].map(([name2, entry]) => {
          const columns = entry.columns.sort((a, b) => a.seq - b.seq).map((item) => item.name);
          return {
            name: name2,
            unique: entry.unique,
            columns,
            ...entry.type === void 0 ? {} : { type: entry.type },
            ...isPrimary(name2, columns) ? { primary: true } : {}
          };
        });
      }
      async rows(query) {
        const schema = this.requireSchema(query.schema);
        const columns = await this.columns(schema, query.table);
        if (columns.length === 0) throw new Error(`no such table: ${schema}.${query.table}`);
        const qualified = qualifyMysql(schema, query.table);
        const pages = await this.rowsInternal(schema, qualified, query, columns, false);
        return pages;
      }
      /**
       * One page of rows.
       *
       * @param forEditor - true when the caller will turn these rows into edits, so
       *   rows must be identifiable. See the primary-key caveat below.
       */
      async rowsInternal(schema, qualified, query, columns, forEditor) {
        void forEditor;
        const known = new Set(columns.map((column) => column.name.toLowerCase()));
        const { where, params } = buildFilter(query, columns, known);
        const [countRows] = await (await this.open()).query({
          sql: `SELECT COUNT(*) AS n FROM ${qualified}${where}`,
          values: params
        });
        const first = Array.isArray(countRows) ? countRows[0] : void 0;
        const total = Number(toWireValue(first?.["n"] ?? 0) ?? 0);
        const order = buildOrder(query, columns);
        const limit = Math.max(1, Math.min(query.pageSize, 5e3));
        const offset = Math.max(0, (query.page - 1) * limit);
        const [dataRows] = await (await this.open()).query({
          sql: `SELECT * FROM ${qualified}${where}${order} LIMIT ${limit} OFFSET ${offset}`,
          values: params
        });
        const list = Array.isArray(dataRows) ? dataRows : [];
        const comment = await this.tableComment(schema, query.table);
        return {
          columns,
          rows: list.map((row) => projectRow(row)),
          total: Number.isFinite(total) ? total : 0,
          page: query.page,
          pageSize: limit,
          primaryKey: columns.filter((column) => column.key === "PRI").map((column) => column.name),
          ...comment === void 0 ? {} : { comment }
        };
      }
      /**
       * The table's own comment, or undefined when there is none to show.
       *
       * Read for the 浏览 tab's pager line (phpMyAdmin's 「表注释」). Two things are
       * deliberately dropped rather than passed through:
       *
       * - A VIEW's comment is the literal string `VIEW`, which MySQL reports as a
       *   placeholder rather than as something a user typed (measured — see the same
       *   rule in `tableOptionInfo`). Showing it would put "VIEW" on screen as if the
       *   author had written it.
       * - MySQL reports an absent comment as the EMPTY STRING, not NULL. Absent is
       *   what the browser must see, so it can hide the line instead of rendering an
       *   empty one.
       *
       * Cheap: one indexed lookup in `information_schema`. It rides on the page read
       * because that read is already happening, and a second request for one string
       * would be a second chance to disagree with it.
       */
      async tableComment(schema, table) {
        const [rows] = await (await this.open()).query({
          sql: "SELECT TABLE_TYPE AS type, TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
          values: [schema, table]
        });
        const first = Array.isArray(rows) ? rows[0] : void 0;
        if (first === void 0) return void 0;
        if (String(first["type"] ?? "").toUpperCase().includes("VIEW")) return void 0;
        const comment = toWireValue(first["comment"]);
        return typeof comment === "string" && comment !== "" ? comment : void 0;
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
      /**
       * Insert several rows in ONE transaction.
       *
       * MySQL makes this cheap: a single `INSERT … VALUES (…),(…)` is one statement,
       * one round trip and one implicit transaction, so a large CSV import does not
       * pay per-row latency. Rows are chunked, because `max_allowed_packet` caps the
       * statement size and one packet per 500 rows is well inside every default.
       *
       * Rows are NOT required to name the same columns. They used to be, and the
       * 插入 tab's phpMyAdmin-shaped forms are what made that wrong: each form is
       * filled in independently, so a column left blank in one row and supplied in
       * another is the ordinary case rather than a mistake. Measured: two such forms
       * made the batch answer 500 "every row in one insert must name the same
       * columns, in the same order". Rows that DO agree still share one multi-row
       * statement — the CSV import's cheap path is unchanged — and only a change of
       * column list costs another statement.
       */
      async insertRows(schema, table, rows) {
        if (rows.length === 0) throw new Error("insert requires at least one row");
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        const started = Date.now();
        const pool = await this.open();
        const connection = await pool.getConnection();
        try {
          await connection.query({ sql: `USE ${quoteMysql(target)}` });
          await connection.query({ sql: "START TRANSACTION" });
          let affected = 0;
          try {
            for (const group of groupSameColumns(rows)) {
              const columns = group[0].map((item) => item.column);
              const names = columns.map((name2) => requireIdentifier(name2, "column name", quoteMysql)).join(", ");
              const CHUNK = 500;
              for (let at = 0; at < group.length; at += CHUNK) {
                const chunk = group.slice(at, at + CHUNK);
                const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
                const params = chunk.flatMap((row) => row.map((item) => item.value));
                await connection.query({ sql: `INSERT INTO ${qualified} (${names}) VALUES ${placeholders}`, values: params });
                affected += chunk.length;
              }
            }
            await connection.query({ sql: "COMMIT" });
          } catch (error) {
            try {
              await connection.query({ sql: "ROLLBACK" });
            } catch {
            }
            throw error;
          }
          return { columns: [], rows: [], affected, durationMs: Date.now() - started, write: true, truncated: false };
        } finally {
          try {
            await connection.query({ sql: "USE `information_schema`" });
            connection.release();
          } catch {
          }
        }
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
       * Delete several rows in one transaction.
       *
       * One statement per key set rather than a single `IN (…)`: a key may be
       * composite, and a composite key's tuple cannot be expressed as an `IN` over
       * one column. Wrapped in a transaction so a mid-list failure leaves the table
       * as it was, rather than half-deleted with no record of where it stopped.
       */
      async deleteRows(schema, table, keySets) {
        if (keySets.length === 0) throw new Error("delete requires at least one row key");
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        const started = Date.now();
        const pool = await this.open();
        const connection = await pool.getConnection();
        try {
          await connection.query({ sql: `USE ${quoteMysql(target)}` });
          await connection.query({ sql: "START TRANSACTION" });
          let affected = 0;
          try {
            for (const keys of keySets) {
              if (keys.length === 0) throw new Error("delete requires a row key");
              const where = keys.map((item) => `${requireIdentifier(item.column, "column name", quoteMysql)} <=> ?`).join(" AND ");
              const [result] = await connection.query({
                sql: `DELETE FROM ${qualified} WHERE ${where}`,
                values: keys.map((item) => item.value)
              });
              const summary = result ?? {};
              affected += Number(toWireValue(summary["affectedRows"] ?? 0) ?? 0);
            }
            await connection.query({ sql: "COMMIT" });
          } catch (error) {
            try {
              await connection.query({ sql: "ROLLBACK" });
            } catch {
            }
            throw error;
          }
          return { columns: [], rows: [], affected, durationMs: Date.now() - started, write: true, truncated: false };
        } finally {
          try {
            await connection.query({ sql: "USE `information_schema`" });
            connection.release();
          } catch {
            connection.destroy();
          }
        }
      }
      /** How many distinct non-NULL values a column holds. */
      async distinctCount(schema, table, column) {
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        const quoted = requireIdentifier(column, "column name", quoteMysql);
        const [rows] = await (await this.open()).query({ sql: `SELECT COUNT(DISTINCT ${quoted}) AS n FROM ${qualified}` });
        const first = Array.isArray(rows) ? rows[0] : void 0;
        return Number(toWireValue(first?.["n"] ?? 0) ?? 0);
      }
      // ---- schema editing ----------------------------------------------------
      /** Add a column. */
      /**
       * Create a table from a column list.
       *
       * The definition renderer is the SAME one `addColumn` uses, so a column created
       * here and one added later cannot diverge in how they are rendered — and both go
       * through the same type/default validation.
       *
       * A primary key is emitted as a table-level constraint rather than inline, because
       * a composite key has no inline form; using one shape for both keeps the single- and
       * multi-column cases byte-for-byte the same apart from the column list.
       *
       * No `IF NOT EXISTS`: creating a table whose name is taken should say so. Silently
       * succeeding would leave the user believing they created something.
       *
       * Indexes beyond the primary key are emitted as table-level clauses, because a
       * composite index spans columns and has no single-column form. FULLTEXT and SPATIAL
       * are only legal on suitable column types, so each is checked against the columns it
       * covers before the statement is built — the server's own message ("Column 'a' cannot
       * be part of FULLTEXT index") does not say which of the form's fields to change.
       */
      async createTable(schema, table, columns, options = {}) {
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        if (columns.length === 0) throw new Error("a new table needs at least one column");
        for (const spec of columns) validateMysqlAttributes(spec);
        const items = columns.map(
          (spec) => `${requireIdentifier(spec.name, "column name", quoteMysql)} ${renderMysqlDefinition(spec)}`
        );
        const names = new Set(columns.map((spec) => spec.name));
        const requireKnown = (list, what) => {
          if (list.length === 0) throw new Error(`${what} needs at least one column`);
          for (const name2 of list) {
            if (!names.has(name2)) throw new Error(`${what} names a column that is not being created: ${name2}`);
          }
        };
        const key = options.primaryKey ?? [];
        if (key.length > 0) {
          requireKnown(key, "the primary key");
          items.push(`PRIMARY KEY (${key.map((name2) => requireIdentifier(name2, "column name", quoteMysql)).join(", ")})`);
        }
        const autoColumns = columns.filter((spec) => spec.autoIncrement === true);
        if (autoColumns.length > 1) {
          throw new Error(`only one column can AUTO_INCREMENT; ${autoColumns.length} were requested (${autoColumns.map((spec) => spec.name).join(", ")})`);
        }
        const usedNames = /* @__PURE__ */ new Set(["PRIMARY"]);
        const keyLists = key.length > 0 ? [key] : [];
        for (const index of options.indexes ?? []) {
          requireKnown(index.columns, `the ${index.kind} index`);
          const kind = index.kind.toUpperCase();
          if (index.kind === "spatial") {
            for (const name2 of index.columns) {
              const spec = columns.find((column) => column.name === name2);
              if (spec !== void 0 && spec.nullable) {
                throw new Error(`the SPATIAL index covers "${name2}", which must be NOT NULL (MySQL requires it)`);
              }
            }
          }
          if (index.kind === "fulltext") {
            for (const name2 of index.columns) {
              const spec = columns.find((column) => column.name === name2);
              if (spec !== void 0 && !/\b(CHAR|VARCHAR|TEXT)\b/i.test(spec.type)) {
                throw new Error(`the FULLTEXT index covers "${name2}" (${spec.type}), which is not a text column`);
              }
            }
          }
          const columnsSql = index.columns.map((name2) => requireIdentifier(name2, "column name", quoteMysql)).join(", ");
          const optionsSql = index.options === void 0 || index.options.trim() === "" ? "" : ` ${index.options.trim()}`;
          if (index.kind === "primary") {
            if (key.length > 0) throw new Error("the primary key was given twice");
            items.push(`PRIMARY KEY (${columnsSql})${optionsSql}`);
            continue;
          }
          const indexName = index.name === void 0 || index.name.trim() === "" ? `${index.kind === "unique" ? "uq" : "ix"}_${table}_${index.columns.join("_")}` : index.name.trim();
          if (usedNames.has(indexName.toUpperCase())) throw new Error(`two indexes would be named ${indexName}`);
          usedNames.add(indexName.toUpperCase());
          keyLists.push(index.columns);
          const keyword = index.kind === "unique" ? "UNIQUE KEY" : index.kind === "fulltext" ? "FULLTEXT KEY" : index.kind === "spatial" ? "SPATIAL KEY" : "KEY";
          void kind;
          items.push(`${keyword} ${requireIdentifier(indexName, "index name", quoteMysql)} (${columnsSql})${optionsSql}`);
        }
        const tableOptions = options.table ?? {};
        const tail = [];
        if (tableOptions.engine !== void 0 && tableOptions.engine.trim() !== "") {
          if (!/^[A-Za-z0-9_]{1,32}$/.test(tableOptions.engine.trim())) {
            throw new Error(`invalid storage engine: ${JSON.stringify(tableOptions.engine)}`);
          }
          tail.push(`ENGINE=${tableOptions.engine.trim()}`);
        }
        if (tableOptions.charset !== void 0 && tableOptions.charset.trim() !== "") {
          tail.push(`DEFAULT CHARSET=${requireCharset(tableOptions.charset)}`);
        }
        if (tableOptions.collate !== void 0 && tableOptions.collate.trim() !== "") {
          tail.push(`COLLATE=${requireCollate(tableOptions.collate)}`);
        }
        if (tableOptions.comment !== void 0 && tableOptions.comment !== "") {
          if (tableOptions.comment.includes("\\")) throw new Error("a table comment cannot contain a backslash");
          tail.push(`COMMENT='${tableOptions.comment.replace(/'/g, "''")}'`);
        }
        const autoColumn = autoColumns[0];
        if (autoColumn !== void 0) {
          const inSomeKey = keyLists.some((list) => list.includes(autoColumn.name));
          if (!inSomeKey) {
            throw new Error(`column ${autoColumn.name} is AUTO_INCREMENT, so it must be a key: add it to the primary key, or give it a UNIQUE or INDEX of its own`);
          }
          if (!keyLists.some((list) => list[0] === autoColumn.name)) {
            throw new Error(`column ${autoColumn.name} is AUTO_INCREMENT, so it must be the FIRST column of a key (in a composite key the auto column cannot come second unless it is also indexed on its own)`);
          }
        }
        const suffix = tail.length === 0 ? "" : ` ${tail.join(" ")}`;
        return this.exec(`CREATE TABLE ${qualified} (
  ${items.join(",\n  ")}
)${suffix}`, [], target);
      }
      /**
       * Add a column, optionally at a chosen position.
       *
       * `AFTER x` / `FIRST` is what phpMyAdmin's 「在…之后」 produces. The column name is
       * VALIDATED as an existing column first: MySQL would answer `Unknown column 'x' in
       * 't'`, which is a correct refusal but does not say that the name came from a
       * position dropdown rather than from the column being added.
       *
       * The position is only ever read for `addColumn`. Passing it to a `MODIFY` would
       * move the column as a side effect of editing its type, which is not what that
       * form asks for.
       */
      async addColumn(schema, table, spec) {
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        let position = "";
        if (spec.positionAfter !== void 0) {
          if (spec.positionAfter === POSITION_FIRST) {
            position = " FIRST";
          } else {
            const existing = await this.columns(target, table);
            if (!existing.some((column) => column.name === spec.positionAfter)) {
              throw new Error(`\u627E\u4E0D\u5230\u8981\u653E\u5728\u5176\u540E\u7684\u5217\u300C${spec.positionAfter}\u300D\uFF08\u8868\u7ED3\u6784\u53EF\u80FD\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\uFF09`);
            }
            position = ` AFTER ${requireIdentifier(spec.positionAfter, "column name", quoteMysql)}`;
          }
        }
        return this.exec(
          `ALTER TABLE ${qualified} ADD COLUMN ${requireIdentifier(spec.name, "column name", quoteMysql)} ${renderMysqlDefinition(spec)}${position}`,
          [],
          target
        );
      }
      /**
       * Change an existing column.
       *
       * `MODIFY COLUMN` rewrites the whole column definition, so the spec has to
       * carry every attribute that must survive — which is why the 结构 tab loads
       * the column first and submits what it read back, rather than sending only the
       * changed field. `CHANGE COLUMN` is used when the name also changes.
       *
       * The column name is emitted HERE, not by the definition renderer: `MODIFY`
       * takes `name definition` and `CHANGE` takes `old new definition`, so a
       * renderer that included the name would produce `MODIFY COLUMN \`a\` \`a\`
       * int …` — a syntax error whose message points at the duplicated name rather
       * than at the caller.
       */
      async alterColumn(schema, table, spec, options = {}) {
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        const existing = (await this.columns(target, table)).find((column) => column.name === spec.name);
        if (existing === void 0) throw new Error(`no such column: ${spec.name}`);
        const live = existing.defaultValue;
        const liveLiteral = live === void 0 ? void 0 : defaultLiteralFor(live, spec.type);
        const unchanged = liveLiteral !== void 0 && (spec.defaultValue === live || spec.defaultValue === liveLiteral);
        const isExpression = unchanged && live !== void 0 && live.includes("(");
        const submitted = unchanged ? liveLiteral : spec.defaultValue;
        const definition = renderMysqlDefinition(
          isExpression ? { ...spec, defaultValue: void 0 } : { ...spec, ...submitted === void 0 ? {} : { defaultValue: submitted } },
          {
            generated: existing.generated,
            ...existing.generatedExpression === void 0 ? {} : { generatedExpression: existing.generatedExpression },
            extra: existing.extra,
            // Read from the live column: the form has no field for it, and an omitted
            // `ON UPDATE` clause is dropped by `MODIFY COLUMN`.
            onUpdateCurrentTimestamp: /on update/i.test(existing.extra ?? ""),
            ...isExpression ? { verbatimDefault: liveLiteral } : {}
          }
        );
        const current = requireIdentifier(spec.name, "column name", quoteMysql);
        const run = async (sql) => {
          try {
            return await this.exec(sql, [], target);
          } catch (error) {
            throw explainAlterFailure(error, existing, spec);
          }
        };
        if (options.rename !== void 0 && options.rename !== spec.name) {
          return run(`ALTER TABLE ${qualified} CHANGE COLUMN ${current} ${requireIdentifier(options.rename, "column name", quoteMysql)} ${definition}`);
        }
        return run(`ALTER TABLE ${qualified} MODIFY COLUMN ${current} ${definition}`);
      }
      /**
       * Drop a column.
       *
       * MySQL drops the column out of every index that covers it by itself, and
       * REFUSES the statement when the column is the only one left in an index
       * ("cannot drop column … needed in a foreign key constraint" / "check that
       * column exists"). That refusal is the right outcome and is passed through
       * unchanged, rather than pre-empted here with a guess about which index MySQL
       * would have tolerated.
       */
      async dropColumn(schema, table, column) {
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        const columns = await this.columns(target, table);
        if (columns.length === 0) throw new Error(`no such table: ${target}.${table}`);
        if (columns.length <= 1) throw new Error("a table must keep at least one column");
        const found = columns.find((candidate) => candidate.name === column);
        if (found === void 0) throw new Error(`no such column: ${column}`);
        return this.exec(`ALTER TABLE ${qualified} DROP COLUMN ${requireIdentifier(column, "column name", quoteMysql)}`, [], target);
      }
      /**
       * Replace the table's primary key.
       *
       * Several statements in one connection: MySQL will not accept a table with two
       * primary keys even momentarily, so the old one is dropped first — and the
       * ordering below is what keeps the intermediate state the least harmful one.
       * MySQL's DDL commits itself, so there is no rollback to lean on.
       *
       * Three engine quirks drive the details, all measured:
       *
       * 1. **An AUTO_INCREMENT column has to be a key**, so it is stripped of the
       *    attribute FIRST, while the old key still exists. Doing it later fails with
       *    "there can be only one auto column and it must be defined as a key".
       *    `autoIncrement: false` must be set explicitly: `toSpec` reads the
       *    attribute back off the live column, so passing it through unchanged would
       *    re-emit it.
       * 2. **A key column must be NOT NULL** (error 1171), so every chosen column is
       *    widened before the key is added.
       * 3. **A primary key RAISED from a UNIQUE index cannot be dropped with `DROP
       *    PRIMARY KEY`** — the server answers "Can't DROP 'PRIMARY'; check that
       *    column/key exists", because no index is actually named `PRIMARY`. It is
       *    dropped as the unique index it is instead, which is why the statement is
       *    chosen by asking what the key looks like rather than by assuming.
       */
      async setPrimaryKey(schema, table, columns) {
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        const existing = await this.columns(target, table);
        const known = new Map(existing.map((column) => [column.name.toLowerCase(), column]));
        for (const name2 of columns) {
          if (!known.has(name2.toLowerCase())) throw new Error(`no such column: ${name2}`);
        }
        const statements = [];
        for (const column of existing) {
          const isAuto = column.extra !== void 0 && /auto_increment/i.test(column.extra);
          if (!isAuto || columns.includes(column.name)) continue;
          statements.push(
            `ALTER TABLE ${qualified} MODIFY COLUMN ${requireIdentifier(column.name, "column name", quoteMysql)} ${renderMysqlDefinition({ ...toSpec(column), autoIncrement: false })}`
          );
        }
        for (const name2 of columns) {
          const column = known.get(name2.toLowerCase());
          if (!column.nullable) continue;
          statements.push(`ALTER TABLE ${qualified} MODIFY COLUMN ${requireIdentifier(column.name, "column name", quoteMysql)} ${renderMysqlDefinition({ ...toSpec(column), nullable: false })}`);
        }
        const drop = await this.primaryKeyDropClause(target, table);
        if (drop !== void 0) statements.push(`ALTER TABLE ${qualified} ${drop}`);
        if (columns.length > 0) {
          statements.push(`ALTER TABLE ${qualified} ADD PRIMARY KEY (${columns.map((name2) => requireIdentifier(name2, "column name", quoteMysql)).join(", ")})`);
        }
        if (statements.length === 0) return { columns: [], rows: [], affected: 0, durationMs: 0, write: true, truncated: false };
        return this.execTransaction(statements, target);
      }
      /**
       * The clause that removes the table's current primary key, or undefined.
       *
       * `DROP PRIMARY KEY` when an index really is named `PRIMARY`; otherwise the key
       * is one MySQL RAISED from a UNIQUE index and has to be dropped under its own
       * name. The index whose column list equals the key's is the one — matched on
       * the columns rather than on a name, because the name is whatever the user (or
       * a previous tool) happened to give that unique index.
       *
       * The index is looked up through {@link SqlDriver.indexes} rather than in
       * `information_schema.STATISTICS` from scratch, so the naming rule lives in one
       * place and the two callers cannot drift.
       */
      async primaryKeyDropClause(schema, table) {
        if (!await this.hasPrimaryKey(schema, table)) return void 0;
        const indexes = await this.indexes(schema, table);
        const named = indexes.find((index) => index.name === "PRIMARY");
        if (named !== void 0) return "DROP PRIMARY KEY";
        const raised = indexes.find((index) => index.primary === true);
        if (raised === void 0) return "DROP PRIMARY KEY";
        return `DROP INDEX ${requireIdentifier(raised.name, "index name", quoteMysql)}`;
      }
      /**
       * Create an index on one or more existing columns.
       *
       * MySQL refuses an index on a `TEXT`/`BLOB` column without a prefix length
       * ("BLOB/TEXT column used in key specification without a key length"). Its own
       * message does not say what to do about it, so the refusal is caught here and
       * restated with the reason — a user typing an index name into the 结构 tab
       * cannot act on the engine's wording, which reads like a syntax problem.
       */
      async createIndex(schema, table, spec) {
        if (spec.columns.length === 0) throw new Error("an index needs at least one column");
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        const columns = await this.columns(target, table);
        const known = new Map(columns.map((column) => [column.name.toLowerCase(), column]));
        const resolved = spec.columns.map((name3) => {
          const found = known.get(name3.toLowerCase());
          if (found === void 0) throw new Error(`no such column: ${name3}`);
          return found;
        });
        const unbounded = resolved.filter((column) => /^(tiny|medium|long)?(text|blob)$/i.test(column.type.trim()));
        if (unbounded.length > 0) {
          throw new Error(
            `MySQL cannot index ${unbounded.map((column) => `${column.name} (${column.type})`).join(", ")} without a prefix length; use a shorter column type (for example VARCHAR(191)) or add the index from the SQL tab with an explicit length`
          );
        }
        const name2 = requireIdentifier(spec.name, "index name", quoteMysql);
        return this.exec(
          `ALTER TABLE ${qualified} ADD ${spec.unique ? "UNIQUE " : ""}INDEX ${name2} (${resolved.map((column) => quoteMysql(column.name)).join(", ")})`,
          [],
          target
        );
      }
      /**
       * Drop an index.
       *
       * Refuses the primary key's own index — including one MySQL raised from a
       * UNIQUE index, which is not named `PRIMARY` and would otherwise look
       * droppable. Its own message for that case ("check that column/key exists" when
       * the name is `PRIMARY`, or a silent key removal when it is not) does not say
       * what is at stake, so the refusal is made here with the reason.
       */
      async dropIndex(schema, table, name2) {
        const target = this.requireSchema(schema);
        const indexes = await this.indexes(target, table);
        const found = indexes.find((index) => index.name === name2);
        if (found === void 0) throw new Error(`no such index: ${name2}`);
        if (found.primary === true) {
          throw new Error(`"${name2}" is the table's primary key; change the key instead of dropping it as an index`);
        }
        const qualified = qualifyMysql(target, table);
        return this.exec(`ALTER TABLE ${qualified} DROP INDEX ${requireIdentifier(name2, "index name", quoteMysql)}`, [], target);
      }
      /**
       * Run several statements on one pooled connection, scoped to `schema`.
       *
       * Needed wherever a schema change is not expressible as one statement — a
       * primary-key replacement is the case here. MySQL's DDL is not transactional
       * (each `ALTER TABLE` commits itself), so the statements are ordered so that
       * the intermediate state is the least harmful one: dropped rather than
       * duplicated, since the engine refuses a second primary key outright.
       */
      async execTransaction(statements, schema) {
        const pool = await this.open();
        const connection = await pool.getConnection();
        const started = Date.now();
        try {
          await connection.query({ sql: `USE ${quoteMysql(schema)}` });
          for (const statement of statements) await connection.query({ sql: statement });
          return { columns: [], rows: [], affected: 0, durationMs: Date.now() - started, write: true, truncated: false };
        } finally {
          try {
            await connection.query({ sql: "USE `information_schema`" });
            connection.release();
          } catch {
            connection.destroy();
          }
        }
      }
      /**
       * Move a table to another database.
       *
       * ONE `RENAME TABLE a.t TO b.t` statement, because that is what MySQL's move is:
       * the server relocates the table's files and keeps its data, indexes, triggers and
       * foreign keys, with no copy of the rows. `ALTER TABLE … RENAME TO b.t` would do
       * the same thing, but `RENAME TABLE` is also the statement that can carry several
       * moves at once, and it makes the "moving, not copying" nature of the operation
       * unambiguous to a reader.
       *
       * Three refusals worth their own messages, all measured:
       *
       * - **A VIEW cannot change schema.** MySQL answers `RENAME TABLE a.v TO b.v` with
       *   "Changing schema from 'a' to 'b' is not allowed", because a view's definition
       *   is stored against an explicit schema. It is refused here with that reason
       *   rather than passed through as a syntax-looking failure.
       * - **A target that already exists** stops the statement with "Table 'b.t' already
       *   exists" — checked here so the message can name the object the user has to deal
       *   with, which the engine's own error does not distinguish from a rename of the
       *   table being moved.
       * - **The same database and the same name** is a no-op that would still be a
       *   rename to itself; nothing is emitted.
       */
      async moveTable(schema, table, target) {
        const from = this.requireSchema(schema);
        const to = requireIdentifier(target.schema, "database name", quoteMysql);
        const targetTable = requireIdentifier(target.table, "table name", quoteMysql);
        const source = qualifyMysql(from, table);
        if (from === target.schema && table === target.table) {
          throw new Error("the source and the target are the same table");
        }
        const objects = await this.tableNames(from);
        const moving = objects.find((entry) => entry.name === table);
        if (moving === void 0) throw new Error(`no such table: ${from}.${table}`);
        if (moving.type === "view") {
          throw new Error(
            `\u300C${table}\u300D\u662F\u89C6\u56FE\uFF0CMySQL \u4E0D\u5141\u8BB8\u89C6\u56FE\u6362\u5E93\uFF08\u89C6\u56FE\u7684\u5B9A\u4E49\u7ED1\u5B9A\u5728\u521B\u5EFA\u5B83\u7684\u5E93\u4E0A\uFF0C\u670D\u52A1\u5668\u4F1A\u76F4\u63A5\u62D2\u7EDD\uFF09\u3002\u5982\u679C\u9700\u8981\u5728\u53E6\u4E00\u4E2A\u5E93\u91CC\u7528\u540C\u6837\u7684\u67E5\u8BE2\uFF0C\u8BF7\u5728\u90A3\u8FB9\u65B0\u5EFA\u4E00\u4E2A\u89C6\u56FE\u3002`
          );
        }
        const existing = await this.tableNames(target.schema);
        if (existing.some((entry) => entry.name.toLowerCase() === target.table.toLowerCase())) {
          throw new Error(`\u76EE\u6807\u5E93\u300C${target.schema}\u300D\u91CC\u5DF2\u5B58\u5728\u300C${target.table}\u300D`);
        }
        return this.exec(`RENAME TABLE ${source} TO ${qualifyMysql(target.schema, target.table)}`, [], void 0);
      }
      /**
       * Copy a table's structure, and optionally its rows, into another database.
       *
       * `CREATE TABLE new LIKE old` then `INSERT INTO new SELECT … FROM old`, which is
       * phpMyAdmin's 复制表 and the only pair of statements that reproduces a table
       * faithfully: `LIKE` copies the column definitions, the indexes, the primary key
       * and the AUTO_INCREMENT attribute.
       *
       * What it does NOT copy, stated rather than silently dropped: triggers and
       * foreign keys pointing OUT of the table. `LIKE` builds no triggers, and MySQL
       * refuses a foreign key whose target is not in the same schema — the target
       * database would have to have its own copy of the referenced table first, which is
       * a decision this panel must not make silently.
       *
       * The row copy names the columns explicitly and omits GENERATED ones. `INSERT INTO
       * new SELECT * FROM old` fails on a table with a stored generated column —
       * measured: "The value specified for generated column 'b' in table 'gen2' is not
       * allowed" — because `*` includes a column that cannot be inserted into. Naming
       * the others makes the copy work and lets the engine recompute the generated one.
       */
      async copyTable(schema, table, target, options = {}) {
        const from = this.requireSchema(schema);
        requireIdentifier(target.schema, "database name", quoteMysql);
        requireIdentifier(target.table, "table name", quoteMysql);
        if (from === target.schema && table === target.table) {
          throw new Error("the source and the target are the same table");
        }
        const objects = await this.tableNames(from);
        const moving = objects.find((entry) => entry.name === table);
        if (moving === void 0) throw new Error(`no such table: ${from}.${table}`);
        if (moving.type === "view" || options.isView === true) {
          throw new Error(
            `\u300C${table}\u300D\u662F\u89C6\u56FE\uFF0C\u65E0\u6CD5\u590D\u5236\u6210\u53E6\u4E00\u4E2A\u5E93\u91CC\u7684\u89C6\u56FE\uFF1AMySQL \u6CA1\u6709\u590D\u5236\u89C6\u56FE\u7684\u8BED\u53E5\uFF0C\u800C CREATE TABLE \u2026 LIKE \u5BF9\u89C6\u56FE\u4F1A\u76F4\u63A5\u62A5\u9519\uFF08\u5B83\u4E0D\u662F BASE TABLE\uFF09\u3002\u8BF7\u5728\u65B0\u5E93\u91CC\u81EA\u884C\u91CD\u5EFA\u89C6\u56FE\u3002`
          );
        }
        const existing = await this.tableNames(target.schema);
        if (existing.some((entry) => entry.name.toLowerCase() === target.table.toLowerCase())) {
          throw new Error(`\u76EE\u6807\u5E93\u300C${target.schema}\u300D\u91CC\u5DF2\u5B58\u5728\u300C${target.table}\u300D`);
        }
        const source = qualifyMysql(from, table);
        const destination = qualifyMysql(target.schema, target.table);
        const started = Date.now();
        await this.exec(`CREATE TABLE ${destination} LIKE ${source}`, [], void 0);
        const created = { columns: [], rows: [], affected: 1, durationMs: Date.now() - started, write: true, truncated: false };
        if (options.includeData !== true) return created;
        const columns = await this.columns(from, table);
        const writable = columns.filter((column) => column.generated !== true);
        if (writable.length === 0) return created;
        const names = writable.map((column) => requireIdentifier(column.name, "column name", quoteMysql)).join(", ");
        try {
          const copied = await this.exec(
            `INSERT INTO ${destination} (${names}) SELECT ${names} FROM ${source}`,
            [],
            void 0
          );
          return { ...created, affected: copied.affected, rows: [], durationMs: Date.now() - started };
        } catch (failure) {
          throw new Error(
            `\u8868\u7ED3\u6784\u5DF2\u590D\u5236\u5230\u300C${target.schema}.${target.table}\u300D\uFF0C\u4F46\u590D\u5236\u6570\u636E\u5931\u8D25\uFF1A${failure instanceof Error ? failure.message : String(failure)}`
          );
        }
      }
      /**
       * The option values MySQL reports for an existing table.
       *
       * Read from `information_schema.TABLES` rather than `SHOW TABLE STATUS`, then
       * corrected for the one field that catalog gets wrong: see
       * {@link TableOptionInfo.autoIncrement}. The character set is resolved through
       * `information_schema.COLLATIONS` instead of being split off the collation's name,
       * because a collation's name does not reliably start with its character set's
       * (`utf8mb3_general_ci` belongs to `utf8mb3`).
       */
      async tableOptionInfo(schema, table) {
        const target = this.requireSchema(schema);
        requireIdentifier(table, "table name", quoteMysql);
        const [rows] = await (await this.open()).query({
          sql: "SELECT TABLE_TYPE AS type, ENGINE AS engine, TABLE_COLLATION AS collation, TABLE_COMMENT AS comment, ROW_FORMAT AS rowFormat FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
          values: [target, table]
        });
        const record = Array.isArray(rows) ? rows[0] : void 0;
        if (record === void 0) throw new Error(`no such table: ${target}.${table}`);
        const type = String(record["type"] ?? "");
        const isView = type.toUpperCase().includes("VIEW");
        const engine = asString(record["engine"]);
        const collation = asString(record["collation"]);
        const comment = typeof record["comment"] === "string" ? record["comment"] : void 0;
        const rowFormat = asString(record["rowFormat"]);
        if (isView) return { isView: true };
        const charset = collation === void 0 ? void 0 : await this.collationCharset(collation);
        const autoIncrement = await this.autoIncrementFromCreate(target, table);
        return {
          ...engine === void 0 ? {} : { engine },
          ...collation === void 0 ? {} : { collation },
          ...charset === void 0 ? {} : { charset },
          ...comment === void 0 ? {} : { comment },
          ...autoIncrement === void 0 ? {} : { autoIncrement },
          ...rowFormat === void 0 ? {} : { rowFormat }
        };
      }
      /**
       * The character set one collation belongs to, from the server's own list.
       *
       * ABSENT rather than guessed when the server does not know the collation: a
       * collation added by a newer server than the cached list, or one belonging to a
       * character set the connection cannot see, would otherwise be paired with a
       * character set derived from its name — and a mismatched pair is a statement MySQL
       * rejects. The caller then simply offers the collation without a character set,
       * which the ALTER does not need.
       */
      async collationCharset(collation) {
        const [rows] = await (await this.open()).query({
          sql: "SELECT CHARACTER_SET_NAME AS charset FROM information_schema.COLLATIONS WHERE COLLATION_NAME = ?",
          values: [collation]
        });
        const record = Array.isArray(rows) ? rows[0] : void 0;
        return record === void 0 ? void 0 : asString(record["charset"]);
      }
      /**
       * The next AUTO_INCREMENT value, read from `SHOW CREATE TABLE`.
       *
       * Not from `information_schema.TABLES.AUTO_INCREMENT`, and the difference was
       * measured rather than assumed. After `ALTER TABLE t AUTO_INCREMENT=900` the next
       * insert really did receive id 900, while `information_schema.TABLES`, a fresh
       * `information_schema` connection and `SHOW TABLE STATUS` all still reported 4 —
       * InnoDB keeps the counter in memory and those two read the data dictionary's
       * stale copy. `SHOW CREATE TABLE` reported `AUTO_INCREMENT=900`, matching the id
       * the server actually issued. (This applies to InnoDB; MyISAM was also observed
       * reporting the stale 4.) A form that prefilled 4 would then "change" the value to
       * something the server had already passed.
       *
       * ABSENT when the table has no auto-increment column at all — `SHOW CREATE TABLE`
       * omits the clause — which is what lets the page hide the field instead of
       * offering a box whose value is not a thing.
       *
       * Parsed from the statement TAIL rather than by searching the whole text: a table
       * comment can contain the literal `AUTO_INCREMENT=` (measured: the option is
       * echoed into the comment verbatim), and the real clause is always after the column
       * list's closing bracket. The tail is found by the LAST `\n)` in the statement,
       * which is the format `SHOW CREATE TABLE` always produces.
       */
      async autoIncrementFromCreate(schema, table) {
        const text2 = await this.createStatement(schema, table);
        if (text2 === void 0) return void 0;
        const closing = text2.lastIndexOf("\n)");
        const tail = closing === -1 ? text2 : text2.slice(closing);
        const match = /(?:^|\s)AUTO_INCREMENT=(\d+)/.exec(tail);
        if (match === null) return void 0;
        const value = Number(match[1]);
        return Number.isFinite(value) ? value : void 0;
      }
      /**
       * Change an existing table's options.
       *
       * ONE `ALTER TABLE` carrying only the clauses the caller actually set, for two
       * reasons. MySQL applies several `ALTER` clauses in a single table rebuild, so
       * separate statements would rewrite the table once per option; and emitting only
       * what was asked for is what keeps an untouched field as the server has it, rather
       * than reverting a change made elsewhere since the page was opened.
       *
       * Every value is validated before it reaches the statement, because none of these
       * slots accepts a bound parameter: an engine name and a row format are keywords,
       * and the comment is a literal this layer escapes.
       */
      async alterTableOptions(schema, table, patch) {
        const target = this.requireSchema(schema);
        const qualified = qualifyMysql(target, table);
        const clauses = [];
        if (patch.engine !== void 0) {
          const engine = patch.engine.trim();
          if (!/^[A-Za-z0-9_]{1,32}$/.test(engine)) throw new Error(`invalid storage engine: ${JSON.stringify(patch.engine)}`);
          const available = await this.engines();
          if (!available.includes(engine.toUpperCase())) {
            throw new Error(`\u8FD9\u53F0 MySQL \u6CA1\u6709\u300C${engine}\u300D\u5B58\u50A8\u5F15\u64CE\uFF08\u53EF\u7528\uFF1A${available.join(", ")}\uFF09`);
          }
          clauses.push(`ENGINE=${engine}`);
        }
        if (patch.collation !== void 0) {
          const collation = requireCollate(patch.collation);
          const explicit = patch.charset === void 0 || patch.charset === "" ? void 0 : requireCharset(patch.charset);
          const charset = explicit ?? await this.collationCharset(collation);
          if (patch.convertColumns === true) {
            if (charset === void 0) {
              throw new Error(`\u670D\u52A1\u5668\u4E0D\u8BA4\u8BC6\u6392\u5E8F\u89C4\u5219\u300C${collation}\u300D\uFF0C\u65E0\u6CD5\u63A8\u65AD\u5B83\u5C5E\u4E8E\u54EA\u4E2A\u5B57\u7B26\u96C6\uFF0C\u56E0\u6B64\u4E0D\u80FD\u8F6C\u6362\u6210\u5B83`);
            }
            clauses.push(`CONVERT TO CHARACTER SET ${charset} COLLATE ${collation}`);
          } else if (charset === void 0) {
            clauses.push(`COLLATE=${collation}`);
          } else {
            clauses.push(`DEFAULT CHARACTER SET ${charset} COLLATE ${collation}`);
          }
        }
        if (patch.comment !== void 0) {
          if (patch.comment.includes("\\")) throw new Error("\u8868\u6CE8\u91CA\u4E0D\u80FD\u5305\u542B\u53CD\u659C\u6760\uFF08MySQL \u4F1A\u628A\u53CD\u659C\u6760\u5F53\u8F6C\u4E49\u7B26\uFF0C\u5199\u8FDB\u53BB\u7684\u548C\u8BFB\u51FA\u6765\u7684\u4E0D\u4E00\u81F4\uFF09");
          clauses.push(`COMMENT='${patch.comment.replace(/'/g, "''")}'`);
        }
        if (patch.autoIncrement !== void 0) {
          if (!Number.isInteger(patch.autoIncrement) || patch.autoIncrement < 1) {
            throw new Error(`AUTO_INCREMENT \u9700\u8981\u662F\u6B63\u6574\u6570\uFF1A${JSON.stringify(patch.autoIncrement)}`);
          }
          clauses.push(`AUTO_INCREMENT=${patch.autoIncrement}`);
        }
        if (patch.rowFormat !== void 0) {
          const format = patch.rowFormat.trim().toUpperCase();
          if (!["DEFAULT", "DYNAMIC", "FIXED", "COMPRESSED", "REDUNDANT", "COMPACT", "PAGE"].includes(format)) {
            throw new Error(`\u65E0\u6548\u7684\u884C\u683C\u5F0F\uFF1A${JSON.stringify(patch.rowFormat)}`);
          }
          clauses.push(`ROW_FORMAT=${format}`);
        }
        if (clauses.length === 0) throw new Error("\u6CA1\u6709\u9700\u8981\u4FEE\u6539\u7684\u8868\u9009\u9879");
        return this.exec(`ALTER TABLE ${qualified} ${clauses.join(", ")}`, [], target);
      }
      /** The storage engines this server can actually use, upper-cased. */
      async engines() {
        const [rows] = await (await this.open()).query({ sql: "SHOW ENGINES" });
        const list = Array.isArray(rows) ? rows : [];
        return list.map((row) => row).filter((row) => ["DEFAULT", "YES"].includes(String(row["Support"] ?? "").toUpperCase())).map((row) => String(row["Engine"] ?? "").toUpperCase()).filter((name2) => name2 !== "");
      }
      /**
       * Run several statements in order.
       *
       * MySQL's DDL is NOT transactional — every `CREATE`/`ALTER`/`DROP` commits
       * itself, and an implicit commit also ends any open transaction. So this
       * cannot promise the atomicity SQLite's script runner can, and it does not
       * pretend to: the statements run in order on ONE connection, and a failure
       * stops there with the earlier ones already applied.
       *
       * That is stated here rather than hidden, because it changes what a user
       * should expect from a failed import: the route reports how many statements
       * had run when it stopped, so the outcome is a known prefix rather than an
       * unknown state. The `START TRANSACTION` is still issued for the DML part of a
       * dump (the `INSERT`s), where it does work and is the common case for a
       * data-only import.
       */
      async runScript(statements, schema, onStatement) {
        const body = statements.filter((statement) => !isTransactionControl(statement));
        if (body.length === 0) return;
        const target = schema === void 0 || schema === "" ? void 0 : schema;
        if (target !== void 0) requireIdentifier(target, "schema name", quoteMysql);
        const pool = await this.open();
        const connection = await pool.getConnection();
        try {
          if (target !== void 0) await connection.query({ sql: `USE ${quoteMysql(target)}` });
          for (const [index, statement] of body.entries()) {
            await connection.query({ sql: statement });
            onStatement?.(index);
          }
        } finally {
          try {
            await connection.query({ sql: "USE `information_schema`" });
            connection.release();
          } catch {
            connection.destroy();
          }
        }
      }
      /**
       * Nothing, on purpose.
       *
       * MySQL's `SHOW CREATE TABLE` inlines every key and index as part of the
       * table's own definition (`KEY \`ix\` (\`v\`)` inside the statement), so a dump
       * that also emitted separate `CREATE INDEX` statements would try to create
       * them twice. Returning an empty list is the correct answer here, not an
       * unimplemented one.
       */
      async auxiliaryDdl() {
        return [];
      }
      /**
       * The table's own `CREATE TABLE` text, as MySQL stores it.
       *
       * `SHOW CREATE TABLE` is the authority rather than anything derived from
       * `information_schema`: it reflects the engine's own canonical form, including
       * the column types it widened, generated-column expressions, foreign keys,
       * partition clauses and table options that `information_schema` splits up or
       * omits. It is used verbatim by the exporter for exactly that reason.
       *
       * A view is a different statement, so the object's kind is decided first.
       * `information_schema.TABLES.TABLE_TYPE` answers it in one cheap read — the
       * earlier version asked `information_schema.VIEWS` for a `SQL_VIEW` column,
       * which does not exist on MySQL 8/9, making every export fail with
       * "Unknown column 'SQL_VIEW' in 'field list'".
       */
      async createStatement(schema, table) {
        const target = this.requireSchema(schema);
        requireIdentifier(table, "table name", quoteMysql);
        const [rows] = await (await this.open()).query({
          sql: "SELECT TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
          values: [target, table]
        });
        const record = Array.isArray(rows) ? rows[0] : void 0;
        if (record === void 0) return void 0;
        const isView = String(record["type"] ?? "").toUpperCase().includes("VIEW");
        const result = await this.exec(`SHOW CREATE ${isView ? "VIEW" : "TABLE"} ${qualifyMysql(target, table)}`, [], target);
        const text2 = result.rows[0]?.[1];
        return text2 === void 0 || text2 === null ? void 0 : String(text2);
      }
      /**
       * Every row of a table, capped at `limit`.
       *
       * Not paged: an export has to see all of them, and the caller sets the cap.
       * `mysql2`'s non-streaming query materialises the result, which is exactly
       * what the cap is for — the route refuses a table above the cap rather than
       * trying and running the host out of memory.
       */
      async allRows(schema, table, limit) {
        const target = this.requireSchema(schema);
        const cap = Math.max(1, Math.trunc(limit));
        const qualified = qualifyMysql(target, table);
        const [dataRows, fields] = await (await this.open()).query({ sql: `SELECT * FROM ${qualified} LIMIT ${cap + 1}` });
        const list = Array.isArray(dataRows) ? dataRows : [];
        const truncated = list.length > cap;
        const rows = truncated ? list.slice(0, cap) : list;
        const fieldList = Array.isArray(fields) ? fields : [];
        const columns = fieldList.length > 0 ? fieldList.map((field) => String(field.name ?? "")).filter((name2) => name2 !== "") : rows.length > 0 ? Object.keys(rows[0]) : (await this.columns(target, table)).map((column) => column.name);
        return { columns, rows: rows.map((row) => projectRow(row)), truncated };
      }
      /** Which tables each table references, from `information_schema`. */
      async tableReferences(schema) {
        const target = this.requireSchema(schema);
        const [rows] = await (await this.open()).query({
          sql: "SELECT TABLE_NAME AS name, REFERENCED_TABLE_NAME AS target FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL",
          values: [target]
        });
        const references = /* @__PURE__ */ new Map();
        if (!Array.isArray(rows)) return references;
        for (const row of rows) {
          const record = row;
          const name2 = String(record["name"] ?? "");
          const referenced = String(record["target"] ?? "");
          if (name2 === "" || referenced === "" || name2.toLowerCase() === referenced.toLowerCase()) continue;
          const key = name2.toLowerCase();
          const list = references.get(key) ?? [];
          if (!list.includes(referenced.toLowerCase())) list.push(referenced.toLowerCase());
          references.set(key, list);
        }
        return references;
      }
      /** Tables and views in one schema, names only — the export scope's list. */
      async tableNames(schema) {
        const target = this.requireSchema(schema);
        const [rows] = await (await this.open()).query({
          sql: "SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME",
          values: [target]
        });
        const list = Array.isArray(rows) ? rows : [];
        return list.map((row) => {
          const record = row;
          const type = String(record["type"] ?? "");
          return { name: String(record["name"] ?? ""), type: type.includes("VIEW") ? "view" : "table" };
        }).filter((entry) => entry.name !== "");
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
    BARE_DEFAULT_KEYWORDS = /^(?:current_timestamp|current_date|current_time|localtimestamp|localtime|now|utc_timestamp)(?:\(\d*\))?$/i;
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
var MAX_ELEMENTS, MAX_LEVEL_KEYS_RETURNED, MAX_SEARCH_KEYS, MAX_TREE_KEYS, INDEX_AGGREGATE_SCRIPT, TREE_SCAN_COUNT, TREE_PIPELINE_BATCH, MAX_DELETE_KEYS, DELETE_BATCH, DEFAULT_TIMEOUT_MS, MAX_RECONNECT_ATTEMPTS, RedisDriver, REDIS_READ_COMMANDS;
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
       * A level scan reads exactly one level, and reads it COMPLETELY. Its cost is one
       * pass over the keys under `prefix`, and only that level's immediate children
       * cross the wire, so a folder nobody opens is never read.
       *
       * The pass is inherently O(keys under the prefix) — Redis has no "list
       * distinct prefixes" command, so SCAN is the only way to discover sub-folders.
       * What is avoided is paying it per folder: the same pass yields both the
       * sub-folder set and each sub-folder's key count.
       *
       * Completeness is the point, not an accident: a partial pass reports lower-bound
       * counts and can miss a folder, which is what the deleted key budget used to do.
       * The size where a complete pass is too slow is where the cached keyspace index
       * takes over (see the module comment where the budget was removed).
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
        } while (cursor !== "0");
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
          // The only way a level can now be short is the ROW list being capped: the
          // scan covers the whole level, so the counts are exact and `keysAtLevel`
          // states what was withheld from the rows.
          truncated: keysAtLevel > shown.length,
          keysAtLevel,
          dbSize
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
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
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
function readSchemaObjects(db, schema, table) {
  const rows = db.prepare(
    `SELECT type, name, sql FROM ${quoteSqlite(schema)}.sqlite_master WHERE tbl_name = ? AND type IN ('index','trigger') AND name NOT LIKE 'sqlite_autoindex_%'`
  ).all(table);
  return rows.map((row) => ({
    type: String(row["type"] ?? ""),
    name: String(row["name"] ?? ""),
    sql: row["sql"] === null || row["sql"] === void 0 ? void 0 : String(row["sql"])
  }));
}
function readSequenceValue(db, table) {
  try {
    const row = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").get(table);
    if (row?.seq === void 0) return void 0;
    const value = Number(row.seq);
    return Number.isFinite(value) ? value : void 0;
  } catch {
    return void 0;
  }
}
function readPragmaFlag(db, name2) {
  try {
    const row = db.prepare(`PRAGMA ${name2}`).get();
    if (row === void 0) return void 0;
    const value = Object.values(row)[0];
    return Number(value) === 1;
  } catch {
    return void 0;
  }
}
function toDefinition(spec) {
  return {
    name: spec.name,
    // The caller's own casing is kept: it is what a user typed or what the
    // engine already had, and normalizing it would make a no-op edit改写 the
    // table's definition.
    type: spec.type,
    // A primary-key column is NOT NULL by definition; the caller's checkbox is
    // not allowed to say otherwise.
    nullable: spec.primaryKeyPosition === void 0 ? spec.nullable : false,
    // Passed through as given; `renderColumn` decides how to emit it, and it is the one
    // place that knows an expression default must bypass the literal validator. See its
    // comment — the short version is that SQLite rebuilds the whole table for every
    // change, so one expression default would otherwise break edits of every OTHER
    // column.
    ...spec.defaultValue === void 0 || spec.defaultValue === "" ? {} : { defaultValue: spec.defaultValue },
    ...spec.primaryKeyPosition === void 0 ? {} : { primaryKeyPosition: spec.primaryKeyPosition },
    ...spec.autoIncrement === true ? { autoIncrement: true, sqliteAutoincrement: true } : {},
    ...spec.unique === true ? { unique: true } : {},
    // A per-column collation. Carried into the definition, because `renderColumn` emits
    // it from there — without this the clause never reached the statement and the
    // column silently used the default collation.
    ...spec.collate === void 0 || spec.collate === "" ? {} : { collate: spec.collate },
    extras: []
  };
}
function assertConstraintsUsable(shape2) {
  const present = new Set(shape2.columns.map((column) => column.name.toLowerCase()));
  for (const constraint of shape2.constraints) {
    if (constraint.kind === "check") continue;
    const listMatch = /\(\s*([\s\S]*?)\s*\)/.exec(constraint.sql);
    if (listMatch === null) continue;
    for (const part of splitTopLevel(listMatch[1])) {
      const name2 = /^\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))/.exec(part);
      const value = name2?.[1] ?? name2?.[2] ?? name2?.[3] ?? name2?.[4];
      if (value === void 0) continue;
      if (!present.has(value.toLowerCase())) {
        throw new Error(`"${value}" is used by a table constraint (${constraint.sql}) and cannot be dropped`);
      }
      break;
    }
  }
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
function sqliteStringLiteral(path) {
  const normalized = path.replace(/\\/g, "/");
  if (/[\u0000-\u001f]/.test(normalized)) throw new Error("a database path cannot contain a control character");
  return `'${normalized.replace(/'/g, "''")}'`;
}
function sqliteSiblings(path) {
  return [`${path}-wal`, `${path}-shm`];
}
function renameWithSiblings(from, to) {
  renameSync(from, to);
  for (const [index, sibling] of sqliteSiblings(from).entries()) {
    if (!existsSync(sibling)) continue;
    try {
      renameSync(sibling, sqliteSiblings(to)[index]);
    } catch {
    }
  }
}
function dropWithSiblings(path) {
  for (const target of [path, ...sqliteSiblings(path)]) {
    try {
      rmSync(target, { force: true });
    } catch (error) {
      throw new Error(`\u65E0\u6CD5\u5220\u9664 ${target}\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
var REBUILD_SUFFIX, SqliteDriver;
var init_sqlite = __esm({
  "src/drivers/sqlite.ts"() {
    "use strict";
    init_dsh_home();
    init_sql_util();
    init_sql_schema();
    REBUILD_SUFFIX = "__dbm_rebuild";
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
      /**
       * Which maintenance operations SQLite supports.
       *
       * Measured:
       *   - `check`    → `PRAGMA integrity_check` (the whole file, not one table);
       *   - `optimize` → `VACUUM`, which compacts the file;
       *   - `analyze`  → `ANALYZE`, which fills `sqlite_stat1` — this is what makes row
       *                  counts appear in the table list, so it is worth offering;
       *   - `repair`   → NOTHING. SQLite has no `REPAIR` statement. It is absent from
       *                  this list rather than offered as a button that can only fail.
       */
      maintenanceSupport() {
        return ["check", "optimize", "analyze"];
      }
      /**
       * None of the three, and each for its own reason — all measured.
       *
       * SQLite's "database" is a file, so the two cross-database operations have nothing
       * to act on:
       *
       * - **`move`** — `ALTER TABLE … RENAME TO other.t` is a syntax error, and there is
       *   no other statement that relocates a table between attached schemas. So a table
       *   cannot be moved out of the file it lives in, and the only same-file "move" is a
       *   rename, which the outline below explains was deliberately NOT folded in here.
       * - **`copy`** — a copy inside the same file would have to reproduce the table with
       *   a new name, and SQLite has no statement for that either: `CREATE TABLE … AS
       *   SELECT` DROPS every constraint (measured: the copy came back with `id INT` and
       *   no primary key, no UNIQUE, no COLLATE, no generated column). A faithful copy
       *   would mean rebuilding from the parsed `CREATE` text and recreating every index
       *   and trigger under a new name — a second implementation of the rebuild path, for
       *   a copy the export dialog already provides.
       * - **`options`** — there is nothing to change. SQLite's table-level PRAGMAs
       *   (`auto_vacuum`, `page_size`) are FILE-level and must be set before the tables
       *   exist, and the only CREATE TABLE tail keywords (`WITHOUT ROWID`, `STRICT`) are
       *   part of the table's identity, not an option that can be altered afterwards.
       *
       * The 结构 tab still offers everything SQLite CAN do — add, alter, drop and rename
       * columns, change the primary key, manage indexes — so nothing here is a gap in
       * capability, only a gap in naming.
       */
      tableActionSupport() {
        return [];
      }
      /**
       * Run maintenance on the database.
       *
       * Two honest limitations, both stated rather than hidden:
       *
       * 1. **Some operations are per-DATABASE, not per-table.** `integrity_check` and
       *    `VACUUM` act on the whole file; only `ANALYZE` takes a table name. So a
       *    requested set of tables returns one result each but the message says the scope
       *    was the whole database — claiming a per-table repair would be a fiction.
       * 2. **`VACUUM` cannot run inside a transaction** (measured: "cannot VACUUM from
       *    within a transaction"), and the pool hands the same connection back, so it is
       *    issued on its own rather than through `runScript`.
       */
      async maintain(schema, tables, op) {
        const target = schema === void 0 || schema === "" ? "main" : schema;
        requireIdentifier(target, "schema name", quoteSqlite);
        if (tables.length === 0) throw new Error("maintenance needs at least one table");
        for (const table of tables) requireIdentifier(table, "table name", quoteSqlite);
        if (op === "check") {
          const rows = await this.run((db) => {
            const raw = db.prepare(`PRAGMA ${quoteSqlite(target)}.integrity_check`).all();
            return raw.map((row) => String(Object.values(row)[0] ?? ""));
          });
          const ok = rows.length === 1 && rows[0].toLowerCase() === "ok";
          const messages = ok ? [`${target}: ok\uFF08\u6574\u5E93\u68C0\u67E5\uFF0C\u975E\u5355\u8868\uFF09`] : rows.map((line) => `${target}: ${line}`);
          return tables.map(() => ({ op, ok, messages }));
        }
        if (op === "optimize") {
          await this.run((db) => {
            db.exec(`VACUUM ${quoteSqlite(target)}`);
          });
          return tables.map(() => ({ op, ok: true, messages: [`${target}: \u5DF2\u91CD\u6574\u6587\u4EF6\uFF08VACUUM\uFF0C\u4F5C\u7528\u4E8E\u6574\u5E93\uFF09`] }));
        }
        if (op === "analyze") {
          const results = [];
          for (const table of tables) {
            await this.run((db) => {
              db.exec(`ANALYZE ${quoteSqlite(target)}.${quoteSqlite(table)}`);
            });
            results.push({ op, ok: true, messages: [`${table}: \u5DF2\u66F4\u65B0\u7EDF\u8BA1\u4FE1\u606F\uFF08ANALYZE\uFF09`] });
          }
          return results;
        }
        throw new Error(
          `SQLite \u4E0D\u652F\u6301 ${op}\uFF1A\u5B83\u6CA1\u6709 REPAIR \u8BED\u53E5\u3002\u8868\u635F\u574F\u65F6\u7684\u505A\u6CD5\u662F\u4ECE\u5907\u4EFD\u6062\u590D\u3001\u6216\u628A\u6570\u636E\u5BFC\u51FA\u540E\u91CD\u5EFA\uFF1B\u53EF\u5148\u7528\u300C\u68C0\u67E5\u300D\u786E\u8BA4\u635F\u574F\u8303\u56F4\u3002`
        );
      }
      /**
       * Run one database-level operation.
       *
       * A SQLite "database" is a FILE, so the MySQL forms (CREATE / ALTER / DROP
       * DATABASE) have no equivalent and are not pretended:
       *
       *   - `create` — creates the file by opening it, which is what `DatabaseSync` does;
       *     a file with no tables is a valid empty database.
       *   - `drop`   — deletes the file together with its `-wal` and `-shm` siblings.
       *     Leaving those behind would make a "deleted" database reappear.
       *   - `rename` — renames the file, after closing the handle: renaming a file another
       *     handle has open is not portable, and the pool would hand back a connection to
       *     the old path.
       *   - `copy`   — `VACUUM INTO`, which produces a consistent COMPACTED copy rather
       *     than a byte clone that may have unmerged WAL pages.
       *   - `charset` — refused with the reason: SQLite is UTF-8 (or UTF-16 if compiled
       *     that way) for the file's whole lifetime, fixed at creation.
       */
      async databaseOperation(op, name2, options = {}) {
        const started = Date.now();
        void options;
        const file = this.entry.file;
        if (file === void 0 || file.trim() === "") throw new Error("this SQLite data source has no file configured");
        if (file === ":memory:") throw new Error("an in-memory SQLite database has no file to operate on");
        if (op === "charset") {
          throw new Error(
            "SQLite \u6CA1\u6709\u53EF\u4FEE\u6539\u7684\u5E93\u7F16\u7801\uFF1A\u6574\u4E2A\u5E93\u56FA\u5B9A\u4E3A UTF-8\uFF08\u6216\u7F16\u8BD1\u671F\u9009\u5B9A\u7684 UTF-16\uFF09\uFF0CPRAGMA encoding \u5728\u5E93\u521B\u5EFA\u65F6\u786E\u5B9A\u540E\u4E0D\u53EF\u66F4\u6539\u3002"
          );
        }
        if (op === "create") {
          await this.open();
          return { columns: [], rows: [], affected: 1, durationMs: Date.now() - started, write: true, truncated: false };
        }
        const sourcePath = resolveSqliteFile(file);
        if (op === "copy") {
          const targetPath = resolveSqliteFile(name2);
          if (existsSync(targetPath)) throw new Error(`\u76EE\u6807\u6587\u4EF6\u5DF2\u5B58\u5728\uFF1A${targetPath}`);
          this.closeHandle();
          await this.run((db) => {
            db.exec(`VACUUM INTO ${sqliteStringLiteral(targetPath)}`);
          });
          return { columns: [], rows: [], affected: 1, durationMs: Date.now() - started, write: true, truncated: false };
        }
        if (op === "rename") {
          const targetPath = resolveSqliteFile(name2);
          if (existsSync(targetPath)) throw new Error(`\u76EE\u6807\u6587\u4EF6\u5DF2\u5B58\u5728\uFF1A${targetPath}`);
          this.closeHandle();
          renameWithSiblings(sourcePath, targetPath);
          return { columns: [], rows: [], affected: 1, durationMs: Date.now() - started, write: true, truncated: false };
        }
        if (op === "drop") {
          this.closeHandle();
          dropWithSiblings(sourcePath);
          return { columns: [], rows: [], affected: 1, durationMs: Date.now() - started, write: true, truncated: false };
        }
        throw new Error(`unsupported database operation: ${op}`);
      }
      /** Close and forget the open handle, so a file operation can proceed. */
      closeHandle() {
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
          const rows = db.prepare(`PRAGMA ${quoteSqlite(target)}.table_xinfo(${quoteSqlite(table)})`).all();
          return rows.filter((row) => Number(row["hidden"] ?? 0) !== 1).map((row) => {
            const name2 = String(row["name"] ?? "");
            const pk = Number(row["pk"] ?? 0);
            const hidden = Number(row["hidden"] ?? 0);
            return {
              name: name2,
              type: String(row["type"] ?? ""),
              nullable: Number(row["notnull"] ?? 0) === 0,
              ...row["dflt_value"] === null || row["dflt_value"] === void 0 ? {} : { defaultValue: String(row["dflt_value"]) },
              key: pk > 0 ? "PRI" : "",
              extra: "",
              ...pk > 0 ? { primaryKeyPosition: pk } : {},
              ...hidden === 2 || hidden === 3 ? { generated: true } : {}
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
            const origin = String(entry["origin"] ?? "");
            return {
              name: name2,
              unique: Number(entry["unique"] ?? 0) === 1,
              columns,
              type: origin,
              // `origin = 'pk'` is the primary key's own index. It cannot be dropped
              // on its own — dropping it means dropping the key — so the flag has to
              // reach the browser.
              ...origin === "pk" ? { primary: true } : {}
            };
          });
        });
      }
      async rows(query) {
        const schema = query.schema === void 0 || query.schema === "" ? "main" : query.schema;
        const columns = await this.columns(schema, query.table);
        if (columns.length === 0) throw new Error(`no such table: ${query.table}`);
        const known = new Set(columns.map((column) => column.name.toLowerCase()));
        const qualified = qualifySqlite(schema === "main" ? void 0 : schema, query.table);
        const { where, params } = this.buildFilter(query, columns.map((column) => column.name), known);
        const order = this.buildOrder(query, columns);
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
      /**
       * The ORDER BY clause for one read.
       *
       * Three shapes, in precedence order: an explicit column list (the 按索引排序
       * control), a single column (a header click), or nothing. Every column is
       * checked against the table's own list, so a stale browser cannot order by a
       * column that has since been renamed away.
       */
      buildOrder(query, columns) {
        const byName = new Map(columns.map((column) => [column.name.toLowerCase(), column.name]));
        const direction = query.orderDir === "desc" ? "DESC" : "ASC";
        if (query.orderByColumns !== void 0 && query.orderByColumns.length > 0) {
          const resolved2 = query.orderByColumns.map((name2) => byName.get(name2.toLowerCase()));
          if (resolved2.some((name2) => name2 === void 0)) return "";
          return ` ORDER BY ${resolved2.map((name2) => `${quoteSqlite(name2)} ${direction}`).join(", ")}`;
        }
        if (query.orderBy === void 0) return "";
        const resolved = byName.get(query.orderBy.toLowerCase());
        if (resolved === void 0) return "";
        return ` ORDER BY ${quoteSqlite(resolved)} ${direction}`;
      }
      /** Build the WHERE clause and its bound parameters for a table read. */
      buildFilter(query, allColumns, known) {
        if (query.filters !== void 0 && query.filters.length > 0) {
          return buildSearchWhere(query.filters, query.filterJoin === "or" ? "or" : "and", quoteSqlite, known, "sqlite");
        }
        if (query.mode === "search") {
          const term = query.term ?? "";
          if (term === "") return { where: "", params: [] };
          const pattern = `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
          const clauses = allColumns.map((column) => `CAST(${quoteSqlite(column)} AS TEXT) LIKE ? ${likeEscapeClause("sqlite")}`);
          return { where: ` WHERE (${clauses.join(" OR ")})`, params: allColumns.map(() => pattern) };
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
      /**
       * Insert several rows in one transaction.
       *
       * One transaction, not one autocommit per row: a 10 000-row CSV import would
       * otherwise fsync 10 000 times, and a failure halfway would leave the table
       * holding an unknown prefix of the file with no way to tell how much landed.
       * Either every row is in or none is.
       *
       * Rows are NOT required to name the same columns. They used to be, and the
       * 插入 tab's phpMyAdmin-shaped forms are what made that wrong: each form is
       * filled in on its own, so leaving a column blank in one row and supplying it in
       * another is the ordinary case rather than a mistake. Measured: two such forms
       * made the batch answer 500 "every row in one insert must name the same
       * columns", which is a refusal of the feature as designed. Each row is therefore
       * its own statement — the same shape `deleteRows` already uses — and rows that
       * DO agree still share one multi-row statement, which is the CSV import's cheap
       * path.
       */
      async insertRows(schema, table, rows) {
        if (rows.length === 0) throw new Error("insert requires at least one row");
        const qualified = qualifySqlite(schema, table);
        const started = Date.now();
        return this.run((db) => {
          let affected = 0;
          db.exec("BEGIN");
          try {
            for (const group of groupSameColumns(rows)) {
              const names = group[0].map((item) => requireIdentifier(item.column, "column name", quoteSqlite)).join(", ");
              const placeholders = group[0].map(() => "?").join(", ");
              if (group.length === 1) {
                const statement2 = db.prepare(`INSERT INTO ${qualified} (${names}) VALUES (${placeholders})`);
                affected += Number(statement2.run(...group[0].map((item) => item.value)).changes ?? 0);
                continue;
              }
              const sql = `INSERT INTO ${qualified} (${names}) VALUES ${group.map(() => `(${placeholders})`).join(", ")}`;
              const statement = db.prepare(sql);
              affected += Number(statement.run(...group.flatMap((row) => row.map((item) => item.value))).changes ?? 0);
            }
            db.exec("COMMIT");
          } catch (error) {
            try {
              db.exec("ROLLBACK");
            } catch {
            }
            throw error;
          }
          return {
            columns: [],
            rows: [],
            affected,
            durationMs: Date.now() - started,
            write: true,
            truncated: false
          };
        });
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
       * Delete several rows in one transaction.
       *
       * One `DELETE … WHERE key` per key set rather than a single statement with an
       * `IN` list: a key may be composite, and a composite key cannot be expressed
       * as an `IN` over one column. `@`-style row values are not needed either,
       * since SQLite's rowid tables have a real rowid to fall back on but a
       * `WITHOUT ROWID` table does not — so the key columns are what identifies a
       * row, always.
       */
      async deleteRows(schema, table, keySets) {
        if (keySets.length === 0) throw new Error("delete requires at least one row key");
        const qualified = qualifySqlite(schema, table);
        const started = Date.now();
        return this.run((db) => {
          let affected = 0;
          db.exec("BEGIN");
          try {
            for (const keys of keySets) {
              if (keys.length === 0) throw new Error("delete requires a row key");
              const where = keys.map((item) => `${requireIdentifier(item.column, "column name", quoteSqlite)} IS ?`).join(" AND ");
              const statement = db.prepare(`DELETE FROM ${qualified} WHERE ${where}`);
              affected += Number(statement.run(...keys.map((item) => item.value)).changes ?? 0);
            }
            db.exec("COMMIT");
          } catch (error) {
            try {
              db.exec("ROLLBACK");
            } catch {
            }
            throw error;
          }
          return {
            columns: [],
            rows: [],
            affected,
            durationMs: Date.now() - started,
            write: true,
            truncated: false
          };
        });
      }
      /** How many distinct non-NULL values a column holds. */
      async distinctCount(schema, table, column) {
        const qualified = qualifySqlite(schema, table);
        const quoted = requireIdentifier(column, "column name", quoteSqlite);
        const result = await this.run((db) => {
          const row = db.prepare(`SELECT COUNT(DISTINCT ${quoted}) AS n FROM ${qualified}`).get();
          return Number(row?.n ?? 0);
        });
        return result;
      }
      // ---- schema editing ----------------------------------------------------
      /**
       * Add a column.
       *
       * ADD COLUMN is one of the few schema changes SQLite does natively, so it is
       * used directly rather than through a rebuild — a rebuild of a large table
       * copies every row, and there is no reason to pay that for an appended
       * column.
       *
       * SQLite's own restrictions apply and are reported as they are: a new column
       * cannot be UNIQUE or PRIMARY KEY, and a NOT NULL column needs a non-NULL
       * default.
       */
      /**
       * Create a table from a column list.
       *
       * Built as a {@link TableShape} and rendered by `renderCreateTable` — the same
       * renderer a rebuild and a dump use — rather than by string assembly here. That
       * keeps one place responsible for how a table is spelled, which matters because
       * SQLite's own quirks (the `INTEGER PRIMARY KEY` rowid alias, `AUTOINCREMENT` being
       * legal only there) live in that renderer.
       *
       * A single-column key is emitted INLINE so it can carry `AUTOINCREMENT`, which
       * SQLite only accepts on an inline `INTEGER PRIMARY KEY`; a composite key has no
       * inline form and goes in as a table constraint. That is the renderer's decision,
       * reached by giving it the key positions.
       */
      async createTable(schema, table, columns, options = {}) {
        const qualified = qualifySqlite(schema, table);
        if (columns.length === 0) throw new Error("a new table needs at least one column");
        for (const spec of columns) {
          const attributes = spec.attributes ?? [];
          if (attributes.length > 0) {
            throw new Error(`SQLite \u4E0D\u652F\u6301\u5217\u5C5E\u6027 ${attributes.join(", ")}\uFF1A\u5B83\u4F1A\u628A\u8FD9\u4E9B\u8BCD\u5E76\u5165\u7C7B\u578B\u540D\u800C\u4E0D\u4EA7\u751F\u4EFB\u4F55\u6548\u679C`);
          }
          if (spec.charset !== void 0 && spec.charset !== "") {
            throw new Error("SQLite \u6CA1\u6709\u5217\u7EA7\u5B57\u7B26\u96C6\uFF0C\u53EA\u6709\u5217\u7EA7\u6392\u5E8F\u89C4\u5219\uFF08COLLATE\uFF09");
          }
          if (spec.length !== void 0 && spec.length.trim() !== "") {
            throw new Error(`SQLite \u4E0D\u652F\u6301\u957F\u5EA6/\u503C\uFF08\u5217 ${spec.name}\uFF09\uFF1A\u5B83\u4F1A\u4FDD\u7559\u5728\u7C7B\u578B\u540D\u91CC\u4F46\u6CA1\u6709\u4EFB\u4F55\u7EA6\u675F\u529B\u3002\u8BF7\u628A\u957F\u5EA6\u76F4\u63A5\u5199\u8FDB\u7C7B\u578B\uFF0C\u5982 VARCHAR(20)`);
          }
          if (spec.comment !== void 0 && spec.comment !== "") {
            throw new Error("SQLite \u4E0D\u652F\u6301\u5217\u6CE8\u91CA\uFF1A\u5B83\u6CA1\u6709\u5B58\u50A8\u6CE8\u91CA\u7684\u5730\u65B9");
          }
        }
        const tableOptions = options.table ?? {};
        if (tableOptions.engine !== void 0 && tableOptions.engine.trim() !== "") {
          throw new Error("SQLite \u6CA1\u6709\u5B58\u50A8\u5F15\u64CE\u53EF\u9009");
        }
        if (tableOptions.comment !== void 0 && tableOptions.comment !== "") {
          throw new Error("SQLite \u6CA1\u6709\u8868\u6CE8\u91CA\uFF1A\u5B83\u6CA1\u6709\u5B58\u50A8\u8868\u6CE8\u91CA\u7684\u5730\u65B9");
        }
        if (tableOptions.collate !== void 0 && tableOptions.collate.trim() !== "") {
          throw new Error("SQLite \u6CA1\u6709\u8868\u7EA7\u6392\u5E8F\u89C4\u5219\uFF0C\u6392\u5E8F\u89C4\u5219\u53EA\u80FD\u9010\u5217\u6307\u5B9A");
        }
        const tail = tableOptions.tail === void 0 ? "" : tableOptions.tail.trim();
        if (tail !== "" && !/^(WITHOUT ROWID|STRICT|,\s*)+$/i.test(tail) && !/^(WITHOUT ROWID|STRICT)(\s*,\s*(WITHOUT ROWID|STRICT))*$/i.test(tail)) {
          throw new Error(`invalid table keyword: ${JSON.stringify(tableOptions.tail)}`);
        }
        const key = options.primaryKey ?? [];
        const names = new Set(columns.map((spec) => spec.name));
        for (const name2 of key) {
          if (!names.has(name2)) throw new Error(`the primary key names a column that is not being created: ${name2}`);
        }
        if (names.size !== columns.length) throw new Error("two of the new columns have the same name");
        const autoColumns = columns.filter((spec) => spec.autoIncrement === true);
        if (autoColumns.length > 1) {
          throw new Error(`only one column can AUTOINCREMENT on SQLite (it has a single rowid); ${autoColumns.length} were requested (${autoColumns.map((spec) => spec.name).join(", ")})`);
        }
        const autoColumn = autoColumns[0];
        if (autoColumn !== void 0) {
          if (key.length !== 1 || key[0] !== autoColumn.name) {
            throw new Error(
              `SQLite \u7684\u81EA\u589E\u8981\u6C42\u300C${autoColumn.name}\u300D\u5C31\u662F\u8BE5\u8868\u7684\u552F\u4E00\u4E3B\u952E\uFF08rowid \u522B\u540D\uFF09\uFF1A\u590D\u5408\u4E3B\u952E\u6CA1\u6709 rowid \u522B\u540D\uFF0C\u56E0\u6B64\u590D\u5408\u4E3B\u952E\u4E0B\u7684\u81EA\u589E\u65E0\u6CD5\u5B9E\u73B0`
            );
          }
        }
        for (const index of options.indexes ?? []) {
          if (index.kind === "primary") {
            if (key.length > 0) throw new Error("the primary key was given twice");
            continue;
          }
          if (index.columns.length === 0) throw new Error(`the ${index.kind} index needs at least one column`);
          for (const name2 of index.columns) {
            if (!names.has(name2)) throw new Error(`the ${index.kind} index names a column that is not being created: ${name2}`);
          }
          if (index.kind === "fulltext") throw new Error("SQLite \u6CA1\u6709 FULLTEXT \u7D22\u5F15\uFF08\u9700 FTS5 \u865A\u62DF\u8868\uFF0C\u90A3\u662F\u53E6\u4E00\u79CD\u5BF9\u8C61\uFF0C\u4E0D\u662F\u666E\u901A\u8868\u4E0A\u7684\u7D22\u5F15\uFF09");
          if (index.kind === "spatial") throw new Error("SQLite \u6CA1\u6709 SPATIAL \u7D22\u5F15\uFF08\u9700 R*Tree \u6269\u5C55\u6A21\u5757\uFF09");
        }
        const definitions = columns.map((spec) => {
          const definition = toDefinition(spec);
          const keyPosition = key.indexOf(spec.name);
          if (keyPosition === -1) return definition;
          return { ...definition, primaryKeyPosition: keyPosition + 1 };
        });
        const constraints = [];
        if (key.length > 1) {
          constraints.push({
            sql: `PRIMARY KEY (${key.map((name2) => requireIdentifier(name2, "column name", quoteSqlite)).join(", ")})`,
            kind: "primary"
          });
        }
        const shape2 = {
          name: table,
          ifNotExists: false,
          columns: definitions,
          // A composite key needs a table-level constraint; the renderer puts a
          // single-column key inline and ignores this one, so it is only added when it is
          // the form that will actually be used.
          constraints,
          tail
        };
        await this.exec(renderCreateTable(shape2, "sqlite"), [], schema);
        let created = 0;
        for (const index of options.indexes ?? []) {
          if (index.kind === "primary") continue;
          const indexName = index.name === void 0 || index.name.trim() === "" ? `${index.kind === "unique" ? "uq" : "ix"}_${table}_${index.columns.join("_")}` : index.name.trim();
          const columnsSql = index.columns.map((name2) => requireIdentifier(name2, "column name", quoteSqlite)).join(", ");
          const unique = index.kind === "unique" ? "UNIQUE " : "";
          try {
            await this.exec(
              `CREATE ${unique}INDEX ${requireIdentifier(indexName, "index name", quoteSqlite)} ON ${qualifySqlite(schema, table)} (${columnsSql})`,
              [],
              schema
            );
            created++;
          } catch (failure) {
            throw new Error(
              `\u8868\u5DF2\u521B\u5EFA\uFF0C\u4F46\u521B\u5EFA\u7D22\u5F15\u300C${indexName}\u300D\u5931\u8D25\uFF1A${failure instanceof Error ? failure.message : String(failure)}`
            );
          }
        }
        return { columns: [], rows: [], affected: 1 + created, durationMs: 0, write: true, truncated: false };
      }
      async addColumn(schema, table, spec) {
        const qualified = qualifySqlite(schema, table);
        if (spec.positionAfter !== void 0) {
          throw new Error("SQLite \u7684 ADD COLUMN \u53EA\u80FD\u628A\u65B0\u5217\u52A0\u5728\u6700\u540E\uFF0C\u4E0D\u652F\u6301\u6307\u5B9A\u4F4D\u7F6E\uFF08AFTER / FIRST\uFF09");
        }
        const definition = renderColumn(toDefinition(spec), "sqlite");
        if (spec.primaryKeyPosition !== void 0) {
          throw new Error("SQLite cannot add a PRIMARY KEY column with ALTER TABLE; set the key on an existing column instead");
        }
        return this.exec(`ALTER TABLE ${qualified} ADD COLUMN ${definition}`, [], schema);
      }
      /**
       * Change an existing column.
       *
       * Changing a name alone is native (`ALTER TABLE … RENAME COLUMN`); changing
       * the declared type, the nullability, the default or the primary key is not,
       * and goes through {@link rebuildTable}. The two are not interchangeable:
       * RENAME COLUMN updates every reference to the column in the schema, whereas
       * a rebuild recreates the table and would need those references rebuilt too,
       * so the cheap native path is taken whenever it is sufficient.
       */
      async alterColumn(schema, table, spec, options = {}) {
        const target = schema === void 0 || schema === "" ? "main" : schema;
        const shape2 = await this.readShape(target, table);
        const index = shape2.columns.findIndex((column) => column.name === spec.name);
        if (index === -1) throw new Error(`no such column: ${spec.name}`);
        const current = shape2.columns[index];
        const next = toDefinition(spec);
        const expressionForm = (value) => (value ?? "").trim().replace(/^\(|\)$/g, "");
        const isExpression = (value) => {
          const text2 = (value ?? "").trim();
          return text2 !== "" && !text2.startsWith("'") && /[(]/.test(text2);
        };
        const sameDefault = isExpression(next.defaultValue) || isExpression(current.defaultValue) ? expressionForm(next.defaultValue) === expressionForm(current.defaultValue) : normalizeDefault(next.defaultValue, "sqlite") === normalizeDefault(current.defaultValue, "sqlite");
        renderColumn(next, "sqlite");
        const newName = options.rename ?? spec.name;
        const onlyRenamed = newName !== spec.name && normalizeType(next.type, "sqlite") === normalizeType(current.type, "sqlite") && next.nullable === current.nullable && next.unique === current.unique && current.primaryKeyPosition === void 0 && sameDefault;
        if (onlyRenamed) {
          const qualified = qualifySqlite(schema, table);
          return this.exec(
            `ALTER TABLE ${qualified} RENAME COLUMN ${identifier(spec.name, "column name", "sqlite")} TO ${identifier(newName, "column name", "sqlite")}`,
            [],
            schema
          );
        }
        const edited = {
          ...next,
          name: newName,
          extras: current.extras,
          ...current.check === void 0 ? {} : { check: current.check },
          ...current.generated === true ? { generated: true } : {}
        };
        shape2.columns[index] = edited;
        return this.rebuildTable(target, table, shape2);
      }
      /** Drop a column, by rebuilding the table (SQLite has no native form here). */
      async dropColumn(schema, table, column) {
        const target = schema === void 0 || schema === "" ? "main" : schema;
        const shape2 = await this.readShape(target, table);
        const index = shape2.columns.findIndex((candidate) => candidate.name === column);
        if (index === -1) throw new Error(`no such column: ${column}`);
        const remaining = shape2.columns.filter((_, position) => position !== index);
        if (remaining.length === 0) throw new Error("a table must keep at least one column");
        shape2.columns = remaining;
        assertConstraintsUsable(shape2);
        return this.rebuildTable(target, table, shape2);
      }
      /** Replace the table's primary key, by rebuilding it. */
      async setPrimaryKey(schema, table, columns) {
        const target = schema === void 0 || schema === "" ? "main" : schema;
        const shape2 = await this.readShape(target, table);
        setPrimaryKey(shape2, columns, "sqlite");
        return this.rebuildTable(target, table, shape2);
      }
      /** Create an index on one or more existing columns. */
      async createIndex(schema, table, spec) {
        if (spec.columns.length === 0) throw new Error("an index needs at least one column");
        const target = schema === void 0 || schema === "" ? "main" : schema;
        const columns = await this.columns(target, table);
        const known = new Map(columns.map((column) => [column.name.toLowerCase(), column.name]));
        const resolved = spec.columns.map((name3) => {
          const found = known.get(name3.toLowerCase());
          if (found === void 0) throw new Error(`no such column: ${name3}`);
          return found;
        });
        const name2 = requireIdentifier(spec.name, "index name", quoteSqlite);
        const qualified = qualifySqlite(schema, table);
        const suffix = target === "main" ? "" : ` ON ${quoteSqlite(target)}`;
        void suffix;
        return this.exec(
          `CREATE ${spec.unique ? "UNIQUE " : ""}INDEX ${name2} ON ${qualified} (${resolved.map((column) => quoteSqlite(column)).join(", ")})`,
          [],
          schema
        );
      }
      /**
       * Drop an index.
       *
       * Refuses SQLite's implicit `sqlite_autoindex_*`: it exists only because a
       * UNIQUE or PRIMARY KEY constraint asked for it, and `DROP INDEX` on it is
       * either an error or — worse — silently leaves the constraint without its
       * index. Dropping the constraint is the way to remove it, which the 结构 tab
       * offers separately.
       */
      async dropIndex(schema, table, name2) {
        if (name2.startsWith("sqlite_autoindex_")) {
          throw new Error("this index belongs to a PRIMARY KEY or UNIQUE constraint; drop the constraint instead of the index");
        }
        const target = schema === void 0 || schema === "" ? "main" : schema;
        requireIdentifier(name2, "index name", quoteSqlite);
        return this.exec(`DROP INDEX ${quoteSqlite(target)}.${quoteSqlite(name2)}`, [], schema);
      }
      /**
       * Rename a table inside its own schema.
       *
       * A SQLite database IS a file, so `move` here can only mean "the same file, a
       * different name" — measured: `ALTER TABLE t RENAME TO aux.t` is a syntax error
       * ("near \".\": syntax error"), and there is no statement that relocates a table
       * between attached schemas, so a genuine cross-database move is refused with that
       * reason rather than attempted.
       *
       * The rename itself is SQLite's native one, and its reference-rewriting is wanted
       * here: since 3.25 `ALTER TABLE … RENAME TO` also updates the references in views,
       * triggers and foreign keys, which is exactly what a rename should do. (The 结构
       * tab's rebuild path has to work AROUND that behaviour — see {@link rebuildTable} —
       * but a rename is the case it was designed for.)
       *
       * A VIEW is refused with the engine's own reason: `ALTER TABLE v RENAME TO w` on a
       * view fails with "view v may not be altered", because a view's name is fixed by
       * its `CREATE VIEW` statement and SQLite offers no rename for one.
       */
      async moveTable(schema, table, target) {
        const from = schema === void 0 || schema === "" ? "main" : schema;
        requireIdentifier(from, "schema name", quoteSqlite);
        requireIdentifier(target.schema, "schema name", quoteSqlite);
        const next = requireIdentifier(target.table, "table name", quoteSqlite);
        if (from !== target.schema) {
          throw new Error(
            `SQLite \u7684\u5E93\u5C31\u662F\u4E00\u4E2A\u6587\u4EF6\uFF0C\u8868\u4E0D\u80FD\u79FB\u52A8\u5230\u53E6\u4E00\u4E2A\u5E93\uFF1A\u300C${target.schema}\u300D\u5982\u679C\u662F\u53E6\u4E00\u4E2A .db \u6587\u4EF6\uFF0C\u9700\u8981\u628A\u8868\u5BFC\u51FA\u6210 SQL \u518D\u5BFC\u5165\u8FC7\u53BB\u3002\u6B64\u5904\u53EA\u80FD\u5728\u540C\u4E00\u5E93\u5185\u6539\u540D\u3002`
          );
        }
        if (table === target.table) throw new Error("the source and the target are the same table");
        requireIdentifier(table, "table name", quoteSqlite);
        const objects = await this.tableNames(from);
        const moving = objects.find((entry) => entry.name === table);
        if (moving === void 0) throw new Error(`no such table: ${table}`);
        if (moving.type === "view") {
          throw new Error(`\u300C${table}\u300D\u662F\u89C6\u56FE\uFF1ASQLite \u4E0D\u5141\u8BB8\u91CD\u547D\u540D\u89C6\u56FE\uFF08\u5F15\u64CE\u539F\u6587 "view ${table} may not be altered"\uFF09\u3002\u8BF7\u5220\u9664\u540E\u6309\u65B0\u7684\u540D\u5B57\u91CD\u5EFA\u3002`);
        }
        if (objects.some((entry) => entry.name.toLowerCase() === target.table.toLowerCase())) {
          throw new Error(`\u5E93\u91CC\u5DF2\u5B58\u5728\u300C${target.table}\u300D`);
        }
        return this.exec(`ALTER TABLE ${qualifySqlite(schema, table)} RENAME TO ${next}`, [], schema);
      }
      /**
       * Refused, with the reason, rather than half-implemented.
       *
       * The two statements that could copy a table inside one file both lose something
       * that matters, and neither can be papered over:
       *
       * - **`CREATE TABLE new AS SELECT * FROM old`** copies only the column VALUES'
       *   shape. Measured: the copy came back with `id INT` — no PRIMARY KEY, no
       *   UNIQUE, no COLLATE, no generated column, no DEFAULT — and no indexes at all.
       *   A copy that silently drops a table's constraints is worse than no copy.
       * - **Re-creating from the parsed `CREATE` text** would be faithful, but every
       *   index and trigger would then have to be recreated under a new name, and
       *   SQLite's index names are GLOBAL to the schema (measured: recreating
       *   `ix_t_v` on the copy fails with "index ix_t_v already exists"), so each one
       *   needs a generated name — a second implementation of the rebuild path whose
       *   only difference from the export/import dialog is convenience.
       *
       * @throws always.
       */
      async copyTable() {
        throw new Error(
          "SQLite \u6CA1\u6709\u590D\u5236\u8868\u7684\u8BED\u53E5\uFF1ACREATE TABLE \u2026 AS SELECT \u4F1A\u4E22\u6389\u4E3B\u952E\u3001\u552F\u4E00\u7EA6\u675F\u3001\u9ED8\u8BA4\u503C\u4E0E\u751F\u6210\u5217\uFF08\u5B9E\u6D4B\u590D\u5236\u54C1\u53EA\u6709\u5217\u540D\u548C\u7C7B\u578B\uFF09\uFF0C\u800C\u6309 CREATE \u6587\u672C\u91CD\u5EFA\u53C8\u8981\u7ED9\u6BCF\u4E2A\u7D22\u5F15\u548C\u89E6\u53D1\u5668\u53E6\u8D77\u540D\u5B57\uFF08\u7D22\u5F15\u540D\u5728\u5E93\u5185\u5168\u5C40\u552F\u4E00\uFF09\u3002\u8BF7\u5728\u300C\u5BFC\u51FA\u300D\u91CC\u5BFC\u51FA\u8BE5\u8868\uFF0C\u518D\u300C\u5BFC\u5165\u300D\u6210\u65B0\u8868\u3002"
        );
      }
      /**
       * What SQLite reports as a table's options: an object kind, and nothing else.
       *
       * There is no storage engine (one is compiled in), no table-level collation (it is
       * per column), no table comment (nowhere to store one) and no AUTO_INCREMENT
       * counter separate from the rowid — so an "options" form on SQLite would be a form
       * of empty fields. The 表选项 page says this instead of offering them; see
       * {@link tableActionSupport}.
       */
      async tableOptionInfo(schema, table) {
        const target = schema === void 0 || schema === "" ? "main" : schema;
        requireIdentifier(table, "table name", quoteSqlite);
        const objects = await this.tableNames(target);
        const found = objects.find((entry) => entry.name === table);
        if (found === void 0) throw new Error(`no such table: ${table}`);
        return { isView: found.type === "view" };
      }
      /**
       * Refused: SQLite has no table option that can be changed after the fact.
       *
       * The two candidates are not options in this sense. `auto_vacuum`, `page_size` and
       * friends are FILE-level PRAGMAs, and `page_size` must be set before the database
       * has any tables; `WITHOUT ROWID` and `STRICT` are part of the table's identity —
       * changing either means rebuilding the table, which the 结构 tab does for the
       * column changes that need it.
       *
       * @throws always.
       */
      async alterTableOptions() {
        throw new Error(
          "SQLite \u6CA1\u6709\u53EF\u4FEE\u6539\u7684\u8868\u9009\u9879\uFF1A\u6CA1\u6709\u5B58\u50A8\u5F15\u64CE\u3001\u6CA1\u6709\u8868\u7EA7\u6392\u5E8F\u89C4\u5219\u3001\u6CA1\u6709\u8868\u6CE8\u91CA\u7684\u5B58\u653E\u5904\uFF1Bauto_vacuum / page_size \u662F\u6574\u5E93\u7684 PRAGMA\uFF08page_size \u8FD8\u5FC5\u987B\u5728\u5EFA\u8868\u524D\u8BBE\u7F6E\uFF09\uFF0CWITHOUT ROWID / STRICT \u5C5E\u4E8E\u8868\u672C\u8EAB\u7684\u7ED3\u6784\uFF0C\u6539\u52A8\u7B49\u4E8E\u91CD\u5EFA\u8868\u3002"
        );
      }
      /**
       * Read and parse one table's `CREATE TABLE` statement.
       *
       * The statement text — not `PRAGMA table_info` — is the source for a rebuild,
       * because `table_info` omits CHECK constraints, foreign keys, COLLATE clauses
       * and the `WITHOUT ROWID` / `STRICT` keywords. A rebuild driven by it would
       * quietly drop all of them.
       */
      async readShape(schema, table) {
        requireIdentifier(table, "table name", quoteSqlite);
        const sql = await this.run((db) => {
          const row = db.prepare(`SELECT sql FROM ${quoteSqlite(schema)}.sqlite_master WHERE type = 'table' AND name = ?`).get(table);
          return row?.sql === void 0 || row.sql === null ? void 0 : String(row.sql);
        });
        if (sql === void 0) throw new Error(`no such table: ${table}`);
        return parseCreateTable(sql, "sqlite");
      }
      /**
       * Rebuild one table from an edited shape, inside a single transaction.
       *
       * This is SQLite's documented 12-step procedure. Four details are load
       * bearing, and each was reproduced in a probe before being written down:
       *
       * 1. **The replacement is created under a NEW name and the ORIGINAL is
       *    dropped, rather than renaming the original aside.** Renaming the original
       *    first is the tempting order, but the `DROP TABLE` then fails with
       *    "FOREIGN KEY constraint failed" whenever another table references it —
       *    the reference was rewritten to follow the rename and now dangles.
       *    Creating the replacement first and dropping the original keeps every
       *    reference pointing at the name being replaced.
       *
       * 2. **`legacy_alter_table` is ON for the duration.** With it off (the default
       *    since 3.25) `ALTER TABLE … RENAME TO` rewrites every reference to the
       *    renamed table — including the foreign keys and views of OTHER tables,
       *    which would be repointed at the temporary name. Worse, the rewrite makes
       *    the rename itself fail with "error in view …: no such table", leaving the
       *    database unusable in the same transaction. With it on, the rename only
       *    changes the table's own name.
       *
       * 3. **`foreign_keys` is turned OFF OUTSIDE the transaction.** SQLite
       *    SILENTLY IGNORES this pragma inside a transaction — measured: setting it
       *    after `BEGIN` left `PRAGMA foreign_keys` reading 1. Both pragmas are
       *    therefore applied before `BEGIN` and restored in a `finally`, to the
       *    value the connection already had (a user may legitimately run with them
       *    off). The pool hands this same connection back, so leaving either pragma
       *    changed would alter the behaviour of everything that runs afterwards.
       *
       * 4. **Indexes and triggers are recreated from their original SQL, and the
       *    `sqlite_sequence` row is restored.** A table's indexes and triggers are
       *    dropped along with it, so a rebuild that recreated only the table would
       *    silently remove every index and trigger on it. `AUTOINCREMENT`'s
       *    high-water mark lives in `sqlite_sequence` and would otherwise reset to
       *    the largest id still present — handing out the ids of deleted rows again.
       */
      async rebuildTable(schema, table, shape2) {
        requireIdentifier(table, "table name", quoteSqlite);
        const temporary = `${table}${REBUILD_SUFFIX}`;
        if (table.endsWith(REBUILD_SUFFIX)) throw new Error(`cannot rebuild a table whose name ends with ${REBUILD_SUFFIX}`);
        const started = Date.now();
        return this.run((db) => {
          const existing = db.prepare(`SELECT name FROM ${quoteSqlite(schema)}.sqlite_master WHERE name = ?`).get(temporary);
          if (existing !== void 0) {
            throw new Error(`"${temporary}" already exists; rename or drop it before changing this table`);
          }
          const before = readSchemaObjects(db, schema, table);
          const sequence = readSequenceValue(db, table);
          const hadForeignKeys = readPragmaFlag(db, "foreign_keys");
          const hadLegacyAlter = readPragmaFlag(db, "legacy_alter_table");
          if (hadForeignKeys === true) db.exec("PRAGMA foreign_keys = OFF");
          if (hadLegacyAlter !== true) db.exec("PRAGMA legacy_alter_table = ON");
          let inTransaction = false;
          try {
            db.exec("BEGIN");
            inTransaction = true;
            db.exec(renderCreateTable(shape2, "sqlite", { name: temporary }));
            if (shape2.columns.length > 0) {
              const source = shape2.columns.filter((column) => column.generated !== true);
              if (source.length > 0) {
                const names = source.map((column) => quoteSqlite(column.name)).join(", ");
                db.exec(`INSERT INTO ${quoteSqlite(temporary)} (${names}) SELECT ${names} FROM ${quoteSqlite(table)}`);
              }
            }
            db.exec(`DROP TABLE ${quoteSqlite(table)}`);
            db.exec(`ALTER TABLE ${quoteSqlite(temporary)} RENAME TO ${quoteSqlite(table)}`);
            for (const object of before) {
              if (object.sql === void 0) continue;
              db.exec(object.sql);
            }
            if (sequence !== void 0) {
              db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(table);
              db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(table, Math.trunc(sequence));
            }
            db.exec("COMMIT");
            inTransaction = false;
          } catch (error) {
            if (inTransaction) {
              try {
                db.exec("ROLLBACK");
              } catch {
              }
            }
            throw error;
          } finally {
            try {
              if (hadForeignKeys === true) db.exec("PRAGMA foreign_keys = ON");
              if (hadLegacyAlter !== true) db.exec("PRAGMA legacy_alter_table = OFF");
            } catch {
            }
          }
          return {
            columns: [],
            rows: [],
            affected: 0,
            durationMs: Date.now() - started,
            write: true,
            truncated: false
          };
        });
      }
      /**
       * Run several statements as one transaction.
       *
       * A script's own `BEGIN`/`COMMIT` is neutralized rather than rejected: a dump
       * this plugin wrote wraps itself in them, and SQLite treats a nested `BEGIN`
       * as an error while a stray `COMMIT` would end the wrapper's transaction early
       * and defeat the whole point. Both are dropped, and the wrapper owns the
       * transaction — which is what makes "all or nothing" true for a foreign dump
       * as well as the plugin's own.
       */
      async runScript(statements, schema, onStatement) {
        const body = statements.filter((statement) => !isTransactionControl(statement));
        if (body.length === 0) return;
        for (const statement of body) assertSingleStatement(statement);
        return this.run((db) => {
          db.exec("BEGIN");
          try {
            for (const [index, statement] of body.entries()) {
              db.exec(statement);
              onStatement?.(index);
            }
            db.exec("COMMIT");
          } catch (error) {
            try {
              db.exec("ROLLBACK");
            } catch {
            }
            throw error;
          }
        });
      }
      /**
       * The `CREATE INDEX` / `CREATE TRIGGER` statements a table owns.
       *
       * Needed because SQLite's `CREATE TABLE` text does not mention them: a dump
       * built from that text alone would lose every index and trigger on the table.
       * `sqlite_master` is the only place an expression index or a trigger body
       * exists, so the text is read from there and used verbatim.
       *
       * Order matters: index_before_trigger, so a trigger that references an index
       * finds it. `sqlite_autoindex_*` rows are skipped — they have no SQL and are
       * recreated by the `CREATE TABLE` itself.
       */
      async auxiliaryDdl(schema, table) {
        const target = schema === void 0 || schema === "" ? "main" : schema;
        requireIdentifier(target, "schema name", quoteSqlite);
        requireIdentifier(table, "table name", quoteSqlite);
        return this.run((db) => {
          const rows = db.prepare(
            `SELECT type, sql FROM ${quoteSqlite(target)}.sqlite_master WHERE tbl_name = ? AND type IN ('index','trigger') AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY CASE type WHEN 'index' THEN 0 ELSE 1 END, name`
          ).all(table);
          return rows.map((row) => row["sql"] === null || row["sql"] === void 0 ? "" : String(row["sql"]).trim()).filter((sql) => sql !== "").map((sql) => sql.endsWith(";") ? sql : `${sql};`);
        });
      }
      /** The `CREATE TABLE` text SQLite recorded, or undefined for a view. */
      async createStatement(schema, table) {
        const target = schema === void 0 || schema === "" ? "main" : schema;
        requireIdentifier(target, "schema name", quoteSqlite);
        requireIdentifier(table, "table name", quoteSqlite);
        return this.run((db) => {
          const row = db.prepare(`SELECT sql FROM ${quoteSqlite(target)}.sqlite_master WHERE type = 'table' AND name = ?`).get(table);
          return row?.sql === void 0 || row.sql === null ? void 0 : String(row.sql);
        });
      }
      /**
       * Every row of a table, capped at `limit`.
       *
       * `SELECT *` with no ORDER BY: an export of a table with no primary key has
       * no stable order to impose, and paying for a sort of the whole table to
       * produce a different arbitrary order would be worse than not paying.
       */
      async allRows(schema, table, limit) {
        const cap = Math.max(1, Math.trunc(limit));
        const qualified = qualifySqlite(schema, table);
        return this.run((db) => {
          const statement = db.prepare(`SELECT * FROM ${qualified} LIMIT ?`);
          const raw = statement.all(cap + 1);
          const truncated = raw.length > cap;
          const rows = truncated ? raw.slice(0, cap) : raw;
          const columns = rows.length > 0 ? Object.keys(rows[0]) : this.columnNames(db, schema, table);
          return { columns, rows: rows.map((row) => projectRow2(row)), truncated };
        });
      }
      /** The column names of a table, for an export with no rows to read them from. */
      columnNames(db, schema, table) {
        const target = schema === void 0 || schema === "" ? "main" : schema;
        const rows = db.prepare(`PRAGMA ${quoteSqlite(target)}.table_xinfo(${quoteSqlite(table)})`).all();
        return rows.filter((row) => Number(row["hidden"] ?? 0) !== 1).map((row) => String(row["name"] ?? ""));
      }
      /** Which tables each table references, from its own foreign-key clauses. */
      async tableReferences(schema) {
        const target = schema === void 0 || schema === "" ? "main" : schema;
        requireIdentifier(target, "schema name", quoteSqlite);
        return this.run((db) => {
          const names = db.prepare(`SELECT name FROM ${quoteSqlite(target)}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all();
          const references = /* @__PURE__ */ new Map();
          for (const row of names) {
            const name2 = String(row["name"] ?? "");
            if (name2 === "") continue;
            const list = db.prepare(`PRAGMA ${quoteSqlite(target)}.foreign_key_list(${quoteSqlite(name2)})`).all();
            const targets = /* @__PURE__ */ new Set();
            for (const entry of list) {
              const table = entry["table"];
              if (typeof table === "string" && table !== "" && table.toLowerCase() !== name2.toLowerCase()) targets.add(table.toLowerCase());
            }
            if (targets.size > 0) references.set(name2.toLowerCase(), [...targets]);
          }
          return references;
        });
      }
      /** Tables and views in one schema, names only — the export scope's list. */
      async tableNames(schema) {
        const target = schema === void 0 || schema === "" ? "main" : schema;
        requireIdentifier(target, "schema name", quoteSqlite);
        return this.run((db) => {
          const rows = db.prepare(
            `SELECT name, type FROM ${quoteSqlite(target)}.sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name`
          ).all();
          return rows.filter((row) => typeof row["name"] === "string").map((row) => ({ name: String(row["name"]), type: row["type"] === "view" ? "view" : "table" }));
        });
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
init_protocol();
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync, renameSync as renameSync2, writeFileSync } from "node:fs";
import { dirname as dirname2, join as join2, resolve as resolve2 } from "node:path";
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
    renameSync2(tmp, this.path);
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

// src/routes.ts
init_protocol();
init_types();
init_types();
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
      if (index.folders.size >= INDEX_MAX_FOLDERS) {
        index.error = `this database has more than ${INDEX_MAX_FOLDERS.toLocaleString()} distinct folders, which is beyond what the keyspace index is built to hold. Browse it with a filter, or use the per-level scan on a narrower folder.`;
        index.done = false;
        return index;
      }
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
  if (index.error !== void 0) return { progress: indexProgress(index), done: false };
  index.cursor = batch.cursor;
  index.done = batch.cursor === "0";
  return { progress: indexProgress(index), done: index.done };
}

// src/routes.ts
init_redis_util();
init_sql_util();

// src/sql-transfer.ts
init_types();

// src/sql-dump.ts
function sqliteLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : `'${String(value)}'`;
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${value.replace(/'/g, "''")}'`;
}
function mysqlLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : `'${String(value)}'`;
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}
function dumpInserts(table, dialect, rowsPerStatement = 100, insertable) {
  const columns = (insertable ?? table.columns).filter((column) => table.columns.includes(column));
  if (table.rows.length === 0 || columns.length === 0) return [];
  const names = columns.map((column) => dialect.quote(column)).join(", ");
  const terminator = dialect.statementEnd.endsWith("\n") ? dialect.statementEnd.trimEnd() : dialect.statementEnd;
  const statements = [];
  for (let at = 0; at < table.rows.length; at += rowsPerStatement) {
    const chunk = table.rows.slice(at, at + rowsPerStatement);
    const tuples = chunk.map((row) => `(${columns.map((column) => dialect.literal(row[column] ?? null)).join(", ")})`).join(",\n");
    statements.push(`INSERT INTO ${dialect.quote(table.name)} (${names}) VALUES
${tuples}${terminator}`);
  }
  return statements;
}
function dumpTable(table, dialect, options) {
  const parts = [];
  if (options.structure) {
    parts.push(`--
-- \u8868\u7ED3\u6784\uFF1A${table.name}
--`);
    if (options.drop || dialect.dropBeforeCreate === true) parts.push(`DROP TABLE IF EXISTS ${dialect.quote(table.name)}${dialect.statementEnd}`);
    if (table.create !== void 0 && table.create.trim() !== "") {
      parts.push(`${table.create.replace(/;*\s*$/, "")}${dialect.statementEnd}`);
    } else {
      parts.push(`-- \uFF08\u672A\u53D6\u5F97 ${table.name} \u7684\u5EFA\u8868\u8BED\u53E5\uFF0C\u5DF2\u8DF3\u8FC7\u7ED3\u6784\uFF09`);
    }
    for (const statement of table.auxiliary ?? []) {
      parts.push(statement.endsWith(";") ? statement : `${statement}${dialect.statementEnd}`);
    }
  }
  if (options.data) {
    if (table.rows.length > 0) {
      parts.push(`--
-- \u8868\u6570\u636E\uFF1A${table.name}${table.truncated === true ? "\uFF08\u5DF2\u6309\u5BFC\u51FA\u4E0A\u9650\u622A\u65AD\uFF09" : ""}
--`);
      const insertable = table.generated === void 0 || table.generated.length === 0 ? table.columns : table.columns.filter((column) => !table.generated.includes(column));
      if (insertable.length === 0) {
        parts.push(`-- \uFF08${table.name} \u7684\u5217\u5168\u90E8\u7531\u6570\u636E\u5E93\u8BA1\u7B97\uFF0C\u6CA1\u6709\u53EF\u5199\u5165\u7684\u6570\u636E\uFF09`);
      } else {
        if (insertable.length !== table.columns.length) {
          parts.push(`-- \u751F\u6210\u5217\uFF08\u7531\u6570\u636E\u5E93\u8BA1\u7B97\uFF0C\u5BFC\u5165\u65F6\u81EA\u52A8\u5F97\u51FA\uFF09\uFF1A${table.columns.filter((column) => !insertable.includes(column)).join(", ")}`);
        }
        parts.push(...dumpInserts(table, dialect, options.rowsPerStatement ?? 100, insertable));
      }
    } else {
      parts.push(`--
-- \u8868\u6570\u636E\uFF1A${table.name}\uFF08\u65E0\u884C\uFF09
--`);
    }
  }
  return parts.join("\n");
}
function dumpDatabase(tables, dialect, options, comment) {
  const lines = [`-- ${comment}`, `-- \u5BFC\u51FA\u65F6\u95F4\uFF1A${(/* @__PURE__ */ new Date()).toISOString()}`];
  if (options.drop && options.data) {
    lines.push("-- \u6CE8\u610F\uFF1A\u672C\u6587\u4EF6\u5305\u542B DROP TABLE\uFF0C\u5BFC\u5165\u5230\u5DF2\u6709\u6570\u636E\u5E93\u4F1A\u5148\u5220\u9664\u540C\u540D\u8868\u3002");
  }
  if (dialect.header !== void 0) lines.push(...dialect.header);
  const body = tables.map((table) => dumpTable(table, dialect, options));
  return `${lines.join("\n")}

${body.join("\n\n")}
`;
}
function csvLooksLikeFormula(text2) {
  return /^[=+\-@\t]/.test(text2);
}
function csvCell(value) {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : `"${String(value)}"`;
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return csvLooksLikeFormula(value) ? `"${value}"` : value;
}
function toCsv(columns, rows) {
  const lines = [columns.map((column) => csvCell(column)).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column] ?? null)).join(","));
  return `${lines.join("\r\n")}\r
`;
}
function parseCsv(text2) {
  const withoutBom = text2.charCodeAt(0) === 65279 ? text2.slice(1) : text2;
  const rows = [];
  let record = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const n = withoutBom.length;
  while (i < n) {
    const ch = withoutBom[i];
    if (quoted) {
      if (ch === '"') {
        if (withoutBom[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
      continue;
    }
    if (ch === ",") {
      record.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      record.push(field);
      field = "";
      rows.push(record);
      record = [];
      i += ch === "\r" && withoutBom[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    rows.push(record);
  }
  return rows;
}
function parseCsvTable(text2, options) {
  const records = parseCsv(text2);
  if (records.length === 0) throw new Error("the file contains no rows");
  let columns;
  let body;
  if (options.hasHeader) {
    const header = records[0].map((name2) => name2.trim());
    if (header.length === 0) throw new Error("the header line is empty");
    if (header.some((name2) => name2 === "")) throw new Error("the header line has an empty column name");
    const seen = /* @__PURE__ */ new Set();
    for (const name2 of header) {
      if (seen.has(name2)) throw new Error(`the header names "${name2}" twice`);
      seen.add(name2);
    }
    columns = header;
    body = records.slice(1);
  } else {
    const expected = options.expected;
    if (expected === void 0 || expected.length === 0) {
      throw new Error("this file has no header, so the target table must already be known");
    }
    columns = expected;
    body = records;
  }
  const rows = [];
  const malformed = [];
  for (const [index, record] of body.entries()) {
    if (record.length !== columns.length) {
      malformed.push({ line: options.hasHeader ? index + 2 : index + 1, fields: record.length });
      continue;
    }
    const row = {};
    for (const [position, column] of columns.entries()) row[column] = record[position] ?? "";
    rows.push(row);
  }
  return { columns, rows, malformed };
}

// src/sql-transfer.ts
init_sql_util();
function orderTables(tables, references) {
  const byName = new Map(tables.map((table) => [table.name.toLowerCase(), table]));
  const visited = /* @__PURE__ */ new Set();
  const ordered = [];
  const active = /* @__PURE__ */ new Set();
  const visit = (table) => {
    const key = table.name.toLowerCase();
    if (visited.has(key)) return;
    visited.add(key);
    if (!active.has(key)) {
      active.add(key);
      for (const dependency of references.get(key) ?? []) {
        const target = byName.get(dependency.toLowerCase());
        if (target !== void 0) visit(target);
      }
      active.delete(key);
    }
    ordered.push(table);
  };
  for (const table of tables) if (table.type !== "view") visit(table);
  for (const table of tables) if (table.type === "view") visit(table);
  return ordered;
}
var EXPORT_ROW_CAP = 2e5;
var IMPORT_BYTE_CAP = 32 * 1024 * 1024;
function dialectFor(kind) {
  if (kind === "mysql") {
    return {
      quote: quoteMysql,
      literal: mysqlLiteral,
      statementEnd: ";",
      header: [
        // A schema being restored may be a subset of the original (one table
        // exported, or a cycle between two), so referential checks are off for
        // the replay and turned back on at the end. Without this a dump of a
        // child table alone cannot be imported at all.
        "SET FOREIGN_KEY_CHECKS=0;",
        "/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;",
        "/*!40101 SET NAMES utf8mb4 */;"
      ]
    };
  }
  return {
    quote: quoteSqlite,
    literal: sqliteLiteral,
    statementEnd: ";",
    header: [
      // Same reason as MySQL's above, and here it is load-bearing: SQLite
      // IGNORES `PRAGMA foreign_keys` inside a transaction, so it has to be
      // issued before the importer opens one — which the header, being the
      // first thing in the file, achieves.
      "PRAGMA foreign_keys=OFF;"
    ]
  };
}
function trailerFor(kind) {
  return kind === "sqlite" ? ["PRAGMA foreign_keys=ON;"] : ["SET FOREIGN_KEY_CHECKS=1;"];
}
async function readTable(driver, schema, name2, includeData) {
  const create = await driver.createStatement(schema, name2);
  const auxiliary = await driver.auxiliaryDdl(schema, name2);
  const shared = { name: name2, ...create === void 0 ? {} : { create }, ...auxiliary.length === 0 ? {} : { auxiliary } };
  if (!includeData) return { ...shared, columns: [], rows: [] };
  const data = await driver.allRows(schema, name2, EXPORT_ROW_CAP);
  const generated = (await driver.columns(schema, name2)).filter((column) => column.generated === true).map((column) => column.name);
  return {
    ...shared,
    columns: data.columns,
    ...generated.length === 0 ? {} : { generated },
    rows: data.rows,
    ...data.truncated ? { truncated: true } : {}
  };
}
function safeName(text2) {
  return text2.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "export";
}
async function exportSql(driver, entry, request) {
  if (!isSqlDriver(driver)) throw new Error("export is only available for SQL data sources");
  const kind = driver.kind;
  const dialect = dialectFor(kind);
  const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const scope = request.schema ?? (kind === "sqlite" ? "main" : "");
  if (request.format === "csv") {
    if (request.tables !== void 0 && request.tables.length > 1) {
      throw new Error("a CSV export names exactly one table; choose SQL for several");
    }
    const table = request.tables?.[0];
    if (table === void 0 || table === "") throw new Error("a CSV export names exactly one table");
    const data = await driver.allRows(request.schema, table, EXPORT_ROW_CAP);
    return {
      filename: `${safeName(entry.name)}-${safeName(table)}-${stamp}.csv`,
      contentType: "text/csv; charset=utf-8",
      // A BOM, because Excel on Windows reads a BOM-less UTF-8 CSV as the local
      // code page and shows every non-ASCII character as mojibake.
      text: `\uFEFF${toCsv(data.columns, data.rows)}`,
      truncated: data.truncated ? [table] : []
    };
  }
  const names = request.tables !== void 0 && request.tables.length > 0 ? request.tables.map((name2) => ({ name: name2, type: "table" })) : await driver.tableNames(request.schema);
  if (names.length === 0) throw new Error("this schema has no tables to export");
  const ordered = names.length > 1 ? orderTables(names, await driver.tableReferences(request.schema)) : names;
  const options = {
    structure: request.includeStructure,
    data: request.includeData,
    drop: request.drop
  };
  const tables = [];
  const truncated = [];
  for (const item of ordered) {
    const wantData = request.includeData && item.type !== "view";
    const table = await readTable(driver, request.schema, item.name, wantData);
    if (table.truncated === true) truncated.push(item.name);
    tables.push(table);
  }
  const header = dumpDatabase(tables, dialect, options, `dsh-database-manager \u5BFC\u51FA \xB7 ${entry.name}${scope === "" ? "" : ` / ${scope}`}`);
  const trailer = trailerFor(kind).join("\n");
  return {
    filename: `${safeName(entry.name)}${scope === "" ? "" : `-${safeName(scope)}`}-${stamp}.sql`,
    contentType: "application/sql; charset=utf-8",
    text: trailer === "" ? header : `${header}
${trailer}
`,
    truncated
  };
}
function splitSqlScript(sql) {
  if (/^\s*DELIMITER\b/im.test(sql)) {
    throw new Error("this file uses DELIMITER, which this importer does not support; remove the DELIMITER lines and the matching statement terminators");
  }
  const statements = [];
  let current = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-" && (sql[i + 2] === void 0 || /\s/.test(sql[i + 2]))) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (ch === "#") {
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
      let j = i + 1;
      while (j < n) {
        if (quote === "'" && sql[j] === "\\") {
          j += 2;
          continue;
        }
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed !== "") statements.push(trimmed);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  const tail = current.trim();
  if (tail !== "") statements.push(tail);
  return statements;
}
async function importSql(driver, request) {
  if (!isSqlDriver(driver)) throw new Error("import is only available for SQL data sources");
  const bytes = Buffer.byteLength(request.content, "utf8");
  if (bytes > IMPORT_BYTE_CAP) {
    throw new Error(`the file is ${Math.round(bytes / 1024 / 1024)} MiB, above the ${IMPORT_BYTE_CAP / 1024 / 1024} MiB import limit`);
  }
  if (request.format === "csv") {
    const table = request.table;
    if (table === void 0 || table === "") throw new Error("a CSV import needs a target table");
    if (!/^[A-Za-z0-9_$][A-Za-z0-9_$ -]*$/.test(table)) throw new Error(`invalid table name: ${JSON.stringify(table)}`);
    const existing = await driver.columns(request.schema, table);
    const known = new Map(existing.map((column) => [column.name.toLowerCase(), column.name]));
    const parsed = parseCsvTable(request.content, {
      hasHeader: request.hasHeader !== false,
      expected: existing.filter((column) => column.generated !== true).map((column) => column.name)
    });
    const mapping = [];
    for (const name2 of parsed.columns) {
      const column = known.get(name2.toLowerCase());
      if (column === void 0) throw new Error(`the file's column "${name2}" does not exist in ${table}`);
      const info = existing.find((candidate) => candidate.name === column);
      if (info.generated === true) throw new Error(`column "${column}" is generated and cannot be imported into`);
      mapping.push({ file: name2, column });
    }
    if (mapping.length === 0) throw new Error("the file names no columns");
    const emptyAsNull = request.emptyAsNull !== false;
    const rows = parsed.rows.map(
      (row) => mapping.map((entry) => ({
        column: entry.column,
        // An empty CSV field is ambiguous by nature. Empty-as-NULL is the
        // default because a dump of a NULL is written as an empty field, so
        // this is the direction that round-trips; the caller can turn it off
        // when the table legitimately holds empty strings.
        value: emptyAsNull && row[entry.file] === "" ? null : row[entry.file] ?? ""
      }))
    );
    if (rows.length === 0) {
      return { statements: 0, rows: 0, skipped: parsed.malformed };
    }
    const result = await driver.insertRows(request.schema, table, rows);
    return { statements: 1, rows: result.affected, skipped: parsed.malformed };
  }
  const statements = splitSqlScript(request.content);
  if (statements.length === 0) throw new Error("the file contains no SQL statements");
  let executed = 0;
  await driver.runScript(statements, request.schema, () => {
    executed++;
  });
  return { statements: executed, rows: 0, skipped: [], total: statements.length };
}

// src/routes.ts
var DEFAULT_PAGE_SIZE = 200;
var MAX_PAGE_SIZE = 5e3;
var DEFAULT_SQL_LIMIT = 1e3;
var DEFAULT_KEY_COUNT = 200;
var MAX_BATCH_ROWS = 5e3;
var MAX_BATCH_TABLES = 500;
var IMPORT_BODY_MAX_BYTES = IMPORT_BYTE_CAP + 1024 * 1024;
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
function parseFilters(value) {
  if (!Array.isArray(value)) throw new Error("must be an array of conditions");
  if (value.length > 50) throw new Error("too many conditions (max 50)");
  return value.map((entry, index) => {
    const record = asJsonObject(entry);
    if (record === void 0) throw new Error(`[${index}] must be an object`);
    const column = record["column"];
    if (typeof column !== "string" || column === "") throw new Error(`[${index}].column must be a non-empty string`);
    const operator = record["operator"];
    if (typeof operator !== "string" || !ROW_FILTER_OPERATORS.includes(operator)) {
      throw new Error(`[${index}].operator must be one of ${ROW_FILTER_OPERATORS.join(", ")}`);
    }
    const read = (name2) => {
      const raw = record[name2];
      if (raw === void 0 || raw === null) return void 0;
      if (typeof raw === "string") return raw;
      if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
      throw new Error(`[${index}].${name2} must be a scalar`);
    };
    return {
      column,
      operator,
      ...read("value") === void 0 ? {} : { value: read("value") },
      ...read("value2") === void 0 ? {} : { value2: read("value2") }
    };
  });
}
function readSchema(body) {
  return typeof body["schema"] === "string" && body["schema"] !== "" ? body["schema"] : void 0;
}
function readSchemaFrom(url) {
  return queryParam(url, "schema");
}
function readTableName(body) {
  const table = body["table"];
  if (typeof table !== "string" || table === "") return { error: "table is required" };
  return { table };
}
function readTableTarget(body) {
  const raw = asJsonObject(body["target"]);
  if (raw === void 0) return { error: "target must be an object with a schema and a table" };
  const schema = raw["schema"];
  if (typeof schema !== "string" || schema === "") return { error: "target.schema is required" };
  const table = raw["table"];
  if (typeof table !== "string" || table === "") return { error: "target.table is required" };
  return { target: { schema, table } };
}
function parseTableOptionPatch(body) {
  const patch = {};
  const readText = (key, into) => {
    const value = body[key];
    if (value === void 0) return void 0;
    if (typeof value !== "string") return `${key} must be a string`;
    into(value);
    return void 0;
  };
  for (const key of ["engine", "collation", "charset", "comment", "rowFormat"]) {
    const problem = readText(key, (value) => {
      patch[key] = value;
    });
    if (problem !== void 0) return { error: problem };
  }
  if (body["autoIncrement"] !== void 0) {
    const value = body["autoIncrement"];
    if (typeof value !== "number" || !Number.isInteger(value)) return { error: "autoIncrement must be an integer" };
    patch.autoIncrement = value;
  }
  if (body["convertColumns"] !== void 0) {
    if (typeof body["convertColumns"] !== "boolean") return { error: "convertColumns must be a boolean" };
    patch.convertColumns = body["convertColumns"];
  }
  return { patch };
}
function readColumnSpec(value, what) {
  const record = asJsonObject(value);
  if (record === void 0) throw new Error(`${what} must be an object`);
  const name2 = record["name"];
  if (typeof name2 !== "string" || name2 === "") throw new Error(`${what}.name must be a non-empty string`);
  const type = typeof record["type"] === "string" ? record["type"] : "";
  const nullable = record["nullable"] === true;
  const defaultValue = typeof record["defaultValue"] === "string" ? record["defaultValue"] : void 0;
  const comment = typeof record["comment"] === "string" ? record["comment"] : void 0;
  const length = typeof record["length"] === "string" && record["length"].trim() !== "" ? record["length"].trim() : void 0;
  const collate = typeof record["collate"] === "string" && record["collate"].trim() !== "" ? record["collate"].trim() : void 0;
  const charset = typeof record["charset"] === "string" && record["charset"].trim() !== "" ? record["charset"].trim() : void 0;
  let attributes;
  if (record["attributes"] !== void 0) {
    const raw = record["attributes"];
    if (!Array.isArray(raw)) throw new Error(`${what}.attributes must be an array when present`);
    const collected = [];
    for (const entry of raw) {
      if (typeof entry !== "string" || !COLUMN_ATTRIBUTES.includes(entry)) {
        throw new Error(`${what}.attributes entries must be one of ${COLUMN_ATTRIBUTES.join(", ")}`);
      }
      collected.push(entry);
    }
    if (collected.length > 0) attributes = collected;
  }
  let primaryKeyPosition;
  if (record["primaryKeyPosition"] !== void 0 && record["primaryKeyPosition"] !== null) {
    if (typeof record["primaryKeyPosition"] !== "number" || !Number.isInteger(record["primaryKeyPosition"]) || record["primaryKeyPosition"] < 1) {
      throw new Error(`${what}.primaryKeyPosition must be a positive integer`);
    }
    primaryKeyPosition = record["primaryKeyPosition"];
  }
  const positionAfter = typeof record["positionAfter"] === "string" && record["positionAfter"] !== "" ? record["positionAfter"] : void 0;
  return {
    name: name2,
    type,
    nullable,
    ...defaultValue === void 0 ? {} : { defaultValue },
    ...comment === void 0 ? {} : { comment },
    ...primaryKeyPosition === void 0 ? {} : { primaryKeyPosition },
    ...record["autoIncrement"] === true ? { autoIncrement: true } : {},
    ...record["unique"] === true ? { unique: true } : {},
    ...length === void 0 ? {} : { length },
    ...collate === void 0 ? {} : { collate },
    ...charset === void 0 ? {} : { charset },
    ...attributes === void 0 ? {} : { attributes },
    ...positionAfter === void 0 ? {} : { positionAfter }
  };
}
function parseSchemaChange(body) {
  try {
    const table = body["table"];
    if (typeof table !== "string" || table === "") return { error: "table is required" };
    const schema = typeof body["schema"] === "string" && body["schema"] !== "" ? body["schema"] : void 0;
    const action = body["action"];
    if (typeof action !== "string") return { error: "action is required" };
    const base = { action, table, ...schema === void 0 ? {} : { schema } };
    switch (action) {
      case "createTable": {
        const columns = body["specs"];
        if (!Array.isArray(columns) || columns.length === 0) {
          return { error: "specs must be a non-empty array of column specs for createTable" };
        }
        const specs = [];
        for (const [index, entry] of columns.entries()) {
          specs.push(readColumnSpec(entry, `columns[${index}]`));
        }
        const primaryKey = body["primaryKey"];
        if (primaryKey !== void 0 && (!Array.isArray(primaryKey) || primaryKey.some((entry) => typeof entry !== "string" || entry === ""))) {
          return { error: "primaryKey must be an array of column names when present" };
        }
        const indexesBody = body["indexes"];
        const indexes = [];
        if (indexesBody !== void 0) {
          if (!Array.isArray(indexesBody)) return { error: "indexes must be an array when present" };
          for (const [index, entry] of indexesBody.entries()) {
            const item = asJsonObject(entry);
            if (item === void 0) return { error: `indexes[${index}] must be an object` };
            const kind = item["kind"];
            if (typeof kind !== "string" || !INDEX_KINDS.includes(kind)) {
              return { error: `indexes[${index}].kind must be one of ${INDEX_KINDS.join(", ")}` };
            }
            const columns2 = item["columns"];
            if (!Array.isArray(columns2) || columns2.length === 0 || columns2.some((value) => typeof value !== "string" || value === "")) {
              return { error: `indexes[${index}].columns must be a non-empty array of column names` };
            }
            const indexName = item["name"];
            if (indexName !== void 0 && (typeof indexName !== "string" || indexName === "")) {
              return { error: `indexes[${index}].name must be a non-empty string when present` };
            }
            indexes.push({
              kind,
              columns: columns2,
              ...indexName === void 0 ? {} : { name: indexName }
            });
          }
        }
        const tableBody = body["tableOptions"];
        let tableOptions;
        if (tableBody !== void 0) {
          const item = asJsonObject(tableBody);
          if (item === void 0) return { error: "tableOptions must be an object when present" };
          const readString = (key) => {
            const value = item[key];
            if (value === void 0) return void 0;
            if (typeof value !== "string") throw new Error(`tableOptions.${key} must be a string`);
            return value === "" ? void 0 : value;
          };
          try {
            const engine = readString("engine");
            const collate = readString("collate");
            const charset = readString("charset");
            const comment = readString("comment");
            const tail = readString("tail");
            tableOptions = {
              ...engine === void 0 ? {} : { engine },
              ...collate === void 0 ? {} : { collate },
              ...charset === void 0 ? {} : { charset },
              ...comment === void 0 ? {} : { comment },
              ...tail === void 0 ? {} : { tail }
            };
          } catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
          }
        }
        return {
          change: {
            ...base,
            specs,
            ...primaryKey === void 0 ? {} : { primaryKey },
            ...indexes.length === 0 ? {} : { indexes },
            ...tableOptions === void 0 ? {} : { tableOptions }
          }
        };
      }
      case "addColumn":
        return { change: { ...base, spec: readColumnSpec(body["column"], "column") } };
      case "alterColumn": {
        const spec = readColumnSpec(body["column"], "column");
        const rename = body["rename"];
        if (rename !== void 0 && (typeof rename !== "string" || rename === "")) {
          return { error: "rename must be a non-empty string when present" };
        }
        return { change: { ...base, spec, ...rename === void 0 ? {} : { rename } } };
      }
      case "dropColumn": {
        const column = body["column"];
        if (typeof column !== "string" || column === "") return { error: "column is required for dropColumn" };
        return { change: { ...base, column } };
      }
      case "setPrimaryKey": {
        const columns = body["columns"];
        if (!Array.isArray(columns) || columns.some((entry) => typeof entry !== "string" || entry === "")) {
          return { error: "columns must be an array of column names" };
        }
        return { change: { ...base, columns } };
      }
      case "createIndex": {
        const index = asJsonObject(body["index"]);
        if (index === void 0) return { error: "index must be an object" };
        const name2 = index["name"];
        const columns = index["columns"];
        if (typeof name2 !== "string" || name2 === "") return { error: "index.name is required" };
        if (!Array.isArray(columns) || columns.length === 0 || columns.some((entry) => typeof entry !== "string" || entry === "")) {
          return { error: "index.columns must be a non-empty array of column names" };
        }
        return { change: { ...base, index: { name: name2, columns, unique: index["unique"] === true } } };
      }
      case "dropIndex": {
        const name2 = body["name"];
        if (typeof name2 !== "string" || name2 === "") return { error: "name is required for dropIndex" };
        return { change: { ...base, column: name2 } };
      }
      default:
        return { error: `unsupported action: ${JSON.stringify(action)}` };
    }
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
async function applySchemaChange(driver, change) {
  const started = Date.now();
  const finish = (result, reload) => ({
    affected: result.affected,
    durationMs: Date.now() - started,
    reload
  });
  switch (change.action) {
    case "createTable": {
      const result = await driver.createTable(change.schema, change.table, change.specs ?? [], {
        ...change.primaryKey === void 0 ? {} : { primaryKey: change.primaryKey },
        ...change.indexes === void 0 ? {} : { indexes: change.indexes },
        ...change.tableOptions === void 0 ? {} : { table: change.tableOptions }
      });
      return finish(result, ["columns", "indexes", "rows", "tables"]);
    }
    case "addColumn": {
      const result = await driver.addColumn(change.schema, change.table, change.spec);
      return finish(result, ["columns"]);
    }
    case "alterColumn": {
      const result = await driver.alterColumn(change.schema, change.table, change.spec, {
        ...change.rename === void 0 ? {} : { rename: change.rename }
      });
      return finish(result, ["columns", "indexes", "rows"]);
    }
    case "dropColumn": {
      const result = await driver.dropColumn(change.schema, change.table, change.column);
      return finish(result, ["columns", "indexes", "rows"]);
    }
    case "setPrimaryKey": {
      const result = await driver.setPrimaryKey(change.schema, change.table, change.columns);
      return finish(result, ["columns", "indexes", "rows"]);
    }
    case "createIndex": {
      const result = await driver.createIndex(change.schema, change.table, change.index);
      return finish(result, ["indexes"]);
    }
    case "dropIndex": {
      const result = await driver.dropIndex(change.schema, change.table, change.column);
      return finish(result, ["indexes"]);
    }
    default:
      throw new Error(`unsupported action: ${JSON.stringify(change.action)}`);
  }
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
          let filters;
          const rawFilters = queryParam(url, "filters");
          if (rawFilters !== void 0) {
            try {
              filters = parseFilters(JSON.parse(rawFilters));
            } catch (error) {
              writeError(res, 400, `filters: ${errorMessage(error)}`);
              return;
            }
          }
          const orderByColumns = queryParam(url, "orderByColumns");
          const page = await driver.rows({
            ...queryParam(url, "schema") === void 0 ? {} : { schema: queryParam(url, "schema") },
            table,
            page: Math.max(1, queryInt(url, "page", 1)),
            pageSize: clampPageSize(queryInt(url, "pageSize", DEFAULT_PAGE_SIZE)),
            ...queryParam(url, "orderBy") === void 0 ? {} : { orderBy: queryParam(url, "orderBy") },
            ...orderByColumns === void 0 ? {} : { orderByColumns: orderByColumns.split(",").filter((name2) => name2 !== "") },
            ...queryParam(url, "orderDir") === "desc" ? { orderDir: "desc" } : {},
            mode: mode === "search" ? "search" : "browse",
            ...queryParam(url, "term") === void 0 ? {} : { term: queryParam(url, "term") },
            ...queryParam(url, "condition") === void 0 ? {} : { condition: queryParam(url, "condition") },
            ...filters === void 0 ? {} : { filters },
            ...queryParam(url, "filterJoin") === "or" ? { filterJoin: "or" } : {}
          });
          const indexes = queryParam(url, "withIndexes") === "1" ? await driver.indexes(queryParam(url, "schema"), table) : void 0;
          writeJson(res, 200, { page: indexes === void 0 ? page : { ...page, indexes } });
          return;
        }
        writeError(res, 405, `${method} is not allowed on ${path}`);
        return;
      }
      if (action === "rows/delete" && method === "POST") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "rows/delete is only available for SQL data sources");
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
        if (!Array.isArray(body["keySets"]) || body["keySets"].length === 0) {
          writeError(res, 400, "keySets must be a non-empty array");
          return;
        }
        if (body["keySets"].length > MAX_BATCH_ROWS) {
          writeError(res, 400, `too many rows in one request (max ${MAX_BATCH_ROWS})`);
          return;
        }
        const keySets = body["keySets"].map((entry2, index) => readPairs(entry2, `keySets[${index}]`));
        writeJson(res, 200, { result: await driver.deleteRows(schema, table, keySets) });
        return;
      }
      if (action === "distinct" && method === "GET") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "distinct is only available for SQL data sources");
          return;
        }
        const table = queryParam(url, "table");
        const column = queryParam(url, "column");
        if (table === void 0 || column === void 0) {
          writeError(res, 400, "table and column are required");
          return;
        }
        writeJson(res, 200, { count: await driver.distinctCount(queryParam(url, "schema"), table, column) });
        return;
      }
      if (action === "schema" && method === "POST") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "schema is only available for SQL data sources");
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const parsed = parseSchemaChange(body);
        if ("error" in parsed) {
          writeError(res, 400, parsed.error);
          return;
        }
        const change = parsed.change;
        const result = await applySchemaChange(driver, change);
        writeJson(res, 200, { result });
        return;
      }
      if (action === "maintenance-support" && method === "GET") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "maintenance-support is only available for SQL data sources");
          return;
        }
        writeJson(res, 200, { support: driver.maintenanceSupport() });
        return;
      }
      if (action === "maintain" && method === "POST") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "maintain is only available for SQL data sources");
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const tables = body["tables"];
        if (!Array.isArray(tables) || tables.length === 0 || tables.some((entry2) => typeof entry2 !== "string" || entry2 === "")) {
          writeError(res, 400, "tables must be a non-empty array of table names");
          return;
        }
        if (tables.length > MAX_BATCH_TABLES) {
          writeError(res, 400, `too many tables in one request (max ${MAX_BATCH_TABLES})`);
          return;
        }
        const op = body["op"];
        if (typeof op !== "string" || !MAINTENANCE_OPS.includes(op)) {
          writeError(res, 400, `op must be one of ${MAINTENANCE_OPS.join(", ")}`);
          return;
        }
        const schema = typeof body["schema"] === "string" && body["schema"] !== "" ? body["schema"] : void 0;
        const support = driver.maintenanceSupport();
        if (!support.includes(op)) {
          writeError(res, 400, `${driver.kind} \u4E0D\u652F\u6301 ${op}\uFF08\u53EF\u7528\uFF1A${support.join(", ")}\uFF09`);
          return;
        }
        const results = await driver.maintain(schema, tables, op);
        writeJson(res, 200, { results: results.map((result, index) => ({ ...result, table: tables[index] })) });
        return;
      }
      if (action === "database" && method === "POST") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "database is only available for SQL data sources");
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const op = body["op"];
        if (op !== "create" && op !== "drop" && op !== "rename" && op !== "copy" && op !== "charset") {
          writeError(res, 400, "op must be one of create, drop, rename, copy, charset");
          return;
        }
        const name2 = typeof body["name"] === "string" ? body["name"].trim() : "";
        if (name2 === "" && op !== "drop" && op !== "charset") {
          writeError(res, 400, "name is required");
          return;
        }
        const from = typeof body["from"] === "string" && body["from"] !== "" ? body["from"] : void 0;
        const options = {
          ...from === void 0 ? {} : { from },
          ...typeof body["charset"] === "string" && body["charset"] !== "" ? { charset: body["charset"] } : {},
          ...typeof body["collate"] === "string" && body["collate"] !== "" ? { collate: body["collate"] } : {},
          ...body["includeData"] === void 0 ? {} : { includeData: body["includeData"] === true }
        };
        if (op === "drop" || op === "rename") pool.drop(id);
        writeJson(res, 200, { result: await driver.databaseOperation(op, name2, options) });
        return;
      }
      if (action === "export" && method === "POST") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "export is only available for SQL data sources");
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const request = {
          ...typeof body["schema"] === "string" && body["schema"] !== "" ? { schema: body["schema"] } : {},
          ...Array.isArray(body["tables"]) ? { tables: body["tables"].filter((name2) => typeof name2 === "string" && name2 !== "") } : {},
          includeData: body["includeData"] !== false,
          includeStructure: body["includeStructure"] !== false,
          drop: body["drop"] === true,
          format: body["format"] === "csv" ? "csv" : "sql"
        };
        const result = await exportSql(driver, entry, request);
        writeJson(res, 200, {
          filename: result.filename,
          contentType: result.contentType,
          text: result.text,
          truncated: result.truncated,
          byteLength: Buffer.byteLength(result.text, "utf8")
        });
        return;
      }
      if (action === "import" && method === "POST") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "import is only available for SQL data sources");
          return;
        }
        const body = asJsonObject(await readJsonBody(req, { maxBytes: IMPORT_BODY_MAX_BYTES }));
        if (body === void 0) {
          writeError(res, 400, `body must be a JSON object under ${Math.trunc(IMPORT_BODY_MAX_BYTES / 1024 / 1024)} MiB`);
          return;
        }
        const content = body["content"];
        if (typeof content !== "string" || content === "") {
          writeError(res, 400, "content is required");
          return;
        }
        const result = await importSql(driver, {
          ...typeof body["schema"] === "string" && body["schema"] !== "" ? { schema: body["schema"] } : {},
          ...typeof body["table"] === "string" && body["table"] !== "" ? { table: body["table"] } : {},
          format: body["format"] === "csv" ? "csv" : "sql",
          ...typeof body["hasHeader"] === "boolean" ? { hasHeader: body["hasHeader"] } : {},
          ...typeof body["emptyAsNull"] === "boolean" ? { emptyAsNull: body["emptyAsNull"] } : {},
          content
        });
        writeJson(res, 200, { result: { statements: result.statements, rows: result.rows, skipped: result.skipped } });
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
      if (action === "row/batch" && method === "POST") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "row/batch is only available for SQL data sources");
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
        if (!Array.isArray(body["rows"]) || body["rows"].length === 0) {
          writeError(res, 400, "rows must be a non-empty array");
          return;
        }
        if (body["rows"].length > MAX_BATCH_ROWS) {
          writeError(res, 400, `too many rows in one request (max ${MAX_BATCH_ROWS})`);
          return;
        }
        const schema = typeof body["schema"] === "string" && body["schema"] !== "" ? body["schema"] : void 0;
        const rows = body["rows"].map((entry2, index) => readPairs(entry2, `rows[${index}]`));
        writeJson(res, 200, { result: await driver.insertRows(schema, table, rows) });
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
      if (action === "table-actions" && method === "GET") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "table-actions is only available for SQL data sources");
          return;
        }
        writeJson(res, 200, { support: driver.tableActionSupport() });
        return;
      }
      if (action === "table/move" && method === "POST") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "table/move is only available for SQL data sources");
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const named = readTableName(body);
        if ("error" in named) {
          writeError(res, 400, named.error);
          return;
        }
        const readTarget = readTableTarget(body);
        if ("error" in readTarget) {
          writeError(res, 400, readTarget.error);
          return;
        }
        const support = driver.tableActionSupport();
        if (!support.includes("move")) {
          writeError(res, 400, `${driver.kind} \u4E0D\u652F\u6301\u79FB\u52A8\u8868`);
          return;
        }
        writeJson(res, 200, { result: await driver.moveTable(readSchema(body), named.table, readTarget.target) });
        return;
      }
      if (action === "table/copy" && method === "POST") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "table/copy is only available for SQL data sources");
          return;
        }
        const body = asJsonObject(await readJsonBody(req));
        if (body === void 0) {
          writeError(res, 400, "body must be a JSON object");
          return;
        }
        const named = readTableName(body);
        if ("error" in named) {
          writeError(res, 400, named.error);
          return;
        }
        const readTarget = readTableTarget(body);
        if ("error" in readTarget) {
          writeError(res, 400, readTarget.error);
          return;
        }
        const support = driver.tableActionSupport();
        if (!support.includes("copy")) {
          writeError(res, 400, `${driver.kind} \u4E0D\u652F\u6301\u590D\u5236\u8868`);
          return;
        }
        writeJson(res, 200, {
          result: await driver.copyTable(readSchema(body), named.table, readTarget.target, {
            includeData: body["includeData"] !== false,
            isView: body["isView"] === true
          })
        });
        return;
      }
      if (action === "table/options") {
        if (!isSqlDriver(driver)) {
          writeError(res, 400, "table/options is only available for SQL data sources");
          return;
        }
        const table = queryParam(url, "table");
        if (table === void 0) {
          writeError(res, 400, "table is required");
          return;
        }
        if (method === "GET") {
          writeJson(res, 200, { options: await driver.tableOptionInfo(readSchemaFrom(url), table) });
          return;
        }
        if (method === "POST") {
          const body = asJsonObject(await readJsonBody(req));
          if (body === void 0) {
            writeError(res, 400, "body must be a JSON object");
            return;
          }
          const parsed = parseTableOptionPatch(body);
          if ("error" in parsed) {
            writeError(res, 400, parsed.error);
            return;
          }
          const support = driver.tableActionSupport();
          if (!support.includes("options")) {
            writeError(res, 400, `${driver.kind} \u4E0D\u652F\u6301\u4FEE\u6539\u8868\u9009\u9879`);
            return;
          }
          writeJson(res, 200, { result: await driver.alterTableOptions(readSchemaFrom(url), table, parsed.patch) });
          return;
        }
        writeError(res, 405, `${method} is not allowed on ${path}`);
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
init_types();
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
init_types();
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
