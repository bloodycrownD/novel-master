---
date: 2026-07-19
dependency: Iterations/chat-assistant-tag-and-mobile-tab/prd.md
---

# remove-content-inline-thinking-cleanse Bug PRD

## 背景

协议入站曾对助手 `content` 做内嵌「思考」清洗：拆 `<thought>` / `<thinking>` / `>thought`，并把成对反引号 `` `...` `` 间内容抽进 thinking。本意是兜住把推理漏进正文的脏网关，但也会误伤用户故意让模型在正文里写的 COT，以及普通 Markdown 行内代码。父级迭代关注伪标签可见性；本项纠正「正文清洗应由用户正则决定，而非框架强制」的边界。

## 现象描述

- 正文里的思考类标签或反引号片段被 Core 在定稿时抽走，气泡与「查看提示词」正文可能对不上用户预期。
- 流式阶段常还能看见原文，结束后（或提示词预览）标签消失。

## 复现步骤

1. 让模型在助手正文中输出含 `<thought>…</thought>` 或讨论用伪 XML 的内容（或含行内反引号代码）。
2. 等流式结束，查看气泡正文与「查看提示词」对应段落。

## 预期行为

- 仅当协议提供专用字段（如 OpenAI `reasoning_content`、Gemini `thought: true`）时，映射为 thinking 块。
- `content` / 普通文本 part **原样**进入 text 块；是否剥离交给用户配置的正则。
- 不再因成对反引号把内容抽成 thinking。

## 实际行为（修复前）

- 定稿路径调用 `cleanseReplyTextAndThinking` / `splitInlineThinkingFromText`，从 content 挖标签并可能抽反引号内容。

## 影响范围

- `packages/core` LLM 协议入站（OpenAI / Gemini mapper 与 SSE finish）。
- 依赖「finish 从 content 挖标签」的单测断言。
- 不改变聊天 UI sanitize、不改变用户正则引擎本身。

## 验收标准

- [ ] 无 `reasoning_content` / `thought: true` 时，content 中的 `<thought>…</thought>` 留在 text 块。
- [ ] 有结构化思考字段时，仍映射为 thinking；正文不因内嵌清洗被改写。
- [ ] 成对反引号内容不再被抽进 thinking。
- [ ] 相关 core 协议单测通过。

## 回归测试要点

- OpenAI `reasoning_content` → thinking。
- Gemini `thought: true`（含 signature）→ thinking。
- 流式 text-delta 直通；finish 后 text 保留内嵌标签样例。
