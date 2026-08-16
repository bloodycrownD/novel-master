---
date: 2026-08-16
dependency: []
---

# replace-quick-sqlite：移动端 SQLite 驱动替换 PRD

> **边界**：本文件为产品需求（PRD），不含 API 映射、adapter 重写细节等技术 SPEC——见 [spec.md](./spec.md)。
> **关联背景**：[sql-cr-audit-2026-08](../sql-cr-audit-2026-08/findings.md)（SQL 全量 CR，其修复的真机验证被本问题阻塞）。

## 背景

Novel Master 移动端使用 `react-native-quick-sqlite@8.2.7` 作为 SQLite 驱动。该库已被作者官方废弃（README 声明推荐迁移至后继库），且在真机上暴露出两类影响可用性的原生层故障：

1. **升级 migration 崩溃**：`table-constraints-v1b` migration 在存量库（约 25MB、2192 条消息）上重建表时，事务累计写入约 3MB 后稳定报 `disk I/O error`，bootstrap 失败、应用无法进入。桌面端（better-sqlite3）对同一数据 100% 成功，问题只出现在移动端原生层。
2. **部分启动闪退**：同一场景下部分启动出现 `SIGSEGV`（原生层内存损坏），表现为应用闪退循环。

后果：任何携带大事务 migration 的版本在真机上不可交付——这直接阻塞了 SQL CR 修复集成分支的验证与合并。

## 根因概述

外部社区已定位同源问题（op-sqlite issue #137，引用 quick-sqlite 同源 issue #80）：Android 12 及以下，大事务触发 SQLite 写临时文件时，部分设备的临时目录不可写导致 `disk I/O error`。quick-sqlite 已废弃不会修复；其后继库 op-sqlite 提供编译期解法（`SQLITE_TEMP_STORE=2`）。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 替换废弃驱动 | 移动端 SQLite 驱动为积极维护的库（op-sqlite），以平行新包 `tdbc-driver-op-sqlite` 方式接入；旧驱动 `tdbc-driver-rn` 零改动保留作回滚线 |
| 真机 migration 可交付 | 此前 100% 崩溃的存量库 migration（25MB）在真机完整跑通，行数守恒，数据零丢失 |
| 存量用户无感升级 | 升级后既有库文件原地可用，不出现「升级即丢库」；备份导出/导入不受影响 |
| 改动收敛与可回滚 | core / desktop / cli / 旧驱动包零改动；移动端切换面仅两处 import + driver 名，回滚即换回 |

## 非目标

- 不修改 `tdbc-driver-rn` 旧包、不删除 quick-sqlite 依赖（回滚线；验证通过后的删除属后续 cleanup 迭代）
- 不引入 WAL journal 模式（与崩溃无关，保持最小变量）
- 不优化既有 migration 的 quick-sqlite 规避逻辑（分块搬运、冗余索引删除等继续生效，是否放开留待后续）
- 不做 iOS 侧验证（项目现状 iOS 目录未验证，本次范围 Android 真机）
- 不做 blob 绑定防御逻辑（`normalizeQuickSqliteBindings`）的简化

## 用户故事

- 作为存量移动端用户，我升级 App 后原有的会话与文件数据完整保留，应用能正常进入。
- 作为移动端用户，我在大库上使用应用（读历史消息、发消息、备份恢复）不出现闪退或数据错误。

## 验收口径

真机（Android）为最终验收环境：migration 完整跑通 + 读写回归 + 备份导出导入。详见 spec 测试策略（T-MIG1 / T-MIG2 为硬门槛）。
