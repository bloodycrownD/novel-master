---
zone: w9-infrasql-pro
agent: prosecutor（对抗机位·检察官）
files_scanned: 35
lines_scanned: 1749
scope:
  - packages/core/src/infra/tdbc/**（9 文件 / 353 行）
  - packages/core/src/infra/sql-template/**（12 文件 / 1057 行）
  - packages/core/src/infra/serialization/**（5 文件 / 162 行）
  - packages/core/src/infra/{kkv-value-codec,date-format,random-uuid}.ts
  - packages/core/src/infra/events/simple-event-bus.ts
  - packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts
independence: 未读取 raw/ 与 synth/ 下任何其他机位报告
---

## 摘要

`infra/` 下最底层的四块基石：**TDBC**（异步 SQLite 连接协议 + 驱动注册表 + `executeTemplate/queryTemplate` 桥）、**sql-template**（MyBatis 风格 `#{...}` 绑定与动态标签的 parser + evaluator）、**serialization**（Zod decode/encode、YAML/JSON 文本互转、Zod→JSON Schema）、以及四个根工具文件（布尔编解码、本地时间、UUID、进程内事件总线）。TDBC 与 sql-template 是全仓 20+ 个 SQLite repository 的唯一 SQL 出口，共 249 处 `queryTemplate/executeTemplate` 调用点，**不是死代码**。但 sql-template 的**动态标签分支**（`<if>/<where>/<foreach>/<trim>/<choose>`）在全仓生产代码里出现次数为 **0**。

## 职责与边界

- **tdbc/**：不碰原生依赖，只定义 `TdbcConnection` / `TdbcDriver` 两个 port（`ports/connection.port.ts:13`、`ports/driver.port.ts:11`）、一个进程内 driver 注册表（`logic/registry.ts:11`）、`tdbc:sqlite:` URL 解析（`logic/open.ts:29`）、参数 null/undefined 归一（`logic/normalize-bindings.ts:10`），以及把 `SqlTemplateParser` 输出接到连接的桥（`logic/template-helper.ts:14/27`）。驱动实现全部在仓外包 `packages/tdbc-driver-*`。
- **sql-template/**：两段管线。`parser.ts` 词法扫描 + AST 构造 + 按模板原文缓存 AST；`evaluator.ts` 走 AST 产出 `{ sql, parameters }`；`expression.ts` 把 MyBatis 的 `and/or/not` 归一成 JS 并 `new Function` 编译求值；`tags/*` 是 `<where>/<trim>/<foreach>` 的专用逻辑。
- **serialization/**：`decode`（Zod safeParse + `ConfigDecodeError`）、`encode`（读 schema 上的 `toWire`）、`parseText`/`stringifyText`（YAML/JSON）、`zodToJsonSchema`（喂 LLM tool `input_schema`）。
- **根文件**：三个单函数工具（布尔 KKV 编解码 / 本地时间格式化 / 跨端 UUID v4）+ `SimpleEventBus`（同步 pub/sub）+ `parseKkvJsonDocument`（KKV JSON 解析薄封装）。
- **不在边界内**：驱动包（`packages/tdbc-driver-*`）、conformance 套件、所有 repository 层 SQL 拼接。

## 对外接口

`packages/core/src/index.ts:9-56` 导出的关键符号：

| 符号 | 出处 | 外部生产消费方 |
|---|---|---|
| `SqlTemplateParser` | `sql-template/index.ts:32` | 31 处 `new SqlTemplateParser()`，覆盖全部 sqlite-* repository |
| `parseTemplateToAst` / `normalizeExpression` / `bindExpressionToContext` / `evaluateTest` | `parser.ts:27` / `expression.ts:89/103/127` | **0**（仅 `expression.ts` 内部互调 + barrel 转出） |
| `TemplateParser` / `TemplateEvaluator` | `parser.ts:45` / `evaluator.ts:27` | 仅 `sql-template/index.ts` 内部 |
| `TdbcError` / `open` / `parseUrl` / `registerDriver` / `getDriver` / `listDrivers` / `resolveDriver` / `normalizeBindings` | `tdbc/*` | `registerDriver` 经 barrel 被 `tdbc-driver-better-sqlite3/src/index.ts:7`、`tdbc-driver-op-sqlite` 消费；其余 0 外部消费 |
| `executeTemplate` / `queryTemplate` | `tdbc/logic/template-helper.ts:14/27` | 249 处调用点（repository + bootstrap） |
| `decode` / `encode` / `EncodableSchema` | `serialization/decode.ts:17` / `encode.ts:19` | 8 个 domain/service |
| `stringifyText` / `parseText` | `serialization/stringify-text.ts:14` / `parse-text.ts:15` | character-card-to-md-tree / parse-skill-front-matter |
| `zodToJsonSchema` | `serialization/zod-to-json-schema.ts:12` | `llm-protocol/logic/tool-definitions.ts:26` |
| `SimpleEventBus` | `events/simple-event-bus.ts:20` | `service/agent/*`（type-only）、`public/events.ts:1` |
| `formatLocalDateTime` / `randomUUID` | `date-format.ts:10` / `random-uuid.ts:16` | 各自 2 / 26 处 |
| `parseBoolean` / `formatBoolean` | `kkv-value-codec.ts:8/19` | 仅 `persistent-preferences.service.ts` |

未导出但被测试直接 import 的内部件：`stripLeadingAndOr`（`tags/where.ts:10`）、`normalizeCollection`（`tags/foreach.ts:9`）、`mergedContextForExpression`（`context-proxy.ts:8`）。

## 数据访问

本区**不直接触碰任何表**。所有表访问经 `TdbcConnection` + `SqlTemplateParser` 下放给 repository。间接覆盖面（模板字符串在 repository 里，本区只做语法解析）：

- `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:160` — `chat_message`，`SqlTemplateParser` 实例字段
- `packages/core/src/domain/kkv/repositories/impl/sqlite-kkv.repository.ts:29` — KKV 主表
- `packages/core/src/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts:65` — `session_file_cache_entry` / `session_file_cache_blob`（双驱动绑参上限分片 400，见 `:35`）
- `packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts:84` — `message_checkpoint` / `message_checkpoint_file`
- `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:61` — `vfs_revision`（分片 100/500，见 `:37`/`:40`）
- `packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts:43` — `vfs_content_blob`
- `packages/core/src/bootstrap/schema-migrations/schema-migrations-table.ts:15` — schema migration 注册表
- `packages/core/src/infra/sksp/impl/base-sqlite-secret-store.ts:29` — SKSP 密钥库
- 另有 13 处 repository 的 `SqlTemplateParser` 实例：`sqlite-agent-definition` / `sqlite-project` / `sqlite-session` / `sqlite-provider` / `sqlite-saved-model` / `sqlite-skill-disabled-rule` / `sqlite-smart-sort-rule` / `sqlite-session-run-state` / `sqlite-workplace` / `sqlite-vfs-entry` + `bootstrap/provider/seed-builtin-providers.ts:18`、`domain/provider/logic/find-saved-model-references.ts:16`、`domain/session-kkv/logic/deferred-file-cache-gc.ts:32`

`serialization/` 只接触内存值与 YAML/JSON 文本，不落盘。

## 依赖关系

**import 了谁**（本区 import）：
- `tdbc/` → 无外部依赖（零原生依赖，刻意）
- `sql-template/` → 无外部依赖（parser/expression/evaluator/tags 全部自闭环）
- `serialization/` → `zod`、`yaml`、`@/errors/config-decode-errors.js`
- `kkv-value-codec.ts` / `date-format.ts` / `random-uuid.ts` / `simple-event-bus.ts` / `parse-kkv-json-document.ts` → 零依赖

**被谁消费**：`tdbc/` 与 `sql-template/` 被 `bootstrap/` + `domain/*/repositories/impl/` + `infra/sksp/` + `domain/provider/logic/` 共 40+ 文件消费；`serialization/` 被 `domain/agent`、`domain/chat`、`domain/provider`、`domain/skills`、`domain/smart-sort-rule`、`domain/character-card`、`config-forms/`、`service/*`、`infra/llm-protocol/` 消费；`SimpleEventBus` 被 `service/agent/` 消费。

**本区内部耦合**：`index.ts → evaluator.ts → {context, expression, placeholder, tags/*}`；`parser.ts → {errors, types}`；`expression.ts → {errors, context-proxy}`；`evaluator.ts → types.ts`。无循环依赖。

---

## 发现清单

### F-w9-infrasql-pro-1 | **P1** | `packages/core/src/infra/sql-template/parser.ts:46`

```ts
private readonly astCache = new Map<string, AstNode[]>();
```

AST 缓存以**模板全文**为 key，无上限、无淘汰、无 LRU。注释（`:41-43`）断言「模板字符串通常数量有限（来自配置），缓存增长可控，不需要 LRU」——**这个前提与实际调用形态不符**。

全仓有 17 处把 `${...}` 拼进模板字符串生成 IN 列表，其中 `sqlite-message-checkpoint.repository.ts:128/382/401` 与 `sqlite-session-kkv.repository.ts:110/153/216` 的 `#{p0}, #{p1}, …` **长度随入参个数 N 线性增长**，且 message-checkpoint 三处**完全不分片**（唯一分片的是 session-kkv 的 `GET_MANY_CHUNK_SIZE=400` 与 vfs-revision 的 100/500）。入参来自 `backfill-baseline-checkpoints.ts:114-120`：

```ts
const segment = await messageRepo.listBySessionOffset(sessionId, cursor);
const checkpointCount = await checkpointRepo.countCheckpointsForMessages(sessionId, segment.map((m) => m.id));
```

而 `sqlite-message.repository.ts:294` 的 `listBySessionOffset` 是 `LIMIT -1 OFFSET #{offset}`，**无上界**。所以模板全文是 N 的纯函数，缓存会为每个见过的 N 各留一份 O(N) 大小的 AST，永不回收。desktop 常驻进程跨会话运行、N 从 1 到几千都出现过时，滞留量按 `Σ 2N` 增长。

建议：给 `astCache` 加一条 `if (this.astCache.size > 64) this.astCache.clear()` 之类的粗淘汰，或把 key 换成「模板骨架 + N」（即让调用方传参个数而非拼进模板），后者顺带解决下条。

**置信：confirmed**（17 处拼接点已逐一定位；message-checkpoint 不分片已核实）

---

### F-w9-infrasql-pro-2 | **P2** | `packages/core/src/infra/sql-template/parser.ts:95-105`

```ts
const hash = template.indexOf("#{", i);
const dollar = template.indexOf("${", i);
let lt = template.indexOf("<", i);
```

`parseNodesUntilClose` 每消费一个 token 就从当前位置重扫三遍全文，token 数与模板长度都是 O(N)，故整体 **O(N²)**。实测（node，编译产物 `dist/infra/sql-template/parser.js`，模板形如 `... message_id IN (#{id0}, #{id1}, …)`）：

| N（绑定个数） | 模板字节 | AST 节点 | 首次 parse |
|---|---|---|---|
| 200 | 2 001 | 403 | 0.32 ms |
| 400 | 4 001 | 803 | 0.64 ms |
| 800 | 8 001 | 1 603 | 2.11 ms |
| 1600 | 16 601 | 3 203 | 7.01 ms |
| 3200 | 34 201 | 6 403 | 17.74 ms |

每翻一倍约 4 倍，确证二次。命中缓存后同一模板 0.0057–0.066 ms，所以只有**首次见到某个 N** 时付这个钱——但配合 F-1（按 N 分裂成上千个 key），首次成本会被反复支付。

另有两处同源的字符串拷贝浪费：`isTagStart` 的 `template.slice(offset + 1)`（`:82`）在遇到**每个** `<` 时都复制一遍剩余全文；`parseNodesUntilClose` 的 `template.slice(start + 1)`（`:120/132/169`）与 `parseChooseBody` 的 `template.slice(tagStart + 1)`（`:366`）同理。建议改用带 `lastIndex` 的 sticky 正则或 `template.charCodeAt` 预筛。

**置信：confirmed**（实测数字，非引用）

---

### F-w9-infrasql-pro-3 | **P2** | `packages/core/src/infra/sql-template/placeholder.ts:26`

```ts
const text = value === null || value === undefined ? "" : String(value);
```

`${path}` 是「语法节点级」替换，**不做字符串字面量上下文判断**。实测：

```
p.parse("SELECT 'a${b}c'", {})  ->  { sql: "SELECT 'ac'" }
```

SQL 字符串字面量里出现的 `${...}` 被当成 MyBatis 绑定吃掉，路径解析不出值就替换成空串，**静默产出语义错误的 SQL**，不报错。对比 `#{` 缺右括号会抛 `MALFORMED_TAG`（`parser.ts:122`），`${` 却是无声失败。仓库里只要有模板内嵌 JSON 片段、`LIKE '%${x}%'` 之类写法就会中招。

CI 守卫 `packages/core/test/infra/sql-template/no-dollar-in-repository-sql.test.ts:132` 禁止 repository 里出现 `${`，但它只覆盖 `/repositories/` 与 `sqlite-*.ts`（`:30-40`），且守卫本身把 `${…}` 视为**违规**，也就是说 `${}` 绑定路径在生产中是「被策略封杀」而非「被使用」——见下方争议节。

建议：`renderBind` 的 dollar 分支要求调用方显式声明该绑定是 raw 片段（如 `rawDollar` 节点类型），或至少在值解析失败时抛错而非填空串。

**置信：confirmed**（已复现）

---

### F-w9-infrasql-pro-4 | **P2** | `packages/core/src/infra/sql-template/context.ts:33-46`

```ts
for (const part of parts) {
  if (current === null || current === undefined) return undefined;
  if (typeof current !== "object") return undefined;
  current = (current as Record<string, unknown>)[part];
}
```

`resolvePath` 只按 `.` 切分，路径写错、层级写错一律返回 `undefined`，`renderBind` 再把它绑成 SQL `NULL`。实测两个静默错值：

```
p.parse("SELECT #{a[0]}", { a: [7] })  ->  { sql: "SELECT ?", parameters: [null] }   // 期望 7
p.parse("SELECT #{a.}",   { a: 1 })    ->  { sql: "SELECT ?", parameters: [null] }   // 期望 1
```

`a[0]` 在全仓 0 处使用（`git grep -E '#\{[^}]*\['` 命中 0），所以目前只是潜伏；但「模板变量名打错 → 静默写 NULL 进库」这条通道对 249 个调用点是敞开的，且没有任何 `undefined` 断言。建议 `#{...}` 的路径解析失败时 fail-fast（`test` 表达式保持宽松是对的，写进 SQL 的绑定不该宽松）。

**置信：confirmed**（行为已复现）／可达性 suspected**

---

### F-w9-infrasql-pro-5 | **P2** | `packages/core/src/infra/events/simple-event-bus.ts:41-47`

```ts
return {
  unsubscribe: () => {
    set!.delete(handler as EventHandler);
    if (set!.size === 0) {
      this.handlers.delete(eventType);
    }
  },
};
```

闭包捕获的 `set` 是订阅时刻的那个 Set 对象，而 `this.handlers.delete(eventType)` **无条件执行**且不校验 map 里当前挂的还是不是这个 `set`。实测：

```js
sa = bus.subscribe('x', A); sa.unsubscribe();      // set S1 空 → map.delete('x')
sb = bus.subscribe('x', B); bus.publish('x');      // ['B']      S2 挂进 map
sa.unsubscribe();                                  // 旧句柄再调一次 → map.delete('x') 把 S2 连带删掉
bus.publish('x');                                  // []   B 的订阅被静默吃掉
```

即**过期的 `EventSubscription` 句柄二次调用 `unsubscribe()`，会静默注销别人刚建立的同名订阅**。当前消费方（`apps/desktop/src/main/ipc/forward-event-bus.ts:72`、`handlers/agent.ts:349`、`apps/mobile/.../session-stream-unit-manager.service.ts:1948`、`service/agent/logic/run-agent-turn.ts:989-990`）都在 dispose/收尾路径上按单次调用使用，`session-stream-unit-manager` 还额外 `length = 0` 防重入，所以**当前不可触发**；但这是个公开 API（`public/events.ts:1`），React StrictMode 双调 effect / 事件重入 / 重试逻辑都可能踩到。

建议：加 `let done = false;` 幂等闩锁，或改成 `if (this.handlers.get(eventType) === set) this.handlers.delete(eventType)`。

**置信：confirmed**（缺陷已复现）／当前可达性 suspected**

---

### F-w9-infrasql-pro-6 | **P1** | `packages/core/src/infra/sql-template/**`（动态标签子系统）

主代理给的疑云是「约 900 行动态标签子系统零使用」。**部分证伪、部分证实**，分开说：

**证伪**：`sql-template/` 目录共 1057 行，`SqlTemplateParser` 是 31 个 repository 的默认 SQL 出口、249 处调用点，**绝不是零使用**。TDBC 同理：`registerDriver` 经 barrel 被 `packages/tdbc-driver-better-sqlite3/src/index.ts:7` 与 op-sqlite 驱动消费，`tdbc-driver-*` 三个包 + `tdbc-conformance` 套件在册。

**证实**：动态标签分支在全仓（`packages/*/src` + `apps/*/src` + 全部 test）里的出现次数，逐标签实测：

| 标签 | 命中数 | 命中位置 |
|---|---|---|
| `<if` | 9 | **全部在 `packages/core/test/infra/sql-template/`** |
| `<where` | 2 | 同上 |
| `<foreach` | 3 | 同上 |
| `<trim` | 1 | 同上 |
| `<choose` / `<when` / `<otherwise` | 2 / 4 / 1 | 同上 |

**生产代码零命中。** 也就是说以下约 600 行只在单元测试里跑过，从未在真实运行中执行：
- `expression.ts` 全文 161 行（`FORBIDDEN_PATTERN` 沙箱、`compiledTestFunctionCache`、`new Function` 编译路径）
- `tags/` 三文件 92 行
- `evaluator.ts` 的 `if`/`where`/`foreach`/`trim`/`choose` 五个 case（`:70-130`）
- `parser.ts` 中 `parseOpenTag` 的标签分派（`:288-339`）、`parseChooseBody` 全文 86 行（`:342-427`）、`requireAttr`（`:262-277`）

两个具体后果：
1. **安全面从未被生产验证。** `FORBIDDEN_PATTERN`（`expression.ts:9-10`）拦 `[;{}]|=>|\bfunction\b|\bnew\b|\beval\b|\bimport\b|\bconstructor\b`，注释把它当安全沙箱。这条路径在生产里永远不执行，等于「拦了但没人验证过拦得住」，而它是 `new Function` 的唯一防线。
2. **每条动态 SQL 只能全量写死。** 需要 `WHERE` 条件可选的查询（`countCheckpointsForMessages` 之类）只能靠应用层先查再分支，仓库里也确实全是这么写的。

建议二选一：(a) 在 SPEC 里写明「动态标签为预留能力，当前无生产调用方」并给这套子系统单独标注覆盖率豁免，让它随 spec 演进；(b) 删掉标签分支，`sql-template` 退化为纯 `#{...}` 绑定器（能砍掉约 600 行 + 整个 `new Function` 面）。选 (b) 前建议先确认 `docs/Iterations/SqlTemplateParser/spec.md` 的原始意图。

**置信：confirmed**（命中数实测；`intentional` 的可能性见争议节）

---

### F-w9-infrasql-pro-7 | **P3** | `packages/core/src/infra/serialization/zod-to-json-schema.ts:19-62`

```ts
if (typeof withJson.toJSONSchema === "function") return withJson.toJSONSchema();
return zodTypeToJsonSchema(schema);
```

`@novel-master/core` 依赖 `zod: ^4.4.3`（`packages/core/package.json`），实测 zod 4.4.3 里 `ZodObject/ZodString/ZodArray/ZodOptional/ZodEnum/ZodRecord/ZodUnion/ZodNullable` **全部**带 `toJSONSchema` 方法。因此 `zodTypeToJsonSchema`（41 行）**永不可达**。

而且它就算可达也是错的：`ZodEnum`/`ZodUnion`/`ZodRecord`/`ZodNullable`/`ZodDefault` 都不在分支里，会掉到 `:61` 的兜底 `return { type: "object", additionalProperties: true }`——把 `z.string().nullable()` 对 LLM 宣称为 object。建议直接删掉整个 fallback，只保留 `z.toJSONSchema(schema)`。

**置信：confirmed**（node 实测 9 种类型的 `typeof toJSONSchema === "function"`）

---

### F-w9-infrasql-pro-8 | **P3** | `packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts:15`

```ts
export function parseKkvJsonDocument<T>(raw: string, decodeFn: (parsed: unknown) => T): T {
```

文件头自称「KKV 存储 JSON 文档解析与 decode **单源入口**」，但全仓 `git grep --word-regexp parseKkvJsonDocument` 只有 **1 处命中——就是它自己的定义**。零生产调用、零测试引用。整个文件（21 行）可删。

**置信：confirmed**

---

### F-w9-infrasql-pro-9 | **P3** | `packages/core/src/infra/sql-template/errors.ts:11`

```ts
| "INVALID_COLLECTION";
```

全仓 grep 只有这一处声明，无任何 `throw new SqlTemplateError("INVALID_COLLECTION", …)`。`evaluator.ts:85-86` 对空集合是静默 `break`：

```ts
const items = normalizeCollection(collection);
if (items.length === 0) break;
```

要么实现它（`normalizeCollection` 返回 `[]` 时抛），要么从错误码联合里删掉——现在它是一个永远不可能出现在 catch 分支里的 code，消费方写了 `case "INVALID_COLLECTION"` 会被 lint 判死代码但运行时永不命中。

**置信：confirmed**

---

### F-w9-infrasql-pro-10 | **P3** | `packages/core/src/infra/sql-template/context-proxy.ts:1-18` vs `context.ts:21-27`

`context-proxy.ts` 文件头写「Proxy wrapper so undefined property chains in test expressions yield undefined, not throw」——**文件里没有任何 Proxy**。实际只剩一个合并函数，而它和 `context.ts:21-27` 的私有 `mergedContext` 是同一件事的两种写法（`Object.assign` vs `for..of Object.entries`）。

即：两份同义实现，其中一份对外 export、一份私有。建议删掉 `context-proxy.ts`、把 `mergedContext` 提为 export 让 `expression.ts:150` 直接用，同时修正那段过期的 Proxy 注释。

**置信：confirmed**

---

### F-w9-infrasql-pro-11 | **P3** | `packages/core/src/infra/sql-template/context.ts:51-56`

```ts
export function resolveCollectionName(stack: ContextStack, collectionAttr: string): unknown {
  return resolvePath(stack, collectionAttr);
}
```

零逻辑的转发，唯一调用方是 `evaluator.ts:84`。内联掉即可；顺带 `:48` 的 docstring「Reads a collection expression name from the root-ish context」措辞也不准——它并不 root-ish，是全栈合并后按点路径走。

**置信：confirmed**

---

### F-w9-infrasql-pro-12 | **P3** | `packages/core/src/infra/serialization/decode.ts:10-12`

```ts
function zodMessage(error: { message: string }): string {
  return error.message;
}
```

恒等函数，唯一调用点 `:20`。传进去的 `parsed.error` 本来就是 ZodError，直接 `parsed.error.message` 即可。

**置信：confirmed**

---

### F-w9-infrasql-pro-13 | **P3** | `parse-text.ts:10` 与 `stringify-text.ts:8`

```ts
export type TextFormat = "yaml" | "json";   // 两处各声明一次，彼此不引用
```

同一个类型在两个文件里各写一遍。改一处忘另一处不会报错（结构相同所以 TS 也不一定拦得住跨文件的 nominal 检查）。应由 `parse-text.ts` 定义、`stringify-text.ts` re-export。

**置信：confirmed**

---

### F-w9-infrasql-pro-14 | **P3** | `packages/core/src/infra/serialization/stringify-text.ts:16`

```ts
return `${JSON.stringify(value, null, 2)}\n`;
```

两个问题：
1. `JSON.stringify(undefined)` 返回 `undefined`（值本身），模板串把它变成字面量 `"undefined\n"` —— **一段不是合法 JSON 的字符串**，且不报错。`value` 为 `undefined` 时静默产出坏数据。
2. **错误契约不对称**：`parseText`（`:19-28`）把 `JSON.parse` / yaml 异常统一包成 `ConfigDecodeError`，`stringifyText` 侧 `JSON.stringify` 遇循环引用抛裸 `TypeError`、遇 `BigInt` 抛裸 `TypeError`，直接穿透到调用方。同一模块的读侧有类型化错误、写侧没有。

**置信：confirmed**（读 `JSON.stringify` 语义；未跑运行时复现，但语义无歧义）

---

### F-w9-infrasql-pro-15 | **P3** | `packages/core/src/infra/sql-template/parser.ts:41-43`（注释与现实不符）

```ts
 * 同一段模板字符串反复解析纯属浪费……模板字符串通常数量有限（来自配置），
 * 缓存增长可控，不需要 LRU。
```

「来自配置」不成立：模板来自 249 处 repository 代码字面量 + 17 处运行时拼接的 IN 列表（见 F-1）。这条注释是 F-1 那条「不需要 LRU」决策的论证前提，前提既然错了，决策就该重审。至少把注释改成实测口径。

**置信：confirmed**

---

### F-w9-infrasql-pro-16 | **P3** | `packages/core/src/infra/sql-template/index.ts:56`

```ts
const evaluator = new TemplateEvaluator(this.placeholder);
```

`TemplateEvaluator` 除 `this.placeholder` 外无状态，而这个 placeholder 在 `SqlTemplateParser` 构造时就定死了（`:40`）。即每次 `parse()` 都新分配一个只读字段的短命对象。挪到构造函数里建一次即可。

**置信：confirmed**

---

### F-w9-infrasql-pro-17 | **P3** | `packages/core/src/infra/kkv-value-codec.ts:15`

```ts
throw new Error(`Expected boolean string, got: ${value}`);
```

裸 `Error`，而 `infra/` 下同侪（`tdbc/errors.ts:19` `TdbcError`、`sql-template/errors.ts:16` `SqlTemplateError`）都是带 code 的类型化错误，仓库另有专门的 infra-local error 决策（见 `docs/Iterations/cr-fix-spec/review/guides/lens-L3-architecture.md:39`）。另外 `:18` 的 docstring 写「for KKV storage (`nm-preferences` module)」，把通用编解码器绑死在一个具体偏好模块上，实际消费方也只有 `persistent-preferences.service.ts`。建议改抛 `ConfigDecodeError` 并把 docstring 泛化。

**置信：confirmed**

---

### F-w9-infrasql-pro-18 | **P3** | `packages/core/src/infra/random-uuid.ts:24-27`

```ts
/** Validates RFC4122 v4 UUID format (for tests and callers). */
export function isRandomUuidV4(value: string): boolean {
```

全仓消费方只有 `packages/core/test/agent/agent-runner.test.ts:584` 与 `packages/core/test/infra/random-uuid.test.ts`。测试专用断言器住在生产模块里，且随 `@novel-master/core` 一起进 dist。docstring 自己写了「for tests」，属自知自明。若要清，挪进 `test/` 侧的 helper 即可。

**置信：confirmed ／ intentional 倾向**（docstring 已自陈用途，可能是有意留的测试入口）

---

### F-w9-infrasql-pro-19 | **P3** | `packages/core/src/infra/sql-template/tags/where.ts:10`

`stripLeadingAndOr` 带 `export`，但全仓只在同文件 `:24` 被调用（未从 `sql-template/index.ts` 转出）。去 `export` 即可。当前是 tags 子树内唯一的多余导出面（`normalizeCollection`/`applyTrimOverrides` 确有跨文件消费者）。

**置信：confirmed**

---

## 争议与存疑

1. **F-6 的「intentional」可能性我给不出结论，需要主代理裁决。**
   `docs/Iterations/core-explore-remediation/features/quality-backlog/explore-tdbc-sql-template.md:406` 把 `infra/tdbc` + `infra/sql-template` 定性为「packages/core 数据记忆层的程恒基建」「先提下，安全与正确性满足生产使用」——**读起来像是明知暂无生产调用方、仍按基建保留**。但：
   - 那句「先提下」的完整语境在 GBK 乱码的探索文档里，我无法确定它是否覆盖「动态标签」这一层（而非只覆盖 TDBC 连接协议）；
   - `docs/apm/RULE.md` 里**没有**任何一条把动态标签列为「保留能力」；
   - 反例在 `docs/apm/RULE.md:95`：`stream-watchdog.ts`（idle 原语，无接入方，导出保留）被明确记为「用户拍板」的特例，说明仓库对「无接入方但保留」是有显式决策记录的，而动态标签没有。
   所以我按 **confirmed finding** 报（零生产使用是事实），但把「是否 intentional」这个判断留给主代理与辩护者对账。

2. **`${}` 绑定路径（`BIND_DOLLAR_RE` / `renderBind` 的 dollar 分支）我判定为 intentional，不当问题报。**
   `packages/core/test/infra/sql-template/no-dollar-in-repository-sql.test.ts:132` 是 CI 级守卫，禁止 `/repositories/` 与 `sqlite-*.ts` 的模板里出现 `${`；`docs/Iterations/core-architecture-style/spec.md:144` 明确写了这条 lint guard 的存在。也就是说 dollar 分支在生产中是**被策略主动封杀**的，靠测试维持而非靠代码维持——这是设计决定不是疏漏。
   但 F-3 那个 bug（字面量里的 `${}` 被静默吞掉）我仍然报：守卫只能防「人主动写 `${}`」，防不住「模板里嵌了一段含 `${` 的 SQL 字面量/JSON」这种间接引入。

3. **F-1 的实际严重度我可能高估了。**
   我核对了分片纪律：`sqlite-session-kkv` 有 `GET_MANY_CHUNK_SIZE = 400`（`:35`），`sqlite-vfs-revision` 有 `REVISION_BATCH_CHUNK_SIZE = 100` / `REVISION_REPAIR_CHUNK_SIZE = 500`（`:37`/`:40`）——**仓库里是有绑参上限意识的**。真正不分片的只有 message-checkpoint 三处（`:128`/`:382`/`:401`），而它们的入参是「本次回填的新增段」，N 的分布取决于用户历史，不是每次都大。所以缓存滞留是「跨会话累积的慢增长」而非「一次性爆掉」，P1 可能该降到 P2。我保留 P1 是因为**没有任何一处有上界**（`LIMIT -1`），最坏情况确实可达会话全长，且 desktop 是长驻进程。请主代理按 mobile/desktop 的实际会话规模复核后定级。

4. **F-5 的可达性我判为 suspected 而非 confirmed。** 缺陷本身已复现，但现有 4 个消费方都在单次 dispose 路径上使用，且 `session-stream-unit-manager.service.ts:1950` 额外做了 `this.subscriptions.length = 0` 防重入。要触发得引入「句柄逃逸 + 二次 unsubscribe」的调用模式，当前代码里没有。修不修取决于是否认为公开 API 该对这种用法免疫。

5. **`tdbc/` 我没找到问题，但有一条观察留给其它机位核实**：三个驱动包并存（better-sqlite3 / op-sqlite / rn），`apps/mobile/README.md:15` 明说 rn 是「保留作回滚线」，`RULE.md:26` 也确认这是用户拍板的。因此 **rn 驱动不算死代码**，但它与 op-sqlite 的双份 adapter/bindings/row-mapper/mutex 实现（`packages/tdbc-driver-rn/src/` 与 `packages/tdbc-driver-op-sqlite/src/` 文件名一一对应）是否可合并，超出本区边界，交给 `w3-xc-dup-ends` 之类机位。

6. **未覆盖的相邻面**：本区 `infra/` 下另有 11 个子目录（`cloud-sync` / `content-cache` / `db-backup` / `db-maintenance` / `llm-protocol` / `nmtp` / `prompt-template` / `sksp` / `tokenizer`）不在本区职责内，但 `serialization/zod-to-json-schema.ts` 的唯一消费者在 `llm-protocol/logic/tool-definitions.ts:26`，`kkv-value-codec.ts` 的唯一消费者在 `service/persistent-preferences/`——这两条跨界链路已核，其余未展开。