---
date: 2026-11-13
---

# MCP 双端接入（mcp-support）技术规格（SPEC）

## 设计目标

让 nm 支持 MCP（Model Context Protocol）工具能力，桌面与移动双端：

1. **桌面端**：Streamable HTTP 传输 + OAuth 2.1 授权（2026-11-24 用户拍板：与移动端一致，不做 stdio）。
2. **移动端**：Streamable HTTP 传输 + OAuth 2.1 授权（系统浏览器 + deep link 回调）。
3. **协议层复用**：官方 `@modelcontextprotocol/client@^2.4.0` 的 `Client` 承担握手、版本协商、能力协商、分页、schema 校验；不自研协议状态机。
4. **传输层自写且两端共享**：一份 `HttpMcpTransport` 放 core，只依赖一个极小的请求函数。桌面用 Node 22 的 `fetch` 适配；移动端用原生 `request` 适配（带整调用超时与真断连），原生未注册时回落 `fetch`。**只有 transport 能看到 raw body，才能保住「原文透出」**。不做流式，整包响应后再解析。
5. **工具接入**：`mcp__<server>__<tool>` 命名空间，装配期快照（因 `Tool.description` 是同步 lambda）。
6. **非标错误归一**：7 个内部码 + `action`，原文永远透出，不做厂商标定。
7. **首版只做 tools**：不做 resources / prompts / sampling / elicitation。

不包含：stdio 传输（双端均不做；`type:"stdio"` 配置做归一但不可用，与 `sse` 同口径）、旧版 SSE 双端点 transport（`type:"sse"` 配置做归一但首版不实现传输）、resources/prompts。与 `signal-abort-scope` spec 无耦合（MCP 侧只消费 `AbortScope` 接口，不修改它）。

## 需求来源

用户口述（2026-11-13 会话）。关键拍板：双端都含 OAuth 2.1；首版只做 tools；HTTP transport 两端共用自写实现。

2026-11-24 补充拍板：桌面端也不做 stdio，传输与移动端完全一致，两端只差 OAuth 回调方式（桌面 loopback / 移动 deep link）。

## 开发期变更（2026-11-25，真机测试中拍板；与下文冲突时以本节为准）

以下条目已实现并提交在 `feat/mcp-support`，下文各章里与之矛盾的旧表述尚未逐句回改。

1. **服务器模型**：`McpServerConfig` 去掉 `name`，改为 `description`（选填、可空）；`id` 由用户填写，规则 `^[A-Za-z0-9]+(_[A-Za-z0-9]+)*$`——英文字母、数字、单个下划线分隔，不允许连续或首尾下划线（`__` 是工具名里 ID 与工具名的分隔符，ID 里出现会让换 ID 的引用改写误伤别的 server）。判定是 `McpServerConfigOps.isValidId`，经 `public/mcp.ts` 导出；桌面 renderer 有一份同值的跨 bundle 副本 `shared/logic/mcp-id.ts`，改正则要两处同步。新建时必填且不可与已有 ID 重复；两端不再生成随机 id。
2. **换 ID**：编辑时可以改 ID。整条编排只有 core 一处：`McpToolRefs.renameWithRewrite({ configStore, agentRegistry }, oldId, config, afterRename?)`——先改写所有智能体工具允许 / 禁止名单里的 `mcp__<旧ID>__<工具>` 为新前缀，再 `store.rename`（SKSP 的 bearer / headers / oauth 先写新 ref、KKV 原位替换、最后清旧 ref；oauth 搬迁失败回到未授权），最后跑调用方传入的 `afterRename`（两端在这里写用户新填的 bearer）。任一步失败反向改写；配置已经改名过的按旧配置迁回；新 ID 撞到别的 server 时只改回引用，不覆盖同名的那个。两端不再各写一份编排。
3. **导入 JSON 整个移除**（两端都不要）：界面入口、IPC 通道、core 的 `importExternal`、外部 JSON / Claude Desktop 格式的归一解析及对应测试、文案一并删除。`McpConfigParser.parse` 保留，但收窄为 KKV 存储值的归一器（§七的读路径容错仍需要它）。§七里「配置导入 / 外部 JSON 归一 / importExternal」相关内容作废；T-M1~T-M4 中针对外部 JSON 解析的用例作废。
4. **界面文案与布局**：传输类型选项标签为 `HTTP` / `SSE`（不再写 Streamable HTTP），提示语同步为「请改用 HTTP 传输」；设置入口与页头标题为「MCP 配置」；详情页不再有「删除服务器」，删除只在列表行菜单；列表行菜单没有上移 / 下移；列表标题为 ID、副标题为描述（不显示 URL；不可用时仍直显 `failure.detail`）；工具描述限两行、点描述文字展开 / 收起（`FormSwitchRow.descriptionLines`）；工具数量显示在连接状态行。
5. **工具结果**：渲染出的文本是 JSON 时先经 `Json.prettyJson(text, 300)` 整理成多行再交给模型，非 JSON 原样；超 50KB 落盘口径不变。`structuredContent` 仍不读取（用户确认暂不做）。
6. **每工具启停双端对齐（2026-11-26）**：桌面端详情页补了「工具」卡与每工具开关，与移动端一致。存储与过滤都在 core：`McpConfigStore.listDisabledTools / setToolDisabled`（KKV `nm-mcp/disabledTools`，`remove` 连带清掉该 server 的清单），连接管理器 deps 必填 `disabledTools`，`snapshotTools()` 出口过滤（先过滤再查撞名）。移动端配置 store 改成 core 的薄镜像（只留同步读镜像，写路径全部委托 core）。
7. **移动端传输**：走原生非流式 `request`（补回传全部响应头），不是 RN `fetch`；详见「三、HTTP transport」与 Step 6。
8. **自动连接与状态**：`McpServerState` 增加 `connecting`；`pending` 只表示「启用但从未尝试连接」。启用且处于 `pending` 的服务器在「开关打开」「进入列表」「保存」时自动尝试一次；一次尝试结束即为 `ready` 或 `failed`，**界面不自动重试**，重试入口是详情页「测试连接」（装配期每次 run 仍会自行重拉快照）。在途尝试在连接管理器里同步登记，连点开关、反复进列表共享同一次连接；连接进行中列表行开关禁用并显示「连接中」。装配预算内未完成由原来的 `pending` 改记 `failed`（T-M18a 断言随之调整）。进入详情页不再对已失败的服务器自动重试。
9. **连接失效与在途结果（2026-11-26）**：连接管理器按 server 记代际，`invalidate` / `closeAll` 递增；在途的建连、`tools/list`、`tools/call` 回来后先核对代际，代际已变即丢弃并关闭本次新建的连接——旧配置的连接与快照不会被写回。`invalidate` 的语义相应变为「失效快照并作废在途结果」。
10. **错误归一补充（2026-11-26）**：`McpTransportError` 且没有响应（请求函数自身失败，如网络断开）直接归 `kind:"network"`、`action:"retry"`，不再走文本嗅探。§四的判定顺序不变，这一条排在最前。
11. **callTool 取消走返回值（2026-11-26）**：`callTool` 不再对 `AbortError` 原样 reject 透传，改以 `Interrupt.cancelled`（reason 兜底 `user-stop`，MCP 拿不到 scope reason）返回，签名 `Promise<Result<unknown, McpFailure>>` → `Promise<Result<unknown, McpFailure> | Interrupt>`（replaced 对 MCP 无生产者，类型上穷尽即可）；Promise 不 reject，未知异常由 `settlePromise` 收编。连接管理器 `failCall` 的「取消透传」throw 与其 `nm-throw: keep` 注释随之删除——取消分支提前返回、不写连接状态，与改前一致；`to-nm-tool` 删掉「catch AbortError → TOOL_CANCELLED」的 try/catch，改按判别联合 `"kind" in called` 收 `TOOL_CANCELLED`（`TOOL_CANCELLED` / `TOOL_FAILED` 的码、params、文案不变）。transport / official-mcp-client 层的 `AbortError` reject 契约不变（取消在运输层的格式）。下文 §三、§五「取消」、§六 `run` 的旧表述已随本条改写。依据：`docs/Iterations/error-channel-debt/design.md` §2，与工具系统 `ToolRunner.call` 的 Result 化（同设计 §1，第一轮已落地）配套。

## 代码评审（2026-11-25 ~ 26）

评审与修复的完整记录见同目录 `cr-fix-spec.md`：首轮四路评审合并出 17 条（P0 1 / P1 9 / P2 7），三轮终态认证通过后全部修复落地，另按用户要求补了第 6 条的双端对齐并把第 2 条、第 6 条的公共逻辑收进 core。

## 现状约束（探索结论）

**工具系统**：

- `Tool` 接口（`domain/tool/model/tool.ts:19`）：`Tool<Input, Output, Ctx>`，`{ name, description: (ctx) => string, inputSchema: z.ZodType, outputSchema?, run(input, ctx): Promise<Result<Output, AppError>> }`，协议无关。已知失败走 `Result.err`，不在工具内 throw；取消经 `ctx.signal` 由 runner 收口为 `TOOL_CANCELLED`。
- 注册链（`service/agent/logic/run-agent-turn.ts:843`）：`new ToolRegistry` → `BuiltinTools.register`（11 个）→ `AgentDefinitionValidator.validate` → `AgentTools.resolveRegistry`（allow/deny + depth 过滤，`domain/agent/logic/resolve-agent-tools.ts:24`）→ 组 toolCtx → runner。**每 run 重建**，子 agent 同款重建（同文件 `:1330`）。
- `description` 在 `infra/llm-protocol/logic/tool-definitions.ts:23` **同步求值** → MCP 工具清单必须是装配期快照，不能异步现查。
- `ToolRegistry.register` 重名触发 `assert`（`domain/tool/logic/tool-registry.ts:27`），无命名空间机制。
- 结果回流：`ParallelToolOutcome` 三分支 `{ok, output} | {ok:false, error} | {ok:false, error, kind:"cancelled"}`（`tool-runner.ts:26`），工具闭包的 Err 与未知异常由 `normalizeToolFailure`（`tool-runner.ts:40`、`:131`）统一收口 → `ToolResultBlock.build` → `ToolResultBlock{ok, content: 纯文本, summary?, meta?}`。nm 用自有 `ok` 而非 MCP 的 `isError`；`ToolResultBlock.resolveOk` 兼容 `Error:` 前缀推断。
- 工具名过滤：`FileTools.normalizeAgentToolPolicyName`（`builtin/vfs-tools.ts:88`），MCP 复合名需验证不被改写。
- 取消：`Tool.run` 只拿得到 `BuiltinToolContext.signal`（裸 `AbortSignal`，`builtin-tool-context.ts:286`）；需要 `AbortScope` 的工具用 `AbortScopeFactory.signalView` 派生（`tool-runner.ts:125` 在用）。
- 超大输出：超过 50KB 的工具输出经 `OverflowSink.sink` 落到会话工作区 `/tmp/`（`builtin/overflow-sink.ts`，curl / search 先例），返回 `savedPath` 供 read 分页读回。
- 工具描述无截断/按需加载，但有 agent 级 allow/deny 白名单。输出侧有 `tool-output-limits.ts` 50KB/2000 行。

**配置与密钥**（search 范例）：

- `SearchConfig.createStore({ kkv, secretStore })`（`domain/tool/builtin/search/search-config.ts:475`），KKV 模块名 `nm-search`，密钥走 SKSP ref `search/{engineId}/apiKey`；写方法返回 `Result.err`，throw 收在 IPC 边界。
- `SecretStore` port（`infra/sksp/ports/secret-store.port.ts:8`）：get/set/delete/has。desktop 是驱动 store + env composite，mobile 无 env。
- 迁移无版本字段：读路径容错归一（未知丢弃 / 缺项补尾 / 损坏回缺省），写路径是错误边界。

**catalog**：桌面 `apps/desktop/shared/config-forms/agent-tool-catalog.ts` 与移动 `apps/mobile/src/config-forms/agent/agent-tool-catalog.ts` 都导出 `BUILTIN_TOOL_CATALOG` 常量数组，文案经 `coreT` i18n（桌面从 `../logic/core-i18n.js`、移动从 `@/i18n/core` 引入）。两文件结构相同，import 路径与引号风格不同。移动端已有 `AgentToolCatalog` namespace，新增符号不得与之撞名。

**网络层**：

- `llm-sse-native`（`@novel-master/llm-sse-native`）：TS 入口 `src/native.ts`，方法 `sseConnect` / `sseAbort` / `request` / `requestAbort`（2026-11-22 新增）；事件 `Headers{requestId,status,contentType}` / `Chunk` / `Done` / `Error{kind}`；Kotlin 侧 `LlmSseModule.kt`（680 行）+ `LlmSsePackage.kt` + `Utf8StreamingDecoder.kt`。仅 Android 有原生实现，iOS 走 XHR 回落。
- **流式的 headers 事件只回 `Content-Type`**（`LlmSseModule.kt:193`），与 MCP 无关，本迭代不动。非流式 `request` 的返回值也只带 contentType（`LlmSseModule.kt:277`）——MCP 走的是这条，所以要补它的返回值（Step 6）。
- 移动 shim（`apps/mobile/src/services/llm-native-fetch-shim.ts`）：只经 `Registry.configureLlmFetch` 喂 LLM 通道（`runtime/setup-llm-fetch.ts:69`），**不是全局 fetch**；响应头白名单只回 Content-Type，`response.body` 恒 `null`。MCP 不经这个 shim，直接调原生 `request`，另配一个 MCP 专用适配。
- **RN 自带网络栈的两条案底**（`docs/Iterations/llm-stream-native/prd.md`、`docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/spec.md`）：① RN 0.85.3 Android 的 `OkHttpClientProvider` 四类超时全为 0，XHR 与 `fetch` 一视同仁，挂住的请求 Promise 永不 settle，会话门锁因此死锁——非流式 chatNonStream / listModels 就是因此收编进原生 `request`（600s callTimeout）；② OkHttp 4.9.2 连接池会复用静默半开的死连接，请求写进 TCP 缓冲后被判成功、再永久阻塞。**MCP 的移动端请求不走 RN `fetch`**，只在原生未注册时回落。
- 原生非流式 `request`（`packages/llm-sse-native/src/types.ts`）：`request(requestId, method, url, headersKv, body, callTimeoutMs)` 返回 `{ status, contentType, body }`，非 2xx 不 reject、status 与完整 body 原样带回；`requestAbort(requestId)` 是 `Call.cancel()` 真断连，原 promise 以 `code:"abort"` reject。
- 桌面：无 Electron net / undici / axios，core 的 `LlmSseTransport.post` 用 `options.fetchFn ?? globalThis.fetch`（`infra/llm-protocol/logic/llm-sse-transport.ts:548`），Electron 35.7.5 = Node 22。
- core 的 `SseTransport.post` 返回 `{status, contentType}`（`llm-sse-transport.ts:346`），非 2xx 被 `http-util.ts` 的 `assertOk` 直接 reject，body 只剩 500 字符 snippet。**MCP 不复用 `SseTransport`**，自写 transport 直接消费注入请求函数返回的 `{ status, headers, bodyText }`。

**构建**：

- metro：`unstable_conditionNames: ['require','react-native','browser']` + `resolverMainFields: ['react-native','browser','main']` → 带 exports 的新依赖先命中 browser 条件。
- `disableHierarchicalLookup: true` + `require.resolve` 兜底。
- core 有 8 个运行时依赖（非零依赖先例已存在）：zod、@noble/hashes、diff、fast-xml-parser、fflate、fossil-delta、iconv-lite、yaml。
- 无 APK 体积门禁；只有 webview 资源预算记录与 `scripts/bundle-debug/extract-mods.mjs` 手工排查。

## 总体方案

### 一、依赖与包边界

| 包 | 新增依赖 | 用途 |
|---|---|---|
| `packages/core` | `@modelcontextprotocol/client@^2.4.0` | 只 import 根入口（`Client` + 类型） |
双端只依赖 core 的这一份，应用层不直接 import 官方 client。**硬规则：任何地方都不 import `./stdio` 或 `cross-spawn`**，否则子进程依赖会进 bundle。

### 二、分层结构

```
packages/core/src/domain/mcp/          # 纯业务：模型 + 纯函数 + port
  model/mcp-server-config.ts           # McpServerConfig 联合类型
  model/mcp-failure.ts                 # McpFailureKind / Action / Failure
  model/mcp-tool-snapshot.ts           # 快照条目
  logic/parse-mcp-server-config.ts     # 外部 JSON → 内部配置（含 type 别名归一）
  logic/slugify-mcp-tool-name.ts       # mcp__server__tool + 长度截断
  logic/classify-mcp-failure.ts        # 四层判定 + auth 文本嗅探
  logic/render-mcp-tool-result.ts      # CallToolResult → 纯文本
  logic/to-nm-tool.ts                  # 快照条目 → nm Tool
  ports/mcp-config-store.port.ts
  ports/mcp-connection.port.ts

packages/core/src/infra/mcp/           # 外部适配
  ports/mcp-transport.port.ts
  logic/parse-sse-frames.ts            # 逐帧 SSE 解析（含多行 data / 注释行）；先核对能否复用 llm-protocol 既有实现
  logic/build-request-headers.ts       # 认证 + session + protocol version
  impl/http-mcp-transport.ts           # 两端共享，注入请求函数
  impl/official-mcp-client.ts          # 包装官方 Client
  impl/create-mcp-connection-manager.ts
  impl/mcp-config-store.ts             # KKV nm-mcp + SKSP
  impl/mcp-oauth-provider.ts           # 官方 OAuthClientProvider 契约实现
```

### 三、HTTP transport（核心，两端共享）

```ts
export interface RawMcpResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
}

export interface McpTransport {
  start(): Promise<void>;
  send(message: JsonRpcMessage, options?: { signal?: AbortSignal }): Promise<void>;
  close(): Promise<void>;
  readonly sessionId: string | null;
  setProtocolVersion?(version: string): void;
  onmessage?: (message: JsonRpcMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
}
```

关键行为：

- POST，`Accept: application/json, text/event-stream`，`Content-Type: application/json`。
- 先把响应体完整读成文本，再按 `content-type` 分支：`text/event-stream` → 逐帧解析（整包文本里的多帧一次拆出）；`application/json` → 整包解析；其他 → 抛带 `raw` 的 `McpTransportError`。
- **不经过 `assertOk`、不复用 `SseTransport`**：transport 自己读请求函数返回的 `status` / `headers` / `bodyText`，非 2xx 的响应体原文不丢。
- **注入的是一个极小的请求函数**，不是 `Response` 对象：`McpRequestFn = (req: { url, method, headers, body, signal }) => Promise<{ status, headers: Record<string, string>, bodyText }>`。桌面用 Node 22 的 `fetch` 适配；移动端用原生 `request` 适配（`timeoutMs` 即 callTimeout，`signal` 中止走 `requestAbort`），原生未注册时回落同一个 `fetch` 适配。对 `llm-sse-native` 的改动只有「非流式 `request` 回传全部响应头」一处（Step 6），流式路径不动。移动端因此收不到服务器推送，首版不需要（见「五、连接管理」）。
- 每个请求受 `AbortSignal` 约束（`BuiltinToolContext.signal` 或装配期超时），中止时 transport 以 `AbortError` reject（取消在运输层的格式），由连接管理器 `settlePromise` 收进 `Result` 后经 `failCall` 判定，`callTool` 以 `Interrupt.cancelled` 返回（开发期变更 11），最终由工具 `run` 转成取消的 `Result`。
- `JsonRpcMessage` 类型直接取 `@modelcontextprotocol/client` 的导出类型，不自定义。
- **逐帧判定**：合法 JSON-RPC 帧照常投递；非法帧只标记并记原文，不作废整条流。
- 吸收 `Mcp-Session-Id`（响应头）与 `MCP-Protocol-Version`；后续请求带回。
- 401 时读 `WWW-Authenticate`（`resource_metadata` / `error="invalid_token"`），交给 OAuth provider。
- **解析失败时把 raw 塞进错误对象**（`McpTransportError.raw`），这是「原文透出」能成立的唯一前提。 `RawMcpResponse.contentType` 是从 `headers["content-type"]` 提取的规范化字段。

### 四、非标错误归一（四层判定）

```ts
export type McpFailureKind = "auth" | "permission" | "rate-limit" | "server" | "protocol" | "network" | "unknown";
export type McpFailureAction = "reauthorize" | "fix-config" | "retry" | "report";

export interface McpFailure {
  readonly kind: McpFailureKind;
  readonly action: McpFailureAction;
  readonly detail: string;      // 原文（HTML 取 title + 前 200 字符；JSON 截 2KB）
  readonly status?: number;
}
```

判定顺序：

1. **status**：401→auth / 403→permission / 429→rate-limit / 5xx→server / 2xx 继续。
2. **contentType**：2xx 但非 json 或 event-stream → `server`（网关错误页），detail 取 `<title>` + 前 200 字符。
3. **body 形状**：有 `jsonrpc` 字段 → 标准 JSON-RPC，按 `error.code` 映射；否则匹配业务码形状（`{code,msg}` / `{error:{code,message}}` / `{error_code,error_msg}`）→ 按业务码映射：401 → `auth`、403 → `permission`、429 → `rate-limit`、其余 → `server`，原业务码写进 `detail`。不存在 `business` 这个 kind。
   - 标准 JSON-RPC 错误码：`-32700` / `-32600` / `-32601` / `-32602` → `protocol`（`report`）；`-32603` → `server`（`retry`）；其余负数码 → `protocol`。
4. **isError 文本嗅探**（`looksLikeAuthFailure`）：匹配 `401|unauthorized|invalid.?token|expired|credential|api.?key|forbidden` → 升级为 `auth`/`permission`。

**红线**：内部码只有这 7 个，不再细分；detail 永远带原文；`isError: true` 的结果不抛异常，工具 `run` 返回 `Result.err` + 原文 + 提示前缀。

入参收成一个对象，不散成位置参数：

```ts
McpFailureClassifier.classify({ status, contentType, body, wwwAuthenticate }): McpFailure
```

- `kind → action` 固定映射：`auth` → `reauthorize`（配了 OAuth）或 `fix-config`（配了 bearer）；`permission` → `fix-config`；`rate-limit` / `server` / `network` → `retry`；`protocol` / `unknown` → `report`。
- 传输类型不可用（`stdio` / `sse`）固定为 `kind:"server"`、`action:"fix-config"`，detail 为「暂不支持 stdio / SSE 传输，请改用 Streamable HTTP」。
- `detail`：JSON 截 2KB；HTML 取 `<title>` 再接正文前 200 字符。

### 五、连接管理

```ts
export interface McpConnectionManager {
  snapshotTools(): Promise<readonly McpToolSnapshot[]>;      // 装配期调用，带缓存
  serverStatuses(): readonly McpServerStatus[];                   // 同步读；UI 状态标签与测试连接用
  callTool(serverId: string, toolName: string, args: unknown, signal: AbortSignal): Promise<Result<unknown, McpFailure> | Interrupt>;   // 取消沿 Interrupt 返回，见下方「取消」
  invalidate(serverId: string): void;
  closeAll(): Promise<void>;
}
```

- **常驻连接**（懒连接、按 serverId 索引）：HTTP 建连有成本，且会话 id 要跨请求保持。
- 单个 server 连接失败**隔离**：记录 `McpFailure` 并跳过，其余 server 照常。
- 快照失效只有两条路径：TTL 60s 到期、配置保存或手动刷新时调 `invalidate(serverId)`。**不做 `tools/list_changed` 通知**，请求-响应式 transport 收不到服务器推送。
- `McpServerStatus`（定义在 `model/mcp-tool-snapshot.ts`）：`{ serverId, state: "ready" | "failed" | "unsupported" | "disabled" | "pending", toolCount?, failure?: McpFailure, lastConnectedAt?: number }`。**server 级失败只能从这里读出**：`snapshotTools()` 对失败的 server 只是跳过，`McpToolSnapshot` 里没有它的位置。双端的状态标签与「测试连接」都读它。
- `timeoutMs` 是**单个 HTTP 请求**的上限（握手、`tools/list`、`tools/call` 各自适用），默认 120000（有些 MCP 工具本身要跑几十秒，太短会误杀；每个服务器可单独调）。装配期 `snapshotTools()` 对各 server 并行执行，单个 server 最多等 `min(timeoutMs, 8000)`；超时的 server 记为 `pending` 并在本轮跳过，不拖慢首字。预算到点时对该 server 在途的请求调 `requestAbort` 收割，不让它在后台跑满 `timeoutMs`。
- 取消：`callTool` 的 `signal` 直接取 `BuiltinToolContext.signal`，一路传到请求函数与官方 `Client.callTool`。**取消沿 `Interrupt` 返回**（开发期变更 11）：`callTool` 以 `Interrupt.cancelled`（reason 兜底 `user-stop`，MCP 拿不到 scope reason）返回，不塞进 `McpFailure`（红线的 7 个内部码里没有「取消」，硬塞会让模型把用户停止当成一次可重试的失败）；Promise 不 reject，未知异常由 `settlePromise` 收编。工具 `run` 判别到 `Interrupt` 后返回 `Result.err(new AppError("TOOL_CANCELLED", { toolName }))`——这个码在 runner 的直通名单里（`tool-runner.ts:34`），才会被收成「已取消」而不是错误卡片。
- 实现形态：`McpConnectionManagerFactory.create(deps)` 返回持有连接 Map 与快照缓存的对象（有共享可变状态，用闭包对象），不写顶层 Map 加一组自由函数。
- 子 agent：子 run 复用同一份快照（不重复 `tools/list`），经同一个 connection manager 调用。
- `snapshotTools()` 在 `runAgentTurn` 装配期 await 一次（在 `new ToolRegistry` 之后、`BuiltinTools.register` 之后）。

### 六、工具适配

```ts
toNmTool(snapshot, { call: (name, args, signal) => ... }): Tool
```

- `name`：`mcp__${slug(serverId)}__${slug(tool.name)}`；`slug` 把字符集归一到 `[a-zA-Z0-9_-]`，其余替换为 `_`。总长上限 **64 字符**（OpenAI/Anthropic 工具名限制），超出时保留前缀 + `_` + 8 位十六进制短哈希（哈希输入是完整的未截断名）。`registerMcpTools` 在注册前检查同一快照内有无重名，有则重名的都不注册，并把该 server 标为 `failed{kind:"protocol", action:"report"}`，不让整轮装配失败。
- `description`：`[MCP:${serverName}] ${tool.description ?? tool.name}`，同步取快照。
- `inputSchema`：**用 `z.unknown()` 宽松接收**，参数校验交给 MCP server（避免 JSON Schema → zod 转换的保真问题）。
- `run`：`connectionManager.callTool(serverId, toolName, input, ctx.signal)`；成功 → `renderMcpToolResult`（TextContent 拼接；Image/ResourceLink/EmbeddedResource 降级为占位文本）→ `Result.ok`；连接或协议失败 → `Result.err(new AppError("TOOL_FAILED", { toolName, detail: prefixedText, cause: failure }))`；取消（`Interrupt` 返回）→ `Result.err(new AppError("TOOL_CANCELLED", { toolName }))`，不得包成 `TOOL_FAILED` 或 `McpFailure{kind:"network"}`。落盘失败（`OverflowSink.sink` 会 throw）照 curl 先例回落到字节截断，不让异常冒出 `run`。
- `isError: true`：不抛异常，返回 `Result.err(new AppError("TOOL_FAILED", { toolName, detail: prefixedText }))`，`content` 保留原文。**全仓没有 `toolFailed` 这个函数，也不要新造**；`run` 里不出现 throw。
- 结果超过 50KB：照 curl / search 先例经 `OverflowSink.sink` 落盘，返回 `{ savedPath, message }`。

### 七、配置与密钥

```ts
export interface McpServerConfig {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly transport:
    | { readonly type: "stdio" }
    | { readonly type: "http"; readonly url: string }
    | { readonly type: "sse"; readonly url: string };   // 归一保留，首版不实现传输
  readonly timeoutMs: number;
  readonly auth:
    | { readonly type: "none" }
    | { readonly type: "bearer"; readonly secretRef: string }
    | { readonly type: "oauth" };
}
```

- KKV 模块 `nm-mcp` 存 `McpServerConfig[]`。
- 密钥走 SKSP：bearer 密钥存 `mcp/{serverId}/bearer`（配置里的 `secretRef` 就是它），自定义 header 存 `mcp/{serverId}/headers`（JSON），OAuth 令牌存 `mcp/{serverId}/oauth`。
- `type` 别名归一：`http` / `streamableHttp` / `streamable-http` / `streamable_http` → `http`；`stdio` → `stdio`；`sse` → `sse`。
- `stdio` 与 `sse` 两种类型**只归一、不实现传输**：配置可以存，但该 server 标记为不可用（归一到既有内部码：`kind: "server"`、`action: "fix-config"`，detail 为上面这句提示），不参与连接与工具快照，UI 明确提示「暂不支持 stdio / SSE，请改用 Streamable HTTP」。stdio 的 `command` / `args` / `env` / `cwd` 在归一时丢弃。
- 外部配置（如用户贴的 Claude Desktop 格式）导入时，`headers.Authorization` 自动识别为 bearer。
- `timeoutMs` 归一时钳到 `>= 1000`，不把 0 或负数交给原生层。
- 迁移口径与 search 一致：读路径容错、写路径是错误边界。

### 八、OAuth 2.1（双端）

- core 实现官方 `OAuthClientProvider` 契约。实现时以 `@modelcontextprotocol/client@2.4.0` 的类型声明为准（该包 2026-10-23 发布，exports 含 `./stdio` 与 `./_shims`）。
- **PKCE verifier 与 `state` 必须持久化**（SKSP `mcp/{serverId}/oauth` 下的独立键），不能只放内存：移动端授权期间进程可能被系统回收，回来后要先读回 verifier 才能换 token。
- **app → core 的回调接缝**只有两个入口，放在 `domain/mcp/ports/mcp-connection.port.ts`：

```ts
McpOAuth.start(serverId: string, redirectUrl: string): Promise<Result<{ authorizeUrl: string }, AppError>>;
McpOAuth.handleCallback(serverId: string, callback: { code?: string; state?: string; error?: string }): Promise<Result<void, AppError>>;
```

**端口时序**：桌面先起 `node:http` 监听、拿到实际端口拼出 redirectUrl，再调 `start(serverId, redirectUrl)`——`start` 不负责选端口。移动端的 redirectUrl 固定是 `nm://oauth/callback`。

桌面 handler 与移动 service 拿到回调后只调 `handleCallback`，不自己拼 token 请求。
- **桌面**：`shell.openExternal(authUrl)` + `node:http` 本地 server 监听 `127.0.0.1:0`（随机端口），回调页返回关闭提示。
- **移动**：`Linking.openURL` 走系统浏览器（Custom Tabs），回调走自定义 scheme `nm://oauth/callback`，在 `AndroidManifest.xml` 注册 intent-filter；`Linking.addEventListener('url')` 接住 code。
- **PKCE / DCR / resource 参数**全部由 SDK 处理（`jose` + `pkce-challenge` 是其依赖）。
- 401 且有 `resource_metadata` → 触发授权；授权失败后把 `McpFailure{kind:"auth", action:"reauthorize"}` 透给 UI。
- DCR 可能被 CIMD 取代，实现上不把 `/register` 写死为唯一路径。

### 九、catalog 双端

现有 catalog 是硬编码常量数组；MCP 工具是动态的，因此：

- catalog 模块从「导出常量数组」改为「导出 `getAgentToolCatalog(deps)` 函数」，静态分组照旧硬编码，新增 `mcp` 分组由 `deps.mcpTools()` 动态返回。**`deps.mcpTools()` 同步返回**页面打开时刻的缓存快照——现有消费方 `ToolPolicyPicker` 同步直读 `BUILTIN_TOOL_CATALOG`，不接 Promise。移动端直接读 connection manager 的缓存；桌面端 connection manager 在主进程，页面加载时经 IPC 拉一次 `toolsSnapshot` 与 `serverStatuses` 再传入。
- 验收是**结构与条目逐字对齐**（分组、条目 id、文案 key、顺序一致）；import 路径与引号风格各按平台，不要求文件逐字相同。落盘后人工对照一遍。
- MCP 分组在无可用 server 时显示为「未配置 MCP 服务器」的单项提示。

## 最终项目结构

```
packages/core/src/domain/mcp/          # 10 个文件（见「二、分层结构」）
packages/core/src/infra/mcp/           # 8 个文件（见「二、分层结构」）
packages/core/src/domain/tool/builtin/register-builtin-tools.ts   # +registerMcpTools 编排
packages/core/src/service/agent/logic/run-agent-turn.ts           # 装配期取快照并注册
apps/desktop/src/main/ipc/handlers/mcp.ts                         # 配置 CRUD + 测试连接 + OAuth
apps/mobile/src/services/mcp-oauth.service.ts                     # deep link 回调
apps/mobile/src/services/mcp-request-adapter.ts                          # 原生 request / 回落 fetch → McpRequestFn
packages/llm-sse-native/{android/.../LlmSseModule.kt, src/types.ts}    # 非流式 request 回传全部响应头
apps/mobile/src/services/llm-native-fetch-shim.ts                      # headers.get 查全头
apps/{desktop/shared,mobile/src}/config-forms/agent-tool-catalog.ts  # 改函数形态 + mcp 分组
```

## 变更点清单

| 文件 | 变更 |
|---|---|
| `domain/mcp/*`（新 10） | 配置/错误/快照模型 + 5 个纯函数模块（含 to-nm-tool）+ 2 个 port；导出形态按 nm-code-style 用 object namespace，不新增顶层裸函数 |
| `infra/mcp/*`（新 8） | transport / SSE 解析 / 官方 Client 封装 / 连接管理 / 配置 store / OAuth provider |
| `domain/tool/builtin/register-builtin-tools.ts` | 末尾接 `registerMcpTools(registry, snapshot)` |
| `service/agent/logic/run-agent-turn.ts` | 装配期 `await connectionManager.snapshotTools()` + 注册；子 run 复用同一快照；`AgentTurnRuntimePort` 加可选 `mcp?` |
| `domain/agent/logic/resolve-agent-tools.ts` | 验证 `mcp__` 复合名经 `AgentTools.resolveRegistry`（内部走 `FileTools.normalizeAgentToolPolicyName`）不被改写 |
| `apps/desktop/src/main/ipc/handlers/mcp.ts`（新） | 配置 CRUD、测试连接、OAuth 发起/回调 |
| `apps/desktop/shared/ipc-types.ts` + preload + handler-registry | 新增 `nm:mcp/*` 通道族（配置 CRUD、测试连接、OAuth 发起与回调、`toolsSnapshot` / `serverStatuses` 读取） |
| `apps/desktop/src/main/runtime/create-desktop-runtime.ts` | 装配 connection manager + OAuth provider |
| `apps/mobile/src/runtime/create-mobile-runtime.ts` | 装配 connection manager（移动端请求适配 = 原生 `request`，未注册回落 fetch；OAuth deep link） |
| `apps/mobile/src/services/mcp-oauth.service.ts`（新） | `Linking` 回调接 code → provider |
| `apps/mobile/android/app/src/main/AndroidManifest.xml` | `nm` scheme intent-filter |
| 双端 `agent-tool-catalog.ts` | 常量 → 函数 + mcp 动态分组 |
| 双端 settings UI | MCP 服务器列表/编辑/测试连接/授权状态；状态标签与错误原文读 `serverStatuses()` |
| `packages/core/package.json`（根 lock 随动） | 新增 `@modelcontextprotocol/client@^2.4.0`；应用层不加依赖 |
| `packages/llm-sse-native/android/.../LlmSseModule.kt` | 非流式 `request` 返回值带全部响应头（流式路径不动） |
| `packages/llm-sse-native/src/types.ts` | `LlmSseNativeModule.request` 返回类型加 `headers` |
| `apps/mobile/src/services/llm-native-fetch-shim.ts` | `ShimResponse.headers.get` 查全头，去掉 Content-Type 白名单 |
| `apps/mobile/src/services/mcp-request-adapter.ts`（新） | 把原生 `request` / 回落 `fetch` 包成 `McpRequestFn` |

## 详细实现步骤

- Step 1 — phase-mcp-model — blocking: yes — qa: auto：`domain/mcp/model` 三文件（配置、失败、快照）+ `parse-mcp-server-config`（含 type 别名与 `headers.Authorization` 识别）+ `slugify-mcp-tool-name`（64 字符截断 + 短哈希）。补 T-M1~T-M4。
- Step 2 — phase-mcp-model — blocking: yes — qa: auto：`classify-mcp-failure` 四层判定 + `looksLikeAuthFailure` + HTML title 提取 + 2KB 截断；入参收 params 对象（含 `wwwAuthenticate`）。补 T-M5~T-M9、T-M6a（含智谱 200+`{"code":401}`、Gram 式 200+isError、HTML 网关页、空 body 401 四个真实形态）。
- Step 3 — phase-mcp-model — blocking: yes — qa: auto：`render-mcp-tool-result`（text/image/link/embedded 四种降级）+ `to-nm-tool`（description 同步、inputSchema `z.unknown()`、run 委托）。`run` 返回 `Result`，`isError` 走 `Result.err`，超 50KB 经 `OverflowSink`。补 T-M10~T-M11。
- Step 4 — phase-mcp-store — blocking: yes — qa: auto：`infra/mcp/impl/mcp-config-store.ts`，KKV `nm-mcp` + SKSP `mcp/{id}/headers`，读路径容错、写路径返回 `Result.err`（与 search 先例一致）。补 T-M12~T-M13。
- Step 5 — phase-mcp-transport — blocking: yes — qa: auto：动手前先核对 `infra/llm-protocol/logic` 的 `sse-line-buffer` / `sse-data-line` 能否复用，能复用则不新建 `parse-sse-frames`。`parse-sse-frames`（多行 data、注释行、非法帧不炸整条流）+ `build-request-headers` + `http-mcp-transport`（session 头吸收与回带、401 读 `WWW-Authenticate`、解析失败带 raw）。整包响应后解析，只依赖注入的请求函数。补 T-M14~T-M17。
- Step 6 — phase-native-request-headers — blocking: yes — qa: auto：非流式 `request` 回传全部响应头，共三处：① Kotlin `LlmSseModule.kt` 的 `request` 返回值从 `{status, contentType, body}` 扩成带 `headers`（键名小写的全头表）；② `packages/llm-sse-native/src/types.ts` 的 `LlmSseNativeModule.request` 返回类型加 `headers: Record<string, string>`；③（顺带的一致性改动，MCP 主线不依赖它）`apps/mobile/src/services/llm-native-fetch-shim.ts` 的 `ShimResponse.headers.get` 改为查全头、大小写不敏感——它是 LLM 主通道的底座，必须带回归用例。**流式路径（`sseConnect` / `emitHeaders` / `LlmSseHeadersEvent` / `transport.ts`）与 core `SseTransport.post` 契约都不动**。旧 APK 配新 JS 时 `headers` 缺失按空对象处理。再加 `mcp-request-adapter.ts`：原生已注册走 `request`（`signal` 中止 → `requestAbort`，结果同归 `AbortError`），否则回落 `fetch`。原生 `request` 的 reject code 映射：`network` 与 `timeout` → `McpFailure{kind:"network", action:"retry"}`，`abort` → `AbortError`，`invalid` → `McpFailure{kind:"protocol", action:"report"}`（不应出现，防御性归位）。补 T-M16a / T-M16b。
- Step 7 — phase-mcp-transport — blocking: yes — qa: auto：移动端在原生 `request` 分支下对智谱端点跑通一次真实 `initialize` → `tools/list`（对智谱端点做 manual 冒烟，结果只记日志不入门禁；冒烟时顺带记录一次 `Mcp-Session-Id` 的实测读取结果；再做一次「发起 initialize 后立即中止」，确认 `requestAbort` 真断开、拿到的是 `AbortError`）。
- Step 8 — phase-mcp-client — blocking: yes — qa: auto：`official-mcp-client.ts` 包装官方 `Client`（用 `connect(transport)`，默认 legacy 握手），`McpConnectionManagerFactory.create(deps)` 实现懒连接、失败隔离、`serverStatuses()`、快照 TTL 与 `invalidate`、单请求超时与装配期 8s 预算。补 T-M18~T-M19、T-M18a。
- Step 9 — phase-mcp-tools — blocking: yes — qa: auto：`BuiltinTools.registerMcpTools` + `run-agent-turn` 装配期注册（子 run 复用快照）；`AgentTools.resolveRegistry` 验证 `mcp__` 名不被 policy 归一改写。补 T-M20~T-M21。
- Step 10 — phase-mcp-tools — blocking: yes — qa: auto：双端 catalog 加取数函数 + `mcp` 动态分组，落盘后人工对照结构与条目。
- Step 11 — phase-mcp-unsupported — blocking: yes — qa: auto：`parse-mcp-server-config` 对 `stdio` / `sse` 配置只归一、丢弃传输细节（stdio 收成 `{type:"stdio"}`），解析本身算成功。不可用的判定放在连接管理器：`serverStatuses()` 把这两类 server 报告为 `state:"unsupported"` 并带 `McpFailure{kind:"server", action:"fix-config"}`，`snapshotTools()` 跳过它们。补 T-M11a / T-M11b。
- Step 12 — phase-mcp-oauth — blocking: yes — qa: auto：`mcp-oauth-provider.ts` 实现完整的官方 provider 契约（token、`codeVerifier`、`state` 都落 SKSP）+ `McpOAuth.start` / `handleCallback` 两个入口。T-M22 覆盖 token 存取、verifier 往返与过期刷新。
- Step 13 — phase-mcp-oauth — blocking: yes — qa: manual_user：两端回调都只调 `McpOAuth.handleCallback`。桌面 loopback 回调打通（真实 OAuth server 走一遍）；移动端 deep link 回调打通（真机验证 `nm://oauth/callback`）。
- Step 14 — phase-mcp-ui — blocking: no — qa: manual_user：双端 MCP 配置页（列表 / 编辑 / 测试连接 / 授权状态 / 错误原文展示）。
  - 界面说明文字（2026-11-24 用户拍板，沿用 iOS 系统设置的做法）：
    1. **只说事实，不讲道理**。说明的是「这个选项是什么」或「关掉之后会发生什么」，不写「建议你怎样」「这样更好」这类话。
    2. **一组只出现一次**。放在一组设置的最后一行下面作为整组脚注（`FormSectionCard` 的 `hint`），不在每个输入框下面各跟一句。
    3. **只在有必要时出现**。名称、地址这种一眼就懂的字段不写提示；字段级 `FormField.hint` 只留必要的事实（单位、是否已保存）。
    4. 更长的功能说明收进页头「?」帮助弹窗，不铺在页面上（搜索引擎配置页先例）。
    5. 这条同时适用于本迭代的 MCP 配置页与 demo；nm 既有页面的说明文字清理另立迭代。
- Step 15 — phase-verify — blocking: yes — qa: auto：`tsc` + `npm test` + `check-style.mjs --all` 收口；`npx react-native bundle` 或等价手段确认 mobile bundle 未引入 `cross-spawn` / `node:child_process` / `eventsource`；记录 APK 体积增量。

## 测试策略

### 测试用例

- T-M1 — blocking: yes — `parse-mcp-server-config` 识别 `http` / `streamableHttp` / `streamable-http` / `streamable_http` / `stdio` / `sse` 六种 type 写法。
- T-M11a — blocking: yes — `stdio` 配置归一为 `{type:"stdio"}`，`command` / `args` / `env` 被丢弃、解析算成功；连接管理器的 `serverStatuses()` 把它报告为 `state:"unsupported"` 并带 `kind:"server"` / `action:"fix-config"`，detail 含「暂不支持 stdio」。
- T-M11b — blocking: yes — 含一个 `stdio` server 与一个 `http` server 时，`snapshotTools()` 只含 http server 的工具，stdio server 的失败可被 UI 读出。
- T-M2 — blocking: yes — 外部配置的 `headers.Authorization: "Bearer x"` 归一为 `auth:{type:"bearer"}` 且密钥写进 SKSP，KKV 只存 ref。
- T-M3 — blocking: yes — `slugify-mcp-tool-name` 对超长名截断到 64 字符并保留 8 位短哈希；短名原样输出。
- T-M4 — blocking: yes — `parse-mcp-server-config` 对缺 `timeoutMs` 补默认 120000、未知字段丢弃、损坏 JSON 回缺省；`timeoutMs` 为 0 或负数时归一到 1000（原生层对 `<= 0` 会落回 600 秒的默认预算）。
- T-M5 — blocking: yes — `classify({ status: 200, contentType: "application/json", body: '{"code":401,"msg":"令牌已过期"}', wwwAuthenticate: null })` → `kind:"auth"`, `action:"reauthorize"`，detail 含原文。
- T-M6 — blocking: yes — `classify({ status: 401, contentType: null, body: "", wwwAuthenticate: 'Bearer resource_metadata="https://x/.well-known/oauth-authorization-server", error="invalid_token"' })` → `auth`，detail 取自 `WWW-Authenticate`、非空。
- T-M6a — blocking: yes — `classify({ status: 200, contentType: "application/json", body: '{"code":5001,"msg":"quota exceeded"}' })` → `kind:"server"`、`action:"retry"`，detail 含 `5001`。
- T-M7 — blocking: yes — `classify({ status: 200, contentType: "text/html", body: "<html><title>502 Bad Gateway</title>…", wwwAuthenticate: null })` → `server`，detail 含 title 且长度 ≤ 2KB。
- T-M8 — blocking: yes — `classify({ status: 200, contentType: "application/json", body: '{"jsonrpc":"2.0","error":{"code":-32601}}', wwwAuthenticate: null })` → `protocol`，不被误判为业务码。
- T-M9 — blocking: yes — `looksLikeAuthFailure("401 Bad credentials")` 为 true；`looksLikeAuthFailure("file not found")` 为 false。
- T-M10 — blocking: yes — `render-mcp-tool-result` 把 text 拼接、image/link/embedded 降级为占位文本，且总量受 `tool-output-limits` 约束。
- T-M11 — blocking: yes — `toNmTool` 产出的 `description` 在无 ctx 依赖下同步可得；`inputSchema` 接受任意对象；`isError: true` 时 `run` 返回 `Result.err`（`TOOL_FAILED`）且 `detail` 含原文，不抛异常。
- T-M12 — blocking: yes — `mcp-config-store` 读写往返一致；密钥不出现在 KKV 值里。
- T-M13 — blocking: yes — 删除 server 时同时清掉对应 SKSP ref。
- T-M14 — blocking: yes — `parse-sse-frames` 正确处理多行 `data:`、`:` 注释行、`event:` 行、CRLF。
- T-M15 — blocking: yes — 流中夹一个非法帧：合法帧照常投递、非法帧只标记，流不断。
- T-M16 — blocking: yes — transport 吸收响应头 `Mcp-Session-Id` 并在下一次请求回带；`MCP-Protocol-Version` 同理。
- T-M17 — blocking: yes — 解析失败时抛出的错误对象带 `raw:{status,contentType,body}`，body 完整。
- T-M16a — blocking: yes — transport 注入只返回 `{ status, headers, bodyText }` 的 mock 请求函数（模拟移动端原生 `request` 适配：没有流、没有 `Response` 对象）时，T-M14~T-M17 全部照常成立。
- T-M16b — blocking: yes — 移动端请求适配：原生 `request` 返回值缺 `headers`（旧 APK）时按空对象处理；`signal` 中止会调 `requestAbort` 并以 `AbortError` reject；原生未注册时回落 `fetch`；shim 改后 `headers.get("Content-Type")` 在键名全小写的返回值上仍能命中（LLM 主通道回归）。
- T-M18 — blocking: yes — connection manager 对单个 server 连接失败做隔离：其他 server 的 `snapshotTools` 正常返回。
- T-M19 — blocking: yes — 快照 TTL 过期后重新 `tools/list`；`invalidate` 立即失效。
- T-M18a — blocking: yes — 含一个连不上的 server 时，`snapshotTools()` 在 8s 预算内返回其余 server 的工具；`serverStatuses()` 里该 server 为 `pending`（超时）或 `failed`（被拒），并带 `McpFailure`。
- T-M20 — blocking: yes — `registerMcpTools` 后 `registry` 含 `mcp__<server>__<tool>`；与内置工具重名时不 throw（命名空间保证）。
- T-M21 — blocking: yes — `normalizeAgentToolPolicyName("mcp__fs__read")` 原样返回，不被归一改写。
- T-M22 — blocking: yes — OAuth provider 的 token 存取往返、`redirectUrl` 稳定、过期后触发刷新；`codeVerifier` 与 `state` 写入后新建 provider 实例仍能读回。
- T-M23 — blocking: no — qa: manual_user：桌面真实 OAuth server 授权成功；移动端 deep link 回调成功。

## 风险与回滚方案

| 风险 | 影响 | 缓解 |
|---|---|---|
| `jose` / `eventsource` / `pkce-challenge` 进 mobile bundle | 体积增大、可能踩 Node 内置 | Step 15 用 `extract-mods.mjs` 检查 bundle 构成；`_shims` 走 browser 条件（metro 已配）；必要时评估 deep import 或裁剪 |
| Metro 命中 browser 条件拿到不适合 RN 的产物 | 运行时报错 | 参考 op-sqlite 先例在 `resolveRequest` 里定向；新增依赖先做一次空跑 bundle |
| 工具名超限 / 被 policy 归一改写 | 工具注册失败或调不到 | `slugify` 截断 + T-M21 专项；`AgentTools.resolveRegistry` 加专项测试 |
| 非标 server 返回 200 业务码 | 用户看到「Invalid message」 | transport 带 raw + 四层分类器；UI 展示 `detail` 原文 |
| OAuth deep link 被其他 app 抢占或 intent 不生效 | 移动端授权失败 | `AndroidManifest` 注册精确 scheme + host；失败回落「手动粘贴 token」 |
| 每 run 重连导致延迟 | 首字慢 | 连接常驻 + 快照缓存 |
| 工具数量膨胀吃上下文预算 | 模型效果下降 | agent 级 allow/deny 白名单；catalog UI 提示「启用数量过多会占用上下文」 |
| 原生 `request` 整包读取 `text/event-stream` 响应 | 服务器不关流时挂到整调用超时 | `timeoutMs` 即原生 callTimeout；超时归 `kind:"network"`、`action:"retry"` |
| 原生未注册（iOS、原生模块加载失败）回落 RN `fetch` | 回到零超时网络栈 | 回落适配自带 `AbortSignal` 定时器（`timeoutMs`），功能可用但超时语义弱于原生；发布面仅 Android，iOS 走 XHR 回落 |

**回滚**：MCP 域整体独立，`AgentTurnRuntimePort.mcp` 是可选字段——移除装配即回到「无 MCP」状态，core 其余功能零影响。`@modelcontextprotocol/client` 依赖可随域一并移除。配置数据（KKV `nm-mcp` + SKSP refs）保留不删，便于回滚后重新启用。
