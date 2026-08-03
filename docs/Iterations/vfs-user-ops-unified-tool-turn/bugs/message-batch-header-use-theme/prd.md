---
date: 2026-06-15
dependency: Iterations/vfs-user-ops-unified-tool-turn/prd.md
---

# message-batch-header-use-theme Bug PRD

## 背景

消息隐藏/恢复批量模式顶栏使用 `MessageBatchHeader` 组件展示操作说明与确认按钮。

## 现象描述

进入【隐藏消息】或【恢复消息】模式时，界面弹出错误提示：`useTheme must be used within ThemeProvider`。

## 复现步骤

1. 打开 Mobile 聊天会话（WebView 或 legacy RN 路径均可触发顶栏）。
2. 会话菜单 → 【隐藏消息】或【恢复消息】。

## 预期行为

正常显示批量顶栏（取消 / 将影响 N 条 / 确认），无 React Context 报错。

## 实际行为

`MessageBatchHeader` 内部调用 `useTheme()` 失败，错误信息以 Toast/错误条形式展示。

## 影响范围

- Mobile 消息可见性批量模式入口不可用或体验中断。
- Desktop 不受影响（不使用 `MessageBatchHeader`）。

## 验收标准

1. 进入 hide/restore 批量模式不再出现 useTheme 报错。
2. 顶栏样式与 tokens 一致（文字/边框/主色）。
3. 相关单测通过。

## 回归测试要点

- `message-batch-header.test.tsx` 传入 `tokens` 渲染。
- 手工进入 hide/restore 模式确认顶栏可见。
