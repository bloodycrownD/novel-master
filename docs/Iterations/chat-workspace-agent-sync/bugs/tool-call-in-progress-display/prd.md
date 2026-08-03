---
date: 2026-06-13
dependency: Iterations/chat-workspace-agent-sync/prd.md
---

# tool-call-in-progress-display Bug PRD

## 背景

`chat-workspace-agent-sync` 与 `chat-tool-turn-phase-ui` 约定：工具调用期间用户应能感知进度——流式生成参数时 metrics 条显示「工具调用生成中」，assistant 落库后气泡内显示「正在执行工具调用…」，tool_result 落库后才出现「工具调用 (N)」卡片。

真机测试（2026-06-13）反馈看不到「工具调用中」类反馈，截图仅见已完成态工具卡片。

## 现象描述

Agent 发起含 `tool_use` 的回合时，用户未观察到：

1. 气泡内「正在执行工具调用…」阶段条（assistant 已落库、tool_result 未返回期间）
2. 多轮工具场景下阶段条偶发不出现或上一轮流式结束后状态不正确

底部 metrics「工具调用生成中」为同迭代另一路径，本 bug 聚焦 **WebView transcript 内阶段条**。

## 复现步骤

1. Mobile 使用 WebView transcript（默认引擎）
2. 在会话中让 Agent 连续调用多个工具（如 read / write / edit / fs / glob / grep）
3. 观察每个 tool 回合：assistant 气泡落库后至 tool_result 返回前
4. 预期应短暂出现「正在执行工具调用…」，实际常直接看到或很快变为「工具调用 (1)」终态卡片，中间阶段不可见

## 预期行为

| 阶段 | UI |
|------|-----|
| LLM 流式生成 tool 参数 | metrics：「工具调用生成中 · N 字」（feature 分支） |
| assistant 落库，tool 执行中 | 气泡：「正在执行工具调用…」，**无**工具卡片 |
| tool_result 落库 | 阶段条消失，「工具调用 (N)」卡片出现 |

## 实际行为

- 执行期阶段条经常不出现或一闪而过
- 用户感知为「没有工具调用中的显示」，仅看到完成后的「工具调用 (1)」

## 影响范围

- Mobile WebView 聊天 transcript（`ChatTranscriptWebView`）
- 多轮 / 连续工具调用场景更明显
- Legacy RN `MessageList` 路径不受影响（全量渲染）

## 验收标准

- **Given** Agent 运行中，assistant 已落库含 `tool_use`，`tool_result` 尚未落库  
  **When** 用户查看该 assistant 气泡（WebView）  
  **Then** 显示「正在执行工具调用…」；不显示工具卡片

- **Given** 连续两轮 tool 调用  
  **When** 第二轮 assistant 落库且第一轮已 complete  
  **Then** 仅当前轮气泡显示阶段条；第一轮保持终态卡片

## 回归测试要点

- `build-transcript-rows` / `chat-transcript-webview` 单测
- 手工：多工具连续调用，执行期可见阶段条
