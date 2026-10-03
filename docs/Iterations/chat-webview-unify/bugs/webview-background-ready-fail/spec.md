---
date: 2026-10-03
agile_trace: true
---

# webview-background-ready-fail 实现规格（SPEC）

## 根因 / 方案摘要

聊天页 WebView 双进程协作下，8s ready 兜底计时器（`READY_TIMEOUT_MS = 8000`）由 RN JS 线程驱动、不依赖 Activity 可见性；系统杀进程后冷启动恢复时若屏幕/Activity 不可见，Chromium 冻结 web JS（DOMContentLoaded 后的 ready 发不出），计时器照常到期把「冻着」误判为「装配失败」。修复 = 计时器加 AppState 感知 + 回前台自愈 + 渲染进程死亡监听。

提交：`e9960db82`（分支 feat/vfs-import-export-menu，就地提交——真机在测此分支，与 edit 工具顺手修同分支先例一致）。

## 变更点清单

| 文件 | 变更 |
|---|---|
| `apps/mobile/src/components/chat/ChatConversationWebView.tsx` | 六处：import AppState；armReadyTimeout 到期判定；readyFailedRef 镜像；handleAppStateChange + 订阅 effect；handleRenderProcessGone + WebView 两 prop；错误页文案 |
| `apps/mobile/src/services/chat-transcript-telemetry.ts` | 事件联合补 `render_process_gone` 分支（字面量联合类型，不补则 tsc 红） |
| `apps/mobile/__tests__/chat-conversation-webview.test.tsx` | AppState mock 基建 + 新 describe 四用例 |
| `apps/mobile/__tests__/chat-tab-screen.integration.test.tsx` | 附带：已删模块 `session-messages-loader` 的残留 mock 补 `{virtual: true}`（HEAD 既有加载期红，非本轮引入） |

## 详细改动说明

### 1. 计时器前后台判定（armReadyTimeout 到期回调）

到期时 `webReadyRef` 已 ready 则照旧早退；未 ready 时读 `AppState.currentState`，为 `'background' | 'inactive'`（显式列举）则挂起不判死，等回前台重新计时。**为何显式列举而非 `!== 'active'`**：启动早期 currentState 为 null、jest preset mock 为 undefined，按前台处理——真机到期时刻不会处于启动早期，而 jest 既有两条「期望弹错误态」用例依赖此口径。Android 锁屏/后台均为 `'background'`，iOS 锁屏为 `'inactive'`，列举已全覆盖。

### 2. readyFailedRef 镜像

照组件既有 render 期 ref 赋值排（`onComposerChangeTextRef` 等）加 `readyFailedRef`，AppState 回调读最新失败态而不把 `readyFailed` 塞进依赖数组——依赖一变回调就换、订阅反复摘挂。

### 3. 回前台自愈（handleAppStateChange + 订阅 effect）

AppState `'change'` 且 `state === 'active'`：
- `webReadyRef.current === true`：正常态，无动作；
- 错误态（`readyFailedRef`）：调 `handleReload()`——错误页 early-return 已卸载 WebView，onLoad/重挂 effect 都不会再触发，handleReload（置 readyFailed=false + 换 key 重挂 + 重新计时）是唯一自洽恢复入口；
- 非错误但握手在途（含后台到期挂起）：`armReadyTimeout()` 重新计 8s，把冻结期剔出计时窗口。

天然限流：handleReload 置 readyFailed=false 后，后续 active 只走重计时分支，前后台抖动不反复重载。依赖数组仅 `[armReadyTimeout, handleReload]`（全链稳定），全程只订阅一次。

### 4. 渲染进程死亡监听

`onRenderProcessGone`（Android）/`onContentProcessDidTerminate`（iOS，防御性同接）→ 打 `render_process_gone` 遥测 + 复用 handleReload 换 key 重建。webview 库 13.16.1 对 renderProcessGone 只发事件不恢复，不接则渲染进程死后 WebView 残留死态（页面看着正常只是不动）、`webReadyRef` 停留 true。注意：readyFailed 态下 WebView 未挂载收不到该事件，该场景由回前台自愈兜底，两机制互补。

### 5. 文案

错误页 L2377「输入组件版本可能过低，请重启应用」→「页面加载超时，点重载恢复；若持续出现请重启应用」。降级横幅（L2431，「输入组件版本过低」——真·dist 版本过旧场景）一字不动，测试含负面断言防误伤。

## 测试策略

组件级套件新增 describe「ChatConversationWebView · 前后台感知自愈」，AppState mock 照 `agent-finished-notification.test.ts` 先例（`Object.defineProperty` 覆盖 currentState + 从 `addEventListener` mock.calls 取 change listener 手动触发，afterEach 还原描述符）：

1. 后台 9s 到期不判死 + 回前台重计时（active 后再满 8s 仍无 ready 才落错误态——证明非无限挂起）；
2. 错误态回前台自动重载（错误态消失 + 重新握手成功）；
3. onRenderProcessGone 重挂恢复 + 遥测恰好一次；
4. 文案护栏（含新文案断言与「不得复用降级横幅文案」负面断言）。

门禁：`npx jest chat-conversation-webview chat-tab-screen.integration` → 2 suites 71/71（主代理复跑确认）；`npx tsc --noEmit -p tsconfig.build.json` 零错；eslint 四文件 0 error。

## 风险与回滚方案

- 风险：AppState 感知逻辑与 visibility 重挂链（回前台 dirty 重挂）叠加时序——armReadyTimeout 幂等（先 clear），重复 arm 只顺延窗口无双重判死；两链各自独立，无共享可变状态。
- 回滚：单笔提交 `git revert e9960db82` 即整体回退（含附带 virtual mock 修复；若只想回退主改动，revert 后手动保留 mock 那一 hunk）。
- 真机验证依赖 Metro reload（纯 RN TS 改动，不涉及 webview dist 重建链）。
