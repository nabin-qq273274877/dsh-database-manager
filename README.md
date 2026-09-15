# dsh-database-manager

DSH（DeepSeek Harness）数据库管理插件：侧边栏「数据库管理」入口 + 独立面板，统一管理 **SQLite / MySQL / Redis**，并提供受审批保护的 agent 工具。

## 功能

**数据源列表**（面板首页）
- 上方功能框：左侧搜索 + 分组显示（不分组 / 按类型 / 按分组 / 按标签），右侧「新增数据库」
- 下方列表：数据库类型、名称、主机、用户、认证、标签、操作
- 操作列：**测试**（连通性 + 延迟 + 服务端版本）、**连接**（进入对应数据库面板）、**编辑**、**删除**

**MySQL / SQLite 面板**（类 phpMyAdmin）
- 左侧：库 / 表树（搜索过滤、视图标记、行数）
- 右侧标签页：**浏览**（分页、点列排序）、**结构**（列 + 索引）、**SQL**（编辑器，Ctrl+Enter 执行）、**搜索**（全文本列模糊搜 / 直接填 WHERE 条件）、**插入**（按表结构生成表单）

**Redis 面板**（类 RedisDesktopManager）
- 左侧：SCAN 驱动的键列表（模式过滤、db0–db15 切换、按需加载下一页、TTL 展示）
- 右侧标签页：**值**（按类型渲染 string / list / set / hash / zset / stream）、**服务信息**（版本、内存、连接数、各库键数）、**命令行**（任意命令 + 回复）

**agent 工具**
| 工具 | 作用 |
| --- | --- |
| `db_list` | 列出已配置数据源（id、引擎、名称、主机、用户、认证、标签、只读） |
| `db_schema` | 查看库 / 表 / 列 / 索引结构（Redis 返回各库键数） |
| `db_query` | 只读查询（SQL 的 SELECT/WITH/SHOW/DESCRIBE/EXPLAIN/PRAGMA；Redis 的读命令） |
| `db_exec` | 写操作（受用户开关与审批保护） |

## 写保护

两层，均**失败即拒绝**（fail-closed）：

1. **单调 guard**（`ctx.tools.guard`）——判定在派发前生效。agent 写入开关关闭、或目标数据源被标记只读时，`db_exec` **直接硬拒**，不弹框（答案已知，不必打扰用户）。
2. **审批瀑布**（`tools/pre-execute` 返回 `{kind:'ask'}`）——开关打开且目标可写时，每次写入弹出 DSH 原生审批框由用户确认。若当前环境没有 approval 服务，框架会**自动判为拒绝**；用户拒绝或取消同样拒绝，因此「无人应答」绝不会等于「放行」。

面板底部的策略开关：

- **允许 agent 写入**（默认关）——关闭时 agent 只能读取；开启后才可能执行 `db_exec`
- **写入需审批**（默认开）——开启时每次写入都要你点确认

另外每个数据源有独立的**只读**标记：勾选后，即使全局开启了 agent 写入，该数据源也不会被 agent 修改。

GUI 的写入不经过这道门——你在面板里点「保存」/「执行」，这个动作本身就是授权，和终端工具一致。

## 安装

```bash
# 在 dsh 的 web profile 中安装
cd "$DSH_HOME/profiles/web"
pnpm add file:D:/Project/nabin/dsh-plugins/dsh-database-manager
```

然后把它加入 `package.json` 的 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-database-manager"
      ]
    }
  }
}
```

重启 web 服务后，侧边栏「新建会话」下方会出现「数据库管理」入口。

也可以让插件自带一份 patch（`cordis.patch.yml`），把它作为 bundle 层使用：

```yaml
- insert:
    - id: database-manager
      name: 'dsh-database-manager'
```

## 数据与依赖

- 数据源配置：`$DSH_HOME/dsh-database.json`（POSIX 下权限 0600）
- 口令以**明文**存于该用户私有文件，与 dsh-ssh 的主机存储同一信任模型 —— 不要读取或转发该文件内容
- 密码从不下发到浏览器或模型：接口返回的是 `summarize()` 脱敏投影（只给出 `hasPassword`）

引擎依赖：

| 引擎 | 驱动 | 说明 |
| --- | --- | --- |
| SQLite | `node:sqlite` | Node 内置，**零依赖**（需 Node ≥ 22.5） |
| MySQL | `mysql2` | 插件依赖，连接池 |
| Redis | `ioredis` | 插件依赖，按 db 缓存客户端 |

三个引擎的可用性会在面板顶部显示；缺哪个依赖会显式提示，而不是静默失败。驱动的加载是懒执行且带错误翻译的，因此只装 SQLite 的部署也能正常启动。

## 开发

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest：单元 + SQLite 真实链路 + 构建产物集成 + 客户端 bundle
npm run build       # lib/index.js（host）+ lib/client.js（browser）
```

### 架构

- **host 半**（`src/index.ts` → `lib/index.js`）
  - `store.ts` 数据源存储（原子写、脱敏投影、持久化写入策略）
  - `pool.ts` 按需建连的驱动池，30 分钟空闲回收；连接字段变更时先丢弃旧驱动
  - `drivers/` 三引擎适配器，统一 `SqlDriver` / `RedisDriver` 契约
  - `routes.ts` `/api/dsh-database` 路由族（**用户面**，用户点击即授权）
  - `tools.ts` agent 工具（**模型面**，经 `auth.ts` 授权门）
- **client 半**（`src/client/index.ts` → `lib/client.js`）
  - 注册 `sidebar.panellist` 插槽（侧边栏入口）与 `main` 插槽（居中面板）
  - 两者用同一个 id `database-manager`：shell 的 `PanelRow` 点击时调用 `layout.selectPanel(id)`，而点击任意会话行会调用 `selectPanel(null)`，因此「点会话返回」是 shell 内建行为，插件无需干预

SQL 标识符一律先按保守文法校验、再按各引擎规则加引号（MySQL 反引号、SQLite 双引号）；值一律走绑定参数，绝不拼进语句文本。

## 许可

MIT
