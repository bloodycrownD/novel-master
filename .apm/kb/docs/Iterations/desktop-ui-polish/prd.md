# Desktop UI 优化与缺陷修复 PRD

## 背景

- Novel Master Desktop（`apps/desktop`）已完成 D0–D8 功能闭环（三栏布局、VFS、对话、设置、打包），可在 Electron 中运行。
- 首轮手工验收暴露 **交互缺陷、样式不一致、原生弹窗泛滥、部分功能失效** 等问题（见用户截图与 11 条反馈）。
- 原型 `examples/desktop` 已定义 slider 开关、圆角卡片、统一按钮等视觉规范；mobile 已实现 Agent 编辑、事件块编辑、VFS 管理等成熟 UI 逻辑，可作为行为对照。
- 仓库根目录已有 `icon.webp`，尚未接入 Electron 窗口与安装包图标。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 修复已知功能缺陷 | 新建文件/目录、会话自动命名、服务商编辑入口等 P0 项 100% 可演示 |
| 统一视觉与交互 | 设置/工作区/对话 **零** `window.alert` / `window.confirm` / `window.prompt`（P0 范围）；按钮与列表 hover 风格一致 |
| 对齐 mobile 配置体验 | Agent 配置、事件配置 **核心字段与操作流程** 与 mobile 一致（非 RN 组件 1:1，但能力等价） |
| 应用品牌识别 | Win/macOS 安装包与任务栏/窗口使用 `icon.webp` 衍生图标 |

**量化参考：**

- P0 验收清单（见下）≥ **12/12** 通过。
- 设置页 3 个 switch 使用滑块样式；列表项默认浅底、hover 深一级。
- `grep window\.(alert|confirm|prompt) apps/desktop/renderer` 在 P0 文件范围内为 **0**（P1 对话消息操作可分期）。

## 用户与场景

| 用户 | 场景 |
|------|------|
| 创作者 | 快速新建会话（自动命名）、在工作区右键新建文件/目录、标题栏一键同步/导入/导出 |
| 配置用户 | 在设置页用统一 switch、列表、表单编辑 Agent/Provider/事件，无系统原生弹窗打断 |
| 安装用户 | 安装后看到正确应用图标，而非 Electron 默认图标 |

## 范围

### 包含范围

1. **会话自动命名**：新建会话默认 `会话1` / `会话2` / …（项目内递增、跳过已占用编号）；仍支持重命名。
2. **样式优化（P0 面）**：三栏分割、设置卡片、列表项、按钮 — 圆角 + 色阶分层，**减少硬边框**；列表项 **浅底默认、hover 加深**。
3. **应用图标**：`icon.webp` → 构建时生成 `.ico` / `.icns`（或 png 集），写入 `electron-builder` 与 `BrowserWindow`。
4. **工作区交互重构**：
   - 移除工具栏「新建文件/新建目录」按钮；
   - 右键菜单（空白处 / 目录）增加「新建文件」「新建文件夹」；
   - 移除工具栏「从上级同步 / 导出 ZIP / 导入 ZIP」；
   - 在 `#workspace-title` 行 **左侧** 增加三个 icon 按钮（同步、导出 ZIP、导入 ZIP）。
5. **新建文件/目录修复**：创建后列表刷新、错误可见；路径相对当前右键上下文（根或所选目录）。
6. **设置 switch**：聊天偏好等用 **滑块 switch**（对齐原型 `settings-switch-slider`），非原生 checkbox。
7. **设置列表样式**：修复 `settings-list-item` 类名/CSS 漂移导致的深色底+浅色 hover。
8. **Agent 配置页增强**：参考 mobile `AgentEditorForm` — 名称、maxSteps、system prompt、prompt blocks 基础、工具策略、YAML 导入导出、保存/删除确认用应用内弹窗。
9. **事件配置页增强**：参考 mobile `EventBlockEditor` — 块列表 + 参数编辑，替代裸 JSON textarea；保留 YAML 导入导出。
10. **按钮样式统一**：primary / secondary / danger / icon 四类，设置与工作区共用。
11. **弹窗统一 + 文案修正**：Provider 详情页按钮为「编辑服务商」；删除/导入等 **全部** 使用 `ConfirmModal` / `TextPromptModal` / `Toast`，禁止 Electron/浏览器原生对话框（P0：设置 + 工作区 + ChatRail 会话；P1：对话消息菜单）。

### 不包含范围

- 引入第三方 UI 组件库（MUI/Ant 等）。
- 工作区 **目录导航/breadcrumb**（mobile 级完整 `VfsFileManager` 导航 — 另开迭代）。
- 目录规则完整 Sheet（本期可保留简化规则开关，完整 `DirectoryRuleSheet` 分期）。
- Linux 图标/打包。
- Core 域逻辑变更（命名、VFS、Agent 仍走现有 IPC/Core API）。

## 核心需求

1. 新建会话一键创建，标题自动为 `会话N`，N 为项目内最小可用正整数。
2. 工作区标题行左侧三 icon（同步 / 导出 / 导入），工具栏仅保留树列表，无文本 CRUD 按钮。
3. 右键菜单支持在根或目录下新建文件/目录；创建成功后 1s 内可在树中看到新条目。
4. 设置页 switch 与列表 hover 符合原型视觉；配置列表无 CSS 类名错位。
5. Agent / 事件配置页达到 mobile **核心操作等价**（可配置、可保存、可 YAML 交换）。
6. 全应用 P0 路径无原生 `alert/confirm/prompt`；错误与成功用 Toast 或内联提示。
7. 安装包与运行时窗口使用 `icon.webp` 衍生图标。

## 验收标准

### 会话

- **Given** 项目内已有「会话1」「会话2」  
  **When** 点击「新建」会话  
  **Then** 创建「会话3」并进入会话列表，无需输入名称。

### 工作区

- **Given** 会话工作区  
  **When** 在空白处右键 →「新建文件」→ 输入 `test.md`  
  **Then** 树中出现 `/test.md`，预览可打开；**无** 工具栏新建按钮。

- **Given** 会话工作区有文件  
  **When** 点击标题行左侧「导出 ZIP」  
  **Then** 弹出保存对话框并成功导出；导入/同步 icon 同理可用。

### 设置

- **Given** 设置 → 常规 → 聊天偏好  
  **When** 查看「流式输出」  
  **Then** 为 **滑块 switch**，非方形 checkbox；切换后重启仍持久化。

- **Given** 设置 → 服务商与模型 → 某 Provider  
  **When** 进入模型管理页  
  **Then** 可见「编辑服务商」按钮（非错误文案）；删除时弹出 **应用内 ConfirmModal**。

### Agent / 事件

- **Given** 设置 → Agent → 编辑某 Agent  
  **When** 修改 maxSteps 与 system prompt 并保存  
  **Then** 重启 App 后仍生效；界面含 **结构化字段**（非仅 3 个 input + 裸 YAML 按钮）。

- **Given** 设置 → 事件配置  
  **When** 编辑事件块并保存  
  **Then** 不依赖手写 JSON；validation 失败显示应用内错误提示。

### 图标

- **Given** 执行 `npm run dist -w @novel-master/desktop`  
  **When** 安装 Win 包并启动  
  **Then** 任务栏/窗口图标为 `icon.webp` 对应图案，非 Electron 默认。

### 样式

- **Given** 设置列表任意项  
  **When** 鼠标 hover  
  **Then** 背景较默认态 **加深**（非变浅）；默认态为浅色底。

### 原生弹窗（P0）

- **Given** 执行静态扫描  
  **When** `grep -r "window\\.confirm\\|window\\.alert\\|window\\.prompt" apps/desktop/renderer/{layout,features/settings,features/workspace}`  
  **Then** **0 匹配**。

---

## 约束与依赖

- 延续 **无 UI 库** 策略；复用/扩展已有 `TextPromptModal`、`ContextMenu` 模式。
- 视觉 token 以 `examples/desktop/shell.css` 为准，允许圆角/渐变替代部分 `border`。
- mobile 为 **交互与字段** 权威，非 RN 视觉 1:1。
- 依赖现有 `desktop-app` IPC，不新增 Core API（Agent/Events YAML IPC 已有）。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| Agent/事件 UI 工作量 | 块编辑器逻辑可从 mobile 移植为 Web 组件，可能分 P0（核心字段）/ P1（完整块 UI） |
| icon.webp 格式 | 构建时需转换为 electron-builder 支持的 `.ico`/`.icns` |
| 新建文件失效根因 | 可能为 `window.prompt` 在 Electron 下体验差或 IPC 错误未展示；SPEC 中一并修复 |
