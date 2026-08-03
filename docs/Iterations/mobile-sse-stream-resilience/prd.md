# Mobile SSE 流式韧性修复 PRD

> **上游**：`mobile-llm-streaming`（Core `postSse` + RN XHR）、`agent-resilience-mobile-yaml`（取消/背压）、`chat-tool-turn-phase-ui`（多轮 tool UI）、`mobile-webview-chat-transcript`（WebView 引擎）。  
> **问题记录**：`.apm/kb/docs/issues/mobile-webview-agent-stream-freeze.md`  
> **触发版本**：`v1.0.2` 在 `postSseViaXhr` 引入 `setTimeout(0)` 分片 drain + 90s stall timer 后，Android 多轮 Agent 流式出现**卡顿复发**与**空回复**。

## 背景

- React Native 无 `fetch` 流式 body，LLM SSE 走 Core `postSseViaXhr`（`navigator.product === "ReactNative"`）。
- `v1.0.2` 为缓解 XHR burst 对 UI 的冲击，在传输层加入：
  - `pendingText` + `setTimeout(0)` + 4KB 分片 drain；
  - 90s 无 `onprogress` 的 stall watchdog（每 5s 检查）。
- 实测回归：
  1. **UI 卡死**：停止按钮失效、计时器停住（`setTimeout(0)` drain 链霸占事件循环）。
  2. **空回复**：extended thinking / 代理长静默触发 stall abort；`onerror`/`onabort` 清空 `pendingText` 导致已收数据丢失。
  3. **xhr complete 缺失**：异步 `drainAllPending` 与 abort 竞态。

同期 UI 侧优化（bus 32ms、imperative `pushStreamDelta`、流式纯文本 tail、`tool_results` snapshot）方向正确，**不应回滚**；问题集中在传输层错误整流机制。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 修复 v1.0.2 传输回归 | Android 多轮 tool（如「write a file three times」）连续 5 次无 UI 挂死、无空 assistant |
| 平滑 XHR burst | 单次 `onprogress` 灌入大段文本时，`onChunk` 频率约 ≤30/s，事件循环可处理触摸/计时器 |
| 不丢尾部数据 | 流正常结束或用户 abort 前已收字节，最终 assistant 内容完整（abort partial 仍走 `buildStreamPartialBlocks`） |
| extended thinking 兼容 | 模型长静默（>90s 无 token）不因传输层 stall 被误杀 |
| 范围克制 | **仅改 XHR 传输路径**；`postSseViaFetch`（Desktop/CLI）零行为变更 |
| 架构清晰 | 整流器放 Core；Mobile/Desktop 共用；UI 背压保留在 `apps/mobile` |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Android 写作用户 | 多轮 Agent + 工具调用，边生成边阅读，可随时点停止 |
| 智谱 GLM-4.7 等 | extended thinking、代理间歇无心跳 |
| 开发者 | `llm-sse-transport.test.ts` 覆盖 burst / onload flush；issue 文档更新 |

## 范围

### 包含（本期）

1. **Core `postSseViaXhr` 重写**：删除 `setTimeout(0)` drain + stall timer；改为 32ms `setInterval` 固定节奏整流器；`onload` 同步 flush。
2. **可复用整流模块**（可选小文件 `sse-chunk-emitter.ts`）：便于单测与 `postSseViaXhr` 内聚。
3. **单元测试**：burst 合并、onload 完整性、无 stall 误杀、现有 TRANS-* 回归。
4. **issue 文档更新**：修正「SSE 生产端」描述，标注 v1.0.2 机制已废弃。
5. **Core 异步 stream bus 派发（Phase 2，本期必做）**：`wrapStreamForBus` 对 `STREAM_*` 事件 `queueMicrotask` 派发，打断 `onprogress` 同步栈（主要惠及 Mobile）。

### 不包含

- 独立本地 HTTP server / Worker 进程隔离。
- `postSseViaFetch` 整流（Desktop main 无 UI 竞争）。
- SillyTavern 式 smooth 打字机、OpenCode 式流式 markdown。
- Vercel AI SDK 迁移。
- 回滚 UI 侧 bus 32ms / imperative ref / `appendTailRows` 策略。

## 核心需求

1. XHR 路径：`deliverNewText` 只追加 buffer，不直接 `onChunk`；每 32ms tick 最多一次 `onChunk`。
2. `onload`：`clearInterval` → 最后一次 `deliverNewText` → **同步** flush buffer → resolve；禁止异步 drain 链延迟 resolve。
3. `onerror` / `onabort`：停 interval；用户取消走上层 `AbortSignal` + partial blocks；**不在传输层清空已 emit 数据**；reject 前不丢 buffer 中未 emit 且非用户主动 cancel 的场景需在 onload 路径保证 flush。
4. **删除**传输层 stall timer；超时仅由上层 `AbortSignal` 控制。
5. CLI / Desktop fetch 路径行为不变。

## 验收标准

- **Given** Android + WebView 引擎 + 已配置模型，**When** 发送「write a file three times」连续 5 次，**Then** 每次 `RUN_FINISHED` + `stopReason: completed`；无长时间「生成中」挂死；停止按钮可响应。
- **Given** 流式长回答，**When** 正常结束，**Then** assistant 正文非空且与流式展示一致；日志有 `xhr complete`。
- **Given** extended thinking 模型长静默，**When** 最终仍返回内容，**Then** 不因 90s stall 出现空回复。
- **Given** 用户点停止，**When** abort，**Then** 已流式内容按 partial 规则落库或展示，不整段丢失。
- **Given** `npm test -w @novel-master/core -- test/infra/llm-protocol/llm-sse-transport.test.ts`，**Then** 全绿含新增用例。
- **Given** Desktop 流式对话，**When** 回归，**Then** 与改动前一致。

## 已确认决策（2026-06）

- **不拆本地 server**：性能优化在 Core 传输 + 现有 UI 背压完成。
- **整流器在 Core XHR 路径**：RN 特有问题在传输层解决，不放到 `apps/mobile`。
- **UI 层 32ms bus 保留**：与传输层 32ms 略冗余但无害，有效 ~30fps。
- **stall timer 永久移除**：extended thinking 与代理无心跳由上层 signal/产品策略处理。
- **Phase 2 纳入本期**：stream bus 异步派发与 Phase 1 同 PR 交付。
