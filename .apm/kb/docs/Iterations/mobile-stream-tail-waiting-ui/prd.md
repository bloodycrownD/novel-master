---
date: 2026-06-29
dependency:
  - Iterations/chat-workspace-agent-sync/bugs/agent-run-lifecycle-unify/prd.md
  - Iterations/mobile-app/prd.md
---

# Mobile Stream Tail 等待样式分相 PRD

## 背景

Mobile 聊天在 Agent 运行期间，当距上次 **text/thinking** 流式 delta 超过约 **300ms** 时，会在 transcript **stream tail** 内显示「**生成中**」指示（`streamTailGenerating`，经 `toolInvoking` prop 下发）。该机制来自 `agent-run-lifecycle-unify`，用于缓解轮间/SSE 空窗「像卡死」的体验。

当前问题（用户反馈 + 代码走读）：

1. **首包前等待**（尚无 Assistant 正文/思考）与 **已有内容后的 idle 等待** 共用同一套 UI：完整 assistant 气泡壳 + 底部横条，在内容为空时像「一条空消息」，观感较差。
2. **WebView 默认路径** 在尚无 `#stream-tail`（无 text/thinking delta）时，`streamToolInvoking` 可能只更新内存 state、不建 DOM，导致 transcript 内等待反馈与 legacy / 设计预期不一致。
3. 顶部 **metrics 条**（「生成中 · Ns · 正文 X 字」）已提供 run 级反馈；transcript 内应对 **两种等待语义** 做区分，而非一律「空消息 + 横条」。

**范围限定**：本期仅 **Mobile**（WebView 主路径 + legacy RN 回退）；**不包含 Desktop**。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 区分两种等待样式 | 无 text/thinking 时的 idle 等待 **不再** 呈现「完整 assistant 空气泡 + 横条」；已有 text/thinking 后的 idle 仍显示附在内容下方的「生成中」横条 |
| WebView 首包前可见 | 默认 WebView 引擎下，run 开始且满足 idle 条件后，transcript 内 **300ms 内** 可见等待指示（不依赖首个 text/thinking delta 才建 tail） |
| 行为与 lifecycle 一致 | 300ms idle 规则、`noteStreamDelta` 语义、metrics 条、工具卡 pending（`agentActive`）**不变** |
| legacy 对齐 | `legacy-rn` 引擎下两种等待样式与 WebView **语义一致**（实现可复用 RN 组件，视觉可对齐） |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 日常写作用户 | 发送消息后等待 Assistant **首字/首段思考** 出现 |
| 日常写作用户 | 流式输出过程中出现 **短暂停顿**（模型思考、工具准备、网络间隙） |
| 调试用户 | 区分「还没开始输出」与「正在输出但暂停」，减少误判为卡死 |

## 范围

### 包含范围

1. **Mobile WebView transcript**（`ChatTranscriptWebView` + `web/chat-transcript/main.ts`）：按是否有流式 **text/thinking 内容** 分相渲染等待 UI；修复纯 idle 无 DOM 缺口。
2. **Mobile legacy RN**（`MessageList` + `ToolTurnPhaseBar`）：同等分相语义，避免空 stream 行使用大气泡壳。
3. **样式**：首包前等待为 **轻量指示**（如独立 slim 行/紧凑条，无完整 message 气泡宽度与空 body）；内容后 idle 保留现有脉冲点 +「生成中」横条（可微调间距，不改变文案）。
4. **自动化测试**：覆盖分相判定与 WebView 纯 idle 建 DOM；回归现有 300ms idle 单测。

### 不包含范围

- **Desktop** 端 stream tail 样式（后续按需单开迭代）。
- 修改 `computeStreamTailGenerating` 的 **300ms 阈值** 或 TOOL_USE 是否刷新 idle 时钟。
- 顶部 **ChatStreamMetricsBar** 文案与布局（仍即时显示 run 级「生成中」）。
- `mobile-stream-display-pacing` / stream-display-rewrite 的 pacer、reconciler 大改。
- prop 全局重命名 `toolInvoking` → `streamTailGenerating`（可选 follow-up，非本期阻塞）。

## 核心需求

1. **分相定义（产品语义）**
   - **首包前等待**：`uiRunning` 且 idle 条件满足，且当前 stream tail **无**可见 text/thinking 内容。
   - **内容后 idle 等待**：同上 idle 条件，且 stream tail **已有** text 和/或 thinking 内容。
2. **首包前等待 UI**：轻量、紧凑，**不**使用与正常 assistant 消息等价的完整气泡 + 空正文区。
3. **内容后 idle UI**：在现有 thinking/正文下方显示「生成中」横条（脉冲点 + 文案），与当前 `agent-run-lifecycle-unify` 一致。
4. **WebView 纯 idle 可见**：idle 为 true 时，即使尚无 delta，也应在 transcript 内渲染对应相位的等待 UI。
5. **run 结束 / abort / session 切换**：等待 UI 与 stream tail 清除逻辑与现网一致，无残留。
6. **双引擎一致**：webview 与 legacy-rn 对用户可见语义一致；引擎切换不改变分相规则。

## 验收标准

### 首包前等待（无 text/thinking）

1. **Given** Mobile 默认 WebView、会话已发送消息且 Agent run 进行中，**When** 满 300ms 仍无 text/thinking delta，**Then** transcript 内出现 **轻量** 等待指示，**且** 不出现「完整 assistant 空气泡 + 空正文区 + 横条」组合。
2. **Given** 同上，**When** 首个 text 或 thinking delta 到达，**Then** 轻量等待指示消失或切换为正常 stream tail 内容区；若随后再次 idle ≥300ms 且无新 delta，**Then** 显示 **内容后 idle** 横条（非首包前样式）。

### 内容后 idle（已有 text/thinking）

3. **Given** stream tail 已显示 thinking 或正文，**When** delta 停止 ≥300ms 且 run 仍进行中，**Then** 在内容下方显示「生成中」横条（脉冲点 + 文案），气泡内仍可见已有内容。
4. **Given** 仅 TOOL_USE、无 text/thinking delta，**When** idle ≥300ms，**Then** 按 **首包前等待** 样式展示（非完整空消息气泡）。

### WebView 与 legacy

5. **Given** WebView 引擎，**When** 满足首包前 idle，**Then** 无需等待首个 delta 即可在 transcript DOM 中看到等待指示（修复 state-only 缺口）。
6. **Given** legacy-rn 引擎，**When** 场景 1–4 复现，**Then** 分相语义与 WebView 一致（允许 RN 与 Web 视觉细节差异，但不得出现「空大气泡仅横条」）。

### 回归

7. **Given** run 结束或 abort，**When** `uiRunning=false`，**Then** 所有等待指示与 stream tail 清除。
8. **Given** metrics 条，**When** run 开始，**Then** 仍即时显示「生成中 · …」（与改前一致）。
9. **Given** 已落库 assistant 工具卡，**When** `agentActive=true`，**Then** pending「执行中」态不受本次改动影响。

### 手工（Android 建议）

10. 发送后首 300ms–2s：transcript 内为轻量等待，非空消息气泡。
11. 流式输出中人为制造停顿：横条出现在内容下方，内容不消失。
12. 终止 run：等待 UI 立即消失。
