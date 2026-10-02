---
zone: core-tool
agent: domain-survey
files_scanned: 29
---

## 摘要（≤150字）

`domain/tool/` 是内置工具全域：6 个 vfs 文件工具（read/write/edit/fs/glob/grep）、task/skill/agent/curl/search 五类工具、工具注册表 + 执行器（含 pathTail 同路径串行化）、输出预算限流与 LLM 输出格式化。共 29 个 .ts 文件。整体结构清晰、注释密度高且大量标注 WHY。问题集中在「导出面」与「死路径」：多个 @deprecated 别名与工具名常量零消费、A-14 path policy/配额在三个装配点被硬编码 undefined 而恒为空转、search 的 domainFilter/recencyFilter 全链路生产不可达、curl 自带一份与 tool-output-limits 逐行重复的 UTF-8 前缀截断实现。未发现 P0/P1。

## 职责与边界

- **工具本体层** `builtin/`：`vfs-tools.ts`（6 个文件工具 + 目录规则补行 + file_cache upsert 两个被 overflow-sink 复用的导出）、`subagent-tool.ts`（task）、`skill-tool.ts`（skill）、`agent-tool.ts`（agent）、`curl-tool.ts`（curl）、`search/`（search 工具 + 五引擎适配器 + KKV/SKSP 配置存储）、`overflow-sink.ts`（超预算落盘公共机制）、`register-builtin-tools.ts`（注册 11 个工具）、`builtin-tool-context.ts`（11 个内置工具共享的注入上下文类型）。
- **编排/策略层** `logic/`：`tool-registry.ts`（按名注册/解析，重名拒绝）、`tool-runner.ts`（schema 校验 → path policy → 执行 → output 校验，错误归一；`runParallel` 有界并发 + pathTail 同路径串行化）、`fs-command-classify.ts`（突变性与路径分类单源）、`fs-command.ts`（fs 子命令解析与执行）、`tool-use-mutates-workspace.ts`（checkpoint 侧突变判定）、`tool-path-policy.ts`（A-14 路径白名单）、`tool-output-limits.ts`（行数/字节/条数三档预算的统一实现）、`format-tool-output.ts`（tool_result 的 LLM 侧渲染）、`build-tool-result-block.ts`（outcome → 落库 ToolResultBlock）、`vfs-tool-file-path.ts` / `subagent-tool-session-id.ts`（工具卡片跳转解析）。
- **边界**：本区**不**持有任何 DB 连接或表访问；持久化一律经注入的服务端口（`VfsService` / `SessionKkvService` / `SkillService` / `AgentRegistryService` / `MessageService` / `SessionService` / `KkvService` / `SecretStore` / `WorkplaceService`）。本区唯一的「表」语义是经 `sessionKkv` 间接触达 `file_cache` 域。

## 对外接口

- `packages/core/src/index.ts:178-221` 导出：`Tool`（类型）、`ToolError` / `ToolErrorCode`、`ToolRegistry`、`ToolRunner`、`ToolCall` / `ParallelToolOutcome`、`buildToolResultBlock`、`resolveToolResultOk`、`BuildToolResultBlockMeta`、`createVfsTools`、`FILE_TOOL_NAMES`、`FILE_OPEN_TOOL_NAMES`、`MUTATING_FILE_TOOL_NAMES`、`isMutatingFileToolName`、`MUTATING_VFS_TOOL_NAMES`、`isMutatingVfsToolName`、`registerBuiltinTools`、`registerVfsTools`、`isMutatingFsCommand`、`toolUseMutatesWorkspace`、`anyToolUseMutatesWorkspace`、`TOOL_OUTPUT_MAX_LINES/LINE_LENGTH/BYTES/MAX_MATCHES`、`FileToolName`、`BuiltinToolContext`、`VfsToolContext`、`ToolResourceQuota`。
- `packages/core/src/index.ts:222-241` 导出 search 子系统（`ENGINE_IDS` / `KEY_ENGINE_IDS` / `SearchRecency` / `createSearchConfigStore` 等）。
- `packages/core/src/public/chat.ts:324` 额外导出 `resolveVfsToolFilePath`（双端消息块消费）。

## 数据访问（触碰的表/KKV/VFS，带 file:line 证据）

- **VFS（经 `ctx.vfs: VfsService`）**：`read`/`write`/`replace`/`list`/`mkdir`/`delete`/`glob`/`grep` + `moveVfsPath` / `copyVfsPath`。
  - `builtin/vfs-tools.ts:165` `await ctx.vfs.read(input.path)`（read 工具）
  - `builtin/vfs-tools.ts:261` `await ctx.vfs.write(logicalPath, input.content)`（write 工具）
  - `builtin/vfs-tools.ts:320` `await ctx.vfs.replace(...)`（edit 工具）
  - `builtin/vfs-tools.ts:216,213` `vfs.list` / `vfs.mkdir`（fs 工具）
  - `builtin/vfs-tools.ts:431,521` `ctx.vfs.glob` / `ctx.vfs.grep`
  - `builtin/vfs-tools.ts:586` `await ctx.vfs.read(logicalPath)`（write 前存在性探测，见 F-core-tool-12）
  - `builtin/overflow-sink.ts:90` `await ctx.vfs.write(savedPath, input.content)`（超预算落盘到 `/tmp/`）
- **session KKV `file_cache` 域**：`builtin/vfs-tools.ts:30-33` 引入 `fileCacheKey` / `SESSION_KKV_DOMAIN_FILE_CACHE`；`vfs-tools.ts:559-564` `ctx.sessionKkv.set(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE, fileCacheKey("full", logicalPath), …)`，由 `overflow-sink.ts:94` 复用。仅写不读——本区不做命中判定（符合 RULE「file_cache 不能当『前文是否引用过』的判断依据」）。
- **KKV 模块 `nm-search`（经 `KkvService`，非 session KKV）**：`search/search-config.ts:29` `SEARCH_KKV_MODULE = "nm-search"`；键 `engineOrder`（:32）与 `searxngBaseUrl`（:35），读 `search-config.ts:151-157`、写 `:277` / `:297-301`、删 `:268`。
- **SKSP SecretStore**：`search/search-config.ts:41-43` `searchApiKeyRef(engineId) = "search/{engineId}/apiKey"`；`has` 于 `:154-156`，明文 `get` 于 `:209`（仅 resolveEngineChain 内现读，不落 KKV/日志/返回值），`set` 于 `:260`，`delete` 于 `:263`。
- **表**：本区**无直接 SQL / 无表名**。间接相关表：`workplace_dir_rule`（经 `ctx.workplace.setDirRule` / `listDirRules`，`vfs-tools.ts:632-639`）。

## 依赖关系（import 了谁；被谁消费）

**import（出向）**
- 域内：`vfs-tools.ts` → `fs-command.ts` / `tool-output-limits.ts` / `vfs-tool-file-path` 同级 `overflow-sink.ts`；`fs-command-classify.ts` → `fs-command.ts` + `@/domain/skills/logic/skill-paths`（合成键单源）；`tool-runner.ts` → `fs-command-classify.ts` + `tool-path-policy.ts`；`tool-use-mutates-workspace.ts` → `vfs-tools.ts` + `fs-command-classify.ts`；`build-tool-result-block.ts` → `format-tool-output.ts` + `@/domain/chat/logic/skill-tool-ref`。
- 出域：`@/domain/vfs/*`（VfsService 端口、vfs-path-mapper、vfs-copy/move、format-vfs-error-for-llm）、`@/domain/skills/logic/skill-paths`、`@/domain/session-kkv/model/session-kkv-domains`、`@/domain/workplace/logic/rule-snapshot-codec`、`@/service/vfs/logic/ensure-import-dir-rules`（`backfillMissingDirRules`）、`@/service/session-kkv`、`@/service/skills`、`@/service/agent`、`@/service/chat`、`@/service/kkv`、`@/infra/sksp`、`@/infra/tdbc`（仅 format-tool-output 取 `TdbcError` 做 cause 链下钻）、`@/errors/*`。

**被消费（入向，实测 grep 全仓）**
| 消费方 | 消费的符号 |
| --- | --- |
| `service/agent/logic/run-agent-turn.ts:926-927,1276-1277` | 组装 BuiltinToolContext（allowedPaths / resourceQuota 硬编码 undefined） |
| `service/chat/create-user-vfs-turn-service.ts:78-79` | 同上 |
| `service/agent/impl/agent-runner.ts:21,844` | `anyToolUseMutatesWorkspace` |
| `domain/agent/logic/resolve-agent-tool-registry.ts:7,20,23` | `normalizeAgentToolPolicyName` |
| `domain/agent/logic/validate-agent-tool-policy.ts:9,24,34` | `normalizeAgentToolPolicyName` |
| `domain/chat/content/message-body-text.ts:7,34,82` | `formatToolResultContentForDisplay` |
| `domain/chat/logic/skill-tool-ref.ts` | `buildToolResultBlock` 侧的对称实现 |
| `apps/desktop/renderer/features/chat/message-blocks.ts:212` / `apps/mobile/src/components/chat/message-blocks.ts:299` | `resolveVfsToolFilePath` |

## 发现清单

### F-core-tool-1 | P2 | `packages/core/src/domain/tool/logic/subagent-tool-session-id.ts:33`
```ts
export function isTaskToolUse(toolName: string): boolean {
  return toolName === "task";
}
```
全仓 grep（`packages` + `apps`）显示 `isTaskToolUse` **零引用**——连测试都没有。同文件的 `resolveSubagentSessionId`（:21）也只被 `packages/core/test/tool/subagent-meta-passthrough.test.ts:8` 一个测试引用，未从 `index.ts` 或 `public/chat.ts` 导出。即：整个 34 行模块在生产链路上是死代码，而它的 doc（:4-5）宣称与 `vfs-tool-file-path.ts` 的 `resolveVfsToolFilePath` 对称——但后者确有双端消费（desktop `message-blocks.ts:212`、mobile `message-blocks.ts:299`），对称性只是注释上的。
建议：删除本文件（`resolveSubagentSessionId` 若要保留就并入 `build-tool-result-block.ts`），或补上真实消费方。
置信：confirmed

### F-core-tool-2 | P2 | `packages/core/src/domain/tool/builtin/vfs-tools.ts:69`
```ts
export const FILE_OPEN_TOOL_NAMES = new Set<FileToolName>([
  "read", "write", "edit",
]);
```
该常量从 `index.ts:195` 公开导出、并登记在 `packages/core/test/package-exports/snapshots/main-entry-allowlist.json:12`，但**全仓零消费**。真正在用的是 `logic/vfs-tool-file-path.ts:10` 另写的一份**私有同值副本**：
```ts
const FILE_OPEN_TOOL_NAMES = new Set(["read", "write", "edit"]);
```
同名两个定义、不同文件、公开的那份没人用、私有的那份被双端间接消费。属于典型的「重复实现 + 公开面漂移」。
建议：删掉 `vfs-tools.ts` 的导出（或反过来让 `vfs-tool-file-path.ts` import 它），二选一；同时清理 index.ts 与 allowlist 快照。
置信：confirmed

### F-core-tool-3 | P2 | `packages/core/src/domain/tool/builtin/builtin-tool-context.ts:193` + `:197`
```ts
readonly allowedPaths?: readonly string[];
/** 可选：资源配额占位（A-14）。当前仅占位，`ToolRunner` 还未真正强制。 */
readonly resourceQuota?: ToolResourceQuota;
```
A-14 的两道闸在**全部三个装配点**都被硬编码为 `undefined`：
- `service/agent/logic/run-agent-turn.ts:926-927`（主 agent）
- `service/agent/logic/run-agent-turn.ts:1276-1277`（子 agent）
- `service/chat/create-user-vfs-turn-service.ts:78-79`

于是 `logic/tool-runner.ts:100` 的 `checkToolPathPolicy(parsedIn.data, ctx)` 在**每一次工具调用**上都会执行 `readAllowedPaths` + `extractInputPaths` + `findDisallowedPath` 三段逻辑，然后恒返回 `null`（`tool-path-policy.ts:85-87` / `:69-71` 的 undefined 早退）。`toolPathForbidden` 错误码在生产中不可达。`resourceQuota` 则连读取方都没有。
建议：要么删掉这层空转（保留 ctx 字段但不在 runner 里无条件调用），要么落地真实白名单——现状是「看起来有安全闸、实际没有」。
置信：confirmed

### F-core-tool-4 | P3 | `packages/core/src/domain/tool/builtin/search/search-tool.ts:208`
```ts
const options = { maxResults: normalizeMaxResults(input.maxResults) };
```
工具 schema（`search-tool.ts:145-161`）只开放 `query` / `maxResults` / `engine`，`SearchToolOptions.domainFilter` 与 `recencyFilter`（`search/types.ts:86-87`）在**生产链路上永远为 undefined**。因此以下全部只在测试里被点亮、实际不可达：`parseDomainFilters`（types.ts:150）、`matchesDomainFilters`（types.ts:173）、`buildSearxngQuery`（searxng.ts:33）、`buildBraveQuery`（brave.ts:39）、`mapFreshness`×2（bocha.ts:36 / brave.ts:55）、`BRAVE_DOMAIN_FILTER_COUNT`（brave.ts:36）、`SearchRecency`（types.ts:76）。
文件头注释 `types.ts:83` 写明「引擎适配器入参选项（工具 schema 本期只开放 query/maxResults/engine）」——属**有意的分阶段设计**，标 intentional；但它同时是一块由测试持续供血、生产永不触达的体量（跨 5 个引擎约 150 行），若没有后续排期就应删。
建议：给 `domainFilter` / `recencyFilter` 定去留——要么进 schema，要么删实现。
置信：intentional

### F-core-tool-5 | P2 | `packages/core/src/domain/tool/builtin/curl-tool.ts:192`（对比 `logic/tool-output-limits.ts:89`）
```ts
function truncateToByteBudget(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const CHUNK = 8192;
```
与 `tool-output-limits.ts:89-132` 的 `sliceUtf8BytePrefix` 是**逐行等价**的同一算法（8192 块式增量编码 + 块尾高代理项右移 + 块内 `codePointAt` 逐码位推进 + `String.fromCodePoint` 计字节）。curl 只在降级截断路径（`curl-tool.ts:518`）调用它一次。同文件 `:173-183` 的 `utf8ByteLength` 也与 `tool-output-limits.ts:14-16` 的私有 `utf8ByteLength` 重复。跨模块算 UTF-8 字节的口径共有 4 处：`curl-tool.ts:173`、`overflow-sink.ts:102`、`search-tool.ts:266`、`build-tool-result-block.ts:207`。
建议：把 `sliceUtf8BytePrefix` 与字节长度工具从 `tool-output-limits.ts` 导出，curl 直接复用；`utf8ByteLength` 统一到一处。
置信：confirmed

### F-core-tool-6 | P3 | `packages/core/src/domain/tool/logic/tool-path-policy.ts:20`
```ts
export function extractInputPaths(input: unknown): readonly string[] {
```
`extractInputPaths` / `pathStartsWithPrefix`（:43）/ `isPathAllowed`（:65）/ `findDisallowedPath`（:81）/ `readAllowedPaths`（:104）全部标 `export`，但**除本文件内部互相调用与 `test/tool/tool-runner-path-policy.test.ts` 外无任何引用**，且整个 `tool-path-policy.ts` 不在 `index.ts` 也不在 `public/chat.ts` 的导出链上（实测 grep）。即五个「导出了却不出模块」的 export。
建议：去掉 export，或把该模块纳入正式公开面。
置信：confirmed

### F-core-tool-7 | P3 | `packages/core/src/domain/tool/builtin/register-builtin-tools.ts:47`
```ts
/** @deprecated Use {@link registerBuiltinTools}. */
export function registerVfsTools(...)
```
一整批 `@deprecated` 别名只在 `index.ts` 被再导出一次、**无任何生产消费方**（实测 grep `registerVfsTools` / `MUTATING_VFS_TOOL_NAMES` / `isMutatingVfsToolName` / `VfsToolContext` 全仓命中仅限本区定义 + index.ts + allowlist 快照）：
- `registerVfsTools`（`register-builtin-tools.ts:47` → `index.ts:203`）
- `MUTATING_VFS_TOOL_NAMES`（`vfs-tools.ts:58` → `index.ts:198`）
- `isMutatingVfsToolName`（`vfs-tools.ts:66` → `index.ts:199`）
- `VfsToolContext`（`builtin-tool-context.ts:252` → `index.ts:219`）

它们还占着 `main-entry-allowlist.json` 快照条目，等于把死代码钉进了公开契约。
建议：确认无双端引用后一并删除（`validate-agent-definition.ts` 里的引用是另一个同名概念，需先核）。
置信：confirmed

### F-core-tool-8 | P3 | `packages/core/src/domain/tool/builtin/builtin-tool-context.ts:180`
```ts
  /**
  /**
   * 可选：`write` 成功后 upsert `file_cache` `full:{path}`。
```
`sessionKkv` 字段的文档注释开头被多打了一个 `/**`，形成嵌套块注释——不影响编译，但 `sessionKkv` 字段因此在多数工具里没有可读注释。同类格式问题另见 `skill-tool.ts:201` 的双空行。
建议：删掉多余的一个 `/**`。
置信：confirmed

### F-core-tool-9 | P3 | `packages/core/src/domain/tool/builtin/builtin-tool-context.ts:229`
```ts
readonly workplace?: Pick<
    WorkplaceService,
    "setDirRule" | "getDirRule" | "listDirRules"
  >;
```
注入的窄类型里带了 `getDirRule`，但整个 `domain/tool/` 区**从未调用**它——只有 `vfs-tools.ts:632` 的 `listDirRules()` 与 `:638` 的 `setDirRule()`。`getDirRule` 是纯占位接口面积（也解释了为什么补规则逻辑要一次性 `listDirRules` 全量拉取再求差，见 `vfs-tools.ts:606-608` 的 B-2 注释）。
建议：从 Pick 里去掉 `getDirRule`，或在注释里写明为何保留。
置信：confirmed

### F-core-tool-10 | P3 | `packages/core/src/domain/tool/logic/format-tool-output.ts:110` 与 `:139`
```ts
    const hint =
      omitted != null && omitted > 0
        ? `\n\nOutput truncated (${omitted} more omitted; total ${rec.total}).`
```
`formatGrepOutput`（:102-121）与 `formatGlobOutput`（:135-150）的截断提示块**逐字符相同**（11 行完整复制）。两者唯一差异只有前一行拼接。
建议：抽 `appendTruncationHint(out, rec, kept)` 私有函数。
置信：confirmed

### F-core-tool-11 | P3 | `packages/core/src/domain/tool/logic/tool-registry.ts:32`
```ts
  /** Removes a tool by name. Returns true if removed. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }
```
`unregister` 只有 `test/tool/tool-registry.test.ts:58` 一处调用；`clear`（:50，注释自称 "for tests only"）除测试外无调用。`ToolRegistry` 是 `index.ts:181` 的公开导出，但这两个生命周期方法在生产中不存在调用方——注册一次、随 run 生命周期丢弃。
建议：标注 `@internal` 或直接删除，避免与 `abortRegistry` / `streamRegistry` 的同名 `unregister` 混淆。
置信：confirmed

### F-core-tool-12 | P3 | `packages/core/src/domain/tool/builtin/vfs-tools.ts:586`
```ts
    await ctx.vfs.read(logicalPath);
    return false;
```
write 前的新建探测用**完整 read**（会取回并解出全文）来判断「文件是否存在」，而同一个 `VfsService` 端口就提供了轻量探针（`domain/vfs/ports/vfs-service.port.ts:60`）：
```ts
findContentSize(path: string): Promise<VfsContentSize | null>;
```
其注释明写「按路径轻量探测文件 content 大小（**不解正文**）… 目录行 / 路径不存在等无法探测的情形返回 `null`」。也就是说每次 `write` 工具调用都会为一次存在性判断把目标文件全文读进内存。`vfs-tools.ts:578-580` 的 WHY 注释说「探测原语用 `vfs.read`（工具上下文内唯一可用的存在性探测）」——该前提在端口层面已不成立（端口里没有 `stat`/`exists` 是对的，但 `findContentSize` 就是等价物）。
建议：改用 `findContentSize`（`null` → 视为不存在/目录 → 补规则；与现有「撞目录行保守跳过」语义兼容，仅 `NOT_FOUND` 一档会变得宽松，需确认）。
置信：suspected（语义差异需确认，但性能动机成立）

### F-core-tool-13 | P3 | `packages/core/src/domain/tool/logic/fs-command.ts:131`
```ts
  const lines = entries.map(formatListEntry);
  const capped = capUtf8Bytes(lines, TOOL_OUTPUT_MAX_BYTES);
  const formattedEntries = capped.lines.map((line) => {
    const tab = line.indexOf("\t");
```
`formatLsOutput` 为了复用按行计字节的 `capUtf8Bytes`，先把 `VfsListEntry` 序列化成 `path\tkind` 字符串行，截断后再按**第一个 tab** 切回对象。往返编解码：路径里若含 `\t` 会被截成半截路径，含 `\n` 会把一条 entry 拆成两行并污染 `total`/`omitted` 统计。逻辑路径是否允许这些字符未在文件内给出保证。
建议：给 `capUtf8Bytes` 加一个「按投影函数计字节」的变体（`capMatchList` 已有 `formatItem` 参数可参考，见 `tool-output-limits.ts:188-189`），避免字符串往返。
置信：suspected

### F-core-tool-14 | P3 | `packages/core/src/domain/tool/logic/tool-output-limits.ts:209`
```ts
    if (bytesUsed + separatorBytes + lineBytes > TOOL_OUTPUT_MAX_BYTES) {
```
同文件的 `capUtf8Bytes`（:57）与 `capUtf8BytesFill`（:148）都接受 `maxBytes` 参数，只有 `capMatchList` 硬编码模块常量，签名上却带了 `maxItems` 参数——参数风格不统一，且让 grep / agent list 无法单独调预算。
建议：补 `maxBytes` 可选参数。
置信：confirmed

### F-core-tool-15 | P3 | `packages/core/src/domain/tool/builtin/search/engines/searxng.ts:33` 与 `brave.ts:39`
```ts
function buildSearxngQuery(query: string, filters: DomainFilters): string {
  ...
  for (const domain of filters.exclude) {
    parts.push(`-site:${domain}`);
```
`buildBraveQuery`（brave.ts:39-52）与它是 14 行逐行复制，**唯一差异**是 exclude 前缀 `-site:` vs `NOT site:`。include 分支的 `length === 1` / `> 1` OR 拼接逻辑完全重复。
建议：抽 `buildSiteQuery(query, filters, { excludePrefix })` 到 `search/types.ts`。
置信：confirmed

### F-core-tool-16 | P3 | `packages/core/src/index.ts:176`
```ts
/**
 * Tool 运行时：注册表、执行器与内置 `vfs.*` 工具。
 */
```
注释说内置工具带 `vfs.` 前缀，但实际注册名是裸 `read` / `write` / `edit` / `fs` / `glob` / `grep`（`vfs-tools.ts:39-46`）。`vfs.` 只作为**历史 policy 名的兼容别名**存在（`vfs-tools.ts:75-78` 的 `normalizeAgentToolPolicyName`、以及 `vfs-tool-file-path.ts:25` 的前缀剥离）。这处陈旧表述会误导后续开发者以为工具名带前缀。
建议：改为「内置文件工具（read/write/edit/fs/glob/grep，兼容 `vfs.` 前缀的旧 policy 名）」。
置信：confirmed

### F-core-tool-17 | P3 | `packages/core/src/domain/tool/logic/fs-command.ts:122`
```ts
export function isMutatingFsCommand(input: unknown): boolean {
  return classifyFsCommand(input).mutating;
}
```
它是 `classifyFsCommand(...).mutating` 的零成本包装，**全仓唯一引用是一条文档注释**（`fs-command-classify.ts:27` 的 `{@link isMutatingFsCommand}`），没有任何调用点；却从 `index.ts:205` 公开导出。
建议：删函数并把该处注释改指 `classifyFsCommand`。
置信：confirmed

### F-core-tool-18 | P3 | `packages/core/src/domain/tool/builtin/skill-tool.ts:437`
```ts
        const truncated =
          byteCapped.truncated ||
          returnedLines < slice.length ||
          (lineNextOffset != null && returnedLines >= limit);
```
`returnedLines < slice.length` 与 `byteCapped.truncated` 在 `capUtf8Bytes` 语义下**恒等价**（该函数在丢弃任何一行时才置 `truncated = true`，`tool-output-limits.ts:70-73`；而 `returnedLines === byteCapped.lines.length`、`slice` 即其入参），是冗余判据。同时 skill read 相比 vfs read（`vfs-tools.ts:196`）多了一整套平行的分页/截断实现，两处口径需要人工保持同步。
建议：删冗余项；长期看 skill read 应复用与 vfs read 同源的截断 helper。
置信：confirmed

### F-core-tool-19 | intentional | `packages/core/src/domain/tool/logic/tool-runner.ts:140`
```ts
    const pathTail = new Map<string, Promise<void>>();
```
pathTail 同路径串行化是 VFS write/edit/fs/skill **唯一**并发保护层（底层乐观锁已按用户 2026-09-06 拍板全拆，write 固定 last-write-wins）。登记与 `await` 之间无 await 点，`pathTail.set` 在同一 tick 内原子完成，逻辑正确。两处已知盲区（原始键比对：`a.md` vs `/a.md` 互不串行；跨 runner 实例不覆盖，子会话共享父工作区仍可能后写覆盖）**已由用户拍板接受**。
出处：`docs/apm/RULE.md`「实现禁令与坑」条目「VFS write/edit/skill 工具的并发语义（无锁，pathTail 同路径串行化为唯一保护层）」。
建议：不改。若要收敛盲区，唯一低成本动作是让 `classifyMutatingToolCall`（`fs-command-classify.ts:116-119`）对 `write`/`edit` 的 `path` 先过 `resolveLogicalPath`，与 `vfs-tools.ts:255` 写入口的归一化对齐。
置信：intentional

### F-core-tool-20 | intentional | `packages/core/src/domain/tool/builtin/vfs-tools.ts:256-270`
```ts
      const isNewFile =
        ctx.workplace != null &&
        (await probeFileAbsentForWrite(ctx, logicalPath));
```
「仅新建文件补父链目录规则、编辑已有文件不补、探测失败保守跳过、补规则失败不阻断写入」四段口径全部有意为之。
出处：`docs/apm/RULE.md`「目录规则（dir rule）」条目（核心口径：无规则行 = rule_off，故新目录必须显式插行；agent 与用户操作的 write 仅新建时补、fs mkdir 对新目录补、仅无行时补不覆盖显式关闭、补规则失败不阻断）。
建议：不改。（性能面另见 F-core-tool-12，但那是实现选择不是口径。）
置信：intentional

## 争议与存疑

1. **F-core-tool-12（write 前探测用 read 而非 findContentSize）**：我确认了端口上存在更轻的 `findContentSize`，但**语义不完全等价**——`read` 能区分 `NOT_FOUND`（判「新建」）与 `IS_DIRECTORY`（判「已存在、跳过补规则」），而 `findContentSize` 对两者都返回 `null`。若换成「null 即新建」，一个名为 `foo` 的目录会让 write 误走补规则分支。这属于行为变更而非纯优化，故标 suspected 而非 confirmed，需要产品/规则口径确认后再动。
2. **F-core-tool-13（fs ls 的 tab 往返）**：我没有核实 VFS 逻辑路径的字符集约束（不在本区），因此不能断言 `\t` 一定可达。若路径层已禁止控制字符，本条降为纯代码风格问题。
3. **F-core-tool-4（search 的 domainFilter/recencyFilter）**：注释「本期只开放」明确表达了分阶段意图，我按 intentional 处理而非当缺陷。但我无法从代码看出这个「本期」是否有后续排期，也没有在 `docs/Iterations/` 里找到对应 spec 的落地计划——若确认无排期，应按死代码清理。
4. **F-core-tool-2（两份 FILE_OPEN_TOOL_NAMES）**：我按「重复实现」报出，但也有可能是 allowlist 快照机制要求公开面稳定而刻意保留的对外常量。若双端将来要读它，则应改为让 `vfs-tool-file-path.ts` 引用公开版而非删除。
5. **`Tool` 接口的 `description: (ctx) => string`**（`model/tool.ts:26`）：所有内置工具都实现了 lambda，但除 task / skill / agent 三个依赖 `ctx` 的之外，其余 8 个（read/write/edit/fs/glob/grep/curl/search）都写成 `() => \`...\`` 常量函数。这不是缺陷，但让「所有工具的 description 都是动态的」这一接口约束失去区分度，读者会误以为 read 之类也在按上下文变化。未计入发现清单，属观察。
6. **`formatToolOutputForLlm` 的启发式分派**（`format-tool-output.ts:352-406`）：靠「字段形状」而非工具名分派（`isReadOutput` / `isGrepOutput` / `isGlobOutput` / `isSearchOutput` / `isCurlOutput` / `isSkillLoadOutput`），尾部还有 `keys.length === 1 && rec.version === number` 这类兜底。好处是新增工具零成本接入，代价是形状碰撞风险（`isGrepOutput` 为此专门排除了 `messageId`/`seq`/`hidden` 字段，见 :89）。这是**有意的设计**（`format-tool-output.ts:88-91` 有注释说明 chat_grep 排除逻辑），不是缺陷，但属于「结构性脆弱点」，值得在 CR 结论里点名。
