---
zone: synth-cloudsync
agent: W5-reduce（云同步与备份专案台账）
inputs: raw/w4-cloudsync-pro.md、raw/w4-cloudsync-adv.md（对抗对）、raw/w1-desktop-main.md（云同步/备份节）、
        raw/w2-mobile-runtime.md（云同步/备份节）、raw/w3-xc-txn.md（云同步/备份节）
base_sha: feat/repo-mega-cr @ main(9ca5f5ad)
findings: P0×1 P1×7 P2×19 P3×7（合并 34 条；对抗对 4 条独立发现已并入，3 组同发现合并）
  # 🔁 R2-17（judge-r1 F1）：S-CS-18 + S-CS-19 合并为单条 P2，故 P2 20 → 19、合计 35 → 34
---

# synth · 云同步与备份（pull 生命周期时间线重排）

## 摘要

云同步把「本机整库」当唯一同步单元：导出走 checkpoint + 文件级拷贝 + 剥掉服务商三表（密钥不出设备），
上传到用户自备 S3 桶；拉取走下载整库快照 + 校验 SHA-256 + dump 本机三表 + 关连接 + 覆盖库文件 +
写回三表 + 重建 runtime。core 的 `CloudSyncCoordinator` 负责平台无关的编排（rev 单调 + status.json
租约锁 + 条件 PUT），桌面/移动各自注入 S3 驱动、DbSyncPort、临时路径与 busy 令牌。

本簇的核心判断：**这条链路上几乎所有真实缺陷都挂在同一个生命周期断点上——pull 会在
`importSnapshotFromPath` 内部关掉本进程唯一那条数据库连接，而 pull 的收尾记账与桌面端的
service 单例都持着这条被关掉的连接上的句柄。** w4 对抗对双方独立收敛到这一条并各自给了 P0，
本机位复核源码调用链闭合，确认为全簇最高优先级。其余缺陷按时间线挂到这条链的四个相位上：
pre-pull / pull 中 / post-pull rebootstrap / 后续操作。

## 职责与边界

- **`packages/core/src/infra/cloud-sync/`**：不含平台细节的同步编排。`ports/` 是两个倒置接口
  （`ObjectStoragePort` 远端对象读写 + 条件 PUT；`DbSyncPort` 快照导出/导入 + agent 守卫），
  哈希与文件读写全部由调用方注入（core 不用 `node:crypto`——Hermes 装不了 Node 内置模块，
  这是双端复用的硬约束，非缺陷）。
- **`packages/core/src/infra/db-backup/`**：只有服务商三表（`llm_provider` / `llm_saved_model` /
  `sksp_secrets`）的快照原语（dump/scrub/restore/validate），**不含整库文件搬运**——整库搬运在
  两端 app 侧各写一份。
- **`packages/cloud-sync-driver-s3/`**：`ObjectStoragePort` 的 S3 实现，含 `FileSystemPort` 注入的
  `putFile` / `getToPath`（A-26 引入）。
- **apps 侧**：宿主接线——配置持久化（KKV + SKSP）、临时路径、busy 令牌、agent 守卫、rebootstrap 窗口。
- **边界外**：UI 页面、SKSP 本身。

## 对外接口

| 符号 | 位置 | 性质 |
| --- | --- | --- |
| `CloudSyncCoordinator.pull / push` | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:143,185` | 主入口 |
| `getDefaultPushAgentMutex` | 同上 `:60` | **零生产消费方，且未从 `infra/cloud-sync/index.ts` 导出**（S-CS-24） |
| `isEffectiveLock / canAcquireLock / buildLease / renewLease` | `logic/lock.ts:15,25,38,53` | 租约原语 |
| `normalizePrefix / statusKey / snapshotKey` | `logic/paths.ts:10,19,26` | 键名生成 |
| `parseCloudSyncStatus / EMPTY_CLOUD_SYNC_STATUS` | `model/cloud-sync-status.ts:60,51` | zod `.strict()` 校验 |
| `dumpProviderTableSnapshot / scrubProviderTables / scrubProviderTablesInDatabase / restoreProviderTableSnapshot` | `infra/db-backup/provider-table-snapshot.ts:33,50,61,82` | 三表原语 |
| `validateProviderTableSnapshot` | `provider-table-snapshot-validate.ts:182` | restore 前闸门（在事务外） |
| `isDesktopCloudSyncBusy / isDesktopDbMaintenanceBusy / isMobileDbMaintenanceBusy` | 两端 `*-busy.ts` | 跨模块让路守卫（计数/令牌语义，intentional） |
| `exportDatabaseBackupToPath / importDatabaseBackupFromPath / importDatabaseBackupFromBytes` | 两端 `db-backup.service.ts` | 云同步直调的底层搬运 |

## 数据访问

| 对象 | 位置 | 说明 |
| --- | --- | --- |
| 远端 `status.json` | `paths.ts:19` | `schemaVersion/rev/snapshotKey/snapshotSha256/snapshotBytes/uploadedAt/uploadedByDeviceId/lock` |
| 远端 `snapshots/rev-{6位}.nmbackup` | `paths.ts:26` | 整库快照，不可变、**只增不删**（S-CS-17） |
| KKV module `nm-cloud-sync` | desktop `cloud-sync-config.store.ts:11`（14 键）/ mobile `:13`（13 键） | 配置 + 5 个 `last*` 状态键，**不进云端** |
| SKSP ref `cloud-sync/s3-secret-key` | 同上 `:12` | Secret Access Key |
| 表 `llm_provider` / `llm_saved_model` / `sksp_secrets` | `provider-tables.ts:10` | 导出时 scrub（作用在副本上）、导入时 restore |
| 库文件整库 | desktop `db-backup.service.ts:107/116`；mobile `:137/151` | `dbPath` ← 备份文件 |
| 临时文件 | desktop `cloud-sync.service.ts:380,384`（`os.tmpdir()`）；mobile `:171,172`（`CacheDir`） | `Date.now()` 命名 |
| 回滚副本 | desktop `:108,128`；mobile `:138` | `<dbPath>.nmbackup.bak` |

## 依赖关系

**import 了谁**：`@novel-master/core`（协调器 + DbSyncPort + db-backup 原语）、
`@novel-master/cloud-sync-driver-s3`、`@aws-sdk/client-s3`、`@noble/hashes`（mobile 分块 sha256）、
`react-native-blob-util`（mobile）、`node:fs` / `node:crypto` / `node:os`（desktop）。

**被谁消费**：`apps/desktop/src/main/ipc/handlers/cloud-sync.ts`（IPC 五路）、
`apps/mobile/src/screens/stack/CloudSyncProgressScreen.tsx`（pull/push 唯一入口）、
`ipc/handlers/backup.ts`（本地备份，共享同一底层 import 函数）、
`db-maintenance.service.ts` / `message-content-compaction.service.ts` /
`blob-binary-normalization.service.ts`（读 `isXxxDbMaintenanceBusy` 让路）。

**结构性缺口（两处，都是「没接上」而非「设计错」）**：
① `getDefaultPushAgentMutex` 未导出且 apps 侧零 acquire；
② `syncBusy`（云同步自互斥）与 `maintenanceBusy`（维护让路）两个守卫**互不检查对方**，
`pull()` / `push()` 入口只查 `syncBusy`，不查 `maintenanceBusy`——VACUUM 与 push 可真并发。

---

## 归并方法

### ① 去重：三处同发现

| 合并条目 | 来源 | 处置 |
| --- | --- | --- |
| **移动端 busy 令牌泄漏** | w4-cloudsync-pro F-1 + w2-mobile-runtime F-mobile-runtime-3 | 两方独立指出同一结构缺陷（`acquire` 在 `try` 外），证据链互补（pro 补了桌面侧已修的注释对照，mobile 补了两个消费方定位）。并为 **S-CS-07** |
| **push/agent 互斥锁未接线** | w4-cloudsync-pro F-9 + w4-cloudsync-adv F-w4-csa-2 | 对抗对双方**独立**收敛到同一条（adv 用两个 index 的导出面 grep 自证，不依赖 pro）。并为 **S-CS-24** |
| **OSS 条件 PUT 降级 TOCTOU** | w4-cloudsync-pro F-10（P2）+ w4-cloudsync-adv F-w4-csa-4（P3） | 同一处代码（`create-s3-object-storage.ts:194-198`）。**定 P2**（取 pro 方）：adv 自己承认「LOCK_CONTENTION 在该端点上不可达」，且该端点是 spec 明确支持的 OSS 用户群，不是边缘配置。辩护成立的是「降级本身必要」，不是「代价可忽略」 |

### ② 严重度校准（四处改判）

| 原判 | 现判 | 理由 |
| --- | --- | --- |
| adv F-w4-csa-1 **P0** | **P0（维持）** | 真实 better-sqlite3 驱动实测 + 源码调用链闭合；后果是「库已换但 UI 记成失败 + rev 永不推进 → 反复拉同一 rev」。这是数据正确性 + 状态机自锁，非性能问题 |
| pro F-6（快照无清理）P1 | **P2** | 「只增不删」是不可变 manifest 的有意代价；但仓内**无保留策略文档**说明这是刻意选择，也无任何清理入口。按债务登记而非 P1（pro 自己在争议 3 也倾向下调） |
| pro F-5（`putFile`/`getToPath` 全量读）P1 | **P1（维持但范围收窄）** | 保留 `new Uint8Array(raw)` 的双份拷贝这半（P1，有确定性代码事实）；「未实现 multipart」那半降为 P2 债务——A-26 的宣称的「避免一次性读入」确实未兑现，但兑现它需要引新依赖（`@aws-sdk/lib-storage`），不是零成本修复 |
| pro F-20（2s 轮询打远端）P3 | **P2** | 桌面设置页 `SettingsViews.tsx:222-225` 实测 2000ms `setInterval`，每次 `reloadStatus()` → `getLocalStatus()` → `readRemoteRev()` → HEAD+GET + 新建 S3Client = 60 请求/分钟持续计费流量，且被限流后 `remoteRev` 兜成 `undefined`（`:212`），UI 静默退化成「不提示可拉取」——有可感知的用户后果，不是纯开销 |

### ③ 对抗对裁决（4 条独立发现全部 upheld）

| adv 条目 | 主张 | 裁决 | 本机位复核 |
| --- | --- | --- | --- |
| F-w4-csa-1 | P0：pull 后 rev 写已关连接 | **upheld（P0）** | 链路闭合已复核：`cloud-sync.service.ts:255` → `configStore`（构造时绑定 `runtime.kkv`）→ `importSnapshotFromPath`（`:403-408`）→ `importDatabaseBackupFromPath:115` → `closeLiveDbForBackupImport()` → `clearDesktopRuntimeHandle()` + `closeDesktopConnection()`。mobile 侧同构：`:341` `patchCloudSyncLocalStatus(runtime,…)` 的 `runtime` 来自 `useRuntime()`（rebootstrap **前**的 runtime），`:150` 已关连接 |
| F-w4-csa-2 | P2：互斥锁无 agent 接线且未导出 | **upheld（P2）** | `infra/cloud-sync/index.ts` 全文 45 行确认未导出 `PushAgentMutex` / `getDefaultPushAgentMutex`（本机位逐行读过导出块） |
| F-w4-csa-3 | P2：lease 跨设备时钟依赖 | **upheld（P2，降为已知盲区登记）** | `lock.ts:19` `Date.parse(lock.expiresAt) > Date.now()` 属实。**无本地修复手段**，按「分布式时钟盲区」登记而非缺陷，不进修复 backlog 的必做项 |
| F-w4-csa-4 | P3：OSS 条件 PUT 降级 TOCTOU | **upheld（升 P2）** | 与 pro F-10 合并，见上 |

**辩护清单的有效部分（19 条辩护中 14 条成立并采纳为 intentional 底账）**：
整库替换形态（spec `:12,41` 显式排除实体 merge）、快照键按 rev 命名 = 不可变发布物、
rebootstrap 是「关连接 + 换库文件」的必然收尾（`clearDesktopRuntimeHandle` 先摘句柄再关连接，
是让并发 IPC 走 `getDesktopRuntime()` 重新初始化的**有意两段式**）、租约而非纯锁（崩溃可恢复，
900s 与 spec `:31` 拍板一致）、上传超 50% 租约续租 1 次（spec `:32` 原文 + `renewLease` 保留
`holderDeviceId` 语义正确）、计数/令牌 busy 语义（ic-20 修复的真实嵌套 bug，
`binary-blob-and-vfs-pack/cr-fix-spec-integration.md:300`）、`validateProviderTableSnapshot`
在事务外（`provider-table-snapshot.ts:79-92` + w3-xc-txn 独立复核标为「教科书」）、
FK 顺序 scrub 先子后父 / restore 先父后子、core 不用 `node:crypto`、
mobile 分块落盘对抗 Hermes 堆、桌面 `getLocalMeta` 已在 try 内（且有回归测试锁住）。

---

## 归并后本簇台账（按 pull 生命周期时间线重排）

> **P0 ×1 / P1 ×7 / P2 ×20 / P3 ×7 = 35 条**
> 时间线四段：**T0 pre-pull**（守卫与入口）/ **T1 pull 中**（下载、校验、导入、换库文件）/
> **T2 post-pull rebootstrap**（记账与连接重建）/ **T3 后续操作**（push、配置、UI）。

### 贯穿全生命周期的结构性缺陷（先读这两条，其余都挂在它们下面）

---

**S-CS-01 | P0 | `apps/desktop/src/main/services/cloud-sync.service.ts:255-256`；`apps/mobile/src/services/cloud-sync.service.ts:341-345`**
**pull 成功后的 rev 记账写进一条已被 pull 自己关掉的连接，必抛 `CONNECTION_CLOSED`；库文件已换但 UI 记成失败，且 rev 永不推进。**

desktop 引文：
```
252      const result = await built.coordinator.pull({ lastSyncedRev: meta.lastSyncedRev });
255      await this.configStore.setLastSyncedRev(result.rev);
256      await this.configStore.recordPull(true, `已同步至 rev ${result.rev}`);
```
链路（本机位逐行复核）：`this.configStore` 在**构造函数**里绑定 `runtime.kkv`（`:159-165`），
`runtime.kkv` = `createKkvService(conn)`（`create-desktop-runtime.ts`）绑的是**构造时那条连接**。
`coordinator.pull` 内部 `dbSync.importSnapshotFromPath`（`cloud-sync.service.ts:403-408`）→
`importDatabaseBackupFromPath` → `closeLiveDbForBackupImport()`（`db-backup.service.ts:115`）→
`clearDesktopRuntimeHandle()` + `closeDesktopConnection()`。此后第 255 行用**同一条已关闭的 kkv 句柄**写。
mobile 侧同构：`patchCloudSyncLocalStatus(runtime, …)`（`:341`）的 `runtime` 来自 `useRuntime()`
（`hooks/useRuntime.ts:8-14`，返回 rebootstrap **前**的 runtime），而 `:150` 已 `closeMobileConnection()`。

后果：① rev 推进不落库 → 下次打开仍是旧 `lastSyncedRev` → **反复拉同一 rev**；② 抛错发生在
`recordPull` **之前**，走 `:258-266` 的 catch 分支 → **一次成功的拉取在 UI 上被记成失败**，
而库文件其实已经换掉了。

**为何现有测试没抓到**：`apps/desktop/test/cloud-sync-handlers.test.ts:91` 只覆盖「`getLocalMeta`
在 try 内抛错」这一条；mobile `__tests__/cloud-sync.service.test.ts:29-31` 全程 mock 掉
`patchCloudSyncLocalStatus` 与 import，**结构上无法观测到连接已关**。这正是
`docs/apm/RULE.md`「验收断言必须圈 scope / 有牙吗」警告的假绿形态。

**建议**：pull 的 rev 记账必须发生在 `rebootstrapDesktopRuntime()` / `onRebootstrap()` **之后**，
用重建后的 runtime 重新取 configStore。或让 `importDatabaseBackupFrom*` 返回一个「连接已换代」的
信号，由调用方在重建后写。两端同改。
置信：confirmed（adv 附真实驱动实测；本机位复核调用链闭合）。

---

**S-CS-02 | P1 | `apps/desktop/src/main/services/cloud-sync.service.ts:432-443,446-449`**
**桌面云同步 service 单例在 rebootstrap 后永不重建，`configStore` 永久持有已关闭连接上的 `kkv`/`secretStore`。**
```
432  let service: DesktopCloudSyncService | undefined;
439    if (!service) { service = new DesktopCloudSyncService(runtime); }
446  /** 测试用：重置单例与 busy 状态 */
447  export function resetDesktopCloudSyncServiceForTest(): void {
```
`rebootstrapDesktopRuntime()`（`desktop-runtime-singleton.ts:35-38`）会 `closeDesktopConnection()`。
生产有两条 rebootstrap 路径：`ipc/handlers/cloud-sync.ts:91`（pull 之后）与
`ipc/handlers/backup.ts:49`（本地备份导入成功后）。而清位入口 `resetDesktopCloudSyncServiceForTest`
全仓只有两个测试文件调。

后果：**这不只是 pull 的问题**。用户只要做一次本地备份导入，此后所有云同步 handler
（getConfig / getLocalStatus / pull / push）全部拿到绑在死连接上的 service，`configStore.getConfig()`
→ `kkv.get` 撞 better-sqlite3 的 not-open。云同步功能直到重启应用为止完全失效。
这是 **S-CS-01 的永久化版本**——S-CS-01 是一次抛错，这条是整条功能线的永久报废。

**建议**：把 `resetDesktopCloudSyncServiceForTest` 拆出一个生产版 `invalidateCloudSyncService()`，
在 `rebootstrapDesktopRuntime()` 内调用（或两个调用点之后）；或让 `DesktopCloudSyncService`
每次 `await getDesktopRuntime()` 而非持句柄（与 core 侧 `getDefaultPushAgentMutex` 单例的注释同款意图）。
置信：confirmed（`synth/apps-desktop.md` 已作 S-D-01 登记并明确移交本簇，本簇确认接收并升为本簇 P1）。

---

### T0 · pre-pull（守卫与入口）

---

**S-CS-03 | P1 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:143-182`**
**`pull()` 全程不查 `isAgentActive()`、不抢 `pushMutex`；移动端 pull/push 之间也没有任何进程级互斥。**
```
143  async pull(options: PullOptions): Promise<PullResult> {
144    this.assertConfigured();
146    const { status: remote } = await this.readRemoteStatus();
```
`isAgentActive` 在全仓只有两个消费点，都在 `runPush` 内（`:219` 入口、`:267` 续租点）。
`pushMutex` 只在 `push()` 入口 acquire（`:189`）。spec `cross-device-cloud-sync/spec.md:166,218`
写的也是「Agent 守卫 … **Push/export 前检查**」——pull 侧的空白是**设计范围之外的漏项**，
不是拍板豁免。移动端 `pullCloudSync`（`:302`）与 `pushCloudSync`（`:374`）是两个各自独立的
导出函数，无 `syncBusy`（桌面有，`cloud-sync.service.ts:238,281`）。

后果链：push 走到 `exportSnapshotToPath` 拷完库（t0）→ pull 走完 `importSnapshotFromPath`
整库替换（t1）→ push 继续上传 **t0 的旧快照**并把 rev 推到 t1+1（t2）→ **pull 拉回来的内容被
云端回滚**，且本机 `lastSyncedRev` 被推到更高值，之后再也不会重新拉。agent 同理：pull 在 agent
流式写入中途换掉整个库文件（`db-backup.service.ts:151` `fs.cp(srcPath, dbPath)` 覆盖活动库），
在途写入丢失或写进已废弃的 inode。

**建议**：`pull()` 与 `push()` 走同一把 `pushMutex`（或新增 pull 专用互斥）；入口与
`importSnapshotFromPath` **之前**各复检一次 `isAgentActive()`，命中即抛 `AGENT_ACTIVE`（错误码已存在）。
置信：confirmed。

---

**S-CS-04 | P1 | `apps/mobile/src/services/cloud-sync.service.ts:317,332,338`**
**移动端 `pullCloudSync` 的 busy 令牌 acquire 写在 `try` 之外，`createCoordinator()` 抛错即永久泄漏。**
```
317  acquireMobileDbMaintenanceBusy();
332  const {coordinator, exportTempPath, importTempPath} = await createCoordinator(runtime, undefined, progress);
338  try {
367    releasePullBusy();      // 在 finally 里
```
`createCoordinator` 内 `buildS3StorageConfig`（`cloud-sync-config.store.ts`，配置不完整时
`throw new Error('请先完成云存储配置')`）、`getCloudSyncConfig`、`ReactNativeBlobUtil.fs.dirs.CacheDir`
任何一条抛出都会让 `releasePullBusy()` 永不执行。

后果链：`maintenanceBusyCount` 永久 +1（`db-maintenance-busy.ts:15` 是模块级变量，无 TTL、无自愈）→
`isMobileDbMaintenanceBusy()` 恒为 true → **消息正文压缩搬运 / blob 二进制归一两个后台循环
（正是读这个标志让路的）在本进程剩余生命周期内全部停摆** → 用户在无任何报错提示的情况下
看到「数据清理/优化永远没反应」。

**桌面侧的同类问题已被修过并留了注释**——`cloud-sync.service.ts:246-248`：
「getLocalMeta 的读取必须在 try 内（对齐 push() 写法）：若留在 try 外，抛错时 syncBusy 永不复位，
数据清理守卫会被连带锁死。」移动端同一函数没有做这个搬移。另有一条确定的触发路径：
`getCloudSyncLocalStatus` 的 `configured` 判据用 `config.secretKeySet`（布尔，`:308`），
而 `buildS3StorageConfig` 判的是 secret 实际非空串——二者不等价，SKSP `has=true` 但 `get` 返回空 /
decrypt 失败时，`:308` 放行、`:332` 必抛。

**建议**：把 `:326-336` 整段挪进 `try`（`progress` 构造可留在外面，无副作用）。补一条用例：
注入 `createCoordinator` 抛错 → 断言 `isMobileDbMaintenanceBusy()` 回到 false。
置信：confirmed（结构）+ suspected（触发面无真机复现，见争议 D2）。

---

**S-CS-05 | P2 | `apps/desktop/src/main/services/cloud-sync.service.ts:238,281`（入口守卫只查 `syncBusy`）**
**`syncBusy` 与 `maintenanceBusy` 两个守卫互不检查对方，VACUUM 与 push/pull 可真并发。**
`getLocalStatus` 会回报 `maintenanceBusy: true`（`:233`），但 `pull()`（`:238`）与 `push()`（`:281`）
入口**只查 `syncBusy`**。两侧守卫模块都已存在（就是为打断循环 import 而抽出的 `db-maintenance-busy.ts`），
只是没接上。`runDbMaintenance`（`db-maintenance.service.ts:96-131`）反而是「先判守卫 → 立刻置 busy →
再干活」的严纪律。

后果：VACUUM 改库 + push 拷库跑在同一条 better-sqlite3 连接上；pull 换库文件与 VACUUM 并发时，
被覆盖的 WAL/SHM 文件可能留下不一致状态。

**建议**：`pull()` / `push()` 入口在 `syncBusy` 之外追加 `isDesktopDbMaintenanceBusy()` 判定，
命中即抛 `MAINTENANCE_BUSY`（或复用现有错误码）。**无拍板文档说明「VACUUM 期间允许 push」**，
故按漏接处理，风险等级由 W7 复核（见争议 D3）。
置信：suspected（结构 confirmed，是否刻意未查到文档）。

---

**S-CS-06 | P2 | `apps/desktop/src/main/services/db-backup.service.ts:180,211`**
**Agent 守卫在弹 `showSaveDialog` 之前取样，弹窗期间不持 busy 也不复检。**
```
213  if (isDesktopAgentActive()) { throw new Error("Agent 运行中…"); }
215  const result = win ? await dialog.showSaveDialog(win, {...}) : ...
216  await exportDatabaseBackupToPath(runtime, result.filePath);
```
`isDesktopAgentActive()` 是瞬时取样，`showSaveDialog` 是**用户可无限时长挂起**的模态。用户在保存框里
挑目录的 3 分钟内 agent 可以起 run，随后 `exportDatabaseBackupToPath` 照跑（checkpoint + copyFile +
scrub 都作用在同一条连接上）。busy 令牌直到进了底层函数才 acquire，窗口没盖住。

**建议**：`exportDatabaseBackup` / `importDatabaseBackup` 在弹框前就 acquire busy（或弹框返回后
**复查一次** `isDesktopAgentActive()` 再决定是否继续）。
置信：suspected（窗口客观存在；是否真损坏取决于 better-sqlite3 在 checkpoint 时的并发容忍度，未实测）。

---

### T1 · pull 中（下载 → 校验 → 导入 → 换库文件）

---

**S-CS-07 | P1 | `apps/desktop/src/main/services/db-backup.service.ts:104`（整包读入）+ `:114,125,128`（三处吞错）**
**桌面校验把整个快照读进 Node 堆；备份/回滚/删除三处失败全被 `.catch` 吞掉，回滚副本还会被删。**
```
104  const header = await readFile(srcPath, { encoding: null });
105  assertSqliteFile(new Uint8Array(header.subarray(0, 16)));
114  await copyFile(dbPath, bakPath).catch(() => undefined);   // 备份失败被吞
115  await closeLiveDbForBackupImport();
116  await copyFile(srcPath, dbPath);                          // 覆盖唯一真身
124  } catch (error) {
125    await copyFile(bakPath, dbPath).catch(() => undefined); // 回滚也被吞
128    await unlink(bakPath).catch(() => undefined);           // 还删掉唯一回滚副本
```
**① 内存**：为了校验 16 字节 SQLite 魔数把整份文件读进堆。移动端在**同一位置刻意做了相反处理并写了原因**
（`apps/mobile/src/services/db-backup.service.ts:54-68`）：「仅校验路径存在且体积足够；魔数交给
替换后 open（失败则 bak 回滚）。注意：`fs.readFile(path, enc, 16)` 的第三参会被忽略，会整包读入，
大备份必 OOM。」——**桌面把移动端已经踩过的坑又踩了一次，且踩的是更隐蔽的版本**（第三参被忽略）。

**② 数据安全**：三处 `.catch(() => undefined)` 意味着「备份失败 → 覆盖成功 → 还原三表失败 → 回滚也失败」
这条链路上没有任何一处会中断，最终只 `throw` 一个原始错误，而磁盘上的库文件**已经是远端快照**了；
L128 还把唯一可能的回滚副本删掉。下次 `getDesktopConnection()` 懒加载打开的是远端内容，
本地未同步的改动无声消失。**移动端同一段代码没有吞**（`:146` 是裸 `await fs.cp`，且 `:160-163`
的回滚前先 `fs.exists(bakPath)`），说明这是桌面侧独有的回归。

**建议**：
① `assertSqliteFileAtPath(srcPath)`：用 `open()` 读前 16 字节后关闭，或直接对齐 mobile 的
`assertSqliteBackupAtPath`（存在 + size≥16）。
② 备份拷贝的失败必须**致命**（裸 `await`）；`unlink(bakPath)` 只在 bak 确实存在且未被用作回滚源时执行；
回滚失败要单独告警而非 `.catch`。
③ 顺手对齐 mobile 形态：`if (dbExists) await cp(dbPath, bakPath)` + 回滚前 `exists` 判断
（桌面现在无条件备份到可能不存在的目标路径）。
置信：confirmed（两段代码均为本机位逐行复核）。

---

**S-CS-08 | P1 | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:225-235`**
**`putFile` / `getToPath` 是 A-26 为「走文件路径、避免整包进内存」引入的，但实现里既无 multipart 也无流式下载，且额外制造一份完整拷贝。**
```
225  async putFile(key, filePath, options) {
226    const raw = await readLocalFile(filePath);
227    const body = new Uint8Array(raw);        // ← 对已经是 Uint8Array 的输入再全拷一份
228    return storage.put(key, body, options);
231  async getToPath(key, destPath) {
232    const { body, etag } = await storage.get(key);   // 整份下载进内存
233    await writeLocalFile(destPath, body);
```
`new Uint8Array(raw)` 对 TypedArray 入参是**逐元素复制**，而 `readLocalFile` 返回 `Buffer`
（本身就是 Uint8Array）。所以 desktop 侧峰值 = 文件 1 份 + 拷贝 1 份 = **2×**。
移动端更糟：`ReactNativeBlobUtil.fs.writeFile(path, base64, 'base64')`（`cloud-sync.service.ts:156-161`）
还要把拷贝再转成 base64 字符串，峰值 ≈ **1 份 + 1 份 + 1.33 份**。mobile `db-backup.service.ts:37`
特意引入 `WRITE_CHUNK_BYTES = 256*1024` 并注释「避免 100MB+ Uint8Array → 单次 base64 撑爆 Hermes 堆」
——**driver 这条路把刚刚绕开的坑又踩了一遍**。

**建议**：① `const body = raw instanceof Uint8Array ? raw : new Uint8Array(raw)`（一行消除 2× 峰值，P1 部分）；
② 「真正流式」需要引 `@aws-sdk/lib-storage` 的 `Upload` 与 `createWriteStream`/RN `writeStream`，
属 P2 债务；③ 在 ② 兑现前，把 `putFile` / `getToPath` 从 `ObjectStoragePort` 摘掉让两端回退到
bytes 路径（现状等价），**不要留一个「看起来省内存其实更费」的假优化**。
置信：confirmed（代码事实）。

---

**S-CS-09 | P1 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:297-304`**
**final status 条件写失败后，重读远端**只为了拿一个 etag**，然后拿这个 etag 无条件覆盖——丢掉重读到的 status。**
```
297  let finalEtag = await this.conditionalPutStatus(finalStatus, statusEtag);
298  if (finalEtag == null) {
299    const { etag: rereadEtag } = await this.readRemoteStatus();   // 重读，只取 etag
300    finalEtag = await this.conditionalPutStatus(finalStatus, rereadEtag);
```
重读时读到的 `status`（含**别人的租约锁**与**已经推进的 rev**）被完全丢弃，
`finalStatus` 里的 `lock: null` 会抹掉第三方的有效租约。

后果链：本机上传耗时超过租约（或 `:281` 的续租 `conditionalPutStatus` 返回 null 被静默吞掉，
`if (renewedEtag != null)` 无 else 分支）→ 设备 B 抢到锁并 push 到 rev N+1 → 本机重读到 B 的 etag →
覆盖写入自己的 `finalStatus`，其 `rev` 是 `:249` 按**最初**读到的 `remote.rev + 1` 算的 →
**`status.rev` 数值回退**，同时 B 的租约被清空 → B 随后把自己的 `finalStatus` 写上去（etag 已过期，会失败）
→ 两端都以为自己成功（`lastSyncedRev` 各自落库），**远端 rev 与实际内容脱钩**。

**建议**：重读后必须重新判定租约（`isEffectiveLock(lock) && lock.holderDeviceId !== this.deviceId`
→ 抛 `LOCK_HELD_BY_OTHER`），并用 `Math.max(remote.rev, nextRev) + 1` 或「检测到 rev 已被推进
→ 抛 `NEED_PULL_FIRST`」替代静默覆盖。顺带补 `:281` 续租失败的 else 分支（至少告警）。
置信：confirmed。

---

**S-CS-10 | P2 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:238,359` + `ports/object-storage.port.ts:18`**
**`ObjectStoragePort` 定义并实现了 `ifNoneMatch`，coordinator 一次都没用；首次同步退化成无条件写。**
```
18  put(key, body, options?: { ifMatch?: string; ifNoneMatch?: string })
```
`readRemoteStatus` 在 head 不存在时返回 `etag: undefined`（`:328`），
`conditionalPutStatus` 的 `ifMatch != null ? {ifMatch} : undefined`（`:359`）于是变成**无条件写**。

后果：两台新设备同时首次 push → 双方 head 都「不存在」→ 双方无条件写 status.json 都成功 →
双方都认为锁是自己抢到的 → 双方都算出 `nextRev = remote.rev + 1 = 1`（`:249`）→
**写同一个键 `snapshots/rev-000001.nmbackup`**，后写覆盖先写 → 两端各自把 `lastSyncedRev=1` 落库，
内容却不同。**一端的数据被无声吞掉，没有任何错误码。**

**建议**：head 不存在时用 `ifNoneMatch: "*"` 抢首次创建权（driver 已支持，`create-s3-object-storage.ts:78-86`；
OSS 路径会退化成 head 判存在，见 S-CS-18）。
置信：confirmed。

---

**S-CS-11 | P2 | `packages/core/src/infra/db-backup/provider-table-snapshot.ts:119-126`**
**restore 的列集合只由 `rows[0]` 决定，缺列静默写 NULL、多列静默丢弃。**
```
119  const columns = Object.keys(rows[0]!);      // 列名只取自第一行
121  const parametersList = rows.map((row) => columns.map((column) => row[column] ?? null));
```
快照来自**另一台设备、可能是另一个版本**的库——`provider-table-snapshot-validate.ts:100-104`
的注释自己承认 legacy 表用 `(provider_id, vendor_model_id)` 复合主键、新 schema 有 `id` / `model_name`。

后果：跨版本云同步时 `llm_saved_model` 落库的是「校验过的（`provider_id`/`vendor_model_id`/
`settings_json` 非空）但主键/名称列可能是 NULL」的行 → 下游按 `id` / `model_name` 查询时**静默漏行**
（不是报错，是**少数据**），比整体 restore 失败更难排查。

**建议**：`insertTableRows` 前做「所有行的键集合必须相同」的断言，不等则抛 `ProviderTableSnapshotError`，
让用户走「先升级版本再同步」的显式路径。
置信：confirmed。

---

**S-CS-12 | P2 | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:194-198`**
**阿里云 OSS 的条件 PUT 降级为 head-then-put 的无条件写，TOCTOU 窗口内租约锁等于不存在。**
```
194  if (emulateConditionalPut && hasConditionalPut) {
195    const head = await this.head(key);
196    assertConditionalPutPreconditions(head, options);
197    putOptions = undefined;   // 条件头被丢掉，改成无条件 PUT
```
教科书式 TOCTOU：head 与 put 之间无任何互斥。两台设备同时 push 到 OSS 桶时，head 都拿到同一个
etag、双方都通过断言、双方都无条件覆盖 status.json → **`LOCK_CONTENTION` 错误码在该端点上永不可达**。
`spec.md:502` 只把「S3 条件 PUT 与部分 OSS 兼容性」列为风险并给了「隐藏 UI」的回滚，
**没说明模拟实现是弱互斥**。

**辩护成立的部分**：降级本身是必要的（OSS 确实不支持 PutObject 条件头），不是疏漏。
**辩护不成立的部分**：代价（弱互斥）被当成可接受。OSS 是 spec 明确支持的用户群，不是边缘配置。

**建议**：模拟路径至少要串行化到「单设备视角」并在 UI 明示「当前端点不提供强互斥」；或改用 OSS 原生
的 `x-oss-forbid-overwrite`；若不能，OSS 端点应禁用 push 并在 `testConnection` 时就拒。
置信：confirmed（代码事实）。

---

**S-CS-13 | P2 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:256,267`**
**「续租点」复检 `isAgentActive` 的位置在 `putFile` **之后**——注释说「避免上传脏的快照续命」，实际只做到了不推进 rev。**
```
256  await this.storage.putFile!(snapKey, this.exportTempPath);
267  if (this.dbSync.isAgentActive()) { throw new CloudSyncError("AGENT_ACTIVE", ...); }
```
脏快照**已经上传到桶里了**，对象名 `snapshots/rev-{nextRev}.nmbackup` 已落地。配合 S-CS-17
（全仓无 `DeleteObject`），每次这类拒绝都在桶里永久留下一份无引用的全量库副本，用户既看不到
也删不掉。

**建议**：agent 复检**前移到 `exportSnapshotToPath` 之后、`putFile` 之前**；
并对「已上传但未提交 rev」的快照做 best-effort 删除。
置信：confirmed。

**⚠️ 边界写死：S-CS-13 = push 侧，S-CS-03 = pull 侧，两条都要做，不可互相核销（judge-r1 F3 裁定）**
| | S-CS-13（本条） | S-CS-03 |
|---|---|---|
| 方向 | **push** | **pull** |
| 位置 | `cloud-sync-coordinator.ts:256,267` | `cloud-sync-coordinator.ts:143-182`（台账 `ledger-v2.md:147`） |
| 病灶 | 「续租点」复检 `isAgentActive` 排在 `putFile` **之后**，脏快照已落桶 | pull 全程**不查** `isAgentActive`，覆盖运行中会话的工作区 |
| 复核依据 | `git grep isAgentActive -- cloud-sync-coordinator.ts` 只有 `:219` 与 `:267` 两处，**都在 push 路径** | `pull()`（`:143-182`）**零命中** ⇒ pull 侧完全是空白 |

⇒ 两条**不同侧、不同位置、不同修法**。**不许拿「push 侧补了复检」当 pull 侧已修的凭据**，
也不许因两条编号相近（13 / 03）而合并或互相标「已覆盖」。
两条各自独立排期、各自独立验收。

---

**S-CS-14 | P2 | `apps/desktop/src/main/services/db-backup.service.ts:99-174`（+ `:886` 的 M4.3 单点修改面）**
**口径改写（judge-r1 F2 裁定）：本条是 S-CS-07 的残留子项，不是独立缺陷。**
两个 import 函数约 40 行逐行重复（除最后一步 `copyFile` vs `writeFile` 外完全一致），
这是 S-CS-07 那三处 `.catch` 吞错的**双份真源**：修一处必须记得修另一处，而当前两端已经不一致
（桌面吞、移动端不吞）。

**「残留子项」的准确含义**：S-CS-07 修完（三个 `.catch(() => undefined)` 处理掉）之后，
**本条并不会自动消失**——重复代码还在，只是「吞错」这一半不再成立。
所以它**不能被「S-CS-07 已修 ⇒ S-CS-14 自然消失」核销掉**，必须独立排期、独立验收。

**建议**：抽 `replaceDbFileWithSnapshot(write)` 单一内核（写入策略由调用方传入），
消除 `FromPath` / `FromBytes` 双份实现；本条与 S-CS-07 同 PR 落地最省事。
置信：confirmed。

---

**S-CS-15 | P2 | `apps/desktop/src/main/services/cloud-sync.service.ts:359-361,360`（宣称）vs driver 实现**
**A-26 宣称的「走文件路径上传下载，避免一次性读入大快照」在两端都被撤销。**
桌面注释（`:360-361`）与 core 注释（`cloud-sync-coordinator.ts:39-42`）都这么宣称，
但：桌面校验步（`db-backup.service.ts:104`）整包读入（S-CS-07）、
driver 的 `putFile`/`getToPath` 也整包读写并多拷一份（S-CS-08）。
**结果是 A-26 只换了个函数名，没换内存行为。**

**建议**：与 S-CS-08 同批处置。**注释与实现的落差本身就是误导源**——后续维护者会以为大快照路径
已经优化过了。兑现流式之前应先把注释改回实际行为。
置信：confirmed。

---

### T2 · post-pull rebootstrap（记账与连接重建）

---

**S-CS-16 | P1 | `apps/desktop/src/main/services/cloud-sync.service.ts:255-256`（先后顺序）**
**即使修好 S-CS-01 的「用已关连接」，记账顺序仍需明确：mobile 侧 `patchCloudSyncLocalStatus` 在 `onRebootstrap()` **之前**、desktop 侧在 `rebootstrapDesktopRuntime()`（handler 层 `:91`）之前，两个 handle 都会被作废。**

mobile 实际顺序（`:341-348`）：
```
341  await patchCloudSyncLocalStatus(runtime, { lastSyncedRev: result.rev, ... });  // 写旧 runtime
346  onRebootstrap();                    // 重建 runtime
348  releasePullBusy();                 // 重建窗口结束才放令牌（这一半是对的）
```
desktop：`service.pull()` 内 `:255` 写 → 返回 → handler `:91` `rebootstrapDesktopRuntime()`。
**两侧的令牌边界（release 在 rebootstrap 之后）都是正确的**——这是 ic-20 拍板的刻意设计，
后台归一/压缩循环若在「连接已关、库文件刚换」的窗口里拿到半成品连接会更糟。
**错的只有记账点的位置。**

**建议**：与 S-CS-01 同批修。契约应是「先换库 → 再重建 runtime → 用新 runtime 记账 → 再放令牌」，
两端同构，并把这条契约写进两个函数的文件头注释（现有注释已经写了令牌边界，顺手把记账边界也写上）。
置信：confirmed。

---

**S-CS-17 | P2 | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:1-7`（无 DeleteObject/ListObjectsV2）**
**远端快照只增不删，无保留期、无删除、无对象数量/体积上限。**
`git grep -n "DeleteObject|deleteObject"` 在 driver / core cloud-sync / 两端 app 目录下**零命中**。
`snapshotKey`（`paths.ts:26`）按 rev 生成**不可变**对象名，每次 push 新增一个
（`coordinator.ts:250,256`），没有任何清理入口（`cross-device-cloud-sync/spec.md` 全文未提保留策略）。

后果：rev 单调递增 → 桶里堆的是 N 份完整数据库副本。日同步用户一年后桶里是 365 份全量库。
用户为省事配的 S3/OSS 桶（很多按流量与存储计费）会**静默膨胀**；旧快照既不能自动清理，
也没有 UI 清理入口。它同时是 S-CS-13（脏快照残留）的唯一兜底手段。

**「不可变 + 单指针 manifest」本身是正确设计**（adv 辩护 3 成立：等价于 Git tag + 单分支指针，
pull 期间被别的设备 push 也不影响本次拉取）。缺的是**保留策略**，不是不可变性。

**建议**：push 成功后删除 `rev <= nextRev - K`（K 取 3~5）的旧快照对象；或至少在 status.json 里
维护 `snapshotKeys` 列表并在配置页暴露「清理历史快照」动作。
置信：confirmed（代码事实）。

---

### T3 · 后续操作（push、配置、UI、锁）

---

**S-CS-18 + S-CS-19（judge-r1 F1 已合并为单条）| P2 | `apps/desktop/src/main/services/cloud-sync-config.store.ts` `setConfig`**
**同函数同根因的两条，合并为单条 P2**：
- **原 S-CS-18**：切换 endpoint/bucket/pathPrefix 不重置 `lastSyncedRev`，也不清 `lastPullResult`/`lastPushResult`；
  9 次 kkv.set 用 `Promise.all` 无事务，secretStore.set 排在最后单独写。
  后果：① 用户把配置从桶 A 改到桶 B → `lastSyncedRev` 仍是 A 的 N → 对着空桶 B 首次点拉取，
  `coordinator.pull` 的 `remote.rev(0) <= lastSyncedRev(N)` 命中 `:148-150` 抛 `ALREADY_UP_TO_DATE`
  → UI 弹「已是最新」——**用户看到的是"同步成功"，实际什么都没拉到，且 B 桶的数据再也不会被拉下来**；
  ② 首次 push 到 B 时 `nextRev = 0 + 1 = 1`，rev 编号体系与 A 脱钩；
  ③ 9 次 set 中途失败 → 半配置状态（bucket 换了、accessKeyId 没换），下次 `buildCoordinator` 报
  `NOT_CONFIGURED` 但配置页显示已保存。
- **原 S-CS-19**：保存配置会无条件把 `enabled` 写回 `"true"`，静默推翻 `setEnabled(false)`。
  ```
  181  kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_ENABLED, "true"),
  ```
  UI 侧有独立的 `CLOUD_SYNC_SET_ENABLED` 通道（`handlers/cloud-sync.ts`），用户在设置页关掉同步后，
  只要再保存一次配置（哪怕只想改 Bucket），`enabled` 就被静默写回 true。

**为什么合并（judge-r1 F1 依据）**：两条同指 `setConfig` 一个函数（本文件旧行号 `:522` 与 `:537`）、
病灶同源（都是「保存配置时对既有同步状态的处理没有统一契约」），
分开列会让施工方以为要改两处、评审时也容易只修其中一条。
**建议（合并后的单一修法）**：`setConfig` 检测到 `endpoint`/`bucket`/`pathPrefix` 变更时一并
`set(LAST_SYNCED_REV, "0")` 并清空两个 result 键；`enabled` 改为「首次配置且无 `enabledRaw` 才置 true，
否则不动」；9 次写改串行 + 失败回滚（或整体包事务）。
置信：原 S-CS-18 confirmed；原 S-CS-19 suspected（未见 UI 侧是否有对应提示或保存前重置的配套逻辑）。

---

**S-CS-19 —— 已并入上条 S-CS-18 + S-CS-19（judge-r1 F1 裁定：同函数同根因，合并为单条 P2）。**
原病灶（`cloud-sync-config.store.ts` `setConfig` 末行 `181  kkv.set(…KEY_ENABLED, "true")` 无条件写回 true）
现作为合并条的「原 S-CS-19」那一支承载，**不再单独成条**。回引见上方合并条。

---

**S-CS-20 | P2 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:379-386`**
**`tryClearLock` 在「锁已过期」时直接 return，不把 `lock: null` 写回——过期锁永远留在 status.json 里。**
后果：① 每次 push 都要多读一次陈旧字段；② 第三方工具/人工看 status.json 会误判「有设备正在同步」；
③ 若将来有人把 `isEffectiveLock` 改严（例如改用 `Date.parse` 失败即视为有效），这里立刻变成永久锁死。
典型的「失败的清理路径不清理」，与 S-CS-13 同源（finally 里的补偿动作被自身的守卫挡掉）。

**注意**：`tryClearLock` 的三重判定（`lock != null` && `isEffectiveLock` && `holderDeviceId === this.deviceId`）
作为「**绝不误清别人的锁**」的设计是正确的（adv 辩护 8 成立），本条只针对「本机自己的过期锁」这一种情形。

**建议**：过期且 holder 是本机的锁也应当被清掉（push 入口发现过期锁时 `buildLease` 本来就会覆盖它）。
置信：confirmed。

---

**S-CS-21 | P2 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:225,286-304`**
**`forceOverwriteRemote` 跳过 rev 阻断后，内容层面是整库级别的 last-writer-wins，且无审计与恢复出口。**
`nextRev = remote.rev + 1`（不回退编号，这点是对的），但本机 rev 5 的内容会盖掉远端 rev 8 的内容，
UI 只有一句「已推送至 rev 9」（`cloud-sync.service.ts:297`）。B 设备（rev 8）在 A 强推后点拉取
→ 拿到 rev 9 → 自己在 rev 6-8 的改动被无声丢弃，UI 显示「拉取成功」。唯一的理论退路是去桶里翻
`rev-000008.nmbackup`——但没有 UI、没有文档，且 S-CS-17 反而保证它不会被自动删掉。

**「仍要覆盖云端」的二次确认本身是 intentional**（spec `:33` 拍板，adv 辩护 2 成立：
「用一次『请先拉取』的提示换零静默数据丢失，是正确的默认值」）。本条报的是**缺审计/恢复出口**这一层，
不是「强推不该存在」。

**建议**：二次确认弹窗里显式写明「将丢弃云端 rev X→Y 的更新」，并在 status.json 里留一条
`overwrittenFromRev` 审计字段；或提供「拉取并三方合并」的降级路径。
置信：confirmed（行为）/ suspected（是否需产品拍板，见争议 D4）。

---

**S-CS-22 | P2 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:60` + `infra/cloud-sync/index.ts`（全文 45 行）**
**push/agent 互斥锁无 agent 侧接线，且 `PushAgentMutex` / `getDefaultPushAgentMutex` 未从任一 index 导出——apps 层即便想接也拿不到。**
模块头（`push-agent-mutex.ts:6-8`）陈述的问题是真的（agent 抢跑就静默拿到脏数据），FIFO + 超时降级 +
按 handle id 匹配的**实现质量也高**（adv 辩护 9 认可）。但：
- `infra/cloud-sync/index.ts` 的导出块（逐行复核，45 行）**没有 `PushAgentMutex`**；
- apps 侧 `git grep getDefaultPushAgentMutex|PushAgentMutex` 除 coordinator 自身与测试外**零命中**；
- `git show 856d8588` 的提交信息明写「apps runtime **后续**通过 `getDefaultPushAgentMutex()` 单例接入
  agent 启动入口」——**作者明知未接、留作后续**。所以这不是设计错误，是**未完成的 TODO**。
- **但注释与现实不符**：`cloud-sync-coordinator.ts:49` 与模块头都把「agent 启动入口排队」写成既成能力，
  会误导后续维护者。

**残留盲区**（采样守卫覆盖不到的一段）：协调器复检 `isAgentActive()` 只有两处（`:219` 入口、
`:267` 续租点）。agent 若在「上传完成 → final status PUT 之间」抢跑写入，`:267` 已检过、放行，
快照与库就不一致了。这段窗口既无互斥锁也无复检。

**建议**：①（推荐）把 `PushAgentMutex` + `getDefaultPushAgentMutex` 加进 `infra/cloud-sync/index.ts`
与 `packages/core/src/index.ts`，在两端 agent 启动入口 acquire/release；② 若短期不接，
把模块头与 `:49` 注释改成「当前仅互斥并发 push，agent 侧靠 `isAgentActive` 采样守卫
（已知盲区：上传完成到 final PUT 之间）」。
置信：confirmed（对抗对双方独立收敛；导出面 grep 为确定性核对）。

---

**S-CS-23 | P2 | `apps/desktop/src/main/services/cloud-sync.service.ts:313-324` + `renderer/features/settings/SettingsViews.tsx:222-225`**
**设置页 2s 轮询，每次产生 HEAD+GET 两次 S3 往返并新建一个 S3Client。**
```
313  private async readRemoteRev(): Promise<number> {
314    const storage = await this.buildStorage();   // 每次 new 一个 S3Client
318    const head = await storage.head(key);
321    const { body } = await storage.get(key);     // status.json 全量下载
```
`getLocalStatus` 每次都调 `readRemoteRev`，而设置页以 **2000ms 为周期** `setInterval(reloadStatus)`。
只要用户停在「设置 → 数据管理」页，就是 **60 请求/分钟**的持续云端流量，没有缓存、退避或去重。
OSS/S3 有请求费率与 egress 计费；且被限流后 `:212` 把 `remoteRev` 兜成 `undefined`，
UI 退化成「不提示可拉取」——**有可感知的功能后果，不只是账单问题**。

**建议**：`readRemoteRev` 加 TTL 缓存（≥10s）或改用 status.json 的 ETag 条件 GET；
`buildStorage` 缓存 S3Client（凭据变更时失效）。移动端 `getCloudSyncStatusView` 走同一条路但无轮询，
优先级低一档。
置信：confirmed。

---

**S-CS-24 | P2 | `apps/desktop/src/main/services/cloud-sync.service.ts:269-274,305-310`（临时文件）**
**`buildCoordinator` 一次性返回**两个**临时路径（`:427-428`），但 `push()` 从不创建 `importTempPath`、
`pull()` 从不创建 `exportTempPath`；两个 finally 各多一次必然 ENOENT 的 `unlink`。**
```
269  if (exportTempPath != null) { await unlink(exportTempPath).catch(() => undefined); }
272  if (importTempPath != null) { await unlink(importTempPath).catch(() => undefined); }
```
无功能后果（已被 `.catch` 吞），但它**掩盖了一个真实问题**：调用方无法知道哪个路径真的被用过，
一旦将来某个路径真的漏清理，`.catch(() => undefined)` + 无条件双删的组合会让残留**永远静默**。
临时文件的 `Date.now()` 命名（`:379 stamp`）在同毫秒并发下还会互相覆盖——虽然 `syncBusy` 挡住了
同进程并发，但两个 desktop 实例指向同一 tmpdir 时不受保护。

**建议**：`buildCoordinator` 按需返回实际使用的那个路径（或返回 `{used: Set<string>}`），
cleanup 只删真正用过的；`unlink` 的 `.catch` 改为「非 ENOENT 才 warn」。
置信：confirmed。

---

**S-CS-25 | P2 | `packages/core/src/infra/cloud-sync/logic/lock.ts:19`**
**租约有效性用本机时钟与远端写入的 ISO 字符串比较，跨设备时钟偏差可致误判。**
```
19  return Date.parse(lock.expiresAt) > Date.now();
```
设备时钟快 20 分钟 → 把别人尚未过期的锁判为已过期（`canAcquireLock` true）→ 抢走有效锁；
反向则自己的锁被别人抢走。900s 租约**放大**了这个偏差的后果（绝对偏差是分钟级）。
**这条没有任何本地校验能修掉**（写入方用自己时钟、读取方用自己的时钟，是真实的分布式时间问题）。

**建议**：① status.json 里加 `uploadedByClockOffsetMs`（写入方记录自己的 UTC 偏移），读方按偏移校正；
② 或在 UI 提示 lease 冲突时附带双方 `acquiredAt`，便于人工判断。**建议在 `docs/apm/RULE.md`
记一条「已知盲区」**，避免下轮 CR 重复发现。现状可接受（用户自备桶、设备时钟通常由 NTP 同步）。
置信：confirmed（代码事实）/ suspected（实际发生概率取决于设备时钟，仓内无校时逻辑证据）。

---

**S-CS-26 | P2 | `apps/mobile/src/services/db-backup.service.ts:137` + `cloud-sync.service.ts:171-172`**
**移动端回滚副本 `.nmbackup.bak` 与导入临时文件都建在设备 CacheDir，缓存清理策略不可控。**
desktop 的回滚副本建在 `<dbPath>.nmbackup.bak`（与库同目录，随库生命周期），
mobile 建在 `{CacheDir}` 同级目录（`db-backup.service.ts:137` `const bakPath = `${dbPath}.nmbackup.bak`` —
实际是库文件同目录，此条成立性需复核）。而**云同步的 export/import 临时文件**建在
`{CacheDir}/cloud-sync-{export,import}-<stamp>.nmbackup`（`cloud-sync.service.ts:171-172`），
按 Android 的惯例 CacheDir 可被系统在存储紧张时清空——**一个正在上传/校验中的快照被系统清掉，
表现为 `ENOENT` 而非网络错误**，用户看到的是无意义的失败。

**建议**：pull 的 import 临时文件改建在与应用数据同级的非 CacheDir 目录（与库同分区）；
或至少把 `ENOENT` 映射成一条可读的错误（「快照文件被系统清理，请重试」）。
置信：suspected（未在真机验证 Android 缓存清理对进行中文件的行为；bakPath 那一半经复核**不成立**，
仅临时文件部分成立）。

---

**S-CS-27 | P2 | `apps/desktop/src/main/services/blob-binary-normalization.service.ts:41-68` vs `message-content-compaction.service.ts:40-56`**
**两个后台搬运任务近乎逐行同构，是守卫语义的**双份真源**。**
重复项：`isConnectionClosedError`（同一段 `lower.includes("connection is not open") || lower.includes("not open")`）、
`sleep`、`GUARD_RETRY_DELAY_MS = 5000`、`RECONNECT_RETRY_DELAY_MS = 1000`、
三守卫组合（`isDesktopAgentActive() || isDesktopCloudSyncBusy() || isDesktopDbMaintenanceBusy()`，
仅顺序不同）、`result.done → return` / `result.stalled → warn + return` / 其余 `await sleep(0)` 的收手口径、
`beforeMaintenance/afterMaintenance` 的一对 `setDesktopDbMaintenanceBusy`。两个文件头注释也几乎逐字重复。

**本簇相关性**：这两个循环正是 S-CS-04（移动端 busy 泄漏）与 S-CS-01/S-CS-02（连接已关）
的**受害者与发现者**。修「什么算连接已关」或加第四个守卫必须记得改两处——漏改一处，
S-CS-01 的抛错就只会让其中一半任务自愈。

**建议**：抽 `services/desktop-maintenance-loop.ts`（守卫组合 + 连接已关判定 + stalled 收手 + sleep 常量），
两个任务只留「调哪个 core 任务 / 传什么 options」。
置信：confirmed（重复是刻意同构，但代价是真源分裂）。

---

**S-CS-28 | P2 | `apps/mobile/src/services/snapshot-file-hash.ts:21-40`**
**pull 的 SHA-256 分块读流在 `onEnd` 后没有 `stream.close()`（也没有 finally），每次 pull 至少泄漏一个 fd。**
```
21  const stream = await ReactNativeBlobUtil.fs.readStream(path, 'base64', CHUNK_SIZE);
39  stream.onEnd(() => resolve());
```
同区 `db-backup.service.ts:75-84` 的 `writeStream` 就老老实实 `try/finally { await stream.close() }`。
**这条在 pull 路径上**：`coordinator.pull` 的 `canUseFilePathPull()` 分支（`:158-168`）
在 `getToPath` 之后必调 `hashSnapshotFile`。长期使用会撞 fd 上限，且**报错形态是随机的、
与 fd 泄漏无因果关系**，极难排查。

**建议**：`try { … } finally { await stream.close().catch(() => undefined) }`。
置信：confirmed（对照同区 `writeStream` 的 close 写法）。

---

**S-CS-29 | P3 | `apps/desktop/src/main/services/cloud-sync.service.ts:197`；`apps/mobile/src/services/cloud-sync.service.ts:295`**
**`listError ?? headError` 是死表达式**（`listError` 是 catch 绑定，在块内必然有值）。两端同一份形态。
无运行时后果，但读者会以为「list 失败但拿不到错误时回退用 head 的错误」，实际不可能发生；
这类噪音会让真正的错误处理改动被误读。
**建议**：改成 `throw mapStorageError(listError)`，并把 `headError` 的诊断信息（bucket 名、endpoint）
显式拼进 message。置信：confirmed。

---

**S-CS-30 | P3 | `apps/desktop/src/main/services/cloud-sync.service.ts:92-123`**
**① 用子串 `"403"` 判鉴权失败；② 兜底分支把所有未知错误统一归为 `NETWORK` 并把原始 message 直给用户。**
```
92   lower.includes("signaturedoesnotmatch") || lower.includes("403")
```
任何消息里含 "403" 的东西（字节数、rev、端口号）都会被误判成凭据错误。兜底分支让一个
`TypeError: Cannot read properties of undefined` 在设置页显示成「无法连接云存储，请检查网络与 Endpoint」，
**把排查方向直接带偏**。
**建议**：鉴权判定改用 SDK 的 `$metadata.httpStatusCode`（driver 里 `create-s3-object-storage.ts:98-106`
已有正确写法可抄）；兜底加一个 `"UNKNOWN"` 错误码，原样透传 `err.name + message`。置信：confirmed。

---

**S-CS-31 | P3 | `packages/core/src/infra/cloud-sync/model/cloud-sync-status.ts:23-25`**
**`snapshotBytes` / `uploadedAt` / `uploadedByDeviceId` 三个字段只有 coordinator 写、schema 声明，没有任何一处读。**
`getSnapshotBytes`（`:247`）算出来后只被塞进这个没人读的对象里。而两端为此做的
`exportTempPath` 的 `stat()` 调用（desktop `cloud-sync.service.ts:422-425`、mobile 的 `fs.stat`）
成为**纯开销**——一次完整的文件 stat 只为填一个死字段，同时 status.json 体积白白变大。
**建议**：要么删掉三个字段（连同 `getSnapshotBytes` 注入点），要么在 UI 上真的显示它们
（快照体积/上传时间/来源设备，对「哪台设备推的」这种排障场景有用）。置信：confirmed。

---

**S-CS-32 | P3 | `packages/core/src/infra/db-backup/provider-table-snapshot.ts:50-52`**
**`scrubProviderTables` 生产侧零调用方（走的是带 alias 的 `scrubProviderTablesInDatabase`），
却被从包主入口导出（`packages/core/src/index.ts:73`）并写进了导出面快照 allowlist。**
对外承诺了一个「清空本机三表」的能力，实际没有任何业务场景用它，且**真被外部调用会直接清空用户的
服务商配置**（无确认、无备份）。
**建议**：从 `index.ts` 撤出（同步改 allowlist 快照），或降级为非导出内部函数；
若确定保留为对外能力，注释里写明「仅测试/迁移用，破坏性」。置信：confirmed。

---

**S-CS-33 | P3 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:152-156`**
**`rev === 0 && snapshotKey == null` 的分支没有独立错误出口，`snapshotKey!` 的非空断言靠前置条件兜底。**
```
152  if (remote.rev > 0 && remote.snapshotKey == null) { throw SNAPSHOT_MISSING }
156  const snapKey = remote.snapshotKey!;
```
`rev === 0` 时该分支被 `:148-150` 的 `remote.rev <= options.lastSyncedRev`（`lastSyncedRev >= 0` 恒成立）
先拦掉，所以 `!` **当前安全**；但反过来说「rev=0 时 snapshotKey 为空」这条状态**没有独立的错误出口**，
`EMPTY_CLOUD_SYNC_STATUS` 在 pull 路径上不可达。若将来放宽 `:148`（比如允许 `forceOverwriteRemote` 下的 pull），
这个 `!` 会立刻变成 `get(null)`。
**建议**：把 `rev === 0` 显式判掉（返回 `ALREADY_UP_TO_DATE` 或新增 `REMOTE_EMPTY`），去掉 `!`。置信：confirmed。

---

**S-CS-34 | P3 | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:195`**
**`put` 是对象字面量的方法，内部用 `this.head` 取兄弟方法；同文件 `putFile`（`:228`）用的是闭包变量 `storage.put`。两种写法混用。**
当前所有调用方都是 `storage.put(...)` 形式（coordinator `:356`、`assertConditionalPutPreconditions` 调用点），
`this` 恰好是 `storage`，所以没炸。但任何 `const {put} = createS3ObjectStorage(...)` 的解构用法
（测试里很常见）在阿里云路径上会直接 `TypeError: Cannot read properties of undefined`。
**建议**：与 `putFile`/`getToPath` 统一用闭包 `storage.head`，或把 `ObjectStoragePort` 的实现改成
class 私有方法。置信：confirmed（隐患），未复现线上故障。

---

**S-CS-35 | P3 | `apps/mobile/src/services/cloud-sync.service.ts:84-94`**
**`TextDecoder` 缺失时的兜底是逐字节 Latin-1 解码，对非 ASCII 是乱码。**
```
84  let out = '';
85  for (let i = 0; i < bytes.length; i++) { out += String.fromCharCode(bytes[i]!); }
```
RN 0.85 / Hermes 已内建 `TextEncoder`/`TextDecoder`，这条分支实际走不到；留着反而在真走到的场景
产出乱码 JSON（乱码不破坏 JSON 结构 → `JSON.parse` 仍成功 → 状态被静默污染）。
**建议**：直接删掉 fallback 走 `TextDecoder`，或换成 `Buffer.from(bytes).toString('utf8')`
（该文件 `:28` 已 import `Buffer`）。置信：suspected（依赖 Hermes 能力，未在真机验证）。

---

### 复核为 intentional / 正确范式（不当缺陷出账）

| 位置 | 判定 | 依据 |
| --- | --- | --- |
| `db-maintenance-busy.ts`（双端）**计数/令牌语义** | ✅ intentional | ic-20 决策；`release` 用 `Math.max(0, …)` 兜底，嵌套调用（云同步 pull 外层令牌 + db-backup 底层自平衡）不会互相提前清位。**两处令牌配对都完整**（desktop `handlers/cloud-sync.ts:87,96` 的 finally 在 `rebootstrapDesktopRuntime()` 之后；mobile `:348` 的 `releasePullBusy()` 在 `onRebootstrap()` `:346` 之后 + `pullBusyHeld` 标志保证幂等）。**评审时最容易误判为「busy 泄漏」的三处结构，逐条核对后确认是拍板设计** |
| `rebootstrap` 放在 busy 令牌**之内**、release 严格在其之后 | ✅ intentional | 若 release 早于 rebootstrap，后台任务会在「连接已关、库文件刚换」的窗口里拿到半成品连接。**令牌边界本身是对的，错的只有记账点位置（S-CS-16）** |
| `clearDesktopRuntimeHandle()` 先摘句柄再 `closeDesktopConnection()` 的两段式 | ✅ intentional | 目的是让并发 IPC 走 `getDesktopRuntime()` 重新初始化，而不是拿到已关闭的 `runtime.conn`（注释明写）。**有意设计，不是遗漏** |
| `handleCloudSyncPull` **无条件** `rebootstrapDesktopRuntime()` | ⚠️ 存疑（w1 争议 3 上交） | `ALREADY_UP_TO_DATE` 时 `service.pull()` 会 early-return（`cloud-sync.service.ts:259-263`），此时库文件根本没换，却仍关连接 + 重 bootstrap + 重建整条 service graph。`handleBackupImport` 是 `if (result === "imported")` 才 rebootstrap。**是有意（简化口）还是漏判，未见拍板注释** → 争议 D5 |
| `validateProviderTableSnapshot` 在事务外、scrub+insert 在事务内 | ✅ 教科书 | `provider-table-snapshot.ts:79-92` 有注释说明；**w3-xc-txn 独立复核标为「教科书范式」**（与 `message-content-compaction.ts:426` / `blob-binary-normalization.ts:599` 同款）。先校验后开事务 = 失败不留半成品 |
| FK 顺序（restore 先父后子、scrub 先子后父） | ✅ 必要 | `llm_saved_model.provider_id` 有 FK 指向 `llm_provider`，两个方向各自正确才不触发约束失败 |
| 整库替换形态（而非增量/实体 merge） | ✅ intentional | spec `cross-device-cloud-sync/spec.md:12,41` 显式排除实体 merge。schema 有 VFS 内容寻址、消息正文双形态、blob 引用计数，行级 merge 的复杂度远高于收益 |
| 租约 900s / 上传超 50% 续租 1 次 / `renewLease` 保留 `holderDeviceId` | ✅ intentional | spec `:31-32` 原文拍板；续租不是重新抢锁，不应改变持有人身份 |
| `tryClearLock` 三重判定（不误清别人的锁） | ✅ intentional | 缺任一条就 return，**设计正确**。本簇 S-CS-20 只针对「本机自己的过期锁」这一种情形 |
| core 不用 `node:crypto`，哈希/文件 IO 全部宿主注入 | ✅ intentional | mobile 是 Hermes，装不了 Node 内置模块（spec `:224`） |
| mobile 导入走「分块落盘 → 路径级 cp」而非整包 base64 | ✅ intentional，且是**被桌面违反的正确防御** | `db-backup.service.ts:4,37,58-68` 三处注释连踩过的具体坑都记了。S-CS-07/S-CS-08 是桌面与 driver 把这个坑重新踩了一遍 |
| 桌面 `getLocalMeta()` 已在 `try` 内 | ✅ 已修复 + 有测试锁住 | `cloud-sync.service.ts:246-248` 注释 + `test/cloud-sync-handlers.test.ts:91` 回归测试。**缺陷已被发现、被修复、被测试锁住——这是设计质量的正面证据**。移动端缺的正是这一处搬移（S-CS-04） |
| `infra/db-maintenance/` 的 VACUUM / checkpoint 直调 `conn.execute` 不包事务 | ✅ intentional | RULE L72（SQLite 原生拒绝事务内 VACUUM）；w3-xc-txn 独立复核 |

---

## 云同步生命周期修复方案骨架（不写代码）

> 按**修复手法**分四组；每组给出「修什么、为什么这么归组、动到哪些文件、验收怎么写」。
> **执行顺序有硬依赖**：M1 是 M2 的前置（连接已关的记账问题不修，S-CS-02 的单例重建无从验证）。

### M1 · 修 invalidation（让「持有句柄」这件事不再成立）

**核心判断**：本簇最深的病根不是某一行代码写错，而是「runtime 的 service 对象在构造时把
连接上的句柄烤进去，之后连接会被换掉，而没人负责让它失效」。修法不是逐个调用点小心避开，
而是**让句柄的寿命与连接对齐**。

| 步骤 | 修什么 | 覆盖发现 | 动到哪 |
| --- | --- | --- | --- |
| M1.1 | 桌面：拆出生产版 `invalidateCloudSyncService()`，在 `rebootstrapDesktopRuntime()` 内调用；或让 `DesktopCloudSyncService` 每次 `await getDesktopRuntime()` 而非持句柄 | S-CS-02 | `cloud-sync.service.ts`、`desktop-runtime-singleton.ts` |
| M1.2 | 两端：pull 的 rev 记账移到 rebootstrap **之后**，用重建后的 runtime 取 configStore。契约固定为「换库 → 重建 → 记账 → 放令牌」，并写进两个函数的文件头注释 | S-CS-01、S-CS-16 | 两端 `cloud-sync.service.ts` |
| M1.3 | 移动端：`pullCloudSync` 把 `createCoordinator()` 挪进 `try`（`progress` 构造可留在外面） | S-CS-04 | `apps/mobile/src/services/cloud-sync.service.ts` |
| M1.4 | 移动端：`buildCoordinator`/`createCoordinator` 按需返回实际使用的临时路径；`unlink` 的 catch 改为「非 ENOENT 才 warn」 | S-CS-24 | 两端 `cloud-sync.service.ts` |
| M1.5 | core：`*Bytes` / `*uploadedAt` / `uploadedByDeviceId` 三字段要么删（含 `getSnapshotBytes` 注入点）要么在 UI 真显示 | S-CS-31 | `cloud-sync-status.ts`、`coordinator.ts`、两端 store |

**验收怎么写（M1 是本批的重点）**：
- 新增用例「pull 前置 `createCoordinator` 抛错 → `isMobileDbMaintenanceBusy()` 回到 false」（S-CS-04）。
- 现有 `test/cloud-sync-handlers.test.ts:91` 只覆盖「`getLocalMeta` 在 try 内抛错」，**必须补
  「pull 成功后 `lastSyncedRev` 真的落库」的用例，且不许 mock 掉记账函数**——mobile 现有测试
  全程 mock `patchCloudSyncLocalStatus`（`:29-31`）正是假绿的成因（RULE「验收断言必须圈 scope / 有牙吗」）。
- 建议在 W6 派一个验证代理在**真实驱动**下跑一遍「pull → rebootstrap → 读 `lastSyncedRev`」，
  而不是靠 mock 断言。

### M2 · 修时序（把「顺序写对」变成契约，而不是靠注释记住）

| 步骤 | 修什么 | 覆盖发现 | 动到哪 |
| --- | --- | --- | --- |
| M2.1 | `final status` 条件写失败后的重读路径：**重读后必须重新判定租约**，用 `Math.max(remote.rev, nextRev)+1` 或抛 `NEED_PULL_FIRST`，禁止静默覆盖；补 `:281` 续租失败的 else 分支 | S-CS-09 | `cloud-sync-coordinator.ts` |
| M2.2 | agent 复检**前移到 `exportSnapshotToPath` 之后、`putFile` 之前**；「已上传但未提交 rev」的快照做 best-effort 删除 | S-CS-13 | `cloud-sync-coordinator.ts` |
| M2.3 | pull 与 push 走**同一把进程内互斥**（或新增 pull 专用），入口与 `importSnapshotFromPath` 之前各复检一次 `isAgentActive()` | S-CS-03 | `cloud-sync-coordinator.ts` |
| M2.4 | `setConfig` 检测到 `endpoint`/`bucket`/`pathPrefix` 变更 → 重置 `lastSyncedRev` + 清 result 键 + 9 次写改串行可回滚；`enabled` 改为「无 `enabledRaw` 才置 true」（🔁 R2-17：随 S-CS-18/19 合并口径同步，原文「不碰 `enabled`」作废） | S-CS-18 + S-CS-19（已合并为单条） | 双端 `cloud-sync-config.store.ts` |
| M2.5 | `readRemoteRev` 加 TTL 缓存（≥10s）或改 ETag 条件 GET；`buildStorage` 缓存 S3Client | S-CS-23 | `apps/desktop/.../cloud-sync.service.ts` |
| M2.6 | `setConfig` 的 `Promise.all` 无事务写入 → 串行 + 失败回滚（与 M2.4 同批做） | S-CS-18 | 同上 |
| M2.7 | `snapshot-file-hash` 的 `readStream` 补 `finally { stream.close() }`（pull 路径上每次至少漏一个 fd） | S-CS-28 | `apps/mobile/src/services/snapshot-file-hash.ts` |
| M2.8 | 决策点（**本簇唯一需要产品/主代理拍板的时序项**）：`handleCloudSyncPull` 在 `ALREADY_UP_TO_DATE` 时是否应跳过 rebootstrap | 争议 D5 | `handlers/cloud-sync.ts` |

**M2 的方法论要点**：M2 里 S-CS-09 / S-CS-13 / S-CS-03 三条**本质是同一件事**——
「协调器把「读—判定—写」摊开在多处，中间没有单一的 commit 点，所以每个阶段的守卫都可能被绕过」。
修法不是给每处加一个 `if`，而是**在 `runPush` 里划出显式的 commit 点**（上传前 / 上传后 / 提交 rev），
每个点上的守卫与不变量写成注释 + 断言。M2.3 的互斥与 M2.1 的重读判定都是这个 commit 点的组成部分。

### M3 · 修互斥（把三个各管一段的守卫接成一张图）

**当前的三层互斥，各管一段，但没有一张图**：

| 层 | 现状 | 覆盖发现 |
| --- | --- | --- |
| ① 进程内 push 互斥 | `PushAgentMutex` 实现良好（FIFO + 超时降级 + handle 匹配），但**只互斥了 push-vs-push**；agent 侧零 acquire；类型**未从任一 index 导出** | S-CS-22 |
| ② agent 采样守卫 | `isAgentActive()` 只在 `runPush` 的 `:219`/`:267` 两处采样；pull 侧完全空白 | S-CS-03、S-CS-13 |
| ③ 云端租约锁 | 条件 PUT + expiresAt 逻辑正确，但 **OSS 降级为 head-then-put**（弱互斥）；首次同步 `ifNoneMatch` 从未使用 | S-CS-12、S-CS-10 |

| 步骤 | 修什么 | 覆盖发现 | 动到哪 |
| --- | --- | --- | --- |
| M3.1 | **接线或降级承诺**（二选一，必须选一个）：① `PushAgentMutex` + `getDefaultPushAgentMutex` 加进 `infra/cloud-sync/index.ts` 与 `packages/core/src/index.ts`，两端 agent 启动入口 acquire/release；② 若短期不接，把模块头与 `coordinator.ts:49` 注释改成实际能力并写明已知盲区 | S-CS-22 | `index.ts` ×2、两端 agent 入口 |
| M3.2 | head 不存在时用 `ifNoneMatch: "*"` 抢首次创建权（driver 已支持） | S-CS-10 | `coordinator.ts`、`create-s3-object-storage.ts` |
| M3.3 | OSS 降级路径：UI 明示「当前端点不提供强互斥」，或改用 `x-oss-forbid-overwrite`；不能则 `testConnection` 时就拒 push | S-CS-12 | driver + 两端配置页 |
| M3.4 | `pull()` / `push()` 入口在 `syncBusy` 之外追加 `maintenanceBusy` 判定（VACUUM 与 push 可真并发）——**先经 W7 确认是否刻意**（争议 D3） | S-CS-05 | 两端 `cloud-sync.service.ts` |
| M3.5 | `exportDatabaseBackup` / `importDatabaseBackup` 在弹 `showSaveDialog` **之前**就 acquire busy（或弹框返回后复检 `isDesktopAgentActive()`） | S-CS-06 | `db-backup.service.ts` |
| M3.6 | 保留三层分层本身（**这是辩护成立的部分，不要动**）：租约而非纯锁（崩溃可恢复）、计数令牌而非布尔（嵌套调用）、`tryClearLock` 三重判定（绝不误清别人的锁）。只补 M3.1/M3.4 两处缺口 | — | — |

**M3 的方法论要点**：`db-maintenance-busy.ts` 被抽成零依赖独立小模块（为了打断
`db-maintenance.service → cloud-sync.service → db-maintenance.service` 的循环 import）是**正确的
依赖倒置**；但它也因此变成一个「谁都能读、谁都不写语义」的旁路模块——两层守卫（`syncBusy` /
`maintenanceBusy`）互不检查对方就是这个结构的必然产物。**修法是在两侧 service 的入口处显式组合两个
守卫，而不是往 busy 模块里加一个「谁在忙」的全局表**（那会把计数令牌变成隐式依赖网）。

### M4 · 修数据与资源安全（本地搬运层的四条纪律）

这一组全是**桌面端违反了移动端已经写好的纪律**的地方，建议一次性对齐，不分批。

| 步骤 | 修什么 | 覆盖发现 | 动到哪 |
| --- | --- | --- | --- |
| M4.1 | 校验只读前 16 字节（`open()` 读后关闭，或直接对齐 mobile 的 `assertSqliteBackupAtPath`：存在 + size≥16）。**不要用 `fs.readFile(path, enc, 16)`**——第三参被忽略，会整包读入 | S-CS-07 | `apps/desktop/.../db-backup.service.ts` |
| M4.2 | 备份拷贝失败**必须致命**（裸 `await`）；`unlink(bakPath)` 只在 bak 确实存在且未被用作回滚源时执行；回滚失败单独告警而非 `.catch`。对齐 mobile 的 `if (dbExists) cp` + 回滚前 `exists` 判断 | S-CS-07 | 同上 |
| M4.3 | 抽出 `replaceDbFileWithSnapshot(write)` 单一内核，`FromPath` / `FromBytes` 只传写入策略 —— 这是 M4.1/M4.2 的**单点修改面**（否则改一处忘一处，正是当前桌面吞、移动端不吞的成因） | S-CS-14 | 同上 |
| M4.4 | `insertTableRows` 前断言所有行键集合相同，不等抛 `ProviderTableSnapshotError`（跨版本静默少数据比整体失败更难排查） | S-CS-11 | `provider-table-snapshot.ts` |
| M4.5 | driver `putFile`：`raw instanceof Uint8Array ? raw : new Uint8Array(raw)`（一行消除 2× 峰值）；`getToPath` 的 base64 往返评估分块 | S-CS-08 | `create-s3-object-storage.ts` |
| M4.6 | 真正流式（multipart Upload + 流式写盘）——**需要引 `@aws-sdk/lib-storage`，属独立批次**；在此之前把「避免一次性读入」的注释改回实际行为，不留假优化 | S-CS-08、S-CS-15 | driver + 两端注释 |
| M4.7 | push 成功后删除 `rev <= nextRev - K`（K=3~5）的旧快照；或 status.json 维护 `snapshotKeys` 列表 + 配置页「清理历史快照」动作 | S-CS-17 | `coordinator.ts`、配置页 |
| M4.8 | `scrubProviderTables` 从 `packages/core/src/index.ts` 撤出（同步改 allowlist 快照）或标注「破坏性，仅测试/迁移用」 | S-CS-32 | `index.ts`、allowlist |

**M4 的方法论要点**：M4.1/M4.2 的本质是「**失败必须可见，且补偿动作不能被自身的守卫挡掉**」。
S-CS-07 的三处 `.catch` 与 S-CS-20 的 `tryClearLock` 早退是同一种气味——**失败路径写得比成功路径宽松**。
建议在这两个文件里统一一条纪律：*凡是把磁盘状态往回拨的补偿动作，其失败必须单独上报*。

### 跨组依赖与执行顺序

```
M1（invalidation）─┬─→ M2.3（pull/push 同锁）依赖 M1.3 先修好 busy 令牌边界
                   └─→ M2.1 / M2.2 依赖 M1.2 确定「记账点在哪」，否则 commit 点划不准
M3（互斥）────────┬─→ M3.1 是二选一的承诺题，必须在 M2.3 之前定（否则拉的是一把不存在的锁）
                   └─→ M3.4 依赖 W7 对争议 D3 的裁决
M4（数据安全）───── 独立，可与 M1/M2/M3 并行；M4.3（抽单一内核）是 M4.1/M4.2 的前置
```

**建议批次**：
- **批 1（不做完后面都验不了）**：M1.1 + M1.2 + M1.3 —— 三条同族，一次改两端，并补真实驱动的验收用例。
- **批 2（数据安全，独立可并行）**：M4.1 + M4.2 + M4.3 + M4.4 + M4.5。
- **批 3（需要拍板才能动）**：M3.1（承诺题）+ M3.4（争议 D3）+ M2.8（争议 D5）+ S-CS-21（争议 D4）。
- **批 4（协调器收敛）**：M2.1 + M2.2 + M2.3 + M3.2 + M3.3 —— 「在 `runPush` 里划显式 commit 点」
  这件事应该一次做完，分批改会得到两套半成品。
- **批 5（纯债务登记）**：S-CS-25（时钟盲区，写进 RULE.md）、S-CS-29~S-CS-35、S-CS-05/S-CS-06
  （若 W7 确认是刻意设计则直接销案）。

---

## 跨簇移交

- **S-D-01**（`apps-desktop` 的云同步单例持已关连接）→ 本簇 **S-CS-02**（P1）。
  `synth/apps-desktop.md:102-113` 明确写「P0 候选已由 `synth/cloudsync.md` 承载，本簇不再重复出账」，
  本簇确认接收：该条与 S-CS-01 是**同一病根的两种持续时间**（一次抛错 vs 永久报废），
  且 `apps-desktop` 的 P1 定级本簇维持不变。
- **`w2-mobile-runtime` 的 F-mobile-runtime-7 / F-mobile-runtime-15**（readStream 不 close /
  `document-io` 临时文件名无随机后缀）→ 前者已并入本簇 **S-CS-28**（pull 路径上，fd 泄漏有因果链）；
  后者（`document-io.ts:47`）属**文档导出**而非云同步/备份，不在本簇边界，仅在此登记引用。
- **「备份导出/导入的守卫语义」双份真源**（`blob-binary-normalization` vs `message-content-compaction`，
  w1 F-desktop-main-7）→ 并入本簇 **S-CS-27**；其修法（抽 `desktop-maintenance-loop.ts`）属于
  apps/desktop 簇的代码位置，但**判级依据是本簇 S-CS-01/S-CS-04 的受害者关系**，故由本簇出账。
- **w3-xc-txn 的事务纪律结论**（`provider-table-snapshot.ts:86-92` 标为「教科书」）→ 本簇采信，
  列入 intentional 底账，不重复出账（该簇未发现云同步相关缺陷，其对本簇的唯一贡献是这条**正面确认**）。

## 争议与存疑（上交，6 条）

| # | 争议 | 分歧双方 | 需要的裁决 | 建议对象 |
| --- | --- | --- | --- | --- |
| D1 | **S-CS-01 的影响面是否只限云同步**。本簇判 P0 的依据是「库已换但 UI 记成失败 + rev 永不推进」。但 `importDatabaseBackupFrom*` 是**本地备份导入与云同步 pull 共用的底层**（`handlers/backup.ts:49` 也 rebootstrap），所以同一个「记账写在已关连接上」的病是否也存在于本地备份路径？本机位只核了云同步侧，**未核 `ipc/handlers/backup.ts` 的记账时序** | 本簇（提出） | 核 `handlers/backup.ts:40-55`：本地备份导入成功后是否也有「用已关连接记账」的同类行。若有，本条影响面从「云同步功能」扩大到「备份功能」，P0 仍成立但修复面更宽 | W6 验证（低成本读 15 行） |
| D2 | **S-CS-04 的触发面**。结构缺陷（`acquire` 在 `try` 外）confirmed；但要真触发需要 `createCoordinator` 抛错，最强路径是 `configured`（判 `secretKeySet` 布尔）与 `buildS3StorageConfig`（判 secret 实际非空）判据不等价。**两处源码已核，但无真机复现过 SKSP `has=true / get=空` 的状态** | pro 方自陈 suspected（触发） | 要不要在 W6 派真机注入一次「SKSP has=true 但 get 返回空」以坐实；若坐实，本条从 P1 升 P0（后台清理永久停摆是无声的用户可见故障） | W6 验证 |
| D3 | **S-CS-05：VACUUM 与 push 可真并发，两个守卫互不检查对方**。两侧守卫模块都已存在（就是为这个而抽的），但 `pull()`/`push()` 入口只查 `syncBusy`。pro 方倾向「漏了」但**明确未找到拍板文档**，因此未单列为 finding 而上交 | pro 方上交；本簇按漏接处理为 P2 | 是否有任何文档/spec 写明「VACUUM 期间允许 push」。若无 → 按 P2 修（M3.4）；若有 → 销案 | 主代理（W5/W7 裁决） |
| D4 | **S-CS-21：forceOverwriteRemote 的破坏性是否需产品拍板**。行为本身按 spec `:33` 拍板是 intentional（adv 辩护 2 成立：「用一次『请先拉取』的提示换零静默数据丢失，是正确的默认值」）。本条报的是**缺审计/恢复出口**这一层，但「弹窗要不要写明『将丢弃云端 rev X→Y』」是产品决策 | 本簇（提出）；pro 方也自陈「不该由 CR 单方面定 P 级」 | 二次确认弹窗的文案强度 + 是否加 `overwrittenFromRev` 审计字段。若产品判「现文案已足够」，本条降 P3 只保留审计字段 | 产品/主代理 |
| D5 | **`handleCloudSyncPull` 无条件 rebootstrap**（w1-desktop-main 争议 3 上交）。`ALREADY_UP_TO_DATE` 时 `service.pull()` 会 early-return（`:259-263`），此时库文件根本没换，却仍关连接 + 重 bootstrap + 重建整条 service graph。对照 `handleBackupImport` 是 `if (result === "imported")` 才 rebootstrap。**是有意（简化口径）还是漏判，未见拍板注释** | w1 上交；本簇未复核 | 读 commit history 或 spec 确认 rebootstrap 条件化的意图。注意：**这条与 S-CS-02 强耦合**——正是无条件 rebootstrap 制造了「单例需要重建」这个需求；若改成条件化，S-CS-02 的触发面会显著缩小 | W6 验证（`git log` + spec） |
| D6 | **`snapshotKey` 不可变 + 无保留策略是「刻意」还是「未做」**。adv 辩护 3 主张不可变性是正确的（Git tag + 单指针 manifest 形态，本簇**认可**）；但仓内找不到任何文档/TODO 写明「保留策略是后续迭代的事」。pro 方因此在 P1 与 P3 之间摇摆 | pro 方自陈摇摆；本簇按 P2 债务登记 | 是否存在「保留策略后续做」的 TODO/issue。有 → P3 登记；无 → P2（因为一年 365 份全量库是确定的成本） | 主代理 |

（另有两条非争议的定级说明已在本文件内解决，不上交：① 对抗对双方**独立**收敛到 S-CS-01 与 S-CS-22，
按 PLAN 协议「独立双扫重合的发现标高置信」，这两条直接 confirmed；② 对抗对证人 adv 在 §4.1
自我披露了一次 grep 全仓检索的附带命中（`raw/w2-core-infra-misc.md` 的 F-core-infra-misc-3），
但**未打开**检察官报告 `raw/w4-cloudsync-pro.md`，且其核心结论用只查两个 `index.ts` 的独立命令
重新验证过（`NO MATCH - not exported from either index`）——对抗纪律成立，两方证据相互独立。）

## 本簇盲区（诚实声明）

- **未实测**：S-CS-01 的 mobile 侧（op-sqlite 需 Android 运行时，adv 只跑了 better-sqlite3 的
  真实驱动）；S-CS-06/S-CS-19 的 suspected 项；S-CS-26 的 Android 缓存清理行为（该条末尾
  经复核「bakPath 与库同目录」那一半**不成立**，仅临时文件部分成立）。
- **未逐行读**：`apps/desktop/src/main/ipc/handlers/backup.ts`（争议 D1 的核验对象）、
  `apps/desktop/renderer/features/settings/` 云同步表单（只核了 `SettingsViews.tsx` 的轮询周期）、
  `apps/mobile/src/screens/stack/CloudSyncStorageScreen.tsx`（配置表单）、
  `packages/core/src/infra/db-backup/provider-table-snapshot-validate.ts:1-182`（只核了 100-104 与 182 的存在）。
- **未覆盖**：`testConnection` 路径的完整错误映射（S-CS-30 只核了 `:92-123`）、
  S3 driver 的凭据轮换/endpoint 变更路径、`@aws-sdk/client-s3` 自身的重试与分块行为。
- **未读 raw/ 中与云同步无关的域**：W2 core-* 系列（除 w3-xc-txn 的正面确认外）、
  w3-xc-cache-* / w3-xc-dup-* / w4-msgstore-* / w4-runner-* / w4-vfsstore-* / w4-rollback-*
  ——**若这些报告里含云同步消费方的发现，本簇结论不覆盖它们**，W7 合并 L3 台账时需回查。
- **本簇不是云同步的唯一视角**：`synth/apps-desktop.md` 已就 S-D-01 出过账（明确移交本簇），
  `synth/apps-mobile.md`（若已产出）可能另有移动侧条目。**三份台账对同一批代码的编号不互通**，
  W7 合并时需按「文件:行」而非按编号对账。
