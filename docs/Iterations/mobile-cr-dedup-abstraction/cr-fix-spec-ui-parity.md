# CR Fix Spec: mobile 组件收敛 UI 行为等价性（第二轮专项）

## 元信息

- repo: novel-master，base 4ba1c73 → head 19fc6eb（main）
- 模式：scope ×3（modal-shell 调用方 / class 派生契约 / 迁移组件比对）+ 用户独立评审交叉核对
- review_round: 1（本轮）
- 状态：已执行（全部条目闭合；P2-6 拍板「接受统一」不改代码）

背景：组件收敛 CR 后连续暴露 UI 回归（折叠头 class、ModalShell left、VfsPromptModal 宽度，均已修）。
本轮专项聚焦「迁移组件的样式行为等价性」，手法为旧实现 vs 新实现样式键逐项比对。
**教训**：子代理 scope1 曾把 P0-1 误判为「微调无影响」——间距比对必须逐段（title→label / input→actions）进行，不能只看综合密度。

## Must-fix（按 P0 → P1 → P2）

### P0-1 [P0] TextPromptModal center 变体标题下间距塌陷为 0

- 维度：C（UI 行为等价）
- 文件：`apps/mobile/src/components/ui/TextPromptModal.tsx`
- 问题：旧居中版 `title` 有 `marginBottom: 12`；新版 `title` 无 marginBottom 且 `panelCenter` 无 gap（`gap: 8` 只在 `panelBottom`），标题与首个 label（或无 label 时的输入框）贴死。
- 改法：title 拆变体样式——`titleCenter: {fontSize:18, fontWeight:'600', textAlign:'center', marginBottom:12}`，bottom 维持现样式（bottom 已靠 panel gap 8 还原旧的 marginBottom: 8，不能再加）。**不要**给 panelCenter 加 gap（否则 actions 与输入框间距叠成 20）。
- 验收/测试：源码契约测试断言 titleCenter 含 marginBottom:12 且 panelCenter 不含 gap；bottom 的 title 无 marginBottom。真机：新建正则分组弹窗标题与输入框间距 12。
- 来源：用户评审 migrated-comp/1（scope1 漏报，已亲自核实旧值）

### P2-1 [P2] TextPromptModal bottom 变体 actions 区间距 16→24

- 维度：C
- 文件：同上
- 问题：旧 AddModelModal input→actions 为 16（mb 0 + mt 16）；新版三层叠加（input mb 8 + panel gap 8 + actions mt 8 = 24）。
- 改法：`actions` 拆变体——bottom 用 `marginTop: 0`（8+8=16 还原），center 维持 8（input mb 8 + 8 = 16 不变）。
- 验收：bottom 弹窗（添加模型）输入框底沿到按钮区顶沿 16；契约测试断言变体样式值。
- 来源：用户评审 migrated-comp/4（已核实）

### P2-2 [P2] AnnotatePickModal 遮罩不透明度 0.45→0.4

- 维度：C
- 文件：`apps/mobile/src/components/vfs/AnnotatePickModal.tsx`
- 问题：旧实现遮罩 `rgba(0,0,0,0.45)`，新版未传 `backdropOpacity` 落到 ModalShell 默认 0.4。
- 改法：ModalShell 调用处补 `backdropOpacity={0.45}`。
- 验收：契约测试断言该文件含 `backdropOpacity={0.45}`。
- 来源：用户评审 migrated-comp/3 + scope1 modal-shell/1 双向确认

### P2-3 [P2] VfsPromptModal iOS 键盘避让多上移 24px

- 维度：C
- 文件：`apps/mobile/src/components/vfs/vfs-file-manager/VfsPromptModal.tsx`
- 问题：旧内联实现 KAV 未传 `keyboardVerticalOffset`（默认 0），新版传 24（疑似从 TextPromptModal 复制——后者旧版确有 24）。
- 改法：删除 `keyboardVerticalOffset={24}` 回到默认 0。【已拍板：还原 0，已执行】
- 验收：iOS 弹键盘时弹窗上沿与 4ba1c73 持平；契约断言。
- 来源：scope1 modal-shell/2

### P2-4 [P2] SkillPicker 面板视觉系统性变化（待拍板）

- 维度：C
- 文件：`apps/mobile/src/components/skills/SkillPicker.tsx`（+ `ui/PickerListModal.tsx`）
- 问题：收敛到 PickerListModal 后：maxHeight 80%→70%、圆角 16→12、标题左对齐 mb4→居中 mb8、list maxHeight 360 上限取消、取消按钮色 `tokens.text`→`textSecondary`、footBtn(16/10, r8)→cancelBtn pt12。
- 改法（已拍板：方案 A 还原旧观感，已执行）：
  - PickerListModal 新增 `sheetStyle`（叠加在默认 sheet 后）与 `cancelColor`（默认 textSecondary）两个可选 prop；SkillPicker 传 `sheetStyle={styles.sheetOverride}`（maxHeight 80%、圆角 16）+ `cancelColor={tokens.text}`。
- 验收：按拍板值断言圆角/高度策略；已关闭技能行 opacity 0.55 仍生效。
- 来源：用户评审 migrated-comp/2（已核实旧值）

### P2-5 [P2] EditorScreenShell 统一了旧屏不一致的标题样式（待拍板）

- 维度：C
- 文件：`apps/mobile/src/components/chrome/EditorScreenShell.tsx`（调用方 FileEditorScreen / PromptEditorScreen）
- 问题：旧 FileEditor 屏 toolbar 文字默认 14 号（无显式 fontSize），新 shell 统一 13（沿用旧 PromptEditor 值）。
- 改法（已拍板：方案 A 还原，已执行）：shell 加 `titleFontSize?: number`（默认 13），FileEditorScreen 传 14。
- 验收：按拍板断言两屏标题 fontSize。
- 来源：用户评审 migrated-comp/5 + scope3 migrated-comp/2 交叉

### P2-6 [P2] ElevatedCard 未选中态新增 hairline 边框（待拍板）

- 维度：C
- 文件：`apps/mobile/src/components/ui/ElevatedCard.tsx`（影响 AgentList 会话卡、ConfigListCard）
- 问题：旧 `styles.card` 只设 borderColor 不设 borderWidth（边框实际不渲染）；新版 `cardRow` 统一带 `borderWidth: hairlineWidth`，未选中态显示细边。
- 改法（已拍板：接受统一，不改代码；观感变化记录在案）。
- 验收：flatten 后 borderWidth 按拍板断言。
- 来源：scope3 migrated-comp/1

## Spec deviations

- none（本轮全部为样式等价性发现，不涉及业务 spec）

## Open questions / 待拍板

（本轮拍板完毕，遗留项如下）
1. scope3 遗留：TextPromptModal bottom 变体 label 间距 mt4→mb6、输入框圆角 8→10 + 新增背景色（收敛意图，已拍板接受不改）
2. scope2 遗留：ToolCallRow.status 类型收窄（后续重构项）；发版前建议重跑一次 build-webview 确认 dist 与单源同步

## 已豁免（用户确认不修）

- （无）

## 合并后 QA（manual_user）

- P0-1 修复后真机过一遍 center 弹窗（正则分组新建、会话重命名、添加模型 bottom 版）标题/输入/按钮三段间距
- SkillPicker 按拍板结果真机确认 maxHeight 与圆角

## K 节建议（下游执行时闭合）

- 契约测试统一放 `apps/mobile/__tests__/`，沿用源码契约手法（readFileSync + regex）
