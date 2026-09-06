---
date: 2026-09-06 13:05
title: 第三轮 10-tag migration 清理（orphan-revision-gc / table-constraints 退役，基线升至 v1.4.28）
keywords: schema migration, 退役, baseline, 最低支持版本, v1.4.28, assertMinimumBaseline
abstract: 按用户指示清理距当前 10 个 tag（v1.5.2）之前上线的 migration：orphan-revision-gc-v1 与 table-constraints-v1b（均 v1.4.28 首发），最低支持版本 v1.4.27→v1.4.28，沿 f104af1 先例模式。
---

user:
清理下距离现在 10 个 tag 之前的 migration。

assistant:
先例 f104af1 模式复刻。盘点：4 条在册 migration 中 orphan-revision-gc-v1 与 table-constraints-v1b 均 v1.4.28 首发（早于 10-tag 基线 v1.5.2）→ 退役；usage-cache-model-backfill-v1（v1.5.4）与 retire-pref-session-fs-version-check-v1（未发布）保留。退役动作：(1) BASELINE_MIGRATION_IDS 扩至 11 条字面量（applied 记录即通行证）；(2) 新增 hasLegacyVfsRevisionShape 探针（vfs_revision 存在但未 WITHOUT ROWID = 未走 table-constraints-v1b，判据照搬原迁移自探测，保守方向 false）——堵住「v1.4.27 同代库带旧 baseline id 过 some() 门却缺两迁移」的缝，这是本轮关键：两迁移恰好都在 v1.4.28 上线，形态探针把 era 边界封死；(3) ORPHAN_REVISION_GC_SQL 从 migration 文件迁入 sqlite-vfs-revision.repository（运行期 deleteGlobalOrphans 独占，语义不变）；(4) 删 2 migration 源文件 + table-constraints.test.ts（693 行直测，约束形态由 canonical DDL 覆盖）；(5) fail-fast 文案与模块头 v1.4.27→v1.4.28；SCHEMA_BOOT_VERSION 不动（无 DDL 变更）。core 1823 绿（-5 = 删掉的直测用例），tsc 0 错，dist 重建，CHANGELOG 补条目（沿先例措辞）。
