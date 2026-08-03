---
date: 2026-07-09
---

# 实现路径简化（费力实现整改）技术规格（SPEC）

> 需求：[prd.md](./prd.md)  
> 探索基准：2026-07-09 四路只读探索（Runner / VFS+Lifecycle / ChatTab / 命名+IPC）

## 设计目标

- **编排收敛**：在**不改变可观察行为**前提下，合并偶然 hop（平行装配、无意中间态、分散递减），保留必要 hop（IPC 沙箱、流式合批、事务边界）。
- **单点装配**：`createAgentRunner` deps 仅一处逻辑源；三轨差异经类型安全 `AssembleAgentRunnerDepsInput` 表达。
- **可读编排**：User VFS flush+reorder、Agent 运行态信号映射写入 SPEC 接线图，维护者无需跨 5 模块追踪。
- **ChatTab 可局部演进**：`ChatConversationPanel` 顶层 props ≤40；对话子树经 `ChatTabProvider` 消费。
- **命名与分层契约**：`savedModelId` 语义与代码一致；错误 LLM/用户/IPC/summary 四层文档化 + 单测。
- **分 PR 交付**：M1→M5 顺序，每 PR `npm test` 绿；**禁止**无 migration 的 DB 指针语义变更。

### 编排收敛原则（评审 C-orch 对照）

| 保留 | 收敛 |
|------|------|
| Electron preload→main→core | 三轨手写 `createAgentRunner({...})` |
| Mobile 32ms/64ms stream buffer | 无引用 `useChatTabScrollSnapshot`；**保留** `useChatTabScrollCache` |
| `flushPendingUserVfsTurns` 事务边界 | reorder 与 flush 分属两文件且无单入口文档 |
| Desktop 6 跳 invoke（安全） | 10 份 handler `formatError`、~100 对同质 ipc 封装 |

---

## 总体方案

```mermaid
flowchart TB
  subgraph M1["M1 Runner"]
    FAT[runAgentTurn]
    EV[runRunAgentAction]
    CLI[cli commands]
    FAC[assembleAgentRunnerDeps]
    FAT --> FAC
    EV --> FAC
    CLI --> FAT
  end

  subgraph M2["M2 User VFS"]
    PREP[prepareUserVfsTurnForAgentRun]
    PREP --> FL[flushPendingUserVfsTurns]
    PREP --> RO[trailing user reorder]
  end

  subgraph M3["M3 Lifecycle + ChatTab"]
    MAP[agent-busy-signal.md 映射表]
    CTP[ChatTabProvider]
    CCP[ChatConversationPanel ≤40 props]
    MAP --> CTP --> CCP
  end

  subgraph M4["M4 命名+错误+工具"]
    REN[resolveSavedModelId / savedModelId 字段]
    ERR[error-layering.md + 单测]
    UTIL[@novel-master/core/format 工具]
  end

  subgraph M5["M5 Desktop IPC"]
    FE[formatIpcError 单点]
    FEB[forward-event-bus 纯推送]
    IPCGEN[ipc invoke 映射表/生成]
  end

  M1 --> M2 --> M3
  M3 --> M4
  M3 --> M5
```

### 接线图 A：Runner 装配（目标态）

```text
入口:
  dialogue  → runAgentTurn(runtime, scope, content, options?)
  event     → runRunAgentAction(deps, ctx, params)
  cli       → runAgentTurn(cliRuntimeAdapter, scope, content, RunAgentTurnOptions)

definition 来源（互斥）:
  默认路径  → resolveAgentForProject(runtime, scope.projectId)
              （CLI 无 --agent-config / --agent-id / --prompt-path 时不传 definitionOverride）
  CLI flag  → 仅当 flag 解析成功时传 options.definitionOverride
              （--agent-config / --agent-id / --prompt-path）；注入后 **跳过** resolveAgentForProject

共享:
  assembleAgentRunnerDeps(input) → CreateAgentRunnerDeps
  createAgentRunner(deps)  // 薄工厂不变

轨选项 (AgentRunnerRunOptions，经 runAgentTurn 内 runner.run 透传):
  persistMessages: boolean      // event: false
  publishRunLifecycle: boolean   // event: false
  stream: boolean               // event: false
  maxSteps?: number             // 来自 maxStepsOverride 或 definition.runtime
  signal?: AbortSignal
  onStream?: (ev) => void       // CLI stdout 流式
```

### API 契约：`RunAgentTurnOptions`（目标态完整接口）

```typescript
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { LlmStreamEvent } from "@/service/provider/model-request.port.js";

/** runAgentTurn 第三参 options；CLI / Mobile / Desktop 共用。 */
export interface RunAgentTurnOptions {
  /** 是否流式；默认 true。CLI `--no-stream` → false。 */
  readonly stream?: boolean;
  /**
   * 空 content 续跑且末条为 **user**（含 App Composer 空发）。
   * `runAgentTurn` 跳过「content 非空」校验；不 append user。
   */
  readonly allowResumeWithoutInput?: boolean;
  /**
   * CLI assistant-continue：**空 content** + **visible 末条 assistant** + `maxStepsOverride: 1`。
   * `runAgentTurn` 跳过「末条须 user」校验；不 append user。App 不传此字段。
   */
  readonly allowAssistantContinue?: boolean;
  readonly signal?: AbortSignal;
  /** CLI `--modelId`；透传至 runner.run.cliModelId，覆盖 definition.model pin。 */
  readonly cliModelId?: string;
  /** 覆盖 definition.runtime.maxSteps；CLI `continue` → 1；`--max-steps` → 用户值。 */
  readonly maxStepsOverride?: number;
  /** CLI stdout 流式回调；App 经 eventBus，通常不传。 */
  readonly onStream?: (event: LlmStreamEvent) => void;
  /**
   * 仅 CLI `--agent-config` / `--agent-id` / `--prompt-path` **解析成功**时注入。
   * 非空时 **跳过** resolveAgentForProject；无 flag 时不传，走默认路径（PRD R2 / T-R2）。
   */
  readonly definitionOverride?: AgentDefinition;
  readonly onUserMessageAppended?: () => void | Promise<void>;
  readonly onAfterResolveModel?: (
    ctx: RunAgentTurnAfterResolveContext,
  ) => void | Promise<void>;
  readonly onRunFailed?: (ctx: {
    readonly stage: string;
    readonly error: unknown;
    readonly scope: AgentTurnScope;
    readonly savedModelId?: string;
    readonly stream: boolean;
  }) => void;
}
```

**模型解析与 runner 透传链**（`run-agent-turn.ts` 内）：

```text
definition =
  options.definitionOverride
  ?? (await resolveAgentForProject(runtime, scope.projectId)).definition

{ savedModelId, workspaceModelId } =
  resolveApplicationModelIdForRun(runtime, definition, options.cliModelId)
  // cliModelId 非空时优先作 savedModelId，再 fallback agent pin → workspace

maxSteps =
  options.maxStepsOverride
  ?? definition.runtime?.maxSteps
  ?? DEFAULT_AGENT_MAX_STEPS

runner.run({
  definition,
  savedModelId,
  workspaceModelId,
  cliModelId: options.cliModelId,
  maxSteps,
  stream,
  signal: options.signal,
  onStream: options.onStream,
})
```

**空 content 续跑校验**（`runAgentTurn` 内，append user 之前）：

```text
trimmed === ""
  ├─ allowResumeWithoutInput → 末条（全量 list）须为 user；否则 AgentTurnError
  ├─ allowAssistantContinue  → 跳过「末条须 user」；要求 maxStepsOverride === 1（CLI continue）
  └─ 二者皆非               → AgentTurnError「消息不能为空」

allowResumeWithoutInput 与 allowAssistantContinue 互斥；CLI continue 按 visible 末条角色二选一。
```

> `resolveApplicationModelIdForRun` 须扩展第三参 `cliModelId?: string`（M1 Step 5 一并落地）。

### API 契约：`assembleAgentRunnerDeps`（结构化入参）

```typescript
import type { ChatAgentSession } from "../impl/chat-agent-session.js";
import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import type { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";

/** 工厂入参：对话轨 / 事件轨共用；差异经 includeCompactionOrchestrator 显式表达。 */
export interface AssembleAgentRunnerDepsInput {
  readonly session: ChatAgentSession;
  /** AgentTurnRuntimePort 或 EventActionDeps 的 runtime 切片（modelRequests、eventBus 等）。 */
  readonly runtime: Pick<
    AgentTurnRuntimePort,
    | "modelRequests"
    | "messageCheckpoint"
    | "regexConfig"
    | "eventBus"
    | "worktreeSnapshot"
    | "worktree"
  > & {
    readonly savedModelRepo?: SavedModelRepository;
    readonly savedModels?: SavedModelRepository; // 事件轨别名
    readonly compactionConditionEvaluator?: CompactionConditionEvaluator;
    readonly eventOrchestrator?: EventOrchestrator;
  };
  readonly registry: ToolRegistry<BuiltinToolContext>;
  readonly toolCtx: BuiltinToolContext;
  /** false → 省略 compactionConditions / eventOrchestrator（事件轨）。 */
  readonly includeCompactionOrchestrator: boolean;
}

export function assembleAgentRunnerDeps(
  input: AssembleAgentRunnerDepsInput,
): CreateAgentRunnerDeps;
```

工厂返回值除 `session`、`registry`、`toolCtx` 等显式字段外，**统一注入**：

```typescript
listAllSessionMessages: () =>
  input.runtime.messages.listBySession(input.toolCtx.sessionId),
```

（由 `toolCtx.sessionId` + `runtime.messages` 推导；对话轨 / 事件轨 / CLI 经 `runAgentTurn` 均不再手写该字段。）

**对话轨调用示例**（`run-agent-turn.ts`）：

```typescript
const session = new ChatAgentSession(runtime.messages, scope.sessionId);
const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
const registry = resolveAgentToolRegistry(baseRegistry, definition);

const deps = assembleAgentRunnerDeps({
  session,
  runtime,
  registry,
  toolCtx: {
    vfs,
    projectId: scope.projectId,
    sessionId: scope.sessionId,
    listSessionMessages: () => runtime.messages.listBySession(scope.sessionId),
  },
  includeCompactionOrchestrator: true,
});
const runner = createAgentRunner(deps);
```

**事件轨调用示例**（`run-agent.handler.ts`）：

```typescript
const session = new ChatAgentSession(deps.messages, ctx.sessionId);
const vfs = deps.sessionVfs(ctx.projectId, ctx.sessionId);
const registry = resolveAgentToolRegistry(probe, definition);

const runnerDeps = assembleAgentRunnerDeps({
  session,
  runtime: deps,
  registry,
  toolCtx: {
    vfs,
    projectId: ctx.projectId,
    sessionId: ctx.sessionId,
    listSessionMessages: () => deps.messages.listBySession(ctx.sessionId),
  },
  includeCompactionOrchestrator: false,
});
const runner = createAgentRunner(runnerDeps);
```

**CLI 调用示例**（`commands.ts`，M1 Step 5 目标态）：

```typescript
const definitionFromFlags = await tryResolveDefinitionFromFlags(rt, flags);
// 仅 --agent-config / --agent-id / --prompt-path 解析成功时非 undefined

const options: RunAgentTurnOptions = {
  stream: !noStream,
  cliModelId,
  maxStepsOverride: subcommand === "continue" ? 1 : resolvedMaxSteps,
  onStream: noStream ? undefined : (ev) => { /* stdout */ },
};
if (definitionFromFlags != null) {
  options.definitionOverride = definitionFromFlags; // 跳过 resolveAgentForProject
}
if (subcommand === "continue" && !content) {
  const visible = (await rt.messages.listBySession(sessionId)).filter((m) => !m.hidden);
  const lastVisible = visible[visible.length - 1];
  if (lastVisible?.role === "user") {
    options.allowResumeWithoutInput = true;
  } else if (lastVisible?.role === "assistant") {
    options.allowAssistantContinue = true; // documented exception；须 maxStepsOverride: 1
  }
}
await runAgentTurn(rt, { projectId, sessionId }, content ?? "", options);
// 无 flag 时不传 definitionOverride → runAgentTurn 内 resolveAgentForProject（R2 / T-R2）
```

### 接线图 B：User VFS 发送前编排（目标态）

```text
runAgentTurn
  └─ prepareUserVfsTurnForAgentRun({ messages, userVfsTurn, sessionId, trimmedInput })
       ├─ if empty-resume && hasPending && lastIsUser:
       │    snapshot trailing user → delete → flush → finally re-append
       └─ else if hasPending: flush only
       └─ (内部调用 DefaultUserVfsTurnService.flushPendingUserVfsTurns)

不变量:
  - 无 U-U-A
  - synthetic user_vfs_action + user_vfs_ack 双行
  - checkpoint 锚在 action 行（事务外 capture 语义保持）
```

### 接线图 C：Agent 运行态信号映射（Mobile）

> **命名策略（P1-3）**：`agent-busy-signal.md` 与下表契约字段仅用 **`uiBusy` / `agentBusy`** 作文档别名；**实现代码保持现有标识符** `uiRunning`、`agentActive`（及 `isMobileAgentActive()`），M3 **不重命名** TS 变量/字段。消费方按映射表选用正确信号，禁止混用。

| 用户可见行为 | 契约字段（文档） | 代码字段 | 数据源 | 禁止 |
|-------------|----------------|---------|--------|------|
| 输入框禁用 / Composer `running` | `uiBusy` | `uiRunning` | `useAgentRunLifecycle().uiRunning` | 用 `agentActive` 代替 |
| 流式横条 / metrics bar | `uiBusy` | `uiRunning` | 同上 + `streamTailGenerating` | — |
| 批量删/压缩/分叉门禁 | `uiBusy` | `uiRunning` | `lifecycle.uiRunning` | 用 `agentActive` 代替 |
| 工具卡「执行中」/ transcript busy | `agentBusy` | `agentActive` | `isMobileAgentActive()` / subscribe | 用 `uiRunning` 代替 |
| 消息 reload 合并（run 中跳全量） | `agentBusy` | `agentActive` | `agentActive` ref | 用 `uiRunning` 代替 |
| 过滤迟到 stream/run 事件 | `activeRunId` | `activeRunId` | `useAgentRunLifecycle` | — |

`agentActive` 递减（Mobile）：

```text
权威路径: useChatStreamRuntime → FINISHED/FAILED + acceptRunEvent → decrementAgentActive
兜底路径: ChatComposer.executeRun.finally → decrementAgentActive（仅 isMobileAgentActive）
幂等: agent-activity.ts refcount ≤0 忽略
```

Desktop：`agentActive` 仅在 main `handlers/agent.ts` 增减；renderer **不** decrement。

### API 契约：`ChatTabNavigationContext`（M3 Step 18）

消除 `ChatTabScreen` L323–356 `setChat` effect 镜像；`AppHeader` 直接订阅对话 scope 导航态。

```typescript
/** 只读导航切片：由 ChatTabProvider 供给。 */
export type ChatTabNavigationState = {
  readonly chatSubview: 'list' | 'conversation';
  readonly sessionListPanel: 'sessions' | 'projects';
  readonly projectName: string | undefined;
  readonly sessionTitle: string | undefined;
  readonly sessionDrawerOpen: boolean;
  readonly projectDrawerOpen: boolean;
  readonly sessionBatchActive: boolean;
  readonly workspaceCanGoUp: boolean;
};

export type ChatTabNavigationActions = {
  readonly backFromConversation: () => void;
  readonly showChatPanel: () => void;
  readonly closeSessionDrawer: () => void;
  readonly closeProjectDrawer: () => void;
  readonly showSessionsPanel: () => void;
  readonly openDrawer: () => void; // conversation → session drawer；list → project drawer
  readonly exitMessageBatch: () => void;
  readonly closeMessageMenu: () => void;
  readonly closeMessageEdit: () => void;
  readonly closeModelPicker: () => void;
  readonly closeAgentPicker: () => void;
  readonly closeSessionRename: () => void;
  readonly exitSessionBatch: () => void;
  readonly workspaceGoUp: (() => void) | undefined;
};

export type ChatTabNavigationContextValue = {
  readonly state: ChatTabNavigationState;
  readonly actions: ChatTabNavigationActions;
};

/** Provider 内 useMemo 聚合 scope + overlay handlers；挂载于 ChatTabScreen 根。 */
export function ChatTabNavigationProvider(props: {
  children: React.ReactNode;
}): JSX.Element;

export function useChatTabNavigation(): ChatTabNavigationContextValue;
```

**挂载**：`ChatTabScreen` 在 `ChatTabProvider` 内层包裹 `ChatTabNavigationProvider`；`AppHeader`（或 layout 壳）调用 `useChatTabNavigation()` 读 `state` / `actions`，**删除** `ChatHeaderContext.setChat` effect 同步。

`agentName` / `modelLabel` **不**进入 NavigationContext——由 `ChatMetaBar`（对话子树）单源展示；自 `ChatHeaderContext` 移除未使用字段。

### API 契约：`ChatTabContextValue` 字段上限草案（≤50）

`ChatTabProvider` 对外 Context 字段计入 PRD C1「等价指标」；**草案上限 50**（当前 `ChatConversationPanel` 79 props，收敛后约 35 字段 + 15 动作回调）。

| 分组 | 字段（计数） | 说明 |
|------|-------------|------|
| **scope** (6) | `projectId`, `sessionId`, `conversationPanel`, `setConversationPanel`, `chatSubview`, `setChatSubview` | 会话路由 |
| **agentMeta** (1) | `agentMeta` | 名称/模型标签对象 |
| **lifecycle** (4) | `uiRunning`, `agentActive`, `activeRunId`, `streamTailGenerating` | 运行态；文档称 uiBusy/agentBusy |
| **stream** (5) | `streamingText`, `streamingThinking`, `streamMetricsLastRun`, `streamMetricsAccRef`, `onStreamReset` | 流式展示 |
| **messages** (8) | `chatMessages`, `hasMoreMessages`, `loadingMoreMessages`, `messageBatchActive`, `messageBatchMode`, `messageBatchSelectedIds`, `messageBatchSelectedCount`, `onMessagesChanged` | 列表与批量 |
| **composer** (3) | `canResumeWithoutInput`, `lastMessageHasToolResult`, `lastMessageIsPlainUserText` | 发送规则 |
| **vfs/worktree** (5) | `sessionVfs`, `sessionWorktree`, `vfsRefreshKey`, `hasWorkspaceModel`, `bumpWorktreeUiToken` | 工作区 |
| **scroll** (4) | `chatScrollKey`, `cachedChatScroll`, `restoredTranscriptScroll`, `onChatScrollSnapshot` | **保留** `useChatTabScrollCache` |
| **overlay** (6) | `sessionDrawerOpen`, `modelPickerOpen`, `agentPickerOpen`, `messageMenuTarget`, `messageEditPrompt`, `useWebviewTranscript` | 浮层态 |
| **actions** (8) | `beginUiRun`, `abortUiRun`, `exitMessageBatch`, `onLoadOlderMessages`, `onOpenFileEditor`, `onNeedModel`, `onRefreshChatMeta`, `onCompactSession` | 高频回调 |
| **合计** | **50** | 其余低频回调经 `useChatTabController()` 具名 hook 导出，**不计入** Context 字段上限 |

`ChatConversationPanel` 顶层仅保留 `visible`、`tokens` 及不可 Context 化的 ref override（目标 ≤40 props）。

### 接线图 D：错误四层分工

| 层 | 函数 | 语言 | 消费者 |
|----|------|------|--------|
| LLM `tool_result.content` | `formatVfsErrorForLlm` / `formatToolErrorForLlm` | 英文 + `[CODE]` | Agent runner 落库 |
| 工具卡 `summary` | `buildToolResultBlock` 内 summary | 英文截断 | MessageList / WebView |
| 用户 Toast / Alert | `formatVfsErrorForUser` | 中文 | Mobile `formatError`；Desktop PreviewPane 等 |
| IPC `{ code, message }` | `formatIpcError`（唯一） | 英文 code | Desktop handlers → renderer |

---

## 最终项目结构

```
packages/core/src/
  service/agent/
    logic/
      assemble-agent-runner-deps.ts      # NEW 单点装配（结构化入参）
      agent-run-max-steps.ts             # NEW DEFAULT_AGENT_MAX_STEPS 导出
      agent-run-lifecycle-helpers.ts     # NEW M3 Step 12b 双端共享纯函数
      prepare-user-vfs-turn-for-agent-run.ts  # NEW M2 编排单入口
      run-agent-turn.ts                  # RunAgentTurnOptions 扩展；调用上述
    logic/agent-run-shared.ts            # resolveApplicationModelIdForRun(+cliModelId)
  domain/agent/logic/
    resolve-saved-model-id.ts            # NEW 或重命名 resolve-application-model-id
  domain/format/                         # NEW M4
    format-char-count.ts
    format-stream-metrics-line.ts
  config-forms/agent/agent-editor-state.ts  # vendorModelId → savedModelId

apps/cli/src/
  runtime.ts                             # + userVfsTurn bundle
  agent/commands.ts                      # run/continue → runAgentTurn

apps/mobile/src/screens/tabs/chat-tab/
  ChatTabProvider.tsx                    # NEW
  ChatTabNavigationProvider.tsx          # NEW（或合入 Provider 文件）
  useChatTabController.ts                # NEW（或合并入 Provider 文件）
  ChatConversationPanel.tsx              # props 收敛
  useChatTabScrollSnapshot.ts            # DELETE（保留 useChatTabScrollCache）

apps/desktop/
  renderer/ipc/
    invoke-registry.ts                   # NEW 映射表（M5 可选 codegen）
  src/main/ipc/
    format-ipc-error.ts                  # 扩展 ToolError unwrap；handlers 统一引用
    forward-event-bus.ts                 # 仅 webContents.send
    handlers/agent.ts                    # 吸收 run 登记；订阅 bus 于 run 编排
  shared/
    agent-event-types.ts                 # 构建脚本从 core 生成或 re-export

.apm/kb/docs/Iterations/implementation-simplification/
  agent-busy-signal.md                   # NEW 接线图 C 固化
  error-layering.md                      # NEW 接线图 D 固化
  ipc-hop-rationale.md                   # NEW 必要 hop 说明
```

---

## 变更点清单

| 域 | 文件 | 变更 |
|----|------|------|
| M1 | `assemble-agent-runner-deps.ts` | 新建；`AssembleAgentRunnerDepsInput` 结构化入参；含 `listAllSessionMessages` 推导；从三处抽取 |
| M1 | `run-agent-turn.ts` | `RunAgentTurnOptions` 扩展（`definitionOverride`、`cliModelId`、`maxStepsOverride`、`onStream`、`allowAssistantContinue`）；用工厂 |
| M1 | `run-agent.handler.ts` | 用工厂；显式 `AgentRunnerRunOptions` |
| M1 | `commands.ts` | `run`/`continue` 改调 `runAgentTurn`；删手写 runner |
| M1 | `cli/runtime.ts` | 注入 `userVfsTurn`（`createUserVfsTurnServiceBundle`） |
| M2 | `prepare-user-vfs-turn-for-agent-run.ts` | 新建；迁入 reorder 逻辑 |
| M2 | `run-agent-turn.ts` | 单行调用 prepare |
| M2 | Desktop `PreviewPane` / Mobile 保存 | 关闭 vfs-tool-error-diagnostics 剩余验收 |
| M3 | `ChatTabProvider.tsx` | 新建；收入 hooks + overlay state |
| M3 | `ChatTabScreen.tsx` | 瘦身；删 Header setChat effect |
| M3 | `useChatTabScrollSnapshot.ts` | 删除 |
| M3 | `forward-event-bus.ts` + `agent.ts` | run 登记迁出 forwarder（可与 M5 合并 PR） |
| M4 | 命名 / `format-*` / `deriveRegexGroupId` | 见 M4 步骤 |
| M5 | `ipc-types.ts` | 删 `EVENT_BUS`；client/register 映射表 |

---

## 详细实现步骤

### M1 — Runner 三轨收敛

- Step 1 — phase-runner-constants — blocking: yes — qa: auto：在 `packages/core/src/service/agent/logic/agent-run-max-steps.ts` 导出 `DEFAULT_AGENT_MAX_STEPS = 20`；`agent-runner.ts` 改引该常量；删除三轨 `?? 20` 字面量。
- Step 2 — phase-runner-assemble — blocking: yes — qa: auto：新增 `assembleAgentRunnerDeps(input: AssembleAgentRunnerDepsInput)`（见 API 契约）；覆盖对话轨字段全集；注入 `listAllSessionMessages`（`toolCtx.sessionId` + `runtime.messages`）；事件轨 `includeCompactionOrchestrator: false` 省略 compaction/eventOrchestrator 字段（类型上显式）。
- Step 3 — phase-runner-assemble — blocking: yes — qa: auto：`run-agent-turn.ts`、`run-agent.handler.ts` 改为调用 `assembleAgentRunnerDeps`；`run-agent-turn.test.ts`、事件 orchestrator 相关测绿。
- Step 4 — phase-runner-cli-runtime — blocking: yes — qa: auto：`apps/cli/src/runtime.ts` 增加 `userVfsTurn: createUserVfsTurnServiceBundle(conn)`；实现 `AgentTurnRuntimePort` 适配（或扩展现有 CLI runtime 类型）。
- Step 5 — phase-runner-cli-parity — blocking: yes — qa: auto：`commands.ts` 的 `run`/`continue` 改调 `runAgentTurn`；`--modelId` → `cliModelId`；`continue` → `maxStepsOverride: 1`；空续跑按 visible 末条：`user` → `allowResumeWithoutInput`，`assistant` → `allowAssistantContinue`（与兼容表 documented exception 一致）；**仅** `--agent-config`/`--agent-id`/`--prompt-path` 解析成功时传 `definitionOverride`（否则走 `resolveAgentForProject`，R2/T-R2）；删除本地 `createAgentRunner` 块。
- Step 6 — phase-runner-parity-test — blocking: yes — qa: auto：新增 `packages/core/test/service/agent/cli-run-agent-turn-parity.test.ts`（或 CLI integration）：**R2** 项目 definition 路径 + **R2-CLI** `definitionOverride` 路径；同一 session 含 pending VFS 时 transcript 顺序与 `runAgentTurn` 一致。
- Step 7 — phase-runner-public-api — blocking: no — qa: auto：在 `public/agent.ts` 导出 `assembleAgentRunnerDeps`、`DEFAULT_AGENT_MAX_STEPS`；`resolveApplicationModelId` 保留 deprecated 别名指向 `resolveSavedModelId`（M4 可完成重命名）。

### M2 — User VFS 编排 + vfs-tool 关闭

- Step 8 — phase-vfs-prepare — blocking: yes — qa: auto：新建 `prepareUserVfsTurnForAgentRun.ts`；从 `run-agent-turn.ts` 迁入 `TrailingUserSnapshot` + reorder 逻辑；行为与现网一致。
- Step 9 — phase-vfs-prepare — blocking: yes — qa: auto：`run-agent-turn.ts` 在 append user 前仅调用 `prepareUserVfsTurnForAgentRun`；`run-agent-turn.test.ts` L250–373 全绿。
- Step 10 — phase-vfs-tool-close — blocking: yes — qa: auto：对照 `vfs-tool-error-diagnostics` PRD 验收 1–7；补 main 缺口并勾选：

  | 验收 | main 状态 / 缺口 | 本 Step 动作 |
  |------|-----------------|-------------|
  | 1 Agent 工具错误无内部 ID | `formatVfsErrorForLlm` + scope 已落地；agent-runner 测覆盖 | 回归 `agent-runner.test.ts` |
  | 2 write 失败可分类 | `format-tool-output.test.ts` 覆盖 | 回归 |
  | 3 edit REPLACE_NOT_FOUND LCS | `longest-common-substring.test.ts` + enrich 已落地 | 回归 |
  | 4 Mobile 保存 baseline 漂移 | `read-user-vfs-save-baseline.ts` + Mobile 已接入 | Desktop **PreviewPane** 保存失败路径接 `formatVfsErrorForUser` |
  | 5 双端 baseline 一致 | `save-baseline-parity.test.ts` 已有 | 绿即关闭 |
  | 6 保存失败中文反馈 | Mobile `format-error.ts` 已接 Core | Desktop PreviewPane 用户 Toast 中文；**缺** `format-vfs-error-for-user.test.ts` 单测 |
  | 7 工具失败不回退无信息句 | `build-tool-result-block.test.ts` 覆盖 | 回归 |

  **明确缺口（须本 Step 闭合）**：`packages/core/test/vfs/format-vfs-error-for-user.test.ts`（CONFLICT、REPLACE_NOT_FOUND、ToolError unwrap）；Desktop 保存失败用户可见中文（PRD V3 / E1）。
- Step 11 — phase-vfs-docs — blocking: no — qa: auto：在 `prepare-user-vfs-turn-for-agent-run.ts` 文件头中文注释链式说明（等价接线图 B）。

### M3 — Agent 运行态 + ChatTab 组合层

- Step 12 — phase-lifecycle-doc — blocking: yes — qa: auto：新增 `agent-busy-signal.md`（接线图 C + 命名策略）；`ChatTabScreen` / `ChatConversationPanel` 按映射表改消费；`useChatTabMessageActions` 与 `handleMessagesChanged` 统一按契约字段审查（代码仍 `uiRunning`/`agentActive`）。
- Step 12b — phase-lifecycle-shared — blocking: no — qa: auto：抽 Mobile/Desktop 镜像纯函数至 `packages/core/src/service/agent/logic/agent-run-lifecycle-helpers.ts`（`shouldAcceptRunEvent`、`shouldIgnoreStaleRunStarted` 等）；双端 `useAgentRunLifecycle` 改 import Core；`agent-run.service.ts` 共有 resolve 逻辑确认已走 `runAgentTurn`（PRD C7）；**Desktop/Mobile agent-run wrapper 不重复 resolve**（definition / model 解析仅在 `runAgentTurn` 内发生一次）。**不**抽 React hook 至共享包。
- Step 13 — phase-lifecycle-mobile — blocking: yes — qa: auto：确认 Mobile decrement 仅 stream 权威 + composer 兜底；`chat-composer.integration.test.tsx` T22/T23 绿（PRD L3）。
- Step 14 — phase-lifecycle-regression — blocking: yes — qa: auto：跑 `agent-run-lifecycle-unify` 相关测（Desktop `agent-run-lifecycle.test.ts`、Mobile stream 测）；PRD L1。
- Step 15 — phase-chattab-provider — blocking: yes — qa: auto：新建 `ChatTabProvider` + `useChatTabController`；迁入 `useChatTabScope/Messages/Stream`、**`useChatTabScrollCache`**（`useChatTabStream.ts`）、lifecycle、stream、overlay state；Context 字段对照「ChatTabContextValue 草案」。
- Step 16 — phase-chattab-panel — blocking: yes — qa: auto：`ChatConversationPanel` 改 Context 消费；顶层 props ≤40（`visible`、`tokens` + 必要 override）；`chat-conversation-panel.integration.test.tsx` 绿。
- Step 17 — phase-chattab-screen — blocking: yes — qa: auto：`ChatTabScreen` 瘦身为 Provider 壳 + `ChatSessionListPanel`；**删除** `useChatTabScrollSnapshot.ts`（死代码，全仓无引用，PRD C3）；**保留** `useChatTabScrollCache`（`chat-tab/useChatTabStream.ts` 导出，Provider 继续消费 scroll 缓存，与 `useChatTabScrollSnapshot` 无关）。
- Step 18 — phase-chattab-header — blocking: yes — qa: auto：删除 L323–356 `setChat` effect；`AppHeader` 通过 `useChatTabNavigation()`（见 API 契约）读 subview/drawer；从 `ChatHeaderContext` 移除未使用的 `agentName`/`modelLabel` 或改由 MetaBar 单源。
- Step 19 — phase-chattab-smoke — blocking: no — qa: manual_user：Mobile 聊天主流程 smoke（列表→对话→流式→批量删→VFS→返回）（PRD C2）。

### M4 — 命名清债 + 错误/跨端工具

- Step 20 — phase-naming-form — blocking: yes — qa: auto：`AgentEditorFormInput.vendorModelId` → `savedModelId`；Mobile/Desktop 编辑器同步；`provider-form` 相关测绿（PRD M1）。
- Step 21 — phase-naming-domain — blocking: yes — qa: auto：`resolveApplicationModelId` → `resolveSavedModelId`（保留 deprecated re-export 一版）；清除 domain 误导注释（PRD M2）。
- Step 22 — phase-naming-desktop-pin — blocking: yes — qa: auto：`AgentEditorView.resolveSavedModelPin` 改 `ipcProviderModelsGetSaved` / `getSavedById`；删除 provider 轮询（PRD M3）。
- Step 23 — phase-error-doc — blocking: no — qa: auto：新增 `error-layering.md`（接线图 D）。
- Step 24 — phase-error-test — blocking: yes — qa: auto：新增 `packages/core/test/vfs/format-vfs-error-for-user.test.ts`；覆盖 CONFLICT、REPLACE_NOT_FOUND、ToolError unwrap（PRD E1）。
- Step 25 — phase-error-ipc-unify — blocking: yes — qa: auto：10 个 handler 本地 `formatError` 删去，统一 `formatIpcError`（扩展 VfsError/ToolError 行为与 vfs.ts 旧逻辑对齐）（PRD E3）。
- Step 26 — phase-util-core — blocking: yes — qa: auto：`formatCharCount`、`buildStreamMetricsLine`、`deriveRegexGroupId` 迁入 `packages/core/src/domain/format/`（或 `packages/core/src/format/`）；Mobile/Desktop 删内联副本（PRD E2）。

### M5 — Desktop IPC 表面收敛

- Step 27 — phase-ipc-dead-channel — blocking: yes — qa: auto：删除 `IPC_CHANNELS.EVENT_BUS` 及注释引用；全仓 grep 0（PRD I1）。
- Step 28 — phase-ipc-forwarder — blocking: yes — qa: auto：`forward-event-bus.ts` 仅 `webContents.send`；`onCoreRunStarted/Finished/Failed` 迁至 `agent-run.service.ts` 或 `handlers/agent.ts` 内 `eventBus.subscribe`（与 `handleAgentRun` 同模块）；`agent-run-lifecycle.test.ts` 绿（PRD I3）。
- Step 29 — phase-ipc-invoke-registry — blocking: yes — qa: auto：新增 `invoke-registry.ts` + main 侧 `register-handlers` 映射表；`client.ts`/`register-handlers.ts` 行数较基线（732+484）降 ≥30%，或提交 codegen 脚本与 SPEC 记录（PRD I2）。
- Step 30 — phase-ipc-event-types — blocking: no — qa: auto：`agent-event-types.ts` 由脚本从 `packages/core/.../event-types.ts` 生成（构建前 `npm run generate:desktop-events`）；renderer 禁止手改生成文件。
- Step 31 — phase-sibling-close — blocking: yes — qa: auto：跑 events-config-validation 相关测 + `npm run test:fast` + desktop test（PRD S1/S2）。

---

## 测试策略

### 原则

- **编排收敛**变更必带 **parity / 回归** 测试，不单靠「看起来一样」。
- 每 PR 至少：`packages/core` 相关单测 + 触及端的最小集成测。
- M3 末 `qa: manual_user` smoke **不阻塞** merge，记入 Review Closure C 类。

### 测试用例

| ID | 映射 Step | blocking | 描述 |
|----|-----------|----------|------|
| T-R1 | 2, 3 | yes | grep 生产代码仅 `assemble-agent-runner-deps.ts` 含完整 `CreateAgentRunnerDeps` 字面量构造 |
| T-R2 | 5, 6 | yes | **项目 definition 路径**（无 CLI flag、不传 `definitionOverride`）：`resolveAgentForProject` 同源下，CLI `run` 与 `runAgentTurn` pending flush 后 transcript 一致（PRD R2） |
| T-R2-CLI | 5, 6 | yes | **CLI flag 路径**：`definitionOverride` 注入时 CLI 与 `runAgentTurn({ definitionOverride })` transcript / VFS 一致（PRD R2-CLI） |
| T-R2-cont | 5, 6 | yes | CLI `continue` 语义表：一致行通过；**documented exception** 行——`allowAssistantContinue` + `maxStepsOverride: 1`（visible 末条 assistant、不 append）与 `maxSteps=1` 锁定单测覆盖（PRD R2-cont） |
| T-R3 | 1 | yes | 仅改 `DEFAULT_AGENT_MAX_STEPS` 一处，三轨默认行为同步 |
| T-V1 | 8, 9 | yes | 空续跑 + pending + 末条 user：delete→flush→append；无 U-U-A |
| T-V2 | 8, 9 | yes | flush 抛错：末条 user 仍 append（现有 run-agent-turn 测保留） |
| T-V3 | 10 | yes | vfs-tool-error-diagnostics 验收 1–7 + save-baseline-parity |
| T-L1 | 14 | yes | agent-run-lifecycle-unify 回归套件绿 |
| T-L2 | 12 | yes | `ChatTabScreen` 无未文档化 `agentRunning` 混用（lint 或结构审查清单） |
| T-L3 | 13 | yes | composer integration T23 双减幂等 |
| T-C1 | 16 | yes | `ChatConversationPanelProps` 键数量 ≤40；`ChatTabContextValue` 字段 ≤50 |
| T-C2 | 17, 19 | no | chat-tab-screen integration 绿；manual smoke |
| T-C3 | 17 | yes | 无 `useChatTabScrollSnapshot` 引用 |
| T-M1 | 20 | yes | 表单类型无 `vendorModelId` 作 UUID 字段 |
| T-M2 | 21 | yes | domain 无误导 `applicationModelId` 指针注释 |
| T-M3 | 22 | yes | Agent 编辑器加载 pin 无 `SavedList` 轮询 |
| T-E1 | 24 | yes | `format-vfs-error-for-user.test.ts` 绿 |
| T-E2 | 26 | yes | `formatCharCount`/`deriveRegexGroupId` 单点 import |
| T-E3 | 25 | yes | handlers 无本地 `function formatError` |
| T-I1 | 27 | yes | 无 `nm:event-bus` 引用 |
| T-I2 | 29 | yes | client+register 行数降 ≥30% 或生成器落地 |
| T-I3 | 28 | yes | `forward-event-bus` 无 `onCoreRun*` 调用 |
| T-S2 | 31 | yes | `test:fast` + desktop test 全绿 |

### 建议 PR 拆分

| PR | Steps | 测试 |
|----|-------|------|
| PR-1 | 1–3, 7 | T-R1, T-R3 |
| PR-2 | 4–6 | T-R2, T-R2-CLI, T-R2-cont |
| PR-3 | 8–11 | T-V1–V3 |
| PR-4 | 12–12b, 14 | T-L1–L3 |
| PR-5 | 15–18 | T-C1, T-C3 |
| PR-6 | 20–26 | T-M*, T-E* |
| PR-7 | 27–31 | T-I*, T-S2 |

---

## 兼容性与迁移说明

### CLI `continue` 语义表（裁决：保留 documented exception）

| 场景 | CLI `nm agent continue` | App | 本迭代裁决 |
|------|------------------------|-----|-----------|
| 末条 **visible** `user`，无 `--content` | 不 append；`allowResumeWithoutInput: true` → 空续跑 + VFS flush/reorder | Composer 空发：`allowResumeWithoutInput: true`；同上 | **一致** |
| 末条 **visible** `assistant`，无 `--content` | 不 append；`allowAssistantContinue: true` + `maxStepsOverride: 1`（assistant-continue） | 不传 `allowAssistantContinue` → `AgentTurnError: 消息不能为空` | **CLI documented exception**（脚本/自动化；App 不改） |
| 末条为 **hidden** `user`，visible 末条为 assistant | 按 visible 末条 → `allowAssistantContinue` | `runAgentTurn` 用**全量**末条（含 hidden）→ 可能走 `allowResumeWithoutInput` | **已知差异**；本迭代不收敛 |
| `maxSteps` | 固定 `maxStepsOverride: 1` | `definition.runtime?.maxSteps ?? DEFAULT_AGENT_MAX_STEPS` | **CLI documented exception** |
| `--content` 非空 | append user 后跑 | append user 后跑 | **一致** |
| `--no-stream` | `stream: false`；无 `onStream` | 由 preferences 决定 | 各端自有策略 |
| pending User VFS + 空续跑 + 末条 user | 经 `runAgentTurn` → `prepareUserVfsTurnForAgentRun` | 同上 | **一致**（收敛后） |

> T-R2-cont 须覆盖：visible-user 续跑 parity（`allowResumeWithoutInput`）、assistant-continue（`allowAssistantContinue` + `maxStepsOverride: 1`）稳定性、`maxSteps=1` 锁定。

| 项 | 策略 |
|----|------|
| `resolveApplicationModelId` | 保留一个 minor 版本的 deprecated re-export；内部改调 `resolveSavedModelId` |
| `AgentEditorFormInput.vendorModelId` | 类型重命名；JSON 表单快照若持久化旧键需在读取层兼容一次（若有） |
| CLI `run` 行为 | 收敛后可能与旧 CLI 旁路不同 → **视为 bugfix**；T-R2 / T-R2-CLI / T-R2-cont 锁定 parity |
| `definitionOverride` | **仅** CLI flag 解析成功时注入；跳过 `resolveAgentForProject`；无 flag 时不传（R2 项目 definition 路径） |
| `allowAssistantContinue` | CLI continue 专用；与 `allowResumeWithoutInput` 互斥；须配合 `maxStepsOverride: 1` |
| 事件轨 `compactionConditions` | 评估是否补注入；若有意排除须在 `assembleAgentRunnerDeps` options 文档化 |
| DB / migration | **无** schema 变更 |
| Desktop IPC 生成 | 首 PR 可只引入映射表不删旧函数，第二 PR 删样板 |

---

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| CLI 收敛暴露漂移 | Step 6 先于 Step 5 写测 | revert PR-2 |
| VFS reorder 触及 checkpoint | 保留 T-V1/V2；不合并 flush 事务与 reorder | revert PR-3 |
| ChatTab Provider 回归 | 先 Step 15 再 Step 16 减 props；保留 integration 测 | revert PR-5 |
| IPC 映射表类型漂移 | `ipc-types.ts` 单源；生成物入 CI | revert PR-7 |
| forwarder 迁移竞态 | 保持 `agent-run-lifecycle.test.ts` 绿 | revert PR-7 中 Step 28 |

单 PR revert 独立；M1–M3 为 P0，优先保证 PR-1–5 可独立回滚而不破坏主干测试。

---

## Context Bundle（供实现 / code-review-loop）

```yaml
iteration_name: implementation-simplification
requirement_path: .apm/kb/docs/Iterations/implementation-simplification/prd.md
spec_path: .apm/kb/docs/Iterations/implementation-simplification/spec.md
baseline_commit: "<落盘时记录>"  # git rev-parse HEAD
baseline_counts: "<落盘时记录>"  # 落盘时执行下列命令并粘贴输出：
  # createAgentRunner 手写装配块（排除 test）:
  #   rg -l 'createAgentRunner\(\{' --glob '!**/test/**' --glob '!**/__tests__/**' packages apps
  # ChatConversationPanel props（当前）:
  #   rg '^  \w' apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx | rg -c 'readonly|:'
  # Desktop IPC 样板行数:
  #   wc -l apps/desktop/renderer/ipc/client.ts apps/desktop/src/main/ipc/register-handlers.ts
explore_summary: |
  Runner 三轨各一处 createAgentRunner 装配；CLI 无 userVfsTurn。
  VFS reorder 在 run-agent-turn；flush 在 user-vfs-turn.service。
  ChatConversationPanel 79 props；useChatTabScrollSnapshot 死代码。
  Desktop 10 处 formatError；forward-event-bus 含 run 副作用。
impact_files:
  - packages/core/src/service/agent/logic/run-agent-turn.ts
  - packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts (new)
  - packages/core/src/service/agent/logic/agent-run-lifecycle-helpers.ts (new)
  - packages/core/src/service/chat/impl/user-vfs-turn.service.ts
  - apps/cli/src/agent/commands.ts
  - apps/mobile/src/screens/tabs/ChatTabScreen.tsx
  - apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx
  - apps/desktop/src/main/ipc/forward-event-bus.ts
  - apps/desktop/renderer/ipc/client.ts
constraints:
  - 不改变 Electron 沙箱 IPC 跳数
  - 不拆除 Mobile stream 32ms/64ms buffer
  - agent-run-lifecycle-unify 行为回归
  - vfs-tool-error-diagnostics 验收 1-7
blocking_steps: [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 24, 25, 26, 27, 28, 29, 31]
```
