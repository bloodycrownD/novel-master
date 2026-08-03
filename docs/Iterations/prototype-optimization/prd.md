# 原型优化（Mobile 同步 + Desktop 完善）PRD

> **类型**：UI 原型迭代  
> **工作区**：`desktop-dev` worktree（`examples/mobile`、`examples/desktop`）  
> **范围**：仅 HTML/CSS/JS 原型，不涉及 `apps/mobile` / `apps/desktop` 生产代码  
> **参照**：`apps/mobile` 为 mobile 原型权威；desktop 在 **worktree 现有三栏布局**内对齐同等功能全集

## 背景

- **`examples/mobile`** 为 App 实现前的 HTML 交互原型，但 **`apps/mobile` 已大幅演进**（两 Tab 导航、Agent 迁入「我的」、事件配置、压缩条件更名、工作区当前 agent/正则组、流式/富文本开关、数据库导入导出等），原型 IA 与页面能力明显落后。
- **`examples/desktop`（worktree）** 采用固定 **三栏布局**：**文件预览 | 工作区浏览器 | chat rail 嵌套导航**（`preview-pane` + `explorer-pane` + `chat-rail`，见 `shell.css` / `shell.js`）。骨架已有，但功能页（设置、主题、配置流等）未补齐。
- 本次仅优化**可浏览器打开的 HTML 原型**；**不接 Core**、不修改 RN/Electron 应用代码。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| Mobile 原型与 App 对齐 | `apps/mobile` 当前**全部用户可见页面与入口**在 mobile 原型中均可到达；底栏为 **对话 + 我的**（无 Agent Tab） |
| Desktop 原型功能全集 | 在**不改变 worktree 现有三栏 DOM 布局**前提下，覆盖与 mobile 原型（同步后）**同等功能页面** |
| 交互 mock 可演示 | 增删改、表单保存、主题/偏好切换等写入 **localStorage**；刷新后状态保留 |
| 文档同步 | 更新 `feature-inventory.md` 与 desktop README，与实现一致 |

**量化参考：**

- Mobile：对照 `apps/mobile/src/navigation/types.ts`，验收清单 **≥ 95%** 有对应可交互页面或模态。
- Desktop：对照同步后的 mobile 功能清单，在现有三栏槽位内 **≥ 95%** 可演示。

## 用户与场景

| 用户 | 场景 |
|------|------|
| 产品 / 设计 | 浏览器中评审与 App 一致的 IA 与关键流程 |
| 前端 / RN 开发 | 以原型为交互与文案参照 |
| Desktop 开发 | 在 worktree 三栏布局下预览功能全集，为 Electron/React 重写提供参照 |

## 范围

### 包含范围

**任务 A — Mobile 原型同步（`examples/mobile`）**

1. **主导航**：底栏 **对话 | 我的**；Agent 能力迁至 **我的 → 配置 → agent管理**。
2. **我的页**（对齐 `ProfileTabScreen`）：工作区（当前模型/agent/正则组、流式/富文本）、数据管理（导入导出 mock）、配置（agent管理、服务商、压缩条件、事件配置、正则、全局模板）。
3. **Agent 语义**：移除「设为默认」；**当前 agent** 由工作区设置；会话抽屉 **切换 agent**。
4. **新增/补齐**：事件配置、压缩条件（更名）、服务商创建/编辑流等。
5. 更新 **`feature-inventory.md`**。

**任务 B — Desktop 原型完善（`examples/desktop`，worktree 布局）**

1. **布局冻结**（不得改动）：
   ```text
   #preview-pane  |  #explorer-pane  |  #chat-rail
   文件预览        |  工作区树+动态标题  |  嵌套导航（会话→聊天→设置等）
   ```
   - **不**改回主分支旧版 `#sidebar` + `#mainContent` + `#rightSidebar` 结构。
2. **功能映射**（在冻结布局内）：
   - **explorer**：全局/项目/会话工作区树；标题随 chat rail 层级切换。
   - **preview**：选中文件可预览/编辑 mock。
   - **chat rail**：嵌套视图覆盖 mobile 同等能力（会话列表、聊天、agent管理、我的/设置各子页、真实提示词、日志等）。
3. **主题切换**：浅/深 + localStorage。
4. **交互 mock**：与任务 A 同级。
5. 更新 **`examples/desktop/README.md`**。

### 不包含范围

- 主仓库 `apps/*`、`packages/*` 变更。
- Core / SQLite / SKSP / 真实 LLM。
- Electron renderer 重写。
- 主分支 `examples/` 原型同步（仅在 worktree 迭代，merge 时一并带入）。

## 核心需求

1. **Mobile 以 App 为权威**；移除旧三 Tab、「默认 Agent」概念。
2. **Desktop 保持 worktree 三栏**（preview / explorer / chat-rail），仅补功能。
3. **交互 mock 标准**：localStorage 持久化；禁止大面积 Toast 占位。
4. **并行交付**：mobile / desktop 可并行实现。

## 验收标准

### 任务 A — Mobile

- 底栏仅有 **对话、我的**。
- 「我的」含工作区、数据管理、配置（含事件配置、压缩条件）。
- 会话抽屉含 **当前 agent/模型** 与 **切换 agent**。
- Agent 列表无「默认」徽标；⋮ 含重命名/复制/删除。

### 任务 B — Desktop（worktree 布局）

- DOM 顶层仍为 `#preview-pane` + `#explorer-pane` + `#chat-rail`。
- chat rail 可到达与 mobile 同步后 **≥ 95%** 等价功能页（设置、主题、配置流等可交互 mock，非 Toast）。
- 主题切换刷新后保留。

### 负向

- 修改主分支 `examples/` 而未在 worktree 完成 → 不视为完成。
- desktop 改为 sidebar 三栏或其他布局 → 不视为完成。
