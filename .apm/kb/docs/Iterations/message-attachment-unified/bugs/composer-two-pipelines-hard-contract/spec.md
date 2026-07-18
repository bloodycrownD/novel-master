---
date: 2026-07-18
agile_trace: true
---

# composer-two-pipelines-hard-contract 技术规格（SPEC）

> **PRD**：`.apm/kb/docs/Iterations/message-attachment-unified/bugs/composer-two-pipelines-hard-contract/prd.md`  
> **范围**：A — 硬合同锁定 + 清残留（死 API、过期测、文档 supersede、气泡误标）  
> **不含**：`runAgentTurn`/IPC `attachments` 旁路收紧；用 `@` 藏 chip 消叠显

## 设计目标

1. 把 Composer 两套管道硬合同落到可执行清理与回归测试上，杜绝再被接回 attach chip 或「用 `@` 控 chip」。
2. 主路径行为保持现状（已对齐）：只改残留与文档口径，不改提示词去重、不改发送 scan 合同。
3. 删除可构造 Composer 文件引用 chip 的死导出；默认组件 API 与唯一合法调用一致（无叉）。
4. Desktop 消息附件卡对 `attach` 使用独立文案，避免与状态「规则 ·」混淆。

## 需求来源

| 项 | 路径 |
|----|------|
| PRD | `Iterations/message-attachment-unified/bugs/composer-two-pipelines-hard-contract/prd.md` |
| 前置 | `composer-at-token-prompt-dedup`、`composer-at-token-tag-ux` |
| 否决修法 | `d9c55a21`（filter 用 `@` 藏 workplace）已由 `bd1817d0` revert |

## 总体方案

```text
硬合同（不变行为）
  Chip: ComposerStatusChips ← workplace + user_ops，showRemove=false
  引用: 正文 @path ← Picker/typeahead；发送 scanAtPathAttachments
  禁: filterStatus*ByAtPaths / 正文控 chip

清理（本 Bug）
  删 attachmentsFromPickerSelection（双端）
  删 mergeComposerAttachAttachments（Mobile）
  showRemove 默认 false（双端）
  修 Mobile draft 单测「不保留 attach」
  Desktop MessageAttachmentGroupCard：attach 独立 label
  旧 PRD/SPEC supersede 横幅 + dedup 指针
```

**现状约束（探索确认，勿重复实现）**

- 双端已无 `ComposerAttachChips`；仅 `ComposerStatusChips`
- `replaceComposerStatusAttachments` 已只返回投影（Core 已对齐）
- 全仓无 `filterStatusAttachmentsHiddenByComposerAtPaths`
- Composer 发送路径不传 draft attach；本档**不**改 `run-agent-turn` / IPC

## 最终项目结构（相对变更）

```text
apps/desktop/renderer/features/chat/
  FileReferencePicker.tsx          # 删 attachmentsFromPickerSelection
  AttachmentDraftChips.tsx         # showRemove 默认 false
  MessageAttachmentGroupCard.tsx   # attach 文案分支
apps/desktop/test/
  attachment-draft-chips.test.ts   # 可选补测；或新增 GroupCard label 测

apps/mobile/src/components/chat/
  FileReferencePicker.tsx          # 删 attachmentsFromPickerSelection
  AttachmentDraftChips.tsx         # showRemove 默认 false
apps/mobile/src/storage/
  chat-composer-draft.ts           # 删 mergeComposerAttachAttachments + 私有 helpers
apps/mobile/__tests__/
  chat-composer-draft.test.ts      # 断言改为不保留 attach

.apm/kb/docs/Iterations/message-attachment-unified/
  bugs/composer-two-pipelines-hard-contract/{prd,spec}.md   # 本文档（已落盘）
  features/composer-ops-chip-lifecycle/{prd,spec}.md        # supersede 横幅
  features/file-ref-picker-ux/{prd,spec}.md                 # supersede 横幅
  features/composer-at-token-prompt-dedup/prd.md            # 硬合同指针
  prd.md / spec.md                                         # 父级 supersede 横幅
```

## 变更点清单

### 1. 删除双端 `attachmentsFromPickerSelection`

- Desktop：`apps/desktop/renderer/features/chat/FileReferencePicker.tsx`
- Mobile：`apps/mobile/src/components/chat/FileReferencePicker.tsx`
- 保留 `atPathTokensFromPickerSelection`
- 实现前全仓再 `rg attachmentsFromPickerSelection`；若有测试 import 改为只测 token API

### 2. 删除 Mobile `mergeComposerAttachAttachments`

- `apps/mobile/src/storage/chat-composer-draft.ts`
- 一并删除仅被该函数使用的本地 `mergeAttachmentsByPath` / `attachmentDedupeKey`（若无其它引用）
- **勿删** Core 侧 scan 合并用的同名能力

### 3. `showRemove` 默认 `false`

- 双端 `AttachmentDraftChips.tsx`：默认参数改为 `showRemove = false`
- `ComposerStatusChips` 可保留显式 `showRemove={false}`（冗余可接受）或随后简化
- 注释写明：Composer 唯一合法路径为无叉状态 chip

### 4. Mobile 草稿单测对齐 Core

- `apps/mobile/__tests__/chat-composer-draft.test.ts`
- 用例标题：`整表替换状态条；不保留 attach`
- 期望：`replace` / hydrate 后 attachments **不含** `source:attach`，仅状态投影

### 5. Desktop 气泡 attach 文案

- `MessageAttachmentGroupCard.tsx`：**禁止**对 `source:attach` 调用会落入「规则 ·」分支的 `formatAttachmentChipLabel`
- 建议：组件内 `formatMessageAttachmentLabel`（或等价）
  - `workplace` → `规则 · ${path}`（可与 chip 一致）
  - `user_ops` → `改稿 · ${name}`
  - `attach` → `@${path}` 或裸 path（**禁止**「规则 ·」）
- 补 Desktop 单测：attach 文案不含「规则 ·」

### 6. 文档 supersede / 指针

在下列文件顶部（Front Matter 后）加简短横幅，指向本 Bug PRD 与 `composer-at-token-prompt-dedup`：

| 文档 | 废止要点 |
|------|----------|
| `composer-ops-chip-lifecycle/{prd,spec}.md` | 下条有叉 attach / 双条布局作为 Composer 现行验收 |
| `file-ref-picker-ux/{prd,spec}.md` | 「确认进 chips」；`attachmentsFromPickerSelection` 为废 API |
| `message-attachment-unified/{prd,spec}.md` | 正文「可叉 `@` chip」叙述 |
| `composer-at-token-prompt-dedup/prd.md` | 增加：UI 硬合同见 `composer-two-pipelines-hard-contract`；禁 `@` 藏 chip |

横幅示例：

```markdown
> **Supersede（Composer UI）**：双条有叉 attach / 确认进 chips 已被
> `composer-at-token-prompt-dedup` 与 `bugs/composer-two-pipelines-hard-contract` 废止。
> 现行：状态 chip 仅 workplace+user_ops 且无叉；文件引用仅正文 `@path`。
```

### 7. 明确不改

- `packages/core/.../run-agent-turn.ts` 的 `options.attachments`
- Desktop/Mobile IPC / wrapper 的 `attachments?`
- 任何 `filterStatus*ByAtPaths` 或等价 UI 过滤（禁止新增）
- Core `replaceComposerStatusAttachments` 实现（已正确）
- Mobile 气泡 `attachmentChipLabel`（无「规则 ·」误标）

## 兼容性与迁移

| 项 | 说明 |
|----|------|
| 行为 | Composer 用户可见行为不变（主路径已对齐） |
| API | 删除未使用的 deprecated 导出；仓外若有依赖需同步删 |
| DB | 无 migration |
| 草稿 wire | schema 仍可解析历史 `attach`；hydrate 继续丢弃 |

## 详细实现步骤

- Step 1 — phase-delete-picker-attach-api — blocking: yes — qa: auto：删双端 `attachmentsFromPickerSelection`；相关测只保留 token API
- Step 2 — phase-delete-merge-attach — blocking: yes — qa: auto：删 Mobile `mergeComposerAttachAttachments` 及私有 helpers；全仓无引用
- Step 3 — phase-show-remove-default — blocking: yes — qa: auto：双端 `showRemove` 默认 `false`
- Step 4 — phase-fix-mobile-draft-test — blocking: yes — qa: auto：Mobile draft 测改为不保留 attach
- Step 5 — phase-desktop-bubble-label — blocking: yes — qa: auto：GroupCard attach 独立文案 + 单测
- Step 6 — phase-docs-supersede — blocking: yes — qa: auto：旧文档横幅 + dedup 硬合同指针（文档 diff 可审）
- Step 7 — phase-verify — blocking: yes — qa: auto：跑 Desktop `attachment-draft-chips` / 相关 GroupCard 测；Mobile `chat-composer-draft` + `attachment-draft-chips`；确认 `rg` 无死 API、无 `filterStatus*ByAtPaths`
- Step 8 — phase-manual-smoke — blocking: no — qa: manual_user：双端 Composer：状态无叉 chip + `@` 引用；同 path 双显不被自动隐藏；选择器不产 attach chip

## 测试策略

| ID | Step | 场景 | 断言 |
|----|------|------|------|
| T-HC1 | 1 | `rg attachmentsFromPickerSelection` | 无 `.ts/.tsx` 命中（除文档叙述若有） |
| T-HC2 | 2 | `rg mergeComposerAttachAttachments` | 无实现/导出 |
| T-HC3 | 3 | `AttachmentDraftChips` 默认 | `showRemove` 默认 false；Composer 仍无叉 |
| T-HC4 | 4 | Mobile draft replace | attachments 无 `source:attach` |
| T-HC5 | 5 | Desktop GroupCard `attach` | label 不含「规则 ·」 |
| T-HC6 | 7 | `rg filterStatusAttachmentsHiddenByComposerAtPaths` | 无实现 |
| T-HC7 | 7 | Composer 仅 StatusChips | 无 AttachChips 挂载（既有集成测不回归） |
| T-HC8 | 8 | 真机/手工 | 硬合同冒烟（见 Step 8） |

### 非回归

- Core `project-composer-status-attachments.test.ts`「不保留 attach」
- Desktop/Mobile `attachment-draft-chips` T-UI1（`规则 ·` / `改稿 ·`）
- Desktop `composer-at-path` 高亮契约
- 回滚 / 编辑回填不恢复 attach chip（既有测）

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 仓外仍 import 死 API | Step 1/2 前全仓 rg；CI 编译失败即暴露 | 恢复导出并标 `@deprecated`（不推荐） |
| GroupCard 文案与 chip 不一致被挑刺 | 表内约定 attach 用 `@path`/裸 path | 仅 revert Step 5 |
| 文档横幅被忽略 | PRD 验收勾选 + 评审以本 Bug 为准 | 无代码影响 |

**整包回滚**：revert 本 Bug 实现 commits；保留本 `{prd,spec}.md` 或一并 revert（按发布策略）。

## Context Bundle（供实现参考）

```yaml
iteration_name: composer-two-pipelines-hard-contract
requirement_path: Iterations/message-attachment-unified/bugs/composer-two-pipelines-hard-contract/prd.md
spec_path: Iterations/message-attachment-unified/bugs/composer-two-pipelines-hard-contract/spec.md
scope: A
explore_summary: |
  主路径已对齐硬合同；清残留：双端 attachmentsFromPickerSelection、
  Mobile mergeComposerAttachAttachments、showRemove 默认 true、
  Mobile draft「保留 attach」测、Desktop GroupCard attach 误「规则 ·」、
  lifecycle/file-ref/父文档旧验收。
impact_files:
  - apps/desktop/renderer/features/chat/FileReferencePicker.tsx
  - apps/desktop/renderer/features/chat/AttachmentDraftChips.tsx
  - apps/desktop/renderer/features/chat/MessageAttachmentGroupCard.tsx
  - apps/mobile/src/components/chat/FileReferencePicker.tsx
  - apps/mobile/src/components/chat/AttachmentDraftChips.tsx
  - apps/mobile/src/storage/chat-composer-draft.ts
  - apps/mobile/__tests__/chat-composer-draft.test.ts
  - 相关 docs supersede
constraints:
  - 禁止新增 filterStatus*ByAtPaths
  - 不改 run-agent-turn / IPC attachments 旁路
  - 不改 Core replace 实现
blocking_steps: [1, 2, 3, 4, 5, 6, 7]
```
