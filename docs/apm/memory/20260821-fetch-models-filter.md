---
date: 2026-08-22 00:10
title: 模型拉取过滤 + 底部高面板键盘自适应 hook
keywords: FetchModelsSheet, FetchModelsModal, 输入过滤, 键盘避让, useAdaptiveKeyboardSheetStyle, ToolPolicyPicker, DirectoryRuleSheet
abstract: 模型远程拉取列表加输入过滤（双端）；键盘顶出高面板问题三轮修复后抽公共 hook useAdaptiveKeyboardSheetStyle（topMargin=0 贴顶全遮），四处接入，含双端测试范式坑。
---

user:
一个无关优化，帮我给服务商配置的模型远程拉取下拉框增加输入框过滤能力。

assistant:
探索结论：UI 实为弹窗/底部 sheet 勾选列表（desktop FetchModelsModal.tsx、mobile FetchModelsSheet.tsx），打开即自动拉取；过滤纯前端内存操作，每端单文件改动。要点：双字段匹配（displayName+vendorModelId）、过滤只作用展示（勾选/已添加/计数保留）、打开重置、空结果提示区分。mobile 最佳模板 ToolPolicyPicker、desktop 参照 ChatHistorySearchPanel。PRD+spec 落盘 `docs/Iterations/fetch-models-filter/`。

user:
改吧。

assistant:
desktop（3869cb9）：`FetchModelsModal.tsx` 加 query state（open effect 里随 setRows([]) 一起重置）+ filteredRows useMemo（小写 includes 双字段，displayName trim 后为空只按 vendorModelId）；列表改用 filteredRows，空结果「无匹配模型」与「未拉取到可用模型」区分；selectedIds/is-saved 禁用态/saving/「已选 N 项」按全量 rows 计。
mobile（d57f79e）：同款 + FlatList `key={query}` 重建归零滚动；键盘遮挡照同目录 AddModelModal 先例接 `useAndroidModalKeyboardAvoid(1)`。cr-func 后补 T-FM8 is-saved 过滤用例（390e910）。
测试范式坑：desktop 照 chat-search-race-guard 范式（react-alias-hook 统一根 react 副本 + react-test-renderer 真渲，mock 拦 `window.novelMasterDesktop.invoke` 按 channel 路由；`await test()` 包在非 async describe 外会编译错，用 it()）；mobile mock useRuntime 须返回**固定引用** runtime（新对象字面量致 load useCallback 重建、visible effect 无限重跑）+ mock AppModal，renderer.toJSON() 对 VirtualizedList 内部节点报循环引用改递归收集 ReactTestInstance.children 文本。双端 4/4 + provider 系 23 测零回归，typecheck 过。

user:
键盘会把下拉框顶出去。

assistant:
根因：useAndroidModalKeyboardAvoid(1) 只做 translateY（适用矮 sheet 如 AddModelModal），FetchModelsSheet maxHeight 75% 是高面板，上移键盘高度后顶部（标题/过滤框）出屏；iOS behavior="padding" 不缩百分比 maxHeight 同样中招。修法：本地 animated style——translateY（Android）+ maxHeight 随键盘收缩（min(75% 屏高, 屏高-键盘-24)，下限 160）双平台生效，list 加 flexShrink:1。未加单测（reanimated mock 下只能测纯数学，价值低），待真机验收。

user:
智能体配置的工具白名单输入也有输入框的问题，修一下。抽一个公共的「键盘自适应高面板」hook？早该这么做了，事实上远远比这三处多。。。另外白名单工具那个还有点问题，减去的距离少了，智能体配置这个 title 只遮住一半——要么全部遮住要么一点不遮住，感觉不如全遮住占据整个屏幕吧，这会简单些吗？

assistant:
ToolPolicyPicker 同款修（其 sheet 走 FormOverlayHost 普通渲染层，原本无任何键盘避让）。随后抽公共 hook `apps/mobile/src/hooks/useAdaptiveKeyboardSheetStyle.ts`（94c4f01/0923d4d）：`useAdaptiveKeyboardSheetStyle(maxHeightRatio, {topMargin=0, minPanelHeight=160})`——useReanimatedKeyboardAnimation 取 kb=min(0,height)，Android 返 translateY + maxHeight 收缩（两平台都吃收缩）。topMargin 默认 0 是用户拍板「键盘弹起时面板贴屏顶全遮页面标题、不留余量」——遮一半最难看，全遮实现也简单。四处接入：FetchModelsSheet/ToolPolicyPicker（hook(0.75)，删手写样板与 24px 顶部余量）、DirectoryRuleSheet（hook(0.85)，原 useAndroidModalKeyboardAvoid(1) 只位移会顶出屏，A 类真 bug）、NewSkillModal（hook(0.85)，删 panelAndroid maxHeight 60% 硬编码）；四处 sheet 静态 maxHeight 百分比全删由 hook 管。头注释写清与 useAndroidModalKeyboardAvoid 的分工（那个管居中矮弹窗半高位移）。keyboard-controller mock 加 `__setKeyboardHeightForTests`（默认 0 不影响既有用例）。
hook 测试 5 用例：屏高不 mock（preset 默认 1334 会随升级变），用「ratio=1 + 键盘 0 时 maxHeight=屏高」运行时反推；键盘高度取值须大于屏高的 (1-ratio) 剩余份额，收缩才会压过比例上限（首次写 300 < 1334×0.25 踩坑）。全量 801/804，`use-chat-tab-message-actions-unhide.test.ts` 3 挂为既有失败（stash 对照验证过）。
后续 CR 补两处：C-1 iOS 避让退化（hook 加 iosTranslateY 选项默认 false，ToolPolicyPicker 传 true——iOS 走 KeyboardAvoidingView 的场景不位移只收缩）；C-2 DirectoryRuleSheet styles.form 补 flexShrink:1 契约测试。
