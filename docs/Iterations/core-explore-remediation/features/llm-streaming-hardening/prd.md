---
date: 2026-06-21
dependency: Iterations/llm-protocol-anthropic-gemini-parity/prd.md
---

# LLM 流式解析加固（llm-streaming-hardening）PRD

## 背景

`packages/core/src/infra/llm-protocol` 已完成三协议（OpenAI / Anthropic / Gemini）流式传输与 abort partial 的基础能力（见前置迭代 [llm-protocol-anthropic-gemini-parity](../../../llm-protocol-anthropic-gemini-parity/prd.md)）。2026-06 代码审查（[explore.md](./explore.md)）表明：**主对话路径无已验证 P0 数据损坏**，但流式解析层存在两类可观测性与一致性缺口：

1. **畸形 SSE JSON 静默丢弃**：三协议 parser 在 `JSON.parse` 失败时直接 `return`，无计数、无日志、无向上层报错。网关/代理返回 HTTP 200 但 payload 损坏时，用户可能看到「空回复」，难以区分模型无输出与中间层故障。
2. **流式 `tool-use` 事件时机不一致**：Anthropic 在 `content_block_stop` 时 emit `tool-use`；OpenAI / Gemini 仅在 `finish*Sse` 时 emit。`AgentRunner.wrapStreamForBus` 会将 `tool-use` 发布为 `EVENT_AGENT_STREAM_TOOL_USE`，Mobile/Desktop 流式 UI 依赖该事件展示「工具调用中」——协议切换后体验不一致。

另：`OpenAiSseParserState.emittedToolIndices` 已声明但流式路径从不写入，暗示半途 emit 曾计划未落地，增加维护误解。

**参考材料：** [explore.md](./explore.md)、[迭代 readme](../../readme.md)

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 畸形 SSE 可观测、可诊断 | 三协议 parser 单元测试覆盖「坏行 + 正常行混流」；debug 模式有 warn；零内容且存在坏行时 adapter 抛明确 `ProviderError`（非静默空回复） |
| 流式 `tool-use` 三协议语义对齐 | OpenAI / Gemini 在参数 JSON **首次可完整解析**时 emit `tool-use`（与 Anthropic `content_block_stop` 同级用户可感知时机）；`test:fast` 中三协议 parser + provider 层对应用例通过 |
| 无效 tool 参数不静默丢参 | `argumentsJson` / `partial_json` / `argsJson` 非空但 parse 失败时：finish 路径产生可观测 warning 或 `ProviderError`（见 SPEC 选型），不得无声变为 `{}` |
| 不重复其它迭代工作 | 本 feature **不包含** `codebase-audit-remediation` 已规划的 debug-fetch URL 脱敏、`feedSseLines` 抽取、`isRecord` 集中、thinking signature 等（见「不包含范围」） |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Agent 用户（CLI / Mobile） | 流式对话中模型发起 tool 调用时，三种 Provider 协议均能在参数就绪后尽快看到「工具调用中」指示，而非仅 Anthropic 实时、OpenAI/Gemini 等到整轮结束 |
| 运维 / 开发者 | 中转网关返回畸形 SSE 时，日志或错误信息能指向「解析失败」而非误判为模型空输出 |
| Core 维护者 | 修改 `openai-sse-parser` / `anthropic-sse-parser` / `gemini-sse-parser` 时有 parity 矩阵与单测锚定，避免三协议 drift |
| 集成测试 / CI | `npm run test:fast` 中 llm-protocol 相关用例（当前约 111 项）全绿且无新增静默行为回归 |

## 范围

### 包含范围

1. **畸形 SSE 可观测性（三协议 parser）**
   - 解析 state 累计 `malformedLineCount`（或等价字段）。
   - `NM_DEBUG_LLM_FETCH=1` 或专用 `NM_DEBUG_LLM_SSE=1` 下，对每条坏行 `console.warn`（含 payload 前缀，长度上限见 SPEC）。
   - `finish*Sse` / `finish*Partial`：若最终 `blocks` 为空（无 text/thinking/tool_use）且 `malformedLineCount > 0`，抛 `ProviderError`（新错误码或既有 `HTTP_ERROR` 子类，见 SPEC）。

2. **流式 `tool-use` parity（OpenAI + Gemini 对齐 Anthropic）**
   - OpenAI：在 `tool_calls[].function.arguments` 增量累积后，当某 index 的 JSON **可完整 parse** 且尚未 emit 时，立即 `onStream({ type: "tool-use", ... })`；`finishOpenAiSse` 不重复 emit（复用 `emittedToolIndices`）。
   - Gemini：在 `functionCall.args` 合并后同样规则；`finishGeminiSse` 去重。
   - Anthropic：**行为保持不变**（`content_block_stop` emit）；补充文档说明其为 parity 基准。
   - 更新 `adapter.port.ts` 中 `LlmStreamEvent` 注释：约定 `tool-use` 在「参数 JSON 完整可解析时」emit，每种协议至多一次 per tool call id/index。

3. **无效 tool 参数处理**
   - 三协议 finish 路径：非空参数字符串但 `JSON.parse` 失败时，按 SPEC 统一策略（推荐：`ProviderError` + 截断 raw 片段，或 debug warn + 保留 `input: {}` 且 `streamRaw` 标记——PRD 要求**至少一种可观测路径**，不得仅 `{}`）。

4. **测试补强**
   - 三 parser：畸形 SSE、混流、tool-use 半途 emit、finish 去重。
   - Provider 层：`protocol-anthropic.test.ts` 补充与 OpenAI 对等的 stream + tool 用例（explore 指出现状仅 3 用例偏薄）。
   - 回归：OpenAI / Gemini 现有 stream、abort partial 用例不退化。

5. **文档**
   - 本 feature 的 `spec.md` 含三协议流式行为矩阵（text-delta / thinking-delta / tool-use / done / malformed SSE）。

### 不包含范围

- **前置迭代职责**：[llm-protocol-anthropic-gemini-parity](../../../llm-protocol-anthropic-gemini-parity/prd.md) 范围内的 Gemini 流式实现、Anthropic RN `postSse`、abort partial、工具多轮 history——本 feature 假定其已交付。
- **codebase-audit-remediation 已认领项**（避免重复 PR）：
  - `debug-fetch.ts` URL `key=` 脱敏、`createLoggingFetch` 改造
  - `sse-line-buffer.ts` / `feedSseLines` 抽取（若 audit 未完成，本 feature **仅消费**现有 helper，不二次重构）
  - thinking / `signature_delta` / `thought_signature` 多轮闭环
  - `isRecord` → `type-guards.ts` 集中
  - ChatTabScreen 拆分、根级 CI/lint、Domain 反向依赖等
- **explore P1 中非流式核心项**：Anthropic `max_tokens` 硬编码 4096、Gemini API key 走 URL query、Gemini 出站多模态 image。
- **explore P2 技术债**：注释 mojibake、`getProtocolAdapter` fetchFn 语义、`finishAnthropicSsePartial` 结构简化、适配器 `chatStream` 模板抽象、OpenAI text-only 快捷路径对等。
- **上层产品行为变更**：`AgentRunner` 工具执行逻辑、Mobile overlay 布局、Provider 重试/采样配置。
- **传输层改造**：`postSse` content-type 强制校验、RN XHR 节流策略变更。

## 核心需求

1. **畸形 SSE 不得无声失败：** 三协议 parser 对 `JSON.parse` 失败行计数；debug 可 warn；零有效 block 且存在坏行时必须向上抛错，使 `ModelRequestService` / `AgentRunner` 能展示失败而非空 assistant。
2. **`tool-use` 流式时机统一：** 用户可感知定义为「工具参数字符串已完整且可解析为 object」；OpenAI/Gemini 须在此刻 emit，不得仅等到 stream finish；同一 tool call 不得重复 emit。
3. **无效 JSON 参数可追踪：** 非空参数字符串 parse 失败时，finish 路径须有 warn 或 error，禁止唯一表现为静默 `{}`。
4. **Anthropic 为 parity 基准：** 不改变 Anthropic 现有半途 emit 语义；OpenAI/Gemini 向其对齐，而非降低 Anthropic 到 finish-only。
5. **测试即契约：** 新增/扩展用例编号遵循现有 `SSE-*` / `T*` 风格；`npm run test:fast` 全绿。
6. **迭代边界清晰：** 与 `codebase-audit-remediation`、`llm-protocol-anthropic-gemini-parity` 的 file 变更清单在 SPEC 中显式列「本迭代 touch / 不 touch」。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| M1 | OpenAI parser state | feed 仅含 `data: {invalid json` 行后 finish | `malformedLineCount >= 1`；blocks 为空时抛 `ProviderError`（消息含 malformed / parse 语义） |
| M2 | Anthropic / Gemini parser | 同上（各测 1 组 fixture） | 与 M1 等价行为 |
| M3 | 混流 fixture（1 坏行 + 1 合法 text delta） | finish | 正常产出 text block；`malformedLineCount === 1`；**不**因坏行抛错（有有效内容） |
| M4 | `NM_DEBUG_LLM_SSE=1`（或 SPEC 选定 debug 开关） | feed 坏行 | stderr 出现 warn 且含 payload 前缀 |
| T1 | OpenAI 流式 tool_calls 分片 | 第二片使 arguments 成为合法 JSON | **finish 之前** `onStream` 收到 1 次 `tool-use`；finish 不再重复 |
| T2 | Gemini 流式 functionCall args 分片 | 同上 | 同 T1 |
| T3 | Anthropic 流式 tool_use | `content_block_stop` | 仍 emit 1 次 `tool-use`（回归） |
| T4 | OpenAI tool arguments 故意损坏（非空非法 JSON） | finish | 触发 SPEC 选定策略（error 或 debug warn），**不得**无任何痕迹的 `input: {}` |
| T5 | `protocol-anthropic.test.ts` | 跑 stream + tool mock | 新增用例通过；与 `protocol-openai.test.ts` tool stream 覆盖量级相当 |
| R1 | `npm run test:fast`（packages/core） | 全量执行 | 退出码 0；llm-protocol 相关用例无失败 |
| R2 | OpenAI 兼容 provider 回归 | 现有 stream + abort 用例 | 行为与 parity 迭代后基线一致（无 tool-use 时机回退为仅 finish 且无测试更新） |

## 约束与依赖

- **前置 dependency：** [LLM 协议能力对齐 PRD](../../../llm-protocol-anthropic-gemini-parity/prd.md) 须已验收（三协议流式、abort partial、Gemini tools 可用）。本 feature 在其 parser/adapter 基线上做加固，不替代 parity 实现。
- **互补迭代：** [codebase-audit-remediation](../../../codebase-audit-remediation/prd.md) 负责 debug-fetch 脱敏与 SSE buffer 抽取；本 feature 若需 debug 日志，仅追加 SSE parse warn，**不修改** `redactUrl` / header 脱敏逻辑。
- **迭代位置：** `core-explore-remediation` Phase 3（readme 高优先级 #9–#10）。
- **错误类型：** 优先复用 `ProviderError` + 既有 code 枚举；新增 code 须在 SPEC 中列出并单测覆盖。
- **文档后续：** 本 PRD 确认后进入 [spec.md](./spec.md)（design-proposal），再分 PR 实施（建议：PR-1 畸形 SSE，PR-2 tool-use parity + 无效 JSON）。
