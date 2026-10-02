---
zone: w4-runner-adv
agent: 辩护人（对抗机位 · 立场：论证 packages/core/src/service/agent/ 的设计合理性与必要性）
files_scanned: |
  packages/core/src/service/agent/agent.port.ts
  packages/core/src/service/agent/agent-abort-registry.port.ts
  packages/core/src/service/agent/agent-registry.port.ts
  packages/core/src/service/agent/agent-stream-registry.port.ts
  packages/core/src/service/agent/create-agent-abort-registry.ts
  packages/core/src/service/agent/create-agent-registry-service.ts
  packages/core/src/service/agent/create-agent-runner.ts
  packages/core/src/service/agent/create-agent-stream-registry.ts
  packages/core/src/service/agent/default-subagent-definition.ts
  packages/core/src/service/agent/impl/agent-registry.service.ts
  packages/core/src/service/agent/impl/agent-runner.ts
  packages/core/src/service/agent/impl/chat-agent-session.ts
  packages/core/src/service/agent/impl/ephemeral-overlay-agent-session.ts
  packages/core/src/service/agent/logic/agent-run-lifecycle-helpers.ts
  packages/core/src/service/agent/logic/agent-run-max-steps.ts
  packages/core/src/service/agent/logic/agent-run-shared.ts
  packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts
  packages/core/src/service/agent/logic/resolve-agent-for-project.ts
  packages/core/src/service/agent/logic/run-agent-turn.ts
  packages/core/src/public/agent.ts
  packages/core/src/domain/agent/logic/doom-loop.ts
  packages/core/src/domain/agent/logic/resolve-agent-tool-registry.ts
  packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts（消费侧核对）
  packages/core/test/service/agent/*.test.ts（15 文件，锁定行为取证）
  packages/core/test/agent/agent-runner*.test.ts、agent-runner-stream-bus.test.ts、extract-subagent-session-id.test.ts
  docs/apm/RULE.md、docs/Iterations/context-usage-overhaul/cr-fix-spec-r3.md、docs/Iterations/event-config-merge-and-migration-cleanup/**、docs/Iterations/agent-subagent/**
---

## 摘要

agent 主循环与编排壳。`DefaultAgentRunner.run` 是 model↔tool 多轮循环本体（提示词装配→压缩判定→流式请求→工具并行→落库/checkpoint→doom loop→usage 回锚）；`runAgentTurn` 是入口壳（前奏期：backfill/resolve/append+capture/名单/技能预算，含 5 道停止检查点与终态事件收口），`runChildAgent` 是 task 工具背后的子代理递归装配。同目录另有三套 registry（abort / stream / agent 定义）与 lifecycle 纯函数。本区复杂度几乎全部来自**双端事件收口契约**与**子会话工作区共享语义**，不是无差别堆砌。

## 职责与边界

- **主循环**（`impl/agent-runner.ts` 216-1008）：step 循环、模型请求、工具并行、checkpoint、doom loop、流式转发、token 锚点、失败/取消收尾。
- **编排壳**（`logic/run-agent-turn.ts` 319-1030）：入参清洗、@/$ 扫描、批注物化、CoordinatedWrite 前奏、abort 注册、五道 prelude 检查点、终态事件补发、子代理递归（1048-1330）。
- **装配**（`logic/assemble-agent-runner-deps.ts`、`create-agent-runner.ts`）：runner 依赖单点装配 + 工厂。
- **状态容器**（`create-agent-abort-registry.ts` / `create-agent-stream-registry.ts`）：Map 薄封装，全部方法对未注册 sessionId 静默 no-op。
- **UI 侧纯函数**（`logic/agent-run-lifecycle-helpers.ts`）：desktop renderer 消费的守卫判定，core 不含 React。
- **边界外**：`domain/agent/logic/*`（policy/doom loop/校验）、`service/workplace/*`（前缀组装）、`service/compaction-conditions/run-compaction.ts`（压缩执行体）、`domain/tool/*`（工具实现）。本区只**调用**它们。

## 对外接口

| 符号 | 位置 | 消费方 |
|---|---|---|
| `runAgentTurn` / `AgentTurnRuntimePort` / `AgentTurnError` | run-agent-turn.ts:319 / :96 / :167 | desktop `agent-run.service.ts`、mobile `agent-run.service.ts` |
| `createAgentRunner` / `CreateAgentRunnerDeps` | create-agent-runner.ts:68 / :28 | public 导出（desktop 明确禁止直接用，见 `apps/desktop/shared/logic/agent.ts:3`） |
| `assembleAgentRunnerDeps` | assemble-agent-runner-deps.ts:47 | 仅 run-agent-turn.ts:930 / :1281（两处） |
| `createAgentAbortRegistry` / `AgentAbortRegistry` | create-agent-abort-registry.ts:16 | 三端 runtime；`has()` 被 desktop `agent.ts:284` 与 mobile `session-stream-unit-manager.service.ts:1085` 当**判活源** |
| `createAgentStreamRegistry` / `AgentStreamRegistry` | create-agent-stream-registry.ts:23 | 三端 runtime 注入；`append/reset/unregister` 由 runner 调 |
| `createAgentRegistryService` / `AgentRegistryService` | create-agent-registry-service.ts:19 | 三端 runtime；`list()` 合并虚拟 general |
| `PENDING_RUN_ID` / `shouldAcceptRunEvent` / `shouldApplyTranscriptReload` / `shouldIgnoreStaleRunStarted` / `shouldReloadTranscriptOnRunEvent` | agent-run-lifecycle-helpers.ts:21-76 | desktop `useAgentRunLifecycle.ts`、`ConversationPanel.tsx:458`、`conversation-abort-retain.ts:25` |
| `resolveAgentForProject` / `resolveCurrentAgentDefinition` / `resolveApplicationModelIdForRun` / `DEFAULT_AGENT_MAX_STEPS` / `DEFAULT_SUBAGENT_DEFINITION` | 各文件 | 双端 agent-run.service + core 内部 |
| `wrapStreamForBus`（@internal） | agent-runner.ts:1021 | 仅 `test/agent/agent-runner-stream-bus.test.ts` |
| `extractSubagentSessionIdFromOutcome` | agent-runner.ts:191 | 仅 `test/service/agent/extract-subagent-session-id.test.ts` |
| `ChatAgentSession` | impl/chat-agent-session.ts:22 | public 导出 + run-agent-turn 两处装配 |

## 数据访问

本区**不直接触碰表**，全部经 service/repository 端口：

| 数据 | 经由 | file:line |
|---|---|---|
| `chat_message`（append/list/hideRange/truncate） | `MessageService` → `ChatAgentSession` | chat-agent-session.ts:35-58 |
| `session_kkv`（`rule_snapshot` / `file_cache` / `prompt_tokens`） | `SessionKkvService`；前缀组装在 `assembleWorkplaceDisplay` | agent-runner.ts:374 / :987 / :995 |
| `vfs_entry/revision`（只读，经 workplace 展示与工具） | `toolCtx.vfs` / `assembleWorkplaceDisplay` | agent-runner.ts:428 |
| `agent_definition` | `SqliteAgentDefinitionRepository` | create-agent-registry-service.ts:23 |
| `message_checkpoint` | `MessageCheckpointService.capture/release/backfillMissingBaselines` | run-agent-turn.ts:612 / :755；agent-runner.ts:873 |
| `workplace_dir_rule` | `runtime.workplace(scope)` 闭包 | run-agent-turn.ts:855 / :1205 |

进程内状态（无持久化）：`AgentAbortRegistry`（sessionId→AbortController）、`AgentStreamRegistry`（sessionId→{textParts, thinkingParts, handle}）、`runUsageBase`、`lastAnchorSeq`、`toolUseWindow`。

## 依赖关系

**import 的关键上游**：`domain/agent/logic/{doom-loop, resolve-agent-tool-registry, validate-agent-definition, resolve-saved-model-id, generate-agent-run-id}`、`domain/chat/logic/{prepare-user-messages-for-prompt}`、`service/prompt/render-prompt`、`service/compaction-conditions/run-compaction`、`service/workplace/assemble-workplace-display`、`infra/tokenizer/logic/{pick-last-prompt-usage, session-api-prompt-token-store}`、`infra/llm-protocol/logic/tool-definitions`、`domain/tool/logic/{tool-runner, build-tool-result-block}`。

**被谁消费**：`service/chat/impl/session.service.ts:105`（`resolveWorkspaceAgentForNewSession`）、双端 `agent-run.service.ts`、`domain/tool/builtin/task-tool`（经 toolCtx.subagent.runChildAgent 闭包）。

## 辩护理由清单

### B-1 `runAgentTurn` 的 5 道 prelude 检查点 + `publishPreludeRunFinished` / `publishPreludeRunFailed` / `runnerEmittedTerminal` 订阅窗 —— **这是 r3-run-1/2/3/4 四条 P0/P1 的直接落地，不是过度设计**

证据（决策出处）：`docs/Iterations/context-usage-overhaul/cr-fix-spec-r3.md` r3-run-1（:19「前奏期无终态事件的双端统一收口」，用户拍板「事件系统是唯一事实源，双端收敛到同一条事件路径」，:13）、r3-run-2（:50 STARTED/refcount 泄漏）、r3-run-3（:108 子 run 同样前移）、r3-run-4（:118 backfill 段与 ①② 之间无观察点）。

代码：
- `run-agent-turn.ts:319-355` 入口壳只做「建 internalController + 桥接 callerSignal + register」，实现体在 `runAgentTurnWithController`（:482）。**为什么拆两段**：:315-317 注释写明「反注册仍由内层 finally 完成（保持原顺序）；这里再挂一道**幂等**兜底，覆盖『前奏抛错、内层 try 尚未进入』的路径——否则陈旧 controller 会让 `abortRegistry.has` 永久为真，卡死该会话后续的发送门禁」。两道 unregister（:353 与 :1021）走同一引用比对（`create-agent-abort-registry.ts:29` `map.get(sessionId) === controller`），天然幂等。
- `runnerEmittedTerminal`（:519）+ `markRunnerTerminal`（:526）+ `subscribeQuietly`（:426）：判据注释 :500-518 明确说「比 spec 的 `!runnerEntered` 守卫**更强一档**……若只看 `runnerEntered` 就会一个终态都不发——正是 r3-run-2 要消灭的 refcount 永久泄漏换个位置复发」。这是**已发生过的 P0 事故**的补丁，不是猜想的防御。
- `safePublish`（:366）/ `subscribeQuietly`（:426）的 try/catch 不是洁癖：4 个 core 测试用 `eventBus: {} as AgentTurnRuntimePort["eventBus"]` 占位（`annotate-drafts-send.test.ts:85`、`cli-run-agent-turn-parity.test.ts:82`、`run-agent-turn-project-agent.test.ts:67`、`run-agent-turn.test.ts:124`），`publish` 根本不存在。注释 :362-364 点名了这一点。
- **测试锁定**：`run-agent-turn-abort-registry.test.ts` 16 条 it() 逐条钉死——T-PRELUDE-CP1(:1325)、T-PRELUDE-CP2(:1241)、T-PRELUDE-THROW(:1397)、T-RUNNER-FAILED(:1476，恰好一条真实 runId 的 FAILED、零条 '')、T-STARTED-DOWN(:1540)、T-ABORT-EARLY-0(:761)、T-ABORT-EARLY-2(:856)、T-ABORT-EARLY-3(:977)、T-CHILD-CP1(:1797)、T-CHILD-CP2(:1649)、T-ASSEMBLE-ABORT(:651)、T-BACKFILL-ABORT(:1052)。删任一检查点必有用例红。

**结论：不可删。** 若要重构，只能是「把 5 道检查点收敛成一张表驱动」，语义不变。

### B-2 `agent-runner.ts:234-243` 那段 10 行「事件已下移」的注释块 + STARTED 贴在主 try 前 —— 同上，r3-run-2 的补丁留痕

`:386-388` 的 `bus.publish(EVENT_AGENT_RUN_STARTED, ...)` 紧贴 `:390 try {`。注释 :234-243 写明原位置在 `generateAgentRunId()` 之后，导致「本段到主 try 之间（savedModels.findById / preferences 读 / wt 解析）抛错时『STARTED 已发、终态一个都没有』——desktop 侧 refcount 永久泄漏」。用户事故级症状。desktop 侧对端在 `useAgentRunLifecycle.ts:89` 也有对应注释。**这是防止别人把它「挪回原位」的护栏注释**，必须留。

### B-3 `handleAbort` 被 `await` 但函数体只有一行 `stopReason = "cancelled"`，且 10 个调用点各带一个字符串标签（如 `"after_assemble_workplace"`）而标签在函数体内 `_branch` 未用 —— **看似冗余，实为分层事故的可观测性设计**

`:341-343` 全文：
```ts
const handleAbort = async (_branch: string): Promise<void> => {
  stopReason = "cancelled";
};
```
- `async` 保留：`:336-343` 注释「统一 abort 处理……所有检测点与 catch 分支命中 AbortError 都走这里，保证 abort 后 stopReason 一致」。将来若要在 abort 路径做持久化收尾（如 checkpoint），10 个 `await` 点不必改签名。
- 10 个 `_branch` 标签是**每个检测点的定位锚**，与 `agent-runner-abort-rollback.test.ts` 的用例名一一对应（:174「检测点 1 loop_start」、:330「model_request_catch」、:368「检测点 8 before_tool_run」、:408「检测点 9 after_tool_checkpoint」）。标签零成本（字符串字面量）、零行为，却把「在哪个 await 边界上停的」这件事从日志里捞不出来的黑盒变成可 grep 的。**建议保留**；真要收敛，删的应是 `_branch` 参数而不是检查点。

### B-4 `run-agent-turn.ts:655-948` 整段缩进比 try 体少 2 空格（65 行）—— **不是 bug，是补丁脚本留下的缩进断层；行为不受影响，但确实该修**

实测：`:585 try {` 后 `:586-653` 为 4 空格（正确），`:655-948` 为 2 空格，`:949` 起恢复 4 空格。花括号闭合正确（`:992 }` `:993 catch`），**编译与行为均正常**——这与另一机位（w2-core-service-agent）的独立观察一致，是 r3-run-1「把前奏整段包进 try」时只改了花括号没重排缩进的残留。

辩护立场：这是**唯一一条我认为该修的**（纯可读性、零行为风险），但它不属于「故意复杂度」，也不构成 P0/P1。**列为让步项 L-1**。

### B-5 `assemble-agent-runner-deps.ts` 同时接受 `savedModelRepo` / `savedModels` 与 `providerRepo` / `providers` 两套别名 —— **是双轨 runtime 的兼容层，不是随手重复**

`:50-51`：`const savedModels = input.runtime.savedModelRepo ?? input.runtime.savedModels;`。实测三端 runtime 都同时挂了两套字段：
- desktop `create-desktop-runtime.ts:123` 挂 `savedModels`、`:196-197` 挂 `savedModelRepo` + `providerRepo`
- mobile `create-mobile-runtime.ts:193-194` 同款
- CLI `runtime.ts:271-273` 同款

而 `AgentTurnRuntimePort`（run-agent-turn.ts:129-130）声明的是 `savedModelRepo` / `providerRepo`。也就是说 **`AgentTurnRuntimePort` 路径永远走第一个分支，`savedModels`/`providers` 别名只服务 `EventActionDeps` 的 runtime 切片**——而 `EventActionDeps` 已随事件编排器删除（commit `0dae8526`「Step 11-14 全量删除事件编排器」，其 stat 里明确有「清理 assemble-agent-runner-deps.ts 残留的 EventOrchestrator 死类型引用」）。

**辩护结论**：这是**退役中但未清干净的兼容分支**，不是「刻意保留的双形态」。可辩护的部分是「删它要同步删三端 runtime 的重复字段」；不可辩护的部分是「现在还留着」。

### B-6 `resolve-agent-for-project.ts:50-51` 的 `void projectId; void runtime.projects;` —— **项目智能体下线后的墓碑参数，签名不能动**

`:50-51` 两行 `void`。RULE.md:38 明确记载「**项目智能体（已下线）**：曾经的项目级内联智能体定义（`chat_project.agent_config_json`），v1.4.26 起已移除 UI 入口和解析分支，DB 列置空保留」。函数头注释 :42-43 还挂着 `@breaking sessionId 在 chat-session-detail-page 迭代由可选升为必填，所有调用点（core 内 run-agent-turn.ts + apps 多处）需同步透传`。

保留 `projectId` 形参 + `projects` 端口成员的理由：这是 **public 导出**（`public/agent.ts:59-63`，allowlist 快照 `public-agent-allowlist.json` 锁了 `resolveAgentForProject` 与 `ResolveAgentForProjectRuntimePort`），三端 + 6 个 core/agent 测试都在按旧签名调用。`void` 是诚实的「我知道它没用了但我不动签名」的标记。**签名不可动，参数可留。**

### B-7 `AgentStreamRegistry` 的 `get()` 与 `has()` 无生产调用方 —— **代码自己已声明为有意保留，且注释给了口径**

`create-agent-stream-registry.ts:65-66`：
```
// 只读快照口：当前为内部/测试用途（无生产调用方），保留以维持
// register/append/reset/get/has/unregister 的对称读口（core-transport Q3）。
```
我实测复核了这个断言：全仓 `git grep streamRegistry` 在 `apps/mobile/src` 只有 2 处注释引用 + runtime 注入，`get()` 唯一调用出现在 `apps/mobile/__tests__/chat-tab-screen.integration.test.tsx:383`（mock 自身）；`has()` 在生产侧零调用（abortRegistry 的 `has` 才是判活源，见 B-8）。

**辩护结论**：注释是**诚实的**（没谎称有消费方），`get` 有 8 条测试锁着（`agent-stream-registry.test.ts:51`），且 mobile 的 partial 注入已在 `session-stream-unit.ts:1218 tryInjectPartialInto` 里自建了一套（`materializePartialText/Thinking`），与 core registry 的 `get` 语义重叠但**不冲突**（前者是 UI 单元内累积，后者是跨 step 的 run 级累积）。

**但「core-transport Q3」这个引用在仓库里查无出处**（`git grep -i "core-transport"` 全仓 0 命中）。所以这是「有意保留但依据已不可核」——列入让步项 L-3（建议补出处或改为直白的「暂无生产消费方，UI 侧 partial 由 session-stream-unit 自持」）。

### B-8 `AgentAbortRegistry.has()` 被三端当「run 在途」判活源 —— 这解释了为什么 abort 注册必须前移到函数入口

实测消费方（9 处生产调用）：
- desktop `ipc/handlers/agent.ts:284` `return runtime.abortRegistry.has(sessionId)`、`:389` 转调 IPC
- mobile `use-chat-tab-scope.ts:165` / `:198`、`chat-prompt-tokens.service.ts:354` / `:363`（`shouldBail`）、`session-stream-unit-manager.service.ts:488` / `:1085` / `:1234`

r3-dt-align（cr-fix-spec-r3.md:92）写死了这条选型：「判活源写死 `rt.abortRegistry.has(sessionId)`（不用 activeRuns——abortRegistry 在 runAgentTurn **函数入口**注册、语义更贴『在途』、额外覆盖子 run）」。

**这直接锁死了 `run-agent-turn.ts:342` 的注册位置**：一旦注册挪回 runner 起步前，`has()` 就在整个前奏期（真机秒级）返回 false → mobile token 读口不抑制、desktop 停止按钮不亮、发送门禁失效。所以 B-1 里「abort 注册前移」不是可以为了简洁而回退的优化点。mobile `chat-prompt-tokens.test.ts:382` 那条用例（"2026-09-30 停止失灵病灶"）就是这条不变式的测试锁。

### B-9 `EphemeralOverlayAgentSession` + `persistMessages` / `publishRunLifecycle` 两个开关 —— **port 契约要求，生产暂无调用方但语义被 6 条测试锁死**

实测：`git grep "persistMessages: false|publishRunLifecycle: false"` 在 `packages/core/src` 与 `apps/` 生产代码里**零命中**，只在测试里出现（`agent-runner-failure-message.test.ts:240/491`、`agent-runner-token-cache.test.ts:361`）。

它的原始消费方 `runRunAgentAction`（事件触发的嵌套 agent run）随 `0dae8526` 一起删了——`ephemeral-overlay-agent-session.ts:4` 的注释 `Used by {@link runRunAgentAction}` 现在指向一个不存在的符号。

但保留它有硬理由：`agent.port.ts:22-26` 是 **public 导出的 port 契约**（`AgentRunOptions` 在 allowlist 里），且 runner 内 `persistMessages` 参与了 **8 处**行为分叉（agent-runner.ts:228 / :366 / :504 / :743 / :868 / :930 / :983）——包括「overlay run 的 usage 不落 KKV」「失败消息不落库」「空回复占位不落库」。这些分叉各自有测试。**契约在，实现留不留是产品决策**；辩护立场是「不该在 CR 里当死代码删」。

**让步项 L-4**：`:4` 的 `{@link runRunAgentAction}` 是**悬空文档链接**（全仓 0 命中），该修。

### B-10 `wrapStreamForBus` 的「单条 microtask 合批」—— **r3 修复的产物，6 条测试逐条钉死顺序语义**

`:1010-1020` 注释：`@internal Exposed for stream-bus deferral unit tests`。改造前是「每个 event 各自 queueMicrotask」，N 个 event 插 N 条微任务、中间可能被订阅者倒序调用打乱。`test/agent/agent-runner-stream-bus.test.ts` 的 6 条 it() 逐条断言合批与顺序。**这是可观测行为的精确契约，不是性能微调**——删掉 `pendingQueue` 合并会让跨批次顺序随机化。

同时 `run-agent-turn.ts:563` 与 `agent-runner.ts:611-624` 的「timing onStream 包在 wrapStreamForBus **之外**、不改事件流向」也是刻意的：注释 :611-612「在 bus 分发层之外再包一层……不改变事件流向内层回调；wrapStreamForBus 本身不动」。`agent-runner-timing.test.ts` 3 条 it() 锁 TTFT 口径。

### B-11 `extractSubagentSessionIdFromOutcome` 与 `buildToolResultBlock` 内部检测「互补」—— 注释自称冗余，但确实互补在**中断回流路径**

`agent-runner.ts:180-190` 注释自陈「本函数与 `buildToolResultBlock` 内部检测互补……这里显式提取是为了让 agent-runner 调用处意图更明显（C34）便于追踪」，并点名「phase-1-abort-reflow：导出以供单测固化『中断回流场景仍走同一提取路径』（`output.stopped=true` 也带 subagentSessionId，本函数**不看 stopped**，只看 subagentSessionId 是否为 string，天然覆盖）」。

实测确认：`build-tool-result-block.ts:349-365` 的 `resolveSubagentSessionIdFromOutcome` 是**私有**函数，runner 拿不到；显式传 `subagentSessionId`（agent-runner.ts:857）是唯一能让调用点意图可见的路径。`extract-subagent-session-id.test.ts` 5 条 it() 覆盖 ok/非对象/数组/缺字段/stopped=true 五种形态。**保留合理**（虽然它确实是「防御性重复」）。

### B-12 `handleAbort` 之外，`agent-runner.ts` 里另外 8 个 abort 检查点与 `shouldStop` 注入 —— 全部有对应的用户投诉或事故

`:416-421` 的 fingerprint 注释：「组装顺产的内容指纹不能丢——压缩评估链靠它命中估算记忆、走增量分解；丢掉则 run 侧全程无指纹」。`WorkplaceAssemblyAbortedError`（`assemble-workplace-display.ts:84`）是 2026-09-30 新加的「按文件粒度检查 signal」，因为「组装段曾是 16s 级无观察点原子块」。T-ASSEMBLE-ABORT 测试钉「第二个文件前兑现」。

**辩护结论**：这些都是「点过一次的痛」，不是预防性冗余。

### B-13 `resolveCurrentAgentId` 与 `resolveWorkspaceAgentForNewSession` 的重复 —— **入参形状不同，不是复制粘贴**

`agent-run-shared.ts:57-71` 的注释：「与 `resolveCurrentAgentId` **同语义，只是入参收窄为 session service 实际持有的 `{ state, agentRegistry }` 形状**（不强制要求 sessions 字段）」。消费方确实不同：`resolveCurrentAgentId` 被 desktop `agent.ts:66`、mobile `agent-display-label.ts:11` 用（完整 runtime）；`resolveWorkspaceAgentForNewSession` 只被 `service/chat/impl/session.service.ts:105` 用（会话服务自己没有 sessions 字段）。**收窄是必要的类型解耦**。

### B-14 `runChildAgent` 与主 run 的 toolCtx 装配大量重复（82 行对 82 行，42 行 trim 后完全相同）—— **重复是真的，但差异点也都承载语义**

实测量化：主 run toolCtx（run-agent-turn.ts:847-928）82 行有效行，子 run（:1196-1278）82 行，trim 后**逐字相同的行 42 条**。

关键差异（都不可合并）：
- `vfs`：主 = `sessionVfs(projectId, scope.sessionId)`（:810）；子 = `sessionVfs(parentProjectId, parentSessionId)`（:1180）——子写父工作区
- `workplace` scope 同理（:855 vs :1205）
- `ChatAgentSession` 构造：主 2 参（:841）；子 3 参带 `parentSessionId`（:1185-1189）→ `workplaceScopeSessionId`=父、`kkvScopeSessionId`=自身
- `resolveChildModelId`：父 pin → **父 savedModelId**（:893）；孙 → **子 savedModelId**（:1243）
- `parentSignal`：主 = caller 桥接（:846）；子 = `childController.signal`（:1272）
- `depth`：0 vs `childDepth`
- `includeCompactionOrchestrator`：true vs false（:1287，**子 run 不走压缩编排**，P0-2 拍板）

RULE.md:39 已把「子会话共享父工作区、仅规则快照隔离」定为术语级口径。**42/82 的重复率在有 7 处语义差异的前提下是可接受的**；抽公共函数需要引入 7 个参数来消 40 行重复，收益可疑。**辩护立场：不建议在本轮 CR 里合并**。

### B-15 `doomLoopCrossRoundWindow * 4` 的滑窗裁剪（:794-796）—— 常量耦合的防御性写法

`:792-797` 每 step 把 toolUse 推入 `toolUseWindow`，超过 `crossRoundWindow*4` 就 shift 一个。`assertNoCrossRoundDoomLoop` 只看尾部 `crossRoundWindow` 个（doom-loop.ts:85），所以窗口只需 ≥ crossRoundWindow；`*4` 是留余量。默认值 `CROSS_ROUND_WINDOW = 4`（doom-loop.ts:16）有 7 条测试（`test/agent/doom-loop.test.ts`）与 `agent-runner.test.ts:1427`「propagates doom_loop from cross-round A-B-A-B pattern」。**行为锁定，勿动。**

### B-16 `chat-agent-session.ts:35` 的 `includeHidden: false` —— 性能修复，注释带日期与实锤数据

`:31-34`：「本方法被 agent-runner **每 step** 调一次，而压缩/置位后的会话里 hidden 行常占多数——全量拉回再逐条解压正文是大会话上的秒级卡顿源（与 UI 读口同款修法，2026-09-30 首字延迟排查实锤）」。RULE.md:20 关于 seq 的记载也印证「搜索区间含 hidden，但 prompt 可见序不含」。**语义正确且必要。**

### B-17 `agent-run-lifecycle-helpers.ts` 在 core 而非 desktop —— 分层正确，且注释已被 r3-doc-1 显式修正过

文件头注释：「desktop useAgentRunLifecycle 消费（mobile 已走自己的 manager 状态机）」。r3-doc-1（cr-fix-spec-r3.md:156）点名要删掉旧的「双端共用」表述——**这条已被修正**，说明注释维护链在跑。`PENDING_RUN_ID`（:21）被 `use-agent-run-lifecycle.test.ts:50-67` 6 条断言锁死（含 `assert.notEqual(PENDING_RUN_ID, "")` 防误当 runId 上报）。

## 确无辩可辩的让步清单

以下几条我认为**没有成立的辩护理由**，应进入 backlog：

| # | 位置 | 问题 | 证据 | 建议 | 置信 |
|---|---|---|---|---|---|
| L-1 | `run-agent-turn.ts:655-948` | 65 行缩进比 `try` 体少 2 空格，`:655-947` 与 `:949` 之间视觉断层 | 实测 `:585 try {` → `:586-653` 4 空格 → `:655-948` 2 空格 → `:949` 恢复 4 空格；花括号闭合正确故行为无碍 | 纯格式修复（补 2 空格），零行为风险，建议独立小 PR | confirmed |
| L-2 | `assemble-agent-runner-deps.ts:33-37` + `:50-51` | `savedModelRepo ?? savedModels` / `providerRepo ?? providers` 双别名中，第二套已无生产调用方 | `AgentTurnRuntimePort`（run-agent-turn.ts:129-130）声明的是 `savedModelRepo`/`providerRepo`，两处调用点（:930/:1281）传的正是它；`EventActionDeps` 已随 `0dae8526` 删除 | 删 `savedModels`/`providers` 两个可选别名与其 `??` 兜底（若三端 runtime 的重复字段一并清理则更好，但那是跨 zone 动作） | confirmed |
| L-3 | `create-agent-stream-registry.ts:65-66`、`agent-stream-registry.port.ts` | 注释引用的依据「core-transport Q3」全仓查无出处 | `git grep -i "core-transport"` 在 `docs/` 与 `packages/` 全仓 0 命中 | 要么补上出处文档链接，要么把注释改成直白的「暂无生产消费方；UI 侧 partial 由 `session-stream-unit` 自持，保留以维持端口对称」 | confirmed |
| L-4 | `ephemeral-overlay-agent-session.ts:4` | `{@link runRunAgentAction}` 是悬空链接，符号随 `0dae8526` 删除 | `git grep runRunAgentAction` 在 `packages/` `apps/` 全仓 0 命中，仅存于历史迭代文档 | 改注释指向 `AgentRunOptions.persistMessages`（`agent.port.ts:22`） | confirmed |
| L-5 | `run-agent-turn.ts:618` 与 `:646` | `stage` 被连续赋两次 `"resolve-agent"`（:618 设、:632 改、:646 又设回） | 实测 `stage` 全部赋值点：489/609/618/632/646/720/754/783/955；:618 的值在 :632 被覆盖后 :646 又写回同一个字符串 | :618 那次可删（:632 之前无 await 抛出点会用到它——需确认）；或把 :646 改成更具体的 `"resolve-model"` 以提高 `onRunFailed.stage` 的诊断价值 | suspected |
| L-6 | `agent-runner.ts:341` | `handleAbort` 的 `_branch` 参数在函数体内完全未用（10 个调用点各传一个字符串字面量） | `:341-343` 全文只有 `stopReason = "cancelled";` | 若不打算接日志，二选一：① 真接一条 `console.debug` 带 branch；② 保留但**在注释里写明「标签供 grep 与测试用例名对齐，当前不落日志」**——现状是「有意保留」与「忘了删」之间没有分界，读者只能猜 | suspected |

## 争议与存疑

1. **`streamRegistry.get()` 该不该继续存在**——我确认了「无生产消费方」这个事实，但**无法判定**这是「UI 侧改用 `session-stream-unit` 自持后遗弃」还是「为即将落地的某个消费方预留」。`session-stream-unit.ts:1218 tryInjectPartialInto` 用的是单元内 `materializePartialText()`，与 core registry 的 `get()` 是两套。若 W5/W6 的横向机位能确认「无未来消费方」，则 `get` 可删（8 条测试要一起删）；否则维持现状。**我不主张单方面删除。**

2. **`EphemeralOverlayAgentSession` 的去留**是产品决策不是技术问题。`persistMessages`/`publishRunLifecycle` 是 public port 契约的一部分，且在 runner 内分叉出 8 处行为差异。事件编排器已删导致生产无调用方，但删掉等于收窄 public 契约。**建议：保留 + 修注释（L-4），不做删除**；若产品决定收窄，另立迭代。

3. **run-agent-turn.ts:655-948 的缩进断层是否值得单开 PR**——它零行为风险但会污染 diff（reindent 会让 65 行全变）。主代理可能选择与其他格式修复合并。

4. **B-14 的 toolCtx 重复率（42/82）我给的是「不建议本轮合并」**——但如果 W5 reduce 阶段发现子代理装配还要加第 8、第 9 处差异（例如孙代理的 skills 域解析），届时 7 参公共函数的性价比会翻转。这条需要看后续迭代方向。

5. **`agent-run-lifecycle-helpers.ts` 的 `shouldReloadTranscriptOnRunEvent`（:51）返回恒等 `uiRunning`**——桌面 `use-agent-run-lifecycle.ts` 有真实调用，但它是 `shouldApplyTranscriptReload`（:61）的内联一步。我倾向认为这是「为可读性保留的单步谓词」，**不确定是否有人直接依赖它**（`apps/desktop/shared/logic/agent.ts:16` 有 re-export，说明有对外暴露）。未取证到底。

---

## 附：测试锁定面（本区行为的牙齿在哪）

- `test/service/agent/` 15 文件、`test/agent/` 中 agent-runner 相关 17 文件，合计 `it()` **434 条**（62 个文件，实测计数）。
- 与本区辩护点直接对应的锚：
  - prelude/abort/终态：`run-agent-turn-abort-registry.test.ts` 16 条
  - stream 合批顺序：`agent-runner-stream-bus.test.ts` 6 条
  - stream registry 所有权：`agent-stream-registry.test.ts` 8 条（+1 条跑真 runner 的 T-SR4）
  - abort registry 所有权/父→子级联：`agent-abort-registry.test.ts` 5 条
  - lifecycle 守卫（含 PENDING_RUN_ID）：`agent-run-lifecycle-helpers.test.ts` 13 条 + desktop `use-agent-run-lifecycle.test.ts`
  - 子会话工作区隔离：`subsession-workspace-isolation.test.ts` 11 条
  - usage/多步累加：`agent-runner-usage.test.ts` 7 条
  - token 锚点：`agent-runner-token-cache.test.ts` 9 条
  - 空回复/失败落消息：`agent-runner-failure-message.test.ts` 11 条
  - 回合快照：`agent-runner-macro-turn-snapshot.test.ts` 2 条（RULE.md:19 的口径）
