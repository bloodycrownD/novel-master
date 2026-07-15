---
date: 2026-07-15
agile_trace: true
---

# file-ref-picker-style-and-dir-tree 实现规格（SPEC）

## 根因 / 方案摘要

**根因**：选中态依赖 row background；目录 chip 与文件同色且带「目录」前缀；`renderDirAttachTree` 递归 list + `loadLeafFileBlock` 读正文写 cache。

**方案**：去 selected 背景；目录 chip 改 `@${path}` + `--warning`/`tokens.warning`；目录树改为 `list(recursive:false)` 只出直子名字。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `apps/desktop/renderer/styles/shell.css` | `.is-selected` 去 background；`.chat-composer__chip--dir` |
| `apps/mobile/.../FileReferencePicker.tsx` | 去掉 checked 行 `backgroundColor` |
| `apps/*/.../AttachmentDraftChips.tsx` | `formatAttachmentChipLabel`；目录黄 |
| `packages/core/.../render-dir-attach-tree.ts` | depth=1 名字树；停用 `loadLeafFileBlock` |
| `packages/core/test/.../prepare-user-messages-for-prompt.test.ts` | 翻转 T-AT3 |
| `apps/desktop/test/attachment-draft-chips.test.ts` | chip 文案 |
| `apps/mobile/__tests__/attachment-draft-chips.test.ts` | chip 文案 |

## 详细改动说明

1. **Picker**：仅保留 hover 背景；选中靠勾选框。
2. **Chip**：`type==='dir' && source!=='workplace'` → `` `@${path}` `` + warning 色；文件不动。
3. **Tree**：`vfs.list(root,{recursive:false})` →  
   ```
   /notes/
     a.md
     sub/
   ```
   不读 body、不写 file_cache；`sessionKkv` 仅透传兼容。

## 测试策略

- core：`prepare-user-messages-for-prompt`（含 T-AT3）
- desktop：`attachment-draft-chips` + `file-reference-picker`
- mobile：同名 jest

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 模型侧依赖旧 XML `<dir>`/`<file>` | 父迭代后续可评估；本敏捷按探索结论改 plain tree |
| 回滚 | revert 本敏捷 commits |
