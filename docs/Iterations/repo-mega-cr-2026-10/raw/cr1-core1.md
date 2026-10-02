# cr1-core1 · Wave B core1 分片代码评审报告（review round 1，节点 cr1-core1）

- repo：`D:\Dev\nm-worktree\mcr`（feat/repo-mega-cr）
- base_sha：`fe79b781` ／ head_sha：`046f4d9c`
- 本 scope：commit `6ffeb5fb`（core1 八条：CS-01 / N-P1-01+CS-04 / RT-04 / RT-08 / RT-01 / B1-7 / B1-8）
- 业务 spec：`docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-b-core1.md`（B1-1…B1-8，七要素完整）
- CR fix-spec：`docs/Iterations/repo-mega-cr-2026-10/cr-fix-spec.md`（draft，Must-fix 段仍为「（首轮评审进行中）」空壳）
- 检查维度：A（需求符合性）+ B（正确性）+ C（质量）+ C-orch（编排收敛）+ G（测试）；E/F/H–J/K 不在本节点范围，K/F 级杂项列在文末「C 类附录」不阻塞
- C-orch：**适用**（本 commit 同时改领域层 schema、VFS 原语、project/template service、workplace 组装、agent runner，并与其后的 core2 / Wave C 提交有交叉面）
- 纪律：readonly。未改任何生产/测试代码、未改 spec、未做任何 git 写。**唯一写入为本文件。**
- 上一轮结论：none（首轮）

---

## 1）相对上轮

首轮，无上轮结论。本节点 8 条 spec 条目逐条对照 diff + HEAD 现状核对完毕，产出 3 条 P1 + 2 条 P2 must-fix、2 条 open_questions、2 条 spec_deviations。

### 1.1 八条逐项结论

| 条目 | 落地形态 | 结论 |
|---|---|---|
| B1-1 CS-01 `renamePrefixInScope` | `sqlite-vfs-entry.repository.ts:939` 换 `substr` 定点拼接 + T-V6 | **通过**（注释缩进有瑕疵，见附录 K-1） |
| B1-2 N-P1-01 项目删除 revision 泄漏 | `project.service.ts:213/216` 两处改 `sweepRevisionsUnderScope`；`:196` 保持裸调用 + 注释 | **通过**（P-D1…P-D4 实测绿） |
| B1-3 CS-04 sweep 换序 | `vfs-tree-copy.ts:404-417` 改为 decrement → GC → 删 entry | **实现通过**，但 JSDoc 理由在 HEAD 已过期（C-2） |
| B1-4 RT-04 块名唯一门禁 | `agent-definition.schema.ts:228` `validateAgentPromptLayout(def.prompts)` | **通过** |
| B1-5 RT-08 模板拉取清缓存 | `template-pull.service.ts:41` `clearSessionPromptCaches` | **实现通过**，但核心验收用例不稳定（A-1） |
| B1-6 RT-01 gemini 查找源复用 | `agent-runner.ts:421/623-625` | **落库路径通过**，ephemeral 路径前提不成立（B-1） |
| B1-7 §6#3 草稿逐条降级 | `composer-draft.schema.ts:69-92` | **通过** |
| B1-8 §6#4 附件逐条降级 | `message-attachment.schema.ts:128-139` | **通过** |

### 1.2 范围外夹带

commit `6ffeb5fb` 改了 `packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts`（109 行）+ 两个测试文件，但 `wave-b-core1.md` 的八条里**没有任何一条**覆盖它。追查归属：该改动是 **wave-b-core2.md 的 M-03**（「filename 档与读失败降级把 1970-01-01 假时间戳写进常驻提示词」，P1 / core-misc），而 core2 的提交 `4829b8d1` 的 37 个改动文件里**没有**这两个文件 ⇒ M-03 实际由 core1 交付。详见 C-1 / SD-1。

---

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

## 3）open_questions（未认定，不得混入 must-fix）

### OQ-1 · RT-01 在 ephemeral 路径上要不要接受 wire 变化？

见 B-1。两条路（加 `persistMessages` 门禁 / 接受并补测 + CHANGELOG）都合规，**取舍是产品/性能口径的判断**，须用户拍板。若不拍板，下游 spec-fix 无从下笔。

### OQ-2 · zip/角色卡/技能三条链要不要补 `runDeferredBlobGc`？

见 C-2。方案甲是「补 gc」（多三次全库扫描），方案乙是「只改注释 + 补用例」。在**没先跑出残留实测数**之前选任一方案都是猜。建议下游先按方案乙 跑一次实测（`SELECT COUNT(*) FROM vfs_content_blob WHERE ref_count <= 0`，三条链各一次），有残留再补方案甲。

### OQ-3 · B1-7 的前置可达性探针未跑，定级与「是否删字段」的拍板仍悬

`wave-b-core1.md` B1-7 明写「实施前必跑」：`composer_draft_json` 行的 `attachments` 非空且逐条判废的条数。探针 = 纯读统计（`SELECT composer_draft_json FROM chat_session WHERE composer_draft_json IS NOT NULL` 逐条 `JSON.parse` 后数长度），结果 > 0 则正文丢失有真实受害面（P2 + CHANGELOG 单句），= 0 则本条按 P3、并考虑直接删掉草稿 schema 的 `attachments` 字段（那是产品决策，spec 明确不替用户拍）。本节点为 readonly、未跑（需真机/夹具库）。**B1-7 的实现本身已落地且正确，问题只剩定级与字段存废。**

### OQ-4 · B1-8 断言 F 的实测数未采集

spec 验收栏要求把「`attachments_json` 非空行数 vs 逐条判废后存活行数」的差值写进用例注释，并明写「不许照抄任何既有报告或台账里的数，必须本机跑出来填」。本次未采集（夹具数据决定、非行为契约），实现侧无缺口。

---

## 4）spec_deviations

### SD-1（open）· M-03 的 spec 在 `wave-b-core2.md`，实现落在 core1 提交

- spec 位置：`fix-spec/wave-b-core2.md`「`filename` 档与读失败降级把 `1970-01-01` 假时间戳写进常驻提示词」（P1 / core-misc）
- 实现位置：commit `6ffeb5fb`，文件属 `wave-b-core1.md` 八条之外
- 偏离性质：**归属偏离，非实现偏离**（实现与 core2 spec 逐条对齐，见 C-1 的三点核对）
- 建议处置：`fixed`（台账归属改指 `6ffeb5fb`）—— 不建议写成「按现状收窄」，因为实现是对的、只是记错了地方

### SD-2（open）· RT-01 spec 的等价性前提在 ephemeral 路径不成立

- spec 位置：`wave-b-core1.md` B1-6 修法第 2 条 + 风险栏「复用了错的那一份数组 ⇒ gemini wire 输出变化」
- 偏离性质：**spec 论证覆盖面不足**。spec 把「两次读是同一张表/同 filter/同 ORDER BY」当成了全路径成立的事实，实际上 `persistMessages === false` 时 `session.list()` 走 `EphemeralOverlayAgentSession`（base ++ RAM overlay），与 DB 读口不是同一个集合
- 建议处置：随 B-1 一并闭合（选定方案后把该前提改写成「落库路径成立」并在 spec 里显式记 ephemeral 例外）

---

## 5）fix-spec 可执行性

`cr-fix-spec.md` 当前状态：**空壳**（Must-fix 段「（首轮评审进行中）」、Spec deviations「（待报）」、Open questions「（待报）」、K 节「（待报）」）。

| 检查项 | 结论 |
|---|---|
| 3 条 P1 是否已进 fix-spec | ❌ 全缺（C-1 属记账类，可与其他 P1 一并写入） |
| 2 条 P2 是否已进 fix-spec | ❌ 全缺 |
| 2 条 open spec_deviations 是否已报 | ❌ 全缺（SD-1 / SD-2） |
| 每条是否含「文件 + 改法 + 验收」 | ✅ 本报告已按此三段写全，主代理可直接摘抄 |

**业务 spec（`wave-b-core1.md`）侧的可执行性**

- 八条的七要素（病症/证据/修法/验收/测试策略/回归线/依赖/风险）**完整、可执行**，本 commit 的实现与 spec 逐条对得上（差异见 §1.1 与 SD-2）。
- **缺口 1**：B1-3 与 B1-5 都要求做「反向自检（把实现改回旧形态，新用例必须红）」。本次为 readonly、禁改代码，**未执行**；已用「断言形态是否有牙齿」的静态核对替代（见 §6.2），结论是八条新用例的断言体都咬到了东西，但**反向自检仍须下游补做**。
- **缺口 2**：B1-7 的定级（P2 vs P3）与「是否删 `attachments` 字段」两个分支都悬着（OQ-3），fix-spec 写这条时必须显式标注「待探针/待拍板」，否则下游会当成已定级实施。
- **缺口 3**：B1-6 的测试策略四条用例全部基于 `ChatAgentSession` 夹具，**没有任何一条覆盖 ephemeral 路径** —— 这正是 B-1 得以漏到提交的测试侧根因，修 B-1 时须同步补测试策略。

---

## 6）结论

### 6.1 结论

**scope-ready: no**

理由：本 scope 有 **3 条 P1** open（`cr1-core1/A-1` 测试不稳定、`cr1-core1/B-1` 正确性/覆盖缺口、`cr1-core1/C-1` 编排归属失配）+ 2 条 spec_deviations open（SD-1 / SD-2）。按 code-review-loop 规则，open spec_deviations 不得 scope-ready。

| 严重度 | 条数 | id |
|---|---|---|
| P0 | 0 | — |
| P1 | 3 | `cr1-core1/A-1`、`cr1-core1/B-1`、`cr1-core1/C-1` |
| P2 | 2 | `cr1-core1/C-2`、`cr1-core1/C-3` |
| open_questions | 4 | OQ-1…OQ-4 |
| spec_deviations | 2 | SD-1、SD-2（均 open） |

未涉及维度（本 scope 明确不含）：D 安全 / E 性能 / F 中文注释 / H 兼容性 / I 可观测性 / J UI。E 与 F 的相关观察见附录，不计入 must-fix。

### 6.2 本机实测记录（全部在 `046f4d9c` 工作树跑，命令前缀 `cd packages/core && npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test`）

| 批次 | 结果 |
|---|---|
| `test/vfs/sweep-revisions-order.test.ts` + `test/vfs/project-delete-revision-gc.test.ts` | **# tests 7 / # pass 7 / # fail 0**（S-O1/S-O2/S-O3、P-D1…P-D4） |
| `test/service/agent/read-ref-production-smoke.test.ts` + `test/vfs/vfs-rename-primitive.test.ts` + `test/chat/composer-draft.schema.test.ts` + `test/chat/message-attachment.schema.test.ts` + `test/chat/message-attachments.round-trip.test.ts` + `test/chat/message-content-helpers.test.ts` | **# tests 39 / # pass 39 / # fail 0**（含 RT-1A…RT-1E、T-V1…T-V6、CD-1…CD-3、MA-1…MA-5） |
| `test/vfs/vfs-tree-copy-batch.test.ts` + `test/vfs/vfs-gc-trigger.test.ts` + `test/vfs/read-ref-count.test.ts` + `test/message-checkpoint/revision-gc.test.ts` + `test/vfs/orphan-revision-gc.test.ts` | **# tests 30 / # pass 30 / # fail 0**（含 T-BATCH-1…4、T-EXCL-1…4、T-G1/T-G2、CS-07 守卫四条、T-RR4 项目删除对账） |
| `test/workplace/template-pull.test.ts` + `load-or-fill-file-cache.test.ts` + `assemble-workplace-display.test.ts` + `test/agent/agent-definition.test.ts` + `test/chat/project-agent-config.schema.test.ts` + `test/chat/sqlite-session.repository.test.ts` | 首轮冷跑 **# fail 1（T-P3）**；复跑 4 次 # fail 0 |
| 同上，单文件 / 三文件 | 5 次 + 4 次全部 # fail 0 |

**未跑**：全量 `npm test -w @novel-master/core`、`typecheck`、`lint`（skill 的 G 维只评测试有效性不自跑测；且全量耗时超出本节点预算）。**未做**：spec 要求的反向自检（readonly 禁改代码）。

### 6.3 已核对且判定无问题的点（留痕，避免下游重复查）

- **sweep 换序的事务一致性**（本次重点之一）：`deleteUnreferencedUnderScope` 用的是仓储构造期的 `this.conn`，因此三步同事务当且仅当 revision 仓储以 tx 构造。逐条核实——`skills.service.ts:449`、`character-card-import.service.ts:178/196`（`repoTx/revisionTx`）、`vfs-zip-io.service.ts:240/258`（`repoTx/revisionTx`）、以及 core1 新增的 `project.service.ts:213/216`（`reposFor(tx)` 见 `:50-58`，`vfs` 与 `revisions` 同 tx）**全部成立**。JSDoc 要求的「不得拆出事务」这条约束在 HEAD 仍有效。
- **`:187` 保持裸 `deleteVfsPrefix`**：注释写明了「live ref 已由 `deleteSessionFsData` 释放、再 decrement 会撞 `CHECK (ref_count >= 0)` 抛 `SQLITE_CONSTRAINT_CHECK` → 整个 delete 事务回滚」；P-D4 实测钉住（绿）。spec 担心的「二次 decrement」事故未发生。
- **CS-01 `substr` 定点拼接**：`oldWithSlash` 在同一条 SQL 里出现两次，`placeholder.ts:16-28` 每次 `#{x}` push 一个参数 ⇒ 复用同一绑定、不重复绑定，与 `sqlite-workplace.repository.ts:303/311` 同款写法（同一 `SqlTemplateParser`、同 better-sqlite3 驱动）。`WHERE ... LIKE #{pattern} ESCAPE '\'` 未动，`T-V5`（`%`/`_` 转义）保持绿。T-V6 有牙齿：它断言了二次替换产生的错位路径 `/a_新/sub/a_新/notes.md` 必须为 `null`，用 `REPLACE` 实现必红。
- **`writeWithRevision` 的版本语义与 `ref_count` 兼容**（本次重点之一）：create 路径 `append` + `adjustRef(+1)`；update 路径 `append` + `transferLiveRef(old→new)`；中间历史版本 `ref_count = 0` ⇒ core1 让 scoped GC（谓词 `ref_count <= 0`）首次真正生效后，这些历史版本会在**删 entry 之前**与 entry 同事务一并回收 ⇒ 不会出现「entry 指向已被回收的 revision」。`nextVersionFor` 的 `max(head, MAX(version)) + 1` 保证新号不撞历史占号段。唯一遗留是 C-3 的死分支。
- **RT-01 判据 `stepCompactionEmitted` 的完备性（落库路径）**（本次重点之一）：`agent-runner.ts:413 → 622` 之间逐段核过——`assembleWorkplaceDisplay`（`:438`）只读 KKV/VFS 不写消息；`prepareUserMessagesForPrompt` 内部新建 `out` 数组（`prepare-user-messages-for-prompt.ts:593`）**不就地改入参**、hydrate 也是内存态（`:635` 注释自陈「内存态，不写回 content_json」）⇒ `visibleBeforePrepare` 这个别名不会被 prepare 污染；唯一会改可见集的动作就是 `:564` 的 `runCompaction`，由 `stepCompactionEmitted` 覆盖。两个读口确实同表同 filter（`ChatAgentSession.list()` 与 `assemble-agent-runner-deps.ts:73` 都是 `listBySession(sessionId, { includeHidden: false })`）。**结论：落库路径判据完备；ephemeral 路径例外见 B-1。**
- **B1-7 / B1-8 降级的边界**（本次重点之一）：
  - `parseAttachmentsJson` 从「全失败返回 `undefined`」改成「返回 `[]`」对下游无回归：`prepare-user-messages-for-prompt.ts:488` 用 `?? []`、`message-content-helpers.ts:37` 用 `!attachments || attachments.length === 0`、`agent-runner.ts:495` 用 `?? []`、`normalize-for-llm-export` 走 `hasNonEmptyAttachments` 长度判；`serializeAttachmentsJson([])` → SQL NULL ⇒ 往返稳定。
  - `parseComposerDraftJson` 的顶层守卫用 `!isRecord(parsed)` 早退，与 spec 要求的「`obj === null` 显式返回空草稿」**等价**（标量/数组/null 三种形态都被 `isRecord` 排除）；`kept` 过滤后仍喂回 `composerDraftSchema.safeParse` ⇒ 复用了「非 attach 源剥除」transform、保住 `.strict()`、且 `composerDraftSchema` 保持有生产消费（spec 修法第 1 条的三得全部兑现）。
  - 「逐条降级」会让历史数据里此前被静默丢弃的附件/草稿内容**复活**（spec 分片级注记已预告）⇒ CHANGELOG `Changed` 段两条各一句的义务仍然挂着，**本次 commit 未见 CHANGELOG 改动**（见附录 K-2）。
- **B1-4 收敛点**：`definitionToDocument` 是三个写侧调用点（`validate-agent-definition.ts:89` 的 zod 往返、`project-agent-config.schema.ts:33` 的 `configToWire`、注册表持久化）的唯一收敛点，一处覆盖 ✓。抛的 `PromptError("INVALID_BLOCK")` 在读侧（`documentToDefinition → validateAgentPromptLayoutFromMaps`）本来就会抛 ⇒ **不新增任何错误分类面**，desktop IPC 的错误映射不受影响。

---

## 附录 · C 类附录（K/F 级杂项，不进 must-fix，由下游 spec-fix 作为步骤闭合）

- **K-1**：`packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:930` 的注释行丢了 4 空格缩进（`6ffeb5fb` 引入），紧邻的 4 行注释缩进正常 ⇒ 视觉断层。改法：补回 4 空格。
- **K-2**：`wave-b-core1.md` 分片级注记要求「B1-7 / B1-8 的『复活』语义进 CHANGELOG 的 `Changed` 段各一句」，以及 B1-5 风险栏的 `toolUseCount` 哨兵可感知变化。本次 commit（`6ffeb5fb`）**未带 CHANGELOG 改动** ⇒ 收尾时须补，否则这条语义变化对用户不可见。
- **F-1**：本 commit 新增的中文注释密度与质量整体达标（JSDoc 里把「为什么不能用 REPLACE」「为什么必须同事务」「为什么 degraded 不能加宽共享类型」「为什么另存而不能复用同名 visible」这些**非显然约束**都留在了代码里），符合 F 维「关键逻辑中文注释 + 公开 API 文档注释」的要求。K-1 是唯一的排版瑕疵。
- **编码**：`test/agent/agent-runner.test.ts` 的 9 行改动是 A7b 编码修复（mojibake → 正常中文），逐行核对无误，不属业务变更。
