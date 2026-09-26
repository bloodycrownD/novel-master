# @novel-master/llm-sse-native

LLM SSE 原生字节管子（Android / Kotlin）：自有 OkHttpClient + native 合批（100ms | 64KB 先到者）+ 非流式 `request`（GET/POST）。port 纪律「只搬字节不认协议」——SSE 帧解析留在 core JS parser，native 不用 okhttp-sse。

## Entry points

| Import | Use when |
|--------|----------|
| `@novel-master/llm-sse-native` | Node tests / docs（无 react-native import，环境无关） |
| `@novel-master/llm-sse-native/native` | **RN App / Metro** — 静态绑定 `NativeModules.LlmSseNative` + `NativeEventEmitter` |

## Native API（Kotlin `LlmSseModule`，autolink 后 `NativeModules.LlmSseNative`）

- `sseConnect(requestId, url, headersKv, body, readTimeoutMs, callTimeoutMs)` — 建流；事件驱动无 Promise
- `sseAbort(requestId)` — 主动中止（`call.cancel()`，此后该 requestId 不再发事件）
- `request(method, url, headersKv, body?, callTimeoutMs) → Promise<{status, contentType, body}>` — 非流式（listModels GET / chatNonStream POST 底座）；非 2xx 不 reject，status/body 带回由 JS 侧处理

事件（`NativeEventEmitter`）按序到达：`LlmSseHeaders {requestId, status, contentType}` → `LlmSseChunk {requestId, text}`（合批后 ~10 事件/s）→ `LlmSseDone {requestId}` / `LlmSseError {requestId, kind: "network"|"timeout"|"http", message}`。

超时默认：读 30s、callTimeout 600s；per-request 覆盖传非正值即用默认（克隆 builder 手法，共享连接池）。

## JS wrapper

```typescript
import {
  createNativeSseTransport,
  isNativeSseAvailable,
  registerNativeSseTransportWith,
} from "@novel-master/llm-sse-native/native";

// 装配点（apps/mobile）：把 core 的注册函数注入（本包不依赖 core 运行时）
if (isNativeSseAvailable()) {
  registerNativeSseTransportWith(registerSseTransport);
}
```

`SseTransport` 为结构化声明（对齐 spec llm-stream-native §3 的 port 形状）；错误上抛 `NativeSseTransportError`（携带 `kind`，core 侧映射 `LlmStreamTimeoutError`）与 `NativeSseAbortError`（`name: "AbortError"`）。

## 测试

- `npm test`（包内）：注入 fake bridge 直测 wrapper——requestId 匹配、事件 1:1 透传、错误/abort 映射
- 合批精度（100ms/64KB、事件率）不在 JS 侧断言——归迭代 manual 核验（spec §2 登记口径）
- Kotlin 单测基建本期不引入（spec §2 登记）
