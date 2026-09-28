# CR Fix Spec: 集成分支未审增量（mcdev 压缩线 + merge 裁决 + A2 + 存储页指标卡）

## 元信息

| 项 | 值 |
|---|---|
| repo | `D:\Dev\Js\novel-master`（当前分支 `integration/binary-storage`，勿切换） |
| base_sha | `5bef27b6` |
| head_sha | `43e83245` |
| prd_path | 未提供 |
| spec_path | `docs/Iterations/message-content-compression/spec.md` + `docs/Iterations/binary-blob-and-vfs-pack/spec.md`（均为只读参考，本节点不改） |
| review_round | 4（r1 四 scope → r2 full → r3 full → r4 full 终检；r2/r3/r4 修订分别由 spec-fix 子代理 / spec-fix 子代理 / 主代理 trivial 豁免执行） |
| dag_version | 2 |
| fix_spec_path | `docs/Iterations/binary-blob-and-vfs-pack/cr-fix-spec-integration.md` |
| 状态 | **fix-spec-ready**（2026-09-28 主代理宣布：r4 终检「2 处微调后可 yes」+ r4 微调已由主代理 trivial 豁免落地；待用户确认开工） |
| 评审模式 | code-review-loop 首轮四路并行 scope 评审：`review-scope-mcdev-core` / `review-scope-integration-core` / `review-scope-apps` / `review-scope-core-tests`，47 条原始 must-fix 去重合并为 **1×P0 + 10×P1 + 22×P2 = 33 条**；**r2 修订**：round 2 复检 `review-full-int` 判「建议 no（定点修订后可 yes）」——覆盖面与四要素已确认合格，按 8 处判据/措辞级缺口定点修订，新增 3×P2（新 ic-33 ~ ic-35）、原 ic-33 顺延为 **ic-36**，**共 36 条 = 1×P0 + 10×P1 + 25×P2** |
| 执行约束 | 本节点只写本文档；不改实现代码、不改测试、不改业务 spec、不改姊妹 fix-spec、不改 `docs/.iteration-state.yaml`、不创建或修改 `docs/apm/` 下任何文件；无任何 git 写操作 |

> **r2 修订说明（`review-full-int` 复检后）【r2 修订】**：本轮为定点修订，不重排结构、不改无关条目；修订处在行尾标「【r2 修订】」。新增条目 ic-33 ~ ic-35 插在 ic-32 之后，原 ic-33 顺延为 ic-36（其内部小节引用 ic-33a~g 同步改为 ic-36a~g）。

### 范围口径与姊妹文档关系

- A1 线（存量 blob 落库形态去 base64 + VFS 版本链打包）的 fix-spec 在姊妹文档 `docs/Iterations/binary-blob-and-vfs-pack/cr-fix-spec.md`，共 36 条，其中 **cr-06 已闭合**（集成分支 @`05ffcb53` 落地：完成标记值升 JSON 含 `failedCount`、纯读回报、DTO 增字段、UI 第三态），**剩 35 条待执行**。
- 本文件只覆盖**未审增量**：mcdev 压缩线（message-content-compression 在集成分支的落地）、merge 裁决产物、A2（`chat_message` 接入三表口径）、存储页指标卡（用户拍板 2026-09-28）。
- 条目编号用 **ic-XX** 前缀与姊妹文档 cr-XX 区分。与 A1 线同源同族的问题标注「**cr-XX 同类**」，但**执行面仍在本文件**；唯 ic-36 显式写明执行面在姊妹文档。【r2 修订】
- 行号口径：本文所有行号以当前工作区 head `43e83245` 为准（评审后若代码再动，以实际为准并在执行注记中说明偏差）。

---

## Must-fix（P0 → P1 → P2）

### ic-01 [P0] 压缩任务收尾维护整体收口：直调 `runDatabaseMaintenance` 绕过进程级去重与全部兜底，同进程双全库 VACUUM、失败冒泡、页空间永不回收

- 维度：B（正确性）+ C-orch（跨端编排）+ F（注释）
- 文件：
  - `packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts:186`（直调点：`await createDbMaintenanceService(conn).runDatabaseMaintenance();`；相关类型 `RunMessageContentCompactionOptions` 在 :58-69、结果类型在 :72-77、置标记在 :178-182）
  - `packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts:100`（`startupMaintenanceRan` 进程级标记）、`:113-121`（`runStartupMaintenanceOnce` 的短路与置位；**r2 订正**：原写 `:113-119`）【r2 修订】
  - `apps/desktop/src/main/services/message-content-compaction.service.ts:49-52`（desktop 接线：调 `runMessageContentCompaction` 未传维护回调）
  - `apps/cli/src/runtime.ts:187`（冒泡面：`await runMessageContentCompaction(conn)` 无 try/catch 兜底）
  - `docs/Iterations/message-content-compression/spec.md:42`（收尾口径「触发一次 `runDatabaseMaintenance`」需同步）
- 问题（六条同根因合并，四合一）：
  1. **去重域错位**：收尾维护直调 `createDbMaintenanceService(conn).runDatabaseMaintenance()`，不经过 `runStartupMaintenanceOnce`，于是进程级 `startupMaintenanceRan` 不置位。CLI 同一条命令内 compaction 跑完紧跟 `runBlobBinaryNormalization`（`apps/cli/src/runtime.ts:191`），归一侧再调 `runStartupMaintenanceOnce` 判「本进程没跑过」→ **同一条命令两次全库 VACUUM**（76MB+ 量级，CLI 同步阻塞）；desktop/mobile 双调度同理。
  2. **失败冒泡**：直调点无 try/catch。VACUUM 在磁盘满 / 库被锁时抛错 → core 抛给 `runMessageContentCompaction` 的调用方：CLI `createNovelMasterRuntime` 无兜底 → **每一条 CLI 命令失败**（且标记已置，下条命令标记短路、不再重试，用户侧只剩报错）。
  3. **标记先于维护**：先置 `compactionDone` 再跑维护（:178-182 → :186），维护失败后入口 `readDoneMarker` 永久短路 → 搬运释放的页**永不回收**（cr-32 同类）。
  4. **无 busy 信号**：无 `beforeMaintenance` / `afterMaintenance` 回调，desktop 不置 `setDesktopDbMaintenanceBusy` → 收尾 VACUUM 同步冻结 main 事件循环期间用户可再点出第二个 VACUUM（cr-03 / cr-26 同类）。
- 改法（可执行，a→d 一次改完）：
  - **a. 换去重入口**：把 `message-content-compaction.ts:186` 的直调改为 `await runStartupMaintenanceOnce(conn)`（import 从同目录 `./db-maintenance.service.js` 同时取 `createDbMaintenanceService` 与 `runStartupMaintenanceOnce`；`createDbMaintenanceService` 若不再被本文件使用则删 import），与 blob 归一同处一个进程级去重域。整段收尾包 try/catch，失败 `console.warn` 不抛（文案对齐 blob 版 `blob-binary-normalization.ts:519-527` 的口径：「收尾维护链路失败，不影响搬运结果」）。
  - **b. 标记顺序 / 持久化兜底**：把完成标记的置位移到维护成功之后；或按 A1 线 cr-01 改法第 4 步引入 `startupMaintenancePending` 持久化兜底（维护失败写 pending，入口读到即无视「本轮无进展」强制补跑，清标记以 `runStartupMaintenanceOnce` 返回非 `null` 为条件）。**推荐后者**——pending 口径为「**各自独立 pending key（module 分别为 `nm-message-content` / `nm-blob-binary`），只共用进程级去重域**」（与 OQ-I2 默认动作同句，消除「共享单 key」误读）；若走后者，置标记时机维持现状但补 pending 分支。【r2 修订】
  - **c. 回调与 desktop 接线**：`RunMessageContentCompactionOptions` 增 `beforeMaintenance?: () => void;` / `afterMaintenance?: () => void;`（与 cr-26 同名同语义；`afterMaintenance` 必须 finally 语义——VACUUM 抛错也要复位；两回调各自 try/catch，app 回调异常不得带崩 core）。desktop `message-content-compaction.service.ts:49-52` 传 `beforeMaintenance: () => setDesktopDbMaintenanceBusy(true)` / `afterMaintenance: () => setDesktopDbMaintenanceBusy(false)`（从 `./db-maintenance-busy.js` import）。**注释必须写明不自锁的理由**：`desktopCompactionBlocked()` 里的 `isDesktopDbMaintenanceBusy` 守卫在循环内、于每轮 `await runMessageContentCompaction` **之前**检查；维护回调只在调用内部触发、返回前已复位，所以下一轮守卫读到的是 `false`——「置 busy 期间循环不在守卫检查点上」。
  - **d. 同步改 compression spec:42** 的收尾口径为「调用 `runStartupMaintenanceOnce`（进程级去重）」+ 文件头注释（:15-16、:183-185）同口径订正；`blob-binary-normalization.ts:479-480` 的「多任务叠加不会多次全库 VACUUM」承诺在 compaction 走同一入口后才成立（见 SD-9，随本条修）。
- 验收/测试：
  - **前置【r2 修订】**：cr-26 的回调缝（`beforeMaintenance` / `afterMaintenance`）已落地（姊妹文档 wave-0）。
  - core 用例（建议落在独立测试文件，规避 A1 线 NF-1 的进程级去重标记已被本文件首条用例消费的问题；**【r4 补】本用例须为该测试文件首条进入维护段的用例（进程级标记未被消费），后续用例不得在其前重跑维护链路——对齐 A1 线 NF-1 纪律**）：**同进程先调 `runMessageContentCompaction` 再调 `runBlobBinaryNormalization` → 全库真跑的 VACUUM === 1 次**（判据用**真跑次数**：探针统计 VACUUM 语句下发次数；**【r3 修订】探针必须覆写 `conn.execute` 口**——VACUUM 与 `wal_checkpoint` 都走该口（`db-maintenance.service.ts:73/:77`），现版 `withSqlProbe` 只覆写 `conn.query` 与 `tx.execute`（姊妹 cr-08 待补的口），照抄现版会静默漏观测；cr-08 先落地就照修复版抄，否则本测试文件自带覆写。备选判据【r3 修订，改可观测形式】：compaction 收尾返回后手动调一次 `runStartupMaintenanceOnce(conn)` 断言返回 **`null`**（证进程级标记已由 compaction 侧置位、同进程去重生效）；当前实现为 compaction 直调 1 次 + 归一去重入口 1 次 = 2 次，红）。**旁注**：两条任务各自的 `beforeMaintenance`/`afterMaintenance` 回调计数按姊妹 cr-31 语义为「进入维护段次数（含被进程级去重短路的调用，beforeMaintenance 早于去重判定执行）」，两任务叠加必然 1+1 = 2，**不作 `=== 1` 断言**（回调只用来看 busy 置位边界）。【r2 修订】【r3 修订】
  - core 用例：注入 VACUUM 抛错 → `runMessageContentCompaction` **不 reject**（warn 后返回 `done` 按方案 b 置/不置），且后续同进程任务不再白付第二次维护。
  - desktop 用例（照 `apps/desktop/test/db-maintenance-handlers.test.ts:89-116` 探针手法）：VACUUM 执行瞬间 `isDesktopDbMaintenanceBusy() === true`、收尾结束后 `false`、抛错后仍 `false`。
- 来源：`review-scope-mcdev-core/B-01`（升 P0）+ `review-scope-mcdev-core/B-02` + `review-scope-mcdev-core/B-05` + `review-scope-integration-core/B-01` + `review-scope-integration-core/B-04` + `review-scope-apps/B-01`（六条同根因合并）；同类标注：**cr-01 / cr-03 / cr-25 / cr-26 / cr-32 同族**（compaction 侧新实例）

### ic-02 [P1] desktop 压缩循环循环外取 runtime + 整循环一个 try：rebootstrap（备份导入/云同步 pull·push）后永久死亡不重挂

- 维度：B（正确性）+ C-orch
- 文件：`apps/desktop/src/main/services/message-content-compaction.service.ts:41-65`（:43 `const runtime = await getDesktopRuntime();` 在 `for (;;)` 之外；:42-64 整循环包在单个 try 内，:59-64 catch 后直接结束）
- 问题：`getDesktopRuntime()` 只在循环外取一次。`rebootstrapDesktopRuntime()` 会先关连接再重建，调用方是**备份导入**与**云同步 pull/push**。压缩一轮最长 60s，连接在轮内被关的概率不低 → `conn.query` 抛「connection is not open」→ 被最外层 catch 吞掉后循环**永久退出**，没有任何重挂机制。云同步 pull 换回远端库（可能整库未压缩）后，此后本会话状态行**永停「进行中」且永不推进**。mobile 侧按 runtime 实例重挂、天然可恢复，两端对同一故障处理相反。比 A1 线 cr-05 的实例更重（cr-05 同类）。
- 改法（可执行）：
  1. `getDesktopRuntime()` 移进 `for (;;)` 每轮首行（改 `const runtime = await getDesktopRuntime();` 到循环体内；`desktopCompactionBlocked()` 检查保持在其后）。
  2. try/catch 下移到**轮内**（包住单轮 `runMessageContentCompaction` 调用）。
  3. catch 分流：`error.message` 命中「connection is not open」/「not open」→ `console.warn` 后 `continue`（下轮 `getDesktopRuntime()` 换到新连接，自然重挂）；其它错误 → warn 后 `return`（本进程收手，下次启动幂等重试）。建议抽本地 `isConnectionClosedError()` 小助手（对齐 A1 线 cr-05 改法 B 的判据）。
  4. 服务头注释补「连接被 rebootstrap 换掉时本任务视为可重挂（每轮重取 runtime），远端库回灌后会重新压缩」。
- 验收/测试：`apps/desktop/test/` 新增用例——挂载后模拟一次 rebootstrap（替换 runtime.conn），断言第二次调度**仍会发生**（当前实现为红）；再补一条：轮内注入 `conn.query` 抛「not open」，断言下一轮可恢复（继续搬运而非退出）。
- 来源：`review-scope-apps/B-02` ≡ `review-scope-mcdev-core/B-06`（合并）；**cr-05 同类**且比 A1 实例更重（云同步 pull 回远端库后状态行永停「进行中」）

### ic-03 [P1] mobile 把压缩采样塞进同一个 `Promise.all`：第四个失败源可打掉全部四个指标

- 维度：B（正确性）+ C-orch
- 文件：`apps/mobile/src/services/db-maintenance.service.ts:59-64`（`Promise.all([statDatabaseFileBytes(), getStorageStats(), getBlobBinaryStatus(), getMessageCompactionStatus()])`）、返回类型 :48-55
- 问题：`getMessageCompactionStatus`（A2 新增的第四个失败源）抛错会让整个 `Promise.all` reject，`StorageConfigScreen.refreshMaintenanceStats` 的 catch 把库体积、可回收量、blobBinary、messageCompaction 一起置空——一个附属展示字段新增的失败源能打掉改动前就已存在的指标。与 desktop 侧「独立 try/catch 兜底」的口径相反（两端同 DTO、同 UI、两种降级语义）。**与 A1 线 cr-04 改的是同一处结构，必须合并执行**（cr-04 同类）。
- 改法（与 cr-04 合并）：
  1. 抽 `async function sampleMessageCompactionStatus(conn): Promise<MessageCompactionStatus | null>`——内部 try/catch，失败 `console.warn` 一次后返回 `null`（对齐 desktop `sampleBlobBinaryStatus` 的降级口径）。
  2. `getDatabaseMaintenanceStats` 的 `Promise.all` 只留 `statDatabaseFileBytes()` + `getStorageStats()`；`blobBinary` 与 `messageCompaction` 各自单独 `await`（blobBinary 走 cr-04 的 `sampleBlobBinaryStatus`，失败返回 `[]`）。
  3. 返回类型 `messageCompaction: MessageCompactionStatus | null`；UI 侧 `StorageConfigScreen` 已有 `messageCompaction == null → '—'` 分支（:116-118），直接兼容，无需改渲染分支。
- 验收/测试：`apps/mobile/__tests__/db-maintenance.service.test.ts` 补——mock `getMessageCompactionStatus` reject → 整体**不 reject**、`fileBytes`/`reclaimableBytes` 有值、`messageCompaction === null`；对称补 `getBlobBinaryStatus` reject 用例（即 cr-04 验收顺手落）。
- 来源：`review-scope-apps/B-03`；**cr-04 同类**（与 cr-04 改法互斥，必须合并执行）

### ic-04 [P1] desktop 采样失败兜底渲染成「进行中（剩余 0 条）」：与注释承诺、blobBinary 降级口径都相反

- 维度：A（口径）+ B（正确性）
- 文件：
  - `apps/desktop/src/main/services/db-maintenance.service.ts:56-68`（`sampleMessageCompactionStatus` 失败返回 `{ done: false, pendingCount: 0 }`，:66）
  - `apps/desktop/shared/ipc-types.ts:1537-1542`（`MessageCompactionStatusDto`「两态口径」注释）、`:1544-1551`（`DbStatsResult.messageCompaction`）
  - `apps/desktop/renderer/features/settings/SettingsViews.tsx:156-163`（`status == null → '—'` 分支已就位，但 status 永远非 null）
- 问题：注释（`db-maintenance.service.ts:51-55`）承诺「附属信息采样失败不拖垮主统计，吞掉异常按『未取到』展示」，但兜底值 `{ done: false, pendingCount: 0 }` 会被 renderer 渲染成「**进行中（剩余 0 条）**」——既不真、也不像占位；`sampleBlobBinaryStatus` 的同位兜底是空表 → renderer 显示 `'—'`，两者口径相反。
- 改法（可执行）：
  1. `sampleMessageCompactionStatus` 失败返回 **`null`**。
  2. DTO 类型改 `MessageCompactionStatusDto | null`（`ipc-types.ts`），注释写明「`null` = 未取到，renderer 显示占位 `'—'`；与 `blobBinary` 空表同口径」；同步订正 `MessageCompactionStatusDto` 的「两态口径」注释为「两态 + 未取到（null）」三态事实（apps SD-5）。
  3. renderer `SettingsViews.tsx:156-163` 的 `status == null` 分支已存在（返回 `'—'`），接上升级后的 DTO 即可；无需新增分支。
- 验收/测试：`apps/desktop/test/db-maintenance-handlers.test.ts` 补——注入采样抛错 → `fileBytes` 仍在且 `messageCompaction === null`（当前为红，返回 `{done:false,pendingCount:0}`）；`apps/desktop/test/settings-db-maintenance-ui.test.ts` 源码契约补 null 分支断言。
- 来源：`review-scope-apps/B-04` ≡ `review-scope-mcdev-core/B-09`（合并）

### ic-05 [P1] compaction 批查询无 keyset 游标：每批从头全表扫（5350 行库累计约 4GB 读，真机 2 分钟收敛的主成本）

- 维度：B（正确性·性能）
- 文件：`packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts:145-150`（`SELECT id, content_json FROM chat_message WHERE content_json != '' ORDER BY rowid LIMIT 100`，无游标条件）
- 问题：`chat_message` 是常规表（有 rowid），但本批查询没有 keyset 游标——每批都要从表头扫过「已被搬走（前缀）行 + 本批匹配行」。5350 行量级库（重度用户）累计读取约 4GB，是「真机 2 分钟才收敛」的主成本。对照 blob 归一已用主键游标（`blob-binary-normalization.ts:121-127` 的 keyset 方案）。
- 改法（可执行）：
  1. `SELECT rowid, id, content_json FROM chat_message WHERE content_json != '' AND rowid > ? ORDER BY rowid LIMIT 100`；`let cursor = 0;`（rowid 为整数，起点 0 安全——rowid 恒为正）。
  2. 每批末（**包括批内逐行 UPDATE 完之后**）无条件推进：`cursor = Number(lastRow.rowid)`。
  3. 注释写明：并发端（另一端启动）搬走的行不会出现在后续批，残余由下次启动谓词重扫兜底；游标只用于「本轮加速」，不承担完成判定（完成判定仍以谓词 COUNT 为准）。
  4. 与 ic-07 的零进展护栏/收尾谓词校验**同批改**（护栏论证依赖游标，见 ic-07 第 ⑤ 步）。
- 验收/测试：
  - core 探针用例（照 `packages/core/test/infra/blob-binary-normalization.test.ts:227` 的 `withSqlProbe` 搬进 `message-content-compaction.test.ts`）：夹具 N=250 行（249 正常 + 1 行 UPDATE 恒 `changes=0` 的打转行），预算充足跑完一轮；统计每批 SELECT 返回行数之和，断言**每行恰被选中一次**（累计 === N；打转行在游标推过后不再返回）。**反向判据**：改回无游标实现时，打转行每批重复返回、累计 ≈ 100×批数（远超 N），断言必红。
  - `syncBudgetMs: 0` 三轮：断言每次 SELECT 的游标参数**严格单调递增**（探针记录参数）；当前实现下无该参数，断言必红。
- 来源：`review-scope-mcdev-core/B-03`

### ic-06 [P1] 状态采样全表 COUNT ×2 挂在 desktop 2s 轮询 / mobile 进页：迁移窗口 IO 风暴

- 维度：B（正确性·性能）+ C-orch
- 文件：
  - `packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts:79-84`（`countPendingRows`：`SELECT COUNT(*) ... WHERE content_json != ''`，谓词不可索引）
  - `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts:282-290`（同型谓词 COUNT，×三表）
  - 消费方：`apps/desktop/renderer/features/settings/SettingsViews.tsx:249-252`（`window.setInterval(..., 2000)` 2s 轮询 db/stats）、`apps/mobile/src/screens/stack/StorageConfigScreen.tsx:177-182`（进页采样）
  - 可选索引落点：`packages/core/src/bootstrap/chat/chat-schema.ts:26、:58`（既有 `CREATE INDEX` 风格）
- 问题：未完成态下每次状态采样都会对 `chat_message`（A2 后约 43MB、最大表）做一次全表 COUNT，desktop 存储页 2s 轮询 = 每 2s 一次全表扫；迁移窗口（数分钟到数十分钟）持续 IO 风暴，与「后台静默整理」的定位相悖。A1 线 cr-22 第 8 项登记的「**A2 接入 `chat_message` 的前置条件**」未落实（cr-22 同类未闭合）。
- 改法（推荐组合，①②是否都做见 OQ-I5，**默认先做①**）：
  1. **节流**：`getMessageCompactionStatus` 与 `getBlobBinaryStatus` 的谓词 COUNT 路径加模块级节流（窗口约 3s）——窗口内重复调用返回上次采样值；注释写明「2s 轮询 + 全表扫 = 迁移期 IO 风暴」。实现建议：模块级缓存（键按连接实例隔离，WeakMap 或 `{ conn, at, value }` 单体缓存）+ 测试用 reset 钩子（避免用例间串值）。
  2. **索引**（可选，随下一轮 BOOT bump）：`chat-schema.ts` 补 `CREATE INDEX IF NOT EXISTS idx_chat_message_content_encoding ON chat_message(content_encoding)`；配套 `schema-column-alignments.ts` ALIGN 条目 + `SCHEMA_BOOT_VERSION` 顺延（索引使谓词第一 disjunct 可走索引；第二 disjunct 含 `TYPEOF(content_blob)` 仍需扫描，节流仍保留）。
- 验收/测试：
  - core 探针用例——标记未置时连调 10 次状态查询，COUNT 下发次数 ≤ 节流窗口允许值（当前 10 次全发，红；节流后按时间窗口 ≤2）。
  - 若做②：`EXPLAIN QUERY PLAN` 断言 `content_encoding` 谓词走新索引。
- 来源：`review-scope-mcdev-core/B-04` ≡ `review-scope-integration-core/B-08`（合并；A1 cr-22 第 8 项未落实）

### ic-07 [P1] compaction 四连缺：计数不看 changes、无零进展护栏、无收尾谓词校验、无坏行隔离

- 维度：B（正确性）
- 文件：`packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts:155-187`（逐行循环 :155-168、无条件计数 :167、置标记 :178-182）
- 问题（四连缺）：
  1. **计数不看 changes**：`compactedCount += 1` 无条件执行（:167），并发端已搬走 / UPDATE 未生效时仍计数，「实际搬运行数」失真。
  2. **无零进展护栏**：若驱动异常导致 UPDATE 恒 `changes=0`，谓词不缩小 → 每批反复 SELECT 同一批行，纯烧 60s 预算（blob 侧已有 `ZERO_PROGRESS_BATCH_LIMIT` 与 `stalled`，压缩侧没有）。
  3. **无收尾谓词校验**：谓词 COUNT 非零时也可能因游标推进而「看似扫完」，无条件置标记 → 残留正常行被永久跳过（A1 cr-02 / cr-24 的同型事故，compaction 侧新实例）。
  4. **无坏行隔离**：单行 `encodeMessageContent` 抛错（content_json 非法）会**中断整轮**，坏行永远留在谓词里，标记永远置不上、每次启动白烧预算（blob 侧已按「逐行 try/catch + failedKeys + failedCount」处理）。
- 改法（可执行，①~⑤ 与 ic-05 游标同批改）：
  1. 更新结果只看 `result.changes > 0` 才 `compactedCount += 1`；同批维护 `batchChanges` 计数。
  2. 引入 `ZERO_PROGRESS_BATCH_LIMIT = 3`（对照 blob 版 :75 的论证：不要求满批；连续 3 批 `batchChanges === 0` 且无新增坏行 → `stalled`）；`MessageCompactionRunResult` 增 `stalled: boolean`；app 层（desktop/mobile 循环）见 `stalled === true` 即 warn 后 return 本进程收手（对齐 mobile blob 版 :75-83 的处置），下个冷启动再试。
  3. 置标记前**收尾谓词校验**：`leftover = await countPendingRows(conn)`；`leftover > failedKeys.size` → `console.warn` 后 `return { done: false, compactedCount, failedCount, stalled: true }`，**不置标记**。注释写死不变量：收尾校验只在游标扫完（`rows.length === 0`）之后可达 ⇒ `leftover ⊆ failedKeys`；收尾前不得再引入任何提前 `break`。
  4. 逐行 try/catch：`encodeMessageContent(row.content_json)` 抛错 → 该行加入 `failedKeys`、`failedCount += 1`、warn 后 `continue`；收尾 `leftover <= failedKeys.size` 时照常置标记，标记值升为 JSON `JSON.stringify({ at, failedCount })`（**对齐 A1 cr-06 的解析兜底**：读取端 `JSON.parse` 失败按 `{ failedCount: 0 }` 处理，旧 ISO 值兼容）。
  5. 与 ic-05 的 keyset 游标同批改（护栏与收尾校验的论证都依赖游标）。
- 验收/测试（三条 core 用例 + 反向判据）：
  - **打转**：注入 UPDATE 恒 `changes=0` 的驱动桩 → 跑一轮 → 断言 `stalled === true`、标记未置。反向判据：把 ① 改回无条件 `+1` → 第一条变红。
  - **残留拦截**：1 正常行 + 1 打转行 → 收尾谓词校验拦截（`done=false`、`stalled=true`、标记未置）。
  - **坏行隔离**：`encodeMessageContent` 对某行抛错 → 其余行全部搬完、`failedCount === 1`、标记**已置**、全部行读回正常（坏行明文读路径双形态自愈）。
- 来源：`review-scope-mcdev-core/B-08`；同类族：**cr-02 / cr-24 / cr-25**（compaction 侧新实例）

### ic-08 [P1] 搜索在大会话下全量解压 + 无 yieldFn 同步 map：desktop main 冻结

- 维度：B（正确性·性能）+ C-orch
- 文件：
  - `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:441-481`（`searchMessages`：keyword 非空时 SQL **不 LIMIT**（:452），全量拉行后 `mapRows` 逐行解压/JSON.parse 精筛）
  - `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:185-204`（`mapRows`：无 `yieldFn` 时直接同步 `map`，有则分片让步；**r2 订正**：原写 `:161-200`）【r2 修订】
  - 装配点：`apps/mobile/src/runtime/create-mobile-runtime.ts:111-112、:172`（mobile 已注入 `messageParseYield`）；`apps/desktop/src/main/runtime/create-desktop-runtime.ts:126`（`createMessageService(conn)` **未注入** yieldFn）；`apps/cli/src/runtime.ts` 同类
- 问题：关键词搜索语义改为「全量拉取 + 内存精筛」（正确，修了旧 LIKE 漏召回），但 keyword 非空时没有扫描上限，大会话（数千条、含 20KB 长文）一次搜索要全量解压；desktop/cli 未注入 `yieldFn`，`mapRows` 全程同步 `map` → **desktop main 事件循环冻结**（与 better-sqlite3 同步语义叠加，UI 卡死）。A1 线 cr-fix-spec 的搜索性能风险评估偏低（SD-6）。
- 改法（推荐 A+B 组合，拍板见 OQ-I1；C 仅登记不推荐单独采用）：
  - **A. SQL 扫描上限 + keyset 续扫**：keyword 非空时 SQL 加扫描上限（`scanLimit = max(limit*20, 200)`，随 `beforeSeq`/`fromSeq` 口径），按 `seq DESC` keyset 续扫（`AND seq < ?`），本段命中不足 `limit` 且还有剩余行时继续下一段，直到凑满 `limit` 或扫完；保证返回恰为「最新的 limit 条命中」。
  - **B. 注入 yieldFn**：desktop runtime 装配处（`create-desktop-runtime.ts:126` `createMessageService(conn)` → `createMessageService(conn, { yieldFn })`）注入分片让步；CLI 同类核对（无 UI 冻结面，可不注入并在注释说明）。
  - **C. 仅登记**：不动实现，只在 spec 风险段登记「大会话搜索可能冻结 main」——不推荐单独采用。
- 验收/测试：
  - 构造 2000 行单会话 keyword 搜索，探针断言 SQL 下发行数 ≤ `scanLimit`（当前全量下发，红）。
  - 续扫用例：本段命中不足 `limit` 时正确续扫并返回恰好 `limit` 条（含 beforeSeq 边界）。
  - desktop 注入 yieldFn 后 `mapRows` 分片被调用（计数 ≥2）。
- 来源：`review-scope-mcdev-core/B-07`（含方案待拍板，OQ-I1；SD-6）

### ic-09 [P1] tests 恒真族 A：T-C7 第二遍「compactedCount=0」恒真 +「零 COUNT 成本」无观测缝

- 维度：G（测试）
- 文件：`packages/core/test/infra/message-content-compaction.test.ts:132-139`（第二遍断言 `second.compactedCount === 0`；:136-139 完成态采样「零 COUNT 成本口径」）
- 问题：第二遍时 `readDoneMarker` 已短路（`message-content-compaction.ts:130-132`）→ `runMessageContentCompaction` 直接返回，**恒为 `compactedCount = 0`**——把短路删掉也照样绿，无牙齿。同理「完成态采样零 COUNT 成本」只断言返回值，没有观测「COUNT 是否真的没下发」的缝（恒真族；cr-07 同类）。
- 改法（可执行）：
  1. 把 `withSqlProbe` 搬进本文件（照 `packages/core/test/infra/blob-binary-normalization.test.ts:227` 的写法，含 `query`/`execute`/`transaction` 三口的拦截）。**【r2 对齐 cr-08】**该 helper 现仅覆写 `conn.query` 与 `tx.execute`（`conn.execute` 口待姊妹 cr-08 补）；若 cr-08 先落地就照修复版抄，否则先抄 cr-08 的修复再抄本条。【r2 修订】
  2. 第二遍断言改为**路径覆盖级**：探针断言第二遍**不下发** `UPDATE chat_message`、**不下发** `COUNT`（标记短路路径不得触库写与计数）；`compactedCount` 断言保留。
  3. `compactedCount >= 1` 改 `=== 1`（夹具 1 行，值必须精确）。
  4. **新增独立用例「清标记再跑 = 零搬运」**（`DELETE FROM kkv_entry WHERE module/key` 后第二遍，强迫真走谓词路径）：断言零 UPDATE、零搬运——与「标记短路」分成两条路径，注释写明「第一条只覆盖标记短路，第二条才是谓词幂等的牙齿」。
  5. 「零 COUNT 成本」用探针断言（完成态采样：探针里无 COUNT 下发），并在用例内加一条对照（未完成态采样时探针**能**观测到 COUNT）证明探针有牙。
- 验收/测试：删掉 `readDoneMarker` 短路 → 新断言变红；把谓词写错（已压缩行重新命中）→「清标记再跑」用例变红。
- 来源：`review-scope-core-tests/G-01` + `review-scope-core-tests/G-02`（合并）；**cr-07 同类**

### ic-10 [P1] tests 恒真族 B：schema fixture 字面量 15 锁不住「加列忘 bump」+ 快路径用例恒真 + 缺负面场景

- 维度：G（测试）
- 文件：
  - `packages/core/test/bootstrap/message-content-compression-schema.test.ts:54`（`PRAGMA user_version = 15` 字面量；:43 标题写「v15 存量库」）
  - 同文件 `:114-132`（快路径用例：只断言列在、版本等于常量，恒真——不观测「未下发 DDL」）
  - `packages/core/src/bootstrap/schema-align/schema-column-alignments.ts:156-159`（注释仍写「SCHEMA_BOOT_VERSION **v16** bump」，实际常量已是 17，见 `novel-master-bootstrap.ts:111`）
- 问题：fixture 把 user_version 写死 15，但断言只比「bootstrap 后版本 === `SCHEMA_BOOT_VERSION`」——任何人加列却忘记 bump（真机实锤坑，RULE 里已登记）时，存量库（version=旧 BOOT）走快路径不补列，而测试**照样绿**。快路径用例只断言「列在」（第一次 bootstrap 已建，恒真），完全没有「第二次 bootstrap 不下发 DDL」的断言；也缺「BOOT 写小（快路径）→ 不补列」的真机事故形态用例。
- 改法（可执行）：
  1. `PRAGMA user_version` 改 `SCHEMA_BOOT_VERSION - 1` 常量表达式（当前落 16）；:43 标题注释改「`SCHEMA_BOOT_VERSION - 1` 存量库（缺压缩两列）」。
  2. `schema-column-alignments.ts:157` 注释 `v16` → `v17`。
  3. 快路径用例改为**探针断言无 DDL**：第二次 `bootstrapNovelMaster` 期间探针未观测到 `ALTER TABLE` / `CREATE`（或造「版本已达标但缺列」的库，断言快路径**不补列**——即负面用例）。
  4. 新增负面用例「**BOOT 写小 → 快路径不补列（真机事故形态）**」：先 bootstrap 完整库 → 手工 `DROP COLUMN` 两列 + `PRAGMA user_version = SCHEMA_BOOT_VERSION`（模拟「加列忘 bump 后已经写高版本」的库）→ 再 bootstrap → 走快路径 → 断言两列**不存在**（用例注释写明：这就是「加列必须 bump」纪律的反面教材，若要修复此形态必须 bump BOOT）。
- 验收/测试：把 `SCHEMA_BOOT_VERSION` 常量改回 16 → 慢路径 / 负面用例**必须红**（慢路径 fixture 落在 15、两列缺失且 BOOT=16 不再覆盖新列语义）；反向：把 ALIGN 条目删掉 → 慢路径红。
- 来源：`review-scope-core-tests/G-03` + `review-scope-core-tests/G-04` ≡ `review-scope-mcdev-core/B-11`（合并）

### ic-11 [P1] perf 阈值近乎恒真（5s/30s = 实测 15~100 倍余量）+ tail 断言只看 type 不看内容

- 维度：G（测试）
- 文件：`packages/core/test/chat/message-content-perf-threshold.test.ts:63-69`（`tail[0].content.blocks[0].type === "text"` + `tailMs < 5_000`）；对照 :96-100（100 行压缩 < 30s）
- 问题：tail 只断言长度与**块类型**，不看内容——解压错了、块内容为空都能绿；阈值 5s/30s 相对实测（毫秒级）有 15~100 倍余量，只兜「差一个数量级」的退化，几乎恒真。
- 改法（可执行，二选一 + 内容断言必做）：
  1. 内容断言改 `deepEqual` 全量：`tail[0].content` 与写入时的 `textBlocks(body)` 深等（或逐条 `JSON.stringify` 比对）。
  2. 阈值二选一：**A（推荐）** 改相对基线——先在同一 fixture 建「同构明文库」跑一次测基线耗时，阈值 = 基线 × 2~3；**B** 降到实测 P99×3 并在注释写清实测环境（机型/CI）口径。若维持 non-blocking 定位不做 A/B，则注释明确写「本断言只兜数量级，不做回归保护」，不许继续以「性能用例」名义掩盖。
- 验收/测试：解压返回空 blocks（或改动 codec 使内容错位）→ 内容断言变红；decompress 人为慢 10 倍 → 相对基线阈值红。
- 来源：`review-scope-core-tests/G-05`

### ic-12 [P2] `readDoneMarker` 的 `failedCount` 负数/非整数原样透传（UI 会显示「已完成（-3 条需人工处理）」）+ `at` 字段解析后全链路无消费

- 维度：B（正确性·口径）
- 文件：`packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts:256-279`（`readDoneMarker`：:269-273 只查 `typeof === "number" && Number.isFinite`）
- 问题：标记值损坏（负数 / 小数）时 `failedCount` 原样透传 → UI 渲染「已完成（-3 条需人工处理）」；`at` 字段解析出来后**全链路无消费**（`BlobBinaryTableStatus` 不含它），纯死数据。
- 改法（可执行，二选一写明，**默认按 A**）：
  - **A（默认）** `failedCount` 透传条件收紧为 `Number.isInteger(parsed.failedCount) && parsed.failedCount >= 0`，否则归 0；`at` 从 `BlobBinaryDoneMarker` 与解析结果中**删掉**（标记值仍写 `at` 便于人工排查，解析侧不保留）。
  - **B** 保留 `at` 并透出到状态（DTO/UI 增「上次完成时间」展示），须同步三端 DTO 与 UI 文案。
- 验收/测试：core 用例——预置标记值 `{"failedCount": -3, ...}` 与 `{"failedCount": 1.5, ...}` → `getBlobBinaryStatus` 回报 `failedCount === 0`（当前透传，红）；`{"failedCount": 5}` → 5 正常。
- 来源：`review-scope-integration-core/B-05`

### ic-13 [P2] 死出口 `MESSAGE_COMPACTION_KKV_MODULE` / `MESSAGE_COMPACTION_KKV_KEY`：全仓仅测试与 allowlist 消费

- 维度：C（质量·死出口）
- 文件：`packages/core/src/index.ts:99-100`（主出口导出）+ `packages/core/test/package-exports/snapshots/main-entry-allowlist.json:21-22`（快照登记）；定义处 `message-content-compaction.ts:40-41`，内部消费处 :91-92、:179-180（`infra/db-maintenance/index.ts:32-33` 的内部出口）
- 问题：两个 KKV 常量经主入口对外暴露，但外部消费方只有快照/allowlist 与测试（测试实际从 `../../src/infra/db-maintenance/index.js` 相对路径 import，不经主入口）——主入口出口是死出口。
- 改法（二选一，**默认按 A（撤）**，与姊妹文档 cr-fix-spec 既有 OQ-1 处置同口径，拍板项）：
  - **A（默认）** 从 `packages/core/src/index.ts:99-100` 撤出两行；`main-entry-allowlist.json` 删两行。`infra/db-maintenance/index.ts` 的内部出口保留（任务内部与测试继续消费）。
  - **B** 保留主出口，在两个常量定义处加注释写明「预留：外部端可能按 module/key 直查/清理标记（如运维脚本）」，并保持快照。
- 验收/测试：走 A 时 `pnpm -C packages/core test` 的 package-exports 快照用例绿（快照已同步删）；`git grep "MESSAGE_COMPACTION_KKV" packages/core/src/index.ts` 为空。
- 来源：`review-scope-integration-core/B-06` ≡ `review-scope-core-tests/OQ-2`（合并）

### ic-14 [P2] `messageContent` 不设 UI 状态行的口径未进 spec（代码注释与契约断言已在 head 就位）【r2 修订】

- 维度：A（口径）+ K（文档同步）
- 文件（r2 核实口径）：
  - `apps/desktop/renderer/features/settings/SettingsViews.tsx:137-142`（「消息正文『去 base64』不设状态行」注释**已就位**）、`:143-147`（`MIGRATION_ROWS` 恰三行）
  - `apps/mobile/src/screens/stack/StorageConfigScreen.tsx:150-155`（同注释**已就位**）、`:156-160`（同三行）
  - 契约断言**已就位**：`apps/desktop/test/settings-db-maintenance-ui.test.ts:96-98`、`apps/mobile/__tests__/storage-config-screen-source.test.ts:104-106`
- 问题（r2 收窄）：core 的 `BlobBinaryTableStatus.failedCount` 对 `messageContent` 表照常回报（A2 接入后该表是最大表），两端迁移卡**有意不设该表状态行**——原改法 1/3（两端注释、source-test 契约断言）**已随集成分支落地**（注释与断言均已在 head），剩余缺口只有「该已知代价未登记进业务 spec」这一条（OQ-3）。
- 改法（收窄后仅剩一条）：
  1. spec 登记该已知代价——在 binary-blob spec「实现期补充二（集成分支 + A2 + 存储页指标卡 + 真机验收）」的**指标卡拍板段**（`docs/Iterations/binary-blob-and-vfs-pack/spec.md:257` / `:264` 指标卡行）补一句：「消息正文『去 base64』不设状态行——发版形态下压缩搬运直接写二进制，不存在用户可见的中间态（`messageContent` 的 `failedCount` 属 engine 内部观测，不入 UI）」。
  2. ~~两端补注释~~ / ~~两端 source-test 补契约断言~~：**已落地，不再要求**（保留为现状核对项）。
- 验收/测试：docs diff 复检——binary-blob spec 指标卡拍板段可 grep 到「不设状态行」/「不存在用户可见的中间态」字样；两端既有注释与 :96-98 / :104-106 契约断言保持绿（现状复核，不新增断言）。【r2 修订】
- 来源：`review-scope-integration-core/B-07` ≡ `review-scope-apps/OQ-3`（合并）；**r2 复核**：改法 1/3 已落地（`review-full-int`）

### ic-15 [P2] 坏行告警文案用不存在的列名 `chat_message.bytes`（真实列 `content_blob`）+ `WITHOUT ROWID` 注释口径不一

- 维度：F（注释/文案）+ B（正确性）
- 文件：`packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts:401`（`asBase64Text(row.bytes, \`${adapter.table}.bytes\`)`）、`:408`（warn 文案 `${adapter.table}.${adapter.primaryKeyColumn}`）、`:448`（零进展文案）、`:384-385`（「本轮两表同为 content_hash」过期注释，见 ic-35）；对照 adapter 类型 :102-119、注册表 :129-175（均无 `bytesColumn` 字段）【r2 修订】
- 问题：`chat_message` 的 blob 列真名是 `content_blob`（注册表 :167 用别名映射为 `bytes`），但解码失败告警的 label 拼的是 `${adapter.table}.bytes` → 用户/支持同学按 `chat_message.bytes` 查列会查无此列。另：头注释 :21 说「blob 两表是 WITHOUT ROWID」、:124 说「前两张为 WITHOUT ROWID，chat_message 为常规表」、:367 笼统说「WITHOUT ROWID 表按主键」——三处口径不一，读者会误以为 `chat_message` 也按 `content_hash` / WITHOUT ROWID 语义处理。
- 改法（可执行）：
  1. `BlobTableAdapter` 增 `bytesColumn: string` 字段：两张 blob 表填 `"bytes"`、`chat_message` 填 `"content_blob"`。
  2. 解码失败 label 与 warn 文案改用 `${adapter.table}.${adapter.bytesColumn}`（:401、:408）。
  3. 三处 `WITHOUT ROWID` 注释统一为：「前两张 `WITHOUT ROWID` 表按主键列（`content_hash`）游标分批；`chat_message` 为常规表，按主键 `id` 游标」。
- 验收/测试：core 用例——`chat_message` 插 1 行坏 base64 → 跑归一 → 捕获 warn 文案，断言含 `chat_message.content_blob`、不含 `chat_message.bytes`。
- 来源：`review-scope-integration-core/B-09`

### ic-16 [P2] 出口注释残影：`db-maintenance/index.ts` 头注释未提三表注册、主入口「`./compaction` 已被占用」读起来像临时状态

- 维度：F（注释）+ K（文档同步）
- 文件：`packages/core/src/infra/db-maintenance/index.ts:1-6`（头注释）；对照 `docs/Iterations/message-content-compression/spec.md:83-84`（「不新增 exports 子路径：`./compaction` 已被上下文旧裁剪域占用」的临时口吻）
- 问题：头注释只列「两个谓词驱动的后台搬运任务」，未说明适配器注册表已覆盖**三张表**（`vfs_content_blob` / `session_file_cache_blob` / `chat_message`）；「`./compaction` 子路径已被占用所以并入主入口」这类措辞读起来像临时决定，实际是既定出口设计。
- 改法（可执行）：两句注释订正为**既成事实口径**：
  1. 头注释补「适配器注册表覆盖三张表（vfs_content_blob / session_file_cache_blob / chat_message）；压缩任务与 blob 归一均从此出口导出」。
  2. 子路径口径改为「本任务并入主入口 `index.ts` 是既定出口设计（`./compaction` 子路径名已归属历史上下文裁剪域，不新增子路径）」。
- 验收/测试：无需新用例；docs 复检 + `tsc` 通过。
- 来源：`review-scope-integration-core/B-10` ≡ SD

### ic-17 [P2] CLI 双任务各 60s 预算最坏 120s 未注明 + 「顺带归一压缩新写入的行」顺序理由与实现相反

- 维度：F（注释）+ K（文档同步）
- 文件：`apps/cli/src/runtime.ts:184-191`（「放在压缩之后——顺带归一压缩任务新写入的行」；两任务均未注明最坏合计耗时）
- 问题：注释顺序理由与 **A2 后的事实相反**：压缩任务恒写二进制 BLOB（`encodeMessageContent` 无平台分支），**不可能**产出命中归一谓词（`content_encoding = 'zlib-b64'` 或 `'zlib' + TYPEOF = 'text'`）的行，所以「顺带归一压缩新写入的行」不成立；两条谓词互不越界才是真实关系。另：两条任务各 60s 同步预算，最坏情况 CLI 命令被阻塞约 120s，注释未注明。
- 改法（可执行）：注释改为「两任务各 60s 预算、最坏合计约 120s；命令进程短命，残余由下次命令/双端启动续跑；**顺序无功能依赖**——压缩谓词（`content_json != ''`）与归一谓词（blob 形态）互不越界，A2 后压缩恒写二进制、不产出待归一行」。可选「共享剩余预算」方案作为登记项写进 spec 风险段（不阻塞本条）。
- 验收/测试：无需新用例；注释复检。
- 来源：`review-scope-apps/B-10` ≡ `review-scope-mcdev-core/B-10` ≡ `review-scope-integration-core SD-4`（三方合并）

### ic-18 [P2] 两端着色不一致：mobile 有 success 色、desktop 只有 warning + `#a60` 硬编码第三套色

- 维度：J（UI）
- 文件：`apps/desktop/renderer/features/settings/SettingsViews.tsx:149`（`MigrationRowValue` 只有 `{ text, warning }` 两态）、`:629-630`（`color: value.warning ? "var(--warning, #a60)" : ...`）；对照 `apps/mobile/src/screens/stack/StorageConfigScreen.tsx:35-38`（tone 三态 `default | success | warning`）、`:162-170`（颜色映射走 `tokens.success/warning/text`）
- 问题：mobile 的「已完成」有 success 色、desktop 的「已完成」无着色；desktop 对 warning 用了 `var(--warning, #a60)` 兜底——`#a60` 是第三套色值，两主题已定义 `--warning`，兜底只会让主题外泄（与 A1 cr-17 的类名问题同区，搭车修）。
- 改法（可执行）：
  1. desktop `MigrationRowValue` 增 `tone: "default" | "success" | "warning"` 三态，对齐 mobile；`migrationRowValue` 各分支返回对应 tone（已完成 → success；第三态 → warning；进行中/未取到 → default）。
  2. 渲染处删 `#a60` 兜底，改 `tone === "success" ? "var(--success)" : tone === "warning" ? "var(--warning)" : "inherit"`（与同文件既有 tokens/主题变量一致）。
- 验收/测试：`apps/desktop/test/settings-db-maintenance-ui.test.ts` 源码契约补——断言源码含 `tone` 三态分支、不含 `#a60`；与 cr-17 的类名断言可合并同一条用例。
- 来源：`review-scope-apps/B-05`（搭车 cr-17）

### ic-19 [P2] mobile 压缩调度缺 runtime 身份去重，「重复调度无副作用」注释不实

- 维度：C-orch + B（正确性）
- 文件：`apps/mobile/src/services/message-content-compaction.service.ts:34-64`（`scheduleMobileMessageContentCompaction` 无去重；两条循环各跑一次**无去重的维护** = 两次 VACUUM）；头注释 :7（「RN 侧任务编码走 zlib-b64（codec 运行时探测）」事实残影）；`apps/mobile/src/runtime/novel-master-context.tsx:229-233`（调用点「重复调度无副作用」注释——随本条的 runtime 身份去重改造一并改口径，见 ic-34）【r2 修订】
- 问题：`scheduleMobileMessageContentCompaction` 每次调用都起一条新循环，没有 runtime 身份去重（对照 blob 归一版 `blob-binary-normalization.service.ts:37-38` 的 `scheduledRuntime`）——effect 重跑两次就两条循环，收尾维护各触发一次（叠加 ic-01 的直调问题就是两次 VACUUM）。头注释的 zlib-b64 说法在 A2 后已不成立（写侧无平台分支）。
- 改法（可执行）：
  1. 照 A1 版抄 `scheduledRuntime: MobileNovelMasterRuntime | undefined` + `if (scheduledRuntime === runtime) return;` 身份去重；新 runtime 允许重挂。
  2. 头注释改实际口径：「同一 runtime 重复调度不叠加循环；retry 换新 runtime 时对新连接重挂一次」，并删/改「RN 侧任务编码走 zlib-b64」残影（写侧恒二进制 zlib）。
- 验收/测试：mobile 用例——同一 runtime 连调两次调度只起一条循环（探针计数）；换新 runtime 后允许重挂。
- 来源：`review-scope-apps/B-06` ≡ `review-scope-integration-core/OQ-5`（合并）

### ic-20 [P2] 两端云同步三条路径绕过 busy 包装：底层 export/import 期间 busy 恒 false（mobile + desktop 双端确定项）【r2 修订】

- 维度：B（正确性）+ C-orch
- 文件：
  - mobile：`apps/mobile/src/services/cloud-sync.service.ts:203-224`（三个调用点：:206 `exportDatabaseBackupToPath`、:216 `importDatabaseBackupFromBytes`、:222 `importDatabaseBackupFromPath`）；`apps/mobile/src/services/db-backup.service.ts:98-110`（export 底层）、`:116-150`（import 底层，含「关连接 + 覆盖库文件」窗口）、`:175-194` 与 `:201-224`（busy 包装只在**上层备份流程** `exportDatabaseBackup` / `importDatabaseBackup`；**r2 订正**：原写 `pickAndExportDatabaseBackup` / `pickAndImportDatabaseBackup`，与 head 函数名不符）
  - desktop（**r2 升为确定项**）：`apps/desktop/src/main/services/db-backup.service.ts:63-75`（`exportDatabaseBackupToPath`）、`:81-110`（`importDatabaseBackupFromPath`）、`:116-144`（`importDatabaseBackupFromBytes`）**三个底层函数均不置 busy**；`apps/desktop/src/main/services/cloud-sync.service.ts:392-407`（`dbSync` 三路径直调上述底层函数）；对照 `apps/desktop/src/main/services/db-maintenance.service.ts:110-128`（busy 只在**手动清理** `runDbMaintenance` 置位/复位）
- 问题（r2 核实）：mobile 侧 busy 置位只包在上层备份流程里，云同步直接调底层函数 → 「关连接 + 覆盖库文件」窗口期间 `isMobileDbMaintenanceBusy()` 恒 false，压缩后台循环（守卫只看该标志）可能正好在窗口内写库/跑维护，云同步「与数据清理互斥」在 mobile 实际不成立（apps SD-1）。**desktop 侧同病已核实为真问题**：`setDesktopDbMaintenanceBusy` 全仓只有手动清理一处置位，三个底层函数与云同步三路径全程不置 busy（【r3 订正】`rebootstrapDesktopRuntime` 仅发生在备份导入与云同步 pull 两类路径——`backup.ts:40` / `cloud-sync.ts:81`【r4 补注：另有无库替换的手动重引导端点 `bootstrap.ts:25`，不涉库文件覆盖、不影响本条时序结论】；push 不伴随 rebootstrap，但同样直调底层函数、互斥缺口同在）——两端压缩/归一循环的守卫读到的都是 false。
- 改法（推荐**下沉**，可执行，两端同款）：
  1. mobile：把 `setMobileDbMaintenanceBusy` 从上层包装**下移**到 `exportDatabaseBackupToPath` 与 `importDatabaseBackupFromPath` 两个底层函数，保证所有调用方（含云同步三路径）都被覆盖；**【r4 修订】上层包装的置位保留为外层 acquire（计数配对，不是幂等空操作），在 rebootstrap 完成之后 release（见第 3 步）——不得按「去掉外层置位」字面执行，否则重建窗口无人计数、外层 release 变成无配对 release**。
  2. desktop（确定项）：把 `setDesktopDbMaintenanceBusy` 同样下沉到 `exportDatabaseBackupToPath` / `importDatabaseBackupFromPath` / `importDatabaseBackupFromBytes` 三个底层函数，覆盖云同步三直调路径。
  3. **时序限定与选型（r2 补，r3 定稿）**：busy 置位下沉到下层后，**下层 try/finally 会早于最外层的 `onRebootstrap()` 清位**（mobile `importDatabaseBackup` 在 try 内先 `await importDatabaseBackupFromPath` 再 `onRebootstrap()`，见 `db-backup.service.ts:219-220`；desktop 的 `rebootstrapDesktopRuntime` 在 IPC handler `backup.ts:40` / `cloud-sync.ts:81`【r3 订正：rebootstrap 仅发生在备份导入与云同步 pull，push 路径无】，都在底层函数返回之后）——即「库文件已替换、连接仍处重建窗口」的最危险段会提前解除互斥。**选型默认【r3 定稿】：「计数 / 令牌配对」**——底层函数入口 acquire、出口 release 自平衡（直接调底层「期间 true、结束后 false」天然成立），最外层流程（mobile 上层包装、mobile `pullCloudSync`（`cloud-sync.service.ts:293-345`，`onRebootstrap()` 在 `:323`）【r4 修订：原引 `:203-224` 是 dbSync 回调对象、不含 rebootstrap 调用点；push 无 rebootstrap，由底层 acquire/release 覆盖】、desktop `backup.ts:40` / `cloud-sync.ts:81` 各调用路径）在进入时 acquire、**rebootstrap 完成之后** release（含重建窗口的完整互斥）；计数语义下多个调用方嵌套不互相提前清位。备选「清位只由最外层一次」只有在把验收收窄为「直接调底层仅断言期间 true、结束后 false 只对最外层流程断言」时才可采用。注释同步：「busy 为计数/令牌配对：底层 acquire/release 自平衡，外层流程在 rebootstrap 完成后 release，所有调用路径在完整窗口内互斥」。【r2 修订】【r3 修订】
- 验收/测试：
  - mobile 用例——直接调 `exportDatabaseBackupToPath` / `importDatabaseBackupFromPath` 期间采样 `isMobileDbMaintenanceBusy() === true`，结束后 false（当前为红）。
  - desktop 用例（**r2 新增**）——直接调 `exportDatabaseBackupToPath` / `importDatabaseBackupFromBytes` 期间采样 `isDesktopDbMaintenanceBusy() === true`，结束后 false（计数/令牌配对语义下天然成立）；再补一条：经 `importDatabaseBackupFromPath` + 模拟 `rebootstrapDesktopRuntime` 的最外层流程中，采样点落在 rebootstrap 完成**之前**时应为 true、**之后（外层 release 后）**为 false（钉住「外层在 rebootstrap 完成后 release」的时序）。【r2 修订】【r3 修订】
- 来源：`review-scope-apps/B-07`（apps SD-1）；**r2 升级**：desktop 侧由「同理核对」升为确定修改项（`review-full-int`）

### ic-21 [P2] mobile blob 归一循环不认新加的 busy 标志 + 头注释仍断言「mobile 没有 busy 标志」

- 维度：F（注释）+ B（正确性）
- 文件：`apps/mobile/src/services/blob-binary-normalization.service.ts:14-17`（头注释「本仓 main 上 mobile 侧**没有**维护/备份/云同步的 busy 互斥标志」——已过期，`db-maintenance-busy.ts` 已存在并被压缩循环消费）、`:57-60` 与 `:65-67`（守卫只挂 `isMobileAgentActive()`）
- 问题：A1 后 mobile 已新增 `isMobileDbMaintenanceBusy`（数据清理/导入导出互斥），blob 归一循环两处守卫都只看 Agent → 数据清理 VACUUM 期间归一的逐行短事务仍会抢连接；头注释把「没有 busy 标志」当现状写死，误导后续维护者。
- 改法（可执行）：
  1. 守卫两处（循环顶与 `shouldPause` 回调）改为 `isMobileAgentActive() || isMobileDbMaintenanceBusy()`（import 从 `./db-maintenance-busy`）。
  2. 头注释「将来 mobile 补上 busy 标志时……追加一个 `||` 即可」改为现状口径：「已接入 `isMobileDbMaintenanceBusy()`（数据清理/备份/云同步互斥），与压缩循环同一守卫口径」。
- 验收/测试：mobile 用例——置 busy 后归一循环暂停（零搬运），复位后恢复；source 契约或单测断言守卫组合含两个条件。
- 来源：`review-scope-apps/B-08`

### ic-22 [P2] 两端源码契约测试无牙齿（独立正则拼字面量、desktop 只钉常量不钉分支）+ handler 层零覆盖新字段与兜底分支

- 维度：G（测试）+ B（正确性）
- 文件：
  - `apps/mobile/__tests__/storage-config-screen-source.test.ts:85-104`（迁移卡片用例：正则拼字面量）、同文件 `:4`（文件头注释仍写「四区顺序」，实际已是五区）、`:22`（标题已是五段顺序）
  - `apps/desktop/test/settings-db-maintenance-ui.test.ts:81-96`（只钉常量/字面量，不钉 `migrationRowValue` 的分支行为）
  - `apps/desktop/test/db-maintenance-handlers.test.ts`（新字段 `messageCompaction` 贯通与采样抛错兜底零覆盖）
- 问题：两端源码契约测试靠「正则拼源码字面量」，改缩进/换引号就假绿或假红，且测不到分支行为（null→'—' / done→已完成 / 进行中 / failedCount→第三态）；desktop handler 层对新字段与 ic-04 的兜底分支无覆盖。
- 改法（可执行）：
  1. 把 `migrationRowValue`（desktop）与 `messageCompactionValue`（mobile）抽为**可导出纯函数**，测试直接 import 喂四组夹具断言：`dbStats=null` → `'—'`；`done` → 「已完成」；`!done` → 「进行中（剩余 N 条）」；`done && failedCount > 0` → 「已完成（N 条需人工处理）」。
  2. `db-maintenance-handlers.test.ts` 补：返回体 `messageCompaction` 字段贯通；采样 `getMessageCompactionStatus` 抛错时 `messageCompaction === null` 且 `fileBytes` 仍在（ic-04 的回归防护）。
  3. 修 `storage-config-screen-source.test.ts:4` 的过期标题/注释「四区顺序」→「五区顺序（存储空间 → 云端配置 → 数据清理 → 导出 → 导入）」。
- 验收/测试：四组纯函数夹具全绿；把任一渲染分支写错（如 null 分支返回「进行中」）对应夹具变红。
- 来源：`review-scope-apps/B-09`

### ic-23 [P2] mobile 指标卡不轮询：长耗时搬运期间进度停在进页快照，与「后台自动整理」文案矛盾

- 维度：J（UI）+ C-orch
- 文件：`apps/mobile/src/screens/stack/StorageConfigScreen.tsx:177-182`（`useFocusEffect` 只在进页采样一次）、`:199-202`（文案「后台自动整理存量数据（压缩与二进制化），期间可正常使用」）；对照 desktop `SettingsViews.tsx:249-252`（2s 轮询）
- 问题：长耗时搬运期间用户停在存储页看「进行中（剩余 N 条）」，数值永远不动（进页快照），与「后台自动整理、期间可正常使用」的文案预期矛盾；desktop 有 2s 轮询、mobile 没有。
- 改法（二选一，**默认 A**）：
  - **A（默认）** `useFocusEffect` 内加 3~5s `setInterval` 调 `refreshMaintenanceStats`，cleanup 里 `clearInterval`（并用同一 cleanup 覆盖失焦/卸载）。
  - **B** 文案改「离开页面再进入可刷新」+ 增加手动刷新入口。
  - source-test 随所选方案补断言（A：含 `setInterval` 与 `clearInterval`；B：文案与刷新入口存在）。
- 验收/测试：A 方案——mock 两次采样返回值不同，advance timer 后 UI 值更新；失焦后 interval 被清。
- 来源：`review-scope-apps/B-11`

### ic-24 [P2] `chat_message` 缺第三形态（zlib + base64 文本脏形态）读回用例，T-C2 标题「三形态兼容」名不副实

- 维度：G（测试）
- 文件：`packages/core/test/chat/message-content-codec-roundtrip.test.ts:129-151`（T-C2 标题「写侧无平台分支——encode 恒二进制 zlib；存量 zlib-b64 行读回等价（**三形态兼容**）」；实际只覆盖了 `zlib-b64` 文本一种存量形态）
- 问题：A2 的真机脏形态是「`content_encoding='zlib'` 但 `content_blob` 存的是 base64 文本」（归一谓词第二 disjunct `TYPEOF(content_blob) = 'text'` 专为它存在），T-C2 标题承诺三形态（空/NULL 明文、zlib 二进制、zlib-b64 文本）但缺第三形态的读回用例。
- 改法（可执行，二选一）：
  - **A（默认）** T-C2 内补第三形态子段：手工 `UPDATE chat_message SET content_json='', content_encoding='zlib', content_blob=<base64 文本>` → `repo.findById` 读回与原文等价。
  - **B** 新增独立对齐用例（T-C2b），标题「zlib 脏形态（base64 文本）读回等价」。
- 验收/测试：读路径对第三形态还原原文；把读分支里 `TYPEOF/text` 判定删掉 → 新用例红。
- 来源：`review-scope-core-tests/G-06`（T-BB3 三表口径）

### ic-25 [P2] T-C8「模拟杀进程」实为 `syncBudgetMs:0` 预算耗尽（批间中断），批内第 k 行中断的幂等缝零覆盖

- 维度：G（测试）
- 文件：`packages/core/test/infra/message-content-compaction.test.ts:148-178`（T-C8：预算 0ms，第一批 100 行整体搬完后中断）
- 问题：现有「可重入」用例只覆盖**批间**中断（一批完成、预算耗尽返回），没覆盖**批内第 k 行**事务抛错的中间态（单行短事务提交到一半失败、剩余行留待重启）——这是幂等承诺最需要保护的那条缝（SD-6 同类新实例）。
- 改法（可执行）：新增连接替身用例——包一层 `tx.execute`，在第 50 行（批次大小 100，属第一批）抛异常；断言：
  1. 前 49 行已压缩可读（`content_encoding='zlib'`、`TYPEOF='blob'`），
  2. 第 50 行明文可读（读路径双形态），
  3. 「重启」（再次调用 `runMessageContentCompaction`）后收敛：谓词清零、标记已置、全部行读回原文。
- 验收/测试：用例当前实现下应绿（幂等性已由单行短事务保证）——它钉的是**回归保护**；反向：把 UPDATE 改成非幂等（如去掉 `AND content_json != ''`）时用例红。
- 来源：`review-scope-core-tests/G-07`（SD-6 同类新实例）

### ic-26 [P2] perf 文件用例 2 的标记状态自管（防御性加固）：把 `=== 100` 的隐式前提显式化【r2 修订】

- 维度：G（测试）
- 文件：`packages/core/test/chat/message-content-perf-threshold.test.ts:72-101`（用例 2 直接 `runMessageContentCompaction` 并断言 `compactedCount === 100`，无清标记前置；文件内无 `clearDoneMarker` 助手）
- 问题（**r2 改写前提**）：原问题描述（「用例 1 可能置标记或留明文行致用例 2 假红」）与 head 不符——用例 1 只 `batchInsert` + `listBySessionTail`，**不碰标记、不跑压缩**；fixture 每文件独立连接/独立库，两用例本身不跨文件串状态。本条降级为**防御性加固**：用例 2 的 `=== 100` 依赖「标记未置 + 恰 100 行明文」这一隐式前提，一旦将来用例 1 引入压缩调用（或本文件再扩用例），该前提会被静默改变——用显式 `clearDoneMarker` 声明用例自管标记状态，把前提钉进代码而不是靠用例次序侥幸。
- 改法（可执行，保留）：用例 2 开头加 `clearDoneMarker()`（在本文件新增同名助手：`DELETE FROM kkv_entry WHERE module = ? AND key = ?`，常量从 core 主出口或相对路径导入），并加前置条件注释（「用例自管标记状态——本文件其它用例将来若引入压缩调用不得依赖本用例的标记初值；共享库约定下先清完成标记再断言」）。
- 验收/测试：单独跑用例 2（`--test-name-pattern`）绿；交换两用例顺序仍绿。
- 来源：`review-scope-core-tests/G-08`；**r2 复核**：原前提与 head 不符，改按防御性加固口径（`review-full-int`）

### ic-27 [P2] `resetNormalizationState` 的 `chat_message` DELETE 未限定 `id LIKE 'bb-msg-%'`（全表无差别删）

- 维度：G（测试）
- 文件：`packages/core/test/infra/blob-binary-normalization.test.ts:67-76`（:71 `DELETE FROM chat_message WHERE ${MESSAGE_PREDICATE}`）
- 问题：该 DELETE 按谓词删 `chat_message` 全部命中行，不限定本测试文件的前缀（其它用例/其它测试文件的 `bb-msg-` 前缀约定未被遵守）——「T-BB4 空表前提」可能被远处用例的数据破坏，用例间相互污染。
- 改法（可执行）：`DELETE FROM chat_message WHERE ${MESSAGE_PREDICATE} AND id LIKE 'bb-msg-%'`，注释写明「只清本文件前缀夹具，避免越界影响共享库其它用例」；核对本文件插入的 `chat_message` 夹具确实都用 `bb-msg-` 前缀（没有则统一前缀）。
- 验收/测试：在共享库里先插一条非 `bb-msg-` 前缀的谓词命中行，跑本文件用例后该行仍在。
- 来源：`review-scope-core-tests/G-09`

### ic-28 [P2] schema 慢路径未断言补列带 CHECK 值域（防 align SQL 与 DDL 漂移）+ `rawCompressionColumns` 把 `''` 与 NULL 归一成同一值

- 维度：G（测试）
- 文件：`packages/core/test/bootstrap/message-content-compression-schema.test.ts`（慢路径用例 :43-112；只断言列存在，未断言 CHECK 约束）；`packages/core/test/chat/message-content-codec-roundtrip.test.ts:71-93`（`rawCompressionColumns` 的 `contentJson: String(row.content_json ?? "")` 把 `''` 与 NULL 归一成 `''`）
- 问题：① ALIGN 补列 SQL（`schema-column-alignments.ts:164`）带 `CHECK (content_encoding IN ('zlib','zlib-b64'))`，但慢路径只测「列在」——align SQL 与 canonical DDL 漂移（值域放宽/收紧）测不出来；② `rawCompressionColumns` 归一 `''`/NULL，测试断言 `contentJson === ''` 无法区分「已压缩行」与「NULL 行」，弱化了「压缩后 content_json 应为空串而非 NULL」的契约。
- 改法（可执行）：
  1. 慢路径补断言：`INSERT ... content_encoding='gzip'` 被 CHECK 拒绝（`assert.rejects`）；合法值 `'zlib'` / `'zlib-b64'` 可插入。
  2. `rawCompressionColumns` 的返回形状改 `{ ..., contentJson: string | null, isNull: boolean }`（或严格 `String(row.content_json)` 不 `?? ""`），断言点用 `contentJson === ''`（严格空串）或 `isNull === false`。
- 验收/测试：把 ALIGN 补列 SQL 的 CHECK 删掉 → 第一条断言红；把写路径改为写 NULL → 第二条断言红。
- 来源：`review-scope-core-tests/G-10`

### ic-29 [P2] message-search 用例标题/注释仍写「LIKE 转义 / LIKE 召回」（实现已无 LIKE）+ 缺「命中数 > limit 恰返回 limit 条」新语义用例

- 维度：G（测试）+ F（注释）
- 文件：`packages/core/test/chat/message-search.test.ts:158-159`（T-CS2 标题「仓储 LIKE 召回…」）、`:282-283`（T-CS9 标题「LIKE 转义（keyword 含 % _ \ 不触发通配）」——实现已改为内存精筛，无 LIKE）
- 问题：标题/注释停留在旧实现（SQL LIKE 粗筛），误导后续维护者；且新语义「keyword 命中数 > limit 时 SQL 不 LIMIT、由内存精筛后 `slice(0, limit)` **恰返回 limit 条**」没有专门用例（旧语义是「SQL 先 LIMIT 再精筛，可能不足 limit」）。
- 改法（可执行）：
  1. 订正 T-CS2 / T-CS9 标题与注释为「内存精筛召回」「`% _ \` 按字面匹配（无 LIKE 通配）」等现状口径。
  2. 新增用例：100 条命中 keyword、`limit: 10` → 断言恰返回 10 条、seq 为 99..90（`seq DESC` 最新 10 条）。
- 验收/测试：新用例在「SQL 先 LIMIT 再精筛」的旧实现下会红（返回可能不足 10 条）——同时闭合 tests SD-E 的「message-search 未审」缺口。
- 来源：`review-scope-mcdev-core/B-12`

### ic-30 [P2] `batchInsert` 逐条同步压缩：fork/copy 大会话主线程压缩 5300 次

- 维度：B（正确性·性能）
- 文件：`packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:352-362`（`batchInsert` 构造 `messages.map(toMessageParams)`——`toMessageParams` 内逐条 `encodeMessageContent` 同步压缩，无让步）
- 问题：fork/copy 大会话（5000+ 条）时主线程同步压缩 5000+ 次（`conn.batch` 之前），desktop main / RN JS 线程长时间无让步。改动前（无压缩）无此成本，属 A2 引入的新热点。
- 改法（**默认 A**）：压缩/参数构造阶段分片——200 条一片，每片构造完 `await this.yieldFn?.()`（无 `yieldFn` 时退化同步，desktop/cli 零行为变化；mobile 已有 `messageParseYield` 注入）。
- 验收/测试：传入计数 `yieldFn` 的仓储，`batchInsert` 500 条 → 断言 yieldFn 被调用 ≥2 次；无 yieldFn 时行为与现状逐字节一致（既有用例通过）。
- 来源：`review-scope-mcdev-core/B-13`

### ic-31 [P2] service 层二次精筛后不再 `slice(limit)`：换 port 实现会超量返回

- 维度：B（正确性·契约）
- 文件：`packages/core/src/service/chat/impl/message.service.ts:431-448`（:447 `return candidates.filter(...)` 无 slice；仓储实现当前已在内存精筛并 slice，但 port 合同允许其它实现退回超集召回）
- 问题：service 层重筛（幂等、对已精筛结果零开销）后不截断——未来换一个「退回超集召回」的 port 实现时，service 层会把超量结果直接交给 UI（limit 失效）。
- 改法（**默认防御性一行**）：`return candidates.filter((msg) => messageMatchesKeyword(msg, keyword)).slice(0, Math.max(1, Math.floor(query.limit)));`（与仓储层 `clampedLimit` 同口径，避免负数/浮点）。
- 验收/测试：超集假仓储（返回 10 条、limit 5）→ service 返回 ≤5 条。
- 来源：`review-scope-mcdev-core/B-14`

### ic-32 [P2] 压缩与归一双任务并发：若某端驱动把二进制绑成 TEXT，压缩产出行可能落在归一已置标记之后永不被处理

- 维度：K（文档同步）+ B（正确性·风险登记）
- 文件：`packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts`（文件头风险段）+ `docs/Iterations/binary-blob-and-vfs-pack/spec.md`（风险段）
- 问题（理论态）：压缩任务恒写 `content_encoding='zlib'` + 二进制 BLOB；若某端驱动有 bug 把二进制绑成 TEXT 存回（归一谓词第二 disjunct 针对的正是这种历史脏形态），而 blob 归一的 `messageContentDone` 标记已置（该表已完成短路），这批新写入的脏行**永不会被归一处理**（除非用户手动清标记）。
- 改法（**默认 A：登记已知限制**）：compaction 文件头 + binary-blob spec 风险段写明「压缩任务写出的 `zlib` 行若因驱动缺陷落成 TEXT 形态，归一任务在 `messageContentDone` 已置时不会自动重扫；兜底手段：手动清 `messageContentDone`（KKV module `nm-blob-binary`）触发重扫」。可选 B（不做）：归一对 `messageContent` 表不认完成标记、每次都扫谓词（成本高，会牺牲稳态零成本，不推荐）。
- 验收/测试：文档 diff 复检可 grep 到该风险与兜底手段；无代码用例。
- 来源：`review-scope-mcdev-core/B-15`（理论态）

### ic-33 [P2] 死导出 `escapeLikePattern`：LIKE 粗筛废弃后生产消费方归零（与 ic-13 同族）【r2 新增】

- 维度：C（质量·死出口）
- 文件：
  - 定义：`packages/core/src/domain/chat/content/message-content-match.ts:13`
  - 主 public 入口导出：`packages/core/src/public/chat.ts:117`（`export { escapeLikePattern } from ...`）
  - 唯一自测：`packages/core/test/chat/message-search.test.ts:69-73`（从 `../../src/...` 相对路径 import，**不经** public 入口）
  - 快照登记：`packages/core/test/package-exports/snapshots/public-chat-allowlist.json:63`
- 问题：仓储搜索改为内存精筛后 LIKE 粗筛已废（`sqlite-message.repository.ts:441-443` 注释即证），`escapeLikePattern` 的生产消费方归零——全仓只剩「主入口导出 + 一条自测 + 快照登记」三个死消费面。与 ic-13（`MESSAGE_COMPACTION_KKV_*` 死出口）同族、同一处置纪律：内部工具不应固化为 public API 后又无人消费。
- 改法（二选一，**默认 A（撤）**，与 ic-13 同口径）：
  - **A（默认）** 从 `packages/core/src/public/chat.ts:117` 撤出导出；`public-chat-allowlist.json` 删除 `:63` 快照项；`message-search.test.ts:69-73` 的自测随撤导出删除或改为仅内部路径可测；**【r3 补】连带清理两处**——`message-search.test.ts:18` 的 import 行与 `:344` 的注释引用（撤除定义本体时若不同步清理，import 编译错、注释失真）。若撤导出后**定义本体也全仓零消费**，一并从 `message-content-match.ts` 删除；若保留作内部工具，则自测可留但不经 public 入口。
  - **B** 保留 public 导出，在定义处加注释写明「预留：外部端可能复用 LIKE 转义」并保持快照（不推荐——当前语义已无 LIKE，出现即误导）。
- 验收/测试：`git grep "escapeLikePattern"` 撤后**只剩定义处或为空**（不再有 public 导出行与 allowlist 行）；`pnpm -C packages/core test` 的 package-exports 快照用例绿（快照已同步删）。反向：误留 public 导出 → 快照用例与 grep 判据均红。
- 来源：`review-full-int/新-1`

### ic-34 [P2] `novel-master-context.tsx` 调用点注释「重复调度无副作用」需随 ic-19 去重改造改口径【r2 新增】

- 维度：F（注释）
- 文件：`apps/mobile/src/runtime/novel-master-context.tsx:229-233`（调用点注释「retry 换新 runtime 时对新连接重新挂一次，旧循环随旧连接失效自然终止——任务谓词幂等，重复调度无副作用」+ :233 `scheduleMobileMessageContentCompaction(runtime)`）
- 问题：该注释把「重复调度无副作用」当现状写死，与 ic-19 落地后的实际口径不符（去重改为 runtime 身份去重：同一 runtime 重复调度不叠加循环、换新 runtime 才重挂一次）；且在 head 无去重时，effect 重跑本就**会**叠加第二条循环，注释本身已是不实陈述。
- 改法：补进 ic-19 的文件/注释清单，随 ic-19 的去重改造一并改为实际口径——「同一 runtime 重复调度不叠加循环（runtime 身份去重）；retry 换新 runtime 时对新连接重挂一次，旧循环随旧连接失效自然终止」。
- 验收/测试：随 ic-19 的用例与注释复检（无独立用例；ic-19 的「同一 runtime 连调两次只起一条循环」探针用例即为该注释的判据）。
- 来源：`review-full-int/新-2`（**执行并入 ic-19**）

### ic-35 [P2] `blob-binary-normalization.ts:384` 过期注释「本轮两表同为 content_hash」【r2 新增】

- 维度：F（注释）
- 文件：`packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts:384-385`（「主键列名由适配器给出（**本轮两表同为 content_hash**）」）
- 问题：A2 把 `chat_message`（主键 `id`）接入适配器注册表后，该注释的「两表同为 `content_hash`」已过期，读者会误判第三张表的游标列。
- 改法：并入 ic-15 的注释清单同批改——「主键列名由适配器给出（blob 两表 `content_hash`、`chat_message` 为 `id`）」。
- 验收/测试：随 ic-15（注释复检，无独立用例；与 ic-15 的三处 `WITHOUT ROWID` 口径统一一并核对）。
- 来源：`review-full-int/新-3`（**执行并入 ic-15**）

### ic-36 [P2] 【既有 cr-fix-spec 条目修订清单——执行面在姊妹文档 `docs/Iterations/binary-blob-and-vfs-pack/cr-fix-spec.md` 上】

- 维度：K（文档同步）+ G（测试矩阵）
- 文件：`docs/Iterations/binary-blob-and-vfs-pack/cr-fix-spec.md`（**本节点不改；由下游在执行对应条目时同步修订**）
- 问题：A2 把第三张表 `chat_message` 接入适配器注册表后，姊妹文档多条既有条目的「两表」口径与验收夹具已不完整（chat_message 是最大表、形态与两张 `WITHOUT ROWID` 表不同）；部分条目指向的符号/措辞在集成分支已演进，需改写或关单。
- 改法（执行面在姊妹文档，逐项落）：
  - **a.** `cr-01` / `cr-02` / `cr-24` 的夹具与验收从两表**扩到三表**（含 `chat_message`）；`cr-02` 补「`chat_message` 前 100 条 id 全坏」专门用例（A2 三表口径）。**`cr-35` 单独改法【r2 修订】**：其正文是不变量注释 + 用例标题 + `updateCount` 断言（无自身「两表」夹具，原写「夹具与验收扩三表」不成立）→ 改为「**(b) 用例引用与反向判据随三表扩写同步**」——若 `cr-01`/`cr-02`/`cr-24` 的夹具扩三表，cr-35 验收段引用的 (a)/(b) 用例名与「把 `allKnownFailed` 改回 `break` → (b) 变红」的反向判据跟着同步。
  - **b.** `cr-09` / `cr-10` 验收的「两表」扩三表。
  - **c.** `cr-16` 第 3 条措辞已部分执行（`ipc-types` 注释已随 cr-06 改过一半），需改写为现状口径。
  - **d.** `cr-18` 的目标 `formatBlobBinaryStatus` 已被 `migrationRowValue` 取代（desktop SettingsViews.tsx:152-177）——改写为「**已消解关单**」。
  - **e.** `cr-27` 的 `deepEqual` 清单**从「既有 2 处」改为「以 `grep -n` 实测清单为准」【r2 修订】**：core `packages/core/test/infra/blob-binary-normalization.test.ts` **至少 :372 / :415 / :736 / :848 / :871 / :878 六处**（整对象/整数组断言；另有 :401 / :406 / :407 / :612 / :636 / :890 等同文件命中，按同一口径复核）；mobile `apps/mobile/__tests__/db-maintenance.service.test.ts` **:136-145（T-DMM1 全对象，`:138`）与 :160-170（blobBinary 数组，`:166`）两处**（jest 用 `toEqual`）。执行前自行 `grep -n "deepEqual\|toEqual"` 复核，数量以实测为准（原写「core 3 处 + mobile 1 处」与 head 不符）。
  - **f.** `cr-23` 的 T 用例映射补 `chat_message` 适配器与 cr-06 新用例编号。
  - **g.** SD 侧（binary-blob spec）：`:79` 契约行补 `failedCount`；`:249`「两端 UI 预置标签映射」残影订正（int-core SD-1/2）。
- 验收/测试（**r2 收窄，r3 全量化**）：姊妹文档 diff 复检——**只核本文件索引 11 行已并入目标条目**（逐行核对落点与口径一致）；**其余「两表」字样不在本条验收范围**，属 A1 线自审范围，**以 `grep -n "两表"` 实测为准（r3 实测全量 22 处）**：`cr-01 :62/:70/:97/:101/:103`、`cr-02 :123/:148/:150/:154`、`cr-06 :237`、`cr-07 :250/:252/:254`、`cr-09 :279/:280`、`cr-10 :288/:289`、`cr-23 :482`、`cr-28 :555`、`cr-31 :600`、合并后 QA `:725/:727`——其中本索引覆盖到的条目（cr-01/02/09/10 等）执行修订时其行内「两表」随三表化自然改写；未覆盖条目（cr-06/07/23/28/31/QA）的「两表」是否按三表口径改写，由 A1 线执行者按上下文判断，本条不承诺 `grep -c "两表"` 归零。【r2 修订】【r3 修订】
- 来源：`review-scope-integration-core/B-02` + `B-03` + `B-11`（合并）

---

## 既有 cr-fix-spec 条目修订（执行面在姊妹文档上）

本节是 **ic-36 的落点索引**（原 ic-33 顺延）【r2 修订】：以下修订**都写进姊妹文档 `docs/Iterations/binary-blob-and-vfs-pack/cr-fix-spec.md` 的对应条目**（本节点不改它），避免两处条目措辞漂移。执行方式：下游在执行姊妹文档条目时，把下表「修订点」并入该条目的改法/验收段；姊妹文档侧的验收按原条目走，此处只登记。

| 姊妹条目 | 修订点（并入该条目的改法/验收） | 原因/来源 | 关联 ic |
|---|---|---|---|
| `cr-01` | 验收夹具与「三表」口径对齐（`chat_message` 接入后不得再写死两表）；若其 pending 兜底方案与本文件 ic-01 **同构**（各自独立 key，不共享单 key），按 OQ-I2 的统一口径改 | A2 三表口径；OQ-I2 | ic-01 + ic-36a |【r3 修订】
| `cr-02` | 夹具与验收扩到三表；新增「`chat_message` 前 100 条 id 全坏」专门用例 | A2 三表口径 | ic-36a |
| `cr-24` | 夹具与验收扩到三表 | A2 三表口径 | ic-36a |
| `cr-35` | **(b) 用例引用与反向判据随三表扩写同步**（cr-35 正文是不变量注释 + 用例标题 + `updateCount` 断言，无自身「两表」夹具；原写「夹具与验收扩三表」不成立）【r2 修订】 | A2 三表口径 | ic-36a |
| `cr-09` | 验收「两表」扩三表（空库首启断言含 `messageContent` 行） | A2 三表口径 | ic-36b |
| `cr-10` | 验收「两表」扩三表（互不牵连含第三表） | A2 三表口径 | ic-36b |
| `cr-16` | 第 3 条措辞改写（`ipc-types` 注释已随 cr-06 部分执行） | 现状演进 | ic-36c |
| `cr-18` | 目标 `formatBlobBinaryStatus` 已被 `migrationRowValue` 取代 → 改写为「已消解关单」 | 符号演进 | ic-36d |
| `cr-23` | T 用例映射补 `chat_message` 适配器与 cr-06 新用例编号 | A2 三表口径 | ic-36f |
| `cr-27` | `deepEqual` 清单**以 `grep -n` 实测清单为准**：core 至少 :372/:415/:736/:848/:871/:878 六处（另 :401/:406/:407/:612/:636/:890 同口径复核）+ mobile `:138`（全对象）/`:166`（数组）两处（jest `toEqual`）【r2 修订】 | A2 三表口径 | ic-36e |
| （SD 行） | binary-blob spec:79 契约行补 `failedCount`；:249「两端 UI 预置标签映射」残影订正 | int-core SD-1/2 | ic-36g |

**执行纪律**：这些修订的验收一律落在**姊妹文档条目的原文位置**（在其验收段内体现，不新开条目）；若下游发现某一修订与姊妹文档既有措辞互斥，以姊妹文档条目号为落点、以本表为意图来源，并在执行注记中记录取舍。

---

## Spec deviations

以下为四路 scope 评审汇总的 spec 与实现的偏差（**本节点只登记，不改业务 spec**；处置动作标注随行条目或下游文档步骤）。

1. **compression spec 三处仍描述已删除的平台分支**（P0 级文档债，mcdev SD-1）：`message-content-compression/spec.md:26`（「Node 落 zlib、RN 落 zlib-b64；+33% 膨胀、压缩比 2.5~3:1」——A2 已推翻，写侧恒二进制 zlib）、变更点 #4（`:97` `forceZlibB64` 注入点）、`:123`（T-C2 的 RN 分支口径）。三处均需按 A2 实现订正（平台分支已删、`messageContent` 三表接入、非 RN 单测口径）。
2. **compression spec:42 收尾口径停留在直调**（mcdev SD-3 ≡ apps SD-2）：「触发一次 `runDatabaseMaintenance`」需改为 `runStartupMaintenanceOnce` 去重口径 → **随 ic-01 修**。
3. **`SCHEMA_BOOT_VERSION` 最终 17 与撞号裁决未写入 spec**（mcdev SD-2）：spec 仍按 16 叙事（对照 `schema-column-alignments.ts:157` 注释）→ 下游文档步骤；同时随 ic-10 更新代码注释。
4. **compression spec 变更点 #8「stats 增 pending 计数」与实现字段形态不符**（mcdev SD-4）：实现是独立 `getMessageCompactionStatus` + 独立状态采样出口，非「stats 里加字段」；且 IPC 契约波及（`DbStatsResult` 增 `messageCompaction`）未在 spec 登记 → 下游文档步骤。
5. **spec「最终项目结构」仍写 codec 平台分支、未提 `chat_message` 适配器跨迭代耦合**（mcdev SD-5，compression spec:72-84）→ 下游文档步骤。
6. **搜索性能风险评估偏低**（mcdev SD-6）：spec 把搜索成本类比 `listBySession`，但触发频率差一个量级（每次输入即触发）；真机账目无搜索项 → **随 ic-08 / OQ-1**，并在 spec 风险段补登记。
7. **binary-blob spec:249 `messageContent`「两端 UI 预置标签映射」与实现相反**（int SD-1）：实现是「消息正文『去 base64』**不设**状态行」，spec 说已预置标签映射 → **随 ic-36g**。【r2 修订】
8. **mobile compaction service 头注释「RN 侧任务编码走 zlib-b64」事实残影**（int SD-3 ≡ tests OQ-4）→ **随 ic-19** 注释同步。
9. **`blob-binary-normalization.ts:479-480`「多任务叠加不会多次全库 VACUUM」承诺与实现不符**（int SD-5）：compaction 直调绕过去重域，承诺不成立 → **随 ic-01 修**（compaction 换 `runStartupMaintenanceOnce` 后承诺才成立）。
10. **apps SD-1**：compression spec 的守卫描述（写「StorageConfigScreen 的 dbBusy」，实际已下沉为模块级 `isMobileDbMaintenanceBusy`）未同步，且「与云同步互斥」在 mobile 实际不成立（云同步三条路径绕过 busy 包装）→ **随 ic-20** 修实现与文档。

### round-1 其余原始 SD 去向标注（apps / tests 线）【r2 新增】

上列 10 项与 ic-36g（承接 int SD-1/2）已覆盖 mcdev SD-1~6、int SD-1~3/5、apps SD-1/2 的处置；以下为**未在本节单列**的 round-1 原始 apps / tests 线 SD 及两处补充落点的标注（逐条按语义归位）【r3 补全】：

- **apps SD-3** → **已闭合**，落点 **ic-17**（CLI 双任务预算/顺序注释订正）。
- **apps SD-4** → **已闭合**，已被 **ic-21** 包含（mobile blob 归一守卫与头注释口径）。
- **apps SD-5**（DTO「两态口径」注释与 UI 实际三态不符）→ **已闭合**，已被 **ic-04 改法 2** 包含（`MessageCompactionStatusDto` 注释随 null 三态一并订正）。【r3 补】
- **int SD-4**（CLI「顺带归一压缩新写入的行」注释错误因果）→ **已闭合**，与 apps SD-3 同落点 **ic-17**。【r3 补】
- **tests SD-A** → 已被 **ic-24** 包含（T-C2 三形态缺口）。
- **tests SD-B** → 已被 **ic-25** 包含（批内第 k 行中断的幂等缝）。
- **tests SD-C** → 已被 **ic-09** 包含（恒真断言族 A）。
- **tests SD-D** → 已被 **ic-13 / ic-33** 包含（死出口族：`MESSAGE_COMPACTION_KKV_*` 与 `escapeLikePattern`）。
- （tests SD-E「message-search 未审」已在 ic-29 正文注明闭合，不重复登记。）

---

## Open questions / 待拍板

以下 10 项各带**默认动作**：未经主代理/用户显式推翻时，下游按默认动作执行，不阻塞修复波次。正文与条目里的 `OQ-I*` 均指本节编号。

1. **搜索无界扫描口径**（ic-08）：选 A+B（SQL 扫描上限 + keyset 续扫 + desktop 注入 yieldFn）还是 C（仅登记风险）？**默认 A+B**。
2. **compaction 与归一是否共用 `startupMaintenancePending` key、两任务先后完成的补跑语义**（mcdev OQ-3）：**默认共用进程级去重域 + 各自独立 pending key（module 分别为 `nm-message-content` / `nm-blob-binary`，不共享单 key）；清标记以 `runStartupMaintenanceOnce` 返回非 `null` 为条件（对齐 A1 cr-32）**（ic-01 方案 b）。【r2 修订】
3. **死出口 `MESSAGE_COMPACTION_KKV_*`**（ic-13）：撤出主出口还是注释预留？**默认撤**。
4. **`readDoneMarker.at` 去留**（ic-12）：**默认删**（解析结果不保留 `at`；标记值仍写入便于人工排查）。
5. **状态采样节流与索引的组合**（ic-06 ①/②）：**默认先做①节流；索引②随下一轮 `SCHEMA_BOOT_VERSION` bump 一并做**（避免本轮再动 BOOT）。
6. **tdbc 连接级互斥是否覆盖 VACUUM 长事务**（apps OQ-1：mobile 侧收尾 VACUUM 要不要也置 busy）：**默认 core 侧核实互斥覆盖范围后在 ic-01 注释写明结论**（避免在无移动端验证手段前新增 busy 设施）。
7. **「`content_encoding` 非空 ⇒ `content_json = ''`」不变量是否加守护用例**（int OQ-3）：**默认加一条三方守护用例**（e2e fixture / 手写 SQL 场景防回归：压缩行与明文行的两列互斥）。
8. **KKV 写路径总表登记**（mcdev OQ-1）：`nm-blob-binary` ×3（`vfsContentDone` / `fileCacheDone` / `messageContentDone`）+ `nm-message-content/compactionDone` +（若 ic-01 走方案 b）待加 `startupMaintenancePending`——**默认登记进 spec 变更点清单**。
9. **备份导入未完成库时标记随文件走、新库会重新压缩**（apps OQ-5）：**默认在 spec 登记该事实**（不修行为：标记随库文件旅行是幂等设计的一部分）。
10. **生产 bundle 启动崩「Got unexpected undefined」**（int OQ-6 提醒）：发版前置排查项，**留口、不阻塞本 fix-spec**。

### round-1 原始 OQ 去向索引（19 条 → 落点）【r2 新增】

round-1 四路 scope 评审各自提出的 OQ 共 19 条（mcdev OQ-1~4 / int OQ-1~6 / apps OQ-1~5 / tests OQ-1~4），去向逐条核实语义后归位如下（「已并入 ic-XX」= 该 OQ 的处置已写进对应条目的问题/改法/验收；「已闭合」= 核实后无需改动，理由随行）：

| 原始 OQ | 语义（简述） | 去向 |
|---|---|---|
| mcdev OQ-1 | KKV 写路径总表登记 | **OQ-I8**（登记进 spec 变更点清单） |
| mcdev OQ-2 | 搜索扫描口径 | **OQ-I1**（ic-08 方案 A+B/C 拍板） |
| mcdev OQ-3 | 两任务 pending 补跑语义 | **OQ-I2**（共用去重域、各自 pending key） |
| mcdev OQ-4 | `content_encoding` 是否加 CHECK 值域 | **已闭合**——读路径注释核实，不加值域约束（不新增 CHECK） |
| int OQ-1 | 坏行真机路径未覆盖 | **QA-1**（合并后真机人工验证第 1 项，前置 ic-07/ic-15） |
| int OQ-2 | 主入口死出口 | **已并入 ic-13**（`MESSAGE_COMPACTION_KKV_*` 撤除） |
| int OQ-3 | 两列互斥不变量是否加守护用例 | **OQ-I7**（默认加一条三方守护用例） |
| int OQ-4 | `messageContentDone` 标记早置后的新脏行 | **已并入 ic-32**（风险登记 + 兜底手段注释） |
| int OQ-5 | mobile 调度重复挂载/去重 | **已并入 ic-19**（runtime 身份去重） |
| int OQ-6 | 生产 bundle 启动崩提醒 | **OQ-I10**（发版前置排查，留口不阻塞） |
| apps OQ-1 | tdbc 连接级互斥是否覆盖 VACUUM | **OQ-I6**（core 侧核实互斥覆盖范围，结论写进 ic-01 注释） |
| apps OQ-2 | 压缩谓词与归一谓词是否交叠 | **已闭合**——不变量核实：两谓词互不越界（A2 后压缩恒写二进制） |
| apps OQ-3 | `messageContent` 是否设 UI 状态行 | **已并入 ic-14**（有意不设行，口径进 spec） |
| apps OQ-4 | 采样失败兜底口径 | **已并入 ic-04**（兜底改 `null` 三态展示） |
| apps OQ-5 | 备份导入后标记随库文件走 | **OQ-I9**（spec 登记该事实，不修行为） |
| tests OQ-1 | perf 阈值口径 | **已并入 ic-11**（阈值/内容断言口径；OQ 节无独立对应项） |
| tests OQ-2 | 死出口（合并来源，语义见 ic-13 来源行） | **已并入 ic-13**（其来源行已列 `review-scope-core-tests/OQ-2`） |
| tests OQ-3 | 直调绕去重 | **已并入 ic-01**（compaction 换 `runStartupMaintenanceOnce`） |
| tests OQ-4 | mobile 压缩服务头注释 zlib-b64 残影 | **已并入 ic-19 / SD 节第 8 项**（注释同步） |

---

## 已豁免（无）

本轮四路 scope 评审的 47 条原始 must-fix 经去重合并后**全部落入本文件首轮 33 条（原编号 ic-01 ~ ic-33；r2 起**原 ic-33 顺延为 ic-36**、新 ic-33 为 r2 新增的 escapeLikePattern 条目）**，无豁免项；**r2 复检**（`review-full-int`）新增 3 条 P2（`新-1` ~ `新-3`，落为 ic-33 ~ ic-35），原 ic-33 顺延为 ic-36——**总条目数 36 = 1×P0 + 10×P1 + 25×P2，覆盖 ic-01 ~ ic-36**。【r2 修订】【r3 修订】原始条目号 → ic 编号的映射见各条「来源」行（六条同根因合并的 ic-01、三方合并的 ic-17、四条合并的 ic-02 等均已在小节标题或来源中注明）。

---

## 合并后 QA（manual_user）

以下三项在 fix-spec 执行完毕、自动化用例全绿后**仍需真机人工验证**（自动化不可达或覆盖不足）：

1. **坏 base64 消息行真机路径**：真机走一条「坏 base64 消息行」路径（开发机手工造脏行后启动 app），验证状态行第三态「已完成（1 条需人工处理）」与日志告警文案（应显示真实列名 `chat_message.content_blob`，见 ic-15）；此路径真机从未覆盖。前置：ic-07 / ic-15 落地。
2. **大会话（5000+）keyword 搜索耗时**：真机建 5000+ 条会话，测 keyword 搜索的响应耗时与 UI 冻结情况（desktop main / mobile）；对照修复前（全量解压）观察改善。前置：ic-08（OQ-1 拍板后）落地。
3. **迁移进行中打开存储页观察三条进度轮询推进**：迁移进行中分别打开 desktop 设置页与 mobile 存储页，观察三条迁移状态行的数值是否随时间推进（desktop 2s 轮询、mobile 按 ic-23 方案）。前置：ic-23 落地、ic-06 节流不引起「进度回退」观感。

---

## K 节建议

0. **【r4 留痕】历史迭代文档残影（不强制本轮清理）**：ic-33 走方案 A 撤除 `escapeLikePattern` 后，`docs/Iterations/chat-history-search/spec.md`（:17-19 / :78 / :91 / :151-155 / :186 等处仍写 LIKE 粗筛与 public re-export）会进一步失配——文档面是否清理由下游自定，执行注记在此留痕。
1. **中文注释同步清单（随条目走，不单列修复项）**：
   - ic-15：`blob-binary-normalization.ts` 告警文案与 `WITHOUT ROWID` 三处注释口径统一；
   - ic-16：`db-maintenance/index.ts` 头注释与子路径口径；
   - ic-17：`apps/cli/src/runtime.ts:184-191` 双任务预算与顺序理由；
   - ic-19：mobile compaction 服务头注释（含 zlib-b64 残影删除）；
   - ic-21：mobile blob 归一服务头注释与守卫口径；
   - ic-12：`readDoneMarker` 解析注释（失败归 0 的边界）；
   - ic-01：compaction 文件头 + 收尾段注释 + desktop 接线「不自锁」注释。
2. **lint / format / typecheck**：由下游执行（`pnpm -w lint`、各包 `tsc`），本文件不列举逐条命令。
3. **spec 三处平台分支残影修订（SD-1）列为下游文档步骤**：compression spec:26 / :97 / :123 的订正随对应实现条目（ic-01、ic-17 等）落地后一并做；同时把 SD-2~SD-5、SD-7~SD-10 的登记项按「Spec deviations」节的处置动作逐条闭合。
4. **CR 复检 grep 校验项**（供下一轮 review-scope 用）：
   - `git grep -n "runDatabaseMaintenance" packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts` 应无直调（只剩 import 清理后的注释引用）；
   - `git grep -n "chat_message.bytes" packages/core/src` 应为空；
   - `git grep -n "zlib-b64" apps/mobile/src/services/message-content-compaction.service.ts docs/Iterations/message-content-compression/spec.md` 的命中需与 SD-1/SD-8 的处置结果一致；
   - `git grep -n "startupMaintenancePending" packages/core/src docs/Iterations`（OQ-I2 拍板共用后，两处任务与 spec 登记都应出现）。


---

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | **yes**（主代理 2026-09-28 宣布：round 4 终检结论「2 处微调后可 yes」，N1/N2/nit×2/OQ×2 共 6 处 r4 微调由主代理 trivial 豁免直接落地并带【r4 修订】标记；查维度内无未写入的 P0/P1/P2 开放项） |
| fix_spec_path | docs/Iterations/binary-blob-and-vfs-pack/cr-fix-spec-integration.md |
| dag_version / review_round | 4 / 4（r1 四 scope 并行 → r2 spec-fix+full → r3 spec-fix+full → r4 spec-fix(trivial)+full 终检） |
| P0 / P1 / P2（已写入 fix-spec） | 1 / 10 / 25（共 36 条；ic-36 为既有姊妹条目修订索引，执行面在 cr-fix-spec.md） |
| 未写入的开放 must-fix | 0（round-1 原始 47 条 → 双射合并 33 + round-2 复检新增 3 = 36，全部落档） |
| spec_deviations | none open（SD 节 10 项全部带处置动作——随 ic 条目或下游文档步骤；round-1 原始 SD 全部有去向标注） |
| C-orch | ✅（ic-01 收尾维护收口、ic-02/19 重挂与去重、ic-03 采样隔离、ic-06 轮询节流、ic-07 护栏、ic-20 busy 互斥下沉、ic-30/31/32） |
| C 类合并后 QA | 3 项（坏 base64 消息行真机路径 / 大会话 keyword 搜索耗时 / 迁移进行中进度轮询推进）——不阻塞 ready |

> **执行顺序提示**：本文件与姊妹 `cr-fix-spec.md`（A1 线 35 条待执行）存在合并执行与前置关系——ic-03 ↔ cr-04（同一处 Promise.all，必须合并）；ic-01 前置 = 姊妹 wave-0 的 cr-26 回调缝；ic-09 依赖 cr-08 的探针补口（或自带覆写）；ic-36 的修订随姊妹条目执行。两份 fix-spec 建议作为一个执行计划统筹排波。
