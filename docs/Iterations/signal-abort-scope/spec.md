---
date: 2026-11-13
updated: 2026-11-16
baseline: eecff1b29  # 代码事实以此为准（tag p6-nm-style）
status: 已实施（八期 tag abort-scope @ a97fafdc4；B 轮合规审查 tag abort-scope-audited @ 67bf45d11，P0 5 / P1 17 / P2 14）
---

# 取消信号全量改造（signal-abort-scope）技术规格（SPEC）

## 设计目标

把 nm 的取消能力从「裸 `AbortSignal` 手动传参」升级为统一的可中断作用域，一次覆盖全部长任务（不拆二期）：

1. **统一抽象**：`AbortScope`（可驱动的 scope）与 `AbortSignalView`（只读视图，signal + reason + checkpoint + yieldToUi + race + onCancel），替代散落的 `signal?: AbortSignal` 传参样板。`checkpoint()` 返回 `Interrupt | null`、`yieldToUi()` 返回 `Promise<Interrupt | null>`——取消是**控制流信号**不是错误，不占 `Result` 的 `E` 通道；`Result<T, AppError>` 只装业务失败。
2. **补同步检查点**：5 处注入落点（repository 读/写、vfs-tree-copy、skills.service、assemble 对齐形状）+ 1 处调用方批间检查（count-tokens/chunk-splitter 不加 hooks）——这些长循环/长遍历此前多数根本没收 `signal`（`skills.service`、`count-tokens`、`chunk-splitter`、repository 实测 grep `signal` 零命中），本迭代把它们变成真正可中断/可让路。
3. **补应用层缺口**：桌面 6 类长任务 handler、移动端 4 类 service 全部接入取消与 deadline。
4. **移动端真断连**：`LlmSseNative.request` 从「JS 假取消、连接跑满 600s」改为 OkHttp `Call.cancel()` 真断连。
5. **不破坏既有语义**：SSE partial 落库（`stream-partial-signature` 等 5 份测试）、agent abort 回滚、backfill 取消、tool-runner 取消文案等现有测试锁在**适配签名后的语义层面**必须保持绿。

6. **错误通道剩余债同批收口**：**9 处** `*_INVARIANT_VIOLATION`（core 8 + mobile `rn-file-io.ts:44`）改 `assert`；工具内部的 `TOOL_CANCELLED` 从 `throw` 改 `return Result.err`（码保留作展示标签，runner 汇总成 `Outcome.cancelled` 向上）；**30 处**业务失败 `throw` 改 `return Result.err`；`errors/vfs-errors.ts` 与 `errors/session-fs-errors.ts` 合并进 `guards.ts`。四项与取消链路共用同一套通道语义，分轮做会改两遍签名。

不包含：MCP 相关的取消语义（见 `mcp-support` spec）。

## 需求来源

用户口述（2026-11-13 会话）。关键拍板：全量做不拆二期；移动端 native 真断连纳入本次范围。

2026-11-14 文档审查第 1 轮修订：补 `abort()` 接口与生命周期契约、拆分只读视图与可驱动 scope、补桌面 runId 契约与 IPC 错误码、修正 batchInsert 事务语义、补 native requestId 贯穿、把「既有测试保持绿」细化为「零改动绿 / 适配后绿」。

2026-11-14 文档审查第 2/3 轮修订：根 scope 与门面共享 WeakMap 实例、cloudSync 两端统一 `"local"`、compaction 检查点收敛到 hide 前、云同步取消错误原样上抛并记 `cancelled`、`AgentTurnRuntimePort.abortRegistry` 更名 `agentAbortRegistry`、补「同批 nm style 收口口径」节。

2026-11-14 Result 化重构（用户拍板）：按 nm-code-style §3「错误进 Either，不抛」，`checkpoint()` / `yieldToUi()` 从 throw 改为返回值，六个长循环落点与其调用方随之返回通道类型；平台协议例外（`race` 的 reject、`fetch` 的 `AbortError`、`better-sqlite3` 事务回滚）保留 throw 并在适配层转码。`createAbortError` 上移 `domain/abort`。

**2026-11-16 控制流通道修正（用户拍板，最终形态）**：错误通道迁移拆出四类型分工后，`checkpoint()` 的返回从 `Result<void, AbortFailure>` 改为 **`Interrupt | null`**（`Interrupt` 定义在 `packages/core/src/errors/outcome.ts`，`{ kind: "cancelled"; reason: AbortReason } | { kind: "replaced" }`）。理由是 `Result<T, E>` 的二态把「取消」标成失败、且 `E` 只能装 `AppError` 语义的业务错误；控制流中断有自己的类型（`Outcome` 四分支 / `Interrupt`）。同时把工具取消纳入返回值通道（工具内部 11 处构造点里 4 处 `throw` 改 `return Result.err(TOOL_CANCELLED)`、`tool-runner` 汇总成 `Outcome.cancelled` 向上、`race` 载荷改 `createAbortError()`；`TOOL_CANCELLED` 码保留作展示标签），并把错误通道的剩余债一并收口：9 处 `*_INVARIANT_VIOLATION` 改用 `assert`（编程错误不占产品码）、30 处业务失败 `throw` 改 `return Result.err`、`errors/vfs-errors.ts` 与 `errors/session-fs-errors.ts` 合并进 `errors/guards.ts`。

## 迭代关系

- 本迭代与 `mcp-support` **单向依赖**：`mcp-support` 的 `callTool(..., scope: AbortScope)` 消费本迭代新建的 `domain/abort`；本迭代不消费 MCP 的任何符号。落地顺序：本迭代 Step 1-3（`domain/abort` 与导出面）先合入，MCP 迭代再引用。
- 两份 spec 都会改 `packages/llm-sse-native`，但改的是不同面：本迭代加 `requestAbort` 与 request 路径的 requestId，MCP 迭代加 headers 回传与 SSE 帧解析。两批改动互不重叠，按各自 Step 落地；同文件合并冲突按后合入方 rebase 解决。

## 现状约束（探索结论）

**已具备**（不动或只做适配）：

- 4 个 port 带 `signal` 且全部真实消费：`service/agent/agent.port.ts:28`、`service/provider/model-request.port.ts:22`、`infra/llm-protocol/ports/adapter.port.ts:75`、`service/message-checkpoint/message-checkpoint.port.ts:44`。
- `agent-runner.ts` 已有 8 个 break 型 step 边界检查点（L319/336/366/390/462/775/857，另含 L610 判据）与统一 abort 路由（L882）；VFS 装配已有 `shouldStop: () => signal?.aborted` 先例（L363）。
- `assemble-workplace-display.ts` 已具备每文件 `shouldStop` 检查点（基线 L169-172 快照加载后、L189-192 文件循环内），**已返回 `Outcome` 且中断收成 `kind: "cancelled"`**，`test/workplace/assemble-abort-fingerprint.test.ts` 已断言 `stopped.kind === "cancelled"`。
- `sqlite-message.repository.ts` 构造器已收 `yieldFn?: () => Promise<void>`，读路径 `mapRows` 与写路径 `batchInsert` 在分片之间都会调用它让路（mobile 注入 `createQuantumYield(16)`）。本迭代只在其旁边新增同步 `hooks.checkpoint`，不替换 `yieldFn`。
- `backfill-baseline-checkpoints.ts` 已可中断。
- `request-abort.ts` 三函数（`isAbortLikeError` / `createAbortError` / `isRequestAborted`）已处理 Hermes 无 `DOMException`。
- `llm-sse-transport.ts` 三路传输（native → XHR → fetch）已把 `opts.signal` 透到 `controller.abort()`。
- `AgentAbortRegistry`（Map<sessionId, controller>）含 `tryRegister` claim 与引用所有权比对。
- `LlmSseModule.kt` 的 **SSE 流式路径已真断连**（`sseAbort` + `userAborted` 闸门）；`request` 非流式路径没有 abort 面。

**缺口**：

| 类别 | 位置 | 现状 |
|---|---|---|
| 同步长遍历 | `sqlite-message.repository.ts` 的 `mapRows`（读分片）与 `batchInsert`（写分片）、`vfs-tree-copy.ts`、`skills.service.ts:237`、`count-tokens.ts:70`、`chunk-splitter.ts:61` | 无 abort 检查点（repository 有让路 `yieldFn`，但没有「停下来」的判据） |
| 已具备但形状未对齐 | `assemble-workplace-display.ts:191` | 已有每文件 `shouldStop?: () => Interrupt | null`（基线 L105），只需与 `LongTaskHooks.checkpoint` 命名对齐 |
| 桌面 handler | `handlers/backup.ts:26/38`、`db-maintenance.ts:24`、`usage-stats.ts:159`、`provider-models.ts:78`、`cloud-sync.ts:83/132`、`compaction.ts:35` | 无 signal、无超时、无 runId，全部是单次 `ipcMain.handle` 调用 |
| 移动 service | `cloud-sync.service.ts`、`db-backup.service.ts`、`db-maintenance.service.ts`、`manual-compaction.service.ts` | 无 signal；`CloudSyncCoordinator.pull/push`（core）也没有中断面 |
| 移动 native | `llm-native-fetch-shim.ts:126-165` + `LlmSseModule.kt` request 路径 | `raceWithAbort` 只 reject JS Promise，连接跑到 `callTimeout` 600s；`request()` 签名无 requestId |
| 注册粒度 | `create-agent-abort-registry.ts` | 仅 session 一级 key，非 agent 任务无处注册 |

**硬约束**：

- **RN 无 `AbortSignal.timeout` / `AbortSignal.any` / `throwIfAborted`**；`reason` 是否被 `controller.abort(reason)` 保留在 Hermes 版本间不可靠（仓库内 `abort-controller@3.0.0` 作为传递依赖会丢 reason）。→ scope 必须自己实现 timeout / 级联，且 **reason 只能存在 scope 上，永不读 `signal.reason`**。
- **Hermes 无 `scheduler.yield`** → `yieldToUi` 用 `setTimeout(0)`。
- 错误通道按 nm-code-style §3「错误进 Either，不抛」：域逻辑/校验函数返回 `Result<T, E>`，只在边界（runner/service/tool/IPC handler/CLI）`if (!result.ok) throw result.error`。**取消不是错误**：`checkpoint()` 返回 `Interrupt | null`，长任务返回 `Outcome<T>`（四分支 completed/cancelled/replaced/failed），`Result` 只用于纯计算与只有业务失败的函数。**平台协议例外**（`fetch` 的 `AbortError`、`Promise.race` 的 reject、`better-sqlite3` 靠抛错回滚事务、`AbortSignal.throwIfAborted()`）保留 throw，在适配层转码。**scope.onCancel 只做清理，不产生业务结果**；业务结果仍走 Result。
- `better-sqlite3` 同步调用（如 VACUUM、批量 `hideRange`/`showRange`）无法中途中断 → 这类标为「不可中断区段」，只做前置检查与 UI 文案。
- 分层：domain/service/infra，`@/` 别名 import 带 `.js` 后缀；domain 层不得依赖 node 内置（`setTimeout` / `clearTimeout` 属全局 Web API，可用）。

## 总体方案

### 一、取消域核心（新域 `domain/abort`）

**能力分级，不是兼容位**：只读视图与可驱动 scope 是包含关系，不是两套语义。

```ts
/**
 * 取消原因与中断类型：**定义在 `errors/outcome.ts`，本域只 re-export**。
 *
 * 归属理由：`errors/` 是全仓最底层，`Interrupt` 的 cancelled 分支内嵌
 * `AbortReason`，若把联合定义在 `domain/abort` 就会逼 `errors/outcome.ts`
 * 反向 import domain（与 106 个 domain 文件 import `errors/either` 成环）。
 * 因此 `AbortReason` / `Interrupt` 的**唯一定义处是 `errors/outcome.ts`**。
 */
export type { AbortReason, Interrupt } from "@/errors/outcome.js";

/** 只读能力集：工具域、裸 signal 适配用。不能发起取消。 */
export interface AbortSignalView {
  readonly signal: AbortSignal;
  readonly reason: AbortReason | null;   // 裸 signal 造出的视图恒为 null（无从得知原因）
  checkpoint(): Interrupt | null;                      // aborted → { kind: "cancelled", reason }；否则 null
  yieldToUi(): Promise<Interrupt | null>;              // aborted → 同左；否则让出事件循环后返回 null
  race<T>(work: Promise<T>, rejectWith?: () => unknown): Promise<T>;  // 平台协议例外：Promise 只能 reject
  onCancel(fn: () => void): () => void;  // 清理钩子，返回注销函数
}

/** 可驱动能力集：run/service/handler 入口用。 */
export interface AbortScope extends AbortSignalView {
  readonly deadlineAt: number | null;
  abort(reason?: AbortReason): void;     // 默认 "user-stop"；首个 reason 生效
  fork(opts?: { timeoutMs?: number }): AbortScope;
  dispose(): void;
}
```

**生命周期契约**（实现与测试都按此表，不留实现者自由发挥）：

| 方法 | 契约 |
|---|---|
| `abort(reason = "user-stop")` | 幂等；首次写入后 reason 不可覆盖（首因锁定）；同步执行全部 `onCancel`（按注册顺序，逐个 try/catch，单钩子抛错不影响其余）；清自身 deadline 定时器 |
| `checkpoint()` | `reason !== null`（只读视图看 `signal.aborted`）→ `{ kind: "cancelled", reason }`；否则 `null`。**不 throw、不占 Result 通道** |
| `yieldToUi()` | 先 `checkpoint()`，非 null 直接返回该 `Interrupt`；否则 `await new Promise(r => setTimeout(r, 0))` 后返回 `null` |
| `race(work, rejectWith?)` | **调用时已 aborted → 立即（微任务）以 `rejectWith?.() ?? createAbortError()` reject**；abort 时同款 reject；对 `work` 另挂旁路 `.catch(noop)` 防 unhandled，race 用原 promise；settle 后摘 listener。挂听必须走 `onCancel`（裸 `addEventListener("abort")` 对已 aborted 的 signal 不补发事件，race 会永挂）。**保留 reject 是平台协议例外**：Promise 没有 Result 通道，调用方在边界转 `createAbortError()` → IPC 码 `IPC_ABORTED` |
| `onCancel(fn)` | 已 abort → 立即同步执行 fn 并返回 noop；否则注册并返回注销函数 |
| `fork({ timeoutMs? })` | 子 scope 监听父；父 abort → 子以 `"parent"` abort；`deadlineAt` 取父 deadline 与自身 timeout 中较早者；**子 `dispose()` 时把自己从父的 children 集摘除**（父不持有已死子的强引用）；父 `dispose()` 只对**仍在册**的子先 `abort("parent")` 再清理 |
| `dispose()` | 幂等；清定时器、注销父监听、从父 children 集摘除、按上条处理子 scope；**不触发自身 onCancel**（正常完成不是取消）。dispose 后：`checkpoint()` 恒返回 `null`、`onCancel(fn)` 直接返回 noop 且不执行、`race` 退化为直接返回 `work`、`abort()` no-op |

**工厂三形态**：

```ts
createAbortScope(opts?: { timeoutMs?: number; parent?: AbortSignalView | AbortScope; controller?: AbortController }): AbortScope
scopeFromController(controller: AbortController): AbortScope  // abort() 反向委托 controller.abort()
signalView(signal: AbortSignal): AbortSignalView              // 只读视图，无定时器、无 dispose
```

- `scopeFromController` 按 controller 做 `WeakMap<AbortController, AbortScope>` memoize：同一 controller 多次取用得到同一 scope 实例。**memoize 命中即返回既有实例、后续传入的 `parent`/`timeoutMs` 被忽略**——这是「根 scope 必须先建后注册」纪律的机制来源；dev 环境下对「命中时 opts 与既有实例不一致」打一条 `console.warn`，并新增 T-S28 锁住反序调用不与既有实例冲突（先 `scopeFromController` 后 `createAbortScope({controller, parent})` 时，要么 parent 级联不丢、要么 dev warn 触发，不得静默）。用于 `AgentAbortRegistry` 薄包装与 run 根 scope。`registry.abort(key)` 内部调 `controller.abort()`；scope 监听到 controller abort 且自身 reason 仍为 null 时记 `"user-stop"`（裸 controller abort 一律按用户停止处理）。
- `signalView(signal)` 用于裸 signal 适配：只需 checkpoint/race，不需要 reason 与反向驱动。不注册定时器，`race` settle 后摘监听；`checkpoint()` 同样返回 `Interrupt | null`（裸 signal 造出的视图 reason 恒为 null，命中时按 `{ kind: "cancelled", reason: "user-stop" }` 给保守值）。
- `race` 的 `rejectWith` 是给 `tool-runner` 保留「工具调用已取消」文案的出口，不是通用扩展点。
- **`createAbortError` 上移**：从 `infra/llm-protocol/logic/request-abort.ts` 移到 `domain/abort/logic/create-abort-error.ts`（只依赖全局 `DOMException`，无分层问题），`request-abort.ts` 保留 re-export 以免改既有导入点。`isAbortLikeError` 留在原处，domain 不反向依赖 infra。
- **run 根 scope 契约**（`run-agent-turn`）：每个 run 自建 `internalController`；根 scope = `createAbortScope({ controller: internalController, ...(options?.scope ? { parent: options.scope } : {}) })`。`createAbortScope({ controller })` 与 `scopeFromController` 共用同一 WeakMap memoize，因此 `AgentAbortRegistry.register(sessionId, internalController)` 内部取到的就是 run 的根 scope 实例。这样 `registry.abort(sessionId)` → `controller.abort()` → 根 scope `reason === "user-stop"`，不会出现「signal 停了但 scope.reason 恒为 null」的静默失效。

### 二、AbortRegistry 泛化（key 命名空间）与实例拓扑

```ts
export interface AbortRegistry {
  register(key: string, scope: AbortScope): void;        // 已存在则覆盖（保持 AgentAbortRegistry 现状语义）
  tryRegister(key: string, scope: AbortScope): boolean;  // 已存在返回 false
  abort(key: string, reason?: AbortReason): void;        // 默认 "user-stop"；key 不存在静默 no-op
  unregister(key: string, scope: AbortScope): void;      // 只移除同一实例（引用比对）
  has(key: string): boolean;
  abortAll(reason: AbortReason): void;                   // 应用退出用
}

export const ABORT_KEY = {
  agent: (sessionId: string) => `agent:${sessionId}`,
  backup: (runId: string) => `backup:${runId}`,
  dbMaintenance: (runId: string) => `dbmaint:${runId}`,
  usageStats: (runId: string) => `stats:${runId}`,
  providerModels: (providerId: string) => `models:${providerId}`,
  cloudSync: (id: string) => `sync:${id}`,
  compaction: (sessionId: string) => `compaction:${sessionId}`,
} as const;
```

**id 取值规则**（两端共用同一套常量，registry 实例各进程独立，字符串相同不冲突）：

| key | 桌面 id | 移动 id |
|---|---|---|
| `agent` | sessionId | sessionId |
| `backup` | renderer 生成的 runId（uuid） | 固定 `"local"`（备份单飞） |
| `dbMaintenance` | renderer 生成的 runId | 固定 `"local"`（`db-maintenance-busy` 互斥） |
| `usageStats` | renderer 生成的 runId | — |
| `providerModels` | providerId（`tryRegister` 拒绝同一 provider 并发 fetch） | — |
| `cloudSync` | 固定 `"local"`（S3 配置无 provider 概念，`syncBusy` 全局互斥） | 固定 `"local"`（`syncBusy` 互斥） |
| `compaction` | sessionId | sessionId |

**registry 拓扑（实例归属与导出面）**：

- core 新增 `packages/core/src/public/abort.ts` barrel，`packages/core/package.json` 增 `./abort` exports 子路径，导出 `AbortScope`/`AbortSignalView`/`AbortReason`/`LongTaskHooks`/`ABORT_KEY`/`createAbortScope`/`scopeFromController`/`signalView`/`createAbortRegistry`/`AbortRegistry`，以及 **`createAbortError`/`isAbortLikeError`**——**`createAbortError` 上移到 `domain/abort/logic/create-abort-error.ts`（唯一权威定义处），由本 barrel 转发、`request-abort.ts` 保留 re-export 兼容**；`isAbortLikeError` 定义留在 `infra/llm-protocol/logic/request-abort.ts`，同样经 barrel 转发。apps 的 `format-ipc-error`、桌面 handler 边界、移动云同步 catch 三处都只能经包导出拿到它们。
- 桌面：`create-desktop-runtime.ts` 建**一个** `AbortRegistry`；runtime 同时暴露 `abortRegistry: AbortRegistry`（泛化）与 `agentAbortRegistry: AgentAbortRegistry`（门面，内部复用同一实例）。**core `AgentTurnRuntimePort.abortRegistry` 同批更名 `agentAbortRegistry`**（类型仍是门面），`run-agent-turn` 的 7 处引用（register/has/unregister/tryRegister）同步改名——否则 core 会沿同名字段拿到 app 的泛化实例，用裸 sessionId 注册，`nm:agent/abort` 按 `agent:<sessionId>` 派发永远 miss，双端停止按钮静默失效。`handlers/agent.ts` 两处直接用裸 sessionId 的判据（`isDesktopSessionRunInFlight`、`handleAgentRunIsActive`）改走 `runtime.agentAbortRegistry.has(sessionId)`。
- 移动：`create-mobile-runtime.ts` 同构。`MobileNovelMasterRuntime` 现有 `abortRegistry` 字段是门面，本次 **retype**：`abortRegistry: AbortRegistry`（泛化）+ 新增 `agentAbortRegistry: AgentAbortRegistry`（门面，复用同一实例）。retype 后 `register`/`unregister` 因参数类型不同会被标红，但 `has`/`abort` 参数同为 string 不会标红，必须按下列枚举逐处改走门面：`session-stream-unit-manager` 的探针与 startRun 门禁、`useChatTabScope.ts` 的冻结槽/补刷门禁（3 处）、`chat-prompt-tokens.service.ts` 的 runInFlight 判据（2 处）。`stopRun` 泛化为 `stop(key)` 后传 `ABORT_KEY.agent(sessionId)`。
- `AgentAbortRegistry` 门面：`register(sessionId, controller)` 内部用 `scopeFromController(controller)`（与 run 根 scope 同一 WeakMap memoize 实例），`unregister(sessionId, controller)` 两参（真实 port 签名，T-S18 要求该测试零改动绿），内部经 `scopeFromController(controller)` 取 memoize 实例做引用比对；**不另建缓存 Map**。测试口径：`agent-abort-registry.test.ts` 全程零改动绿；`run-agent-turn-abort-registry.test.ts` 与 `agent-runner-abort-rollback.test.ts` 在 Step 3 后零改动绿、Step 5 删 `signal` 后必须做 fixture 适配（语义断言不变），见 T-S18/T-S19。

### 三、签名演进：只有一个最终形态，只是分波次落地

**最终形态只有 `AbortScope`。不保留 `signal?: AbortSignal` 兼容位，不留「二期再换」。**

| 层 | 最终形态 | 说明 |
|---|---|---|
| `AgentRunOptions` / `RunAgentTurnOptions` | `scope?: AbortScope`（**删除 `signal`**） | core 两个入口字段都要删；两端 `agent-run.service.ts` 的本地 `signal?` 字段与 `...options` 透传一并删 |
| `model-request.port` / `adapter.port` / `message-checkpoint.port` | `scope: AbortScope`（必填） | 调用方全部在 core；无取消诉求的场合传 `createAbortScope()`（无定时器、无父），显式表达「不可取消」 |
| `builtin-tool-context.ts` 的 `ctx.signal` | **保留 `AbortSignal`** | 设计选择不是兼容位：工具作者要直接喂 `fetch`，scope 不传染到工具 API；runner 用 `scope.signal` 填入 |
| `agent-runner` 检查点 | 8 处 break 型 → `const hit = scope.checkpoint(); if (hit != null) { stopReason = "cancelled"; break; }`；`post_model`（本基线 L608-610）**例外** | `post_model` 命中后必须继续写 partial assistant 再退出，改成 Result 提前返回会丢用户刚看到的流式内容。该处写成 `if (scope.reason !== null) await handleAbort("post_model")`，之后照常落库。循环外一层统一把 `stopReason` 转成既有返回形态，**不改 `runAgentTurn` 的对外返回类型** |
| `agent-runner` 统一路由（L882） | `scope.reason !== null \|\| isAbortLikeError(e)` | signal 字段删除后不能再读 `signal?.aborted` |
| `run-agent-turn` | 自建 `internalController`，按上述根 scope 契约建 scope（调用方传入的 `options.scope` 作 parent）；`preludeAbortResult`（L476）判据改 `scope.reason !== null`；backfill 传参（L520）改传 scope；子 agent 手工 `childController` 派生改 `scope.fork()` | 删 `signal` 后这 4 处消费点必须同批处理，否则留死代码；根 scope 与门面同实例是停止按钮生效的前提；`AgentTurnRuntimePort.abortRegistry` 同批更名 `agentAbortRegistry`（7 处引用），避免 core 沿同名字段拿到 app 的泛化 registry |
| `tool-runner.ts` | `ctx.signal` 对外不变；内部竞速改 `signalView(signal).race(work, () => createAbortError())`；工具返回的 `Result.err(TOOL_CANCELLED)` 汇总成 `Outcome.cancelled` 向上返回 | `race` 属平台协议例外仍 reject（载荷改 `createAbortError()`，`isAbortLikeError` 可识别）；`TOOL_CANCELLED` 码保留作展示标签，`tool-runner-abort.test.ts` 的 4 处 `isAppError(TOOL_CANCELLED)` 断言适配为 `isAbortLikeError`（T-S26） |

「分波次」只指**提交顺序**，不是形态共存：Step 1-3 建域（此时无调用方）、Step 4-6 换 port 与调用方、Step 7-8 补长循环检查点。每一波结束 `tsc` 必须绿，但中间态不发布也不保留。

### 四、同步长循环：`LongTaskHooks` 回调，不传 scope

domain 纯函数不接收 `AbortScope`（会污染函数签名、破坏纯函数性），改暴露可选回调，由调用方注入：

```ts
export interface LongTaskHooks {
  readonly checkpoint?: () => Interrupt | null;  // 同步检查；非 null 时按各函数既有返回契约中止
  readonly onProgress?: () => void | Promise<unknown>;     // 异步让路点（可选；yieldToUi 需包一层 void wrapper）
}
```

**5 处**注入落点（`checkpoint` 由调用方注入 `() => scope.checkpoint()`；第 6 个候选 count-tokens/chunk-splitter 改为调用方批间检查、不注入）：

| 文件 | 注入方式 | 中止契约 |
|---|---|---|
| `sqlite-message.repository.ts` `mapRows`（读分片） | 每个分片边界 `const hit = hooks?.checkpoint?.(); if (hit != null) return { kind: "cancelled", reason: hit.reason };`（**必须用 `hit != null`（宽松）或先 `?? null` 归一**——注入形态是 `hooks?.checkpoint?.()`，hooks 未传时得到 `undefined`；写 `hit !== null` 会让 `undefined !== null` 为真、误判为已取消并在 `undefined` 上取 `.reason` 直接崩），紧挨既有 `yieldFn` 之前 | 返回 `Outcome<ChatMessageData[]>` 的 `cancelled` 分支；读调用方按中断处理（签名改 `Promise<Outcome<ChatMessageData[]>>`） |
| `sqlite-message.repository.ts` `batchInsert`（写分片） | 每个分片边界 `const hit = hooks?.checkpoint?.(); if (hit != null) return { kind: "cancelled", reason: hit.reason };`，紧挨既有 `yieldFn` 之前 | 返回 `Outcome` 的 `cancelled` 分支；**事务边界把 cancelled 转 `throw createAbortError()` 触发整体回滚**（`better-sqlite3` 靠抛错回滚，属平台协议例外，见 T-S13）。独立小事务路径（root conn 直调、`runInTransactionOrConn` 兜底）必须在小事务闭包内 `throw` 后转 err 返回，否则会 commit 半批、T-S13 在该路径落空 |
| `vfs-tree-copy.ts` | 每个文件 `checkpoint()`；每 20 个文件让路，注入形态写 `onProgress: () => { void scope.yieldToUi(); }`（`yieldToUi` 返回 `Promise<Interrupt | null>`，不能直接赋给 `() => void | Promise<void>`，必须包一层） | 返回 `Outcome.cancelled`；已复制文件保持完整（单文件原子） |
| `assemble-workplace-display.ts` | **基线已迁移完**：返回 `Outcome<AssembleWorkplaceDisplayResult>`、`shouldStop?: () => Interrupt | null`、检查点在 L169-172 与 L189-192，中断收成 `return stopped`。本迭代**只需把 `shouldStop` 更名为 `LongTaskHooks.checkpoint` 并对齐注入形状** | 已是 `Outcome.cancelled`/`replaced`，`WorkplaceAssemblyAbortedError` 哨兵类在 core 已不存在（仅测试注释提及），测试已断言 `kind === "cancelled"`，零语义改动 |
| `skills.service.ts` `listSkills` | 每个 skill `checkpoint()` | 返回 `Outcome.cancelled`，不返回半份清单 |
| `count-tokens.ts` / `chunk-splitter.ts` | **不加 hooks、签名完全不变**（同步纯函数，单次调用毫秒级；注入 hooks 会把取消语义污染到 tokenizer 纯计算层）。取消由调用方在**批间**检查：`for (const batch of batches) { if (scope.checkpoint() != null) return { kind: "cancelled", reason: scope.reason! }; countTokens(batch); }` | 函数签名保持 `countTokens(...): number` / `splitTextIntoChunks(...): string[]`（**不返回 Result**）；中断只发生在调用方的批间检查点，不进这两个函数 |

`run-compaction.ts` **不是长循环落点**（全文 127 行，`for` 只有 2 次 KKV 清理迭代）；压缩路径只在入口与 hide 前设检查点，`hide → token cache 失效 → KKV 清理` 及批量 `hideRange`/`showRange` 标为不可中断尾段。

`LongTaskHooks.onProgress` 与 repository 既有 `yieldFn` 的关系：**两者并存、职责分离**——`yieldFn` 只让路（既有，不改），`checkpoint` 只判停（新增）。同一次分片边界先 `const hit = hooks?.checkpoint?.(); if (hit != null) return { kind: "cancelled", reason: hit.reason };`，通过后再 `await yieldFn?.()`，不合并、不重复注入。

`LongTaskHooks.onProgress` 的类型是 `() => void | Promise<unknown>`（不是 `Promise<void>`）：`yieldToUi()` 返回 `Promise<Interrupt | null>`，需要注入处包一层 `() => { void scope.yieldToUi(); }`。

### 五、应用层

#### 桌面：runId 契约 + IPC 协议

**runId 由 renderer 生成**（`crypto.randomUUID()`），随请求体传入 main，renderer 从生成那一刻起就持有它，取消时直接回传。不再走「main 生成后回推」的两段式。

- 3 个 `bindNoArg` 通道（`BACKUP_EXPORT`、`BACKUP_IMPORT`、`DB_MAINTENANCE`）改为 `bindReq`，请求体 `{ runId?: string }`（可选：只有会展示取消按钮的调用方生成）。
- `UsageStatsQueryRequest`、`CloudSyncPushRequest` 增加可选 `runId`；`ProviderModelsFetchRequest` 不需要（key 用 providerId）。
- IPC 新增 `nm:run/abort`：

```ts
// 并入既有 IPC_CHANNELS（`IpcChannel` 联合类型由它派生，preload 白名单才收得到）
IPC_CHANNELS.RUN_ABORT = "nm:run/abort";
export interface RunAbortRequest {
  readonly kind: "backup" | "dbmaint" | "stats" | "models" | "sync" | "compaction";
  readonly id: string;
}
export type RunAbortResponse = IpcResult<null>;
```

  - 未知 `kind` → `IPC_INVALID_ABORT_TARGET`；`id` 不存在 → `ok: true`（与现有 `nm:agent/abort` 的静默 no-op 一致）；`providerModels` 并发冲突 → `PROVIDER_MODELS_IN_FLIGHT`。
  - 请求 DTO 的 `runId` 为**可选**：renderer 只在会展示取消按钮的任务上生成；缺省时 handler 只建 scope + deadline、不注册进 registry，既有轻查询调用点零改动。
  - `nm:agent/abort` 保留为转发别名：收到 `{ sessionId }` 后转 `abort(ABORT_KEY.agent(sessionId))`。
  - 字段名用 `kind` 而不是 `scope`，避免与 `AbortScope` 类型同名混淆。

**取消错误码**：handler 的 `doWork` 返回 `Outcome<T>`；handler 是边界，`cancelled`/`replaced` 分支转 `throw createAbortError()`（把控制流信号在边界转成异常，交给统一错误出口），`failed` 分支 `throw r.error`（nm-code-style §3），`completed` 正常返回。`format-ipc-error.ts` 对 `isAbortLikeError(err)` 统一映射为 `{ code: "IPC_ABORTED", message: "已取消" }`（码名带 `IPC_` 前缀，与 123 段既有 `IPC_INVALID_ARGUMENT` 一致）。renderer 收到 `IPC_ABORTED` 静默收尾（不弹错误 toast）。

**6 类 handler 逐项策略**（统一骨架 `createAbortScope → register → try/finally unregister + dispose`）：

| handler | key | 取消策略 | 不可中断窗口 | timeoutMs |
|---|---|---|---|---|
| backup export | `backup(runId)` | scope 在原生保存对话框 resolve 后创建；`copyFile` 前 checkpoint | 无 | 300_000 |
| backup import | `backup(runId)` | scope 在打开对话框 resolve 后创建；仅入口 checkpoint；**禁止用 `race` 早 settle** | `close → 覆盖库文件 → restore` 整段 | 不设 |
| db-maintenance | `dbMaintenance(runId)` | 入口最后检查（现有三重互斥守卫之后） | VACUUM / checkpoint 同步段 | 不设 |
| usage-stats | `usageStats(runId)` | 各 kind 分支边界 checkpoint | 单条 SQL | 120_000 |
| provider-models | `providerModels(providerId)` | scope 透传到 `provider-model.service.fetch` → `adapter.listModels` → `fetchJson` 的 `signal`；`tryRegister` 拒绝并发 | 单次网络请求（由 signal 真断） | 60_000 |
| cloud-sync pull/push | `cloudSync("local")` | 阶段边界 checkpoint；**禁止 `race`** | 换库窗口（`replaceLiveDatabase`） | 不设 |
| compaction | `compaction(sessionId)` | 入口 + hide 前 checkpoint；`hide → invalidate → KKV 清理` 整段不可中断 | 批量 `hideRange`/`showRange` | 180_000 |

「不设 timeoutMs」= 只提供手动取消。不可中断区段的 UI 文案（「正在整理，无法中断」）由 Step 14 落地。

**逐 handler 的取消实现形式**：`doWork` 内部接受 `scope`，在上述检查点写 `const hit = scope.checkpoint(); if (hit != null) return { kind: "cancelled", reason: hit.reason };`（`doWork` 返回 `Outcome<T>`）；handler 外层按 `matchOutcome` 三分派——`cancelled`/`replaced` → `throw createAbortError()`、`failed` → `throw e`、`completed` → 返回 `ipcOk(value)`，统一交给 `formatIpcError`。**禁止**在 import/pull 这类有多资源补偿链的 handler 外层套 `scope.race()`——那样 `finally` 会先于底层补偿链执行，导致 rebootstrap/临时文件清理时序错乱。

#### 移动：service 接入 + 云同步阶段级取消

- `session-stream-unit-manager.service.ts` 的 `stopRun(sessionId)` 泛化为 `stop(key: string)`（收完整 `ABORT_KEY.x(id)` 产物，参数名不叫 scope）。3 个现有调用点改传 `ABORT_KEY.agent(sessionId)`；探针与 startRun 门禁继续走 agent 门面 `has(sessionId)`。
- 4 类 service 各自建 scope 并注册（骨架同桌面）：

| service | key | 策略 |
|---|---|---|
| `cloud-sync.service.ts` pull/push | `cloudSync("local")` | 入口 + 真实阶段边界 `checkpoint`（pull：下载完成后、哈希校验前、换库前；push：快照导出后、上传前）；换库窗口不可中断；**禁止 `race`**（`finally` 的临时文件清理必须与底层流程同生命周期）；catch 对 `isAbortLikeError(err)` **原样上抛**（不进 `mapCloudSyncSdkError`），`lastPullResult` 记 `"cancelled"`（不记 error）、进度回调走取消终态 |
| `db-backup.service.ts` export | `backup("local")` | 入口 + `copyFile` 前 |
| `db-backup.service.ts` import | `backup("local")` | 仅入口；`close → cp → restore` 不可中断；**禁止 `race`** |
| `db-maintenance.service.ts` | `dbMaintenance("local")` | 仅入口；VACUUM 不可中断；UI 不提供取消按钮（或显示不可中断文案） |
| `manual-compaction.service.ts` | `compaction(sessionId)` | 入口 + hide 前；`hide → invalidate → KKV 清理` 整段不可中断 |

- `CloudSyncCoordinator`（core，`infra/cloud-sync/impl/cloud-sync-coordinator.ts`）的 `PullOptions`/`PushOptions` 增加 `checkpoint?: () => Interrupt | null`，在阶段边界调用；`cloud-sync.service.ts` 把 `() => abortScope.checkpoint()` 传下去。S3 SDK 单次传输本身没有 abort 面，本迭代接受「阶段级取消」，UI 文案不得承诺「立即断开下载」。
- `manual-compaction.service.ts` 现有业务参数名 `scope: { projectId, sessionId }` 与 `AbortScope` 撞名，接 scope 时把 AbortScope 参数命名为 `abortScope`。

#### 移动 native 真断连

- `LlmSseModule.kt` 的 `request(requestId, method, url, headersKv, body, callTimeoutMs, promise)` **增加 requestId 首参**；`executor.execute` **之前** `calls.putIfAbsent(requestId, call)`（关闭「abort 先于注册」竞态），`finally` `calls.remove(requestId, call)`。
- 新增 `requestAbort(requestId)`：取 `calls[requestId]` 后置 `userAborted` 标记（仿照流式路径的 `userAborted` 一次性标记）再 `call.cancel()`。**request 路径不发事件**：取消通过 `promise.reject("abort", ...)` 回传（`classifyError` 见标记返回 `"abort"`）。`finally` 里 `calls.remove(requestId, call)` 与 `userAborted.remove(requestId)` 一并执行（abort 迟到时不留残标记）；`putIfAbsent` 撞重复 requestId 时 request 路径直接 `promise.reject("invalid", "duplicate requestId")`，不 execute。
- `native.ts`：暴露 `requestAbort(requestId)`；`isNativeSseAvailable` 的逐方法探测与 `createBridge` 的逐方法解构**同步加入 `requestAbort`**（漏改会复现「方法缺失、abort 静默失效」的既有事故模式）。
- `types.ts`：`request` 签名加 requestId、新增 `requestAbort(requestId: string): void`；不扩展 SSE 事件 `kind`（事件通道只服务流式路径）。
- `llm-native-fetch-shim.ts`：`createNativeRequestFetch({ request, requestAbort })` 改为双依赖注入（不直连 `NativeModules`，保持纯适配器设计）；每次请求生成 `requestId`（复制 transport 的「实例前缀 + 计数器」形态但**独立维护**——transport 的前缀/计数器是模块私有，不共享）；`raceWithAbort` 在 abort 时先调 `requestAbort(id)` 再 reject（两边 settle 幂等），并更新「已知限缩」注释。

## 最终项目结构

```
packages/core/src/
  domain/abort/
    model/abort-scope.ts          # AbortSignalView + AbortScope + LongTaskHooks（AbortReason/Interrupt re-export 自 errors/outcome.ts）
    model/abort-key.ts            # ABORT_KEY 常量与 id 规则
    logic/create-abort-scope.ts   # createAbortScope / scopeFromController / signalView
    logic/create-abort-error.ts   # createAbortError（自 request-abort.ts 上移，原文件 re-export）
    logic/create-abort-registry.ts
    ports/abort-registry.port.ts
  public/abort.ts                 # 导出 barrel（package.json 增 ./abort 子路径）
  common/assert.ts                # 不变量断言（抛 AssertionError，不占产品码）
  domain/tool/builtin/…           # 构造点改造（工具取消改返回值传播，不加 LongTaskHooks）
  infra/llm-protocol/…            # adapter.port 换 scope；llm-sse-transport 保持 AbortSignal（由 model-request 透传 scope.signal）
apps/desktop/src/main/ipc/handlers/…   # 6 类 handler 接 scope
apps/mobile/src/services/…             # 4 类 service 接 scope
packages/llm-sse-native/
  src/native.ts                          # +requestAbort
  src/types.ts                           # +requestId 签名、+requestAbort
  android/…/LlmSseModule.kt              # +requestId map、+requestAbort 真断连
```

## 变更点清单

| 文件 | 变更 |
|---|---|
| `domain/abort/*`（新 6 文件，含 `logic/create-abort-error.ts`） | AbortSignalView/AbortScope/LongTaskHooks + AbortRegistry + ABORT_KEY |
| `public/abort.ts` + `packages/core/package.json` | 导出 barrel 与 `./abort` exports 子路径 |
| `service/agent/agent.port.ts` + `logic/run-agent-turn.ts` | `AgentRunOptions.signal` → `scope`；`RunAgentTurnOptions.signal` → `scope`；`AgentTurnRuntimePort.abortRegistry` → `agentAbortRegistry`（7 处引用）；根 scope 建立（internalController + 可选 parent 级联）、prelude 判据、backfill 传参、子 agent fork 四处同批改 |
| `service/agent/impl/agent-runner.ts` | 8 处 break 型检查点换 `scope.checkpoint()`；`post_model` 保留非抛错形态；L882 路由改 `scope.reason \|\| isAbortLikeError` |
| `service/agent/agent-abort-registry.port.ts` + `create-agent-abort-registry.ts` | `AbortRegistry` 薄包装 + scope memoize |
| `service/provider/model-request.port.ts` + `impl/model-request.service.ts` | 签名换 scope；Step 4 先桥接 `scope.signal`，Step 5 直透 |
| `service/provider/impl/provider-model.service.ts` | `fetch` 透传 scope 到 adapter（原清单漏列） |
| `infra/llm-protocol/ports/adapter.port.ts` + 3 adapter | 签名换 scope，透 `scope.signal` 给 fetch/transport；`listModels` 也要消费 signal（现状没读） |
| `service/message-checkpoint/message-checkpoint.port.ts` + impl | 签名换 scope |
| `domain/tool/logic/tool-runner.ts` | `signalView(signal).race(work, () => createAbortError())`；工具返回的 `Result.err(TOOL_CANCELLED)` 汇总成 `Outcome.cancelled` 向上返回 |
| `domain/chat/repositories/message.port.ts` + `impl/sqlite-message.repository.ts` | 读/写大结果集方法末尾增可选 `hooks?: LongTaskHooks`（方法级注入，不塞构造器）；分片边界先 `const hit = hooks?.checkpoint?.(); if (hit != null) return { kind: "cancelled", reason: hit.reason };`，之后既有 `yieldFn`；**返回类型改 `Outcome`**（`mapRows` → `Promise<Outcome<ChatMessageData[]>>`、`batchInsert` → `Promise<Outcome<void>>`） |
| `service/chat/impl/{session.service.ts,message.service.ts}` | copy/fork 链路透传 hooks（`batchInsert` 调用点）；事务边界按 `matchOutcome` 分派——`cancelled`/`replaced` → `throw createAbortError()` 触发回滚、`failed` → `throw error`、`completed` 正常返回 |
| **读口 Outcome 连锁调用方**（约 25 处，tsc 红清单） | `truncate-tail-in-transaction.ts`、`subagent-tool.ts`、`chat-agent-session.ts`、`assemble-agent-runner-deps.ts`、`run-agent-turn.ts:536`、`message-transcript-effects.service.ts`、`session.service.ts:357`、`message.service.ts:128/141/148/166/336/528`、`run-compaction.ts:93`、`message-rollback.service.ts`、`apps/cli` 6 处、`handlers/messages.ts`、`session-prompt-input.service.ts`（双端）、`chat-prompt-tokens.service.ts:582`、`session-stream-unit-manager.service.ts:1167/1209`、`session-stream-unit.ts:1243/1292`、`SubagentSessionScreen.tsx`；按 tsc 红清单逐文件适配，归 phase-long-loops 波次 |
| `service/compaction-conditions/run-compaction.ts` | `RunCompactionDeps`/`params` 增可选 `hooks?: LongTaskHooks`；**hooks 必须穿透到 L95 的 `listBySessionFromSeq` 调用**（它是压缩路径最大的一次读，不传则整段对取消盲）；入口与 hide 前各一个检查点，尾段不可中断；`RunCompactionResult` 增加 `cancelled: true` 形态（当前是 `{ ok: boolean }`，只靠 `ok:false` 分不出取消与真失败，T-S15 对 compaction 的 `IPC_ABORTED` 预期会落空）；自动压缩调用方不传 hooks 不受影响 |
| `domain/vfs/logic/vfs-tree-copy.ts` | 每文件 `checkpoint()` + 每 20 文件让路；**返回 `Outcome`** |
| `service/skills/impl/skills.service.ts` | 每个 skill `checkpoint()`；**返回 `Outcome`** |
| `infra/tokenizer/logic/{count-tokens.ts,chunk-splitter.ts}` | **不加 hooks、签名不变**（`countTokens(): number`、`splitTextIntoChunks(): string[]`；取消由调用方批间检查，见 §四表） |
| `service/workplace/assemble-workplace-display.ts` | **基线已返回 `Outcome`、中断已是 `kind: "cancelled"`**；本迭代只把 `shouldStop?: () => Interrupt | null` 更名为 `LongTaskHooks.checkpoint` 并对齐注入形状（不新增检查点） |
| `apps/desktop/.../handlers/{backup,db-maintenance,usage-stats,provider-models,cloud-sync,compaction}.ts` | 建 scope + 注册 + finally 释放 + 逐项策略 |
| `apps/desktop/.../handlers/agent.ts` | 两处裸 sessionId 判据改门面；`nm:agent/abort` 改转发别名 |
| `apps/desktop/shared/ipc-types.ts` | 3 个 bindNoArg 通道加 `{ runId? }`、`UsageStatsQueryRequest`/`CloudSyncPushRequest` 加可选 runId、`IPC_CHANNELS.RUN_ABORT` 与 DTO |
| `apps/desktop/src/main/ipc/handler-registry.ts` + `preload` | 3 个通道改 `bindReq`、`nm:run/abort` 接线 |
| `apps/desktop/src/main/ipc/format-ipc-error.ts` | `isAbortLikeError` → `code: "IPC_ABORTED"` |
| `apps/desktop/src/main/runtime/{types.ts,create-desktop-runtime.ts}` | 泛化 registry + agent 门面并存（原清单漏列） |
| `apps/desktop/src/main/services/agent-run.service.ts` | 删本地 `signal?` 字段与透传（原清单漏列） |
| `apps/desktop/renderer/{ipc/invoke-registry.ts,ipc/client.ts}` | runId 生成与在途 job 状态、`nm:run/abort` 包装 |
| `apps/desktop/renderer/.../SettingsViews.tsx`、`FetchModelsModal.tsx` | 长任务弹窗加「取消」按钮；db-maintenance 不可中断文案 |
| `apps/mobile/src/services/{cloud-sync,db-backup,db-maintenance,manual-compaction}.service.ts` | 接 scope |
| `apps/mobile/src/services/session-stream-unit-manager.service.ts` + 3 个调用点 | `stopRun` → `stop(key)`，调用点传 `ABORT_KEY.agent(...)` |
| `apps/mobile/src/services/agent-run.service.ts` | 删本地 `signal?` 字段（原清单漏列） |
| `apps/mobile/src/runtime/{types.ts,create-mobile-runtime.ts}` | retype：泛化 `abortRegistry` + `agentAbortRegistry` 门面 |
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts` + `src/services/chat-prompt-tokens.service.ts` | 5 处裸 sessionId `has()` 改走 agent 门面 |
| `apps/mobile/src/screens/stack/{CloudSyncProgressScreen.tsx,StorageConfigScreen.tsx,SessionDetailScreen.tsx}` + `screens/tabs/chat-tab/useChatTabMessageActions.ts` | 取消按钮接线 / 不可中断文案 |
| `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` | `PullOptions`/`PushOptions` 加 `checkpoint`（原清单漏列） |
| `infra/llm-protocol/logic/request-abort.ts` + `domain/abort/logic/create-abort-error.ts` | `createAbortError` 上移 domain，原文件 re-export 兼容 |
| `apps/mobile/src/services/llm-native-fetch-shim.ts` | requestId 生成 + 双依赖注入 + 真断连 |
| `packages/llm-sse-native/{src/native.ts,src/types.ts,android/.../LlmSseModule.kt}` | requestId 贯穿 + `requestAbort` |
| `errors/outcome.ts` | 仅改模块注释（删「待 signal-abort-scope 定义后换 import」的过时 TODO，明确它是 `AbortReason`/`Interrupt` 唯一权威定义处）；**类型定义不迁移** |
| `common/assert.ts`（新建） | `assert(cond, message): asserts cond` 与 `assertNever`，抛 `AssertionError`（**不是 `AppError`**） |
| **9 处** `*_INVARIANT_VIOLATION` 落点 | `bootstrap/schema-migrations/index.ts:62`、`domain/prompt/logic/normalize-agent-prompt-layout.ts:96`、`domain/provider/logic/provider-identity-repair.ts:76`、`domain/vfs/logic/vfs-tree-copy.ts:39`、`infra/llm-protocol/logic/registry.ts:39`、`service/integrity-repair.ts:104`、`service/agent/impl/agent-runner.ts:455`、`service/vfs/impl/vfs-zip-io.service.ts:157` 改 `assert`/`assertNever`；**第 9 处 `apps/mobile/src/services/rn-file-io.ts:44`**（`react-native-blob-util.fs unavailable`，AppError 自 core 导入，码退役后会 tsc 红）——按语义应改挂既有 `INFRA_UNSUPPORTED_PLATFORM` 或 `assert`，**不得只改 core 让 apps 编译红** |
| `errors/error-codes.ts` | **新增 3 个 IPC 码**（123 段）：`IPC_ABORTED`（取消终态，供 `IpcErrorPayload.code` 与 renderer 静默收尾）、`IPC_INVALID_ABORT_TARGET`（未知 kind）、`PROVIDER_MODELS_IN_FLIGHT`（并发冲突）——三者在 `IpcErrorPayload.code: ErrorKey` 约束下必须在码表登记，否则 Step 9/10 tsc 红。另四个码退役：`INFRA_INVARIANT_VIOLATION`、`VFS_INVARIANT_VIOLATION`、`PROMPT_INVARIANT_VIOLATION`、`PROVIDER_INVARIANT_VIOLATION`。**`TOOL_CANCELLED` 保留不退役**（见 6.2：它有 messageKey + i18n + LLM 可见文案 + CLI exit 130 的完整展示契约，退役成本远超收益） |
| `domain/vfs/logic/format-vfs-error-for-llm.ts:62` | `VFS_KEY_TO_LABEL: Partial<Record<ErrorKey, string>>` 含 `VFS_INVARIANT_VIOLATION` 键——码退役即 tsc 红，需同步删该映射项 |
| `errors/guards.ts` + 删 `errors/vfs-errors.ts` / `errors/session-fs-errors.ts` | `isVfsError` / `isSessionFsError` / `VfsReplaceNotFoundDetails` 搬进 guards，两个文件删除，import 点与 `public/*` 转发改指 guards |
| 工具取消的 **11 处构造点 + 3 处消费点**（无 `tool-result.ts`，`tool.ts:48` 签名不变） | 构造点：`search-tool.ts:208/217/227`、`curl-tool.ts:298/315`（+`:331/:378` 的 `throw phaseError(e)`）、`template-engine.ts:102/207`、`duckduckgo.ts:134`、`tool-runner.ts:83/95/98`。工具内部 `throw` 改 `return Result.err(...)`；`tool-runner:95/98` 的 `race` 载荷改 `createAbortError()`；码**保留**，3 处消费点零改动 |
| 30 处业务失败文件（清单见 §6.3） | `VFS_NOT_FOUND` 7 / `CHAT_NOT_FOUND` 6 / 其余 17（含 9 个各 1 处的小 key），`throw` 改 `return Result.err` + 签名与调用方适配 |
| **需适配的既有测试**（语义不变，只改 fixture 形态） | `test/agent/agent-runner-abort-rollback.test.ts`、`test/service/agent/run-agent-turn-abort-registry.test.ts`、`test/message-checkpoint/backfill-abort-signal.test.ts`、`test/infra/llm-protocol/{anthropic,gemini}-partial-stream.test.ts`、`test/provider/model-request-retry.test.ts`、`test/agent/{agent-runner,agent-runner-timing,agent-runner-token-cache,agent-runner-failure-message}.test.ts`、`test/workplace/assemble-abort-fingerprint.test.ts`（**基线已断言 `kind === "cancelled"`，零改动**）；`test/tool/tool-runner-abort.test.ts`（4 处 `isAppError(err,"TOOL_CANCELLED")` 与 3 处 `err.key.startsWith("TOOL_")` 适配为 `isAbortLikeError`，listener 清零断言不变） |

## 六、错误通道剩余债收口（与取消链路同批）

错误通道迁移走到这一步还剩四笔债，它们与取消链路共用同一套语义（什么走 `Result`、什么走 `Outcome`、什么该 throw），分两轮做会改两遍签名，因此并入本迭代。

### 6.1 不变量破坏改用 `assert`，四个 `*_INVARIANT_VIOLATION` 码退役

**现状问题**：9 处「代码写错才可能到达」的状态现在写成 `throw new AppError("VFS_INVARIANT_VIOLATION", …)`。这有三重错：占了 append-only 的产品码表段位；会被 `isAppError` 命中、被边界转成 `AppErrorWire` 弹给用户「操作失败：路径不在前缀下」；丢掉 TS 的类型收窄能力。

```ts
// packages/core/src/common/assert.ts（新建）
/** 断言：cond 为假说明代码写错（不变量破坏），不是用户可触发的失败。 */
export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new AssertionError(message);
}
/** 与 assert 同源，但只用于「不该走到这里」的穷尽检查。 */
export function assertNever(value: never, message?: string): never {
  throw new AssertionError(message ?? `unreachable: ${String(value)}`);
}
```

- `AssertionError` **自建在 `common/assert.ts`**（`export class AssertionError extends Error`，`name = "AssertionError"`），不依赖 `node:assert`——domain 层直接 `import { assert } from "@/common/assert.js"` 即可（`common/` 是 core 内最底层工具目录，domain import 它无环）。全仓唯一实现，不做分层的第二份。
- **四个码退役**：`INFRA_INVARIANT_VIOLATION`、`VFS_INVARIANT_VIOLATION`、`PROMPT_INVARIANT_VIOLATION`、`PROVIDER_INVARIANT_VIOLATION` 从 `ErrorCodes` 删除（码表 append-only 意味着历史码不回收，但键可以退役并从 `ErrorKey` 联合移除；`error-codes.ts` 的退役注释按既有约定登记）。
- **9 处落点**（core 8 + mobile 1）：

| 文件:行 | 现值 | 改法 |
|---|---|---|
| `bootstrap/schema-migrations/index.ts:62` | `INFRA_INVARIANT_VIOLATION`「重复的 schema migration id」 | `assert(!seen.has(id), ...)` |
| `domain/prompt/logic/normalize-agent-prompt-layout.ts:96` | `PROMPT_INVARIANT_VIOLATION`「白名单漏字」 | `assert` |
| `domain/provider/logic/provider-identity-repair.ts:76` | `PROVIDER_INVARIANT_VIOLATION`「双身份键不变量破坏」 | `assert` |
| `domain/vfs/logic/vfs-tree-copy.ts:39` | `VFS_INVARIANT_VIOLATION`「Path 不在前缀下」 | `assert` |
| `infra/llm-protocol/logic/registry.ts:39` | `INFRA_INVARIANT_VIOLATION`「没有对应 protocol adapter」 | `assertNever` |
| `service/integrity-repair.ts:104` | `INFRA_INVARIANT_VIOLATION`「重复」 | `assert` |
| `service/agent/impl/agent-runner.ts:455` | `INFRA_INVARIANT_VIOLATION`「missingDeps」 | `assert` |
| `service/vfs/impl/vfs-zip-io.service.ts:157` | `VFS_INVARIANT_VIOLATION`「Path 不在前缀下」 | `assert` |
| `apps/mobile/src/services/rn-file-io.ts:44` | `INFRA_INVARIANT_VIOLATION`「react-native-blob-util.fs unavailable」 | 改挂既有 `INFRA_UNSUPPORTED_PLATFORM`（平台能力缺失，不是不变量破坏） |

- **边界兜底**：`formatIpcError` / CLI 的 `exitCodeForError` / 移动 `format-error` 对非 `AppError` 的未知异常已统一兜成 `INFRA_UNEXPECTED_ERROR`（既有行为，不改）；`AssertionError` 走这条兜底，**不新增码**。开发环境下 `AssertionError` 的 message 带 `[invariant]` 前缀便于定位。
- **不变量断言不得被 `catch` 吞掉**：断言抛错必须能冒到边界。任何 `catch (e)` 里 `isAppError(e)` 的分类逻辑不会命中 `AssertionError`，因此天然穿透——这是选择 `AssertionError` 而非 `AppError` 的第二个理由。

### 6.2 工具取消不再用 `throw`（`TOOL_CANCELLED` 码保留，只改传播通道）

**基线实测（eecff1b29）**，spec 早期版本对这块的描述有多处与代码不符，先纠正：

- 工具签名是 `run(...): Promise<Result<Output, AppError>>`（`domain/tool/model/tool.ts:48`），**不是** `{ ok: boolean }`；也**没有** `tool-result.ts` 这个文件（`domain/tool/model/` 下只有 `tool.ts`）
- `tool-runner` 的并发是 `Promise.all` + 8 并发 worker pool（`tool-runner.ts:148-181`），**不是** `Promise.allSettled`；并行结果类型是 `ParallelToolOutcome = { ok: true; output } | { ok: false; error: unknown }`（`tool-runner.ts:20`）
- `TOOL_CANCELLED` 的**构造点共 11 处**（不是 5 处）：`search-tool.ts:208/217/227`（三处均 throw）、`curl-tool.ts:298`（throw）与 `:315`（`return new AppError(...)`）、`template-engine.ts:102/207`（`Result.err(new AppError(...))`）、**`duckduckgo.ts:134`（`return Result.err(new AppError(...))`）**、`tool-runner.ts:83`（throw）与 `:95/:98`（`race` 的 reject 载荷）
- **消费方 3 处**：`format-tool-output.ts:307`（→ LLM 可见文案「工具调用已取消」）、`build-tool-result-block.ts:284`（→ `ok:false` 卡片）、`apps/cli/src/cli-errors.ts:40`（→ exit 130）；另 `tool-runner.ts:25` 的 `TOOL_PASSTHROUGH_KEYS` 含该码

**拍板：`TOOL_CANCELLED` 码保留，不退役。** 它已有 `messageKey`（`error.tool.cancelled`）+ i18n 双语模板 + LLM 可见文案 + CLI exit 130 一整套展示契约，退役会让 4 处测试断言与 3 处消费点同时断裂，收益远小于成本。

**要改的只是传播通道**——把「控制流靠 throw」换成「返回值 + runner 层识别」：

1. **工具内部 8 处构造点**（`search-tool` 3、`curl-tool` 2、`template-engine` 2、`duckduckgo` 1 —— 其中 `curl-tool:315`、`template-engine` 两处、`duckduckgo:134` 已是 `return Result.err`，需要从 `throw` 改成 `return` 的是 **`search-tool:208/217/227` 与 `curl-tool:298`** 共 4 处）：统一返回 `Result.err(new AppError("TOOL_CANCELLED", { detail }))`，**不再 throw**。工具签名不变（本来就是 `Result`），调用方零改动。
   **`curl-tool` 的 `phaseError` 帮助函数**（`curl-tool.ts:313-317` 返回 `unknown`，由 `:331`/`:378` `throw phaseError(e)` 抛给父级）必须一并改造：把 `phaseError` 改成返回 `Result.err` 或让两个调用点直接 `return Result.err(...)`，否则父级取消仍走 throw，且 T-S26 的 `grep "throw new AppError(\"TOOL_CANCELLED\""` 探不到这个形态（它是 `throw phaseError(e)`）。
2. **`tool-runner` 汇总**：`Promise.all` + worker pool 保持；收集后 `isAppError(err, "TOOL_CANCELLED")` 命中即视为取消，把整体结果收成 `Outcome.cancelled`（`reason` 从 `scope.reason` 取）**向上返回，不再往下抛**。`ParallelToolOutcome` 增加一个 `{ kind: "cancelled" }` 形态（或直接把 `tool-runner` 的对外返回改成 `Outcome<...>`，由 agent-runner 的检查点统一收口）。
3. **`tool-runner.ts:95/:98` 的 `race` reject 载荷**：这是平台协议例外（Promise 只能 reject），保留 `rejectWith` 形态；载荷从 `new AppError("TOOL_CANCELLED", ...)` 改为 `createAbortError()`，让 `isAbortLikeError` 统一识别。**`tool-runner-abort.test.ts` 现有 4 处 `isAppError(err, "TOOL_CANCELLED")` 断言需要适配为 `isAbortLikeError`**（T-S26 的口径据此改写，不再是「零改动绿」）。
4. **消费方 3 处**（`format-tool-output.ts:307`、`build-tool-result-block.ts:284`、`cli-errors.ts:40`）：**零改动**——`TOOL_CANCELLED` 码仍存在，它们照旧 `isAppError(e, "TOOL_CANCELLED")` 命中。
5. **`TOOL_PASSTHROUGH_KEYS`**：保留该码。

**收益**：改完之后，全仓**没有任何一处用 `throw` 表达取消**，只剩 `race()` 的 reject（Promise 没有 Result 通道的物理限制）。`TOOL_CANCELLED` 从「控制流信号」降级为「展示层标签」——它只描述「这次工具调用被取消了」这个**结果**，不再承担传播职责。

### 6.3 30 处业务失败 `throw` 改 `return Result.err`

错误通道迁移收口后仍有 30 处纯业务失败在 `throw new AppError`（函数本身已能返回通道类型，只是没改）。逐 key 清单：

| key | 处数 | 位置 |
|---|---|---|
| `VFS_NOT_FOUND` | 7 | `sqlite-vfs-entry.repository.ts`、`sqlite-vfs-revision.repository.ts`×2、`revision-aware-vfs.service.ts`×4 |
| `CHAT_NOT_FOUND` | 6 | `message.service.ts`×3、`project.service.ts`×2、`session.service.ts` |
| `VFS_NOT_A_DIRECTORY` | 2 | `vfs-batch-io.service.ts`、`vfs-zip-io.service.ts` |
| `COMPACTION_CONDITIONS_INVALID_SCHEMA` | 2 | `compaction-conditions-store.service.ts`×2 |
| `CLOUD_SYNC_NETWORK` | 2 | desktop `cloud-sync.service.ts`×2 |
| `INFRA_VALIDATION_FAILED` | 2 | mobile `character-card-document-pick.ts`、`yaml-document-pick.ts` |
| 其余 1 处/个 | 9 | `CLOUD_SYNC_AUTH`、`CHAT_INVALID_ARGUMENT`、`SKILL_ALREADY_EXISTS`、`SKILL_MISSING_PROJECT_ID`、`SMART_SORT_RULE_NOT_FOUND`、`TOOL_CONFLICT`、`TOOL_INVALID_ARGUMENT`、`VFS_CHARACTER_CARD_INVALID_PATH`、`VFS_CONTENT_BLOB_MISSING` |

改法：函数签名改 `Promise<Result<T, AppError>>`（或 `Outcome<T>`，若该函数也可能被中断则用 `Outcome`），`throw new AppError(…)` → `return Result.err(new AppError(…))`，调用方逐层适配 `if (!r.ok) return r;`，边界 `throw r.error`。

**保留 throw 的三类**（不在本批）：`SESSION_FS_ROLLBACK_*` 4 处（回滚补偿链，语义上必须在事务边界抛错触发回滚）、`INFRA_UNEXPECTED_ERROR` 0 处（基线已无 `throw new AppError("INFRA_UNEXPECTED_ERROR")`，它只作边界 payload 映射）、`TOOL_CANCELLED` 5 处（6.2 改为 `Outcome.cancelled`）。

### 6.4 `errors/vfs-errors.ts` 与 `errors/session-fs-errors.ts` 合并进 `guards.ts`

两个文件现在各只剩一个一行的域守卫：

```ts
// vfs-errors.ts（2.1KB）: VfsReplaceNotFoundDetails 类型 + isVfsError = (e) => inDomain(e, "VFS", "VFS_CHARACTER_CARD")
// session-fs-errors.ts（0.9KB）: isSessionFsError = (e) => inDomain(e, "SESSION_FS")
```

而 `errors/guards.ts`（4.8KB）已经有 `inDomain`、`isAppErrorWithKey`、三个 rollback 语义守卫。改动：

- `isVfsError` / `isSessionFsError` 两个一行组合搬进 `guards.ts`（与 `inDomain` 同文件，域判定只有一个实现入口）
- `VfsReplaceNotFoundDetails` 是 edit REPLACE_NOT_FOUND 的 LCS 诊断字段类型，随 `isVfsError` 一起搬进 `guards.ts`
- **删除 `vfs-errors.ts` 与 `session-fs-errors.ts`**，所有 import 点改指 `guards.ts`；`public/vfs.ts` / `public/session-fs.ts` 的转发从 `guards.ts` 转发
- 验收：`grep -rn "errors/vfs-errors\|errors/session-fs-errors" packages apps --include=*.ts` 结果为 0；`errors/` 目录从 8 个文件降到 **6 个**（现 8 个：app-error / domain / either / error-codes / guards / outcome / session-fs-errors / vfs-errors；删两个、`assert.ts` 归 `common/` → 6 个）（`app-error` / `domain` / `either` / `error-codes` / `guards` / `outcome` / `assert` 若归 errors）

### 6.5 Step 与验收

本节四项债对应的实施项见「详细实现步骤」的 **Step 16 / Step 17**，验收见「测试策略」的 **T-S25 ~ T-S27**。

## 同批 nm style 收口口径

本迭代只对**变更点清单里的文件**做 style 收口，不做全仓规范化。

**必做（新增代码合规，属验收项）**：

- **i18n**：新增 UI 文案（取消按钮、不可中断提示、`IPC_ABORTED` 提示）一律 descriptor 形态（`t({ key: "..." })`），禁止裸字符串——裸字符串会直通渲染成 key 文本；双端镜像文案逐字 diff，测试锁整句片段（一字之差错位能逃过关键词断言）。
- **日志**：取消链路的日志带结构化字段 `{ key, reason, phase }`，禁止裸拼接。
- **Either / Outcome**：`checkpoint()` 返回 `Interrupt | null`；可能被中断的 service 方法与 handler `doWork` 返回 `Outcome<T>`；只有业务失败的函数返回 `Result<T, AppError>`；纯计算函数保持 `Result`。**`TOOL_CANCELLED` 码保留**，但只作展示标签，不承担传播职责。只在边界（handler / service / tool / IPC / CLI）把 `Interrupt` 转 `throw createAbortError()`、把 `Result.err` 转 `throw r.error`。**平台协议例外**保留 throw 并在适配层转码：`race()` 的 reject、`fetch` 的 `AbortError`、`better-sqlite3` 事务回滚靠抛错。
- **机械 style**：变更文件的签名/调用/RHS 一行化，统一 `npx prettier --check --print-width 200` 复核（仓库无 `.prettierrc`，默认 80 会把已并行的代码拆开）。

**不做（只记录、另开批次）**：

- 变更文件里既有的 i18n 硬编码、裸字符串日志、throw 型 domain 错误等**存量**缺口。实施时记录进报告的「强制未处理表」，不在本迭代顺手改。

**门禁**：`node .agents/skills/nm-code-style/scripts/check-style.mjs --changed` 的 signatures/inline/methods 三段全 PASS；exports/oop 段的 DEAD / TEST_ONLY 假阳性按既有口径记录，不当作本迭代新缺口。

## 详细实现步骤

- Step 1 — phase-scope-core — blocking: yes — qa: auto：新建 `domain/abort` 六个文件（含 `logic/create-abort-error.ts`，从 `request-abort.ts` 上移、原文件 re-export），实现 `AbortSignalView`/`AbortScope`/`LongTaskHooks`/`AbortRegistry`/`ABORT_KEY` 与三工厂（含 fork 级联、deadline、race 防 unhandled、dispose 清定时器与子 scope），`checkpoint()` 返回 `Interrupt | null`，不接任何调用方；补 `public/abort.ts` 与 `package.json` exports（`AbortReason` / `Interrupt` **re-export 自 `errors/outcome.ts`，定义不迁移**，`public/errors.ts` 已导出）；**同批更新 `errors/outcome.ts:10-13` 的模块注释**——删掉「signal-abort-scope 尚未落地，待其定义同一联合后把这里换成 import」这句过时 TODO，改为「`AbortReason` 与 `Interrupt` 的唯一权威定义处（`domain/abort` 反向 re-export 从这里取）」。
- Step 2 — phase-scope-core — blocking: yes — qa: auto：补 `domain/abort` 单测（T-S1~T-S7），覆盖 reason 不依赖 `signal.reason`、首因锁定、fork 级联与 deadline 取早、**`checkpoint()` 返回 `null` / `{ kind: "cancelled", reason }` 两态**、`yieldToUi()` 同款两态、race 的 rejectWith 与 listener 清理、onCancel 立即执行与注销、dispose 幂等。
- Step 3 — phase-registry — blocking: yes — qa: auto：泛化 `AbortRegistry`，`AgentAbortRegistry` 改薄包装（memoize），新增 T-S8；跑现有 3 个 registry 测试确认零改动绿。
- Step 4 — phase-port-migration — blocking: yes — qa: auto：`model-request.port` 换 scope，`model-request.service` 桥接 `scope.signal` 给 adapter（本步**不动** `adapter.port`）；`agent-runner` 自建 `internalController` 并按根 scope 契约建 scope（此时 `options.signal` 仍在，用 `signalView(options.signal)` 作 parent 过渡），model 调用点改传 scope；同步适配 `model-request-retry.test.ts` 的 fixture。本步结束 `tsc` 必须绿。
- Step 5 — phase-port-migration — blocking: yes — qa: auto：`adapter.port` + 3 个 adapter（含 `listModels` 消费 signal）+ `provider-model.service` + `message-checkpoint.port`/impl 换 scope；`run-agent-turn` 按根 scope 契约建 scope，删除 `AgentRunOptions.signal` 与 `RunAgentTurnOptions.signal`，`AgentTurnRuntimePort.abortRegistry` 更名 `agentAbortRegistry` 并同步 7 处引用；agent-runner 8 处 break 型检查点换 `scope.checkpoint()`，`post_model` 保留；L882 路由改判据；子 agent 改 `scope.fork()`。同步适配 10 份测试的 fixture（语义断言不变）：`agent-runner-abort-rollback` / `run-agent-turn-abort-registry` / `backfill-abort-signal` / `anthropic-partial-stream` / `gemini-partial-stream` / `model-request-retry` / `agent-runner` / `agent-runner-timing` / `agent-runner-token-cache` / `agent-runner-failure-message`；补 T-S20、T-S24。
- Step 6 — phase-port-migration — blocking: yes — qa: auto：`tool-runner.ts` 竞速改 `signalView(signal).race(work, () => createAbortError())`，`ctx.signal` 对外不变；工具返回的 `Result.err(TOOL_CANCELLED)` 汇总成 `Outcome.cancelled` 向上返回（不 throw）；`tool-runner-abort.test.ts` 的 4 处 `isAppError(err, "TOOL_CANCELLED")` 断言适配为 `isAbortLikeError(err)`，**listener 清零断言与用例总数不变**；`search-tool.ts:208/217/227`、`curl-tool.ts:298` 的 `throw` 改 `return Result.err`（共 4 处）。
- Step 7 — phase-long-loops — blocking: yes — qa: auto：`vfs-tree-copy` / `skills.service` 加 hooks 与检查点并返回 `Outcome`；`assemble-workplace-display` 对齐 `LongTaskHooks` 形状（不新增检查点；**基线已返回 `Outcome`，无哨兵可退役**，只是 `shouldStop` → `checkpoint` 更名）；调用方边界按 `matchOutcome` 三分派；补 T-S9~T-S11。
- Step 8 — phase-long-loops — blocking: yes — qa: auto：`sqlite-message.repository` 读/写分片加 `checkpoint`（与既有 `yieldFn` 并列）并返回 `Outcome`；随改造透传 `session.service`/`message.service` 的 copy/fork hooks，事务边界把 `cancelled` 转 `throw createAbortError()` 触发回滚；`count-tokens` / `chunk-splitter` **签名完全不变**（同步纯函数，仍返回裸 `number` / `string[]`），取消由调用方在批间检查点处理；补 T-S12~T-S14。
- Step 9 — phase-desktop-handlers — blocking: yes — qa: auto：`ipc-types.ts` 加 `nm:run/abort` 常量与 DTO、3 个 bindNoArg 通道加 `{ runId? }`、`UsageStatsQueryRequest`/`CloudSyncPushRequest` 加可选 runId；`handler-registry` 与 preload 接线；`nm:agent/abort` 改转发别名；`format-ipc-error` 加 `IPC_ABORTED` 映射；补 T-S21/T-S22。
- Step 10 — phase-desktop-handlers — blocking: yes — qa: auto：6 类 handler 按策略表建 scope + 注册 + finally 释放 + timeoutMs；`run-compaction.ts` 加可选 `hooks`（桌面 compaction handler 注入，agent-runner 自动压缩不传）；runId 可选（缺省只建 scope + deadline，不注册）；`providerModels` 用 `tryRegister`，并发冲突返回 `PROVIDER_MODELS_IN_FLIGHT`；`doWork` 返回 **`Outcome<T>`**、handler 边界按 `matchOutcome` 三分派（`cancelled`/`replaced` → `throw createAbortError()`、`failed` → `throw e`、`completed` → `ipcOk(value)`）；runtime 泛化 registry 与 agent 门面并存，`handlers/agent.ts` 两处判据改门面；补 T-S15。
- Step 11 — phase-mobile-services — blocking: yes — qa: auto：`session-stream-unit-manager` 的 `stopRun` 泛化为 `stop(key)`，3 个调用点适配；移动 runtime retype（泛化 `abortRegistry` + `agentAbortRegistry` 门面），逐处改裸 sessionId 判据（unit-manager、`useChatTabScope` 3 处、`chat-prompt-tokens` 2 处）；4 类 service 按策略表接 scope，**可被中断的方法返回 `Outcome`、不可中断的保持 `Result`**；service 边界 `cancelled`/`replaced` → `throw createAbortError()`（让 promise 以 AbortError reject 给调用方）、`failed` → `throw error`；`CloudSyncCoordinator` 加 `checkpoint`，云同步 catch 对 AbortError 原样上抛并记 cancelled；删 `agent-run.service.ts` 本地 signal 字段；补 T-S16。
- Step 12 — phase-mobile-native — blocking: yes — qa: auto：`LlmSseModule.kt` 加 requestId 首参与 `ConcurrentHashMap` + `requestAbort`（finally 同时清 call 与 userAborted；duplicate id 直接 reject）；`native.ts`/`types.ts` 同步（含可用性探测与解构）；`llm-native-fetch-shim` 双依赖注入 + requestId 独立生成 + 真断连；补 T-S17；门禁 = jest + `node apps/mobile/scripts/run-gradlew.mjs compileDebugKotlin`。
- Step 13 — phase-mobile-native — blocking: yes — qa: manual_user：真机一轮同时取证「点停止 → 连接立即断开（`adb logcat` 看 OkHttp cancel）+ 录屏确认会话回到可发送态」（合并原 Step 13 与 T-S23）。
- Step 14 — phase-ui — blocking: yes — qa: auto + manual_user：桌面设置页长任务与 `FetchModelsModal` 加「取消」按钮接 `nm:run/abort`（mock bridge 断言并入 T-S21），db-maintenance 显示**禁用态**取消按钮 +「正在整理，无法中断」文案；移动 `CloudSyncProgressScreen` / `StorageConfigScreen` / 压缩入口（`useChatTabMessageActions`、`SessionDetailScreen`）把 Alert 按钮换成真实取消，数据清理不提供取消按钮；附真机手验。
- Step 15 — phase-verify — blocking: yes — qa: auto：全仓 `npm run typecheck` + `npm test` + `node .agents/skills/nm-code-style/scripts/check-style.mjs --all` + 变更文件 `npx prettier --check --print-width 200` 收口（style 范围见「同批 nm style 收口口径」节）；逐份确认 5 个 SSE partial 测试（`stream-partial-signature`、`stream-partial-blocks`、`openai-partial-stream`、`anthropic-partial-stream`、`gemini-partial-stream`）与 registry/backfill/tool-runner 测试全绿。

- **Step 16 — phase-error-debt — blocking: yes — qa: auto** ✅ **已完成（七期 tag p7-error-debt，commit 3df20fb4c）**：建 `common/assert.ts`，**9 处** INVARIANT 改 assert/改挂现有码并退役四个码（core 8 + mobile `rn-file-io.ts:44`）；`errors/vfs-errors.ts` / `session-fs-errors.ts` 合并进 `guards.ts` 并删文件（6.1 + 6.4）。
- **Step 17 — phase-error-debt — blocking: yes — qa: auto** ✅ **已完成（七期 tag p7-error-debt，commit 3df20fb4c）**：工具协议换 `Outcome`（6.2），工具取消改返回值传播、`TOOL_CANCELLED` 码保留；**30 处**业务失败改 `Result.err`（6.3）。

**提交边界**：phase 是提交群边界，Step 是工作项。`phase-port-migration`（Step 4-6）作为**一个**提交群合入，Step 4 结束的绿是「群内可编译切面」，不是可发布状态。回滚按 phase 提交群整体 revert。

## 测试策略

### 测试用例

- T-S1 — blocking: yes — `createAbortScope` 初始 `reason === null`、`signal.aborted === false`、`deadlineAt === null`。
- T-S2 — blocking: yes — `abort("user-stop")` 后 `reason` 正确；二次 `abort("timeout")` 不覆盖首因；mock 掉 `signal.reason` 仍正确。
- T-S3 — blocking: yes — `fork()` 子 scope 在父 abort 后级联 abort，`reason === "parent"`；子 `timeoutMs` 与父 deadline 取较早者。
- T-S4 — blocking: yes — `checkpoint()` 未 abort 时返回 `null`；abort 后返回 `{ kind: "cancelled", reason }` 且 `reason` 与首次 abort 一致；**全程不抛、不产生 Error 实例**。
- T-S5 — blocking: yes — `yieldToUi()` 让出事件循环（`setTimeout` 探测宏任务顺序）后返回 `null`；abort 后返回 `Interrupt`。
- T-S6 — blocking: yes — `race()` 在 abort 时以 `rejectWith` 或 AbortError reject（**平台协议例外，保留 reject**）；底层 promise 之后 reject 不产生 unhandledRejection；settle 后监听器被移除。
- T-S7 — blocking: yes — deadline 到点自动 `abort("timeout")`；`dispose()` 后定时器不再触发；`dispose()` 会中止未结束子 scope。
- T-S8 — blocking: yes — `AbortRegistry.abort(key)` 只取消该 key；`abortAll("shutdown")` 取消全部；`unregister` 所有权比对不误删新 scope；`register` 覆盖语义与 `tryRegister` 冲突返回。
- T-S9 — blocking: yes — `vfs-tree-copy` 在中途 abort 时返回 `Outcome.cancelled` 并停止，已复制文件保持完整（无半写）。
- T-S10 — blocking: yes — `skills.service.listSkills` 中途 abort 时返回 `Outcome.cancelled` 而非半份清单。
- T-S11 — blocking: yes — `assemble-workplace-display` 返回 `Outcome.cancelled`（基线已如此）；`assemble-abort-fingerprint.test.ts` **零改动绿**（已断言 `stopped.kind === "cancelled"`）。
- T-S12 — blocking: yes — `sqlite-message.repository.mapRows` 在分片之间 abort 时返回 `Outcome.cancelled`，不返回半份结果。
- T-S13 — blocking: yes — `sqlite-message.repository.batchInsert` 在分片之间 abort 时返回 `Outcome.cancelled`，事务边界把 cancelled 转 `throw createAbortError()` 触发**整体回滚**：目标表无本批残留（不承诺「已完成分片已提交」）。外层事务路径（copy/fork）回滚由外层事务负责。
- T-S14 — blocking: yes — `count-tokens` / `chunk-splitter` 的**签名与返回类型零改动**（`countTokens(): number`、`splitTextIntoChunks(): string[]`，不接收 hooks、不返回 Result）；调用方在批间检查点中断后不返回半截结果。
- T-S15 — blocking: yes — 桌面 6 类 handler：`doWork` 返回 `Outcome.cancelled`、handler 边界 `throw createAbortError()` 后，异步段 abort 在 100ms 内以 `IPC_ABORTED` settle，且 `registry.has(key) === false`。例外：abort 落在策略表标注的任一不可中断窗口内时，允许窗口结束后首个检查点才 settle；窗口之后没有检查点的 handler（backup import / db-maintenance / cloud-sync 尾段）按自然终态 settle（成功即 `ok: true`），不得期待 `IPC_ABORTED`。测试覆盖两种形态——可中断异步段 abort（100ms 内）与入口前已 abort（`doWork` 层直传已 abort scope，避开「未注册 key 静默 no-op」）。
- T-S16 — blocking: yes — 移动 4 类 service：内部返回 `Outcome.cancelled`、边界 `throw createAbortError()`，异步段 abort 后 service promise 以 AbortError **原样** reject（云同步不得被 `mapCloudSyncSdkError` 包成 NETWORK 错误）、进度回调进入终态、云同步账本记 `"cancelled"` 而非 error；不可中断窗口按 T-S15 同款例外；`CloudSyncCoordinator` 的 `shouldStop` 在真实阶段边界被调用。
- T-S17 — blocking: yes — `llm-native-fetch-shim` 在 abort 时调用注入的 `requestAbort(requestId)`（工厂注入 mock 断言）并立即 reject；native reject 后到达不产生二次 settle。
- T-S18 — blocking: yes — `AgentAbortRegistry` 旧 API：`agent-abort-registry.test.ts` 全程零改动绿；`run-agent-turn-abort-registry.test.ts` / `agent-runner-abort-rollback.test.ts` 在 Step 3（registry 泛化）后零改动绿、Step 5（删 signal）后经 fixture 适配、语义断言绿。
- T-S19 — blocking: yes — `request-abort.test.ts` 零改动绿；`backfill-abort-signal.test.ts`、`tool-runner-abort.test.ts` 在 fixture 适配（如需要）后语义断言绿（含「工具调用已取消」文案与 listener 清零）。
- T-S20 — blocking: yes — abort 后 partial assistant 落库不丢：`post_model` 检查点命中时仍写入模型已产出的内容（新增回归锁，防 `checkpoint()` 机械替换）。
- T-S21 — blocking: yes — `nm:run/abort`：合法 `{kind,id}` 取消对应任务；未知 kind 返回 `IPC_INVALID_ABORT_TARGET`；id 不存在或空串返回 `ok: true`（按缺省不注册）；`providerModels` 并发返回 `PROVIDER_MODELS_IN_FLIGHT`；`nm:agent/abort` 转发别名等价于 `abort(ABORT_KEY.agent(sessionId))`；renderer mock bridge 断言取消按钮触发正确的 `{kind,id}`。
- T-S22 — blocking: yes — `format-ipc-error` 把 AbortError 映射为 `code: "IPC_ABORTED"`；renderer 不弹错误 toast（mock 断言）。
- T-S23 — blocking: no — qa: manual_user：Android 真机录屏 + logcat 双取证（已并入 Step 13，不再单独计门禁）。
- T-S24 — blocking: yes — `registry.abort(ABORT_KEY.agent(sessionId))` 后 run 根 scope 的 `reason === "user-stop"`（不是 `"parent"`、不是 null），且 checkpoint 判据与 `stopReason` 一致——防「signal 停了但 scope.reason 恒 null」的静默失效。

- **T-S25 — blocking: yes**：`assert(false, "x")` 抛出的是 `AssertionError` 而非 `AppError`；`isAppError` 不命中；边界把它兜成 `INFRA_UNEXPECTED_ERROR`；四个 `*_INVARIANT_VIOLATION` 从 `ErrorKey` 联合消失（`tsc` 层面验证）。
- **T-S26 — blocking: yes**：**4 处需改造的 throw**（`search-tool:208/217/227`、`curl-tool:298`）与 `curl-tool` 的 `phaseError` 两调用点全部返回 `Result.err(TOOL_CANCELLED)` 且**无一处 throw**（`grep -c "throw new AppError(\"TOOL_CANCELLED\"" == 0`）；`tool-runner` 收到该 err 后整体返回 `Outcome.cancelled`；`race` 路径以 `createAbortError()` reject、`tool-runner-abort.test.ts` 的 4 处断言由 `isAppError` 适配为 `isAbortLikeError` 且 listener 清零断言不变；3 处消费方（`format-tool-output`、`build-tool-result-block`、`cli-errors`）零改动仍命中。
- **T-S27 — blocking: yes**：`grep -rn "errors/vfs-errors\|errors/session-fs-errors" packages apps --include=*.ts` 为 0；`isVfsError` / `isSessionFsError` 仍能从 `guards.ts` 与 `public/*` 拿到且行为不变。

- **T-S28 — blocking: yes**：`scopeFromController(controller)` 之后再用 `createAbortScope({ controller, parent })`，命中 memoize 返回既有实例；断言 parent 级联未静默丢失（或 dev `console.warn` 被触发），且两次取用是同一对象引用。

## 风险与回滚方案

| 风险 | 影响 | 缓解 |
|---|---|---|
| 签名级改造导致编译红时间线拉长 | 无法合并 | 按 phase 切分；Step 4 只动 model-request 面、Step 5 动 adapter/checkpoint 面，保证群内可编译切面；Result 返回类型连锁（repository 读口约 25 处调用方 / vfs / skills / tokenizer）在 phase-long-loops 内按 tsc 红清单逐文件适配，不跨 phase 混提交 |
| Result 传播漏层（某处忘 `if (!r.ok) return r`） | 取消后继续执行、静默写数据 | 检查点与 `if (!r.ok) return r` 写在同一函数紧邻位置，不跨层传 Result；事务边界与 handler 边界 `throw r.error` 兜底；T-S12/T-S13 逐点断言 |
| SSE partial 落库语义被破坏 | 用户丢流式内容 | T-S20 专项锁 + Step 15 把 5 份 partial 测试设为硬门禁；`post_model` 明确不换抛错形态 |
| `race()` 引入 unhandledRejection | 进程告警/崩溃 | T-S6 覆盖；实现里对 `work` 另挂旁路 `.catch(noop)`，race 用原 promise |
| Kotlin 改动编译不过或真机不生效 | 移动端停止仍烧 token | Step 12 门禁加 `compileDebugKotlin`；Step 13 真机验证；失败则回滚 shim 到假取消并保留 deadline |
| `db-maintenance` 同步 VACUUM 无法中断 | 「取消」点了没反应 | 标为不可中断区段；**不要承诺超时兜底**（事件循环冻结时 deadline 也不会触发）；改为前置三重互斥守卫 + UI 文案「正在整理，无法中断」 |
| `backup import` / `cloud-sync pull` 用 `race` 早 settle | rebootstrap 不执行、临时文件被误删、连接悬空 | 策略表明确「禁止 race」，只在替换链开始前 checkpoint；T-S15/T-S16 覆盖补偿链完整性 |
| 移动端 4 类 service 改动触碰云同步事务 | 数据不一致 | scope 只在任务级（job 边界）注册，不进事务内部；换库窗口标不可中断；T-S16 覆盖 |
| 删除 `signal` 后 app 层留死字段 | 假兼容位误导后续维护 | 变更点清单包含 `RunAgentTurnOptions`、双端 `agent-run.service.ts`；Step 5 同批删除 |
| 既有测试被误当「零改动绿」 | 承诺不可兑现 | 按 T-S18/T-S19 两级口径：`agent-abort-registry` / `request-abort` / `tool-runner` 零改动绿；`assemble-abort-fingerprint`（断言抛出 → 断言 err 值）与其余传 `signal:` 的测试（10 份清单）允许最小 fixture 适配、语义断言不变 |
| style 收口范围外溢（顺手改存量 i18n/logger/Either） | diff 膨胀、回滚粒度失真 | 「同批 nm style 收口口径」节写死只碰清单文件与新增代码；存量缺口只记录不动手 |

**回滚**：按 phase 提交群整体 revert，不留双轨。`domain/abort` 可整域删除而不影响其他改动；port 签名与其调用方同群提交，回退即回到改造前状态。

## 已知限制 / 实现注

- **移动云同步是「阶段级取消」，不是真断连**：S3 SDK 单次传输没有 abort 面，取消只在阶段边界生效；UI 文案不得承诺「立即断开下载」。真正的真断连只做在 LLM 非流式请求上（`Call.cancel()`）。
- **`fork()` 的子 scope reason 固定为 `"parent"`**：嵌套层无法区分根因（user-stop / timeout）。这是接受的可观测性取舍；根调用方自己持有的 scope 不受影响。
- **`signalView` 的 `reason` 恒为 null**：裸 `AbortSignal` 没有可靠的 reason 来源，只读视图只能判 `aborted`。需要 reason 的场合必须持有 `AbortScope`。
- **`AbortSignalView` 不是兼容位**：它是只读能力集（工具域/裸 signal 适配），与可驱动的 `AbortScope` 是包含关系。
- **不可中断区段**（只做前后检查）：`better-sqlite3` VACUUM/checkpoint、`batchInsert` 事务内单条批量 SQL、批量 `hideRange`/`showRange`、`backup import` 的 `close → 覆盖 → restore`、云同步换库窗口。
- **abort-controller@3.0.0 的 reason 丢弃是传递依赖行为**，不是 RN 全局实现；「不读 `signal.reason`」是防御性口径，不依赖具体运行时版本。
- **移动云同步的取消记账**：取消不得被 `mapCloudSyncSdkError` 包成 NETWORK 错误；`lastPullResult` 记 `"cancelled"`，UI 不弹错误提示。
- **compaction 的检查点只在 hide 开始前**：`hide → token cache 失效 → KKV 清理` 是不可中断尾段（中途抛错会留下「消息已隐藏、缓存未清」的半应用态），因此不设检查点。桌面/移动取消按钮的语义是「压缩真正开始前可取消」。
- **`createAbortScope` 同时传 `controller` 与 `parent` 是合法组合**：signal 来自 controller，父 abort 级联 `"parent"`，自身 `abort()` 同时驱动 controller。
- **根 scope 必须先建后注册**：`run-agent-turn` 先 `createAbortScope({ controller, parent })`、再 `AgentAbortRegistry.register(sessionId, internalController)`。反序会让 `scopeFromController` 先建出无 parent 的实例，caller 级联静默丢失。
- **取消是控制流信号不是错误**：`checkpoint()` 不抛，返回 `Interrupt | null`；长任务返回 `Outcome<T>`（`cancelled`/`replaced` 不带错误码、不进 i18n、不计错误率）；`Result<T, AppError>` 只装业务失败；`race()`、`fetch` 的 `AbortError`、`better-sqlite3` 事务回滚仍是 throw，由适配层与事务边界转 `Result.err` 或 IPC `IPC_ABORTED`。这是 nm-code-style §3「域逻辑 Result、边界 throw」在取消场景的落地形态。
