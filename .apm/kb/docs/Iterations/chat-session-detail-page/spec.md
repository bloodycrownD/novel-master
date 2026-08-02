---
date: 2026-08-02
---

# 聊天会话详情页 技术规格（SPEC）

## 设计目标

需求来源：`.apm/kb/docs/Iterations/chat-session-detail-page/prd.md`（已确认，含本 spec 撰写期间对 model 优先级链的修正）。

目标有二：① 新增 QQ 式聊天详情页，统一收拢现在散落的会话内操作入口；② 把模型/智能体作用域从 workspace/项目级下沉到单聊级，让每个会话可独立绑定 agent（引用 registry id）与覆盖 model。

本迭代已在实现阶段拍板为**两级链**（移除 workspace 回退层），core 内部视角（不含 CLI）如下：

- **agent 来源**：`project custom 截断 → session.agentId`
- **model 来源**：`agent pin（definition.model）→ session.modelId`

每个会话**始终独立持有** `agentId`（必填）+ `modelId`（可选），创建时从 workspace 当前值复制一份作为默认配置，之后不再 follow / 回退 workspace。project custom 命中即截断（不读 `session.agentId`）；agent 带 model pin 即截断（不读 `session.modelId`）。agent 的专属 model pin 视为「特有配置」，地位对齐 project custom，优先级最高。详情页遇到带 pin 的 agent 时禁用 model 切换入口（与 project custom 禁 agent 切换同一套模式）。

### Core 清理 CLI-only 漏入（顺带）

探索发现 core 的 `runAgentTurn` / 解析链混入了多个只服务 CLI 的入口（desktop/mobile 全不传，core 探索审查 `core-explore-remediation` 也已标记）。本期一并清理，让 core 保持通用，CLI 自己兜底：

- `resolveSavedModelId` 去掉 `cliModelId` 入参
- `resolveApplicationModelIdForRun` 去掉 `cliModelId?` 入参
- `RunAgentTurnOptions` 去掉 `cliModelId`、`definitionOverride`、`allowAssistantContinue`、`maxStepsOverride` 四个 CLI-only 字段
- `run-agent-turn.ts` 移除 `definitionOverride` 旁路（L206-212）、`allowAssistantContinue` 相关分支（互斥校验 L196-200、空续跑 assistant 路径 L226-236、prepared turn 的 `!allowAssistantContinue` 短路 L271-274、`shouldAppendNewUser` 的 `!allowAssistantContinue` L308）、`maxStepsOverride` 透传
- CLI 端自行兜底：model override 改为「写进 definition.model 副本」、definition 覆盖改为「直接覆写 scope 指向的 project/session 配置」或本地预处理、continue/max-steps 改为 CLI 本地控制 runner（具体落点见 Step 0d）

> **不在清理范围**：`allowResumeWithoutInput` 看起来像 CLI-only，实际是 **mobile/desktop/CLI 三端共用的「空续跑」能力**（源自 `agent-resilience-mobile-yaml` 迭代）。证据：core `run-agent-turn.ts` L180-190 / L232-242 / L270-275 / L306-315 都基于它分支处理；desktop `ChatComposer.tsx` L294-325 / L374-398 透传；mobile `ChatComposer.tsx` L283-325 / L388-424 / L502-519 透传；desktop `agent.ts` IPC handler L289 透传 `req`。本期**保留不动**，相关分支不移除。

## 总体方案

分五层自底向上改造：

0. **Core 清理层**：移除 `runAgentTurn` / 解析链里的 CLI-only 漏入（`cliModelId`、`definitionOverride`、`allowAssistantContinue`、`maxStepsOverride` 四个；`allowResumeWithoutInput` 是三端共用的空续跑能力，**保留不动**）。清理后 core 只认 project / session 两层运行时作用域（workspace 仅作为「新建会话时复制的默认值来源」，不参与 session 运行时解析），CLI 在自己那一侧解决 flag 覆盖。这一层先做，避免和后面的 session 级解析改动叠加在同一函数上反复改。

1. **存储层**：给 `chat_session` 表加 `agent_config_json TEXT NULL` 列容器（复用 `chat_project.agent_config_json` 范式），但内容只存引用——`SessionAgentConfig = { agentId: string; modelId?: string }`（agentId 必填，去掉 mode 字段，没有 follow 状态）。照抄 `composer_draft_json` 的「侧信道列」模式：列不进 `ChatSession` 主模型，走独立 get/set。涉及 DDL、列对齐声明、`SCHEMA_BOOT_VERSION` 升级，以及 `session-agent-config-v2` schema migration（回填老数据）。

2. **Core 解析层**：扩展两条解析链为两级。agent 侧给 `resolveAgentForProject` 加 `sessionId` 入参，**去掉 follow 分支的 workspace 回退**，直接用 `session.agentId`，source 枚举收窄为 `'project-custom' | 'session'`。model 侧 `resolveSavedModelId` 移除 `workspaceModelId?` 入参，优先级改为 `agent pin → session.modelId`。`AgentRunRuntimePort` 扩展以暴露 session 级读取能力。

3. **IPC 层**：保留老的 `AGENT_SET_CURRENT`/`MODEL_SET_CURRENT`（workspace 全局，供全局页用），新增 session 级 channel（`SESSIONS_SET_AGENT_BINDING` 等）。`PromptAgentMetaResponse.source` 收窄为 `'project-custom' | 'session'`（UI 兑底可加 `'none'` 表示无 meta），`modelSource` 收窄为 `'agent-pin' | 'session'`。`handlePromptAgentMeta` 终于消费 `req.sessionId`。会话始终持有 agentId，`SET_AGENT_BINDING` 不再支持 null 解绑；`SET_MODEL_OVERRIDE` 传 null 清除会话 model 覆盖（回退到 agent pin，文案改为「使用 Agent 指定模型」，去掉「回退工作区」措辞）。

4. **UI 层**：mobile 新增 `SessionDetailScreen`（独立 Stack 路由，由 AppHeader 三线按钮触发），`SessionActionsDrawer` **保留**（由 ChatComposer ⋯ 按钮触发，继续承载重命名 / 查看提示词 / 压缩上下文 / 切换大模型 / 切换智能体五项）。desktop 新增模态抽屉 `SessionDetailDrawer`，替换 `#session-actions-menu`。详情页聊天名点击直接 inline 编辑（不弹 modal），agent / model 各是一张可点击卡片，去掉菜单列表。两端 picker 的 select 逻辑分流：会话内写 session 绑定，全局页写 workspace。

## 最终项目结构

新增文件：

```
packages/core/src/domain/chat/model/session-agent-config.ts          # SessionAgentConfig 类型
packages/core/src/domain/chat/model/session-agent-config.schema.ts   # Zod schema + toWire
packages/core/test/chat/session-agent-config.schema.test.ts          # schema 校验测试
packages/core/test/chat/sqlite-session.agent-config.test.ts          # 仓储 get/set 测试
packages/core/test/service/chat/session.agent-config.test.ts         # service 层测试
packages/core/test/service/agent/resolve-agent-for-project.test.ts   # 扩展 session 级用例（已有文件，加 case）
packages/core/test/agent/resolve-saved-model-id.test.ts              # 扩展 session 级用例（已有文件，加 case）
apps/mobile/src/screens/stack/SessionDetailScreen.tsx                # 详情页
apps/mobile/src/navigation/SessionDetailStack.tsx                    # Stack 路由包装
apps/mobile/__tests__/session-detail-screen.test.tsx                 # 详情页测试
apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx          # 模态抽屉详情页
apps/desktop/test/session-detail-drawer.test.ts                      # 抽屉测试
```

改动文件（按层归类见「变更点清单」）。

删除文件：

- `apps/cli/src/agent/resolve-application-model-id.ts` —— dead code，`commands.ts` 早不引用，且 core 删 `cliModelId` 后会断编译（详见「CLI — 兑底（降级）」表格）。

## 变更点清单

### Core — 清理 CLI-only 漏入

| 文件 | 改动 |
|------|------|
| `packages/core/src/domain/agent/logic/resolve-saved-model-id.ts` | `ResolveSavedModelIdInput` 删 `cliModelId?`；`resolveSummarySavedModelId` 同理删 `cliModelId?` |
| `packages/core/src/domain/agent/logic/resolve-application-model-id.ts` | deprecated 别名跟随，不再传 cliModelId |
| `packages/core/src/service/agent/logic/agent-run-shared.ts` | `resolveApplicationModelIdForRun` 删 `cliModelId?` 入参 |
| `packages/core/src/service/agent/logic/run-agent-turn.ts` | `RunAgentTurnOptions` 删 `cliModelId`、`definitionOverride`、`allowAssistantContinue`、`maxStepsOverride` 四个字段（`allowResumeWithoutInput` 保留不动——三端共用空续跑）；移除 L206-212 `definitionOverride` 旁路（直接走 `resolveAgentForProject`）；移除 `allowAssistantContinue` 相关分支（互斥校验 L196-200、空续跑 assistant 路径 L226-236、prepared turn 的 `!allowAssistantContinue` 短路 L271-274、`shouldAppendNewUser` 的 `!allowAssistantContinue` L308）；`allowResumeWithoutInput` 相关分支（L180-190 / L232-242 / L270-275 / L306-315）**保留不动**；`maxSteps` 直接用 `definition.runtime?.maxSteps ?? DEFAULT_AGENT_MAX_STEPS`，删 `options?.maxStepsOverride`；`runner.run` 调用删 `cliModelId` 透传（L383） |
| `packages/core/src/service/agent/agent.port.ts` | `AgentRunOptions` 如有 `cliModelId` 一并删 |
| `packages/core/test/agent/resolve-saved-model-id.test.ts` | 删 cliModelId 相关 case |
| `packages/core/test/agent/resolve-application-model-id.test.ts` | deprecated 别名测试同步删 cliModelId 相关 case（L9/L37 两处 `{ cliModelId: … }` 传参，与 `resolve-saved-model-id.test.ts` 同步处理；别名输入类型与 `resolveSavedModelId` 同一份，core 删字段后此文件会编译失败） |
| `packages/core/test/service/agent/cli-run-agent-turn-parity.test.ts` | parity 测试同步改：移除对被删字段（`cliModelId` / `definitionOverride` / `allowAssistantContinue` / `maxStepsOverride`）的断言；`allowResumeWithoutInput` 相关 case 保留不动 |

### CLI — 兑底（降级）

| 文件 | 改动 |
|------|------|
| `apps/cli/src/agent/commands.ts` | 移除 `options.cliModelId` / `options.definitionOverride` / `options.allowAssistantContinue` / `options.maxStepsOverride` 赋值与对应 flag 处理（`--modelId` / `--agent-config` / `--agent-id` / `--prompt-path` transient / `--max-steps`）；`continue` 子命令末条 assistant 分支改为抛错，末条 user 分支改用 `allowResumeWithoutInput`；`--save` 路径（持久化 project custom）保留不动；usage 文案同步更新 |
| `apps/cli/src/agent/resolve-application-model-id.ts` | **删除 dead 模块**：`commands.ts` 的 import 列表早已不引用它（`--modelId` flag 在 `commands.ts` L127 直接用 `flagString(flags, "modelId")` 读取），且该文件 `resolveCliSavedModelId` 内部还在传 `cliModelId` 给 core 的 deprecated 别名，core 删字段后会断编译。整文件直接删，不留扩展点 |

### Core — 存储

| 文件 | 改动 |
|------|------|
| `packages/core/src/bootstrap/chat/chat-schema.ts` | `chat_session` DDL 加 `agent_config_json TEXT NULL` |
| `packages/core/src/bootstrap/schema-align/schema-column-alignments.ts` | 加一条 `chat_session.agent_config_json` 对齐声明 |
| `packages/core/src/bootstrap/novel-master-bootstrap.ts` | `SCHEMA_BOOT_VERSION` 2 → 3 |
| `packages/core/src/domain/chat/model/session-agent-config.ts` | **新文件**：`SessionAgentConfig`（`{ agentId: string; modelId?: string }`，agentId 必填，去 mode）、`SessionAgentConfigPatch`、`DEFAULT_SESSION_AGENT_CONFIG` |
| `packages/core/src/domain/chat/model/session-agent-config.schema.ts` | **新文件**：`sessionAgentConfigSchema`（`.strict()` + `.superRefine` agentId 必填、去 mode 校验）+ `toWire` |
| `packages/core/src/domain/chat/repositories/session.port.ts` | 加 `getSessionAgentConfig(id): Promise<string \| null>`、`setSessionAgentConfig(id, json, updatedAtMs): Promise<boolean>` |
| `packages/core/src/domain/chat/repositories/impl/sqlite-session.repository.ts` | 实现上述两方法（照抄 `getComposerDraftJson`/`setComposerDraftJson`）；**不**加进 `SESSION_COLUMNS`/`rowToSession`；`set` 更新 `updated_at_ms`（绑定切换是会话活动，语义比 composer 草稿更重） |
| `packages/core/src/service/chat/session.port.ts` | 加 `getSessionAgentConfig(id): Promise<SessionAgentConfig>`、`updateSessionAgentConfig(id, patch): Promise<SessionAgentConfig>` |
| `packages/core/src/service/chat/impl/session.service.ts` | 实现上述方法（校验存在 → merge → decode → serialize → 写列）；`copy` **继承源 session 的 agent_config_json**（新会话持源会话的 agentId + modelId，不再默认 follow）；`create`（新建会话）从 workspace 当前 agentId + modelId 复制一份作为该会话的默认配置 |

#### `SessionAgentConfigPatch` 类型与 merge 规约

service 层的 `updateSessionAgentConfig(id, patch)` 接收的 patch 是 partial overlay（**不是** full replace），类型定义如下：

```ts
export type SessionAgentConfigPatch = {
  agentId?: string;        // 可选：不传则保持当前 agentId；传则覆盖（必须为非空串）
  modelId?: string | null; // 可选：不传则保持当前 modelId；传 null 清除会话 model 覆盖（回退到 agent pin）
};
```

merge 规约（在 service 层应用，patch 与当前 config 合并后再 schema 校验）：

1. **`patch.agentId` 不为 `undefined`**：覆盖当前 `agentId`；必须为非空串，空串在 schema 校验报错（service 抛 `AgentConfigError`）。会话始终必须持有 agentId，没有「解绑回 follow」路径。
2. **`patch.modelId === undefined`**：保持当前 `modelId` 不动。
3. **`patch.modelId === null`**：清除会话 model 覆盖（删除 modelId 字段，回退到 agent pin 指定的模型）。
4. **`patch.modelId` 为字符串**：覆盖当前 `modelId`。

注：由于新 config 形态没有 mode 字段，旧设计里的 `bind → follow` 列存 NULL 规约、`{ mode: "follow" }` / `{ mode: "bind" }` 三种 patch 形态均已作废。`getSessionAgentConfig` 读到列 NULL 视为**异常**（schema migration 保证无 NULL），service 抛 `INVALID_ARGUMENT`。
| `packages/core/src/domain/chat/model/session.ts` | **不动**（侧信道列不进主模型） |

### Core — 解析链

| 文件 | 改动 |
|------|------|
| `packages/core/src/domain/agent/logic/resolve-saved-model-id.ts` | `ResolveSavedModelIdInput` 加 `sessionModelId?`；**移除 `workspaceModelId?` 入参**；优先级（清理 cliModelId、去 workspace 后）改为 `agent pin → session.modelId` |
| `packages/core/src/service/agent/logic/agent-run-shared.ts` | `AgentRunRuntimePort` 加 `readonly sessions: { getSessionAgentConfig(id): Promise<SessionAgentConfig> }`；`resolveApplicationModelIdForRun` 加 `sessionId?: string` 入参，读 session config 取 `modelId` 传入纯函数，**不回退 workspace** |
| `packages/core/src/service/agent/logic/resolve-agent-for-project.ts` | 签名加 `sessionId: string`；**去掉 follow 分支的 workspace 回退**，直接用 `runtime.sessions.getSessionAgentConfig(sessionId).agentId` 去 registry 取 definition 返回 `{ source: "session", agentId, definition }`；source 枚举收窄为 `'project-custom' \| 'session'`；custom 分支不变（截断，不读 session.agentId） |
| `packages/core/src/service/agent/logic/run-agent-turn.ts` | L210 改 `resolveAgentForProject(runtime, scope.projectId, scope.sessionId)`；L246 改 `resolveApplicationModelIdForRun(runtime, definition, scope.sessionId)`（无 cliModelId） |

### Core — 公开导出

| 文件 | 改动 |
|------|------|
| `packages/core/src/public/agent.ts` | 导出 `resolveAgentForProject` 新签名兼容（已有导出，签名变更）；如新增类型一并导出 |
| `packages/core/src/public/chat.ts` | 导出 `SessionAgentConfig`、`SessionAgentConfigPatch`、`DEFAULT_SESSION_AGENT_CONFIG`、`sessionAgentConfigSchema` |
| `packages/core/src/service/chat/impl/session.service.ts`（deps 扩展） | `SessionServiceDeps` 加 `state`（workspace state 读取）+ `agentRegistry`（agent registry）；`createChatServices(conn, { state, agentRegistry })` 第二参可选，只透传给 session service。新建会话时用 `resolveWorkspaceAgentForNewSession({ state, agentRegistry })` helper 决定默认 agentId + modelId（workspace agentId 缺失时回落 registry 第一个 agent） |
| `packages/core/test/package-exports-t0.test.ts` | 补 session agent config 导出契约 |

### Core — 迁移扩展点（本次登记，未来实现）

| 文件 | 改动 |
|------|------|
| `packages/core/src/bootstrap/schema-migrations/saved-model-identity-v1.ts` | **登记**：会话级 `agent_config_json.modelId`（顶层，非 `definition.model` 嵌套）未来需纳入 saved model 引用扫描；当前 migration 已是 idempotent no-op，仅作扩展点记录 |
| `packages/core/src/domain/provider/logic/find-saved-model-references.ts` | **登记**：同上，未来补 `chat_session` 扫描分支 |

### Desktop — IPC

| 文件 | 改动 |
|------|------|
| `apps/desktop/shared/ipc-types.ts` | 加 `SESSIONS_GET_AGENT_BINDING`/`SESSIONS_SET_AGENT_BINDING`/`SESSIONS_SET_MODEL_OVERRIDE` channel；加对应 Request/Response DTO（见下方「IPC DTO wire 形态」）；`PromptAgentMetaResponse.source` 收窄为 `'project-custom' \| 'session'`（UI 兑底可加 `'none'` 表示无 meta），`modelSource` 收窄为 `'agent-pin' \| 'session'`（去掉 `'global'`/`'workspace'`/`'session-bind'`/`'session-override'`/`'cli'`）；`AgentSetCurrentRequest`/`ModelSetCurrentRequest` **不动**（保留为 workspace 全局入口） |
| `apps/desktop/src/main/ipc/handlers/sessions.ts` | 加 `handleSessionsGetAgentBinding`/`handleSessionsSetAgentBinding`/`handleSessionsSetModelOverride`（参考 composer draft handler 写法，透传 `rt.sessions.*`） |
| `apps/desktop/src/main/ipc/handler-registry.ts` | 注册新 channel（`bindReq`，紧挨 L218-219） |
| `apps/desktop/src/main/ipc/handlers/prompt.ts` | `handlePromptAgentMeta` 消费 `req.sessionId`，传给 `resolveAgentForProject`；返回值补 `modelSource` |
| `apps/desktop/src/main/ipc/handlers/agent.ts` | `handleAgentResolveCurrent` 如被详情页复用，扩展接 `sessionId/projectId`（或详情页直接走 `PROMPT_AGENT_META`） |
| `apps/desktop/renderer/ipc/invoke-registry.ts` | 加 `ipcSessionsGetAgentBinding`/`ipcSessionsSetAgentBinding`/`ipcSessionsSetModelOverride` client |

#### IPC DTO wire 形态

`SessionAgentConfigDto` 是详情页读写的 wire 载荷，**与 core 的 `SessionAgentConfig` 同型**，直接复用核心类型（避免双向映射重复定义）：

```ts
export type SessionAgentConfigDto = {
  agentId: string;        // 必填，会话始终持有 agentId
  modelId?: string;       // 可选，清除会话 model 覆盖时删除该字段
};
```

三个新 channel 的 Request/Response 形态（均走 `IpcResult<T>` 包装，错误用 `formatIpcError`）：

| channel | Request | Response |
|---------|---------|----------|
| `SESSIONS_GET_AGENT_BINDING` (`nm:sessions/getAgentBinding`) | `{ sessionId: string }` | `IpcResult<SessionAgentConfigDto>` |
| `SESSIONS_SET_AGENT_BINDING` (`nm:sessions/setAgentBinding`) | `{ sessionId: string; agentId: string \| null }` | `IpcResult<SessionAgentConfigDto>` |
| `SESSIONS_SET_MODEL_OVERRIDE` (`nm:sessions/setModelOverride`) | `{ sessionId: string; modelId: string \| null }` | `IpcResult<SessionAgentConfigDto>` |

语义约定：
- `SET_AGENT_BINDING` 的 `agentId` 必填（会话始终持有 agentId，不支持 null 解绑）；传具体 id 写入 session.agentId。原「传 null 解绑回 follow」语义作废。
- `SET_MODEL_OVERRIDE` 传 `modelId: null` 表示清掉会话 model 覆盖（回退到 agent pin 指定的模型，UI 文案为「清除会话覆盖（使用 Agent 指定模型）」）；agentId 保持现状不动。
- 两个 SET 都返回最新 `SessionAgentConfigDto`，UI 拿到后直接刷新本地状态（无需重新 GET）。
- **channel 命名保留现状**（审查 P2 已认定 `SESSIONS_GET_AGENT_BINDING` 命名合理），后续不再改名，避免内部多份引用同步负担。

### Desktop — UI

| 文件 | 改动 |
|------|------|
| `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx` | **新文件**：模态抽屉详情页，承载原 `#session-actions-menu` + `WorkspaceFooter` 切换能力。聊天名点击直接 inline 编辑（不弹 modal，回车 / 失焦保存、Esc 取消，调 `ipcSessionsRename`）；agent / model 各是一张可点击卡片，点击弹 picker；去掉菜单列表与「重命名」按钮；次要操作（查看提示词 / 压缩上下文）弱化为底部文字链接 |
| `apps/desktop/renderer/features/chat/WorkspaceFooter.tsx` | agent/model 切换写回改 session 级 IPC（传 `sessionId`）；`agentLocked` 判定基于 `source === "project-custom"`（source 枚举收窄后无 `'session-bind'`，session 状态下 agent 可切换）；model 切换加 pin 检测禁用 |
| `apps/desktop/renderer/App.tsx` | `#session-actions-menu` 整体替换为「打开详情抽屉」入口；`openSessionActions` 改为打开抽屉；补 project-custom 锁判定（现有 bug，顺手修） |
| `apps/desktop/renderer/providers/ShellNavProvider.tsx` | `notifyAgentConfigChanged` 评估按 sessionId 精细化（避免切 A 会话刷 B 会话 footer）；本期可暂保留全局 revision，标 follow-up |

### Mobile — UI

| 文件 | 改动 |
|------|------|
| `apps/mobile/src/screens/stack/SessionDetailScreen.tsx` | **新文件**：详情页（由 AppHeader 三线按钮触发），承载聊天名 inline 编辑 + agent / model 卡片切换；去掉菜单列表；次要操作（查看提示词 / 压缩上下文 / 重命名 / 切换大模型 / 切换智能体）不重复，仍由 `SessionActionsDrawer`（⋯ 按钮触发）承载 |
| `apps/mobile/src/navigation/types.ts` | `RootStackParamList` 加 `SessionDetail: { projectId: string; sessionId: string }` |
| `apps/mobile/src/navigation/RootNavigator.tsx` | 三步注册：import + `withStackLayout('SessionDetail', SessionDetailScreen)` + `<Stack.Screen>` |
| `apps/mobile/src/components/chat/ChatMetaBar.tsx` | `onOpenDetail` 由 AppHeader 三线按钮（MenuIcon）触发，跳转详情页；`agentLocked` 基于 `source === "project-custom"`（source 枚举收窄后无 `'session-bind'`，session 状态下 agent 可切换） |
| `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx` | **保留** `SessionActionsDrawer`（L345-361），由 `ChatComposer.onOpenMore`（⋯ 按钮）触发；picker（AgentPickerModal / ModelPickerModal）迁进详情页；详情页由三线按钮 navigate |
| `apps/mobile/src/components/chrome/SessionActionsDrawer.tsx` | **保留不动**（⋯ 按钮触发，继续承载重命名 / 查看提示词 / 压缩上下文 / 切换大模型 / 切换智能体五项；原 spec「删除」作废） |
| `apps/mobile/src/components/agent/AgentPickerModal.tsx` | `select` 接收 `sessionId`，分流写 session 绑定 vs workspace；`reload` 的 `currentId` 按 session 取 |
| `apps/mobile/src/components/provider/ModelPickerModal.tsx` | 同上，`select` 分流；加 agent pin 检测禁用 |
| `apps/mobile/src/services/agent-picker.ts` | 加 `loadSessionAgentPickerRows(runtime, sessionId)`、`selectSessionAgent(runtime, sessionId, agentId)` |
| `apps/mobile/src/services/chat-agent-meta.ts` | `ChatAgentMeta.source` 收窄为 `'project-custom' \| 'session'`（去掉 `'session-bind'`/`'global'`）；加 `modelSource` 字段（`'agent-pin' \| 'session'`）；`loadChatAgentMeta` 签名加 `sessionId`，调 core 新解析 |
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts` | `refreshChatMeta`（L88-120）传 `sessionId` 给 `loadChatAgentMeta` |

### Mobile — runtime

| 文件 | 改动 |
|------|------|
| `apps/mobile/src/runtime/create-mobile-runtime.ts` | 确认 `runtime.sessions` 已注入新 `getSessionAgentConfig`/`updateSessionAgentConfig`（透传 core service） |
| `apps/mobile/src/services/agent-run.service.ts` | L36-43 `resolveMobileSavedModelId` wrapper 签名扩为 `(runtime, definition, sessionId)`，调用 `resolveApplicationModelIdForRun` 时传 `sessionId`；L41 调用点同步传 `sessionId` |
| `apps/mobile/src/services/prompt-preview.service.ts` | L18 透传 `scope.sessionId` 给 `resolveAgentForProject` |
| `apps/mobile/src/services/session-prompt-input.service.ts` | L38 透传 `scope.sessionId` 给 `resolveAgentForProject`（同 desktop 的 `definition ??` 短路逻辑） |
| `apps/mobile/src/services/chat-agent-meta.ts` | L29 透传 `sessionId` 给 `resolveAgentForProject`（已在「Mobile — UI」中变更，此处仅列调用点完整性） |

### Desktop — runtime

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/main/runtime/create-desktop-runtime.ts` | 确认 `runtime.sessions` 注入新方法 |
| `apps/desktop/src/main/services/agent-run.service.ts` | L42-49 `resolveDesktopSavedModelId` wrapper 签名扩为 `(runtime, definition, sessionId)`，调用 `resolveApplicationModelIdForRun` 时传 `sessionId`；L47 调用点同步传 `sessionId` |
| `apps/desktop/src/main/services/prompt-preview.service.ts` | L17 透传 `scope.sessionId` 给 `resolveAgentForProject` |
| `apps/desktop/src/main/services/session-prompt-input.service.ts` | L28 透传 `scope.sessionId` 给 `resolveAgentForProject`（`definition ??` 短路优先，仅当未预传入 definition 时才调 resolver） |
| `apps/desktop/src/main/ipc/handlers/agent.ts` | L272-277 `handleAgentRun` 预检查调用 `resolveDesktopSavedModelId` 时传 `req.sessionId`（与 wrapper 新签名匹配） |

## 兼容性或迁移说明

### Schema 迁移

新增 `session-agent-config-v2` schema migration（参考 `saved-model-identity-v1` 范式，走 `schema_migrations` 登记）：

- migration **在 `alignSchemaColumns` 之前跑**——legacy 库可能尚缺 `chat_session.agent_config_json` 列，migration 内先检测列存在性（`pragma_table_info`），缺列先 `ALTER TABLE chat_session ADD COLUMN agent_config_json TEXT NULL`，再走数据回填。
- 老数据 NULL → 回填 workspace 当前 agentId + modelId（用 `resolveWorkspaceAgentForNewSession` 同源逻辑）；workspace agentId 缺失时回落 `agent_definition` 表第一个 agent。
- 老数据 `{ mode: "bind", agentId, modelId? }` → 剥掉 `mode` 字段，保留 `agentId`（必填）+ `modelId`（可选）。
- 老数据 `{ mode: "follow" }` → 同 NULL 处理，回填 workspace 当前 agentId + modelId。
- migration idempotent，新库（DDL 直接建列）与已迁移库不重复执行。

`SCHEMA_BOOT_VERSION` 2 → 3，已升级库重新走慢路径补列（DDL + 对齐声明部分）；`session-agent-config-v2` migration 部分独立于 bootVersion，走 `schema_migrations` 机制。

### 向后兼容

- 老 `AGENT_SET_CURRENT`/`MODEL_SET_CURRENT` IPC channel 保留，workspace 全局页（mobile「我的」/ desktop 工作区设置）继续用，不动。
- 新 session 级 channel 独立，会话内入口走新 channel，全局页走老 channel，互不干扰。
- `resolveAgentForProject` 签名加 `sessionId` 是 breaking change，但所有调用点都在本仓库内（同 PR 同步改完即可）。core 的 `resolveSavedModelId` 移除 `workspaceModelId?` 入参同样在仓内同步改完。
- **列 NULL 语义**：`getSessionAgentConfig` 读到列 NULL 视为**异常**，service 抛 `INVALID_ARGUMENT`（migration 保证无 NULL）。旧设计「NULL = follow 默认值」语义作废。
- **CLI-only 入口清理是 breaking change**：`runAgentTurn` 的 `cliModelId`/`definitionOverride`/`allowAssistantContinue`/`maxStepsOverride` 四个字段移除。CLI 是唯一消费方（desktop/mobile 全不传），同步改 CLI 兑底逻辑即可。core 探索审查 `core-explore-remediation` 已标记 `cliModelId` 为「声明但未接线」的死代码，本次一并清掉。`allowResumeWithoutInput` 不在清理范围（三端共用空续跑，见「Core 清理 CLI-only 漏入」小节）。

### copy 语义

- 会话 `copy` **继承源 session 的 `agent_config_json`**（深拷贝源会话的 agentId + modelId）。新会话持与源会话相同的 agent / model 配置，不再默认 follow / 回退 workspace。旧设计「copy 不复制、默认 follow」作废。

### 新建会话语义

- 新建会话时，从 workspace 当前 agentId + modelId 复制一份作为该会话的默认配置（`resolveWorkspaceAgentForNewSession({ state, agentRegistry })` helper）。workspace agentId 缺失时回落 registry 第一个 agent。会话创建后即独立持有配置，后续切换只写 session 级，不再 follow / 回退 workspace。

### 解绑语义

- 会话始终持有 agentId（必填），没有「解绑回 follow」路径，`SET_AGENT_BINDING` 不支持 null。原「`bind → follow` 列存 NULL」规约作废。model 可清除会话覆盖（`SET_MODEL_OVERRIDE` 传 null），回退到 agent pin 指定的模型（文案「清除会话覆盖（使用 Agent 指定模型）」），去掉「回退工作区」措辞。

## 详细实现步骤

**Phase 0：Core 清理 CLI-only 漏入（先做，避免和 session 级解析改动叠加在同一函数上反复改）**

- Step 0a — phase-core-cleanup — blocking: yes — qa: auto：`resolve-saved-model-id.ts` 删 `cliModelId?`（`ResolveSavedModelIdInput` 和 `ResolveSummarySavedModelIdInput`）；优先级改为 `agent pin → workspace`；更新对应测试。同步改 `packages/core/test/agent/resolve-application-model-id.test.ts`（deprecated 别名测试，L9/L37 用 `{ cliModelId: … }` 传给 `resolveApplicationModelId`/`resolveSummaryApplicationModelId`，输入类型与 `resolveSavedModelId` 同一份，删字段后会编译失败，需同步删 cliModelId 相关 case）
- Step 0b — phase-core-cleanup — blocking: yes — qa: auto：`agent-run-shared.ts` `resolveApplicationModelIdForRun` 删 `cliModelId?` 入参；deprecated 别名跟随
- Step 0c — phase-core-cleanup — blocking: yes — qa: auto：`run-agent-turn.ts` `RunAgentTurnOptions` 删四个 CLI-only 字段（`cliModelId`、`definitionOverride`、`allowAssistantContinue`、`maxStepsOverride`；`allowResumeWithoutInput` 保留不动）；移除对应分支（`definitionOverride` 旁路、`allowAssistantContinue` 相关分支、`maxStepsOverride` 透传）；`allowResumeWithoutInput` 相关分支保持原样；`maxSteps` 直接用 definition 默认；同步改 `packages/core/test/service/agent/cli-run-agent-turn-parity.test.ts`（移除对被删字段的断言）
- Step 0d — phase-cli-fallback — blocking: no — qa: auto：CLI 本地兑底，core 不再感知 CLI flag。CLI 现状只有 `runAgentTurn` 入口（无 runner 句柄，不能包预处理），且被删的四个字段里三个都是「需要预处理注入 definition」才能继续工作。本步骤拆为以下子项，**采取明确降级路径**（不留给 CLI 自定）：
  - **Step 0d.1 — model override（`--modelId`）**：core 侧 `runAgentTurn` 不再接 `cliModelId`/`definitionOverride`，无法在调用前注入到 definition。**降级**：CLI 不再支持 `--modelId` 覆盖；用户需改 workspace 当前模型，或走 project/session `agent_config_json` 写 custom definition。usage 文案引导用户走后两者。`apps/cli/src/agent/resolve-application-model-id.ts` 是 dead code（`commands.ts` import 列表不引用它，`--modelId` flag 在 `commands.ts` L127 直接用 `flagString(flags, "modelId")` 读取），且其内部 `resolveCliSavedModelId` 还在向 core deprecated 别名传 `cliModelId`，core 删字段后会断编译——**整文件删除**，不留扩展点。`commands.ts` 中 `const cliModelId = flagString(flags, "modelId")` 与 `options` 里的 `cliModelId` 键一并随 Step 0d.4 清掉。
  - **Step 0d.2 — definition 覆盖（`--agent-config`/`--agent-id`/`--prompt-path`）**：现状走 `definitionOverride`，被删后 core 无低阶入口接受运行时 definition。**降级**：CLI 不再支持运行时 transient 覆盖；用户需带 `--save` 显式写入 project `agent_config_json`（custom 模式）后再 run。`commands.ts` 中 `definitionFromFlags` 分支与 `options.definitionOverride` 赋值**一并移除**；`--save` 路径（写 project custom）保留不动。
  - **Step 0d.3 — continue / max-steps**：现状 `nm agent continue` 在末条 assistant 时传 `allowAssistantContinue: true` + `maxStepsOverride: 1`，两个字段同时被删。**降级**：`continue` 子命令改为复用 `allowResumeWithoutInput`（末条为 user 时仍可用）；末条为 assistant 时不再有等价能力，CLI 抛错提示「暂不支持 assistant-continue，请新增 user 输入」。`--max-steps` flag 移除，`maxSteps` 一律用 `definition.runtime.maxSteps ?? DEFAULT_AGENT_MAX_STEPS`。
  - **Step 0d.4 — options 构造清理**：`commands.ts` 的 `options` 对象移除 `cliModelId` / `definitionOverride` / `allowAssistantContinue` / `maxStepsOverride` 四个键；`stream` / `signal` / `onStream` / `allowResumeWithoutInput` 保留。
- **已知限制（写入 spec，不留给实现拍板）**：CLI 在本迭代后丢失三个能力——`--modelId` 覆盖、transient `--agent-config`/`--agent-id`/`--prompt-path` 覆盖、assistant-continue。CLI 仅测试用，无 production 用户（见风险表）。未来如需恢复，core 需开低阶入口 `runAgentTurnWithDefinition(runtime, scope, content, definition, options?)` 或类似——本次不做，登记到 follow-up。

**Phase 1+：详情页与 session 级绑定**

- Step 1 — phase-core-storage — blocking: yes — qa: auto：新建 `session-agent-config.ts` + `session-agent-config.schema.ts`（类型、Zod schema、toWire、DEFAULT）
- Step 2 — phase-core-storage — blocking: yes — qa: auto：`chat-schema.ts` DDL 加列；`schema-column-alignments.ts` 加对齐声明；`novel-master-bootstrap.ts` `SCHEMA_BOOT_VERSION` 2→3
- Step 3 — phase-core-storage — blocking: yes — qa: auto：`session.port.ts`（仓储）+ `sqlite-session.repository.ts` 加 `getSessionAgentConfig`/`setSessionAgentConfig`（照抄 composer draft，set 更新 `updated_at_ms`）
- Step 4 — phase-core-storage — blocking: yes — qa: auto：`session.port.ts`（service）+ `session.service.ts` 加 `getSessionAgentConfig`/`updateSessionAgentConfig`；`copy` 继承源 session 配置；`create` 从 workspace 当前值复制默认配置（需扩 `SessionServiceDeps` 加 `state` + `agentRegistry`，`createChatServices(conn, { state, agentRegistry })` 第二参可选，只透传给 session service；用 `resolveWorkspaceAgentForNewSession({ state, agentRegistry })` helper）
- Step 5 — phase-core-storage — blocking: yes — qa: auto：公开导出（`public/chat.ts`）+ `package-exports-t0.test.ts` 契约
- Step 5b — phase-core-storage — blocking: yes — qa: auto：新增 `session-agent-config-v2` schema migration（参考 `saved-model-identity-v1`）：migration **在 `alignSchemaColumns` 之前跑**，legacy 库缺 `agent_config_json` 列时先 `ALTER TABLE ADD COLUMN`；老数据 NULL / `{mode:"follow"}` → 回填 workspace 当前 agentId + modelId；老数据 `{mode:"bind"}` → 剥 mode 字段；workspace 为空时回落 `agent_definition` 表第一个 agent。在 `schema_migrations` 登记。
- Step 6 — phase-core-resolver — blocking: yes — qa: auto：`resolve-saved-model-id.ts` 加 `sessionModelId?` 入参，**移除 `workspaceModelId?` 入参**，优先级改为 `agent pin → session.modelId`（去 workspace）
- Step 7 — phase-core-resolver — blocking: yes — qa: auto：`agent-run-shared.ts` 扩 `AgentRunRuntimePort`（加 `sessions.getSessionAgentConfig`）；`resolveApplicationModelIdForRun` 加 `sessionId?` 入参，**不回退 workspace**
- Step 8 — phase-core-resolver — blocking: yes — qa: auto：`resolve-agent-for-project.ts` 加 `sessionId` 入参；**去掉 follow 分支的 workspace 回退**，直接用 `session.agentId`；source 枚举收窄为 `'project-custom' \| 'session'`；custom 截断不变
- Step 9 — phase-core-resolver — blocking: yes — qa: auto：`run-agent-turn.ts` L210/L246 透传 `scope.sessionId`（Phase 0 已移除 `definitionOverride` 旁路，此处不再提及）
- Step 10 — phase-core-resolver — blocking: yes — qa: auto：`public/agent.ts` 导出更新；deprecated 别名跟随
- Step 11 — phase-core-meta — blocking: yes — qa: auto：扩展 `ResolvedAgentForProject` 的 source 枚举消费方，让 meta 层能区分 `'session'`（mobile `loadChatAgentMeta` + desktop `handlePromptAgentMeta` 同步加 `modelSource`，两档：`'agent-pin'`/`'session'`）
- Step 12 — phase-desktop-ipc — blocking: yes — qa: auto：`ipc-types.ts` 加新 channel + DTO；`PromptAgentMetaResponse` 扩 source/modelSource
- Step 13 — phase-desktop-ipc — blocking: yes — qa: auto：`sessions.ts` handler + `handler-registry.ts` 注册；`prompt.ts` 消费 sessionId；`agent.ts` 按需扩展
- Step 14 — phase-desktop-ipc — blocking: yes — qa: auto：`invoke-registry.ts` 加 client 函数
- Step 15 — phase-desktop-runtime — blocking: yes — qa: auto：`create-desktop-runtime.ts` 注入；`agent-run.service.ts` wrapper 签名扩为 `(runtime, definition, sessionId)` + L47 调用点透传；`prompt-preview.service.ts` L17 / `session-prompt-input.service.ts` L28 透传 sessionId；`agent.ts` L272-277 `handleAgentRun` 预检查透传 `req.sessionId`
- Step 16 — phase-desktop-ui — blocking: no — qa: auto：新建 `SessionDetailDrawer.tsx` 模态抽屉，聊天名 inline 编辑（不弹 modal），agent / model 卡片点击弹 picker，去掉菜单列表；次要操作弱化为底部文字链接
- Step 17 — phase-desktop-ui — blocking: no — qa: auto：`App.tsx` 替换 `#session-actions-menu` 为打开抽屉；补 project-custom 锁判定
- Step 18 — phase-desktop-ui — blocking: no — qa: auto：`WorkspaceFooter.tsx` 写回改 session 级 IPC；锁判定基于 `source === "project-custom"`（session 状态下 agent 可切换）；model 加 pin 检测
- Step 19 — phase-mobile-runtime — blocking: yes — qa: auto：`create-mobile-runtime.ts` 注入；`agent-run.service.ts` wrapper 签名扩为 `(runtime, definition, sessionId)` + L41 调用点透传；`prompt-preview.service.ts` L18 透传 sessionId 给 `resolveAgentForProject`
- Step 20 — phase-mobile-service — blocking: yes — qa: auto：`agent-picker.ts` 加 session 级 load/select；`chat-agent-meta.ts` 加 sessionId + source 收窄（`'project-custom' \| 'session'`）+ `modelSource`（两档）；`session-prompt-input.service.ts` L38 透传 sessionId 给 `resolveAgentForProject`
- Step 21 — phase-mobile-service — blocking: yes — qa: auto：`useChatTabScope.ts` `refreshChatMeta` 传 sessionId
- Step 22 — phase-mobile-ui — blocking: no — qa: auto：新建 `SessionDetailScreen.tsx` + Stack 注册（types.ts + RootNavigator.tsx）
- Step 23 — phase-mobile-ui — blocking: no — qa: auto：AppHeader 三线按钮（MenuIcon）跳详情页（navigate）；`agentLocked` 基于 `source === "project-custom"`（session 状态下 agent 可切换）
- Step 24 — phase-mobile-ui — blocking: no — qa: auto：`ChatConversationPanel.tsx` **保留** `SessionActionsDrawer`（⋯ 按钮触发，承载五项次要操作）；picker 迁进详情页；详情页由三线按钮 navigate
- Step 25 — phase-mobile-ui — blocking: no — qa: auto：`AgentPickerModal`/`ModelPickerModal` select 分流（session vs workspace）；`SessionActionsDrawer.tsx` **保留不动**（原 spec「删除」作废）
- Step 26 — phase-e2e-verify — blocking: no — qa: manual_user：mobile 真机验收详情页转场 + Android 返回键；desktop 验收模态抽屉交互（合并后用户执行）

## 测试策略

### 测试用例

**Core — 清理 CLI-only 漏入**

- T-C1 — blocking: yes — `resolveSavedModelId` 不再接受 `cliModelId`；优先级最终为 `agent pin → session`（去 workspace）
- T-C2 — blocking: yes — `runAgentTurn` 不再接受 `cliModelId`/`definitionOverride`/`allowAssistantContinue`/`maxStepsOverride`（`allowResumeWithoutInput` 保留）；移除旁路后 agent 解析必走 `resolveAgentForProject`

**Core — 存储层**

- T-S1 — blocking: yes — `SessionAgentConfig` schema：`{ agentId: "x" }` 合法、`{ agentId: "x", modelId: "m" }` 合法、缺 agentId 报错、agentId 为空串报错、带残留 `mode` 字段报错（`.strict()`）、未知字段报错
- T-S2 — blocking: yes — 仓储层：`setSessionAgentConfig` 写入后 `getSessionAgentConfig` 读回一致；读到列 NULL 视为异常（service 抛 `INVALID_ARGUMENT`，migration 保证无 NULL）；列不进 `ChatSession` 主模型（侧信道）
- T-S3 — blocking: yes — service 层：`updateSessionAgentConfig` merge patch 正确（`{ agentId }` 覆盖 agentId、`{ modelId: "m" }` 覆盖 modelId、`{ modelId: null }` 清除 modelId、不传字段保持）；`copy` 继承源 session 配置（agentId + modelId 都拷贝）
- T-S4 — blocking: yes — schema 升级：旧库（无列）升级后补列成功 + `session-agent-config-v2` migration 回填老数据（NULL / `{mode:"follow"}` 回填 workspace 当前值、`{mode:"bind"}` 剥 mode 字段、workspace 为空回落 registry 第一个 agent）；新库（DDL 建列）不重复执行；migration 在 `alignSchemaColumns` 之前跑，legacy 缺列时先 `ALTER TABLE ADD COLUMN`

**Core — 解析链**

- T-R1 — blocking: yes — `resolveSavedModelId`：`agent pin > session` 两档全覆盖；session 为空时不影响 agent pin 生效（无 workspace 第三档）
- T-R2 — blocking: yes — `resolveAgentForProject` session 维度：project custom 时忽略 session.agentId（截断，返回 `source: "project-custom"`）；非 custom + session.agentId → `source: "session"` + 正确 definition。无 follow / workspace 回退路径。
- T-R3 — blocking: yes — `resolveAgentForProject`：session bind 的 agentId 在 registry 改 definition 后，下次 resolve 拿到新 definition（引用语义）
- T-R4 — blocking: yes — `runAgentTurn`：`scope.sessionId` 正确透传到 resolver；agent 解析必走 `resolveAgentForProject`（无 `definitionOverride` 旁路）

**Core — meta**

- T-M1 — blocking: yes — `loadChatAgentMeta`/`handlePromptAgentMeta`：非 custom 时返回 `source: "session"` + 真实 agentId；custom 时返回 `source: "project-custom"`；`modelSource` 两档正确（`'agent-pin'`/`'session'`，去掉 `'workspace'`/`'cli'`）

**Desktop — IPC**

- T-D1 — blocking: yes — `SESSIONS_GET/SET_AGENT_BINDING` handler：透传 `rt.sessions.*` 正确；`PromptAgentMetaResponse` 含新字段
- T-D2 — blocking: yes — `handlePromptAgentMeta` 消费 `req.sessionId`（之前被忽略）

**Desktop — UI**

- T-D3 — blocking: no — `SessionDetailDrawer`：聊天名 inline 编辑（点击 / 回车 / 失焦 / Esc）、agent/model 卡片点击弹 picker；project-custom 时 agent 切换禁用 + toast；agent 带 pin 时 model 切换禁用；不再弹重命名 modal
- T-D4 — blocking: no — `App.tsx` 入口替换：原菜单不再渲染；点击触发抽屉

**Mobile — UI**

- T-M2 — blocking: no — `SessionDetailScreen` 渲染 + 操作（聊天名 inline 编辑 / 切模型 / 切智能体卡片）wiring 正确；不包含重命名 / 查看提示词 / 压缩上下文（这些由 `SessionActionsDrawer` 承载）
- T-M3 — blocking: no — AppHeader 三线按钮跳详情页（navigate）
- T-M4 — blocking: no — `ChatConversationPanel` **仍渲染** `SessionActionsDrawer`（⋯ 按钮触发，承载重命名 / 查看提示词 / 压缩上下文 / 切换大模型 / 切换智能体五项，不删除）
- T-M5 — blocking: no — picker select 分流：会话内写 session 绑定，全局页写 workspace

**集成**

- T-I1 — blocking: yes — run 级集成：会话 A 持 agent X，会话 B 持 agent Y，同一项目下 run 互不影响
- T-I2 — blocking: yes — model 隔离：会话 A 切 M2（agent 无 pin），会话 B 仍持自己的 modelId（无 workspace 回退）
- T-I3 — blocking: yes — agent pin 压制：会话绑定带 pin 的 agent，session.modelId 存在但 run 时用 agent pin（agent pin 截断）

### 测试框架约束

- **Core**：`node:test` + `node:assert/strict`，文件放 `packages/core/test/<域>/`，用 `novelMasterTestFixture()`。
- **Desktop**：`node:test` via `scripts/run-tests.mjs`（带 electron stub），文件放 `apps/desktop/test/`，React 组件用 `renderToStaticMarkup` + 源码字符串断言轻量风格。
- **Mobile**：Jest 29 + `react-test-renderer`，文件放 `apps/mobile/__tests__/`，大量 `jest.mock`。**改 core 后跑 mobile 测试前必须先 `npm run build -w @novel-master/core`**。

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| `SCHEMA_BOOT_VERSION` 升级导致所有已升级库重跑慢路径 | DDL `IF NOT EXISTS` + ALIGN `pragma_table_info` 幂等；migration idempotent | 回退 bootVersion + 删除对齐声明 |
| `resolveAgentForProject` 签名 breaking（含 `resolveSavedModelId` 移除 `workspaceModelId?`） | 所有调用点在仓内，同 PR 同步改 | revert 解析层 commit |
| session 的 agentId 指向已删除 agent | resolve 时 registry.get 抛错，复用现有 `AgentRunResolveError` 处理；meta 层走 catch 回退 `'none'` | — |
| `notifyAgentConfigChanged` 全局 revision 串扰（切 A 会话刷 B 会话 footer） | 本期暂保留全局 revision，标 follow-up；session 级刷新靠 `reload()` 局部生效 | — |
| 迁移扩展点遗漏（`saved-model-identity-v1` 未扫 session 表 modelId） | 本 spec 已登记扩展点；当前 migration 为 idempotent no-op，不影响已升级库；未来 saved model 引用扫描补 session 分支 | — |
| mobile AppHeader 三线按钮跳详情页后的返回转场 | 复用现有 Stack 路由返回能力；Android 物理返回键测验证 | — |
| desktop `#session-actions-menu` 现有无锁判定 bug | 本期顺手修（详情抽屉补 project-custom 锁） | — |
| `copy` 继承源配置可能不符预期 | 已在「兼容性」说明语义；源会话的 agentId + modelId 深拷贝，后续独立演化 | — |
| workspace 回退移除后，新建会话必须有 workspace 当前 agent | `resolveWorkspaceAgentForNewSession` 在 workspace agentId 缺失时回落 registry 第一个 agent，避免拿到空 agentId | — |
| `session-agent-config-v2` migration 缺列执行顺序 | migration 在 `alignSchemaColumns` 之前跑，内嵌列存在性检测，缺列先 `ALTER TABLE ADD COLUMN` 再回填 | 回退 migration 登记 + bootVersion |
| CLI-only 入口清理导致 CLI 功能回归 | CLI 仅测试用；无 production 用户；core 探索审查已标记为死代码；Step 0d 同步改 CLI 兑底 | revert Phase 0 commit |
| Phase 0 与 Phase 1+ 改动叠加在同一函数 | Phase 0 先做且 blocking，改完 core 测试全绿后再进 Phase 1 | — |

### 已决策的默认值（探索疑点回落）

- **copy 继承源配置**：会话 `copy` 深拷贝源会话的 agentId + modelId（不再跟 `composer_draft_json` 一致地不复制）。
- **新建会话复制 workspace 当前值**：workspace agentId 缺失时回落 registry 第一个 agent。
- **`setSessionAgentConfig` 更新 `updated_at_ms`**：绑定切换是会话活动（区别于高频草稿写）。
- **新 channel vs 改老 channel**：新增 session 级 channel，保留老 channel 为 workspace 全局入口。
- **`SessionDto` 不冗余绑定字段**：详情页单独走 `SESSIONS_GET_AGENT_BINDING`，避免列表 DTO 膨胀。
