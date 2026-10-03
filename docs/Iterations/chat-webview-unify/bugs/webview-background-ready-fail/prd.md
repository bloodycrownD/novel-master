---
date: 2026-10-03
dependency: iterations/chat-webview-unify/spec.md
---

# webview-background-ready-fail Bug PRD

## 背景

chat-webview-unify 把聊天页从 RN 原生控件迁到 WebView 后，页面变为 RN 宿主 + Chromium 渲染进程的双进程协作，宿主侧以 8s 握手兜底计时器等待 web 侧 v2 ready。RN 原生实现没有这层协作，同样的系统事件（后台进程回收）在旧实现下只是一次无感冷启动。

## 现象描述

应用长时间放后台（荣耀真机，约数分钟即触发）后回到前台，聊天页显示「对话页加载失败 / 输入组件版本可能过低，请重启应用 / 重载」错误页。点「重载」或重启应用均可恢复，但再次长时间后台会复现。

## 复现步骤

1. 真机打开 app 进入聊天页，正常使用；
2. 切后台（锁屏或 Home）放置数分钟，直至系统杀掉 app 进程（logcat 可见 `ActivityManager: Killing ... stop com.novelmaster due to from pid <系统进程>`）；
3. 回到前台（冷启动）；
4. 若恢复时 Activity/屏幕不可见（锁屏解锁路径），Chromium 冻结 web JS，ready 发不出，8s 后落错误页。

## 预期行为

- 握手超时兜底只应在 app 前台时判定；后台/锁屏期间的冻结不计入超时窗口。
- 用户回前台时：若已落错误页应自动重载恢复；若握手在途应重新计时。用户不应看到该错误页，更不应被指引「重启应用」。
- WebView 渲染进程被系统单独回收时（进程未被整杀的变体），宿主应感知并重建，而不是残留死态白屏。

## 实际行为（修复前）

- 8s 计时器无前后台感知，后台到期即 `setReadyFailed(true)`；错误页 early-return 卸载 WebView，只能手动重载/重启。
- `onRenderProcessGone` 未监听：react-native-webview 13.16.1 只发事件不恢复，渲染进程死后 WebView 实例残留死态、宿主 `webReadyRef` 停留 true，线上零打点无从归因。
- 错误页文案「输入组件版本可能过低，请重启应用」指向错误方向（真因是系统回收，非 dist 版本）。

## 影响范围

`apps/mobile/src/components/chat/ChatConversationWebView.tsx`（聊天页唯一 WebView 宿主，聊天/工作区两视图共用）。desktop 不涉及。

## 验收标准

1. 后台期间计时器到期不判死；回前台重新计时，前台满 8s 仍无 ready 才落错误页（不得无限挂起）。
2. 错误态下 app 回前台自动重载并完成握手，无需用户手动点「重载」。
3. 渲染进程回收/崩溃触发重挂重建，并上报 `render_process_gone` 遥测。
4. 错误页文案改为「页面加载超时，点重载恢复；若持续出现请重启应用」；降级横幅（真·版本过旧场景）文案不变。
5. 既有纪律不回退：切会话不重启 8s 兜底、visibility 重挂链、handleUpstream 依赖、memo 比较器零改动。

## 回归测试要点

见 spec.md 测试策略四条用例；另跑既有 T-CU15 两条与切会话两条护栏（依赖「currentState 未知态按前台处理」口径）。
