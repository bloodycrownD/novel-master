---
date: 2026-07-15
agile_trace: true
---

# file-ref-picker-ux 实现规格（SPEC）

> 合并原 nav-and-select / multi-and-visibility / style-and-dir-tree。  
> 敏捷：`attach-dir-filetree-style`。

## 根因 / 方案摘要

| 问题 | 方案 |
|------|------|
| 无 `currentPath`、列表不过滤直子 | cwd 导航 + `isDirectChild`；进入与选用拆分 |
| `selectedDir` 单值 + 互斥清空；丢弃并列文件 | `selectedDirs: Set`；确认并列产出 dir/text |
| 过滤 `displayState:hidden` | 去掉 hidden 滤，与工作区列表可见集合对齐 |
| 选中态依赖 row 背景；目录 chip 前缀/同色 | 去 selected 背景；目录 chip `` `@${path}` `` + warning |
| `renderDirAttachTree` 曾递归读正文 / 后改为缩进名树 | 改为 `$filetree` ASCII depth=1（抄 branch 规则，不调用 `renderWorktreeFileTreeForMacro`） |

## 变更点清单

| 文件 | 变更 |
|------|------|
| `apps/mobile/.../FileReferencePicker.tsx` | cwd、多选、去 hidden、勾选布局、无 selected 背景 |
| `apps/desktop/.../FileReferencePicker.tsx` | 同上 |
| `apps/desktop/.../vfs-tree-utils.ts` | 导出 `isDirectChild` |
| `apps/desktop/renderer/styles/shell.css` | 导航/勾选；去 `.is-selected` 背景；`.chat-composer__chip--dir` |
| `apps/*/.../AttachmentDraftChips.tsx` | `formatAttachmentChipLabel`；目录黄 |
| `packages/core/.../render-dir-attach-tree.ts` | `$filetree` ASCII depth=1；根 `basename/`；dirs→files |
| 对应 Desktop / Mobile / core 单测 | 导航、多选、chip、T-AT3 |

## 详细改动说明

### 1. Picker 导航

1. `currentPath`（默认 `'/'`）；打开/重置清空选中并回根。
2. 可见行：`isDirectChild(currentPath, path)`；不渲染 cwd 自身行。
3. 目录主体/箭头 → `setCurrentPath`；checkbox → toggle `selectedDirs`。
4. 上一级：`parentLogicalPath`；根禁用。
5. 选择当前文件夹：`selectedDirs` 加入 `currentPath`（允许 `/`）。

### 2. 多选与可见性

1. `selectedDirs: Set<string>`；`toggleDir` / `toggleFile` **不再**互斥清空。
2. `attachmentsFromPickerSelection(dirs, files)` → `[...dirs as dir, ...files as text]`。
3. `listPickerChildRows`：仅 `isDirectChild`；文件不再判 `displayState`。

### 3. 选中样式与 chip

1. Picker：仅保留 hover 背景；选中靠勾选框。
2. Chip：`type==='dir' && source!=='workplace'` → `` `@${path}` `` + `--warning` / `tokens.warning`；文件不动。

### 4. `$filetree` ASCII depth=1（本敏捷核心）

1. `vfs.list(normalizedRoot, { recursive: false })`。
2. 根行：与 `worktreeFileTreeRootLabel` 口径一致——`/` → `/`；否则 `basename/`（例 `/notes` → `notes/`）。
3. 子项：dirs 先、files 后；同组 `localeCompare`。
4. 分支字符：`├── ` / `└── `（单层无 `│   ` 前缀）。
5. **无**「全部加载」等后缀；**无**正文；**不写** file_cache；**禁止** `<dir>` / `<file` XML。
6. `sessionKkv` 仅透传兼容；超长追加 `<!-- [truncated] -->`。

输出示例：

```
notes/
├── sub/
└── a.md
```

## 测试策略

### 测试用例

- Mobile / Desktop：导航、多选、hidden 可见、chip 文案、无 selected 背景。
- core：`prepare-user-messages-for-prompt` **T-AT3** 翻转（含 `├──`/`└──`；无深层/正文/XML；cache 不变）。

### 历史提交（合并前 features）

- `794b383d` / `e7f26d69` — 导航与确认
- `907034b0` / `e7a6098b` — 多选与 hidden 可见
- style/chip/depth=1 名字树与本敏捷 `$filetree` ASCII 提交另见 git log

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 父子目录同选导致树重叠 | 产品接受；后续可做包含折叠 |
| 模型侧曾依赖旧 XML `<dir>`/`<file>` | 本敏捷按探索结论改 ASCII；回滚本敏捷 commits |
| dist 陈旧导致截图像 XML | 改后务必 `npm run build -w @novel-master/core` |
| 回滚 | revert 本敏捷 commits |
