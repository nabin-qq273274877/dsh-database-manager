# dsh-database-manager 与 phpMyAdmin 功能对照报告

研究基准：**phpMyAdmin 5.2.3**（官方文档 latest / release 5.2.3 + 官方发行包源码）。

## 0. 关于来源的一个必须先说明的事实

任务给出的 URL 里，`browse.html`、`tbl_structure.html`、`tbl_create.html`、`sql.html`、`search.html`、`db_operations.html`、`tbl_operations.html`、`designer.html`、`tracking.html`、`user_management.html`、`server_status.html`、`indexes.html` 等**在 phpMyAdmin 官方文档中不存在**。

核实方法（三重）：

1. `https://docs.phpmyadmin.net/en/latest/<name>.html` 全部返回 404。
2. 官方文档站首页与 `user.html` 的 toctree 只列出 23 个文档名。
3. `searchindex.js` 的 `"docnames"` 数组（Sphinx 构建产物，权威）：`bookmarks, charts, config, copyright, credits, developers, faq, glossary, import_export, index, intro, other, privileges, relations, require, security, settings, setup, themes, transformations, two_factor, user, vendors`。
4. 历史版本同构：`RELEASE_4_6_6` 的 `doc/` 目录同样只有这些 `.rst`；用户在别的项目里见过的 `browse.html` 大多来自**第三方镜像站的 Sphinx 输出**（例如 `www.uvm.edu/~vgn/WebApplications/phpmyadmin/Documentation.html`），或把 phpMyAdmin 5.3-dev 之前的旧式 `phpmyadmin.net/documentation/` 页面记混了。

因此本报告的事实来源改为：

- **官方文档**：`config.html`（配置参考，是「浏览/编辑/导航/导出导入/SQL 框/显示」这些 UI 区域唯一有官方描述的地方）、`faq.html`（功能细节最密）、`intro.html`、`import_export.html`、`privileges.html`、`relations.html`、`transformations.html`、`bookmarks.html`、`charts.html`、`two_factor.html`、`themes.html`、`other.html`。
- **官方发行包源码**：`https://files.phpmyadmin.net/phpMyAdmin/5.2.3/phpMyAdmin-5.2.3-all-languages.zip`（官方发布渠道），用于核实 UI 控件文案与选项清单。凡引用源码的地方下面都标注了文件路径，便于复核。

凡官方文档没写、源码也没读到的地方，一律标「不确定」并说明。

---

## 1. 一句话结论

**这个面板 ≈ phpMyAdmin「表级工作台 + 库级基本操作」的子集：把 phpMyAdmin 里最常用的那 6 个表标签页（Browse / Structure / SQL / Search / Insert / Operations）做到了接近同等深度，但砍掉了 phpMyAdmin 全部的「服务器管理、账号权限、关系/设计器、跟踪版本化、可视化构建器、多格式导出导入」六大块，并额外加了一条 phpMyAdmin 没有的写权限闸门和一类 phpMyAdmin 完全不支持的数据源（Redis）。**

定位上它是「日常查数据、改结构、跑 SQL 的轻量面板」，不是「MySQL 服务器管理套件」。

---

## 2. 功能对照表

### 2.1 浏览数据页（Browse）

| phpMyAdmin 的能力 | 自研面板 | 差异性质 |
| --- | --- | --- |
| 分页：Begin / Previous / Next / End 四个按钮 + 页码下拉选择器（`Util::pageselector`），显示「第 x–y 行共 n 行」 | 上一页 / 下一页 / 跳页输入框 + 「第 x–y 行，共 n 行」，**没有首页/末页按钮** | 更弱（少一键到底/到顶） |
| 每页行数下拉固定为 `25/50/100/250/500`（`templates/display/results/table.twig`:51，`$cfg['MaxRows']` 默认 25） | `50/100/200/500/1000` | 不同做法（面板最小页更大、上限更高；phpMyAdmin 有 25 这一档） |
| 「Show all」复选框一次显示全部行（`$cfg['ShowAll']`，默认仅 <500 行的表出现该按钮） | 无「显示全部」 | 缺失 |
| 点击列标题排序，再次点击切换升降序；支持多列排序（`getSingleAndMultiSortUrls`） | 点列排序、再点切方向；**无多列排序** | 更弱 |
| 「Sort by key」下拉：列出表上每个索引的 `索引名 (ASC)` / `索引名 (DESC)` / `None`，以改写 `ORDER BY` 实现（`Display/Results.php:1204`） | 「按索引排序」下拉：列出主键与各索引、可选递增/递减 | 相当 |
| 双击单元格就地编辑（`$cfg['GridEditing']` 默认 `double-click`，可设为 `click` 或禁用） | 双击单元格就地编辑，失焦自动保存 | 相当 |
| 网格编辑批量提交：`$cfg['SaveCellsAtOnce']` + 「Save edited data」按钮，可一次保存多个改动单元格 | 无「一次保存全部编辑」 | 更弱 |
| 行内动作 Edit / Copy / Delete，可配置显示在左/右/两侧/不显示（`$cfg['RowActionLinks']` 默认 `left`） | 行「编辑」/「复制到插入表单」/「删除」，固定在右侧操作列 | 相当 |
| 无唯一键时默认**隐藏**行动作与复选框（`$cfg['RowActionLinksWithoutUnique']` 默认 false），FAQ 3.10 明确说明原因 | 无主键时禁用行内编辑与批量删除，并给出文案说明 | 相当（判定依据更严格：要求主键，phpMyAdmin 接受唯一键） |
| 多行选择 + 批量操作：「With selected:」Edit / Copy / Delete / Export（`templates/display/results/table.twig`:230-244） | 多选 + 批量删除；「导出所选」 | 更弱（缺批量 Edit、批量 Copy） |
| 全选本页 / 取消选择；Shift 点击选一个连续区间（FAQ 6.26，Browse 与 Structure 页都可用） | 全选本页 / 取消选择；**无 Shift 范围选择** | 更弱 |
| 「Filter rows」输入框：客户端即时过滤当前已取回的行（`.filter_rows`，`js/src/sql.js:682`），**不改 SQL** | 「筛选条件条」显示来自搜索页的条件并可一键清除；这是**服务端条件**而非客户端过滤 | 不同做法（面板是条件回显，phpMyAdmin 是纯前端行过滤） |
| 列宽可拖动调整、列顺序可拖动重排、列可逐列隐藏/显示，配「Restore column order」（`js/src/makegrid.js` 的 `dragStartRsz` / `dragStartReorder` / `colVisib`） | **无列宽拖动、无列重排、无列隐藏**；表格超宽时横向滚动 | 缺失 |
| 列顺序与可见性、排序状态可持久化（`$cfg['RememberSorting']` + `pma__table_uiprefs`） | 不持久化排序/列状态 | 缺失 |
| 列注释显示在表头内（`$cfg['ShowBrowseComments']`，属性页则为虚线下划线 + tooltip） | 列注释显示在列名下方，表注释显示在分页行右端（`SqlBrowseTab.ts:353,638`） | 相当（展示位置不同） |
| `$cfg['LimitChars']`（默认 50）截断非数字字段，页面上有「Full texts / Partial texts」切换按钮 | 长文本单元格截断 | 更弱（无全局「显示全文」切换） |
| 二进制/BLOB 内容开关「Show binary contents」「Show BLOB contents」；几何数据显示为 Geometry / Well Known Text / Well Known Binary 三选一 | 无二进制/BLOB 专用显示开关，无几何显示格式切换 | 缺失 |
| 结果集操作区「Query results operations」：Print、Copy to clipboard、Export、Display chart、Visualize GIS data、Create view | 结果集期间工具栏整块隐藏、只读，**没有打印/复制到剪贴板/图表/GIS/建视图** | 缺失 |
| 结果集与表读是**同一条代码路径**：Browse 页本身就是「执行 SELECT 并渲染 `Display\Results`」，所以查询结果天然带全部浏览控件（排序、编辑、导出…） | 结果集与表读**明确分成两种模式**：查询结果落到浏览页，但工具栏整块隐藏、只读 | 不同做法（面板牺牲了「对结果集继续操作」，换来「不会误把 JOIN 结果当成可编辑表」） |
| `SELECT *` 结果呈现：与表浏览完全一致，含编辑/删除链接（无唯一键时按 `RowActionLinksWithoutUnique` 隐藏） | 结果集不能行内编辑（只读）；只读是**故意的** | 不同做法 |
| 打开表时若存在与表同名的书签，自动用该书签查询代替 `SELECT *`（FAQ 6.22、`bookmarks.rst`） | 无书签 | 缺失 |
| 近似行数可点击换成精确 `COUNT(*)`；可对所有表一次性点行数合计（FAQ 3.11，`$cfg['MaxExactCount']` 默认 50000） | 表树显示行数；非重复值统计在结构页 | 更弱（有计数，但无「近似→精确」这一交互） |

来源：[config.html Browse mode](https://docs.phpmyadmin.net/en/latest/config.html#browse-mode)、[config.html Design customization](https://docs.phpmyadmin.net/en/latest/config.html#design-customization)、[faq.html 3.10/3.11/6.22/6.26/6.33/6.34](https://docs.phpmyadmin.net/en/latest/faq.html)、[bookmarks.html](https://docs.phpmyadmin.net/en/latest/bookmarks.html)。

### 2.2 结构页（Structure）

| phpMyAdmin 的能力 | 自研面板 | 差异性质 |
| --- | --- | --- |
| 列列表：Name / Type / Collation / Attributes / Null / Default / **Comments** / Extra / Action | 列名/类型/可空/键/默认值/额外/非重复值计数/注释/操作 | 相当（面板多「非重复值计数」列） |
| 单列动作：Change、Drop、Primary、Unique、Index、**Spatial**、**Fulltext**、Distinct values、Move columns、Add to central columns（`display_structure.twig`:135-261） | 修改、删除、设为主键、唯一约束开关、非重复值、删除索引 | 更弱（缺 Spatial / Fulltext 单独入口、缺 Move columns） |
| 多列选择后的批量动作：Browse / Change / Drop / Primary / Unique / Index / Spatial / Fulltext / Add·Remove central columns（`display_structure.twig`:281-314） | 多选批量删列；主键编辑（勾选顺序即主键顺序）；唯一约束 | 更弱 |
| 新增列：可指定新增个数、可指定位置（first / after X） | 新增列，可「放在 xx 字段之后」 | 相当 |
| **拖动列名上下移动列顺序**（「Move columns」弹窗，`/table/structure/move-columns`） | 无列重排 | 缺失 |
| 索引表格：Keyname / Type / Unique / Packed / **Cardinality** / Collation / Null / Comment + 删除 | 索引表格：索引名/唯一/列/类型/操作 + 删除 | 更弱（缺 Cardinality、Packed、Comment 列显示） |
| 索引表单：Index name、Index choice（PRIMARY/INDEX/UNIQUE/**SPATIAL**/**FULLTEXT**）、Key block size、Index type（BTREE/HASH）、**Parser**、Comment、每列 Size（前缀长度）、**拖动调整索引列顺序**（`templates/table/index_form.twig`） | 索引新建：索引名、索引列（按顺序勾选）、唯一索引勾选框；**索引种类只有 primary/unique/index 三种**（`SqlStructureTab.ts:1159`，`column-index-plan.ts:176` 明确说明 FULLTEXT/SPATIAL 在本面板的索引通路上会被拒绝，故不下拉） | 更弱 |
| 索引列前缀长度（`sub_parts`）、Parser、Key block size、Index type、索引注释 | 无 | 缺失 |
| 主键：Primary 动作 + 索引表里的 PRIMARY 行；主键列顺序即索引顺序 | 主键编辑对话框，勾选顺序即主键顺序；明确「主键索引不能单独删除」 | 相当 |
| 唯一约束：Unique 动作 | 唯一约束开关 + 唯一索引 | 相当 |
| 生成列：`Virtuality` 下拉（VIRTUAL / VIRTUAL GENERATED / STORED GENERATED / PERSISTENT）+ `Expression` 输入框（`column_attributes.twig`:150-165） | 生成列被识别并**标记**，禁止编辑其定义与值（`SqlStructureTab.ts:13-14, 559, 649`）；**不能新建生成列** | 更弱（只读识别，不能创建/改表达式） |
| 列属性：Attributes 下拉（UNSIGNED / ZEROFILL / BINARY / ON UPDATE CURRENT_TIMESTAMP 等） | 属性多选（UNSIGNED、ZEROFILL、BINARY、ON UPDATE CURRENT_TIMESTAMP），按类型过滤可用项 | 相当 |
| 列默认值四态：`NONE`（无 DEFAULT）/ `As defined`（自定义）/ `NULL` / `CURRENT_TIMESTAMP`，另含 **`UUID`** 选项（`column_attributes.twig`:36-52） | 默认值四态：不设置、自定义、NULL、CURRENT_TIMESTAMP | 更弱（缺 UUID 默认值档位） |
| 列注释（Comments 文本框，走 MySQL 原生列注释） | 列注释 | 相当 |
| 排序规则可逐列指定 | 列级排序规则下拉 | 相当 |
| 列长度/值（`Length/Values`，含 ENUM/SET 值编辑器「Edit ENUM/SET values」，带反斜杠转义提示） | 长度·值输入框 + 分组类型下拉 + 手填其他类型；有 ENUM/SET 值列表校验与「MySQL 会把 TEXT(n) 悄悄换成 tinytext」的告警 | 相当 |
| 表统计区：Space usage（Data / Index / Overhead / Effective / Total）、Row statistics（Format、Collation、Rows、Row length、Row size、Next autoindex、Creation、Last update、Last check） | 无表统计区 | 缺失 |
| 表选项（引擎/排序规则/注释/AUTO_INCREMENT/行格式）在**操作页**「Table options」块，含「Change all column collations」 | 表选项块改引擎、排序规则、注释、AUTO_INCREMENT、行格式、转换；**无「同步改所有列的排序规则」** | 更弱 |
| 分区：`display_partitions` 展示分区/子分区结构（方法、表达式、Values、Engine、Comment、Data/Index directory、Max/Min rows、Table space、Node group） + 分区定义表单（Partition by / Partitions / Subpartition by / Subpartitions） | 无分区管理 | 缺失 |
| 分区维护：Analyze / Check / Drop / Optimize / Rebuild / Repair / Truncate 分区（`templates/table/partition/*.twig`） | 无 | 缺失 |
| 外键管理：`Relation view`（表级二级标签页）里维护 InnoDB 外键与 phpMyAdmin 内部关系，含「Choose column to display」（`templates/table/page_with_secondary_tabs.twig`:10） | 无外键管理界面；建表对话框里可写外键约束、导入导出会处理 FK、结构页会**识别并警告**触碰外键的破坏性操作 | 缺失 |
| 引用完整性检查：「Check referential integrity」块，列出每个已描述键的缺失外键（操作页） | 无 | 缺失 |
| 表维护：**Analyze / Check / Checksum / Defragment / Flush / Optimize / Repair**（操作页一套 + 表级 `/table/maintenance/*` 控制器） | 表维护四件套：检查 / 优化 / 修复 / 分析；**无 Checksum、无 Defragment、无 Flush**；且能感知引擎支持情况（SQLite 明确说没有 REPAIR） | 更弱 |
| 库里多表批量维护：在数据库结构页勾选多张表，选一个操作（如 optimize）批量执行；`$cfg['DisableMultiTableMaintenance']` 可禁用 | 批量维护作用于所选表（`maintain(schema, tables[], op)`） | 相当 |
| 表复制：Copy table to（结构 / 结构与数据 / 仅数据 + Add AUTO_INCREMENT value + Add constraints + Switch to copied table + Adjust privileges） | 「将数据表复制到」+ 是否含数据 | 更弱（无 Add constraints / Adjust privileges / 复制后切换） |
| 表移动：Move table to（database.table）+ Add AUTO_INCREMENT value + Adjust privileges | 「将数据表移动到」目标库/表名 | 更弱（无 Adjust privileges） |
| 表重命名：Table options 里的 Rename table to | 通过「将数据表移动到」同库另一个名字实现（重命名） | 相当（入口合一，phpMyAdmin 两者分开） |
| 清空表 / 删表：Delete data or table（Empty / Drop + 确认） | 「删除数据或表」（TRUNCATE / DROP，含确认） | 相当 |
| `Alter table order by`：按某列物理重排表数据 | 无 | 缺失 |
| `Normalize`：向导把表推到第一/二/三范式，提出新结构 | 无 | 缺失 |
| `Propose table structure`：`PROCEDURE ANALYSE()` 给出列类型建议（MySQL <8.0 / MariaDB） | 无 | 缺失 |
| `Data dictionary`：库级数据字典页 | 无 | 缺失 |
| `Central columns`：库级中央列清单，可避免同义列名/类型不一致；可从表结构页批量加入/移除 | 无 | 缺失 |
| 视图：结构页对视图显示 Edit view / Track view，`tbl_is_view` 控制动作可见性 | 表树标记视图；视图不可编辑其结构 | 更弱 |
| 结构页有 Print 按钮 | 无 | 缺失 |
| 列注释可配置是否入 dump（`Add into comments`，FAQ 6.12） | 导出不含注释（SQL 转储只勾结构/数据/DROP） | 缺失 |

来源：[config.html Database structure](https://docs.phpmyadmin.net/en/latest/config.html#database-structure)、[config.html Editing mode](https://docs.phpmyadmin.net/en/latest/config.html#editing-mode)、[config.html Various display setting](https://docs.phpmyadmin.net/en/latest/config.html#various-display-setting)、[faq.html 6.2/6.12/6.24/6.35/6.36/6.37/6.39](https://docs.phpmyadmin.net/en/latest/faq.html)、[relations.html](https://docs.phpmyadmin.net/en/latest/relations.html)。

### 2.3 插入页（Insert）

| phpMyAdmin 的能力 | 自研面板 | 差异性质 |
| --- | --- | --- |
| 表单式插入：每列一行，控件按列类型给（enum 下拉/单选、set 多选、BLOB 文件上传、十六进制、「Binary - do not edit」、text/textarea） | 每列一行、按列类型给控件 | 相当 |
| 「要插入的行数」：`$cfg['InsertRows']` 默认 2，用户可在页面底部增减空白行 | 顶部可选「要插入的行数」（最多 50 组） | 相当（默认值不同；面板上限 50 与 phpMyAdmin 无硬上限是差异，影响极小） |
| 插入动作下拉（`templates/table/insert/actions_panel.twig`）：**Save** / **Insert as new row** / **Insert as new row and ignore errors**（`INSERT IGNORE`）/ **Show insert query** | 两个按钮：「插入」「插入并再填一行」；**没有 INSERT IGNORE / 只在屏幕上显示 SQL** | 更弱 |
| 「and then」后置动作：Go back to previous page / **Insert another new row** / Go back to this page / **Edit next row** | 「插入并再填一行」= Insert another new row；**无 Edit next row、无回上一页** | 更弱 |
| `Preview SQL` 按钮（提交前预览将执行的 SQL，另有「Show insert query」） | 无预览 SQL | 缺失 |
| `Reset` 按钮 | 无 | 缺失 |
| 忽略重复键：Insert as new row and ignore errors → `INSERT IGNORE`（`InsertEdit.php:1303`） | 无 | 缺失 |
| 更新重复键（`ON DUPLICATE KEY UPDATE`）：phpMyAdmin 的**插入页没有**；只在 CSV / CSV using LOAD DATA 导入时有「Add ON DUPLICATE KEY UPDATE」（`Config/Descriptions.php:797,804`、`ImportCsv.php:521`） | 无 | 相当（两者插入页都没有；phpMyAdmin 的导入侧能力面板也没有，见 2.6） |
| 函数下拉：`ShowFunctionFields` 默认显示，每列可选 NOW() 等 MySQL 函数并在插入时用函数而非字面值；默认函数按元类型配置（`$cfg['DefaultFunctions']`，如 `FUNC_SPATIAL => GeomFromText`、`FUNC_UUID => UUID`、`first_timestamp => NOW`） | **无函数下拉**；只能靠「留空用默认值」或改用 SQL 页写 `NOW()` | 缺失 |
| 显示字段类型（`ShowFieldTypesInDataEditView`，可界面切换） | 类型信息在表单里（按类型给控件、有默认值提示） | 相当 |
| NULL 勾选框（每列一个，FAQ 6.3；注意：输入字面量 `NULL` 不等于 NULL 值，必须用勾选框） | NULL 勾选框，且文案明确「显式写入 NULL（与留空不同）」 | 相当 |
| 空字符串 vs 留空：phpMyAdmin 靠直接输入空串 | 显式「空字符串」勾选框，并解释「NOT NULL 且无默认值时留空会被拒绝」 | 更强（把留空/NULL/空串三态讲清） |
| 外键下拉：外键候选值少于 `$cfg['ForeignKeyMaxLimit']`（默认 100）时给出下拉，显示形式由 `$cfg['ForeignKeyDropdownOrder']` 决定；另有「Browse foreign values」弹窗 | 无外键下拉、无浏览外键值 | 缺失 |
| TAB 键在字段间跳转、Ctrl+方向键任意移动（页面有提示） | 无此类提示/绑定 | 缺失 |
| 从另一张表插入（`INSERT ... SELECT`）：phpMyAdmin **没有**专门的表单入口，只能用 SQL 页写 | 面板也**没有** | 相当（两边都靠 SQL 页） |
| 多行插入 | 「要插入的行数」最多 50 组，一次事务插入 | 相当 |
| 插入后跳转/提示插入行数 | 显示「已插入 n 行（m 组）」，可切到浏览页 | 相当 |

来源：[config.html Editing mode](https://docs.phpmyadmin.net/en/latest/config.html#editing-mode)、[config.html MySQL settings](https://docs.phpmyadmin.net/en/latest/config.html#mysql-settings)、[faq.html 6.1/6.3/6.21](https://docs.phpmyadmin.net/en/latest/faq.html)。

### 2.4 SQL 页

| phpMyAdmin 的能力 | 自研面板 | 差异性质 |
| --- | --- | --- |
| 编辑器：CodeMirror（`$cfg['CodemirrorEnable']` 默认开），SQL 语法高亮与自动补全（`$cfg['EnableAutocompleteForTablesAndColumns']`）；`Format` 按钮格式化；`Clear` 清空 | 纯文本框编辑器，**无语法高亮、无自动补全、无格式化**；快捷键 Ctrl+Enter 执行 | 更弱 |
| 语法检查：`$cfg['LintEnable']` 默认开，用 SQL 解析器做错误提示 | 无 | 缺失 |
| 多语句执行：`Delimiter` 输入框（默认 `;`，可改以支持存储过程体）+ 空分隔符提交 | **一次一条语句**（`sql.placeholder`: 「输入一条 SQL 语句」）；无分隔符设置 | 更弱 |
| 「Show this query here again」/「Retain query box」（`$cfg['RetainQueryBox']`） | 执行后写语句留在本页 | 相当（面板行为等价于 Retain） |
| 「Rollback when finished」：执行完回滚事务，用于安全试跑 | 无 | 缺失 |
| 「Enable foreign key checks」（`SET FOREIGN_KEY_CHECKS`） | 无 | 缺失 |
| 「Bind parameters」：`:name` 参数化查询，勾选后弹出参数输入框（FAQ 6.40） | 无参数化 UI（内部有参数绑定，但用户写不了具名参数） | 缺失 |
| 「Get auto-saved query」：找回上一次自动保存的查询（另有「有已保存查询」的提示文案） | 无 | 缺失 |
| 「Show SQL query」预览（导出页也有） | 无 | 缺失 |
| 「Simulate query」：提交前模拟 DML 的影响行数（`Import/SimulateDml`） | 无 | 缺失 |
| 书签：`Bookmark this SQL query`（标签名 + 「Let every user access this bookmark」+ 「Replace existing bookmark of same name」）；书签下拉支持 Submit / View only / Delete 三态；书签内可放 `/*[VARIABLE1]*/` 占位符并在执行时填值；`$cfg['Servers'][$i]['bookmarktable']` 持久化 | **无书签** | 缺失 |
| 查询历史：`$cfg['QueryHistoryDB']`（默认 false，只存浏览器内存）+ `$cfg['QueryHistoryMax']`（默认 25）+ `pma__history` 表持久化 | **无查询历史** | 缺失 |
| 控制台（Console）：`k` / `Ctrl+K` / `Ctrl+Alt+C` 开关，含当前浏览查询、查询历史、可拖拽排列的图表、暗色主题（`$cfg['Console']` 各项） | 无控制台 | 缺失 |
| EXPLAIN：`$cfg['SQLQuery']['Explain']` 默认开，结果区提供 explain 链接；控制台菜单也有 `Explain` 动作 | 只有原生 SQL 页可手写 `EXPLAIN`；**「允许写入」未勾选时 EXPLAIN 属只读白名单**，但没有一键 explain 链接 | 更弱 |
| 其它 SQLQuery 链接：Edit（改这条查询）、ShowAsPHP（把查询包成 PHP 代码）、Refresh（`$cfg['SQLQuery'][*]` 默认全开） | 无 | 缺失 |
| 可视化构建器：库级 `Query by example` 的「Switch to visual builder」（`templates/database/qbe/index.twig`:16） | 无 | 缺失 |
| 多结果集：存储过程/多语句返回多个结果集可依次显示（intro.rst: "display multiple results sets through stored procedures or queries"） | 无多结果集展示 | 缺失 |
| SELECT 结果落在带完整浏览控件的结果区，可继续排序/编辑/导出 | SELECT 结果跳到浏览页并显示，但**只读、工具栏隐藏**；写语句留在本页显示影响行数 | 不同做法（面板把「读」与「写」分成两条呈现路径，代价是结果集不能二次操作） |
| 结果集导出（结果区 Export 链接，含 `raw` 导出模式） | 结果集不能单独导出（只有表/库级导出与「导出所选」） | 更弱 |
| 每条查询显示生成的 SQL、耗时、影响行数 | 显示影响行数或行数 + 耗时 | 相当 |
| 查询长度上限 `$cfg['MaxCharactersInDisplayedSQL']` 默认 1000，超长不入历史 | 结果截断提示 | 不同做法 |

来源：[config.html SQL query box settings](https://docs.phpmyadmin.net/en/latest/config.html#sql-query-box-settings)、[config.html Console settings](https://docs.phpmyadmin.net/en/latest/config.html#console-settings)、[config.html Various display setting](https://docs.phpmyadmin.net/en/latest/config.html#various-display-setting)、[faq.html 6.40](https://docs.phpmyadmin.net/en/latest/faq.html)、[bookmarks.html](https://docs.phpmyadmin.net/en/latest/bookmarks.html)、[intro.html Shortcut keys](https://docs.phpmyadmin.net/en/latest/intro.html#shortcut-keys)。

### 2.5 搜索页

| phpMyAdmin 的能力 | 自研面板 | 差异性质 |
| --- | --- | --- |
| **表搜索（Table search）**三个子标签：Table search / **Zoom search** / **Find and replace**（`templates/table/search/index.twig`:4-16） | 只有一个依例查询页 | 缺失（缺 Zoom search、Find and replace） |
| 表搜索表头：Function / Column / Type / Collation / Operator / Value，每列可选择参与 | 表头：字段/类型/排序规则/运算符/值，每列一行，填了值的行才参与 | 相当 |
| 运算符按列类型收敛，且清单相当丰富（`Types.php`）：TEXT 类含 LIKE、LIKE %...%、NOT LIKE、NOT LIKE %...%、=、!=、**REGEXP**、**REGEXP ^...$**、NOT REGEXP、`= ''`、`!= ''`、**IN (...)**、NOT IN (...)、BETWEEN、NOT BETWEEN；ENUM 只给 `=` 和 `!=`；数字类含 `> >= < <= !=` 与 LIKE/IN/BETWEEN 系列；UUID 有自己的清单 | 运算符按列类型收敛（数字/日期不给「包含」；enum 只给等值与空值判断）；支持等于/不等于/大于/大于等于/小于/小于等于/包含/不包含/开头是/结尾是/介于/属于集合/为空/不为空 | 更弱（面板缺 REGEXP 系列、`= ''` / `!= ''` 空串判断） |
| 条件之间用 **AND / OR 单选**（`ins_del_and_or_cell.twig`:12,24） | 条件之间只有 **AND**，无 OR | 更弱 |
| 「Add search conditions (body of the where clause)」：可手写任意 WHERE 片段 | 无（需任意 SQL 请用 SQL 页） | 缺失 |
| 「Extra options」：Select columns（至少一个、可 DISTINCT）、`DISTINCT` 复选框、`Order by` 列 + Ascending/Descending 单选 | 无列选择、无 DISTINCT、无排序选项 | 缺失 |
| 「Number of rows per page」在搜索页可设 | 结果跳浏览页后用浏览页分页大小 | 不同做法 |
| **Range search**：运算符选 BETWEEN / NOT BETWEEN 时弹出最小值/最大值对话框（FAQ 6.35，仅数字与日期列） | 「介于」运算符带下限/上限两个输入框 | 相当 |
| 搜索的 LIKE 语义：`LIKE %...%` 明确含通配符 `%` | 「包含/开头是/结尾是」把 `%` 与 `_` 当**普通字符**（参数绑定 + 转义），页面明确提示 | 不同做法（面板更安全可预期，但写不出 `%` 通配；phpMyAdmin 直接给 LIKE 让用户自己写通配） |
| **Zoom search**：把两列画成散点图，可滚轮缩放、平移、点选行并就地改值、指定点标签与最大绘图行数（FAQ 6.32） | 无 | 缺失 |
| **Find and replace**：跨列或指定列查找替换，支持正则，替换前有预览（Count / Original string / Replaced string）（`templates/table/find_replace/*.twig`） | 无 | 缺失 |
| **库级搜索**：`Search in database`，关键字（支持 `%` 通配），匹配方式五选一：至少含一个词 / 含全部词 / 精确短语作为子串 / 精确短语作为整个字段 / **正则**；可多选要搜的表、可限定到某一列 | 无库级搜索、无跨表搜索 | 缺失 |
| **多表 QBE**（库级 `Query by example`）：表头 Column / Alias / Show / Sort / Sort order / Criteria / Modify，可增删条件行与列（下拉可选 -3…+3 行/列），`Use tables` 多选参与表，「Update query」自动生成 SQL 并 JOIN 相关表，「Submit query」执行；有「Switch to visual builder」 | 无（面板 QBE 只在单表内） | 缺失 |
| 关系驱动的自动 JOIN：配置了 relation 表后，QBE 能自动连接所需表（FAQ 6.6） | 无 | 缺失 |
| 搜索结果页（库级）逐表列出匹配行数，带 Browse / Delete 动作（`templates/database/search/results.twig`） | 无 | 缺失 |
| 保存的搜索：`$cfg['Servers'][$i]['savedsearches']`（`pma__savedsearches`）可持久化搜索条件 | 无 | 缺失 |
| 执行后跳转到浏览页 | 执行后跳浏览页并回显条件条（可清除） | 相当 |

来源：[faq.html 6.6/6.32/6.35](https://docs.phpmyadmin.net/en/latest/faq.html)、[config.html Generic settings](https://docs.phpmyadmin.net/en/latest/config.html#generic-settings)、[intro.html Supported features](https://docs.phpmyadmin.net/en/latest/intro.html#supported-features)。

### 2.6 导出 / 导入

| phpMyAdmin 的能力 | 自研面板 | 差异性质 |
| --- | --- | --- |
| 导出格式 15 种（从发行包 `Plugins/Export/*.php` 的 `setText` 实取）：**CodeGen、CSV、CSV for MS Excel、Microsoft Word 2000、JSON、LaTeX、MediaWiki Table、OpenDocument Spreadsheet、OpenDocument Text、PDF、PHP array、SQL、Texy! text、XML、YAML** | **2 种**：SQL 转储、CSV | 缺失 |
| 压缩：`None` / `zipped` / `gzipped`（`$cfg['ZipDump']`/`GZipDump`/`BZipDump` 默认开；`$cfg['CompressOnFly']` 支持流式压缩大 dump）；文档另说明可压成 ZIP / GZip / RFC 1952 | 无压缩（浏览器侧生成纯 .sql / .csv） | 缺失 |
| 导出方式：`Quick - display only the minimal options` / `Custom - display all possible options`（`$cfg['Export']['method']`） | 无快/自定义两档 | 缺失 |
| 导出范围：整服务器 / 整库 / 多表 / 单表 / **结果集（raw 导出）** | 整库 / 当前表 / 所选表 / 「导出所选」（行） | 更弱（无服务器级、无结果集导出） |
| 输出：`View output as text` / `Save output to a file`（可 `Overwrite existing file(s)`；`$cfg['SaveDir']` 可存到服务器目录） | 一律下载到浏览器（面板明确说「导出在本机生成，不经过 agent」） | 不同做法（面板无「在浏览器里先看文本」，也无「存到服务器目录」） |
| 文件名模板：`$cfg['Export']['file_template_table'/'file_template_database'/'file_template_server']` 默认 `@TABLE@` / `@DATABASE@` / `@SERVER@`，支持 `@HTTP_HOST@`、`@SERVER@`、`@VERBOSE@`、`@VSERVER@`、`@DATABASE@`、`@TABLE@`、`@COLUMNS@`、`@PHPMYADMIN@` 等格式串 + strftime（FAQ 6.27） | 固定文件名（`export.done` 回显名字与大小） | 更弱 |
| 分文件导出：`Export databases as separate files` / `Export tables as separate files` | 无 | 缺失 |
| `Skip tables larger than: N MiB` | 无（面板改为行数上限 `EXPORT_ROW_CAP = 200_000`，超限的表在文件里被截断并告警） | 不同做法 |
| 导出字符集：`Character set of the file`（`$cfg['Export']['charset']`，默认不做转换，假定 UTF-8） | 无字符集选项 | 缺失 |
| `Encoding Conversion`（用 iconv/recoding 引擎做字符集转换，含 `$cfg['RecodingEngine']`、`$cfg['AvailableCharsets']`） | 无 | 缺失 |
| **导出模板**：`Export templates:` 可新建/更新/删除/加载（`Export/Template/*Controller`，存 `pma__export_templates`） | 无 | 缺失 |
| 别名导出：`Rename exported databases/tables/columns`（Define new aliases，可对库、表、列改名） | 无 | 缺失 |
| SQL 格式选项（`ExportSql.php`）：Add `DROP DATABASE IF EXISTS` / `CREATE DATABASE` / `DROP TABLE` / `CREATE TABLE` / `AUTO_INCREMENT value` / `CREATE VIEW` / `Use simple view export` / `Exclude definition of current user` / `OR REPLACE view` / `CREATE TRIGGER`；数据选项：`Truncate table before insert`、`INSERT DELAYED`、`INSERT IGNORE`、`Function to use when dumping data`、`Syntax to use when inserting data`、`Maximal length of created query`、`Complete inserts`（带列名）、`Extended inserts`（多行合一 INSERT）；另有 `Enclose export in a transaction`、`Disable foreign key checks`、`Export views as tables`、`Export metadata`、`Additional custom header comment`、`Display foreign key relationships`、`Display media types` | SQL 转储只三个勾选：**包含表结构（CREATE）、包含数据（INSERT）、包含 DROP TABLE**；可选整库或单表 | 更弱（缺 extended/complete inserts、事务包裹、外键检查开关、触发器/视图/事件/存储过程导出、注释与元数据等一大批） |
| SQL 导出对象覆盖：库/表结构、数据、视图、触发器、事件、存储过程、函数（`intro.rst`: "create, edit, call, export and drop stored procedures and functions"；"create, edit, export and drop events and triggers"） | 无触发器/事件/存储过程/函数导出（面板本身也不管理这些对象） | 缺失 |
| 导入格式 7 种（`Plugins/Import/*.php` 的 `setText` 实取）：**CSV、CSV using LOAD DATA、SQL、XML、OpenDocument Spreadsheet、MediaWiki Table、ESRI Shape File** | **2 种**：SQL 文件、CSV 文件（前端解析，按表头名对应列） | 缺失 |
| 导入方式：表单上传 / 从服务器上传目录选（`$cfg['UploadDir']`，用于超大文件）/ 直接从有效 SQL dump 走「Form based SQL Query」/**把文件拖放到页面任意位置**（`$cfg['enable_drag_drop_import']`、`import_export.rst`: "drag and drop it from your local file manager"） | 选择本地文件（浏览器侧读取），有大小上限（`IMPORT_BYTE_CAP`） | 更弱（无拖放、无服务器上传目录） |
| 导入 charset：`Character set of the file`（`$cfg['Import']['charset']`，默认不转换假定 UTF-8） | 无字符集选项 | 缺失 |
| **增量/中断续传导入**：`Partial import` 块——`Allow the interruption of an import in case the script detects it is close to the PHP timeout limit`（并提示可能破坏事务）+ `Skip this number of queries (for SQL) starting from the first one` | 无 | 缺失 |
| `Enable foreign key checks` 导入选项 | 无（SQL 转储头里自带 `SET FOREIGN_KEY_CHECKS=0` / `PRAGMA foreign_keys=OFF`） | 不同做法 |
| CSV 导入细节：Columns terminated with / enclosed with / escaped with / Lines terminated with、Column names、`Do not abort on INSERT error`、`Update data when duplicate keys found on import (add ON DUPLICATE KEY UPDATE)`；可在服务器或数据库层导入 CSV 并自动推断最佳结构（`import_export.rst`） | CSV 导入：首行是列名、空字段视为 NULL；按列名对应插入，字段数与表头不符的行会被跳过并报行号 | 更弱 |
| SQL 导入选项：`SQL compatibility mode`、`Do not use AUTO_INCREMENT for zero values` | 无 | 缺失 |
| 导入进度：`import_status` 模板 + `Import/StatusController`（AJAX 进度） | 有「正在导入…」忙碌态，无进度百分比 | 更弱 |
| 导入自动识别格式 | 需手选 SQL / CSV | 更弱 |

来源：[import_export.html](https://docs.phpmyadmin.net/en/latest/import_export.html)、[config.html Export and import settings](https://docs.phpmyadmin.net/en/latest/config.html#export-and-import-settings)、[config.html Web server upload/save/import directories](https://docs.phpmyadmin.net/en/latest/config.html#web-server-upload-save-import-directories)、[faq.html 1.16/6.4/6.5/6.12/6.23/6.27/6.30](https://docs.phpmyadmin.net/en/latest/faq.html)、[intro.html](https://docs.phpmyadmin.net/en/latest/intro.html)。

### 2.7 数据库级操作

| phpMyAdmin 的能力 | 自研面板 | 差异性质 |
| --- | --- | --- |
| 建库：首页 `$cfg['ShowCreateDb']` 的表单；库级 Operations 也有 | 「新建数据库」（可选字符集 + 排序规则，排序规则按字符集收敛并可留空） | 相当 |
| 删库：`Remove database`（`$cfg['AllowUserDropDatabase']` 可禁用）；面板侧需输入库名确认 | 「删除数据库」，要求**输入库名确认** | 更强（确认门槛更高） |
| 改库字符集/排序规则：Operations 里的 `Collation` 块，含 `Change all tables collations` 与 `Change all tables columns collations` 两个批量开关 | 「修改数据库的字符集」，且文案明确「只改数据库默认字符集，不会转换已有表与列」；**无批量改表/列排序规则** | 更弱 |
| 改库注释：`Database comment` | 无库注释编辑（面板的库注释概念未出现） | 缺失 |
| 库重命名：`Rename database to`（+ Adjust privileges） | 「重命名」，并如实说明 MySQL 无 `RENAME DATABASE`，实现是建库→搬表→删原库，大库耗时 | 相当（面板说明了代价，这点更好） |
| 库复制：`Copy database to`（结构 / 结构与数据 / 仅数据 + `CREATE DATABASE before copying` + Add AUTO_INCREMENT value + Add constraints + Switch to copied database + Adjust privileges） | 「复制数据库」（可选是否含数据）；明确说明视图不会被复制 | 更弱 |
| 库内表列表：表名 / 行数 / 类型（表还是视图）/ 排序规则 / 大小 / Overhead，可配置额外列（Charset、Comments、Creation、Last update、Last check，`$cfg['ShowDbStructure*']`）；`Check all` 勾选全部；表名前的星标加「收藏表」 | 左侧库/表树（搜索过滤、视图标记、行数、懒加载展开）；**无大小/Overhead/排序规则列，无收藏表** | 更弱 |
| 库内表批量动作：勾选多表后选一个操作批量执行（`DisableMultiTableMaintenance` 可禁） | 勾选多表 + 批量维护/批量删除 | 相当 |
| 库的比较与同步：文档明确 **`9.1 (withdrawn)` / `9.2 (withdrawn)`**（Synchronization 章节整节撤回） | 无 | 相当（官方已撤回，不能算 phpMyAdmin 的现役能力） |
| 库级标签页（`Util::getMenuTabList('db')`）：Structure、SQL、Search、Query、Export、Import、Operations、**Privileges、Routines、Events、Triggers、Tracking、Designer、Central columns** | 表级六页（浏览/结构/SQL/搜索/插入/操作）+ 导入导出 + 库操作；**无 Privileges/Routines/Events/Triggers/Tracking/Designer/Central columns** | 缺失 |
| 数据字典（Data dictionary） | 无 | 缺失 |
| 数据源管理：phpMyAdmin 的多服务器靠 `config.inc.php` 里的 `$cfg['Servers'][$i]`（多个服务器条目、`$cfg['ServerDefault']` 自动连、`$cfg['AllowArbitraryServer']` 允许用户自己填主机） | SQLite / MySQL / Redis 三类数据源：连接配置、测试连接、分组、标签、只读标记、搜索过滤、按类型/分组/标签分组显示 | 不同做法（面板是运行时可增删的数据源清单 + 分组/标签；phpMyAdmin 是配置文件里的服务器数组，改配置要动文件） |

来源：[config.html Main panel](https://docs.phpmyadmin.net/en/latest/config.html#main-panel)、[config.html Database structure](https://docs.phpmyadmin.net/en/latest/config.html#database-structure)、[faq.html 6.39](https://docs.phpmyadmin.net/en/latest/faq.html)、[faq.html Synchronization](https://docs.phpmyadmin.net/en/latest/faq.html#synchronization)、[privileges.html](https://docs.phpmyadmin.net/en/latest/privileges.html)。

### 2.8 用户与权限

| phpMyAdmin 的能力 | 自研面板 | 差异性质 |
| --- | --- | --- |
| `User accounts` 标签页：用户列表概览（`users_overview`），可从主页进入 | 无 | 缺失 |
| 新建用户：`Add user account` 链接（需 superuser 权限）；可配置用户名/主机/密码/认证插件，可选「为用户建一个同名数据库」并授全局权限，也可配置资源限制 | 无 | 缺失 |
| 编辑用户：铅笔图标进入，可改全局与库级权限、改密码、**把权限复制给新用户**（`copy those privileges to a new user`） | 无 | 缺失 |
| 删除用户：勾选后可选「同时删除同名数据库」再 Go | 无 | 缺失 |
| 权限授予：库级 `Privileges` 标签页、表级 `Privileges`、例程权限（`edit_routine_privileges`）；权限表分全局/库/表/列四级（FAQ 6.10 说明库名里下划线的通配符语义） | 无 | 缺失 |
| 修改密码：主页 `$cfg['ShowChgPassword']` 的 Change password 链接；`UserPasswordController`、`server/privileges/change_password`（config 认证模式下该链接无效） | 无 | 缺失 |
| 账号锁定/解锁：`AccountLockController` / `AccountUnlockController`（依赖 MySQL/MariaDB 的 account locking，读 `account_locked` 字段） | 无 | 缺失 |
| 认证插件选择：`mysql_native_password`、`sha256_password`、MariaDB 的 `mysql_old_password` 等（`Server/Privileges.php:795`） | 数据源配置里只有用户名/密码/主机/端口等连接字段 | 更弱 |
| 用户组与可配置菜单（`$cfg['Servers'][$i]['users']` + `usergroups`）：给用户组限定可见菜单项；文档**明确警告这只是限制「看见」而非限制「能做」**，不算安全边界 | 无用户概念；面板靠**数据源只读标记 + agent 写入开关**来限制，且是真正的执行前拦截 | 不同做法（phpMyAdmin 的等价机制自承不是安全边界；面板的是） |
| 导航树项隐藏/显示（`navigationhiding`，`pma__navigationhiding`） | 无 | 缺失 |

来源：[privileges.html](https://docs.phpmyadmin.net/en/latest/privileges.html)、[config.html Generic settings](https://docs.phpmyadmin.net/en/latest/config.html#generic-settings)、[faq.html 1.17a/4.6/6.10](https://docs.phpmyadmin.net/en/latest/faq.html)。

### 2.9 其他

| phpMyAdmin 的能力 | 自研面板 | 差异性质 |
| --- | --- | --- |
| **关系视图（Relation view）**：表级二级标签，维护 InnoDB 外键与 phpMyAdmin 内部关系，可设「Choose column to display」；浏览主表时外键列变成超链接并在悬浮时显示 display column（`relations.html`） | 无 | 缺失 |
| **Designer**：库级标签，图形化创建/编辑/展示关系，可拖放表位置、`Save page` / `Save page as` 保存布局（存 `pma__table_coords`）；可导出 PDF 图 | 无 | 缺失 |
| 关系视图的技术限制：需要 phpMyAdmin configuration storage；非 InnoDB 表的关系只由 phpMyAdmin 自己维持，别的应用看不到；当前版本 master_db 必须等于 foreign_db（不支持跨库关系） | 无关系功能 | 缺失 |
| **视图**：`view_create`（含 `OR REPLACE`）、结构页 Edit view / 删除视图 | 表树标记视图、可删视图；**不能建视图、不能改视图定义** | 更弱 |
| **存储过程与函数**：库级 Routines 标签，可创建/编辑/调用/导出/删除（`intro.rst`） | 无 | 缺失 |
| **触发器**：库级 Triggers 与表级 Triggers 标签，可创建/编辑/导出/删除；`SHOW CREATE TRIGGER` 查看 | 无（SQLite 驱动内部会读表拥有的 `CREATE TRIGGER` 语句用于重建表，但没有触发器管理界面） | 缺失 |
| **事件**：库级 Events 标签，可创建/编辑/导出/删除；导航树可显示事件（`NavigationTreeShowEvents`） | 无 | 缺失 |
| **跟踪 / 版本化（Tracking）**：库级与表级 Tracking 标签；`$cfg['Servers'][$i]['tracking']`（`pma__tracking`）；可跟踪表与视图、自动建版本（`tracking_version_auto_create`）、可配置纳入跟踪的语句集（`tracking_default_statements` 默认含 `CREATE TABLE,ALTER TABLE,DROP TABLE,RENAME TABLE,CREATE INDEX,DROP INDEX,INSERT,UPDATE,DELETE,TRUNCATE,REPLACE,CREATE VIEW,ALTER VIEW,DROP VIEW,CREATE DATABASE,ALTER DATABASE,DROP DATABASE`）、`tracking_add_drop_view/table/database`；提供 Versions / Tracking report / Structure snapshot / Delete tracking / Track table 动作 | 无 | 缺失 |
| **服务器状态**：`Status`（Traffic、Connections、ø per hour、Replication status）、`Query statistics`、`Processes`（可按 Show only active 过滤、可排序、可 **Kill** 进程、可自动刷新）、`Monitor`（可拖拽排列的实时图表、可增删图表、刷新率、导入/导出图表布局、重置默认）、`Advisor`（性能问题 + 建议 + 依据 + 用到的变量/公式） | 无（面板只有数据源连通性，无进程/监控/诊断） | 缺失 |
| **服务器变量**：`Variables` 页（按类别过滤、只显示异常值、按词过滤、显示未格式化值），可**修改**会话/全局变量（`GetVariableController`/`SetVariableController`） | 无 | 缺失 |
| **字符集**：`Charsets` 页（服务器字符集与排序规则一览）、Operations 与列级的排序规则选择、`Encoding Conversion`、`$cfg['DefaultConnectionCollation']`、`$cfg['AvailableCharsets']` | 建列/建库/改库处有排序规则下拉 | 更弱 |
| **引擎**：`Engines` 页与 `Show engine` 详情 | 表选项里可选引擎 | 更弱 |
| **插件**：`Plugins` 页 | 无 | 缺失 |
| **二进制日志**：`Binary log` 页（`Server/BinlogController`），可浏览 binlog | 无 | 缺失 |
| **复制**：`Replication` 页（`Server/ReplicationController`），主从状态 | 无 | 缺失 |
| **phpinfo**：`$cfg['ShowPhpInfo']`（默认关，文档警告会泄露服务器信息） | 无 | 缺失 |
| 界面主题：`$cfg['ThemeManager']` 默认开，用户可选主题；`$cfg['ThemeDefault']` 默认 `pmahomme`；`$cfg['ThemePerServer']` 可按服务器不同主题；官方主题目录 + 自定义主题（`themes.html`） | 无主题系统（面板有中英文本地化） | 缺失 |
| 语言：80 种语言，用户可切换（`$cfg['DefaultLang']`、`$cfg['Lang']`、`$cfg['FilterLanguages']`） | 中/英两套文案（`locales.ts` 里 zh-CN 与 en 两份） | 更弱 |
| 键盘快捷键（`intro.rst`）：`k` 与 `Ctrl+K` 开关控制台、`Ctrl+Alt+C` 开关控制台、`h` 回首页、`s` 打开设置、`d`+`s` 去库结构、`d`+`f` 搜索库、`t`+`s` 去表结构、`t`+`f` 搜索表、`Backspace` 回上一页；`$cfg['DisableShortcutKeys']` 可整体禁用 | 只有 Ctrl+Enter 执行 SQL | 缺失 |
| **两因素认证**（`two_factor.html`）：`Authentication Application (2FA)` 基于 HOTP/TOTP，可用二维码扫码录入；`Hardware Security Key (FIDO U2F)`；另有仅用于测试演示的 `Simple two-factor authentication`（需 `$cfg['DBG']['simple2fa']`，文档明确说它并不提供真正的两因素、不应在生产使用）。需先配好 configuration storage，用户各自在 Settings 里选用 | 无 2FA；登录/权限用的是 dsh 自身的宿主机制（不在本插件范围内） | 缺失 |
| **图表（Charts）**：从 SQL 结果区点 `Display chart`，可选图表类型（bar / column / line / spline / area / pie / timeline，仅列出与当前 series 选择兼容的类型）、X 轴、多个 Series、标题、轴标签、起始行与行数；支持堆积（stacking）；用 jqPlot 绘制（`charts.rst`）。限制：只有 1～3 列的表能画（FAQ 6.29） | 无 | 缺失 |
| **数据变换（Transformations）**：输出变换（浏览时把 BLOB 显示成图片 / 下载链接、Hex、日期格式化、Bool2Text、Substring、External、SQL/JSON/XML 格式化、IPv4 双向、PreApPend、TextImageLink、TextLink 等）与输入变换（CodeMirror SQL/JSON/XML 编辑器、图片上传、文件上传、正则校验、IP↔binary）；列结构页有五个相关字段：Media type、Browser transformation、Browser transformation options、Input transformation、Input transformation options；插件目录 `libraries/classes/Plugins/Transformations/`（Output 15 个、Input 7 个、Text_Plain_Link 等）；需配 `column_info` 表 | 无 | 缺失 |
| **PDF 图表 / 结构导出**：Designer 里选 `Export schema` 导出 PDF（需先建 PDF page）；`$cfg['Schema']['format']` 支持 `pdf` / `eps` / `dia` / `svg`；`$cfg['PDFPageSizes']`（A3/A4/A5/letter/legal）、`$cfg['PDFDefaultPageSize']` 默认 A4；依赖 TCPDF | 无 | 缺失 |
| **GIS 可视化**：结果区 `Visualize GIS data`（`Table/GisVisualizationController`）；几何列可显示为 Geometry / Well Known Text / Well Known Binary | 无 | 缺失 |
| 打印视图：表结构、库结构、结果集都有 Print 按钮（`printview=1`） | 无 | 缺失 |
| 偏好设置（Settings）：可搜索的设置树（Main panel / Navigation panel / Browse mode / Editing mode / Export / Import / SQL query box / Console / 2FA / …）；可导入导出偏好（JSON / PHP / 浏览器本地存储）、可重置；`$cfg['UserprefsDisallow']` 可禁止用户改某些项；`$cfg['UserprefsDeveloperTab']` 开发者标签；无 configuration storage 时偏好只存浏览器本地存储 | 无设置页（面板设置是数据源级的几个开关） | 缺失 |
| 页面标题可定制：`$cfg['TitleTable']`、`$cfg['TitleServer']`、`$cfg['TitleDatabase']` 等支持格式串；登录页标题不可改 | 无 | 缺失 |
| 使用提示（hints）：`$cfg['ShowHint']` 默认开，悬停表头等显示提示 | 面板大量 inline hint 文案 | 相当 |
| 每 X 个单元格重复表头：`$cfg['RepeatCells']` 默认 100（0 关闭） | 无 | 更弱 |

来源：[transformations.html](https://docs.phpmyadmin.net/en/latest/transformations.html)、[two_factor.html](https://docs.phpmyadmin.net/en/latest/two_factor.html)、[charts.html](https://docs.phpmyadmin.net/en/latest/charts.html)、[relations.html](https://docs.phpmyadmin.net/en/latest/relations.html)、[themes.html](https://docs.phpmyadmin.net/en/latest/themes.html)、[intro.html](https://docs.phpmyadmin.net/en/latest/intro.html)、[config.html](https://docs.phpmyadmin.net/en/latest/config.html)、[faq.html 6.8/6.29/6.32/6.37](https://docs.phpmyadmin.net/en/latest/faq.html)。

---

## 3. 按重要性排序的缺口清单

只挑真正影响日常使用的，从最痛开始。

1. **导出格式只有 SQL 与 CSV**——需要 JSON / XML / Excel 兼容 CSV / ODS 给同事或喂给脚本时，只能自己从 CSV 转（phpMyAdmin 15 种格式 + 压缩 + 别名 + 模板）。
2. **导出无 gzip / zip 压缩，且单表 20 万行硬截断**（`sql-transfer.ts:96`）——大表备份要么分片要么失败；phpMyAdmin 靠 `CompressOnFly` 流式压缩 + 分文件导出。
3. **导入只支持 SQL 与 CSV，无部分导入 / 断点续传 / charset 选项**——大 dump 遇到超时只能整段重来；phpMyAdmin 有「允许中断 + 跳过前 N 条语句」。
4. **没有用户与权限管理**（建用户、授权、改密码、账号锁定）——这是 phpMyAdmin 最核心的管理员用途之一，面板完全没有。
5. **没有服务器状态/进程/变量/字符集/引擎/插件/binlog/复制页**——慢查询、锁、连接数、改会话变量这类排障动作面板一概做不了，必须另开客户端。
6. **没有 EXP 一键 explain、没有查询历史、没有书签**——排查慢查询和复用常用 SQL 的日常动作都缺失（phpMyAdmin 还有可持久化的历史与带变量的书签）。
7. **SQL 页一次只能跑一条语句、无自动补全/语法高亮/格式化**——写迁移脚本、建存储过程时必须换工具。
8. **没有视图、触发器、存储过程、函数、事件的管理**——面板能列出视图并删除，但不能创建或修改其中任何一个；这些对象是 phpMyAdmin 的常规能力。
9. **没有关系视图与 Designer**——看不到外键连线图，也不能在图形界面上建关系；排查表间引用只能读 DDL。
10. **没有跟踪 / 版本化**——结构变更没有历史记录，改错了无法回溯对比。
11. **结构页缺「移动列顺序」与「列宽拖动/列重排/列隐藏」**——调表结构布局和看宽表时体验明显受限（phpMyAdmin 在 Browse 与 Structure 两处都能拖）。
12. **索引能力偏窄**：面板索引通路只有 primary / unique / index 三种，**不能建 FULLTEXT 与 SPATIAL 索引**（`column-index-plan.ts:176` 明确说明该通路的限制）；也没有索引列前缀长度、Parser、Key block size、Index type(BTREE/HASH)、Cardinality 显示。
13. **插入页没有函数下拉**（NOW() / UUID() / GeomFromText()）——phpMyAdmin 的 `DefaultFunctions` 会在插入/编辑时按元类型默认填函数；面板只能留空走默认值或改用 SQL 页。
14. **插入页没有 INSERT IGNORE、没有 SQL 预览、没有重置**——「插错了想看一眼要执行的 SQL」这个动作做不了。
15. **没有外键下拉与「Browse foreign values」**——填外键列时得先自己查那张表。
16. **搜索页只有 AND，没有 OR，也没有手写 WHERE 片段、DISTINCT、列选择、排序选项**——稍复杂的条件就必须切到 SQL 页；phpMyAdmin 还能用正则运算符。
17. **没有库级搜索（跨表 / 正则）与 Zoom search、Find and replace**——「这个值在哪个表里」这个最常问的问题面板答不了。
18. **没有多表 QBE 与可视化构建器**——phpMyAdmin 的库级 QBE 能自动 JOIN 相关表并生成 SQL。
19. **结果集不能二次操作**（过滤/排序/导出/建视图/图表），且不能行内编辑——这是面板**故意**的设计取舍，但对「跑个 JOIN 想顺手改一个值」的场景是功能损失。
20. **没有「显示全部」按钮、没有首页/末页、没有客户端行过滤、没有多列排序、没有 Shift 区间选择**——大表翻页与快速定位的效率差距。
21. **没有表结构统计区（空间占用 / Overhead / 行统计 / 创建时间 / 最后更新时间 / 最后检查时间）与库内表列表的大小/Overhead/排序规则列**——判断「哪张表在膨胀」的能力缺失。
22. **没有分区管理与分区维护**。
23. **没有 Checksum / Defragment / Flush 表**（有 Check/Optimize/Repair/Analyze 四件套）。
24. **没有「Propose table structure」（PROCEDURE ANALYSE）与规范化向导（Normalize）**——列类型与范式建议没了。
25. **没有中央列（Central columns）与数据字典**——同义列名/类型一致性靠人工。
26. **没有字符集转换（Encoding Conversion）与 RecodingEngine**。
27. **没有 2FA、没有主题系统、语言只有中英两种**（phpMyAdmin 80 种 + 可切换主题）。
28. **没有键盘快捷键体系**（phpMyAdmin 有 9 组，含控制台开关、跳库结构/表结构、搜索）。
29. **没有打印视图与 PDF schema 导出**。
30. **没有图表（Charts）与 GIS 可视化**。
31. **没有数据变换（Transformations）**——BLOB 不能直接显示成图片/下载链接，也没有输入侧的编辑器与校验插件。
32. **没有偏好设置页（Settings）与偏好导入导出**；对比之下面板的设置面只有数据源级开关。
33. **没有收藏表 / 最近使用表**（phpMyAdmin `NumRecentTables`/`NumFavoriteTables` 各默认 10，表名前星标即收藏）。
34. **没有登录态上下文**：phpMyAdmin 用 MySQL 自身账号，权限由 MySQL 判定；面板用数据源配置，因而「同一个库、不同人不同权限」这件事在面板里表达不出来（只能靠只读标记）。

---

## 4. 面板相对 phpMyAdmin 的独有之处

这几项在 phpMyAdmin 里**没有对应物**（或官方已撤回），是面板真正的增量。

| 独有能力 | 为什么 phpMyAdmin 没有 | 价值 |
| --- | --- | --- |
| **Redis 数据源**：键树、按前缀分层的索引（`redis-index.ts`）、值查看与编辑（string / hash / list / set / zset / stream 条目）、TTL 设置（`PERSIST` 语义与 `EXPIRE 0` 区分）、命令行、按前缀删除/计数、多 DB 切换 | phpMyAdmin 是 MySQL/MariaDB 专用（`require.html` 与 `intro.rst` 都只讲 MySQL/MariaDB） | 一个面板同时管关系库和缓存，不用再开 redis-cli |
| **写权限闸门（agent 写入开关 + 审批）**：`allowAgentWrite`（默认 false）+ `requireApproval`（默认 true），分两层拦截——拒绝直接返回、需要审批时走宿主审批提示（`auth.ts`） | phpMyAdmin 的「用户组菜单」文档**自承只是限制可见项、不构成安全限制**，建议用 MySQL 权限来真正限制 | 对「AI agent 自动操作数据库」这个场景，这是 phpMyAdmin 从来没有、也不打算有的防护层 |
| **「结果集」与「表读」明确分成两种模式**：查询结果落到浏览页但工具栏整块隐藏、只读；phpMyAdmin 两者共用同一条渲染路径，结果集天然带编辑/删除链接 | phpMyAdmin 的取舍是「能对结果集继续操作」，代价是 FAQ 3.10 记录的误编辑风险（无主键时不确定改的是哪一行） | 面板换来「不会把 JOIN 结果误当可编辑表」；这是把风险显式化而非隐藏 |
| **行内编辑的前置条件更严**：无主键就禁用行内编辑与批量删除，并把原因写进文案 | phpMyAdmin 用「唯一键」判定，且可配置 `RowActionLinksWithoutUnique` 打开无唯一键时的行动作（默认关） | 面板不给「可能会改错行」的开关，判定更保守 |
| **插入页把三态讲清**：留空（用默认值）/ NULL 勾选（显式 NULL）/ 空字符串勾选（显式 `''`）——后者是 phpMyAdmin 没有的显式控件，且解释了「NOT NULL 且无默认值时留空会被拒绝」 | phpMyAdmin 靠用户直接输入空串来表达空字符串 | 消除「留空 vs NULL vs 空串」这个长期的经典误用 |
| **结构页操作列固定在最右 + 表格超出横向滚动** | phpMyAdmin 的行动作位置可配置（`RowActionLinks` 左/右/两侧/无），但固定列与横向滚动不是它的行为 | 宽表下操作入口始终可见 |
| **引擎能力差异被显式呈现而非抹平**：SQLite 明确告知「没有 REPAIR 语句」「不能改库编码」「ADD COLUMN 只能加在最后」「不能加 NOT NULL 且无默认值的列」；MySQL 的 `repair` 在 InnoDB 上会报「引擎不支持」也被如实回显（`SqlTableActions.ts:615`、`SqlOperationsTab.ts`） | phpMyAdmin 主要面向 MySQL/MariaDB，没有这种跨引擎能力协商的需求 | 用 SQLite 时不会看到「点了没反应」或「假成功」 |
| **数据库重命名/复制的代价被如实说明**：文案直接写「MySQL 没有 `RENAME DATABASE`，这一步会新建目标库、把所有表移过去、再删除原库。大库上需要时间」 | phpMyAdmin 只是提供 `Rename database to` | 大库上不会误以为这是一步原子操作 |
| **唯一值统计（非重复值计数）作为结构页的一列常显** | phpMyAdmin 有「Distinct values」动作（跳去执行 `SELECT COUNT(*), col FROM t GROUP BY col`），不是结构页常显列 | 一眼看出列的基数与选择性 |
| **数据源分组/标签/只读标记 + 运行时可增删** | phpMyAdmin 的服务器清单在 `config.inc.php` 里，增删要改文件 | 面板不重启、不改配置就能加一个库 |
| **导入导出的执行位置明确**：面板在浏览器侧生成/解析，文案写明「导出在本机生成，不经过 agent」「SQL 文件按语句逐条执行；CSV 按列名对应插入」 | phpMyAdmin 全部在服务端 PHP 里做 | 数据不落到服务端临时目录，边界更清楚 |
| **对弹性的如实报告**：导出被行数上限截断时给出「有 n 张表的行数超过导出上限，文件中的这些表被截断」；导入时字段数与表头不符的行会被跳过并报出行号 | phpMyAdmin 的对应场景是 PHP 超时/内存报错（FAQ 1.16 让用户去改 php.ini） | 失败信息可行动 |

---

## 5. 不确定项

以下几条我没能从官方文档或官方源码确认，**不下结论**：

1. **phpMyAdmin 插入页是否提供 `ON DUPLICATE KEY UPDATE`**。我在 5.2.3 发行包里只找到 `INSERT IGNORE`（`InsertEdit.php:1303`）与 CSV/LOAD DATA 导入侧的 `Add ON DUPLICATE KEY UPDATE`（`Config/Descriptions.php:797,804`）。插入页是否有第三态（如「插入或更新」）未确认——需要看 `InsertEdit::buildSqlQuery` 的完整分支或有 MySQL 环境实测。
2. **Browse 页多列排序的确切交互**。源码里 `getSingleAndMultiSortUrls` 生成 `single_sort_order` / `multi_sort_order` 两个 URL，说明多列排序存在，但触发方式（是否 Shift+点击，还是历史上由「按索引排序」间接达成）我没在官方文档里找到说明。
3. **phpMyAdmin 的 Shift 范围选择是否覆盖 Browse 的复选框**。FAQ 6.26 说「works everywhere you see rows, for example in Browse mode or on the Structure page」，但没说是否作用于复选框；`makegrid.js` 里我读到的 `checkall_box` 逻辑未包含 shift 区间分支。
4. **面板「导出所选」的确切语义**。`export.scope.selected` 的中文是「仅所选」、英文是「Selected rows only」，但结构页的 `db.selectedCount` 是「已选 n 张表」。我倾向前者指行、后者指表，但没有实测确认导出对话框在表级与行级两处的取值差异。
5. **面板的 `IMPORT_BYTE_CAP` 具体数值**。只确认了常量名与「文件过大」文案，未读到数值。
6. **面板结构页是否能显式创建生成列**。我读到的是生成列被**识别与保护**（禁改、禁插值），并有建表对话框的列定义通路；能否在既有表上新增生成列未确认。
7. **phpMyAdmin 5.2 是否仍在界面暴露 `$cfg['EditInWindow']` 的弹窗编辑**。文档标注该设置在 4.3.0 被移除，所以按「已移除」处理，但没进一步核实替代交互。
