---
zone: w9-ds2-chat-b
agent: domain-survey / 独立双扫 B
files_scanned: 61
---

# w9-ds2-chat-b — packages/core/src/domain/chat/ 全量测绘

> 独立双扫 B 位。未读 `raw/` 与 `synth/` 任何文件（纪律项）。
> 基线：worktree `D:\Dev\nm-worktree\mcr`，分支 feat/repo-mega-cr。

## 摘要

`domain/chat` 是 core 的聊天域：消息/会话/项目的模型与 zod schema、`chat_message`/`chat_session`/`chat_project` 三张表的 TDBC repository、提示词拼装入口（附件 hydrate + `<user-ops>` wrap + 短提示去重）、Composer 输入门闩与 `@path`/`$技能` 扫描、批注（annotate）草稿与选区定位算法、可见性批量区间计算、fork/copy 的 revision+checkpoint 播种。纯逻辑层几乎不直接写库，写库一律收口在 `repositories/impl`。RULE 记载的三态设计（明文行永远合法、压缩迁移任务非 migration、file_cache 不作前文引用判据）在本域都能对上代码。

## 职责与边界

- **model/**：`ChatMessage` / `ChatMessageHeader` / `MessageContent`+`ContentBlock` 联合 / `MessageAttachment`（zod，`attachments_json` wire）/ `AnnotateDraft` / `ComposerDraft` / `SessionAgentConfig` / 已废弃的 `ProjectAgentConfig` / `UserVfsPending*`。
- **content/**：`content_json` 严格解析校验（`parse-message-content`）、正文纯文本投影（`message-body-text`）、关键词精筛（`message-content-match`）、CLI 格式化。
- **logic/**：提示词拼装（`prepare-user-messages-for-prompt` 及子件）、`user-ops` XML 构造、Composer 门闩与扫描、状态 chip 文案、可见性/置位区间、批注选区算法与草稿 store、fork 播种、workspace flush diff（已废弃）。
- **repositories/**：三张表的 port + SQLite 实现；消息正文压缩编解码收口在 `message-content-codec`。
- **不在本域**：service 层（`service/chat/**`）、协议适配（`infra/llm-protocol/**`）、agent run 编排。

## 对外接口

全部经 `packages/core/src/public/chat.ts` 转出（60+ 符号）。关键类型：
`ChatMessage` / `ChatMessageHeader` / `MessageContent` / `ContentBlock` / `MessageAttachment` / `MessageAttachmentAction`（10 值枚举）/ `AnnotateDraft` / `ComposerDraft` / `SessionAgentConfig` / `SkillToolRef` / `MessageSearchQuery` / `MessageMetadata`。
关键函数：`prepareUserMessagesForPrompt`、`wrapUserMessageForLlm`、`parseMessageContent` / `assertMessageContent`、`resolveComposerSendIntent`、`scanAtPathAttachments` / `scanSkillAttachments`、`formatStatusChipLabelFromAttachment`、`buildAnnotateAttachmentFromDraft` / `parseAnnotateDraftsFromAttachments`、`computeSetFloorRanges` / `computeTailBatchRangeFromSelection`、`resolveChatLinkTarget`、`seedForkCopyParity`。
SQLite 实现类：`SqliteMessageRepository` / `SqliteSessionRepository` / `SqliteProjectRepository`（**不经 public 转出**，由 `service/chat` 内部 `reposFor` 构造）。

## 数据访问

| 表 / 域 | 触点 | 证据 |
|---|---|---|
| `chat_message` | 全部 21 列 SELECT/INSERT/UPDATE/DELETE，含 `content_encoding`/`content_blob` 双形态读 | `repositories/impl/sqlite-message.repository.ts:31`（列清单）、`:38`（INSERT SQL）、`:82`（双形态读口）、`:502`（searchMessages） |
| `chat_message` 解压产物缓存 | `infra/content-cache` 按 messageId 记 LRU；写口必须 forget | `logic/message-content-codec.ts:76`、`repositories/impl/sqlite-message.repository.ts:386`（updateContent forget）、`:393`（insert forget）、`:435`（delete forget） |
| `chat_session` | `composer_draft_json` / `agent_config_json` 侧信道列 | `repositories/impl/sqlite-session.repository.ts:133`、`:161` |
| `chat_project` | `agent_config_json`（功能已下线，列保留） | `repositories/impl/sqlite-project.repository.ts:85`、`:99` |
| KKV `rule_snapshot` | 每条 workplace 附件读一次 canon key 解析展示档 | `logic/prepare-user-messages-for-prompt.ts:90` |
| KKV `file_cache` | 首次全文 hydrate 走 `loadOrFillFileCache` | `logic/prepare-user-messages-for-prompt.ts:199` |
| VFS | 目录树渲染、batch 技能正文读（不经 file_cache）、fork 播种 | `logic/render-dir-attach-tree.ts:75`、`logic/prepare-user-messages-for-prompt.ts:343`、`logic/seed-fork-copy-parity.ts:43-47` |
| `vfs_content_blob` / `workplace_dir_rule` / checkpoint | fork/copy 播种事务内 | `logic/seed-fork-copy-parity.ts:74`、`:106`、`:135` |

DDL 侧：`chat_message` 有 `UNIQUE(session_id, seq)`，仅一个 `idx_chat_message_created_at`（`bootstrap/chat/chat-schema.ts:28-60`）——`session_id` 查询靠 UNIQUE 索引前缀，无独立 `session_id` 索引（可接受）。

## 依赖关系

**import 谁**：`infra/tdbc`（connection/template-helper）、`infra/sql-template`、`infra/content-cache`、`domain/vfs`（path-mapper / user-vfs-save-mapping / zlib-codec / repositories / content-store）、`domain/workplace/logic`（rule-snapshot / load-or-fill / workplace-display）、`domain/session-kkv`（域常量）、`domain/tool/logic/format-tool-output`、`domain/message-checkpoint`、`domain/skills/model/skill-name`、`domain/prompt/logic/expand-dynamic-macros`、`service/session-kkv` + `service/workplace` + `service/skills` 的 port 类型、`errors/chat-errors`。

**被谁消费**：`service/chat/impl/{message,session,project,usage-stats,message-transcript-effects,user-vfs-turn}.service.ts`、`service/agent/logic/run-agent-turn.ts`、`service/prompt/*`、`infra/llm-protocol/impl/*`、`infra/tokenizer/*`、`domain/prompt/logic/{message-body,normalize-for-llm-export}.ts`、`domain/depth/logic/depth-from-tail.ts`、`public/chat.ts` → 双端 App + CLI。

**层次反例**：`logic/seed-fork-copy-parity.ts:12-19` 在 domain 层直接 `new` 了 5 个 infra/vfs/workplace 的 SQLite repository impl（文件头以「唯一入口」自我豁免）。这是有意的编排型 helper，但让 domain 层持有了 infra 具体实现依赖。

## 发现清单

### F-w9-ds2-chat-b-1 | P2 | logic/scan-at-path-attachments.ts:25
```
const AT_PATH_TOKEN_RE = /@([^\s@]+)/g;
```
`@` 扫描无左边界守卫，`foo@bar.com` 会被扫成 `path: "/bar.com"` 的 attach 附件（实测 node：`email me at foo@bar.com please` → match `bar.com`）。同域 `scan-skill-attachments.ts:22` 明确用了 `(?<!\S)` 并注释「避免误吞 `a$b`」，两处口径不一致。后果链已验证：`run-agent-turn.ts:664` 把扫描结果直接并入落库附件 → `prepare-user-messages-for-prompt.ts:199` 对不存在的路径调 `loadOrFillFileCache` → `readWorkplaceFileBody` catch 返回 `"(missing)"` → 提示词里出现一条伪造的文件引用；同时 `composer-send-intent.ts:42` 用同一扫描计数，空文本 + 邮箱会被判为「有可发送输入」。
**建议**：`/@` 加与 skill 扫描同款的 `(?<!\S)` 前置边界（或至少排除命中前为字母/数字的形态）。
**置信**：confirmed（正则行为实测 + 下游三处消费点已定位）。

### F-w9-ds2-chat-b-2 | P2 | logic/annotate-source-range.ts:377
```
haystack = normSource;
starts = findAllNeedleStarts(haystack, needle);
```
`locateAnnotateOffsetRangeByQuoteContext` 在 raw 命中失败时切到 `normSource`（`\r\n`→`\n`、`\u00a0`→空格，长度可变），返回的 `startOffset/endOffset` 是**归一化坐标系**的下标；调用方 `estimateSoftOffsetRangeFromQuoteContext`（`:437`）却把它当**原文坐标系**传给 `estimateSoftOffsetRangeFromPlainOffsets(sourceText, ...)`。两条路径同时触发（正文含 nbsp 使 raw 落空 + 正文含 CRLF 使归一化变短）时 offset 必然错位。实测：原文 24 字符、归一后 20 字符，命中下标 6 在原文里切出的是 `"z hello wor"` 而非 `"hello world"`。
对照组：同文件 `estimateSoftRangeFromOriginalText:264` 传的是 `haystack`（归一化串），坐标系自洽——说明这是单点失误而非设计。
**建议**：fallback 分支返回前把下标映射回原文坐标（或返回 `{ offset, normalized: true }` 让调用方切 `haystack`）。
**置信**：confirmed（node 实测复现 + 对照组确认）。

### F-w9-ds2-chat-b-3 | P2 | model/message-attachment.schema.ts:121
```
const result = messageAttachmentsSchema.safeParse(parsed);
if (!result.success) { return undefined; }
```
数组级 safeParse：**任一**附件不合法就整条消息的 `attachments_json` 解析为 `undefined`，全部附件静默丢失（含批注附件）。而 `messageAttachmentSchema.superRefine:88` 要求「有 action 时 `name` 必须等于 `attachmentStorageName(path)`」——任何在该规则之前写入的历史行、或 name 写法的历史差异，都会一次性抹掉整条消息的附件。批注 Undo 恢复（`build-attachment-action-xml.ts:199` `parseAnnotateDraftsFromAttachments`）直接读这个数组，丢失即恢复不出划词。
**建议**：逐条 safeParse，坏条目降级为 `undefined` 并保留其余；或至少对 `action==='annotate'` 走宽松分支。
**置信**：confirmed（schema 语义 + 两处消费点已定位）。

### F-w9-ds2-chat-b-4 | P2 | content/parse-message-content.ts:172-200
```
if ("subagentSessionId" in metaValue && typeof metaValue.subagentSessionId !== "string") { throw ... }
const skillRef = parseSkillRefMeta(metaValue.skillRef, label);
```
`tool_result.meta` 的解析只投影 `subagentSessionId` 与 `skillRef`，**丢弃 `failureReason`**；而 `model/content-block.ts:66` 把它列为正式字段，`domain/tool/logic/build-tool-result-block.ts:283/288` 在子代理被用户停止时确实写入 `meta.failureReason`。写入 → 落库 → 读回即丢，是确定的 round-trip 数据损失。
现状缓解：全仓 grep 未找到任何消费 `failureReason` 的 UI 路径，所以今天只是潜伏契约破损（未来接 UI 即踩）。
**建议**：meta 解析补 `failureReason?: string`（与 `subagentSessionId` 同款校验），或在 content-block 上把它标 `@deprecated` 并停止写入。
**置信**：confirmed（类型/写入/解析三处对读）。

### F-w9-ds2-chat-b-5 | P2 | logic/prepare-user-messages-for-prompt.ts:592
```
} catch {
  return new Set<string>();
}
```
`resolveSkillNames` 把 `effectiveSkills()` 的任何异常（DB 错误、IO 错误）与「技能确实不存在」折叠成同一个空集合；下游 `hydrateSkillAttachWithSeen:334` 判定 `!names.has(name)` 后产出 `SKILL_ATTACH_MISSING_NOTE = "技能不存在或已删除"`（`:291`）注入提示词。瞬时故障会让模型收到一条**事实错误**的断言。同理 `:358` 的 `catch {}` 把 `readSkillFile` 的所有异常（含权限、编码）一律当作「不存在」。
**建议**：区分「读失败」与「不存在」——读失败时不产出 missing note（或产出 note 但标注为读取失败），并保留不写 seen 的自愈语义。
**置信**：confirmed。

### F-w9-ds2-chat-b-6 | P3 | content/parse-message-content.ts:266
```
(value as { blocks: ContentBlock[] }).blocks = parseBlocksArray(value.blocks);
```
`asserts` 函数带副作用：直接改写调用方传入对象的 `blocks`（并顺带丢弃空 text 块）。`message.service.ts:191` 与 `:272` 传的是调用方持有的 `MessageContent`，于是 append/updateContent 之后调用方的对象被静默改写。行为本身（丢弃 GLM 遗留空 text 块）是有意的，但用类型断言绕过 `readonly blocks` 做原地改写，掩盖了「校验」与「规范化」的边界。
**建议**：拆成 `normalizeMessageContent(value): MessageContent` 纯函数 + `asserts` 只做校验。
**置信**：confirmed。

### F-w9-ds2-chat-b-7 | P3 | content/message-body-text.ts:15
```
.replace(/<\/(?:thought|thinking|think|redacted_thinking)\b[^>]*>/gi, "")
```
`stripOrphanThinkingCloseTags` 作用于**所有** text 块，包含用户自己输入的正文。用户消息里字面写下 `</thinking>` 会在提示词投影时被删掉（落库不变，仅 prompt 侧丢字）。
**建议**：限定只对 assistant 消息的 text 块生效，或改为仅在检测到孤立闭合标签（无配对开标签）时剥离。
**置信**：confirmed（作用域由 `blockBodyText` 无 role 上下文可见）。

### F-w9-ds2-chat-b-8 | P3 | logic/status-chip-label.ts:245
```
const jsonMatch = /\{[\s\S]*\}/.exec(content);
```
`parseContentJson` 对 XML 里的 JSON 直接 `JSON.parse`，**不做 XML 实体反转义**。而写入侧 `buildUserVfsActionXml`（`domain/vfs/logic/user-vfs-save-mapping.ts:265`）对 JSON 做了 `escapeXmlText`（`&`/`<`/`>` → 实体）。批注 chip 文案取自 `userAnnotation` / `originalText`（`status-chip-label.ts:260`），用户批注里写 `<`、`&` 时，chip 会显示 `&lt;` / `&amp;` 字面量。同域 `user-vfs-turn-view.ts:48` 的 `unescapeXml` 正是为此存在，两处口径不一致。
附带：正则 `\{[\s\S]*\}` 贪婪，若 content 含多个 `<action>` 会跨块匹配导致 parse 失败（当前单附件场景不触发）。
**建议**：`parseContentJson` 先 `unescapeXml` 再 parse；贪婪正则改惰性或按 `<action>` 边界切。
**置信**：confirmed（写入侧 escapeXmlText 与读取侧缺 unescape 已对读）。

### F-w9-ds2-chat-b-9 | P3 | logic/tail-batch-range.ts:67
```
const selected = rows.filter((r) => selectedIds.has(r.id) && r.selectable);
```
`computeTailBatchAffectedIds` 只按 `selectable` 过滤，**不看 `mode`**；而同文件的 `computeTailBatchRangeFromSelection:87` 用的是 `isTailBatchRowSelectable(r, mode)`。restore 模式下 affected-ids 预览会把「本来就可见」的行也算进受影响集合（实际 `showRange` 只翻 `hidden=1` 的行）。预览与执行口径不一致。
**建议**：预览与执行共用 `isTailBatchRowSelectable(row, mode)`；或明确注释两者语义差异（截断确实会删掉可见行，故 delete 模式全列是对的）。
**置信**：confirmed。

### F-w9-ds2-chat-b-10 | P3 | logic/message-visible-floor.ts:14
```
export function listVisibleSorted(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => !m.hidden);
}
```
函数名与文档都声明「sorted by seq ascending」，实现只 filter 不 sort，正确性依赖调用方（唯一调用方 `domain/depth/logic/depth-from-tail.ts:34` 恰好传的是 seq 序列表）。改名或补 sort，避免未来调用方踩。
**置信**：confirmed。

### F-w9-ds2-chat-b-11 | P3 | logic/chat-annotate-draft-store.ts:14
```
const bySession = new Map<string, AnnotateDraft[]>();
```
模块级 Map，无删除会话时的清理路径（`removeChatAnnotateDraftsByPath` / `clearChatAnnotateDrafts` 都要求调用方显式调）。会话被删除后草稿常驻，且 key 是 sessionId 不复用，实际是缓慢泄漏 + 潜在串味（若 id 复用）。桌面多窗口/多项目常驻进程下更明显。
**建议**：会话删除链路显式调 `clearChatAnnotateDrafts(sessionId)`。
**置信**：suspected（未追到删除会话是否已调用；grep 只在 `public/chat.ts` 与本文件出现，说明 App 侧目前也没调）。

### F-w9-ds2-chat-b-12 | P3 | logic/fork-session-title.ts:29
```
max = Math.max(max, Number.parseInt(match[1]!, 10));
```
标题序号靠扫现存标题取 max+1，非原子。会话标题无唯一约束，两个并发 fork（或 fork 与新建撞名）可产出同名 `xxx_ckpt_1`。仅影响可读性，不影响数据。
**置信**：suspected。

### F-w9-ds2-chat-b-13 | P3 | repositories/impl/sqlite-message.repository.ts:110
```
: (JSON.parse(String(row.raw_json)) as Record<string, unknown>);
```
`raw_json` 的 `JSON.parse` 无保护，一行脏数据会让整个 `listBySession` / `searchMessages` 抛异常。相比之下 `content_json` 的 fail-fast 是 RULE 明文设计（用户数据本体不做静默自愈），`raw_json` 只是辅助元数据（synthetic 标记 / metadata），两者不该同级。`parseMessageContent` 的 fail-fast 有类型化错误文案，`raw_json` 这条是裸 `SyntaxError`。
**建议**：`raw_json` 解析失败降级为 `null` 并记 warn。
**置信**：confirmed。

### F-w9-ds2-chat-b-14 | P3 | logic/render-dir-attach-tree.ts:27
```
return Buffer.byteLength(text, "utf8");
```
core domain 直接用 Node 全局 `Buffer`，未 import。桌面/CLI 有 Node 没问题；移动端靠 `apps/mobile/src/polyfills.ts:21` 的 `globalThis.Buffer = Buffer` 兜住（本仓另一处 `domain/vfs/logic/vfs-zip-filename-decode.ts:23` 同样如此，属既有先例）。但 WebView 侧若引入该模块即炸（当前 webview 不 import core，无碍）。
**建议**：换成 `new TextEncoder().encode(text).length`（同域 `message-content-codec.ts:46` 已用 TextEncoder），去掉对宿主的隐式依赖。
**置信**：confirmed。

### F-w9-ds2-chat-b-15 | P3 | repositories/impl/sqlite-project.repository.ts:99
```
async updateAgentConfig(id, configJson, updatedAtMs): Promise<boolean> {
```
RULE 记载项目智能体 v1.4.26 已下线、「业务代码不再写入」，但写路径仍完整可达：`project.service.ts:214 updateAgentConfig`（标 `@deprecated` 但未删）→ 本方法 → 且 desktop IPC 通道仍注册（`apps/desktop/renderer/ipc/invoke-registry.ts:211` + `handler-registry.ts:237` 的 `PROJECTS_UPDATE_AGENT_CONFIG`）。即 UI 已无入口但 IPC 仍可写库，与 RULE 的「不再写入」表述冲突。
**建议**：确认是保留兼容（则补 RULE 说明「IPC 通道保留但无 UI 入口」）还是应收口（摘 handler + 标 deprecated 到下轮删）。
**置信**：confirmed（写路径 + IPC 注册双侧已定位）；是否有意保留需 synth 层与 RULE 作者对齐。

### F-w9-ds2-chat-b-16 | P3 | logic/diff-workspace-for-user-vfs-flush.ts:1
```
* @deprecated 手改热路径已改读 UserOpsLogStore；本模块仅过渡期单测 / 旧工具保留。
```
整个 199 行模块（含 `diffWorkspaceForUserVfsFlush` / `isWorkspaceFlushDiffEmpty` / `collectUserOpsChangedPaths`）在 `src` 与 `apps` 内零消费方，`public/chat.ts` 也未转出。与之同簇的还有 `logic/merge-pending-vfs-turns.ts`（15 行）、`model/user-vfs-pending.schema.ts`（34 行）、`logic/workspace-flush-snapshot.ts` 的 `emptyWorkspaceFlushSnapshot`/`deriveDirPathsFromFileTree`——全部只经 public 转出而无内部消费者，对应 RULE 记载的「`user_vfs_pending` 已无写入方」。合计约 250 行 user_ops 拆除后的死代码。
**建议**：随 user_ops 退役一并物理删除（含专属测试），或明确列入「下轮清理」清单。
**置信**：confirmed（grep 全仓零消费）。

### F-w9-ds2-chat-b-17 | P3 | logic/prepare-user-messages-for-prompt.ts:90
```
const raw = await runtime.sessionKkv.get(runtime.sessionId, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY);
```
每条 `source === "workplace"` 的历史附件都独立发一次 KKV 读（同一轮 prepare 内 N 条附件 = N 次读，值完全相同）。`prepareUserMessagesForPrompt` 是每轮提示词拼装必经路径，长会话 + 多附件时是可观测的重复 IO。
**建议**：在 `PrepareUserMessagesForPromptRuntime` 上加一层 per-call memo（或把快照提到 runtime 上一次解析、多附件复用）。
**置信**：confirmed。

### F-w9-ds2-chat-b-18 | P3 | logic/prepare-user-messages-for-prompt.ts:199
```
const cached = await loadOrFillFileCache({ ..., path: logicalPath, status });
```
图片/二进制附件在 `:110 resolveAttachFileStatus` 已判为 `"filename"` 档（不读正文），但仍走 `loadOrFillFileCache` → `fillFileCacheFromVfs`（`load-or-fill-file-cache.ts`）→ `readWorkplaceFileBody` 对 filename 档直接返回 `{ body: "", mtimeMs: 0 }`，**随后仍把这份空正文写回 file_cache**。等于每张图片/二进制附件都在 file_cache 里占一条空记录。
**建议**：filename 档跳过 file_cache 读写（与 `render-dir-attach-tree.ts:18` 已有的「不读写 file_cache」口径对齐）。
**置信**：confirmed。

### F-w9-ds2-chat-b-19 | P3 | logic/prepare-user-messages-for-prompt.ts:516
```
const plainText = messageBodyTextFromContent(message.content);
...
content: textBlocks(wrapped),
```
prepare 把 user 消息正文整体拍平成单一 text 块。`blockBodyText`（`message-body-text.ts:26`）对 `image` 块返回字面量 `"[image]"`，因此含 image 块的 user 消息经 prepare 后图片信息降级为字符串占位（`isUserInputMessage` 只排除 tool_result，不排除 image）。当前 user 消息均由 `textBlocks` 构造（`run-agent-turn.ts:729`），风险低，但一旦引入多模态 user 输入即静默丢图。
**建议**：prepare 时保留非 text 块原样（与 wrap 的 XML 结构解耦），或在 `isUserInputMessage` 侧显式排除 image-only 消息。
**置信**：suspected（未找到构造含 image 块 user 消息的现役路径）。

### F-w9-ds2-chat-b-20 | P3 | logic/message-visible-floor.ts（关联）: content/parse-message-content.ts:113
（与 F-6 同源，此处不重复计数，仅记录一条观察：`parseBlocksArray` 静默丢弃空 text 块，配合 `assertMessageContent` 的原地改写，使「校验」函数同时承担了数据变换职责，见 F-6。）

## 争议与存疑

1. **F-15（项目智能体 IPC 写路径仍在）**：我确认了链路完整可达，但 RULE 的措辞（「业务代码不再写入」）可能指「UI/业务层不再主动写」，IPC 通道属遗留兼容。若 synth 层能联系到 RULE 作者确认为**有意保留**，应改标 `intentional` 而非缺陷。
2. **F-16（user_ops 死代码簇）**：`user-vfs-turn-view.ts`（306 行，`matchUserVfsTurnAt` / `buildUserVfsTurnView` / `formatUserVfsTurnPreviewBody`）同样只经 public 转出、无内部消费，且 `user_vfs_action` / `user_vfs_ack` 两个 metadata kind 在 `src` 内已无写入方（只余 `normalize-for-llm-export.ts:24` 的历史兼容读取）。这是**为存量历史消息保留的读侧**，与 F-16 的纯死代码性质不同——我没把它并入 F-16，但两者应一起决策「保留读侧兼容 vs 整体退役」。RULE 对 done 桥退役有明文（v1.5.2 全链路移除、历史按普通 assistant 出站），对 user_vfs 两段消息**没有**对应条款，属决策空白。
3. **F-1 的严重度**：`@` 邮箱误扫产生的是「提示词里多一条 `(missing)` 文件引用」，不造成数据损坏。我给 P2 是因为它同时污染落库附件与发送门闩；若 synth 层认为 UI 侧另有存在性过滤（我在 core 与双端 App 内均未找到），可降 P3。
4. **F-2 的可达性**：`estimateSoftOffsetRangeFromQuoteContext` 在 core 与双端 App 内都无消费方（grep 只命中定义与 public 转出），所以今天不触发实际批注错误；但它是 `build-attachment-action-xml` 落库链路上游的公开算法，未来任何调用方接入即踩。严重度按「潜伏缺陷」记 P2 而非 P1。
5. **`attach-binary-heuristic.ts` 的扩展名启发式**：`.pdf` 被划入 binary → 走 filename 档（只给模型文件名）。对「让模型读 PDF 内容」的需求是设计取舍而非缺陷，但 `attachFromPath`（`scan-at-path-attachments.ts:129-144`）里 binary 分支与默认分支返回的对象**完全相同**（都是 `type:"text"` + `content:null`），该分支是死分支。
6. **`computeHideRangeFromSelection`（`visibility-batch-range.ts:36`）返回 `fromSeq: 1`**：手动批量隐藏会把 seq 1 起整段（含 user 消息）置 hidden，可能造成可见历史不以 user 开头。RULE 的「可见历史必以 user 开头」是压缩口径的约束，且 `service/prompt/normalize-orphan-tool-results-for-llm.ts` 会兜底孤儿 tool_result，故未列为缺陷，仅记录口径差异。