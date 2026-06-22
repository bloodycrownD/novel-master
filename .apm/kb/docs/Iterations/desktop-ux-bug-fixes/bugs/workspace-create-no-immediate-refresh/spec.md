---
date: 2026-06-22
---

# workspace-create-no-immediate-refresh Bug 修复规格（SPEC）

> **父级 PRD**：[../../prd.md](../../prd.md)  
> **Bug PRD**：[prd.md](./prd.md)  
> **修复提交**：`6bfe4805` @ `feature/desktop-ux-bug-fixes`

## 根因分析

`apps/desktop/renderer/App.tsx` 中工作区上下文菜单操作分两条路径：

| 路径 | 触发操作 | 成功后 refresh |
|------|----------|----------------|
| `handleWorkspaceAction` | include 切换等 direct action | ✅ `refreshWorkspaceTrees()` |
| `handleWorkspaceConfirm` | 删除 | ✅ `refreshWorkspaceTrees()` |
| `handleWorkspacePromptConfirm` | **新建文件/文件夹、重命名** | ❌ **缺失** |

`handleWorkspacePromptConfirm` 在 `createWorkspaceEntry` / `renameWorkspaceEntry` 返回 `ok` 时仅处理失败 toast，**未** 递增 `treeRefreshToken`，导致 `WorkspaceTree` 不 reload。

切换会话会 remount / 变更 scope 触发 `WorkspaceTree` 的 `reload()`，故表现为「退出再进入才显示」。

## 修复方案

在 `handleWorkspacePromptConfirm` 成功分支调用 `refreshWorkspaceTrees()`（消费方 ① UI token，不 `markDirty`），与 delete / Bug 3 刷新策略一致。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `apps/desktop/renderer/App.tsx` | `handleWorkspacePromptConfirm`：`result.ok` → `refreshWorkspaceTrees()`；deps 加入 `refreshWorkspaceTrees` |

## 详细改动说明

```typescript
if (result.ok) {
  refreshWorkspaceTrees();
} else {
  showToast(result.message);
}
```

- 成功时不 toast（与 delete 一致）
- 未改 `workspace-actions.ts`（IPC 层正常）
- 未改 Mobile

## 测试策略

### 自动化

- `npm run build -w @novel-master/desktop` — 须通过
- VFS 工具单测（`vfs-tree-utils`、`vfs-path`）— 须通过
- 无专用 UI 测试；依赖手工验收

### 测试用例

| ID | 操作 | 预期 |
|----|------|------|
| T1 | 新建文件 | 树立即出现新文件 |
| T2 | 新建文件夹 | 树立即出现新目录 |
| T3 | 重命名 | 树立即显示新名 |
| T4 | 新建失败（重名） | toast 错误，树不变 |

## 风险与回滚方案

| 风险 | 说明 |
|------|------|
| 低 | 单行改动，与既有 refresh 模式一致 |
| 回滚 | revert commit `6bfe4805` |
