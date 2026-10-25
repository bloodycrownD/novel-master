---
date: 2026-09-12 20:05
title: 第三轮 10-tag migration 清理（orphan-revision-gc / table-constraints 退役，基线升至 v1.4.28）
keywords: schema migration, 退役, baseline, 最低支持版本, v1.4.28, assertMinimumBaseline
abstract: 按用户指示清理距当前 10 个 tag（v1.5.2）之前上线的 migration：orphan-revision-gc-v1 与 table-constraints-v1b（均 v1.4.28 首发），最低支持版本 v1.4.27→v1.4.28，沿 f104af1 先例模式。
---

user:
清理下距离现在 10 个 tag 之前的 migration。

assistant:
先例 f104af1 模式复刻。盘点：4 条在册 migration 中 orphan-revision-gc-v1 与 table-constraints-v1b 均 v1.4.28 首发（早于 10-tag 基线 v1.5.2）→ 退役；usage-cache-model-backfill-v1（v1.5.4）与 retire-pref-session-fs-version-check-v1（未发布）保留。退役动作：(1) BASELINE_MIGRATION_IDS 扩至 11 条字面量（applied 记录即通行证）；(2) 新增 hasLegacyVfsRevisionShape 探针（vfs_revision 存在但未 WITHOUT ROWID = 未走 table-constraints-v1b，判据照搬原迁移自探测，保守方向 false）——堵住「v1.4.27 同代库带旧 baseline id 过 some() 门却缺两迁移」的缝，这是本轮关键：两迁移恰好都在 v1.4.28 上线，形态探针把 era 边界封死；(3) ORPHAN_REVISION_GC_SQL 从 migration 文件迁入 sqlite-vfs-revision.repository（运行期 deleteGlobalOrphans 独占，语义不变）；(4) 删 2 migration 源文件 + table-constraints.test.ts（693 行直测，约束形态由 canonical DDL 覆盖）；(5) fail-fast 文案与模块头 v1.4.27→v1.4.28；SCHEMA_BOOT_VERSION 不动（无 DDL 变更）。core 1823 绿（-5 = 删掉的直测用例），tsc 0 错，dist 重建，CHANGELOG 补条目（沿先例措辞）。

user:
migration 的逐渐移除是合理升级做法吧？

assistant:
确认合理，业界标准模式（migration squashing / baseline bumping）：Rails 官方建议删旧 migration（schema.rb 为真相）、Django 有 squashmigrations 命令、Flyway/Liquibase 有 baseline migration 概念。机理：migration 的读者是未升级的旧库，版本越老占比越衰减而维护成本恒定（注册表+测试+兼容分支每版都背着）；旧 migration 很少被执行所以最易腐化（table-constraints 的 v1→v1b 真机事故即例证）；收缩后新库从 canonical DDL 直建成最终形态不重放历史。本仓库实现讲究三点：canonical DDL 是真相、migration 只是搬运工（退役时逻辑已有归宿）；applied 记录+形状探针双保险、老库 fail-fast 有指引不静默炸；git 历史即冷档案。唯一权衡：抬基线放弃极老库直升级（须过中间版本），对版本分布衰减快的桌面/移动 app 合理，对多年不动的服务器库要谨慎。

user:
清理下 10 个 tag 前的 migration。

assistant:
第四轮 10-tag 清理：目标 usage-cache-model-backfill-v1（v1.5.4 首发引入，chat_message cache/模型快照回填，纯数据迁移）；retire-pref-session-fs-version-check-v1（v1.5.12）在保护期内保留。三件套落地：注册表摘除 + 源文件与专属测试物理删除（照第二/三轮先例，RULE.md「保留文件」口径已被先例实际取代）+ BASELINE_MIGRATION_IDS 追加该 id、最低支持版本 v1.4.28→v1.5.5（提示文案同步）。数据迁移无 schema 形态可探、不加新探针，老库识别依赖既有 legacy 探针；全新空库无 legacy 表征不触发 fail-fast。SCHEMA_BOOT_VERSION 不动（未改 DDL/align）。core 全量 2395/0。下一轮（第五轮）基线预计抬至 v1.5.15 附近、待 10 个版本后。

user:
（2026-10-05，同日另一会话）就这样吧合并到主分支，另外 10 个 tag 前的 migration 和存量数据迁移可以移除了吧？

assistant:
第五轮清理（基线严重过期：第四轮 2026-09-12 设 v1.5.5，已到 v1.5.37）。探索核实：SCHEMA_MIGRATIONS 在册 6 条全部到期（retire-pref-session-fs-version-check v1.5.12、workplace-dir-rule-smart-field / rename-smart-sort-rule-example / add-smart-sort-capture-kind 均 v1.5.17、add-mcp-file-path-snapshot v1.5.20、dedup-file-cache-storage v1.5.22），4 条 schema 形态已逐字固化 canonical DDL、2 条数据迁移只进基线。基线拍板 v1.5.23（最晚退役首发 tag +1，第四轮算法）。落地（worktree mc5，提交 2a2b4e728，+53/−1640）：注册表清空为空数组、6 源文件 + 6 专属测试物理删除、BASELINE_MIGRATION_IDS 12→18、基线版本号新增 BASELINE_MINIMUM_VERSION 单常量（下轮只改一处）、SCHEMA_BOOT_VERSION 不动。bootstrap-no-migrate 的 BASELINE_BACKUP_MODULES 恒空 Set 未改（该步骤实际不存在）。门禁：bootstrap 域 66/66（worktree 与 main 双侧）、core 全量 11 红全既有（base stash 对照零新增）、desktop 全量 730/730（main 重建 core dist 后）。已合 main（988a953ca 含 changelog）。**后台迁移任务未随轮动**（关键决策）：blob 二进制归一虽过 spec 参考时点 v1.5.35，但其删除前提（无 zlib-b64 残留的强制收尾门）与 compression V1 细则互相引用、无可执行方案，推迟到前提落地轮；消息压缩正向任务 v1.5.29 已删（decompression 是反向继任者）；到期表与 task-attach-unref 清理版（0% 未做）已固化进 RULE.md 清理节奏条款。

user:
（2026-10-05 追问）后台存量数据迁移任务什么时候可以移除？假如以 tag10 为标准？

assistant:
纯答疑，口径已固化进 RULE.md 清理节奏条款。按 10-tag 标准的到期表：blob 归一（v1.5.25 引入）v1.5.35 已到期但删除前提（无 zlib-b64 残留的收尾确认门）无可执行方案，不能光看 tag；message-decompress（v1.5.29）v1.5.39 到期即下一个版本，但 ref-unref 硬依赖它的解压标记（先删解压会让回迁任务收尾否决恒真、永远 deferred），须同批；message-ref-unref（v1.5.30）v1.5.40 到期，连带 task-attach-unref E1 清理版残件（0% 执行）；vfs-content-packing 无退役条款不适用。建议 v1.5.40 一轮同批清：decompress + ref-unref + message-plaintext V1' 清单（双形态读分支/decodeMessageContent/blob 归一的 messageContent adapter）+ E1 残件；blob 归一本体等收尾门落地再排。删除前外部确认：decompress=content_blob 非空计数归零+decompressDone；unref=contentRef LIKE 归零+unrefDone；这些任务不走 schema_migrations、assertMinimumBaseline 管不到，删了跳版用户无自动兜底。
