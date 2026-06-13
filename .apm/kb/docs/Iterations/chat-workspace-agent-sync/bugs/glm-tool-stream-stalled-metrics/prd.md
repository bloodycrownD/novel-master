---
date: 2026-06-13
dependency: Iterations/chat-workspace-agent-sync/prd.md
---

# glm-tool-stream-stalled-metrics Bug PRD

## 背景

`chat-workspace-agent-sync` 约定：LLM 流式生成 tool 参数时，底部 metrics 条应显示「工具调用生成中」及工具参数字数。真机使用智谱 `zhipu/glm-4.7` 测试大文件 write 时，思考结束后长时间无反馈。

## 现象描述

思考块内容已结束（或视觉上已完成），Agent 仍在运行（红色停止按钮），但：

1. Status bar 长时间停留在「生成中 · Ns · 正文 0 字 · 思考 M 字」
2. 不出现「工具调用生成中」前缀
3. 不显示工具参数字数
4. 气泡内无「工具调用」块（流式阶段属预期，见下）

## 复现步骤

1. Mobile 连接智谱 GLM-4.7（OpenAI 兼容协议）
2. 发送会触发大参数 write 工具的消息（如「写一个 5000 字的文件」）
3. 观察思考流结束后至 assistant 落库前的 metrics 条与气泡

## 预期行为

| 阶段 | UI |
|------|-----|
| 思考流式输出 | 「生成中 · 思考 N 字」 |
| 工具参数开始流式输出 | 「工具调用生成中 · 工具参数 N 字」 |
| assistant 落库、tool 执行中 | 气泡「正在执行工具调用…」 |
| tool_result 落库 | 「工具调用 (N)」卡片 |

## 实际行为

- 思考结束后 metrics 长时间不变，像「卡住」
- 大 write 场景可达数十秒无任何工具相关反馈
- 部分场景即使收到 tool delta，前缀仍为「生成中」而非「工具调用生成中」

## 影响范围

- 智谱 GLM-4.6 / 4.7 / 5 系列（OpenAI 协议路径）
- 大参数工具调用（write / edit 等）
- Mobile 与 Desktop metrics 条

## 验收标准

- **Given** GLM-4.7 流式请求且携带 tools  
  **When** 模型开始输出 tool_calls.arguments 增量  
  **Then** metrics 显示「工具调用生成中」及递增的工具参数字数

- **Given** 思考已结束、正文仍为 0、工具参数开始增长  
  **When** 用户查看 metrics  
  **Then** 前缀为「工具调用生成中」（非「生成中」）

## 回归测试要点

- 非 GLM 模型请求体不含 `tool_stream`
- 短工具调用、纯文本回复 metrics 行为不变
- Anthropic / Gemini 工具流不受影响
