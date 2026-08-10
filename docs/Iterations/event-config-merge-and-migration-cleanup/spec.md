---
date: 2026-08-10
---

# 事件配置系统移除、Migration 清理、Bug 修复与 Token Usage 持久化 技术规格（SPEC）

## 设计目标

基于 `prd.md`（`docs/Iterations/event-config-merge-and-migration-cleanup/prd.md`），将事件配置系统全量移除，压缩 action 合并进 `CompactionConditions`，清理超过 10 个 tag 的旧 schema migration，修复四项 Bug，实现 Token Usage 持久化与回滚刷新。

核心约束：压缩行为（hide-message startDepth=6、清 RULE_SNAPSHOT + FILE_CACHE、token cache 失效）在变更前后必须完全一致。

## 总体方案

### 1. 压缩执行器：新建 `runCompaction`

将 `event-orchestrator.service.ts:155-176` 的 emit 逻辑 + kkv 清理副作用提取为一个独立函数 `runCompaction`，放在 `packages/core/src/service/compaction-conditions/` 下：

```
runCompaction(deps, { sessionId, projectId })
  → runHideMessageAction(sessionId, hideStartDepth, deps)   // 从 events/impl/actions/ 搬来
  → sessionKkv.clearDomain(sessionId, RULE_SNAPSHOT)
  → sessionKkv.clearDomain(sessionId, FILE_CACHE)
  → sessionApiPromptTokenCache.invalidate(sessionId)
  → return { ok }
```

`hideStartDepth` 从 `CompactionConditions` 读取（默认 6）。

### 2. CompactionConditions 升 v4

新增可选字段 `hideStartDepth?: number`（默认 6）。store 增加 v3→v4 迁移（抄 `migrateV2ToV3` 模板：检测 v3 文档 → 补 `hideStartDepth: 6` → 写回 KKV）。

### 3. agent-runner 条件压缩段改调 runCompaction

删除 `eventOrchestrator` 依赖，改为：
- `compactionConditions.shouldRequestCompaction()` 为 true 时直接 `await runCompaction(deps, { sessionId, projectId })`
- 删除 `if (orchestrator == null) throw` 硬依赖

### 4. 三端手动压缩直调 runCompaction

Desktop IPC `handleCompactionManual`、Mobile 两处 `handleCompactSession` / `handleCompact` 都改为直接调 `runCompaction`。

### 5. 全量删除事件配置系统

按模块边界删除，8 个 agent 生命周期事件常量 + `SimpleEventBus` 保留。

### 6. Migration 注册表清理

从 `SCHEMA_MIGRATIONS` 数组移除 6 条，保留 `.ts` 文件，新增 bootstrap 版本基线检查。

## 最终项目结构

### 删除的目录/文件

```
packages/core/src/domain/events-config/          # 整目录
packages/core/src/service/events/                # 整目录（orchestrator + actions）
packages/core/src/service/events-config/         # 整目录
packages/core/src/config-forms/events/           # 整目录
packages/core/src/errors/events-errors.ts
packages/core/src/errors/events-config-errors.ts  # 如存在
packages/core/test/events/                        # 整目录

apps/cli/src/event/                               # 整目录
apps/cli/src/events/                              # 整目录

apps/desktop/renderer/features/settings/EventsConfigView.tsx
apps/desktop/src/main/ipc/handlers/events-config-handlers.ts
apps/desktop/src/main/ipc/handlers/events.ts
apps/desktop/src/main/services/events-yaml.service.ts
apps/desktop/shared/logic/events.ts
apps/desktop/shared/logic/config-forms-events.ts
apps/desktop/test/events-handlers.test.ts

apps/mobile/src/screens/stack/EventsConfigScreen.tsx
apps/mobile/src/components/events/EventConfigBlocks.tsx
apps/mobile/src/services/events-yaml.service.ts
apps/mobile/__tests__/events-yaml.service.test.ts
apps/mobile/__tests__/validate-event-config-blocks.test.ts
```

### 保留但修改的文件

```
packages/core/src/domain/events/model/event-types.ts    # 删 2 个 SESSION_* 常量，保留 8 个 agent.*
packages/core/src/public/events.ts                       # 清 events-config/orchestrator 导出，保留 SimpleEventBus + agent 事件
packages/core/src/domain/compaction-conditions/          # 加 hideStartDepth 字段
packages/core/src/service/compaction-conditions/         # 加 runCompaction + v4 迁移
packages/core/src/service/agent/impl/agent-runner.ts     # 改条件压缩段
packages/core/src/bootstrap/schema-migrations/index.ts  # 移除 6 条 + 加基线检查
```

## 变更点清单

### Core domain 层

| 文件 | 改动 |
|------|------|
| `domain/compaction-conditions/model/compaction-conditions.ts` | 新增 `hideStartDepth?: number`，schemaVersion 3→4 |
| `domain/compaction-conditions/model/compaction-conditions.schema.ts` | zod schema 加 `hideStartDepth` 可选字段 |
| `domain/events/model/event-types.ts` | 删 `EVENT_SESSION_COMPACTION_REQUESTED`、`EVENT_SESSION_MESSAGE_RECEIVED` 及对应 payload type |

### Core service 层

| 文件 | 改动 |
|------|------|
| `service/compaction-conditions/impl/compaction-conditions-store.service.ts` | 新增 `isV3Document` + `migrateV3ToV4`（补 `hideStartDepth: 6`）|
| `service/compaction-conditions/run-compaction.ts` | **新建**：`runCompaction()` 函数，含 hide-message + kkv 清理 + token cache 失效 |
| `service/agent/impl/agent-runner.ts` | L52-63 删 import；L282-315 改调 `runCompaction`；L553-558 删 `EVENT_SESSION_MESSAGE_RECEIVED` publish |
| `service/agent/logic/assemble-agent-runner-deps.ts` | 删 `EventOrchestrator` 类型引用 |
| `service/events/**` | **整目录删** |
| `service/events-config/**` | **整目录删** |

### Core config-forms / errors / public

| 文件 | 改动 |
|------|------|
| `config-forms/events/**` | **整目录删** |
| `errors/events-errors.ts` | **删** |
| `public/events.ts` | 清 events-config / orchestrator / `EVENT_SESSION_*` 导出，保留 `SimpleEventBus` + 8 个 agent 事件常量 |
| `public/compaction.ts` | 加 `runCompaction` 导出（如需跨包调用） |

### 三端 runtime

| 文件 | 改动 |
|------|------|
| `apps/cli/src/runtime.ts` | 删 import（L20-27）、删装配（L206-242）、删返回字段 |
| `apps/desktop/src/main/runtime/create-desktop-runtime.ts` | 删 import（L19-24）、删装配（L95-136）、删返回字段 |
| `apps/desktop/src/main/runtime/types.ts` | 删 `eventOrchestrator` / `eventsConfig` 字段（L69-73）|
| `apps/mobile/src/runtime/create-mobile-runtime.ts` | 删 import（L15-20）、删装配（L75-128）、删返回字段 |
| `apps/mobile/src/runtime/types.ts` | 删字段（L69-73）|

### Desktop IPC + UI

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/main/ipc/handlers/compaction.ts` | 重写：调 `runCompaction`，迁入 kkv 清理（原由 orchestrator emit 负责）|
| `apps/desktop/src/main/ipc/handlers/events-config-handlers.ts` | **删** |
| `apps/desktop/src/main/ipc/handlers/events.ts` | **删** |
| `apps/desktop/src/main/ipc/handler-registry.ts` | 删 events handler 注册（L47-51, L390-394）|
| `apps/desktop/src/main/services/events-yaml.service.ts` | **删** |
| `apps/desktop/shared/ipc-types.ts` | 删 `nm:events/*` 通道（L161-165）+ `EventsConfigPlain` DTO（L1132-1138）|
| `apps/desktop/shared/logic/events.ts` | **删** |
| `apps/desktop/shared/logic/config-forms-events.ts` | **删** |
| `apps/desktop/renderer/ipc/invoke-registry.ts` | 删 events invoke 方法（L533-541）|
| `apps/desktop/renderer/features/settings/EventsConfigView.tsx` | **删**（566 行 DAG 编辑器）|
| `apps/desktop/renderer/features/settings/settings-nav.ts` | 删事件配置导航项 |

### Mobile UI

| 文件 | 改动 |
|------|------|
| `apps/mobile/src/screens/stack/EventsConfigScreen.tsx` | **删** |
| `apps/mobile/src/components/events/EventConfigBlocks.tsx` | **删** |
| `apps/mobile/src/services/events-yaml.service.ts` | **删** |
| `apps/mobile/src/screens/tabs/ProfileTabScreen.tsx` | 删"事件配置"入口项（L45）|
| `apps/mobile/src/navigation/RootNavigator.tsx` | 删 EventsConfig 路由（L28/136/208）|
| `apps/mobile/src/navigation/header-config.ts` | 删 EventsConfig header（L28）|
| `apps/mobile/src/navigation/types.ts` | 删 EventsConfig 路由类型（L23）|
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts` | L345-348 改调 `runCompaction`；改 Alert 文案 |
| `apps/mobile/src/screens/stack/SessionDetailScreen.tsx` | L155-158 改调 `runCompaction`；改 Alert 文案 |

### CLI

| 文件 | 改动 |
|------|------|
| `apps/cli/src/event/` | **整目录删** |
| `apps/cli/src/events/` | **整目录删** |
| `apps/cli/src/main.ts` | 删 import（L21-22）+ 子命令派发（L183-186）|

### Migration 清理

| 文件 | 改动 |
|------|------|
| `packages/core/src/bootstrap/schema-migrations/index.ts` | 从 `SCHEMA_MIGRATIONS` 移除 6 条 + 清 import/re-export |
| `packages/core/src/bootstrap/novel-master-bootstrap.ts` | 新增版本基线前置检查 |

### 压缩配置 UI 补全

| 文件 | 改动 |
|------|------|
| Desktop 压缩配置表单 | 新增 `hideStartDepth` 编辑控件 |
| Mobile 压缩配置表单 | 新增 `hideStartDepth` 编辑控件 |

### 测试

| 文件 | 改动 |
|------|------|
| `packages/core/test/events/**` | **整目录删** |
| `packages/core/test/package-exports/snapshots/public-events-allowlist.json` | 删 orchestrator 导出快照 |
| `apps/desktop/test/events-handlers.test.ts` | **删** |
| `apps/desktop/test/compaction-handler.test.ts` | 改 mock：从 `eventOrchestrator.emit` 改为 `runCompaction` |
| `apps/mobile/__tests__/chat-tab-screen-*.test.tsx` | 删 `EVENT_SESSION_COMPACTION_REQUESTED` mock |
| 新增 `packages/core/test/compaction-conditions/run-compaction.test.ts` | 覆盖 runCompaction 逻辑 |

## 详细实现步骤

### 阶段一：Core 基础设施（新建 + 迁移，不删旧代码）

- **Step 1 — phase-compaction-domain — blocking: yes — qa: auto**：`CompactionConditions` 新增 `hideStartDepth?: number`（默认 6），schemaVersion 升 4，更新 zod schema。更新 `compaction-conditions-store.service.ts`：新增 `isV3Document` + `migrateV3ToV4`（v3 补 `hideStartDepth: 6`），在 `parseAndDecode` 里接入。

- **Step 2 — phase-compaction-executor — blocking: yes — qa: auto**：新建 `packages/core/src/service/compaction-conditions/run-compaction.ts`。从 `events/impl/actions/hide-message.handler.ts` 搬 `runHideMessageAction` 逻辑进来（或 import 它，但这阶段它还在），从 `event-orchestrator.service.ts:155-176` 搬 kkv 清理 + token cache 失效逻辑。`runCompaction` 接受 deps（sessionKkv、sessionApiPromptTokenCache、messages、messageTranscriptEffects）+ params（sessionId、projectId、hideStartDepth），返回 `{ ok: boolean }`。

- **Step 3 — phase-compaction-executor-test — blocking: yes — qa: auto**：新建 `packages/core/test/compaction-conditions/run-compaction.test.ts`，覆盖：正常执行 hide-message + kkv 清理 + token cache 失效；hideStartDepth 传透；异常返回 `{ ok: false }`。

### 阶段二：切换调用方（新旧并存，旧代码仍在）

- **Step 4 — phase-agent-runner-switch — blocking: yes — qa: auto**：`agent-runner.ts` L282-315 条件压缩段：删 `eventOrchestrator` 依赖，改调 `runCompaction(deps, { sessionId, projectId, hideStartDepth })`。`hideStartDepth` 从 `compactionConditions` 的配置读。删 L302-307 的 `if (orchestrator == null) throw`。

- **Step 5 — phase-agent-runner-cleanup — blocking: yes — qa: auto**：`agent-runner.ts` L553-558：删 `bus.publish(EVENT_SESSION_MESSAGE_RECEIVED, ...)`。清理 import 中的 `EVENT_SESSION_MESSAGE_RECEIVED`。

- **Step 6 — phase-desktop-compaction-ipc — blocking: yes — qa: auto**：重写 `apps/desktop/src/main/ipc/handlers/compaction.ts`：`handleCompactionManual` 改调 `runCompaction`（通过 runtime 或直接 import），保留成功后的 `notifyComposerStatusAfterFloorOrCompaction`。

- **Step 7 — phase-mobile-compaction — blocking: yes — qa: manual_user**：`useChatTabMessages.ts` L345-348 和 `SessionDetailScreen.tsx` L155-158：改调 `runCompaction`（通过 runtime 暴露或直接 import core）。改 Alert 文案从"将按照事件配置压缩上下文"改为"将压缩上下文"。

### 阶段三：三端 runtime 去装配

- **Step 8 — phase-runtime-cli — blocking: yes — qa: auto**：`apps/cli/src/runtime.ts`：删 `createEventOrchestrator` / `createEventsConfigStore` import + 装配 + 返回字段。

- **Step 9 — phase-runtime-desktop — blocking: yes — qa: auto**：`create-desktop-runtime.ts` + `types.ts`：同上。

- **Step 10 — phase-runtime-mobile — blocking: yes — qa: auto**：`create-mobile-runtime.ts` + `types.ts`：同上。

### 阶段四：全量删除事件配置系统

- **Step 11 — phase-delete-core-events — blocking: yes — qa: auto**：删除 `packages/core/src/service/events/`（整目录）、`packages/core/src/service/events-config/`（整目录）、`packages/core/src/domain/events-config/`（整目录）、`packages/core/src/config-forms/events/`（整目录）、`packages/core/src/errors/events-errors.ts`。

- **Step 12 — phase-clean-event-types — blocking: yes — qa: auto**：`event-types.ts` 删 `EVENT_SESSION_COMPACTION_REQUESTED`、`EVENT_SESSION_MESSAGE_RECEIVED` 及 payload type。保留 8 个 agent.* 事件。

- **Step 13 — phase-clean-public-barrel — blocking: yes — qa: auto**：`public/events.ts` 清理：删所有 events-config / events-config-store / event-orchestrator / `EVENT_SESSION_*` 导出。保留 `SimpleEventBus` + `EventBus` + `EventSubscription` + 8 个 agent 事件常量 + payload type。同步更新 `packages/core/test/package-exports/snapshots/public-events-allowlist.json`。

- **Step 14 — phase-clean-package-exports — blocking: yes — qa: auto**：`packages/core/package.json` 的 `exports` map：确认 `@novel-master/core/events` 子路径仍能解析（它指向 `public/events.ts`），不需要删路径本身。

### 阶段五：三端 UI + CLI 删除

- **Step 15 — phase-delete-desktop-ui — blocking: no — qa: auto**：删 `EventsConfigView.tsx`、`settings-nav.ts` 中事件配置入口、`events-config-handlers.ts`、`events.ts`（IPC）、`handler-registry.ts` 注册、`events-yaml.service.ts`、`shared/logic/events.ts`、`shared/logic/config-forms-events.ts`、`ipc-types.ts` 的通道 + DTO、`invoke-registry.ts` 的 invoke 方法。

- **Step 16 — phase-delete-mobile-ui — blocking: no — qa: auto**：删 `EventsConfigScreen.tsx`、`EventConfigBlocks.tsx`、`events-yaml.service.ts`；`ProfileTabScreen.tsx` 删入口项；`RootNavigator.tsx` / `header-config.ts` / `types.ts` 删路由。

- **Step 17 — phase-delete-cli — blocking: no — qa: auto**：删 `apps/cli/src/event/` + `apps/cli/src/events/`；`main.ts` 删 import + 子命令派发。

### 阶段六：压缩配置 UI 补全

- **Step 18 — phase-compaction-ui-desktop — blocking: no — qa: manual_user**：Desktop 压缩配置表单新增 `hideStartDepth` 编辑控件（数字输入，默认 6）。

- **Step 19 — phase-compaction-ui-mobile — blocking: no — qa: manual_user**：Mobile 压缩配置表单新增 `hideStartDepth` 编辑控件。

### 阶段七：测试清理

- **Step 20 — phase-test-cleanup — blocking: yes — qa: auto**：删 `packages/core/test/events/`（整目录）；改 `apps/desktop/test/compaction-handler.test.ts`：mock 从 `eventOrchestrator.emit` 改为 `runCompaction`；改 mobile 测试：删 `EVENT_SESSION_COMPACTION_REQUESTED` mock。

### 阶段八：Migration 清理

- **Step 21 — phase-migration-cleanup — blocking: no — qa: auto**：`schema-migrations/index.ts`：从 `SCHEMA_MIGRATIONS` 数组移除 6 条（saved-model-identity-v1、provider-identity-v1、drop-chat-session-user-vfs-pending-v1、rename-worktree-tables-to-workplace-v1、vfs-content-blob-zlib-v1、vfs-revision-ref-count-v1）。清 import 和 re-export。保留 `.ts` 文件不删（冷回放备份）。

- **Step 22 — phase-migration-baseline-check — blocking: yes — qa: auto**：`novel-master-bootstrap.ts`：在 migration runner 之前增加版本基线检查——若 `schema_migrations` 表缺少被移除的 6 个 id 之一，且探测到 legacy 形态（`llm_saved_model` 无 `id` 列、存在 `worktree_*` 表等），则 fail-fast 报错"请先升级到 v1.4.08 再升级到本版本"。新增 `packages/core/test/bootstrap/baseline-check.test.ts` 覆盖。

## 测试策略

### 测试用例

- **T-CC1 — blocking: yes**（→ Step 1）：`CompactionConditions` v3 文档读取时自动迁移到 v4，`hideStartDepth` 填 6，写回 KKV。
- **T-CC2 — blocking: yes**（→ Step 2）：`runCompaction` 正常执行时调用 `runHideMessageAction`，清 RULE_SNAPSHOT + FILE_CACHE，invalidate token cache。
- **T-CC3 — blocking: yes**（→ Step 2）：`runCompaction` 传入 `hideStartDepth=10` 时，hide-message 用 depth 10。
- **T-CC4 — blocking: yes**（→ Step 2）：`runCompaction` hide-message 抛异常时返回 `{ ok: false }`，不 crash。
- **T-AR1 — blocking: yes**（→ Step 4）：agent-runner 条件压缩段触发时调 `runCompaction`（不再调 `eventOrchestrator.emit`）。
- **T-AR2 — blocking: yes**（→ Step 5）：agent-runner 不再 publish `EVENT_SESSION_MESSAGE_RECEIVED`。
- **T-IPC1 — blocking: yes**（→ Step 6）：Desktop 手动压缩 IPC 调 `runCompaction`，成功后调 `notifyComposerStatusAfterFloorOrCompaction`。
- **T-BL1 — blocking: yes**（→ Step 22）：bootstrap 版本基线检查——缺旧 migration id + legacy 形态 → fail-fast。
- **T-BL2 — blocking: yes**（→ Step 22）：已 apply 用户（schema_migrations 含旧 id）→ 不触发 fail-fast。

### 手动验收（qa: manual_user）

- Step 7：Mobile 手动压缩行为与变更前一致（录屏对比）。
- Step 18/19：压缩配置 UI 的 `hideStartDepth` 编辑功能正常。

## 风险与回滚方案

### 风险

1. **kkv 清理副作用遗漏（最高风险）**：`runCompaction` 必须完整保留 `event-orchestrator.service.ts:163-176` 的逻辑——清 RULE_SNAPSHOT + FILE_CACHE + invalidate token cache。漏了会导致压缩后 rule_snapshot / file_cache 残留，token cache 不失效，表现为压缩后上下文混乱。
2. **8 个 agent 事件常量误删**：删 `events.ts` barrel 时只能清 session.* / events-config / orchestrator，保留 agent.* / subagent.* + SimpleEventBus。误删会导致 UI 流式转发全断。
3. **package.json exports map**：`@novel-master/core/events` 子路径仍需解析到 `public/events.ts`（只是内容变少了），不需要删路径本身。
4. **CompactionConditions v4 迁移兼容性**：v3→v4 迁移只补 `hideStartDepth: 6`，不破坏既有字段。但需要确保所有读取 `CompactionConditions` 的地方（agent-runner、UI 表单）能正确处理新字段。
5. **手动压缩入口的"成功后通知"逻辑**：Desktop `notifyComposerStatusAfterFloorOrCompaction`、Mobile `refreshComposerStatusAfterFloorOrCompaction` + `reloadMessages` 这些后置逻辑不能丢。

### 回滚方案

- 阶段一/二（Step 1-7）是"新旧并存"的切换，可以独立回滚（改回调 `eventOrchestrator.emit`）。
- 阶段四（Step 11-14）是全量删除，回滚需要 git revert。
- Migration 清理（Step 21-22）可独立回滚（恢复 `SCHEMA_MIGRATIONS` 数组条目）。
- 如果 `runCompaction` 有问题，最安全的回滚是保留 `eventOrchestrator` 直到验证通过后再删——但这违背了"全量删除"的目标，建议通过充分测试（T-CC1~T-CC4）来保证。

### 最低支持版本声明

本次清理后，`novel-master-bootstrap.ts` 的模块注释应更新最低支持版本为 v1.4.08——低于此版本的极老库需先升级到 v1.4.08，再升级到本版本。这是 Step 22 基线检查的配套文档。

---

## Bug 修复（Bug1-4）

> 以下 Bug 均已实现并通过验证，SPEC 记录已落地方案供验收。

### Bug1：rewind 清空批注草稿

- Mobile `useChatTabMessages.ts`：`runRollback` 的 `clearUserOpsLog` 后加 `if (mode === 'rewind') clearChatAnnotateDrafts(sessionId)`
- Desktop `messages.ts`：`handleMessagesRollback` 的 `clearUserOpsLog` 后无条件 `clearChatAnnotateDrafts`
- Desktop `rollback-annotate-restore.ts`：`applyUndoAnnotateRestore` 开头先 `clearChatAnnotateDrafts`（renderer 同步）

### Bug2：专属模型扁平下拉

- Mobile `AgentEditorForm.tsx` + Desktop `AgentDefinitionEditorForm.tsx` + `AgentEditorView.tsx`：新增 `loadAllSavedModels` + `handleModelSelect`；替换渲染段；删原三件套

### Bug3：子会话 needsOpenSnapshot 绕过 deferred

**根因**：`sendSessionSnapshot` 在 `uiRunning=true && streamActive=true` 时把 snapshot 延迟到流式结束，但 `needsOpenSnapshot` 是一次性建立 rows 基线，被延迟会导致 WebView `state.rows` 为空、user 行不可见。

**修复**：`ChatTranscriptWebView.tsx` 的 `needsOpenSnapshot` 路径从 `sendSessionSnapshot` 改为 `sendSessionSnapshotNow`（立即发）；deps 加 `sendSessionSnapshotNow`；`needsOpenSnapshotRef` 消费前加 `messages.length === 0` 守卫。

**流式 partial**：新建 core `AgentStreamRegistry`（按 sessionId 存 in-flight 累积文本），`agent-runner` 每条 delta 同时 `streamRegistry.append()`，`run-agent-turn` register/unregister。`SubagentSessionScreen` 从 `runtime.streamRegistry.get()` 读 partial。

### Bug4：ChatRail className 笔误

- `ChatRail.tsx` L688/L709：`` `chat-nav-view$$${...}` `` → `` `chat-nav-view${...}` ``

---

## Token Usage 持久化与回滚刷新

### 总体方案

两层修复：
1. **Usage 持久化**：每条 assistant message 存储 LLM 响应的结构化 usage；cache 失效后从历史 message 回填。
2. **回滚后 UI 刷新**：Mobile 顶栏和 Desktop 抽屉在回滚后立即重新拉取 token 计数。

### 变更点清单

| 层 | 文件 | 改动 |
|----|------|------|
| Schema DDL | `bootstrap/chat/chat-schema.ts` | `chat_message` 加 `prompt_tokens`/`completion_tokens`/`total_tokens INTEGER` 三列 |
| Schema ALIGN | `bootstrap/schema-align/schema-column-alignments.ts` | 加三条 ALIGN 条目 |
| Schema 版本 | `bootstrap/novel-master-bootstrap.ts` | `SCHEMA_BOOT_VERSION` 4 → 5 |
| Domain model | `domain/chat/model/message-usage.ts`（新建） | `MessageUsage` 类型 |
| Domain model | `domain/chat/model/message.ts` | `ChatMessage` 加 `usage?: MessageUsage` |
| Repo impl | `sqlite-message.repository.ts` | SELECT 加三列；`rowToMessage` 条件展开；`insert` 加列绑定 |
| Service port | `message.port.ts` | `append` options 加 `usage?: MessageUsage` |
| Service impl | `message.service.ts` | `append` 写入 usage |
| AgentSession port | `agent-session.port.ts` | `append` options 加 `usage?` |
| AgentSession impls | `chat-agent-session.ts` / `ephemeral-overlay-agent-session.ts` / `in-memory-agent-session.ts` | 同步对齐 |
| Agent runner | `agent-runner.ts` | `session.append` 传 `result.usage` |
| 回填函数 | `infra/tokenizer/logic/backfill-cache-from-messages.ts`（新建） | cache miss 时从 messages 末尾找最后一条非 hidden 带 usage 的 assistant message 回填 |
| 回填接入 | Desktop/Mobile `session-prompt-input.service.ts` + `chat-prompt-tokens.service.ts` | `SessionPromptInputBundle` 加 `rawMessages`；miss 后回填 |
| Mobile UI | `useChatTabMessages.ts` | `runRollback` 补 `refreshChatTokenLabel()` |
| Desktop UI | `ConversationPanel.tsx` + `SessionDetailDrawer.tsx` | `messages-rollback` DOM CustomEvent |
| UI 映射 | `format-counter-kind-label.ts`（新建） | `api`/`heuristic` → 「自动」 |
| 配置 | `token-counter-mode-options.ts` | 移除 `heuristic` 条目 |
| 配置 | `read-token-counter-mode-pref.ts` | `parseTokenCounterModePref("heuristic")` 归一化为 `"auto"` |

### 详细实现步骤

- **Step T1 — phase-schema-usage — blocking: yes — qa: auto**：Schema 三列 + ALIGN + `SCHEMA_BOOT_VERSION` 4→5
- **Step T2 — phase-domain-usage — blocking: yes — qa: auto**：`MessageUsage` 类型 + `ChatMessage.usage?`
- **Step T3 — phase-repo-usage — blocking: yes — qa: auto**：sqlite 读写适配
- **Step T4 — phase-service-usage — blocking: yes — qa: auto**：`MessageService.append` + `AgentSession` 接口+三实现 + agent-runner 传 usage
- **Step T5 — phase-cache-backfill — blocking: yes — qa: auto**：`backfillCacheFromMessages` + 两端 `rawMessages` 接入
- **Step T6 — phase-mobile-rollback-refresh — blocking: yes — qa: manual_user**：`runRollback` 补 `refreshChatTokenLabel()`
- **Step T7 — phase-desktop-drawer-refresh — blocking: yes — qa: manual_user**：`messages-rollback` CustomEvent
- **Step T8 — phase-token-label-ui — blocking: no — qa: auto**：`formatCounterKindLabel` + 三处 UI 套用
- **Step T9 — phase-remove-heuristic — blocking: no — qa: auto**：移除 heuristic 手动选项 + parse 层归一化

### 测试用例

- **T-TU1 — blocking: yes**（→ T1-T3）：新建库+老库升版，三列存在；INSERT 带 usage → SELECT 读回正确；NULL → usage undefined
- **T-TU2 — blocking: yes**（→ T4）：agent-runner assistant append 带 `result.usage`；无 usage 时不传
- **T-TU3 — blocking: yes**（→ T5）：backfill 从末尾找最后一条非 hidden 带 usage 的 assistant；hidden 跳过；无候选返回 false
- **T-TU4 — blocking: yes**（→ T5）：cache miss + 回填成功 → resolve 返回 source=api
- **T-TU5 — blocking: yes**（→ T6）：Mobile 回滚后 refreshChatTokenLabel 被调用
- **T-TU6 — blocking: no**（→ T7）：Desktop messages-rollback 事件 dispatch + drawer reload
- **T-TU7 — blocking: no**（→ T8）：formatCounterKindLabel 映射正确
- **T-TU8 — blocking: no**（→ T9）：options 不含 heuristic；旧值归一化为 auto

### 兼容性说明

- 老消息 usage 为 NULL（预期行为）
- `SCHEMA_BOOT_VERSION` 4→5：已升版老库走慢路径重建 DDL + ALIGN
- fork 路径 spread msg 天然带 usage
- `VALID_FAMILIES` 和 `TokenizerOverride` 保留 heuristic 兼容分支

### 回填接口设计

`backfillCacheFromMessages` 过滤 `!msg.hidden`，用 `msg.createdAtMs` 作 `updatedAt`。调用方（两端 chat-prompt-tokens.service.ts）通过 `SessionPromptInputBundle.rawMessages` 复用 `buildSessionPromptInput` 内部的 `listBySession`，不另开查询。`resolveCurrentPromptTokens` 是 `async`，伪代码需 `await`。
