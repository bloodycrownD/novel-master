---
date: 2026-07-23
---

# composer-chip-ops-annotate-recontract 技术规格（SPEC）

> **execute-ready。相对前稿：Undo 不再恢复手改**（废弃本轮手改旁路 / restored store / `hasRestoredUserOps`；批注仍从附件恢复）。

## 设计目标

重订 Composer 状态 chip 与规则快照合同：

1. **规则**一改立刻刷新 `rule_snapshot` 并清空 `file_cache`（懒加载回填）；不再出现「规则:」差集 chip，发送不再 materialize 本轮 `workplaceChange`。
2. **状态 chip 仅手改 + 批注**；`mkdir` 与建文件文案统一为「创建」。
3. **回滚**：盘仍滚 prior（现网不变）；**废弃本轮手改**（不反投影手改 chip）；**保留**从附件恢复工作区批注草稿 + chip（双端；Desktop 补齐）。
4. **置位 / 压缩**不清手改/批注 chip（及批注 store），类比不清正文；KKV 只清 `rule_snapshot` + `file_cache`。

需求来源：`Iterations/annotate-user-ops-unify/features/composer-chip-ops-annotate-recontract/prd.md`

## 总体方案

### 钉死决策（探索结论）

| ID | 决策 |
|----|------|
| D1 | 规则保存 → `refreshRuleSnapshot`（evaluate→写 canon）+ `clearDomain(file_cache)`；去掉 workplace 差集 suggest |
| D2 | Core `projectComposerStatusAttachments` **去掉 workplace 半边**；App 仍 ∪ annotate |
| D3 | `runAgentTurn` **删除/恒空** `materializeWorkplaceAttachments`；`hasWorkplaceDelta` 自可发/append **全链路删除** |
| D4 | 空发：无正文且无手改/批注 → 不可发；仅规则变更不可空发；门闩走 pending 投影 + `hasAnnotateDrafts`（仿现网 annotate），**无** `hasRestoredUserOps` |
| D5 | Undo 批注：双端 `parseAnnotateDraftsFromAttachments` + annotate store（新 mint id）；手改**不**反投影 |
| D6 | ~~Undo 手改旁路~~ → **废止**。Undo 后本轮手改作废：不建 `restoredUserOpsStore`、不 concat、不 `hasRestoredUserOps`；pending 随 truncate 清空。理由：盘已回发送前，不必再带回 Composer 再发 |
| D7 | 置位/压缩/Undo/手动重置：KKV 与状态条按场景表；见下「D7 场景表」 |
| D8 | `STATUS_CHIP_ZH.mkdir` / legacy：`建目` → `创建` |
| D9 | 历史 `source:workplace` / `workplaceChange`：气泡与提示词重放**只读兼容**；新路径不产出 |
| D10 | Undo 不收回规则变更导致的前缀新文件（预期） |

### D7 场景表（KKV × 状态条）

| 场景 | Core KKV | pending (`user_vfs_pending`) | annotate store | 状态条钩子（禁止整表 `attachments:[]` 当终态） |
|------|----------|------------------------------|----------------|------------------------------------------------|
| **置位** | `clearDomain(rule_snapshot)` + `clearDomain(file_cache)`；**废除** `clearSession` | **保留** | **不动** | 成功后：`projectComposerStatusAttachments`（ops）∪ annotate chip；**禁止**终态强制 `attachments:[]` |
| **压缩**（compaction ok） | 同上 | **保留** | **不动** | 同上 |
| **Undo / truncate** | 现网：清 `file_cache` + `user_vfs_pending`（`SESSION_KKV_COMPOSER_STATUS_DOMAINS`）；**不清** `rule_snapshot` | **清空**（本轮手改作废，不旁路恢复） | annotate 由反投影写入（可先空再填）；**无** restored 手改 store | UI **允许**先走清空钩子再反投影批注（D5）；终态为 project∪annotate，非永久空条；**无**手改 chip 来自被 Undo 消息 |
| **手动重置常驻** | **待拍板**（见下） | 随拍板 | 建议不动 annotate（与「重置常驻」语义无关） | 随拍板；若仍整表 `[]` 须在实现注标明会丢 ops 投影 |

**点名改动文件（置位/压缩路径）：**

| 文件 | 现网 | 目标 |
|------|------|------|
| `packages/core/src/service/chat/impl/message-transcript-effects.service.ts` | 置位成功 `clearSession` | 改为 `clearDomain(rule_snapshot)` + `clearDomain(file_cache)` |
| `packages/core/src/service/events/impl/event-orchestrator.service.ts` | 压缩成功 `clearSession` | 同上两域 `clearDomain` |
| `apps/desktop/src/main/services/notify-composer-status-after-kkv-clear.ts` | `attachments: []` 推送 | **废除**整表空为置位/压缩终态；改为 project∪annotate；函数可重命名或分场景重载 |
| `apps/mobile/src/services/project-composer-status.service.ts` → `refreshComposerStatusAfterSessionKkvCleared` | `attachments: []` | 置位/压缩调用方改为 project∪annotate；Undo 路径可保留「先空再反投影批注」 |

> **待拍板 / 实现注（手动重置常驻）** — **本轮不闭合，保持待拍板**  
> 产品未钉是否仍 `clearSession`（含 pending）。  
> **默认建议（实现可先按此编码）**：手动「重置常驻缓存」**仍** `clearSession`（含 `user_vfs_pending`），与置位/压缩收窄清域**不对称**——理由：入口语义是显式重置会话常驻缓存，现网 Desktop `handleWorkplaceCaptureSessionBlock` / Mobile `clearSessionWorkplaceKkv` 已是整表清。  
> **已知限制**：会清掉未发送手改 pending 与对应 chip；annotate 若钩子仍推 `[]` 且未再 ∪，也会被视觉抹掉（实现应在手动路径决定是否保留 App ∪）。若产品要与置位对称保留 pending，须改本默认并改 PRD 口径。
>
> **实现注（Undo 批注 vs prior 盘）**  
> 批注仍从锚点附件恢复草稿 + chip；盘已滚 prior。**批注原文按滚回后文件尽力匹配**（`originalText` 与现文件内容可能不完全一致时，以现网 annotate 恢复路径尽力对齐，不为此反投影手改）。

### `refreshRuleSnapshot` 签名 / 导出意向（P1）

```ts
/** 规则保存后：evaluate → 写 rule_snapshot canon → clearDomain(file_cache)。 */
async function refreshRuleSnapshot(
  sessionId: string,
  deps: {
    sessionKkv: SessionKkvPort;
    workplace: Pick<WorkplaceService, "evaluateRuleView">;
    // 或注入 ruleViewToSnapshotEntries + 写 canon 所需最小面
  },
): Promise<void>;
```

- 落地文件示意：`packages/core/src/service/workplace/refresh-rule-snapshot.ts`（或旁路 `assemble-workplace-display` 写快照支路）。
- **导出**：`@novel-master/core/workplace`（优先）公开；Desktop/Mobile 规则保存钩子只调此 API，**删除** workplace 差集 suggest / 投影。
- **不**在本 API 内改 Composer attachments；清 cache 后无规则 chip（投影已去 workplace 半边）。

### 架构示意

```text
规则保存 ──► refreshRuleSnapshot + clear file_cache ──► 无规则 chip
手改盘   ──► pending 门闩 + VFS diff 投影 chip ──► flush 落库
批注     ──► App annotateStore ──► ∪ chip ──► annotateDrafts 落库

Undo ──► truncate 清 file_cache + pending（必清；本轮手改作废，不旁路恢复）
     ──► UI 可先空状态条
     ──► 正文回填
     ──► 附件 → annotate store → App ∪ 重投影批注 chip（无手改 chip）
     ──► 再发：仅新 pending flush ∪ annotateDrafts（无 restored concat）

置位/压缩 ──► clearDomain(rule_snapshot) + clearDomain(file_cache) only
         ──► 保留 pending + annotate store
         ──► 状态条 = project(ops) ∪ annotate（禁终态 attachments:[]）
```

## 最终项目结构

```text
packages/core/
  domain/chat/logic/
    project-composer-status-attachments.ts   # 去 workplace
    status-chip-label.ts                     # mkdir→创建
    composer-sendable-input.ts / composer-send-intent.ts  # 去 hasWorkplaceDelta；无 hasRestoredUserOps
  service/workplace/
    refresh-rule-snapshot.ts                 # 新增；导出 workplace public
  service/agent/logic/run-agent-turn.ts      # 去 materialize；无 restored 旁路
  service/chat/impl/message-transcript-effects.service.ts  # 置位清域收窄
  service/events/impl/event-orchestrator.service.ts        # 压缩清域收窄
apps/desktop|mobile/
  规则保存钩子、kkv-clear 通知（禁[]终态）、Undo 接线（批注恢复；手改不恢复）、Composer 门闩
```

## 变更点清单

| 区域 | 变更 |
|------|------|
| Core 投影 | 去掉 `workplaceAttachmentsFromRuleDelta` |
| Core 规则 | `refreshRuleSnapshot`；导出 workplace public |
| Core 发送 | 去 materialize / `hasWorkplaceDelta`；空发门闩仅正文/手改 pending/批注（**无** restored） |
| Core 文案 | mkdir→创建 |
| Desktop/Mobile 规则钩子 | 调 `refreshRuleSnapshot`；删除差集 suggest |
| 置位/压缩 | Core 清域收窄；App 钩子改 project∪annotate；**废止**强制 `attachments:[]` 终态 |
| Desktop Undo | **对齐 Mobile 顺序**；批注恢复 + ∪ chip；**不**恢复手改 |
| 测试 | **废止/改写**旧 T-SR1 / T-SR1b / T-LF1 及「强制[]」类；新 T-CR*；**无** T-CR7 手改旁路 |

## 详细实现步骤

- Step 1 — phase-chip-label-mkdir — blocking: yes — qa: auto：`status-chip-label` mkdir→创建；改断言「建目」测试。
- Step 2 — phase-project-drop-workplace — blocking: yes — qa: auto：投影仅 user_ops；测无 workplace 半边。
- Step 3 — phase-refresh-rule-snapshot — blocking: yes — qa: auto：实现 `refreshRuleSnapshot`+clear cache；Desktop/Mobile 规则保存改调；差集 suggest 删除或空操作。
- Step 4 — phase-send-gate — blocking: yes — qa: auto：**空发全链路去 `hasWorkplaceDelta`**，列全改点：
  - `packages/core/src/service/agent/logic/run-agent-turn.ts`：删除/恒空 `materializeWorkplaceAttachments`；`hasInput` / `shouldAppendNewUser` **不再**读 workplace 差集；mergedAttachments 去掉 `workplaceAtts` 前缀。
  - `packages/core/src/domain/chat/logic/composer-sendable-input.ts`：删除 `hasWorkplaceDelta` 字段与判定。
  - `packages/core/src/domain/chat/logic/composer-send-intent.ts`：删除 `hasWorkplaceDelta` 计算与返回字段（或恒 false 并标 deprecated→测删除）。
  - Desktop `ChatComposer` / `composer-send-intent`、Mobile `ChatComposer`：停止传入/依赖 workplace 差集可发。
  - 验收：**UI + Core** 在「仅规则变更 + 空正文 + 无 pending/批注」下均不可发（`sendDisabled` / `hasComposerSendableInput===false` / `runAgentTurn` 抛「消息不能为空」）。（对照 T-CR3 / T-CR4）
- Step 5 — phase-kkv-floor-compact — blocking: yes — qa: auto：按 D7 场景表改 `message-transcript-effects` / `event-orchestrator`；废止 Desktop `notify-composer-status-after-kkv-clear` 与 Mobile `refreshComposerStatusAfterSessionKkvCleared` 在置位/压缩路径的 `attachments:[]` 终态；改为 project∪annotate。
- Step 6 — phase-undo-annotate-desktop — blocking: yes — qa: auto：Desktop Undo 接 `parseAnnotateDraftsFromAttachments` + store + chip；**顺序对齐 Mobile**（先 truncate/可先空条，再正文+反投影批注）；**不**做手改反投影 / restored store。
- Step 7 — ~~phase-undo-ops-bypass~~ — **删除**（前稿 D6 手改旁路整步废止；无独立实现步）。
- Step 8 — phase-history-compat — blocking: yes — qa: auto：历史 workplaceChange 气泡文案仍可「规则:」；新规则保存不产生 chip；prepare 重放旧附件不炸。
- Step 9 — phase-manual-chip — blocking: no — qa: manual_user：双端：改规则无 chip 且不能空发；手改+批注 chip；Undo 后正文+批注可恢复、手改 chip 不恢复；置位/压缩后 chip 仍在。

## 测试策略

### 测试用例

- T-CR1 — blocking: yes — `mkdir` chip/气泡文案为「创建」。（→ Step 1）
- T-CR2 — blocking: yes — 规则保存后状态投影无 `source:workplace`；snapshot 已更新；file_cache 域空。（→ Step 2–3）
- T-CR3 — blocking: yes — 仅规则变更 + 空正文 + 无手改/批注 → **UI 与 Core 均不可发** / 不 append user。（→ Step 4）
- T-CR4 — blocking: yes — 有手改（pending）或批注可发；发送后本轮 chip/批注清空（既有一次性）。**无** restored / `hasRestoredUserOps` 分支。（→ Step 4）
- T-CR5 — blocking: yes — 置位或压缩后：pending 仍在（若有）；状态条仍见手改/批注；正文保留；**终态不是** `attachments:[]`。（→ Step 5）
- T-CR6 — blocking: yes — Desktop Undo：批注草稿恢复 + 批注 chip；伪 `__message__:` 跳过；顺序同 Mobile；**手改 chip 不出现**。（→ Step 6）
- T-CR7 — ~~Undo 手改旁路再发~~ — **废止**（相对前稿；不再测 restored concat / 门闩）。
- T-CR8 — blocking: yes — 历史消息含 workplaceChange：UI 可展示；新会话规则保存不新增规则 chip。（→ Step 8）
- T-CR9 — blocking: no — 双端手工验收清单。（→ Step 9）

### 旧用例废止 / 改写（显式 supersede）

| 旧用例 / 合同 | 归属 | 本 SPEC 处置 |
|---------------|------|--------------|
| **T-SR1 / T-SR1b**（仅规则差集 / `hasWorkplaceDelta` 可空发；materialize `workplaceChange`） | `chat-send-render-refactor` | **废止可空发语义**；改为 T-CR3（不可发）+ 历史只读兼容 T-CR8。测文件中依赖 `hasWorkplaceDelta===true` 可发的断言须改写或删除。 |
| **强制 `attachments:[]`**（置位/压缩/kkv-clear 后状态条必须空） | `composer-ops-chip-lifecycle` / Desktop `notify-composer-status-after-kkv-clear` / Mobile `refreshComposerStatusAfterSessionKkvCleared` | **废止为置位/压缩终态**；改 T-CR5（保留 ops∪annotate）。Undo 路径「先空」仅作中间态。 |
| **T-LF1**（`clearSession` 后状态投影空；置位后 attach 投影空） | `sqlite-session.repository` / chip-lifecycle | **改写**：置位/压缩后 pending 保留则 ops 投影可非空；「整表 clearSession → 投影空」仅适用于删除会话 /（默认）手动重置常驻，**不再**描述置位/压缩。 |
| chip-lifecycle「无叉条必须清空」对规则差集 / 置位压缩 | `composer-ops-chip-lifecycle` | 由本 Feature **局部 supersede**（见 PRD）。 |
| **前稿 T-CR7 / D6 手改旁路**（`restoredUserOpsStore` / `hasRestoredUserOps` / concat） | 本 Feature 前稿 | **废止**；Undo 手改不恢复。 |

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 去掉强制 `[]` 后空 cache 再次灌满规则 chip | 投影已无 workplace 半边；双重保险 | 恢复钩子仅过滤 workplace |
| Undo 后用户期望手改 chip 仍在 | 产品已钉：盘 prior + 本轮手改作废；PRD/验收明示 | 若改口再议旁路（不在本 SPEC） |
| 置位保留 pending 与可见域变化 | 产品接受；D7 文档说明 | 置位改回清 pending（须改 PRD） |
| 手动重置与置位清域不对称 | **已知限制 + 默认 clearSession**（待产品拍板，本轮不闭合） | 产品拍板后改一处钩子 |
| 旧测试 T-SR1/T-LF1 / 强制[] 语义翻转 | 上表显式废止/改写 | — |
| 历史 workplace 提示词重放 | 保留 prepare 分支 | 不删 schema |
| 批注恢复与 prior 盘原文不一致 | 实现注：尽力匹配 | 可降级为仅恢复 chip 文案侧 |

## 兼容性与迁移

- **不要求** DB 迁移。
- 旧消息 `source:workplace` 附件保留；新发送路径不再生。
- `composer-ops-chip-lifecycle` 中「置位/压缩清空无叉条」「规则差集 chip」由本 SPEC **局部 supersede**。
- `message-attachment-unified` / `chat-send-render-refactor`「规则变更不刷 snapshot / 仅差集可空发 / T-SR1*」由本 SPEC **局部 supersede**。
- 父迭代 SPEC（`annotate-user-ops-unify/spec.md`）增加指向本 Feature 的 supersede 指针（workplace 差集 chip / 空发 / mkdir 文案等由本 Feature 接管处）。
