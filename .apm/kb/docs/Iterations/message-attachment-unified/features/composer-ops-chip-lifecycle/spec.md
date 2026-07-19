---
date: 2026-07-16
---

> **Supersede（Composer UI）**：双条有叉 attach / 确认进 chips 已被
> `composer-at-token-prompt-dedup` 与 `bugs/composer-two-pipelines-hard-contract` 废止。
> 现行：状态 chip 仅 workplace+user_ops 且无叉；文件引用仅正文 `@path`。

# composer-ops-chip-lifecycle 技术规格（SPEC）

## 需求来源

- Feature PRD：`Iterations/message-attachment-unified/features/composer-ops-chip-lifecycle/prd.md`
- 父级：`Iterations/message-attachment-unified/{prd,spec}.md`（本 Feature **局部 supersede**：Composer 双条、不可叉 ops/workplace、pending→kkv、draft→`chat_session`）
- 探索依据：Composer chip 双端、user_vfs_pending / flush、workplace suggest、clearSession 钩子、schema-align vs migration（2026-07-16）

## 设计目标

1. Composer **状态条（上，无叉）** vs **附件条（下，有叉）** 分行投影。
2. user_ops / workplace chip = **真源投影**（非可持久脱节的 chip 快照）；写盘 / 规则变更即时重算。
3. **生命周期分层**：pending ∈ session kkv（随 `clearSession`）；`{text, attach[]}` ∈ `chat_session`（不随 `clearSession`）。
4. 删除 `user_vfs_pending_json`（无历史迁移）；chip 文案 emoji 统一。

## 总体方案

```text
┌─ 真源 ─────────────────────────────────────────────────────────────┐
│ session_kkv: rule_snapshot | file_cache | user_vfs_pending (新)       │
│ chat_session.composer_draft_json: { text, attachments: attach-only } │
│ checkpoint / session VFS: flush / 投影 user_ops 净 path 的 baseline  │
└────────────────────────────────────────────────────────────────────┘
         │ 写盘成功 / 规则保存 / 打开 session / clearSession 后重读
         ▼
┌─ 投影 ─────────────────────────────────────────────────────────────┐
│ projectStatusChips(session):                                      │
│   workplace[] ← diffWorkplacePaths(live, file_cache keys)           │
│   user_ops[]  ← diffWorkspace vs last-send checkpoint（不清 pending）│
│ merge → UI 上条；下条 ← composer_draft.attachments (source=attach) │
└────────────────────────────────────────────────────────────────────┘
```

**关键不变**：发送时仍走现网 `flushPendingUserVfsTurns`（算净 diff → user_ops attachment → **清空 pending**）；状态条 chip **禁止**调用 flush 来「刷新」（否则会误清队列）。投影复用 `resolveFlushBaselineTree` + `resolveCurrentWorkspaceSnapshot` + `diffWorkspaceForUserVfsFlush`（或抽取共享 `previewUserOpsPaths`）。

**置位/压缩**：Core 已 `clearSession` → pending 一并空；App 成功钩子 **直接以空列表替换状态条**（不可再 `projectComposerStatus`：空 `file_cache` 会对 live 跑全量规则差集）。`composer_draft_json` **不删**。

## 最终项目结构（增量）

```text
packages/core/
  domain/session-kkv/model/session-kkv-domains.ts   # + USER_VFS_PENDING
  domain/chat/model/composer-draft.schema.ts      # 新增 wire
  domain/chat/model/user-vfs-pending.schema.ts      # 存储位改 kkv；schema 可复用
  bootstrap/chat/chat-schema.ts                   # + composer_draft_json；去 pending 列
  bootstrap/schema-migrations/*                   # 删 pending 列：表重建
  service/chat/impl/user-vfs-turn.service.ts      # pending ↔ kkv；+ preview paths API
apps/{desktop,mobile}/
  .../AttachmentDraftChips 或拆 StatusDraftChips   # 双条、emoji、可移除开关
  .../chat-composer-draft | ConversationPanel     # 读写作 chat_session；投影合并
```

## 变更点清单

| 区域 | 变更 |
|------|------|
| session kkv | 新域 `user_vfs_pending`（JSON 队列同现 wire）；常量进 `session-kkv-domains.ts` |
| chat_session | 加 `composer_draft_json TEXT NULL`（align ADD）；形状 `{ text, attachments }` 且 **attachments 仅 `source:'attach'`** |
| 删列 | `user_vfs_pending_json`：停读写 → DDL 新库无列 → migration 表重建旧库；align 项移除 |
| UserVfsTurn | load/save pending 走 kkv；新增「预览 path 集」（不清队列）；truncate-tail 改清 kkv 域 |
| 投影 | executeOp / 规则 suggest 后：推 **替换式** 状态 chip 列表（按 path），非 tool 名摘要累加 |
| UI | 上条：workplace+user_ops，无 ×；下条：attach，有 ×；文案 `📄`/`📁`/`✏️`+path；去目录强调色 |
| clear 钩子 | Desktop/Mobile 置位成功；Mobile 手动压缩；Desktop 补压缩成功分支；可选手动「重置常驻缓存」同清上条 |
| 测试 | Core pending kkv、preview≠flush、草稿列；双端 chip 文案/分行；置位后上条空正文保留 |

## 详细实现步骤

- Step 1 — phase-kkv-pending-domain — blocking: yes — qa: auto：新增 `SESSION_KKV_DOMAIN_USER_VFS_PENDING`；`UserVfsTurnService` 读写改 kkv；`hasPendingTurns` / flush / truncate-tail 跟迁；单测迁移断言。
- Step 2 — phase-drop-pending-column — blocking: yes — qa: auto：canonical DDL 去列；schema-migration 表重建删物理列；从 `SCHEMA_COLUMN_ALIGNMENTS` 移除 ADD；仓库 Port 删 get/set pending 列方法。
- Step 3 — phase-preview-ops-paths — blocking: yes — qa: auto：抽取/导出「相对 checkpoint 净 path 集」API（**禁止**内部 `savePendingQueue([])`）；`executeOp` 成功后可供 App 投影；单测：两次相反 edit → 空集；空 diff 不清 pending。
- Step 4 — phase-composer-draft-column — blocking: yes — qa: auto：`composer_draft_json` DDL+align+repo get/set；zod；Mobile/Desktop 读写取代纯内存 Map（Desktop 切会话按 sessionId 读写库）。
- Step 5 — phase-status-project — blocking: yes — qa: auto：统一 `projectComposerStatusAttachments(sessionId)`（workplace 差集 + user_ops paths → `MessageAttachment[]`）；规则变更与 executeOp 成功后 **整表替换** UI 上条数据源（可不经「累加 suggest」）。
- Step 6 — phase-dual-chip-ui — blocking: yes — qa: auto：双端拆条渲染 + emoji 文案 + 去目录 warning；下条 `onRemove` 仅 attach，并回写 `composer_draft_json`；单测翻转文案期望。
- Step 7 — phase-clear-hooks — blocking: yes — qa: auto：置位/压缩（及手动清 kkv）成功后 **直接清空** UI 上条（禁止再 project）；断言 draft 正文+attach 保留；Desktop `runCompaction` 补 ok 收尾。
- Step 8 — phase-send-wire — blocking: yes — qa: auto：发送仍 flush→合并 attachments；成功后 pending 已空 → 上条空；`composer_draft` 清空策略与现网一致（整清 text+attach）；空发门闩仍认 pending/文本/附件。
- Step 9 — phase-docs-parent-note — blocking: no — qa: auto：在父级 PRD/SPEC 加一行 supersede 指向本 Feature（可选同 PR 勘误「可单条删除」句）。
- Step 10 — phase-manual-smoke — blocking: no — qa: manual_user：双端杀进程恢复草稿；置位后上条空、下条与正文在；抵消 chip 消失。

## 数据与契约要点

### user_vfs_pending（kkv）

- Domain：`user_vfs_pending`；建议单键 `queue`（或现网 JSON 数组整存一 key）。
- Wire：保持 `{ actionXml, tools, createdAtMs }[]`（FIFO）；**chip 不读 tools 名**，只读投影 path 集。
- `clearSession`：整桶删除 → pending 消失（与 PRD 一致）。

### composer_draft_json

```ts
{ text: string; attachments: MessageAttachment[] } // attachments: source === 'attach' only
```

- `NULL` / 缺省 = 空。
- workplace / user_ops **不**持久进该列；每次打开用投影合并进 UI。

### Chip 文案

| source | type | label |
|--------|------|-------|
| workplace | * | `📄${path}`（path 以 `/` 开头则不再加多余空格：即 `📄/a.md`） |
| user_ops | * | `✏️${path}` |
| attach | file/text/… | `📄${path}` |
| attach | dir | `📁${path}` |

### UI 布局

```text
[ 状态条：输入框外上方 | 无叉 | workplace+user_ops | 空则 null ]
┌─ 输入框 ─────────────────────────────────────────────┐
│ [ 附件条：有叉横滑 | 仅 attach | 空则 null ]          │
│ [ 文本输入 … ]                                        │
│ [ 工具栏 ]                                            │
└──────────────────────────────────────────────────────┘
```

## 兼容性 / 迁移

- **不**迁移旧 `user_vfs_pending_json` 内容；升级后旧 pending 视为丢弃（产品已接受）。
- align **不能 DROP**；物理删列必须 schema-migration 表重建（参照 `saved-model-identity-v1`）。
- 父级「本期不做 composer_draft 落库」由本 Feature **正式落地**（挂 `chat_session` 而非 kkv）。

## 测试策略

### 测试用例

- T-OP1 — blocking: yes — Step 1/2：pending 仅存 kkv；旧列迁移后不存在 / 不再读写。
- T-OP2 — blocking: yes — Step 3：preview path 集与 flush 最终 path 集在相同磁盘下一致；preview **后** pending 仍非空。
- T-OP3 — blocking: yes — Step 3：同 path 写 A→写回 baseline → preview 空集。
- T-WP1 — blocking: yes — Step 5：规则差集 → 仅对应 `📄` attachment；再隐藏 → 投影空。
- T-UI1 — blocking: yes — Step 6：三类并存 → 上条 2 类无叉、下条 attach 有叉；emoji 断言。
- T-UI2 — blocking: yes — Step 6：目录 attach 无 warning 色类。
- T-LF1 — blocking: yes — Step 4/7：写 draft 列 → 模拟重启读回 text+attach；置位后读回 text+attach，上条投影空。
- T-SD1 — blocking: yes — Step 8：发送 flush 出 user_ops → pending 空 → 上条空。
- T-MN1 — blocking: no — Step 10：手工杀进程 / 置位 / 抵消（manual_user）。

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 误用 flush 刷新 chip → 队列被清 | API 命名隔离 + 单测 T-OP2 |
| Desktop 压缩无成功钩子 | Step 7 强制补 ok 分支 |
| condition 压缩无 UI | 依赖 clearSession 真源；下次投影自然空 |
| 双端 draft 一度两套存储 | Step 4 统一 chat_session；删内存 Map 为门面缓存 |
| 回滚 | revert Feature commits；migration 需反向 migration 或接受列重建不可逆（上线前冻结） |

## Context Bundle

```yaml
iteration_name: message-attachment-unified
feature_name: composer-ops-chip-lifecycle
requirement_path: Iterations/message-attachment-unified/features/composer-ops-chip-lifecycle/prd.md
spec_path: Iterations/message-attachment-unified/features/composer-ops-chip-lifecycle/spec.md
impact_files:
  - packages/core/src/domain/session-kkv/model/session-kkv-domains.ts
  - packages/core/src/service/chat/impl/user-vfs-turn.service.ts
  - packages/core/src/bootstrap/chat/chat-schema.ts
  - apps/mobile/src/components/chat/AttachmentDraftChips.tsx
  - apps/desktop/renderer/features/chat/AttachmentDraftChips.tsx
  - apps/mobile/src/storage/chat-composer-draft.ts
constraints:
  - preview ≠ flush
  - attach+text on chat_session; pending on session_kkv
  - no migration of old pending JSON
blocking_steps: [1, 2, 3, 4, 5, 6, 7, 8]
```
