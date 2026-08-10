---
date: 2026-08-09
dependency:
  - Iterations/session-runtime-extract/prd.md
  - Iterations/session-runtime-extract/spec.md
  - Iterations/session-runtime-extract/cr-fix-spec.md
---

# Session Runtime CR Fix（CR 问题修复）PRD

## 背景

`session-runtime-extract` 迭代（三 phase：Core abort registry + 中断回流 + Mobile/Desktop 四能力拆分）已 dev-ready 并通过 CR loop（2 轮 review，fix-spec-ready）。CR 产出 5 条 must-fix（1 P0 + 3 P2 + 1 P3），记录在 `docs/Iterations/session-runtime-extract/cr-fix-spec.md`。

本迭代专门闭合这 5 条 CR must-fix，不引入新功能。涉及的代码域：Core agent 层、Desktop main 进程 + renderer、Mobile composer + lifecycle。

## 目标（含成功指标）

1. **闭合全部 5 条 must-fix**：C-orch-1 / FR8-1 / C-orch-2 / C-1 / C-2 全部修复，每条有对应单测或验收。
2. **不引入回归**：core test 1801/1788 pass/13 fail（全基线）保持；mobile tsc + 相关 jest 全绿；desktop build + test 无新增失败。
3. **文档同步**：fix-spec 的 K1（iteration-state.yaml 字段同步）闭合。

## 范围

### 包含范围

仅闭合 cr-fix-spec.md 的 5 条 must-fix + K1 文档同步。不引入新功能、不重构无关代码。

### 不包含范围

- 跨端 useAgentStreamMetrics 共享（OQ-1，另开迭代）
- callerSignal listener 微漏（OQ-4，P3 follow-up）
- loading 占位抽组件（OQ-3，P3 follow-up）
- FU-1 / FU-4~FU-6（独立 P3 follow-up）

## 核心需求

### FR-1：desktop main 进程 refcount 早退兜底补递减（C-orch-1，P0）

`handleAgentRun` 的 `.finally()` 早退分支（`entry.runId == null`，即 RUN_STARTED 未到达）补上 `decrementDesktopAgentActive()`，与同步 `catch` 块对齐。修复 `runAgentTurn` 在 RUN_STARTED 前 reject 时 agentActive refcount 永久 +1 导致 agent 永久 busy 的 P0 缺陷。

### FR-2：desktop readOnly 子会话面板 stale 守卫（FR8-1，P2）

扩 IPC `ipcAgentRunIsActive(sessionId): Promise<boolean>`（调 `rt.abortRegistry.has(sessionId)`）；`ConversationPanel` readOnly 分支 mount 时查询，true 则翻 uiRunning=true。**注意：readOnly 分支不走主会话的 `beginUiRun` + `shouldAcceptRunEvent` 守卫**——那套在「页面晚于 run 启动」场景下会断裂（RUN_STARTED 已是历史、activeRunId 始终 null，迟到 RUN_FINISHED 被守卫拒绝、uiRunning 卡死）。改为对齐 mobile `SubagentSessionScreen` 的放宽守卫：`acceptRunEvent` 放宽为非空 runId 即接受、mount 守卫只翻 uiRunning 不碰 activeRunId、run 回调不依赖 activeRunId 匹配。这样既对齐 mobile 的 P1-1 stale 守卫，又满足 PRD FR-8「子会话页停止按钮：agent 运行中时显示」+ AC-5「两端对齐」。

### FR-3：mobile composer finally 兜底改为 lifecycle 单一归属（C-orch-2，P2）

`useAgentRunLifecycle` 加 `endUiRunOnError()` 方法（幂等递减 + syncActiveRunId(null) + 通知 abort 单元 deactivate）；`ChatComposer.executeRun` catch 路径（非 AbortError）调 `endUiRunOnError()` 替代 finally 兜底；finally 块删除。refcount 归属完全在 lifecycle。

### FR-4：Core runChildAgent registry 孤儿修复（C-1，P2）

`runChildAgent` 的 `abortRegistry.register` 挪进 `try` 块开头（或 try 起点提到 register 之前），覆盖中间 `session.append` / `getCurrentRegexGroupId` 的抛错路径。闭合 spec 风险 #5「registry 生命周期：run 结束（含异常）必须反注册」。

### FR-5：注释修正（C-2，P3）

`content-block.ts` 的 `ToolResultBlock.meta` 注释 + `subagent-tool.ts` 的 `TaskToolOutput` 注释，改为与 task 全 JSON 化（59d84726）后的实际行为一致。

### FR-6：文档同步（K1）

`iteration-state.yaml` 的 `open_must_fix` / `FU-2` / `FU-3` 字段同步到与 cr-fix-spec 一致。

## 验收标准

- AC-1：C-orch-1 单测覆盖「runAgentTurn 在 RUN_STARTED 前 reject → agentActive refcount 回 0 → 再次 handleAgentRun 不返回 AGENT_BUSY」
- AC-2：FR8-1 单测覆盖「mount 时 run 在跑（RUN_STARTED 已是历史、activeRunId 全程 null）→ ipcAgentRunIsActive=true → uiRunning=true → 停止按钮显示；run 结束 RUN_FINISHED 到达 → 放宽守卫接受 → uiRunning=false → 停止按钮消失」（即 readOnly 分支不能用主会话的 beginUiRun + shouldAcceptRunEvent 守卫）；manual_user 验证端到端
- AC-3：C-orch-2 单测覆盖「beginUiRun 后 runAgentTurn 同步 throw → endUiRunOnError → refcount 回 0」；正常完成路径不调 endUiRunOnError
- AC-4：C-1 单测覆盖「register 后 runner.run 前 throw → finally 仍 unregister → registry.has(childSessionId) === false」
- AC-5：C-2 注释改动，无测试要求
- AC-6：K1 iteration-state.yaml 字段同步
- AC-7：core test 1801/1788 pass/13 fail（全基线）；mobile tsc + 相关 jest 全绿；desktop build + test 无新增失败

## 约束与依赖

- 依赖 session-runtime-extract 已 dev-ready（base: feat/merge-subagent 分支 HEAD ae5e6083 =「子 agent 常驻工作区归属移到 session 侧」commit）
- 分支：feat/merge-subagent（继续在此分支）
- 不引入新依赖
- 每条 must-fix 按逻辑块提交
