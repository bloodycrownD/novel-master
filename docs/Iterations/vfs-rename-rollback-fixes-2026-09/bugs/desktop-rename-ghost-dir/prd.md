---
date: 2026-09-15
dependency: iterations/vfs-rename-rollback-fixes-2026-09/prd.md
---

# desktop-rename-ghost-dir Bug PRD

## 背景

用户上报「重命名文件失败」（提交后弹英文报错，事后又能重命名）。探索发现重命名失败并非单一根因，而是四个同族缺陷叠加：空目录重命名误报（最贴合用户「提交后英文报错、后来又好了」的现象）、desktop 目录重命名不迁移规则导致的幽灵目录、幽灵目录上的操作报英文 NOT_FOUND、renderer 层 VFS 失败直出英文原文。

## 现象描述

1. **空目录重命名必失败**：新建目录（尚无文件）立即改名，弹英文报错（NOT_FOUND 原文）；目录里有文件后改名正常——「时好时坏」的来源。
2. **幽灵目录**：desktop 目录改名成功后，旧名字目录仍挂在文件树上；对它再改名/进入操作报英文 NOT_FOUND（「能删不能改」）。
3. **英文报错**：所有 VFS 操作（重命名/新建/删除）失败时 toast 直出英文原文（如 `Path not found: /a`），mobile 端则有中文文案。

## 复现步骤

- 空目录：desktop 文件树新建目录 → 立即重命名 → 弹英文 NOT_FOUND；
- 幽灵目录：desktop 重命名一个目录 → 旧名目录残留 → 对旧名目录重命名 → 英文 NOT_FOUND；
- 英文报错：任一 VFS 操作失败（如重命名为已存在名称）→ toast 为英文。

## 预期行为

- 空目录可以重命名（repo 层 `renamePrefixInScope` 设计上允许空目录）；
- 目录重命名后规则跟随迁移，旧目录不残留（对齐 mobile 行为）；
- 存量残留的幽灵目录不再渲染进文件树与 `$filetree` 宏；
- VFS 操作失败弹中文文案（对齐 mobile：NOT_FOUND → 「文件不存在或已被删除。」、ALREADY_EXISTS → 「名称不能重复」）。

## 实际行为（修复前）

- `moveVfsPath` 以 `vfs.list(oldDir)` 子项列表判目录，LIKE 模式不含目录自身行 → `hasDirRow` 恒 false，空目录 `entries.length===0 && !hasDirRow` 误抛 NOT_FOUND；repo 层 `renamePrefixInScope` 还有第二层 bug（改名后按旧路径 SELECT 复核必然落空）；
- desktop `handleVfsRename` 目录重命名后不迁移 workplace 目录规则（mobile 有 `migrateWorkplaceDirRename`，desktop 缺失），而 desktop 新建目录必写默认规则行 → 残留规则旧路径被 `buildWorkplaceDirSet` 整链渲染成幽灵目录；mobile 已用 VFS 列表过滤幽灵，desktop 没有；
- renderer `workspace-actions.ts` 失败分支直接 `result.error.message`（main 侧 code 透传无损，但 renderer 无中文转换、无按 code 的友好分支）。

## 影响范围

- 空目录重命名：core `moveVfsPath` / `renamePrefixInScope`，双端命中；
- 幽灵目录：desktop 双分支（直调 + session）目录重命名；core `loadContextMetadata` 的目录集合构建（双端文件树与 `$filetree` 宏同源）；
- 文案：desktop renderer 的 rename/create/delete 动作。

## 验收标准

1. 空目录（有无文件均可）重命名成功；不存在的路径重命名仍报 NOT_FOUND（幽灵路径行为不放宽）；
2. desktop 目录重命名后：`getDirRule(oldPath)` 为 undefined、`getDirRule(newPath)` 保留原配置（含子目录规则批量迁移），project 面板与 chat 面板（session 分支）都生效；文件重命名不触发迁移（与 mobile 口径一致）；
3. 残留规则路径（无目录行且前缀下无 live 文件）不再出现在文件树与 `$filetree` 宏；目录行存在的空目录仍正常渲染（不误杀）；
4. VFS 动作失败 toast 为中文；`ALREADY_EXISTS` 提示「名称不能重复」；setDirRule 等非 VFS 动作文案不变。

## 回归测试要点

- 有子项的目录树重命名（既有用例）、NOT_FOUND 幽灵路径用例；
- `deleteRulesUnderLogicalPrefix` 既有用例（其「幽灵可见」前置断言随兜底行为调整为 repo 层断言）；
- 桌面拖拽移动（vfs-tree-dnd-move）、workspace-actions 既有用例。
