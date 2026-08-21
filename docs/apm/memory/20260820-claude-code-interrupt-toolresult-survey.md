# claude-code 中断后消息衔接机制调研

## 请求

用户（主代理）要求以 readonly 模式探索 `.reference/claude-code` 仓库，弄清该 agent 应用在 tool call / tool result 被中断（Esc 打断、abort、出错、会话恢复）之后，如何把消息序列与下一条 user 消息衔接起来，以满足 Anthropic API 的 assistant/user 交替与 tool_use→tool_result 约束。

## 调研要点

1. 中断时对未完成 tool call / tool result 的处理（合成占位 tool_result / 标记状态 / 丢弃）
2. transcript（.jsonl）里中断时刻的消息形态
3. 重新组装请求时保证交替约束的补齐/合并/重排逻辑
4. 中断占位消息与用户新输入的排列关系

## 结论

见同日探索报告（本文件为请求记录）。核心发现：

- 中断统一走 `AbortController`，abort 后为所有未完成 tool_use 合成 `tool_result`，占位文本 "User interrupted" / "(no content)"，`is_error` 部分场景为 true。
- transcript 侧有专门的 stringifier（`formatToolResult` / `tool_use2fu` 等）把中断 tool_result 序列化成文本。
- 请求组装侧（`buildApiRequest` / `normalizeMessages` 等）有兜底：连续同角色消息合并、孤立 tool_use 自动补 "(no content)" tool_result、tool_result 未配对时补合成 assistant。
- 用户打断后的新输入作为新的 user 消息追加，紧跟在含中断 tool_result 的合成 user 消息之后，天然满足交替约束。

详细证据以探索报告返回内容为准。
