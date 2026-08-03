---
date: 2026-06-13
---

# 用户 VFS 操作统一 Tool Turn 技术规格（SPEC）

> 需求：[prd.md](./prd.md)  
> 前置：**[agent-editor-ui-bugfix](../agent-editor-ui-bugfix/spec.md)** 须先合并。

## 设计目标

- **Actor 清晰**：用户 VFS 突变在会话中为 **U-A-U-A**；synthetic 消息带 `metadata.actor=user` / `metadata.source=user`。
- **Transcript 合法**：结构约束 + 区内合并，**避免** Export 层大量插 noop boundary。
- **桥接可感知**：仅 Agent maxSteps 截断场景需**用户确认**插入真实 assistant；VFS 路径内置第 4 条。
- **所见即所得**：UI、回滚、组 prompt 共用 visible messages；export 做区内 merge 与 provider 合法化。
- **编辑省上下文**：锚点 diff → `edit`，失败 fallback `write`；action / Transcript **展开 diff**。

## 总体方案

```text
┌─────────────────────────────────────────────────────────────────┐
│ 用户 VFS 突变（Desktop IPC / Mobile VfsFileManager / FileEditor）│
└────────────────────────────┬────────────────────────────────────┘
                             │ ToolRunner 立即执行（磁盘已变）
                             ▼
              user-vfs-turn.service.executeOp → pending[k]
                             │
         用户发送 / 空请求 ───┤ flushPendingUserVfsTurns
                             ▼
              mergePendingVfsTurns → append 4×U-A-U-A → checkpoint（mutating）
                             │
                             ▼
              runAgentTurn（plain user 不 capture）→ agent-runner（mutating 才 capture）
                             │
                             ▼
              buildPromptLlmInputFromLayout（persist/dynamic 开关跳过）
                             │
                             ▼
              normalizeForLlmExport（区内 merge，跨区不 merge）→ provider
```

**分层职责**

| 层 | 职责 |
|----|------|
| **Domain** | 纯函数与 wire 类型：`user-vfs-save-mapping`、`merge-pending-vfs-turns`、`compress-user-vfs-tool-uses`、`validate-agent-prompt-layout`、`resolve-hide-message-range`、`normalize-for-llm-export`（见 §架构对齐） |
| **Service** | 用例编排：`UserVfsTurnService`（execute + flush）、`appendToolTurnBridge`；调用 `ToolRunner` + `MessageService` + `SessionRepository` |
| **Runtime** | Desktop/Mobile VFS 入口改调 Core；pending 存 **`chat_session.user_vfs_pending_json`**（精简 JSON，非独立表） |
| **UI** | Agent Switch、Composer 三分支、桥接弹窗、seq 隐藏/恢复、edit hunk 展开 |

**与现有能力复用**

- `MessageService.hideRange` / `showRange`（`message.service.ts` L226–241）— 隐藏/恢复 seq 范围。
- `resolveRollbackAnchorMessage` — **保留**（回滚锚点解析）；**不**实现 `repair-turn-boundary` / repair-on-write。
- `ToolRunner.runParallel` — 单次 save 多 hunk；burst flush **不再**调用。
- `system` Switch 模式 — persist/dynamic Switch **UI 同型**，但 wire 用 **显式布尔**（见下）。

## 架构对齐（`packages/core/ARCHITECTURE.md`）

### 依赖方向

```text
domain/chat/logic、domain/vfs/logic、domain/prompt/logic、domain/depth/logic、domain/tool/logic
        ↑
service/chat/impl、service/agent、service/prompt、service/events
        ↑
apps/desktop IPC、apps/mobile services
```

- **domain → service：禁止**。`UserVfsTurnService` 编排 domain + repo，domain 不 import service。
- **builtin `vfs-tools`** 仍只依赖 `domain/vfs/ports`；用户 VFS 经 `ToolRunner` 调用，不在 service 里直写 VFS。
- **持久化**：`chat_session.user_vfs_pending_json` 经 **`SessionRepository` port** 读写（`domain/chat/repositories`），不在 service 里裸 SQL。

### 文件落位（命名习惯）

| 职责 | 路径 | 层 |
|------|------|-----|
| pending wire 类型 + zod | `domain/chat/model/user-vfs-pending.schema.ts` | domain/model |
| `ChatSession.userVfsPendingJson` | `domain/chat/model/session.ts` | domain/model |
| pending 列读写 | `domain/chat/repositories/session.port.ts` 扩展；`impl/sqlite-session.repository.ts` | domain/repo |
| 列 migration | `bootstrap/chat/migrate-chat-session-user-vfs-pending.ts`；`novel-master-bootstrap.ts` 注册 | bootstrap |
| 锚点 diff / actionXml | `domain/vfs/logic/user-vfs-save-mapping.ts` | domain/logic |
| actionXml → tool_use 推导 | `domain/vfs/logic/action-xml-to-tool-uses.ts` | domain/logic |
| burst 合并纯函数 | `domain/chat/logic/merge-pending-vfs-turns.ts` | domain/logic |
| tool_use 压缩 | `domain/tool/logic/compress-user-vfs-tool-uses.ts` | domain/logic |
| mutating → `ok` | `domain/tool/logic/format-tool-output.ts` | domain/logic |
| `hasToolResult` / `isPlainUserText` | `domain/chat/logic/message-content-helpers.ts` | domain/logic |
| `raw.metadata` 类型 | `domain/chat/model/message-metadata.ts` | domain/model |
| hide-message 锚点 | `domain/depth/logic/resolve-hide-message-range.ts` | domain/logic |
| 区内 merge export | `domain/prompt/logic/normalize-for-llm-export.ts` | domain/logic |
| persist/dynamic 校验 | `domain/prompt/logic/validate-agent-prompt-layout.ts` | domain/logic |
| wire 布尔字段 | `domain/agent/model/agent-definition.schema.ts` | domain/model |
| U-A-U-A 用例 | `service/chat/user-vfs-turn.port.ts` + `impl/user-vfs-turn.service.ts` | service |
| 工厂 | `service/chat/create-user-vfs-turn-service.ts`（或并入 `create-chat-services.ts`） | service |
| 桥接 append | `service/chat/impl/append-tool-turn-bridge.ts` | service |
| hide handler 改点 | `service/events/impl/actions/hide-message.handler.ts` | service |
| prompt 组装跳过 | `service/prompt/render-prompt.ts`（单文件 service，无 impl/） | service |
| Agent 跑轮 | `service/agent/logic/run-agent-turn.ts`、`impl/agent-runner.ts` | service |
| 对外 API | `index.ts` 导出 port + factory（内部路径可换，符号名稳定） | facade |

### 测试落位

| 单测 | `packages/core/test/` |
|------|------------------------|
| merge / compress / action-xml / hide-range / validate / export | `chat/`、`vfs/`、`tool/`、`depth/`、`prompt/` 与 domain 路径对应 |
| `UserVfsTurnService` 集成 | `test/chat/user-vfs-turn.service.test.ts` |

### 与现有例外一致

- SQLite repo 仍在 `domain/*/repositories/impl/sqlite-*.repository.ts`（**不**新建 `infra/persistence/`）。
- `render-prompt.ts` 保持 `service/prompt/` 单文件（无 `impl/` 子目录）。
- `normalize-orphan-tool-results-for-llm.ts` 暂留 `service/prompt/`；新 `normalize-for-llm-export` 放 **domain** 纯函数，由 `agent-runner` / export 路径调用。

---

| 讨论项 | SPEC 章节 |
|--------|-----------|
| U-A-U-A 四消息落库 | §会话形态 |
| burst 合并（pending + flush） | §会话形态 |
| 桥接文案 `【done】` | §会话形态、§Tool turn bridge |
| 取消 repair-on-write | §Tool turn bridge |
| 持久/动态开关与校验 | §Prompt 三区不变式 |
| 区内 merge / 跨区不 merge | §LLM Export |
| 隐藏/恢复/末条发送规则 | §会话 Transcript UX |
| 锚点 diff edit | §锚点 Diff |
| edit action diff 展开 | §会话形态、§用户操作映射 |
| user VFS tool_use 压缩 | §会话形态 |
| hide-message 事件 assistant 锚点 | §事件系统 hide-message |
| persist/dynamic Switch UX | §Prompt 三区不变式 |
| worktree markDirty 收窄 | §Worktree 快照 |
| checkpoint / versionCheck | §Checkpoint、§版本校验 |
| checkpoint 仅 mutating tool 后 | §Checkpoint |

---

## Prompt 三区不变式

### 开关（Agent 配置 wire）

| 字段 | 默认 | 说明 |
|------|------|------|
| `prompts.persistEnabled` | `false` | 关：组装跳过 persist；开：须过校验 |
| `prompts.dynamicEnabled` | `false` | 关：组装跳过 dynamic；开：须过校验 |

**Wire 与 system 开关差异（定案）**

| | `system` | `persistEnabled` / `dynamicEnabled` |
|--|----------|-------------------------------------|
| wire 表达 | optional 字符串；omit = 关 | **显式 boolean**，schema `.default(false)` |
| UI 态 | `systemEnabled` + `systemContent` | `persistEnabled` + `dynamicEnabled`（同名布尔） |
| 关时 wire 块 | omit `system` | **保留** `persist` / `dynamic` map，不强制清空 |

扩展文件：

- `agent-definition.schema.ts` — `promptsDocumentSchema` 增加两布尔字段
- `agent-prompt-layout.ts` — `AgentPromptLayout` 增加 `persistEnabled?` / `dynamicEnabled?`
- `agent-editor-state.ts` — `definitionToForm` / `buildAgentDefinitionFromForm` round-trip

旧 Agent 无字段 → 加载时视为 `false`（默认关，与 PRD 一致）。

存 AgentDefinition；**不提供**旧 Agent 自动迁移。

### Agent 编辑器 Switch UX（双端）

与 `prompt-engine-three-regions` 的 **system Switch** 同交互；本迭代在 **提示词模版** 页补齐：

| UI | wire | 默认 |
|----|------|------|
| 持久区 Switch | `prompts.persistEnabled` | `false` |
| 动态区 Switch | `prompts.dynamicEnabled` | `false` |

- **关**：折叠对应块列表（或灰显占位）；`buildPromptLlmInput` **跳过**该区；wire 块 **保留**。
- **开**：展开块列表；保存 Agent 时执行 §启用后校验。
- 布局顺序：system → persist → 会话历史占位 → dynamic（WYSIWYG）。

实现：`AgentEditorView` / `AgentEditorForm` + `agent-editor-state`（`persistEnabled` / `dynamicEnabled` 布尔）。

**运行时语义**

| 开关 | 组装行为 |
|------|----------|
| `persistEnabled === false` | `buildPromptLlmInputFromLayout` / `buildPromptAssemblyFromLayout` **跳过** persist 循环（`render-prompt.ts` L191–198、L122–139） |
| `dynamicEnabled === false` | **跳过** dynamic 循环（L203–212、L160–175） |

跳过发生在 **render 层**，不在 `agent-editor-state` 删块（表单始终编辑全量 wire）。

仅当开关为 **true** 时执行下列校验；校验失败 **禁止保存**。

### 启用后校验

**持久区**（`persistEnabled === true`）

```text
persist.length >= 1
persist[persist.length - 1].type === "text"
persist[persist.length - 1].role === "assistant"
```

- worktree 块可在任意非末位置；**不得**作为末块。
- 末块示例：「我将遵守」类 assistant 文本。

**动态区**（`dynamicEnabled === true`）

```text
dynamic.length >= 2
dynamic[0].role === "assistant"
dynamic[dynamic.length - 1].role === "user"
```

- 中间块 role 任意；区内 Export 时对连续同 role 纯文本 merge。
- 目的：组装顺序 `persist → chat → dynamic` 时，若 chat 末条为 `user(tool_result)`，dynamic 以 **assistant 首块** 衔接，避免 `user | user`。

### 与组装的关系

`buildPromptLlmInputFromLayout` **不合并**；每条 synthetic / chat message 独立。  
**Export** 阶段按组装三段切 zone（persist 合成消息 | 会话 messages | dynamic 合成消息），在 zone 内 merge；**不得**仅依赖 `prompt:` id 前缀（会话内 synthetic 桥接也带 `metadata`）。

Synthetic 元数据写入 `ChatMessage.raw`（现有字段），建议键：

```text
raw.metadata.source = "user" | undefined
raw.metadata.actor = "user" | undefined
raw.metadata.synthetic = true
raw.metadata.kind = "tool_turn_bridge" | "user_vfs_action" | ...
```

---

## 会话形态：U-A-U-A 与 Burst 合并

### 单条 U-A-U-A 形态（落库时固定 4 条）

```text
1. user:       <user-vfs-action>…</user-vfs-action>（完整入参 / diff 真源）     metadata.source=user
2. assistant:  tool_use […]（压缩 input，见 §tool_use 压缩）                  synthetic, metadata.actor=user
3. user:       tool_result "ok"（或 Error）× N                              metadata.source=user
4. assistant:  【done】                                                     synthetic, kind=tool_turn_bridge
```

### tool_use 压缩（用户 VFS U-A-U-A 专用）

**原则**：执行已在 pending 阶段完成；落库 transcript 时 **第 1 条 user 为 LLM 可读真源**，第 2 条 assistant **不重复**大段 input。

| 阶段 | 存什么 |
|------|--------|
| **session 列 pending** | `actionXml` + `tools[{id,name}]`；**不存** tool_use input / result |
| **flush message 2** | 由 actionXml **推导** input → `compressUserVfsToolUses()` |
| **flush message 3** | 每条 tool 成功 → content **`"ok"`**；失败 → `"Error: …"`（不写入 version/replacements） |

**压缩规则**（`domain/tool/logic/compress-user-vfs-tool-uses.ts`）

```text
compressUserVfsToolUses(toolUses[]) → ToolUseBlock[]

对每个 tool_use：
  - 保留：id、name、type
  - input：保留原对象 **键结构**（含嵌套 options 键名）
  - 凡 string 值 → 统一替换为 "…"
  - number / boolean 保留（如 expectedVersion、versionCheck、replaceAll）
```

示例（edit）：

```json
{ "path": "…", "oldString": "…", "newString": "…" }
```

示例（write）：

```json
{ "path": "…", "content": "…" }
```

示例（fs）：

```json
{ "command": "…" }
```

- **不适用于 Agent 自发 tool 轮**（仍存完整 input）。
- assistant 消息建议 `raw.metadata.toolInputCompressed = true`（UI / export 可识别）。
- Provider 仍须 `tool_use.id` ↔ `tool_result.toolUseId` 配对；content 见 §tool_result 统一 ok。
- Transcript UI 展示 tool 卡片时，压缩 input 旁提示 **「入参见上条 user-vfs-action」**；展开 hunk 仍读第 1 条 user。

### 实时 VFS + 延迟 Transcript（burst）

```text
用户 VFS 操作 #1..#k  （每次：ToolRunner 执行 → 磁盘已变 → append pending JSON）
        ↓
用户点击发送且成功（含空请求发送成功）
        ↓
flushPendingUserVfsTurns(sessionId):
  若 pending 为空 → 跳过
  否则 merge → 1×U-A-U-A append 落库 → clear pending 列
        ↓
继续 append user 聊天 / allowResumeWithoutInput 跑 Agent
```

**Pending 队列（`chat_session` 字段，非独立表）**

```text
chat_session.user_vfs_pending_json  TEXT NULL   -- JSON 数组，FIFO；NULL = 无 pending
```

**为何不单独建表**：每会话 pending 条数少、生命周期短（至发送 flush）；与会话 1:1 的 JSON 列更简单，fork/删 session 时整行处理即可。

**每条 pending 存什么（精简）**

```json
{
  "actionXml": "<user-vfs-action …/>",
  "tools": [{ "id": "tu_abc", "name": "edit" }],
  "createdAtMs": 1710000000000
}
```

| 字段 | 存？ | 说明 |
|------|------|------|
| `actionXml` | ✓ | 第 1 条 user 真源 |
| `tools[].id` | ✓ | flush 时与 tool_result 配对 |
| `tools[].name` | ✓ | 推导压缩 tool_use |
| `tools[].result` / version | ✗ | 成功路径 flush 固定 `"ok"`；**失败不写入 pending**（UI toast，磁盘未变或已回滚） |

```text
SessionRepository（扩展 port，非独立 Pending 表）
  getUserVfsPendingJson(sessionId)  → string | null
  setUserVfsPendingJson(sessionId, json | null)
```

- push：`list` → append op → `setUserVfsPendingJson`
- flush 成功：`setUserVfsPendingJson(sessionId, null)`

- **须持久化**：关应用重进后列仍在；发送成功时 flush。
- 会话 fork：复制或清空该列（与 fork 语义一并定实现）。

**合并算法（Core 纯函数 + 单测）**

```text
mergePendingVfsTurns(pending[]) → { actionsXml, toolUses[], toolResults[] }

- actionsXml: 按序拼接多个 <user-vfs-action …/>（或包在单一父节点内）
- toolUses:   各 pending.tools 按序 flatMap；**input 由 actionXml 推导**后 compress
- toolResults: 与 toolUses 同 id；content 成功 **`"ok"`**，失败 `"Error: …"`
- **禁止** flush 时再次调用 ToolRunner（磁盘已在各次操作时更新）
```

**顺序与并行**

- 各次操作 **按发生顺序** 进入 pending；flush 后 assistant 内 tool_use **数组顺序 = 操作顺序**（与 `runParallel` 返回序一致，文档上视为有序多 tool，非乱序并发语义）。
- 同一文件连续 save：多次 `edit`/`write` 依次入队；因每次 save 已顺序执行，合并仅为 transcript 折叠，**无冲突**。
- 跨路径 rm + mkdir + mv：可同条 assistant 多 tool_use；执行已在各次操作时顺序/独立完，合并安全。

### `<user-vfs-action>` 示例

**非 edit（删/建/移）**

```xml
<user-vfs-action kind="delete" path="draft.md" />
<user-vfs-action kind="mkdir" path="notes/" />
<user-vfs-action kind="rename" from="a.md" to="b.md" />
```

**save + edit（须展开 diff 描述）**

```xml
<user-vfs-action kind="save" path="chapters/01.md" method="edit" hunks="2">
  <edit-hunk index="1">
    <old>…锚点旧文…</old>
    <new>…锚点新文…</new>
  </edit-hunk>
  <edit-hunk index="2">…</edit-hunk>
</user-vfs-action>
```

**save + write fallback**

```xml
<user-vfs-action kind="save" path="chapters/01.md" method="write" reason="anchor-not-unique" />
```

- `edit-hunk` 的 old/new = 与 **执行时** `tool_use.input` 同源（写入 action XML）；落库 message 2 为压缩占位，**不以 message 2 为 diff 真源**。
- Transcript UI：user 气泡可折叠摘要；**展开**展示 hunk 列表（Desktop + Mobile）。
- burst merge：各次 save 的 action **按序**拼接，hunk index **每 save 内**从 1 起。

### 执行顺序（单次 VFS 操作）

1. 调真实 `ToolRunner` 执行合成 tool → **磁盘更新**。
2. 将 `{ actionXml, tools:[{id,name}] }` **append** 到 `user_vfs_pending_json`（不 append message）。
3. **不**在每次操作时 capture checkpoint；在 **flush 落库** U-A-U-A 后 capture（见 §Checkpoint）。

### Flush 触发点

**唯一入口**：Composer **点击发送且成功**（用户消息真正进入发送管线时）。

```text
onSendSuccess(sessionId, payload):
  1. flushPendingUserVfsTurns(sessionId)   // pending 非空则 U-A-U-A 落库
  2. 若 payload 有文字 → append user → runAgentTurn
     若 payload 为空且 allowResume → runAgentTurn（不 append）
  桥接弹窗确认失败 / 用户取消 → 不 flush、不发送
```

| 场景 | flush？ |
|------|---------|
| 带文字发送 **成功** | ✓ |
| 空请求发送 **成功**（composer 允许时） | ✓ |
| 桥接弹窗 **取消** | ✗ |
| 末条 assistant 空发送被拒 | ✗ |
| VFS 操作本身 | ✗（仅 INSERT pending） |

实现：`runAgentTurn`（或 Desktop/Mobile 发送 handler）在 append user / 跑 Agent **之前**调用 flush；**无**其它隐式 flush 入口。

VFS-only 后空请求发送成功：flush → 末条 assistant `【done】` → 续跑 Agent，**无需**桥接弹窗。

第 4 条文案默认 **`【done】`**（实现固定）。

---

## Tool turn bridge（取代 Turn boundary）

### 取消

- ~~`repairTurnBoundaryIfNeeded`~~
- ~~`chat.turnBoundaryText` 自动 repair-on-write~~

### VFS 路径

第 4 条 assistant 即桥接，**无需弹窗**。

### Agent maxSteps 截断路径

**触发条件**（同时满足）：

```text
lastVisible.role === "user"
&& lastVisible.content 含 tool_result 块
&& userSend.hasNonEmptyText
```

VFS U-A-U-A 完成后末条为 assistant `【done】`，**不触发**。

**UX（Desktop + Mobile）**

1. 弹窗说明：为保证对话连续，将插入 Assistant 消息「【done】」，再发送您的消息。
2. **确认** → append 真实 assistant（`kind: tool_turn_bridge`）→ append user 聊天 → 发送。
3. **取消** → 不发送；composer 内容保留。

### 空请求

末条已是 **user**（含 `tool_result`）：**不 append** 新 message，直接 `buildPromptLlmInput` + run（**现有行为**）。不弹窗。

### 末条发送规则（Composer）

| 末条 | 空请求 | 带文字发送 |
|------|--------|------------|
| **assistant** | ✗ | ✓ 正常 append user |
| **user(tool_result)** | ✓ `allowResumeWithoutInput`（**已实现**：`canResumeWithoutInput = last.role === 'user'`） | ✓ **桥接弹窗** → append assistant `【done】` → append user |
| **plain user**（无 tool_result） | ✓ 同上 | ✗ UI **禁用输入**（仅续跑） |

实现须新增：`hasToolResult(message)` 与 `isPlainUserText(message)`，不可仅用 `role === 'user'` 一刀切。

---

## 会话 Transcript UX

### 移除（Mobile + Desktop）

- 用户**删除**消息（Mobile `message-edit.ts`、Desktop `message-edit.ts` / `ConversationPanel`）。
- **通用**批量选择与批量删/藏（Mobile `useChatTabMessages`、Desktop `messageBatch`）。

### 隐藏 / 恢复（专用多选，非长按）

与现状 `hideToolTurn` **不同**；**复用** Core `hideRange` / `showRange`；**保留多选 UI**，但 **按 role 限制可勾选行**：

| 模式 | 入口 | 可勾选 | 不可勾选 | 确认后 |
|------|------|--------|----------|--------|
| **隐藏** | 【隐藏消息】 | **仅 assistant** | user、其它 | `hideRange(1, max(selectedAssistant.seq))` |
| **恢复** | 【恢复消息】 | **仅 user** | assistant | `showRange(min(selectedUser.seq), maxSeq)` |

- 非 eligible 消息：**不显示勾选框**（或 disabled），点击行不进入选中态。
- 可多选；0 条选中时确认 disabled。
- Desktop / Mobile Transcript（含 WebView）须统一 `data-selectable-role` 或等价协议。

长按菜单不再提供 hide/unhide/delete；保留 edit/copy/fork/rollback。

### 回滚兜底

- 用户触发回滚：Core **始终**截断 tail；anchor 无 checkpoint 时用前序 checkpoint / 空树，**不抛错**；UI 可选 toast 提示 VFS 可能未完全还原。
- 系统仍 **删除锚点 message 以下** 消息（与现有 rollback 语义一致），非用户删除能力。

---

## 事件系统 hide-message 优化

**现状**：`hide-message.handler.ts` 对 depth slice 内所有 message 取 seq min~max 后 `hideRange`；当 `start-depth: 6`、无 `end-depth`（即 **6～∞**）时，深度 6 可能是 **user**（如 `tool_result`），从 user 开 hide 会破坏 turn 边界。

**优化**（仅当 `startDepth != null && endDepth == null` 时启用 assistant 锚点；其他 slice **保持现状**）：

```text
resolveHideMessageAnchor(visible, slice):
  ids = messageIdsInSlice(visible, slice)
  if ids 为空 → 不 hide

  if slice.startDepth != null && slice.endDepth == null:
    msg = visible 中 depth === startDepth 的消息
    if msg.role !== "assistant":
      msg = 在 depth ∈ [startDepth, ∞] 内按 depth 递增扫描的第一条 assistant
      if msg == null → 不 hide（范围内无 assistant）
    fromSeq = msg.seq
    toSeq   = max(seq) among ids in slice
    hideRange(fromSeq, toSeq)
  else:
    // 原有逻辑：slice 内 min~max seq
    hideRange(minSeq, maxSeq)
```

- 深度定义不变：尾端 depth 0 = 最新可见消息（`depth-from-tail.ts`）。
- 出厂默认 `{ "start-depth": 6 }` 压缩 hide 走新锚点逻辑。
- 实现：`domain/depth/logic/resolve-hide-message-range.ts` + 改 `hide-message.handler.ts`；单测覆盖 depth6=user → 锚到更深 assistant。

**与用户手动「隐藏消息」区分**：手动隐藏仍按 §会话 Transcript UX（assistant↑ seq 范围）；本节仅 **事件 / 压缩** 触发的 `hide-message` action。

---

## 用户操作 → Tool 映射

| UI 操作 | 合成 tool | `tool_use.input` |
|---------|-----------|-------------------|
| 删除 | `fs` | `{ command: "rm path" }` 或 recursive |
| 新建目录 | `fs` | `{ command: "mkdir path" }` |
| 移动/重命名 | `fs` | `{ command: "mv from to" }` |
| 新建文件 | `write` | `{ path, content }` |
| 保存编辑 | **`edit` 或 `write`** | 见 §锚点 Diff |

### tool_result 统一 `ok`（用户 VFS U-A-U-A + Agent mutating）

| 结果 | `tool_result.content` |
|------|----------------------|
| 成功（write / edit / fs 突变） | **`ok`**（固定字符串，无 version JSON） |
| 失败 | `Error: …`（`formatToolErrorForLlm`） |

- transcript **不**存 `{ version: N }` / `ok (n replacements)`；VFS 细节在第 1 条 actionXml + 磁盘。
- pending 成功路径 **不存** result；flush 时对每条 tool 写 `"ok"`。
- **Agent mutating tool**（本迭代一并收窄）：`formatToolOutputForLlm` 对 write/edit/fs 突变成功 **统一 `"ok"`**；只读 tool（read/glob/grep/ls）保持原格式。改 `format-tool-output.ts`。

---

## 锚点 Diff → `edit`

（与初版 SPEC 相同，仅 U-A-U → U-A-U-A 条数变更。）

新增 `packages/core/src/domain/vfs/logic/user-vfs-save-mapping.ts`：

```text
mapUserSaveToToolUses(baseline, saved, path, fileContentAtSave, options)
  → { toolUses: ToolUseBlock[] } | { single: "write", path, content }
```

步骤：相等 no-op → 新文件 write → 行级 diff → 锚点 edit（扩展至唯一）→ 失败则整文件 write → 多 hunk 同一 assistant 多个 `tool_use`。

**action XML 同步**：`mapUserSaveToToolUses` 返回 `editHunks`；`buildUserVfsActionXml`（`domain/vfs/logic/`）生成 `<edit-hunk>`。`UserVfsTurnService` 只编排，不含 diff 算法。

---

## Worktree 快照

（与初版相同。）

- 用户/Agent **仅写 VFS** → **不** `markDirty`。
- 仍 dirty：目录/文件规则变更、压缩 hide 完成、【工作树刷新】。
- `pullTemplate` / rollback → 不 markDirty。

---

## Checkpoint

**原则**：checkpoint 记录 **工作区文件树快照**；仅 **mutating tool 全部 settled 后** 需要 capture。plain 文本 / 桥接 `【done】` / 空请求 **不改变 VFS**，不必每条 message 都 capture。

### 何时 capture

| 场景 | capture | anchor messageId |
|------|---------|------------------|
| **U-A-U-A flush**（burst 合并落库，含 mutating tool） | ✓ **一次** | **第 3 条 `tool_result` message id**（定案） |
| **Agent 一轮 mutating tool 完成** | ✓ | 该轮 **assistant** id（`tool_result` append **前**，与现状一致；`resolveRollbackAnchorMessage` 解析到 tool_result） |
| **Agent 纯文本 assistant**（无 tool） | ✗ | — |
| **Agent 只读 tool**（read/glob/grep/ls） | ✗ | — |
| **用户 plain user 聊天** | ✗ | — |
| **桥接 assistant `【done】`**（maxSteps 弹窗插入） | ✗ | — |
| **空请求续跑** | ✗ | — |

- burst pending 阶段：**不** capture（磁盘已变，transcript 未落库）；**flush 落库后 capture 一次**。
- **移除** `run-agent-turn.ts` 对每条 user 文本的 capture（与 message-checkpoint-v2 定案一致）。

### 回滚语义（无 checkpoint 不阻断）

```text
rollbackToMessage(anchor):
  1. 消息：始终 deleteAfterSeq（截断 tail）— 与 anchor 是否有 checkpoint 无关
  2. VFS：resolveRollbackTargetTree
       anchor 有直接 checkpoint → 用该树
       否则 → 最近前序 checkpoint
       否则 → 空树（session baseline）
```

- Core **不**因 anchor 无 checkpoint 抛 `ROLLBACK_NO_CHECKPOINT`（该码已保留但 rollback 路径不再 throw）。
- 回滚到 **plain user / 桥接 assistant** 等无 checkpoint 消息：VFS 落到**最近 mutating tool 的 checkpoint**，语义正确（其间无 VFS 变更）。
- 仅当 tail 含 mutating 变更且 anchor 之前**从未**有过 checkpoint 时，VFS 才回到空树；消息截断仍成功。

### 与现状差距

| 现状 | 目标 |
|------|------|
| `run-agent-turn` 每条 user 文本 capture（L153–157） | **移除** |
| `agent-runner` 每轮 assistant 均 capture（L271–279 纯文本、L328–336 含只读 tool） | **收窄**为 `anyToolUseMutatesWorkspace(toolUses)` 为 true 时 |
| `agent-runner.test.ts` L611 断言只读 tool 也 capture | **改测试**以匹配收窄策略 |

---

## 版本校验

- **保留** `session-fs.versionCheck`。
- 与 U-A-U-A 正交。

---

## LLM Export

### 原则

- Session 真源 = `buildPromptLlmInputFromLayout` 输出（未 merge）。
- `normalizeForLlmExport(messages, provider)` 在 **zone 内** merge。

### 区内 merge 条件（全部满足）

```text
sameZone(persist | chat | dynamic)
&& sameRole
&& plainTextOnly  // 无 tool_use / tool_result / thinking
&& !isVfsSemanticSegment  // 不跨 vfs action/result 与 plain chat 合并
```

合并方式：文本 `\n\n` 拼接；若同一 message 内多块，`tool_result` 块 **hoist 在前**。

### 跨区

**永不 merge**。依赖：

- persist 末 assistant + chat 首 user
- chat 末 user + dynamic 首 assistant（dynamic 启用时）
- U-A-U-A 第 4 条 assistant 解决 vfs 末条衔接

### Per-provider

| Provider | 说明 |
|----------|------|
| **Anthropic** | 区内 merge 后应无非法连续同 role；桥接 assistant 保留 |
| **OpenAI** | 可 strip 空 content 的 `tool_turn_bridge`（若未来支持 noop） |
| **Gemini** | Agent tool 配对沿用 `buildSyntheticModelTurn`；**不对**用户 U-A-U-A 重复合成 |

### 禁止

- vfs 段与 plain chat user merge 为一条。
- 拆分 U-A-U-A 四条。

---

## 项目结构与变更清单

> 路径均相对 `packages/core/src/`；遵循 [ARCHITECTURE.md](../../ARCHITECTURE.md)。

```text
bootstrap/
  chat/chat-schema.ts                         # 新库 DDL 含 user_vfs_pending_json（可选）
  chat/migrate-chat-session-user-vfs-pending.ts
  novel-master-bootstrap.ts                   # 注册 migration

domain/chat/
  model/session.ts                            # +userVfsPendingJson
  model/user-vfs-pending.schema.ts            # NEW pending JSON zod
  model/message-metadata.ts                   # NEW raw.metadata 类型
  logic/merge-pending-vfs-turns.ts            # NEW
  logic/message-content-helpers.ts            # NEW hasToolResult / isPlainUserText
  repositories/session.port.ts                # +get/setUserVfsPendingJson
  repositories/impl/sqlite-session.repository.ts

domain/vfs/logic/
  user-vfs-save-mapping.ts                    # NEW
  action-xml-to-tool-uses.ts                  # NEW flush 推导 tool_use

domain/tool/logic/
  compress-user-vfs-tool-uses.ts              # NEW
  format-tool-output.ts                       # mutating → "ok"

domain/prompt/
  model/agent-prompt-layout.ts                # +persistEnabled/dynamicEnabled
  logic/validate-agent-prompt-layout.ts       # 开关校验
  logic/normalize-for-llm-export.ts           # NEW

domain/depth/logic/
  resolve-hide-message-range.ts               # NEW

domain/agent/model/
  agent-definition.schema.ts                  # wire 布尔

service/chat/
  user-vfs-turn.port.ts                       # NEW
  create-user-vfs-turn-service.ts             # NEW（或 extend create-chat-services）
  impl/user-vfs-turn.service.ts               # NEW
  impl/append-tool-turn-bridge.ts             # NEW

service/prompt/render-prompt.ts               # 开关跳过 + worktree role
service/agent/logic/run-agent-turn.ts         # flush 前置；移除 user capture
service/agent/impl/agent-runner.ts            # mutating capture；去 vfs markDirty
service/events/impl/actions/hide-message.handler.ts

index.ts                                      # 导出 UserVfsTurnService factory + 必要 types
```

apps/desktop/
  src/main/ipc/handlers/vfs.ts                              # 改调 userVfsTurn.execute
  renderer/features/settings/AgentEditorView.tsx            # persist/dynamic Switch
  renderer/features/chat/ConversationPanel.tsx              # composer 三分支、桥接弹窗
  renderer/features/chat/ChatComposer.tsx
  renderer/features/chat/message-edit.ts                    # 移除 delete/hide
  renderer/.../chat-transcript                              # user-vfs-action edit hunk 展开

apps/mobile/
  src/components/agent/AgentEditorForm.tsx                  # persist/dynamic Switch
  src/components/vfs/VfsFileManager.tsx                       # 改调 userVfsTurn
  src/screens/stack/FileEditorScreen.tsx                    # save → userVfsTurn
  src/components/chat/ChatComposer.tsx
  src/screens/tabs/chat-tab/useChatTabMessages.ts             # 移除 batch；composer 规则
  src/components/chat/message-edit.ts
  src/web/chat-transcript/                                    # edit hunk 展开渲染
```

**删除/不再实现**：`repair-turn-boundary.ts`、`chat.turnBoundaryText` 自动 repair（代码库中**本不存在**，无需删文件）。

**Feature flag（实现时落地）**：`userVfsUnifiedToolTurn` — 关闭则恢复直写 VFS IPC + vfs markDirty。

---

## 实现步骤

1. **Schema + 校验**：`persistEnabled`/`dynamicEnabled` wire + `validate-agent-prompt-layout` + `render-prompt` 开关跳过 + 单测。
2. **Agent 编辑器 Switch UX**：`agent-editor-state` + Desktop/Mobile 表单（默认关、折叠/展开）。
3. **Export 区内 merge**：`normalizeForLlmExport` + worktree `block.role` 修复 + 单测。
4. **U-A-U-A 管线**：domain vfs/chat logic + `UserVfsTurnService` + session pending 列 + checkpoint。
5. **VFS 入口改造**：Desktop IPC + Mobile VfsFileManager/FileEditor → `userVfsTurn.execute`。
6. **Agent 侧收窄**：`agent-runner` mutating-only capture + 移除 vfs markDirty；`run-agent-turn` 移除 user capture；**发送成功路径**内 flush。
7. **桥接弹窗 + Composer 三分支**：`hasToolResult` / `isPlainUserText` + Desktop/Mobile UI。
8. **会话 UX** + **hide-message 锚点**；移除删除/批量；edit hunk Transcript 展开。
9. **worktree 收窄** + 【工作树刷新】。
10. **集成测** + 更新 `agent-runner.test.ts` checkpoint 断言。

---

## 测试策略

### 分层（避免把 UI/集成误标为单测）

| 层 | 范围 | 运行 |
|----|------|------|
| **单测** | `domain/*/logic` 纯函数、zod schema、depth/hide 锚点 | `packages/core/test/**`，无 DB 或内存 sqlite fixture |
| **Service 集成** | `UserVfsTurnService`、pending 列 migration、checkpoint 收窄 | core fixture（`test/chat/`、`test/message-checkpoint/`） |
| **UI / E2E** | Composer 三分支、桥接弹窗、hide 多选勾选框 | Desktop/Mobile 手工或后续 e2e；**不单测覆盖** |

### 单测（domain 纯函数 — 必须）

| 模块 | 用例 |
|------|------|
| **validate-agent-prompt-layout** | persist 开：末块非 assistant → 失败；dynamic 开：仅 1 块 / 首非 assistant / 末非 user → 失败；**关**时不校验 |
| **render-prompt**（开关） | `persistEnabled=false` 跳过 persist；`dynamicEnabled=false` 跳过 dynamic；worktree 读 `block.role` |
| **normalize-for-llm-export** | persist 区内连续 user 文本 merge；persist\|chat 不 merge；**vfs 段**（`metadata.kind`）不与 plain chat merge；含 tool 块不 merge |
| **user-vfs-save-mapping** | 相等 no-op；新文件 write；锚点 edit；锚点不唯一 → write fallback；多 hunk |
| **action-xml-to-tool-uses** | delete/mkdir/rename/save-edit/save-write XML → 正确 tool 名与键结构 |
| **merge-pending-vfs-turns** | 3 次 pending FIFO → 1 组 actionsXml + 有序 tool_use id；**禁止**二次 ToolRunner（mock 不调用） |
| **compress-user-vfs-tool-uses** | edit/write/fs 字符串 → `"…"`；number/boolean 保留 |
| **format-tool-output** | write/edit/fs 突变成功 → `"ok"`；read/glob 不变 |
| **message-content-helpers** | `hasToolResult` / `isPlainUserText` 与 composer 三分支一致 |
| **resolve-hide-message-range** | startDepth=6、end=∞：depth6=assistant 正常；depth6=user → 锚更深 assistant；无 assistant → 不 hide；**其他 slice** 仍 min~max |
| **user-vfs-pending.schema** | 合法 JSON round-trip；缺 `actionXml` / `tools[].id` 拒绝 |

### Service 集成（必须）

| 模块 | 用例 |
|------|------|
| **migrate-chat-session-user-vfs-pending** | 旧库 ALTER 幂等；`phase3-migrations` 风格断言 |
| **SessionRepository pending 列** | push → 读回 → flush clear；fork 复制/清空（与 fork 定案一致） |
| **UserVfsTurnService** | execute 失败 **不**写 pending；成功写 pending；flush → **4 条**消息 + metadata；flush **不**重跑 tool；burst 3 次 → 1×U-A-U-A |
| **UserVfsTurnService + checkpoint** | flush 后 **仅 1 次** capture，锚 **tool_result** message |
| **run-agent-turn** | 发送成功前 flush；**移除** user 文本 capture |
| **agent-runner** | mutating tool 后 capture；纯文本 / 只读 tool **不** capture；**不** markDirty（用户 VFS 路径）；更新 L611 断言 |
| **append-tool-turn-bridge** | append 后末条 assistant `kind=tool_turn_bridge` |
| **hide-message.handler** | 接 `resolve-hide-message-range` 端到端（fixture 会话） |

### 集成场景（端到端 prompt / 会话）

| 场景 | |
|------|--|
| 改文件 → pending → 重载连接 → 发送 → 4 条含 `【done】` + prompt 正确 | |
| VFS 后带文字聊天 | 无桥接弹窗（末条已是 `【done】`） |
| maxSteps=2 → tool_result → 桥接 + user | UI 层；core 测 bridge append |
| 空请求末条 user | 不 append、flush 后跑 |
| `versionCheck` conflict | execute 失败、**无** pending |
| dynamic 启用 + chat 末 tool_result | prompt 末 user + dynamic 首 assistant 交替 |

### 本迭代不要求单测覆盖

| 项 | 原因 |
|----|------|
| hide/unhide **多选 UI**（仅 assistant/user 勾选框） | 渲染层；手工或 Mobile e2e |
| 桥接 **弹窗** 取消/确认 | UI；core 只测 append 逻辑 |
| Transcript edit-hunk **展开** | WebView 渲染 |
| Agent 编辑器 Switch **折叠样式** | UI |
| feature flag 关闭回退路径 | 可选 1 条 smoke |

### 与现有测试的关系

- 扩展：`validate-agent-prompt-layout.test.ts`、`render-prompt.test.ts`、`agent-runner.test.ts`、`run-agent-turn.test.ts`、`message-visibility.test.ts`
- 新增：`test/vfs/user-vfs-save-mapping.test.ts`、`test/chat/merge-pending-vfs-turns.test.ts`、`test/chat/user-vfs-turn.service.test.ts`、`test/depth/resolve-hide-message-range.test.ts`、`test/prompt/normalize-for-llm-export.test.ts`

---

## 现状与代码差距（探索复核 2026-06-13）

| 领域 | 现状（代码位置） | SPEC 目标 |
|------|------------------|-----------|
| VFS 写盘 | Desktop `vfs.ts` L89–121 直写 + `invalidateSessionWorktreeSnapshot`；Mobile `VfsFileManager` / `vfs-operations.service` 同 | `userVfsTurn.execute` + 不 markDirty |
| U-A-U-A / pending | **无**；`chat_session` **无** pending 列 | `user_vfs_pending_json` 列 |
| LLM 输入 | `buildPromptLlmInputFromLayout`（`render-prompt.ts` L183–219）+ `normalizeOrphanToolResultsForLlm` | + 开关跳过 + `normalizeForLlmExport` |
| persist/dynamic 开关 | schema **无** 布尔字段（`agent-definition.schema.ts` L68–76） | `persistEnabled` / `dynamicEnabled` default false |
| 布局校验 | `validate-agent-prompt-layout.ts` 无末 assistant / dynamic 首末 | 开关开启时新增 |
| worktree 合成 role | `syntheticWorktreeMessage` L91、`buildPromptAssemblyFromLayout` L134 **硬编码 user** | 读 `block.role ?? "user"` |
| system Switch 参考 | `agent-editor-state.ts` L47–51 `systemEnabled`（wire omit） | persist/dynamic **显式布尔** wire |
| Agent 编辑器 | `AgentEditorView` L557+ / `AgentEditorForm` L628+ 无 persist/dynamic Switch | 本迭代补齐 |
| checkpoint | `run-agent-turn.ts` L153 user capture；`agent-runner.ts` L271/328 每轮 capture | mutating-only；U-A-U-A 锚 tool_result |
| maxSteps 末条 | `agent-runner.ts` L342–354 止于 tool_result | **已符合**桥接触发前提 |
| Composer | `canResumeWithoutInput = last.role === 'user'`（Desktop L93、Mobile L55） | 三分支 + 桥接弹窗 |
| 隐藏/恢复 | Core **已有** `hideRange`/`showRange`（L226–241）；UI 单条 hide + `hideToolTurn` | seq 范围 + 角色门控 + 新入口 |
| 删除/批量 | Mobile/Desktop **均有** delete/batch | 删/藏移除；**hide/unhide 专用多选** |
| metadata | `ChatMessage.raw` 可空；Agent 仅写 provider raw | `raw.metadata.*` 约定 |
| repair-turn-boundary | **不存在**（grep 无匹配） | 不实现；保留 `resolveRollbackAnchorMessage` |
| 样例 Agent | `examples/agents.yaml` writer persist 末 user、dynamic 1 块 | 启用开关后不合规 |
| feature flag | **无** `userVfsUnifiedToolTurn` | 实现时落地 |

**Agent 块顺序**：编辑器与 `validateAgentPromptLayoutFromMaps` 使用 **map 插入顺序**（`agent-editor-state` 有序数组）；校验「末块 / 首块」须在同一有序列表上执行，不能按 name 字母序。

### PRD ↔ SPEC 对照（本轮复核）

| PRD 条目 | SPEC 覆盖 | 代码就绪 |
|----------|-----------|----------|
| U-A-U-A + burst | §会话形态 | ✗ |
| tool_use 压缩 | §tool_use 压缩 | ✗ |
| edit diff 展开 | §`<user-vfs-action>` + Transcript | ✗ |
| persist/dynamic Switch | §Prompt + wire 定案 | ✗ |
| checkpoint mutating-only | §Checkpoint + 锚点定案 | △ 部分（rollback 已符合） |
| 桥接弹窗 | §Tool turn bridge | △ maxSteps 末条已符合 |
| 隐藏/恢复 seq | §Transcript UX + hideRange 复用 | △ Core 有、UI 无 |
| worktree 不 dirty | §Worktree | ✗ markDirty 仍在 |
| LLM 区内 merge | §LLM Export | ✗ |

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| 旧 Agent 不满足新校验 | 保存时报错；用户手动改/删 |
| 末条 user 禁止输入与现有 composer 冲突 | UI 明确禁用 + 桥接例外 |
| transcript 四条 vfs 膨胀 | 后续迭代 hide 旧 turn；非本迭代 |
| checkpoint mutating-only | agent-runner 收窄后 capture 次数 |
| hideRange(1,S) 隐藏过多 | 多选 assistant + 确认文案 |

回滚：feature flag `userVfsUnifiedToolTurn`；关闭则恢复直接 VFS IPC + vfs markDirty + 旧 transcript 行为。

---

**状态**：PRD 已收敛；**架构对齐复核 2026-06-13**（对照 `ARCHITECTURE.md`）。**待用户确认 spec 后进入实现**。

---
