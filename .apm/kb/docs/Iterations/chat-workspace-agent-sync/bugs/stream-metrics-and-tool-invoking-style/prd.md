---
date: 2026-06-13
dependency: Iterations/chat-workspace-agent-sync/prd.md
---

# stream-metrics-and-tool-invoking-style Bug PRD

## 背景

两事件 UX 重构时误将 **整 条 metrics** 删除；用户仅需去掉 tool 参数计数，仍需要 thinking/正文计时与字数。

## 现象描述

1. 聊天区上方 status bar（生成中 · Ns · 正文/思考字数）消失
2. stream tail「工具调用中」为 plain text，无分隔线与 loading 视觉

## 预期行为

- metrics 条：「生成中 · Ns · 正文 X 字 · 思考 Y 字 · Z 字/秒」（无 tool 相关）
- 「工具调用中」：与思考块分隔、主色、带脉冲/转圈指示

## 实际行为

- 无 metrics 条
- 「工具调用中」样式简陋

## 验收标准

- agent 运行中 metrics 条可见且随 stream 更新
- tool 阶段 metrics 仍显示已累积 thinking 字数，不显示 tool 参数
- 「工具调用中」在 RN 与 WebView 均有清晰视觉层次
