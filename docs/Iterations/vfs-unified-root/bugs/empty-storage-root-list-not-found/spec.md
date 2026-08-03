---
date: 2026-06-29
---

# empty-storage-root-list-not-found Bug 修复规格（SPEC）

> **父级 PRD**：[../../prd.md](../../prd.md)  
> **Bug PRD**：[prd.md](./prd.md)  
> **修复提交**：`6c040011` @ `fix/empty-storage-root-list-not-found`

## 根因分析

`DefaultVfsService.list()`（`vfs.service.ts`）在 `06e91720` 为 F4 集成测增加逻辑：当 `normalized !== "/"` 且无 directory row、无子项时抛 `NOT_FOUND`。

ScopedVfs 将各 scope 逻辑 `/` 映射为物理 storage root：

| Scope | 物理挂载点 |
|-------|-----------|
| global | `/template` |
| project | `/projects/{id}/template` |
| session | `/projects/{id}/sessions/{sid}` |

新建项目/会话时 **不** seed 挂载点 directory row。`isStorageRootParent()`（`parent-dir.ts`）已将这些路径定义为虚拟父目录，`mkdir` 与 `ensureParentDirectories` 已豁免，但 `list` 未豁免 → 空挂载点必抛错。

调用链（Mobile）：

`VfsFileManager.reload()` → `vfs.list('/')` → `ScopedVfsService.list` → `DefaultVfsService.list('/projects/{id}/template')` → `NOT_FOUND` → toast「加载失败」

## 修复方案

在 `list()` 的 NOT_FOUND 检查条件中增加 `!isStorageRootParent(normalized)`：虚拟 storage root 无 row 时视为空目录，返回 `entries`（通常 `[]`），与 `mkdir` 豁免一致。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `packages/core/src/service/vfs/impl/vfs.service.ts` | `list()` NOT_FOUND 检查排除 `isStorageRootParent` |
| `packages/core/test/vfs/default-vfs.service.test.ts` | 新增「空 storage root 目录 list 返回 []」回归用例 |

## 详细改动说明

```typescript
if (normalized !== "/" && !isStorageRootParent(normalized)) {
  const entry = await this.repo.findByPath(normalized);
  if (entry == null && entries.length === 0) {
    throw vfsNotFound(normalized);
  }
}
```

- 未改 Mobile/Desktop UI（修复 Core 后自动消除 toast）
- 未改 `project.create()` seed 逻辑（与虚拟 root 设计一致）
- 已删普通目录仍抛 `NOT_FOUND`（非 storage root 路径不受影响）

## 测试策略

### 测试用例

| ID | 场景 | 预期 |
|----|------|------|
| T1 | `list("/template")` 空 global | `[]` |
| T2 | `list("/projects/{id}/template")` 空 project | `[]` |
| T3 | `list("/projects/{id}/sessions/{sid}")` 空 session | `[]` |
| T4 | scoped project 空 list | `[]`（`scoped-vfs.service.test.ts`） |
| T5 | 空 template 的 session list | `[]`（`chat.services.test.ts`） |
| T6 | 已删除普通目录 list | `NOT_FOUND`（既有行为） |

### 自动化命令

```bash
cd packages/core
npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test \
  test/vfs/scoped-vfs.service.test.ts \
  test/chat/chat.services.test.ts \
  test/vfs/default-vfs.service.test.ts
npm run build -w @novel-master/core
```

## 风险与回滚方案

| 风险 | 说明 |
|------|------|
| 低 | 单行条件扩展，与既有 `isStorageRootParent` 语义对齐 |
| 误把已删 storage root 当空目录 | storage root 为固定路径模式，不会被 delete 整棵移除（delete 删子树，不删挂载点本身） |
| 回滚 | revert `6c040011` |
