---
date: 2026-09-30
---

# chat_message 全库明文化 + skill read 引用化 技术规格（SPEC）

## 需求来源

非标准 PRD（用户口述，2026-09-30 三轮对话拍板）：

1. **B 方案立项**：msg 压缩（v1.5.25 发布的 message-content-compression）被认定为复杂度与性能双输的迭代；已发布不可回退数据形态，选择「全库明文化」重新设计——写侧直写明文 + 存量反向搬运解压。+36MB 库体积回涨已被用户明确接受（历史消息的一次性成本；真正的大头 read 回显已由 feat/read-tool-result-ref 引用化解决）。
2. **兼容链路能清理就清理**（用户原话强调）：各种 cache、双形态、防御性代码，凡为压缩形态服务的都应随本迭代兑现删除。
3. **skill read/load 引用化**：skill 工具与普通文件共用同一张 vfs_revision 版本链（探索已证实），其 load/read 的全文回显应与 vfs read 一样走 contentRef 引用化。
4. 提示词拼接/上下文统计的零行为差异已由探索证实（全链消费解码后对象、无压缩列旁路），本 spec 不再单独设步骤，仅在回归面覆盖。

前置依赖：**本迭代在 feat/read-tool-result-ref 分支上继续开发**（B 方案依赖 read-ref 的引用化兜底，同分支一起发版——binary-storage 集成分支先例）。

探索依据：五份 readonly 探索报告（2026-09-29/30，触点全景 / skill 工具链 / 提示词统计链路 / 三端接线与 UI / 测试门禁 / worktree 交汇面），关键证据均以 文件:行号 落在本文各节。

## 设计目标

1. chat_message 新消息零压缩：append/batchInsert/updateContent 直写 `content_json` 明文，`content_encoding`/`content_blob` 写 NULL。
2. 存量压缩行经后台反向搬运任务（谓词驱动、批处理、幂等可续跑）解压回明文；**迁移期读路径保持双形态**（既有「明文行永远合法」契约的反向版：「压缩行永远合法」）。
3. 兑现消息侧压缩复杂度的**最大化删除**：正向压缩任务及其三端接线、`encodeMessageContent`、messageContentPool（按 message id 的消息解压池）及 4 处失效义务、双端「消息正文压缩」状态行的旧语义（`BATCH_BUILD_CHUNK` **不在删除清单**——改名保留为「参数构造分片」，见 Part 1）。
4. skill read（必做）与 skill load（可选步骤）的 tool_result 引用化：不存全文、contentRef 落库、wire 经 hydrate 逐字节重放。
5. 提示词 wire、token 统计、压缩阈值、双端 renderer 行为零变化。

### 明确不做（边界）

- **不动 vfs_content_blob / session_file_cache_blob 的压缩**（独立迭代，contentBodyPool 继续服务它们）。
- **不删 chat_message 的两列**（列保留、数据清空；schema CHECK 约束原样——`content_encoding NULL` 天然合法）。SCHEMA_BOOT_VERSION 不 bump。
- **不做 searchMessages 的 LIKE 恢复**（存量行迁移期 content_blob 非空、LIKE 恒不命中；即使搬完也是独立优化项，与本迭代解耦）。全量精筛路径零改动。
- **不动 f-vfs-pack 分支的任何代码**（zlib 加速器、pack、fossil 都在另一分支，合并时零冲突预期）。

## 总体方案

四个部分，依赖顺序：Part 1（写侧明文）→ Part 2（反向搬运 + 正向终结）→ Part 3（缓存与兼容层清理）→ Part 4（skill 引用化，与 Part 1-3 无代码交集可并行）。

### Part 1：写侧明文化

`sqlite-message.repository.ts`：

- `toMessageParams`（:53-79）：删 `encodeMessageContent` 调用，`content_json = JSON.stringify(message.content)`、`content_encoding = NULL`、`content_blob = NULL`（INSERT 列清单保留两列名，显式绑 NULL）。
- `updateContent`（:371-388）：`SET content_json = ?, content_encoding = NULL, content_blob = NULL`。**必须三列齐置**——编辑一条存量压缩行时若只写 content_json，读路径按「blob 非空优先」仍会解压出旧正文（数据错乱而非崩溃，测试必须有牙锁死）。
- `readRowContent`（:82-94）双形态判定**保留**（迁移期存量行）。
- `BATCH_BUILD_CHUNK = 200`（:176）**保留但改名**为「参数构造分片」并更新注释：明文化后 `toMessageParams` 不再含同步压缩，但 `JSON.stringify` 与**参数数组内存驻留**（fork/copy 全量消息的明文 JSON，2-3× 于压缩 blob——消费处矩阵 #7）仍是同步重活，分片让步继续有效，理由从 CPU 换为内存与事件循环公平。

### Part 2：反向搬运任务 + 正向任务终结

**新文件** `packages/core/src/infra/db-maintenance/impl/message-content-decompression.ts`，骨架复用正向任务（`message-content-compaction.ts` 的 keyset 游标 + 批 100 + 单行短事务 + 零进展护栏 + stalled + 预算），方向反转：

- 谓词：`content_blob IS NOT NULL`（UPDATE 同条件进 WHERE 保并发幂等）。
- 行级动作：`decodeMessageContent(encoding, blob, id)` 解压 → `SET content_json = 明文, content_blob = NULL, content_encoding = NULL`。
- **坏行隔离**（decode 抛错只跳本行、行保持压缩形态、计入 `failedCount`、不阻断完成标记）——与正向坏行先例同款；fail-fast 会让一行坏数据让整轮永不收敛，而读路径双形态对压缩行本就自愈。
- KKV module **`nm-message-decompress`**（key `decompressDone`，值 JSON `{at, failedCount}`）——不复用旧 `nm-message-content` module，避免新旧语义混淆。
- **不挂收尾维护链路（VACUUM/checkpoint）**：解压是增容不是释放，无 freelist 可归还，VACUUM 只会全库重写白烧（与正向任务的语义差异，注释钉死）。
- **旧 pending 消费**：入口先读 `nm-message-content/startupMaintenancePending`（正向任务遗留），置位则补跑一次 **`runStartupMaintenanceOnce`**（进程级去重版——勿用手动的 `runDatabaseMaintenance`，后者不受去重约束、会与 blob 归一任务叠加出双 VACUUM），返回值非 null 才清 pending——与正向 `:277-290` 同款口径；`runPendingStartupMaintenance` / `runStartupMaintenanceOnce` 的公共逻辑随正向文件删除**搬迁**到反向文件（或抽到 db-maintenance 公共模块），保证历史库的维护欠账不悬空。
- **完成标记自愈**（防「标记闩锁」）：入口在 `decompressDone` 已置位时，先跑 `SELECT 1 FROM chat_message WHERE content_blob IS NOT NULL LIMIT 1`——命中（快照回灌等场景导致标记与数据形态脱节）即清标记继续搬；未命中才短路返回。成本一次索引级探测，永久消除「标记随整库快照 travels 且写死不校验 → 该库永久停在压缩态」这一整类问题。
- **收尾不变量**（与正向逐字对齐的承重约束）：收尾谓词校验 `leftover > failedKeys.size → stalled = true + 不置标记`——任何「看着扫完了」的提前退出都会让残留行被永久跳过（驱动静默写回不生效时游标扫完但谓词仍有行、failedKeys 为空，若无此校验任务会谎报完成并把残留行永久锁死在压缩态）。
- 采样节流：`getMessageDecompressStatus` 复用 3s WeakMap 按连接节流模式（`status-sampling-throttle` 先例）。
- 预算/守卫：`syncBudgetMs` 默认 60s、`shouldPause`、批间让步——全部同款。

**正向任务终结**：删 `message-content-compaction.ts` 整文件 + 导出（`packages/core/src/index.ts:96,98,100` 值导出与 `:110,111,113` 类型导出、`infra/db-maintenance/index.ts` 的对应行）+ `DEFAULT_COMPACTION_SYNC_BUDGET_MS` / `getMessageCompactionStatus` / `runMessageContentCompaction` 三个 allowlist 符号。**删正向谓词死结即消**：明文行成为唯一新形态后，旧谓词 `content_json != ''` 的「新旧同形不可区分」问题不复存在（任务本身已删）。

**三端接线换向**（调度器骨架全部保留，换入口函数与日志标签）：

| 端 | 文件 | 改动 |
|---|---|---|
| desktop | `apps/desktop/src/main/services/message-content-compaction.service.ts` | 重命名为 `message-content-decompression.service.ts`，调用换 `runMessageContentDecompress`；守卫组合（agent/maintenance/cloudSync busy）、5s 退避、重取 runtime、`isConnectionClosedError` 重挂、stalled 收手全保留 |
| desktop | `apps/desktop/src/main/main.ts:28,177` | import 与启动挂点改名 |
| mobile | `apps/mobile/src/services/message-content-compaction.service.ts` + `runtime/novel-master-context.tsx:52,233` | 同款换向（启动 3s 延迟、runtime 身份去重保留） |
| cli | `apps/cli/src/runtime.ts:10,187` | 内联 `await runMessageContentDecompress(conn)`（默认预算），注释更新 |

**UI 状态行**（两端同构，`MIGRATION_ROWS` 行保留但语义反转）：

- desktop：`migration-row-value.ts:14-18`（kind `messageCompaction` → `messageDecompress`，label「消息正文明文化」）+ `:34-46` 取值分支（done/进行中剩余 N 条/—）；`SettingsViews.tsx:588-621` 区块 desc 文案更新。
- mobile：`storage-config-migration-values.ts:23-35` + `StorageConfigScreen.tsx:118-135,183` 同款。
- DTO：`apps/desktop/shared/ipc-types.ts:1640` `MessageCompactionStatusDto` → `MessageDecompressStatusDto {done, pendingCount}`（字段形态不变，改名）；**连带字段名**：`DbStatsResult.messageCompaction`（ipc-types.ts:1657）与 mobile `DbStatsSnapshot.messageCompaction`（db-maintenance.service.ts:99）同步改名 `messageDecompress`（IPC 双端一起改，不留新旧混名）；两端 `db-maintenance.service.ts` 的采样函数随改（desktop `:58-70`、mobile `:66-75`）。
- UX 语义说明（写进 CHANGELOG）：老用户升级后状态行会从「已完成（压缩）」回到「进行中（解压回明文）」——这是 B 方案的预期行为，非 bug。

### Part 3：缓存与兼容层清理

1. **messageContentPool 整体删除**：`infra/content-cache/logic/decoded-content-cache.ts` 的 messageContentPool（:195-199）+ `lookupDecodedMessageContent` / `rememberDecodedMessageContent` / `forgetDecodedMessageContent`（:226/:235/:247）三 API + `clearDecodedContentCaches` 里的第二池调用（:252-255）。**contentBodyPool 与 `clearDecodedContentCaches`（收窄为单池清理）保留**——它继续服务 vfs/file_cache 两链。迁移期存量压缩行的重复读退化为每次解压（短窗口可接受，用户拍板清理优先）。
2. **repo 4 处 `forgetDecodedMessageContent` 调用删除**（`sqlite-message.repository.ts:386/393/415/435`）。
3. **`message-content-codec.ts` 瘦身**：`encodeMessageContent` 删（无消费方）；`decodeMessageContent` 保留为**纯函数解码器**（去池逻辑），消费方共**四处**——readRowContent（`sqlite-message.repository.ts:85`）、usage-stats（`usage-stats.service.ts:525`）、**read-ref repair 全表扫**（`revision-ref-count.ts:183` `aggregateReadRefsFromAllMessages`，低频、迁移期保持双形态）、反向任务（新文件）；文件头注释改述「明文为正形态，本文件仅为迁移期压缩行服务，V1' 退役」。
4. **usage-stats 保持双形态读**（`usage-stats.service.ts:515,525-530`）：本迭代**零改法**——三元判定与坏行 try/catch warn 按 0 计全部保留，仅随 codec 瘦身自动失去池回填；单形态收口与 readRowContent 一起推到 V1'。
5. `listMessageHeadersBySession`（:249-269）的「不选 content 列即不解压」注释改为陈述性说明（明文化后对新行自动成立）。
6. `novel-master-bootstrap.ts:102-110` 的 v17 注释块补一行：明文化决策（2026-09-30）与反向任务过渡期说明。

### Part 4：skill read/load 引用化（read-ref 机制延伸）

探索确认的三个关键事实：(a) skill 与 vfs read 共用同一 `BuiltinToolContext`，`adjustRevisionRefCount` 通道**零装配改动**天然可用；(b) skill read 的 wire 实际走 `formatReadOutput`（`format-tool-output.ts:30-38` 的 `isReadOutput` 按 path/content/totalLines/returnedLines/truncated 判定，skill read 输出全齐）——但截断管线不同（skill 用 `truncateLine`+`capUtf8Bytes`，vfs read 用 `capUtf8BytesFill`），重放必须复刻 skill 管线；(c) meta 域 revision 与普通文件同表同触发器，ref_count 第三类持有者语义直接适用。

改动链（六件）：

1. **port 透传**：`skills.port.ts:23-30` `SkillFileContent` 加 `entryId?: number; contentHash?: string | null; totalBytes?: number`——**与上游 `VfsReadResult`（`vfs-service.port.ts:30-34`）逐字对齐的可选/可空形态**（contentHash 在无 hash 行上真为 null）；`skills.service.ts:328-335`（readSkillFile）把 `vfs.read()` 已返回的三件套挑出来透传（数据在手，只差挑选）。可选声明同时避免打穿三个既有测试 mock（`agent-runner.test.ts:135`、`prepare-skill-attach.test.ts:113/272`、`skill-tool.test.ts:56`）。
2. **skill-tool +1 与输出补字段**（`skill-tool.ts`）：read 分支（:409-414 后）与 load 分支（:359-364 后）照抄 vfs read 的模式——`refAnchored = entryId != null && typeof contentHash === "string" && contentHash !== "" && totalBytes != null && ctx.adjustRevisionRefCount != null`（判空口径照抄 `vfs-tools.ts:238-241`），先 `await ctx.adjustRevisionRefCount([{entryId, version}], +1)`（NOT_FOUND 即调用失败），输出带 `entryId/contentHash/totalBytes`。**outputSchema 必须同步声明**（`skill-tool.ts:289-344` 的 `z.discriminatedUnion` read/load 两支各加 `entryId: z.number().int().optional()` / `contentHash: z.string().optional()` / `totalBytes: z.number().int().optional()`——照 `vfs-tools.ts:171-173` 先例；**不声明会被 zod strip 静默剥离**：`tool-runner.ts:109-113` 的 `safeParse` 对未声明键不报错直接丢弃，产块门拿不到 entryId → skill read 静默回落 legacy 全文、不 +1 不产引用块，整块收益归零且无任何报错）。**alreadyReferenced 的 load 不 +1、不产 ref**——seen 判定保持在 `readSkillFile` 之后原位（现有代码顺序），tip 分支照旧返回 `version`（seen 前置会拿不到 `result.version` 且 outputSchema 的 version 必填——不改现有顺序，只是该形态天然无引用化收益，块体极小）。
3. **ref 类型扩展与窄化策略**：`content-block.ts:100-120` 新增 `SkillResultRef`（判别字段 `kind: "skill"`；字段 `action: "load" | "read"`、`domain`、`name`、`path`、`entryId`、`version`、`contentHash`、`totalBytes`、`offset`、`limit`、`returnedLines`、`totalLines`、`truncated`、`nextOffset?: number`（skill read 的 wire 经 formatReadOutput，`truncated=true` 时附 `Continue with offset=N.`，与 `ReadResultRef` 同款透传）、load 专属 `files: string[]`）；`ToolResultBlock.contentRef: ReadResultRef | SkillResultRef`（:59）。**窄化策略（向后兼容）**：`ReadResultRef` 加 `kind?: "read"`（缺省即 read——存量行与存量 JSON 均无 kind），全链窄化统一判 `contentRef.kind === "skill"`，parse 先按 kind 分派再走各自白名单（`parseReadResultRef` 不得吞掉 skill ref 的 `action/domain/name/files`）；hydrate 读 `lastLineTruncated` 等字段处、desktop `handlers/messages.ts:95` 占位、DTO 镜像三处同口径窄化。**产块门字段校验按 action 拆两套**：read 分支校验全量（含 offset/limit/returnedLines/totalLines/truncated/nextOffset）；load 分支只校验 `version/truncated/files/三件套`（load 输出本无分页字段，`formatSkillLoadOutput` 只吃 path/content/truncated/files）。**desktop DTO 镜像同步**（`apps/desktop/shared/ipc-types.ts:687-700` 的 contentRef 镜像扩为带 kind 的 union；`handlers/messages.ts:77-100` 的占位渲染按 kind 分文案——skill 引用块显示 `[skill ref: domain/name]` 而非误标 `[read ref: path]`）。
4. **产块门**：`build-tool-result-block.ts` 新增 `resolveSkillResultRefFromOutcome(toolName, output)`（判 `toolName === "skill" && action ∈ {load, read}` + 必需字段校验），与 `resolveReadResultRefFromOutcome`（:65-109）在调用点（:333-336）并列二选一；summary 分支（:172-214）零改动（UI 卡片继续吃 summary）。
5. **hydrate 重放**：`hydrate-tool-results-for-prompt.ts` 新增 `replaySkillReadWireText` 与 `replaySkillLoadWireText`（`formatSkillLoadOutput` + ref 内 `files`，输入全确定性）；**截断推导单源化**——把 skill-tool read 分支的内联推导（`skill-tool.ts:426-446` 的 truncateLine+capUtf8Bytes 管线与 returnedLines/truncated/nextOffset 推导）抽为纯函数置于 `domain/tool/logic/`（避免 chat/logic 反向依赖 builtin），skill-tool 与 hydrate 重放共用同一份（「单源」指共享推导函数，不是复制两份管线）；memo 键带 action；fail-fast 码复用四码体系（修订五路径删除挂点对 skill ref 同样生效——消息删除的 refs 扫描按块类型含 SkillResultRef）。
6. **parse 白名单**：`parse-message-content.ts:119-175` 加 `SkillResultRef` 分支（逐字段 fail-fast，口径与 ReadResultRef 一致）。

**skill load 的 alreadyReferenced=true 形态排除引用化**（wire 是常量 tip、块体极小）；**skill write/edit 不动**（回显本来就是 `{version}`/`{version, replacements}` 小对象）。

### 关键设计依据（为什么这样做）

- **反向任务不挂 VACUUM**：解压增容、无 freelist 归还；正向任务挂 VACUUM 是因为压缩释放页空间。
- **坏行隔离而非 fail-fast**：一行坏数据不应让整轮永不收敛；读路径双形态对未搬完的行自愈（读到的是旧压缩内容——语义正确，因为该行从未被成功改写）。
- **KKV 新 module**：旧 `nm-message-content/compactionDone` 的语义是「压缩完成」，新任务用 `nm-message-decompress/decompressDone`，两代标记互不干扰；旧 `startupMaintenancePending` 由新任务入口消费（一次性欠账清偿）。旧 `compactionDone` 标记行保留不清理（无害孤儿，登记为已知取舍）。`MESSAGE_DECOMPRESS_KKV_MODULE` / `MESSAGE_DECOMPRESS_KKV_KEY` 常量从 `infra/db-maintenance/index.ts` 导出（T-MP2 断言标记置位需要）。
- **明文形态是双向可逆的事实陈述**（非回滚承诺）：明文行是正向压缩谓词的天然合法目标——这是形态设计上的对称性说明，不是本迭代的回滚依据（用户拍板 2026-10-01：回滚意义不大，逻辑合理性优先）。

### 数据消费处 × 性能语义总表（第 1 轮审查固化）

「消费处 × 明文化前后性能语义」全景（代码位置以本 worktree 为准）：

| # | 消费处 | 代码位置 | 明文化前→后 | 护栏/验收 |
|---|---|---|---|---|
| 1 | agent 每 step 读 | `chat-agent-session.ts:30-39` → `listBySession(includeHidden:false)` | SQL 取字节 2-3×↑、inflate 归零，净收益 | T-MP-P0 |
| 2 | 提示词拼接 | `agent-runner.ts:449` prepare、`run-agent-turn.ts:912/1269` | 同 #1，纯 CPU↓ | T-MP-P0 |
| 3 | token 统计/压缩阈值 | `usage-stats.service.ts:512-539`、compaction-conditions 走 evaluation | SQL 字节↑、inflate↓ | 正确性用例 |
| 4 | desktop 会话面板全量列表 IPC | `handlers/messages.ts:128` → toDto → ConversationPanel | **IPC 载荷不变**（DTO 恒为解码后明文，压缩从未减少 IPC 字节）；变的是 main 进程 SQL 取字节 | T-MP-P0 + IPC 断言（DTO 不含 raw blob 形态） |
| 5 | mobile 列表读 | `session-stream-unit.ts:988/1053`（page/tail）、manager `:963/994`、SubagentSessionScreen `:97` | 同进程无序列化，SQL 字节↑/inflate↓；WebView bridge 载荷不变（`message-blocks.ts:268` 恒明文） | T-MP-P0 |
| 6 | 搜索 | `sqlite-message.repository.ts:502-591` keyset 精筛 | 同上；LIKE 不恢复（边界） | 既有用例 |
| 7 | fork/copy | `message.service.ts:320/381`、`session.service.ts:388/396` 全量读→batchInsert | **参数数组驻留明文 JSON（2-3× 内存↑），本迭代唯一内存/GC 恶化点** | BATCH_BUILD_CHUNK 改名保留（见 Part 1） |
| 8 | usage-stats 现算 | 同 #3 | 同 #3 | 正确性用例 |
| 9 | checkpoint backfill | `backfill-baseline-checkpoints.ts:114` offset 段 + `:156/249` 头投影 | 新增段小、头投影不选 content 列零影响 | 既有用例 |
| 10 | db-maintenance 双任务 | 反向任务新文件；blob 归一 `blob-binary-normalization.ts:113` | 两任务谓词**可交叠**（`zlib-b64` 行同时命中反向谓词与归一谓词）但**收敛顺序无关**（任一先跑，另一谓词重扫后自然收敛）；归一的 messageContent adapter 迁移完成后成死代码（V1' 删） | T-MP2/3 |
| 11 | 云同步/备份 | `cloud-sync-coordinator.ts:246` 整库快照上传 | **每次 push 上传 +~36MB（≈1.5×）、导出耗时与续租次数上升**（用户可感知成本，进风险表与 CHANGELOG） | 风险登记 |
| 12 | read-ref repair 全表扫 | `revision-ref-count.ts:166-200` `aggregateReadRefsFromAllMessages`（`decodeMessageContent` 第四消费方） | 低频全表扫：字节↑、inflate↓，净收益 | 双形态读天然覆盖 |
| 13 | CLI 全量读 | `apps/cli` message/prompt/model/agent 四命令 `listBySession` | 短命进程，同 #1 | 无需护栏 |

## 最终项目结构

```
packages/core/src/
├─ domain/chat/
│  ├─ content/parse-message-content.ts          [改] +SkillResultRef 分支
│  ├─ logic/hydrate-tool-results-for-prompt.ts  [改] +skill 两条重放函数、memo 键带 action
│  ├─ logic/message-content-codec.ts            [改] 删 encode、去池、纯解码器（迁移期）
│  └─ model/content-block.ts                    [改] +SkillResultRef、contentRef union
├─ domain/chat/repositories/impl/sqlite-message.repository.ts
│                                               [改] 写侧明文三列、删 4 处 forget、BATCH_BUILD_CHUNK 改名保留（参数构造分片）
├─ domain/tool/builtin/skill-tool.ts            [改] +1 挂点、输出补三件套/files、outputSchema 声明三件套、seen 判定原位（不前置）
├─ domain/tool/logic/skill-read-truncation.ts   [新] skill read 截断推导纯函数（truncateLine+capUtf8Bytes 管线与 returnedLines/truncated/nextOffset），skill-tool 与 hydrate 重放单源共用
├─ domain/tool/logic/build-tool-result-block.ts [改] +resolveSkillResultRefFromOutcome
├─ infra/content-cache/logic/decoded-content-cache.ts
│                                               [改] 删 messageContentPool 与三 API、clear 收窄
├─ infra/db-maintenance/
│  ├─ impl/message-content-decompression.ts     [新] 反向搬运任务
│  ├─ impl/message-content-compaction.ts        [删] 正向任务
│  └─ index.ts                                  [改] 导出换向
├─ service/chat/impl/usage-stats.service.ts     [改] 随 codec 瘦身（双形态读保留至 V1'）
├─ service/skills/{skills.port.ts, impl/skills.service.ts}
│                                               [改] SkillFileContent 透传三件套
├─ bootstrap/novel-master-bootstrap.ts          [改] v17 注释补明文化决策
└─ index.ts                                     [改] 导出换向（6 行）
apps/desktop/src/main/{services/message-content-decompression.service.ts(改名), main.ts}
apps/desktop/{shared/ipc-types.ts, renderer/features/settings/{SettingsViews.tsx, migration-row-value.ts}}
apps/mobile/src/{services/message-content-decompression.service.ts(改名), runtime/novel-master-context.tsx,
                 services/db-maintenance.service.ts, screens/stack/{StorageConfigScreen.tsx, storage-config-migration-values.ts}}
apps/cli/src/runtime.ts                          [改] 调度换向
packages/core/test/package-exports/snapshots/main-entry-allowlist.json [改] 3 符号
测试：删 2 文件、改约 10 文件（见测试策略）、新增 2 文件
```

## 变更点清单

见「最终项目结构」与各 Part；全部变更均落在 feat/read-tool-result-ref 分支。CHANGELOG `[Unreleased]`：变更一条（消息正文存储回归明文 + 反向迁移 + skill read 引用化）+ 修复面无。

## 详细实现步骤

- Step 1 — phase-plaintext-write — blocking: yes — qa: auto：写侧明文化（toMessageParams/updateContent 三列 SET、**删除 encodeMessageContent 的两处调用点**——函数本体与 roundtrip 测试随 Step 4 一起删，避免 Step 1→9 期间测试运行期红、BATCH_BUILD_CHUNK 改名「参数构造分片」并更新注释、readRowContent 注释改述）。验收：T-MP1。
- Step 2 — phase-decompress-task — blocking: yes — qa: auto：新反向搬运任务（谓词/批/游标/坏行隔离/KKV nm-message-decompress/预算/节流采样/旧 pending 消费/入口自愈/收尾不变量/无 VACUUM）。验收：T-MP2（含收尾不变量与自愈断言）、T-MP2b、T-MP3、T-MP-P1、T-MP-P2。
- Step 3 — phase-forward-removal — blocking: yes — qa: auto：正向任务删除 + 三端调度换向（desktop/mobile/cli）+ 导出与 allowlist 快照。验收：T-MP5、全量 typecheck。
- Step 4 — phase-cache-cleanup — blocking: yes — qa: auto：messageContentPool 删除 + 4 处 forget 删除 + codec 瘦身纯函数 + usage-stats import 随改 + clear 收窄。验收：T-MP4、T-MP6。
- Step 5 — phase-ui-status — blocking: yes — qa: auto：双端状态行换语义 + DTO 改名 + 两端采样函数 + 全部关联测试同步。验收：T-MP7。
- Step 6 — phase-skill-port — blocking: yes — qa: auto：SkillFileContent 透传三件套（port + service）。验收：T-SR1 前置（service 层透传断言）。
- Step 7 — phase-skill-read-ref — blocking: yes — qa: auto：skill read 引用化全链（+1 挂点、SkillResultRef 类型与窄化策略、产块门、replaySkillReadWireText、parse 白名单、删除挂点扩展）。验收：T-SR1、T-SR2（含同 turn 重复读偏差）、T-SR3、T-SR5、T-SR6、T-SR7。
- Step 8 — phase-skill-load-ref — blocking: no — qa: auto：skill load 引用化（files 存 ref、replaySkillLoadWireText、alreadyReferenced 形态排除——seen 判定保持原位、天然不产 ref，**不前置**）。可按量化结果裁剪（SKILL.md 全文回显若实测占比可忽略，本步骤降级为不做，产块门只放 read）。验收：T-SR4。
- Step 9 — phase-tests-docs — blocking: yes — qa: auto：测试收口（Step 4 未覆盖的剩余测试处置：desktop/mobile 关联件、allowlist 快照复核——**删 3 增 3 已随 Step 3 完成**（`DEFAULT_DECOMPRESS_SYNC_BUDGET_MS` / `getMessageDecompressStatus` / `runMessageContentDecompress`，类型不在值级白名单内），本步复核不重改）+ CHANGELOG + spec 执行注记 + RULE 术语更新（「消息正文压缩列」条目改述为历史形态 + V1' 退役计划）。验收：全部套件绿。
- Step 10 — phase-regression — blocking: yes — qa: auto：core 全量（预期基线：唯二时区红）+ desktop（--test-concurrency=2）+ mobile（--maxWorkers=2）+ 三端 tsc + 与 read-ref 既有回归（read-ref 系列用例零回归——明文化不动 contentRef 语义）+ **稳态读性能护栏落地**（T-MP-P0/T-MP-P0b 在此处验收——护栏随回归轮统一跑，基线构造走 compressZlib + 裸 INSERT）。
- Step 11 — phase-real-db — blocking: no — qa: manual_user：真实库升级链验收（模拟器 Metro 热更 + 真库副本：启动→反向搬运收敛→库体积回涨至 ~100MB 预期→5350 行逐条与压缩前明文全等→二次启动零重扫→skill read 真轮引用块→收尾把真机/模拟器 DB 还原回测试前副本）。

## 测试策略

### 测试用例

core 新增/改写（T-MP = 明文化、T-SR = skill 引用化）：

- T-MP1 — blocking: yes：写侧明文三态——新 append/batchInsert 行 content_json 非空且 blob/encoding 为 NULL；**updateContent 改写存量压缩行后三列齐置**（反例：只写 content_json 时读路径回旧正文——该反例锁死三列 SET 的必要性）。
- T-MP2 — blocking: yes：反向搬运 round-trip——压缩行（test helper 直压构造）搬完逐条与构造原文全等、`content_blob IS NOT NULL` 归零、KKV 标记置位、**二次调用零 COUNT 谓词**（探针断言；标记已置位路径只允许 1 次 `LIMIT 1` 自愈探测，探针计数断言恰好一次）；**收尾不变量**——构造「驱动写回不生效」桩（UPDATE 影响行数为 0），断言 marker 未置且 stalled 透传（leftover > failedKeys.size 分支的牙齿）。**标记自愈**——marker 已置位但库中仍有压缩行（模拟快照回灌）时，入口 LIMIT 1 探测命中即清标记续搬。
- T-MP2b — blocking: yes：迁移中断续跑——构造「部分行已搬 + 部分行未搬」中间态（模拟断电后重启；`syncBudgetMs: 0` 截断首轮即可造出），续跑从谓词剩余集继续、已搬行不重复 UPDATE（探针计数）、终态全等（隐含锁死「中断不得置标记」）。
- T-MP-P0 — blocking: yes：**稳态读不劣化护栏**（替代被删除的正向 perf-threshold 两条）——明文形态下 tail 加载/每步可见读耗时**不劣化于「同 fixture 压缩形态 + inflate」基线**（硬阈值：明文耗时 ≤ 压缩基线 ×1，另设绝对预算上限兜环境噪声——对齐 RULE「性能护栏取数量级回归线」，倍数写死防漂移）。这是「明文化对性能是纯收益」核心主张的唯一自动证据。**基线构造方式**：压缩基线行不经生产 API（Step 4 后 `encodeMessageContent` 已删、`batchInsert` 已写明文）——用 `compressZlib`（`@/domain/vfs/content-store/logic/zlib-codec`）+ 裸 `INSERT INTO chat_message` 直造，与生产写路径解耦（迁移期夹具同款口径，测试文件处置同步注明）。
- T-MP-P0b — blocking: yes：desktop IPC DTO 形态断言——messages 列表 DTO 的 content 恒为明文文本（不含压缩字节/raw blob），防未来把存储形态泄漏进 IPC。
- T-MP3 — blocking: yes：坏行隔离——decode 失败行保持压缩形态、failedCount 透传、完成标记照置、读路径对该行返回旧压缩内容（语义正确性）。
- T-MP4 — blocking: yes：迁移期混存读——同库压缩行 + 明文行混合，listBySession/searchMessages/tail 全部正确分派。
- T-MP5 — blocking: yes：正向任务删除后——新库启动无正向挂载（三端 service mock 断言零调用）、旧 `nm-message-content/startupMaintenancePending` 置位库被新任务入口消费并清除（回调计数探针）。
- T-MP6 — blocking: yes：池删除正确性——存量压缩行在无 messageContentPool 环境下重复读结果一致（性能不设断言，只锁正确性）。
- T-MP7 — blocking: yes：双端状态行三态取值（纯函数）+ IPC 字段贯通 + 采样抛错降级 null。
- T-MP-P1 — blocking: yes：反向搬运用时护栏——100 行压缩→明文解压写回 vs 同构明文全量读基线（硬阈值 ×25 数量级，对齐原 perf-threshold 的倍数形态）。
- T-MP-P2 — blocking: yes：搬完零重扫（T-MP2 的探针面独立成例；口径同为「零 COUNT 谓词 + 自愈探测恰好一次」）。
- T-SR1 — blocking: yes：skill read 引用化 round-trip——落库块 content=""、contentRef 全字段、+1 已发生（ref_count 断言）、**wire 逐字节等值**（hydrate 重放 vs formatToolOutputForLlm 原文）；**outputSchema 牙齿**——输出对象经 ToolRunner.call（safeParse strip 路径）后 entryId/contentHash/totalBytes 三件套仍在（防 zod 静默剥离回归）。
- T-SR2 — blocking: yes：skill read 计数对账——read 后 edit 中间版本 sweep 保活（T-RR5 skill 版）；消息删除挂点对 SkillResultRef 的 -1 生效；**同 turn 重复读偏差**——同一消息内两次 `skill read` 同一文件（collectReadRefs 按消息内 (entryId,version) 去重、+1 按调用发生两次）→ 断言删除后 ref_count 净值 ≥0 且偏差方向为「只增不减」（登记为已知偏差：不误删数据但阻碍 sweep 回收，与 read-ref 分支既有决议同口径；skill 场景因 load 后 read/探索式重读更易触发）。
- T-SR3 — blocking: yes：skill read 分页重放——offset/limit 多变体 wire 等值（skill 截断管线与 vfs read 管线的差异面）。
- T-SR4 — blocking: no：skill load 引用化 round-trip（若 Step 8 执行）——files 清单重放、alreadyReferenced 形态仍走全文常量 tip 不产 ref。
- T-SR5 — blocking: yes：ZIP 导入后旧引用定位——技能重开 entry 后旧 contentRef 仍 hydrate 旧内容（T-RR9 skill 版）。**前提写死**：断言不依赖 ZIP 导入的具体实现形态——导入无论走 `sweepRevisionsUnderScope`（旧 revision 靠 +1 存活）还是仅 `deleteVfsPrefix`（旧 revision 泄漏存活），(entryId, version) 定位与 hydrate 都必须工作（hydrate 只查 vfs_revision 不回读 vfs_entry 行，两条路径天然满足——用例两条路径各跑一遍钉死）。
- T-SR6 — blocking: yes：技能删除后引用保活——删除被消息引用的技能（skills.service `sweepRevisionsUnderScope` 路径），revision/blob 因 ref_count>0 被 sweep 保活、消息 hydrate 正常（T-RR5 的 skill 版生命周期边界）。
- T-SR7 — blocking: yes：技能改名后引用定位——`updateSkillInfo` 的 renaming 走 `vfs.renamePrefix`（单事务 path REPLACE、entry_id 保留），断言改名后旧 contentRef 仍按 (entryId, version) hydrate 正常、wire 等值（生命周期矩阵补 rename 格）。
- 既有契约保留：明文直插行可读（原 T-C12 缩编进 repo 层用例，对齐 e2e fixture `tool-turn-session.sql` 契约）。

测试文件处置（探索 n2 清单执行）：

- 删（**随 Step 4 执行**，与 codec/池删除同批）：`chat/message-content-codec-roundtrip.test.ts`、`chat/message-content-decode-cache.test.ts`。
- 改（随 Step 4）：`infra/content-cache/decoded-content-cache.test.ts`（1 条消息池 `it` + 3 处 import 随 API 删除而清，contentBodyPool 用例保留——该文件是 Step 4 删池的必红点，缺它清单不完整）；（随 Step 9 收口）：`chat/message-content-perf-threshold.test.ts`（两条正向护栏→T-MP-P0/P1/P2，基线构造改 compressZlib+裸 INSERT）、`infra/message-content-compaction*.test.ts` 三件（骨架改写为 decompression 测试，OQ-I7 互斥断言删、bad-row 桩点换 decode、maintenance 夹具改压缩行）、`infra/status-sampling-throttle.test.ts`（谓词换向）、`chat/usage-stats.service.test.ts`（:1590 坏 blob 行用例改「迁移期双形态」口径）、allowlist 快照删 3 增 3、desktop 四件（compaction-service/migration-row-value/db-maintenance-handlers/settings-db-maintenance-ui）、mobile 四件（compaction-service/db-maintenance/storage-config-migration-values/storage-config-screen-source）。
- 保留零改动：`bootstrap/message-content-compression-schema.test.ts`（列不删、v17 锚点仍成立）、`schema-align-columns.test.ts`、`bootstrap-no-migrate.test.ts`、`legacy-db-fixtures.ts`、`db-maintenance.test.ts`、e2e fixture。
- 新增：`infra/message-content-decompression.test.ts`（T-MP2 含收尾不变量与自愈断言 / T-MP2b 断点续跑 / T-MP3 / T-MP-P1 / T-MP-P2 / T-MP5 pending 消费）、`chat/skill-result-ref.test.ts`（T-SR1~7 全量含 T-SR6 删除保活与 T-SR7 改名定位；skill 夹具用真 service 建 global/project 两域技能文件）。

### 回归面

- read-ref 既有用例（T-RR1~13）零回归——明文化不触 contentRef 语义；hydrate 双链照旧。
- 三端全量：core（基线唯二时区红）、desktop（--test-concurrency=2，基线既有债）、mobile（--maxWorkers=2，基线 mermaid 红）、三端 tsc。
- 真实库升级链（Step 11，manual_user）：压缩形态库（tmp/nm-real-v2.db 衍生或新备份）→ 反向搬运收敛 → 逐条全等 → 库体积 ~100MB 预期 → 二次启动零重扫 → skill read 真轮。

## 风险与已知取舍（逻辑合理性优先）

| 风险/取舍 | 定性与处置 |
|---|---|
| 存量库迁移期启动慢（34MB 解压） | 预算制 + 守卫让路（agent 活跃/维护 busy）+ 谓词快路径短路；移动端 Hermes fflate 分摊在多轮预算内，不阻塞 UI |
| **迁移中断恢复**（断电/进程被杀） | 单行短事务 + 谓词进 UPDATE WHERE——中断后下次启动谓词重扫续跑，已搬行不重复搬（正向任务同款已验证模式）；T-MP2b 断点续跑用例锁死 |
| 库体积回涨 ~36MB | 用户已拍板接受（历史一次性成本）；CHANGELOG 明示 |
| **云同步/备份成本上升**（消费处矩阵 #11） | 每次 push 快照上传 +~36MB（≈1.5×）、导出耗时与续租次数上升——用户可感知，进风险披露与 CHANGELOG，不做技术处置（整库快照是既有形态） |
| updateContent 漏置 blob 两列 → 读旧正文 | T-MP1 反例锁死；代码评审重点项 |
| skill wire 重放不等值（截断管线差异） | T-SR1/SR3 逐字节断言；skill read 截断推导抽为 `domain/tool/logic/` 纯函数，skill-tool 与 hydrate 重放共用单源 |
| 正向任务删除后旧 pending 悬空 | T-MP5 探针锁死消费路径 |
| 反向任务与用户操作并发 | 单行短事务 + 谓词进 UPDATE WHERE（幂等）+ busy 守卫让路——正向任务同款已验证模式 |
| **Step 1-5 必须同批发布** | Step 1（写侧明文）落地而 Step 3（正向任务删除）未落地时，旧正向任务谓词 `content_json != ''` 会把新写的明文行**重新压回去**——开发期这是预期现象（不要据此判断 Step 1 没生效），发布切片上 Step 1-5 作为一个不可拆分的变更单元随版本发布（与 Context Bundle 口径一致） |
| **跨版本混布与标记闩锁**（多端云同步，两现象同根因） | 根因：完成标记随整库快照 travels 且写死不校验——pull 回灌可让标记与数据形态**双向失效**（A 置的 decompressDone 被 B 的旧快照带回 → A 的库永久停在压缩态、反向任务再也不跑、**该用户拿不到本迭代核心收益**；反向也可能带回 compactionDone 谎报）。**处置**：Part 2 的入口自愈（标记已置位时 LIMIT 1 探测、命中即清标记续搬）一次性消除整类问题。旧版设备的正向任务在主流路径下不会重压明文（其 compactionDone 已置位、入口短路），窄前提下的过渡期翻转数据仍可读（双形态契约），随全设备升级收敛——登记为已知残余 |
| fork/copy 参数数组内存 2-3×（消费处矩阵 #7） | BATCH_BUILD_CHUNK 改名保留（分片让步继续），峰值内存 = 全会话明文 ×1 为已接受代价 |

### 逻辑合理性总结（替代原「回滚预案」）

用户拍板（2026-10-01）：回滚预案意义有限（上次压缩迭代同样无法真正回滚），**方案自身的逻辑正确性才是质量闸门**。本方案的形态保障是：明文行与压缩行在双形态读路径下**同时永远合法**（v1.5.25 起的既有契约，本迭代反向沿用）——任何中间态（部分行明文、部分行压缩、新旧任务交替、跨版本快照混布）下数据都可读且语义正确，不存在需要「回滚」才能恢复的数据锁定状态。发布后若发现实现级缺陷，处置手段是常规 hotfix（停跑反向任务/修 bug），与存储形态设计无关。

## 生命周期（V1' 退役清单）

反向搬运完成标记在用户群稳定置位后（约 10 tag 节奏，与既有 migration 清理惯例同轮）：

1. 删 `readRowContent` 的 blob 分支与 `decodeMessageContent`（含 message-content-codec.ts 文件）——**前置消费者四处**：readRowContent、usage-stats、`revision-ref-count.ts:183`（repair 全表扫）、反向任务本体；
2. usage-stats 三元收口单形态、revision-ref-count 同步收口；
3. 删 `message-content-decompression.ts` 与三端调度器、状态行、DTO、allowlist 符号；
4. 删 blob 归一任务的 `messageContent` adapter（谓词恒空的死代码）；
5. schema CHECK 约束收窄评估（`content_encoding` 列是否随列清理一并处理，届时拍板）；
6. 本 spec 的「压缩行永远合法」契约声明随之退役。

## Context Bundle

```yaml
iteration_name: message-plaintext
requirement_path: 用户口述（2026-09-30 三轮对话，docs/apm/memory/20260927-worktree-123-verify-guide.md ⑨~⑫ 段）
spec_path: docs/Iterations/message-plaintext/spec.md（落 f-read-ref worktree）
explore_summary: >
  五份 readonly 探索报告：① msg 压缩触点全景（codec 3 消费点、两池架构、searchMessages 精筛、
  谓词死结）；② skill 工具链（meta 域同表版本链、5 action 形态、引用化三缺口）；
  ③ 提示词统计零耦合（全链消费解码后对象）；④ 三端接线与 UI（调度器骨架、状态行、
  KKV 双标记、备份云同步透明）；⑤ worktree 交汇面（产块门、重放结构、骨架复用件、
  skill wire 实走 formatReadOutput、toolCtx 共享零装配）。
impact_files: 27 个源文件 + 18 个测试文件（见最终项目结构与测试策略）
constraints:
  - 明文行/压缩行双形态在迁移期均永远合法（读路径）
  - vfs/file_cache 压缩与 contentBodyPool 不动
  - 两列保留不删、SCHEMA_BOOT_VERSION 不 bump
  - 反向任务不挂 VACUUM（增容无 freelist）
  - BATCH_BUILD_CHUNK 改名保留（分片让步理由从压缩 CPU 换为参数数组内存与事件循环公平）
  - 提示词 wire 逐字节不变（read-ref hydrate 不变量延伸到 skill）
  - Step 1-5 为不可拆分的发布单元（中间态正向任务会把新明文行压回）
  - 逻辑合理性优先于回滚能力（用户拍板 2026-10-01）；性能主张须有稳态读护栏背书（T-MP-P0）
  - 本迭代全部代码落 feat/read-tool-result-ref 分支
blocking_steps: [1, 2, 3, 4, 5, 6, 7, 9, 10]
optional_steps: [8 (skill load，可量化后裁剪), 11 (manual_user)]
```


## 实现期补充（dev-loop 执行注记，2026-10-01）

Step 1-8 由四个 impl 节点完成（c3c1dee9 / 34159ea2 / 6dddb0cb / ec2c8c2b），与 spec 的偏离与决策如下：

1. **encodeMessageContent 的删除时序**（nA 偏离 Step 4 表述）：Step 4 时点 `message-content-compaction.ts` 仍在 import 它（Step 3 才删），故函数本体实际随 Step 3（nC）一并删除——spec「随 Step 4 删」的表述按依赖实况修正为「调用点随 Step 1、本体随 Step 3」。
2. **T-MP3 口径修正**（nB）：原表述「读路径对坏行仍可读（旧压缩内容语义正确）」字面不成立——反向任务与 readRowContent 共用同一纯函数 decodeMessageContent，任务解不开的行读路径同样解不开。按更诚实的口径钉死两条：坏行原样保留压缩字节（明文列绝不被写入错数据，blob 一旦可解立刻读回原正文）+ 读路径 fail-fast 抛错带消息 id（不静默丢行）；「未搬完的好压缩行可读」由 T-MP4 覆盖。
3. **status 快路径不自愈**（nB 取舍）：`getMessageDecompressStatus` 的标记已置位快路径不做 LIMIT 1 探测（高频轮询展示面不宜每次带库查询），自愈只在低频任务入口——标记与数据脱节最迟下一轮任务入口修正。
4. **maintenance 测试处置升级**（nC）：`message-content-compaction-maintenance.test.ts` 整删（反向不挂 VACUUM，原断言反向不成立）并在 desktop 侧补更强独立用例（真实搬完一轮、探针统计 VACUUM 下发恰 0 次、覆盖 query+execute 两个口）；`message-content-compaction.test.ts` 整删（骨架用例已由 decompression 测试全量覆盖，采样节流迁移至 status-sampling-throttle）。
5. **beforeMaintenance/afterMaintenance 语义反转**（nC）：反向任务仅消费旧 pending 欠账时进维护段；desktop service 与 core 注释改述，cr-03 用例改为「维护失败欠账标记保留」口径。
6. **contentHash 的 in 判**（nD）：readSkillFile 透传三件套时 contentHash 用 `"contentHash" in result` 判——无 hash 行上它真为 null，用 != null 会吞掉键位与可空语义不符。
7. **hydrate memo 键加 kind:action**（nD）：load 与 read 常共享同一 (entryId, version)，不加 action 会串 wire 缓存。
8. **known-env**：desktop typecheck 经 core dist 解析类型，dist 陈旧会产生假错误（重建 core 归零，RULE 既有条目再确认）；mobile tsconfig（含 __tests__）595 条既有债不属本迭代，jest 全绿为准。
