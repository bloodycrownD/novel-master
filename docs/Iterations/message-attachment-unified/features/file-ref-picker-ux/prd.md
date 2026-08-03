---
date: 2026-07-15
dependency: Iterations/message-attachment-unified/prd.md
---

> **Supersede（Composer UI）**：双条有叉 attach / 确认进 chips 已被
> `composer-at-token-prompt-dedup` 与 `bugs/composer-two-pipelines-hard-contract` 废止。
> 现行：状态 chip 仅 workplace+user_ops 且无叉；文件引用仅正文 `@path`。
> `attachmentsFromPickerSelection` 为废 API（已删除）。

# file-ref-picker-ux Feature PRD

> 合并原 `file-ref-picker-nav-and-select` / `file-ref-picker-multi-and-visibility` / `file-ref-picker-style-and-dir-tree`。  
> 敏捷名称：`attach-dir-filetree-style`（含 features 合并）。

## 背景与变更动机

父级迭代 `message-attachment-unified` 要求 Composer `@` **文件引用选择器**支持目录浏览与多选；首版一次拉全量扁平列表、目录行点击仅 toggle「选中目录」，且存在互斥勾选、hidden 过滤、选中行背景强化、目录 chip 文案/色相不一致，以及 `@` 目录 hydrate 递归读正文写 file_cache、与 `$filetree` 视觉不对齐等问题。

本 Feature 统一交付：

1. **导航**：cwd 直子浏览、进入目录、上一级、选用当前文件夹。
2. **多选 / 可见性**：多文件 + 多目录并列确认；不滤 `displayState:hidden`。
3. **选中样式 / chip**：选中仅勾选框；目录 chip `@${path}` + warning 黄。
4. **`$filetree` ASCII depth=1**：`@` 目录附件拼装对齐宏树分支字符与根标签口径；外包 `<dir path="…">` 与 `<file>` 对称分段（无宏加载后缀、无正文、不写 file_cache、内层不嵌 `<file>`）。

## 范围说明

| 项 | 说明 |
|----|------|
| **纳入** | Mobile + Desktop `FileReferencePicker` 导航/多选/样式；`AttachmentDraftChips` 目录 chip；`renderDirAttachTree` `$filetree` ASCII depth=1 |
| **不改** | hydrate/wrap 调用透传；文件 chip 文案；Core 常驻工作区 / 规则引擎；不嵌整页 `VfsFileManager` |
| **不调用** | `renderWorktreeFileTreeForMacro`（仅抄 branch 规则与根标签口径） |

## 影响模块与接口

- `apps/mobile/.../FileReferencePicker.tsx`、`AttachmentDraftChips.tsx`
- `apps/desktop/.../FileReferencePicker.tsx`、`AttachmentDraftChips.tsx`、`vfs-tree-utils`、`shell.css`
- `packages/core/.../render-dir-attach-tree.ts`
- 对应 Desktop / Mobile / core 单测

## 验收标准

### 导航

1. 打开「引用文件」后仅见当前目录直子；点目录行主体可进入子目录。
2. 目录行勾选框可选中该目录；可选「选择当前文件夹」（含根 `/`）。
3. Desktop 与 Mobile 交互对齐。

### 多选 / 可见性

4. 可同时勾选多个文件与多个目录，确认后均进 chips/attachments；无互斥清空。
5. 勾选框列对齐；规则为 hidden 的条目在 Picker 中仍可见且可选。
6. 发送后拼接：目录仍为树、文件仍为全文（仅条数可增加）。

### 选中样式 / chip

7. Desktop/Mobile Picker：选中行无背景高亮，仅 ☑/☐ 表达选中。
8. 非 workplace 的 `type:'dir'` chip 文案为 `@${path}`（例 `@/555`），颜色为 warning 黄；文件 chip 仍为 `@ ${path}`。

### `$filetree` ASCII depth=1 + `<dir>` 外壳

9. `vfs.list(root, { recursive: false })` 仅直子；输出 `├──` / `└──` ASCII（单层无需 `│` 深层）。
10. 根行：非 `/` 用 **basename+`/`**（例 `notes/`）；根 `/` 仍为 `/`。
11. 排序：**dirs 再 files**，同组内 `localeCompare`。
12. 整体外包 `<dir path="{逻辑绝对 path}">…</dir>`（与 `<file path>` 对称）；**无**「全部加载」等宏后缀；**无**正文；**不写** file_cache；**内层禁止**嵌套 `<file>`。
13. 超长仍按 512KiB 截断（预算计树正文；截断标记仍在标签内）。

## 测试用例

| ID | Given / When / Then |
|----|---------------------|
| T-P1 | 有子目录 → 点进入 → cwd 变为该 path，列表仅直子 |
| T-P2 | 勾选目录 → 确认 → 产出 `type:'dir'` attachment |
| T-P3 | 多选文件 → 确认 → 多条 `type:'text'` |
| T-P4 | 根目录可用「选择当前文件夹」选中 `/` |
| T-M1 | 多 dir + 多 file 同确认 → 多条 attachment |
| T-M2 | 勾选 dir 不清空已选文件 |
| T-M3 | `listPickerChildRows` 含 `displayState:hidden` 的文件 |
| T-S1 | 勾选文件/目录 → 无 selected 背景（样式） |
| T-S2 | dir chip → `@/path` + warning 色 |
| T-AT3 | `/notes` → `<dir path="/notes">\nnotes/\n├── sub/\n└── a.md\n</dir>`；无 b.md/正文/`<file`；cache 不变 |
