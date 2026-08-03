---
date: 2026-06-22
dependency:
  - Iterations/desktop-app/prd.md
  - Iterations/worktree-vfs-ui-refresh-fix/prd.md
  - Iterations/desktop-ui-polish/prd.md
---

# Desktop UX Bug 修复批次 PRD

## 背景

Novel Master Desktop（`apps/desktop`）已完成三栏主壳（Preview | Explorer | ChatRail）与核心对话、VFS、Agent 能力闭环。首轮及后续手工验收（含 macOS）暴露一批 **交互缺陷、渲染缺口、状态残留与文案不一致** 问题，影响中文输入、文件工作流与错误可观测性。

与现状及前置 PRD 的关系：

| 领域 | 现状 / 前置口径 | 本批次变更 |
|------|-----------------|------------|
| 工作区刷新 | `worktree-vfs-ui-refresh-fix` 将 Agent 写盘后 **不自动刷新** 定为设计行为；Mobile 面板切换时重载 | **仅 Desktop**：write/edit（含 Agent 工具与用户侧保存）完成后 **实时刷新** Explorer；Mobile **保持不变** |
| 面包屑 | `desktop-ui-polish` 将工作区 breadcrumb 标为 **不包含** | 本批次在 **PreviewPane** 增加可点击路径面包屑 |
| 聊天 Composer | Enter 直接发送，无 IME composing 守卫；CSS 有 max-height 但无 JS 自适应 | 全局输入规范 + IME 守卫 + 200px 上限自适应 |
| Markdown | 聊天 `MessageList` 已用 `remark-gfm`；**PreviewPane** 预览未启用 GFM，表格无法渲染 | Preview 侧补齐表格渲染 |
| 会话切换 | `openSession` 不清空 `previewFile`，预览/编辑可残留上一会话 | 切换会话时清空预览与编辑状态 |
| 错误展示 | 同步 IPC 失败有 Composer 内联错误；流式 `agent.run.failed` **仅 Toast** | 统一 Composer 上方内联展示 |
| 工作区点击 | 代码意图为文件单击打开；**macOS 实测单击文件无反应** | 修复为文件 **单击** 打开预览/编辑 |
| 文案与菜单 | Desktop「回滚到此」「压缩聊天」；会话「更多」缺「聊天重命名」 | 对齐 Mobile 口径并补入口 |

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 中文输入与快捷键可用 | Desktop 全部文本输入框在拼音 IME composing 期间 Enter **不触发** 发送/提交；多行输入 Enter 换行、Ctrl+Enter 发送/提交 |
| Markdown 表格可读 | PreviewPane 与聊天消息中的 GFM 表格均可正确渲染 |
| Desktop 工作区实时一致 | Agent 工具 write/edit 及用户 Preview 保存完成后 **3s 内** Explorer 列表反映变更；Mobile 行为无回归 |
| 会话隔离 | 切换会话后 PreviewPane **不展示** 上一会话文件路径或内容 |
| 失败可诊断 | 聊天请求失败（同步/流式）均在 Composer 上方展示 **可读失败原因** |
| 桌面文件交互符合预期 | macOS / Windows 文件行 **单击** 打开；目录行单击展开/折叠 |
| 文案与菜单对齐 | 「回滚」「压缩上下文」；「更多」含「聊天重命名」 |
| 编辑器路径可定位 | PreviewPane 顶部面包屑展示并可点击跳转路径段 |
| Composer 自适应 | 输入区随内容增高，至 **200px** 后停止增高并内部滚动 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 中文创作者 | 使用拼音输入法在聊天 Composer 或设置多行文本框中输入，按 Enter 选词而非误发送 |
| 写作者 | 在 Preview 打开含表格的 `.md` 文件，或阅读 Agent 回复中的表格 |
| 调试者 | Agent write/edit 后无需手动点刷新或 pointer-down，Explorer 即显示新文件/变更 |
| 多会话用户 | 在 ChatRail 切换会话后，左侧不再残留上一会话打开的文件 |
| 配置/运行用户 | 模型未配置、网络错误或 Agent 运行失败时，在输入框上方看到具体原因 |
| macOS 用户 | 工作区文件列表单击即可打开，无需依赖右键或其他入口 |
| 日常操作者 | 通过 Composer「更多」重命名会话、压缩上下文，消息菜单使用简洁「回滚」文案 |

## 范围

### 包含范围

1. **Bug 1 — 输入法与全局 Enter 规范**：Desktop **全部**文本输入框统一——**单行** Enter 提交/确认；**多行** Enter 换行、Ctrl+Enter 发送/提交；composing 状态下忽略 Enter 触发的发送/提交。
2. **Bug 2 — Markdown 表格**：PreviewPane（及必要的 Desktop Markdown 渲染路径）支持 GFM table 语法渲染；确认聊天消息列表表格正常。
3. **Bug 3 — Desktop 工作区实时刷新**：Agent 工具 write/edit 完成、用户 PreviewPane 保存完成后，自动触发 Explorer 工作区树重载；**不修改 Mobile** lazy / 面板切换策略。
4. **Bug 4 — 切换会话清空预览**：切换至另一会话时清空 `previewFile` 及 PreviewPane 编辑/预览状态。
5. **Bug 5 — 聊天失败内联展示**：同步 IPC 失败与流式 `agent.run.failed` 均在 Composer **上方内联**展示失败原因（不仅 Toast）。
6. **Bug 6 — 工作区单击打开文件**：修复 macOS（及必要时其他平台）文件行单击无响应；文件 **单击** 打开 PreviewPane；目录 **单击** 展开/折叠（非 VS Code 双击模式）。
7. **Bug 7 — 回滚文案**：消息上下文菜单及相关确认文案中「回滚到此」改为「**回滚**」（与 Mobile 一致）。
8. **Bug 8 — 更多选项菜单**：Composer「更多」新增「**聊天重命名**」；「压缩聊天」及关联弹窗标题改为「**压缩上下文**」。
9. **Bug 9 — Preview 面包屑**：PreviewPane 顶部显示当前打开文件的 **路径层级面包屑**，支持点击路径段跳转；Explorer 保持现有平铺展开树，**不**在本批次改造 Explorer 导航。
10. **Bug 10 — Composer 自适应高度**：聊天输入框随内容增高，`max-height: 200px`，超出后内部滚动。

### 不包含范围

- Mobile 端上述行为的变更（Bug 3 刷新策略等保持现网）
- Explorer 顶部面包屑或目录 drill-down 导航（另开迭代）
- VS Code 式「单击预览 / 双击固定」双模式
- Core 域模型、IPC 契约变更（除非实现刷新/错误展示所必需的最小扩展）
- 第三方 UI 组件库引入
- Linux 专项适配（随 Desktop 通用修复顺带验证即可，非本批次目标平台）

## 核心需求

1. **IME 安全输入**：所有 Desktop 文本输入在 `compositionstart`～`compositionend` 期间，Enter 不得触发发送、提交或单行确认。
2. **统一快捷键**：多行输入框 Enter = 换行，Ctrl+Enter = 发送/提交；单行输入框 Enter = 确认/提交（与现网表单习惯一致）。
3. **GFM 表格渲染**：PreviewPane Markdown 预览与聊天消息渲染均正确显示 pipe table。
4. **Desktop 实时工作区**：write/edit（Agent 工具 + 用户保存）成功后 Explorer 自动 `refreshWorkspaceTrees` 或等价重载；Mobile 不改动。
5. **会话级 Preview 隔离**：`openSession` / 等价切换路径必须清空预览文件与编辑态。
6. **失败原因可见**：聊天 run 失败（同步返回错误 + 流式 failed 事件）均在 Composer 上方展示 `formatUserError` 或等价可读文案。
7. **文件单击可达**：修复 macOS 文件行单击无响应，确保单击打开 Preview。
8. **文案与菜单对齐 Mobile**：「回滚」「压缩上下文」；「更多」含「聊天重命名」（行为与 ChatRail 会话列表重命名等价）。
9. **Preview 路径面包屑**：当前文件路径分段展示，点击段落在 Explorer/Preview 语境下跳转到对应层级或文件。
10. **Composer 高度自适应**：最小高度保持可用默认值，增长至 200px 封顶并滚动。

## 验收标准

### Bug 1 — 输入法与 Enter

- **Given** macOS / Windows 开启中文拼音输入法，焦点在聊天 Composer  
  **When** 输入拼音尚未选词（composing）并按 Enter  
  **Then** **不** 发送消息，输入法正常选词/上屏。

- **Given** 聊天 Composer 已输入多行文本  
  **When** 按 Enter（非 composing）  
  **Then** 插入换行；按 Ctrl+Enter 发送消息。

- **Given** 设置页某 **单行** 输入框（如名称字段）  
  **When** 按 Enter  
  **Then** 执行提交/确认（与字段现网语义一致），**不** 要求 Ctrl+Enter。

- **Given** 设置页某 **多行** TextArea  
  **When** 按 Enter / Ctrl+Enter  
  **Then** 行为与 Composer 规范一致（Enter 换行，Ctrl+Enter 提交）。

### Bug 2 — Markdown 表格

- **Given** PreviewPane 打开含 GFM 表格的 `.md` 文件  
  **When** 只读预览  
  **Then** 表格以行列边框/对齐方式正确渲染，非纯文本 pipe 字符。

- **Given** 聊天消息含 Markdown 表格  
  **When** 消息列表渲染  
  **Then** 表格正常显示。

### Bug 3 — Desktop 实时刷新

- **Given** Desktop 会话，Explorer 展示聊天工作区  
  **When** Agent 工具完成 write 或 edit  
  **Then** **无需** 手动刷新或 pointer-down，3s 内 Explorer 出现新文件或更新后的条目。

- **Given** Desktop PreviewPane 编辑文件并保存成功  
  **When** 保存完成  
  **Then** Explorer 列表与 Preview 内容一致。

- **Given** Mobile 同场景 Agent write  
  **When** 不切换面板  
  **Then** 行为与现网 `worktree-vfs-ui-refresh-fix` 一致（**无** Desktop 式即时刷新回归）。

### Bug 4 — 切换会话

- **Given** 会话 A 已在 PreviewPane 打开某文件  
  **When** 在 ChatRail 切换到会话 B  
  **Then** PreviewPane 为空或默认占位，**不** 显示会话 A 的文件名或内容。

### Bug 5 — 失败原因

- **Given** 未配置模型或 Agent run 同步返回错误  
  **When** 用户尝试发送  
  **Then** Composer **上方** 显示具体失败原因。

- **Given** 流式运行中触发 `agent.run.failed`  
  **When** 失败发生  
  **Then** Composer **上方** 显示错误文案（不仅 Toast；Toast 可保留为辅助）。

### Bug 6 — 单击打开

- **Given** macOS Desktop 聊天工作区有文件 `foo.md`  
  **When** **单击** 文件行（非右键）  
  **Then** PreviewPane 打开 `foo.md`。

- **Given** 目录行 `notes/`  
  **When** 单击  
  **Then** 展开或折叠，**不** 打开 Preview。

### Bug 7 — 回滚文案

- **Given** 消息上下文菜单  
  **When** 查看回滚项  
  **Then** 文案为「**回滚**」，无「回滚到此」。

### Bug 8 — 更多菜单

- **Given** 会话对话页 Composer「更多」菜单  
  **When** 展开菜单  
  **Then** 含「**聊天重命名**」；原「压缩聊天」显示为「**压缩上下文**」，弹窗标题一致。

- **Given** 点击「聊天重命名」  
  **When** 输入新名称并确认  
  **Then** 当前会话名称更新，与 ChatRail 列表重命名效果一致。

### Bug 9 — Preview 面包屑

- **Given** PreviewPane 打开 `/notes/ch1.md`  
  **When** 查看 Preview 顶部  
  **Then** 显示路径分段面包屑（如 `notes` > `ch1.md` 或等价层级）。

- **Given** 面包屑某路径段可点击  
  **When** 用户点击  
  **Then** 导航至对应目录上下文或打开该段路径（Explorer 树定位/展开或 Preview 切换，行为可感知且一致）。

### Bug 10 — Composer 高度

- **Given** 聊天 Composer 空内容  
  **When** 输入一行  
  **Then** 高度随内容增加。

- **Given** 连续输入超过 200px 可视高度  
  **When** 继续输入  
  **Then** 高度 **不超过** 200px，输入区 **内部滚动**，发送按钮仍可见可用。

## 约束与依赖

- 依赖 `desktop-app` 三栏壳与 IPC 体系；`worktree-vfs-ui-refresh-fix` 的消费方①实时 API；`desktop-ui-polish` 组件与样式基线。
- Desktop 工作区刷新策略 **刻意与 Mobile 分叉**，须在文档与实现注释中注明，避免后续「对齐双端」误改。
- 文案以 **Mobile 已有口径** 为权威对照（「回滚」「压缩上下文」「聊天重命名」）。
- 不引入 UI 库；复用现有 `TextPromptModal`、`ConfirmModal`、`ShellNavProvider.refreshWorkspaceTrees` 等。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| Bug 6 根因 | macOS 单击无响应可能与事件冒泡、focus 或 Electron 层有关，实现时需跨 macOS/Windows 回归 |
| Bug 1 覆盖面 | 「全部输入框」含设置、Modal、Preview 内 CodeMirror 等，需清单化避免遗漏 |
| Bug 3 与窄刷新 | Desktop 实时刷新 **不** 改变消费方② `markDirty` 口径；提示词持久 worktree 块仍 lazy |
| 面包屑跳转语义 | Preview-only 面包屑点击后 Explorer 定位行为需在 SPEC 阶段细化，本 PRD 要求「可感知且一致」 |
