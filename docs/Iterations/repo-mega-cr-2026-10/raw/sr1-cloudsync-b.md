---
zone: cloudsync / wave-b 分片 · 组 B（S-CS-01）
agent: sr1（readonly reviewer，单条目 P0 组）
files_scanned: 16（desktop 6 + mobile 5 + core 3 + spec/迭代文档 2）
基线: fe79b781（worktree D:\Dev\nm-worktree\mcr）
---

# sr1 · wave-b-cloudsync 组 B（S-CS-01）单审

审的是 `fix-spec/wave-b-cloudsync.md` 的 **§2（S-CS-01 全节）**，边界按 §0 与 §8 核。
所有结论都从 `fe79b781` 工作区代码重推，链条里任何一环的转述都不采信。

---

## 0 · 总结论（一行）

**No-Go**。行号与死句柄证据链逐跳全对，三步修法的骨架也站得住，但 Step 1 的「返回值」
形状与它自己在 D5 R1 里承认的「抛错后库已换」是自相矛盾的，Step 4 的 mobile 失败分支
在「import 已换代但 coordinator 抛错」时仍写死句柄、且 mobile 侧压根没有 S-CS-02 那种
身份自愈——这两处不补，实现出来会出现「库文件已换但 runtime 不重建」的新中间态。

---

## 1 · 逐项 verdict 表

| # | 检查项 | verdict | 依据 |
|---|---|---|---|
| 1 | 病症（desktop 死句柄链） | **confirmed** | 6 跳全部命中，见 §2 |
| 2 | 证据行号（desktop 侧） | **confirmed** | spec 声明的 9 处行号逐条对上，0 漂移 |
| 3 | 证据行号（mobile 侧） | **confirmed** | 4 处行号逐条对上 |
| 4 | 修法 Step 1（两端 import 返回换代信号） | **需修改** | 返回值形状与 D5 R1 自相矛盾（G1） |
| 5 | 修法 Step 2（core 端口与 coordinator 透传） | **confirmed** | 「void 兼容旧 mock」论断成立 |
| 6 | 修法 Step 3（desktop 记账移到重建后） | **部分成立** | 主干对，早返回分支缺字段（G3）；失败分支「保持记账不变」只对一半 |
| 7 | 修法 Step 4（mobile 对称改写） | **需修改** | 成功分支对称写全了，失败分支漏写（G2） |
| 8 | 与 S-CS-02 的合流点 | **一致** | §2 依赖 ↔ §4 依赖 ↔ §8.1 提交表 2→3 三处互指闭环 |
| 9 | 验收可测性 | **部分成立** | 断言具体；但验收 1 缺 S3 打桩 seam（G4） |
| 10 | 测试策略（文件存在性 + 用例名） | **confirmed** | 8 个文件全在，mobile 3 条用例名一字不差；条数需修正 |
| 11 | 回归线 | **部分成立** | coordinator.test.ts 是 17 条不是 20；私有字段耦合未标注 |
| 12 | 依赖闭合 | **部分成立** | 条目间闭合；`baseline.md` 未列入 §2 依赖（S1 仍在跑） |

**计数：confirmed 5 / 部分成立 4 / 需修改 3。**

---

## 2 · 死句柄证据链逐跳核对（desktop，全对）

| 跳 | spec 声明 | 实测 | 结论 |
|---|---|---|---|
| ① | `cloud-sync.service.ts:159-161` 构造期绑死 configStore | `:159 constructor(runtime)`、`:160 this.runtime = runtime`、`:161-164 createCloudSyncConfigStore(runtime.kkv, runtime.secretStore)` | ✅ |
| ② | `:252` pull → `:255/:256` 写 rev 与 recordPull | `:252-254 coordinator.pull({lastSyncedRev})`、`:255 setLastSyncedRev`、`:256 recordPull(true,…)`、`:257 return result` | ✅ |
| ③ | `:403-408` importSnapshotFromPath | `:403-408` 动态 import `importDatabaseBackupFromPath` 并 `await` | ✅ 行号精确 |
| ④ | `db-backup.service.ts:99` → `:32-35` closeLiveDbForBackupImport | `:99 importDatabaseBackupFromPath`、`:32-35`（`:33 clearDesktopRuntimeHandle()`、`:34 closeDesktopConnection()`）、调用点 `:115` | ✅ |
| ⑤ | `runtime/connection.ts:50-54` closeDesktopConnection | `:50` 函数、`:51 conn?.close()`、`:52 conn = undefined`、`:53 initPromise = undefined` | ✅ |
| ⑥ | `tdbc-driver-better-sqlite3/src/connection.ts:155` 抛 CONNECTION_CLOSED | `:153 private assertOpen()`、`:155 throw new TdbcError("CONNECTION_CLOSED", …)` | ✅ |

**补一跳 spec 没写、我自己加的**：KKV 写路径确实经由那条连接。
`packages/core/src/domain/kkv/repositories/impl/sqlite-kkv.repository.ts:31 constructor(private readonly conn: TdbcConnection)`，
写入走 `:58 / :68 executeTemplate(...)` ⇒ 最终落到 `conn.execute` ⇒ `assertOpen()`。
所以「写 rev 必抛」不是推测，是实打实的调用链。

**症状反推（不采信任何转述）**：
- desktop —— `:255` 抛 `CONNECTION_CLOSED` → 落 `:258 catch` → 非 ALREADY_UP_TO_DATE →
  `:264-265` `recordPull(false, "Connection is closed")`（**带 `.catch(()=>undefined)`，不会二次抛**）
  → `:266 rethrow`。handler `:93-94` 收成 `{ok:false}`。
  ⇒ 用户看到「拉取失败」，而库文件其实已经换掉了；`lastSyncedRev` 永不推进 ⇒ 下次仍拉同一 rev。
  **与 spec 病症描述逐字吻合。**
- mobile —— `:341 patchCloudSyncLocalStatus(runtime, …)` 在 `try` 内（try 起 `:338`）抛 →
  落 `:351 catch` → 非 ALREADY_UP_TO_DATE → `:360` **再拿同一个死 runtime patch**，
  又抛，且**没有 `.catch` 兜底** ⇒ 逃出函数，`progress.fail` 不执行，UI 进度条卡在运行态。
  `finally :366-370` 仍会 release 令牌，不构成令牌泄漏，但原始错误被连接错误覆盖。
  ⇒ 与 `synth/verify-cloudsync.md:138-149` 记的完全一致（我独立复核成立）。

---

## 3 · 死句柄证据链逐跳核对（mobile，同构成立）

| 跳 | spec 声明 | 实测 | 结论 |
|---|---|---|---|
| ① | `cloud-sync.service.ts:340-346` | `:340 coordinator.pull`、`:341-345 patchCloudSyncLocalStatus(runtime,…)`、`:346 onRebootstrap()` | ✅ |
| ② | `CloudSyncProgressScreen.tsx:107` 传 `runtime, retry` | `:107 await pullCloudSync(runtime, retry, {` | ✅ |
| ③ | `:36` 取 `retry` | `:36 const {retry} = useNovelMaster();` | ✅ |
| ④ | `db-backup.service.ts:150` 已 `closeMobileConnection()` | `:150 await closeMobileConnection();` | ✅ |

顺带把 §1（S-CS-07）引的 mobile 对照组也核了，一字不差：
`apps/mobile/src/services/db-backup.service.ts:144-147` 是 `dbExists` 判断 + **裸** `await fs.cp(dbPath, bakPath)`（无 catch），
`:159-165` 回滚前先 `fs.exists(bakPath)` 再 cp（cp 带了 `.catch`），`:166-168` 的 finally **只 release 不 unlink** ⇒ 确实「从不删 bak」。
（`synth/verify-cloudsync.md:124` 提醒「移动端完全没有吞」这句不准确，因为 `:162` 的回滚 cp 带了 catch —— spec §1 没有重复这个错，✅。）

---

## 4 · 三步修法的完备性缺口

### G1 ·（must）Step 1 的返回值形状与 D5 R1 自相矛盾

Step 1 写的是「`importDatabaseBackupFrom*` 返回 `Promise<DbImportOutcome>`」，紧接着又写
「三表 restore 抛错但数据库已换 ⇒ `databaseReplaced: true, providerTablesRestored: false`，
**不能再走 S-CS-07 第 6 步的回滚**」。这两句不能同时成立：**函数抛错时返回值送不到调用方**。

而 D5 的 R1（§5）自己就把这个洞写出来了：「若 `importDatabaseBackupFrom*` 在『数据库已替换
但后续步骤抛错』时**没有**返回 `databaseReplaced: true`（例如抛错发生在函数返回之前），
handler 会跳过 rebootstrap ⇒ **库文件已换但 runtime 不重建 ⇒ 比现在更糟**」，随后只给了
一句「必须在 S-CS-01 的实现评审里逐行确认这一点」——**没有给出机制**。「在 finally 之前确定
`databaseReplaced`」对抛错路径无效（finally 不携带返回值）。

这不是理论风险：desktop 的 `closeLiveDbForBackupImport()`（`:115`）跑在
`restoreProviderTableSnapshot`（`:120`）**之前**，所以「三表恢复失败」这一常见错误发生时
连接已经关了、库已经换了，而 handler 走 `:93 catch` → **不 rebootstrap**。

**建议的闭合方式（任选其一，写进 §2 Step 1）**：
1. **显式异常携带信号**：`class DatabaseReplacedError extends Error { readonly databaseReplaced = true }`，
   覆盖成功但后续步骤失败时抛它；handler 的 catch 里 `if (err instanceof DatabaseReplacedError) await rebootstrapDesktopRuntime()`。
2. **outcome-first 返回**：import 函数**永不因「已换代后的收尾失败」而抛**，而是
   `return { databaseReplaced: true, providerTablesRestored: false }` + 由调用方决定怎么提示
   （语义更干净，但要改 S-CS-07 第 6 步的错误传播形态）。

### G2 ·（must）mobile 失败分支仍写死句柄，且 mobile 没有 desktop 那样的自愈

Step 4 用 `let accountingRuntime = runtime` 跟踪，但**只在成功分支**里被换成 `fresh`。
「import 已换代、coordinator 之后抛错」这条路径上 `accountingRuntime` 仍是旧 runtime ⇒ `:360` 照旧死写。

更根本的一层：**mobile 的 catch 分支从头到尾不调用 `onRebootstrap`**，
而 `apps/mobile/src/db/connection.ts` 的 `closeMobileConnection()` 已经把模块级 `conn` 关掉了。
mobile 的 runtime 是 React state（`novel-master-context.tsx:202 setRuntime(runtime)`），
没有 desktop 那种「`getDesktopRuntime()` 下次懒建新 runtime」的自愈机制
（`desktop-runtime-singleton.ts:45-48 clearDesktopRuntimeHandle` 把 `runtime=undefined`，下次自动重建）。

⇒ **desktop 侧这个洞由 S-CS-02 方案 A 的身份比较顺带治好；mobile 侧全包没有任何对应修法。**
症状：一次失败 pull 之后，整个 App 带着一条已关的 runtime 跑（Profile、聊天、设置全报错），
直到用户手动重启。§4 的 S-CS-02 标题明写「**桌面**云同步 service 单例」，覆盖不到这里。

另外 Step 4 只说「把 catch 分支的 runtime 换成 `fresh`」，**没提给
`patchCloudSyncLocalStatus` 补 `.catch(() => undefined)`** —— `synth/verify-cloudsync.md:149`
点名要「修 S-CS-01 时顺带把这一行对齐 desktop 的 `.catch`」，spec 引用了那段却没落进修法。

**建议**：Step 4 补两条 —— ① catch 分支的记账加 `.catch(() => undefined)`（对齐 desktop `:265`）；
② 明确「pull 抛错且库已换代 ⇒ 也走一次 rebootstrap」，即把 mobile 的失败路径按
`databaseReplaced` 条件化，而不是只在成功分支里换代。

### G3 ·（should）`ALREADY_UP_TO_DATE` 早返回缺 `databaseReplaced: false`

Step 3 把 `pull()` 返回类型改成 `Promise<{rev; databaseReplaced}>`，但 `:262` 的
`return { rev: meta?.lastSyncedRev ?? 0 }` 必须显式补 `databaseReplaced: false` 才过 `tsc`。
spec 只说「ALREADY_UP_TO_DATE 早返回分支保持记账不变」，没提这个字段。TS 会拦，但
spec 应写全（desktop 会拦，mobile 的 `CloudSyncPullOutcome` 不含该字段，不需要动）。

### G4 ·（should）验收 1 缺 S3 打桩 seam，端到端断言今天做不出来

验收 1 写「往远端放一份 rev=2 的快照，调用 `handleCloudSyncPull()`」。实测：
`cloud-sync.service.ts:19-26` 把 `createS3ObjectStorage` 与 `@aws-sdk/client-s3` **静态 import**，
`buildCoordinator`（`:411-426`）内部自造 storage，**没有任何注入点**；
`apps/desktop/test/` 下 13 个测试文件里 **`@aws-sdk` / `S3Client` 零命中**，desktop 也没有 mock 框架依赖
（`package.json` 的 test 只有 `node scripts/run-tests.mjs`）。
⇒ 该验收项要么在 spec 里补一条「给 `buildCoordinator` 加可选 storage 注入（仅测试用）」的 seam 步骤，
要么降级为两层断言：① `dbSync` 端口打桩 + 真实 better-sqlite3 连接（钉住记账点位置）；
② 真 S3 往返留待后续。

---

## 5 · 三个具体论断的亲自裁定

### 「`void` 兼容既有 mock」——成立

`db-sync.port.ts:13/:15` 现为 `Promise<void>`，改成 `Promise<{databaseReplaced:boolean} | void>` 后，
`async () => {}` 推断出的 `Promise<void>` 可赋值给含 `void` 的联合类型；desktop `buildCoordinator:397-402`
的 `importSnapshot`（尾行是 `await importDatabaseBackupFromBytes(bytes)`，返回 `Promise<void>`）同样可赋值。
spec 风险 R3「`databaseReplaced == null` 一律按 false」的口径也对，且 coordinator 侧只需
`out?.databaseReplaced === true` 一处收敛。**这条不用改。**

### 「失败分支保持记账不变（此时连接仍活着）」——**只对一半**

- **ALREADY_UP_TO_DATE 分支：论断正确。** 亲自追了 `cloud-sync-coordinator.ts:143-181`：
  `:148-150` 的早返回在 `:158/:168/:178` 两个 import 分支**之前**，
  所以 `service.pull()` 落 `:259-263` 时 `closeLiveDbForBackupImport()` 从未跑过，连接确实活着。
- **失败分支：论断不成立。** `:264-265` 只有在「import 之前失败」时才安全；
  一旦错误发生在 `:115 closeLiveDbForBackupImport()` 之后（provider 三表恢复失败、
  以及 S-CS-07 修完后新增的备份步失败），`recordPull(false, …)` 写进的是死句柄。
  桌面靠 `.catch(()=>undefined)` 吞掉、错误不外泄，但**记账丢失 + 库已换而 handler 不 rebootstrap**（=G1）。
  ⇒ Step 3 注释里的「此时连接仍是活的」需要收窄成「import 之前的失败才成立」。

### mobile 侧改法是否对称写全 —— **成功分支全，失败分支漏**

Step 4 的 `if (result.databaseReplaced) { fresh = await onRebootstrap(); … } else { …旧 runtime… }`
与 desktop Step 3 严格对称（连 `else` 分支都给了），这部分写得好。
漏的是 catch 分支的两件事（G2 ①②）。另外 `releasePullBusy()` 在 Step 4 的示例片段里没出现，
实际代码里它在 `:348`（成功分支显式调）+ `:366-367`（finally 兜底），
Step 4 改写后必须保证它仍落在 `await onRebootstrap()` **之后** —— spec 没写这一句，
而 §3（S-CS-16）明确说「令牌边界是刻意设计、错的只有记账点，不要动令牌边界」，两节口径没冲突但 Step 4 漏了这句护栏。

---

## 6 · 与 S-CS-02（§4）的合流点一致性 —— 一致

| 落点 | 表述 | 一致性 |
|---|---|---|
| §2 依赖 | 「S-CS-02 必须在同一 PR 内落（desktop 的 `recordPullSuccess` 依赖『每次现取 runtime』的改造）」 | ✅ |
| §4 依赖 | 「**S-CS-01**（desktop 的 `recordPullSuccess` 依赖『现取 runtime』；顺序上 S-CS-01 的 Step 3 与本条的方案 A 第 2 步是同一处改动）」 | ✅ 双向互指 |
| §8.1 提交表 | 提交 2 = S-CS-01+16，提交 3 = S-CS-02，「共用同一处改动，拆开产生不可编译的中间态」 | ✅ |
| §0 打包约束 | 「只修 S-CS-01 不修 S-CS-02 ⇒ 记账能写成功但下一次 `getConfig` 仍绑死连接」 | ✅ 逻辑成立 |

补充确认：§4 方案 A 第 1 步的「`runtimeIdentity: object` 身份比较」在代码上成立 ——
`desktop-runtime-singleton.ts:18-21` 每次重建都 `.then(rt => { runtime = rt; })` 产生**新对象**，
身份比较天然成立，`:49` 的「方案 A 第 3 步可省」也对（按代重建后 `this.configStore` 恒为当代）。
**但 §4 第 3 步若真实施，会打断一条回归线**（见 §7）。

---

## 7 · 验收与测试策略的可测性核对

**引用的测试文件，全部真实存在**（逐个列目录核过）：

| 文件 | 存在 | spec 声明的条数 | 实测 |
|---|---|---|---|
| `packages/core/test/cloud-sync/coordinator.test.ts` | ✅ | 「全 20 条」 | **17 条**（`it(` = 17，`describe` = 4；3+5+3+6 正好 17）—— **spec 数字错** |
| `packages/core/test/cloud-sync/lock.test.ts` | ✅ | 「全部」 | 未逐条核，不影响 |
| `apps/desktop/test/cloud-sync-handlers.test.ts` | ✅ | 3 条 | ✅ 3 条，用例名一字不差 |
| `apps/desktop/test/db-backup-busy.test.ts` | ✅ | 3 条 | ✅ 3 条，第三条正是 `:101-127` 那条时序用例 |
| `apps/desktop/test/desktop-db-test-env.ts` | ✅ | 「起一个真库」 | ✅ 真实 better-sqlite3（只设 `NOVEL_MASTER_DB` + passthrough），但**不解决 S3**（G4） |
| `apps/mobile/__tests__/cloud-sync.service.test.ts` | ✅ | 3 条 pull 用例 | ✅ 3 条，用例名一字不差（含「拉取成功时更新 lastSyncedRev 并触发 rebootstrap」） |
| `apps/mobile/__tests__/db-backup.service.test.ts` | ✅ | 「含 ic-20: 上层 importDatabaseBackup 外层计数兜底」 | ✅ 14 条，`:307` 正是该条 |
| `apps/mobile/__tests__/cloud-sync-config.service.integration.test.ts` | ✅ | — | ✅ 存在 |

**另外两处回归线事实错**（都在 §4，不在 §2，但同包同 PR，要一起修）：

1. §4 写「`resetDesktopCloudSyncServiceForTest` 只命中定义处 `:446` 与
   `cloud-sync-handlers.test.ts:5,6,25,29` —— **两个测试文件**」。
   实测（排除 node_modules/dist）：定义处 `:446` 正确，但
   `cloud-sync-handlers.test.ts` 命中是 **`:6, :25, :29`（不是 4 处）**，
   且**漏了 `apps/desktop/test/db-maintenance-handlers.test.ts:4, :32, :37`** ⇒ **实际是三个测试文件**。
   影响可控（该文件已在 §4 回归线里），但「全仓 grep」这句是本包的证据门面，数字错要改。

2. **`cloud-sync-handlers.test.ts:95-99` 直接摸私有字段**：
   ```ts
   const configStore = (service as unknown as { configStore: CloudSyncConfigStore }).configStore;
   configStore.getLocalMeta = async () => { throw new Error("meta 读失败（注入）"); };
   ```
   §4 方案 A 第 3 步说「把所有 `this.configStore` 的直接使用改为经由私有 `store()` getter 现取」——
   **一旦实施，这条测试必然红**。§4 回归线只写了「全 3 条（+新增 1 条）」，没标注这处耦合。
   修法二选一：§4 明确「第 3 步若实施，必须同步把该测试改成 stub `getDesktopRuntime` 或保留实例字段」，
   或直接删掉第 3 步（§4 自己说了它「可省」）。

**baseline.md**：`registry.md:219` 显示 `s-baseline` 状态 **running**，产物 `fix-spec/baseline.md` 尚未落盘
（我在 `docs/` 全树确认 `baseline*` 零命中）。§2 验收 4 写「对照 `baseline.md` 已知红清单」，
§8.2 也泛提了一句，但 **§2 的依赖节没把 baseline 列为依赖**。建议在 §2 依赖里补一行
「S1 `baseline.md`（s-baseline，进行中）：验收判增量需它先落盘」。

---

## 8 · verdict 汇总与给 doc-fix 的 must-fix 清单

**No-Go。** 必须先补两条：

- **G1**（Step 1）：把「已换代但收尾失败」的信号从返回值改成**可抛出的显式形态**
  （`DatabaseReplacedError` 或 outcome-first 返回），否则 D5 R1 只会兑现成「比现在更糟」。
  §5 D5 的 R1 那句「实现评审时逐行确认」要升级成设计约束。
- **G2**（Step 4）：mobile 侧补齐 ① catch 分支记账加 `.catch(() => undefined)`；
  ② 「pull 抛错且库已换代」也要走一次 rebootstrap（mobile 没有 S-CS-02 的身份自愈）。
  同时 Step 4 补一句「`releasePullBusy()` 必须仍在 `await onRebootstrap()` 之后」。

**建议同批修（低成本）**：

- **G3**：Step 3 的 ALREADY_UP_TO_DATE 早返回显式补 `databaseReplaced: false`；
  Step 3 那句「此时连接仍是活的」收窄为「import 之前的失败才成立」。
- **G4**：验收 1 要么补 S3 seam 步骤，要么降级为「dbSync 打桩 + 真实驱动」两层断言。
- **回归线数字**：`coordinator.test.ts` 20 → **17**。
- **§4 grep 事实**：`resetDesktopCloudSyncServiceForTest` 是**三个**测试文件
  （补 `db-maintenance-handlers.test.ts:4,32,37`；`cloud-sync-handlers.test.ts` 是 `:6,25,29`）。
- **§4 第 3 步耦合**：标注会打断 `cloud-sync-handlers.test.ts` 的私有字段注入。
- **§2 依赖**：补 baseline.md（S1，进行中）。

**已确认无需改动的部分**：死句柄 6 跳证据链、mobile 同构 4 跳、`void` 兼容旧 mock 的论断、
与 S-CS-02 的四处合流点表述、mobile 三条既有用例名、desktop 三条既有用例名、
`db-backup-busy.test.ts` 的令牌时序用例、方案 A 的 runtime 身份比较机制、
ALREADY_UP_TO_DATE 分支「不换代所以记账走旧 runtime」的正确性。