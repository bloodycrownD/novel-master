# LLM 协议能力对齐（Anthropic / Gemini → OpenAI 同级）PRD

> **上游**：`provider-model`（多协议 Provider）、`mobile-llm-streaming`（OpenAI 兼容 RN SSE）、`agent-resilience-mobile-yaml`（终止/流式背压等）。  
> **现状摘要**（2026-06）：`openai` 协议已具备流式、RN `postSse`/XHR、用户终止 partial 落库、thinking+空 text 保留、工具多轮；`anthropic` 有流式与 tools，但终止不保留 partial、未复用 RN SSE 传输；`gemini` 流式与 tools 均为 `UNSUPPORTED`。

## 背景

用户在 Mobile 与 CLI 上配置不同 Provider 协议（Anthropic 官方、Google Gemini、OpenAI 兼容中转）时，期望 **同一套 Agent 对话体验**：流式增量展示、运行中可终止且已输出内容不丢、终止后界面不「闪一下再消失」、工具调用与多轮 tool_result、弱网/RN 下流式可用。

当前仅 **OpenAI 兼容协议路径** 在 Core + Mobile 上形成闭环；Anthropic / Gemini 与 OpenAI 存在能力缺口，导致「换协议即换体验」，与「内部 ContentBlock 为中心、Provider 仅作 adapter」的产品方向不一致。

## 目标（含成功指标）

- **能力对齐**：在 Anthropic、Gemini 两种协议上，达到与当前 OpenAI 路径 **同等用户可感知能力**（流式、终止保留、工具、RN 流式可靠）。
- **体验一致**：Mobile 与 CLI 对三种协议的上述行为 **同等验收**；不因协议切换出现「终止丢字」「流式起不来」「Gemini 一开流式就报错」。
- **成功指标**（可验收）：
  - Anthropic、Gemini 各至少 1 个已保存模型，在 Mobile 与 CLI 完成下述验收清单 **100% 通过**（不含多模态 image 等 OpenAI 亦未统一支持的能力）。
  - 终止场景：流式进行中点击终止后，会话列表中 **保留** 终止前已展示的正文和/或 thinking（规则与 OpenAI 一致）；**无**「overlay 清空但库中无消息」的闪没。
  - Gemini：开启「LLM 流式」偏好时 **不再** 因 `UNSUPPORTED` 导致整轮失败（应具备流式实现或对产品显式、一致的降级策略——见验收标准）。

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile 写作用户 | 对话 Tab 使用 Claude（Anthropic）或 Gemini 模型，边生成边读、可随时终止 |
| CLI 用户 | `nm agent` / 同等 Agent 跑法，流式与终止行为与 Mobile 一致 |
| 多 Provider 用户 | 工作区切换协议后，不重新学习一套交互（终止、流式、工具） |
| 开发者 | 协议层单测 + 集成测覆盖 abort partial；RN 与 Node 分支行为可区分验证 |

## 范围

### 包含范围

1. **Anthropic 协议**
   - 流式：与 OpenAI 同级 `onStream` 事件（至少 text-delta、thinking-delta、tool-use、done）。
   - **用户终止（abort）**：中断请求后返回可落库的 partial `ContentBlock[]`；仅 thinking 时保留 thinking + **空 text** assistant 消息（与 OpenAI 规则一致）。
   - **RN SSE**：复用与 OpenAI 相同的 Core 传输策略（`postSse` / XHR），避免 `response.body === null` 导致流式失败。
   - **工具**：保持并验收与 Agent 多轮 tool_use / tool_result 闭环（与现有 Anthropic 非流式能力一致）。

2. **Gemini 协议**
   - **新增流式** API 支持（当前为 `UNSUPPORTED`）。
   - 流式事件、abort partial 落库、终止 UI 行为与 OpenAI 对齐。
   - **工具调用**：与 OpenAI / Anthropic 同级，支持 Agent 注册工具的多轮执行（在 Gemini API 能力范围内实现；若官方 API 限制须在验收中写明边界）。
   - **RN SSE**：同上，流式在 Mobile 可稳定收包。

3. **Agent / Mobile 共性（协议无关）**
   - `AgentRunner` 在三种协议下终止后均能 append partial assistant（依赖 adapter 契约，不新增「仅 OpenAI」分支）。
   - Mobile：终止时不提前清空 stream overlay；`AGENT_RUN_FINISHED`（含 `cancelled`）后先 reload 再 reset overlay（行为与现 OpenAI 一致）。

4. **验收与文档**
   - Mobile + CLI 对照验收用例（见下）。
   - 更新 Provider 能力说明：三种协议在流式/终止/工具/RN 上 **能力矩阵一致**（差异仅限厂商本身不支持的内容类型）。

### 不包含范围

- 多模态 content block（图片/音频等）在 Gemini/Anthropic 上的新增支持（除非 OpenAI 路径已统一支持且本期一并纳入；当前不强制）。
- 新增第四种 `LlmProtocolKind`（仅对齐既有 anthropic、gemini）。
- Provider 重试策略、采样配置、YAML 导入导出等非协议传输能力（沿用既有迭代）。
- 更换模型厂商、定价、合规审计。

## 核心需求

1. **协议能力矩阵对齐**：Anthropic、Gemini 在「流式、终止 partial 落库、工具多轮、RN 流式传输」上与当前 OpenAI 实现 **同级**；用户开启流式偏好时三种协议均可正常对话。
2. **终止语义统一**：用户 abort 后，adapter 返回 partial blocks（而非仅抛错）；`AgentRunner` 在有 blocks 时写入 assistant，再 `stopReason: cancelled`。
3. **仅 thinking 的终止结果**：partial 中保留 thinking；并写入 **空 text** 块，保证会话列表有 assistant 行且 UI reload 后不闪没。
4. **传输层复用**：Anthropic（及 Gemini）流式 HTTP 走 Core 统一 SSE 层，Mobile RN 与 OpenAI 相同判定与 XHR 路径。
5. **Gemini 流式与工具**：实现 Gemini 流式 chat；实现（或明确并满足）Gemini tools，使 Agent 在 `protocol: gemini` 下可跑通带 `vfs.*` 的多轮场景。
6. **双端验收对等**：每条验收标准均在 Mobile 与 CLI 可执行、结果一致（允许仅展示层差异，不允许持久化/终止语义差异）。

## 验收标准

### A. 流式（三种协议各测 1 个已保存模型）

| # | Given | When | Then |
|---|--------|------|------|
| A1 | 已选模型、流式偏好开启 | 发送一条用户消息 | Mobile：首包后 **3s 内**（网络正常）stream overlay 出现 text 和/或 thinking 增量；CLI：stdout/日志可见流式进度或最终 blocks |
| A2 | 流式进行中 | 模型持续输出 | overlay/输出随 delta 增长，不出现 `Empty streaming response body`（Anthropic/Gemini 在 RN 上） |
| A3 | 流式正常结束 | 一轮完成 | 会话中出现 assistant 消息，内容与流式结束一致；tool 轮若触发则进入下一轮或结束 |

### B. 用户终止（三种协议）

| # | Given | When | Then |
|---|--------|------|------|
| B1 | 流式已输出部分正文 | 用户点击终止 | 会话中 **保留** 已输出正文；stream overlay 在 run 结束后清除，**无**先空白再消失 |
| B2 | 流式仅输出 thinking、尚无正文 | 用户点击终止 | 会话中有 assistant 消息：含 thinking；含 **空 text** 块（或等价、列表可展示 thinking 且不占「无消息」） |
| B3 | 终止后 | 用户刷新或重进会话 | 终止前内容仍在，与终止瞬间一致 |

### C. 工具多轮（Anthropic + Gemini；OpenAI 作回归）

| # | Given | When | Then |
|---|--------|------|------|
| C1 | Agent 启用 vfs 类工具 | 模型发起 tool_use | 执行工具并 append tool_result，进入下一轮 |
| C2 | 同上 | 流式开启下完成至少 2 步 | 无 `UNSUPPORTED`；最终 assistant 可见 |

### D. Gemini 专项

| # | Given | When | Then |
|---|--------|------|------|
| D1 | Provider `protocol: gemini`、流式开启 | 发送消息 | **不** 报「Gemini does not support streaming」类错误 |
| D2 | 同上 | 终止 | 满足 B1/B2 |

### E. CLI 与 Mobile 对等

| # | Given | When | Then |
|---|--------|------|------|
| E1 | 同一项目、会话、模型 | 分别在 CLI、Mobile 执行 A1+B1 | 持久化消息语义一致（role、blocks 类型与文本/thinking 内容一致，允许时间戳不同） |

### F. 回归（OpenAI 兼容）

| # | Given | When | Then |
|---|--------|------|------|
| F1 | `protocol: openai`（如智谱） | 重复 A、B | 行为与现网一致，无回退 |

---

**生成路径**：`.apm/kb/docs/Iterations/llm-protocol-anthropic-gemini-parity/prd.md`  

请确认 PRD 范围与验收标准；确认后可进入 SPEC/实现拆分（本 skill 不产出技术方案）。
