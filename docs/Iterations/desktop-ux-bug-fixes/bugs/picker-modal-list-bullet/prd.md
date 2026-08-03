---
date: 2026-06-22
dependency: Iterations/desktop-ux-bug-fixes/prd.md
---

# picker-modal-list-bullet Bug PRD

## 背景

Desktop 工作区底部 Agent / 模型选择使用 `PickerModal` 组件。用户反馈列表项左侧出现多余圆点，像未清理的旧样式。

## 现象描述

打开「选择 Agent（当前：xxx）」弹窗时，每个选项 **左侧** 可见浏览器默认 **列表圆点**（disc），与卡片式按钮样式不协调。

## 复现步骤

1. Desktop 进入会话
2. 点击工作区底部 **Agent** 名称打开选择弹窗

## 预期行为

列表项为纯圆角按钮样式，**无** 左侧圆点或列表符号。

## 实际行为

`<ul>` 默认 `list-style: disc` 圆点可见。

## 影响范围

- 所有 `PickerModal` 实例（Agent、Model 等）
- 仅 Desktop UI 样式

## 验收标准

- **Given** Agent 选择弹窗打开  
  **When** 查看列表项  
  **Then** **无** 左侧圆点

## 回归测试要点

- 选中态、hover、取消按钮仍正常
- Model 选择弹窗同样无圆点
