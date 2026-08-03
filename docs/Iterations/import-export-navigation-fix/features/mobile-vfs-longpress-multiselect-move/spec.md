---
date: 2026-07-25
agile_trace: true
---

# mobile-vfs-longpress-multiselect-move 实现规格（SPEC）

## 根因 / 方案摘要

产品要求精简 Mobile VFS 的导入导出与多选交互。实现上裁剪 `VfsFileManager` 菜单与单文件 IO 服务；长按进入既有本地批量状态；批量栏改为删除 + 移动；移动复用 `renameVfs*` / `sessionRename*`（底层 `moveVfsPath`），目标路径用从 Desktop 拷贝的 `resolveMoveDestination` / `isSelfOrAncestorPath`；目录选择扩展 `FileReferencePicker` 的 `pick-directory` 模式并注入当前 `VfsScope`。

## 变更点清单

1. `apps/mobile/src/components/vfs/VfsFileManager.tsx` — 菜单、长按、批量移动、挂载目录选择器
2. `apps/mobile/src/components/batch/VfsBatchHeader.tsx` — 去掉开启/关闭，增加移动
3. `apps/mobile/src/components/chat/FileReferencePicker.tsx` — `mode: 'at-ref' | 'pick-directory'` + scope 注入
4. `apps/mobile/src/components/vfs/vfs-move-path.ts` — 路径解析/自祖先校验
5. 删除 `apps/mobile/src/services/vfs-batch.service.ts`
6. 测试：`vfs-batch-header`、`file-reference-picker`、`vfs-move-path`、session integration

## 详细改动说明

### 菜单与入口

- `moreMenuItems`：保留新建、导入 ZIP、目录规则；删除 `import-file`、`batch`。
- 文件 `entityMenuItems`：删除 `open`、`export-file`；保留状态变更/重命名/删除。
- 目录菜单：保留导出 ZIP 等；无「打开」项无需改。
- 行 `Pressable.onLongPress`：`vfsBatch.enter()` 并勾选当前 path。

### 批量栏

- Props：`onCancel` / `onDelete` / `onMove`；移除 `onEnable` / `onDisable`。
- 「移动」打开 `FileReferencePicker`（`mode="pick-directory"`），确认后对选中路径循环移动。

### 移动编排

- 目标 path = `resolveMoveDestination(source, destDir)`。
- `isSelfOrAncestorPath` 为真 → 跳过并计入 skipped。
- 调用现有 `renameVfsFile` / `renameVfsDirectory` 或 session 对应 `sessionRename*`；目录成功后 `migrateWorkplaceDirRename`。
- `ALREADY_EXISTS` 等冲突 → toast 后 continue。
- 结束后 `refresh` + 退出批量模式。
- `currentPath` 变化仍 `vfsBatchExit`（移动用独立 Modal，不依赖跨目录勾选）。

### FileReferencePicker

- 默认 `mode='at-ref'`：行为与 ChatComposer 一致。
- `pick-directory`：按注入的 `VfsScope`（或等价 workplace 参数）拉列表；不展示文件勾选；确认返回单个目录 path（当前 cwd / 选中目录）。
- 可选：禁用源自身及子树为目标。

## 测试策略

### 测试用例

| 用例 | 覆盖 |
|------|------|
| `vfs-batch-header.test.tsx` | 栏上有移动、无开启/关闭 |
| `file-reference-picker.test.tsx` | at-ref 回归 + pick-directory |
| `vfs-move-path.test.ts` | 落点拼接与自祖先 |
| `vfs-file-manager.session.integration.test.tsx` | 既有 session 集成不回归 |

手工：长按 → 移动 → 选目录；自/子目录拦截；同名跳过。

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| session 批量 N 次 rename = N 次 userVfsTurn | 接受；失败项跳过 |
| 目录规则 migrate 可能留旧路径行 | 与既有 rename 行为一致 |
| mobile 全量 `tsc` 被无关的 `db-backup.service` 类型错误挡住 | 本敏捷不修；针对性 Jest 已过 |

回滚：还原本分支两枚 feat commit 即可。
