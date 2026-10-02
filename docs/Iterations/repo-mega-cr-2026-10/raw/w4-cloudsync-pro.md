---
zone: w4-cloudsync-pro
agent: 对抗机位 · 检察官（猎杀问题：冗余/死路径/互斥与 busy 泄漏/整库替换竞态/临时文件与对象残留/坏味道）
files_scanned: 21
---

# w4-cloudsync-pro — 云同步与备份

## 摘要

云同步是一条「双端各自实现壳子 + core 共用协调器」的链路：core 的 `CloudSyncCoordinator`
做 Pull/Push 编排、云端 status.json 租约锁与 rev 对齐；桌面/移动各自的
`cloud-sync.service.ts` 注入 S3 驱动、DbSyncPort、临时文件路径与 busy 标志；
`db-backup.service.ts`（两端）负责「checkpoint → 拷贝 → 剥掉服务商三表」的整库
导出与「dump → 关连接 → 覆盖库文件 → 写回三表」的整库导入。`infra/db-backup/`
是 core 侧三表快照的 dump/scrub/restore/validate。

## 职责与边界

- `packages/core/src/infra/cloud-sync/`：不含平台细节的同步编排。`ports/` 是两个
  倒置接口（`ObjectStoragePort` = 远端对象读写 + 条件 PUT；`DbSyncPort` = 快照
  导出/导入 + agent 守卫），哈希与文件读写由调用方注入（core 不用 node:crypto）。
- `packages/core/src/infra/db-backup/`：只有服务商三表（`llm_provider` /
  `llm_saved_model` / `sksp_secrets`）的快照原语，**不含整库文件搬运**——整库
  搬运在两端 app 侧各写一份。
- `packages/cloud-sync-driver-s3/`：`ObjectStoragePort` 的 S3 实现，含
  `FileSystemPort` 注入的 `putFile` / `getToPath`（A-26 引入，本轮一并扫）。
- apps 侧 = 宿主接线：配置持久化（KKV + SKSP）、临时路径、busy 令牌、agent 守卫、
  rebootstrap 窗口。

## 对外接口

| 符号 | 位置 | 性质 |
| --- | --- | --- |
| `CloudSyncCoordinator.pull/pull / push` | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:143,185` | 主入口 |
| `getDefaultPushAgentMutex` | 同上 `:60` | **零生产消费方**（见 F-9） |
| `__resetDefaultPushAgentMutexForTests` | 同上 `:68` | 测试专用，生产不调 |
| `canAcquireLock / isEffectiveLock / buildLease / renewLease` | `logic/lock.ts:15,25,38,53` | 租约原语 |
| `normalizePrefix / statusKey / snapshotKey` | `logic/paths.ts:10,19,26` | 键名生成 |
| `parseCloudSyncStatus / EMPTY_CLOUD_SYNC_STATUS` | `model/cloud-sync-status.ts:60,51` | zod `.strict()` 校验 |
| `PushAgentMutex` | `logic/push-agent-mutex.ts:58` | 进程内 FIFO 互斥 |
| `dumpProviderTableSnapshot / scrubProviderTables / scrubProviderTablesInDatabase / restoreProviderTableSnapshot` | `infra/db-backup/provider-table-snapshot.ts:33,50,61,82` | 三表原语 |
| `validateProviderTableSnapshot` | `provider-table-snapshot-validate.ts:182` | restore 前闸门 |
| `isDesktopCloudSyncBusy` / `isDesktopDbMaintenanceBusy` / `isMobileDbMaintenanceBusy` | 两端 `*-busy.ts` | 跨模块让路守卫 |
| `exportDatabaseBackupToPath / importDatabaseBackupFromPath / importDatabaseBackupFromBytes` | 两端 `db-backup.service.ts` | 云同步直调的底层搬运 |

## 数据访问

| 对象 | 位置 | 说明 |
| --- | --- | --- |
| 远端 `status.json` | `snapshotKey/statusKey` → `paths.ts:19` | `schemaVersion/rev/snapshotKey/snapshotSha256/snapshotBytes/uploadedAt/uploadedByDeviceId/lock` |
| 远端 `snapshots/rev-{6位}.nmbackup` | `paths.ts:26` | 整库快照，不可变、**只增不删** |
| KKV module `nm-cloud-sync` | `apps/desktop/src/main/services/cloud-sync-config.store.ts:11` | 14 个键：endpoint/bucket/region/pathPrefix/accessKeyId/forcePathStyle/deviceId/deviceLabel/enabled + lastSyncedRev/lastPullAt/lastPushAt/lastPullResult/lastPushResult |
| SKSP ref `cloud-sync/s3-secret-key` | 同上 `:12` | Secret Access Key |
| 表 `llm_provider` / `llm_saved_model` / `sksp_secrets` | `provider-tables.ts:10` | 导出时 scrub、导入时 restore |
| 库文件（整库替换） | `db-backup.service.ts:109/139`（desktop）、`:146/151`（mobile） | `dbPath` ← 备份文件 |
| 临时文件 | desktop `cloud-sync.service.ts:380,384`；mobile `cloud-sync.service.ts:171,172` | `os.tmpdir()` / `CacheDir`，`Date.now()` 命名 |
| 回滚副本 | desktop `:109,128`；mobile `:138` | `<dbPath>.nmbackup.bak` |

## 依赖关系

**import 了谁**：`@novel-master/core`（CloudSyncCoordinator + DbSyncPort +
db-backup 原语）、`@novel-master/cloud-sync-driver-s3`、`@aws-sdk/client-s3`、
`@noble/hashes`（mobile 分块 sha256）、`react-native-blob-util`（mobile）、
`node:fs` / `node:crypto` / `node:os`（desktop）。

**被谁消费**：`apps/desktop/src/main/ipc/handlers/cloud-sync.ts`（IPC 五路）、
`apps/mobile/src/screens/stack/CloudSyncProgressScreen.tsx`（pull/push 唯一入口）、
`db-maintenance.service.ts` / `message-content-compaction.service.ts` /
`blob-binary-normalization.service.ts`（读 `isXxxDbMaintenanceBusy` 让路）。

---

## 发现清单

### F-w4-cloudsync-pro-1 | P1 | `apps/mobile/src/services/cloud-sync.service.ts:332`

> ```ts
> acquireMobileDbMaintenanceBusy();
> let pullBusyHeld = true;
> ...
> const {coordinator, exportTempPath, importTempPath} = await createCoordinator(  // ← 在 try 之外
>   runtime, undefined, progress,
> );
> try {                                                        // L338
> ```

**描述**：`acquireMobileDbMaintenanceBusy()` 在 L317，`try/finally` 到 L338 才开始，
中间的 `createCoordinator()`（L332）不被 finally 保护。`createCoordinator` 会调
`buildS3StorageConfig`（`cloud-sync-config.store.ts`，配置不完整时 `throw new Error('请先完成云存储配置')`）、
`getCloudSyncConfig`、以及 `ReactNativeBlobUtil.fs.dirs.CacheDir`。任何一条抛出都会
让 `pullCloudSync` 直接抛出，`releasePullBusy()` 永不执行。

**后果链**：`maintenanceBusyCount` 永久 +1（`db-maintenance-busy.ts:15` 是模块级变量，
无 TTL、无自愈）→ `isMobileDbMaintenanceBusy()` 此后恒为 true → 消息正文压缩搬运 /
blob 归一后台循环（它们正是读这个标志让路的）**在本进程剩余生命周期内全部停摆** →
用户在无任何报错提示的情况下看到「数据清理/优化永远没反应」。

**证据补强**：这个坑在桌面侧**已经被明确修过并留了注释**——
`apps/desktop/src/main/services/cloud-sync.service.ts:246-248`：
「getLocalMeta 的读取必须在 try 内（对齐 push() 写法）：若留在 try 外，抛错时
syncBusy 永不复位，数据清理守卫会被连带锁死。」移动端同一个函数没有做这个搬移。
另有一条确定的触发路径：`getCloudSyncLocalStatus` 的 `configured` 判据用的是
`config.secretKeySet`（布尔），而 `buildS3StorageConfig` 判的是
`readCloudSyncSecretKey()` 返回值（非空串）。二者不等价——SKSP `has` 为真但
`get` 返回空/decrypt 失败时，L308 的 `configured` 放行、L332 必抛。

**建议**：把 L326-336 整段挪进 `try`（`progress` 构造可留在外面，它无副作用）。

**置信**：confirmed

---

### F-w4-cloudsync-pro-2 | P1 | `apps/desktop/src/main/services/db-backup.service.ts:104`

> ```ts
> const header = await readFile(srcPath, { encoding: null });
> assertSqliteFile(new Uint8Array(header.subarray(0, 16)));
> ```

**描述**：为了校验 16 字节 SQLite 魔数，把**整个快照文件**读进 Node 堆。移动端
在同一位置刻意做了相反的处理并写了原因（`apps/mobile/src/services/db-backup.service.ts:54-68`）：

> 「仅校验路径存在且体积足够；魔数交给替换后 open（失败则 bak 回滚）。
> 注意：`fs.readFile(path, enc, 16)` 的第三参会被忽略，会整包读入，大备份必 OOM。」

**后果链**：云同步 Pull 走的就是这条路径（`apps/desktop/src/main/services/cloud-sync.service.ts:403-408`
把 `importSnapshotFromPath` 接到 `importDatabaseBackupFromPath`）。也就是说
A-26 / 桌面注释里宣称的「走文件路径上传下载，避免一次性读入大快照」
（`cloud-sync.service.ts:360-361`）在**校验这一步就被撤销了**——一个数百 MB 的
`.nmbackup` 会在校验阶段整份进堆，随后在 `importDatabaseBackupFromPath` 里再走
`copyFile` 落盘。峰值内存 ≈ 1× 快照，且这份峰值发生在校验阶段、无法被后续优化摊薄。

**建议**：改用 `open(srcPath,'r')` 读前 16 字节后关闭，或直接对齐 mobile 的
`assertSqliteBackupAtPath`（只查存在 + size≥16）。

**置信**：confirmed

---

### F-w4-cloudsync-pro-3 | P1 | `apps/desktop/src/main/services/db-backup.service.ts:114,125`

> ```ts
> await copyFile(dbPath, bakPath).catch(() => undefined);   // L114 备份失败被吞
> await closeLiveDbForBackupImport();                       // L115
> await copyFile(srcPath, dbPath);                          // L116 覆盖唯一真身
> ...
> } catch (error) {
>   await copyFile(bakPath, dbPath).catch(() => undefined); // L125 回滚同样被吞
>   throw error;
> } finally {
>   await unlink(bakPath).catch(() => undefined);           // L128 还要删掉 bak
> }
> ```

**描述**：三处失败全部 `.catch(() => undefined)` 吞掉，于是「备份失败 → 覆盖成功 →
还原三表失败 → 回滚也失败」这条链路上没有任何一处会中断，最终只 `throw` 一个
原始错误，而磁盘上的库文件**已经是远端快照**了。

**后果链**：桌面端用户本机的整库被替换成云端版本，且 L128 还把唯一可能的回滚副本
删掉；应用下次 `getDesktopConnection()` 懒加载打开的是远端内容，本地未同步的改动
无声消失。移动端同一段代码**没有**吞（`db-backup.service.ts:146` 是裸 `await fs.cp`），
说明这是桌面侧独有的回归。

**建议**：备份拷贝的失败必须致命（裸 `await`）；`unlink(bakPath)` 只在
bak 确实存在且未被用作回滚源时执行；回滚失败要单独告警而不是 `.catch`。

**置信**：confirmed

---

### F-w4-cloudsync-pro-4 | P1 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:297-304`

> ```ts
> let finalEtag = await this.conditionalPutStatus(finalStatus, statusEtag);
> if (finalEtag == null) {
>   const { etag: rereadEtag } = await this.readRemoteStatus();   // 重读，只取 etag
>   finalEtag = await this.conditionalPutStatus(finalStatus, rereadEtag);
> ```

**描述**：第一次条件写失败后，重读远端**只为了拿一个 etag**，然后拿这个 etag 无条件
覆盖——重读时读到的 `status`（含别人的租约锁与已经推进的 `rev`）被完全丢弃，
`finalStatus` 里的 `lock: null` 会抹掉第三方的有效租约。

**后果链**：本机上传耗时超过租约（或 L277 的续租 `conditionalPutStatus` 返回 null
被静默吞掉，`if (renewedEtag != null)` 无 else 分支）→ 设备 B 抢到锁并 push 到 rev N+1
→ 本机重读到 B 的 etag → 覆盖写入自己的 `finalStatus`，其 `rev` 是 L249 按**最初**
读到的 `remote.rev + 1` 算的 → **`status.rev` 数值回退**，同时 B 的租约被清空，
B 随后把自己的 `finalStatus` 写上去（它的 etag 已过期，会失败）→ 两端都以为自己成功
（`lastSyncedRev` 各自落库），远端 rev 与实际内容脱钩。叠加 F-10（阿里云 OSS 走
head-then-put 模拟，条件写本身就是 no-op）时这条路径是无条件的。

**建议**：重读后必须重新判定租约（`isEffectiveLock(lock) && lock.holderDeviceId !== this.deviceId`
→ 直接抛 `LOCK_HELD_BY_OTHER`），并用 `Math.max(remote.rev, nextRev) + 1` 或
「检测到 rev 已被推进 → 抛 `NEED_PULL_FIRST`」替代静默覆盖。

**置信**：confirmed

---

### F-w4-cloudsync-pro-5 | P1 | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:225-235`（`putFile` / `getToPath`）

> ```ts
> async putFile(key, filePath, options) {
>   const raw = await readLocalFile(filePath);
>   const body = new Uint8Array(raw);        // ← 对已经是 Uint8Array 的输入再全拷一份
>   return storage.put(key, body, options);
> },
> async getToPath(key, destPath) {
>   const { body, etag } = await storage.get(key);   // 整份下载进内存
>   await writeLocalFile(destPath, body);
> ```

**描述**：`putFile` / `getToPath` 是 A-26 为「走文件路径、避免整包进内存」引入的
（`cloud-sync-coordinator.ts:39-42` 的注释、桌面 `cloud-sync.service.ts:360-361` 的注释
都这么宣称），但实现里既**没有 multipart upload**，也**没有流式下载写盘**——
就是 `readFile` → 单次 `PutObject` / `GetObject` → `writeFile`。

`new Uint8Array(raw)` 这一行还额外制造一份完整拷贝：`TypedArray` 构造函数对
TypedArray 入参是逐元素复制，而 Node 的 `readFile()` 返回 `Buffer`（本身就是
Uint8Array），mobile 的 `readFileBytes`（`cloud-sync.service.ts:96-99`）返回的也是
Uint8Array。所以 desktop 侧峰值 = 文件 1 份（Buffer）+ 拷贝 1 份 = **2×**。

**后果链**：`canUseFilePathPush()`（coordinator:125）为真时走的就是这条 →
大库 push 在 main 进程堆里同时存在两份快照。移动端更糟：
`ReactNativeBlobUtil.fs.writeFile(path, base64, 'base64')`（`cloud-sync.service.ts:156-161`）
还要把这份拷贝再转成 base64 字符串，**峰值 ≈ 文件 1 份 + 拷贝 1 份 + base64 字符串 1.33 份**。
mobile `db-backup.service.ts:37` 特意引入 `WRITE_CHUNK_BYTES = 256*1024`
并注释「避免 100MB+ Uint8Array → 单次 base64 撑爆 Hermes 堆」——driver 这条路
把刚刚绕开的坑又踩了一遍。

**建议**：要么真正实现 multipart（`@aws-sdk/lib-storage` 的 `Upload`）与
`getToPath` 的流式 `createWriteStream`/RN `writeStream` 分块落盘；要么在 A-26
未真正实现前，把 `putFile` / `getToPath` 从 `ObjectStoragePort` 上摘掉，
让两端老实回退到 bytes 路径（现状等价），不要留一个「看起来省内存其实更费」的假优化。
`new Uint8Array(raw)` 应改为 `raw instanceof Uint8Array ? raw : new Uint8Array(raw)`。

**置信**：confirmed

---

### F-w4-cloudsync-pro-6 | P1 | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:1-7`

> ```ts
> import { GetObjectCommand, HeadObjectCommand, NotFound, PutObjectCommand, S3Client, ... } from "@aws-sdk/client-s3";
> ```
> （无 `DeleteObjectCommand` / `ListObjectsV2Command`）

**描述**：全仓 `git grep -n "DeleteObject|deleteObject"` 在
`packages/cloud-sync-driver-s3`、`packages/core/src/infra/cloud-sync`、
两端 app 目录下**零命中**。`snapshotKey`（`paths.ts:26`）按 rev 生成**不可变**对象名，
每次 push 都新增一个对象（`coordinator.ts:250,256`），**没有任何保留期、没有删除、
没有对象数量/体积上限**。

**后果链**：rev 单调递增 → 桶里堆的是 N 份完整数据库副本。novel-master 的库在
`file_cache_blob` 去重后仍有数 MB 到数十 MB，日同步用户一年后桶里是 365 份全量库。
用户为省事配的 S3/OSS 桶（很多是按流量与存储计费的）会静默膨胀；旧快照无清理入口
（`cross-device-cloud-sync/spec.md` 全文未提保留策略）。

**建议**：push 成功后删除 `rev <= nextRev - K`（K 取 3~5）的旧快照对象，或至少在
status.json 里维护 `snapshotKeys` 列表并在配置页暴露「清理历史快照」动作。
同时这也是 F-11（脏快照残留）唯一的兜底手段。

**置信**：confirmed

---

### F-w4-cloudsync-pro-7 | P2 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:238`

> ```ts
> const { status: remote, etag: remoteEtag } = await this.readRemoteStatus();
> // readRemoteStatus: head 不存在 → return { status: EMPTY, etag: undefined }   // L328
> let statusEtag = await this.conditionalPutStatus(lockedStatus, remoteEtag);
> ```
> ```ts
> // ports/object-storage.port.ts:18
> put(key, body, options?: { ifMatch?: string; ifNoneMatch?: string })
> ```

**描述**：`ObjectStoragePort` 明确定义了 `ifNoneMatch`（driver 也实现了，见
`create-s3-object-storage.ts:78-86`），但 coordinator **一次都没用过**。首次同步时
`readRemoteStatus` 返回 `etag: undefined`（L328），`conditionalPutStatus` 的
`ifMatch != null ? {ifMatch} : undefined`（L359）就变成了**无条件写**。

**后果链**：两台新设备同时首次 push → 双方 head 都「不存在」→ 双方无条件写
status.json 都成功 → 双方都认为锁是自己抢到的 → 双方都算出
`nextRev = remote.rev + 1 = 1`（L249）→ **写同一个键 `snapshots/rev-000001.nmbackup`**
（`paths.ts:26`），后写覆盖先写 → 两端各自把 `lastSyncedRev=1` 落库，内容却不同。
一端的数据被无声吞掉，且没有任何错误码。

**建议**：head 不存在时用 `ifNoneMatch: "*"` 抢首次创建权（driver 已支持；
阿里云路径会退化成 head 判存在，见 F-10）。

**置信**：confirmed

---

### F-w4-cloudsync-pro-8 | P2 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:143-182`

> ```ts
> async pull(options: PullOptions): Promise<PullResult> {
>   this.assertConfigured();
>   const { status: remote } = await this.readRemoteStatus();
> ```

**描述**：`pull()` 全程**不查 `dbSync.isAgentActive()`，也不抢 `pushMutex`**。
`isAgentActive` 在全仓只有两个消费点，都在 `runPush` 内
（`coordinator.ts:219,267`，`git grep isAgentActive` 实测）。
`cross-device-cloud-sync/spec.md:166,218` 写的也是「Agent 守卫 … **Push/export 前检查**」
——即 pull 侧的空白是设计范围之外的漏项，不是拍板豁免。

**后果链**：移动端 `pullCloudSync`（`apps/mobile/src/services/cloud-sync.service.ts:302`）
与 `pushCloudSync`（`:374`）是两个各自独立的导出函数，**没有 `syncBusy` 之类的进程级
互斥**（桌面有 `cloud-sync.service.ts:55` 的 `syncBusy`）。于是 push 走到
`exportSnapshotToPath` 拷完库（t0）、pull 走完 `importSnapshotFromPath` 整库替换（t1）、
push 继续上传 t0 的旧快照并把 `rev` 推到 t1+1（t2）→ **pull 拉回来的内容被云端
回滚，且本机 `lastSyncedRev` 也被推到更高值，之后再也不会重新拉**。
agent 同理：pull 在 agent 流式写入中途换掉整个库文件（`db-backup.service.ts:151`
`fs.cp(srcPath, dbPath)` 覆盖活动库），在途写入丢失或写进已废弃的 inode。

**建议**：`pull()` 与 `push()` 走同一把 `pushMutex`（或新增 pull 专用互斥），
并在入口/下载后复检 `isAgentActive()`，命中即抛 `AGENT_ACTIVE`（错误码已存在）。

**置信**：confirmed

---

### F-w4-cloudsync-pro-9 | P2 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:49-65`

> ```ts
> * apps runtime 在 agent 启动入口应拿到同一实例（通过 {@link getDefaultPushAgentMutex}）。
> export function getDefaultPushAgentMutex(): PushAgentMutex {
> ```

**描述**：`git grep getDefaultPushAgentMutex|PushAgentMutex` 实测——除 coordinator
自身与 `packages/core/test/cloud-sync/coordinator.test.ts` 外，**apps 侧零命中**。
即 `getDefaultPushAgentMutex` 没有任何生产消费方，agent 侧从未接入。
来源可追：`docs/Iterations/cr-fix-spec/spec.md:173`（Step 29 / A-21）写的任务是
「push 持锁期间 **agent 启动排队**…先定位 agent 启动入口（扫 `createAgentRunner`
调用方）确定锁挂在 core 还是 apps runtime」——A-21 只落地了 core 侧一半。

**后果链**：`PushAgentMutex` 135 行、名字里的 "agent"、`push-agent-mutex.ts:1-11`
整段论证（「之前 coordinator 只在 push 入口采样一次 isAgentActive，整个上传过程不再
复检，agent 抢跑就静默拿到脏数据」）目前是**未兑现的承诺**。实际防护仍退化为
`runPush` 的两次 `isAgentActive()` 采样（L219 入口、L267 上传后），也就是它自己
文档里判定为「不够」的那个形态。`coordinator.ts:217-218,264-266` 的两处注释
（"兼容 apps runtime 尚未接入互斥锁的旧路径"）其实已经在承认这件事，但正文
`logic/push-agent-mutex.ts` 与 `index.ts` 的导出面没有同步降级说明。

**建议**：二选一——①在两端 agent 启动入口接上 `getDefaultPushAgentMutex().acquire()`
并在整个 run 生命周期持有；② 若短期不做，把 `getDefaultPushAgentMutex` /
`__resetDefaultPushAgentMutexForTests` 移出 `index.ts` 公开面，注释改成
「当前仅作 push-vs-push 互斥，agent 侧待接入」，避免后续 agent 接入方误以为已生效。

**置信**：confirmed

---

### F-w4-cloudsync-pro-10 | P2 | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:194-198`

> ```ts
> if (emulateConditionalPut && hasConditionalPut) {
>   const head = await this.head(key);
>   assertConditionalPutPreconditions(head, options);
>   putOptions = undefined;   // 条件头被丢掉，改成无条件 PUT
> }
> ```

**描述**：阿里云 OSS（`isAliyunOssEndpoint`，`:60-67`）不支持条件 PUT，于是做
「head → 比对 etag → 无条件 put」的**模拟**。这是教科书式的 TOCTOU：head 与 put
之间没有任何互斥。

**后果链**：两台设备同时 push 到 OSS 桶时，head 都拿到同一个 etag、双方都通过
`assertConditionalPutPreconditions`、双方都无条件覆盖 status.json → **租约锁
在 OSS 上等于不存在**，`LOCK_CONTENTION` 错误码在该端点上永不可达（除非靠
S3 服务端在别处偶然 412）。`cross-device-cloud-sync/spec.md:502` 只把
「S3 条件 PUT 与部分 OSS 兼容性」列为风险并给了「隐藏 UI」的回滚，没说明
模拟实现是弱互斥。

**建议**：模拟路径至少要串行化到「单设备视角」并在 UI 上明示「当前端点不提供
强互斥，多设备同时同步可能冲突」；或改用 OSS 原生的 `x-oss-forbid-overwrite`
/ 条件拷贝能力；若不能，OSS 端点应禁用 push 并在 `testConnection` 时就拒。

**置信**：confirmed

---

### F-w4-cloudsync-pro-11 | P2 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:264-284`

> ```ts
> // 续租点：…agent 拍跑到这里就拒绝，走 finally 清云端锁，避免上传脏的快照续命。
> if (this.dbSync.isAgentActive()) { throw new CloudSyncError("AGENT_ACTIVE", ...); }
> ```
> 上一行 L256：`await this.storage.putFile!(snapKey, this.exportTempPath);`

**描述**：注释说「避免上传脏的快照续命」——实际只做到了「不推进 rev」。脏快照
**已经上传到桶里了**（L256 早于 L267 的复检），对象名 `snapshots/rev-{nextRev}.nmbackup`
已经落地。

**后果链**：配合 F-6（全仓无 DeleteObject），每次这类拒绝都会在桶里永久留下一份
无引用的全量库副本。用户既看不到也删不掉（除非自己去控制台）。这正是
「临时文件/对象残留」类问题的云端版本。

**建议**：把 agent 复检**前移到 `exportSnapshotToPath` 之后、`putFile` 之前**，
并对「已上传但未提交 rev」的快照做 best-effort 删除。

**置信**：confirmed

---

### F-w4-cloudsync-pro-12 | P2 | `apps/desktop/src/main/services/cloud-sync-config.store.ts:211-261`

> ```ts
> await Promise.all([ kkv.set(... ENDPOINT ...), ..., kkv.set(..., CLOUD_SYNC_KEY_ENABLED, "true") ]);
> if (secret.length > 0) { await secretStore.set(CLOUD_SYNC_SKSP_SECRET_REF, secret); }
> ```

**描述**：`setConfig` 允许改 `endpoint` / `bucket` / `pathPrefix`（指向另一个桶或
另一段前缀），但**不重置 `lastSyncedRev`**，也不清理 `lastPullResult` / `lastPushResult`。
另外 9 次 `kkv.set` 用 `Promise.all` 无事务，`secretStore.set` 排在最后单独写。

**后果链**：
① 用户把配置从桶 A 改到桶 B → `lastSyncedRev` 仍是 A 的 N → 对着空桶 B 首次点
拉取，`coordinator.pull` 的 `remote.rev(0) <= lastSyncedRev(N)` 命中
L148-150，抛 `ALREADY_UP_TO_DATE`，UI 弹「已是最新」——**用户看到的是"同步成功"，
实际上什么都没拉到**，且 B 桶的数据再也不会被拉下来。
② 首次 push 到 B 时 `nextRev = 0 + 1 = 1`（L249），rev 编号体系与 A 脱钩。
③ 9 次 set 中途失败 → 半配置状态（bucket 换了、accessKeyId 没换），下次
`buildCoordinator` 报 `NOT_CONFIGURED` 但配置页显示已保存。

**建议**：`setConfig` 检测到 `endpoint` / `bucket` / `pathPrefix` 变更时，
一并 `kkv.set(LAST_SYNCED_REV, "0")` 并清空两个 result 键；或显式提示用户
「切换存储位置将重置同步进度」；9 次写改串行 + 失败回滚。

**置信**：confirmed

---

### F-w4-cloudsync-pro-13 | P2 | `packages/core/src/infra/db-backup/provider-table-snapshot.ts:119-126`

> ```ts
> const columns = Object.keys(rows[0]!);      // 列名只取自第一行
> const parametersList = rows.map((row) =>
>   columns.map((column) => row[column] ?? null)
> );
> await conn.batch(sql, parametersList);
> ```

**描述**：列集合由 `rows[0]` 单独决定；后续行若缺某列 → `?? null` 静默写成 NULL，
若多出某列 → 被静默丢弃。快照来自**另一台设备、可能是另一个版本**的库
（`provider-table-snapshot-validate.ts:100-104` 的注释已经承认 legacy 表用
`(provider_id, vendor_model_id)` 复合主键、新 schema 有 `id` / `model_name`）。

**后果链**：跨版本云同步时 `llm_saved_model` 落库的是「校验过的（`provider_id` /
`vendor_model_id` / `settings_json` 非空）但主键/名称列可能是 NULL」的行 →
下游按 `id` / `model_name` 查询时静默漏行（不是报错，是**少数据**），
比整体 restore 失败更难排查。

**建议**：`insertTableRows` 前做一次「所有行的键集合必须相同」的断言；
不等则抛 `ProviderTableSnapshotError`，让用户走「先升级版本再同步」的显式路径。

**置信**：confirmed

---

### F-w4-cloudsync-pro-14 | P2 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:379-386`

> ```ts
> const lock = status.lock;
> if (lock == null || !isEffectiveLock(lock) || lock.holderDeviceId !== this.deviceId) {
>   return;                                    // 锁已过期 → 不清
> }
> ```

**描述**：`tryClearLock` 在「锁已过期」时直接 return，**不把 `lock: null` 写回**。
过期锁因此永远留在 status.json 里。

**后果链**：status.json 里长期挂着一个 `expiresAt` 早已过去的 `lock` 对象 →
① 每次 push 都要多读一次陈旧字段，`canAcquireLock`（`lock.ts:29-32`）虽然会正确
判定为可抢，但读路径上多一个误导性字段；② 任何第三方工具/人工看 status.json
会误判「有设备正在同步」；③ 若将来有人把 `isEffectiveLock` 的判定改严（例如
改用 `Date.parse` 失败即视为有效），这里立刻变成永久锁死。属于典型的
「失败的清理路径不清理」——与 F-11 同源（finally 里的补偿动作被自身的守卫挡掉）。

**建议**：过期且 holder 是本机的锁也应当被清掉（或者更彻底：push 入口发现
过期锁时顺手覆盖为新租约，L229 的 `buildLease` 本来就会做）。

**置信**：confirmed

---

### F-w4-cloudsync-pro-15 | P2 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:225,286-304`

> ```ts
> if (!options.forceOverwriteRemote && remote.rev > options.lastSyncedRev) { throw NEED_PULL_FIRST }
> ...
> const finalStatus: CloudSyncStatus = { rev: nextRev, ..., lock: null };
> ```

**描述**：`forceOverwriteRemote` 跳过 `rev` 阻断后，用的仍是 `nextRev = remote.rev + 1`
（这点是对的，不回退编号），但**内容层面是整库级别的 last-writer-wins**：
本机 rev 5 的内容会盖掉远端 rev 8 的内容，UI 只有一句「已推送至 rev 9」
（桌面 `cloud-sync.service.ts:297`）。

**后果链**：B 设备（rev 8）在 A 强推后点拉取 → 拿到 rev 9 → 自己在 rev 6-8 的
改动被无声丢弃，UI 显示「拉取成功」。唯一的理论退路是去桶里翻 `rev-000008.nmbackup`
——但没有 UI、没有文档、也没有清理（F-6 反而保证它不会被自动删掉）。

**建议**：二次确认弹窗里显式写明「将丢弃云端 rev X→Y 的更新」，并在 status.json
里留一条 `overwrittenFromRev` 审计字段；或提供「拉取并三方合并」的降级路径。

**置信**：confirmed（行为）／suspected（是否需产品拍板）

---

### F-w4-cloudsync-pro-16 | P3 | `apps/desktop/src/main/services/cloud-sync.service.ts:197`；`apps/mobile/src/services/cloud-sync.service.ts:296`

> ```ts
> } catch (listError) {
>   throw mapStorageError(listError ?? headError);
> ```

**描述**：`listError` 是 catch 绑定，在块内必然有值，`?? headError` 是死表达式。
两端同一份形态。

**后果链**：无运行时后果，但读者会以为「list 失败但拿不到错误时回退用 head 的错误」，
实际不可能发生；这类噪音会让真正的错误处理改动被误读。

**建议**：改成 `throw mapStorageError(listError)`，并把 `headError` 的诊断信息
（bucket 名、endpoint）显式拼进 message。

**置信**：confirmed

---

### F-w4-cloudsync-pro-17 | P3 | `apps/desktop/src/main/services/cloud-sync.service.ts:92-123`

> ```ts
> lower.includes("signaturedoesnotmatch") || lower.includes("403")
> ...
> return new CloudSyncError("NETWORK", message, { cause: error });   // 兜底也是 NETWORK
> ```

**描述**：① 用子串 `"403"` 判鉴权失败——任何消息里含 "403" 的东西（字节数、rev、
端口号）都会被误判成凭据错误；② 兜底分支把所有未知错误（含代码 bug、
`TypeError`、`AbortError`）统一归为 `NETWORK` 并把原始 message 直接透给用户。

**后果链**：一个 `TypeError: Cannot read properties of undefined` 会在设置页显示成
「无法连接云存储，请检查网络与 Endpoint」，把排查方向直接带偏。

**建议**：鉴权判定改用 SDK 的 `$metadata.httpStatusCode`（driver 里
`create-s3-object-storage.ts:98-106` 已有正确写法可抄）；兜底加一个 `"UNKNOWN"`
错误码，原样透传 `err.name + message`。

**置信**：confirmed

---

### F-w4-cloudsync-pro-18 | P3 | `packages/core/src/infra/cloud-sync/model/cloud-sync-status.ts:23-25`

> ```ts
> snapshotBytes?: number;
> uploadedAt?: string;
> uploadedByDeviceId?: string;
> ```

**描述**：`git grep` 实测，这三个字段**只有 coordinator 写（L291-293）、
schema 声明（L43-45），没有任何一处读**。`snapshotBytes` 的实际来源
`getSnapshotBytes`（L247）算出来后只被塞进这个没人读的对象里。

**后果链**：`exportTempPath` 的 `stat` 调用（desktop `cloud-sync.service.ts:422-425`
的 `stat()`、mobile 的 `fs.stat`）成为**纯开销**——一次完整的文件 stat 只为填一个
死字段。同时 status.json 体积白白变大。

**建议**：要么删掉三个字段（连同 `getSnapshotBytes` 这个注入点），
要么在 UI 上真的把它们显示出来（快照体积/上传时间/来源设备，对「哪台设备推的」
这种排障场景有用）。

**置信**：confirmed

---

### F-w4-cloudsync-pro-19 | P3 | `packages/core/src/infra/db-backup/provider-table-snapshot.ts:50-52`

> ```ts
> export async function scrubProviderTables(conn: TdbcConnection): Promise<void> {
>   await scrubProviderTablesWithPrefix(conn);
> }
> ```

**描述**：`git grep scrubProviderTables\b` 实测生产侧零调用方，只有
`packages/core/test/db-backup/provider-table-snapshot.test.ts` 在用；生产路径走的是
带 alias 的 `scrubProviderTablesInDatabase`。它却被从包主入口导出
（`packages/core/src/index.ts:73`）并写进了导出面快照
（`packages/core/test/package-exports/snapshots/main-entry-allowlist.json:93`）。

**后果链**：对外承诺了一个「清空本机三表」的能力，实际没有任何业务场景用它，
且真被外部调用会**直接清空用户的服务商配置**（无确认、无备份）。

**建议**：从 `index.ts` 撤出（同步改 allowlist 快照），或降级为
非导出内部函数；若确定要保留为对外能力，注释里写明「仅测试/迁移用，破坏性」。

**置信**：confirmed

---

### F-w4-cloudsync-pro-20 | P3 | `apps/desktop/src/main/services/cloud-sync.service.ts:313-324,201-215`

> ```ts
> private async readRemoteRev(): Promise<number> {
>   const storage = await this.buildStorage();   // 每次 new 一个 S3Client
>   ...
>   const head = await storage.head(key);
>   if (!head.exists) return 0;
>   const { body } = await storage.get(key);     // status.json 全量下载
> ```

**描述**：`getLocalStatus` 每次都调 `readRemoteRev`，而设置页在
`apps/desktop/renderer/features/settings/SettingsViews.tsx:221-226` 以
**2000ms 为周期**轮询 `reloadStatus()`。

**后果链**：只要用户停在「设置 → 数据管理」页，每 2 秒就产生
2 次 S3 往返（HEAD + GET）+ 1 个新 `S3Client` 实例 = **60 请求/分钟**的持续
云端流量，且没有任何缓存、退避或去重。OSS/S3 有请求费率与 egress 计费，
这既是账单问题也是被限流后 `getLocalStatus` 静默降级的原因
（`cloud-sync.service.ts:212` 把 `remoteRev` 兜成 `undefined`，UI 退化成
「不提示可拉取」）。

**建议**：`readRemoteRev` 加 TTL 缓存（≥10s）或改用 status.json 的
ETag 条件 GET；`buildStorage` 缓存 S3Client（凭据变更时失效）。
移动端 `getCloudSyncStatusView`（`apps/mobile/src/services/cloud-sync.service.ts:241`）
每次 Profile 展示也走同一条路，但无轮询，优先级低一档。

**置信**：confirmed

---

### F-w4-cloudsync-pro-21 | P3 | `apps/desktop/src/main/services/cloud-sync.service.ts:269-274,305-310`

> ```ts
> if (exportTempPath != null) { await unlink(exportTempPath).catch(() => undefined); }
> if (importTempPath != null) { await unlink(importTempPath).catch(() => undefined); }
> ```

**描述**：`push()` 从不创建 `importTempPath`，`pull()` 从不创建 `exportTempPath`
（见 `:380-387` 两处都无条件生成路径）。两个 finally 各多一次必然 ENOENT 的
`unlink`。

**后果链**：无功能后果（已被 `.catch` 吞）。但它掩盖了一个真实问题：
`buildCoordinator` 一次性返回**两个**临时路径（L342-346 的返回类型），
调用方无法知道哪个真的被用过；一旦将来某个路径真的漏清理，`.catch(() => undefined)`
+ 无条件双删的组合会让残留**永远静默**（正是 F-6 说的「云端快照残留无感知」
在本地临时文件上的同款气味）。临时文件的 `Date.now()` 命名
（`:379 stamp`）在同毫秒并发下还会互相覆盖——虽然 `syncBusy` 挡住了同进程并发，
但两个 desktop 实例指向同一 tmpdir 时不受保护。

**建议**：`buildCoordinator` 按需返回实际使用的那个路径（或返回 `{used: Set<string>}`），
cleanup 只删真正用过的；`unlink` 的 `.catch` 改为「非 ENOENT 才 warn」。

**置信**：confirmed

---

### F-w4-cloudsync-pro-22 | P3 | `apps/mobile/src/services/cloud-sync.service.ts:84-94`

> ```ts
> let out = '';
> for (let i = 0; i < bytes.length; i++) { out += String.fromCharCode(bytes[i]!); }
> ```

**描述**：`TextDecoder` 缺失时的兜底是逐字节 Latin-1 解码，对非 ASCII 是乱码。
RN 0.85 / Hermes 已内建 `TextEncoder`/`TextDecoder`，这条分支实际走不到；
留着反而在真走到的场景（老设备/异常 polyfill 被删）产出乱码 JSON。

**后果链**：`status.json` 里的 `uploadedByDeviceId`（用户可自填 `deviceLabel`
之外的中文设备名）解码成乱码 → `JSON.parse` 仍可能成功（乱码不破坏 JSON 结构）
→ 状态被静默污染。当前无消费方（见 F-18），危害有限。

**建议**：直接删掉 fallback 走 `TextDecoder`，或换成 `Buffer.from(bytes).toString('utf8')`
（该文件 `:28` 已 import `Buffer`）。

**置信**：suspected（依赖 Hermes 能力，未在真机验证）

---

### F-w4-cloudsync-pro-23 | P3 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:152-156`

> ```ts
> if (remote.rev > 0 && remote.snapshotKey == null) { throw SNAPSHOT_MISSING }
> const snapKey = remote.snapshotKey!;
> ```

**描述**：`rev === 0 && snapshotKey == null` 的分支被 L148-150 的
`remote.rev <= options.lastSyncedRev`（`lastSyncedRev >= 0` 恒成立）先拦掉，
所以 `snapshotKey!` 的非空断言永远安全——但反过来说，「rev=0 时 snapshotKey 为空」
这条状态**没有独立的错误出口**，`EMPTY_CLOUD_SYNC_STATUS`（`cloud-sync-status.ts:51`）
产出的对象在 pull 路径上不可达。

**后果链**：无运行时后果。属于「靠前置条件兜底而不是显式建模」的味道：若将来
放宽 L148（比如允许 `forceOverwriteRemote` 下的 pull），这个 `!` 会立刻变成
`get(null)`。

**建议**：把 `rev === 0` 的情形显式判掉（返回 `ALREADY_UP_TO_DATE` 或
新增 `REMOTE_EMPTY`），去掉 `!`。

**置信**：confirmed

---

### F-w4-cloudsync-pro-24 | P3 | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:195`

> ```ts
> const head = await this.head(key);
> ```

**描述**：`put` 是对象字面量的方法，内部用 `this.head` 取兄弟方法。同文件
`putFile`（`:228`）用的是闭包变量 `storage.put`，两种写法混用。

**后果链**：当前所有调用方都是 `storage.put(...)` 形式（coordinator:356、
`assertConditionalPutPreconditions` 调用点），`this` 恰好是 `storage`，所以没炸。
但任何 `const {put} = createS3ObjectStorage(...)` 的解构用法（测试里很常见）
在阿里云路径上会直接 `TypeError: Cannot read properties of undefined`。

**建议**：与 `putFile`/`getToPath` 统一用闭包 `storage.head`，或把
`ObjectStoragePort` 的实现改成 class 私有方法。

**置信**：confirmed（隐患），未复现线上故障

---

### F-w4-cloudsync-pro-25 | intentional | `apps/desktop/src/main/services/db-maintenance-busy.ts:9-15`、`apps/mobile/src/services/db-maintenance-busy.ts:9-12`

> ```ts
> * busy 为**计数/令牌配对**语义（ic-20）：…最外层流程（备份导入 / 云同步 pull）
> * 在 rebootstrap 完成之后 release…
> ```

**描述**：评审时最容易误判为「busy 泄漏」的三处结构，逐条核对后确认是拍板设计：
① 计数而非布尔——`releaseDesktopDbMaintenanceBusy` 用 `Math.max(0, …)` 兜底
（`:33`），嵌套调用（cloud-sync pull 外层令牌 + db-backup 底层自平衡）不会互相
提前清位；② `handleCloudSyncPull`（`apps/desktop/src/main/ipc/handlers/cloud-sync.ts:87,96`）
在 `finally` 里 release，**确实在 `rebootstrapDesktopRuntime()` 之后**；③
`pullCloudSync`（mobile `:348,367`）用 `pullBusyHeld` 标志保证 release 幂等，
且 `onRebootstrap()`（`:346`）在 release（`:348`）之前。两侧配对都是完整的。

**依据**：`docs/Iterations/cr-fix-spec/spec.md`（ic-20 决策出处）+ 两处
`db-backup.service.ts:64-71,92-98` 的同款注释。**不算问题。**

**置信**：intentional

---

## 争议与存疑

1. **F-1（移动端 busy 泄漏）的触发面**：我确认了「acquire 在 try 外」这个结构
   缺陷是实打实的（`cloud-sync.service.ts:317` vs `:338`），也确认了桌面侧同类
   问题被修过并留了注释。但要真触发需要 `createCoordinator` 抛错——我找到的最
   强路径是 `configured`（判 `secretKeySet` 布尔）与 `buildS3StorageConfig`
   （判 secret 实际非空）判据不等价。这条不等价我读了两处源码确认，但**没有真机
   复现过 SKSP `has=true / get=空`** 的状态。定为 confirmed（结构）+ suspected（触发）。

2. **F-5（putFile/getToFile 全量读）到底算不算问题**：`cross-device-cloud-sync/spec.md:373`
   明确写了「一期接受中等体积库一次性读入」。但那是 A-26 **之前**的表述；A-26
   （`cr-fix-spec/spec.md:193` Step 43）引入 `putFile`/`getToPath` 的目的就是
   消除这条限制。现状是**两头不落**：既没消除限制，又多了一层 `new Uint8Array` 拷贝。
   我按「实现未兑现宣称」报 P1；如果评审组认为 spec 的一次性读入豁免仍然有效，
   这条应降为 P2（保留 `new Uint8Array` 拷贝那部分即可）。

3. **F-6（快照无清理）**：功能上「只增不删」是刻意的（快照不可变、便于回滚），
   我没找到任何文档写明「保留策略是后续迭代的事」。若能找到这样的 TODO，
   应降为 P3 债务登记而非 P1。目前 `cross-device-cloud-sync/spec.md` 全文
   未提保留期。

4. **F-15（forceOverwriteRemote 的破坏性）**：技术后果链我确认了，但「是否需要在
   UI 上更强提示」是产品决策，不该由 CR 单方面定 P 级。行为本身按 spec
   （`:33`「跳过 rev 检查但仍须抢锁」）是 intentional，我报的是「缺审计/恢复出口」
   这一层，不是「强推不该存在」。

5. **`isDesktopCloudSyncBusy` / `isDesktopDbMaintenanceBusy` 的两个守卫方向**：
   `syncBusy` 只防「云同步互相并发」，`maintenanceBusy` 防「后台维护与云同步并发」。
   两者**不互相检查对方**——例如 VACUUM 正在进行时 `cloud-sync.service.ts:201-235`
   的 `getLocalStatus` 会回报 `maintenanceBusy: true`，但 `pull()`/`push()`
   （`:237,278`）入口**不查 `maintenanceBusy`**，只查 `syncBusy`。也就是说
   VACUUM 与 push 可以真正并发（VACUUM 改库 + push 拷库）。
   我倾向认为这是漏了（两侧守卫都已存在，只是没接上），但没有拍板文档说明
   「VACUUM 期间允许 push」，先记为存疑，**不单列为 finding**，留给 W5 reduce
   与主代理裁决。

6. **`docs/Iterations/repo-mega-cr-2026-10/raw/` 下的任何文件我都没有读取**，
   独立性纪律遵守。对抗对另一侧（辩护者）的存在与结论我不知情，本报告所有
   结论均从源码与 `docs/Iterations/*` / `docs/apm/RULE.md` 重新推导。
