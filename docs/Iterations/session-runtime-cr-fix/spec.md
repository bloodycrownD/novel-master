---
date: 2026-08-09
dependency:
  - Iterations/session-runtime-extract/spec.md
  - Iterations/session-runtime-extract/cr-fix-spec.md
---

# Session Runtime CR Fix 技术规格（SPEC）

> 需求文档：`docs/Iterations/session-runtime-cr-fix/prd.md`
> CR Fix Spec：`docs/Iterations/session-runtime-extract/cr-fix-spec.md`
> 依赖前置：`session-runtime-extract`（已 dev-ready，base ae5e6083 = feat/merge-subagent 分支「子 agent 常驻工作区归属移到 session 侧」commit）

## 设计目标

闭合 `session-runtime-extract` CR 产出的 5 条 must-fix（1 P0 + 3 P2 + 1 P3）+ 1 条 K 节文档同步。改动最小化、精准定位，每条含单测验收。

## 变更点清单

### [改] Desktop main — refcount 早退兜底补递减（C-orch-1，P0）

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/main/ipc/handlers/agent.ts` | `handleAgentRun` 的 `.finally()` 早退分支（`entry.runId == null`）补 `decrementDesktopAgentActive()`，与 catch 块对齐。不会双递减：finishTrackedRun 成功的前提是 entry.runId != null，那种情况不进早退分支。 |
| `apps/desktop/test/agent-handler.test.ts`（或对应测试文件） | 补单测：mock runAgentTurn 在 RUN_STARTED 前 reject → 断言 refcount 回 0、isDesktopAgentActive()=false、再次 handleAgentRun 不返回 AGENT_BUSY |

### [改] Desktop renderer — readOnly 子面板 stale 守卫（FR8-1，P2）

IPC 接线是**五件套**（照现有 `AGENT_ABORT` 等通道的接线模式），不要漏：

| 文件 | 改动 |
|---|---|
| `apps/desktop/shared/ipc-types.ts` | 加通道常量 `AGENT_RUN_IS_ACTIVE`（沿用现有 `AGENT_*` 大写蛇形命名）+ `ipcAgentRunIsActive(sessionId): Promise<boolean>` 类型定义 |
| `apps/desktop/src/main/ipc/handlers/agent.ts` | 加 `handleAgentRunIsActive` handler 调 `rt.abortRegistry.has(sessionId)` |
| `apps/desktop/src/main/ipc/handler-registry.ts` | **在 `registerHandlersFromRegistry()` 里加 `bindReq(IPC_CHANNELS.AGENT_RUN_IS_ACTIVE, handleAgentRunIsActive)`**——漏这步通道不会绑到 ipcMain.handle，renderer 调用会抛「No handler registered」 |
| `apps/desktop/renderer/ipc/client.ts` + `invoke-registry.ts` | 加客户端方法 `ipcAgentRunIsActive` + invoke 常量 |
| `apps/desktop/renderer/features/chat/ConversationPanel.tsx` | readOnly 分支**不沿用主会话的 `beginUiRun` + `shouldAcceptRunEvent` 守卫组合**（该组合在 readOnly 场景下断裂：mount 时 RUN_STARTED 多半已是历史、`activeRunId` 始终 null，迟到的 RUN_FINISHED 会被守卫拒绝、uiRunning 卡死、停止按钮永不消失）。改为对齐 mobile `SubagentSessionScreen` 的**放宽守卫语义**：① `acceptRunEvent` 放宽为 `runId != null && runId !== ''`（子会话只有一个 in-flight run，任何非空 runId 都接受）；② mount effect 在 `ipcAgentRunIsActive(sessionId)=true` 时只翻 `uiRunning=true`（`abort.markRunStarted()` 等价语义，**不调 `beginUiRun`、不动 `activeRunId`**）；③ `onRunStarted`/`onRunFinished`/`onRunFailed` 只翻 `uiRunning` + 触发 reload，**不依赖 `activeRunId` 匹配**。具体落地方式（readOnly 分支传不同回调集，或 `useAgentRunLifecycle` 加 readOnly 模式参数）由实施者判断，spec 只定契约：放宽接受、不依赖 activeRunId |
| 测试 | 单测：mount 时 ipcAgentRunIsActive=true → uiRunning=true；manual_user 验证端到端 |

### [改] Mobile — composer finally 改为 lifecycle 单一归属（C-orch-2，P2）

| 文件 | 改动 |
|---|---|
| `apps/mobile/src/hooks/useAgentRunLifecycle.ts` | 加 `endUiRunOnError()` 方法：幂等（uiActiveRef 未激活时 no-op）→ syncActiveRunId(null) + onRunUiDeactivate + decrementAgentActive。需加 `uiActiveRef` 跟踪 beginUiRun/onRunStarted 激活态。**同时给 `onRunFinished`/`onRunFailed` 补 `shouldAcceptRunEvent(activeRunIdRef.current, payload.runId)` 守卫**（现状 mobile 无守卫、desktop 有，两端不对称）——否则删 finally 兜底后，endUiRunOnError 已递减清空 activeRunId，迟到的 RUN_FINISHED 再无条件递减一次 → refcount 负数。 |
| `apps/mobile/src/components/chat/ChatComposer.tsx` | catch 路径（非 AbortError）调 `lifecycle.endUiRunOnError()`；删除 finally 块的 `if (isMobileAgentActive()) decrementAgentActive()` 兜底 |
| `apps/mobile/__tests__/use-agent-run-lifecycle.test.ts`（或对应测试） | 补单测：beginUiRun 后 runAgentTurn 同步 throw → endUiRunOnError → refcount 回 0；正常完成路径不调 endUiRunOnError。**补一条「endUiRunOnError 后再投递 RUN_FINISHED → 不再二次递减」**（验证 shouldAcceptRunEvent 守卫生效） |

### [改] Core — runChildAgent registry 孤儿修复（C-1，P2）

| 文件 | 改动 |
|---|---|
| `packages/core/src/service/agent/logic/run-agent-turn.ts` | `runChildAgent` 的 `abortRegistry.register(childSessionId, childController)` 挪进 `try` 块开头（或 try 起点提到 register 之前），覆盖中间 `session.append` / `getCurrentRegexGroupId` 抛错路径。与 runAgentTurn（register 紧贴 try）形态对齐 |
| `packages/core/test/service/agent/run-agent-turn-abort-registry.test.ts`（或对应测试） | 补单测：mock session.append 抛错 → finally 仍 unregister → `registry.has(childSessionId) === false` |

### [改] 注释修正（C-2，P3）

| 文件 | 改动 |
|---|---|
| `packages/core/src/domain/chat/model/content-block.ts` | `ToolResultBlock.meta` 注释块（含「两个字段都不申给 LLM」关键字句）改为：「meta 字段同时供 UI 卡片读取；task 工具 content 改全 JSON 后（59d84726），subagentSessionId 与 failureReason 也会随 content 回流给 LLM」 |
| `packages/core/src/domain/tool/builtin/subagent-tool.ts` | `TaskToolOutput` 注释块（含「subagentSessionId 是 UI-only」关键字句）删掉「UI-only」表述，改为：「同时供 UI 卡片读取与主 agent 上下文（task 全 JSON 化后随 content 回流）」 |

### [改] 文档同步（K1）

| 文件 | 改动 |
|---|---|
- **K1** 同步 `docs/Iterations/session-runtime-extract/iteration-state.yaml`：`open_must_fix` 改为 `[C-orch-1, FR8-1, C-orch-2, C-1, C-2]`；`FU-2` / `FU-3` 标记为「已升级为 must-fix，见 cr-fix-spec.md」；**base_sha 注明：ae5e6083 是 dev-ready milestone commit（feat/merge-subagent 分支「子 agent 常驻工作区归属移到 session 侧」），与 iteration-state.yaml 的 base_sha: 4e6cada1（迭代起点）不冲突，后者是 session-runtime-extract 的起点、前者是该迭代的终点**

## 兼容性说明

- 无 schema 变更、无新依赖、无 API 签名变更（`endUiRunOnError` 是新加方法，不破坏现有调用方；`ipcAgentRunIsActive` 是新加 IPC 通道）。
- 行为变化：
  - C-orch-1：runAgentTurn 在 RUN_STARTED 前 reject 时，agentActive 不再泄漏（修复 P0）。
  - FR8-1：desktop readOnly 子面板打开时若子 agent 已在跑，停止按钮现在会显示（修复 FR-8/AC-5）。
  - C-orch-2：mobile composer catch 路径的 refcount 递减从 finally 兜底改为 lifecycle.endUiRunOnError 显式调用（refcount 单一归属 lifecycle）。
  - C-1：runChildAgent 异常路径不再产生 registry 孤儿。

## 详细实现步骤

### Phase 1 — Core（C-1 + C-2）

- Step 1 — C-1 — blocking: yes — qa: auto：`runChildAgent` 的 register 挪进 try 块开头，覆盖中间 await 抛错路径。
- Step 2 — C-1-test — blocking: yes — qa: auto：补单测：register 后 runner.run 前 throw → finally 仍 unregister。
- Step 3 — C-2 — blocking: no — qa: auto：content-block.ts + subagent-tool.ts 注释修正。
- Step 4 — core-verify — blocking: yes — qa: auto：core build + test 全绿（基线 13 fail 不新增）。

### Phase 2 — Desktop（C-orch-1 + FR8-1）

- Step 5 — C-orch-1 — blocking: yes — qa: auto：handleAgentRun finally 早退分支补 decrementDesktopAgentActive()。
- Step 6 — C-orch-1-test — blocking: yes — qa: auto：补单测：runAgentTurn RUN_STARTED 前 reject → refcount 回 0。
- Step 7 — FR8-1-ipc — blocking: yes — qa: auto：扩 IPC ipcAgentRunIsActive **五件套**：`ipc-types.ts`（通道常量 `AGENT_RUN_IS_ACTIVE` + 类型）→ `main/handlers/agent.ts`（handleAgentRunIsActive）→ **`main/ipc/handler-registry.ts`（bindReq 绑定，不可漏）** → `renderer/ipc/client.ts` + `invoke-registry.ts`。
- Step 8 — FR8-1-panel — blocking: yes — qa: auto：ConversationPanel readOnly 分支改用**放宽守卫语义**（对齐 mobile `SubagentSessionScreen`）：① `acceptRunEvent` 放宽为 `runId != null && runId !== ''`；② mount effect 在 `ipcAgentRunIsActive=true` 时只翻 `uiRunning=true`（**不调 `beginUiRun`、不动 `activeRunId`**）；③ `onRunStarted`/`onRunFinished`/`onRunFailed` 只翻 `uiRunning`、不依赖 `activeRunId` 匹配。理由：主会话的 `beginUiRun` + `shouldAcceptRunEvent` 守卫组合在 readOnly 场景断裂——mount 时 RUN_STARTED 多半已是历史，`beginUiRun` 第一步 `syncActiveRunId(null)` 让 `activeRunId` 始终 null，迟到 RUN_FINISHED 必被守卫拒绝。
- Step 9 — FR8-1-test — blocking: yes — qa: manual_user：单测 + 端到端验证（派子 agent → 立刻进子会话 → 停止按钮可见 + 流式正常）。
- Step 10 — desktop-verify — blocking: yes — qa: auto：desktop build + test 无新增失败。

### Phase 3 — Mobile（C-orch-2）

- Step 11 — C-orch-2-lifecycle — blocking: yes — qa: auto：useAgentRunLifecycle 加 endUiRunOnError + uiActiveRef。
- Step 12 — C-orch-2-composer — blocking: yes — qa: auto：ChatComposer catch 路径调 endUiRunOnError，删 finally 兜底。
- Step 13 — C-orch-2-test — blocking: yes — qa: auto：补单测：beginUiRun 后同步 throw → endUiRunOnError → refcount 回 0。
- Step 14 — mobile-verify — blocking: yes — qa: auto：mobile tsc + 相关 jest 全绿。

### Phase 4 — 文档（K1）

- Step 15 — K1 — blocking: no — qa: auto：iteration-state.yaml 字段同步。

## 测试策略

### 测试用例

- T-CF1 — blocking: yes — C-1：register 后 runner.run 前 throw（mock session.append 抛错）→ finally 仍 unregister → registry.has(childSessionId) === false
- T-CF2 — blocking: yes — C-orch-1：runAgentTurn 在 RUN_STARTED 前 reject → agentActive refcount 回 0 → isDesktopAgentActive()=false → 再次 handleAgentRun 不返回 AGENT_BUSY
- T-CF3 — blocking: yes — FR8-1：覆盖 readOnly 子会话晚于 run 启动打开的真实时序——mount 时 run 在跑（RUN_STARTED 已是历史、`activeRunId` 全程为 null）→ `ipcAgentRunIsActive=true` → mount effect 翻 `uiRunning=true`（**不调 `beginUiRun`、不设 `activeRunId`**）→ 停止按钮显示 → run 结束 → 迟到 RUN_FINISHED 到达 → `acceptRunEvent(runId)` 放宽接受（`runId != null && runId !== ''`）→ `onRunFinished` 翻 `uiRunning=false`、停止按钮消失。**关键断言：全过程 `activeRunId` 保持 null，停止按钮能显示也能消失，不卡死**——这是相对主会话守卫的核心差异点。
- T-CF4 — blocking: yes — C-orch-2：beginUiRun 后 runAgentTurn 同步 throw（非 abort）→ endUiRunOnError → refcount 回 0；正常完成路径不调 endUiRunOnError（onRunFinished 负责）。**额外覆盖：endUiRunOnError 后再投递 RUN_FINISHED → 不再二次递减（验证 shouldAcceptRunEvent 守卫）**
- T-CF5 — blocking: no — C-2：注释改动（无测试要求）

### 测试矩阵

| Step | 覆盖测试 |
|---|---|
| Step 2 | T-CF1 |
| Step 6 | T-CF2 |
| Step 9 | T-CF3 |
| Step 13 | T-CF4 |

## 风险与回滚方案

### 风险

1. **C-orch-2 uiActiveRef 状态同步 + onRunFinished/onRunFailed 双递减**：beginUiRun 和 onRunStarted 都会激活，endUiRunOnError 和 onRunFinished/onRunFailed 都会 deactivate。需确保 uiActiveRef 在所有路径正确翻转，避免幂等失效或误递减。endUiRunOnError 的幂等判定（uiActiveRef 未激活时 no-op）是关键。**同时 mobile onRunFinished/onRunFailed 需补 shouldAcceptRunEvent 守卫**（现状无守卫，删 finally 兜底后迟到 RUN_FINISHED 会双递减——改法表已写明）。
2. **FR8-1 readOnly 分支不能用主会话的 `beginUiRun` + `shouldAcceptRunEvent` 守卫**：readOnly 子会话的典型打开时序是「页面晚于 run 启动」，mount 时 RUN_STARTED 已是历史事件。若沿用主会话守卫：`beginUiRun` 第一步 `syncActiveRunId(null)`，加上 stale 守卫 `shouldIgnoreStaleRunStarted = !uiRunning`（mount 时 `uiRunning=false`）会让迟到的 RUN_STARTED 全部被忽略，`activeRunId` 永远 null；后续 RUN_FINISHED 到达时 `shouldAcceptRunEvent(null, runId)` 返回 false → `onRunFinished` 不执行 → `uiRunning` 永久 true、停止按钮卡死。**防护：readOnly 分支走 mobile `SubagentSessionScreen` 那套放宽守卫——`acceptRunEvent` 放宽为非空 runId 即接受、mount 守卫只翻 `uiRunning` 不碰 `activeRunId`、run 回调不依赖 `activeRunId` 匹配**。T-CF3 已重写为覆盖这条真实时序（全程 `activeRunId=null`，停止按钮能显能消）。
3. **C-1 try 范围调整**：把 register 挪进 try 后，register 本身（Map.set）不会抛错，但需确保 register 在 try 内的顺序正确（register 先于 session.append 等 await）。
4. **FR8-1 IPC 往返 check-then-act 竞态（P2 实施期留意）**：desktop 走 IPC 查 `abortRegistry.has(sessionId)` 是异步往返，极端时序下 run 可能在往返期间结束——bus 监听已注册（useAgentStream mount effect 先于 ConversationPanel mount effect），迟到 RUN_FINISHED 被放宽接受翻 uiRunning=false → IPC 结果（stale true）resolve → mount effect 再翻 uiRunning=true → 卡死。**防护建议**：mount effect 翻 uiRunning=true 前再读一次 `getUiRunning()`，若已是 false（迟到 RUN_FINISHED 已处理）则不翻；或翻完后再异步复询校正。mobile 因同进程同步读无此竞态。
5. **FR8-1 实现方式建议**：desktop `useAgentRunLifecycle` 目前没有「只翻 uiRunning、不碰 activeRunId」的方法——`beginUiRun` 会清 activeRunId、`onRunStarted` 受 stale 守卫约束。建议实施者优先新增专用方法（如 `markExternalRunActive()`）而不是复用现有方法，避免悄悄踩到 stale 守卫。
6. **上游 cr-fix-spec.md FR8-1 改法 step 2 已被本 SPEC 重写覆盖**：上游 cr-fix-spec.md 的 FR8-1 仍写旧 `beginUiRun()` 方案（已被 round 3 否决），以本 SPEC FR8-1 放宽守卫方案为准。上游已 fix-spec-closed 不回改。

### 回滚

每条 must-fix 独立提交，可逐条 revert。C-orch-1（P0）回滚后 agent busy 缺陷恢复（但只在 RUN_STARTED 前 reject 的罕见场景）。其余回滚无功能退化风险。
