---
date: 2026-07-21
---

# vfs-zip-directory 技术规格（SPEC）

> **PRD**：[prd.md](./prd.md)  
> **父级**：[../../prd.md](../../prd.md)  
> **Supersedes（UI 默认）**：既有整域 ZIP 作为 UI 默认；本 feature 默认 **子树**，`directoryPath=/` 时行为 ≡ 旧整域。

## 设计目标

1. `VfsZipIoService.export/import` 增加可选 `directoryPath`（默认 `/`）。  
2. ZIP entry **相对目标目录**；导入只 `deleteVfsPrefix(子树物理前缀)`。  
3. 入口：Desktop **目录行**（含域根 `/`）右键 + **空白区**（≡ `directoryPath:/`）均可「导入 ZIP / 导出 ZIP」；Mobile 更多=导入 ZIP、目录项=导出 ZIP；**移除**顶栏/路径栏 ZIP 图标双入口。  
4. CLI `--path`，默认 `/`。  
5. 外部 ZIP 带「域根/目标目录名」错误前缀 → **硬失败**（`INVALID_PATH`），**不做自动剥前缀**，禁止静默嵌套。

## 现状与约束

| 层 | 现状 | 本 feature |
|----|------|------------|
| Port | `export(scope)` / `import(scope, bytes, {confirmed})` | + `directoryPath?: string` |
| 导入 | `deleteVfsPrefix(域根)` | 子树物理前缀 |
| 导出 entry | 相对域根 | 相对 `directoryPath` |
| Desktop | Header「⋯」导入/导出 | 目录行（含 `/`）+ blank 右键；Header 去掉 ZIP |
| Desktop IPC | `VfsZipRequest` 仅 scope + `confirmed?` | + `directoryPath?: string` |
| Mobile | 路径栏 ZIP 图标 | 更多导入；目录项导出；去图标 |
| CLI | 无 path | `--path` 默认 `/` |

可复用：`scanContents(prefix)`、`listEntriesUnderPrefix`、`deleteVfsPrefix`、`toPhysicalPath`、Phase A→B 校验顺序。

## 总体方案

### API

```ts
type ZipPathOptions = { directoryPath?: string }; // default "/"

export(scope: VfsScope, options?: ZipPathOptions): Promise<Uint8Array>
import(
  scope: VfsScope,
  zipBytes: Uint8Array,
  options: VfsZipImportOptions & ZipPathOptions,
): Promise<void>
```

Desktop IPC（与 Core 对齐）：

```ts
// apps/desktop/shared/ipc-types.ts
export type VfsZipRequest = VfsScopeRequest & {
  readonly confirmed?: boolean;
  readonly directoryPath?: string; // 本 feature 新增；缺省 ≡ "/"
};
```

### 路径规则

1. 规范化 `directoryPath`（须为绝对逻辑路径，默认 `/`）。  
2. **导出**：`physicalSub = toPhysicalPath(scope, directoryPath)` → scan 子树 → entry = 相对 `directoryPath` 的路径（无 leading `/`）。  
3. **导入**：validate entries（相对子树，禁 `..`）→ 执行下方「带域根前缀」判定 → `logical = join(directoryPath, entry)` → 事务内 `deleteVfsPrefix(physicalSub)` → mkdir/write。  
4. 删除后若目标目录行被删：对非文件结果 **`ensureEmptyDirectoryRow(directoryPath)`**（保证目录仍存在，即使 ZIP 空）。  
5. 目标 path 已存在且为 **file** → 失败。  
6. 逃出子树（`..` 等）→ 抛错，不写库。

### 外部 ZIP「带域根前缀」可执行判定（硬失败，不剥前缀）

**产品承诺**：本 feature **绝不**对 ZIP entry 做自动剥前缀；判定为「带目标目录名错误嵌套」时一律 `INVALID_PATH`，用户须自行打出相对目标目录的 ZIP 后再导入。

**算法**（在 Phase A 路径校验阶段、任何 `deleteVfsPrefix` / 写库之前执行）：

```
输入：directoryPath（已规范化）、entries（每个 entry 已去掉 leading `/`，且已拒绝含 `..` 的路径）
令 base = basename(directoryPath)   // 例：directoryPath=/a → base="a"；directoryPath=/a/b → base="b"
令 fileOrDirEntries = entries 中非空路径（忽略仅表示目录且无实质路径的空串若有）

若 directoryPath === "/"：
  → 本判定跳过（域根导入不因「首段==某目录名」拒绝；仍受既有 UTF-8 / `..` / 域内合法路径规则约束）

否则（directoryPath ≠ "/"）：
  若 fileOrDirEntries 非空
     且 ∀ e ∈ fileOrDirEntries：e 的首段（按 `/` 分割的第一段）=== base
  则 → 抛 INVALID_PATH（消息提示：ZIP 似以目标目录名作根前缀，请使用相对该目录的内容，系统不会自动剥离）
  否则 → 通过本判定，继续 join(directoryPath, entry)
```

**正例（应成功导入）**

| directoryPath | ZIP entries（示意） | 说明 |
|---------------|---------------------|------|
| `/a` | `foo.txt`, `bar/x.md` | 相对 `/a`，首段不是 `a` |
| `/a` | `readme.md` | 单文件，首段 ≠ `a` |
| `/` | `a/foo.txt`, `b/y.md` | 域根；本判定跳过 |
| `/a/b` | `c.txt` | 首段 `c` ≠ basename `b` |

**反例（应 `INVALID_PATH`，且不写库、不删子树）**

| directoryPath | ZIP entries（示意） | 说明 |
|---------------|---------------------|------|
| `/a` | `a/foo.txt`, `a/bar.md` | 全部首段 == `a`（basename）；典型「整域导出后再导入子目录」误用 |
| `/a` | `a/`（目录 entry）, `a/x.txt` | 全部有效 entry 首段仍 == `a` |
| `/chap3` | `chap3/outline.md` | 同上，basename 匹配即拒 |
| `/a/b` | `b/c.txt`, `b/d.md` | basename=`b`，全部首段 == `b` |

**明确不做**：检测到上述模式后**不**剥掉首段 `base/` 再导入；不静默写成 `directoryPath/base/...` 嵌套（虽技术上 join 合法，但属用户意图错误，必须失败）。

### Desktop 入口（目录行 + blank）

写死：

| 触发面 | `directoryPath` | 菜单项 |
|--------|-----------------|--------|
| 资源管理器 **目录行**（含域根行 `/`） | 该目录逻辑路径 | **导入 ZIP**、**导出 ZIP** |
| 资源管理器 **空白区**（`kind: blank`） | **`/`**（≡ 对域根子树） | **导入 ZIP**、**导出 ZIP** |

文件行不提供 ZIP 菜单。Header「⋯」整域 ZIP **移除**（避免双入口）。

### 文案

- 确认：「将覆盖目录 `{path}` 下的全部文件，同级其他内容不受影响」；`path=/` 时可写「当前目录（工作区根）」。

## 最终项目结构

```
packages/core/src/domain/vfs/
  ports/vfs-zip-io.port.ts
  logic/vfs-zip-path.ts          # 相对子树 helper
  logic/vfs-zip-validate.ts      # 相对根校验
packages/core/src/service/vfs/impl/vfs-zip-io.service.ts
packages/core/test/vfs/vfs-zip-io.test.ts
apps/desktop/.../workspace-context.ts, App.tsx, WorkspaceHeaderActions.tsx
apps/desktop/shared/ipc-types.ts, vfs-zip.service.ts
apps/mobile/.../VfsFileManager.tsx, vfs-zip.service.ts
apps/cli/src/vfs/commands/{export,import}-zip.ts
```

## 变更点清单

| 区域 | 变更 |
|------|------|
| Core port + service + path/validate | `directoryPath`；子树 delete/scan；「带域根前缀」硬失败算法 |
| Core 测试 | `/` 兼容 + `/a` 兄弟保留 + 前缀判定正反例 |
| Desktop IPC | **`VfsZipRequest` 增加 `directoryPath?: string`**（默认语义由 Core 视为 `/`；export/import 共用） |
| Desktop UI | 目录行（含 `/`）+ blank≡`/` 右键提供导入/导出 ZIP；移除 Header ZIP |
| Mobile 菜单改挂 + 去图标 | 更多=导入；目录项=导出 |
| CLI `--path` + e2e | |

## 详细实现步骤

- Step 1 — phase-zip-core — blocking: yes — qa: auto：Core API + 单测 T-Z*。  
- Step 2 — phase-zip-cli — blocking: yes — qa: auto：CLI `--path`；默认 `/` 旧 e2e 仍绿。  
- Step 3 — phase-zip-desktop — blocking: yes — qa: auto/manual：目录行（含 `/`）+ blank≡`/` 右键接入；`VfsZipRequest.directoryPath`；Header 去 ZIP；确认文案。  
- Step 4 — phase-zip-mobile — blocking: yes — qa: manual_user：更多导入、目录项导出；去顶栏图标（与 batch 菜单协调）。  
- Step 5 — phase-zip-manual — blocking: no — qa: manual_user：子树 round-trip 手测；含「带域根前缀」ZIP 应失败。

## 测试策略

### 测试用例

- T-Z1 — blocking: yes — Step 1：`directoryPath` 缺省 ≡ `/`，行为同旧 Z3。  
- T-Z2 — blocking: yes — Step 1：导出 `/a`，ZIP 无 `/b` 内容。  
- T-Z3 — blocking: yes — Step 1：导入 `/a` 后 `/b` 不变，`/a` 与 ZIP 一致。  
- T-Z4 — blocking: yes — Step 1：`confirmed:false` / 非法 UTF-8 → 子树与兄弟均不变。  
- T-Z5 — blocking: yes — Step 1：恶意 `../` entry → 失败不删。  
- T-Z6 — blocking: yes — Step 1：`directoryPath=/a` 且 entries 全为首段 `a/...` → `INVALID_PATH`，子树不变（不剥前缀）。  
- T-Z7 — blocking: yes — Step 1：`directoryPath=/a` 且 entries 为 `foo.txt`（首段 ≠ `a`）→ 导入成功。  
- T-Z8 — blocking: yes — Step 2：CLI `--path /a` e2e 兄弟保留。  
- T-Z9 — blocking: yes — Step 3（manual 可）：Desktop 域根目录行与 blank 均可打开导入/导出 ZIP，且 `directoryPath` 均为 `/`。

## 兼容性 / 迁移

- 旧调用方不传 path → 行为不变。  
- UI 默认从「整域心智」改为「当前/指定目录」；根目录操作等价旧整域文件树。

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 外部 ZIP 带目标目录名作根前缀 | 上节硬失败算法 + `INVALID_PATH`；**不剥前缀** | — |
| 与 batch 同时改 Mobile 菜单 | 同 PR 或先 ZIP 后 batch | 分 feature revert |
| `deleteVfsPrefix` 删掉目标目录行 | ensure 重建 | — |

**回滚**：Core 保留 `directoryPath` 无害；UI 可暂时恢复 Header 入口。
