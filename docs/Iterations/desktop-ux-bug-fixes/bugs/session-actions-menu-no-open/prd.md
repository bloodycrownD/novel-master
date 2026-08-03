---
date: 2026-06-22
dependency: Iterations/desktop-ux-bug-fixes/prd.md
---

# session-actions-menu-no-open Bug PRD

## 背景

Desktop 会话 Composer 底部「更多选项」(⋯) 应弹出会话操作菜单（隐藏/恢复/删除消息、刷新工作树、聊天重命名、压缩上下文等）。该入口在 `desktop-ux-bug-fixes` 迭代中扩展了菜单项，但用户反馈点击无反应。

## 现象描述

在会话对话页点击 Composer 右侧 **「更多选项」** 按钮，会话操作菜单 **不弹出**， seemingly 无任何反馈。

## 复现步骤

1. 打开 Desktop，进入某项目下的会话（conversation 视图）
2. 点击聊天输入框旁 **⋯** 按钮

## 预期行为

弹出 `#session-actions-menu` 会话操作菜单，可点击各项操作。

## 实际行为

菜单不显示，用户感知为「无反应」。

## 影响范围

- Desktop 会话 Composer「更多选项」
- 不影响 ChatRail 会话列表 ⋮ 菜单（若存在独立入口）

## 验收标准

- **Given** 会话对话页  
  **When** 单击 Composer「更多选项」  
  **Then** 会话操作菜单 **可见** 且可操作

- **Given** 菜单已打开  
  **When** 点击菜单外区域  
  **Then** 菜单关闭

## 回归测试要点

- 工作区右键菜单、消息右键菜单关闭逻辑不受影响
- 菜单内各操作项仍可正常触发
