---
date: 2026-08-11
dependency: [Iterations/mobile-desktop-optimization-2026-08/prd.md]
---

# Feature B：智能体配置精简 PRD

## 背景

这个 feature 要收拾两件之前在智能体配置层面留下的、用起来别扭或用不上的东西，前序探索已经把现状摸清楚了。

第一件是 **extra info（`customAttach`）的注入范围**。这个开关在 `agent-config-extra-info-and-workplace-cleanup` 迭代里加进来，本意是让用户给智能体配一段常驻背景说明（比如「当前目录结构是……」「本次写作要遵守某某风格」），每次发消息时自动拼到提示词里。当时的设计是「对该智能体的每条用户消息都生效」，于是 `prepare-user-messages-for-prompt.ts` 的 `prepareOneUserMessage` 对每条非 hidden 的 user 消息都调了 `wrapUserMessageForLlm(..., runtime.extraInfo)`，把 `<extra-info>` 块实时拼进 content 文本。实际用下来发现：历史 user 消息里也塞着同一份 `<extra-info>`，既浪费 token，语义也不准——这段背景说明是「当下这条消息的补充」，历史消息早就发过了，再塞一遍没有意义。用户决定：**只在最新一条 user 消息上拼接**，历史消息一律不注入。

第二件是 **项目智能体功能整体下线**。项目智能体当初是为了让每个项目能挂一份内联的智能体定义（`mode: "custom"` 时直接写一份 `AgentDefinition`，`mode: "follow"` 时跟 session 级走），存在 `chat_project.agent_config_json` 列里。但这个能力用的人很少，反而让智能体选择链路变复杂（`resolveAgentForProject` 要分 custom/follow 两支，UI 上要有独立配置入口、右键菜单项、SessionDetailDrawer 的锁定逻辑、双端 chat-agent-meta 的 `source: 'project-custom'` 分支）。用户决定：**完全移除**，所有项目统一走 session 级智能体选择。

两件事没有技术依赖，但都落在「智能体配置」这个产品概念上，所以合在一个 feature 里推进。

## 目标（含成功指标）

- **extra info 注入收窄**：`customAttach` 对应的 `<extra-info>` 块只出现在本次请求里最新一条 user 消息上，历史 user 消息不再注入。
  - 成功指标：开启 `customAttach` 后发送一条新消息，提示词里只有最新那条 user 消息带 `<extra-info>`，其余历史 user 消息不带；关闭后任何消息都不带。
- **项目智能体彻底下线**：移除项目级内联智能体定义能力的全部入口、类型、IPC、UI、DB 列残留，所有项目统一走 session 级智能体选择，`resolveAgentForProject` 只剩 follow 一条路。
  - 成功指标：双端不再有任何项目智能体配置入口；曾经配过 custom 的旧项目打开后不报错、自动回落到 session 级智能体；DB 中 `chat_project.agent_config_json` 列不再被写入。

## 用户与场景

- **长会话重度创作者**：开了一段 `customAttach` 当背景说明，长聊下来发现历史消息里全是重复的 `<extra-info>`，token 在白烧，模型也容易被历史里的背景说明干扰。期望只有最新这条消息带补充说明，历史干净。
- **维护代码库的开发者**：项目智能体这条路没人用却占着一堆类型、UI、IPC、迁移分支，想让选择链路清爽下来。
- **曾经配过项目智能体的老用户**：项目打开后不期望报错或卡住，自动回落到 session 级智能体即可。

## 范围

### 包含范围

- **extra info 收窄**：只改 `prepare-user-messages-for-prompt.ts` 里 `prepareOneUserMessage` 的调用判定——遍历到最新一条 user 消息才传 `extraInfo`，其余传 `undefined`。domain 模型（`AgentPromptLayout.customAttach`）、wire schema、双端 UI、表单状态层一律不动（开关和内容仍按现状配置，只是注入范围变了）。
- **项目智能体移除**，覆盖六层：
  - core 域：删 `ProjectAgentConfig`/`ProjectAgentMode` 模型与 schema；简化 `resolveAgentForProject` 只走 session 分支。
  - DB：清理 `chat_project.agent_config_json` 列，处理已有 custom 数据（迁移策略见风险章节）。
  - desktop：删 `ProjectAgentConfigView`、`ChatRail` 右键菜单「智能体配置」项、`SessionDetailDrawer` 对 `source === 'project-custom'` 的专门依赖（🔒 渲染保留、锁定判定与 toast 按 `source !== 'session'` 保留，覆盖 none 场景；「项目锁定」文案与指向「项目设置」/「智能体配置」的 toast 改为 none 场景口径）、`projects.getAgentConfig`/`updateAgentConfig` IPC。
  - mobile：mobile 端项目智能体配置入口（`ProjectAgentConfigScreen`、`AgentEditorForm` 的 `editorMode="project"` 分支、`ProjectAgentConfig` 路由）在历史迭代里已重构掉，本期清理 `services/chat-agent-meta.ts` 里残留的 `source: 'project-custom'` 分支，并处理 `SessionDetailScreen.tsx` 的锁定 UI（🔒 渲染保留、注释与 `AGENT_LOCK_TOAST` 文案里对 project-custom/「项目智能体配置」的引用改为 none 场景口径）。
  - 双端 chat-agent-meta：删 `source: 'project-custom'` 分支。
  - 常量：删 `PROJECT_AGENT_META_DISPLAY_LABEL`。

### 不包含范围

- **`customAttach` 的开关/输入框 UI、wire schema、表单状态层**：这些在 `agent-config-extra-info-and-workplace-cleanup` 里已经实现，本次只改注入时机，不碰配置入口。
- **dynamic 区的 once 语义**：用户明确决策 extra info 走独立实现，不并入 dynamic 区的 once 语义。
- **session 级智能体选择链路**：本次只做「砍掉 project 分支」，session 级逻辑保持原样。
- **其它智能体配置项**（system/workplace/dynamic/会话区等）：不动。

## 核心需求

### 1. extra info 只对最新一条 user 消息拼接

`prepare-user-messages-for-prompt.ts` 在遍历 user 消息调 `prepareOneUserMessage` → `wrapUserMessageForLlm` 时，要判定「这条是不是本次请求里最后一条 user 消息」。是 → 透传 `runtime.extraInfo`；否 → 传 `undefined`。「最后一条 user」指本次传入 prepare 的有序序列里，最后一个满足 `role === 'user' && isUserInputMessage(message) && !message.hidden` 的消息（排除 tool_result 与 hidden user）。这个判定以「本次传入 prepare 的消息序列」为准，不依赖持久化字段（ChatMessage 本来就没有 ext 字段，注入仍是实时拼进 content 文本、不写回 `content_json`、不持久化）。domain 模型与 wire schema 不改。

> 与 dynamic 区 once 语义的关系：dynamic 区的 once 是「整段区域只注入一次」的块级语义，extra info 是「参数只对最新消息生效」的注入位语义，两者机制不同，本次按用户决策独立实现，不强行复用 dynamic 区的 once。

### 2. 移除项目智能体（分两步落地）

为了控制风险、让 UI 先快速回归到「用户看不到项目智能体」的状态，分两步：

- **Step 1（UI 层隐藏）**：去掉所有用户可触达的项目智能体入口，让 project 在逻辑上永远走 follow（即 session 级）。具体包括：desktop 删 `ChatRail` 右键「智能体配置」项与 `ProjectAgentConfigView`；双端锁定 UI 处理（desktop `SessionDetailDrawer.tsx` + mobile `SessionDetailScreen.tsx`）——移除对 `source === 'project-custom'` 的专门依赖，🔒 渲染保留、锁定判定仍按 `source !== 'session'` 保留（覆盖 none 场景），但「项目锁定」文案与指向已删入口的 toast 文案（如 mobile 「请到「项目智能体配置」修改」、desktop 「请在项目设置中修改」）改为 none 场景口径；mobile 端入口在历史迭代已重构掉，本期无 mobile 入口删除动作；`resolveAgentForProject` 在 Step 1 先把 custom 分支也短路到 follow（即使 DB 里还有 custom 数据也忽略），保证 UI 隐藏后老项目不报错。
- **Step 2（清理 domain/IPC/DB）**：彻底删类型与残留。简化 `resolveAgentForProject` 只剩 session 分支；删 `ProjectAgentConfig`/`ProjectAgentMode`/schema、双端 chat-agent-meta 的 `source: 'project-custom'` 分支、`PROJECT_AGENT_META_DISPLAY_LABEL`、`projects.getAgentConfig`/`updateAgentConfig` IPC；DB 做迁移把 `chat_project.agent_config_json` 列清掉（处理已有 custom 数据）。

## 验收标准

### extra info 注入收窄

- **Given** 一个开启 `customAttach`（内容为「当前目录结构为 xxx」）的智能体，
  **When** 用户在会话里已有 2 条历史 user 消息，再发第 3 条 user 消息触发本次请求，
  **Then** 本次产出的提示词里，只有第 3 条（最新）user 消息带 `<extra-info>` 块，第 1、2 条历史 user 消息不含 `<extra-info>`。
- **Given** 同上配置，
  **When** `customAttach` 开关关闭（内容为空）后发送消息，
  **Then** 本次产出的提示词里，所有 user 消息（含最新）都不含 `<extra-info>` 块。
- **Given** 会话里只有一条 user 消息（首条），
  **When** 触发请求且 `customAttach` 开启，
  **Then** 该条消息带 `<extra-info>` 块（首条即最新，正常注入）。
- **Given** `customAttach` 开启，
  **When** 连续多轮对话，每轮各自触发请求，
  **Then** 每轮请求里都只有「当前最新那条」带 `<extra-info>`，历史永远干净（不累积）。
- desktop 与 mobile 两端的 `session-prompt-input.service` 预览口径与真实提示词在 `<extra-info>` 注入范围上一致。

### 移除项目智能体（Step 1 完成后）

- **Given** desktop 端在项目列表对某项目点右键，
  **Then** 右键菜单不再出现「智能体配置」项。
- **Given** mobile 端项目相关界面，
  **Then** mobile 端项目智能体配置入口（`ProjectAgentConfigScreen`、`AgentEditorForm` 的 `editorMode="project"` 分支、`ProjectAgentConfig` 路由）在历史迭代已重构掉，本期 grep 确认 `apps/mobile/src/**` 仍为零匹配（防回归）。
- **Given** 一个 `chat_project.agent_config_json` 里还存着 custom 配置的旧项目（DB 未清理），
  **When** 用户打开该项目并发起对话，
  **Then** 不报错，智能体走 session 级（follow）选择。
- **Given** desktop `SessionDetailDrawer` 与 mobile `SessionDetailScreen` 的锁定 UI，
  **Then** 移除对 `source === 'project-custom'` 的专门依赖后，锁定判定（`agentLocked`/`modelLocked` 按 `source !== 'session'`）与 🔒 渲染、点击 toast 在 `source === 'none'` 场景仍生效（none 也要锁）；toast 文案不再引导用户去已删除的「项目智能体配置」/「项目设置」入口；project-custom 场景随 Step 2 自然消失。现状澄清：双端都有 🔒 显式渲染（desktop `session-detail-pick__lock-icon` + 「项目锁定」文字，mobile chevron 换 🔒 + 整卡降透明度 + lockHint 全文）。

### 移除项目智能体（Step 2 完成后）

- **Given** core 源码，
  **Then** grep 不到 `ProjectAgentConfig`、`ProjectAgentMode`、`PROJECT_AGENT_META_DISPLAY_LABEL`、`source: 'project-custom'`、`projects.getAgentConfig`、`projects.updateAgentConfig` 的定义与引用。
- **Given** `resolveAgentForProject`，
  **Then** 只剩 session 分支（follow），不再读 `chat_project.agent_config_json`。
- **Given** 一个历史上配过 custom 的项目（DB 迁移前），
  **When** 迁移执行后，
  **Then** `chat_project.agent_config_json` 列被清理（列删除或数据置空，视迁移策略），项目可正常打开、走 session 级智能体。
- **Given** desktop/mobile chat-agent-meta 链路，
  **Then** 不再有 `source: 'project-custom'` 分支，`source` 取值不再含 project-custom。
- 双端现有自动化测试无回归；针对项目智能体移除的回归测试（如有旧用例引用了上述符号）同步更新或删除。

## 风险与待确认项

- **DB 迁移策略待定**：`chat_project.agent_config_json` 列是直接 DROP COLUMN，还是保留列但置空数据、等后续迭代再删？仓库有两套 schema 设施：`schema-column-alignments.ts` 只做 `ADD COLUMN`；DROP COLUMN 走 `schema-migrations/` 注册表，已有表重建先例（`drop-chat-session-user-vfs-pending-v1.ts`）。所以 DROP COLUMN 并非「没有路径」，而是「表重建代价与收益不匹配」。Step 2 实现时拍板，倾向「置空数据 + 保留列、下一迭代再 DROP」——理由是表重建迁移在下一迭代删列时能直接复用本期沉淀的置空状态，本期不必提前承担重建复杂度，同时降低老版本数据库回滚风险。
- **历史 custom 项目的回落体验**：Step 1 短路 custom→follow 后，老用户打开曾经配过 custom 的项目会发现「项目智能体配置没了」，需要确认这是可接受的（探索阶段用户已确认完全移除，应无异议，但发版说明里要点一句）。
- **extra info 收窄对历史会话的影响**：注入是实时拼接、不持久化，所以历史会话重新出提示词时会立刻按新规则（只最新一条注入）产出，老的 `attachments_json`/`content_json` 不受影响。需确认 token 计数/预览口径同步更新（双端 `session-prompt-input.service` 走的是同一条 prepare，理论上自动一致，但 T-EA3 会专门盯）。
- **Step 1 与 Step 2 之间不留中间态暴露**：Step 1 把 custom 短路到 follow，但类型和 IPC 还在；需保证短路期间不会出现「UI 已删但 IPC 还能被外部脚本调起」的奇怪状态（desktop IPC 注册表里 `getAgentConfig`/`updateAgentConfig` 在 Step 1 可保留但返回空/固定 follow，Step 2 再删 handler）。
