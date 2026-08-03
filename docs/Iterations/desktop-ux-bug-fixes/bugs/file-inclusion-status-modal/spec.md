---
date: 2026-06-22
---

# file-inclusion-status-modal Bug 修复规格（SPEC）

> **Bug PRD**：[prd.md](./prd.md)  
> **修复提交**：`08f638af` @ `feature/desktop-ux-bug-fixes`

## 根因分析

Desktop `workspace-context.ts` 将 Core 三种 `InclusionMode`（`show` / `hide` / `auto`）映射为三个独立菜单 action，经 `runDirectWorkspaceAction` 直接写规则。`auto` 的中文标签在 Core 为 **「跟随」**，Desktop 菜单误写 **「跟随目录」**，且与 Mobile「状态变更」单一入口不一致，造成认知负担。

## 修复方案

1. 新增 `FileInclusionModal`：radio 三选一 + 保存/取消
2. 文件菜单仅保留 `{ action: "file-inclusion", label: "状态设置" }`
3. `App.tsx` 管理 modal 状态；保存后 `refreshWorkspaceTrees()`
4. `workspace-actions.ts` 提取 `saveFileInclusion`；移除 `runDirectWorkspaceAction` 中 include 分支

## 变更点清单

| 文件 | 变更 |
|------|------|
| `FileInclusionModal.tsx` | **新建** |
| `workspace-context.ts` | 菜单项合并 |
| `App.tsx` | modal 状态与渲染 |
| `workspace-actions.ts` | `saveFileInclusion`；删除 include 直调 |
| `shell.css` | modal 单选样式 |

## 详细改动说明

### FileInclusionModal

- Props：`open`, `target`（须为 file row）, `projectId`, `sessionId`, `onClose`, `onSaved`
- 选项与 IPC 映射：`show` / `hide` / `auto`
- 展示文案：**展示**、**隐藏**、**跟随**（不用「跟随目录」）

### 菜单

修复前：

```text
隐藏文件 | 展示文件 | 跟随目录 | 重命名 | 删除文件
```

修复后：

```text
状态设置 | 重命名 | 删除文件
```

## 测试策略

### 自动化

- `npm run build -w @novel-master/desktop` — 须通过

### 测试用例

| ID | 操作 | 预期 |
|----|------|------|
| T1 | 右键文件 → 状态设置 | 弹窗三单选，当前态选中 |
| T2 | 改选「展示」保存 | 行状态含「展示」 |
| T3 | grep 菜单文案 | 无「跟随目录」 |
| T4 | 目录右键 | 无「状态设置」（目录无此 modal） |

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 低 | 仅 UI 入口变更，IPC 不变 |
| 回滚 | revert `08f638af` |
