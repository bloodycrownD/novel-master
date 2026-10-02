---
zone: mega-cr-2026-10 / S 阶段 fix-spec 审查
agent: sr1-core1-c（readonly reviewer · 组 C = §6#3 + §6#4 第二源复核 + core-data 债务池抽验）
基线: fe79b781（worktree D:\Dev\nm-worktree\mcr）
files_scanned:
  - docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一、四章）
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-b-core1.md（B1-7 / B1-8）
  - docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md（§3 / §6 第 3、4 行 / §4.2）
  - docs/Iterations/repo-mega-cr-2026-10/synth/core-data.md（P2 22 条 / P3 39 条明细）
  - docs/apm/RULE.md（attach 术语条、user ops 条、验收断言牙齿三条、seq 条）
  - packages/core/src/domain/chat/model/composer-draft.schema.ts
  - packages/core/src/domain/chat/model/message-attachment.schema.ts
  - packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts
  - packages/core/src/domain/chat/repositories/impl/sqlite-session.repository.ts
  - packages/core/src/public/chat.ts
  - apps/desktop/renderer/features/chat/ConversationPanel.tsx
  - apps/mobile/src/storage/chat-composer-draft.ts
  - packages/core/src/domain/chat/logic/{message-content-helpers,prepare-user-messages-for-prompt}.ts
  - packages/core/src/domain/prompt/logic/normalize-for-llm-export.ts
  - packages/core/src/service/agent/impl/agent-runner.ts
  - apps/mobile/src/screens/tabs/chat-tab/useChatTabMessageActions.ts
  - packages/core/src/service/chat/impl/{message.service,usage-stats.service}.ts
  - packages/core/src/domain/message-checkpoint/logic/revision-gc.ts
  - packages/core/src/infra/db-maintenance/impl/{db-maintenance.service,message-content-decompression}.ts
  - packages/core/src/domain/chat/{logic/message-content-codec.ts,content/parse-message-content.ts}
  - packages/core/src/domain/chat/logic/scan-at-path-attachments.ts
  - packages/core/src/domain/tool/builtin/subagent-tool.ts
  - 11 份被点名测试/回归线文件的存在性与内容核对
---

# 组 C 审查报告（§6#3 + §6#4 第三源复核 · core-data 债务池抽验）

## 摘要

本组两条 fix-spec 条目（`wave-b-core1.md` 的 B1-7 / B1-8）分别对应台账 §6 第 3、4 行两条**单源**主张：`composer-draft` 整对象判废与 `attachments_json` 整数组判废。撰写机位是第二源，本机位是第三源，从 `fe79b781` 代码独立重推导。结论：**B1-8 的病灶成立、机制推导正确、不破坏 RULE「原始数据不删」口径，修法方向可行但验收与证据有 3 处硬伤；B1-7 的病灶代码形态成立，但 P1 立论被其自己引用的写侧证据推翻——当前所有写入方写进 `composer_draft_json` 的 `attachments` 恒为 `[]`，数组级判废在生产上不可触发。**

---

## 1. 逐条 verdict 表（七要素 × 条目）

| 要素 | B1-7 §6#3 composer-draft 全有或全无 | B1-8 §6#4 附件数组整体降级 |
|---|---|---|
| **定级** | ❌ **不成立（P1 → 建议 P2/P3）**。见 §2 复核结论 R-1 | ⚠️ **有条件成立 P1**。机制成立，但触发依赖「存量行确有今天不合法的形态」这一未实测前提 |
| **病症（描述准确性）** | ❌ 病症链的**前半段（`:64-68` 整对象 `safeParse`）代码属实**，后半段（正文凭空消失）**当前不可达** | ✅ 描述准确，四条消费链全部逐字复核在位 |
| **证据（file:line + 引文）** | ✅ `:64-68` 逐字一致（`composer-draft.schema.ts:64-68` 实测为 `safeParse` → `!success` → `return {...EMPTY, attachments: []}`）；`:30-36` 数组 transform 属实；桌面 `:328-338`/`:347-360`、移动端 `:161`/`:172-176`/`:115-123` 全部逐字在位 | ✅ `:109-126` 逐字一致；消费点 `:141-143` 属实，**且 spec 的「行号修正」正确**（台账/§4.2 记的 `:97-99` 已漂移，`:91-103` 现为 `runInTransactionOrConn`，实测无误）。`message-attachment.schema.ts:87-97` 的 name 一致性校验逐字在位 |
| **修法（文件·函数级·可行）** | ⚠️ 方向对，**边界有缺口**（MF-2、MF-3）：未写 `parsed` 非对象 / `attachments` 缺失或非数组的守卫；改后 `composerDraftSchema` 变成零生产消费的公共导出 | ✅ **可行**。`parseAttachmentsJson` 全仓仅 1 个生产调用点（`sqlite-message.repository.ts:141`），改返回契约的爆炸半径已被我逐一枚举确认（见 §2 R-4） |
| **验收（可测）** | ⚠️ 断言 A/B/C/D/E 均可写、断言 A 明确要求「等于具体非空字符串」（符合 RULE 牙齿①）。但 CD-4 落点文件与既有夹具的关系未说明 | ❌ **断言 D 自相矛盾**（MF-7）：`"[1,2]"` 同时被列进「非数组 ⇒ undefined」与「标量数组 ⇒ `[]`」两栏 |
| **测试策略（文件真实存在）** | ⚠️ core 侧两份文件真实存在；**但「若移动端有 jest 语料则…」的假设不成立——`apps/mobile/__tests__/chat-composer-draft.test.ts` 确实存在**，应指名并给命令（MF-4） | ⚠️ 两份主文件存在；`message-content-helpers.test.ts` **存在**，spec 写「若存在则不加」是多余的保守话术 |
| **回归线（真实存在）** | ✅ `composer-draft.schema.test.ts` / `sqlite-session.repository.test.ts` / `composer-chip-attachment.test.ts` 全部存在；四处草稿断言实际在 `:82/:88/:93/:115-117/:138`，与 spec 写的 `:82/:93/:117/:138` 大体吻合 | ❌ **路径错**：`read-ref-production-smoke.test.ts` 实为 `packages/core/test/service/agent/…`，spec 写成 `packages/core/test/agent/…`（MF-8）。其余四份附件消费面测试均存在 |
| **依赖闭合** | ✅ 无前置；与 B1-8 同 PR 的建议成立（设计原则同源、共用回归线） | ✅ 无前置；与 B1-7 同 PR 建议成立 |
| **总判定** | **not-ready**（5 项 must-fix，其中 MF-1 动摇立论根基） | **ready-with-fixes**（3 项 must-fix + 1 项建议） |

---

## 2. 第三源复核结论表

> 方法：不读台账结论，只按「症状 → 代码 → 反例」三步从 `fe79b781` 重推导。撰写机位为第二源，本表为第三源。

| # | 复核命题 | 我的独立推导 | 结论 |
|---|---|---|---|
| **R-1** | `composer-draft.schema.ts:64-68` 的全有或全无校验是否成立、是否可达 | 校验形态**成立**：`composerDraftSchema`（`:27-38`）是 `z.object({text, attachments: z.array(messageAttachmentSchema).transform(...) }).strict()`，数组任一元素被 `.strict()`（`message-attachment.schema.ts:63`）或 `superRefine`（`:67-98`）拒绝 ⇒ 整对象 `safeParse` 失败 ⇒ 返回 `EMPTY`（含 `text: ""`）。**但可达性不成立**：我把 `composer_draft_json` 的全部写入方穷举了一遍——① desktop 唯一写点 `ConversationPanel.tsx:359` ← `:355-358` 恒传 `attachments: []`；② mobile `persistAttachTextDraft:67-70` 恒传 `attachments: []`；③ mobile `writeChatComposerDraftState:115-123` / `writeChatComposerDraft:88-95` 在空态写 `null`。core 侧 `SessionService.setComposerDraftJson:267-273` 是**裸字符串透传**，不构造内容。**没有任何写入方能产出非空 `attachments` 数组**。更进一步：两端水合时本来就把草稿附件整个丢弃（desktop `:335-337` 用 `unionComposerStatusWithAnnotate(status,…)`、mobile `:170` 只保留 `statusOnly` 并注「历史 draft attach chip 丢弃」），所以即便真有一条带附件的草稿，附件侧也无损失。 | ❌ **P1 不成立**。数组级判废在当前代码下不可触发，「用户写了一半的正文凭空消失」是**不可达叙事**。残留风险只有「历史存量行里存在今天不合法的附件」这一条，且两端水合本就丢附件，净危害只剩正文丢失——需要真库探针才能定性。**建议降 P2（vestigial 字段硬化）或 P3，并按 dead-backlog 方向考虑直接删掉草稿的 `attachments` 字段**（RULE attach 术语条把 attach 定义为「随消息落库、逐消息消息级」，草稿附件从来不在该契约内） |
| **R-2** | spec 的 P1 叙事是否自洽 | spec 的证据栏**自己引用了** `ConversationPanel.tsx:347-360`，而那段代码的实参就是 `attachments: []`。既然草稿列里的 attachments 恒为空数组，`z.array(...)` 恒通过，`:64-68` 恒不触发。**spec 用自己引用的行号证伪了自己病症的前提**，而没有停下来。 | ❌ 内部自相矛盾，必须改定级并重写病症段 |
| **R-3** | `message-attachment.schema.ts:109-126` 的整数组降级是否成立 | 成立且逐字在位：`:112` 空/缺省 → `undefined`；`:116-120` `JSON.parse` 失败 → `undefined`；`:121-124` `messageAttachmentsSchema.safeParse` 失败 → **`undefined`**。经 `sqlite-message.repository.ts:141-143` → `:161` 的 `...(attachments != null ? { attachments } : {})` ⇒ 字段整体缺席。 | ✅ **成立**。spec 的行号修正（`:97-99` → `:141-143`）经我复核**完全正确**，是本分片证据质量最高的一处 |
| **R-4** | 改成「全非法返回 `[]`」会不会打破 `undefined`/`[]` 的既有语义 | 我把全仓 22 处 `attachments` 空值判断逐条看过：全部是 `?? []` / `?.length ?? 0` / `== null || length === 0` / `length > 0` 形态（`prepare-user-messages-for-prompt.ts:493`、`wrap-user-message-for-llm.ts:57`、`message-content-helpers.ts:37`、`normalize-for-llm-export.ts:60`、desktop `message-blocks.ts:318` / `MessageList.tsx:204` / `rollback-annotate-restore.ts:54`、mobile `message-blocks.ts:417,460,477` / `MessageList.tsx:551` / `AttachGroup.tsx:24` / `MessageRow.tsx:52`、`run-agent-turn.ts:786`、`message.service.ts:67,212`）。**无一处区分 `undefined` 与 `[]`**。唯一的 `=== undefined` 断言在 `message-attachments.round-trip.test.ts:28`，那条走的是 NULL 列分支（`row.attachments_json == null` ⇒ `raw == null` ⇒ 仍返回 `undefined`），**不受影响**。写侧 `serializeAttachmentsJson:134` 对 `null/undefined/[]` 三态一律返回 `null`，往返无差异。 | ✅ `[]` 的选择安全，无回归面 |
| **R-5** | B1-8 是否破坏 RULE「原始数据不删」口径 | 我把 `attachments_json` 的全仓 11 处引用逐条看过：只有 DDL（`chat-schema.ts:39`、`schema-column-alignments.ts:52,54`）、`MESSAGE_SELECT_COLUMNS`（`:28`）、INSERT 列清单（`:37`）与读（`:142`）。仓库里针对 `chat_message` 的 UPDATE 只有三条（`sqlite-message.repository.ts:435` 只写 content 三列、`:522`/`:538` 只写 `hidden`），**没有任何路径回写或重写 `attachments_json`**。B1-8 是纯读侧放宽。 | ✅ **不破坏**。这是 spec 没写出来、但很关键的一条正面结论，应补进证据栏 |
| **R-6** | B1-8 的四条消费链是否都在位 | ① `prepare-user-messages-for-prompt.ts:488-500`（`message.attachments ?? []` → 按 source 分档 → `:493` 空则不 hydrate）逐字在位；② `message-content-helpers.ts:35-39` `hasAnnotateAttachment` + `isPlainUserText:59` 在位，`useChatTabMessageActions.ts:222` `mode === 'undo_send' ? target.attachments ?? [] : null` 在位；③ `agent-runner.ts:486-496` skillAttach seen 收集在位；④ **`normalize-for-llm-export.ts` 那条不成立**——该文件里叫 `hasNonEmptyAttachments`（`:59-61`），唯一调用点是 `canMergeAdjacent`，作用是「带非空 attachments 的 user 消息禁与相邻 plain chat merge」，不是 spec 写的「导出口径 `hasAttachments` 恒 false」。 | ⚠️ 3 条成立、1 条**名称与危害描述双错**（MF-6） |
| **R-7** | 「历史行里存在今天不再接受的形态」是现实还是理论 | 代码里有**间接但有力**的证据：`message-attachment.schema.ts:43-45` 的 `DISPLAY_TAG_NAME_RE` 注释（「展示 tag 形态：`write:/x`…**禁止写入新附件 `name`**」）+ `:80-85` 的 superRefine + 既有测试 `message-attachment.schema.test.ts:85-93`（「历史无 action：仍允许旧展示 name，**不做批量迁移**」）共同证明：旧版本确实把 `action:path` 展示 tag 写进过 `name`，而**带 action 的展示 tag 今天会被拒**。再叠加 `.strict()` 对未知键的拒绝。 | ⚠️ 机制可信，但**「真库里有多少行会被判废」零实测**。按 RULE「条数/行号/计数类结论一律实测复核」，建议在验收里加一条探针（MF-9） |
| **R-8** | 两条是否重复立项 | B1-7 改 `parseComposerDraftJson`（草稿列），B1-8 改 `parseAttachmentsJson`（消息列），函数、表、列、生命周期全不同；RULE attach 条也明确把二者分属「消息级」与「草稿缓冲」两个层次。债务池 CD-22（attach 二分档死分支）虽同在 attach 域但病灶在 `scan-at-path-attachments.ts`，与本组不重叠。 | ✅ 无重复立项 |

---

## 3. 债务池抽验表（core-data 簇 P2/P3，抽样 8/61 = 13.1% ≥ 10%）

> 抽样口径：P2 抽 6 条（CD-03/09/13/17/20/22）+ P3 抽 2 条（CD-34/35），按 ID 分布覆盖「事务边界 / 缓存 / 读口 / 迁移维护 / 死分支 / 正则副作用」六类。逐条按「还在吗 / 定级合理吗 / 是否已被 spec 覆盖 / 是否与本组重复」四问验证。

| ID | 级别 | 还在吗 | 实测证据 | 定级合理 | 与本组 spec 关系 | verdict |
|---|---|---|---|---|---|---|
| **CD-03** 删除链内联全表 `deleteGlobalOrphans` | P2 | ✅ 在，**但行号已漂移** | spec/台账记 `message.service.ts:254-261`；实测该段现为 `adjustReadRefCount` / `messages.delete` / `clearDomain`，**已无** `deleteGlobalOrphans`。真实调用链是 `message.service.ts:263` 的 `sweepSessionRevisions(...)`（在 `:285` 起的**事务内**）→ `revision-gc.ts:75-82` 的 `revisionRepo.deleteGlobalOrphans()`。`deferGlobalOrphanGc` 退避开关只有回滚链在用（`message-rollback.service.ts:246,295`） | ✅ P2 合理（仍是一次全表 DELETE 落在事务内） | 无重叠 | **有效（须修行号）** |
| **CD-09** usage-stats 复制双形态解码分支 | P2 | ✅ 在，行号漂移 | 台账记 `usage-stats.service.ts:512-539` vs `sqlite-message.repository.ts:82-94`；实测现为 `usage-stats.service.ts:524-531`（`row.content_blob != null ? decodeMessageContent(...) : String(row.content_json)`）vs `sqlite-message.repository.ts:125-137` `readRowContent`。失败语义反向（repo fail-fast / stats catch→+0 并 warn）经复核属实 | ✅ P2 合理 | 无重叠 | **有效（须修行号）** |
| **CD-13** `fork` 全量 `listBySession` + 缺 seq 上界读口 | P2 | ✅ 逐字在位 | `message.service.ts:320` `const all = await this.deps.messages.listBySession(sessionId);` → `:330` `all.filter((m) => m.seq <= upTo.seq)`。仓储端口只有 `listBySession / FromSeq / Tail / Page`（`:133-164`），确无上界读口 | ✅ P2 合理（性能） | 属 wave-c1「全量读收窄系列」，与本组不冲突 | **有效** |
| **CD-17** `subagent-tool` 为取末条文本调全量读 | P2 | ✅ 逐字在位 | `subagent-tool.ts:219` `const childMessages = await subagent.messages.listBySession(childSessionId);` → `:220` `extractLastAssistantText`（从末尾向前扫） | ✅ P2 合理 | 同属 wave-c1 收窄系列 | **有效** |
| **CD-20** 手动清理漏清 `nm-message-content` 的 pending 标记 | P2 | ⚠️ **半失效** | 病灶的「只清 blob 侧」仍在（`db-maintenance.service.ts:100-104` 只 DELETE `['nm-blob-binary','startupMaintenancePending']`）。但台账引用的 `message-content-compaction.ts:56,533-537` **文件已不存在**（v1.5.29 随明文化整文件删除），legacy 标记现在由 `message-content-decompression.ts:85-94` **消费**（`:35` 注释：入口读到 `nm-message-content/startupMaintenancePending` 则补跑一次）。台账写的后果「compaction 收尾 VACUUM 失败会置它」已不成立 | ❌ **应降 P3**（净后果 = 一次多余的补跑 + VACUUM） | 无重叠 | **须重写后留池** |
| **CD-22** attach 二分档死分支 + 恒冗余 `isImageAttachPath` | P2 | ✅ 逐字在位 | `scan-at-path-attachments.ts:129-137` 的 `isBinaryAttachPath` 分支返回对象与 `:138-144` 的兜底**逐字相同**（`name: basename, source:"attach", type:"text", content:null, path:storePath`） | ✅ P2 合理 | 同在 attach 域但病灶文件不同，**不重复立项** | **有效** |
| **CD-34** 明文行不入 LRU、blob 行入 | P3 | ❌ **已失效（前提消失）** | `message-content-codec.ts:40,47-50` 明写 `decodeMessageContent` 现为「**纯函数、无进程内缓存**」，并记载 2026-10-30 决定「不再按 messageId 记进 `infra/content-cache` 的消解池」。RULE「消息正文存储」条同步写明 `messageContentPool` 已删、`decodeMessageContent` 是迁移期纯函数解码器 | — 台账赖以成立的两分支差异已不存在 | 无 | **应核销出池** |
| **CD-35** `assertMessageContent` 断言函数带副作用 | P3 | ✅ 逐字在位 | `parse-message-content.ts` 的 `assertMessageContent` 末行 `(value as {blocks: ContentBlock[]}).blocks = parseBlocksArray(value.blocks);` —— 在断言函数里就地改写入方对象 | ✅ P3 合理 | 无 | **有效** |

**抽验小结**：8 条中 **6 条有效**（其中 2 条行号漂移需修）、**1 条须重写**（CD-20）、**1 条应核销**（CD-34）。未发现与本组 B1-7/B1-8 重复立项者；未发现已被 B1-7/B1-8 顺带覆盖者。债务池整体健康度可接受，但**台账的 P2/P3 明细普遍未跟随 v1.5.29 明文化改造重新校行号**，建议 judge 提醒 doc-fix 统一做一次行号刷新（CD-03/CD-09 已实证漂移，CD-20 已实证文件消失）。

---

## 4. must-fix 清单表

| # | 条目 | 级别 | 问题 | 建议改法（供 doc-fix 直接落笔） |
|---|---|---|---|---|
| **MF-1** | B1-7 | **阻断** | **P1 立论被自身证据推翻**：`composer_draft_json` 的三个写入方（`ConversationPanel.tsx:355-358`、`chat-composer-draft.ts:67-70`、`:115-123`）恒写 `attachments: []`，数组级判废在生产不可触发；两端水合又本就丢弃草稿附件 | ① 病症段改写为「**残留字段的潜伏风险**」，删除「用户写了一半的正文凭空消失」这一不可达叙事；② 定级 P1 → **P2**（或 P3 + 归 dead-backlog 删字段）；③ 补一条可测的可达性前置：对真库/夹具跑一次「有多少 `composer_draft_json` 行的 `attachments` 非空且逐条判废」的探针，探针结果为 0 就按 P3 处理；④ 拍板是否直接删掉草稿 schema 的 `attachments` 字段（RULE attach 条把 attach 定为消息级，草稿附件不在契约内） |
| **MF-2** | B1-7 | 阻断 | 修法边界缺口：未规定 `parsed` 非对象（number/string/array/null）与 `attachments` 缺失/非数组时的守卫；照字面实现会在 `parsed.attachments` 上抛 `TypeError` | 在修法第 1 步补伪码级守卫：`const obj = isRecord(parsed) ? parsed : null; const text = typeof obj?.text === "string" ? obj.text : ""; const items = Array.isArray(obj?.attachments) ? obj.attachments : [];` |
| **MF-3** | B1-7 | 阻断 | 改后 `composerDraftSchema` 变成**零生产消费的公共导出**（`public/chat.ts:49`；现仅 `composer-draft.schema.test.ts:15/:33` 用），spec 声称它「被别的消费方共用」不成立 | 二选一并写进 spec：**(a) 推荐**——先逐条 `messageAttachmentSchema.safeParse` 过滤出 `kept`，再把 `{text, attachments: kept}` 喂回 `composerDraftSchema.safeParse`。这样既复用既有 transform 完成「剥非 attach」，又保住顶层 `.strict()`，还不会孤立公共导出；**(b)** 显式把 `composerDraftSchema` 登记为本次新增死码（进 Wave D） |
| **MF-4** | B1-7 | 一般 | 测试策略的「若移动端有 jest 语料则…」假设不成立 | 改为指名：`apps/mobile/__tests__/chat-composer-draft.test.ts`（已确认存在），用例 `CD-5: hydrateChatComposerDraftFromDb 遇非法附件不清空正文`，命令 `cd apps/mobile && npx jest __tests__/chat-composer-draft.test.ts` |
| **MF-5** | B1-7 | 一般 | 风险栏称写回净化「无副作用」，无依据；且未与 B1-8 的 append-only 消息做风险分级对照 | 改写为：草稿列是**易失 UI 缓冲**（非 RULE「原始数据不删」保护对象），净化掉坏附件的风险显著低于消息附件；同时明确「解析宽容 + 写回严格 ⇒ 每次读-改-写净化一次」是收敛方向，但属**对原始列的静默改写**，须在 CHANGELOG `Changed` 段点一句（spec 已有该句，保留） |
| **MF-6** | B1-8 | 阻断 | 证据 #4 名称与危害双错：`normalize-for-llm-export.ts:60` 的函数名是 `hasNonEmptyAttachments`（不是 `hasAttachments`），唯一调用点是 `canMergeAdjacent`——作用是「带非空 attachments 的 user 禁与相邻 plain chat 合并」，**不是**「导出口径」 | 把消费链 #4 改为：「**导出合并口径**：`normalize-for-llm-export.ts:59-61` 的 `hasNonEmptyAttachments` 恒 false ⇒ 带附件的 user 消息会被误判为可与相邻 plain chat 合并，导出 transcript 的分段与原文不一致」；若认为该条危害不足，可降为「次要消费链」保留在证据栏 |
| **MF-7** | B1-8 | 阻断 | 验收断言 D 自相矛盾：`"[1,2]"` 同时出现在「非数组 ⇒ undefined」与「标量数组 ⇒ `[]`」两栏 | 拆成两条：`D-1: "{\"a\":1}" / "null" / 123 ⇒ undefined`；`D-2: "[1,2]" / "[null]"(元素为标量) ⇒ []` |
| **MF-8** | B1-8 | 一般 | 回归线路径错 + 保守话术多余 | ① `packages/core/test/agent/read-ref-production-smoke.test.ts` → **`packages/core/test/service/agent/read-ref-production-smoke.test.ts`**；② `message-content-helpers.test.ts` 已确认存在，从「若存在则不加」改为「列入，理由是回滚批注消费链」；③ 补 `apps/mobile/__tests__/use-chat-tab-message-actions-rollback.test.ts`（已确认存在）到回归线——它正是消费链 #2 的观测面 |
| **MF-9** | B1-8 | 建议 | 「历史行确有今天不合法的形态」是未实测主张，P1 定级与修复收益都缺一个量化锚 | 在验收里加一条探针断言（非阻断）：对夹具库统计「`attachments_json` 非空行数」与「逐条判废后存活行数」，把差值写进用例注释；真机上以 `SELECT COUNT(*) FROM chat_message WHERE attachments_json IS NOT NULL` 起步。RULE「条数类结论一律实测复核」要求这个数不许照抄 |
| **MF-10** | 债务池 | 一般 | CD-20 病灶文件已随 v1.5.29 删除、legacy 标记改由解压任务消费；CD-34 的前提（消解池缓存）已整体撤销 | 两条都写进 fix-spec/SPEC.md 的债务池附注：CD-20 改写为「手动清理未清 `nm-message-content/startupMaintenancePending`，而该标记现由 `message-content-decompression.ts` 消费 ⇒ 下次冷启动多跑一次维护」，定级 P2→P3；CD-34 标 **stale（前提消失）**，与 ledger §9「已被 v1.5.29 消化的条目」合并 |

---

## 5. 结论

**组 C 判定：No-Go。**

一句话理由：**B1-8 病灶成立、修法可行、不破坏「原始数据不删」口径，仅差 3 处证据/验收硬伤即可 Go；而 B1-7 的 P1 立论被它自己引用的写侧证据推翻（草稿列的 `attachments` 恒为 `[]`，数组级判废生产不可达），定级与修法边界必须先重做。**

分项放行条件：

- **B1-7**：MF-1 ~ MF-5 全部闭合，且定级改判（建议 P2，或探针为 0 后转 P3/dead-backlog），方可 Go。
- **B1-8**：MF-6、MF-7、MF-8 闭合即可 Go（MF-9 为建议项，可随实施补）。
- **债务池**：CD-03 / CD-09 修行号，CD-20 重写并降 P3，CD-34 核销出池；其余 5 条维持原判，不进 Wave B–E 执行面。

---

*本机位为第三源独立复核（撰写机位 `s-core-b1` 为第二源，台账 §6 为第一源）。全部 file:line 与引文在 `fe79b781` 工作树逐行核对；台账/既有报告的行号漂移处已在各表显式标注。全程只读：未做 git 写、未触碰 `docs/apm/`、未修改任何生产/测试代码与 fix-spec 分片。*
