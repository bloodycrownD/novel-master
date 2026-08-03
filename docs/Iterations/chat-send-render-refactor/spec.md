---
date: 2026-07-17
---

# 聊天发送与双渲染收束重构 技术规格（SPEC）

## 需求来源

- `Iterations/chat-send-render-refactor/prd.md`
- 前置：`message-attachment-unified`（产品不变量）；`composer-ops-chip-lifecycle`（双条 / pending 门闩 / 发送后清空）
- 本分支无生产历史，允许删除中间绕弯路径；supersede 见 PRD 表

## 设计目标

1. 固定发送归属：**编排 2 步（flush→append）+ runner 内 2 步（prepare/wrap + assemble）**；App 只传 `attach`（+ 正文 `@` 扫描由 Core 合并）；workplace 由 Core **materialize**。
2. UI / 真实提示词 = 对同一 DB message 的两种只读渲染；禁止第三套解析与 App/append wrap。
3. 常驻工作区单一 assemble；**状态条预览**与**发送 materialize 落库**分离。
4. 发送门闩 / 反 resume：可发含 workplace 差集；有差集禁纯 resume；真源差集由 Core 计算。
5. materialize 时序 **定案 A**：并入 `prepareUserVfsTurnForAgentRun` re-append merge；外层新 append 同级 merge。
6. 删除 features 分支上为修回归而叠的临时分叉（在不破坏 MAU / chip-lifecycle 产品不变量前提下）。

## 总体方案

```text
Composer（双端 ChatComposer）
  上条：workplace / user_ops 预览 chip（≠ payload；禁原样进 runAgentTurn.attachments）
  下条：attach 草稿 → Composer 显式传入的 attachments（仅 source===attach）
  可发门闩 hasComposerSendableInput：
    trim(text) 非空 | attach 数>0 | hasPendingUserOps | 状态条有 source:workplace（或 hasWorkplaceDelta）
  allowResumeWithoutInput：仅当无可发输入（含无 workplace 差集）且 canResume 时；
    有 workplace 差集 → 禁止 resume（差集=新输入）
       │
       ▼
runAgentTurn（编排；run-agent-turn.ts）
  hasInput = trim 非空 | attach(@扫描后) | hasPending | materialize(workplace)非空
    （真源差集由 Core 算，不依赖 App 传入 workplace attachments）
  有 workplace 差集 → 不得走「!hasInput && allowResumeWithoutInput」纯 resume
  1 prepareUserVfsTurnForAgentRun：
       flush pending → user_ops attachments（真源 XML；不信状态条预览）
       materialize workplace 差集（配方见 Step 2）
       空续跑 re-append（reAppended=true）：
         merge = trailing∪flush∪attach∪materialize（同级）→ 写回末条 user
         外层不再 append
  2 外层新 append（!reAppended）：
       merge = materialize ∪ attach ∪ @扫描 ∪ flush user_ops → append(user, textBlocks(plain), attachments)
       │
       ▼
agent-runner 每 step（唯一 wrap / assemble 调用点）
  3 prepareUserMessagesForPrompt(hydrate+wrap)  → 含 <workplace>/<user-ops>/<attach>
  4 assembleWorkplaceDisplay → layout → normalize → protocol map
       │
       ├─ 聊天 UI：list DB → message-blocks / WebView（原文 + 附件卡）
       └─ 真实提示词：同源 prepare + assemble（只读）
```

**不变量（保留）**：策略 A（content 原文）；`prepareUserMessagesForPrompt` 唯一 hydrate+wrap；三类附件语义（含发送后 `source:workplace` 可落库）；session kkv 双域；`normalizeForLlmExport` sync；chip-lifecycle 双条 + pending 门闩 + 发送后上条清空。

**废弃**：composer status 原样进发送；「workplace 永不进 `attachments_json`」；依赖 body 反解析 action XML 作为主 UI；无意义空 assistant 落库；空 `[]` 快照粘住；chip 仅跟 checkpoint 净 diff 而忽略 pending 门闩；App/append 路径 wrap；「仅 `📄` 空发误走纯 resume」。

## 最终项目结构

不变 monorepo 布局；逻辑收敛到：

| 层 | 职责 |
|----|------|
| `packages/core/.../run-agent-turn.ts` | **编排**：flush → materialize workplace → 合并 attach → append → 调 runner；`hasInput` / `shouldAppendNewUser` / 反 resume |
| `packages/core/.../prepare-user-vfs-turn-for-agent-run.ts` | flush；**定案 A**：re-append merge 含 materialize∪flush∪attach；返回供外层新 append 的 attachments |
| `packages/core/.../agent-runner.ts` | **唯一** prepare/wrap + assemble 调用点（每 step） |
| `packages/core/.../prepare-user-messages-for-prompt.ts` | 唯一 hydrate+wrap 实现 |
| `packages/core/.../assemble-workplace-display.ts` | 唯一常驻前缀 |
| `packages/core/.../project-composer-status-attachments.ts` | 状态条纯投影（非 payload）；workplace 半边与 materialize **同源配方** |
| `packages/core/.../diff-workplace-paths.ts` | `workplaceAttachmentsFromRuleDelta`（materialize / 状态条共用） |
| `packages/core/.../composer-sendable-input.ts` | `hasComposerSendableInput`：含 workplace 差集可发 |
| App Composer（Desktop/Mobile `ChatComposer.tsx`） | 分行 chip；显式 attachments **仅** `source===attach`；门闩 + 反 resume |
| App message-blocks / WebView | 原文 + attachments 卡（Mobile blocking 真源） |

## 变更点清单

图例：`change` = 本迭代须改实现；`retain+pin` = 行为保留，补/钉测试。

### Core

| 文件 | 类型 | 变更 |
|------|------|------|
| `composer-sendable-input.ts` | change | `hasComposerSendableInput` 增加「状态条有 `source:workplace` / `hasWorkplaceDelta`」为可发 |
| `run-agent-turn.ts` | change | 文档化编排 2 步；禁 status 原样；**materialize** workplace 差集；`hasInput` / `shouldAppendNewUser` 在 materialize 非空时为真；**有差集禁** `allowResumeWithoutInput` 纯 resume；过滤误传预览 chip |
| `prepare-user-vfs-turn-for-agent-run.ts` | change / retain+pin | **定案 A**：re-append merge 并入 materialize（与 flush/attach 同级）；去掉隐式旁路；**保留** delete/re-append；UI 回调 + attachments 不丢（T-SR8） |
| `diff-workplace-paths.ts`（`workplaceAttachmentsFromRuleDelta`） | retain+pin | materialize 与状态条 workplace 半边复用 |
| `project-composer-status-attachments.ts` / App 投影 | retain+pin | user_ops 以 `hasPendingTurns` 门闩；workplace 差集投影；发送后收敛清空；**≠** 发送 payload |
| `user-vfs-turn.service.ts` | retain+pin | flush/preview 语义钉死；与 chip 门闩一致；user_ops 只信 flush |
| `assemble-workplace-display.ts` | retain+pin | 空 `[]` 重评（已有则保留并测钉） |
| `openai-content-mapper.ts` | retain+pin | 跳过无 content 且无 tool_calls |
| `agent-runner.ts` | change / retain+pin | `hasMeaningfulAssistantBlocks`；每 step **唯一** prepare+assemble；禁旁路 wrap |
| `user-vfs-turn-view.ts` 等 legacy UA | change | 可删主路径或降为只读 stub |
| `feature-flags/user-vfs-unified-tool-turn.ts` | retain（可选删） | **本迭代定案**：保留开关、**默认 true**；行为按「统一 tool turn」恒开语义实现；删除见 Step 8 可选判据 |

### Mobile

| 文件 | 类型 | 变更 |
|------|------|------|
| `ChatComposer.tsx` | change | 显式 attachments 仅 `attach`；`hasComposerSendableInput` 含 workplace；有差集禁 `allowResumeWithoutInput`；append 成功后再清输入；pending 可发 |
| `message-blocks.ts` / `ChatTranscriptBridge` / WebView | change / retain+pin | 空正文+attachments 必进列表（**T-SR3 blocking**） |
| `MessageList.tsx`（legacy FlatList） | known-limit / delete-if-unused | **非** T-SR3 blocking；若仍被引用须满足「attachments 卡 + 空正文」完整契约，否则标 known-limit 或删除 |
| `project-composer-status.service.ts` | retain+pin | pending 门闩 |
| `user-vfs-action-transcript.tsx` | change | 按「废弃主路径」删除或仅旧数据 |

### Desktop

| 文件 | 类型 | 变更 |
|------|------|------|
| `ChatComposer.tsx` | change | 同 Mobile：显式仅 attach；门闩含 workplace；有差集禁 resume；materialize 在 Core |
| `message-blocks.ts` / `MessageList.tsx` | change / retain+pin | 空正文+attachments |
| `project-composer-status.service.ts` | retain+pin | pending 门闩 |
| `notify-composer-status-after-kkv-clear.ts` | retain+pin | 保留「清空后禁灌满投影」 |

## 详细实现步骤

- Step 1 — phase-contract-doc — blocking: yes — qa: auto — **retain+pin / change(注释)**：Core 模块头写死「编排 2 + runner 2 + 双渲染 + materialize 定案 A + 门闩/反 resume」；单测断言 wrap 不写库（T-AT2 类 / T-SR0）。
- Step 2 — phase-send-payload — blocking: yes — qa: auto — **change**：Composer 显式 attachments **仅** `source===attach`；Core **materialize**；门闩改造（T-SR1 / T-SR1b）。配方伪代码：

```text
// materialize workplace（与 projectComposerStatusAttachments 的 workplace 半边同源）
live = evaluateRuleView() → ruleViewToSnapshotEntries
       // 或 deps.loadLiveWorkplacePaths() 等价入口
cacheKeys = sessionKkv.listKeys(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE)
workplaceAtts = workplaceAttachmentsFromRuleDelta(live, cacheKeys)

// 入参清洗：误传的 workplace / user_ops 预览一律丢弃
composerAttachOnly = composerAttachments.filter(a => a.source === "attach")
// @ 扫描仍由 mergeAttachmentsWithScannedAtPaths 合并

// 合并（定案 A）
// - re-append 路径：在 prepareUserVfsTurnForAgentRun 内
//     merge(trailing, flushed user_ops, composerAttachOnly, workplaceAtts) → 写回
// - 新 append 路径：外层 append 前
//     merge(workplaceAtts, composerAttachOnly, @扫描, flushed user_ops) → append
```

  `hasComposerSendableInput` / 双端 Composer：可发含 workplace；`run-agent-turn.ts`：`hasInput`/`shouldAppendNewUser` 认 materialize 非空；有差集禁 `allowResumeWithoutInput`。
- Step 3 — phase-flush-chip — blocking: yes — qa: auto — **retain+pin / change**：`user_ops` 投影 `hasPendingTurns` 门闩；flush 后 `✏️` 空；workplace materialize + hydrate 后 `📄` 空（T-SR2 / T-SR2b）。
- Step 4 — phase-ui-empty-body — blocking: yes — qa: auto — **change**：`buildChatListItems` / WebView / ChatTranscriptBridge 展示空正文+attachments（T-SR3）；legacy FlatList 不纳入 blocking。
- Step 5 — phase-workplace-snapshot — blocking: yes — qa: auto — **retain+pin**：空 `rule_snapshot []` 重评；有可见文件时 assemble 非空（T-WP* / T-SR4）。
- Step 6 — phase-protocol-guard — blocking: yes — qa: auto — **retain+pin**：OpenAI 跳过无 content user；不落库无意义空 assistant（T-SR5）。
- Step 7 — phase-parity — blocking: yes — qa: auto — **retain+pin**：同一 fixture：append 后 `prepare` 与 `buildSessionPromptInput` 用户段一致（T-SR6）。
- Step 8 — phase-legacy-optional — blocking: no — qa: auto — **可选**：删除 UA 主展示路径；**可选**删除 `user-vfs-unified-tool-turn` flag（判据：全调用点已无 `false` 分支、默认 true 行为无回归、运维不再需要关断）。删前白名单：flag 文件 + 其读点 + 仅服务 `false` 分支的测；勿误删 unified 主路径。
- Step 9 — phase-trailing-optional — blocking: no — qa: auto — **定案：本迭代保留 delete/re-append**；本步补全 UI 回调测 + **定案 A** materialize 并入 re-append（T-SR8）。「改为 update attachments」仅作可选评估，禁止实现中途改选。
- Step 10 — phase-manual-smoke — blocking: no — qa: manual_user：Desktop+Mobile：pending 空发、@ 发送、仅 `📄` 空发（可发且非 resume）、规则变更 `📄`→发送→清空、真实提示词含 workplace、常驻前缀可见。

## 测试策略

### 测试用例

- T-SR0 — blocking: yes — 走读/注释契约：编排 flush→append；wrap/assemble 仅在 runner（及同源只读）；App/append 无 wrap；materialize 时序符合定案 A。
- T-SR1 — blocking: yes — Composer / `runAgentTurn` 入参 **不含** workplace/user_ops **预览 chip**（禁 status 原样）；发送后消息 `attachments_json` **允许且在有差集时应含** `source:workplace`（materialize）；`user_ops` 仅来自 flush。
- T-SR1b — blocking: yes — **门闩 / 反 resume**：**Given** 空正文 + 仅状态条 `📄`（无 attach、可无 pending）**When** 发送 **Then** App 可发（`hasComposerSendableInput` / 双端 `ChatComposer`）；落库含 `source:workplace`；Core `hasInput`/`shouldAppendNewUser` 为真；**未**置 `allowResumeWithoutInput` 或即便误置也因有差集不走纯 resume；末条已是 user 时亦不误入 resume-check。符号点名：`composer-sendable-input.ts`、双端 `ChatComposer`、`run-agent-turn.ts` 的 `hasInput`/`allowResumeWithoutInput`。
- T-SR2 — blocking: yes — flush 后 `hasPendingTurns=false` → 状态条无 `✏️`；重投影不粘 mkdir。
- T-SR2b — blocking: yes — **Given** 规则变更出现 `📄` **When** 发送成功且 prepare hydrate 写 file_cache **Then** 上条 `📄` 清空；消息曾含 `source:workplace`。
- T-SR3 — blocking: yes — 空正文 + attachments → **WebView / message-blocks / ChatTranscriptBridge** 行数 ≥1 且含 attachments 摘要。**不含** legacy FlatList `MessageList`（known-limit 或 delete-if-unused）。
- T-SR4 — blocking: yes — kkv `canon=[]` 后 assemble 仍能对有规则文件产出非空 display。
- T-SR5 — blocking: yes — `chatMessagesToOpenAi` 丢弃无 content 无 tool_calls；runner 不 append 仅空 text 的 assistant。
- T-SR6 — blocking: yes — Agent prepare 与 RealPrompt `buildSessionPromptInput` 对同一 session 用户段 wrap 一致。
- T-SR7 — blocking: no — legacy UA 主路径删除后相关测删除或改只读兼容（Step 8）。
- T-SR8 — blocking: no — 空续跑 **delete/re-append**（定案 A）：UI 回调触发；写回消息 attachments **含 materialize 的 `source:workplace`**（有差集时）且 flush/attach/trailing 不丢（Step 9；保留 re-append，非改 API）。
- T-MN1 — blocking: no — qa: manual_user — 双端冒烟（见 Step 10），含仅 `📄` 空发与规则变更 `📄`→发送→清空。

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 删除 UA 路径影响旧会话展示 | features 无历史则可硬切；若需演示旧数据，留只读 matcher |
| 误把「禁预览」做成「禁 workplace 落库」 | T-SR1 / T-SR2b 强制 materialize + 发送后 `📄` 清空 |
| 仅 `📄` 空发误走纯 resume | T-SR1b 钉门闩 + Core 反 resume |
| re-append 丢 materialize | T-SR8 定案 A 断言写回含 `source:workplace` |
| 空续跑改「原地更新」触及 MessageService API | **本迭代不做**；Step 9 仅测 re-append |
| Mobile legacy FlatList 漏改 | T-SR3 **不**钉 FlatList；遗留路径 known-limit 或删 |
| 过早删 flag 导致运维无法关断 | Step 8 可选；默认 true 保留开关 |
| 协议防守掩盖 assemble 为空 | T-SR4 强制有文件时非空；400 防守不替代装配 |

**回滚**：按 Step 回退；产品不变量不回退到 wrap 写库、capture、或 status 原样当 payload。

## 兼容性或迁移说明

- **无生产迁移脚本**（features 分支约定）。
- DB schema（`attachments_json`、session kkv）沿用 MAU；发送后可含 `source:workplace`（与 MAU / chip-lifecycle 一致）。
- chip-lifecycle「发送固定投影」在本迭代释义为 materialize 同源差集落库，**不是** `projectComposerStatusAttachments` 返回值原样入参（见 PRD supersede 表）。
- 旧 UA 消息：可选只读；新消息一律 attachments。
- Mobile legacy `MessageList`：非生产主路径时优先 delete-if-unused；否则 known-limit 注明「attachments+空正文」完整契约未保证则不得再启用。
