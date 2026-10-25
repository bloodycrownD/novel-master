---
date: 2026-10-17
dependency: []
---

# mobile 输入框联想浮层移除 × 文件预览暗色白闪修复 PRD

## 需求来源

用户口述（2026-10-17 brain-storm 会话，三轮 readonly 调研定位；记忆 `docs/apm/memory/20261017-mobile-ux-brain-storm.md`）。无前置 PRD。

## 背景与问题

1. **composer 联想浮层（typeahead）**：聊天输入框与全屏编辑屏打 `@`/`$` 触发的联想浮层。手输引用已无视觉支持（胶囊确认制，2026-10-07 拍板），浮层存在感突兀且有害：从引用按钮 → picker 选完 skill、胶囊已插入后，浮层仍会弹出（2026-07 已修 bug 在 native 链路复发：库原生 md4c 剥段尾空格 + 原生钳光标 → `findActiveAtQuery` 字面判定命中，列出刚插入的那条）；浮层无任何关闭手段（无关闭按钮、返回键不拦、点外不关）。
2. **文件预览白闪**：暗色模式进文件预览（rich-document WebView），冷挂载先露 Android WebView 原生白底（组件无 style 底色），页面 CSS `var(--bg, #fff)` 兜底白直到 ready→init→applyHostTheme 主题注入完成——「闪光灯」式先白后黑突变。预览屏随进随建（`key={path}`），每次进屏全付。

## 用户拍板（2026-10-17）

- typeahead 联想浮层**整体移除**：聊天主输入框 + 全屏编辑屏（PromptEditorScreen）一并。
- 白闪修复走 **A+B 组合**：WebView style 主题底色（堵原生白窗）+ `injectedJavaScriptBeforeContentLoaded` 预注入 `--bg`（堵 CSS 白窗）。
- 2026-10-18 增补拍板：A+B 真机仍闪（根因 B 输给首绘的 CSS 兜底白帧），白闪修复升级为 C′（head 内联 bootstrap + URI 参数）+ E（ready 前遮罩层）组合。
- 2026-10-18 二轮取证拍板（fix-D）：白闪定性为 chat-transcript 宿主 webview 冷挂载白窗（C′+E 未覆盖该链）；C′ 统一至 chat-transcript / code-editor（E 仅 rich-document 保留），参数形态改 `#bg=` hash 以规避 file:// query 被丢。
- 2026-10-18 三轮取证拍板（fix-E）：md 预览进/退残余「一帧」白闪定性为 native-stack 转场 alpha 混合底（ScreenStack 容器透明→窗口 DayNight 浅色）；修法为容器外衬主题色底 + nav 主题对齐 + 屏根底色（JS-only，不涉 webview/gradle）。

## 范围

- 移除：主输入框 typeahead 全链（浮层 JSX / typeahead-view.ts / controller 候选源与 state / Bridge 类型 / dock 样式 / 测试）、全屏编辑屏 typeahead 全链（AtPathTypeahead / SkillTypeahead / TypeaheadList 三组件 / 候选源 effect / 浮层 JSX / 测试）、`skill-typeahead-filter.ts`（两链为唯一消费方，同批整删）。
- 修复：`RichDocumentWebView` 两处 prop（A+B）；`CodeEditorWebView` 同构对齐（建议项，spec 独立 Step）。
- **保留红线**：`@`/`$` 引用按钮与 FileReferencePicker/SkillPicker（用户现行工作流）；core 纯函数 `composer-at-path`（桌面端与 Picker 共用）；`insertSkillToken`/`insertTokensIntoComposer`/`buildTokenInsertion` 插入链；PromptEditorScreen 的 `onSelectionChange`/`cursor` 逻辑（Picker 落点依赖）。

## 非目标

- Picker 内部体验改造；「插入后尾空格在原生 buffer 不存活」次级症状（react-native-enriched-markdown 库层问题，另案）；退出预览返回白闪（chat-webview-unify cr2-G-1，另一条链）；桌面端任何改动；发送时 core 对手输 `@`/`$` 的附件扫描行为（数据面不动）。
