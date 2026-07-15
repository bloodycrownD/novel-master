---
date: 2026-07-15
dependency: Iterations/message-attachment-unified/prd.md
---

# file-ref-picker-style-and-dir-tree Feature PRD

## 背景与变更动机

在 `file-ref-picker-nav-and-select` / multi 之后，Picker 选中行仍用背景色强化，目录 chip 文案带「目录」前缀且色相与文件无区分；`@` 目录 hydrate 仍递归读正文写 file_cache，与「只关心结构直子」的产品预期不符。

## 范围说明

| 项 | 说明 |
|----|------|
| **纳入** | Picker 选中仅勾选框；目录 chip `@${path}` + 目录黄；`renderDirAttachTree` depth=1 名字树 |
| **不改** | 文件 chip 文案；hydrate/wrap 调用透传；Picker 导航/多选逻辑 |

## 验收标准

1. Desktop/Mobile Picker：选中行无背景高亮，仅 ☑/☐ 表达选中。
2. 非 workplace 的 `type:'dir'` chip 文案为 `@${path}`（例 `@/555`），颜色为 warning 黄；文件 chip 仍为 `@ ${path}`。
3. dir hydrate 输出仅根下直子名字，无深层 path、无文件正文、不写 file_cache。
4. T-AT3 断言翻转并通过。

## 测试用例

| ID | Given / When / Then |
|----|---------------------|
| T-S1 | 勾选文件/目录 → 无 selected 背景（样式） |
| T-S2 | dir chip → `@/path` + warning 色 |
| T-AT3 | `/notes` 含 `a.md`+`sub/b.md` → tree 仅 `a.md`/`sub/`，无 AAA/b.md，file_cache 不变 |
