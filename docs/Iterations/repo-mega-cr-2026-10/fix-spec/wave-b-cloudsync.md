# fix-spec 分片 · wave-b-cloudsync（云同步生命周期包）

> 基线：`main@fe79b781`（worktree `D:\Dev\nm-worktree\mcr`）。
> 本分片条目：**S-CS-07**（P1，备份三处吞错）· **S-CS-01**（P0，pull 后 rev 记到已关连接）·
> **S-CS-16**（P1，记账点位于 rebootstrap 之前，与 S-CS-01 同修法）· **S-CS-02**（P1，云同步单例不随
> rebootstrap 重建）· **D5 条件化**（`handleCloudSyncPull` 无条件 rebootstrap，拍板项 #9）·
> **S-CS-03**（P1，pull 入口不查 `isAgentActive`、不参与互斥）。
> 另含 **§6 #1 PushAgentMutex 未接线**的第二源复核结论（写成注记，不单列条目）。
> 撰写纪律：所有 file:line 于 `fe79b781` 工作区**亲自打开核对**，未照抄台账行号；
> 台账与 synth 的行号凡与本文不符，**以本文为准**（已在各处显式标注漂移）。

---

## 0 · 打包约束（本包必须同一 PR）

**为什么必须同 PR**：这六条不是六个独立 bug，而是**一条 pull 生命周期的六个断面**——
「换库文件 → 关连接 → 重建 runtime → 记账 → 放互斥令牌 → 后续请求复用单例」。
拆开 PR 会产生两类不可验收的中间态：

1. **只修 S-CS-02 不修 S-CS-01**：单例会重建了，但记账点仍在**这一代**已关的连接上 → pull 依旧必抛
   `CONNECTION_CLOSED`，P0 没修掉，且台账 §1 的最强印证（「UI 记成失败 + rev 永不推进」）原样成立。
2. **只修 S-CS-01 不修 S-CS-02**：记账这一次能写成功了，但**下一次** `getConfig` / `getLocalStatus` /
   `push` 仍然绑在死连接上 → 用户看到「拉取成功」之后云同步面板全线报错，比修之前更难解释。
3. **只做 D5 条件化不做 S-CS-02**：D5 只缩小 pull 路径的触发面，`ipc/handlers/backup.ts:48-50`
   的本地备份导入照样 rebootstrap，S-CS-02 的第二条触发面（且是与云同步 UI 完全无关的那条，
   用户表现是「我没碰云同步，云同步怎么坏了」）原样存在。

**唯一可独立先落的是 S-CS-07**：它只碰 `db-backup.service.ts` 的错误处理与读文件方式，
与 S-CS-01 引入的「连接换代信号」改动虽然同文件，但**可以先单独成一个提交**（见 §7 注记）。

**台账未拍板项**：D5 走「条件化」是 `ledger-v2.md` §7 拍板项 #9 的**默认建议**（原文：「按漏判处理
（条件化）。条件化不能替代 S-CS-02 的单例失效修复」）。本分片按默认案撰写；
若用户改选「保持无条件 rebootstrap」，本包其余五条**一条都不受影响**，只有 D5 一条作废
（§6 条目内已写明备选案差异）。

---

## 1 · S-CS-07 —— 桌面备份导入三处吞错 + 整包读入（**优先级最高，先落**）

- **严重度 / 簇**：P1 / cloudsync（apps-desktop 落点）。**本簇唯一不可逆本地数据丢失面**，
  台账 `§2.6` 已确认「优先级应高于同为 P1 的其它几条」（`synth/verify-cloudsync.md:126`）。

- **病症**：`importDatabaseBackupFromPath` / `importDatabaseBackupFromBytes` 两条路径上，
  **备份拷贝、失败回滚、删除回滚副本**三步的失败全部被 `.catch(() => undefined)` 吞掉。
  于是「备份失败 → 覆盖成功 → 还原三表失败 → 回滚也失败」这条链路上**没有任何一处会中断**，
  最终只 `throw` 一个原始错误，而磁盘上的库文件**已经是远端/导入的快照**了，
  `finally` 还把唯一可能的回滚副本删掉。下次 `getDesktopConnection()` 懒加载打开的就是那份内容，
  **本地未同步的改动无声消失**。此外校验步为了确认 16 字节 SQLite 魔数，把整份快照读进 Node 堆。

- **证据**（`apps/desktop/src/main/services/db-backup.service.ts`，本轮逐行核对）：

  ```
  104    const header = await readFile(srcPath, { encoding: null });   // 整包读入
  114      await copyFile(dbPath, bakPath).catch(() => undefined);     // 备份失败被吞
  115      await closeLiveDbForBackupImport();
  116      await copyFile(srcPath, dbPath);                            // 覆盖唯一真身
  125      await copyFile(bakPath, dbPath).catch(() => undefined);     // 回滚也被吞
  128      await unlink(bakPath).catch(() => undefined);               // 还删掉唯一回滚副本
  ```

  三处 `.catch` 各出现两次（`FromPath` 的 `:114/:125/:128` 与 `FromBytes` 的 `:155/:167/:170`），
  共六处。对照组 mobile 侧（**按事实写，原稿「mobile 没有吞」失准**）：
  mobile 的**备份步**（`apps/mobile/src/services/db-backup.service.ts:146`）确实是裸
  `await fs.cp(dbPath, bakPath)`，但**回滚步（`:162`）同样 `.catch(() => undefined)` 吞掉了**。
  mobile 之所以不致命，是因为它在回滚前先 `await fs.exists(bakPath)`（`:160-161`）
  且**从不删 bak** ⇒ 回滚失败时那份副本仍在盘上，用户还能手工救回。
  desktop 则是**三步全吞，且 `finally` 还把副本删掉** ⇒ 唯一退路被毁。
  ⇒ 这才是「桌面侧独有的回归形态」的准确含义。
  **mobile `:162` 的吞要不要一起改**：保留亦可（本包不动它），
  但**必须与 desktop 一样把回滚失败并入错误信息**——mobile 现在回滚失败同样是静默的，
  不得继续静默（与 desktop 同款口径，见修法第 6 步）。
  移动端 `:54-68` 甚至写了防呆注释「`fs.readFile(path, enc, 16)` 的第三参会被忽略，会整包读入，
  大备份必 OOM」，桌面 `:104` 是**直接整包 `readFile`**（无第三参），机理与注释描述不同但后果一致。

- **修法**（文件·函数级，全部在 `apps/desktop/src/main/services/db-backup.service.ts`）：

  1. 新增私有函数 `assertSqliteFileAtPath(srcPath: string): Promise<void>`：
     用 `node:fs/promises` 的 `open(srcPath, "r")` → `handle.read(buf, 0, 16, 0)` → `handle.close()`（`finally`），
     再复用既有 `assertSqliteFile(bytes)` 的魔数判定。**禁止** `readFile(path, enc, 16)`。
  2. `importDatabaseBackupFromPath`：把 `:104-105` 的整包读入换成 `await assertSqliteFileAtPath(srcPath)`。
  2bis. **`importDatabaseBackup`（`:208-237`）也改走路径级导入**（sr1-cloudsync-a M3/A8）：
     UI 导入入口现状是 `:234` 的 `const bytes = await readFile(pickedPath);`（**无 encoding 参数 ⇒
     整包进 Node 堆**）再于 `:235` 交给 `FromBytes`。修法 step 2 只点名 `:104-105`，
     `:234` 若原样保留，用户从「导入备份」对话框选一个 200MB 文件照样 OOM ⇒ 病症只修了一半。
     改法：删掉 `:234` 的整包 `readFile`，直接 `await importDatabaseBackupFromPath(pickedPath)`。
     - 导出签名 `Promise<"imported" | "cancelled">` **不变**；
     - `handlers/backup.ts:47` 的调用方**零改动**；
     - `db-backup-busy.test.ts:71` 那条走 `FromBytes` 直调，**不受影响**。
     这同时把 desktop 与 mobile 的导入形态彻底对齐（mobile `importDatabaseBackup:247`
     本来就是「pick 到本地路径 → FromPath」）。
  3. `importDatabaseBackupFromBytes`：保持 `assertSqliteFile(bytes)` 不变（内存态，无整包读盘问题）。
  4. 两条路径的备份步统一改成对齐 mobile 的形态：
     `if (await fileExists(dbPath)) { await copyFile(dbPath, bakPath); }`
     ——**裸 await，失败即抛，绝不 `.catch`**；`bakCreated` 置位。
  5. 两条路径的 `finally` 删除步改为：
     `if (bakCreated && !rollbackFailed) { await unlink(bakPath).catch(() => undefined); }`
     ——**回滚失败才必须留 bak**（此时库文件内容不可信，用户要手工救回）；
     回滚**成功**时 `dbPath` 已被还原成 bak 的内容，bak 冗余可删。
     ⇒ **上面那行代码片段才是对的**，本段散文以此口径为准
     （原稿写「回滚用过就必须留着」，与代码自相矛盾，属散文笔误，已按 sr1-cloudsync-a M4/A6 改正）。
     unlink 本身仍可吞（清理失败不是数据正确性问题），但要在 `.catch` 里 `console.error` 一行留痕。
     **作用域必须交代**：`let rollbackFailed = false` 声明在 **try 之外**（函数作用域前置声明），
     由回滚失败的分支置 `true`——写在 `catch` 块里的话 `finally` 根本读不到。
  6. 两条路径的 `catch` 块改为：
     ```
     } catch (error) {
       let rollbackError: unknown;
       try { await copyFile(bakPath, dbPath); } catch (e) { rollbackError = e; }
       if (rollbackError != null) {
         // 保留 bakPath 不删 + 显式告警 + 把回滚失败并入错误信息
         throw new Error(`数据库导入失败且回滚失败，回滚副本保留在 ${bakPath}`, { cause: [error, rollbackError] });
       }
       throw error;
     }
     ```
     ——回滚失败**不得**静默，必须让用户看得到「还有一份副本在哪」。
     **回滚语义的覆盖边界（sr1-cloudsync-a M2/A7，与 S-CS-01 Step 1 写死）**：本 step 6 的回滚
     **只覆盖「`:116` 覆盖动作本身失败」这一段**；三表 restore 失败（覆盖已成功）的处置由
     S-CS-01 Step 1 接管——**库已是新的，不回滚**，改为抛 `DatabaseReplacedError`
     （`providerTablesRestored: false`）。实现者不得两条都做（否则出现「db 已被回滚成旧库、
     handler 却按 databaseReplaced:true 重建」的语义错乱）。
  7. `assertSqliteBackupAtPath` 的 exists/size 形态（mobile `:58-68`）可作为 `fileExists` 辅助的参照，
     desktop 侧用 `node:fs/promises` 的 `access()` 或 `stat()` 实现。
  7bis. **测试缝（sr1-cloudsync-a M5/D7）**：desktop 测试基座是 `node:test` 零 mock 设施
     （实测 `apps/desktop/test/*.ts` 对 `mock.module`/`jest.mock`/`vi.mock` 零命中；既有唯一缝形态
     是改对象属性，见 `cloud-sync-handlers.test.ts:101`）。模块内聚 `const fsOps = { copyFile, unlink, open }`
     并导出 `__setDbBackupFsOpsForTest(ops)`（测试 finally 里恢复原实现）——本分片验收 1/2/4 的
     可测性前提。**本缝与 mobile 无关（mobile 是 jest，有 mock 设施）。**
  8. **本条不改任何导出函数的返回类型**（保持 `Promise<void>`；`__setDbBackupFsOpsForTest` 是
     新增测试缝不算改签名），
     以确保它能作为独立提交先落；返回类型改动归 S-CS-01。

- **验收**（可测断言 / 命令 + 期望）：

  1. 新增单测「备份拷贝失败 → 抛错，且**不**执行覆盖」：
     在 `${dbPath}.nmbackup.bak` 位置**预建一个同名目录** ⇒ `copyFile(dbPath, bakPath)` 必以
     `EISDIR/EPERM` 失败（Windows 安全的确定性构造——「目录改只读」在 Windows 上不拦写入，
     `attrib +r` 对目录无效，sr1-cloudsync-a A10），断言
     `importDatabaseBackupFromPath` reject，且 `resolveDbPath()` 指向的文件**内容未变**。
  2. 新增单测「回滚也失败 → 错误信息含 `bakPath`，且 bak 文件仍在磁盘上」：
     经 `__setDbBackupFsOpsForTest` 注入「还原三表失败 + 回滚拷贝失败」（见修法 7bis 的缝），
     断言 reject message 含备份路径，并 `fs.exists(bakPath) === true`。
  3. 新增单测「正常导入成功 → bakPath 被清理」：断言 `fs.exists(bakPath) === false`。
  4. 大文件不整包读入：断言 `assertSqliteFileAtPath` 内 `handle.read` 的实参为 `(buf, 0, 16, 0)`
     （**确定性断言**——把实现整段删掉必红；经 7bis 的缝注入探针 open 即可观测。
     原「200MB 假文件内存峰值观测」已删：撞 RULE「性能护栏取数量级回归线，不拿实测值卡线」，CI 噪声下失去判别力）。
  5. 命令与期望：
     `cd apps/desktop && npx tsc --noEmit` → 0 错误；
     `cd apps/desktop && npm test` → 与 `baseline.md` 已知红清单一致、无新增红。

- **测试策略**：

  - 新增测试文件：`apps/desktop/test/db-backup-rollback-safety.test.ts`
    （沿用 `db-backup-busy.test.ts` 的 `setupDesktopDbTestEnv` / `teardownDesktopDbTestEnv` 夹具形态）。
  - 用例名（拟）：
    - `备份拷贝失败时抛错且不覆盖活动库文件`
    - `回滚拷贝失败时错误信息含备份路径且副本保留在磁盘`
    - `正常导入成功后回滚副本被清理`
    - `assertSqliteFileAtPath 只读前 16 字节（不整包读入）`
  - 改动测试文件：无（既有测试不动）。

- **回归线**（必须保持绿）：

  - `apps/desktop/test/db-backup-busy.test.ts` —— 3 条（`直接调 exportDatabaseBackupToPath 期间 busy=true`、
    `直接调 importDatabaseBackupFromBytes 期间 busy=true`、`最外层流程令牌…（含重建窗口完整互斥）`）。
    这三条真实跑 import 链路，改了备份/回滚/删 bak 的形态后它们必须仍绿。
  - `apps/desktop/test/db-backup-export-dialog.test.ts` —— 1 条（默认名 + filters）。
  - `apps/desktop/test/cloud-sync-handlers.test.ts` —— 3 条（依赖云同步 service 可构造）。

- **依赖**：条目间**无前置**。**分片级前置**：`baseline.md`(S1) 出具
  （`state.md` 显示 `s-baseline` 仍是 `pending`，本条又声明「可独立先落」，
  若它先落而 baseline 未出，验收 5 的「无新增红」无定义）。
  **未出时的降级验收口径**：先跑 `cd apps/desktop && npx tsc --noEmit` 与新增测试文件
  （`db-backup-rollback-safety.test.ts`）的定向跑，`npm test` 全量判增量待 S1 补齐。
  **被依赖**：S-CS-01 的「连接换代信号」要落到本文件同两个函数，
  但那是后续提交，顺序见 §7。

- **风险与回滚**：

  - 风险 R1：把 `.catch` 去掉后，原本被吞掉的失败**开始会冒泡到 UI**。
    这是本条的目的，但要确认失败形态对用户可读（错误信息是中文、带路径）。
  - 风险 R2：回滚失败时不再删 bak，会在用户磁盘上留 `.nmbackup.bak`（与 mobile 现有一致）。
    需要在错误信息里明确告知路径，否则用户不知道那是什么文件——本条的修法第 6 步已包含。
  - 风险 R3：首次导入时 `dbPath` 尚不存在（全新安装直接导入备份）。
    修法第 4 步的 `if (await fileExists(dbPath))` 就是为此；回归线上 `db-backup-busy.test.ts:71`
    用例是「先导出再导入」，走不到这条分支，需在新增用例里显式覆盖。
  - 回滚：本条是纯错误处理改动，`git revert` 单个提交即可，无数据迁移、无配置变更。

---

## 2 · S-CS-01 —— pull 成功后的 rev 记账写进一条已被 pull 自己关掉的连接（P0）

- **严重度 / 簇**：P0 / cloudsync。全台账唯一「库文件已换但 UI 记成失败 + rev 永不推进」的功能线断裂。

- **病症**：`coordinator.pull()` 内部会调用 `dbSync.importSnapshotFromPath` →
  `importDatabaseBackupFromPath` → **关掉本进程那条连接并替换库文件**。
  函数返回后，`pull()` 紧接着用 `this.configStore` 写 `lastSyncedRev` 与 `recordPull`，
  而这个 `configStore` 是**构造函数里**用 `runtime.kkv` / `runtime.secretStore` 建的，
  `runtime.kkv` 绑的正是刚被关掉的那条连接 ⇒ 必抛 `TdbcError("CONNECTION_CLOSED")`。
  后果两条：① 抛错发生在 `recordPull` **之前**，走 `catch` 分支记成「拉取失败」，
  **而库文件其实已经换掉了**；② `lastSyncedRev` 永不推进，下次打开仍是旧 rev ⇒ **反复拉同一 rev**。

- **证据**（本轮在 `fe79b781` 工作区逐行核对；台账 `§2.6` / `synth/cloudsync.md:136` 的行号**已漂移**，
  以本文为准）：

  `apps/desktop/src/main/services/cloud-sync.service.ts`：
  ```
  159    constructor(runtime: DesktopNovelMasterRuntime) {
  161      this.configStore = createCloudSyncConfigStore(runtime.kkv, runtime.secretStore);  // 构造期绑死
  ...
  252      const result = await built.coordinator.pull({ lastSyncedRev: meta.lastSyncedRev });
  255      await this.configStore.setLastSyncedRev(result.rev);      // ← 写已关连接
  256      await this.configStore.recordPull(true, `已同步至 rev ${result.rev}`);
  ```

  死句柄的来源链（本轮逐跳确认）：
  `cloud-sync.service.ts:403-408` `importSnapshotFromPath` →
  `db-backup.service.ts:99` `importDatabaseBackupFromPath` →
  `db-backup.service.ts:32-35` `closeLiveDbForBackupImport()`：
  ```
  32  async function closeLiveDbForBackupImport(): Promise<void> {
  33    clearDesktopRuntimeHandle();
  34    await closeDesktopConnection();      // conn.close() 之后 conn = undefined
  ```
  `apps/desktop/src/main/runtime/connection.ts:50-54` `closeDesktopConnection` → 后续任何 `execute`
  在 `packages/tdbc-driver-better-sqlite3/src/connection.ts:155` 抛 `TdbcError("CONNECTION_CLOSED", …)`。

  mobile 侧同构（`apps/mobile/src/services/cloud-sync.service.ts`）：
  ```
  340      const result = await coordinator.pull({ lastSyncedRev: local.lastSyncedRev });
  341      await patchCloudSyncLocalStatus(runtime, { lastSyncedRev: result.rev, ... });  // ← runtime 是旧代
  ...
  346      onRebootstrap();       // 重建在这之后
  ```
  `runtime` 来自 `apps/mobile/src/screens/stack/CloudSyncProgressScreen.tsx:107` 的
  `pullCloudSync(runtime, retry, …)`，即 `useNovelMaster().runtime`；
  而 `apps/mobile/src/services/db-backup.service.ts:150` 已 `await closeMobileConnection()`。

- **修法**（引入「连接换代信号」，让记账点天然落在重建之后）：

  **Step 1 · 两端 import 函数返回换代信号**（`apps/desktop/src/main/services/db-backup.service.ts`
  与 `apps/mobile/src/services/db-backup.service.ts`）：
  ```
  export type DbImportOutcome = {
    /** 活动库文件是否已被替换（true ⇒ 调用方持有的 runtime/conn 一律作废，必须先重建再用）。 */
    databaseReplaced: boolean;
    /** 服务商三表是否已在本机恢复成功（false ⇒ 数据库已换但三表丢失，需 UI 提示）。 */
    providerTablesRestored: boolean;
  };
  ```
  `importDatabaseBackupFromPath` / `importDatabaseBackupFromBytes` 返回 `Promise<DbImportOutcome>`：
  - 一路成功走到收尾 ⇒ 返回 `{ databaseReplaced: true, providerTablesRestored: true }`；
  - **三表 restore 抛错但数据库已换 ⇒ 抛 `DatabaseReplacedError`**（携带 `providerTablesRestored: false`
    与可读信息。**函数抛错时返回值送不到调用方**——「已换代」信号在这条路径上必须由异常类型承载
    〔sr1-cloudsync-b G1〕，调用方 catch 里 `instanceof DatabaseReplacedError` 即知库已换。
    **不能再走 S-CS-07 修法第 6 步的「回滚」**，因为库已经是新的）。

  与返回值配套的异常类型（两端 db-backup.service.ts 各自定义或下沉 core 共享）：
  ```
  /** 库文件已换代、其后收尾步骤失败：信号随异常送达（成功路径走 DbImportOutcome 返回值）。 */
  export class DatabaseReplacedError extends Error {
    readonly databaseReplaced = true as const;
    constructor(message: string, readonly providerTablesRestored: boolean) {
      super(message); this.name = "DatabaseReplacedError";
    }
  }
  ```

  **Step 2 · core 端口与 coordinator 透传**：
  - `packages/core/src/infra/cloud-sync/ports/db-sync.port.ts`：
    `importSnapshot` / `importSnapshotFromPath` 的返回类型由 `Promise<void>`
    改为 `Promise<{ databaseReplaced: boolean } | void>`（`void` 兼容既有 mock 与测试桩）。
  - **两端 dbSync 适配器必须 `return` 备份函数的返回值**（sr1-cloudsync-a M1，漏改即静默退化）：
    desktop `cloud-sync.service.ts:397-402`（`importSnapshot`）与 `:403-408`（`importSnapshotFromPath`）
    现状都是「`await importDatabaseBackupFrom…(…);` 后直接结束」——必须改成 `return await …`；
    mobile `cloud-sync.service.ts:222-227` 与 `:228-233` 同样处理。
    **不 return 完全合法、零类型错误**，但运行时 `databaseReplaced === undefined` ⇒ handler 永不
    rebootstrap ⇒ P0 原样复发且编译全绿。mobile 的 `FromBytes`（`db-backup.service.ts:187`）
    委托 `FromPath`，必须把 `DbImportOutcome` **透传**出来（这一层委托也漏不得）。
  - `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` 的 `pull()`：
    记下两条 import 分支的返回值，**统一返回** `{ rev: remote.rev, databaseReplaced }`，
    并把 `PullResult` 类型加上 `databaseReplaced: boolean`。

  **Step 3 · desktop 记账移到重建之后**：
  - `DesktopCloudSyncService.pull()` 的返回类型改为
    `Promise<{ rev: number; databaseReplaced: boolean }>`；
    **成功且 `databaseReplaced === true` 时不在此处记账**（原 `:255-256` 两行移走）；
    失败分支与 `ALREADY_UP_TO_DATE` 早返回分支**保持记账不变**（此时连接仍是活的，见下方注记）；
    返回类型一改，`:257` 的 `return result` 与 `:262` 的早返回对象**都要带上 `databaseReplaced`**
    ——`:257` 靠 `result` 透传、`:262` **恒为 `false`**（库没换、连接没关）。
    两处都必须在 spec 里点名（`PullResult` 加必填字段后 tsc 必拦，spec 先写全——G3；
    sr1-cloudsync-a M6/B5）。
  - 新增 `DesktopCloudSyncService.recordPullSuccess(rev: number): Promise<void>`：
    内部**每次 `await getDesktopRuntime()` 现取 runtime** 并 `createCloudSyncConfigStore(rt.kkv, rt.secretStore)`
    现场构造 store，再写 `setLastSyncedRev(rev)` + `recordPull(true, …)`。
    （这一步依赖 S-CS-02 的「不持 runtime 句柄」改造，两条合流，见 §4。）
  - `apps/desktop/src/main/ipc/handlers/cloud-sync.ts` 的 `handleCloudSyncPull` 改为：
    ```
    const result = await service.pull();
    if (result.databaseReplaced) {
      const rt = await rebootstrapDesktopRuntime();          // 先换库 → 再重建
      await service.recordPullSuccess(result.rev);            // 用重建后的 runtime 记账
    }
    return { ok: true, data: result };
    ```
    `CloudSyncPullResult`（`apps/desktop/shared/ipc-types.ts:1735-1737`）**不扩字段**——
    handler 内部判定即可，渲染层零改动。
    **catch 分支同步改造**（现状外层 `:93` catch 不重建直接返回错误）：`err instanceof DatabaseReplacedError`
    ⇒ 先 `await rebootstrapDesktopRuntime()`（runtime 换代优先于报错），再返回带
    `providerTablesRestored` 信息的失败结果——**库已换却不重建比记账失败更糟**（G1/G2；
    desktop 的 `closeLiveDbForBackupImport():115` 跑在三表 restore `:120` 之前，这条路径不是理论风险）。
    注意 `DatabaseReplacedError` 需从 `service.pull()` 内部**原样透传**（coordinator → service → handler
    一路不吞类型）。

  **Step 4 · mobile 契约变更（这是本条真正的难点，必须写清）**：
  - 现状阻塞点：mobile 的 `onRebootstrap` 是 `useNovelMaster().retry`，
    签名 `() => void`（`apps/mobile/src/runtime/novel-master-context.tsx:153-155`），
    它只是 `setBootToken(t => t + 1)`，**真正的 runtime 重建发生在随后的 `useEffect` 里**（`:157-219`），
    因此 `pullCloudSync` 在 `onRebootstrap()` 之后**同步拿不到新 runtime**。
  - 修法：把 `retry` 扩成可等待形式。
    `apps/mobile/src/runtime/novel-master-context.tsx`：
    新增 `retryAndWait: () => Promise<MobileNovelMasterRuntime>`，
    实现为「`useRef` 持一个 `{resolve, reject}` 槽 → `setBootToken` → 在 effect 里
    `createMobileNovelMasterRuntime()` 成功并 `setRuntime(runtime)` 之后 `resolve(runtime)`，
    catch 分支 `reject`，`cancelled` 早返回分支也 `reject`（避免 promise 永挂）」。
    保留原 `retry: () => void` 不动（其它消费方不受影响）。
  - `apps/mobile/src/services/cloud-sync.service.ts` 的 `pullCloudSync`：
    签名第三参改为 `onRebootstrap: () => Promise<MobileNovelMasterRuntime>`；
    成功分支改为
    ```
    const result = await coordinator.pull({ lastSyncedRev: local.lastSyncedRev });
    if (result.databaseReplaced) {
      const fresh = await onRebootstrap();                       // 先重建
      await patchCloudSyncLocalStatus(fresh, { lastSyncedRev: result.rev, lastPullAt: now, lastPullResult: 'success' });
    } else {
      await patchCloudSyncLocalStatus(runtime, { lastPullAt: now, lastPullResult: 'already_up_to_date' });
    }
    ```
    并把「用于 catch 分支记账的 runtime」也换成 `fresh`（用 `let accountingRuntime = runtime` 跟踪；
    **catch 里若 pull 已换代〔`err instanceof DatabaseReplacedError` 经 coordinator 透传上来〕，
    先 `await onRebootstrap()` 再记账——G2：原稿只在成功分支换代，失败分支仍旧死写**；
    mobile 的 runtime 是 React state、没有 desktop `getDesktopRuntime()` 懒建自愈
    〔`novel-master-context.tsx:202` + `db/connection.ts` 模块级 conn 已关〕，
    不补这条，一次失败 pull 之后整个 App 带着已关 runtime 跑到用户手动重启），
    避免 catch 路径又写回死句柄（这正是 `synth/verify-cloudsync.md:138-149` 记的那条 mobile 派生缺陷）。
    catch 分支的 `patchCloudSyncLocalStatus(...)` 外面补 `.catch(() => undefined)`
    （对齐 desktop `:265` 的吞错形态，记账失败不得再抛——verify-cloudsync 点名的对齐项，G2）。
  - `apps/mobile/src/screens/stack/CloudSyncProgressScreen.tsx:36` 改取 `retryAndWait` 传给 `pullCloudSync`。

  **契约写进文件头注释**：两端 `cloud-sync.service.ts` 与 `db-backup.service.ts` 的文件头/函数头
  补一句「**换库 → 重建 runtime → 用新 runtime 记账 → 再放互斥令牌**」；
  现有注释已经写清了令牌边界（`db-backup.service.ts:67-70` / `cloud-sync.service.ts:82-86`），
  在其旁边补记账边界即可。

- **验收**（可测断言 / 命令 + 期望）：

  1. **P0 的核心断言（desktop，真实驱动）**：先给 `buildCoordinator`（`cloud-sync.service.ts:411-426`）
     加**可选 storage 注入参数**（仅测试用。现状静态 import `createS3ObjectStorage` 且内部自造 storage、
     desktop 无 mock 框架依赖——不加这条 seam，端到端断言今天做不出来〔sr1-cloudsync-b G4〕）。
     然后用 `apps/desktop/test/desktop-db-test-env.ts` 起一个真库、注入内存版 storage 往远端放一份 rev=2 的快照，
     调用 `handleCloudSyncPull()`，断言：
     - 返回 `ok: true`（**不是** `CONNECTION_CLOSED`）；
     - 随后 `handleCloudSyncGetLocalStatus()` 返回的 `lastSyncedRev === 2`；
     - `lastPullResult` 以「成功」开头；
     - **连续两次 pull，第二次命中 `ALREADY_UP_TO_DATE` 而非「再拉一遍 rev 2」**（这是
       「rev 永不推进」这条主症状的直接反证）。
  2. **mobile 等价断言**：Jest 用真实 `runtime.kkv`（或抛出 `CONNECTION_CLOSED` 的探针 kkv），
     断言 `patchCloudSyncLocalStatus` 被调用时传入的是 **`retryAndWait` 返回的新 runtime**，
     且 `lastSyncedRev: 3` 落库。
  3. `importDatabaseBackupFrom*` 返回值断言：成功路径 `databaseReplaced === true`；
     在「三表 restore 抛错」注入下**抛 `DatabaseReplacedError`**（`err.databaseReplaced === true`、
     `err.providerTablesRestored === false`）且错误信息可读；
     注入该错误跑 `handleCloudSyncPull()` ⇒ 仍完成 `rebootstrapDesktopRuntime()`（catch 分支 G1 断言）。
  4. 命令：`cd packages/core && npx tsc --noEmit` → 0 错误；
     `cd apps/desktop && npm test` / `cd apps/mobile && npm test -- --maxWorkers=2`
     → 对照 `baseline.md` 已知红清单，无新增红。

- **测试策略**：

  - 改动测试文件：
    - `packages/core/test/cloud-sync/coordinator.test.ts`
      —— `pull()` 返回值多带 `databaseReplaced`；既有 3 条 pull 用例（`CS-P1`、`CS-P1b`、`CS-P2`）
      的断言需同步扩展（mock 的 `importSnapshot` 目前返回 `undefined`，走 `void` 兼容分支，
      `databaseReplaced` 落 `false`，**必须显式改 mock 返回 `{ databaseReplaced: true }` 并断言**，
      否则这条测试会假绿）。
    - `apps/desktop/test/cloud-sync-handlers.test.ts` —— 补上面验收 1 的端到端用例。
    - `apps/mobile/__tests__/cloud-sync.service.test.ts` —— 现有 3 条 `pullCloudSync` 用例
      （`拉取成功时更新 lastSyncedRev 并触发 rebootstrap` / `ALREADY_UP_TO_DATE 时不触发 rebootstrap` /
      `未配置时抛 NOT_CONFIGURED`）需按新签名与新顺序改写。
  - 新增测试文件：
    - `apps/mobile/__tests__/cloud-sync-runtime-generation.test.ts`
      用例名（拟）：
      - `pull 成功后记账使用 onRebootstrap 返回的新 runtime（旧 runtime 探针抛 CONNECTION_CLOSED 时仍成功）`
      - `databaseReplaced=false 时不触发 onRebootstrap 且记账走旧 runtime`
      - `catch 分支的记账不再使用已作废的 runtime`
    - `apps/desktop/test/cloud-sync-pull-accounting.test.ts`
      用例名（拟）：
      - `pull 成功后 lastSyncedRev 推进且第二次 pull 命中 ALREADY_UP_TO_DATE`
      - `databaseReplaced=false 时 handler 不调用 rebootstrapDesktopRuntime`

- **回归线**：

  - `packages/core/test/cloud-sync/coordinator.test.ts` 全 **17** 条
    （`CS-P1`/`CS-P1b`/`CS-P2`/`CS-P3`~`CS-P6`、`CS-P5b`、
    `forceOverwriteRemote 跳过 rev 检查`、`T-SC10a`~`T-SC10e`、`PushAgentMutex 单元` 3 条；
    枚举即权威，原稿「20 条」是计数笔误，数字错会让「逐条复跑」失去锚点）。
  - `packages/core/test/cloud-sync/lock.test.ts`。
  - `apps/desktop/test/cloud-sync-handlers.test.ts` 既有 3 条
    （`getConfig 在未配置时返回空字段`、`setConfig 与 getLocalStatus 可往返`、
    `pull 前置 getLocalMeta 抛错后 syncBusy 复位 false`）——最后一条依赖 `pull()` 仍调 `getLocalMeta`，
    改动不得把它挪出 try。
  - `apps/desktop/test/db-backup-busy.test.ts` 全 3 条。
  - `apps/mobile/__tests__/db-backup.service.test.ts` 全量（含 `ic-20: 上层 importDatabaseBackup 外层计数兜底`）。
  - `apps/mobile/__tests__/cloud-sync-config.service.integration.test.ts`
    （`未配置时 pullCloudSync / pushCloudSync 抛 NOT_CONFIGURED`）。

- **依赖**：

  - **S-CS-07 必须先落**（同文件，先把错误处理改干净，再在上面加返回信号）。
  - **S-CS-02 必须在同一 PR 内落**（desktop 的 `recordPullSuccess` 依赖「每次现取 runtime」的改造；
    mobile 的 `retryAndWait` 是同一族改造）。
  - **S-CS-16 与本条同一修法**，不单独成立（见 §3）。
  - 拍板项：无（S-CS-01 是 P0，不等任何拍板项）。
  - 与 wave-a/wave-c 无耦合；与 `baseline.md` 的已知红基线对照。

- **风险与回滚**：

  - 风险 R1（**最高**）：**mobile 的 `retryAndWait` 是新增契约**，若 provider 的 `cancelled`
    早返回分支漏 `reject`，调用方会**永挂**在 `await onRebootstrap()`，
    外层 busy 令牌（`pullCloudSync:317` 的 `acquireMobileDbMaintenanceBusy`）永不 release
    ⇒ **后台归一/压缩循环全进程停摆**（即 S-CS-04 那类后果）。
    ⇒ 缓解：`onRebootstrap()` 外面必须再包一层 `Promise.race` 超时兜底（或至少在 `finally` 里
    已有 `releasePullBusy` 兜住 —— 现有 `finally:366-370` 确实会执行，所以最坏是调用挂住、
    令牌已放；**但 UI 进度条会卡在运行态**，所以仍要给 `retryAndWait` 加 reject 分支 + 超时）。
  - 风险 R2：desktop `handleCloudSyncPull` 现在要 await 两次（pull + rebootstrap + 记账），
    重建窗口比原来长一点，但**外层 busy 令牌在 `finally:96` 才 release**，
    窗口仍被完整覆盖（与 `db-backup-busy.test.ts:101-127` 钉的时序一致），**不得**把 release 提前。
  - 风险 R3：`DbSyncPort` 返回类型放宽为 `... | void`，会让调用点的空值处理变得松散。
    约定：`databaseReplaced == null` 一律按 `false` 处理（保守：不重建），
    并在 `db-sync.port.ts` 的 JSDoc 写死这条默认口径。
  - 回滚：`git revert` 本条 + S-CS-16 + S-CS-02 三个提交（它们互相依赖，**不可单独 revert 其中之一**）。

---

## 3 · S-CS-16 —— rev 记账点位于 rebootstrap 之前（与 S-CS-01 同一修法）

- **严重度 / 簇**：P1 / cloudsync。台账 `§2.6` 明确「**与 P0 S-CS-01 同一修法，合并成一个 PR**」。

- **病症**：即使把 S-CS-01 的「写已关连接」解决掉，**记账的先后顺序本身仍是错的**：
  mobile 侧 `patchCloudSyncLocalStatus` 在 `onRebootstrap()` **之前**，
  desktop 侧在 handler 的 `rebootstrapDesktopRuntime()` **之前**。
  两个 handle 在记账那一刻**绑的仍是即将被 rebootstrap 整体作废的那一代**——
  契约应当是「**先换库 → 再重建 runtime → 用新 runtime 记账 → 再放令牌**」。
  **必须把时点说准（sr1-cloudsync-a M6/B1）**：在**基线 `fe79b781` 上，两个 handle 在记账那一刻
  已经是死句柄**——desktop `cloud-sync.service.ts:255` 背后的 conn 已被
  `db-backup.service.ts:115` 的 `closeLiveDbForBackupImport()` 关掉，mobile `:341` 的 runtime
  背后的 conn 也已被 `mobile db-backup.service.ts:150` 的 `closeMobileConnection()` 关掉，
  两处记账句柄在基线上都必抛 `CONNECTION_CLOSED`（这正是 §2 S-CS-01 的 P0 病症）。
  「绑错代」是**S-CS-01 修完之后**才暴露的残余面：那时 handler 会先重建 runtime，
  记账句柄**重获可用**，但它写的仍是即将被作废的那一代。
  ⇒ **S-CS-16 不是独立于 S-CS-01 的第二条缺陷，而是它的残余面**（本节修法即写明「不新增修法」）。
  实现者不要去构造「基线上能写成功但写错代」的窗口——那个窗口不存在，测试也构造不出来。

- **证据**（本轮核对）：

  `apps/desktop/src/main/services/cloud-sync.service.ts`：
  ```
  255      await this.configStore.setLastSyncedRev(result.rev);   // service 内记账
  ...
  apps/desktop/src/main/ipc/handlers/cloud-sync.ts
  91      await rebootstrapDesktopRuntime();                        // handler 才重建
  ```
  `apps/mobile/src/services/cloud-sync.service.ts`：
  ```
  341      await patchCloudSyncLocalStatus(runtime, {...});   // 记账（rebootstrap 之前）
  346      onRebootstrap();                                  // 重建（之后才换 runtime）
  348      releasePullBusy();                                // 令牌在重建之后放（这一半是对的）
  ```
  **令牌边界本身正确且是刻意设计**（ic-20 拍板）：
  `handleCloudSyncPull` 的注释（`handlers/cloud-sync.ts:82-86`）与
  `db-backup.service.ts:95-97` 都写明「release 严格在 rebootstrap 完成之后」，
  `db-backup-busy.test.ts:101-127` 有专门用例钉住。**错的只有记账点位置**，不要动令牌边界。

- **修法**：**不新增修法**。S-CS-01 的 Step 3 / Step 4 已经把记账点搬到了 `rebootstrapDesktopRuntime()` /
  `onRebootstrap()` 之后，并用重建后的 runtime 记账。本条目作为 S-CS-01 的**验收子项**存在：

  1. 在两端 `cloud-sync.service.ts` 的**函数头注释**里，把契约写成四步：
     「换库 → 重建 runtime → 用新 runtime 记账 → 再放互斥令牌」，
     紧挨现有的令牌边界注释（`handlers/cloud-sync.ts:82-86` / `db-backup.service.ts:95-97`）。
  2. mobile 的 `ALREADY_UP_TO_DATE` 分支（`cloud-sync.service.ts:352-359`）**不调用** `onRebootstrap()`，
     记账走旧 runtime —— 这是**正确的**（库没换、连接没关），
     但要在注释里写明「这条分支不换代，所以记账可以用旧 runtime」，
     否则下一个维护者会误以为这里也漏了。
  3. desktop 的 `ALREADY_UP_TO_DATE` 早返回（`cloud-sync.service.ts:259-263`）同理保留在 service 内记账；
     该早返回对象里的 `databaseReplaced` **恒为 `false`**（库没换、连接没关），
     与 §2 Step 3 中「`:257` / `:262` 两条 return 都要带 `databaseReplaced`」是同一条要求
     （交叉引用：§2 Step 3 · sr1-cloudsync-a M6/B5），实现时两处一起改。

- **验收**：

  1. 源码断言：新增一条「契约注释存在」的结构测试不是必须的（过度），
     改为 **review 验收点**：`git diff` 中两端 `cloud-sync.service.ts` 的函数头注释必须出现
     「重建」与「记账」两个词的先后顺序。
  2. 行为断言（与 S-CS-01 验收 1 合并）：`ALREADY_UP_TO_DATE` 分支**不换代**，
     且该分支的 `lastPullResult` 正确记为「已是最新」。
     - **前半（不换代）不用 spy，改用同源可观测面**（sr1-cloudsync-a M10/B7）：
       desktop 侧断言 `await getDesktopRuntime()` 返回的**对象身份**在 `handleCloudSyncPull()`
       前后**不变**。rebootstrap 必然产生新 runtime 对象
       （`desktop-runtime-singleton.ts` 每次重建都 `new` 出来），
       所以「身份不变」这个断言恰好抓住「不该 rebuild 却 rebuild 了」的回归方向。
       **不得**写成「对 `rebootstrapDesktopRuntime` 打 spy 计数」——desktop 测试基座是
       `node:test` 零 mock 设施（`run-tests.mjs` → `tsx --test`），而它对 handler 是
       ESM 具名 import（`handlers/cloud-sync.ts:13`），没有可注入缝，这条 spy 按字面不可执行。
       mobile 侧同理：该分支**不调用** `retryAndWait`（Jest 有 mock 设施，可 spy）。
     - **后半（有牙）**：直接经 `handleCloudSyncGetLocalStatus()` 读 `lastPullResult`，无需任何注入。

- **测试策略**：

  - 改动测试文件：`apps/mobile/__tests__/cloud-sync.service.test.ts` 的
    `ALREADY_UP_TO_DATE 时不触发 rebootstrap` 一条 → 改名并强化为
    `ALREADY_UP_TO_DATE 时不调用 onRebootstrap 且记账走旧 runtime`。
  - 新增：`apps/desktop/test/cloud-sync-pull-accounting.test.ts` 补一条
    `ALREADY_UP_TO_DATE 早返回不调用 rebootstrapDesktopRuntime`。
  - 无新增测试文件。

- **回归线**：同 S-CS-01 的回归线全集（本条不引入新面）。

- **依赖**：**S-CS-01**（本条是它的子项，不可独立成立、不可独立 revert）。
  **分片级前置**：同 §1 依赖字段——`baseline.md`(S1) 出具；未出时先跑
  `npx tsc --noEmit` 与新增/改动测试的定向跑，`npm test` 全量判增量待 S1 补齐。
  本条的回归线是 S-CS-01 回归线全集，所以这个前置对 §1 与 §3 是同一条。

- **风险与回滚**：无独立风险；随 S-CS-01 一起回滚。

---

## 4 · S-CS-02 —— 桌面云同步 service 单例不随 rebootstrap 重建

- **严重度 / 簇**：P1 / cloudsync（apps-desktop 落点）。这是 S-CS-01 的**永久化版本**：
  S-CS-01 是一次抛错，本条是**整条功能线报废到重启应用为止**。

- **病症**：模块级 `let service` 只在首次 `getDesktopCloudSyncService()` 时构造。
  每次调用虽然都 `await getDesktopRuntime()`，但**只在 `!service` 时**才用新 runtime 构造
  ⇒ rebootstrap 之后拿到的是「**新 runtime 外面套着旧 service**」。
  旧 service 的 `configStore` 绑旧 `kkv`，而 `buildCoordinator` 里的 `dbSync` 用的也是 `this.runtime`
  （旧 runtime）。两条 rebootstrap 生产路径都能触发：
  `ipc/handlers/cloud-sync.ts:91`（pull 之后）与 `ipc/handlers/backup.ts:48-50`（本地备份导入之后）。

- **证据**（本轮核对 `apps/desktop/src/main/services/cloud-sync.service.ts`）：

  ```
  159    constructor(runtime: DesktopNovelMasterRuntime) {
  160      this.runtime = runtime;                                       // ← 死 runtime
  161      this.configStore = createCloudSyncConfigStore(runtime.kkv, runtime.secretStore);
  ...
  378      const runtime = this.runtime;                                 // ← buildCoordinator 里的第二个死句柄
  ...
  432  let service: DesktopCloudSyncService | undefined;
  434  export async function getDesktopCloudSyncService() {
  438    const runtime = await getDesktopRuntime();                       // 每次都取，但
  439    if (!service) { service = new DesktopCloudSyncService(runtime); } // ← 只在空时用新 runtime 构造
  446  /** 测试用：重置单例与忙碌状态 */
  447  export function resetDesktopCloudSyncServiceForTest(): void {     // 全仓唯一的清位入口
  ```

  清位入口的生产消费方：**零**。本轮全仓 grep（排除 `dist` / `node_modules`）
  `resetDesktopCloudSyncServiceForTest` 只命中定义处 `:446` 与
  `apps/desktop/test/cloud-sync-handlers.test.ts:5,6,25,29`、
  `apps/desktop/test/db-maintenance-handlers.test.ts:4,32,37` —— **三个测试文件**
  （原稿漏了第三个，sr1-cloudsync-c MF-C1 补正）。
  **结论不变：生产代码零命中**。第三个文件同样只是测试侧的重置调用点，
  不影响「生产零消费」这个判断，但引用必须补全——否则读者会以为它不在影响面内。
  对照 `apps/desktop/src/main/runtime/desktop-runtime-singleton.ts:35-38`：
  ```
  35  export async function rebootstrapDesktopRuntime(): Promise<DesktopNovelMasterRuntime> {
  36    await resetDesktopRuntimeForTest();
  37    return getDesktopRuntime();
  ```
  它只清 `runtime` / `conn`，**完全不碰 service**。

  **注意 synth 的第二个死句柄**（`synth/verify-cloudsync.md:36-59`，本轮复核成立）：
  `this.runtime` 经 `:378` 流进 `dbSync.exportSnapshotToPath`（`:391-396`）→
  `db-backup.service.ts:78` `checkpointDesktopDatabase(runtime.conn)` ⇒
  **死连接上的 `PRAGMA wal_checkpoint`**。所以报废面比台账原文描述的更大：不只是读接口。

- **修法**（二选一，**推荐 A**，B 作为备选案差异注记）：

  **方案 A（推荐）：单例按 runtime 身份重建**。
  1. `DesktopCloudSyncService` 增加 `private readonly runtimeIdentity: object`（构造时记 `runtime` 本身）。
     **不新增 `currentRuntime()` 访问器**（sr1-cloudsync-c MF-C2）——service 整体按代重建后，
     `this.runtime` 恒为当代 runtime，再加一个同义访问器只会把「读哪一份」讲成二义。
  2. `getDesktopCloudSyncService()` 改为：
     ```
     const runtime = await getDesktopRuntime();
     if (service == null || service.runtimeIdentity !== runtime) {
       service = new DesktopCloudSyncService(runtime);
     }
     return service;
     ```
     ——rebootstrap 产生的是**新 runtime 对象**，身份比较天然成立；无需任何调用点配合，
     且**本地备份导入路径（`backup.ts:49`）自动被覆盖**。
  3. **service 内一律 `this.runtime` / `this.configStore`，不加 `store()` getter**。
     唯一跨代的是 S-CS-01 Step 3 的 `recordPullSuccess`，它**必须现取**（每次
     `await getDesktopRuntime()` 现场造 store，因为 handler 在 rebootstrap **之前**捕获的
     `service` 仍是旧代实例，身份比较救不了旧实例上的方法调用）。
     这一条不再有「若采纳第 2 步这一步可省」的二义——方案 A 是推荐案，第 2 步必采纳。
  4. `resetDesktopCloudSyncServiceForTest` 保留原语义（测试用），**另导出**
     `invalidateDesktopCloudSyncService(): void` 作为生产版清位入口（供将来手动降级用），
     本条不把它挂到 `rebootstrapDesktopRuntime()` 上——**挂上去会形成
     `runtime-singleton → cloud-sync.service` 的静态环**（service 已经动态 import runtime-singleton），
     静态环会破坏 `db-backup-busy.test.ts` 的导入顺序。

  **方案 B（备选，synth 建议的原案）**：在两个 handler 的 `rebootstrapDesktopRuntime()` 之后
  显式调 `invalidateDesktopCloudSyncService()`。差异：① 要改两个调用点，未来新增 rebootstrap
  路径**容易再漏**；② 仍然不能解决「service 在一次 pull 内部跨代」的问题（S-CS-01 需要跨代记账）。

  **共同的必要动作**：把 `cloud-sync.service.ts:432-449` 的模块头注释补上
  「本单例与 runtime 同寿命；runtime 换代时必须重建」。

- **验收**：

  1. **核心断言（复现台账描述的用户侧故障）**：
     ```
     await handleCloudSyncPull()          // 或直接 rebootstrapDesktopRuntime()
     const s1 = await getDesktopCloudSyncService();
     await rebootstrapDesktopRuntime();   // 本地备份导入路径等价物
     const s2 = await getDesktopCloudSyncService();
     assert.notEqual(s1, s2);             // 单例确实换代
     const status = await handleCloudSyncGetLocalStatus();   // 旧代码在这里抛 CONNECTION_CLOSED
     assert.equal(status.ok, true);
     ```
  2. **第二条触发面**：用 `handleBackupImport`（`handlers/backup.ts:38-57`）走一次本地备份导入，
     随后 `handleCloudSyncGetConfig()` 必须 `ok: true`。
  3. `push()` 路径：换代后 `push()` 的 `exportSnapshotToPath` 不得在死连接上跑
     `wal_checkpoint`（可注入 conn 探针断言，或至少断言 push 不抛 `CONNECTION_CLOSED`）。
  4. 命令：`cd apps/desktop && npm test` → 对照基线无新增红；`npx tsc --noEmit` → 0 错误。

- **测试策略**：

  - 新增测试文件：`apps/desktop/test/cloud-sync-service-lifecycle.test.ts`
    用例名（拟）：
    - `rebootstrap 后 getDesktopCloudSyncService 返回新实例`
    - `rebootstrap 后 getLocalStatus 不抛 CONNECTION_CLOSED`
    - `rebootstrap 后 push 的 wal_checkpoint 落在新连接上`
    - `本地备份导入（handleBackupImport）之后云同步 handler 仍可用`
  - 改动测试文件：`apps/desktop/test/cloud-sync-handlers.test.ts`
    —— `before`/`after` 里的 `resetDesktopCloudSyncServiceForTest()` 调用点不变
    （方案 A 之后它只重置测试态，不再是唯一清位入口），但需补一条
    「同一 runtime 连续两次 `getDesktopCloudSyncService()` 返回同一实例」（守住「不每次都重建」的回归）。

- **回归线**：

  - `apps/desktop/test/cloud-sync-handlers.test.ts` 全 3 条（+ 新增 1 条）。
  - `apps/desktop/test/db-backup-busy.test.ts` 全 3 条。
  - `apps/desktop/test/db-maintenance-handlers.test.ts`（消费 `isDesktopCloudSyncBusy()`）。
  - `apps/desktop/test/runtime.test.ts`（runtime 单例生命周期）。
  - `apps/desktop/test/blob-binary-normalization-service.test.ts`、
    `apps/desktop/test/message-content-decompression-service.test.ts`
    （两者都消费 `isDesktopCloudSyncBusy()` 作让路守卫，**必须保持绿**——它们是
    「令牌永不复位」这类回归的唯一哨兵）。

- **依赖**：**S-CS-01**（desktop 的 `recordPullSuccess` 依赖「现取 runtime」；顺序上 S-CS-01 的
  Step 3 与本条的方案 A 第 2 步是同一处改动）。**D5 条件化不能替代本条**（拍板项 #9 原文）。

- **风险与回滚**：

  - 风险 R1：按身份重建后，若某处在 pull 中途又调 `getDesktopCloudSyncService()`，
    会拿到**新 service**（旧 service 的 `syncBusy` 计数不同）⇒ 两个 service 的
    `syncBusy` 互不可见。当前生产代码在 pull 期间不重入（handler 一次拿一个 service），
    但**新增测试必须盯住这条**：建议同时把 `syncBusy` 提到模块级（它**已经是**模块级 `:55`，
    不在实例上）——确认过，无需改动。
  - 风险 R2：rebuild 频率。方案 A 只在 runtime 换代时重建，正常路径无额外开销。
  - 回滚：随 S-CS-01 一起 revert（共用 `getDesktopCloudSyncService` 改动）。

---

## 5 · D5 条件化 —— `handleCloudSyncPull` 无条件 rebootstrap

- **严重度 / 簇**：P2 争议项（cloudsync D5，拍板项 #9）/ apps-desktop 落点。
  **默认建议案 = 条件化**（`ledger-v2.md` §7 #9 原文：「按漏判处理（条件化）。
  条件化不能替代 S-CS-02 的单例失效修复」）。

- **病症**：`service.pull()` 在 `ALREADY_UP_TO_DATE` 时会**早返回**（库文件根本没换），
  但 handler 无条件 `rebootstrapDesktopRuntime()` ⇒ 白白关连接 + 重建整条 service graph
  + 重建进程内全部派生缓存。用户在「已是最新」这一最常见路径上，每次都付一次全量重建的代价。

- **证据**（本轮核对）：

  ```
  apps/desktop/src/main/services/cloud-sync.service.ts
  259      if (isCloudSyncError(error) && error.code === "ALREADY_UP_TO_DATE") {
  261        await this.configStore.recordPull(true, "已是最新");
  262        return { rev: meta?.lastSyncedRev ?? 0 };     // ← 正常返回，不是抛错
  ```
  ```
  apps/desktop/src/main/ipc/handlers/cloud-sync.ts
  89      const service = await getDesktopCloudSyncService();
  90      const result = await service.pull();
  91      await rebootstrapDesktopRuntime();               // ← 无条件，没有任何条件判断
  ```
  对照组（**同仓同类实现给出相反口径**）：
  ```
  apps/desktop/src/main/ipc/handlers/backup.ts
  48      if (result === "imported") {
  49        await rebootstrapDesktopRuntime();
  ```
  **`git log -S "rebootstrapDesktopRuntime" -- apps/desktop/src/main/ipc/handlers/cloud-sync.ts`
  只有最初的 IPC 通道提交命中，此后再无提交讨论过这个条件化**（synth 已核，本轮未推翻）。

  **附带确认（synth 未记、本轮新看到）**：
  `apps/desktop/renderer/features/settings/SettingsViews.tsx:318` 的
  `else if (res.error.code === "ALREADY_UP_TO_DATE")` 分支在 desktop 上**永远不可达**——
  因为 `service.pull()` 把 `ALREADY_UP_TO_DATE` **吞成了正常返回**（`:259-262`），
  handler 只会回 `ok: true`。这是死分支，**本条不动它**（渲染层改动不在本包范围），
  只在验收时确认「条件化后这个死分支仍然死着，不影响」。

- **修法**（依赖 S-CS-01 Step 2 已经把 `databaseReplaced` 透传到 service）：

  `apps/desktop/src/main/ipc/handlers/cloud-sync.ts` 的 `handleCloudSyncPull`：
  ```
  const result = await service.pull();
  if (result.databaseReplaced) {
    await rebootstrapDesktopRuntime();
    await service.recordPullSuccess(result.rev);      // 与 S-CS-01 Step 3 同一段
  }
  return { ok: true, data: result };
  ```
  **判定口径必须是「库文件真的换了吗」（`databaseReplaced`），不是「pull 抛错了吗」**——
  前者来自 import 函数的返回值（物理事实），后者会被 `ALREADY_UP_TO_DATE` 早返回路径污染。

  **mobile 侧本条无需改动**：`apps/mobile/src/services/cloud-sync.service.ts:352-359`
  的 `ALREADY_UP_TO_DATE` 分支本来就 `return` 在 `onRebootstrap()` **之前**（已条件化）。
  本轮确认 mobile 是对的，只在 S-CS-01 Step 4 的改写里保持这个行为不变。

  **备选案差异注记（若拍板项 #9 改选「保持无条件 rebootstrap」）**：
  只回退本条即可，`service.pull()` 的返回值多带一个 `databaseReplaced` 字段但 handler 不用，
  无其它后果。S-CS-01 的记账仍然正确（记账已在 service 内按代处理），
  只是「已是最新」路径上会白付一次重建。**S-CS-02 不受影响**（它靠 runtime 身份比较自愈）。

- **验收**：

  1. `ALREADY_UP_TO_DATE` 路径：对 `rebootstrapDesktopRuntime` 打 spy，
     断言**调用次数为 0**；且 `service.pull()` 返回 `ok`（不是错误）。
  2. 正常 pull 路径：spy 断言 `rebootstrapDesktopRuntime` **被调用 1 次**，
     且调用发生在 `recordPullSuccess` **之前**（顺序断言）。
  3. 命令：`cd apps/desktop && npm test` → 对照基线无新增红。

- **测试策略**：

  - 改动测试文件：`apps/desktop/test/cloud-sync-pull-accounting.test.ts`（S-CS-01 新增的文件，本条复用）
    用例名（拟）：
    - `ALREADY_UP_TO_DATE 时不调用 rebootstrapDesktopRuntime`
    - `正常 pull 时先 rebootstrap 再记账（调用顺序断言）`
  - 无新增测试文件。

- **回归线**：`apps/desktop/test/cloud-sync-handlers.test.ts` 全 3 条 + `db-backup-busy.test.ts` 全 3 条。

- **依赖**：**S-CS-01**（`databaseReplaced` 字段）；**S-CS-02**（条件化只缩小 pull 路径触发面，
  不替代单例失效修复——拍板项 #9 原文的硬约束）。

- **风险与回滚**：

  - 风险 R1：条件化之后，若 `importDatabaseBackupFrom*` 在「数据库已替换但后续步骤抛错」时
    **没有**把「已换代」信号送到 handler（返回值送不到抛错路径），handler 会跳过 rebootstrap
    ⇒ **库文件已换但 runtime 不重建** ⇒ 比现在更糟。
    ⇒ **已闭合**：S-CS-01 Step 1 的 `DatabaseReplacedError` 就是这条路径的信号载体
    （「覆盖成功后的收尾失败」一律抛它，handler catch 里 `instanceof` 判定——不再依赖
    「实现评审里逐行确认」这类无机制约束〔sr1-cloudsync-b G1 裁定：finally 不携带返回值，此路无效〕）。
  - 风险 R2：`providerTablesRestored: false` 的情形（库已换、三表丢）也必须走 rebootstrap 路径。
  - 回滚：单条 revert，无数据面影响。

---

## 6 · S-CS-03 —— pull 入口不查 `isAgentActive`、不参与进程内互斥（与 D5 顺手同做）

- **严重度 / 簇**：P1 / cloudsync（落点 `packages/core`）。
  台账 `§2.6` + `ledger-v2.md` §10 Wave B 备注：「**D5 条件化时顺手把 S-CS-03 的入口复检一起做**」。
  §7 #9 的 ⭐ 旁证也写明：「同一 coordinator 的 `pull()` 连 `isAgentActive()` 都不查，
  「pull 路径整体守卫稀薄」这条判断被再次加强」。

- **病症**：`CloudSyncCoordinator.pull()` 全程不查 `dbSync.isAgentActive()`，也不参与
  `pushMutex`。后果两条：
  ① **pull ↔ agent 交错在两端都成立**：agent 流式写入中途，`importSnapshotFromPath` 覆盖活动库文件
     （desktop `db-backup.service.ts:116` `copyFile(srcPath, dbPath)` /
     mobile `db-backup.service.ts:151` `fs.cp`）⇒ 在途写入丢失或落进已废弃的 inode；
  ② **pull ↔ push 交错在 mobile 成立**：desktop 有模块级 `syncBusy`（检查与置位之间无 `await`，
     单线程下原子），mobile **零 `syncBusy`**（全仓 grep 在 `apps/mobile/src` 零命中），
     `pullCloudSync` / `pushCloudSync` 是两个各自独立的导出函数，除 `maintenanceBusy` 计数外
     无任何互斥。交错后果：push 在 t0 拷完库 → pull 在 t1 整库替换 → push 在 t2 上传
     **t0 的旧快照**并把 rev 推到 t1+1 ⇒ **pull 拉回来的内容被云端回滚**，
     且本机 `lastSyncedRev` 被推到更高值，之后再也不会重新拉。

- **证据**（`packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts`，本轮核对）：

  ```
  143    async pull(options: PullOptions): Promise<PullResult> {
  144      this.assertConfigured();
  146      const { status: remote } = await this.readRemoteStatus();
  148      if (remote.rev <= options.lastSyncedRev) { throw new CloudSyncError("ALREADY_UP_TO_DATE", ...); }
  168        await this.dbSync.importSnapshotFromPath!(tempPath);   // ← 覆盖活动库前无任何 agent 复检
  178        await this.dbSync.importSnapshot(body);               // 同上
  ```
  ```
  185    async push(options: PushOptions): Promise<PushResult> {
  189      const lockHandle = await this.acquirePushLock();          // push 才进互斥
  219        if (this.dbSync.isAgentActive()) { throw ...("AGENT_ACTIVE", ...); }   // 只在 runPush 内
  267        if (this.dbSync.isAgentActive()) { throw ...("AGENT_ACTIVE", ...); }   // 续租点第二次
  ```
  `isAgentActive` 全仓只有这两处消费点（`push-agent-mutex.ts` 不涉及）。
  `AGENT_ACTIVE` 错误码已定义（`packages/core/src/infra/cloud-sync/errors/cloud-sync-errors.ts:13`），
  但 pull 侧从不使用。

- **修法**（`packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` 的 `pull()`）：

  1. **入口复检 agent**：位置见下方第 4 步——`ALREADY_UP_TO_DATE` / `SNAPSHOT_MISSING`
     两个早返回之后、开始搬运快照之前（即 `:150` 之后），加
     `if (this.dbSync.isAgentActive()) throw new CloudSyncError("AGENT_ACTIVE", "Agent 运行中，请稍后再拉取");`
  2. **覆盖前二次复检**：在两条 import 分支（`:168` 与 `:178`）**紧邻调用之前**各加一次同样的检查。
  3. **进互斥**：把 `pull()` 的骨架改成与 `push()` 同款——
     `const lockHandle = await this.acquireSyncLock(); try { … } finally { this.pushMutex.release(lockHandle); }`。
     - 把 `acquirePushLock()`（`:198-213`）更名为 `acquireSyncLock()`（**保留旧名作为
       `@deprecated` 别名导出**，避免 core 内部测试以外的引用断裂；本轮 grep 确认生产侧无其它引用）。
     - 超时错误码仍是 `PUSH_MUTEX_TIMEOUT`（不在本条扩错误码），
       但**消息按操作参数化**：pull 时给「拉取繁忙，等待互斥锁超时，请稍后再试」，
       push 时保持原文案。新增可选构造参数 `operation: "pull" | "push"`（默认 `"push"`）。
  4. **入口复检的位置（对台账措辞的一处有意偏离，已定稿，不转交 judge）**：
     台账原文是「`pull()` **入口**与 `importSnapshotFromPath` **之前**各复检一次」。
     本 spec 把**入口复检放在 `ALREADY_UP_TO_DATE` / `SNAPSHOT_MISSING` 两个早返回之后、
     开始搬运快照之前**（即 `:150` 之后），理由：一次「什么都不会发生」的 no-op pull
     不应该因为 agent 正在跑而被拒——这也正是验收 4 的口径。
     **修法 1 与本步是同一件事的两种写法，实现者按本步（`:150` 之后）落，不要再回 `assertConfigured()` 之后**
     （原稿两处互斥且把裁定转交 judge，已按 sr1-cloudsync-c MF-C5 收口）。
  5. **与 S-CS-01 的关系**：pull 现在会与 push 抢同一把进程内锁。
     S-CS-01 的「换库 → 重建 → 记账」全过程**必须持锁到底**（`release` 在 `finally`，
     即记账之后），否则会出现「pull 持锁换库 → 放锁 → push 立刻拿旧 runtime 导出」。
     ⇒ **顺序要求：`CloudSyncCoordinator.pull()` 的 `finally` 里 release，
     但 service 层的记账在 coordinator 返回之后** ⇒ 锁在记账之前就放了。
     **这是一个真实的缺口**，处理方式见「风险 R2」。

- **验收**：

  1. `pull 入口 agent 活跃 → 抛 AGENT_ACTIVE 且不调用 importSnapshot*`（core 单测，spy 断言）。
  2. `download 与 import 之间 agent 变为活跃 → 抛 AGENT_ACTIVE`（core 单测，
     用 `getToPath` 完成后的 hook 把 `isAgentActive` 翻成 true）。
  3. `pull 与 push 互斥`：先启动 pull（卡在 `getToPath`）→ 发 push →
     断言 push 在 pull 完成前**没有**调用 `exportSnapshotToPath`（core 单测，spy 顺序断言）。
  4. `ALREADY_UP_TO_DATE` 时不抢锁也不查 agent（core 单测：agent 活跃 + 远端 rev 未前进
     ⇒ 返回 `ALREADY_UP_TO_DATE`，不抛 `AGENT_ACTIVE`）。
  5. 命令：`cd packages/core && npm test` → 全绿；`npx tsc --noEmit` → 0 错误。

- **测试策略**：

  - 改动测试文件：`packages/core/test/cloud-sync/coordinator.test.ts`
    —— 新增 `describe("CloudSyncCoordinator.pull 守卫 (S-CS-03)")` 块，用例名（拟）：
    - `pull 入口 agent 活跃时抛 AGENT_ACTIVE 且不调用 import`
    - `import 之前复检到 agent 活跃时抛 AGENT_ACTIVE`
    - `pull 持锁期间并发 push 排队（exportSnapshotToPath 在 pull 之后）`
    - `ALREADY_UP_TO_DATE 时不抢锁不查 agent`
    - 复用文件里已有的 `createMockDbSync({ isAgentActive: () => true })` 覆写形态（`:126` 的
      `...overrides` 已是这个口子）。
  - 无新增测试文件。

- **回归线**：`packages/core/test/cloud-sync/coordinator.test.ts` **既有全部 17 条**
  （`CS-P1`/`CS-P1b`/`CS-P2`/`CS-P3`~`CS-P6`、`CS-P5b`、
  `forceOverwriteRemote 跳过 rev 检查`、`T-SC10a`~`T-SC10e`、`PushAgentMutex 单元` 3 条；
  加了互斥之后，`T-SC10d`（并发 push）与 `T-SC10c`（超时降级）的时序敏感度上升，**必须逐条复跑**；
  `lock.test.ts` 全部。

- **依赖**：**S-CS-01**（pull 的返回值与 import 语义在同一条路径上改，本条在其之后）；
  D5 条件化在 handler 层，与本条无耦合，可并行。

- **风险与回滚**：

  - 风险 R1（**最高，见上文「修法 5」**）：pull 放锁早于记账。严格说这不影响数据正确性
    （记账写 KKV，不碰库文件），但会留一个窗口：**pull 换完库、还没重建 runtime 时，push 抢到锁
    并开始导出**——而 push 走的是 `DesktopCloudSyncService.buildCoordinator`，它用的是
    `this.runtime`（S-CS-02 修完之后是**当代** runtime，可能是已关连接）。
    ⇒ **必须的缓解**：把 `service.pull()` 里「rebootstrap + 记账」也纳入 coordinator 的锁窗口是不现实的
    （跨层），能想到的第一反应是在 `DesktopCloudSyncService.pull()` 入口也做一次 `syncBusy` 式的
    应用层串行化——但事实是它**覆盖不住这个窗口**：`syncBusy = false` 是在 `pull()` 的
    `finally :268` 复位，而 handler 的 `rebootstrapDesktopRuntime()` 在 `handlers/cloud-sync.ts:91`，
    **排在那之后** ⇒「库已换 + 连接已关 + runtime 未重建」这段里 `syncBusy` 已经放掉了。
    ⇒ **desktop 真正的安全机制是 S-CS-02 方案 A 的身份重建**：`closeLiveDbForBackupImport`
    已调 `clearDesktopRuntimeHandle()` 把 runtime 置空（`desktop-runtime-singleton.ts`），
    下次 `getDesktopRuntime()` 懒建出**新对象** → `runtimeIdentity` 比较不等 → service 换代。
    **这条缓解依赖 §4 必须先落**（原稿写「desktop 侧天然安全」是事实错误，已按
    sr1-cloudsync-c MF-C6 改正；另：desktop 的 `push()` 入口只查 `syncBusy`、不查
    `maintenanceBusy`，那是 S-CS-05，本条不碰）。
    **mobile 侧连这个自愈都没有**（React state 里的 runtime，没有懒建自愈机制），
    ⇒ 本条必须在 mobile 补一个 pull↔push 的应用层互斥，
    否则 mobile 上「pull 换库后、rebootstrap 前，push 开始导出」仍可达。
    **本 spec 把这条列为本条的必做子步骤**：在 `apps/mobile/src/services/cloud-sync.service.ts`
    加模块级 `syncBusy`（与 desktop 同款：`if (syncBusy) throw ...; syncBusy = true;` + `finally` 复位），
    覆盖 `pullCloudSync` 与 `pushCloudSync` 两条路径。
  - 风险 R2：`acquireSyncLock` 默认 30s 超时。pull 的下载+校验+导入在大库上可能超过 30s
    ⇒ 并发 push 会拿到 `PUSH_MUTEX_TIMEOUT` 而被拒。**这是期望行为**（拒绝优于脏快照），
    但错误文案必须能让用户看懂（已在修法 3 参数化）。
  - 风险 R3：新增 agent 入口复检后，「agent 运行时点拉取」从「静默换库」变成「被拒」。
    这是正确行为，但属于**用户可见的行为变更**，需在 CHANGELOG 记一笔。
  - 回滚：core 侧可单独 revert（不改数据面）；mobile 的 `syncBusy` 建议保留（它单独就有价值）。

---

## 7 · §6 #1 PushAgentMutex 未接线 —— 第二源复核结论（注记，不单列条目）

- **复核方式**：本轮**独立重推导**，对照
  `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:56-70`（模块级单例与
  `getDefaultPushAgentMutex`）、`packages/core/src/infra/cloud-sync/logic/push-agent-mutex.ts`
  全文（135 行）、以及 `packages/core/src/infra/cloud-sync/index.ts`（45 行导出块）。

- **复核结论三条，全部成立**：

  1. **`getDefaultPushAgentMutex` 未从任一 index 导出**：
     `packages/core/src/infra/cloud-sync/index.ts` 全文 45 行（与上一段的「45 行」统一；
     原稿此处写 46 行，是同一种「差 1」的元数据笔误——sr1-cloudsync-a C1/C8），导出块只有 6 组
     （`errors` / `ports` / `model` / `lock` / `paths` / `coordinator`），
     **没有 `PushAgentMutex`、没有 `getDefaultPushAgentMutex`、没有 `PushAgentMutexAcquireError`**。
     ⇒ apps 侧即便想接也拿不到（`@novel-master/core` 公共面不暴露）。
  2. **apps 侧零 acquire**：全仓 grep（排除 `dist` / `node_modules`）`PushAgentMutex` /
     `getDefaultPushAgentMutex` / `pushMutex` 的命中**只在**
     `cloud-sync-coordinator.ts` 自身、`push-agent-mutex.ts` 自身、
     以及 `packages/core/test/cloud-sync/coordinator.test.ts`（测试）。
     **`apps/desktop` / `apps/mobile` 零命中。**
  3. **模块头把未接线的能力写成已实现**：
     `push-agent-mutex.ts:1-14` 的模块头写「push 和 agent 启动入口排队」、
     `cloud-sync-coordinator.ts:44-50` 的 `pushMutex` 字段 JSDoc 写
     「apps runtime 在 agent 启动入口应拿到同一实例（通过 `getDefaultPushAgentMutex`）」。
     两处都是**承诺态**，实际无人兑现。⇒ 属 Wave E「注释承诺 ≠ 实现」的靶子。

- **危害顺序复核（w9 报告的补充论据，本轮确认为代码事实）**：
  `runPush` 的第二次 `isAgentActive()` 复检在 `:267`，位置在
  **快照已上传（`:256` / `:260`）之后**。所以「agent 抢跑」被发现的时刻，
  **脏快照已经进了云端**，只能靠 `finally` 的 `tryClearLock` 清租约，
  但 rev 尚未推进（`finalStatus` 的 PUT 在 `:297` 之后才做）⇒ 脏对象以
  `snapshotKey(prefix, rev+1)` 的名字留在桶里，若进程在两者之间崩溃，桶里会留下一个
  **rev 已占位、内容是脏的**快照。⇒ 危害顺序描述成立。

- **处置（与台账一致）**：**归并 v1 的 M-25「运行时孤儿子系统」（P2，core-misc）**，
  **不新增 P1，不单列条目**。理由：它与 M-25 是同一条（v1 已记为 P2），
  本轮复核只是**升级其印证强度**（「W9 独立 grep 确认 + 给出具体危害顺序」，
  与 `ledger-v2.md` §4.2 对 w9-inframisc pro-③ 的裁决一字不差）。
  按 `SPEC.md` §1 的 §6 口径（「复核成立的按 P1 写进对应分片；复核不成立的回退台账待验证节」）
  ——**本条复核成立但已被台账显式归并，故按台账口径走 M-25，不重复出账**。

- **留给本包的两条零成本顺带项**（写进本 PR，但**不计入条目数**）：

  1. S-CS-03 修完后，pull 与 push 已在 coordinator 内共享 `pushMutex`
     ⇒ 锁的实际互斥面从「push↔push」扩大到「sync↔sync」。**但「sync↔agent」仍然是空的**
     （agent 侧无人 acquire），这条注释承诺仍未兑现。**在 `cloud-sync-coordinator.ts:44-50`
     与 `push-agent-mutex.ts:1-14` 两处注释上标注「agent 侧接线未落地，见 M-25」**，
     把承诺态改成事实态。这是零风险的、可与 S-CS-03 同一提交做的诚实化改动。
  2. 若将来要真接线（不在本包范围，属 M-25 的 P2 债务）：
     顺序必然是 ① 先把 `PushAgentMutex` + `getDefaultPushAgentMutex` 加进
     `infra/cloud-sync/index.ts`（**注意：导出会扩大 core 公共面，Wave E 的 X1 收口要看这条**）
     → ② 两端 agent 启动入口 acquire/release（desktop `agent-run` handler /
     mobile `NovelMasterProvider.retry` 路径）→ ③ 才谈得上把 `AGENT_ACTIVE` 复检简化。

---

## 8 · 分片级注记

### 8.1 内部提交顺序（同 PR 内，S-CS-07 先行）

| # | 提交 | 条目 | 触及文件 | 为什么在这个位置 |
|---|---|---|---|---|
| 1 | `fix(desktop): 备份导入三处吞错改为致命 + 校验不整包读入` | S-CS-07 | `apps/desktop/src/main/services/db-backup.service.ts` | **纯错误处理，不改任何导出签名 ⇒ 可独立 review、独立 revert、独立验收**。且本簇唯一不可逆数据丢失面，先止血 |
| 2 | `fix(core+两端): 引入连接换代信号 + pull 记账移到 rebootstrap 之后` | S-CS-01 + S-CS-16 | `db-sync.port.ts`、`cloud-sync-coordinator.ts`、两端 `db-backup.service.ts` + `cloud-sync.service.ts`、`handlers/cloud-sync.ts`、mobile `novel-master-context.tsx` + `CloudSyncProgressScreen.tsx` | 依赖提交 1 的干净错误处理；在 `db-backup.service.ts` 上叠加返回信号 |
| 3 | `fix(desktop): 云同步 service 单例随 runtime 换代重建` | S-CS-02 | `cloud-sync.service.ts`（desktop） | 与提交 2 的 Step 3 共用同一处改动（`recordPullSuccess` 现取 runtime），拆开会产生不可编译的中间态 |
| 4 | `fix(desktop): handleCloudSyncPull 按库文件是否真的替换决定 rebootstrap` | D5 | `handlers/cloud-sync.ts` | 依赖提交 2 引入的 `databaseReplaced` |
| 5 | `fix(core+mobile): pull 入口/导入前复检 agent、pull 进进程内互斥` | S-CS-03 | `cloud-sync-coordinator.ts`、mobile `cloud-sync.service.ts` | 与 D5「顺手同做」但技术上可独立；放最后是为了让前四个提交的回归面各自清晰 |
| 6 | `docs(cloudsync): 把 PushAgentMutex 的注释承诺改成事实态` | §6 #1 顺带项 | `cloud-sync-coordinator.ts`、`push-agent-mutex.ts`（仅注释） | 零风险注释诚实化；与提交 5 同一文件域，合并 review 更快 |

**强制顺序约束**：1 → 2 → 3 是一条**不可拆的链**（1 必须在 2 之前；2 与 3 共用改动点）。
4 必须在 2 之后。5 与 6 相对独立，但建议都放最后。

### 8.2 与 wave-a / wave-c 的边界

- **与 wave-a（零风险止血与门禁）**：
  - `N-P0-02`（desktop `npm test` Windows 假绿）是本包**全部回归线的地基**。
    本包的验收命令全部依赖 `npm test` 真的收集到用例。
    ⇒ **建议 N-P0-02 先落**；若 Wave A 未先落，本包验收时必须手工确认
    `run-tests.mjs` 的收集数不为 0（在输出里看到 `# tests N` 且 N>0）。
  - `CI typecheck 转 blocking`：本包改了两个 app 的 `tsconfig` 覆盖范围内的文件，
    不引入新类型错误；**桌面 renderer 零门禁（411 条已知红，N-P1-05）不影响本包**——
    本包不改任何 `.tsx`。
  - 编码批次 1（★5）：本包触及的 5 个文件**均不在** U+FFFD 名单内（已核对
    `ledger-v2.md` §7 ★5 提到的 apps-mobile 文件清单），**无耦合**。

- **与 wave-b-core1（RT-04 / RT-01 / CS-01 / N-P1-02）**：
  - **零文件重叠**。`cloud-sync-coordinator.ts` 与 `db-sync.port.ts` 不在 core1 的清单里。
  - 语义耦合仅一处：wave-c1 的 **RT-01（全量读收窄）** 排在 Wave C，
    本包的 S-CS-01 修完后 pull 的记账不再抛错，**RT-01 的每 step 读次数基线**
    不受本包影响（pull 不跑 agent）。**无需先后约束。**

- **与 wave-b-core2 / wave-b-apps**：
  - **零文件重叠**。core2 的 `CS-05/CS-11` 事务边界条目与本包的
    `db-backup.service.ts` 不在同一批文件里（core2 动的是 `service/vfs/**`、
    `service/chat/**`）。
  - apps-b 的 **AM-1（`forgetSession` + LRU）** 与本包**无耦合**。

- **与 wave-c2（事务边界：CS-05/CS-06/CS-07/backfill）**：
  - **零文件重叠**，但有一个**概念耦合**要说清：CS-06/CS-07 改的是
    `vfs_revision.ref_count` 的写入口径，**云同步 pull 会整库替换掉这些行**
    （`db-backup.service.ts:116` / mobile `:151` 覆盖活动库文件）。
    本包**不改** ref_count 语义；Wave C 跑 CS-06/CS-07 时若做 pull 相关验证，
    需知道「pull 后 ref_count 是随快照一起被覆盖的」，不是本包引入的新风险。

- **与 wave-d（死码删除）**：
  - **D5 条件化会显著缩小 S-CS-02 的触发面**，但 S-CS-02 的第二条触发面
    （`handlers/backup.ts:49` 本地备份导入）不受 D5 影响 ⇒ **D5 不得作为 S-CS-02 的豁免理由**
    （拍板项 #9 原文的硬约束，本包已在 §4 写死）。
  - wave-d 批次 2 需要 rebuild core；本包也改 core（coordinator/port），
    **若 wave-d 批次 2 与本包并行，需注意 `packages/core/dist` 的重建时机**。

- **与 wave-e（文档与防再犯）**：
  - §7 顺带项 6（PushAgentMutex 注释诚实化）是 Wave E「注释承诺 ≠ 实现」的**一个实例**；
    本包在 wave-b 就做掉，**judge 轮请勿把它重复计入 Wave E 的未完成清单**。
  - §6 #1 的「若要真接线，第一步是把 `PushAgentMutex` 导出进 `infra/cloud-sync/index.ts`」
    会**扩大 core 公共面** ⇒ 提醒 Wave E 的 **X1 门禁收口**（9 处 renderer→core 违规 +
    driver 包 tsconfig 覆盖）把这一条纳入检查清单。

- **与 baseline（S1）**：本包全部验收命令都对照 `baseline.md` 的**已知红清单**判增量，
  不对照零基线。本包**不新增任何 renderer 代码**，所以 411 条 renderer 类型错误这条已知红
  在本包前后应**完全一致**——这是一条可直接断言的验收辅助信号。
  （R1 定案 411；台账 424 已漂 −13，见 `baseline.md §2.1/§4`。）