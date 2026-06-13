---
date: 2026-06-13
---

# tool-call-in-progress-display Bug 修复规格（SPEC）

## 根因分析

WebView 为性能对 agent 运行中的新消息默认走 `appendTailRows`，存在两处缺陷：

1. **局部上下文构建 rows**：`sendAppendTailRows` 曾用 `buildTranscriptRows(tailMessages, …)`，仅 tail 切片参与 `isTurnToolExecuting` / `turnToolResultsComplete` 判定。多轮会话中 hidden `tool_result`、配对关系可能不在 tail 内，导致 `toolPhase: 'executing'` 计算错误。

2. **assistant 含 tool_use 落库仍走 appendTail**：`tool_results` 落库已强制 `sessionSnapshot('preserve')` 刷新阶段条，但 assistant 落库路径未对齐。appendTail 无法更新**已有行**的 `toolPhase`，且增量行在 streamReset 时序下易丢失执行期 UI。

## 修复方案

1. 新增 `selectTailTranscriptRows(allMessages, tailMessages, options)`：用**完整会话** `buildTranscriptRows`，再按 tail 消息 id 过滤待 append 行。

2. `ChatTranscriptWebView` messages effect：当新增消息含 `tool_result` **或** assistant 含 `tool_use` 时，改走 `sendSessionSnapshot('preserve')`（与 tool_results 同级）。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `message-blocks.ts` | 新增 `selectTailTranscriptRows` |
| `ChatTranscriptWebView.tsx` | `sendAppendTailRows` 用全量上下文；assistant+tool_use 触发 snapshot |
| `build-transcript-rows.test.ts` | 全量 vs tail-only toolPhase 差异 |
| `chat-transcript-webview.test.tsx` | assistant+tool_use 走 snapshot 断言 |

## 详细改动说明

```ts
// messages effect 判定
const needsFullSnapshot =
  added.some(messageIsToolResultsOnly) ||
  added.some(m => m.role === 'assistant' && messageHasToolUse(m));
```

`resetStreamTail` 已有 `flushPendingSnapshot()`，assistant phase 后 streamReset 会刷新 pending snapshot，无需额外改动。

metrics「工具调用生成中」由 `chat-workspace-agent-sync` 的 `TOOL_USE_DELTA` + `useAgentStreamMetrics` 承担，本 bug 未改该路径。

## 测试策略

### 测试用例

| 用例 | 文件 |
|------|------|
| 全量 messages 下 toolPhase=executing；tail-only 可能错误 | `build-transcript-rows.test.ts` |
| assistant+tool_use 落库 post `sessionSnapshot` 非 `appendTailRows` | `chat-transcript-webview.test.tsx` |
| 既有 message-blocks / metrics 回归 | 46 tests pass |

```bash
npm test -w @novel-master/mobile -- --testPathPattern="message-blocks|use-agent-stream-metrics|build-transcript-rows|chat-transcript-webview"
```

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| assistant 落库改 snapshot 增加 WebView 重绘 | 仅 tool 回合触发，频率低于每 token |
| 纯文本 assistant 仍 appendTail | 未扩大 snapshot 范围 |

**回滚**：还原 `ChatTranscriptWebView` messages effect 与 `sendAppendTailRows` 两处改动。

**提交**：`05da0d4` on `fix/tool-call-in-progress-display`
