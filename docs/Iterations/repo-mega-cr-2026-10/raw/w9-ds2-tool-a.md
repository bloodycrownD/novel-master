---
zone: w9-ds2-tool-a
agent: 独立双扫 A（domain-survey）
files_scanned: 29（packages/core/src/domain/tool/ 全量，29/29 无遗漏；约 235KB，全部实读）
---

# w9-ds2-tool-a —— packages/core/src/domain/tool/ 全量测绘

## 摘要

LLM 工具域：11 个内置工具的**定义 + 执行 + 输出整形 + 并发调度**四层。
`model/tool.ts` 定义协议无关的 `Tool<Input,Output,Ctx>`；`logic/tool-runner.ts` 做
schema 校验、错误归一与同路径串行化；`logic/build-tool-result-block.ts` +
`logic/format-tool-output.ts` 把执行结果整成落库的 `ToolResultBlock` 与给模型看的文本；
`builtin/` 下是 6 个 VFS 文件工具（read/write/edit/fs/glob/grep）与 5 个静态工具
（task/skill/agent/curl/search）。域内无表访问，仅经 `ctx.vfs`（VFS 服务）与
`ctx.sessionKkv`（file_cache 域）间接落库。

## 职责与边界

- **不管**：工具可见性策略（`domain/agent/logic/resolve-agent-tool-registry.ts`，按 depth 摘 task/agent）、
  回合编排与 checkpoint 触发（`service/agent/impl/agent-runner.ts`）、提示词拼装。
  本域只提供「工具是什么、怎么跑、跑完输出什么形状」。
- **不管**：VFS 语义（路径归一/版本链/乐观锁）、技能域与 agent registry 的持久化——
  全部经端口调用（`VfsService` / `SkillService` / `AgentRegistryService`）。
- **管**：输出预算（50KB / 2000 行 / 100 匹配，四工具同口径）与其字节安全截断；
  突变分类单源（checkpoint 用「保守视为突变」，runner 用「不串行化未知路径」两套口径）。

## 对外接口

`packages/core/src/index.ts:181-215` 主入口导出：`ToolRegistry` / `ToolRunner` /
`ToolCall` / `ParallelToolOutcome` / `buildToolResultBlock` / `resolveToolResultOk` /
`createVfsTools` / `FILE_TOOL_NAMES` / `FILE_OPEN_TOOL_NAMES` /
`MUTATING_FILE_TOOL_NAMES` / `isMutatingFileToolName` / `registerBuiltinTools` /
`isMutatingFsCommand` / `toolUseMutatesWorkspace` / `anyToolUseMutatesWorkspace` /
四个 `TOOL_OUTPUT_MAX_*` 常量。
`src/public/chat.ts:324` 另导出 `resolveVfsToolFilePath`（双端 UI「打开文件」门控消费）。

域内关键类型：`Tool`（`model/tool.ts:17`，`description` 是 `(ctx)=>string` 而非常量，
由 `infra/llm-protocol/logic/tool-definitions.ts:toolsFromRegistry` 在**每 run 装配期**
同步求值一次）、`BuiltinToolContext`（`builtin/builtin-tool-context.ts:169`，
11 个可选闭包：vfs/projectId/sessionId/listSessionMessages/sessionKkv/allowedPaths/
resourceQuota/subagent/skills/agents/workplace/search/fetchFn）。

## 数据访问

| 面 | 触点 | 证据 |
|---|---|---|
| 表 | **无直接 SQL**（域内零 `conn.execute`） | 全目录 grep 无 tdbc 调用面；唯一 tdbc import 是 `logic/format-tool-output.ts:11` 的 `TdbcError`（错误 cause 解包） |
| KKV 域 | `file_cache` 域写 `full:{path}`（write 工具 + overflow-sink 两处） | `builtin/vfs-tools.ts:549-565`、`builtin/overflow-sink.ts:94` |
| KKV 模块 | `nm-search`：`engineOrder` / `searxngBaseUrl` | `builtin/search/search-config.ts:29-35` |
| 密钥 | SKSP ref `search/{bocha\|tavily\|brave}/apiKey`（明文只在 `resolveEngineChain` 现读） | `search-config.ts:41-43, 209` |
| 文件系统 | 无本地 FS 读写（全走 VFS 端口）；`/tmp/` 是 **VFS 内**逻辑路径不是真磁盘 | `overflow-sink.ts:31` |
| 外部网络 | curl 任意 http/https；search 五引擎 | `curl-tool.ts:382-545`、`search/engines/*.ts` |

## 依赖关系

- **import 谁**：`errors/tool-errors` `errors/vfs-errors` `infra/tdbc`（仅错误类型）、
  `domain/vfs/logic/*`（path-mapper / vfs-copy / vfs-move / format-vfs-error-for-llm）、
  `domain/skills/logic/skill-paths` `resolveSkillRelPathCore`、`domain/session-kkv/model`、
  `domain/workplace/logic/rule-snapshot-codec`、`domain/chat/logic/skill-tool-ref`、
  `service/{vfs,skills,session-kkv,agent,chat,workplace}/*.port`、`service/vfs/logic/ensure-import-dir-rules`、
  `infra/sksp/ports/secret-store.port`。
- **被谁消费**：`service/agent/logic/run-agent-turn.ts`（三处装配 ctx）、
  `service/agent/impl/agent-runner.ts`（`runParallel` + `anyToolUseMutatesWorkspace`）、
  `service/chat/create-user-vfs-turn-service.ts`、
  `domain/agent/logic/{resolve-agent-tool-registry,validate-agent-tool-policy}.ts`、
  `domain/chat/content/message-body-text.ts`、`infra/llm-protocol/logic/tool-definitions.ts`、
  双端 UI（`apps/{desktop/renderer,mobile/src}/components|features/chat/message-blocks.ts`）。

## 发现清单

### F-w9-ds2-tool-a-1 | P1 | `logic/format-tool-output.ts:152-154`（判定）+ `:364`（命中点）

```
function isFsLsOutput(rec: Record<string, unknown>): boolean {
  return Array.isArray(rec.entries) && typeof rec.total === "number";
}
```

**描述**：`formatToolOutputForLlm` 的形状守卫按**结构**而非工具名分派，`isFsLsOutput`
只要求「`entries` 是数组 + `total` 是数字」，而 `skill list`（`skill-tool.ts:113-124`）
与 `agent list`（`agent-tool.ts:77-81`）输出恰好同形。二者在守卫顺序中早于
`isSkillLoadOutput` / `isMutationAckOutput` 被命中，于是走到 `formatFsLsOutput`
（`:156-170`）——它按 `e.path` / `e.kind` 取字段，而 list 条目里根本没有这两个键。
**实跑证据**（core src + tsx 探针，喂真实输出形状）：

```
skill list → "undefined\tundefined\nundefined\tundefined"
agent list → "undefined\tundefined\nundefined\tundefined\n\nOutput truncated (0 entries omitted; total 2)."
```

即模型每次调 `skill list` / `agent list`，拿回的是两行 `undefined\tundefined`。
（`buildToolResultBlock.ts:112-180` 的 `summarizeToolSuccess` 对这两个工具有专门分支，
UI 摘要正确——所以**卡片看着正常、模型看到的是垃圾**，肉眼极难发现。
那句 `Output truncated (0 entries omitted; total 2)` 仅在 agent 数超 100 真被截断时才附带，
但它同样是错的：`entries.length` 是截断后条数而 `omitted` 算成 0。）

**建议**：给 `isFsLsOutput` 加 `rec.action === undefined` 或 `typeof rec.entries[0]?.path === "string"`
的双门控（与 `isGrepOutput:89` 排除 chat_grep 的做法同款）；顺带把 skill/agent list 的
`entries` 首元素形状纳入守卫。回归断言必须是「喂 list 形状后输出不含 `undefined`」，
别写成恒真断言。

**置信**：confirmed（实跑复现）

### F-w9-ds2-tool-a-2 | P2 | `logic/tool-path-policy.ts:17,43-58` + 三个装配点

```
readonly allowedPaths?: readonly string[];   // builtin-tool-context.ts:193
allowedPaths: undefined,                      // run-agent-turn.ts:926 与 :1276、create-user-vfs-turn-service.ts:78
```

**描述**：A-14 的 path 白名单闸门**在生产里零设置方**——三个 ctx 装配点全部写死
`undefined`，`checkToolPathPolicy` 恒返回 `null`，`ToolRunner.call` 的第二道闸
（`tool-runner.ts:100-103`）等于空转。且即使接线也拦不住：
① `pathStartsWithPrefix`（`:43-58`）是纯字符串前缀比对，**不归一 `..`**，而 VFS 侧
`normalizePath`（`domain/vfs/repositories/impl/normalize-path.ts:31-37`）是真解 `..` 的——
`path: "src/../../secret.txt"` 通过 `allowedPaths:["src"]` 校验，落盘却是 `/secret.txt`；
② `extractInputPaths`（`:17`）只抽顶层 `path/filePath/from/to`，漏掉
`grep.options.pathPrefix`、`glob.options.cwd`，以及 `skill` 工具的全部路径
（由 `name`+`domain` 合成，落在 meta 域，与工作区路径不同命名空间）。

**建议**：接线时必须先 (a) 用 `resolveLogicalPath` 归一后再比前缀、(b) 把
`pathPrefix`/`cwd`/skill 域纳入抽取、或改由各工具自报路径。三处 `allowedPaths: undefined`
若确定长期不收紧，建议把 `ToolRunner` 里那段闸与 `BuiltinToolContext.allowedPaths` 一并摘掉，
避免「看起来有防护」的误导（`resourceQuota` 同理，见 F-8）。

**置信**：confirmed（死闸与 `..` 绕过均代码可证；「是否接线」属产品决策，见争议）

### F-w9-ds2-tool-a-3 | P2 | `builtin/vfs-tools.ts:581-598`（探测）+ `:258-260`（调用点）

```
const isNewFile = ctx.workplace != null && (await probeFileAbsentForWrite(ctx, logicalPath));
...
await ctx.vfs.read(logicalPath);   // probeFileAbsentForWrite 内
```

**描述**：每次 `write` 都先 `vfs.read` 探「是不是新建」，而 `vfs.read` 会
`SELECT ... content` 把**整个文件正文**从 blob 拉出来
（`service/vfs/impl/vfs.service.ts:88-102` → `domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:127`
的 SELECT 列含 `content`）。即为了判一个布尔值，把整个文件读进内存。
`VfsService` 端口本就有廉价探针 `findContentSize`（`domain/vfs/ports/vfs-service.port.ts:60`）。
注意 `vfs.write` 自身已经 `findByPath` 过一次（`vfs.service.ts:117`），探测让读放大约翻一倍。

**建议**：改用 `findContentSize(path) === null` 判不存在（注意其对目录也返回 null，
需与「写入目录路径」这一既有失败分支对齐——真正写入仍会抛 `IS_DIRECTORY`，语义无损）；
或在 `workplace.listDirRules` 已知的条件下按需探测。

**置信**：confirmed

### F-w9-ds2-tool-a-4 | P2 | `logic/fs-command.ts:155-183`

```
if (recursive) return true;
try { await vfs.read(path); return false; }   // 为了判断「是不是目录」，把待删文件全文读出来
```

**描述**：`rm` 未带 `recursive` 时用「read 成功=文件 / read 抛 IS_DIRECTORY=目录」
判类型。删一个文件要先把它完整读进内存，峰值内存与被删文件同量级；
`rm` 是 agent 高频工具，大文件场景（minified JS / 长日志）白付一次全量 IO。
描述里「不传时若目标是目录也会自动递归删」已写明递归语义（用户可见、非隐藏），
但这条性能代价没有对应注释。

**建议**：用 `findContentSize`/`findContentHash` 或让 VFS 端口直接暴露
「kind 查询」，避免用读路径当存在性探针（与 F-3 同源，建议一起改）。

**置信**：confirmed

### F-w9-ds2-tool-a-5 | P2 | `builtin/builtin-tool-context.ts:169-249` + `logic/tool-runner.ts:134-141`

```
export type BuiltinToolContext = { readonly vfs; ...; readonly fetchFn?: typeof globalThis.fetch };
// ← 全类型无 AbortSignal 字段
async runParallel(calls, ctx, options?): Promise<ParallelToolOutcome[]>   // 不接 signal
```

**描述**：`BuiltinToolContext` 不含 `AbortSignal`，`ToolRunner.runParallel` 也没有取消入口。
网络类工具因此不可被用户中断：`curl` 自建 `AbortController` 只受自身 `timeout` 约束
（上限 120s，`curl-tool.ts:57,406`），`search` 串行链最坏 60(bocha)+60(tavily)+30(brave) ≈ 150s
（各引擎 `*_TIMEOUT_MS`）。`agent-runner.ts:832` await 整批，abort 只在批次**前后**检查
（`:802` / `:890`）。用户按「停止」后，回合仍要等最慢的那条在途工具跑完才收敛。
注：`task` 工具不受影响——它经 `subagent.parentSignal` 传了（`subagent-tool.ts:213`），
说明信号在域内是可传的，只是没放进通用 ctx。

**建议**：给 `BuiltinToolContext` 增 `signal?: AbortSignal` 并让 curl/search 的
`AbortController` 挂 `AbortSignal.any` 语义（RN 无 `AbortSignal.any` 时手工转发 abort 事件），
`runParallel` 增加「批取消时丢弃未启动项」的短路。

**置信**：suspected（域内确无取消入口属实；实际中止延迟的上界取决于 runner 侧后续处理，
该文件不在本 zone，未逐行核 `:802-890` 的完整语义）

### F-w9-ds2-tool-a-6 | P2 | `builtin/agent-tool.ts:163-172` + `logic/fs-command-classify.ts:111-132`

```
let candidate = `agent-${Date.now()}`;
for (let i = 1; existing.has(candidate); i++) candidate = `agent-${Date.now()}-${i}`;
```

**描述**：`runParallel` 的同路径串行名单（`classifyMutatingToolCall`）只覆盖
**write / edit / fs / skill** 四个工具名，`agent` 的 create/update 不在其中。
`allocateAgentId` 的去重只对照 `listAgentIds()` 已落库的 id，**看不见同批次在途的 id**。
于是一条 assistant 消息里并发两个 `agent create`（LLM 并行发工具调用是常态）
只要落在同一毫秒，两边取到同一个 `agent-${Date.now()}`，后写者 `upsert` 直接覆盖前者——
静默丢一个 agent，且工具描述承诺「定义保存后立即可用」。循环里重算 `Date.now()`
还让 `-${i}` 后缀在时间跳变后永远撞不上，等于没有重试。
（`fs`/`skill` 有工具自带的语义差异要处理，`agent` 没有，属于纯粹的名单漏项。）

**建议**：把 `agent` 的 create/update 纳入 `classifyMutatingToolCall`（合成键
`agent:{action}:{name|agentId}`，同目标串行），或把 `allocateAgentId` 换成
带冲突重试的写入（`Date.now()` 单调自增计数器 + upsert 冲突重试）。

**置信**：confirmed（代码路径确证；同毫秒概率未构造并发实测）

### F-w9-ds2-tool-a-7 | P3 | `builtin/search/search-tool.ts:216-227`

```
if (Date.now() - startedAt >= SEARCH_CHAIN_BUDGET_MS) { throw ... }
```

**描述**：`SEARCH_CHAIN_BUDGET_MS = 120_000` 只在**每次尝试前**检查，不是硬顶。
一串全配好的引擎依次超时（bocha 60s + tavily 60s + brave 30s）可在单次工具调用里
累计约 150s，超出工具 description 与注释宣称的「串行链总预算 120s」（`:142`、`:56`）。
与 F-5 叠加会放大「按停止没反应」的体感。

**建议**：要么把剩余额度传进各引擎的 `AbortController`（`setTimeout(remaining)`）做真截断，
要么把文案改成「链首尝试前检查，实际最坏 ~150s」。

**置信**：confirmed

### F-w9-ds2-tool-a-8 | P3 | 域内死代码群（可整批删）

- `logic/subagent-tool-session-id.ts` **整文件零消费**：`resolveSubagentSessionId` /
  `isTaskToolUse` 既无生产调用方，`src/index.ts` 与 `src/public/*` 也未导出（文件尾部
  还 reexport 了 `ToolResultBlock`/`ToolUseBlock` 两个无人使用的类型）。
- 三个 `@deprecated` 别名零生产消费：`registerVfsTools`
  (`register-builtin-tools.ts:47`)、`MUTATING_VFS_TOOL_NAMES` (`vfs-tools.ts:58`)、
  `isMutatingVfsToolName` (`vfs-tools.ts:66`)，只活在 `index.ts:198-204` 与
  `test/package-exports/snapshots/main-entry-allowlist.json` 里。
- `logic/tool-path-policy.ts` 的 5 个导出（`extractInputPaths` / `pathStartsWithPrefix` /
  `isPathAllowed` / `findDisallowedPath` / `readAllowedPaths`）只有测试消费；
  `isMutatingFsCommand`、`toolUseMutatesWorkspace`（单数版）同样只有测试/导出面。
- `builtin/vfs-tools.ts:69` 导出的 `FILE_OPEN_TOOL_NAMES` 与
  `logic/vfs-tool-file-path.ts:10` 的同名私有常量内容完全相同（都是 read/write/edit），
  双份来源、后者才是真正被 UI 门控用的（`resolveVfsToolFilePath`）。
- `BuiltinToolContext.resourceQuota`（`builtin-tool-context.ts:163-167,197`）是纯占位，
  三处装配点全写 `resourceQuota: undefined`，`ToolRunner` 从不读——与 F-2 的
  `allowedPaths` 属同一类「看起来有闸」的误导面。

**建议**：与 `L0/dead-exports.md` 台账合并成一批删；`FILE_OPEN_TOOL_NAMES` 收敛到
`vfs-tool-file-path.ts` 单源。若 `allowedPaths`/`resourceQuota` 确定长期留白，
在字段注释里改成「预留接口，当前恒 undefined」更诚实。

**置信**：confirmed（`git grep` 全仓无生产消费，已排除 `*.test.ts`）

### F-w9-ds2-tool-a-9 | P3 | `builtin/overflow-sink.ts:71-77`

```
const rand4 = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
```

**描述**：落盘文件名 `{tool}-{yyyyMMdd}-{rand4}.{ext}`，随机段只有 16 bit。
同日同工具调用量到几千次时生日碰撞不可忽略，而 `vfs.write` 是 last-write-wins
（无乐观锁，见 `vfs.service.ts:127-132`），撞名即**静默覆盖**先前的溢出正文——
模型随后 `read savedPath` 拿到的是别人的内容，工具无任何报错。

**建议**：随机段扩到 32 bit，或改用 `entry.version` / 内容哈希前缀做后缀（天然去重）。

**置信**：suspected（机制确证；碰撞概率未做蒙特卡洛实测）

### F-w9-ds2-tool-a-10 | P3 | `logic/fs-command.ts:126-151`

```
function formatListEntry(entry: VfsListEntry): string { return `${entry.path}\t${entry.kind}`; }
const tab = line.indexOf("\t");   // 再把字符串切回对象
```

**描述**：`ls` 输出先把 entry 序列化成 `path\tkind` 字符串过字节预算，再按
**第一个** tab 切回 `{path, kind}`。含 tab 的路径会被切错（kind 取到路径中段）。
新建条目被 `assertValidVfsEntryName` 拒控制字符（`domain/vfs/logic/validate-entry-name.ts:42`），
但该校验**只拦新建/改名**，zip/角色卡导入链路的存量条目可带 tab
（`validate-entry-name.ts:28-29` 明写导入不走本校验）。同时这是本域唯一的
「结构化数据→字符串→结构化数据」往返，纯属自找的解析面。

**建议**：直接对 `VfsListEntry[]` 做字节累计（复用 `capUtf8Bytes` 的思路但传入
`formatListEntry` 后的定长估算），或按 `entry.kind` 直接 `slice` 原始 entry，不经字符串。

**置信**：suspected（切错机制确证；含 tab 的存量条目是否存在取决于用户导入历史）

### F-w9-ds2-tool-a-11 | P3 | `builtin/search/engines/*.ts` 全五家

**描述**：`curl` 有 `CURL_MAX_RESPONSE_BYTES = 10MB` 的 content-length 预检
（`curl-tool.ts:435-450`，防巨响应内存峰值），五个搜索引擎**没有任何响应体上限**——
`bocha.ts:172` / `tavily.ts:148` / `brave.ts:139` / `searxng.ts:110` 直接
`await response.json()`，错误分支的 `response.text()`（`bocha.ts:164` 等）同样无上限。
searxng 的 baseUrl 还是用户自填（`search-config.ts:68-82` 只校验协议与 userinfo），
指向自托管实例时响应体大小完全由对端决定。

**建议**：search 侧复用 curl 的预检思路（`CURL_MAX_RESPONSE_BYTES` 可直接提为共享常量）。

**置信**：confirmed

### F-w9-ds2-tool-a-12 | P3 | `builtin/search/search-tool.ts:145-161` vs `search/types.ts:84-88`

**描述**：`SearchToolOptions` 定义了 `recencyFilter` / `domainFilter`，五个适配器也
认真实现了双保险（`buildBraveQuery` `site:`/`NOT site:` + 客户端 `matchesDomainFilters`、
`mapDomainFilter` 的 tavily 服务端参数、bocha `mapFreshness`），但工具 schema 只开
`query`/`maxResults`/`engine`，`run` 里也只传 `{ maxResults }`（`search-tool.ts:208`）。
即约 150 行域名过滤与新鲜度映射代码在生产**不可达**，只有单测覆盖。

**建议**：要么在 schema 开放这两个入参（UI 侧已有 recency 概念，值得确认产品意图），
要么连同 `SearchRecency` 一起从生产面摘掉、仅留测试专用，避免被后人当「已支持」依赖。

**置信**：confirmed

### F-w9-ds2-tool-a-13 | P3 | `builtin/builtin-tool-context.ts:175-179`（文档已声明，仍记账）

```
/** 可选：`write` 成功后 upsert `file_cache` `full:{path}`。
 *  `edit` / delete / rename / move **不**读写此字段。 */
```

**描述**：整文件 write 会 upsert file_cache（RULE 记载 `loadOrFillFileCache` 命中
无条件返回、无 mtime 校验），而 `edit` 改完正文后**不刷新**缓存。跨回合看，
被 `edit` 改过的文件在 file_cache 里留的是旧正文，下一回合拼 workplace 前缀时
可能喂给模型过期内容。是刻意的还是漏项，注释只说了「edit 不碰」没说后果。

**建议**：明确拍板「edit 后是否刷新 file_cache」；若不刷，在注释里补一句
「故 edit 过的文件在前缀里可能显示改前正文」，让后续排查有据可依。

**置信**：suspected（代码行为确证；是否可观测取决于 RULE 记载的前缀冻结窗口，未在本 zone 复核）

### F-w9-ds2-tool-a-14 | P3 | `builtin/curl-tool.ts:454-469`

```
return { ..., body: binaryBytes != null ? `[binary content, ${binaryBytes} bytes…]` : `[binary content, unknown size…]`, truncated: false, originalBytes: binaryBytes ?? 0 };
```

**描述**：非文本响应缺 content-length 时 `originalBytes` 记 `0`，
`build-tool-result-block.ts:219` 的摘要会渲染成 `200 · 0B`——一个自称精确的
体积数字实为「未知」。旁证：`formatSearchOutput` 的「未配置提示」是纯字符串
（非 record），`summarizeToolSuccess` 的 isRecord 门（`:71-73`）已处理这种「无记录」，
说明作者在意这类口径，但体积这条漏了 UNKNOWN 表达。

**建议**：`originalBytes` 改 `number | null`（schema 与摘要同步）或缺 content-length 时
把 body 占位改成「unknown size」并在摘要走另一分支。

**置信**：confirmed

### F-w9-ds2-tool-a-15 | P3 | `builtin/agent-tool.ts:175-190`

```
for (const id of await registry.listAgentIds()) { const wire = await registry.getRawWire(id); ... }
```

**描述**：`update` 按 name 定位时逐个 `getRawWire` 线性扫全部 agent（N 次 KKV/DB 读，
串行 await），而同一文件的 `get` 按 name 走 `registry.list()` 一次拿全量（`:362`）。
同一能力两种实现、两种代价，且 `update` 是模型高频动作。

**建议**：`findAgentIdByName` 改走 `list()`（虚拟 seed 需照 `get` 的方式排除），
或在 registry 端口加 `findIdByName` 索引查询。

**置信**：confirmed

## 争议与存疑

1. **F-2（path 白名单）接线与否属产品决策**。三处 `allowedPaths: undefined` 是
   显式写死而非遗漏（注释说「三端目前都走这个语义」），但 `..` 绕过与字段抽取不全
   是客观事实。若上层认为「VFS 是沙箱、路径越不出工作区、这把闸本来就不承重」，
   则应直接删而非接线——**两种处置都合理，但当前形态（留着半成品 + 注释宣称是
   「第二道闸」）最容易误导后来者**，这是本条真正想说的话。
2. **F-5 的中止延迟上界未实证**。我只确认了「域内 ctx 无 signal、runParallel 无取消入口、
   abort 只在批次前后检查」这三件事都在本 zone 内；runner 侧 `:802-890` 是否有
   额外的 per-call 兜底（比如 run 级 watchdog）不在本 zone，未核。
3. **F-13（edit 不刷 file_cache）可能是有意的性能取舍**。write 整文件覆盖后缓存必失效，
   故必须刷；edit 频繁且是小改，若每次都刷会把前缀缓存打穿。这个理由成立，
   但**后果（模型可能看到改前正文）**在代码与 RULE 里都没有被记下来。
4. **curl 不做 SSRF 拦截**（`curl-tool.ts:24-26` 明写「用户拍板：简单搞、参考 curl」）
   与 search 同样口径（`search/types.ts:16`），**按 intentional 处理，不报为问题**。
   提醒后续波次别重复报这条。
5. **`fs rm` 不带 `-r` 自动递归删目录**（`fs-command.ts:154-155`）已在工具 description
   里对模型明写，**属既定对外契约，不报**。但它与 checkpoint 的关系值得上层留意：
   `toolUseMutatesWorkspace` 判 fs 突变即进 checkpoint，一次误用 `rm` 会把整棵子树纳入回滚点。
6. **`skill edit` 强制显式 domain**（`skill-tool.ts:149-152`）注释里记了真实事故
   （「全局技能被当成项目技能，报 Path not found」），是有意收紧，**不报**。

## 附：自查中被探针**证伪**的假设（留痕，避免他机位重复踩）

- 「`skill read` 单行超 50KB 时 `nextOffset` 丢失导致分页卡死」——**不成立**。
  `skill-tool.ts:431` 先 `truncateLine`（单行压到 2000 字符）再 `capUtf8Bytes`，
  50KB 预算下必有首行入选，`returnedLines === 0` 不可达；实跑 `nextOffset=26` 正确。
- 「`agent` 工具 list 走 `isFsLsOutput`」——**成立**，即 F-1，勿当重复项。
