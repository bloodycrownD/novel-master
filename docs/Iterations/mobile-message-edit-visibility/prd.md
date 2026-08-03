# 移动端消息编辑与 hidden 状态 PRD

> **范围**：Mobile 会话聊天中的消息编辑、手动 hidden 及展示；复用 Core `MessageService` 能力。  
> **边界**：不含技术方案、接口、表结构、任务拆分（见后续 SPEC）。  
> **关联**：[message-visibility](../message-visibility/prd.md)（Core/CLI 侧 `hidden` 与 prompt 过滤已交付）；本 PRD 扩展 **Mobile UI 语义**（聊天列表仍展示 hidden 消息）。

## 背景

- **Core 已具备**：
  - `MessageService.updateContent(messageId, content)` — 替换消息内容（供编辑保存）。
  - `MessageService.hide` / `show` / `hideRange` / `showRange` — `chat_message.hidden` 字段。
  - Prompt / Agent 侧已过滤 `hidden=true` 的消息，不参与 LLM 上下文。
- **Mobile 现状**：
  - 长按菜单已有「编辑」入口，但仅当消息为**纯文本块**（无 `tool_use` 等）时可编辑；保存调用 `updateContent`。
  - **未提供** hidden 的手动操作；`buildChatListItems` 等将 `hidden` 消息**从聊天列表完全剔除**，与本次期望的「UI 仍可见、仅不进 prompt」不一致。
- 用户希望在手机上能**改 user/assistant 的纯文本消息**，并能**手动标记 hidden**（单条 + **多选批量**，交互参考批量删除），hidden 消息在列表中**灰显 +「已隐藏」标记**。
- **交互建议（产品定稿）**：参考 **微信 / QQ**，在消息气泡上**长按**弹出贴近消息的 **操作浮层**（tip / 小弹窗 / 横向动作条），集中提供删除、隐藏、编辑等项；避免与「整页底部大抽屉」的文件管理菜单混淆。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 文本消息可编辑 | user / assistant 均可编辑**纯文本内容**消息并保存 |
| 手动 hidden | 单条隐藏/取消隐藏；**多选批量** hide/show（交互对齐批量删除消息） |
| UI 与 LLM 语义分离 | hidden 消息**仍出现在聊天列表**（灰显 + 标签），**不进入**后续 prompt / Agent 上下文 |
| 复用 Core | Mobile 不重复实现存储逻辑，调用既有 `MessageService` |

**成功指标（可量化）**

- Mobile 自动化或手工用例 ≥ **8 条**（编辑 3 + hidden 单条 2 + 批量多选 2 + prompt 过滤 1）。
- 编辑保存后，同会话 `nm message list`（CLI）可见更新后 `content`（文本块）。
- 隐藏后，Mobile 会话日志 / prompt 预览类入口中**不包含**该条；聊天 UI **仍可见**且带 hidden 样式。

## 用户与场景

| 用户 | 场景 |
|------|------|
| 写作用户 | 纠正自己或助手回复中的错字、段落，无需删消息重发 |
| 调试 prompt | 临时 hide 早期寒暄或试错消息，观察后续 Agent 行为 |
| 长会话整理 | 多选多条消息后批量 hide，保留记录在 UI 中备查（灰显） |

## 范围

### 包含范围

1. **消息操作菜单（Mobile，微信/QQ 式）**
   - 在会话聊天时间线中，对**单条消息气泡**长按，弹出**锚定该消息附近**的操作浮层（非全屏底部 Action Sheet 为主交互；实现形态可为气泡旁横向菜单、小卡片弹层等，SPEC 定稿）。
   - 默认可选动作（按消息状态**动态显示**）：
     | 动作 | 说明 |
     |------|------|
     | **编辑** | 仅纯文本消息显示；进入编辑页/弹窗保存 |
     | **隐藏** / **取消隐藏** | 已 hidden 时显示「取消隐藏」，否则「隐藏」 |
     | **删除** | 二次确认后删除 |
   - 点击浮层外区域或选择动作后关闭；Agent 运行中是否禁用长按菜单 — SPEC 与现网批量删消息策略对齐。
   - **批量 hidden** 不进长按浮层；入口与会话 **「批量删除消息」** 并列（会话操作抽屉 / `SessionActionsDrawer`），见下节。

2. **消息编辑（Mobile）**
   - 从操作浮层选「编辑」→ 修改文本 → 保存（`updateContent`）。
   - 适用于 **user、assistant** 角色；内容须为可编辑的纯文本（与现 `editableTextFromMessage` 规则一致或略作产品文案优化）。
   - 含 `tool_use` / 复杂块的消息：保持「不支持编辑」提示，不强行开放。
   - 编辑后**不**自动删除后续消息、不自动重跑 Agent（仅改库内内容）。

3. **hidden 状态（Mobile）**
   - **单条**：操作浮层内「隐藏」/「取消隐藏」。
   - **批量（对齐批量删除消息）**：
     - 当前 UI **无「楼层 / seq 区间」概念**，**不提供**按序号起止输入的 hidden 表单。
     - 入口：会话抽屉增加 **「批量隐藏消息」**（及 **「批量取消隐藏」**，或 SPEC 合并为一次批量模式双按钮 — 定稿），交互复用现网批量删除链路：
       - `messageBatch.enter()` → 顶栏 `ManageHeader`（取消 | 已选 N 项 | 主操作按钮）→ `MessageList` 勾选 (`batchMode` + `BatchCheckbox`)。
     - 用户对**任意多条、非连续**消息勾选后确认；实现上对每条选中消息调用 `hide` / `show`（**不要求** `hideRange`；CLI 仍可用 seq 范围）。
     - Agent 运行中禁止进入批量模式（与批量删除一致）。
   - **列表展示**：**不再**因 `hidden` 从聊天列表移除；改为**灰显 +「已隐藏」**标签。
   - 会话日志、发消息时的 prompt 组装等「给模型看」的路径继续 **过滤 hidden**（与 Core 一致）。

4. **与 Core/CLI 一致**
   - `hidden` 字段语义不变；CLI 已支持的 hide/show 与 Mobile 操作同一数据源。
   - Fork / copy 保留 hidden 状态（既有行为，回归验证即可）。

### 不包含范围

- 含 **tool_use / tool_result** 消息的块级编辑或可视化编辑器。
- 编辑后**级联删除**后续消息、**自动重新生成** assistant 回复。
- 自动 compaction 算法、按关键词批量 hidden。
- hidden 的审计日志、撤销栈。
- Web 端（若尚无独立产品页）。
- Core 新增 `hidden` 字段或 Message 表结构变更（已存在则不做）。

## 核心需求

1. **长按操作浮层**：单条消息长按弹出微信/QQ 风格操作菜单（锚定消息、项少而清晰）；含编辑 / 隐藏 / 删除，按能力与状态显隐。
2. **编辑**：user/assistant 纯文本消息可在 Mobile 内编辑并持久化；空内容禁止保存并提示。
3. **hidden 单条**：可对任意消息切换 hidden；状态与 Core `chat_message.hidden` 同步。
4. **hidden 批量**：多选模式下 hide/show 选中消息；确认前展示条数；支持非连续选中。
5. **列表展示**：hidden 消息在聊天时间线可见、灰显、带「已隐藏」标识；非 hidden 样式不变。
6. **Prompt 隔离**：hidden 消息不出现在 Agent 运行、prompt 预览、会话日志（面向模型的视图）中。
7. **无下游副作用**：编辑保存不触发自动删消息、不自动启动 Agent。

## 验收标准

### 操作浮层（微信/QQ 式）

- **Given** 会话聊天页任意消息气泡，**When** 长按，**Then** 在消息附近出现操作浮层（非仅屏幕底部通栏菜单），且包含「删除」。
- **Given** 纯文本消息，**When** 打开操作浮层，**Then** 显示「编辑」；含 tool 的消息**不显示**「编辑」（或等同约束）。
- **Given** 未 hidden 的消息，**When** 打开操作浮层，**Then** 显示「隐藏」；已 hidden 则显示「取消隐藏」。
- **Given** 操作浮层已打开，**When** 点击空白处，**Then** 浮层关闭且未误触动作。

### 编辑

- **Given** 一条 assistant 纯文本消息，**When** 长按 → 编辑 → 修改正文 → 保存，**Then** 列表展示新内容，重启 App 后仍为 new content。
- **Given** 一条含 `tool_use` 的消息，**When** 长按打开浮层，**Then** 无「编辑」项；若通过其它入口触发则提示不支持，且不调用 `updateContent`。
- **Given** 编辑时输入空白，**When** 保存，**Then** 提示无法保存，库内内容不变。

### hidden 单条

- **Given** 可见消息 M，**When** 标记隐藏，**Then** M 在聊天列表仍出现且灰显/带「已隐藏」；Agent 下次运行 prompt 不含 M。
- **Given** 已隐藏消息 M，**When** 取消隐藏，**Then** M 恢复正常样式且重新进入 prompt。

### hidden 批量（对齐批量删除）

- **Given** 会话含多条消息，**When** 从会话抽屉进入「批量隐藏消息」并勾选 3 条（可不连续）→ 确认隐藏，**Then** 3 条均为 hidden、列表灰显，CLI 对应 `hidden=true`。
- **Given** 批量选择模式，**When** 未勾选任何消息点隐藏，**Then** 主操作禁用或提示，且无变更。
- **Given** Agent 正在运行，**When** 尝试进入批量隐藏，**Then** 与批量删除相同提示并拒绝进入。

### UI 与 Core 一致性

- **Given** Mobile 隐藏消息 M，**When** 在 CLI 对该会话 list，**Then** M 的 hidden 列为 true。
- **Given** 聊天列表含 hidden 消息，**When** 打开会话日志（或等价「发给模型的上下文」视图），**Then** 不包含 hidden 消息正文。

## 约束与依赖

- 依赖 `@novel-master/core` 的 `MessageService`（`updateContent`、`hide`/`show`/`hideRange`/`showRange`）。
- 依赖现有 `ChatMessage.hidden` 与 prompt 渲染过滤（message-visibility 迭代）。
- Mobile `runtime.messages` 须已暴露上述方法（若无则 SPEC 中补齐绑定，属实现细节）。

## 非功能需求（业务/体验）

- 长按反馈与微信/QQ 类似：短暂触感/视觉反馈后弹出浮层，项文案简短（编辑、隐藏、删除）。
- 浮层不遮挡整条会话输入区；靠近气泡，横排或竖排均可，SPEC 选型。
- 操作失败时 Toast 中文说明（网络/校验错误）。
- hidden 样式需深色/浅色主题下均可辨认（灰显 + 标签）。
- 批量 hide 前二次确认（文案含条数），交互节奏对齐批量删除。

## 风险与待确认项（SPEC 阶段）

| 项 | 说明 |
|----|------|
| 操作浮层组件形态 | 气泡旁 Popover / 自定义 Modal 定位 vs 复用 BottomSheetMenu — 需贴近消息锚点 |
| 批量 hidden 顶栏按钮 | 「隐藏」/「取消隐藏」分两个入口，或同一批量模式根据选中项智能切换 — SPEC 定稿 |
| 会话日志 / 多入口过滤 | 审计所有「给模型看」的 Mobile 路径是否统一过滤 hidden |
| 与现 `buildChatListItems` 行为变更 | 从「剔除」改为「展示+样式」可能影响性能与滚动高度 — SPEC 评估 |

## 里程碑（可选）

| 阶段 | 交付 |
|------|------|
| M1 | 长按操作浮层 + 列表展示 hidden + 单条 hide/show |
| M2 | 文本编辑（user/assistant）完善与回归 |
| M3 | 批量多选 hide/show + 测试与 CLI 交叉验证 |
