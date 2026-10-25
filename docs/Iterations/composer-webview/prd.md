---
date: 2026-09-29
dependency: ['../composer-overlay/prd.md']
---

# 移动端输入框 WebView 化 PRD

## 需求来源

用户口述（2026-09-29 真机轮拍板 + 同日补充），承接 `composer-overlay` 迭代的方向变更。前置背景见 `../composer-overlay/cache/context-bundle.md` 与 `docs/apm/memory/20260827-brain-storm-ui-three-issues.md` 末轮。

composer-overlay（feat/composer-overlay @ 5dfbf87f，未合入 main）已根治打字闪与回车闪，但真机遗留**滚动输入时高亮层与文字肉眼分层**——透明双层（JS 文字树 + 原生 EditText）跨引擎滚动同步慢一拍是该架构的固有物理上限，继续打补丁无收益。用户提议、分析支持：改用 **WebView 内单引擎输入框**（透明 textarea + HTML 高亮层，桌面 `renderComposerAtPathHighlightHtml` 同构），打字闪/回车闪/滚动分层同一病根（双引擎同步）一次全消。

**基线拍板（用户，2026-09-29 第三轮）**：新分支基于 **main 已发布实现**（v1.5.26）拉出——overlay 是未修好的中间态、其组件实现将被整体替换，不合入不继承；仅从中 cherry-pick 纯函数资产（token 切分/原子删等）。回滚锚点即 main 本身：webview 方案不合入，main 保持已发布现状。

用户补充约束（一）：**低版本与高版本安卓对输入框顶起键盘的支持必须兼顾**——高版本安卓（Android 15+ / targetSdk 36 强制 edge-to-edge）曾出现输入框无法顶起键盘的问题，现有代码已有特殊处理（react-native-keyboard-controller insets 动画范式），WebView 方案不得破坏该链路。

用户补充需求（二，同日第二轮）：**chat 输入框加全屏编辑入口**（⛶ icon，交互参照智能体配置的 ExpandablePromptInput/PromptEditorScreen）——内联输入框高度有限，输入一多不方便。**宏输入 `PromptMacroTextInput` 一并 WebView 化**（组件复用，不分期）。

## 目标

1. **根治滚动分层**：快速/惯性滚动输入时高亮与文字零错位（单引擎同帧重排）。
2. **不回归已修问题**：打字零闪烁、回车高度变化零闪烁（composer-overlay 已达成，WebView 方案须保持）。
3. **对外契约零变更**：`ComposerAtPathInput` 与 `PromptMacroTextInput` 的 props 面不变（value/onChangeText 恒 plain、`replaceCommittedText`、`editable`/`disabled` 只读态、`pendingSelection ?? selection` 合并语义、onSelectionChange 事件形状、样式口径）——**禁用行为保持现网语义**（chat 链 running/无模型/末条纯文本时输入框只读、宏链只读详情 chip 禁点灰显）；消费方（ChatComposer/ExpandablePromptInput/DynamicBlocksCard/PromptLayoutSection）无感。
4. **键盘链路兼容高低版本安卓**：Android 15+（edge-to-edge 强制，adjustResize 不可靠，依赖 keyboard-controller insets 动画）与 Android 15 以下（adjustResize 原生收缩 + insets 动画双轨并存）行为均正确，不新增按 API level 的分支。
5. **chat 全屏编辑**：输入框工具栏提供 ⛶ 入口，进全屏编辑屏（保留 token 高亮），保存回填草稿、取消丢弃、未保存退出拦截——交互对齐智能体配置全屏编辑的心智。

## 范围

- chat 输入链（`ComposerAtPathInput`）WebView 化。
- 宏输入链（`PromptMacroTextInput`）WebView 化——与 chat 链复用同一 WebView 宿主组件与 webview 包（高亮分段来源注入：token 正则 / 宏白名单）。
- chat 全屏编辑屏（新增）。
- 不动：宏链既有全屏编辑（ExpandablePromptInput 的 ⛶ → PromptEditorScreen，其编辑器是 CodeEditorWebView，与本迭代正交）。

## 验收（GWT）

- A1 打字不闪：逐字符输入，帧差口径与 composer-overlay A1 等价（每输入命令恰好一帧干净变化、0 孤立跳变帧）。
- A2 手输即时高亮 / A3 原子删胶囊 / A4 技能引用 / A5 水化恢复 / A6 发送清空：行为与 composer-overlay 验收口径一致。
- A7 回车高度变化不闪（composer-overlay 真机已修场景，不得回归）。
- A8 **滚动分层消除（主验收）**：长文本顶到 maxHeight 后快速滚动 + 输入，高亮胶囊与文字零肉眼错位（录屏慢放逐帧检查）。
- A9 键盘链路（高版本安卓，Android 15+，模拟器；真机复核在开发完成后）：聚焦弹键盘、容器正确顶起、内容不被顶出可视区（对照社区 issue react-native-webview#3848 症状专项检查）、光标始终可见、收起回落正常。
- A10 键盘链路（低版本安卓模拟器，Android 15 以下）：同 A9 且无双重抬升/回落跳动。
- A11 IME 组合态：中文拼音组合输入不丢字、组合期间不被程序化打断（jest 序列守护；真机观察在开发完成后）。
- A12 宏链不回归：宏高亮（白名单/未闭合不高亮）、原子删整段删宏、chips 插入光标落位、长文挂载置顶（ExpandablePromptInput selection={0,0} 一拍）、maxHeight 176 限高内滚、表单外壳样式与现版一致。
- A13 chat 全屏编辑：工具栏 ⛶ 进入全屏（token 高亮保留）、编辑、保存回填内联框与草稿、系统返回未保存时拦截确认丢弃（取消路径）、键盘顶起正常（Android ClipBody / iOS KAV 照 FileEditorScreen）。

## 风险项（PRD 层）

- 软键盘链路是唯一大未知（社区 issue #3848/#1172 佐证），必须 spike 前置验证，失败则不合入——main 保持已发布现状（退路：胶囊-only overlay / 降级纯色字留作 overlay 分支上的备选实验）。
- **表单页多 WebView 实例**：agent 配置页可同屏出现多个宏输入字段（动态块数量用户可增），每个是独立 WebView 实例——内存与滚动流畅度需实测；不可接受则宏链退回现实现（壳组件 props 面不变，仅内部实现回退）。
- `box-decoration-break: clone` 需 Chromium 130+，旧 WebView 跨行胶囊降级为断口（纯视觉，接受度待真机评估）。
