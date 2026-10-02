---
zone: core-infra-sql
agent: domain-survey
files_scanned: 18
---

## 摘要

本区是 core 的「数据库底座 + 文本编解码」三块地基。`infra/tdbc/` 定义 core 与 SQLite 之间的零原生依赖连接协议（接口 + 驱动注册表 + URL 解析 + 模板桥），真正实现按平台拆到 `packages/tdbc-driver-*`。`infra/sql-template/` 是一套自研的 MyBatis 风格动态 SQL 解析器（词法 → AST → 求值），全仓 24 个文件经它拼 SQL。`infra/serialization/` 是 Zod/YAML/JSON 的配置层编解码，外加一个手写的 Zod→JSON Schema 转换器给 LLM 工具用。根目录三个文件是各自领域的小工具（KKV 布尔串、日期格式化、UUID v4）。

## 职责与边界

**tdbc（协议层，`packages/core/src/infra/tdbc/`）**
- `ports/connection.port.ts` — `TdbcConnection` 五方法契约（execute / query / batch / transaction / close）。
- `ports/driver.port.ts` — `TdbcDriver` 插件契约（`name` + `open`）。
- `logic/registry.ts` — 进程级 `Map<string, TdbcDriver>`，last-wins。
- `logic/open.ts` — `tdbc:sqlite:…` URL 解析 + 驱动解析 + open 工厂。
- `logic/normalize-bindings.ts` — `undefined → null` 的绑参归一化。
- `logic/template-helper.ts` — sql-template 与 TdbcConnection 的桥（`executeTemplate` / `queryTemplate`）。
- `errors.ts` — `TdbcError` + 6 个错误码。
- 边界：本区**不碰表、不碰 KKV 域、不碰文件**。唯一「数据访问」是打开 SQLite 文件（`OpenOptions.filename`）。

**sql-template（`packages/core/src/infra/sql-template/`）**
- `parser.ts` — 阶段一：词法扫描 + AST 构造（`parseTemplateToAst` / 有状态 `TemplateParser` 带 AST 缓存）。
- `evaluator.ts` — 阶段二：AST + 运行时参数 → `{sql, parameters}`。
- `expression.ts` — `test` 表达式的归一化 + `new Function` 编译求值（带编译缓存 + 禁用词黑名单）。
- `context.ts` / `context-proxy.ts` — foreach 作用域栈 + 点路径解析。
- `placeholder.ts` — `#{...}`（绑参）/`${...}`（原样内联）渲染。
- `tags/{where,trim,foreach}.ts` — 三个标签的实现；`<if>/<choose>/<when>/<otherwise>` 在 evaluator 内联。
- 边界：纯字符串变换，**不接触数据库**。唯一外部依赖是 `TdbcConnection`（经 template-helper，type-only import）。

**serialization（`packages/core/src/infra/serialization/`）**
- `decode.ts` / `encode.ts` — Zod `safeParse` 与 `schema.toWire` 的薄封装，失败抛 `ConfigDecodeError`。
- `parse-text.ts` / `stringify-text.ts` — YAML/JSON 文本互转。
- `zod-to-json-schema.ts` — 给 LLM 工具 `input_schema` 用。
- 边界：不碰数据库/文件；`stringifyText` 产出的是内存字符串，由调用方（desktop/mobile/cli 的 yaml service）落盘。

**根文件**
- `kkv-value-codec.ts` — KKV 里 `"true"/"false"` 与 boolean 的互转（唯一消费方 `PersistentPreferencesService`，域 `nm-preferences`）。
- `date-format.ts` — 本地时区 `yyyy-MM-dd HH:mm:ss`（prompt `$time` 宏 + workplace 文件 mtime 显示）。
- `random-uuid.ts` — 跨端 UUID v4（`crypto.randomUUID` → `getRandomValues` → `Math.random` 三级降级）+ 正则校验。

## 对外接口

| 符号 | 位置 | 出口 |
|---|---|---|
| `TdbcConnection` / `TdbcDriver` | `tdbc/ports/*.ts` | `@novel-master/core` 主入口 + `@novel-master/core/tdbc` |
| `TdbcError` / `TdbcErrorCode` | `tdbc/errors.ts` | 主入口（`apps/mobile/__tests__/errors.test.ts` 消费） |
| `open` / `parseUrl` / `ParsedTdbcUrl` | `tdbc/logic/open.ts` | 主入口 |
| `registerDriver` / `getDriver` / `listDrivers` / `resolveDriver` / `clearDrivers` | `tdbc/logic/registry.ts` | 主入口（`clearDrivers` 标 `@internal`） |
| `normalizeBindings` | `tdbc/logic/normalize-bindings.ts` | 主入口；`packages/tdbc-driver-better-sqlite3/src/connection.ts:14` 唯一生产消费方 |
| `executeTemplate` / `queryTemplate` | `tdbc/logic/template-helper.ts` | 主入口 + 24 个仓储文件经 `@/infra/tdbc/logic/template-helper.js` |
| `SqlTemplateParser` / `SqlTemplateError` / `parseTemplateToAst` / `normalizeExpression` / `bindExpressionToContext` / `evaluateTest` / `AstNode` / `SqlParseResult` / `ParseOptions` | `sql-template/` | 主入口（`packages/core/src/index.ts:9-23`） |
| `decode` / `encode` / `EncodableSchema` | `serialization/decode.ts` `encode.ts` | 主入口；desktop/mobile/cli 的 `*-yaml.service.ts` 消费 |
| `parseText` / `TextFormat` / `stringifyText` | `serialization/parse-text.ts` `stringify-text.ts` | 主入口 |
| `zodToJsonSchema` | `serialization/zod-to-json-schema.ts` | **不经主入口**，经 `@novel-master/core/provider`（`public/provider.ts:118`）→ `infra/llm-protocol/logic/tool-definitions.ts:26` |
| `parseBoolean` / `formatBoolean` | `kkv-value-codec.ts` | **模块私有**（不进 index.ts），仅 `service/persistent-preferences/impl/persistent-preferences.service.ts:9` |
| `formatLocalDateTime` | `date-format.ts` | `@novel-master/core/provider`（`public/provider.ts:109`）+ 内部两处 |
| `randomUUID` | `random-uuid.ts` | 模块私有；6 处 domain/service 消费。`isRandomUuidV4` **仅测试用**（`test/infra/random-uuid.test.ts`、`test/agent/agent-runner.test.ts`） |

## 数据访问

本区自身**不直接读写任何表**。它提供的是「怎么把 SQL 送进连接」的能力。实际被本区能力触碰的存储面：

- **SQLite 文件（唯一直接数据访问）**：`open()` → `OpenOptions.filename`。生产 URL 形态实测三种：
  - `apps/cli/src/runtime.ts:180`、`apps/desktop/src/main/runtime/connection.ts:38`、`apps/desktop/src/main/services/db-backup.service.ts:60` — `tdbc:sqlite:file:${dbPath}` + `driver: "better-sqlite3"`
  - `apps/mobile/src/vfs/constants.ts:9` — `tdbc:sqlite:file:${MOBILE_VFS_DB_NAME}`，消费方 `apps/mobile/src/db/connection.ts:74` 传 `driver: 'op-sqlite'`
  - 测试与 conformance 大量使用 `tdbc:sqlite:file::memory:`
- **KKV 域 `nm-preferences`**：`kkv-value-codec.ts` 只做字符串↔boolean，**不自己开连接**，经 `PersistentPreferencesService` 落到 `service/kkv`（`sqlite-kkv.repository.ts`）。已核实唯一写入方是同文件 `:31/:47/:63/:79`，读方 `:119`。
- **表名 / KKV 域常量**：`sql-template` 的 `${...}` 原样内联在生产里被用于内联**表名常量**（非用户数据），实测 24 个消费文件中全部为编译期常量拼接：`schema-migrations-table.ts:37,65`、`sqlite-skill-disabled-rule.repository.ts:59,68,90,97,110`、`sqlite-workplace.repository.ts:167,173,184,195`、`sqlite-vfs-revision.repository.ts:99,197,347` 等。
- **文件路径**：无。`serialization` 只产出内存字符串；`date-format` / `random-uuid` / `kkv-value-codec` 无 IO。

## 依赖关系

**import 了谁**

| 上游 | 用在哪 | 性质 |
|---|---|---|
| `zod`（^4.4.3，`packages/core/package.json:133`） | `serialization/decode.ts` `encode.ts` `zod-to-json-schema.ts` | 唯一三方运行时依赖 |
| `yaml` | `serialization/parse-text.ts` `stringify-text.ts` | 同上 |
| `@/errors/config-decode-errors.js` | `decode.ts` `encode.ts` `parse-text.ts` | 本仓内 |
| 本仓外 → 本区 | 全部经 `packages/core/src/index.ts` / `public/provider.ts` 单一出口，无 deep import 破口 | — |

**被谁消费**（生产代码，不含测试）

- `TdbcConnection` 类型：几乎整个 `domain/*/repositories/impl/*` 与 `service/*/impl/*` 都以它为参数类型。`git grep -l infra/tdbc` 命中 130+ 文件。
- `SqlTemplateParser`：**24 个生产文件**直接 `new SqlTemplateParser()`。分布：
  - 仓储 18 个 — `sqlite-{agent-definition,message,project,session,kkv,message-checkpoint,provider,saved-model,session-kkv,session-run-state,skill-disabled-rule,smart-sort-rule,workplace}.repository.ts`、`sqlite-vfs-{entry,revision}.repository.ts`、`sqlite-vfs-content-store.ts`
  - service 1 个 — `service/chat/impl/usage-stats.service.ts:170`
  - bootstrap 3 个 — `provider/seed-builtin-providers.ts:18`、`schema-migrations/schema-migrations-table.ts:15`（模块级 `const`）、`domain/provider/logic/find-saved-model-references.ts:16`（模块级 `const`）
  - 旁路 1 个 — `infra/sksp/impl/base-sqlite-secret-store.ts:29`（**相对路径** `../../sql-template/index.js`，非 `@/` 别名）
- `decode` — 8 个生产文件（`validate-agent-definition`、两个 repository、`project/session/compaction-conditions` service、`smart-sort-rule-io`、`kkv-model-suggestion.repository`、`assess-agent-definition-wire`）。
- `encode` — 2 个（`sqlite-agent-definition.repository.ts:15`、desktop/mobile 的 yaml service 经主入口）。
- `parseText` — `domain/skills/logic/parse-skill-front-matter.ts:11` + 三个 yaml service + cli。
- `stringifyText` — `character-card-to-md-tree.ts:98` + 三个 yaml service + cli。
- `zodToJsonSchema` — 唯一生产消费方 `infra/llm-protocol/logic/tool-definitions.ts:26`（被 `service/agent/impl/agent-runner.ts:273` 每轮调用）。
- `randomUUID` — 6 个生产文件（`generate-agent-run-id`、`in-memory-agent-session`、`message.service`、`project.service`、`session.service`、`provider.service`、`provider-model.service`）。
- `formatLocalDateTime` — `expand-dynamic-macros.ts:38`、`workplace-display.ts:22`。
- `parseBoolean`/`formatBoolean` — 1 个生产文件。

**依赖方向上的一处观察**：`serialization/zod-to-json-schema.ts` 被 `infra/llm-protocol` 消费，而 `llm-protocol` 又反过来是 `infra` 的兄弟目录——同层互依（`infra/serialization` ↔ `infra/llm-protocol`），不是分层违规但也不是干净的单向。

## 发现清单

### F-core-infra-sql-1 | P1 | packages/core/src/infra/sql-template/parser.ts:46

```
private readonly astCache = new Map<string, AstNode[]>();
```

**描述**：`TemplateParser` 的 AST 缓存以**整条模板字符串**为 key，且**无上界、无淘汰**（注释 `:43` 自称「模板字符串通常数量有限（来自配置），缓存增长可控，不需要 LRU」——这个前提在生产里不成立）。生产仓储大量用**变长 arity 拼模板**：`sqlite-message-checkpoint.repository.ts:401`（`messageIds.map((_, i) => '#{id' + i + '}')`）、`:120`、`:382`、`sqlite-vfs-entry.repository.ts:175-180`（chunk 200）、`sqlite-vfs-revision.repository.ts:99,197,347`、`sqlite-session-kkv.repository.ts:43-48`（chunk 400）、`sqlite-session-run-state.repository.ts:121`。每种 arity 是一条**独一无二的模板串**，于是产生一条永久缓存条目，而 AST 本身大小随 arity 线性增长。

注意 `chunkSize = 200` / `GET_MANY_CHUNK_SIZE = 400` 这类分片只保证**单次调用**的 arity 有界，不保证**不同调用**的 arity 集合有界——最后一个不满片的 chunk 长度可以是 1..199 任意值。

**实测**（`TemplateParser` 直接驱动，Node 22，`--max-old-space-size=4096`）：

```
baseline heap 15 MB
cumulative arities 1..100:  heap 17.5 MB, cache entries 100
cumulative arities 1..250:  heap 20.5 MB, cache entries 250
cumulative arities 1..500:  heap 32.9 MB, cache entries 500
cumulative arities 1..1000: heap 94.5 MB, cache entries 1000
cumulative arities 1..1500: heap 193.8 MB, cache entries 1500
cumulative arities 1..2000: heap 337.6 MB, cache entries 2000
```

另一轮跑到累计 3000 个 arity 时堆已到 **739 MB**；继续推到 8000 时进程 **OOM 崩溃（exit 134）**。增长是超线性的（≈O(n²) 的总驻留，因为条目数 O(n) 且每条目本身 O(n)）。桌面/cli 长驻进程会随会话操作单调增长；RN 侧更危险（内存预算小得多）。

**建议**：(a) 把 `TemplateParser` 换成模块级共享 + LRU/容量上限（如 256 条），或 (b) 取消缓存——实测 20k 条不同模板全解析仅 39ms，缓存的收益远小于其泄漏代价，(c) 至少给变长 arity 的模板改用固定占位名 + 参数数组（`?` 位置参数），使模板串恒定。选 (c) 最彻底：`buildInBindings` 已经在按 arity 生成名字，改成纯 `?` 拼接即可让 24 个消费文件的模板全部变成常量。

**置信**：confirmed（内存数字为本机实测；生产可达性已逐个核实 arity 来源）

---

### F-core-infra-sql-2 | P1 | packages/core/src/infra/tdbc/ports/connection.port.ts:37

```
 * Runs `fn` inside a transaction. Nested calls throw `NESTED_TRANSACTION`.
```

**描述**：port 文档承诺「嵌套调用抛 `NESTED_TRANSACTION`」。实测（better-sqlite3 驱动，core 测试 tsconfig 路径）：

```
tx.transaction -> TdbcError: Nested transactions are not supported | outer conn.transaction -> TIMEOUT/DEADLOCK
```

`tx.transaction(...)` 确实抛 `NESTED_TRANSACTION`（由 `TransactionalConnection.transaction` 主动 reject，见 `packages/tdbc-driver-better-sqlite3/src/connection.ts:204-212`）。但**在事务回调里调外层 `conn.transaction(...)` 不是抛错，是死锁**——外层 `transaction()` 先 `this.mutex.run(...)` 抢 `AsyncMutex`，回调内再调一次就在同一把不可重入的互斥锁上排队，永久挂起（我给的 2.5s 超时先到）。这是 RULE「VACUUM 与维护类 SQL」条目已经写明的**同一个 AsyncMutex 不可重入陷阱**（「事务回调里误用外层 conn 调服务会撞驱动层 AsyncMutex 不可重入（死锁而非报错）」）——所以**行为本身是有意/已知的**，但 **port 的 JSDoc 把它写成了抛错**，文档与实现相反，且这是协议层唯一的契约声明处，驱动实现者会照它写出错误代码。

**建议**：改 port JSDoc 为「`tx.transaction()` 抛 `NESTED_TRANSACTION`；在回调内使用**外层** `conn` 的任何方法（含 `conn.transaction`）会因驱动层 AsyncMutex 不可重入而**死锁**，不是报错」；或在 `BetterSqlite3Connection.transaction` 进入 `mutex.run` 前加一道 `if (this.inTransaction) throw NESTED_TRANSACTION` 的前置检查（注意这需要在锁外做，是个小竞态窗口，但比死锁好）。

**置信**：confirmed（死锁实测；`NESTED_TRANSACTION` 抛错实测）

---

### F-core-infra-sql-3 | P1 | packages/core/src/infra/sql-template/parser.ts:223

```
const gt = template.indexOf(">", headerStart);
```

**描述**：`readOpenTagHeader` 用**首个 `>`** 结束标签头，不感知引号。于是 `test` 属性值里任何含 `>` 的比较运算都会把属性头截断：

```
<if test="count > 0">   → SqlTemplateError: Malformed attributes on <if>
<if test="n >= 2">      → SqlTemplateError: Malformed attributes on <if>
<choose><when test="a > b">  → SqlTemplateError: Malformed attributes on <when>
<if test="a < b">       → OK（`<` 不触发，属性正则吃得下）
<if test="a != b">      → OK
```

这是 MyBatis 动态 SQL 最常见的一类表达式，报错信息（"Malformed attributes"）还完全指错方向。

**当前生产影响：0**。已逐文件核实（`git grep -F '<if ' / '<where' / '<trim' / '<choose' / '<foreach' / '<when' / '<otherwise'`，24 个消费文件 + 全 `packages/core/src`）：**所有动态标签在生产代码里零使用**，只有 `<foreach` 出现在 `test/infra/sql-template/evaluator-foreach.test.ts`。生产的动态性全部靠 TS 侧字符串拼接 + `${...}` 实现（如 `hiddenFilter` / `scopeFilter` / `excludeSql` / `inClause`），标签机制只有测试在用。

所以这是**潜伏缺陷**：能力已实现、已测试、已导出到主入口（`index.ts:9-16` 导出 `SqlTemplateParser` 全套），任何人第一次写 `<if test="a > b">` 都会踩。

**建议**：`readOpenTagHeader` 改成引号感知的扫描（在 `"`/`'` 内跳过 `>`），约 15 行；配一条回归用例。同一函数对单引号属性同样成立（`attrRe` 已支持 `'`）。

**置信**：confirmed（行为实测；生产零使用已逐文件核实）

---

### F-core-infra-sql-4 | P2 | packages/core/src/infra/sql-template/parser.ts:84

```
const unknown = /^(\w+)(\s+[\w-]+=|\s*>)/.exec(probe);
return unknown !== null;
```

**描述**：`isTagStart` 把「`<` + 标识符 + `>`」一律当标签起点，于是**普通 SQL 正文里的 `<标识符>` 会被误判**。实测：

```
SELECT * FROM t WHERE path LIKE '%<b>%'   → SqlTemplateError: Unknown tag <b>
SELECT * FROM t WHERE a <b> AND c         → SqlTemplateError: Unknown tag <b>
SELECT * FROM t WHERE n <= 5              → OK
SELECT * FROM t WHERE n <> 5              → OK
```

前两条是合法 SQL（`<b>` 是字面比较或 LIKE 模式），被当成未知标签抛错。第二条尤其危险：任何 `a<b` 形式的比较（无空格）只要后面跟着 `>` 就炸。

**当前生产影响：0**——已核实所有消费文件的 SQL 模板正文里**不含** `<标识符>` 形态（扫描 SQL 关键词行含 `<` 的命中全是 TS 泛型 `Promise<void>`，不是 SQL）。但这是与 F-3 同源的脆弱点：SQL 模板的词法边界靠「看起来像标签」猜，遇到正文里恰好像标签的文本就误伤。

**建议**：`isTagStart` 收窄为「`<` + 已知标签名 + 词边界」或「`<` + 标识符 + 合法属性形态」两者的交集；对不匹配已知标签的，**降级为 text 而非抛 `UNKNOWN_TAG`**（真拼错标签名的场景已由 `parseOpenTag` 的 `default:` 分支 `:335` 覆盖，抛错不会因此漏掉）。若要保留 `UNKNOWN_TAG`，至少在正文（非标签头位置）不抛。

**置信**：confirmed

---

### F-core-infra-sql-5 | P2 | packages/core/src/infra/sql-template/placeholder.ts:26

```
const text = value === null || value === undefined ? "" : String(value);
```

**描述**：`${...}` 原样内联不做任何转义/校验，且 `null/undefined` 静默变空串：

```
p.parse(`SELECT * FROM t ORDER BY \${col}`, { col: "id; DROP TABLE t" })
  → { sql: "SELECT * FROM t ORDER BY id; DROP TABLE t", parameters: [] }
p.parse(`SELECT \${c} FROM t`, {})
  → { sql: "SELECT  FROM t" }     // 双空格，语法错，报错点远离真正原因
```

**这一条本身是 intentional，不当缺陷报**：`sql-template/index.ts:49-52` 的 JSDoc 与 `packages/core/src/index.ts:7` 都明确写了「`${name}` 会以原始字符串内联到 SQL，调用方必须自行做白名单或校验」，`FORBIDDEN_PATTERN` 之类也不该管这里。**已核实全部 24 个生产消费文件的 `${...}` 内联值都是编译期常量**（表名常量、`USAGE_NOT_NULL_SQL` 这样的 SQL 片段常量、或本文件自己按 arity 生成的 `#{idN}` 占位串），**当前无注入面**。

列在此处的唯一理由是**给主代理一个已核实的负结论**：W3 的「表消费对账」「IPC 双侧」机位若扫到 `${` 不要报注入缺陷——生产侧已逐条核实为常量。`FORBIDDEN_PATTERN` 拦的是 `test` 表达式（`expression.ts:142`），跟 `${}` 无关。

**建议**：不改行为。若要加固，可在 `renderBind` 的 dollar 分支对 `value` 为 null/undefined 时抛 `SqlTemplateError` 而不是静默变空串（当前静默降级会让「漏传参数」变成一条语法错误 SQL，报错现场在下游 SQLite 而非模板层）。

**置信**：intentional（负结论已核实）

---

### F-core-infra-sql-6 | P2 | packages/core/src/infra/sql-template/expression.ts:9

```
const FORBIDDEN_PATTERN =
  /[;{}]|=>|\bfunction\b|\bnew\b|\beval\b|\bimport\b|\bconstructor\b/i;
```

**描述**：`test` 表达式走 `new Function("__ctx__", \`return (${normalized});\`)`（`:39`），黑名单是正则字面量匹配——**可被字符串拼接绕过**。实测：

```
a.constructor                                  → ERR Disallowed syntax（被 \bconstructor\b 拦）
a['con'+'structor']                             → OK  true    ← 绕过
a['con'+'structor']('return 42')()              → ERR Failed to evaluate（构造成功但调用抛错）
a.__proto__                                     → OK  true
a['__pro'+'to__']                               → OK  true
process / require                               → OK  false（未绑到 ctx，返回 undefined）
this['con'+'structor']                          → ERR Failed to evaluate
new Date()                                      → ERR Disallowed syntax
```

`['con'+'structor']` 确实取到了 `Object` 构造器（返回 true 即证明拿到了函数对象），只是后续调用因为绑定方式报错。**这是一道可绕过的沙箱**，不是安全边界。

**当前生产影响：0**——已核实**生产代码零使用动态标签**（同 F-3 核实），因此 `evaluateTest` 在生产路径上从未被调用；且 `test` 表达式是**模板作者写在源码里**的，不是运行时用户输入，不存在「用户控制表达式」的通路。真正需要担心的是**未来**：一旦有人开始用 `<if test="...">` 且把参数值拼进 test 表达式（很容易发生，因为 `#{...}` 绑值、`${...}` 内联都已有先例），就立刻变成表达式注入。

另外注意黑名单是**对归一化后的字符串**跑的（`:142` 在 `bindExpressionToContext` 之后），而 `bindExpressionToContext`（`:103-116`）用 `IDENTIFIER_RE` 只改写「点号路径」，`a['x']` 这种下标访问**不经过改写**——这就是绕过的机制。

**建议**：三选一，按代价排序。(a) 认清定位，把注释从「禁用词防护」改成「**非安全边界，仅防手滑**」，并显式写明「test 表达式必须来自源码常量模板，禁止拼接运行时数据」；(b) 若要真隔离，去掉 `new Function`，改用受限求值器（表达式语法面极小，`[;{}]=>function new eval import constructor` 已覆盖不到下标取构造器）；(c) 至少把黑名单改成对**归一化后 AST/词法**判定而非正则。

**置信**：confirmed（绕过实测；生产零使用已核实）

---

### F-core-infra-sql-7 | P2 | packages/core/src/infra/serialization/zod-to-json-schema.ts:22

```
function zodTypeToJsonSchema(schema: z.ZodType): JsonSchema {
```

**描述**：手写转换器 `zodTypeToJsonSchema`（`:22-62`，41 行）在当前依赖下**是死代码**。`zodToJsonSchema`（`:16`）先试 `schema.toJSONSchema?.()`，而 zod 4.4.3 的每个 schema 实例都有该方法（实测 `typeof schema.toJSONSchema === "function"`），所以永远走原生分支，手写分支一次都进不去。

它的**行为也与原生不一致**，若哪天被激活会造成静默劣化：手写版不处理 enum / literal / union / record / nullable / default，遇未知类型一律 `{ type: "object", additionalProperties: true }`（`:61`）——把一个枚举悄悄放宽成任意对象。实测原生分支（实际生效路径）：

```
z.date()      → Error: Date cannot be represented in JSON Schema
z.transform() → Error: Transforms cannot be represented in JSON Schema
z.bigint() / z.symbol() / z.custom() → 同类 Error
z.enum        → { type: "string", enum: ["x","y"] }        （手写版会给 {type:"object"}）
z.record      → { propertyNames, additionalProperties }    （手写版丢失）
```

注意原生分支对 `z.date/z.transform/z.bigint/z.symbol/z.custom` 是**抛错而非降级**。已核实 `packages/core/src` 中唯一的 `z.custom` 出现在 `domain/tool/builtin/agent-tool.ts:304` 的 **`outputSchema`**（不经过 `zodToJsonSchema`），5 个工具的 `inputSchema` 均无危险类型——**当前无实际抛错**。但 `zodToJsonSchema` 是 `@novel-master/core/provider` 的公开出口，外部调用方传一个含 `z.date()` 的 schema 就会直接抛 `Error`（不是类型化错误）。

**建议**：删掉 41 行手写实现，直接 `return z.toJSONSchema(schema)`（zod 4 自带且已是当前实际路径）；若要保留兜底，兜底应**抛类型化错误**说明「该 schema 不可表示为 JSON Schema」，而不是悄悄给 `{type:"object"}`——静默放宽 schema 会让 LLM 拿到与真实契约不符的 `input_schema`。

**置信**：confirmed

---

### F-core-infra-sql-8 | P3 | packages/core/src/infra/sql-template/evaluator.ts:78

```
state.parameters.push(...innerState.parameters);
const wrapped = wrapWhere(innerState.parts.join(""));
if (wrapped) state.parts.push(wrapped);
```

**描述**：`<where>` 分支**先无条件 push 参数，再判断 SQL 是否被丢弃**。`<where>` 内容只剩 `AND`/`OR`（或为空）时 `wrapWhere` 返回空串、SQL 片段被丢，但参数已经进了 `state.parameters` → **参数与占位符 arity 失配**。实测：

```
<where> AND #{a} </where>（a=1）  → { sql: "WHERE ?", parameters: [1] }   // 正常
<where> AND </where>              → { sql: "", parameters: [] }          // 正常（无 bind）
```

这两条都恰好安全，因为参数和 SQL 片段是**同一个 bind 节点**产出的、一起被丢。**能触发失配的路径需要参数与片段解耦**——实测找到了：

```
new SqlTemplateParser({ placeholder: "" })
  <where>#{a}</where>  → { sql: "", parameters: [1] }   ← 1 个参数，0 个占位符
```

即 `ParseOptions.placeholder`（`types.ts:13`，主入口导出）允许把占位符设成空串，此时任何 `<where>` 都会产出失配的 `parameters`。**当前生产无 `placeholder` 自定义**（24 个消费文件全部 `new SqlTemplateParser()` 无参，默认 `"?"`），所以是潜伏缺陷。

同类结构在 `<trim>` 分支（`:112-117`）也存在，但 `applyTrimOverrides` 永远返回非空串（`${prefix}${s}${suffix}` 至少是 `"undefined"`→实际 `""`+`""`+`""`），所以 trim 不会丢片段——只有 where 会。

**建议**：`where` 分支改成先算 `wrapped`，非空才 push 参数（与 `parts` 同步），即：
```
const wrapped = wrapWhere(innerState.parts.join(""));
if (!wrapped) break;
state.parameters.push(...innerState.parameters);
state.parts.push(wrapped);
```
另外 `ParseOptions.placeholder` 既然公开导出，建议加一条「不得为空串」的运行时校验，或在 JSDoc 标注它只影响 SQL 文本渲染、不影响参数顺序。

**置信**：suspected（失配路径实测可达，但生产未使用自定义 placeholder；`<where>` 本身生产也零使用——见 F-3）

---

### F-core-infra-sql-9 | P3 | packages/core/src/infra/tdbc/logic/registry.ts:11

```
const drivers = new Map<string, TdbcDriver>();
```

**描述**：驱动注册表是**模块级可变全局**，`registerDriver` 是 last-wins（`:17` 的 `drivers.set` 无重注册告警），`clearDrivers` 虽标 `@internal`（`:36`）但**已从 `tdbc/index.ts:17` 导出到主入口**（`packages/core/src/index.ts:28-39`）。

`resolveDriver`（`:46-72`）在没有显式 `driver` 时：恰好 1 个驱动就用它，0 个或 ≥2 个都抛 `UNKNOWN_DRIVER`。生产三端都显式传 driver（`apps/mobile/src/db/connection.ts:74` `'op-sqlite'`；cli `runtime.ts:180` 与 desktop `connection.ts:38` / `db-backup.service.ts:60` 均 `'better-sqlite3'`），所以**不依赖 last-wins 顺序**——这是好的。

真实风险在 mobile：`apps/mobile/src/db/connection.ts:43-60` 的注释已经点明「驱动注册表是 last-wins：任何其它地方再调一次**无参**的 `registerOpSqliteDriver()` 都会把这里的带参版本覆盖掉、静默丢掉后台探测」。该文件用 `registerMobileOpSqliteDriver()` 收敛了 app 层入口，但**注册表本身没有任何重复注册检测**——一个后来者可以在 mobile 上把带 background 探测的驱动静默降级成前台口径版，表现为「后台回前台时事务挂死」，且没有任何日志线索（`registerDriver` 不 warn、不 throw）。

**建议**：`registerDriver` 对同名重注册打一条 `console.warn`（含「是否覆盖了带参版本」的提示），或对 `registerOpSqliteDriver` 这类「同名不同行为」的场景引入显式 replace 语义。`clearDrivers` 从主入口撤出（只留 `@novel-master/core/tdbc` 或测试专用入口），避免生产代码有清空全局注册表的能力。

**置信**：confirmed（代码事实）；危害路径 confirmed by `apps/mobile/src/db/connection.ts:50-53` 自述

---

### F-core-infra-sql-10 | P3 | packages/core/src/infra/random-uuid.ts:36

```
for (let i = 0; i < 16; i++) {
  bytes[i] = Math.floor(Math.random() * 256);
}
```

**描述**：三级降级链 `crypto.randomUUID` → `crypto.getRandomValues` → `Math.random`。前两级没问题，第三级是**非密码学随机**。文件头注释（`:13-14`）诚实地写了「falls back to a pure-JS generator using `crypto.getRandomValues` or, as a last resort, `Math.random`」，`:35` 也注明「IDs are not cryptographically strong」——所以**这是 intentional 且已声明的取舍，不当缺陷**。

列出来只因为主代理的 W3「死路径/兼容分支」机位可能会撞到这里，需要知道它是**有意保留的**：RULE 已记 mobile 走 Hermes，`globalThis.crypto` 在 RN 上是否完整存在取决于 polyfill 情况。降级链的三级设计让 RN 老环境仍能出合法 v4（`bytes[6]`/`bytes[8]` 的版本位与变体位掩码在 `:40-41` 正确，输出经 `isRandomUuidV4` 正则校验通过）。

消费方都是 id 生成（`generate-agent-run-id`、`in-memory-agent-session`、`message/project/session/provider` service），**没有任何一处用作安全 token**（密钥走 sksp 域），所以 `Math.random` 底座不构成安全风险。

**建议**：不改。若要进一步降顾虑，可对第三级加一次性 `console.warn`（运行时环境探测缺失是值得让人知道的），但会引入噪音，收益有限。

**置信**：intentional

---

### F-core-infra-sql-11 | P3 | packages/core/src/infra/kkv-value-codec.ts:15

```
throw new Error(`Expected boolean string, got: ${value}`);
```

**描述**：`parseBoolean` 对非 `"true"/"false"` 的值**抛裸 `Error`**（不是类型化错误、无 code、无 `key` 上下文）。唯一消费方 `persistent-preferences.service.ts:118-122` 用 `try/catch` 兜住并转成 `preferencesInvalidValue(key, "boolean", raw)`——所以**现状是可用的**，但这个模块自己的错误模型比它的消费方需要的弱：`parseBoolean` 无法告诉调用方「哪个 key 的值坏了」，全部靠 catch 后的 `raw` 重建。

同时 `formatBoolean`（`:19`）返回类型是字面量联合 `"true" | "false"`，与解析侧对称，但没有非法输入的**降级**口径——若将来有第二个消费方要读历史遗留的 `"1"`/`"TRUE"`，会直接抛。

**建议**：模块本身不必改（单消费方且已被兜住）。若要改，把抛出的 `Error` 换成携带 `{ value }` 的类型化错误类（与 `TdbcError` / `SqlTemplateError` / `ConfigDecodeError` 的风格一致——本仓已有三种同类模式，这里是唯一的裸 `Error`），让 `PersistentPreferencesService` 不必依赖 catch。

**置信**：confirmed（代码事实；影响面已被消费方兜住）

---

### F-core-infra-sql-12 | P3 | packages/core/src/infra/date-format.ts:13

```
return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
```

**描述**：`formatLocalDateTime` 用本地时区（`getFullYear/getMonth/...`）且**不 pad 年**（`padStart` 只用在月/日/时/分/秒上）。年份为负或小于 1000 时（`new Date(-1)` 之类）输出会缺前导零/带符号——实际不可达（消费方传 `Date.now()` 与文件 mtime）。

真实的小差异是：`packages/core/src/common/usage-stats-format.ts:11-15` 有一份**功能重叠的本地时区格式化**（`${pad(d.getMonth()+1)}-${pad(d.getDate())} HH:mm`），两处各自实现 pad。两份的**格式不同**（一个 `yyyy-MM-dd HH:mm:ss`，一个 `MM-DD HH:mm`），所以不算 bug，但 pad 逻辑重复。

消费方只有两处（`expand-dynamic-macros.ts:38` 的 `$time` 宏、`workplace-display.ts:22` 的文件 mtime），另经 `public/provider.ts:109` 导出给外部。

**建议**：不急着改。若要收敛，把 `pad` 提到 `common/` 共享，保留两个不同的格式函数——重复的是 pad 工具，不是格式化规则。

**置信**：confirmed

---

### F-core-infra-sql-13 | P3 | packages/core/src/infra/serialization/decode.ts:20

```
throw new ConfigDecodeError("INVALID_SCHEMA", zodMessage(parsed.error));
```

**描述**：`zodMessage`（`:10-12`）返回 `error.message`，在 zod v4 下这是**整个 issues 数组的 JSON 序列化字符串**。实测：

```
decode({}, z.object({ a: z.string(), b: z.number() }))
  → ConfigDecodeError: [
      { "expected": "string", "code": "invalid_type", "path": ["a"], "message": "..." },
      { "expected": "number", "code": "invalid_type", "path": ["b"], "message": "..." }
    ]
```

多字段校验失败时，抛出的 `message` 是一段缩进 JSON，直接进 `ConfigDecodeError.message` → 会被 YAML service 抛给用户看、或写进日志。这是**可读性问题**（信息全在，但不是人读的），不是正确性问题。

消费方 8 处，全是「解析失败 → 抛错给上层」这一形态（`validate-agent-definition`、`project/session` service、`compaction-conditions-store`、`assess-agent-definition-wire`、`smart-sort-rule-io`、`kkv-model-suggestion.repository`、两个 repository），所以**没有静默吞掉 issues 的地方**，信息不会丢。

**建议**：`zodMessage` 改为 `parsed.error.issues.map(i => \`\${i.path.join(".") || "(root)"}: \${i.message}\`).join("; ")`，多行可换行。要点是保留 path——现在 JSON 形态里 path 是嵌套数组，UI 展示时还得自己挖。

**置信**：confirmed（实测消息形态）

---

### F-core-infra-sql-14 | P3 | packages/core/src/infra/serialization/stringify-text.ts:16

```
return `${JSON.stringify(value, null, 2)}\n`;
```

**描述**：`JSON.stringify` 对 `undefined` 返回 `undefined`（非字符串），模板串把它转成字面量 `"undefined"`：

```
stringifyText(undefined, "json")  →  "undefined\n"     ← 非法 JSON
stringifyText({ a: 1n }, "json")  →  TypeError: Do not know how to serialize a BigInt
```

即「序列化一个不可序列化的值」这条路径给出的错误是**下游 `parseText` 的一句 `Unexpected token u in JSON at position 0`**，而不是在 `stringifyText` 处就报「该值不可 JSON 序列化」。`BigInt` 那条更直接——抛出的是 `TypeError` 而非 `ConfigDecodeError`，与本模块「所有失败都是 `ConfigDecodeError`」的错误模型不一致。

消费方（desktop/mobile `agent-yaml.service.ts` / `smart-sort-rule-yaml.service.ts`、cli `import-export.ts` / `sort-rule/commands.ts`、`character-card-to-md-tree.ts:98`）传的都是已 `encode()` 过的 wire 对象，`undefined`/`BigInt` 实际不可达（Zod schema 不产出这两种）。

**建议**：加一道前置检查——`JSON.stringify` 结果为 `undefined` 时抛 `ConfigDecodeError("INVALID_SCHEMA", ...)`；BigInt 情形用 `try/catch` 包住 `JSON.stringify` 并转 `ConfigDecodeError`。约 8 行，让错误在本层发生而不是在下游解析时。

**置信**：confirmed（实测）；可达性 confirmed 为低

---

### F-core-infra-sql-15 | P3 | packages/core/src/infra/tdbc/logic/open.ts:41

```
if (filename.startsWith("file:")) {
  filename = filename.slice("file:".length);
}
```

**描述**：`parseUrl` 无条件剥掉 `file:` 前缀，且**不解析 URI query 参数**。`tdbc:sqlite:file:foo.db?mode=ro&cache=shared` 会被切成 `foo.db?mode=ro&cache=shared` 当成**文件名**（不是文件名+参数），落到驱动层就是一个含 `?` 的怪路径。`OpenOptions.readOnly`（`types.ts:33`）是走 option 传的正路（better-sqlite3 驱动 `driver.ts:23` 确实消费），所以 URL 层不支持 query 不算功能缺失，但**静默**——用户以为写了 URI 参数生效了，实际拼进了路径。

另外 `parseUrl` 不校验 `filename` 是否是绝对路径（`tdbc:sqlite:./data/app.db` 会被原样交给驱动，相对当前工作目录解析），`open.ts:5` 的 `@invariant Only tdbc:sqlite:… URLs are supported in v1` 也提醒了这层是 v1 精简版。

已核实生产三端传的都是 `tdbc:sqlite:file:${绝对路径或固定库名}`，无 query。

**建议**：要么在 `file:` 之后若含 `?` 则抛 `INVALID_URL`（明确不支持，别静默），要么实现 query 解析。当前静默拼接是最坏的一种——错到很后面才炸。

**置信**：confirmed

---

### F-core-infra-sql-16 | P3 | packages/core/src/infra/serialization/parse-text.ts:25

```
return parseYaml(source);
```

**描述**：`yaml` 包的 `parse` 对 `__proto__` 键默认走「普通键」语义，实测返回 `{ __proto__: { polluted: true } }` —— **是自有属性，不是原型污染**（`JSON.stringify` 能打印出来即证明 `Object.prototype` 未被改）。所以**不构成原型污染漏洞**，但下游若把它 spread / `Object.assign` 到别处，行为会与预期不同。

同时 `parseText("", "yaml")` 返回 `null`（不是 `{}` 或抛错），调用方拿到的 `unknown` 是 `null`；`parseText` 对 YAML 的多文档（`---` 分隔）只返回**第一个文档**且静默丢弃其余。

消费方：`parse-skill-front-matter.ts:11`（技能 SKILL.md front matter）、三个 `*-yaml.service.ts`（agent 定义 / smart-sort-rule 的导入导出）、cli。这些都是**用户自己提供的配置文件**，属于「不可信输入」边界。

**建议**：不需要动（`yaml` 的默认行为是安全的）。若要更保守，可在 `parseText` 的 yaml 分支加一条「解析结果含自有 `__proto__` 键则抛 `INVALID_SCHEMA`」的校验——但这更像过度防御。**记录在此是为了让 W3 的「双端重复实现」「IPC 双侧」机位知道：这是用户配置入口，但 `yaml` 解析本身无污染。**

**置信**：intentional / 负结论

---

## 争议与存疑

1. **F-1（AST 缓存无界）的定级与取舍**。我给 P1，理由是内存数字实测且增长超线性（2000 arity → 337MB，3000 → 739MB，8000 → OOM 崩）。但主代理需要判断两件事：(a) 这在本仓是不是**已知取舍**——我查了 `docs/apm/RULE.md`、`packages/core/ARCHITECTURE.md`、`parser.ts:38-44` 的注释，**没有**任何一处写明「AST 缓存无界是有意的」；注释的措辞（"模板字符串通常数量有限（来自配置）"）是在**描述一个不成立的前提**，不是在接受代价。所以我按缺陷报。(b) 修法取舍：LRU 是最小改动，但只治症状；把变长 arity 模板改成常量模板（`?` 位置参数）能根治，但要动 24 个消费文件里的 `buildInBindings` 一类辅助函数。我倾向 (c)，但这是跨域改动，需要主代理裁决是否单独立项。

2. **F-2（事务嵌套死锁 vs 抛错）**。行为本身 RULE 已记（AsyncMutex 不可重入陷阱），我标 P1 的理由是 **port JSDoc 与实现相反**——协议层唯一的契约声明写错了。若主代理认为「RULE 已记该陷阱、文档瑕疵降级」，我认为合理，实情是：这条规则在 RULE 的「实现禁令与坑」里，port 的读者（驱动实现者）不会去看 RULE。**倾向保留 P1，但接受降为 P2**。

3. **F-3 / F-4 / F-6 / F-8 的「生产零使用」是本次测绘的一个结构性结论，可能被上游机位推翻**。我用 `git grep -F` 对 6 个标签名 + 全 `packages/core/src` 做了扫描，结论是**动态标签（`<if>/<where>/<trim>/<choose>/<foreach>/<when>/<otherwise>`）在生产代码里零使用**，生产的动态性全靠 TS 侧字符串拼接。这意味着 sql-template 的 AST/evaluator/expression/tags 五个子系统（`parser.ts` 428 行 + `evaluator.ts` 137 + `expression.ts` 161 + `context*.ts` 74 + `placeholder.ts` 28 + `tags/` 三文件 = **约 900 行**）在生产上是**未被使用的实现**。我把这个作为**争议项**而非发现项提交：可能是「模板化重构做了一半」（生产已改回拼接，标签层留着），也可能是「准备给未来的运维/事件配置用」（`infra/sksp` 里有另一处消费）。我没有找到任何文档说明这批代码的当前定位，**请主代理或后续机位核实**：这 900 行是死代码还是待启用能力？若确认是死代码，F-3/F-4/F-6/F-8 的定级都应下调（潜伏缺陷 vs 活代码缺陷）；若确认是待启用，则这批缺陷是**上线前的必修项**，定级应上调。这直接影响四条发现的处置优先级。

4. **F-5 与 F-6 的分界**。`${...}` 内联（F-5）与 `test` 表达式求值（F-6）都是「字符串拼进 SQL/代码」的风险面，但我给出相反的定级（前者 intentional、后者 P2）。理由：`${}` 已在三处文档明写「调用方自行校验」且**生产全为常量**（已逐条核实）；`test` 表达式则**没有**任何文档说它是安全边界，`expression.ts:9` 的黑名单命名与形态（`FORBIDDEN_PATTERN`）会让人误以为它是防线，而实测可绕过。两者的差别不在风险有无，在**文档是否说清了**。若主代理认为这个区分过于精细，两条可合并为一条 P3「字符串拼接面缺少边界声明」。

5. **`zod-to-json-schema` 的 `z.ZodOptional` 等在 zod v4 的存在性我实测过但没穷举**。实测 `typeof z.ZodOptional === "function"`、`opt instanceof z.ZodOptional === true`、`z.ZodObject/ZodArray/ZodString` 均为 function，所以手写分支本身不会因 API 消失而崩——它只是**进不去**。若 zod 未来大版本移除这些 class 导出，手写分支会变成「引用未定义标识符」的 `ReferenceError` 而不是优雅降级。这加强了 F-7「直接删掉」的结论。

6. **`row-mapper` / `mutex` 不在本区**。`packages/tdbc-driver-*/src/row-mapper.ts` 与 `mutex.ts` 是 TDBC 协议的**实际语义承载点**（blob 往返、BigInt、事务串行化），但它们在 `packages/` 下、不在 `packages/core/src/infra/tdbc/` 内。按我拿到的 zone 定义（`packages/core/src/infra/` 下 tdbc/），这几个文件**不在我的区域**。我在核实 F-2 时读了 `better-sqlite3/src/connection.ts` 与 `op-sqlite/src/connection.ts`（事务/绑参/16ms 量子），确认了 RULE「事务内同步执行」「16ms 量子让步」两条在代码里都有对应实现（`op-sqlite/src/connection.ts:74-80` 的分流注释、`:262-267` 的 16ms 量子），**RULE 与实现一致，无偏差**。但**驱动包本身建议主代理另派机位扫**——我只做了为验证 port 契约所必需的定点阅读，没有系统测绘三个驱动 + conformance 套件。
