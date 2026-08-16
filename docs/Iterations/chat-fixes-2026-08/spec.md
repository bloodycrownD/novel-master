---
date: 2026-08-16
---

# chat-fixes-2026-08 技术规格（SPEC）

## 需求来源

用户口述（本会话头脑风暴结论），共 5 项，全部在 mobile 端测试发现；探索依据为本会话 7 份 readonly 探索报告（压缩链路 ×2、user ops / 隐藏消息 ×2、分叉 bug、流式丢失 ×2）。

1. 压缩（hide-message）楼层寻找算法不区分 user 输入与 tool result 消息，需按消息 blocks 做配对感知优化。
2. 移除「手改操作日志（user ops）」能力：文件写/编辑等行为日志不再进入 Composer chip 与 LLM prompt；`source: "user_ops"` 附件通道保留，未来仅供批注（annotate）使用。
3. Bug：分叉（fork）后的会话 agent/model 选择器被锁（提示被「项目智能体」占用），会话详情页无法打开。根因：`fork` 不写 `agent_config_json`。**用户确认：无存量 fork 会话，不做迁移。**
4. 隐藏的消息支持「回归」（回滚）菜单。（2026-08-16 订正：首版误读为「取消隐藏」，已拆除并改为放开回滚入口；回滚不改变消息可见性。）
5. Bug：主会话流式中途内容丢失、结束回刷（mobile webview 路径，与子会话历史问题同根）。

## 设计目标

- 压缩边界不再拆开 `assistant(tool_use)` ↔ `user(tool_result)` 配对，从源头消除孤儿 tool 消息（渲染层兜底保留）。
- 手改 ops 全链路拆除（store、flush、chip、开关、prompt 渲染），批注链路零损伤；历史消息里的手改附件也不再进 prompt。
- fork 出的会话继承源会话 agent 配置，选择器/详情页/发消息恢复正常。
- mobile 双菜单（native + webview）对隐藏消息放开「回滚」入口；回滚不改变消息可见性。
- mobile 主会话流式：pending snapshot 不再被重新置位的 `streamActiveRef` 无限挂起；step/finish 事件前先 flush 缓冲再清理，对齐 desktop。

## 总体方案

五项相互独立，按风险从小到大分五个 phase 实施。core 侧改动（fork、压缩算法）与 mobile 侧改动（菜单、流式）无文件交集，可并行；user ops 拆除横跨 core/mobile/desktop，单独成 phase 放最后。

关键决策（已拍板，探索报告支撑）：

- **D1 隐藏消息回滚口径（订正后）**：仅放开菜单前置（去掉 `!hidden`），复用既有 rollback handler；core 回滚链路不碰 hidden 状态，无后处理差异。首版 D1 的 unhide/showMessagesInRange 口径已废弃。
- **D2 ops prompt 生效范围**：不只删构造端，渲染层同步过滤——`wrap-user-message-for-llm` 对 `source === "user_ops"` 附件仅保留 `action === "annotate"`，历史消息的手改附件一并不再进 prompt。
- **D3 chip 判定收窄**：`isComposerStatusAttachment` 的 `user_ops` 分支加 `action === "annotate"` 条件，不能按 source 一刀切（annotate chip 共用此判定）。
- **D4 force 快照语义**：`sendSessionSnapshot` 增加 `force` 参数——force 时消费 `pendingSnapshotRef`（沿用其 intent）、取消 defer timer、绕过 `streamActiveRef` 检查直接 `sendSessionSnapshotNow`。与 `needsOpenSnapshot` 必须直发的既有先例（`ChatTranscriptWebView.tsx` L920-934 注释）同课同补。
- **D5 压缩边界只向外扩展（含订正）**：边界调整只允许把 range 向外扩（hide 更多），不允许收缩，保住 `2f5bb4b4`「hide 区间覆盖完整切片」的约定；禁止回退 `fromSeq: anchor.seq` 旧写法。订正后 from 侧口径：楼层第一条必须锚定在「user 且非 tool_result」的真用户输入上（严格交替协议，见 A 项订正记录）——向上锚定只可能让 fromSeq 更小，与只扩不收缩兼容。
- **D6 `hasPendingTurns` 彻底删除**：`UserVfsTurnService.hasPendingTurns`（`packages/core/src/service/chat/user-vfs-turn.port.ts` L83）随 ops 拆除一并删除，不留替代实现。连带：desktop `handlers/vfs.ts` L404-409 的 `USER_VFS_HAS_PENDING` IPC 通道删除（`handler-registry.ts` L145/L252 绑定、`invoke-registry.ts` L273-276、`client.ts` L79、`shared/ipc-types.ts` 类型同步清理），`ConversationPanel`/`ChatComposer` 的 pending 轮询链随之拆除；core `run-agent-turn.ts` L238-246 的 hasInput 判定同步收口（删 `hasPending` 项）。空续跑 re-append 分支（`prepare-user-vfs-turn-for-agent-run.ts` L101）的前提本就是 `hasPendingTurns`（并非 `hasUnsentUserOpsLog`），该分支随删除整体评估去留。
- **D7 状态条收窄为仅 annotate（推送函数与 pull 通道均收窄保留，非删除）**：desktop composer 状态条的推送内容与 pull 返回都收窄为仅 annotate（对齐 mobile 侧口径）。push 侧：`notify-composer-status-after-kkv-clear.ts` 的 `notifyComposerStatusAfterFloorOrCompaction` / `notifyComposerStatusAfterSessionKkvCleared` 收窄为仅 annotate 版本——其依赖的 `projectComposerStatusForSession` → `projectComposerStatusAttachments` ops 投影链删除后，内部改走仅 annotate 投影，函数与调用点保留不删；`compaction.ts` 的调用点随收窄版自然收窄。pull 侧：`SESSIONS_PROJECT_COMPOSER_STATUS` IPC 通道**保留**，`handleSessionsProjectComposerStatus`（`handlers/sessions.ts` L23/L135）收窄返回仅 annotate 投影；renderer 消费点（`invoke-registry.ts` L189-192 / `client.ts` L57 / `ConversationPanel.tsx` L281 / `ChatComposer.tsx` L338）不删通道、随投影变化自然收窄。行为由 T-UO4 覆盖（仅 annotate 推送或停推后不炸）。

## 最终项目结构

无新增目录。新增/修改均为既有文件内改动：

- core：`packages/core/src/domain/depth/logic/resolve-hide-message-range.ts`（边界扩展）、`packages/core/src/service/chat/impl/message.service.ts`（fork 补配置）、user ops 相关约 15 个文件的删除/收窄。
- mobile：`apps/mobile/src/components/chat/message-edit.ts`、`web/chat-transcript/webview/runtime/menu/menu.ts`（+webview-dist 重建）、`components/chat/ChatTranscriptWebView.tsx`、`screens/tabs/chat-tab/useSessionBatch.ts` / `useSessionStream.ts`、ChatComposer / ChatConfigScreen 等。
- desktop：user ops 开关与 rollback 清推的拆线（IPC、设置页、测试）。
- 测试：core `test/depth/`、`test/chat/`；mobile `__tests__/`；desktop `test/`。

## 变更点清单

### A. 压缩楼层配对感知（core）

> 订正记录（2026-08-16，用户澄清）：消息流严格 user/assistant 交替（tool_result 挂 user role），压缩楼层第一条必须是**真用户输入**（user 且非 tool_result）。首版实现成「边缘 tool_result 时外扩一步纳入配对 assistant」，导致隐藏区间第一条可为 assistant，口径错误；已改为**向上锚定**（见下）。

- `packages/core/src/domain/depth/logic/resolve-hide-message-range.ts`：from 侧楼层锚定——边缘为 assistant 或 user(tool_result) 时，持续向更旧侧扩展，跳过整个 tool 往返，落在最近一条「user 且非 tool_result」的真用户输入上；严格交替下配对随整轮入区天然完整，无需逐个配对外扩。to 侧保留原配对感知外扩：`toSeq` 边缘是含 `tool_use` 的 assistant 且配对 tool_result 在 range 外时向外（更新侧）纳入，防孤儿 result。配对匹配用 `toolUseId`；`hasToolResult` 复用 `message-content-helpers.ts` 既有导出。锚定存在性校验逻辑不动；`messageIdsInSlice` 签名不动（regex/events 复用）。
- blocks 在该链路已全量解析（`listBySession` 全列 SELECT + `parseMessageContent`），零额外查询。
- `packages/core/src/service/prompt/normalize-orphan-tool-results-for-llm.ts` 兜底**保留不删**（仍覆盖上一轮 run 崩溃产生的孤儿）。

### B. fork 补写 agent 配置（core）

- `packages/core/src/service/chat/impl/message.service.ts` `fork`（L211-260 事务体）：在 `r.sessions.insert(forked)`（L227）之后、`copyVfsTree` 之前，照抄 `copy`（`session.service.ts` L321-325）的写法：repo 层 `getSessionAgentConfig(source.id)` 判空后 `setSessionAgentConfig(forked.id, json, now)`。**必须用 `r.sessions`（repo 层，NULL 静默）**，事务内不可调 service 层（NULL 会抛且不在 tx 上）。
- mobile 防御与文案（随本次一并修）：
  - `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx` L39-40 `AGENT_LOCK_TOAST` 更新为「当前会话未绑定有效智能体…」口径（对齐 `SessionDetailScreen.tsx` L55）。
  - `apps/mobile/src/services/chat-agent-meta.ts` / `useChatTabScope.ts` / `SessionDetailScreen.tsx`：`loadChatAgentMeta` 的 catch 把 `ChatError` 也归一为 `source: 'none'`，详情页不再卡「加载中…」（显示未绑定引导）。
- 不做存量迁移（用户确认无 fork 会话）。

### C. 隐藏消息支持回滚（mobile）

> 订正记录（2026-08-16，用户澄清）：原需求「隐藏的消息希望支持回归菜单」中的「回归」指**回滚**，首版 spec 误读为「取消隐藏」并实现了一套 unhide 菜单；已按用户决定全部拆除（见下）。回滚语义：**不改变消息可见性**——锚点消息及存留消息的 hidden 状态保持原样，回滚只做消息删除与文件恢复。

- `apps/mobile/src/components/chat/message-edit.ts` `buildMessageActionItems`：去掉 `rollback` 的 `!message.hidden` 前置，隐藏消息同样展示「回滚」。
- `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` `buildMenuItems`：同步去掉 `rollback` 的 `!row.hidden` 前置；**改后重建 webview-dist**。
- core 回滚链路（checkpoint 删除 + 文件恢复）不碰 hidden 状态，无需改动。
- 已拆除（首版误读产物）：`unhide` 菜单项（native + webview）、`handleMessageMenuAction` 的 `unhide` 分支、`isUnhideEligibleMessage`、`use-chat-tab-message-actions-unhide.test.ts`；`showMessagesInRange` 为 core 既有端口（desktop 置位/显示链路仍在用），保留。
- desktop（非阻塞、可选）：desktop 菜单本无 rollback 项，不涉及。

### D. 主会话流式修复（mobile）

- `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx`：
  - `sendSessionSnapshot`（L499-528）加 `force?: boolean`（D4 语义）。调用点仅 messages effect 的 needsFullSnapshot 分支（L1016-1017）传 `force: true`，其余调用点不传、行为不变。
  - web 端 `applySnapshot` 在 preserve intent 且同 session 下不清 `state.stream`（`render/snapshot.ts` L47-55 已核实），force 快照与流式 tail 共存安全。
- `apps/mobile/src/screens/tabs/chat-tab/useSessionBatch.ts`：`UseSessionBatchResult` 增加 `flushBuffers()`（= 手动 `flushIngressToApplyBuffer` + `applyBuffer.flush()`，底层 `stream-apply-buffer.ts` L38-45 已有 flush）。
- `apps/mobile/src/screens/tabs/chat-tab/useSessionStream.ts`：`UseSessionStreamParams` 加 `batchFlush`（ref 模式对齐 `batchClearRef`）；STEP_COMMITTED / RUN_FINISHED / RUN_FAILED 三处事件 handler 的插入点钉死为「`acceptRunEvent` 守卫通过之后、进入 phase/分支处理之前」，先 `batchFlush()` 再走既有流程（对齐 desktop `apps/desktop/renderer/hooks/useAgentStream.ts` L180/189/198 的既有模式，消除「handler 开头」vs「L384 前」的行号歧义）；`handleStreamEndAfterReload` 的 `batchClear`（L226）保留（flush 后 clear 语义正确）。
- 装配方（`ChatTabProvider`、`SubagentSessionScreen`、`use-chat-stream-runtime.test.ts` mountRuntime）补传 `batchFlush`。

### E. user ops 手改日志拆除（core + mobile + desktop）

core：
- 删 ops store 与投影：`chat-user-ops-log-store.ts`、`aggregate-user-ops-log-chips.ts`、`build-user-ops-attachment.ts`、`project-composer-status-attachments.ts`、`parse-user-ops-log-from-attachments.ts`、`user-ops-log-from-turn-op.ts`、`model/user-ops-log.schema.ts`。
- `user-vfs-turn.service.ts` / `user-vfs-turn.port.ts`（`packages/core/src/service/chat/`）：删 `flushPendingUserVfsTurns` 的 ops 构造与 executeOp 的记日志半边（磁盘写链路不动）；并按 D6 删 `hasPendingTurns`（port L83）。
- `packages/core/src/service/agent/logic/run-agent-turn.ts`：删 flush 编排段，`mergedAttachments` 收成 `scannedComposer ∪ annotateAttachments`（annotate 落库链路 L312-356 不经过 flush，无损）；L238-246 的 hasInput 判定按 D6 同步收口（删 `hasPending` 项，`hasPendingTurns` 调用点消失）。
- `prepare-user-vfs-turn-for-agent-run.ts`：空续跑 re-append 分支评估去留——其前提是 `userVfsTurn.hasPendingTurns(sessionId)`（L101，并非 `hasUnsentUserOpsLog`），随 D6 删除后该分支失去判定依据，整体评估删除或改判；`allowResumeWithoutInput` 门闩另有用途，勿误伤。
- `wrap-user-message-for-llm.ts`：按 D2 过滤（仅保留 `action === "annotate"` 的 `user_ops` 附件）。
- `composer-chip-attachment.ts`：按 D3 收窄判定。
- `composer-send-intent.ts` / `composer-sendable-input.ts`：去掉 `hasPendingUserOps` 入参。
- `persistent-preferences/`（port + impl + preference-keys）：删 `PREF_KEY_CHAT_USER_OPS_LOG` 与三个读写方法；`packages/core/src/index.ts` L127 对该键的 re-export 同步删除（漏删则 core 编译直接炸）；`config-forms/shared/ui-labels.ts` 删 `USER_OPS_LABELS`。
- `public/chat.ts`：清理约 25 个 ops 导出。

mobile：
- `ChatComposer.tsx`：删 `hasPendingUserOps` / `opsLogEpoch` / `subscribeUserOpsLog` / `clearUserOpsLog`；`shouldClearComposer` 收成 `content.trim() !== '' || hasAnnotateDrafts`（annotate 自己的订阅/epoch 全保留）。
- `ChatConfigScreen.tsx`：删「手改操作日志」开关（L37、L69-71、L179-199）。
- `project-composer-status.service.ts`：**收窄为仅 annotate**（与 desktop D7 对齐，服务保留不删）——`refreshComposerStatusAfterFloorOrCompaction` / `refreshComposerStatusAfterUserVfsOps` / `projectComposerStatusForSession` 三个函数保留，内部去掉对将删的 `projectComposerStatusAttachments` 的 ops 投影，只留 annotate 合并逻辑（该 import 是编译炸点，必须改写而非只删调用）。
- 状态条下游调用方（收窄保留口径下调用点不删，点名确认）：
  - `services/user-vfs-turn-execute.service.ts` L11/L52：磁盘写链路保留，其中状态条刷新段（`refreshComposerStatusAfterUserVfsOps` → `projectComposerStatusForSession`）随收窄调整；
  - `screens/stack/SessionDetailScreen.tsx` L46/L169：调用 `refreshComposerStatusAfterFloorOrCompaction`，函数收窄后调用点无需删；
  - `components/vfs/VfsFileManager.tsx` L59/L505：间接依赖 `refreshComposerStatusAfterUserVfsOps`，收窄保留口径下无碍。
- `useChatTabMessages.ts` rollback 段、`workplace-block.service.ts`：删 ops 清推调用；annotate 反投影（`parseAnnotateDraftsFromAttachments` → `addChatAnnotateDraft`）**保留**。

desktop：
- `preferences.ts` handler / `handler-registry.ts` / `client.ts` / `invoke-registry.ts` / `shared/ipc-types.ts`：删 ops 偏好两个 IPC 通道；并按 D6 删 `USER_VFS_HAS_PENDING` 通道（`handlers/vfs.ts` L404-409 handler、`handler-registry.ts` L145/L252 绑定、`invoke-registry.ts` L273-276、`client.ts` L79、`shared/ipc-types.ts` 类型一并清理）。
- `main/ipc/handlers/workplace.ts`：L15 `import { clearUserOpsLog }` 与 L150-151 调用拆除（core 导出删掉后漏改此文件会编译炸）。
- `main/services/project-composer-status.service.ts`：L6/L19 引用将删的 `projectComposerStatusAttachments`（编译炸点），按 D7 **收窄为仅 annotate** 改写，服务保留不删；`notify-composer-status-after-kkv-clear.ts` 两个 notify 函数同样收窄为仅 annotate 版本（不删函数、不删调用点）。
- `main/ipc/handlers/sessions.ts`：L23/L135 直调 `projectComposerStatusForSession`（`SESSIONS_PROJECT_COMPOSER_STATUS` pull 通道的 handler），随收窄改写返回仅 annotate（通道保留，见 D7）。
- `main/services/user-vfs-turn-execute.service.ts`：L11/L33 直调 `projectComposerStatusForSession`，随收窄改写不删；其调用方 `handlers/vfs.ts` L51 / `vfs-batch.service.ts` L27 不动。
- `main/ipc/handlers/compaction.ts`：L15/L37 调用 `notifyComposerStatusAfterFloorOrCompaction`，该函数收窄为仅 annotate 版本后，此调用点改为调用收窄版（不删调用）。
- `renderer/features/chat/ConversationPanel.tsx` + `ChatComposer.tsx`：删 L197-267 的 `hasPendingUserOps` state / prop 供给链（`refreshPendingUserOps` 轮询 `ipcUserVfsHasPending`、`onWorkspaceMutated` 刷新、会话切换重置、prop 下传及 `ChatComposer` L57/L92/L375/L425 消费）；`composerSendIntent` / `composerSendableInput` 传参同步删 `hasPendingUserOps` 字段，否则 excess-property 报错。
- `WorkspaceSettingsView.tsx`：删开关；`messages.ts` rollback 与 composer 清推里的 ops 逻辑拆除，`rollback-annotate-restore.ts` 保留。

兼容性：
- 历史 DB 消息中的手改 `user_ops` 附件：气泡渲染兼容保留（DTO 枚举值不删）；prompt 侧由 D2 过滤不再带出；Undo Send 对历史 ops 附件不再生效（可接受，已确认）。
- 偏好键残留 KKV 旧值无害，不迁移。

## 详细实现步骤

- Step 1 — phase-fork-agent-config — blocking: yes — qa: auto：`fork` 事务内补 agent 配置复制（B）；更新 `AGENT_LOCK_TOAST` 文案与 `loadChatAgentMeta` 的 ChatError 归一（B-mobile）。
- Step 2 — phase-fork-agent-config — blocking: yes — qa: auto：`chat.services.test.ts` 补 fork 用例：fork 后 `ctx.sessions.getSessionAgentConfig(forked.id)` 等于源配置（fixture 见 `test/helpers/novel-master-fixture.ts`）。
- Step 3 — phase-compaction-floor — blocking: yes — qa: auto：`resolve-hide-message-range.ts` 实现配对感知边界扩展（A，D5 约束）。
- Step 4 — phase-compaction-floor — blocking: yes — qa: auto：`test/depth/resolve-hide-message-range.test.ts` 补 tool blocks 用例（`makeMsg` helper 扩展 blocks：`{ type: "tool_result", toolUseId, content }`，字段见 `content-block.ts` L39-46）。
- Step 5 — phase-unhide-menu — blocking: yes — qa: auto：mobile native 菜单去掉 rollback 的 `!hidden` 前置（C，订正后口径；首版 unhide 实现已拆除）。
- Step 6 — phase-unhide-menu — blocking: yes — qa: auto：webview `menu.ts` 同步 + 重建 webview-dist + 更新 `message-action-items.test.ts` / `chat-transcript-set-floor-menu.test.ts` 断言（items 顺序敏感）。
- Step 7 — phase-unhide-menu — blocking: no — qa: auto：desktop 菜单项（可选；desktop 菜单本无 rollback 项，订正后不涉及）。
- Step 8 — phase-stream-pending-snapshot — blocking: yes — qa: auto：`sendSessionSnapshot` 加 force 参数（D，D4 语义），needsFullSnapshot 分支传 force。
- Step 9 — phase-stream-pending-snapshot — blocking: yes — qa: auto：`useSessionBatch` 加 `flushBuffers`，`useSessionStream` 三事件 handler 在 `acceptRunEvent` 守卫后、分支前先 flush（D），装配方补参。
- Step 10 — phase-stream-pending-snapshot — blocking: yes — qa: auto：mobile 测试：`use-chat-stream-runtime.test.ts`（batch flush 时序）+ `chat-transcript-webview.test.tsx`（force 快照 postMessage 序列：snapshot 不被 streamActive 拦截、delta 继续追加无回跳）。
- Step 11 — phase-user-ops-removal — blocking: yes — qa: auto：core 拆除（E-core：store/投影/flush/prompt 过滤 D2/chip 判定 D3/send-intent/prefs/导出）。
- Step 12 — phase-user-ops-removal — blocking: yes — qa: auto：mobile 拆线（E-mobile：Composer 门闩与订阅、开关、rollback/清推；annotate 链路保留）。
- Step 13 — phase-user-ops-removal — blocking: yes — qa: auto：desktop 拆线（E-desktop：IPC 三通道、workplace 清推调用、状态条推送收窄 D7、`hasPendingUserOps` 供给链 D6）。
- Step 14 — phase-user-ops-removal — blocking: yes — qa: auto：测试清理与改写：删 ops 专属用例（core `user-ops-operation-log*.test.ts`、`prompt-unify-user-ops.test.ts` 等），改写 annotate 保留断言与 send-intent 用例。core 侧区分两类：**删用例**——`test/chat/user-vfs-turn.service.test.ts` L1041/L1086/L1115 直接调用 `hasPendingTurns`（D6 删除后运行时 TypeError，随删）；**清 mock**——`test/service/agent/run-agent-turn.test.ts`（11 处 `hasPendingTurns` 引用，含 `UserVfsTurnService["hasPendingTurns"]` 类型索引）、`annotate-drafts-send.test.ts`（3 处）、`run-agent-turn-abort-registry.test.ts` / `subsession-workspace-isolation.test.ts` / `run-agent-turn-project-agent.test.ts`（各 1 处）——`tsx --test` 不查类型，但 `npm run typecheck` 会炸，mock 残留必须清。desktop 侧涉 ops 测试共 12 个（附清单）：`messages-rollback-user-ops-log`、`preferences-user-ops-log-clear`、`chat-composer.integration`、`composer-at-path`、`rollback-composer`、`workplace-handlers`、`notify-composer-status-after-kkv-clear`、`rollback-annotate-restore`、`attachment-draft-chips`、`chat-annotate-draft`、`message-attachment-group-card`、`message-blocks`。mobile 侧 5 个：`__tests__/project-composer-status-clear.test.ts`（L7-8 `appendUserOpsLog` / `resetUserOpsLogStoreForTests`）、`__tests__/chat-composer.integration.test.tsx`（L109-110 同款）、`__tests__/workplace-block.service.test.ts`（L6-8）、`__tests__/use-chat-tab-message-actions-rollback.test.ts`（L15-19，含 `buildUserOpsAttachmentFromLogEntry`）四个删/改写 ops 用例，`__tests__/chat-annotate-draft.test.ts` L38 清 `hasPendingUserOps: false` prop——Step 11 删导出后 mobile pretest 重建 core 即编译炸，须随 Step 12 落地。另：`test/chat/user-vfs-turn.service.test.ts` 除 `hasPendingTurns` 三处外，L424-1113 约 20 处 `flushPendingUserVfsTurns` 用例断言 ops→附件转换行为，随 ops 构造删除一并删/改写（保留磁盘写与不落日志类用例）。
- Step 15 — phase-user-ops-removal — blocking: no — qa: manual_user：Android 真机回归（合并后用户执行）：批注草稿 chip 正常、发送正常、prompt 无手改 XML。

## 测试策略

- 命令：core `npm run test:fast -w @novel-master/core -- test/<路径>`；mobile `npm test -w @novel-master/mobile`（pretest 自动 build core + webview）；desktop `npm test -w @novel-master/desktop`；全量 `npm test`。
- CI 为 continue-on-error，lint/knip 不在门禁——删除类改动的 unused export 需人工 review 确认。

### 测试用例

- T-FK1 — blocking: yes — fork 后新会话 `getSessionAgentConfig` 等于源会话配置（→ Step 2）。
- T-FK2 — blocking: yes — 源配置为 NULL（repo 层手动清空）时 fork 不抛错、新会话配置为 NULL（→ Step 1/2）。
- T-CF1 — blocking: yes — fromSeq 向上锚定到真用户输入（user 且非 tool_result），隐藏区间第一条必为 user；边缘 assistant 或 user(tool_result) 均向上跳过整个 tool 往返（→ Step 3/4，订正后口径）。
- T-CF2 — blocking: yes — toSeq 边缘为 assistant(tool_use) 且 tool_result 在 range 外时，toSeq 向外扩展纳入 tool_result 消息（→ Step 3/4）。
- T-CF3 — blocking: yes — 无配对拆开时 range 与原行为完全一致（回归保护，→ Step 3/4）。
- T-CF4 — blocking: yes — 全 user 无 assistant 时仍返回 null（既有行为不变，→ Step 4）。
- T-UH1 — blocking: yes — `buildMessageActionItems`：hidden 消息同样含「回滚」、无「取消隐藏」；items 顺序断言更新（→ Step 5/6，订正后口径）。
- T-UH2 — blocking: no — 已废弃（首版 unhide 链路用例，随实现一并拆除）。
- T-UH3 — blocking: no — webview `buildMenuItems` 镜像断言：hidden 行同样含 rollback（→ Step 6）。
- T-ST1 — blocking: yes — 多轮 tool run：step commit 后 needsFullSnapshot 快照不被重启的 streamActive 拦截，postMessage 序列中 snapshot 先于后续 delta、无内容回跳（→ Step 8/10）。
- T-ST2 — blocking: yes — STEP_COMMITTED/RUN_FINISHED/RUN_FAILED 前 batch 缓冲先 flush 再 clear，无 delta 丢弃（→ Step 9/10）。
- T-ST3 — blocking: no — Android 真机 + webview + richText：3+ 轮 tool run，每步正文在 STEP_COMMITTED 后不消失（manual_user，合并后用户验收）。
- T-UO1 — blocking: yes — `<user-ops>` 渲染：手改附件（action=write/edit）不进 prompt，annotate 附件仍进（含历史消息附件，→ Step 11）。
- T-UO2 — blocking: yes — `isComposerStatusAttachment`：annotate chip 仍判定为状态附件（D3，→ Step 11）。
- T-UO3 — blocking: yes — 发送使能：无正文无批注时不可空发；仅批注草稿时可发（→ Step 12）。
- T-UO4 — blocking: yes — 既有 annotate / rollback 反投影用例全绿；desktop 状态条 push/pull 链按 D7 收窄为仅 annotate 后不炸（推送函数与 `SESSIONS_PROJECT_COMPOSER_STATUS` 通道均保留，`notify-composer-status-after-kkv-clear` 用例改写覆盖）（→ Step 13/14）。

## 风险与回滚方案

- **压缩边界扩展（A）**：只向外扩不会退回 `2f5bb4b4` 漏 hide；风险是扩展越过 `visible` 列表边界（配对消息不在 visible 内）——实现时以 visible 列表内查找为限，找不到配对就保持原边界（兜底层仍在）。回滚：revert `resolve-hide-message-range.ts` 单文件。
- **force 快照（D）**：语义钉死为「消费 pending + 取消 timer + 直发」；风险是 snapshot rows 过期导致一帧回跳——T-ST1 用 postMessage 序列断言钉住。回滚：去掉 force 参数及其唯一传参点。
- **batchFlush（D）**：flush 与 reload 后 `tryCommitStreamTail` 是同内容双通道，靠 `lastStreamCommitIdsRef` 去重接住（desktop 已验证同模式）。回滚：移除 `batchFlush` 三处调用与接口。
- **ops 拆除（E）**：最大风险是 chip 判定误伤 annotate（D3 已防）与 rollback 链路拆错（annotate 反投影保留已列明）；历史附件 prompt 过滤是行为变化（D2 已拍板）；跨端删除的编译炸点（core `index.ts` L127 re-export、desktop `workplace.ts`、双端 `project-composer-status.service.ts` 的 ops 投影 import）已列入 E 清单，其中双端 composer-status 服务按 D7 **收窄保留不删**，import 炸点以改写收口，实施时以三端 build 为准；`hasPendingTurns` 删除（D6）与推送收窄（D7）波及 desktop 轮询链与空续跑分支，均有步骥钉住。回滚：按文件 revert；DB 无 schema 变更、无数据迁移，回滚零成本。
- **webview-dist**：menu.ts 改动后必须重建（`__tests__` 有直接读产物的镜像测试）；漏重建不用担心——mobile 的 pretest 会自动执行 `npm run build:webview` 重建产物兜底，T-UH3 的镜像断言随后校验重建结果。
- 共同约束：`.woktree/` 下有同构副本，所有 grep/改动以主工作区为准。
