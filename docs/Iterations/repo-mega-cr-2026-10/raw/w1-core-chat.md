---
zone: core-chat
agent: domain-survey
files_scanned: 61
---

## 摘要（≤150字）

`packages/core/src/domain/chat/` 是消息域的底座：消息/附件/会话的模型与 zod wire 契约、`chat_message`/`chat_session`/`chat_project` 三张表的 SQLite 仓储、正文 blob 编解码与进程内解压缓存、发提示词前的附件 hydrate + XML wrap（短提示 alreadyReferenced、常驻前缀 seen 共享、extra-info 注入）、以及一批纯函数区间/批处理/批注定位算法。本批共读 60 个域内文件 + 1 个相邻缓存契约文件（`infra/content-cache/logic/decoded-content-cache.ts`），域内 61 文件共 7703 行。回滚锚点不在本域（`domain/message-checkpoint/`，18 文件另计）。

## 职责与边界

| 子目录 | 职责 | 边界 |
|---|---|---|
| `model/` | 消息（`ChatMessage` / `ChatMessageHeader`）、content blocks、附件、usage、metadata、会话/项目/智能体配置、composer 草稿、批注草稿、user_vfs pending 的类型与 zod wire 校验 | 纯类型 + 解析/序列化，无 IO |
| `repositories/` | 三个 port（`MessageRepository` 18 方法 / `SessionRepository` / `ProjectRepository`）与 TDBC 实现 | 只做 SQL + 行映射 + 压缩编解码收口；不含业务语义（区间计算、锚点解析在 `logic/` 与 `domain/message-checkpoint/`） |
| `content/` | blocks 的严格解析校验、纯文本抽取、CLI 格式化、关键词匹配 | 无 IO |
| `logic/` | 提示词拼装（`prepare-user-messages-for-prompt` / `wrap-user-message-for-llm` / `prompt-path-seen`）、附件扫描（`@path` / `$技能`）、状态 chip 文案、批注定位/高亮算法、可见性与 tail 批量区间、fork 播种、用户 VFS 遗留逻辑 | 纯函数为主；少数接受 `VfsService` / `SessionKkvService` 依赖注入口 |

**不在本域**：回滚锚点解析（`domain/message-checkpoint/logic/resolve-rollback-anchor.ts`）、压缩锚定（`domain/depth/`）、置位执行（`service/chat/impl/message-transcript-effects.service.ts`）、正文压缩搬运（`infra/db-maintenance/`）。`domain/chat` 里保留了与这些相邻域交互所需的最小编排逻辑（`seed-fork-copy-parity` 会自建 message-checkpoint / vfs / workplace repo，模块头明确「唯一入口」纪律）。

## 对外接口（导出的关键符号/类型，挑重要的）

**仓储 port**（`repositories/message.port.ts`）
- 读：`listBySession(id, {includeHidden?})`、`listMessageHeadersBySession`（无正文投影）、`countBySession`、`listBySessionOffset`、`listBySessionFromSeq`、`listBySessionTail`、`listBySessionPage`、`findById`
- 写：`insert` / `batchInsert` / `updateContent` / `updateHidden` / `updateHiddenRange`
- 删：`delete` / `deleteBySession` / `deleteAfterSeq` / `listIdsAfterSeq`
- 发号与查：`nextSeq`、`searchMessages(sessionId, MessageSearchQuery)`

**提示词拼装**：`prepareUserMessagesForPrompt(messages, runtime)` + `PrepareUserMessagesForPromptRuntime`（`sessionKkv` / `vfs` / `seenPaths` / `extraInfo` / `workplace` / `filetree` / `skills` / `projectId`）

**编解码**：`encodeMessageContent(json) → {encoding, blob}`、`decodeMessageContent(encoding, blob, messageId) → json`（进程内 LRU 缓存的唯一写口，`message-content-codec.ts:71`）

**附件 wire**：`messageAttachmentSchema` / `messageAttachmentsSchema` / `parseAttachmentsJson` / `serializeAttachmentsJson` / `attachmentStorageName` / `messageAttachmentActionSchema`（delete/write/edit/mkdir/rename/move/workplaceChange/userAttach/annotate/skillAttach）

**区间算法**（双端共用，经 `public/chat.ts` 转发）：`visibility-batch-range`（hide/restore 勾选与范围）+ `tail-batch-range`（restore/delete 尾级联）+ `message-set-floor-range` + `message-visible-floor`

**批注**：`annotate-source-range`（宽松行列/半开 offset 定位与裁剪）、`annotate-source-anchor`（注入锚派生串，已标非预览主路径）、`annotate-highlight`（纯算法：flat 文本索引 / 区间切分 / 原文匹配）、`chat-annotate-draft-store`（进程内草稿 CRUD + chip 投影）

## 数据访问（触碰的表/KKV 域，带 file:line 证据）

| 表 / KKV 域 | 读 | 写 | 证据 |
|---|---|---|---|
| `chat_message`（21 列全量投影 `MESSAGE_SELECT_COLUMNS`） | `sqlite-message.repository.ts:31` | 同上 | SELECT 列常量定义于 `:31`；INSERT 列序常量 `:38-41`，与 `toMessageParams` 参数序 `:53-79` 手工对齐（注释钉死） |
| `chat_message.content_json` / `content_encoding` / `content_blob` | `sqlite-message.repository.ts:82-94`（`readRowContent` 双形态） | `:374-381`（`updateContent`）、`:54`（`toMessageParams` 写 `""` + 压缩两列） | — |
| `chat_message.hidden` | `:221-222`、`:257`、`:466` | `:475`、`:491-496` | SQL 层过滤 `includeHidden:false` |
| `chat_session`（`composer_draft_json` / `agent_config_json` 侧信道） | `sqlite-session.repository.ts:137`、`:165` | `:154`、`:184-185` | 草稿写不更新 `updated_at_ms`（`:29-33` 契约注释），智能体切换写更新（`:180`） |
| `chat_project`（`agent_config_json`） | `sqlite-project.repository.ts:92` | `:107-108` | 功能已下线，列保留 |
| KKV `rule_snapshot` | `prepare-user-messages-for-prompt.ts:90-94`（`resolveWorkplaceStatus`，**逐条 workplace 附件各读一次**） | 本域不写 | 只在 `attachment.source === "workplace"` 时触发 |
| KKV `file_cache` | `prepare-user-messages-for-prompt.ts:199-205`（`loadOrFillFileCache`） | 本域不写 | 只在首次引用时读；非首次走短提示 |
| KKV `user_vfs_pending` | 本域**不读不写**，只有 schema 类型（`model/user-vfs-pending.schema.ts:4` 注释） | — | RULE：user ops 拆除后已无写入方 |
| 进程内 LRU（非表） | `message-content-codec.ts:76` `lookupDecodedMessageContent` | `:92` remember；`sqlite-message.repository.ts:386/393/415/435` forget | 身份契约见 `infra/content-cache/logic/decoded-content-cache.ts:30-36` |

**写路径收口确认**（全仓 grep `UPDATE chat_message|INSERT INTO chat_message|DELETE FROM chat_message`）：只有 `sqlite-message.repository.ts` 一处，加两个后台维护任务（`infra/db-maintenance/impl/message-content-compaction.ts`、`blob-binary-normalization.ts`，只换字节形态、正文不变，按缓存契约无需失效）。无旁路写口。

## 依赖关系

**本域 import 的其它域**
- `@/infra/tdbc`（`TdbcConnection` / `SqlTemplateParser` / `template-helper` / `Row`）
- `@/infra/sql-template`、`@/infra/content-cache/logic/decoded-content-cache`
- `@/domain/vfs`（`vfs-service.port` / `vfs-path-mapper.resolveLogicalPath` / `normalize-path` / `parent-dir` / `scopeKey` / `user-vfs-save-mapping` / `action-xml-to-tool-uses` / entry/revision/content-store 三个 repo）
- `@/domain/message-checkpoint`（`listSessionFileHeads` + `SqliteMessageCheckpointRepository`，仅 `seed-fork-copy-parity.ts:12-13`）
- `@/domain/workplace`（`load-or-fill-file-cache` / `rule-snapshot-codec` / `workplace-display` / `workplace-scope` / `SqliteWorkplaceRepository`）
- `@/domain/session-kkv`（域常量）、`@/domain/skills`（`SKILL_NAME_PATTERN`）、`@/domain/agent`（`agent-definition`）、`@/domain/prompt`（`expand-dynamic-macros`）
- `@/service/session-kkv`、`@/service/workplace`、`@/service/skills`（只 import **port 类型**，不反向依赖实现）
- `@/domain/tool/logic/format-tool-output`（`message-body-text.ts:7`）

**反向依赖方（`grep -rln` 实测）**
- `packages/core/src/service/chat/impl/message.service.ts`（13 处）、`session.service.ts`、`message-transcript-effects.service.ts`、`usage-stats.service.ts`
- `packages/core/src/service/agent/impl/chat-agent-session.ts`、`logic/run-agent-turn.ts`、`impl/agent-runner.ts`
- `packages/core/src/service/compaction-conditions/hide-message.action.ts`
- `packages/core/src/domain/depth/logic/depth-from-tail.ts`、`domain/tool/builtin/subagent-tool.ts`
- `packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts`（6 处）
- `packages/core/src/service/vfs/build-user-vfs-turn-op.ts`、`service/chat/impl/user-vfs-turn.service.ts`
- `packages/core/src/public/chat.ts`（公共出口，转发给双端）
- `apps/mobile/src/services/session-messages-loader.ts` / `session-prompt-input.service.ts` / `chat-prompt-tokens.service.ts` / `session-stream-unit*.ts`
- `apps/desktop/src/main/ipc/handlers/messages.ts`、`src/main/services/session-prompt-input.service.ts`
- 双端薄 re-export：`apps/mobile/src/components/chat/transcript-selectable-role.ts`、`apps/desktop/renderer/features/chat/transcript-selectable-role.ts`

---

## 发现清单

### F-core-chat-1 | P2 | packages/core/src/domain/tool/builtin/subagent-tool.ts:219（消费方在本域外，API 在本域内）

```ts
const childMessages = await subagent.messages.listBySession(childSessionId);
const lastText = extractLastAssistantText(childMessages);
```

**问题**：`listBySession` 是全表读 + 逐行 zlib 解压（`sqlite-message.repository.ts:223-230` + `readRowContent:82`）。而 `extractLastAssistantText` 是**从末尾向前扫**（`for (let i = messages.length - 1; i >= 0; i--)`），末条 assistant 几乎总在最后几行。本域已提供 `listBySessionTail(sessionId, limit)`（`message.port.ts:59`、impl `:300-320`）正是为此准备的，调用方没用。`task` 工具在父 agent 回合内可被多次调用，每次都重付一遍整会话的 inflate。

**建议**：改 `listBySessionTail(childSessionId, 20)`（留足余量覆盖「末条 assistant 无 text block 继续回溯」），或在 `MessageRepository` 上加 `findLastAssistantText(sessionId)`。

**置信**：confirmed（调用形态与 `extractLastAssistantText` 的回溯方向都已实读）

---

### F-core-chat-2 | P2 | apps/mobile/src/services/chat-prompt-tokens.service.ts:458

```ts
const all = await runtime.messages.listBySession(scope.sessionId);
const visible = all.filter(m => !m.hidden);
```

**问题**：`listBySession` 支持 `includeHidden: false`，在 SQL 层就滤掉 hidden 行。仓储层注释点名这个开关就是为「token chip 的 prompt 组装只消费可见历史」加的（`sqlite-message.repository.ts:218-222`：「隐藏消息…不必捞回并逐条解压正文——大会话…的 UI 读口（token chip 的 prompt 组装只消费可见历史）曾因此全量解压秒级卡顿」）。本调用点**没传该选项**，改为解压完再在 JS 里 `filter` 丢弃——正好踩中注释里描述的场景。同文件里 desktop 侧与 core 侧两处 prompt-input 读口（`apps/desktop/src/main/services/session-prompt-input.service.ts`、`packages/core/src/service/agent/impl/chat-agent-session.ts`）都正确传了 `{ includeHidden: false }`，只有这一处漏。

**建议**：改为 `listBySession(scope.sessionId, { includeHidden: false })`，删掉后面的 `all.filter(...)`。

**置信**：confirmed（`includeHidden` 全部生产调用点已 grep 逐一核对，共 3 处传、此 1 处漏）

---

### F-core-chat-3 | P2 | packages/core/src/service/chat/impl/message.service.ts:193（发号在 repository，本域）

```ts
const seq = await this.deps.messages.nextSeq(sessionId);
```

```ts
// sqlite-message.repository.ts:360-369
async nextSeq(sessionId: string): Promise<number> {
  ...
  return maxSeq == null ? 1 : Number(maxSeq) + 1;
}
```

**问题**：`nextSeq`（`SELECT MAX(seq)+1`）与随后的 `insert` 是**两条独立语句、中间无事务**，而表上带 `UNIQUE (session_id, seq)`（`packages/core/src/bootstrap/chat/chat-schema.ts:56`）。并发 append 同一 session（回滚与 append 竞速、并行工具步骤）会拿到同一条 seq，第二次 insert 抛裸驱动 UNIQUE 错误——不是类型化 `chatError`，上层无法分类处理。RULE「seq 生成规则 `MAX(seq)+1`」只描述了规则，未覆盖原子性。

**建议**：要么把「取号 + 插入」收进同一 `conn.transaction`，要么 port 上加一个原子 `appendNext(messageWithoutSeq)` 由仓储内部占号。当前 append 是单写者串行路径，实际触发概率低，故定 P2 而非 P1。

**置信**：confirmed（代码形态与 DDL 约束都已实读；并发可达性为 suspected）

---

### F-core-chat-4 | P2 | packages/core/src/domain/chat/logic/scan-at-path-attachments.ts:129-144

```ts
  if (isBinaryAttachPath(seenKey) || isBinaryAttachPath(rawPath)) {
    return { name: basename, source: "attach", type: "text", content: null, path: storePath };
  }
  return { name: basename, source: "attach", type: "text", content: null, path: storePath };
```

**问题**：二分档分支与兜底分支返回**逐字相同**的对象字面量——`isBinaryAttachPath` 分支是纯死分支。读者会以为二进制文件在此处走了特殊处理（`type` 或 `content` 有别），实际没有。真实的「二进制不喂正文」语义在下游 `hydrateFileFull` → `resolveAttachFileStatus` 里做（返回 `filename` 档），此处的分支纯属残留。

**建议**：删掉 `:129-137` 的 if 分支，保留兜底 return。

**置信**：confirmed

---

### F-core-chat-5 | P2 | packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts:110 与 :121

```ts
if (type === "image" || isBinaryAttachPath(path) || isImageAttachPath(path)) {
```

```ts
return isBinaryAttachPath(path) || isImageAttachPath(path);
```

**问题**：`attach-binary-heuristic.ts` 里 `IMAGE_EXTENSIONS` 的 11 个扩展名（png/jpg/jpeg/gif/webp/bmp/ico/tif/tiff/heic/avif）**全部**包含在 `BINARY_EXTENSIONS` 的 49 个里（实测脚本逐项比对，差集为空）。因此 `isBinaryAttachPath(p) || isImageAttachPath(p)` 恒等于 `isBinaryAttachPath(p)`，两处 `|| isImageAttachPath(path)` 都是恒为 false 的冗余项。附带：`isBinaryOrImageAttach`（`:116-122`）的首个分支 `if (type === "image" || type === "dir") return attachment.type === "image";` 等价于 `return attachment.type === "image"`，绕了一圈。

**建议**：两处去掉 `|| isImageAttachPath(path)`；`isBinaryOrImageAttach` 简化为一行。若保留 `isImageAttachPath` 是为将来图片走独立档（喂图片而非只给文件名），应在注释里写明「当前是 isBinaryAttachPath 的子集」，否则后人会误以为二者是并列关系。

**置信**：confirmed（集合包含关系用脚本实测，差集为空）

---

### F-core-chat-6 | P2 | packages/core/src/domain/chat/logic/annotate-highlight.ts:18 vs annotate-source-range.ts:289

```ts
// annotate-highlight.ts:18
export function findAllOccurrences(haystack: string, needle: string): number[] {
  if (needle.length === 0) { return []; }
  const out: number[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) { break; }
    out.push(at);
    from = at + needle.length;
  }
  return out;
}
```

**问题**：`findAllNeedleStarts`（`annotate-source-range.ts:289`）是同一函数的**逐字复制**（同参数序、同早退条件、同推进策略），只是改了名。批注定位的两条链路（DOM/flat 匹配 vs 源文件窗口匹配）因此各自持有一份，改一处漏一处不会被编译器发现。

**建议**：保留一份（建议放 `annotate-highlight.ts` 并让 range 侧 import），另一份改为 re-export。

**置信**：confirmed（两函数体已逐行比对）

---

### F-core-chat-7 | P2 | annotate-source-range.ts:282 / annotate-highlight.ts:166 / annotate-source-anchor.ts:102-106

```ts
// annotate-source-anchor.ts:102-106 —— 第三份手写副本
const hay = slice
  .replace(/\u00a0/g, " ")
  .replace(/\t/g, "")
  .replace(/\r\n/g, "\n")
  .replace(/\r/g, "\n");
```

**问题**：仓内有三份「批注文本归一」，规则**不一致**：
- `normalizeAnnotateNeedle`（`annotate-highlight.ts:166`）：`\u00a0→空格`、**删 `\t`**、`\r\n|\r→\n`、保留 `\n`、trim
- `normalizeAnnotateQuoteText`（`annotate-source-range.ts:282`）：`\u00a0→空格`、`\r\n|\r→\n`，**不删 `\t`**、不 trim
- `annotateRangeMatchesOriginalText` 内联副本（`annotate-source-anchor.ts:102-106`）：同 `normalizeAnnotateNeedle` 但不 trim

注释明确标注了差异是**故意的**（`normalizeAnnotateNeedleStripNewlines:176` 写「勿用于 plain/`pre`」），但内联副本（第三份）没有任何注释说明它为什么不复用 `normalizeAnnotateNeedle`，读者无法判断这是刻意还是漏改。

**建议**：把 `annotateRangeMatchesOriginalText` 里的 4 行换成 `normalizeAnnotateNeedle(slice)`（语义等价：needle 已 trim，haystack 不需 trim），并给 `normalizeAnnotateQuoteText` 补一行注释说明「不删 `\t` 是与 needle 侧的差异点」，避免下一个人「顺手统一」掉。

**置信**：confirmed（三份代码都已实读；差异是否刻意——needle 侧已注释，haystack 内联副本未注释，属可疑）

---

### F-core-chat-8 | P2 | packages/core/src/domain/chat/logic/status-chip-label.ts:45

```ts
export function logicalParentDir(path: string): string {
  const normalized = path.trim();
  if (normalized === "" || normalized === "/") { return "/"; }
  const noTrail = normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  const idx = noTrail.lastIndexOf("/");
  if (idx <= 0) { return "/"; }
  return noTrail.slice(0, idx) || "/";
}
```

**问题**：`@/domain/vfs/logic/parent-dir.ts:10` 的 `parentDir(path)` 是同一件事（内部先 `normalizePath`）。`logicalParentDir` 的额外能力只有「trim + 去尾斜杠」，而 `normalizePath` 本身就做归一。两份实现意味着 `/a//b`、`/a/./b` 这类形态在 chip 分类与 VFS 路径语义下可能给出不同父目录。

**建议**：让 `logicalParentDir` 复用 `parentDir`（先 `trim` 再 `parentDir`），删掉本地实现；`resolveRenameOrMoveAction`（`:64`）的调用方不受影响。

**置信**：confirmed（两份实现都已实读）

---

### F-core-chat-9 | P2 | packages/core/src/domain/chat/logic/diff-workspace-for-user-vfs-flush.ts:1-221

```ts
/**
 * @deprecated 手改热路径已改读 UserOpsLogStore；本模块仅过渡期单测 / 旧工具保留。
 */
```

**问题**：全仓 `grep -rln` 实测，`diffWorkspaceForUserVfsFlush` / `isWorkspaceFlushDiffEmpty` / `collectUserOpsChangedPaths` **只有 `packages/core/test/chat/diff-workspace-for-user-vfs-flush.test.ts` 一个消费方**，无任何生产引用（`public/chat.ts` 也没转发）。`collectUserOpsChangedPaths`（`:122-146`）连测试都没有，是彻底的死函数。整个 221 行文件 + 专属测试文件只验证着一段没人调用的算法。RULE 已记载 user ops 整体拆除（chat-fixes-2026-08），这里就是拆除没扫干净的残留。

对照：`user-vfs-turn-view.ts` / `user-vfs-turn-constants.ts` / `user-vfs-pending.schema.ts` 虽然同属遗留，但都被 `build-attachment-action-xml.ts:17`（`parseAllUserVfsActionsFromText` 解析批注 XML）和 `public/chat.ts` 真实消费着，属于「还在用」。三份遗留文件里只有这一份是纯死重。

**建议**：删掉 `diff-workspace-for-user-vfs-flush.ts` 及其测试；同时把 `workspace-flush-snapshot.ts` 的 `emptyWorkspaceFlushSnapshot` 复核一下——它目前唯一的生产引用也是这份死文件的类型依赖。

**置信**：confirmed（逐符号全仓 grep，生产引用数为 0）

---

### F-core-chat-10 | P3 | packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts:256-269 与 :275-288

```ts
function stripLegacyDirWrap(content: string, logicalPath: string): string {
  const trimmed = content.trim();
  const open = `<dir path="${logicalPath}">`;
  if (trimmed.startsWith("<dir ") && trimmed.endsWith("</dir>")) {
```

**问题**：两个函数体除 `<dir`/`<file` 字面量外**完全相同**，且都做了一件毫无用处的事——拼一个 `open` 字符串然后 `void open;`（`:268`、`:286`）丢弃。结果是 `logicalPath` 形参**在两个函数里都没有任何实际用途**（唯一去处就是那个被 `void` 掉的字符串）。`stripLegacyDirWrap` 的 `logicalPath` 参数纯属幻觉依赖。

**建议**：删掉 `open` 与 `void open;`，两个函数的 `logicalPath` 形参一并删除（并更新 `:171`、`:233` 两处调用点）。更进一步，两个函数可合并为一个 `stripLegacyWrap(content, tag)`。

**置信**：confirmed

---

### F-core-chat-11 | P3 | packages/core/src/domain/chat/logic/tail-batch-range.ts:62-66

```ts
export function computeTailBatchAffectedIds(
  rows: readonly TailBatchRow[],
  selectedIds: ReadonlySet<string>,
  _sessionMaxSeq: number
): ReadonlySet<string> {
```

**问题**：第三个参数加了 `_` 前缀表示「故意不用」，但同域的姊妹函数 `computeTailBatchRangeFromSelection`（`:80-85`）**签名完全一致地接收并使用** `sessionMaxSeq`，而 `computeVisibilityBatchAffectedIds`（`visibility-batch-range.ts:89-93`）也用它算 `toSeq`。三个「算批量范围」的 API 长得一样、语义却不同：前两个返回 seq 区间（用上 max），这个只返回 id 集合（用不上）。调用方很难不传错。

**建议**：把 `_sessionMaxSeq` 从 `computeTailBatchAffectedIds` 签名移除（它算的是「受影响的已有行 id」，本来就与 maxSeq 无关），并在该函数 doc 里写明「返回的是 rows 内已存在的 id，不是区间」。

**置信**：confirmed

---

### F-core-chat-12 | P3 | packages/core/src/domain/chat/logic/visibility-batch-range.ts:55-65

```ts
/**
 * @deprecated 请改用 {@link computeTailBatchRangeFromSelection}（restore / delete 共用）。
 */
export function computeShowRangeFromSelection(...)
```

**问题**：已标 `@deprecated` 且**生产调用点为 0**（`rg "computeShowRangeFromSelection\("` 只命中本定义与 `packages/core/test/chat/visibility-batch-range.test.ts`），但 `apps/mobile/src/components/chat/transcript-selectable-role.ts:21` 与 `apps/desktop/renderer/features/chat/transcript-selectable-role.ts:15` 两个薄 re-export 仍在转发它，公共出口 `public/chat.ts` 也在转发。deprecated 却没下架，等于给未来埋一个「看得到、点得着、但没人维护」的 API。

**建议**：从两个 re-export 与 `public/chat.ts` 摘掉，函数体与测试一并删（行为已由 `computeTailBatchRangeFromSelection` 覆盖）。

**置信**：confirmed

---

### F-core-chat-13 | P3 | packages/core/src/domain/chat/logic/parse 侧：model/message-attachment.schema.ts:109-126

```ts
const result = messageAttachmentsSchema.safeParse(parsed);
if (!result.success) {
  return undefined;
}
return result.data;
```

**问题**：数组级 safeParse 是**全有或全无**——任意一条附件不合法（最常见的触发点是 `messageAttachmentSchema` 的 superRefine「有 action 时 name 须等于 attachmentStorageName(path)」，`message-attachment.schema.ts:88-97`），整条消息的 `attachments` 就静默变成 `undefined`。失败没有任何日志、没有计数，读方（提示词 hydrate、UI chip、批注反投影）会以为这条消息本来就没有附件，且不可观测。

写侧有防线（`message.service.ts:59-66` 的 `normalizeAppendAttachments` 用 `.parse` 硬校验，所以新写入不会产生不合规行），因此现实触发面主要是历史数据。属于「可接受的兼容兜底 + 不可观测的静默降级」。

**建议**：保留兜底行为，但加一条 `console.warn`（带 messageId 与首个 issue path），让历史脏数据在排查时可见。

**置信**：confirmed（读写两侧都已实读）

---

### F-core-chat-14 | P3 | packages/core/src/domain/chat/logic/render-dir-attach-tree.ts:26-28

```ts
function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
```

**问题**：全仓 `rg "Buffer.byteLength"` **只此一处**。core 里其余 5 处算 UTF-8 字节长度的地方（`domain/character-card/logic/character-card-limits.ts`、`domain/tool/logic/tool-output-limits.ts`、`domain/tool/builtin/curl-tool.ts`、`domain/tool/builtin/search/search-tool.ts`、`domain/tool/logic/build-tool-result-block.ts`）统一用 `new TextEncoder().encode(text).byteLength`。`Buffer` 在 Hermes 里不是原生全局——`apps/mobile/src/components/chat/ChatTranscriptWebView.tsx` 的注释就明写「RN/Hermes 无全局 Buffer」。当前能跑通纯粹是因为 `apps/mobile/src/polyfills.ts:21` 在 `index.js` 最前面做了 `globalThis.Buffer = Buffer`。也就是说**一个 domain 层文件的安全性依赖 app 层的 polyfill 加载顺序**，违反域边界。

**建议**：改用仓内既有的 TextEncoder 口径（与 tool-output-limits 对齐），去掉对 polyfill 的隐式依赖。

**置信**：confirmed（polyfill 存在且已确认加载顺序，故不是线上故障；定 P3）

---

### F-core-chat-15 | P3 | packages/core/src/domain/chat/logic/message-visible-floor.ts:14

```ts
export function listVisibleSorted(
  messages: readonly ChatMessage[]
): ChatMessage[] {
  return messages.filter((m) => !m.hidden);
}
```

**问题**：函数名承诺 `Sorted`，实现只 `filter`，不排序。doc 注释用 `@param messages - Full session list from listBySession (seq order)` 把前置条件推给调用方。实际生产消费方是 `domain/depth/logic/depth-from-tail.ts`（转手命名为 `listVisibleForDepth`），depth 编号对入参顺序敏感——一旦哪天有人喂进未排序数组，会静默算错 floor 而不是报错。

**建议**：要么改名 `filterVisibleMessages`（把排序契约留给调用方并在名字里去掉 Sorted），要么函数内补 `sort((a,b)=>a.seq-b.seq)` 让名字兑现。后者更稳（O(n log n) 相对 n 次 inflate 可忽略）。

**置信**：confirmed

---

### F-core-chat-16 | P3 | packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts:48-49

```ts
/** 与 `domain/tool/builtin/skill-tool.ts` 注册名同字符串（方向 B 扫描用）。 */
const SKILL_TOOL_NAME = "skill";
import { renderDirAttachTree } from "./render-dir-attach-tree.js";
import { wrapUserMessageForLlm } from "./wrap-user-message-for-llm.js";
```

**问题**：三条问题叠在一起——① `const` 声明被夹在 import 语句中间（`:17-46` 一段 import，`:49` 一个 const，`:50-54` 又一段 import），违反「import 集中在文件头」的通例；② 同一字面量 `"skill"` 在仓内至少 4 处各写一遍（`skill-tool-ref.ts:17` 自带注释「四处同名字符串之一」、`domain/tool/builtin/skill-tool.ts` 注册名、`scan-skill-attachments.ts` 之外的这处）；③ 改成模块顶层常量不会消除漂移风险，因为各文件都是各写各的。

**建议**：把 `SKILL_TOOL_NAME` 提到 `model/skill-tool-ref.ts`（或与 `SKILL_NAME_PATTERN` 同处）作为单源，其余三处 import 引用它。至少先把 const 挪到 import 块之后。

**置信**：confirmed

---

### F-core-chat-17 | P3 | packages/core/src/domain/chat/logic/render-dir-attach-tree.ts:15-22

```ts
export interface RenderDirAttachTreeDeps {
  readonly sessionId: string;
  /** 保留透传兼容；本函数不再读写 file_cache。 */
  readonly sessionKkv: SessionKkvService;
  readonly vfs: VfsService;
```

**问题**：`sessionKkv` 与 `sessionId` 都是死依赖——函数体（`:65-115`）只调 `deps.vfs.list(normalizedRoot, {recursive:false})`，两字段零引用。调用方 `hydrateDirAttach`（`prepare-user-messages-for-prompt.ts:241-245`）为此白构造两个实参。注释坦承是「保留透传兼容」，但没有任何外部消费方能从这两个字段得到东西（`RenderDirAttachTreeDeps` 在全仓只有这一个构造点）。

**建议**：删掉 `sessionKkv` / `sessionId` 字段与调用点实参。`maxUtf8Bytes` 保留（单测覆盖阈值用）。

**置信**：confirmed

---

### F-core-chat-18 | P3 | packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:300-344

```ts
  async listBySessionTail(sessionId: string, limit: number) { ... }
  async listBySessionPage(sessionId: string, limit: number, beforeSeq?: number) { ... }
```

**问题**：两个方法的 SQL 模板是同一形状（内层 `ORDER BY seq DESC LIMIT n` + 外层 `ORDER BY seq ASC`），`listBySessionTail` 是 `listBySessionPage` 在 `beforeSeq` 缺省时的特例（`listBySessionPage` 用 `AND (#{beforeSeq} IS NULL OR seq < #{beforeSeq})` 恰好覆盖 null 情形）。两个方法各自维护 20 列的 `MESSAGE_SELECT_COLUMNS` 展开，列常量一改要改两处；实测两个方法的行数分别是 300-320 与 322-344，共 45 行几乎同构。

**建议**：`listBySessionTail` 改为 `return this.listBySessionPage(sessionId, limit)`，删掉重复模板。

**置信**：confirmed

---

### F-core-chat-19 | P3 | packages/core/src/domain/chat/logic/message-content-helpers.ts:22

```ts
export function isUserInputMessage(message: ChatMessage): boolean {
  return message.role === "user" && !hasToolResult(message);
}
```

**问题**：全仓实测只有 1 个生产消费方（`prepare-user-messages-for-prompt.ts:578` 与 `:609`，但两处都在已判 `m.role === "user"` 之后调用，函数内的 role 判定是冗余的），且**没有被 `public/chat.ts` 转发**。同文件的 `hasToolResult` / `hasAnnotateAttachment` / `isPlainUserText` 都有多个消费方，唯独它是一个半私有的导出。

另外，doc 注释说它「供 prepareUserMessagesForPrompt 主函数分流用」，但 `prepareUserMessagesForPrompt` 的主循环（`:601-612`）判定顺序是 `role !== "user"` → push，再 `!isUserInputMessage` → push；两处调用点都处在已知 `role === "user"` 的分支里，`isUserInputMessage` 里的 `message.role === "user"` 判断永远为真。

**建议**：降为 `prepare-user-messages-for-prompt.ts` 的模块内私有函数；或保留导出但删掉内部恒真的 role 判定（并把语义改名为 `hasNoToolResult`）。

**置信**：confirmed

---

### F-core-chat-20 | P3 | packages/core/src/domain/chat/model/project-agent-config.schema.ts:44

```ts
export { projectAgentModeSchema };
```

**问题**：`projectAgentModeSchema` 全文 grep 只有三处命中——本文件的定义、`:11` 的内部使用、以及经 `public/chat.ts` 的转发。**没有任何生产或测试消费方真的 import 它**。同时整个 `project-agent-config` 子系统按 RULE 记载已随 v1.4.26 下线（`project-agent-config.ts:4` 自带 `@deprecated`），但 `project.service.ts` 仍在读写 `getAgentConfig`/`updateAgentConfig`（仓库层 `sqlite-project.repository.ts:85-113`），`resolve-agent-for-project.ts` 也仍留着解析分支的注释位。desktop 侧 IPC handler 更直接：`apps/desktop/src/main/ipc/handlers/projects.ts` 返回 `"project agent feature is removed; returning follow default."`。

也就是说**这一坨是「仓库层还活着、service 层还活着、公共出口还活着、唯独 UI 与解析分支已死」的四分之一活状态**，且被 `public/chat.ts` 完整转发给双端。属于有意保留的兼容层，但保留范围比 RULE 描述的（"DB 列置空保留"）宽得多——service 的写入路径也还在。

**建议**：要么把 `ProjectRepository.getAgentConfig`/`updateAgentConfig` 标注 `@deprecated` 并在 `ProjectService` 里把写入路径降级为「透传 clone」，要么按 RULE 节奏在下一轮清理时把 service 层一并下架（保留 repo 读口供 bootstrap 探测列残留即可）。`projectAgentModeSchema` 这个零消费导出可直接删。

**置信**：confirmed（文件与 grep 消费方均已实读；「有意保留」是推断，标注 suspected）

---

## 争议与存疑（拿不准的明说，不许抹平分歧）

1. **`searchMessages` 的 `limit` 未防 NaN**。`sqlite-message.repository.ts:513` 写 `Math.max(1, Math.floor(query.limit))`，若上层传 `NaN` 则结果是 `NaN`，直接进 `LIMIT #{limit}` 绑定。RULE 里明确记过同类坑（「双端 UI 输入需过滤非数字并归一空串/NaN，repo 层绑定值 `?? null`」），但那说的是 fromSeq/toSeq。`limit` 是必填 `number`，我没有追到 UI 层是否可能传 NaN。**未定性**——若 UI 有非数字输入框，这条会升到 P1。

2. **`keyword` 分支的 `hasKeyword` 变量**（`:512`）在非空分支里再没被读过；空分支用 `!hasKeyword` 早返回。写法没问题，但 `if (!hasKeyword) {...}` 与后面的 `keyword` 非空前提之间隔了一整个早返回块，可读性一般。不算问题，仅记一笔。

3. **`diff-workspace-for-user-vfs-flush.ts` 该不该删**。我的判断是删（F-core-chat-9），但该文件头 `@deprecated` 明确写着「仅过渡期单测 / 旧工具保留」——**「旧工具」是否指某个仓外/未纳入本仓扫描范围的调用方，我没有证据排除**。若确实有仓外引用，删除会破坏它。**建议主代理裁决前先确认扫描面是否完整**。

4. **`user_vfs_pending` KKV 域与本域 schema 的关系**。RULE 记「user ops 拆除后已无写入方，仅剩 truncate 清旧域路径与域常量」。本域的 `model/user-vfs-pending.schema.ts` + `merge-pending-vfs-turns.ts` + `user-vfs-turn-constants.ts` 均仍经 `public/chat.ts` 对外转发（`USER_VFS_TURN_ACK_TEXT` 被 `apps/desktop/shared/logic/chat.ts` 与 `apps/mobile/test-utils/core-shim.ts` 消费）。**这些是否属于「已拍板保留的只读兼容」还是「又一处没扫干净的残留」，我不确定**，未列为发现。

5. **`project-agent-config` 的保留边界**（F-core-chat-20）。我确认了「service 层仍在写」，但**没有读 `project.service.ts` 全文**去确认那条写入路径是否真的会被触发（例如是否被 `resolveAgentForProject` 短路掉）。若实际不可达，severity 应下调到 P3。**置信标 suspected 的部分就在这里**。

6. **`prepareUserMessagesForPrompt` 里 `resolveWorkplaceStatus` 的逐条 KKV 读**（`:90-104`）看似 N 次读放大，但 workplace 附件按 schema 注释已是「历史只读兼容，新数据不再产生」（`message-attachment.schema.ts:54,57`），实际命中数应接近 0。**未构成发现**，但如果历史库里 workplace 附件不少，这里是隐藏的读放大点，建议主代理顺带确认历史数据规模。

7. **本次未做运行时验证**。全部结论来自静态阅读 + 全仓符号 grep。F-1/F-2/F-3 的「实际性能/并发影响」未跑 benchmark 或压测复现，severity 定级基于代码形态而非实测数字。按 RULE「条数/行号/计数类结论一律实测复核」，本报告里出现的所有数字（61 文件 / 7703 行 / 21 列 / 49 与 11 个扩展名 / 5 处 byteLength / 3 处 includeHidden）均为脚本或逐行实测，**行为类结论未实测**。
