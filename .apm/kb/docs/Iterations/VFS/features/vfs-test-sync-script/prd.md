# vfs-test-sync-script PRD

## 背景与变更动机

原 VFS 迭代（`.apm/kb/docs/Iterations/VFS/prd.md`）明确**不包含**真实 OS 文件系统后端。开发者在验证 CLI 与 VFS 行为时，需要在 **SQLite 内联 VFS** 与 **Windows 本地目录** 之间手工对照内容，流程繁琐。

本次变更为 VFS 迭代内的 **feature 级补充**，提供 **极简测试脚本**：

| 动机 | 说明 |
|------|------|
| CLI / 手工验证 | 改完 VFS 或磁盘后，一条命令全量对齐 |
| 本地开发体验 | `watch` 模式下改哪边、哪边为权威，自动 force 同步 |
| 集成测试基础 | 测试步骤里可编排 `push` / `pull`，无需 baseline 状态机 |

**约束**：dev-only 脚本，不进入 CLI，不修改 core / CLI 公开 API。

## 范围变更说明（相对原需求）

### 新增（简化后）

- 独立 Node 脚本包（`scripts/vfs-test-sync/`），直连 `VfsService` + 本地文件 IO。
- **仅三种命令**，且 **push / pull 均为 force 全量同步**（无增量、无校验）：
  - **`push`**：VFS 为权威 → 覆盖镜像目录（写文件、删磁盘孤儿）
  - **`pull`**：磁盘为权威 → 覆盖 VFS prefix 下内容（写 VFS、`versionCheck: false`、删 VFS 孤儿）
  - **`watch`**：监听两侧变动；**磁盘变 → `pull`**，**VFS 变 → `push`**（带防抖与回声抑制）
- **不维护** `.sync-state.json`、version baseline、dry-run、漂移报错。

### 相对上一版 PRD 的收缩

| 移除 | 原因 |
|------|------|
| 非 force push/pull | 测试场景下 force 足够 |
| `.sync-state.json` | 无 baseline 需求 |
| dry-run | 简化 |
| baseline / drift 报错 | 用户明确测试用、不校验 |
| `force --from` 子命令 | 合并进 `push` / `pull` 语义 |

### 仍不包含

- CLI 子命令、RN、云同步、冲突合并 UI
- 生产级双向同步、oldString 校验
- 修改 `packages/core` / `apps/cli` 公开接口

### 实现方式

直连 `createVfsService`（不子进程调 CLI）。`watch` 使用 Node 侧磁盘监听 + VFS 轮询（SQLite 无文件事件）。

## 影响模块与接口

| 模块 | 影响 |
|------|------|
| `packages/core` | 无公开 API 变更；脚本消费 `VfsService` |
| `apps/cli` | 无变更 |
| `scripts/vfs-test-sync/` | 新增脚本包 |
| 根 `package.json` | workspaces 增加 `scripts/*`（可选便捷 npm script） |

### 路径映射

- `MIRROR_ROOT` / `--mirror`：本地镜像目录
- `VFS_PATH_PREFIX` / `--prefix`：VFS 逻辑前缀（默认 `/`）
- `mirrorRoot/foo/bar.md` ↔ VFS `/foo/bar.md`（SPEC 锁定规范化规则）

### 命令语义

| 命令 | 权威 | 行为 |
|------|------|------|
| `push` | VFS | glob prefix 下全部 path → 写磁盘；删除磁盘多余文件 |
| `pull` | 磁盘 | 递归读镜像文件 → 写 VFS；删除 VFS prefix 下多余 path |
| `watch` | 触发侧 | 磁盘事件 → `pull`；VFS 轮询检测到变 → `push` |

**watch 约束（测试级）**：

- 防抖（默认 300ms，可 `--debounce-ms`）
- 脚本自身写入期间 **抑制** 触发，避免 push→pull→push 回声
- 同一防抖窗口内两侧都变：**先 `pull` 再 `push`**（磁盘优先，SPEC 锁定）
- 不保证「两边同时改」下的语义正确性；仅服务于本地测试

## 验收标准

### 脚本可运行

- **Given** `--db` / `NOVEL_MASTER_DB`、`--mirror`  
  **When** 执行 `push` / `pull` / `watch`  
  **Then** exit 0 成功；参数错误 exit 2；IO/VFS 错误 exit 1。

### push（force from VFS）

- **Given** VFS 有 `/a.md`，磁盘为空或内容不一致  
  **When** `push`  
  **Then** 磁盘 `a.md` 与 VFS 一致。

- **Given** VFS 无 `/b.md`，磁盘仍有 `b.md`  
  **When** `push`  
  **Then** 磁盘 `b.md` 被删除。

### pull（force from disk）

- **Given** 磁盘有 `c.md`，VFS 无  
  **When** `pull`  
  **Then** VFS 可读 `/c.md`。

- **Given** VFS 有 `/d.md`，磁盘无  
  **When** `pull`  
  **Then** VFS `/d.md` 被删除。

### watch

- **Given** `watch` 运行中  
  **When** 修改磁盘文件  
  **Then** 防抖后执行 `pull`，VFS 与磁盘一致。

- **Given** `watch` 运行中  
  **When** 通过 CLI 修改 VFS  
  **Then** 轮询检测到变后执行 `push`，磁盘与 VFS 一致。

### 边界

- 空目录：忽略；不同步为 VFS path。
- 编码：UTF-8；不 normalize 换行。
- 镜像目录内忽略 `.sync-state.json` **不再适用**（无 state 文件）；仅忽略非业务约定由 SPEC 说明（如可选忽略 `.git`）。

## 测试用例

| ID | 场景 | 步骤 | 期望 |
|----|------|------|------|
| T1 | push 写入 | VFS write → `push` | 磁盘一致 |
| T2 | push 删孤儿 | 磁盘多文件 → `push` | 磁盘孤儿删除 |
| T3 | pull 写入 | 磁盘新建 → `pull` | VFS 可读 |
| T4 | pull 删孤儿 | VFS 多 path → `pull` | VFS 孤儿删除 |
| T5 | round-trip | `push` → 改磁盘 → `pull` | VFS 与磁盘一致 |
| T6 | watch 磁盘 | `watch` → 改磁盘 | 自动 pull |
| T7 | watch VFS | `watch` → CLI 改 VFS | 自动 push |
| T8 | CLI 联调 | `push` → `novel-master vfs read` | 与磁盘一致 |

## 后续

- 技术方案见 [spec.md](./spec.md)
