---
date: 2026-07-14
---

> **Supersede（Composer UI）**：双条有叉 attach / 确认进 chips / 正文「可叉 `@` chip」叙述已被
> `composer-at-token-prompt-dedup` 与 `bugs/composer-two-pipelines-hard-contract` 废止。
> 现行：状态 chip 仅 workplace+user_ops 且无叉；文件引用仅正文 `@path`。

# 常驻工作区与消息附件 技术规格（SPEC）

> **PRD**：`.apm/kb/docs/Iterations/message-attachment-unified/prd.md`  
> **需求策略**：一期整体交付（高耦合）；允许先通后精，深 CR 收口。  
> **Supersede 实现口径**：
> - [`worktree-engine-convergence`](../worktree-engine-convergence/spec.md) — capture 白名单、`SessionWorktreeBlockStore`、lazy `getCapturedBlockOrCapture`、手动「工作树快照」
> - [`message-set-floor`](../message-set-floor/spec.md) — 置位成功后 `captureSessionWorktreeBlock` → 改为 **clear session kkv**
> - [`vfs-user-ops-unified-tool-turn`](../vfs-user-ops-unified-tool-turn/spec.md) — flush 落 UA 两段 + `user_vfs_turn` 卡片用户形态
> - [`agent-worktree-block-ui`](../agent-worktree-block-ui/prd.md) — 用户文案「工作树」→「常驻工作区」（wire `type:"worktree"` **可保留**）
> - [`composer-ops-chip-lifecycle`](features/composer-ops-chip-lifecycle/spec.md) — Composer **双条**、pending→kkv、draft→`chat_session`、ops/workplace **不可叉**（本 Feature 局部 supersede）
> - [`composer-at-token-prompt-dedup`](features/composer-at-token-prompt-dedup/spec.md) — 再局部 supersede：`@` 以输入框 token 为准、提示词 path 去重/短提示、assemble→prepare+S0、去 UA 折卡、回填不写 attach chip（契约以该 Feature 为准）
>
> **废止（以 Feature `composer-at-token-prompt-dedup` 为准）**：
> - **历史 UA 只读折卡** / 验收 **T-UO2**（`matchUserVfsTurnAtForDisplay` 折叠旧 UA 为工具卡）——改为普通气泡；替代测见该 Feature **T-UO2x**。
> - **每次文件 attach 均全文进提示词**——改为可见序首次全文、其后短提示（常驻前缀 path 计入已出现）；细则见该 Feature。

## 设计目标

1. **常驻工作区前缀**：以 session kkv（规则快照域 + 文件缓存域）替代进程内 capture 块；查看提示词 / token / Agent 发送共用执行引擎。
2. **附件增量**：message attachments + Composer 草稿承载 workplace 新 path、`@` 文件/目录、user_ops；**仅**经异步 `prepareUserMessagesForPrompt` hydrate + wrap 为 `<attachment>…</attachment><user-input>…`（`normalizeForLlmExport` 保持 sync）。提示词侧 path 去重 / 短提示见 [`composer-at-token-prompt-dedup`](features/composer-at-token-prompt-dedup/spec.md)。
3. **去 capture / 去 UA 卡**：删除五类 capture、手动快照、lazy capture；新会话不再写 UA 对。~~旧 UA 只读兼容展示~~ **已废止**（见上；旧消息按普通气泡，不再折卡）。
4. **Composer 双端改版**：Mobile 大框 + 框内「更多/@/发送」；Desktop 补 `@`；文件引用选择器；附件 chip（文件引用 chip / `@token` 口径以 Feature 为准）。
5. **最小兼容**：checkpoint 写盘时机不变；Explorer/`$filetree` 仍实时规则引擎不读 kkv。

## 总体方案

### 架构总览

```text
┌─ 实时轨（不变）─────────────────────────────────────────┐
│ 规则表 → 规则引擎 → Explorer list / {{$filetree}}        │
└──────────────────────────────────────────────────────────┘

┌─ 常驻工作区轨（新）─────────────────────────────────────┐
│ Agent layout 含 type:worktree 块？                       │
│   N → 不注入常驻前缀、不写 kkv                           │
│   Y → 执行引擎：                                         │
│         read 规则快照域 ──空──▶ 规则引擎 → write 快照    │
│         for each {path,status≠hidden}:                   │
│           read 文件缓存域 ──miss──▶ VFS → write 缓存     │
│         renderFileBlock → join → worktreeDisplay         │
│ 清空：新建会话 / 置位 / 手动压缩 / condition 压缩(同清) │
└──────────────────────────────────────────────────────────┘

┌─ 附件轨（新）───────────────────────────────────────────┐
│ ComposerAttachmentDraft (session)                        │
│   ← 规则变更差集 (workplace paths, content=null)         │
│   ← @ 选择器 / 手输 @path (attach)                       │
│   ← executeOp 成功后的 ops 摘要 (user_ops, 仍即时写盘)   │
│ Send → content_json=纯原文；attachments_json=结构化附件  │
│ prepareUserMessagesForPrompt（async）：                 │
│   hydrate + wrap → <attachment>…</attachment><user-input>│
│ → normalizeForLlmExport（sync zone merge；禁附件 merge） │
└──────────────────────────────────────────────────────────┘
```

### PRD 未定点的 SPEC 默认决策

| 议题 | 默认 |
|------|------|
| **规则变更后规则快照域** | **不刷新**。常驻前缀继续用旧快照（前缀稳定）。差集用 **实时规则引擎结果 vs 文件缓存域已有 key** 算未加载 path → Composer `workplace` 草稿。下次 **清空 kkv 后** 拼装才重写规则快照。 |
| **condition 压缩** | 与手动压缩一致：**清空 session kkv**。 |
| **文件缓存与写盘** | 见下节「write / edit 与 `file_cache`」：**仅整文件 `write` 成功 → upsert `full:{path}`**；**`edit` / `delete` / `rename` / `move` 均不碰 `file_cache`**（保守：避免删→回滚→再引用时误判为首次加载而重复拼接）。整桶清空仅置位/压缩/删会话。 |
| **大目录 @** | 递归深度默认 **无硬限制**；单次拼装若 UTF-8 总长 > **512KiB** 截断并在树末追加 `[truncated]` 注释行（可调常量）。 |
| **二进制 / 图片 @** | 本期按 **filename** 档进缓存（仅 basename 行）；不塞 base64。 |
| **历史 UA** | **已废止「只读折卡」**（原：`matchUserVfsTurnAtForDisplay` 折叠旧 UA 为卡片）。现口径：旧 `user_vfs_action` / ack 按普通气泡渲染；**新路径绝不再 flush UA**。见 [`composer-at-token-prompt-dedup`](features/composer-at-token-prompt-dedup/spec.md)。 |
| **空发续跑** | trim 非空 **或** `attachments` 非空 **或** pending→将产生 `user_ops` → **等价于有输入**；可不要求文字。末条 plain user 禁带字规则：若仅刷新附件续跑，SPEC 允许「仅附件 + allowResume」走 prepare 重排。 |
| **Wire** | 保留 `type:"worktree"` / `name:"canon"`；UI 文案改「常驻工作区」。 |
| **session kkv 物理表** | 新表 `session_kkv_entry`，**不**复用全局 `kkv_entry`。 |
| **content_json vs wrap** | **策略 A（唯一路径）**：`content_json` **永不**写 wrap XML；仅存用户可读原文。hydrate + wrap 只发生在异步 `prepareUserMessagesForPrompt`（见下节）。 |
| **手输 `@path`** | 发送时从正文扫描 `@` token → 生成/合并 `source:attach`；已在 chips 则按 path **去重**；扫描到的 token **保留在正文**（用户可见 `@path`），并仍写入 `attachments`（禁止「只写字不入库」）。 |
| **Desktop 规则差集推送** | **新 IPC `composerAttachmentsSuggest`**（载荷 `{ sessionId, attachments }`）。**不**扩展现有 `workspaceMutated`（关闭二选一歧义）。 |
| **`diffWorkplacePaths` 命中口径** | 同 path 在 `file_cache` **任一 status key**（`full:` / `header:` / `filename:`）命中即视为已加载；**不因** status 不同再推 workplace 草稿。 |

### 数据模型

#### `session_kkv_entry`

```sql
CREATE TABLE IF NOT EXISTS session_kkv_entry (
  session_id TEXT NOT NULL,
  domain TEXT NOT NULL,   -- 'rule_snapshot' | 'file_cache'
  key TEXT NOT NULL,
  value TEXT NOT NULL,     -- JSON string
  PRIMARY KEY (session_id, domain, key)
);
CREATE INDEX IF NOT EXISTS idx_session_kkv_session ON session_kkv_entry(session_id);
```

| domain | key | value 语义 |
|--------|-----|------------|
| `rule_snapshot` | `canon`（单键） | `[{ "path": string, "status": "full"\|"header"\|"filename" }, …]`（**不含 hidden**） |
| `file_cache` | `{status}:{path}` 如 `full:/a.md` | `{ "body": string, "mtimeMs": number }` |

Port：`SessionKkvService` — `get/set/delete/clearSession(sessionId)`；session delete 级联 `clearSession`。

#### `chat_message.attachments_json` 与 `content_json` 分工（策略 A）

- `alignSchemaColumns` 加列 `attachments_json TEXT NULL`。
- Wire（Zod）：

```ts
type MessageAttachment = {
  name: string;          // 展示名，常 = path；user_ops chip 用 tools 摘要标题
  source: "workplace" | "attach" | "user_ops"; // skill 预留不写
  type: "text" | "image" | "dir";
  content: string | null; // workplace/attach 落库长期可为 null；user_ops 见下
  path?: string;          // workplace/attach 的逻辑 path
};
```

| 字段 | 存什么 | 不存什么 |
|------|--------|----------|
| **`content_json`** | 用户可读正文：**推荐 = 纯原文**（与现网 plain text 用户气泡一致）。无附件时 = 用户打字；有附件时仍 = 纯原文（可空串）。 | **禁止**写入 `<attachment>` / `<user-input>` wrap XML |
| **`attachments_json`** | 结构化 `MessageAttachment[]`；workplace/attach 的 `content` 落库时 **可长期为 null**（发送时不强制 hydrate 进库） | wrap 后的 prompt 字符串 |

**user_ops `content`**：与现网 flush 同源的 **action XML**（非 JSON 序列化）。Composer chip 展示用 `name` / tools 摘要，不必把整段 XML 塞进 chip 文案。

**LLM 侧唯一 hydrate + wrap 入口（异步）**：抽出共用异步函数  
`prepareUserMessagesForPrompt(messages, runtime): Promise<ChatMessage[]>`（名称可议，下文以此为准）：

1. 遍历 messages；**跳过 hidden**（其 `attachments_json` 可仍在库，但不参与本函数输出侧的 hydrate/wrap）。
2. 对非 hidden 的 user 消息：读 `content_json` 原文 + `attachments`；
3. 对 `source=workplace|attach` 且 `content==null` 做 hydrate（file_cache / VFS，并可写回 `file_cache`）。**废止隐含期望「每次文件 attach 均全文」**：可见序非首次文本 attach → 短提示（不必读盘）；workplace 非首次 → 不进 wrap body；常驻前缀 path 先计入已出现。契约见 [`composer-at-token-prompt-dedup`](features/composer-at-token-prompt-dedup/spec.md)。
4. 有附件时产出 wrap 后的 **内存** user 正文（**不写回** `content_json`）：

```text
<attachment>
…segments…
</attachment>
<user-input>
{纯原文}
</user-input>
```

无附件且纯文字 → **不** wrap（恒等原文，降低回归）。

**必须调用 `prepareUserMessagesForPrompt` 的路径**（禁止各端各自 hydrate/wrap）：

| 路径 | 说明 |
|------|------|
| Core `agent-runner`（Agent 发送） | 在构造 LLM 请求前，对 session messages 先 `prepare…`，再进入 export |
| Desktop `buildSessionPromptInput` | 查看真实提示词 / token 计数同源拼装 |
| Mobile 等价 `session-prompt-input` | 与 Desktop 同语义 |
| 任何「查看真实提示词 / token 计数」入口 | 不得绕过本函数另写一份 wrap |

**`normalizeForLlmExport` 保持 sync**：

- **只做**现有 zone merge / 协议规范化；**不得**把 async hydrate 塞进该 sync API。
- 消费的是 **已经 wrap 过的内存 messages**（由上游 `prepareUserMessagesForPrompt` 产出）。
- **`canMergeAdjacent`（或等价）**：带非空 `attachments` 的 user 消息 **禁止**与相邻 plain chat merge——待遇同旧 `VFS_SEMANTIC_KINDS`。实现可选：新增 `ATTACHMENT_KINDS` 元数据，或直接判定 `attachments?.length > 0`（推荐后者，少引入隐式 kind）。

推荐调用序（发送 / 预览 / token）：

```text
load messages → prepareUserMessagesForPrompt (async hydrate+wrap, skip hidden)
             → normalizeForLlmExport (sync zone merge；attachments 禁 merge)
             → provider / serialize / count
```

**transcript / UI 消费原文**：气泡 `bodyText`、`editableText`、`undo_send` 回填、编辑重发 —— 一律读 `content_json` 原文，**不**把 wrap XML 写回库、也不在这些路径做 unwrap 依赖（因库内本无 wrap）。

**hidden 消息**：`attachments_json` **仍落库**；仅 **非 hidden** 消息的 attachments 经 `prepareUserMessagesForPrompt` 进入 prompt。hidden 消息的附件不进入 prompt。

#### Composer 草稿

- App 层（双端）会话内存 +（可选）session_kkv 第三域 `composer_draft` **本期不做落库**：与现网文本 draft 同生命周期即可。
- 草稿形状（双端对齐）：`{ text: string, attachments: MessageAttachment[] }`。
- Mobile：扩展现有 `chat-composer-draft` 为上述形状。
- Desktop：renderer state 同构。
- `user_ops` 草稿源：`executeOp` 成功后 **既写 `user_vfs_pending_json`（可保留作闸门）又推送到 UI draft**；或发送时从 pending 合成 attachments（推荐：**pending 仍存，发送前读 pending→合成 user_ops attachment，并镜像到 Composer chip**）。

### API / IPC 契约

端到端 wire（与 Step 5 / 7 / 11 交叉引用）：

| 层级 | 契约 |
|------|------|
| **Core 模型** | `ChatMessage.attachments?: MessageAttachment[]`（与 `attachments_json` 列双向映射） |
| **Core 写入** | `MessageService.append(…, { attachments?: MessageAttachment[] })`；repository insert/update **读写** `attachments_json` |
| **Core 读出** | repository → DTO/`ChatMessage` 填充 `attachments`；缺列/NULL → `undefined` 或 `[]`（实现任选，须单测 round-trip） |
| **Agent 发送** | `RunAgentTurnOptions`（或等价）增加 `attachments?: MessageAttachment[]` |
| **空发送判定** | `trim(text)` 非空 **或** `attachments.length > 0` **或** pending 非空且将合成 `user_ops` → 允许发送/续跑 |
| **Desktop** | `AgentRunRequest.attachments?`；`ChatMessageDto.attachments?`；规则差集 → **新 IPC `composerAttachmentsSuggest`**（见下） |
| **Mobile** | agent-run payload 带 `attachments?`；composer draft `{ text, attachments }` |

规则变更 → Composer 草稿推送（**单一回调形状**）：

```ts
{ sessionId: string, attachments: MessageAttachment[] }
```

- **Desktop（拍板）**：**新 IPC `composerAttachmentsSuggest`** 推送上述载荷。比扩展 `workspaceMutated` 更清晰；**禁止**再走「扩展 workspaceMutated / 二选一」歧义。`workspaceMutated` 职责不变（导航刷新等），**不含** Composer 附件建议。
- **Mobile**：同回调形状写入/合并 `chat-composer-draft.attachments`（形状已含 `text`）。

### 执行引擎（替换 capture）

新建 `assembleWorkplaceDisplay(scope, runtime): Promise<string>`：

1. 若 agent layout **无** worktree 块 → 返回 `""`，不触 kkv。
2. `get(sessionId, rule_snapshot, canon)`；空 → `evaluateWorktreeRuleView` → 过滤 `hidden` → 映射 `DisplayState` → `set` 快照。
3. 对每条 `{path,status}`：`get(file_cache, status:path)`；miss → `vfs.read` → `set`。
4. `renderFileBlock` + `joinFileBlocks`（复用 `worktree-display.ts`）。

调用点替换所有 `getCapturedBlockOrCapture` / `captureSessionWorktreeBlock`：

- `run-agent-turn.ts`、`agent-runner.ts`
- Desktop/Mobile `session-prompt-input.service.ts`
- CLI `prompt/commands.ts`（最小：改为 assemble，避免崩）

### 清空 kkv 入口

| 事件 | 行为 |
|------|------|
| `sessions.create` | 新 session 无行（天然空） |
| 置位成功（双端 handler） | `sessionKkv.clearSession`；**删除** capture |
| 手动压缩成功 | 同上 |
| condition 压缩成功（orchestrator / runner 后） | 同上 |
| `sessions.delete` | clearSession |

### 规则变更 → workplace 草稿

规则保存成功（Desktop worktree handlers / Mobile `VfsFileManager`）后：

1. **不** capture。
2. `live = evaluateWorktreeRuleView`（非 hidden paths）。
3. `needed = diffWorkplacePaths(live, cacheKeys)`（见命中口径；**计入** attach 已写入的 `file_cache` keys，故 `@` 过的 path 不再重复出 workplace 草稿）。
4. `needed` 非空 → Desktop `composerAttachmentsSuggest` / Mobile 同形状回调 `{ sessionId, attachments }` → Composer 追加 `source:workplace`（`content:null`）。
5. 发送写入 message（`content_json` 原文 + `attachments_json`）；**`prepareUserMessagesForPrompt` 时再 hydrate**；workplace 附件段在 user 消息 wrap 内单独展示这些 path 的文件块（常驻轨仍用旧规则快照）。

核心纯函数：`diffWorkplacePaths(live, cacheKeys)` —— `cacheKeys` 为该 session `file_cache` 域全部 key 集合（含常驻 assemble 与 **attach hydrate 写入** 的 key）。

**命中口径（P1-diff-path-status）**：对 live 中每个 path，若 `cacheKeys` 中存在 **任意**  
`full:{path}` **或** `header:{path}` **或** `filename:{path}`，则视为**已加载**，**不**进入 `needed`。  
**禁止**「规则要求 `full`、缓存只有 `filename:` → 再推一条 workplace 草稿」这类因 status 不同重复通知。

#### attach / workplace 写 `file_cache` 的 status

| 场景 | DisplayState / status | 是否写 `file_cache` |
|------|----------------------|---------------------|
| `@` 文本文件 | `full` | 是，key `full:{path}` |
| `@` 二进制 / 图片 | `filename` | 是，key `filename:{path}` |
| `@` 目录叶子文本 | `full` | 是，key `full:{path}` |
| `@` 目录叶子二进制 | `filename` | 是，key `filename:{path}` |
| workplace 附件 hydrate | 用**规则引擎**对该 path 的 status；若规则已变且 path **不在**当前规则快照 / live 列表，**默认 `full`** | 是，key `{status}:{path}` |

`diffWorkplacePaths` 比较时：**计入**上表 attach（及 workplace hydrate）已写入的 keys；命中规则以上「任一 status key」为准。

#### write / edit 与 `file_cache`（写过 ≠ 局部改过）

语义：**整文件 write 过 ≈ 已加载全文**；**edit 不碰缓存**（局部变更既不写也不删）。

| 事件 | 对 `file_cache` 的动作 | 理由 |
|------|------------------------|------|
| Agent 工具 **`write`** 成功（入参含完整新正文） | **upsert** `full:{path}`（`body` = 写入正文，`mtimeMs` = 写后） | 权威全文已知，等同 hydrate |
| user_ops 中 **整文件 write**（如 save 走整文件覆盖）成功 | 同上 | 与 Agent `write` 同义 |
| Agent 工具 **`edit`** 成功 | **无操作** | 局部改动不碰缓存 |
| user_ops **edit**（hunk / 局部）成功 | **无操作** | 同上 |
| `delete` / 路径被移除 | **无操作**（保留已有 cache key） | cache 无版本；若删 key，则「删→回滚→再 `@`/差集」会误判首次引用而重复拼接；残留 key 最多使已删 path 仍算「已加载」，可接受 |
| `rename` / `move` | **无操作**（旧 path key 保留；新 path 不自动拷贝） | 同上保守策略；新 path 待 read/write/hydrate 再填 |

**不做**：因 VFS 突变清空规则快照域或整桶 session kkv（整桶清仅置位/压缩/`sessions.delete`）；不因 `write` 改写规则快照中的 status；**不因 delete/rename/move/edit 删 `file_cache`**。

拼装读盘：常驻 / hydrate 时若 VFS 已无该 path，用占位「(missing)」或跳过该块，**仍可不删** cache 行（实现任选是否 overwrite 为 missing 占位 body——默认 **不删行、miss 时再读 VFS 失败则占位进 prompt，不强制改 cache**）。

常驻 assemble 仍按规则快照的 `status` 选 key：若快照为 `header`，即使已有 `full:{path}`，仍读/补 `header:{path}`（`full` 命中仅影响 `diffWorkplacePaths`「已加载」与后续 `@`/assemble miss 优化）。

### 手输 `@path` 与选择器统一（发送时扫描）

手输与选择器产出 **同一 `source:attach` 附件模型**；差异仅在于何时入草稿 chips：

| 来源 | Composer 草稿 chips | 发送时 |
|------|---------------------|--------|
| `@` 选择器确认 | 立刻追加 attach chip | 并入 `attachments`（与正文合并） |
| 手输正文中的 `@path` | 可不提前建 chip | **必须**扫描正文 → 生成/合并 attach |

**发送时扫描规则（写死）**：

1. 从将发送的正文扫描 `@` 引用 token（与选择器 path 语义对齐的合法 path token）。
2. 与已有 chips / `RunAgentTurnOptions.attachments` **按 path 去重**后合并为 `source:attach` 条目（`content` 可 null）。
3. 扫描到的 token **保留在正文**（`content_json` 仍含用户可见 `@path`）；**同时**生成 `attachments` 条目——**禁止**只写字不入库。
4. **不**采用「剥离正文 `@path`、仅留 chip」方案（本期口径关闭）。

### `@` 目录树渲染

（仅 LLM wrap 路径产出；不写入 `content_json`。）

```xml
<attach>
  <dir path="notes/">
    <file path="notes/a.md">…</file>
    <dir path="notes/sub/">
      <file path="notes/sub/b.md">…</file>
    </dir>
  </dir>
</attach>
```

**禁止**把 `notes/**` 全部拆成顶层并列 `<file>` 而无 `<dir>` 包裹。

### user_ops 发送路径（替换 UA flush）

`runAgentTurn` 新序：

1. resolve model/agent  
2. 读取 pending（若有）→ `synthesizeUserVfsFlushActions`（或保留 diff 合成）→ 生成 `MessageAttachment[]`（`user_ops`，`content` = **现网同源 action XML**），**不** append UA 两段  
3. `clear pending`  
4. merge Composer `@` / workplace 草稿与 `RunAgentTurnOptions.attachments`；并对正文做 **手输 `@path` 扫描合并**（见上节）  
5. `messages.append(user, { blocks: textBlocks(纯原文 or "") }, { attachments })` —— **`content_json` = 纯原文**（可含可见 `@path`）；**`attachments_json` = 结构化附件**  
6. **禁止**在 append 时把 wrap XML 写入 `content_json`；hydrate + wrap **仅**经后续 `prepareUserMessagesForPrompt`（agent-runner / 预览 / token）  

停用：`flushPendingInTransaction` 的 UA insert；`prepareUserVfsTurnForAgentRun` 改为「仅附件合并 + 空续跑重排」不再插 ack。

**`TrailingUserSnapshot` 必须含 attachments（P1-trailing-snapshot）**：

- 空续跑重排路径（`prepareUserVfsTurnForAgentRun`：delete 末条 user → flush/合并 → re-append）暂存的 `TrailingUserSnapshot` **必须**包含 `attachments`（及现有 `content` / `raw`）。
- re-append 时传入 `attachments`，**禁止** delete+re-append 丢附件。
- 类型形状示意：

```ts
interface TrailingUserSnapshot {
  readonly content: MessageContent;
  readonly raw: ChatMessage["raw"];
  readonly attachments?: MessageAttachment[]; // 必随 content 一起暂存/写回
}
```

### Composer UI

| 端 | 改动 |
|----|------|
| Mobile | 废弃外侧发送行；`box` 内 toolbar：更多 / @ / 发送；chip 横滑 |
| Desktop | 在 more 与 send 之间插 `@`；更多菜单项：压缩、切换模型、切换 Agent；去掉快照菜单项 |
| 选择器 | 新建只读 Picker（复用 list/IPC，**不**嵌 `VfsFileManager` 整页）；多选文件 + 单目录确认 |

### 旧卡片

- 新消息：无 `user_vfs_action`/`ack` → `buildChatListItems` 不合成新卡。
- ~~旧消息：保留 matcher；可选后续迁移不在本期。~~ **已废止「历史 UA 只读折卡」**：列表不再调用 `matchUserVfsTurnAtForDisplay`；旧 UA 两段按普通 `message` 行渲染。见 [`composer-at-token-prompt-dedup`](features/composer-at-token-prompt-dedup/spec.md)（替代测 **T-UO2x**）。

## 最终项目结构（新增重点）

```text
packages/core/src/
  bootstrap/session-kkv/session-kkv-schema.ts          # NEW
  bootstrap/schema-align/…                             # attachments_json
  domain/session-kkv/…                                 # NEW ports/types
  domain/chat/model/message-attachment.schema.ts       # NEW
  domain/chat/logic/wrap-user-message-for-llm.ts       # NEW（prepare 内部调用）
  domain/chat/logic/prepare-user-messages-for-prompt.ts # NEW 异步 hydrate+wrap 共用入口
  domain/chat/logic/render-dir-attach-tree.ts          # NEW
  domain/chat/logic/scan-at-path-attachments.ts        # NEW 发送时手输 @ 扫描（可选文件名）
  domain/worktree/logic/rule-snapshot-codec.ts         # NEW 小改映射
  domain/worktree/logic/diff-workplace-paths.ts        # NEW（任一 status key 命中即已加载）
  domain/prompt/logic/normalize-for-llm-export.ts      # 改：attachments 禁 merge；保持 sync
  service/session-kkv/…                                # NEW
  service/workplace/assemble-workplace-display.ts      # NEW 执行引擎
  service/prompt/capture-session-worktree-block.ts     # DELETE 或变 thin clear 兼容
  service/prompt/impl/session-worktree-block-store…    # DELETE
  service/chat/impl/user-vfs-turn.service.ts           # 大改 flush
  service/agent/logic/prepare-user-vfs-turn-for-agent-run.ts # TrailingUserSnapshot+attachments

apps/mobile/src/components/chat/
  ChatComposer.tsx                                     # 大改
  AttachmentDraftChips.tsx                             # NEW
  FileReferencePicker.tsx                              # NEW
apps/desktop/renderer/features/chat/
  ChatComposer.tsx                                     # 加 @ + chips
  FileReferencePicker.tsx                              # NEW
```

## 变更点清单

| 区域 | 动作 |
|------|------|
| Core session kkv | 新表 + Port + clear on session delete |
| Core workplace assemble | 替换 BlockStore/capture/lazy |
| Core message | `attachments_json` + `ChatMessage.attachments`；append/repo 读写；`content_json` 永不写 wrap |
| Core `prepareUserMessagesForPrompt` | **NEW** 异步：hydrate + wrap；跳过 hidden；**唯一** user 附件拼装入口 |
| Core agent-runner / Desktop `buildSessionPromptInput` / Mobile session-prompt-input / 查看提示词·token | **必须**先调 `prepareUserMessagesForPrompt`，再 `normalizeForLlmExport` / serialize / count（交叉引用 **Step 6 / 11**） |
| Core `normalizeForLlmExport` | **保持 sync**；只做 zone merge；消费**已 wrap**内存 messages；**不得**塞 async hydrate；`attachments.length>0`（或等价）禁与 plain chat merge（同旧 `VFS_SEMANTIC_KINDS`） |
| Core user vfs turn | 停 UA flush；pending→attachment（action XML）；`TrailingUserSnapshot` **含 attachments**；delete+re-append 不丢 |
| Core 发送路径 | 手输 `@path` 扫描→合并 attach（正文**保留** token）；与 chips 去重 |
| Core `diffWorkplacePaths` | 同 path **任一** status key 命中即已加载 |
| Desktop handlers | 置位/压缩 clear kkv；规则变更 → **`composerAttachmentsSuggest`**；删快照；agent-run 带 attachments |
| Mobile handlers | 置位/压缩 clear kkv；规则变更写 draft；agent-run + draft 带 attachments |
| Composer 双端 | 布局 + 更多/@/chips + Picker；draft `{text,attachments}` |
| Agent 文案 | `WORKTREE_BLOCK_LABEL` → 常驻工作区 |
| Tests | 翻转 WEC capture 断言；新 assemble/attach/prepare/merge/diff/trailing/API 测 |

## 详细实现步骤

- Step 1 — phase-session-kkv — blocking: yes — qa: auto：DDL `session_kkv_entry` + `SessionKkvService` + session.delete 级联；单测 get/set/clear
- Step 2 — phase-workplace-engine — blocking: yes — qa: auto：`rule-snapshot-codec` + `assembleWorkplaceDisplay`；无 worktree 块短路；空快照跑规则引擎；文件缓存 miss→VFS；**write 成功 upsert `full:{path}`；edit/delete/rename/move 对 `file_cache` 无操作**（测 T-WP* + T-FC*）
- Step 3 — phase-retire-capture — blocking: yes — qa: auto：删除/停用 BlockStore、capture、lazy；runner/turn/prompt-input/cli 改 assemble；删除 allowlist「须 capture」测，改「须 clear / 须 assemble」
- Step 4 — phase-clear-hooks — blocking: yes — qa: auto：置位、手动压缩、condition 压缩成功 → `clearSession`；双端去掉 capture 调用
- Step 5 — phase-attachments-schema — blocking: yes — qa: auto：`attachments_json` 列 + Zod `MessageAttachment` + `ChatMessage.attachments` + repository / `MessageService.append` round-trip（见 **API / IPC 契约**）
- Step 6 — phase-wrap-user — blocking: yes — qa: auto：落地 `prepareUserMessagesForPrompt`（hydrate + wrap，跳过 hidden）+ `wrapUserMessageForLlm`；目录树渲染；attach 写 file_cache status 表；截断常量；`normalizeForLlmExport` **保持 sync**（禁塞 hydrate）且 **attachments 禁 merge**；单测 T-AT* + T-TX* + T-PR*；与 **Step 11** 交叉：发送/预览/token 调用点可本 Step stub、Step 11 收口
- Step 7 — phase-user-ops-attach — blocking: yes — qa: auto：flush 改产出 attachments（`content`=action XML）并入 append；**不**把 wrap 写入 content_json；不再 insert UA；pending 清空；`prepareUserVfsTurnForAgentRun`：`TrailingUserSnapshot` **含 attachments**，delete+re-append 不丢；~~旧会话展示回归测保留 matcher~~（**T-UO2 / 折卡已废止**，改见 Feature `composer-at-token-prompt-dedup` **T-UO2x**）；单测 T-UO1 / T-UO3 + T-TS1
- Step 8 — phase-rule-delta-draft — blocking: yes — qa: auto：`diffWorkplacePaths(live, cacheKeys)`（**任一 status key 命中即已加载**；计入 attach 已写 keys）；规则保存 → Desktop **`composerAttachmentsSuggest`** / Mobile 写 draft（载荷 `{ sessionId, attachments }`）；单测 T-RD*
- Step 9 — phase-composer-shell — blocking: yes — qa: manual_user：Mobile 大框 + 工具栏；Desktop `@`；更多菜单三项；删快照入口；文案「常驻工作区」
- Step 10 — phase-composer-draft-picker — blocking: yes — qa: manual_user：chips；FileReferencePicker 多选/目录；draft `{text,attachments}` 接到发送
- Step 11 — phase-wire-send — blocking: yes — qa: auto：`RunAgentTurnOptions.attachments`；Desktop `AgentRunRequest` / `ChatMessageDto.attachments`；Mobile agent-run + draft；**强制接线** `prepareUserMessagesForPrompt` → agent-runner、Desktop `buildSessionPromptInput`、Mobile session-prompt-input、查看真实提示词/token（交叉 **Step 6**）；发送时手输 `@path` 扫描合并（正文保留 token）；空发送判定（trim **或** attachments **或** pending→user_ops）；hidden 附件不进 LLM；单测 T-HD1 + T-AT5
- Step 12 — phase-cleanup-tests — blocking: yes — qa: auto：更新桌面/移动 capture 相关测；`pnpm test` core + 相关 app tests 绿

## 测试策略

### 自动化（Core 为主）

- **T-WP1** — blocking: yes — Step 2：无 worktree 块 → assemble 返回 `""` 且不写 kkv
- **T-WP2** — blocking: yes — Step 2：空 kkv + 有 worktree 块 → 写入 rule_snapshot + file_cache，display 含 `<file`
- **T-WP3** — blocking: yes — Step 2：二次 assemble 不重复 read VFS（mock vfs 调用次数）
- **T-WP4** — blocking: yes — Step 4：clear 后再度 assemble 重新跑规则引擎
- **T-FC1** — blocking: yes — Step 2/7：**Given** Agent（或 user_ops 整文件）`write` 成功；**When** 查 `file_cache`；**Then** 存在 `full:{path}` 且 body 与写入正文一致
- **T-FC2** — blocking: yes — Step 2/7：**Given** 已有 `full:{path}`；**When** Agent（或 user_ops）`edit` 成功；**Then** `file_cache` **不变**
- **T-FC3** — blocking: yes — Step 2/7：**Given** 已有 `full:{path}`；**When** VFS `delete` 或 `rename`/`move` 该 path；**Then** `file_cache` **仍保留**原 key（不因路径变更删 cache）
- **T-AT1** — blocking: yes — Step 6：仅 text 无附件 → wrap 恒等
- **T-AT2** — blocking: yes — Step 6：user_ops + text → export 含 `<user-ops>` 与 `<user-input>`；库内 `content_json` 仍为纯原文
- **T-AT3** — blocking: yes — Step 6：dir attach → export 含嵌套 `<dir>`，非顶层展平
- **T-AT4** — blocking: yes — Step 6：`@` 文本 → 写 `full:{path}`；`@` 二进制 → 写 `filename:{path}`
- **T-AT5** — blocking: yes — Step 11：**Given** 正文含手输 `@notes/a.md` 且 chips 无该 path；**When** 发送；**Then** `attachments_json` 含对应 `source:attach`，且 `content_json` **仍含** `@notes/a.md`（未剥离）
- **T-AT6** — blocking: yes — Step 11：**Given** chips 已有 `@notes/a.md` 且正文再写同一 `@notes/a.md`；**When** 发送；**Then** attachments **按 path 去重**仅一条
- **T-PR1** — blocking: yes — Step 6：**Given** 已 wrap 的带 attachments user + 相邻 plain user；**When** `normalizeForLlmExport`；**Then** **不** merge（与旧 VFS semantic 同待遇）
- **T-PR2** — blocking: yes — Step 6：`normalizeForLlmExport` 签名/实现仍为 **sync**（无 async hydrate 依赖）
- **T-UO1** — blocking: yes — Step 7：executeOp+flush/send 路径 **不** 产生 `user_vfs_action` 行
- **T-UO2** — ~~blocking: yes — Step 7：旧 fixture UA 两段仍能 match 展示卡~~ **已废止**（历史 UA 只读折卡）。替代：Feature [`composer-at-token-prompt-dedup`](features/composer-at-token-prompt-dedup/spec.md) **T-UO2x**（历史 UA → 普通 `message`，无 `user_vfs_turn`）
- **T-UO3** — blocking: yes — Step 7：user_ops attachment.`content` 为 action XML（非 JSON object 字符串）
- **T-TS1** — blocking: yes — Step 7：**Given** 空续跑重排且末条 user 带 attachments；**When** delete+re-append；**Then** 写回消息 `attachments` 与暂存一致（不丢）
- **T-RD1** — blocking: yes — Step 8：live 有新 path、cache 无 → diff 返回该 path；全命中（含 attach 已写 key）→ `[]`
- **T-RD2** — blocking: yes — Step 8：**Given** live 要求 path `full`、cache 仅有 `filename:{path}`；**When** `diffWorkplacePaths`；**Then** 该 path **不**在 needed（任一 status 命中即已加载）
- **T-SF1** — blocking: yes — Step 4：置位 handler **不** 调 capture（spy）
- **T-TX1** — blocking: yes — Step 6/11：**Given** 用户发送「你好」+ workplace 附件；**When** 落库后读 transcript；**Then** 气泡 / `bodyText` = `你好`（无 wrap XML）
- **T-TX2** — blocking: yes — Step 6/11：**Given** 同上一条消息；**When** 编辑或 `undo_send` 回填 Composer；**Then** 输入区 = 原文 `你好`，attachments 从 `attachments_json` 恢复（若产品支持），**不含** wrap 标签
- **T-TX3** — blocking: yes — Step 6/11：**Given** 同上；**When** 经 `prepareUserMessagesForPrompt` 后查看真实提示词 / token 拼 user 段；**Then** 可见 `<attachment>…</attachment><user-input>你好</user-input>`（与 agent-runner 同源）
- **T-HD1** — blocking: yes — Step 11：**Given** hidden user 带 attachments；**When** `prepareUserMessagesForPrompt`；**Then** 该条 attachments **不**进入 prompt；库内 `attachments_json` 仍在
### 手动（合并后）

- **T-UI1** — blocking: no — Step 9/10：Mobile Composer 布局与更多/@/发送
- **T-UI2** — blocking: no — Step 10：Picker 多选两文件 + 选目录进 chips
- **T-UI3** — blocking: no — Step 11：改规则后 chip 出现 path；发送后 transcript 无工具卡且气泡为原文；查看提示词含常驻+附件 wrap
- **T-UI4** — blocking: no — Step 4/11：置位后重启 App，常驻前缀按新快照重建（kkv 已清）

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 一期过大难合 | 步骤序仍建议 Step1→12；可用 feature flag `workplace.kkv` / `chat.attachments` **可选**，默认本期全开；若需回滚关 flag 恢复旧 capture+UA（仅当未删代码前） |
| 删 BlockStore 后旧测全红 | Step 3/12 集中改测；先绿再 UI |
| 前缀稳定 vs 规则变更 | 文档化「旧快照 + workplace 附件通知」；避免静默改常驻块 |
| 大库 file_cache | 清空时机严格；后续可加 LRU（非本期） |
| Composer 双端漂移 | 共享类型包或复制 wire schema 单测对齐 |
| 回滚 | Git 回退本迭代提交；DB 新表/列幂等保留无害；旧客户端忽略未知列 |

### 已知限制 / 实现注（P1，不挡开工）

> 第 3 轮审查残留；须在对应 Step 落地，**不**阻塞 Step 1 开工。

| 项 | 口径 |
|----|------|
| **checkpoint 锚点** | 去 UA 后，`messageCheckpoint.capture` 改挂到**带 `user_ops` 的那条 user `append` 成功之后**（不再锚 `user_vfs_action`）。写盘时机语义不变，仅锚点消息种类迁移。 |
| **空续跑门闩** | Trailing delete+re-append **仅**在 `allowResumeWithoutInput` 时启用；**禁止**「仅 attachments、非 resume」因 `trimmed===""` 误删末条 user。 |
| **prepare 时序** | `prepareUserMessagesForPrompt` 须排在 **regex 应用之后、layout 之前**；避免 wrap 产出的 XML 被正则改写。 |
| **wrap 后保留 attachments** | 内存消息经 wrap 后仍须带 `attachments` 字段，供 `normalizeForLlmExport` 的禁 merge 判定（不得因只改正文字符串而丢掉 attachments）。 |

P2 顺带：手输 `@path` 合法 token 先按「`@` 后至空白/行尾」截取 path；**中文路径允许**（与选择器 path 语义对齐即可，细节可后续精化）。

### 风险与实现注（P2 / 口径备忘）

| 项 | 口径 |
|----|------|
| **fork / copy 会话** | **不**复制 `session_kkv_entry`；新会话侧 kkv 为空，首次拼装重建 |
| **Desktop Footer** | 可 **保留** 顶栏/Footer 模型入口；Composer「更多」内切换模型不强制为唯一入口 |
| **PRD 中文 status** | PRD 中 status 中文仅为示意；实现与 SPEC 以 `full` / `header` / `filename` / `hidden` 英文枚举为准 |
| **二进制扩展名启发式（P2）** | `@` / hydrate 判定文本 vs 二进制可沿用扩展名启发式；误判风险接受，后续可换 MIME/探测 |
| **workplace `type=text` 默认（P2）** | 规则差集推送的 workplace 草稿默认 `type:"text"`（path 级、content=null）；目录特例不在 workplace 差集主路径 |
| **`updateContent` 保留 attachments（P2）** | 编辑用户消息正文时 **默认保留** 原 `attachments_json`；除非产品明确「编辑即清附件」——本期不要求清 |
| **`@path` token 边界（P2）** | 合法 token 先按「`@` 后至空白/行尾」的 path；中文路径允许 |

## 第 2 轮审查闭合表（after No-Go）

| ID | 裁决 | SPEC 落点 |
|----|------|-----------|
| **P0-preview-wrap-pipeline** | **Closed** | `prepareUserMessagesForPrompt` 异步共用入口；调用点含 agent-runner / Desktop `buildSessionPromptInput` / Mobile session-prompt-input / 查看提示词·token；`normalizeForLlmExport` 保持 sync、消费已 wrap 消息；attachments 禁 merge；变更点清单 + Step 6/11 交叉引用 |
| **P1-hand-type-at** | **Closed** | 发送时扫描正文 `@` → 合并 attach；chips 去重；**保留正文** `@path` 并入库 attachments |
| **P1-diff-path-status** | **Closed** | `diffWorkplacePaths`：同 path 任一 status key 命中即已加载；T-RD2 |
| **P1-trailing-snapshot** | **Closed** | `TrailingUserSnapshot` 含 attachments；delete+re-append 不丢；T-TS1 |
| **Desktop 推送通道** | **Closed** | **新 IPC `composerAttachmentsSuggest`**；关闭「扩展 workspaceMutated / 二选一」 |
| **P2 风险注** | **Noted** | 二进制扩展名启发式；workplace `type=text` 默认；`updateContent` 保留 attachments；`@path` 至空白/行尾、中文路径允许 |
| **P1 第3轮残留（不挡开工）** | **Noted** | 见「已知限制 / 实现注（P1）」：checkpoint 改锚带 user_ops 的 user append；空续跑门闩仅 allowResumeWithoutInput；prepare 在 regex 后、layout 前；wrap 后保留 attachments |

## Context Bundle（供实现）

```yaml
iteration_name: message-attachment-unified
requirement_path: Iterations/message-attachment-unified/prd.md
spec_path: Iterations/message-attachment-unified/spec.md
explore_summary: |
  现网=内存 BlockStore+五类 capture+lazy；UA flush 两段+工具卡；
  Composer Mobile 窄条/Desktop 已有 box 缺 @；无 session KV；
  VFSFileManager 不可整页复用为只读选择器。
  content_json=纯原文；hydrate+wrap 仅 prepareUserMessagesForPrompt；normalize sync；attachments_json 结构化。
  P1 残留(不挡开工)：checkpoint 锚带 user_ops 的 user append；空续跑仅 allowResume；
  prepare 在 regex 后 layout 前；wrap 后保留 attachments 供禁 merge。
impact_files:
  - packages/core/src/service/prompt/capture-session-worktree-block.ts
  - packages/core/src/service/agent/impl/agent-runner.ts
  - packages/core/src/service/chat/impl/user-vfs-turn.service.ts
  - apps/mobile/src/components/chat/ChatComposer.tsx
  - apps/desktop/renderer/features/chat/ChatComposer.tsx
constraints:
  - DisplayState: hidden|full|header|filename
  - 即时写盘不变
  - wire type worktree 可保留
  - content_json never stores wrap XML (strategy A)
  - prepareUserMessagesForPrompt is sole async hydrate+wrap entry
  - prepareUserMessagesForPrompt after regex, before layout
  - wrap keeps attachments for normalize forbid-merge
  - messageCheckpoint.capture after user append with user_ops (not user_vfs_action)
  - trailing delete+re-append only when allowResumeWithoutInput
  - normalizeForLlmExport stays sync; attachments forbid adjacent merge
  - Desktop composerAttachmentsSuggest IPC (not workspaceMutated)
  - write success upserts file_cache full:{path}; edit/delete/rename/move do not touch file_cache
blocking_steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
```
