---
date: 2026-09-25
type: P0 bug 闭环（复现→定位→修复→复验）
node: fix-stop-button-p0
branch: feat/llm-stream-native（基于 740bad96）
---

# 停止按钮 P0 修复报告（TypeError + 连接不断 + run 悬死）

Step 8 e2e 报告登记的 P0：native SSE 路径 mock-dead 挂死窗口点终止键，
`TypeError: undefined is not a function`（t0 send 后 ~28ms，无堆栈），
挂死连接未被客户端中止（+30s 才被读超时关闭），run 悬死（无重试、无终态、
二次 tap 无响应，仅 force-stop 可复位）。本文档为闭环记录。

## 根因（断链点）

**`packages/llm-sse-native/src/native.ts` 的 `createBridge()` 用
`{...nativeModule, events}` 组装 bridge，而 RN bridgeless 下
`NativeModules.LlmSseNative` 返回的是「lazy jsRepresentation」——初始为空
JS 对象，方法挂在 HostObject 原型上、首次属性访问才实体化为 own property
（证据：`node_modules/react-native/ReactCommon/react/nativemodule/core/
ReactCommon/TurboModuleBinding.cpp` getModule 的 jsRepresentation 实现）。**

spread 只枚举 own property，因此 bridge 只含「此前被访问过」的方法：
`isNativeSseAvailable()` 恰好只 typeof 访问了 `sseConnect` 与 `request`
（旧实现没有探测 sseAbort），于是：

- `bridge.sseConnect(...)` 一直可用（流式连接正常建立——AC-1/AC-2/挂死实验全部走通，掩盖了问题）；
- **`bridge.sseAbort` 为 undefined**，首次调用发生在终止链上。

三个症状的传导：

1. **为什么 TypeError**：tap → send（running 分支）→ stopRun →
   abortRegistry.abort → internalController.abort →（runNative 组合
   controller.abort）→ wrapper 的 onAbort listener 内第一句
   `bridge.sseAbort(requestId)`（transport.ts:230）即抛
   "undefined is not a function"；异常沿 abort 同步 dispatch 冒回 send
   （async 回调）→ 未处理 rejection → Hermes/RN 以
   `E ReactNativeJS: [TypeError: undefined is not a function]`
   单行方括号格式输出（无堆栈）。
2. **为什么连接不断**：onAbort 在调用 `bridge.sseAbort` 时即炸，
   后续的 `finish(() => reject(...))` 与原生 `call.cancel()` 均未执行；
   挂死连接只能等 OkHttp 30s 读超时（服务端留痕 +30s 整点关闭）。
3. **为什么 run 悬死/不重试**：JS 侧 abort 语义其实已传导到
   internalController（signal.aborted=true）——wrapper 的 onAbort 炸在
   「组合 controller → wrapper」这一段，不影响 runner/modelRequests 层的
   signal。读超时错误到达后重试判定为 first-chunk 可重试，但
   `delayWithSignal` 在已 aborted 的 signal 上立即以 AbortError 拒绝，
   因此无第二次请求。复现轮实测 run 在挂死 +30s 读超时后以终态收敛
   （「上次生成 · 32.1s」）；Step 8 观察到的 4 分钟+ 无终态悬死、二次 tap
   无响应，是该炸点在同一 dispatch 上的更深层中断形态（未单独复现到，
   判定为同根因的偶发加重，修复后不再出现）。

## 定性：本迭代引入

XHR 时代的停止链不经过该 wrapper（无 bridge 组装），Step 3 新写的
native transport 链首次把「TurboModule 方法经 spread 组装」引入停止路径。
双路径对照（取证构建里打点 `typeof nm.sseAbort` 后 abort 链即恢复正常）
也反向确认：断点仅在 native 分支的 bridge 组装。

## 取证过程（为什么 jest 复现不了）

- jest 层（Node 语义 AbortController + mock bridge）传输链/manager 链全绿
  ——纯 JS 逻辑无 bug，问题在 RN 运行时特有行为。
- 诊断构建打点（BRIDGEKEYS）：`Object.keys(NativeModules.LlmSseNative)` 为
  `[]` 而 `typeof nm.sseAbort === 'function'`——lazy jsRepresentation 的
  直接实证。
- **打点构建反而「修好」了 bug**（三轮挂死+终止全正常）：打点里的
  `typeof nm.sseAbort` 恰好把 sseAbort 实体化，spread 就能拿到——这个
  「意外」正是最后锁定根因的钥匙。干净构建（零打点）则稳定复现
  step8 同款 TypeError + abort 失效。

## 修复

`packages/llm-sse-native/src/native.ts` 两处（互为保险，任一独立可防）：

1. `createBridge()`：解构 `const {sseConnect, sseAbort, request} =
   nativeModule` 显式取三个方法引用再组装——属性访问走原型查找，
   不依赖 spread 的枚举语义。
2. `isNativeSseAvailable()`：补 `typeof nativeModule.sseAbort ===
   "function"` 探测——即使将来有人改回 spread，此处的 get 也会把方法
   实体化。

## 防回归测试

- `apps/mobile/__tests__/llm-sse-native-bridge-interop.test.ts`：用
  「方法全在原型 + get 实体化缓存」的 Proxy 精确模拟 RN lazy interop
  形态，断言 transport.post 挂起中 abort → 原型 sseAbort 被调用 +
  AbortError reject。负向验证：dist 临时回退 spread 后测试转红。
- `apps/mobile/__tests__/stop-button-repro.test.ts`：core postSse 公共层
  （native 分支）→ 真 wrapper 的 abort 传导全链集成（mock-dead 形态）。

## 模拟器复验（三断言）

诊断 APK（含修复，MainApplication 临时 useDevSupport=false 构建后已还原）
+ mock-dead 挂死 → dump 定位发送键 bounds `[922,2194][1027,2299]` → tap
终止：

| 断言 | 结果 |
|---|---|
| 服务端挂死连接被客户端主动关闭（非 +30s 读超时整点） | **PASS**：conn#7 挂死 +12.9s 被「HANG 结束：挂死连接被客户端关闭」，时刻即 tap 时刻 |
| UI 进入终态（非悬死） | **PASS**：「上次生成 · 15.3s · 正文 0 字」，tap 后即时收敛 |
| 发送键复活可再发 | **PASS**：键位恢复「发送」label；复验前一轮（打点构建）已连续三轮挂死+终止+再发 |

logcat 全程 **TypeError 0 行**（修复前干净构建同场景 1 行）。

## 测试

- `packages/llm-sse-native`：22/22 通过。
- mobile 定向（smoke/setup-llm-fetch/fetch-shim/新防回归 ×2）：25/25 通过。
- core 全量：2161/2163——2 失败为 usage stats 时区/DST 用例（T-C2/T-C6，
  时区敏感的环境用例，与本次修复无关，core 零改动）。

## 遗留

1. Step 8 的「4 分钟悬死 + 二次 tap 无响应」加重形态未在复现轮单独出现
   （同根因的偶发加重，修复后理论上不复存在）；如后续再遇类似形态，
   优先核对是否本修复未部署。
2. AC-4 前缀文案 `after 600000ms` 数字失真（Step 7/8 既有登记项）维持。
3. `llm-sse-native` 的 tsc 增量缓存（tsconfig.tsbuildinfo）在「dist 被删
   后重 build 不产出」场景下会误判无变化，需删 tsbuildinfo 全量重建——
   与本 bug 无关，工程便利性登记。
