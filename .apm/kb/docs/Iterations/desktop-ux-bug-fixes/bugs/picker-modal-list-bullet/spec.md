---
date: 2026-06-22
---

# picker-modal-list-bullet Bug 修复规格（SPEC）

> **Bug PRD**：[prd.md](./prd.md)  
> **修复提交**：`51f7e7bb` @ `feature/desktop-ux-bug-fixes`

## 根因分析

`PickerModal.tsx` 使用语义化 `<ul className="picker-modal__list"><li>…</li></ul>`，但 `shell.css` 中 `.picker-modal__list` **未** 重置 `list-style`，浏览器默认 `disc` 标记在卡片按钮左侧露出。

## 修复方案

在 `shell.css` 为 `.picker-modal__list` 添加：

```css
list-style: none;
margin: 0;
```

并为 `.picker-modal__list > li` 添加 `list-style: none`。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `apps/desktop/renderer/styles/shell.css` | 清除 ul/li 默认列表样式 |

## 测试策略

| ID | 操作 | 预期 |
|----|------|------|
| T1 | 打开 Agent Picker | 无左侧圆点 |
| T2 | 打开 Model Picker | 无左侧圆点 |

## 风险与回滚方案

极低；revert `51f7e7bb` 即可。
