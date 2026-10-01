# CR Fix Spec: message-plaintext 明文化+技能引用化

## 元信息
- repo：`D:\Dev\nm-worktree\f-read-ref`（分支 feat/read-tool-result-ref）
- base_sha / head_sha：5e644277 → 547ee6ab
- spec_path：`docs/Iterations/message-plaintext/spec.md`
- review_round：5（r1=wave-1 六 scope；r2=双路 No-Go → doc-fix；r3=No-Go → doc-fix；r4=No-Go（cr-p2 NESTED_TRANSACTION 契约冲突）→ doc-fix；r5=**Go**，剩余 5 条 P2 措辞精度已由主代理顺手回填）
- dag_version：5
- 状态：**fix-spec-ready（CR loop 终态）/ execute-ready（spec-check loop 终态），待用户确认后可开工执行**

> 审查账目：wave-1 六 scope（core-write/decompress/skill-ref/ends-doc/perf/safety）+ cr-func 终验 dev-ready → 落盘 23 条；r2 双路复审（review-full CR 维度 + spec-check judge 文档可执行性维度）发现 **3×P0 全在 cr-e1/cr-d1 的改法本体**（DDL rowid 不可索引实测报错 / 索引落点对存量库 no-op / slack 口径照字面实现治不了病）+ 3×P1 + 6×P2，已回填；r3 复审再抓 **3×P0**（`#{...}` 数组绑定与 sql-template 求值器硬冲突 → raw-SQL 拼接 / LIKE 粗筛撞 spec.md:32 边界条款 → cr-f14⑨ 显式翻转 / 索引「先例」实在慢路径内不可照抄位置 → 落点改事务外无条件段）+ 2×P1 + 4×P2，已回填；r4 复审 **9/9 项回填核实通过**，再抓 **1×P0**（cr-p2 的 `this.conn.transaction` 嵌套在 fork/copy 生产路径必抛 `NESTED_TRANSACTION`——两个生产调用方本就在外层事务内、repo 持有的就是 tx 句柄，而测试在事务外直调会全绿掩盖故障；r2「自锁」与 r3「独占窗口」论证前提均错 → 改 runInTransactionOrConn 模式 + 补嵌套路径用例）+ 1×P1 + 7×P2，已回填。三轮复审的 P0 全部收敛在「改法与代码/规格的硬冲突」上，逐轮收敛、无震荡。

## Must-fix

### P0

> 账面说明（round-4）：r3 抓的另两条 P0（`#{...}` 数组绑定硬冲突 / LIKE 粗筛撞 spec 边界条款）已分别并入 cr-d1 改法②、cr-p3 改法③与 cr-f14⑨ 承载，不单列条目；r4 抓的 P0（NESTED_TRANSACTION 契约冲突）并入 cr-p2 改法承载。本段仅 cr-e1 一条独立 P0。

#### cr-e1 [P0] 自愈探测是全表扫描：加部分索引 + 订正「索引级」失真措辞
- 维度：E / B / A（**定级主论据是 spec 违背**：spec.md:58 与代码注释对外承诺「索引级探测、与零成本短路同档」，实测是全表扫描——宣称失真必须修；性能为次要论据，实测稳态探测 0.24ms@5000 行，量级不大但 CLI 每条命令都付）
- 文件：`packages/core/src/bootstrap/novel-master-bootstrap.ts:346-367`（bootstrap 快慢路径与 `idx_chat_session_parent` 先例）、`packages/core/src/infra/db-maintenance/impl/message-content-decompression.ts:236-248` + 文件头 `:24-27`、`spec.md:58`
- 问题：`hasPendingRows` 的 `LIMIT 1` 谓词列 `content_blob` 无索引（表上只有 `idx_chat_message_created_at` 与 `UNIQUE(session_id,seq)`），实测 query plan 为 `SCAN chat_message`。稳态（全部搬完、零命中）恰是必须读完整棵 b-tree 的形态，且是每次进程启动的固定支出（desktop main ready / mobile 延迟 3s / CLI 每条命令）。注释与 spec 均宣称「索引级、与零成本短路同档」，前提不成立。同一无索引谓词也命中 `countPendingRows`（:180）与批查询（:365）。
- 改法（round-2 修订：DDL 列名与落点通道均经实测修正）：
  1. 索引 DDL：`CREATE INDEX IF NOT EXISTS idx_chat_message_pending_blob ON chat_message(id) WHERE content_blob IS NOT NULL;`——**必须用 `id` 不能用 `rowid`**（rowid 不可显式建索引，SQLite 报 `no such column: rowid`；也不要用 `ON (content_blob)`，会把 blob 字节复制进索引白增体积）。实测 `ON chat_message(id)` 后探测 plan 走 `USING INDEX`、5000 行探测 2000 次从 486ms→10.8ms、体积 +1 页；`countPendingRows` 的 COUNT 同步走索引；批查询仍走 rowid 主键不受拖累。
  2. **落点通道（round-3 修订：先例在慢路径内不可照抄位置；round-4 补失败语义）**：`bootstrapNovelMaster` 的快路径是**提前 return**（novel-master-bootstrap.ts:348-355，`bootVersion >= SCHEMA_BOOT_VERSION(=17)` 即 return），`idx_chat_session_parent` 先例（:365）位于该 return **之后**——只在慢路径执行，真实用户库（user_version=17）永远到不了。因此落点是 **bootstrap 事务之外的无条件段**（与 :376 `seedBuiltinSkills` / :385 发号器安全网同一层）：`await conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_message_pending_blob ON chat_message(id) WHERE content_blob IS NOT NULL")`——**与 idx_chat_session_parent 同款的幂等建手法，但落点在事务外**（先例位置不可照抄）。**失败语义（round-4）**：与同层两处的「try/catch 失败仅记日志不阻断启动」策略**有意不同**——本条**不包 try/catch、fail loud**（静默吞掉建索引失败会让探测永久退回全表扫且无痕迹），注释里写明这个差异的理由。新库慢路径跑完语句集后也会经过这段，`IF NOT EXISTS` 幂等；不 bump `SCHEMA_BOOT_VERSION`、不注册 schema migration（纯 DDL 幂等建非数据搬运，与空占位禁令不冲突）。
  3. `:239-241` 与文件头 `:24-27` 注释、`spec.md:58` 措辞改为与实现一致（「部分索引上的存在性探测；稳态索引空」）。**round-4 口径钉死**：全仓「索引级」共 5 处——impl 文件头 `:27`、`:240`、`:311`、`test/.../message-content-decompression.test.ts:593`、`spec.md:58`；本条改 `:27/:240` 与 `spec.md:58` 三处，`impl:311` 与 `test:593` 两处在索引落地后语义成立、**可不改**（一次钉死，执行者勿反复纠结）。
  4. spec 的 V1' 退役清单补一条：退役时删除该索引（bootstrap 循环外那两行一并删）。
  5. **执行期偏离记录（fixA，合理采纳）**：无条件段建索引前加一道 `pragma_table_info` 前置判定——`content_blob` 列缺失的库（pre-1.4.27 老库形态，T-C10 负面教材演示过）直接跳过建索引（那种库探测退回全表扫只是慢，不该让 App 起不来）；列在则照建、建失败仍 fail loud。连带：T-C10「快路径零 DDL」不变量按「有且仅有那条幂等部分索引 DDL」收紧断言。
- 验收/测试：在 `user_version = SCHEMA_BOOT_VERSION` 的存量库上 bootstrap 后 `sqlite_master` 能查到该索引（**快路径断言**，不是慢路径）；`EXPLAIN QUERY PLAN` 显示探测与 `countPendingRows` 走 `idx_chat_message_pending_blob`；**批查询 EXPLAIN 一并钉住**（实测改后仍 `SEARCH ... USING INTEGER PRIMARY KEY (rowid>?)` 不受拖累，防回归）；decompression 既有测试全绿。
- 来源：cr-w1-perf/E-1 + cr-w1-decompress/B-2 + cr-w1-safety/B-2（三 scope 同源合并）；round-2 修正当量：review-full/E-1（rowid DDL）+ review-full/H-1（快路径 no-op）+ spec-check judge P0-1/P0-2（同两处，实测复核）

### P1

#### cr-d1 [P1] 入口自愈探针与「坏行不阻断标记」相斥：永久坏行导致每次启动白扫两遍全表
- 维度：B
- 文件：`packages/core/src/infra/db-maintenance/impl/message-content-decompression.ts:243-248`（hasPendingRows）、`:312-338`（入口自愈）
- 问题：探针谓词是裸 `content_blob IS NOT NULL`，不排除已知坏行；而坏行按设计永留谓词（`:472-479`「坏行不阻断标记」）。永久解不开的坏行 ⇒ 每次冷启动：标记命中 → 探针必命中（坏行还在）→ 清标记 + warn → 从 rowid 0 全表 keyset 扫描 → 再撞同一坏行 → `failedKeys.size=1` → 重置标记。永不收敛，`:473-474` 注释自己声明要避免的形态被探针请回来了。
- 改法（round-3 重写：NOT IN 的参数绑定方式与该仓 sql-template 硬冲突——`placeholder.ts:23-25` 的 `renderBind` 对 hash 节点恒返回单值 `parameters:[value]`，数组不展开；实测 better-sqlite3 数组绑定 >1 元素抛 `RangeError`、0 元素 `NOT IN ()` 语法错，恰 1 元素侥幸能跑。改走 raw-SQL 占位拼接）：
  1. **marker 增持久化坏行 id 清单**：`decompressDone` 的 value 从 `{at, failedCount}` 扩为 `{at, failedCount, failedIds: string[]}`（写标记处 `:475-479` 把本轮 `failedKeys`（`:346` 的 `Set<string>`，作用域内可直接 Array.from）落进去；坏行本就少量，不设上限）。**向后兼容钉死**：读标记时 `failedIds` 缺失或非数组 → 视空数组（已落地的 `{at, failedCount}` 形态——云同步带回/已发版本——必须兼容；`test/.../message-content-decompression.test.ts:472` 硬编码 `JSON.stringify({at, failedCount: 0})` 的既有用例在该规则下**无需改、保持绿**）。
  2. **探针带排除（raw-SQL）**：`failedIds` 非空时 `const qs = failedIds.map(() => "?").join(",")`，SQL 拼 `... AND id NOT IN (${qs})`、参数尾接 `failedIds`（贴合本文件既有 raw-SQL 风格、零新依赖——该文件未引 SqlTemplateParser）；空清单走原谓词分支（不加 NOT IN）。**不要**写成 `id NOT IN (#{...})`——模板 hash 绑定只支持单值。只剩已知坏行 ⇒ 探针不命中 ⇒ 标记保留短路；外来标记的 failedIds 与本库不符 ⇒ NOT IN 不影响扫描结果 ⇒ 真待搬行照常命中、自愈保留。**批查询与收尾不变量（leftover > failedKeys.size）一律不动**。
  3. 测试适配（round-3 订正）：`test/infra/message-content-decompression.test.ts:245-246` 的 `isSelfHealProbe` 正则中间是 `[\s\S]*`，新增 `AND id NOT IN (...)` 后**仍然匹配——实测无需改动，勿动**（round-2 说「它是第一个红的」是误判）；T-MP-P2（:590-594）与 T-MP2 标记自愈（:462-493）按新探针语义复核适配。
  4. spec Part 2 的 marker 形状 `{at, failedCount}` 同步扩字段（并入 cr-f14 回填清单）。
- 验收/测试：①永久坏行 + 完成标记，两轮冷启动断言标记不被清、不重复 warn；②带 failedIds 的标记 + 库里另有 1 条真压缩行，断言探针仍命中清标记（自愈不被坏行清单掩盖）；③**failedIds 长度 0 / 1 / 2 三档各一例**（1 档是单占位符「侥幸能跑」形态，必须钉住）；④`{at, failedCount}` 无 failedIds 的旧标记读回视空数组（向后兼容）。
- 来源：cr-w1-decompress/B-1；round-2 修正当量：spec-check judge P0-3 + review-full/B-1（弃 slack 改 id 清单）；round-3 修正：judge P0-1（`#{...}` 数组绑定硬冲突 → raw-SQL 拼接）+ P2-1（isSelfHealProbe 实测无需改）+ P2-2（marker 向后兼容钉死）

#### cr-s1 [P1] 搬运闸门：decode 成功但内容非法的行被当成功，唯一压缩副本被不可逆销毁
- 维度：B（数据完整性）
- 文件：`packages/core/src/infra/db-maintenance/impl/message-content-decompression.ts:379-411`（核心 :404-411 UPDATE）
- 问题：行级动作是 `decodeMessageContent(...)` → 无条件 `SET content_json=<解压结果>, content_encoding=NULL, content_blob=NULL`。`decodeMessageContent`（`message-content-codec.ts:42-65`）只做 inflate + TextDecoder，不校验产物是合法 MessageContent JSON。已实测 fflate `unzlibSync` **不校验 adler32**：bit 翻转的 blob「解码成功」吐垃圾。后果：被污染 blob 的垃圾写进 `content_json`、原始压缩字节置 NULL 销毁——迁移前读路径 fail-fast 但字节可恢复，迁移后行永久不可读（`parseMessageContent` 抛 Invalid JSON）。这是本次改动引入的**不可逆数据丢失路径**（正向压缩任务的源本就是应用写出的合法 JSON，无此不对称；反向任务的源是不可信库内字节）。
- 改法：UPDATE 前加合法性闸门，把「解压成功但内容非法」归入既有坏行隔离：
  ```ts
  plaintext = decodeMessageContent(row.content_encoding, row.content_blob, row.id);
  // 反向任务的源是不可信库内字节：inflate 成功 ≠ 内容合法
  // （fflate 不校验 adler32，bit 翻转静默产出垃圾）；不校验就写回
  // = 把唯一压缩副本销毁成不可读行，不可逆。
  parseMessageContent(plaintext);  // 失败走既有 failedKeys/failedCount/warn 分支
  ```
  补夹具 `insertInflatableGarbageRow`（`compressZlib(new TextEncoder().encode("not json at all"))`）：断言该行 `content_blob` 原样保留、`content_json` 仍 `''`、`failedCount` 透传。
- 验收/测试：新用例绿；T-MP3 既有「inflate 直接抛」坏行用例不回归。
- 来源：cr-w1-safety/B-1

#### cr-g1 [P1] 骨架用例覆盖回退：四组承重分支无测试
- 维度：G
- 文件：`packages/core/test/infra/message-content-decompression.test.ts`
- 问题：与被删的 `message-content-compaction.test.ts`（base 5e644277）比对，四组成例丢失：①零进展护栏（`ZERO_PROGRESS_BATCH_LIMIT=3` → stalled、不置标记）——现有 T-MP2 只走收尾校验分支，护栏代码零覆盖；②批内第 N 行 UPDATE 抛错 → 中间态可读、重启收敛（T-MP2b 的 `syncBudgetMs:0` 是干净批边界，不是批内炸——后者恰是 e2e 实撞的 `database is locked` 形态）；③`shouldPause` 批间守卫三端无人验证；④游标严格单调/每行恰被选中一次（250 行）弱化为只断言 `cursors[0]===0`。
- 改法（复用文件内现成脚手架）：①`wrapConnChatUpdateNoEffect("all")` 造 ≥300 行让 3 批全 `changes=0`，断言 `stalled=true`/无标记/零搬运；②加「第 N 个 id 抛 database is locked」替身，断言异常外传不吞、前 N-1 行已落库、marker 未置，再跑一轮断言收敛全等；③`{shouldPause:()=>true}` 断言 done=false/stalled=false/零 UPDATE/marker 未置；④≥250 行断言 cursors 严格单调 + 每 id 恰一次。
- 验收/测试：四条新用例绿。
- 来源：cr-w1-decompress/G-1

#### cr-c1 [P1] T-MP4 漏 searchMessages：迁移期压缩分支全仓零覆盖
- 维度：G + A
- 文件：`packages/core/test/chat/message-plaintext-write.test.ts:214-271`
- 问题：spec T-MP4 验收点明列 listBySession / searchMessages / tail 三路，落地用例漏 searchMessages；且 `batchInsert` 改明文后 `message-search.test.ts` 全部行变明文行，searchMessages 的压缩分支在双形态迁移期**全仓零覆盖**（原被生产写路径顺带覆盖，现被净抹掉）。
- 改法：T-MP4 用例尾追加（复用已造 4 行混存库）：
  ```ts
  const hits = await repo.searchMessages(sessionId, { keyword: "形态", limit: 10 });
  assert.deepEqual(hits.map((m) => [m.seq, m.content]), [
    [2, plainContent],          // seq DESC：明文行在前
    [1, compressedContent],     // 压缩行解压还原
  ]);
  ```
- 验收/测试：断言绿（两种形态都被召回且各自解出正确正文）。
- 来源：cr-w1-core-write/G-1

#### cr-p1 [P1] CLI 把搬运 await 进启动关键路径：最坏 ~120s 阻塞
- 维度：E + A
- 文件：`apps/cli/src/runtime.ts:191-195`（`:191-194` 是把「双任务各 60s、最坏合计 ~120s」写成事实陈述的注释块——**改法必须连注释一起改**，否则改完当场变假；`:195` 是 `await runMessageContentDecompress(conn)` 未传 options。round-3 订正：`:125` 是 `export interface NovelMasterRuntime` 与参数无关；`syncBudgetMs` 参数声明在 `message-content-decompression.ts:125`）
- 问题：CLI 是三端唯一把搬运 `await` 进命令关键路径的（desktop/mobile fire-and-forget），且与归一任务串行，两个 60s 预算最坏合计 ~120s 阻塞命令执行。spec 矩阵 CLI 行只声明了读语义，写侧挤占无声明无护栏。
- 改法：CLI 侧调用传显著更小的 `syncBudgetMs`（建议 5s，交互式进程不该独占 60s），剩余留给下次命令；`:191-194` 注释同步改为「解压 5s + 归一 60s、最坏合计 ~65s」；spec 矩阵 CLI 行增「启动关键路径」写明最坏预算——**连带 spec.md:72 两处**：「内联 await runMessageContentDecompress(conn)（默认预算）」一句改述 + 位置引用 `apps/cli/src/runtime.ts:10,187` 订正为 `10,195`（`:187` 是 `conn = await open(...)`，round-4 核实）。
- 验收/测试：cli tsc 0 错；spec 补行；`grep -n "120s\|约 120" apps/cli/src/runtime.ts` 0 命中。
- 来源：cr-w1-perf/E-2（round-2 删冗余兜底；round-3 行号订正；round-4 修正：judge P1-B——注释块连带 + spec.md:72 位置引用订正）

#### cr-p2 [P1] batchInsert 峰值内存未按片摊开 + 注释过度承诺
- 维度：E + C
- 文件：`packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:403-421`（与 `:170-178` 的 chunk 注释——**两处是同一逻辑的两段说明，一次改写覆盖，勿分两遍改**）
- 问题：`parameters` 数组跨所有分片累积、循环结束后一次 `conn.batch` 下发——峰值内存仍是全会话明文 ×1，「按片摊开」承诺与实现不符（spec 风险表「×1 已接受」本身诚实，是代码注释过誉）。且 `yieldFn` 仅 mobile 注入，desktop/CLI 上 `await this.yieldFn?.()` 只让出 microtask。
- 改法（round-4 重写：round-2「conn.batch 自锁」与 round-3「独占窗口扩 ~400ms」两个论证的前提都错了——**`this.conn` 在生产路径本来就是 tx 句柄**：`batchInsert` 唯一两个生产调用方 `session.service.ts:352,396`（**copy**）与 `message.service.ts:381`（**fork**）都在 `conn.transaction(async (tx) => reposFor(tx)…)` 外层事务内调用，repo 持有的 `this.conn` 即 tx；`TdbcConnection.transaction` 契约明写嵌套抛 `NESTED_TRANSACTION`（connection.port.ts:37，三驱动强制、conformance suite:278-290 有锁，tx 句柄的 transaction() 无条件 reject 且不执行 fn）——照 round-3 写法 `this.conn.transaction(...)` 会当场打断 fork/copy，而测试（message-plaintext-write.test.ts:153 等）在事务外直调、全绿掩盖故障）：
  ```ts
  // 参数按片构造、按片下发：峰值内存 O(chunk)（spec 消费处矩阵 #7「全会话 ×1」随改成为历史）。
  // chunk 按下标区间切分 messages，不复制消息体（引用数组）。
  // this.conn 可能是根连接（测试直调）也可能是事务句柄（生产 fork/copy 在外层事务内
  // 调 batchInsert）——嵌套 transaction 抛 NESTED_TRANSACTION，必须运行时判定而非静态假设，
  // 照抄 revision-aware-vfs.service.ts:299-315 的 runInTransactionOrConn 惯例（**该函数是模块
  // 私有未导出**：提取为公共 helper 导出，或在本文件复制一份）：
  //   try { await conn.transaction(fn) }
  //   catch (e) { if (e instanceof TdbcError && e.code === "NESTED_TRANSACTION") return fn(conn); throw e; }
  // （兜底只针对 conn.transaction() 入口抛出的 NESTED_TRANSACTION——fn 内部若将来自行抛
  //  该码会被误判重跑、已执行的 INSERT 会重放，注释钉死此边界。）
  await runInTransactionOrConn(this.conn, async (c) => {
    for (const chunk of chunks) {
      const parameters = chunk.map(toMessageParams);   // 按片构造，峰值 O(chunk)
      await c.batch(MESSAGE_INSERT_SQL, parameters);
      await this.yieldFn?.();                          // 让步语义照旧（mobile 注入时让出、desktop/CLI 退化为 microtask）
    }
  });
  ```
  **取舍登记（round-4 重写）**：生产路径（fork/copy）连接本就被外层事务独占整段（`copyVfsTree`/`adjustReadRefCount` 同事务），本改法**不新增独占窗口**——根连接路径（测试直调）则与原单次 batch 一样包一层小事务、原子性等价。真正的变化只有峰值内存从全会话 ×1 降为 O(chunk)。`:170-178` 与循环处注释一次改写成与实际语义一致（含 desktop/cli 缺省 yieldFn 的退化说明）。
- 验收/测试：①既有 fork/copy、明文写用例全绿；②**新增用例：`await conn.transaction(async (tx) => { await new SqliteMessageRepository(tx).batchInsert(rows); })` 复刻生产路径**（等价于服务层 `reposFor(tx)` 的形态——后者是 session/message.service 文件内私有函数测试 import 不到，直接 new repo 即可；better-sqlite3 根连接真 BEGIN、嵌套被拒后回落 `fn(tx)` 直通、外层提交，断言不抛 NESTED_TRANSACTION 且插入完整）——没有这条，嵌套判定被移除时测试照样全绿（round-4 抓到的盲区）。
- 来源：cr-w1-perf/E-3；round-2 修正当量：spec-check judge P1-3（自锁论证，前提有误但触发了 tx 语义审查）+ P2-5；round-3 修正：judge P1-2（独占窗口登记，前提有误）；round-4 修正：judge P0-A（NESTED_TRANSACTION 契约 + 生产调用方在事务内 → runInTransactionOrConn 模式 + 嵌套用例补盲区）

#### cr-p3 [P1] 搜索 / usage-stats 全量 parse 无粗筛：明文化后 parse 成主导项未设防
- 维度：E + G + A
- 文件：`packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:544-586`（spec 消费处矩阵「搜索」行）、`packages/core/src/service/chat/impl/usage-stats.service.ts:512-539`（**注意路径是 `service/chat/impl/`，不是 `domain/chat/service/impl/`**——round-1 写错的路径已订正，行号 :512-539 是 assistantRows 逐行 decode+parse 循环、正确）
- 问题：搜索走按段全量拉取 → 每行 JSON.parse + 全量块校验 → 内存精筛（`scanLimit=max(limit*20,200)`），5350 行库一次罕见关键词搜索 = 5350 次 parse，零性能护栏；usage-stats 现算同源。矩阵只算了「inflate 消失」，没算 parse 成为主导项。
- 改法（round-3 修订：粗筛与 spec 边界条款的关系明确为「边界翻转，须回填」；守卫补非 ASCII 方向）：
  1. 谓词：`AND (content_blob IS NOT NULL OR content_json LIKE '%' || #{keyword} || '%')`——压缩行保守放行；明文行 LIKE 命中才 parse。`#{keyword}` 单值绑定与本仓 sql-template 一致、SQLite 合法。
  2. **召回守卫（红线：召回不得小于全量精筛，:537-538 自订）**：内存判据 `messageMatchesKeyword`（message-content-match.ts:39,44）是 **Unicode 感知**的 `toLowerCase().includes()`；SQLite 内建 LIKE 只对 **ASCII** 折叠大小写——实测正文存 `ÄRGER Öl`，`LIKE '%ärger%'` 命中 0（内存判据命中）。两个方向都要堵：①JSON 转义（keyword 含 `"` `\` 控制字符时 block.text 原字符 vs content_json 里 `\"`）；②非 ASCII 大小写（LIKE 折叠不到 Unicode）。守卫统一为：**keyword 命中 `/["\\\x00-\x1f]/` 或含任何非 ASCII 字符（`[^\x00-\x7f]`）时不加粗筛**（退回现状全量精筛），否则加。**`%` / `_` 属 LIKE 通配符，只会造成过宽（多 parse 几行、内存精筛再滤掉），不影响召回红线，不拦**（round-4 钉死，勿当遗漏自行加拦截）。
  3. **spec 边界翻转回填（round-3 新增，归 cr-f14⑨）**：spec.md:32「不做 searchMessages 的 LIKE 恢复……全量精筛路径零改动」与本条粗筛字面冲突——按「召回语义仍以内存精筛为准、LIKE 仅作 parse 前性能粗筛（压缩行放行、转义/非 ASCII 退回全量）」改写；矩阵「搜索」行「LIKE 不恢复（边界）」同步改述；`docs/apm/RULE.md:33`「searchMessages 仍全量精筛（LIKE 恢复是独立优化项）」同步；OQ⑩ 收窄为「LIKE 召回/分词召回不做」。
  4. usage-stats 同手法评估适用性：该路径无 keyword 语义——**若评估后跳过，在 `usage-stats.service.ts:512-539` 循环上方留一行实现注 `// 无 keyword 语义，无粗筛面：全量 parse 为固有成本` 作为验收 grep 目标**（不留无出口的开放分支，round-4 钉死）。
- 验收/测试：searchMessages 既有用例 + cr-c1 新断言全绿（压缩行/明文行都召回）；**新增两条：keyword 含双引号（`他说"好"`）仍召回；keyword 含非 ASCII 且大小写异形（`Ärger` vs 库存 `ÄRGER`）仍召回**（守卫生效退回全量精筛）。
- 来源：cr-w1-perf/G-1；round-2 修正当量：spec-check judge P1-1（路径错）+ P1-2（转义漏召回）与 review-full/B-2（同源、召回红线冲突）；round-3 修正：judge P0-2（spec 边界条款冲突 → cr-f14⑨ 显式翻转）+ P1-1（非 ASCII 大小写方向漏召回 → 守卫扩）

#### cr-sr1 [P1] T-SR2 sweep 前缀不匹配：断言恒真空转
- 维度：G
- 文件：`packages/core/test/chat/skill-result-ref.test.ts:344-352`
- 问题：用例宣称验证「sweep 不得误删被引用版本」，但传的前缀 `${SKILLS_ROOT}/sr2-skill-other` 与被引用技能路径不匹配，sweep 实际 no-op，`notEqual(refCountOf(...), null)` 恒真——没覆盖「live head 减到 0 后 GC 仍不删」的真正临界。
- 改法：前缀改 `${SKILLS_ROOT}/sr2-skill` 自身 + 三段式牙齿：①sweep 前 `refCountOf===1`；②sweep 后 `refCountOf!==null`（ref_count 归 0/1 两种情形都不得被回收）；③可选加 0 值边界变体（read 后不 edit、手工把 live head 减 1 再 sweep）。
- 验收/测试：断言绿且不再恒真。
- 来源：cr-w1-skill-ref/G-1

### P2

#### cr-f1 [P2] CHANGELOG 三处披露缺口
- 维度：A / F / D
- 文件：`CHANGELOG.md:11`
- 问题与改法（同条末补三句）：
  1. spec Part 2 :79 明确要求的「状态行从『已完成（压缩）』回到『进行中（解压回明文）』属预期，非 bug」未写（1.5.25~1.5.28 用户会当 bug 报障）；
  2. spec 消费处矩阵「云同步/备份」行 / 风险表 :231 要求的「导出耗时、云同步续租次数上升」未披露（体积变大已披露）；+36MB 是否写死数字待拍板（见 Open questions ①）；
  3. 库文件/备份里的正文现在是可直接阅读的明文（此前压缩只是省空间、不提供保密性）——半句成本极低。
- 验收/测试：`grep -n "状态行\|进行中\|明文" CHANGELOG.md` 三句各自可命中；无测试。
- 来源：cr-w1-ends-doc/A-1、A-2 + cr-w1-safety/D-3

#### cr-f2 [P2] `done` 字段注释与实现相反
- 维度：F
- 文件：`apps/desktop/shared/ipc-types.ts:1664`、`packages/core/src/infra/db-maintenance/impl/message-content-decompression.ts:113`
- 问题：两处写「已完成：标记已置且入口自愈探测未命中」，但采样快路径**刻意不做**探测（spec 实现期补充第 3 条）。DTO 公开契约注释误导维护者。
- 改法：统一为「已完成：KKV 标记已置位，或谓词计数为 0；本采样不做入口自愈探测（自愈只在搬运入口）」。
- 验收/测试：两文件 grep 旧短语「且入口自愈探测未命中」0 命中；core + desktop-main tsc 0 错。
- 来源：cr-w1-ends-doc/F-3（cr-func 遗留观察 1 同源）

#### cr-f3 [P2] 注释口径大扫尾：五处仍以「压缩为正形态」描述现状
- 维度：C / F / K
- 文件与改法：
  - `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:220-222`：listBySession 注释改陈述性口径（置位产物不必捞回；正文按形态分派，压缩行才需解压）；
  - `packages/core/src/infra/content-cache/logic/decoded-content-cache.ts:171-174`（**完整路径：infra/content-cache/logic/**，round-1 只给了文件名）：「压缩会话的可见文件集」→「单会话的可见文件集」；
  - `packages/core/src/bootstrap/chat/chat-schema.ts:48-53`：改为「明文为正形态：写侧直写 content_json，两列恒 NULL；两列仅迁移期存量压缩行为非 NULL（读路径双形态保留至 V1'）」；
  - `packages/core/src/bootstrap/schema-align/schema-column-alignments.ts:156-159`：「后台压缩任务」→「后台解压任务 runMessageContentDecompress」；
  - `apps/mobile/src/services/db-maintenance-busy.ts:4`：「消息正文压缩搬运」→「消息正文解压搬运」。
- 验收/测试：`grep -n "压缩会话\|压缩存储\|压缩搬运" <五文件>` 旧口径 0 命中；core tsc 0 错。
- 来源：cr-w1-core-write/C-1 + cr-w1-ends-doc/K-5、K-6 + cr-w1-core-write OQ1（编排方拍板纳入；round-2 补全路径：judge P2-2）

#### cr-f4 [P2] 三个 rename 文件丢行尾换行
- 文件：`apps/desktop/src/main/services/message-content-decompression.service.ts`、`apps/desktop/test/message-content-decompression-service.test.ts`、`apps/mobile/src/services/message-content-decompression.service.ts`
- 改法：各补行尾换行（rename 副作用，diff 里 `\ No newline at end of file` 消失）。
- 验收/测试：`git diff` 三文件无 `\ No newline at end of file`。
- 来源：cr-w1-decompress/C-1 + cr-w1-ends-doc/K-4（同源合并）

#### cr-f5 [P2] .gitignore 补漏（防误提交回归残留）
- 文件：`.gitignore`（:73 后）
- 改法：追加 `.nm-regr-tmp/`、`tmp-*.log`、`docs/Iterations/*/cache/` 三行；`git status --short` 应不再出现这些条目。
- 验收/测试：`git status --short` 输出为空或仅含预期文件。
- 来源：cr-w1-ends-doc/K-7（cr-func 遗留观察 3 同源）

#### cr-f6 [P2] 解压炸弹前置闸门
- 维度：D
- 文件：`packages/core/src/domain/chat/logic/message-content-codec.ts:52-57`、`packages/core/src/domain/vfs/content-store/logic/zlib-codec.ts`
- 问题：`decompressZlib` 无输出上限（实测 614KB blob 可膨胀 600MB）；且暴露面从「按需读」扩大到「启动即全量遍历」。注意 fflate 传小 `out` 缓冲**不抛错而静默截断**，不能当护栏。
- 改法（**执行期勘误（fixA 实测）：原「读 zlib ISIZE 尾字段」不可行——zlib 流根本没有 ISIZE 字段（那是 gzip 概念），fflate `zlibSync` 只追加 4 字节 adler32，照原方案读 `[len-8,len-4)` 读到的是 adler32、每一行正常压缩行都会被误判成炸弹（首轮 19/19 全红实锤）。改为流式有界解压**：zlib-codec.ts 新增导出 `decompressZlibBounded(compressed, maxBytes)`——输入按 4KB 切片喂流式 `Unzlib`，两道闸（累计产出超上限、按已观测膨胀比投影剩余输入潜在产出，炸弹在第一片收手，实测 73MB 膨胀炸弹 RSS 峰值从 ~52MB 收到 ~4MB）；正常消息一段读完零额外开销。阈值 64MB、类型化错误、坏行隔离保留原字节。五轮审查均未抓住此处，作为 spec 勘误记录。
- 验收/测试：新用例——构造真 70MB 膨胀的压缩行，断言 decode 抛错、坏行隔离保留原字节。
- 来源：cr-w1-safety/D-1（执行期勘误：fixA 实测 fflate 源码 `wbytes(d, d.length-4, a.d())` 无 ISIZE 写入）

#### cr-f7 [P2] skill 引用四条测试补齐
- 维度：G
- 文件：`packages/core/test/chat/skill-result-ref.test.ts`、`apps/desktop/test/message-blocks-read-ref.test.ts`
- 改法：
  1. T-SR1b 跨域同名：global/project 两域各建同名 skill（内容不同），缺省域 read 断言 `ref.domain==="project"`；显式 `{domain:"global"}` 再读，断言两个 entryId 不等、两次 hydrate 各自等值（补 spec「两域夹具」缺口的实现侧）；
  2. T-SR8 dangling：拿到 skill read ref 后裸 `DELETE FROM vfs_revision WHERE entry_id=? AND version=?`，断言抛 `ReadResultHydrateError` code `READ_REF_REVISION_MISSING`——**断言只锁「message 含 skill read 语义片段」、不锁 locKey 字面量**（open question ⑨ 若将来改 locKey 格式，本用例不连带改——解耦，round-2 补）；
  3. 篡改：落库块 contentRef.contentHash 改成另一版本真实 hash，断言 `READ_REF_HASH_MISMATCH`；
  4. desktop 占位：kind:'skill' 块 → bodyText 含 `[skill ref: project/x-skill]` 且不含 `[read ref: ...]`。
- 验收/测试：四条新用例绿。
- 来源：cr-w1-skill-ref/G-2 + cr-w1-safety/G-1（同源合并；round-2 解耦 locKey：judge P2-6）

#### cr-f8 [P2] parseReadResultRef 的 kind 回构不对称
- 文件：`packages/core/src/domain/chat/content/parse-message-content.ts:189-202`（`parseReadResultRef` 的 return 对象——round-1 误指 :169-186 的校验段，已订正）
- 改法（二选一，推荐前者）：类型注释钉死「kind 只由 skill 侧产出、read 侧恒缺省，parse 不回构是有意的不对称」；或回构 `...(kind==="read" ? {kind:"read" as const} : {})`。
- 验收/测试：core tsc 0 错；若走回构分支，skill-result-ref.test.ts 补一条带显式 kind 的 round-trip 断言。
- 来源：cr-w1-skill-ref/B-1（round-2 行号订正：spec-check judge P2-1）

#### cr-f9 [P2] load ref 的 offset/returnedLines/totalLines 占位假值
- 文件：`packages/core/src/domain/tool/logic/build-tool-result-block.ts:178-183`、spec Part 4 ③
- 问题：`offset:1, returnedLines:0, totalLines:0` 是占位假值（真实值由推导重算、从不落 ref）；任何将来按 ref.totalLines 渲染的消费方会对 load 块显示 0 行，且是 parse 合法值不报错。
- 改法（二选一）：优先让 `deriveSkillLoadTruncation` 返回 totalLines/returnedLines 真值由产块门填入；否则 SkillResultRef 字段注释钉死「load 的三件是占位假值、禁止消费方读取」。spec Part 4 ③ 字段表同步补占位说明（cr-f14 ⑤）。
- 验收/测试：若走真值分支，T-SR4 断言 load ref 的 totalLines 为真实行数；若走注释分支，`grep -n "占位" content-block.ts` 命中。
- 来源：cr-w1-skill-ref/B-2

#### cr-f10 [P2] alreadyReferenced 隐式耦合显式化
- 文件：`packages/core/src/domain/tool/logic/build-tool-result-block.ts:135-217`
- 改法：`resolveSkillResultRefFromOutcome` load 分支加 `if (output.alreadyReferenced === true) return undefined;` + 注释「alreadyReferenced 形态永不产 ref——hydrate 侧无法重放 tip 语义，产了就破 wire」。
- 验收/测试：skill-result-ref.test.ts 已有 alreadyReferenced 零 entryId 断言保持绿；core tsc 0 错。
- 来源：cr-w1-skill-ref/D-1

#### cr-f11 [P2] 越界 offset 白跑一次截断推导
- 文件：`packages/core/src/domain/tool/builtin/skill-tool.ts:495-508`
- 改法（二选一）：`deriveSkillReadTruncation` 在 `offset > totalLines` 时内部短路（把「越界即错」收进单源）；或回退推导前轻判 + 注释「错误路径的浪费可接受」。
- 验收/测试：既有越界 offset 抛 INVALID_ARGUMENT 用例保持绿（skill-tool 测试）。
- 来源：cr-w1-skill-ref/C-1

#### cr-f12 [P2] T-MP-P1 卡线收窄 + 绝对预算双侧保留
- 文件：`packages/core/test/infra/message-content-decompression.test.ts:602-701`
- 问题：`MAX_RATIO=25`（实测 8.5×，允许再退化 3 倍才红）；`ABSOLUTE_BUDGET_MS=20000`（百毫秒级空载，200 倍余量实质永不触发）。
- 改法（round-2 修订：不能丢 baseline 侧逃生口、取值拍死单值）：`MAX_RATIO` 收到 **15**（实测 8.5× 留 1.76× 抖动余量；不再写区间甩给执行者）；`ABSOLUTE_BUDGET_MS` 从 20000 收到能真实兜量级的值（建议 2000ms，**保留双侧兜底**——现结构绝对预算同时兜 decompressMs 与 baselineMs，环境噪声拖慢 baseline 侧时它是唯一逃生口，不能只钉单侧）；另补「100 行单批 ≤2s」断言直接钉住 60s 预算 × 批 100 的单轮推进能力。
- 验收/测试：本地连跑 3 次三条护栏全绿（无环境噪声假红）。
- 来源：cr-w1-perf/G-2（round-2 修订：spec-check judge P2-3）

#### cr-f13 [P2] T-MP-P0 两侧基线 role 不同构
- 文件：`packages/core/test/chat/message-content-perf-threshold.test.ts:101` vs `:157`
- 改法：`insertCompressedRow` 加 role 参数，两侧同一 role 序列（当前压缩侧全 user、明文侧 20/20，护栏同构前提被破坏，role 相关逻辑一旦进读路径会静默劣化护栏）。
- 验收/测试：T-MP-P0 连跑 3 次绿；两侧夹具 role 序列 diff 为空。
- 来源：cr-w1-perf/G-3

#### cr-f14 [P2] spec 回填清单（执行时同步改 spec，闭合 spec_deviations）
- ①spec.md:58「索引级探测」措辞随 cr-e1 订正；②spec 消费处矩阵 CLI 行补写侧最坏预算随 cr-p1，**连带 spec.md:72「（默认预算）」一句改**（**矩阵行是表格书写，按实际表格行落笔；「#13」等井号编号是本 fix-spec 内部指代**）；③矩阵「搜索」「token 统计」行补 parse 成本随 cr-p3（同前注）；④Part 3.6 `novel-master-bootstrap.ts:102-106` 的 v17 注释块补明文化决策与反向任务过渡期一行（当前只删了旧任务名、没说现存反向任务）；⑤Part 4 ③ SkillResultRef 字段表补占位说明随 cr-f9；⑥spec 测试策略「两域夹具」随 cr-f7 补齐后改回；⑦Part 2 marker 形状 `{at, failedCount}` 扩为 `{at, failedCount, failedIds}` 随 cr-d1；⑧Part 2 补「索引落点=bootstrap 事务外无条件幂等建（idx_chat_session_parent 同款手法、落点不同）」与 V1' 退役删索引条目随 cr-e1；⑨**spec.md:32 边界翻转**——「不做 searchMessages 的 LIKE 恢复……全量精筛路径零改动」改写为「不做 LIKE 召回，召回语义仍以内存精筛为准；仅加 parse 前性能粗筛（压缩行放行、转义/非 ASCII 关键词退回全量精筛）」，矩阵「搜索」行「LIKE 不恢复（边界）」同步改述，随 cr-p3；`docs/apm/RULE.md:33`「searchMessages 仍全量精筛（LIKE 恢复是独立优化项）」**走 apm-record 流程改**（`docs/apm/` 是记忆资产有查重/索引约定，不走 fix-spec 直派；改完确认 RULE 索引条目同步）；⑩spec 矩阵 #7「参数数组驻留明文 JSON（2-3× 内存↑）」随 cr-p2 改述为「构造按片进行、峰值 O(chunk)，fork/copy 连接独占语义不变（本就在外层事务内）」（round-4 增）。
- 验收/测试：回填后 grep spec 无「索引级探测」旧措辞；marker 形状描述与 cr-d1 实现一致；spec.md:32 与 RULE.md:33 的 LIKE 边界口径一致。

## Spec deviations
- open 项全部映射到 must-fix：T-MP4 漏 search（cr-c1）、「索引级」措辞（cr-e1）、矩阵 CLI 写侧（cr-p1）、矩阵搜索/token 统计行成本模型（cr-p3）、bootstrap 注释块（cr-f14④）、占位说明（cr-f9）、两域夹具（cr-f7）、marker 形状扩字段（cr-d1→cr-f14⑦）。
- 已闭合（实现期补充登记，无需动作）：encode 删除时序、T-MP3 口径、status 快路径不自愈、maintenance 测试处置、before/after 语义反转、memo kind:action（比 spec 更严，加强）。

## Open questions / 待拍板（不阻塞）
1. +36MB（≈1.5×）是否写死进 CHANGELOG（cr-f1 ② 的分叉：写量化口径 or 定性收窄）。
2. 解压上限阈值取值（cr-f6 配套；建议 64MB，需确认单条消息合理上限口径）。
3. stalled 库状态行是否加「迁移未完成，点击重试」显式出口（产品决策；当前永久 stalled 只显示「进行中（剩余 N 条）」+ console.warn）。
4. mobile 调度器缺 `isConnectionClosedError` 分流（既有缺口非本次回归；一次瞬时 SQLITE_BUSY 会让本进程永久收手，靠下次启动自愈）。
5. mobile 不传 before/afterMaintenance（消费旧 pending 的 VACUUM 在 mobile 不置 busy；既有形态、窗口极窄）。
6. CLI 无调度测试（三端 parity：desktop ✓ / mobile ✓ / cli ✗，既有）。
7. ~~坏行只有 failedCount 无持久 id 清单~~ → **已由 cr-d1 round-2 方案顺带解决**（marker 扩 failedIds），运维可从标记直接定位坏行 id。
8. ReadResultRef 派生字段冗余（存了不读，跨迭代接口清理议题）。
9. locKey 对 skill ref 定位力（`read:SKILL.md` 定位不到具体技能；建议 `${action}:${domain}/${name}/${path}`，若改需同步 cr-f7 T-SR8 断言）。
10. searchMessages LIKE **召回**单独立项（搬运收敛后收益变大；本 fix-spec 只做 parse 前粗筛、召回语义仍以内存精筛为准——见 cr-p3 改法③与 cr-f14⑨）。
11. 云同步：上传中断孤儿快照（模块零 delete 路径）+ 租约续期是事后检查（450s 阈值在 1.5× 体积下更易踩）——backlog 项，本轮仅 cr-f1 披露。

## 已豁免（用户确认不修）
（无）

## 合并后 QA（manual_user）
- 真机装 release 包跑真实库升级：迁移时长体感 + 存储页状态行三态 + 状态行回退到「进行中」的用户预期确认。
- 真实 LLM read/skill 轮（需配密钥）：skill 引用块渲染、hydrate 重放等值。

## K 节建议（下游执行时闭合）
- 行尾换行三处（cr-f4）、.gitignore 与 git status 清洁复查（cr-f5）。
- `docs/Iterations/*/cache/`、`.nm-regr-tmp/`、`tmp-*.log` 已 untracked，提交前确认不入库（禁 git add -A 直提）。
- 发布切片纪律：spec 钉死 Step 1-5 同批发布（当前已在同一提交链，cherry-pick 勿拆）。


---

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | yes（r5 Go，无 P0/P1 遗留） |
| fix_spec_path | docs/Iterations/message-plaintext/cr-fix-spec.md |
| dag_version / review_round | 5 / 5（r1 六 scope 并行；r2 双路 review-full+judge；r3-r5 judge 循环） |
| P0 / P1 / P2（已写入 fix-spec） | 1 / 8 / 14（条目计数；r2-r4 复审的 7 条 P0 级改法缺陷全部并入对应条目承载，见 P0 段账面指针） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none（全部映射 cr-f14 ①-⑩ 回填项，执行时同步闭合） |
| C-orch | ✅（三端调度 parity/DTO 贯通已核；cr-p2 连接句柄形态收敛为 runInTransactionOrConn 单模式） |
| manual_user（合并后 QA，不阻塞） | 真机 release 升级迁移体感 + 状态行回退预期确认；真实 LLM read/skill 轮（需配密钥） |
| 轮次上限说明 | 5 轮用满，r5 Go 收官；三轮复审 P0（r2×3 / r3×3 / r4×1）全部收敛在「改法与代码/规格硬冲突」，逐轮收敛无震荡 |
