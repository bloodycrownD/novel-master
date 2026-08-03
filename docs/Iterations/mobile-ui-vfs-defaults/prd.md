---
date: 2026-06-13
dependency:
  - Iterations/virtual-worktree/prd.md
  - Iterations/mobile-stability-db-migration/prd.md
---

# Mobile 按钮尺寸回归与 VFS 目录规则默认值 PRD

## 背景

### 1. Mobile 按钮视觉变大

会话列表顶栏「**管理**」「**新建会话**」使用 `ManageHeader` + `PrototypeButtons`（Secondary / Primary）。2026-06 提交 `064a061`（cloud-sync 收尾 UI）将全局原型按钮改为：

- `minHeight: 44`、padding 12×16、圆角 12、字号 15
- Secondary 改为白底 + 主色描边

此前（如 `476a908`）为紧凑样式：padding 8×14、圆角 8、字号 14；Secondary 为灰底、无边框。用户反馈当前按钮**明显偏大**，与记忆中「原来」不一致，需回归紧凑风格。

VFS 底部菜单（「新建目录」「目录规则」等）使用 `BottomSheetMenu`，行高长期为 `paddingVertical: 16`，**不在本次按钮回归范围**（用户确认仅恢复 `PrototypeButtons` 全局样式）。

### 2. VFS 目录规则默认值

Core `DEFAULT_WORKTREE_DIR_RULE` 当前为：

| 字段 | 现值 | 用户期望 |
|------|------|----------|
| `fillPolicy` | `hidden`（不展示） | **`header`（头信息）** |
| `ruleEnabled`（保存规则时） | 未显式关则 true | **保持默认开启**（已实现） |

Mobile 新建目录时会 `setDirRule(defaultDirRuleForm)`，`ruleEnabled` 已为 true，但 `fillPolicy` 仍继承 Core 默认 `hidden`，导致新建/首次保存规则后「其余文件填充」为不展示。用户希望 **Core 全局默认** 改为头信息，Mobile / CLI / Desktop 新建或合并规则时一致。

**说明**：未持久化目录规则的文件夹在 worktree 列表仍显示「规则·关」（Core 语义：须显式 `setDirRule` 后才为「规则·开」）。本迭代 **不** 批量改写已有「规则·关」目录，仅调整默认值与新建/保存时的合并语义。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 按钮视觉回归 | 全局 `PrimaryButton` / `SecondaryButton` 恢复紧凑尺寸（padding 8×14、圆角 8、字号 14）；Secondary 恢复灰底无边框 |
| 填充策略默认头信息 | Core `DEFAULT_WORKTREE_DIR_RULE.fillPolicy` = `header`；Mobile `defaultDirRuleForm` / `DirectoryRuleSheet` 初始值同步 |
| 规则保存仍默认开启 | `setDirRule` 未传 `ruleEnabled: false` 时仍为 `true`（行为不变） |
| 无功能回归 | 会话列表、Agent/Provider 等使用 Primary/Secondary 的页面布局正常；worktree 评估与真实提示词行为符合 virtual-worktree PRD |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile 日常用户 | 会话 Tab 顶栏操作区不再占用过多横向空间；按钮风格与早期版本一致 |
| 工作区写作用户 | 新建目录或打开「目录规则」Sheet 时，「其余文件填充」默认选中「头信息」 |
| 跨端用户 | CLI / Desktop 通过 Core 默认合并规则时，填充策略与 Mobile 一致 |

## 范围

### 包含范围

1. **PrototypeButtons 全局回归**：`apps/mobile/src/components/ui/PrototypeButtons.tsx` 恢复紧凑样式；保留 `fullWidth` 等现有 props（若有）。
2. **Core 默认填充策略**：`packages/core/src/domain/worktree/logic/default-dir-rule.ts` 中 `fillPolicy` 改为 `header`。
3. **测试与文档同步**：更新依赖 `DEFAULT_WORKTREE_DIR_RULE.fillPolicy` 的 Core / Mobile 单测断言；必要时更新 virtual-worktree 相关 spec 中的默认 `fill=hidden` 描述。

### 不包含范围

- `BottomSheetMenu`、SegmentedControl 等其他组件尺寸调整。
- 批量将已有「规则·关」目录改为「规则·开」（不迁移存量 worktree 行）。
- 修改 `headCount` / `tailCount` 默认（仍为 0 / 1000）。
- Desktop / CLI 独立 UI 改版（仅随 Core 默认变化）。
- iOS 专项验收（可 follow-up）。

## 核心需求

1. **全局 Primary/Secondary 按钮**恢复 pre-`064a061` 紧凑视觉（padding、圆角、字号、Secondary 底色/边框）。
2. **Core 全局默认** `fillPolicy: header`，作为 `setDirRule` 合并、`worktree-eval` 缺省填充策略的唯一来源。
3. **Mobile 目录规则表单**打开时，无已有规则或新建目录场景下，「其余文件填充」默认展示为「头信息」。
4. **规则启用语义不变**：仅保存/合并目录规则时默认 `ruleEnabled: true`；未保存规则的目录仍为「规则·关」。
5. **单测覆盖**：Core default-dir-rule、Mobile `defaultDirRuleForm` / fill-policy 相关测试更新并通过。

## 验收标准

### 按钮 UI

- **Given** Mobile 会话 Tab 会话列表  
  **When** 查看顶栏「管理」「新建会话」  
  **Then** 按钮高度与字号明显小于现网 `064a061` 后样式，与紧凑原型一致（padding 8×14、圆角 8、字号 14）；Secondary 为灰底、无描边。

- **Given** 使用 Primary/Secondary 的其它页面（如 Agent 编辑、Provider 表单等）  
  **When** 打开页面  
  **Then** 按钮均为同一紧凑样式，无布局错位或文字截断。

### 目录规则默认

- **Given** Core `DEFAULT_WORKTREE_DIR_RULE`  
  **When** 读取 `fillPolicy`  
  **Then** 值为 `header`。

- **Given** 会话工作区新建目录「测试目录」  
  **When** 创建成功并打开该目录「目录规则」Sheet  
  **Then** 「其余文件填充」默认选中 **头信息**；保存后列表该目录 badge 为 **开启**。

- **Given** 某目录从未保存过目录规则（列表 badge「关闭」）  
  **When** 仅浏览、不保存规则  
  **Then** 仍为「规则·关」（不自动迁移）。

- **Given** 在目录规则 Sheet 修改填充为头信息并保存  
  **When** 查看「真实提示词」或 worktree 评估  
  **Then** 自动纳入且未命中 head/tail 的文件按头信息策略展示（与 virtual-worktree PRD 一致）。
