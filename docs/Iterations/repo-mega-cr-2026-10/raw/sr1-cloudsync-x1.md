---
zone: cloudsync
agent: sr1-cloudsync-x1（readonly 审查机位）
files_scanned: >
  docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一、四章）、
  fix-spec/wave-b-cloudsync-x1.md（全文 615 行）、
  fix-spec/wave-b-cloudsync.md（§0 / §8.1 / :396-407 / :713-830）、
  fix-spec/SPEC.md、fix-spec/state.md、ledger-v2.md（§2.6 三行 / §10 两行）、
  docs/apm/RULE.md（验收牙齿三判据、Windows 假信号两条、ESM 零 mock 基座）、
  apps/mobile/src/services/cloud-sync.service.ts、cloud-sync-config.store.ts、
  db-maintenance-busy.ts、db-backup.service.ts、map-cloud-sync-sdk-error.ts、
  apps/desktop/src/main/services/cloud-sync.service.ts、
  packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts、ports/file-system.port.ts、
  packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts、logic/lock.ts、
  ports/object-storage.port.ts、db-sync.port.ts、
  apps/mobile/__tests__/cloud-sync.service.test.ts、db-maintenance-busy.test.ts、
  db-backup.service.test.ts、cloud-sync-config.service.integration.test.ts、
  apps/desktop/test/cloud-sync-handlers.test.ts、db-backup-busy.test.ts、
  packages/cloud-sync-driver-s3/test/s3-object-storage.test.ts、
  packages/core/test/cloud-sync/coordinator.test.ts
基线: main@fe79b781（worktree D:\Dev\nm-worktree\mcr）
---

# sr1 · wave-b-cloudsync-x1 分片审查（S-CS-04 / S-CS-08 / S-CS-09 + 并入说明）

## 摘要

三条的**病症全部在 `fe79b781` 工作区重推导成立**，行号逐处核对**几乎全对**（S-CS-04 的 8 个
行号、S-CS-08 的 6 个、S-CS-09 的 12 个全部命中）。修法方向也站得住。**但四条组（3 条 + 并入说明）
无一 execute-ready**：S-CS-04 的修法样例**编译不过**（`const now` 声明在 `try` 内、`catch` 里要用）；
S-CS-09 的验收 2 是**恒绿无牙断言**（夹具根本到不了新代码路径）；S-CS-08 的修法第 5 步**引用了不存在的
注释**。另有两处**跨分片事实冲突**（core 测试条数 20 vs 主分片已定稿的 17、desktop `npm test` 漏了
RULE 的 Windows 假信号两条）与一处**ledger 归属误读**。全部是 doc-fix 级，无 P0 缺失。

---

## 1 · 逐条 verdict 表

### 1.1 S-CS-04 —— 移动端 `pullCloudSync` 的 busy 令牌泄漏

| 维度 | 结论 | 核对结果 |
|---|---|---|
| 病症机理 | ✅ 成立 | `cloud-sync.service.ts:317` acquire → `:326` `createCloudSyncProgress` / `:332` `await createCoordinator` → `:338` 才进 `try`，`:366-370` `finally` 覆盖不到。实测确认 |
| 行号 | ✅ 全对 | 317 / 318 / 319 / 326 / 332 / 338 / 366 / 367 八处逐行命中 |
| 计数语义 | ✅ | `db-maintenance-busy.ts:15` `let maintenanceBusyCount = 0`、`:31-32` `Math.max(0, …-1)`，无 TTL、无自愈 |
| 触发面 | ✅ 成立 | `cloud-sync-config.store.ts:180` `secretStore.has()` → `:191 secretKeySet` → `:215-220 configured`（存在性）vs `:313-322` `buildS3StorageConfig` 判 `secretKey` 明文串（内容），两个判据确实不等价 |
| `createCoordinator` 抛点枚举 | ✅ 全对 | `:149` / `:150` / `:151` / `:171` / `:174` 五处（spec 写「四个独立的抛点」后列了 5 个，措辞小瑕） |
| desktop 对照组 | ✅ | `apps/desktop/test/cloud-sync-handlers.test.ts:91` 用例名与 `:92-93` 注释逐字吻合 |
| `pushCloudSync` 无此问题 | ✅ | `:374-421` 全函数零 `acquireMobileDbMaintenanceBusy`（逐行读过），排除成立 |
| 修法可行性 | ❌ **样例不可编译** | 见 MF-1：`const now` 在 `try` 块内声明，`catch` 分支要用 ⇒ 块作用域 + TDZ，TS 直接报错 |
| 修法完备性 | ⚠️ 有缺口 | `!= null` 守卫设计正确（风险 R1 分析准确：`unlink(undefined)` 同步抛不被 `.catch` 接住），但与提交 5 的落点约束缺失（MF-6） |
| 验收 1 / 2 | ✅ 有牙且可测 | `cloud-sync.service.test.ts:12/:33` 的 `mockBuildS3Config` 拒绝即可造出 `:150` 抛点；`:12/:33` 行号全对；「既有全 8 条」核对为 `sha256Hex`1 + `test`2 + `pull`3 + `push`2 = 8 ✅ |
| 验收 3（不锁文案） | ✅ 判断正确 | 实读 `map-cloud-sync-sdk-error.ts:114-144`：`new Error('请先完成云存储配置')` 落不到任何分支，最终 `:144` → `NETWORK / '云存储连接失败，请检查网络与配置'` ⇒ spec 只写「别绑死文案」是对的，但见 MF-7 |
| 验收 4 | ⚠️ 与声称的守卫不对齐 | 「`createCoordinator` 成功但 `pull` reject」这条路径下两个临时路径都已定义，**观测不到 `!= null` 守卫**（MF-4） |
| 验收 5（正交性说明） | ✅ | `db-backup-busy.test.ts:101-127` 逐行核对，用例名与断言一字不差；`db-backup.service.test.ts:307` ic-20 对位正确 |
| 回归线真实性 | ⚠️ | 4 个文件全部真实存在；`:17-21` 兜底（实际 `:18-19`）、8 条用例均核对通过；「含 5 条 ic-20」实为 4 条（MF-8） |
| 依赖闭合 | ⚠️ | 「无前置条目」✅；与提交 2 的 `retryAndWait` 耦合（风险 R3）✅ 已在 `wave-b-cloudsync.md:286-293` 核实；与提交 5 的 `syncBusy` 落点未约束（MF-6） |
| **本条 verdict** | **not-ready** | 病症/证据层满分，修法样例有编译错误 + 验收与 R1 未对齐 + 提交 5 交互缺口。doc-fix 级，3 处 |

### 1.2 S-CS-08 —— S3 driver `putFile` 多余整拷

| 维度 | 结论 | 核对结果 |
|---|---|---|
| 病症机理 | ✅ 成立 | `create-s3-object-storage.ts:226-227` `raw` 来自 `readLocalFile` → `fileSystem.readFile(path)`（`:143` 纯转发），返回类型 `Promise<Uint8Array>`（`file-system.port.ts:10`）⇒ `new Uint8Array(<TypedArray>)` 必是逐元素拷贝 |
| 行号 | ✅ 全对 | 225/226/227/228/231/232/233 六处命中；`readLocalFile` `:136-143` ✅；`S3ObjectStorageDeps` `:14-23` ✅ |
| 类型学论证 | ✅ | 「编译期已保证 `raw` 是 Uint8Array」成立 |
| mobile 放大链 | ⚠️ 部分 | `:156-161` `Buffer.from(bytes).toString('base64')` 逐字核对成立；但量化主张「≈ 1+1+1.33 份」低估且未实测（MF-9） |
| app 层分块对照 | ✅ | `apps/mobile/src/services/db-backup.service.ts:37-38` 注释与 `WRITE_CHUNK_BYTES = 256*1024` 逐字吻合 |
| 修法 1 / 2 / 4 / 5 | 1 ✅ 2 ✅ 4 ✅ **5 ❌** | 见 MF-3：`object-storage.port.ts`（全文 33 行）与 `file-system.port.ts`（全文 13 行）**均已整读**，只有「优先于内存路径 / 优先于 bytes 路径」这类**选择顺序**措辞，**没有**「避免一次性读入 / 走文件路径省内存」的承诺 ⇒ 第 5 步无靶子、不可执行 |
| 修法 3（getToPath 不改） | ✅ 边界清楚 | `:231-234` 确实整份下内存再写盘，判为 P2 合理 |
| 验收 1（引用相等有牙） | ✅ 可测且有牙 | `s3-object-storage.test.ts:183-210` putFile 用例确认存在；`:195` `assert.deepEqual(command.input.Body, payload)` 确认；`createMockClient` 在 `:193` 直接收 `PutObjectCommand`，`input.Body` 就是 `:205` 透传进去的引用 ⇒ 注入哨兵后 `assert.equal` 能钉住；「删掉 `:227` 整行会红」判定正确 |
| 验收 2（保留 deepEqual） | ✅ | `:195` 确实存在且不许删的判断正确 |
| 测试基座合规 | ✅ | RULE 的「零 mock 基座」约束只约束 desktop `node:test`；本条用的是仓库既有 `deps.client` / `deps.fileSystem` 注入缝，`:192-203` / `:219-232` 逐行确认 ⇒ spec 的辩解成立 |
| 回归线 | ⚠️ | driver 10 条核对通过（head×2/get/put/CS-S1/OSS×2/putFile/getToPath/isAliyun = **10** ✅）；core `coordinator.test.ts` 写「全 20 条」与主分片定稿 17 冲突（MF-5）；desktop `npm test` 漏 RULE 假信号（MF-10） |
| 风险 R1（契约写死） | ✅ 核对扎实 | desktop `cloud-sync.service.ts:362-365` `node:fs` 每次新分配；mobile `readFileBytes`（`:96-99`）`new Uint8Array(Buffer.from(base64,'base64'))` 每次新分配 ⇒ 两处均满足，spec 结论正确 |
| **本条 verdict** | **not-ready** | 病症/验收/风险三层都实，唯独修法第 5 步引用了不存在的注释，另加 2 处回归线口径错。doc-fix 级，3 处 |

### 1.3 S-CS-09 —— push 收尾用 etag-only 重读结果覆盖 rev

| 维度 | 结论 | 核对结果 |
|---|---|---|
| 病症机理 | ✅ 成立 | `:249 nextRev` 是 try 前常量；`:286-295 finalStatus.rev = nextRev / lock = null`；`:297-300` 条件写失败后只解构 `{etag}`、丢弃 `status`、拿新 etag **无条件覆盖** ⇒ rev 回退 + 抹掉他人租约 |
| 行号 | ✅ 全对 | 249/271/277/281-283/286/288/294/297/298/299/300/302/306/310/328/359/379-386 逐行命中 |
| 前置条件链 | ✅ 成立 | `:281` 无 `else` ⇒ 续租失败被静默吞、`statusEtag` 停在旧值 ⇒ `:297` 必返 `null` |
| 回滚面闭合 | ✅ | `tryClearLock` `:370-393`，三重守卫 `:379-386` 确认；`lock.ts:25-33` `canAcquireLock` 在租约过期时返回 `true`（`:29-31`）确认 ⇒ 「只判锁不够、必须再判 rev」的双判定论证成立 |
| import 无需新增 | ✅ | `cloud-sync-coordinator.ts:8-14` 已 import `canAcquireLock`，`:230` 在用 |
| 三个错误码已在用 | ✅ | `NEED_PULL_FIRST` `:226`、`LOCK_HELD_BY_OTHER` `:231`、`LOCK_CONTENTION` `:240/:302` 全部核对 |
| 修法正确性 | ✅ | 正常单设备路径下 `latest.lock` 是自己的锁 → `canAcquireLock` 为 `true`、`latest.rev < nextRev` ⇒ 直通，不误伤 |
| 修法 2（补 else 留痕） | ✅ | 边界判断正确：不在此处抛错是对的（快照已上传、计数已上去） |
| 验收 1 | ✅ 有牙且可测 | `coordinator.test.ts:31-107` `createStorage`、`:50/:83` `getStatusWrites`、`:78-80` `ifMatch` 判定、`:126` `...overrides` 行号全对；在 `exportSnapshotToPath` 钩子里 `storage.put(statusKey(PREFIX), …)` 不传 options 即无条件写 ⇒ 无需加新口子，判断正确 |
| 验收 2 | ❌ **恒绿无牙** | 见 MF-2：初始 status 带他人有效租约时，`runPush` 在 `:230 canAcquireLock` 就抛 `LOCK_HELD_BY_OTHER`，**永远进不了 `:298` 重读分支** ⇒ 修前修后都绿，这条断言没有牙齿（正撞 RULE ①） |
| 验收 3（反向断言） | ✅ | 构造可行且能区分「守太死」；初始 `lock:null` + 钩子写 `{rev:2, lock: 已过期}` ⇒ `:297` 失败 → 重读 → 双判定放行 → 写 `{rev:3, lock:null}` |
| 验收 4 | ❌ **不可测** | 见 MF-11：续租分支门槛是 `:271 uploadElapsed > this.leaseSeconds * 500`，`leaseSeconds` 缺省 900 ⇒ 需 450 秒上传；spec 未提 `CloudSyncCoordinatorDeps.leaseSeconds`（`cloud-sync-coordinator.ts:43`）这个注入点，测试内 `createCoordinator` 包装（`:130-157`）也没透传它；断言「push 最终走 1/2/3 三条之一」本身也不具体 |
| 验收 5 | ✅ | 挂在验收 2 上即可，但因验收 2 要重做夹具，此条须同步改（MF-2 覆盖） |
| 测试基座「零改动」 | ⚠️ | 若采纳验收 4，就必须给**测试文件内**的 `createCoordinator` 包装加 `leaseSeconds` 透传 ⇒ 「零测试基座改动」这句要限定为「零生产基座改动」 |
| 回归线 | ⚠️ | `:290 CS-P5` / `:307 CS-P5b` / `:344 CS-P6` / `:517 T-SC10d` 行号全对；`T-SC10e`（`:564`）的描述不实（MF-12）；条数 20 vs 17（MF-5） |
| 「不要用 npx tsx --test 定向跑」 | ✅ | 与 RULE 的 Windows 假信号第二条一致 |
| **本条 verdict** | **not-ready** | 病症/修法/风险三层质量最高，但**验收 2 无牙、验收 4 不可测**是硬伤。doc-fix 级，3 处 |

---

## 2 · 并入说明（§4）核对

| 核对项 | 结论 | 依据 |
|---|---|---|
| §4.1 与 §4.4 自洽性 | ⚠️ 基本自洽但表述绕 | §4.1 说 S-CS-08「独立 PR、不进 §8.1」，§4.4 的「建议终态（8 行）」却把 S-CS-08 列为第 7 行（行内已注明「原则上独立 PR / 若 judge 裁定并入」）。读者需要自己拼装，建议表题改为「推荐案（含 S-CS-04；S-CS-08 行仅在并入时生效）」 |
| S-CS-04 插第 6 位 | ✅ 与主分片 §8.1 不冲突 | 主分片强制约束（`:899-900`）为「1→2→3 不可拆；4 在 2 之后；5 与 6 相对独立」⇒ 插在 5 之后、注释诚实化之前，成立 |
| §4.2 的行号级理由 | ✅ 核实成立 | 主分片 `:286-293` Step 4 确实把 mobile 契约改成 `retryAndWait: () => Promise<MobileNovelMasterRuntime>`；`:817-820` 确实把「mobile 加模块级 `syncBusy`」列为 S-CS-03 必做子步骤，且 `:726` 已确认「mobile 零 syncBusy」。两条落点重叠属实 |
| 「进主分片 PR 的理由是文件级冲突、不是 §0 语义论证」 | ✅ 判断正确 | 与主分片 §0（`:16-26`）「六条是一条 pull 生命周期的六个断面」确实不匹配，§4.5 的提醒是对的 |
| S-CS-09 归属（推荐独立 / 备选并入提交 5） | ✅ 论证成立 | `cloud-sync-coordinator.ts` 两条改不同函数（`pull():143-182` / `runPush` 收尾 `:281/:297-304`），`T-SC10d/e` 重叠属实 |
| §4.6 的 ledger 归属论断 | ❌ **事实错误** | `ledger-v2.md:457` 的「（同波顺带）」行列的是 **`CS-08`（core-storage 簇）**，不是 `S-CS-08`；`SPEC.md:22` 的 P1-S 清单 `M-03 / M-04 / CS-02 / CS-07 / CS-08 / B / S-D-02` 与台账逐项一致 ⇒ **不存在 spec 所说的归属不一致**（MF-13） |
| §4.6 的「请 judge 补 SPEC.md」请求 | ⚠️ 已过时 | `SPEC.md:20` 已新增独立行 `wave-b-cloudsync-x1.md`（且由 `sr1-cloudsync-c` 标注）。文件头 `:10` 仍写「请把 §2 的 `wave-b-cloudsync.md` 行补上…」，与实际做法（另起一行）不一致（MF-14） |
| 补位声明的顺带提及行号 | ⚠️ 行号错 | 全目录 grep 只命中 `wave-b-cloudsync.md:428`（「即 S-CS-04 那类后果」），文件头 `:7-8` 写的是 `:400`（MF-15） |
| 与 S-CS-07 / S-CS-01 的先后 | ✅ 无冲突 | S-CS-07（提交 1）只改 `db-backup.service.ts` 错误处理，与 S-CS-04 无交集；S-CS-01 在提交 2，早于 S-CS-04 的第 6 位，顺序自洽 |

**并入说明 verdict：not-ready**（2 处事实错误 + 3 处表述瑕疵）。

---

## 3 · must-fix 清单（doc-fix 照抄级）

| # | 级别 | 位置 | 问题（已实证） | 要求改成 |
|---|---|---|---|---|
| MF-1 | P1 | x1 §1 修法第 1 步代码块 `:105-123` | `const now = new Date().toISOString();` 写在 `try {` 块内（行 108），而 `catch` 分支的 `patchCloudSyncLocalStatus(runtime, {…lastPullResult:'error'})` 要用它 ⇒ 块作用域 + TDZ，样例**编译不过** | 把 `const now` 移到 `acquireMobileDbMaintenanceBusy()` 之前（`try` 外，与现状 `:331` 等价）；代码块其余保持 |
| MF-2 | P1 | x1 §3 验收 2 + 用例名 + 验收 5 | 夹具不可达新代码：初始 status `{rev:2, lock: buildLease('other-device',900)}` 会在 `cloud-sync-coordinator.ts:230 canAcquireLock` 提前抛 `LOCK_HELD_BY_OTHER`，`:298` 重读分支永不执行 ⇒ 修前修后皆绿，**违反 RULE ①** | 初始 status 改为 `{rev:2, lock:null}`，把「他人有效租约」放进 `exportSnapshotToPath` 钩子里由 `storage.put` 无条件写入（与验收 1 同一手法，仅 lock 不同）；验收 5 随之改挂在同一条 |
| MF-3 | P1 | x1 §2 修法第 5 步 | 引用的注释不存在：`packages/core/src/infra/cloud-sync/ports/object-storage.port.ts`（全文 33 行）与 `packages/cloud-sync-driver-s3/src/ports/file-system.port.ts`（全文 13 行）均已整读，只有 `:25/:31` 的「优先于内存路径 / 优先于 bytes 路径」与 file-system 头的「剥离 node:fs 硬依赖」，**无任何「省内存 / 避免整包」口径** ⇒ 该步无靶子 | 删除第 5 步；把「注释诚实化」整条移交给 Wave E 的「注释承诺≠实现」钩子（主分片提交 6 同类），本条只留 1/2/3/4 四步 |
| MF-4 | P1 | x1 §1 验收 4 + 风险 R1 | 验收 4 的场景（`createCoordinator` 成功、`pull` reject）下 `exportTempPath/importTempPath` 均已定义，**观测不到 `!= null` 守卫**，与它自称「钉住风险 R1」不符 | 把「`mockUnlink` 未以 `undefined` 被调用」写进**验收 1**（`createCoordinator` 抛错那一条）——那才是唯一能钉住守卫的路径；验收 4 降级为「两条路径都在、参数是完整路径」的补充断言 |
| MF-5 | P2 | x1 §2 回归线、§3 回归线（两处「全 20 条」） | 与主分片 `wave-b-cloudsync.md:400-403` 直接冲突——那里已定稿为 **17** 条并明写「原稿『20 条』是计数笔误，数字错会让逐条复跑失去锚点」 | 两处改为「全 **17** 条」，并沿用主分片 `:401-402` 的枚举锚点（`CS-P1`/`CS-P1b`/`CS-P2`/`CS-P3`~`CS-P6`/`CS-P5b`/`forceOverwriteRemote`/`T-SC10a`~`e`/`PushAgentMutex`×3） |
| MF-6 | P1 | x1 §1 依赖 / 修法 | 与主分片提交 5 的**落点约束缺失**：提交 5 要在 mobile 加模块级 `syncBusy`（`wave-b-cloudsync.md:817-820`），其 `if (syncBusy) throw …; syncBusy = true` 若落在 `acquireMobileDbMaintenanceBusy()` 之后、`try` 之外，就会**原样复现本条的泄漏形态** | 在 §1 依赖栏加一条硬约束：「提交 5 的 `syncBusy` 检查与置位必须在 `acquireMobileDbMaintenanceBusy()` 之前，或整体落进本条建立的 `try` 内」；并在 §4.2 的理由 2 后面补一句交叉引用 |
| MF-7 | P2 | x1 §1 风险 R2 | spec 只把错误映射口径写成「实现期必查」。本轮已实测闭合：`map-cloud-sync-sdk-error.ts:114-144` 对 `new Error('请先完成云存储配置')` 落不到任何分支，最终 `:144` 返回 `NETWORK / '云存储连接失败，请检查网络与配置'` ⇒ **确实误导** | 把实测结论写进 R2，并给出口径（如：`createCoordinator` 的 `NOT_CONFIGURED` 类错误在 `pullCloudSync` 内原样透传、或在 `mapCloudSyncSdkError` 增加一条 `请先完成云存储配置` 归一），同时在验收 1 追加一条「reject 的 message 不含『网络』误导词」的弱断言 |
| MF-8 | P2 | x1 §1 回归线 | 「`db-backup.service.test.ts` 含 **5** 条 `ic-20` 用例（`:276-336`）」——实为 **4** 条（`:276` / `:290` / `:307` / `:327`） | 改为「4 条（`:276`/`:290`/`:307`/`:327`）」 |
| MF-9 | P3 | x1 §2 病症量化句 | 「mobile 峰值 ≈ 1 + 1 + 1.33 份」未实测且低估：`Buffer.from(uint8Array)` 自身也拷一份（`cloud-sync.service.ts:159`），且此处把**写路径**（`writeFile`）混进了**读路径**（`putFile`）的峰值 | 改为定性表述：「desktop 峰值 2×（已核对）；mobile ≥3×（未实测，PLAN §四要求数字须实测，此处不给数）」 |
| MF-10 | P1 | x1 §2 回归线 | 「`cd apps/desktop && npm test`」漏了 RULE 的两条 Windows 假信号：`run-tests.mjs` 单引号 glob 会**收集到 0 条测试**（看着全绿）、满负载需 `--test-concurrency=2`（`blob-binary-normalization-service.test.ts` 的 `cr-05` 偶发红）。主分片 §8.2 已把 `N-P0-02` 称为「本包全部回归线的地基」 | 照抄主分片 §8.2 的写法：`cd apps/desktop && npm test -- --test-concurrency=2`，并加一句「若 Wave A 的 `N-P0-02` 未先落，必须人工确认 `# tests N > 0`」 |
| MF-11 | P1 | x1 §3 验收 4 + 测试策略 | 不可构造也无可注入点：续租门槛是 `:271 uploadElapsed > this.leaseSeconds * 500`，`leaseSeconds` 缺省 `DEFAULT_LEASE_SECONDS = 900` ⇒ 需 450 秒上传；spec 未提 `CloudSyncCoordinatorDeps.leaseSeconds`（`cloud-sync-coordinator.ts:43`），测试内 `createCoordinator` 包装（`coordinator.test.ts:130-157`）也未透传它。且断言「push 最终走 1/2/3 三条之一」不具体 | 二选一：① 删掉验收 4，回归线保留 `T-SC10d` 逐条复跑；② 保留但写死注入方案（给测试内包装加可选 `leaseSeconds`，钩子里造一次设备 B 无条件写制造续租失败），并把断言换成具体 `code`。同时把「零测试基座改动」限定为「零**生产**基座改动」 |
| MF-12 | P2 | x1 §3 回归线 | 「`T-SC10e`（`:564`）**直接走 `:271-284` 续租段**，改了 else 分支必须复跑」——实读该用例：钩子里置 `agentActive = true`，在 `:267` 的 `isAgentActive` 检查就抛 `AGENT_ACTIVE`，**走不到 `:271`** | 改为「`T-SC10e` 覆盖的是 `:245-269` 的 catch/finally 清锁路径；**续租段 `:271-284` 目前无既有用例覆盖**——这正是验收 4 的价值所在」 |
| MF-13 | P2 | x1 §4.6 第二段 | 事实错误：`ledger-v2.md:457` 的「（同波顺带）」行列的是 `CS-08`（core 簇），不是 `S-CS-08`；`SPEC.md:22` 的 P1-S 清单与台账逐项一致 ⇒ 不存在 spec 所说的「归属不一致」 | 删掉该段，改为「S-CS-08 本就未出现在 `ledger-v2.md` §10 的任何执行格里，本分片是其首次 spec 化落点」 |
| MF-14 | P3 | x1 文件头 `:9-11`、§4.6 | 「请 judge 轮把 `SPEC.md` §2 的 `wave-b-cloudsync.md` 行补上…」已过时：`SPEC.md:20` 已新增**独立行** `wave-b-cloudsync-x1.md`，不是往 cloudsync 行上追加 | 改为「已补位（`SPEC.md:20` 新增独立行），本轮只需复核该行内容」 |
| MF-15 | P3 | x1 文件头 `:7-8` | 「全文 grep 只命中 `wave-b-cloudsync.md:400` 的一句顺带提及」——实际命中在 **`:428`**（「后台归一/压缩循环全进程停摆（即 S-CS-04 那类后果）」） | 改行号为 `:428` |
| MF-16 | P3 | x1 §1 依赖栏 | 「**无前置条目、无拍板项。**」与紧接的「台账『不同文件，可并行』在本轮被推翻」并列易被读成自相矛盾——台账那栏说的是**无跨条目依赖**（`ledger-v2.md:453` 的依赖列），不是「能否同 PR」，spec 自己也说了「无前置条目」 | 后半句改写为「台账『不同文件』的措辞与事实不符（提交 2 / 提交 5 都改 mobile `cloud-sync.service.ts`），据此并入主分片 PR」，避免用「推翻依赖」的口径 |
| MF-17 | P3 | x1 §2 修法第 4 步 | JSDoc 定位写成 `file-system.port.ts:10`，JSDoc 实际在 `:9`（`:10` 是签名行）；引文块把两者并成一行 | 行号改 `:9`，引文块拆成两行 |
| MF-18 | P3 | x1 §4.4 表题 | 「并入后 `§8.1` 提交顺序表的建议终态（8 行）」与 §4.1「S-CS-08 不进 §8.1」并列易误读 | 表题改为「推荐案终态（含 S-CS-04 为第 6 位；第 7 行 S-CS-08 仅在 judge 裁定并入时生效）」 |

---

## 4 · 结论

**组 verdict：No-Go。**

一句话理由：三条的病症、证据与修法方向经代码重推导全部成立、行号几乎全对，但 S-CS-04 的修法样例因 `const now` 的块作用域**编译不过**、S-CS-09 的验收 2 因夹具在 `:230` 就提前抛出而是**恒绿无牙断言**、S-CS-08 的修法第 5 步**引用了并不存在的注释**——三处硬伤叠加两处跨分片口径冲突（core 测试条数 20 vs 主分片定稿 17、desktop `npm test` 漏 RULE 假信号），doc-fix 闭合后即可转 Go。

- verdict 计数：3 条 + 并入说明 = **4 组，全部 not-ready；ok 组 0**（其中 P1 级 must-fix 7 条、P2 级 6 条、P3 级 5 条，共 18 条，全部为文档级、无一条需要重写病症或推翻修法方向）。
- 无 P0 缺失、无代码事实错误级阻断；本轮未发现任何「台账行号照抄未核对」的迹象，S-CS-04 / S-CS-08 / S-CS-09 的 file:line 引用准确度是已审分片中最高的一档。