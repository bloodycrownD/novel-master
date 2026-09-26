# Step 1 买 vs 建评估门：决策记录

- 日期：2026-09-25
- 决策：**自建**（`packages/llm-sse-native/`，按 spec §2 设计）
- 评估对象：`@mattermost/react-native-network-client@1.11.3`（当时最新版）
- 评估方式：静态核验（npm pack 解压源码逐项阅读），未跑模拟器 PoC——静态核验已实锤两项否决条件，按 spec 决策规则（「任一不满足或全局版本强制验证有冲突 → 自建」）直接定案，无需实测。

## 否决证据

### 否决 1：无响应体增量事件流（核心需求零满足）

- Android 端 `APIClientEvents.kt` 全部事件仅三个：`DOWNLOAD_PROGRESS` / `UPLOAD_PROGRESS` / `CLIENT_ERROR`——不存在任何「响应体增量数据」事件。
- `NetworkClient.kt`（223-271 行）普通请求路径 `okHttpClient.newCall(request).enqueue(...)`，`onResponse` 里 `promise.resolve(response.toWritableMap(metadata))`——**响应体整包读完一次性经 Promise 返回**。对 SSE（服务端不关连接的响应）该模型会一直挂到读超时，中间数据一个字节都到不了 JS。
- 全包源码无 streamRequest / poll / incremental / chunk / onRead 等增量 API；README 无 stream/SSE/chunk/poll 字样。WebSocketClient 是独立模块（ws 协议升级），不能充当 HTTP POST 响应体流。
- 结论：头号买入候选在 spec 评估表第一核验项（SSE POST + chunk 事件流）上直接出局。

### 否决 2：OkHttp 5 大版本全局冲突（无覆盖入口）

包 `android/build.gradle`（61-80 行）`implementation okhttp:5.3.2 + 模块内 force`，**硬编码、无 safeExtGet 覆盖入口**；okio force 3.16.4。RN 0.85.3 实际依赖 okhttp 4.9.2 / okio 2.9.0（react-android pom + `gradle/libs.versions.toml` 双重确认）。库模块 force 不外传，但 `implementation` 版本进 app 依赖图后 Gradle 取最高版本——装包即把 RN NetworkingModule（fetch/XHR）与 fresco（`imagepipeline-okhttp3:3.6.0`，编译于 OkHttp 4.x 基线）的网络栈整体抬到 OkHttp 5.3.2/okio 3.16 两个大版本，RN 官方未验证该组合；反向 app force 回 4.9.2 则让按 OkHttp 5 编译的包代码运行时不兼容——双向风险且无干净 opt-out。

### 否决 3（次要）：普通请求无法单独取消

`cancelRequest(taskId)` 的 `calls` 登记表只在 upload/download 路径登记，普通 post/get 不登记；只能 `invalidateClientFor(baseUrl)` 粗粒度杀掉该 baseUrl 全部在途请求（顺带清 cookie/证书/token）。

## 未构成否决的核验项（留档）

- POST + 自定义 headers + body：✅（headers 合并、JSON/text body 序列化齐全）。
- per-request 超时：✅（`timeoutInterval` → `TimeoutInterceptor` 按 Request 实例匹配，read=write 同值；自建方案用 OkHttp 克隆 builder 设 per-request 超时，成本更低语义相同）。
- bridgeless/新架构：✅（newArchEnabled 源集切换 + codegenConfig + TurboReactPackage；与我们 tokenizer 的 NativeModules interop 路线不同但均可兼容）。
- Kotlin 版本：✅ 无冲突（默认 2.2.21 可被 `rootProject.ext.kotlinVersion` 覆盖，主仓已设 2.1.20）。
- iOS pod 仪式：存在（Alamofire/SwiftyJSON/Starscream + ruby patch 脚本），Android-only 发布面不参与，无代价。

## 结论

三项否决独立成立任一即出局，现核心增量事件流与依赖冲突两项同时实锤。自建面按 spec §2：自有 OkHttpClient（独立池 + **client 级读超时恒禁用**/callTimeout 600s per-request 可覆盖）+ `response.body().source()` 读循环 + 100ms|64KB（字符口径）合批 + `sseConnect/sseAbort/request(GET|POST)` API 面——买入候选中值得借鉴的点（per-request 超时、bridgeless 适配）在自建里只是少量样板代码。

> **终版口径修订（2026-09-26）**：本决策记录写作时的「读超时 30s」已在实施中被废止——真机两轮实锤（非流式大 prompt 等待被 30s 误杀、GLM 工具调用憋生成被流中 30s 误杀），终版按产品拍板**流式不设任何固定空闲界**（client 级 readTimeout 恒禁用；Kotlin `readTimeoutMs` 参数仅保留 JS 接口兼容与防御性错误文案位），唯一自动兜底是 callTimeout 600s 整调用预算，死流由用户手动终止。否决理由与自建选型结论不受影响，详见 ⑥ `spec.md` §2 实施修正记录与 `docs/apm/RULE.md:85`。
