---
date: 2026-06-24
dependency:
  - Iterations/vfs-user-ops-unified-tool-turn/prd.md
  - Iterations/message-checkpoint-v2/prd.md
  - Iterations/desktop-workspace-ux-fixes/prd.md
  - Iterations/mobile-webview-chat-transcript/prd.md
---

# Desktop 聊天与工作区交互优化 PRD

## 背景

Desktop 三栏壳（Preview | Explorer | ChatRail）在两类交互上与 Mobile 或用户预期不一致：

1. **工具调用卡片**：Mobile 端对 `read` / `write` / `edit` 等会话工作区文件工具，卡片可点击并跳转文件预览；Desktop 聊天区工具卡片仅为只读展示，无法一键打开对应文件。
2. **工作区顶栏操作**：Explorer 顶栏并列展示「从上级同步」「导出 ZIP」「导入 ZIP」三个图标按钮，占用空间且与后续信息架构收敛方向不符。
3. **用户 VFS 操作 flush**：用户在工作区内的删改在发送下一条聊天前会写入 transcript（用户 VFS 统一 tool turn）。现网 flush 将 pending 队列内各次操作的 action XML **按顺序拼接**；当用户连续操作相互抵消（如先删后建、改名后又改回、编辑后又保存回原内容）时，仍会生成对工作区 **无净影响** 的系统消息，增加 transcript 噪音。

本迭代聚焦 **Desktop 体验补齐** 与 **flush 噪音削减**。F2/F3 仅改 Desktop UI；F4 在 Core 调整 flush 语义，**Mobile 端 UI 不变**，但会话 flush 行为与 Desktop 一致（共用 Core）。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 工具卡片可跳转预览 | Desktop 聊天区可打开的文件工具卡片，点击后 **3s 内** 在右侧 Preview 展示对应路径内容；行为与 Mobile「点击查看 · 聊天工作区」一致 |
| 顶栏收敛为更多菜单 | 原三按钮收拢为单「更多」入口；菜单项「初始化」「导入」「导出」功能与现网等价 |
| flush 终态净变更 | 下次 Agent 发送时，以 **最近 message checkpoint** 对比当前工作区终态；**无净变更** 则不插入用户 VFS action / ack 消息对；有净变更则合成 action 写入 transcript |
| Mobile UI 无回归 | Mobile 工具卡片、工作区顶栏 **不变**；F4 flush 行为随 Core 更新（transcript 更干净） |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 写作者 | Agent 写入 `ch1.md` 后，在聊天区点击工具卡片，直接右侧预览该章，无需在 Explorer 中再找文件 |
| 配置者 | 在会话/聊天工作区顶栏通过「更多 → 初始化」从上级同步模板，界面更简洁 |
| 整理工作区者 | 误删文件夹后立即重建、或试探性改名后又改回、或改了几笔又保存回原内容，发送聊天时不希望 transcript 出现无意义的系统操作记录 |
| 调试者 | 对比 Desktop 与 Mobile：同一工具调用卡片，两端均可打开会话工作区对应文件 |

## 范围

### 包含范围

1. **F2 — Desktop 工具调用卡片点击跳转预览**
   - 对 `read` / `write` / `edit`（含 `vfs.*` 前缀）且 `input.path` 为以 `/` 开头的逻辑路径的工具调用，卡片可点击。
   - 点击后在 Desktop 右侧 Preview 打开 **聊天工作区**（`chat` scope）对应文件；若尚未打开则新建 tab；Preview 列隐藏时自动显示。
   - 视觉与可访问性提示对齐 Mobile：可辨识为可点击（如主色边框 / 提示文案「点击查看 · 聊天工作区」）。
   - 非文件类工具（如 `mkdir`、`delete`）保持不可点击。

2. **F3 — 工作区顶栏三点更多菜单**
   - 移除 Explorer 顶栏并列的「从上级同步」「导出 ZIP」「导入 ZIP」三个图标按钮。
   - 改为单一「更多」（三点）按钮；点击弹出菜单，包含：
     - **初始化** — 等价于原「从上级同步」（仅会话工作区、聊天工作区面板可见；确认文案与成功提示与现网一致）。
     - **导入** — 等价于原「导入 ZIP」。
     - **导出** — 等价于原「导出 ZIP」。
   - 全局工作区面板无「初始化」项（与现网无同步按钮一致）。

3. **F4 — checkpoint 终态 diff flush**
   - 触发时机不变：用户在手改工作区后、**下次 Agent 发送** 时 flush（`executeOp` 仍 **即时写盘**；pending 队列仍用于标记「有待 flush 的手改」）。
   - flush 时 **不再** 将 pending 内各次 action XML 简单拼接；改为：
     1. 取 **最近 message checkpoint** 的文件树（`path → revisionVersion`）为基准；
     2. 取当前会话工作区终态（文件 head + 目录列表）；
     3. 对比 **净变更**，合成 `<user-vfs-action>` XML 写入 transcript。
   - **净变更为空**（相对 checkpoint 无文件/目录/内容差异）→ **不** 插入用户 VFS action 与「收到通知」ack 消息对，并清空 pending。
   - **首版净变更判定包含**：
     - 文件：新增、删除、**内容变更**（同 path 比较 revision 正文）；内容相同则视为无变更（含编辑后又保存回原内容）。
     - 目录：checkpoint **不记录空目录**（与 message-checkpoint-v2 一致）；flush 合成层单独对比 **当前目录列表** 与由 checkpoint 文件路径 **推导** 的父目录集，处理 mkdir / 删空目录等。
     - 重命名：合成层对「删除 path + 新增 path、正文相同」做配对，优先输出 `kind="rename"`（非 delete + write 噪音）；首版以 **单文件 1:1 内容相等** 配对为主。
   - 仅影响 **transcript 是否写入及写入内容**；磁盘状态在各次 `executeOp` 时已生效，与现网一致。

### 不包含范围

- Mobile 端工具卡片、工作区顶栏 UI 变更
- 修改 message checkpoint schema（仍只存文件，不含空目录）
- 修改 VFS `rename` / `mkdir` 底层实现（空目录与 rename 语义在 **flush 合成层** 处理）
- Desktop Explorer 自动刷新、目录规则、已删除文件 tab 删除态（见 `desktop-workspace-ux-fixes`）
- 工具卡片支持 `delete` / `mkdir` 等不可预览操作的可点击化
- F4 follow-up：复杂 rename 链（A→B→C 压缩为一条）、整目录批量 rename 启发式优化
- 修改用户 VFS 统一 tool turn 的 U-A 消息形态或「收到通知」文案
- 关闭 `NM_USER_VFS_UNIFIED_TOOL_TURN` 时的 legacy 路径行为变更

## 核心需求

1. **工具卡片对齐 Mobile**：Desktop 聊天区文件类工具卡片可点击，打开聊天工作区 Preview，支持 `read` / `write` / `edit`。
2. **顶栏更多菜单**：三按钮合并为一点；「初始化」= 原从上级同步；导入/导出行为与确认流程不变。
3. **scope 一致**：工具卡片预览固定打开 **聊天工作区** 文件，与 Mobile「聊天工作区」语义一致。
4. **flush 以 checkpoint 为锚**：transcript 反映相对 **最近 checkpoint** 的净变更，而非手改过程的全量拼接。
5. **无净变更则跳过**：合成结果为空时，不插入 synthetic 消息对。
6. **双端 UI 策略分叉**：F2/F3 仅 Desktop；F4 为 Core 能力，双端会话共享。

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

### F4 — checkpoint 终态 diff flush

- **Given** 用户在同一会话工作区先删除 `/drafts` 再创建 `/drafts`（或相反顺序），且期间未发送聊天  
  **When** 用户发送下一条 Agent 消息触发 flush  
  **Then** transcript **不** 新增用户 VFS action 消息对；工作区最终状态与两次操作后的磁盘一致。

- **Given** 用户将 `/a.md` 重命名为 `/b.md` 后又改回 `/a.md`，期间未发送聊天  
  **When** 用户发送 Agent 消息  
  **Then** transcript **不** 新增用户 VFS action 消息对。

- **Given** 用户编辑 `/doc.md` 使内容变化后又保存为与 checkpoint 时 **相同** 的正文，期间未发送聊天  
  **When** 用户发送 Agent 消息  
  **Then** transcript **不** 新增用户 VFS action 消息对。

- **Given** 用户删除 `/real.md`（无后续抵消操作）  
  **When** 用户发送 Agent 消息  
  **Then** transcript **仍** 包含对应用户 VFS action（描述删除净变更）。

- **Given** 用户新建空目录 `/empty` 后又删除该空目录，期间未发送聊天，且 checkpoint 中从未有过该目录  
  **When** 用户发送 Agent 消息  
  **Then** transcript **不** 新增用户 VFS action 消息对。

- **Given** Mobile 同会话、同手改与发送序列  
  **When** flush 完成  
  **Then** transcript 是否与 Desktop 一致（Core 共用）。

## 约束与依赖

- 依赖 `vfs-user-ops-unified-tool-turn`：`executeOp` 即时写盘、pending 标记、`flushPendingUserVfsTurns` 触发时机（Agent 发送前）。
- 依赖 `message-checkpoint-v2`：最近 checkpoint 文件树为 flush 基准；**不** 扩展 checkpoint 存空目录。
- 依赖 Desktop `ShellNavProvider` 与 Preview 三栏壳；实现见 [spec.md](./spec.md)。
- F2 行为参照 Mobile `vfsToolFilePath` 与工具卡片交互，不要求 Mobile 代码变更。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| Preview 焦点 | 点击工具卡片后自动显示 Preview 列（见 spec） |
| F4 合成成本 | 大工作区 flush 需读取 diff 涉及文件的 revision；单会话规模见 message-checkpoint-v2 假设 |
| rename 首版 | 仅内容完全相等的单文件 1:1 配对为 rename；其余可退化为 delete + write |
| 实现顺序 | 建议 F3 → F2 → F4（见 spec） |
