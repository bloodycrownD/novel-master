---
date: 2026-07-21
---

# vfs-batch-io 技术规格（SPEC）

> **PRD**：[prd.md](./prd.md)  
> **父级**：[../../prd.md](../../prd.md)  
> **边界**：不实现 ZIP（见 [vfs-zip-directory](../vfs-zip-directory/spec.md)）；Mobile **无**拖放。

## 设计目标

1. Core（或 app service 编排 + core 原语）提供 **批量 ingest / export 规划**：保留相对路径、UTF-8 only、冲突可确认。  
2. Desktop：**树内移动**（自定义 MIME）+ **拖入导入**（Files）+ **拖出导出**（main `webContents.startDrag` + preload 暴露 + 临时物化）。  
3. Mobile：更多菜单「批量导入 / 批量导出」；与「批量操作」（删除/规则）文案区分。  
4. 冲突默认：**覆盖前确认**（取消则目标不变）。  
5. 空本机文件夹 → VFS `mkdir` 显式目录节点。

## 现状与约束

| 能力 | 现状 | 本 feature |
|------|------|------------|
| `mkdir` / `write` / `moveVfsPath` | 有 | 编排原语 |
| 批量 ingest/export 服务 | **无** | 新建 |
| Desktop DnD | **无** | 新建 |
| preload | 仅 invoke | **必须**暴露 `webUtils.getPathForFile` + 拖出桥（见 Step 3） |
| Mobile pick | 单文件 ZIP/YAML | 多选 + 读内容；目录能力见「Mobile 降级定案」 |
| `write(versionCheck:false)` | 静默覆盖 | UI/编排层必须先确认 |
| Session user-vfs-turn | 单路径 op | 批量：循环现有 op（定案见下） |

### Session 定案

- 若 `user-vfs-turn` 开启：批量 ingest **逐文件**走既有 `buildUserVfs*Op` + `executeSessionUserVfsOp`（保证 pending/transcript 合同），失败汇总；不引入未定义的「巨型单 op」。  
- 非 session / 未开 flag：直接 `VfsService.mkdir/write`（整批事务语义见 `BatchApplyReport`）。

## 总体方案

### Core / 共享逻辑

```ts
// 概念 API（可放 core service 或两端共享 pack）
interface BatchIngestPlanEntry {
  relativePath: string;
  content: string; // 已 UTF-8 校验
}
interface BatchConflict {
  logicalPath: string;
  reason: "exists";
}

/** apply 完成后的汇总；路径均为逻辑 path（相对域或绝对，实现内统一一种并文档化） */
interface BatchApplyReport {
  /** 已成功写入（含本次新建的目录节点若需对外可见可列入，默认只列文件） */
  written: string[];
  /** 预检或策略性未写：非法 UTF-8、用户选跳过冲突等；非异常 */
  skipped: string[];
  /** 执行期异常未写成功的项 */
  failed: { path: string; message: string }[];
}

async function planBatchIngest(scope, targetDir, entries): Promise<{
  writes: BatchIngestPlanEntry[];
  mkdirPaths: string[];
  conflicts: BatchConflict[];
  skippedBinary: string[];
}>

async function applyBatchIngest(..., { overwriteConfirmed: boolean }): Promise<BatchApplyReport>
```

- 导入：**合并**进 `targetDir`，**不** `deleteVfsPrefix` 整域。  
- 有 conflicts 且未确认 → 不写；返回的 Report：`written=[]`，`skipped` 可含冲突路径（或由 UI 单独展示 conflicts，二者择一并在实现中固定），`failed=[]`。  
- 非法 UTF-8 → 进入 plan 的 `skippedBinary`，apply 时并入 Report.`skipped`，不静默写入乱码。  
- Export：输入逻辑 paths → 展开为 `{ relativePath, content }[]`（目录递归）；平台写盘。

### BatchApplyReport 与失败语义（钉死）

| 通道 | 写入方式 | 失败时 VFS 状态 | Report |
|------|----------|-----------------|--------|
| **非 session**（直连 `VfsService`） | **单事务整批** apply（mkdir/write 同事务） | **整批回滚**：任一执行失败 → 本批写入全部不落库；目标处与 apply 前一致 | `written=[]`；失败项进 `failed`；预检跳过仍进 `skipped` |
| **session + user-vfs-turn** | **逐文件**既有 op（每成功一项即已进 pending/活树） | **不整批回滚**；已成功项保留；后续失败继续汇总 | `written` / `skipped` / `failed` 逐项填充；UI 必须展示三者计数或列表 |

- 部分成功（仅 session 通道）不算产品缺陷，但 **必须** 用 Report 说明已写入范围；禁止静默半套无提示。  
- 非 session 通道 **禁止**「写了一半留在库里」；与 PRD「失败不留下半套不可用树」对齐的实现手段 = 事务回滚。

### Desktop DnD

| Intent | 判别 | 动作 |
|--------|------|------|
| VFS 移动 | 自定义 MIME `application/x-nm-vfs-paths` | `moveVfsPath`；禁止拖到自身/后代；目标存在 → 提示失败（保持 move 不覆盖） |
| 本机导入 | `Files` 且无自家 MIME | main 读路径（preload → `webUtils.getPathForFile`）→ plan → 冲突确认 → apply |
| 本机导出 | renderer `dragstart` → IPC 物化临时树 → **main** `webContents.startDrag({ files })`（经 **preload 暴露**的 API 触发） | 物化或 `startDrag` **失败 → toast**（不可静默） |

**验收钉死**：Desktop「拖出到本机」的默认验收路径 = **拖出（startDrag）**，**不是** `dialog.showSaveDialog` / 选目录导出。dialog 仅可作为调试或无障碍辅助，**不得**替代拖出作为本 feature 的默认手工验收项。

### Mobile 降级定案（钉死）

#### 批量导入

- `pick` **多选文件**优先；若平台提供 `pickDirectory`（或等价）则支持文件夹递归。  
- 无选文件夹能力时：UI 提示「当前仅支持多选文件」，不假装已导入目录。

#### 批量导出 — 无多选时

- **钉死**：入口未先多选时，「批量导出」= **导出当前浏览目录全部**（递归，保留相对结构）。  
- **不**采用「禁用并提示」方案。

#### 批量导出 — 无法选目标目录时（Android 验收路径）

1. **优先**：系统/插件选目标文件夹（若运行时可用）。  
2. **否则（Android 写死降级）**：将展开后的文件物化到 app cache，再走 **`@react-native-documents/picker` 的 `saveDocuments`**：  
   - 若一次可提交多个 file → **多文件 `saveDocuments`**（`copy: true`，与既有 ZIP 导出一致）；  
   - 若一次仅能一个文件 → **按相对路径顺序逐文件 `saveDocuments`**；用户中途取消 → 停止后续，toast 已保存数量。  
3. **系统分享（Share）**：可作为同降级族的实现变体（一次交出多个 URI），但 **Android 手工验收主路径写死为 `saveDocuments`**（多文件或逐文件），PR/实现说明须写明实际走的分支。  
4. 验收：用户能在本机打开导出结果（完整目录树或扁平多文件 + 相对路径可辨）；须在测试记录注明「选目录」或「saveDocuments 降级」。

## 最终项目结构

```
packages/core/src/service/vfs/
  impl/vfs-batch-io.service.ts     # NEW（或 logic + thin service）
  ...
apps/desktop/
  main/services/vfs-batch.service.ts
  main/ipc/handlers/vfs.ts         # 新 channel（含 startDrag 触发）
  preload/preload.ts               # 暴露 getPathForFile + startDrag 桥
  renderer/features/workspace/WorkspaceTree.tsx  # DnD
apps/mobile/
  services/vfs-batch.service.ts
  components/vfs/VfsFileManager.tsx
```

## 变更点清单

| 区域 | 变更 |
|------|------|
| Core batch plan/apply + `BatchApplyReport` + 测试 | 含非 session 事务回滚 vs session 逐文件汇总 |
| Desktop IPC + preload（startDrag / webUtils）+ DnD + 临时文件 | 拖出失败 toast |
| Mobile 更多菜单 + pick；导出：当前目录全部 / saveDocuments 降级 | |
| 与 ZIP feature 菜单共存 | 不重复「导入 ZIP」项 |

## 详细实现步骤

- Step 1 — phase-batch-core — blocking: yes — qa: auto：plan/apply + UTF-8 skip + 冲突门闩；`BatchApplyReport` 字段；非 session 失败整批回滚单测；session 逐文件失败汇总单测（可与 Step 5 合并断言）。  
- Step 2 — phase-batch-desktop-move — blocking: yes — qa: auto/manual：树内 MIME 移动。  
- Step 3 — phase-batch-desktop-inout — blocking: yes — qa: manual_user：  
  - preload 暴露 `webUtils.getPathForFile`（或等价）与 **拖出桥**；  
  - **main** 侧调用 `webContents.startDrag` 完成拖出；  
  - 拖入导入、拖出导出；物化/`startDrag` 失败 → **toast**；  
  - **验收不得以 dialog 选目录导出替代拖出**。  
- Step 4 — phase-batch-mobile — blocking: yes — qa: manual_user：更多批量导入/导出；无多选 → 导出当前目录全部；Android 无法选目录 → `saveDocuments` 降级（见上定案）。  
- Step 5 — phase-batch-session — blocking: yes — qa: auto：session + user-vfs-turn 下逐文件 op 仍进 pending；部分失败时 Report.`written`/`failed` 正确。

## 测试策略

### 测试用例

- T-B1 — blocking: yes — Step 1：ingest 两文件进 `/chap`，兄弟保留。  
- T-B2 — blocking: yes — Step 1：目标已存在且未确认 → 零写入。  
- T-B3 — blocking: yes — Step 1：非法 UTF-8 进入 skipped，不写该文件。  
- T-B4 — blocking: yes — Step 1：空文件夹 → VFS 存在 directory 节点。  
- T-B5 — blocking: yes — Step 1：export 规划保留相对结构。  
- T-B6 — blocking: yes — Step 1：非 session apply 中途失败 → 事务回滚，库无本批写入；Report.`written=[]` 且 `failed` 非空。  
- T-B7 — blocking: yes — Step 2：move 后原路径不存在。  
- T-B8 — blocking: yes — Step 5：session 逐文件第二项失败 → 第一项仍在；Report 含 written + failed。  
- T-B9 — blocking: no — Step 3/4：双端手工验收矩阵（PRD 清单；Desktop 拖出非 dialog；Mobile Android saveDocuments 降级）。

## 兼容性 / 迁移

- 无 DB 迁移。  
- 不改变 ZIP API（除与菜单共存）。  
- `moveVfsPath` 冲突语义保持拒绝覆盖（移动≠导入覆盖）。

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| Mobile 无法选目录 | Android 钉死 `saveDocuments` 降级；验收标明 | — |
| startDrag + sandbox | 临时目录在 userData；失败 **toast**；preload 正式暴露桥 | **不以** dialog 作为默认产品/验收替代；若拖出短期不可用则阻塞本 Step，不宣称「导出已验收」 |
| 大批量逐 op 慢 | 可接受首期；后续 bulk op | — |
| 与 ZIP 菜单冲突 | IA 对照父 PRD | — |

**回滚**：禁用菜单项与 DnD；Core batch 服务可留无入口。
