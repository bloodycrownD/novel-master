# cr1-full · review-full 机位复核报告（Round 1 / dag 1）

## ① 元信息

| 项 | 值 |
|---|---|
| 机位 | `cr-full-1`（code-review-loop · **review-full** · review_round 1 / dag_version 1） |
| 仓库 | `D:\Dev\nm-worktree\mcr`（分支 feat/repo-mega-cr） |
| 被审物 | `docs/Iterations/repo-mega-cr-2026-10/cr-fix-spec.md`（状态 spec-fix-done，169 行） |
| 真源 | `raw/cr1-{wavea,cloudsync,core1,core2,apps,c2,c1,ctests,kotlin,dead,guards}.md` 共 11 份 + 参考 `raw/cr1-mustfix-digest.md` |
| 纪律 | 只读评审。未改任何代码 / spec / 报告，未做任何 git 写（git 仅用于确认目录清单）。唯一落盘物为本文件 |
| 复核范围 | ① 漏收 ② 失真 ③ 可执行性 ④ 计数 ⑤ 编排 |
| 结论 | **not-ready**：13 条漏收（其中 3 条阻断级）+ 5 条失真 + 2 条不可执行 |

---

## ② 逐维结论

### 维度 1 · 漏收 —— **FAIL**

**P1/P2 主干：全部到位（0 条整条漏收）。** 逐份核对结果：

| 报告 | 报告侧 must-fix | fix-spec 收录 | 结论 |
|---|---|---|---|
| wavea | WA-P1-01 + WA-P2-01..06 | CR-F11 + §2.3 wavea 6 条 | ✅ 全收 |
| cloudsync | P1-1/P1-2 + P2-1..5 | CR-F01/F02 + §2.3 5 条 | ✅ 全收 |
| core1 | A-1/B-1/C-1 + C-2/C-3 | CR-F03/F17/F19 + §2.3 2 条 | ✅ 全收 |
| core2 | A-1/C-1 + B-1/B-2/C-2/C-3/C-4 | CR-F04/F18 + §2.3 **5 条** | ✅ 全收（段头数字错，见维度 4） |
| apps | P1-1 + P2-1..8 | CR-F08 + §2.3 8 条 | ✅ 全收 |
| c2 | P1-1/P1-2 + P2-1..4 | CR-F05/F06/**F20** + §2.3 3 条 | ✅ 全收（P2-1 升级为 F20） |
| c1 | P2-1..8（无 P1） | §2.3 8 条 | ✅ 全收 |
| ctests | P1-1/P1-2 + P2-1..4 | CR-F05/F07 + §2.3 4 条 | ✅ 全收 |
| kotlin | P1-1/P1-2 + P2-1..3 | CR-F09/F10 + §2.3 3 条 | ✅ 全收 |
| dead | P2-1..6（无 P1） | §2.3 6 条 | ✅ 全收 |
| guards | P1-1..5 + P2-1..4 | CR-F12..F16 + §2.3 4 条 | ✅ 全收 |

**Spec deviations（§3）：PASS（仅主项）**。cloudsync D1/D2（真正偏离的只有这两条，D3–D20 报告自判 ✔ 符合）、core2 C-1/C-2/C-3、M-03 归属，全部落表。c2 D1/D2/D3 归入 CR-F05、core1 SD-1 归 F19、SD-2 归 F17、core2 SD-2 归 C-4/OQ6，均有归属。

**Open questions / K 节 / QA：FAIL —— 13 条未承接**（明细见 ③-A）。

---

### 维度 2 · 失真 —— **FAIL**

逐条抽查 CR-F01..F20 的位置 / 修法 / 量级，抄录准确性很高（file:line 抽 14 处全对，含 `apps/cli/src/provider/commands.ts:98-102`、`check-renderer-typecheck.mjs:35/:66`、`vfs-zip-central-dir.ts:105-111 + :256-275`、`backfill-transaction-scope.test.ts:133-179` 等）。

**二选一处理：PASS（除 OQ2 一处）**。CR-F05 两案都留 ✓；CR-F06 (a)/(b) 都留 + OQ11 ✓；CR-F17 甲乙都留 + OQ1 ✓；CR-F18 甲乙都留 + OQ2 ✓；§2.3 内 OQ3/OQ4/OQ8/OQ9/OQ10 五处均把两案写进索引并标注报告倾向。

**但有 5 处失真**（明细见 ③-B），其中 **B-4（OQ2/CR-F18 把报告推荐的方案甲改标为「方案乙推荐」）最严重** —— 用户「整表确认」时会无声地推翻报告级推荐。

---

### 维度 3 · 可执行性 —— **PASS（有 2 处索引瑕疵）**

抽查 P2 索引 54 条中的 **54 条全部**（11 份报告逐段比对），均可用「报告名 + 条目号」定位到原文小节标题。举例（12 条）：

| 索引条目 | 原文落点 | 判定 |
|---|---|---|
| cloudsync P2-3 | cr1-cloudsync.md §1「### P2-3 mobile `ALREADY_UP_TO_DATE` 分支的记账缺 `.catch`」 | ✅ |
| cloudsync P2-5 | 同上「### P2-5 S-CS-09 三条用例的 `simulateOtherDevice` 用 `void storage.put`」 | ✅ |
| core1 C-2 | cr1-core1.md §2「### cr1-core1/C-2 [P2]」 | ✅ |
| core2 B-1 | cr1-core2.md §2「### cr1-core2/B-1 [P2]」 | ✅ |
| apps P2-7 | cr1-apps.md §1「### P2-7 A7b 编码扫描在 `apps/` 下还有一个文本文件没扫到」 | ✅ |
| c2 P2-2 | cr1-c2.md ②「### P2-2：`DROP TRIGGER IF EXISTS x;` …」 | ✅ |
| c2 P2-3 | 同上「### P2-3：段 1（事务外）读到的 head 指针…」 | ✅ |
| c1 P2-3 | cr1-c1.md ②「### P2-3：`listBySessionTailOfRole` 的**真实 SQL 从未被任何用例执行过**」 | ✅ |
| ctests P2-3 | cr1-ctests.md ②「### P2-3 · spec 点名要建的两个回归锁文件根本没建」 | ✅ |
| kotlin P2-2 | cr1-kotlin.md ②「### P2-2：`classifyError` 的两个新参数…是**死参数**」 | ✅ |
| dead P2-6 | cr1-dead.md ②「### P2-6（跨域观察 · 修法归 cr-guards）：棘轮文件里 `previousMaxErrors: 360` 查无出处」 | ✅ |
| guards P2-4 | cr1-guards.md ②「### P2-4：门 B 的白名单是**构建时**判定的…60 条 `chat-transcript` 条目无逐条理由注释」 | ✅ |

**OQ 默认案 vs 报告倾向：PASS**。7 个带推荐/倾向的报告全部一致：core1 OQ-1 甲 ✓（OQ1 默认甲）、core1 OQ-2 乙 ✓（OQ3 默认乙）、core2 方案甲推荐 ✗（**见 B-4**）、c2 P2-3 倾向(i) ✓（OQ4 默认 i）、c1 P2-1 倾向(a) ✓（OQ8 默认 a）、dead P2-2 倾向(a) ✓（OQ9 默认 a）、guards P2-3 倾向(a) ✓（OQ10 默认 a）、guards P1-2 推荐(a) ✓（CR-F13 取 a）。

瑕疵：wavea 六条写成 `P2-01..P2-06`，报告原文是 `WA-P2-01..06`，按索引号 grep 命不中（见 ③-C-2）。

---

### 维度 4 · 计数 —— **FAIL**

| 口径 | 报告侧实数 | fix-spec §1 矩阵 | 判定 |
|---|---|---|---|
| P0 | 0 | 0 | ✅ |
| P1（报告逐份相加） | 1+2+3+2+1+2+0+2+2+0+5 = **20** | 逐行相加 = **20**，但「合计」写 **19** | ❌ 自相矛盾 |
| P2（报告逐份相加） | 6+5+2+**5**+8+4+8+4+3+6+4 = **55** | 逐行相加 = **54**，合计写 **54** | ❌ 少 1（core2） |
| CR-F 条目数 | — | 19 个 P1 位 + F20（P2 升边界）= 20 | ✅ 本身自洽 |

两个差都是「有理由但没写出来」：P1 差 1 = c2 P1-1 与 ctests P1-1 同源合并为 CR-F05；P2 差 1 = c2 P2-1 升为 CR-F20，同时 core2 被少算 1 条（两处误差恰好抵消，总数蒙对）。合计 `0 / 19 / 54` 作为 CR-F 口径成立，但作为「报告侧计数」不成立，且矩阵未注明。这是**不能带进 fix-spec-ready 的口径缺陷**：下游若按矩阵核对报告，会判「core2 少了一条」。

---

### 维度 5 · 编排 —— **FAIL**

依赖注记三条：**PASS**。CR-F04 先于 rebase ✓（但漏 core2 B-1，见 A-12）、CR-F06+F20 同 commit ✓（但编排自相矛盾，见 C-1）、CR-F16 重测基线且排最后 ✓。

无环 ✓。但 **CR-F06 未进入任何波次**，且它与 CR-F20 的「同 commit」约束与波次划分冲突 → 编排不可执行（见 ③-C-1）。

另记一条非阻断的冲突面：core2 B-1 的「CI 加一步 `tsc -p tsconfig.test.json`」落在 CR-W5，而 CR-W2（CR-F12）已改过 `ci.yml`，两处串行无环，但需在 W5 开工前确认 W2 已合入。

---

## ③ Must-fix 清单（照抄级修改建议）

### A · 漏收（13 条）

| # | 位置 | 报告依据 | 照抄级建议 |
|---|---|---|---|
| **A-1**（阻断） | §4 OQ 表缺一行 | cr1-core2.md §3 **OQ-1**（整节缺失）。核心事实：M-04 修好后「会话引用会阻断删除」，而 **mobile 端无任何解除入口**（`ModelPickerModal.tsx:115-135` 的 `select` 无 none 分支、`PickerListModal.tsx:30-53` 的 Props 无 `allowNone`/`noneLabel`，全 mobile grep `modelId: null` 零命中）⇒ **mobile 用户一旦在会话里选过模型 M，就再也删不掉 M 及其 provider**（desktop 有 `SessionDetailDrawer.tsx:629-647` 的 `allowNone`）。报告给了三案：甲 = mobile 补 `allowNone` + 「清除会话覆盖」行；乙 = `chat_session` 扫描降级为软引用；丙 = 只加 toast（前提是甲已落地）。 | §4 增一行：`OQ15 | M-04 后 mobile 删除死路: 甲 mobile 补 allowNone 解除入口 / 乙 chat_session 降为软引用 / 丙 只加 toast(前提甲已落地) | **甲**(唯一真正解死路的一案; 乙会重开「模型被删→会话跑不起来」的口子, 与 M-04 立条相反) | core2 OQ-1`。 |
| **A-2**（阻断） | §2.2 CR-F01 修法摘要 | cr1-cloudsync.md P1-1「**测试缺口**」段：`db-backup-rollback-safety.test.ts:157`（`覆盖已成功但收尾失败时抛 DatabaseReplacedError 且不回滚`）只断言了 dbPath 没被回滚，**没有断言 `existsSync(bakPath)`** ⇒ 删与不删都绿。报告明写「修法须在**这条用例**里补 `assert.equal(existsSync(bakPath), true)`（不能在别的用例里补——这是唯一会出现该终态的用例）」。 | CR-F01 修法摘要末尾追加：「**补测试**：在 `apps/desktop/test/db-backup-rollback-safety.test.ts:157` 那条唯一走终态③的用例里补 `assert.equal(existsSync(bakPath), true)`（不得另建用例）」。 |
| **A-3**（阻断） | §4 OQ 表缺两行；§2.2 无 B1-7/B1-8 条目 | cr1-core1.md §3 **OQ-3 / OQ-4**；§5「缺口 2」原话：「B1-7 的定级（P2 vs P3）与『是否删 `attachments` 字段』两个分支都悬着，**fix-spec 写这条时必须显式标注「待探针/待拍板」，否则下游会当成已定级实施**」。OQ-3 = 跑 `composer_draft_json` 的 `attachments` 非空且逐条判废的条数（探针未跑）；OQ-4 = B1-8 断言 F 的「`attachments_json` 非空行数 vs 存活行数」差值未采集（spec 明写「不许照抄任何既有报告或台账里的数」）。 | §4 增：`OQ16 | B1-7 定级(P2/P3)与是否删草稿 schema 的 attachments 字段 | **待探针**(探针为纯读统计, 需真机/夹具库; 本轮 readonly 未跑) ⇒ 未拍板前不得按已定级实施 | core1 OQ-3` 与 `OQ17 | B1-8 断言 F 实测数采集 | **留待 CR-W4 补测时本机实跑**(禁止引用既有报告/台账数字) | core1 OQ-4`。§2.3 core1 段补一行 `C-4 B1-7/B1-8 的 CHANGELOG Changed 义务见 §7 K9`。 |
| **A-4**（重要） | §8 CR-W5 末句 | 三份报告独立指出 CHANGELOG `Changed` 段义务：cr1-core1 附录 **K-2**（B1-7/B1-8「逐条降级会让历史静默丢弃内容复活」+ B1-5 的 `toolUseCount` 哨兵，commit `6ffeb5fb` 未带 CHANGELOG）、cr1-core2 附录 **K-2**（三条用户可感变化：summarizeToolInput 三面统一 / M-01 首字后断流不再重试 / CS-08 导出目录层级变深，`4829b8d1` 未带任何 CHANGELOG）、cr1-dead P2-3（D-101）。spec §8 只写了「CHANGELOG(D-101 留痕 + 若 OQ1 选乙则 RT-01 披露)」。 | §8 CR-W5 改为「CHANGELOG 三处留痕：① dead P2-3 的 D-101 删除告知（含 `git checkout` 恢复路径）② core1 K-2 的 B1-7/B1-8 复活语义 + B1-5 哨兵 ③ core2 K-2 的 summarizeToolInput / M-01 / CS-08 三条；若 OQ1 选乙再加 RT-01」。 |
| **A-5**（重要） | §2.2 CR-F06 / CR-F20 修法摘要 | cr1-c2.md §6 **K2**：「补一条守卫性能观测（**EXPLAIN QUERY PLAN** 断言守卫走索引而非 `SCAN vfs_entry`），否则下次改触发器的人很容易把索引删掉」；**K3**：「为被撤回 v18 留下的 `user_version = 18` 库补一条与 `T-GC-UPGRADE-17-18` **同形**的用例（`PRAGMA user_version = 18` + 只造旧名触发器 → bootstrap → 断言 v2 生效）。现有那条只把版本压到 17，**牙齿覆盖不到快路径**」。两条均未进 CR-F06/F20 摘要。 | CR-F06 补：「另补一条 EXPLAIN QUERY PLAN 断言，确认 DELETE 触发器守卫走 `idx_vfs_entry_content_hash` 而非 `SCAN vfs_entry`」。CR-F20 补：「无论选 bump 19 还是事务外段，均补一条 `T-GC-UPGRADE-18-RECLAIM` 用例（`PRAGMA user_version = 18` + 只造无守卫旧名触发器 → bootstrap → 断言 v2 生效 + 旧名已消失），照 `vfs-gc-trigger.test.ts:471` 同形」。 |
| **A-6**（重要） | §4 OQ 表缺两行 | cr1-c2.md §4 第 4 条（**口径确认**）：「C2-9 自己把 CS-10 从 P1 紧迫性降级为 P1-一致性/防御性封顶，本次实现与该降级口径一致 ✔，但请确认 `ledger-v2.md` 里 CS-10 的定级行是否已同步改写」；第 5 条（**域边界确认**）：「本 scope 声明 CS-05 分片不在我域，但『分片补偿的失败语义』在重点清单里…若补偿的失败语义本身（是否掩盖主错误、是否幂等、report 契约变更）也要出结论，需要把 `vfs-zip-io.service.ts` / `character-card-import.service.ts` 划进本节点或另开节点」。 | §4 增：`OQ18 | c2 域边界: 分片补偿的失败语义(掩盖主错误/幂等/report 契约)是否需要另开节点出结论 | **本轮不判**(c2 节点按边界只核对不判; 登记为下一轮 CR 域分配输入) | c2 ④-5` 与 `OQ19 | ledger-v2 CS-10 定级行是否已同步改写 | **核对并改写**(纯文档) | c2 ④-4`。 |
| **A-7**（低） | §4 OQ 表缺两行 | cr1-wavea.md §2 第 3 条（登记项：「`npm test -- <不存在的路径>` 会 exit 1…仅登记，若将来有人抱怨，这里是已知解释」）、第 4 条（「A5.4 ② 的 YAML 形状检查…要不要把它落成 `scripts/check-ci-gates.mjs`（与 wave-e 的 `check-encoding.mjs` 同族），免得下一个改 ci.yml 的人重新踩这个坑」）。 | §4 增 `OQ20 | wavea A5.4 ② 的三 shell 单行命令要不要固化成 scripts/check-ci-gates.mjs | **固化**(成本一行, 与 CR-F12 同批动 ci.yml) | 无代码`；第 3 条属「仅登记」，建议并入 §5 或 §9 状态段的已知解释，不必占 OQ。 |
| **A-8**（低） | §7 K 节缺 core1/c2/c1 的 K 项 | cr1-c1.md §6 **K9**（补 C1-7 I7 撞号决胜用例：造两条同 `sortOrder` 的行 → `listOrdered`；当前零用例，SQL 未动零风险）、**K10**（`message.port.ts` 四个窄读口相邻排布并各写一句「谁在用、为什么不能用别的」）；cr1-c2.md §6 **K6**（`parser.ts:45-53` 的 `astCache` 跨调用 arity 集合仍无界，登记 Wave D/E 债务）；cr1-core1 附录 **K-1**（`sqlite-vfs-entry.repository.ts:930` 注释丢 4 空格缩进）。 | §7 追加 K9「c1: 补 C1-7 I7 撞号决胜用例」、K10「c1: `message.port.ts` 四个窄读口相邻排布 + 各写一句用途注释」、K11「c2: parser `astCache` 跨调用无界，登记 Wave D/E 债务」、K12「core1: `sqlite-vfs-entry.repository.ts:930` 注释补 4 空格」。 |
| **A-9**（低） | §7 / §8 缺 | cr1-guards.md §3 第 11 条：「门 A 至今是『本地/lint 时生效、CI 不拦』的半门禁（mobile 的 lint 只走 `ci.yml:69-71` 那条 `continue-on-error: true` 的全 workspace 步）…记录在此以便 **mobile 收口时不要遗漏把它转成 blocking**」。 | §7 追加 K13「guards: 门 A 仍是 CI 不拦的半门禁，mobile lint 收口时必须同步转 blocking」。 |
| **A-10**（低） | §2.3 kotlin 段缺 | cr1-kotlin.md §3 Should-fix 1：`sseConnect` 的 duplicate-requestId 分支（`:178-182`）`newCall` 出来的 `call` 既没 `cancel()` 也没进任何 map（实际泄漏极小，但属既有代码）。 | §2.3 kotlin 段补 `P2-4 sseConnect duplicate-requestId 分支的 Call 未 cancel(既有代码, 一行补 call.cancel())`。 |
| **A-11**（低） | §2.3 ctests 段缺 | cr1-ctests.md §3 四条中三条会咬未来：`backfill-transaction-scope.test.ts:104` 取 `transactionCount - 1` 当 backfill 段，隐含「backfill 必是最后一条事务」，段序一变就假红；`longest-common-substring.test.ts:145-150` 的 `1200 × 1200` oracle 在低内存机器有 GC/超时风险；`vfs-gc-trigger.test.ts` 三处守卫断言自指生产常量，建议**额外钉一条字面量**（断言 trigger SQL 里出现 `vfs_entry` 字样）。 | §2.3 ctests 段补 `P2-5 三条口径脆点: B1 隐含「backfill 必是最后一条事务」/ LCS oracle 1200×1200 内存风险 / GC 守卫断言自指生产常量(建议补 vfs_entry 字面量锁)`。 |
| **A-12**（低） | §8 依赖注记第 1 条 | cr1-core2.md C-1 方案甲原话：「**前置条件**：先闭合 A-1（否则拆出来的 C3b 带一个错误前提），**以及 B-1**（否则 C3c 里带类型错误的测试）」。spec §8 只写了 CR-F04。 | §8 依赖注记改为「CR-F04（core2 A-1）**与 core2 B-1** 均应先于任何 rebase 类操作（OQ2 若选重排）」。 |
| **A-13**（低） | §3 deviations 表缺 wavea / c1 两行 | cr1-wavea.md §3 **D2**：「规范 §A6 ①b 期望净 −14，实测 +14/−20 = 净 −6 ⇒ **问题在规范的算式**…该条断言本身不自洽，建议规范侧改成『删除面 16 行 / 新增注释行数不限』」（报告 §4 第 6 条明写这是**规范文本缺陷**，不进本轮 Must-fix，但该进 deviations 表）；cr1-c1.md **D10**（C1-3 port 签名实现用 `options` 对象，spec 原文要三个位置参数，报告判「轻微偏离，更符合本仓风格，不改行为」）；cr1-c1.md **D25**（C1-7 I7 撞号决胜验收**无用例**，报告判「覆盖缺失但零风险」）。 | §3 增三行：wavea D2「A6 ①b 删除面算式不自洽（规范侧改写）」、c1 D10「C1-3 port 签名用 options 对象（轻微偏离，不改行为）」、c1 D25「C1-7 I7 撞号决胜验收零覆盖（SQL 未动，零风险）」。 |

### B · 失真（5 条）

| # | 位置 | 现状 | 照抄级建议 |
|---|---|---|---|
| **B-1** | §1 矩阵第 4 行 + §2.3 `**core2(4)**` 段头 | 矩阵写 core2 `0/2/4`；报告 §6.1 明写「**P2 5**：`B-1`、`B-2`、`C-2`、`C-3`、`C-4`」；§2.3 段头写 `(4)` 但段内实际列了 **5** 条 ⇒ 段头与内容自相矛盾。 | §1 矩阵第 4 行改 `0/2/5`；§2.3 段头改 `**core2(5)**`。 |
| **B-2** | §2.3 `**c2(4)**` 段头 | 段内只列 P2-2/P2-3/P2-4 **3** 条（P2-1 已升为 CR-F20），段头仍写 4，未注明去向。 | 段头改 `**c2(4，其中 P2-1 已升级为 CR-F20)**`。 |
| **B-3** | §1「合计 0 / 19 / 54」 | 逐行相加是 **20 / 54**，与合计不符；且未注明 P1 的 19 = 20 去重（F05 同源合并）、P2 的 54 = 55 − 1（c2 P2-1 升 F20）但 core2 又少算 1，两处误差恰好抵消。 | 合计行改为：`— | 合计 | — | — | **报告侧 0 / 20 / 55**；**去重后 CR-F 位 0 / 19 / 54**（P1 差 1 = c2 P1-1 与 ctests P1-1 同源合并为 CR-F05；P2 差 1 = c2 P2-1 升级为 CR-F20 CR-F20）`。 |
| **B-4**（最重） | §2.2 CR-F18 与 §4 OQ2 | 报告 cr1-core2.md C-1 原文：「**方案甲（推荐，保留历史）**：把 `4829b8d1` 用 `git rebase -i` / `filter-branch` 拆成六个 commit」——**报告推荐的是甲（rebase 拆分）**。spec 把甲乙都列了，但把「**方案乙（推荐）**」标在乙上，且 OQ2 默认案写「只记账」，**全文未注明这是主代理推翻报告推荐的改判**。用户若「整表确认」会无声地否决一条报告级推荐。 | CR-F18 行末改为：`方案乙（本 spec 改判为默认：**报告 cr1-core2 C-1 原标方案甲「推荐，保留历史」**；本 spec 因 19 commits 已过 cr-func 与基线验收、改判为不重写历史，改判理由见 OQ2，若用户不接受可直接切甲）`；OQ2 默认案括注补一句「**注意：报告侧原推荐 rebase 重排（方案甲）**」。 |
| **B-5**（轻） | §4 OQ13 | 议题列只写「Lint 步收口注释过期(X1 已盖 15 包, mobile 未收口)」，默认案「改注释为实况」；报告 wavea §2 OQ2 原问是二选一：「**是补 mobile 清账，还是把注释改成**「X1 已覆盖 15 个包，mobile 仍未收口」？」——另一案被裁掉且未注明。 | 议题列改为：`Lint 步收口: 补 mobile 清账(清零 27 error) or 把 ci.yml 注释改成实况`。 |

### C · 不可执行（2 条）

| # | 位置 | 问题 | 照抄级建议 |
|---|---|---|---|
| **C-1**（阻断） | §8 CR-W1 与依赖注记第 2 条 | §8 CR-W1 标题写「**组 I 全部**」，枚举却是 `CR-F01/02/03/04/05/07/08/09/10/11` —— **CR-F06（c2 P1-2，触发器守卫无索引、热路径全表扫）不在任何波次里**，是组 I 唯一被编排遗忘的 P1。同时依赖注记要求「CR-F06 与 CR-F20 同 commit 动土(OQ11)」，而 CR-F20 被排在 **CR-W5**，与 W1 交付的 F06 不可能同 commit ⇒ 该约束在现有编排下**物理不可满足**。 | ① CR-W1 枚举补 `CR-F06`（写作 `CR-F01/02/03/04/05/**06**/07/08/09/10/11`）；② 把 **CR-F20 的实现部分并入 CR-W1**（与 F06 同 commit 落），只把它的 ledger 注记留到 CR-W5；或把 F06 整体移到 W5 与 F20 同波；③ 依赖注记第 2 条补一句「OQ11 的两案**必须在同一 commit 内一次决定**，不可跨波拆」。 |
| **C-2**（轻） | §2.3 wavea 段 + core1/core2 段 | 条目号前缀丢失：spec 写 `P2-01..P2-06`，报告原文是 `WA-P2-01..WA-P2-06`（前缀 `WA-` 是唯一可 grep 的标识）；core1/core2 同理写成 `C-2`/`B-1`，报告原文是 `cr1-core1/C-2`/`cr1-core2/B-1`。按索引号在报告里搜命不中。 | §2.3 wavea 段条目号统一补前缀为 `WA-P2-01..WA-P2-06`；core1/core2 段统一补 `cr1-core1/C-2`、`cr1-core2/B-1` 形式（其余 8 份报告的 `P2-n` / `P1-n` 原样即可，勿一并改）。 |

---

## ④ verdict

**not-ready** —— P1/P2 主干 73 条（20 P1 + 55 P2）已 100% 收录且抄录准确，但存在 **3 条阻断级漏收**（core2 OQ-1 mobile 删除死路未拍板、CR-F01 唯一回归锁断言缺失、core1 OQ-3/OQ-4 悬空定级被隐式当作已定级）、**1 条实质性失真**（OQ2 把报告推荐的 rebase 重排改标为「方案乙推荐」且未注明改判）、**1 条编排不可执行**（CR-F06 落在任何波次之外，且与 CR-F20 的「同 commit」约束冲突）、以及**计数口径不自洽**（core2 少算 1 条、合计 19/54 与逐行 20/54 不符）。上述 A-1/A-2/A-3/B-4/C-1 修完并复核后可再判 fix-spec-ready；A-4~A-13、B-1~B-5、C-2 建议同批一并照抄修掉。

`done | raw/cr1-full.md | not-ready | 漏收 13 / 失真 5 / 不可执行 2 | CR-F06 落在所有波次之外且与 CR-F20「同 commit」约束冲突，另有 OQ2 改判未注明与 core2 OQ-1 删除死路整节漏收`
