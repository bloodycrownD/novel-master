---
date: 2026-09-08
---

# CR Fix Spec: huge-card-import-crash 分支收尾

## 元信息
- repo: .worktree/huge-card-import-crash
- base_sha: b442d397
- head_sha: 27be71c4（评审基线）；救援模式已于 365959cb revert，CR-1 在其后执行
- prd_path: docs/Iterations/character-card-import/bugs/huge-card-import-crash/prd.md
- spec_path: 同目录 spec.md；docs/Iterations/workplace-eval-memo/spec.md
- review_round: 1 / dag_version: 1
- 状态：fix-spec-ready

## Must-fix（按 P0 → P1 → P2）

### CR-1 [P2] 超大文件占位块的 mtimeMs=0 被渲染成 1970 假时间戳随提示词送模型
- 维度：B（正确性，波及提示词质量）
- 文件：`packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts`（占位分支返回 `mtimeMs: 0`）；`packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts` + `vfs-entry.port.ts` + `packages/core/src/domain/vfs/model/vfs-content-size.ts`（`VfsContentSize` 投影）；出口 `packages/core/src/domain/workplace/logic/workplace-display.ts` renderFileBlock
- 问题：占位路径 `mtimeMs: 0` → `formatLocalMtime(0)` 渲染为本地 1970-01-01，随常驻前缀每轮送给模型——确定性假数据。
- 改法：`findContentSizeByPath` 的探测 SQL 本就在 SELECT `vfs_entry` 行，把 `mtime_ms` 加进投影；`VfsContentSize` 两个变体各加 `readonly mtimeMs: number`；`probeOversizePlaceholder` 携带真实 mtime 返回；`loadOrFillFileCache` 占位分支用真实值替代 0。
- 验收/测试：`load-or-fill-file-cache.test.ts` 两处 `assert.equal(result.mtimeMs, 0)` 改断言真实 mtime；`assemble-workplace-display.test.ts` 补断言占位块 `createdAt/updatedAt` 不以 "1970" 开头且与行 mtime 一致；core 全量回归绿。
- 来源：review diff 轮 1

## Spec deviations
- SD-1 救援模式无文档留痕 → **fixed**：用户拍板救援模式不留在主干，已 revert（365959cb），源码以分支 `rescue-mode-source`（=8c032db4）保留，需要时 cherry-pick 到临时分支/worktree 翻开关打包。

## Open questions / 待拍板
- L1 缓存条目无淘汰策略（内层 Map 随访问 scope 单调增长，mobile 单 conn 生命周期内不回收）——spec 已拍板零写钩子，未认定有问题，暂不动。
- 导入输入闸排在 confirm 校验之后（超大未确认卡先报 NOT_CONFIRMED 而非 TOO_LARGE）——无实际影响，可选优化。

## 已豁免（用户确认不修）
- CR-2 救援屏硬编码色板绕主题令牌——随救援模式整体 revert，不存在了。

## 合并后 QA（manual_user）
- workplace-eval-memo spec Step 6：真机毒库连续进出工作区/规则保存，体感二次进入明显快于首进（release 包）。

## K 节建议（下游执行时闭合）
1. CHANGELOG 无 Unreleased 段：导入拒收报错、超大文件占位、大目录卡顿修复均为用户可见行为，发版前按 changelog skill 补段。
2. 工作区 `package-lock.json` 未提交漂移为 npm install 副产物：还原，勿随 add -A 入库（#23）。
3. CR-1 执行时顺带跑 `npm run build -w @novel-master/core` 重建 dist（mobile 经 metro 消费）。

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | yes |
| fix_spec_path | 本文件 |
| dag_version / review_round | 1 / 1（diff 模式单轮 + 用户决策豁免） |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 0 / 1 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none（SD-1 已 fixed） |
| C-orch | N/A（首轮已核查单点装配无平行路径） |
| C 类合并后 QA | 真机体感 spotcheck（manual_user） |
