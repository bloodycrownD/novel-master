---
date: 2026-06-29
dependency: Iterations/vfs-unified-root/prd.md
---

# empty-storage-root-list-not-found Bug PRD

## 背景

Mobile「项目工作区」打开空项目时出现加载失败 toast。根因在 Core VFS `list` 对 scope 虚拟挂载点的处理与 `mkdir`/`write` 不一致，属于 `06e91720` 引入的回归。

## 现象描述

- 打开空项目的「项目工作区」Tab
- 界面显示「空目录」，底部 toast：**加载失败：Path not found: /projects/{projectId}/template**
- 新建文件/文件夹底层可写，但进页即报错，删光内容后再次 list 也会报错

## 复现步骤

1. 新建项目（不 pull 模板、不写入任何文件）
2. Mobile 进入该项目 →「项目工作区」Tab
3. 观察 toast 与空目录 UI

Core 单测等价复现：

- `scoped-vfs.service.test.ts`「isolates global template from project」
- `chat.services.test.ts`「empty template yields empty session vfs」

## 预期行为

- 空项目/空 session/空 global template 的 `list('/')`（经 ScopedVfs 映射后）应返回 **空数组 `[]`**
- 不抛 `NOT_FOUND`，不显示「加载失败」toast
- 用户可正常新建文件/文件夹并刷新列表

## 实际行为

- `DefaultVfsService.list()` 对物理路径 `/projects/{id}/template`（及同类 storage root）在无 vfs_entry 行且无子项时抛 `NOT_FOUND`
- Mobile `VfsFileManager.reload()` 捕获后 toast「加载失败」

## 影响范围

| 范围 | 说明 |
|------|------|
| Mobile 项目工作区 | 空项目必现 |
| Mobile / Desktop 会话工作区 | 空 session 同样受影响 |
| Global template | 空 global 列表同样受影响 |
| mkdir/write | **不受影响**（已有 storage root 豁免） |

## 验收标准

- [ ] 空项目打开「项目工作区」无错误 toast，显示空目录
- [ ] 可新建文件/文件夹，列表正常刷新
- [ ] `scoped-vfs.service.test.ts`、`chat.services.test.ts` 相关用例通过
- [ ] 已删除的普通目录 list 仍抛 `NOT_FOUND`（`06e91720` 行为保留）

## 回归测试要点

- 空 storage root：`/template`、`/projects/{id}/template`、`/projects/{id}/sessions/{sid}` → `list` 返回 `[]`
- 删除后 list 非 storage root 目录 → 仍 `NOT_FOUND`
- 非空项目/会话 list 行为不变
