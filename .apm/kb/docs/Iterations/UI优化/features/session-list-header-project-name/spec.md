---
date: 2026-06-29
---

# 会话列表顶栏显示项目名称 实现规格（SPEC）

## 根因 / 方案摘要

项目名仅在 `ChatSessionListPanel.projectBanner` 展示；`AppHeader` 列表态固定读 `header-config` 的「会话」。方案：删除 banner；经 `HeaderContext` 注入 `projectName`；`AppHeader` 列表态优先显示项目名。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `navigation/types.ts` | `ChatHeaderContext.projectName?: string` |
| `ChatTabScreen.tsx` | `setChat({ projectName: scope.currentProject?.name })` |
| `AppHeader.tsx` | 列表态 `title = chat.projectName ?? base.title` |
| `ChatSessionListPanel.tsx` | 删除 `projectBanner`；移除 `currentProject` / `onOpenProjectDrawer` props |
| `app-header.test.tsx` | 新增 4 用例 |

## 详细改动说明

### AppHeader 标题分支（chat pageKey）

```text
conversation     → sessionTitle ?? '会话'
sessionListPanel=template → '项目工作区'
sessions + sessions → projectName ?? '会话'
```

### 数据流

`useChatTabScope.currentProject` ← `runtime.projects.get(projectId)` → `setChat.projectName` → `AppHeader`

## 测试策略

### 测试用例

- 列表 + projectName → 项目名
- 列表 + 无 projectName → 「会话」
- template 分段 → 「项目工作区」
- conversation → sessionTitle

```bash
npm test -w @novel-master/mobile -- app-header.test.tsx
npm run build -w @novel-master/mobile
```

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 与 mobile-app C1/B2 文档不一致 | 本迭代 PRD 显式修订 IA |
| 长项目名截断 | AppHeader 已有 `numberOfLines={1}` |

**回滚**：revert commit `0de08bbd` 即可。
