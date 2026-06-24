---
date: 2026-06-23
dependency:
  - Iterations/vfs-user-ops-unified-tool-turn/prd.md
  - Iterations/desktop-workspace-ux-fixes/prd.md
  - Iterations/mobile-webview-chat-transcript/prd.md
---

# Desktop 聊天与工作区交互优化 PRD

## 背景

Desktop 三栏壳（Preview | Explorer | ChatRail）在两类交互上与 Mobile 或用户预期不一致：

1. **工具调用卡片**：Mobile 端对 `read` / `write` / `edit` 等会话工作区文件工具，卡片可点击并跳转文件预览；Desktop 聊天区工具卡片仅为只读展示，无法一键打开对应文件。
2. **工作区顶栏操作**：Explorer 顶栏并列展示「从上级同步」「导出 ZIP」「导入 ZIP」三个图标按钮，占用空间且与后续信息架构收敛方向不符。
3. **用户 VFS 操作 flush**：用户在工作区内的删改在发送下一条聊天前会合并写入 transcript（用户 VFS 统一 tool turn）。当用户连续操作相互抵消（如先删后建、先建后删、改名后又改回）时，仍会生成无实际影响的系统消息，增加 transcript 噪音。

本迭代聚焦 **Desktop 体验补齐** 与 **flush 噪音削减**；不修改 Mobile 端既有行为（工具卡片点击、顶栏布局保持现状）。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 工具卡片可跳转预览 | Desktop 聊天区可打开的文件工具卡片，点击后 **3s 内** 在右侧 Preview 展示对应路径内容；行为与 Mobile「点击查看 · 聊天工作区」一致 |
| 顶栏收敛为更多菜单 | 原三按钮收拢为单「更多」入口；菜单项「初始化」「导入」「导出」功能与现网等价 |
| flush 抵消性过滤 | 指定抵消场景下，下次 Agent 发送 **不** 插入用户 VFS action / ack 消息对；工作区磁盘状态与过滤前一致 |
| 无 Mobile 回归 | Mobile 工具卡片、工作区顶栏、flush 行为 **不变** |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 写作者 | Agent 写入 `ch1.md` 后，在聊天区点击工具卡片，直接右侧预览该章，无需在 Explorer 中再找文件 |
| 配置者 | 在会话/聊天工作区顶栏通过「更多 → 初始化」从上级同步模板，界面更简洁 |
| 整理工作区者 | 误删文件夹后立即重建、或试探性改名后又改回，发送聊天时不希望 transcript 出现一堆无意义的系统操作记录 |
| 调试者 | 对比 Desktop 与 Mobile：同一工具调用卡片，两端均可打开会话工作区对应文件 |

## 范围

### 包含范围

1. **F2 — Desktop 工具调用卡片点击跳转预览**
   - 对 `read` / `write` / `edit`（含 `vfs.*` 前缀）且 `input.path` 为以 `/` 开头的逻辑路径的工具调用，卡片可点击。
   - 点击后在 Desktop 右侧 Preview 打开 **聊天工作区**（`chat` scope）对应文件；若尚未打开则新建 tab。
   - 视觉与可访问性提示对齐 Mobile：可辨识为可点击（如主色边框 / 提示文案「点击查看 · 聊天工作区」）。
   - 非文件类工具（如 `mkdir`、`delete`）保持不可点击。

2. **F3 — 工作区顶栏三点更多菜单**
   - 移除 Explorer 顶栏并列的「从上级同步」「导出 ZIP」「导入 ZIP」三个图标按钮。
   - 改为单一「更多」（三点）按钮；点击弹出菜单，包含：
     - **初始化** — 等价于原「从上级同步」（仅会话工作区、聊天工作区面板可见；确认文案与成功提示与现网一致）。
     - **导入** — 等价于原「导入 ZIP」。
     - **导出** — 等价于原「导出 ZIP」。
   - 全局工作区面板无「初始化」项（与现网无同步按钮一致）。

3. **F4 — flush 抵消性操作过滤**
   - 在用户 VFS pending 队列 flush 时（下次 Agent 发送触发），检测并跳过相互抵消、对工作区无净影响的操作用于 transcript。
   - **首版包含**：
     - 同一路径：先删除后创建 / 先创建后删除（文件或目录）。
     - 同一路径：重命名 A→B 后又 B→A（净效果路径不变）。
   - 过滤仅影响 **是否写入 transcript 消息**；各次操作仍已在磁盘即时生效，与现网一致。
   - 若过滤后 pending 为空，则 **不** 插入用户 VFS action 与「收到通知」ack 消息对。

### 不包含范围

- Mobile 端工具卡片、工作区顶栏、flush 逻辑变更
- Desktop Explorer 自动刷新、目录规则、已删除文件 tab 删除态（见 `desktop-workspace-ux-fixes`）
- 工具卡片支持 `delete` / `mkdir` 等不可预览操作的可点击化
- F4 第二阶段：编辑后内容完全恢复原状的 hunk 级抵消（可 follow-up）
- 修改用户 VFS 统一 tool turn 的 U-A 消息形态或「收到通知」文案
- 关闭 `NM_USER_VFS_UNIFIED_TOOL_TURN` 时的 legacy 路径行为变更

## 核心需求

1. **工具卡片对齐 Mobile**：Desktop 聊天区文件类工具卡片可点击，打开聊天工作区 Preview，支持 `read` / `write` / `edit`。
2. **顶栏更多菜单**：三按钮合并为一点；「初始化」= 原从上级同步；导入/导出行为与确认流程不变。
3. **scope 一致**：工具卡片预览固定打开 **聊天工作区** 文件，与 Mobile「聊天工作区」语义一致。
4. **flush 净效果过滤**：路径级 create/delete/rename 抵消对在 flush 时不产生 transcript 消息。
5. **空队列跳过**：过滤后无待 flush 条目时，不插入 synthetic 消息对。
6. **双端策略分叉**：本批次 Desktop 顶栏与工具卡片变更 **不** 要求 Mobile 跟随。

## 验收标准

### F2 — 工具卡片跳转

- **Given** Desktop 聊天区展示 Agent 对 `/notes/ch1.md` 的 `write` 工具调用且状态为成功  
  **When** 用户点击该工具卡片  
  **Then** 右侧 Preview 在 **3s 内** 打开 `ch1.md`（聊天工作区 tab）；内容与 VFS 一致。

- **Given** 工具调用为 `delete` 或 `mkdir`  
  **When** 用户查看卡片  
  **Then** 卡片 **不可** 点击打开预览（无误导性「点击查看」提示）。

- **Given** Mobile 同会话同工具调用  
  **When** 用户点击 Mobile 工具卡片  
  **Then** 行为与改动前一致（无回归）。

### F3 — 更多菜单

- **Given** Desktop 聊天工作区 Explorer 顶栏  
  **When** 用户查看操作区  
  **Then** 仅见「更多」（三点）按钮，**不见** 原并列三图标按钮。

- **Given** 用户在会话或聊天工作区点击「更多 → 初始化」并确认  
  **When** 同步成功  
  **Then** 工作区内容与现网「从上级同步」一致；toast 文案与现网一致（如「已从全局工作区同步」/「已从项目工作区同步」）。

- **Given** 用户点击「更多 → 导入」或「导出」  
  **When** 完成操作  
  **Then** 确认文案、危险提示、覆盖范围与现网导入/导出 ZIP **一致**。

- **Given** Desktop 全局工作区面板  
  **When** 用户打开「更多」菜单  
  **Then** 菜单中 **无**「初始化」项；仍有导入、导出。

### F4 — flush 抵消过滤

- **Given** 用户在同一会话工作区先删除 `/drafts` 再创建 `/drafts`（或相反顺序），且期间未发送聊天  
  **When** 用户发送下一条 Agent 消息触发 flush  
  **Then** transcript **不** 新增用户 VFS action 消息对；工作区最终状态与两次操作后的磁盘一致。

- **Given** 用户将 `/a.md` 重命名为 `/b.md` 后又改回 `/a.md`，期间未发送聊天  
  **When** 用户发送 Agent 消息  
  **Then** transcript **不** 新增用户 VFS action 消息对。

- **Given** 用户删除 `/real.md`（无后续抵消操作）  
  **When** 用户发送 Agent 消息  
  **Then** transcript **仍** 包含对应用户 VFS action（与现网一致）。

- **Given** 用户编辑文件使内容变化后又保存回原内容（hunk 级回滚）  
  **When** 用户发送 Agent 消息  
  **Then** 本批次 **可** 仍产生 flush 消息（该场景不在首版范围，不作为失败条件）。

## 约束与依赖

- 依赖 `vfs-user-ops-unified-tool-turn` 的 pending 队列与 flush 触发时机（Agent 发送前）。
- 依赖 Desktop `ShellNavProvider` 与 Preview 三栏壳；与 `desktop-workspace-ux-fixes` 并行开发时注意 `ConversationPanel` / Explorer 合并冲突。
- F2 行为参照 Mobile `vfsToolFilePath` 与工具卡片交互，不要求 Mobile 代码变更。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| Preview 焦点 | 点击工具卡片后是否自动将布局焦点切到 Preview 栏——实现阶段默认 **是**（用户需看见打开结果） |
| F4 边界 | 跨路径 rename 链、目录删除与子文件操作的抵消——首版仅同路径 CRUD/rename 回滚 |
| 与 ux-fixes 合并 | 两迭代均可能改动 `ConversationPanel`；建议分支协调或顺序合并 |
