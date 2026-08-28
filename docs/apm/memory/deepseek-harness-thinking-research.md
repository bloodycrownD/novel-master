# APM 记忆：调研 deepseek-harness 的 thinking/reasoning 回传实现

## 2026-08-27 对照业界做法调研 thinking 回传策略

用户请求：readonly 探索 `.reference/deepseek-harness/`，搞清楚 LLM 思考内容（thinking/reasoning）如何进入后续请求上下文，与 novel-master 的「思考提示词」开关（同回合工具循环保留、跨用户轮剥离、openai 协议出站丢弃 thinking 块）做对照。

关注点：
1. thinking/reasoning 的数据形态（消息块结构、signature 字段）
2. 出站 mapper（anthropic/openai/gemini）把 thinking 块映射到 wire 的什么字段
3. 保留策略（工具循环内 / 跨用户轮 / 协议最低保留）
4. openai 系协议（含 deepseek reasoning_content）的处理
5. 用户可配置开关

结论摘要（详细报告见当轮对话）：
- 中立消息模型：`ReasoningBlock { type:'reasoning', text }`，无签名字段；签名等原生元数据放消息 source 的 `replayState`（adapter-private ReplayEnvelope），pi-ai 的 envelope 含 thinkingSignature/textSignature/thoughtSignature/redacted。
- 出站：llm-deepseek 把 reasoning 合并成 `reasoning_content` 回传（所有带 reasoning 的轮，不限工具轮）；llm-pi-ai 经 toPiAssistant 恢复签名重建 pi-ai thinking 块，无 replayState 时降级为无签名中立历史（仍回传文本）。
- 保留策略：deriveMessages() 直接投影 session 表面，工具循环内与跨用户轮都原样回传，无剥离逻辑；压缩后 reasoning 随旧历史被 summary 替换。
- 开关：终端用户只有 reasoningEffort（off/low/high/max…）；部署级 cordis.yml 有 thinking: enabled|disabled 与 pi-ai compat 开关（requiresThinkingAsText、requiresReasoningContentOnAssistantMessages、allowEmptySignature、forceAdaptiveThinking、thinkingFormat 十种）。
- 仓库内无 gemini 代码；anthropic/openai wire 细节在 pi-ai 库（^0.82.1）内不在仓库。
- 与 novel-master 差异：他们从不剥离、openai 出站不丢弃（reasoning_content 回传 / <thinking> 文本），空 reasoning_content 也须原样回传（DeepSeek 400 风险）。
