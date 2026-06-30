---
date: 2026-06-28
---

# abort-partial-persist 实现规格（SPEC）

> **Bug PRD**：[prd.md](./prd.md)  
> **父级**：[../agent-run-lifecycle-unify/spec.md](../agent-run-lifecycle-unify/spec.md)

## 根因 / 方案摘要

| 问题 | 根因 | 方案 |
|------|------|------|
| abort 撤回 | Core append 前 break；`abortUiRun` 清 activeRunId → FINISHED 丢弃 | request 返回后有 blocks 则 append；abort 仅清 uiRunning + overlay，保留 activeRunId 至 FINISHED |
| tail 文案 | Mobile 展示层未改 | 三处「工具调用中」→「生成中」 |

## 变更点清单

### Core

| 文件 | 变更 |
|------|------|
| `service/agent/impl/agent-runner.ts` | 移除 append **前**的 aborted break；有 blocks 则 append；append **后** aborted 则 cancelled break，不跑 tool |
| `test/agent/agent-runner.test.ts` | 「abort 后 partial 仍落库 assistant」 |

### 双端 lifecycle

| 文件 | 变更 |
|------|------|
| `apps/mobile/.../useAgentRunLifecycle.ts` | `abortUiRun` 不清 `activeRunId`；`onRunStarted` 在 `!uiRunning` 时忽略 |
| `apps/desktop/.../useAgentRunLifecycle.ts` | 同上；`shouldIgnoreStaleRunStarted` 改为仅 `!uiRunning` |

### Mobile UI 文案

| 文件 | 变更 |
|------|------|
| `MessageList.tsx` | `ToolTurnPhaseBar label="生成中"` |
| `ToolTurnPhaseBar.tsx` | 默认 label「生成中」 |
| `web/chat-transcript/main.ts` | `renderToolInvokingBar` HTML「生成中」 |

### 测试

| 文件 | 变更 |
|------|------|
| `apps/mobile/__tests__/use-chat-stream-runtime.test.ts` | abort 后 RUN_FINISHED flush 路径 |
| `apps/desktop/test/use-agent-run-lifecycle.test.ts` | stale RUN_STARTED 守卫调整 |

## 详细改动说明

### abort 时序（改后）

```text
用户终止 → abortUiRun（uiRunning=false, overlay reset, activeRunId 保留）
         → Core signal abort → request 返回 partial blocks → append assistant
         → RUN_FINISHED(cancelled) → acceptRunEvent 通过 → flushRunUi(reload → reset)
         → onRunFinished 清 activeRunId
```

### 与 lifecycle unify 的关系

- **保留**：双信号、refcount、streamTailGenerating 300ms、工具卡 interrupted
- **修订**：abort 语义由「不落库」改为「partial 截断落库」；`abortUiRun` 不再清 `activeRunId`

## 测试策略

| ID | 场景 | 预期 |
|----|------|------|
| T1 | Core abort + text blocks | DB 有 assistant partial |
| T2 | Mobile abort + FINISHED | flushRunUi 调用，reload |
| T3 | abort 后迟到 RUN_STARTED | uiRunning 不复活 |
| T4 | Mobile tail idle | 文案「生成中」 |

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| abort 后仍跑 tool | append 后 aborted break，不进入 runParallel |
| stale RUN_STARTED 复活 UI | `onRunStarted` 检查 `uiRunning` |
| 回滚 | revert 两 commit；恢复 agent-run-lifecycle-unify abort 语义 |

---

分支：`fix/agent-run-lifecycle-unify`  
提交：`495401ac`（core）、`d57c70ba`（双端+文案）
