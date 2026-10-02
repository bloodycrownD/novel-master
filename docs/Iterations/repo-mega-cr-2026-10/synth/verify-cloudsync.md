---
zone: synth-cloudsync-verify
agent: W6-verify（云同步与备份 P1 复验）
input: synth/cloudsync.md（P0 S-CS-01 结构封印免验；本轮只验 P1×7）
base_sha: 9ca5f5adbe3ed29caa3b030496698bd233a141a2（feat/repo-mega-cr）
method: 逐条从源码重新推导（不采信原报告的调用链，只采信它给的怀疑方向）；每条独立核「代码事实 → 缓解措施 → 后果可达性」
verdict: confirmed 4 / adjusted 3 / refuted 0
---

# W6 验证 · synth/cloudsync.md 的 P1×7

## 免验清单

| 条目 | 级别 | 免验理由 |
| --- | --- | --- |
| S-CS-01 | P0 | 主代理已做结构封印：链路 `cloud-sync.service.ts:255` → `configStore`（构造期绑定 `runtime.kkv`）→ `importSnapshotFromPath` → `importDatabaseBackupFromPath:115` → `closeLiveDbForBackupImport()` 在本轮复核中再次撞见（`db-backup.service.ts:32-35` / `:115` / `:156`），事实无误，但按指令不做二次判级、不重复出账。**下文只在「与其它 P1 的耦合」处引用它。** |

免验不等于不读——S-CS-01 的代码事实在本轮被独立撞见三次（desktop service 构造绑定、`closeLiveDbForBackupImport` 的两段式、两处 import 函数的 `.catch` 吞错），与原报告一致，**没有出现 refutation 所需的反证**。

## verdict 表

| # | 发现 | 原判 | 本轮 verdict | 关键证据 | 差异 |
| --- | --- | --- | --- | --- | --- |
| S-CS-02 | 桌面云同步 service 单例在 rebootstrap 后永不重建 | P1 | **adjusted** | `cloud-sync.service.ts:432-449` 单例仅由 `resetDesktopCloudSyncServiceForTest` 清位，全仓 grep 只有 2 个测试文件调用；`rebootstrapDesktopRuntime`（`desktop-runtime-singleton.ts:35-38`）只清 runtime/conn，不碰 service | **影响面比原报告更大**（见下 §1） |
| S-CS-03 | `pull()` 不查 `isAgentActive`、不抢 `pushMutex`；移动端 pull/push 无互斥 | P1 | **adjusted** | `cloud-sync-coordinator.ts:143-182` 全文确无两者；`isAgentActive` 全仓仅 `:219`/`:267` 两处消费 | **桌面侧 pull↔push 已被 `syncBusy` 挡住**，暴露面收窄（见下 §2） |
| S-CS-04 | 移动端 `pullCloudSync` 的 busy 令牌 acquire 在 `try` 外 | P1 | **confirmed** | `apps/mobile/.../cloud-sync.service.ts:317` acquire / `:332` `createCoordinator` / `:338` try / `:367` release；`db-maintenance-busy.ts` 计数无 TTL 无自愈 | 触发面找到比原报告更硬的路径（见下 §3） |
| S-CS-07 | 桌面校验整包读入 + 备份/回滚/删除三处吞错 | P1 | **confirmed** | `db-backup.service.ts:104`（整包 `readFile`）、`:114`/`:125`/`:128` 三处 `.catch(() => undefined)`；移动端对应段 `:135`/`:146`/`:160-162` 均未吞 | 表述小瑕疵（见下 §4 附注） |
| S-CS-08 | `putFile`/`getToPath` 无流式且多拷一份 | P1 | **confirmed** | `create-s3-object-storage.ts:225-235`；`readLocalFile` 返回 desktop 注入的 Buffer，`new Uint8Array(Buffer)` 为逐元素复制 | 无差异；补充 pull 侧同样走这条路径 |
| S-CS-09 | final status 条件写失败后重读只取 etag 再无条件覆盖 | P1 | **confirmed** | `cloud-sync-coordinator.ts:297-304`；`nextRev` 在 `:249` 已按首次读到的 `remote.rev + 1` 算定 | 无差异 |
| S-CS-16 | rev 记账点位于 rebootstrap 之前 | P1 | **confirmed** | desktop `cloud-sync.service.ts:255-256` → handler `cloud-sync.ts:91`；mobile `cloud-sync.service.ts:341` → `:346` `onRebootstrap()` | 无差异；**新增一条 mobile 侧派生缺陷**（见下 §5） |

统计：**verified 7（confirmed a ×4 / refuted b ×0 / adjusted c ×3）**

---

## §1 S-CS-02 adjusted：报废面不止 `configStore`，`dbSync` 拿的是同一条死连接

原报告的描述是「`configStore` 永久持有已关闭连接上的 `kkv`/`secretStore`」。本轮读代码发现**同一个 service 对象上的第二个死句柄，报告没提**：

```ts
// cloud-sync.service.ts:159-165
constructor(runtime) {
  this.runtime = runtime;                                  // ← 死 runtime
  this.configStore = createCloudSyncConfigStore(runtime.kkv, runtime.secretStore);
}
// :378  buildCoordinator 内
const runtime = this.runtime;
// :391-396  dbSync.exportSnapshotToPath
await exportDatabaseBackupToPath(runtime, destPath);        // ← runtime.conn 已关
```

`getDesktopCloudSyncService()`（`:434-443`）每次都 `await getDesktopRuntime()`，但只在 `!service` 时才用新 runtime 构造——所以 rebootstrap 之后拿到的是**新 runtime 外面套着旧 service**。

后果因此从「`getConfig()` 撞 not-open」扩大到：
- `getConfig` / `getLocalStatus` / `setConfig` / `setEnabled` → 走 `configStore` → 死 `kkv`；
- `push()` → `buildCoordinator` → `exportSnapshotToPath(runtime, …)` → `checkpointDesktopDatabase(runtime.conn)`（`db-backup.service.ts:78`）→ **死连接上的 `PRAGMA wal_checkpoint`**；
- `testConnection` → `configStore` → 死 `kkv`。

即：**一次 pull 或一次本地备份导入之后，云同步的读接口与写接口同时报废，且没有任何自愈路径**（`getDesktopConnection()` 懒加载只重建 `conn`，不重建 kkv/secretStore 句柄，更不重建 service）。

触发面复核（两条生产路径都确认）：
- `ipc/handlers/cloud-sync.ts:91` `rebootstrapDesktopRuntime()`；
- `ipc/handlers/backup.ts:48-50` `if (result === "imported") await rebootstrapDesktopRuntime();`

**与 D5 的耦合（新增结论）**：若把 D5 的无条件 rebootstrap 改成条件化，pull 路径就不再制造死句柄，但**本地备份导入路径（`backup.ts:49`）不受影响**——所以 S-CS-02 不能靠 D5 收敛掉，必须修单例失效。

定级：维持 P1（单次会话内不可恢复的功能线全断，且无用户可见的自愈提示）。

## §2 S-CS-03 adjusted：桌面 pull↔push 已被 `syncBusy` 挡住，真实暴露面是 mobile + agent

原报告给出的后果链是「push 拷完库（t0）→ pull 整库替换（t1）→ push 上传 t0 旧快照（t2）」。本轮核到 desktop 侧**存在进程内串行化**：

```ts
// apps/desktop/.../cloud-sync.service.ts:238-241 / :281-284
if (syncBusy) { throw new Error("云同步进行中，请稍后再试"); }
syncBusy = true;
```

两处检查与置位之间**没有 `await`**，在单线程事件循环下是原子的，所以 desktop 单进程内的 pull 与 push 不可能交错。**原报告的 t0/t1/t2 交错链在桌面上不成立。**

但两件事仍然成立：

1. **移动端无 `syncBusy`**：`git grep -n "syncBusy" -- apps/mobile/src` **零命中**。`pullCloudSync`（`:302`）与 `pushCloudSync`（`:374`）是两个各自独立的导出函数，除 `maintenanceBusy` 计数外无任何 pull↔push 互斥。CloudSyncProgressScreen 是唯一入口，但 UI 单选不能替代进程级互斥（进度遮罩、系统返回键、其它入口调用都可能造成交错）。**交错链在移动端成立。**
2. **pull↔agent 交错在两端都成立**：`pull()` 全程不查 `isAgentActive()`（`:143-182` 全文确认），spec 的 pull 伪码（`spec.md:152-160`）本身也没有这一步，isAgentActive 只写在 push 伪码里（`:166`）。agent 流式写入中途 `importSnapshotFromPath` 覆盖活动库文件（desktop `db-backup.service.ts:116` `copyFile(srcPath, dbPath)` / mobile `db-backup.service.ts:151` `fs.cp`），在途写入丢失或落进已废弃的 inode。这条不受 `syncBusy` 保护——`syncBusy` 只管云同步自己。

**缓解措施核查**：`pushMutex`（`PushAgentMutex`）实现质量高（FIFO + 超时降级 + handle 匹配），但只在 `push()` 入口 acquire（`:189`），`pull()` 不参与；且 `PushAgentMutex` / `getDefaultPushAgentMutex` 未从 `infra/cloud-sync/index.ts` 导出（该文件 45 行已逐行读过，导出块只有 errors / ports / model / lock / paths / coordinator 六组），apps 侧零 acquire——**这一层对 pull 完全不构成缓解**。

定级：维持 P1，但触发面改写为「移动端 pull↔push 交错 + 两端 pull↔agent 交错」。修复建议不变（pull 与 push 共用互斥 + pull 入口与 `importSnapshotFromPath` 之前各复检一次 `isAgentActive()`）。

## §3 S-CS-04 confirmed：结构确认，触发面比原报告更硬

结构事实逐行复核无误：`acquireMobileDbMaintenanceBusy()` 在 `:317`，`createCoordinator(...)` 在 `:332`（**try 之外**，try 起于 `:338`），`releasePullBusy()` 只在 `finally`（`:367`）。`maintenanceBusyCount` 是模块级变量（`db-maintenance-busy.ts:15`），只有 `Math.max(0, …)` 钳制，**无 TTL、无自愈、无看门狗**。

原报告给的触发路径是「SKSP `has=true` 但 `get` 返回空」。本轮在 `packages/core/src/infra/sksp/impl/base-sqlite-secret-store.ts` 找到一条更硬的：

```ts
// :58-67  has —— 只看行是否存在
async has(ref) { const rows = await queryTemplate(...); return rows.length > 0; }
// :48-55  get —— 同一行还要过 algo 校验与解密
if (String(row.algo) !== this.strategy.algo) {
  throw new SkspError("DECRYPT_FAILED", ...);
}
return this.strategy.decrypt(ref, row);
```

`has` 与 `get` 判据**结构性不等价**：`has=true` 只说明行在，`get` 还要过 `algo` 校验（平台密钥变更后旧行 algo 不匹配）与解密（DPAPI/Keystore 上下文失效、密钥轮换）。任一失败都会让 `createCoordinator` → `buildS3StorageConfig`（`cloud-sync-config.store.ts:313-323`）抛错。

判据链的第二个不等价点（原报告已提，本轮确认）：`getCloudSyncLocalStatus` 的 `configured` 要求 `deviceId` 非空（`:220`），而 `buildS3StorageConfig` 根本不判 `deviceId`——两侧判据集合不同向。

因此 verdict：**结构 confirmed（P1 成立）；触发面从 suspected 升为 confirmed-by-construction**——不需要真机注入就能指出至少两条必然抛错的配置状态，缺的只是「用户能否走到该状态」的现场证据。**不需要为这条派真机验证**（原报告争议 D2 的选项作废）。

后果可达性也复核通过：`isMobileDbMaintenanceBusy` 的两个消费方是消息正文压缩搬运与 blob 二进制归一的让路守卫，令牌泄漏后它们在本进程剩余生命周期内全部让路停摆。

## §4 S-CS-07 confirmed：两处 import 函数的三处吞错是确定性事实

`db-backup.service.ts` 两个 import 函数逐行核对：

| | 校验 | 备份 | 覆盖 | 回滚 | 删 bak |
| --- | --- | --- | --- | --- | --- |
| desktop `:99-133` | `:104` 整包 `readFile` | `:114` `.catch(()=>undefined)` | `:116` 裸 `copyFile` | `:125` `.catch(()=>undefined)` | `:128` `.catch(()=>undefined)` |
| desktop `:141-174` | `:146` 已有内存 bytes | `:155` `.catch(()=>undefined)` | `:157` 裸 `writeFile` | `:167` `.catch(()=>undefined)` | `:170` `.catch(()=>undefined)` |
| mobile `:130-169` | `:135` 仅 exists+size | `:146` 裸 `await fs.cp` | `:151` 裸 `await fs.cp` | `:160-162` 先 `exists` 再 `cp`（`.catch` 兜底） | **不删 bak** |

原报告的核心判断（「桌面吞、移动端不吞」是桌面侧独有的回归）在代码上成立——**唯一的偏差是 mobile 的回滚拷贝也带了 `.catch(() => undefined)`（`:162`）**，所以「移动端完全没有吞」这句不准确；但 mobile 因为回滚前先 `exists` 且从不删 bak，失败形态是「抛原错 + 保留可回滚副本」，与桌面「抛原错 + 删掉唯一副本」不是同一量级。**结论不变，定级不变。**

「备份失败 → 覆盖成功 → 还原三表失败 → 回滚也失败」这条链上磁盘最终状态是远端快照、且 bak 已删——`getDesktopConnection()` 懒加载打开的就是远端内容，本地未同步改动无声消失。**这是本簇唯一一条会造成不可逆本地数据丢失的 P1**，修复优先级应高于同为 P1 的其它几条。

附注（表述瑕疵，不影响 verdict）：原报告写「桌面把移动端踩过的坑又踩了一次，且踩的是更隐蔽的版本（第三参被忽略）」。桌面 `db-backup.service.ts:104` 实际是 `readFile(srcPath, { encoding: null })`，**根本没有传第三参**，是直接整包读入；「第三参被忽略」是移动端 `db-backup.service.ts:56` 注释里对 RN `fs.readFile` API 的警告。结论（桌面整包读入）一致，机理描述需更正。

## §5 S-CS-16 confirmed，并派生出报告未记的一条 mobile 侧缺陷

顺序事实确认：
- desktop：`service.pull()` 内 `:255 setLastSyncedRev` / `:256 recordPull` → 返回 → handler `cloud-sync.ts:91 rebootstrapDesktopRuntime()`；
- mobile：`pullCloudSync` 内 `:341 patchCloudSyncLocalStatus` → `:346 onRebootstrap()`（`CloudSyncProgressScreen.tsx:36` 传入的 `useNovelMaster().retry`）。

两侧令牌边界（release 在 rebootstrap 之后）复核为**正确且是刻意设计**，与原报告一致。

**新增缺陷（建议登记为 P2）**：mobile 的失败路径没有兜住记账异常，desktop 兜住了。

```ts
// desktop cloud-sync.service.ts:265 —— 兜住了
await this.configStore.recordPull(false, detail).catch(() => undefined);
// mobile cloud-sync.service.ts:360-365 —— 没兜住
await patchCloudSyncLocalStatus(runtime, { lastPullAt: now, lastPullResult: 'error' });
progress.fail(error);
throw mapSdkError(error);
```

在 S-CS-01 触发的场景里（连接已被 `importDatabaseBackupFromPath` 关掉、随后某步抛错），mobile 的 `patchCloudSyncLocalStatus` 本身会因 `kkv` on closed connection 抛错，**覆盖掉原始错误**并逃出函数：用户看到的是连接类报错而不是真实原因，`progress.fail` 不执行（进度条卡在运行态）。`finally` 的 `releasePullBusy()` 仍会执行（JS finally 语义），所以**不构成令牌泄漏**，但错误可观测性受损。修 S-CS-01 时顺带把这一行对齐 desktop 的 `.catch` 即可。

## 顺带核到的争议项（任务书指定的 W6 项）

### D1「本地备份导入路径是否也有『用已关连接记账』的同类行」→ **否，S-CS-01 的影响面不外扩**

`ipc/handlers/backup.ts:38-57` 逐行读过：`importDatabaseBackup(parentWindow())` → 内部 `importDatabaseBackupFromBytes`（会关连接）→ `if (result === "imported") await rebootstrapDesktopRuntime()` → 返回 `BackupImportResult`。**全路径没有任何云同步记账写**（不写 `lastSyncedRev`、不写 `recordPull`）。所以 D1 的答案是：S-CS-01 的「rev 记不上」只发生在云同步 pull，本地备份路径不存在同类行。

**但 D1 引出的第二问成立且更重要**：本地备份导入同样会 `rebootstrapDesktopRuntime()`，因而同样触发 **S-CS-02** 的单例失效——即「用户只要做一次本地备份导入，此后所有云同步 handler 全部拿到绑在死连接上的 service」。这是 S-CS-02 两条触发路径中与云同步 UI 完全无关的那一条，用户侧的表现是「我没碰云同步，云同步怎么坏了」。

补充一条本轮新看到的事实（不在原报告范围，供 D5 参考）：`handleBackupImport` 的 `if (result === "imported")` 条件化是对的，而 `handleCloudSyncPull` 没有任何对应条件化（见下）。

### D5「`handleCloudSyncPull` 无条件 rebootstrap 是有意还是漏判」→ **倾向漏判，spec 无拍板依据**

三条证据：
1. `git log -S "rebootstrapDesktopRuntime" -- apps/desktop/src/main/ipc/handlers/cloud-sync.ts` 只有一条命中 `1000ae1f`（最初的 IPC 通道提交），**此后无任何提交讨论过这个条件化**；后续 2010777e（busy 令牌下沉）只加了 acquire/release，没碰 rebootstrap 的条件。
2. spec 的 pull 伪码（`spec.md:152-160`）**完全没有提 rebootstrap**，只写 `dbSync.importSnapshot(bytes) // 保留服务商 + rebootstrap`——即把 rebootstrap 当作 import 管线的一部分，而不是 pull handler 的责任；`ALREADY_UP_TO_DATE` 分支在 spec 里是 `return ALREADY_UP_TO_DATE`（早返回），不涉及任何连接生命周期动作。
3. 同仓同类实现给出了相反口径：`backup.ts:48` 是 `if (result === "imported")` 才 rebootstrap。

裁决建议：**按漏判处理**（条件化为「仅在真正发生库文件替换时 rebootstrap」），但**不作为 S-CS-02 的修复手段**——见 §1 末段，本地备份路径那条触发面不受影响。

### D2「要不要派真机注入 SKSP has=true / get=空」→ **不必，理由见 §3**

结构上已能证明 `has`/`get` 判据不等价且存在必然抛错的状态（algo 不匹配、解密失败），无需真机注入坐实。派真机的边际收益低于成本；建议改为在修复 S-CS-04 时补一条单测「`buildS3StorageConfig` 抛错 → `isMobileDbMaintenanceBusy()` 回到 false」。

## 查漏：原报告未记、但落在本簇 pull 生命周期时间线上的点

以下三条本轮在读码时撞见，均为**代码事实**、不涉及产品决策，登记备查（级别建议 P2/P3，不改本簇 P1×7 的定级）：

1. **mobile pull 的 `finally` 删了一个从未创建的路径**（`cloud-sync.service.ts:368` `unlink(exportTempPath)`）：pull 从不创建 `exportTempPath`，与 S-CS-24 是同一形态的 desktop 侧孪生条目（原报告只点了 desktop `:269`/`:272`）。被 `.catch(() => undefined)` 吞掉，无功能后果，但同样会掩盖将来真实的清理遗漏。
2. **mobile 的 `importDatabaseBackupFromBytes` 临时文件无随机后缀**（`db-backup.service.ts:184` `import-bytes-${Date.now()}.nmbackup`）：同毫秒并发会互相覆盖；与 S-CS-24 的 `Date.now()` 命名同源。
3. **desktop pull 的 `ALREADY_UP_TO_DATE` 早返回路径不重置 `importTempPath` 的实际使用状态**（`cloud-sync.service.ts:259-263` return 后仍走 finally 的双删）：与第 1 点同源，不单独出账。

## 本轮未覆盖（诚实声明）

- **未实测**：全部结论均为源码推导。S-CS-01 的 better-sqlite3 真实驱动实测、S-CS-04 的 SKSP 现场状态、S-CS-07 的 better-sqlite3 checkpoint 并发容忍度，本轮均未运行。
- **未逐行读**：`provider-table-snapshot-validate.ts`（P2 S-CS-11 的核验对象）、`apps/desktop/renderer/features/settings/SettingsViews.tsx`（P2 S-CS-23 的轮询周期）、`apps/mobile/src/screens/stack/CloudSyncStorageScreen.tsx`（S-CS-19 的 UI 配套逻辑）——这三条都是 P2，不在本轮 P1×7 范围内。
- **未核 P2×20 / P3×7**：本轮按指令只验 P1。台账中 S-CS-12/S-CS-17/S-CS-22/S-CS-25 等 P2 条目在读码时顺带确认了「代码事实成立」，但**未做定级复核**，W7 合并时请勿把本轮的 confirmed 覆盖到 P2/P3。
- **未查 docs/apm/**：按纪律未写入、未读取记忆目录，§3 对 apm-recall 规则的引用仅来自 synth/cloudsync.md 的转述。
