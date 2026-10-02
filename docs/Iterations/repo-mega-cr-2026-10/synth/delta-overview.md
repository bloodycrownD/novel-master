---
zone: cross
agent: W10 delta 总览
wave: W10
date: 2026-10-01
baseline: 9ca5f5ad（v1.5.28 发布）
head: fe79b781（v1.5.29 发布）
scope: git diff --stat 9ca5f5ad..fe79b781（118 文件，+10774 / −3219）
---

# v1.5.29 对架构的改变总览（delta）

> 本文件回答一个问题：**从 9ca5f5ad 到 fe79b781，架构上「什么变了、变了之后数据怎么走、哪些台账结论作废」**。
> 每条结论带 `file:line` 或 commit，可复核。architecture.md 本身的改写不在本文件内，只在 §3 给改写清单。
> 术语与纪律以 `docs/apm/RULE.md` 为准；本文件不重复它，只在口径偏离时点名。

---

## 1. 一句话总览

v1.5.29 有两条独立的架构级变更落在同一批提交里：

1. **明文化链**：`chat_message` 正文从「压缩为正形态」回退成「**明文为正形态**」——写侧直写 `content_json`、压缩两列恒 NULL；正向压缩任务整文件删除，换成**反向解压搬运任务**；消息正文缓存池整层删除。
2. **引用化链**：`read` 工具结果与 `skill` 工具的 `read` / `load` 结果，从「tool_result 存全文」改成「**tool_result 存引用 + view-time 重放**」——`contentRef` 块落库、`content` 为空串，发送前 hydrate 逐字节还原 wire；`vfs_revision.ref_count` 的持有者从两类扩为**三类**。

两条链都**不是纯增量**：明文化删掉了正向任务与一整层缓存，引用化给 ref_count 增加了第三类持有者并给消息删改加了新的事务义务。architecture.md 里被它们直接推翻的句子有 7 处（§3）。

---

## 2. 两条链的数据流走线

### 2.1 明文化链（chat_message 正文）

**落库形态**（`packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts`）

- `toMessageParams`（`:52`）：`content_json = JSON.stringify(message.content)`，`content_encoding` / `content_blob` 显式绑 `null`。列**不删**（schema CHECK 原样保留），只是新行恒为空。
- `updateContent`（`:424`）：**三列齐置**——`SET content_json = #{json}, content_encoding = NULL, content_blob = NULL`。这是 P0 级约束：只写 `content_json` 时读路径的「blob 非空优先」分支会解出**旧正文**，不崩溃、只静默返回错内容。反例由 `test/chat/message-plaintext-write.test.ts` 的 T-MP1 锁死。
- `readRowContent`（`:125`）：读路径**双形态保留至 V1'**——`content_blob != null` 走 `decodeMessageContent`，否则 parse `content_json`。两种行都永远合法，跨版本快照混布 / 迁移中断 / 坏行全靠它。
- `batchInsert`（`:447`）：参数**按片构造、按片下发**（`BATCH_PARAM_BUILD_CHUNK = 200`，`:225`），峰值内存从 O(全会话) 降到 O(片大小)。走 `runInTransactionOrConn`（`:91`）——运行时判定 `conn` 是根连接还是事务句柄，嵌套 `transaction()` 必抛 `NESTED_TRANSACTION`（三驱动契约，`connection.port.ts:37`）。
- `searchMessages`（`:549`）：**parse 前加 LIKE 粗筛**。谓词 `AND (content_blob IS NOT NULL OR content_json LIKE '%'||#{keyword}||'%')`（`:602`），守卫 `LIKE_PREFILTER_UNSAFE_RE`（`:117`）——keyword 含 `"` `\` C0 控制符或**任何非 ASCII** 时不加粗筛、退回全量精筛。召回红线（不得小于全量精筛）由内存 `messageMatchesKeyword` 兜底；`%` / `_` 通配不拦（只过宽不漏召）。

**搬运任务**（`packages/core/src/infra/db-maintenance/impl/message-content-decompression.ts`）

- 谓词 `content_blob IS NOT NULL`，COUNT（`:195`）/ 批查询（`:283`）/ UPDATE WHERE（`:462`）三处同条件，幂等续跑。
- KKV 完成标记 `nm-message-decompress` / `decompressDone`（`:81-82`）。**入口自愈**：标记随整库快照 travels，pull 回灌旧快照会把「已解完」标记带到仍是压缩态的库上，故入口先跑一次 `SELECT 1 ... LIMIT 1` 探针（`:290`，排除 `failedIds` 已知坏行），命中即清标记续搬。探针由部分索引 `idx_chat_message_pending_blob` 支撑，该索引在 **bootstrap 事务外**幂等建（`novel-master-bootstrap.ts:399`），前置判定只有「`content_blob` 列在不在」；**建索引本身失败 fail loud**（不包 try/catch，与同层 `seedBuiltinSkills` 的「失败仅记日志」有意不同）。
- 坏行隔离：decode 失败原样保留压缩字节、不强行转换、fail-fast 带消息 id；`failedKeys` 集合贯穿全程。
- 收尾不变量：`leftover > failedKeys.size` ⇒ `stalled = true`、**不置完成标记**（`:514`）。没有这道校验，任务会谎报完成并把残留永久封在库里。
- **不挂收尾维护链路**（`:540`）——解压是**增容**不是释放，库里没有可归还的 freelist 页，VACUUM 只会全库重写、白烧一次同步阻塞。与正向任务（压缩释放页、挂 VACUUM 有实打实的收益）语义**相反**，不可照抄。
- 旧 pending 欠账清偿：`runPendingStartupMaintenance` 上移到公共模块并参数化（`db-maintenance.service.ts:210`），消费旧 `nm-message-content/startupMaintenancePending` 标记。正向文件随 Step 3 整文件删除后，这段逻辑原本会悬空（页空间永不归还）。必须用去重版 `runStartupMaintenanceOnce` 而非手动 `runDatabaseMaintenance`，否则与 blob 归一任务叠加会跑出双 VACUUM。
- 调度：desktop `scheduleDesktopMessageContentDecompress()`（`main.ts:28,177`）、mobile `scheduleMobileMessageContentDecompress()`（`novel-master-context.tsx:229`）、CLI 内联 `runMessageContentDecompress(conn, { syncBudgetMs: 5_000 })`（`apps/cli/src/runtime.ts:198`）。CLI 预算从 60s 收窄到 5s（最坏合计 ~65s）——CLI 是三端唯一把搬运 await 进命令关键路径的。

**hydrate 时机**：不适用（明文化链没有 hydrate）。但有一处**同族的 view-time 纪律**要记：反向任务的 `decodeMessageContent` 是**纯函数、无进程内缓存**（`message-content-codec.ts:56`，模块头 `:40-50`）。原实现把解压产物按 messageId 记进 `infra/content-cache` 的消息正文池，随该池删除而一并去掉——存量压缩行的重复读每次都重新 inflate，短窗口可接受。

**wire 不变式**：不适用（wire 形态与 v1.5.28 一致）。但**库文件与备份文件里的消息正文从此为可直接阅读的明文**（此前的压缩只省空间、不提供任何保密性）——这是 CHANGELOG 明写披露的用户可见变更（`CHANGELOG.md:9`）。

**缓存层塌缩**（`packages/core/src/infra/content-cache/logic/decoded-content-cache.ts`）

- 消息正文池（`messageContentPool`）与三 API（`lookup` / `remember` / `forget`）**整层删除**；`clearDecodedContentCaches`（`:210`）收窄为单池；`decodedContentCacheStats` 返回单元素数组。
- 随之**四处写口的失效义务消失**：`insert` / `updateContent` / `batchInsert` / `delete` 上的 `forgetDecodedMessageContent` 全部撤除。
- 剩一个池：`contentBodyPool`（键 = 明文 sha256，vfs blob 与 file_cache blob 共用），**无失效机制**（value 是 key 的函数）。模块头已把这条重写为单池口径（`:5-58`）。

### 2.2 引用化链（read / skill read / skill load 的 tool_result）

**落库形态**（`packages/core/src/domain/chat/model/content-block.ts`）

- `ToolResultBlock.contentRef?: ReadResultRef | SkillResultRef`（`:59`），加法式可选字段。存在时 `content` 为**占位空串**。
- `ReadResultRef`（`:100`）：全局键 `(entryId, version)` + 冗余 `contentHash` + 自包含的截断派生参数（`offset/limit/returnedLines/totalLines/truncated/lastLineTruncated/nextOffset`）。**`kind?: "read"` 缺省即 read**（存量行无该键，零迁移兼容），且 parse 侧**有意不回构** `kind`（`parse-message-content.ts:189-195`）——回构会让落库 JSON 凭空多一个键、round-trip 不再逐键稳定。
- `SkillResultRef`（`:145`）：**`kind: "skill"` 必带**（判别字段）。两种 action 的派生面不同——`read` 走 `formatReadOutput`（分页字段齐全），`load` 走 `formatSkillLoadOutput`（wire 无分页字段）。`load` 侧的 `offset/returnedLines/totalLines` 恒为 `1/0/0`，是**占位假值、消费方禁读**（`:162-183`）——只为让两条 action 共用一套字段校验与 parse 白名单。
- parse 必须**先按 `kind` 分派**（`parse-message-content.ts:126-140`）——否则 read 白名单会静默吞掉 skill ref 的 `action/domain/name/files`，hydrate 拿不到 files、重放不出「附属文件」尾注，wire 逐字节失真。

**引用块的产出门**（`packages/core/src/domain/tool/logic/build-tool-result-block.ts:456`）

```
contentRef = resolveReadResultRefFromOutcome(toolName, output)
          ?? resolveSkillResultRefFromOutcome(toolName, output)
```

两条链都是**「输出带 entryId ⟺ +1 已发生」**的自洽闭环：

- read 侧：`vfs-tools.ts:238-262`——head 定位三件套（`entryId` / `contentHash` / `totalBytes`）齐全**且** `ctx.adjustRevisionRefCount` 已注入才 +1 并把三件套放进输出。
- skill 侧：`skill-tool.ts:258` `anchorSkillResultRef`——判空口径逐字照抄 vfs read 分支。`alreadyReferenced` 形态**永不产 ref**（`:153`）：wire 是常量 tip、无正文可引，hydrate 侧无法重放 tip 语义。
- 三件套来自 `VfsReadResult` 新增的三个可选字段（`vfs-service.port.ts:24-35`），由 `DefaultVfsService.read` 现算（`vfs.service.ts:104-116`，`contentHash` 走点查不解正文、`totalBytes` 按 UTF-8 明文字节口径）。`SkillsService` 原样透传（`skills.service.ts:335-345`，`contentHash` 用 `in` 判以免吞掉 `null` 键位）。
- **能力未注入时回落 legacy 全文形态**（不 +1、不带 entryId、不产引用块）——三端 runtime 随 hydrate 就绪才打开，避免「产引用块但 wire 还原未接线」的中间态。

**搬运任务**：引用化链**没有**库内搬运任务。它的「搬运」是每次 hydrate 的 view-time 重放。

**hydrate 时机**（`packages/core/src/domain/chat/logic/hydrate-tool-results-for-prompt.ts`）

```
prepare-user-messages-for-prompt.ts:639
  → hydrateToolResultsForPrompt(out, runtime.revisionRepo)   ← return 前最后一步
```

- **必须在 `normalizeOrphanToolResultsForLlm` 之前**（`agent-runner.ts:592`）：孤儿拍平吃 `messageBodyText`，未 hydrate 的空 `content` 会被拍成占位文本、wire 全文丢失。
- 主链（LLM 装配）与 parity 链（token 计数 / 压缩评估）**共用本函数**，字符串口径必须一致——双端 `session-prompt-input.service.ts` 各注入一份 `runtime.revisionRepo`。
- 三类引用共用同一条校验链（`findMetaByEntryAndVersion` 只取 `status` / `content_hash` 两列、**零解码**）：
  1. `REPO_MISSING`（装配缺口）
  2. `REVISION_MISSING`（悬空 / 保活链被破坏 / 引用键被篡改）
  3. `CONTENT_DELETED`（status=deleted，明文不可再生）
  4. `HASH_MISMATCH`（元数据 hash 与 ref 不符 = 版本错位 / 错键）
- **完整性校验已降本**（commit `bd9599ea`）：旧实现解出明文整段重算 SHA-256（34KB/块 ≈ 0.27ms，100 块 ≈ 27ms，占单次 hydrate 约 1/4），现改为比对 revision 行的 `content_hash` 元数据列。抗传输损坏由 zlib 的 adler32 兜底；「刻意同时改写 blob 明文与 hash 字段」这种双改语义等价于一条合法的另一版数据，不再另行报错（与 vfs 其余明文读路径一致）。
- **调用内去重、不跨调用持久缓存**（`HydrateMemo`，`:117-120`）：`plainByRefKey` 键含期望 hash（防篡改 ref 借缓存绕过校验），`wireByReplayKey` 键**必须含 `kind:action`**（load 与 read 共享同一 `(entryId, version)`，不加 action 会拿 read 的 wire 去当 load 的 wire 发给 LLM）。不做持久缓存的理由：dangling / 已删除的 fail-fast 是保活链断裂的**安全网**，持久缓存会把已消失的 revision 明文继续发出去、把安全网盖住。实测重复引用场景 −92%~−99%。
- hydrate 是**纯内存态**：填回 `content`，`contentRef` 原样保留，**不写回 `content_json`**（`:303-305`）。

**wire 不变式**（承重约束，改动需版本化）

| 引用类型 | 截断管线 | 冻结 formatter | 单源函数 |
|---|---|---|---|
| read | `sliceLinesFromOffset` + `capUtf8BytesFill`（50KB 预算） | `formatReadOutput` | 内联于 hydrate（`:131`） |
| skill read | `truncateLine`（2000 字符）+ `capUtf8Bytes`（整行丢弃） | `formatReadOutput` | `deriveSkillReadTruncation` |
| skill load | 同上但全量 | `formatSkillLoadOutput` | `deriveSkillLoadTruncation` |

- skill 的两个推导函数抽在 `domain/tool/logic/skill-read-truncation.ts:54,115`，**skill-tool 执行时与 hydrate 重放共用同一份**（单源 = 共享函数，不是复制两份管线）。抽独立文件的理由是分层：执行侧在 `domain/tool/builtin`、重放侧在 `domain/chat/logic`，chat 侧不得反向依赖 builtin。
- 越界 `offset` 判定**收在单源函数内**（内部短路、只回 `totalLines` 供报错文案），调用方不重复推导。
- 逐字节等值由测试锁死：hydrate 四形态 wire 等值、T-RR10 parity、T-RR 四语义保留（`test/chat/hydrate-tool-results.test.ts` 717 行、`test/tool/read-tool-result-ref.test.ts`、`test/chat/skill-result-ref.test.ts` 917 行）。

**`vfs_revision.ref_count` 的第三类持有者**（`packages/core/src/domain/vfs/logic/revision-ref-count.ts`）

- 持有者一：checkpoint 文件指针。持有者二：live head。**持有者三：消息侧 read/skill 引用**（`contentRef` 的全局键，跨会话指向源 revision）。
- 五个 ±1 挂点：

  | 路径 | delta | 位置 | 硬约束 |
  |---|---|---|---|
  | read / skill read / skill load 执行 | +1 | `vfs-tools.ts:242`、`skill-tool.ts:262` | **先于工具返回**，堵「返回→落库」的 sweep 窗口 |
  | 单条删除 | −1 | `message.service.ts:249` | 同事务，sweep 之前 |
  | 删尾（`truncateAfter`） | −1 | `message.service.ts:531`、`truncate-tail-in-transaction.ts:81` | **必须先于 `sweepSessionRevisions`**，否则被引用 revision 被 GC（内容不可再生） |
  | 会话树删 | −1 | `session.service.ts:224` | fork/copy 出的**其它**会话的引用不受影响 |
  | 项目删（BFS） | −1 | `project.service.ts:176` | 独立挂点，该路径**不经 `deleteSessionTree`** |
  | fork / copy | +1 | `message.service.ts:385`、`session.service.ts:399` | 对**源** revision，源会话删除后 fork 侧引用仍保活 |
  | 覆写正文 | 换算 | `message.service.ts:292-303` | 旧 blocks −1 + 新 blocks +1 与正文替换**同事务**；+1 带 NOT_FOUND 守护，悬空引用落库前 fail-fast |

- 方向**宁多不少**：无主 +1（read 后 append 前崩溃）由 `repairRefCounts` 三类期望值检测，**只报告不自动修**（`revision-ref-count.ts:330-341` 的 `overExpected`）。
- repair 期望值三类化后改为**批量对账**（`:313-326`）：一次 `listKeysWithRefCountUnderScope` 取齐当前值，`batchRepairRefCountFloor` 按 500 分块，round-trip 从 2N 压成 `ceil(N/500)×2`。
- `aggregateReadRefsFromAllMessages`（`:166`）扫**全库**消息（read 引用跨会话），压缩行走 `decodeMessageContent`；单行解析失败只 warn 跳过（期望值偏保守 = floor 不下调，方向安全）。
- **pull 不释放**：ref_count > 0 自动留存。
- 新增 port 方法 `listKeysWithRefCountUnderScope`（`vfs-revision.port.ts:95-105` + `sqlite-vfs-revision.repository.ts:322-350`）。

**装配链**（`resolveReadRefCountChannel`，`run-agent-turn.ts:201`）

```
runtime.adjustRevisionRefCount（显式，测试探针口）  ← 优先
  ↓ 否则
runtime.revisionRepo.batchAdjustRefCountWithDelta   ← 生产推导
  ↓ 两者都缺
undefined → read 回落 legacy 全文形态
```

`revisionRepo` 单点收口、双职责：① 推导 read +1 通道（主 / 子两个 toolCtx 装配点共用，`:902` / `:1258`）；② 经 `assembleAgentRunnerDeps` 透传给 runner 的 prepare（`assemble-agent-runner-deps.ts:82` → `agent-runner.ts:465`）。三端 runtime 各 `new SqliteVfsRevisionRepository(conn)` 一份（desktop `create-desktop-runtime.ts:146`、mobile `create-mobile-runtime.ts:119`、cli `runtime.ts:235`），U-A-U-A 链路另注入（`create-user-vfs-turn-service.ts:69`）。

**未注入时 fail-fast 而非降级**：消息含 `contentRef` 而 `revisionRepo` 未装配 ⇒ 抛 `ReadResultHydrateError(REPO_MISSING)` 中断装配。理由是引用块的 `content` 就是空串——静默放行等于给 LLM 发空 tool_result，这正是引用化要杜绝的形态。

**UI 侧**：desktop `bodyText` 引用态占位（`ipc/handlers/messages.ts:82-106`），skill 引用标 `[skill ref: domain/name]`、read 引用标 `[read ref: path]`，按 `contentRef.kind` 窄化（缺省即 read）。变换只作用于浅拷贝块数组、不写回消息库。renderer / mobile 组件**零改动**——`git grep contentRef -- apps/desktop/renderer apps/mobile/src` 无命中，UI 卡片靠既有 `summary` 渲染。

---

## 3. 对 `architecture.md` 的影响清单

architecture.md 现有 5 节（① 分层总图 / ② 模块导航 M1–M10 / ③ 五条核心数据流 / ④ 架构不变量 I1–I11 / ⑤ 债务热点地图）。以下 **7 处必须改写**，逐条给「现文 → 改法」。

### 3.1 必改（结论已被推翻）

| # | 位置 | 现文 | 改法 |
|---|---|---|---|
| A1 | `architecture.md:88`（M1 数据归属） | 「正文走 `content_encoding`+`content_blob`，`content_json` 明文列保留」 | **正形态翻转**：明文走 `content_json`，压缩两列为**迁移期存量形态**。同时补 `contentRef` 块的落库形态与「`content` 为占位空串」 |
| A2 | `architecture.md:174`（流 1 末行「写盘」） | 「append → nextSeq → encode → `content_json=''` + encoding/blob → assertMessageContent」 | 「append → nextSeq → `toMessageParams`（**明文直写 + 两列显式 NULL**）→ assertMessageContent」；`encodeMessageContent` 已终删 |
| A3 | `architecture.md:164`（流 1 前奏） | 同上含 `encodeMessageContent` | 同 A2 |
| A4 | `architecture.md:235`（不变量 I2「明文行永远合法」） | 口径是「双形态读，新代码严禁假设单一形态」 | 语义**仍成立但方向变了**：不再是「新形态压缩 + legacy 明文」，而是「**明文为正形态 + 压缩行为迁移期存量**」。V1' 之后才收为单形态。建议把 I2 改述为「双形态保留至 V1'」并指向 RULE:33 |
| A5 | `architecture.md:242`（不变量 I9「ref_count 三持有者并存」） | 列的是 **三层不同计数器**（`vfs_revision.ref_count` 应用层 / `vfs_content_blob.ref_count` 触发器 / `message_checkpoint_file` ref） | **「三」这个数字要重排**：现在是「三**类计数器**」不变，但 `vfs_revision.ref_count` 这一层内部从**两类持有者**（checkpoint 指针 + live head）扩为**三类**（+ 消息侧 read/skill 引用）。T-SC5「三者并存不矛盾、绝不强行合一」的裁决仍成立，需补 `batchRepairRefCountFloor` 只改 `ref_count` 不改 `content_hash`、触发器不 fire 的不变量说明 |
| A6 | `architecture.md:256`（P0 表 **RT-01**） | 「gemini 协议下每 step 一次含 hidden 的全会话全量读」 | **已修**：`listAllSessionMessages` → `listVisibleSessionMessages`（`assemble-agent-runner-deps.ts:73`），`includeHidden: false` + 懒求值（纳入本 step 压缩产物）。实测每步两发 368.2→23.9ms（−93.5%）。注：台账口径「覆盖 hidden 是有意的、全量读不是」——**现在两者都改了**（可见集被证明对 gemini lookup 完备，因 `normalizeOrphanToolResultsForLlm` 按可见集配对） |
| A7 | `architecture.md:266`（P1 分布 core-runtime「内容池命中率 0.53」） | 把 `messageContentPool` 列为 P1 热点之一 | **该池已整层删除**（见 §2.1），此条作废。`contentBodyPool` 保留、无失效机制，不构成同类风险 |

### 3.2 应补（新增事实，原文未覆盖）

| # | 位置 | 补什么 |
|---|---|---|
| B1 | `architecture.md:167`（流 1「① session.list()（可见全会话，逐行 inflate）」） | 「逐行 inflate」对明文行不再成立（迁移期压缩行才需要）。同处的「每 step 全量读是本簇头号 P0」需重新表述——RT-02（两次独立读）**仍未修**（见 §4） |
| B2 | `architecture.md:88`（M1 关键位置） | 新增 `domain/chat/logic/hydrate-tool-results-for-prompt.ts` 与 `domain/tool/logic/skill-read-truncation.ts`；`content-block.ts` 的 `contentRef` 判别口径（`kind` 缺省即 read、skill 必带） |
| B3 | `architecture.md:102`（M2 数据归属「索引只有 `idx_vfs_entry_scope_path` 与 `idx_vfs_revision_entry`」） | 这句针对 vfs 表仍准确。但**新增部分索引 `idx_chat_message_pending_blob`**（chat_message，非 vfs），落点在 bootstrap 事务外、fail loud、不 bump `SCHEMA_BOOT_VERSION`——与「I7 加列三件套」和「I6 空占位 migration 禁令」都不同，属第三条 DDL 纪律，建议单列 |
| B4 | `architecture.md:110`（M3 被谁消费） | 不受影响（workplace 前缀与消息正文正形态无关）。但 §2.1 记录的「派生缓存与库同寿命」纪律在消息正文池删除后只剩 `contentBodyPool` 一条，`RULE:138` 的论证链需相应收窄 |
| B5 | `architecture.md:145`（M8 desktop 四层） | IPC 面新增 `contentRef` DTO 字段（`ipc-types.ts:690`）+ `MessageDecompressStatusDto`（`:1663`）+ `DbStatsResult.messageDecompress`（`:1681`）。通道数不变（148 invoke + 7 push），**不是新通道**，是既有 DTO 扩字段 |
| B6 | `architecture.md:63-67`（存储层 SQLite 业务表清单） | 无新表。`chat_message` 两列语义翻转（见 A1） |
| B7 | `architecture.md:250`（P0/P1 计数）与 `:264-271`（P1 分布表） | 计数需重算：RT-01 出池、RT-03 池删除后其 P1 依据消失、CD-10 的病因（LRU 污染）随池删除而消失但症状（parse 主导成本）仍在并已被 LIKE 粗筛部分处理 |

### 3.3 不受影响（已核对，无需改）

- 流 2 压缩/置位、流 3 回滚、流 4 云同步 pull、流 5 WebView 渲染：机制未变。
  - 流 3 有一处**隐含新增义务**：回滚删尾现在多了 read 引用的 −1 挂点，且**必须先于 sweep**（`truncate-tail-in-transaction.ts:81`）。机制的描述（物理删尾、seq 复用）不变，但这层顺序约束值得在流 3 里点名。
- 不变量 I1（workplace 前缀冻结）、I3（回合宏值快照）、I4（出站合并不落库）、I5（事务持锁只有 tx 面能查）、I6（`schema_migrations` 只登记不搬运）、I8（`listBySession` 恒含 hidden）、I10（VFS last-write-wins）、I11（workplace 双归属键）：均未被本波触碰。
- §⑤ 「上游裁决冲突」三条（M-14 / M-13 / D-7）：无关。

---

## 4. 与 CR 台账已知发现的交叉注记

**只列本波确证的**。判定标准是能给出 `file:line` 或 commit 证明结论已变。

### 4.1 被本波顺手修掉的

| 台账 ID | 原结论 | 现状 | 证据 |
|---|---|---|---|
| **RT-01**（P0，core-runtime） | gemini 协议下每 step 一次含 hidden 的全会话全量读（21 列），消费方只要 tool_use 的 `id`/`name` | **已修**。`listAllSessionMessages` → `listVisibleSessionMessages`，SQL 层 `includeHidden: false`，且改为懒求值（放在 normalize 之后，纳入本 step 压缩产物）。实测每步两发 368.2 → 23.9ms（list 200.6→12.2、tool_use 查找源 167.6→11.7） | commit `e2d10b3f`；`agent-runner.ts:605-606`、`assemble-agent-runner-deps.ts:73-78` |
| **RT-03**（P1→P2，core-runtime） | 消息正文池 4M 字符上界，千条×长正文会话命中率 0.53（W6 实测 0.400），暖读 ≈ 冷读 | **前提消失**。`messageContentPool` 整层删除，该池不复存在，此条不再是可修对象。**注意**：这不是「修好了」，是「对象没了」——台账的「需产品拍板内存预算」那一栏随池一起作废 | `decoded-content-cache.ts:169-217`（池与三 API 全删）、`:5-58`（模块头改单源） |
| **CD-10**（P2，core-data） | `searchMessages` 全量精筛污染进程级 LRU，「一条都搜不到」等于把整会话 assistant 正文逐条 inflate | **病因消失，症状换形且被部分处理**。LRU 没了 ⇒ 不再有「冲掉别的读口热态」；主导成本从 inflate 变成 `JSON.parse`（5350 行库一次搜索 = 5350 次 parse）。本波加了 parse 前 LIKE 粗筛（纯 ASCII keyword），召回红线由守卫保住 | `sqlite-message.repository.ts:593-608`、`:117-121`；commit `85abb7eb` |
| **CD-34**（P3，core-data） | 明文行分支直接 parse **不进 LRU**，blob 行进；迁移期明文读口零缓存收益 | **前提消失**。两个分支都不进任何池，形态差异不复存在 | `decoded-content-cache.ts`（模块头「chat_message 正文已退出本层」段） |
| **CS-11** 的解压半边（core-storage 争议 #7） | `session.service.copy` 事务内全量解压：一次 copy = 解压 N 次 + 压缩 N 次 | **解压半边消失**（写侧不再压缩），但「事务内全量**读**」半边**仍在**（`listBySession` 仍进事务）。另 `batchInsert` 的让步理由从「压缩成本」换成「参数数组内存」 | `sqlite-message.repository.ts:213-222` 注释改述 |
| **CD-02** 的「空锚 `listIdsAfterSeq` 免解压」诉求（core-data） | truncateAfter 用 id 列表而非带正文的读，省解压 | **未达成，且方向相反**。改用 `listBySessionFromSeq` 拉**带正文**的 tail（因为 read 引用收集需要 `content`）。迁移期压缩行会因此被解压。不过 TOCTOU 本身**未修**——id 仍在事务外取（`message.service.ts:512` 在 `:522` 的 `conn.transaction` 之前） | `message.service.ts:512-515`；`truncate-tail-in-transaction.ts:72`（在事务内） |

### 4.2 未被本波修、也未被推翻的（登记以免误判为「已处理」）

- **RT-02**（P0，core-runtime）——runner 每 step 两次独立全会话读，**仍在**。`agent-runner.ts:413` `session.list()` 与 `:519` `shouldRequestCompaction`（→ `visible-floor.trigger.ts:21` 再次 `session.list()`）互不共享。RT-01 的修复**没有**顺带解决它。
- **CD-01**（P1，core-data）——回滚 plan 与事务内状态不同源，**未触碰**。
- **CD-09**（P2，core-data）——usage-stats 复制了一份双形态解码分支（`content_blob != null` 判定两处各写一遍，失败语义相反），**仍在**。`usage-stats.service.ts:525-528` 与 `sqlite-message.repository.ts:125-133` 两份实现依旧。decoder 收口仍是 open。
- **RT-05 / RT-06 / RT-07 / RT-08**：均未触碰。
- **CS-14**（port JSDoc 与实现相反：文档说嵌套 `transaction` 抛 `NESTED_TRANSACTION`）——**本波新增了一处该模式的第二份实现**：`sqlite-message.repository.ts:91` 的 `runInTransactionOrConn` 按同一形状复制了 `revision-aware-vfs.service.ts` 的模块私有函数（注释自陈「避免 domain 层反向依赖 service 层」）。契约本身仍成立，但**同一模式现在有两份拷贝**，CS-14 的数量口径需相应更新。
- **CS-10**（AST 缓存无上界）——未触碰；不过 `batchInsert` 改按片下发后，`#{id0}..#{idN}` 动态 arity 的构造单位变小（每片 ≤200），对 §5 争议 #1 的「长 arity 退化」结论**方向有利但未实测**。

### 4.3 台账与本波结论**直接冲突**、需要 W7 裁决的一条

> **CD-10 的「不用 LIKE 粗筛」决策被本波推翻。**
> 台账原文（synth/core-data.md:93 + 争议栏）记的是「RULE 拍板不采用 LIKE 粗筛——去粗筛/去召回/分页封顶三点考虑，RULE 修复采纳」；RULE 现行口径也已改写为「**纯 ASCII keyword 走 parse 前 LIKE 粗筛命中才 parse**，keyword 含转义/非 ASCII 字符退回全量（SQLite LIKE 只折叠 ASCII，召回红线优先）」（`RULE.md:33`）。
> 也就是说：本波**同时**动了实现与 RULE 的决策依据，把「不做」翻成「有条件做」。裁决归属是全局台账（W7），不是本波；但 architecture.md §3 流 1 若要写搜索路径，必须采用新口径，否则会与 synth/core-data.md 的原文直接打架。

---

## 5. 新增公开面（index.ts / public 导出变化）

### 5.1 主入口 `packages/core/src/index.ts`（3 换名 + 0 新增）

| 旧符号 | 新符号 | 行 |
|---|---|---|
| `DEFAULT_COMPACTION_SYNC_BUDGET_MS` | `DEFAULT_DECOMPRESS_SYNC_BUDGET_MS` | `:99` |
| `getMessageCompactionStatus` | `getMessageDecompressStatus` | `:99` |
| `runMessageContentCompaction` | `runMessageContentDecompress` | `:101` |

类型同步换名：`MessageCompactionRunResult` → `MessageDecompressRunResult`、`MessageCompactionStatus` → `MessageDecompressStatus`、`RunMessageContentCompactionOptions` → `RunMessageContentDecompressOptions`（`:111-114`）。allowlist 快照 `main-entry-allowlist.json` 同步（净变化 0，纯换名）。

**破坏性**：三端 app 层全部跟进（desktop `db-maintenance.service.ts`、mobile `db-maintenance.service.ts`、cli `runtime.ts`），无遗漏。

### 5.2 `public/chat.ts`（+1 类型）

- `ReadResultRef`（`:108`）——从 `domain/chat/model/content-block.ts` 透出。
- **⚠️ `SkillResultRef` 未导出**。`public/chat.ts:101-111` 的 export 列表里有 `ToolResultBlock` 与 `ReadResultRef`，没有 `SkillResultRef`。由于 `ToolResultBlock.contentRef` 的类型是 `ReadResultRef | SkillResultRef`（`content-block.ts:59`），**消费方拿到 `ToolResultBlock` 却拿不到 union 的另一半类型**——要判 `kind === "skill"` 就得自己声明形状。desktop 侧靠 `ipc-types.ts:690-731` 手工镜像 DTO 绕过了这一点（能编译，但两侧形状靠人工同步）。**这是一个真实的公开面缺口，建议补导**。

### 5.3 `public/prompt.ts`（+1 值）

- `messageBodyTextFromBlocks`（`:24`）——从 `domain/prompt/logic/message-body.ts` 透出（该文件是 `domain/chat/content/message-body-text.js` 的 re-export，`messageBodyTextFromContent` 也在同处但未透出）。desktop `ipc/handlers/messages.ts:12-15` 用它做引用块占位投影。
- allowlist 快照 `public-prompt-allowlist.json` 同步（+1）。

### 5.4 `public/vfs.ts`（+1 值 +1 类型）

- `SqliteVfsRevisionRepository`（`:69`）——**这是本波最大的一处公开面扩张**：一个 sqlite repository 实现类第一次从 `public/vfs` 出口暴露。理由是三端 runtime 都需要 `new SqliteVfsRevisionRepository(conn)` 装配 read 计数通道与 hydrate 主链。装配纪律随之确立：「同 conn 单实例」。
- `VfsRevisionRepository`（`:70`，类型）——port 一并透出。
- allowlist 快照 `public-vfs-allowlist.json` 同步（+1 值；类型不进快照）。

**注意**：`public/vfs.ts` 此前**零 sqlite 实现类出口**（消费者拿到的都是 service 层）。本波开了这个口子，architecture.md §3 的 M2「对外接口」一节（`architecture.md:101`）只列了 `VfsService` / `RevisionAwareVfsService` / `VfsBatchIoService` / `TdbcConnection`，需补 repository + port。

### 5.5 未透出但已存在的新符号（供 CR 时的出口缺口登记）

| 符号 | 位置 | 谁在用 |
|---|---|---|
| `hydrateToolResultsForPrompt` / `ReadResultHydrateError` | `domain/chat/logic/hydrate-tool-results-for-prompt.ts:323` / `:86` | 仅 core 内部（prepare）。三端不需要，但四码 fail-fast 的排查文档未指向任何公开面 |
| `deriveSkillReadTruncation` / `deriveSkillLoadTruncation` | `domain/tool/logic/skill-read-truncation.ts:54` / `:115` | skill-tool + hydrate 共用。**这是「单源注释比单源实现多」那条结构性热点的正解案例**——本波选择「开内部出口」而非「复制两份」 |
| `aggregateReadRefs` / `adjustReadRefCount` / `collectReadRefs` | `domain/vfs/logic/revision-ref-count.ts:72` / `:98` / `:131` | 五个 ±1 挂点全在 core service 层，app 零消费 |
| `findMetaByEntryAndVersion` | `VfsRevisionRepository`（`vfs-revision.port.ts`） | hydrate 主链。**新 port 方法，但只被 hydrate 用** |

### 5.6 三端 app 层类型面（非 core 公开面，但属对外契约）

- `apps/desktop/shared/ipc-types.ts`：`ContentBlockDto.contentRef`（`:690`，两形态 union 手工镜像）、`MessageCompactionStatusDto` → `MessageDecompressStatusDto`（`:1663`）、`DbStatsResult.messageCompaction` → `messageDecompress`（`:1681`）。
- desktop renderer `MIGRATION_ROWS` 的 `kind` 从 `"messageCompaction"` 变 `"messageDecompress"`，label 从「消息正文压缩」变「消息正文明文化」（`apps/desktop/renderer/features/settings/migration-row-value.ts:15`）。
- mobile `storage-config-migration-values.ts` 的 `messageCompactionValue` → `messageDecompressValue`；`StorageConfigScreen.tsx:127` label 同改。
- 双端 `NovelMasterRuntime` / `MobileNovelMasterRuntime` / `NovelMasterRuntime`（cli）各新增必填字段 `revisionRepo: VfsRevisionRepository`（desktop `types.ts:108`、mobile `types.ts:103`、cli `runtime.ts:161`）。**必填**——任何自建 runtime 的宿主都要补这一行。

---

## 6. 一句话给 W7 的收口建议

architecture.md 的改写优先级：**A1/A2/A3（明文化正形态翻转）> A5（ref_count 持有者）> A6（RT-01）> A7（RT-03 池已删）> B1/B2/B3（新增事实）**。§4.3 那条「CD-10 的 LIKE 决策被本波翻转」需要在全局台账层面拍一次，否则 architecture.md 与 synth/core-data.md 会长期互相矛盾。§5.2 的 `SkillResultRef` 出口缺口与 §5.4 的「public/vfs 首次暴露 sqlite 实现类」是两条新增的架构面事实，建议一并写进 architecture.md 的 M1/M2 节。
