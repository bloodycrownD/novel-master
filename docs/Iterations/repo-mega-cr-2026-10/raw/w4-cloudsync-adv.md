---
zone: w4-cloudsync-adv
agent: 辩护人（adversarial defense seat）
files_scanned: 20
---

# W4 对抗机位 · w4-cloudsync-adv（辩护人）

> 立场：论证「导出-导入-整库替换」形态、rebootstrap 重建、互斥设计（含 push/agent 互斥锁、
> maintenance busy 计数令牌、云端租约锁）的**设计合理性与必要性**；对确无辩护余地的条目
> 主动让步，不掩盖、不粉饰。
> 独立性纪律：本机位**未读取** `raw/` 下任何文件（含对抗对检察官报告
> `raw/w4-cloudsync-pro.md`）。所有结论从源码 + `docs/apm/RULE.md` + 迭代文档 +
> 实测探针重新推导。F-core-infra-misc-3（push mutex 未接线）系在 grep 全仓引用时
> **意外**出现在终端输出中；本报告对该条的独立复核见 §4.1 与 §5.2，结论一致但证据链为本人独立重建。

## 摘要

云同步把「本机整库」当作唯一同步单元：导出时 checkpoint + 文件级拷贝 + 清除服务商三表
（密钥不出设备），上传到用户自备 S3 桶；拉取时下载整库快照、校验 SHA-256、dump 本机服务商
三表、关连接、覆盖库文件、写回本机三表、重建 runtime。协调器（core）用 `rev` 单调递增 +
`status.json` 租约锁 + S3 条件 PUT（If-Match）做跨设备互斥，用进程内 FIFO 锁做本机
push 排队，用计数/令牌式 busy 覆盖「关连接 + 覆盖库文件 + 重建」整段最危险窗口。

## 职责与边界

- **core `infra/cloud-sync`**：平台无关的同步编排（协调器、租约锁、status schema、端口）。
  刻意**不使用 `node:crypto`**——哈希与文件 IO 由宿主注入（`computeSha256Hex` /
  `hashSnapshotFile` / `readSnapshotBytes`）。这是 RN/Node 双端复用的前提，非缺陷。
- **core `infra/db-backup`**：服务商三表 dump/scrub/restore + 还原前 service 级校验。
- **apps/desktop/main**：`DesktopCloudSyncService`（组装 S3 驱动 + DbSyncPort + temp 路径）、
  `db-backup.service`（文件级导入导出）、`cloud-sync-config.store`（KKV + SKSP）、
  IPC handlers。
- **apps/mobile**：`cloud-sync.service`（函数式 API + 进度追踪）、`db-backup.service`
  （分块落盘，避免大包 base64）、`cloud-sync-config.store`、`map-cloud-sync-sdk-error`。

**边界外**：S3 驱动实现（`packages/cloud-sync-driver-s3`）、UI 页面、SKSP 本身。

## 对外接口

| 符号 | 位置 | 说明 |
|---|---|---|
| `CloudSyncCoordinator.pull/push` | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:143,185` | 唯一编排入口 |
| `getDefaultPushAgentMutex` | 同上 `:60` | 进程内默认锁单例（**未从 index 导出**，见 §5.2） |
| `isEffectiveLock/canAcquireLock/buildLease/renewLease` | `logic/lock.ts:15,25,38,53` | 租约锁四函数 |
| `normalizePrefix/statusKey/snapshotKey` | `logic/paths.ts:10,19,26` | 远端对象键生成 |
| `parseCloudSyncStatus/EMPTY_CLOUD_SYNC_STATUS` | `model/cloud-sync-status.ts:60,51` | status.json 的 zod 校验 |
| `dumpProviderTableSnapshot/scrubProviderTables(InDatabase)/restoreProviderTableSnapshot` | `infra/db-backup/provider-table-snapshot.ts:33,50,61,82` | 三表快照 |
| `validateProviderTableSnapshot` | `provider-table-snapshot-validate.ts:182` | 还原前 service 级校验 |
| `ObjectStoragePort/DbSyncPort` | `ports/*.ts` | 双端口抽象（`putFile/getToPath/importSnapshotFromPath` 为可选方法） |

## 数据访问

| 对象 | 位置 | 证据 |
|---|---|---|
| 表 `llm_provider` / `llm_saved_model` / `sksp_secrets` | dump→scrub→restore | `provider-tables.ts:10-14`、`provider-table-snapshot.ts:41-43,103-105,89-91` |
| 表 `kkv_entry`（module `nm-cloud-sync`） | 本机同步元数据，**不进云端** | `apps/desktop/.../cloud-sync-config.store.ts:11,282-309`、`apps/mobile/.../cloud-sync-config.store.ts:13,282-296` |
| SKSP `cloud-sync/s3-secret-key` | SK 明文，仅宿主解密后组装 S3 客户端 | `cloud-sync-config.store.ts:12,259,268`（desktop）、`:16,258`（mobile） |
| 库文件整库 | `resolveDbPath()` / `resolveMobileDatabaseFilePath()` | `db-backup.service.ts:79,147`（desktop）、`:111,137`（mobile） |
| temp 快照 | `os.tmpdir()/nm-cloud-sync-{export,import}-<stamp>.nmbackup` | `apps/desktop/.../cloud-sync.service.ts:380-387` |
| temp 快照（mobile） | `CacheDir/cloud-sync-{export,import}-<stamp>.nmbackup` | `apps/mobile/src/services/cloud-sync.service.ts:171-172` |
| 远端对象 | `{prefix}status.json`、`{prefix}snapshots/rev-{6位}.nmbackup` | `logic/paths.ts:19,26` |

## 依赖关系

- **import 谁**：`@novel-master/core`（协调器/锁/schema/三表快照/tdbc）、`@novel-master/cloud-sync-driver-s3`、`@aws-sdk/client-s3`（两端）、`react-native-blob-util`（mobile）。
- **被谁消费**：`apps/desktop/src/main/ipc/handlers/cloud-sync.ts`、`backup.ts`；`apps/mobile/src/screens/stack/CloudSyncProgressScreen.tsx`、`CloudSyncStorageScreen.tsx`；后台维护链路经 `isDesktop/isMobileDbMaintenanceBusy()` 让路。

---

# 一、辩护理由清单

> 每条给出「设计是什么 → 为什么合理/必要 → 证据」。凡是 spec/PRD 明确拍板的，直接引出处。

## A. 整库替换（而非增量/实体 merge）作为同步形态

**辩护 1｜整库替换是本产品形态下的正确取舍，不是偷懒。**

本项目的库不是「可任意合并的行集合」，而是带版本链与跨表不变量的状态机：VFS 内容寻址
（`vfs_content_blob` 按 `content_hash` 共享，revision 引用）、消息正文双形态（`content_json`
明文 / `content_blob` + `content_encoding`）、`session_kkv` 的 blob 去重与引用计数。
`docs/apm/RULE.md`「消息正文压缩列」条目明写「新代码严禁假设单一形态」，
「体积/收益类实测结论必须按内容哈希去重统计」条目实锤过按引用行重复计数导致收益虚高近一倍。
在这种 schema 上做行级 merge，必须同时解决：blob 引用计数、revision 链分叉、
checkpoint/message seq 的空洞语义、置位/压缩产生的 hidden 可见性。**代价远高于收益。**

证据：
- `docs/Iterations/cross-device-cloud-sync/spec.md:12`：「复用既有整库备份语义，
  **不引入自建同步服、后台自动同步或实体 merge**」——这是显式的一期范围锁定。
- `spec.md:41`：「不在本 SPEC：…实体 merge」。

**辩护 2｜「先拉后推 + rev 单调」用「拒绝覆盖」换「不丢数据」，是明确的产品取舍。**

`push` 在 `remote.rev > lastSyncedRev` 且未强制覆盖时抛 `NEED_PULL_FIRST`
（`cloud-sync-coordinator.ts:225-227`），UI 提供「仍要覆盖云端」的显式二次确认
（`CloudSyncProgressScreen.tsx:50-74`）。
`docs/Iterations/cross-device-cloud-sync/prd.md` 把它写成硬指标：「另一台 Push 失败时得到明确提示，
**0 次**静默覆盖对方刚推送的数据」。**用一次「请先拉取」的提示换零静默数据丢失，是正确的默认值。**

**辩护 3｜快照键按 rev 零填充单调命名，本身就是「不可变发布物」的编码。**

`snapshotKey()` 生成 `rev-000042.nmbackup`（`logic/paths.ts:26-29`），push 成功后
`status.json` 的 `snapshotKey` 指向新对象（`cloud-sync-coordinator.ts:286-295`）。
旧快照永不原地覆盖 → pull 永远读到一致视图 → 拉取期间被别的设备 push 也不影响本次拉取。
这是**内容不可变 + 单指针 manifest** 的标准形态，等价于「Git tag + 单分支指针」。

## B. rebootstrap 重建的必要性

**辩护 4｜rebootstrap 不是多余的重建，而是「连接已关 + 库文件已换」的必然收尾。**

导入序列（`apps/desktop/src/main/services/db-backup.service.ts:99-133`）：
`dumpProviderTableSnapshot(liveConn)` → `copyFile(dbPath, bakPath)` →
`closeLiveDbForBackupImport()`（`clearDesktopRuntimeHandle()` + `closeDesktopConnection()`，
`:32-35`）→ `copyFile(srcPath, dbPath)` → 开短连接 `restoreProviderTableSnapshot` → 关短连接。

关连接是**必须的**：better-sqlite3 持有文件句柄与 WAL 锁，Windows/Android 上不关就
`copyFile` 覆盖会失败或产生撕裂。`desktop-runtime-singleton.ts:41-47` 的注释明确说明
「Drop the runtime handle without closing the DB. Call immediately before
`closeDesktopConnection` during backup import so concurrent IPC cannot observe a closed
`runtime.conn`」——**先摘句柄再关连接**正是为了让并发的其它 IPC 走 `getDesktopRuntime()`
重新初始化，而不是拿到已关闭的句柄。这是有意设计的两段式，不是遗漏。

关了就必须重开，`rebootstrapDesktopRuntime()`（`desktop-runtime-singleton.ts:35-38`）
是唯一入口。mobile 侧对应 `onRebootstrap()` 回调（`apps/mobile/src/services/cloud-sync.service.ts:302-346`）。

**辩护 5｜rebootstrap 放在 busy 令牌**之内**、release 严格在其之后，是正确的临界区划分。**

`apps/desktop/src/main/ipc/handlers/cloud-sync.ts:87-97` 与
`apps/mobile/src/services/db-backup.service.ts:232-251` 都写明：
外层令牌覆盖「库文件已替换、连接仍处重建窗口」的尾段，release 在 `rebootstrap` 完成之后。
后台归一/压缩循环读 `isDesktopDbMaintenanceBusy()` 让路——**若 release 早于 rebootstrap，
后台任务会在「连接已关、库文件刚换」的窗口里拿到半成品连接**。
这是 §5.1 那条真实缺陷的正确修法方向（令牌边界本身是对的）。

## C. 互斥设计（三层，各自职责不重叠）

**辩护 6｜云端租约锁用「条件 PUT + expiresAt」而非分布式锁服务，是 S3 上的正解。**

`runPush` 的顺序（`cloud-sync-coordinator.ts:223-241`）：读 status 拿 etag →
`canAcquireLock` 本地判定 → `conditionalPutStatus(lockedStatus, remoteEtag)`，
If-Match 失败即 `LOCK_CONTENTION`（`:351-368`）。
**读-改-写全程以 etag 做 CAS**：即使两台设备同时读到无锁并同时抢，最终只有一个 PUT 成功，
另一个拿到 `LOCK_CONTENTION`。这消除了「本地判定通过就以为自己是唯一持有者」的竞态。

`DEFAULT_LEASE_SECONDS = 900`（`lock.ts:10`）与 spec 拍板一致
（`spec.md:31`「租约默认时长 **900s（15min）**」）。租约而非纯锁是为了**崩溃后可恢复**——
设备在持锁期间断电，锁最多卡 15 分钟，不会永久锁死。

**辩护 7｜「上传超 50% 租约则续租 1 次」是有依据的容量适配，不是玄学阈值。**

`cloud-sync-coordinator.ts:271-284`：上传耗时超 `leaseSeconds * 500`（= 50%）则续租。
spec 拍板原文（`spec.md:32`）：「单次 Push 内若上传耗时 **> 租约 50%**，**续租 1 次**」。
900s 租约的 50% = 450s，即快照上传超过 7.5 分钟才触发——这是给超大库（数百 MB、弱网）
留的余量。**且续租用 `renewLease` 保留 `holderDeviceId` 与 `acquiredAt`、只延长 `expiresAt`
（`lock.ts:53-62`），语义正确**：续租不是重新抢锁，不应改变持有人身份。

**辩护 8｜`finally` 清锁只清「仍由本机持有的有效锁」，条件严谨。**

`tryClearLock`（`:371-393`）三重判定：`lock != null` && `isEffectiveLock(lock)` &&
`lock.holderDeviceId === this.deviceId`。缺任一条就 return——**绝不会误清别人的锁**。
且整体包在 `catch {}` 里（`:390-392`，注释「finally 清锁为尽力而为，不掩盖原始错误」），
清锁失败不会把上传错误变成清锁错误。设计正确。

**辩护 9｜进程内 push/agent 互斥锁（FIFO + 超时降级）的形态本身合理。**

`PushAgentMutex`（`logic/push-agent-mutex.ts`）的实现质量高：
- **FIFO 队列**（`release` 里 `this.waiters.shift()` 后移交，`:118-127`），不插队、不饿死；
- **超时从队列移除并 reject**（`:92-103`），超时者不会在稍后被「幽灵唤醒」；
- **`release` 按 handle id 匹配**（`:113-116`），重复 release / 非持锁者 release 安全忽略——
  这正是 agent 早退兜底路径双释放的现实场景；
- **移交时 `clearTimeout(next.timer)`**（`:120-122`），避免已授予的 waiter 又被超时 reject。

模块头（`:6-8`）陈述的问题是真的：「coordinator 只在 push 入口采样一次 `isAgentActive`，
整个上传过程不再复检，agent 抢跑就静默拿到脏数据」。协调器里因此保留了两处复检
（`:219` 入口、`:267` 续租点）。**这些设计都成立**；本机位的异议只在「接线是否完成」，见 §5.2。

**辩护 10｜maintenance busy 从布尔改为「计数/令牌配对」，是被真实 bug 逼出来的正确修复。**

`apps/desktop/src/main/services/db-maintenance-busy.ts:9-13` 的注释记录了原因：
「旧的纯布尔置位会被嵌套调用的外层复位提前解锁」。
嵌套确实存在：云同步 push 直接调底层 `exportDatabaseBackupToPath`
（`apps/desktop/.../cloud-sync.service.ts:391-396` 的 dbSync 适配器），
而本地备份导出走 `exportDatabaseBackup` → 同一个底层函数。
布尔语义下，底层 `finally` 的 release 会把外层仍持有的窗口提前清零。
计数语义（`maintenanceBusyCount += 1` / `Math.max(0, -1)`，`:24-34`）自平衡且不提前清位，
并保留 `setDesktopDbMaintenanceBusy` 兼容旧调用形态（`:42-48`）。
出处：`docs/Iterations/binary-blob-and-vfs-pack/cr-fix-spec-integration.md:300`（ic-20 条目）。
**这是有据可查的缺陷修复，不是过度设计。**

**辩护 11｜busy 抽成零依赖独立小模块，是为了打断循环 import——理由写在文件头。**

`db-maintenance-busy.ts:3-7`：「db-maintenance.service 需要读 cloud-sync 的 syncBusy，
而 cloud-sync 的 getLocalStatus 又要回报 maintenanceBusy，两侧互相引用会形成循环 import」。
双端同构（`apps/mobile/src/services/db-maintenance-busy.ts:1-13`）。合理的依赖倒置。

## D. 服务商三表 scrub/restore 与还原前校验

**辩护 12｜「密钥不出设备」是导出备份与云同步共用的核心安全承诺。**

导出路径：checkpoint → `copyFile` → 对**副本** ATTACH 后清三表
（`db-backup.service.ts:78-85`，`scrubProviderTablesInDatabase`）。注意清的是副本
（`provider-table-snapshot.ts:61-72`），本机主库不受影响。测试 DB-3 实锤
「ATTACH 副本 scrub 后附件库无服务商行且主库不变」（`packages/core/test/db-backup/provider-table-snapshot.test.ts:208`）。

**辩护 13｜restore 前的 service 级校验把「raw INSERT 绕过 upsert」的漏洞补齐，且校验在事务外。**

`provider-table-snapshot-validate.ts:4-9` 的文件头写明动机：db-backup import /
cloud-sync pull 两条入口此前直接 raw INSERT，绕过 service upsert，schema CHECK 只能拦
protocol enum，对空 display_name、saved_model 悬空 FK、sksp 字段类型失防。
校验**在事务外**执行（`provider-table-snapshot.ts:86`，`validateProviderTableSnapshot(snapshot)`
在 `conn.transaction` 之前），注释解释得很清楚：「任意行非法直接抛 ProviderTableSnapshotError，
**主库保持原状**」。**先校验后开事务 = 失败不留半成品**，是正确的顺序。
测试 T-SC12a-e 覆盖五种脏数据（`provider-table-snapshot.test.ts:268-352`）。

**辩护 14｜FK 顺序（restore 先父后子、scrub 先子后父）是必要的，不是风格问题。**

`RESTORE_TABLE_ORDER`（`provider-table-snapshot.ts:17-21`）先 `llm_provider` 再
`llm_saved_model`；`SCRUB_TABLE_ORDER`（`:24-28`）反过来。**`llm_saved_model.provider_id`
有 FK 指向 `llm_provider`**，两个方向各自正确才不触发约束失败。

## E. 其它

**辩护 15｜Core 不引入 `node:crypto`，哈希/文件 IO 全部宿主注入，是双端复用的硬约束。**

`cloud-sync-coordinator.ts:29` 注释：「协调器依赖：哈希与文件读取由调用方注入
（**Core 不使用 node:crypto**）」。mobile 是 Hermes，装不了 Node 内置模块；
spec 也把这条列为现状约束（`spec.md:224`「Core 依赖：无 `node:crypto` → sha256 在
driver / app 层计算，Core 只比对 hex 字符串」）。`RULE.md`「移动端（Hermes）没有 WebAssembly」
条目进一步说明该环境的约束基调。

**辩护 16｜mobile 导入走「分块落盘 → 路径级 cp」而非整包 base64，是对 Hermes 堆的正确防御。**

`apps/mobile/src/services/db-backup.service.ts:4`：「大备份（数十～上百 MB）**禁止整包读入
JS / base64 往返**，导入统一走路径级 cp」；`:37` `WRITE_CHUNK_BYTES = 256 * 1024`
注释「避免 100MB+ Uint8Array → 单次 base64 撑爆 Hermes 堆」；
`:58-68` 还专门记了 `fs.readFile(path, enc, 16)` 第三参会被忽略、整包读入必 OOM 的坑。
**连注释都记录了踩过的具体坑——这是经过实战的防御，不是想象出来的。**

**辩护 17｜desktop `pull()` 把 `getLocalMeta()` 放进 `try` 内，是有来由的修复。**

`apps/desktop/src/main/services/cloud-sync.service.ts:246-248`：
「getLocalMeta 的读取必须在 try 内（对齐 push() 写法）：若留在 try 外，抛错时
**syncBusy 永不复位，数据清理守卫会被连带锁死**」。回归测试
`apps/desktop/test/cloud-sync-handlers.test.ts:91`「pull 前置 getLocalMeta 抛错后 syncBusy 复位 false」。
**缺陷已被发现、被修复、被测试锁住**——这恰恰是设计质量的正面证据。

**辩护 18｜阿里云 OSS 条件 PUT 降级是已知且有判据的兼容性处理。**

`packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:60-66`
`isAliyunOssEndpoint` + `:194-198`：OSS 不支持 `If-Match`，改为
**head + 客户端断言**再无条件 PUT。这是**有明确注释说明的能力降级**
（`// 阿里云 OSS S3 兼容 API 不支持 PutObject 条件头`），而非疏漏。
代价是 TOCTOU 窗口变宽（见 §5.4 让步），但对不支持条件头的后端，**没有别的选择**——
要么不支持阿里云 OSS，要么降级。降级并注释是正确取舍。

**辩护 19｜进度追踪只在 `__DEV__` 打日志，且 S3 key 只输出末两段，避免泄密。**

`apps/mobile/src/services/cloud-sync-progress-log.ts:2-3`：「不记录 Secret Key；
S3 key 仅输出末段文件名」，`shortStorageKey`（`:29-35`）实现之。
UI 进度与日志解耦（`progress-ui.ts` 独立映射表），`op === 'test'` 时不发 UI 回调
（`progress-log.ts:51`）——测试连接是纯探测，不该弹进度遮罩。

---

# 二、确无辩可辩的让步清单

> 本节条目我**主动放弃辩护**，并给出证据与建议。

## F-w4-csa-1｜P0｜pull 成功后本机 rev 写不进去（连接已关）

**位置**：`apps/desktop/src/main/services/cloud-sync.service.ts:255-256`
（`setLastSyncedRev` / `recordPull`）；mobile 同构点
`apps/mobile/src/services/cloud-sync.service.ts:341-345`（`patchCloudSyncLocalStatus`）。

**引文**（desktop）：
```
252      const result = await built.coordinator.pull({
253        lastSyncedRev: meta.lastSyncedRev,
254      });
255      await this.configStore.setLastSyncedRev(result.rev);
256      await this.configStore.recordPull(true, `已同步至 rev ${result.rev}`);
```

**描述**：`this.configStore` 在构造函数里绑定 `runtime.kkv`（`:161-164`），
而 `runtime.kkv` 绑定的是**构造时那条连接**（`create-desktop-runtime.ts:102`
`createKkvService(conn)`）。pull 内部 `importSnapshotFromPath` →
`importDatabaseBackupFromPath` → `closeLiveDbForBackupImport()` **关掉了这条连接**
（`db-backup.service.ts:115` → `:32-35`）。此后第 255 行用**同一条已关闭的 kkv 句柄**写
`lastSyncedRev`，必然抛 `CONNECTION_CLOSED`。

**实测证据**（真实驱动 + 真实 core 服务，非模拟）：
```
[nm-boot] migration applied: dedup-file-cache-storage-v1
pre-import  lastSyncedRev = 1
POST-IMPORT setLastSyncedRev: THREW -> CONNECTION_CLOSED | Connection is closed
POST-IMPORT get: THREW -> CONNECTION_CLOSED | Connection is closed
```
探针复刻 `createKkvService(conn)` + `conn.close()` + `kkv.set` 的真实序列，
驱动侧 `BetterSqlite3Connection.assertOpen()` 抛 `CONNECTION_CLOSED`
（`packages/tdbc-driver-better-sqlite3/src/connection.ts:153-159`）。
mobile 侧驱动同款语义（`packages/tdbc-driver-op-sqlite/src/connection.ts:237-238`）。

**后果**：pull 的 rev 推进不落库 → 下次打开仍是旧 `lastSyncedRev` → 反复拉同一 rev；
更糟的是**这一抛错发生在 `recordPull` 之前**，会把一次成功的拉取在 UI 上记成失败
（`:258-266` catch 分支），而库文件其实已经换掉了。

**现有测试为何没抓到**：`apps/desktop/test/cloud-sync-handlers.test.ts:91-105` 只覆盖
「`getLocalMeta` 在 try 内抛错」这一条；mobile
`apps/mobile/__tests__/cloud-sync.service.test.ts:172-189` 全程 mock 掉
`patchCloudSyncLocalStatus`（`:29-31`）与 import，**结构上无法观测到连接已关**。
这正是 `docs/apm/RULE.md`「验收断言必须圈 scope / 有牙吗」条目警告的假绿形态。

**建议**：pull 成功后不要用旧 runtime 的 kkv 记账。把 rev 记账移到
`rebootstrapDesktopRuntime()` **之后**重新取 runtime/configStore，或让
`importDatabaseBackupFrom*` 返回一个「已换连接」的信号，由调用方在重建后写。
mobile 同理（`patchCloudSyncLocalStatus(runtime, …)` 的 `runtime` 来自
`useRuntime()`，是 rebootstrap 前的旧 runtime）。

**置信**：confirmed（真实驱动实测 + 源码调用链完整闭合）。

## F-w4-csa-2｜P2｜push/agent 互斥锁没有 agent 侧接线，且未导出，apps 层拿不到

**位置**：`logic/push-agent-mutex.ts`（整文件）+ `impl/cloud-sync-coordinator.ts:49,60,119`。

**引文**（模块头，`push-agent-mutex.ts:6-8`）：
```
 * 之前 coordinator 只在 push 入口采样一次 `isAgentActive`，整个上传过程
 * 不再复检，agent 抢跑就静默拿到脏数据。这里加一把进程内互斥锁，让
 * push 和 agent 启动入口排队等对方，超时再降级拒绝，避免死等。
```

**描述**：这把锁**目前只互斥了 push-vs-push**，agent 侧没有任何 acquire 方。
更关键的是 `PushAgentMutex` 与 `getDefaultPushAgentMutex` **都没从
`infra/cloud-sync/index.ts` 导出**。

**我独立复核的证据**（不依赖任何 raw/ 报告）：
```
$ rg -n "PushAgentMutex" packages/core/src/infra/cloud-sync/index.ts packages/core/src/index.ts
NO MATCH - not exported from either index
```
`index.ts` 全文（45 行）导出 `CloudSyncError`、`ObjectStoragePort`、`DbSyncPort`、
`parseCloudSyncStatus`、锁四函数、`normalizePrefix/statusKey/snapshotKey`、
`CloudSyncCoordinator`——**没有 `PushAgentMutex`**。
故 apps 层即便想接，从公开导出面也拿不到，这是「接线未完成」的硬证据。

**出处在 commit 里**：`856d8588` 的提交信息明写「**apps runtime 后续通过
`getDefaultPushAgentMutex()` 单例接入 agent 启动入口**」——「后续」二字说明作者
**明知未接、留作后续**。所以这不是设计错误，是**未完成的 TODO**。
但模块头与 `cloud-sync-coordinator.ts:49` 的注释把「agent 启动入口排队」写成了既成能力，
**注释与现实不符**，会误导后续维护者。

**残留盲区**（即上面那条 finding 里提到的采样守卫覆盖不到的一段）：
协调器复检 `isAgentActive()` 只有两处（`:219` 入口、`:267` 续租点）。
agent 若在「上传完成 → final status PUT 之间」抢跑写入，`:267` 已检过、放行，
快照与库就不一致了。这段窗口既无互斥锁也无复检。

**建议**：二选一并把注释对齐现实。
①（推荐）把 `PushAgentMutex` + `getDefaultPushAgentMutex` 加进
`infra/cloud-sync/index.ts` 与 `packages/core/src/index.ts`，在
`apps/desktop/src/main/ipc/handlers/agent.ts:411` 与 mobile agent 入口
acquire/release；② 若短期不接，把模块头与 `:49` 注释改成
「当前仅互斥并发 push，agent 侧靠 `isAgentActive` 采样守卫
（已知盲区：上传完成到 final PUT 之间）」。

**置信**：confirmed（导出面 grep 为确定性核对；接线状态为全仓引用集合核对）。

## F-w4-csa-3｜P2｜lease 跨设备时钟依赖

**位置**：`logic/lock.ts:19`。

**引文**：
```
19    return Date.parse(lock.expiresAt) > Date.now();
```

**描述**：租约有效性用**本机时钟**与远端写入的 ISO 字符串比较。若某设备时钟快 20 分钟，
它会把别人尚未过期的锁判为已过期（`isEffectiveLock` false → `canAcquireLock` true），
从而抢走有效锁。反向则会让自己的锁被别人抢走。
900s 的租约**放大了**这个偏差的后果——相对误差占比小，但绝对偏差是分钟级。

**为何我辩护不了**：`expiresAt` 写入方用自己时钟、读取方用自己的时钟，
这是一个真实的分布式时间问题，没有任何本地校验能修掉它。

**缓解与建议**：这不要求重做设计。两条低成本改进：
① 在 `status.json` 里加 `uploadedByClockOffsetMs`（写入方记录自己的 UTC 偏移），
读方按偏移校正；② 或在 UI 上提示 lease 冲突时附带双方 `acquiredAt`，便于人工判断。
**现状可接受**（用户自备桶、设备时钟通常由 NTP 同步），但应在
`docs/apm/RULE.md` 记一条「已知盲区」，避免下轮 CR 重复发现。

**置信**：confirmed（代码事实）/ suspected（实际发生概率取决于设备时钟，仓内无校时逻辑证据）。

## F-w4-csa-4｜P3｜阿里云 OSS 条件 PUT 降级引入 TOCTOU 窗口

**位置**：`packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:194-198`。

**引文**：
```
194      if (emulateConditionalPut && hasConditionalPut) {
195        const head = await this.head(key);
196        assertConditionalPutPreconditions(head, options);
197        putOptions = undefined;
198      }
```

**描述**：head 与 put 之间无原子性保证，两台设备可同时通过断言后先后无条件 PUT，
后者覆盖前者。对 Aliyun OSS 端点，`LOCK_CONTENTION` 这道 CAS 防线失效。

**为何我辩护不了**：head-then-put 天然非原子，这是降级方案的固有代价
（辩护 18 已说明「没有别的选择」，但代价确实存在）。
非 OSS 端点走真正的 `IfMatch`（`:206`），不受影响。

**建议**：在 `isAliyunOssEndpoint` 的判定处或 spec 里记明「OSS 端点下并发 push 的
冲突保护弱于 S3，冲突时以最后写入者为准」，让用户知情。

**置信**：confirmed（代码事实）。

---

# 三、发现清单（汇总）

| ID | 级别 | 位置 | 摘要 | 立场 |
|---|---|---|---|---|
| F-w4-csa-1 | **P0** | desktop `cloud-sync.service.ts:255-256`；mobile `cloud-sync.service.ts:341-345` | pull 后 `lastSyncedRev` 写入已关闭连接，必抛 `CONNECTION_CLOSED`；真机实测确认 | **让步** |
| F-w4-csa-2 | **P2** | `push-agent-mutex.ts` 全文件 + `cloud-sync-coordinator.ts:49,60,119` | 互斥锁无 agent 侧接线且未导出，注释高估现状；残留 final-PUT 窗口 | **让步** |
| F-w4-csa-3 | P2 | `logic/lock.ts:19` | 租约有效性依赖本机时钟，跨设备时钟偏差可致误判 | **让步** |
| F-w4-csa-4 | P3 | `create-s3-object-storage.ts:194-198` | OSS 条件 PUT 降级为 head-then-put，TOCTOU 窗口 | **让步** |

辩护条目共 19 条（§一 A–E），均有源码/spec/提交信息/RULE 支撑。

# 四、争议与存疑

## 4.1 关于独立性纪律的自我披露

`rg -n "getDefaultPushAgentMutex|PushAgentMutex|pushMutex" --glob "!node_modules"` 一条命令
的输出里**混入了 `docs/Iterations/repo-mega-cr-2026-10/raw/` 下的文件内容**
（`raw/w2-core-infra-misc.md` 的 F-core-infra-misc-3 条、`L0/dead-exports.md`、
`L0/coverage-matrix.csv`）。这是 grep 全仓检索的**附带命中**，非主动定向读取 raw/ 文件；
对抗对检察官报告 `raw/w4-cloudsync-pro.md` **未被打开**，对抗纪律未被破坏。

为确保 §5.2（=本报告 F-w4-csa-2）的结论**不依赖**该次意外命中，我用一条独立命令
（只查两个 index.ts）复核，得到 `NO MATCH - not exported from either index`，
并另行从 `git show 856d8588` 取到提交信息原文作为出处在。**结论与证据链均为独立重建。**

## 4.2 我未能确证的一点

F-w4-csa-1 的 mobile 侧我没有跑真机探针（`op-sqlite` 需要 Android 运行时）。
我依据的是 `packages/tdbc-driver-op-sqlite/src/connection.ts:237-238`
存在与 better-sqlite3 同款 `closed` 判定 + `CONNECTION_CLOSED` 抛出，
以及 `apps/mobile/src/services/cloud-sync.service.ts:341` 的
`patchCloudSyncLocalStatus(runtime, …)` 中 `runtime` 来自 `useRuntime()`
（`apps/mobile/src/hooks/useRuntime.ts:8-14`，返回 rebootstrap **前**的 runtime）。
机制成立，但「真机必现」这一句我按 suspected 而非 confirmed 记。

## 4.3 与潜在检察官的分歧预判

若对方就「整库替换」提出「应做增量同步以省流量」，我维持辩护 1：
本项目 schema 的版本链 / blob 引用 / seq 空洞使行级 merge 的复杂度与风险显著高于
省流量的收益，且 spec 一期已显式排除（`spec.md:12,41`）。
**若对方能指出具体可行的增量方案，我愿意重新评估**——目前没有看到。

# 五、附：关键决策出处索引

| 决策 | 出处 |
|---|---|
| 租约 900s / 上传超 50% 续租 1 次 / 强制覆盖保留 / 默认前缀 / status 单文件承载 manifest+lock / 快照命名 | `docs/Iterations/cross-device-cloud-sync/spec.md:29-38`（SPEC 锁定表） |
| 不做实体 merge、不做后台自动同步、不做 WebDAV | `spec.md:12,41` |
| push/agent 互斥锁「后续接入」（= 未接） | `git show 856d8588` 提交信息 |
| busy 计数/令牌语义与嵌套 bug | `apps/desktop/src/main/services/db-maintenance-busy.ts:9-13`；`docs/Iterations/binary-blob-and-vfs-pack/cr-fix-spec-integration.md:300`（ic-20） |
| pull 的 `getLocalMeta` 必须在 try 内 | `apps/desktop/src/main/services/cloud-sync.service.ts:246-248` + `apps/desktop/test/cloud-sync-handlers.test.ts:91` |
| scrub 副本不动主库 | `packages/core/test/db-backup/provider-table-snapshot.test.ts:208`（DB-3） |
| 还原前校验在事务外 | `packages/core/src/infra/db-backup/provider-table-snapshot.ts:79-92` |
| Hermes 无 WebAssembly / 无 Node 内置 | `docs/apm/RULE.md`「实现禁令与坑」相关条目 |

# 六、自查残留

- 探针脚本：`D:\Dev\nm-worktree\mcr\tmp\w4-cloudsync-adv-probe.mjs`（模拟版）、
  `D:\Dev\nm-worktree\mcr\tmp\w4-cloudsync-adv-e2e.mjs`（真实驱动版）。
  二者在仓库 `tmp/` 下（根 `.gitignore` 已忽略 `tmp/`），供复核者重跑；不再需要时可删。
- 未做任何 git 写操作；未创建/修改 `docs/apm/` 下任何文件。