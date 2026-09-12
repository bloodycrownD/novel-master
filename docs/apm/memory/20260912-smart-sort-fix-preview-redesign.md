---
date: 2026-09-12 22:21
title: 智能排序验收反馈重构：正则测试预览 + description + 撤全屏编辑 + PromptEditor 键盘避让（fix-preview-redesign）
keywords: smart-sort, matchSmartSortPattern, description, rename migration, bundle v2, 自适应输入, 键盘避让, PromptEditorScreen, 高亮渲染
abstract: 用户真机验收两轮反馈：首轮五项（PromptEditor 补键盘避让、测试预览改按钮触发的正则匹配测试、formatPatternInput 始终 /pattern/flags、example 改 description、mobile 撤正则全屏编辑）；二轮两项（描述字段改自适应多行、测试结果改高亮渲染+匹配计数，core matches 加 index 偏移）。全部完成，11 commit。
---

user: 五项验收反馈：① agent 的 PromptEditorScreen 也补键盘避让；② 测试预览重新设计——排序测试作用不大，改成正则匹配测试（输入一段文本，点「测试」按钮后显示匹配内容），当前实时渲染性能糟糕，必须按钮手动触发；③ 正则回显统一始终显示 /pattern/flags（flags 空也 /pattern/；裸输入解析兼容不变）；④ 规则 example 字段改 description，内置规则值从示例文件名改为描述文字；⑤ mobile 正则撤全屏编辑，改自适应高度多行输入（正则没那么长）；desktop 已是 textarea 不动。

assistant: 已完成（8 commit：71392749 core format / 1aeaef21 core match / dcf7b50a core description+迁移 / c48cee1b CLI / 519a5f31 mobile / eeaa5582 desktop / 88f4767f spec / 63475cd6 PromptEditor 避让）：

1. **②正则匹配测试**：core 新纯函数 `matchSmartSortPattern(pattern, flags, text)`（domain/smart-sort-rule/logic/match-smart-sort-pattern.ts）：非法正则不 throw 返回 `{ok:false,error}`；非 global flags 克隆加 g 后 matchAll 找全部匹配（lastIndex 不外泄、重复调用互不污染）；捕获组逐组返回、未参与匹配的可选组为 null（GUI 渲染 '-'）。desktop IPC 通道 `nm:sort-rule/preview` 更名 `nm:sort-rule/match`（SMART_SORT_RULE_MATCH），Request 改 {pattern,flags,text}，handler 直调 core（不经 runtime），非法正则是 ok:false 测试结果而非 IPC 错误；renderer 删实时联动（composePreviewDraftRules/autoRunRef 整体移除），textarea+「测试」按钮手动触发。mobile 删 useEffect 实时联动，直调 core matchSmartSortPattern（import 即用，无需走 runtime 服务），输入变化清结果区。

2. **④example→description**：canonical DDL 改列名（新库直接 description）；新迁移 `rename-smart-sort-rule-example-v1`（SCHEMA_MIGRATIONS 阵尾）：PRAGMA table_info 探测（有 example 无 description 才跑）→ ALTER TABLE RENAME COLUMN → builtin-% 行刷出厂描述（迁移内联历史快照值，不 import seed 常量防漂移；用户行值原样保留）。走 pending migration 通道、**SCHEMA_BOOT_VERSION 不 bump**（快路径也执行 pending migration，不受快路径短路——与 v9/v10 ALIGN 快路径事故机理不同）。bundle schemaVersion 1→2，decode 前置 migrateBundleV1Raw 兼容旧 example 字段（schemaVersion===1 且 rules 数组才搬运，description 优先）。CLI --example 改 --description（直接改名不留别名；list TSV 本就不含该列）。

3. **③回显统一**：formatPatternInput 始终 `/pattern/flags`（空 flags 为 `/pattern/`）；parsePatternInput 未动，round-trip 单测同步。

4. **⑤撤全屏编辑**：删 PatternFullscreenEditorScreen/pattern-editor-callback/__tests__ 与 PatternEditor 路由三处注册（types/RootNavigator/header-config）——上一轮（20260912-smart-sort-pattern-literal-fullscreen）的全屏编辑被本轮推翻。自适应高度：仓库无 TextInput auto-grow 先例（仅 MessageList 用 onContentSizeChange 做滚动），用局部实现——multiline FormTextInput + onContentSizeChange 记录内容高，`min( max(h+24, 46), 170 )` 封顶约 7 行、超出内部滚动。

5. **①PromptEditor 避让**：照 5555455c（正则全屏编辑避让，真机已验收）同款范式 A：EditorScreenShell 外再包 iOS keyboard-controller KeyboardAvoidingView padding / Android AndroidKeyboardClipBody 裁切收缩，仅编辑态包裹（预览态无键盘直铺）。注意 EditorScreenShell 内部本有三分支键盘处理，但真机实测不生效（RN 0.85 + targetSdk 36 edge-to-edge 下 Manifest adjustResize 不可靠），外层再包一层是用户验收过的有效写法——同构问题照抄即可，别信 shell 内建就够。SmartSortRuleEditorScreen 表单避让由 ScreenFormLayout 内建覆盖（ScrollView+keyboardShouldPersistTaps+Android 裁切），无需另补。

6. **验证**：core npm test 2047 全绿 + build（dist 重建后 mobile 才能过 typecheck/jest——fixture 经 dist 建库，src/dist 列名不一致会炸 no such column）；mobile typecheck + NODE_ENV=test jest 188 套件/1147 用例全绿；desktop typecheck + NODE_ENV=development test 125 全绿；CLI build + e2e 4/4 + 临时存量库冒烟（v13 example 形态 → migration run 日志 → list 正常 → 用户行值保留、builtin 描述刷新、export schemaVersion:2）。冒烟坑：模拟 v13 库跑完整 bootstrap 会因缺全套表在前序迁移/seed 上炸（kkv_entry/llm_provider），最小化模拟要么预登记前序迁移 applied（快路径场景）、要么 user_version=0 走慢路径让 DDL 建全套表；shell 通配 --db /tmp/dir* 会匹配到旧冒烟库误导判断。

spec 已补 5 处【重构注 2026-09-12】（Step 10/11/13、附录 A、内置规则表）：正则测试替代排序测试、description 替代 example、全屏编辑撤改自适应、formatPatternInput 始终字面量、CLI previewSort（`sort-rule test`）保留不变。

user: 二次真机验收两项反馈：① 规则编辑屏「描述」字段单行看不全，改自适应多行；② 测试预览结果显示改高亮渲染——测试文本里的匹配部分变色（不再是『"文本" [组1,组2]』字符串+数组清单），下方给「共 N 处匹配」计数；非法正则显示错误。

assistant: 已完成（fix-desc-and-highlight，3 commit：82d49964 core index / d68160d4 mobile+desktop / 213a5cd5 spec）：

1. **core**：`matchSmartSortPattern` 的 `SmartSortPatternMatch` 每项新增 `index: number`（matchAll 原生 m.index，原文起始偏移）——双端高亮切分需要偏移，重复匹配文本下 indexOf 回查会错位；零宽匹配 index 仍在、text 空串（GUI 切分跳过空段、cursor 不后移）。无新导出（SmartSortPatternMatch 本就在 public allowlist），单测补重复文本/多行偏移断言 + 零宽 index 严格递增断言。

2. **mobile**：描述字段抽屏幕内小组件 `AutoGrowMultilineInput`（TextInputProps & {tokens, minHeight, maxHeight}）与正则字段共用 auto-grow（onContentSizeChange + min/max 高度），描述封顶 120（正则 170）；结果区改高亮：`splitHighlightSegments(text, matches)` 按偏移切普通段/匹配段，嵌套 Text 继承 monospace、匹配段 tokens.primary 变色，底部 resultCount 行「共 N 处匹配」（0 处显「无匹配」），删 formatMatchLine 清单渲染。

3. **desktop**：描述 input 改 textarea rows=3；ipc-types `SmartSortRuleMatchDto` 同步加 index（IPC handler 直调 core 自动透传，handler 无改动）；结果区 pre 内按偏移切分 JSX，匹配段 inline `color: var(--primary)`，计数行 var(--text-secondary)，settings-preview-box 容器沿用。

4. 验证：core 2048 全绿 + build；mobile typecheck + NODE_ENV=test jest 188 套件/1147 用例全绿；desktop typecheck + NODE_ENV=development test 125 全绿；CLI sort-rule-e2e 4/4。spec Step 11/13 追加【重构注 2026-09-12 二次】。
