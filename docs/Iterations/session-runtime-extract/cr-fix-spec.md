# CR Fix Spec: session-runtime-extract

## 元信息
- repo: D:\Dev\Js\novel-master
- base_sha: 4e6cada1
- head_sha: ae5e6083
- prd_path: docs/Iterations/session-runtime-extract/prd.md
- spec_path: docs/Iterations/session-runtime-extract/spec.md
- review_round: 2
- dag_version: 3
- 状态：fix-spec-ready

## jscpd 重复代码扫描结果（基线 3.08%，320 clones / 4398 行）

工具：jscpd 5.0.14，min-lines 6，扫描 typescript/tsx/javascript/jsx，排除 test/dist/.worktree/.apm/report。
报告：`report/jscpd/jscpd-report.html` + `jscpd-report.json`。

### 涉及本次迭代文件的 clone（15 个）

按「本次引入 vs pre-existing」+「是否值得处理」分类如下。此节为初始记录，最终是否进 must-fix 由 review 波次认定。

#### 待 review 认定（候选 must-fix / open_questions）

**Clone 3-7：`useAgentStreamMetrics` 跨端近乎完整复制（5 个 clone，~113 行重复）**
- 文件：`apps/desktop/renderer/hooks/useAgentStreamMetrics.ts` vs `apps/mobile/src/hooks/useAgentStreamMetrics.ts`
- 维度：C（DRY）
- 问题：类型定义（AgentStreamMetricsSnapshot/View/MetricsAcc）、toView、useAgentStreamMetrics hook 主体（noteTextDelta/noteThinkingDelta/tick 逻辑）几乎一字不差
- 来源：pre-existing（非本次引入），但本次 mobile useSessionStream + desktop useAgentStream 都消费它，使跨端重复更显眼
- 待 review 认定：是否进 must-fix（跨端共享可行性）还是 open_questions

**Clone 1：`useAgentRunLifecycle` 跨端 abort 状态片段（9 行）**
- 文件：`apps/desktop/renderer/hooks/useAgentRunLifecycle.ts:97-105` vs `apps/mobile/src/hooks/useAgentRunLifecycle.ts:81-89`
- 维度：C（DRY）
- 问题：abortRetainPendingRef + acceptRunEvent + onRunStarted 开头片段重复
- 来源：pre-existing 跨端重复
- 待 review 认定

**Clone 10：`SessionDetailScreen` vs `SubagentSessionScreen` loading 占位（12 行）**
- 文件：`apps/mobile/src/screens/stack/SessionDetailScreen.tsx:182-193` vs `apps/mobile/src/screens/stack/SubagentSessionScreen.tsx:224-234`
- 维度：C（DRY）
- 问题：loading 占位 UI 重复
- 来源：本次引入（SubagentSessionScreen 重写参考了 SessionDetailScreen）
- 待 review 认定：收益不高（2 消费方 / 12 行）还是值得抽组件

#### 已认定可接受（不进 must-fix）

**Clone 11-12：`useSessionStream` 内部 bus 订阅回调重复（STEP_COMMITTED 的 tool_results vs assistant 分支，10-11 行）**
- 文件：`apps/mobile/src/screens/tabs/chat-tab/useSessionStream.ts`（文件内）
- 维度：C（DRY）
- 认定：不处理——单文件内部逻辑对称重复，两个分支后续行为不同（immediate reload vs flushAgentStepUi），提取共用 helper 反而模糊语义

**Clone 8-9：`ChatRail.tsx` 内部重复（7 行 + 15 行）**
- 文件：`apps/desktop/renderer/layout/ChatRail.tsx`（文件内）
- 维度：C（DRY）
- 认定：不处理——本次只加停止按钮，没动列表渲染；ChatRail 既有 UI 重复超出本次迭代范围

**Clone 2：`useAgentRunLifecycle`（desktop）内部 onRunFinished vs onRunFailed 对称片段（13 行）**
- 文件：`apps/desktop/renderer/hooks/useAgentRunLifecycle.ts:117-142`（文件内）
- 维度：C（DRY）
- 认定：不处理——abort-retain 语义自然对称

**Clone 13：`build-tool-result-block` vs `agent-runner` 的 subagentSessionId 提取（10 行）**
- 文件：`packages/core/src/domain/tool/logic/build-tool-result-block.ts:214-223` vs `packages/core/src/service/agent/impl/agent-runner.ts:140-149`
- 维度：C（DRY）
- 认定：不处理——spec Step 9 明确这两路互补（一路给 buildToolResultBlock meta 入参、一路 buildToolResultBlock 内部自检），刻意保留双路（D-4 加 export 固化就是防误删）

**Clone 14：`create-agent-runner.ts` vs `agent-runner.ts` 的 deps 接口重复（21 行）**
- 文件：`packages/core/src/service/agent/create-agent-runner.ts:25-45` vs `packages/core/src/service/agent/impl/agent-runner.ts:68-89`
- 维度：C（DRY）
- 认定：pre-existing 接口定义模式，超出本次迭代范围

**Clone 15：`agent-runner.ts` 内部 assistant 落库片段重复（13 行）**
- 文件：`packages/core/src/service/agent/impl/agent-runner.ts:367-399`（文件内）
- 维度：C（DRY）
- 认定：不处理——pre-existing abort-retain-partial 语义的自然重复

### 其他 pre-existing 重复热点（非本次迭代文件，供 review-full 参考）

jscpd 扫出的 320 个 clone 中，多数 pre-existing 热点不在本次迭代文件内，列此节供 review-full 认定是否进 open_questions（超出本次迭代范围则不阻塞 fix-spec-ready）：

- CLI flagString / parseFile 跨 commands 文件重复（apps/cli/src/**/commands.ts，多个 clone）
- CLI runtime 接口 vs desktop runtime 接口字段重复（apps/cli/src/runtime.ts vs apps/desktop/src/main/runtime/types.ts）
- cli-errors.ts error instanceof 链重复（文件内）
- apply-regex-channel 跨 CLI/core 重复

## Must-fix（按 P0 → P1 → P2）

### scope-desktop/C-orch-1 [P0] main 进程 refcount 早退兜底漏递减 → agent 永久 busy
- 维度：C-orch（main 影子 + core registry 双轨协调）、G（refcount 边界）
- 文件：`apps/desktop/src/main/ipc/handlers/agent.ts`（`handleAgentRun` 的 `.finally()` 早退分支）
- 问题：`handleAgentRun` 在调 `runAgentTurn` 前已同步 `incrementDesktopAgentActive()`，然后 fire-and-forget 跑 `runAgentTurn`，靠 `.finally()` 兜底。但 finally 的早退分支（`entry.runId == null`，即 `RUN_STARTED` 未到达）只清 map、**没有 `decrementDesktopAgentActive()`**。若 `runAgentTurn` 在发 `RUN_STARTED` 前 reject（agent 定义加载失败、session 不存在、runner.run 早期抛错等），`RUN_STARTED` 没到 → `entry.runId` 仍 null → `finishTrackedRun` 要么不到、要么 `trackedRunId !== runId` 直接 return → finally 早退分支只清 map → **agentActive refcount 永久 +1**，下次 `handleAgentRun` 开头 `isDesktopAgentActive()` 永远 true 返回 `AGENT_BUSY`，agent 彻底卡死。
- 改法：finally 早退分支补上递减，与同步 `catch` 块对齐：
  ```ts
  .finally(() => {
    const entry = activeRuns.get(sessionId);
    if (entry == null) return;
    if (entry.runId != null) return;        // 正常路径：finishTrackedRun 负责
    // 无 RUN_STARTED 的早退：finishTrackedRun 不会触发，手动清 map + 兜底递减，
    // 避免 runAgentTurn 在 RUN_STARTED 前 reject 时 agentActive 泄漏导致永久 busy。
    activeRuns.delete(sessionId);
    sessionRunIds.delete(sessionId);
    decrementDesktopAgentActive();
  });
  ```
  不会双递减：`finishTrackedRun` 成功的前提是 `entry.runId != null`，那种情况不进早退分支。
- 验收/测试：补单测覆盖 `runAgentTurn` 在 RUN_STARTED 前 reject 的场景——断言 `agentActive` refcount 回到 0、`isDesktopAgentActive()` 返回 false、再次 `handleAgentRun` 不返回 AGENT_BUSY。
- 来源：review-scope-desktop / round 1

### scope-desktop/FR8-1 [P2] readOnly 子会话面板缺 P1-1 stale 守卫（停止按钮不显示）
- 维度：A（FR-8 / AC-5 两端对齐）、C-orch（跨端装配收敛）
- 文件：`apps/desktop/shared/ipc-types.ts`、`apps/desktop/src/main/ipc/handlers/agent.ts`、`apps/desktop/renderer/ipc/client.ts`、`apps/desktop/renderer/ipc/invoke-registry.ts`、`apps/desktop/renderer/features/chat/ConversationPanel.tsx`
- 问题：mobile `SubagentSessionScreen` mount 时查 `runtime.abortRegistry.has(sessionId)` 合成 markRunStarted（spec Step 16 P1-1 守卫）；desktop `ConversationPanel` readOnly 分支没对齐——`shouldIgnoreStaleRunStarted(uiRunning, ...)` 实现是 `!uiRunning`，子面板打开时 uiRunning=false → 后续 RUN_STARTED 事件被无条件忽略（死循环）。renderer 拿不到 main 的 rt.abortRegistry（要经 IPC），desktop 子面板没法直接 has(sessionId) 查询。影响：主会话派子 agent → 用户立刻进子会话浏览页 → 子 agent 正在跑但停止按钮不显示、stream delta 被 uiRunning=false 守卫丢弃。违反 PRD FR-8「子会话页停止按钮：agent 运行中时显示」+ AC-5「两端对齐」。
- 改法：
  1. 扩 IPC：`apps/desktop/shared/ipc-types.ts` 加 `ipcAgentRunIsActive(sessionId): Promise<boolean>`；`apps/desktop/src/main/ipc/handlers/agent.ts` 加对应 IPC handler 调 `rt.abortRegistry.has(sessionId)`；`apps/desktop/renderer/ipc/client.ts` + `invoke-registry.ts` 加对应客户端方法 + IPC 通道常量。
  2. `ConversationPanel` mount effect：若 `readOnly === true`，调 `ipcAgentRunIsActive(sessionId)`，true 则调一次 `beginUiRun()`（设 uiRunning=true，让后续 RUN_STARTED / stream delta 能被接受，停止按钮显示）。
- 验收/测试：单测覆盖「mount 时 ipcAgentRunIsActive 返回 true → uiRunning=true → 停止按钮显示」；manual_user 验证端到端（派子 agent → 立刻进子会话 → 停止按钮可见 + 流式正常）。
- 来源：review-full / round 2（用户确认升级 P2）

### scope-mobile/C-orch-2 [P2] composer finally 兑底违反 refcount 单一归属（runAgentTurn 同步 throw 时泄漏）
- 维度：C-orch（refcount 归属）、C（职责）
- 文件：`apps/mobile/src/hooks/useAgentRunLifecycle.ts`、`apps/mobile/src/components/chat/ChatComposer.tsx`
- 问题：`ChatComposer.executeRun` 的流程是 `beginUiRun()`（increment +1）→ `runAgentTurn`。如果 `runAgentTurn` 同步 throw 且从未发 `RUN_STARTED`，`lifecycle.onRunFinished/onRunFailed` 不会被调用，refcount 泄漏 +1。为防这个，composer finally 里留了 `if (isMobileAgentActive()) decrementAgentActive()` 兑底——但这违反 spec 风险2「refcount 完全单一归属 lifecycle」的字面要求，且 `isMobileAgentActive()` 是全局状态读取，可能与别的 run 交叉。review-full round 1 认为简单删除会引入泄漏回归，彻底单一归属需要把 beginUiRun 包进 lifecycle 成对管理。
- 改法：在 `useAgentRunLifecycle` 加 `endUiRunOnError()` 方法（幂等递减 + syncActiveRunId(null) + 通知 abort 单元 deactivate），composer 把 finally 的 `decrementAgentActive` 兑底改为 catch 路径调 `endUiRunOnError()`：
  ```ts
  // useAgentRunLifecycle.ts 加：
  const endUiRunOnError = useCallback(() => {
    // 仅在 run 启动后、RUN_STARTED 未到达的同步 throw 场景调
    if (activeRunIdRef.current === null && !uiActiveRef.current) return; // 幂等
    syncActiveRunId(null);
    onRunUiDeactivateRef.current?.();
    decrementAgentActive();
  }, [syncActiveRunId]);
  ```
  composer catch 路径（非 AbortError）调 `lifecycle.endUiRunOnError()`；finally 块整个删除。这样 refcount 归属完全在 lifecycle：beginUiRun 加、onRunFinished/onRunFailed/endUiRunOnError 减。
- 验收/测试：补单测覆盖 beginUiRun 后 runAgentTurn 同步 throw（非 abort）→ endUiRunOnError → refcount 回 0；正常完成路径不调 endUiRunOnError（onRunFinished 负责）。
- 来源：review-scope-mobile OQ-2 / round 1 + review-full / round 2（用户确认升级 P2）

### scope-core/C-1 [P2] runChildAgent register/try 间隙导致异常路径 registry 孤儿
- 维度：C-orch（registry 生命周期 / 异常路径）
- 文件：`packages/core/src/service/agent/logic/run-agent-turn.ts`（`runChildAgent`，register 在 ~L581，try 从 ~L675 才开始）
- 问题：`runtime.abortRegistry?.register(childSessionId, childController)` 后隔了 ~94 行才进 `try { ... } finally { unregister }`，中间含两个会抛错的 `await`——`session.append("user", textBlocks(opts.prompt))`（DB 写失败会抛）和 `runtime.state.getCurrentRegexGroupId()`（state 错误会抛）。一旦这两步任一抛错，registry 里的 `childSessionId → childController` 项成了孤儿，永远不会被反注册。违反 spec 风险 #5「registry 生命周期：run 结束（含异常）必须反注册」的「含异常」语义。对比 `runAgentTurn`（register 紧贴 try，无间隙）是对的，child 这边漏了。
- 改法：把 `register` 挪进 `try` 块开头，或把 `try` 起点提到 `register` 之前覆盖到 `session.append` 与 `getCurrentRegexGroupId`。推荐前者——`runtime.abortRegistry?.register(childSessionId, childController); try { ... } finally { ... }`，与主 run 形态对齐。
- 验收/测试：补单测：register 后、`runner.run` 前 throw（mock session.append 抛错）→ finally 仍执行 `unregister`，`registry.has(childSessionId) === false`。
- 来源：review-scope-core / round 1

### scope-core/C-2 [P3] content-block.ts + subagent-tool.ts 注释过时（task 全 JSON 化后与实际行为相反）
- 维度：A（spec 一致性 / 文档）
- 文件：`packages/core/src/domain/chat/model/content-block.ts:53-57`、`packages/core/src/domain/tool/builtin/subagent-tool.ts:43-48`
- 问题：
  1. `ToolResultBlock.meta` 注释写「两个字段都不申给 LLM（剥离在 `format-tool-output` 提取 `text` 时完成，不足这里）」。但 `59d84726` 已把 `format-tool-output` 的 task 特殊提取分支删掉，task 输出现在整体走 `JSON.stringify`——`subagentSessionId` 和 `failureReason` 都会随 content 进 LLM 上下文。注释和实际行为相反。
  2. `TaskToolOutput` 注释（L43-48）写「text 回流给主 agent LLM，subagentSessionId 是 UI-only」——但同文件 L218-220 已改为「回流内容以结构化 JSON 给主 agent」，两段自相矛盾。
- 改法：
  1. content-block.ts 注释改为：「`meta` 字段同时供 UI 卡片读取；task 工具 content 改全 JSON 后（59d84726），`subagentSessionId` 与 `failureReason` 也会随 content 回流给 LLM」
  2. subagent-tool.ts L43-48 注释删掉「UI-only」表述，改为「同时供 UI 卡片读取与主 agent 上下文（task 全 JSON 化后随 content 回流）」
- 验收/测试：注释改动，无测试要求。
- 来源：review-scope-core / round 1 + review-full / round 2（新发现 b 并入）

## Spec deviations

review round 1 认定：

| ID | 状态 | review 认定 |
|---|---|---|
| D-1 | fixed（实现已兑现） | run-agent-turn.ts `parentSignal = internalController.signal`，T-A4 级联验证通过。建议 spec Step 3 补注 parentSignal 来源 |
| D-2 | fixed（实现已兑现） | callerSignal 已 aborted 短路边界正确 |
| D-3 | 描述过时，需更新 | 实际形态是「删 task 提取分支、全 JSON」（59d84726），不是「加剥离名单」。iteration-state / fix-spec 描述需同步改写 |
| D-4 | fixed（实现已兑现） | extract 函数已 export，T-A5 验证 |
| D-5 | fixed（实现已兑现） | T-A4 测级联机制，agent-runner abort 在 append 前 break |
| M-1 | closed（接受） | commitAbortOverlay 放 stream 单元，避免循环 ref 依赖 |
| M-2 | closed（接受） | useSessionBatch 输入改 applySegments 叶子，分层更清晰 |
| M-3 | closed（接受） | abort 单元三个 lifecycle 同步钩子是必要的正交拆分 |
| M-4 | closed（cosmetic） | act warning，对应 FU-1 |
| desktop: ipcAgentAbort 复用 | fixed | abortAgentRun 改调 rt.abortRegistry.abort |
| desktop: activeRuns 简化 | 部分固定 | 结构简化 + finishTrackedRun 单一递减对了；**finally 早退分支漏递减**（C-orch-1）修完才完全就绪 |
| desktop: conversation-batch RAF | 仍开启（设计如此） | desktop 无 wire 通道，RAF 合并合理 |

**open spec_deviations**：desktop activeRuns（待 C-orch-1 闭合）。其余全 fixed/closed。

## Open questions / 待拍板

### OQ-1（跨端共享，非本次迭代范围）useAgentStreamMetrics 跨端近乎完整复制（~113 行）
两端都是纯 React + `@novel-master/core/format` 依赖，无 RN/electron 特有 import，理论上完全可共享。但：(1) pre-existing，非本次引入；(2) core 包目前纯 TS，共享 React hook 需新建 `packages/shared-react` 子包并迁移两端 `ChatStreamMetricsBar` 消费方，工作量显著超出本迭代范围边界（PRD L79 明示「mobile/desktop 各自抽取，不强行跨端共享」）；(3) 本次迭代两端都只是消费方，未改动 hook 本体。建议单开 `shared-react-extract` 迭代处理；本迭代不阻塞。

### OQ-2（mobile）composer finally 兑底（已升级 P2 must-fix）
已升级为 P2 must-fix `scope-mobile/C-orch-2`（用户确认），见 Must-fix 节。

### OQ-3（mobile）Clone 10 loading 占位（12 行 × 2 消费方）
SessionDetailScreen vs SubagentSessionScreen loading 占位重复。仅 2 个消费方、12 行纯占位 UI，抽组件收益有限。可留待第 3 个同类屏出现时再抽。

### OQ-4（core）callerSignal listener 微漏（对应 FU）
runAgentTurn 给 callerSignal 挂 `{ once: true }` 监听，run 正常完成且 callerSignal 没 abort 时监听会一直挂到 callerSignal GC/abort。生产路径 composer 已不传 signal，多为 null；仅 CLI/测试/第三方传长生命 signal 时有微漏。可在 finally 里手动 removeEventListener 兜底，收益小。留作 follow-up。

### OQ-5（desktop）readOnly 子会话停止按钮不经 ConversationPanel.abortUiRun
ChatRail.stopSubagentRun 直接发 ipcAgentAbort，不触发 UI freeze/retain。对只读面板可接受（无需 retain），但 RUN_FAILED 到达时 ConversationPanel 仍会 showToast——readOnly 面板弹 toast 是否合适属既有行为，不在本 scope。

### OQ-6（desktop）readOnly 子会话面板缺 P1-1 stale 守卫
已升级为 P2 must-fix `scope-desktop/FR8-1`（用户确认），见 Must-fix 节。

## 已豁免（用户确认不修）
（暂无）

## 合并后 QA（manual_user）
- Step 17（mobile 子会话停止按钮）— qa: manual_user
- Step 23（desktop ChatRail 停止按钮）— qa: manual_user

## K 节建议（下游执行时闭合）
- **K1** 同步 `docs/Iterations/session-runtime-extract/iteration-state.yaml`：`open_must_fix` 改为 `[C-orch-1, FR8-1, C-orch-2, C-1, C-2]`；`FU-2` / `FU-3` 标记为「已升级为 must-fix，见 cr-fix-spec.md」
- FU-1、FU-4~FU-6（见 iteration-state.yaml 的 follow_ups）：测试 act 包裹 / desktop refcount 边界 / 全量 jest 环境问题等 P3 follow-up（与本 fix-spec 的 must-fix 无关，独立跟踪）

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | yes |
| fix_spec_path | docs/Iterations/session-runtime-extract/cr-fix-spec.md |
| dag_version / review_round | 3 / 2 |
| P0 / P1 / P2 / P3（已写入 fix-spec） | 1 / 0 / 3 / 1 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | open: desktop activeRuns（随 C-orch-1 闭合）；其余 fixed/closed |
| C-orch | ✅（main 影子 + core registry 双轨；跨端三单元装配；refcount 单一归属） |
| C 类合并后 QA | Step 17 / Step 23 停止按钮端到端；FR8-1 子面板 stale 守卫端到端 |
