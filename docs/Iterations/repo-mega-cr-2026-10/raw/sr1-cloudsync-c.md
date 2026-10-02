---
zone: fix-spec-review / wave-b-cloudsync / 组 C
agent: reviewer-C（S-CS-02 + D5 + S-CS-03 + cloudsync 债务池抽验）
files_scanned:
  - docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一、四章）
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-b-cloudsync.md（§0 §4 §5 §6 §7 §8）
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/SPEC.md
  - docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md（§2.6 §3 §4.2 §7#9 §10 Wave B）
  - docs/Iterations/repo-mega-cr-2026-10/synth/cloudsync.md（S-CS-05~S-CS-35 明细）
  - docs/apm/RULE.md（:33 明文化、:138 整库替换必须走 bootstrap 收口）
  - apps/desktop/src/main/services/cloud-sync.service.ts（全文 455 行）
  - apps/desktop/src/main/services/db-backup.service.ts（全文 238 行）
  - apps/desktop/src/main/ipc/handlers/cloud-sync.ts（全文 113 行）
  - apps/desktop/src/main/ipc/handlers/backup.ts（:38-57）
  - apps/desktop/src/main/runtime/desktop-runtime-singleton.ts（全文 55 行）
  - apps/desktop/src/main/services/cloud-sync-config.store.ts（:211-241）
  - apps/desktop/shared/ipc-types.ts（:1735-1737）
  - apps/desktop/renderer/features/settings/SettingsViews.tsx（:222-229, :318）
  - apps/desktop/scripts/run-tests.mjs（全文）
  - apps/mobile/src/services/cloud-sync.service.ts（:280-371）
  - apps/mobile/src/services/snapshot-file-hash.ts（全文）
  - packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts（全文 395 行）
  - packages/core/src/infra/cloud-sync/model/cloud-sync-status.ts（:19-40）
  - packages/core/src/infra/cloud-sync/errors/cloud-sync-errors.ts（:13）
  - packages/core/src/infra/db-backup/provider-table-snapshot.ts（:105-135）
  - packages/core/test/cloud-sync/coordinator.test.ts（17 条用例全枚举）
---

# 组 C 审查报告（S-CS-02 + D5 条件化 + S-CS-03）

> 基线：`feat/repo-mega-cr` HEAD=`fe79b781`，worktree `D:\Dev\nm-worktree\mcr`。
> 本报告只读：未做任何 git 写、未改生产/测试代码、未改 fix-spec、未动 `docs/apm/`。
> 全部 file:line 由本轮在 `fe79b781` 工作区**亲自打开核对**（`git grep` + Read）。

---

## 0 · 一句话结论

**组 C = Go（附 7 条 must-fix，其中 3 条属「验收不可测 / 指令自相矛盾」，doc-fix 后即可 execute）。**
行号与病症层面本组质量最高——**§4 §5 §6 三条共 30 余处 file:line，我逐条核对命中 29 处、完全准确**；
问题全部集中在**验收机制未落地**与**两处内部自相矛盾**，不是代码事实错误。

---

## 1 · 逐条 verdict 表

verdict 口径：`PASS` = 可直接 execute；`PASS-with-fix` = 有可执行缺陷，须先 doc-fix；`FAIL` = 病灶/修法与代码硬冲突。

| # | 条目 | verdict | 证据（本人逐行核对） | 修改建议 |
|---|---|---|---|---|
| **C1** | **S-CS-02**<br>§4 桌面云同步 service 单例不随 rebootstrap 重建 | **PASS-with-fix** | **行号全对（8/8 命中）**：`cloud-sync.service.ts:159` `constructor(runtime)`、`:160` `this.runtime = runtime`、`:161-164` `createCloudSyncConfigStore(runtime.kkv, runtime.secretStore)`、`:378` `const runtime = this.runtime`、`:432` `let service: DesktopCloudSyncService \| undefined`、`:434` `getDesktopCloudSyncService`、`:438` `await getDesktopRuntime()`、`:439` `if (!service) { service = new ... }`、`:446` `resetDesktopCloudSyncServiceForTest`——**逐字一致**。<br>**第二条死句柄复核成立**：`:378 → :391-396 exportDatabaseBackupToPath(runtime,…) → db-backup.service.ts:78 checkpointDesktopDatabase(runtime.conn)`。<br>**两条 rebootstrap 生产路径复核成立**：`handlers/cloud-sync.ts:91`、`handlers/backup.ts:48-49`（`if (result === "imported") { await rebootstrapDesktopRuntime(); }`）。<br>**「挂上去会成环」的理由复核**：`cloud-sync.service.ts:435-437` 确为 `await import(...)` **动态** import。<br>**修法与 S-CS-01 合流一致性：成立**。S-CS-01 Step 3 要求 `recordPullSuccess` 内部 `await getDesktopRuntime()` 现取——这是必须的，因为 handler 在 rebootstrap **之前**捕获的 `service` 局部变量（`handlers/cloud-sync.ts:89`）仍是**旧代实例**；方案 A 的身份比较只保证「下一次取 service 会换代」，不救「旧实例上的方法调用」。两者互补不冲突，spec §4 依赖段的表述准确。<br>**验收可测：成立**。核心断言（`s1 !== s2` + 换代后 `getLocalStatus` 必 `ok:true`）具体、可复现。<br>**回归线存在：成立**。7 个测试文件全部实测存在（`cloud-sync-handlers` / `db-backup-busy` / `db-backup-export-dialog` / `db-maintenance-handlers` / `runtime` / `blob-binary-normalization-service` / `message-content-decompression-service`）。 | **MF-C1**（证据缺陷）：§4 写「grep 只命中定义处 `:446` 与 `cloud-sync-handlers.test.ts:5,6,25,29` —— **两个测试文件**」。实测还命中 **`apps/desktop/test/db-maintenance-handlers.test.ts:4,32,37`**。结论（生产零消费）不变，但引用要补全，否则读者会以为该文件不在影响面内。<br>**MF-C2**（可执行性二义）：方案 A 第 1 步新增的 `currentRuntime()` 访问器与第 3 步「若采纳第 2 步这一步可省」是 execute-ready 不该留的二义。方案 A 下 service 整体按代重建，**建议直接删掉第 3 步与 `currentRuntime()`**，只保留一句「service 内一律用 `this.runtime`；唯一跨代的是 `recordPullSuccess`，它现取」。 |
| **C2** | **D5 条件化**<br>§5 `handleCloudSyncPull` 无条件 rebootstrap | **PASS-with-fix** | **行号全对**：`cloud-sync.service.ts:259` `if (isCloudSyncError(error) && error.code === "ALREADY_UP_TO_DATE")`、`:261` `recordPull(true,"已是最新")`、`:262` `return { rev: meta?.lastSyncedRev ?? 0 }`（**是正常返回不是抛错**）；`handlers/cloud-sync.ts:89/90/91`；对照 `handlers/backup.ts:48/49` 已条件化。<br>**「条件」判据明确可判：是**，且**依赖已写清**：§5 修法标题即写「依赖 S-CS-01 Step 2 已经把 `databaseReplaced` 透传到 service」，§5 依赖段再写一次「S-CS-01（`databaseReplaced` 字段）」；并明确「判定口径必须是『库文件真的换了吗』，不是『pull 抛错了吗』」——这个区分是对的（后者会被 `ALREADY_UP_TO_DATE` 早返回污染）。<br>**「条件化不能替代 S-CS-02」的边界：守住**，三处重写（§0 第 3 条、§4 依赖段、§8.2 与 wave-d 的边界）。<br>**附带发现（死分支）复核成立**：`SettingsViews.tsx:318` 的 `else if (res.error.code === "ALREADY_UP_TO_DATE")` 在 desktop 上确不可达（service 已吞成正常返回，handler 只会回 `ok:true`）。spec 判「本条不动它」正确。<br>**mobile 侧已条件化复核成立**：`apps/mobile/src/services/cloud-sync.service.ts:352-359` 的 `ALREADY_UP_TO_DATE` 分支确实 `return` 在 `onRebootstrap()` 之前。 | **MF-C3**（真缺口，medium）：`databaseReplaced` **在 import 抛错时拿不到**——`db-backup.service.ts:124-126` 的 catch 是「回滚 + 重抛」，`service.pull()` 的 catch（`:265`）重抛后 handler 直接进 catch 分支，`if (result.databaseReplaced)` 永不求值 ⇒ **不 rebootstrap**。S-CS-07 落地后新增的「回滚也失败」分支（§1 修法第 6 步）恰好落在这个窗口：**库已换 + 连接已关 + 抛错**。§5 风险 R1 只写了「必须在 S-CS-01 的实现评审里逐行确认」——这不是可执行闭环，也没有对应验收用例。<br>→ 建议：§5 补一条硬规则 + 一条验收。硬规则二选一：(a) handler 的 catch 分支也按「库是否已换」判定 rebootstrap；(b) 让 `pull()` 用 out-param 或异常对象携带 `databaseReplaced`。<br>→ 附带把**已存在但没写下来的缓解**也写明：该窗口实际由 **S-CS-02 方案 A 自愈**——`closeLiveDbForBackupImport` 已 `clearDesktopRuntimeHandle()` 把 runtime 置空（`desktop-runtime-singleton.ts:45-48`），下一次 `getDesktopRuntime()` 懒建出**新对象** → 身份比较不等 → service 换代。不写这层，读者会把 R1 误判成未缓解的真洞。 |
| **C3** | **S-CS-03**<br>§6 pull 入口不查 `isAgentActive`、不参与互斥 | **PASS-with-fix** | **行号全对（11/11 命中）**：`cloud-sync-coordinator.ts:143` `async pull`、`:144` `assertConfigured()`、`:146` `readRemoteStatus()`、`:148` `remote.rev <= lastSyncedRev → throw ALREADY_UP_TO_DATE`、`:168` `importSnapshotFromPath!`、`:178` `importSnapshot(body)`、`:185` `async push`、`:189` `acquirePushLock()`、`:198-213` `acquirePushLock` 全文（**行号区间精确**）、`:219` 与 `:267` 两处 `isAgentActive()`；`cloud-sync-errors.ts:13` 的 `"AGENT_ACTIVE"` 确已定义且只被 push 用。<br>**「mobile 零 syncBusy」复核成立**：`git grep -n 'syncBusy' -- apps/mobile/src` **命中数 0**。<br>**「入口复检接入点」**：修法 2（两条 import 分支紧邻调用前各加一次）具体到行，**成立**；修法 3 的锁骨架 + `acquireSyncLock` 更名 + `operation` 参数化也具体。<br>**与 D5「顺手同做」的顺序：成立**。S-CS-03 只动 `cloud-sync-coordinator.ts`（core）+ mobile `cloud-sync.service.ts`，D5 只动 `handlers/cloud-sync.ts`，**零文件重叠**；且 S-CS-03 的守卫根本不需要 `databaseReplaced`，两条技术上完全独立。§8.1 提交表把 D5 排 4、S-CS-03 排 5，并写「与 D5 无耦合，可并行」，与 ledger §10 Wave B 的「D5 条件化时顺手把 S-CS-03 的入口复检一起做」不冲突。 | **MF-C5**（指令自相矛盾，medium）：**修法 1 与修法 4 互斥**。修法 1 写「在 `assertConfigured()` **之后立刻**」（= `:144` 之后、`:148` 之前），修法 4 写「本 spec 把入口复检放在 `ALREADY_UP_TO_DATE` 早返回**之后**（即 `:150` 之后）」。验收 4「`ALREADY_UP_TO_DATE` 时不抢锁也不查 agent」只与修法 4 自洽。⇒ **必须改**：修法 1 改写成「`ALREADY_UP_TO_DATE` / `SNAPSHOT_MISSING` 两个早返回之后、开始搬运快照之前」，并删掉修法 4 的「请 judge 裁定」段（那是对自己的修法二义的补偿，不该转嫁 judge）。<br>**MF-C6**（事实错误，medium）：风险 R1 写「desktop 侧天然安全（它已经有 `:238-241` 的 `syncBusy`）」——**实测不成立**。`syncBusy = false` 在 `pull()` 的 **`finally :268`** 复位，而 handler 的 `rebootstrapDesktopRuntime()` 在 `handlers/cloud-sync.ts:91`，**在那之后**。所以「库已换 + 连接已关 + runtime 未重建」这个窗口 **syncBusy 并未覆盖**；且 `push()` 入口只查 `syncBusy`、不查 `maintenanceBusy`（那是 S-CS-05）。desktop 真正安全的机制是 **S-CS-02 方案 A 的身份重建**（`clearDesktopRuntimeHandle` 已置空 → 下次懒建新对象）。⇒ 改写该句并把依赖写明。**注意：同段「mobile 必须补 `syncBusy`」这个必做子步骤本身是对的**，已实测 `apps/mobile/src` 零命中，不用动。 |
| **C4** | 跨条：**验收机制不可测**<br>（§2 / §3 / §5 / §6 共同） | **must-fix** | desktop 测试跑的是 `apps/desktop/package.json` → `"test": "node scripts/run-tests.mjs"` → 实跑 `npx tsx --tsconfig tsconfig.renderer.json --test`（**node:test，不是 vitest**）。而 `handleCloudSyncPull` 对 `rebootstrapDesktopRuntime` 是**静态 ESM import 绑定**（`handlers/cloud-sync.ts:13`）。ESM 命名空间对象只读，`vi.spyOn` 不存在、`node:test` 下也需 `mock.module()`（实验特性，需确认 Node 版本/flag）。 | **MF-C4**（medium）：§5 验收 1/2、§3 验收 2、§6（S-CS-16）验收 2 的「对 `rebootstrapDesktopRuntime` 打 spy」**按字面不可执行**。必须写明机制（node:test 的 `mock.module()`，并确认 Node 版本）或改用可观测断言（`getDesktopRuntime()` 返回对象身份变化 / bootstrap 副作用计数）。这是 S 阶段协议里「验收可测」硬要素，不能留给实现者临场发明。 |
| **C5** | 跨条：**回归线用例数错**<br>（§2 / §6） | **must-fix** | `packages/core/test/cloud-sync/coordinator.test.ts` 实测 **17** 条 `it(`（`CS-P1/P1b/P2/P3/P4/P5/P5b/P6` = 8、`forceOverwriteRemote 跳过 rev 检查` = 1、`T-SC10a~e` = 5、`PushAgentMutex 单元` = 3）。spec 两处写「**全 20 条**」，且枚举漏掉 `CS-P5b`（`:307`）与 `forceOverwriteRemote 跳过 rev 检查`（`:404`）。`lock.test.ts` 实测 4 条（spec 未给数，无冲突）。 | **MF-C7**（low）：20 → **17**，并把漏掉的两条用例名补进枚举。数字错不会让实现者跳过用例，但会让「逐条复跑 `T-SC10d`/`T-SC10c`」这条硬要求失去锚点。 |

### 1.1 组 C 的加分项（reviewer 确认成立、doc-fix 时**不要**动）

- §4「清位入口的生产消费方为零」——`git grep resetDesktopCloudSyncServiceForTest` 命中仅定义处 + 2 个测试文件，**生产零命中**，成立。
- §4 风险 R1「`syncBusy` 是模块级 `:55`、不在实例上，方案 A 换代不会分裂计数」——**实测 `let syncBusy = false;` 确在 `:55` 模块作用域**，成立，这条自查做得比很多 spec 都扎实。
- §5「mobile 侧本条无需改动」——实测 mobile `ALREADY_UP_TO_DATE` 分支已在 `onRebootstrap()` 之前 return，成立。
- §1（跨组）S-CS-01 引用的 mobile 行号 `:340/:341/:346` 逐字命中，mobile 记账确实在 `onRebootstrap()` **之前**，成立。
- RULE `:138`（「整库替换必须在 bootstrap 收口清进程内派生缓存」）与 §5 病症里的「白白重建整条 service graph + 重建进程内全部派生缓存」一致，**无 RULE 冲突**，D5 的性能代价描述有据。

### 1.2 组外但须转交 judge 的两条（本组越权，只报告不处置）

- **P1 覆盖缺口**：`SPEC.md:10` 声明范围是「全部 P1（40 条）」，但 `SPEC.md:19` 的分片分配表里 cloudsync 只领了 S-CS-01/02/03/07/16 + D5。ledger `§2.6` 的 **S-CS-04（P1，≡AM-2）、S-CS-08（P1，driver 多余拷贝）、S-CS-09（P1，rev 被 etag-only 重读覆盖）三条 P1 未被任何分片认领**（S-CS-04 出现在 ledger §10 的 Wave B 动作表里，但 SPEC.md 的分片表里没有对应格）。全 `fix-spec/` 目录 grep `S-CS-08|S-CS-09|S-CS-04` **零命中**。
- **D5 与 S-CS-03 的边界其实可以更紧**：ledger §10 说「D5 条件化时顺手把 S-CS-03 的入口复检一起做」，本 spec 拆成两个提交（§8.1 第 4/5 位）。技术上无冲突（不同层、不同文件），但 judge 若按「顺手同做」的字面验收，会看到两条提交分开落而误判。请 judge 明确「顺手」= 同一 PR 内一并实现，不要求同一提交。

---

## 2 · 债务池抽验（cloudsync 簇 P2×20 + P3×7 = 27 条，抽 14 条 = **51.9%**，远超 ≥10% 要求）

抽法：不按严重度挑，按**六个主题各取代表 + 三条与本包相邻的**（便于查重复立项）。全部在 `fe79b781` 代码现状上重新验证。

| # | 条目 | 级别 | 还在吗（代码现状） | 定级合理吗 | 被 v1.5.29 / 其它条目覆盖？ | 与本 spec 条目重复？ | 抽验结论 |
|---|---|---|---|---|---|---|---|
| 1 | **S-CS-05** 入口守卫只查 `syncBusy`、不查 `maintenanceBusy` | P2 | **在**。`cloud-sync.service.ts:238`（pull）与 `:281`（push）只判 `syncBusy`；`isDesktopDbMaintenanceBusy` 的唯一使用点是 `:233` 的 DTO 字段。mobile 侧 `:317-322` 只 acquire/release、无入口判定 | 合理（P2）。但它同时是 §5/S-CS-03「守卫稀薄」这条主判断的第三个证据，建议 judge 在 spec 里点名引用 | 否。ledger §9「已被 v1.5.29 消化」清单**无任何 cloudsync 条目** | 否 | **保留**。注意它被 synth 标为争议 D3（需确认 VACUUM 期间禁 push 是否刻意），**仍带 unresolved 争议**，不得当作纯技术债直接排期 |
| 2 | **S-CS-06** `export/importDatabaseBackup` 在弹框**之前**才查 agent | P2 | **在**，逐字命中：`db-backup.service.ts:180`（export，查 agent → `:187` 才 showSaveDialog）、`:211`（import，查 agent → `:216` 才 showOpenDialog） | 合理（P2）。用户可感但不丢数据 | 否 | 否 | **保留**。修法（弹框后复检）与本包无耦合 |
| 3 | **S-CS-10** 首次同步的 `ifNoneMatch:"*"` 从不使用 | P2 | **在**。driver **已支持**（`create-s3-object-storage.ts:78-83` 处理 `"*"`、`:207` 透传 `IfNoneMatch`）、port 声明了（`object-storage.port.ts:23,29`），但 **coordinator 全文零使用**（grep 只命中 driver/port/mobile 日志） | 合理（P2）。首次同步竞态，危害面窄 | 否 | 否 | **保留**。修法 M3.2 只动 coordinator，不碰本包文件 |
| 4 | **S-CS-11** `insertTableRows` 不校验跨行键集一致 | P2 | **在**。`provider-table-snapshot.ts:114-127`：`const columns = Object.keys(rows[0]!)` 直接拿首行键当列名，无跨行键集断言 | 合理（P2）。跨版本静默少数据 | 否 | 否 | **保留** |
| 5 | **S-CS-13** 脏快照已上传后才第二次复检 agent | P2 | **在**，行号精确：`coordinator.ts:256` `putFile` / `:260` `put`（**上传已完成**）→ `:267` 才 `isAgentActive()` | 合理（P2；本包 §7 已复核危害顺序成立）。⚠️ 定级值得复议为 P1——「脏快照进桶且 rev 已占位」与 S-CS-09 叠加后果不轻，但 v2 已按 P2 登记，不再上浮 | 否 | **易被误判为重复**：§6 修法 2 加的是 **pull 侧**导入前复检；S-CS-13 是 **push 侧**上传后复检前移。**两条不同侧、不同文件位置，不重复** | **保留**，并在台账里写死「S-CS-13 = push 侧，S-CS-03 = pull 侧」，否则 Wave C 阶段极易漏做 |
| 6 | **S-CS-14** 桌面 `FromPath`/`FromBytes` 双份实现 | P2 | **在**。`db-backup.service.ts:99-133` 与 `:141-174` 结构近逐字重复（同一组 `Promise.all`→`.catch`→`finally unlink` 骨架） | ⚠️ **定级与口径都有问题**。synth 自己写「这是 S-CS-07 的复发面，**不是独立的新问题**」，却仍单列为 P2 债务条目 ⇒ **债务池内部自相矛盾** | 否 | **部分重复**：本 spec §1 同时修两份路径的 `.catch`，覆盖了**症状**；但 synth M4.3「抽出 `replaceDbFileWithSnapshot(write)` 单一内核」这个**根因修法不在本 spec 内** | **建议改口径**：不要作为独立 P2 债务排期，改为「S-CS-07 的残留子项：抽单一内核消除双份实现」，随 §1 提交 1 或紧邻提交一并做。否则下一轮会出现「S-CS-07 已修 ⇒ S-CS-14 自然消失」的错误核销 |
| 7 | **S-CS-17** 快照只增不删、driver 无 DeleteObject/List | P2 | **在**。`git grep 'DeleteObject\|ListObjectsV2' -- packages/cloud-sync-driver-s3/src` **零命中**（desktop service 里的 `ListObjectsV2` 是 HeadBucket 降级探测，不在 driver 内） | 合理（P2）。= 拍板项 #10「条目按 P2 债务登记」的正式落点 | 否 | 否 | **保留**。已被拍板项 #10 收编，改动前须先问用户（★10） |
| 8 | **S-CS-18** `setConfig` 的 `Promise.all` 多键写入无事务 | P2 | **在**。`cloud-sync-config.store.ts:230` 起是 `Promise.all([kkv.set × 9…])`，**无回滚、无串行** | 合理（P2） | 否 | 否 | **保留** |
| 9 | **S-CS-19** `setConfig` 换 endpoint/bucket/prefix 不重置 `lastSyncedRev` | P2 | **在**（同一个 `setConfig` 函数 `:211` 起，只写 9 个配置键，不触碰 `lastSyncedRev`） | ⚠️ **与 S-CS-18 是同一函数、同一根因族**（synth M2.4/M2.6 也把两者写进同一条施工单） | 否 | **债务池内重复立项**：S-CS-18 与 S-CS-19 应合并为一条 | **建议合并**为「`setConfig` 非事务 + 不重置 rev」单条 P2，避免两轮各修一半 |
| 10 | **S-CS-22** `PushAgentMutex` 未从任一 index 导出 | P2 | **在**。`git grep 'PushAgentMutex' -- packages/core/src/infra/cloud-sync/index.ts packages/core/src/index.ts` **零命中** | 合理（P2）。且与 §6 #1 第二源复核**完全一致**，本 spec §7 已按台账口径归并 M-25、不重复出账 | 否 | **否，且已正确处理**：本 spec §7 明确「归并 M-25，不新增 P1，不单列条目」——与 ledger §4.2 / §6 #1 裁决一字不差 | **保留**（作为 M-25 的实现清单）。§7 顺带项「两处注释改事实态」零风险，可与提交 5 同做 |
| 11 | **S-CS-24** 临时文件 unlink 的 catch 一律吞 | P2 | **在**，行号精确：`cloud-sync.service.ts:269-274`（pull finally）与 `:305-310`（push finally），两处均 `unlink(...).catch(() => undefined)`，**不区分 ENOENT 与真实失败** | 合理（P2）。与 S-CS-20「失败的清理路径不清理」同源 | 否 | 否 | **保留**。注意它与 S-CS-07 的 `.catch` 治理**是同一种气味的两个面**，若 Wave B 想收口可考虑同 PR，但本 spec 未收，不算缺失 |
| 12 | **S-CS-28** mobile `hashSnapshotFile` 不关流（fd 泄漏） | P2 | **在**，全文复核：`snapshot-file-hash.ts:21-40` 的 Promise 只有 `onData/onError/onEnd`，**无 `finally { stream.close() }`** | 合理（P2）。每次 pull 至少漏一个 fd | 否 | 否 | **保留**。一行修法，可作独立零风险提交 |
| 13 | **S-CS-31** `snapshotBytes`/`uploadedAt`/`uploadedByDeviceId` 三字段无人消费 | P3 | **在**。`cloud-sync-status.ts` 的 `CloudSyncStatus` 三字段仍可选声明（spec 记 `:23-25`，实测类型块 `:19-29`，**轻微行号漂移**）；UI 侧无渲染点 | 合理（P3）。孤儿 schema 字段 | 否 | 否 | **保留**。P3，且与 §8.2「导出会扩大 core 公共面」无冲突 |
| 14 | **S-CS-33** `remote.snapshotKey!` 非空断言未闭合前置 | P3 | **在**，行号精确：`coordinator.ts:152-154` 的 `SNAPSHOT_MISSING` 守卫 + `:156` `const snapKey = remote.snapshotKey!;` | 合理（P3）。守卫确实闭合了 `rev > 0` 的情形，但 `rev === 0` 分支靠断言过桥——属可读性/健壮性债 | 否 | 否 | **保留**。⚠️ 但若采纳 §6 修法 3（pull 进互斥、改 pull 骨架），`:156` 附近代码会被搬动，**届时顺手改成显式分支**即可，不必单开条目 |

### 2.1 债务池抽验汇总

| 维度 | 结论 |
|---|---|
| **还在吗** | **14/14 全部仍在**，`fe79b781` 代码现状逐条实测确认，无一条已被 v1.5.29 消化 |
| **被 v1.5.29 覆盖** | **0 条**。ledger §9「已被 v1.5.29 消化」清单（RT-03 / CD-10 / CD-34 / CS-11 解压半边 / CS-14 数量口径 / searchMessages LIKE / RT-01 注记）**无任何 cloudsync 条目**，本簇债务池未被版本推进稀释 |
| **定级合理** | **12/14 合理**；2 条需改口径：**S-CS-14**（被自己定义为「S-CS-07 复发面」却仍独立立项，且根因修法不在本 spec 内）、**S-CS-18 + S-CS-19**（同函数同根因的两条，应合并） |
| **与 spec 条目重复立项** | **0 条真重复**。两处「易被误判」已排除：**S-CS-13**（push 侧）vs **S-CS-03**（pull 侧）不同侧；**S-CS-22** 已由本 spec §7 按台账口径归并 M-25，正确不重复出账 |
| **本包顺带可收但没收的** | S-CS-13（push 侧复检前移）、S-CS-28（一行 fd 修复）、S-CS-31（孤儿字段）三条**零风险且与本包零文件重叠**，可作 Wave B 的额外顺带项；本 spec 未收**不算缺失**，但 judge 若要最大化 Wave B 收益可考虑纳入 |

---

## 3 · 结论

### 组 C = **Go（doc-fix 后 execute）**

**一句话理由**：三条的**行号与病灶全部经本人核对成立、方案 A/B 取舍正确、依赖闭合、回归线真实存在**，唯一缺陷是 3 条「验收机制不可测 / 修法指令自相矛盾 / 事实判断有误」（MF-C4/5/6）加 4 条低级修补（MF-C1/2/3/7），全部可在 doc-fix 一轮内闭合，不触及病灶判断本身。

**doc-fix 必做清单（按优先级）**：

| 编号 | 落点 | 类型 | 一句话 |
|---|---|---|---|
| MF-C5 | §6 修法 1 + 修法 4 | 矛盾 | 入口复检位置统一为「`:150` 之后」（修法 4 的口径），删掉修法 4 的「请 judge 裁定」 |
| MF-C6 | §6 风险 R1 | 事实错误 | 「desktop 天然安全（syncBusy）」不成立（`syncBusy` 在 `:268` 复位、rebootstrap 在 handler `:91` 之后）；改写为「S-CS-02 方案 A 身份重建才是 desktop 的安全机制」，mobile 补 `syncBusy` 的必做子步骤保留 |
| MF-C4 | §5 验收 1/2、§3 验收 2、§6 验收 2 | 不可测 | desktop 是 `node:test`（`run-tests.mjs` → `tsx --test`）+ 静态 ESM import ⇒ 写明 `mock.module()` 或改可观测断言 |
| MF-C3 | §5 风险 R1 + 验收 | 缺口 | `databaseReplaced` 在 import 抛错时拿不到 ⇒ handler catch 分支不 rebootstrap；补处置规则 + 补一条验收，并写明该窗口实际由 S-CS-02 方案 A 自愈 |
| MF-C7 | §2 / §6 回归线 | 数字错 | `coordinator.test.ts` 20 → **17** 条，补 `CS-P5b`、`forceOverwriteRemote 跳过 rev 检查` |
| MF-C1 | §4 证据段 | 引用缺 | grep 命中补 `db-maintenance-handlers.test.ts:4,32,37`（结论不变） |
| MF-C2 | §4 方案 A 第 1/3 步 | 二义 | 方案 A 下删掉 `currentRuntime()` 与第 3 步的「可省」表述，只留 `recordPullSuccess` 现取 |

**转交 judge（不在本组处置权内）**：① SPEC.md §1 承诺「全部 P1」但 **S-CS-04 / S-CS-08 / S-CS-09 三条 P1 无分片认领**；② D5 与 S-CS-03「顺手同做」应明确为「同 PR 内一并实现」而非「同一提交」；③ 债务池 **S-CS-18 与 S-CS-19 合并**、**S-CS-14 改口径为 S-CS-07 残留子项**（否则下轮会被错误核销）。