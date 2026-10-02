---
zone: w9-tool-pro
agent: 检察官（对抗机位 / 猎杀冗余·死路径·不一致）
files_scanned: 28
scan_root: packages/core/src/domain/tool/
method: 全文通读 28 个生产文件 + `git grep` 反查每一处导出/字段的全仓消费方 + node --experimental-strip-types 实跑 tool-output-limits / tool-path-policy 真函数取实测证据
independence: 未读 raw/ 与 synth/ 任何文件
---

## 摘要

`domain/tool/` 是 agent 的工具层：11 个内置工具（read/write/edit/fs/glob/grep + task/skill/agent/curl/search）的定义、zod schema 与执行体，`ToolRegistry`/`ToolRunner`（校验、错误归一、并行 + pathTail 同路径串行化、A-14 路径白名单二道闸），`fs` 子命令解析与执行，输出预算五函数（50KB UTF-8 / 2000 行 / 2000 字符 / 100 条），以及给 LLM 看的 `formatToolOutputForLlm` 与落库用的 `buildToolResultBlock`。search 子目录另含五引擎适配器 + KKV/SKSP 配置存储。

## 职责与边界

- **定义面**：`model/tool.ts` 的 `Tool` 接口（description 是 `(ctx)=>string`，装配期求值）。
- **执行面**：`logic/tool-runner.ts` 三段式（inputSchema → path policy → run → outputSchema），`runParallel` 用 `pathTail` Map 做同路径串行化。
- **能力面**：`builtin/*` 六个 VFS 工具 + 五个静态内置工具；`search/` 走 `ctx.search` 闭包解析引擎链，串行降级。
- **呈现面**：`format-tool-output.ts`（形状守卫 → 人类可读文本）、`build-tool-result-block.ts`（summary + meta 透传 + ok 判定）。
- **不管**：`vfs.*` 语义（走 `domain/vfs`）、模型调用（走 `service/agent`）、agent run 编排（`service/agent/logic/run-agent-turn.ts` 只在装配点注入 ctx）。

## 对外接口

`packages/core/src/index.ts:178-257` 暴露：`Tool` / `ToolRegistry` / `ToolRunner` / `ToolCall` / `ParallelToolOutcome` / `buildToolResultBlock` / `resolveToolResultOk` / `createVfsTools` / `FILE_TOOL_NAMES` / `FILE_OPEN_TOOL_NAMES` / `MUTATING_FILE_TOOL_NAMES`(+deprecated 别名) / `isMutatingFileToolName`(+别名) / `registerBuiltinTools`(+`registerVfsTools`) / `isMutatingFsCommand` / `toolUseMutatesWorkspace` / `anyToolUseMutatesWorkspace` / 四个 `TOOL_OUTPUT_MAX_*` / `BuiltinToolContext` / `ToolResourceQuota` / `ENGINE_IDS` / `KEY_ENGINE_IDS` / `searchApiKeyRef` / `createSearchConfigStore` / `readSearchConfig` / `resolveEngineChain`；`public/chat.ts:324` 另暴露 `resolveVfsToolFilePath`。

## 数据访问

| 目标 | 位置 | 证据 |
|---|---|---|
| session KKV `file_cache` 域 `full:{path}` | write 成功后 upsert；overflow-sink 落盘后同款 | `builtin/vfs-tools.ts:549-565`（`upsertFileCacheAfterWrite`）、`builtin/overflow-sink.ts:94` |
| workplace 目录规则（`setDirRule`/`listDirRules`） | write 新建文件补父链、fs mkdir 补自身、overflow-sink 补 `/tmp` | `vfs-tools.ts:266-270`、`:390`、`overflow-sink.ts:101` |
| 会话工作区 VFS `/tmp/{tool}-{yyyyMMdd}-{rand4}.{ext}` | curl / search 超 50KB 落盘 | `overflow-sink.ts:72-90` |
| KKV 模块 `nm-search`（key `engineOrder` / `searxngBaseUrl`） | 搜索配置读写 | `search/search-config.ts:29-35`、`:277`、`:297-301` |
| SKSP ref `search/{engineId}/apiKey` | 三家付费引擎明文 key | `search/search-config.ts:41-43`、`:260` |
| agent registry（list/get/getRawWire/upsert/listAgentIds） | agent 工具四个 action | `builtin/agent-tool.ts:166`、`:362`、`:380`、`:455` |
| 会话消息（列全部含 hidden） | ctx 字段 `listSessionMessages` | 声明 `builtin-tool-context.ts:174`，注入 `run-agent-turn.ts:851`/`:1200`、`create-user-vfs-turn-service.ts:67` |

## 依赖关系

- **import（入）**：`@/domain/vfs`（resolveLogicalPath / copyVfsPath / moveVfsPath / VfsService）、`@/domain/skills/logic/skill-paths`（SKILLS_ROOT + resolveSkillRelPathCore）、`@/domain/session-kkv/model/session-kkv-domains`、`@/domain/workplace/logic/rule-snapshot-codec`、`@/service/vfs/logic/ensure-import-dir-rules`、`@/service/*` 的 port 类型、`@/infra/tdbc`（format-tool-output 里的 TdbcError）、zod。
- **被消费**：`service/agent/logic/run-agent-turn.ts`（装配 ctx + 建 runner）、`service/chat/create-user-vfs-turn-service.ts`、`domain/agent/logic/{resolve-agent-tool-registry,validate-agent-tool-policy}`（吃 `normalizeAgentToolPolicyName` / `FILE_OPEN_TOOL_NAMES`）、`domain/chat/logic/skill-tool-ref`、双端 UI（`resolveVfsToolFilePath`）。

---

## 发现清单

### F-w9-tool-pro-1 | P2 | `packages/core/src/domain/tool/builtin/curl-tool.ts:192-219`（对照 `logic/tool-output-limits.ts:89-132`）
> ```ts
> for (let i = 0; i < text.length; i += CHUNK) {        // 固定步进，无代理对边界右移
>   const chunk = text.slice(i, Math.min(i + CHUNK, text.length));
> ```
> core 版：`| 块尾是代理对前半（high surrogate）且后面还有字符：边界右移 1 |`（`tool-output-limits.ts:101-108`）

curl 自带了一份 `truncateToByteBudget`，与 core 的 `sliceUtf8BytePrefix` 逻辑同源但**缺了 core 已修的代理对边界处理**。实测（`"a"×8191 + "😀" + "b"×10`，预算 8196 字节）：curl 版的返回以孤立高代理 `0xd83d` 结尾且**丢掉了整个 emoji**；core 版正确保留 `😀`。两者输出不等价，且 curl 版会往 LLM 可见的 `body` 里塞一条非法字符串。

**建议**：curl 改用 `sliceUtf8BytePrefix`（导出后复用），删掉本地两份 utf8 工具。置信 **confirmed**（实测脚本输出 `curl out tail codes: [ 'd83d' ] / core out tail codes: [ '62' ]`）。

### F-w9-tool-pro-2 | P2 | `logic/tool-output-limits.ts:27`
> ```ts
> line: text.slice(0, maxLen) + TOOL_OUTPUT_LINE_TRUNCATED_SUFFIX,
> ```

`truncateLine` 按 UTF-16 码元数切，会把代理对劈开。实测 `"x"×1999 + "😀" + ...` 截断后 `has-lone-high: true`——输出含孤立高代理，序列化进 JSON/日志时变 U+FFFD。同文件的 `sliceUtf8BytePrefix` 为此专门写了 20 行注释与修复，口径自相矛盾。消费点三处：`vfs-tools.ts:524`（grep excerpt）、`skill-tool.ts:382`（load）、`skill-tool.ts:431`（read）——都是 LLM 直接可见的正文。

**建议**：`truncateLine` 内部改走 `sliceUtf8BytePrefix`（按字节）或至少按码元对回退 1 位。置信 **confirmed**（实测）。

### F-w9-tool-pro-3 | P2 | `builtin/curl-tool.ts:173-183`、`builtin/search/search-tool.ts:266`、`builtin/overflow-sink.ts:102`、`logic/build-tool-result-block.ts:208`
> `curl-tool.ts:173` `function utf8ByteLength(text: string): number {`（本地私有副本）
> `overflow-sink.ts:102` `const contentBytes = new TextEncoder().encode(input.content).byteLength;`（内联）

UTF-8 字节计数在本区有 **5 份实现**：`tool-output-limits.ts:14-16`（私有）、`curl-tool.ts:173-183`（私有分块版）、以及三处裸内联。根因是 `tool-output-limits.ts` 的 `utf8ByteLength` 没导出，外部只能复制或内联。附带成本：`overflow-sink.ts:102` 对可能达 10MB 的 content（`CURL_MAX_RESPONSE_BYTES = 10MB`）**再做一次全量 TextEncoder 编码只为拿 `.byteLength`**，而调用方 curl（`curl-tool.ts:487`）与 search（`search-tool.ts:266`）刚算过一次。

**建议**：导出 `utf8ByteLength`，`sinkOversizedOutput` 增加 `contentBytes` 入参复用调用方已算值。置信 **confirmed**。

### F-w9-tool-pro-4 | P2 | `logic/tool-path-policy.ts:43-58` + `logic/tool-runner.ts:100-103` + 装配点 `service/agent/logic/run-agent-turn.ts:926-927`/`:1276-1277`、`service/chat/create-user-vfs-turn-service.ts:78-79`
> ```ts
> return (
>   path.startsWith(normalizedPrefix + "/") ||   // 纯字符串前缀，未消解 ".."
>   path.startsWith(normalizedPrefix + "\\")
> );
> ```

A-14 这道「第二道闸」三重不成立：

1. **从不生效**：三个生产装配点全部硬编码 `allowedPaths: undefined`（`git grep -c "allowedPaths: undefined"` = run-agent-turn.ts 2 处 + create-user-vfs-turn-service.ts 1 处），全仓无任何生产代码传入过数组（只有 core 测试构造）。`readAllowedPaths` 恒返回 `undefined` → `findDisallowedPath` 立即 `return null`。
2. **开了口子**（真启用后）：实测 `pathStartsWithPrefix("src/../secret.md", "src") === true` —— `..` 段不消解，逃出白名单仍放行。同一函数又实测 `"/src/a.md"` 与 `"./src/a.md"` 对 `["src"]` 均返回 `false`（误杀），而 core 自己的 `resolveLogicalPath` 恰恰会把这两种写法归一成 `/src/a.md`——即 policy 与被保护方的路径口径不一致。
3. **误杀非工作区工具**：`extractInputPaths`（`tool-path-policy.ts:17-33`）无差别地从任意 tool input 抓 `path` 字段。`skill` 工具的 `path` 是**技能目录相对路径**（缺省 `"SKILL.md"`，见 `skill-tool.ts:468`/`:485`），真实落点是 `/meta/skills/...`。一旦 `allowedPaths: ["src"]` 生效，每一次 skill write/edit 都会被 `toolPathForbidden` 拒掉。

**建议**：要么给 `pathStartsWithPrefix` 先过 `resolveLogicalPath` 再比、并按工具名白名单化字段（只对 write/edit/fs 生效），要么按 spec 原意把这条明确标为「预留、当前无调用方」并从闸门位置撤下（留纯函数 + 测试）。置信 **confirmed**（三条均有实测或 grep 计数）。

### F-w9-tool-pro-5 | P2（有意分期，标 intentional） | `builtin/builtin-tool-context.ts:163-166`、`:196-197`、`index.ts:220`
> `/** 资源配额占位（A-14）。 @remarks 目前只定义语义、不做强制 */`

`ToolResourceQuota` 类型经 `index.ts:220` 进了公共入口，但全仓**零读取点**（`git grep resourceQuota` 只命中类型定义与三处 `resourceQuota: undefined` 赋值）。来源是 `docs/Iterations/cr-fix-spec/spec.md:172` Step 28 明确要求的「加资源配额占位」，属拍板分期。

**建议**：不报缺陷，记为「有据可查的占位」；下一轮要么接线要么连同 allowedPaths 一起降级为 internal。置信 **intentional**（出处 `spec.md:172`）。

### F-w9-tool-pro-6 | P2（有意分期，标 intentional） | `builtin/search/search-tool.ts:208` vs `builtin/search/types.ts:84-88`
> ```ts
> const options = { maxResults: normalizeMaxResults(input.maxResults) };
> ```
> `types.ts:83` `/** 引擎适配器入参选项（工具 schema 本期只开放 query/maxResults/engine）。 */`

`SearchToolOptions.domainFilter` / `recencyFilter` **生产不可达**。`search-tool.ts:145-161` 的 inputSchema 只有 `query/maxResults/engine`，`run` 只构造 `{ maxResults }`。`git grep domainFilter|recencyFilter` 全仓命中只落在五个引擎适配器、`types.ts` 与**测试**（`test/tool/duckduckgo.test.ts`、`test/tool/search-engines.test.ts`）。据此成为纯死代码的有：

- `types.ts:119-195`（`DomainFilters` / `parseDomainFilters` / `matchesDomainFilters` / `hostMatchesDomain`）≈ 77 行
- `bocha.ts:36-51` `mapFreshness`、`:132`、`:185`
- `brave.ts:38-52` `buildBraveQuery`、`:55-68` `mapFreshness`、`:96-97`、`:151`、`BRAVE_DOMAIN_FILTER_COUNT` 的 `hasDomainFilter` 分支
- `searxng.ts:33-46` `buildSearxngQuery`、`:73`、`:78-80`、`:122`
- `tavily.ts:33-48` `mapDomainFilter`、`:110-113`
- `duckduckgo.ts:169`、`:173`、`:217`

约 200 行生产不可达逻辑 + 约 10 条只测死路径的测试。`types.ts:83` 的「本期只开放」表明是**有意分期**，故不按缺陷记；但它同时是 F-w9-tool-pro-8 的隐性成因（下面）。

**建议**：要么把 `domainFilter`/`recency` 提到 search schema 上（一条 `.describe()` 的事，spec Step 4 当时的取舍可复核），要么显式标注退役日期，否则五个适配器会一直背着无人调用的分支。置信 **intentional**（分期）＋ 死代码事实 **confirmed**。

### F-w9-tool-pro-7 | P2 | `packages/core/src/index.ts:240-241`
> `SearchRecency,` / `SearchToolOptions,`

这两个类型经公共入口导出，但 `git grep "SearchToolOptions|SearchRecency" -- apps/` 零命中，双端运行时没有任何一处构造它们——它们的存在意义完全建立在 F-6 那条不可达路径上。

**建议**：与 F-6 一起处置。置信 **confirmed**。

### F-w9-tool-pro-8 | P2 | `builtin/search/search-tool.ts:55` + `:220-227` vs `engines/bocha.ts:33` / `engines/tavily.ts:30`
> ```ts
> export const SEARCH_CHAIN_BUDGET_MS = 120_000;   // search-tool.ts:55
> if (Date.now() - startedAt >= SEARCH_CHAIN_BUDGET_MS) { /* 抛聚合错 */ }
> ```
> `bocha.ts:33` `export const BOCHA_TIMEOUT_MS = 60_000;` / `tavily.ts:30` `export const TAVILY_TIMEOUT_MS = 60_000;`

预算与单引擎超时**互相吞掉**：engineOrder 默认序是 `bocha, tavily, brave, searxng, duckduckgo`（`types.ts:22-28`）。两个 60s 引擎各跑满（超时是常态而非异常）恰好耗尽 120s 预算，第 3 次尝试前的检查直接抛错——队尾的 `duckduckgo` 免费兜底**永远轮不到**。而兜底的设计意图恰恰是「付费引擎不可用时仍能搜」（`search-config.ts:167-168`、`search-tool.ts:5-6`）。5 引擎链在两个 30s 引擎下最多试 4 个，在两个 60s 引擎下最多试 2 个。

**建议**：把 `SEARCH_CHAIN_BUDGET_MS` 提到 ≥ 各引擎超时之和 + 余量（如 180s），或改为「按剩余预算动态收缩单引擎 timeout」。置信 **confirmed**（算术与顺序均可静态推出）。

### F-w9-tool-pro-9 | P2 | `builtin/search/search-tool.ts:107-120`
> ```ts
> function engineErrorSummary(e, entry) { ... return redactSecret(message, entry.apiKey).slice(0, 300); }
> function engineErrorBrief(e) { const message = ...; return message.slice(0, 40) || "未知错误"; }   // 无 redactSecret
> ```

脱敏口径不对称：聚合错误走 `redactSecret`，而 `engineErrorBrief` 的产物会拼进 `attempts` 字段（`:241`）并**进入成功输出的 LLM 上下文**（`formatSearchOutput` L230-232 直出）。当前未发现实际泄漏路径——bocha 业务码分支（`bocha.ts:80`）与 `engineApiErrorMessage`（`types.ts:210-220`）在源头就 redact，searxng/duckduckgo 无 key，网络异常 message 不含 header。但这是**唯一的例外口**，任何未来新增引擎或改动 `engineTimeoutError` 透传原始错误都会直接漏 key 到提示词。

**建议**：`engineErrorBrief` 收 `entry` 参数并同样 `redactSecret`，让脱敏成为默认而非逐点自觉。置信 **suspected**（无已证实泄漏，是纵深不一致）。

### F-w9-tool-pro-10 | P2 | `builtin/builtin-tool-context.ts:173-174`
> ```ts
> /** 列出会话消息（含 hidden，供 chat_grep）。 */
> readonly listSessionMessages: () => Promise<readonly ChatMessage[]>;
> ```

**必填**字段、唯一文档化消费者 `chat_grep` 已被删除（`git grep chat_grep -- packages/core/src apps/*/src` 只剩三条注释残留），却仍无任何工具读取它：`git grep listSessionMessages` 的 47 处命中全是「声明 + 装配点 + 测试桩」，零 `ctx.listSessionMessages` 读取。代价是 3 个生产装配点（`run-agent-turn.ts:851`/`:1200`、`create-user-vfs-turn-service.ts:67`）和约 40 个测试 ctx 都在为一个没人调用的闭包做无用功，且每次 run 都真的排了一次 SQL。

**建议**：删字段（连带 `ChatMessage` import），或恢复 chat_grep。置信 **confirmed**。

### F-w9-tool-pro-11 | P3 | `logic/subagent-tool-session-id.ts:21-38`（整模块）
> `export function isTaskToolUse(toolName: string): boolean { return toolName === "task"; }`

整个模块**生产零消费**：`git grep subagent-tool-session-id -- packages/ apps/` 只命中自身与 `test/tool/subagent-meta-passthrough.test.ts:8`。`isTaskToolUse` 更极端——全仓（含测试）仅此一处定义。`:38` 那行 `export type { ToolResultBlock, ToolUseBlock };` 自述「供 caller 类型推导顺手」，而 caller 不存在。对照 `vfs-tool-file-path.ts` 是真被双端 UI 消费的（`apps/desktop/.../message-blocks.ts:212`、`apps/mobile/.../message-blocks.ts:299`），两个「对称」模块实际只有一个活着。

**建议**：删模块（连带那条测试）；UI 侧「跳转子会话」若靠别处实现则本模块确属残留。置信 **confirmed**。

### F-w9-tool-pro-12 | P3 | `builtin/vfs-tools.ts:169-175`
> ```ts
> const lines = raw.content.split("\n");
> const totalLines = lines.length;
> if (offset > 1 && totalLines === 0) { throw new ToolError("INVALID_ARGUMENT", `offset ${offset} exceeds file length (0 lines)`, ...); }
> ```

不可达分支：`"".split("\n")` 返回 `[""]`（实测 `len = 1`），`totalLines` 永不为 0，空文件走的是下一行的 `offset > totalLines` 判定。错误文案「exceeds file length (0 lines)」也因此永远不会被模型看到。

**建议**：删 `:169-175`。置信 **confirmed**（实测）。

### F-w9-tool-pro-13 | P3 | `builtin/vfs-tools.ts:69-73` vs `logic/vfs-tool-file-path.ts:10`
> ```ts
> // vfs-tools.ts
> export const FILE_OPEN_TOOL_NAMES = new Set<FileToolName>(["read", "write", "edit"]);
> // vfs-tool-file-path.ts
> const FILE_OPEN_TOOL_NAMES = new Set(["read", "write", "edit"]);
> ```

同名同值的**双份真源**。一份经 `index.ts:195` 进公共入口（供 agent 策略校验用），另一份是私有副本（供 UI 卡片「打开文件」门控用）。两份一旦漂移，agent policy 允许打开的工具和 UI 真能打开的工具就会不一致。第三份在 `apps/mobile/src/web/chat-transcript/webview/runtime/util/vfs-tool-path.ts:44`（webview 沙盒无法 import core，属有据隔离，不算问题）。

**建议**：`vfs-tool-file-path.ts` 改为 import `FILE_OPEN_TOOL_NAMES`。置信 **confirmed**。

### F-w9-tool-pro-14 | P3（已知未清） | `vfs-tools.ts:58`/`:66`、`register-builtin-tools.ts:47`、`builtin-tool-context.ts:252`
> `export const MUTATING_VFS_TOOL_NAMES = MUTATING_FILE_TOOL_NAMES;`（`@deprecated`）

V1→V2 迁移残留四件套，真实消费为零（`git grep` 只命中自身、`index.ts:198-203`/`:219` 的 re-export，以及 `test/package-exports/snapshots/main-entry-allowlist.json` 的快照 pin）。**注意**：`docs/Iterations/cr-fix-spec/spec.md:161` 明写「破坏性变更，旧名不保留别名」，而 `docs/Iterations/cr-fix-spec/review/phase1-lens/D1-09-dead-code.md:90-91` 与 `phase2-slice/D2-agent-tool.md:99` 早在两轮前就逐条记录过这四个 alias，至今仍在。属于「多轮 CR 已报、始终未清」类，优先级取决于这轮是否接受再次开单。

**建议**：连同快照 allowlist 一起清。置信 **confirmed**（前轮结论可复核，不重复论证）。

### F-w9-tool-pro-15 | P3 | `builtin/skill-tool.ts:435-438`
> ```ts
> const truncated = byteCapped.truncated
>   || returnedLines < slice.length
>   || (lineNextOffset != null && returnedLines >= limit);
> ```

第二个条件是第一个的**真子集**：`capUtf8Bytes`（`tool-output-limits.ts:67-77`）只在整行装不下时 `break`，所以 `byteCapped.truncated === true` 必然蕴含 `returnedLines < slice.length`。该子句不引入任何新语义。对照 read 工具（`vfs-tools.ts:196`）写的是 `byteCapped.truncated || lineNextOffset != null`，两处口径不同但等价。

**建议**：删中间那个条件，或按 read 工具的写法统一。置信 **confirmed**。

### F-w9-tool-pro-16 | P3 | `logic/tool-output-limits.ts:2`、`logic/format-tool-output.ts:69`、`builtin/builtin-tool-context.ts:173`
> `* Shared output limits for read / grep / glob / chat_grep / fs ls tools.`

`chat_grep` 工具已删，三处注释仍把它当现存工具写。其中 `tool-output-limits.ts:2` 是模块头注释（最容易被后来者当索引读），`format-tool-output.ts:89-91` 那段「用 messageId/seq/hidden 排除 chat_grep」的守卫代码也已无对象可排除。

**建议**：随 F-10/F-11 一并清理注释与失效守卫。置信 **confirmed**。

### F-w9-tool-pro-17 | P3 | `builtin/overflow-sink.ts:31`、`:55`
> `export const OVERFLOW_SINK_DIR = "/tmp";` / `export function extensionForContentType(contentType: string)`

两个导出均只在本文件内被引用（`:76`、`:101`），`git grep` 无外部消费方，也未进任何 public barrel。

**建议**：降为模块私有。置信 **confirmed**。

### F-w9-tool-pro-18 | P3 | `logic/format-tool-output.ts:392-404`
> ```ts
> if (keys.length === 1 && typeof rec.version === "number") { return "ok"; }
> if (keys.length === 2 && typeof rec.version === "number" && typeof rec.replacements === "number") { return "ok"; }
> if (keys.length === 1 && rec.ok === true) { return "ok"; }
> ```

在 `:332-349` 已有显式 `isMutationAckOutput`（按 action 分发）之后，又叠了三层「按键形状猜成功」的兜底。任何未来工具只要输出恰好是 `{version: number}` 这一个键，就会被静默压成 `"ok"`，丢掉全部诊断信息。这是纯启发式，注释里也没写它兜的是哪一类历史数据。

**建议**：查清这三个形状的历史来源（推测是 vfs write/edit 早期输出），能定位就换成显式守卫，定位不到就在注释里标明「历史数据兼容，新工具不要命中」。置信 **suspected**（未找到明确的历史依据）。

### F-w9-tool-pro-19 | P3 | `logic/fs-command.ts:130-152`
> ```ts
> const lines = entries.map(formatListEntry);          // `${path}\t${kind}`
> const formattedEntries = capped.lines.map((line) => { const tab = line.indexOf("\t"); ... });
> ```

`formatLsOutput` 走了一次「对象 → `path\tkind` 字符串 → 字节裁剪 → 再解析回对象」的往返，只为复用 `capUtf8Bytes` 的整行丢弃语义。若 VFS 路径本身含制表符（POSIX 合法），`indexOf("\t")` 会取到错的切点，`path`/`kind` 被拆错且不可逆（entry kind 还有 `as VfsListEntry["kind"]` 的强转兜底掩盖）。

**建议**：给 `capUtf8Bytes` 补一个「按对象数组 + 序列化函数」的变体（与 `capMatchList` 同形），去掉往返。置信 **suspected**（含 tab 的路径在 UI 里也不可读，属低概率）。

### F-w9-tool-pro-20 | P2 | `logic/tool-runner.ts:140-158`（标 intentional，不建议改）
> ```ts
> const pathTail = new Map<string, Promise<void>>();
> ```

`pathTail` 以**原始键**比对（`a.md` 与 `/a.md` 不互串）、且跨不了 runner 实例；`write` 固定 last-write-wins、`replace` 是「事务外读 → 内存替换 → 写回」。这两处均为用户 2026-09-06 拍板的全链路决定，出处 `docs/apm/RULE.md:83`（明文列出两处已知盲区「拍板接受」）。

**建议**：不报。列出仅为让 reduce 阶段不必重新推导。置信 **intentional**。

---

## 争议与存疑

1. **`toolUseMutatesWorkspace` 不含 skill，而 pathTail 含 skill**（`logic/tool-use-mutates-workspace.ts:15` 用 `isMutatingFileToolName`（仅 write/edit/fs）对 `logic/fs-command-classify.ts:128` 用 `SKILL_TOOL_NAME` 追加 skill write/edit）。我倾向认为这是**合理的**——skill 文件存 `meta` 域、不在会话工作区，checkpoint 覆盖不到也没法回滚——但两处代码注释都没写这句话（`fs-command-classify.ts:57-60` 只解释了排队键的构造），读代码的人会当成不一致。拿不准该算 bug 还是文档缺口，交给 reduce 裁决。
2. **两处 read 语义分叉是有意还是历史遗留**：`read` 工具走 `capUtf8BytesFill`（末行截到预算点、填满预算），`skill read` / `skill load` 走 `capUtf8Bytes` + `truncateLine`（整行丢弃 + 2000 字符截断）。`tool-output-limits.ts:143-145` 明写「既有函数不动——fs ls / grep excerpt / skill 路径仍用旧口径」，所以我按 intentional 处理；但同一模块里两套字节预算口径并存，read 一个 300KB 单行文件能拿满 50KB、skill read 只能拿 2KB，模型侧体感差异明显，值得产品侧确认是否要拉齐。
3. **A-14 该不该留**：F-4 给了「接线则需先修三处」和「撤下留纯函数」两个方向。我没有找到任何 RULE/迭代文档写明「三端 runtime 都按 undefined 语义走」是**拍板结果**——`builtin-tool-context.ts:190-191` 只说「目前三端 runtime 都按这个语义走，后续可以收紧」，语气像现状描述而非决议。所以我按缺陷报（confirmed），但如果 reduce 认为这句构成 intentional 依据，请降级为 P3。
4. **`SearchRecency` / `domainFilter` 的分期是否已到期**：`docs/Iterations/web-search-tool/spec.md:106` 的 T-A5、T-A6 都把 domainFilter 当**必测验收项**（不是「以后再说」），而实现把它做在引擎层、schema 层从未开放——即测试锁的是一条用户永远走不到的路径。这算 spec 自身内部矛盾还是实现漏接，我拿不准，标 suspected。
5. **未覆盖**：`search/types.ts:129-144` 的 `normalizeDomain` 正则（`/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i`）对 `localhost`、纯 IP、单标签内网域会返回 null从而静默丢过滤条目——因 F-6 该函数生产不可达，暂不单列，若 F-6 决定接线则需同步复核。
