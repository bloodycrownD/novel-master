---
date: 2026-08-11
dependency: mobile-desktop-optimization-2026-08/prd.md
---

# UI 优化 Feature PRD

> 父迭代：[Mobile/Desktop 体验优化与修复（2026-08）PRD](../../prd.md)
> 覆盖原问题 2、6、8：工具配置 picker 手机友好化、子会话「生成中」状态残留、服务商配置入口分散。

## 背景与变更动机

本次 mobile 深度测试暴露了三处独立但同源的体验问题——它们都不是功能 bug，而是「能用但别扭」的 UI 缺陷：

1. **工具配置 picker 裸奔**：手机端 `ToolPolicyPicker` 把搜索框和全量工具列表永远铺开，没有任何折叠态，点开一次就占满整屏还收不起来；勾选符号用的是 Unicode `☑/☐`，和表单里其他 `FormSelectField` 的「选中行高亮 + 右侧 ✓」样式完全不对齐。
2. **子会话「生成中」永久残留**：子会话的「生成中」状态完全依赖 `RUN_FINISHED`/`RUN_FAILED` 事件翻回 false。一旦这些事件因为 IPC 抖动、渲染进程重启或时序竞态丢失，文案就会永久卡在那里，用户只能退出再进才会重新 probe。
3. **服务商配置入口分散**：想编辑一个服务商的连接信息，得先长按/右键调出菜单点「编辑」进一个独立子页；而管理模型又是另一个入口。两个强相关操作被拆成两段导航，缺少整合。

父 PRD 已确认这三处都要在本迭代双端修复。本 Feature 把它们打包交付。

## 范围说明

| 项 | 说明 |
|----|------|
| **纳入** | ① Mobile `ToolPolicyPicker` 改 trigger + 底部 sheet 多选；Desktop `ToolPolicyPicker` 改可折叠（trigger + 弹层）。② Mobile `SubagentSessionScreen` 与 Desktop `ConversationPanel` 只读子面板的「生成中」状态加兜底。③ 双端服务商详情页 tab 化（服务商配置 + 模型管理），移除独立「编辑」菜单项 |
| **不改** | 工具目录本身（仍是 7 个内置工具）；`uiRunning` 的事件驱动主路径；服务商/模型的数据模型与 IPC；模型编辑（`ModelSampling`/`ModelSamplingView`）保持独立子页 |
| **不引入** | 新的表单组件库、新的状态管理方案；不做服务商/模型列表的性能优化 |

## 用户与场景

继承父 PRD 的「重度使用者」画像，本 Feature 聚焦三类具体场景：

- 在手机上配置智能体工具白名单——希望 picker 能收起，不要一展开就霸占整屏，勾选样式和其他下拉框一致
- 在长会话里派发子智能体——子智能体跑完后回到子会话面板，期望「生成中」文案已经消失，不用退出重进
- 配置服务商——希望在服务商详情页内就能在「改连接信息」和「管模型」之间一键切换，不用绕菜单

## 核心需求

### 需求 1：工具配置 picker sheet 化（手机友好）

- **N1.1** Mobile `ToolPolicyPicker` 拆成两部分：一个 trigger 行（Pressable，显示「白名单工具：N/7」+ ▼ 指示），点击后弹出底部 sheet
- **N1.2** sheet 内含搜索框 + 多选列表 + 确定/取消按钮；点击列表行只 toggle 选中态不关闭 sheet，点确定才把临时选择提交回父表单并关闭
- **N1.3** 复用 `FormOverlayHost` 的 overlay 机制和 `FormSelectField` 的 sheet 外壳（backdrop、safe area、取消按钮、行高亮 + ✓ 样式）；checkbox 对齐 `FormSelectField` 的选中态表达，废弃 `☑/☐` Unicode 字符
- **N1.4** Desktop `ToolPolicyPicker` 同步改造为可折叠形态（trigger + 弹层或 inline 折叠），样式对齐 desktop 现有的 Popover/Dialog 组件，不再永久 inline 常驻
- **N1.5** trigger 文案反映当前选择数量；全未选时显示「未选择」或占位文案，全选时显示「全部工具」

### 需求 2：子会话「生成中」状态兜底

- **N2.1** 在事件驱动主路径之外，为子会话的 `uiRunning` 增加状态校准机制，避免单一事件丢失导致永久残留
- **N2.2** 兜底手段至少包含其一（实现时择优或组合），且双端数据源不同：Desktop 用跨进程 IPC `ipcAgentRunIsActive({sessionId})`（主动查 main 进程真实 in-flight 状态）；Mobile 没有这个 IPC，用本进程的 `runtime.abortRegistry.has(sessionId)`（查 core 层 in-memory registry 注册状态）。两端都带复询一次防抖（mobile 尤其需要：若 run 被 main 主动结束、unregister 事件还没派发到 renderer，`has` 会短暂仍返回 true）。其他校准手段：窗口/页面重新可见时（`visibilitychange` 或 focus 事件）触发一次校准；step 事件超时 watchdog（长时间无新事件则主动查询）
- **N2.3** 兜底判定 run 已结束时要调用与正常 `RUN_FINISHED` 相同的收尾路径（`markExternalRunEnded` / `abort.markRunEnded` + reload），保证状态机一致
- **N2.4** 双端都要加：Desktop 在 `ConversationPanel` 的 readOnly 子面板分支，Mobile 在 `SubagentSessionScreen`

### 需求 3：服务商配置 tab 化

- **N3.1** 双端服务商详情页改为 tab 容器结构，左侧/第一个 tab 是「服务商配置」（编辑连接信息），右侧/第二个 tab 是「模型管理」（原模型列表）
- **N3.2** tab 头使用各端现有组件：Desktop 用 `SegmentedControl`（`apps/desktop/renderer/components/ui/SegmentedControl.tsx`，受控，当 tab 头）；Mobile 直接 import 现有的 `apps/mobile/src/components/ui/SegmentedControl.tsx`（受控，`options/value/onChange/tokens`），不要另造等价 tab 头
- **N3.3** 「服务商配置」tab 内嵌原编辑表单内容（Desktop `ProviderFormView` mode="edit"，Mobile 复用 `ProviderEdit` 的表单结构）
- **N3.4** 移除服务商列表页的「编辑」菜单项：Desktop 删 `ProvidersView` 右键 ContextMenu 的 `{ label: "编辑", action: "edit" }` 及 handler 分支；Mobile 删 `ProvidersScreen` 的 `BottomSheetMenu` 编辑项
- **N3.5** 废弃 Desktop `providerEdit` viewId（先全局 grep 确认无其他引用再删）；Mobile 若一并清理 `ProviderEdit` 路由，范围含 `navigation/types.ts`（删类型）、`navigation/header-config.ts`（删 L24 `PAGE_HEADER_CONFIG` 配置行）、`navigation/RootNavigator.tsx`（删 import + `Stack.Screen` 注册）、`__tests__/provider-edit-screen.test.tsx`（删整个测试文件）。若保留则上述文件不动，只在 `types.ts` 加废弃注释
- **N3.6** 模型编辑（`ModelSampling` Mobile / `ModelSamplingView` Desktop）保持独立子页 push，不塞进 tab

## 影响模块与接口

- `apps/mobile/src/components/agent/ToolPolicyPicker.tsx`、`AgentEditorForm.tsx`
- `apps/mobile/src/components/form/FormSelectField.tsx`（参考实现，可能抽取共用 sheet 外壳）、`FormOverlayHost.tsx`
- `apps/desktop/renderer/features/settings/ToolPolicyPicker.tsx`
- `apps/mobile/src/screens/stack/SubagentSessionScreen.tsx`、`apps/mobile/src/hooks/useStreamTailGenerating.ts`
- `apps/desktop/renderer/features/chat/ConversationPanel.tsx`（readOnly 分支）、`MessageList.tsx`（「生成中」渲染）
- `apps/mobile/src/screens/stack/ProvidersScreen.tsx`、`ProviderDetailScreen.tsx`、`apps/mobile/src/navigation/types.ts`、`header-config.ts`、`RootNavigator.tsx`（若删 `ProviderEdit` 路由）
- `apps/desktop/renderer/features/settings/SettingsViews.tsx`（`ProvidersView`、`ProviderDetailView`、`ProviderFormView`）、`settings-nav.ts`
- 双端对应单测

## 验收标准

### 工具配置 picker

1. Mobile：智能体编辑表单里，工具模式非 default 时显示一行 trigger（如「白名单工具：3/7 ▼」），点击展开底部 sheet
2. Mobile：sheet 内可搜索、可多选；点行只 toggle 不关闭；点确定提交选择并关闭，点取消/点 backdrop 丢弃临时选择并关闭
3. Mobile：sheet 行的选中态表达（行背景 + 右侧 ✓）与同表单 `FormSelectField` 一致，不再出现 `☑/☐` 字符
4. Desktop：picker 可折叠，展开形态与 desktop 其他弹层（Popover/Dialog）样式一致，不再永久 inline 常驻
5. 双端：trigger 文案正确反映当前选择数量（0 条、部分、全部）

### 「生成中」兜底

6. Mobile/Desktop：子会话 run 正常结束（`RUN_FINISHED`）时「生成中」消失——主路径不回归
7. Mobile/Desktop：模拟 `RUN_FINISHED` 事件丢失的场景（如断开事件订阅再恢复），兜底机制能在合理时间内（轮询周期或 visibility 触发后）让「生成中」消失
8. 兜底触发 run 结束时，调用的收尾路径与正常事件一致（reload 触发、状态机复位），不会留下半同步状态

### 服务商 tab 化

9. Mobile/Desktop：进入服务商详情页，顶部可见两个 tab（「服务商配置」「模型管理」），默认进入哪个 tab 不强求（实现定，文档标注）
10. 「服务商配置」tab 内可编辑 protocol/baseUrl/displayName/apiKey/headers 并保存，行为等同原独立编辑页
11. 「模型管理」tab 内是原模型列表，添加/远程/重命名/删除/进入采样配置等操作全部保留
12. 服务商列表页（`ProvidersScreen` / `ProvidersView`）的菜单不再有「编辑」项；点服务商卡片直接进入 tab 化详情页
13. 进入模型采样配置仍是独立子页 push（Mobile `navigation.navigate('ModelSampling')`，Desktop `nav.push` 对应 viewId），不塞进 tab
14. Desktop `providerEdit` viewId 若无其他引用则已删除；若有遗留引用则 documented

### 通用

15. Mobile/Desktop 在受影响功能上行为一致（双端对照）
16. 现有自动化测试无回归

## 测试用例（PRD 级，详见 spec.md）

| ID | Given / When / Then |
|----|---------------------|
| T-P1 | Mobile 智能体编辑 → 工具模式选白名单 → trigger 显示「N/7」→ 点开 sheet → 勾选两个 → 确定 → trigger 文案更新 |
| T-P2 | sheet 展开时点列表行 → 选中态 toggle 但 sheet 不关；点取消 → 临时选择丢弃，trigger 文案不变 |
| T-P3 | sheet 选中行样式 = 行背景高亮 + 右侧 ✓；无 `☑/☐` 字符 |
| T-P4 | Desktop picker 折叠态可见，展开为弹层，收起后不占表单空间 |
| T-G1 | 子会话 run 正常结束 → 「生成中」消失（主路径回归） |
| T-G2-mobile | Mobile 模拟 `RUN_FINISHED` 丢失（mock `runtime.abortRegistry.has` 返回 false + 不派发事件）→ 兜底触发 → 「生成中」在轮询周期/visibility 触发后消失 |
| T-G2-desktop | Desktop 模拟 `RUN_FINISHED` 丢失（mock `ipcAgentRunIsActive` 返回 false + 不派发事件）→ 兜底触发 → 「生成中」在轮询周期/visibility 触发后消失 |
| T-G3 | 兜底结束时 reload 被触发，状态机与正常事件结束一致 |
| T-T1 | 服务商详情页顶部有两个 tab，可切换 |
| T-T2 | 「服务商配置」tab 改 apiKey 并保存 → 重新进入仍为新值 |
| T-T3 | 「模型管理」tab 添加/删除模型行为同改造前 |
| T-T4 | 服务商列表菜单无「编辑」项；点卡片进 tab 化详情页 |
| T-T5 | 模型采样配置仍走独立子页（Mobile navigate ModelSampling / Desktop push） |

## 风险与待确认项

- **Desktop picker 形态选择**：Popover 还是 Dialog 还是 inline 折叠，实现时按 desktop 现有组件惯例定；若 desktop 表单库已有可复用容器优先复用
- **兜底轮询周期**：太短浪费 IPC 往返，太长残留体感差。建议 visibility 触发为主、低频轮询（如 30s）为辅；具体值在 spec 标注
- **兜底误判 run 结束（mobile 尤甚）**：mobile `runtime.abortRegistry.has` 只反映 registry 注册状态，若 run 被 main 主动结束、unregister 事件还没到 renderer，`has` 会短暂仍返回 true。两端都要复询一次防抖——第一次查到 false 后短延迟（建议 500ms~1s）再查一次仍 false 才走收尾；desktop 的跨进程 IPC `ipcAgentRunIsActive` 同样沿用 `ConversationPanel.tsx:496-503` mount probe 的复询策略
- **Mobile `ProviderEdit` 路由是否一并删除**：取决于 grep 是否还有其他入口。若删，范围含 `types.ts` + `header-config.ts` + `RootNavigator.tsx` + `provider-edit-screen.test.tsx`，牵涉面比原先预估的大；保留死路由不影响功能但留债务
- **Desktop `providerEdit` 废弃后的导航回退**：原 `ProviderFormView` create 完成会 `nav.push("providerDetail")`，edit 完成也是；tab 化后 edit 不再独立入口，需确认 create 流程仍能正确落到详情页的「服务商配置」tab

## 依赖与约束

- 依赖父迭代 `mobile-desktop-optimization-2026-08/prd.md` 的总纲约束（双端一致、对照修复）
- 不依赖同迭代其他 feature（A/B/D）的产物；本 feature 三项互不阻塞，可并行实现
- 约束：不动 core 层数据模型与 IPC 协议；不引入新依赖
