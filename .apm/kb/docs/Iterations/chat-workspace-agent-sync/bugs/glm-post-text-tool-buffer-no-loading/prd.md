---
date: 2026-06-29
dependency: Iterations/chat-workspace-agent-sync/prd.md
---

# glm-post-text-tool-buffer-no-loading Bug PRD

## 背景

`chat-workspace-agent-sync` 采用**两事件模型**展示工具进度：stream tail「工具调用中」（事件 1）+ assistant 落库后 pending 工具卡（事件 2）。事件 1 当前判定要求 **有过 thinking、无正文、thinking 空闲 ≥300ms**；同时迭代中移除了智谱 GLM 所需的请求体字段 `tool_stream`。

真机使用 **GLM 5.2**（OpenAI 兼容）时，模型常见路径为 **thinking → 对用户说一段话（正文）→ 再发起 tool_call**（同属一条 assistant 消息，符合 OpenAI 协议）。正文流完后，智谱在未开启 `tool_stream` 时会**长时间缓冲整段 tool JSON**，期间：

- stream tail **不显示**「工具调用中」
- 底部 metrics **仍在计时**（属设计：仅计正文/思考字数，不含 tool）
- 用户点**终止**体感「无事发生」，回合稍后仍可能跑完

其他模型因 tool 参数更易流式到达、或习惯「先 tool 后说话」，事件 1 往往正常。本 bug 为 **GLM 行为 + 事件 1 判定过窄** 的叠加回归，父级 PRD 验收标准第 1 条在 GLM 5.x 路径上未满足。

与历史 `glm-tool-stream-stalled-metrics` 的关系：彼 bug 针对 **metrics 条 tool 字数**；本 bug 针对 **两事件模型事件 1（stream tail 横条）** 与 **终止体验**，可恢复 Core 侧 `tool_stream` 请求字段，但**不恢复** `TOOL_USE_DELTA` 与 metrics tool 计数。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 正文后 tool 等待期有明确进度反馈 | GLM 5.x 工具回合：正文流结束、assistant 未落库前，**≤500ms** 内 stream tail 稳定显示「工具调用中」（WebView transcript 与 legacy RN 一致） |
| 缩短 GLM tool 静默期 | 开启 `tool_stream` 后，大参数 write 场景 tool latch 明显早于「整轮结束」（可手工对比修复前后首包 tool delta 延迟） |
| 终止可感知、可生效 | 正文后空等阶段点终止：**≤2s** 内 UI 回到未运行态；**不执行**后续 tool；会话**不残留**半完成 tool 回合（无 orphan assistant+tool 落库） |
| 不破坏两事件模型 | metrics **仍不**显示 tool 参数字数；**不**在流式中途渲染 per-tool 参数块 |
| 双端一致 | Mobile + Desktop 在同等 stream 条件下均显示事件 1（Desktop 补齐 latch 接线） |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile 写作用户 | GLM 5.2 Agent 调 vfs write/edit，模型先回复一句话再调工具 |
| 模板/项目维护者 | Desktop 聊天工作区使用智谱 GLM 系列，同类 tool 回合 |
| 开发者 | 需从行为上满足父级 `chat-workspace-agent-sync` 验收第 1 条，而非仅 GPT 路径 |

## 范围

### 包含范围

1. **Core**：智谱 GLM（4.6 / 4.7 / 5.x）流式且携带 tools 时，请求体注入 `tool_stream: true`
2. **事件 1 补强**：在 **已有正文**、agent 仍运行、尚未 assistant 落库时，正文停流 ≥300ms 也应显示「工具调用中」（与 thinking-only 路径并存）
3. **Mobile**：`useStreamToolInvoking` / `useStreamToolInvokingDisplay` / `useChatStreamRuntime` 接线调整；首包正文不再误伤已建立的 tool latch（若适用）
4. **Desktop**：启发式与 latch 与 Mobile 对齐（`useStreamToolInvoking` 副本 + `ConversationPanel` / `useAgentStream` 订阅 tool-use）
5. **终止体验（P1，同迭代交付）**：点终止后即时清理 stream 展示；abort 后 runner **不**落库含 `tool_use` 的 assistant、**不**进入 tool 执行
6. 自动化单测覆盖上述 Core / hook 行为

### 不包含范围

- 恢复 `EVENT_AGENT_STREAM_TOOL_USE_DELTA`、`toolUseChars`、metrics「工具调用生成中」前缀
- transcript 内流式展示 tool 参数 JSON
- 恢复 SSE 90s stall 自动 abort
- `toolRunner.runParallel` 执行期可中断（本地 tool 已落库后的长执行，另开迭代）
- 非 OpenAI 协议（Anthropic / Gemini）行为变更

## 核心需求

1. GLM 型号在流式 tool 回合中启用 `tool_stream`，使 `tool_calls` 可增量到达，尽早触发 `EVENT_AGENT_STREAM_TOOL_USE` latch。
2. 扩展事件 1 判定：除「thinking 后无正文」外，支持「**正文后等待 tool**」（`agentRunning` + 有正文 + 正文 idle ≥300ms + 本轮尚未 step committed assistant）。
3. Mobile WebView stream tail 与 legacy `MessageList` 在两种路径下均显示「工具调用中」横条。
4. Desktop 订阅与 Mobile 相同的 tool-use latch，避免 GLM 路径仅 Mobile 修、Desktop 仍缺 loading。
5. 用户点终止后：立即重置 stream UI；LLM 请求断开；若已 abort，**不** persist 含 `tool_use` 的 assistant，**不**调用内置 tool。
6. 非 GLM / 无 tools 请求 **不**携带 `tool_stream`；既有 GPT 工具流行为无回归。

## 验收标准

### 事件 1（loading）

- **Given** GLM 5.2、流式、携带 tools，模型输出 thinking 后输出正文、尚未落库  
  **When** 正文停流 ≥300ms  
  **Then** stream tail 显示「工具调用中」

- **Given** 同上，且 `tool_stream` 已生效  
  **When** 首个完整 `tool_use` 经 bus 到达  
  **Then** latch 保持「工具调用中」直至 assistant step committed 后 stream reset

- **Given** GPT-4o 等同路径  
  **When** 原有 thinking-only-then-tool 场景  
  **Then** 行为与修复前一致或更好，无多余横条闪烁

### 终止

- **Given** 正文已流完、处于 tool 缓冲空等、assistant 未落库  
  **When** 用户点终止  
  **Then** ≤2s 内 composer 回到可发送态；stream tail 清除；**无**新 assistant(tool) 消息；**无** tool_result

### 事件 2 与 metrics（回归）

- **Given** assistant 已落库含 `tool_use`  
  **When** tool 执行中  
  **Then** pending 工具卡显示「执行中」（既有行为）

- **Given** 任意流式回合  
  **When** 查看 metrics 条  
  **Then** 仅「生成中」+ 计时 + 正文/思考字数；**无** tool 参数字数

### 自动化

- Core：`glm-tool-stream` 型号判定 + `openai.adapter` buildBody 单测通过
- Mobile：`use-stream-tool-invoking` / `use-chat-stream-runtime` 新增用例通过
- Desktop：`use-stream-tool-invoking` 对等用例通过（若改 desktop hook）

## 风险与待确认项

- 智谱网关对非 GLM 误匹配 `tool_stream` 的兼容性（通过严格型号判定降低）
- RN 真机长静默 abort 是否立即断连：代码层保证 signal→xhr.abort；若真机仍延迟，需在发布说明中标注已知限制
- 父级 PRD 曾写明废弃 `tool_stream`：本 bug 为 **GLM API 合规的定向恢复**，不改变「不恢复 delta 计数」原则
