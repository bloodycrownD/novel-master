---
date: 2026-07-18
---

# composer-at-token-prompt-dedup 技术规格（SPEC）

> **PRD**：`.apm/kb/docs/Iterations/message-attachment-unified/features/composer-at-token-prompt-dedup/prd.md`  
> **需求策略**：一期交付；局部 supersede 父级 / `composer-ops-chip-lifecycle` / `file-ref-picker-ux` 相关验收。  
> **探索标注**：子代理探索 + 手工补读（prepare / agent-runner / wrap / session-prompt-input）。

## 设计目标

1. Composer：框内单行不可叉状态 chip（workplace + user_ops）；**移除文件引用 attach chip**；文件引用只以输入框里的 `@路径` 为准（选择器与手输 `@` 搜索都只往输入框插字）。
2. 提示词：按最终可见顺序共享「已出现路径」集合——常驻前缀先计入；文件 attach 非首次 → 短提示；workplace 非首次 → 不进提示词正文；目录每次拼树；同条同 path 时 attach 优先；user_ops 不参与路径首次判定。
3. 移除历史 UA 列表折卡；旧消息按普通气泡。
4. 巩固消费者分家：`content_json` 仅原文；提示词套层只在 prepare 内存态；UI 禁止从正文正则还原结构。

## 总体方案

### 架构（提示词侧）

拼装提示词时，先列出当前会话里未隐藏的消息，必要时再跑一遍 `applyLlmRegex`。接下来不再像现在这样先 prepare 再拼常驻前缀，而是先调用 `assembleWorkplaceDisplay`：它一边产出给模型看的 `worktreeDisplay` 字符串，一边把本轮规则快照里全部可见 path（含 `filename` / `header` / `full`）收进前缀集合 `S0`（即 `prefixPaths`）。然后带着这个 `S0` 进入 `prepareUserMessagesForPrompt`：按消息顺序走每一条 user，对 workplace / attach 判断 path 是否已在 `seen` 里——文件 attach 首次则全文 hydrate 并加入 `seen`，非首次则写入短提示（不必读盘）；workplace 首次同样全文并入 `seen`，非首次则 content 置空，wrap 时省略该块；目录 attach 每次都 `renderDirAttachTree`，自身不降级，但 path 仍可计入 `seen`，好让后面同 path 的 workplace / 文件 attach 当成非首次；`user_ops` 原样带过。最后 `wrapUserMessageForLlm` 只在还有非空 section body 时套 `<attachment>`；若全部 section 都没有非空 body，直接返回 `plainText`，不包一层空 attachment。再经 `buildPromptLlmInputFromLayout` 与 `normalizeForLlmExport` 交给下游。

```text
session.list()（非 hidden）
  → applyLlmRegex（若有）
  → assembleWorkplaceDisplay  → { worktreeDisplay, prefixPaths: S0 }
  → prepareUserMessagesForPrompt(messages, { seenPaths: S0, ... })
  → wrapUserMessageForLlm
  → buildPromptLlmInputFromLayout({ worktreeDisplay, messages: prepared })
  → normalizeForLlmExport
```

**调用序变更（相对现状）**：现状 `agent-runner` / `session-prompt-input` 为 **prepare → assemble**。本 Feature 改为 **assemble → prepare(带 S0)**，使「常驻先计入」与最终提示词可见序一致。Desktop/Mobile `buildSessionPromptInput` 与 runner **必须同序**。

#### assemble API

推荐签名（或等价结构）：

```ts
assembleWorkplaceDisplay(...): Promise<{
  worktreeDisplay: string;
  prefixPaths: string[]; // S0：规则快照全部可见 path（filename/header/full）
}>
```

无 worktree 块或快照为空时，返回 `{ worktreeDisplay: "", prefixPaths: [] }`。  
`prefixPaths` 在写入 `seen` / 比较前须先走下方「path 规范化」。

**须改调用方**（当前把返回值当 `string` 使用）：

- `packages/core/src/service/agent/impl/agent-runner.ts`
- `apps/desktop/src/main/services/session-prompt-input.service.ts`
- `apps/mobile/src/services/session-prompt-input.service.ts`
- `apps/cli/src/prompt/commands.ts`
- `apps/mobile/src/services/worktree-block.service.ts`
- 相关单测（`assemble-workplace-display.test.ts`、runner / prompt-tokens 等）

#### seen / 去重 path 规范化

计入 `seen`、与 `S0` / 附件 path 比较时，统一走同一套规范化，得到同一个逻辑 path（seen key）。**插入正文的 `@路径`、scan 落库的 attachment.path、首次读盘用的 path、短提示 XML 的 `path` 属性**，都必须与这个结果一致——不能一边用缺前导 `/` 的写法落库，一边用补全后的 key 去重。

规范化步骤：

1. 与当前 VFS 逻辑 path 约定对齐（绝对 POSIX 形态）。
2. 手输或缺前导 `/` 时补上（例如 `foo/bar.md` → `/foo/bar.md`）。落库与短提示 XML 的 path **一律带前导 `/`**。
3. 目录：插入 / 扫描时可先看尾部 `/` 判定 `type:'dir'`，再把该 path **计入 seen**，计入时去掉尾 `/`（seen key 与文件同形，无尾斜杠）。目录插入仍可带尾 `/`（如 `@path/`），与现有 `scan-at-path-attachments` 一致。

同一逻辑文件的多种写法（有无尾 `/`、有无前导 `/`）必须落到同一个 seen key。T-PD3 / T-ATD* fixture 使用规范化后同一 path，且落库 path 带前导 `/`。

#### prepare 按 source 优先级

单条消息内处理顺序固定为 **attach → workplace → user_ops**，**禁止**依赖落库 `attachments` 数组序。同 path 时 attach 先判定并更新 `seen`，随后 workplace 必为非首次 → 提示词不显示该 path。T-PD4：即使数组里 workplace 排在 attach 前面，仍须 attach 胜出。

#### 短提示形态

文件 attach（文本）非首次时，**不经** `renderFileBlock`（无行号、无 `createdAt` / `updatedAt` 等属性），专用最小形态：

```xml
<file path="{logicalPath}">该文件前文已引用，无需读取或加载</file>
```

短提示写入附件 `content` 内存字段，**不写回**库。保证查看提示词 / token / Agent 同源。

#### image / binary

图片与二进制 attach **不套**上述中文短提示，非首次仍保持 **filename** 档（与父级「二进制 / 图片 @ 按 filename 档」一致）；path **仍计入** `seen`（本 Feature 选定：计入）。

#### wrap 空 section

任一 source 的 section 若 body 全空则省略该标签。若全部 section 都无非空 body → `wrapUserMessageForLlm` **直接返回 `plainText`**，不包空 `<attachment>`。

### Composer（UI）

```text
┌─ composer box ─────────────────────┐
│ [状态 chips 无叉 | workplace+ops]   │
│ [输入区：彩色或等价可见的 @路径…]    │
│ [工具栏 … @ … 发送]                 │
└────────────────────────────────────┘
FileReferencePicker / @typeahead → 往正文插入 @path
发送：text → Core scanAtPathAttachments；状态仍内存投影，不进 composer_draft attach
```

- 删除框外状态条占位；**整段移除** `ComposerAttachChips`（文件引用不再有 chip）。
- 状态 chip 仅保留不可叉的状态行，移入输入框内顶部。
- `composer_draft_json.attachments`：新写可恒 `[]`；hydrate 时若仍有历史 `source:attach`，**丢弃**（不再恢复为 chip）。
- 目录插入约定：插入 `@path/`（规范化后落库带前导 `/`，正文 token 可带尾 `/` 供 type 判定）。若不带尾 `/`，发送前允许 VFS `stat` 补类型（可选）。计入 seen 时去尾 `/`。

#### undo_send / 编辑回填

**移除 attach chip** 之后，回填合同是：**仅正文 `@路径` + 状态投影**。没有「再把文件引用 chip 加回去」——产品上已经没有这类 chip。再次发送时从正文 `@` 扫描出附件即可。

受影响实现面：`rollback-composer`、`ConversationPanel`、`useChatTabMessages`（及对应 T-TX2 / rollback 单测口径，见测试策略）。

### 旧 UA 折卡

列表层不再调用 `matchUserVfsTurnAtForDisplay`；`user_vfs_action` / ack 以普通 `message` 行渲染。保留 flush / `parseAllUserVfsActionsFromText` / 新 `user_ops` 附件卡。

## 最终项目结构

```text
packages/core/src/domain/chat/logic/
  prepare-user-messages-for-prompt.ts   # + seenPaths；短提示 / workplace 跳过；source 优先级
  wrap-user-message-for-llm.ts          # 全空 section → 直接 plainText
  prompt-path-seen.ts                   # NEW 可选：规范化 + seen 集合工具
  scan-at-path-attachments.ts           # 文档/尾斜杠约定
  user-vfs-turn-view.ts                 # 删展示匹配导出（或永久 null）

packages/core/src/service/agent/impl/agent-runner.ts
packages/core/.../workplace/assemble-workplace-display.ts  # 返回 { worktreeDisplay, prefixPaths }

apps/{desktop,mobile}/.../ChatComposer.tsx
apps/{desktop,mobile}/.../AttachmentDraftChips.tsx
apps/{desktop,mobile}/.../FileReferencePicker.tsx
apps/{desktop,mobile}/.../AtPathTypeahead.tsx          # NEW
apps/{desktop,mobile}/.../message-blocks.ts            # 去折卡
apps/desktop/renderer/features/chat/rollback-composer.ts
apps/desktop/renderer/features/chat/ConversationPanel.tsx
apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts
# Mobile webview RowList / UserVfsTurnRow 删除或停用
```

## 变更点清单

| 模块 | 变更 |
|------|------|
| Core prepare / wrap | seen 规范化；按 source 优先级；短提示最小 XML；image/binary 不套短提示仍计 seen；全空 → plainText |
| Core assemble + runner + session-prompt-input + cli + mobile worktree-block | 返回 `{ worktreeDisplay, prefixPaths }`；**assemble 先于 prepare**；传入 S0 |
| Core scan / draft | 正文为文件引用入口；目录尾 `/`；seen 去尾 `/` |
| Composer 双端 | 状态条入框；**移除 attach chip**；插 `@路径`；@ 搜索≤5 |
| rollback / 编辑回填 | **仅正文 `@路径` + 状态投影**（无文件引用 chip 可恢复） |
| 列表双端 + Mobile WebView | 去 `user_vfs_turn` |
| 父 SPEC / 测试 | 废止 T-UO2、B2-4 折卡期望；增 T-ATD* / T-PD*；翻转 T-TX2 |

## Context Bundle

```yaml
iteration_name: composer-at-token-prompt-dedup
requirement_path: Iterations/message-attachment-unified/features/composer-at-token-prompt-dedup/prd.md
spec_path: Iterations/message-attachment-unified/features/composer-at-token-prompt-dedup/spec.md
explore_summary: |
  现状 prepare→assemble，每次全文 hydrate；Composer 框外状态+框内可叉 attach；
  UA 折卡仍在 message-blocks。改为 assemble→prepare+seen；@token；去折卡；
  移除 attach chip；回填仅正文 @路径与状态投影。
impact_files:
  - packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts
  - packages/core/src/domain/chat/logic/wrap-user-message-for-llm.ts
  - packages/core/src/service/workplace/assemble-workplace-display.ts
  - packages/core/src/service/agent/impl/agent-runner.ts
  - apps/desktop/src/main/services/session-prompt-input.service.ts
  - apps/mobile/src/services/session-prompt-input.service.ts
  - apps/cli/src/prompt/commands.ts
  - apps/mobile/src/services/worktree-block.service.ts
  - apps/desktop/renderer/features/chat/rollback-composer.ts
  - apps/desktop/renderer/features/chat/ConversationPanel.tsx
  - apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts
  - apps/*/.../ChatComposer.tsx
  - apps/*/.../AttachmentDraftChips.tsx
  - apps/*/.../message-blocks.ts
constraints:
  - content_json 从不写入 wrap 用的 XML；提示词套层只存在于 prepare 内存态。
  - 目录 attach 从不降级为短提示，每次都拼目录树；计入 seen 时去掉尾部斜杠。
  - user_ops 的 content 不受 seen / 短提示规则改写。
  - 移除文件引用 attach chip；文件引用只认输入框里的 @路径。
  - undo_send 与编辑回填仅恢复正文（含 @路径）和状态投影。
  - Desktop 可用透明层高亮 @路径；Mobile 至少插入纯文本 @路径（PRD 允许体验一致即可）。
blocking_steps: [1, 2, 3, 4, 5, 6, 7]
```

## 详细实现步骤

- Step 1 — phase-prompt-seen — blocking: yes — qa: auto：抽出 `PromptPathSeen`（规范化：补前导 `/`、对齐当前 VFS 逻辑 path 约定、目录先按尾 `/` 判 type 再计入 seen 并去尾 `/`；插入正文 / scan 落库 / 首次读盘 / 短提示 XML 与 seen key 同形）；`assembleWorkplaceDisplay` 改为返回 `{ worktreeDisplay, prefixPaths }`，`S0` = 规则快照全部可见 path；更新 runner、双端 `session-prompt-input`、cli、`worktree-block` 等调用方；调用序改为 assemble→prepare(S0)。单测：前缀含 A 时首条消息 `@` A → 短提示（T-PD3，fixture 用规范化后同一 path，落库 path 带前导 `/`）。
- Step 2 — phase-prompt-degrade — blocking: yes — qa: auto：prepare 按 **attach → workplace → user_ops** 处理（不依赖数组序）；文件文本首次全文、其后专用最小短提示 XML（不经 `renderFileBlock`）；image/binary 保持 filename、仍计 seen；workplace 非首次不进 wrap body；目录每次树；user_ops 跳过。`wrapUserMessageForLlm`：全部 section 无非空 body → 直接 `plainText`。单测 T-PD*。
- Step 3 — phase-composer-layout — blocking: yes — qa: auto：双端状态 chip 移入输入框内顶部；**整段移除** `ComposerAttachChips` 与框外 status bar；CSS 调整。**回填合同**：编辑 / `undo_send` **仅正文 `@路径` + 状态投影**（改 `rollback-composer`、`ConversationPanel`、`useChatTabMessages`）。单测：无 attach chip 组件路径；T-TX2 / rollback 口径翻转。
- Step 4 — phase-at-token-insert — blocking: yes — qa: auto：Picker `onConfirm` 改为插入 `@path`（目录 `@path/`）；新增手输 `@` typeahead（≤5）；发送门闩以正文 `@` / 状态投影为准；draft attach 写空。单测扫描与门闩；rollback/编辑断言「正文含 `@path`，且不存在文件引用 chip」。
- Step 5 — phase-at-token-style — blocking: no — qa: auto：Desktop 透明 textarea + highlight 层（或等价）着色；Mobile 至少插入纯文本 `@path`（彩色可选）。契约测：落库仍为纯字符串。
- Step 6 — phase-drop-ua-fold — blocking: yes — qa: auto：双端 message-blocks / MessageList / transcript-selectable / Mobile WebView 去掉 `user_vfs_turn`；core 取消导出 `matchUserVfsTurnAtForDisplay`；废止 T-UO2、B2-4；新断言「历史 UA → 普通 message」。勿动 user_ops 附件与 flush。
- Step 7 — phase-parent-doc-sync — blocking: yes — qa: auto：父 `message-attachment-unified/spec.md` 标注废止「历史 UA 只读折卡 / T-UO2」与「每次 attach 全文」相关期望，指向本 Feature。
- Step 8 — phase-device-smoke — blocking: no — qa: manual_user：双端 Composer `@` 插字/搜索/删 token；查看提示词短提示；旧会话无 UA 工具卡；undo_send / 编辑后输入框有 `@路径`，界面上无文件引用 chip。

## 测试策略

### 测试用例

- **T-PD1** — blocking: yes — Step 2：可见消息首次文件 attach → 提示词含全文 `<file`（可经 `renderFileBlock`）。
- **T-PD2** — blocking: yes — Step 2：第二条可见消息同 path 文本 attach → 提示词为专用最小形态 `<file path="…">该文件前文已引用，无需读取或加载</file>`（无行号、无 createdAt 等；**不是** `renderFileBlock` 输出）；无全文。
- **T-PD3** — blocking: yes — Step 1/2：常驻前缀已含 path A（规范化后），消息再 `@` 与 A 等价的写法（如缺前导 `/` 或目录尾 `/` 变体）→ 短提示；fixture **必须用规范化后同一 path**，且落库 / 短提示 XML 的 path **带前导 `/`**。
- **T-PD4** — blocking: yes — Step 2：同条 workplace+attach 同 path，**attachments 数组故意让 workplace 排在 attach 前面** → 仍仅 attach 段有内容，workplace 无该 path 块（证明按 source 优先级而非数组序）。
- **T-PD5** — blocking: yes — Step 2：目录 attach 两次 → 两次均含 `<dir` 树，非短提示；目录 path 计入 seen（去尾 `/`）后同 path 文件 / workplace 为非首次。
- **T-PD6** — blocking: yes — Step 1：`buildSessionPromptInput` 与 runner 同序同结果（短提示比特级一致意图）。
- **T-PD7** — blocking: yes — Step 2：image/binary attach 非首次 → 仍为 filename 档形态，**无**中文短提示文案；path 已在 seen。
- **T-PD8** — blocking: yes — Step 2：仅有 workplace/attach 但 hydrate 后全部 body 为空 → wrap 结果等于 `plainText`，无空 `<attachment>`。
- **T-ATD1** — blocking: yes — Step 3：仅状态 attachments 时 Composer 仅无叉状态行，无 attach 可叉行。
- **T-ATD2** — blocking: yes — Step 4：Picker 确认后正文含 `@path`，attachments 入参可空，发送后库内有 attach；落库 `path` **带前导 `/`**（与 seen key / 短提示 XML 同形）。
- **T-ATD3** — blocking: yes — Step 4：手输 `@` 搜索列表 ≤5，点选插入完整 `@path`；落库 path 同样带前导 `/`。
- **T-ATD4** — blocking: yes — Step 4：删除正文 `@path` 后发送，attachments 无该 path。
- **T-TX2** — blocking: yes — Step 3/4：**翻转口径**：`undo_send` / 编辑回填 → 仅恢复原文（含 `@路径`）+ 状态投影；**不存在**文件引用 attach chip。覆盖 `rollback-composer.test.ts`、Desktop `ConversationPanel`、Mobile `useChatTabMessages` 既有 T-TX2。
- **T-UO2x** — blocking: yes — Step 6：**替代 T-UO2**：历史 UA fixture → `buildChatListItems` / `buildTranscriptRows` 仅 `message`，无 `user_vfs_turn`。
- **T-SR3** — blocking: yes — Step 6：回归空正文 + `user_ops` attachment 仍为 message + 附件卡。

## 兼容性或迁移说明

- **无数据迁移**：历史 UA 正文可能直接展示；接受可读性下降。
- **草稿**：旧 draft 仅有 attach、无对应 `@` 正文 → hydrate **丢弃** attach（用户需重新 `@`）；或产品后续再开「补插」变更。
- **父级 supersede**：状态条「输入框外上方」；选择器「至少进 chip」；「历史 UA 只读折卡」；隐含「每轮文件 attach 均全文」；以及既有 T-TX2「回填 attachments chips」期望（改由本 Feature T-TX2 新口径）。
- **assemble 返回值**：由 `string` 变为对象；调用方一次性改完，避免半迁移。

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| assemble/prepare 调序回归 | T-PD6；双端 session-prompt-input 与 runner 共用辅助函数 |
| path 写法不一致导致重复全文 | 规范化单测（T-PD3）；手输补 `/` |
| 目录无尾 `/` 误判 text | 插入约定 + 可选 VFS stat；单测目录 Picker |
| 调用方漏改 assemble 解构 | 编译期类型错误；列出 cli / worktree-block |
| Mobile 无彩色 | PRD 允许；手工 smoke 不阻塞 |
| 去折卡后 tail 行数变 2 | 文档化；回归 set-floor / 选中 |
| 误删 flush / parseAll | 变更清单显式保留；T-SR3 / T-UO1 |
| 用户习惯找文件引用 chip | 产品上已移除；引导认输入框 `@路径`；smoke 验证删字/回填/发送扫描 |

**回滚**：按 Step 逆序还原调用序与 UI 双条；折卡 API 可短暂保留死代码一版再删；assemble 可临时兼容 `string | {…}` 一版再收紧（非默认）。
