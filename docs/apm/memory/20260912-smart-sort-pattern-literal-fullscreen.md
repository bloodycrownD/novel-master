---
date: 2026-09-12 21:25
title: 智能排序正则输入字面量风格 + mobile 全屏编辑（fix-pattern-input-fullscreen）
keywords: smart-sort, parsePatternInput, formatPatternInput, 字面量, flags, 全屏编辑, PatternEditor
abstract: 用户拍板正则输入支持 /pattern/flags 字面量风格并删除双端 flags 四选 chips；core 落纯函数单源，mobile 照 agent 配置 PromptEditorScreen 先例加全屏编辑，desktop 只接入解析不加全屏。
---

user: 智能排序规则编辑屏的正则输入要支持全屏输入（正则可能复杂，mobile 参考 agent 配置的全屏编辑先例实现）；正则输入框支持 `/pattern/flags` 字面量风格（如 `/第(\d+)章/i`）自动拆分 pattern 与 flags——flags 可视化预设（四选 chips）双端删除；不带 `//` 的裸输入照旧当纯 pattern（flags 空）。CLI 不动（--pattern/--flags 显式两参）。desktop 是否加全屏编辑先看 agent 配置在 desktop 有无全屏先例，有就照抄，没有就不加。

assistant: 已完成（4 commit：08fab0e3 core / eb4729b4 mobile / b53f2ac2 desktop / 1ecfe0b0 spec）：

1. **agent 全屏输入先例**：mobile 的 `PromptEditorScreen`（apps/mobile/src/screens/stack/）+ `prompt-editor-callback.ts` 模块级回调存取（路由参数须可序列化，回调不走路由：push 前写入、挂载时读走即清）。mobile 新屏 `PatternFullscreenEditorScreen` 完全照抄该模式（跳转 push / 参数 initialText+title / 回调存取 / useUnsavedGuard 拦截 / 保存回填+toast 停留当前页），编辑器复用 CodeEditorWebView 伪路径 `pattern.txt`；导航注册 types/RootNavigator/header-config 三处。desktop 的 agent 表单（AgentDefinitionEditorForm）只有 rows=4 textarea、无全屏先例 → 按拍板不加。

2. **parsePatternInput 边界语义**（core domain/smart-sort-rule/logic/parse-pattern-input.ts）：仅 `/` 开头才按字面量解析；闭合定界符取**最右未转义** `/`（`\/` 对留在 body 内）；尾段 flags 须 gimsuy 子集且不重复（与 assertFlagsValid 同口径）；body 非空、不含未转义 `/`。任一不满足整串当裸 pattern（`/x/q`、`//`、`/a/b/i`、`/x/ii`、`/x` 未闭合、尾空白都走裸降级）。formatPatternInput：flags 空裸回显，非空拼 `/pattern/flags` 且 body 内未转义 `/` 补 `\/`（保证回显 round-trip；未转义形态会规范化为转义形态，语义等价）。

3. **双端接入**：draft 加 patternInput 原始文本字段，onChange 即时 parse 同步 pattern/flags，预览/保存消费解析值，保存前以 trim 后输入重解析（防尾空白拆字面量）；回显 formatPatternInput。mobile 删 FLAG_PRESETS chips+样式、hint 改「支持 /正则/flags 格式，如 /第(\d+)章/i」、正则字段右下加「全屏编辑」入口；desktop 删 SMART_SORT_FLAG_PRESETS chips、正则 input 改 textarea rows=2、hint 同款。

4. **验证**：core npm test 2032 全绿 + build；mobile typecheck + jest 189 套件/1151 用例全绿；desktop typecheck + NODE_ENV=development npm test 125 用例全绿（注意：run-tests.mjs 的 glob 在 /bin/sh 下 `test/**/*.test.ts` 只匹配一层子目录，85 个顶层测试文件不进该入口——仓库既有现象、CI 同入口；受影响的顶层测试已定点跑 smart-sort-rules-view/provider-detail-tabs/settings-agents-delete-confirm 10 用例全绿）。

遗留观察：desktop `npm test` glob 覆盖缺口（顶层 test/*.test.ts 不被跑到）是测试基础设施既有问题，未在本次修复，可另立节点处理。
