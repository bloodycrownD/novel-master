

===== cr1-wavea.md must-fix 段 =====
## 2 · Open questions（待拍板 / 需补证）

1. **CI typecheck 转 blocking 的跨平台绿**：规范 `wave-a.md:17` 的「全仓 typecheck exit 0」只在
   **Windows 机位**实测过，而 CI `runs-on: ubuntu-latest`。本轮也没在 Linux 上补跑。
   typecheck 从 `continue-on-error` 摘掉的那一刻，任何 Linux-only 的类型问题会直接红 CI。
   要不要在合入前让 Linux 机位补一次 `npm run typecheck --workspaces --if-present`？（本条无可改代码，纯取证。）
2. **`Lint` 步的收口承诺是否已兑现**：commit `b5724046` 在 ci.yml 里写下
   「lint 逐项清账见 wave-e X1 的 lint 批次」，且注释里承诺处置顺序是
   「先清零 27 个 error，再把上限提到实测值」。到 HEAD `046f4d9c` 为止，
   `Lint` 步**仍然**是 `continue-on-error: true`（`ci.yml:69-71`），
   X1 只加了另一条「Lint (blocking: desktop/core/drivers)」（`ci.yml:77-94`）覆盖非 mobile 包。
   ⇒ 这条注释在 HEAD 上是**过期承诺**。是补 mobile 清账，还是把注释改成「X1 已覆盖 15 个包，mobile 仍未收口」？
3. **「我就是想跑 0 条」的心智冲突**：`npm test -- <不存在的路径>` 现在会 exit 1
   （实测确认，node 自身先报 `Could not find ...`，退出码 1）。规范 `:589` 已判为「可接受」。
   本轮无异议，仅登记 —— 若将来有人抱怨「点错了路径报得像测试挂了」，这里是已知解释。
4. **A5.4 ② 的 YAML 形状检查**：规范 `:963-972` 特意警告「cmd 下多行 `node -e` 会被静默丢弃」。
   commit `b5724046` 只改了 yaml，**没有把那条可跑的三 shell 单行命令固化成任何脚本或注释**。
   要不要把它落成 `scripts/check-ci-gates.mjs`（与 wave-e 的 `check-encoding.mjs` 同族），
   免得下一个改 ci.yml 的人重新踩这个坑？

---


===== cr1-cloudsync.md must-fix 段 =====
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


===== cr1-core1.md must-fix 段 =====
## 2）must-fix

### cr1-core1/A-1 [P1] B1-5 的核心验收用例 T-P3 是不稳定测试，本机实测红过一次

- **维度**：A（需求符合性 —— 验收矩阵不可靠）+ G（测试）
- **文件**：`packages/core/test/workplace/template-pull.test.ts`（`flushDeferredBackfill()` 与用例 `T-P3`）
- **来源节点**：cr1-core1

**问题**

`flushDeferredBackfill()` 用 5 次 `await new Promise(r => setImmediate(r))` 等待 file_cache 的后台回填落库。但 `load-or-fill-file-cache.ts:124` 的 `scheduleBackfill` 是 **`setTimeout(…, 0)`**（JSDoc 自陈：为了避开 `fflate.zlibSync` 的同步 CPU 而推迟到宏任务）。`setImmediate` 走事件循环 check 阶段，0ms timer 未到期时这 5 次 check 可以**在同一轮循环内全部跑完**，回填根本没触发 ⇒ T-P3 的前置断言

```
assert.ok((await kkv.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE)).length > 0,
  "前置条件：首次组装后 file_cache 域应有行（否则本用例无牙齿）")
```

间歇性红。**仓库里已经有确定性闸门没被用**：`load-or-fill-file-cache.ts:104` 的 `settlePendingFileCacheBackfills()`，其 JSDoc 明写「只服务两件事：测试断言『缓存最终被回填』，以及给未来需要确定性的调用方一个落定闸门」。

T-P3 是 B1-5/RT-08 的**核心断言**（spec 验收栏明写「这条是本条的核心断言，没有它 A/B 只是清缓存的表层验证」）。一个会随机红的核心验收用例，等于这条验收在 CI 上不可信。

**本机实测（`cd packages/core && npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test …`）**

| 批次 | 次数 | 结果 |
|---|---|---|
| 6 文件并行（首轮冷跑） | 1 | **# fail 1** —— `not ok 7 - T-P3`（`failureType: 'testCodeFailure'`） |
| 6 文件并行 | 4 | # fail 0 |
| 单文件 `template-pull.test.ts` | 5 | # fail 0 |
| 3 文件并行 | 4 | # fail 0 |

即：**只在多文件并行的重负载下偶发**，冷跑首轮最易中。这与「0ms timer 未到期 / 事件循环被别的文件的同步工作挤住」的机制一致。

**改法**

1. 删掉 `flushDeferredBackfill()`，改 `import { settlePendingFileCacheBackfills } from "@/domain/workplace/logic/load-or-fill-file-cache.js"`，两处调用点（T-P1、T-P3）直接 `await settlePendingFileCacheBackfills();`。该函数 `while` 循环取快照，尾批也能收。
2. 若坚持不引这个 helper，退一步把 5 次 `setImmediate` 换成 `await new Promise(r => setTimeout(r, 0))` × N —— 但这是拿概率换概率，不如直接用闸门。

**验收**：按上表批次重跑 6 文件并行 10 次，`# fail 0`；单文件 `# pass` = 4 既有 + 3 新增 = 7。

---

### cr1-core1/B-1 [P1] RT-01 复用分支在 ephemeral（非落库）run 路径上换了查找源，spec 的等价前提在该路径不成立

- **维度**：B（正确性 —— 资源/数据面契约）+ C-orch（两条取数路径的收敛）
- **文件**：`packages/core/src/service/agent/impl/agent-runner.ts:238`、`:421`、`:621-626`
- **来源节点**：cr1-core1

**问题**

B1-6 的核心论证（spec 修法第 2 条）是：「`:413` 的 `visible`（`session.list()`）与 `:606` 的读**是同一张表、同一个 sessionId、同一个 filter、同一个 `ORDER BY seq` 的全量可见集**」，所以复用零成本、零行为差异。这条论证在 `persistMessages === false` 的路径上**不成立**：

- `agent-runner.ts:238`：`persistMessages ? this.deps.session : new EphemeralOverlayAgentSession(this.deps.session, sessionId)`。
- `EphemeralOverlayAgentSession.list()`（`ephemeral-overlay-agent-session.ts:38-41`）返回 `[...base, ...this.overlay]` —— 含本次 run 在 RAM 里追加的 assistant(tool_use) / tool_result，**从不落 SQLite**。
- `listVisibleSessionMessages`（`assemble-agent-runner-deps.ts:73-76`）是 `input.runtime.messages.listBySession(toolCtx.sessionId, { includeHidden: false })` —— 纯 DB 读，**从来不含 overlay**。
- 压缩块被 `if (persistMessages && this.deps.compactionConditions != null)` 门禁（`:525`）⇒ ephemeral 路径 `stepCompactionEmitted` **恒为 false** ⇒ 复用分支恒生效。

⇒ 改动前：gemini 的 `toolUseLookupMessages` 是纯 DB 集，本 run 追加的 tool_use id 一条都没有 ⇒ `resolveFunctionNameOrNull` 恒 null ⇒ 出站走孤儿纯文本兜底。
⇒ 改动后：查找源变成 `base ++ overlay`，本 run 的 tool_use id **能被解析到** ⇒ `functionResponse` 带上了合法 name。

**方向上是变好不是变坏**，但它是 spec 明确宣称「不存在」的 wire 行为变化，落在 event-triggered agent（`runRunAgentAction` 装配 `EphemeralOverlayAgentSession`，`agent.port.ts:23`）这条链上，而 spec 的测试策略四条用例（RT-1A…RT-1D）全部用 `ChatAgentSession` 夹具，**ephemeral 路径零覆盖**。spec 的风险栏也只讨论了「复用错快照会丢掉本轮 tool_use id」，没覆盖这一面。

**改法**（二选一，须由用户拍板，见 §3 OQ-1）

- **方案甲（保守，推荐）**：复用分支加门禁 `stepCompactionEmitted || !persistMessages ? await this.deps.listVisibleSessionMessages() : visibleBeforePrepare`，把 ephemeral 路径留给旧读法 ⇒ 复用分支的等价性论证在所有路径上重新成立，且不引入未承认的 wire 变化。代价：ephemeral run 保留每 step 一次全列读。
- **方案乙（承认变化）**：保留现状，补一条 ephemeral + gemini 的用例（装配 `EphemeralOverlayAgentSession`、断言第 2 步的 `lookups[1]` 含第 1 轮的 tool_use id 且 `functionResponse.name` 非空），并把「历史附件/工具名解析行为变化」写进 CHANGELOG 的 `Changed` 段。

无论哪个方案，`:615-620` 的那段注释都要改：现在它写死了「两次读是同一张表 / 同 sessionId / 同 filter / 同 ORDER BY 的全量可见集」，这句话在 ephemeral 路径上是错的。

**验收**：方案甲 ⇒ RT-1A 保持绿（落库路径计数仍为 0），新增一条 ephemeral 用例断言注入点计数 ≥ 1；方案乙 ⇒ 新增用例断言 wire 变化方向。

---

### cr1-core1/C-1 [P1] M-03 夹带在 core1 提交里落地，core2 未含 ⇒ 台账/派工归属失配

- **维度**：C-orch（跨提交收敛）+ A（范围蔓延）
- **文件**：`packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts`（+109 行）、`packages/core/test/workplace/load-or-fill-file-cache.test.ts`、`packages/core/test/workplace/assemble-workplace-display.test.ts`
- **来源节点**：cr1-core1

**问题**

`6ffeb5fb` 的 commit message 列了八条，**没有 M-03**；`wave-b-core1.md` 八条 spec 里也没有 M-03。而 `wave-b-core2.md` 里 M-03 写全了七要素（标 P1 / core-misc），其提交 `4829b8d1 --name-only` 的 37 个文件里**不含**上述三处 ⇒ M-03 只由 core1 交付了一次。

实现本身与 core2 spec **逐条对齐**，我核对过三点：① 探测提到 `status` 判断之外但占位分支仍只对非 filename 生效（spec 修法第 1 条）；② `FillResult` 是模块私有类型、没加宽共享的 `FileCachePayload`（spec 修法第 3 条，JSDoc 里还专门写了理由）；③ 降级判据用显式 `degraded` 标记而非正文匹配（spec 验收里点名的那条，测试 `降级判据是显式标记而非正文匹配` 钉住了）。所以这不是实现问题，是**编排记账问题**。

**后果**：`ledger-v2.md` / `status.md` 若按 commit 归属记账，core2 的 M-03 会被标成「未做」而下游重复派工；反过来 core1 的报告会漏掉一条真实落地的 P1。

**附带一条性能事实需要记账**（spec 自己在 core2 风险栏承认了，实现侧注释与用例都到位，这里只做留痕）：`filename` 档从「零 IO」变成「每文件一条 `findContentSize` 长度 SQL」。只在 cache miss 的回填路径上触发，常驻提示词命中后不再发；但 drive 侧文件多时仍是 N 条 SQL。

**改法**（文档动作，由主代理在 spec-fix 阶段执行）

1. 在 `cr-fix-spec.md` 的 Must-fix 段记一条「M-03 已由 `6ffeb5fb` 交付，core2 无需再实现」，并同步 `ledger-v2.md` / `status.md` 的 M-03 归属 commit。
2. 核对其余 core1 文件：`agent-runner.test.ts` 的 9 行改动是 A7b 编码修复（mojibake → 正常中文），归属 `c24e8b27`「编码批次1」的续作，随 core1 落地可接受，同样在账上点一句。

**验收**：`git show 6ffeb5fb --name-only` 的每个文件都能在 `wave-b-core1.md` / `wave-b-core2.md` / 编码批次台账里找到归属，无「无主改动」。

---

### cr1-core1/C-2 [P2] core1 给 sweep 写的 JSDoc 理由在 HEAD 已被 Wave C 的触发器 v2 关闭；换序的真实现代后果是 blob 残留待 gc，且三条 sweep 链从不调 gc

- **维度**：C-orch（core1 ↔ Wave C 的交叉面）+ G（缺对应用例）
- **文件**：`packages/core/src/domain/vfs/logic/vfs-tree-copy.ts:390-395`（JSDoc）；波及 `packages/core/src/service/vfs/impl/vfs-zip-io.service.ts`、`character-card-import.service.ts`、`packages/core/src/service/skills/impl/skills.service.ts`
- **来源节点**：cr1-core1

**问题**

core1 新写的 JSDoc 说：

> 换序后「GC 删掉 revision 触发器连带回收 blob」与「删 entry」之间存在一个「entry 仍指向已回收 blob」的中间窗口——因此这三步**必须留在同一事务内**。

在 `6ffeb5fb` 当时这是对的。但 HEAD 上 `c667be0f`（Wave C 的 CS-06/CS-07）把 DELETE 触发器换成了带守卫的 v2（`bootstrap/vfs/vfs-revision-schema.ts:56-67`）：

```sql
DELETE FROM vfs_content_blob
 WHERE content_hash = OLD.content_hash AND ref_count <= 0
   AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash);
```

⇒ GC 删 revision 时 entry 还在 ⇒ **blob 行不会被回收**，JSDoc 描述的那个「数据丢失窗口」已经被 DDL 关掉了（这是好事）。但换来了 JSDoc 没写的一面：

1. 触发器里的 `UPDATE … ref_count = ref_count - 1` **照跑**（无守卫），只有 DELETE 被挡 ⇒ blob 计数落到 0、行留着。
2. 紧随其后的 `deleteVfsPrefix` 删 entry **没有配套触发器**（`vfs_entry` 上零触发器）⇒ 留下一批 `ref_count = 0` 的 `vfs_content_blob` 行。
3. 收它们只能靠 `runDeferredBlobGc`（`contentStore.gc()` 全库算 entry ∪ revision 引用集）。实测调度点只有 5 处：`project.service.ts:227`、`template-pull.service.ts:37/58`、`message.service.ts:284`、`session.service.ts:201`、`user-vfs-turn.service.ts:135`。
4. 而另外三条 sweep 调用链 —— `vfs-zip-io.service.ts:240/258`、`character-card-import.service.ts:178/196`、`skills.service.ts:450` —— **这三个文件里一次 gc 调用都没有**（findstr 确认）。

**实测校准（重要，别把推断当结论）**：`test/vfs/vfs-gc-trigger.test.ts` 的 `T-G2: sessionTemplatePull 执行后所有 blob 都被某 revision 引用` 本机绿 ⇒ 模板拉取链**不产生**残留（内容寻址共享 + 重拷贝把 blob 又引上了，pull 末尾还调了 `runDeferredBlobGc`）。所以本条只在 zip 导入 / 角色卡导入 / 技能整目录删除三条链上**按推断成立、尚未实测**（这三条链各自被替换/删除的子树若含内容唯一的文件，就会留残）。它们也没有对应的 blob 口径用例。

**改法**（须由用户拍板，见 §3 OQ-2）

- 方案甲（补 gc，最小改动）：给 `vfs-zip-io.service.ts` / `character-card-import.service.ts` / `skills.service.ts` 的删除链在事务提交后各加一次 `runDeferredBlobGc(this.conn)`，对齐另外 5 处的既有约定。
- 方案乙（只改口径）：把 `vfs-tree-copy.ts:390-395` 的 JSDoc 改成描述 HEAD 的真实机理（守卫触发器 ⇒ 行残留待 gc，而非「entry 指向已回收 blob」的窗口），并在那三条链上各补一条「删除后 `vfs_content_blob` 无 `ref_count = 0` 行」的用例 —— 用例红了再补方案甲。

无论哪个方案，「三步必须同事务」这条约束本身**继续有效**（守卫触发器只挡 DELETE、不挡 −1，中间态仍在事务内才不外泄），JSDoc 的结论要留、要改的只是理由。

**验收**：三份测试文件里的新用例绿；`SELECT COUNT(*) FROM vfs_content_blob WHERE ref_count <= 0` 在 zip 导入 / 角色卡导入 / 技能删除之后为 0。

---

### cr1-core1/C-3 [P2] `writeWithRevision` 的「entry 已删但 revision 历史保留」分支不可达（跨提交观察，不属 core1 改动面）

- **维度**：C（死代码）
- **文件**：`packages/core/src/domain/vfs/logic/write-with-revision.ts:62-81`、`:152-163`
- **来源节点**：cr1-core1

**问题**

```ts
if (existing == null) {                                    // :62  ← findByPath 刚判过 null
  …
  const maxRevision = await resolveMaxRevision(entryRepo, revisionRepo, scopeKey, normalized);
  if (maxRevision != null) {                                // ← 恒为 false
    version = maxRevision + 1;
    await entryRepo.insertAtVersion(scopeScope, normalized, content, version);
  } else { … }
```

`resolveMaxRevision`（`:152-163`）第一步就是 `entryRepo.findByPath(scopeKey, path)` —— 与 `:54` 的 `existing` 判据**完全同一个查询**。entry 不存在 ⇒ 它必然返回 null ⇒ `insertAtVersion(…, maxRevision + 1)` 这条路永远走不到，连带 `:75` 的 JSDoc「Boundary: vfs_entry removed but revision history retained (e.g. batch rollback restore)」也在承诺一条走不通的路。真正的版本分配器是 `nextVersionFor`（`:136`，只在 update 路径用）。

**与 core1 的耦合**（值得记一笔，但不是 core1 的锅）：core1 修好 sweep 之后，「entry 删了但同 scope 的 revision 历史还在」这个状态在项目删除链上**不再产生**（`sweepRevisionsUnderScope` 三步同事务清干净），所以这条死分支更不会被踩到。真正的版本语义由 `nextVersionFor` 的 `max(head, MAX(version)) + 1` 保证，与 `ref_count` 口径不冲突 —— `createRevisionRefCountRepairOperation` 仍未注册（台账 §4.3 W10 双源），但那不属本 scope。

**改法**（记账项，不阻塞，可与 wave-c2 的 CS-07 归一纪律合并做）

把 `if (existing == null)` 分支里的 `resolveMaxRevision` 调用与 `insertAtVersion` 分支删掉（直接走 `entryRepo.insert`），或保留分支但把 `resolveMaxRevision` 改成按 scope 前缀扫 `MAX(vfs_revision.version)` 的真查询。前者更简单，后者才兑现那句 Boundary 注释。

**验收**：`write-with-revision` 既有测试全绿 + knip 不报新增死导出。

---


===== cr1-core2.md must-fix 段 =====
## 2）must-fix

### cr1-core2/A-1 [P1] M-04 的 `currentModelId` 软指针过滤（B2）建立在一个**代码里不成立**的前提上：desktop/mobile 删完 provider 后 `resetCurrentModelId` 永不执行

- **维度**：B（正确性 —— 前置拒绝的判据依赖跨模块契约）+ C-orch（注释把未验证契约写成事实）
- **文件**：`packages/core/src/service/provider/impl/provider.service.ts:243-252`（过滤与注释）、`apps/desktop/src/main/ipc/handlers/providers.ts:94-106`、`apps/mobile/src/screens/stack/ProvidersScreen.tsx:75-88`、`apps/cli/src/provider/commands.ts:95-111`
- **来源节点**：cr1-core2

**问题**

`provider.service.ts` 的前置拒绝把 `currentModelId` 从阻断引用里滤掉，注释给出的理由是：

> `currentModelId` 是**软指针**……CLI（`provider/commands.ts` delete 分支）与桌面（`handleProvidersDelete`）都在 `providers.delete` **成功返回之后**按 `saved.providerId === id` 主动 resetCurrentModelId / resetCurrentProviderId。

逐个打开三个调用方核对，**三个里只有一个成立**：

| 调用方 | 取 `saved` 的时机 | `getSavedById` 结果 | `resetCurrentModelId` 是否执行 |
|---|---|---|---|
| CLI `commands.ts:98-110` | `providers.delete` **之前**算 `clearCurrentModel` | 命中 | ✅ 会 |
| desktop `providers.ts:94-106` | `await rt.providers.delete(id)` **之后**才 `getSavedById` | **恒 `null`**（`deleteByProvider` 已 `DELETE FROM llm_saved_model WHERE provider_id=…`） | ❌ 永不 |
| mobile `ProvidersScreen.tsx:75-88` | 同 desktop，`delete` 之后 | **恒 `null`** | ❌ 永不 |

`findById` 的实现（`sqlite-saved-model.repository.ts:50-60`）在 `rows.length === 0` 时返回 `null`，`saved?.providerId === req.providerId` 恒为 `false`。

⇒ **desktop 与 mobile 上，删除「当前模型所属的 provider」之后，`currentModelId` 悬空指向一个已不存在的模型 UUID。**

**后果链**（全部本机核实过调用点）：

1. `session.service.ts:118-124`：`DefaultSessionService.create` 会 `getCurrentModelId()` 并把结果**复制进新建会话的 `agent_config_json`** ⇒ 悬空 id 被固化进 `chat_session`。
2. `agent-run-shared.ts:110-121`：`resolveSavedModelId({agentModelId, sessionModelId})` 在 agent 无 pin 时返回该悬空 id。
3. `model-request.service.ts:173` → `assert-saved-model-uuid.ts:28-36` 抛 `INVALID_SAVED_MODEL_ID: Saved model not found: <uuid>`，UI 零解释。

⇒ M-04 之前就有这个悬空（那时 `delete(provider)` 无守卫、直接删），但 M-04 把「调用方会 reset」写成了守卫放行的**正式依据**，并据此在注释里断言契约成立。这条断言现在是错的，且它正是让守卫在「provider 是当前模型」时放行的唯一理由。

**改法**（三处，缺一不可）

1. `apps/desktop/src/main/ipc/handlers/providers.ts:94` 与 `apps/mobile/src/screens/stack/ProvidersScreen.tsx:75`：把「取 `currentModelId` + 判定归属」整块**移到 `providers.delete` 之前**（照 `apps/cli/src/provider/commands.ts:98-102` 的现成写法：`clearCurrentModel` 在 delete 前算好，delete 成功后再 reset）。这修掉悬空本身。
2. `provider.service.ts:243-252`：注释改写。当前那句「都在成功返回之后按 `saved.providerId === id` 主动 reset」必须换成实际契约（**delete 之前**判定归属、delete 成功之后 reset），并显式记一句「本过滤依赖上述三个调用方的 delete 前置判定顺序，改动任一调用方必须同步复核」——这条依赖是隐式的，值得在代码里点名。
3. 若第 1 步因故不做（产品决定保留「删完再判」），则第 2 步的过滤必须撤掉：`currentModelId` 应当作硬引用参与阻断，否则就是「明知会悬空还放行」。

**验收**

- desktop + mobile 各补一条用例：置 `currentModelId = M`（`M` 属 provider P）→ `providers.delete(P)` → 断言 `state.getCurrentModelId()` 为 `undefined`（不是 `M`）。
- `provider-service.test.ts` 补一条「仅 `currentModelId` 引用时 `delete` 成功」的正向用例，把 B2 过滤本身钉住（当前零覆盖，见 §6.3）。

---

### cr1-core2/C-1 [P1] 打包约束违背：spec 写死「六个 commit、M-04 / M-01 各自独立」，实际是**单 commit 打包十条**

- **维度**：C-orch（跨提交收敛 + 回滚粒度）
- **文件**：`4829b8d1` 整体（39 files, +1088/−119）
- **来源节点**：cr1-core2

**问题**

`wave-b-core2.md` §0.1 与 §12.1 把打包约束写成**硬约束**：

> ① **M-04 与 M-01 各单列为独立 commit**（台账量级均为 M，§0.2）……C3 因此拆成 C3a（其余六条）+ C3b（M-04）+ C3c（M-01）⇒ 本 PR 合计 **六个 commit**（C1 / C2 / C3a / C3b / C3c / C4），不是四个；
> ⚠️ 本条有一个必须避开的陷阱……**C2（M-06）必须先于 C3c（M-01）落地**（§2 依赖栏②：否则 `T-RR-1` 会假绿）。

`4829b8d1` 是**一个** commit，同时含 C1（N-P1-02）、C2（M-06）、C3a（CS-02 / CS-08 / S-D-02 / summarizeToolInput / B）、C3b（M-04）、C3c（M-01）五条的全部内容。

**后果**（spec 自己给出的理由，逐条仍然成立）：

1. **回滚粒度丧失**。M-01 改的是重试循环的**可重试语义**，spec 风险栏自己写明「改错的两个方向都有静默后果：闩锁太松 ⇒ 重复输出 + 重复计费；闩锁太紧 ⇒ 首字后断流的黑洞再也重试不了」。现在要回滚它，必须连同 N-P1-02 的白名单、M-06 的解析层、CS-08 的导出结构一起 revert。
2. **M-06 ⇒ M-01 的单向依赖无法二分定位**。spec 依赖栏②说得很具体：只跑 M-01 的 `T-RR-1` 会在「`data:` 无空格仍被整流丢弃」的实现下**假绿**（`text-delta` 压根没到 `onStream`，`seen.length === 1` 因为只收到一次）。这个依赖现在被同一个 commit 吞掉，`git bisect` 落在中间态时无法区分是 M-06 没修还是 M-01 没修。
3. **M-04 / M-01 都是台账量级 M**，spec §0.2 花了整节论证它们「不是 S 级」，结论是「须独立成 commit 以便单独评审与回滚」。这个结论没有被执行。

**改法**（本节点 readonly，给下游两条路，须选一条）

- **方案甲（推荐，保留历史）**：把 `4829b8d1` 用 `git rebase -i` / `filter-branch` 拆成 spec §12.1 的六个 commit（C1 / C2 / C3a / C3b / C3c），commit message 按 §0.1 表格与 §12.1 硬约束①补「本批含 2 条台账量级 M」。**前置条件**：先闭合 A-1（否则拆出来的 C3b 带一个错误前提），以及 B-1（否则 C3c 里带类型错误的测试）。
- **方案乙（不重写历史，只补记账）**：在 `cr-fix-spec.md` 显式记「Wave B core2 的 C1–C3c 已合为单 commit `4829b8d1`，回滚须按文件路径手工 revert，spec §12.1 的六 commit 形态**未执行**」，并在 `ledger-v2.md` 的 M-04 / M-01 两行标注「合入形态偏离：与 C1/C2/C3a 同 commit」。同时把 §0.1 / §12.1 的「六个 commit」改成「六个逻辑变更单元」。

无论哪条，**必须写进 fix-spec**：现状是 spec 承诺的形态与仓库实际形态不一致，下游按 spec 派工时会按六个 commit 去找。

**验收**：`git log --oneline fe79b781..HEAD` 里 core2 相关 commit 数与 `ledger-v2.md` 记载一致；或 `cr-fix-spec.md` 有上述显式偏离记录。

---

### cr1-core2/B-1 [P2] `model-request-retry.test.ts` 两处类型错误；core 测试代码**无任何类型门禁**兜底

- **维度**：G（测试有效性）+ B（错误面）
- **文件**：`packages/core/test/provider/model-request-retry.test.ts:420`、`:459-462`
- **来源节点**：cr1-core2

**问题**

新增用例里有两处构造不符合类型定义：

1. `:420` `throw new LlmStreamTimeoutError("idle");` —— 构造函数是 `constructor(phase: LlmStreamTimeoutPhase, timeoutMs: number, detail?: string)`（`llm-stream-timeout-error.ts:34`），少传 `timeoutMs` ⇒ TS2554。运行时不崩（`tsx` 只转译不做类型检查），但错误消息退化成 `LLM stream idle for undefinedms after the last chunk`，断言里那条「归因可分辨」正是靠这个错误对象判的。
2. `:459-462` `req.onStream?.({ type: "done" });` —— `LlmStreamEvent` 的 `done` 变体是 `{ type: "done"; result: LlmChatResult }`（`adapter.port.ts:50-51`），缺 `result` ⇒ TS2322/2345。同文件的既有两条用例（`:257` / `:283`）都老老实实传了 `120_000` / `90_000`，本条破了这个同文件惯例。

**为什么 CI 抓不到**：`packages/core/tsconfig.test.json` 继承了 `tsconfig.json` 的 `rootDir: "./src"`，而 `include` 含 `test/**/*` ⇒ 本机实跑 `npx tsc --noEmit -p tsconfig.test.json` 产出 **454 条 TS6059**（每个 test 文件一条「not under rootDir」），配置本身不可用；CI 的 `npm run typecheck --workspaces` 走的是 `tsc --noEmit -p tsconfig.json`，`include` 只有 `src/**/*` ⇒ **测试代码零类型检查**。`.github/` 与 `scripts/` 全仓 grep `tsconfig.test` 零命中，确认没有任何门禁引用它。

**改法**

1. 两处补齐：`:420` → `new LlmStreamTimeoutError("idle", 90_000)`；`:459-462` 的 `done` 事件补一个最小 `result`（或改用 `{ type: "usage", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }` —— 但 `usage` 已在上一行发过，重复发同一类型不增加覆盖面，**建议补 `result`**）。
2. 把 `packages/core/tsconfig.test.json` 的 `rootDir` 覆盖为 `"."`（或删掉继承来的 `rootDir`，让 `noEmit` 生效），使它可被 `tsc -p` 使用；在 CI 的 Typecheck 步后加 `npx tsc --noEmit -p packages/core/tsconfig.test.json`。**这是本条的根因，不修则同类问题会继续流入。**

**验收**：`npx tsc --noEmit -p packages/core/tsconfig.test.json` 退出码 0（当前 454 错）；`model-request-retry.test.ts` 13 → 14 条 `# fail 0`。

---

### cr1-core2/B-2 [P2] CS-08 的 `skipped` 没同步进 IPC DTO，renderer 类型面上这个字段直接消失

- **维度**：A（需求符合性 —— 数据通道未贯通）+ B（契约）
- **文件**：`apps/desktop/shared/ipc-types.ts:530-534`（`VfsBatchExportStageResult`）、`apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:32-36`（`StagedExport`）
- **来源节点**：cr1-core2

**问题**

`stageVfsBatchExport` 的返回类型 `ExportStageResult` 加了 `skipped?`（`vfs-batch.service.ts:239-245`），但：

- `handleVfsBatchExportStage` 的返回类型标注是 `IpcResult<VfsBatchExportStageResult>`（`vfs.ts:386`），而 `ipc-types.ts:530-534` 的 `VfsBatchExportStageResult` **只有 `stagingRoot` + `filePaths`**，没有 `skipped`；
- renderer 的 `StagedExport`（`workspace-batch-dnd.ts:32-36`）同样没有 `skipped`，`:192-196` 落库时也不带。

TS 不报错（`data: staged` 是变量不是字面量，多余属性检查不触发），运行时 `skipped` 会随 IPC 过去，但**两端类型都看不见它** ⇒ 未来接 UI 提示时必须同时改三个文件，而 `ipc-types.ts` 恰好是最容易被漏掉的那个（它在 `shared/` 下、离改动最远）。

**改法**

1. `ipc-types.ts` 的 `VfsBatchExportStageResult` 补 `readonly skipped?: readonly { logicalPath: string; reason: string }[]`（或直接复用 core 的 `BatchExportSkip` 类型，看 desktop 侧 `import type` 惯例）。
2. `workspace-batch-dnd.ts` 的 `StagedExport` 同步补字段。
3. renderer 若本期不消费，至少在 `StagedExport` 上留一行注释指向 spec §12.5 第 3 条（UI 呈现列为债务池），避免后人以为「skipped 已经被消费了」。

**验收**：`npx tsc --noEmit -p apps/desktop/tsconfig.json` 与 `tsconfig.renderer.json` 双绿；`stagedByPath` 落库处能读到 `skipped`。

---

### cr1-core2/C-2 [P2] CS-07 与 CS-06 落在同一个 commit，「须在 CS-06 之后」的顺序约束在该 commit 内不可验证

- **维度**：C-orch（跨波顺序约束）
- **文件**：`packages/core/src/bootstrap/vfs/vfs-revision-schema.ts`、commit `c667be0f`
- **来源节点**：cr1-core2

**问题**

`wave-b-core2.md` §0.3 与 ledger §2.4 都写死 CS-07 **须在 CS-06 之后**（CS-06 在 wave-c2）。实际 `c667be0f`（Wave C 全量）的 commit message 里同时列了 `CS-06/07 触发器 v2+BOOT_VERSION 18` —— 两条落在同一 commit。

这不是「顺序错了」（同一 commit 内 DDL 与写路径改动同时生效，运行时确实满足约束），而是**约束不可二分定位**：一旦 CS-07 的触发器 v2 在生产上报 blob 不回收，无法用 `git bisect` 判断「CS-06 在不在」这个前提是否成立，而 §0.3 的整个存量库生效论证（指纹对齐 + bump `SCHEMA_BOOT_VERSION` 依赖慢路径执行）都建立在「CS-06 已合入」之上。

**改法**：在 `cr-fix-spec.md` 记一笔编排偏离（不重写 Wave C 历史——那是别的节点的 commit），并把 `ledger-v2.md` 里 CS-07 的「须在 CS-06 之后」补注「实际与 CS-06 同 commit `c667be0f` 合入，运行时顺序成立但不可二分定位」。

**验收**：`ledger-v2.md` CS-07 行有该注记。

---

### cr1-core2/C-3 [P2] B 条目的「三处同 commit，缺一不可」被拆到两个 commit；顺序恰好安全但违反硬性要求

- **维度**：C-orch + A（验收矩阵的原子性）
- **文件**：`packages/core/src/config-forms/agent/agent-editor-state.ts`（`4829b8d1`）、`apps/desktop/renderer/features/settings/AgentEditorView.tsx:353-357`（`37df8900`）、`apps/mobile/src/components/agent/agent-editor/useAgentEditorFormState.ts:287-290`（`37df8900`）
- **来源节点**：cr1-core2

**问题**

spec §9 修法把这条的风险写得很重：

> ⚠️ **本条有一个三处联动的陷阱，只改 core 一处会把「改作用域不 dirty」变成「永远 dirty」**……修法（三处同 commit，缺一不可）

实际 core 侧在 `4829b8d1`、两端 apps 侧在 `37df8900`。**顺序恰好是安全的**——`37df8900` 在 `4829b8d1` **之前**（`git log` 序：`37df8900` → `4829b8d1`），于是中间态是「apps 传了 `mode`、core 的 `formSnapshotJson` 还不认这个键 ⇒ 多余键被 `JSON.stringify` 丢弃」，打开智能体不会误报 dirty；等 `4829b8d1` 合入时两端都已就位。

但「恰好安全」不等于「按 spec 执行」：如果 rebase 顺序被调换（core 先于 apps），中间态立刻变成 spec 描述的最坏形态（打开任意智能体即显示「· 未保存」）。这条依赖现在是隐式的。

**改法**：在 `fix-spec.md` §9 的修法栏加一行实现注记「core 侧 `4829b8d1` / apps 侧 `37df8900`，**apps 必须先于 core**；若 rebase 调换顺序须同步把两处基线调用点与 core 改动并入同一 commit」。

**验收**：`wave-b-core2.md` §9 有该注记；或历史被重写为单 commit。

---

### cr1-core2/C-4 [P2] M-06 的「可选加强段」（`unrecognizedLineCount`）未实现，spec 把它列为「本 PR 建议同 commit 做」

- **维度**：A（需求符合性 —— spec 建议项未落地）
- **文件**：`packages/core/src/infra/llm-protocol/logic/sse-parse-errors.ts`（未改）
- **来源节点**：cr1-core2

**问题**

spec §2 修法第 3 条：

> **可选加强（本 PR 建议同 commit 做，但可单独回滚）**：给「非空、既不是 `data:` 也不是 `event:` / 以 `:` 开头的注释行 / 空行」的行计一个**可选**字段 `unrecognizedLineCount?: number`……

`4829b8d1` 没做。§12.5 第 4 条同时写着「judge 若认为该段超出『量级 S』纪律，可整段删掉而不影响主体修法」——所以它**不是缺陷**，但 spec 说了「本 PR 建议同 commit 做」，实际没做，属未记录的偏离。

**改法**（二选一）

- 实现它：加可选字段 + `assertSseParseSucceededOrThrow` 在 `blocks.length === 0` 时纳入判定 + `sse-parse-errors.test.ts` 两条用例（喂 `:keep-alive` + `foo: bar` 抛 `MALFORMED_SSE`；只喂 `:keep-alive` 不抛——误报红线）。**必须是可选字段**（spec 点名 `SseParseDiagnostics` 在测试里被手写成对象字面量，加必填会打红 TS2741）。
- 或在 `cr-fix-spec.md` 记「M-06 可选加强段不做，judge 已裁」，把 §2 修法第 3 条标为「本期不做」。

**验收**：前者 `npm test -w @novel-master/core` 全绿且新两条用例存在；后者 fix-spec 有该裁记。

---


===== cr1-apps.md must-fix 段 =====
## 2 · Spec deviations

1. **`docs/apm/RULE.md` 登记缺失**（spec §3 修法步骤 3 明文要求「必须」）→ 见 P2-4。
2. **renderer 基线绝对锚点失效**（spec §1 验收 5.2 / §2 验收 4 / §8 验收 5 的 411 / 410）→ 见 P2-5。属 spec 自身与 HEAD 不同步，非本 commit 造成，但会让按字面验收的人得到假红。
3. **未发现其它偏离**。逐条对照结论：
   - §1 N-P1-04：草稿 ref 走 `useEffect` 同步（不在渲染期赋值）✅、`saveCompaction` 改成显式三参且**函数体内零 state 读取**✅、依赖清空✅、定时器回调读 ref✅、开关那一路改显式传参✅、上方写了「禁止读 state」的注释✅。四条验收用例（T-CMPD-1…4）实测全绿。
   - §2 §6#5：`setError(result.error.message)` 逐字取 spec 默认案（步骤 1，非步骤 2 的 `?.` 兜底）✅；未改 error 的 state 类型、未加 ErrorBoundary、未改渲染结构 ✅。`T-CSErr-1` 实测绿。
   - §3 AM-1：三处 `forgetSession` 补调位置与 spec 完全一致（单删在 delete 成功后、批删**逐个**补、项目删在 delete 成功后遍历）✅；`createLruMap` 独立于 `createScopeKeyCache`、未造死成员 ✅；上限 500 与 `chat-session-view-cache` 同口径 ✅；`units` / `writethroughs` / `listeners` 未动 ✅；新增 test-only `*Size()` 探针 ✅。项目删除前的 `listByProject` 与 TODO 齐备 ✅。
   - §4 N-P1-03：新模块逐字照 `prompt-editor-callback` 形状（`set` 覆盖写 / `take` 读取并清空）✅；`types.ts` 的 `onSessionVfsSaved` 两行删除✅；`FileEditorScreen` 用 **`useRef` 惰性初始化**（不是渲染期裸调）✅；3 处 session 调用点接线齐（`useChatTabScope` 1 处 + `SubagentSessionScreen` 2 处写 no-op）✅；非 session 的 4 处按 spec「不接线」✅；编译期守卫落在 `src/navigation/param-serializability.ts`（已核实被 `tsconfig.build.json` 的 `include: ["src/**/*"]` 覆盖，`AssertNoFn` 对对象类型恒为 `true` ⇒ 真的会长牙）✅。
   - §7 AM-3：类型改可选 + 屏内回落✅、两处入口接线✅、**没有**顺手改 `RootNavigator` / `header-config` / `prompt-preview.service` ✅。
   - §8 S-D-04：dirty effect 落在**三个早返回之前**（`:444-467`，早返回在 `:469` 起）✅、effect 内自算 `dirty` 而非引用 `:722` 那个✅、add/else-delete/cleanup 三段齐✅。`App.tsx` 收归 `requestClose` 且**打开路径不过守卫** ✅。
   - §9 E：`loadAllSavedModels` 返回 `{models, failedProviderIds}`、失败不吞✅；三分支取代二分支✅；**没有给 `applyDefinition` 加第三个位置参数**（既有静态守卫 `applyDefinition(DEFAULT_SUBAGENT_DEFINITION, null)` 未被打破，实测仍绿）✅；保存保留原值✅；`settings-hint--compact` 提示✅。唯一偏离见 P1-1。

---


===== cr1-c2.md must-fix 段 =====
## ② Must-fix（P0 → P1 → P2）

### P1-1 ★top：ZIP 解析期 `remainingBudget` 把本条 entry 重复计入 ⇒ 合法归档被误杀（实测坐实）

**位置**：`packages/core/src/domain/vfs/logic/vfs-zip-central-dir.ts:256-275` + `:105-111`

```ts
declaredBytes += uncompressedSize;                       // :257  本条已计入
if (declaredBytes > limits.maxUncompressedBytes) throw;  // :258  总量闸（正确）
const data = readLocalEntryData(..., limits.maxUncompressedBytes - declaredBytes);  // :274
  → decompressEntryData(..., remainingBudget)
  if (uncompressedSize > remainingBudget) throw PAYLOAD_TOO_LARGE;  // :106
```

`remainingBudget` 是「**已含本条**的累计值」减上限，而 `:106` 又拿本条声明值去比它 ⇒ 本条被算两遍。
等价的误杀条件是 `前缀累计 S + 2 × 本条 s > 32 MiB`。

**实测（tsx 直跑 `parseVfsZip`，探针已删）**：

| 输入（均远低于 32 MiB 上限） | 结果 |
|---|---|
| 单条 20 MiB，DEFLATE | ✗ `PAYLOAD_TOO_LARGE: entry big.md exceeds remaining size budget (20971520 > 12582912)` |
| 10 条 × 3 MiB = 30 MiB，DEFLATE | ✗ `PAYLOAD_TOO_LARGE: entry c9.md ... (3145728 > 2097152)` |
| 同上 10 条 × 3 MiB，**STORE** | ✓ OK（STORE 分支在 `:96-104` 提前 return，走不到该检查） |
| 10 条 × 1 MiB = 10 MiB，DEFLATE | ✓ OK |

⇒ 同一份内容，压缩与否结论不同；30 MiB 的合法包被判成「超限」，用户看到的是 `PAYLOAD_TOO_LARGE` 导入失败。

**性质**：这是 C2-8 引入的**净负向**——旧形态只在 `validateVfsZipEntries` 按总量判（32 MiB 内一律放行），现在多了一条更严且算错的闸。违反 spec 自己的 R3「闸门用声明值累加（合法 zip 的声明值等于实际值）」，也与 spec 第 2 步的措辞「`maxEntryBytes` 形参（= **剩余**预算）」不符——「剩余」应是本条**之前**的余额。

**修法（二选一，都一行）**：
- 传 `limits.maxUncompressedBytes - (declaredBytes - uncompressedSize)`；或
- 直接删掉 `:105-111` 这段——`:258` 的总量闸已经在 `readLocalEntryData` **之前**判过声明值，该检查在正确实现下是恒不触发的冗余分支（留着只会重复犯错）。

**补测试（当前 `test/vfs/vfs-zip-parse-limits.test.ts` 6 条全过、无一条覆盖合法大体积 ⇒ 牙齿判据①不过）**：
- 单条 20 MiB DEFLATE 必须解析成功；
- 10×3 MiB DEFLATE 必须解析成功（总额 30 MiB < 32 MiB）；
- 两者各配一条 STORE 对照，钉住「压缩方式不影响总量判定」。

---

### P1-2：blob 归零触发器 v2 的 `vfs_entry` 守卫**无索引** ⇒ 每删一条 revision 全表扫 `vfs_entry`

**位置**：`packages/core/src/bootstrap/vfs/vfs-revision-schema.ts:66`（DELETE 触发器）、`:86`（UPDATE 触发器，同款第二处）

```sql
AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash);
```

**索引现状**：
- `vfs_content_blob` 是 `WITHOUT ROWID` + `content_hash TEXT NOT NULL PRIMARY KEY`（`vfs-content-blob-schema.ts:14`）⇒ 既有触发器里的 `WHERE content_hash = …` 走的是**主键定位**；
- `vfs_entry` 只有 `idx_vfs_entry_scope_path (scope_key, path)`（`vfs-schema.ts:28`），**`content_hash` 上无任何索引**（该列 `:18` 定义为可空 TEXT）。

⇒ 每一条 `DELETE FROM vfs_revision` 都会附带一次 `vfs_entry` 全表扫。落点正是热路径：`sweepRevisionsUnderScope`（会话删除 / 回滚 / releaseAndDeleteVfsPrefix 补偿）一次删 N 条 ⇒ N 次全表扫，`O(删条数 × vfs_entry 行数)`。这是一个**以性能为主题的 commit 在热路径上新引入的性能护栏缺口**（维度 G）。

**修法**：补 `CREATE INDEX IF NOT EXISTS idx_vfs_entry_content_hash ON vfs_entry(content_hash) WHERE content_hash IS NOT NULL`（部分索引，稳态只索引真正有 hash 的行）。
⚠️ **交付路径要一并想清楚**：`novel-master-bootstrap.ts:357` 的快路径对 `bootVersion >= 18` 直接 return，把索引放进 `NOVEL_MASTER_SCHEMA_STATEMENTS` 只对**下一次 bump 之后**的库生效——本文件自己的注记（`:120-124`）刚刚踩过这个坑的孪生版。两条干净出路：① 再 bump 一次到 19（同 commit 内一并交付最省事）；② 放进 `bootstrapNovelMaster` 事务外的无条件段（与 `idx_chat_message_pending_blob` 同款手法，`:400-407`），不 bump 版本。

---

### P2-1：17→18 的**第三条**升级路径没闭上——被撤回的 v18 已经把部分库推到 `user_version = 18`

**位置**：`packages/core/src/bootstrap/novel-master-bootstrap.ts:114-118`（自述）与 `:357`（快路径 return）

```
v18（已撤回，未发布）：曾为用量详情弹窗加 chat_message.tool_use_count 列……
该列只在 feature 分支的测试机库上残留（user_version 已升 18、列与回填标记为无害孤儿）
```

`SCHEMA_BOOT_VERSION` 本次从 17 改成 18（`:126`）⇒ 那些**曾经跑过被撤回 v18**、把 `user_version` 写成 18 的库，在新代码下 `18 >= 18` 走**快路径直接 return**，legacy 无守卫触发器永远不会被 `DROP`、v2 永远建不出来。文件里那段注记把这批库判为「无害孤儿」，但那是对**列**的判断，对**触发器**不成立——触发器一旦缺守卫就是 P0 现场（删一条共享 hash 的 revision 就把别的 entry 的 blob 删掉，文件永久不可读）。

已覆盖的两条路径是对的：① 全新库（`T-GC-GUARD-BOOTSTRAP`）；② `user_version = 17` 存量库（`T-GC-UPGRADE-17-18`，`test/vfs/vfs-gc-trigger.test.ts:471`，且它还自证了「前置旧名必须无守卫」，形状很扎实）。缺的是第三条。

**定级说明**：正式库从未有过该形态（v18 未发布），影响面是 feature 分支测试机 + 装过开发版的人 ⇒ P2 而非 P1。
**修法（择一）**：注册一条 `runPendingSchemaMigrations` 迁移（该机制在**快路径里也跑**，见 `:360`），或把版本推到 19 并在注记里写明「19 = 救回被撤回 v18 留下的旧名触发器」。

---

### P2-2：`DROP TRIGGER IF EXISTS x;` 是全仓 canonical DDL 里**唯一**带尾分号的语句

**位置**：`packages/core/src/bootstrap/vfs/vfs-revision-schema.ts:129`、`:132`

全量扫 `packages/core/src/bootstrap/**/*.ts`：其余 40+ 条 DDL（`provider-schema.ts:30/32`、`sksp-schema.ts:21` 等）一律不带尾分号，只有这两条 `.map()` 出来的 DROP 带 `;`。它们会被 `novel-master-bootstrap.ts:366-368` 逐条 `tx.execute`。desktop 侧已被 `vfs-gc-trigger.test.ts` 的 bootstrap 用例跑通，**mobile 侧 op-sqlite 的 `execute` 对尾分号的容忍度没有任何用例覆盖**。去掉分号即可，零风险。

---

### P2-3：段 1（事务外）读到的 head 指针，可能在段 2 之前被并发删掉 ⇒ backfill 抛 `NOT_FOUND: Revision not found`

**位置**：`message-checkpoint.service.ts:126-141`（段 1/段 2 边界）、`backfill-baseline-checkpoints.ts:249-300`（`writeBackfillGap`）

C2-2 选案②（连续前缀复核）闭合的是「**并发插点**导致起点后移、消息永久补不上」这一类缺口，闭合得干净（见 ③ 的肯定项）。但它**没有覆盖另一类间隙**：段 1 在事务外读到 `filePointers`（`listSessionFileHeads` 的 head 版本），段 2 才开始写。若这中间有一次并发**回滚 / release / 会话删除**把那些 revision 行 GC 掉，`insertCheckpoint → incrementRefsForCheckpointFiles` 会对不存在的行抛 `VfsError NOT_FOUND: Revision not found`（这正是 C2-4 病症段引用的同一条），整条段 2 事务回滚、异常上抛到 `run-agent-turn` 的 `backfill-baseline-checkpoints` 阶段。旧形态下这段逻辑整体在一条事务内，与回滚被同一把驱动锁串行化，**结构上不可能发生**。

spec 对 stale-by-one 的论证只说了「版本旧一版合法」，没有论证「指向的 revision 行还在」。窗口很窄（单连接 + 事务外只读段），但它是 C2-2 把读段提出事务后**新暴露**的失败模式。

**需拍板**（不建议主代理自行选）：
- (i) 保持现状，接受这条窄失败面上抛（回滚本身是低频交互，撞上的概率极低，且失败是「响亮失败」不是静默损坏）；
- (ii) 段 2 整段 best-effort（try/catch + `console.warn`，与导入侧段 C 口径一致）——代价是把响亮失败变成静默；
- (iii) 段 2 写入前对每个 pointer 做一次存在性预检（O(指针数) 次读，回到热路径成本）。

倾向 (i) + 在 `writeBackfillGap` 的 JSDoc 里把这条已知失败面写出来（现在只写了 stale-by-one 是「合法」的，容易让后来者以为段 1 读到的指针一定可用）。

---

### P2-4（nit）：`is-storage-failure.ts` 无文件尾换行，且是 `common/` 里唯一向 `infra/` 取依赖的文件

- 末字节是 `}`（125），无 LF。`eslint.config.base.mjs` 未开 `eol-last`，故 lint 绿；但全仓 1951 个 `.ts` 里有 29 个缺尾换行，其中 8 个正是本波新增（`vfs-zip-parse-limits.test.ts`、`backfill-gap-index-join.test.ts`、`backfill-transaction-scope.test.ts`、`vfs-import-shard.test.ts`、`vfs-batch-ingest-revision-alignment.test.ts`、`storage-failure-bypass.test.ts` 等）⇒ 是**波级习惯**而非孤例，建议登记为一条统一清理项，不要只改这一个文件。
- `packages/core/src/common/is-storage-failure.ts:20` 是 `common/` 目录里唯一 `import … from "../infra/…"`，方向是 `common → infra`。功能上没问题（desktop/mobile 都从 `@novel-master/core/common` 取，`instanceof TdbcError` 的类身份同源，见 `apps/desktop/src/main/services/smart-sort-rule-yaml.service.ts:11,43` 与 mobile 同款），但与 `common` 的定位有张力，建议在文件头注记里说明「这是有意破例，因为 TdbcError 未从 public 面导出」。

---


===== cr1-c1.md must-fix 段 =====
## ② Must-fix

> **本域未发现 P0 / P1。** 12 条 spec 条目里 9 条 PASS、2 条 DEVIATION（轻微、均不改变行为）、1 条 PASS-with-口径改写。
> 下列 8 条全部是 P2：没有一条会造成数据损坏、崩溃或静默功能回归，但每一条都该在 Wave C 收口前处理或登记。

### P2-1 ★top：窄投影读口把「逐行 JSON.parse」搬进了写事务，且不走 `mapRows` 分片让步

**位置**：`packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:350-383`（`listReadRefTargetsBySession`）、`packages/core/src/service/chat/impl/message.service.ts:505-527`（`truncateAfter` 空锚分支）

```ts
// sqlite-message.repository.ts:362-381 —— 裸 for 循环，无 mapRows / 无 yieldFn 分片
const targets: MessageReadRefTarget[] = [];
for (const row of rows) {
  try { targets.push({ id: String(row.id), refs: collectReadRefs(readRowContent(row)) }); }
  catch (err) { console.warn(...); targets.push({ id: String(row.id), refs: [] }); }
}
```

```ts
// message.service.ts:505 —— 这次「读 + 逐行 parse」现在整段发生在写事务内
await this.deps.conn.transaction(async (tx) => {
  const targets = await messages.listReadRefTargetsBySession(sessionId);  // :508
```

**机理**：`readRowContent` 内部 `parseMessageContent(String(row.content_json))`（`:130-146`）是本仓最贵的单行操作（assistant 消息正文 8KB 量级）。改之前这一步跑在 `conn.transaction` **之外**；改之后跑在里面。而 better-sqlite3 的 `transaction()` 在整个 async 回调期间持 `AsyncMutex`（非重入 promise 链）⇒ **互斥锁的持有时间从「一次 SELECT」变成「一次 SELECT + N 次 JSON.parse」**。移动端单连接下，用户在 agent run 进行中点「清空重聊」时，同连接上的 SSE flush / backfill 读会被整段 parse 顶住。`deleteSessionTree`（`session.service.ts:231`）与删项目路径（`project.service.ts:182`）本来就在事务内读，所以那两处**无回归**；新增的回归面只在 `truncateAfter`。

**与 spec 的冲突点**：
- spec C1-2 **风险 R3** 写「会持有写锁更久（但省掉了事务外的一次全量读，总持有时间**下降**）」——这个论证只算了 SQL 往返，**漏掉了占主导成本的 N 次 parse**，因此该结论在实现形态下不成立（实现照 spec 修法落地没错，是 spec 的自述失准）。
- spec 分片级 **N-7 第 4 条**写「C1-2 把读移进事务后，行解析仍走 `mapRows`」——实现**没有**走 `mapRows`（`:362` 是裸 `for`）。spec 的 C1-2 修法 2 本身只要求「直接调用本文件既有的 `readRowContent`」，没点名 `mapRows`，所以这是 spec 内部两处口径打架，实现选了其中一处。**这里必须留痕，否则下一轮有人按 N-7 的口径来判会判成 FAIL。**

**修法建议（二选一，倾向 (a)）**：
- (a) 零改动、只改文案：把 C1-2 R3 与 N-7#4 的表述订正为「本读口只省列数（21→4）+ 消除事务外往返，**不省 parse**；parse 随读一起进事务是本条已知的锁持有期代价」，并在 `listReadRefTargetsBySession` 的 JSDoc 里写明「本方法不进 `mapRows`：它在写事务内被调用，分片让步对锁持有期无帮助，只会在事务中间插入 await」。
- (b) 若要在 mobile 上真正缩短交互卡顿：把 `truncateAfter` 的「产出写集合的读」与「写」之间的窗口重新评估（与 cr-c2 的「产出写集合的读必须留在事务内」判据直接冲突，**不建议在本波做**，登记为债务）。

**补测试建议**：本条不需要新断言（性能护栏按 RULE 取数量级、不卡毫秒），但建议在 `truncate-after-readref-targets.test.ts` 的 T-TRUNC-RT1 注释里补一句「本路径不做让步：读在写事务内，`yieldFn` 不可用是有意的」，免得后人按 N-7 补 `mapRows` 反而在事务中间插 await。

---

### P2-2：`listBySessionOffset` 头投影是**本波无 spec 依据**的域内额外改动（改了 domain port 契约）

**位置**：`packages/core/src/domain/chat/repositories/message.port.ts:52-65`、`sqlite-message.repository.ts:419-445`、`packages/core/test/chat/message-visibility.test.ts:132-177`

```ts
// message.port.ts:62-65 —— 返回类型从 ChatMessage[] 变成 ChatMessageHeader[]
listBySessionOffset(sessionId: string, offset: number): Promise<ChatMessageHeader[]>;
```

**事实**：
- `git grep -rln "listBySessionOffset" -- docs` → **零命中**。本迭代 7 个 fix-spec（wave-a ~ wave-e）**没有任何条目**提到这个读口、也没有任何条目提到测试注释里自称的「G1/G2/G3」三档验收。
- 改动本身是正确且有价值的：唯一生产消费方 `backfill-baseline-checkpoints.ts:132-138` 只用 `segment.map(m => m.id)`；21 列 → 6 列、零 parse；`MessageRepository` 全仓只有一个实现类（`sqlite-message.repository.ts:208`），不是 public 导出面（`src/public/**` 与 `src/index.ts` 零引用），所以**没有破坏面**。测试 `message-visibility.test.ts:132` 的 G1（列集恰为 6 键）/ G3（SELECT 不含正文字节列）/ G2（offset 0/1/99/负数语义）都成立，我实跑绿。
- 但它改了**一个 domain port 的方法签名**，落在一个「每条改动都必须在 spec 里有条目」的波次里，且 `test/message-checkpoint/backfill-cursor.test.ts` 的桩（`:76`）也随之改了类型却没被本轮 diff 覆盖到签名层（它本来就是 `mock.fn`，编译期无感）。

**与 spec 的冲突点**：不是与某条 spec 冲突，而是**与本迭代的追溯纪律冲突**（fix-spec 是这波唯一的账本；commit message 里的「CS-11/头投影」也查无出处——CS-11 在 `wave-c1.md` 注记 N-3 里明确是「`session.copy` 事务内全量读 = wave-c2 C2-3」，与头投影无关）。

**修法建议**（不需要改代码，需要改账本）：在 `wave-c1.md` 补一条 **C1-13 · `listBySessionOffset` 头投影**（P2 · core-data，量 S：21 列 → 6 列、backfill 增量段判定只消费 `id`、验收 = G1/G2/G3 三条已落在 `message-visibility.test.ts:132`），并在 `ledger-v2.md` §10 Wave C 的「全量读收窄系列」格里加一格。或反过来把它显式标为「顺手改、无独立条目」并在 PR 描述里点名。**现状是两头不靠**，下一轮做债务清算时它会消失。

**补测试建议**：无需新增（既有三条已覆盖）。若要更稳，可给 `backfill-baseline-checkpoints.ts:132` 加一句 `@remarks` 说明「本读口已窄投影，改回全列会退回 21 列 + 逐条 parse」。

---

### P2-3：`listBySessionTailOfRole` 的**真实 SQL 从未被任何用例执行过**

**位置**：`sqlite-message.repository.ts:325-348`（新读口）、`packages/core/test/tool/subagent-tool-tail-read.test.ts:81-88`（桩）

```ts
// subagent-tool-tail-read.test.ts:81-88 —— 手写 mock 复刻语义，不是真 SQL
listBySessionTailOfRole: async (_sid, options) => {
  counts.listBySessionTailOfRole += 1;
  return childMessages.filter((m) => m.role === options.role)
                      .slice(-Math.max(1, Math.floor(options.limit)));
},
```

`git grep listBySessionTailOfRole` 全仓命中：定义 3 处 + 消费 2 处 + **测试里全是桩**（`subagent-tool-tail-read.test.ts` / `subagent-tool.test.ts` / `subagent-tool-parallel.test.ts` / `subagent-tool-vfs.test.ts`），**零个用例把它打到真 SQLite**。其余三个新读口都有真库覆盖（`listBySessionUpToSeq` ← `message-fork-upper-bound.test.ts:116/187`；`listReadRefTargetsBySession` ← `truncate-after-readref-targets.test.ts` / `delete-session-readref-targets.test.ts`；`listBySessionOffset` ← `message-visibility.test.ts:141`）——**只有它裸奔**。

**我已实测兜底**（探针已删，`tmp/cr1c1/probe-tail-role.ts` → 真 better-sqlite3）：

| 夹具（seq1 user / seq2 assistant(text) / seq3-7 user(tool_result) / seq8-10 assistant(tool_use)） | 结果 |
|---|---|
| `assistant limit 8` | `m2@2, m8-0@8, m8-1@9, m8-2@10` ✔ 升序、limit 只数 assistant |
| `assistant limit 1` | `m8-2@10` ✔ 不是 `m1` |
| `user limit 3` | `m3-2, m3-3, m3-4` ✔ 中间夹层不占配额 |
| 另一会话 | 只返本会话 ✔ session_id 谓词在子查询内 |

⇒ **实现正确**，缺的是回归锁。

**修法建议**：在 `test/chat/message-visibility.test.ts` 里照该文件已有的 `recordingConnection` 形态（`:24-46`）加一条 `listBySessionTailOfRole：role 过滤在 SQL 子查询内、limit 只数该 role、外层升序`，断言 `Object.keys(rows[0])` 含 `content_json`（证明仍是全列）且 `rows` 的 seq 严格升序。成本约 25 行，堵住「子查询 + LIMIT + 外层 ORDER BY」这类最容易在改 SQL 时悄悄改坏的结构。

**与 spec 的冲突点**：spec C1-3 的 I1 口径 (a)（已由 judge-r1 B7 拍板）明确要求观测面打在 `MessageService` 层的桩上，**因此 spec 本身就没要求真 SQL 用例**——这是 spec 的覆盖盲区，不是实现跑偏。故判为 P2 而非 FAIL。

---

### P2-4：C1-7 I4 的连接身份断言**恒真**（比较对象选错，牙齿为零）

**位置**：`packages/core/test/smart-sort-rule/smart-sort-rule-transaction.test.ts:260-275`（T-SRTX7）

```ts
const countingConn: TdbcConnection = { ..., transaction: (fn) => { txCalls += 1; return origTx(fn); } };  // :48-57
const service = new DefaultSmartSortRuleService({ conn: countingConn, createRules, ... });               // :83-87
...
for (const c of newConns) {
  assert.notEqual(c, ctx.conn, "事务内不得经根连接造仓储（AsyncMutex 不可重入）");   // :272
}
```

**机理**：service 的**根连接是 `countingConn`（一个包装对象）**，不是 `ctx.conn`。所以「事务内经根连接造仓储」这一回归会记录到 `countingConn`，而 `countingConn !== ctx.conn` **照样成立** ⇒ 断言恒真。spec C1-7 I4 的原文要求是「与 `transaction` 回调传入的句柄**对象同一性**相等」——实现比 spec 松了一档。

**为什么仍不是 P1**：真发生该回归时，故障形态是**永久挂起**（`AsyncMutex` 不可重入），测试会超时红，不会静默绿；且 T-SRTX6 的原子性断言（注入第 2 次 update 失败后全表 `enabled` 不变）已覆盖「压根没包事务」这一支。⇒ 净覆盖够，只是 I4 这一条本身没牙。

**修法建议**（一行）：在 harness 里记录 `origTx` 回调收到的那个句柄，再断言 `newConns.every(c => c === txSeen)`。最省事的写法是让 `countingConn.transaction` 把 `fn` 包一层、把 `tx` 存进闭包变量：
```ts
transaction: (fn) => { txCalls += 1; return origTx((tx) => { seenTx = tx; return fn(tx); }); },
```
然后 `assert.equal(c, seenTx)`。

**与 spec 的冲突点**：与 I4 原文的「对象同一性相等」有偏差，属实现偏离验收条款（S 阶段 doc-fix 专门把这条从 `sql-counting-connection` 换成连接身份，为的就是让它有牙，结果换了个比较对象又没牙了）。

---

### P2-5：smart-sort 的 `createRules` 工厂**每次调用都新建仓储 + 新建 SQL AST 缓存**，抵消 parser 缓存

**位置**：`packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts:83-85`、`sqlite-smart-sort-rule.repository.ts:45`

```ts
private rules(conn: TdbcConnection = this.deps.conn): SmartSortRuleRepository {
  return this.deps.createRules(conn);        // :84  —— 每次 new 一个仓储
}
// sqlite-smart-sort-rule.repository.ts:45
private readonly parser = new SqlTemplateParser();   // 每个实例一份空 AST 缓存
```

**机理**：改前 `deps.rules` 是**一个**绑根连接的长寿命仓储，parser 的 `astCache`（`infra/sql-template/parser.ts:46`）跨调用复用；改后 `this.rules()` 每次都 new，`listOrdered` / `find` / `insert` / `update` 各自重新词法扫一遍模板。热路径上 `listCompiledRules()` 被 `create-workplace-service.ts:37` 的 `smartRules: () => ...listCompiledRules()` 挂着，mobile 侧 `VfsFileManager.tsx:326` 在**每次目录展开**都调它。

**量级判断**：单条模板约 200 字符，重解析是微秒级，相对一次 SQLite 往返可忽略 ⇒ **不是性能事故**，但它是「一个以性能为主题的 commit 在自己改的路径上丢了既有缓存」，与 Wave C 的方向相反。

**修法建议**：`this.rules()` 对根连接走一个**记忆化的单例**（`private rootRules ??= this.deps.createRules(this.deps.conn)`），事务内仍用 `this.deps.createRules(tx)` 现造。零风险、零行为变化。
**或**：把 `SqlTemplateParser` 提到 `SqliteSmartSortRuleRepository` 之外共享（同 `SqliteMessageRepository` 的做法可参考——它也是每实例一个 parser，但 message repo 是长寿命实例，所以没这个问题）。

---

### P2-6：`isStorageFailure` 的「绕过前缀」三元在 desktop / mobile 各写一份，且新测试没有守住接线

**位置**：`apps/desktop/src/main/services/smart-sort-rule-yaml.service.ts:40-45`、`apps/mobile/src/services/smart-sort-rule-yaml.service.ts:73-78`、`packages/core/test/common/storage-failure-bypass.test.ts:20-23`

```ts
// storage-failure-bypass.test.ts:21-23 —— 测试里**重演**了一遍通道的三元
const surfaced = isStorageFailure(dbFailure) ? dbFailure : normalizeYamlError(dbFailure, "智能排序规则 YAML 无效");
```

**机理**：测试断言的是两个纯函数的行为，**没有断言任何一端 app 真的调了它**。谁把 `apps/mobile/.../smart-sort-rule-yaml.service.ts:74-76` 的 `if (isStorageFailure(error)) throw error;` 删掉，这条测试照样绿。而它守的恰恰是 C1-6 I5 的一半（DB 故障误报成「YAML 无效」）。

**修法建议**（二选一）：
- 把这段 catch 抽成 core 的一个共享纯函数（例如 `normalizeSmartSortImportError(error)`，把 desktop + mobile 两份字面量收敛成一处，顺带解决单一真源），测试直接测它 —— 一次改动同时解决「重复」与「无接线牙」两个问题；
- 或在 `apps/mobile/__tests__/` / `apps/desktop/test/` 各加一条，注入一个 `isStorageFailure → true` 的错误，断言最终 message 不含「YAML 无效」。

**与 spec 的冲突点**：spec C1-6 I5/测试策略把用例落在 `apps/desktop/test/smart-sort-rule-import-error.test.ts`（app 侧），实现落到了 `packages/core/test/common/` 且测的是重演而非接线 —— **落点偏离 + 覆盖降级**。spec 自己也写了「纯函数级，不起 Electron」，所以偏离是半有意的，但「重演而非调用」这一步 spec 没授权。

---

### P2-7：`DefaultMessageService.listBySessionTailOfRole` 的缩进掉到类体第 0 列

**位置**：`packages/core/src/service/chat/impl/message.service.ts:161`

```ts
  listBySessionTail(            // :154  ← 正常 2 空格
    ...
  ): Promise<ChatMessage[]> {
    ...
  }

listBySessionTailOfRole(        // :161  ← 顶格
    sessionId: string,
    options: { role: string; limit: number }
  ): Promise<ChatMessage[]> {
```

`packages/core` **没有** `format:check` script（`package.json` 的 scripts 里只有 lint/build/typecheck/test），eslint 也不管缩进 ⇒ 绿灯通过、无门禁拦截。纯可读性 nit，但在一个 600+ 行的 service 里顶格一个方法会让人第一眼以为它在类外。

**修法建议**：加两个空格。顺带建议 Wave E 的 pre-commit `check-encoding` 钩子旁边加一条 core 的 prettier 门（当前 core 无 format 门是全仓最大的格式盲区）。

---

### P2-8：三处测试的用例名/注释与实际夹具或内容不符（会误导后续维护）

| 位置 | 写的 | 实际 |
|---|---|---|
| `packages/core/test/tool/subagent-tool-tail-read.test.ts:141` | 注释「50 条子会话夹具」 | 循环 20 次 × 2 条 + 1 条 = **41 条** |
| `packages/core/test/session-fs/delete-session-readref-targets.test.ts:209` | 用例名「T-DEL-RT5 **500 条会话下让步点 ≥1**」 | 造 120 条、断言的是**列数收窄**（让步点断言不存在，因为 C1-5 修法 3「可选」未做 ⇒ spec I6「仅当修法 3 做了才立」不适用） |
| `packages/core/test/smart-sort-rule/smart-sort-rule-transaction.test.ts:207` | 注释「重灌 seed 的**第 3 条** insert 抛错」 | `failOn("insert", 3)` 计的是**全局**第 3 次 insert，前面已被 `createRule` 吃掉 1 次 ⇒ 实际是 seed 的**第 2** 条（seed 共 7 条，够用，不影响结果） |

另外 `smart-sort-rule-transaction.test.ts:215` 的 `assert.ok(before.length > 0)` 是恒真断言（`before` 来自 `listRules()`，bootstrap seed 后必然非空），可删。

**修法建议**：改注释/用例名；`T-DEL-RT5` 建议改名成「窄投影查询只取 4 列」，另在 `session.service.ts` 的 JSDoc 里补一句「修法 3（yieldFn 透传）本波未做 ⇒ deleteSessionTree 仍是同步 parse」。

---


===== cr1-ctests.md must-fix 段 =====
## ② Must-fix

### P1-1 · `vfs-zip-parse-limits.test.ts` 零条「合法大体积必须解析成功」的正向用例 ⇒ 真实的合法 ZIP 被误拒，整份文件仍全绿

**位置**：`packages/core/test/vfs/vfs-zip-parse-limits.test.ts:96-196`（全文件 7 条用例，越限侧 4 条 + 越限对照 2 条 + 常量 1 条）

**证据（探针实测，`parseVfsZip` 直调）**：

| 输入（**全部低于 32MiB 上限，合法包**） | 实测结果 |
|---|---|
| 单条 20 MiB DEFLATE（压缩后仅 20 KB） | ❌ `PAYLOAD_TOO_LARGE: ZIP entry big.md exceeds remaining size budget (20971520 > 12582912)` |
| 10 条 × 3 MiB DEFLATE（总声明 30 MiB < 32 MiB） | ❌ `PAYLOAD_TOO_LARGE: ZIP entry c9.md exceeds remaining size budget (3145728 > 2097152)` |
| 10 条 × 3 MiB **STORE**（总声明 30 MiB < 32 MiB） | ✅ `size=10` |

**机理**：这份文件的观测面全部架在「越限 ⇒ 必须抛」这一个方向上，且全部夹具都远大于或远小于闸门（5001 条 / 33MB / 33MB），**没有一条构造「合法但大」的输入**。于是实现只要「在某个体量之上就抛 PAYLOAD_TOO_LARGE」，H1–H4 全绿——上表那个 bug 正是如此：同一个 30 MiB 合法包，STORE 过、DEFLATE 被拒，且错误码与越限场景**完全同一个**。这条测试对「闸门收得太紧」这个方向**零覆盖**，而这恰恰是 CS-09 这类安全闸最常见的事故形态（把合法大文件当炸弹拒掉，用户表现为「导入莫名失败」，且错误信息谎报「体积超限」）。

**与 spec 的冲突点**：wave-c2 §C2-8 H5「正常 zip 不受影响」写的是「`vfs-zip-parse.test.ts` 现有 7 条 + `vfs-zip-io.test.ts` 全部全绿」——这条回归线在夹具全是几字节小文件时是**结构性恒真**，不构成「不影响正常 zip」的牙齿。spec 的 H2 还专门写了「不要断言耗时……断言 `heapUsed` 增量 < 8MB **或**「未分配 33MB Uint8Array」」，但两条都没解决「合法大体积」这个方向。

**与 cr1-c2 的关系**：`raw/cr1-c2.md` P1-1 已从生产侧认定该 bug（`remainingBudget` 把已含本条声明的累计量再当剩余量），并在「补测」一栏直接写明「**当前 `test/vfs/vfs-zip-parse-limits.test.ts` 6 条全绿、无一条覆盖合法大体积**」。本条是该结论的测试侧确认，且我用独立探针复现了它。

**修法建议**（照 cr1-c2 的二选一修法配套）：
1. 在本文件补两条正向用例（照 H1 的写法）：单条 20 MiB DEFLATE ⇒ 解析成功且 `size===1`、内容逐字节相等；10 × 3 MiB DEFLATE ⇒ 解析成功且 `size===10`；两条各配一条 STORE 对照，把「压缩方式不影响总体量判定」钉死。
2. 把错误码断言按**消息**收窄（越限走 `ZIP uncompressed size … exceeds limit`，误拒走 `exceeds remaining size budget`），让两类事故在断言层就分得开。
3. H5 回归线补一句实测口径：这些用例必须在闸门两侧各取一点（8MB / 31MB / 33MB / 5000 / 5001 条），否则「不影响正常 zip」是空话。

---

### P1-2 · `backfill-transaction-scope.test.ts` B2 第一条用例的故障注入**根本没触发**：夹具全在根目录下，`ensureImportDirRules` 对 `/` 直接跳过 ⇒ 三条断言全恒真

**位置**：`packages/core/test/message-checkpoint/backfill-transaction-scope.test.ts:133-179`（用例名「B2: 段 R 故障（createWorkplaceRepo 抛）不阻断导入……」）

**证据（探针实测，同款 hook + 同款夹具，加计数器）**：

| 夹具 | `listDirRules` | `upsertDirRule` | warn | 结果 |
|---|---|---|---|---|
| 用例现用：20 个文件全在根下（`f0000.md`…） | 1 | **0** | 0 | 未抛、未告警、规则表空 |
| 加一个 `sub/x.md` 后 | 1 | **1** | 1 | 抛错被吞 + warn，规则表空 |

**机理**：`ensure-import-dir-rules.ts:63-69` 的 `backfillMissingDirRules` 第一句就是 `if (logicalPath === "/" …) continue`——根自身不补规则行。所以用例注入的「`upsertDirRule` 抛错」**一次都没被调用**：段 R 真的跑了、真的调了 `createWorkplaceRepo`、真的读了 `listDirRules`，但从没走到写入点。这条用例于是退化成「导入成功 + 内容逐条相等 + 规则表为空」，而这三件事在**把整个 `ensureImportDirRules` 调用删掉**的实现下同样成立 ⇒ 牙齿判据①（改坏实现会不会红）不过。

顺带两点，同一处：
- spec B2 明写「日志含 warn」是验收项之一，这条用例**连 `console.warn` 都没接管**；B2 的第二条（backfill 段自身抛错）接管了，所以 warn 口径整体没丢，但段 R 这条路径的「best-effort 有痕迹」无断言。
- mock 的形态是「一调就抛」，即便触发了，也造不出 spec 真正想验的形态：**先补成 N-1 行、最后一行失败 ⇒ 不得留半截脏行**。当前形态下「无脏行」是被 mock 自身的「什么都没写」保证的。

**与 spec 的冲突点**：wave-c2 §C2-2 B2「注入 `createWorkplaceRepo` 抛错（复刻 `T-I5` 手法）**+ 让 backfill 也抛** ⇒ 导入整体成功；日志含 warn；新内容完整可读 + `workplace_dir_rule` 无残留脏行」。实现只做了第一条注入，且注入未生效；warn 未断言。

**修法建议**：
1. 夹具改成**带子目录**（`filesMap(20)` + `sub/x.md`，或直接 `directoryPath: "/chap"`），并在用例里加 `assert.ok(called > 0, "必须真的走到补规则行，否则本条无牙齿")`——计数探针放在 `upsertDirRule` mock 内，一行即可。
2. 接管 `console.warn`，断言含 `ensureImportDirRules`。
3. mock 改成「第一条成功写、第二条抛」，再断言规则表**只有那一条**、没有半截行——这才把 spec 的「无残留脏行」变成有牙断言。
4. `WHERE scope_key = ?` 用的 `session:${sessionId}` 是**对的**（workplace 与 vfs 是两套键空间，见 `ensure-import-dir-rules.ts:87-89`；同文件 `:167` 的 `session:${pid}:${sid}` 才是 vfs 侧）。这一处不用动，但值得加行内注释，否则后来者会「顺手统一」成 vfs 键空间而把断言废掉。

---

### P2-1 · C2-11 的 S4（降级不破坏诊断契约）整条没落：降级路径的 `details.lcsLength` / `fileHintCodepoints` 无任何断言

**位置**：`packages/core/test/vfs/longest-common-substring.test.ts`（新增 119 行只有 S1/S2/S3 三类）；`test/vfs/compute-replace-not-found-error.test.ts` **在本 commit 未被改动**

**机理**：S1/S2/S3 验的是「降级不崩」「结果与旧实现逐字等价」「不再撞 spread 上限」，验的全都是 `longestCommonSubstring` 的返回值。spec R2 明确点出残余风险：「降级阈值定太小 ⇒ 大文件 edit 未命中时**诊断长期为空**，用户体验退化」，而 S4 是钉这条的唯一断言（错误码不变 + `details.lcsLength === 0` + `details.fileHintCodepoints` 非空）。现在没人钉：把降级阈值调到任意大小、把 `fileHint` 算空，LCS 这一整个文件仍然全绿。

**与 spec 的冲突点**：wave-c2 §C2-11 测试策略「S4 落在 `test/vfs/compute-replace-not-found-error.test.ts`（走公开入口，不碰内部实现）」——该文件零改动。

**修法建议**：在 `compute-replace-not-found-error.test.ts` 补一条：1MB 正文 + 1MB `oldString` 走未命中 ⇒ `assert.throws(..., vfsReplaceNotFound)`（错误码字面量）、`details.lcsLength === 0`、`details.fileHintCodepoints.length > 0`。走公开入口即可，不碰内部实现。

---

### P2-2 · H2 的「堆增量 < 8MB」是恒真断言：夹具真身只有 4 字节，闸门挪到解压后也测不出来

**位置**：`packages/core/test/vfs/vfs-zip-parse-limits.test.ts:122-144`

**机理**：H2 的夹具只改中央目录的 `uncompressedSize` 字段（谎报 33MB），**真实正文仍是 4 字节**（`zipSync({ "big.md": new Uint8Array([1,2,3,4]) })`）。于是无论闸门在解压前还是退回到旧形态（解压后 `validateVfsZipEntries` 按声明值求和），两条路径抛的都是 `PAYLOAD_TOO_LARGE`（探针实测错误消息都是 `ZIP uncompressed size 34603008 exceeds limit 33554432`），堆增量都在几十 KB 量级 ⇒ `deltaMb < 8` 恒成立。这颗牙宣称证明的是「**没有真解压**」，但它在任何实现下都成立，信息量为零。

**与 spec 的冲突点**：spec `wave-c2.md:1044-1047` 专门讨论了 H2 的观测面，并给了退化方案「若不稳定，**退化为「`inflateSync` 未被调用」**（给 `fflate` 打一个注入点计数）」。落地时保留了恒真的堆断言、没采用那个退化方案。

**修法建议**（二选一，前者更省事）：① 保留 H2 的错误码断言，**删掉堆增量断言**并在注释里写明「本条只钉『闸门存在且读的是声明值』；『未真解压』由 H1 反证 + P1-1 的合法大体积用例间接覆盖」；② 照 spec 给 `fflate` 打注入点计数，断言 `inflateSync` 调用次数 === 0。

---

### P2-3 · spec 点名要建的两个回归锁文件根本没建：C2-9 的 900 分块（I2/I3/I4）与 C2-10 的 R3/R4/R5

**位置**：`packages/core/test/message-checkpoint/` 全目录（`dir /b` 实测 31 个文件，**无** `checkpoint-in-clause-chunk.test.ts`、**无** `rollback-fingerprint-lock.test.ts`）；`git grep -ln "countCheckpointsForMessages\|listFilePointersForMessages" -- packages/core/test` 只命中 `agent-runner.test.ts` 与 `backfill-cursor.test.ts`（都不是分块差分断言）

**机理**：
- **C2-9** 的主差分断言 I3「1200 个 id ⇒ 至少 2 块；任一块绑定变量总数 ≤ 900」是 CS-10 这条**唯一**的主牙齿（spec 自己把 I1 判为「无牙」并合并进 I3）。缺了它，分块常量被人改成 5000（等于没分块）或 300（过度切块）都测不出来。
- **C2-10** 的 R3/R4/R5（间隙注入下的 plan/事务态一致性）是 CD-01 四步重排的核心风险面，spec 要求「在第 N 次 `listSessionFileHeads` 之后做一次副作用」的共用夹具，该文件不存在 ⇒ 三条零覆盖。本 commit 只补了 R1（rewind + 空 targetTree 护栏，且落在 `rollback.test.ts` 而非 spec 指定的 `rollback-empty-target-guard.test.ts`；覆盖等价、只是落点偏）。
- 顺带：**C2-3（`session.copy` 事务内零全量读）** 的 C1/C2/C3 也没有落点——`git log fe79b781..046f4d9c -- packages/core/test/service/chat` 为空，spec 测试策略要求「新增用例进 `test/service/chat/`」+「用 Proxy `conn` 在 `transaction` 回调执行期间打标记」的回归锁不存在。

**与 spec 的冲突点**：三条「新增 xxx.test.ts」/「新增用例进 xxx」的动作项均未落地。

**修法建议**：按 spec 原样补三个文件即可，夹具复用现成的：`test/helpers/sql-counting-connection.ts`（I3 绑变量计数）、`test/helpers/transaction-probe.ts`（C2-3 的事务内读探针，本次已交付且正是这个形态）。

---

### P2-4 · 两处用例名/死代码与 spec 收口不符（文档债，但会误导后来者）

1. **`T-B6c` 用例名与自己的断言自相矛盾**：`packages/core/test/vfs/vfs-batch-io.test.ts:333` 名为「T-B6c: 401 个文件 ⇒ 恰好 3 条分片事务（**段 B0 +** ceil(401/200)=3 片）」，而断言是 `assert.equal(probe.transactionCount, 3)` 且行内注释明写「401 个文件没有显式目录 ⇒ **不跑段 B0**」。名字里的「段 B0 +」与断言相反，正是 spec A-15「用例名里的陈旧措辞会让后来者误判语义」要治的病。
2. **`rollback.test.ts:504` 留了死语句 `void assistant1.id;`**（`assistant1.id` 在上一行 `rollbackToMessage(...)` 里已用过），是改写时的残留。
3. **`T-I5` / `T-Z10` 的用例名只改了一半**（`character-card-import.test.ts:309`、`vfs-zip-io.test.ts:1060`）：现名「补规则行语句真失败时**不影响导入事务**，导入仍成功且文件完整」——分片后已无「共享导入事务」可毒化，spec 要求的收口措辞是「**不影响导入整体成功**」。这两条不是本 commit 改的（早于 `759372c8`），但属同一处文档债的尾巴。

**修法建议**：把 `T-B6c` 改成「401 个文件（无显式目录）⇒ 恰好 3 条文件分片事务，段 B0 不跑」；删掉 `void assistant1.id;`；两条用例名把「导入事务」改成「导入整体成功」。

---


===== cr1-kotlin.md must-fix 段 =====
## ② Must-fix

### P1-1 ★top：`SkspModule` 的线程名日志打在 `executor.execute` **之前** ⇒ logcat 永远拿不到 `nm-sksp`，C1-12 的验收牙齿反向失效

**位置**：`packages/sksp-android/android/src/main/java/com/novelmaster/sksp/SkspModule.kt:105`、`:126`

```kotlin
103  @ReactMethod
104  fun encrypt(ref: String, plain: String, promise: Promise) {
105    debugLog("thread=${Thread.currentThread().name} op=encrypt")   // ← 在 RN 队列线程上求值
106    executor.execute {                                                // ← 工作这才被派发出去
107      try {
...
126    debugLog("thread=${Thread.currentThread().name} op=decrypt")    // ← 同一处问题
127    executor.execute {
```

**机理**：`@ReactMethod` 的方法体在 RN 的 NativeModules 队列线程上**同步执行**，`executor.execute { … }` 只是把工作**提交**出去、立刻返回。字符串插值 `${Thread.currentThread().name}` 在第 105 行就地求值，此刻还在 RN 队列线程上 ⇒ 打出来的**永远是 RN 队列线程名**（`mqt_native_modules` / `mqt_js` 之类），**永远不可能是 `nm-sksp`**。`decrypt` 同理。

**与 spec 的冲突点**（两处，都被打穿）：

- `wave-c1.md:1662`（C1-12 验收 I4）：「① `nm-sksp` 线程名在位；② **RN NativeModules 队列线程上看不到 sksp 的栈帧**（后者才是「不再内联」的牙齿，①单独看只是「起了个线程」）」。
- `wave-c1.md:1676-1679`（测试策略）：「在 `encrypt` / `decrypt` 两个入口各加一行 `BuildConfig.DEBUG` 门控的线程名日志（**形如 `[nm-sksp] thread=<name> op=encrypt|decrypt`**），供本条 I4 与 C1-11 的 I4 **共用同一次 logcat 核对**」。

⇒ I4 ① **必然判红**（`nm-sksp` 永远不出现）；更糟的是它会给出一个**反向假信号**：验证人按 logcat 看到 `thread=mqt_native_modules`，合理推断「sksp 还在内联 ⇒ 修复没生效」，而实际上工作**早已**在 `nm-sksp` 上跑。本仓最近刚在 `wave-e` 修过「零收集守卫同款假绿」（见 `3b4c8d9e` 提交说明），这类「假信号」正是 RULE 反复强调要治的对象；而 I4 ② 才是真正的牙齿，现在也没法用这行日志做交叉印证。

**修法**（一行挪动，两处）：

```kotlin
  @ReactMethod
  fun encrypt(ref: String, plain: String, promise: Promise) {
    executor.execute {
      debugLog("thread=${Thread.currentThread().name} op=encrypt")  // ← 挪进 executor 块首行
      try {
      …
```

入口那一行若想保留作对照（同时打 `callerThread=` 与 `workThread=`）也可以，但**必须**有一行落在 `executor.execute { … }` 块内。

**建议的真机验证步骤**（AGENTS.md 硬规则：Metro 走真实路径、`adb install -r -d`、**永不卸载**）：

1. `cd apps/mobile && npx react-native start`（**真实路径**，禁从 subst 盘起）。
2. `adb -s <serial> reverse tcp:8081 tcp:8081`；gradle 出 debug APK；`adb install -r -d <apk>`。
3. 打开 app → 设置页新增服务商 → 保存 API Key（触发 `encrypt`），随后重新进入设置页（触发 `decrypt`）。
4. `adb logcat -c && adb logcat -s nm-sksp:D`。
5. 判据：日志出现 `thread=nm-sksp op=encrypt|decrypt` ⇒ 修复后成立；**当前实现必现** `thread=mqt_native_modules …` ⇒ 复现本条。
6. 补 I4 ② 的牙齿：`adb shell kill -3 <pid>` 抓 ANR 线程栈，确认 `com.novelmaster.sksp.SkspModule` 的栈帧**不在** RN NativeModules 队列线程上，只在 `nm-sksp` 上。
7. 收尾：`adb install -r -d` 覆盖回正常包，全程禁止 `adb uninstall` / `pm clear`。

---

### P1-2：`finishStream` 的标记消费点被闸门早退挡住 ⇒ 注释声称覆盖的「abort 与正常收尾竞态」实际没覆盖，`userAborted` 永久残留

**位置**：`packages/llm-sse-native/android/src/main/java/com/novelmaster/llmsse/LlmSseModule.kt:465-478`（消费点在 `:475`，早退在 `:467-469`）

```kotlin
465  private fun finishStream(requestId: String, state: StreamState) {
466    synchronized(state) {
467      if (!streams.containsKey(requestId)) {
468        return                                   // ← 闸门已关 ⇒ 直接返回
469      }
470      // 读循环收尾已显式 flush 过一次；这里再兜一层（幂等），…
472      flushPending(state)
473      streams.remove(requestId)
474      // 正常收尾路径也要消费标记（abort 与正常收尾可能竞态同 requestId）。
475      userAborted.remove(requestId)             // ← 到达这里时，标记必已不存在
476      emitDone(requestId)
477    }
478  }
```

对读端 `sseAbort`（`:215-227`）：

```kotlin
218    userAborted[requestId] = true   // 先写标记
219    streams.remove(requestId)       // 再关闸
220    val call = calls.remove(requestId)
222    call?.cancel()
```

**机理（可达，非理论）**：流已把 body 读完（`pumpStream` 正常返回、`call.execute().use` 尚未退出），用户此刻点「停止」→ `sseAbort` 写入标记并 `streams.remove`。此后：

1. `call?.cancel()` 对一个**已经 execute 完成**的 `RealCall` 是 **no-op**，读循环**不会**抛异常；
2. 读循环继续走到 `finishStream`，命中 `:467` 的 `!streams.containsKey` → **`:468 return`** ⇒ `:475` 的消费**永远执行不到**；
3. 没有异常 ⇒ `handleStreamFailure`（唯一的另一处消费点）也不会被调用。

⇒ 标记**无人消费、永久留在 `ConcurrentHashMap` 里**。第 474 行那句注释（「abort 与正常收尾可能竞态同 requestId」）描述的正是这个窗口，而代码位置恰好把它挡在了外面。

**与 spec 的冲突点**：

- `wave-c1.md:1451-1453`：「⚠ **标记必须清理**：`handleStreamFailure` 开头的 `userAborted.remove` 是一次性消费；**正常收尾路径（`finishStream`）也要 `userAborted.remove(requestId)`**」。
- `wave-c1.md:1507`（验收 I4）：「连续 ①正常收尾 ②用户 abort ③callTimeout 三种各一次 → 三次之后 `userAborted` 为空（**用一条 debug 计数日志**核对）」。

⇒ 本条正是 spec 点名要防的那一类残留，且它让 I4 的断言变成**概率性红**（取决于是否卡在收尾窗口）。

**影响评估（不夸大）**：功能上**不致错**——`transport.ts:149` 的 requestId 是 `llm-sse-<6位实例前缀>-<单调计数器>`，`transport.ts:69-72` 的实例前缀每个 JS 模块实例随机 ⇒ requestId 永不复用 ⇒ 残留标记不会误吞后续流的错误。代价是：(a) map 无界增长（每次命中一条 `String→Boolean`，量级很小）；(b) I4 偶发红；(c) 注释与实现不符，会误导后来者以为已闭合。

**同族第二入口（顺带登记）**：`sseAbort` **无条件**写标记。当 abort 打在**已经终结**（正常收尾或已失败）的流上时，`calls.remove` 返回 `null`、`streams.remove` 空操作，而 `finishStream` / `handleStreamFailure` 都已跑完 ⇒ 同样残留。spec `wave-c1.md:1541-1551`（风险 R2）只登记了「消费 vs 写入」错位导致**多发一条 Error** 的那一半，**没有**登记「两端都已跑完 ⇒ 纯泄漏」这一类。

**修法**（对称化消费侧，与 `handleStreamFailure` 的「先消费、后判闸」口径对齐）：

```kotlin
  private fun finishStream(requestId: String, state: StreamState) {
    synchronized(state) {
      // 一次性消费必须早于闸门：abort 已先 streams.remove 时，
      // 若把 remove 放在 containsKey 的 return 之后，标记永远无人回收。
      userAborted.remove(requestId)
      if (!streams.containsKey(requestId)) {
        return
      }
      …
```

（`:474-475` 原地那两行随之删掉，避免同一 key 被消费两次的误导。）

`LlmSseModule.kt:307` 的 `shutdown()` 里已有 `userAborted.clear()`，覆盖「模块整体销毁」；本条补的是**单请求粒度**的兜底。

**建议的真机验证步骤**：

1. 同 P1-1 的装包流程（Metro 真实路径 + `adb install -r -d`，**禁止卸载**）。
2. 发一条消息，等到首字出现后**立刻**点「停止」，重复 **20 次**（尽量卡在流末尾；也可把模型换成短回复，让收尾窗口占比更高）。
3. `adb logcat -c && adb logcat -s nm-llm-sse:D`。
4. 判据：每条 `sse_abort requestId=… userAbortedPending=N` 之后，**下一条** `nm-llm-sse` 日志里的 `userAbortedPending` 应归 **0**；当前实现下命中竞态时会稳定 > 0 且永不回落 ⇒ 复现。
5. 附带核对 C1-11 的 I3：命中竞态的那几次**不应**产生 `LlmSseError`（用户 abort 必须仍静默）——这是 R2 已知残余窗口，抽 10 次以上观察。
6. 追加 I4 的完整三连：① 正常收尾 ② 用户 abort ③ callTimeout 各一次后，`userAbortedPending` 归 0（callTimeout 那次可临时把 `SSE_WHOLE_CALL_TIMEOUT_MS` 改小并对「本地 accept 后不 write 的 TCP 监听端口」发请求，**验收完立即 revert**）。

---

### P2-1：`SkspModule` 用 `catch (e: Exception)`，漏掉 `TokenizerModule` 的 `catch (e: Throwable)` 防御 ⇒ 改成后台线程后，`Error` 逃逸会让 Promise **静默**悬死

**位置**：`packages/sksp-android/…/SkspModule.kt:118-120`、`:138-140`（对照 `packages/tokenizer-driver-rn/…/TokenizerModule.kt:51`）

```kotlin
// SkspModule.kt（现状）
118      } catch (e: Exception) {
119        promise.reject("ENCRYPT_FAILED", e.message, e)
120      }

// TokenizerModule.kt:51（范式）
 51      } catch (e: Throwable) {
 52        // 失败一律 reject：不再折算 heuristic 值，由 JS 桥的 catch→null 分支走兜底路径。
 53        promise.reject("TOKENIZER_COUNT_FAILED", e.message ?: "原生分词计数失败", e)
 54      }
```

**机理（维度 G 的正面回答：范式照抄了，但抄漏了一处防御）**：`executor` 是 `ThreadPoolExecutor`，`runWorker` 会 `catch (Throwable)` 并把它交给默认 `UncaughtExceptionHandler`，然后**换一条 worker 线程继续跑**。⇒ 若任务体抛出的是 `Error`（或任何非 `Exception` 的 `Throwable`）：

- `promise.reject` 不会被调用 ⇒ **`post()` 永不 settle**；
- 异常发生在自建的 `nm-sksp` 线程上 ⇒ **绕过 RN 的 `NativeModuleCallExceptionHandler`** ⇒ 没有 redbox、没有 JS 侧可见信号；
- JS 侧 `android-secret-store.ts:51` / `:69` 的 `await native.encrypt/decrypt(...)` 永久挂起 ⇒ 上层 `resolveProviderApiKey` 一起挂 ⇒ 「发消息」按钮无反应且**无任何报错**。

**与旧行为对比（说明这是本 commit 引入的可见性回归）**：改前同样的 `Error` 是在 **RN NativeModules 队列线程**上冒泡的，RN 会把它交给 `NativeModuleCallExceptionHandler` ⇒ 至少弹一个 redbox。Promise 同样不 settle，但**故障可见**。改成后台线程后，**从「可见红屏」变成「静默挂起」**——而本 commit 的主题恰恰是「消 Promise 悬死」，这条在同一批改动里反向造出了一个新的悬死面。

现实概率不高（`KeyStore` / `Cipher` / `KeyGenerator` 的常规失败都是 `KeyStoreException` / `GeneralSecurityException`，都是 `Exception`；`Error` 更可能来自极端环境，如 `UnsatisfiedLinkError` / `NoClassDefFoundError` / `OutOfMemoryError`），但代价与修法都不成比例。

**与 spec 的关系**：`wave-c1.md:1628-1630`（修法 2）只要求「reject 的 code 与 message 一字不改」，没提 catch 范围——所以严格说**不算违反明文条目**；但 C1-12 的总纲是 `:1613`「**逐字照 `TokenizerModule.kt:30-32` 的形状**」+ `:1596-1606` 把范式的**防御部分**也一并列了出来（`:1651` 特别点名了 reject 的 code/message）。维度 G 问的正是「有没有漏掉 TokenizerModule 里存在的防御」——答案是：**有，就这一处**。

**修法**（两处各一个词，与范式对齐）：

```kotlin
      } catch (e: Throwable) {
        promise.reject("ENCRYPT_FAILED", e.message, e)
      }
```

（`TokenizerModule` 另有 `e.message ?:` 兜底；`SkspModule` 的 `e.message` 可为 null 属 raw `w10-kt-sksp` 已登记的 P3，**不在本条范围**，别顺手改。）

**验证说明**：该路径在真机上难以稳定构造（需要刻意制造 `Error`）。建议按**代码对照**验收（`grep -n "catch" SkspModule.kt` 两处均为 `Throwable`），并把「Kotlin 侧无 JVM 测试基建」这一既有限制（spec `:1521-1526` 已登记）写进验收记录，不假装有 e2e 牙齿。

---

### P2-2：`classifyError` 的两个新参数在两个调用点都是**死参数**，且注释暗示了一个并不存在的「锁内二次读标志」

**位置**：`LlmSseModule.kt:508-517`（注释）、`:544-551`（签名）、`:269-276`（非流式调用点）

```kotlin
508      // 分类与发事件同在 state 锁内：classifyError 要读的 userAborted 判定与
509      // 修法 1 那次消费是同一个标志，两处都不在锁内会留下额外窗口。
510      val (kind, message) = classifyError(
511        t, effectiveReadTimeoutMs, call, userAbortedHit,
514        state.startedAtNanos, state.effectiveCallTimeoutMs,
516      )
```

**机理**：

1. 流式调用点传的 `userAbortedHit` **可证恒为 `false`**——`handleStreamFailure:496` 的 `if (state == null || userAbortedHit) return` 已经把 `true` 的情形全部早退掉了，`:510` 只在 `false` 时可达。⇒ `classifyError:552` 的 `&& !userAbortedHit` 是恒真的死条件。
2. 非流式调用点 `:272-273` 直接传 `call = null`、字面量 `userAbortedHit = false`，`startedAtNanos = 0L`、`effectiveCallTimeoutMs = DEFAULT_CALL_TIMEOUT_MS` **全部未被使用**——`call == null` 使 `:552` 的短路条件永不成立。

⇒ **注释 508-509 描述的「`classifyError` 在锁内读一次 userAborted 标志」这件事在代码里并不存在**（它收到的是 `:494` 早已取出的局部布尔值，不再读 map）。这不是 bug，但它是一句**事实错误的安全论证**：后来者按它推理「标志的读写已同锁闭合」，而实际上 spec `wave-c1.md:1480-1484` 与风险 R2（`:1541-1551`）明确说**残余窗口未消除**、不得宣称闭合。注释口径比 spec 更乐观，是个复发风险。

**修法（二选一，都很轻）**：

- **订正注释**（推荐，保留签名以便将来非流式路径复用）：把 508-509 改成「`classifyError` 与发事件同在 state 锁内；注意 `userAbortedHit` 是 `:494` 在锁外取出的一次性消费结果，**锁内不再读 map** ⇒ R2 的错位窗口未被本锁消除」。
- 或**简化签名**：删掉 `userAbortedHit` 与 `startedAtNanos`/`effectiveCallTimeoutMs` 中的死项，把 callTimeout 判定整体挪到 `handleStreamFailure` 里做，`classifyError` 回到纯异常类型分类。

---

### P2-3：导入顺序被打乱 + `SkspModule.kt` 的**末尾换行被本 commit 删掉**

**位置**：`LlmSseModule.kt:20-21`；`SkspModule.kt` 文件末尾（`\ No newline at end of file`）

```kotlin
// LlmSseModule.kt:17-21 —— 新增的 android.* 插在 okio.* 之后
17  import okio.BufferedSource
20  import android.content.pm.ApplicationInfo
21  import android.util.Log
```

字节级实测（本轮用 PowerShell 直读）：

| 文件 | BOM | CRLF | 裸 LF | U+FFFD | 末字节 |
|---|---|---|---|---|---|
| `LlmSseModule.kt` | false | 637 | 0 | 0 | `0x0A`（有末尾换行） |
| `SkspModule.kt` | false | 147 | 0 | 0 | `0x7D` = `}`（**无末尾换行**） |

⇒ 两个文件的编码本身干净（无 BOM、无 U+FFFD、合法 UTF-8，CRLF 与 `LlmSseModule.kt` 改动前一致，diff 未整文件重写）；问题只有两点：① `SkspModule.kt` 的末尾换行是**本 commit 删掉的**（diff 尾部 `\ No newline at end of file`）；② `LlmSseModule.kt` 的 `android.*` 导入没按字典序插在 `com.facebook.*` 之前。

⚠ 门禁现状：`scripts/check-encoding.mjs:42` 的 `SKIP_DIRECTORIES` 含 `"android"`，而这两个文件的路径里都有 `android` 这一段 ⇒ **它们其实不在编码门禁的扫描面内**（`:8-12` 的注释解释了原因：`apps/mobile/android/app/build.gradle` 有 20 处 U+FFFD）。所以这条不会被 pre-commit 拦下，得手工修。

**修法**：① `SkspModule.kt` 末尾补一个换行；② 把 `LlmSseModule.kt:20-21` 两行上移到 `:1-10` 区间（`android.*` 排在 `com.facebook.*` 之前）。

---


===== cr1-dead.md must-fix 段 =====
## ② Must-fix

> **P0 = 0**。逐条 grep 核下来，**没有一条活码被误删**。

### P2-1 ★top：`renderer 基线 411→371` 的归因是错的 —— 这个数字里只有约 1/3 属于 Wave D

**位置**：commit `6594b67c` 提交信息尾段「——renderer 基线 411→371」；佐证文件 `docs/Iterations/repo-mega-cr-2026-10/fix-spec/baseline.md:14/106`（`HEAD = fe79b781`、`411`）

**机理（棘轮失真的证明，探针已删）**：

`baseline.md` 自己写着 411 是在 **`fe79b781`** 上实测的。而本仓的提交顺序是

```
fe79b781 → c667be0f → 759372c8 → d68a848b   （Wave C，3 个 commit）
          → 496b6fd8 → 6594b67c             （Wave D，本节点被审的两个）
          → 3b4c8d9e → 5fb269fe → 046f4d9c  （Wave E）
```

（`git merge-base --is-ancestor fe79b781 c667be0f` 为真 ⇒ **411 是 Wave C 之前的数**，不是 Wave D 的直接前驱数。）

把 `tmp/baseline-04-tsc-renderer.log`（411 条身份）与当前实跑（371 条）按「文件 + 错误码 + 消息」归一后做差集（临时探针，结论如下）：

| 口径 | 值 |
|---|---|
| base（fe79b781）身份数 | 411 |
| 当前（HEAD）身份数 | 371 |
| 含行号列号逐字相同 | 311 |
| 归一后**消失** | **59** |
| 归一后**新增** | **19** |
| 411 − 59 + 19 | **371** ✔ 与实跑自洽 |

消失的 59 条按文件聚合：

| 条数 | 文件 | 归属 |
|---|---|---|
| **12** | `renderer/features/settings/AgentDefinitionEditorForm.tsx` | ✅ **Wave D（D-102 整文件删）** |
| **1** | `test/preview-annotate-source-anchor.test.ts` | ✅ **Wave D（D-202 删 3 个 it）** |
| 32 | `test/token-usage-stats-view.test.tsx` | ❌ Wave C/E（本波未碰此文件） |
| 5 | `test/workspace-push-menu.test.tsx` | ❌ Wave C/E |
| 4 | `test/fetch-models-modal.test.tsx` | ❌ Wave C/E |
| 4 | `test/metrics-detail-popover.test.tsx` | ❌ Wave C/E |
| 1 | `renderer/features/chat/ChatHistorySearchPanel.tsx` | ❌ Wave C（`c667be0f` 改过此文件 3+/1-） |

新增的 19 条同样全部落在 Wave D 没碰过的文件上：`test/cloud-sync-pull-accounting.test.ts` TS2339 ×3（该文件是 `c667be0f` 新增的）、`test/token-usage-stats-view.test.tsx` ×18 之类。

⇒ **净减 40 = Wave D 的 13 + Wave C/E 的 27（含置换）**。也就是说「新增的 40 条减少是死码消失带来的真减少」这个前提**部分不成立**：减少是真的（不是被不当过滤），但**只有 13 条能记在 Wave D 头上**，其余 27 条是 Wave C 的战果。

**为什么这条不能只算文案问题**：棘轮文件 `apps/desktop/typecheck-renderer-baseline.json` 是在 Wave E 的 `3b4c8d9e` 才创建的（`git log --follow` 只有一个 commit），它记的 371 是**当前实跑值**、本身完全忠实（我实测 371，`known` 371 条、`maxErrors` 371，三者相等 ⇒ 无过滤、无静默剔除）。问题在于**归属**：如果日后有人按提交信息把「Wave D 净减 40 条 renderer 错误」记进台账，然后**回退这两个 Wave D commit**，实跑会回到 384 而不是 411 —— 回退后棘轮与代码就对不上了，而且没有任何守卫会报。

**修法建议**（三选一，都不改实现）：
1. 最低成本：把 `ledger-v2.md` §10 Wave D 行与 `wave-d.md` 各条验收③里的「renderer ≤411 / 411→371」改成「Wave D 自身净减 13（AgentDefinitionEditorForm 12 + preview-annotate-source-anchor 1）；411→371 的其余 27 条归 Wave C」；
2. 若要留下可复现证据：把本次的归一差集脚本按 `§4.9 F-synth-dead-1` 的口径固化到 `scripts/`，或至少把两份 tsc 输出留一份在 `tmp/` 之外的可归档位置；
3. **给「删除类 commit 声明 ratchet 数字」立一条通则**：声明时必须写清「本 commit 的直接父提交上的实跑值 → 本 commit 的实跑值」，而不是引用本波开工前的某个历史基线。这条通则对 Wave E 之后的每一波都成立。

---

### P2-2：`formatVfsError` 被本波**变成**零消费，却只删了它的测试、没删它 —— 还留下了一句已经不成立的注释

**位置**：`apps/mobile/src/errors/format-error.ts:83-86`（随本波成为孤儿）、`apps/mobile/src/vfs/errors.ts`（已删）、`apps/mobile/__tests__/errors.test.ts`（已删）

```ts
/** @deprecated Prefer {@link formatError}; kept for VFS call sites. */
export function formatVfsError(error: unknown): string {
  return formatError(error);
}
```

**机理（漏删）**：
- 删前：`formatVfsError` 的唯一引用链是 `apps/mobile/src/vfs/errors.ts`（死再导出 shim）→ `__tests__/errors.test.ts`（5 个 `it`）。
- 删后：`git grep -rn "formatVfsError\b" -- apps packages` 在**全仓只剩定义行本身**（`format-error.ts:84`），零生产消费方、零测试。
- 而 JSDoc 写的理由「kept for VFS call sites」现在**是假的**：mobile 侧所有 VFS 文案走的是 core 的 `formatVfsErrorForUser`（`VfsFileManager.tsx:48/794`），`formatError` 才是实际在用的那个（7 个消费者）。

这直接撞上本波自己的验收口径：`wave-d.md` §3 D-202 明确写了「⚠ **不得**因为负向断言读起来像引用就把它一起删」——本条是它的镜像：**也不该因为「测试读起来像在测它」就把唯一的消费者删掉、却把被测函数留下**。而且被删的那 5 个 `it`（VfsError 中文映射、TdbcError cause 拼接、generic Error、非 Error 值）测的是**一个纯函数的行为**，不是那层 4 行 shim —— 只要把 import 从 `@/vfs/errors` 改指 `@/errors/format-error`，5 条断言一条都不用丢。

**修法建议**：二选一（都在同一个 commit 内闭环）：
- (a) 保留 `formatVfsError`（它在 public 面外、无害），把 `__tests__/errors.test.ts` 按上面的改指**恢复回来**（5 条断言全部有效），并把 JSDoc 的「kept for VFS call sites」改成「暂留兼容，VFS 文案已改走 core 的 `formatVfsErrorForUser`」；
- (b) 既然已经零消费，就把 `formatVfsError` 一并删掉（JSDoc + 函数 4 行），别留一个带假理由的 `@deprecated` 导出给下一个人当「还有 VFS 调用点」的线索。

倾向 (a)：它是纯函数、有可测行为、且已经写好了；顺手保住覆盖比删干净更划算。

---

### P2-3：D-101 的 CHANGELOG 留痕没做 —— 而这条是全波唯一有「不可逆本地损失」的删除

**位置**：`CHANGELOG.md`（`git diff fe79b781 HEAD --stat -- CHANGELOG.md` = 空，本波两 commit 均未碰）；spec 锚点 `wave-d.md:139-141`（D-101 修法「附带动作：在本次发版的 `CHANGELOG.md` 记一笔『删除一次性编码修复脚本』」）

**机理（漏删的第五点）**：

`apps/desktop/scripts/fix-settings-utf8.mjs`（547 行）不是一个普通的死文件。spec 自己查实了它的真实行为是**「破坏先于报错」**：`:54` 先把 `AgentEditorView.tsx` 静默覆写成 `d825173` 版的 **471 行**（当前 1381 行，**净丢 910 行且零报错**），`:63` 才因 `EventsConfigView.tsx` 不存在而 ENOENT 崩。跑过它的人看到 ENOINT 会以为「崩了＝没改动」，实际工作区已经被改过了。

⇒ 对**已经跑过这个脚本的人**，本 commit 是他们唯一的告知渠道；没有 CHANGELOG = 没人知道自己的 `AgentEditorView.tsx` 少了 910 行、也不知道回退路径（`git checkout` + `git show d825173:…`）。这不是「文档洁癖」，这是本波唯一一处**影响用户既有本地数据**的删除。

**修法**：本次发版的 `CHANGELOG.md` 加一条「Removed: `apps/desktop/scripts/fix-settings-utf8.mjs`（一次性编码修复脚本，从未接入任何 npm script / CI）。若你在旧版本上跑过它，`renderer/features/settings/AgentEditorView.tsx` 可能已被覆写成 `d825173` 的 471 行版本，恢复方式：`git checkout apps/desktop/renderer/features/settings/AgentEditorView.tsx`」。放不放 `Unreleased` 由主代理按发版节奏定。

---

### P2-4：`packages/core/docs/public-api.md:76` 留了一条指向已删类型的悬空文档行

**位置**：`packages/core/docs/public-api.md:76`

```
| 遗留 PromptBlock 类型 | 内部 `domain/prompt/model/prompt-block.js` | `@novel-master/core/prompt` |
```

这张表是 §5「Canonical 路径表」，列头是「能力 / Canonical / 已移除」，语义是「同一能力在两处重复导出，必须指向同一实现」。本波把 `PromptBlock` 与 `PromptBlockRole` 从 `prompt-block.js` 摘掉后，该文件只剩 `PromptBlockLifecycle`，而 `PromptBlockLifecycle` **从来没有**从 `@novel-master/core/prompt` 转出过 ⇒ 这一行现在描述的「重复导出关系」**根本不存在**。

本波在别处对同类事情很上心：`agent-prompt-layout.ts:80` 的 `{@link PromptBlock}` 被改写了、`web/composer-input/.../bridge.ts:67` 与 `runtime/model.ts:6` 里提到「log/messagePatch 类死消息」的注释也被改写了 —— 唯独漏了这份 core 自带的架构文档。

**修法**：把 `:76` 整行删掉，或改写为「遗留 `PromptBlockLifecycle` | 内部 `domain/prompt/model/prompt-block.js` | —（未对外转出）」。若 `:74` 的「已删除 export」那类写法是本表既有惯例，按那个体例写即可。

---

### P2-5：`prompt-block.ts` 被改成了**无文件尾换行**（本波新引入，不是继承的）

**位置**：`packages/core/src/domain/prompt/model/prompt-block.ts:8`（末字节是 `;`，无 LF）

diff 末尾的 `\ No newline at end of file` 是本 commit 新加的（改前该文件以 `};\n` 结尾）。`eslint.config.base.mjs` 没开 `eol-last`，所以 lint 绿、core 测试绿、tsc 绿 —— 三道门全都看不见它。但：

- `cr1-c2.md` 的 P2-4 已经把「缺尾换行」登记为**波级习惯**（当时统计全仓 1951 个 `.ts` 里有 29 个缺，其中 8 个是 Wave C 新增）；
- 本波又新增 1 个 ⇒ 这条习惯在往下传染；
- Wave E 的 H1 编码扫描钩子只抓 BOM / FFFD / 非 UTF-8，**抓不到缺尾换行**，所以不会被自动收口。

**修法**：补一个 `\n`。不要逐文件零敲 —— 建议登记为一条统一清理项，与 Wave E 编码扫描钩子一并收口（钩子加一条「末字节非 LF」判定，或开 `eol-last`）。

---

### P2-6（跨域观察 · 修法归 cr-guards）：棘轮文件里 `previousMaxErrors: 360` 查无出处

**位置**：`apps/desktop/typecheck-renderer-baseline.json:4-5`

```json
"maxErrors": 371,
"previousMaxErrors": 360,
```

`writeBaseline()` 的语义是 `previousMaxErrors = 改写前的 maxErrors`，且 `check-renderer-typecheck.mjs` 的 `--update` 会打印 `was <旧值>`。但这个文件是在 `3b4c8d9e`（Wave E）**一次性新增**的（`git log --follow` 只有这一个 commit），不是 `--update` 产物 ⇒ `360` 是手写进去的。我在 `tmp/` 下留存的实现轮/CR 轮 tsc 日志里逐个数过（`renderer-tsc.txt` 371、`d-t3.log` 371、`d-t4.log` 0、`core-tc.log` 0、`desktop-tc.log` 1、`cr-desktop-tsc.log` 0），**没有任何一份记录过 360**。

按该文件自己的 `$comment`（「count/identity numbers are always measured, never copied from spec」），这个字段要么补上出处、要么改成 `null`（`writeBaseline` 在 `previous == null` 时就是写 `null`）。

**定级说明**：本条的**实现**在 Wave E commit 里，属 cr-guards 域；本节点只报「这个字段与本波声明的 411→371 数字属于同一族记账问题」这一事实，不越界判门禁实现质量。

---


===== cr1-guards.md must-fix 段 =====
## ② Must-fix（P0 → P1 → P2）

### P1-1 ★top：`test:collect-guard` 全仓只有 `apps/cli` 一个包暴露 ⇒ H6 的「双 shell 门禁」在 CI 上只覆盖 1/3 个相关包，`packages/core` 与 `apps/desktop` 完全没进门

**位置**：`.github/workflows/ci.yml:128-129` + `apps/cli/package.json:18`（唯一暴露点）

```yaml
      - name: Zero-collect guard
        run: npm run test:collect-guard --workspaces --if-present
```

**实测（探针扫全部 18 个 workspace 的 package.json）**：

```
=== test:collect-guard exposure across ALL workspaces ===
GUARD  @novel-master/cli
  -    @novel-master/desktop
  -    @novel-master/mobile
  -    @novel-master/core
  -    @novel-master/llm-sse-native
  -    @novel-master/sksp-android
  ...（其余 12 个包全部无）
```

实跑复现：`npm run test:collect-guard --workspaces --if-present` 的全部输出**只有一行**
`[collect-check] 扫描面 ...\apps\cli\test（递归 *.test.ts），收集到 20 个文件`。

**机理（这道门禁宣称拦的东西，它没拦）**：H6 的立论是「N-P0-02 的假绿**只在 Windows 出现**
（单引号 + `shell:true` ⇒ Linux 绿 / Windows 静默空跑），所以必须在两种 shell 上各跑一遍」。
spec §H6.2 Step 4 明确要求「**各包**加 `test:collect-guard`」。落地时只给 `apps/cli` 加了：

- `apps/desktop` —— **病灶本体**。它的 `run-tests.mjs:30-33` 正是把单引号改双引号的那处，
  也正是 `shell: true` 唯一的使用方。它**有**内联守卫（`:60-69`），但**没有** `test:collect-guard` 脚本
  ⇒ `--if-present` 直接跳过 ⇒ **windows-latest runner 上 desktop 的收集逻辑一次都没被执行**。
  换句话说：这条门禁在唯一需要它的平台上，没有测它要守的那个包。
- `packages/core` —— `package.json:121` 仍是
  `bash -O extglob -O globstar -c 'tsx ... --test test/**/!(performance).test.ts'`，
  **spec §H6.2 Step 3 要求的「换成仓内 Node 脚本 + 守卫」完全没做**，脚本原样未动。
  它在 Windows 上是「跑不起来」（响亮失败），不是假绿，但 spec 承诺的 core 化没有交付。
- 其余 12 个驱动包全是裸 `tsx --test test/**/*.test.ts`，同样零收集假绿面（node ≥22 收集 0 条退出码为 0）。

**为什么这条是 P1 而不是 P2**：门禁**看起来**完整（独立 job、双 shell matrix、写清了
`runs-on` 是 job 级键的坑），PR review 时很难看出它只跑了一个包。而它没覆盖的两个包
恰好是 desktop（病灶本体，有 `shell:true`）与 core（3126 条用例，spec 自己认定的主战场）。
「Linux 绿 / Windows 静默空跑」这一类 bug 按 spec 的原话「**只能在两种 shell 都跑一遍的门禁里被抓住**」，
而现在这个门禁在 Windows 上只验证了 cli 的 `fs.readdirSync` 递归（一个**不经过 shell**的收集器）。

**修法**（三步，都在 `5fb269fe` 的改动面内）：
1. `apps/desktop/package.json` 加 `"test:collect-guard": "node scripts/collect-check.mjs"`，
   并新建 `apps/desktop/scripts/collect-check.mjs`（照抄 `apps/cli/scripts/collect-check.mjs:17-25`
   的 `collectTestFiles`，扫描面 `test/` 递归 `*.test.{ts,tsx,js}` 三个后缀，对齐 `run-tests.mjs:33` 的三个 glob）。
   ⚠️ 注意 desktop 的收集是 **Node 侧断言 + shell glob 双轨**（`run-tests.mjs` 仍把 glob 交给
   `shell:true` 展开），所以 collect-check 只能证明「文件在」，证明不了「双引号在 Windows 上真能展开」。
   要真验到引号语义，collect-check 应**复刻 `run-tests.mjs` 的 spawn 形态**（起一次极小的子进程，
   例如 `npx tsx --test "test/<某个已知单文件>.test.ts"`，断言 `# tests > 0`），而不是纯 `readdirSync`。
2. `packages/core` 落地 spec §H6.2 Step 3：新建 `packages/core/scripts/run-tests.mjs`
   （`fs` 递归 `test/**/*.test.ts`、排除 `performance.test.ts`、断言非零、`spawnSync` 不经 shell），
   `package.json` 的 `test` / `test:fast` 都改指它；`test:collect-guard` 同样指向一个薄封装。
   ⚠️ spec §H6.7 已预警「收集范围悄悄变了」——上线前必须**逐条 diff 旧 glob 与新收集器的文件列表**并写进 PR。
3. 顺手把 12 个驱动包的 `test` 从裸 `tsx --test test/**/*.test.ts` 收编（可先只加 `test:collect-guard`，
   不改 `test` 本体，成本极低）。

**验证口径**：修完后在 **windows-latest** 上，`npm run test:collect-guard --workspaces --if-present`
的输出里必须**同时出现** desktop 与 core 的扫描面行；且故意把 desktop 的 glob 改回单引号
（或把 core 收集目录指向不存在路径）⇒ **windows-latest 那一格必须红**（这才是 H6 Step 5 的验收）。

---

### P1-2：X2 棘轮的「错误身份集合」把**行号+列号**写进身份 ⇒ 任何无关的行位移都会让门禁假红（实测 78 条幻影）

**位置**：`apps/desktop/scripts/check-renderer-typecheck.mjs:35`（`IDENTITY_RE`）、`:66`（`id` 构造）

```js
const IDENTITY_RE = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s*(.*)$/;
...
const id = `${file.trim()}(${line},${column}): ${code}: ${message.trim()}`;
```

**实测（探针已删）**：在 `renderer/features/settings/SettingsViews.tsx`（该文件有 **79 条**基线错误）
**顶部插一行注释**——语义上「一条错误都没新增、没删除、没修复」——然后跑棘轮：

```
[renderer-ratchet] RED: 78 new error identities (now 371 / baseline 371)
  renderer/features/settings/SettingsViews.tsx
```

**机理**：身份 = `file(line,col) + code + message`。行号一变，同一条错误就换了一个身份 ⇒
`S \ S0` 非空 ⇒ 判红。而 `now 371 / baseline 371` 说明**总数完全没变**，红的原因纯粹是坐标漂移。

这不是假阳性的美观问题，是**门禁信噪比**：在一个 79 条错误的文件上方加一行注释（加个 import、
加条注释、改个空行）就要走一次 `--update` 重写基线。而 `--update` 是**无条件的**：

```js
if (process.argv.includes("--update")) {
  writeBaseline(ids, { previous: baseline.maxErrors });
```

⇒ 一次「插注释 → 78 幻影红 → `--update`」的循环里，`--update` 会把**真实新增的错误一并写进基线**。
spec §X2.8 自己列了这条风险「棘轮 `maxErrors` 被后人顺手调到很大绕过」，但给出的缓解只有
「PR 里说明理由」；行号敏感性把这条风险从「需要恶意」降级成「一次误操作就会发生」。

**正面确认（不要改坏的部分）**：`maxErrors` 天花板的**方向是对的**——`if (ids.size > baseline.maxErrors)`
配合 `--update` 写入的 `maxErrors: ids.size`，使得「只调小 maxErrors、不动 known 数组」必红，
「只把基线做大」则被 `S \ S0` 拦。这两条互补的设计（`:130-136` 的注释已写明意图）成立，
spec §X2.4 ③「把 maxErrors 调到 400 → 期望 exit=1」的验收方向**已被正确实现**（该条 spec 原文
「调到 400」在 371 的终态下应理解为「调到低于实跑值」）。

**修法（二选一，推荐前者）**：
- **(a) 身份去掉坐标，只留 `file + code + message`，另存一份坐标仅用于打印定位。**
  判定用 `file|code|message`（`message` 已含足够区分度，tsc 对同一文件的同一 code 通常消息不同）；
  打印新增项时再从本次实跑结果里取出行列。这样行位移不再产生幻影，而「同一个文件里新增一条
  相同 code 相同 message 的错误」这种极窄形态仍会被 `file+code+message` 抓到。
  ⚠️ 代价：同一文件内两条**完全同文**的错误只能按 `Set` 计一条，`:118` 打印的 `now` 计数会与
  tsc 原始条数有微差。需在 `$comment` 里写明「`now` 是去重后的身份数，不是 tsc 原始条数」。
- **(b) 保留坐标身份，但给 `--update` 加一道「新增条目必须逐条列出理由」的强制交互**
  （非 TTY 时拒绝 `--update`）。这不解决假红，只降低误用。

**补一条自检用例**（当前 0 条）：拿一份固定的两行样例输出喂 `parseIdentities`，
断言「同一文件内插入前置行后，身份集合大小不变」。这条用例就是这条 bug 的牙齿。

---

### P1-3：pre-commit 钩子读的是**工作区**内容而非**暂存区**内容 ⇒ 「先 `git add` 脏版本、再把工作区改干净」可绕过，且提交进仓库的正是脏版本

**位置**：`scripts/check-encoding.mjs:105-112`（`listStagedFiles`）+ `:66`（`readFileSync(file)`）

```js
function listStagedFiles() {
  const listed = tryGit(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACM"]);
  ...
  return listed.split("\0").filter(Boolean).map((rel) => path.join(repoRoot, rel));
}
...
buffer = readFileSync(file);   // ← 读工作区，不是 `git show :<path>` 的暂存区 blob
```

**实测（隔离探针仓，探针已删）**：

```
[probe] staged blob has FFFD : true      ← git show :apps/demo/src/staged.ts 里有 U+FFFD
[probe] worktree  has FFFD   : false     ← 工作区已改干净
[probe] --staged exit code    : 0         ← 钩子放行
[probe] VERDICT                : BYPASS CONFIRMED - hook green but commit carries FFFD
```

**机理**：`--staged` 模式用 `git diff --cached --name-only` 取的是**文件名清单**（这一步是对的），
但随后用 `readFileSync` 读的是**工作区当前内容**。`--diff-filter=ACM` 保证文件在暂存区里是
「新增/已改/复制」状态，却完全不看那个 blob 的字节。于是「暂存脏版本 → 工作区擦干净 → 提交」
这条普通得不能再普通的工作流（编辑器自动保存、`git add -p` 后再格式化、IDE 里改了没暂存……）
会让钩子绿着过，而 commit 里躺着 U+FFFD。

**定级说明**：这是 **P1 而非 P0**，因为存在权威兜底——CI 的 `Encoding` 步（`ci.yml:66-67`，
无 `continue-on-error`）在**提交后的 PR 上**用全量 `git ls-files` 扫，会红。
但它把 spec §H1.8 那条「高概率风险：钩子形同虚设」从「配置没装上」升级成了「**装着也会漏**」，
且漏的方向恰好是最坏的那个（脏内容进了历史）。spec 给的缓解「① CI 步骤是权威门禁」成立，
但钩子本身的实现缺陷没有被指出过。

**修法（一行）**：`--staged` 模式下把 `readFileSync(file)` 换成读暂存区 blob：

```js
// listStagedFiles 改成返回 { rel, content } —— content 来自 `git show :<rel>`（或 `git cat-file blob :<rel>`）
```

注意 `--diff-filter=ACM` 已排除删除态，所以每个 rel 都有 `:path` 可读；`git show :path` 对
含非 UTF-8 字节的 blob 需按 Buffer 读（`execFileSync` 不带 `encoding` 即返回 Buffer，天然正确）。
另外要留意 `git show` 对大文件的性能（`maxBuffer` 已在 `tryGit` 里给了 64 MiB，够用）。

**验证口径**：隔离仓里复跑本次注入序列，`--staged` 必须 exit 1 且点名该文件；
再补一条「暂存干净版 + 工作区改脏 ⇒ 也必须红」（这条现在恰好是对的，因为读工作区会命中脏内容——
修完之后依然要对，两条都绿才算修对）。

---

### P1-4：编码门禁把 `android` **整段**排除 ⇒ `.kt` / `.java` / `.gradle` 三个后缀进了白名单却永远扫不到任何文件

**位置**：`scripts/check-encoding.mjs:41-43`（`SKIP_DIRECTORIES` 含 `"android"`）、`:39`（`SCAN_EXTENSIONS` 含 `.kt`/`.java`/`.gradle`）

```js
const SCAN_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".kt", ".java", ".gradle",
]);
const SKIP_DIRECTORIES = new Set([
  "node_modules", "dist", "webview-dist", "coverage", ".git", "android", "build",
]);
```

**实测（探针已删）**：

```
扫描面统计：in-scan 2695 / excluded 811  { android: 32, docs/Iterations: 779 }
android/ 下若不排除会被扫到的文本文件：5 个
  ⇒ 命中 20 处 U+FFFD + 1 个非 UTF-8，全部集中在 apps/mobile/android/app/build.gradle
```

**机理**：spec §H1.3 Step 1 的原始要求是「**外加 `apps/*/android/**`（至少 `**/build.gradle`）**」，
本意是**只排掉那一个 GBK 混编文件**（RULE:113 已把它单列为 Wave A 的另一条修复线）。
落地时把它实现成了「路径任意分段等于 `android` 就整棵子树跳过」，后果是：

- `apps/mobile/android/app/src/main/java/com/novelmaster/MainActivity.kt` 与 `MainApplication.kt`
  （**真机运行的应用源码**）永久脱离编码门禁；
- `.kt` / `.java` / `.gradle` 三个后缀在 `SCAN_EXTENSIONS` 里**完全是摆设**——
  全仓 `.kt` 文件只存在于 `apps/mobile/android/` 下（`git ls-files "*.kt" | findstr /v android` 为空），
  所以这三个后缀今天扫到 0 个文件，将来也不会扫到任何一个。

也就是说：**「本门禁覆盖 Kotlin/Java」这个印象是假的**。这不是误伤风险（不会假红），
是**静默漏扫**——正是 H1 这条钩子要治的那类病（编码损坏进版本库且无人拦截）的翻版。
未来任何 Kotlin 源码的编码损坏都会畅通无阻。

**修法（收窄到文件级，零风险）**：把 `android` 从 `SKIP_DIRECTORIES` 移除，
改成一个**文件级**排除项（与既有的 `SKIP_PATH_PREFIXES` 同款机制）：

```js
/** 显式排除面：GBK 混编文件，RULE:113 已单列为 Wave A 的另一条修复线（wave-e H1.3 Step 1）。 */
const SKIP_PATH_PREFIXES = ["docs/Iterations/", "apps/mobile/android/app/build.gradle"];
```

⚠️ 落地时**必须立刻实跑一次**确认 android 树下真的只有 `build.gradle` 一个命中
（本次实测正是这个结论：5 个候选文件、命中全在 `build.gradle`），否则会当场恒红。
排除理由要写进文件头注释，与现有 `build.gradle` 那段注记合并。

---

### P1-5：门 C 的计数正则只认「紧贴的调用点」，而 WebView 产物是 **esbuild target es2018 的降级输出** ⇒ 门 A 抓到的源码形态里有整整一类在产物里换形，门 C 数不到

**位置**：`apps/mobile/scripts/build-webview.mjs:145-153`（`WEBVIEW_COMPAT_CONSTRUCTS`）、`:242`（`target: ['es2018']`）

```js
const WEBVIEW_COMPAT_CONSTRUCTS = {
  'Object.fromEntries': /Object\.fromEntries\(/g,
  'String.replaceAll': /\.replaceAll\(/g,
  'Object.hasOwn': /Object\.hasOwn(?!Property)\(/g,
  'structuredClone': /\bstructuredClone\(/g,
  'Array.at': /(?<![\w$])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.at\(/g,
};
```

**实测（探针已删）**：

```
[exp1 count-up]  "var x = Object.fromEntries(a);"   -> detected=[Object.fromEntries:1] regressions=1   ← 正向拦截成立
[exp3] "Object.fromEntries /*c*/ (a)"   -> detected=[]  regressions=0   ← 注释插入即漏
[exp3] "Object\n  .fromEntries(a)"       -> detected=[]  regressions=0   ← 换行即漏
[exp3] "Object['fromEntries'](a)"       -> detected=[]  regressions=0   ← 计算属性即漏
[exp3] "globalThis.Object.fromEntries(a)" -> detected=[Object.fromEntries:1] regressions=1
[exp3] "structuredClone /*x*/(a)"        -> detected=[]  regressions=0   ← 注释插入即漏
[exp3] "arr?.at(-1)"                    -> detected=[]  regressions=0   ← 可选链即漏
[exp3] "const at = arr.at; at(-1)"       -> detected=[]  regressions=0   ← 解构后调用即漏
```

**机理与定级**：门 C 的**方向是对的**（`measured > recorded ⇒ red`，`exp1` 坐实；下降为绿，
spec §X3.3 ③ 强调的「基线改大不算红、必须改小」这个方向也正确），
基线与干净重建的实测**逐包逐构造一致**（4 包全 GREEN，`composer-input` 5 构造全 0，
说明 N-P0-01 的修法确实把 `Object.fromEntries` 从产物里清零了）。
但它的**覆盖面**比 spec §X3.2 声称的窄：spec 说门 C 抓的是「某个我们控制的一手依赖升级把新构造带进来」，
而这条路径上的产物是**第三方库**（mermaid / zod / Recogito / CodeMirror）的**降级输出**——
它们不会写成 `Object.fromEntries(`，而可能写成上面那 6 种换形之一（注释/换行是 terser 压缩的常态，
可选链在 es2018 降级后也会变成别的形态）。

门 C 因此**不是**门 B 的补充网，而是一道**只对「我们自己的代码被原样打进产物」有效**的网。
这个定位需要写进基线 JSON 的 `$comment`（现在只写了「不与上游库升级打架」）。

**修法**：
- 把 5 条正则改成**容忍分隔符**的形态，优先最小改动：
  `Object\s*\.\s*fromEntries\s*\(`、`\.\s*replaceAll\s*\(`、`Object\s*\.\s*hasOwn(?!Property)\s*\(`、
  `\bstructuredClone\s*\(`、现有 `Array.at` 保持。
  ⚠️ 改完**必须重测基线**（`--update-compat` 或手工），因为 `chat-transcript`（37 处 replaceAll）
  这类高计数包对空白容忍度敏感，基线值可能变。
- `Object['fromEntries']` 这类**计算属性**形态建议**不进产物面**（产物里极少出现，
  出现了也说明有人在手写绕过），但要在 `$comment` 里显式声明「计算属性形态由门 A 在源码面兜住」。
- 在 `build-webview.mjs` 的门 C 注释里补一句净增量口径（与门 A 那段同款）：
  「门 C 只对『我方源码原样进产物』有效；第三方库的降级/压缩形态它数不到。」

**不要**把门 C 改成「出现即 fail」——spec §X3.2 已经用 3/4 包先天命中论证过那条路走不通。

---

### P2-1：X1 的 eslint 门只管 `import` / `export ... from` 语句，不管动态 `import()` 与 `require()`

**位置**：`apps/desktop/eslint.config.mjs:71-88`（`no-restricted-imports` 的 `patterns` 形态）

**实测（探针已删）**：向 `renderer/` 注入 4 种形态，eslint 只报出 2 条：

```
1:1  error  '@novel-master/core/vfs' import is restricted ...          ← 静态 import ✔
6:1  error  '@novel-master/core/chat' import is restricted ...          ← export ... from ✔
（2:1 的 await import("@novel-master/core/chat") 与 5:1 的 require("@novel-master/core/events") 均未报）
```

**但兜底网补上了**：同一份注入下，X1 的结构快照测试
（`apps/desktop/test/shared-logic-x1.test.ts`）两条用例都红了——
第 1 条按**字样级**判定（`code.includes(CORE_SPECIFIER)`，剥注释后）直接点名文件；
第 2 条按**绑定级**判定，`renderer 存在指向 core 的语句：["... import @novel-master/core/vfs [validateVfsEntryName]","... export @novel-master/core/chat [isHttpUrl]"]`。

⇒ **净结论：X1 的实际拦截能力 = eslint（窄）+ 结构快照测试（宽）= 合格**。
`no-restricted-imports` 不覆盖动态/require 是 ESLint 核心规则的已知边界，不是本次实现的缺陷。
**建议**：在 `eslint.config.mjs:71` 的注释里补一句「本规则只覆盖静态 import/export；
动态 import() 与 require() 由 `test/shared-logic-x1.test.ts` 的字样级用例兜住」，
避免后人以为 eslint 那条是全覆盖而删掉结构快照测试。

**顺带确认（X1 结构快照测试的设计质量值得肯定）**：
它有「防恒真」第三条用例（`shared/logic 再导出面非空` + 「shared 侧只准 export 不准 import」），
这正是 H2 §Step 2 警告过的「把同一份键表抄两遍 ⇒ 断言恒真」陷阱，本条避开了。
`stripNonCode` 先掩字符串再删注释的顺序也是对的（文件头 `:50-57` 写明了理由）。

---

### P2-2：`docs/Iterations/` 排除面 779 个文件，占整个扫描面的 22%——排除本身合规，但「只排这一个子目录」需要写明理由

**位置**：`scripts/check-encoding.mjs:45`（`SKIP_PATH_PREFIXES = ["docs/Iterations/"]`）

实测扫描面：`in-scan 2695 / excluded 811`，其中 `docs/Iterations` **779**、`android` 32。

spec §H1.3 Step 1 只要求「**显式声明 `docs/` 不在扫描面内**」（含 `docs/Iterations`），
落地成**只排 `docs/Iterations/`、保留 `docs/apm/` 与 `packages/*/docs/`**——这比 spec 更严，
方向正确（`docs/apm/RULE.md` 与 `packages/core/docs/public-api.md` 都是真会被工具链读的中文文档）。

**问题**：`docs/Iterations/` 是本仓**迭代过程文档面**（本报告所在目录也是它），
779 个文件里含大量 spec / ledger / raw 报告。这些文件里出现 U+FFFD 或 BOM 是**历史留痕的正常形态**
（它们记录的正是「哪里有编码损坏」这件事本身）。文件头注记已经写明了这个理由（`:13-16`）。

**要做的**：把注记补上**量级**（「实测 779 个文件、占扫描面 22%」），
并明确「`docs/Iterations/` 下的内容不视为源码，编码损坏在那儿是**记录**而非**病症**」。
否则下一个读代码的人看到 22% 的排除比例会合理地怀疑门禁被做空了。

---

### P2-3：门 A 的自定义规则放过「解构后调用」形态，而规则注释明确声称覆盖这一形态

**位置**：`apps/mobile/eslint.config.mjs:33-36`（注释声称覆盖「解构取引用（`const {at} = arr`）」）、
`:83-98`（`shadowed` 集合的收集逻辑）

**实测（探针已删）**：第一轮 8 形态注入命中 7 条，**第 8 条（解构）未命中**；
第二轮针对性复测：

```ts
const { at } = [1, 2, 3];
export const a = at(-1);        // ← 门 A 完全没报
const { fromEntries } = Object;
export const b = fromEntries([["k", 1]]);   // ← 被 no-restricted-properties 报了（因为右侧 Object.fromEntries 是成员访问）
```

**机理**：`shadowed` 集合把 `const { at } = [...]` 的 `at` 记为「已遮蔽」，
于是后续裸标识符 `at` 被 `:141` 的 `if (shadowed.has(name)) return;` 放行。
注释里把「解构」列为自定义规则存在的理由之一，但实现只做了**反向**（放行遮蔽），
没做**正向**（在解构发生时报告）。

**定级 P2 的理由**：`at` 的解构调用在真实代码里罕见（`.at(-1)` 直接写更自然），
且门 C 仍会在产物层数到 `.at(` 之外——不对，门 C 也数不到（见 P1-5 的 `arr?.at` 换形），
所以这两条形态目前**两道门都漏**。但它们都不改变 N-P0-01 那类**顶层执行**的破坏机理
（`Object.fromEntries` 顶层执行会白屏，`arr.at(-1)` 在表达式位置求值失败只抛 TypeError），
后果轻于原 P0。

**修法**（二选一）：
- **(a) 改注释**（最小、诚实）：把 `:33-36` 注释里「解构取引用」从「已覆盖」列表里去掉，
  改成「**刻意不覆盖**解构形态：局部遮蔽是合法的 polyfill 写法
  （如 `const structuredClone = require('./shim')`），一刀切会误伤」。
  这个说法与实现是一致的——`shadowed` 的存在本身就是这个设计意图。
- **(b) 真要拦**：在 `VariableDeclarator` / `:function` 的收集处，若被收集的名字命中
  `WEBVIEW_RESTRICTED_MEMBERS` 或 `WEBVIEW_RESTRICTED_GLOBALS`，报一条
  `restrictedMember`。⚠️ 代价是会把 polyfill 写法也拦掉（`const { at } = Array.prototype` 是合法降级），
  需要给 `eslint-disable-next-line` 留出口。

倾向 (a)：门 A 的价值在报错语境与零存量债，不在于把每条理论路径都堵死。

---

### P2-4：门 B 的白名单是**构建时**判定的（正确），但 60 条 `chat-transcript` 条目无逐条理由注释

**位置**：`apps/mobile/scripts/build-webview.mjs:60-127`（`WEBVIEW_CORE_ALLOWLIST`）

**先记正面**：spec §X3.7 列的最高概率风险「门 B 白名单写死 59 条，后续有人顺手加一条绕过门」，
在落地形态上被**正确处理**了——白名单是**构建时**从 `metafile` 读的，
**不存在「陈旧 metafile 放行新直连」的问题**（每次 `bundleAppJs` 都传 `metafile: true`，
`assertCoreAllowlist` 紧跟在 `bundleAppJs` 之后同步执行，`build-webview.mjs:485-487`）。
这回答了本轮检查维度 B 里的「门 B 生成时机」一问：**时机正确，无陈旧面**。

**注入实验（探针已删）**：给 `composer-input` 的 webview 入口加一条**真实存在**的 core 导出
（`import { createVfsService } from "@novel-master/core/vfs"`），重跑构建：

```
[gate B / webview core allowlist] RED: package composer-input pulls 13 core module(s) outside the allowlist
  packages/core/dist/infra/tdbc/index.js          ← 正是 N-P0-01 的病根模块
  packages/core/dist/public/vfs.js
    <- imported by: apps/mobile/src/web/composer-input/webview/runtime/model.ts  @novel-master/core/vfs
  ...（共 13 条）
```

⇒ **门 B 有真牙，且归因链正确**（同时点名了「哪个模块」与「谁 import 了它」，
`build-webview.mjs:320-343` 那段「必须读顶层 `metafile.inputs[x].imports` 而不是
`outputs[k].inputs[x]`」的注释是对的——我实测拿到了 importer 归因）。
顺带坐实了 P0 病根模块 `infra/tdbc/index.js` 确实是从 core barrel 传递进来的。

**剩下的问题**：`chat-transcript` 那 **60 条**（spec 说 59，实测 60）白名单条目是**光秃秃的字符串数组**，
没有一条带注释。spec §X3.7 的缓解写的是「白名单条目必须写注释说明**为什么需要**；
PR review 时逐条问『删了会怎样』」——**这条缓解没有落地**。后果是这 60 条变成了
「看着像黑名单、其实是白名单」的隐形债务：下一个人往里加一条不会有任何摩擦，
而门 B 只知道「在白名单里就放行」。

**修法**（不改判定逻辑，只加可维护性）：把数组元素从 `string` 换成
`{ id: string, why: string }`（或在数组上方按来源分组加块注释：vfs 工具族 / search 工具族 /
schema 族 / bootstrap 族）。`assertCoreAllowlist:308-316` 的消费侧只需改成取 `.id`。
成本约 30 行，收益是让 spec 承诺的 review 摩擦真实存在。

---
