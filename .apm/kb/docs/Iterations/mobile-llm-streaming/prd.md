# Mobile LLM 流式输出 PRD

> **上游**：`mobile-app`（Android 产品 App）、`provider-model`（OpenAI 兼容服务商）。  
> **背景事实**（2026-05 设备日志）：智谱 `POST …/chat/completions` 返回 `HTTP 200` + `text/event-stream`，但 React Native `fetch` 的 `response.body === null`，导致聊天报错 `Empty streaming response body`，无法逐字展示。

## 背景

- **模型 HTTP 均在 `@novel-master/core`**：`ModelRequestService` → 各 `*ProtocolAdapter` → `fetchFn` / `fetchJson`（`http-util.ts`）。App 只调 runtime 服务（如 `runAgentTurn`、`providerModels.fetch`），**不** 单独实现 OpenAI HTTP 客户端。
- Mobile 聊天已开启 `stream: true`（`agent-run.service.ts` → `OpenAiProtocolAdapter.chatStream`），UI 具备 `streamingText`。
- Node/CLI 上 `fetch` + `ReadableStream` 可正常消费 SSE；**RN（Hermes）对流式响应常不提供可读 `response.body`**（`hasBody: false`），与服务商是否正常无关。
- 用户期望：发送消息后 **首字尽快出现**、内容 **增量刷新**。
- **架构结论**：在 **Core** 封装 LLM 专用 HTTP（含 SSE 传输）；RN 通过标准全局 `XMLHttpRequest` 收流，**无需** `apps/mobile` 新增 XHR 模块或启动注册；**不做** `stream: false` 自动降级。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 聊天流式成功 | Android 开发构建下，OpenAI 兼容服务商 + 已保存模型，发送消息后 **不再** 因 `Empty streaming response body` 失败 |
| 真流式体验 | 首包到达后 **3s 内** 可见首段文字（网络/模型正常）；`streamingText` 随增量更新 |
| 协议对齐 | 最终 `ContentBlock[]` 与非流式一致（text / tool_use），正常落库与工具轮 |
| 失败即报错 | HTTP/SSE/解析失败时 **直接失败**，`ChatComposer` 展示错误；**不** 静默改 `stream: false` 重试 |
| 归属清晰 | 传输与解析均在 Core；**`apps/mobile` 本期无流式业务代码变更**（可选保留 `__DEV__` 的 `configureLlmFetch` 日志） |
| 范围克制 | **OpenAI 兼容协议 + Mobile 验收**；CLI 仍走 Core `fetch` 流，零行为变更 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 日常写作用户 | 对话 Tab 与 Agent 对话，边生成边阅读 |
| OpenAI 兼容服务商用户 | 智谱等，期望流式体验 |
| 开发者 | `[novel-master/llm]` / `[novel-master/llm-sse]` 日志；失败时界面与日志一致 |

## 范围

### 包含范围

1. **Core LLM HTTP 层**：扩展 `http-util`（或同级 `llm-sse-transport.ts`），提供 **`postSse`**（及既有 `fetchJson`）作为 adapter 唯一出站入口。
2. **SSE 传输策略**：
   - 默认：`fetch` + `ReadableStream`（Node/CLI/具备 stream body 的环境）。
   - RN：当环境判定为 React Native（或 `fetch` 响应 `body == null` 且存在 `XMLHttpRequest`）时，**同模块内** 用 XHR `onprogress` 增量读，**不** 依赖 `react-native` 包。
3. **OpenAI adapter 改造**：`chatStream` 经 `postSse` 收字节 → 共用 SSE 解析（可抽出 `openai-sse-parser.ts`）。
4. **现有 Mobile UI/服务**：`stream: true`、`ChatComposer` / `MessageList.streamingText` 不变。
5. **开发日志**：`createLoggingFetch` 仍仅包装非流式/listModels 等 `fetch` 路径（`setup-llm-fetch.ts`，可选）。

### 不包含范围

- **`apps/mobile` 内 XHR 实现、`registerOpenAiStreamChat`、App 启动注册流式实现。**
- **非流式自动降级**（流式失败改 `stream: false` 重试）。
- iOS 专项验收（实现通用，不单独承诺）。
- Anthropic / Gemini 流式（同根因可后续复用 `postSse`，**本期仅 OpenAI 兼容 adapter**）。
- 取消生成（`xhr.abort()`）产品化（可预留接口，非本期必达）。
- 原生 OkHttp / WebSocket / 服务商 SDK。
- 修改智谱网关。

## 核心需求

1. OpenAI 兼容且 `stream: true` 时，**Core** 必须通过 **`postSse`** 消费 SSE，不得在 RN 上假设 `fetch().body` 可读。
2. 增量映射为现有 `LlmStreamEvent`（`text-delta`、`done`；tool 流式与现网一致）。
3. **任何流式/HTTP 错误直接向上抛出**（`ProviderError`），由 UI 展示；禁止同轮非流式重试。
4. **`apps/mobile` 不新增 LLM 传输代码**；修复完全在 `@novel-master/core`。
5. CLI / Node 仍使用 `fetch` 流式路径（`postSse` 内部选用 fetch），行为与改动前一致。

## 验收标准

- **Given** Android 开发包、OpenAI 兼容服务商且 Key 有效，**When** 发送「Hello」，**Then** 无 `Empty streaming response body`；会话有一条 assistant 消息。
- **Given** 网络正常，**When** 发送长回答提示，**Then** 落库前 `streamingText` 非空且内容持续增长。
- **Given** 断网或 HTTP 4xx，**When** 发送消息，**Then** 界面显示错误；**不** 出现静默完整回复（无降级成功）。
- **Given** CLI 流式对话，**When** 回归测试，**Then** 与改动前一致。
- **Given** 开发构建 + 已配置 `createLoggingFetch`，**When** listModels / 非流式请求，**Then** 仍有 `[novel-master/llm]` 日志；流式可走 `[novel-master/llm-sse]`（实现时统一前缀）。

## 已确认决策（2026-05）

- **不降级**：失败直接报错，不重试 `stream: false`。
- **传输在 Core**：LLM HTTP 与 SSE 收包内聚在 `packages/core`，App 不背协议。
- **XHR 在 Core 的 `postSse` 内**：利用 RN 全局 `XMLHttpRequest`，不增加 `@novel-master/core` 对 `react-native` 的依赖。
- **范围**：OpenAI 兼容 + Mobile 验收；Anthropic/Gemini 另迭代。
