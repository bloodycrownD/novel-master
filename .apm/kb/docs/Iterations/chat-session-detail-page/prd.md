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

关于优先级，已确认为 `project > session > workspace`：项目级 custom 配置最硬（命中即截断，不往下看），其次是会话级绑定，最后回退到工作区全局。此外，项目启用 custom 智能体时 UI 禁用 agent 切换的现有行为须保持不变。

依赖说明：本需求在项目级 agent 配置（`project-agent-config`）与模型解析优先级链（`agent-model-decouple`）的基础上，把能力从项目级下沉到会话级。

## 目标（含成功指标）

**目标**

1. 提供一个 QQ 式聊天详情页，统一承载当前会话内散落的操作入口（重命名、切换模型、切换智能体、查看提示词、压缩上下文），降低入口发现成本。
2. 让模型/智能体切换支持单聊级绑定，会话之间互不串扰；无绑定时按既定优先级回退，不破坏现有行为。

**成功指标**

- 会话内原有散落入口（mobile 底部抽屉、desktop 浮动菜单 + 底部栏切换）被详情页统一入口取代，用户不再需要从多处找操作。
- 在同一项目下创建两个会话，分别绑定不同 agent / model，两者独立生效、互不影响。
- 项目 custom 启用时，详情页 agent 切换入口仍被禁用并给出引导提示，行为与现状一致。

## 用户与场景

- **目标用户**：多会话、多智能体并行的创作者。一个项目下会开多个聊天会话，不同会话想用不同 agent / model。
- **典型场景 1**：用户在 A 会话里用写作 agent，在 B 会话里用润色 agent，希望在详情页快速切换且互不影响。
- **典型场景 2**：用户进入某个会话，想改聊天名、看一眼当前用的 model、跳到提示词预览——现在得从抽屉/菜单分别点，详情页把这类「会话元信息 + 常用操作」收拢到一处。
- **典型场景 3**：项目启用了 custom 智能体，用户进详情页看到 agent 切换被禁用并提示去项目设置改——和现在体验一致，不会因为详情页存在而绕过项目级锁定。

## 范围

### 包含范围

- mobile 端新增聊天详情页（独立 Stack 路由），右上角新增入口按钮，承载原 `SessionActionsDrawer` 的全部能力。
- desktop 端新增聊天详情页（模态抽屉/弹窗呈现），由原会话操作入口改造触发，承载原浮动菜单 + 底部栏切换的能力。
- 移除原有散落入口：mobile 的 `SessionActionsDrawer`、desktop 的 `#session-actions-menu` 会话内操作菜单，替换为跳转详情页的单一入口。
- 单聊级 agent 绑定：会话可绑定 registry 中的 agent id（只存引用，不私存完整 agent 配置内容），解析时优先于 workspace 全局、次于 project custom。
- 单聊级 model 覆盖：会话可独立指定 model，优先级为 CLI flag → 绑定 agent 的 model pin → 会话级 model 覆盖 → workspace 当前模型。
- `project > session > workspace` 优先级链：项目 custom 命中时截断，不读会话级；项目 follow 时才考虑会话级绑定；会话无绑定时回退 workspace。
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

2. **详情页内容**：至少包含——聊天名（可编辑）、当前 agent 名称与来源（global / session-bind / project-custom / none）、当前 model 标签与来源、token 占用（desktop 现有能力的迁移）、操作入口（重命名、切换模型、切换智能体、查看提示词、压缩上下文）。

3. **单聊级 agent 绑定**：详情页内切换智能体时，写入会话级绑定（引用 registry agent id），不再写工作区全局指针。配置内容（prompt / tools / model pin）始终来自 registry 中该 agent 的 definition，会话只存引用——agent 在 registry 改了，所有绑定会话自动跟随。

4. **单聊级 model 覆盖**：详情页内切换模型时，写入会话级 model 覆盖。model 解析优先级为 `CLI flag → agent pin（definition.model）→ 会话级 model 覆盖 → workspace 当前模型`——agent 的专属 model pin 视为最高优先的「特有配置」，地位对齐 project custom agent；只有当前生效的 definition 不带 pin 时，会话级覆盖才生效。对应地，详情页遇到带 pin 的 agent 时，model 切换入口禁用（类似 project custom 禁 agent 切换）。

5. **优先级链 project > session > workspace**：项目 custom 命中即截断（不读会话级，agent 切换入口禁用）；项目 follow 时会话级绑定生效；会话无绑定时回退 workspace 全局行为，与现状一致。

6. **保持 project-custom 锁定行为**：详情页内 agent 切换入口在 project-custom 状态下被禁用，并给出与现状一致的引导（提示去项目设置修改）。model 切换在 agent 带 pin 时禁用，无 pin 时可用。

7. **移除原散落入口**：mobile 的 `SessionActionsDrawer`、desktop 的 `#session-actions-menu` 会话内操作菜单替换为「跳转详情页」单一入口，原抽屉/菜单不再保留为并行入口。

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

### 单聊级 agent 绑定

- **Given** 项目为 follow 模式，同一项目下有会话 A 和会话 B
- **When** 在会话 A 详情页绑定 agent X，在会话 B 详情页绑定 agent Y
- **Then** 会话 A 发起 run 时使用 agent X 的 definition，会话 B 使用 agent Y 的 definition，互不影响

- **Given** 会话 A 绑定了 agent X
- **When** agent X 在 registry 中修改了 prompt / tools / model pin
- **Then** 会话 A 下次 run 时自动使用更新后的 definition（会话只存引用，不私存配置内容）

- **Given** 会话 A 未绑定 agent，项目为 follow 模式
- **When** 发起 run
- **Then** 回退到 workspace 全局 currentAgentId，行为与现状一致

### 单聊级 model 覆盖

- **Given** 会话 A 绑定了 agent X（无 model pin），workspace 当前模型为 M1
- **When** 在会话 A 详情页切换 model 到 M2
- **Then** 会话 A 发起 run 时使用 M2，其他会话仍使用 M1

- **Given** 会话 A 绑定了 agent X（model pin 为 MX）
- **When** 在会话 A 详情页尝试切换 model
- **Then** model 切换入口被禁用（agent 带 pin，专属配置最高优先）；发起 run 时使用 MX（agent pin 压过 session override 与 workspace）

### 优先级链与锁定

- **Given** 项目为 custom 模式（内联了 agent definition）
- **When** 用户进入任意会话的详情页
- **Then** agent 切换入口被禁用，显示项目专属智能体标签，并给出「请在项目设置修改」的引导；model 切换入口仍可用

- **Given** 项目为 custom 模式
- **When** 发起 run
- **Then** 使用项目内联的 definition，不读会话级绑定（优先级 project > session）

- **Given** 项目为 follow 模式，会话绑定了 agent X
- **When** 发起 run
- **Then** 使用 agent X 的 definition（优先级 session > workspace）

### 入口收拢

- **Given** mobile 聊天页 / desktop 会话视图
- **When** 查找会话内操作入口
- **Then** 原 `SessionActionsDrawer`（mobile）/ `#session-actions-menu`（desktop）已被替换为跳转详情页的单一入口，原抽屉/菜单不再作为并行入口存在

- **Given** 会话列表项（mobile `ChatSessionListPanel` / desktop ChatRail sessions 视图）
- **When** 长按 / 右键某会话
- **Then** 「删除会话 / 复制会话」等列表级操作仍保留在原处，未移入详情页（维持现状）
