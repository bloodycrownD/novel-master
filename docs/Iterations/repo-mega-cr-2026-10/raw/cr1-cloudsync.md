# CR Round 1 · 节点 cr-cloudsync（Wave B 云同步生命周期包）

## 元信息

- repo：`D:\Dev\nm-worktree\mcr`（feat/repo-mega-cr）
- base_sha：`fe79b781` ／ head_sha：`046f4d9c`
- 本 scope commit：`dc621d9a` — fix(cloud-sync): Wave B 云同步生命周期包（9 条：S-CS-07/01/16/02/03/D5 + S-CS-04/08/09）
- 业务 spec：`docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-b-cloudsync.md` + `wave-b-cloudsync-x1.md`
- CR fix-spec：`docs/Iterations/repo-mega-cr-2026-10/cr-fix-spec.md`（draft，首轮）
- 模式：scope（只读评审，未改任何代码 / spec，未做任何 git 写）
- 维度：A（spec 符合度）+ B（语义链与事务/令牌边界）+ C（并发窗口）+ C-orch（编排一致性）+ G（测试缝与测试有效性）

### 实证验证（本轮亲自跑，非引用）

| 命令 | 结果 |
|---|---|
| `packages/core` `npx tsc --noEmit` | **0 错误** |
| `apps/desktop` `npx tsc --noEmit` | **0 错误**（日志 0 字节） |
| `packages/core` `npm test` | 3296 tests / **3294 pass / 2 fail** ⇒ 红的是 `usage stats service (T-S5)` 下的 **T-C2 / T-C6** 两条**时区敏感**用例。已核对 `baseline.md` §F7 明确列为「真红，入已知红基线」，且 §环境表写明本机 UTC+8、当前日期 2026-10-01 ⇒ **与本 commit 无关，非新增红** |
| `apps/desktop` `npm test -- --test-concurrency=2` | **562 tests / 562 pass / 0 fail**（已带 `--test-concurrency=2` 规避 x1 §2 记录的「裸跑收集 0 条」假绿） |
| `apps/mobile` `npx jest cloud-sync.service / db-backup.service / db-maintenance-busy --maxWorkers=2` | **3 suites / 29 tests 全绿** |
| 新增用例收集性抽查 | 桌面 `回滚副本/DatabaseReplacedError/单例/换代/记账` 全部命中；core `S-CS-03/S-CS-09/AGENT_ACTIVE/NEED_PULL_FIRST` 全部命中 ⇒ **不是 0 收集假绿** |
| `npx knip --workspace apps/desktop` | `invalidateDesktopCloudSyncService` 落在 **Unused exports (127)** 名单里（见 C-orch-5） |

**结论：回归线整体可信，本包 9 条的实现质量明显高于台账描述的基线形态。以下问题按维度列出。**

---

## 1 · Must-fix（按 P0 → P1 → P2）

### P0

**无。** S-CS-01 的 P0 正身（pull 记账写已关连接 → `CONNECTION_CLOSED` + rev 永不推进）已被真实端到端测试钉死并转绿：`apps/desktop/test/cloud-sync-pull-accounting.test.ts:125` 断言首次 pull `ok:true`、`lastSyncedRev` 推进、**第二次 pull 命中 `ALREADY_UP_TO_DATE`**，`cloud-sync.service-lifecycle.test.ts:43-59` 断言单例换代。语义链两端（coordinator → service → handler）`DatabaseReplacedError` 均原样透传、未被吞类型。

### P1-1 ★ 桌面 `DatabaseReplacedError` 路径把唯一一份用户旧库副本删掉了（B + A）

**位置**：`apps/desktop/src/main/services/db-backup.service.ts:254-263`

```js
} finally {
  if (bakCreated && !rollbackFailed) {      // ← :255
    await fsOps.unlink(bakPath).catch(...)
  }
}
```

`replaceLiveDatabase` 实际有**三种**终态，而 `rollbackFailed` 只覆盖了两种：

| 终态 | `bakCreated` | `rollbackFailed` | finally 行为 | bak 里的东西还有用吗 |
|---|---|---|---|---|
| ① 覆盖成功 + 三表恢复成功 | true | false | 删 | 无用（dbPath 已是新库） |
| ② 覆盖动作失败 + 回滚成功 | true | false | 删 | 无用（dbPath 已被还原成 bak） |
| ③ **覆盖成功 + 三表恢复失败（`DatabaseReplacedError`）** | true | **false** | **删** | **有用——这是用户导入前的完整旧库** |

终态 ③ 在 `:229-235` 抛出 `DatabaseReplacedError`，此时 `rollbackFailed` 从未被置 true，`finally` 照常 `unlink(bakPath)`。而被删掉的正是「用户点拉取/导入之前的本机完整数据库」——含未同步的本地改动，以及**本轮恰好恢复失败的那三张服务商配置表**。用户拿到的是一句「服务商配置恢复失败」，没有任何提示说自己的旧库已被删除，也没有任何补救途径。

这正是 S-CS-07 立条时点名的那句「`finally` 还把唯一可能的回滚副本删掉 ⇒ 唯一退路被毁」，在 S-CS-01 新增的第三条路径上被原样复现了一次。

**为什么是 P1 不是 P0**：触发面窄（要覆盖成功且三表 restore 失败；`cloud-sync-pull-accounting.test.ts:214` 已证明这条路径可达——本机 `llm_provider` 有一条非法行即可）。但按 spec 自己的严重度标尺（`wave-b-cloudsync.md:40-41`：「本簇唯一不可逆本地数据丢失面」定 P1），本条同属不可逆本地数据丢失，故对齐 P1。

**两端不一致**：`apps/mobile/src/services/db-backup.service.ts` 的 `finally` **只放 `releaseMobileDbMaintenanceBusy()`，从不删 bak** ⇒ 同一语义下 mobile 能手工救回、desktop 不能。这正是 B 维度要的两端一致性缺口。

**建议修法**：`replaceLiveDatabase` 增加第三个终态标记（如 `keepBackupForManualRecovery`），在抛 `DatabaseReplacedError` 之前置位，`finally` 条件改为 `if (bakCreated && !rollbackFailed && !keepBackupForManualRecovery)`；并把 bak 路径写进 `DatabaseReplacedError` 的 message（x1 §1 风险 R2 已为回滚失败立过这个口径，终态 ③ 应同款）。

**测试缺口**：`db-backup-rollback-safety.test.ts:157`（`覆盖已成功但收尾失败时抛 DatabaseReplacedError 且不回滚`）只断言了 dbPath 内容没被回滚，**没有断言 `existsSync(bakPath)`** ⇒ 删与不删都绿。修法须在**这条用例**里补 `assert.equal(existsSync(bakPath), true)`（不能在别的用例里补——这是唯一会出现该终态的用例）。

---

### P1-2 ★ `retryAndWait`：被取代的旧 effect 会 reject 掉新一代的 waiter（C）

**位置**：`apps/mobile/src/runtime/novel-master-context.tsx:259-270` 与 `:277-285`

```js
if (cancelled) {                              // :259  ← 属于**已被取代**的那一代 effect
  ...
  rejectRebootWaiter(new Error('重建 runtime 已取消，请重试'));   // :268  ← 读的是全局 ref
  return;
}
...
})().catch(err => {
  if (!cancelled) {                           // :278  ← 状态 setter 有守卫
    setRuntime(undefined); ... setStatus('error');
  }
  rejectRebootWaiter(err);                     // :284  ← reject 却在守卫**之外**
});
```

`rebootWaiterRef` 是**单个全局槽**，没有「这一代 effect 拥有它」的归属判定。于是一条已被 cleanup 标记 `cancelled` 的**旧** effect，只要在 `if (cancelled)` 处收尾、或它的异步链抛错走到 `.catch`，就会把 `rebootWaiterRef.current` 里那个属于**更新一代 effect**的 waiter 给 reject 掉；而更新那代 effect 随后跑到 `:276 resolveRebootWaiter(runtime)` 时 ref 已被清空，`waiter?.resolve` 是 no-op —— **重建明明成功了，调用方却收到一个失败**。

`if (!cancelled)` 守卫被加在了四个状态 setter 上，唯独漏掉了紧挨着的 `rejectRebootWaiter(err)`，这是同一代码块内部的自相矛盾。

**下游后果**（`apps/mobile/src/services/cloud-sync.service.ts:393` 成功分支 `accountingRuntime = await onRebootstrap()`）：该 rejection 落进 `:410` 的 catch → `error instanceof DatabaseReplacedError` 为 false ⇒ 跳过 `:419` 的补建 ⇒ `:430` 用**仍指向旧死 runtime** 的 `accountingRuntime` 记账（被 `.catch` 吞掉）⇒ `:435 throw mapSdkError(error)`。净效果：**库已换代、runtime 已重建，却被报成「拉取失败」，`lastSyncedRev` 不推进**，用户下次再拉一遍同一 rev。

**文案二次误导**：`mapSdkError(new Error('重建 runtime 已取消，请重试'))` 在 `map-cloud-sync-sdk-error.ts:131-167` 落不到任何分支，最终被 `:167` 兜底成 `NETWORK / '云存储连接失败，请检查网络与配置'` ⇒ 用户被引导去查网络，而根因是本地生命周期竞态。x1 §1 风险 R2 已经为 `NOT_CONFIGURED` 修过同款误导（本次也确实修了，见 D9），这条同族问题未纳入。

**可达性诚实说明**：需要两次 boot 重叠。`syncBusy` 挡住了 pull↔push，但 `retry`（旧的无参版本，spec 明确要求保留）仍在 context 上暴露给其它消费方，`retryAndWait` 自身也没有「已有 waiter 排队」的保护（第二次调用会直接**覆盖**槽位，第一个 promise 彻底失主）。React StrictMode 的 effect 双调用会精确复现这个形状（mount → cleanup → re-run）。生产可达性不如测试环境频繁，故定 P1 而非 P0。

**建议修法**：给槽位加代号，如 `rebootWaiterRef.current = {generation: bootToken, resolve, reject}`，`resolve/reject` 时校验 `generation` 与当前 `bootToken` 一致才兑现；`retryAndWait` 入口在已有 waiter 时直接 reject/复用而不是覆盖。

**测试缺口**：`apps/mobile/__tests__/` 无任何针对 `NovelMasterProvider` / `retryAndWait` 的用例（本包新增的 4 条 pullCloudSync 用例全部用 `jest.fn(async () => freshRuntime)` 把 provider 换成了替身）。

---

### P2-1 `DesktopCloudSyncService.pull()` 的 catch 分支在换代路径上做一次注定失败的写（B）

`apps/desktop/src/main/services/cloud-sync.service.ts:293-295`：

```js
const detail = error instanceof Error ? error.message : String(error);
await this.configStore.recordPull(false, detail).catch(() => undefined);
throw error;
```

`DatabaseReplacedError` 到达这里时 `this.configStore` 背后的连接刚被 `closeLiveDbForBackupImport()` 关掉 ⇒ `recordPull` 必抛 `CONNECTION_CLOSED`，被 `.catch(() => undefined)` 吃掉 ⇒ **持久化的 `lastPullResult` 停在旧值**，面板上「上次拉取结果」与实际发生的「换代成功但三表未恢复」永久不一致。

形态上与 mobile 侧（G2 要求的 `.catch(() => undefined)`）对齐了，但语义没对齐：mobile 在 catch 里**换了 `accountingRuntime`**，desktop 这一支只是给一次坏写加了保险。建议在 `DatabaseReplacedError` 分支上直接跳过 `recordPull`（或延后到 handler 换代之后再写）。

### P2-2 面向用户的中文错误文案里混进了内部字段名（B）

`apps/desktop/src/main/ipc/handlers/cloud-sync.ts:111-117`：

```js
`${err.message}（服务商配置未恢复：providerTablesRestored=${String(err.providerTablesRestored)}）`
```

`providerTablesRestored` 是 TypeScript 字段名，直接拼进了给用户看的 toast。建议改为「（服务商配置未能恢复，请检查模型服务商设置）」。

### P2-3 mobile `ALREADY_UP_TO_DATE` 分支的记账缺 `.catch`（B，同函数内不对称）

`apps/mobile/src/services/cloud-sync.service.ts:412-415` 的 `patchCloudSyncLocalStatus(runtime, …)` 没有 `.catch(() => undefined)`，而同函数 `:430-433` 的 error 分支有。该分支虽不换代（runtime 是活的、抛错概率低），但一旦抛错会**从 catch 块内部再抛**，跳过 `progress?.fail` 与 `mapSdkError`，并把 `ALREADY_UP_TO_DATE` 的正常语义替换成一个裸错误。建议补齐对称。

### P2-4 `CloudSyncPullResult` 未扩字段，而新增测试直接读 `data.databaseReplaced`（A + G）

`apps/desktop/shared/ipc-types.ts:1726-1728` 仍是 `{ readonly rev: number }`（这一点符合 spec「不扩字段」的决策，handler 内部判定即可）。但 `cloud-sync-pull-accounting.test.ts:137 / 165 / 205` 三处都在读 `first.data.databaseReplaced`。

`apps/desktop/tsconfig.json` 的 `include` 只有 `["src/main/**/*", "shared/**/*"]`，**`test/` 完全不在类型门禁内**（该目录也没有 `tsconfig.test.json`，对比 `packages/core` 是有的）。运行时靠 handler 真的多带了字段而通过，但这条断言**没有任何类型兜底**：`CloudSyncPullResult` 哪天被人「修正」成只声明 `rev`，测试仍会绿。属类型门禁盲区，非功能缺陷。

### P2-5 S-CS-09 三条用例的 `simulateOtherDevice` 用 `void storage.put(...)` 不 await（G，脆弱）

`packages/core/test/cloud-sync/coordinator.test.ts` 的 `simulateOtherDevice` 写成 `void storage.put(statusKey(PREFIX), encodeStatus(status))`。

本轮已逐行核对 `createStorage.put`（`:77-92`）的 status 分支**内部没有任何 `await`**，所以 `currentStatus` / `statusWrites` / `currentEtag` 三个赋值在函数被调用的那一刻就同步完成 ⇒ 当前**没有竞态**，三条 S-CS-09 用例的时序推演（lockedStatus 写 etag-2 → 设备 B 无条件写 etag-3 → final If-Match 失败 → 重读得 rev 3 ≥ nextRev 3 → `NEED_PULL_FIRST`）完全成立，断言有牙。

但这个正确性依赖「put 体内永远不加 await」这一**未写下来的不变量**。将来往 `put` 里加任何一处 `await`，三条用例会静默退化成「设备 B 的写没赶上 → 守卫不触发 → push 成功」，而断言……仍会红（因为它断言的是 reject），但**红的原因变成别的问题**，排查成本极高。建议把 `simulateOtherDevice` 改成 `async` 并 `await`（钩子本身是 `async exportSnapshotToPath`，await 得起）。

---

## 2 · Spec deviations

| # | spec 出处 | 要求 | 实际 | 判定 |
|---|---|---|---|---|
| D1 | `wave-b-cloudsync.md` §8.1 表 + `wave-b-cloudsync-x1.md` §4.4 表 | 6~9 个**有序**提交；且明写 S-CS-08「零文件重叠 ⇒ 原则上**独立 PR**」、S-CS-09「**独立 PR（推荐案）**」、S-CS-04「插为第 6 位，排在提交 5 之后」 | **9 条全部压进单个 commit `dc621d9a`** | **偏离（最实质的一条）** |
| D2 | 同上 §8.1「1 → 2 → 3 是一条不可拆的链」「4 必须在 2 之后」 | 顺序约束 | 单提交内顺序不可考 | 随 D1 一并处置 |
| D3 | `wave-b-cloudsync.md` §2 Step 4 | 保留原 `retry: () => void` 不动 | 保留（`novel-master-context.tsx:169`） | 符合 |
| D4 | 同上 §2 Step 4 风险 R1 | `retryAndWait` 的 `cancelled` 分支必须 reject **+ 超时兜底** | `:268` reject、`:191-210` 60s 超时 | 符合（但见 P1-2 的归属缺口） |
| D5 | `wave-b-cloudsync.md` §1 修法 5 | `finally` 条件 `if (bakCreated && !rollbackFailed)` | `db-backup.service.ts:255` **字面一致** | 字面符合、**语义在终态 ③ 不成立** ⇒ 见 P1-1 |
| D6 | 同上 §1 修法 7bis | 模块内聚 `const fsOps = {copyFile, unlink, open}` + `__setDbBackupFsOpsForTest` | `:85-102` 一致 | 符合 |
| D7 | 同上 §2 Step 3 | `recordPullSuccess` 每次现取 runtime 现场造 store | `cloud-sync.service.ts:315-323`（动态 import 避静态环，注释写明理由） | 符合 |
| D8 | 同上 §4 方案 A 步骤 2 | 按 runtime 对象身份换代，不加 `currentRuntime()` | `isForRuntime()` + `getDesktopCloudSyncService():517-526` | 符合（`isForRuntime` 是判据不是同义访问器，不违 MF-C2） |
| D9 | 同上 §4 方案 A 步骤 4 | 另导出 `invalidateDesktopCloudSyncService()`，**不**挂到 `rebootstrapDesktopRuntime()` | `:536` 已导出、确实未挂 | 符合（但零消费 ⇒ C-orch-5） |
| D10 | 同上 §5 D5 验收 1 | 原写「对 `rebootstrapDesktopRuntime` 打 spy 断言 0 次」 | 改用 runtime 对象身份断言 | 符合且**优于 spec**——§3 修法已自行把该 spy 判为「按字面不可执行」（ESM 具名导入 + node:test 零 mock），§3 验收 1 明确要求改用身份断言。实现与 §3 一致、与 §5 原文不一致是 spec 自身残留，**不计偏离** |
| D11 | `wave-b-cloudsync-x1.md` §1 依赖栏硬约束 | mobile `syncBusy` 的检查与置位必须落在 `acquireMobileDbMaintenanceBusy()` **之前**或已建立的 `try` 内 | `cloud-sync.service.ts:344-347`（syncBusy）早于 `:354`（acquire） | 符合，且注释显式写明这条硬约束 |
| D12 | 同上 §1 修法 1 | `progress?.` / `exportTempPath != null` / `importTempPath != null` 三处提升与守卫 | `:367-375` 提升、`:439-448` 守卫 | 符合 |
| D13 | 同上 §1 风险 R2 二选一 | ① catch 原样透传 或 ② `mapCloudSyncSdkError` 加归一分支 | 选 ②，`map-cloud-sync-sdk-error.ts:109-114,147-149` | 符合；且刻意放在 auth/bucket/connection **之前**并写了理由，正确 |
| D14 | 同上 §2 修法 1/2/4 | `putFile` 透传引用（**不做视图化**）+ `readFile` JSDoc 写死「独立新分配」 | `create-s3-object-storage.ts` + `file-system.port.ts` | 符合（含「不做视图化」的理由注释） |
| D15 | 同上 §2 验收 1/2 | 哨兵 `===` 引用断言 + 保留 `deepEqual` | 两条都在（`s3-object-storage.test.ts`） | 符合，有牙 |
| D16 | 同上 §3 修法 1/2/3/4 | 重读重判定（租约 **且** rev）/ 续租 else 留痕 / 不扩错误码面 / JSDoc | `cloud-sync-coordinator.ts:369-396`、`:345-355`、`:277-278` | 全部符合 |
| D17 | 同上 §3 验收 3 | 「反向断言」不许省（防守卫写太死） | `远端租约已过期但 rev 未推进时仍成功提交 final status` 在 | 符合 |
| D18 | `wave-b-cloudsync.md` §6 修法 3 | `acquirePushLock` 更名 `acquireSyncLock`，**保留旧名作为 `@deprecated` 别名** | `:270-272` `protected acquirePushLock()` | 符合字面，但见 C-orch-4 |
| D19 | 同上 §6 修法 1/2 + 位置裁定 | 入口复检放在 `:150` 之后（早返回之后），两条 import 分支各一次 | `:182` 入口、`:198` / `:210` 二次 | 符合 |
| D20 | 同上 §7 顺带项 1 | 两处注释改「事实态」+ 标注 M-25 | `cloud-sync-coordinator.ts:50-53` + `push-agent-mutex.ts` 模块头 | 符合 |

**未发现的偏离**：S-CS-07 的三处吞错全部改成致命、16 字节路径级校验（`assertSqliteFileAtPath` 用 `open`+`read(buf,0,16,0)`，`db-backup.service.ts:125-134`）、`importDatabaseBackup` 改走路径级导入（`:379-384`）、两端 dbSync 适配器都 `return` 了备份函数返回值（`cloud-sync.service.ts:453-466` / mobile `cloud-sync.service.ts:223-239`）、`DbSyncPort` 放宽为 `| void` 且 JSDoc 写死「null 按 false 处理」——**spec 反复警告的「漏 return 零类型错误但运行时退化」这一类静默陷阱全部避开了**。

---

## 3 · Open questions / 待拍板

1. **P1-1 的取舍**：终态 ③ 保留 bak 会在用户磁盘上留一份「旧库 + 一份已换的新库」，需要用户自己判断删哪个。要不要像回滚失败那样在错误文案里给出明确路径？（x1 §1 风险 R2 已有同款口径，建议直接复用，无需新拍板。）
2. **P1-2 是否需要在 mobile 补 provider 层测试**：`retryAndWait` 是本包唯一的新增公共契约，目前零测试。若不做真 provider 测试（需要渲染 + fake timers），建议至少把「stale effect 不得 reject 新 waiter」这条归属规则抽成可单测的纯函数。
3. **D1 的补救方式**：单提交已落地。是否需要在下一轮用 `git revert` 重排为 spec 的 6~9 个提交？还是接受现状、只在 fix-spec 里把 §8.1 改成「一次性交付」并记一笔？（readonly 评审未做任何 git 写，此项交由用户/judge 决定。）

---

## 4 · 已豁免（用户确认不修）

（无。本轮未收到任何豁免指示。）

---

## 5 · 合并后 QA（manual_user）

1. **桌面 P1-1 需真机复现**：构造「覆盖成功 + 三表 restore 失败」（可参照 `cloud-sync-pull-accounting.test.ts:222-225` 往本机 `llm_provider` 插一条空 `display_name` 的行），确认桌面端 `${dbPath}.nmbackup.bak` 在报错后**是否还在**。本轮只做了代码路径推演，未在真机验证（desktop 无真机环境）。
2. **移动端 P1-2 需真机复现**：在「正在云同步拉取」时用别处触发一次 `retry`/重启，观察 toast 是否出现「云存储连接失败，请检查网络与配置」这种与网络无关的误导文案。
3. **移动端全量回归须降并发**：`cd apps/mobile && npm test -- --maxWorkers=2`（x1 §1 验收 6 已记：满负载下 mobile 全量偶发挂两个性能护栏用例，勿据此判回归）。本轮只跑了 3 个相关 suite（29 条全绿），**未跑 mobile 全量**。
4. **桌面回归须带 `--test-concurrency=2`**（裸 `npm test` 的单引号 glob 会收集到 0 条测试，看着全绿是假信号）。本轮已带参，`# tests 562` 确认非 0 收集。
5. **未跑 `apps/mobile` 的 tsc/typecheck**：mobile 侧类型门禁口径本轮未确认，§4 P2-4 的类型盲区结论仅对 desktop 成立。

---

## 6 · K 节建议（下游执行时闭合）

- **K1（→ Wave D 死码删除）**：`apps/desktop/src/main/services/cloud-sync.service.ts:536` `invalidateDesktopCloudSyncService` 零消费，knip 已列入 Unused exports。spec §4 步骤 4 是有意导出「供将来手动降级用」，但**注释里没有标注这一点会被 knip 记为未用导出** ⇒ 建议在注释里写明「当前无消费方，knip 报未用属预期」，避免下一轮 reviewer 误判为漏接。
- **K2（→ Wave D 死码删除）**：`packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:270` `acquirePushLock` 是本 commit 新引入的 `protected` + `@deprecated` 零引用方法（全仓 grep 只有定义处）。spec §6 修法 3 给的理由是「避免 core 内部测试以外的引用断裂」，但**同一条 spec 自己已确认生产侧无其它引用** ⇒ 保留旧名的收益为零、成本是一处永不调用的转发。建议下一轮直接删。
- **K3（→ Wave E 注释诚实化）**：`push-agent-mutex` 的类名与 `PushAgentMutex` 这个符号现在覆盖的是 sync↔sync，「agent」那一半仍是空的（注释已诚实化，但**符号名没改**）。改名会动 core 公共面，需并入 Wave E 的 X1 门禁收口一起评估。
- **K4（→ Wave E 门禁）**：`packages/core` 有 `tsconfig.test.json`（core 测试的类型门禁是有的），`apps/desktop` **没有**（`tsconfig.json` 的 include 只有 `src/main/**` + `shared/**`）。本包新增的桌面测试里有 3 处读 `data.databaseReplaced`（P2-4），这类「测试引用了类型上不存在的字段」的偏差在当前配置下**没有任何自动化闸门**。建议 Wave E 评估给 `apps/desktop` 补 `tsconfig.test.json` 并纳入 CI typecheck。
- **K5（→ Wave E 注释诚实化）**：`apps/desktop/src/main/services/cloud-sync.service.ts:414-415` 与 mobile `cloud-sync.service.ts:207-210` 的注释仍写「避免一次性读入大快照 / 避免整包进内存」，而 `getToPath` 实为整份下内存再写盘（x1 §2 修法 3 已确认本轮不改、移交 Wave E）。本包未新增此类注释，但这两处是同族靶子的现成入口。
- **K6（→ 台账回填）**：`cr-fix-spec.md` 的 Must-fix / Spec deviations 两节本轮已由本报告供给（D1~D20 + P1-1/P1-2/P2-1~5）。**「已豁免」为空、「待拍板」3 条**，需 judge 裁完 D1（提交重排）后才能定稿。
