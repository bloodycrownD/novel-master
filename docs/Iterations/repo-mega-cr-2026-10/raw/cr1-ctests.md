# CR 报告 · cr1-ctests（scope 模式 · 只读评审 · Wave C 测试牙齿）

## ① 元信息

| 项 | 值 |
|---|---|
| 节点 | `cr-c-tests`（code-review-loop · scope 模式 · review_round 1 / dag_version 1） |
| 仓库 | `D:\Dev\nm-worktree\mcr`（分支 `feat/repo-mega-cr`） |
| base_sha / head_sha | `fe79b781` / `046f4d9c` |
| 被审 commit | `759372c8`（Wave C 验收牙齿 + 吸收 cr-func 阶段 fix-C-tests 的 9 项 74 例） |
| 业务 spec | `docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-c1.md`、`wave-c2.md`（各条目「测试策略」/「回归线」两要素为对照基准） |
| 本 scope 域 | Wave C **测试文件本身的牙齿质量**：断言是否照 spec 测试策略落地、恒真/恒红断言、mock 边界、夹具是否真构造出被测状态、回归线/文档线更新是否如实 |
| 域外不判 | 生产代码实现正确性（src 侧归 cr-c1/cr-c2）、Kotlin（cr-kotlin）、性能量级本身（只看观测面设计） |
| 检查维度 | ① 断言方向性（改坏实现会不会红）② mock 边界（mock 掉的是被测物还是环境）③ 夹具真实性（17→18 换代路径、backfill 事务面、JOIN 对拍是否真走到对拍分支）④ 对拍/oracle 设计（LCS oracle 是否可能恒等）⑤ 零收集/探针排除已知坏行的口径 |
| 重点核对 | `vfs-import-shard` A1–A6、`vfs-zip-parse-limits` H1–H6、`vfs-gc-trigger` 守卫 + 17→18 升级、`backfill-transaction-scope` B1/B2/B3/B5、`backfill-gap-index-join` F1/F2/F3、`backfill-abort-signal` 5+1 改写清单、`vfs-batch-io` T-B6/T-B6b/c/d、`vfs-batch-ingest-revision-alignment` D1/D2/D3/D5、`longest-common-substring` S1–S4、`message-visibility` G1–G3 |
| 实跑 | `vfs-zip-parse-limits` + `longest-common-substring` + `backfill-transaction-scope` + `backfill-gap-index-join` 四文件直跑：`# tests 26 / # pass 26 / # fail 0`（本轮交付的牙齿确实都在跑、都在绿） |
| 反向验证 | 两个临时探针（`tmp/`，已删除）：① 合法大体积 ZIP 是否真能解析成功；② B2 用例的故障注入是否真被触发。工作树 `git status --porcelain` 除既有未跟踪项外无改动，无任何 git 写操作 |
| 写入 | 禁改代码/禁改 spec/禁 git 写。本报告为唯一落盘物；临时探针已删除 |

---

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

## ③ Should-fix 与观察项

- **A2 的计数口径脆**（`vfs-import-shard.test.ts:111`）：用「事务内 SQL 文本含 `INSERT INTO vfs_revision` 的条数」代替 spec A2 要求的「spy `insertFileSeedingRevision` 调用次数」。当前是对的（注释也解释了「revision 行数 == 片内文件数」），但实现一旦把 revision 批量写成 `conn.batch()`，探针按**一次调用**计（`transaction-probe.ts:102-110`），`perShard` 会从 `[200,200,50]` 塌成 `[1,1,1]` 而**假红**。口径本身有牙（不是恒真），只是对实现形态过度敏感。建议注释里补一句「若实现改用 batch，需同步改口径」。
- **GC 守卫断言自指生产常量**：`vfs-gc-trigger.test.ts` 三处 `String(found!.sql).includes(VFS_BLOB_GC_ENTRY_GUARD_SQL_FRAGMENT)` 直接引用 `src/bootstrap/vfs/vfs-revision-schema.ts` 导出的常量。常量一旦被清空/改名但触发器 SQL 未变，断言会跟着空转。这是「用同一真源断言同一真源」的固有代价，可接受，但建议**额外钉一条字面量**（如断言 trigger SQL 里出现 `vfs_entry` 字样），让守卫常量被清空时也能红。
- **`T-AMT3` 的冗余断言**（`anthropic-max-tokens-budget.test.ts:100`）：`assert.equal(params.anthropic.budget_tokens, 1)` 之后紧跟 `assert.ok(params.anthropic.budget_tokens < 1 + 1)`——后者是前者的子集，且刻意写成 `1 + 1` 绕开字面量。无害但会让人怀疑是不是在躲某条静态检查；建议删掉后者。
- **B1 隐含「backfill 必是最后一条事务」**（`backfill-transaction-scope.test.ts:104` 取 `transactionCount - 1` 当 backfill 段）：当前段序（B0 → 文件片 → R → backfill）下成立，将来若把段 R 挪到 backfill 之后，会**假红**且报错信息指向完全错误的业务语义。建议改成「找那条含 `message_checkpoint` 的事务」，或至少在注释里写明这个前提。
- **LCS oracle 的重样本**：`longest-common-substring.test.ts:145-150` 的 `1200 × 1200` 样本会让 oracle（`referenceLongestCommonSubstring`，全表 `number[][]`）分配约 144 万格 × 行数组，实测四文件直跑仍在预算内，但在并行 worker + 低内存机器上有 GC 噪声/超时风险。可给该样本单独一个 `it` 或降到 `600 × 600`（并列最长性质不变）。
- **零收集/探针排除口径**：`transaction-probe.ts` 只包业务调用面、不记 `BEGIN`/`COMMIT`，`batch` 按「一次调用」计——两处都在文件头注释里写清了，与验收口径一致，无问题；本轮四文件实测 `# tests 26`，未发现空跑或探针排除已知坏行的情况（`core` 终态 3291/3 的口径由总控掌握，本 scope 不重复核）。

## ④ 结论 · verdict

**牙齿覆盖率（spec「测试策略」要素 N 条中断言实落 M 条）—— 按条目逐条对账**：

| 条目 | spec 测试策略要素 | 实落 | 备注 |
|---|---|---|---|
| C2-1 导入分片 | 7 | **6** | Z5/G-1/T-B6 三条回归线已按 A-4/A-8 改写并加反向断言（质量好）；T-Z10/T-I5 用例名未按 A-15 收口（P2-4③） |
| C2-2 backfill 移出事务 | 4（B1/B2/B3/B5）+ abort 改写清单 | **3 + 改写全落** | B2 第一条注入空转（P1-2）；abort 改写 5+1 与三个弃权点全覆盖，逐条对得上 |
| C2-4 CS-06 revision 对齐 | 5 | **5** | D1/D2/D3/D5 + 幂等，直查表口径，ref_count 逐条断言，有牙 |
| C2-5/CS-07 blob GC 守卫 | 5 | **5** | DELETE/UPDATE/无守卫回收/旧名 DROP/17→18 升级路径，夹具真造出「无守卫旧名触发器 + user_version=17」并两向验守卫生效与回收 |
| C2-6 JOIN 定位 | 3 | **3** | F2 的 oracle 是真倒扫参考实现（结构不同、非恒等）；F1 的 `≤ gap 长度` 期望正确避开了「恒 0」陷阱 |
| C2-7 头投影 | 3 | **3** | G1 列集硬编码 6 键 + G2 四个 offset + G3 按 SQL 文本判零解析，稳定观测面 |
| C2-8 ZIP 闸 | 5 | **4（1 条半落）** | H2 堆增量恒真（P2-2）；**另缺 spec 未写但事故高发的「合法大体积正向」维度（P1-1）** |
| C2-9 checkpoint 900 分块 | 3 | **0** | 文件未建（P2-3） |
| C2-10 CD-01 rollback | 4 | **1** | R1 已补（落点偏但等价）；R3/R4/R5 文件未建（P2-3） |
| C2-11 LCS | 4 | **3** | S1/S2/S3 实落且 oracle 有牙；S4 未落（P2-1） |

**合计：38 条要素 → 断言实落 32 条（另 1 条半落、1 条半改）。**

**方向性总评**：本 commit 的牙齿**整体质量高、恒真断言少**，最亮眼的三处是——① `transaction-probe` 这个观测面选得对（事务计数 + 事务内语句清单，结构稳定，不随读口更换静默失效），并配了「对照组」防恒真（`countVfsEntryWrites(probe,1) > 0`、`smallStmts > 0`、`deletes` 前后对比）；② CS-07 的 17→18 升级路径**没有**只断言「bootstrap 后触发器带守卫」，而是把库压回 17 的形态再跑慢路径，并同时钉「守卫生效」与「不漏删」两向——这是本轮最扎实的一段；③ 回归线更新**如实**：Z5/G-1/T-B6 三条的用例名与断言都按新语义改了，而且都补了「未到失败片的文件不得进 `written`」这类反向断言，没有偷懒留旧名。

**放行建议**：P1-1 与 P1-2 建议本轮修掉（一个是真 bug 已经在生产里、测试却在假绿；一个是注入根本没生效的假牙），P2-1～P2-4 可并入下一次迭代，但 P2-3 的 I3（900 分块主牙齿）建议尽快补——它是 CS-10 目前**唯一**能挡住「分块常量被人改坏」的断言。