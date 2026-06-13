---
date: 2026-06-13
dependency: Iterations/chat-workspace-agent-sync/prd.md
---

# missing-set-mobile-agent-active-import Bug PRD

## 背景

两事件 UX 重构移除 metrics 时，`ChatConversationPanel` 仍调用 `setMobileAgentActive`，但 import 被误删。

## 现象描述

点击发送触发 agent 时控制台报错：

`ReferenceError: Property 'setMobileAgentActive' doesn't exist`

发生在 `ChatComposer` → `onRunningChange` 回调。

## 复现步骤

1. Mobile 进入聊天会话
2. 点击发送消息启动 agent
3. Promise rejection / 发送流程异常

## 预期行为

- `onRunningChange(true)` 同步更新全局 agent 活跃状态（供 WebView menuDisabled 等订阅）

## 实际行为

- 运行时找不到 `setMobileAgentActive`，agent 启动回调抛错

## 影响范围

- Mobile 所有通过 `ChatComposer` 启动 agent 的路径

## 验收标准

- 发送消息启动 agent 无 ReferenceError
- `setMobileAgentActive` 正确切换 true/false

## 回归测试要点

- 现有 `agent-activity.test.ts`
- 手工：发送 → 停止 agent
