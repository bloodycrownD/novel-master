# vfs-rename-rollback-fixes-2026-09 迭代 PRD

## 背景

2026-09-15 用户上报两个 bug：①重命名文件失败（提交后弹英文报错）；②文件删除后回滚消息，被删文件不会复现。brain-storm 三路探索 + 主代理抽查确认根因后，以敏捷开发流程在同一分支（`fix/vfs-rename-rollback-2026-09`）完成修复。

## 范围

本迭代为综合修复桶，包含两个敏捷项：

| 敏捷项 | 类型 | 说明 |
|--------|------|------|
| `bugs/rollback-restore-deleted-entry/` | bug | 文件删除后回滚消息不复现——checkpoint 指针链断裂的 core 修复 |
| `bugs/desktop-rename-ghost-dir/` | bug | 重命名失败的四个同族根因——desktop 规则迁移 / core 幽灵过滤 / renderer 中文文案 / 空目录误报 |

## 不在本次范围（后续跟进）

- `vfs-copy.ts` 的 `copyVfsPath` 存在与空目录 rename 同款的 `hasDirRow` 恒 false 模式——空目录 copy 也会误报 NOT_FOUND，属同族问题未修（修复 rollback-restore 时发现，登记待办）。
- mobile typecheck 的既有环境问题（`@novel-master/core/session-run-state` dist 未构建 + `@notifee/react-native` 类型缺失），与本次改动无关（stash 取证报错逐字相同）。
