---
date: 2026-09-21
---

# 存储缓存去重与数据清理 技术规格（SPEC）

需求来源：`docs/Iterations/storage-cache-dedup-and-cleanup/prd.md`（本迭代总纲 PRD，用户已确认方向：feature A 存储层去重 + feature B 数据清理按钮三能力 + 双端）。

## 设计目标

1. `file_cache` 缓存内容全库单份存储（同 body 一份 blob），会话侧只存轻量引用；`SessionKkvService` 六个方法的签名与语义（含"命中无条件返回"、best-effort vs 裸抛两种清错口径）**完全不变**，全部既有调用方与测试零改动通过。
2. 存量 415MB 缓存一次性消除，且不引入"事务外跨 boot 迁移"新模式（现有 migration 框架整体跑在 bootstrap 事务内，突破框架的风险已被 vfs-version-redesign 迭代明确拒绝）。
3. 双端提供「数据清理」入口：库体积展示 + 缓存冗余 GC + VACUUM，Agent 运行中/云同步中禁用，desktop 经新增 IPC（renderer 与 DB 隔离红线不动）。

## 总体方案

### Feature A：缓存内容去重（两张新表 + repository 透明分流）

**表结构**（照 `vfs_content_blob` 模式，放 `bootstrap/session-kkv/`）：

```sql
CREATE TABLE IF NOT EXISTS session_file_cache_blob (
  content_hash TEXT NOT NULL PRIMARY KEY,   -- sha256(body)，复用 hash-content.ts
  encoding TEXT NOT NULL CHECK (encoding IN ('zlib', 'zlib-b64')),
  bytes BLOB NOT NULL,
  byte_len INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS session_file_cache_entry (
  session_id TEXT NOT NULL,
  key TEXT NOT NULL,                        -- 键名不变：{status}:{path}
  content_hash TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, key)
);
CREATE INDEX IF NOT EXISTS idx_session_file_cache_hash ON session_file_cache_entry(content_hash);
```

**设计决策与依据**：

- **file_cache 域整体迁出 `session_kkv_entry`**：`sqlite-session-kkv.repository.ts` 按 domain 分流——`file_cache` 域的 get/set/delete/clearDomain/clearSession/listKeys 走两张新表（`get` 还原出与 `set` 时完全相同的 payload JSON 字符串，desktop 既有 `rt.sessionKkv.get(...)` 断言原样通过）；`rule_snapshot`/`backfill_cursor` 等小域保持原表原逻辑。`createSessionKkvService(tx)` 的"事务连接"用法照常工作（分流后仍是同连接同 SQL 风格）。
- **hash 只算 body，mtime 留引用行**：`content_hash = sha256(body)`，`mtime_ms` 存 entry 行——同 body 不同 mtime 的会话共享 blob 且各自精确还原（消除探索发现的"write 工具 upsert 用 Date.now() 与 vfs.read mtime 不一致"的孤儿风险，AC 与 PRD"命中不校验 mtime"拍板一致）。
- **不用 ref_count 列、不用触发器**：vfs 的"触发器计数 + 扫描 GC"双计数器被 cr-fix-spec 评审列为复杂度陷阱；缓存引用行删除点多且常在事务内（truncate-tail/deleteSessionTree），统一走 **GC 时 NOT IN 引用集清扫**（纯 SQL：`DELETE FROM session_file_cache_blob WHERE content_hash NOT IN (SELECT content_hash FROM session_file_cache_entry WHERE content_hash IS NOT NULL)`——对齐 `sqlite-vfs-content-store.ts` gc() 的 NOT IN + NULL 陷阱防御风格；entry.content_hash 本有 NOT NULL 约束，此处防御为风格对齐），并沿用 `runDeferredBlobGc` 的"事务提交后调度、引用集全库"纪律。
- **写序保证**：`set` 分流后为「ensure blob → upsert entry」两语句（调用方均非事务，现状即非原子单条 upsert）。顺序必须**先内容后引用**：中途崩溃最坏产生孤儿 blob（GC 可回收），绝不悬空引用（`get` 解析失败返回 null，上层 `parseFileCachePayload` 当 miss 自愈重读——既有容错链路复用）。
- **残留旧键维持现状（回应 PRD 风险节待确认项，已拍板）**：文件已删/改名后的旧键是现状有意保留的（UI delete/rename 不碰缓存，Composer workplace chip 差集依赖 key 存在性）——entry 引用行仍在即视为被引用，GC 不回收；不将残留旧键纳入冗余清理判定，行为与现状一致。
- **压缩/编码复用 vfs 现成模块**：`hash-content.ts`（@noble/hashes sha256）、`zlib-codec.ts`（fflate）、`blob-bytes-codec.ts`（RN zlib-b64 分支 + `isReactNativeRuntime`）直接 import，不新建。缓存 body 均值 25KB、上限 8MB（既有闸门），与 vfs 正文同量级，RN 端 b64 路径风险面等同已验证场景。

### 存量迁移：清空重填（不搬数据）

- migration `dedup-file-cache-storage-v1`：`up(tx)` 单条 `DELETE FROM session_kkv_entry WHERE domain = 'file_cache'`——引擎内完成、不进 JS 堆、幂等（重复执行删 0 行）。21198 行/415MB 的一次性删除在 bootstrap 事务内可接受（mobile 实测点见风险表）。
- 依据：PRD 风险节预留的降级口径；file_cache 是可再生性能缓存（RULE.md 定位），清空后各会话下次组装提示词时按新结构重填，重填即天然去重。相比"跨 boot 进度游标迁移"（全新模式、撞 `vfs-version-redesign` 已拒绝的框架突破）工程风险数量级更小。
- 旧表 `session_kkv_entry` 不加列不改列（`SCHEMA_COLUMN_ALIGNMENTS` 不动），`SCHEMA_BOOT_VERSION` 14→15 只因两张新表。
- 对 AC-A1 的口径：迁移后缓存存储为 0，重填后收敛为单份内容规模（约 4MB 量级）——验收取"重填后"值；被清数据释放的页挂 freelist，由 feature B 的数据清理回收物理空间（两 feature 正好闭环）。

### Feature B：数据清理（core 维护服务 + 双端入口）

**core**（`infra/db-maintenance/`，照 `infra/db-backup/` 先例）：

- `getStorageStats(conn)`：`conn.query("PRAGMA page_count")` / `page_size` / `freelist_count`（照 `readSchemaBootVersion` 的 PRAGMA query 模式），返回 `{ pageSize, pageCount, freelistPages, reclaimableBytes }`。
- `runDatabaseMaintenance(conn)`：`runDeferredFileCacheGc(conn)`（feature A 的缓存 GC，feature A 未合入时此步跳过）→ 防御性 `PRAGMA wal_checkpoint(FULL)`（照备份先例，DELETE journal 下为 no-op）→ `conn.execute("VACUUM")`（**必须事务外**；并发安全由 tdbc 驱动层的 `AsyncMutex`（`packages/tdbc-driver-{better-sqlite3,op-sqlite}/src/mutex.ts`，连接全部操作经 `mutex.run` 串行）天然保证——检索时注意它在 tdbc 驱动包内，core/apps 目录下搜不到）。

**desktop**（IPC 通道，preload 通用转发无需动）：

- 新通道 `DB_STATS: 'nm:db/stats'`（bindNoArg）与 `DB_MAINTENANCE: 'nm:db/maintenance'`，注册五处：`shared/ipc-types.ts`（通道 + 结果 DTO：stats 返回 `{ fileBytes, reclaimableBytes }`，maintenance 返回 `{ beforeBytes, afterBytes }`；文件体积由 main 侧 `node:fs/promises stat(resolveDbPath())` 提供）→ `handler-registry.ts` → `handlers/db-maintenance.ts`（照 backup.ts 的 try/catch + formatIpcError）→ `invoke-registry.ts` → `client.ts`。
- 互斥闭环：`cloud-sync.service.ts` 导出 `isDesktopCloudSyncBusy()`（读现有模块级 `syncBusy`），maintenance handler 入口查 `isDesktopAgentActive() || isDesktopCloudSyncBusy()` 抛中文 Error；反向在 `CloudSyncLocalStatusDto` 扩 `maintenanceBusy` 字段（main 侧模块级状态），renderer `controlsDisabled` 纳入——满足 AC-B3 双向互斥。既有 backup↔cloudsync 互不感知的缺口**不在本迭代补**（记录不扩scope）。
- UI（`SettingsViews.tsx` DataManagementView）：新 `SettingsActionSection` 展示当前库体积 + 可回收量（DB_STATS，进入页面与轮询刷新时拉取），按钮 `disabled={controlsDisabled}`，`ConfirmModal` 二次确认（busy 态「处理中…」），结果 toast（`toastSettingsSuccess/Error`）。**执行中状态必须在 invoke 发起前置位**（better-sqlite3 同步 VACUUM 会冻住 main 事件循环，轮询/事件推送全部挂起，不能依赖 main 推送）。

**mobile**：

- `services/db-maintenance.service.ts`（照 db-backup.service.ts 模板）：入口 `isMobileAgentActive()` 守卫 → `getDatabaseFileSize()`（`resolveMobileDatabaseFilePath()` + `blobFs().stat`）→ `runDatabaseMaintenance(runtime.conn)` → 返回前后体积。
- `StorageConfigScreen` 「导入导出」分区后新增「数据清理」分区：`ProfileStatusCard` metrics 展示体积/可回收 + `ProfileMenuItem`（组件无 disabled prop，沿用 onPress 内 `dbBusy` 守卫 + value 文案「Agent 运行中/处理中…」的既有口径）+ `Alert.alert` 二次确认 + `showToast(toastMessage(...))` 反馈。同页 `dbBusy` 与导入导出天然互斥；云同步跨页互斥沿用 agentActive 口径（mobile 侧 syncBusy 为页面局部状态，与现状一致，SPEC 明确不扩）。

## 最终项目结构

```text
packages/core/src/
  bootstrap/session-kkv/file-cache-schema.ts                      # 新：两表 DDL 语句数组
  bootstrap/novel-master-bootstrap.ts                             # 改：注册 + SCHEMA_BOOT_VERSION 15 + 版本史注释
  bootstrap/schema-migrations/dedup-file-cache-storage-v1.ts      # 新：清空迁移
  bootstrap/schema-migrations/index.ts                            # 改：数组登记
  domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts  # 改：file_cache 域分流
  domain/session-kkv/logic/file-cache-blob-codec.ts               # 新：payload JSON ↔ (hash, mtime, body) 编解码（复用 vfs 的 hash/zlib/b64 模块）
  domain/session-kkv/logic/deferred-file-cache-gc.ts              # 新：GC（NOT IN entry 引用集）
  domain/vfs/content-store/logic/zlib-codec.ts                   # 改：注释（模块头由「仅供 ContentStore」改为「ContentStore 与 file_cache blob 共用」）
  infra/db-maintenance/{db-maintenance.port.ts, impl/db-maintenance.service.ts, index.ts}  # 新：stats + VACUUM
  index.ts（public 导出：runDeferredFileCacheGc、db-maintenance 工厂；同步 test/package-exports 快照）
  # 改（GC 挂载，各 +1 行）：service/chat/impl/session.service.ts、project.service.ts
apps/desktop/
  shared/ipc-types.ts / src/main/ipc/handler-registry.ts / renderer/ipc/{invoke-registry.ts, client.ts}  # 改：通道登记
  src/main/ipc/handlers/db-maintenance.ts                         # 新
  src/main/services/db-maintenance.service.ts                     # 新（含 fs.stat 与守卫）
  src/main/services/cloud-sync.service.ts                         # 改：导出 isDesktopCloudSyncBusy + status 扩 maintenanceBusy
  renderer/features/settings/SettingsViews.tsx                    # 改：体积展示 + 清理入口
apps/mobile/
  src/services/db-maintenance.service.ts                          # 新
  src/screens/stack/StorageConfigScreen.tsx                       # 改：数据清理分区
```

**明确零改动**（依赖端口隔离，AC-A2 的证据面）：`load-or-fill-file-cache.ts`、`assemble-workplace-display.ts`、`prepare-user-messages-for-prompt.ts`、`run-compaction.ts`、`clear-session-prompt-caches.ts`、`refresh-rule-snapshot.ts`、`truncate-tail-in-transaction.ts`、`message-transcript-effects.service.ts`、`vfs-tools.ts`、`overflow-sink.ts`、双端 `session-prompt-input.service.ts`、`rule-snapshot-codec.ts`、`session-kkv-domains.ts`、双端 runtime 装配、core 测试 fixture。

## 变更点清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `bootstrap/session-kkv/file-cache-schema.ts` | 新建：`FILE_CACHE_SCHEMA_STATEMENTS`（blob 表 + entry 表 + 索引） |
| 2 | `bootstrap/novel-master-bootstrap.ts` | import + spread 进 `NOVEL_MASTER_SCHEMA_STATEMENTS`；`SCHEMA_BOOT_VERSION` 14→15；版本史注释追加 v15 段（含老库慢路径说明） |
| 3 | `bootstrap/schema-migrations/dedup-file-cache-storage-v1.ts` | 新建：单条 DELETE + 幂等；导出 id 常量与供测试直调的 up |
| 4 | `bootstrap/schema-migrations/index.ts` | 数组登记（清空型迁移，登记即完成，不涉"空占位回填"禁令） |
| 5 | `domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts` | 按 domain 分流六方法：file_cache → entry+blob 两表（get 两跳还原、set 先 ensure 后 upsert、clear* 只删引用行、listKeys 查 entry.key）；其余域原 SQL 不动 |
| 6 | `domain/session-kkv/logic/file-cache-blob-codec.ts` | 新建：`serializeFileCachePayload` 产物 → `(hash, mtimeMs, body)`；解压还原（编码三形态兼容）；同步更新 vfs 的 zlib-codec.ts 模块头注释——由「仅供 ContentStore 使用」改为「ContentStore 与 file_cache blob 共用」（禁 ZIP 路径调用的纪律不变） |
| 7 | `domain/session-kkv/logic/deferred-file-cache-gc.ts` | 新建：`runDeferredFileCacheGc(conn)`，注释钉死"引用集 = session_file_cache_entry 全表，不得缩成单会话" |
| 8 | `service/chat/impl/session.service.ts` / `project.service.ts` | 删除事务提交后的 `runDeferredBlobGc()` 调用处并排追加 `runDeferredFileCacheGc()` |
| 9 | `infra/db-maintenance/*` | 新建：`getStorageStats` + `runDatabaseMaintenance`（GC → checkpoint → VACUUM，事务外） |
| 10 | `index.ts` + `test/package-exports/snapshots/main-entry-allowlist.json` | 公开导出与快照同步 |
| 11 | desktop 五处 IPC + `handlers/db-maintenance.ts` + `services/db-maintenance.service.ts` + `cloud-sync.service.ts`（busy 暴露与 status 扩字段）+ `SettingsViews.tsx` | 通道、守卫、体积展示、清理入口 |
| 12 | mobile `services/db-maintenance.service.ts` + `StorageConfigScreen.tsx` | 服务（守卫 + stat + 执行）与「数据清理」分区 |
| 13 | `CHANGELOG.md` | Unreleased 条目（Step 10 文档产物） |
| 14 | `docs/apm/RULE.md` | 「常驻工作区 / KKV」词条补去重存储形态一句（Step 10 文档产物） |

## 详细实现步骤

- Step 1 — phase-fc-schema — blocking: yes — qa: auto：新建 file-cache-schema.ts（两表 DDL），注册进 `NOVEL_MASTER_SCHEMA_STATEMENTS`，`SCHEMA_BOOT_VERSION` 14→15 并补版本史注释；配套 `test/bootstrap/file-cache-schema.test.ts`（照 session-run-state-schema.test.ts：新库 DDL / 老库慢路径 / 快路径幂等三场景，断言引用版本常量）。
- Step 2 — phase-fc-migration — blocking: yes — qa: auto：新建 `dedup-file-cache-storage-v1`（`DELETE FROM session_kkv_entry WHERE domain='file_cache'`）并登记；测试覆盖：迁移后 file_cache 域行为清空、其他域行保留、重复执行幂等、`schema_migrations` 登记。
- Step 3 — phase-fc-repo — blocking: yes — qa: auto：repository file_cache 域分流 + file-cache-blob-codec（先内容后引用写序；get 失败返回 null 走既有自愈）；单测见 T-R 系列。
- Step 4 — phase-fc-gc — blocking: yes — qa: auto：`runDeferredFileCacheGc` + session/project 删除后挂载 + public 导出与快照；单测见 T-G 系列。
- Step 5 — phase-fc-regress — blocking: yes — qa: auto：跑 core 全量 fast 套件 + desktop/mobile 定向测试（compaction-handler / messages-set-floor-handler / vfs-delete-handler / session-prompt-input / load-or-fill-file-cache / assemble / prepare / truncate / clear-session-prompt-caches / subspace-isolation），**零断言修改**全绿；按 RULE.md 纪律重建 core dist 后再跑双端。
- Step 6 — phase-maint-core — blocking: yes — qa: auto：`infra/db-maintenance/`（stats + maintenance），导出与快照；单测见 T-DM 系列。
- Step 7 — phase-maint-desktop — blocking: yes — qa: auto：desktop 通道登记（ipc-types/handler-registry/invoke-registry/client）+ handler 与 main 服务（agentActive + cloudSyncBusy 双守卫）+ `cloud-sync.service.ts` busy 暴露与 `maintenanceBusy` status 字段 + DataManagementView UI（体积展示、ConfirmModal、执行前置 busy、toast）；handler/UI 测试见 T-DMD/T-UID。
- Step 8 — phase-maint-mobile — blocking: yes — qa: auto：mobile 维护服务（守卫 + stat + 执行）+ StorageConfigScreen「数据清理」分区；服务测试与 UI 源码断言见 T-DMM/T-UIM。
- Step 9 — phase-maint-verify — blocking: no — qa: manual_user：双端真机/桌面验收 AC-B1/B2/B5（体积展示、清理前后对比录屏或截图；mobile 大库清理耗时记录）。
- Step 10 — phase-docs — blocking: no — qa: auto：CHANGELOG Unreleased 条目（按 novel-master-changelog skill 分类口径）+ RULE.md「常驻工作区/KKV」词条补去重存储形态一句（合并前完成）。

## 测试策略

### 测试用例

（每条映射到 Step，供验收矩阵对照；`blocking: yes` 用例为合并门禁）

- T-S1 — blocking: yes（Step 1）：新建库 bootstrap 后两表存在、entry 索引存在。
- T-S2 — blocking: yes（Step 1）：`user_version < 15` 的老库走慢路径补建两表。
- T-S3 — blocking: yes（Step 1）：快路径（≥15）重复 bootstrap 幂等不报错。
- T-M1 — blocking: yes（Step 2）：含多会话 file_cache 行 + rule_snapshot 行的库迁移后，file_cache 行为清空、rule_snapshot 保留。→ AC-A1（清空口径）
- T-M2 — blocking: yes（Step 2）：迁移重复执行幂等；`schema_migrations` 有登记。
- T-R1 — blocking: yes（Step 3）：`set(payload) → get()` 逐字节还原原字符串（中文 body、任意 mtimeMs）。→ AC-A2 基础
- T-R2 — blocking: yes（Step 3）：两个会话 set 同 body 不同 mtime：blob 表恰一行，两个 entry 各自 get 还原各自 mtime。→ AC-A3
- T-R3 — blocking: yes（Step 3）：同 key 两次 set 不同 body：entry 引用转移为新 hash，旧 blob 保留待 GC（不误删）。
- T-R4 — blocking: yes（Step 3）：`clearDomain(file_cache)` 只删该会话 entry 行，blob 与其他会话 entry 不动。→ AC-A4 前半
- T-R5 — blocking: yes（Step 3）：`clearSession` 删该会话全部 entry 行；`listKeys` 返回 entry.key 集合（键名与现状一致）。
- T-R6 — blocking: yes（Step 3）：blob 行缺失/解压失败时 `get` 返回 null（上层当 miss 自愈），不抛异常。
- T-G1 — blocking: yes（Step 4）：手工制造孤儿 blob（直接 DELETE entry 行），`runDeferredFileCacheGc` 后回收，被引用 blob 保留。→ AC-A4 后半
- T-G2 — blocking: yes（Step 4）：会话删除（`sessions.delete`）事务提交后 GC 被调度且不影响仍引用同 blob 的其他会话。→ AC-A4
- T-REG1 — blocking: yes（Step 5）：core fast 套件 + 双端定向测试全绿，git diff 确认零测试文件修改。→ AC-A2 / AC-A5（迁移重入由 T-M2 覆盖）
- T-DM1 — blocking: yes（Step 6）：建库→写入→删除→`runDatabaseMaintenance` 后 `freelist_count` 归零、文件体积下降；`getStorageStats` 数值与 PRAGMA 直读一致。→ AC-B2 核心
- T-DM2 — blocking: yes（Step 6）：maintenance 在连接上非事务执行（事务中调用抛错防护，防误用）；防护 = SQLite 原生拒绝事务内 VACUUM 的报错（TdbcConnection 无事务状态探测 API，不做主动探测），断言事务中调用得到错误而非静默。
- T-DMD1 — blocking: yes（Step 7）：agentActive / cloudSyncBusy 任一为真时 handler 返回 `{ok:false}` 中文错误。→ AC-B3（desktop）
- T-DMD2 — blocking: yes（Step 7）：正常路径 handler 返回 `{beforeBytes, afterBytes}`；`maintenanceBusy` 在执行窗口内置真。→ AC-B2/B3
- T-DMD3 — blocking: yes（Step 7）：desktop maintenance handler 失败路径——mock/构造 `runDatabaseMaintenance` 抛错，handler 返回 `{ok:false}` 且错误消息透传（formatIpcError 路径）；`maintenanceBusy` 复位。→ AC-B4（desktop）
- T-UID1 — blocking: yes（Step 7）：SettingsViews 源码断言（或 renderToStaticMarkup）：体积展示区、清理按钮、ConfirmModal、controlsDisabled 纳入、失败结果 toast 反馈（toastSettingsError 路径）。→ AC-B1 / AC-B4（desktop UI）
- T-DMM1 — blocking: yes（Step 8）：mobile 维护服务：agentActive 时抛中文 Error；正常路径调 `runDatabaseMaintenance` 并返回前后体积。→ AC-B3（mobile）
- T-DMM2 — blocking: yes（Step 8）：mobile 维护服务失败路径——执行抛错时中文错误以 reject 语义抛出、可被调用方捕获（dbBusy 为页面 useState，服务层断言不到，复位断言移至 T-UIM1），库仍可正常读写（不残留损坏状态）。→ AC-B4（mobile）
- T-UIM1 — blocking: yes（Step 8）：StorageConfigScreen 源码断言：「数据清理」分区、dbBusy 守卫、失败时 dbBusy 复位（finally 置 false）、Alert 确认、toast 反馈存在。→ AC-B1
- T-MAN1 — blocking: no — qa: manual_user（Step 9）：双端真机验收录屏：体积展示 → 清理 → 体积下降；mobile 大库（>100MB）清理耗时记录。→ AC-B1/B2/B5

### 回归防线

- 语义零回归的面（Step 5 的清单）就是探索报告 1 列出的既有测试全集；任何一条需要改断言才能过 = 设计违反"语义不变"承诺，回炉。
- 仓库纪律检查项：改 core 后重建 dist 再验双端；测试计数断言圈 scope（bootstrap 种子行污染）；VACUUM/大 DELETE 不进 UI 线程事务；mobile 事务内语句同步执行纪律不被新代码破坏（新 SQL 全部经现有 repository/handler 通道）。

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| mobile 事务内单条 DELETE 21198 行/415MB 的耗时（Hermes + JSI 同步执行） | 升级一次性成本；真机实测（T-MAN1 记录）；若超 ~5s，降级拆为谓词驱动分批 DELETE（`LIMIT` 子查询，引擎内仍不进 JS 堆） | migration 回滚无必要：清空型幂等，回滚版本后缓存按旧机制重填 |
| desktop VACUUM 冻结 main 数秒~数十秒 | renderer 执行前置 busy + ConfirmModal「处理中…」文案管理预期；handler 拒绝并发 | VACUUM 失败库保持原样（SQLite 原子性），用户可重试；无数据风险 |
| RN zlib-b64 大 body 吞吐 | body 上限既有 8MB 闸门（超限本就不写缓存）；均值 25KB 与 vfs 正文同量级 | codec 失败走 R6 自愈路径（get null → miss 重读） |
| 双计数器/触发器复杂度 | 本方案无触发器无计数列，单一 NOT IN GC | — |
| 新表与分流引入回归 | Step 5 全量零断言回归门禁 | 两张新表为增量（旧代码不读不写）；回滚 = revert 提交，旧表 file_cache 域行为自动恢复 |
| migration 框架约束（单事务） | 清空型 DELETE 天然适配，不引入新框架 | 已在方案层规避 |

## 附：Context Bundle

```yaml
iteration_name: storage-cache-dedup-and-cleanup
requirement_path: docs/Iterations/storage-cache-dedup-and-cleanup/prd.md
spec_path: docs/Iterations/storage-cache-dedup-and-cleanup/spec.md
explore_summary: >
  PRD 阶段四份业务探索 + SPEC 阶段三份技术探索（缓存链路接口与调用点 /
  vfs_content_blob 与迁移机制先例 / 双端 UI+IPC+VACUUM 细节）。
  关键结论：SessionKkvService 六方法签名是语义合同；file_cache 写路径均
  非事务、清理方混合事务内外；vfs content-store 的 hash/zlib/b64 模块
  可直接复用；migration 框架单事务假设不可突破（vfs-version-redesign
  拍板）；desktop renderer 隔离需 IPC；ProfileMenuItem 无 disabled prop。
impact_files:
  - packages/core/src/bootstrap/session-kkv/file-cache-schema.ts (新)
  - packages/core/src/bootstrap/novel-master-bootstrap.ts
  - packages/core/src/bootstrap/schema-migrations/dedup-file-cache-storage-v1.ts (新)
  - packages/core/src/bootstrap/schema-migrations/index.ts
  - packages/core/src/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts
  - packages/core/src/domain/session-kkv/logic/{file-cache-blob-codec,deferred-file-cache-gc}.ts (新)
  - packages/core/src/infra/db-maintenance/* (新)
  - packages/core/src/service/chat/impl/{session,project}.service.ts
  - apps/desktop/{shared/ipc-types.ts, src/main/ipc/{handler-registry,handlers/db-maintenance}.ts, src/main/services/{db-maintenance,cloud-sync}.service.ts, renderer/ipc/{invoke-registry,client}.ts, renderer/features/settings/SettingsViews.tsx}
  - apps/mobile/src/{services/db-maintenance.service.ts (新), screens/stack/StorageConfigScreen.tsx}
constraints:
  - SessionKkvService 签名与语义（含命中无条件返回、两种清错口径）不可变
  - SCHEMA_BOOT_VERSION 必须 bump（14→15），版本史注释同步
  - VACUUM 与大 DELETE 均不进 UI 可等待路径的事务
  - desktop renderer 与 DB 隔离：一切经 IPC；preload 通用不动
  - 复用 hash-content/zlib-codec/blob-bytes-codec，禁止 node:crypto 单实现
  - 改 core 后重建 dist 才验双端
blocking_steps: [Step 1, Step 2, Step 3, Step 4, Step 5, Step 6, Step 7, Step 8]
```
