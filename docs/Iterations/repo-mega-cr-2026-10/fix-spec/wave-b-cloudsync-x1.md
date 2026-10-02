# fix-spec 分片补遗 · wave-b-cloudsync-x1（S-CS-04 / S-CS-08 / S-CS-09）

> 基线：`main@fe79b781`（worktree `D:\Dev\nm-worktree\mcr`）。
> 本分片条目：**S-CS-04**（P1，移动端 pull 的 busy 令牌泄漏）· **S-CS-08**（P1，S3 driver `putFile` 多余整拷）·
> **S-CS-09**（P1，push 收尾用只含 etag 的重读结果无条件覆盖 rev）。
> **补位声明**：`SPEC.md` §2 分片分配表漏了這三条——主分片 `wave-b-cloudsync.md` 实际只认领了
> S-CS-01 / 16 / 02 / 03 / 07 + D5（全文 grep `S-CS-04|S-CS-08|S-CS-09` 在整个 `fix-spec/` 目录
> 只命中 `wave-b-cloudsync.md:428` 的一句顺带提及）；`wave-b-core2.md` 的「P1-S 批次」格名义上
> 列了 S-CS-08，但该文件全文未写它。**本文件是这三条的唯一 spec 化落点**。
> **补位已落**：`SPEC.md:20` 已新增**独立行** `wave-b-cloudsync-x1.md`（不是往 `wave-b-cloudsync.md`
> 那行上追加），本轮只需**复核该行内容**，judge 轮无需再补。
> 撰写纪律：所有 file:line 于 `fe79b781` 工作区**亲自打开核对**，未照抄台账行号。
> 三条的严重度、印证强度、修法一句话均照抄 `ledger-v2.md` §2.6 原文，**行号以本文为准**。

---

## 0 · 归属与打包（本补遗为什么不是一个 PR）

主分片 `wave-b-cloudsync.md` 的 §0 论证「六条必须同一 PR」，理由是**它们是一条 pull 生命周期的六个断面**
（换库 → 关连接 → 重建 runtime → 记账 → 放令牌 → 复用单例）。**本补遗三条不属于这条断面**：

| 条目 | 落点 | 与「pull 生命周期断面」的关系 | 文件重叠 |
|---|---|---|---|
| **S-CS-04** | `apps/mobile/src/services/cloud-sync.service.ts` | 无关（是**令牌能否被 release**，不是令牌何时 release） | **与主分片提交 2 / 5 重叠**（详见 §4） |
| **S-CS-08** | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts` | 零关系 | **零重叠** |
| **S-CS-09** | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` | 弱关系：同文件，但改的是 `push()` 收尾段而非 `pull()` | **与主分片提交 5 同文件不同函数** |

**结论**：S-CS-08 独立 PR；S-CS-09 独立 PR 或并入主分片提交 5（备选案见 §4）；S-CS-04 **必须进主分片那个 PR**，
但要排在提交 5 之后（不是台账 Wave B 表写的「可并行」——见 §4 的行号级理由）。

---

## 1 · S-CS-04 —— 移动端 `pullCloudSync` 的 busy 令牌 acquire 写在 `try` 之外

- **严重度 / 簇**：P1 / cloudsync（apps-mobile 落点）。台账 `ledger-v2.md` §2.6 记「**≡ AM-2**」，
  印证强度「5 处独立撞车 + W6 confirmed-by-construction + **revalidate-a valid（结构体逐字吻合）**」，量 S。
  后果是**本进程生命周期内不可自愈**（模块级计数、无 TTL、无自愈路径），且**用户侧零报错**。

- **病症**：`pullCloudSync` 在 `:317` 取 busy 令牌，但 `try` 到 `:338` 才开始——中间 `:326-336` 的
  `createCloudSyncProgress` 与 **`await createCoordinator(...)` 全在 `try` 之外**。
  它们任何一条抛出，`finally:366-370` 就不执行 ⇒ `releasePullBusy()` 永不调用 ⇒
  `maintenanceBusyCount` 永久 +1 ⇒ `isMobileDbMaintenanceBusy()` 恒为 `true` ⇒
  **读这个标志让路的两个后台循环（消息正文解压搬运、blob 二进制归一）在本进程剩余生命周期内全部停摆**，
  用户在没有任何报错提示的情况下看到「数据清理 / 优化永远没反应」。

- **证据**（`apps/mobile/src/services/cloud-sync.service.ts`，本轮逐行核对）：

  ```
  317  acquireMobileDbMaintenanceBusy();
  318  let pullBusyHeld = true;
  319  const releasePullBusy = (): void => { … };     // ← 唯一的释放点
  326  const progress = createCloudSyncProgress('pull', {…});
  332  const {coordinator, exportTempPath, importTempPath} = await createCoordinator(runtime, undefined, progress);
  338  try {
  366  } finally {
  367    releasePullBusy();
  ```

  计数语义无自愈面（`apps/mobile/src/services/db-maintenance-busy.ts`）：

  ```
  15  let maintenanceBusyCount = 0;
  31  export function releaseMobileDbMaintenanceBusy(): void {
  32    maintenanceBusyCount = Math.max(0, maintenanceBusyCount - 1);
  ```

  **触发面有一条确定路径**（台账/synth 只给了 suspected，本轮把两端判据逐行对齐后确认**不等价**）：
  `getCloudSyncLocalStatus` 的 `configured` 判据用 `config.secretKeySet`，而它来自
  `secretStore.has()`（`apps/mobile/src/services/cloud-sync-config.store.ts:180,191,215-220`）；
  `createCoordinator` 内部的 `buildS3StorageConfig` 判的是 **secret 的明文串非空**
  （同文件 `:313-322`，不满足直接 `throw new Error('请先完成云存储配置')`）。
  ⇒ **SKSP `has=true` 但 `get` 返回空 / decrypt 失败**时，`:308` 放行、`:332` 必抛，
  令牌当场泄漏。这条不需要真机复现就成立：**两个判据读的是不同的东西**（存在性 vs 内容）。

  `createCoordinator`（`:139-172`）内部有四个独立的抛点：`:149 getCloudSyncConfig`、
  `:150 buildS3StorageConfig`、`:151 createS3ObjectStorage`（含注入的 `ReactNativeBlobUtil` 适配器）、
  `:171 ReactNativeBlobUtil.fs.dirs.CacheDir` 取临时路径、`:174 new CloudSyncCoordinator`。

  **对照组：desktop 侧同类问题已经被修过、留了注释、还钉了回归测试。**
  `apps/desktop/test/cloud-sync-handlers.test.ts:91-110` 的用例名就叫
  「pull 前置 getLocalMeta 抛错后 syncBusy 复位 false」，注释写着「getLocalMeta 移入 try 后，
  任何抛错路径都必须经 finally 复位 syncBusy——否则数据清理守卫会被永久锁死」。
  **mobile 侧同一函数没做这个搬移**，这是本条的全部机理。

  **`pushCloudSync` 无此问题（本轮核对后可排除，别顺手一起改）**：`:392` 的 `createCoordinator`
  同样在 `try:398` 之外，但它**全函数不 acquire 令牌**（`:374-421` 内零
  `acquireMobileDbMaintenanceBusy`）⇒ 没有可泄漏的计数。

- **修法**（文件·函数级，全部在 `apps/mobile/src/services/cloud-sync.service.ts` 的 `pullCloudSync`）：

  1. **把 acquire 之后的一切可抛点收进同一个 `try`**。推荐形态（注意 `progress` 必须先声明再赋值，
     否则 catch 里引用会 TDZ；`exportTempPath` / `importTempPath` 也要提升为 `let`，
     否则 finally 里 `unlink(undefined)` 会用一个新错盖掉原始错）：

     ```
     acquireMobileDbMaintenanceBusy();
     let pullBusyHeld = true;
     const releasePullBusy = (): void => { … };          // 保持原样，不动

     let progress: ReturnType<typeof createCloudSyncProgress> | undefined;
     let coordinator: CloudSyncCoordinator;
     let exportTempPath: string | undefined;
     let importTempPath: string | undefined;
     const now = new Date().toISOString();      // ← 必须在 try 之外声明：catch 分支要用它

     try {
       progress = createCloudSyncProgress('pull', {onUiProgress: options?.onProgress});
       progress.step('start', {lastSyncedRev: local.lastSyncedRev});
       const created = await createCoordinator(runtime, undefined, progress);
       coordinator = created.coordinator;
       exportTempPath = created.exportTempPath;
       importTempPath = created.importTempPath;
       // ↓↓ 以下整体保持现状（:339-359）
     } catch (error) {
       if (isCloudSyncError(error) && error.code === 'ALREADY_UP_TO_DATE') { … }
       await patchCloudSyncLocalStatus(runtime, {…lastPullResult: 'error'});
       progress?.fail(error);                            // ← 唯一需要加 ?. 的地方
       throw mapSdkError(error);
     } finally {
       releasePullBusy();
       if (exportTempPath != null) { await ReactNativeBlobUtil.fs.unlink(exportTempPath).catch(() => undefined); }
       if (importTempPath  != null) { await ReactNativeBlobUtil.fs.unlink(importTempPath ).catch(() => undefined); }
     }
     ```

  2. **`:348` 的显式 `releasePullBusy()`（成功分支、重建完成之后）保持不动**。
     它与 `finally:367` 的幂等令牌是配对的（`pullBusyHeld` 标志保证不重复 release），**不要合并**——
     ic-20 的计数语义（「外层令牌在 rebootstrap 之后才放」）是刻意设计。
  3. 函数头注释（`:301`）补一句口径：
     「**令牌在 acquire 之后的第一个 `await` 之前，必须已被 `try` 覆盖**——
     acquire 与 try 之间不允许出现任何可抛表达式（对照 desktop `cloud-sync.service.ts` 的
     getLocalMeta 搬移注释，这正是它当初被写下来的原因）」。
  4. **不改** `acquireMobileDbMaintenanceBusy` / `releaseMobileDbMaintenanceBusy` 的计数语义，
     **不改** `pushCloudSync`。

- **验收**（可测断言 / 命令 + 期望）：

  1. **主断言（mobile，必红→必绿）**：让 `createCoordinator` 内的第一个抛点抛出——
     做法是让 `buildS3StorageConfig` reject（这是既有 mock 面，见测试策略）。
     断言：`await assert.rejects(pullCloudSync(runtime, rebootstrap))`
     **且** `isMobileDbMaintenanceBusy() === false`。
     当前代码下第二条**必红**（计数停在 1），修完必绿。
     - **钉住风险 R1 的 `!= null` 守卫（只能钉在这一条）**：本用例是唯一会出现
       `exportTempPath` / `importTempPath` 为 `undefined` 的路径，因此把
       「`fs.unlink` 从未以 `undefined` 被调用」一并断言在这里
       （`expect(unlinkMock).not.toHaveBeenCalledWith(undefined)`）。
       少了这句，风险 R1 的守卫被谁删掉都不会红。
     - **弱断言（风险 R2 的实测口径）**：断言 reject 的 `message` **不含「网络」**这类误导词。
       本轮已实测 `mapCloudSyncSdkError` 会把 `Error('请先完成云存储配置')` 兜成
       `NETWORK / '云存储连接失败，请检查网络与配置'`（见风险 R2），所以这是一条**当前必红**的断言，
       修法按 R2 口径处理后转绿。
  2. **反向断言（防假绿，RULE「验收断言的牙齿」②）**：同一条用例在调用前先断言
     `isMobileDbMaintenanceBusy() === false`。**必要性**：`maintenanceBusyCount` 是进程级模块变量
     （`db-maintenance-busy.ts:15`），若前一条用例泄漏了，这一条的 `=== false` 会**恒红**，
     若前一条用例把它配平了，本条的「泄漏」就观测不到 ⇒ 两个方向都要靠这条前置断言锁死。
  3. **不锁错误文案**：修完之后 `createCoordinator` 的抛错会落进 `catch:351-365`，被 `mapSdkError` 包络
     再抛出（与现在不同——现在它在 try 外，是裸的原始错误）。因此断言只写「reject 了」，
     **不要** `rejects.toThrow('请先完成云存储配置')`，否则会绑死错误映射实现。
     这是本条最容易写出恒红断言的地方。
  4. **临时文件不泄漏（补充断言，非 R1 的主钉点）**：造一个「`createCoordinator` 成功但
     `coordinator.pull` reject」的用例，断言两个 `unlink` 各自被调用一次、且参数是完整路径
     （不是 `undefined`）。
     ⚠️ **这条路径下 `exportTempPath` / `importTempPath` 都已定义**，所以它**观测不到** `!= null` 守卫——
     风险 R1 的守卫由**验收 1** 钉住（见验收 1 的第二条），本条只作「两条清理路径都在、参数是完整路径」
     的补充覆盖，不要把它当成守卫的回归锁。
  5. 与既有 desktop 用例的关系（必须写清，避免 reviewer 误判为冲突）：
     `apps/desktop/test/db-backup-busy.test.ts:101-127`
     （「最外层流程令牌：rebootstrap 完成之前 busy=true、外层 release 后 false」）守的是
     **令牌何时被放**；本条守的是**令牌能否被放**。两者正交，desktop 侧本条**零改动**。
     mobile 侧对位的是 `apps/mobile/__tests__/db-backup.service.test.ts:307` 的
     「ic-20: 上层 importDatabaseBackup 外层计数兜底——链路期间 true、onRebootstrap 之后 false」，
     本条不得让它变红。
  6. 命令与期望：
     `cd apps/mobile && npx jest __tests__/cloud-sync.service.test.ts --maxWorkers=2` → 全绿；
     `cd apps/mobile && npm test -- --maxWorkers=2` → 对照 `baseline.md` 已知红清单，无新增红
     （RULE：满负载下 mobile 全量偶发挂两个性能护栏用例，**必须降并发跑**，别据此判回归）。

- **测试策略**：

  - **改动测试文件**：`apps/mobile/__tests__/cloud-sync.service.test.ts`。
    该文件已 `jest.mock('@/services/cloud-sync-config.store')` 并把 `buildS3StorageConfig`
    换成 `mockBuildS3Config`（`:12,33`）⇒ **不需要为「造出 `createCoordinator` 抛点」新增任何 mock 设施**，
    只需在 `describe('pullCloudSync')` 块里加用例 + 一个 `beforeEach` 前置断言 + 一个 `afterEach` 清位。
  - **唯一新增的观测缝**：`ReactNativeBlobUtil.fs.unlink` 的 `mockUnlink`
    （验收 1 的 `!= null` 守卫断言、验收 4 的两个 `unlink` 参数断言都靠它）。
    它只是既有注入缝上的一个 spy，不构成 desktop 那套「零 mock 基座」约束的适用场景
    （mobile 侧本就有 jest.mock 设施）。
  - 用例名（拟）：
    - `createCoordinator 抛错时 reject 且 isMobileDbMaintenanceBusy() 回到 false`（验收 1+2）
    - `coordinator.pull 失败时两个临时文件都被清理且参数为完整路径`（验收 4）
  - 新增用例的清理形态照抄 `apps/mobile/__tests__/db-maintenance-busy.test.ts:17-21`
    既有的 `while (isMobileDbMaintenanceBusy()) { releaseMobileDbMaintenanceBusy(); }` 兜底，
    **放在 `describe('pullCloudSync')` 内**，防止污染同文件后续用例与同进程其它套件。
  - **无新增测试文件**（mobile 有 jest.mock 设施，本条不涉及 desktop 那套「零 mock 基座」约束）。
  - **备选案**：若 reviewer 认为同文件既有 3 条 pull 用例的 mock 状态会被新用例污染，
    可把新用例拆到新文件 `apps/mobile/__tests__/cloud-sync-pull-busy.test.ts`（独立进程，
    RULE ② 的标准解法）。代价是要复制那一整段 `jest.mock` 基座。**推荐主案，不推荐备选。**

- **回归线**（必须保持绿）：

  - `apps/mobile/__tests__/cloud-sync.service.test.ts` 既有全 8 条
    （`sha256Hex` 1 + `testCloudSyncConnection` 2 + `pullCloudSync` 3 + `pushCloudSync` 2）。
    其中「拉取成功时更新 lastSyncedRev 并触发 rebootstrap」直接覆盖 `:346 onRebootstrap()`
    + `:348 releasePullBusy()` 的时序，**它变红就说明 finally 的搬移动了令牌边界**。
  - `apps/mobile/__tests__/db-maintenance-busy.test.ts` 全 3 条（计数/令牌配对语义，本条不改它）。
  - `apps/mobile/__tests__/db-backup.service.test.ts` 全量，含 4 条 `ic-20` 用例
    （`:276` / `:290` / `:307` / `:327`；原稿写「5 条（`:276-336`）」是计数笔误）。
  - `apps/mobile/__tests__/cloud-sync-config.service.integration.test.ts`
    （`未配置时 pullCloudSync / pushCloudSync 抛 NOT_CONFIGURED`）。

- **依赖**：

  - **无前置条目、无拍板项。**
  - **硬约束（与主分片提交 5 的落点耦合，实现期必须遵守）**：提交 5 要在 mobile 加模块级 `syncBusy`
    （主分片 `wave-b-cloudsync.md:817-820` 列的 S-CS-03 必做子步骤），它的
    `if (syncBusy) throw …; syncBusy = true;` **必须落在 `acquireMobileDbMaintenanceBusy()` 之前，
    或整体落进本条建立的 `try` 内**——落在两者之间（`try` 之外）会**原样复现本条的泄漏形态**。
  - **台账 §10 Wave B 写的「不同文件，可并行」与事实不符**：S-CS-01 的 Step 4
    （提交 2）与 S-CS-03 的必做子步骤（提交 5）都改 `pullCloudSync` 所在的
    `apps/mobile/src/services/cloud-sync.service.ts`（台账那一栏说的是**无跨条目依赖**，
    不是「能否同 PR」）。据此 S-CS-04 并入主分片 PR，顺序理由见 §4。
  - **与 desktop 侧零耦合**（两端是各自独立的 `db-maintenance-busy.ts` 模块）。

- **风险与回滚**：

  - 风险 R1（最容易踩）：`finally` 里 `unlink(exportTempPath)` 在 `createCoordinator` 抛错时参数为
    `undefined`。虽然 `:368-369` 已经挂了 `.catch(() => undefined)` 能吃掉**异步** rejection，
    但 `ReactNativeBlobUtil.fs.unlink(undefined)` 存在**同步抛 TypeError**的可能——
    同步抛出不会被 `.catch` 接住，会用一个新错盖掉原始错、把「配置不全」报成「临时文件清理失败」。
    ⇒ 修法第 1 步的 `!= null` 守卫就是为此，**不可省**。
  - 风险 R2：错误映射口径变化。抛错从「裸的 `Error('请先完成云存储配置')` 直冒泡」变成
    「经 `catch:365` 的 `mapSdkError` 包成 `CloudSyncError` 再抛」。
    **本轮已实测闭合**：`map-cloud-sync-sdk-error.ts:114-144` 对
    `new Error('请先完成云存储配置')` **落不到任何分支**，最终由 `:144` 兜底返回
    `NETWORK / '云存储连接失败，请检查网络与配置'` ⇒ 修完之后用户会看到「请检查网络」这种
    **确实误导**的引导（配置不全跟网络没有关系）。
    ⇒ **实现口径（二选一，落到代码里即可，不扩错误码面）**：
    - ① 让 `pullCloudSync` 的 `catch` 对 `NOT_CONFIGURED` 类的配置缺失错误**原样透传**（不包络）；或
    - ② 在 `mapCloudSyncSdkError` 增加一条「`请先完成云存储配置`」的归一分支，映射到
      `NOT_CONFIGURED` 而非 `NETWORK`。
    ⇒ 验收 1 已附一条「reject 的 `message` 不含『网络』误导词」的**弱断言**钉住这条。
  - 风险 R3：与主分片提交 2 的耦合。若提交 2 采纳了 S-CS-01 Step 4 的 `retryAndWait` 签名
    （`onRebootstrap: () => Promise<Runtime>`），`catch` 分支会**新增一次 `onRebootstrap()` 调用**，
    那次调用同样必须在 `try` 覆盖内 ⇒ 本条与提交 2 存在真实代码级耦合，不是「碰巧同文件」。
  - 回滚：单提交 `git revert`，无数据面、无配置、无迁移。令牌泄漏只在进程内，
    重启即恢复——这也是本条定为 P1 而非 P0 的原因（后台停摆要等用户重启才自愈）。

---

## 2 · S-CS-08 —— S3 driver `putFile` 对「已经是 Uint8Array」的输入再全拷一份

- **严重度 / 簇**：P1 / cloudsync（`packages/cloud-sync-driver-s3` 落点）。量 S。
  台账印证「W6 confirmed + **revalidate-a valid（`putFile` 逐字未改，仅打包布局变化）**」。
  **不是正确性缺陷，是内存峰值缺陷**：峰值 = 1 份 + 1 份，且 mobile 侧还要再加 base64 的一次放大。

- **病症**：`putFile` 里 `const body = new Uint8Array(raw)`，而 `raw` 来自注入的
  `FileSystemPort.readFile`，其**返回类型本身就是 `Promise<Uint8Array>`**。
  `new Uint8Array(<TypedArray>)` 是逐元素复制（不是视图化、不是零拷贝），于是：
  - desktop（Node 端注入 `node:fs` 的 `readFile`，返回 `Buffer`，本身即 `Uint8Array`）：峰值 = 2× 文件（本轮已核对）；
  - mobile（`createCoordinator` 注入的 `writeFile` 是 `Buffer.from(bytes).toString('base64')`，
    `apps/mobile/src/services/cloud-sync.service.ts:156-161`）：**≥ 3×**（`Buffer.from` 自身还要拷一份，
    base64 再放大 1.33×）。**未实测，PLAN §四要求数字须实测，此处不给数。**
  而 `apps/mobile/src/services/db-backup.service.ts` 特意用 `WRITE_CHUNK_BYTES = 256*1024` 分块落盘
  并注释「避免 100MB+ Uint8Array → 单次 base64 撑爆 Hermes 堆」——
  **driver 这条路把 app 层刚刚绕开的坑又踩了一遍**。
  附带：`putFile` / `getToPath` 存在的理由（走文件路径、避免整包进内存）在注释里被写成既成事实，
  但实现里既无 multipart 也无流式（`getToPath` 仍是 `storage.get(key)` 整份下进内存再写盘）
  ⇒ 属 RULE「注释承诺 ≠ 实现」，Wave E 有靶子。

- **证据**（`packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts`，本轮逐行核对）：

  ```
  225    async putFile(key, filePath, options) {
  226      const raw = await readLocalFile(filePath);
  227      const body = new Uint8Array(raw);        // ← 对已经是 Uint8Array 的输入再全拷一份
  228      return storage.put(key, body, options);
  229    },
  231    async getToPath(key, destPath) {
  232      const { body, etag } = await storage.get(key);   // 整份下载进内存
  233      await writeLocalFile(destPath, body);
  ```

  类型上这个转换就是多余的（`src/ports/file-system.port.ts:9`）：

  ```
  9     /** 读取本地文件全部字节，返回 Uint8Array。 */
  10    readFile(path: string): Promise<Uint8Array>
  ```

  `readFile(path: string): Promise<Uint8Array>`）——**编译期就已经保证 `raw` 是 `Uint8Array`**。
  `readLocalFile`（同文件 `:136-143`）只是转发 `fileSystem.readFile(path)`，不做任何类型变换。

- **修法**（文件·函数级，`packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts`）：

  1. `putFile` 第 227 行改为
     `const body = raw instanceof Uint8Array ? raw : new Uint8Array(raw);`。
     保留 `instanceof` 兜底是为了容忍「注入了返回 ArrayBuffer / 非 TypedArray 的 `FileSystemPort`」
     这类越界实现（类型上多余，但零成本、且不改变对外行为）。
  2. **不要**改成 `new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)`（视图化）。
     那会把 `Buffer` 的底层 `ArrayBuffer` 交给 SDK；若 SDK 侧任何一处做 `Buffer.from(body)` /
     `new Uint8Array(body)` 又会重新拷贝一次，且共享底层意味着「谁改谁遭殃」，把一个
     「多拷一次」换成「不确定什么时候踩雷」。**直接透传引用是最省且最可测的形态。**
  3. `getToPath` **本轮不改**：它没有多余拷贝，代价在「整份下内存」这个 P2 面，
     真正的解法是引 `@aws-sdk/lib-storage` 的 `Upload` 与流式写盘（属独立批次，见风险 R2）。
  4. **契约写死**：`src/ports/file-system.port.ts:9` 的 `readFile` JSDoc 补一句
     「**必须返回独立新分配的数组，不得返回内部复用缓冲**」——
     这是本条透传引用后新引入的前提（见风险 R1）。desktop 侧注入实现是 `node:fs` 的
     `readFile`（每次新分配 Buffer）、mobile 侧是 `ReactNativeBlobUtil.fs.readFile(path, 'base64')`
     经 `readFileBytes`（每次新分配），**本轮核对两处都满足**。

  > **原稿的第 5 步「注释诚实化」已删除**（原稿称要改的是「避免一次性读入 / 走文件路径省内存」这类
  > 口径，但 `object-storage.port.ts` 全文 33 行与 `file-system.port.ts` 全文 13 行**均已整读**，
  > 只有 `:25/:31` 的「优先于内存路径 / 优先于 bytes 路径」这类**选择顺序**措辞，
  > **没有任何「省内存 / 避免整包」的口径** ⇒ 原稿第 5 步无靶子）。
  > 「注释承诺 ≠ 实现」这件事**移交 Wave E 的注释诚实化钩子**（与主分片提交 6 同类）处理，
  > 本条只留 1/2/3/4 四步。

- **验收**（可测断言 / 命令 + 期望）：

  1. **主断言（引用相等，有牙）**：在 `packages/cloud-sync-driver-s3/test/s3-object-storage.test.ts`
     既有的 `putFile：从本地文件读取并上传`（`:183-210`）里，把注入的 `fileSystem.readFile`
     换成返回**一个哨兵实例** `const sentinel = new Uint8Array([4, 5, 6])`，
     并在 mock client 的 `PutObjectCommand` 断言里追加
     `assert.equal(command.input.Body, sentinel);`（**`===` 引用相等，不是 `deepEqual`**）。
     - 当前实现下必红（`:227` 产生新对象）；修完必绿；
     - 把 `:227` 整行删掉、或反向写成「总是拷贝」，这条都会红 ⇒ 有牙（RULE ①）。
  2. **保留既有内容断言**：既有的 `assert.deepEqual(command.input.Body, payload)`（`:195`）
     **不许删**。两条一起在，才同时证明「字节内容没变」与「没有额外分配」。
  3. 命令与期望：
     `cd packages/cloud-sync-driver-s3 && npm test` → 全绿；
     `cd packages/cloud-sync-driver-s3 && npm run typecheck` → 0 错误。

- **测试策略**：

  - **改动测试文件**：`packages/cloud-sync-driver-s3/test/s3-object-storage.test.ts`
    （只有 `putFile` 一条需要加断言，`getToPath` 不动）。
  - 用例名（拟）：沿用既有用例名 `putFile：从本地文件读取并上传`，在其内部加引用断言；
    **不新增用例**（避免造一个内容重复的姊妹用例）。
  - **无新增测试文件。**
  - **关于「零 mock 设施」的说明（给 reviewer）**：desktop 的 `node:test` 基座确实没有
    `vi.spyOn` / `mock.module`（RULE 已记 ESM 下无法 monkey-patch 具名导入），
    但**本条完全不需要它**——`createS3ObjectStorage(config, deps)` 的 `deps.client` 与
    `deps.fileSystem`（`src/create-s3-object-storage.ts:14-23`）就是仓库既有的注入缝，
    既有 putFile/getToPath 两条用例正是这么写的（`:192-203` / `:219-232`）。
    ⇒ 属 RULE「观测面选与实现同源且可注入的缝」，本条不违反任何测试基座约束。

- **回归线**（必须保持绿）：

  - `packages/cloud-sync-driver-s3/test/s3-object-storage.test.ts` 全 10 条
    （head×2 / get / put / `CS-S1` LOCK_CONTENTION / 阿里云 OSS×2 / putFile / getToPath /
    `isAliyunOssEndpoint`）。
  - `packages/core/test/cloud-sync/coordinator.test.ts` 全 **17** 条
    （`CS-P1`/`CS-P1b`/`CS-P2`/`CS-P3`~`CS-P6`、`CS-P5b`、
    `forceOverwriteRemote 跳过 rev 检查`、`T-SC10a`~`T-SC10e`、`PushAgentMutex 单元` 3 条；
    枚举即权威，原稿「20 条」是计数笔误，数字错会让「逐条复跑」失去锚点——口径与主分片
    `wave-b-cloudsync.md:401-406` 一致）。其中
    `CS-P5b: 文件路径 Push 走 hashSnapshotFile + putFile`（`:307`）与
    `CS-P1b: 文件路径 Pull 走 getToPath + importSnapshotFromPath`（`:193`）
    直接覆盖 file-path 契约面。（它们用的是测试自己的内存 storage，不吃本条改动，但分支必须仍绿。）
  - 两端各跑一次：`cd apps/desktop && npm test -- --test-concurrency=2`、
    `cd apps/mobile && npm test -- --maxWorkers=2`
    —— driver 是共享包，两端都注入 `fileSystem`，本条改了它的行为。
    ⚠️ desktop 那条**必须带 `--test-concurrency=2`**：裸 `npm test` 的 `run-tests.mjs` 单引号 glob
    会**收集到 0 条测试**（看着全绿的假信号），且满负载下
    `blob-binary-normalization-service.test.ts` 的 `cr-05` 会偶发红。
    若 Wave A 的 `N-P0-02` 未先落（本包全部回归线的地基），**必须人工确认输出里 `# tests N` 且 N>0**。

- **依赖**：无前置条目、无拍板项、**不被任何条目依赖**（三条里唯一完全孤立的一条）。

- **风险与回滚**：

  - 风险 R1（本条新引入的唯一真实前提）：透传引用后，SDK 拿到的 `Body` 与
    `FileSystemPort.readFile` 的返回值**是同一个对象**。若某个 `FileSystemPort` 实现返回的是
    内部复用缓冲（每次 `readFile` 都返回同一块内存），而 SDK 侧延迟消费 `Body`，
    就会读到被后续调用覆写的内容。
    ⇒ 修法第 4 步把这条契约写进 JSDoc 是**必做项**，不是注释洁癖；
    且本轮已核对两处现有注入实现都满足。
  - 风险 R2：与 P2 的「真流式」（synth M4.6，需引 `@aws-sdk/lib-storage`）是同族不同批。
    本条是**止血**，不是终局 ⇒ spec 措辞里不要写成「已解决大快照内存问题」，
    CHANGELOG 也要按「去掉一次多余整拷」写，别夸大成「云同步不再 OOM」。
  - 风险 R3：注释诚实化**已移出本条**（原稿第 5 步无靶子，见修法节的说明），改由 Wave E 的
    注释诚实化钩子承接。届时它会改 `ObjectStoragePort` / `FileSystemPort` 的 JSDoc：
    `ObjectStoragePort` 是 core 的公开接口面——**只改注释、不改签名**，
    按 RULE「给导出接口加必填字段前先扫手写假实现」的口径，那一步不触发该风险。
    本条自身只经由**修法第 4 步**动一次 `FileSystemPort.readFile` 的 JSDoc，同样只改注释。
  - 回滚：单提交 `git revert`，无数据面、无配置、无迁移。

---

## 3 · S-CS-09 —— push 收尾：条件写失败后用「只含 etag 的重读结果」无条件覆盖 rev

- **严重度 / 簇**：P1 / cloudsync（`packages/core` 落点）。量 M。
  台账印证「W6 confirmed + **revalidate-a valid（一字未改）**」。
  后果是**跨设备静默数据错位**：远端 `status.json` 的 rev 被写回更小的值 + 第三方租约被抹，
  且两端都把自己记成成功。

- **病症**：`push()` 收尾的 `conditionalPutStatus(finalStatus, statusEtag)` 返回 `null`
  （If-Match 失败 = 远端在我们上传期间被别人改过）时，代码**重读远端 status 但只解构 `{ etag }`**，
  把重读到的 `status`（**含别人的租约锁与已推进的 rev**）整个丢掉，
  然后拿这个新 etag **无条件覆盖**自己的 `finalStatus`。
  而 `finalStatus.rev` 是 `:249` 的 `const nextRev = remote.rev + 1` —— **按最初读到的值算、全程不变的常量**。
  同时 `finalStatus.lock = null` 会把重读到的第三方有效租约抹掉。

- **证据**（`packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts`，本轮逐行核对）：

  ```
  249      const nextRev = remote.rev + 1;                        // ← try 之前算好，全程不变
  286      const finalStatus: CloudSyncStatus = {
  288        rev: nextRev,                                         // ← 用的是最初那个值
  294        lock: null,                                           // ← 抹掉重读到的第三方租约
  297      let finalEtag = await this.conditionalPutStatus(finalStatus, statusEtag);
  298      if (finalEtag == null) {
  299        const { etag: rereadEtag } = await this.readRemoteStatus();   // 重读，只取 etag
  300        finalEtag = await this.conditionalPutStatus(finalStatus, rereadEtag);
  ```

  前置条件链（两条都在，本轮逐跳确认）：

  ```
  271      if (uploadElapsed > this.leaseSeconds * 500) {          // 上传耗时超过半个租约
  277        const renewedEtag = await this.conditionalPutStatus(renewedStatus, statusEtag);
  281        if (renewedEtag != null) {
  282          statusEtag = renewedEtag;
  283        }                                                      // ← 无 else：续租失败被静默吞掉
  ```

  ⇒ 续租失败时 `statusEtag` 停在旧值，走到 `:297` **必然**返回 `null`（etag 已过期）
  ⇒ 必然进入 `:298-304` 的重读分支 ⇒ 该分支在「远端已被设备 B 推进过」时**必然**写出回退的 rev。

  **回滚面（这条决定了修法的形状）**：本条抛错后，`lockHeldBySelf` 仍为 `true`
  （`:306` 才置 false）⇒ 会走 `finally:308-312` 的 `tryClearLock(statusEtag)`。
  本轮**已核对 `tryClearLock` 不会误清第三方的锁**（`:370-393`）：

  ```
  379        const lock = status.lock;
  380        if (
  381          lock == null ||
  382          !isEffectiveLock(lock) ||
  383          lock.holderDeviceId !== this.deviceId
  384        ) {
  385          return;                                  // ← 不是自己的锁就不动
  ```

  ⇒ 新增的抛错路径不会连带破坏设备 B 的租约，**这条风险已闭合**，但它必须在验收里被钉住
  （见验收 5），不能只靠读代码。

- **修法**（文件·函数级，`cloud-sync-coordinator.ts` 的 `push()`）：

  1. **`:297-304` 从「无条件覆盖」改成「重读 → 判定 → 条件写」**：

     ```
     let finalEtag = await this.conditionalPutStatus(finalStatus, statusEtag);
     if (finalEtag == null) {
       // 重读远端后必须重新判定，不能只取 etag 就覆盖（否则 rev 回退 + 抹掉他人租约）。
       const { status: latest, etag: rereadEtag } = await this.readRemoteStatus();
       if (!canAcquireLock(latest.lock, this.deviceId)) {
         throw new CloudSyncError("LOCK_HELD_BY_OTHER", "另一台设备正在同步，请稍后再推送");
       }
       if (latest.rev >= nextRev) {
         throw new CloudSyncError("NEED_PULL_FIRST", "云端已被其他设备推进，请先拉取");
       }
       finalEtag = await this.conditionalPutStatus(finalStatus, rereadEtag);
       if (finalEtag == null) {
         throw new CloudSyncError("LOCK_CONTENTION", "同步冲突，请重试");
       }
     }
     ```

     - `canAcquireLock` **已在 `:9` 导入**（同文件 `:230` 在用），不新增 import。
     - **两条判定必须并存，缺一不可**：`canAcquireLock` 在「他人租约已过期」时返回 `true`
       （`logic/lock.ts:25-33`），所以只判它仍会把 B 已推进的 rev 盖掉；
       而 `latest.rev >= nextRev` 才是「rev 是否被别人推进过」的唯一判据。
     - **抛错而非静默**是本条的核心：宁可让用户重试一次，也不要写出回退的 rev。
  2. **补 `:281` 的 else 分支**（零风险留痕，**不引入新抛错**）：
     ```
     if (renewedEtag != null) {
       statusEtag = renewedEtag;
     } else {
       // 续租条件写失败：statusEtag 保持旧值，下面的 final 写必然走重读分支。
       console.warn("[cloud-sync] 续租失败，final status 将走重读判定分支");
     }
     ```
     之所以不直接抛错：`:298-304` 的重读分支已经能正确收尾，在这里抛会把「续租失败但收尾安全」
     误判成整次 push 失败（而快照已经上传、计数已经上去了）。**留痕即可**，
     目的是让下一个维护者不把「续租一定成功」当不变量。
  3. **三个错误码都已在用，本条不扩错误码面**：
     `NEED_PULL_FIRST`（`:226`）、`LOCK_HELD_BY_OTHER`（`:231`）、
     `LOCK_CONTENTION`（`:240` / `:302`）——不需要动 `cloud-sync-errors.ts`。
  4. 函数头 / `push()` 的 JSDoc 补一句：
     「**final status 条件写失败时，重读远端必须重新判定租约与 rev，禁止只取 etag 就覆盖**」。

- **验收**（可测断言 / 命令 + 期望，全部落在 `packages/core/test/cloud-sync/coordinator.test.ts`）：

  1. **他人推进过 rev ⇒ 不得覆盖**：
     起 `createStorage({status: {rev: 2, ...}})`，在 `createMockDbSync` 的
     `exportSnapshotToPath` 钩子里**模拟设备 B 的无条件写**
     （直接 `await storage.put(statusKey(PREFIX), encodeStatus({rev: 3, lock: null}))`——
     `storage.put` 不传 `ifMatch` 就是无条件写，正是设备 B 的行为，**不需要给测试基座加新口子**）。
     断言：`push()` reject 且 `code === "NEED_PULL_FIRST"`，
     **且** `storage.getStatusWrites()` 的最后一条 `rev >= 3`（即没有写出回退的 rev）。
  2. **他人有效租约 ⇒ `LOCK_HELD_BY_OTHER`**：
     **初始 status 必须是 `{rev: 2, lock: null}`**，把「他人有效租约」放进
     `createMockDbSync` 的 `exportSnapshotToPath` 钩子里由 `storage.put` 无条件写入
     （与验收 1 同一手法，仅写入内容不同）：`{rev: 2, lock: buildLease('other-device', 900)}`
     （`expiresAt` 在未来）。断言 reject 且 `code === "LOCK_HELD_BY_OTHER"`。
     ⚠️ **初始 status 绝不能带他人有效租约**：那样 `runPush` 在 `:230 canAcquireLock` 就提前抛
     `LOCK_HELD_BY_OTHER`，**永远进不了 `:298` 的重读分支** ⇒ 修前修后皆绿，是 RULE ① 说的恒绿无牙断言。
     ⇒ **验收 1 与验收 2 必须拆成两个用例**（RULE ③：同一份夹具只服务一套期望），
     区分点写在**钩子里写进远端的那份 status** 上（`lock` 是否有效），不靠「同一条用例断言两件事」。
  3. **反向断言（防「守卫写成永拒绝」，RULE ①/②）**：
     钩子里让远端变成 `{rev: 2, lock: 已过期的他人租约}`（`canAcquireLock` 为 `true`、
     `latest.rev (2) < nextRev (3)`）⇒ 断言 `push()` **成功**、`rev === 3`、
     且 `getStatusWrites()` 最后一条 `lock === null && rev === 3`。
     **没有这条，验收 1/2 那种「一律拒绝」的错修法也会全绿。**
  4. **第三方的锁不被清**（对应「证据」节的回滚面核对）：
     挂在**验收 2 那一条**上（同一次运行内追加断言），断言远端
     `status.lock.holderDeviceId === 'other-device'` 仍然成立
     （`tryClearLock` 走的是 `:379-386` 的三重守卫，`:383` 判 `!== this.deviceId` 即 return）。
  5. 命令与期望：
     `cd packages/core && npm test` → 全绿；`cd packages/core && npm run typecheck` → 0 错误。
     ⚠️ **不要用 `npx tsx --test <file>` 定向跑 core 测试**——RULE 已记：定向跑会漏
     `--experimental-test-module-mocks --tsconfig tsconfig.test.json` 两个 flag，
     tokenizer driver 未注册会报 `No tokenizer driver registered`，
     **看着像回归其实不是**。本条一律用 `npm test` 全量。

  > **原稿的「验收 4 · 续租失败留痕不改变终局」已删除**：它**不可构造**。续租门槛是
  > `:271 uploadElapsed > this.leaseSeconds * 500`，`leaseSeconds` 缺省
  > `DEFAULT_LEASE_SECONDS = 900` ⇒ 需要一次 450 秒的上传；而
  > `CloudSyncCoordinatorDeps.leaseSeconds`（`cloud-sync-coordinator.ts:43`）这个注入点
  > 原稿没提、测试内 `createCoordinator` 包装（`coordinator.test.ts:130-157`）也没透传它。
  > 「push 最终走 1/2/3 三条之一」这个断言本身也不具体。本轮取**删掉该验收**的处置，
  > 回归线保留 `T-SC10d` 逐条复跑（时序面）；⚠️ 需诚实标注：续租段 `:271-284` 目前**无既有用例覆盖**
  > （见回归线节对 `T-SC10e` 的更正），所以修法第 2 步的 else 留痕这一轮**没有自动化断言兜底**。
  > 若 judge 认为必须补，可另开测试基座口子（给测试内包装加可选 `leaseSeconds` 透传、
  > 钩子里造一次设备 B 无条件写制造续租失败，断言换成具体 `code`）——
  > 但那是**新增测试基座改动**，不在本轮必须修的范围内。

- **测试策略**：

  - **改动测试文件**：`packages/core/test/cloud-sync/coordinator.test.ts`，
    新增 `describe("S-CS-09 final status 重读判定")` 块，3 条用例（验收 1~3，验收 4 挂在验收 2 里）。
  - **零生产基座改动**（本条能落地的关键；测试基座同样零改动，只用既有缝）：既有 `createStorage`（`:31-107`）已经把
    `put` 的 `ifMatch` 判定（`:78-80`）与 `getStatusWrites()`（`:50,83`）做成可观测面，
    `createMockDbSync` 的 `...overrides`（`:126`）就是现成的注入口。
    模拟设备 B 只需在 `dbSync.exportSnapshotToPath` 钩子里直接调 `storage.put`（不传 options），
    **不要**为「模拟他人」去改 `createStorage` 加新方法。
  - 用例名（拟）：
    - `远端 rev 已被他人推进时不覆盖并抛 NEED_PULL_FIRST`
    - `远端有他人有效租约时抛 LOCK_HELD_BY_OTHER 且不清他人租约`
    - `远端租约已过期但 rev 未推进时仍成功提交 final status`（反向断言）
  - **无新增测试文件。**

- **回归线**（必须保持绿）：

  - `packages/core/test/cloud-sync/coordinator.test.ts` **既有全 17 条**
    （`CS-P1`/`CS-P1b`/`CS-P2`/`CS-P3`~`CS-P6`、`CS-P5b`、
    `forceOverwriteRemote 跳过 rev 检查`、`T-SC10a`~`T-SC10e`、`PushAgentMutex 单元` 3 条；
    枚举即权威，原稿「20 条」是计数笔误，数字错会让「逐条复跑」失去锚点——口径与主分片
    `wave-b-cloudsync.md:401-406` 一致），重点四条：
    - `CS-P5: Push 成功时 final status lock 为 null 且 rev 递增`（`:290`）——**本条的正面对照组**；
    - `CS-P5b: 文件路径 Push 走 hashSnapshotFile + putFile`（`:307`）；
    - `CS-P6: Push 上传失败时 finally 尝试清锁`（`:344`）——本条让 `finally` 多走两条抛错路径，
      必须复跑；
    - `T-SC10e: 续租点检测到 agent 抢跑 → 拒绝并清云端锁`（`:564`）——**更正原稿的描述**：
      该用例钩子里置 `agentActive = true`，在 `:267` 的 `isAgentActive` 检查就抛 `AGENT_ACTIVE`，
      **走不到 `:271`**。它覆盖的是 `:245-269` 的 catch/finally 清锁路径，必须复跑，
      但**不是**续租段的覆盖。
  - ⚠️ **续租段 `:271-284` 目前无既有用例覆盖**（原稿误以为 `T-SC10e` 覆盖了它）——
    这正是被删掉的「验收 4」本该补上的缺口，见验收节末尾的说明。
  - 另 `T-SC10d`（并发 push 互斥，`:517`）对时序敏感，本条改了收尾段的 await 数量，**必须逐条复跑**。
  - `packages/core/test/cloud-sync/lock.test.ts` 全量（本条复用 `canAcquireLock`，不改它，但要确认口径一致）。

- **依赖**：

  - **无前置条目、无拍板项。**
  - **与主分片提交 5（S-CS-03）同文件不同函数**：S-CS-03 改 `pull()`（`:143-182`）
    与 `acquirePushLock` 更名；本条改 `push()` 的 `:281` / `:297-304`。
    ⇒ 同 PR 内可以并成一个提交，也可独立 PR，见 §4。
  - **与 S-CS-10（首次同步退化成无条件写，量 P2）同一族**：`readRemoteStatus` 在 head 不存在时
    返回 `etag: undefined`（`:328`），`conditionalPutStatus` 的
    `ifMatch != null ? {ifMatch} : undefined`（`:359`）于是变成无条件写。
    **本条不碰它**（S-CS-10 未进 Wave B），但 §4 的合并方案里不要把 S-CS-10 顺手拉进来。

- **风险与回滚**：

  - 风险 R1（最高）：新守卫可能把「本可成功」的 push 变成拒绝。
    ⇒ 缓解就是验收 3 那条反向断言（「租约已过期但 rev 未推进时仍成功」），
    它是本条**唯一**能抓住「守卫写太死」的断言，**不许省**。
  - 风险 R2（已在本轮核对中闭合，但必须被测试钉住）：新增抛错走 `finally` 的 `tryClearLock`，
    理论上可能误清第三方租约。代码事实是 `:379-386` 三重守卫挡住了 ⇒ 闭合。
    ⇒ 验收 4 是这条闭合结论的**回归锁**，防止将来有人「优化」`tryClearLock` 时把它拆掉。
  - 风险 R3：**用户可见的行为变更**。以前这个场景会「静默成功」（代价是远端 rev 回退），
    现在会抛 `NEED_PULL_FIRST` / `LOCK_HELD_BY_OTHER`。两端已有这两个码的文案映射，
    用户会看到「云端有更新，请先拉取」——这是正确引导，但属行为变更，
    **需在 CHANGELOG 记一笔**（措辞：「推送冲突时不再静默回退远端 rev，改为提示先拉取」）。
  - 风险 R4：回滚 `git revert` 只回代码，**修不了历史数据**——已经被回退过的远端 `status.json`
    在下一次 push 时会被重新覆盖成正确值，无需数据修复脚本。
  - 回滚：单提交 `git revert`，无数据面、无配置、无迁移。

---

## 4 · 并入说明（与主分片 `wave-b-cloudsync.md` 的关系）

### 4.1 结论表

| 条目 | 同 PR 还是独立 | 插入 `§8.1` 提交顺序表的位置 | 一句话理由 |
|---|---|---|---|
| **S-CS-04** | **同一个 PR**（主分片那个） | **插为第 6 位**（原第 6 的注释诚实化提交顺延为第 7） | 与主分片提交 2（S-CS-01 Step 4）、提交 5（S-CS-03 必做子步骤）落在**同一个函数的同一段**，不是「碰巧同文件」——见 4.2 |
| **S-CS-08** | **独立 PR** | 不进 `§8.1` | 与主分片**零文件重叠**、零前置、修法一行，独立 review / 独立 revert / 独立验收的成本最低 |
| **S-CS-09** | **独立 PR（推荐案）**；备选 = 并入提交 5 作为第 6 位 | 推荐案不进 `§8.1`；备选案插为第 6 位（S-CS-04 顺延第 7） | 同文件不同函数（`push()` vs `pull()`），可拆；但 `cloud-sync-coordinator.ts` 的 import 段与 `T-SC10d/e` 两条时序敏感用例会同时出现在两个 PR 的回归线上 ⇒ 见 4.3 |

### 4.2 为什么 S-CS-04 必须在主分片 PR 内、且排在提交 5 之后

台账 `ledger-v2.md` §10 Wave B 给 S-CS-04 的依赖栏写的是「**无（不同文件，可并行）**」。
**这一句在本轮被推翻**，理由是行号级的：

1. 主分片提交 2（S-CS-01 + S-CS-16）的 Step 4 要求重写 `pullCloudSync` 的成功分支——
   把 `onRebootstrap: () => void` 换成 `retryAndWait: () => Promise<Runtime>`、
   按 `result.databaseReplaced` 分叉、catch 分支也要先重建再记账。
   **这整块就是 S-CS-04 要搬进 `try` 的那段。**
2. 主分片提交 5（S-CS-03）的风险 R1「必做子步骤」要求在 mobile 加模块级 `syncBusy`
   覆盖 `pullCloudSync` / `pushCloudSync` 两条路径——**入口也要改这个函数**。
   ⇒ 交叉引用 §1 依赖栏的**硬约束**：这枚 `syncBusy` 的检查与置位必须落在
   `acquireMobileDbMaintenanceBusy()` 之前或本条建立的 `try` 内，否则会把本条修掉的泄漏形态原样带回来。
3. 因此若 S-CS-04 先落，提交 2 与提交 5 的 diff 都会把刚搬好的 `try` 边界再改一遍
   ⇒ reviewer 读 diff 会失焦（要连续三次重建同一个 try 块的上下文才能看懂最终形态）。
4. 而**独立成提交的价值是真实的**：本条有一条独立的行为回归
   （「令牌回 false」）和一条独立的风险（`unlink(undefined)` 同步抛），
   合并进提交 2 会让提交 2 的 review 面再扩一档。

⇒ **定稿建议**：S-CS-04 作为主分片 PR 的**第 6 个提交**，排在提交 5 之后、注释诚实化提交之前。

### 4.3 S-CS-09 的归属：请 judge 裁一次的归属问题

- `cloud-sync-coordinator.ts` 同时出现在本条与主分片提交 5 的触及文件里。
  两条改的是不同函数（`push()` 收尾 vs `pull()` 守卫 + `acquirePushLock` 更名），
  **代码冲突面小，但回归线会重叠**：`coordinator.test.ts` 的 `T-SC10d`（并发 push 时序）
  与 `T-SC10e`（`:245-269` 的 catch/finally 清锁路径；**续租段 `:271-284` 目前无既有用例覆盖**）
  既是本条的回归线，也是提交 5 的回归线。
- 两个 PR 分开跑的话，`coordinator.test.ts` 全量会被跑两遍——这是**成本，不是风险**。
- 若 judge 倾向减少 PR 数，备选案是把 S-CS-09 写成提交 5 的**第 6 位**，
  并把提交 5 的标题改成
  `fix(core+mobile): pull 守卫与互斥 + final status 重读判定`。
  **本 spec 写主案（独立 PR）、给备选，不替 judge 拍。**

### 4.4 推荐案终态（含 S-CS-04 为第 6 位；第 7 行 S-CS-08 仅在 judge 裁定并入时生效）

| # | 提交 | 条目 | 触及文件 | 为什么在这个位置 |
|---|---|---|---|---|
| 1 | `fix(desktop): 备份导入三处吞错改为致命 + 校验不整包读入` | S-CS-07 | `apps/desktop/src/main/services/db-backup.service.ts` | （原表，不变）纯错误处理，可独立 review / revert / 验收 |
| 2 | `fix(core+两端): 引入连接换代信号 + pull 记账移到 rebootstrap 之后` | S-CS-01 + S-CS-16 | 原表六处 | （原表，不变） |
| 3 | `fix(desktop): 云同步 service 单例随 runtime 换代重建` | S-CS-02 | `cloud-sync.service.ts`（desktop） | （原表，不变）与提交 2 共用改动点 |
| 4 | `fix(desktop): handleCloudSyncPull 按库文件是否真的替换决定 rebootstrap` | D5 | `handlers/cloud-sync.ts` | （原表，不变）依赖提交 2 的 `databaseReplaced` |
| 5 | `fix(core+mobile): pull 入口/导入前复检 agent、pull 进进程内互斥` | S-CS-03 | `cloud-sync-coordinator.ts`、mobile `cloud-sync.service.ts` | （原表，不变） |
| **6** | **`fix(mobile): pullCloudSync 的 busy 令牌 acquire 收进 try`** | **S-CS-04** | **mobile `cloud-sync.service.ts`** | **排在 5 之后**：提交 2 与 5 都已把这段 try 重写过一遍；本条只做「把 acquire 之后的可抛点收进同一个 try」，叠在最上层，diff 最小、review 面最清晰 |
| **7** | **`fix(driver): putFile 去掉对 Uint8Array 输入的多余整拷 + readFile 契约写死`** | **S-CS-08** | **`packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts`、`src/ports/file-system.port.ts`** | **零文件重叠 ⇒ 原则上独立 PR**；若 judge 裁定并入本 PR，则插在此处（不依赖任何条目，可任意位置），与提交 6 无耦合。注释诚实化部分**不在本条**（见 §2 修法节的移交说明，移交 Wave E） |
| **8** | **`docs(cloudsync): 把 PushAgentMutex 的注释承诺改成事实态`** | **§6 #1 顺带项** | **`cloud-sync-coordinator.ts`、`push-agent-mutex.ts`（仅注释）** | （原第 6 顺延）零风险注释诚实化 |

- **S-CS-09 在推荐案下不进这张表**（独立 PR）。若 judge 选备选案，把它插为第 6 位、
  并把本表 6/7/8 顺延为 7/8/9。

### 4.5 与 `§0 打包约束` 的关系（不要顺手扩大论证）

主分片 §0 论证的是「六条是一条 pull 生命周期的六个断面，拆开 PR 会产生不可验收的中间态」。
**本补遗三条都不在这条断面上**，所以：

- **不要**把 S-CS-08 / S-CS-09 也写进 §0 的「必须同 PR」论证里——它们没有中间态问题，
  独立 PR 的验收面更干净。
- S-CS-04 进主分片 PR 的理由是**文件级冲突**（4.2），不是 §0 的语义论证。
  review 时请把这两条理由分开陈述，别让「它属于 pull 生命周期」这个说法传下去
  （它不属于——S-CS-04 修的是**令牌能否被放**，§0 关心的是**令牌何时被放**）。

### 4.6 `SPEC.md` §2 的补位状态（judge 轮只需复核）

**已补位**：`SPEC.md:20` 已新增**独立行** `wave-b-cloudsync-x1.md`（由 `sr1-cloudsync-c` 标注）——
是**另起一行**，不是往 `wave-b-cloudsync.md` 那行上追加文字。
⇒ 原稿「请 judge 轮把 `SPEC.md` §2 的 `wave-b-cloudsync.md` 行补上…」的请求**已过时**，本轮只需复核
`:20` 那一行的内容是否覆盖 S-CS-04 / S-CS-08 / S-CS-09 三条。
（另注：`SPEC.md` 文件头 `:10` 仍写「请把 §2 的 `wave-b-cloudsync.md` 行补上…」，
与实际做法不一致，属 `SPEC.md` 自身待清的旧提示，本分片不改主分片与 `SPEC.md`。）

**归属核对（更正原稿的误读）**：`ledger-v2.md:457` 的「（同波顺带）」行列的是 **`CS-08`**
（core-storage 簇），**不是** `S-CS-08`；`SPEC.md:22` 的 P1-S 清单
（`M-03` / `M-04` / `CS-02` / `CS-07` / `CS-08` / `B` / `S-D-02`）与台账逐项一致
⇒ **不存在原稿所说的「归属不一致」**。
准确表述是：**S-CS-08 本就未出现在 `ledger-v2.md` §10 的任何执行格里，本分片是它的首次 spec 化落点。**