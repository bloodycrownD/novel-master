---
zone: cloudsync
agent: reviewer-A（S-CS-07 + S-CS-16 + §6 #1 注记）
files_scanned:
  - docs/Iterations/repo-mega-cr-2026-10/PLAN.md
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/SPEC.md
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/state.md
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-b-cloudsync.md（§0/§1/§2/§3/§7/§8）
  - apps/desktop/src/main/services/db-backup.service.ts（238 行，全文读）
  - apps/mobile/src/services/db-backup.service.ts（253 行，全文读）
  - apps/desktop/src/main/services/cloud-sync.service.ts（237-276 / 370-455）
  - apps/mobile/src/services/cloud-sync.service.ts（212-238 / 300-371）
  - apps/desktop/src/main/ipc/handlers/cloud-sync.ts（113 行，全文读）
  - apps/desktop/src/main/ipc/handlers/backup.ts（33-57）
  - apps/desktop/src/main/runtime/connection.ts（30-61）
  - apps/desktop/src/main/runtime/desktop-runtime-singleton.ts（全文 55 行）
  - packages/core/src/infra/cloud-sync/ports/db-sync.port.ts（全文 17 行）
  - packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts（40-119 / 240-319）
  - packages/core/src/infra/cloud-sync/logic/push-agent-mutex.ts（全文 135 行）
  - packages/core/src/infra/cloud-sync/index.ts（全文 45 行）
  - packages/tdbc-driver-better-sqlite3/src/connection.ts（143-166）
  - apps/mobile/src/runtime/novel-master-context.tsx（140-219）
  - apps/mobile/src/screens/stack/CloudSyncProgressScreen.tsx（22-140）
  - apps/desktop/shared/ipc-types.ts（1728-1741）
  - apps/desktop/test/db-backup-busy.test.ts（128 行，全文读）
  - apps/desktop/test/cloud-sync-handlers.test.ts（112 行，全文读）
  - packages/core/test/cloud-sync/coordinator.test.ts（用例清单实测）
  - apps/mobile/__tests__/cloud-sync.service.test.ts（用例清单实测）
  - docs/apm/RULE.md:85（验收断言牙齿三判据）/ :138（派生缓存与库同寿命）
baseline: fe79b781（worktree D:\Dev\nm-worktree\mcr，全程只读，无 git 写）
---

# sr1 · wave-b-cloudsync · 组 A 审查报告（S-CS-07 / S-CS-16 / §6 #1 注记）

## 摘要

组 A 三块地：S-CS-07（desktop 备份导入三处吞错 + 整包读入）、S-CS-16（记账点在
rebootstrap 之前，作为 S-CS-01 子项）、§7 的 PushAgentMutex 未接线第二源复核注记。
结论先摆：**行号纪律非常好**——spec 里绝大多数 file:line 我逐条打回 `fe79b781` 复核，
**全部在位**，包括台账漂移过的 `:255` / `:91` / `:346` 这几处；病也从代码重推导过一遍，
站得住。真正的问题不在「写得对不对」，而在**修法只改了一半**和**验收断言没有牙**——
这两条按 spec-check-loop 的判据都得 must-fix，所以本组 **No-Go（可一轮 doc-fix 闭合）**。

---

## 1 · 逐条 verdict 表

verdict 取值：`valid` / `spec-defect` / `code-drift` / `验收不可测` / `修法打架`

### 1.1 S-CS-07（§1）

| # | 条目 | verdict | 证据 | 修改建议 |
|---|---|---|---|---|
| A1 | §0 打包约束 / §8.1 提交顺序 | valid | 顺序链「1→2→3 不可拆、4 在 2 之后」与 §2 依赖字段自洽；`SPEC.md` §3 全局依赖图把 `S-CS-07(B-cs) → 可独立先落` 单列，与 §0「唯一可独立先落的是 S-CS-07」一致 | 无 |
| A2 | S-CS-07 §1 病症：吞错链 → 磁盘库已是导入快照 | valid | 重推导成立：`:114` 备份吞 → `:115` 关连接 → `:116` 覆盖唯一真身 → `:120` 还原三表 → `:125` 回滚吞 → `:128` `finally` 删唯一副本。整条链无中断点，最终 `throw` 原始错误而库文件已换 | 无 |
| A3 | S-CS-07 §1 证据：desktop 六处 `.catch` file:line | valid | 逐行核对全中：`FromPath` 的 `:114`(备份) / `:125`(回滚) / `:128`(删 bak)，`FromBytes` 的 `:155` / `:167` / `:169-170`；`:104` 整包 `readFile(srcPath,{encoding:null})` 亦在位 | 表述建议：「三处 `.catch` 各出现两次……共六处」易被读成「3 处」。直接写「6 处（3 类 × 2 条路径）」 |
| A4 | S-CS-07 §1 证据：mobile 对照组「**没有吞**」 | spec-defect | **失准**。`apps/mobile/src/services/db-backup.service.ts:162` 是 `await fs.cp(bakPath, dbPath).catch(() => undefined);` —— mobile 的**回滚步同样被吞**。mobile 之所以不致命，是因为它 `:159-165` 的 catch 里先 `fs.exists(bakPath)` 且**从不删 bak**，副本永远留在盘上 | 把对照组改成事实描述：「mobile 的备份步（`:146`）是裸 await，回滚步（`:162`）同样 `.catch` 吞，但 mobile **从不删 bak** ⇒ 回滚失败时副本仍在盘上；desktop 三步全吞且 `finally` 删副本 ⇒ 唯一退路被毁」。这条要顺带回答「mobile 的 `:162` 要不要一起改」——建议在 S-CS-07 修法里加一句：mobile `:162` 的吞保留亦可，但**必须与 desktop 一样把错误并入抛出信息**（现在 mobile 回滚失败也是静默的） |
| A5 | S-CS-07 修法 step 1-3（`assertSqliteFileAtPath` 取代整包读入） | valid | `:6` 已 `import { copyFile, readFile, unlink, writeFile } from "node:fs/promises"`，加 `open` 成本为零；`:44-52` 的 `assertSqliteFile(bytes)` 可直接复用魔数判定 | 无 |
| A6 | S-CS-07 修法 step 5（`finally` 删 bak 的条件） | spec-defect | **同一 step 内散文与代码片段自相矛盾**。代码写 `if (bakCreated && !rollbackFailed) { await unlink(bakPath) }`，散文写「**回滚用过就必须留着**，只有『备份成功且从未用作回滚源』才删」。按代码，回滚**成功**（`rollbackFailed === false`）时 bak 仍被删。代码其实是对的（回滚成功 ⇒ db 已还原成 bak 的内容，bak 冗余），错的是散文 | 二选一改齐。**推荐改散文**：「回滚**失败**才必须留 bak（用户要手工救回，且此时库文件内容不可信）；回滚成功时 dbPath 已被还原成 bak 的内容，bak 冗余可删」。并把变量名从 `rollbackFailed` 显式写成 `let rollbackFailed = false` 在 try 外声明（现 spec 的 catch 块示例里 `rollbackError` 声明在 catch 内，`finally` 读不到，作用域没交代） |
| A7 | S-CS-07 修法 step 6（catch 块回滚 + 回滚失败并入错误） | 修法打架 | 与 **§2 S-CS-01 Step 1** 正面冲突。S-CS-07 step 6 的 catch 对**一切**错误（含 `:120` 还原三表失败）执行 `copyFile(bakPath, dbPath)` 回滚；S-CS-01 Step 1 却写「三表 restore 抛错但数据库已换 ⇒ **不能再走 S-CS-07 修法第 6 步的「回滚」**」。两者对**同一条代码路径**给出相反指令 | 必须在 §2 Step 1 或本 step 6 里把覆盖关系写死，建议在 S-CS-07 step 6 末尾加一句：「本 step 6 的回滚**只覆盖到 `:116` 覆盖动作本身失败**这一段；三表 restore 失败（覆盖已成功）的处置由 S-CS-01 Step 1 接管——库已是新的，不回滚，改为返回 `providerTablesRestored: false`」。否则提交 2 的实现者会同时保留回滚**又**返回 `databaseReplaced: true`，产生「db 已被回滚成旧库、handler 却按 `true` 重建」的语义错乱 |
| A8 | S-CS-07 修法覆盖完整性（整包读入病灶） | spec-defect | **修法只修了一半**。§1 病症写「校验步为了确认 16 字节 SQLite 魔数，把整份快照读进 Node 堆」，mobile 模块头（`db-backup.service.ts:4`）也写着「大备份禁止整包读入 JS / base64 往返，导入统一走路径级 cp」。但 desktop 的 UI 导入入口 `:234` 是 `const bytes = await readFile(pickedPath);` —— **无 encoding 参数 ⇒ 整包进 Node 堆**，随后 `:235` 才交给 `FromBytes`。修法 step 2 只点名 `:104-105`，`:234` 原样保留 ⇒ 用户从「导入备份」对话框选一个 200MB 文件照样 OOM | 修法新增一步：「`importDatabaseBackup`（`:208-237`）改为 `await importDatabaseBackupFromPath(pickedPath)`，删掉 `:234` 的整包 `readFile`。导出签名 `Promise<"imported" \| "cancelled">` 不变，`handlers/backup.ts:47` 的调用方零改动，`db-backup-busy.test.ts:71` 走 `FromBytes` 直调也不受影响。这同时把 desktop 与 mobile 的导入形态彻底对齐（mobile `importDatabaseBackup:247` 本来就是 `pickToLocalPath → FromPath`）」 |
| A9 | S-CS-07 修法 step 7 / step 8（`fileExists` 辅助 / 不改导出签名） | valid | step 8「本条不改任何导出函数返回类型」与 §8.1 提交 1「纯错误处理，不改任何导出签名 ⇒ 可独立 revert」以及 §2 Step 1 的提交 2 改造**时序上不冲突**（1 先落、2 后落） | 无 |
| A10 | S-CS-07 验收 1-2（备份失败不覆盖 / 回滚失败信息含路径） | 验收不可测 | **两条都没有可注入缝**。`db-backup.service.ts:6` 是 ESM 具名 import `copyFile`，模块内无任何注入口；我对 `apps/desktop/test/*.ts` 全量搜 `mock.module` / `mock.method` / `jest.mock` —— **零命中**，本仓 desktop 测试基座是 `node:test` + `assert` + 「改对象属性当缝」（见 `cloud-sync-handlers.test.ts:101` 的 `configStore.getLocalMeta = ...`），**没有任何模块 mock 设施**。另外验收 1 给的注入手段「把 `dbPath` 所在目录临时改为只读」在 Windows 上**不成立**——`attrib +r` 对目录不阻止文件写入，本仓 desktop 套件正是在 Windows 上跑（见 §8.2 N-P0-02） | 修法第 1 步顺带加一个缝，两种任选：① 模块内 `const fsOps = { copyFile, unlink, open }` + `export function __setDbBackupFsOpsForTest(ops)`；② 把备份/回滚两步抽成 `async function replaceLiveDb(srcPath, dbPath, bakPath)`，测试直接单测它。注入手段换成 Windows 安全的确定性构造：**先在 `${dbPath}.nmbackup.bak` 位置建一个同名目录** ⇒ `copyFile(dbPath, bakPath)` 必以 `EISDIR/EPERM` 失败，且不依赖 chmod |
| A11 | S-CS-07 验收 4（不整包读入） | 验收不可测 | ① `readFile` 同样无注入口，「可用模块注入」在当前基座上落不了地；② 备选「对 200MB+ 假文件做内存峰值观测」直接撞 RULE.md:102「**性能护栏取数量级回归线，不拿实测值卡线**」——CI 上峰值内存受 GC/调度噪声影响，5–10× 余量放到 200MB 这个量级就失去判别力；③ 在共享 `setupDesktopDbTestEnv` 真库里造 200MB 文件也会拖慢套件 | 换成**同源可注入缝**（RULE.md:85 明写「观测面选与实现同源且可注入的缝」）：把 `assertSqliteFileAtPath` 导出为测试可见，缝开在 `open` 上，断言 `handle.read` 的实参为 `(buf, 0, 16, 0)`。这样「只读 16 字节」是**确定性断言**，且把实现整段删掉必红 |
| A12 | S-CS-07 测试策略与回归线 | valid | 全部实测存在：`apps/desktop/test/db-backup-busy.test.ts` 3 条（用例名逐字一致）；`desktop-db-test-env.ts` 确实导出 `setupDesktopDbTestEnv` / `teardownDesktopDbTestEnv`（夹具形态描述属实）；新增文件 `apps/desktop/test/db-backup-rollback-safety.test.ts` 尚不存在（拟新增，合规）；`cloud-sync-handlers.test.ts` 3 条 ✓；`db-backup-export-dialog.test.ts` 待核但存在性由 S-CS-02 回归线交叉背书 | R3 提到的 `db-backup-busy.test.ts:71`（`直接调 importDatabaseBackupFromBytes 期间 busy=true`）确为「先导出再导入」，走不到 `dbPath` 不存在的分支——R3 判断属实，新增用例必须覆盖此分支 ✓ |

### 1.2 S-CS-16（§3）

| # | 条目 | verdict | 证据 | 修改建议 |
|---|---|---|---|---|
| B1 | S-CS-16 病症：「两个 handle 在记账那一刻都还是**活的**」 | spec-defect | 在 `fe79b781` 基线上这句**不成立**。desktop `cloud-sync.service.ts:255` 的 `this.configStore` 背后的 conn 已在 `db-backup.service.ts:115` `closeLiveDbForBackupImport()` 里关掉了；mobile `cloud-sync.service.ts:341` 的 `runtime` 背后的 conn 已在 `db-backup.service.ts:150` `closeMobileConnection()` 里关掉了。两处记账句柄在基线上都是**死的**，这正是 §2 S-CS-01 的 P0 病症。S-CS-16 描述的是「**修完 S-CS-01 之后**」才成立的残余病症——它自己在病症首句写了「即使把 S-CS-01 … 解决掉」，但后半段的「还是活的」没有加同样的限定 | 把病症第二段改成：「在 **S-CS-01 修完之后**的中间态上，两个 handle 会在记账那一刻重获可用（因为 handler 会先重建 runtime），但它们绑的仍是**即将被 rebootstrap 作废的那一代**；而在本基线 `fe79b781` 上它们**已经是被 `closeLiveDbForBackupImport` 关掉的死句柄**（`:255` 必抛 `CONNECTION_CLOSED`）。**S-CS-16 不是独立于 S-CS-01 的第二条缺陷，而是它的残余面**」。这段写准了，实现者才不会误以为基线上存在一个「能写成功但写错代」的窗口而去构造无用测试 |
| B2 | S-CS-16 证据 file:line（desktop `:255` / handler `:91` / mobile `:341`/`:346`/`:348` / 令牌注释 `handlers/cloud-sync.ts:82-86` 与 `db-backup.service.ts:95-97` / `db-backup-busy.test.ts:101-127`） | valid | **逐条全中**，无一漂移。`:82-86` 确是 ic-20 令牌边界注释、`:95-97` 确是 db-backup 侧同款注释、第三条 busy 用例确在 `:101-127` 且确实用「重建窗口必须 busy=true」钉住时序。台账行号漂移的声明属实 | 无 |
| B3 | S-CS-16 修法 1（两端 `cloud-sync.service.ts` 函数头补四步契约） | valid | 落点明确（紧挨 `:82-86` / `:95-97`）；RULE.md:138「派生缓存与库同寿命」要求清池挂 `bootstrapNovelMaster` 入口，我已核实 desktop 侧 `connection.ts:41` 的 `getDesktopConnection` 确实调 `bootstrapNovelMaster(c)`、`desktop-runtime-singleton.ts:35-38` 的 rebootstrap 走 `reset → getDesktopRuntime → getDesktopConnection` ⇒ 「重建」确实带清池，四步契约的物理基础成立 | 无 |
| B4 | S-CS-16 修法 2（mobile ALREADY_UP_TO_DATE 分支不换代、记账走旧 runtime） | valid | `:352-359` 实测确认该分支 `return` 在 `onRebootstrap()` 之前、不换代、conn 未关 ⇒ 走旧 runtime 记账**正确**。要求补注释防后人误改，判断成立 | 无 |
| B5 | S-CS-16 修法 3（desktop ALREADY_UP_TO_DATE 早返回同理保留） | spec-defect | 位置对（`:259-263`），但 §2 S-CS-01 Step 3 把 `pull()` 返回类型改成 `Promise<{rev; databaseReplaced}>` 时，**`:262` 的 `return { rev: meta?.lastSyncedRev ?? 0 }` 与 `:257` 的 `return result` 两条返回语句都必须补 `databaseReplaced`**，而 S-CS-01 Step 3 只点名了「原 `:255-256` 两行移走」，**没点名这两条 return**。`:262` 漏补会直接编译不过（好）；`:257` 靠 `result` 透传（也对）—— 但两处都得在 spec 里点名，否则实现者要靠 tsc 才发现 | §2 Step 3 补一句：「返回类型变更后，`:257` 的 `return result` 与 `:262` 的早返回都要带 `databaseReplaced`；`:262` 恒为 `false`（库没换、连接没关）」。S-CS-16 修法 3 同步加这句交叉引用 |
| B6 | S-CS-16 验收 1（`git diff` 里注释必须出现「重建」「记账」先后顺序） | valid（弱） | 严格说这是 **review 验收点**不是可测断言，但 spec 已自陈「结构测试过度」并给出了机械判据，方向对 | 把它写成可执行命令以满足七要素里「命令 + 期望」的口径，例如：`git diff -- apps/*/src/services/cloud-sync.service.ts \| grep -nE "重建.*记账"`，期望命中 ≥1 |
| B7 | S-CS-16 验收 2（ALREADY_UP_TO_DATE 不触发 rebootstrap，`lastPullResult` 记为「已是最新」） | 验收不可测（半） | **前半无缝**：断言「不调用 `rebootstrapDesktopRuntime`」需要 spy 一个被 `handlers/cloud-sync.ts:13` 具名 import 的函数，本仓 desktop 测试基座零 mock 设施（同 A10）。**后半有牙**：`lastPullResult` 可直接经 `handleCloudSyncGetLocalStatus()` 读出，无需任何 mock | 前半改用**同源可观测面**：断言 `await getDesktopRuntime()` 的对象身份在 `handleCloudSyncPull()` 前后**不变**（rebootstrap 必然产生新 runtime 对象，`desktop-runtime-singleton.ts:13-24` 每次重建都 `new` 出来）。这个观测面无需注入缝、且把实现整段删掉必红（删了 rebootstrap 身份也会变……反向：改成**不**调用 rebootstrap 时身份不变 ⇒ 断言「身份不变」恰能抓住回归） |
| B8 | S-CS-16 测试策略 | valid | `apps/mobile/__tests__/cloud-sync.service.test.ts:191` 确有 `ALREADY_UP_TO_DATE 时不触发 rebootstrap`，改名强化路径清晰；新增的 `apps/desktop/test/cloud-sync-pull-accounting.test.ts` 与 §2 S-CS-01、§5 D5 共用，不新增文件、无重复声明 | 无 |
| B9 | S-CS-16 回归线「同 S-CS-01 的回归线全集」 | code-drift | S-CS-01 回归线写 `packages/core/test/cloud-sync/coordinator.test.ts` **全 20 条**。实测该文件 `it(` 共 **17 条**（`CS-P1`/`CS-P1b`/`CS-P2`/`CS-P3`~`CS-P6`/`CS-P5b`/`forceOverwriteRemote`/`T-SC10a`~`T-SC10e`/`PushAgentMutex 单元` 3 条）。spec 的**枚举清单是对的**（逐条列出即 17 条），只有**计数 20 错**。同一错误数字在 §2 与 §6 各出现一次 | 把两处「20 条」改成「17 条」或直接删掉数字只留枚举清单（枚举才是权威，数字反而误导） |

### 1.3 §6 #1 PushAgentMutex 未接线 · 第二源复核注记（§7）

| # | 条目 | verdict | 证据 | 修改建议 |
|---|---|---|---|---|
| C1 | §7 复核结论 1：`getDefaultPushAgentMutex` 未从任一 index 导出 | valid（1 处笔误） | 实测 `packages/core/src/infra/cloud-sync/index.ts` 全文 **45 行**，导出块确为 6 组（`errors` / `ports` / `model` / `lock` / `paths` / `coordinator`），**无 `PushAgentMutex`、无 `getDefaultPushAgentMutex`、无 `PushAgentMutexAcquireError`**。apps 侧确实拿不到 | §7 内部自相矛盾：`:783` 写「（45 行导出块）」、`:788` 写「全文 46 行」。统一为 45 行 |
| C2 | §7 复核结论 2：apps 侧零 acquire | valid | 我对 `apps` + `packages` 全量 grep `PushAgentMutex|getDefaultPushAgentMutex|pushMutex`（排除 node_modules/dist）：命中**只落在** `cloud-sync-coordinator.ts`（16 处）、`push-agent-mutex.ts`（19 处）、`coordinator.test.ts`（18 处）。**`apps/desktop` 与 `apps/mobile` 零命中**，与 spec 断言逐字相符 | 无 |
| C3 | §7 复核结论 3：模块头把未接线能力写成已实现 | valid | `push-agent-mutex.ts:1-14` 模块头实测写「push 和 agent 启动入口排队等对方」✓；`cloud-sync-coordinator.ts:44-50` 的 JSDoc 实测写「apps runtime 在 agent 启动入口应拿到同一实例（通过 `getDefaultPushAgentMutex`）」✓（字段本身在 `:51`，spec 说「JSDoc `:44-50`」准确）。两处均为承诺态，Wave E「注释承诺 ≠ 实现」靶子成立 | 无 |
| C4 | §7 危害顺序复核：第二次 `isAgentActive` 在上传之后 | valid | 逐点实测全中：上传在 `:256`(`putFile`) / `:260`(`put`)，第二次 agent 复检在 `:267`，`finalStatus` 的 `conditionalPutStatus` 在 `:297`，`return {rev: nextRev}` 在 `:307`，`finally` 的 `tryClearLock` 在 `:309-311`。⇒ 「agent 抢跑被发现时脏快照已进云端、rev 尚未推进、桶里留下 rev 已占位内容是脏的快照」，论据链完整成立 | 无 |
| C5 | §7 处置：归并 M-25、不单列条目 | valid | 与 `SPEC.md:12` 的 §6 口径（「8 条建议入账，#1 归并 M-25」）一致；与 `SPEC.md:19` 分片分配表「#1 PushAgentMutex（预期归并 M-25）」一致。归并而非新开条目，口径闭合 | 无 |
| C6 | §7 顺带项 1（两处注释标注「agent 侧接线未落地，见 M-25」） | valid | 零风险注释诚实化，落点 `:44-50` 与 `:1-14` 均已核实。§8.2 与 wave-e 的边界声明（judge 勿重复计入 Wave E 未完成清单）齐备 | 无 |
| C7 | §7 顺带项 2（若要真接线的三步顺序） | valid | ① `infra/cloud-sync/index.ts` 扩导出（我实测确无）→ ② 两端 agent 启动入口 acquire/release → ③ 才谈简化 `AGENT_ACTIVE` 复检。顺序依赖正确（不导出则 apps 拿不到，见 C1）；Wave E 的 X1 收口提醒亦已在 §8.2 写明 | 无 |
| C8 | §7「push-agent-mutex.ts 全文 136 行」 | code-drift | 实测 **135 行**（末行 `:135` 为类体收尾 `}`，其后为换行符）。与 C1 的 45/46 自相矛盾同类——都是「行数」这种易差 1 的元数据 | 改为 135 行，或干脆不写行数（行数对 execute 无影响，写错反而削弱 spec 可信度） |

---

## 2 · 组内依赖 / 一致性问题

### D1（跨条 must-fix，最优先）：S-CS-01 的「换代信号」漏改 dbSync 适配器 ⇒ 会静默退化成「永不 rebootstrap」

- **事实**：`db-sync.port.ts:13/:15` 现为 `importSnapshot(bytes): Promise<void>` /
  `importSnapshotFromPath?(path): Promise<void>`；S-CS-01 Step 2 把它放宽成
  `Promise<{ databaseReplaced: boolean } | void>`。
- **漏点**：两端把「端口实现」接到「备份函数」的适配器**只 await 不 return**：
  - desktop `apps/desktop/src/main/services/cloud-sync.service.ts:397-402`（`importSnapshot`）
    与 `:403-408`（`importSnapshotFromPath`），实测两处都是 `await importDatabaseBackupFrom…(…);` 后直接结束；
  - mobile `apps/mobile/src/services/cloud-sync.service.ts:222-227` 与 `:228-233`，同样只 await。
  S-CS-01 的 Step 1 只点名两个 `db-backup.service.ts`、Step 2 只点名 `db-sync.port.ts` 与
  `cloud-sync-coordinator.ts`，**这两个适配器从未出现在改动点清单里**。
- **为什么是 must-fix 而不是「tsc 会抓」**：Step 2 刻意把返回类型放宽为 `… | void`
  （为兼容既有 mock），于是适配器不 return **完全合法、零类型错误**，但运行时
  `databaseReplaced === undefined` ⇒ 按 R3 的默认口径（`== null` 一律按 `false`）
  ⇒ **handler 永远不 rebootstrap**。S-CS-01 要修的 P0 原样复发，且编译全绿。
  唯一能抓住它的是 §2 验收 1 的端到端断言（`lastSyncedRev === 2` + 第二次 pull 命中
  `ALREADY_UP_TO_DATE`）—— 即「靠验收兜住漏改」，这违反 spec 自陈的「改动点完整」要求。
- **建议**：§2 Step 1（或 Step 2）补一条改动点：「两端 `cloud-sync.service.ts` 的
  `dbSync` 适配器（desktop `:397/:403`、mobile `:222/:228`）必须 `return` 备份函数的
  返回值」。另外 mobile 的 `importSnapshot`（`:225`）走的是
  `importDatabaseBackupFromBytes`，而 mobile 的 `FromBytes`（`db-backup.service.ts:187`）
  本身委托给 `FromPath` —— **`FromBytes` 必须把 `FromPath` 的 `DbImportOutcome` 透传出来**，
  这一层委托 spec 也完全没提。

### D2（跨条 must-fix）：S-CS-07 §1 step 6 与 S-CS-01 Step 1 的回滚语义打架

已在 A7 展开。一句话：提交 1 的 catch 对一切错误回滚，提交 2 的 Step 1 说三表失败**不许**回滚，
两者对同一路径给相反指令，必须在 spec 里写死「谁的哪个 step 覆盖谁」，否则提交 2 会出现
「db 已被回滚成旧库、却上报 `databaseReplaced: true`」的语义错乱——那比现状更难解释。

### D3（跨条 must-fix）：两端 `cloud-sync.service.ts` 的「重建」语义在 §2/S-CS-16 契约里一致，但缺一处断言钉子

四步契约「换库 → 重建 runtime → 用新 runtime 记账 → 再放互斥令牌」在两端都写得通
（desktop `handlers/cloud-sync.ts:91` 的 rebootstrap + `service.recordPullSuccess`；
mobile `pullCloudSync` 的 `await onRebootstrap()` + `patchCloudSyncLocalStatus(fresh, …)`）。
**但「用的确实是新 runtime」这条没有任何断言钉住**：desktop 侧若 `recordPullSuccess`
误用 `this.runtime`（旧代），测试照样绿吗？—— 不会，因为旧代 conn 已关、会抛
`CONNECTION_CLOSED`，被验收 1 抓到。所以**这条实际是闭合的**，登记在此只为说明：
契约三步里「重建」有观测面（runtime 身份）、「记账」有观测面（`lastSyncedRev`）、
「放令牌」有观测面（`db-backup-busy.test.ts:101-127`），三步都有牙，无缺口。

### D4（依赖闭合）：`baseline.md`（S1）未被声明为本分片前置

§1/§2/§5 的每一条验收命令都以「对照 `baseline.md` 已知红清单、无新增红」为期望，
但 `fix-spec/` 目录下当前只有 `SPEC.md` / `state.md` / `wave-b-cloudsync.md` / `wave-c2.md`
—— **`baseline.md` 尚未产出**，`state.md:28` 显示 `s-baseline` 仍是 `pending`。
本分片的「依赖」字段只声明了条目间依赖（§1「无前置条目」/§3「依赖 S-CS-01」），
**没声明 S1 这条分片级前置**。§8.2 提了 wave-a 的 N-P0-02（「若 Wave A 未先落需手工确认用例数不为 0」），
却漏了 baseline.md 本身。

### D5（依赖闭合）：`baseline.md` 未产出前，S-CS-07 的验收 5「与已知红清单一致」不可执行

与 D4 同源但更具体：`npm test` 目前的判据只有「无新增红」，而没有基线文件时
「新增红」无定义。S-CS-07 是**唯一声明可独立先落**的条目，若它先落而 baseline 未出，
它的收口判据是空的。建议 §1 依赖字段补：「前置：`baseline.md`(S1) 出具；未出时可先跑
`npx tsc --noEmit` 与新增测试文件的定向跑，`npm test` 全量判增量待 S1 补齐」。

### D6（分片内一致性，无须改）：S-CS-07 与 S-CS-01 的签名协调是干净的

任务点名要查的这条，结论是**通过**：§1 修法 step 8 明确「本条不改任何导出函数返回类型（保持
`Promise<void>`）」，§2 Step 1 才把两端 import 函数改成 `Promise<DbImportOutcome>`，
§8.1 把两者排在提交 1 / 提交 2 且写死「1 → 2 → 3 是一条不可拆的链（1 必须在 2 之前）」。
⇒ 两节虽都改 `db-backup.service.ts` 的返回值，但**不是同一提交内的并发修改**，
不存在中间态编译不过的问题。唯一残留风险是 D2（catch 语义）而非签名本身。

### D7（跨条系统性前提）：spec 大量依赖 spy/注入，但 desktop 测试基座零 mock 设施

实测 `apps/desktop/test/*.ts` 对 `mock.module` / `mock.method` / `jest.mock` / `vi.mock`
**零命中**。现有唯一缝形态是「改对象属性」（`cloud-sync-handlers.test.ts:101-102` 的
`configStore.getLocalMeta = ...`）。而 spec 里 S-CS-07 验收 1/2/4、S-CS-16 验收 2、
§4 S-CS-02 验收 3、§5 D5 验收 1/2 **全部**要求 spy 一个 ESM 具名 import 的函数
（`copyFile` / `rebootstrapDesktopRuntime` / `exportSnapshotToPath`）。
这不是单条缺陷而是**分片级的可测性前提缺失**：要么在各条修法里显式要求新增缝，
要么把断言改写成「同源可观测面」（推荐：runtime 对象身份、K/V 读回值、磁盘文件是否存在）。
judge 轮建议把它作为一条 must-fix 统一下发，而不是在每条里各写各的。

### D8（轻微）：§0 说「这六条不是六个独立 bug」，实际列了 6 条（S-CS-07/01/16/02/D5/S-CS-03）——数目自洽 ✓

顺带核过，§0 的「六条」与分片条目清单一致，不算缺陷。仅提示 §0 第 3 条把
「D5 只缩小 pull 路径的触发面」与 `handlers/backup.ts:48-50` 的第二条触发面对上，
实测 `backup.ts:48-49` 确为 `if (result === "imported") { await rebootstrapDesktopRuntime(); }` ✓ 属实。

---

## 3 · must-fix 清单（doc-fix 直接照抄即可）

| 优先级 | 位置 | 动作 |
|---|---|---|
| **M1** | §2 S-CS-01 Step 1/2 | 补改动点：两端 `cloud-sync.service.ts` 的 `dbSync` 适配器必须 `return` 备份函数返回值（desktop `:397/:403`、mobile `:222/:228`）；mobile `FromBytes:187` 必须透传 `FromPath` 的 `DbImportOutcome`。并删掉/改写 R3 里「`databaseReplaced == null` 一律按 false」这条——它正是让漏改静默化的兜底 |
| **M2** | §1 S-CS-07 step 6 + §2 Step 1 | 写死回滚语义的覆盖关系：回滚只覆盖「覆盖动作本身失败」；三表 restore 失败由 S-CS-01 Step 1 接管（不回滚、改报 `providerTablesRestored:false`） |
| **M3** | §1 S-CS-07 修法 | 新增一步：`importDatabaseBackup`（`:234`）的整包 `readFile` 改为走 `importDatabaseBackupFromPath`，与 mobile 对齐（导出签名不变） |
| **M4** | §1 S-CS-07 step 5 | 散文与代码片段二选一对齐（推荐改散文为「回滚**失败**才留 bak」），并把 `rollbackFailed` 的声明位置写到 try 外 |
| **M5** | §1 S-CS-07 修法 step 1 + 验收 1/2/4 | 新增可注入缝（`__setDbBackupFsOpsForTest` 或抽出 `replaceLiveDb`），并把 Windows 不可靠的「目录只读」注入换成「在 `bakPath` 位置建同名目录」；验收 4 改为断言 `handle.read` 实参为 `(buf,0,16,0)`，删掉 200MB 内存峰值观测（撞 RULE.md:102） |
| **M6** | §3 S-CS-16 病症 / §2 Step 3 | 病症补「这是 S-CS-01 修完后的残余面，基线上两个 handle 已经是死句柄」；Step 3 补 `:257` / `:262` 两条 return 都要带 `databaseReplaced`（`:262` 恒 `false`） |
| **M7** | §2 / §6 回归线、§7 行数 | 「coordinator.test.ts 全 20 条」→「17 条」或改为只留枚举；`index.ts` 统一 45 行、`push-agent-mutex.ts` 135 行 |
| **M8** | §1 S-CS-07 证据 | 对照组描述改为事实版：mobile `:162` 的回滚步**也**吞，但从不删 bak；并顺带定一句「mobile 的回滚失败要不要并入错误信息」 |
| **M9** | §1 / §3 依赖字段 | 声明 `baseline.md`(S1) 为分片级前置；未出时给出降级验收口径 |
| **M10** | §3 S-CS-16 验收 2 | 「不触发 rebootstrap」改用 runtime 对象身份不变的同源观测面 |

---

## 4 · 结论

**组 Go / No-Go：No-Go（本轮）。**

一句话理由：**行号与病症全部核实无误、§6 #1 的三条复核结论与危害顺序也全部成立，
但 S-CS-07 的修法只改了一半（漏 `:234` 整包读入 + catch 回滚语义被 S-CS-01 反向覆盖）、
验收断言在零 mock 基座上无牙、且 S-CS-01 的换代信号漏改两端 dbSync 适配器会静默退化**——
共 10 项 must-fix，全部落在 doc 层，主代理一轮 doc-fix 即可闭合，无需重推论、无需重派机位。