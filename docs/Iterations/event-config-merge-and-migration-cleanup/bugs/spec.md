---
date: 2026-08-10
---

# 三项 Bug 修复 技术规格（SPEC）

## 设计目标

基于 `bugs/prd.md`，修复三个独立 bug。代码已在 `fix/agent-config-and-subagent-stream` 分支落地，本 SPEC 是对已实现方案的记录与验收依据。

## Bug1：rewind 清空批注草稿

### 总体方案

`rewind`（回滚 Assistant）成功后，进程内 annotate store 按 sessionId 清空。改动横跨 Mobile 和 Desktop 双进程架构。

### 现状

- `rewind` 走 `clearUserOpsLog`（清 user ops）但不清 annotate store
- `undo_send` 从被删 user 消息附件反投影批注到 annotate store
- annotate store 在 Desktop 是双进程（main + renderer 各一份），Mobile 是单进程

### 变更点

| 文件 | 改动 |
|------|------|
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts` | import 加 `clearChatAnnotateDrafts`；`runRollback` 里 `clearUserOpsLog` 后，`rewind` 分支调 `clearChatAnnotateDrafts(sessionId)` |
| `apps/desktop/src/main/ipc/handlers/messages.ts` | import 加 `clearChatAnnotateDrafts`；`handleMessagesRollback` 里 `clearUserOpsLog` 后无条件 `clearChatAnnotateDrafts` |
| `apps/desktop/renderer/features/chat/rollback-annotate-restore.ts` | `applyUndoAnnotateRestore` 开头先 `clearChatAnnotateDrafts`（同步 renderer 侧），再按 attachments 反投影 |

### 关键设计决策

- Desktop main 进程无脑清（不区分 mode）——因为 main 不知道 mode（mode 是 renderer 算的）。main 清完后，renderer 的 `applyUndoAnnotateRestore` 先 clear 再按需反投影：`undo_send` 时反投影补回（annotations 非空），`rewind` 时 clear 后不补（annotations 为 null）。
- Mobile 单进程，`runRollback` 知道 mode，直接按 mode 分支：`rewind` 清，`undo_send` 走 `applyComposerRestore` 反投影。

### 实现步骤

- **Step 1 — phase-rewind-clear — blocking: yes — qa: auto**：Mobile `useChatTabMessages.ts`：import 加 `clearChatAnnotateDrafts`；`runRollback` 的 `clearUserOpsLog` 后加 `if (mode === 'rewind') clearChatAnnotateDrafts(sessionId)`。
- **Step 2 — phase-rewind-clear-desktop — blocking: yes — qa: auto**：Desktop `messages.ts`：import 加 `clearChatAnnotateDrafts`；`handleMessagesRollback` 的 `clearUserOpsLog` 后加 `clearChatAnnotateDrafts(req.sessionId)`。
- **Step 3 — phase-rewind-clear-renderer — blocking: yes — qa: auto**：Desktop `rollback-annotate-restore.ts`：import 加 `clearChatAnnotateDrafts`；`applyUndoAnnotateRestore` 开头加 `clearChatAnnotateDrafts(sessionId)`（renderer 侧同步）。

## Bug2：专属模型扁平下拉

### 总体方案

Mobile 和 Desktop 三端把"开关 + 服务商下拉 + 模型下拉"替换为单一模型下拉。数据路径不变，core 零改动。

### 现状

- Mobile `AgentEditorForm.tsx`：`rightAction` 放 Switch，关态显示提示文字，开态显示服务商 + 模型两个 `FormSelectField`
- Desktop 两个文件（`AgentDefinitionEditorForm.tsx` + `AgentEditorView.tsx`）：同样的开关 + 二级 select 结构
- `buildAgentDefinitionFromForm`（core）只读 `modelEnabled` + `savedModelId`，不关心 UI 形态
- savedModels 通过 `savedList(providerId)` 按 provider 查，没有全量方法

### 变更点

**新增聚合方法**（三端各一份）：

| 端 | 方法 |
|----|------|
| Mobile | `loadAllSavedModels()`：`Promise.all(providers.map(p => providerModels.savedList(p.id))).flat()` |
| Desktop | `loadAllSavedModels(providerRows)`：`Promise.all(providerRows.map(p => ipcProviderModelsSavedList({providerId:p.id})))` 并 flat |

**新增单一 handler**：`handleModelSelect(id)`：
- `id === ''` → `setModelEnabled(false)` + 清 `savedModelId`
- 否则 → `setModelEnabled(true)` + `setSavedModelId(id)` + `setProviderId(selected.providerId)`

**选项列表**：`[{value:'', label:'默认(跟随)'}, ...savedModels.map(扁平化 label)]`

**渲染替换**：原三件套替换为单一 select / FormSelectField，value 绑定 `modelEnabled ? savedModelId : ''`。

| 文件 | 关键改动 |
|------|---------|
| `apps/mobile/src/components/agent/AgentEditorForm.tsx` | 新增 `loadAllSavedModels` + `handleModelSelect`；替换渲染段；删 `loadSavedModels`/`pinnedModelHint`/`handleProviderChange`/`handleSavedModelChange`/`providerSelectOptions`/死状态 `vendorModelId` |
| `apps/desktop/renderer/features/settings/AgentEditorView.tsx` | 新增 `loadAllSavedModels`(IPC 聚合) + `handleModelSelect`；替换渲染段；删 `resolveSavedModelPin`/`loadSavedModels`/`handleProviderChange`/`modelHint`；savedModels 类型加 `providerId`；删 `ipcProviderModelsGetSaved` import |
| `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx` | 同上；`applyDefinitionToFormState` 签名从 `(loadSavedModels, setters, providerRows, resolveSavedModelPin)` 改为 `(loadAllSavedModels, setters, providerRows)` |

### 实现步骤

- **Step 4 — phase-model-flat-mobile — blocking: yes — qa: manual_user**：Mobile `AgentEditorForm.tsx`：新增 `loadAllSavedModels` + `handleModelSelect`；改 `populateFormFromDefinition` 扁平加载；改 `modelSelectOptions` 头部插默认项；替换渲染段；清理死代码。
- **Step 5 — phase-model-flat-desktop-view — blocking: yes — qa: manual_user**：Desktop `AgentEditorView.tsx`：新增 `loadAllSavedModels` + `handleModelSelect`；改 `loadAgent` 扁平加载；替换渲染段；清理。
- **Step 6 — phase-model-flat-desktop-def — blocking: yes — qa: manual_user**：Desktop `AgentDefinitionEditorForm.tsx`：改 `applyDefinitionToFormState` 签名；新增 `loadAllSavedModels`；替换渲染段；清理。

## Bug3：子会话退出再进入时 user 消息消失 + 流式 partial 丢失

### 总体方案

两层修复：
1. **流式 partial 缓存移到 core 层**：新建 `AgentStreamRegistry`（core 层接口 + Map 工厂），按 sessionId 存 in-flight 累积文本 `{ text, thinking }`。`agent-runner` 的 `scheduleStreamPublish` 里每条 delta 同时 `streamRegistry.append()`；`run-agent-turn` 负责 register/unregister。`SubagentSessionScreen` 从 `runtime.streamRegistry.get(sessionId)` 查询 partial 并注入 WebView，不依赖 eventBus 订阅时机。
2. **needsOpenSnapshot 立即送达**：`ChatTranscriptWebView` 的首次建立 rows 基线的 snapshot 改为直接调 `sendSessionSnapshotNow`（立即发），不走 `sendSessionSnapshot` 的 deferred 路径。

### 根因分析

**user 消息消失的直接原因**：`sendSessionSnapshot` 在 `uiRunning=true && streamActive=true` 时会把 snapshot 延迟到流式结束（`pendingSnapshotRef` + `streamActiveRef` 守卫）。但 `needsOpenSnapshot` 是建立 WebView rows 基线的一次性操作，必须立即送达——如果被延迟，WebView 的 `state.rows` 一直为空，只有流式 tail 可见、user 行不可见。等流式结束后后续 effect 触发 fullSnapshot，user 才回来。

**主会话为什么不受影响**：主会话首次打开时通常不在流式中途；即使流式中，messages 会持续变化（delta 回调更新 state），频繁触发 effect，总有机会把 snapshot 补上。子会话是只读浏览页，进入后 messages 在 step commit 前不变，不会触发新 snapshot。

**流式 partial 丢失的原因**：原方案把 delta 订阅挂在 `SubagentSessionScreen` 内部，eventBus 是 fire-and-forget 无 replay，mount 前的 delta 永久丢失。

### 现状（修复前）

- `SubagentSessionScreen.tsx` 内部订阅 `STREAM_*_DELTA` 事件累加到 Context 缓存
- eventBus fire-and-forget，mount 前的 delta 丢失
- `ChatTranscriptWebView` 的 `needsOpenSnapshot` 路径调 `sendSessionSnapshot`（可能 deferred）

### 变更点

**Core 层 `AgentStreamRegistry`**：

| 文件 | 改动 |
|------|------|
| `packages/core/src/service/agent/agent-stream-registry.port.ts` | 新增接口（`register`/`append`/`get`/`unregister`/`clear`） |
| `packages/core/src/service/agent/create-agent-stream-registry.ts` | 新增 Map 工厂实现 |
| `packages/core/src/service/agent/impl/agent-runner.ts` | `scheduleStreamPublish` 里每条 delta 同时 `streamRegistry.append()` |
| `packages/core/src/service/agent/logic/run-agent-turn.ts` | register/unregister 与 abortRegistry 对齐 |
| `packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts` | 注入 streamRegistry |
| `packages/core/src/public/agent.ts` | 导出接口与工厂 |
| 三端 runtime types + factory | 注入 `streamRegistry` |

**Screen 层（`SubagentSessionScreen.tsx`）**：

| 改动 | 详情 |
|------|------|
| 删 delta 订阅 effect | 原 eventBus 订阅代码全部移除 |
| 删 `useSubagentStreamCache` | 从 UI 层 Provider 缓存改为 core streamRegistry |
| inject effect 改读 streamRegistry | `runtime.streamRegistry?.get(sessionId)` 读 partial |
| inject 守卫 | `messages.length === 0` 时不注入（等 snapshot 先把 user 行渲染到 WebView） |

**WebView 层（`ChatTranscriptWebView.tsx`）**：

| 改动 | 详情 |
|------|------|
| `needsOpenSnapshot` 路径改调 `sendSessionSnapshotNow` | 绕过 deferred，立即发全量 snapshot |
| deps 加 `sendSessionSnapshotNow` | messages effect 依赖列表 |
| `needsOpenSnapshotRef` 消费守卫 | messages.length === 0 时不消费（等有内容再发） |
| 删 `subagent-stream-cache.tsx` 引用 | RootNavigator 不再 wrap Provider |

### 关键设计决策

- **streamRegistry 放 core 层而非 UI 层**：core 的 `agent-runner` 是 delta 的源头，在这里 append 保证不管 UI 何时进入、是否有订阅者，partial 都在累积。UI 层只需 `get()` 读取。
- **inject 必须等 messages 加载完**：`ChatTranscriptWebView` 的 messages effect 是 child effect，先于 Screen 的 parent effect 执行。child effect 先发 sessionSnapshot 把 user 行渲染到 WebView，parent effect 再注入 stream partial。如果 inject 先于 snapshot，WebView 上 rows 还是空的，只渲染 stream tail，user 消息不可见。
- **needsOpenSnapshot 绕过 deferred 的副作用**：首次进入时 `sessionChanged=true`，WebView 前端 `applySnapshot` 会清空 stream tail。但 inject effect 在 snapshot 之后立即注入累积 partial，所以流式内容不会真的丢。这个时序依赖 child effect 先于 parent effect，React 保证这一点。

### 实现步骤

- **Step 7 — phase-stream-registry-core — blocking: yes — qa: auto**：core 层新增 `AgentStreamRegistry`（接口 + Map 工厂）；`agent-runner.ts` 的 `scheduleStreamPublish` 加 `streamRegistry.append()`；`run-agent-turn.ts` 加 register/unregister；`assemble-agent-runner-deps.ts` 注入。
- **Step 8 — phase-stream-registry-runtime — blocking: yes — qa: auto**：三端 runtime types + factory 注入 `streamRegistry`。
- **Step 9 — phase-screen-inject-from-registry — blocking: yes — qa: auto**：`SubagentSessionScreen.tsx` 删 eventBus 订阅 + `useSubagentStreamCache`；inject effect 改读 `runtime.streamRegistry.get(sessionId)`；加 `messages.length === 0` 守卫。
- **Step 10 — phase-transcript-needs-open-fix — blocking: yes — qa: auto**：`ChatTranscriptWebView.tsx`：`needsOpenSnapshot` 路径从 `sendSessionSnapshot` 改为 `sendSessionSnapshotNow`；deps 加 `sendSessionSnapshotNow`；`needsOpenSnapshotRef` 消费前加 `messages.length === 0` 守卫。
- **Step 11 — phase-remove-stream-cache-provider — blocking: yes — qa: auto**：`RootNavigator.tsx` 删 `SubagentStreamCacheProvider` wrap；`subagent-stream-cache.tsx` 文件保留但不被引用（或 git checkout 回原始版本）。

## 测试策略

### 测试用例

- **T-B1 — blocking: yes**（→ Step 1-3）：rewind 后 annotate store 清空；undo_send 后反投影正常。
- **T-B2 — blocking: yes**（→ Step 4-6）：`buildAgentDefinitionFromForm` 在 `modelEnabled=false` 时 `def.model` 缺省；`modelEnabled=true` 时 `def.model = savedModelId`。扁平加载全量 savedModels。
- **T-B3 — blocking: yes**（→ Step 7-8）：core `AgentStreamRegistry` 在 `agent-runner` 每条 delta 时 append；`run-agent-turn` register/unregister 与 abortRegistry 对齐。
- **T-B4 — blocking: yes**（→ Step 9）：Screen 从 `runtime.streamRegistry.get(sessionId)` 读 partial；messages 为空时不注入。
- **T-B5 — blocking: yes**（→ Step 10）：`needsOpenSnapshot` 路径调 `sendSessionSnapshotNow`（立即发），不走 deferred；messages 为空时不消费 `needsOpenSnapshotRef`。

### 手动验收

- Step 4-6：Desktop / Mobile Agent 配置表单，下拉交互正常，保存/加载一致。
- Bug3 整体：子会话首次进入流式完整 + user 气泡显示（录屏验收）。

## 风险与回滚方案

### 风险

1. **Bug1 产品口径变更**：rewind 清批注破坏了原 spec D9/D10 的"rewind 不清批注"合同。需同步更新 `annotate-user-ops-unify` recontract spec + `user-ops-operation-log` D10。
2. **Bug3 needsOpenSnapshot 绕过 deferred 的副作用**：首次进入时 `sessionChanged=true`，WebView `applySnapshot` 会清 stream tail，但 inject effect 紧跟其后注入累积 partial，不会真的丢。这个时序依赖 React child effect 先于 parent effect。
3. **streamRegistry 生命周期**：register/unregister 全在 `run-agent-turn` 管理，Screen 侧不操作 registry。run 结束后 unregister，`get()` 返回 undefined——此时落库消息从 messages list 正常加载。

### 回滚方案

- 三个 bug 的改动都在独立文件里，git revert 即可回滚。
- Bug3 的 core `AgentStreamRegistry` 是新增模块，删除后三端 runtime 注入点同步移除即可。
