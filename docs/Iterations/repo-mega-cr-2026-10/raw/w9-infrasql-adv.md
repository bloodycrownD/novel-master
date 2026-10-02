---
zone: w9-infrasql-adv
agent: 辩护人（advocate / 对抗机位）
files_scanned: 29
  - packages/core/src/infra/tdbc/{index,types,errors}.ts
  - packages/core/src/infra/tdbc/logic/{open,registry,normalize-bindings,template-helper}.ts
  - packages/core/src/infra/tdbc/ports/{connection,driver}.port.ts
  - packages/core/src/infra/sql-template/{index,types,errors,parser,evaluator,expression,context,context-proxy,placeholder}.ts
  - packages/core/src/infra/sql-template/tags/{foreach,trim,where}.ts
  - packages/core/src/infra/serialization/{decode,encode,parse-text,stringify-text,zod-to-json-schema}.ts
  - packages/core/src/infra/{date-format,kkv-value-codec,random-uuid}.ts
  - （旁证只读）packages/core/test/infra/{sql-template,tdbc,serialization}/*.test.ts、packages/tdbc-driver-*/src、docs/apm/RULE.md:26
---

## 摘要

本区是 core 的「数据落地底座」三件套：`tdbc/` 定义一套与具体 SQLite 实现解耦的**异步连接协议**（连接/驱动两个 port + 驱动注册表 + URL 工厂），core 全域约 180 处只依赖 `TdbcConnection` 五个方法；`sql-template/` 是一套 **MyBatis 风格动态 SQL 的两段式实现**（词法/AST 阶段 `parser.ts` + 求值阶段 `evaluator.ts`），把「拼字符串」变成「拼 AST + 有序参数」；`serialization/` 是 Zod 驱动的 wire 编解码与 YAML/JSON 文本桥。根目录三个小文件是纯函数工具（本地时间格式化、KKV 布尔编解码、跨端 UUID）。整体设计意图明确：**协议在上、驱动在下、SQL 模板集中一处、值一律走绑定而非拼接**。

## 职责与边界

- **tdbc = 连接协议抽象层**。core 只认 `TdbcConnection`（`execute` / `query` / `batch` / `transaction` / `close`）与 `TdbcDriver`（`name` + `open`）。三个驱动包（`tdbc-driver-better-sqlite3` / `-op-sqlite` / `-rn`）各自实现，core 对 better-sqlite3 / op-sqlite / quick-sqlite 零感知（`registry.ts:11-19`）。
- **tdbc 不含任何 SQL 文本**，也不含任何原生依赖（`index.ts:4` 模块注释明确 "Zero native dependencies"）。它只提供 `open()` 工厂与驱动注册表。
- **sql-template = 动态 SQL 编译器**。输入模板字符串 + 运行时参数对象，输出 `{ sql, parameters }`。**不接触连接**——它对数据库一无所知，是纯函数层（`tdbc/logic/template-helper.ts` 才是唯一的胶水层，14 行）。
- **serialization = wire 格式边界**。`decode`（untrusted → 领域类型）、`encode`（领域类型 → wire）、`parseText`/`stringifyText`（YAML/JSON 文本桥）、`zodToJsonSchema`（Zod → JSON Schema，给 LLM 工具用）。
- **边界外**：`normalizeBindings` 只被 better-sqlite3 驱动消费（`packages/tdbc-driver-better-sqlite3/src/connection.ts:95,112,137`），另两个驱动各有自己的 `normalizeXxxBindings`——**core 的这个 helper 不是协议强制项**，见让步 F-w9-10。

## 对外接口

`packages/core/src/index.ts` 是唯一的公共出口，四个模块都从这里转出：

| 符号 | 出处 | 消费方（实测 grep） |
|---|---|---|
| `TdbcConnection` / `TdbcDriver` / `TdbcError` / `BatchResult` / `Row` / `SqlValue` / `OpenOptions` | `tdbc/index.ts:9-30` | core 内 180+ 处 `import type`；三个驱动包 |
| `open` / `parseUrl` / `registerDriver` / `getDriver` / `listDrivers` / `resolveDriver` / `clearDrivers` | `tdbc/index.ts:13-22` | apps/{desktop,cli}/src/runtime.ts、apps/mobile/src/db/connection.ts、驱动包 `register.ts` |
| `normalizeBindings` | `tdbc/index.ts:13` | 仅 better-sqlite3 驱动 |
| `executeTemplate` / `queryTemplate` | `tdbc/index.ts:23` | 约 20 个 sqlite repository + `usage-stats.service.ts` + `find-saved-model-references.ts` |
| `SqlTemplateParser` / `SqlTemplateError` / `parseTemplateToAst` / `TemplateParser` / `evaluateTest` / `normalizeExpression` / `bindExpressionToContext` | `sql-template/index.ts:8-23` | 所有 sqlite repository 各自 `private readonly parser = new SqlTemplateParser()`；`index.ts:12-16` 亦作公共 API 转出 |
| `decode` / `encode` / `EncodableSchema` | `serialization/{decode,encode}.ts` | 约 8 处 service/domain + `src/index.ts:267-268` |
| `parseText` / `stringifyText` | `serialization/{parse-text,stringify-text}.ts` | `parse-skill-front-matter.ts:51`、`character-card-to-md-tree.ts:98` |
| `zodToJsonSchema` | `serialization/zod-to-json-schema.ts` | `llm-protocol/logic/tool-definitions.ts:26`、`src/public/provider.ts:118` |
| `formatLocalDateTime` | `infra/date-format.ts` | `expand-dynamic-macros.ts:8`、`workplace-display.ts:7`、`public/provider.ts:109` |
| `randomUUID` | `infra/random-uuid.ts` | 6 处（agent-run-id、session/message/project/provider service、in-memory-agent-session） |
| `parseBoolean` / `formatBoolean` | `infra/kkv-value-codec.ts` | `persistent-preferences.service.ts:9`（唯一点） |
| `isRandomUuidV4` | `infra/random-uuid.ts:25` | 仅测试 |

`tdbc/index.ts` 的 barrel 面很窄（22 行），`sql-template/index.ts` 转出了 `parseTemplateToAst` / `TemplateParser` / `evaluateTest` / `normalizeExpression` / `bindExpressionToContext` 五个**内部实现细节**（见让步 F-w9-14）。

## 数据访问

本区**自身不访问任何表 / KKV 域 / 文件路径**——这是刻意的边界设计，实测确认：

- 无 `node:fs` / `node:path` / `path` 引用（三个根文件全部纯函数，无 I/O）。
- 无 SQL 字面量（`sql-template` 只把 `?` 当占位符输出，模板文本由调用方给）。
- 无 KKV / 表名常量。

唯一的「数据形状」接触面是类型定义：
- `tdbc/types.ts:8` `SqlValue = null | number | string | bigint | Uint8Array` —— SQLite 列值的 JS 表示，被 `sqlite-session-kkv.repository.ts:19`、`blob-binary-normalization.ts:49` 用作 row 类型。
- `kkv-value-codec.ts:18` 注释锚定 `nm-preferences` module —— 全仓唯一点在 `persistent-preferences.service.ts:9`。

真正被本区协议约束的表是 core 全部 16 张业务表 + `sksp_secrets`，但那些 SQL 文本不在本区。

## 依赖关系

**import 了谁**（本区出边，全部很薄）：

```
tdbc/logic/registry    → tdbc/ports/driver.port, tdbc/errors
tdbc/logic/open        → tdbc/ports/connection.port, tdbc/errors, tdbc/logic/registry
tdbc/logic/template-helper → sql-template/index (type-only), tdbc/ports/connection.port (type-only), tdbc/types (type-only)
sql-template/evaluator → context, expression, placeholder, tags/{foreach,trim,where}, types
sql-template/expression → errors, context(type), context-proxy
sql-template/parser    → errors, types
serialization/{decode,encode} → zod (type), @/errors/config-decode-errors
serialization/parse-text    → yaml, @/errors/config-decode-errors
serialization/stringify-text→ yaml
serialization/zod-to-json-schema → zod
infra/random-uuid      → （零依赖，globalThis.crypto）
infra/{date-format,kkv-value-codec} → （零依赖）
```

出边 noteworthy 观察：**`tdbc/logic/template-helper.ts` 对 sql-template 只有 `import type`**（第 7 行），所以 tdbc → sql-template 是单向的编译期依赖，运行时无环。这是分层做对的关键证据。

**被谁消费**（入边，密度极高）：见「对外接口」表。要点：core 全域 **180+ 处** `import type { TdbcConnection }`，**没有一个 domain/service 直接 import 任何驱动包**——三个驱动包只依赖 core 的 `registerDriver`，反向无依赖。这条单向依赖线是整个数据层可替换性（desktop better-sqlite3 / mobile op-sqlite）的全部依据，`docs/apm/RULE.md:26` 把它记为长期决策。

## 发现清单

> 本机位立场为**辩护**，故「发现清单」以「设计合理性论证」为主（编号 D-*），真实缺陷以让步清单 F-* 呈现（见下一节）。两处 D 与 F 重号处已交叉注明。

### 设计合理性论证（辩护理由清单）

**D-w9-1 | 连接协议抽象：五个方法收敛到极致，是本仓最成功的抽象**
`tdbc/ports/connection.port.ts:13-43` 只声明 `execute / query / batch / transaction / close`。没有 `exec`、没有 `prepare`、没有 `run`、没有 `all`、没有 `each`、没有 raw 句柄 escape hatch。
证据：`docs/apm/memory/20260815-sql-cr-audit-fix.md:12` 记着「所有 SQL 收敛在 TdbcConnection 三方法上，可以零遗漏拦截计时」——当年那轮 28 条 finding 的 SQL 全量 CR 之所以能「零遗漏」，正是因为没有旁路。
辩护要点：**port 的方法数决定了可审计面**。多一个 `raw(sql)` 就多一条绕过绑定的路，这个 port 明确不开。这是把「可审计性」当成抽象约束来设计的，不是事后补的。

**D-w9-2 | 三驱动同协议 + 单一 conformance 套件，回滚线成本低到两行**
`packages/tdbc-conformance/src/suite.ts`（10.5KB）+ `nested-batch.ts` 对三个驱动跑同一套契约；`packages/tdbc-driver-op-sqlite/src/register.ts` 顶部注释写明「`index.ts` 与 `native.ts` 两个入口是平行实现，统一转发到 `register.ts` 内部单点，杜绝『只改 index.ts 漏掉 native.ts』的分叉」。
辩护要点：`docs/apm/RULE.md:26` + `20260816-replace-quick-sqlite.md:18` 记录的换库决策（op-sqlite 替代 quick-sqlite，保留 rn 作回滚线，mobile 回滚 = `connection.ts` 两行 + 重装）之所以敢拍板，前提正是**协议层没有掺任何驱动特有的东西**。这是抽象做对了才有的选项价值——若 core 里散落着 `sqlite3_changes()` 或 `PRAGMA` 调用，换库就不是两行而是全仓改造。

**D-w9-3 | 驱动注册表用「唯一名 + 显式指定」消歧，多注册直接抛错而非静默挑一个**
`tdbc/logic/registry.ts:46-72`：`resolveDriver(explicit?)` 在 names.length !== 1 且未显式指定时抛 `UNKNOWN_DRIVER`，错误消息直指修复方式（"Multiple drivers registered; specify options.driver"）。
实测所有生产调用点都传了显式 driver：`apps/mobile/src/db/connection.ts:74` `open(MOBILE_TDBC_URL, {driver:'op-sqlite'})`、`apps/cli/src/runtime.ts:180`、desktop `runtime/connection.ts`。
辩护要点：**fail-fast 优于隐式兜底**。一个「注册了两个驱动就随便挑一个」的注册表会在 mobile 静默用错引擎、产生只在线上复现的库损坏。这个设计把歧义消灭在第一次启动。

**D-w9-4 | 模板解析器两段式切分：parse（纯语法、不看参数） / evaluate（纯求值、不看语法）**
`parser.ts:1-4` 模块注释：「phase 1: lexical scan and AST construction. Does not read runtime params」；`evaluator.ts:1-4`：「phase 2: walks AST with a context stack」。
分层的实际收益是可测的：`test/infra/sql-template/` 下 7 个测试文件按 `parser` / `expression` / `evaluator-if-where` / `evaluator-foreach` / `evaluator-trim-choose` / `errors` / `sql-template` 切分，41 个用例全绿（实测 `npx tsx --test`）。
辩护要点：`parser.ts:46-54` 的 `TemplateParser.astCache` 只在 parse 层，key 是模板原文——因为 parse 已经是纯函数，缓存才成立。**两段式是缓存正确性的前提**，如果 parse 掺了参数，AST 就无法跨参数复用。这个顺序不能倒。

**D-w9-5 | 表达式求值用「标识符重写 + 可选链」而非 Proxy/context 反射，从根上消除 undefined 抛错**
`expression.ts:103-116` 把裸标识符重写成 `__ctx__.a?.b?.c`；`context-proxy.ts:8-18` 提供扁平合并后的 `__ctx__`。
实测收益（`tsx` 直跑）：
- `<if test="a.b.c != null">` 在 `a` 为 undefined 时不抛错，按 falsy 处理。
- `<if test="[1].length">` 会变成 `[1]?.__ctx__` 类形态而报错（`Cannot read properties of undefined`）——**这恰恰是防线**：非路径表达式被重写后自然失效。
辩护要点：常见实现会用 `new Proxy` 做「任意路径读 undefined」，但 Proxy 有两个硬伤（`typeof`/枚举行为诡异、性能开销随访问次数线性放大）。重写方案的代价是「表达式只能用路径语法」，换来的是零 Proxy 开销 + 天然的作用域收敛。

**D-w9-6 | `new Function` 求值配了 FORBIDDEN_PATTERN 白名单 + 全链路无动态 test 的双重保险**
`expression.ts:9-10` 禁 `[;{}]`、`=>`、`function`、`new`、`eval`、`import`、`constructor`；`expression.ts:142-148` 在编译前检查。
实测沙箱逃逸尝试（全部被拦或无害）：
| 输入 | 结果 |
|---|---|
| `test="a.constructor.name"` | THROW `EXPRESSION_ERROR` Disallowed syntax |
| `test="a.__proto__.polluted = 1"` | THROW，原型链零污染（实测 `({}).polluted === undefined`） |
| `test="process"` / `test="globalThis"` | 恒 falsy（被重写成 `__ctx__.process`，取不到全局） |
| `test="a = 99"` | 不改调用方 params（实测 `{"a":1}` 原样） |
辩护要点：**关键在于 `test` 属性从不动态插值**。实测全仓 `src/` 无一处 `test="${`，所有 `test` 都是源码里的字面量。加上 `test/infra/sql-template/no-dollar-in-repository-sql.test.ts` 这个 CI 闸门（见 D-w9-7），`new Function` 实际永不接触攻击者可控文本——它是**语法糖编译器，不是安全边界**。设计者清楚这一点，所以没在 sandbox 上过度投资，而是把预算花在「不让动态文本进来」上。

**D-w9-7 | 有一道 CI 闸门强制「repository 层 SQL 禁用 `${…}` 裸插值」**
`test/infra/sql-template/no-dollar-in-repository-sql.test.ts:121-149` 扫 `src/domain/**/repositories/**` 与所有 `sqlite-*.ts`，检查两类违规：转义的 MyBatis `\${`、以及剥掉 JS 插值后残留的字面 `${`。
实测通过（`# pass 1 / # fail 0`）。
辩护要点：这是「用测试把架构约束钉死」的典范。约束写在文档里会烂，写成测试就不会烂。**但覆盖面有缺口**，见 F-w9-13。

**D-w9-8 | `SqlTemplateParser.parse` 的 `@remarks` 明确写出 `${}` 的注入风险与使用前提**
`sql-template/index.ts:48-53`：原文写明「`${name}` placeholders are interpolated as raw strings into the output SQL and are **not** added to `parameters`. Only use `${...}` with trusted, validated values... Untrusted input in `${...}` can cause SQL injection. Prefer `#{name}`」。
辩护要点：**危险能力被保留但被显式标注**，而不是被删掉。删掉 `${}` 会让「表名/列名不能是绑定参数」这个 SQLite 硬约束逼着所有人去手拼——保留它 + 标注 + CI 禁用在 repository 层，是三段式里最优的。（实测全仓 `src/` 无一处 `\${`，即该能力目前生产零使用。）

**D-w9-9 | 值绑定永远走 `parameters` 数组，顺序由 AST 遍历序保证，不靠人工同步**
`evaluator.ts:35-36` `state.parameters` 与 `state.parts` 严格同步 push；`placeholder.ts:23-24` `#{}` → `{fragment: "?", parameters: [value]}`。
实测顺序正确性（`evaluator-foreach` 系列已覆盖）：`<foreach collection="xs" item="i" separator=",">#{i}</foreach>` with `[1,2,3]` → `sql="(?,?,?)"` `params=[1,2,3]`。
辩护要点：**参数顺序错误是动态 SQL 最难查的一类 bug**（不报错、只是查错数据）。把它变成 AST 遍历的副产品而不是人工契约，等于把一整类 bug 从「需要测试」降级到「结构上不可能」。

**D-w9-10 | `TdbcError` / `SqlTemplateError` 都带 `code` 判别式 + `cause`，错误契约可被上层精确处理**
`tdbc/errors.ts:8-14` 六个 code（`UNKNOWN_DRIVER` / `INVALID_URL` / `CONNECTION_CLOSED` / `SQLITE_ERROR` / `BATCH_FAILED` / `NESTED_TRANSACTION`）；`sql-template/errors.ts:6-11` 五个。
消费侧确有精确处理：`domain/tool/logic/format-tool-output.ts:11` 与 `service/skills/impl/skills.service.ts:19` 专门 import `TdbcError` 做错误映射；`revision-aware-vfs.service.ts:37` 同样。
辩护要点：`SqlTemplateError` 还带 `offset` / `tagName`，实测 `<if test="">` 报 "Empty test expression"、`<when>` 在 `<choose>` 外报 "must appear inside <choose>"、未知标签带标签名——**模板作者能靠报错定位到字符**。这类「开发者体验投入」在基础设施里常被砍，但它是模板化 SQL 能否被非原作者安全维护的前提。

**D-w9-11 | serialization 层薄到只有「边界翻译」，不持有任何策略**
`decode.ts` 17 行、`encode.ts` 28 行、`parse-text.ts` 30 行、`stringify-text.ts` 19 行。`encode.ts:12` 甚至专门注释了 `toWire` **不叫 `encode`** 的理由：「to avoid clashing with Zod v4 `.encode()`」。
辩护要点：`decode`/`encode` 不是「序列化框架」，是两个函数。`encode.ts:20-26` 在 schema 没定义 `toWire` 时抛 `ENCODE_NOT_SUPPORTED` 而不是静默返回原对象——**失败显式化**是这一层唯一值得称道的性质。

**D-w9-12 | `random-uuid.ts` 三级降级且每一级都有注释说明代价**
`crypto.randomUUID()` → `crypto.getRandomValues()` → `Math.random()`（末级注释：「Last resort for legacy runtimes — IDs are not cryptographically strong」），并手工设置 v4 版本位与 variant 位（`bytes[6] = (bytes[6] & 0x0f) | 0x40`）。
辩护要点：为 Hermes/RN 老版本留降级路径，同时**不隐瞒降级后的安全等级**。对比直接 `import { randomUUID } from 'node:crypto'`（Hermes 不支持）——这个文件是跨端兼容的必要成本。

**D-w9-13 | `date-format.ts` / `kkv-value-codec.ts` 是 15/19 行的单职责纯函数，不值得更多**
`formatLocalDateTime` 15 行、`parseBoolean`/`formatBoolean` 19 行。无外部依赖、无状态、无分支堆砌。
辩护要点：这一层**不该有抽象**。`kkv-value-codec` 唯一消费点是 `persistent-preferences.service.ts:9`，把 `"true"`/`"false"` ↔ `boolean` 收敛到一处而不是散在 KKV 读写各处——这就是它存在的全部理由，19 行刚好。

**D-w9-14 | 无循环依赖：`tdbc → sql-template` 只有 type-only 依赖**
`tdbc/logic/template-helper.ts:7` `import type { SqlTemplateParser }`，编译后无运行时边。
辩护要点：胶水层放在 `tdbc/logic/` 而不是 `sql-template/` 里，意味着 **sql-template 可以脱离数据库单测**（`test/infra/sql-template/` 7 个文件全部无 DB fixture，实测 41/41 绿，秒级）。依赖方向选对了，测试成本差一个数量级。

---

## 让步清单

> 辩护方承认的、确实应该修或至少应该记录的点。按优先级排。

**F-w9-1 | P2 | `parser.ts:79-86,169-182` | 把 `WHERE x<y > z` 判成未知标签**
引文：
```ts
const unknown = /^(\w+)(\s+[\w-]+=|\s*>)/.exec(probe);
...
throw new SqlTemplateError("UNKNOWN_TAG", `Unknown tag <${unknown[1]}>`, {...});
```
实测：`'WHERE x<y > z'` → THROW `UNKNOWN_TAG: Unknown tag <y>`；`'WHERE x<y> z'` 同样抛。而 `'WHERE a < b AND c > d'`、`'WHERE x <= 5'`、`'WHERE x<>y'`、`'a<b'` 都正常（`<` 后有空格才不触发）。
描述：`isTagStart` 的启发式（`<` + `\w+` + 可选 `>`）无法区分 HTML/XML 风格标签与 SQL 的裸比较表达式。当前 0 处生产模板命中（实测所有模板里 `<` 后都跟空格或 `<=`），所以是**潜在**缺陷不是现存故障。
建议：① 未知标签改为**降级为文本 + 警告**，不抛——因为抛错的代价（启动失败）远大于漏判一个真标签的代价；② 或要求标签必须写在行首/空白后。
置信：**confirmed**（行为实测复现）／影响面 suspected（无生产命中）。

**F-w9-2 | P2 | 模板文本里一个裸 `?` 会被 SQLite 当成占位符，导致参数错位**
引文（`placeholder.ts:22-27`）：
```ts
if (kind === "hash") {
  return { fragment: placeholder, parameters: [value] };
}
```
实测：`"SELECT * FROM t WHERE note = 'what?' AND id = #{id}"` → `sql` 含 2 个 `?` 但 `parameters.length === 1`。
描述：字符串字面量里的 `?` 对 SQLite 无害（SQLite 词法分析认引号），但会让**任何基于「数 `?` 个数」的对账逻辑**失真。更要命的是 `<trim suffixOverrides="…?">` 这类 override 若成功剥掉一段含真实占位符的文本，会造成 `?` 数与参数数的**真错位**（驱动层表现为 bind 越界或绑到错列）。
当前实际风险：**低**。实测 `<trim suffixOverrides="AND ?">…</trim>` 反而**剥不掉**——因为 override 正则末尾锚了 `\b`（见 F-w9-3），`?` 是非单词字符，`\b` 不成立。也就是说 F-w9-3 这个 bug 恰好挡住了 F-w9-2 的最坏形态。这是一处**互相掩盖的双缺陷**，修 F-w9-3 时必须同步处理 F-w9-2。
建议：把「`?` 计数 == parameters 计数」做成 `SqlTemplateParser.parse` 返回前的不变式断言（dev 模式抛错），或改用非 `?` 的默认占位符。
置信：**confirmed**（行为实测）／严重度 suspected（需先有人写出含裸 `?` 的模板）。

**F-w9-3 | P2 | `tags/trim.ts:32,39` override 正则末尾的 `\b` 让所有非单词结尾的 override token 永不匹配**
引文：
```ts
const re = new RegExp(`^\\s*${escapeRegExp(token)}\\b\\s*`, "i");
```
描述：`\b` 要求 token 末尾与后一个字符之间存在单词边界。token 以 `?` / `(` / `,` / `)` 等非单词字符结尾时，`\b` 永不成立。
实测：`prefixOverrides="AND ("` 不生效（输出仍是 `AND (?)`）；`suffixOverrides="AND ?"` 不生效；对比 `prefixOverrides="AND "`（末尾是空格，`\s*` 先吃掉空格再接 `AND` 的 `\b`… 实测生效）——即「MyBatis 允许任意 override token」与「本实现只支持单词结尾 token」之间存在未记录的语义差。
建议：把 `\b` 改为「仅当 token 末字符是单词字符时才追加」，或直接去掉（MyBatis 原实现也无此锚）。
置信：**confirmed**（实测三组对照）。**注意**：修复此项会同时打开 F-w9-2 的最坏路径，两者必须同一 PR 处理。

**F-w9-4 | P3 | `serialization/zod-to-json-schema.ts:22-62` 整个 40 行 fallback 在当前依赖下是死代码**
引文：
```ts
const withJson = schema as z.ZodType & { toJSONSchema?: () => JsonSchema };
if (typeof withJson.toJSONSchema === "function") { return withJson.toJSONSchema(); }
return zodTypeToJsonSchema(schema);
```
实测：`zod@^4.4.3` 下 `typeof schema.toJSONSchema === 'function'` 恒真（`z.object({...}).toJSONSchema()` 直接返回带 `$schema` / `description` / `enum` / `minimum` 的完整 schema），fallback 分支永不执行。
描述：fallback 里的 `z.ZodOptional` / `z.ZodObject` / `z.ZodString` 等 instanceof 分支是**从未被执行过的代码**，其正确性无测试保障；一旦哪天 zod 降级或 schema 来自另一份 zod 实例，它会静默产出**丢失 description/enum/约束**的降级 schema 发给 LLM——工具调用质量无声下降。
建议：要么删掉 fallback（并在 `package.json` 锁死 zod v4），要么加一条「构造一个抹掉 `toJSONSchema` 的 schema」的单测把它钉住。当前 `test/infra/serialization/serialization.test.ts` 未覆盖此分支。
置信：**confirmed**（实测 zod v4 恒走第一分支）。

**F-w9-5 | P3 | `sql-template/context-proxy.ts` 文件名与模块文档承诺的 Proxy 并不存在**
引文（第 1-3 行）：
```ts
/**
 * Proxy wrapper so undefined property chains in test expressions yield undefined, not throw.
 */
```
描述：实现是 `Object.entries` 逐键合并的普通对象（第 11-18 行），**没有任何 Proxy**。真正实现「undefined 链不抛」的是 `expression.ts:103-116` 的可选链重写（见 D-w9-5）。文件名 `context-proxy.ts` 会让下一个维护者以为这里有 Proxy 语义（比如误以为改这里能影响链式解析），而实际上删掉整个文件、把合并逻辑并回 `context.ts` 对行为零影响。
建议：重命名为 `expression-context.ts` 或 `context-flatten.ts`，并把模块文档改成描述真实职责。
置信：**confirmed**（全文 16 行无 `Proxy`）。

**F-w9-6 | P3 | `context.ts:21-27` 与 `context-proxy.ts:8-18` 是两份逐字重复的合并实现**
引文（`context.ts:21-27`）：
```ts
function mergedContext(stack: ContextStack): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const frame of stack) { Object.assign(out, frame); }
  return out;
}
```
`context-proxy.ts:11-18` 是同一逻辑的 `for…of Object.entries` 写法。
描述：`resolvePath` 用前者，`evaluateTest` 用后者。行为等价（含「后帧覆盖前帧」的语义），但两份实现意味着未来改作用域优先级时容易只改一处。
建议：删 `context-proxy.ts`，`expression.ts:7` 改为从 `context.ts` import。
置信：**confirmed**。

**F-w9-7 | P3 | `sql-template/errors.ts:11` 的 `INVALID_COLLECTION` code 全仓无任何 throw 点**
引文：`  | "INVALID_COLLECTION";`
描述：`tags/foreach.ts:9-17` 的 `normalizeCollection` 对 null/undefined/原始值/非普通对象一律**返回 `[]` 静默降级**，从不抛错（函数文档也这么写：「`null`/`undefined`, primitives, and non-plain objects yield an empty list」）。于是这个 code 是纯装饰。
风险不是「抛不抛」，而是**静默**：`collection="typoName"` 与 `collection="正确但为空"` 产生完全相同的 SQL（少一段条件），查询返回全集而非报错——这是动态 SQL 最难查的一类 bug。建议：拼写错误时至少在 dev 模式告警，或把该 code 用起来。
置信：**confirmed**（grep 全仓仅 errors.ts 一处）。

**F-w9-8 | P3 | `tags/foreach.ts:12-14` 对普通对象用 `Object.values` 迭代，与 MyBatis 的 collection 语义不一致**
引文：
```ts
if (typeof value === "object" && value !== null) {
  return Object.values(value as Record<string, unknown>);
}
```
描述：MyBatis 对 Map 类型 collection 迭代 entry，对 POJO 迭代属性值，对数组迭代元素——三者行为不同。实测 `collection="o"` with `{a:1,b:2}` → `sql="??"` `params=[1,2]`（迭代值）。若调用方误把对象当「键列表」用（想迭代 keys），会静默拿到 values。
建议：要么实现 MyBatis 的三态区分，要么在类型签名（`collection: string` 无约束）上明确「只支持数组与对象值」。
置信：**confirmed**（行为实测）／是否符合预期 suspected。

**F-w9-9 | P3 | `tdbc/logic/open.ts:29-50` `parseUrl` 不过滤 query string，也不拒绝 authority 形式**
引文：`const sqliteMatch = /^sqlite:(.+)$/s.exec(rest);`
实测：
- `tdbc:sqlite:file:a.db?mode=ro` → `{filename: "a.db?mode=ro"}`（`?mode=ro` 被当成文件名的一部分）
- `tdbc:sqlite://host/path` → `{filename: "//host/path"}`（authority 形式被当成路径）
描述：`OpenOptions` 已有结构化的 `readOnly?: boolean`（`types.ts:34`），URL 里的 `?mode=ro` 是**第二套真源**且不被识别。不会造成当前故障（生产 URL 全是 `tdbc:sqlite:file:${absPath}` 或 `:memory:`），但这是个静默的口径分裂点。
建议：要么在 `parseUrl` 里显式拒绝含 `?`/`#` 的 filename 并给出明确错误，要么明确文档「URL 不支持 query，readOnly 只能走 options」。
置信：**confirmed**（实测）。

**F-w9-10 | P3 | `tdbc/logic/normalize-bindings.ts` 位于 core 协议层，但只有 1/3 驱动消费它——它不是协议的一部分**
引文（`tdbc/index.ts:4`）：`Zero native dependencies in this module` —— 这句本身没错，但 `normalizeBindings` 的实际归宿暴露了分层错位：
- better-sqlite3：`connection.ts:14` `import { normalizeBindings } from "@novel-master/core"`，三处调用。
- op-sqlite：自建 `normalizeOpSqliteBindings`（`bindings.ts`，额外做 `Uint8Array` → 独立 `ArrayBuffer` 拷贝）。
- rn：自建 `normalizeQuickSqliteBindings`。
描述：`undefined → null` 这条**语义**（`normalize-bindings.ts:2` 文档「null and undefined both map to SQL NULL」）是协议级的（三驱动都实现），但**实现**被放在 core 且只被一个驱动用，另两个各自复制。后果：新写驱动的人不会知道「必须把 undefined 归一成 null」，而 `SqlTemplateParser` 的 `placeholder.ts:22` 恰好会产出 `undefined`（`resolvePath` 对缺失路径返回 `undefined`）——**协议依赖了一个没写在 port 契约里、也没被 core 强制的要求**。
建议：把「绑定归一化」写进 `TdbcDriver`/`TdbcConnection` 的文档契约（`connection.port.ts` 的方法注释里），或把 `normalizeBindings` 下沉为驱动侧共享 util 并从 core barrel 移除。
置信：**confirmed**（三驱动 grep 实测）。**注**：`docs/apm/memory/20260816-replace-quick-sqlite.md:18` 记着 op-sqlite 的 `Uint8Array` 拷贝是「不因验证通过而放松」的刻意防御——那部分是有意决策，本条只针对「undefined→null 这条基础语义没有契约化」。

**F-w9-11 | P3 | `connection.port.ts:37-39` 的 `NESTED_TRANSACTION` 契约在 core 侧无任何强制**
引文：`/** Runs `fn` inside a transaction. Nested calls throw `NESTED_TRANSACTION`. */`
描述：这条约束完全靠驱动自觉（op-sqlite `connection.ts` 用 `savepointDepth` 实现嵌套 savepoint，better-sqlite3 另有实现）。core 侧没有任何包装器/断言校验。若某驱动漏实现，嵌套调用会静默走真实嵌套 `BEGIN` → SQLite 报错或 savepoint 泄漏。
辩护方立场：**这是 port 契约的正常形态**，不因缺断言而升级为缺陷——core 不持有连接实例，无从包装。记录在此仅为让 ledger 知道这是「靠下游自觉」的约束。
置信：**suspected**（未逐个驱动核实嵌套抛错行为）。

**F-w9-12 | P3 | `TemplateParser.astCache` 以完整 SQL 文本为 key，无上界；模板动态拼接时会按「长度变体」倍增**
引文（`parser.ts:46-53`）：
```ts
private readonly astCache = new Map<string, AstNode[]>();
parse(template: string): AstNode[] { ... this.astCache.set(template, ast); ... }
```
描述：注释说「模板字符串通常数量有限（来自配置），缓存增长可控，不需要 LRU」。但**并非所有模板都是常量**：`sqlite-vfs-revision.repository.ts:193-210` 与 `:344-353` 按 chunk 拼 `conditions`（chunk 大小 1..100）、`sqlite-session-kkv.repository.ts:101-110` 按 `buildInBindings` 拼 `inList`（1..400）、`sqlite-vfs-entry.repository.ts:175-190` 同理。这些会各自产生数十到数百条不同 key。
当前**实际有界**（被 chunk 常量 `REVISION_BATCH_CHUNK_SIZE=100` / `GET_MANY_CHUNK_SIZE=400` 限住，实测这些常量确实存在），且 `TemplateParser` 是**每 repository 实例一个**（各 repository `private readonly parser = new SqlTemplateParser()`），实例随连接重建。所以今天不是泄漏。
风险在于**没有任何东西守住这个上界**：将来若有人在模板里插值一个用户可控字符串（哪怕只是排序方向），key 空间立刻变成无界，AST 常驻内存。
辩护方立场：现状可接受，但注释里的理由（「来自配置」）与实际用法（「动态拼接」）已经不符，注释本身在误导后来者。
建议：① 修正注释，如实写明「key 空间由调用方的 chunk 常量隐式限定」；② 或加一个 size 上限 + 超出即驱逐。
置信：**confirmed**（代码结构）／泄漏 suspected（现状有界，未实测长期驻留）。

**F-w9-13 | P2 | `no-dollar-in-repository-sql.test.ts` 的扫描范围漏掉 `service/` 与 `infra/`**
引文（`no-dollar-in-repository-sql.test.ts:30-40`）：
```ts
const repoFiles = walkTsFiles(domainRoot).filter((f) => ...includes("/repositories/"));
const sqliteFiles = walkTsFiles(SRC_ROOT).filter((f) => { const base = ...; return base.startsWith("sqlite-") && base.endsWith(".ts"); });
```
描述：扫描集 = `src/domain/**/repositories/**` ∪ 所有 `sqlite-*.ts`。**未覆盖**的实际 SQL 产出点至少三处：
- `src/service/chat/impl/usage-stats.service.ts`（8 处 `queryTemplate`，`:212-217, :282-287, :386, :396, :459, :620-625`）
- `src/infra/sksp/impl/base-sqlite-secret-store.ts`（4 处，`:41, :63, :78, :100`，文件名不以 `sqlite-` 开头）
- `src/bootstrap/schema-migrations/schema-migrations-table.ts`（`:37, :65`）
其中 `usage-stats.service.ts:386, :396` 用 JS 拼出 `whereSql` 后再喂给模板——正是「字符串拼接 SQL」最容易回潮的形状（D-w9-7 的闸门却看不到它）。
建议：把扫描集扩到「所有 import 了 `sql-template` 的文件」，用 import 关系而非路径约定圈定。
置信：**confirmed**（逐处核对路径与文件名）。

**F-w9-14 | P3 | `sql-template/index.ts:8-23` barrel 转出了 5 个内部实现细节，扩大了公共 API 面**
引文：
```ts
export { parseTemplateToAst, TemplateParser } from "./parser.js";
export { normalizeExpression, bindExpressionToContext, evaluateTest } from "./expression.js";
```
描述：`normalizeExpression` / `bindExpressionToContext` 是 `evaluateTest` 的内部两步（`expression.ts:132` 就是这么串的），`TemplateParser` 是 `SqlTemplateParser` 的内部字段（`index.ts:33`）。转出它们让外部可以绕过 `SqlTemplateParser` 直接拼装，绕过 placeholder 注入规则。
实测：全仓无外部消费者（只有 `src/index.ts:12-16` 转出 + 测试用）。
建议：收窄 barrel，只留 `SqlTemplateParser` + `SqlTemplateError` + `parseTemplateToAst`；`knip.json` 未把本包列为 entry，可加 ignore 规则兜底。
置信：**confirmed**。

**F-w9-15 | P3 | `serialization/decode.ts:10-12` 的 `zodMessage` 是零价值间接层**
引文：
```ts
function zodMessage(error: { message: string }): string {
  return error.message;
}
```
描述：单参数、单返回的直接透传，唯一作用是给参数加了个比上游 `ZodError.message` 更窄的结构类型。
建议：直接 `parsed.error.message`。
置信：**confirmed**（全文 20 行）。

**F-w9-16 | P3 | `parseUrl` 在 `options.filename` 已给定、`url` 仅作占位时仍强制校验 URL**
引文（`open.ts:62-68`）：
```ts
const parsed = parseUrl(url);
const driver = resolveDriver(options?.driver);
return driver.open({ ...options, url, filename: options?.filename ?? parsed.filename });
```
描述：`parseUrl` 无条件先跑，`options.filename` 覆盖发生在**之后**。所以 `open("tdbc:sqlite:whatever", {filename: "/real/path.db"})` 里的 `whatever` 仍须通过 URL 校验。实测 `open("tdbc:mysql:x", {filename:"a.db"})` 会抛 `INVALID_URL`。
实际影响趋近于零（所有生产调用点的 URL 都合法），但 API 读起来像「filename 给了就能跳过 URL」，与实现不符。
建议：要么把 `parseUrl` 挪到 `options?.filename ?? parseUrl(url).filename` 的短路右侧，要么在文档里写明 URL 始终必填。
置信：**confirmed**（读码 + F-w9-9 实测同一函数）。

**F-w9-17 | P3 | `kkv-value-codec.ts:15` 抛裸 `Error`，与本区其余错误的 typed-code 约定不一致**
引文：`throw new Error(\`Expected boolean string, got: ${value}\`);`
描述：`tdbc/errors.ts` 与 `sql-template/errors.ts` 都定义了判别式 code 子类，唯独这里抛原生 `Error`。唯一消费点 `persistent-preferences.service.ts:9` 因此拿不到可判别的错误类型。
建议：改抛领域错误（如 `ConfigDecodeError("INVALID_SCHEMA", ...)`，与 `serialization/decode.ts:8` 同族）。
置信：**confirmed**。

**F-w9-18 | P3 | `sql-template/index.ts:56` 每次 `parse` 都 `new TemplateEvaluator`，与上方精心做的 AST 缓存不同调**
引文：
```ts
parse(template: string, params: Record<string, unknown>): SqlParseResult {
  const ast = this.parser.parse(template);
  const evaluator = new TemplateEvaluator(this.placeholder);
  return evaluator.evaluate(ast, params);
}
```
描述：`TemplateEvaluator` 无实例状态（`placeholder` 是唯一字段，`evaluate` 里 `state` 是局部变量），本可与 `parser` 一样提到构造函数里缓存。实测 80KB / 4000 绑定的模板冷解析 50 次约 1.6s——分配成本不是瓶颈，但**同文件里对 AST 做了缓存、对 evaluator 不做**这件事，读起来像遗漏而非决策（`evaluator.ts` 上方也没有解释为何每次新建）。
建议：把 `evaluator` 提为 `private readonly` 字段，或补一行注释说明「刻意每次新建以保证无状态可重入」。
置信：**confirmed**（结构事实）／性能影响 nil（实测）。

---

## 争议与存疑

1. **`${…}` 保留还是删除** —— 我在 D-w9-8 论证了「保留 + 标注 + CI 禁用」是三段式最优解，但这是**立场而非事实**。反方论点成立：SQLite 不允许绑定表名/列名是硬约束没错，但当前生产代码里 `${` 使用数为 **0**（实测全仓 `src/` 无 `\${`），也就是说这个能力**从未被需要过**。若反方主张「删掉它，写 SQL 的人自然会被迫用可参数化的写法」，我不能证伪。**建议主代理把这个当产品决策交给用户拍板**，技术侧两种做法都有 guards。

2. **F-w9-2 与 F-w9-3 是互相掩盖的双缺陷，单独修任一个都会变坏**。这是我作为辩护方最不愿承认但必须写明的一点：现状「看起来安全」是因为 `trim.ts` 的 `\b` bug 让含 `?` 的 override 永不生效。**只修 `\b` 而不处理裸 `?` 会直接引入参数错位**。这一条必须在 L3 台账里标为「成对修改」，否则 W6 验证代理若只修一条会得出「修好了」的假结论。

3. **`connection.port.ts:37-39` 的 `NESTED_TRANSACTION` 是否真的被三个驱动一致实现** —— 我**没有**逐个核实三个驱动的嵌套事务行为（超出本区边界，op-sqlite 用 `savepointDepth` 是读到的，better-sqlite3 与 rn 未读）。若三者行为不一致，那是一个 P1 级的跨包缺陷，但**证据不足，不在此区定级**，建议移交驱动包机位。

4. **`normalizeBindings` 的分层归属**（F-w9-10）—— 我判 P3「契约缺失」，但若 W3 的「双端重复实现」机位发现另两个驱动的 `undefined→null` 行为与 better-sqlite3 有**语义差异**（而非仅仅多了 `Uint8Array` 拷贝），那应升级。`packages/tdbc-conformance/src/suite.ts` 是否覆盖了「绑定 `undefined`」这一用例，我未读，**建议 reduce 阶段确认**。

5. **`zod-to-json-schema` fallback 的删除决策**（F-w9-4）—— 严格说 `package.json` 里 `zod: ^4.4.3` 是 caret 范围，未来 zod v5 若移除实例方法，fallback 会**静默**接管并产出降级 schema。因此「删掉」比「留着」安全，但「留着 + 加测试」也完全可接受。这是取舍不是缺陷。
