---
zone: w9-ds2-tool-b
agent: domain-survey（独立双扫 B）
files_scanned: 28
---

# w9-ds2-tool-b —— packages/core/src/domain/tool/ 全量测绘

> 独立双扫 B 席。**未读取 `raw/` 与 `synth/` 下任何文件**（协议 §6 对抗纪律），
> 结论全部由本席直读 `packages/core/src/domain/tool/**` + 定向读消费方 + `tsx`
> 实测探针重新推导。决策感知只读 `docs/apm/RULE.md` 与 `docs/Iterations/**`
> （排除 `repo-mega-cr-2026-10/raw|synth`）。

## 摘要

LLM 工具域。26 个生产文件分三层：`model/tool.ts` 定义协议无关的 `Tool`
契约（name / description(ctx) / zod inputSchema / 可选 outputSchema / run）；
`logic/` 是纯逻辑层——注册表、执行器、错误归一、fs 命令解析、输出预算、
LLM 文本渲染、路径白名单、突变分类；`builtin/` 是 11 个内置工具实现
（read/write/edit/fs/glob/grep + task/skill/agent/curl/search）与运行上下文
`BuiltinToolContext`。本域不直接触碰任何表 / KKV 域，只经 `ctx.vfs` /
`ctx.sessionKkv` / `ctx.workplace` / `ctx.skills` / `ctx.agents` 四个注入闭包
间接落到 VFS 与 session KKV。

## 职责与边界

- **契约层**（`model/tool.ts`）：`Tool<Input, Output, Ctx>`。`description` 是
  `(ctx) => string` 而非 string，装配期由 `toolsFromRegistry` 求值。
- **执行层**（`logic/tool-registry.ts`、`logic/tool-runner.ts`）：注册表拒绝重名
  （CONFLICT）；runner 做 input zod 校验 → path 白名单二校 → `run` → output
  zod 校验，异常统一包成 `ToolError`；`runParallel` 带同 path 串行化。
- **分类层**（`logic/fs-command-classify.ts`、`logic/tool-use-mutates-workspace.ts`、
  `domain/vfs/logic/extract-mutating-paths.ts`）：单一真源，被 checkpoint 与
  runner 路径串行化共用。
- **预算层**（`logic/tool-output-limits.ts`）：50KB / 2000 行 / 2000 字符
  单行 / 100 命中的四档上限与三种截断原语。
- **渲染层**（`logic/format-tool-output.ts`、`logic/build-tool-result-block.ts`）：
  工具输出 → LLM 文本 / 持久化 `ToolResultBlock`。
- **边界**：不碰 DB、不做鉴权、不管 provider 协议（`toolsFromRegistry` 在
  `infra/llm-protocol/`）；工具可见性策略在 `domain/agent/logic/`。

## 对外接口

| 符号 | 文件 | 说明 |
|---|---|---|
| `Tool<Input,Output,Ctx>` | `model/tool.ts:17` | 工具契约 |
| `ToolRegistry` | `logic/tool-registry.ts:16` | 内存注册表（`register` 重名抛 CONFLICT） |
| `ToolRunner.call` / `.runParallel` | `logic/tool-runner.ts:82,134` | 唯一执行入口 |
| `ParallelToolOutcome` | `logic/tool-runner.ts:26` | 并行结果（错误不抛，捕获进 outcome） |
| `registerBuiltinTools` | `builtin/register-builtin-tools.ts:31` | 注册 11 个内置工具 |
| `createVfsTools` / `FILE_TOOL_NAMES` | `builtin/vfs-tools.ts:114,39` | 6 个文件工具 |
| `isMutatingFileToolName` | `builtin/vfs-tools.ts:61` | checkpoint 突变判定 |
| `subagentTool` / `skillTool` / `agentTool` / `curlTool` / `searchTool` | `builtin/*` | 5 个静态工具实例 |
| `BuiltinToolContext` | `builtin/builtin-tool-context.ts:169` | 工具运行上下文（8 个可选闭包） |
| `buildToolResultBlock` / `resolveToolResultOk` | `logic/build-tool-result-block.ts:248,41` | 落库块构造 |
| `formatToolOutputForLlm` / `formatToolErrorForLlm` | `logic/format-tool-output.ts:352,414` | LLM 文本渲染 |
| `checkToolPathPolicy` | `logic/tool-path-policy.ts:127` | A-14 路径二校 |
| `classifyMutatingToolCall` | `logic/fs-command-classify.ts:111` | 突变分类单源 |
| `capUtf8Bytes` / `capUtf8BytesFill` / `capMatchList` / `sliceLinesFromOffset` | `logic/tool-output-limits.ts` | 截断原语 |
| `createSearchConfigStore` / `resolveEngineChain` | `builtin/search/search-config.ts:244,182` | 搜索配置（SKSP + KKV） |
| `sinkOversizedOutput` | `builtin/overflow-sink.ts:85` | 超预算落盘 `/tmp/` |
| `resolveVfsToolFilePath` / `resolveSubagentSessionId` | `logic/vfs-tool-file-path.ts:21` / `logic/subagent-tool-session-id.ts:21` | UI 卡片跳转解析 |

包级再导出见 `packages/core/src/index.ts:178-257` 与 `src/public/chat.ts:324`。

## 数据访问

本域**不直接**访问表 / KKV / 文件；全部经注入端口：

| 目标 | 经由 | 证据 |
|---|---|---|
| VFS 读写列/glob/grep/删/建目录 | `ctx.vfs: VfsService`（→ `ScopedVfsService` 归一化 + scope 断言） | `builtin-tool-context.ts:170`；`service/vfs/impl/scoped-vfs.service.ts:58-130` |
| KKV 域 `file_cache` | `ctx.sessionKkv.set(sessionId, "file_cache", fileCacheKey("full", path), …)` | `builtin/vfs-tools.ts:549-565`；键格式 `domain/session-kkv/model/session-kkv-domains.ts:139` |
| KKV 模块 `nm-search` | 经 `createSearchConfigStore(kkv, secretStore)` | `builtin/search/search-config.ts:29,89,277` |
| SKSP ref `search/{engineId}/apiKey` | `secretStore.get/set/delete` | `builtin/search/search-config.ts:41,209,260` |
| 表 `workplace_dir_rule` | 经 `ctx.workplace.listDirRules/setDirRule` | `builtin/vfs-tools.ts:631-639`；注入 `service/agent/logic/run-agent-turn.ts:855` |
| 会话 VFS `/tmp/` 落盘 | `ctx.vfs.write("/tmp/{tool}-{yyyyMMdd}-{rand4}.{ext}")` | `builtin/overflow-sink.ts:72-90` |
| agent registry | `ctx.agents.registry` / `ctx.subagent.agentRegistry` | `builtin/agent-tool.ts:216`、`builtin/subagent-tool.ts:182` |
| 技能域 | `ctx.skills.service`（SkillService，不直接持 vfs） | `builtin/skill-tool.ts:354` |

**写路径副作用**：`write` 工具成功 → upsert `file_cache` + （仅新建文件）补父链
目录规则；`fs mkdir` 成功 → 补目录规则；`curl`/`search` 超 50KB → 落盘
`/tmp/` + upsert `file_cache` + 补 `/tmp` 目录规则。

## 依赖关系

**import 了谁**（生产代码，去重）：

- `@/errors/tool-errors`、`@/errors/vfs-errors`、`@/errors/agent-config-errors`
- `@/domain/vfs/logic/*`：`vfs-path-mapper`、`vfs-copy`、`vfs-move`
- `@/domain/vfs/ports/vfs-service.port`
- `@/domain/skills/logic/skill-paths`（`SKILLS_ROOT` / `resolveSkillRelPathCore`）
- `@/domain/session-kkv/model/session-kkv-domains`、`@/domain/workplace/logic/rule-snapshot-codec`
- `@/service/vfs/logic/ensure-import-dir-rules`（`backfillMissingDirRules`）
- `@/service/*/…port`（全部 `import type`，无运行时耦合）
- `@/infra/tdbc/index`（`TdbcError`，仅 `format-tool-output.ts:11`）
- zod

> 注：`domain/tool/builtin/*` **import 了 service 层**（`@/service/vfs/logic/…`、
> `@/service/skills/skills.port` 等），方向与「domain 不依赖 service」的常见
> 分层约定相反。当前全部是纯函数或 `import type`，无循环依赖
> （`L0/circular-core.json` 为 `[]` 实测确认），但架构上是需要 reduce 席
> 裁决的分层疑点。

**被谁消费**（生产代码 17 处，测试另 28 个文件）：

| 消费方 | 用什么 |
|---|---|
| `service/agent/logic/run-agent-turn.ts:847,1200` | 装配 `BuiltinToolContext`（两处：主 agent / 子 agent） |
| `service/agent/impl/agent-runner.ts:273` | `toolsFromRegistry(registry, toolCtx)` |
| `service/agent/logic/assemble-agent-runner-deps.ts`、`create-agent-runner.ts` | registry / runner 注入 |
| `service/chat/impl/user-vfs-turn.service.ts`、`create-user-vfs-turn-service.ts:67` | 另一套 ctx 装配 |
| `domain/agent/logic/resolve-agent-tool-registry.ts:7` | `normalizeAgentToolPolicyName` + `ToolRegistry` |
| `domain/agent/logic/validate-agent-tool-policy.ts` | 工具名策略校验 |
| `domain/vfs/logic/extract-mutating-paths.ts:7` | `classifyMutatingToolCall` |
| `domain/chat/logic/skill-tool-ref.ts` | skill 输出 → `ToolResultBlock.meta.skillRef` |
| `domain/chat/content/message-body-text.ts` | 工具结果正文渲染 |
| `domain/chat/logic/prepare-user-messages-for-prompt.ts` | 提示词内工具块 |
| `infra/llm-protocol/logic/tool-definitions.ts:17` | `toolsFromRegistry` 定义 |
| `service/session-kkv/*`、`service/workplace/*` | `fileCacheKey` 等共享常量 |
| `src/index.ts`、`src/public/chat.ts`、`src/public/session-kkv.ts`、`src/public/workplace.ts` | 对外导出 |

## 发现清单

### F-w9-ds2-tool-b-1 | P1 | `logic/format-tool-output.ts:152`

```
function isFsLsOutput(rec: Record<string, unknown>): boolean {
  return Array.isArray(rec.entries) && typeof rec.total === "number";
}
```

**描述**：`isFsLsOutput` 的守卫只认「`entries` 是数组 + `total` 是数字」，
不校验 `entries` 元素的形状。`skill` 与 `agent` 两个工具的 `list` 动作输出
恰好也是这个外层形状（`{action:"list", entries:[…], total}`），元素字段是
`name/description/domain/valid` 或 `name/description/mode`，**没有** `path` /
`kind`。`formatToolOutputForLlm` 的分派顺序里 `isFsLsOutput`（`:364`）排在
`isSkillLoadOutput`（`:384`）之前，于是 `skill list` / `agent list` 掉进
`formatFsLsOutput`，渲染成 `undefined\tundefined`。

**实测**（`tmp/w9ds2b-fmt.mts`，core tsconfig + tsx，已删）：

```
skill list -> "undefined\tundefined\nundefined\tundefined"
agent list -> "undefined\tundefined\nundefined\tundefined"
agent list(truncated) -> "undefined\tundefined\n\nOutput truncated (0 entries omitted; total 1)."
```

**影响**：`skill list` 与 `agent list` 是这两个工具**唯一的发现入口**
（`skill` 的 description 里就写着「load 装载技能」，模型先 list 再 load；
`agent` 的 description 同样引导 list）。模型拿到的是全篇 `undefined`，
等于这两个工具的 list 动作对 LLM 完全不可用。UI 侧看不出问题——
`build-tool-result-block.ts:151,160` 的 `summarizeToolSuccess` 有独立的
`skill`/`agent` list 分支，摘要会正确显示「N skills」，只有送给 LLM 的
`content` 是坏的。这种「摘要对、正文坏」的分裂正是它能活到今天的原因。

**建议**：给 `isFsLsOutput` 加元素形状门（`entries[0].path` 是 string 且
`kind` ∈ {file, directory}），或在 `formatToolOutputForLlm` 里把
`rec.action === "list"` 的分支提到 `isFsLsOutput` 之前显式处理。
同时补两条断言：格式化 `skill list` / `agent list` 输出必须含技能名 /
agent 名，且不含 `undefined`。

**置信**：confirmed（源码 + 实测双向确认）

---

### F-w9-ds2-tool-b-2 | P2 | `builtin/skill-tool.ts:431`

```
const truncatedLines = slice.map((line) => truncateLine(line).line);
const byteCapped = capUtf8Bytes(truncatedLines);
const truncated =
  byteCapped.truncated || returnedLines < slice.length ||
  (lineNextOffset != null && returnedLines >= limit);
```

**描述**：`skill read` 先用 `truncateLine`（上限
`TOOL_OUTPUT_MAX_LINE_LENGTH = 2000`）把每一行砍到 2000 字符并追加
`... (line truncated to 2000 chars)` 后缀，但 `truncated` 标志**只**由
字节预算（`capUtf8Bytes`）与行数分页决定。单行超长时（minified JSON、
无换行 HTML、base64 块——`read` 工具专门为这种场景做了
`capUtf8BytesFill`，`tool-output-limits.ts:135-144` 的注释明说「read 场景
单行可以是几百 KB，整行丢弃会一行都留不下」），`skill read` 会把内容悄悄
砍掉却报 `truncated: false` 且不给 `nextOffset`。

**实测**（3 行 × 5000 字符的 SKILL.md）：

```
truncated: false  returnedLines: 3  totalLines: 3
content has truncation suffix: true
nextOffset: undefined
```

即：正文里带着「被砍过」的痕迹，结构化字段却说「完整」，也没有续读指引
——模型无从判断自己拿到的是不是全文。

**建议**：把 `truncateLine` 造成的行内截断计入 `truncated`（用一个
`some(l => l.length > MAX)` 或让 `truncateLine` 的 `truncated` 返回值参与
聚合），并在这种情况下也提示「用 `skill read` 的 offset/limit 续读」——
虽然行内截断确实无法用 offset 续读，至少要让 `truncated` 如实为 true。
更彻底的做法是让 skill read 也走 `capUtf8BytesFill` 口径（与 `read` 对齐）。

**置信**：confirmed（源码 + 实测）

---

### F-w9-ds2-tool-b-3 | P2 | `logic/tool-path-policy.ts:43`

```
export function pathStartsWithPrefix(path: string, prefix: string): boolean {
  ...
  return (
    path.startsWith(normalizedPrefix + "/") ||
    path.startsWith(normalizedPrefix + "\\")
  );
}
```

**描述**：前缀比对是纯字符串比较，**不做 `..` 归一**。`allowedPaths =
["src/"]` 时 `src/../../etc/passwd` 以 `src/` 开头 → 判定放行；实际落到
VFS 时 `ScopedVfsService.read/write` 走 `resolveLogicalPath` →
`normalizePath` 把 `..` 消化掉，真实访问的是 `/etc/passwd`。这是 A-14
白名单的标准前缀绕过。

同一层还有两个覆盖缺口：

1. `PATH_FIELDS = ["path","filePath","from","to"]`（`:17`）**不含**
   `glob` 的 `options.cwd` 与 `grep` 的 `options.pathPrefix`。
   实测：`{pattern:"*", options:{cwd:"../../"}}` 与
   `{pattern:"x", options:{pathPrefix:"../../etc"}}` 在
   `allowedPaths:["src/"]` 下都返回 `null`（放行）。
2. `filePath` 字段名在本仓**没有任何工具使用**（`vfs-tool-file-path.ts:29`
   提到某些 LLM 会误用 `file_path`，但那是 UI 侧兜底、不是 schema 字段），
   属于为不存在的字段预留的守卫位。

**当前实际风险**：三端装配点全部硬写 `allowedPaths: undefined`
（`run-agent-turn.ts:926,1276`、`create-user-vfs-turn-service.ts:78`），
`readAllowedPaths` 因此恒返回 `undefined`，整条策略是**关闭态**。所以这是
潜伏缺陷，不是现网事故——但 `tool-path-policy.ts:9-11` 与
`builtin-tool-context.ts:190-191` 都写着「后续可以收紧到具体白名单」，
一旦有人按注释把它打开，这三条同时变成可利用的绕过。

**建议**：`checkToolPathPolicy` 里先对每个候选路径跑
`resolveLogicalPath`（复用 vfs 域单源，勿另写一份归一），再比对前缀；
`glob.options.cwd` / `grep.options.pathPrefix` 纳入 `PATH_FIELDS`（需要
改成能读嵌套字段的抽取）；或者在真正启用前先把这条注释改成
「未验证，禁止直接打开」的显式警告。

**置信**：confirmed（绕过本身实测确认；「当前不可利用」也已实测确认
——`readAllowedPaths({})` 返回 undefined）

---

### F-w9-ds2-tool-b-4 | P2 | `logic/tool-path-policy.ts:17`（对照 `builtin/skill-tool.ts:270`）

**描述**：`PATH_FIELDS` 无差别地把 `path` 当作「工作区绝对路径」校验，
但 `skill` 工具的 `path` 语义完全不同——它是**技能目录内的相对路径**
（`domain/skills/logic/skill-paths.ts:34-53`，拼成
`/meta/skills/{name}/{path}`），压根不在会话工作区里。

后果是双向错的：一旦 `allowedPaths` 被打开（例如 `["src/"]`），
`{action:"read", name:"x", path:"SKILL.md"}` 会因 `"SKILL.md"` 不在
`src/` 下而被拒（FORBIDDEN）——**所有 skill 调用全灭**；反过来
`{action:"read", name:"x", path:"../../y"}` 这种真正需要 `skill-paths`
那一层去拦截的输入，path policy 只会因为「不以 src/ 开头」而误报，
拦截理由还答非所问（报告的是工作区越界，不是技能路径非法）。

实测：`{action:"read", name:"s", path:"../../x"}` 在
`allowedPaths:["src/"]` 下返回 `"../../x"`（判定越界），语义正确纯属
巧合——换个 allowedPaths（如 `["/"]`）就会放行，而真正该拦它的
`resolveSkillRelPathCore` 在 tool 层根本没被 path policy 触达。

**建议**：path policy 抽路径时按工具名分流（`skill` 的 `path` 走
skill 域解析或直接跳过），别让工作区白名单去管 meta 域路径。

**置信**：suspected（逻辑推导充分，未在「allowedPaths 已启用」的假想
生产态下端到端复现——该态当前不可达）

---

### F-w9-ds2-tool-b-5 | P2 | `builtin/skill-tool.ts:170`

```
for (const field of SKILL_ACTION_REQUIRED_FIELDS[input.action] ?? []) {
  const value = input[field];
  if (value === undefined || value === "") {
    ctx.addIssue({ ... });
  }
}
```

**描述**：`superRefine` 的必填判定把「空串」与「未提供」等同，但
`content` 与 `newString` 的**合法值域包含空串**：

- `skill write` 的 `content: ""`（写一个空 SKILL.md，或清空既有技能）
  被拒，报「必须提供整文件内容 content」；
- `skill edit` 的 `newString: ""`（**删除匹配文本**——这是 edit 最常见的
  语义之一）被拒，报「必须提供替换串 newString」。

对比同域的 `edit` 文件工具（`vfs-tools.ts:299-303`）`newString` 就是
普通 `z.string()`，允许空串，删除匹配完全合法——两处口径不一致。

**实测**：

```
skill write content:'' -> false
  issues: [ 'skill 的 write 动作必须提供整文件内容 content' ]
skill edit newString:'' -> false
  issues: [ 'skill 的 edit 动作必须提供替换串 newString' ]
```

**影响**：模型想「把这段删掉」时会被反复打回，且错误文案（"必须提供"）
与它已经提供了 `newString: ""` 的事实矛盾，容易陷入重试循环。

**建议**：必填判定改为只看 `undefined`（`name` 这类标识字段可另行保留
空串拒绝，因为空技能名无意义）；或按字段区分
`REQUIRED_FIELDS`（name/content/oldString/newString/domain）与
`NON_EMPTY_FIELDS`（name/domain）。

**置信**：confirmed（源码 + 实测）

---

### F-w9-ds2-tool-b-6 | P2 | `builtin/vfs-tools.ts:169`

```
if (offset > 1 && totalLines === 0) {
  throw new ToolError("INVALID_ARGUMENT", `offset ${offset} exceeds file length (0 lines)`, …);
}
```

**描述**：`totalLines = raw.content.split("\n").length`，而
`"".split("\n").length === 1`（实测），所以 `totalLines === 0`
**永不可达**，这条分支是死代码。它想表达的「空文件 + offset>1 报错」
实际由下一条 `totalLines > 0 && offset > totalLines` 覆盖——而那条在
`offset=2` 时因 `totalLines===1` 同样会抛，只是错误文案说的是
「exceeds file length (1 lines)」而不是「(0 lines)」。

对照 `skill read`（`skill-tool.ts:419`）只写了后一条，说明这处是
历史残留。死代码本身危害小，但它让「空文件」这条边界的真实行为
（报错文案说 1 行、实际是 0 行内容）看起来像有意设计。

**建议**：删掉不可达分支，或把 `totalLines` 定义改成
`content.length === 0 ? 0 : split(...).length` 让两处对齐。

**置信**：confirmed（`""` split 行为已实测）

---

### F-w9-ds2-tool-b-7 | P2 | `builtin/vfs-tools.ts:563`

```
serializeFileCachePayload({ body: content, mtimeMs: Date.now() })
```

**描述**：`write` 成功后 upsert `file_cache` 时，`mtimeMs` 填的是
**本地时钟 `Date.now()`**，不是 VFS 里这条 revision 的真实 mtime
（`ctx.vfs.write` 的返回类型只有 `{ version: number }`，拿不到 mtime，
见 `domain/vfs/ports/vfs-service.port.ts:62`）。而 `file_cache` 载荷的
`mtimeMs` 有真实消费方：`service/workplace/assemble-workplace-display.ts:191`
把它交给 `renderFileBlock` 渲染成工作区前缀里的时间戳，
同文件 `:200` 还把它拼进前缀指纹串（`${path}|${status}|${mtimeMs}|${len}`）。

对比 `loadOrFillFileCache` 的回填路径（`domain/workplace/logic/load-or-fill-file-cache.ts:219`）
写的是 `result.mtimeMs`（VFS 真值）。于是同一个文件，**经工具写过**和
**经读盘回填过**会在前缀里显示不同的时间戳，指纹也会因此在两条路径间
抖动（下游记忆/指纹估读会判为「内容变了」）。设备时钟与 VFS mtime
（通常也是 `Date.now()`，但跨时区/时钟回拨/迁移导入的树复制会不等）
一旦不一致就会暴露。

**建议**：让 `VfsService.write` 的返回类型带上 `mtimeMs`（或在
`upsertFileCacheAfterWrite` 里额外 `await ctx.vfs.read(path)` 取真值——
注意 read 有成本，更推荐前者），使两条写入路径口径一致。

**置信**：suspected（口径分裂已核实；「指纹因此抖动」是推导，未构造
时钟偏移实测）

---

### F-w9-ds2-tool-b-8 | P3 | `builtin/vfs-tools.ts:69` 与 `logic/vfs-tool-file-path.ts:10`

```
// vfs-tools.ts:69（导出到 index.ts:195）
export const FILE_OPEN_TOOL_NAMES = new Set<FileToolName>(["read","write","edit"]);

// vfs-tool-file-path.ts:10（模块私有）
const FILE_OPEN_TOOL_NAMES = new Set(["read", "write", "edit"]);
```

**描述**：同一语义（哪些工具的结果能在工作区里打开文件）有两份
独立定义，一份导出、一份私有。`L0/dead-exports.md:978` 已把导出那份
标为「零消费」——因为 `vfs-tool-file-path.ts` 用的是自己那份私有副本。
将来往集合里加工具名（例如加 `skill`），只改一处就会让 UI 的
「打开文件」门控与实际能力脱节。

**建议**：`vfs-tool-file-path.ts` 改为 import 导出那份（它是
`index.ts` 的公开面，语义上就是这份的单一真源），删掉私有副本。

**置信**：confirmed

---

### F-w9-ds2-tool-b-9 | P3 | `builtin/builtin-tool-context.ts:180`

```
  readonly sessionKkv?: SessionKkvService;
  /**
  /**
   * 可选：VFS 内允许访问的路径前缀白名单（A-14 path policy）。
```

**描述**：连续两个 `/**`，第二个 JSDoc 块被并入前一个未闭合的块注释里。
结果：`allowedPaths`（`:193`）实际挂的是从 `:180` 起的那段注释，
而 `sessionKkv`（`:179`）的 JSDoc 被吞掉。编辑器/TSDoc 里
`allowedPaths` 的文档归属错位，且 `sessionKkv` 的说明
（"edit / delete / rename / move **不**读写此字段"，这是本域重要语义）
从 API 表面消失。纯注释缺陷，但恰好丢的是一条有信息量的约束。

**建议**：删掉多余的 `/**`（`:181`）。

**置信**：confirmed

---

### F-w9-ds2-tool-b-10 | P3 | `builtin/overflow-sink.ts:73`

```
const rand4 = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
return `${OVERFLOW_SINK_DIR}/${tool}-${localDateStamp(new Date())}-${rand4}.${ext}`;
```

**描述**：落盘文件名由「工具名 + 本地日期 + 4 位十六进制随机」组成。
同一毫秒内对同一工具发起两次超预算输出（`curl` 同一 step 并行两次是
完全合法的——`curl` 不在突变名单里，`runParallel` 会并发），撞名概率
1/65536。撞上时 `ctx.vfs.write` 是 last-write-wins（无版本校验，
`vfs-tools.ts:250-252` 明写），先落的那份正文被静默覆盖，而它的
`savedPath` 已经回给了模型——模型 `read` 到的会是另一份内容。

概率极低（且需要同毫秒同工具），但 `read` 那侧已经有
`capUtf8BytesFill` 这类「宁可少给也不误导」的仔细设计，这里属于
同一类严谨度缺口。

**建议**：随机后缀加长到 8 位，或在文件名里掺入 tool-call id
（`buildToolResultBlock` 手上就有 `toolUseId`）。

**置信**：suspected（推导，未构造碰撞实测）

---

### F-w9-ds2-tool-b-11 | P3 | `builtin/search/search-tool.ts:220`

```
if (Date.now() - startedAt >= SEARCH_CHAIN_BUDGET_MS) { … }
```

**描述**：`SEARCH_CHAIN_BUDGET_MS = 120_000` 被文档描述为「串行链
总预算」，但检查点只在**每次引擎尝试之前**。单引擎超时上界是 60s
（`BOCHA_TIMEOUT_MS` / `TAVILY_TIMEOUT_MS`，`searxng`/`brave`/`ddg` 各 30s），
所以最坏路径 60 + 60 + 30 + 30 + 30 = 210s；即便只走两引擎，
60s + 60s 也已经贴着 120s，最后一次尝试仍可把总时长推到 ~180s。
`abort` 只在预算检查点生效，不会中断进行中的引擎请求。

也就是说「120s 硬上限」实际是「120s 软上限 + 单次引擎超时」。文件头
`:15-16` 的措辞（「链总预算 120s（每引擎尝试前检查剩余额度，耗尽带已
收集错误返回）」）如实描述了机制，但工具 description（`:144`）里对
模型说的是「串行链总预算 120s」，模型会据此规划等待。

**建议**：要么把单引擎超时压到 `min(引擎超时, 剩余预算)`，要么把
description 的措辞改成「约 120s（不含单次引擎超时）」。

**置信**：confirmed（算术推导，五个超时常量均已读）

---

### F-w9-ds2-tool-b-12 | P3 | `builtin/agent-tool.ts:361` vs `:411`

```
// get：走 registry.list()（含虚拟 seed general），一次拉全表
const defs = await agentsCtx.registry.list();
const def = defs.find((d) => d.name === targetName);

// update：走 listAgentIds() + getRawWire 逐个读线（N 次 IO）
for (const id of await registry.listAgentIds()) {
  const wire = await registry.getRawWire(id);
  …
}
```

**描述**：`get` 与 `update` 都宣称「name 优先」，但定位实现是两套：
`get` 走解码后的 `list()`（含虚拟 `general`），`update` 只能走
`listAgentIds()` + `getRawWire`（虚拟 `general` 无持久化 id，
只能靠 `agentsCtx.agents` 快照兜底报错，见 `:419-425`）。
后果有二：① 两条路径对「什么算同名」的判定不同源
（`get` 比解码值、`update` 比 wire 原值），一个 wire 脏数据行
（name 带空白）会让 `get` 找得到、`update` 找不到，反之亦然；
② `update` 的定位是 O(n) 次串行 IO，agent 定义多了会明显变慢
（`list()` 是一次调用）。

**建议**：抽一个 `resolveAgentIdByName(agentsCtx, name)` 单源，
`get` / `update` 共用；或让 `AgentRegistryService` 直接提供
`findIdByName`。

**置信**：confirmed

---

### F-w9-ds2-tool-b-13 | P3 | `logic/tool-output-limits.ts:209`

```
if (bytesUsed + separatorBytes + lineBytes > TOOL_OUTPUT_MAX_BYTES) {
```

**描述**：`capMatchList` 的字节预算硬编码 `TOOL_OUTPUT_MAX_BYTES`，
不像同文件的 `capUtf8Bytes` / `capUtf8BytesFill` 那样接受
`maxBytes` 参数——`maxItems` 可传而字节上限不可传，签名不对称。
当前三个调用方（`glob` / `grep` / `agent list`）都用默认 50KB，
所以无实际影响；但这让「给 agent list 单独放宽/收紧字节预算」这类
需求必须改函数签名而不是改调用点。

顺带：`capMatchList` 的 `formatItem` 会被调用两次语义（一次算字节、
一次由调用方自己序列化），`grep` 传的是 `JSON.stringify(m)`
（`vfs-tools.ts:529`），而最终 LLM 文本走的是
`formatGrepOutput` 的 `path:line:col: excerpt`——两者长度不同，
字节预算与实际输出量存在系统性偏差（JSON 形态更长，实际会更宽松）。
不构成 bug，但预算不是「实际输出」的精确上界。

**建议**：`capMatchList` 加 `maxBytes` 参数；`formatItem` 的口径与
最终渲染口径对齐（或在注释里写明这是「保守估算」）。

**置信**：confirmed

---

### F-w9-ds2-tool-b-14 | P3 | `logic/tool-runner.ts:100`

```
const disallowedPath = checkToolPathPolicy(parsedIn.data, ctx);
```

**描述**：`checkToolPathPolicy` 用 `extractInputPaths` 从**已解析的
zod 输出**（`parsedIn.data`）抽路径，而不是原始 `input`。这是对的
（zod 会做 `.trim()` 之类的变换，用原始值会与工具实际收到的值不一致），
但配合 F-3 看有两层含义：一是 F-3 描述的 `..` 绕过依然成立
（zod 的 `path: z.string().min(1)` 不做归一）；二是 F-4 提到的
`skill` 域路径污染也源于同一处抽取逻辑。

另外 `path policy` 抛的是 `toolPathForbidden`（FORBIDDEN），而
`formatToolErrorForLlm`（`format-tool-output.ts:419-432`）只在
`INVALID_ARGUMENT` 且 `details.issues` 存在时才展开细节，
FORBIDDEN 走 `error.cause != null` 分支——而 `toolPathForbidden`
**不设 cause**（`errors/tool-errors.ts:100-109`），所以落到
`error.message`，文案是 `Tool path outside allowed scope: read -> /x`，
可读。**无缺陷，记录为已核对通过。**

**置信**：confirmed（结论：无缺陷，供 reduce 席免复查）

---

### F-w9-ds2-tool-b-15 | P3 | `builtin/subagent-tool.ts:78`

```
if (callable.length === 0) return "（暂无）";
```

**描述**：`BuiltinToolSubagentContext.callableAgents` 的注释
（`builtin-tool-context.ts:76-77`）承诺「至少含内置 `general`，所以
task 描述始终有内容」。若该承诺因装配缺陷落空（如 `agentRegistry.list()`
在 `runChildAgent` 侧返回空——注意 `description` 读的是**装配期快照**
`callable`，而 `run()` 里是**现查** `agentRegistry.list()`，两者来源
不同），模型会看到「可选的 subagent 如下：（暂无）」，但 `task` 的
inputSchema 并不校验 `subagentName` 是否在名单内，于是模型仍可发起
调用，只在 `run()` 里撞 `:187-198` 的「未找到名为 X 的子代理」。
即：描述与实际可选项不一致，错误延迟到执行期。

**建议**：`callable` 为空时在装配期就抛/降级（不注册 `task`），
或在 `run()` 的 not-found 分支里带上快照名单（当前带的是现查的
`defs`，已经带了，OK）——主要是让描述侧的空态不出现。

**置信**：suspected（装配期快照与现查不一致这一点已核实；「快照为空」
的触发条件未构造）

---

### F-w9-ds2-tool-b-16 | P2 | `builtin/search/search-tool.ts:142`（对照 `search-config.ts:277`）

**描述**：`search` 工具把搜索结果全文落到**会话工作区 VFS 的 `/tmp/`**
（`overflow-sink.ts:31,90`），落盘路径与说明回给模型，模型可经
`read` 分页读回。文档明确说明「子代理经装配链的 `toolCtx.vfs` 天然指向
父会话 VFS（T-SS-3 锁定），落盘即落父会话工作区」
（`overflow-sink.ts:6-8`）——这是**有意设计**，不是缺陷。

但要记一笔的是它的副作用面：一次 `search` 会在用户的**项目工作区**
留下文件（`/tmp/curl-20261001-1f2e.html`、`/tmp/search-….json`），
这些文件会进入 VFS 版本链、参与 checkpoint 与回滚、出现在文件树里
（`/tmp` 目录规则被自动补为启用，`vfs-tools.ts:101` → `ensureDirRulesForNewPath`），
并且**没有清理机制**（`L0/dead-exports.md:299,445` 的 synth 侧也把
overflow-sink 列进过 dead-path 讨论）。长期使用会缓慢堆积。

**建议**：明确 `/tmp/` 的保留策略（会话删除时随 VFS 一起清即可，
还是需要独立 GC），并在工具 description 里告知模型这些文件是临时的。
若产品上不希望它们出现在用户文件树里，考虑把 sink 目录挪到
meta 域（技能那套）或加一条目录规则默认隐藏。

**置信**：intentional（落盘机制本身）+ suspected（堆积无 GC 为事实，
是否算问题取决于产品预期，需 reduce 席裁决）

---

## 争议与存疑

1. **F-3 / F-4 的实际严重度**：`allowedPaths` 在三端全部硬写 `undefined`
   （`run-agent-turn.ts:926,1276`、`create-user-vfs-turn-service.ts:78`，
   已 grep 确认生产代码无第二处赋值），所以路径白名单整条是关闭态。
   我按「潜伏缺陷，注释明确邀请后人打开」记 P2 而非 P0/P1。
   若 reduce 席认为「永不开」的字段应直接删掉而非留着注释 invitation，
   这两条的处置会不一样（删字段 vs 修绕过）。**这一分歧不该由我单方抹平。**

2. **F-7（`mtimeMs: Date.now()`）我没能端到端实测**。已核实的是
   「工具写入口径 ≠ 读盘回填口径」且两者都有真实消费方
   （`assemble-workplace-display.ts:191,200`）；未核实的是
   「设备时钟与 VFS mtime 实际会不等」——需要构造时钟偏移或树复制场景。
   标 suspected 而非 confirmed，请验证代理按此口径复核。

3. **`domain/tool/builtin/*` import service 层**（`@/service/vfs/logic/ensure-import-dir-rules`、
   `@/service/skills/skills.port` 等）违反常见分层。当前无循环依赖
   （`L0/circular-core.json` 实测为 `[]`），且 service 侧引用的多为
   `import type`。我**不把它列为发现**（无实测缺陷），但它是本区
   最可能被后续改动踩成循环依赖的结构性隐患，交给 reduce 席与
   架构台账判断是否单独立项。

4. **F-1 修哪一层存在方案分歧**：我倾向给 `isFsLsOutput` 加元素形状门
   （改动面小、不动既有 fs ls 渲染），但把 `action === "list"` 提前分派
   （语义更显式）同样成立，且后者顺带能修掉 `truncated` 时
   `omitted` 算成 0 的怪文案。两条路我都能想到，没动手。

5. **关于 `L0` 产物的引用纪律**：我读了
   `L0/{coverage-matrix,dead-exports,circular-core}.{csv,md,json}`——
   这些是 L0 确定性工具产物（PLAN §二 定义为独立层），不是
   `raw/`（L1 原始报告）或 `synth/`（L2 分区综合）。本席**未打开
   任何 `raw/*.md` 与 `synth/*.md`**。`docs/Iterations/**` 下的
   历史迭代 spec（`web-search-tool/`、`fetch-tool/`、
   `tool-system-v2/`、`tool-result-block-ok/` 等）按协议 §3
   「决策感知」正常读取，用于判定 intentional。
   `tmp/` 下的四个探针脚本（`w9ds2b-{scan,test,iter,fmt,probe,probe2,policy,skillread}.{cjs,mts}`）
   收尾已自清。

## 附：本席实测记录（结论均已并入上文发现）

| 探针 | 验证的发现 |
|---|---|
| `w9ds2b-fmt.mts` | F-1（skill/agent list 渲染成 `undefined\tundefined`） |
| `w9ds2b-probe.mts` | F-5（空串被当缺参）、F-1 复现 |
| `w9ds2b-probe2.mts` | F-1（truncated 变体）、F-6（`"".split("\n").length === 1`）、`capMatchList` 默认行为 |
| `w9ds2b-policy.mts` | F-3（`..` 绕过放行、glob `cwd` / grep `pathPrefix` 不被校验、缺 `allowedPaths` 时全放行）、F-4 |
| `w9ds2b-skillread.mts` | F-2（长行截断但 `truncated: false`） |
