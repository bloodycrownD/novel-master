---
date: 2026-07-22
---

# Mobile 聊天 Composer · 批注 · 消息操作 UX 修复 技术规格（SPEC）

## 需求来源

- PRD：`Iterations/mobile-chat-composer-annotate-ux/prd.md`
- 前置合同：`annotate-user-ops-unify`、`composer-at-token-prompt-dedup`、`composer-two-pipelines-hard-contract`、`chat-user-rollback-redo`、`message-set-floor`、`agent-chat-ux-bugfix`
- 探索依据：2026-07-22 四路只读探索（多文件下划线+Undo / `@path`+选中色 / 消息菜单+消息批注 / 测试与协议约束）
- 审查修订：第 1 轮 `spec-p0-p1-message-annotate-contracts`（落库 name/path、划词宿主 API、plain 与 scanAtPath 分流、SendAnnotateDraft、mention、⋯ 锚点）
- 审查修订：第 2 轮 `spec-scan-at-and-selection-resolve`（发送正文须剥离消息批注 span 后再参与 `@path` 扫描、划词 messageId 上溯、Undo 伪 path `includes`、trigger suggest 恒空）
- 审查修订：第 3 轮 `spec-usercontent-strip-and-copy-menu`（钉死：剥离发生在 App→`runAgentTurn.userContent`；`@path` 扫描仅 Core `runAgentTurn` 内对 `trimmed` 调 `mergeAttachmentsWithScannedAtPaths`；transcript 划词 menuItems 自备「批注」+「复制」）

## 设计目标

1. **多文件工作区批注下划线**：同会话多 path 草稿切换预览时，当前文件下划线可靠（chip 合同不变）。
2. **`@path` tag 回归**：选择器/typeahead 插入后着色 + 原子删；对外 plain `@路径`；无 attach chip；不露 `{@}` 协议串。
3. **Undo Send 恢复工作区批注**：含 `action:annotate` 且 **真 VFS path** 的 plain user Undo 时，按附件重建 store + chip（及打开文件时下划线）；**跳过** `path.includes('__message__:')` 的伪 path（含 `/__message__:`）。
4. **Composer 选中色柔化**：不再用刺眼 `tokens.primary` 整块选中。
5. **消息菜单右上角主入口**：对齐 Desktop「⋯」；弱化/移除长按主路径；划词复制可用；菜单项集合不变。
6. **消息正文批注**：独立草稿；**仅用户消息**可划词批注（助手静默取消）；Composer tag（无 chip、气泡无下划线）；删 tag=删草稿；发送进模型（`<user-ops>` / `annotate`）；**传给 `runAgentTurn` 的 `userContent` 须已是剥离全部消息批注 mention span 后的 plain**（该串同时用于 Core 内 `mergeAttachmentsWithScannedAtPaths` 与落库正文；批注只走 `annotateDrafts`，不参与 `@` 扫描）。

**平台**：仅 Mobile（Android）。Desktop UI 不改、不验收；Core 扩联合类型时 Desktop 文件批注调用方须继续编译通过。

## 总体方案

```text
┌─ A. 工作区批注下划线 ─────────────────────────────────────────┐
│ FileMarkdownPreview：path 变化同步派生 pathDrafts（禁滞后一帧） │
│ RichDocumentWebView：setDocument 与 annotations 同批投递；      │
│   建议 key={path} 强制重建；bridge 在文档就绪后 refresh marks   │
└────────────────────────────────────────────────────────────────┘

┌─ B. @path tag + 选中色 ───────────────────────────────────────┐
│ ComposerAtPathInput：取消全程受控 selection（对齐宏输入短暂设） │
│   selectionColor → 柔和 tint；tag 可加轻底与选中区分            │
│ 纯函数/协议（{@}[path](path)）保持；@path 对外仍 @path plain   │
└────────────────────────────────────────────────────────────────┘

┌─ C. Undo → 恢复工作区批注 ────────────────────────────────────┐
│ Core：parseAnnotateDraftsFromAttachments（新 mint id）          │
│   仅真 VFS path；path.includes('__message__:') → 跳过          │
│   （含 /__message__:；builder 不对伪 path 做破坏前缀的        │
│    normalizePromptStorePath）                                   │
│ useChatTabMessages：rollback 前 snapshot 附件 → 成功后           │
│   addChatAnnotateDraft* + refreshComposerAnnotateChips          │
│ 与未发送草稿：按条目并存，不静默丢任一侧                        │
└────────────────────────────────────────────────────────────────┘

┌─ D. 消息菜单 ⋯ ───────────────────────────────────────────────┐
│ MessageRow：右上角 ⋯ → openContextMenuFromAnchor(id, btnRect) │
│   （或扩展 MenuAnchor 后等价）；移除/禁用长按主路径              │
│ 平时允许正文划词；菜单项仍 buildMenuItems                        │
└────────────────────────────────────────────────────────────────┘

┌─ E. 消息正文批注（与文件批注硬分离）──────────────────────────┐
│ MessageAnnotateDraft{id,messageId,originalText,userAnnotation} │
│ 独立 App Map；禁止 chipsFromAnnotateStore / 气泡 mark           │
│ Composer：第二 trigger（非 @；仅解析/程序化插入，suggest 恒空）│
│ ChatComposer 发送前：剥离全部消息批注 mention span → 得到 plain │
│   作为 runAgentTurn.userContent（同串供 Core merge 扫描与落库）│
│   @path 扫描仅在 Core runAgentTurn 内 mergeAttachments…；     │
│   App 勿另调 scan 造成双轨；批注只走 annotateDrafts            │
│ 发送：SendAnnotateDraft 联合 → builder 分派；落库 path=name=   │
│   __message__:<messageId>:<draftId>；XML JSON 含 messageId 等  │
│ 划词：menuItems=批注+复制（对齐 RICH_DOCUMENT_ANNOTATE…）；    │
│   onCustomMenuSelection → getSelection 上溯                     │
│   .row.message.user[data-id] → bridge {messageId,text} → 宿主  │
│   （assistant 上溯失败 → 静默取消；menuItems 静态不按角色隐藏） │
│   复制 → 系统剪贴板（自定义 menu 盖掉原生 Copy 后须自备）       │
└────────────────────────────────────────────────────────────────┘
```

### 钉死决策（探索后定稿 · 第 1–3 轮审查修订）

| 项 | 定稿 |
|----|------|
| 下划线根因方向 | RN/Web 分发时序 + pathDrafts 异步；优先修投递原子性与同步派生，非改匹配算法 |
| `@path` 修复方向 | **方案 A**：修正受控 `selection` + 选中色/轻底；不推翻 controlled-mentions（除非 A 验证失败再升方案 B） |
| Undo 解析 | Core 导出 `parseAnnotateDraftsFromAttachments`；与文件形 `buildAnnotateAttachmentFromDraft` 成对；**新 mint id**；**仅**恢复「真 VFS path」工作区批注 |
| Undo 合并 | 恢复条目 **append** 进现有 store；不按 path 折叠丢条；同 `originalText+userAnnotation+path` 允许重复（与发送 concat 一致） |
| **Undo / 伪 path 识别（第 2 轮钉死）** | 用 **`path.includes('__message__:')`** 识别消息批注伪 path（**同时接受** `/__message__:` 与无前导斜杠形）；命中则 **跳过** Undo 恢复。**builder 不得**对消息批注伪 path 调用会破坏该子串/前缀语义的 `normalizePromptStorePath`（或等价规范化）；落库 `path`/`name` 保持 `__message__:<messageId>:<draftId>`（可带或不带前导 `/`，但识别一律 `includes`） |
| 长按 | **移除长按打开消息菜单**（主路径）；划词用系统选区；⋯ 为唯一菜单入口 |
| 消息批注 store | **独立 Map**（勿写入文件 `AnnotateDraft.path` 伪路径进 chip 投影） |
| **消息批注落库 name/path（方案 ②）** | **`path` 与 `name` 同为伪路径 `__message__:<messageId>:<draftId>`**（可带前导 `/`），以满足现网 `messageAttachmentSchema`：有 `action` 时 `name === attachmentStorageName(path)`。**禁止**「省略 path + name=`__message__:…`」（空 path → name 被强制为 `__no_path__`，过不了）。XML/`content` JSON 含 `messageId`、`originalText`、`userAnnotation`（可另含伪 `path` 字段与落库一致，实现自定，须可被 parse 识别） |
| 消息批注进模型 | 仍 `action:"annotate"` + `source:"user_ops"`；走上述伪 path/name；**不得**用空 path / `__no_path__` 冒充消息批注 |
| **SendAnnotateDraft** | `type SendAnnotateDraft = AnnotateDraft \| MessageAnnotateDraft`（或等价联合）；`runAgentTurn.annotateDrafts` / builder 入口接受该联合；**builder 按成员判别分派**（有真 VFS `path` 且 `!path.includes('__message__:')` → 文件形；有 `messageId` / 伪 path → 消息形）；消息形路径 **跳过**破坏性 `normalizePromptStorePath`；Desktop **仍只传文件形 `AnnotateDraft[]`**，须编译通过（联合向后兼容） |
| 消息批注 tag 文案 | 可见短标签：`批:「` + 截断 `originalText`（≤12 字，超出加 `…`）+ `」`；内部 mention id = `draft.id`。（**可选**：短标签可见文案内将 `@` 显示为全角 `＠`，便于人读；**主合同仍以发送前剥离为准**，不依赖显示替换防扫） |
| **消息批注 mention + `userContent` / scanAt（第 2–3 轮主方案）** | **独立 trigger**（推荐 `§` 或实现期选定**非 `@`** 单字符；**禁止**复用 `@`）。内部 markup：`{§}[可见短标签](draft.id)`。Composer 对外展示 plain 仍可将消息批注展开为短标签；**但**传给 `runAgentTurn` 的 **`userContent` 必须已是**剥离全部消息批注 mention span 之后的 plain（仅保留 `@path` mention 展开结果 + 普通文本）。**剥离在 App `ChatComposer` 发送前完成**；该 `userContent` **同时**用于 Core 内 `mergeAttachmentsWithScannedAtPaths(userContent, …)` 与落库正文。**禁止** App 另调一次 `scanAtPathAttachments` / `mergeAttachmentsWithScannedAtPaths` 再与 Core 双轨。消息批注内容 **只**经 `annotateDrafts` / builder 进模型，**不参与** `AT_PATH_TOKEN_RE = /@([^\s@]+)/g` 扫描。删 tag / 原子删 → 同步 `removeMessageAnnotateDraft` |
| **消息批注 trigger suggest（P2 实现注）** | 该 trigger **仅**用于解析已插入 markup / 程序化插入；typeahead **`suggest` 恒返回空列表**（不提供手输联想入口） |
| **消息划词 messageId 主路径（第 2 轮钉死；remove-assistant 修订）** | `ChatTranscriptWebView`：自定义 `menuItems` + `onCustomMenuSelection` → **injectJS** 从 `window.getSelection()` 锚点上溯 **`.row.message.user[data-id]`** → bridge 载荷 **`{ messageId, text }`** → 宿主 AnnotatePickModal 类录入（**不**画气泡下划线）。**解析失败**（无 user row / 无 `data-id` / 空选区 / 选区在 assistant）→ **取消录入、不写草稿、不插 tag**。宿主再按 `role === 'user'` 二次门闩。`menuItems` 静态含「批注」+「复制」（RN 无法低成本按角色隐藏）。须改 `ChatTranscriptWebView.tsx`、`ChatTranscriptBridge.ts` |
| **transcript 划词 menuItems（第 3 轮钉死）** | **对齐** `RICH_DOCUMENT_ANNOTATE_MENU_ITEMS`：自定义 `menuItems` **须含**「批注」+「复制」（`key: 'annotate' | 'copy'` 或等价）。自定义项会盖掉原生 Copy/Share，故 **必须自备「复制」**；`copy` → 系统剪贴板（如 `Clipboard.setString(选区文本)`）。避免只有「批注」导致划词无法复制 |
| **右上角菜单锚点** | 钉死 `openContextMenuFromAnchor(messageId, DOMRect)`（或扩展现有 `MenuAnchor` 后由 ⋯ 点击传入按钮 `getBoundingClientRect()`）；**⋯ 点击传按钮 rect**，不再依赖长按触摸点 |
| `hasAnnotateDrafts` | **App 侧**对文件 store 与消息批注 store 取 **或** 后传入既有 Core 布尔入参；**不**改 Core `hasAnnotateDrafts` / `hasComposerSendableInput` 布尔语义 |
| Desktop | UI 零改动；Core 若扩联合/可选字段，须保持 Desktop 文件批注路径编译通过 |

### 消息批注 mention 合同（小节）

| 点 | 合同 |
|----|------|
| Trigger | 与 `@path` **分流**；字符 ≠ `@`（推荐 `§`）；**仅解析/程序化插入，`suggest` 恒空** |
| 内部 markup | `{§}[批:「…」](draftId)`（trigger 字符随实现；id=`MessageAnnotateDraft.id`） |
| 对外展示 plain | 消息批注 → 可见短标签（推荐不以 `@` 开头；可选将内嵌 `@` 显示为 `＠`）；`@path` → 仍 `@路径` |
| **`runAgentTurn.userContent`（第 3 轮钉死）** | App `ChatComposer` 发送前剥离全部消息批注 mention span → 得到 plain，**作为** `userContent` 传入。该串 **同时**供 Core `mergeAttachmentsWithScannedAtPaths(userContent, …)` 与落库正文。**禁止** App 另调 scan 与 Core 双轨 |
| **与 `scanAtPathAttachments`（主方案）** | 扫描发生在 **Core `runAgentTurn` 内**（对照 `packages/core/src/service/agent/logic/run-agent-turn.ts`：对 `trimmed = userContent.trim()` 调 `mergeAttachmentsWithScannedAtPaths`）；**非** `composer-at-path-mention` 内另扫。短标签内即便含 `@/foo.md` 也 **不得**进入该串。仅消息批注发送时 **不新增** `source:attach`（T-MA5 必盖） |
| 删 tag 同步 | 原子删或清空该 mention part 时调用 `removeMessageAnnotateDraft(sessionId, draftId)`；append 成功清空消息批注 store + 对应 tag |

### 不可破坏契约（护栏）

1. 两管道：无文件引用 attach chip；禁止用 `@` 藏状态 chip。  
2. 工作区 annotate：App Map 真源；replace projected 后 ∪ 文件批注 chip；concat 禁 path 去重；append 成功才清。  
3. 消息批注：**永不**进 `chipsFromAnnotateStore` / `unionComposerStatusWithAnnotate`；气泡无 annotate-mark。  
4. Undo 内核（资格/截断/VFS）不变；仅 Composer+store 恢复侧扩展；`path.includes('__message__:')` **不**当工作区批注恢复。  
5. 菜单项集合：编辑/复制/置位(user)/分叉/回滚；无 hide/delete。  
6. 常驻前缀 `assembleWorkplaceDisplay` 不动。  
7. 落库有 `action` 时恒满足 `name === attachmentStorageName(path)`（含消息批注伪 path）。  
8. **`runAgentTurn.userContent`** 不得含未剥离的消息批注 mention 展开短标签；剥离在 App `ChatComposer` 发送前完成；`@path` 扫描仅 Core 内对同一 `userContent` 执行；消息批注只走 `annotateDrafts`。
9. transcript 划词自定义 `menuItems` 须含「批注」+「复制」（对齐 `RICH_DOCUMENT_ANNOTATE_MENU_ITEMS`）；复制走系统剪贴板。

## 最终项目结构

```text
packages/core/src/domain/chat/
  model/
    annotate-draft.schema.ts          # 保留 AnnotateDraft.path 必填；新增 MessageAnnotateDraft；
                                      #   SendAnnotateDraft = AnnotateDraft | MessageAnnotateDraft
  logic/
    build-attachment-action-xml.ts    # builder 分派：文件形 / 消息形（伪 path=name）；
                                      #   消息形跳过破坏性 normalizePromptStorePath
                                      # parseAnnotateDraftsFromAttachments：仅真 VFS；
                                      #   path.includes('__message__:') 跳过
    chat-annotate-draft-store.ts      # 文件批注不变；chip 仅 path 草稿
    chat-message-annotate-draft-store.ts  # 新增：消息批注 Map + CRUD（含 removeMessageAnnotateDraft）
    composer-sendable-input.ts        # 布尔语义不变；App 侧或后传入 hasAnnotateDrafts
  …
  service/agent/logic/run-agent-turn.ts  # annotateDrafts?: readonly SendAnnotateDraft[]；
                                      #   trimmed=userContent.trim() → mergeAttachmentsWithScannedAtPaths(trimmed)
                                      #   （@path 扫描仅此；App 勿另调）

apps/mobile/src/
  storage/
    chat-annotate-draft.ts            # 既有 re-export
    chat-message-annotate-draft.ts    # 新增 re-export / 清+订阅
  components/chat/
    ComposerAtPathInput.tsx           # selection / selectionColor；第二 trigger（非 @；suggest 恒空）
    composer-at-path-mention.ts       # @path mention ↔ plain；消息批注 strip 辅助可落此或下列
    composer-message-annotate-mention.ts  # 新增：trigger/markup/plain；strip 消息批注 span
    ChatComposer.tsx                  # 发送前 strip → userContent；合并两类 → SendAnnotateDraft[]；
                                      #   append 双清；插 tag（@path 扫描在 Core runAgentTurn）
    ChatTranscriptWebView.tsx         # menuItems=批注+复制；onCustomMenuSelection；injectJS 上溯 messageId
    ChatTranscriptBridge.ts          # 选区批注 bridge：{ messageId, text }
    AttachmentDraftChips.tsx          # 断言消息批注不进 chip
  components/vfs/
    FileMarkdownPreview.tsx           # 同步 pathDrafts
    RichDocumentWebView.tsx           # 原子投递 / key={path}；RICH_DOCUMENT_ANNOTATE_MENU_ITEMS 对照
  web/rich-document/webview/runtime/
    bridge.ts / annotate.ts / main.ts # 文档就绪后 marks
  web/chat-transcript/
    ui/render/MessageRow.tsx          # 右上角 ⋯；点击传按钮 rect
    styles/transcript.css
    runtime/menu/menu.ts              # openContextMenuFromAnchor(messageId, DOMRect)；去长按主路径
    runtime/boot/bind-shell-events.ts
  screens/tabs/chat-tab/
    useChatTabMessages.ts             # Undo 恢复工作区批注（includes __message__: 跳过）
  theme/tokens.ts                     # selection / primaryMuted（可选）
```

## 变更点清单

| ID | 模块 | 变更 |
|----|------|------|
| C1 | `RichDocumentWebView` + bridge/main | `setDocument` 携带/紧随当前 annotations；`key={path}`；减少竞态 `setTimeout` |
| C2 | `FileMarkdownPreview` | path 变时同步 filter drafts（render 期派生或立即清空再写） |
| C3 | `FileEditorScreen`（可选） | path 变立即 loading，避免新 path+旧 content 一帧 |
| C4 | `ComposerAtPathInput` | 非全程受控 selection；柔和 `selectionColor`；第二 trigger（消息批注，非 `@`；`suggest` 恒空） |
| C5 | `tokens.ts` | 新增 `selection`（或等价） |
| C6 | Core `parseAnnotateDraftsFromAttachments` | 解析 `action===annotate` 且 **真 VFS path**（`!path.includes('__message__:')`） |
| C7 | `useChatTabMessages` Undo | snapshot→restore store+chips；跳过消息伪 path；保留 T-TX2 无 attach chip |
| C8 | transcript `MessageRow`+`menu.ts`+css | 右上角 ⋯；`openContextMenuFromAnchor(messageId, DOMRect)`（或扩展 MenuAnchor）；移除长按开菜单 |
| C9 | Core schema + builder + store | `MessageAnnotateDraft` + `SendAnnotateDraft`；builder 分派；伪 path=name；**消息形跳过破坏性 normalize**；chip API 忽略消息草稿 |
| C10 | `ChatTranscriptWebView` + `ChatTranscriptBridge` + Composer | **menuItems 对齐 `RICH_DOCUMENT_ANNOTATE_MENU_ITEMS`：须含「批注」+「复制」**；`copy`→系统剪贴板；`onCustomMenuSelection` → injectJS `getSelection` 上溯 **`.row.message.user[data-id]`** → `{ messageId, text }`；助手/失败取消录入；宿主 `role==='user'` 门闩；插/删消息批注 tag；删 tag→`removeMessageAnnotateDraft` |
| C11 | `ChatComposer` 发送/清空 | 两类草稿 → `SendAnnotateDraft[]`；App 侧 `hasAnnotateDrafts` 取或；append 双清；**发送前剥离消息批注 span → 所得 plain 作 `runAgentTurn.userContent`**（同串供 Core `mergeAttachmentsWithScannedAtPaths` 与落库；**勿** App 另调 scan） |
| C12 | 测试 | 见「测试策略」；含 T-MA5（`originalText` 含 `@/foo.md` 不误扫 attach）；划词复制自备 |

**明确不改**：Desktop UI；`assembleWorkplaceDisplay`；菜单项业务语义；assistant 置位；恢复 attach chip；Core `hasAnnotateDrafts` 布尔入参语义（仅 App 聚合传入）。

## 兼容性与迁移

- **Core schema**：文件 `AnnotateDraft.path` 保持必填；新增 `MessageAnnotateDraft`；`SendAnnotateDraft` 为联合。Desktop 继续只构造/传入文件形，编译通过。
- **落库附件**：历史消息仅含真 VFS `path` 的 annotate 仍可被 Undo 解析；新消息批注附件 `path`=`name`=`__message__:<messageId>:<draftId>`（可带前导 `/`）；Undo **本期只恢复工作区（真 VFS path）批注**，遇 `path.includes('__message__:')` 跳过；builder **不得**对伪 path 做破坏性 `normalizePromptStorePath`。
- **`messageAttachmentSchema`**：消息批注必须遵守「有 action ⇒ name === attachmentStorageName(path)」；伪 path 方案满足；**禁止**省略 path 却自定义 name。
- **WebView dist**：改 `rich-document` / `chat-transcript` 源后须 `build:webview`；Mobile `pretest` 已依赖。
- **无 DB migration**；批注草稿仍不进 `composer_draft_json`。

## 详细实现步骤

- Step 1 — phase-underline-sync — blocking: yes — qa: auto：`FileMarkdownPreview` path/session 变化时同步派生 `pathDrafts`（禁止仅依赖滞后 `useEffect` 一帧错配）；path 变可先清空 marks。
- Step 2 — phase-underline-bridge — blocking: yes — qa: auto：`RichDocumentWebView` 对 `setDocument`/`setAnnotations` 同批或文档渲染后强制带当前 annotations refresh；组件 `key={path}`（或 path+内容版本）；调整 `bridge`/`main` 避免空 marks 盖住最终帧。覆盖 T-UL1。
- Step 3 — phase-at-path-selection — blocking: yes — qa: auto：`ComposerAtPathInput` 改为短暂/非全程受控 `selection`（对照 `PromptMacroTextInput`）；保证 `replaceCommittedText`/`replaceActiveAt` 后 mention children 着色与 `tryAtomicMentionDelete` 可用；对外无 `{@}`。覆盖 T-AT1/T-AT2。
- Step 4 — phase-selection-color — blocking: yes — qa: auto：`selectionColor` 改为柔和 tint（token 或 `` `${primary}55` `` 类）；与 tag 字色/底可区分。覆盖 T-SC1。
- Step 5 — phase-undo-parse — blocking: yes — qa: auto：Core `parseAnnotateDraftsFromAttachments` + round-trip 测（build↔parse，新 id）；仅识别真 VFS `path` 的工作区 annotate；**跳过** `path.includes('__message__:')`（含 `/__message__:`）；消息形 builder **不做**破坏前缀的 `normalizePromptStorePath`。
- Step 6 — phase-undo-restore — blocking: yes — qa: auto：`useChatTabMessages` 在 undo_send 确认路径 **删消息前** snapshot；成功后写入 store + `refreshComposerAnnotateChips`；无 annotate 附件不造草稿；仍 `attachments:[]` 写 draft（无 attach chip）。覆盖 T-UD1/T-UD2/T-UD3。
- Step 7 — phase-msg-menu — blocking: yes — qa: auto：transcript `MessageRow` 右上角 ⋯；`menu.ts` 钉死 `openContextMenuFromAnchor(messageId, DOMRect)`（或扩展 `MenuAnchor`）；⋯ 点击传按钮 rect；移除长按开菜单；`buildMenuItems` 集合不变；legacy RN 列表同步 ⋯。覆盖 T-MN1/T-MN2。
- Step 8 — phase-msg-annotate-core — blocking: yes — qa: auto：`MessageAnnotateDraft` + `SendAnnotateDraft` + store；builder 分派产出伪 path=name 的 annotate 附件（XML JSON 含 `messageId`/`originalText`/`userAnnotation`；伪 path 跳过破坏性 normalize）；`runAgentTurn` concat；Desktop 仅文件形编译通过；chip API **忽略**消息草稿。覆盖 T-MA1/T-MA3。
- Step 9 — phase-msg-annotate-ui — blocking: yes — qa: auto：`ChatTranscriptWebView` + Bridge：自定义 `menuItems` =「批注」+「复制」（对齐 `RICH_DOCUMENT_ANNOTATE_MENU_ITEMS`）；`copy`→系统剪贴板；`onCustomMenuSelection` → injectJS 从 `getSelection()` 上溯 **`.row.message.user[data-id]`** → bridge `{ messageId, text }`；助手/失败取消录入；宿主录入 → store + 程序化插 tag（非 `@` trigger；`suggest` 恒空）；**`ChatComposer` 发送前剥离消息批注 span → plain 作 `runAgentTurn.userContent`**（Core 内对该串 `mergeAttachmentsWithScannedAtPaths`；App 勿另调 scan）；原子删 → `removeMessageAnnotateDraft`；**无** chip、**无**气泡下划线；append 成功清空。覆盖 T-MA2/T-MA4/T-MA5/T-MA7。
- Step 10 — phase-manual-android — blocking: no — qa: manual_user：Android 录屏：多文件下划线、`@path` tag、选中色、Undo 恢复批注、右上角菜单+划词复制、消息批注进模型（查看提示词）。

## 测试策略

- **自动**：`apps/mobile` Jest（`pretest` 含 core + webview build）；`packages/core` annotate/parse/send 单测。  
- **手工**：Step 10；不阻塞 CI 合并门禁。  
- **命令参考**：
  - `apps/mobile`: `npm test -- --testPathPattern="file-markdown-preview-annotate|composer-at-path|use-chat-tab-message-actions-rollback|message-action|chat-annotate|chat-transcript" --no-coverage`
  - `packages/core`: annotate-drafts-send + 新增 parse/message annotate 测

### 测试用例

- T-UL1 — blocking: yes — 同 session 对 `/a.md`、`/b.md` 各一条草稿；分别挂载/切换 preview 时，传给 WebView 的 `annotations` 仅为当前 path 且非空（→ Step 1–2）
- T-AT1 — blocking: yes — `mergeProgrammaticPlainIntoMentionValue` / 插入后 mention part 存在；`mentionValueToPlain` 无 `{@}`（→ Step 3）
- T-AT2 — blocking: yes — 原子删整段 `@/path`；手输纯文本不成 tag（既有口径）（→ Step 3）
- T-AT3 — blocking: yes — 仅 `@path` 不产生文件引用 attach chip / 不进状态 chip（硬合同非回归）（→ Step 3）
- T-SC1 — blocking: yes — `ComposerAtPathInput` 的 `selectionColor` ≠ `tokens.primary` 原色硬编码（或等于新 token）（→ Step 4）
- T-UD1 — blocking: yes — Undo 含 annotate 附件的 plain user → store 含对应 path 草稿 + chip 投影出现（→ Step 5–6）
- T-UD2 — blocking: yes — Undo 无 annotate 附件 → store 不新增批注；正文仍恢复；draft attachments 仍 `[]`（→ Step 6）
- T-UD3 — blocking: yes — Undo 附件 path 为 `__message__:…` **或** `/__message__:…`（`includes('__message__:')`）→ **不**写入文件批注 store；builder 伪 path round-trip 仍含 `__message__:` 子串（→ Step 5–6 / Step 8）
- T-MN1 — blocking: yes — `buildMessageActionItems` / Web `buildMenuItems` 集合仍为编辑/复制/置位(user)/分叉/回滚（→ Step 7）
- T-MN2 — blocking: yes — 存在右上角菜单入口接线（bridge/组件测或 DOM 契约）；⋯ 传按钮 rect；长按不再作为唯一/主开菜单路径（→ Step 7）
- T-MA1 — blocking: yes — 消息批注发送后 wrap/`attachments` 含 `annotate`；`path`===`name` 且 `path.includes('__message__:')`（形 `__message__:<messageId>:<draftId>` 或带前导 `/`）；XML JSON 含 `messageId`+原文+说明；**concat**；通过 `messageAttachmentSchema`（→ Step 8）
- T-MA2 — blocking: yes — 添加消息批注后 Composer 有 tag；`chipsFromAnnotateStore` / 状态条 **无**对应 `批注:` chip（→ Step 9）
- T-MA3 — blocking: yes — 仅消息批注时 App 侧 `hasAnnotateDrafts` 取或为 true，可触发可发门闩（→ Step 8–9）
- T-MA4 — blocking: yes — 删除 tag 后草稿消失（`removeMessageAnnotateDraft`）；append 成功后 tag+草稿清空（→ Step 9）
- T-MA5 — blocking: yes — **Given** 仅消息批注、且 `originalText` **含** `@/foo.md`（短标签展开后可见文案内嵌 `@`），**When** App 构造传给 `runAgentTurn` 的 `userContent`（= 剥离全部消息批注 mention span 后的 plain；同串供 Core `mergeAttachmentsWithScannedAtPaths` 与落库），**Then** **不得**新增 `source:attach`；批注仅经 `annotateDrafts` 进入发送管线；**禁止** App 另调 scan 双轨（→ Step 9）
- T-MA6 — blocking: yes — Desktop/Core 文件形 `buildAnnotateAttachmentFromDraft(AnnotateDraft)` 签名与调用仍编译通过；`SendAnnotateDraft` 联合不破坏既有文件路径（→ Step 8）
- T-MA7 — blocking: yes — 划词 `onCustomMenuSelection`：能从上溯 **`.row.message.user[data-id]`** 得到 `messageId` 时才写草稿；上溯失败 / 空选区 / **选区在 assistant** → **不**写 store、**不**插 tag；自定义 `menuItems` 含「批注」+「复制」，`copy` 写入系统剪贴板（→ Step 9）

## 风险与实现注

| 风险 / 注 | 缓解 | 回滚 |
|-----------|------|------|
| 下划线仍偶发（html 跨节点匹配） | 先修时序；验收钉「原文可匹配时」；匹配失败仍保留 chip（既有合同） | 保留 key={path} 最小改；匹配增强另开 |
| 受控 selection 方案 A 不足 | 升方案 B：自研分段（仿 PromptMacro） | revert Step 3 至 mentions 旧行为并记债 |
| Core schema 扩波及 Desktop 编译 | `SendAnnotateDraft` 联合；文件 API 签名不变；Desktop 只传文件形 | 仅 App 侧临时方案（不推荐） |
| 短标签内嵌 `@` 被全局 `scanAtPath` 扫中 | **已钉死主方案**：`ChatComposer` 发送前剥离 → `userContent`；Core 内对该串 merge 扫描；T-MA5（`originalText` 含 `@/foo.md`）；可选显示 `＠` 仅为辅；**禁止** App 另调 scan 双轨 | — |
| 落库省略 path 与 schema 冲突 | **已钉死方案 ②**：path=name=伪路径；禁止省略 path | — |
| 伪 path 被 `normalizePromptStorePath` 破坏 | **已钉死**：消息形 builder **跳过**破坏性 normalize；识别用 `includes('__message__:')` | — |
| 划词缺 messageId | **已钉死**：injectJS 上溯 `.row.message.user[data-id]`；助手/失败取消录入（T-MA7） | — |
| 划词自定义 menu 盖掉原生 Copy | **已钉死**：menuItems 对齐 `RICH_DOCUMENT_ANNOTATE_MENU_ITEMS`（批注+复制）；`copy`→系统剪贴板 | — |
| Undo 与并发未发送草稿膨胀 | 并存不丢；单测钉条数 | 可后续加去重策略 |
| **hasAnnotateDrafts** | **实现注**：App 侧两 store 取或传入 Core；**不**改 Core 布尔语义 | — |
| **消息批注 trigger suggest** | **实现注（P2）**：仅解析/程序化插入；`suggest` 恒空 | — |
| **E2E longPress** | 同步改 `apps/mobile/e2e/pageobjects/chat-transcript.page.ts`（⋯ 点击）；过渡期手工用 ⋯ | 文档注明手工用 ⋯ |
| Desktop 体验分叉 | PRD 已排除 | 另开 Desktop 迭代 |

**回滚**：按 phase 独立 revert；协议扩字段向前兼容时可保留 Core parse、仅关 Mobile UI 入口。
