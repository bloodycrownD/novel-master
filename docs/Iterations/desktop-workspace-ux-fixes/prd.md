---
date: 2026-06-23
dependency:
  - Iterations/desktop-ux-bug-fixes/prd.md
  - Iterations/mobile-ui-vfs-defaults/prd.md
  - Iterations/worktree-vfs-ui-refresh-fix/prd.md
---

# Desktop 工作区 / 预览一致性修复 PRD

## 背景

Desktop 三栏壳（Preview | Explorer | ChatRail）在目录规则、工作区刷新与多文件标签三类交互上，与 Mobile 及 VS Code 类编辑器预期不一致，影响用户对「规则是否生效」「文件是否已保存到树」「打开文件是否仍存在」的判断。

与现状及前置 PRD 的关系：

| 领域 | 现状 / 前置口径 | 本批次变更 |
|------|-----------------|------------|
| 目录规则 | Core 语义：无持久化 `setDirRule` 记录 → 列表「规则·关」；`mobile-ui-vfs-defaults` 不批量迁移存量目录 | Desktop **新建目录**对齐 Mobile：创建后自动 `setDirRule` 默认开启；**规则配置弹窗**读取并展示 Core 已持久化状态，无记录时「规则启用」为 **关**（与列表一致），不再用「默认开启」表单误导用户 |
| 工作区刷新 | `worktree-vfs-ui-refresh-fix` 将 Mobile Agent 写盘后 lazy 刷新定为设计行为；`desktop-ux-bug-fixes` 要求 Desktop write/edit 后自动刷新，但触发分散、部分 VFS 变更路径未 bump 刷新 | Desktop：**凡导致 VFS / 工作区列表应变化的操作**完成后，Explorer 工作区树 **自动重载**；Mobile **保持不变** |
| 删除文件标签 | 工作区右键删除会 `closePreviewTabsUnderPath` 关闭 tab；Agent 删除 / 回滚删除 tab 仍显示为正常打开文件 | 参考 VS Code：文件在工作区已不存在时，**保留 tab** 并以斜体 / 删除态变色区分；编辑区明确提示文件不存在；用户可手动关闭 tab |

**关于 Bug 1 弹窗与 Core 不一致：** 当前 `loadDirRuleForm` 在 `getDirRule` 无数据时回落 `defaultDirRuleRequest`（`ruleEnabled: true`），该回落仅表示「保存时的默认合并值」，**不应**作为「当前已生效状态」展示。弹窗应反映 Core / DB 中 **实际持久化** 的规则；无记录时与列表同为「关」，用户显式开启并保存后才变为「开」。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 目录规则状态一致 | 同一目录在 Explorer 列表与「规则配置」弹窗中，「规则开/关」**始终一致**；新建目录后列表默认「规则·开」（与 Mobile 一致） |
| Explorer 实时一致 | 任意 VFS 变更（Agent 工具、用户 Preview 保存、删除、重命名、ZIP 导入等）完成后 **3s 内** Explorer 反映最新树；无需依赖点击空白区等隐式刷新 |
| 已删除文件可感知 | 文件被删后对应 Preview tab **保留**且具删除态视觉（斜体 / 变色）；编辑区提示不存在；用户可手动关 tab |
| Mobile 无回归 | Mobile 目录规则、lazy 刷新策略 **不变** |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 写作者 | 新建文件夹后，列表即显示「规则·开」，无需再进弹窗保存 |
| 配置者 | 打开从未配置过规则的目录「规则配置」，看到「规则启用=关」，与树上「规则·关」一致；开启并保存后两处同步为「开」 |
| 调试者 | Agent write/edit/delete 或自己在 Preview 保存后，左侧 Explorer 立即出现新文件、更名或移除条目 |
| 多标签用户 | Agent 删除了某已打开文件，tab 仍可见但呈删除态，点击后知悉文件已不存在，而非误以为仍正常打开 |

## 范围

### 包含范围

1. **Bug 1 — 目录规则状态对齐**
   - Desktop 新建目录（与会话工作区 mkdir 等价路径）成功后，自动 `setDirRule` 默认开启（对齐 Mobile `VfsFileManager` 建目录后行为）。
   - 「规则配置」弹窗：无持久化规则时，「规则启用」初始为 **关**，其余字段可使用 Core 默认合并值（排序、填充策略等）；有持久化记录时严格展示 DB 值。
   - Explorer 列表 `规则·开/关` 与弹窗保存后 **同步刷新**。

2. **Bug 2 — Explorer 全量自动刷新**
   - Desktop 上所有导致工作区树应变化的操作完成后，统一触发 `refreshWorkspaceTrees` 或等价重载，包括但不限于：Agent 工具 write/edit/delete/move、用户 PreviewPane 保存、工作区 CRUD、规则保存、ZIP 导入、模板同步等。
   - 不依赖用户点击 Explorer 空白区或切换面板作为 **唯一** 刷新手段。
   - **不修改** Mobile 刷新策略（`worktree-vfs-ui-refresh-fix` lazy / 面板切换口径保持）。

3. **Bug 3 — 已删除文件 tab 删除态（VS Code 式）**
   - 文件在工作区 VFS 中已不存在（含 Agent 删除、回滚、工作区菜单删除等）时，对应 Preview tab **保留**（**不再**因工作区删除而自动关闭）。
   - 标签视觉：斜体及/或删除态配色，与正常 tab 可区分。
   - 激活该 tab 时，编辑/预览区展示明确「文件已删除或不存在」提示（非空白或无声失败）。
   - 用户可通过 tab 关闭按钮手动移除。

### 不包含范围

- 修改 Core `resolveRuleState` 全局语义（无 DB 记录仍视为「关」；仅 Desktop 新建目录时 **写入** 默认规则）
- 批量将历史「规则·关」且从未保存过的目录自动改为「开」
- Mobile 端上述三项行为的变更
- Desktop 增加 Mobile 式目录规则行内一键开关（可 follow-up）
- 消费方② 提示词持久 worktree 块的 `markDirty` 触发集变更（仍沿用窄刷新 PRD）
- Linux 专项适配（随 Desktop 通用修复顺带验证即可）
- 标签栏以外的全局「已删除文件」列表面板

## 核心需求

1. **新建目录默认规则（对齐 Mobile）**：Desktop 会话工作区创建目录成功后，自动持久化默认目录规则且 `ruleEnabled: true`，列表显示「规则·开」。
2. **弹窗反映 Core 真值**：`getDirRule` 无记录时，弹窗「规则启用」为关；有记录时与 `getDirRule` / 列表 `ruleState` 一致；保存后两处同步更新。
3. **VFS 变更必刷 Explorer**：Desktop 任一 VFS / worktree 可视变更路径在成功后触发 Explorer 树重载，3s 内用户可见更新。
4. **删除态 tab**：已删除文件的 Preview tab 保留并具 VS Code 式删除视觉；编辑区可读提示；支持手动关闭。
5. **双端策略分叉文档化**：Desktop 全量自动刷新与 Mobile lazy 刷新并存，避免后续误「对齐」改回 Mobile 行为。

## 验收标准

### Bug 1 — 目录规则

- **Given** Desktop 会话工作区，用户新建目录 `drafts`  
  **When** 创建成功且未手动改规则  
  **Then** Explorer 中 `drafts` 显示「规则·开」；打开「规则配置」弹窗，「规则启用」为 **开**。

- **Given** 目录 `notes` 从未保存过目录规则，列表显示「规则·关」  
  **When** 打开「规则配置」  
  **Then** 「规则启用」为 **关**（非默认开）；与列表一致。

- **Given** 用户对 `notes` 在弹窗开启规则并保存  
  **When** 弹窗关闭  
  **Then** 列表与再次打开弹窗均为「规则·开」。

- **Given** Mobile 同会话新建目录  
  **When** 创建成功  
  **Then** 行为与现网 Mobile 一致（本批次 **不** 改 Mobile）。

### Bug 2 — Explorer 刷新

- **Given** Desktop Explorer 展示工作区树  
  **When** Agent 工具完成 write、edit 或 delete（含事件未带 `vfsMutated` 的边界场景）  
  **Then** **3s 内** 树反映变更，**无需** 点击空白区或切换面板。

- **Given** Desktop PreviewPane 编辑文件并保存成功  
  **When** 保存完成  
  **Then** Explorer 列表与文件内容一致（含纳入状态、排序等随写入变化的 meta）。

- **Given** 工作区重命名、删除、ZIP 导入、规则保存等操作成功  
  **When** 操作完成  
  **Then** Explorer 自动更新。

- **Given** Mobile 同场景 Agent write 且不切换面板  
  **When** 写盘完成  
  **Then** 行为仍符合 `worktree-vfs-ui-refresh-fix`（**无** Desktop 式即时刷新回归）。

### Bug 3 — 已删除文件 tab

- **Given** Preview 已打开 `ch1.md`  
  **When** Agent 或工作区操作删除该文件  
  **Then** `ch1.md` tab **仍保留**，标签呈斜体或删除态配色，与正常 tab 可区分。

- **Given** 上述删除态 tab 处于激活状态  
  **When** 用户查看编辑区  
  **Then** 显示明确提示：文件已删除或不存在（非与正常文件相同的外观）。

- **Given** 删除态 tab  
  **When** 用户点击 tab 关闭按钮  
  **Then** tab 正常关闭。

- **Given** 用户从 Explorer 删除某未在 Preview 打开的文件  
  **When** 删除成功  
  **Then** 无多余 tab；Explorer 条目移除。

## 约束与依赖

- 依赖 `desktop-app` 三栏壳、`ShellNavProvider.refreshWorkspaceTrees`、worktree / VFS IPC。
- 依赖 `mobile-ui-vfs-defaults` 中 Core 默认 `fillPolicy: header` 等合并语义；本批次不改 Core 评估公式，仅改 Desktop 建目录与弹窗展示。
- `desktop-ux-bug-fixes` Bug 3（Desktop write/edit 刷新）为本批次 Bug 2 的子集；本批次 **扩大** 为全量 VFS 变更刷新。
- `worktree-vfs-ui-refresh-fix` 消费方② `markDirty` 口径 **不变**。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| Bug 2 刷新频率 | 全量自动刷新可能增加 IPC 调用；需避免同一操作重复 bump 导致闪动（实现阶段控制，本 PRD 要求行为正确优先） |
| Bug 3 与关 tab 行为变更 | 现网工作区删除会关 tab；改为保留删除态 tab 后，用户习惯需适应 |
| 删除检测来源 | tab 删除态需能感知 VFS deleted / 路径不存在；实现阶段再定检测时机（刷新后 / 激活时） |
