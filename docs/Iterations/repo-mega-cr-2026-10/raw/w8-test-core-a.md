---
zone: w8-test-core-a
agent: 测试语料健康度（W8）
files_scanned: 84（packages/core/test/domain/** + packages/core/test/infra/**，14,582 行；其中 *.test.ts 83 个 / 14,488 行，1 个 helper 非测试文件）
---

## 摘要

`packages/core/test/` 按目录前半切出的两块语料。`domain/` 只有 5 个文件，覆盖 feature-flag 与纯展示格式化（滑窗 token 速率、stream 指标文案、速率快照编解码、token 锚点恒等式）。`infra/` 是主体：llm-protocol（31 文件，三家 provider 的 SSE parser / content mapper / adapter + 流式超时/看门狗/SSE 传输）、tokenizer（22 文件，token 计数四层缓存与 NMTP 驱动）、sql-template（7）、sksp（5）、tdbc（3）、db-maintenance（4）、nmtp、content-cache、serialization。合计 571 个 `it` / 118 个 `describe` / 1806 个 `assert.*`，平均每用例 3.2 个断言。

## 职责与边界

- 验收 core 的 **infra 层单点实现**：SQL 模板引擎、TDBC/SKSP 驱动注册表、secret store 合成、编码注册中心、token 计数与四层缓存、LLM 协议适配。
- 为几个**有跨端/跨进程副作用的模块**提供唯一的行为快照：sliding-token-rate（mobile/desktop 共用的速率口径）、stream-token-anchor（双端共用的「基线+增量」公式）、format-stream-metrics-line（双端文案快照）。
- 覆盖 db-maintenance 的四条收尾链路（message 内容压缩、blob 二进制归一、VACUUM 维护、状态采样节流）。
- 不覆盖：apps 端实现、agent/chat/tool 等目录（另有机位）、`test/helpers/` 与 `test/kkv` 等。

## 对外接口

本区测试的被测面（生产侧符号，均有生产消费者）：

| 符号 | 位置 | 生产消费者 |
|---|---|---|
| `slidingTokenRate` / `createTokenRateSampler` | `src/domain/format/sliding-token-rate.ts` | 双端 stream 指标 |
| `composeStreamTokens` / `reanchorStreamTokenBase` | `src/domain/format/stream-token-anchor.ts` | `apps/mobile/src/services/session-stream-unit.ts:47,652,664,668`、`apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:23,204,301` |
| `parseStreamFinalRateSnapshot` / `serializeStreamFinalRateSnapshot` | `src/domain/format/stream-final-rate.ts:43` | 经 `src/public/format.ts:16` 出面 |
| `isUserVfsUnifiedToolTurnEnabled` | `src/domain/feature-flags/user-vfs-unified-tool-turn.ts` | mobile/desktop runtime |
| `SqlTemplateParser` / `executeTemplate` / `queryTemplate` | `src/infra/sql-template/*`、`src/infra/tdbc/logic/template-helper.ts` | 25 个 repository/service |
| `normalizeBindings` | `src/infra/tdbc/logic/normalize-bindings.ts:10` | `packages/tdbc-driver-better-sqlite3/src/connection.ts:95,112,137` |
| `createStreamWatchdog` | `src/infra/llm-protocol/logic/stream-watchdog.ts:45` | **零生产消费者**（见 F-2） |
| `toAnthropicWireToolName` / `createAnthropicToolNameWire` | `src/infra/llm-protocol/logic/anthropic-tool-names.ts:27` | `impl/anthropic.adapter.ts:31,70` |
| `createDefaultTokenCounterRegistry` | `src/infra/tokenizer/logic/create-default-registry.ts:58` | desktop（注入 `savedModels`）/ cli / mobile（均传 `{}`） |
| `resolveTokenizerFamily` | `src/infra/tokenizer/logic/resolve-tokenizer-family.ts` | `src/public/provider.ts` 出面 |

## 数据访问

- **SQLite 内存库**：`test/helpers/novel-master-fixture.ts` 每文件开一个 `openNovelMasterTestConnection()`，表 `chat_message` / `kkv_entry` / `vfs_content_blob` / `session_file_cache_blob` / `session_file_cache_entry` / `agent_definition` / `chat_project`。六个文件共用（`status-sampling-throttle`、`blob-binary-normalization*`、`message-content-compaction*`、`db-maintenance`、`prompt-token-invalidation`）。
- **临时文件库**：`db-maintenance.test.ts:29-41` 用 `mkdtempSync` + `better-sqlite3` 驱动，**必须**真文件（`:22-27` 注明 `:memory:` 的 VACUUM 是 no-op，freelist 无意义）。
- **session KKV 内存桩**：`test/helpers/prompt-layout-test-helpers.ts` 的 `createMemorySessionKkv`（tokenizer 四文件用）。
- **源码文本扫描**：`sql-template/no-dollar-in-repository-sql.test.ts:11-40` 遍历 `src/` 全树读 `.ts` 文本。
- **进程内单例缓存**：`tokenChunkCache` / `promptWholeCache` / `sessionApiPromptTokenCache` / `DecodedContentPool` / `encoding-registry`，均靠 `clearForTests()` 复位。

## 依赖关系

- **import 生产代码**：`../../../src/**` 相对路径为主（多数文件），少数走 `@/`（`sql-template/*`、`tdbc/*`、`decoded-content-cache`、`subagent-meta-mapper`、`db-maintenance`）或 `@novel-master/core`（经 `tsconfig.test.json` 的 `paths` 映射到 src，非 dist）。
- **跨包反向依赖**：`serialize-tools-for-token-count.test.ts:17` 与 `test/helpers/register-node-tokenizer-driver-for-tests.ts:11-17` 直接 import `packages/tokenizer-driver-node/src/**`。core 的测试拉进兄弟包的**源码**（非 dist），耦合可接受但值得记录。
- **被谁消费（测试夹具）**：`registry-test-helpers.ts` 的 `emptyRegistryDeps` 被 7 个文件引用（含 `test/agent/` 与 `test/compaction-conditions/`）；`novel-master-fixture.ts` 被 6 个 infra 文件引用。
- **进程级全局状态**：`tokenizer` 的 NMTP 驱动注册表是模块级单例，被 `nmtp/registry.test.ts`、`count-prompt-llm-input.test.ts`、`resolve-current-prompt-tokens.test.ts` 反复 `clearTokenizerDrivers()` + 重新注册；`db-maintenance` 的 `runStartupMaintenanceOnce` 去重标记是**模块私有布尔**，三个文件各自用「独立进程」换可观测性。

---

## 发现清单

### 一、无牙断言

**F-w8a-1 | P1 | `packages/core/test/infra/tokenizer/registry.test.ts:11-53`**
> ```
> it("R1: unknown provider id still routes gpt-4o by model name", async () => {
>   const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
>   const counter = await registry.forSavedModel("missing/gpt-4o");
>   assert.ok(counter instanceof HeuristicTokenCounter);
> });
> ```
7 条用例（R1/R2/R2b/R3/gemini/unsaved/heuristic-override）断言完全同形：`counter instanceof HeuristicTokenCounter`。
**为什么恒真**：`createDefaultTokenCounterRegistry` 的实现（`src/infra/tokenizer/logic/create-default-registry.ts:36-54`）里 `forSavedModel` 与 `forVendorModel` **无条件 `return this.heuristic`**，参数名带下划线前缀（`_vendorModelId` / `_options`）即声明「刻意不用」。因此无论传 `missing/gpt-4o`、`openai/claude-3-5-sonnet-20241022`、`zai/glm-4.6` 还是 `{override:"heuristic"}`，返回的都是同一个 `readonly heuristic` 字段。这 7 条断言对「模型名路由」这个它们名字宣称验证的行为**零分辨力**：把 `forVendorModel` 整个删掉、或让它按模型名返回不同 counter，这 7 条仍全绿。
**建议**：要么删掉这 6 条（R2b 与「unsaved model still routes by vendor model id」逐字重复，只换了个名字），要么改成对 `resolveTokenizerFamily` 的表驱动断言（该函数已有 10 条真表驱动用例，见同文件 `:56-75`），要么在 `forVendorModel` 里真的接上路由后重写。
**置信**：confirmed（已读 `create-default-registry.ts:36-54` 全文 + 实跑该文件 7 条全绿）

**F-w8a-2 | P2 | `packages/core/test/domain/format/format-utils.test.ts:10-12`**
> ```
> describe("formatCharCount", () => {
>   it("uses zh-CN grouping", () => {
>     assert.match(formatCharCount(1234), /1/);
> ```
**为什么恒真**：`formatCharCount` 的实现是 `n.toLocaleString("zh-CN")`（`src/domain/format/format-char-count.ts:3`）。断言 `/1/` 只要求结果里**含字符 "1"**。`"1234"`（无分组）、`"1 234"`（空格分组）、`"1_234"`、`"12,34"` 全都匹配。函数退化成 `String(n)`、退化成 `Math.random()` 撞出含 1 的串、甚至永远返回 `"1"`，这条断言都绿。用例名宣称验证「zh-CN grouping」，断言里连逗号都没提。
**建议**：改成 `assert.equal(formatCharCount(1234), "1,234")`（zh-CN 下 Node ICU 的确定输出），或至少 `assert.match(..., /^1,234$/)`。
**置信**：confirmed

**F-w8a-3 | P2 | `packages/core/test/infra/llm-protocol/subagent-meta-mapper.test.ts:30-36`（三家 mapper 各一份，`:42-47`、`:53-58`）**
> ```
> assert.ok(json.includes("tu1"));
> assert.ok(json.includes("hello"));
> assert.ok(!json.includes("subagentSessionId"));
> assert.ok(!json.includes('"summary"'));
> assert.ok(!json.includes('"ok"'));
> assert.ok(!json.includes('"meta"'));
> ```
**为什么近乎恒真**：18 条断言里有 12 条是 `!json.includes(<字段名>)` 形式的否定子串检查。这类断言的成立条件是「输出里恰好没有这个字符串」，而不是「对应字段被正确映射/剥离」。举个具体的反例：把 `chatMessagesToAnthropic` 改成返回 `[{role:"user",content:"hello tu1"}]`（把 tool_result 整块退化成纯文本、丢掉 `tool_use_id` 结构），`!includes("subagentSessionId")` 等 4 条仍全绿，只有 `includes("tu1")` 那条因为文本里手写了 "tu1" 而侥幸绿。此外 `"ok"` / `"meta"` 这两个子串在合法 wire 里也极易误伤或误放行（`"toolUseId"` 不含 "ok"，但 `"look"`、`"bookmark"` 类字段名会含）。
**建议**：改成结构断言——`assert.deepEqual(out[0].content[0], {type:"tool_result", tool_use_id:"tu1", content:"hello"})`，或至少对输出对象做 `assert.ok(!("ok" in block))` 的字段级检查（`openai-content-mapper.test.ts:141-142` 已经是这个写法，可作范式）。
**置信**：confirmed

**F-w8a-4 | P2 | `packages/core/test/infra/status-sampling-throttle.test.ts:209-225`**
> ```
> for (const table of ["vfs_content_blob","session_file_cache_blob","chat_message"]) {
>   const tableCounts = seen.filter((sql) => isCountStar(sql) && sql.includes(table));
>   assert.ok(tableCounts.length <= 2, `... 应 ≤2 次，实际 ${tableCounts.length}`);
> }
> assert.ok(seen.some((sql) => isCountStar(sql) && sql.includes("vfs_content_blob")), "首轮采样应真下发 vfs_content_blob 的 COUNT（防恒真）");
> ```
**部分恒真**：三张表循环里只对 `vfs_content_blob` 补了「≥1 防恒真」对照（`:222-225`），另外两张表（`session_file_cache_blob` / `chat_message`）**只有上界没有下界**。若实现某天只对 vfs 表发 COUNT、另两表的谓词分支整个退化成常量 `false`，这两条 `≤2` 断言会 0 次下发照样绿。本文件作者显然懂「上界必须配下界才防恒真」（`:207-208` 注释原话），只是漏了两张表。
**建议**：把 `:222-225` 的下界断言也放进循环，对三张表逐一对称断言。
**置信**：confirmed

**F-w8a-5 | P3 | `packages/core/test/infra/tokenizer/count-prompt-llm-input.test.ts:19-33`**
> ```
> describe("countPromptLlmInput", () => {
>   after(() => { registerNodeTokenizerDriverForTests(); });
>   it("throws NOT_REGISTERED when no NMTP driver is registered", async () => {
>     clearTokenizerDrivers();
>     await assert.rejects(() => countPromptLlmInput(minimalParams), ...);
> ```
文件名与 describe 名都叫 `countPromptLlmInput`，但**唯一一条用例只测异常路径**，正常路径零覆盖。更别扭的是 `after()` 钩子在所有用例跑完之后才注册 node driver——而 `it` 里第一件事就是 `clearTokenizerDrivers()`，注册与清空互相抵消，`after` 钩子在本文件里没有任何观察者（同进程无后续测试文件，node test runner 每文件一进程）。
**建议**：把该文件改名为 `count-prompt-llm-input-not-registered.test.ts` 并删除无用的 `after` 钩子；正常路径的覆盖已由 `packages/tokenizer-driver-node/test/count-prompt-llm-input.test.ts` 承担（那个文件才是 `countPromptLlmInput` 的正主），文件名对齐后读者不会再误判覆盖缺口。
**置信**：confirmed

**F-w8a-6 | P3 | `packages/core/test/infra/tokenizer/heuristic-token-counter.test.ts:29`**
> ```
> const messages = [msg("user","abcd"), msg("assistant","efgh")];
> assert.equal(counter.countMessages(messages), estimateTokens(messages));
> ```
**为什么恒真**：`estimateTokens` 的实现（`src/domain/compaction-conditions/logic/token-estimate.ts:8-11`）是 `const _heuristic = new HeuristicTokenCounter(); return _heuristic.countMessages(messages);` —— 它就是 `HeuristicTokenCounter.countMessages` 的一行包装。这条断言在断言「同一个类的方法等于自己」。它唯一能抓的是「有人把 `estimateTokens` 改成不委托给 counter」，抓不到任何计数口径的回归。
**建议**：换成对手算期望值断言（`msg("user","abcd")`+`msg("assistant","efgh")` 两条共 8 字符 → `Math.ceil(8/3.35)=3`），或删掉这半句、保留 `countText` 那条（同文件 `:25-27` 已是手算口径）。
**置信**：confirmed

**F-w8a-7 | P3 | `packages/core/test/infra/tokenizer/heuristic-token-counter.test.ts:32-35` + `src/infra/tokenizer/impl/heuristic-token-counter.ts:31-38`**
> ```
> it("H2: empty messages → 0", () => {
>   assert.equal(counter.countMessages([]), 0);
>   assert.equal(counter.countText(""), 0);
> ```
覆盖面缺口（非恒真但近乎）：`countMessages` 的实现对空数组返回 0 是因为循环体不执行、`chars` 保持 0；`countText("")` 返回 0 是因为 `Math.ceil(0/3.35)`。两条都是**实现的自然结果而非被钉住的行为**。`countMessages` 里 `messageBodyText(m)` 对 hidden 消息、tool_use 块、空 blocks 的处理完全没有断言（只测了两个纯 text 块），而 `messageBodyText` 是 compaction 触发条件的输入。
**建议**：给 `countMessages` 补 tool_use / hidden / 空 blocks 三种消息形态的期望值断言。
**置信**：confirmed

### 二、测已删行为的死测试

**F-w8a-8 | P1 | `packages/core/test/infra/llm-protocol/stream-watchdog.test.ts` 全文（139 行 / 6 条用例）**
> ```
> it("T-D2: 自定义阈值覆盖默认值", () => {
>   const watchdog = createStreamWatchdog({ idleTimeoutMs: 500, onTimeout: () => { fired += 1; } });
> ```
**为什么是死测试**：`createStreamWatchdog` 在 `packages/core/src` 内**只有定义处一个引用**（`stream-watchdog.ts:45`，即它自己的 `export function` 行），零生产调用方；`apps/` 全树 grep `createStreamWatchdog` / `stream-watchdog` 亦为 0 命中。模块头（`stream-watchdog.ts:1-9`）自己写明「**已退役，无接入方**……`llm-sse-transport.ts` 已移除本原语的装配与武装」，并说明保留理由是「供未来配置化空闲策略复用」。这 139 行测试**唯一的作用是让一个已退役的定时器原语保持「有测试」的样子**——它是这个模块不被 knip 之类的死代码检测清掉的唯一理由。
需要说明：模块头的退役记录是**显式拍板留痕**，按 RULE 属 intentional；但 intentional 的是「保留模块」，不等于「保留 139 行测试」。这 139 行既不验证任何产品行为，也不在任何发布路径上。
**建议**：二选一——① 连同 `STREAM_IDLE_TIMEOUT_MS` 的导出（`src/public/provider.ts:133`）一起物理删除模块，测试同删；② 保留模块但在测试文件头写明「本文件是死代码留档，不构成回归保护」，并把 139 行压到 30 行以内（合并 6 条为 1-2 条表驱动）。当前形态最容易让人误以为「流式空闲超时」是被测行为。
**置信**：confirmed（`git log` 显示退役记录在 2026-09-26 产品拍板内）

**F-w8a-9 | P2 | `packages/core/test/infra/llm-protocol/stream-watchdog.test.ts` 与 `llm-stream-timeout.test.ts:24,322` / `llm-sse-transport-port.test.ts:31,447` 共享 `STREAM_IDLE_TIMEOUT_MS`**
> ```
> import { STREAM_IDLE_TIMEOUT_MS } from "../../../src/infra/llm-protocol/logic/stream-watchdog.js";
> ...
> mock.timers.tick(STREAM_IDLE_TIMEOUT_MS * 10);
> ```
`STREAM_IDLE_TIMEOUT_MS` 是**已退役常量**（所属模块无接入方）。三个文件把它当「一个足够大的 tick 数」在用：transport/timeout 两个文件的用例其实是在验证「流中长静默**不**触发自动超时」（`llm-stream-timeout.test.ts:298` 用例名「空闲超时已退役——有 chunk 后长静默不自动超时」），这个断言本身是对的，但它的量级参照物来自一个已退役的常量。将来若 `STREAM_IDLE_TIMEOUT_MS` 被删（与 F-w8a-8 同批），这三个文件会一起编译失败，而它们要验证的行为与该常量毫无关系。
**建议**：三个文件改用字面量或本地常量（如 `const IDLE_TICK = 300_000`），解除对退役符号的依赖。
**置信**：confirmed

**F-w8a-10 | P2 | `packages/core/test/infra/tokenizer/token-counter-mode-no-public-path.test.ts:16,32-52`**
> ```
> const BANNED_EXPORTS = ["readTokenCounterModeFromPreferences"] as const;
> ...
> it(`${name} is not exported from read-token-counter-mode-pref module`, () => {
>   assertNotExported(readPref as Record<string, unknown>, name, "read-token-counter-mode-pref");
> });
> ```
`readTokenCounterModeFromPreferences` 在 commit `9a9886ce`（2026-06-07，「remove tokenCounter.mode public preferences read path」）里被**物理删除**（`git show 9a9886ce -- .../read-token-counter-mode-pref.ts` 显示该 export 函数整段被删）。全仓 grep 该符号只剩这两个测试文件里的字符串。所以这 3 条用例断言的是「一个四个月前就不存在的符号不存在」——纯粹的**恒真**。
它们的原始意图（防止该导出被重新加回）是合理的，但断言形态选错了：断言「某模块不导出 X」在 X 从未被该模块导出过时，永远不会红。真正有牙的形态是反向断言——「`read-token-counter-mode-pref` 的导出面**恰好**是这 3 个符号」，这样重新引入第四个符号会红。
**建议**：改成 `assert.deepEqual(Object.keys(readPref).sort(), ["TOKEN_COUNTER_MODE_PREF_KEY","isValidTokenCounterModePref","parseTokenCounterModePref"])`，把 3 条恒真断言换成 1 条白名单断言。同文件 `:53-58` 的 main-entry 白名单断言已经是这个形态，可直接对齐。
**置信**：confirmed

### 三、只给死代码续命的测试

**F-w8a-11 | P2 | `packages/core/test/infra/tokenizer/registry-test-helpers.ts:49,60,78`**
> ```
> export function mockProviderRepository(protocolById: ...): ProviderRepository { ... }
> export function mutableProviderRepository(providerId, initialProtocol): {...} { ... }
> export function mockSavedModelRepository(savedKeys: ReadonlySet<string>): SavedModelRepository { ... }
> ```
全仓 grep（`packages` + `apps` + `scripts` + `examples`，排除 dist）显示这三个导出**只在自己的定义行出现，无任何消费者**。同文件 `emptyRegistryDeps()`（`:100`）则被 7 处引用。
它们对应的生产接口是 `CreateDefaultTokenCounterRegistryDeps.savedModels`（`create-default-registry.ts:21`）。该注入点只有 desktop runtime 真的传（`apps/desktop/src/main/runtime/create-desktop-runtime.ts:122-124`），cli（`runtime.ts:218`）与 mobile（`create-mobile-runtime.ts:100`）都传 `{}`；**测试侧 40+ 处 `createDefaultTokenCounterRegistry(...)` 调用无一传入 `savedModels`**。也就是说 `forSavedModel` 里 `this.savedModels.findById(...)` 这条分支（`create-default-registry.ts:40-45`）在 core 测试中**零覆盖**，而这三个 mock 正是当初为覆盖它写的、后来没被用上的夹具。
**建议**：给 `registry.test.ts` 补一条真正注入 `savedModels: mockSavedModelRepository(new Set(["openai/gpt-4o"]))` 的用例，验证 UUID→vendorModelId 的解析分支；或直接删掉这三个死导出（knip 应已能报）。
**置信**：confirmed

**F-w8a-12 | P3 | `packages/core/test/infra/tokenizer/registry.test.ts:11-53` 与 F-w8a-1 同源**
`R2b: forSavedModel openai/gpt-4o → heuristic`（`:23-27`）与 `unsaved model still routes by vendor model id`（`:43-47`）**逐字重复**——同样的 registry 构造、同样的 `forSavedModel("openai/gpt-4o")`、同样的 `assert.ok(counter instanceof HeuristicTokenCounter)`，只是用例名不同。两条都在验证恒真行为，重复无收益。
**建议**：删其一。
**置信**：confirmed

### 四、fixture 腐烂

**F-w8a-13 | P1 | `packages/core/test/infra/sql-template/no-dollar-in-repository-sql.test.ts:30-40`（守卫覆盖面不足）**
> ```
> const domainRoot = join(SRC_ROOT, "domain");
> const repoFiles = walkTsFiles(domainRoot).filter((f) => f.replace(/\\/g,"/").includes("/repositories/"));
> const sqliteFiles = walkTsFiles(SRC_ROOT).filter((f) => {
>   const base = f.replace(/\\/g,"/").split("/").pop() ?? "";
>   return base.startsWith("sqlite-") && base.endsWith(".ts");
> });
> ```
这条守卫的意图（文件头 `:2-3`）是「repository / sqlite sources 不得用 MyBatis `${…}` 字符串插值」。但**判定口径是文件名模式 + 目录名模式**，不是「谁真的调了 `SqlTemplateParser`」。实测：core src 内 25 个真实 parser 消费方（`new SqlTemplateParser(` / `executeTemplate` / `queryTemplate`）中，**9 个不在守卫范围内**：

- `src/service/chat/impl/usage-stats.service.ts`（`:459` 就有 `WHERE ${USAGE_NOT_NULL_SQL} AND session_id = #{sessionId}`）
- `src/bootstrap/schema-migrations/schema-migrations-table.ts`（`:37` `SELECT id FROM ${TABLE} WHERE id = #{id}`、`:65` `INSERT INTO ${TABLE} ...`）
- `src/infra/sksp/impl/base-sqlite-secret-store.ts`（多处 `#{ref}` + `${}` 拼装）
- `src/domain/provider/logic/find-saved-model-references.ts`
- `src/domain/session-kkv/logic/deferred-file-cache-gc.ts`
- `src/bootstrap/provider/seed-builtin-providers.ts`
- 以及 `src/infra/tdbc/logic/template-helper.ts`、`src/infra/tdbc/index.ts`、`src/index.ts`（re-export 层）

讽刺的是，被守卫**漏掉**的 `schema-migrations-table.ts` 与 `usage-stats.service.ts` 恰恰是生产里真实使用 `${…}` 插值的文件（虽然目前插的是编译期常量 `${TABLE}` / `${USAGE_NOT_NULL_SQL}`，不是用户输入——所以现在没出事）。守卫的净效果是：给一种「repository 里写 `${userInput}`」的具体事故形态装了警报器，但在 service / bootstrap / infra-sksp 这几个同样把 SQL 送进 parser 的位置没装。而 `sqlite-message.repository.ts:227` 的 `WHERE session_id = #{sessionId}${hiddenFilter}` 说明 `${…}` 拼装 SQL 在本仓是常用手法，下一次有人把可变量塞进去完全可能在守卫盲区。
**建议**：守卫的收集口径改为「grep 出所有 import/调用 `SqlTemplateParser` / `executeTemplate` / `queryTemplate` 的文件」，而不是文件名模式。顺带把 `stripJsInterpolations` 剥掉的是 **JS 模板字面量插值**（生产写法，如 `${hiddenFilter}`），因此守卫真正要禁的是 MyBatis 语义的 `${path}`（进入 parser 后由 `renderBind(kind:"dollar")` 处理，见 `src/infra/sql-template/placeholder.ts:22-24`）——这个区分值得在文件头写清，否则后来者会以为「repository 里不许出现 `${`」。
**置信**：confirmed（脚本实测：25 消费方 / 9 漏网，逐个列出文件路径）

**F-w8a-14 | P2 | `packages/core/test/infra/blob-binary-normalization-maintenance.test.ts:99`（顺序约束的断言）**
> ```
> it("第一条：预置 startupMaintenancePending + 无待归一行 → maintCalls===1 且 pending 被清", async () => {
> ```
文件头 `:11-21` 把「本文件第一条用例必须是这条」写成了显式约束：因为 `runStartupMaintenanceOnce` 的进程级去重标记（`startupMaintenanceRan`，模块私有布尔）一旦被同进程的前序用例消费，本用例要验的「强制补跑 → 条件式清标记」正向路径就观测不到了。`message-content-compaction-maintenance.test.ts:1-13` 是同一套说法的姊妹文件。
这不是 bug——node test runner 每文件一进程、文件内 `it` 顺序执行，当前形态成立，且作者已充分留痕。但它把「一条断言的可观测性」绑在「同文件内不得有别的用例先跑」上：`before` 钩子（`:79-88`）只能验「文件起始无残留标记」，验不了「进程级标记未被消费」。任何人往这个文件里加一条排在最前的 `it`（比如补个 setup 用例），这条用例会静默变红，且红得莫名其妙（`maintCalls()` 拿到 0）。
**建议**：生产侧给 `runStartupMaintenanceOnce` 加 `__resetStartupMaintenanceForTests()`（与同仓 `__resetStatusSamplingThrottleForTests` 同形，已有先例），测试在 `before` 里调用，顺序约束即可解除。
**置信**：confirmed

**F-w8a-15 | P2 | `packages/core/test/infra/message-content-compaction-maintenance.test.ts:1-13`（姊妹文件，同一顺序约束）**
> ```
> 独立成文件的原因：`runStartupMaintenanceOnce` 是模块级进程去重，本用例要求进程级标记初始未被消费（本文件是独立测试进程 + 独立内存库），主测试文件 message-content-compaction.test.ts 的用例已各自消费标记，不能在其前重跑维护链路（对齐 A1 线 NF-1 纪律）。
> ```
与 F-w8a-14 同源。这两个文件（`blob-binary-normalization-maintenance` / `message-content-compaction-maintenance`）的存在本身就是「生产缺一个 reset 钩子」的外溢代价：为了验一条「进程级去重」的语义，被迫开两个专门文件、各自一条用例、并在文件头写 20 行顺序约束说明。
**建议**：同 F-w8a-14，一个 `__resetStartupMaintenanceForTests()` 解决两处。
**置信**：confirmed

**F-w8a-16 | P2 | `packages/core/test/infra/status-sampling-throttle.test.ts:1-16`（文件级顺序约束的第三处）**
> ```
> 独立新文件承载（node test runner 每文件一进程），避免与 message-content-compaction.test.ts / blob-binary-normalization.test.ts 的进程级顺序约束互相牵连。
> ```
同一个 `__resetStatusSamplingThrottleForTests` 已经存在（被本文件与 `blob-binary-normalization.test.ts:100` 复用），说明团队已经知道这个模式；缺的是 maintenance 侧对应的那个 reset。
**建议**：与 F-w8a-14/15 合并处理。
**置信**：confirmed

**F-w8a-17 | P3 | `packages/core/test/infra/llm-protocol/sse-chunk-emitter.test.ts:117-146,148-173`（真实 sleep 的时序夹具）**
> ```
> const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
> ...
> await sleep(45);
> emitter.append("data-1");
> assert.equal(chunks.length, 1);
> ```
T-B1 / T-B2 两条用例**故意不用 fake timers**（`:12-18` 注释说明：只 mock `setInterval` 保留真实 `Date`，才能验「interval 冻结下 append 驱动 flush」）。代价是依赖真实挂钟：45ms sleep 对 32ms 窗口，余量只有 13ms。在 CI 高负载 / Windows 定时器粒度（~15.6ms）下，`sleep(45)` 实际可能只推进 31-32ms 的 `Date.now()`，此时首个 append 仍在闸门窗口内 → 走缓冲不投递 → `assert.equal(chunks.length, 1)` 假红。这是 flaky 源，不是恒真源，但会在慢机器上随机挂。
**建议**：把窗口调小（如 `tickMs: 8` + `sleep(25)`）以放大余量，或改成注入式时钟（`createSseChunkEmitter` 若能接受 `now` 参数则最优）。
**置信**：suspected（未在慢机复现，但 Windows 15.6ms 定时器粒度 + 13ms 余量的组合确实危险）

**F-w8a-18 | P3 | `packages/core/test/infra/random-uuid.test.ts:11-17`（概率性夹具）**
> ```
> it("returns unique values across repeated calls", () => {
>   const ids = new Set<string>();
>   for (let i = 0; i < 100; i++) { ids.add(randomUUID()); }
>   assert.equal(ids.size, 100);
> ```
100 次 `randomUUID()` 全部唯一。生产实现优先走 `globalThis.crypto.randomUUID()`（`src/infra/random-uuid.ts:18-20`），生日碰撞概率约 `100²/(2·2¹²²) ≈ 1.2e-35`——可接受。**但注意** `randomUUID()` 有 `Math.random()` 兜底分支（`:29-31`，注释「Last resort for legacy runtimes — IDs are not cryptographically strong」）。在无 `crypto` 的环境（如某些 RN polyfill 场景）下这条测试会走 `Math.random()` 路径，概率上升到 `100²/(2·2⁵³) ≈ 5.5e-13`——仍可接受。**结论：不是发现，记此以备后续若有人调大循环次数。**
**置信**：intentional（不作为问题上报）

**F-w8a-19 | P3 | `packages/core/test/infra/serialization/serialization.test.ts`（唯一用例覆盖面）**
> ```
> it("SER1: parseText yaml/json → decode → encode stable", () => { ... });
> ```
`parseText` / `stringifyText` / `decode` / `encode` 四个导出（`src/infra/serialization/*`）在本区只有这一条 40 行的往返用例。`parseText` 的实际生产消费者是 skills front-matter（`parse-skill-front-matter.ts:11,51`）、smart-sort-rule IO（`smart-sort-rule-io.ts:7`）、agent YAML（desktop `agent-yaml.service.ts:18,24` + mobile 同名文件）。这些消费方的输入形态（多文档 YAML、front-matter 分隔、缺字段容错）在本区无覆盖——不过 desktop/mobile 各自的 `agent-yaml.service.test.ts` 与 `apps/cli/test/agents-bundle.test.ts` 覆盖了部分。本条只是记录覆盖形状，不构成问题。
**置信**：intentional

**F-w8a-20 | P3 | `packages/core/test/infra/sksp/registry.test.ts`（同构模块的覆盖不对称）**
> ```
> describe("SKSP registry", () => {
>   it("resolves single registered driver", ...);
>   it("throws NOT_REGISTERED when empty", ...);
> });
> ```
对照姊妹文件 `infra/nmtp/registry.test.ts`（7 条：empty 抛错 / 单驱动解析 / **多驱动抛 MULTIPLE_DRIVERS** / **显式名解析** / **显式名缺失抛错** / **getXxx 未知名返 undefined** / **clearXxx 清空**）。SKSP 版只覆盖了 2 条。`resolveSkspDriver` 的多驱动分支（`src/infra/sksp/logic/registry.ts:48-52`，错误文案「Multiple SKSP drivers registered; specify driver name」）与显式名分支（`:37-43`）在 core 测试中零覆盖。而 SKSP 是三端（desktop/mobile/cli 各一处 `createCompositeSecretStore`，见 `apps/*/runtime`）的密钥存储入口。
**建议**：把 `nmtp/registry.test.ts` 的 7 条形态镜像过来（`SkspError` 的 code 与 `resolveSkspDriver` 的三分支一一对应）。
**置信**：confirmed

### 五、跨切面观察（非发现，供 synth 参考）

- **`sql-template` 分包（7 文件）的断言质量是本区最高的一档**：`evaluator-if-where` / `evaluator-foreach` / `evaluator-trim-choose` / `errors` / `parser` 全部用「同一模板 + 对照参数」双向断言（true 分支断 includes、false 分支断 not-includes，且 `parameters` 同步深比对），4 条 `assert.throws` 全部在 predicate 里同时断 `instanceof` + `code` + `offset`。唯一瑕疵是 `evaluator-foreach.test.ts:25` 的 `assert.ok(!r.sql.includes("("))` 用了「整条 SQL 无左括号」这种过宽判据（若解析器误把 `IN (` 保留就会红，但对其它无关括号误报为红）——影响很小。
- **`sliding-token-rate.test.ts`（366 行 / 17 用例）是本区断言设计的范本**：每条都带「为什么恒真」的自查注释（`:21` `assert.notEqual(rate, null)` 后立刻 `rate!`、`:129` 明确写「重 seed 后窗口只有 1 个样本 → null」），数值期望全部手算并写进注释。唯一可挑的是 `assert.ok(heuristicRate != null && heuristicRate < 20)`（`:125`）这类方向性上界——上界没有下界时分辨力有限，但同文件绝大多数断言都配了精确值，可接受。
- **`blob-binary-normalization.test.ts`（1664 行）** 是全区最大文件，`assert` 密度 201/27 条，探针式夹具（`withSqlProbe` 覆写 `conn.query/execute` 并在 finally 里 `delete` own-property 还原）在 `status-sampling-throttle.test.ts:91-97` 与 `message-content-compaction-maintenance.test.ts:87-93` 重复实现了三遍（后两者甚至连注释都近似）。这是一处**该抽成 `test/helpers/` 的重复**。
- **「独立成文件以换进程级可观测性」这一模式在本区出现 3 次**（F-w8a-14/15/16），每次都在文件头写 10-20 行解释。根因统一：`runStartupMaintenanceOnce` 与 `__resetStatusSamplingThrottleForTests` 覆盖的两个模块里，前者缺 reset 钩子。

## 争议与存疑

1. **F-w8a-8（stream-watchdog 死测试）是否该报**：`stream-watchdog.ts:1-9` 的模块头是**明确的产品拍板留档**（2026-09-26，「保留供未来配置化复用」，且 `STREAM_IDLE_TIMEOUT_MS` 仍从 `src/public/provider.ts:133` 出面以冻结 allowlist 面）。按 RULE「文档写明是故意设计的，标 intentional 不当问题报」，我倾向把「保留模块」判为 intentional。但我仍把「保留 139 行测试」报为 P1，理由是这两件事的可维护性代价不同：模块留着是 60 行纯注释 + 一个常量，成本近零；测试留着是 139 行、6 条用例、且**会让人误以为「流式空闲超时」是受测行为**——`llm-stream-timeout.test.ts:298` 那条「空闲超时已退役」的用例名就是这种误读的证据。若 reduce 代理认为该按 intentional 全免，请把本条降为 P3 并只保留「测试规模与模块退役状态不匹配」的表述。

2. **F-w8a-13（守卫覆盖面）的严重度**：我给了 P1，因为守卫的**意图**（防 SQL 注入形态）与**覆盖面**（文件名模式）之间存在结构性缺口，且漏网的 9 个文件里已有 2 个在用 `${…}` 拼 SQL。但反方观点是：现有 `${…}` 插值全是编译期常量（`${TABLE}`、`${USAGE_NOT_NULL_SQL}`、`${hiddenFilter}`），实际风险为零，守卫的价值是「拦住未来的错误写法」而非「覆盖全部 SQL 面」。若按后者定性，P2 更合适。我保留 P1，理由是守卫的**文件头承诺**（`:2-3`「repository / sqlite sources must not use」）与实际扫描范围（`/repositories/` 目录 + `sqlite-` 前缀文件名）之间的落差，会让后来者以为 service/bootstrap 层已被覆盖。

3. **F-w8a-3（subagent-meta-mapper 的否定子串断言）**：我给 P2，但这 18 条断言**并非全无价值**——`includes("tu1")` / `includes("hello")` 两条正向断言确实钉住了「tool_result 没被整块丢掉」，且这是该文件存在的主要意图（文件头 T-M1/P1-8）。我的反对只针对 12 条否定断言的**形式**：它们无法区分「字段被剥离」与「结构被降级」。若 reduce 认为「正向断言已足够，否定断言是冗余但无害」，可降为 P3。我保留 P2，因为 openai-content-mapper.test.ts:141-142 已有更好的范式（`assert.equal((out[0] as Record<string, unknown>).ok, undefined)` 字段级），同仓不一致本身就是收敛理由。

4. **`F-w8a-5` / `F-w8a-19` 是否算发现**：`count-prompt-llm-input.test.ts` 只有异常路径、`serialization.test.ts` 只有一条往返——这两条我标 P3/intentional，因为正常路径的覆盖在**别的包**（`packages/tokenizer-driver-node/test/`）或**别的目录**（apps 端 YAML 测试）里。跨区看不是覆盖缺口，只是本区读者容易误判。若 reduce 有全仓覆盖矩阵，可据此复核。

5. **未深读的部分**：`blob-binary-normalization.test.ts`（1664 行）、`message-content-compaction.test.ts`（796 行）、`resolve-current-prompt-tokens.test.ts`（946 行）、`token-chunk-cache.test.ts`（666 行）、`llm-stream-timeout.test.ts`（570 行）、`llm-sse-transport*.test.ts`（943 行）六个大文件我只读了头部与断言密集区，未逐用例通读。它们的断言密度分别为 201/27、104/12、107/29、91/26、46/13、83/22，均显著高于全区均值 3.2，且抽样读到的部分（如 `sliding-token-rate`、`status-sampling-throttle` 的「防恒真」注释）质量高，我**没有在这六个文件里发现无牙断言**。若需要更高置信，建议派第二轮专门深读这六个文件。
