# Desktop UI 优化与缺陷修复 技术规格（SPEC）

> 需求：[prd.md](./prd.md)  
> 前置迭代：[desktop-app/spec.md](../desktop-app/spec.md)  
> UI 参考：`examples/desktop/shell.css`、`examples/desktop/shell.js`  
> 行为参考：`apps/mobile/src/screens/**`

## 设计目标

- 修复 P0 功能缺陷（会话命名、VFS 新建、Provider 文案、图标缺失）。
- 统一 Desktop renderer 的 **弹窗/按钮/列表/switch** 组件，消除原生对话框。
- 工作区 IA 调整：CRUD 进右键菜单，同步/zip 进标题 icon 区。
- Agent / 事件配置页达到 mobile **核心能力等价**（**可视化块编辑器为主路径**，YAML 仅导入/导出；不引入 UI 库）。
- 抽取 **`@novel-master/config-forms`** 共享包（方案 B），mobile/desktop 共用事件/Agent 纯 TS 逻辑，避免双端漂移。

---

## 现状与约束（代码探索）

| 项 | 现状 | 影响 |
|----|------|------|
| 会话创建 | `ChatRail.tsx` 弹 `TextPromptModal`，`initialValue: ""` | 无自动 `会话N` |
| 工作区工具栏 | `WorkspaceTree.tsx` L157–174 五个文本按钮 | 与需求 4/5 冲突 |
| 右键菜单 | `App.tsx` L41–55 无新建项 | 无法在目录下创建 |
| 新建 VFS | `createFile`/`createDir` 用 `window.prompt`，**不检查 IPC `result.ok`** | 失败无反馈；prompt 体验差 |
| Switch | `settings-ui.tsx` L59–66 原生 checkbox | 与原型 slider 不符 |
| 列表 CSS | `settings-list-item__title` vs 旧 `__label`；hover 反色 | 截图中的「深底浅 hover」 |
| Agent 编辑 | `SettingsViews.tsx` `AgentEditorView` ~3 字段 | 远少于 mobile `AgentEditorForm` |
| 事件配置 | `EventsConfigView` JSON textarea | 远少于 mobile `EventBlockEditor` |
| Provider | `ProviderDetailView` 按钮文案已为「编辑服务商」；删除用 `window.confirm` | 弹窗未统一 |
| 原生对话框 | 30+ 处 `window.alert/confirm/prompt`（renderer） | 截图 @novel-master/desktop 原生框 |
| 图标 | `icon.webp` 在 repo 根；`electron-builder.yml` 无 `icon` | 默认 Electron 图标 |
| 架构 | 仍 **无第三方 UI 库** | 自建 `components/ui/*` |

**兼容性原则**

- 主要改 `apps/desktop/**`；新增 `packages/config-forms/**`；mobile 改 import 指向共享包（行为不变）。
- **不改** `@novel-master/core` 域模型、IPC 通道契约。
- Agent/Events **主路径禁止** JSON/YAML textarea；YAML 仅页脚「导入/导出」链接。

---

## 总体方案

### 组件层（新建/扩展）

```text
renderer/components/ui/
  ConfirmModal.tsx      # 替代 window.confirm（danger 样式）
  Toast.tsx + toast.ts  # 替代 window.alert 成功/轻量错误
  TextPromptModal.tsx   # 已有；扩展 error 展示、defaultValue
  Switch.tsx            # 滑块 switch（原型 settings-switch）
  IconButton.tsx        # 标题行 icon 按钮（sync/export/import）
  Button.tsx            # btn-primary | btn-secondary | btn-danger
```

**弹窗策略**

| 场景 | 组件 |
|------|------|
| 确认删除/覆盖 | `ConfirmModal` |
| 输入名称/重命名 | `TextPromptModal` |
| 操作成功/轻错误 | `Toast` |
| 列表 ⋮ 菜单 | 现有 `ContextMenu` / `#workspace-context-menu` 模式 |

### 工作区 IA

```text
#explorer-header
  [icon: sync] [icon: export] [icon: import]  |  #workspace-title 会话工作区

#workspace-tree-* 
  （无 workspace-toolbar 文本按钮）
  右键空白 → 新建文件 / 新建文件夹
  右键目录 → 新建文件 / 新建文件夹 / 规则 / 重命名 / 删除
  右键文件 → （现有纳入/重命名/删除）
```

**当前目录解析**

- 空白处右键：`parentPath = "/"`  
- 目录行右键：`parentPath = row.path`  
- 新建路径：`${parentPath}/${name}` 规范化（`vfs-path.ts` 小 helper）

### 会话自动命名

- 新增 `renderer/utils/session-default-title.ts`（自 mobile 移植，前缀改为 **`会话`**）：

```typescript
export const DEFAULT_SESSION_TITLE_PREFIX = "会话";
const NUMBERED_TITLE_RE = /^会话(\d+)$/;
export function nextDefaultSessionTitle(existingTitles: readonly string[]): string;
```

- `ChatRail` 新建会话：**直接** `ipcSessionsCreate({ projectId, title: nextDefaultSessionTitle(...) })`，不弹 modal。
- 重命名仍用 `TextPromptModal`。

### 样式 tokens（P0 面）

| 区域 | 改动 |
|------|------|
| 三栏分割 | `#main-shell` 列间隙用 **背景色差 + 8px 圆角** 替代 1px 硬边框（保留 splitter 拖拽） |
| 设置卡片 | `.settings-panel` 增大 `border-radius`，边框改 `box-shadow` 或浅渐变 |
| 列表项 | `.settings-list-item__main` 默认 `--surface-muted`；`:hover` → `--surface-inset` |
| 按钮 | 统一走 `Button` 组件 class |

### 应用图标

```text
apps/desktop/scripts/generate-icons.mjs
  输入: ../../icon.webp
  输出: apps/desktop/build/icons/icon.ico, icon.icns, icon.png (256)
electron-builder.yml:
  icon: build/icons/icon
main.ts:
  BrowserWindow { icon: resolveIconPath() }  # dev/prod
```

使用 `sharp`（devDependency）转 png + `png-to-ico` 或 electron-builder 内置 icns（mac 需 png 512）。

---

### 共享逻辑包（方案 B）

```text
packages/config-forms/
  package.json                    # @novel-master/config-forms
  tsconfig.json
  src/
    index.ts
    events/
      event-config-state.ts       # 自 mobile 迁移
      event-config-labels.ts
      validate-event-config-blocks.ts
    agent/
      agent-editor-state.ts       # tools policy、prompt block 辅助、snapshot
  test/
    event-config-state.test.ts    # 自 mobile 迁移/对齐
    validate-event-config-blocks.test.ts
    agent-editor-state.test.ts
```

- mobile：`apps/mobile/src/components/events/*` 与 `AgentEditorForm` 内纯逻辑 → import from `@novel-master/config-forms`
- desktop：U4/U5 视图 + 同上 import

---

## 最终项目结构（增量）

```text
packages/config-forms/            # 新增（见上）
apps/desktop/
  build/icons/                    # 生成物（gitignore）
  scripts/
    generate-icons.mjs            # 新增
  renderer/
    components/ui/
      Button.tsx                  # 新增
      ConfirmModal.tsx            # 新增
      Switch.tsx                  # 新增
      IconButton.tsx              # 新增
      Toast.tsx                   # 新增
    utils/
      session-default-title.ts    # 新增
      vfs-path.ts                 # 新增
    features/
      workspace/
        WorkspaceHeaderActions.tsx # 新增：标题行三 icon
        WorkspaceTree.tsx          # 改：去 toolbar，修 create
      settings/
        settings-ui.tsx            # 改：Switch、ListItem
        AgentEditorView.tsx          # 从 SettingsViews 拆出/增强
        EventsConfigView.tsx         # 从 SettingsViews 拆出/增强
        SettingsViews.tsx            # 改：ConfirmModal、Toast
    layout/
      ExplorerPane.tsx             # 改：header 含 icons
      ChatRail.tsx                 # 改：自动命名
    styles/
      shell.css                    # 改：列表 hover、圆角、icon 按钮
  electron-builder.yml             # icon 字段
  src/main/main.ts                 # BrowserWindow icon
```

---

## 变更点清单

| 文件 | 变更 |
|------|------|
| `renderer/utils/session-default-title.ts` | 新建，`会话N` 算法 |
| `renderer/layout/ChatRail.tsx` | 新建会话自动命名；删除 confirm → ConfirmModal |
| `renderer/layout/ExplorerPane.tsx` | header 加 `WorkspaceHeaderActions` |
| `renderer/features/workspace/WorkspaceHeaderActions.tsx` | sync/zip 三 icon |
| `renderer/features/workspace/WorkspaceTree.tsx` | 移除 toolbar；修 create + IPC 错误处理 |
| `renderer/App.tsx` | 右键菜单加新建；空白区 contextmenu |
| `renderer/components/ui/*` | ConfirmModal、Switch、Button、Toast、IconButton |
| `renderer/features/settings/settings-ui.tsx` | Switch 滑块；ListItem class 对齐 |
| `renderer/features/settings/SettingsViews.tsx` | Agent/Events 增强；去 window.* |
| `renderer/features/chat/WorkspaceFooter.tsx` | prompt → PickerModal（P1 可简化为 TextPromptModal 列表） |
| `renderer/styles/shell.css` | 列表 hover、圆角、icon-btn、去 toolbar 样式 |
| `scripts/generate-icons.mjs` | webp → ico/icns/png |
| `electron-builder.yml` | `icon` |
| `src/main/main.ts` | 窗口 icon |
| `package.json` | `sharp`、`png-to-ico` devDep；`build:icons` script |
| `test/smoke.test.js` | 断言 icon 产物、无 window.confirm in P0 dirs（可选 rg 测试） |

---

## 详细实现步骤

### U0 — 基础设施（组件 + 图标）

1. 实现 `Button`、`ConfirmModal`、`Switch`、`Toast`（Portal 到 `#app` 或 `document.body`）。
2. `SettingsSwitchRow` 改用 `Switch` + 原型 HTML 结构（`shell.js` L1836–1842）。
3. `scripts/generate-icons.mjs` + `build:icons`；更新 `electron-builder.yml`、`main.ts`。
4. 修复 `settings-list-item` CSS：删除/合并重复块（L1474–1532 vs L2676–2719），统一 hover。

**验证**：设置 → 常规 switch 为滑块；`build/icons/icon.ico` 存在；smoke 通过。

---

### U1 — 会话自动命名 + 弹窗替换（ChatRail）

1. 移植 `nextDefaultSessionTitle`（前缀 `会话`）。
2. 「新建」会话：拉列表 → 算标题 → `ipcSessionsCreate` → 刷新；失败 Toast。
3. 删除/批量删除：`ConfirmModal` 替代 `window.confirm`。

**验证**：PRD 会话验收；grep ChatRail 无 `window.confirm`。

---

### U2 — 工作区 IA + 新建修复

1. 删除 `WorkspaceTree` 内 `workspace-toolbar` DOM。
2. 新增 `WorkspaceHeaderActions` 于 `ExplorerPane` header（仅 session/chat/global 按需显示 sync — global 无 sync；session=项目 pull；chat=会话 pull）。
3. `App.tsx`：
   - 空白区 `onContextMenu` on `.explorer-tree` → 菜单含新建文件/夹；
   - 目录行菜单增加新建文件/夹（在 rename 前）。
4. 新建逻辑：
   - `TextPromptModal` 输入名；
   - 检查 `result.ok`，失败 Toast `result.error.message`；
   - 路径基于 parentPath。
5. zip/sync 迁到 header icons，confirm 用 `ConfirmModal`。

**验证**：PRD 工作区验收；创建后树刷新；P0 grep workspace 无 `window.*`。

---

### U3 — 设置列表/按钮统一 + Provider

1. `SettingsListItem` 样式对齐；Providers 删除 → `ConfirmModal`。
2. `ProviderDetailView`：确认「编辑服务商」文案；`providerEdit` 路由正确。
3. 所有 `SettingsViews` 内 `window.alert/confirm` → Modal/Toast（含 Agent 删除、Regex 删除、DB 导入）。
4. 未样式化 button 加 `btn-primary` / `btn-secondary`。

**验证**：截图场景「删除 OpenRouter」为应用内 Modal；grep settings 无 `window.*`。

---

### U3.5 — `@novel-master/config-forms` 共享包（方案 B，U4/U5 前置）

1. 创建 `packages/config-forms`，依赖 `@novel-master/core`。
2. 迁移 mobile 纯 TS 模块：`event-config-state`、`event-config-labels`、`validate-event-config-blocks`。
3. 从 `AgentEditorForm` 抽取 `agent-editor-state.ts`（tools policy、prompt strip、form snapshot）。
4. 迁移/对齐 mobile 单元测试到 `packages/config-forms/test`。
5. mobile 改 import；删除 mobile 内重复文件（或 re-export 薄 shim，优先直接改 import）。
6. desktop `package.json` 增加 workspace 依赖。

**验证**：`npm test -w @novel-master/config-forms` + `npm test -w @novel-master/mobile` 通过。

---

### U4 — Agent 配置增强（可视化主路径）

1. 新建 `AgentEditorView.tsx`（Web），对齐 mobile **`AgentEditorForm` 全核心字段**：
   - 基本信息：name
   - 模型：pin 开关 + provider/model 选择
   - maxSteps
   - **Prompt 块列表**：增删排序、role/type、文本/会话块
   - **工具策略**：default / allow / deny + 列表
   - sticky footer：保存；页脚链接「导入/导出 YAML」（非 textarea）
2. 状态/校验用 `@novel-master/config-forms/agent-editor-state`。
3. 数据源：`ipcAgentRegistry*` + `ipcAgentYaml*`；失败 Toast/inline，无 alert。

**参考**：`apps/mobile/src/components/agent/AgentEditorForm.tsx`

**验证**：保存后重启仍生效；日常编辑无 YAML 文本框；YAML round-trip 仅经导入/导出。

---

### U5 — 事件配置增强（可视化主路径）

1. 新建 `EventsConfigView.tsx`，移植 mobile **`EventBlockEditor` + EventsConfigScreen 流程**：
   - 事件块列表（添加/删除/排序）
   - 每块内动作块（类型、参数、DAG 依赖）
   - 保存前 `validateEventConfigBlocks`
2. 序列化：`eventBlocksToConfig` → `ipcEventsSetConfig`。
3. YAML 导入/导出为页脚链接；**移除 JSON textarea**。

**参考**：`apps/mobile/src/screens/stack/EventsConfigScreen.tsx`、`EventConfigBlocks.tsx`

**验证**：可增删改事件/动作块；主路径无 JSON/YAML 编辑框。

---

### U6 — 对话域弹窗清理（P1，可选同迭代）

1. `ConversationPanel.tsx`：`window.confirm/alert` → ConfirmModal/Toast。
2. `WorkspaceFooter`：`window.prompt` → 简易 Picker Modal（Agent/Model 列表选择）。

**验证**：grep ConversationPanel 无 `window.*`。

---

## 测试策略

### 自动化

| ID | 范围 | 内容 |
|----|------|------|
| T1 | `session-default-title.test.ts` | `会话1/2/3` 递增与冲突跳过 |
| T2 | `vfs-path.test.ts` | 路径拼接/normalize |
| T3 | `smoke.test.js` | `build/icons/icon.ico` 存在；preload 仍 OK |
| T4 | rg 门禁 | P0 目录无 `window\.(alert|confirm|prompt)` |

### 手工冒烟

| ID | 步骤 | 期望 |
|----|------|------|
| M1 | 连点新建会话 3 次 | 会话1/2/3 |
| M2 | 工作区空白右键新建 `a.txt` | 出现且可预览 |
| M3 | 标题栏导出 ZIP | 文件保存成功 |
| M4 | 设置 switch 切换 + 重启 | 持久化 |
| M5 | Provider 删除 | 应用内 Modal |
| M6 | Agent 编辑保存 | 字段完整 |
| M7 | 事件块编辑 | 无 JSON textarea 主路径 |
| M8 | 安装包图标 | 非默认 Electron |

---

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| Agent/Events 移植工作量大 | U4/U5 可拆 PR；最小字段集先上 | 保留旧视图 behind flag（不建议） |
| icon 生成跨平台 | CI mac 生成 icns，win 生成 ico | 暂用 png 512 仅 win |
| 移除 toolbar 后用户不知新建 | 空白处右键 + 首次 Toast 提示 | 恢复 toolbar（不推荐） |
| `window.prompt` 移除影响习惯 | TextPromptModal 等价 | — |

**回滚**：迭代仅触及 `apps/desktop` renderer/脚本；可按 PR revert，不影响 Core/mobile。

---

## 里程碑

| 阶段 | 交付 | PRD 条目 |
|------|------|----------|
| U0 | 组件 + 图标 + switch/list CSS | 2, 3, 7, 8, 10 |
| U1 | 会话命名 + ChatRail Modal | 1, 11 |
| U2 | 工作区 IA + 新建修复 | 4, 5, 6 |
| U3 | 设置 Provider + 按钮 | 10, 11 |
| U3.5 | `@novel-master/config-forms` 共享包 | 9 |
| U4 | Agent 可视化编辑器 | 9 |
| U5 | 事件可视化编辑器 | 9 |
| U6 | 对话域 Modal（P1） | 11 |

建议 **2–3 个 PR**：U0–U2（P0 缺陷）→ U3–U5（配置）→ U6（对话 polish）。
