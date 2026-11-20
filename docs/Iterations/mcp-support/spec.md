---
date: 2026-11-13
---

# MCP 双端接入（mcp-support）技术规格（SPEC）

## 设计目标

让 nm 支持 MCP（Model Context Protocol）工具能力，桌面与移动双端：

1. **桌面端**：stdio 传输（本地 server）+ Streamable HTTP 传输 + OAuth 2.1 授权。
2. **移动端**：Streamable HTTP 传输 + OAuth 2.1 授权（系统浏览器 + deep link 回调）；不支持 stdio（RN 无子进程）。
3. **协议层复用**：官方 `@modelcontextprotocol/client@^2.4.0` 的 `Client` 承担握手、版本协商、能力协商、分页、schema 校验；不自研协议状态机。
4. **传输层自写且两端共享**：一份 `HttpMcpTransport` 放 core，注入平台 fetch；理由不只是移动端要原生流式，更是**只有 transport 能看到 raw body，才能保住「原文透出」**。
5. **工具接入**：`mcp__<server>__<tool>` 命名空间，装配期快照（因 `Tool.description` 是同步 lambda）。
6. **非标错误归一**：6 个内部码 + `action`，原文永远透出，不做厂商标定。
7. **首版只做 tools**：不做 resources / prompts / sampling / elicitation。

不包含：旧版 SSE 双端点 transport（`type:"sse"` 配置做归一但首版不实现传输）、resources/prompts、stdio 移动端支持。与 `signal-abort-scope` spec 无耦合（MCP 侧只消费 `AbortScope` 接口，不修改它）。

## 需求来源

用户口述（2026-11-13 会话）。关键拍板：双端都含 OAuth 2.1；首版只做 tools；HTTP transport 两端共用自写实现。

## 现状约束（探索结论）

**工具系统**：

- `Tool` 接口（`domain/tool/model/tool.ts:17`）：`{ name, description: (ctx) => string, inputSchema: z.ZodType, outputSchema?, run(input, ctx): Promise<Output> }`，协议无关。
- 注册链（`run-agent-turn.ts:703`）：`new ToolRegistry` → `registerBuiltinTools`（11 个）→ `validateAgentDefinition` → `resolveAgentToolRegistry`（allow/deny + depth 过滤，`resolve-agent-tools.ts:23`）→ 组 toolCtx → runner。**每 run 重建**，子 agent 同款重建（L1109）。
- `description` 在 `agent-runner.ts:178` **同步求值** → MCP 工具清单必须是装配期快照，不能异步现查。
- `ToolRegistry.register` 重名直接 throw（`tool-registry.ts:24`），无命名空间机制。
- 结果回流：`ParallelToolOutcome{ok,output}|{ok:false,error}` → `buildToolResultBlock`（`build-tool-result-block.ts:215`）→ `ToolResultBlock{ok, content: 纯文本, summary?, meta?}`。nm 用自有 `ok` 而非 MCP 的 `isError`；`resolveToolResultOk` 兼容 `Error:` 前缀推断。
- 工具名过滤：`normalizeAgentToolPolicyName`（`vfs-tools.ts:66`），MCP 复合名需验证不被改写。
- 工具描述无截断/按需加载，但有 agent 级 allow/deny 白名单。输出侧有 `tool-output-limits.ts` 50KB/2000 行。

**配置与密钥**（search 范例）：

- `createSearchConfigStore({ kkv, secretStore })`（`domain/tool/builtin/search/search-config.ts:477`），KKV 模块名 `nm-search`，密钥走 SKSP ref `search/{engineId}/apiKey`。
- `SecretStore` port（`infra/sksp/ports/secret-store.port.ts:8`）：get/set/delete/has。desktop 是驱动 store + env composite，mobile 无 env。
- 迁移无版本字段：读路径容错归一（未知丢弃 / 缺项补尾 / 损坏回缺省），写路径是错误边界。

**catalog**：桌面 `apps/desktop/shared/config-forms/agent-tool-catalog.ts` 与移动 `apps/mobile/src/config-forms/agent/agent-tool-catalog.ts` 是硬编码中文镜像。

**网络层**：

- `llm-sse-native`（`@novel-master/llm-sse-native`）：TS 入口 `src/native.ts`，方法 `sseConnect` / `sseAbort` / `request`；四类事件 `Headers{requestId,status,contentType}` / `Chunk` / `Done` / `Error{kind}`；Kotlin 只有 `LlmSseModule.kt`（649 行）+ `LlmSsePackage.kt`。
- **headers 事件只回 `Content-Type`**（`LlmSseModule.kt:192`），其余响应头被丢弃 → MCP 拿不到 `Mcp-Session-Id`。
- 移动 shim：自定义请求头可传，响应头白名单只回 Content-Type；`response.body` 恒 `null`；仅 GET/POST + string body。
- 桌面：无 Electron net / undici / axios，core 的 `postSse` 用 `options.fetchFn ?? globalThis.fetch`（`llm-sse-transport.ts:596`），Electron 35.7.5 = Node 22，流式 `response.body` 可用。
- core 是三分支（native → XHR → fetch），`SseTransport.post` 返回 `{status, contentType}`，**响应头被丢弃是既有契约**。

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
| `apps/desktop` | 同版本（workspace hoist 成一份） | 只 import `@modelcontextprotocol/client/stdio` |

**硬规则：core 永不 import `./stdio` 或 `cross-spawn`**，否则 Metro 会把子进程依赖打进 mobile bundle。stdio transport 由 desktop 主进程构造后经 port 注入。

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
  logic/parse-sse-frames.ts            # 逐帧 SSE 解析（含多行 data / 注释行）
  logic/build-request-headers.ts       # 认证 + session + protocol version
  impl/http-mcp-transport.ts           # 两端共享，注入 fetchFn
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
  readonly lastRawResponse: RawMcpResponse | null;
  setProtocolVersion?(version: string): void;
  onmessage?: (message: JsonRpcMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
}
```

关键行为：

- POST，`Accept: application/json, text/event-stream`，`Content-Type: application/json`。
- 响应按 `content-type` 分支：`text/event-stream` → 逐帧解析；`application/json` → 整包解析；其他 → 记 `lastRawResponse` 后抛 `McpTransportError`。
- **逐帧判定**：合法 JSON-RPC 帧照常投递；非法帧只标记并记原文，不作废整条流。
- 吸收 `Mcp-Session-Id`（响应头）与 `MCP-Protocol-Version`；后续请求带回。
- 401 时读 `WWW-Authenticate`（`resource_metadata` / `error="invalid_token"`），交给 OAuth provider。
- **解析失败时把 raw 塞进错误对象**（`McpTransportError.raw`），这是「原文透出」能成立的唯一前提。

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
3. **body 形状**：有 `jsonrpc` 字段 → 标准 JSON-RPC，按 `error.code` 映射；否则匹配业务码形状（`{code,msg}` / `{error:{code,message}}` / `{error_code,error_msg}`）→ 归 `auth`/`business` 语义（401 业务码仍是 `auth`）。
4. **isError 文本嗅探**（`looksLikeAuthFailure`）：匹配 `401|unauthorized|invalid.?token|expired|credential|api.?key|forbidden` → 升级为 `auth`/`permission`。

**红线**：内部码只有这 7 个，不再细分；detail 永远带原文；`isError: true` 的结果不抛异常，走 `ok:false` + 原文 + 提示前缀。

### 五、连接管理

```ts
export interface McpConnectionManager {
  snapshotTools(): Promise<readonly McpToolSnapshot[]>;      // 装配期调用，带缓存
  callTool(serverId: string, toolName: string, args: unknown, scope: AbortScope): Promise<ToolCallOutcome>;
  invalidate(serverId: string): void;
  closeAll(): Promise<void>;
}
```

- **常驻连接**（懒连接、按 serverId 索引）：stdio 反复 spawn 开销大，HTTP 建连也有成本。
- 单个 server 连接失败**隔离**：记录 `McpFailure` 并跳过，其余 server 照常。
- 快照 TTL 60s + `tools/list_changed` 通知失效。
- `snapshotTools()` 在 `runAgentTurn` 装配期 await 一次（在 `new ToolRegistry` 之后、`registerBuiltinTools` 之后）。

### 六、工具适配

```ts
toNmTool(snapshot, { call: (name, args, scope) => ... }): Tool
```

- `name`：`mcp__${slug(serverId)}__${slug(tool.name)}`；总长上限 **64 字符**（OpenAI/Anthropic 工具名限制），超出时保留前缀 + `_` + 8 位短哈希。
- `description`：`[MCP:${serverName}] ${tool.description ?? tool.name}`，同步取快照。
- `inputSchema`：**用 `z.unknown()` 宽松接收**，参数校验交给 MCP server（避免 JSON Schema → zod 转换的保真问题）。
- `run`：`connectionManager.callTool(...)` → `renderMcpToolResult`（TextContent 拼接；Image/ResourceLink/EmbeddedResource 降级为占位文本）。
- `isError: true` → throw `toolFailed(name, new Error(prefixedText))`，`content` 保留原文。

### 七、配置与密钥

```ts
export interface McpServerConfig {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly transport:
    | { readonly type: "stdio"; readonly command: string; readonly args: readonly string[]; readonly env: Readonly<Record<string,string>>; readonly cwd?: string }
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
- 密钥走 SKSP：自定义 header 存 `mcp/{serverId}/headers`（JSON），OAuth 令牌存 `mcp/{serverId}/oauth`。
- `type` 别名归一：`http` / `streamableHttp` / `streamable-http` / `streamable_http` → `http`；`stdio` → `stdio`；`sse` → `sse`。
- 外部配置（如用户贴的 Claude Desktop 格式）导入时，`headers.Authorization` 自动识别为 bearer。
- 迁移口径与 search 一致：读路径容错、写路径是错误边界。

### 八、OAuth 2.1（双端）

- core 实现官方 `OAuthClientProvider` 契约（token 读写走 SKSP；`redirectUrl` / `clientMetadata` / `saveClientInformation` / `clientInformation`）。实现时以 `@modelcontextprotocol/client@2.4.0` 实际导出为准。
- **桌面**：`shell.openExternal(authUrl)` + `node:http` 本地 server 监听 `127.0.0.1:0`（随机端口），回调页返回关闭提示。
- **移动**：`Linking.openURL` 走系统浏览器（Custom Tabs），回调走自定义 scheme `nm://oauth/callback`，在 `AndroidManifest.xml` 注册 intent-filter；`Linking.addEventListener('url')` 接住 code。
- **PKCE / DCR / resource 参数**全部由 SDK 处理（`jose` + `pkce-challenge` 是其依赖）。
- 401 且有 `resource_metadata` → 触发授权；授权失败后把 `McpFailure{kind:"auth", action:"reauthorize"}` 透给 UI。
- DCR 可能被 CIMD 取代，实现上不把 `/register` 写死为唯一路径。

### 九、catalog 双端

现有 catalog 是硬编码常量数组；MCP 工具是动态的，因此：

- catalog 模块从「导出常量数组」改为「导出 `getAgentToolCatalog(deps)` 函数」，静态分组照旧硬编码，新增 `mcp` 分组由 `deps.mcpTools()` 动态返回。
- 两端实现**逐字一致**（含标点与引号风格），落盘后必须人工 diff 一遍。
- MCP 分组在无可用 server 时显示为「未配置 MCP 服务器」的单项提示。

## 最终项目结构

```
packages/core/src/domain/mcp/          # 9 个文件（见上）
packages/core/src/infra/mcp/           # 7 个文件（见上）
packages/core/src/domain/tool/builtin/register-builtin-tools.ts   # +registerMcpTools 编排
packages/core/src/service/agent/logic/run-agent-turn.ts           # 装配期取快照并注册
apps/desktop/src/main/mcp/stdio-transport.factory.ts              # 官方 ./stdio 封装
apps/desktop/src/main/ipc/handlers/mcp.ts                         # 配置 CRUD + 测试连接 + OAuth
apps/mobile/src/services/mcp-oauth.service.ts                     # deep link 回调
apps/{desktop/shared,mobile/src}/config-forms/agent-tool-catalog.ts  # 改函数形态 + mcp 分组
```

## 变更点清单

| 文件 | 变更 |
|---|---|
| `domain/mcp/*`（新 9） | 配置/错误/快照模型 + 4 个纯函数 + 2 个 port |
| `infra/mcp/*`（新 7） | transport / SSE 解析 / 官方 Client 封装 / 连接管理 / 配置 store / OAuth provider |
| `domain/tool/builtin/register-builtin-tools.ts` | 末尾接 `registerMcpTools(registry, snapshot)` |
| `service/agent/logic/run-agent-turn.ts` | 装配期 `await connectionManager.snapshotTools()` + 注册；`AgentTurnRuntimePort` 加可选 `mcp?` |
| `domain/agent/logic/resolve-agent-tools.ts` | 验证 `mcp__` 复合名经 `normalizeAgentToolPolicyName` 不被改写 |
| `apps/desktop/src/main/ipc/handlers/mcp.ts`（新） | 配置 CRUD、测试连接、OAuth 发起/回调 |
| `apps/desktop/shared/ipc-types.ts` + preload + handler-registry | 新增 `nm:mcp/*` 通道族 |
| `apps/desktop/src/main/runtime/create-desktop-runtime.ts` | 装配 connection manager + stdio factory + OAuth provider |
| `apps/mobile/src/runtime/create-mobile-runtime.ts` | 装配 connection manager（仅 http + OAuth deep link） |
| `apps/mobile/src/services/mcp-oauth.service.ts`（新） | `Linking` 回调接 code → provider |
| `apps/mobile/android/app/src/main/AndroidManifest.xml` | `nm` scheme intent-filter |
| 双端 `agent-tool-catalog.ts` | 常量 → 函数 + mcp 动态分组 |
| 双端 settings UI | MCP 服务器列表/编辑/测试连接/授权状态 |
| 根 `package.json` / `packages/core/package.json` / `apps/desktop/package.json` | 新增 `@modelcontextprotocol/client` |

## 详细实现步骤

- Step 1 — phase-mcp-model — blocking: yes — qa: auto：`domain/mcp/model` 三文件（配置、失败、快照）+ `parse-mcp-server-config`（含 type 别名与 `headers.Authorization` 识别）+ `slugify-mcp-tool-name`（64 字符截断 + 短哈希）。补 T-M1~T-M4。
- Step 2 — phase-mcp-model — blocking: yes — qa: auto：`classify-mcp-failure` 四层判定 + `looksLikeAuthFailure` + HTML title 提取 + 2KB 截断。补 T-M5~T-M9（含智谱 200+`{"code":401}`、Gram 式 200+isError、HTML 网关页、空 body 401 四个真实形态）。
- Step 3 — phase-mcp-model — blocking: yes — qa: auto：`render-mcp-tool-result`（text/image/link/embedded 四种降级）+ `to-nm-tool`（description 同步、inputSchema `z.unknown()`、run 委托）。补 T-M10~T-M11。
- Step 4 — phase-mcp-store — blocking: yes — qa: auto：`infra/mcp/impl/mcp-config-store.ts`，KKV `nm-mcp` + SKSP `mcp/{id}/headers`，读路径容错、写路径抛域错误。补 T-M12~T-M13。
- Step 5 — phase-mcp-transport — blocking: yes — qa: auto：`parse-sse-frames`（多行 data、注释行、非法帧不炸整条流）+ `build-request-headers` + `http-mcp-transport`（session 头吸收与回带、401 读 `WWW-Authenticate`、解析失败带 raw）。补 T-M14~T-M17。
- Step 6 — phase-native-headers — blocking: yes — qa: auto：`LlmSseModule.kt:192` 的 `emitHeaders` 扩为全头 WritableMap；`types.ts` 的 `LlmSseHeadersEvent` 加 `headers` 字段；`transport.ts:284-297` 解析并把全头回传；core `SseTransport.post` 返回类型扩 headers；XHR 分支补 `getAllResponseHeaders`、fetch 分支补 `Object.fromEntries(headers)`。
- Step 7 — phase-mcp-transport — blocking: yes — qa: auto：移动端注入 native fetch 分支下跑通一次真实 `initialize` → `tools/list`（对智谱端点做 manual 冒烟，结果只记日志不入门禁）。
- Step 8 — phase-mcp-client — blocking: yes — qa: auto：`official-mcp-client.ts` 包装官方 `Client`（用 `connect(transport)`，默认 legacy 握手），`create-mcp-connection-manager.ts` 实现懒连接、失败隔离、快照 TTL 与 `invalidate`。补 T-M18~T-M19。
- Step 9 — phase-mcp-tools — blocking: yes — qa: auto：`registerMcpTools` + `run-agent-turn` 装配期注册；`resolveAgentToolRegistry` 验证 `mcp__` 名不被 policy 归一改写。补 T-M20~T-M21。
- Step 10 — phase-mcp-tools — blocking: yes — qa: auto：双端 catalog 改函数形态 + `mcp` 动态分组，落盘后人工逐字 diff 两端镜像。
- Step 11 — phase-mcp-stdio — blocking: yes — qa: auto：桌面 `stdio-transport.factory.ts` 用官方 `./stdio`（`command` + `args` + `env`），进程生命周期绑 connection manager；`command` 允许绝对路径（Windows PATH 不可靠）。
- Step 12 — phase-mcp-oauth — blocking: yes — qa: auto：`mcp-oauth-provider.ts` 实现官方 provider 契约（SKSP 存 token、`redirectUrl`、`clientMetadata`）；订单 T-M22 覆盖 token 存取与过期刷新。
- Step 13 — phase-mcp-oauth — blocking: yes — qa: manual_user：桌面 loopback 回调打通（真实 OAuth server 走一遍）；移动端 deep link 回调打通（真机验证 `nm://oauth/callback`）。
- Step 14 — phase-mcp-ui — blocking: no — qa: manual_user：双端 MCP 配置页（列表 / 编辑 / 测试连接 / 授权状态 / 错误原文展示）。
- Step 15 — phase-verify — blocking: yes — qa: auto：`tsc` + `npm test` + `check-style.mjs --all` 收口；`npx react-native bundle` 或等价手段确认 mobile bundle 未引入 `cross-spawn` / `node:child_process`；记录 APK 体积增量。

## 测试策略

### 测试用例

- T-M1 — blocking: yes — `parse-mcp-server-config` 识别 `http` / `streamableHttp` / `streamable-http` / `stdio` / `sse` 五种 type 写法。
- T-M2 — blocking: yes — 外部配置的 `headers.Authorization: "Bearer x"` 归一为 `auth:{type:"bearer"}` 且密钥写进 SKSP，KKV 只存 ref。
- T-M3 — blocking: yes — `slugify-mcp-tool-name` 对超长名截断到 64 字符并保留 8 位短哈希；短名原样输出。
- T-M4 — blocking: yes — `parse-mcp-server-config` 对缺 `timeoutMs` 补默认、未知字段丢弃、损坏 JSON 回缺省。
- T-M5 — blocking: yes — `classifyMcpFailure(200, "application/json", '{"code":401,"msg":"令牌已过期"}')` → `kind:"auth"`, `action:"reauthorize"`，detail 含原文。
- T-M6 — blocking: yes — `classifyMcpFailure(401, null, "")` → `auth`，detail 非空（从 `WWW-Authenticate` 兜底）。
- T-M7 — blocking: yes — `classifyMcpFailure(200, "text/html", "<html><title>502 Bad Gateway</title>…")` → `server`，detail 含 title 且长度 ≤ 2KB。
- T-M8 — blocking: yes — `classifyMcpFailure(200, "application/json", '{"jsonrpc":"2.0","error":{"code":-32601}}')` → `protocol`，不被误判为业务码。
- T-M9 — blocking: yes — `looksLikeAuthFailure("401 Bad credentials")` 为 true；`looksLikeAuthFailure("file not found")` 为 false。
- T-M10 — blocking: yes — `render-mcp-tool-result` 把 text 拼接、image/link/embedded 降级为占位文本，且总量受 `tool-output-limits` 约束。
- T-M11 — blocking: yes — `toNmTool` 产出的 `description` 在无 ctx 依赖下同步可得；`inputSchema` 接受任意对象。
- T-M12 — blocking: yes — `mcp-config-store` 读写往返一致；密钥不出现在 KKV 值里。
- T-M13 — blocking: yes — 删除 server 时同时清掉对应 SKSP ref。
- T-M14 — blocking: yes — `parse-sse-frames` 正确处理多行 `data:`、`:` 注释行、`event:` 行、CRLF。
- T-M15 — blocking: yes — 流中夹一个非法帧：合法帧照常投递、非法帧只标记，流不断。
- T-M16 — blocking: yes — transport 吸收响应头 `Mcp-Session-Id` 并在下一次请求回带；`MCP-Protocol-Version` 同理。
- T-M17 — blocking: yes — 解析失败时抛出的错误对象带 `raw:{status,contentType,body}`，body 完整。
- T-M18 — blocking: yes — connection manager 对单个 server 连接失败做隔离：其他 server 的 `snapshotTools` 正常返回。
- T-M19 — blocking: yes — 快照 TTL 过期后重新 `tools/list`；`invalidate` 立即失效。
- T-M20 — blocking: yes — `registerMcpTools` 后 `registry` 含 `mcp__<server>__<tool>`；与内置工具重名时不 throw（命名空间保证）。
- T-M21 — blocking: yes — `normalizeAgentToolPolicyName("mcp__fs__read")` 原样返回，不被归一改写。
- T-M22 — blocking: yes — OAuth provider 的 token 存取往返、`redirectUrl` 稳定、过期后触发刷新。
- T-M23 — blocking: no — qa: manual_user：桌面真实 OAuth server 授权成功；移动端 deep link 回调成功。

## 风险与回滚方案

| 风险 | 影响 | 缓解 |
|---|---|---|
| `jose` / `eventsource` / `pkce-challenge` 进 mobile bundle | 体积增大、可能踩 Node 内置 | Step 15 用 `extract-mods.mjs` 检查 bundle 构成；`_shims` 走 browser 条件（metro 已配）；必要时评估 deep import 或裁剪 |
| Metro 命中 browser 条件拿到不适合 RN 的产物 | 运行时报错 | 参考 op-sqlite 先例在 `resolveRequest` 里定向；新增依赖先做一次空跑 bundle |
| 工具名超限 / 被 policy 归一改写 | 工具注册失败或调不到 | `slugify` 截断 + T-M21 专项；`resolveAgentToolRegistry` 加断言 |
| stdio 进程泄漏（run 结束不关） | 后台进程堆积 | 连接常驻 + `closeAll()` 挂应用退出；`enable` 切换与配置删除时显式 `invalidate` + kill |
| 非标 server 返回 200 业务码 | 用户看到「Invalid message」 | transport 带 raw + 四层分类器；UI 展示 `detail` 原文 |
| OAuth deep link 被其他 app 抢占或 intent 不生效 | 移动端授权失败 | `AndroidManifest` 注册精确 scheme + host；失败回落「手动粘贴 token」 |
| 每 run 重连导致延迟 | 首字慢 | 连接常驻 + 快照缓存；stdio 懒启动 |
| 工具数量膨胀吃上下文预算 | 模型效果下降 | agent 级 allow/deny 白名单；catalog UI 提示「启用数量过多会占用上下文」 |

**回滚**：MCP 域整体独立，`AgentTurnRuntimePort.mcp` 是可选字段——移除装配即回到「无 MCP」状态，core 其余功能零影响。`@modelcontextprotocol/client` 依赖可随域一并移除。配置数据（KKV `nm-mcp` + SKSP refs）保留不删，便于回滚后重新启用。
