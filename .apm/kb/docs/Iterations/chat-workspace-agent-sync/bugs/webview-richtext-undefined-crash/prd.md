---
date: 2026-06-13
dependency: Iterations/chat-workspace-agent-sync/prd.md
---

# webview-richtext-undefined-crash Bug PRD

## 背景

两事件 UX 重构后，Mobile WebView transcript 在 agent 流式阶段真机崩溃。

## 现象描述

打开聊天并触发 agent 流式输出时，React Native 报 **Render Error**：`Property 'richText' doesn't exist`，组件栈指向 `ChatTranscriptWebView`。

## 复现步骤

1. Mobile 使用 WebView transcript（默认）
2. 进入会话并发送消息触发 agent 流式（thinking / toolInvoking 路径均可）
3. WebView ready 后 `richText` 相关 effect 执行 → 应用崩溃

## 预期行为

- WebView 正常渲染 stream tail 与「工具调用中」状态
- 切换 `flags.richText` 时触发 preserve snapshot，不崩溃

## 实际行为

- 运行时访问未定义标识符 `richText`，整页 Render Error

## 影响范围

- Mobile `ChatTranscriptWebView`
- 所有 WebView transcript 会话

## 验收标准

- **Given** WebView ready  
  **When** `toolInvoking` 或 `flags.richText` 变化  
  **Then** 不崩溃；分别 post `streamToolInvoking` / `sessionSnapshot`

## 回归测试要点

- `chat-transcript-webview.test.tsx`：`toolInvoking`、`richText` 切换用例
