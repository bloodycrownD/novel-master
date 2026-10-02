---
zone: w9-ds2-chat-a
agent: 独立双扫 A（domain-survey）
files_scanned: 61
base_commit: 9ca5f5ad
scan_path: packages/core/src/domain/chat/
---

# W9 独立双扫 A —— core / domain/chat 全量测绘

> 独立性声明：本报告未读取 `raw/` 与 `synth/` 下任何文件（含同任务其它机位报告），
> 全部结论由直接读码 + `git grep` 消费侧对账得出。行号对应 base commit `9ca5f5ad`。

## 摘要

`domain/chat` 是消息数据面的领域层：61 个文件 / 约 6.6k 行，分 `model`（wire + zod）、
`content`（blocks 解析与正文提取）、`logic`（36 个纯函数与编排）、`repositories`
（3 port + 3 SQLite 实现）四段。职责是把「一条消息」在库里的形态（`chat_message` 行）
与送给 LLM 的形态（`MessageContent.blocks`）之间的所有翻译收在一处：三张表的 DDL 映射、
正文压缩双形态读、附件 zod 合同、提示词组装（`prepare-user-messages-for-prompt`）、
可见性区间计算、批注/用户 VFS 的 UI 投影。域内无 IO 逻辑（仓储实现除外），
是全仓少见的「纯度很高的领域层」。

## 职责与边界

**属于本区的**：

- 消息 / 会话 / 项目的模型与 wire 合同（`model/*`，含 5 个 zod schema）。
- `content/*`：`content_json` 的严格解析、blocks → 纯文本、关键词匹配、CLI 格式化。
- `logic/*`：36 个模块，分五族——
  1. **提示词组装**：`prepare-user-messages-for-prompt`（唯一 LLM 拼装入口）、
     `wrap-user-message-for-llm`、`prompt-path-seen`、`attach-binary-heuristic`、
     `scan-at-path-attachments`、`scan-skill-attachments`、`render-dir-attach-tree`。
  2. **可见性区间**：`message-visible-floor`、`message-set-floor-range`、
     `visibility-batch-range`、`tail-batch-range`。
  3. **批注（annotate）**：`annotate-highlight`、`annotate-source-range`、
     `annotate-source-anchor`、`build-attachment-action-xml`、`chat-annotate-draft-store`。
  4. **用户 VFS 两段消息**：`user-vfs-turn-view`、`user-vfs-turn-constants`、
     `merge-pending-vfs-turns`。
  5. **杂项**：`status-chip-label`、`resolve-chat-link-target`、`skill-tool-ref`、
     `fork-session-title`、`composer-*`（4 个）、`rollback-confirm-copy`、
     `diff-workspace-for-user-vfs-flush`、`workspace-flush-snapshot`、
     `seed-fork-copy-parity`、`editable-text-from-message`、`tool-use-count`、
     `compute-stream-tail-generating`、`message-content-helpers`、
     `message-content-codec`。
- `repositories/impl/*`：三张表的全部 SQL 拼装与行↔对象映射。

**不属于本区但强耦合**（本区通过 import 触达）：

- `domain/vfs/logic/vfs-path-mapper`（`resolveLogicalPath`）、`normalize-path`。
- `domain/vfs/content-store/logic/zlib-codec`（消息正文压缩的唯一实现）。
- `domain/tool/logic/format-tool-output`（`formatToolResultContentForDisplay`）。
- `infra/content-cache/logic/decoded-content-cache`（解压产物 LRU，本区是其三个读口之一）。
- `service/*` 的 port 类型（`session-kkv` / `workplace` / `skills`）——**方向倒置**，
  见 F-12。

**边界判断**：`domain/chat/logic` 里有三个文件实际带 IO 或跨域仓储构造，
按分层它们更像 service：`seed-fork-copy-parity`（自建 5 个 Sqlite 仓储）、
`prepare-user-messages-for-prompt`（引 3 个 service port + 读 KKV/VFS）、
`render-dir-attach-tree`（读 VFS）。这是本区最值得 reduce 阶段裁定的一处结构问题。

## 对外接口

全部经 `packages/core/src/public/chat.ts` 一个子路径导出（`@novel-master/core/chat`），
共 60+ 个符号。关键分组：

| 组 | 符号 |
|---|---|
| 模型 | `ChatMessage` `ChatSession` `ChatProject` `MessageContent` `MessageAttachment` `MessageUsage` `ChatMessageHeader` |
| 解析 | `parseMessageContent` `assertMessageContent` `parseAttachmentsJson` `serializeAttachmentsJson` `parseComposerDraftJson` `serializeComposerDraftJson` `attachmentStorageName` |
| 组装 | `prepareUserMessagesForPrompt` `wrapUserMessageForLlm` `renderDirAttachTree` `scanAtPathAttachments` `scanSkillAttachments` `mergeAttachmentsWithScannedAtPaths` `mergeAttachmentsWithScannedSkills` `createPromptPathSeenSet` |
| chip | `formatStatusChipLabel` `formatStatusChipLabelFromAttachment` `isComposerStatusAttachment` `partitionComposerChipAttachments` `chipsFromAnnotateStore` `unionComposerStatusWithAnnotate` |
| 批注 | `annotateDraftSchema` + 12 个纯函数（`annotate-highlight` / `annotate-source-range` / `annotate-source-anchor`） |
| 可见性 | `listVisibleSorted` `visibleFloorByMessageId` `computeSetFloorRanges` `isSetFloorAnchorRole` `transcriptSelectableRole` + `visibility-batch-range` / `tail-batch-range` 各 5 个 |
| 用户 VFS | `matchUserVfsTurnAt` `buildUserVfsTurnView` `formatUserVfsTurnPreviewBody` `parseAllUserVfsActionsFromText` `deriveToolUsesFromVfsActions` `USER_VFS_TURN_ACK_TEXT` `wrapUserVfsActionsForStorage` |
| 服务装配 | `createChatServices` `createMessageService` `createSessionService` `createProjectService` `createUsageStatsService` `createUserVfsTurnService` `createMessageTranscriptEffectsService` + 各自 port 类型 |

**注意**：`public/chat.ts` 是 core 唯一出口面，无 allowlist 快照（不在那 12 个有快照的子路径内，
见 architecture.md `[待核对 CS-27]`）。本区的 deprecated 符号
（`computeStreamTailGenerating` / `DEFAULT_STREAM_TAIL_IDLE_MS` /
`computeShowRangeFromSelection` / `ProjectAgentConfig` 三件套）仍全部在公开面上。

## 数据访问

### 表

| 表 | 触点 | 证据 |
|---|---|---|
| `chat_message` | `sqlite-message.repository.ts` 全部 18 个方法 | `:226 :240 :257 :275 :290 :308 :331 :350 :364 :378 :394 :422 :429 :442 :451 :464 :475 :491 :519 :552` |
| `chat_session` | `sqlite-session.repository.ts` 8 个方法 | `:42 :55 :68 :82 :104 :118 :125 :137 :165 :184` |
| `chat_project` | `sqlite-project.repository.ts` 7 个方法 | `:36 :46 :59 :78 :93 :107 :119` |

DDL 在 `packages/core/src/bootstrap/chat/chat-schema.ts:8-60`。
关键约束：`UNIQUE (session_id, seq)`（`:56`）、
`role IN ('user','assistant','system','tool')`（`:32`）、
`hidden IN (0,1)`（`:38`）、
`content_encoding IN ('zlib','zlib-b64')`（`:54`，NULL 放行）。

### KKV 域

- `rule_snapshot`（`SESSION_KKV_DOMAIN_RULE_SNAPSHOT` + `RULE_SNAPSHOT_CANON_KEY`）——
  读口 `prepare-user-messages-for-prompt.ts:90-94`，每次 per-attachment 重读。
- `file_cache` —— 读口经 `loadOrFillFileCache`（`prepare-user-messages-for-prompt.ts:199`），
  本区不直接触 KKV。

### 进程内缓存

`infra/content-cache` 的 `messageContentPool`（键 = message id）——
本区三个触点：`message-content-codec.ts:76 :92`（记/取）、
`sqlite-message.repository.ts:386 :393 :415 :435`（失效）。
`contentBodyPool` 本区不触。

### 无 IO 的文件/路径

本区不直接读写任何物理文件；`session.copy` 的附件/消息搬运由
`seed-fork-copy-parity` 委托给 vfs / message-checkpoint 仓储。

## 依赖关系

### import 了谁（域内 + 跨域）

**跨域 import（本区 → 其他域 / infra / service）**：

```
domain/chat/content/message-body-text.ts  → domain/tool/logic/format-tool-output
domain/chat/logic/message-content-codec.ts → domain/vfs/content-store/logic/zlib-codec
                                            → infra/content-cache/logic/decoded-content-cache
domain/chat/logic/prepare-user-messages-for-prompt.ts
    → domain/session-kkv/model/session-kkv-domains
    → domain/workplace/logic/{load-or-fill-file-cache, rule-snapshot-codec, workplace-display}
    → domain/vfs/ports/vfs-service.port
    → domain/prompt/logic/expand-dynamic-macros
    → service/session-kkv/session-kkv.port   ← 方向倒置
    → service/workplace/workplace.port       ← 方向倒置
    → service/skills/skills.port             ← 方向倒置
domain/chat/logic/render-dir-attach-tree.ts → service/session-kkv/session-kkv.port ← 倒置
domain/chat/logic/user-vfs-turn-view.ts      → domain/vfs/logic/{action-xml-to-tool-uses, user-vfs-save-mapping}
domain/chat/logic/build-attachment-action-xml.ts → domain/vfs/logic/user-vfs-save-mapping
domain/chat/logic/resolve-chat-link-target.ts    → domain/vfs/logic/vfs-path-mapper
domain/chat/logic/prompt-path-seen.ts            → domain/vfs/logic/vfs-path-mapper
domain/chat/logic/workspace-flush-snapshot.ts    → domain/vfs/logic/parent-dir
domain/chat/logic/seed-fork-copy-parity.ts       → domain/{message-checkpoint,vfs,workplace}/repositories/impl/*  ← 域层自建仓储
domain/chat/logic/rollback-confirm-copy.ts       → errors/session-fs-errors
domain/chat/model/project-agent-config.schema.ts → domain/agent/model/agent-definition.schema
domain/chat/repositories/impl/sqlite-*.ts        → infra/tdbc/{ports,logic}, infra/sql-template
```

**与 `domain/vfs` 存在双向 import**：`domain/vfs/logic/user-vfs-save-mapping.ts:8`
反向引 `domain/chat/model/content-block.js`（`ToolUseBlock`）。
即 `chat/logic/build-attachment-action-xml` → `vfs/logic/user-vfs-save-mapping` →
`chat/model/content-block`。因为只到 `model` 不构成运行时环（arch 已记录此形态为
`service → domain/tool → service` 型 type-only 破环），但 `chat/model` ← → `vfs/logic`
的双向边值得 reduce 阶段登记。

### 被谁消费（生产侧）

| 消费方 | 用途 |
|---|---|
| `service/chat/impl/{message,session,project,usage-stats,message-transcript-effects}.service.ts` | 全部仓储 port 的唯一 service 实现 |
| `service/agent/{impl/chat-agent-session, logic/run-agent-turn, impl/agent-runner}` | `prepareUserMessagesForPrompt` / `textBlocks` / `append` |
| `service/prompt/{render-prompt, apply-thinking-context-for-llm, normalize-orphan-tool-results-for-llm}` | `formatChatMessageForCliPreview` |
| `infra/llm-protocol/*`（4 adapter + 3 content-mapper） | `ContentBlock` 全族 |
| `infra/tokenizer/{resolve-current-prompt-tokens, chat-token-estimate-memo, resolve-prompt-tokens-with-backfill}` | `formatChatMessageForCliPreview` |
| `infra/db-maintenance/impl/message-content-compaction` | `encodeMessageContent` |
| `domain/{compaction-conditions, depth, message-checkpoint}` | `listVisibleSorted` / `resolve-rollback-anchor` / `truncate-tail-in-transaction` |
| `domain/tool/{builtin/subagent-tool, logic/build-tool-result-block, logic/subagent-tool-session-id}` | `ContentBlock` / `resolveSkillToolRefFromOutput` |
| `service/vfs/{build-user-vfs-turn-op, impl/character-card-import, impl/vfs-zip-io}` | `SqliteMessageRepository(tx)` / `parseUserVfs*` |
| `service/template/impl/template-pull.service.ts` | chat 仓储 |
| `apps/desktop`（main ipc handlers / renderer / shared） | 30+ 符号，见 `apps/desktop/shared/logic/chat.ts` |
| `apps/mobile`（runtime / services / components / screens / webview） | 30+ 符号 |
| `apps/cli`（message / model / config / session commands） | `textBlocks` `parseMessageContent` `assertMessageContent` `formatMessageForCli` |
| `apps/mobile/src/web/chat-transcript/webview/runtime/util/skill-tool-ref.ts` | `resolveSkillToolRefFromInput`（WebView 内一份副本） |

## 发现清单

### F-w9-ds2-chat-a-1 | P1 | model/composer-draft.schema.ts:64-68 + :27-38

```
  } catch {
    return { ...EMPTY_COMPOSER_DRAFT, attachments: [] };
  }
```

**描述**：`parseComposerDraftJson` 对 `composerDraftSchema.safeParse` **全有或全无**——
数组里任意一条附件不合法（`messageAttachmentSchema` 是 `.strict()` + superRefine，
见 `message-attachment.schema.ts:63 :66-98`），整个草稿被判非法，**用户已输入但未发送的
正文被静默清空**。`text: z.string()` 本身没问题，是附件拖累的。

写回放大（已核消费侧）：`apps/desktop/renderer/features/chat/ConversationPanel.tsx:328`
读到空草稿 → `setComposerText("")`（:332）→ 已 hydration 的持久化 effect
（:347-360，`composerHydratedRef.current = true` 已在 :338 置位）→
`serializeComposerDraftJson({text:"", attachments:[]})` 返回 `null`（`composer-draft.schema.ts:87-89`）
→ `ipcSessionsSetComposerDraft(null)` → **列被置 NULL，原始草稿不可恢复**。
mobile 侧同形：`apps/mobile/src/storage/chat-composer-draft.ts:161` +
`writeChatComposerDraftState` 的 `setComposerDraftJson(null)` 分支（:88-95）。

**当前触发面**：desktop（`ConversationPanel.tsx:355-358`）与 mobile
（`chat-composer-draft.ts:67-70`）都恒传 `attachments: []`，所以线上尚不可触发。
但这是一个**潜伏的 P1**：任何一处改为持久化非空 attach 列表即引爆；且
`messageAttachmentObjectSchema` 是 `.strict()`，未来给附件加字段就会让**旧版本客户端
读新草稿即清空**。

**建议**：改成逐条 `safeParse` 降级——`text` 无条件保留，`attachments` 逐条过滤
（与 `parseAttachmentsJson` 的容错目标一致，但那里更糟，见 F-3）。同时把写回的
null 化改成「读回为空时跳过本次持久化」，避免不可逆。

**置信**：confirmed（机制与写回链均已逐行核实；线上不可达由两侧 `attachments: []` 硬证据确认）

---

### F-w9-ds2-chat-a-2 | P2 | content/parse-message-content.ts:170-200

```
            subagentSessionId?: string;
            skillRef?: SkillToolRef;
          }
```

**描述**：`ToolResultBlock.meta` 在 `model/content-block.ts:64-68` 声明了三个字段
（`subagentSessionId` / `failureReason` / `skillRef`），`domain/tool/logic/build-tool-result-block.ts:283 :288`
确实写入 `failureReason`（「用户停止」文案，供 UI 工具卡片显示）。但读路径
`parseBlock` 的 tool_result 分支**只重建 `subagentSessionId` 与 `skillRef`**，
`failureReason` 连同 `meta` 里其它未知键一起被丢弃。

后果：任何一条经过库读的消息（`listBySession` / `findBySessionTail` / 搜索 / 回滚后重读），
其 `meta.failureReason` 恒为 `undefined`。中断回流的 tool 卡片在**刷新 / 重启 / 切会话后
不再显示「用户停止」**，只有刚落库未重读的内存对象才有。子 agent 卡片同理。

**建议**：`parseSkillRefMeta` 旁边补一个 `optionalString(metaValue.failureReason)`，
并把 `meta` 的构造条件从 `subagentSessionId != null || skillRef != null` 扩为三者任一。
补一条 round-trip 测试（现成的样板在 `packages/core/test/chat/tool-result-meta.test.ts:27`
——它只覆盖了 `subagentSessionId`，正是漏网的原因）。

**置信**：confirmed（三方对账：类型声明 / 写口 / 读口，行号已引）

---

### F-w9-ds2-chat-a-3 | P2 | model/message-attachment.schema.ts:121-124

```
  const result = messageAttachmentsSchema.safeParse(parsed);
  if (!result.success) {
    return undefined;
  }
```

**描述**：`parseAttachmentsJson` 同样是全有或全无——**一条**附件不合法，
该消息的**全部** chip（状态条：删除/创建/编辑/规则/批注）一起消失，且无任何日志。
schema 的严格度是本仓最高的一档：`.strict()`（:63，拒未知键）+
superRefine 三重校验（:66-98，含「`name` 不得为 `action:path` 展示 tag」与
「有 action 时 `name` 必须等于 `attachmentStorageName(path)`」）。

这两个规则都是**新加的收紧**（注释明写「新写入（带 action）禁止…」「有 action 时…」），
意味着库里的存量行天然可能不满足。叠加 F-7 的写侧不校验（`serializeAttachmentsJson`
不做任何校验直接 `JSON.stringify`），一条坏附件可以经由写侧落库、再经读侧把整条消息的
chip 全部抹掉。

**建议**：改为逐条 `safeParse`，`filter(r => r.success).map(r => r.data)`；
不合法的条目可写一条 `console.warn` 带 messageId，便于定位存量脏行。

**置信**：confirmed

---

### F-w9-ds2-chat-a-4 | P2 | content/parse-message-content.ts:24-31 + :127-131

```
const BLOCK_TYPES = new Set([
  "text", "image", "tool_use", "tool_result", "thinking", "redacted_thinking",
]);
```

**描述**：`parseBlock` 对未知 `type` **抛异常**（`:127-131`），而 `readRowContent`
（`sqlite-message.repository.ts:93`）在 legacy 明文行走 `parseMessageContent`。
`mapRows` 无 per-row 隔离 → **一行坏消息让整个会话的 `listBySession` 抛错**，
UI 侧会话打不开。

两个叠加的锋面：

1. **存量脏行**：任何一条 `content_json` 非法（历史 bug、手工改库、e2e fixture）的消息
   永久不可读，且不可自愈——`message-content-compaction` 的「坏行隔离」只保证
   **编码**失败留明文，不保证明文**可解析**。
2. **前向兼容悬崖**（更危险）：`BLOCK_TYPES` 是封闭集。写侧新增一个 block 变体
   （L3 已登记「`tool_use` 事件链：任何一端接上工具调用卡片渲染就会同时中三枪」，
   以及 L0 已识别但未处理的 `redacted_thinking` 之外的扩展方向）后，
   **旧版本客户端读新版本写的行会整会话崩**。云同步会让新旧版本共库，这从「理论」
   变成「可复现」。

**建议**：短读口兜底——`rowToMessage` 包一层 try/catch，坏行降级为
`{blocks: [{type:'text', text:'（此消息内容无法解析）'}]}` 并打 warn；
长读口（prompt 组装）保持 fail-fast。这与 RULE「明文行永远合法」是同一条不变量的
另一半：现在只保证了**存储形态**双形态，没保证**内容**双形态。

**置信**：confirmed

---

### F-w9-ds2-chat-a-5 | P2 | logic/prepare-user-messages-for-prompt.ts:86-104

```
async function resolveWorkplaceStatus(path, runtime) {
  const raw = await runtime.sessionKkv.get(
    runtime.sessionId, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY
  );
  ...
  const entries = parseRuleSnapshotJson(raw);
  const hit = entries.find((e) => e.path === path);
```

**描述**：`resolveWorkplaceStatus` 每次调用做一次 KKV 读 + 一次**完整 rule_snapshot
JSON 解析**，只为回答「这个 path 的展示档是什么」。它被
`hydrateFileFull` 在**每个** workplace 附件上调用（`:166` 与 `:196` 两条分支各一次），
而 `hydrateFileFull` 又在**每条**非首次 workplace 附件的历史消息上跑。

一次 `prepareUserMessagesForPrompt` 的成本因此是
`O(workplace 附件总数)` 次 KKV 往返 + 同数量次的整份快照反序列化。
prepare 在 agent-runner **每 step** 跑一次，长会话里 workplace 附件数随历史线性增长。

**同文件内的反证**：`resolveSkillNames`（`:587-600`）对同类问题做了惰性 memo，
`hydrateDirAttach` 也把 `vfs.list` 收在单点。workplace 这条路是**唯一没有 memo 的**——
说明作者知道这个模式，只是漏了一处。

**建议**：在 `prepareUserMessagesForPrompt` 入口处建一个 `Promise<entries | null>`
的一次性 promise（与 `resolveSkillNames` 同形），`resolveWorkplaceStatus` 改吃它。

**置信**：confirmed（调用点与无 memo 事实均已核；每 step 频率见 arch 流 1 ③）

---

### F-w9-ds2-chat-a-6 | P2 | repositories/impl/sqlite-message.repository.ts:360-369 + :390-395

```
  async nextSeq(sessionId: string): Promise<number> {
    const rows = await queryTemplate<...>(
      `SELECT MAX(seq) AS max_seq FROM chat_message WHERE session_id = #{sessionId}`, ...
    return maxSeq == null ? 1 : Number(maxSeq) + 1;
  }
  ...
  async insert(message: ChatMessage): Promise<void> {
    await this.conn.execute(MESSAGE_INSERT_SQL, toMessageParams(message));
```

**描述**：`DefaultMessageService.append`（`service/chat/impl/message.service.ts:193` → `:210`）
在**两个独立语句、无事务**的情况下先取 `MAX(seq)+1` 再 INSERT。DDL 有
`UNIQUE (session_id, seq)`（`chat-schema.ts:56`），所以不会写坏数据，但并发 append
会撞唯一约束并抛裸 `TdbcError`（不是类型化 `ChatError`，`formatIpcError` 兜不住语义）。

并发窗口是真实的：desktop 有两条独立 append 路径——IPC handler
`apps/desktop/src/main/ipc/handlers/messages.ts:125`（`rt.messages.append`）与
运行中的 agent（`agent-runner.ts:690 :745 :894 :932` 的 `session.append`）。
用户在 agent 跑的同时从 CLI/desktop 补一条消息即可能撞上。
子 agent 会话（`parentSessionId`）有自己的 seq 空间，不互相影响。

**建议**：`nextSeq` + `insert` 收进同一个 `conn.transaction`（仓库已有
`SqliteMessageRepository(tx)` 的用法先例），或改用
`INSERT ... SELECT COALESCE(MAX(seq),0)+1 FROM chat_message WHERE session_id=?`
单语句自增。撞约束时映射成可重试错误而不是裸 TdbcError。

**置信**：confirmed

---

### F-w9-ds2-chat-a-7 | P3 | model/message-attachment.schema.ts:131-138

```
export function serializeAttachmentsJson(attachments): string | null {
  if (attachments == null || attachments.length === 0) return null;
  return JSON.stringify(attachments);
}
```

**描述**：写侧零校验，与读侧 `safeParse`（F-3）不对称。当前唯一的写侧闸门在
service 层 `normalizeAppendAttachments`（`message.service.ts:59-66` 的
`messageAttachmentsSchema.parse`），但它拦不住**经其它路径落库**的行
（e2e fixture 直插、旧版本写的行、云同步从旧设备搬来的行）。

**建议**：与 F-3 合并处理；单独看只是「写侧不该信任入参」的常规加固。

**置信**：confirmed

---

### F-w9-ds2-chat-a-8 | P3 | content/parse-message-content.ts:245-267

```
export function assertMessageContent(value: unknown): asserts value is MessageContent {
  ...
  (value as { blocks: ContentBlock[] }).blocks = parseBlocksArray(value.blocks);
```

**描述**：`asserts` 函数带副作用——它会**改写入参**（丢弃空 text 块）。调用方
`message.service.ts:191 :272` 与 CLI `apps/cli/src/message/commands.ts:140` 传进来的
`MessageContent` 对象被就地改写。当前调用点都传临时构造的对象
（`textBlocks(...)` / `{ blocks: toolResults }`），风险低，但签名上的
`asserts value is T` 向调用方承诺的是「只校验不改」，与实现不符。

**建议**：要么返回规范化后的新对象（`normalizeMessageContent`），
要么在 JSDoc 上明写「会就地规范化 blocks（丢弃空 text 块）」。

**置信**：confirmed

---

### F-w9-ds2-chat-a-9 | P3 | logic/visibility-batch-range.ts:53-65

```
/**
 * @deprecated 请改用 {@link computeTailBatchRangeFromSelection}（restore / delete 共用）。
 */
export function computeShowRangeFromSelection(...) {
  return computeVisibilityRestoreRangeFromSelection(...);
}
```

**描述**：标了 `@deprecated` 但**双端仍在消费**——`apps/desktop/renderer/features/chat/transcript-selectable-role.ts:16`
与 `apps/mobile/src/components/chat/transcript-selectable-role.ts:21` 都 import 它，
且 `public/chat.ts:285` 仍导出。deprecation 没有产生任何迁移压力，
两条等价实现（`computeVisibilityRestoreRangeFromSelection` 与
`computeTailBatchRangeFromSelection`）会长期并存。

注：`synth` 侧的 W1 裁决 2 记的是「`transcript-selectable-role` 文件双端同死」——
那说的是 desktop/mobile 的**文件副本**，与本条的 core 符号是否可删是两个问题，
reduce 阶段需分开裁。

**建议**：删掉 desktop / mobile 两处 import，改用 `computeTailBatchRangeFromSelection`，
再摘 `@deprecated`。

**置信**：confirmed

---

### F-w9-ds2-chat-a-10 | P3 | logic/chat-annotate-draft-store.ts:14 + :192-201

```
const bySession = new Map<string, AnnotateDraft[]>();
```

**描述**：进程级 Map，`clearChatAnnotateDrafts` 只在「发送成功」与「回滚恢复」两条路上被调
（`apps/desktop/src/main/ipc/handlers/messages.ts:351`、
`apps/desktop/renderer/features/chat/rollback-annotate-restore.ts:50`、
`apps/mobile/src/screens/tabs/chat-tab/useChatTabMessageActions.ts:283`、
两端 `ChatComposer.tsx`）。**删除会话不调**——用户批注完草稿没发就删会话，
该 session 的草稿永久驻留。

与已在案的 AM-1（`forgetSession` 零调用）同族，但对象不同（那是 mobile runtime 的
三张缓存，这是 core 的 store），修复点也不同。

**建议**：在 `DefaultSessionService.deleteSessionTree`（`session.service.ts:207-232`，
已经在遍历全部会话做清理）里补一次 `clearChatAnnotateDrafts(session.id)`。
注意它会 `notifyAnnotateListeners`，在事务里调要确认监听器不重入写库。

**置信**：confirmed

---

### F-w9-ds2-chat-a-11 | P3 | logic/prompt-path-seen.ts:15

```
export const PROMPT_FILE_SEEN_SHORT_TIP = "该文件前文已引用，无需读取或加载";
```

**描述**：注释自称「文本文件非首次专用短提示正文（JSON 字段口径仍用此常量断言语义）」，
但**生产代码里没有任何地方用这个常量**。真正的短提示由
`buildAlreadyReferencedActionXml`（`build-attachment-action-xml.ts:47-52`）以
`{ path, alreadyReferenced: true }` 的 JSON 形态产出，文案由
`domain/vfs/logic/user-vfs-save-mapping.ts` 的 XML 模板承载，不含这句中文。

唯一的引用是测试，且是**反向断言**：
`packages/core/test/chat/prepare-user-messages-for-prompt.test.ts:681 :876-877`
断言 `body.includes(PROMPT_FILE_SEEN_SHORT_TIP) === false`。

即：这是一个「看起来是单源、实际是反向哨兵」的常量，经 `public/chat.ts:79` 对外导出。
谁按注释去改它会得到相反的结果。

**建议**：要么删掉（连带 `public/chat.ts:79` 与两处反向断言，改为断言
`alreadyReferenced: true` 存在），要么把注释改成「反向断言哨兵：短提示**不含**这句」。

**置信**：confirmed

---

### F-w9-ds2-chat-a-12 | P3 | logic/prepare-user-messages-for-prompt.ts:26 :53 :54 + render-dir-attach-tree.ts:9

```
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";
import type { SkillService } from "@/service/skills/skills.port.js";
```

**描述**：`domain/` 反向引 `service/` 的 port 类型。architecture.md ② 已把
`domain/prompt/logic/expand-dynamic-macros.ts` 记为「唯一一处理想倒置」——
实测**不是唯一**：`git grep -n "@/service/" -- packages/core/src/domain/` 实测
**21 个文件 / 23 行** import（分布：tool 8 文件 12 行、vfs 2、prompt 2、provider 2、
message-checkpoint 1、compaction-conditions 1、workplace 1、**chat 2 文件 4 行**）。
倒置最密集的正是本区（`prepare-user-messages-for-prompt.ts:26 :53 :54` 一处就吃了
3 个 service port，`render-dir-attach-tree.ts:9` 再加 1）。

arch 那句结论需要修正为「倒置已成域层通用手法，chat 区最密集」。

**建议**：把 `WorkplaceService` / `SkillService` / `SessionKkvService` 三个 port
下沉到对应域（`domain/workplace/ports/`、`domain/skills/ports/`、
`domain/session-kkv/ports/`），service 层 re-export 保持兼容。
type-only import 不构成运行时环，但会让「域层不知道服务层」这条分层叙事站不住。

**置信**：confirmed

---

### F-w9-ds2-chat-a-13 | P3 | logic/render-dir-attach-tree.ts:26-28

```
function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
```

**描述**：域层用 Node 专有全局 `Buffer`，无 import、无兜底。RN/Hermes 侧靠
`apps/mobile/src/polyfills.ts:21` 的 `globalThis.Buffer = Buffer` 兜住
（该 polyfill 在 `apps/mobile/index.js:5` 第一行 import，加载序正确）。
`domain/vfs/logic/vfs-zip-filename-decode.ts:23` 有同款先例。

但仓内存在**直接矛盾的口径**：`apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:189`
注释明写「RN/Hermes **无全局 Buffer**，故注入 TextEncoder 全局」——与 polyfills 事实相反。
两处说法必有一错，而本区依赖的恰好是「有」的那一侧。

**建议**：改用仓内另一条已确立的惯例（`TextEncoder`，见
`message-content-codec.ts:46 :91`），彻底摆脱对宿主 polyfill 加载序的隐式依赖；
顺手修正 ChatTranscriptWebView 的过期注释。

**置信**：confirmed（代码事实）；「哪条注释错」标 suspected——polyfills.ts 是可执行事实，
倾向它对、ChatTranscriptWebView 注释过期。

---

### F-w9-ds2-chat-a-14 | P3 | logic/seed-fork-copy-parity.ts:43-47

```
  const entries = new SqliteVfsEntryRepository(tx);
  const contentStore = new SqliteVfsContentStore(tx);
  const revisions = new SqliteVfsRevisionRepository(tx);
  const workplace = new SqliteWorkplaceRepository(tx);
  const checkpoints = new SqliteMessageCheckpointRepository(tx);
```

**描述**：域层 `logic/` 里自建 5 个跨域 SQLite 仓储实现。文件头已把这条登记为
「唯一入口」并要求 message/session service 不得重复构造——自律条款写在注释里，
没有编译期或测试约束。`git grep "new SqliteMessageCheckpointRepository"` 显示
生产侧共 6 处构造点，纪律靠人守。

**建议**：把「唯一入口」升级为断言——在 `seed-fork-copy-parity` 里加一条测试，
枚举全仓构造点并断言只此一处（可参照 L0 的 `coverage-matrix` 思路）。

**置信**：confirmed

---

### F-w9-ds2-chat-a-15 | P3 | logic/message-set-floor-range.ts:1 / visibility-batch-range.ts:1 / tail-batch-range.ts:1

```
/** 消息置位：按锚点 seq 计算 hide/show 区间。 */
```

**描述**：这三个可见性模块的文件头注释缺 `@module` 标签，与本区其余 58 个文件的
house style 不一致（其余均有 `* @module domain/chat/...`）。`message-visible-floor.ts:4`
有 `@module` 但路径写成了 `domain/chat/message-visible-floor`（实际在 `logic/` 下），
`compute-stream-tail-generating.ts:5` 写成 `domain/chat/logic/composer-stream-tail-generating`
（文件名是 `compute-stream-tail-generating`）。

纯文档债，但会让按 `@module` 路径做检索的机具漏收。

**建议**：批量补齐 / 修正。零风险。

**置信**：confirmed

---

### F-w9-ds2-chat-a-16 | P3 | logic/tail-batch-range.ts:62-66

```
export function computeTailBatchAffectedIds(
  rows: readonly TailBatchRow[],
  selectedIds: ReadonlySet<string>,
  _sessionMaxSeq: number
): ReadonlySet<string> {
```

**描述**：第三个形参已改名 `_sessionMaxSeq` 标记不用，函数体也确实不读。
但 port/公开面上仍要求调用方传第三个参数（`public/chat.ts:302` 导出），
两端调用点必须为此准备一个用不上的值。

**建议**：删形参（TS 允许少传尾参，调用方零改动），或若为对齐
`computeVisibilityBatchAffectedIds` 的签名而保留，在注释里写明「签名对齐用，
实现不读」。

**置信**：confirmed

---

### F-w9-ds2-chat-a-17 | P3 | logic/prepare-user-messages-for-prompt.ts:49-54

```
/** 与 `domain/tool/builtin/skill-tool.ts` 注册名同字符串（方向 B 扫描用）。 */
const SKILL_TOOL_NAME = "skill";
import { renderDirAttachTree } from "./render-dir-attach-tree.js";
import { wrapUserMessageForLlm } from "./wrap-user-message-for-llm.js";
import { expandDynamicMacros } from "@/domain/prompt/logic/expand-dynamic-macros.js";
```

**描述**：import 语句被 const 劈成两段（`:17-47` 一段、`:50-54` 一段，中间隔一个
模块级 const）。合法但破坏可读性与工具约定（多数 linter 的 `import/first` 会报）。

同时这是 `"skill"` 字面量的第 4 份副本（另三份：`domain/tool/builtin/skill-tool.ts`
的注册名、`domain/chat/logic/skill-tool-ref.ts:17`、`scan-skill-attachments.ts` 的
`skill:` 命名空间前缀不是同一形态）。`skill-tool-ref.ts:16` 自己写了
「四处同名字符串之一」——architecture.md ② 记的「单源注释比单源实现多」同族。

**建议**：把 const 移到 import 段之后；四份字面量抽到
`domain/tool/model/tool-names.ts` 之类的单源常量（该文件当前无消费方，需先补 public 出口
——正是 arch 记的「抽出单源时没开 public 出口，调用方拿不到就复制」）。

**置信**：confirmed

---

### F-w9-ds2-chat-a-18 | P3 | logic/prepare-user-messages-for-prompt.ts:548-558 vs :601-622

```
  for (const message of messages) {          // ← 预填：扫全部消息，不分先后
    if (message.role !== "assistant" || message.hidden) continue;
    ... seen.add(skillSeenKey(name));
  }
  ...
  for (let i = 0; i < messages.length; i++) { // ← 主循环：严格按 seq 递增
```

**描述**：路径 seen 是**时序**的（主循环边走边加，所以 seq 100 的 `@x.md` 拿到全文、
seq 500 的同名附件拿短提示），而 skill seen 是**前瞻**的——预填扫遍全部消息，
seq 900 的一次 `skill load` 会让 seq 100 处的 `$x` 直接拿 `alreadyReferenced`。

两个命名空间装在同一个 `Set` 里（`prompt-path-seen.ts:60` 的
`createPromptPathSeenSet` 与 `scan-skill-attachments.ts:25` 的 `skill:{name}`），
时间语义却相反。文件头注释（`:6-8`）把 skill 行为描述为「首次读生效副本全文」，
与实现的「全历史预填后一律短提示」有落差。

实践上不算 bug——skill 全文确实以 tool_result 形式留在可见历史里，模型能看到，
预填的动机（避免同一正文注入两遍）成立。但这是**未文档化的语义分叉**：
将来若有人给 skill 加「按序判定」，会与路径 seen 的行为不一致。

**建议**：在文件头注释里明写「skill seen 为全历史前瞻、path seen 为时序」，
或把两者拆成两个 Set（改动更彻底，但会改变 prompt 输出，需评估 token 影响）。

**置信**：confirmed（代码行为）；「是否有意」标 suspected——注释与实现有落差，
但 `:544-547` 的注释解释了动机，倾向有意。

---

### F-w9-ds2-chat-a-19 | P3 | repositories/impl/sqlite-message.repository.ts:31

```
const MESSAGE_SELECT_COLUMNS = `id, session_id, seq, role, content_json, content_encoding, content_blob, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms`;
```

**描述**：21 列全选，含 `raw_json`（arch 流 1 已记「21 列含 raw_json，消费方只要
tool_use 的 id/name」为 P0-1 的放大器）。本区提供的两个减负读口
（`listMessageHeadersBySession` 只取 6 列、`countBySession` 只取 1 行）方向正确，
但**全量读口仍是默认**——`listBySession` / `listBySessionTail` / `listBySessionPage`
/ `listBySessionOffset` / `listBySessionFromSeq` / `searchMessages` 六个方法
（含三个子查询嵌套）全部用这条 21 列常量。

**建议**：不重复报 P0-1；本区可做的是给 `searchMessages` 的 keyset 段
（`:552`）换列子集——它已经在做 `mapRows` 精筛，只需要 `blocks` 里的 text，
不需要 `raw_json` / 8 个 token 列。

**置信**：confirmed（与 xc-fullread 撞车，reduce 去重）

---

### F-w9-ds2-chat-a-20 | P3 | 零消费导出（6 处）

| 符号 | 定义 | 引用面 |
|---|---|---|
| `collectUserOpsChangedPaths` | `diff-workspace-for-user-vfs-flush.ts:122` | **全仓仅定义处**（`git grep -c` = 1），未导出到 public |
| `emptyWorkspaceFlushSnapshot` | `workspace-flush-snapshot.ts:16` | 定义 + `public/chat.ts:143` |
| `deriveDirPathsFromFileTree` | `workspace-flush-snapshot.ts:28` | 定义 + public + 单测 |
| `diffWorkspaceForUserVfsFlush` | `diff-workspace-for-user-vfs-flush.ts:153` | 定义 + 单测（模块已标 `@deprecated`） |
| `mergePendingVfsTurns` | `merge-pending-vfs-turns.ts:14` | 定义 + public + 单测 |
| `visibleFloorByMessageId` | `message-visible-floor.ts:25` | 定义 + public + 单测 |
| `computeStreamTailGenerating` | `compute-stream-tail-generating.ts:10` | 定义 + public + 单测（实现已退化为 `return input.uiRunning`） |
| `buildAnnotatedSource`（及 `findMarkdownCodeRanges` / `splitMarkdownUnderlineRuns` / `escapeAnnotateSourceText`） | `annotate-source-anchor.ts:379 :126 :282 :66` | 定义 + public + 单测 + desktop `shared/logic/chat.ts:45` 再导出 |

**描述**：8 个符号在生产侧零消费。其中 5 个挂在公开面上（`public/chat.ts`），
让「core/chat 导出了什么」这个清单失真。另 3 个（`collectUserOpsChangedPaths`
整个 199 行的 `diff-workspace-for-user-vfs-flush` 模块、`merge-pending-vfs-turns` 整个 15 行模块）
连公开面都没上，只剩单测在保命。

`buildAnnotatedSource` 需单独说明：SPEC R5 明写「宿主 MD/plain 预览主路径**禁止**调用」，
`public/chat.ts:226-230` 与 `annotate-source-anchor.ts:5-7` 都重复了这条禁令，
但它仍在公开面上（`public/chat.ts:231-239` 导出了 6 个同族符号）。
禁令靠注释维持。

**建议**：
- `collectUserOpsChangedPaths` + 整个 `diff-workspace-for-user-vfs-flush` 模块：删
  （已 `@deprecated`，零生产消费，199 行）。
- `merge-pending-vfs-turns` 模块：删（15 行，零生产消费）。
- 其余 5 个：从 `public/chat.ts` 摘掉，域内保留（单测仍可直引 `src/`）。
- `buildAnnotatedSource` 族：先与宿主侧确认 SPEC R5 禁令是否已终局（若已终局则整族可删，
  连带 `annotate-source-anchor.ts` 420 行）；未终局则至少从公开面撤下。

**置信**：confirmed（逐符号 `git grep -c` 核对）；`buildAnnotatedSource` 的「禁令是否终局」
标 suspected——SPEC R5 的状态本区无从判断。

---

## 争议与存疑

1. **`ToolResultBlock.meta` 的封闭性策略**（F-2 / F-4 同源）。读路径对
   `meta` 内未知键是**静默丢弃**（`:171` 注释「未知字段静默忽略（向前兼容）」），
   对**块类型**是**抛异常**（`:127-131`）。同一个「向前兼容」目标，两种相反的策略。
   我倾向统一为「宽松读 + 显式 warn」：抛异常的代价（一行坏块崩整个会话）远大于
   丢弃的代价（少显示一个字段）。但这是产品口径问题——若坚持「消息是用户数据本体，
   不静默降级」（`message-content-codec.ts:57-59` 的原话），那 F-4 的修法就得改成
   「坏行单独隔离」而不是「降级渲染」。**建议交主代理裁决，本报告不拍板。**

2. **`domain/chat` 的分层定位**。本区 `logic/` 里有三个文件实际依赖
   service port 与跨域仓储实现（F-12 / F-14），`content/parse-message-content.ts`
   抛类型化错误、`repositories/impl` 直接发 SQL——「域层=纯函数」这条叙事在本区
   只是**大部分**成立。要么接受「域层可以有薄 IO 编排」的务实口径（则 arch 的
   分层图需加注），要么把 prepare / render-dir-attach-tree / seed-fork-copy-parity
   迁到 service（则 public 出口要跟着动，牵动 4 个 app）。**两条路成本差一个量级，
   必须 reduce 阶段统一裁决，不能各机位各判。**

3. **`SKILL_TOOL_NAME` 的时序语义**（F-18）。当前「skill 全历史预填、path 时序」
   的分叉我认为**不是 bug**（skill 全文确实在可见历史里），但它是一个没有写下来
   的约定。反对意见可能是：L3 记的「前置回合宏值取 run 开始的一次快照」（I3）
   与「前缀回合内天然冻结」（I1）都在把语义往「快照」方向统一，skill 的
   「全历史前瞻」恰好也是快照语义——那么真正不一致的是 **path 的时序**。
   换句话说，也许该改的是 path 不是 skill。**我没能判定哪边是意图，标 suspected。**

4. **arch 的「倒置唯一」结论需修正**（F-12）。architecture.md ② 写
   「`domain/prompt/logic/expand-dynamic-macros.ts` 引 `service/workplace` 的 port
   （**唯一一处**想倒置）」。实测 `domain/` 下 `@/service/` import 分布在
   **21 个文件 / 23 行**。这不是本区能改的（arch 是 L3 产物），但 reduce 阶段必须
   知道这条结论是错的，否则会按「修一处」的口径派单。

5. **`ChatTranscriptWebView.tsx:189` 的注释与 `polyfills.ts` 矛盾**（F-13）。
   我判 polyfills 为真（可执行事实）、该注释为过期，但这条我**没有实跑验证**
   Hermes 下的 `globalThis.Buffer`，只做了静态对账。若移动端某条路径绕过
   `index.js`（如 jest 环境、headless task），`render-dir-attach-tree` 会
   直接 `ReferenceError`。**建议 W6 验证时实跑一次。**

6. **未覆盖的盲区**（本机位能力边界，明写不抹平）：
   - 本区**零行运行时验证**——所有结论来自静态读码 + `git grep` 消费侧对账。
     F-1 的写回放大链、F-2 的丢字段、F-6 的并发窗口，都值得 W6 各跑一个复现。
   - 未审 `apps/desktop/shared/logic/chat.ts` 与 `apps/mobile/test-utils/core-shim.ts`
     两个 barrel 的**转出完整性**（只核了本区符号的转出与几处 re-export，
     没做「barrel 导出的每个符号都真实存在」的全量对账）。
   - 未审 zod schema 的**穷尽性**（`annotate-draft.schema.ts` 的
     `optionalPositiveInt` / `optionalNonNegInt` 组合是否有不可达状态）。
   - 未审 `annotate-highlight` / `annotate-source-range` 的算法正确性
     （offset 映射、CRLF 处理、代码围栏识别），只审了接口与调用面。
     这三个文件 1.2k 行，是本区最大的未验证块。
