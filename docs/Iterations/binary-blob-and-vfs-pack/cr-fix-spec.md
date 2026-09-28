# CR Fix Spec: 落库形态去 base64 + VFS 版本链打包（A1 落地全量 CR · round 1 + r2 + r3 + r4 修订版）

## 元信息

| 项 | 值 |
|---|---|
| repo | `D:\Dev\Js\novel-master`（分支 `feat/blob-binary-normalization`） |
| base_sha | `02d2fcc9` |
| head_sha | `ae6a8257` |
| prd_path | 未提供（需求来源为用户口述，见 spec 头部） |
| spec_path | `docs/Iterations/binary-blob-and-vfs-pack/spec.md`（只读参考） |
| review_round | 4 |
| dag_version | 6 |
| 评审模式 | scope 全量（三个 readonly 节点并行：`review-scope-core-prod` / `review-scope-core-tests` / `review-scope-apps`）＋ round 1 末轮 `review-full` ＋ round 2 末轮 `review-full-2` ＋ round 3 末轮 `review-full-3` |
| fix_spec_path | `docs/Iterations/binary-blob-and-vfs-pack/cr-fix-spec.md` |
| 状态 | **fix-spec-ready**（round 4 末轮复检 `review-full-4` 判 yes；其后主代理 trivial 直接执行订正 4 处措辞/事实残影：`stalled` 字段是否存在的误述、cr-02 (a) 变红理由张冠李戴、advisory ③ 的悬空引用两处、汇总口径漏列 cr-35） |

本轮汇总口径：round 1 的三条 scope 评审产出 23 条 must-fix（P0 1 条 / P1 6 条 / P2 16 条），全部写入。**round 1 末轮 `review-full` 判 `no`**，新增 cr-24 ~ cr-30 七条 must-fix，并**按其结论修订** cr-01 / cr-02 / cr-03 / cr-06 / cr-07 五条既有条目的改法（r2 版共 30 条：P0 1 条 / P1 8 条 / P2 21 条）。**round 2 末轮复检 `review-full-2` 判 `no`**，新增 cr-31 ~ cr-36 六条 must-fix（P1 1 条 / P2 5 条），并**定点改写** cr-01 / cr-02 / cr-06 / cr-20 / cr-22 五条既有条目（不重排整体结构）→ **r3 版共 36 条：P0 1 条 / P1 9 条 / P2 26 条**。**round 3 末轮复检 `review-full-3` 仍判 `no`**，新增 NF-1（`maintCalls` 语义与「pending 标记真跑成功后会被清」在本测试文件内不可观测，须拆新测试文件）/ NF-2（「全表皆坏行」在 cr-01/cr-02/cr-24 三处是互斥夹具）/ NF-3（cr-36 验收 ② 与 cr-21 ① 互斥）三条**文档内部一致性**问题，**不新增 must-fix**，只**定点改写** cr-01 / cr-02 / cr-20 / cr-23 / cr-24 / cr-25 / cr-31 / cr-32 / cr-35 / cr-36 十条既有条目的验收与措辞（不重排整体结构），另做三处措辞级微调（波次表 cr-26 重复列示 / 本段口径 / cr-02 的 `updateCount` 与护栏措辞）→ **r4 版仍为 36 条：P0 1 条 / P1 9 条 / P2 26 条**。另落成三条 advisory 注记（进 K 节 / 条目注记，不计 must-fix）。**本节点只写本文档，不改实现代码、不改测试、不改业务 spec、不改 `docs/.iteration-state.yaml`；全程无任何 git 写操作。**

修复波次建议（供主代理拆 `spec_fix_plan` 参考，不代替编排）：

| wave | 条目 | 理由 |
|---|---|---|
| wave-0（**前置**） | **cr-26（`beforeMaintenance` / `afterMaintenance` 回调必须先落）** | **cr-31 的验收完全依赖这一对回调作为唯一观测缝**：没有它，core 测试文件里 `startupMaintenanceOnce` 的进程级去重标记已被本文件第一条用例消费，VACUUM 类断言不可用（详见 cr-31）。**【r4】** 同一波还要新建第二个测试文件 `packages/core/test/infra/blob-binary-normalization-maintenance.test.ts`（NF-1：pending 标记「真跑成功后会被清」这条正向路径在既有文件里不可观测，必须靠独立进程的新文件承载）——它依赖 cr-26 的两个回调 |
| wave-1（P0 先行） | cr-01 + cr-25 + **cr-31**（cr-01 验收段改用回调缝 + 登记新测试文件）+ **cr-32**（cr-01 改法第 4 步 (b) 的清标记条件） | 同文件同函数（`runBlobBinaryNormalization` 尾部门条件 + 维护失败兜底），必须一起改；cr-31 / cr-32 是对 cr-01 同两处的定点重写 |
| wave-2（P1 正确性） | cr-02 + cr-24 + **cr-35**（cr-02 第 9 步不变量注释 + 收尾谓词校验用例标题/断言文案） | 同文件（`normalizeTable` 主循环 + keyset 游标 + 收尾谓词校验），是 wave-1 门条件成立的前提 |
| wave-3（P1 其余） | cr-03、cr-04、cr-05、cr-06 + cr-27 + cr-28 + **cr-33**（`stalled` 语义扩宽的三处文档同步，落在 core 类型注释 + desktop/mobile service） | cr-03 收口 desktop busy 契约（**【r4 修正】wave-3 不再重复列 cr-26——它已提到 wave-0 作为前置；本波只保留 cr-03，并依赖 wave-0 已落地的 `beforeMaintenance` / `afterMaintenance` 两个回调来写它的验收用例**）；cr-06 三项同文件同函数（状态查询 / DTO / 既有断言）须一次改完；cr-33 与 cr-03 改的是同一批文件的服务头注释，可搭车 |
| wave-4（P2 + 文档） | cr-07 ~ cr-23、cr-29、cr-30 + **cr-34**（cr-22 新增项 + SD 表处置）、**cr-36**（路径修正 + cr-20 改写） | 核心是测试与文档项，依赖 wave-1/2/3 的实现与接口形态；cr-34 / cr-36 均为纯文档与措辞层，可与 wave-3 并行；**cr-23 的用例清单需在 wave-1/2 落地后再据实际用例名补全（NF-2 的 (a)(b) 两条用例名以 wave-2 落地版为准）** |

> 编排提示：**cr-01 / cr-02 / cr-06 三者同文件同函数（`blob-binary-normalization.ts` 的 `runBlobBinaryNormalization` / `normalizeTable` / `getBlobBinaryStatus`），建议合并为同一波一次改完**，避免三处各自的 `done` / `failedCount` / 标记语义互相打架导致反复重编。
>
> **r3 补充提示**：wave-0 不是新工作项，而是把既有 cr-26 提到**最前面**。若编排上不便单列，则 wave-1 内部必须先落 cr-26 的两个回调再写 cr-01 的验收段；顺序反了会导致 cr-31 的 `maintCalls` 判据无法实现（core 侧 `RunBlobBinaryNormalizationOptions` 上还没有这两个键）。
>
> **【r4 新增 · NF-1】两个 core 测试文件的分工（顺序不可换）**：
> - `packages/core/test/infra/blob-binary-normalization.test.ts`（既有）——保留既有顺序约束（**VACUUM 容错用例必须是本文件第一条**）与「标记已被消费」的既有事实；在该文件里，`maintCalls` 只能作为「**是否进入过收尾维护段**」的判据，**不能**用来断言 VACUUM 真跑或 pending 标记被清。
> - `packages/core/test/infra/blob-binary-normalization-maintenance.test.ts`（**r4 新建**，独立进程 ⇒ 进程级去重标记未被消费）——承载「**pending 标记真跑成功后会被清**」这条正向路径（**必须是该文件第一条用例**）与「稳态零成本」的反向复验。
> - **落地依赖**：新文件的建立与 cr-26 的两个回调同属 **wave-0 / wave-1 前置**，不能排在 wave-4（否则 wave-1 的 cr-01 验收段无可落地的观测缝）。

---

## Must-fix（按 P0 → P1 → P2）

### cr-01 [P0] 收尾维护链路触发条件过宽：稳态每次进程启动 / 每条 CLI 命令都跑一次全库 GC+checkpoint+VACUUM

> **round 2 修订（按 cr-25 的结论）**：原改法的门条件 `processedAny = processedAny || result.normalizedCount > 0 || (result.done && result.failedCount > 0)` 中，`(done && failedCount > 0)` 这一支**无收益且丢兜底**——只有成功改写过行才会往 freelist 里释放页，「本轮只余坏行的完成态」一行字节都没动，跑 VACUUM 纯属白付代价（还要让 desktop 冻一次事件循环，见 cr-03/cr-26）。本条已按 cr-25 收敛为单一门条件，并补维护失败兜底。
>
> **round 3 修订（按 cr-31 / cr-32 的结论）**：本条的**改法（门条件 + 兜底）不变**，但两处必须重写——① **验收段的观测口径**（探针里的 `VACUUM` 计数在本测试文件里根本观测不到，见下）改用 cr-26 的 `afterMaintenance` 回调；② **兜底清标记必须以 `runStartupMaintenanceOnce` 返回非 null 为条件**，否则同进程内会「标记被清、维护没跑」而静默失效。详见 cr-31 / cr-32。
>
> **round 4 修订（NF-1 / NF-2 的定点改写，**改法本身仍不变**，只重写验收段）**：
> - **NF-1 · `maintCalls` 的语义必须写死并跨文件统一**：`maintCalls` = 「**进入收尾维护段的次数（含被进程级去重短路的调用）**」，即 `beforeMaintenance` / `afterMaintenance` 被调用的次数，**不代表 VACUUM 真跑**。cr-31 r3 写的「同进程二次调用 → `maintCalls === 0`」与「pending 兜底 → 标记被清」这两条期望**在同一测试文件内必然打红**（该文件第一条用例已消费进程级去重标记 ⇒ `runStartupMaintenanceOnce` 恒返回 `null` ⇒ 条件式清标记不生效；且 `beforeMaintenance` 早于 `runStartupMaintenanceOnce` 以置 desktop busy ⇒ 维护段必被进入）。故：① **二次调用用例的期望从「`maintCalls === 0`」改为「`maintCalls === 1` 且 `startupMaintenancePending` 未被误清」**，判据落点从「是否进入维护段」换成「**标记是否被误清**」；② **「pending 标记真跑成功后会被清」的正向路径拆到新测试文件** `packages/core/test/infra/blob-binary-normalization-maintenance.test.ts`（独立进程 ⇒ 标记未被消费），并作为该文件的**第一条**用例。
> - **NF-2 · 「全表皆坏行」拆成两条互不重叠的用例**：r3 里 cr-02 验收的正例夹具是「100 坏行 + 20 行正常」并断言 20 行已归一 ⇒ `normalizedCount === 20` ⇒ `processedAny === true` ⇒ 收尾维护**必跑**，而它却挂着 `maintCalls === 0`（必红）；cr-01 验收的同名用例期望 `normalizedCount === 0 / maintCalls === 0`（隐含夹具只有坏行）。两条必须拆开，见下方验收段 **(a) / (b)**。

- 维度：B（正确性）+ C-orch
- 文件：
  - `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts`（`runBlobBinaryNormalization`：`let allDone = true` 初值 + 标记短路 `continue` 不参与计算 + 尾部 `if (allDone) { runStartupMaintenanceOnce }`）
  - `apps/mobile/src/services/blob-binary-normalization.service.ts`（头注释）
  - `apps/desktop/src/main/services/blob-binary-normalization.service.ts`（头注释）
  - `apps/cli/src/runtime.ts:184-187`（注释）
  - `docs/Iterations/binary-blob-and-vfs-pack/spec.md`「实现期补充」相关措辞（**由 cr-22 执行时改，本节点不动**）
- 问题：稳态（两表 KKV 标记都已置）时 `for` 循环体全部走 `readDoneMarker → continue`，`allDone` 保持初值 `true` 且没有任何「本轮真的干活了」的信号 → 尾部 `if (allDone)` 每次调用都真跑维护链路。而 `runStartupMaintenanceOnce` 的去重只是**进程级**的，对「每条命令一个进程」的 CLI 完全无效、对每次冷启动的双端也每次复位。后果：升级后每次桌面启动 / 每次移动端启动 / **每一条 CLI 命令**都付一次 107MB 量级的全库 VACUUM（CLI 是同步 `await`，秒级阻塞）。同时与函数头注释「归一释放的页挂 freelist，VACUUM 归还」的意图自相矛盾——稳态根本没有行被归一，没有页被释放。
- 改法（可执行，**round 2 收敛版**）：
  1. 在 `runBlobBinaryNormalization` 内引入「本轮是否真有推进」标记：`let processedAny = false;`。
  2. 门条件简化为**单一来源**：`processedAny = processedAny || result.normalizedCount > 0;`
     - **删除 round 1 里的 `(result.done === true && result.normalizedCount === 0 && result.failedCount > 0)` 分支**。理由：freelist 页只来自成功改写（`UPDATE ... SET bytes=?` 释放旧页），「本轮该表只余坏行、零行被改写」的完成态**没有释放任何页**，跑 GC/checkpoint/VACUUM 是纯成本；该路径的收敛性由 cr-24 的收尾谓词校验保证，不需要靠维护链路兜底。
     - 同步在代码旁写注释说明这条删除的理由，避免后续维护者把那一支「补回来」。
  3. 尾部收尾条件收紧为 `if (allDone && processedAny) { ... }`。
  4. **补维护失败兜底（方案 A，写为默认动作；方案 B 见 open_questions OQ-A）**：
     - a. 维护链路的 catch 分支里，除既有 `console.warn` 外，**写一个独立 KKV 标记** `startupMaintenancePending = "1"`（同 `BLOB_BINARY_KKV_MODULE` module，key 与两表完成标记区分开，例如 `nm-blob-binary` 下的 `startupMaintenancePending`）。
     - b. `runBlobBinaryNormalization` **入口**读该标记：**读到则无视 `processedAny` 强制跑一次维护链路**（即 `if (allDone && (processedAny || maintenancePending))`；`maintenancePending` 为真时同样需要 `allDone`——尚未全部完成的库跑了 VACUUM 也没意义），**成功后清标记**。
       - **【r3 · cr-32】「成功后清标记」必须是条件式**，不能无条件清。`runStartupMaintenanceOnce` 在**执行前置位**且**失败不回滚**地置进程级标记，同一进程内第二次调用会直接返回 `null` 且什么都不跑；照字面写成 `await runStartupMaintenanceOnce(conn); 清标记` 会在同进程重入时**把标记清掉而维护根本没跑 → 兜底静默失效**。正确写法：
         ```ts
         const result = await runStartupMaintenanceOnce(conn);
         if (result !== null) {
           await clearStartupMaintenancePending(conn); // 仅在真跑过时清
         } else {
           console.warn("本进程已跑过收尾维护，startupMaintenancePending 保留待下次冷启动");
         }
         ```
         注释里注明 `result === null` 分支的**正常性**：它就是「同进程重入」这一预期场景（多个启动期任务叠加），不是异常。
     - c. 置标记与清标记都包在 **try/catch** 里，失败只 warn、不抛（KKV 写失败不能让整轮归一任务失败）。
  5. 维护链路体本身（VACUUM 的 try/catch + warn 文案）不动。
  6. 同步更正注释：函数头 / 尾部注释改为「**仅在本轮确有推进（成功改写 ≥1 行）且全部表完成时触发一次收尾维护；稳态零成本；上一轮维护失败会由持久化标记补跑**」；`apps/mobile` / `apps/desktop` 两端服务头注释与 `apps/cli/src/runtime.ts:184-187` 同步改成同一口径。
  - **【r3 advisory ③ · 小步骤，二选一】`startupMaintenancePending` 会因用户手动「数据清理」而变陈旧**：用户手动清理成功（或手动清理把 freelist 收干净）后，该 pending 标记仍留在 `kkv_entry` 里 → 下次冷启动会**无视 `processedAny` 多跑一次全库 VACUUM**。代价是「一次多余的 VACUUM」（不是正确性问题，纯浪费）。二选一并写进代码注释：**A（推荐）** 在 `runDatabaseMaintenance` 手动路径**成功返回后**顺带清 `startupMaintenancePending`；**B** 不清，但在 `startupMaintenancePending` 的定义处注释写明「手动清理后该标记会陈旧，导致下次冷启动多跑一次 VACUUM——已知且接受」。**默认 A**（一处 try/catch 内的多写一行，成本远小于一次全库 VACUUM）。
- 验收/测试（**r4 全段重写 · 见 cr-31**）：
  - **【观测缝，r3 起】**判定「维护段是否被进入」**一律以 `afterMaintenance` 回调计数为准，不再以探针里的 `VACUUM` / `wal_checkpoint` / `incremental_vacuum` 出现次数为准**。测试里传两个计数器：
    ```ts
    let maintCalls = 0;
    const result = await runBlobBinaryNormalization(conn, {
      beforeMaintenance: () => { /* 采样点 */ },
      afterMaintenance: () => { maintCalls += 1; },
    });
    ```
  - **【r4 新增 · `maintCalls` 的语义定义，必须原样写进每条用例的注释】**`maintCalls` = 「**进入收尾维护段的次数（含被进程级去重短路的调用）**」——即 `beforeMaintenance` / `afterMaintenance` 被调用的次数，**不代表 VACUUM 真跑**。`runStartupMaintenanceOnce` 的进程级去重标记是**执行前置位、失败不回滚**的，被短路时它返回 `null` 但维护段**已经进入**。用例注释里必须写明这一层，否则后来者会把 `maintCalls === 1` 误读成「VACUUM 跑过了」，进而写出不可满足的断言（r3 就写过这样一条，见下）。
  - **写进用例注释的理由（必须写）**：`runStartupMaintenanceOnce` 的进程级去重标记是**执行前置位、失败不回滚**的；而本测试文件的**第一条用例**就是「收尾维护链路失败（VACUUM 抛错）」——它必然走过维护段并消费掉该标记，于是**本文件后续用例永远观测不到 VACUUM**。因此 VACUUM 类断言在本文件不可靠，探针口径的「不含 VACUUM」会**恒真**（把门条件整段删掉也照样绿，P0 回归测试无牙）。回调缝与实现同源、无新增公共 API（cr-26 本就要加这两个回调），是当前唯一可用的判据。
  - **稳态用例**（追加到文件尾部）：预置两表 KKV 标记已置 → 调 `runBlobBinaryNormalization` → 断言 `maintCalls === 0`、返回 `{ done: true, normalizedCount: 0, failedCount: 0, stalled: false }`、探针里无 blob 表 UPDATE。
  - **「缺失标记但谓词空」用例**（新装 / 空库首启）：无标记、无 legacy 行 → 断言 `maintCalls === 0`（**无页可归还**，不跑维护是正确行为）；标记被置上。
  - **首轮确有归一用例**：插 1 行 legacy → 断言 `normalizedCount === 1` 且 `maintCalls === 1`。
  - **【r4 · NF-2 拆分】原本这条名叫「全表皆坏行」的用例拆成两条互不重叠的用例**（与 cr-02 / cr-24 / cr-23 引用同一对名称与同一套期望）：
    - **(a)「纯坏行表（0 正常行）」**（原「全表皆坏行」用例的真实夹具）：只插 N 行坏 base64、不插任何正常行 → 断言 `normalizedCount === 0`、`failedCount === N`、`done === true`、`stalled === false`、两表标记已置、**`maintCalls === 0`**。用例注释写明「按 cr-25 收敛：**零行被改写** → 不释放 freelist 页 → 不触发收尾维护」，并钉住反向判据：**把 `(done && failedCount > 0)` 那一支补回门条件，本用例即变红**。
    - **(b)「坏行满批 + 尾部正常行（100 坏 + 20 好）」**（原 cr-02 验收里那条正例的夹具）：100 行坏（`bad-0000…bad-0099`）+ 20 行正常（`good-0100…good-0119`）→ 断言 20 行**全部**归一（`encoding='zlib'` / `TYPEOF(bytes)='blob'` / `byte_len = LENGTH(bytes)`）、`normalizedCount === 20`、`failedCount === 100`、`done === true`、`stalled === false`、标记已置、**`maintCalls === 1`**（本轮确有推进 ⇒ 触发收尾维护）。用例注释写明「与 (a) 的差别只在**有没有正常行**：(a) 零改写 → 零维护；(b) 改写了 20 行 → 跑一次维护」。（**r3 把 (b) 挂在 `maintCalls === 0` 是错的**——`normalizedCount === 20` 必然让 `processedAny === true`。）
  - **`startupMaintenancePending` 兜底用例 ——【r4 · NF-1 拆到新测试文件】**：正向路径「预置 pending + 强制跑成功 → 标记**被清掉**」**在本文件不可观测**（`runStartupMaintenanceOnce` 恒返回 `null` ⇒ 条件式清标记分支永不执行 ⇒ 断言「被清」必然打红）。故**整条拆到新文件 `packages/core/test/infra/blob-binary-normalization-maintenance.test.ts`**（独立进程 ⇒ 进程级标记未被消费），并作为**该文件的第一条用例**：预置 `startupMaintenancePending = "1"` + 无待归一行 → 调 `runBlobBinaryNormalization` → 断言 `maintCalls === 1` **且 `startupMaintenancePending` 已被清掉**（清标记条件见 cr-32 改法第 4 步 (b)）。同文件建议再复验一条「稳态（两表标记已置、无 pending）→ `maintCalls === 0`」，保证该文件自身也钉住零成本路径。详见 cr-31 的文件段与验收段。
  - **【r3 · cr-32】「同进程二次调用」用例（r4 改正期望）**：预置 pending 标记 → 先在同进程内跑一次 `runStartupMaintenanceOnce(conn)` 让进程级标记落位（此后该调用恒返回 `null`）→ 再调 `runBlobBinaryNormalization` → 断言 **`maintCalls === 1`**（维护段**确实被进入**了：入口读到 pending 标记强制走维护段，`beforeMaintenance` 早于 `runStartupMaintenanceOnce` 调用点、置 desktop busy 的职责要求它必须先执行）**且 `startupMaintenancePending` 仍在 `kkv_entry` 里、未被误清**。
    - **【r4 判据落点说明】**这条用例的判据从 r3 的「是否进入维护段（`maintCalls === 0`）」**换成「标记是否被误清」**——r3 那个期望在本文件里不可满足（`maintCalls` 实际为 1，因为进程级去重短路发生在 `runStartupMaintenanceOnce` **内部**、不影响 `beforeMaintenance` 的执行）。反向判据保留：把清标记改回「无条件清」，本用例**必须变红**（标记会被误清）。
  - **进程级顺序约束的说明改写（r3）**：「VACUUM 容错用例必须是本文件第一条用例」这条约束**仍然必须保留**——理由由 r2 的「后续要断言 VACUUM 次数」改为「它会消费进程级去重标记、从而影响后续用例对**维护链路本身**是否执行的观测」。但它**不再是**「后续断言 VACUUM 次数」那类用例的前提；后续用例改走回调缝。显式防护（`before` 钩子断言标记未置位）见 K 节第 1 条，并注明它不解决可观测性。**【r4】该约束仅适用于本文件**；新文件 `blob-binary-normalization-maintenance.test.ts` 的顺序约束独立（第一条必须是 pending 用例），两者互不影响。
- 来源：`review-scope-core-prod/B-01`（P1）＋ `review-scope-apps/B-01`（P0，同一根因取最高严重度）＋ **`review-full/cr-25`（P1，round 2 修订门条件与兜底）＋ `review-full-2/cr-31`（P1，r3 重写验收观测口径）＋ `review-full-2/cr-32`（P2，r3 兜底清标记条件）＋ `review-full-3` 的 **NF-1**（P1，r4 修正 `maintCalls` 语义与「同进程二次调用」期望、把 pending 正向路径拆到新测试文件）与 **NF-2**（P1，r4 把「全表皆坏行」拆成 (a)(b) 两条互不重叠的用例）**

### cr-02 [P1] 坏行满批时整表提前收尾：剩余正常行被永久跳过且表被标记「已完成」

> **round 2 修订（按 cr-24 的结论）**：round 1 的「游标化 + 终止条件收敛为仅 `rows.length === 0`」会把零进展护栏**中和掉**——异常打转时游标推过该行，下一批必然 0 行，末尾再无条件置标记，于是「静默宣布已完成」。本条已在 keyset 游标方案之上**补一道收尾谓词校验**作为最终判定权，零进展护栏降级为「提前止损」。详见本条改法第 9 步与验收段。
>
> **round 3 修订（按 cr-35 的结论）**：本条改法本身不变，但**第 9 步的收尾谓词校验必须把「不变量」写进代码注释**（`leftover ⊆ failedKeys` 依赖「收尾校验只在整表扫完后可达」这一前提，一旦有人改回提前 `break`，坏行会被永久跳过）；验收段的零进展护栏用例**标题与断言文案**同步改为「收尾谓词校验」口径（见 cr-35）。
>
> **round 4 修订（NF-2 · 验收段定点改写，**改法本身不变**）**：r3 验收段的「新增正例『全表皆坏行』」是一条**夹具与期望自相矛盾**的用例——夹具是「100 坏行 + 20 行正常」并断言 20 行已归一（⇒ `normalizedCount === 20` ⇒ `processedAny === true` ⇒ 收尾维护**必跑**），却挂着 `maintCalls === 0`（**必红**）；而同名用例在 cr-01 验收段里的期望是 `normalizedCount === 0 / maintCalls === 0`（隐含夹具只有坏行）。两处是**互斥夹具**。r4 拆成 **(a)「纯坏行表（0 正常行）」** 与 **(b)「坏行满批 + 尾部正常行（100 坏 + 20 好）」** 两条互不重叠的用例，并与 cr-01 / cr-24 / cr-23 统一引用同一对名称与同一套期望。另按 cr-35 的措辞修正 **`updateCount` 断言旁的注释**（见验收段）。

- 维度：B
- 文件：`packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts`（`normalizeTable`：`allKnownFailed → break` + 循环结束后无条件置 KKV 标记）
- 问题：坏行原样保留 → 仍留在谓词里，而 SELECT 是 `... WHERE <谓词> ORDER BY content_hash LIMIT 100`，同一批坏行会被反复选中（`failedKeys` 只能跳解码、跳不过 SELECT）。当「某批 100 行全是本轮已确认坏行」时直接 `break` 跳出**整表**循环，随后走末尾的无条件置标记。若坏行数 ≥100 且按 `content_hash` 排序在前、后面还跟着正常行，那些正常行**永远不会被归一**，而状态页显示「已完成」、后续启动走标记短路不再重扫。函数头注释写的意图（「让其余行先收敛」）与实现相反。
- 改法（可执行，keyset 游标化 **＋ 收尾谓词校验**）：
  1. 适配器 SQL 加游标占位：`selectSql` 改为 `SELECT ${primaryKeyColumn}, encoding, bytes FROM ${table} WHERE ${PREDICATE} AND ${primaryKeyColumn} > ? ORDER BY ${primaryKeyColumn} LIMIT ${BATCH_SIZE}`，即 SQL 文本里留一个 `?`；`updateSql` 不变。
  2. `normalizeTable` 内 `let cursor = "";`，每批 `conn.query<...>(adapter.selectSql, [cursor])`。
     - **游标初值 `""` 是安全的**：`content_hash` 恒为 sha256 hex 或测试夹具前缀，两表的主键列上不存在空串行，故 `content_hash > ''` 恒真、首批不会被漏掉。这一点要在代码注释里写明（否则后来者会怀疑空串游标是不是漏行）。
  3. 批处理完成后**无条件推进游标**：`cursor = String(record[rows[rows.length - 1]][adapter.primaryKeyColumn])`（取本批末行主键）。
  4. `allKnownFailed` 分支：`break` 改为「推进游标后 `continue`」（与零进展护栏分支同级，`continue` 前保留 `zeroProgressBatches` 逻辑判断——`allKnownFailed` 时**不计入零进展批**，因为那不是打转）。
  5. 循环终止条件收敛为仅 `rows.length === 0`。
  6. `failedKeys` **升为必需**（round 1 说「可保留」是不够的）：收尾谓词校验要用 `failedKeys.size` 作为「已知坏行」的基数来判定 `leftover` 是否超标，游标化后同批内仍可能重复命中同一行，缺了它无法区分「只剩坏行」与「还有别的行」。
  7. 同步重写 `ZERO_PROGRESS_BATCH_LIMIT` 的 `@remarks` 论证：原论证依赖「同一批被反复 SELECT」，游标化后改为「**连续 3 批谓词非空但 UPDATE 全部 `changes = 0` 且无新增坏行**」——游标保证不会重复命中同一批，故零进展只可能来自「驱动把二进制绑回 TEXT 导致 UPDATE 后谓词仍命中」等真异常。**护栏本身保留**（提前止损，避免一轮空转到 60s 预算耗尽），但注释口径要改：「**这是提前止损，不是最终判定；最终判定权交给循环后的收尾谓词校验**」。
  8. 末尾置标记分支的注释补一句：置标记时把本表 `failedCount` 一并写入（与 cr-06 联动，标记值载体与兼容解析口径见 cr-06）。
  9. **循环退出后、置标记前，加一次收尾谓词校验**（本轮新增，是本条的关键修订）：
     ```ts
     const leftover = await countPendingRows(conn, adapter);
     if (leftover > failedKeys.size) {
       console.warn(...); // 仍有非坏行留在谓词里
       return { done: false, normalizedCount, failedCount, stalled: true };
     }
     ```
     - `leftover > failedKeys.size` ⇒ 谓词里还剩**不是本轮已知坏行**的行（三种成因：异常打转 / 并发抢写 / 降级期新写入的 legacy 行）→ `console.warn` 并 `return { done: false, normalizedCount, failedCount, stalled: true }`，**不置标记**。app 层见 `stalled === true` 立即停止本进程重试，下次启动会重新扫。
     - `leftover <= failedKeys.size` ⇒ 谓词里只剩已知坏行 → **照原逻辑置标记**。「坏行不阻断收敛」的契约不变（否则每次启动重扫同一批坏行、任务永不收敛）。
     - `countPendingRows` 复用既有的谓词 COUNT 逻辑（`getBlobBinaryStatus` 里那段），抽成同文件内的小助手即可。**【r3 advisory ② · 措辞更正】** 现状核对：实现里 `countPendingRows` 已经是**独立助手**，不需要再「抽成」——本步后半句属冗余措辞，改为「直接复用 / 调用同文件内既有的 `countPendingRows` 助手（`getBlobBinaryStatus` 共用同一份谓词 COUNT 逻辑）」。
     - **【r3 · cr-35 收尾判据不变量（必须写进代码注释，不只是本文档）】** 在第 9 步的校验代码上方写清这段不变量的**内容与前提**：
       > **收尾校验只在 `rows.length === 0`（游标 `""` 起整表扫完）之后可达。** 其余三个出口——预算耗尽、`shouldPause` 守卫、零进展护栏——都在校验之前 `return`。因此谓词里残留的每一行必在本轮被 SELECT 访问过 ⇒ **`leftover ⊆ failedKeys`**，即 `leftover > failedKeys.size` 时一定存在「不是已知坏行」的残留。
       >
       > **前提（禁止破坏）**：收尾校验之前**不得再引入任何 `break`**。循环内一旦出现提前 `break`（round 1 的 `allKnownFailed → break` 那种形态），`leftover` 就可能大于 `failedKeys.size` 而被误判为「有残留」，或者反之——更糟的是，break 之后仍走置标记分支时坏行会被**永久跳过**（下次启动标记短路、不再重扫）。修改本函数循环结构时必须同步检查本段注释。
  - **【r3 · cr-35 备注】`allKnownFailed` 分支在 keyset 化后属正常路径不可达**：改为「推进游标后 `continue`」之后，触发该分支需要「同一批里每行都是本轮已知坏行」，而 keyset 游标已保证不重复命中同一行，正常路径下几乎不可能凑齐整批。**保留它作防御性兜底**（驱动行为异常时仍不炸栈），但必须在代码注释里注明「正常路径不可达、保留作防御」，避免后来者误以为它仍在承重、或反过来删掉它之后忘了为什么不需要它。
  - 退化方案（**不推荐**，仅在下游评估游标改造成本过高时启用）：`blockedKeys` 收集 + 动态拼 `AND content_hash NOT IN (?,?,...)` 分片排除；缺点是 SQL 长度与批次耦合，且需额外分片逻辑。**注意：退化方案同样必须补第 9 步的收尾谓词校验**，否则 `NOT IN` 分片数写错时会静默漏行。
- 验收/测试：
  - **【r3 · cr-35 标题与断言文案重写】既有「零进展护栏」用例**（`packages/core/test/infra/blob-binary-normalization.test.ts:651`「零进展护栏：UPDATE 恒 changes=0 时 3 批内 stalled=true、零归一、两表标记均未置」）：
    - **标题改为**「**收尾谓词校验判定残留非坏行 → `stalled:true`、标记未置**」——按 cr-24/cr-35 改完，这条用例真正的证物已经不是「3 批护栏收手」，而是「**收尾谓词校验拦住了残留行**」。标题不改会让后来者以为护栏仍以「批数」为判据。
    - **断言文案同步改**：构造 UPDATE 恒 `changes = 0` 的驱动桩 → 跑一轮 → 断言 `stalled === true`、`done === false`、**两表 KKV 标记均为 `null`（未置）**、`failedCount` 为本表坏行数。
    - `updateCount` 断言**由现值 `=== 6` 调整为 `=== 2`**（游标化后每表只发 1 次 UPDATE；依据：现有夹具每表 1 行 + `wrapConnBlobUpdateNoEffect`）——断言旁的注释改写为「**本夹具下是收尾谓词校验先收手（护栏凑不满 3 批）**」——**不要**再写「护栏在表级首次判定即止损」之类的窄口径（与已改的用例标题不一致），也**不要**退回 r2 里「3 批」的旧口径。若下游实测探针数与此不符，以实际口径为准并在注释里写清差异来源。
    - 该用例在当前实现下应为**红**（缺的是收尾谓词校验与 `updateCount` 口径；注意 `BlobBinaryRunResult.stalled` 字段**已存在**于 `blob-binary-normalization.ts`，本轮不新增该字段，只新增收尾校验与语义扩宽），修完转绿。
  - **【r4 · NF-2 拆分】正例用例拆成两条互不重叠的用例**（r3 的「新增正例『全表皆坏行』」把「100 坏 + 20 好」的夹具与 `maintCalls === 0` 的期望绑在一起，两者互斥、必红）：
    - **(a)「纯坏行表（0 正常行）」**：只插 100 行坏 base64（`content_hash` 排序在前，如 `bad-0000…bad-0099`）、**不插任何正常行** → 断言 `normalizedCount === 0`、`failedCount === 100`、`done === true`、`stalled === false`、两表标记已置、**`maintCalls === 0`**（按 cr-26 的 `afterMaintenance` 回调计数，**不再用探针里的 `VACUUM` 次数**——零行被改写不触发收尾维护）。用例注释写明「按 cr-25 收敛：零行被改写 → 不释放 freelist 页 → 不触发收尾维护」并钉住反向判据：**把 `(done && failedCount > 0)` 那一支补回门条件，本用例即变红**。当前实现下应为红（缺 `processedAny` 门条件 ⇒ 零改写也会进入维护段 ⇒ `maintCalls` 为 1），修完转绿。
    - **(b)「坏行满批 + 尾部正常行（100 坏 + 20 好）」**：100 行坏 + 20 行正常（`good-0100…good-0119`），跑一轮 `runBlobBinaryNormalization` 后断言：20 行正常行**全部** `encoding='zlib'`、`TYPEOF(bytes)='blob'`、`byte_len = LENGTH(bytes)`；`normalizedCount === 20`；标记已置；返回 `done === true`、`failedCount === 100`、`stalled === false`。
      - 附带断言（**cr-25 + cr-31 联动**）：**`maintCalls === 1`**——本轮确有推进（20 行被改写）⇒ `processedAny === true` ⇒ 收尾维护段被进入。用例注释写明「与 (a) 的差别只在**有没有正常行**：(a) 零改写 → 零维护；(b) 改写了 20 行 → 进入一次维护段」，并写明 `maintCalls` 的语义是「进入维护段的次数」（见 cr-31 的语义定义）。
      - 该用例在**当前实现下应为红**（正常行一条都没归一），修完转绿——可作为回归锚点。
  - **【r4 · NF-2 反向判据的归属】**「把 (b) 的实现改回 `allKnownFailed → break` 即变红」这条反向判据**保留在 cr-02 与 cr-35 两处**（两处指向同一条用例，不必各自复述实现细节，只写「(b) 变红」）。
  - 新增反例「**1 正常行 + 1 打转行**」：让驱动对某行 UPDATE 恒 `changes = 0`、且该行谓词在更新后仍命中 → 跑一轮 → 断言 `stalled === true`、`done === false`、**该表标记未置**（`kkv_entry` 里查不到）。这条直接证「收尾谓词校验把打转行的静默完成挡住了」——round 1 的游标化方案在本用例下会红（会误置标记）。
- 来源：`review-scope-core-prod/B-02` ＋ **`review-full/cr-24`（P1，round 2 修订终止条件与收尾校验）＋ `review-full-3` 的 **NF-2**（P1，r4 拆分 (a)(b) 两条互斥夹具的用例）**

### cr-03 [P1] desktop 自动收尾 VACUUM 冻结 main 事件循环，且绕开既有 busy 契约

> **round 2 修订（按 cr-26 的结论）**：round 1 的方案 A「只包收尾段」在 app 层**不可执行**——收尾段在 core 内部触发，app 层拿不到它的边界，只能包整轮；而包整轮会让设置页「清理」按钮被 `controlsDisabled` 连带禁用最长 60s。round 1 的方案 B 保留。本条收敛为 A′：**core 开一对回调**，由 app 层只包住真正的维护段。

- 维度：B + C-orch
- 文件：
  - `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts`（`RunBlobBinaryNormalizationOptions` 类型、收尾维护调用点）
  - `apps/desktop/src/main/services/blob-binary-normalization.service.ts`（传回调）
  - 对照 `apps/desktop/src/main/services/db-maintenance.service.ts:56-66`（既有纪律注释）与 `apps/desktop/test/db-maintenance-handlers.test.ts:89-116`（既有探针手法）
- 问题：既有代码已写死「better-sqlite3 的 VACUUM 同步执行、期间 main 事件循环冻结，所以必须在进入前立刻置 `setDesktopDbMaintenanceBusy(true)`」。新引入的自动收尾跑的是同一条 `runStartupMaintenanceOnce` 链路，却既不置 busy、也不给 renderer 信号；storage 页 2s 轮询在冻结期连 IPC 都发不出。与 cr-01 叠加后变成「每次冷启动都冻一次」。
- 改法（可执行，**round 2 收敛为 A′**）：
  1. **为什么 round 1 的 A（只包收尾段）在 app 层做不到**：收尾维护由 core 的 `runBlobBinaryNormalization` 内部在 `if (allDone && processedAny)` 分支里同步调用，app 层既看不到它的进入点也拿不到它的 finally 时机。要「只包收尾段」，唯一途径是让 core 主动报出边界——即第 2 步的回调。
  2. **core 增可选回调**：`RunBlobBinaryNormalizationOptions` 增
     ```ts
     beforeMaintenance?: () => void;
     afterMaintenance?: () => void;
     ```
     在维护链路**前后**各调一次。调用点必须包在既有维护链路的 try/catch 内；**`afterMaintenance` 必须在 finally 语义下被调用**——VACUUM 抛错（磁盘满 / 库被锁）时也要复位 busy，否则桌面端会永久卡在「维护中」直到重启。两个回调本身异常也要各自 try/catch 包一层，不能让 app 的回调把 core 的归一任务带崩。
  3. **desktop 侧接线**：`runBlobBinaryNormalization({ ..., beforeMaintenance: () => setDesktopDbMaintenanceBusy(true), afterMaintenance: () => setDesktopDbMaintenanceBusy(false) })`。**归一循环本身不置 busy**（归一是分批短事务 + `setTimeout(0)` 让步，不冻结事件循环）。
  4. mobile / CLI 侧不传这两个回调（mobile 无 busy 设施，见 open_questions #5；CLI 无 UI）。
  5. 注释写明与 `db-maintenance.service.ts` 既有纪律的关系：「core 不感知 app 的 busy 状态，由 app 通过回调在**真正会冻结事件循环的那一段**自行置位——这与手动 `db-maintenance.service.ts` 的纪律是同一条纪律的两处落点」。
  6. **round 1 的方案 B 保留为备选**（若下游认为加回调的 core 改动面不可接受）：自动收尾改为「归一完成后只在 UI 上提示『可回收 X MB』，由用户点『数据清理』触发」，与 spec「手动数据清理」路径合流。走 B 时 `beforeMaintenance` / `afterMaintenance` 两个回调可留空不实现。
- 验收/测试：
  - `apps/desktop/test/` 新增集成用例——触发一次自动收尾，在 VACUUM 执行瞬间（用 `conn.prepare` 探针或包住 `runStartupMaintenanceOnce` 的路径）采样 `isDesktopDbMaintenanceBusy()` 断言为 `true`，收尾结束后断言恢复 `false`。写法照 `db-maintenance-handlers.test.ts:89-116` 的探针手法。
  - **新增「VACUUM 抛错后 busy 仍被复位」用例**：让 VACUUM 抛错 → 断言 `isDesktopDbMaintenanceBusy() === false`（证 `afterMaintenance` 的 finally 语义）。
  - **新增「归一循环进行中（未进维护段）busy 仍为 false」用例**：造足量的 legacy 行让归一跑满若干批、在批间探针处采样 → 断言 `isDesktopDbMaintenanceBusy() === false`，同时断言设置页「清理」按钮的 `controlsDisabled` **不因归一而被置位**（这正是 round 1 方案 A 的失败模式，本条必须钉死）。
- 来源：`review-scope-apps/B-02` ＋ **`review-full/cr-26`（P2，round 2 修订为 A′）**

### cr-04 [P1] mobile `getDatabaseMaintenanceStats` 用 `Promise.all` 整体 reject，新失败源打掉既有指标

- 维度：B + C-orch
- 文件：`apps/mobile/src/services/db-maintenance.service.ts:46-59`；对照 `apps/desktop/src/main/services/db-maintenance.service.ts` 同名函数的反向决策注释
- 问题：`getBlobBinaryStatus` 抛错会让整个统计 `Promise.all` reject，`StorageConfigScreen` 的 catch 把库体积、可回收量、blobBinary 一起置空——一个**附属展示字段**新增的失败源能打掉改动前就已存在的两个指标。desktop 侧已明确反其道（独立 try/catch 兜底 + warn 一次），两端同 DTO、同 UI 却是两种降级语义。
- 改法（可执行）：照 desktop 抽出 `async function sampleBlobBinaryStatus(conn): Promise<BlobBinaryTableStatus[]>`——内部 try/catch，失败 `console.warn` 一次后返回 `[]`；`getDatabaseMaintenanceStats` 的 `Promise.all` 只承担 `fileBytes` + `storageStats`，`blobBinary` 走单独 `await sampleBlobBinaryStatus(conn)`。**返回形状不变**（`blobBinary` 仍是数组，失败时为空数组）。
- 验收/测试：`apps/mobile/__tests__/db-maintenance.service.test.ts` 补一条——mock `getBlobBinaryStatus`（或注入抛错的 conn）使其 reject，断言 `getDatabaseMaintenanceStats` **不 reject**，且返回 `{ fileBytes: <有值>, reclaimableBytes: <有值>, blobBinary: [] }`。
- 来源：`review-scope-apps/B-03`

### cr-05 [P1] desktop 归一循环在连接被关闭时被永久杀死且不再重挂（与 mobile 不对称）

- 维度：B + C-orch
- 文件：`apps/desktop/src/main/services/blob-binary-normalization.service.ts`（catch → warn → `return`；`let scheduled = false` 进程级布尔；服务头注释）
- 问题：`rebootstrapDesktopRuntime()` 先关连接再重建，调用方是**备份导入**与**云同步 pull/push**。归一一轮最长 60s，连接在轮内被关的概率不低 → `conn.query` 抛「connection is not open」→ 被 catch 吞掉后循环永久退出，而 `scheduled` 已为 `true` → 再也不会起第二条。云同步 pull 换回的是远端库（可能整库未归一），此后本会话状态行永远显示「进行中（剩余 N 条）」且永不推进。mobile 用 `scheduledRuntime` 对象身份去重、provider 换 runtime 时 effect 重跑，天然可恢复——两端对同一故障的处理正好相反。服务头注释只承认了「备份导入不重入」这一半。
- 改法（可执行，二选一，推荐 A）：
  - **A（去重键换成连接身份，与 mobile 对齐）**：把 `let scheduled = false` 改为 `let scheduledRuntime: TdbcConnection | null = null`（或存 runtime 对象），比较键从布尔改为连接实例；每次调度前 `if (scheduledConn === runtime.conn) return;`，连接换了即视为新任务、允许重挂；`finally` 里复位为 `null`。
  - **B（最小改动）**：在 `rebootstrapDesktopRuntime()` 之后显式复位挂载标记并重挂归一任务。
  - 两者都要把 catch 分流：**「连接已关闭 / not open」→ warn 后允许重挂（不算失败收手）**；「其它归一真失败」→ warn 后本进程收手。判据用 `error.message` 含 `connection is not open` / `not open` 之类，或引入一个本地 `isConnectionClosedError()` 小助手。
  - 头注释补一句：「连接被 rebootstrap 换掉时本任务视为可重入（去重键=连接身份），远端库回灌后会重新归一」。
- 验收/测试：`apps/desktop/test/` 新增用例——挂载后模拟一次 rebootstrap（替换 runtime.conn），断言第二次调度**仍会发生**（当前实现为红）；再补一条：轮内注入 `conn.query` 抛「not open」，断言下一轮可重挂。
- 来源：`review-scope-apps/B-04`

### cr-06 [P1] 状态行「已完成」在仍有解码失败行时误报 + `failedCount` 三端全丢

> **round 2 修订（按 cr-27 / cr-28 的结论）**：① 删掉 round 1 的第 4 步「`getBlobBinaryStatus` 补写标记」——状态查询是挂在 desktop 2s 轮询上的**纯读**路径，让它写 KKV 等于让只读路径持写锁；且「双信号」在任务侧本就不成立（后台任务自己会置标记，状态查询只需如实回报）。② 验收补两处**既有整对象断言**（`failedCount` 增字段后 `deepEqual` 会打红）。③ UI 文案按 OQ-C 默认**本轮做最小文案**。

- 维度：A（口径）+ B + C-orch
- 文件：
  - `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts`（`getBlobBinaryStatus` 的「标记已置即 `done`」分支；`normalizeTable` 末尾的标记值当前只存 ISO 时间戳）
  - `packages/core/test/infra/blob-binary-normalization.test.ts`（**两处既有整对象 `deepEqual` 断言**，见验收段）
  - `apps/desktop/shared/ipc-types.ts:1517-1524`（DTO 注释「数据上已全归一」）
  - `apps/mobile/src/services/db-maintenance.service.ts`、`apps/desktop/src/main/services/db-maintenance.service.ts`（DTO 透传）
  - `apps/mobile/src/screens/stack/StorageConfigScreen.tsx`（**r3 路径更正**）、`apps/desktop/renderer/features/settings/SettingsViews.tsx`（状态行渲染）
- 问题：坏行策略本身合理（跳过归一 + 计入 `failedCount` + 该表照常置完成标记，否则永不收敛），但状态查询**见标记就返回** `{ done: true, pendingCount: 0 }` → 仍有 N 行停在 base64 形态的库在 UI 上显示「已完成」，DTO 注释那句「数据上已全归一」在该路径上是**错的**。同时 `BlobBinaryRunResult.failedCount` 在三端全部丢弃（mobile/desktop 只判 `done`/`stalled`，CLI 连返回值都不接），用户侧零信号。
- 改法（可执行，**round 2 收敛版**）：
  1. **标记值升级为 JSON**：core 里置标记时写 `JSON.stringify({ at: new Date().toISOString(), failedCount })`（`normalizeTable` 已有本表 `failedCount`；具体置标记时机按 cr-24 修订后的收尾谓词校验走）。
  2. **向后兼容解析**：读标记时 `readDoneMarker` 改为返回 `BlobBinaryDoneMarker | null`（`{ failedCount: number }`），解析时 `try { JSON.parse(raw) } catch { /* 旧版纯 ISO 字符串 */ return { failedCount: 0 } }`，解析失败按 `failedCount = 0` 处理（不抛、不 warn 刷屏，可选 warn 一次）。
  3. **状态查询回报 failedCount**：`BlobBinaryTableStatus` 增字段 `failedCount: number`；`getBlobBinaryStatus` 在「标记已置」分支返回 `{ done: true, pendingCount: 0, failedCount: marker.failedCount }`；「谓词空未置标记」分支返回 `failedCount: 0`。
  4. **【round 2 删除】round 1 的第 4 步「在『谓词 COUNT 为 0 但标记未置』时补写标记」按默认方案 A 删掉**——状态查询保持**纯读**：
     - `getBlobBinaryStatus` 挂在 desktop 存储页的 2s 轮询上，让它写 KKV 意味着**一条只读采样路径会持写锁**（SQLite 写事务与其它读并发互斥），而它只是采样、无任何非幂等副作用，写了也白写。
     - 所谓「双信号」在任务侧本就不成立：`runBlobBinaryNormalization` 自己在收敛后会置标记，状态查询如实回报即可；反过来「标记未置 + 谓词空」只可能发生在「归一任务还没跑到这张表」或「上个版本留下的空库首启」，任务侧会在本轮补上，UI 短暂显示不一致不构成需要写库解决的问题。
     - 若下游坚持保留（方案 B），须补齐三处说明：① 函数头 `@remarks` 标注**「非纯读：可能写 KKV」**；② 注明该写入会**被 desktop 2s 轮询采样到**，写失败不得上抛；③ 注明它与 cr-01 门条件的交互（补写标记本身不置 `processedAny`，不触发收尾维护）。见 open_questions OQ-B。
  5. **DTO 注释与字段**：desktop `ipc-types.ts` 的 `BlobBinaryTableStatusDto` 增 `failedCount`，把「数据上已全归一」改为「**标记已置或谓词空即视为完成**；`failedCount > 0` 表示有跳过行需人工关注（行原样保留、读路径按 miss 自愈）」；mobile 侧 DTO/透传同步。
  6. **UI 第三态（OQ-C 默认：本轮做最小文案）**：两端状态行在 `done && failedCount > 0` 时显示「**已完成（N 条需人工处理）**」（约 2 行改动/端），否则显示原「已完成」。备选是延后到下一迭代（仅保留第 5 步的 DTO 注释更正）——见 open_questions OQ-C。
- 验收/测试：
  - core 新增用例 A：插 1 行非法 base64 + 1 行合法行 → 跑归一 → `getBlobBinaryStatus` 能区分两种情况：合法表 `failedCount === 0`、坏行表 `failedCount === 1` 且 `done === true`；标记值可 `JSON.parse` 出 `failedCount`。
  - core 新增用例 C（旧值兼容）：手工把标记值写成纯 ISO 字符串 → `getBlobBinaryStatus` 不抛，`failedCount === 0`。
  - **【round 2 调整】原「用例 B：谓词空但两表标记皆无 → 查询后标记被补置」删除**（第 4 步已按方案 A 删掉）。改为：`getBlobBinaryStatus` 在该输入下返回 `done === true, pendingCount === 0, failedCount === 0`，并**断言 `kkv_entry` 里两表标记在查询前后完全一致（纯读，无副作用）**——这条反过来钉死第 4 步确实被删干净了。
  - **【round 2 新增 · cr-27】两处既有整对象 `deepEqual` 断言必须同步补字段**（`BlobBinaryTableStatus` 增 `failedCount` 后会直接打红，不改就等于把既有红灯留给下游）：
    - `packages/core/test/infra/blob-binary-normalization.test.ts`：`assert.deepEqual(table, { table: table.table, done: true, pendingCount: 0 })` → 补 `failedCount: 0`；顺手把自反的 `table: table.table` 改成字面量 `'vfsContent'`（自反断言读起来像 bug，实际是噪声）。
    - 同文件：`assert.deepEqual(tables, [{ table: "vfsContent", done: false, pendingCount: 1 }, { table: "fileCache", done: true, pendingCount: 0 }])` → 两个元素各补 `failedCount: 0`。
  - **【round 2 新增 · OQ-C】UI 文案用例**：两端源码契约测试各补一条——断言状态行渲染分支含 `failedCount > 0` 的第三态判断与「需人工处理」字样（mobile 并入 `apps/mobile/__tests__/storage-config-screen-source.test.ts`，desktop 并入 `apps/desktop/test/settings-db-maintenance-ui.test.ts`）。
- 来源：`review-scope-apps/B-05` ＋ `review-scope-core-prod/C-orch-01`（完成态双信号）＋ **`review-full/cr-27`（P2，既有断言打红）＋ `review-full/cr-28`（P2，只读路径变写者）**

### cr-07 [P1] T-BB4「第二遍不下发 UPDATE」断言恒真、无牙齿

> **round 2 修订（按 OQ#12 的默认动作，消歧）**：round 1 写的是「改用例」——把既有 T-BB4 直接改成「清标记后第二遍」。但**清标记会顺带废掉「标记短路」这条快路径的覆盖**（本文件另有 cr-09 / cr-10 间接涉及，但那两条的意图不同）。本条收敛为**拆两条**：原 T-BB4 原样保留（只换掉恒真断言），**新增**一条专门证谓词幂等的用例。

- 维度：G
- 文件：`packages/core/test/infra/blob-binary-normalization.test.ts`（幂等用例的第二遍探针断言）
- 问题：第二遍时两表标记已置 → `readDoneMarker → continue`，`normalizeTable` 根本不被调用；即便被调用，谓词已空 → SELECT 0 行 → 仍无 UPDATE。两条路径都让 `assert.deepEqual(second.seen.filter(isBlobTableUpdate), [])` **恒真**。这正是 cr-func2 must-fix #5 的产出物：名义闭合、实质未闭合。
- 改法（可执行，**round 2 拆两条**）：
  1. **原 T-BB4 保留**（不删、不改输入）：两表标记已置的情况下连跑第二遍，把恒真的 `assert.deepEqual(second.seen.filter(isBlobTableUpdate), [])` 换成**路径覆盖级的断言**——`assert.equal(second.normalizedCount, 0)` ＋ 探针里 `UPDATE <blob 表>` 计数为 0 ＋ 两表数据快照 `deepEqual` 不变。用例注释写明：「**本用例只覆盖标记短路路径**（`readDoneMarker → continue`），谓词幂等由下面新增的用例覆盖；不要指望本用例在清掉标记后仍成立」。
     - **【r3 advisory ① · 措辞软化】**r2 里写的「换成**有判据的**断言」措辞偏强——**原 T-BB4 的无牙齿性（恒真）由第 2 条「清标记后第二遍」承担**，第 1 条只是**路径覆盖**（证标记短路时不多跑、也不改数据），它自己并不需要、也不应该有「把恒真断言变成真判据」的野心。理由：第 1 条走的是 `readDoneMarker → continue`，`normalizeTable` 根本不被调用，无论谓词写得多离谱它都绿——**结构上就不可能长出牙齿**。注释里按这个口径写，别让后来者以为「有判据」是个待兑现的承诺。
  2. **新增用例「清标记后第二遍」**：第二遍调用前 `DELETE FROM kkv_entry WHERE module = BLOB_BINARY_KKV_MODULE`（或按 key 逐个删）——清空 `nm-blob-binary` 下的**两条表完成标记**，强迫第二遍真走谓词扫描路径。断言：`second.normalizedCount === 0`、两表数据快照 `deepEqual`（归一后不可再变）、`second.seen.filter(isBlobTableUpdate).length === 0`。**这条才是「幂等由谓词保证，而非被标记遮蔽」的牙齿**。
  3. 两条用例的用例注释都要写明验收语义：「若把实现改成『忽略标记强制重扫』，第 2 条**仍绿**（谓词确实幂等）——这正是它有牙齿的判据」；反之「若把谓词写错导致二次改写，第 2 条**变红**」。
  4. round 1 原第 3 步的「补反证用例（预置 vfsContentDone、只给 fileCache 插 1 行 legacy）」**并入 cr-10**，本条不重复计。
  5. 注意：第 2 条删标记后第二遍会因 cr-01 收敛后的门条件（本轮零行被改写 → `processedAny === false`）而**不触发**收尾维护。若同时测收尾维护次数，**必须拆成独立用例**，不要混在同一条里。
- 验收/测试：两条用例都绿；把谓词故意写错（如改成 `encoding != 'zlib'` 让已归一行的谓词重新命中）时，**只有第 2 条变红**（第 1 条仍绿，因为它走标记短路）；把实现改成忽略标记强制重扫时，**两条都仍绿**（说明第 1 条不是靠行为差异假绿）。
- 来源：`review-scope-core-tests/G-1` ＋ **round 2 消歧：open_questions OQ#12**

### cr-08 [P2] `withSqlProbe` 未覆盖 `conn.execute`，注释把「当前实现」当契约写死

- 维度：G
- 文件：`packages/core/test/infra/blob-binary-normalization.test.ts`（`withSqlProbe`）
- 问题：探针只包了 `conn.query`（及 transaction），若实现把语句改走 `conn.execute`（这是合法重构），探针会**静默漏记**，让「不下发 UPDATE」类断言变得不可信；同时注释把「当前实现用哪几个口」写成了契约。
- 改法（可执行）：
  1. `withSqlProbe` 一并覆写 `conn.execute`（记录到同一个 `seen` 数组后转发原实现）。
  2. `ProbedConn` 类型补 `execute` 成员（签名与 `TdbcConnection` 一致）。
  3. 注释改为：「按**连接端口**全量拦截（`query` / `execute` / `transaction`），不依赖实现当前用到哪几个口」。
- 验收/测试：新增一条自检——在用例里临时让被测代码走 `conn.execute`（或直接对探针对象调 `execute`），断言 `seen` 能记录到。
- 来源：`review-scope-core-tests/G-2`

### cr-09 [P2] `getBlobBinaryStatus`「标记未置 + 谓词空 → `done:true`」分支完全无用例（含空库首启场景）

- 维度：G
- 文件：`packages/core/test/infra/blob-binary-normalization.test.ts`
- 问题：这条分支零覆盖，空库首启这一最常见路径反而没测。（**r2 更正**：round 1 曾把该分支描述为「cr-06 要补写标记的落点」——cr-28 已把 cr-06 的补写标记删掉，本分支现在只是**纯读回报**分支，但仍需用例钉住其返回值。）
- 改法（可执行）：新增用例——
  1. 不插任何 legacy 行、两表标记皆无 → 断言 `getBlobBinaryStatus(conn).tables` 深等 `[{ table: "vfsContent", done: true, pendingCount: 0, failedCount: 0 }, { table: "fileCache", done: true, pendingCount: 0, failedCount: 0 }]`（字段随 cr-06 增补同步；这两处整对象断言的同步见 cr-27）。
  2. 空库首跑对照：全新内存库直接 `runBlobBinaryNormalization` → 断言 `{ done: true, normalizedCount: 0, failedCount: 0, stalled: false }`，且两表 KKV 标记均被置上。
- 验收/测试：两条用例红→绿；第 2 条同时覆盖「空库首启由任务侧置标记」（不再引用已删除的 cr-06 第 4 步）。
- 来源：`review-scope-core-tests/A-1`

### cr-10 [P2] T-BB5 缺「一表已置标记、另一表仍待归一」的执行侧互不牵连覆盖；也未断言中断轮里另一表标记已置

- 维度：G
- 文件：`packages/core/test/infra/blob-binary-normalization.test.ts`
- 问题：spec 承诺「三表各自短路，互不牵连」在**状态查询侧**有覆盖，但**执行侧**（一轮里一表走标记短路、另一表真归一）零覆盖；「两表标记合并成一个共享 key 就变红」这一验收语义没有落成断言。
- 改法（可执行）：新增用例——预置 `vfsContentDone`、只给 `session_file_cache_blob` 插 1 行 → 跑一轮 → 断言：fileCache 行已归一（`encoding='zlib'` / `TYPEOF='blob'` / `byte_len = LENGTH(bytes)`）、`fileCacheDone` 标记已置、探针中 `vfs_content_blob` 的 UPDATE 计数为 `0`；并在用例注释里写死验收语义：「若把两表完成标记合并成一个共享 key，本用例应变红」。另在既有「预算耗尽模拟杀进程」用例里补一条断言：中断轮内**另一张已完成的表**标记仍处于已置状态。
- 验收/测试：用例在「标记合并成一个 key」的错误实现下变红；正确实现下绿。
- 来源：`review-scope-core-tests/A-2`

### cr-11 [P2] T-BB7 零丢失校验对 file_cache 只走共享 codec，未走真实读链路（与 vfs 侧不对称）

- 维度：G
- 文件：`packages/core/test/infra/blob-binary-normalization.test.ts`
- 问题：VFS 侧零丢失比对走真实 `SqliteVfsContentStore` 读链路，file_cache 侧只比对共享 codec 的直接调用——写侧若在 store/service 层引入形态 bug（例如读时按 `encoding` 走错分支），现有断言测不出来。
- 改法（可执行）：在 T-BB7 的比对循环里，对 fc 行追加一条真实读链路断言：
  ```ts
  const roundTrip = await createSessionKkvService(conn()).get(
    "bb-session",
    SESSION_KKV_DOMAIN_FILE_CACHE,
    item.hash
  );
  assert.equal(roundTrip, item.plain, "file_cache 真实读链路应还原原文");
  ```
  （`insertLegacyRow` 已插好 entry 引用行，无需额外造数据。）
- 验收/测试：把 file cache 读路径的 `encoding` 分支临时写错时该断言变红。
- 来源：`review-scope-core-tests/A-3`

### cr-12 [P2] file_cache 侧 T-BB2 缺 `TYPEOF(bytes)='text'` 前置断言（可能在错误前置形态下依然绿）

- 维度：G
- 文件：`packages/core/test/session-kkv/file-cache-store.test.ts`（用例编号实为 **T-R7**，见 cr-22 ⑤）
- 问题：用例只断言 `sk.get` 等值。若构造时前置形态不是 `zlib-b64` + TEXT（例如误建成二进制），读路径的兜底分支同样能还原 → 用例绿但没测到「存量 base64 文本」这条路。
- 改法（可执行）：在 `sk.get` 等值断言**之前**补一条前置断言：`SELECT TYPEOF(bytes) FROM session_file_cache_blob WHERE content_hash = ?` 深等 `text`（照同文件 T-BB3 的写法）。顺手把 `encoding` 断言也写死为 `zlib-b64`。
- 验收/测试：把构造语料的 `encoding` 或存储形态改错时该前置断言先红。
- 来源：`review-scope-core-tests/B-1`

### cr-13 [P2] file_cache 侧缺「同 hash 复用不改写存量行」用例（`INSERT OR IGNORE` 承诺无回归保护）

- 维度：G
- 文件：`packages/core/test/session-kkv/file-cache-store.test.ts`
- 问题：`file-cache-store` 的 `set` 走 `INSERT OR IGNORE`（同 `contentHash` 复用、不改写存量行），这是「重复写不产生写放大、也不把已归一行打回旧形态」的关键承诺，但零测试保护。
- 改法（可执行）：新增用例——先直插一行 `encoding='zlib-b64'` + TEXT 的 blob 行与对应 entry 行 → 再对**同一 contentHash** 调 `sk.set` → 断言：`session_file_cache_blob` 仍只有 1 行、`encoding` 仍为 `zlib-b64`、`TYPEOF(bytes)` 仍为 `text`、`byte_len` 未变、`sk.get` 仍能还原原文。
- 验收/测试：把 `INSERT OR IGNORE` 改成 `INSERT OR REPLACE` 时该用例变红。
- 来源：`review-scope-core-tests/B-2`

### cr-14 [P2] `assert.notEqual(result, null, "手动「数据清理」不受启动去重标记约束")` 是恒真断言

- 维度：G
- 文件：`packages/core/test/infra/db-maintenance.test.ts`（T-DM4）
- 问题：`runStartupMaintenanceOnce` 的返回类型若为 `null | void` 之类，断言形式与实际不符，且该行并未真正证到「手动路径不被启动去重标记 gate 住」。
- 改法（可执行，二选一）：**A（推荐）** 删掉该行，把注释改为「判据在下方：若手动路径被启动去重标记 gate 住，`freelistAfter` 会停在 >0，下方断言即红」；**B** 换成有信息量的断言：先断言一次 `runStartupMaintenanceOnce(conn) === null`（证明启动去重标记确已置），再走手动路径断言 `freelistAfter` 收缩。具体走 A 还是 B 由下游看现有返回类型决定。
- 验收/测试：若把手动路径错误地 gate 在启动去重标记之后，`freelistAfter` 断言变红。
- 来源：`review-scope-core-tests/G-3`

### cr-15 [P2]「标记短路面」用例重复手写探针 + 恢复时在共享 conn 上留 bound 函数 own-property 遮蔽

- 维度：G
- 文件：`packages/core/test/infra/blob-binary-normalization.test.ts`（「标记短路面」用例）
- 问题：手工 patch `conn.query` 重复了 `withSqlProbe` 的能力；且若用 `conn.query = fn` 方式恢复（赋回 bound 函数而非删除 own property），共享 conn 上会残留 own-property 遮蔽原型方法，后续用例拿到的不是原生实现（`db-maintenance.test.ts` 正是从 dist `@novel-master/core` 拿同一实例的场景，见 open_questions #10）。
- 改法（可执行）：改用同文件的 `withSqlProbe`（删掉手工 patch 段，断言改用 `probe.seen`）；确保探针恢复用 `delete (conn as any).query` 而非赋回函数。
- 验收/测试：跑完该用例后断言 `conn.query === Object.getPrototypeOf(conn).query` 成立。
- 来源：`review-scope-core-tests/G-4`

### cr-16 [P2] 三处过期注释与口径

- 维度：C（质量）+ F（注释）
- 文件：
  - `packages/core/src/domain/vfs/content-store/logic/zlib-codec.ts:15`（摘要仍写「Node / Desktop」，而 `@remarks` 已声明三端同形态，自相矛盾）
  - `packages/core/src/domain/session-kkv/logic/file-cache-blob-codec.ts:4-6`（模块头仍列已不再 import 的 `blob-bytes-codec`）
  - `apps/desktop/shared/ipc-types.ts:1519`（「数据上已全归一」口径错）
- 问题：注释与实现/口径不符，误导后续维护者（尤其 ipc-types 那条直接是**错误口径**，见 cr-06）。
- 改法（可执行）：逐条改准——
  1. `zlib-codec.ts:15`：把摘要里的「Node / Desktop」改为「三端同形态（Node / Desktop / RN）」，与下方 `@remarks` 一致。
  2. `file-cache-blob-codec.ts:4-6`：模块头依赖清单删掉 `blob-bytes-codec`（已不再 import），改为实际 import 的 `zlib-codec`；若注释里含 `{@link BlobBytesCodec}` 之类指向已删符号的引用一并清理。
  3. `ipc-types.ts:1519`：注释随 cr-06 第 5 步一起改（完成态判据 = 标记已置或谓词空；`failedCount > 0` 表示有跳过行）。
- 验收/测试：无需新用例，随 cr-06 与 typecheck / lint 通过即可；建议在 CR 复检时人工核对三处措辞。
- 来源：`review-scope-core-prod/C-01` ＋ `review-scope-apps/B-05`（注释部分）

### cr-17 [P2] desktop 状态行用错 CSS 类族，与同分区其它行视觉不一致

- 维度：J（UI）
- 文件：`apps/desktop/renderer/features/settings/SettingsViews.tsx`（新增三行用 `settings-field__label` + 内联 `marginLeft`）
- 问题：同分区其它行用 `settings-row__label` / `settings-row__value`（`--text` 14px/500 + ellipsis），新行另起类族 + 内联缩进 → 字号/字重/截断行为与邻行不一致。
- 改法（可执行）：把新三行的类名换成 `settings-row__label` / `settings-row__value`，删掉内联 `marginLeft`，缩进改由既有容器结构承担（若需缩进，用同分区已有写法，不要新造内联样式）。
- 验收/测试：`apps/desktop/test/settings-db-maintenance-ui.test.ts` 补一条源码断言锁类名（断言含 `settings-row__label` 且不含 `settings-field__label` / `marginLeft`）。
- 来源：`review-scope-apps/C-01`

### cr-18 [P2] `formatBlobBinaryStatus` 手写行类型，重复同文件已声明的 DTO

- 维度：C（质量）
- 文件：`apps/desktop/renderer/features/settings/SettingsViews.tsx`
- 问题：形参是手写的行内对象类型，与 `ipc-types.ts` 已声明的 `BlobBinaryTableStatusDto` 重复；DTO 字段一变（cr-06 增 `failedCount`）这里会静默漂移。
- 改法（可执行）：从 `ipc-types.ts` import `BlobBinaryTableStatusDto`，形参改为 `readonly BlobBinaryTableStatusDto[]`（或 `readonly BlobBinaryTableStatusDto[] | undefined` + 空态处理，视现有签名）。
- 验收/测试：随 cr-06 给 DTO 增 `failedCount` 后，本函数类型不报错即证同步（desktop renderer `tsc` 跑一次）。
- 来源：`review-scope-apps/C-02`

### cr-19 [P2] 死导出 `runDesktopBlobBinaryNormalization`

- 维度：C（质量 · 死代码）
- 文件：`apps/desktop/src/main/services/blob-binary-normalization.service.ts`
- 问题：唯一调用点在同文件内，`export` 无外部消费方；本轮 core 侧已按同一口径删死导出，此处口径应一致（内部常量不应固化为公共 API，见 open_questions #1）。
- 改法（可执行）：去掉 `export` 关键字（保留 `const`/`async function` 本体），并检查 `main.ts` 的挂载调用是否走同文件内部路径（若是跨文件调用，则改为经由内部调度入口调用，**不要保留 export**）。
- 验收/测试：desktop main `tsc` 通过；`grep -rn "runDesktopBlobBinaryNormalization" apps/desktop` 只剩定义处与同文件调用处。
- 来源：`review-scope-apps/C-03`

### cr-20 [P2] 同一语义在两端两种数据形状 / 两套装配方式

> **round 3 修订（按 cr-36 的结论）**：round 2 写的「两端形状统一」方案**不可执行且与 cr-21 ① 冲突**——①「两端的类型统一从各自 `ipc-types.ts` 取」在 mobile 侧**没有 `ipc-types` 模块**（mobile 不走 IPC，直接同进程调 service），该句是伪路径；② 统一包装形状必然连带改 `StorageConfigScreen` 消费点与 mobile 测试，而 cr-21 ① 已要求动同一处，形成两处互斥要求。本条收敛为**「不统一形状、只做三件实事」**。另修正 `StorageConfigScreen` 的路径（r2 写成 `screens/settings/`，仓库实际是 `screens/stack/`）。
>
> **round 4 修订（NF-3）**：**改法 (a)(b)(c) 本身不变**，只把「文件」段里已无任何一步落点的 `apps/mobile/src/screens/stack/StorageConfigScreen.tsx` 一行**删掉**（r3 修正了路径，但路径正确 ≠ 这一轮要改它）。另在 cr-36 验收 ② 把「mobile 消费点与 mobile 测试本轮不要求任何改动」**限定为「不要求因统一包装形状而改动形状相关断言」**——cr-21 ① 的三行状态行契约断言**仍照做**，二者不再互斥。

- 维度：C-orch
- 文件：
  - `apps/mobile/src/services/db-maintenance.service.ts`（零变换 `[...tables]` 拍平 + re-export core 类型给 UI）
  - `apps/desktop/shared/ipc-types.ts`（保留 `{ tables }` 包装 + 独立 DTO）
  - `apps/desktop/renderer/features/settings/SettingsViews.tsx:144-152`（`BLOB_BINARY_TABLE_ORDER` 与 `BLOB_BINARY_TABLE_LABELS` 两份平行常量）
  - ~~`apps/mobile/src/screens/stack/StorageConfigScreen.tsx`（LABELS 派生 ROWS）~~ —— **【r4 · NF-3 删除】**：r3 虽已把路径更正为 `screens/stack/`，但 (a)(b)(c) 三步**没有任何一步落在该文件**（(a) 改的是 `db-maintenance.service.ts`、(b) 改的是 `SettingsViews.tsx`、(c) 写进业务 spec），且本条已明确「不统一形状、不改 UI 消费点」。故从「文件」段删除，避免下游误以为要动它。若后续要引用该文件，只以 **cr-21 ①** 为准（那里有它真正要落的断言）。
- 问题：同一状态语义，mobile 拍平成数组、desktop 保留 `{ tables }` 包装；两端装配方式也不同（desktop 两份平行常量，mobile 从 LABELS 派生）。**「形状差异」本身不是缺陷**——desktop 的 `{ tables }` 是 IPC DTO 惯例（便于后续加字段），mobile 的数组是「直接喂 `<FlatList>`」的列表惯例，各有其道理；真正的重复只有 desktop 内部那两份平行表顺序常量。
- 改法（可执行，**r3 收敛版 —— 按 (a)(b)(c) 执行，不再二选一**）：
  - **(a) mobile 侧拍平加注释**：`apps/mobile/src/services/db-maintenance.service.ts` 里 `[...blobBinary.tables]` 那行上方加注释「**数组直接给列表渲染用**：`<FlatList data={...}>` 需要稳定的扁平数组，故在此拍平；desktop 走 IPC DTO 惯例保留 `{ tables }` 包装，两端形状不统一是有意为之」。**不改返回形状、不改 UI 消费点。**
  - **(b) desktop 去双份常量**：`apps/desktop/renderer/features/settings/SettingsViews.tsx` 的 `BLOB_BINARY_TABLE_ORDER`（现为独立的 `readonly BlobBinaryTableIdDto[]` 字面量）改为**从 `BLOB_BINARY_TABLE_LABELS` 派生**，消掉双份平行常量：
    ```ts
    const BLOB_BINARY_TABLE_LABELS: Record<BlobBinaryTableIdDto, string> = { /* 既有字面量 */ };
    // 顺序即 LABELS 的键序——不再单独维护一份平行常量，新增/重排表只改 LABELS 一处
    const BLOB_BINARY_TABLE_ORDER: readonly BlobBinaryTableIdDto[] =
      Object.keys(BLOB_BINARY_TABLE_LABELS) as BlobBinaryTableIdDto[];
    ```
    （`Object.keys` 的键序对非纯数字字符串键即字面量声明序；若要显式保序，也可改为 `LABELS` 先定义、`ORDER` 取其 `Object.keys`——两种写法都只留一份事实源。）
  - **(c) 「两端形状差异 + 理由」写进 spec 契约**（由 **cr-22 新增第 9 项**承接）：spec 里明确登记「desktop 保留 `{ tables }` 包装（IPC DTO 惯例，为后续加字段预留）、mobile 在 service 侧拍平成数组（直接喂列表渲染）」，并注明**这是有意的两端惯例差异，不要求统一**。
  - **【r3 删除】**round 2 的「连带改动 `StorageConfigScreen` 消费点与 mobile 测试」这条要求**取消**——不统一形状就不需要动消费点，cr-21 ① 也就不与之冲突。
  - **【r3 措辞更正】**round 2 的「两端的类型统一从各自 `ipc-types.ts` 取」**不可执行**（mobile 没有 `ipc-types` 模块）→ 正确口径为：**desktop 的 DTO 类型取 `apps/desktop/shared/ipc-types.ts`；mobile 无 IPC 层，由 service 侧自声明 DTO**（现有的「re-export core 类型给 UI」保持不变即可，不必强行自声明，等价且改动面更小）。
- 验收/测试：desktop renderer `tsc` 通过；desktop UI 源码断言（`apps/desktop/test/settings-db-maintenance-ui.test.ts`，与 cr-17 的类名断言可合并到同一条源码契约用例）里补一条「`BLOB_BINARY_TABLE_ORDER` 不是独立字面量数组、而是从 LABELS 派生」——例如断言源码不含 `const BLOB_BINARY_TABLE_ORDER: readonly BlobBinaryTableIdDto[] = [`；反向验证：把派生改回独立字面量时该断言变红。mobile 侧只需 `tsc -p tsconfig.build.json` 通过（形状未变）。
- 来源：`review-scope-apps/C-orch-01` ＋ **`review-full-2/cr-36`（P2，r3 改写为 (a)(b)(c) 并更正路径与类型来源口径）**

### cr-21 [P2] 三个现成测试文件未覆盖新行为

- 维度：G
- 文件：
  - `apps/mobile/__tests__/storage-config-screen-source.test.ts`（新增三行状态行零覆盖）
  - `apps/desktop/test/settings-db-maintenance-ui.test.ts`（T-UID1 无一涉及 blobBinary）
  - `apps/desktop/test/db-maintenance-handlers.test.ts`（T-DMD2 未断言新增的 `blobBinary` 字段，cr-04 的兜底分支完全无覆盖）
- 问题：三个文件已经是本仓对应的既有契约测试落点，新行为却没进去，导致下游改 UI / 改 handler 不会被测到。
- 改法（可执行）：各补 1~2 条断言——
  1. mobile 源码契约：断言 `StorageConfigScreen` 源码含三行状态行、顺序在「数据清理」之后、value 取自 `blobBinary` 数组。
  2. desktop UI 源码契约：断言类名 `settings-row__label` / `settings-row__value`（与 cr-17 同一条用例）。
  3. desktop handler：断言返回体含 `blobBinary` 且形状为 `{ tables: [...] }`；再补一条——采样 `getBlobBinaryStatus` 抛错时，断言返回 `tables: []` 且 `fileBytes` **仍在**（cr-04 兜底分支）。
- 验收/测试：三条断言在对应行为被破坏时变红（desktop handler 那条即 cr-04 的回归防护）。
- 来源：`review-scope-apps/G-01`

### cr-22 [P2] 文档 / 口径同步（下游执行时闭合，改的是业务 spec 的「实现期补充」与状态文件注记）

> **round 2 修订（按 cr-30 的结论）**：增两项（会话级去重的载体写错了、状态查询 COUNT 不可索引的风险没登记），删一项（零进展护栏论证已并入 cr-02 修订，不再单列）。
>
> **round 3 修订（按 cr-34 的结论）**：再增两项——① **状态行第三态 + `failedCount` 的 spec 文本侧**（`spec.md:79` 现在仍写「返回 `{ done, pendingCount }`」，与 cr-06 增 `failedCount`、与 OQ-C 的第三态文案都不一致；这是 SD-2 的另一半，处置不能只挂在实现侧）；② **新增的持久化 KKV key `startupMaintenancePending` 在 spec 里零登记**（cr-01 引入的新写路径，不登记 = 下次做 A2/Part B 的人会漏掉它）。另承接 cr-20 (c) 的「两端形状差异 + 理由」写入 spec 契约。本条由七项扩为十一项（编号 1~11，第 6 项是 round 2 的删除占位，实际生效 10 项）。

- 维度：K（文档同步）+ A（口径）
- 文件：
  - `docs/Iterations/binary-blob-and-vfs-pack/spec.md`（「实现期补充（A1 落地记录）」节 + 「测试策略」节 + 「风险与回滚方案 · Part A」+ 「变更点清单」#6）
  - `docs/apm/RULE.md`（本 diff 新增的「`schema_migrations` 只登记不搬运」条目）
- 改法（可执行，**round 3 修订版：编号 1~11，其中第 6 项为 round 2 的「删除占位」，实际生效 10 项**）：
  1. **app 层失败策略表**补进 spec「实现期补充」：mobile = error → warn 并本进程收手；desktop = error → warn 并本进程收手；cli = error → 上抛（无 try/catch 兜底）。这张表此前只散在注释里。
  2. **状态行契约**补一句：「core 返回**已注册适配器**的子集，未注册的表（如 A2 才启用的 `messageContent`）由 UI 以 `—` 占位」。
  3. **CLI「内联预算制执行」措辞**按 cr-01 修正：改成「稳态零成本短路；仅在**本轮确有推进（成功改写 ≥1 行）且全部表完成时**跑一次收尾维护链路；上一轮维护失败会由持久化标记补跑」，并注明 CLI 首轮仍会同步阻塞（见 open_questions #4）。
  4. **desktop「备份导入不重入」**由「设计取向」升格为带修法的条目：按 cr-05 把「去重键 = 连接身份 / rebootstrap 后可重挂」写进 spec 契约。
  5. **测试口径四项更正**：T-BB7 的语料并非真实附件形态（是构造语料）；T-BB6 组合数为 **5** 不是 6；T-BB5 用「预算耗尽」模拟杀进程（不是真杀进程）；file_cache 侧 T-BB2 的实际用例编号是 **T-R7**（与 core 侧 T-BB2 同名不同物）。
  6. **【round 2 删除】**round 1 的第 7 项「零进展护栏的论证前提随 cr-02 游标化重写」**删掉**——该论证已在 cr-02 改法第 7 步里完整写定（护栏降级为提前止损、最终判定权归收尾谓词校验），本条不重复列，避免两处措辞漂移。spec 侧如需体现，在第 3 项里带一句「循环退出后以收尾谓词校验作最终判定」即可。
  7. **【round 2 新增 · 会话级去重的载体写错了】**spec「变更点清单」#6 现在写的是「`db-maintenance.service.ts` / 维护链路（VACUUM）会话级去重」——实际实现是**新增了 `runStartupMaintenanceOnce`**，手动路径 `runDatabaseMaintenance` **刻意不受该去重约束**（用户手动点「数据清理」必须每次真跑，不能被上一轮的启动去重标记 gate 住）。改法：
     - spec 变更点 #6 的措辞改成「**新增 `runStartupMaintenanceOnce`：会话级去重的收尾维护入口；手动路径 `runDatabaseMaintenance` 刻意不受其约束**」；
     - `docs/apm/RULE.md` 里本 diff 新增的「`schema_migrations` 只登记不搬运」那条纪律中，涉及的表述改为「在**本轮确有推进且全部表完成时**挂一次**会话级去重的维护链路**（`runStartupMaintenanceOnce`）」——不要写成「改 `runDatabaseMaintenance` 本身」，否则后续维护者会把手动路径也 gate 进去。
  8. **【round 2 新增 · 状态查询的 COUNT 不可索引】**spec「风险与回滚方案 · Part A」补一条风险：「**状态查询的归一谓词 COUNT 不可索引**：`getBlobBinaryStatus` 每表一次 `COUNT(*) ... WHERE <归一谓词>`，谓词作用在 `bytes` 的 `TYPEOF`/长度上无法走索引；未完成态下 desktop 存储页的 2s 轮询会触发**全表扫**」。并登记为 **A2 接入 `chat_message`（约 43MB）的前置条件**：A2 开工前必须给状态采样加节流（如最短采样间隔）或改采样口径（先读标记，标记已置则直接返回 `failedCount` 不再 COUNT），否则多一张大表会把 2s 轮询变成持续全表扫。
  9. **【r3 新增 · cr-34 状态行第三态 + `failedCount` 的 spec 文本侧】**`docs/Iterations/binary-blob-and-vfs-pack/spec.md:79` 现在写的是「状态查询 `getBlobBinaryStatus(conn)` 返回三表各自的 `{ done, pendingCount }` 供存储页显示」——cr-06 给 `BlobBinaryTableStatus` 增了 `failedCount`、OQ-C 默认还要渲染第三态，spec 侧不跟上就是**文档比实现少一个字段**（SD-2 的文本侧半边）。改法：
     - 该行改为「状态查询 `getBlobBinaryStatus(conn)` 返回三表各自的 `{ done, pendingCount, failedCount }` 供存储页显示；**`done && failedCount > 0` 时状态行显示『已完成（N 条需人工处理）』**（第三态文案，见 open_questions OQ-C）」（括号内按 OQ-C 的最终拍板增删）。
     - 顺带在同节补一句口径：`failedCount` 的含义是「本轮跳过、解码失败的坏行，行原样保留、读路径按 miss 自愈」，避免读者把它当成「数据损坏待修」。
  10. **【r3 新增 · cr-34 登记新引入的持久化 key `startupMaintenancePending`】**cr-01 引入了一个**新的 KKV 写路径**（KKV module `nm-blob-binary` 下的 `startupMaintenancePending`，见改法第 4 步 a/b），但它在业务 spec 里**零登记**——「变更点清单」与「风险与回滚方案」都没有它。下次做 A2 / Part B 的人清点 KKV 写路径时会漏掉它。改法（**单列一条**）：
      - 归入 **spec「变更点清单」**：新增一条「**`startupMaintenancePending`（KKV module `nm-blob-binary`）：收尾维护失败时的兜底标记，入口读到即无视 `processedAny` 强制补跑一次维护链路；清标记以 `runStartupMaintenanceOnce` 返回非 `null` 为条件（同进程重入时保留待下次冷启动，见 cr-32）」。
      - 归入 **spec「风险与回滚方案 · Part A」**：补一条已知代价「**该标记在用户手动「数据清理」成功后会变陈旧**，导致下次冷启动多跑一次全库 VACUUM；本轮按 cr-01 改法段末的 advisory ③（二选一，默认在手动路径成功后顺带清该标记）处理（默认在手动路径成功后顺带清该标记）」。
  11. **【r3 新增 · cr-36 (c) 两端状态形状差异写进 spec 契约】**把「desktop 保留 `{ tables }` 包装、mobile 在 service 侧拍平成数组」这一**有意的两端惯例差异**写进 spec 的状态查询契约（紧挨第 9 项那句）：「**两端形状不统一是有意为之**：desktop 走 IPC DTO 惯例，保留 `{ tables }` 包装以便后续加字段；mobile 不走 IPC、由 service 直接喂列表渲染，故在 service 侧拍平成数组。**不要求统一**。」——把「为什么不统一」提前写死，避免下一个 review 又把它当成待收敛的 deviation 提出来。
- 验收/测试：文档 diff 复检（下一轮 review-scope 核对措辞与实现一致）；无代码用例。额外：第 8 项的节流/口径前置条件须在 A2 的 `prd.md` 或 spec「A2 前置」清单里可 grep 到；**第 9/10/11 项须可 grep 到**（第 9 项：`spec.md` 含 `failedCount` 与「需人工处理」字样；第 10 项：spec 变更点清单含 `startupMaintenancePending`；第 11 项：spec 含「不要求统一」/两端形状差异的理由句）。
- 来源：三个 scope 的 spec_deviations 汇总 ＋ **`review-full/cr-30`（P2，round 2 增两项删一项）＋ `review-full-2/cr-34`（P2，r3 增第 9/10 项）＋ `review-full-2/cr-36`（P2，r3 增第 11 项）**

### cr-23 [P2] spec「测试策略」节补 T 用例编号映射与新增用例清单

- 维度：K（文档同步）+ A（测试矩阵可追溯）
- 文件：`docs/Iterations/binary-blob-and-vfs-pack/spec.md`（「测试策略」节）
- 问题：spec 的 T 编号与实际落地的用例文件/用例名已经对不上（见 cr-22 ⑤），且 cr-07 ~ cr-15 新增的用例在 spec 里完全没有登记，后续无法追溯。
- 改法（可执行）：在「测试策略」节补一张 **T 编号 → 实际用例文件 → 断言要点** 的映射表，至少覆盖：
  - T-BB1/T-R7、T-BB2(core) / T-R7(fc)、T-BB3、T-BB4（幂等，**r2 起拆两条**：标记短路 / 清标记后谓词幂等，见 cr-07）、T-BB5（可重入 + cr-10 互不牵连）、T-BB6、T-BB7（+ cr-11）、T-BB8；
  - 新增用例清单（**r4 已按 NF-1 / NF-2 全量修订**）：
    - **【NF-2 · 拆成两条互不重叠的用例，四处统一引用同一对名称与同一套期望：cr-01 / cr-02 / cr-24 / 本清单】**
      - **(a)「纯坏行表（0 正常行）」** → `normalizedCount === 0`、`failedCount === 100`、`done === true`、`stalled === false`、标记已置、**`maintCalls === 0`**（钉 cr-25 收敛后的门条件；反向：把 `(done && failedCount > 0)` 那一支补回门条件即变红）。
      - **(b)「坏行满批 + 尾部正常行（100 坏 + 20 好）」** → 20 行全部 `encoding='zlib'` / `TYPEOF='blob'` / `byte_len = LENGTH(bytes)`、`normalizedCount === 20`、`failedCount === 100`、`done === true`、标记已置、**`maintCalls === 1`**（本轮确有推进 ⇒ 触发收尾维护）。反向：把 `allKnownFailed` 改回 `break` 即变红（反向判据登记在 cr-02 / cr-35）。
      - **为什么必须拆**：(a) 与 (b) 的差别只在**有没有正常行**；(b) 里 20 行被归一 ⇒ `processedAny === true` ⇒ 收尾维护必跑，r3 把 `maintCalls === 0` 挂在 (b) 上是必红的矛盾。
    - cr-01 稳态零维护用例 ＋ **缺失标记但谓词空用例** ＋ 首轮确有归一用例（这三条的判据一律是 `afterMaintenance` 回调计数 `maintCalls`，不再是探针里的 `VACUUM` 次数；原因见 cr-31：进程级去重标记已被本文件第一条用例消费）。
    - cr-06 标记 JSON / **纯读无副作用**（替掉原「补写标记」例）/ 旧值兼容三例 ＋ **cr-27 两处既有整对象断言补字段** ＋ **OQ-C 的 UI 第三态源码契约**；cr-09 空库与谓词空两例；cr-12 前置 TYPEOF 断言；cr-13 同 hash 复用用例；cr-14 T-DM4 判据；cr-15 探针恢复断言；cr-03 desktop busy 采样用例 ＋ **cr-26 VACUUM 抛错后复位 / 归一中不置 busy 两条**；cr-05 rebootstrap 重挂用例；cr-04 mobile 降级用例；cr-21 三端源码/handler 契约用例（mobile 那条按 cr-36 只需断言三行状态行顺序与取值，不涉及形状改造）。
    - **【NF-2】cr-02 的「1 正常行 + 1 打转行」反例** → `stalled === true`、`done === false`、该表标记未置。
    - **零进展护栏用例**（r3 已改标题为「收尾谓词校验判定残留非坏行 → `stalled:true`、标记未置」；**r4 更正**：`updateCount` 由现值 `=== 6` **调整为 `=== 2`**，依据「现有夹具每表 1 行 + `wrapConnBlobUpdateNoEffect`」，注释写「本夹具下是收尾谓词校验先收手（护栏凑不满 3 批）」）。
    - **【NF-1 · r4 新增测试文件 `packages/core/test/infra/blob-binary-normalization-maintenance.test.ts`】**该文件（独立进程 ⇒ 进程级去重标记未被消费）**必须登记下列用例，且第一条必须是 pending 用例**：
      1. **（该文件第一条）**「预置 `startupMaintenancePending` + 无待归一行 → `runBlobBinaryNormalization` → `maintCalls === 1` **且 `startupMaintenancePending` 被清**」——这条正向路径在既有文件里**不可观测**（`runStartupMaintenanceOnce` 恒返回 `null` ⇒ 条件式清标记分支永不执行），故必须独立进程承载。
      2. 「稳态（两表标记已置、无 pending）→ `maintCalls === 0`」——保证该文件自身也钉住零成本路径。
    - **【NF-1 · 既有文件侧改写的两条】**① cr-25 的 pending 兜底用例**从既有文件移出**（改到上面的新文件）；② cr-32 的「同进程二次调用」用例留在既有文件，期望改为 **`maintCalls === 1`**（进入了维护段）**且 `startupMaintenancePending` 未被误清**——判据落点是「标记是否被误清」，不是「是否进入维护段」。
  - **【r4 补记 · `maintCalls` 语义】** 凡用到 `maintCalls` 的用例，其注释都要写明：`maintCalls` = 「**进入收尾维护段的次数（含被进程级去重短路的调用）**」，**不代表 VACUUM 真跑**。
  - **r3 补记（无新增用例、仅措辞/注释同步的条目也要登记）**：cr-33 的三处 `stalled` 文档同步（core TSDoc + desktop/mobile service 注释）属文档 diff 复检项，不产生用例；cr-34 / cr-36 属 spec 文本项，由 cr-22 第 9/10/11 项承接，同样无用例。
  - 每条注明 blocking: yes/no 与映射的 Step。
- 验收/测试：下一轮 review 抽查 spec 表中的每个 T 编号都能在测试文件里 grep 到对应用例名。
- 来源：主代理汇总（保持 spec 与实际用例可追溯）

---

## round 2 新增 must-fix（cr-24 ~ cr-30，来自 round 1 末轮 `review-full`）

> `review-full` 对 round 1 的 fix-spec 判 `no`。其中 cr-24 / cr-25 是对既有条目**改法本身**的纠正（round 1 的方案有洞），本节只登记其 id、严重度、文件与「指向哪条既有条目的修订小节」，改法全文见对应修订小节，不在此重复罗列一套旧措辞。

### cr-24 [P1] cr-02 的游标化改法会中和零进展护栏并误置完成标记

- 维度：B（正确性）
- 文件：
  - `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts`（`normalizeTable` 主循环与末尾置标记分支）
  - `packages/core/test/infra/blob-binary-normalization.test.ts`（既有「零进展护栏」用例）
- 问题：round 1 给 cr-02 的方案是「keyset 游标化 + 循环退出条件收敛为仅 `rows.length === 0`」。这样一来，异常打转（驱动把二进制绑回 TEXT，UPDATE 后谓词仍命中）时游标会**推过该行** → 下一批返回 0 行 → 循环以「取不到行」的名义正常退出 → 末尾**无条件置完成标记** → 该表被静默宣布「已完成」，坏行/未归一行永远不再被扫。零进展护栏就此被中和。
- 改法：**见 cr-02 条目内的「round 2 修订（按 cr-24 的结论）」小节**——保留 keyset 游标，但在循环退出后、置标记前加**收尾谓词校验** `const leftover = await countPendingRows(conn, adapter);`：`leftover > failedKeys.size` ⇒ 仍有非坏行留在谓词里 ⇒ warn + `return { done: false, ..., stalled: true }` 且**不置标记**；`leftover <= failedKeys.size` ⇒ 只余已知坏行 ⇒ 照原逻辑置标记（坏行不阻断收敛的契约不变）。`failedKeys` 由「可保留」升为**必需**；`ZERO_PROGRESS_BATCH_LIMIT` 护栏保留但降级为「提前止损」。
- 验收/测试：**见 cr-02 验收段**——① 既有零进展护栏用例（UPDATE 恒 `changes = 0`）改完后必须仍绿且 `stalled === true` / `done === false` / 两标记 `null`；`updateCount` 断言**由现值 `=== 6` 调整为每表 1 次（`=== 2`）**并写明理由（依据：现有夹具每表 1 行 + `wrapConnBlobUpdateNoEffect`）；② **【r4 · NF-2 拆分】** 原先笼统写的「新增正例『全表皆坏行』→ `done:true`、标记已置、`failedCount = N`」**拆成两条互不重叠的用例**，与 cr-01 / cr-02 / cr-23 引用**同一对名称与同一套期望**：
  - **(a)「纯坏行表（0 正常行）」** → `normalizedCount === 0`、`failedCount === 100`、`done === true`、`stalled === false`、标记已置、**`maintCalls === 0`**（钉 cr-25 收敛后的门条件；反向：把 `(done && failedCount > 0)` 那一支补回门条件即变红）。
  - **(b)「坏行满批 + 尾部正常行（100 坏 + 20 好）」** → 20 行全部 `encoding='zlib'` / `TYPEOF='blob'` / `byte_len = LENGTH(bytes)`、`normalizedCount === 20`、`failedCount === 100`、`done === true`、标记已置、**`maintCalls === 1`**（本轮确有推进 ⇒ 触发收尾维护）。
  - **拆分理由**：r3 之前这条用例的夹具（「100 坏 + 20 好」且断言 20 行已归一）与它的期望（`maintCalls === 0`）**互斥必红**——`normalizedCount === 20` ⇒ `processedAny === true` ⇒ 收尾维护必跑；而 cr-01 侧的同名用例期望 `normalizedCount === 0 / maintCalls === 0`，隐含夹具只有坏行。两条必须各自独立、互不引用。
  - ③ 新增反例「1 正常 + 1 打转 → `stalled:true` 且标记未置」不变。
- 来源：`review-full`（cr-24）＋ **`review-full-3` 的 **NF-2**（P1，r4 拆分 (a)(b) 两条互斥夹具的用例）**

### cr-25 [P1] cr-01 的门条件无收益且丢维护失败兜底

- 维度：B（正确性）+ C-orch
- 文件：
  - `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts`（`runBlobBinaryNormalization` 的 `processedAny` 门条件、维护链路的 catch 分支、函数入口）
  - `apps/mobile/src/services/blob-binary-normalization.service.ts`、`apps/desktop/src/main/services/blob-binary-normalization.service.ts`（头注释）
  - `apps/cli/src/runtime.ts:184-187`（注释）
- 问题：round 1 给 cr-01 的门条件含 `(result.done && result.failedCount > 0)` 一支——**无收益**：只有成功改写才会往 freelist 里释放页，「本轮只余坏行、零行被改写」的完成态一个页都没释放，跑 GC/checkpoint/VACUUM 纯属白付代价，还要让 desktop 冻一次事件循环。**丢兜底**：收尾维护链路是 `try/catch + warn` 的——VACUUM 失败（磁盘满 / 库被锁）只 warn 就结束，freelist 页永久挂着没人回收，而加了 `processedAny` 门条件后**后续轮次（零推进）连重试的机会都没有**。
- 改法：**见 cr-01 条目内的「round 2 修订（按 cr-25 的结论）」小节**——门条件简化为 `processedAny = processedAny || result.normalizedCount > 0;`（删掉 `done && failedCount > 0` 分支并注释说明删除理由）；补维护失败兜底方案 A：catch 里写独立 KKV 标记 `startupMaintenancePending = "1"`，入口读到该标记则无视 `processedAny` 强制跑一次维护链路、成功后清标记（置/清都 try/catch，失败不抛）；三端头注释与 CLI 注释同步为「仅在本轮确有推进（成功改写 ≥1 行）且全部表完成时触发一次收尾维护；稳态零成本；上一轮维护失败会由持久化标记补跑」。
- 验收/测试：**见 cr-01 验收段（r4 已全段重写）**。要点：
  - **稳态用例**判据为 `maintCalls === 0`。
  - **「纯坏行表（0 正常行）」用例**断言 `normalizedCount === 0` / `failedCount === 100` / `done === true` / 标记已置、**`maintCalls === 0`**（**与 round 1 原改法的预期差异，须在用例注释写明**；**r3 起不再用探针里的 `VACUUM` 次数作为判据**，原因见 cr-31）。反向判据：**把 `(done && failedCount > 0)` 那一支补回门条件，该用例必须变红**——这是门条件真的被钉住的证据。
  - **「坏行满批 + 尾部正常行（100 坏 + 20 好）」用例**（NF-2 拆分出来的 (b)）断言 20 行归一、**`maintCalls === 1`**（本轮确有推进 ⇒ 触发收尾维护）。
  - **`startupMaintenancePending` 标记用例（有标记 → 进入维护段 → 标记被清）** —— **【r4 · NF-1 拆到新测试文件】**：「标记**被清**」这条正向路径在既有 `blob-binary-normalization.test.ts` 里**不可观测**（该文件第一条用例已消费进程级去重标记 ⇒ `runStartupMaintenanceOnce` 恒返回 `null` ⇒ 条件式清标记分支永不执行 ⇒ 断言「被清」必然打红）。故该用例**整条移到新文件** `packages/core/test/infra/blob-binary-normalization-maintenance.test.ts` 的**第一条**：预置 pending → `runBlobBinaryNormalization` → `maintCalls === 1` **且 `startupMaintenancePending` 被清**。详见 cr-31。
  - **「同进程二次调用」反例**（cr-32，留在既有文件）：期望为 **`maintCalls === 1`**（进入了维护段）**且 `startupMaintenancePending` 未被误清**——判据落点是「**标记是否被误清**」。反向：把清标记改回无条件 → 该用例变红。**【r4 更正】** r3 写的 `maintCalls === 0` 不可满足：`beforeMaintenance` 早于 `runStartupMaintenanceOnce` 的调用点（置 desktop busy 的职责要求），进程级去重短路发生在其**内部**、不影响 `beforeMaintenance` 被调。
  - **【r4 · `maintCalls` 语义】** 以上全部判据中的 `maintCalls` = 「**进入收尾维护段的次数（含被进程级去重短路的调用）**」，**不代表 VACUUM 真跑**；定义见 cr-31 验收段，并要求写进各用例注释。
- 来源：`review-full`（cr-25）＋ **`review-full-3` 的 **NF-1**（P1，r4 修正 pending 兜底用例的落点与二次调用的期望）＋ **NF-2**（P1，r4 拆分 (a)(b)）**

### cr-26 [P2] cr-03 的「只包收尾段」在 app 层不可执行

- 维度：C-orch
- 文件：
  - `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts`（`RunBlobBinaryNormalizationOptions`、收尾维护调用点）
  - `apps/desktop/src/main/services/blob-binary-normalization.service.ts`（传回调）
- 问题：round 1 的方案 A 让 app 层「只包收尾段」，但收尾段是在 core 的 `if (allDone && processedAny)` 分支里同步触发的，**app 层拿不到它的进入点与 finally 时机**；实际只能退化为「包整轮」，而整轮最长 60s——设置页「清理」按钮的 `controlsDisabled` 含 `maintenanceBusy`，会被连带禁用整整一轮归一。等于为了防一个 1s 级的事件循环冻结，换来一个 60s 的按钮不可用。
- 改法：**见 cr-03 条目内的「round 2 修订（按 cr-26 的结论）」小节**——推荐方案 **A′**：core 的 `RunBlobBinaryNormalizationOptions` 增可选回调 `beforeMaintenance?: () => void` / `afterMaintenance?: () => void`，在维护链路前后调用（包在既有 try/catch 内，`afterMaintenance` 必须在 **finally 语义**下被调——VACUUM 抛错也要复位）；desktop 侧传 `beforeMaintenance: () => setDesktopDbMaintenanceBusy(true)` / `afterMaintenance: () => setDesktopDbMaintenanceBusy(false)`；**归一循环本身不置 busy**。round 1 的方案 B 保留为备选。
- 验收/测试：**见 cr-03 验收段**——VACUUM 执行瞬间 `isDesktopDbMaintenanceBusy() === true`、结束后 false；新增「VACUUM 抛错后 busy 仍复位」与「归一循环进行中（未进维护段）`busy === false` 且「清理」按钮未被 `controlsDisabled` 连带」两条。
- 来源：`review-full`（cr-26）

### cr-27 [P2] cr-06 增 `failedCount` 会打红两处既有整对象断言

- 维度：G（测试）
- 文件：`packages/core/test/infra/blob-binary-normalization.test.ts`
- 问题：round 1 的 cr-06 要给 `BlobBinaryTableStatus` 增 `failedCount` 字段，而该文件里有两处对状态行的**整对象 `deepEqual` 断言**。`deepEqual` 比的是全字段——增字段后这两处**直接打红**，而它们是别人已经在绿的用例，下游很容易当成「改坏了一堆测试」而去改断言的期望值方向（改成只比部分字段），从而丢掉覆盖。必须显式列出。
- 改法：**见 cr-06 验收段的「【round 2 新增 · cr-27】两处既有整对象 `deepEqual` 断言必须同步补字段」那条**——`assert.deepEqual(table, { table: table.table, done: true, pendingCount: 0 })` 补 `failedCount: 0`（并把自反的 `table: table.table` 改成字面量 `'vfsContent'`）；`assert.deepEqual(tables, [{ table: "vfsContent", done: false, pendingCount: 1 }, { table: "fileCache", done: true, pendingCount: 0 }])` 两个元素各补 `failedCount: 0`。**只补字段，不得改成部分比对**。
- 验收/测试：改完后 core 全量（先重建 dist）这两处不红；同时反向验证——把某个期望值里的 `failedCount` 故意写错（例如 `failedCount: 1`）时该断言**应变红**（证明补的字段是真断言，不是摆设）。
- 来源：`review-full`（cr-27）

### cr-28 [P2] cr-06 把只读状态查询变成写者（挂在 2s 轮询上）

- 维度：B（正确性）+ C-orch
- 文件：`packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts`（`getBlobBinaryStatus` 的「谓词空未置标记」分支）
- 问题：round 1 的 cr-06 第 4 步要在 `getBlobBinaryStatus` 里「谓词 COUNT 为 0 但标记未置」时补写标记。这有两个问题：① `getBlobBinaryStatus` 挂在 **desktop 存储页的 2s 轮询**上，让它写 KKV 意味着一条**纯采样路径会持 SQLite 写锁**，而它既没有非幂等副作用、也没有必须立刻落库的理由；② 它想消灭的「双信号」在任务侧**本就不成立**——`runBlobBinaryNormalization` 自己收敛后会置标记，状态查询如实回报即可；「标记未置 + 谓词空」只出现在「归一还没跑到这张表」或「上个版本留下的空库首启」，任务侧本轮就会补上，UI 短暂不一致不值得用一次写操作去换。
- 改法：**见 cr-06 改法第 4 步**——按默认方案 A **删掉**补写标记，让 `getBlobBinaryStatus` 保持纯读；若走方案 B 保留，需补齐三处说明：① 函数头 `@remarks` 标注「非纯读：可能写 KKV」；② 注明该写入会被 2s 轮询采样到、写失败不得上抛；③ 注明它与 cr-01 门条件的交互（补写标记不置 `processedAny`，不触发收尾维护）。方案选择见 open_questions OQ-B。
- 验收/测试：**见 cr-06 验收段的「【round 2 调整】原『用例 B…』删除」那条**——`getBlobBinaryStatus` 在「谓词空但两表标记皆无」输入下返回 `{ done: true, pendingCount: 0, failedCount: 0 }` **且 `kkv_entry` 两表标记在查询前后完全不变**（纯读、无副作用），并删除原「标记在查询后被补置」的断言与用例。
- 来源：`review-full`（cr-28）

### cr-29 [P2] 缺设备侧 scratch 收尾与发版前置（详见 K 节）

- 维度：K（文档 / 收尾同步）
- 文件：本 fix-spec 的「K 节建议（下游执行时闭合）」节；`docs/.iteration-state.yaml` 的 `manual_pending` 字段（**由主代理在执行时更新，本节点不改**）
- 问题：round 1 的 fix-spec 只在「合并后 QA」段提了一句「测完须回备份并装回原包」，**K 节（下游执行的收尾清单）里没有对应的可执行动作**；且没有登记 A1 的**发版前置**——本分支不含 `feat/message-content-compression`，单独装上去会让聊天正文读成空，属于「能装但不能单独发版」的性质，必须写成硬前置而不是注意事项。
- 改法：**见 K 节新增的第 8、9 条**——
  1. **设备侧收尾**（解除 `manual_pending` 后执行）：验收完成即 `adb shell rm /data/local/tmp/nm-a1.apk /sdcard/Download/nm-a1-debase64.apk`；按 `docs/.iteration-state.yaml` 的 `manual_pending` 还原库（`run-as cp` 回 `databases/novel_master_vfs.pre-debase64-test.bak`）与 mcdev 包（`.worktree/f-message-content-compression` 内的 `app-debug.apk`，注意该包依赖 Metro 才能启动）；把实际清理结果**回写 `manual_pending`**（不要只在对话里说一句就把它清空）。
  2. **发版前置**：A1 依赖 `feat/message-content-compression` 合并（spec 前置依赖；本分支不含该功能，单独装上会让聊天正文读成空）→ **未合并前 desktop / mobile 均不得单独发版**；`CHANGELOG.md` 的 Unreleased 条目须与该分支一并发布，不得只发 A1。
- 验收/测试：K 节第 8、9 条可 grep 到；`manual_pending` 字段在设备恢复后被改为已还原并注明还原结果；发版动作在 `feat/message-content-compression` 合并前不发生（人工核对，无代码用例）。
- 来源：`review-full`（cr-29）

### cr-30 [P2] 三处文档同步缺口（会话级去重载体 / 状态查询采样风险 / RULE 条目）

- 维度：K（文档同步）+ A（口径）
- 文件：
  - `docs/Iterations/binary-blob-and-vfs-pack/spec.md`（「变更点清单」#6、「风险与回滚方案 · Part A」）
  - `docs/apm/RULE.md`（本 diff 新增的「`schema_migrations` 只登记不搬运」条目）
  - 本 fix-spec 的 K 节（与 cr-29 同批）
- 问题：① spec 变更点 #6 与 RULE 新增条目**都把「会话级去重」写成「改 `runDatabaseMaintenance` 本身」**，而实现其实是**新增 `runStartupMaintenanceOnce`、手动路径刻意不受该去重约束**——文档说错了会诱导后续维护者把手动「数据清理」也 gate 进启动去重标记，造成用户点了没反应；② spec「风险与回滚方案 · Part A」**没有登记「状态查询的归一谓词 COUNT 不可索引」**这条风险——desktop 2s 轮询在未完成态会全表扫，A2 接入 `chat_message`（约 43MB）后这条会从「慢」升级为「持续吃 IO」；③ K 节缺 cr-29 的设备侧收尾与发版前置。
- 改法：**见 cr-22 改法第 7、8 步**（①与②）与 **K 节新增的第 8、9 条**（③）——spec 变更点 #6 改措辞为「新增 `runStartupMaintenanceOnce`；手动路径 `runDatabaseMaintenance` 刻意不受其约束」；RULE 该条目改为「在**本轮确有推进且全部表完成时**挂一次会话级去重的维护链路」；spec Part A 风险节补 COUNT 不可索引一条并**登记为 A2 前置**。
- 验收/测试：文档 diff 复检（下一轮 review 抽查 spec 变更点 #6、RULE 条目、Part A 风险节三处措辞与实现一致）；A2 前置在 A2 的 `prd.md` / spec「A2 前置」清单里可 grep 到；K 节第 8、9 条存在。无代码用例。
- 来源：`review-full`（cr-30）

---

## round 3 新增 must-fix（cr-31 ~ cr-36，来自 round 2 末轮 `review-full-2`）

> `review-full-2` 对 r2 版的 fix-spec 判 `no`。与 round 1 末轮不同，本轮 6 条里**只有 cr-31 一条是对既有改法本身的证伪**（cr-01 的验收口径在本测试文件里根本跑不起来），其余 5 条是「照字面实现会静默失效」「文档三处措辞都错」「伪路径 / 伪可执行指令」「spec 文本侧漏字段」这类**执行性与文档同步问题**。本节只登记其 id、严重度、文件与「指向哪条既有条目的修订小节」，改法全文见对应修订小节，不在此重复罗列旧措辞。

### cr-31 [P1] cr-01 的验收段与进程级去重不可共存：VACUUM 观测在本测试文件里恒真 / 恒红

> **round 4 修订（NF-1 · 本条的主战场）**：r3 用 `maintCalls` 替换 VACUUM 探针只解决了「恒真」，**没解决 r3 自己请回来的「恒红」**——它留在本测试文件里的两条期望（① pending 兜底 → 标记被清；② 同进程二次调用 → `maintCalls === 0`）在**同一进程内必然打红**。本轮把 `maintCalls` 的语义写死、把判据落点换掉、并**新开一个测试文件**承载不可观测的正向路径。**改法（观测缝 = cr-26 的两个回调）本身不变。**

- 维度：G（测试）+ B（可观测性）
- 文件：
  - `packages/core/test/infra/blob-binary-normalization.test.ts`（**第 305 行起的第一条用例**「收尾维护链路失败（VACUUM 抛错）只 warn：归一结果照常返回，不影响启动链路」；以及 r2 版 cr-01 要求的全部新增验收用例）
  - `packages/core/test/infra/blob-binary-normalization-maintenance.test.ts`（**【r4 新建】** NF-1 的落地文件。独立进程 ⇒ `startupMaintenanceRan` 未被消费 ⇒ 「pending 标记真跑成功后会被清」这条正向路径在这里可观测。**顺序约束：本文件第一条用例必须是下面的「pending 补跑且被清」用例**）
  - `packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts:100-121`（`startupMaintenanceRan` 与 `runStartupMaintenanceOnce`）
  - 指向修订：**见 cr-01 条目内的「验收/测试（r4 全段重写）」小节**
- 问题：r2 版 cr-01 的验收段**自相矛盾，两头都跑不通**。① `runStartupMaintenanceOnce` 的进程级标记 `startupMaintenanceRan` 是**执行前置位、且失败不回滚**（源码已写明：「标记在执行前置…VACUUM 失败也不回滚标记」）；而本测试文件的**第一条用例**就是「VACUUM 抛错容错」——它必然走过维护段并消费掉该标记。于是**本文件后续用例永远观测不到 VACUUM**：稳态用例的「探针 SQL 不含 `VACUUM`」变成**恒真**（把 cr-01 的门条件整段删掉也照样绿 → 这个 P0 回归测试无牙），而「补跑用例 / 正向用例断言 `VACUUM === 1`」在文件尾部**必然打红**（追加得越靠后越必然）。
- 改法：**见 cr-01 验收段**——① 观测缝换成 cr-26 新增的 `beforeMaintenance` / `afterMaintenance` 回调，测试传 `let maintCalls = 0; afterMaintenance: () => { maintCalls += 1; }`，**以 `maintCalls` 作为「维护段是否被进入」的唯一判据**（理由写进用例注释：本文件既有用例已消费进程级去重标记 → VACUUM 类断言不可靠；回调缝与实现同源且无新增公共 API）；② **【r4】把 `maintCalls` 的语义写死并跨条目统一**：`maintCalls` = 「**进入收尾维护段的次数（含被进程级去重短路的调用）**」，即 `beforeMaintenance` / `afterMaintenance` 被调用的次数，**不代表 VACUUM 真跑**——进程级去重短路发生在 `runStartupMaintenanceOnce` **内部**，不影响 `beforeMaintenance` 被执行；③ **【r4 · NF-1】把「进入维护段」与「维护真跑了 / 标记真被清」这两件事拆开判**：
  - **判「进入维护段」** → 用 `maintCalls`（既有文件内即可，`=== 0` 或 `=== 1` 都能稳定断言）。
  - **判「维护真跑了 / pending 标记被清」** → **必须换到新文件** `blob-binary-normalization-maintenance.test.ts`（独立进程 ⇒ 标记未被消费 ⇒ `runStartupMaintenanceOnce` 返回非 `null` ⇒ 条件式清标记分支真的执行）。该文件第一条用例即「预置 `startupMaintenancePending` + 无待归一行 → `maintCalls === 1` **且 pending 被清**」；同文件再复验「稳态（两表标记已置、无 pending）→ `maintCalls === 0`」以保证可观测性。
  - **既有文件保留它自己的顺序约束与「标记已被消费」这一事实**（「VACUUM 容错用例必须是本文件第一条」照旧），**并在两文件的用例注释里互相点明分工**：既有文件不负责断言「标记被清」，新文件不重复既有文件的主循环 / 收尾谓词校验覆盖。
  - ④ 进程级顺序约束**保留**（理由改为「它消费标记、影响后续对维护链路本身的观测」），但**不再是**「后续断言 VACUUM 次数」的前提；⑤ K 节第 1 条的 `before` 钩子断言保留为**文档性防护**，并注明**它不解决可观测性、可观测性由回调缝承担**。
- 验收/测试：**见 cr-01 验收段**（判据一律以 `maintCalls` 为准，`maintCalls` 语义按上面 ② 定义）。**反向判据（必须真验，不许只跑正向）**：
  - **(A)** 把 cr-01 的门条件 `if (allDone && processedAny)` 整段短路成 `if (false)`，**「首轮确有归一」用例的 `maintCalls === 1` 必须立刻打红**（这才是「门条件真的被测住了」的判据；稳态用例是 `maintCalls === 0`，删掉门条件后它**不会**变红，属正常——不要因为稳态用例仍绿就以为改动没生效）。
  - **(B)**（**r4 新增**）把清标记改回「无条件清」，**「同进程二次调用」用例必须变红**（`startupMaintenancePending` 被误清）——这条现在的判据落点是**标记状态**而非维护段计数，所以它不受 `maintCalls` 语义的影响，稳定可验。
  - **(C)**（**r4 新增**）把 `(done && failedCount > 0)` 那一支补回门条件，**「纯坏行表（0 正常行）」用例必须变红**（`(a)` 的 `maintCalls === 0` 期望即 cr-25 收敛后的门条件本身）。
  - **新文件的两条用例**在正确实现下绿；把「维护成功返回后清标记」那段代码注释掉 → **该文件第一条用例变红**（pending 仍在），从而证明「独立进程」确实换来了可观测性，而不是白开一个文件。
  - **若删掉门条件后全部用例仍绿，即证 cr-31 的验收没有被真正落实。**
- 来源：`review-full-2`（cr-31）＋ **`review-full-3` 的 **NF-1**（P1，r4 补 `maintCalls` 语义定义、新增 `blob-binary-normalization-maintenance.test.ts`、改正「同进程二次调用」期望）**

### cr-32 [P2] 兜底补跑的「清标记」必须以 `runStartupMaintenanceOnce` 返回非 `null` 为条件

- 维度：B（正确性 · 兜底静默失效）
- 文件：`packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts`（cr-01 改法第 4 步 (b) 的清标记分支）；`packages/core/test/infra/blob-binary-normalization.test.ts`（新增「同进程二次调用」用例）
- 问题：r2 版把清标记写成无条件动作（`await runStartupMaintenanceOnce(conn); 清 startupMaintenancePending`）。但源码 `db-maintenance.service.ts:113-121` 的语义是「同进程内只真跑一次；已跑过时**直接短路返回 `null`**」，且标记**执行前置、失败不回滚**。于是同一进程内若已有别的启动期任务（或本轮已跑过一次）跑过维护，强制补跑会拿到 `null` 且**什么都不跑**——照字面实现会**把标记清掉而维护没跑，兜底静默失效**（freelist 页永久挂着、无人回收、且下次冷启动也读不到标记了）。
- 改法：**见 cr-01 改法第 4 步 (b) 的 r3 代码块**——改成条件式 `const result = await runStartupMaintenanceOnce(conn); if (result !== null) { 清标记 } else { console.warn("本进程已跑过收尾维护，startupMaintenancePending 保留待下次冷启动") }`，并注释写明 `result === null` 分支是**同进程重入的正常场景**（多个启动期任务叠加），不是异常。
- 验收/测试：**见 cr-01 验收段的「同进程二次调用」用例**——预置 pending 标记 → 先在同进程内跑一次 `runStartupMaintenanceOnce` 让进程级标记落位 → 再调 `runBlobBinaryNormalization` → 断言 **`maintCalls === 1`**（维护段**确实被进入**：入口读到 pending 标记强制走维护段，而 `beforeMaintenance` 早于 `runStartupMaintenanceOnce` 的调用点、承担置 desktop busy 的职责，故它必被调）**且 `startupMaintenancePending` 仍在 `kkv_entry` 里、未被误清**。反向验证：把清标记改回无条件，该用例**必须变红**。
  - **【r4 · NF-1 更正与判据落点】** r3 写的期望是 `maintCalls === 0`，**在本测试文件里不可满足**（`maintCalls` 实际为 `1`：`runStartupMaintenanceOnce` 的进程级去重短路发生在其**函数内部**，而 `beforeMaintenance` / `afterMaintenance` 加在 `runBlobBinaryNormalization` 的**收尾段调用点前后**，`beforeMaintenance` 还要先于它执行以置 busy）。因此本用例的**判据落点从「是否进入维护段」换成「`startupMaintenancePending` 是否被误清」**——后者才是这条用例真正要钉的东西（`result === null` ⇒ 不清标记 ⇒ 兜底留待下次冷启动）。反向判据不受 `maintCalls` 语义影响，稳定可验。
  - **【r4 补充 · 本条不承担正向路径】**「pending 标记**真跑成功后会被清**」这条**正向**路径在既有文件里**不可观测**（`runStartupMaintenanceOnce` 恒返回 `null` ⇒ 条件式清标记分支永不执行），已由 cr-31 **拆到新测试文件** `packages/core/test/infra/blob-binary-normalization-maintenance.test.ts` 承载。本条在既有文件侧**只负责反例**（标记不被误清）。两条合起来才完整覆盖「条件式清标记」的两个方向。
- 来源：`review-full-2`（cr-32）＋ **`review-full-3` 的 **NF-1**（P1，r4 把二次调用用例的期望由 `maintCalls === 0` 改为 `maintCalls === 1` 且以「标记未被误清」为判据落点）**

### cr-33 [P2] `stalled` 语义扩宽后的三处文档同步（现三处措辞都只覆盖「打转」）

- 维度：F（注释 / 文档同步）+ A（口径）
- 文件（三处，逐个改）：
  1. `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts`（`BlobBinaryRunResult.stalled` 的 TSDoc）
  2. `apps/desktop/src/main/services/blob-binary-normalization.service.ts`（服务头注释 + `if (result.stalled)` 分支的行内注释 + `console.warn` 文案）
  3. `apps/mobile/src/services/blob-binary-normalization.service.ts`（同上）
- 问题：cr-24 / cr-35 引入的收尾谓词校验把 `stalled` 的**触发面扩宽**了：现在的成因有三种——原地打转的 UPDATE 恒 `changes = 0`、并发端抢写、降级期新写入的 legacy 行——而三处文档现在都只写了第一种（desktop 头注释现为「`stalled === true`（**零进展护栏收手**）」）。字段语义扩宽了、文档没跟上，后续维护者读到会以为「`stalled` 只在 UPDATE 恒 0 时出现」，从而在排查「为什么库一直不完成」时排除掉并发/降级这两条真实成因。
- 改法：三处**统一**改为：「`stalled = true` 表示**收尾谓词校验判定谓词内仍有非坏行残留**（三种成因：原地打转的 UPDATE 恒 `changes = 0` / 并发端抢写 / 降级期新写入的 legacy 行）→ 本进程停手、**下个冷启动按谓词重扫**」。并各补一句**这是语义扩宽**（原语义仅「打转」）：「扩宽后的取舍是**本会话不再推进、下次冷启动重扫，无正确性损失**——已完成改写的行不会回退，只是节奏变慢。」
- 验收/测试：文档 diff 复检——三处措辞**一致**（同一句因果、同三种成因、无「零进展护栏收手」这种窄口径残留）；**无新增用例要求**（既有「零进展护栏」用例随 cr-35 调整标题与文案即可，断言不变）。反向判据：把三处措辞 grep 出来对比，任意两处不一致即判红。
- 来源：`review-full-2`（cr-33）

### cr-34 [P2] cr-22 增「状态行第三态 + `failedCount` 口径」与「新持久化 key 登记」；SD-2 处置补 spec 文本侧

- 维度：K（文档同步）+ A（口径）
- 文件：`docs/Iterations/binary-blob-and-vfs-pack/spec.md`（`:79` 状态查询契约行；「变更点清单」；「风险与回滚方案 · Part A」）；本 fix-spec 的 **SD 表**（SD-2 行）
- 问题：① `spec.md:79` 现在写「状态查询 `getBlobBinaryStatus(conn)` 返回三表各自的 `{ done, pendingCount }` 供存储页显示」——cr-06 已经给 `BlobBinaryTableStatus` 增了 `failedCount`、OQ-C 默认还要渲染第三态「已完成（N 条需人工处理）」，**spec 侧一个字段都没有**。而 SD-2（完成态双信号分叉）的处置只挂在 **cr-06 实现侧**、没挂 spec 文本侧，等于文档那一半没人负责。② cr-01 引入的**新持久化 KKV key `startupMaintenancePending`**（module `nm-blob-binary`）在业务 spec 的「变更点清单」/「风险与回滚方案」里**零登记**——不登记就等于这个 key 对后续迭代（A2 / Part B）不存在，清点 KKV 写路径时会漏掉。
- 改法：**见 cr-22 改法第 9、10 项**——第 9 项把 `spec.md:79` 改为「返回 `{ done, pendingCount, failedCount }`；`done && failedCount > 0` 时状态行显示『已完成（N 条需人工处理）』」并补 `failedCount` 的含义（跳过的坏行、行原样保留、读路径按 miss 自愈）；第 10 项把 `startupMaintenancePending` **单列一条**登记进「变更点清单」（含清标记条件，指向 cr-32），并在「风险与回滚方案 · Part A」补它会因手动「数据清理」而陈旧的已知代价。**SD 表 SD-2 行的处置**从「cr-06 统一判据」补成「**cr-06 实现侧 + cr-22 新增第 9 项 spec 文本侧**」。
- 验收/测试：① 文档 diff 复检——`spec.md:79` 可 grep 到 `failedCount` 与「需人工处理」；`startupMaintenancePending` 在 spec 变更点清单里可 grep 到；SD-2 行处置同时指向 cr-06 与 cr-22 第 9 项。② **无代码用例**。
- 来源：`review-full-2`（cr-34）

### cr-35 [P2] cr-02 补「收尾判据不变量」注释要求 + 零进展用例的标题与断言文案

- 维度：F（注释）+ G（测试）
- 文件：`packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts`（`normalizeTable` 收尾谓词校验处 + `allKnownFailed` 分支注释）；`packages/core/test/infra/blob-binary-normalization.test.ts:651`（既有「零进展护栏」用例的标题与注释）
- 问题：① 收尾校验 `leftover > failedKeys.size` 判据的正确性**依赖一个未被写下的前提**：「收尾校验只在 `rows.length === 0`（整表扫完）后可达」。这条不变量只活在本文档里，**没进代码注释**——将来有人把 `allKnownFailed` 分支改回 `break`、或在预算分支里也加一个提前 `break`，`leftover` 的语义就悄悄变了，坏行会被**永久跳过**（下次启动标记短路、不再重扫），而且**没有任何测试会红**。② 既有那条用例的标题与文案还停在「3 批护栏收手」，但按 cr-24 改完之后它真正的证物已经是**收尾谓词校验**；标题不改，后来者会以为护栏仍以「批数」为判据、并把 `updateCount === 2` 当成写错了。
- 改法：**见 cr-02 改法第 9 步的 r3 小节**——① **不变量与其前提必须写进代码注释**（「收尾校验只在 `rows.length === 0` 后可达；预算耗尽 / `shouldPause` / 零进展护栏都在校验之前 `return`；故谓词里残留的每一行必在本轮被访问过 ⇒ `leftover ⊆ failedKeys`」＋「**禁止在收尾校验之前再引入任何 `break`**」）；② 用例**标题改为**「收尾谓词校验判定残留非坏行 → `stalled:true`、标记未置」，**断言文案同步改**，`updateCount` 断言**由现值 `=== 6` 调整为 `=== 2`**（游标化后每表只发 1 次 UPDATE；依据：现有夹具每表 1 行 + `wrapConnBlobUpdateNoEffect`）但注释改为「本夹具下是收尾谓词校验先收手（护栏凑不满 3 批）」；③ 注明 **`allKnownFailed` 分支在 keyset 化后正常路径不可达**（保留作防御性兜底），避免后来者误以为它仍在承重。
- 验收/测试：**见 cr-02 验收段的 r4 小节**。反向判据（必须真验）：把 `allKnownFailed` 分支改回 `break`——**「坏行满批 + 尾部正常行（100 坏 + 20 好）」用例（即 NF-2 拆分出来的 (b)）应当变红**（`leftover` 变大 / 正常行未被访问导致残留判定失真）；若仍绿，说明第 ③ 步的注释虽然写了、但结构上的不变量其实没被任何用例钉住，须补一条专门钉「整表可达性」的用例。（**r4 修正**：r3 这里写的是「『全表皆坏行』用例应当变红」，但那条用例在 r4 已拆为 (a)(b) 两条——**变红的是 (b)**；(a) 只有坏行、`break` 与不 `break` 行为相同，不构成判据。）
- 来源：`review-full-2`（cr-35）＋ **`review-full-3` 的 **NF-2**（P1，r4 该反向判据改指 (b) 用例）**

### cr-36 [P2] 伪路径与不可执行措辞修正；cr-20 方案改为 (a)(b)(c) 以消掉与 cr-21 ① 的冲突

- 维度：C-orch + K（文档同步）
- 文件：`apps/desktop/renderer/features/settings/SettingsViews.tsx`（`BLOB_BINARY_TABLE_ORDER`）；cr-20 与 cr-22 的改法段；本条自身的验收段措辞
  - **【r4 · NF-3】**`apps/mobile/src/screens/stack/StorageConfigScreen.tsx` 这个**路径本身仍然有效**（r3 的路径更正没错：mobile 的 screens 分目录是 `shared/` / `stack/` / `tabs/`），但它**已不在 cr-20 的「文件」段**（r4 删除，理由见 cr-20）——本条对它只剩「**不要求因统一形状而改动其消费点与测试的形状相关断言**」这一条**反向约束**（验收 ②），不构成改动要求。**它真正要落的改动**在 **cr-21 ①**（三行状态行契约断言）与 **cr-06** 改法第 6 步（第三态文案）。
- 问题：① **伪路径**：`apps/mobile/src/screens/settings/StorageConfigScreen.tsx` 在仓库里**不存在**——mobile 的 screens 分目录为 `shared/` / `stack/` / `tabs/`，该文件实际在 `apps/mobile/src/screens/stack/StorageConfigScreen.tsx`。r2 在 **cr-06 与 cr-20 两处**都写错了，下游按图索骥会扑空。② **不可执行的指令**：r2 的 cr-20 写「两端的类型统一从各自 `ipc-types.ts` 取」——**mobile 根本没有 `ipc-types` 模块**（mobile 不走 IPC，service 直接同进程调用）。③ **方案冲突**：r2 的 cr-20 方案 A 要求「mobile 不再拍平」，必然连带改 `StorageConfigScreen` 消费点与 mobile 测试，而 **cr-21 ① 又要求改同一处**（「value 取自 `blobBinary` 数组」——那是拍平后的数组）；两条互斥要求同时下发会打架。
- 改法：**见 cr-20 条目的 r3 收敛版**——路径改 `screens/stack/`；类型来源口径改为「**desktop 取 `apps/desktop/shared/ipc-types.ts`；mobile 无 IPC 层，由 service 侧自声明 DTO**（维持现有 re-export core 类型即可）」；方案由「A / B 二选一」改为「**按 (a)(b)(c) 执行**」且**不再要求统一包装形状**：(a) mobile 的 `[...blobBinary.tables]` 拍平加一行注释说明「数组直接给列表渲染用」；(b) desktop 的 `BLOB_BINARY_TABLE_ORDER` 改为从 `BLOB_BINARY_TABLE_LABELS` 派生、去掉双份平行常量；(c) 「两端形状差异 + 理由」写进 spec 契约（并入 **cr-22 新增第 11 项**）。**删除**「连带改动 `StorageConfigScreen` 消费点与 mobile 测试」这条要求（不统一形状就不需要动，cr-21 ① 的冲突随之消解）。
- 验收/测试：① `SettingsViews.tsx` 源码断言不含 `const BLOB_BINARY_TABLE_ORDER: readonly BlobBinaryTableIdDto[] = [`（即确为从 LABELS 派生；反向验证：改回独立字面量即变红）；两端 `tsc` 通过。② **【r4 · NF-3 限定措辞】不要求因「统一包装形状」而改动 `StorageConfigScreen` 消费点与 mobile 测试中的形状相关断言**——r3 这句写的是「mobile 消费点与 mobile 测试本轮不要求**任何**改动」，与 **cr-21 ①**（要求在 `apps/mobile/__tests__/storage-config-screen-source.test.ts` 补三行状态行契约断言）**互斥**，两句同时下发会打架。r4 收窄为：**本轮不要求任何「因统一两端包装形状而连带产生」的改动**；而 **cr-21 ① 的三行状态行契约用例仍照做**（它断言的是「三行状态行、顺序在『数据清理』之后、value 取自 `blobBinary` 数组」——**读的是拍平后的数组这一既有形状**，不要求改造该形状）。核对口径：**diff 里若出现 `StorageConfigScreen.tsx` 或其测试的形状改造**（改 prop 形状 / 改断言的比较对象），即说明误按 r2 方案 A 执行了；**只补 cr-21 ① 的状态行契约断言不算违规**。③ spec 侧的 grep 判据（`startupMaintenancePending`、形状理由句）属 cr-22 第 10/11 项，由 cr-34 / cr-36 承接。
- 来源：`review-full-2`（cr-36）＋ **`review-full-3` 的 **NF-3**（P2，r4 收窄验收 ② 的措辞，消除与 cr-21 ① 的互斥）**

---

## Spec deviations

状态：**open**（**仍为 9 项**，全部已映射到 must-fix；**r3 / r4 均未新增 deviation**——cr-34 只是把 SD-2 已登记的「完成态双信号」在 spec 文本侧的处置补全，并把 cr-01 新引入的 `startupMaintenancePending` key 登记进 spec 变更点清单；`review-full-3` 的 NF-1/NF-2/NF-3 均为**本 fix-spec 文档内部的自相矛盾**（验收段之间互斥、期望不可满足），不属「实现 vs spec」的分叉，故不另立 SD 编号）。下游执行 cr-22 / cr-23 / cr-30 / cr-34 后由下轮 review 验证并置 `fixed`。本 fix-spec 不改业务 spec。

| # | deviation（实现 vs spec） | 处置 |
|---|---|---|
| SD-1 | spec「完成后挂一次维护链路（GC → checkpoint → VACUUM）」措辞隐含「每次运行都挂」，实现为「`allDone` 即挂」→ 稳态每次启动都挂 | cr-01 修实现（r2 收敛为单一门条件 + 失败兜底）+ cr-22 ③ 改措辞 |
| SD-2 | spec 完成态判据是「谓词空 → 置标记」，实现的 `getBlobBinaryStatus` 是「标记已置 → `done:true`」；坏行路径下二者分叉（完成态双信号）。**r3 补**：spec `:79` 的状态查询契约还漏了 cr-06 新增的 `failedCount` 字段与 OQ-C 的第三态文案 | **r3：cr-06 实现侧 + cr-22 新增第 9 项 spec 文本侧**（`spec.md:79` 改为返回 `{ done, pendingCount, failedCount }` + 第三态口径；状态查询保持**纯读**、不再补写标记，见 OQ-B） |
| SD-3 | spec「三表各自短路，互不牵连」在执行侧未验证；desktop 端去重键是进程布尔，rebootstrap 后不再重挂（与 mobile 行为分叉） | cr-05 修实现 + cr-10 补测 + cr-22 ④ 升格 |
| SD-4 | app 层失败策略（mobile/desktop warn 收手 vs cli 上抛）只存在于代码注释，spec 无契约表 | cr-22 ① |
| SD-5 | 状态查询返回「已注册适配器子集、未注册表由 UI 占位」的口径未进 spec 契约 | cr-22 ② |
| SD-6 | 测试口径与实际用例有 4 处不符（T-BB7 语料 / T-BB6 组合数 / T-BB5 杀进程方式 / fc 侧 T-BB2 编号） | cr-22 ⑤ |
| SD-7 | 零进展护栏的论证前提（「同一批被反复 SELECT」）在 cr-02 游标化后失效 | cr-02 改法第 7 步（r2：护栏降级为提前止损，最终判定权交收尾谓词校验） |
| SD-8 | T 编号与实际用例文件无映射，cr-07~cr-15 新增用例未登记 | cr-23 |
| **SD-9** | **spec「变更点清单」#6 与本 diff 新增的 RULE 条目（`docs/apm/RULE.md` 的「`schema_migrations` 只登记不搬运」）都把「会话级去重」写成「改 `runDatabaseMaintenance` 本身」；实现实为**新增 `runStartupMaintenanceOnce`**，且手动路径 `runDatabaseMaintenance` **刻意不受该去重约束**（用户手动点「数据清理」必须每次真跑）** | **cr-30 闭合**：cr-22 改法 ⑦（spec #6 改措辞 + RULE 条目改为「在**本轮确有推进且全部表完成时**挂一次会话级去重的维护链路」） |

---

## Open questions / 待拍板

**不阻塞 fix-spec-ready。** 下游执行时按「默认动作」走，用户改口再调整。

| # | 问题 | 默认动作（未拍板时怎么办） |
|---|---|---|
| 1 | 主入口是否撤下 `BLOB_BINARY_KKV_MODULE` / `DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS` 两个常量导出（评审判无主入口消费方，属把内部常量固化为公共 API；此前记为 accepted，现提异议）。**【r2 补全】本 diff 还把 `runStartupMaintenanceOnce` 加到了主入口 `packages/core/src/index.ts`，同样只有测试消费** —— 清单共三项，一并拍板 | **保持现状不动**（撤下会波及 A2 追加适配器时的引用面，且已 accepted）；若用户拍板撤下，按 cr-19 同口径删 `export` 并同步 `test/package-exports/snapshots/main-entry-allowlist.json` 快照（**三项都要删，漏一项快照测试即红**） |
| 2 | 降级到旧版写过 `zlib-b64` 后再升级、而完成标记已置的组合盲区（是否在标记短路面加抽样 COUNT 兜底，代价是牺牲「每次启动零成本」） | **不加兜底**（保 cr-01 的零成本）；写进 spec 风险节备查（由 cr-22 承接一句） |
| 3 | `failedCount` 的产品口径：坏行要不要在 UI 上冒出来。**【r2】本轮已收敛为 OQ-C（默认本轮做最小文案），本条只保留「标记值/状态查询/DTO 注释必做」这一层的口径问题** | **先做 DTO + 状态查询回报 + 注释更正（cr-06 必做部分）**；UI 文案的去留见 OQ-C |
| 4 | CLI 首轮是否改为 fire-and-forget（cr-01 修完稳态归零，但**首次**仍会实打实卡 60s + VACUUM） | **本轮不改**（改执行模型超出 fix-spec 范围），把「首次 CLI 阻塞」写进 spec 已知代价（cr-22 ③） |
| 5 | mobile 导入数据库期间归一循环并发写（mobile 无 busy 设施；是否补最小标志） | **本轮不补**；写进 open risks，由 mobile 导入链路后续迭代处理 |
| 6 | mobile 状态行只在 `useFocusEffect` 采样 vs desktop 2s 轮询——是否算 parity 缺口 | **不算阻塞缺口**（刷新频率差异非语义差异）；记入 spec「实现期补充」备查 |
| 7 | 三端调度骨架近乎逐行重复（守卫/取 runtime/失败策略三端不同）——是否值得抽公共包 | **不抽**（评审判当前不划算，A2/Part B 后再加两个任务时重新评估） |
| 8 | 「—」占位三义合流（未注册表 / 采样失败 / 守卫拒绝）是否再拆一层文案 | **本轮不拆**；三义共用 `—` 是既有占位风格（与 spec 记载一致） |
| 9 | 测试的进程级顺序约束（「VACUUM 容错用例必须是本文件第一条用例」）是否加显式防护 | **加显式防护**（并入 cr-01 的验收要求）：在相关文件加 `before` 钩子断言启动去重标记未置位，把隐式顺序约束变成显式断言。**【r3 补注 · cr-31】该钩子只是文档性防护，不解决可观测性**——可观测性已改由 cr-26 的 `beforeMaintenance` / `afterMaintenance` 回调缝承担（判据 `maintCalls`）。顺序约束本身**保留不动**，理由改为「它消费进程级去重标记、影响后续对维护链路本身的观测」 |
| 10 | 测试导入路径不一致（`db-maintenance.test.ts` 从 `@novel-master/core`（dist）导入 vs 同目录从 `src` 相对导入） | **本轮不动**（牵涉 dist 重建流程，改动风险大于收益）；但 cr-15 的「共享 conn own-property 遮蔽」问题必须修（已列） |
| 11 | `pseudoRandomBody` 注释「不可压缩」口径偏强（LCG 低位周期性），是否改措辞或加压缩比断言 | **改措辞**（弱化「不可压缩」为「高熵、低压缩比」，属 cr-16 同类注释更正，可搭车执行） |
| 12 | cr-07 的改法取舍：清标记后第二遍不再覆盖「标记短路」快路径，是接受（另由 cr-09/cr-10 覆盖）还是拆两条用例 | **拆两条用例**（**r2 已按此默认动作消歧写定 cr-07，r3 只软化第 1 条的措辞**）：一条「清标记 → 谓词幂等」（新，**它的牙齿在这里**）；一条保留「标记短路 → 零 SQL 下发」（原 T-BB4）——**r3 advisory ① 明确：第 1 条只是路径覆盖，不要求它长出判据**，其恒真性由第 2 条承担 |
| **OQ-A** | **【r2 新增 · 对应 cr-25】维护失败兜底走哪条路**：**A** = catch 里写 `startupMaintenancePending` 持久化标记，入口读到就无视 `processedAny` 强制补跑一次；**B** = 接受「VACUUM 失败只 warn、不重试」，不引入新标记 | **默认 A**。理由：加了 `processedAny` 门条件后，失败那轮的 freelist 页**永远没人回收**（后续轮次零推进、不再触发），A 用一个 KKV 标记换掉这条静默泄漏；代价是稳态每次启动多一次 KKV 读（可忽略）。若用户坚持 B，cr-01 改法第 4 步整体删掉，并在函数头注释写明「维护失败不重试，freelist 回收靠用户手动『数据清理』」 |
| **OQ-B** | **【r2 新增 · 对应 cr-28】cr-06 原第 4 步（`getBlobBinaryStatus` 补写标记）走哪条路**：**A** = 删掉，状态查询保持纯读；**B** = 保留，但须补齐三处说明（非纯读 `@remarks` / 会被 2s 轮询采样到 / 与 cr-01 门条件的交互） | **默认 A**。理由：状态查询挂在 desktop 2s 轮询上，写 KKV 等于让纯采样路径持写锁；而它想消灭的「双信号」在任务侧本就不成立。若用户坚持 B，cr-06 改法第 4 步按 B 执行，并把「写入不得上抛」「不置 `processedAny`」两条写进代码注释与 spec |
| **OQ-C** | **【r2 新增 · 对应 cr-06】`failedCount` 的 UI 文案本轮做不做**：**做最小文案**（两端状态行在 `failedCount > 0` 时显示「已完成（N 条需人工处理）」，约 2 行/端）**vs 延后**到下一迭代（只做 DTO + 状态查询 + 注释） | **默认本轮做最小文案**。理由：DTO 已经把 `failedCount` 送到 UI 端了，不渲染等于数据到位而信号丢弃，用户侧仍会以为「全归一完了」——这正是 cr-06 的原始问题。延后方案会留下「后端知道、界面不认」的半截状态 |

---

## 已豁免（用户确认不修）

本轮为空（**36 条 must-fix 全部写入**，无用户豁免项）。

> **r3 advisory（3 条，注记级、不计 must-fix）**——已就地写入对应条目，均不单独占编号：
> 1. **cr-07 第 1 步措辞软化**（T-BB4 保留为**路径覆盖**，其无牙性由第 2 条「清标记后第二遍」承担，不写成「换成有判据的断言」）→ 已写入 cr-07 改法第 1 步。
> 2. **cr-02 第 9 步措辞**（`countPendingRows` 实现里已是独立助手，「抽成同文件小助手」属冗余措辞）→ 已写入 cr-02 改法第 9 步。
> 3. **cr-01 advisory ③**（用户手动「数据清理」成功后 `startupMaintenancePending` 会变陈旧 → 下次冷启动多跑一次全库 VACUUM；默认在手动路径成功后顺带清该标记，备选是在注释写明接受该代价）→ 已写入 cr-01 改法段末的 advisory ③，并登记进 cr-22 新增第 10 项的 spec 风险条目。

---

## 合并后 QA（manual_user）

**不阻塞**。当前状态：**被阻塞于设备侧安装门**（荣耀 EBG-AN00 对 PC 工具来源的安装一律弹华为 coauth 锁屏密码门，`adb install` / `pm install` 都拦；详见 `docs/.iteration-state.yaml` 的 `manual_pending` 字段）。

待设备可装后，按下列清单验收（本清单对应 spec Step 6）：

| # | 验收项 | 判据 |
|---|---|---|
| 1 | 升级安装后两表形态 | `SELECT encoding, TYPEOF(bytes), COUNT(*) FROM vfs_content_blob GROUP BY 1,2` 与 `session_file_cache_blob` 同查 → 应只有 `zlib` + `blob` 一种组合；`byte_len = LENGTH(bytes)` 全行成立 |
| 2 | 库体积 | 安装后首启完成归一并跑完收尾维护 → 库体积应从约 79.0MB 降到约 76–77MB 量级（VFS 2.366MB + file_cache 0.06MB 已省，**VACUUM 归还部分取决于磁盘空闲**，对照备份库 79,020,032 字节记录实测值） |
| 3 | 二次启动零重扫 | 二次冷启动后再次直查：两表无 legacy 行、KKV 标记已置、**库体积不再变化**（证明 cr-01 修完后稳态不再触发全库 VACUUM——这是本轮 P0 的真机判据） |
| 4 | 状态行 | mobile 存储页 / desktop 设置页三行状态显示「已完成」（若 cr-06 的第三态文案未落地，此处不验收文案）；未注册表（`chat_message`）显示 `—` 占位 |
| 5 | 读写回归 | VFS 文件树浏览、预览、写新文件、历史版本回滚正常；file_cache 命中正常 |
| 6 | 坏行可见性（**r2：OQ-C 默认本轮做最小文案，故此项转为必验**） | 构造/保留坏行库，确认两端状态行显示「已完成（N 条需人工处理）」而非裸「已完成」；若用户拍板 OQ-C 延后，本项降级为不验收文案 |

注意事项（沿用 `manual_pending` 已有记录）：本分支不含 `message-content-compression`，装上后**聊天正文会读成空**，验收只覆盖 VFS / file_cache 与存储页状态行；测完须 `run-as cp` 回备份并装回原包。**该收尾动作与发版前置见 K 节第 8、9 条（cr-29）——本段只是提醒，不是完整清单。**

---

## K 节建议（下游执行时闭合）

> 本 skill 不跑 lint/format/测试；以下为下游执行任务（code-dev-loop / 实现任务）收尾时必须做的动作。

1. **测试文件顺序约束的显式化**（并入 cr-01 验收）：`packages/core/test/infra/blob-binary-normalization.test.ts` 的「VACUUM 容错用例必须是本文件第一条用例」是进程级隐式约束，加 `before` 钩子断言启动去重标记未置位；新增用例一律追加到文件尾部。
   - **【r3 补注 · cr-31】这条 `before` 钩子是**文档性 / 防回归**防护，不是可观测性方案**：它只保证「没人把 VACUUM 容错用例挪到后面」，从而保住本文件**第一条**用例必然消费进程级标记这一既有事实；它**不解决**「后续用例观测不到 VACUUM」的问题。**可观测性由 cr-26 的 `beforeMaintenance` / `afterMaintenance` 回调缝承担**（判据是 `maintCalls`，见 cr-01 验收段）。两者职责不同，不要用其中一条替代另一条。
   - 该约束**必须保留**的理由（r3 改写）：「VACUUM 容错用例必须第一条」不是因为「后续要断言 VACUUM 次数」，而是因为**它会消费进程级去重标记、直接影响后续用例对「维护链路是否执行」的观测**。cr-31 改的是**观测手段**，不是这条约束本身。
   - **【r4 新增 · 同一约束的第二个落点】NF-1 新建 `packages/core/test/infra/blob-binary-normalization-maintenance.test.ts`，它有**自己的、独立的第一条约束**：**第一条用例必须是「预置 `startupMaintenancePending` → 跑归一 → `maintCalls === 1` 且 pending 被清」**。理由与本条对称——那个文件是**唯一**能观测到「维护真跑了、标记真被清」的地方（独立进程 ⇒ `startupMaintenanceRan` 未被消费）；一旦别的用例排到它前面消费了标记，这条正向路径就再也观测不到。新文件同样建议加一个 `before` 钩子断言标记未置位，理由与本条相同（文档性防护，不解决可观测性）。
   - **【r4 · 两文件分工速查】**既有文件负责：主循环 / 收尾谓词校验 / 门条件 / 幂等 / 状态查询等**既有覆盖**，判据止于 `maintCalls`（「是否进入维护段」）；新文件负责：**pending 标记的补跑与清除**这一条（判据是「标记状态」）。两者不得互相复制用例。
2. **导出快照同步**：若 open_questions #1 拍板撤下 `BLOB_BINARY_KKV_MODULE` / `DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS` / `runStartupMaintenanceOnce` 三个导出（**r2 补全了第三项**，同样只有测试消费），必须同步 `test/package-exports/snapshots/main-entry-allowlist.json`；未拍板则本轮不动。
3. **CHANGELOG**：本轮修复项（尤其 cr-01 的性能回归修复、cr-02 的正确性修复）应进 `CHANGELOG.md` 的 Unreleased 段（分类按仓库既有口径：错误修复 / 性能）。
4. **RULE.md**：随 cr-22 ⑦ 同步本 diff 新增的纪律条目（「`schema_migrations` 只登记不搬运」里涉及会话级维护链路的表述），措辞按 cr-30 改准（载体是新增 `runStartupMaintenanceOnce`，手动路径刻意不受约束）。RULE 里若另有「形态归一」相关约定且 cr-02 的零进展护栏论证变更影响到它，一并同步措辞。
5. **全量回归**：core 全量（**先重建 dist**，mobile/desktop 测试消费 core dist）＋ desktop main/renderer `tsc` ＋ mobile `tsc -p tsconfig.build.json` 与 jest 定向 ＋ cli `tsc`。
6. **调试残留自查**：本轮 fix 完成后确认无 `console.log` 残留、无注释掉的代码块、无临时测试文件（`.db` / `.out.txt` / 探针脚本）留在工作区。
7. **git 操作**：本轮全程禁止 git 写操作；提交/打 tag 由主代理在用户确认后另行处理。
8. **【r2 新增 · 设备侧 scratch 收尾】**（cr-29 第 1 项，**解除 `manual_pending` 后立即执行**，不要拖到下一个迭代）：
   - 删设备上为本轮验收准备的包：`adb shell rm /data/local/tmp/nm-a1.apk` 与 `adb shell rm /sdcard/Download/nm-a1-debase64.apk`。
   - 按 `docs/.iteration-state.yaml` 的 `manual_pending` 还原库：把 `databases/novel_master_vfs.pre-debase64-test.bak`（79,020,032 字节）`run-as cp` 回原位（还原前 `force-stop`、确认现场无 wal/shm）。
   - 装回 mcdev 包（`.worktree/f-message-content-compression` 内的 `app-debug.apk`；注意该包**依赖 Metro 才能启动**）。
   - **把实际清理结果回写 `docs/.iteration-state.yaml` 的 `manual_pending`**（改为「已还原：库 / mcdev 包 / 设备 scratch 均已清理」并注明残留），不要只在对话里说一句就把该字段清空——下一轮迭代会依赖它做门判断。
9. **【r2 新增 · 发版前置】**（cr-29 第 2 项，写成硬前置而非注意事项）：
   - A1 依赖 `feat/message-content-compression` 合并（spec 头部前置依赖）。**本分支不含该功能，单独装上会让聊天正文读成空**（库中 `content_json=''` 而正文在 `content_blob`）。
   - 因此：**该分支合并前，desktop / mobile 均不得单独发版**；`CHANGELOG.md` 的 Unreleased 条目须与 `feat/message-content-compression` 的条目**一并发布**，不得只发 A1（否则发出去的包在用户设备上会「聊天记录全空」）。
   - 判据：发版前先确认 `feat/message-content-compression` 已进 main；若要发，必须合并后重新出包并跑一次真机冒烟（聊天正文可读 + VFS/file_tree 正常）。
