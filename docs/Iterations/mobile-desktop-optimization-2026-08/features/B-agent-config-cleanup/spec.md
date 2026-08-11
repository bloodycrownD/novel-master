---
date: 2026-08-11
---

# Feature B：智能体配置精简 技术规格（SPEC）

需求来源：`docs/Iterations/mobile-desktop-optimization-2026-08/features/B-agent-config-cleanup/prd.md`（dependency 指向 `Iterations/mobile-desktop-optimization-2026-08/prd.md`）。

本 SPEC 覆盖 PRD 的两件事：① `customAttach`（extra info）只对最新一条 user 消息拼接 `<extra-info>`；② 移除项目智能体（UI 隐藏 + domain/IPC/DB 清理）。

> 术语约定：用 `customAttach` 指代 agent 配置字段名（与 `system`/`workplace` 同层），用 `<extra-info>` 指代运行时拼出的提示词块名，用 `extraInfo` 指代 `wrapUserMessageForLlm`/prepare 链路的注入参数名；用「项目智能体」指代 `chat_project.agent_config_json` 承载的 `mode:"follow"|"custom"` 能力。

## 设计目标

- 让 `<extra-info>` 只贴在本次请求的最新一条 user 消息上，历史 user 消息保持干净，token 不浪费、语义更准。
- 把项目智能体这条没人用的能力从 UI、domain、IPC、DB 里彻底拿掉，让 `resolveAgentForProject` 只剩 session 分支，所有项目统一走 session 级智能体选择。

## 总体方案

两件事按两条独立 phase 推进，互不阻塞：

1. **extra info 收窄**（phase-extra-info-latest）：只改 `packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts` 一处——在遍历 user 消息前，先反向扫一遍找出最后一个满足 `role === 'user' && isUserInputMessage && !hidden` 的 index，`prepareOneUserMessage` 调 `wrapUserMessageForLlm` 时只有命中这条才透传 `runtime.extraInfo`，其余传 `undefined`。domain 模型、wire schema、表单状态层、双端 UI 一律不动。双端预览（`session-prompt-input.service`）走同一条 prepare，自动跟着收窄。
2. **移除项目智能体**（phase-project-agent-remove），分两步：
   - **Step A：UI 层隐藏**（phase-project-agent-remove/ui-hide）：desktop 删 `ChatRail` 右键「智能体配置」项、`ProjectAgentConfigView` 入口；双端锁定 UI 处理（desktop `SessionDetailDrawer.tsx` + mobile `SessionDetailScreen.tsx`，详见 Step 5）——移除对 `source === 'project-custom'` 的专门依赖，🔒 渲染保留、锁定判定保留（覆盖 none 场景），但「项目锁定」文案与指向已删入口的 toast 文案改为 none 场景口径；`resolveAgentForProject` 把 custom 分支短路到 follow（即使 DB 还有 custom 数据也忽略）；`projects.getAgentConfig`/`updateAgentConfig` IPC handler 保留但改为返回固定 follow / no-op，避免外部脚本调起出错。mobile 端项目智能体配置入口在历史迭代里已经重构掉，本期不做 mobile 入口删除（仅在 Step 10 清理 `chat-agent-meta.ts` 里残留的 `source: 'project-custom'` 分支）。
   - **Step B：清理 domain/IPC/DB**（phase-project-agent-remove/core-cleanup）：简化 `resolveAgentForProject` 只剩 session 分支；删 `ProjectAgentConfig`/`ProjectAgentMode`/schema、双端 chat-agent-meta 的 `source: 'project-custom'` 分支、`PROJECT_AGENT_META_DISPLAY_LABEL`；删 `projects.getAgentConfig`/`updateAgentConfig` IPC handler 与类型；DB 迁移把 `chat_project.agent_config_json` 置空（策略见风险章节）。

> 为什么分两步：UI 先隐藏能让用户立刻看到「项目智能体没了」的效果，domain/IPC/DB 清理涉及类型联动和迁移，单独成步便于回归与回滚。Step A 完成后即使 Step B 暂缓，系统行为对用户已经正确（项目永远走 follow），只是代码里还留着死类型。

## 最终项目结构

本次不新增模块、不新增目录。改动集中在既有文件：

**extra info 收窄**：

- `packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts`（遍历判定 + 调 wrap 时的 extraInfo 透传控制）

**移除项目智能体**：

- `packages/core/src/domain/chat/model/project-agent-config.ts`（删）
- `packages/core/src/domain/chat/model/project-agent-config.schema.ts`（删）
- `packages/core/src/service/agent/logic/resolve-agent-for-project.ts`（简化到只剩 session 分支）
- `packages/core/src/domain/chat/model/chat-agent-meta.ts` 或承载 `PROJECT_AGENT_META_DISPLAY_LABEL` 的文件（删常量）
- `apps/desktop/src/main/ipc/handlers/projects.ts`（删 `getAgentConfig`/`updateAgentConfig` handler）
- `apps/desktop/src/main/ipc/handlers/prompt.ts`（删 `source: 'project-custom'` 分支）
- `apps/desktop/renderer/features/settings/ProjectAgentConfigView.tsx`（删）
- `apps/desktop/renderer/layout/ChatRail.tsx`（删右键菜单项）
- `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx`（移除对 `source === 'project-custom'` 的专门依赖；🔒 渲染保留，「项目锁定」文案与指向「项目设置」/「智能体配置」的 toast 改为 none 场景口径）
- `apps/mobile/src/screens/stack/SessionDetailScreen.tsx`（清理注释里对 `source === 'project-custom'` 的描述；🔒 渲染保留，`AGENT_LOCK_TOAST` 里「项目智能体配置」引导改为 none 场景口径）
- `apps/mobile/src/services/chat-agent-meta.ts`（删 `source: 'project-custom'` 分支——mobile 端项目智能体配置入口在历史迭代已重构掉，`ProjectAgentConfigScreen`/`AgentEditorForm` 的 `editorMode="project"` 分支均已不存在，本期仅清理这条 meta 残留）
- DB 迁移：`chat_project.agent_config_json` 列清理

## 变更点清单

### A. extra info 收窄（phase-extra-info-latest）

| 文件 | 改动 |
|---|---|
| `packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts` | 在遍历 user 消息前，先反向扫一遍 `messages` 找出最后一个满足 `role === 'user' && isUserInputMessage(message) && !message.hidden` 的 index（`latestUserIndex`），传给 `prepareOneUserMessage` 做命中比对；命中才透传 `runtime.extraInfo`，其余传 `undefined`。`PrepareUserMessagesForPromptRuntime.extraInfo` 字段保留不动，仍是「开关开启后整次请求都传同一份文本」，只是注入位收窄到最新一条非 hidden user。 |

### B. 项目智能体移除（phase-project-agent-remove）

| 层 | 文件 | Step A（UI 隐藏） | Step B（core 清理） |
|---|---|---|---|
| core 解析 | `resolve-agent-for-project.ts` | custom 分支短路到 follow（不读 `agent_config_json`） | 删 custom 分支与对 `ProjectAgentConfig` 的引用，只剩 session 分支 |
| core 类型 | `project-agent-config.ts`、`project-agent-config.schema.ts` | 不动 | 删文件 |
| core 常量 | 承载 `PROJECT_AGENT_META_DISPLAY_LABEL` 的文件 | 不动 | 删常量 |
| chat-agent-meta（desktop） | `apps/desktop/src/main/ipc/handlers/prompt.ts` | 不动（Step A 期间仍可能命中，但因 resolve 已短路到 follow，实际不会产出 project-custom） | 删 `source: 'project-custom'` 分支 |
| chat-agent-meta（mobile） | `apps/mobile/src/services/chat-agent-meta.ts` | 同上 | 同上 |
| desktop IPC | `apps/desktop/src/main/ipc/handlers/projects.ts` | `getAgentConfig` 返回固定 follow、`updateAgentConfig` 改 no-op（或直接拒绝） | 删两个 handler 与 IPC 类型 |
| desktop UI 入口 | `ChatRail.tsx` | 删右键菜单「智能体配置」项 | —— |
| desktop UI 视图 | `ProjectAgentConfigView.tsx` | 删文件 + 移除导航注册 | —— |
| desktop 锁定 UI | `SessionDetailDrawer.tsx` | 移除对 `source === 'project-custom'` 的专门依赖；锁定判定（`agentLocked`/`modelLocked` 仍按 `source !== 'session'`，覆盖 none 场景）保留；🔒 渲染结构保留，但「项目锁定」文案与指向「项目设置」「智能体配置」的 toast 文案改为 none 场景口径（项目智能体入口已删，不能再引导过去） | —— |
| mobile 锁定 UI | `SessionDetailScreen.tsx` | 移除注释里对 `source === 'project-custom'` 的描述；锁定判定（`isAgentLocked`/`isModelLocked` 仍按 `source !== 'session'`，覆盖 none 场景；`isModelLocked` 的 `modelSource === 'agent-pin'` 分支保留）不动；🔒 渲染结构（chevron 换 🔒 + `opacity: 0.6` + lockHint）保留；L56 `AGENT_LOCK_TOAST` 里「请到「项目智能体配置」修改」的引导改为 none 场景口径 | —— |
| mobile UI 视图 | —— | mobile 端 `ProjectAgentConfigScreen`/路由/`AgentEditorForm` 的 `editorMode="project"` 分支在历史迭代已重构掉（grep 确认零匹配），本期无 mobile UI 删除动作 | —— |
| DB | `chat_project.agent_config_json` | 不动 | 迁移：置空该列数据（策略见风险） |

## 详细实现步骤

> 标注格式：`Step N — phase-<id> — blocking: yes|no — qa: auto|manual_user`

### phase-extra-info-latest

- **Step 1 — phase-extra-info-latest — blocking: yes — qa: auto**：改 `packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts`：
  - **「最后一条 user」判定口径**（钉死）：指外层 `prepareUserMessagesForPrompt` 循环里，最后一个会被 `prepareOneUserMessage` 处理的非 hidden 消息，即满足 `message.role === 'user' && isUserInputMessage(message) && !message.hidden` 的最后一条。不包含 tool_result（外层 L445 已过滤）、不包含 hidden user。判定以本次传入 prepare 的有序消息列表为准，不依赖 seq、不依赖持久化字段。
  - **实现方式**：在 `prepareUserMessagesForPrompt` 外层循环之前，先反向扫一遍 `messages` 找到最后一个满足上述三个条件的 index（记为 `latestUserIndex`），再把这个 index 传给 `prepareOneUserMessage` 做命中比对。**不要**在 `prepareOneUserMessage` 内部重新判定「是否最后一条」——保持单条函数无状态，命中逻辑集中在调用方。
  - `prepareOneUserMessage` 调 `wrapUserMessageForLlm(plainText, hydrated, extraInfoForThis)` 时，`extraInfoForThis = (index === latestUserIndex) ? runtime.extraInfo : undefined`。为此 `prepareOneUserMessage` 签名需新增一个 `index`/`isLatestUser` 入参（二选一，实现时拍板）。
  - `runtime.extraInfo` 字段语义不变（开关开启后整次请求都带同一份文本），只是注入位从「所有非 hidden user」收窄到「最新一条非 hidden user」。
  - **hidden 消息处理**（现状澄清，勿改）：hidden user 消息**仍会原样进 prepare 输出**——`prepareOneUserMessage` L357-359 对 hidden 直接 `return message` 原样带过（不 hydrate/wrap），外层 L449 照常 push。所以 hidden user 出现在输出里，只是不带 `<extra-info>`、不做 hydrate/wrap。现有测试 `prepare-user-messages-for-prompt.test.ts` T-HD1（L379-415）`assert.equal(messageBodyText(prepared[0]!), "隐藏")` 就是这个行为的契约。「最后一条 user」判定要排除 hidden，但 hidden 消息本身继续原样进输出。
- **Step 2 — phase-extra-info-latest — blocking: yes — qa: auto**：测试更新与新增：
  - **prepare 层独立测试**（`packages/core/test/chat/prepare-user-messages-for-prompt.test.ts`）：新增 T-EA1（3 条非 hidden user 序列，只第 3 条含 `<extra-info>`）、T-EA2（`runtime.extraInfo` 为空时全不带）、T-EA4（含 hidden user，hidden 原样进输出但不带 `<extra-info>`，最新非 hidden 命中）。现有单条用例 T-EI3/T-EI4/T-S1a 等无需改（单条场景下首条即最新，行为不变）。
  - desktop：`apps/desktop/.../test/session-prompt-input.service.test.ts`，把「所有 user 消息含 `<extra-info>`」改成「只有最新一条含」（对应 T-EA3 desktop 侧）。
  - mobile：`apps/mobile/src/services/__tests__/session-prompt-input.service.test.ts`，同上（对应 T-EA3 mobile 侧）。

### phase-project-agent-remove（Step A：UI 隐藏）

- **Step 3 — phase-project-agent-remove/ui-hide — blocking: yes — qa: manual_user**：desktop 端 UI 入口移除：
  - `apps/desktop/renderer/layout/ChatRail.tsx` L803-811：删项目右键菜单「智能体配置」项，连带其 onClick 跳转到 `ProjectAgentConfigView` 的逻辑。
  - `apps/desktop/renderer/features/settings/ProjectAgentConfigView.tsx`：删文件；移除 settings/导航里对它的注册（确认无其它入口）。
- **Step 4 — phase-project-agent-remove/ui-hide — blocking: no — qa: auto**：mobile 端防回归占位：mobile 端项目智能体配置入口（`ProjectAgentConfigScreen`、`AgentEditorForm` 的 `editorMode="project"` 分支、`ProjectAgentConfig` 路由注册）在历史迭代里已重构掉，本期无文件删除动作。这一步只做 grep 确认 `apps/mobile/src/**` 下 `ProjectAgentConfig|editorMode|AgentEditorForm` 仍为零匹配（防后续误引入）。mobile 端唯一相关残留是 `apps/mobile/src/services/chat-agent-meta.ts` 里的 `source: 'project-custom'` 分支，该残留留到 Step 10 与 desktop 一同清理。
- **Step 5 — phase-project-agent-remove/ui-hide — blocking: yes — qa: auto**：双端锁定 UI 处理（desktop `SessionDetailDrawer.tsx` + mobile `SessionDetailScreen.tsx`）。两端现状都有 🔒「项目锁定」/「智能体锁定」显式渲染，project-custom 消失后要把这些渲染、toast 文案、注释里对 project-custom 的引用一并清理掉，但锁定判定本身要保留——因为 `source === 'none'`（session.agentId 指向已删 agent）场景仍然需要锁住卡片、提示用户。
  - **desktop**（`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx`）：L210-217 的 `agentLocked = source !== 'session'` / `modelLocked = source !== 'session'` 两个判定保留不动（覆盖 none 场景）；agent 卡 L378-400、model 卡 L418-440 的 🔒 渲染（`session-detail-pick__lock-icon` 带 🔒 字符 + 「项目锁定」/「智能体锁定」文字 + `session-detail-pick--locked` 样式类）保留渲染结构，但「项目锁定」这串文案要改成 none 场景也说得通的措辞（比如「已锁定」），因为 project-custom 消失后唯一触发锁定的就是 none；L221 toast「当前会话的智能体已被项目锁定，请在项目设置中修改。」、L235 toast「当前智能体已锁定模型，请先在智能体配置中修改。」里对「项目设置」「智能体配置」的引导要改——项目智能体配置入口都没了，不能再指过去，改成 none 场景适用的措辞（agent 卡：「当前会话未绑定有效智能体，无法在会话内切换。」；model 卡：「当前智能体已锁定模型，会话内无法覆盖。」，与 mobile 侧 MODEL_LOCK_TOAST 对齐）。
  - **mobile**（`apps/mobile/src/screens/stack/SessionDetailScreen.tsx`）：L97-98 的 `agentLocked = isAgentLocked(meta)` / `modelLocked = isModelLocked(meta)` 判定保留（`isAgentLocked` 在 `chat-agent-meta.ts` L127-132 按 `meta.source !== 'session'` 判定，覆盖 none，这个行为是对的）；agent 卡 L290-298、model 卡 L331-339 的 🔒 渲染（chevron 换成 `'🔒'` 字符 + 整卡 `opacity: 0.6` + lockHint 渲染 toast 全文）保留渲染结构，但 L56 `AGENT_LOCK_TOAST`「智能体已被项目锁定，无法在会话内切换，请到「项目智能体配置」修改」、L57 `MODEL_LOCK_TOAST`「当前智能体已锁定模型，会话内无法覆盖」里对「项目智能体配置」的引导要改——「项目智能体配置」入口都没了，这条引导会把用户带到不存在的页面，改成 none 场景适用的措辞（AGENT_LOCK_TOAST：「当前会话未绑定有效智能体，无法在会话内切换。」；MODEL_LOCK_TOAST 维持现状即可，它本来就只说「智能体锁定模型」，没指向已删除的入口）。
  - **注释清理**（双端）：desktop `SessionDetailDrawer.tsx` L210-217、mobile `SessionDetailScreen.tsx` L9-13 的注释里，对 `source === 'project-custom'`（「项目截断」「项目级截断」「引导去项目设置改」）的描述要清理或改写为 none 场景口径，避免留下指向已删能力的注释。
  - **`isModelLocked` 的 `modelSource === 'agent-pin'` 分支保留**（P1-1）：mobile `chat-agent-meta.ts` 的 `isModelLocked` 在 `modelSource === 'agent-pin'`（agent 自带 model pin）时返回锁定，这个分支与 project-custom 无关、project-custom 消失后仍要保留（agent pin 是 agent definition 自带的能力，不属于项目智能体范畴），本期不动。
- **Step 6 — phase-project-agent-remove/ui-hide — blocking: yes — qa: auto**：core `resolve-agent-for-project.ts` L55-85：把 custom 分支短路到 follow——即使 `agent_config_json` 里 mode 是 custom，也忽略内联 definition，走 session.agentId → registry。保留 follow 分支不动。这样 Step A 期间老项目打开不报错，且双端 chat-agent-meta 实际不会再产出 `source: 'project-custom'`（因为 resolve 永远返回 follow 链路的结果）。
- **Step 7 — phase-project-agent-remove/ui-hide — blocking: yes — qa: auto**：desktop IPC 兜底：`apps/desktop/src/main/ipc/handlers/projects.ts` 的 `getAgentConfig` 改为返回固定 `{ mode: "follow" }`，`updateAgentConfig` 改为 no-op（记录一条 warn 日志后返回成功）。保留 handler 注册，避免外部脚本调起 `projects.getAgentConfig` 时报「未知 IPC」。

### phase-project-agent-remove（Step B：core 清理）

- **Step 8 — phase-project-agent-remove/core-cleanup — blocking: yes — qa: auto**：core 类型与常量清理：
  - 删 `packages/core/src/domain/chat/model/project-agent-config.ts`、`project-agent-config.schema.ts`。
  - 删 `PROJECT_AGENT_META_DISPLAY_LABEL` 常量（grep 确认所有引用点，含 import 与 display label 映射表）。
  - 修所有 import 上述符号的文件，让 TS 编译通过。
- **Step 9 — phase-project-agent-remove/core-cleanup — blocking: yes — qa: auto**：`resolve-agent-for-project.ts` 最终简化。现状签名（现网真实）：`export async function resolveAgentForProject(runtime: ResolveAgentForProjectRuntimePort, projectId: string, sessionId: string)`（`resolve-agent-for-project.ts` L55-59），与早期 SPEC 描述的 `(chatProject, session, registry)` 不符——以现网为准。本期采用**方案 b（小改动）**：保留签名 `(runtime, projectId, sessionId)` 不变，仅删内部 custom 分支（L60-69）与对 `ProjectAgentConfig`/`chat_project.agent_config_json` 的读取，只剩 session 分支（L71-84）。`ResolvedAgentForProject` 的 `source: 'project-custom'` 分支同步删掉，只留 `session`。这样 `runtime.projects.getAgentConfig` 不再被调用，但 `ResolveAgentForProjectRuntimePort.projects` 字段保留（其它路径可能仍依赖 `ProjectService` 类型，删字段是方案 a、改动更大，本期不做）。调用点（共 6 处 apps + 1 处 core，签名不变无需改）：desktop `apps/desktop/src/main/ipc/handlers/prompt.ts` L60、`apps/desktop/src/main/services/session-prompt-input.service.ts` L36、`apps/desktop/src/main/services/prompt-preview.service.ts` L18；mobile `apps/mobile/src/services/chat-agent-meta.ts` L54、`apps/mobile/src/services/session-prompt-input.service.ts` L47、`apps/mobile/src/services/prompt-preview.service.ts` L19；core `packages/core/src/service/agent/logic/run-agent-turn.ts` L233。
- **Step 10 — phase-project-agent-remove/core-cleanup — blocking: yes — qa: auto**：双端 chat-agent-meta 清理：
  - desktop `apps/desktop/src/main/ipc/handlers/prompt.ts` L92-114：删 `source: 'project-custom'` 分支，`source` 取值不再含 project-custom。
  - mobile `apps/mobile/src/services/chat-agent-meta.ts` L96-104：同上。
  - 同步更新 chat-agent-meta 的类型定义（如果 `source` 是个字面量联合类型，去掉 `'project-custom'`）。
- **Step 11 — phase-project-agent-remove/core-cleanup — blocking: yes — qa: auto**：desktop IPC handler 删除：`apps/desktop/src/main/ipc/handlers/projects.ts` 删 `getAgentConfig`/`updateAgentConfig` handler 与对应 IPC 类型声明（ipc-types / shared types）。确认 renderer 侧无残留调用（Step 3 已删 `ProjectAgentConfigView`，应已无调用点）。
- **Step 12 — phase-project-agent-remove/core-cleanup — blocking: yes — qa: manual_user**：DB 迁移：把 `chat_project.agent_config_json` 列数据置空（`UPDATE chat_project SET agent_config_json = NULL`），或按风险章节决策的「保留列、标记废弃」策略执行。两端（mobile SQLite / desktop better-sqlite3）各自的迁移注册表里加这次迁移。**不**在本期 DROP COLUMN（留给下一迭代，降低老版本数据库回滚风险）。
- **Step 13 — phase-project-agent-remove/core-cleanup — blocking: no — qa: auto**：清理项目智能体相关的死测试与夹具：grep 测试目录里引用 `ProjectAgentConfig`、`editorMode="project"`、`ProjectAgentConfigScreen`、`getAgentConfig`、`updateAgentConfig`、`source: 'project-custom'` 的用例，删除或改写为 follow/none 语义。重点清单：
  - mobile `apps/mobile/__tests__/session-detail-screen.test.tsx` L262-278（`project-custom 时 agent 卡片显示锁图标` 用例）：这条用例 mock `meta({source: 'project-custom'})` 后断言 🔒 渲染 + 点击弹 toast，project-custom 消失后 source 取值不再含 project-custom、mock 会报类型错。改写为 `source: 'none'` 场景（none 也要锁、也渲染 🔒、也弹 toast，行为一致），断言不变；或直接删除（L298+ 的 `source='none'` 用例已覆盖 none 锁定行为，删掉这条不丢覆盖）。
  - desktop `SessionDetailDrawer` 相关测试里引用 `source: 'project-custom'` 的用例，同样改写为 none 或删除。
  - 其余引用上述符号的旧用例（resolve/chat-agent-meta/IPC 层），按 follow 语义改写或删。

## 测试策略

### 测试用例

> 用例 id `T-<模块缩写><序号>`，须映射到 Step。

- **T-EA1** — blocking: yes — 映射 Step 1：prepare 收敛——给定 3 条非 hidden user 消息序列、`runtime.extraInfo` 非空，`prepareUserMessagesForPrompt` 产出的提示词里只有第 3 条（最新）user 消息带 `<extra-info>`，第 1、2 条不带。
- **T-EA2** — blocking: yes — 映射 Step 1：prepare 收敛（空 extraInfo）——`runtime.extraInfo` 为空（undefined/全空白）时，所有 user 消息都不带 `<extra-info>`（与现状一致，确认收窄不破坏空省略）。
- **T-EA3** — blocking: yes — 映射 Step 2：双端预览口径——desktop/mobile `session-prompt-input.service` 产出的提示词，只有最新一条 user 消息带 `<extra-info>`，与 runner 真实提示词一致。两端测试断言从「所有 user 含」改为「只最新含」。
- **T-EA4** — blocking: no — 映射 Step 1：prepare 收敛（hidden 交互）——序列里含 hidden user 消息时，hidden 消息**原样进输出但不带 `<extra-info>`**（符合现状：`prepareOneUserMessage` 对 hidden 直接 `return message` 原样带过，T-HD1 契约）；「最新一条」判定排除 hidden，最新一条非 hidden user 输入命中 `<extra-info>`。
- **T-PA1** — blocking: yes — 映射 Step 6：resolve 短路——给定 `agent_config_json` 是 custom + 内联 definition，`resolveAgentForProject` 返回 follow 链路结果（走 session.agentId → registry），不返回内联 definition。
- **T-PA2** — blocking: yes — 映射 Step 5：双端锁定逻辑处理——desktop `SessionDetailDrawer` 与 mobile `SessionDetailScreen` 移除对 `source === 'project-custom'` 的专门依赖后，锁定判定（`agentLocked`/`modelLocked` 仍按 `source !== 'session'`）在 `source === 'none'` 场景仍生效（🔒 仍渲染、点击 agent/model 卡仍弹 toast，且 toast 文案不再指向已删的「项目智能体配置」/「项目设置」入口）；project-custom 场景随 Step 9/10 自然消失。现状澄清：双端确实都有 🔒 显式渲染（desktop `session-detail-pick__lock-icon` 带 🔒 + 「项目锁定」/「智能体锁定」文字，mobile chevron 换 🔒 + 整卡 `opacity: 0.6` + lockHint 渲染 toast 全文），第 1 轮 doc-fix 写的「无 🔒 显式渲染、原描述夸大」结论错误，本轮修正。
- **T-PA3** — blocking: yes — 映射 Step 3（desktop）/Step 4（mobile 防回归）：UI 入口消失——desktop `ChatRail` 右键菜单无「智能体配置」项；mobile grep 确认 `ProjectAgentConfig|editorMode|AgentEditorForm` 在 `apps/mobile/src/**` 下仍为零匹配（mobile 入口在历史迭代已重构掉，本期防回归占位）。
- **T-PA4** — blocking: yes — 映射 Step 7：IPC 兜底——`projects.getAgentConfig` 返回固定 follow，`projects.updateAgentConfig` no-op 不抛错。
- **T-PA5** — blocking: yes — 映射 Step 8/9/10/11：core 清理后无残留——grep 全仓（含测试）无 `ProjectAgentConfig`、`ProjectAgentMode`、`PROJECT_AGENT_META_DISPLAY_LABEL`、`source: 'project-custom'`、`getAgentConfig`、`updateAgentConfig` 的定义与引用；TS 编译通过。
- **T-PA6** — blocking: yes — 映射 Step 10：chat-agent-meta 收敛——双端 `source` 取值不含 project-custom，原 project-custom 用例改为 follow 语义后通过。
- **T-PA7** — blocking: no — 映射 Step 12：DB 迁移——迁移执行后 `chat_project.agent_config_json` 数据被置空；迁移前后项目可正常打开、走 session 级智能体；迁移幂等（重复执行不出错）。
- **T-PA8** — blocking: no — 映射 Step 13：死测试清理——项目智能体相关旧用例全部删除或改写，测试套件无残留引用、全绿。

### 验收矩阵

| 用例 | Step | blocking | qa |
|---|---|---|---|
| T-EA1 | 1 | yes | auto |
| T-EA2 | 1 | yes | auto |
| T-EA3 | 2 | yes | auto |
| T-EA4 | 1 | no | auto |
| T-PA1 | 6 | yes | auto |
| T-PA2 | 5 | yes | auto |
| T-PA3 | 3,4 | yes | manual_user |
| T-PA4 | 7 | yes | auto |
| T-PA5 | 8,9,10,11 | yes | auto |
| T-PA6 | 10 | yes | auto |
| T-PA7 | 12 | no | manual_user |
| T-PA8 | 13 | no | auto |

## 风险与回滚方案

- **DB 迁移策略（最大约束）**：仓库有两套 schema 设施——`schema-column-alignments.ts` 只做 `ADD COLUMN`；DROP COLUMN 走 `packages/core/src/bootstrap/schema-migrations/` 注册表，已有表重建先例（`drop-chat-session-user-vfs-pending-v1.ts` 用「建新表 → 拷贝 → DROP TABLE → RENAME」删除 `chat_session.user_vfs_pending_json` 列）。本期 Step 12 仍选「置空数据 + 保留列」策略（`UPDATE chat_project SET agent_config_json = NULL`），DROP COLUMN 留给下一迭代。理由不是「没有 DROP COLUMN 路径」，而是「表重建代价与收益不匹配」——项目智能体列在下一迭代删列时，表重建迁移能直接复用本期沉淀的置空状态，本期不必提前承担重建复杂度。这样老版本数据库回滚到本期之前的版本也不会因为「列不存在」报错。回滚：迁移本身是幂等 UPDATE，回滚无需反向操作（数据本来就不再使用）。
- **Step A 与 Step B 之间的中间态**：Step A 完成后，类型和 IPC handler 还在但已被短路/no-op。需保证此期间双端构建与运行都不出错（T-PA1/T-PA4 专门盯）。若 Step B 暂缓，系统行为对用户已正确，只是代码里留着死类型——可接受。
- **chat-agent-meta `source` 联合类型收窄**：如果 `source` 是字面量联合类型，去掉 `'project-custom'` 后，任何还在产出 project-custom 的路径会 TS 报错。Step 6 的 resolve 短路保证运行时不再产出，Step 10 才收窄类型——顺序不能反，否则 Step A 期间会编译失败。
- **mobile 路由删除的联动**（现状澄清）：mobile 端 `ProjectAgentConfig` 路由、`ProjectAgentConfigScreen`、`AgentEditorForm` 的 `editorMode="project"` 分支在历史迭代里已重构掉（grep `apps/mobile/src/**` 确认零匹配）。本期 Step 4 只做 grep 防回归占位，无实际删除动作。mobile 端唯一相关残留是 `apps/mobile/src/services/chat-agent-meta.ts` 的 `source: 'project-custom'` 分支，留到 Step 10 与 desktop 一同清理。
- **`resolveAgentForProject` 签名/调用面**（现状澄清）：现网签名是 `(runtime: ResolveAgentForProjectRuntimePort, projectId: string, sessionId: string)`（`resolve-agent-for-project.ts` L55-59），不是早期 SPEC 误记的 `(chatProject, session, registry)`。本期采用方案 b（保留签名、仅删 custom 分支），调用点签名不变、无需改动，共 6 处 apps + 1 处 core：desktop `prompt.ts` L60、`session-prompt-input.service.ts` L36、`prompt-preview.service.ts` L18；mobile `chat-agent-meta.ts` L54、`session-prompt-input.service.ts` L47、`prompt-preview.service.ts` L19；core `run-agent-turn.ts` L233。风险点在 `ResolvedAgentForProject` 类型收窄（删 `project-custom` 分支）后，调用方对 `resolved.source === 'project-custom'` 的判断会 TS 报错——需在 Step 9 同步删调用方分支（mobile `chat-agent-meta.ts` L96-104、desktop `prompt.ts` 对应分支），这些与 Step 10 的 chat-agent-meta 清理重叠，按顺序执行即可。若未来要彻底收窄（方案 a，删 `runtime.projects` 字段），需评估 `ProjectService` 类型的其它消费方。
- **extra info 收窄对历史会话的 token 计数**：注入是实时拼接、不持久化，历史会话重新出提示词会立刻按新规则产出。双端 `session-prompt-input.service` 的 token 计数走同一条 prepare，自动跟着收窄，但 T-EA3 会专门盯预览口径一致。
- **回滚**：两条 phase 互相独立。extra info 收窄回滚 = 还原 `prepare-user-messages-for-prompt.ts` 的透传判定（一行条件）；项目智能体回滚分两级——Step A 回滚 = 还原 UI 入口与 resolve 短路（用户重新看到项目智能体配置）；Step B 回滚 = 还原类型/IPC/迁移（数据已置空，但列还在，恢复 custom 配置需用户重填，可接受）。
