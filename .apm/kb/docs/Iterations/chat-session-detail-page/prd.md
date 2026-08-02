---
date: 2026-08-02
dependency:
  - Iterations/project-agent-config/prd.md
  - Iterations/agent-model-decouple/prd.md
---

# 聊天会话详情页 PRD

## 背景

当前产品中，单个聊天会话的操作入口分散在多处：mobile 端是输入框旁的「更多」按钮触发的底部抽屉（`SessionActionsDrawer`，含聊天重命名 / 查看提示词 / 压缩上下文 / 切换大模型 / 切换智能体五项），desktop 端是浮动会话操作菜单（`#session-actions-menu`，含重命名 / 压缩 / 切换模型 / 切换智能体）加底部 `WorkspaceFooter`（agent/model 切换 + token 占用）。用户想把这些散点收拢成一个类似 QQ 详情页的统一入口。

同时，当前「切换模型 / 切换智能体」是**工作区/项目级**全局生效的——所有会话共享同一份配置。用户希望把模型/智能体的作用域下沉到**单聊（session）级别**：每个会话可以独立绑定一个 agent（引用 registry 里的 agent id，不私存完整配置内容），并独立覆盖 model，互不影响。

关于优先级，本迭代已改为**两级链**（移除 workspace 回退层）：agent 解析链为 `project custom 截断 > session.agentId`，model 解析链为 `agent pin（definition.model）> session.modelId`。每个会话始终独立持有 agentId（必填）+ modelId（可选），创建时从 workspace 当前值复制一份作为默认配置，之后不再 follow / 回退 workspace。项目 custom 命中即截断（不读 session.agentId）；agent 带 model pin 即截断（不读 session.modelId）。此外，项目启用 custom 智能体时 UI 禁用 agent 切换的现有行为须保持不变。

依赖说明：本需求在项目级 agent 配置（`project-agent-config`）与模型解析优先级链（`agent-model-decouple`）的基础上，把能力从项目级下沉到会话级。

## 目标（含成功指标）

**目标**

1. 提供一个 QQ 式聊天详情页，承载会话元信息与高频切换（聊天名 inline 编辑、agent / model 卡片切换），降低入口发现成本；次要操作（查看提示词 / 压缩上下文）继续由 mobile 的 `SessionActionsDrawer` 承载，不迁入详情页。
2. 让模型/智能体切换支持单聊级配置，每个会话始终独立持有 agent/model 配置（创建时复制 workspace 当前值作为默认），会话之间互不串扰、不再回退 workspace。

**成功指标**

- mobile 三线按钮跳详情页、⋯ 按钮仍弹 `SessionActionsDrawer`（保留），desktop 浮动菜单 `#session-actions-menu` 改造为详情抽屉，入口架构清晰、不再散乱。
- 在同一项目下创建两个会话，分别绑定不同 agent / model，两者独立生效、互不影响。
- 项目 custom 启用时，详情页 agent 切换入口仍被禁用并给出引导提示，行为与现状一致。

## 用户与场景

- **目标用户**：多会话、多智能体并行的创作者。一个项目下会开多个聊天会话，不同会话想用不同 agent / model。
- **典型场景 1**：用户在 A 会话里用写作 agent，在 B 会话里用润色 agent，希望在详情页快速切换且互不影响。
- **典型场景 2**：用户进入某个会话，想改聊天名、看一眼当前用的 model、跳到提示词预览——现在得从抽屉/菜单分别点，详情页把这类「会话元信息 + 常用操作」收拢到一处。
- **典型场景 3**：项目启用了 custom 智能体，用户进详情页看到 agent 切换被禁用并提示去项目设置改——和现在体验一致，不会因为详情页存在而绕过项目级锁定。

## 范围

### 包含范围

- mobile 端新增聊天详情页（独立 Stack 路由，三线按钮触发），承载聊天名 inline 编辑 + agent / model 卡片切换；原 `SessionActionsDrawer` 由 ⋯ 按钮触发保留，继续承载重命名 / 查看提示词 / 压缩上下文 / 切换大模型 / 切换智能体五项，详情页不重复。
- desktop 端新增聊天详情页（模态抽屉/弹窗呈现），由原会话操作入口改造触发，承载原浮动菜单 + 底部栏切换的能力。
- 入口架构调整：mobile 的三线按钮（AppHeader 的 MenuIcon）跳详情页，⋯ 按钮（ChatComposer.onOpenMore）仍弹 `SessionActionsDrawer`（保留，承载重命名 / 查看提示词 / 压缩上下文 / 切换大模型 / 切换智能体五项）；desktop 的 `#session-actions-menu` 会话操作菜单改造为打开详情抽屉（SessionDetailDrawer）。
- 单聊级 agent 配置：每个会话独立持有 agentId（引用 registry 中的 agent id，只存引用不私存完整 agent 配置内容），解析链为 `project custom 截断 > session.agentId`；session 始终有 agentId，无 follow / workspace 回退。
- 单聊级 model 配置：会话可独立指定 modelId（可选），解析链为 `agent pin（definition.model）> session.modelId`；去掉 CLI flag 与 workspace 回退层。
- 两级解析链：project custom 命中即截断（不读 session.agentId），否则用 session.agentId；model 同理，agent 带 pin 则截断（不读 session.modelId），否则用 session.modelId。无 workspace 回退层。workspace 全局仅作为「新建会话时复制的默认值来源」保留，不参与 session 运行时解析。
- 保持 project-custom 启用时禁用 agent 切换的现有行为（mobile `ChatMetaBar` 的锁定样式、desktop `WorkspaceFooter` 的 toast 引导），详情页延续同一套判定。

### 不包含范围

- 消息搜索 / 检索能力（两端现状均无，不在本期）。
- 会话或消息导出功能（现状无，不在本期）。
- 会话列表项的「最后一条消息预览 / 未读 / 时间增强」等 QQ 风格列表信息（不在本期）。
- desktop 端消息分页加载（现状是一次性全量拉，不在本期补齐）。
- 会话列表项右键/长按菜单里的「删除会话 / 复制会话」等操作不收拢进详情页（维持现状，详情页只收拢会话内操作）。
- CLI 端的单聊级绑定（CLI 是一次性 run，不持久化会话级配置）。
- MCP 配置链路（当前 core 无 MCP 支持）。

## 核心需求

1. **统一详情页入口**：mobile 在聊天页顶部（`ChatMetaBar` 一行）右侧新增详情按钮，点击 `navigation.navigate` 到独立 Stack 路由的详情页；desktop 用模态抽屉呈现，由原会话操作菜单按钮改造触发。两端详情页统一承载原散落入口的能力。

2. **详情页内容**：聊天名点击直接 inline 编辑（失焦 / 回车保存，不弹 modal）；当前智能体、当前大模型各是一张可点击卡片，点击直接弹 picker 切换；卡片展示来源标签，agent 来源收窄为 `project-custom / session / none`，model 来源同理收窄（去掉 `global` / `session-bind`）。token 占用（desktop 现有能力的迁移）保留。不再有 DetailAction 一行行的菜单列表——次要操作（查看提示词 / 压缩上下文）在 mobile 由 ⋯ 按钮的 `SessionActionsDrawer` 承载、详情页不重复，在 desktop 抽屉里弱化为底部文字链接。

3. **单聊级 agent 配置**：详情页内切换智能体时，写入 session.agentId（引用 registry agent id）。project custom 截断时不可改（引导去项目设置）；否则 session 独立持有 agentId，用户可随时切换。配置内容（prompt / tools / model pin）始终来自 registry 中该 agent 的 definition，会话只存引用——agent 在 registry 改了，所有引用该 agent 的会话自动跟随。

4. **单聊级 model 配置**：详情页内切换模型时，写入 session.modelId（可选）。model 解析链为 `agent pin（definition.model）> session.modelId`——agent 的专属 model pin 视为最高优先的「特有配置」，地位对齐 project custom agent；当前生效的 definition 带 pin 时截断（不读 session.modelId），model 切换入口禁用；definition 不带 pin 时用 session.modelId。

5. **两级解析链**：agent 链为 `project custom 截断 > session.agentId`——项目 custom 命中即截断（不读 session.agentId，agent 切换入口禁用），否则用 session.agentId；model 链为 `agent pin > session.modelId`——agent 带 pin 截断，否则用 session.modelId。session 始终独立持有 agentId（必填）+ modelId（可选），无 follow / workspace 回退层。

6. **保持 project-custom 锁定行为**：详情页内 agent 切换入口在 project-custom 状态下被禁用，并给出与现状一致的引导（提示去项目设置修改）。model 切换在 agent 带 pin 时禁用，无 pin 时可用。

7. **入口架构调整**：mobile 三线按钮（AppHeader 的 MenuIcon）跳详情页，⋯ 按钮（ChatComposer.onOpenMore）仍弹 `SessionActionsDrawer`（保留，承载重命名 / 查看提示词 / 压缩上下文 / 切换大模型 / 切换智能体五项，详情页不重复这些次要操作）；desktop 的 `#session-actions-menu` 会话操作菜单替换为详情抽屉（SessionDetailDrawer）。

## 验收标准

### 详情页入口与呈现

- **Given** 用户在某个聊天会话内
- **When** 点击 mobile 顶部右侧详情按钮 / desktop 的会话操作入口
- **Then** 进入聊天详情页（mobile 为独立 Stack 路由转场，desktop 为模态抽屉），详情页展示当前会话的聊天名、agent 名称与来源、model 标签

- **Given** 用户在 mobile 详情页
- **When** 按下 Android 物理返回键 / 点击导航返回
- **Then** 返回到原聊天会话视图，会话状态不丢失

### 详情页操作

- **Given** 详情页打开
- **When** 编辑聊天名并保存
- **Then** 会话标题更新，会话列表同步刷新

- **Given** 详情页打开
- **When** 点击「查看提示词」/「压缩上下文」
- **Then** 跳转到现有对应功能（mobile 跳 RealPrompt 页 / 触发压缩流程），行为与现状一致

### 单聊级 agent 配置

- **Given** 项目为非 custom 模式（即 session 可切换 agent），同一项目下有会话 A 和会话 B
- **When** 在会话 A 详情页绑定 agent X，在会话 B 详情页绑定 agent Y
- **Then** 会话 A 发起 run 时使用 agent X 的 definition，会话 B 使用 agent Y 的 definition，互不影响

- **Given** 会话 A 绑定了 agent X
- **When** agent X 在 registry 中修改了 prompt / tools / model pin
- **Then** 会话 A 下次 run 时自动使用更新后的 definition（会话只存引用，不私存配置内容）

- **Given** 会话 A 创建时即持有 agentId（复制 workspace 当前值）
- **When** 用户在详情页切换为其他 agent
- **Then** session.agentId 更新，发起 run 时使用新 agent 的 definition；会话始终独立持有 agentId，不存在「未绑定回退 workspace」的路径

### 单聊级 model 配置

- **Given** 会话 A 创建时持有 modelId（假设为 M1），绑定 agent X（无 model pin）
- **When** 在会话 A 详情页切换 model 到 M2
- **Then** 会话 A 发起 run 时使用 M2；其他会话各自持有自己的 modelId，互不影响（无 workspace 回退）

- **Given** 会话 A 绑定了 agent X（model pin 为 MX）
- **When** 在会话 A 详情页尝试切换 model
- **Then** model 切换入口被禁用（agent 带 pin，专属配置截断）；发起 run 时使用 MX（agent pin 压过 session.modelId）

### 解析链与锁定

- **Given** 项目为 custom 模式（内联了 agent definition）
- **When** 用户进入任意会话的详情页
- **Then** agent 切换入口被禁用，显示项目专属智能体标签，并给出「请在项目设置修改」的引导；model 切换入口仍可用

- **Given** 项目为 custom 模式
- **When** 发起 run
- **Then** 使用项目内联的 definition，不读 session.agentId（project custom 截断）

- **Given** 项目为非 custom 模式，session.agentId 指向 agent X
- **When** 发起 run
- **Then** 使用 agent X 的 definition（解析链 `project custom 截断 > session.agentId`，无 workspace 回退）

### 入口收拢

- **Given** mobile 聊天页 / desktop 会话视图
- **When** 查找会话内操作入口
- **Then** mobile 三线按钮跳详情页、⋯ 按钮仍弹 `SessionActionsDrawer`（保留）；desktop 的 `#session-actions-menu` 替换为详情抽屉（SessionDetailDrawer），原 desktop 浮动菜单不再作为并行入口存在

- **Given** 会话列表项（mobile `ChatSessionListPanel` / desktop ChatRail sessions 视图）
- **When** 长按 / 右键某会话
- **Then** 「删除会话 / 复制会话」等列表级操作仍保留在原处，未移入详情页（维持现状）
