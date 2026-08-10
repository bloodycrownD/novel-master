---
date: 2026-08-10
dependency: []
---

# 事件配置系统移除、Migration 清理、Bug 修复与 Token Usage 持久化 PRD

## 背景

当前系统存在两套独立的"压缩"领域模型：**事件配置系统**（`events-config` + `event-orchestrator`）负责"压缩时执行什么 action"，**压缩条件**（`compaction-conditions`）负责"什么时候触发压缩"。这套分离架构源自 `event-bus-compaction-conditions` 和 `event-config-dag` 两次迭代，但实际使用中事件配置系统极度收敛——默认配置里唯一生效的绑定是 `session.compaction.requested → hide-message { startDepth: 6 }`，另一个 action（`run-agent`）和另一个事件（`session.message.received`）在默认配置里完全为空。整套 DAG 编排器、事件订阅、UI 编辑器、CLI 命令维护了一个实际上只有一个动作的系统，成本远高于收益。

同时，schema migration 注册表积累了 8 条 migration，其中 6 条引入于 v1.4.08 及更早（距今超过 10 个 tag），DDL 变更已全部固化进 canonical 建表 SQL，注册表里的重复维护构成了技术债。

此外，本次迭代还包含三项独立 Bug 修复、Token Usage 持久化与回滚刷新、以及一个 Desktop 布局 Bug 修复：

1. **Bug1（已修复）**：rewind 回滚 Assistant 消息时批注草稿未清空。
2. **Bug2（已修复）**：智能体配置"专属模型"开关交互笨重，改为扁平下拉。
3. **Bug3（已修复）**：子会话首次进入流式输出丢失——根因是 `ChatTranscriptWebView` 的 `needsOpenSnapshot` 路径走了 `sendSessionSnapshot` 的 deferred 机制，首次建立 rows 基线的 snapshot 被延迟到流式结束，导致 WebView state.rows 为空、user 行不可见。
4. **Bug4（已修复）**：Desktop `ChatRail.tsx` 的 `$$` className 笔误导致消息多时列表无 scroll、输入框消失。
5. **Token Usage 持久化与回滚刷新**：token usage 完全不持久化（只活在进程内 Map），回滚后 UI 刷新有缺口。两层修复：(a) `ChatMessage` 加 `usage` 字段持久化 + cache 回填；(b) Mobile/Desktop 回滚后 UI 刷新补全。附带 Token 标签 UI 优化（`api`/`heuristic` 显示为「自动」）和移除 `heuristic` 手动选项。

历史迭代：`token-counting`（打地基）、`model-aware-token-counting`（模型感知计数）、`workspace-chat-vfs-upgrade/features/chat-token-api-overlay`（缓存语义真正出处）。

## 目标（含成功指标）

1. **移除事件配置系统**：删除 `events-config`、`event-orchestrator`、`events` service/domain、对应 UI 和 CLI，将唯一的 `hide-message` 动作合并进压缩配置。
2. **合并压缩 action**：`CompactionConditions` 吸收 `hide-message` 的 `startDepth` 参数，压缩触发后直接执行 hide-message + kkv 清理，不再经事件编排。
3. **清理旧 migration**：从注册表移除超过 10 个 tag 的 6 条 migration，附带版本基线前置检查。
4. **修复 Bug1-4**（均已修复，见验收标准）。
5. **Token Usage 持久化**：每条 assistant message 存储 LLM 响应的 usage；cache 失效后从历史 message 回填；回滚后 Mobile/Desktop UI 立即刷新。
6. **Token 标签 UI 优化**：`api`/`heuristic` 显示为「自动」；移除 `heuristic` 手动选项。
7. **成功指标**：
   - 代码净减（事件配置移除预估删除 > 2500 行，新增 < 300 行）
   - 压缩行为与现有完全一致（hide-message startDepth=6、kkv 清理 RULE_SNAPSHOT + FILE_CACHE、token cache 失效）
   - 新用户建库与已升级用户无感知
   - 回滚、重启场景下 token 计数与下一次 completed run 后的值一致
   - Bug1-4 不再复现

## 用户与场景

- **普通用户**：使用压缩功能的聊天用户。压缩触发时机、行为、隐藏深度完全不变。
- **高级用户（曾配过事件配置 UI）**：自定义的事件配置会丢失（`nm-events/config` KKV 静默废弃）。这部分用户极少——默认配置就是唯一实际使用的配置。
- **开发者**：代码库更简洁，不再需要理解 DAG 编排器就能理解压缩流程。

## 范围

### 包含范围

- 移除事件配置系统的 core domain / service / config-forms / errors
- 移除事件配置系统的 desktop / mobile UI、IPC、YAML 服务
- 移除 CLI `nm event emit` 命令
- 将 `hide-message` 动作合并进 `CompactionConditions`（新增 `hideStartDepth` 字段，schemaVersion 3→4）
- 将 `event-orchestrator.service.ts` 里的 kkv 清理副作用搬到新的压缩执行器
- 修改 `agent-runner.ts`：压缩触发后直接调执行器，不再经 orchestrator
- 修改三端手动压缩入口：直调执行器
- 从注册表移除 6 条旧 migration + 清理 import
- 新增 bootstrap 前置检查：防止未 apply 旧 migration 的极老库静默跳过
- 修复 Bug1（rewind 清空批注草稿）
- 修复 Bug2（专属模型扁平下拉）
- 修复 Bug3（子会话 needsOpenSnapshot 绕过 deferred）
- 修复 Bug4（ChatRail `$$` className 笔误）
- `ChatMessage` 新增 `usage` 字段（schema migration，`SCHEMA_BOOT_VERSION` 5→6）
- `agent-runner` 每次 round 的 assistant append 传入结构化 `result.usage`
- `sessionApiPromptTokenCache` 失效后从历史 message 回填（回滚、重启场景）
- Mobile `runRollback` 补 `refreshChatTokenLabel()`
- Desktop `SessionDetailDrawer` 补回滚后刷新（`messages-rollback` DOM CustomEvent）
- Token 标签 UI 映射优化（`api`/`heuristic` → 「自动」，具体 tokenizer 名原样显示）
- 用户配置中移除 `heuristic` 手动选项（`tokenCounterMode` 可选值改为 `auto` + 具体 tokenizer 族）

### 不包含范围

- 不实现 `global-compaction-policy` / `compaction-agent-update` 文档里的 `CompactionPolicy { abstract, keepLastN }` 规划稿
- 不写 `nm-events/config` 数据清理脚本（静默忽略即可）
- 不保留 `run-agent` action 和 `session.message.received` 事件触发能力（一并删除）
- 不处理 `vfs-entry-id-redesign-v1`（v1.4.12，距今 8 tag）和 `session-agent-config-v2`（v1.4.15，距今 5 tag）——保留
- completion tokens 的 UI 展示（本次只持久化，不做展示出口）
- 计费/统计报表
- 本地计数器覆盖范围调整（system/abstract/worktree 是否计入本地计数是独立问题）
- 手动压缩后 SessionDetailDrawer 刷新同样缺失（compact 不发 STEP/RUN 事件），另开迭代统一处理
- mobile jest 环境修复（Babel 配置不支持 TS），另开迭代

## 核心需求

### 1. 压缩配置吸收 hide-message 参数

`CompactionConditions` 新增可选字段 `hideStartDepth`（默认 6），schemaVersion 从 3 升到 4。store 增加 v3→v4 迁移（v3 视为默认 startDepth=6）。压缩 UI 上暴露这个参数的编辑。

### 2. 压缩执行直调化

`agent-runner.ts` 在 `compactionConditions.shouldRequestCompaction()` 返回 true 时，直接调用新的压缩执行器（`runCompaction`），执行 hide-message + kkv 清理（RULE_SNAPSHOT + FILE_CACHE）+ token cache 失效。不再经 `eventOrchestrator.emit()`。三端手动压缩入口同样改走直调。

### 3. 事件配置系统全量删除

删除以下 core 模块：`domain/events-config/`、`domain/events/`（事件类型常量保留压缩/消息接收等仍被引用的）、`service/events/`（`event-orchestrator` + `impl/actions/`）、`service/events-config/`、`config-forms/events/`、`errors/events-errors.ts`。hide-message handler 的逻辑搬到压缩执行器后删除原文件。

### 4. 三端 UI + CLI 清理

- Desktop：删除 `EventsConfigView.tsx`（566 行 DAG 编辑器）、settings-nav 中的事件配置入口、IPC handlers、events-yaml service、`shared/logic/events.ts`、`shared/logic/config-forms-events.ts`、`ipc-types.ts` 中的 `EventsConfigPlain`
- Mobile：删除 `EventsConfigScreen.tsx`、`EventConfigBlocks.tsx`、events-yaml service 及测试
- CLI：删除 `apps/cli/src/event/` 目录及注册

### 5. Migration 注册表清理

从 `SCHEMA_MIGRATIONS` 数组移除 6 条旧 migration（保留 `.ts` 文件供冷回放），清理 `index.ts` 顶部 import 和 re-export。在 bootstrap 早期增加版本基线检查——若 `schema_migrations` 表缺少这 6 个 id 之一且探测到 legacy 形态，fail-fast 报"请先升级到 v1.4.08"。

### 6. 压缩配置 UI 补全

在压缩配置已有的 UI 上（desktop/mobile），新增 `hideStartDepth` 的编辑控件（数字输入或下拉），替代从事件配置 UI 里消失的同等参数。

### 7. rewind 清空批注草稿（Bug1）

`rewind`（回滚 Assistant）成功后清空进程内 annotate store，与 `undo_send` 的反投影对称。

### 8. 专属模型扁平下拉（Bug2）

Mobile 和 Desktop 把"开关 + 服务商下拉 + 模型下拉"替换为单一模型下拉选择器。首位选项"默认(跟随)"，后面是跨 provider 聚合的全部 savedModels。core 零改动。

### 9. 子会话 needsOpenSnapshot 绕过 deferred（Bug3）

`ChatTranscriptWebView` 的 `needsOpenSnapshot` 路径改调 `sendSessionSnapshotNow`（立即发），不走 `sendSessionSnapshot` 的 deferred 路径（`uiRunning+streamActive` 时会 pending 到流式结束）。同时新建 core `AgentStreamRegistry`（按 sessionId 存 in-flight 流式累积文本），替代 UI 层 Provider 缓存 hack。

### 10. ChatRail className 笔误修复（Bug4）

`ChatRail.tsx` 的 conversation / subagent-conversation 视图容器 className 从 `chat-nav-view$$` 改回 `chat-nav-view`。

### 11. ChatMessage 新增 usage 字段持久化

每条 assistant message 存储 LLM 响应的结构化 usage（`promptTokens`/`completionTokens`/`totalTokens`，均可选）。schema migration 升版本号。旧数据该字段为 null（兼容）。

### 12. agent-runner 每次 round 写入 usage

`agent-runner.ts` 的 `session.append("assistant", ...)` 传入 `result.usage`。多 round run 的每条 assistant message 都带各自的 usage（包括 tool-call 中间 round）。

### 13. cache 失效后从历史 message 回填

`sessionApiPromptTokenCache` invalidate 后，从当前可见 messages 列表的最后一条带 usage 的 assistant message 读取 promptTokens 回填 cache，而不是直接跌到本地计数器。

### 14. 回滚后 UI 刷新补全

Mobile `runRollback` 补 `refreshChatTokenLabel()`；Desktop `SessionDetailDrawer` 通过 `messages-rollback` DOM CustomEvent 订阅回滚完成事件。

### 15. Token 标签 UI 展示优化

`api` 和 `heuristic` 显示为「自动」；具体 tokenizer 名原样显示。

### 16. 用户配置移除 heuristic 手动选项

`tokenCounterMode` 可选值移除 `heuristic`；旧数据归一化为 `auto`。

## 验收标准

### AC-1：压缩行为不变

- **Given** 任意会话达到压缩条件（tokenRatio 超阈值）
- **When** agent-runner 触发压缩
- **Then** 执行 hide-message，隐藏深度 = CompactionConditions.hideStartDepth（默认 6）
- **And** 清除 session kkv 的 RULE_SNAPSHOT + FILE_CACHE 域
- **And** prompt token cache 失效
- **And** 上述行为与变更前完全一致

### AC-2：手动压缩行为不变

- **Given** 用户在会话详情/操作抽屉点击"手动压缩"
- **When** 压缩执行
- **Then** 效果与 AC-1 一致（走同一条执行器路径）

### AC-3：事件配置 UI 彻底移除

- **Given** Desktop 设置页 / Mobile 设置页
- **When** 浏览导航菜单
- **Then** 不存在"事件配置"入口
- **And** 直接访问路由也不渲染

### AC-4：压缩配置含 hideStartDepth

- **Given** 压缩配置 UI（desktop / mobile）
- **When** 编辑压缩配置
- **Then** 可以设置 hideStartDepth（默认值 6）
- **And** 保存后持久化到 `nm-compaction-conditions/policy` KKV

### AC-5：schemaVersion 迁移

- **Given** 已有用户 DB 里 `nm-compaction-conditions/policy` 存的是 v3 格式
- **When** 升级后首次启动
- **Then** 自动迁移到 v4，hideStartDepth 填默认值 6
- **And** 后续读写正常

### AC-6：旧 migration 清理

- **Given** 已升级用户（schema_migrations 表含全部 6 个旧 id）
- **When** 升级到本版本
- **Then** bootstrap 正常启动，不报错
- **And** `schema_migrations` 表里旧 id 保留（不删除已 applied 记录）

### AC-7：极老库版本基线检查

- **Given** 极老用户（schema_migrations 表缺旧 id 且有 legacy 表形态）
- **When** 尝试启动
- **Then** fail-fast，提示"请先升级到 v1.4.08"

### AC-8：CLI 命令移除

- **Given** CLI 终端
- **When** 执行 `nm event emit`
- **Then** 命令不存在（或提示已移除）

### AC-9：rewind 清空批注 chip（Bug1）

- **Given** Composer 输入区有批注 chip
- **When** 回滚一条 Assistant 消息（走 `rewind` 分支）
- **Then** 批注 chip 全部消失
- **And** `undo_send` 的反投影行为不受影响

### AC-10：扁平下拉选默认/具体模型（Bug2）

- **Given** Agent 配置表单
- **When** 打开"专属模型"下拉
- **Then** 首位为"默认(跟随)"，后续为跨 provider 聚合的全部模型
- **And** 选中默认项 → `modelEnabled=false`；选中具体模型 → `modelEnabled=true` + `savedModelId`

### AC-11：子会话退出再进入 user 消息不消失（Bug3）

- **Given** 子会话 agent 运行中，流式进行
- **When** 从主会话进入子会话、退出、再进入
- **Then** user 消息正常显示，不因流式而消失
- **And** 从 core `streamRegistry` 读到完整累积流式 partial

### AC-12：Desktop 消息列表正常 scroll（Bug4）

- **Given** Desktop 会话有大量消息
- **When** 查看会话
- **Then** 消息列表有滚动条
- **And** 输入框始终可见

### AC-13：assistant message 存储 usage

- **Given** 一次 completed 的 agent run（含 tool-call 多 round）
- **When** run 结束后查看每条 assistant message 的 `usage` 字段
- **Then** 有 LLM usage 的 assistant message 都带 `promptTokens`/`completionTokens`（LLM 给了就存；无 assistant message 的 round 不持久化 usage，由估算兜底）

### AC-14：回滚后 token 计数来自 API 值

- **Given** 会话有带 usage 的 assistant message
- **When** 回滚到最后一条 assistant message
- **Then** token 计数显示该 message 的 `usage.promptTokens`（API 值），而非本地估算值

### AC-15：重启后 token 计数可恢复

- **Given** 会话有带 usage 的 assistant message
- **When** 重启 app 后打开同一会话
- **Then** token 计数显示最后一条带 usage 的 assistant message 的 promptTokens

### AC-16：Mobile/Desktop 回滚后 token 刷新

- **Given** 会话界面显示 token 计数
- **When** 执行回滚
- **Then** Mobile 顶栏 / Desktop 抽屉的 token 计数立即更新

### AC-17：Token 标签显示「自动」

- **Given** 会话有 API 缓存或走 heuristic 估算
- **When** 查看 token 标签
- **Then** 显示「自动」，不显示「api」或「heuristic」
- **And** 具体 tokenizer 名（如 tiktoken）原样显示

### AC-18：用户配置不含 heuristic 选项

- **Given** 用户打开 savedModel 的分词器配置下拉
- **When** 查看可选值
- **Then** 有「自动」和具体 tokenizer 族，无「启发式估算」
- **And** 旧数据 `tokenCounterMode === "heuristic"` 归一化为 `"auto"`

## 风险与待确认项

- **kkv 清理副作用遗漏**：`event-orchestrator.service.ts:162-176` 的 kkv 清理逻辑（RULE_SNAPSHOT + FILE_CACHE + token cache 失效）是最高风险点。搬走时必须完整保留，否则压缩后状态错乱。
- **`nm-events/config` 旧数据**：静默忽略，不清理。极端情况下如果用户手动改过事件配置（非默认值），自定义配置会丢失。默认配置用户无感知。
- **`session.message.received` 事件常量**：agent-runner 仍可能在其他路径使用这个事件（orchestrator 的 bus 订阅）。删除 orchestrator 的 bus 订阅后，这个事件如果还有其他消费者需保留常量定义；若无消费者则一并删。
- **Bug1 产品口径变更**：rewind 清批注破坏了原 spec 的"rewind 不清批注"合同。改动本身很小，但破坏了现有的"与置位/压缩对称"合同——置位/压缩仍不清批注，rewind 改为清。
- **Bug3 needsOpenSnapshot 绕过 deferred 的副作用**：首次进入时 `sessionChanged=true`，WebView `applySnapshot` 会清 stream tail。但 inject effect 紧跟其后注入累积 partial，所以流式内容不会真的丢。这个时序依赖 React child effect 先于 parent effect。
- **旧数据无 usage 字段**：migration 前的 assistant message 没有 usage，回填会 miss 到本地计数器。这是预期行为——只有新产生的 message 才有 usage。
- **回填的 promptTokens 口径**：历史 message 的 promptTokens 对应那条 message 被生成时的 prompt 大小，当前可见 prompt 可能已不同。回填是"最近似值"，只有下一次 completed run 才会刷新为真正的当前值。
