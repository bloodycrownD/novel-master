---
date: 2026-06-22
dependency: Iterations/desktop-ux-bug-fixes/prd.md
---

# preview-editor-tabs-not-breadcrumb Bug PRD

## 背景

`desktop-ux-bug-fixes` Bug 9 将 Preview 顶部实现为 **路径面包屑**（`55 › test.md`）。用户期望的是 **VS Code 编辑器标签栏（Editor Tabs）**：横向排列已打开文件、当前项高亮、可关闭切换。

## 现象描述

Preview 区 header 显示「文件预览」+ 路径分段导航，与 VS Code 多文件 **Tab 栏** 交互不符。

## 预期行为

- 从工作区打开文件 → 在 Preview 顶栏增加 **标签**（仅文件名，如 `test.md`）
- 打开多个文件 → 多个标签横向排列，**当前** 标签高亮
- 点击标签 → 切换预览/编辑内容
- 点击标签 **×** → 关闭该文件标签
- **无** 路径面包屑 `›` 分段

## 验收标准

- **Given** 已打开 `test.md`  
  **When** 查看 Preview 顶栏  
  **Then** 显示 VS Code 式 **标签** `test.md`，非 `55 › test.md`

- **Given** 已打开两个文件  
  **When** 点击另一标签  
  **Then** 内容切换；关闭当前标签后激活相邻标签

- **Given** 切换会话  
  **Then** 标签栏清空（沿用 clearPreviewFile）

## 回归测试要点

- Explorer 单击打开仍新增/激活标签
- 预览/编辑、保存行为不变
