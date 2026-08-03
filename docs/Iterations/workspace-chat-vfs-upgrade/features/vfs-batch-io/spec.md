---
date: 2026-07-21
---

# vfs-batch-io 技术规格（SPEC）

> **PRD**：[prd.md](./prd.md)  
> **父级**：[../../prd.md](../../prd.md)  
> **边界**：不实现 ZIP（见 [vfs-zip-directory](../vfs-zip-directory/spec.md)）；Mobile **无**拖放；Mobile **无**非 ZIP 批量 IO。

## 设计目标

1. Core（或 app service 编排 + core 原语）提供 **批量 ingest / export 规划**：保留相对路径、UTF-8 only、冲突可确认、**file/dir 类型冲突预检**。  
2. Desktop：**树内移动**（自定义 MIME）+ **拖入导入**（Files）+ **拖出导出**（main `webContents.startDrag` + preload 暴露 + 临时物化）。  
3. Mobile：**单文件**导入/导出（更多 / 文件项菜单）；目录级走 ZIP feature。  
4. 冲突默认：**覆盖前确认**（取消则目标不变）。  
5. Desktop：空本机文件夹 → VFS `mkdir` 显式目录节点。

## 现状与约束

| 能力 | 现状 | 本 feature |
|------|------|------------|
| `mkdir` / `write` / `moveVfsPath` | 有 | 编排原语 |
| 批量 ingest/export 服务 | **无** | 新建（Desktop 全量；Mobile 单文件编排复用 core plan/apply） |
| Desktop DnD | **无** | 新建 |
| preload | 仅 invoke | **必须**暴露 `webUtils.getPathForFile` + 拖出桥（见 Step 3） |
| Mobile pick | 单文件 ZIP/YAML | **单文件**文本导入；**无**多选、**无** folder-pick |
| Mobile export | ZIP `saveDocuments` | 单文件 `saveDocuments`；目录 = ZIP |
| `write(versionCheck:false)` | 静默覆盖 | UI/编排层必须先确认 |
| Session user-vfs-turn | 单路径 op | Desktop 批量：循环现有 op；Mobile 单文件同理 |

### Session 定案

- 若 `user-vfs-turn` 开启：ingest **逐文件**走既有 `buildUserVfs*Op` + `executeSessionUserVfsOp`（保证 pending/transcript 合同），失败汇总；不引入未定义的「巨型单 op」。  
- 非 session / 未开 flag：直接 `VfsService.mkdir/write`（整批事务语义见 `BatchApplyReport`）。

## 总体方案

### Core / 共享逻辑

```ts
interface BatchIngestPlanEntry {
  relativePath: string;
  content: string; // 已 UTF-8 校验
}
interface BatchConflict {
  logicalPath: string;
  reason: "exists";
}
interface BatchIngestTypeConflict {
  logicalPath: string;
  message: string;
}

interface BatchApplyReport {
  written: string[];
  skipped: string[];
  failed: { path: string; message: string }[];
}

async function planBatchIngest(scope, targetDir, entries): Promise<{
  writes: BatchIngestPlanEntry[];
  mkdirPaths: string[];
  conflicts: BatchConflict[];
  skippedBinary: string[];
  typeConflicts: BatchIngestTypeConflict[];
}>

async function applyBatchIngest(..., { overwriteConfirmed: boolean }): Promise<BatchApplyReport>
```

- 导入：**合并**进 `targetDir`，**不** `deleteVfsPrefix` 整域。  
- 有 conflicts 且未确认 → 不写；返回的 Report：`written=[]`，`skipped` 可含冲突路径，`failed=[]`。  
- 有 **typeConflicts** → apply 零写入，`failed` = typeConflicts（同路径 file/dir、file 下再挂路径等）。  
- 非法 UTF-8 → 进入 plan 的 `skippedBinary`，apply 时并入 Report.`skipped`，不静默写入乱码。  
- Export：输入逻辑 paths → 展开为 `{ relativePath, content }[]`（目录递归）；**Desktop 专用**；Mobile 单文件 export 直接 `vfs.read` + `saveDocuments`。

### BatchApplyReport 与失败语义（钉死）

| 通道 | 写入方式 | 失败时 VFS 状态 | Report |
|------|----------|-----------------|--------|
| **非 session**（直连 `VfsService`） | **单事务整批** apply（mkdir/write 同事务） | **整批回滚**：任一执行失败 → 本批写入全部不落库 | `written=[]`；失败项进 `failed`；预检跳过仍进 `skipped` |
| **session + user-vfs-turn** | **逐文件**既有 op | **不整批回滚**；已成功项保留 | `written` / `skipped` / `failed` 逐项填充 |

- UI toast 须读 `failed[].message`，**禁止**误用不存在的 `error` 字段。  
- Mobile `readPickedFileAsEntry` / `keepLocalCopy` 失败须 **抛错或返回失败态**，禁止假 `applied` 空成功。

### Desktop DnD

| Intent | 判别 | 动作 |
|--------|------|------|
| VFS 移动 | 自定义 MIME `application/x-nm-vfs-paths` | `moveVfsPath`；禁止拖到自身/后代 |
| 本机导入 | `Files` 且无自家 MIME | main 读路径 → plan → 冲突确认 → apply |
| 本机导出 | renderer `dragstart` → IPC 物化 → main `startDrag` | 失败 → toast |

**验收钉死**：Desktop「拖出到本机」= **startDrag**，非 dialog 另存。

### Mobile 定案（钉死）

#### 单文件导入

- `pick({ allowMultiSelection: false })` 选一个文件。  
- `keepLocalCopy` → 读 bytes → `planBatchIngest`（单 entry）→ 冲突确认 → apply。  
- copy/read 失败 → **throw**；UI `.catch` toast「文件导入失败」，**不得**走「导入完成」。

#### 单文件导出

- 对选中文件的逻辑 path 执行 `vfs.read`。  
- 写入 cache 临时文件 → **`saveDocuments`**（`copy: true`）另存。  
- 用户取消 → `cancelled`，不 toast 失败。

#### 目录级（非本 feature）

- 导入/导出目录 → **`vfs-zip-directory`**（ZIP pick / saveDocuments）。  
- **不包含**：多选批量导出、导出当前目录全部、folder-pick、非 ZIP 目录递归导入。

#### 平台限制

- Android/iOS 上 `@react-native-documents/picker` **无法**可靠 pick 文件夹或批量写入目录结构。  
- 产品 IA 与文档不得描述 Mobile 非 ZIP 批量能力。

## 最终项目结构

```
packages/core/src/service/vfs/
  impl/vfs-batch-io.service.ts
apps/desktop/
  main/services/vfs-batch.service.ts
  renderer/features/workspace/WorkspaceTree.tsx
apps/mobile/
  services/vfs-batch.service.ts      # 单文件 import/export 编排
  components/vfs/VfsFileManager.tsx
```

## 变更点清单

| 区域 | 变更 |
|------|------|
| Core batch plan/apply + typeConflicts + 测试 | 含非 session 事务回滚 vs session 逐文件汇总 |
| Desktop IPC + preload + DnD | 批量三向 |
| Mobile 单文件菜单 + pick/saveDocuments | 无批量 |
| 与 ZIP feature 菜单共存 | 目录 ZIP / 文件单文件 文案区分 |

## 详细实现步骤

- Step 1 — phase-batch-core — blocking: yes — qa: auto：plan/apply + UTF-8 skip + 冲突门闩 + **typeConflicts**；T-B7/T-B9。  
- Step 2 — phase-batch-desktop-move — blocking: yes — qa: auto/manual。  
- Step 3 — phase-batch-desktop-inout — blocking: yes — qa: manual_user。  
- Step 4 — phase-batch-mobile — blocking: yes — qa: manual_user：**单文件**导入/导出；read 失败 toast；与 ZIP 菜单共存。  
- Step 5 — phase-batch-session — blocking: yes — qa: auto。

## 测试策略

### 测试用例

- T-B1 — ingest 两文件进 `/chap`，兄弟保留。  
- T-B2 — 目标已存在且未确认 → 零写入。  
- T-B3 — 非法 UTF-8 进入 skipped。  
- T-B4 — 空文件夹 → directory 节点。  
- T-B5 — export 规划保留相对结构。  
- T-B6 — 非 session apply 中途失败 → 回滚。  
- T-B7 — 同路径 file + directory → typeConflicts，apply 零写入。  
- T-B8 — session 逐文件第二项失败 → 第一项仍在。  
- T-B9 — file 下再挂 file 路径 → typeConflicts。  
- T-B10 — blocking: no — Desktop 拖出 + Mobile 单文件手工矩阵。

## 兼容性 / 迁移

- 无 DB 迁移。  
- 不改变 ZIP API。  
- `moveVfsPath` 冲突语义保持拒绝覆盖。

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| Mobile 无法选目录 | 目录仅 ZIP；单文件 saveDocuments | — |
| startDrag + sandbox | 临时目录；失败 toast | — |
| 与 ZIP 菜单冲突 | IA：文件 vs 目录 | — |

**回滚**：禁用菜单项与 DnD；Core batch 服务可留无入口。
