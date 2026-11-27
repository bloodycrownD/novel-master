---
date: 2026-11-27
---

# MCP 连接模型与工具定义重构 技术规格（SPEC）

## 需求来源

用户口述（无 prd.md），2026-11-26 ~ 11-27 讨论。参照 `.reference/ZCode` 与 `.reference/pi` 两份实现：均在连接时拉一次工具清单、无过期时间、参数定义原样给模型、连接失败清空工具、调用掉线时重连一次。本规格是 `docs/Iterations/mcp-support/spec.md` 的后续，推翻其中「快照 TTL 60s」「发消息时装配期连接」「JSON Schema 转 zod」「按服务器逐个工具进智能体勾选」四项。

### 用户拍板的结论

| 议题 | 结论 |
| --- | --- |
| 三份数据 | 配置（存盘，用户编辑）；连接状态（内存，由「连接」的结果写）；工具定义（内存缓存，只在拉取成功时整体替换） |
| 联网动作 | 只有「连接」（握手 + 拉清单）和「调用」两种；读三份数据都不联网 |
| 进聊天页 / MCP 配置页 | 只对「从未尝试」「已断开」发起连接；已连接、连接中、已失败不动。进页面高频，已连接的**不重拉** |
| 开关打开 / 保存 / 测试连接 | 作废该服务器缓存并发起连接；测试连接等结果 |
| 发消息 | 只读缓存，不联网、不等待 |
| 调用时掉线 | 网络类失败或会话失效 → 重连一次并重试调用一次；期间工具定义保留。重连也失败 → 记「已断开」，工具保留，下次进页面再试；再失败仍是已断开 |
| 从未连上过 | 连接失败 → 「已失败」，清空工具，进页面不重试 |
| 过期时间 / 推送 | 都没有。工具定义只靠上面三个主动动作更新 |
| 推送通道（GET 流） | 不做（用户裁定收益小于成本） |
| 参数定义 | 工具类型拆两种：自带工具带 zod 并本地校验；外部工具（MCP）的参数定义原样给模型，不本地校验 |
| 智能体配置里的 MCP | 移除逐个工具勾选；工具列表加一项「MCP」，是抽象开关，表示是否允许该智能体使用 MCP；智能体名单里只存 `mcp` 一个词，不存任何具体工具名；具体哪些工具可用在 MCP 详情页逐个开关（已有） |
| 默认模式的智能体 | MCP 工具可用 |

### 讨论中定下的细目（标「自定」的是撰写时自定、用户未明说，可推翻）

| 项 | 取值 | 理由 |
| --- | --- | --- |
| 智能体策略里的名字 | `mcp` | 自定；与 `search`、`curl` 同级 |
| `allow` 列表里没有 `mcp` | 视为不允许 | 自定；与 allow 列表「未列出即排除」一致 |
| 「MCP」这一项的说明文字 | 只陈述事实：zh「MCP 服务器提供的工具」 | 自定；界面说明文字约定 |
| 「MCP」这一项的性质 | 抽象开关：智能体名单里只存 `mcp` 一个词，不存任何具体的 MCP 工具名 | 用户 2026-11-27 明确；因此不存在工具名随服务器 ID 变化的问题 |
| 「默认使用全部内置工具（N 个）」提示 | 数 12 个（11 个自带 + MCP） | 用户拍板：「MCP 算内置工具」 |
| 未声明参数定义的 MCP 工具 | 给模型 `{type:"object", properties:{}}` | 自定；两家参照的做法，部分厂商拒绝没有 `properties` 的对象定义 |
| 会话失效的识别 | HTTP 404 且该服务器此前持有会话 | 自定；只有这种情况 404 才表示会话失效，地址配错的 404 不重连 |
| 桌面端「进聊天页」的对应时机 | 应用启动后、每次切换会话后 | 自定；桌面没有等价的「进聊天页」钩子 |
| 已断开的显示 | 有原因显示原因，否则显示「已断开」 | 自定；与「未连接（从未尝试）」区分 |
| 调用时重连失败的原因是认证类 | 同样记已断开 | 自定；重新授权后用测试连接恢复 |

## 设计目标

1. 发消息不再被 MCP 连接拖慢或静默丢工具：装配只读缓存。
2. 工具定义不凭空过期；只在明确动作后变化。
3. 网络抖动不让工具消失：调用时重连一次，失败记「已断开」而非删除。
4. MCP 参数定义与服务器声明完全一致，不存在转换失败。
5. 智能体配置只决定「用不用 MCP」，逐个工具的启停归 MCP 详情页。

## 现状约束（探索得出，不可动的边界）

| 约束 | 证据 |
| --- | --- |
| `Tool` 从主桶导出（`src/index.ts:120`），两端只在值层面用 `BuiltinTools` / `ToolRegistry`，不引用 `Tool` 类型 | apps 内零引用 |
| 真正读 zod 的生产代码只有两处：`ToolRunner.call`（入参 `:99`、出参 `:136`）与 `ToolDefinitions.fromRegistry`（`tool-definitions.ts:24`） | 三家适配器与 token 估算拿到的已是 `LlmToolDefinition`（`inputSchema: Record<string, unknown>`） |
| 自带工具不用 `z.coerce` / `.transform` / `.pipe`，只有 3 处 `.default` / `.refine` | 拆类型后自带工具零改动 |
| 连接管理器的三条既定规则必须保留：连接中状态同步落表（重复触发共享一次尝试）；代际守卫（`invalidate` / `closeAll` 后在途结果不写回）；取消是控制流，不写连接状态（唯一例外：重连握手期间的取消，见总体方案 C 节） | `create-mcp-connection-manager.ts:99, 216, 262` |
| 没有推送通道，也没有任何 `onclose` 订阅：掉线只能在调用时发现 | `http-mcp-transport.ts:6-7`；core 内无人注册 `onclose` |
| 会话失效（404）目前落不进任何分类规则，响应体含 `expired` 还会被误判为 `auth` | `classify-mcp-failure.ts:46, 55-94` |
| 两端保存智能体时都用「只含 11 个自带工具」的名单校验，所以 `mcp` 必须被校验层当作已知名，否则勾了 MCP 的智能体保存会失败 | `AgentEditorForm.tsx:192-196`、`handlers/agent-registry.ts:130-134` |
| 子智能体不继承父策略，按自己的 `tools.allow/deny` 解析 | `run-agent-turn.ts:1368-1370` |
| 移动端聊天标签页切换不重挂载，`ChatTabProvider` 已有 `useFocusEffect` | `RootNavigator.tsx:64-71`、`ChatTabProvider.tsx:435-441` |
| 桌面端 preload 的 `invoke` 是通用的，新增 IPC 通道不用改 preload | `preload.ts:44-45` |
| `closeAll` 两端各一处：桌面退出前（≤1.5s），移动端 runtime 重建前 | `main.ts:194-211`、`novel-master-context.tsx:240-242` |

## 总体方案

### A. 工具类型拆两种

```ts
// packages/core/src/domain/tool/model/tool.ts
interface Tool<Input, Output, Ctx = unknown> {            // 自带工具，保持不变
    name; description: (ctx) => string; inputSchema: z.ZodType<Input>; outputSchema?: z.ZodType<Output>;
    run(input, ctx): Promise<Result<Output, AppError>>;
}
interface ExternalTool<Ctx = unknown> {                   // 外部工具：参数定义是现成的 JSON Schema
    name; description: (ctx) => string;
    inputJsonSchema: Readonly<Record<string, unknown>>;
    run(input: unknown, ctx): Promise<Result<unknown, AppError>>;
}
type RegisteredTool<Ctx = unknown> = Tool<any, any, Ctx> | ExternalTool<Ctx>;
```

判别方式：`"inputSchema" in tool`。`ToolRegistry` / `ToolRunner` / `ToolDefinitions.fromRegistry` 接受 `RegisteredTool`。执行器对外部工具跳过入参、出参校验，原始参数直接给 `run`，路径白名单检查照旧（它本就接受 `unknown`）。

`McpToolAdapter.toNmTool` 返回 `ExternalTool`，删除 `inputSchemaOf`（`z.fromJSONSchema` 及其回退）。

### B. 连接状态机

| 状态 | 含义 | 工具缓存 | 进页面 | 显式动作 |
| --- | --- | --- | --- | --- |
| `pending` | 启用但从未尝试 | 空 | 连接 | 连接 |
| `connecting` | 一次尝试进行中 | 不变 | 跳过 | 作废在途，重新连接 |
| `ready` | 已连接 | 有 | 不动 | 作废后连接 |
| `disconnected`（新增） | 曾连上，调用时发现断了且重连失败 | **保留** | 连接 | 作废后连接 |
| `failed` | 从未连上过，或撞名 ¹ | 空 ¹ | 跳过 | 连接 |
| `disabled` / `unsupported` | 开关关 / 传输类型不支持 | 空 | — | — |

¹ 撞名的服务器记 `failed{protocol, report}`，但缓存条目保留（撞名是注册名冲突，不是连接故障，恢复后不必重连）；`cachedTools()` 不返回它们的工具。

连接的结果。「保持已断开」只适用于**不作废**的入口（进页面、调用时重连）；显式动作先作废，等同一次全新连接：

| 入口 | 起点 | 连接成功 | 连接失败 |
| --- | --- | --- | --- |
| 进页面 | `pending` | `ready`，写缓存 | `failed`，清缓存 |
| 进页面 | `disconnected` | `ready`，替换缓存 | **仍 `disconnected`**，更新原因，缓存保留 |
| 调用时重连 | `ready`（旧连接已关） | `ready`，替换缓存 | `disconnected`，缓存保留 |
| 调用时重连 | `disconnected`（缓存里的工具仍可被模型调用） | `ready`，替换缓存，然后执行这次调用 | **仍 `disconnected`**，更新原因，缓存保留，本次调用按失败返回 |
| 显式动作（开关 / 保存 / 测试连接 / 授权成功） | 任意 | `ready`，替换缓存 | `failed`，清缓存 |
| 显式动作 | `disabled` / `unsupported` | 不连接，原样返回当前状态 | 同左 |



调用：

| 调用结果 | 处理 |
| --- | --- |
| 成功 | 返回 |
| 调用起点是 `pending` / `failed`（缓存里没有它的工具，正常流程调不到；回合进行中服务器被显式动作打成已失败后，本回合已注册的旧工具仍可能被模型调到） | 不连接（现状会在这里悄悄连上并变成已连接，本次改掉），状态不变，返回失败 `kind:"unknown"`（action 按 `report`），detail「服务器未连接」 |
| 调用起点是 `connecting`（后台或显式动作的重连在途） | 共享那次握手，不另起一个；握手成功 → 照常执行本次调用；握手失败 → 按那次失败返回，不重试 |
| 服务器明确报的错（`auth` / `permission` / `rate-limit` / `server` / `protocol` / `unknown`、工具自身 `isError`）、以及**单次请求超时**（等待响应超过 `timeoutMs`） | 原样返回，连接状态不变，缓存不变（现状是任何调用失败都记 `failed`，本次改掉）。单次请求超时不重连：服务器可能仍在执行，重试会让同一个工具被执行两次 |
| 连接级失败（请求没发出去、连接被断开，即没有拿到 HTTP 响应的网络类失败）或会话失效（404 且此前持有会话） | 关掉旧连接、**保留缓存**，重连一次并重试调用一次 |
| ↳ 重连成功，重试的调用也成功 | `ready`，缓存替换，返回重试结果 |
| ↳ 重连成功，重试的调用又失败 | `ready`，缓存替换，按那次失败原样返回，不再第二次重连 |
| ↳ 重连失败（不论失败类别，含令牌过期导致的 `auth`） | `disconnected`，缓存保留，返回失败 |
| 用户取消 | `Interrupt`，状态不变（唯一例外：取消落在重连握手期间 → `disconnected`，见 C 节） |

重连与重试复用调用方传入的同一个 `signal`，中途取消按「用户取消」处理。

撞名检测（`markSlugConflicts`）在读取时执行：`cachedTools()` 与 `serverStatuses()` 每次调用都对全部已缓存的服务器同步扫一遍（不联网，数量很小）。读取时检测能覆盖所有会让冲突出现或消失的入口——写缓存、`invalidate`（对端被停用或删除）、用户在详情页开关某个工具（这个动作不经过连接管理器，也不写缓存）。规则：(a) 撞名的服务器两边一并标记；**冲突消失时清除标记**，状态按「连接还在不在」恢复而不是一律恢复成已连接：条目的连接还在 → `ready`，连接已不在 → `disconnected`（撞名只发生在有缓存的服务器上，所以不会恢复成别的）；(b) 检测前先按 `disabledTools` 过滤，被用户关掉的工具不参与撞名；(c) 涉事服务器的缓存条目保留。注册侧（`registerMcpTools`）另保留「同名只注册第一个」的去重作为最后防线，不让重复名走到注册表的断言上。

### C. 端口变更

```ts
export interface McpConnectionManager {
    /** 只读缓存，同步，不建连不发请求。只返回「启用、传输受支持、未撞名、未处于 failed」服务器的、未被 deps.disabledTools 关掉的工具。 */
    cachedTools(): readonly McpToolSnapshot[];
    /** 进页面触发：对每个启用服务器只看本地状态，pending / disconnected 并发发起后台连接，其余不动。
     *  返回的 Promise 在「本次发起的尝试」以及「撞上的进行中尝试」都结束后才 resolve（永不 reject）；聊天页可以不等，配置页等它来刷新状态。 */
    connectUnconnected(): Promise<void>;
    /** 显式动作（开关打开 / 保存 / 测试连接 / 授权成功）：作废该服务器缓存与在途尝试，连接并等结果。
     *  serverId 不在配置里属不变量破坏，走 assert。 */
    connect(serverId: string): Promise<McpServerStatus>;
    serverStatuses(): readonly McpServerStatus[];
    callTool(serverId, toolName, args, signal): Promise<Result<unknown, McpFailure> | Interrupt>;
    /** 停用 / 删除 / 换 ID：作废，不连接。 */
    invalidate(serverId: string): void;
    closeAll(): Promise<void>;
}
```

- `snapshotTools` 改名 `cachedTools` 并改为同步：它不再有异步语义，保留 `Promise` 只会让人以为它会联网。
- 删除 `MCP_SNAPSHOT_TTL_MS` 与 `snapshotFor` 的过期分支；deps 的 `assemblyBudgetMs` 改名 `connectBudgetMs`（默认 8000 不变），它现在只约束「连接」这一步。
- `connectOnce` + `fetchSnapshot` 合成内部唯一的「连接」步骤，三个入口（`connectUnconnected` / `connect` / 调用时重连）共用；每个入口进入时取代际，写回前校验（沿用现有守卫）。「连接中」状态在该步骤的**首个 `await` 之前**同步落表。
- 「重复触发共享一次尝试」只约束不作废的入口（`connectUnconnected` 的重复调用、调用时重连撞上进行中的后台连接）；`connect` 一律先作废，作废前先关掉该服务器的旧连接（不等待关闭完成）。沿用现状：后来者共用首次握手时，首个调用者的 signal 约束这次握手；没有调用方 signal 的入口只受连接预算约束，有调用方 signal 的入口把两者合起来用（任一触发即中止）。
- 调用时重连**不递增代际**，只关掉旧 client、清 `client` 字段，保留 `snapshots`。
- **重连判据在 `callTool` 处读原始错误**，不读分类结果：① `McpTransportError` 且没有 HTTP 响应（`raw` 为空）；② HTTP 404 且该服务器 `heldSession`。SDK 的单次请求超时（`SdkError` / `RequestTimeout`）不满足①②，所以不重连——它在分类结果里和「没有拿到响应」同为 `network`，从分类结果上分不出来。命中判据②的那次失败在「是否重连」上视同连接级失败；重连后的重试若仍 404，按普通失败分类原样返回（此时是新会话，不再满足②）。不改 `McpFailureClassifier`，7 个内部码不增。
- 会话失效的读取：`OfficialMcpClient` 新增只读访问器 `sessionId`（转发到底层传输）；判据直接读当前 client 的 `sessionId`（在关旧 client 之前读，`close()` 会清掉会话编号）；连接条目不另存会话标记。
- **取消落在重连握手期间**（旧连接已关、握手未完成时用户点停止）：条目写回 `disconnected`，缓存保留，返回 `Interrupt.cancelled`。不这样做的话条目会停在「连接中」，而进页面对「连接中」不动，永远卡住。「取消不写连接状态」的例外只有这一处。握手期间如果是**连接预算到点**（不是用户取消）而中止，按失败返回（`Result.err`），状态同样是 `disconnected`；只有调用方 signal 确实已中止才算取消。如果撞上的握手不是本调用发起的（与后台入口共享的那次），它不受本调用 signal 约束，会按自己的结果写回状态；本调用只按「用户取消」返回，不改状态——这种握手会自行结束，不存在卡住的问题。
- 所有状态写回（已断开、撞名标记、清除标记恢复）都保留条目原有的 `lastConnectedAt`（现状撞名标记会丢掉它，顺手改掉）。

### D. 智能体策略里的「MCP」：一个和其他工具平等的占位工具

MCP 是一个工具集合，在策略层面当作**一个普通工具**处理，不加任何特判：

1. `BuiltinTools.register` 在 11 个自带工具之外，多注册一个名为 `mcp` 的占位工具（`McpToolAdapter.groupTool()`）。在生产运行时里它和 `search` 一样始终在册，不管有没有配置 MCP 服务器。
2. 名单筛选、保存校验、YAML 导入校验、两端保存时用的已知名单，全部照旧按名字处理，代码不改。
3. 组装模型请求时（`run-agent-turn.ts`，主 run 与子 run 各一处）：名单筛选完成后，若结果里还有 `mcp`，就把它换成实际的 MCP 工具（`BuiltinTools.registerMcpTools` 内部先注销占位、再注册 `mcp__` 工具；没有可替换的工具时占位同样被注销）；若已被筛掉，什么都不做。
4. 没有注入 MCP 的运行环境（`runtime.mcp` 为空：现有服务级测试、命令行）同样在这一步注销占位——占位不能因为没有东西可替换就留在注册表里。

| 智能体的工具名单 | 筛选结果里有没有 `mcp` | 模型看到 |
| --- | --- | --- |
| 没有名单（默认模式） | 有 | 全部，含 MCP 工具 |
| `deny` 含 `mcp` | 没有 | 没有 MCP 工具 |
| `deny` 不含 `mcp` | 有 | 全部，含 MCP 工具 |
| `allow` 含 `mcp` | 有 | 名单里的工具，含 MCP 工具 |
| `allow` 不含 `mcp` | 没有 | 名单里的工具，没有 MCP 工具 |

占位工具永远到不了模型：它唯一的出口是第 3、4 步的注销与替换。它的 `run` 不可达，返回 `TOOL_FAILED` 兜底。两端的工具目录（`agent-tool-catalog.ts`）把 `mcp` 条目直接加进 `BUILTIN_TOOL_CATALOG`，分组结构收成单组；提示文案的计数取该数组长度（自动为 12）。

## 最终项目结构

```
packages/core/src/domain/tool/model/tool.ts                      Tool + ExternalTool + RegisteredTool
packages/core/src/domain/tool/logic/tool-registry.ts             存 RegisteredTool
packages/core/src/domain/tool/logic/tool-runner.ts                外部工具跳过校验
packages/core/src/domain/mcp/logic/to-nm-tool.ts                  返回 ExternalTool；加 groupTool 占位
packages/core/src/domain/mcp/model/mcp-tool-snapshot.ts           状态加 disconnected
packages/core/src/domain/mcp/ports/mcp-connection.port.ts         端口重写
packages/core/src/infra/mcp/impl/create-mcp-connection-manager.ts  连接步骤、三入口、调用重连
packages/core/src/infra/mcp/impl/official-mcp-client.ts           新增 sessionId 访问器
packages/core/src/domain/tool/builtin/register-builtin-tools.ts   注册 mcp 占位；registerMcpTools 负责替换
packages/core/src/domain/mcp/logic/rename-mcp-server.ts           由 rewrite-mcp-tool-references.ts 精简改名而来（去掉智能体引用改写）
packages/core/resources/i18n/ui/{zh-CN,en-US}/agent.yaml          tool_desc_mcp、builtin_tools_hint
packages/core/src/service/agent/logic/run-agent-turn.ts          装配读缓存
packages/core/src/i18n/{keys.ts,generated-catalog.ts}             tool_desc_mcp、detail.status_disconnected
packages/core/resources/i18n/*.yaml                              同上文案
apps/mobile/src/services/mcp-config.store.ts                      connect / connectUnconnected
apps/mobile/src/services/mcp-oauth.service.ts                      授权成功后作废并连接
apps/mobile/src/runtime/create-mobile-runtime.ts                   McpRuntimeFactory 去掉 agentRegistry 实参
apps/mobile/src/screens/tabs/chat-tab/ChatTabProvider.tsx         进聊天页触发
apps/mobile/src/screens/stack/{McpServersScreen,McpServerDetailScreen}.tsx
apps/mobile/src/components/agent/{AgentEditorForm,AgentEditorToolsSection,ToolPolicyPicker}.tsx
apps/mobile/src/config-forms/agent/agent-tool-catalog.ts
apps/desktop/shared/config-forms/agent-tool-catalog.ts
apps/desktop/shared/ipc-types.ts                                  nm:mcp/connectUnconnected；删 toolsSnapshot
apps/desktop/src/main/ipc/handlers/mcp.ts
apps/desktop/src/main/ipc/handler-registry.ts
apps/desktop/src/main/main.ts                                     启动后触发
apps/desktop/renderer/ipc/{invoke-registry.ts,client.ts}
apps/desktop/renderer/providers/ShellNavProvider.tsx              切会话触发
apps/desktop/renderer/features/settings/{McpServersView,McpServerDetailView,AgentEditorView,ToolPolicyPicker}.tsx
apps/desktop/renderer/features/settings/mcp-server-meta.ts
```

## 变更点清单

### core · 工具类型（A）

| 文件 | 改动 |
| --- | --- |
| `domain/tool/model/tool.ts` | 新增 `ExternalTool`、`RegisteredTool`；修正注释里失效的 `{@link toolsFromRegistry}`（实际是 `ToolDefinitions.fromRegistry`） |
| `domain/tool/logic/tool-registry.ts` | Map 值类型与 `register` / `get` 签名改 `RegisteredTool<Ctx>`；逻辑不变 |
| `domain/tool/logic/tool-runner.ts` | `:99` 与 `:135-141` 包在 `"inputSchema" in tool` 判定里；外部工具把原始 `input` 交给路径检查与 `run` |
| `infra/llm-protocol/logic/tool-definitions.ts` | 外部工具直接用 `inputJsonSchema`；自带工具照旧转换 |
| `domain/mcp/logic/to-nm-tool.ts` | 返回 `ExternalTool`；`inputJsonSchema` = `snapshot.inputSchema`，未声明时 `{type:"object", properties:{}}`；删除 `inputSchemaOf` 及其注释 |
| `src/index.ts` | 导出 `ExternalTool`、`RegisteredTool` 类型 |

### core · 连接模型（B、C）

| 文件 | 改动 |
| --- | --- |
| `domain/mcp/model/mcp-tool-snapshot.ts` | `McpServerState` 加 `"disconnected"`，注释写明「曾连上，调用时重连失败；工具缓存保留；进页面会再试」；修正 `:7` 处点名 `snapshotTools()` 的头注释 |
| `domain/mcp/ports/mcp-connection.port.ts` | 按上文端口重写；类注释去掉「懒连接 + TTL」 |
| `infra/mcp/impl/create-mcp-connection-manager.ts` | 删 TTL；deps 的 `assemblyBudgetMs` 改名 `connectBudgetMs`；`connectUnconnected` / `connect` / `cachedTools`；`failWith` 按入口与起点决定 `failed` / 保持 `disconnected`；`failCall` 不再对服务器报的错写状态，取消落在重连握手期间时写回 `disconnected`；`callTool` 按原始错误判定是否重连，重连一次重试一次；撞名检测在 `cachedTools()` 与 `serverStatuses()` 两个读取口执行，补上「冲突消失清标记、按连接是否还在恢复」；`invalidate` 前先关旧 client；连接条目加 `heldSession`。保留全部 `nm-style` / `nm-throw` 标注并随改名更新 |
| `infra/mcp/impl/official-mcp-client.ts` | 新增只读访问器 `sessionId(): string \| null`（转发到底层传输的会话编号） |
| `service/agent/logic/run-agent-turn.ts` | 装配顺序改为：注册自带工具（含 `mcp` 占位）→ 保存校验 → 名单筛选 → **筛选后**：`runtime.mcp` 存在且结果含 `mcp` 则调 `BuiltinTools.registerMcpTools(registry, connectionManager.cachedTools(), …)` 完成替换；`runtime.mcp` 不存在则只注销占位；已被筛掉则不动。主 run（`:890-895`、`:942-944`）与子 run（`:1350-1370`）各改一处。`:892-893`、`:426-430` 注释改写（不再有装配期等待） |

### core · 智能体策略「MCP」项（D）

| 文件 | 改动 |
| --- | --- |
| `domain/mcp/logic/to-nm-tool.ts` | 新增 `McpToolAdapter.groupTool()`：名为 `mcp` 的 `ExternalTool`，参数定义为 `{type:"object", properties:{}}`（与其他无参数工具同一形状），描述「MCP 服务器提供的工具」写死中文（core 运行时不持 locale；该描述到不了模型，两端目录走 i18n 键） |
| `domain/tool/builtin/register-builtin-tools.ts` | `BuiltinTools.register` 多注册 `mcp` 占位；`registerMcpTools` 开头无条件注销占位（若在册），再注册 `mcp__` 工具；把函数内「同一快照内撞名全部不注册」改成「同名只注册第一个」（最后防线，真正的撞名判定在读取缓存时做；`:72` 的 `log.warn` 保留，文案改为「重复的工具名只注册了第一个」）；调用时机从校验前挪到筛选后（见 `run-agent-turn.ts`）；修正 `:30` 处引用失效的 `toolsFromRegistry` 的注释，改写 `:51-58` 的 `registerMcpTools` 说明（占位注销与「同名只注册第一个」），`:27` 的「共 11 个」改 12，`:2-3` 头注释随占位与注册时机更新 |
| `resolve-agent-tools.ts`、`validate-agent-tool-policy.ts` | **不改** |
| `domain/mcp/logic/rewrite-mcp-tool-references.ts` → `rename-mcp-server.ts` | **精简并改名**：删除 `rewriteNames`、`rewriteAgentTools`、`AgentToolRefRegistry`（接口定义在本文件内）；保留换 ID 的编排函数并改名为 `McpServerRename.withAfterStep(deps, oldId, config, afterRename?)`，`deps` 只剩 `configStore`，回滚链（`store.rename` 成功后 `afterRename` 抛错 → 改回旧 ID）保持不变 |
| `src/public/mcp.ts` | 去掉 `McpToolRefs`、`AgentToolRefRegistry`、`McpToolRefDeps` 三个导出，改导出 `McpServerRename` |
| `src/i18n/keys.ts`、`generated-catalog.ts`、`resources/i18n/*/*.yaml` | `ui.agent.tool_desc_mcp`；`ui.agent.builtin_tools_hint` 的枚举段末尾加 `mcp`（zh / en，计数随参数变 12）；`settings.mcp.detail.status_disconnected`（zh「已断开」/ en「Disconnected」，与「未连接」区分）；删除孤儿键 `ui.agent.mcp_not_configured`；重跑 `scripts/gen-i18n-catalog.mjs` |
| 过时注释与孤儿类型 | 随改动清理：`handlers/mcp.ts` 头注释与 `toolList` 注释（「快照读取会顺带把 pending 的 server 连上」）、`McpServerDetailView.tsx:81` 同句、移动端 `McpServersScreen.tsx:8` 文件头、`McpServerDetailScreen.tsx:94`（TTL 60s）与 `:273`（点名 `renameWithRewrite`）、`shared/ipc-types.ts` 的 `McpToolSnapshotDto`（若 `toolList` 不再复用则删）、`create-desktop-runtime.ts:127` 与 `handlers/mcp.ts:242`（点名 `snapshotTools`）、`run-agent-turn.ts:168-169`（点名 `snapshotTools()` 与缓存 / 过期时间）、mobile `McpServerDetailScreen.tsx:6、:12、:170`、`mcp-config.store.ts:5-7、:41、:62-63`、`mcp-oauth.service.ts:12-13、:63`（换 ID 改写、测试连接、进页连接等旧行为描述）；全仓清理对已失效的 `toolsFromRegistry` 的散文指称（`subagent-tool.ts:21`、`skill-tool.ts:12`、`builtin-tool-context.ts:128`、`agent-tool-policy.test.ts:179,231`、`model-request-tools-stream.test.ts:228`、`tool-schema-descriptions.test.ts:6`） |

### mobile

| 文件 | 改动 |
| --- | --- |
| `services/mcp-config.store.ts` | `connect(id)` 改为调 `connectionManager.connect(id)`；新增 `connectUnconnected()`；`persistThrough` 里的 `invalidate` 保留（停用、删除、换 ID 时对旧 ID 的作废都仍走它）；保存与换 ID 处改调 `McpServerRename.withAfterStep`（slice 的 `rename` 保留 `afterRename` 参数，详情页写入新填密钥的接线不变）；deps 去掉 `agentRegistry` |
| `runtime/create-mobile-runtime.ts` | `McpRuntimeFactory.create` 去掉 `agentRegistry` 实参 |
| `screens/tabs/chat-tab/ChatTabProvider.tsx` | `refreshOnFocus` 里加一行 `void runtime.mcp.connectionManager.connectUnconnected()`，不引入 state、不等结果 |
| `screens/stack/McpServersScreen.tsx` | 进列表的自动连接条件从 `pending` 扩到 `pending` / `disconnected`，改调 `connectUnconnected()`：发起后不等（不挡住首屏加载），发起后立即重读一次、它结束后再重读一次（**每次进入列表页只发起一轮**（用进页标志挡住「状态更新 → 重读 → 再发起」的循环；已断开的服务器再连接失败仍是已断开，不能因此被反复重连；下拉刷新算作重新进入，会再发起一轮）；`connectRow`（开关打开）改调 `connect(id)`，仍等结果后同步该行；列表状态标签加 `disconnected` 分支显示「已断开」，复用 `settings.mcp.detail.status_disconnected`（现有的 `settings.mcp.list.disconnected` 键值是「未连接」，继续用于从未尝试与已失败，不要接错） |
| `screens/stack/McpServerDetailScreen.tsx` | 工具列表读 `cachedTools()`；状态行加 `disconnected` 分支（有原因显示原因，否则「已断开」）；保存与测试连接改调 `connect(id)` |
| `services/mcp-oauth.service.ts` | 授权成功后 `invalidate` + `connect(serverId)`，不等连接结果（与桌面端一致） |
| `components/agent/AgentEditorForm.tsx` | 删 `mcpTools` state、effect（`:66-74`）、prop 透传（`:326-334`）与两处 import |
| `components/agent/agent-editor/AgentEditorToolsSection.tsx`、`ToolPolicyPicker.tsx` | 删 `mcpTools` prop；`AgentToolCatalog.get` 不再需要 deps；删 `ToolPolicyPicker` 里对占位条目的分支（计数直接取条目数） |
| `config-forms/agent/agent-tool-catalog.ts` | 删 mcp 分组逻辑与其类型、删 `AgentToolCatalogEntry.placeholder` 字段，收成单组；`mcp` 条目加进 `BUILTIN_TOOL_CATALOG`（「内置工具（N 个）」提示取数组长度，自动为 12） |

### desktop

| 文件 | 改动 |
| --- | --- |
| `shared/config-forms/agent-tool-catalog.ts` | 与移动端同一改法（两份是手工维护的镜像；同样删 `placeholder` 字段与 `ToolPolicyPicker` 的占位分支） |
| `shared/ipc-types.ts` | 新增 `MCP_CONNECT_UNCONNECTED: "nm:mcp/connectUnconnected"`；删除 `MCP_TOOLS_SNAPSHOT`（渲染层唯一使用者是智能体编辑页） |
| `src/main/ipc/handlers/mcp.ts` | 新增 `connectUnconnected` 处理器：`await` 管理器的 `connectUnconnected()`（它永不 reject）后返回，配置页据此在尝试结束后重读状态；`saveServer` 的自动连接与 `testConnection` 改调 `connect(id)`；`saveServer` 现有的无条件 `invalidate(id)` 与换 ID 时对旧 ID 的 `invalidate(previousId)` 都保留（停用与换 ID 靠它们清缓存）；`oauthStart` 授权成功后 `invalidate` + `connect(serverId)`（不等连接结果），**授权成功即返回成功，随后的连接失败不改变返回值**（连接状态经状态查询的 `failure.detail` 呈现）；`toolList` 改读 `cachedTools()`，删 `toolsSnapshot` 处理器；换 ID 处改调 `McpServerRename.withAfterStep` |
| `src/main/ipc/handler-registry.ts` | 注册新处理器，移除已删的 |
| `src/main/main.ts` | `built.ok` 分支后 `void runtime.mcp.connectionManager.connectUnconnected()`（启动后触发，主进程内直接调，不走 IPC） |
| `renderer/ipc/invoke-registry.ts`、`client.ts` | 新增 `ipcMcpConnectUnconnected`，删 `ipcMcpToolsSnapshot` |
| `renderer/providers/ShellNavProvider.tsx` | 以 `[sessionId]` 为依赖的 effect：`sessionId` 非空时调 `ipcMcpConnectUnconnected()`，不引入 state、不等结果 |
| `renderer/features/settings/McpServersView.tsx` | 进列表的自动连接从「对 pending 调测试连接」改为 `ipcMcpConnectUnconnected()`（条件 `pending` / `disconnected`）：发起后不等（不放进 `reload`，免得连接预算把整页的可操作状态拖住），发起后立即重读一次、它结束后再重读一次；不再作废已连接服务器的缓存；状态色调映射 `MCP_STATUS_TAG_VARIANT` 加 `disconnected`（中性色） |
| `renderer/features/settings/McpServerDetailView.tsx` | 工具列表读缓存；进入页面时顺手读一次状态并显示状态行（只读一次，不加订阅）；测试连接改调 `connect`。连接在途时进详情页，工具区为空、状态行显示「连接中」属预期（返回重进或点测试连接可刷新） |
| `renderer/features/settings/mcp-server-meta.ts` | `mcpStatusLabel` 加 `disconnected` 分支：有原因显示原因（现有「原因优先」顺序不变），否则「已断开」 |
| `renderer/features/settings/AgentEditorView.tsx`、`ToolPolicyPicker.tsx` | 删 `mcpTools` state / effect / prop；`ToolPolicyPicker` 删对占位条目的分支；`count: 11` 改为 `BUILTIN_TOOL_CATALOG.length` |

## 兼容性说明

- **数据**：开发阶段，无存量数据，不做任何迁移。智能体名单里只会出现 `mcp`。
- **桌面 IPC**：新增与删除的通道随主进程、渲染层同包发布，没有新旧混用；preload 无需改。
- **移动端**：旧 JS 包没有进聊天页触发，只是少了自动连接，不报错。
- **行为变化**：会话开着不离开时，服务器改了工具清单不会跟上（用户已接受）；超过超时时间（默认 120 秒）的调用会失败（现状，无推送通道时无进度保活）。
- **换 ID 的回滚语义不变**：改名成功后写入新填密钥失败仍整体改回旧 ID；唯一的差别是不再遍历智能体改写工具名。

## 详细实现步骤

### 第一阶段：工具类型拆分

- Step 1 — phase-tool-split — blocking: yes — qa: auto：动手改代码前，先对 11 个自带工具各落一份 `ToolDefinitions.fromRegistry` 的期望输出夹具（T-T8 的基线）；然后 `tool.ts` 新增 `ExternalTool` / `RegisteredTool`；`tool-registry.ts` 改类型；`src/index.ts` 导出
- Step 2 — phase-tool-split — blocking: yes — qa: auto：`tool-runner.ts` 按 `"inputSchema" in tool` 分支，外部工具跳过入参出参校验
- Step 3 — phase-tool-split — blocking: yes — qa: auto：`tool-definitions.ts` 外部工具直接取 `inputJsonSchema`
- Step 4 — phase-tool-split — blocking: yes — qa: auto：`to-nm-tool.ts` 返回 `ExternalTool`，删 `inputSchemaOf`；改写 `test/mcp/model-render-mcp-tool-result.test.ts` 里 `:59`、`:68`、`:91` 三条参数定义相关用例（T-M11 / T-M11b / T-M11c；同文件其余五条 T-M11 开头的用例是 run 行为，不动；编号归入 T-T 组；`client-connection-manager.test.ts` 与 `model-mcp-server-config.test.ts` 里同名的 T-M11b 是另一回事，不动）
- Step 5 — phase-tool-split — blocking: yes — qa: auto：core 类型检查 + `test/tool` + `test/mcp` + `test/infra/llm-protocol` 全绿

### 第二阶段：连接模型（core）

- Step 6 — phase-connect-model — blocking: yes — qa: auto：`McpServerState` 加 `disconnected`；端口重写（`cachedTools` 同步、`connectUnconnected`、`connect`）
- Step 7 — phase-connect-model — blocking: yes — qa: auto：管理器重构：删 TTL；统一「连接」内部步骤（「连接中」在首个 `await` 之前同步落表）；`failWith` 按入口与起点选 `failed` / 保持 `disconnected`；撞名检测在两个读取口执行，补上「冲突消失清标记、按连接是否还在恢复」
- Step 8 — phase-connect-model — blocking: yes — qa: auto：`callTool` 按原始错误判定是否重连（关旧 client 前读 `sessionId`），重连一次重试一次（复用调用方 signal）；`failCall` 只对走到「已断开」的失败写状态，取消落在重连握手期间写回 `disconnected`；`OfficialMcpClient` 新增 `sessionId` 访问器；重连不递增代际；`invalidate` 前先关旧 client
- Step 9 — phase-connect-model — blocking: yes — qa: auto：**先建占位**（下一步装配要用到它）：`McpToolAdapter.groupTool()`；`BuiltinTools.register` 多注册 `mcp` 占位；`registerMcpTools` 改为无条件注销占位再注册实际工具，函数内撞名处理改为「同名只注册第一个」
- Step 10 — phase-connect-model — blocking: yes — qa: auto：`run-agent-turn.ts` 装配顺序改为「注册（含占位）→ 校验 → 筛选 → 替换或注销占位」，读 `cachedTools()`，更新注释
- Step 11 — phase-connect-model — blocking: yes — qa: auto：改写 `client-connection-manager.test.ts`（删 T-M19 过期用例，经 `snapshotTools` 驱动网络的用例改走新入口）与 `tools-registration.test.ts` 的 `stubManager` 与 `:44` 处「内置 11 件」注释，删除该文件 `:72`、`:79` 两条断言旧撞名过滤的用例（由 T-C25b / T-C25c 接替）；改写 `tools-registration.test.ts:156` 的 T-M20（旧「读时标记 + 条目剔除 + 复用 TTL 缓存」→ 删除，状态断言由 T-C17 接替、注册断言由 T-C25c 接替）；新增 T-C 组用例；新增 T-P1 ~ T-P9（策略用例落 `test/mcp/tools-registration.test.ts`，主 run / 子 run 的装配用例落 `test/service/agent/`）
- Step 12 — phase-connect-model — blocking: yes — qa: auto：core 类型检查 + MCP + 工具全量全绿；并确认经 `run-agent-turn` 装配后注册表含替换后的 `mcp__` 工具、不含占位 `mcp`（T-P3 / T-P4 的主 run 断言）；重建 core dist

### 第三阶段：智能体策略「MCP」项

- Step 13 — phase-agent-policy — blocking: yes — qa: auto：`rewrite-mcp-tool-references.ts` 精简改名为 `rename-mcp-server.ts`（删 `rewriteNames` / `rewriteAgentTools` / `AgentToolRefRegistry`，编排函数改名 `McpServerRename.withAfterStep`）；删 `test/mcp/model-rewrite-mcp-tool-refs.test.ts` 与 `test/helpers/mcp-fake-agent-registry.ts`；`test/mcp/store-config.test.ts` 删两条相关 import 与全部 `renameWithRewrite` 用例（保留 `store.rename` 既有用例）；`src/public/mcp.ts` 改导出；T-M21 改为占位替换语义
- Step 14 — phase-agent-policy — blocking: yes — qa: auto：core i18n：`ui.agent.tool_desc_mcp`、`ui.agent.builtin_tools_hint` 枚举段加 `mcp`、`settings.mcp.detail.status_disconnected`（zh / en），删 `ui.agent.mcp_not_configured`，重跑 `gen-i18n-catalog.mjs`
- Step 15 — phase-agent-policy — blocking: yes — qa: auto：core 类型检查 + MCP + agent + i18n 测试全绿（「已注册 11 个」类断言改 12：`agent-tool.test.ts`、`skill-tool.test.ts`、`search-tool.test.ts`、`tool-schema-descriptions.test.ts`、`vfs-tools.test.ts`）；重建 dist

### 第四阶段：移动端

- Step 16 — phase-mobile — blocking: yes — qa: auto：`mcp-config.store.ts`（`connect` / `connectUnconnected`、改调 `McpServerRename.withAfterStep`、去掉 `agentRegistry`）、`create-mobile-runtime.ts`、`mcp-oauth.service.ts`
- Step 17 — phase-mobile — blocking: yes — qa: auto：`ChatTabProvider.tsx` 进聊天页触发；`McpServersScreen` / `McpServerDetailScreen` 改触发条件、状态行与注释
- Step 18 — phase-mobile — blocking: yes — qa: auto：移除智能体编辑页的 MCP 接线（三个组件）；`agent-tool-catalog.ts` 的 `mcp` 条目进 `BUILTIN_TOOL_CATALOG`、收成单组
- Step 19 — phase-mobile — blocking: yes — qa: auto：改测试：删 `agent-editor-form-mcp-tools.test.tsx`；`mcp-config-store.test.ts` 的 `connect` 断言、fake manager、rename 用例改为直连 `McpServerRename`；`mcp-oauth-service.test.ts` 的 fake 补 `connect`；`tool-policy-picker`、`agent-editor-form-tool-count`、`config-forms-agent-tool-catalog` 的计数与 mcp 用例；新建 `mcp-servers-screen-connect-round.test.tsx`（T-MO6，mock 导航 / `useFocusListReload` / runtime）
- Step 20 — phase-mobile — blocking: yes — qa: auto：mobile 类型检查 + 全量 Jest（`--maxWorkers=2`）

### 第五阶段：桌面端

- Step 21 — phase-desktop — blocking: yes — qa: auto：`ipc-types.ts`、`handlers/mcp.ts`（含授权成功后连接）、`handler-registry.ts`、`invoke-registry.ts`、`client.ts`
- Step 22 — phase-desktop — blocking: yes — qa: auto：`main.ts` 启动触发；`ShellNavProvider.tsx` 切会话触发
- Step 23 — phase-desktop — blocking: yes — qa: auto：`McpServersView` / `McpServerDetailView` / `mcp-server-meta.ts`；移除智能体编辑页接线；`shared` 目录的 catalog 同移动端改法
- Step 24 — phase-desktop — blocking: yes — qa: auto：改测试：`mcp-handlers.test.ts`（T-MH5 改为 `connect`，fake manager 补新成员，授权成功后连接）、`mcp-handlers-mock-runtime.ts`、`tool-policy-picker.test.tsx`、`config-forms/agent-tool-catalog.test.ts`
- Step 25 — phase-desktop — blocking: yes — qa: auto：desktop 类型检查 + MCP 相关测试（**不跑** `packaging.test.js`）

### 第六阶段：整体验收

- Step 26 — phase-acceptance — blocking: yes — qa: auto：core / mobile / desktop 三处类型检查（不含 apps/cli）、core 全量、mobile 全量、移动端出包并确认无本地子进程依赖混入
- Step 27 — phase-acceptance — blocking: yes — qa: auto：风格检查：对本次改动文件跑 `check-style` / `check-signatures` / 连续三元检测 / `throw-audit`，新增发现为 0
- Step 28 — phase-acceptance — blocking: yes — qa: auto：`mcp-support/spec.md` 的「开发期变更」追加一条指向本规格；APM 记忆与 `RULE.md` 记入跨会话规则
- Step 29 — phase-acceptance — blocking: no — qa: manual_user：真机走查（合并后用户执行）：见「人工验收」

## 测试策略

运行方式：core `node scripts/run-tests.mjs --dir <目录>`；改动 workspace 包的返回契约后**先重建 dist** 再跑 apps 测试；mobile 全量用 `--maxWorkers=2`；Metro 在跑时不跑 `apps/desktop/test/packaging.test.js` 与 `tools/nm-style` 自身测试。
「进聊天页 / 启动 / 切会话」三处触发接线（移动端 `ChatTabProvider`、桌面端 `main.ts` 与 `ShellNavProvider`）没有屏幕级自动化用例，只由人工验收覆盖；它们各自只有一行调用，状态机本身由 T-C 组锁住。

### 测试用例

工具类型拆分（T-T）

- T-T1 — blocking: yes — 自带工具入参不合法 → `TOOL_INVALID_ARGUMENT`，带 `issues`（原有行为，防回归）
- T-T2 — blocking: yes — 外部工具入参为任意对象甚至字符串 → 不校验，原样传到 `run`
- T-T3 — blocking: yes — 外部工具没有 `outputSchema` → `run` 的成功值原样返回
- T-T4 — blocking: yes — 外部工具的路径白名单检查仍生效（`path` 越界 → `TOOL_FORBIDDEN`，`run` 未执行）
- T-T5 — blocking: yes — `ToolDefinitions.fromRegistry`：外部工具的 `inputSchema` 与声明逐字段相等（同一引用或深相等），不经 zod
- T-T6 — blocking: yes — 服务器未声明参数定义 → 模型侧为 `{type:"object", properties:{}}`
- T-T7 — blocking: yes — 声明含 `not` / `if-then-else` → 模型侧原样可见，不再回退为空（替换原 T-M11c）
- T-T8 — blocking: yes — 自带 11 个工具的 `fromRegistry` 输出与改动前落下的夹具逐字节一致（夹具在 Step 1 动手前生成）

连接模型（T-C，`client-connection-manager.test.ts`）

- T-C1 — blocking: yes — `cachedTools()` 同步返回，`requestFn` 调用次数为 0
- T-C2 — blocking: yes — `connectUnconnected()`：`pending` 发起连接；`ready` / `connecting` / `failed` / `disabled` / `unsupported` 不发请求
- T-C3 — blocking: yes — `connectUnconnected()`：`disconnected` 发起连接，成功后缓存被替换
- T-C4 — blocking: yes — `connectUnconnected()` 连续调三次 → 只有一次握手与一次 `tools/list`；三个返回的 Promise 都在这次尝试结束后才 resolve
- T-C5 — blocking: yes — `connect(id)`：先作废（在途结果不写回）再连接，返回终态状态；测试连接据此展示。进行中的尝试同样被作废重连
- T-C6 — blocking: yes — `pending` 连接失败 → `failed`，缓存为空；之后再 `connectUnconnected()` 不重试
- T-C7 — blocking: yes — 无过期时间：注入 `now` 前进 10 分钟后 `cachedTools()` 不变、无请求（替换 T-M19）
- T-C8 — blocking: yes — 调用遇连接级失败（无 HTTP 响应）→ 重连一次、重试一次，共 2 次 `callTool`，结果为重试结果，状态 `ready`
- T-C8b — blocking: yes — 重连成功但重试的调用又失败 → 按那次失败原样返回，状态 `ready`，`callTool` 仍只有 2 次
- T-C9 — blocking: yes — 握手时服务器下发过会话编号，之后调用遇 404 → 视为会话失效，走 T-C8 路径
- T-C10 — blocking: yes — 握手成功但服务器从未下发会话编号，调用遇 404 → 不重连，按普通失败分类返回
- T-C11 — blocking: yes — 调用重连失败 → 状态 `disconnected`，缓存条目与之前逐条深相等
- T-C12 — blocking: yes — 服务器报 `auth` / `permission` / `rate-limit` / `server`（5xx）/ `protocol` / `isError` → 不重连，状态与缓存不变
- T-C13 — blocking: yes — 调用或重试期间用户取消（不含重连握手窗口，那是 T-C13b）→ `Interrupt.cancelled`，状态不变（原有取消用例保持）
- T-C13b — blocking: yes — 取消落在**本调用发起**的重连握手期间（握手因 signal 中止而失败）→ `Interrupt.cancelled`，状态 `disconnected`，缓存保留；之后 `connectUnconnected()` 会再次尝试（不会卡在连接中）
- T-C13c — blocking: yes — 调用时撞上后台入口的在途握手，期间用户取消 → `Interrupt.cancelled`，状态由那次握手的结果决定（不受本调用影响）
- T-C14 — blocking: yes — `disconnected` 经 `connectUnconnected()` 再失败 → 仍 `disconnected`，缓存保留，原因更新
- T-C15 — blocking: yes — 重连不递增代际：期间并发的 `invalidate` 仍能使重连结果作废
- T-C16 — blocking: yes — 从未连上的起点在连接预算内未完成 → `failed`（原 T-M18a 语义保留）
- T-C17 — blocking: yes — 撞名服务器：`serverStatuses()` 读到 `failed{protocol, report}`，缓存条目保留，`cachedTools()` 不返回其工具；检测不联网
- T-C17b — blocking: yes — 起点为 `disconnected` 的服务器被撞名标记后冲突消失 → 恢复为 `disconnected`（不是 `ready`）
- T-C18 — blocking: yes — `closeAll` 后在途的 `connectUnconnected` 结果不写回（原有竞态用例保持）
- T-C19 — blocking: yes — `disconnected` 的服务器调 `connect(id)` 失败 → `failed`，缓存清空（显式动作等同全新连接）
- T-C20 — blocking: yes — A 先连上并缓存，B 后连上且与 A 撞名 → 再读 `cachedTools()` 时 A、B 都记 `failed{protocol, report}`，两者的工具都不返回
- T-C21 — blocking: yes — `deps.disabledTools` 关掉的工具不出现在 `cachedTools()`；关掉撞名工具之一后不再视为撞名
- T-C22 — blocking: yes — `connectUnconnected()` 调用后立刻读 `serverStatuses()`，被触发的服务器已是 `connecting`（同步落表）
- T-C23 — blocking: yes — `disconnected` 的服务器被调用：先重连；成功 → `ready`、缓存替换、执行调用；失败 → 仍 `disconnected`、缓存保留、调用按失败返回
- T-C24 — blocking: yes — 调用遇单次请求超时（`RequestTimeout`）→ 不重连，`callTool` 只 1 次，状态与缓存不变
- T-C25 — blocking: yes — A、B 撞名都记 `failed`；停用 B（`invalidate`）后再读 → A 恢复 `ready`、无需重连、工具重新出现在 `cachedTools()`
- T-C25b — blocking: yes — 同一服务器声明两个归一后同名的工具：关掉其中一个后读取无冲突、状态 `ready`；再把该工具打开 → 再读即记 `failed{protocol}`，不抛异常
- T-C25c — blocking: yes — `registerMcpTools` 收到含重复名的工具列表时只注册第一个，不抛
- T-C26 — blocking: yes — `ready` 的服务器调 `connect(id)` 失败 → `failed`，缓存清空（人工验收「测试连接失败清工具」的自动化对应）
- T-C27 — blocking: yes — 对 `disabled` / `unsupported` 的服务器调 `connect(id)` → 不发请求，原样返回当前状态
- T-C28 — blocking: yes — `connect(id)` 传未知 id → 抛 `AssertionError`（不变量破坏）
- T-C29 — blocking: yes — 分类结果同为 `network` 的两种失败：没有 HTTP 响应 → 重连；`RequestTimeout` → 不重连（即 T-C8 与 T-C24 的判据来自原始错误，不来自分类结果）
- T-C30 — blocking: yes — 对 `pending` / `failed` 的服务器调 `callTool` → 不发请求、状态不变、返回 `kind:"unknown"` 的失败
- T-C30b — blocking: yes — 服务器处于 `connecting`（后台握手在途）时调 `callTool` → 只有一次握手；握手成功后照常执行调用，状态 `ready`
- T-C31 — blocking: yes — `callTool` 触发重连的握手期间读 `serverStatuses()` 为 `connecting`

智能体策略（T-P；编号以本规格为准，与 `mcp-support/spec.md` 里的旧 T-P 编号无关）

- T-P1 — blocking: yes — `deny: ["mcp"]` → 筛选结果不含 `mcp` → 最终注册表没有任何 `mcp__` 工具；自带工具不受影响
- T-P2 — blocking: yes — `allow: ["read"]` → 最终注册表不含 `mcp`，也没有任何 `mcp__` 工具
- T-P3 — blocking: yes — `allow: ["mcp", "read"]` → 最终注册表含全部 `mcp__` 工具与 `read`，不再含占位 `mcp`
- T-P4 — blocking: yes — 无策略 → 最终注册表含全部（原行为），不再含占位 `mcp`
- T-P5 — blocking: yes — 占位在册：保存校验与 YAML 导入对 `mcp` 通过；`BuiltinTools.register` 后注册表为 12 个
- T-P6 — blocking: yes — 模型侧工具定义里从不出现名为 `mcp` 的占位工具
- T-P7 — blocking: yes — 没有配置任何 MCP 服务器时行为同 T-P4，只是没有 `mcp__` 工具可替换
- T-P8 — blocking: yes — 子智能体按自己的策略筛选与替换，不继承父（原行为）
- T-P9 — blocking: yes — `runtime.mcp` 未注入：筛选后占位被注销，模型侧既没有 `mcp` 也没有 `mcp__` 工具（主 run 与子 run 各验一次）

移动端（T-MO）

- T-MO1 — blocking: yes — `mcp.connect(id)` 调 `connectionManager.connect`（替换原「先 invalidate 再 snapshotTools」断言）
- T-MO2 — blocking: yes — 停用、删除仍调 `invalidate`，不连接
- T-MO3 — blocking: yes — 授权成功 → `invalidate` 后 `connect`
- T-MO4 — blocking: yes — catalog 共 12 条：11 个自带 + `mcp`；默认模式提示文案的计数为 12
- T-MO5 — blocking: yes — 工具选择往返：选中 `mcp` → 策略含 `mcp` → 回读仍选中
- T-MO6 — blocking: yes — 列表页：进入一次只发起一轮 `connectUnconnected`；重读状态后不再次发起（即使有服务器仍是已断开）

桌面端（T-D）

- T-D1 — blocking: yes — `nm:mcp/connectUnconnected` 处理器在管理器的 `connectUnconnected()` 挂起期间不返回，结束后返回成功、不 reject（「不阻塞渲染层」由人工验收覆盖）
- T-D2 — blocking: yes — `saveServer` 启用时调 `connect`，停用时不调（替换 T-MH5）
- T-D3 — blocking: yes — `nm:mcp/toolList` 只读缓存，不触发请求
- T-D4 — blocking: yes — catalog 共 12 条：11 个自带 + `mcp`（与移动端一致）
- T-D5 — blocking: yes — `oauthStart` 授权成功 → `invalidate` 后 `connect(serverId)`；`connect` 失败时 `oauthStart` 仍返回成功
- T-D6 — blocking: yes — `saveServer` 以停用状态保存 → 仍调 `invalidate`，不调 `connect`，该服务器缓存为空

### 人工验收（合并后用户执行）

- 真机：进入聊天页后 MCP 配置页状态变为已连接；直接发首条消息不卡顿，工具可用。
- 断网后调用 MCP 工具 → 返回失败；恢复网络、重新进聊天页 → 恢复已连接，工具全程在列表里。
- 地址写错的服务器 → 已失败；反复进出聊天页不重试；测试连接可重试。
- 智能体取消勾选「MCP」→ 该智能体的模型看不到任何 MCP 工具。
- 已连接的服务器点「测试连接」且失败 → 状态变已失败，该服务器的工具列表清空（显式动作等同全新连接，属预期）。
- 已连接的服务器断网后调用，再恢复网络 → 恢复已连接，同一个工具没有被服务器执行两次。
- 桌面：启动后、切换会话后，状态按预期变化。
- 桌面：打开 MCP 配置页，从未尝试与已断开的服务器自动连接一轮，已连接的不动；连接在途时整页仍可操作。

## 开发期变更（实现落地后与原文的出入）

1. **端口新增详情页读取面 `serverTools(serverId)`**（提交 `2361358b0` 之后改为独立方法）。原文第四、五阶段让两端详情页的工具卡读 `cachedTools()`，而它是装配读取面，出口会滤掉被关掉的工具、跳过「已失败」的服务器——关掉的工具因此从卡上消失、没法再打开，撞名标记后的工具同样看不到。两个读取面职责不同：`cachedTools()` 只给 agent 装配用（过滤 + 撞名检测），`serverTools(serverId)` 只给界面用（原样返回该服务器缓存的全部工具）。第四阶段的 `McpServerDetailScreen.tsx`、第五阶段的 `toolList` 处理器两行相应改为读 `serverTools`。
2. **补登两条矩阵外用例**：T-C21b（`serverTools` 不看开关与状态；作废后为空）、T-C32（重连握手期间连接预算到点，按失败返回且状态落「已断开」）。

## 风险与回滚方案

| 风险 | 应对 |
| --- | --- |
| 进页面触发的连接与 `invalidate` / `closeAll` 竞态 | 三个入口都走同一内部步骤，进入时取代际、写回前校验；原有竞态用例保留 |
| 首条消息时连接还没完成，模型暂时看不到 MCP 工具 | 用户已接受；状态在 MCP 配置页可见 |
| 会话失效与地址配错的 404 无法区分 | 以「此前是否持有会话」区分；T-C9 / T-C10 各锁一边 |
| 无本地校验后，模型传错参数要等服务器往返才知道 | 服务器本就是校验权威；错因由服务器返回，模型可据此重试 |
| 换 ID 编排精简后漏掉某步 | 回滚链原样保留，只是去掉遍历智能体那一步；core `store-config.test.ts` 的 `store.rename` 用例与两端 rename 测试保持，`withAfterStep` 的回滚用例保留在新文件 |
| 两份 catalog 手工镜像不同步 | 改动清单里成对列出；两端各有计数测试 |
| 占位 `mcp` 被别的路径当成真工具暴露给模型 | 它只在 `run-agent-turn.ts` 的组装里被替换或注销；T-P6 锁住模型侧定义 |
| 智能体编辑页会出现一个名为 `mcp` 的工具条目 | 与「MCP 算一个工具」的认知一致；内置工具提示（`builtin_tools_hint`）与工具目录各多一条，不展开具体 MCP 工具 |
| 行为变化面大，自动化覆盖不到真实网络 | 第六阶段后由用户做人工验收清单 |

回滚：全部改动落在 `feat/mcp-support` 分支，按阶段分提交。任一阶段验证不过，`git revert` 该阶段提交即可回到上一阶段；分支尚未合并，不影响已发布版本。
