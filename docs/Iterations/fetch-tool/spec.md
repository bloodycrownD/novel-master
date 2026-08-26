---
date: 2026-08-25
dependency: []
---

# fetch 工具技术规格

对应 PRD：`docs/Iterations/fetch-tool/prd.md`（agent fetch 网络请求工具）。

## 设计目标

1. 新增内置工具 `fetch`：对 http/https URL 发起 GET 请求，返回状态码、内容类型与正文文本，让 agent 具备只读联网能力。
2. 双端（desktop / mobile）同一份实现，无平台分支：走 `globalThis.fetch` + 非流式 `response.text()`（RN 仅流式 body 需要 XHR 规避，非流式已被 `cloud-sync-driver-s3` 与 LLM 适配层验证可行）。
3. 默认注册即可用，用户经现有 `tools.allow/deny` 策略即可收回；子代理全深度可用（不在 `resolveAgentToolRegistry` 加摘除分支）。
4. 输出经 `formatToolOutputForLlm` 专属 formatter 以可读文本呈现（非原始 JSON 串），大响应有截断与原始大小标注。
5. 超时与网络错误返回可读错误（`ToolError`），不中断会话回合。

### 非目标（与 PRD 对齐）

- 仅 GET；无自定义请求头 / Body / 鉴权。
- 不做 HTML→纯文本降噪（风险项评估，见「风险与回滚方案」）。
- 不做 SSRF 私网拦截（见「总体方案 §5」的建议默认）。

## 总体方案

### 1. 工具形状与注册路径

`fetch` 是一个静态 `Tool` 对象（同 `subagentTool` / `skillTool` / `agentTool` 先例），定义在 `packages/core/src/domain/tool/builtin/fetch-tool.ts`：

- `name: "fetch"`；`description` 为静态 lambda（`() => string`，不依赖 ctx 动态内容）。
- `inputSchema`：`z.object({ url: z.string().min(1).describe("目标 URL，仅支持 http/https 协议").superRefine(协议白名单校验) })`——白名单校验用 `new URL(value)` 解析后要求 `protocol === "http:" || protocol === "https:"`，`file://`、`ftp://`、`data:` 等在 schema 层即拒绝（经 `ToolRunner` 转成 `INVALID_ARGUMENT`，模型收到可读的 issue 文案）。不用 `z.string().url()`，因为它放行任意协议。**顶层必须是 `z.object`，不能是裸 `z.string()`**：工具入参的线上格式是对象——`ToolUseBlock.input` 的类型是 `Record<string, unknown>`（`domain/chat/model/content-block.ts` L34），openai / gemini 适配层把 `arguments` 经 `JSON.parse` 还原成对象后原样下发，`zodToJsonSchema` 生成的顶层非 object schema 会被适配层拒绝或诱导模型再包一层对象；现有 9 个内置工具的 inputSchema 全部是 `z.object` 先例。
- `run(input, ctx)`：从 `input.url` 取目标地址，读取 `ctx.fetchFn`（可选，缺省回落 `globalThis.fetch`）发起请求。

注册进 `registerBuiltinTools`（`register-builtin-tools.ts`）后自动获得全部现有机制：

- **policy probe 驱动**：`run-agent-turn.ts`（实际路径 `packages/core/src/service/agent/logic/run-agent-turn.ts`，主装配 `runAgentTurn` L441-445 先 `registerBuiltinTools(toolProbe)` 再把 `toolProbe.list()` 交给 `validateAgentDefinition`）——注册即合法，`tools.allow/deny` 无需额外接线即可生效。`normalizeAgentToolPolicyName` 只剥 `vfs.` 前缀，`fetch` 名字不受影响。
- **摘除门闩**：`resolve-agent-tool-registry.ts` 只在 subagent/depth>=2 摘 `task`+`agent`、`skillsEnabled===false` 摘 `skill`——fetch 不加分支，即主/子/孙 agent 全深度可用（PRD 默认口径）。
- **path policy 天然避开**：`tool-path-policy.ts` 的 `PATH_FIELDS = ["path", "filePath", "from", "to"]` 只查 input 顶层字段，fetch 的入参对象唯一字段名是 `url`，不在名单内，不会被误捕进 `allowedPaths` 校验。

### 2. 上下文注入：`ctx.fetchFn`

`BuiltinToolContext`（`builtin-tool-context.ts`）新增可选字段：

```ts
/** 可选：仅 `fetch` 工具读取。缺省回落 globalThis.fetch（双端一致）。测试注入 mock 用。 */
readonly fetchFn?: typeof globalThis.fetch;
```

类型就地定义为 `typeof globalThis.fetch`，与 `infra/llm-protocol/ports/adapter.port.ts` 的 `FetchFn`（L108-111，`export type FetchFn = typeof globalThis.fetch`）结构相同但**不跨层 import**——`domain/tool` 不应依赖 `infra/llm-protocol`，类型结构一致即互相兼容。先例：`configureLlmFetch`（`infra/llm-protocol/logic/registry.ts`）同样是「可选注入、缺省 globalThis.fetch」。

装配点（`runAgentTurn` 的 `toolCtx` L496 起、`runChildAgent` 的 `toolCtx` L731 起）**零改动**：字段可选，生产路径走缺省回落；测试直接在构造的 ctx 上传 mock `fetchFn`（先例：`packages/core/test/infra/llm-protocol/llm-sse-transport.test.ts` 的 mock FetchFn）。

### 3. 请求执行与错误语义

`run` 内部流程：

1. `new AbortController()` + `setTimeout(FETCH_TIMEOUT_MS)` 手动 abort（不用 `AbortSignal.timeout`，规避 RN/Hermes 兼容差异；双端行为一致）。默认 `FETCH_TIMEOUT_MS = 30_000`。请求结束（无论成功或失败）后 `clearTimeout`，避免悬挂计时器拖住测试进程。
2. `doFetch(url, { method: "GET", signal, redirect: "follow" })`；`response.text()` 非流式取正文。
3. 错误转译全部用 `ToolError`（不借用 `http-util.ts` 的 `assertOk`——它抛 `ProviderError`，那是 LLM provider 层的错误语义）：
   - abort 触发（超时）→ `toolFailed("fetch", Error("Request timed out after 30000ms: <url>"))`；
   - 网络错误（reject 的 `TypeError: Network request failed` 等）→ `toolFailed("fetch", cause)`，`formatToolErrorForLlm` 会解 cause 给出可读文案；
   - 两类都是 `FAILED`，outcome `ok=false`，会话回合不中断（现有 ToolRunner 语义）。
4. **HTTP 非 2xx 不算错误**：4xx/5xx 也是有效响应，照常返回输出对象（`status=404` + 截断后的 body），让模型自行解释。这与 `assertOk` 的 provider 语义刻意不同。
5. **content-length 预检**：响应头带 `content-length` 且 > `FETCH_MAX_RESPONSE_BYTES`（10MB）时不读 body，直接返回 `truncated` 输出（body 为占位说明；该路径未读正文，`originalBytes` 回填 content-length 头数值，见 §4 字段说明）。这是廉价防线，防巨响应内存峰值；`content-length` 缺失（如 chunked/gzip）不预检，靠截断兜底。

### 4. 输出形状、formatter 与截断

输出对象（`run` 的返回值）：

```ts
{
  url: string;          // 规范化后的请求 URL
  finalUrl: string;     // 重定向后最终 URL（response.url），与 url 相同时仍回填
  status: number;
  contentType: string;  // response.headers.get("content-type") ?? ""
  body: string;         // 截断后的正文文本
  truncated: boolean;
  originalBytes: number; // 原始正文字节数，两个来源：正常路径读 body 后经 utf8ByteLength 全量计算；content-length 预检路径不读 body，回填 content-length 头数值（JSDoc 按此双来源注明）
}
```

**为什么输出对象而不是 string**：`formatToolOutputForLlm` 对 string 直通、对不认识的对象整体 `JSON.stringify`——string 方案虽省一个 formatter，但丢失 `summarizeToolSuccess` 摘要与结构化截断标注。照 `read`/`grep`/`glob` 先例加专属形状分支是既定模式。

`format-tool-output.ts` 新增 `isFetchOutput`（守卫：`url`+`status`+`body`+`truncated` 类型匹配；现有工具输出均无 `url` 字段，不会互相误撞，且不满足 `isReadOutput`/`isGrepOutput`/`isGlobOutput`/`isFsLsOutput` 任一守卫）与 `formatFetchOutput`：

```
GET <url>[ → <finalUrl>]
Status: <status>[ · <contentType>]

<body>

Output truncated (original N bytes).
```

**截断策略不走 `capUtf8Bytes`**：`tool-output-limits.ts` 的 `capUtf8Bytes` 按行累计、整行丢弃——网页 HTML 常是单行几十万字符（minified / 无换行），整行丢弃会一行都留不下。fetch 单独实现：定义 `FETCH_MAX_BODY_BYTES = 50 * 1024`（独立常量，与 `TOOL_OUTPUT_MAX_BYTES` 解耦，后续可单独放宽），**按字节预算截断**——用 `TextEncoder` 对正文增量编码并累计字节数，找到预算内能容纳的最大字符切点后在该处截断（不能按字符数切：含多字节字符时 51200 字符可膨胀到远超 50KB，如中文 3 字节/字符约 150KB，字节预算会失守）。`truncated=true` 时 body 末尾附标注行，`originalBytes` 回填原始大小。字节预算只约束截断点（截断后的正文部分 ≤ `FETCH_MAX_BODY_BYTES`），末尾标注行不计入预算（T-FT3 按此口径断言）。

**非文本 Content-Type**：主类型非 `text/` 且不含 `json` / `xml` / `javascript` / `svg` / `yaml` / `urlencoded` 关键字时（如 `image/png`、`application/octet-stream`），body 不返回解码乱码，置为 `[binary content, N bytes, not shown]` 占位（N 为 originalBytes），避免乱码撑爆上下文。Content-Type 缺省时按文本处理。

`build-tool-result-block.ts` 的 `summarizeToolSuccess` 加 `fetch` 分支：正常 `200 · 12.3KB`，截断时 `truncated · 50KB/1.2MB`；体积数字按 1024 进位（B/KB/MB）、保留 1 位小数（如 `12.3KB`、`1.2MB`）格式化。`ToolResultBlock.content` 是 string，本方案只产文本，无 image 需求。

### 5. SSRF / 私网拦截：建议默认（PRD 待拍板项）

**建议本期仅做协议白名单校验（http/https），私网拦截列为后续迭代。**理由：

1. 工具运行在用户本机设备上，「私网」是用户自己的局域网；拦截 `127.0.0.1` 会误伤「让 agent 拉本地 dev server 的 API 文档」这类开发者正当场景（PRD 明确列了开发者用户场景）。
2. 严格的私网拦截需要 DNS 解析后校验（防 DNS rebinding），RN 端没有统一可用的解析接口，双端一致的实现成本高。
3. 现有防线已覆盖大半风险：只读 GET、无自定义头（无法携带内网服务期望的凭证）、`tools.allow/deny` 可一键收回、体积截断限制回读量。
4. 重定向层面 fetch 规范只允许 http/https 之间跳转，协议白名单不会被重定向绕开。

后续迭代若拍板要做：hostname 解析后校验私网段 + 拒绝 IP 字面量直连，或在 `BuiltinToolContext` 加 ctx 级开关（照 `allowedPaths` 的可选模式），由各端装配点收紧。

### 6. UI 目录与 mobile shim

- `agent-tool-catalog.ts` 的 `BUILTIN_TOOL_CATALOG` 是与 `registerBuiltinTools` 手工同步的点，加一行 `{ name: "fetch", ... }`，智能体配置 UI 即可 allow/deny。不加则运行时可用但 UI 不可配。
- mobile 测试经 `apps/mobile/test-utils/core-shim.ts` 从 core **dist** re-export：mobile 测试要用新符号（`fetchTool` 等）必须先 build core 并在 shim 加 re-export 行。本期核心逻辑测试全部落在 `packages/core/test/tool/`，mobile 侧暂不引入 fetch 符号，shim 同步列为可选步骤。

## 最终项目结构

```
packages/core/src/domain/tool/builtin/
  fetch-tool.ts                        # 新增：fetch 工具（schema / 超时 / 截断 / 错误转译）
  builtin-tool-context.ts              # 修改：+fetchFn 可选字段
  register-builtin-tools.ts            # 修改：注册 fetchTool（9 → 10 个）
packages/core/src/domain/tool/logic/
  format-tool-output.ts                # 修改：+isFetchOutput / formatFetchOutput
  build-tool-result-block.ts           # 修改：summarizeToolSuccess +fetch 分支
packages/core/src/config-forms/agent/
  agent-tool-catalog.ts                # 修改：BUILTIN_TOOL_CATALOG +fetch 行
packages/core/test/tool/
  fetch-tool.test.ts                   # 新增：工具本体 + formatter + 注册/策略用例
apps/mobile/test-utils/
  core-shim.ts                         # 可选修改：re-export fetchTool（需先 build core）
```

装配点 `packages/core/src/service/agent/logic/run-agent-turn.ts`（`runAgentTurn` / `runChildAgent`）**零改动**。

## 变更点清单

| # | 文件 | 符号 / 位置 | 变更 |
|---|------|-------------|------|
| 1 | `packages/core/src/domain/tool/builtin/builtin-tool-context.ts` | `BuiltinToolContext` | 新增可选字段 `fetchFn?: typeof globalThis.fetch`（仅 fetch 工具读取，缺省回落 globalThis.fetch） |
| 2 | `packages/core/src/domain/tool/builtin/fetch-tool.ts` | `fetchTool`（新） | 静态 Tool 对象：`name="fetch"`、协议白名单 inputSchema、GET + AbortController 超时、content-length 预检、字节截断、非文本占位、ToolError 错误转译 |
| 3 | `packages/core/src/domain/tool/builtin/fetch-tool.ts` | `FETCH_TIMEOUT_MS` / `FETCH_MAX_BODY_BYTES` / `FETCH_MAX_RESPONSE_BYTES`（新） | 30s 超时、50KB 正文截断、10MB 预检上限三个独立常量 |
| 4 | `packages/core/src/domain/tool/logic/format-tool-output.ts` | `isFetchOutput` / `formatFetchOutput`（新）；`formatToolOutputForLlm` | 加 fetch 形状分支，输出可读文本（含截断标注），避免 fallback `JSON.stringify` |
| 5 | `packages/core/src/domain/tool/logic/build-tool-result-block.ts` | `summarizeToolSuccess` | 加 `name === "fetch"` 分支：`200 · 12.3KB` / `truncated · 50KB/1.2MB` |
| 6 | `packages/core/src/domain/tool/builtin/register-builtin-tools.ts` | `registerBuiltinTools` | `registry.register(fetchTool)`；模块注释 9 → 10 个 |
| 7 | `packages/core/src/config-forms/agent/agent-tool-catalog.ts` | `BUILTIN_TOOL_CATALOG` | 加 `{ name: "fetch", label: "fetch", description: "发起 http/https GET 请求获取网页或接口内容" }` |
| 8 | `packages/core/test/tool/fetch-tool.test.ts`（新） | — | node:test + tsx，mock `ctx.fetchFn` 注入（先例 `packages/core/test/infra/llm-protocol/llm-sse-transport.test.ts`） |
| 9 | `apps/mobile/test-utils/core-shim.ts` | re-export 区 | 可选：`export { fetchTool } from ".../dist/domain/tool/builtin/fetch-tool.js"`（需先 build core） |
| 10 | `packages/core/test/tool/agent-tool.test.ts` L124、`packages/core/test/tool/skill-tool.test.ts` L130、`packages/core/test/tool/tool-schema-descriptions.test.ts` L26、`packages/core/test/tool/vfs-tools.test.ts` L45、`packages/core/test/config-forms/agent-tool-catalog.test.ts` L15 | 计数断言（5 处） | 同步更新 5 处计数断言 9→10：前 4 处为 `registry.list().length === 9`，catalog 测试为 `BUILTIN_TOOL_CATALOG.length === 9` 并顺带加 fetch 条目断言（`find((e) => e.name === "fetch")` 命中且 label/description 非空） |

## 详细实现步骤

Step 1 — phase-fetch-context — blocking: yes — qa: auto：`builtin-tool-context.ts` 给 `BuiltinToolContext` 加可选 `fetchFn?: typeof globalThis.fetch` 字段（带 JSDoc：仅 fetch 工具读取、缺省回落、测试注入用），不触碰任何装配点。

Step 2 — phase-fetch-core — blocking: yes — qa: auto：新建 `fetch-tool.ts`：zod schema（顶层 `z.object`，`url` 字段协议白名单 superRefine）+ `fetchTool` 静态对象（GET、AbortController+setTimeout 超时且请求完成后 clearTimeout、redirect follow、content-length 预检、`FETCH_MAX_BODY_BYTES` 字节预算截断、非文本 Content-Type 占位、`toolFailed` 错误转译、输出 `{url,finalUrl,status,contentType,body,truncated,originalBytes}`，originalBytes 的 JSDoc 注明双来源：正常路径 utf8ByteLength 全量计算 / 预检路径回填 content-length 头数值）。

Step 3 — phase-fetch-format — blocking: yes — qa: auto：`format-tool-output.ts` 加 `isFetchOutput` 守卫与 `formatFetchOutput`，在 `formatToolOutputForLlm` 的形状分发链中插入分支（置于 fallback `JSON.stringify` 之前）。

Step 4 — phase-fetch-summary — blocking: no — qa: auto：`build-tool-result-block.ts` 的 `summarizeToolSuccess` 加 `fetch` 分支（状态 · 体积 / truncated · 保留量/原始量）。

Step 5 — phase-fetch-register — blocking: yes — qa: auto：`register-builtin-tools.ts` 导入并注册 `fetchTool`，更新模块注释；probe 驱动的 `validateAgentDefinition` 与 `tools.allow/deny` 随之自动生效（无需改 `run-agent-turn.ts`）。

Step 6 — phase-fetch-catalog — blocking: no — qa: manual_user：`agent-tool-catalog.ts` 的 `BUILTIN_TOOL_CATALOG` 加 fetch 行；在智能体配置 UI 肉眼确认工具清单出现 fetch 且勾选/取消后策略生效。

Step 7 — phase-fetch-shim — blocking: no — qa: manual_user：（可选）build core 后在 `apps/mobile/test-utils/core-shim.ts` re-export `fetchTool`，mobile 测试需要引用新符号时先完成此步；本期核心测试不依赖它。

依赖关系：Step 2 依赖 Step 1（ctx 类型）；Step 3/4 依赖 Step 2（输出形状）；Step 5 依赖 Step 2；Step 6/7 独立可并行。

## 测试策略

测试框架沿用 `packages/core/test/tool/*.test.ts` 的 node:test + tsx 模式；网络全部经 `ctx.fetchFn` 注入 mock（不发真实请求，先例：`packages/core/test/infra/llm-protocol/llm-sse-transport.test.ts`）。fetch 输出格式化用例并入 `fetch-tool.test.ts`，同时在 `format-tool-output.test.ts` 补一条 fetch 形状不误撞现有形状的回归。mobile 侧用例本期不建（见 Step 7 说明）。

| 用例 | 场景与断言 | 映射 Step | blocking |
|------|-----------|-----------|----------|
| T-FT1 | 协议白名单：`runner.call("fetch", { url: "file:///etc/passwd" }, ctx)`、`{ url: "ftp://x" }`、`{ url: "data:text/plain,x" }` 均触发 schema 拒绝（INVALID_ARGUMENT，不发起请求）；`{ url: "http://…" }` / `{ url: "https://…" }` 通过 | Step 2 | yes |
| T-FT2 | 成功响应：mock 返回 200 + `content-type: text/html` + 正文，断言输出 `{url,finalUrl,status,contentType,body,truncated:false,originalBytes}` 各字段 | Step 2 | yes |
| T-FT3 | 截断：mock 返回 > 50KB 正文，断言 `truncated:true`、body 字节预算内、末尾含 `Output truncated (original N bytes)` 且 N 为原始字节数 | Step 2 | yes |
| T-FT4 | 超时：用 node:test `mock.timers` 推进时钟（先例 `packages/core/test/infra/llm-protocol/llm-sse-transport.test.ts` L59），mock fetch 监听 signal、收到 abort 后 reject，断言得到 ToolError FAILED 且文案含 `timed out` 与 URL | Step 2 | yes |
| T-FT5 | 网络错误：mock 直接 reject `TypeError("Network request failed")`，断言 ToolError FAILED、cause 文案可读 | Step 2 | yes |
| T-FT6 | 非 2xx：mock 返回 404 + 错误页正文，断言 outcome 为成功输出、`status=404`、body 照常截断 | Step 2 | yes |
| T-FT7 | 非文本 Content-Type：`image/png` 时 body 为 `[binary content, N bytes, not shown]` 占位、originalBytes 回填 | Step 2 | yes |
| T-FT8 | 重定向：mock 返回 `response.url` 与请求 URL 不同，断言 `finalUrl` 回填且 formatter 输出 `GET <url> → <finalUrl>` | Step 2+3 | no |
| T-FT9 | content-length 预检：响应头声明 > 10MB，断言不读 body、返回占位与 truncated 标注、`originalBytes` 回填 content-length 头数值 | Step 2 | no |
| T-FT10 | formatter：`formatToolOutputForLlm(fetch输出)` 产出可读文本（非 JSON 串），截断场景含标注行；`format-tool-output.test.ts` 补 fetch 形状不误撞 read/grep/glob/fs 形状的回归 | Step 3 | yes |
| T-FT11 | summary：`summarizeToolSuccess` 未导出，改经导出的 `buildToolResultBlock(toolUseId, outcome, { toolName: "fetch" })` 断言 `summary` 字段——正常 `200 · 12.3KB`、截断 `truncated · 50KB/1.2MB`；字节格式化规则：1024 进位（B/KB/MB）、保留 1 位小数 | Step 4 | no |
| T-FT12 | 注册与策略：`registerBuiltinTools(probe)` 后 `probe.list()` 含 `fetch`；`tools.deny:["fetch"]` 经 `resolveAgentToolRegistry` 摘除；depth>=2 孙 agent 场景 fetch 仍在（不摘） | Step 5 | yes |
| T-FT13 | path policy 不误伤：ctx 带 `allowedPaths:["src/"]` 时 `runner.call("fetch", { url: "https://example.com" }, ctx)` 不被 FORBIDDEN（入参对象顶层字段 `url` 不在 PATH_FIELDS） | Step 5 | no |

运行方式：`packages/core` 下按现有 test script 跑 `test/tool/fetch-tool.test.ts`（node:test + tsx）。UI 目录（Step 6）与 mobile shim（Step 7）为 manual_user 验证项。

## 风险与回滚方案

| 风险 | 影响 | 缓解 | 回滚 |
|------|------|------|------|
| RN 网络边界：gzip 自动解压（RN fetch 对 `content-encoding: gzip` 的解压与 content-length 语义差异）、非常规 Content-Type、非 UTF-8 编码（GBK 等页面 text() 解码为替换字符） | mobile 端正文乱码或体积判断偏差 | content-length 仅作预检不作截断依据（截断以解码后 utf8ByteLength 为准）；非文本类型占位；双端实测（Step 6/7 的 manual_user 项覆盖） | 工具纯增量，revert 注册行即全端摘除 |
| HTML 噪音：网页原样返回时标签占比高，50KB 预算内有效正文少 | 模型可用信息量低于预期 | 本期接受（PRD 明确不降噪）；后续迭代引入正文提取（readability 类方案），输出形状已预留 `contentType` 字段便于分流 | 同上 |
| mobile dist shim 同步：mobile 测试引用 `fetchTool` 等新符号前未 build core / 未加 shim 行 | mobile 测试编译失败 | Step 7 注明先 build core 再改 shim；本期 mobile 不引用新符号，风险仅在未来扩展时 | 移除 shim 新增行即可 |
| 大响应内存峰值：`response.text()` 全量进内存（content-length 缺失时预检失效） | 超大响应（如上百 MB）占用设备内存 | content-length > 10MB 预检是廉价防线；彻底方案（流式读取 + 边读边弃）列为后续改进 | 同上 |
| 重定向不受协议白名单二次校验 | 理论上经 30x 跳转 | fetch 规范限制重定向仅 http/https 间跳转，协议切换会被引擎拒绝；`finalUrl` 输出可审计 | 同上 |
| 子代理深度可用带来的滥用面 | 孙 agent 也可联网 | PRD 默认口径；用户可 deny；若需收紧，后续在 `resolveAgentToolRegistry` 加 depth 分支（改动点单一、已隔离） | 同上 |

整体回滚：本迭代全部变更为纯增量（新文件 + 可选字段 + 注册行 + 数据行），无存储格式变更、无数据迁移；删除 `register-builtin-tools.ts` 的注册行即可让三端同时摘除 fetch，旧版本读取含 fetch tool_result 的会话也只是纯文本展示，向后兼容。
