---
date: 2026-07-19
---

# 批注与 user-ops 协议统一 技术规格（SPEC）

## 需求来源

- PRD：`Iterations/annotate-user-ops-unify/prd.md`
- 前置：`Iterations/message-attachment-unified/prd.md`（及 Feature `composer-ops-chip-lifecycle` / `composer-at-token-prompt-dedup`、Bug `composer-two-pipelines-hard-contract`）
- **局部 supersede**：`bugs/composer-ops-label-picker-typeahead` 中「ops chip = 英文 `action:path` 原样」→ 改为中文二字 `action:path`
- 探索依据：2026-07-19 四路只读探索（Composer chip / 提示词拼装 / 聊天工作区阅读栈 / schema+测试）

## 设计目标

1. **阅读态批注**：聊天工作区预览/阅读态可选区添加批注；下划线可见；可查看/编辑/删除；按 path 聚合一只不可叉状态 chip `批注:<path>`；用户消息 append 成功后清空。
2. **Chip 文案统一**：状态 chip（及消息气泡对应展示）统一为中文二字 + `:` + path；映射表单点在 Core。
3. **提示词增量统一**：本轮消息增量一律 `<user-ops>` + `<action name="…">` + JSON；废弃增量内层 `<workplace>` / `<attach>` / 旧 `<file>` 包裹（常驻前缀除外）。
4. **落库与展示分离**：附件存 `action` 枚举 + `path`（及批注业务字段）；禁止把展示 tag 当 `name` 真源。
5. **边界保持**：常驻前缀 `assembleWorkplaceDisplay` 不动；`@path` 不进状态 chip；不做旧英文/「规则 ·」/emoji 兼容。

## 总体方案

**定稿（P0-1 方案 A + annotateDrafts 入参）**：批注真源在 **App 模块级会话 Map**；状态条由 **App 渲染层合并**；发送时由 App 把 `annotateDrafts` 显式传入 Core。**禁止** Core / `projectComposerStatusAttachments` 自行读取 App `Map`；**禁止** `replaceComposerStatusAttachments` 整表替换时把 annotate chip 写进投影结果（否则会被 workplace/user_ops 重投影冲掉）。

```text
┌─ 回合态真源（App 模块级会话 Map，不进 composer_draft_json）────────┐
│ annotateStore[sessionId]: AnnotateDraft[]                         │
│   { id, path, originalText, userAnnotation }                      │
│   Mobile 仿 chat-composer-draft；Desktop 跨 PreviewPane 共享 Map  │
└───────────────────────────────────────────────────────────────────┘
         │
         ├─【状态条投影 · App 合并】─────────────────────────────────┐
         │  Core: projectComposerStatusAttachments → workplace∪ops │
         │  App:  statusBar = projected ∪ annotateStore→chip(按path)│
         │  replaceComposerStatusAttachments：仅替换 projected 半边；│
         │    **永不**把 annotate 写入/指望 Core 投影保留            │
         └──────────────────────────────────────────────────────────┘
         │
         ├─【发送 · annotateDrafts 入参】────────────────────────────┐
         │  App → runAgentTurn({ …, annotateDrafts })               │
         │  Desktop：AgentRunRequest.annotateDrafts → main 透传     │
         │  Core：materialize ∪ flush ∪ @扫描 ∪ annotateDrafts      │
         │  annotate：**concat** 追加（禁 mergeAttachmentsByPath）   │
         │  （Core 不读 App Map；无 consumeSessionAnnotates）        │
         └──────────────────────────────────────────────────────────┘
│ append 成功（onUserMessageAppended）
│  Mobile：同进程回调内清 store
│  Desktop：回调 → IPC push `nm:agent/userMessageAppended {sessionId}`
│           （IPC_CHANNELS.AGENT_USER_MESSAGE_APPENDED）
│           → renderer 订阅后清 store（**禁止** `started:true` 清）
         ▼
┌─ App 清 annotateStore + 重投影状态条（失败不丢批注）──────────────┐
└───────────────────────────────────────────────────────────────────┘
         │ prepare + wrap（内存）
         ▼
┌─ 提示词增量（可保留外层 <attachment>）────────────────────────────┐
│ <attachment>                                                      │
│   <user-ops>                                                      │
│     <!-- 顺序钉死：attach → workplace → user_ops/annotate -->     │
│     <action name="userAttach|workplaceChange|write|…|annotate">  │
│     { JSON }  <!-- content=行号正文；mtime/createdAt 不进 JSON --> │
│     </action>                                                     │
│   </user-ops>                                                     │
│ </attachment>                                                     │
│ <user-input>…</user-input>                                        │
│ 常驻前缀：assembleWorkplaceDisplay 仍独立注入（本期不动）          │
└───────────────────────────────────────────────────────────────────┘
```

### Chip 映射 API（定稿）

Core 导出（`@novel-master/core/chat`）：

| API | 职责 |
|-----|------|
| `formatStatusChipLabel(action, path)` | 已知枚举 → 中文二字 + `:` + path |
| `formatStatusChipLabelFromAttachment(a)` | 从附件读 `action`/`path`（及 rename 的 `to`）生成 chip 文案；**无 `action` 时走降级** |

**无 `action` 降级规则（明确不做英文 /「规则 ·」/ emoji 兼容）**

1. `source === "workplace"` → 按 `规则:<path>` 展示（path 取 `a.path` 或可解析的非展示 `name`）。
2. 若 `name`（或等价字段）可解析为旧 `write:/…`、`edit:/…` 等 `^\w+:/` 形态 → 将前缀映射为对应中文二字（`write→创建`、`edit→编辑`、`delete→删除`、`mkdir→建目`、`rename→重命`），后缀作 path。
   - **`rename` 特例（P2-D3）**：若后缀含 `→`（或现网等价分隔符），chip path **取右侧**（目标 path），即 `重命:<to>`；左侧 `from` 不进 chip。无 `→` 时整段后缀作 path。
3. 否则 → 仅展示 `path`（或 `name` 若已是纯 path）；**不**原样回退英文 `action:path`、不拼「规则 ·」、不加 emoji。
4. **历史不保证**：缺 `action` 且无法按上列解析的旧串，允许降级为裸 path/`name`；**不**承诺与发送当时 chip 文案逐字一致。

### 协议与映射（定稿默认）

| 英文 `action` | 中文 chip 二字 | JSON 要点 | 状态 chip？ |
|---------------|----------------|-----------|-------------|
| `delete` | `删除` | path 等（现网） | 是 |
| `write` | `创建` | path, content | 是 |
| `edit` | `编辑` | path, content | 是 |
| `mkdir` | `建目` | path | 是 |
| `rename` | `重命` | from, to；chip path 取 `to` → `重命:<to>` | 是 |
| `workplaceChange` | `规则` | `path`, `content`（首次加载全文等；见下 JSON 钉死） | 是（差集投影） |
| `userAttach` | —（**不进**状态 chip） | 见下 | 否（正文 `@`） |
| `annotate` | `批注` | `path`, `originalText`, `userAnnotation` | 是（按 path 聚合） |

**`userAttach` / `workplaceChange` JSON（P1 钉死；证据：`prepare-user-messages-for-prompt.ts` / `prompt-path-seen.ts` / `worktree-display.renderFileBlock`）**

| 钉死项 | 定稿 |
|--------|------|
| **`content` 正文形态** | **行号正文**（与现网 `renderFileBlock` **标签内正文**同形：`N\|line`；`filename` 档为 `1\|basename`；`header` 档为 front-matter 行号正文，见对照表）。**不**采用「原始无行号正文」——以免增量与常驻前缀行号口径漂移。 |
| **`mtime` / `createdAt`** | **不进 JSON**。旧 `<file>` 的 `createdAt` / `updatedAt` / `updatedBy` / `mtimeMs` 属性随增量内层 `<file>` 一并废弃；常驻前缀 `assembleWorkplaceDisplay` 仍可保留其 `<file>` 属性（本期不动）。 |
| **短提示** | `alreadyReferenced: true`；**省略** `content`（不要求把「该文件前文已引用…」塞进 `content`）。 |
| **目录树** | `kind: "dirTree"`；`content` = ASCII 树正文（**无**外层 `<dir>` 包裹）。 |
| **workplace 非首次** | 现网 hydrate 后 `content: ""`、wrap 省略；新协议同语义：可省略该 action，或 JSON 无 `content` / 空串且 wrap 跳过。 |

**旧 XML → 新 JSON 对照（各一例）**

| 场景 | 旧（增量内层） | 新（`<action>` 内 JSON；外包 `<action name="…">`） |
|------|----------------|-----------------------------------------------------|
| **全文 `full`** | `<file path="/a.md" createdAt="…" updatedAt="…" updatedBy="user">\n1\|hello\n2\|world\n</file>` | `userAttach` / `workplaceChange`：`{"path":"/a.md","content":"1\|hello\n2\|world","display":"full"}` |
| **`filename` 档** | `<file path="/b.md" createdAt="…" …>\n1\|b.md\n</file>` | `{"path":"/b.md","content":"1\|b.md","display":"filename"}` |
| **`header` 档** | `<file path="/c.md" createdAt="…" …>\n1\|title: x\n</file>`（front-matter **正文行**行号化；**不含** `---` 定界符；证据：`parseMarkdownFrontMatter` / `renderFileBlock` `display:"header"`） | `{"path":"/c.md","content":"1\|title: x","display":"header"}`（`workplaceChange` 常见；与常驻前缀同形） |
| **非首次短提示** | `<file path="/a.md">该文件前文已引用，无需读取或加载</file>` | `{"path":"/a.md","alreadyReferenced":true}`（无 `content`） |
| **目录树** | `<dir path="/notes">\nnotes/\n├── sub/\n└── a.md\n</dir>` | `{"path":"/notes","content":"notes/\n├── sub/\n└── a.md","kind":"dirTree"}` |

**落库 `MessageAttachment` wire（扩展）**

```ts
{
  name: string;           // 钉死：name = path；空 path → "__no_path__"；禁止存「创建:/x」展示 tag
  source: "workplace" | "attach" | "user_ops"; // 管道路由暂保留
  type: "text" | "image" | "dir";
  content: string | null; // 发送后：action XML；chip 预览可为 null
  path?: string;
  action?: MessageAttachmentAction; // 新增：枚举真源
  // annotate 业务字段（仅 action=annotate 时有意义；亦可只放在 content JSON 内——推荐 content 为 action XML，与手改一致）
}
```

- **推荐**：所有增量在落库后 `content` 均为 `<action name="…">` + JSON（与现网 user_ops 一致）；`action` + `path` 为结构化索引。
- **落库 `name` 钉死（P2）**：`name = path`（有非空 `path` 时与 `path` 逐字相同）；`path` 缺省或空串时 `name = "__no_path__"`（稳定占位，满足 schema `min(1)`）。**UI 永不把 `name` 当 chip 文案真源**（chip 走 `formatStatusChipLabelFromAttachment`）。
- **annotate 落库约定（P2-1）**：`source: "user_ops"` + `action: "annotate"`（沿用 user_ops 管道；不新增第四 source）；`name = path`（同上）。
- **历史消息**：无 `action` 时按上方 `formatStatusChipLabelFromAttachment` 降级，**不**承诺英文/`规则 ·`/emoji 回退。

**`source` 路由（发送管线暂保留三分，避免一次改光 materialize）**

| source | 典型 action | 状态条 |
|--------|-------------|--------|
| `workplace` | `workplaceChange` | 是（Core 投影） |
| `user_ops` | write/edit/mkdir/delete/rename/**annotate** | 是（手改 Core 投影；**annotate 仅 App 合并进状态条**） |
| `attach` | `userAttach` | 否 |

**Wrap 层 action 顺序（钉死，相对现网 section 序有意调整）**

- Wrap **忽略**内层三段标签，把所有非空 attachment 的 action XML 拼进单一 `<user-ops>`。
- **固定顺序**：`userAttach`（attach）→ `workplaceChange`（workplace）→ 手改类 `user_ops` ∪ `annotate`。
- 说明：现网 wrap 按 source 三段（workplace / attach / user_ops）输出；本期改为单一 `<user-ops>` 后，**故意**把 attach 提前，以与现网同 path 时 attach 胜出的 seen 语义对齐。T-PR1 断言该顺序。

### 批注生命周期

1. **划词入口限定（P1-D2）**：
   - **模式**：仅 Mobile `previewMode===true` / Desktop `mode==="read"`；编辑态禁用。
   - **工作区 scope（钉死）**：
     - Desktop：**仅** `workspaceScope === "chat"`（聊天会话工作区）提供批注入口；`global` / `session`（及非 chat 面板）**无入口**。
     - Mobile：**仅** `scopeKind === "session"` 提供批注入口；`project` / `global` **无入口**。
   - 与 PRD「非聊天会话工作区无入口、不验收」一致：其它 scope 打开同一预览组件时亦不得露出划词/添加批注 UI。
2. **数据真源**：`AnnotateDraft` 存 **App 双端模块级会话 Map**（Mobile 仿 `chat-composer-draft`；Desktop 不宜仅 ConversationPanel 局部 state——若 PreviewPane 跨层读写，须模块级 Map 共享）；**不写** `composer_draft_json`；**Core 不持有** annotate store。
3. **状态条（方案 A）**：
   - Core `projectComposerStatusAttachments` / `buildComposerStatusAttachments` **只**投影 workplace + user_ops 手改；**不**接收、不合并 annotate。
   - App 渲染：`statusBarAttachments = replace(projected) ∪ chipsFromAnnotateStore(sessionId)`（按 path 去重一只 `批注:path`；`isComposerStatusAttachment` 对 annotate 预览为真）。
   - 任意规则变更 / flush 后的整表 `replaceComposerStatusAttachments` **只替换 projected 半边**，随后再 ∪ annotate chips；**禁止**假设 Core replace 会保留批注 chip。
   - **「replace 后再 ∪ annotate」合流点（P1，双端必须改）**：

     | 端 | 必须改的 wrapper / 位点 | 现网行为 → 本期 |
     |----|-------------------------|-----------------|
     | **Mobile** | `applyComposerStatusAttachmentsReplace`（`apps/mobile/src/storage/chat-composer-draft.ts`） | 现网：`replaceComposerStatusAttachments(prev, projected)` 写回 draft。本期：replace **之后**再 `∪ chipsFromAnnotateStore(sessionId)`，再写回 / notify；**禁止**只 replace 不合并。 |
     | **Desktop** | ① `ChatComposer` 内 `onComposerAttachmentsSuggest` 订阅（通道 `nm:composer/attachmentsSuggest` / `COMPOSER_ATTACHMENTS_SUGGEST`）；② send 后 `ipcSessionsProjectComposerStatus` reproject（同文件内 `replaceComposerStatusAttachments`） | 两处现网均整表 replace projected。本期：每次 replace 后必须再 ∪ annotate chips 再 `onAttachmentsChange`；**禁止**只改其一。 |
     | **Desktop** | ③ `ConversationPanel` 会话 draft/status **水化** `useEffect`（`sessionId` 变化；证据：`ConversationPanel.tsx` 内 `ipcSessionsGetComposerDraft` + `ipcSessionsProjectComposerStatus` 后 `replaceComposerStatusAttachments([], status)`） | 现网：水化后整表 replace 写 `setComposerAttachments`。本期：replace **之后**再 `∪ chipsFromAnnotateStore(sessionId)` 再 set；**禁止**只 replace——否则切会话再回来会冲掉仍在 store 中的批注 chip（store 未清）。 |

4. 删光某 path 批注 → App 立刻重算合并结果，该 chip 与下划线消失。
5. **发送契约（唯一默认：`annotateDrafts` 入参）**：
   - App 调用 `runAgentTurn({ …, annotateDrafts })`，将本会话未发送草稿数组传入；Desktop 经 `AgentRunRequest.annotateDrafts` → main `handleAgentRun` / `agent-run.service` 原样透传至 `runAgentTurn`。
   - Core 将每条草稿物化为 `source:"user_ops"` + `action:"annotate"` 附件并入 `mergedAttachments`。
   - **annotate 并入钉死（P1-A）**：对 annotate 附件一律 **`concat` 追加**；**禁止** `mergeAttachmentsByPath(base, annotateAtts)`（或任何按现网 `attachmentDedupeKey` 的 `path:` 与已有条去重合并）。现网有 path 的附件按 `path:` 去重，同 path 多条 annotate 若走 path 去重会**静默丢条**。同 path 多条均须进落库 `attachments` 与 wrap `<user-ops>`；**发送前**状态条按 path 聚合一只 `批注:path`（与落库条数解耦）；**append 成功后** chip 清空（与 T-AN3 / PRD 一致）。
   - **不可**只塞 UI attachments 预览（现网会丢弃非 attach）。
   - **删除并列方案**：不采用 `consumeSessionAnnotates(sessionId)`；Core 无 session 侧 annotate API。
6. **清空时机与 Desktop IPC 桥（P0-D1，定稿）**：

   **现网事实（对照，勿误用）**

   | 事实 | 含义 |
   |------|------|
   | `handleAgentRun` **立即**返回 `{ ok:true, data:{ started:true } }`，**不** `await` turn | IPC invoke 成功 ≠ 用户消息已 append |
   | event bus 转发仅有 `RUN_STARTED` / `RUN_FINISHED` / `RUN_FAILED` + stream 类事件 | **无**「user 已 append」推送；`FINISHED` 晚于整次 run，不能当 append 成功信号 |
   | Desktop `ChatComposer` 在 `ipcAgentRun` ok（=`started`）后即可清输入正文 | 若同路径清 `annotateStore`，会在 append **之前**丢草稿，违反「失败不丢」 |

   **Mobile（现成对齐）**：同进程调用 `runAgentTurn({ onUserMessageAppended })`；回调内清 annotate + 重投影。

   **Desktop 契约（必须实现）**

   1. `handleAgentRun` 调 `runAgentTurn({ …, annotateDrafts, onUserMessageAppended })`（透传草稿；回调挂在 main）。
   2. 在 `onUserMessageAppended` 内向 renderer **push** 新 IPC（**定名钉死**，对齐现网 `IPC_CHANNELS` 的 `nm:` 风格）：
      - 常量：`IPC_CHANNELS.AGENT_USER_MESSAGE_APPENDED`
      - 通道名：`nm:agent/userMessageAppended`
      - payload：`{ sessionId: string }`
      - 须进 `ipc-types`（通道常量 + payload 类型）；**不得**复用 `RUN_*` / `COMPOSER_ATTACHMENTS_SUGGEST`。
      - **推荐路径（钉死优先）**：在 handler / `agent-run.service` 的 `onUserMessageAppended` 回调内直接 `webContents.send`（仿现网 suggest forwarder：`forward-composer-attachments-suggest.ts` 的 `notifyComposerAttachmentsSuggestToRenderer` / `getTargetWebContents?.()?.send`）。可抽薄封装（如 `notifyUserMessageAppendedToRenderer`），**不要求**挂进 `forward-event-bus`。
      - **非必须**：`forward-event-bus.ts` 增转发项；`agent-event-types.ts` 生成 `USER_MESSAGE_APPENDED` 事件常量。二者可选，**不得**当作本期阻塞项。
   3. Renderer **仅**在收到该事件且 `sessionId` 匹配时：清 `annotateStore` + 重投影状态条（∪ 后无批注 chip）。
   4. **分轨（钉死）**：
      - **annotate**：**禁止**在 `started: true` / `ipcAgentRun` ok 时清空；**必须**等上述 append 成功推送。
      - **正文 / 普通 projected 状态 chip**：可保持现网「`started` 后按 `shouldClearComposer` 清空」；亦可一并改为等 append——实现任选，SPEC **不强制**改 text 时序；与 annotate **不得**绑死同一清空时机。
   5. append 失败、早退未 append、或从未收到 `nm:agent/userMessageAppended`：**保留** annotate（标记 + chip）。整次 run `FINISHED`/`FAILED` **不得**单独作为清 annotate 的充分条件。

7. **空发门闩（与现网硬门闩闭环，P0-2 / P1-B）**：

| 位点 | 变更 |
|------|------|
| `runAgentTurn` `hasInput` | `hasInput \|= (options.annotateDrafts?.length ?? 0) > 0` |
| `runAgentTurn` `shouldAppendNewUser` | 同上：`annotateDrafts.length > 0` 时须 append（与 workplace/pending 并列） |
| **空续跑 re-append（P1）** | **有 `annotateDrafts.length > 0` 时禁止走空续跑 re-append**。现网 `prepareUserVfsTurnForAgentRun` 在 `trimmedInput===""` + `allowResumeWithoutInput` + pending 时会 delete→flush→re-append 末条 user，且 merge **不含** annotate；仅批注 / 正文为空 + 有草稿时若仍走该路径会丢批注或误改末条。钉死：`annotateDrafts` 非空 → 本轮必须走**新 append**（concat annotate）；`prepareUserVfsTurn` **不得**因空正文删末条；`runAgentTurn` 不得在此情况下把本轮 annotate 仅依赖 re-append merge。 |
| `hasComposerSendableInput` | 增可选 `hasAnnotateDrafts?: boolean`；为 true 时可发（允许只发批注、无正文） |
| Desktop `resolveComposerSendIntent` | **`apps/desktop/renderer/features/chat/composer-send-intent.ts`** 须把 `hasAnnotateDrafts` 透传进 `hasComposerSendableInput`；**只改 Core 不够**——intent 层漏传则仅批注仍 `sendDisabled` |
| Mobile Composer | `ChatComposer`（无独立 intent 模块）调用 `hasComposerSendableInput` 时同样传入 `hasAnnotateDrafts` |
| Desktop IPC 请求 | `AgentRunRequest` + `annotateDrafts?`；main / `agent-run.service` 透传；renderer 发送时带上 store 快照 |
| Desktop IPC 推送 | `onUserMessageAppended` → **`nm:agent/userMessageAppended` `{ sessionId }`**（`IPC_CHANNELS.AGENT_USER_MESSAGE_APPENDED`）；renderer 仅此清 annotate |
| App UI | Mobile：`onUserMessageAppended` 清 store；Desktop：订阅 push 清 store；**禁止** `started` 清 annotate |

对照现网：`run-agent-turn.ts`（`hasInput` / `shouldAppendNewUser` / `onUserMessageAppended`）、`prepare-user-vfs-turn-for-agent-run.ts`（空续跑 re-append；**有 annotateDrafts 时禁入**）、`composer-sendable-input.ts`、`composer-send-intent.ts`（Desktop）、`ipc-types.ts` `AgentRunRequest`、`handlers/agent.ts` `handleAgentRun`（立即 `started`）、`agent-run.service.ts`、`forward-composer-attachments-suggest.ts`（suggest 回调内 `webContents.send`——append 推送推荐同模式；`forward-event-bus` 现仅 RUN_* + stream，**非必须**挂 append）、`scan-at-path-attachments.ts`（`mergeAttachmentsByPath` / `attachmentDedupeKey`——**勿用于 annotate**）、Mobile `applyComposerStatusAttachmentsReplace`、Desktop `ChatComposer` suggest 订阅 + send 后 reproject、`ConversationPanel` 会话 draft/status 水化 `replaceComposerStatusAttachments`。

### 选区与锚点策略

- 落库/提示词以 **`originalText` + `userAnnotation` + `path`** 为准；**不**要求稳定字符 offset（Markdown 渲染树难映射）。
- UI 下划线：在预览渲染层按原文片段做尽力匹配高亮；重复片段时高亮全部可见匹配（测试固定此行为）。
- 用户切到编辑态改正文导致原文找不到：保留批注条目与 chip，预览高亮降级为「无下划线但仍可从 chip/列表打开」；不自动删除（PRD 未要求自动失效）。

### Desktop 划词最小方案（P1-2）

| 项 | 定稿 |
|----|------|
| 入口 | PreviewPane `mode==="read"` **且** `workspaceScope==="chat"`；编辑态 / `global` / `session` scope **无入口** |
| 选区 | `window.getSelection()`（或等价 DOM Selection）取得选中纯文本 |
| UI | 选区后出现浮动条「添加批注」→ 输入说明 → 写入 annotateStore |
| 下划线 | 按 `originalText` 在预览 DOM/渲染结果中做原文匹配高亮（尽力；重复则全部匹配） |
| 改删 | 点击下划线打开详情：编辑说明 / 删除 |
| **验收文件类型** | **与 Mobile 同验收**：聊天会话工作区可读预览的 **Markdown（`.md`）与纯文本（`.txt`）** 均须划词批注可用；其它预览类型若现网无正文选区能力，**本期不单独验收**（不阻塞协议/chip） |
| **scope 验收** | 仅 chat 会话工作区；打开 global/session（Desktop）或 project/global（Mobile）预览时无划词批注入口（T-MAN1） |

## 最终项目结构

```text
packages/core/
  domain/chat/model/
    message-attachment.schema.ts     # + action 枚举；校验规则
    annotate-draft.schema.ts         # 新增（回合态 TS 类型；供 RunAgentTurnOptions）
  domain/chat/logic/
    status-chip-label.ts             # 新增：映射 + formatStatusChipLabel(+FromAttachment)
    project-composer-status-attachments.ts  # 仍只投影 workplace+user_ops；不合并 annotate
    build-user-ops-attachment.ts     # name 不再写 action:path 展示串；annotate 构造
    synthesize-user-vfs-flush-actions.ts    # formatUserOpsActionLabel 退役或改内部用
    wrap-user-message-for-llm.ts     # 单一 <user-ops>；顺序 attach→workplace→ops/annotate
    prepare-user-messages-for-prompt.ts     # hydrate → workplaceChange/userAttach action XML
    build-attachment-action-xml.ts   # 新增或扩展：三类新 action 构建
    composer-sendable-input.ts       # + hasAnnotateDrafts?
    scan-at-path-attachments.ts      # mergeAttachmentsByPath / attachmentDedupeKey：**annotate 禁止走 path 去重**
    prompt-path-seen.ts              # 短提示改为字段，不再产出增量用 <file>
  public/chat.ts                     # 导出映射与类型
  service/agent/logic/run-agent-turn.ts     # annotateDrafts 入参；hasInput/append 门闩；有草稿禁空续跑 re-append；annotate **concat**
  service/agent/logic/prepare-user-vfs-turn-for-agent-run.ts  # 有 annotateDrafts 时不得 delete+re-append 末条

apps/desktop/
  shared/ipc-types.ts                # AgentRunRequest.annotateDrafts?；MessageAttachmentDto + action
                                     # + AGENT_USER_MESSAGE_APPENDED: 'nm:agent/userMessageAppended'
  shared/agent-event-types.ts        # **非必须**：若走事件常量可加 USER_MESSAGE_APPENDED（勿复用 RUN_*）
  src/main/ipc/handlers/agent.ts     # annotateDrafts 透传；onUserMessageAppended → webContents.send nm:agent/userMessageAppended
  src/main/services/agent-run.service.ts  # 若经 service 调 runAgentTurn：须透传 annotateDrafts + 回调内 send
  src/main/ipc/forward-composer-attachments-suggest.ts  # **仿照对象**：suggest 用 webContents.send；append 推送同模式（可抽 notify*）
  src/main/ipc/forward-event-bus.ts  # **非必须**：不要求挂入；现网仅 RUN_*+stream，append 清 annotate 走回调 send 即可
  renderer/layout/PreviewPane.tsx    # read 态 + workspaceScope==="chat"：getSelection + 浮动条 + 下划线
  features/chat/
    composer-send-intent.ts          # **须透传 hasAnnotateDrafts**（P1-B；只改 Core 不够）
    AttachmentDraftChips.tsx         # formatStatusChipLabelFromAttachment；App 合并 annotate chip
    MessageAttachmentGroupCard.tsx   # 气泡同口径
    ConversationPanel.tsx
      # **合流点③**：会话 draft/status 水化 useEffect 内 replace 后再 ∪ annotate
    ChatComposer.tsx
      # 模块级 annotate store（跨 PreviewPane）；发送带 annotateDrafts；
      # resolveComposerSendIntent({ hasAnnotateDrafts })；
      # **仅**订阅 nm:agent/userMessageAppended 清 annotate（禁止 started 清）；
      # text 可保持 started 清；
      # **合流点①②**：suggest 订阅 + send 后 reproject 两处 replace 后再 ∪ annotate

apps/mobile/src/
  services/agent-run.service.ts      # annotateDrafts 透传（若经 service）
  components/vfs/
    FileMarkdownPreview.tsx
    RichDocumentBridge.ts            # + selection / annotate 消息
    rich-document/...                # WebView 选区、下划线、点击
  screens/stack/FileEditorScreen.tsx # 仅 previewMode 且 scopeKind==="session" 挂入口
  components/chat/
    AttachmentDraftChips.tsx         # App 合并 annotate chip
    ChatComposer.tsx                 # annotateDrafts；hasComposerSendableInput({ hasAnnotateDrafts })；onUserMessageAppended 清 store
  storage/chat-composer-draft.ts     # **合流点**：applyComposerStatusAttachmentsReplace 内 replace 后再 ∪ annotate
  storage/chat-annotate-draft.ts     # 新增模块级会话 Map（仿 chat-composer-draft）
  .../webview/.../row-logic.ts       # 气泡去掉 emoji，改中文映射
```

**明确不改**：`assemble-workplace-display.ts`、前缀 `renderFileBlock` 注入路径、`composer-two-pipelines` 的 `@` 不进 chip 合同。

## 变更点清单

| # | 区域 | 变更 |
|---|------|------|
| 1 | Core schema | `messageAttachmentSchema` 增 `action` 可选/逐步必填（新写入必填）；`name` 钉死 `= path`（空 → `__no_path__`）；停写展示 tag |
| 2 | Core 映射 | `STATUS_CHIP_ZH` + `formatStatusChipLabel` + `formatStatusChipLabelFromAttachment`（含无 action 降级；rename 后缀含 `→` 取右侧）；导出 `@novel-master/core/chat` |
| 3 | 状态投影 | Core 仍只投影 workplace/user_ops；**App** 合并 annotate chip；Mobile `applyComposerStatusAttachmentsReplace` + Desktop suggest/reproject/**ConversationPanel 会话水化** **replace 后再 ∪ annotate** |
| 4 | 落库构造 | `buildUserOpsAttachment*` / workplace materialize / **annotateDrafts→annotate** 写 `action`+`path`+`name=path`；annotate 用 `source:user_ops` |
| 5 | Wrap/Prepare | 增量统一 `<user-ops>`；顺序 attach→workplace→user_ops/annotate；`userAttach`/`workplaceChange` JSON：`content`=行号正文（含 `display` full/filename/**header**），mtime/createdAt 不进 JSON；保留外层 `<attachment>` |
| 6 | runAgentTurn + 门闩 | `annotateDrafts` 入参；`hasInput`/`shouldAppendNewUser` 计入；**有 annotateDrafts 禁止空续跑 re-append**；`hasComposerSendableInput.hasAnnotateDrafts`；Desktop intent 透传；IPC / `agent-run.service` 透传 |
| 7 | annotate 并入 + Chip/气泡 | annotate **concat** 并入落库/wrap，**禁止** path 去重；删除「规则 ·」、英文 `name` 直出、Mobile emoji 规则文案；走 FromAttachment |
| 8 | 批注 UI | Desktop：Preview read **且** `workspaceScope==="chat"`；Mobile：preview **且** `scopeKind==="session"`；编辑态/其它 scope 无入口；md/txt 同验收 |
| 9 | 清空时机 + Desktop 桥 | 双端：append 成功清 annotate；失败不丢。Desktop：**定名** `nm:agent/userMessageAppended`（`AGENT_USER_MESSAGE_APPENDED`）；推荐回调内 `webContents.send`（仿 suggest）；`forward-event-bus` **非必须**；**禁止** `started:true` 清 annotate（与 text 可分轨） |
| 10 | 测试 | 翻 T-UI1 / T-HC5 / T-AT* / T-PD* / T-WP1 等旧断言；新增批注与协议用例；**T-AN3/T-AN5** 含 Desktop「started 不清 / `nm:agent/userMessageAppended` 才清 / 失败保留」；**T-AN6** 发送前一只 chip、落库/wrap 两条、append 后清空；T-AN4 含 intent 透传；T-MAN1 含 scope 无入口 |

## 详细实现步骤

- Step 1 — phase-action-schema — blocking: yes — qa: auto：扩展 `messageAttachmentSchema`（+ IPC DTO）增加 `action` 枚举（含 `annotate` / `workplaceChange` / `userAttach` 与手改五类）；新写入 `name = path`（空 → `__no_path__`），禁止 `name` 为 `^\w+:/` 展示形态；单测 round-trip。
- Step 2 — phase-chip-zh-map — blocking: yes — qa: auto：新增 Core `formatStatusChipLabel` + `formatStatusChipLabelFromAttachment`（无 action 降级如上）；双端 Composer chip + Desktop/Mobile 气泡改用之；删除「规则 ·」与 emoji 规则文案；翻 T-UI1 / T-HC5 / Mobile chips 测例；T-CHIP1 含 `重命:<to>`。
- Step 3 — phase-persist-no-display-tag — blocking: yes — qa: auto：`formatUserOpsActionLabel` / `userOpsAttachmentsFromSummaries` / workplace materialize 改为写 `action`+`path`，`name=path`（空 → `__no_path__`）；预览 chip `content:null` 仍可投影；单测断言落库无 `write:/`。
- Step 4 — phase-prompt-unify-user-ops — blocking: yes — qa: auto：`prepare` hydrate 产出 `workplaceChange` / `userAttach` action XML；JSON `content`=行号正文、mtime/createdAt 不进 JSON；短提示 `alreadyReferenced`、目录树 `kind:dirTree`、**含 `display:"header"` 档**（T-PR2 对照表）；`wrap` 仅输出单一 `<user-ops>`（可保留外层 `<attachment>`）；**action 顺序 attach→workplace→user_ops/annotate**（T-PR1）；翻 T-AT* / T-TX* / T-PD*；断言增量中不再出现内层 `<workplace>`/`<attach>`/旧 `<file>` 包裹。
- Step 5 — phase-prefix-regression — blocking: yes — qa: auto：常驻前缀仍走 `assembleWorkplaceDisplay`；同源查看提示词/发送测例确认前缀形态与现网一致（允许仍含前缀 `<file>`）。
- Step 6 — phase-annotate-store — blocking: yes — qa: auto：**App** 双端**模块级会话 Map** annotate store + CRUD（Mobile 仿 `chat-composer-draft`；Desktop 跨 PreviewPane，勿仅 ConversationPanel 局部 state）；状态条 = Core `projectComposerStatusAttachments` ∪ store→chip（按 path 聚合一只 `批注:path`）；**合流点**：Mobile 改 `applyComposerStatusAttachmentsReplace`；Desktop 改 suggest 订阅 + send 后 reproject + **`ConversationPanel` 会话水化**——均须 replace 后再 ∪ annotate（断言不被冲掉；切会话再回来 chip 仍在）；`hasComposerSendableInput({ hasAnnotateDrafts })`；**Desktop `resolveComposerSendIntent` 须透传 `hasAnnotateDrafts`**（`composer-send-intent.ts`）；Mobile `ChatComposer` 同传；删光撤 chip。**Core 投影函数不接收 annotate。**
- Step 7 — phase-annotate-send — blocking: yes — qa: auto：`RunAgentTurnOptions.annotateDrafts`；`hasInput`/`shouldAppendNewUser` 计入 length>0；**有 annotateDrafts 时禁止空续跑 re-append**（须新 append + concat）；物化为 `source:user_ops`+`action:annotate`+`name=path`；**并入用 concat，禁止 `mergeAttachmentsByPath`/path 去重**（同 path 多条均进落库与 wrap；T-AN6）；Desktop `AgentRunRequest.annotateDrafts` + main / `agent-run.service` 透传；**Desktop P0-D1**：`handleAgentRun` 挂 `onUserMessageAppended` → **回调内 `webContents.send`** **`nm:agent/userMessageAppended` `{ sessionId }`**（仿 suggest forwarder；`forward-event-bus` / `agent-event-types` **非必须**）；renderer **仅**该事件清 annotate + 重投影；**断言禁止**在 `started:true` 清 annotate；wrap 含 JSON；失败/未 append 保留；单测 T-AN3 / T-AN5 / T-AN6（含 Desktop 位点）；门闩回归含 `resolveComposerSendIntent` 透传（T-AN4）。
- Step 8 — phase-annotate-ui-mobile — blocking: yes — qa: auto：Mobile 预览态选区→添加→下划线→点击改删；**仅** `scopeKind==="session"`；`project`/`global` 无入口；编辑态无入口；md/txt；与 chip 联动测例（组件/bridge 可测部分）。
- Step 9 — phase-annotate-ui-desktop — blocking: yes — qa: auto：Desktop Preview read **且** `workspaceScope==="chat"`：`window.getSelection` + 浮动条 + 原文匹配下划线；`global`/`session` 与编辑态无入口；**md/txt 与 Mobile 同验收**；清 annotate **仅**经 `nm:agent/userMessageAppended` push（非整次 run ok / 非 started）。
- Step 10 — phase-at-pipeline-guard — blocking: yes — qa: auto：仅 `@path` 引用不产生状态 chip；`userAttach` 不进 `isComposerStatusAttachment`。
- Step 11 — phase-manual-dual-end — blocking: no — qa: manual_user：双端真机/桌面录屏：划词批注（md/txt、**仅聊天会话工作区**）、其它 scope 无入口、多条同 path 一只 chip（发送后提示词仍见各条 annotate、append 后 chip 清空）、发送清空（Desktop 验证 started 后批注仍在直至 `nm:agent/userMessageAppended`）、仅批注可发、chip 中文口径、真实提示词增量形态与顺序。

## 测试策略

- **自动**：Core schema / prepare+wrap（含顺序与 JSON 行号正文对照，含 `header` 档） / 状态投影（不含 annotate） / runAgentTurn（annotateDrafts 门闩 + **禁空续跑 re-append** + **annotate concat / T-AN6**）；双端 chip 与气泡纯函数测例；App 合流点（Mobile `applyComposerStatusAttachmentsReplace` / Desktop suggest+reproject+**ConversationPanel 水化**）合并 chip 不被 replace 冲掉；Desktop `resolveComposerSendIntent` 透传 `hasAnnotateDrafts`（T-AN4）；Mobile bridge 消息契约测例（若有）。
- **手工**：Step 11；Desktop/Mobile 阅读态选区体验（md/txt）。
- **回归**：常驻前缀、`@` 双管道、置位/压缩后状态条清空合同保持（清空后 App 侧 annotate 亦应已空）。

### 测试用例

- T-SCH1 — blocking: yes — 新附件含 `action`+`path`，`name === path`（空 path → `name === "__no_path__"`），非 `write:/x` 展示 tag（→ Step 1, 3）
- T-CHIP1 — blocking: yes — Composer 状态 chip：`规则:/a`、`创建:/b`、`批注:/c`、`重命:<to>`（→ Step 2, 6）
- T-CHIP2 — blocking: yes — 气泡与 Composer 同口径；Mobile 无 📄 规则文案；无 action 降级符合规范（→ Step 2）
- T-PR1 — blocking: yes — 增量仅 `<user-ops>`+`<action>`；无内层 `<workplace>`/`<attach>`；**action 出现顺序为 attach → workplace → user_ops/annotate**（→ Step 4）
- T-PR2 — blocking: yes — `userAttach` / `workplaceChange` 旧 XML→新 JSON 对照（见协议节对照表）：全文/`filename`/`header`（`content`=行号正文；header=front-matter 行号）/短提示 `alreadyReferenced`（无 content；主要 attach）/目录树 `kind:dirTree`；JSON **无** mtime/createdAt（→ Step 4）
- T-PR3 — blocking: yes — 常驻前缀与现网一致，不因 Step 4 改变（→ Step 5）
- T-AN1 — blocking: yes — 同 path 两条批注仅一只 chip；Mobile `applyComposerStatusAttachmentsReplace` / Desktop suggest+reproject/**ConversationPanel 会话水化** 在 replace projected 后 chip 仍在；**切会话再回来 chip 仍在（annotateStore 未清）**（→ Step 6）
- T-AN2 — blocking: yes — 删光批注 chip 与下划线消失（→ Step 6, 8/9）
- T-AN3 — blocking: yes — append 成功后 annotate 进模型上下文且 UI 清空；append/发送失败批注仍在（→ Step 7）
  - **Desktop 断言位点（失败保留）**：模拟 `ipcAgentRun` 返回 `started:true` 但 **未** push `nm:agent/userMessageAppended`（或 append 早退/失败）→ `annotateStore` 与批注 chip **仍在**；`RUN_FINISHED`/`RUN_FAILED` 单独到达亦 **不得** 清 annotate。
  - **Desktop 断言位点（成功清空）**：收到 `nm:agent/userMessageAppended { sessionId }`（匹配当前会话）→ annotate store + 批注 chip 清空并重投影。
  - Mobile：`onUserMessageAppended` 回调内清空；未回调则保留。
- T-AN4 — blocking: yes — 仅批注可发送：`hasComposerSendableInput({ hasAnnotateDrafts:true })` + `runAgentTurn` `hasInput`/`shouldAppendNewUser`；**有 annotateDrafts 时不走空续跑 re-append**（`prepareUserVfsTurn` 不删末条）；**Desktop `resolveComposerSendIntent` 传入 `hasAnnotateDrafts` 后 `hasSendable`/`sendDisabled` 正确**；Mobile `ChatComposer` 同口径（→ Step 6, 7）
- T-AN5 — blocking: yes — Desktop IPC 契约（→ Step 7）
  - `AgentRunRequest.annotateDrafts` 透传至 `runAgentTurn`（经 handler / `agent-run.service`）。
  - `handleAgentRun` 挂 `onUserMessageAppended` → 向 renderer push **`nm:agent/userMessageAppended` `{ sessionId }`**（`IPC_CHANNELS.AGENT_USER_MESSAGE_APPENDED`；**不得**复用 `RUN_*`）。推荐实现：回调内 `webContents.send`（仿 suggest forwarder）；**不要求** `forward-event-bus` / `agent-event-types`。
  - Renderer **禁止**在 `result.ok && data.started`（=`started:true`）路径清 annotate；正文/`shouldClearComposer` 可保持现网 started 清（分轨）。
  - 与 T-AN3 Desktop 位点交叉覆盖：失败保留 / 成功清空。
- T-AN6 — blocking: yes — 同 path 两条 annotate 草稿：
  - **发送前 / store 聚合**：状态条仍仅一只 `批注:path`（与 T-AN1 互补）；
  - **物化后**：落库 `attachments` 与 wrap `<user-ops>` **均含两条** `<action name="annotate">`（**禁止**经 `mergeAttachmentsByPath` / `attachmentDedupeKey` 的 `path:` 静默丢条）；
  - **append 成功后**：批注 chip 清空（与 T-AN3 / PRD「append 成功清空」一致；**勿**写成「物化后状态条仍仅一只」以免与 T-AN3 冲突）
  （→ Step 7）
- T-AT1 — blocking: yes — 仅正文 `@path` 不产生状态 chip（→ Step 10）
- T-MAN1 — blocking: no — 双端划词批注手工验收（md/txt）**且仅聊天会话工作区**（Desktop `workspaceScope==="chat"` / Mobile `scopeKind==="session"`）；打开 global/session（Desktop）或 project/global（Mobile）预览时 **无**划词/添加批注入口（→ Step 11）

## 兼容性与迁移

- **不做**历史 `attachments_json` 批量改写；新发送走新口径。
- **不做**旧 chip 文案兼容层（无 action 仅按 `formatStatusChipLabelFromAttachment` 降级）。
- 提示词 XML 仅内存拼装，**无**库表迁移。
- 读历史：缺 `action` 时降级展示，不保证旧英文/「规则 ·」。

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| Wrap/prepare 大改漏 seen/短提示/目录树语义 | Step 4 用现网 T-PD*/T-AT* 语义对译后保留断言意图；T-PR1 钉死顺序 | 暂回三段 wrap（feature flag 可选，默认不引入；优先 git revert 该 phase） |
| Desktop/Mobile 选区实现成本高 | 协议与 chip 先合（Step 1–7）；UI 分 Step 8/9；Desktop 最小方案已定；阻塞则单开缺口迭代 | UI 可关入口，协议已合部分可保留 |
| App 合并 chip 漏接 replace | Step 6 T-AN1 断言 replace 后 annotate chip 仍在（含切会话再回来）；文档禁止 Core 合并；Desktop 三合流点均须改 | 临时把 annotate 误写入 projected（不推荐；仅紧急） |
| `name` 迁移导致外部依赖 | 仅 App/Core 内消费；IPC 同步 DTO | 恢复写 `action:path` 到 `name`（不推荐，仅紧急） |
| 只发批注误触 / 门闩漏改 | `hasInput`/`shouldAppendNewUser`/`hasAnnotateDrafts`/IPC + **Desktop `resolveComposerSendIntent` 透传** 闭环；测 T-AN4/T-AN5 | 门闩改回不计 annotate |
| **P1-A：同 path 多条 annotate 被 path 去重丢条** | 现网 `attachmentDedupeKey` 对有 path 附件按 `path:` 去重；SPEC 钉死 annotate **concat**、禁止 `mergeAttachmentsByPath`；T-AN6 | 紧急可对 annotate 改 key 策略（不如 concat 干净）；**禁止**回退为 path 去重并入 |
| **P0-D1：误在 `started:true` 清 annotate** | 现网 `handleAgentRun` 立即返回、无 append 推送；SPEC 钉死 **`nm:agent/userMessageAppended`**（`AGENT_USER_MESSAGE_APPENDED`）+ 与 text 分轨；T-AN3/T-AN5 Desktop 位点断言「started 保留 / push 后清空」 | 紧急可暂不清 annotate（宁可残留）直至桥落地；**禁止**回退为 started 清 |

### 风险与实现注（已知限制）

- Desktop 非 md/txt 预览类型本期不单独验收划词（见选区策略表）。
- Wrap 顺序相对现网 section 序为**有意调整**，依赖方若曾按 workplace-first 解析增量 XML，需按 T-PR1 新序适配（仅提示词内存形态，无库表）。
- **P0-D1 现网对照**：`ChatComposer` 在 `ipcAgentRun` ok（=`started`）后可清正文；annotate **不得**同路径清空。清 annotate **必须**经 **`nm:agent/userMessageAppended`**（推荐 handler/service 回调内 `webContents.send`，仿 suggest forwarder）；**不得**拿 `FINISHED` 冒充 append 成功；`forward-event-bus` / `agent-event-types` **非必须**。
- **P1-A 现网对照**：`mergeAttachmentsByPath` / `attachmentDedupeKey` 对有 `path` 的附件按 `path:` 去重；annotate 多条常同 path，**禁止**对该批走 path 去重并入，须 `concat`；chip 聚合与落库条数解耦（发送前一只 chip；append 成功后清空）。
- **P1 空续跑**：有 `annotateDrafts` 时禁止 `prepareUserVfsTurn` 空续跑 re-append（现网 merge 不含 annotate）；须新 append + concat。
- **P1 合流点**：Mobile 仅改 `applyComposerStatusAttachmentsReplace` 不够若还有旁路 replace；Desktop 须同时改 suggest 订阅、send 后 reproject、**ConversationPanel 会话水化**——漏一处仍会冲掉 annotate chip（切会话再回来尤甚）。
- **P1-B**：仅扩展 Core `hasComposerSendableInput` 不够；Desktop 发送门闩经 `resolveComposerSendIntent`（`composer-send-intent.ts`），必须把 `hasAnnotateDrafts` 传入；Mobile 在 `ChatComposer` 直接传入。
- **P1-D2**：批注入口仅聊天会话工作区；其它 scope 即使共用 Preview/阅读组件也不得露出入口（与 PRD「无入口、不验收」一致）。
- **P2-D3**：无 `action` 且旧 `name` 为 `rename:…→…` 时 chip path 取 `→` 右侧；无法解析则裸 path——**历史不保证**与发送当时文案一致。
- **P2 `name`**：新写入一律 `name = path`；空 path → `__no_path__`；不做历史 `attachments_json` 批量改写。
- **P2 `header` 档**：workplace 增量可产出 `display:"header"`（front-matter 行号正文）；对照表已列；与 full/filename 同属行号正文口径，**不**改写为 full。
- annotate store：双端模块级会话 Map；Desktop 若 PreviewPane 与 Composer 跨层，**不宜**仅 ConversationPanel 局部 state。

## Context Bundle

```yaml
iteration_name: annotate-user-ops-unify
requirement_path: Iterations/annotate-user-ops-unify/prd.md
spec_path: Iterations/annotate-user-ops-unify/spec.md
explore_summary: |
  chip 现为「规则 ·」+ 英文 name；落库 name=展示串；prompt 内层三段仅 user_ops 已是 action+JSON；
  批注零实现；前缀与增量已分离；Desktop markdown DOM vs Mobile WebView。
  定稿：App-owned 模块级 annotateStore + 状态条 App 合并；annotateDrafts 入参；Core 不读 App Map；
  annotate 并入 concat（禁 path 去重）；有 annotateDrafts 禁空续跑 re-append；
  Desktop resolveComposerSendIntent 须透传 hasAnnotateDrafts；
  userAttach/workplaceChange content=行号正文、mtime/createdAt 不进 JSON；
  对照表含 full/filename/header；清 annotate IPC 定名 nm:agent/userMessageAppended
  （推荐回调 webContents.send；forward-event-bus 非必须）；name=path（空→__no_path__）。
impact_files:
  - packages/core/src/domain/chat/model/message-attachment.schema.ts
  - packages/core/src/domain/chat/logic/status-chip-label.ts
  - packages/core/src/domain/chat/logic/wrap-user-message-for-llm.ts
  - packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts
  - packages/core/src/domain/chat/logic/project-composer-status-attachments.ts
  - packages/core/src/domain/chat/logic/composer-sendable-input.ts
  - packages/core/src/domain/chat/logic/scan-at-path-attachments.ts
  - packages/core/src/service/agent/logic/run-agent-turn.ts
  - packages/core/src/service/agent/logic/prepare-user-vfs-turn-for-agent-run.ts
  - apps/desktop/shared/ipc-types.ts
  - apps/desktop/src/main/ipc/handlers/agent.ts
  - apps/desktop/src/main/services/agent-run.service.ts
  - apps/desktop/src/main/ipc/forward-composer-attachments-suggest.ts
  - apps/desktop/renderer/features/chat/composer-send-intent.ts
  - apps/desktop/renderer/features/chat/ChatComposer.tsx
  - apps/desktop/renderer/features/chat/ConversationPanel.tsx
  - apps/mobile/src/services/agent-run.service.ts
  - apps/mobile/src/storage/chat-composer-draft.ts
  - apps/desktop|mobile AttachmentDraftChips / PreviewPane|FileMarkdownPreview / annotate store / ChatComposer
constraints:
  - 常驻前缀不动
  - @ 不进状态 chip
  - composer_draft_json 不存批注
  - Core projectComposerStatusAttachments 不合并 annotate
  - annotate 附件 concat 追加，禁止按 path 与已有条去重合并
  - 有 annotateDrafts 时禁止空续跑 re-append
  - Desktop resolveComposerSendIntent 须透传 hasAnnotateDrafts（只改 Core 不够）
  - Mobile applyComposerStatusAttachmentsReplace / Desktop suggest+reproject+ConversationPanel 水化：replace 后再 ∪ annotate
  - userAttach/workplaceChange JSON content=行号正文（含 header 档）；mtime/createdAt 不进 JSON
  - 落库 name=path（空→__no_path__）
  - 不做旧文案兼容
  - Desktop 禁止 started:true 清 annotate；须 nm:agent/userMessageAppended（推荐回调 webContents.send；forward-event-bus 非必须）
  - 批注入口仅 Desktop workspaceScope=chat / Mobile scopeKind=session
  - annotate store 为双端模块级会话 Map（Desktop 跨 PreviewPane）
blocking_steps:
  - phase-action-schema
  - phase-chip-zh-map
  - phase-persist-no-display-tag
  - phase-prompt-unify-user-ops
  - phase-prefix-regression
  - phase-annotate-store
  - phase-annotate-send
  - phase-annotate-ui-mobile
  - phase-annotate-ui-desktop
  - phase-at-pipeline-guard
```
