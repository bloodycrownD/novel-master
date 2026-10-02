---
zone: w9-chat-pro
agent: 检察官（对抗机位 / 猎杀冗余·死路径·竞态·不一致）
files_scanned: 64（packages/core/src/domain/chat/ 全量：content 5 + logic 38 + model 14 + repositories 6 + impl 3，含 4 个子目录）
---

## 摘要

会话域的**数据模型 + 持久化 + 提示词拼装纯逻辑**层。定义 `ChatProject` / `ChatSession` / `ChatMessage`
与 content blocks 联合类型，提供 `chat_project` / `chat_session` / `chat_message` 三张表的 TDBC repository
（消息正文走 `content_json` 明文 + `content_encoding/content_blob` 压缩双形态），以及一条纯函数流水线：
用户消息附件 hydrate → 短提示去重 → `<user-ops>` / `<extra-info>` XML wrap，再加批注（annotate）
划词定位/高亮算法与 composer 三分支（@path / $技能 / 状态 chip）判定。

## 职责与边界

- **负责**：`chat_*` 三表的行级读写与双形态正文编解码；消息体（content blocks）的严格校验与解析；
  提示词侧附件 hydrate 的**纯逻辑**（不落库、不 IO 之外不做副作用）；批注坐标/高亮的纯算法；
  可见性批量区间、置位区间、tail 批量的区间计算；composer 门闩与 chip 分类。
- **不负责**（边界外，均在 `service/chat/`、`infra/`、`domain/workplace/`）：事务编排、session 生命周期、
  agent run、workplace 规则快照拼装、VFS 读写。本区只提供被这些层调用的**叶子纯函数**与 **repository 实现**。
- 一处**越界**：`seed-fork-copy-parity.ts`（130 行）在本区内自建 5 个 VFS/workplace/checkpoint 的 Sqlite
  repository，与 zone 边界的「domain 只定义 port」约定冲突（见 F-24）。

## 对外接口

全部经 `packages/core/src/public/chat.ts`（353 行）单一出口再导出。要点：

| 分组 | 符号 |
|---|---|
| 模型/zod | `messageAttachmentSchema(s)`、`parseAttachmentsJson`/`serializeAttachmentsJson`、`composerDraftSchema`、`annotateDraftSchema`、`sessionAgentConfigSchema`、`projectAgentConfigSchema`(deprecated)、`userVfsPending*Schema` |
| 正文解析 | `parseMessageContent`、`assertMessageContent`、`textBlocks`、`messageMatchesKeyword`(type only) |
| CLI/预览 | `formatMessageForCli`、`formatChatMessageForCliPreview` |
| 提示词拼装 | `prepareUserMessagesForPrompt`、`wrapUserMessageForLlm`、`build*ActionXml`、`renderDirAttachTree`、`PROMPT_FILE_SEEN_SHORT_TIP` 等 |
| 批注算法 | `annotate-highlight` 15 符号 + `annotate-source-range` 15 符号 + `annotate-source-anchor` 8 符号 |
| 区间计算 | `computeSetFloorRanges`、`computeVisibilityBatchAffectedIds`、`computeTailBatchRangeFromSelection`、`listVisibleSorted` |
| 进程内 store | `chat-annotate-draft-store` 11 个 CRUD/subscribe 符号 |
| 服务工厂 | `createChatServices`、`createUserVfsTurnService`、`createMessageTranscriptEffectsService` |

`public-chat-allowlist.json` 把这份出口**快照冻结**——任何删除都是破坏性 API 变更（多处发现的阻力来源）。

## 数据访问

| 表 | 触碰点 |
|---|---|
| `chat_message` | `repositories/impl/sqlite-message.repository.ts` 全文件（22 列 SELECT/INSERT 常量 `:31,:38-41`；`rowToMessage :96`；`nextSeq :360`；`searchMessages :502`） |
| `chat_session` | `sqlite-session.repository.ts:17-18`（6 列）、`:133` `composer_draft_json`、`:161` `agent_config_json` |
| `chat_project` | `sqlite-project.repository.ts:36`、`:85` `agent_config_json` |
| KKV 域 | `prepare-user-messages-for-prompt.ts:90-93` 读 `rule_snapshot`/`RULE_SNAPSHOT_CANON_KEY`；`render-dir-attach-tree.ts:18` 声明但**从不读写** file_cache |

表 DDL 在 `bootstrap/chat/chat-schema.ts:28-57`：`role IN ('user','assistant','system','tool')`、
`UNIQUE (session_id, seq)`、`content_encoding CHECK IN ('zlib','zlib-b64')`、`CHECK 对 NULL 放行`。

进程内缓存：`infra/content-cache` 的 `messageContentPool`（键 = messageId，4096 条 / 4M 字符）。
写口失效点仅 4 处：`updateContent:386`、`insert:393`、`batchInsert:415`、`delete:435`；
`deleteAfterSeq:448` / `deleteBySession:439` **故意不失效**（id 不复用，LRU 自然回收，见模块头 `:245`）。

## 依赖关系

**import 谁**：`infra/tdbc`（connection/port + template-helper + types）、`infra/sql-template`、`infra/content-cache`、
`domain/vfs`（vfs-path-mapper / user-vfs-save-mapping / action-xml-to-tool-uses / parent-dir）、
`domain/workplace`（load-or-fill-file-cache / rule-snapshot-codec / workplace-display / workplace-scope）、
`domain/message-checkpoint`、`domain/tool/logic/format-tool-output`、`service/session-kkv`、`service/skills`、
`service/workplace`、`domain/prompt/logic/expand-dynamic-macros`、`domain/skills/model/skill-name`、`errors/chat-errors`、`zod`。

**被谁消费**（zone 外）：
- `service/chat/impl/*`（message / session / project / usage-stats / message-transcript-effects）
- `service/agent/logic/run-agent-turn.ts`（批注附件构造）、`domain/prompt/logic/normalize-for-llm-export.ts`（merge 禁条件）
- `domain/depth/logic/resolve-hide-message-range.ts`、`domain/workplace/*`（seen 集合）
- `service/workplace/assemble-workplace-display.ts:170`（`normalizePromptSeenPath`）
- 双端 app：`apps/desktop/shared/logic/chat.ts`、`apps/mobile/test-utils/core-shim.ts` 等 barrel + 直接 import

## 发现清单

### P1

**F-w9-chat-pro-1 | P1 | `model/message-attachment.schema.ts:109-126`（经 `repositories/impl/sqlite-message.repository.ts:97-99`）**
```
const result = messageAttachmentsSchema.safeParse(parsed);
if (!result.success) {
  return undefined;
}
```
**描述**：`parseAttachmentsJson` 对**整个数组**做一次 `safeParse`，任一条附件不合规即把该消息的
**全部**附件静默降级为 `undefined`（无 log、无 warn、无计数）。schema 是 `.strict()`（`:63`）且 superRefine
（`:67-98`）在 `action != null` 时强制 `name === attachmentStorageName(path)`。

**后果链**：一条历史附件的 `name`/`path` 与当前口径不一致 → 该消息的附件数组整体蒸发 →
(a) composer 状态 chip 与批注 chip 全消失（`chat-annotate-draft-store.ts:61`、`composer-chip-attachment.ts:19` 读不到）；
(b) 回滚 Undo Send 的批注恢复走 `parseAnnotateDraftsFromAttachments`（`build-attachment-action-xml.ts:199`）拿不到草稿 → 正文恢复、批注丢失；
(c) 下一轮提示词 `prepareUserMessagesForPrompt:478` 拿到空 attachments → **落库历史与送给 LLM 的提示词不一致**，且不留任何痕迹。

**建议**：改成逐条 `safeParse` + 保留合法项，失败项单独计数（可选 `console.warn` 一次）；或至少把失败原因写进诊断面。
**置信**：confirmed

### P2

**F-w9-chat-pro-2 | P2 | `content/parse-message-content.ts:172-200` vs `model/content-block.ts:66` / `domain/tool/logic/build-tool-result-block.ts:274-289`**
```
meta = subagentSessionId != null || skillRef != null
  ? { ...(subagentSessionId != null ? { subagentSessionId } : {}),
      ...(skillRef != null ? { skillRef } : {}) }
  : undefined;
```
**描述**：`ToolResultBlock.meta` 类型声明了三个字段（`subagentSessionId` / `failureReason` / `skillRef`），
`build-tool-result-block.ts:283,288` 中断回流时**确实产出** `meta.failureReason`，但 `parseBlock` 的读路径
只重建 `subagentSessionId` 与 `skillRef`，**`failureReason` 被静默丢弃**。写入与解析的字段集不对称。

**后果链**：`decodeMessageContent → parseMessageContent`（repository 唯一读口）→ 任何经 `rowToMessage`
拿到 `tool_result` 的路径都拿不到 `failureReason`；`content-block.ts:57-58` 承诺的「UI 卡片提示『用户停止』」
既无实现（`git grep failureReason` 在 `apps/**` 无命中）也拿不到数据。字段目前是「写而不读、读而不写」双向悬空。
**建议**：读路径补上 `failureReason`（与 `subagentSessionId` 同款 `optionalString` 口径），或把该字段连同
其 UI 承诺一并从类型里删掉（需同步 `build-tool-result-block.ts`）。
**置信**：confirmed

**F-w9-chat-pro-3 | P2 | `logic/diff-workspace-for-user-vfs-flush.ts`（199 行）+ `logic/workspace-flush-snapshot.ts`（36 行）**
```
 * @deprecated 手改热路径已改读 UserOpsLogStore；本模块仅过渡期单测 / 旧工具保留。
```
**描述**：`git grep diffWorkspaceForUserVfsFlush\|WorkspaceFlushSnapshot\|isWorkspaceFlushDiffEmpty\|collectUserOpsChangedPaths`
在 `apps/**` 与 `packages/core/src/**` 的**生产代码中零命中**，只有自身 + `packages/core/test/chat/diff-workspace-for-user-vfs-flush.test.ts`。
`@deprecated` 注释指向的 `UserOpsLogStore` 在全仓**不存在**（`git grep UserOpsLogStore` 只命中
`docs/Iterations/user-ops-operation-log/spec.md` 的设计稿）。RULE.md:12 已定案「user ops / 操作日志（已拆除）——
chat-fixes-2026-08 已整体拆除」。

**后果链**：235 行生产死代码；`emptyWorkspaceFlushSnapshot` / `deriveDirPathsFromFileTree` 仍冻结在
`public-chat-allowlist.json:61`，让后人无法判断「该符号还活着吗」；注释指着一个不存在的 store，误导接手者。
`WorkspaceFlushDiff` / `WorkspaceFlushChangedFile` / `WorkspaceFlushAddedFile` / `WorkspaceFlushDiffInput`
四个类型**从未**进 public 出口——说明当初就没打算对外，纯内部。
**建议**：连同 `workspace-flush-snapshot.ts` 一并删除，同步走 allowlist 快照更新；或若要留作历史数据读取，
把注释改成指向 RULE.md:12 的「已拆除」而不是 `UserOpsLogStore`。
**置信**：confirmed

**F-w9-chat-pro-4 | P2 | `logic/annotate-source-anchor.ts`（420 行，8 个导出）**
```
 * **非预览投影合同**（SPEC R5）：本模块可暂留实现供测试/兼容；
 * 宿主 MD/plain 预览主路径禁止调用 {@link buildAnnotatedSource}。
```
**描述**：`buildAnnotatedSource` / `annotateRangeMatchesOriginalText` / `findMarkdownCodeRanges` /
`splitMarkdownUnderlineRuns` / `hasValidAnnotateOffsetRange` / `escapeAnnotateSourceText` 在 `apps/**`
生产代码零命中；仅 `ANNOTATE_ANCHOR_CLASS` 被 `apps/desktop/renderer/layout/preview-annotate.ts:556`
当 CSS 选择器用。更有力的证据是三个测试**主动断言不得使用**它：
`apps/desktop/test/preview-annotate-source-anchor.test.ts:111,340`、`apps/desktop/test/preview-annotate.test.ts:395`、
`apps/mobile/__tests__/annotate-recogito-preview.test.tsx:87-92`。

**后果链**：420 行手写 CommonMark tokenizer（`findMarkdownCodeRanges:126`、`splitMarkdownUnderlineRuns:282`）
成了纯测试负载——改坏它测试会红、但没有任何用户路径受影响，容易被误判为「有回归」；反过来真正的预览路径
（Recogito）出问题时不会有人想到来查这里。6 个符号仍冻结在 public 面。
**置信**：intentional（模块头 + public/chat.ts:226-230 明写「可暂留」）——但建议尽快退役并从 allowlist 摘除，
`ANNOTATE_ANCHOR_CLASS` 保留即可。

**F-w9-chat-pro-5 | P2 | `logic/user-vfs-turn-view.ts`（306 行，6 个导出）+ `apps/mobile/metro.config.js:38-40`**
```
if (!coreChatSource.includes('matchUserVfsTurnAt')) {
  throw '[metro] Stale @novel-master/core chat sub-entry (missing matchUserVfsTurnAt). '
```
**描述**：6 个导出中只有 `parseAllUserVfsActionsFromText` 有生产消费方
（`build-attachment-action-xml.ts:225`，批注 Undo 解析）。`matchUserVfsTurnAt` / `buildUserVfsTurnView` /
`deriveToolUsesFromVfsActions` / `formatUserVfsTurnPreviewBody` / `USER_VFS_TURN_SPAN` 在 `apps/**`
只出现在 `apps/mobile/test-utils/core-shim.ts`（测试垫片）。而 mobile 的 metro 校验把
**`matchUserVfsTurnAt` 这个符号的存在本身**当成 core chat 子入口是否新鲜的探针。

**后果链**：① 死代码伪装成「双端 transcript 折叠 UA 两段的单源」，实际双端各自内联了判定
（`apps/mobile/__tests__/build-transcript-rows.test.ts:181-198`、`apps/desktop/test/message-blocks.test.ts:352-371`
都在测试里手搓 `{kind:'user_vfs_action'}` + ack 两条消息，说明消费方并不调 core 的 `matchUserVfsTurnAt`）；
② 更硬的问题是**耦合地雷**：谁删掉 `matchUserVfsTurnAt` 这个死符号，mobile 构建会在 metro 配置阶段直接抛错，
且报错文案（"Stale @novel-master/core chat sub-entry"）会把这个死符号伪装成构建基础设施问题，误导排查方向。
**建议**：把 metro 探针换成 `public/chat.ts` 里真正稳定的锚点（如 `prepareUserMessagesForPrompt`），
再退役 UA 两段折叠的 5 个符号。
**置信**：confirmed

**F-w9-chat-pro-6 | P2 | `repositories/impl/sqlite-message.repository.ts:360-369` + `service/chat/impl/message.service.ts:193,210`**
```
async nextSeq(sessionId: string): Promise<number> {
  const rows = await queryTemplate<{ max_seq: number | null }>(...);
  const maxSeq = rows[0]?.max_seq;
  return maxSeq == null ? 1 : Number(maxSeq) + 1;
}
```
**描述**：`nextSeq` 是 `SELECT MAX(seq)`，`append` 随后单独 `await this.deps.messages.insert(message)`
（`message.service.ts:193` 与 `:210` 之间无事务包裹、无重试）。两语句非原子。

**后果链**：同一 session 的并发 append（agent run 与 UI undo-send/重发交叠、子 agent 回流与主 run 交叠）
会拿到同一 seq，落库时由 `UNIQUE (session_id, seq)`（`chat-schema.ts:56`）兜底 → 抛**裸 SQLITE_CONSTRAINT**
给用户，而不是可读的业务错误。不会静默错序（这点是好的），但错误分类完全丢失。
**建议**：把取号并进 INSERT——`INSERT ... (seq) SELECT COALESCE(MAX(seq),0)+1 FROM chat_message WHERE session_id=?`，
单语句原子；或让 `append` 在事务内取号并对 constraint 冲突重试一次。
**置信**：suspected（当前调用方多为串行，未观察到线上复现；风险窗口存在）

**F-w9-chat-pro-7 | P2 | `service/chat/impl/project.service.ts:214-240,255-258` vs `model/project-agent-config.ts:4-6` / RULE.md:38**
```
 * @deprecated 项目智能体已下线，保留用于 DB 历史数据读取兼容。
...
async updateAgentConfig(...) { ... await this.deps.projects.updateAgentConfig(id, configJson, updatedAtMs); }
...
if (sourceAgentConfigJson != null) {
  const clonedJson = deepCloneAgentConfigJson(sourceAgentConfigJson);
  await r.projects.updateAgentConfig(copy.id, clonedJson, now);
}
```
**描述**：类型侧与 RULE 都已定案「已下线、DB 列置空保留、新代码不要再依赖、业务代码不再写入」，但
service 层**仍在写**这一列，`copy()` 还会把源项目的 JSON 克隆进新项目。桌面 IPC 侧已 no-op
（`apps/desktop/src/main/ipc/handlers/projects.ts:102` 返回 follow 默认），所以这条写路径的唯一活用户是
`copyProject`。

**后果链**：项目智能体功能下线后仍能通过「复制项目」把历史 custom definition **复制进新项目**并留在
`chat_project.agent_config_json`；新会话一律走 session 级 agent（RULE.md:36），这份数据永远不会被解析成行为，
但会成为下一轮「列里还有脏数据 / 为什么这列不为空」排查的噪音源。注释与实现直接矛盾，读者无法判断可信方。
**建议**：二选一——(a) `copy()` 跳过 agent_config_json 克隆，`updateAgentConfig` 直接 throw/返回 follow；
(b) 把 `@deprecated` 注释改成「读兼容 + copy 克隆」的真实语义，并在 RULE.md:38 补一句例外。
**置信**：confirmed

### P3

**F-w9-chat-pro-8 | P3 | `logic/render-dir-attach-tree.ts:26-28` vs `domain/tool/logic/tool-output-limits.ts:13-16`**
```
function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
// --- 对照组 ---
/** UTF-8 byte length without Node `Buffer` (RN/Hermes has no global Buffer). */
function utf8ByteLength(text: string): number { return new TextEncoder().encode(text).byteLength; }
```
**描述**：同一仓内两个 `utf8ByteLength` 实现对「RN 有没有全局 Buffer」给出相反答案。本区这个依赖
`apps/mobile/src/polyfills.ts:21` 的 `globalThis.Buffer = Buffer` 才成立——即 core domain 层反向依赖宿主 polyfill 顺序。
**后果链**：polyfill 被移除/后移/换实现时，`renderDirAttachTree` 在真机上抛 `Buffer is not defined`，
整条 `$目录` 附件 hydrate 链断掉（`prepare-user-messages-for-prompt.ts:241`）。该函数确实在移动端热路径。
**建议**：统一改用 `TextEncoder`（与 `tool-output-limits.ts` 同款）。
**置信**：confirmed

**F-w9-chat-pro-9 | P3 | `logic/scan-at-path-attachments.ts:129-144`**
```
if (isBinaryAttachPath(seenKey) || isBinaryAttachPath(rawPath)) {
  return { name: basename, source: "attach", type: "text", content: null, path: storePath };
}
return { name: basename, source: "attach", type: "text", content: null, path: storePath };
```
**描述**：`isBinaryAttachPath` 分支与兜底分支返回**逐字相同**的对象字面量。整段判断无任何行为差异。
**后果链**：读者会误以为二进制附件在 wire 上有特殊标记（其实靠 `content: null` + 下游 `resolveAttachFileStatus` 判档），
未来改一边忘一边即产生真 bug。属典型「诱饵分支」。
**建议**：删掉 `:129-137`，保留兜底；把「二进制不进正文」的意图写成注释或移到 `resolveAttachFileStatus` 的 doc。
**置信**：confirmed

**F-w9-chat-pro-10 | P3 | `logic/prepare-user-messages-for-prompt.ts:110,121` + `logic/scan-at-path-attachments.ts:111,129`**
```
return isBinaryAttachPath(path) || isImageAttachPath(path);
```
**描述**：`IMAGE_EXTENSIONS`（`attach-binary-heuristic.ts:60-72`，11 项）与 `BINARY_EXTENSIONS`
（`:8-58`，48 项）的图片子集逐项相同——`png jpg jpeg gif webp bmp ico tif tiff heic avif` 全在后者里。
因此 4 处 `isBinary || isImage` 的析取右半边**永不可达**。
**后果链**：无运行时后果，纯认知负担；且暗示「两类集合会分叉」，一旦有人只往 `IMAGE_EXTENSIONS` 加格式
（如 `svg`/`avif2`）就会静默半失效。
**置信**：confirmed

**F-w9-chat-pro-11 | P3 | `logic/prepare-user-messages-for-prompt.ts:256,268,275,286`**
```
const open = `<dir path="${logicalPath}">`;
...
void open;
```
**描述**：`stripLegacyDirWrap` 与 `stripLegacyFileWrap` 各算一个 `open` 字符串后立刻 `void` 掉，
判定实际用的是 `startsWith("<dir ")` / `startsWith("<file ")`。两个函数体其余部分逐行同构（F-12 之外的又一处重复）。
**后果链**：`void open` 是典型的「压 lint 又不敢删」痕迹；它让读者误以为存在按精确 path 匹配的逻辑分支，
实则只要前缀是 `<file ` 就当外壳——**任意 path 的 `<file …>` 外壳都会被剥壳**（潜在误剥，见 F-13 后果）。
**建议**：删掉 `open` 与 `void`；或补一条「path 不匹配则不剥」的防御。
**置信**：confirmed

**F-w9-chat-pro-12 | P3 | `logic/annotate-highlight.ts:18-33` vs `logic/annotate-source-range.ts:289-304`**
```
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
**描述**：`findAllNeedleStarts`（private）与 `findAllOccurrences`（exported）**逐行同构**，仅函数名不同。
**后果链**：两份实现会各自漂移；当前完全一致所以无 bug，但这是复制粘贴的定时炸弹。
**建议**：`annotate-source-range.ts` 改为 import `findAllOccurrences`，删私有副本。
**置信**：confirmed

**F-w9-chat-pro-13 | P3 | `logic/prepare-user-messages-for-prompt.ts:48-54`**
```
/** 与 `domain/tool/builtin/skill-tool.ts` 注册名同字符串（方向 B 扫描用）。 */
const SKILL_TOOL_NAME = "skill";
import { renderDirAttachTree } from "./render-dir-attach-tree.js";
import { wrapUserMessageForLlm } from "./wrap-user-message-for-llm.js";
import { expandDynamicMacros } from "@/domain/prompt/logic/expand-dynamic-macros.js";
```
**描述**：import 语句块被 `const` 声明从中劈开，后三条 import 排在常量之后。ESM 提升使其能跑，
但 `SKILL_TOOL_NAME` 同样以字面量 `"skill"` 在 `logic/skill-tool-ref.ts:17` 重复了一次（其注释自称
「四处同名字符串之一」）。
**后果链**：无运行时后果；`"skill"` 字面量在本区有 2 份、跨区共 4 份，任一处改名即漏。
**建议**：三条 import 归位到 import 块；`SKILL_TOOL_NAME` 提到 `skill-tool-ref.ts` 导出共享。
**置信**：confirmed

**F-w9-chat-pro-14 | P3 | `logic/prepare-user-messages-for-prompt.ts:116-122`**
```
function isBinaryOrImageAttach(attachment: MessageAttachment): boolean {
  if (attachment.type === "image" || attachment.type === "dir") {
    return attachment.type === "image";
  }
  ...
```
**描述**：`type === "dir"` 分支恒返回 `false`，而 `dir` 在唯一调用点 `:396-400` 已被提前分流走
`hydrateDirAttach`，根本到不了这里。整个 `|| attachment.type === "dir"` 是不可达代码。
**建议**：简化为 `if (attachment.type === "image") return true;`。
**置信**：confirmed

**F-w9-chat-pro-15 | P3 | `logic/user-vfs-turn-view.ts:322`**
```
const status = tr?.ok === false ? "失败" : tr != null ? "成功" : "—";
```
**描述**：`tr` 来自 `view.toolResults`，而 `syntheticToolResults`（`:189-198`）恒写 `ok: true`。
`tr?.ok === false` 与 `tr != null ? "—"` 两个分支在本文件的任何构造路径下都不可达。
**后果链**：预览永远只显示「成功」，即使 action XML 实际失败；一旦将来让 toolResults 携带真实 ok，
这里的 `—` 分支语义也会错。
**置信**：confirmed

**F-w9-chat-pro-16 | P3 | `logic/build-attachment-action-xml.ts:188-192`**
```
export function buildAnnotateAttachmentFromDraft(draft: AnnotateDraft): MessageAttachment {
  return buildFileAnnotateAttachmentFromDraft(draft);
}
```
**描述**：空壳别名。两者都进 `public/chat.ts:71,74` 冻结出口。真生产调用方
（`service/agent/logic/run-agent-turn.ts:679,688,696,706`）全用 `buildAnnotateAttachmentFromDraft`，
即「带 File 前缀的那个」才是无人调用的那个——命名与使用方向相反。
**建议**：保留 `buildAnnotateAttachmentFromDraft`，删 `buildFileAnnotateAttachmentFromDraft` 并更新 allowlist。
**置信**：confirmed

**F-w9-chat-pro-17 | P3 | `logic/prompt-path-seen.ts:15`**
```
export const PROMPT_FILE_SEEN_SHORT_TIP = "该文件前文已引用，无需读取或加载";
```
**描述**：全仓 `git grep 该文件前文已引用`（排除 node_modules）**零命中**。实际短提示由
`buildAlreadyReferencedActionXml`（`build-attachment-action-xml.ts:47-52`）以 `{ path, alreadyReferenced: true }`
结构生成，中文文案根本不存在。RULE.md:18 的口径也是 `alreadyReferenced: true` 结构标记。
**后果链**：一个看起来是「短提示文案的单一真源」的常量，实为孤儿。将来有人想改短提示文案会找到它并
发现改了没用——典型的诱饵常量。
**置信**：confirmed

**F-w9-chat-pro-18 | P3 | `logic/compute-stream-tail-generating.ts:7-18`**
```
/** @deprecated 保留导出以兼容旧调用方；实现已忽略 idle 阈值。 */
export const DEFAULT_STREAM_TAIL_IDLE_MS = 300;
...
  /** @deprecated 实现中忽略，保留签名以兼容旧调用方。 */
  readonly msSinceLastStreamDelta: number;
  readonly idleThresholdMs?: number;
...
  return input.uiRunning;
```
**描述**：函数退化为恒等映射，两个入参 + 一个导出常量全部无效，且都冻结在 `public/chat.ts:133-136`。
**后果链**：调用方传 `idleThresholdMs` 会以为「阈值生效」，实际静默忽略——这是**沉默的参数契约破坏**，
比删掉更危险（调用方不会收到任何信号）。
**建议**：删除无效参数与常量，同步更新 `public/chat.ts` 与 allowlist 快照。
**置信**：confirmed

**F-w9-chat-pro-19 | P3 | `logic/merge-pending-vfs-turns.ts`（15 行）+ `model/user-vfs-pending.schema.ts`（28 行）**
```
/** FIFO pending 队列（JSON 数组）。 */
export const userVfsPendingQueueSchema = z.array(userVfsPendingEntrySchema);
```
**描述**：`mergePendingVfsTurns` 全仓零消费（只在 `public/chat.ts:138` 出现一次导出）；
`userVfsPendingToolSchema` / `userVfsPendingEntrySchema` / `userVfsPendingQueueSchema`
及其 3 个 type 同样在 `apps/**` 与 `packages/core/src/**` 生产代码零命中（`session-kkv/model/session-kkv-domains.ts:14`
还留着同名 KKV 域常量）。RULE.md:31 定案：`user_vfs_pending` 是「历史域——user ops 拆除后已无写入方，
仅剩 truncate 清旧域路径与域常量」。
**后果链**：43 行死代码 + 6 个 public 出口冻结；schema 永不执行意味着有人改它也不会被发现不兼容。
**建议**：删模块与 schema，同步 allowlist；`session-kkv` 的域常量按 RULE 保留（那是迁移兼容所需，不在本区）。
**置信**：confirmed

**F-w9-chat-pro-20 | P3 | `logic/tail-batch-range.ts:62-66`**
```
export function computeTailBatchAffectedIds(
  rows: readonly TailBatchRow[],
  selectedIds: ReadonlySet<string>,
  _sessionMaxSeq: number
): ReadonlySet<string> {
```
**描述**：第三参 `_sessionMaxSeq` 函数体内从不使用，却留在公开签名与 `public/chat.ts:297` 出口里。
（对照：`computeTailBatchRangeFromSelection:80-94` 真的用了 `sessionMaxSeq`。）
**后果链**：调用方误以为 affected 集合受 `sessionMaxSeq` 约束；实则 `seq >= fromSeq` 已经隐含上界。
**置信**：confirmed

**F-w9-chat-pro-21 | P3 | `logic/visibility-batch-range.ts:50-65`**
```
/**
 * 恢复：showRange(min(selectedUser.seq), sessionMaxSeq)。
 * @deprecated 请改用 {@link computeTailBatchRangeFromSelection}（restore / delete 共用）。
 */
export function computeShowRangeFromSelection(...)
```
**描述**：`@deprecated` 指向的替代品存在，但**三处生产调用方仍在用旧路**：
`apps/desktop/renderer/features/chat/transcript-selectable-role.ts:16`、`apps/desktop/shared/logic/chat.ts:50`、
`apps/mobile/src/components/chat/transcript-selectable-role.ts:21`。
**后果链**：同一条 restore 语义有两条并行计算路径（`computeVisibilityRestoreRangeFromSelection` 与
`computeTailBatchRangeFromSelection`），一条按「已选中的 user 的最小 seq」起算、另一条按「符合 mode 可选规则的行」起算，
在 hide/restore 混合选择的边界上可能给出不同 `fromSeq`。@deprecated 只写在 core，双端无人收敛。
**建议**：三处调用方切到 `computeTailBatchRangeFromSelection` 后删旧路。
**置信**：confirmed（双路并存）/ suspected（边界差异是否可触发未验证）

**F-w9-chat-pro-22 | P3 | `logic/composer-send-intent.ts:33,41-43,57`**
```
readonly attachOnly: readonly [];
...
const scannedCount =
  scanAtPathAttachments(input.text).length +
  scanSkillAttachments(input.text).length;
...
  attachOnly: [],
```
**描述**：① `attachOnly` 恒为空数组的死字段（类型写成 `readonly []` 让调用方永远拿不到非空值）；
② 门闩只需要「条数」，却把两个扫描函数**完整跑一遍**——`scanAtPathAttachments` 每次命中 token 都要
`attachFromPath` 构造完整 `MessageAttachment`（含 `isPromptDirTokenPath` / `normalizePromptStorePath` /
`isImageAttachPath` / `isBinaryAttachPath` 多次扩展名判定）。
**后果链**：正文较长时每次渲染门闩都白造一批对象；且真正发送时同一段文本会被**再扫一遍**构造真附件。
**建议**：给两个扫描函数加 `countOnly` 快路径（复用正则匹配，不构造对象）；删 `attachOnly`。
**置信**：confirmed

**F-w9-chat-pro-23 | P3 | `model/message-metadata.ts:9` + `domain/prompt/logic/normalize-for-llm-export.ts:26,147`**
```
  | "tool_turn_bridge"
```
**描述**：`tool_turn_bridge` 仍在枚举里，`normalize-for-llm-export.ts:147` 仍有
「OpenAI：可剔除空内容的 tool_turn_bridge synthetic」的 provider 后处理分支。RULE.md:22 定案：
done 桥「已于 v1.5.2 全链路移除」。
**后果链**：读侧分支只对**历史行**生效（RULE 同一句：「历史会话里的桥消息按普通 assistant 文本出站」），
保留本身合理；但类型里没标注「只读历史」，后来者会以为还能写。
**置信**：intentional（服务历史行兼容）——建议在 `MessageMetadataKind` 上加注释标注「读兼容，勿新增写入方」。

**F-w9-chat-pro-24 | P3 | `repositories/impl/sqlite-message.repository.ts:507-510` vs `content/message-content-match.ts:36-38`**
```
// 旧 LIKE 只是超集预筛（且会漏 thinking/tool_result 块含关键词的场景
// 反被 role 粗筛误杀），新实现按 TextBlock 精确匹配，召回语义严格不小于现状；
```
**描述**：注释承诺「召回严格不小于现状」，但 `messageMatchesKeyword` 对
`role !== 'user' && role !== 'assistant'` 直接 `return false`（`:36-38`），而旧的 `LIKE content_json`
**不限 role**。`chat-schema.ts:32` 明确允许 `role IN ('user','assistant','system','tool')`。
**后果链**：system / tool 角色行里的关键词现在**搜不到**（keyword 非空分支），而 keyword 为空分支
（`:514-535`）又会把它们返回——同一个查询接口的两条分支对「哪些行可见」给出不同答案。
**后果**是聊天记录搜索对 system/tool 行静默失召。
**建议**：注释改成实际口径（「user/assistant 精筛，system/tool 不参与」），或让 SQL 侧也加同样的 role 谓词使两分支一致。
**置信**：confirmed

**F-w9-chat-pro-25 | P3 | `logic/user-vfs-turn-view.ts:17,19` + `public/chat.ts:246`**
```
import { USER_VFS_TURN_ACK_TEXT } from "./user-vfs-turn-constants.js";
export { USER_VFS_TURN_ACK_TEXT } from "./user-vfs-turn-constants.js";
```
**描述**：同一模块既 import 又 re-export 该常量；而 `public/chat.ts:246` 又是从 `user-vfs-turn-constants.js`
**直接**导出。一条常量三条出口路径。
**后果链**：消费者从不同路径 import 会得到同一值（无 bug），但 `import ... from ".../user-vfs-turn-view.js"`
拿 ack 文案会让「UA 两段折叠模块」看起来仍是活的（见 F-5）。
**建议**：删 `:19` 的 re-export。
**置信**：confirmed

**F-w9-chat-pro-26 | P3 | `logic/status-chip-label.ts:102-107`**
```
if (a.action != null) {
  if (a.action === "userAttach") { return ""; }
  return formatStatusChipLabel(a.action, resolveChipPath(a));
}
```
**描述**：`userAttach` 的提前 return 与 `formatStatusChipLabel:88-90` 里 `zh === ""` 的分支完全等价
（`STATUS_CHIP_ZH.userAttach === ""`，`:24`）。`skillAttach` 走的正是后者。
**后果链**：两条判定路径给同一答案，后续有人改 `STATUS_CHIP_ZH` 的空串语义时会漏改外层。
**建议**：删 `:103-105`，统一交给 `formatStatusChipLabel`。
**置信**：confirmed

**F-w9-chat-pro-27 | P3 | `logic/render-dir-attach-tree.ts:17-18`**
```
  /** 保留透传兼容；本函数不再读写 file_cache。 */
  readonly sessionKkv: SessionKkvService;
```
**描述**：必填依赖字段，但函数体（`:65-115`）从不使用 `deps.sessionKkv`。
**后果链**：调用方（`prepare-user-messages-for-prompt.ts:241-245`）被迫构造并传入 KKV 服务，
在 domain→service 的依赖图上多出一条无用边；未来有人据此以为该函数会读缓存。
**建议**：改成可选字段或删掉，同步 `RenderDirAttachTreeDeps` 的 public 类型。
**置信**：confirmed

**F-w9-chat-pro-28 | P3 | `logic/seed-fork-copy-parity.ts:12-21,43-47`**
```
 * **唯一入口**：workplace / checkpoints / revisions / entries 的 Sqlite 实例仅在此 helper 内自建；
```
**描述**：这是 `domain/chat/logic/` 下唯一一个**在 domain 层直接 new 五个 infra 级 Sqlite repository**
的模块（`SqliteVfsEntryRepository` / `SqliteVfsContentStore` / `SqliteVfsRevisionRepository` /
`SqliteWorkplaceRepository` / `SqliteMessageCheckpointRepository`），并 import 了
`domain/message-checkpoint` 与 `domain/workplace` 的具体 impl。
**后果链**：domain 层耦合 5 个 impl 具体类，与「domain 定义 port、impl 在 repositories/impl」的分区约定冲突；
它自己也承认是「唯一入口」——意味着其余 `reposFor` 一旦新增同类构造就会静默分裂成两套播种逻辑。
**建议**：把 `seedForkCopyParity` 移到 `service/chat/` 或 `service/agent/`（它是编排动作，不是纯逻辑）。
**置信**：confirmed

**F-w9-chat-pro-29 | P3 | `logic/chat-annotate-draft-store.ts:14,101-111`**
```
const bySession = new Map<string, AnnotateDraft[]>();
```
**描述**：进程级 module 单例 Map，只在 `removeChatAnnotateDraft` / `removeChatAnnotateDraftsByPath` /
`clearChatAnnotateDrafts` / `resetChatAnnotateDraftStoreForTests` 时清理；**没有**「会话删除」钩子，
也没有容量上界（对比 `infra/content-cache` 的双上界 LRU）。
**后果链**：用户删除会话后，其批注草稿仍留在内存里；桌面多窗口 / 频繁切项目下无界增长。
条目本身很小（有界的单文件文本），实际危害有限，但与仓内其它进程级缓存的显式预算约定不一致。
**建议**：接 `session` 删除钩子；或加 maxEntries 上界 + LRU。
**置信**：suspected

**F-w9-chat-pro-30 | P3 | `logic/annotate-highlight.ts:57-58` 与 `:92`**
```
if (preferredOrdinal >= starts.length) {
  return [starts[starts.length - 1]!];
}
...
  return 0;   // 循环未命中时的兜底
```
**描述**：① ordinal 越界时**静默夹到末次命中**（而不是判为无效）；② `annotateOccurrenceOrdinal`
在 needle 完全找不到时返回 `0`（即「第 0 次出现」），与「无匹配」无法区分。
**后果链**：调用方（DOM 侧按 ordinal 选高亮起点）拿到的可能是一个**看似合法实则错误**的位置 → 高亮挂到错误的
划词实例上，且无任何报错。这是「静默给错答案」型缺陷，比抛错更难排查。
**建议**：越界/未命中改为返回 `null`，由调用方决定降级策略。
**置信**：suspected（消费方在 apps 内，未逐一核对降级处理）

**F-w9-chat-pro-31 | P3 | 文档/路径漂移三处**
- `logic/message-visible-floor.ts:4` — `@module domain/chat/message-visible-floor`（缺 `logic/`）
- `logic/resolve-chat-link-target.ts:17` — `@module domain/chat/resolve-chat-link-target`（缺 `logic/`）
- `logic/message-set-floor-range.ts:1` — 全文**无 `@module` 块**（该区其余 63 个文件都有）

**描述**：模块路径声明与实际目录不符 / 缺失。
**后果链**：任何以 `@module` 为准的文档生成、跳转或审计工具都会得到错误路径。
**置信**：confirmed

**F-w9-chat-pro-32 | P3 | `logic/message-visible-floor.ts:9-18`**
```
/**
 * Session messages visible to LLM/prompt, sorted by `seq` ascending.
 * @param messages - Full session list from `listBySession` (seq order)
 */
export function listVisibleSorted(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => !m.hidden);
}
```
**描述**：函数名带 `Sorted`、doc 承诺「sorted by seq ascending」，实现**既不排序也不校验顺序**，纯 filter。
**后果链**：调用方若传入未排序集合（未来新增读口很容易），会静默得到未排序结果——「Sorted」这个命名不构成保证。
**建议**：要么实现 `sort((a,b)=>a.seq-b.seq)`，要么去掉 `Sorted` 与 doc 承诺。
**置信**：confirmed

**F-w9-chat-pro-33 | P3 | `model/annotate-draft.schema.ts:79-95`**
```
if (hasStart !== hasEnd) {
  ctx.addIssue({ ... });
  return;
}
if (hasStart && hasEnd && startOffset! >= endOffset!) { ... }
```
**描述**：`hasStart !== hasEnd` 为真时，`hasStart && hasEnd` 必然为假，所以 `:87` 的 `return` 之后的
区间序校验**永远不会执行**。这不是 bug，但 `return` 暗示存在「跳过校验」的场景，实际没有。
**置信**：confirmed

**F-w9-chat-pro-34 | P3 | `repositories/impl/sqlite-message.repository.ts:81-94`**
```
/** 双形态读：content_blob 非空走解压，否则 parse content_json 明文。 */
function readRowContent(row: Row): MessageContent {
  if (row.content_blob != null) { ... }
  return parseMessageContent(String(row.content_json));
}
```
**描述**：doc 与 RULE.md:32 都写「blob **非空**」，判定写的是 `!= null`。若某驱动把空 BLOB 返回为
`Uint8Array(0)`（仍 `!= null`）或把 NULL 返回为 `''`，两种情况都会走错分支：前者进解压抛
「消息正文解压失败」，后者进 `JSON.parse('')` 抛「Invalid JSON in message content」——都 fail-fast，
符合 RULE 的「不做静默自愈」，但**错误分类会把驱动形态问题误报成用户数据损坏**（文案含「请反馈此 id」）。
**后果链**：一次驱动/迁移层的小形态偏差 → 用户看到「消息正文解压失败，请反馈此 id」，实际是编码器 bug。
**建议**：判定改成 `content_blob != null && byteLength > 0`（`zlib-codec` 已有 `decodeCompressedBytes`
处理字节形态，可直接复用），并在错误文案里区分「字节形态异常」与「解压失败」。
**置信**：suspected（当前 better-sqlite3 / op-sqlite 实测返回 Buffer / Uint8Array 或 null，未触发）

## 争议与存疑

1. **`computeShowRangeFromSelection`（F-21）是否真会给出不同的 `fromSeq`**：旧路按「已选中的 user 行最小 seq」，
   新路按「符合 mode 可选规则的行最小 seq」。当 UI 只允许勾选符合条件的行时两者等价；若存在「先按 hide 勾选、
   再切 restore 模式」导致 selectedIds 残留非法行的路径，则不等价。我没有追到 UI 的选择状态重置逻辑，
   **不断言这是 bug**，只断言双路并存本身是需要收敛的不一致。

2. **`searchMessages` 全量扫描的性能代价**：keyword 非空时 `scanLimit = max(limit*20, 200)`，
   命中不足时会**逐段续扫到扫完全部行**（`:548-589`），每段都 `mapRows` 全量解码正文。
   注释已明示这是刻意取舍（「大会话搜索多付解压成本，与 listBySession 全量路径同量级」）。
   我**不把它报成问题**，但在 F-1 的后果链里指出：一旦附件被静默丢弃，用户重试/换关键词的次数会上升，
   两者叠加会放大这条路径的成本。

3. **`isUserInputMessage` 用 `hasToolResult` 判定**（`message-content-helpers.ts:22-24`）：
   一条「用户输入 + 同消息内含 tool_result」的 user 消息会被判为非用户输入而**跳过 wrap**，
   即附件不会被 hydrate。注释明确说这是有意的（wrap 会把 block 拍平成 text 导致 LLM 配对错误）。
   我核对了实际写入路径：tool_result 由 tool runner 单独 append 成独立 user 行，不与用户输入同消息。
   **判定 intentional，不报**。

4. **`project-agent-config` 整条线（F-7）的最终归属**：桌面 IPC 已 no-op，唯一活写方是 `copy()`。
   这可能是「迁移期保留读兼容」的合理中间态，也可能是漏删。我倾向前者但证据不足以定论，**标 confirmed 的只是
   「注释与实现矛盾」这个事实本身**，方案由 reduce 层裁决。

5. **`failfast vs 静默自愈`**：`decodeMessageContent:94-100` 解压失败抛 `chatInvalidArgument`，
   `parseMessageContent:272-276` JSON 失败也抛。两者都**不带重试/降级**。按 RULE.md:32
   「用户数据本体，不做静默自愈」是拍板口径，**标 intentional，不报**。F-34 报的只是错误分类不够细，不是「不该抛」。

## 覆盖率与未覆盖

- 64 个文件**全部**读过（`sqlite-message.repository.ts`、`prepare-user-messages-for-prompt.ts`、
  `annotate-source-range.ts`、`annotate-source-anchor.ts`、`annotate-highlight.ts` 全文逐行）。
- 未深读但已 grep 交叉验证的边界文件：`service/chat/impl/message.service.ts`（只看 `append` 段）、
  `service/chat/impl/project.service.ts`（只看 agent-config 段）、`bootstrap/chat/chat-schema.ts`、
  `infra/content-cache/logic/decoded-content-cache.ts`、`infra/sql-template/placeholder.ts`、
  `infra/tdbc/logic/template-helper.ts`。这些不属于本 zone，仅作为证据引用。
- **未验证**：`apps/**` 侧对每个 public 导出的实际使用面（只做了定向 grep，未做完整调用图）。
  凡结论依赖「某符号无消费方」的条目，均已用 `git grep` 全仓确认并附上了命中位置。