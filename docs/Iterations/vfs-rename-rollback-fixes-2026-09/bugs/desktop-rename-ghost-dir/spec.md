---
date: 2026-09-15
agile_trace: true
---

# desktop-rename-ghost-dir 实现规格（SPEC）

## 根因 / 方案摘要

四个同族缺陷：①core 空目录重命名两层误判（服务层目录判定恒 false + repo 层改名后死检查）；②desktop 目录重命名不迁移 workplace 规则（core 三层早有 `renameRulesUnderLogicalPrefix`，desktop handler 缺调用）；③core 目录集合把残留规则路径整链渲染成幽灵目录（无兜底过滤）；④desktop renderer 失败分支直出英文原文（core 已有 `formatVfsErrorForUser` 未接入）。

## 变更点清单

| 提交 | 内容 |
|------|------|
| `fdaeaade` | `handleVfsRename` 双分支补规则迁移：抽 `findEntryKindBeforeRename`（父目录 list 探 kind）；直调分支 `renameVfsDirectory` 成功后调 `renameRulesUnderLogicalPrefix`（排布对齐 `handleVfsDelete`）；session 分支把 kind 判定提前到 `executeSessionUserVfsOp` 之前（execute 后旧路径消失无法判定），目录才迁移 |
| `4b601803` | core `loadContextMetadata`：`listDirectoryPathsUnderPrefix` 查询提前构造 `dirPathSet`（零新增 SQL），新增模块级 `filterGhostConfiguredPaths` 按「根保留 / dirRule：目录行在或前缀下有 live 文件 / fileRule：文件在」过滤 configuredPaths；dirRules/fileRules 原行不动 |
| `5a1b2e4a` | renderer `workspace-actions.ts`：`renameWorkspaceEntry`/`createWorkspaceEntry`/`deleteWorkspaceEntry` 的 VFS 失败分支改走 `vfsActionErrorMessage`（`formatVfsErrorForUser` 经 `@shared/logic/vfs` 再导出），`ALREADY_EXISTS` → 「名称不能重复」对齐 mobile；非 VFS 动作（setDirRule 等）不套用 |
| `59851835` | 空目录重命名：`moveVfsPath` 目录判定改用 `read(from)` 抛 `IS_DIRECTORY` 直接判目录移动（空目录也是真实目录），`NOT_FOUND` 才走 list 兜底（覆盖「无 directory 行但有子项」），list 为空维持 NOT_FOUND（幽灵路径不放宽）；`renamePrefixInScope` 根行存在性改用根 UPDATE 的 `changes` 判定，删掉改名后按旧路径 SELECT 的死检查 |

## 详细改动说明

- **规则迁移复用 core 现成能力**：`WorkplaceService.renameRulesUnderLogicalPrefix`（service port → 实现 → repo 三层齐备，dir_rule/file_rule 各一条批量 UPDATE 同一事务）。desktop `wt = rt.workplace(scope)` 直接可调，无需装配改动。文件重命名不迁移（与 mobile 口径一致）。
- **幽灵过滤锚定 live VFS 状态**：configuredPaths 逐条判定，无需传递闭包；文件树列表与 `$filetree` 宏同源 `allDirs`，过滤后同步去幽灵；目录规则表单走 `getDirRule` 直查单行不受影响。`deleteRulesUnderLogicalPrefix` 既有测试的「幽灵可见」前置断言改为 repo 层规则行断言（兜底过滤属修复性变更）。
- **空目录第二层根因**：原 `renamePrefixInScope` 顺序为「REPLACE 子项 → UPDATE 根改名 → 按旧路径 SELECT 复核」，根已改名必然落空；改为根 UPDATE `changes` 判定后，空目录与有子项目录统一。

## 测试策略

- 结果：desktop `vfs-rename-handler.test.ts`（新增 226 行：project/chat 双 scope 迁移断言、子目录规则批量迁移、文件不迁移对照）+ `workspace-actions.test.ts`（扩展中文文案映射四用例）+ 既有 `vfs-delete-handler`/`vfs-tree-dnd-move` 全绿；core workplace 96/96、vfs 280/280、全量 2592/2592；core typecheck 通过。主代理复核 desktop 10/10、core 抽样 495/495。
- mobile typecheck 失败为既有环境问题（stash 取证报错逐字相同），本次未改 mobile。

### 测试用例

1. project 面板：建目录 + setDirRule（带可辨识排序配置）→ rename → 旧路径规则 undefined、新路径保留配置；
2. chat 面板（session 分支）：同上断言；
3. 文件 rename 不触发迁移（对照）；
4. core：残留 dirRule/fileRule（repo 直删目录行模拟）不渲染列表与文件树；目录行在的空目录仍渲染；文件隐含目录保留；
5. core：mkdir 后立即 rename 空目录成功；不存在路径 rename 仍 NOT_FOUND；目录树 rename 回归；
6. renderer：失败 payload → 中文文案（NOT_FOUND / ALREADY_EXISTS / 其它 code / 非 VFS 动作不套用）。

## 风险与回滚方案

- 各提交独立可 revert（A/B/C/D 互不依赖，B 兜底过滤独立于 A 生效）；
- `renameRulesUnderLogicalPrefix` 的 TDBC 事务不可嵌套——handler 内为首个事务调用，安全（repo 注释已载）；
- 同族遗留：`vfs-copy.ts` 的 `copyVfsPath` 存在同款 `hasDirRow` 恒 false 模式（空目录 copy 误报 NOT_FOUND），登记为后续待办，本次未修。
