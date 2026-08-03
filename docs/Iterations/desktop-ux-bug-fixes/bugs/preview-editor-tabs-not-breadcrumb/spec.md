---
date: 2026-06-22
---

# preview-editor-tabs-not-breadcrumb Bug 修复规格（SPEC）

> **Bug PRD**：[prd.md](./prd.md)  
> **修复提交**：`c1bbc547` @ `feature/desktop-ux-bug-fixes`

## 根因分析

Bug 9 SPEC 将「面包屑导航」误解为用户需求；实际产品意图为 **Editor Tabs**（VS Code 编辑器标签栏）。

## 修复方案

| 模块 | 变更 |
|------|------|
| `ShellNavProvider` | `previewTabs` + `activePreviewKey`；`previewFile` 派生；`closePreviewTab` |
| `PreviewEditorTabs.tsx` | 新建标签栏 UI |
| `PreviewPane.tsx` | 替换 Breadcrumb，移除固定「文件预览」标题 |
| `preview-tab-utils.ts` | `previewTabKey(scope, path)` |
| 删除 `PreviewBreadcrumb.tsx` | — |
| `shell.css` | `.preview-editor-tabs` 样式 |

## 测试策略

| ID | 操作 | 预期 |
|----|------|------|
| T1 | 打开文件 | 出现文件名标签 |
| T2 | 打开第二文件 | 两标签，后者激活 |
| T3 | 点 × | 标签关闭 |
| T4 | UI | 无 `›` 面包屑 |

## 风险与回滚

- 切换标签会重新 load 文件（未做 per-tab 脏内容缓存）；可后续增强
- revert `c1bbc547`
