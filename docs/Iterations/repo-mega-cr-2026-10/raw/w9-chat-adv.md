---
zone: w9-chat-adv
agent: 辩护人（advocate / 对抗对·辩护侧）
files_scanned: 63（packages/core/src/domain/chat/ 全量：model 13 + logic 39 + content 5 + repositories 6，其中 repositories/impl 3）
---

# W9 对抗机位报告 —— chat 域辩护人

> 机位立场：论证本区设计的合理性，为被辩护的决策提供证据链；对无法辩护的部分主动列「让步清单」。
> 独立性声明：本报告未读取 `raw/` 与 `synth/` 下任何文件，全部结论来自代码与 `docs/apm/RULE.md`。

---

## 摘要

`packages/core/src/domain/chat/` 是 novel-master 的**会话消息域**：定义消息/会话/项目的领域模型与 wire schema，
封装 `chat_message` / `chat_session` / `chat_project` 三张表的持久化，并把「用户消息 → LLM 提示词」这条
最脏的组装链（附件 hydrate、短提示去重、批注、wrap XML）拆成纯函数层。它是 desktop/mobile 双端与
core 之间的唯一消息真源，也是全仓唯一处理「正文压缩存储 + 明文双形态读」的地方。

---

## 职责与边界

**该负责**：消息/会话/项目的领域类型与 zod schema；`chat_message` 三形态读写；搜索/区间/分页/可见性
区间的 SQL 口径；提示词组装（附件 hydrate + 短提示 seen + wrap）；批注草稿与锚点算法；composer 发送门闩。

**不该负责**（越界即问题）：
- 不做 LLM 协议适配（出站 wire format 归 `infra/llm-protocol/`）；
- 不做 VFS 读盘（只经 `VfsService` port，路径解析委托 `domain/vfs/logic/vfs-path-mapper.js`）；
- 不持有跨会话全局态 —— **唯一例外**是 `chat-annotate-draft-store.ts` 的进程内 Map（见 D11 / C10）。

---

## 对外接口

`packages/core/src/public/chat.ts` 是本区的唯一导出面（`@novel-master/core/chat`），共约 90 个符号，
导出面受 `packages/core/test/package-exports/snapshots/public-chat-allowlist.json` 快照锁死。

关键符号分组：

| 组 | 代表符号 | 定义位置 |
|---|---|---|
| 消息模型 | `ChatMessage` / `ChatMessageHeader` / `ContentBlock` / `MessageUsage` | `model/message.ts:16,55`、`model/content-block.ts:8` |
| 附件/草稿 schema | `messageAttachmentSchema` / `composerDraftSchema` / `annotateDraftSchema` | `model/message-attachment.schema.ts:66`、`model/composer-draft.schema.ts:31`、`model/annotate-draft.schema.ts:25` |
| 提示词组装 | `prepareUserMessagesForPrompt` / `wrapUserMessageForLlm` | `logic/prepare-user-messages-for-prompt.ts:539`、`logic/wrap-user-message-for-llm.ts:52` |
| 附件构造 | `buildFileRefActionXml` / `buildAlreadyReferencedActionXml` / `buildAnnotateAttachmentFromDraft` | `logic/build-attachment-action-xml.ts:33,47,188` |
| 扫描/seen | `scanAtPathAttachments` / `scanSkillAttachments` / `createPromptPathSeenSet` / `skillSeenKey` | `logic/scan-at-path-attachments.ts:28`、`logic/scan-skill-attachments.ts:30`、`logic/prompt-path-seen.ts:61,25` |
| 可见性区间 | `computeHideRangeFromSelection` / `computeTailBatchRangeFromSelection` / `computeSetFloorRanges` / `listVisibleSorted` | `logic/visibility-batch-range.ts:36`、`logic/tail-batch-range.ts:80`、`logic/message-set-floor-range.ts:7`、`logic/message-visible-floor.ts:14` |
| 批注算法 | `buildFlatTextIndex` / `mapFlatRangeToSegments` / `findAnnotateOccurrenceInSource` / `buildAnnotatedSource` | `logic/annotate-highlight.ts:344,365,257`、`logic/annotate-source-anchor.ts:379` |
| 链接识别 | `resolveChatLinkTarget` / `isHttpUrl` / `elideChatLinkPath` | `logic/resolve-chat-link-target.ts:44,34,93` |
| 发送门闩 | `resolveComposerSendIntent` / `hasComposerSendableInput` | `logic/composer-send-intent.ts:37`、`logic/composer-sendable-input.ts:27` |

仓储 port（`repositories/*.port.ts`）**不在公开导出面**——它们只被 `service/` 层消费，属内部契约。
这本身是合理的边界（见 D8 末段）。

---

## 数据访问

| 表 | 触碰点 | 证据 |
|---|---|---|
| `chat_message` | 唯一写口全部在 `sqlite-message.repository.ts` | `repositories/impl/sqlite-message.repository.ts:31`（列清单）、`:38-41`（INSERT）、`:378`（updateContent）、`:475`（updateHidden）、`:491`（updateHiddenRange） |
| `chat_session` | `sqlite-session.repository.ts` 8 个方法，含 `composer_draft_json` / `agent_config_json` 侧信道列 | `repositories/impl/sqlite-session.repository.ts:133,147,161,175` |
| `chat_project` | `sqlite-project.repository.ts` 7 个方法 | `repositories/impl/sqlite-project.repository.ts:35,85,99` |

**表结构关键约束**（`packages/core/src/bootstrap/chat/chat-schema.ts`）：

- `seq INTEGER NOT NULL CHECK (seq >= 1)` + `UNIQUE (session_id, seq)`（`:31`、`:56`）——D3 的地基。
- `content_encoding TEXT NULL CHECK (... IN ('zlib','zlib-b64'))`、`content_blob BLOB NULL`（`:54-55`）——
  CHECK 对 NULL 放行是**故意**的，让 legacy 明文行两列皆 NULL 永远合法，迁移因此可中断。
- `content_json TEXT NOT NULL`（`:33`）——正文迁出后置空串 `''`，靠「blocks JSON 恒非空串」消歧。

**索引缺口（供 reduce 参考）**：全表只有 `idx_chat_message_created_at ON chat_message(created_at_ms)`（`:58-59`）。
没有 `(session_id, seq)` 复合索引——靠 `UNIQUE (session_id, seq)` 隐式索引兜住 ORDER BY seq 的走表，
这是可接受的（唯一约束已建索引），不是问题。

**KKV 域**：本区不直接写 KKV；只经 `SessionKkvService` 读 `rule_snapshot` / `file_cache`
（`logic/prepare-user-messages-for-prompt.ts:90,199`）。缓存失效由 service 层负责（`message.service.ts:91,111`）。

---

## 依赖关系

**import 了谁**（跨域）：

- `@/infra/tdbc/*`（连接协议）、`@/infra/sql-template`（`#{xxx}` 参数模板）、`@/infra/content-cache/logic/decoded-content-cache`
- `@/domain/vfs/logic/vfs-path-mapper`（`resolveLogicalPath`——seen key 的归一源）、`@/domain/vfs/content-store/logic/zlib-codec`（压缩原语复用）
- `@/domain/workplace/logic/load-or-fill-file-cache`、`@/service/workplace`、`@/service/skills`、`@/service/session-kkv`
- `@/domain/tool/logic/format-tool-output`、`@/domain/tool/logic/build-tool-result-block`（meta 透传）
- `@/domain/message-checkpoint/*`、`@/domain/vfs/repositories/impl/*`——**仅 `seed-fork-copy-parity.ts` 一个文件**（见下）

**被谁消费**：

- `service/chat/impl/message.service.ts`（消息全生命周期）、`service/chat/impl/session.service.ts`（fork/copy）
- `service/message-checkpoint/impl/message-rollback.service.ts`（回滚：countBySession + listBySessionFromSeq）
- `domain/depth/logic/depth-from-tail.ts:34`（`listVisibleSorted`）、`service/chat/impl/usage-stats.service.ts:446`
- `apps/desktop/src/main/ipc/handlers/messages.ts:107`（搜索透传）、`apps/mobile/src/screens/stack/ChatHistorySearchScreen.tsx:161`

**依赖方向健康度**：域层不反向依赖 service 实现（只用 port 类型），唯一的「反向」是
`prepare-user-messages-for-prompt.ts` 引 `service/session-kkv/session-kkv.port`、`service/workplace/workplace.port`、
`service/skills/skills.port` 三个 **port 类型**——引 port 而非 impl，方向仍合法，但确实让 domain 层知道了
service 层的概念。这是本区最值得记一笔的架构味道（见 C11）。

---

## 发现清单 —— 辩护理由清单（D）

> 每条格式：`D-<n> | 优先级 | file:line | 引文 | 论证 | 置信`

### D-1 `codec 收口 repository` —— 把「序列化 + 压缩」这一个知识点的 owner 收到唯一位置

- **位置**：`repositories/impl/sqlite-message.repository.ts:53-54,371-388,82-94`
- **引文**：
  ```ts
  function toMessageParams(message: ChatMessage): unknown[] {
    const encoded = encodeMessageContent(JSON.stringify(message.content));
  ```
- **辩护**：
  1. **写入侧只有两处**：`insert`/`batchInsert` 走 `toMessageParams`（`:54`），`updateContent` 走
     `encodeMessageContent(JSON.stringify(content))`（`:374`）。两处都调同一个 codec，全仓再无第二处
     `JSON.stringify(message.content)` 落库——实测 `rg "JSON.stringify\(.*content"` 在 `packages/core/src` 只命中
     repository 的 `:54`/`:374`、rollback 的 `:343`（仅统计字节数的探针）与 `chat-token-estimate-memo.ts:165`
     （同样只算长度），**没有第三处编码点**。
  2. **服务层不再 stringify**：`message.port.ts:79-85` 的契约明写「入参为 MessageContent 对象——JSON 序列化与
     压缩编码都收口在 repository（service 层不再 stringify）」。这条契约把「谁负责编码」从口头约定变成接口签名。
  3. **收益是可验证的**：三端（desktop better-sqlite3 / mobile op-sqlite / cli）零感知——`encodeMessageContent`
     无平台分支（`logic/message-content-codec.ts:43-51`），压缩原语直接复用 VFS 侧 `zlib-codec`（`:14-20`），
     没另起第二套实现。若当初散在 service 层，mobile 的二进制 BLOB 绑参问题会在每个调用点重复踩。
  4. **RULE 明文记为已定稿决策**：`docs/apm/RULE.md:32`「codec 收口在 repository 层（`message-content-codec`
     复用 vfs zlib-codec 三形态）」。→ `intentional`，不当缺陷报。

### D-2 `searchMessages` 全量内存精筛 —— 不是退化，是**召回严格变强**且有 keyset 上界

- **位置**：`repositories/impl/sqlite-message.repository.ts:502-591`
- **引文**：
  ```ts
  const scanLimit = Math.max(clampedLimit * 20, 200);
  // 语义红线：召回不得小于全量精筛——只有「凑满 limit」或「扫完全部行」
  // 两个出口，绝不在中途放弃续扫
  ```
- **辩护**：
  1. **去 LIKE 是被迫的、不是任意的**：`content_json` 在正文迁出后恒为 `''`（`:60`），`LIKE '%kw%'` 在
     空串上恒不命中——LIKE 粗筛不是「慢」，是**功能已死**。commit `063454ac` 的 diff 保留了当时的判断注释。
  2. **召回只增不减**：旧实现 SQL 层 `role IN ('user','assistant')` + LIKE 粗筛（LIKE 扫整个 content_json，
     是**超集**预筛），最终仍由 `messageMatchesKeyword` 按 TextBlock 判定。新实现去掉 role 粗筛、改为按段全量
     精筛，最终判定函数**完全相同**（`:576` 直接调同一个 `messageMatchesKeyword`）。既然终判相同、候选集从
     「LIKE 命中的子集」扩大到「全部行」，召回只可能更大。注释里「旧 LIKE 会漏 thinking/tool_result 块含关键词
     的场景反被 role 粗筛误杀」说的正是这个。
  3. **有真正的上界，不是无脑全表**：`scanLimit = max(limit*20, 200)`，keyset 续扫（`AND seq < cursor`，
     `:555`、游标取本段最小 seq `:588`），两个硬出口：凑满 limit（`:580`）或本段未拉满（`rows.length < scanLimit`，
     `:583`——SQLite LIMIT 语义保证此时已无剩余行）。段内还走 `mapRows` 分片让步（`:574`），大会话搜索不长时间
     占住 JS 线程。
  4. **有实测断言护着**：`packages/core/test/chat/message-search.test.ts` 断言「每次 query 行数 ≤ 200」（`:686`）、
     「450 行命中分散在 5 个 seq，跨段凑满恰 5 条」（`:723`）、「100 条命中 limit 10 → 恰返回 seq 99..90」（`:660`）。
     这几条正是对「红线」的牙齿。
  5. **service 层留了第二道防线**：`message.service.ts:507-515` 防御性重筛 + `slice(0, clampedLimit)`，
     注释明写「port 合同允许其它实现退回超集召回……messageMatchesKeyword 是最终判定口径（幂等）」。即便将来
     换一个只做超集召回的 port 实现，也不会把超量结果透给 UI。

### D-3 `seq 复用` —— 回滚删尾后复用旧 seq，是**有约束支撑的既定口径**，不是脏数据

- **位置**：`repositories/impl/sqlite-message.repository.ts:360-369`（`nextSeq`）、`:448-455`（`deleteAfterSeq`）
- **引文**：
  ```sql
  SELECT MAX(seq) AS max_seq FROM chat_message WHERE session_id = #{sessionId}
  -- maxSeq == null ? 1 : Number(maxSeq) + 1
  ```
- **辩护**：
  1. **DB 层有唯一约束兜底**：`chat-schema.ts:56` `UNIQUE (session_id, seq)`。即便出现竞态，SQLite 会**响亮地
     报 UNIQUE 冲突**，而不是静默写出两条同 seq 的行。这是「失败可见」的设计。
  2. **复用而非留洞，是为搜索/翻页/回滚保持坐标连续**：RULE 明写「剩余 seq 连续无空洞；中间空洞只来自单条
     delete，hide/置位/压缩都是 UPDATE 不删行」。坐标连续让 `beforeSeq` keyset 翻页与 `deleteAfterSeq`
     截断的语义保持简单。
  3. **写侧对「空洞来源」有意识**：fork 路径显式重排 seq（`message.service.ts:344-352`，`let seq = 1; seq++`），
     session copy 路径保留原 seq（`session.service.ts:377-381`）。两条路径都因为「同库不同 session」而不必重排——
     唯一约束是 `(session_id, seq)` 复合的，跨 session 同 seq 完全合法。**约束的复合形态本身就是这个设计的依据。**
  4. **RULE 已记为业务拍板**：`docs/apm/RULE.md:20`「回滚是物理删尾（`DELETE WHERE seq > ?`），删后新消息会
     **复用旧 seq**（跨时间不唯一，剩余 seq 连续无空洞）」。→ `intentional`。

### D-4 消息头投影 —— 用「不选 content 列」换掉「大会话秒级解压」

- **位置**：`repositories/impl/sqlite-message.repository.ts:249-269`，port 声明 `message.port.ts:22-28`
- **引文**：
  ```sql
  SELECT id, session_id, seq, role, hidden, created_at_ms
  FROM chat_message WHERE session_id = #{sessionId} ORDER BY seq ASC
  ```
- **辩护**：压缩/置位区间逻辑只需要 `id/seq/role/hidden`，不需要正文。头部投影把「几千条消息逐条 inflate」
  换成「几千行窄列」。这不是微优化而是治本：commit `1b75a594`（"hide/置位 读路径治本——消息头投影替代全量
  解压（压缩卡顿主源）"）的标题即定性。`ChatMessageHeader` 类型（`model/message.ts:55-62`）的注释也把
  「需要正文检查时（如 tool_result 锚定）按窗口补拉全量行」写成了显式契约——**边界清晰，不是遗漏**。

### D-5 `mapRows` 分片让步 —— yieldFn 由装配方注入，core 不反向依赖 RN

- **位置**：`repositories/impl/sqlite-message.repository.ts:169,187-212`
- **引文**：
  ```ts
  // 注意：分片步长是类静态常量，须以类名引用（this 上取不到 static
  // 成员——实例方法里 this.ROW_PARSE_CHUNK 运行时是 undefined，会让
  // start += undefined 变 NaN 而静默返回空数组）。
  const chunkSize = SqliteMessageRepository.ROW_PARSE_CHUNK;
  ```
- **辩护**：
  1. **依赖方向正确**：core 只声明 `() => Promise<void>` 函数类型（`:162`），具体实现由装配方注入
     （mobile 传 `createQuantumYield(16)`）。core 因此不需要 import 任何 RN 模块。
  2. **缺省即零影响**：`:194-196` `yieldFn == null` 时直通同步 `rows.map`，desktop/cli/测试的字节级行为与
     改造前完全一致。这让「加让步」这个改动可以单独上、单独验证。
  3. **连踩过的坑都留在注释里**：上面那段引文记录了一个真实的静默失败（`this.STATIC` → `undefined` → `NaN`
     → 返回空数组）。这种「把 bug 的机理写进注释」的做法本身就是代码质量的证据。
  4. **有等价性测试**：`test/chat/message-repository-yield.test.ts:60,116,153` 分别断言「分片与直通逐条全等」
     「50 行整单片零让步点」「缺省不传 yieldFn 行为不变」。

### D-6 解压缓存的失效契约 —— 唯一写口显式失效，并有「反向锁」测试

- **位置**：`repositories/impl/sqlite-message.repository.ts:386,393,415,435`；缓存实现
  `packages/core/src/infra/content-cache/logic/decoded-content-cache.ts`
- **引文**：
  ```ts
  // 进程内解压产物层按 id 缓存（infra/content-cache）：本处是「同 id 换
  // 正文」的唯一写口，写入后必须失效
  forgetDecodedMessageContent(id);
  ```
- **辩护**：
  1. **失效点覆盖完整**：四个写口（`updateContent` / `insert` / `batchInsert` / `delete`）全部显式
     `forget`。`delete` 上的那一处注释坦承「删除不必为正确性失效（id 不复用）」——**知其然也知其所以然**，
     不是漏写。
  2. **删除/回滚不留脏条目是安全的，且有前提论证**：缓存模块头 `:32-36` 写明 id 全仓 `randomUUID()`、
     从不复用（append/fork/copy 均新 id），死条目由 LRU 自然回收。后台压缩搬运与 blob 归一只换字节形态、
     正文不变，同样无需失效。
  3. **测试是「反向锁」而非顺向锁**：`test/chat/message-content-decode-cache.test.ts:61` 断言「同一会话二次读
     全走内存：blob 全部投毒仍读回原内容；清池后必抛」——把「缓存确实在生效」和「缓存失效后确实回落」两头都
     钉住。`:104` 断言 `updateContent` 后必读新正文（失效纪律的承重断言）。
  4. **失败语义 fail-fast 且类型化**：`logic/message-content-codec.ts:94-100` 解压失败抛
     `chatInvalidArgument`（文案含消息 id），**不做 file_cache 式静默自愈**。理由写在 `:57-59`：消息是用户数据本体。
     这与 VFS blob「缺行必抛」是同一价值观。

### D-7 `includeHidden: false` 下推到 SQL —— 修的是「每 step 都调」的真实热点

- **位置**：`repositories/impl/sqlite-message.repository.ts:214-231`；调用方
  `packages/core/src/service/agent/impl/chat-agent-session.ts:30-37`
- **引文**：
  ```ts
  // includeHidden=false 在 SQL 层就滤掉 hidden 行：隐藏消息（压缩/置位产
  // 物）不必捞回并逐条解压正文——大会话（数千条、hidden 占多数）的 UI
  // 读口（token chip 的 prompt 组装只消费可见历史）曾因此全量解压秒级卡顿。
  ```
- **辩护**：过滤下沉到 SQL 后，返回集合与原先的 JS 侧 `filter` **完全一致**（`hidden = 0` 是精确等价），
  但省掉了「捞回 + 逐条 inflate」。调用方 `ChatAgentSession.list()` 被 agent-runner **每 step** 调一次，
  且压缩后的会话里 hidden 常占多数——这是「同样的语义、更小的成本」的典型。默认仍为 `includeHidden: true`
  （回滚锚定依赖「含隐藏全量」，port 注释 `:14-16` 明写），**默认值选的是兼容侧**。

### D-8 port 契约写得足够「可执行」—— 每个非显然方法都带口径说明

- **位置**：`repositories/message.port.ts` 全文（118 行）
- **辩护**：这不像「接口 + 祈祷」，每个方法都注明了为什么这么设计：
  - `listBySessionOffset`（`:38-45`）明写「offset 是**行偏移而非 seq 值**（seq 可能因删除有洞）」——
    这是最容易写错的一处，注释直接堵死了误用；
  - `listMessageHeadersBySession`（`:22-28`）明写「不选 content 列即不解压正文」；
  - `countBySession`（`:30-36`）明写「用这个替代 `listBySession().length`，1000 条消息从拉 1000 行退化成拉 1 行」；
  - `searchMessages`（`:108-117`）把「keyword 非空走全量内存精筛」「不在 SQL 层过滤 hidden」写进契约。
  同时 port **不进公开导出面**（`public/chat.ts` 不导出 `repositories/*`），把它锁在 service 层内部——
  边界与封装一致。

### D-9 严格 parse + 显式拒绝 legacy 形态 —— 「形状错了就响亮地失败」

- **位置**：`content/parse-message-content.ts:21-22,107-120,245-279`
- **引文**：
  ```ts
  const LEGACY_SHAPE_MSG =
    "Legacy message content shape is not supported; use { blocks: [...] }";
  ```
- **辩护**：
  1. **每个块类型逐字段校验并带下标**（`blocks[${index}]: tool_result: ok must be a boolean`），错误信息可直接
     定位到出问题的块——排障成本低。
  2. **未知字段「向前兼容」的口径被显式写明**（`:171` 注释：meta 具名字段类型检查，未知字段静默忽略）。
     这是**刻意**的两段式严格：具名已知字段严、扩展位宽。
  3. **legacy 形态显式拒绝而非猜测迁移**——`content` / `parts` 顶层键直接抛错并给出目标形状。对用户数据本体，
     猜错比报错更危险。
  4. **对已知历史脏数据有一次性清理**：`parseBlocksArray`（`:107-120`）丢弃 GLM reasoning 阶段曾写出的
     `text: ""` 空 text 块，注释标明来源（reasoning-only GLM append）。这是「已知脏数据的定点外科」，
     不是全局宽容。

### D-10 `updateHiddenRange` 用 `hiddenFilter` 让 `changes` 表达「实际改变的行数」

- **位置**：`repositories/impl/sqlite-message.repository.ts:481-500`
- **引文**：
  ```ts
  const hiddenFilter = hidden ? "AND hidden = 0" : "AND hidden = 1";
  ```
- **辩护**：这个额外条件让返回值成为**真实变更数**而非**匹配数**——重复 hide 同一段返回 0。
  `test/chat/message-visibility.test.ts:172` 正是这条断言（「hideRange returns 0 when hiding already hidden
  messages」）。若省掉这个条件，返回值会撒谎（明明没变却报 N），上层就无法用它判断「这次操作是否真的改变了
  可见性」。**用一个 WHERE 条件换取返回值语义的诚实**，划算。

### D-11 批注草稿**故意**不进持久化 —— 有 store 隔离、有 chip 投影、有清空时机

- **位置**：`logic/chat-annotate-draft-store.ts`、`model/annotate-draft.schema.ts:1-4`
- **辩护**：草稿是「用户正在写、还没发」的瞬态。落库会带来两个问题：崩溃后残留幽灵草稿、跨设备草稿语义混乱。
  现状的隔离做得干净：
  - store 提供 `subscribe` / 增改删 / `chipsFromAnnotateStore` / `unionComposerStatusWithAnnotate`（`:92-98`
    先滤掉既有 annotate 预览再合并，避免重复）；
  - `clearChatAnnotateDrafts` 在 append 成功后被双端调用（mobile `ChatComposer.tsx:366`、
    `useChatTabMessageActions.ts:283`；desktop IPC `messages.ts:351`）；
  - `chipsFromAnnotateStore` 显式跳过 `isMessageAnnotatePath` 的历史伪 path（`:69-71`），**注释写明「防御误写入」**。
  `RULE.md:11` 亦记明「批注草稿存进程内 draft store，不进 composer 草稿」。→ `intentional`。
  （该 store 的模块级 Map 无上限、会话删除不清理——见 C10，那是实现瑕疵，不是这个决策的错。）

### D-12 短提示 `seen` 集合 —— 一个可见序共享的 Set，覆盖三种来源

- **位置**：`logic/prepare-user-messages-for-prompt.ts:539-624`、`logic/prompt-path-seen.ts:61-75`
- **辩护**：
  1. **seen key 与落库 path 与 XML 三处同形**，都由 `normalizePromptSeenPath` → `resolveLogicalPath` 归一
     （`prompt-path-seen.ts:28-30`）。这是「同一把尺子量三样东西」，避免了 `@a.md` 与 `/a.md` 被当成两个文件
     各注入一次全文。
  2. **初值是常驻前缀 S0**（`createPromptPathSeenSet(runtime.seenPaths)`，`:543`），即常驻工作区已注入过的路径
     天然算「已出现」——省 token 的语义从一开始就闭合。
  3. **技能用独立命名空间而非另一套机制**：`skill:{name}`（`scan-skill-attachments.ts:25`）与路径 seen 共用同一个
     Set 但前缀隔离；更妙的是**方向 B 预填**（`prepare-user-messages-for-prompt.ts:548-558`）——可见历史里
     assistant 用 `skill` 工具 `load` 过的技能预先写进 seen，因为它的全文以 tool_result 形式**留在可见历史里**，
     后续 `$` 引用若再注一遍就是重复注入。这个推理链完整写在注释里。
  4. **置位/压缩后自动重置**：seen 是每次 prepare 从入参重建的局部量，不是持久态，压缩把消息藏出可见窗口 →
     自然不在 seen 里。RULE 明确这一点（`RULE.md:18`）。
  5. **「不写 seen」的自愈分支**：skillAttach 不存在时**不写 seen**（`:294-300` 注释「技能后续创建可自愈重附
     全文」），存在性判定与读盘之间的竞态也按不存在处理且不写 seen（`:358-365`）。**把「不写 seen」当作自愈
     手段**是很精细的一手。

### D-13 可见性/置位区间全部抽成纯函数，双端与 WebView 共用一份语义

- **位置**：`logic/visibility-batch-range.ts`、`logic/tail-batch-range.ts`、`logic/message-set-floor-range.ts`
- **辩护**：
  - `transcriptSelectableRole`（`visibility-batch-range.ts:15-26`）把「hide 模式只能勾 assistant / restore 模式
    只能勾 user」写成纯函数，Desktop / Mobile / WebView **共用**（模块头 `:1` 明写）；
  - `tail-batch-range.ts:7` 明写 restore 与 delete **级联规则相同、仅确认 API 不同**，于是抽出
    `computeTailBatchRangeFromSelection` 供两者共用，并把旧的 `computeShowRangeFromSelection` 标
    `@deprecated`（`visibility-batch-range.ts:52-53`）指向新函数——**迁移留了桥，不是硬切**；
  - `computeSetFloorRanges`（`message-set-floor-range.ts:7-24`）返回 `{hidePrefix, showSuffix}` 而不是一个
    笼统的区间，因为置位的语义就是「隐藏前缀 + 显示后缀（含锚点）」两段并置；`floorSeq > 1` 才产生 hidePrefix，
    `floorSeq <= sessionMaxSeq` 才产生 showSuffix，空操作自然为 `null`。
  - 有对应测试：`test/chat/visibility-batch-range.test.ts`（5 条）、`tail-batch-range.test.ts`（10 条，含
    「hidden 行不可作 delete 锚点」`:75`）、`message-set-floor-range.test.ts`（含两条空操作边界 `:35,41`）。

### D-14 批注锚点算法：坐标系分离，且**明确标注了哪个是权威**

- **位置**：`logic/annotate-highlight.ts`、`logic/annotate-source-range.ts`、`logic/annotate-source-anchor.ts`
- **辩护**：
  1. **三个坐标系各有其主，用途写死**：
     - `renderStart/renderEnd`——MD 渲染后 Recogito 容器的可见正文坐标（**预览高亮唯一权威**，
       `annotate-draft.schema.ts:19-24` 明写「新稿必写；旧 VFS offset 仅可读可写以兼容存量」）；
     - `startOffset/endOffset` + 行列——VFS 源文件坐标系（**非预览权威**）；
     - `buildAnnotatedSource` 产出的带锚 HTML——`annotate-source-anchor.ts:5-7` 顶部就写
       「**非预览投影合同**……宿主 MD/plain 预览主路径禁止调用」。
  2. **禁令有测试牙齿**：`apps/desktop/test/preview-annotate-source-anchor.test.ts:111,340` 与
     `apps/mobile/__tests__/annotate-recogito-preview.test.tsx:87-92` 都断言宿主预览组件
     `assert.doesNotMatch(src, /buildAnnotatedSource/)`。**「禁止调用」这句话不是注释，是断言。**
  3. **匹配策略有阶梯**（`annotate-highlight.ts:283-304`）：窗口 → 扩大一次 → 全文，每级都记录命中用的
     `strategy`，排障时能看出「为什么退化到全文」。
  4. **不写脏数据**：`locateAnnotateOffsetRangeByQuoteContext`（`annotate-source-range.ts:406-412`）在
     「无邻域上下文 + 多处命中」时**返回 null 拒收**，注释明写「避免默写首次命中」。宁可不注入也不猜错位置。
  5. **XSS 合同显式**：`escapeAnnotateSourceText` / `escapeAnnotateAttr`（`annotate-source-anchor.ts:66-79`）
     分别转义正文与属性，注入的是 span 不是任意标签。
  6. **重叠按序稳定处理**：多草稿按 `startOffset` 升序、同 offset 按 `id.localeCompare` 兜底（`:390-397`），
     重叠记入 `skippedDraftIds` 而非丢弃草稿（用户数据不丢）。

### D-15 链接识别的判定顺序经过真机样本校准

- **位置**：`logic/resolve-chat-link-target.ts:44-81`
- **辩护**：五步顺序（URL 解码 → scheme 检测 → 协议相对 → 剥 fragment → `resolveLogicalPath`）每一步的注释都
  写了**为什么**：`decodeURIComponent` 是因为「markdown 渲染器会把中文编码进 href，真机样本实测」（`:50-51`）；
  scheme 正则覆盖 `HTTP://` 大写与 `C:` 盘符（`:59`）；`decodeURIComponent` 对裸 `%ZZ` 抛 URIError 按不可识别处理
  （`:51-52`）——**非法输入不 crash**。`isHttpUrl` 单源导出给三端共用（`:25-26`），避免各入口自持正则漂移。

### D-16 退役件保留而非删除，且删除时机已被 RULE 钉到具体版本

- **位置**：`logic/diff-workspace-for-user-vfs-flush.ts:4`、`logic/compute-stream-tail-generating.ts:7-15`、
  `logic/visibility-batch-range.ts:52`、`model/project-agent-config.ts:4`
- **辩护**：本区有 5 处 `@deprecated`，全部符合同一模式——**顶部写明「为什么退役 / 迁移方向 / 何时删」**：
  - `diff-workspace-for-user-vfs-flush.ts:4`「手改热路径已改读 UserOpsLogStore；本模块仅过渡期单测 / 旧工具保留」；
  - `compute-stream-tail-generating.ts:7-15`「保留导出以兼容旧调用方；实现已忽略 idle 阈值」+ 每个参数单独标
    `@deprecated`——**签名保留、参数逐个标注**，比整个删函数对新调用方友好；
  - `project-agent-config.ts:4` 项目智能体已下线，「类型与 schema 仅保留用于 DB 历史数据的读取兼容与迁移，
    业务代码不再写入；列数据由迁移置空（不 DROP COLUMN，保留列以降低老版本回滚风险）」。
  `RULE.md:77` 更把退役节奏写成制度：「用户拍板：**10 个版本后再清下一轮**」，并点名
  `message-content-compression` 与 `binary-blob-and-vfs-pack` 两个后台迁移的同轮退役。
  → 全部 `intentional`，不应作为「死代码」报缺陷。

---

## 发现清单 —— 让步清单（C）

> 辩护人无法完全辩护、主动承认的部分。每条给出证据与建议。

### C-1 `nextSeq` 与 `insert` 非原子，同 session 并发 append 会撞 UNIQUE 且无重试

- **优先级**：P3（低概率、失败可见）
- **位置**：`packages/core/src/service/chat/impl/message.service.ts:193-210`
- **引文**：
  ```ts
  const seq = await this.deps.messages.nextSeq(sessionId);
  // ...
  await this.deps.messages.insert(message);
  ```
- **承认**：`SELECT MAX(seq)` 与 `INSERT` 是两条独立语句、中间无事务。当前调用链
  （`run-agent-turn.ts:724` 的 user append、`chat-agent-session.ts:50` 的 step append）是串行 await，
  双端 UI 也在 running 时禁用输入（mobile `ChatComposer.tsx:508-513` 直接把发送变成「终止」），
  desktop 有 `activeRuns` / `abortRegistry` 双重在途判据（`apps/desktop/src/main/ipc/handlers/agent.ts:269-284`
  注释明确「`abortRegistry` 在 core `runAgentTurn` **函数入口**注册」）。所以**现实路径上撞不上**。
- **但仍需记**：① `message.service.ts` 全文无任何 `attempt`/`retry`（实测 `rg "attempt|retry"` 零命中）；
  ② 一旦将来引入「同一 session 并行 append」（例如批量导入、或未来多 run 并发），失败形态是裸 SQLite
  UNIQUE 错误冒泡到用户，而不是可诊断的业务错误。
- **建议**：`nextSeq` 改为 `INSERT ... SELECT COALESCE(MAX(seq),0)+1`（单语句原子），或在
  `append` 捕获 UNIQUE 冲突后重试一次（上限 3 次）。**改动极小、收益是消除一类未来隐患。**

### C-2 keyword 搜索的冷路径仍可能退化为「全量解压」

- **优先级**：P2（性能，已文档化的既定取舍）
- **位置**：`repositories/impl/sqlite-message.repository.ts:537-590`
- **承认**：`scanLimit = max(limit*20, 200)` 只约束**单次 SQL 取多少行**，不约束**总解压量**。命中极稀疏时
  （例如在 5000 条消息里搜一个只出现 1 次的词），keyset 会一直续扫到扫完全部行——**总解压成本与
  `listBySession` 全量路径同量级**。这一点注释里写了（`:510`「大会话搜索多付解压成本，与 listBySession
  全量路径同量级」），RULE 也记了（`RULE.md:32`），所以是**已接受的取舍**，不是隐瞒。
- **缓解确实存在**：① 段内 `mapRows` 分片让步（`:574`）不会长时间霸占 JS 线程；② D-6 的进程内解压缓存让
  **第二次**搜索几乎全走内存。所以真实痛点是「冷启动第一次搜索」。
- **建议**：若日后仍慢，最小改动是给 `chat_message` 加一列 `text_search_blob`（未压缩的 text blocks 拼接），
  在 `insert`/`updateContent` 时同步维护，keyword 非空时先对该列 LIKE 粗筛再对命中行解压精筛——
  与旧 `content_json LIKE` 同构，只是换了列。**当前不做是对的**（多一列 = 多一处迁移与不一致面）。

### C-3 `raw_json` 的 `JSON.parse` 无保护，一行脏数据炸掉整个 `listBySession`

- **优先级**：P3
- **位置**：`repositories/impl/sqlite-message.repository.ts:110-113`
- **引文**：
  ```ts
  raw:
    row.raw_json == null
      ? null
      : (JSON.parse(String(row.raw_json)) as Record<string, unknown>),
  ```
- **承认**：同一函数里 `attachments_json` 走 `parseAttachmentsJson`，对非法输入 **fail-soft 返回 undefined**
  （`model/message-attachment.schema.ts:112-124`）；`content_json` 走 codec，失败 **fail-fast 抛类型化错误**
  （D-6）。**唯独 `raw_json` 是裸 `JSON.parse`**——一个手工改库 / 外部导入写坏的单行，会让 `listBySession`、
  `findById`、`searchMessages` 全部抛 `SyntaxError`，且错误信息不含 message id，排障时无从定位。
- **公平地说**：`raw` 只被 `readMessageMetadata` 读 `metadata.kind`（`model/message-metadata.ts:26-38`），
  用途很窄，风险等级低于正文。但**不一致本身**就该修。
- **建议**：`try { JSON.parse } catch { null }`（fail-soft，与 attachments 对齐）或包成
  `chatInvalidArgument(\`消息 raw_json 解析失败: ${row.id}\`)`（fail-fast，与正文对齐）。二选一，别留第三种形态。

### C-4 附件数组的失败粒度是「整数组丢弃」，比正文粗

- **优先级**：P3
- **位置**：`model/message-attachment.schema.ts:121-124`
- **引文**：
  ```ts
  const result = messageAttachmentsSchema.safeParse(parsed);
  if (!result.success) {
    return undefined;
  }
  ```
- **承认**：`safeParse` 失败即**整条消息的所有附件一起丢**（返回 `undefined`）。若历史消息里有 3 个附件、
  其中 1 个因 schema 演进（比如将来给 action 枚举加值）不合规，**另外 2 个也一并消失**——UI 上表现为
  「这条消息的引用 chip 全没了」。对比之下 `parseBlocksArray`（`content/parse-message-content.ts:107-120`）
  是**逐块**处理、只丢坏块。
- **背景**：`RULE.md:12` 记明「遗留历史消息中的操作日志附件在展示层直接丢弃（过滤非 annotate 的 user_ops，
  原始数据不删）」——那是**刻意的业务丢弃**，与这里的**结构解析失败**是两回事，不应混为一谈。
- **建议**：改成 `parsed.map(逐个 safeParse).filter(ok)`，坏附件跳过并 `console.warn` 带 index。
  成本约 10 行，收益是「一个坏附件不连坐三个」。

### C-5 `assertMessageContent` 会改写调用方传入的对象

- **优先级**：P3
- **位置**：`content/parse-message-content.ts:266`，调用点 `service/chat/impl/message.service.ts:191,272`
- **引文**：
  ```ts
  (value as { blocks: ContentBlock[] }).blocks = parseBlocksArray(value.blocks);
  ```
- **承认**：`MessageContent.blocks` 在类型上是 `readonly`（`model/content-block.ts:95`），但实现用 `as` 断言
  绕过去**原地改写**。`assertMessageContent` 的契约签名是 `asserts value is MessageContent`（`:245`），
  按 TS 惯例 assert 函数应当无副作用；这里它既是断言又是规范化器。`message.service.ts:191` 传的
  `content` 来自调用方（`run-agent-turn.ts:727` 传的是新建的 `textBlocks(trimmed)`，所以当前**没有实际的
  别处可见性污染**）。
- **建议**：改成返回新对象 `return { blocks: parseBlocksArray(value.blocks) }`，调用方接收返回值。
  或者把函数改名为 `normalizeMessageContent` 以如实反映它会改数据。**改名比改语义便宜，且不引入行为变更。**

### C-6 `messageMatchesKeyword` 每条消息重算一次 `keyword.toLowerCase()`

- **优先级**：P3（微）
- **位置**：`content/message-content-match.ts:39`
- **引文**：
  ```ts
  const needle = keyword.toLowerCase();
  ```
- **承认**：`needle` 在函数体内、循环外，但函数本身**每条消息调一次**（repository `:576` 的循环里）。
  5000 条消息 = 5000 次 `toLowerCase`。对短 keyword 而言开销可忽略，但对长 keyword + 长会话是可测量的浪费。
- **建议**：把 needle 计算上提，或提供一个 `createKeywordMatcher(keyword)` 返回闭包。
  **优先级最低，属于「知道就好」**。

### C-7 `void open;` —— 两处明确的死代码残留

- **优先级**：P3
- **位置**：`logic/prepare-user-messages-for-prompt.ts:256,268,275,286`
- **引文**：
  ```ts
  const open = `<dir path="${logicalPath}">`;
  // ...
  void open;
  ```
- **承认**：这明显是早期版本里 `open` 用于比对、后改为 `startsWith("<dir ")` 泛化判定后忘了删的残留。
  `void open;` 是显式压制 lint 的写法，等于把死代码「合法化」了。
- **建议**：直接删除两行（`const open` 与 `void open`）。零行为变更。

### C-8 退役件里有一个是**完全无生产消费方**的整模块

- **优先级**：P3
- **位置**：`logic/diff-workspace-for-user-vfs-flush.ts`（220 行）
- **实测**：`rg "diffWorkspaceForUserVfsFlush|collectUserOpsChangedPaths|isWorkspaceFlushDiffEmpty"` 在
  `packages/core/src` 与 `apps/` 下**只命中该文件自身**，唯一的外部引用是
  `packages/core/test/chat/diff-workspace-for-user-vfs-flush.test.ts`。
  同理 `mergePendingVfsTurns`（`logic/merge-pending-vfs-turns.ts`，18 行）也只被
  `public/chat.ts:138` 导出、无内部消费方（`user_vfs_pending` 域在 `RULE.md:31` 已记为「历史域——
  user ops 拆除后已无写入方」）。
- **辩护边界**：这两个文件与 D-16 的其他退役件**不同**——它们不是「等迁移退役」的，而是**功能已完全下线**的。
  按 `RULE.md:77` 的节奏（10 个版本后清），它们应当排在下一轮清理的首批。
- **建议**：下一轮 migration 清理时，把这两个文件连同其专属测试**物理删除**（RULE 已有先例：「第三/四轮先例
  修正：退役迁移的源文件与专属测试**物理删除**（非保留）」）。同时从 `public/chat.ts` 摘掉
  `mergePendingVfsTurns` 导出（会触发 `public-chat-allowlist.json` 快照更新，是预期的）。

### C-9 `listBySessionTail` / `listBySessionPage` 的子查询把全列物化两遍

- **优先级**：P3
- **位置**：`repositories/impl/sqlite-message.repository.ts:305-320,328-344`
- **引文**：
  ```sql
  SELECT ${MESSAGE_SELECT_COLUMNS} FROM ( SELECT ${MESSAGE_SELECT_COLUMNS} FROM chat_message ...
  ```
- **承认**：子查询内层选了全部 21 列（含 `content_blob`），外层再选一遍。SQLite 通常会优化掉冗余投影，
  但**不能保证**在所有版本/所有驱动（better-sqlite3 与 op-sqlite 的查询规划器不同版本）下都优化。
  这些列里 `content_blob` 是最大的一列。
- **建议**：内层只选 `seq`（配合 `ORDER BY seq DESC LIMIT n`），外层再 join/回表取全列，
  或内层用 `SELECT seq` + 外层 `WHERE seq IN (...)`。**收益不确定、风险也低，属于「知道就好」那一档**。

### C-10 批注草稿 store 是模块级 Map，无上限、会话删除不清理

- **优先级**：P3
- **位置**：`logic/chat-annotate-draft-store.ts:14`
- **引文**：
  ```ts
  const bySession = new Map<string, AnnotateDraft[]>();
  ```
- **实测**：`rg "clearChatAnnotateDrafts" packages/core/src/service` **零命中**——`SessionService.delete`
  （`service/chat/impl/session.service.ts:190-198`，递归删 `deleteSessionTree`）**不清理**批注草稿。
  只有「append 成功后」与「回滚时」两条路径会清（mobile/desktop 各有调用点，见 D-11）。
- **后果**：用户建了会话 → 划词写了批注 → **不发** → 删除会话，草稿条目永久留在内存 Map 里 keyed by
  已死的 sessionId。反复操作会缓慢泄漏（每条草稿含 `originalText` 全文，不小）。
- **辩护边界**：D-11 论证的是「草稿不进持久化」这个**决策**，这不构成对**实现瑕疵**的辩护。
- **建议**：① `SessionService.delete` / `deleteSessionTree` 里加一次 `clearChatAnnotateDrafts(session.id)`；
  ② store 加一个「N 个会话无活动即淘汰」的粗上限（如 32 个 session，超出按最后访问时间丢最旧）。
  ① 是三行改动，直接堵住泄漏；② 是防呆。

### C-11 domain 层引用了 service 层的 port 类型（依赖方向的味道）

- **优先级**：P3（架构，非缺陷）
- **位置**：`logic/prepare-user-messages-for-prompt.ts:26,53-54`
- **引文**：
  ```ts
  import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
  import type { WorkplaceService } from "@/service/workplace/workplace.port.js";
  import type { SkillService } from "@/service/skills/skills.port.js";
  ```
- **辩护**：这些都是 **`port`（接口）而非 `impl`**，依赖倒置的字面意义上是合规的；且 `PrepareUserMessagesForPromptRuntime`
  把它们全部做成**可选注入的字段**（`skills` 缺省时 skillAttach 原样带过，`:329-331`），
  测试里大量用手写假实现（`test/chat/prepare-skill-attach.test.ts` 整个文件就是）。
- **承认**：即便如此，domain 层仍然「知道了」session-kkv / workplace / skills 三个 service 域的存在。
  严格的 hexagonal 架构下这些能力应由 domain 侧的 port 声明、由 service 侧实现并注入。
  **这不是 bug，是分层纯度问题**，且改动面很大（要新增三个 domain port + 改所有装配点），
  性价比不高。
- **建议**：**本轮不动**。若将来做全域架构整治，把这条列入 backlog 即可。

### C-12 一处 `?? null` 之外的入参清洗口径值得记一笔

- **优先级**：P3
- **位置**：`repositories/impl/sqlite-message.repository.ts:513`
- **实测**：`clampedLimit = Math.max(1, Math.floor(query.limit))`。当 `query.limit` 是 `NaN` 时
  （`node -e "Math.max(1, Math.floor(NaN))"` 实测输出 `NaN`），`clampedLimit` 保持 `NaN`，会一路绑进 SQL 的
  `LIMIT ?`。
- **辩护**：`RULE.md:20` 明确「双端 UI 输入需过滤非数字并归一空串/NaN，repo 层绑定值 `?? null`
  （better-sqlite3 命名参数不接受 undefined）」——**NaN 的过滤责任被显式划给了 UI 层**，
  而实测两端确实做了：mobile `ChatHistorySearchScreen.tsx:323` `onChangeText={t => setFromSeqText(t.replace(/[^0-9]/g, ''))}`
  从输入侧就滤掉非数字；desktop 侧 `limit` 是渲染层常量而非用户输入。
- **但**：`limit` 与 `fromSeq/toSeq` 的**防御等级不一致**——后两者被 UI 过滤，前者没有等价说明，
  且 `Math.max(1, NaN) === NaN` 这个坑很隐蔽。
- **建议**：`const lim = Number.isFinite(query.limit) ? query.limit : 20;`
  然后 `clampedLimit = Math.max(1, Math.floor(lim))`。或者更省事：`Math.max(1, Math.floor(query.limit) || 1)`
  （`NaN || 1 → 1`）。一行，消除一类难查的边界。

---

## 争议与存疑（不抹平）

1. **`searchMessages` 该不该做 SQL 粗筛**——我辩护现状（keyset + 上界 + 缓存已足够，D-2），
   但承认这是**权衡**不是**最优**。若 reduce 层或用户实测认为冷搜索仍慢，C-2 的加列方案是最小增量路径。
   两侧证据都摆在这里，请主代理裁决时不要把「已接受取舍」误读成「已验证无问题」。

2. **`seq` 复用是否该改成全局单调**——RULE 已拍板复用，我完全接受。但请注意：**一旦未来引入
   「同一 session 并行 append」**，C-1 会从 P3 升为 P1。这两条结论是耦合的，不应分开裁决。

3. **`buildAnnotatedSource` 的去留**——`annotate-source-anchor.ts` 整个模块（460 行）当前**只有测试在用**
   （生产侧被 `apps/desktop/shared/logic/chat.ts:45` re-export，但 desktop 测试断言宿主预览组件不调用它）。
   我倾向于**保留**（SPEC R5 明写「可暂留实现供测试/兼容」，且有 `doesNotMatch` 断言守着不会误用）。
   但这是一个 460 行的「僵尸能力」，若 reduce 层认为应一并归入 C-8 的清理批次，我不反对——
   需要先确认 SPEC R5 是否还有效。

4. **`injected yieldFn` 的覆盖面**——`new SqliteMessageRepository(conn)` 的**多数生产调用点都没传
   yieldFn**（实测 7 个生产装配点中只有 `create-chat-services.ts:71` 与
   `create-message-checkpoint-services.ts:53` 传了）。desktop/cli 走直通是**刻意的**（D-5 第 2 点），
   但 `message-rollback.service.ts:203`、`session.service.ts:48` 这些**跑在 mobile 上的路径**是否都拿到了
   带 yieldFn 的实例，我无法在本区内确证（需要跨 zone 看装配图）。**列为存疑，不下结论。**

---

## 附：本区文件清单（63 个，全部读过）

- **model/**（13）：`message.ts` `content-block.ts` `message-usage.ts` `message-metadata.ts`
  `message-attachment.schema.ts` `annotate-draft.schema.ts` `composer-draft.schema.ts`
  `project-agent-config.ts` `project-agent-config.schema.ts` `session-agent-config.ts`
  `session-agent-config.schema.ts` `project.ts` `session.ts` `user-vfs-pending.schema.ts`
- **content/**（5）：`parse-message-content.ts` `message-body-text.ts` `message-content-match.ts`
  `text-blocks.ts` `format-message-cli.ts`
- **logic/**（39）：见「对外接口」表 + D-13/D-14 引用；最大三文件为
  `prepare-user-messages-for-prompt.ts`(624) `annotate-source-range.ts`(496) `annotate-source-anchor.ts`(460)
- **repositories/**（6）：`message.port.ts` `session.port.ts` `project.port.ts` + `impl/` 三个 sqlite 实现