# Prompt LLM 输入与 Token 统计口径统一 PRD

## 背景

Novel Master 的 Prompt 引擎在 [prompt-engine](../prompt-engine/prd.md) 中约定：`text` 块（任意 `role`）经宏展开后按 block 顺序拼接，每条段以 `{role}:` 为前缀——**所见即所得**。

后续 [agent-system](../agent-system/spec.md) 实现 `buildPromptLlmInput` 时，仅将 `role: system` 的 text 块并入 LLM `system` 字段；`user` / `assistant` 的 text 块**不进模型、不进 token 统计**，但「真实提示词」预览（`buildPromptPreviewSegments` / `formatPromptLlmInputForCli`）仍会展示它们。

实际使用中，作者常把 `{{.worktree}}` 放在 `role: user` 的 context 块（而非 system）。导致：

- 真实提示词页显示大量 worktree 内容；
- 聊天页 token 占用、压缩阈值、CLI `--tokens` **未统计**该部分；
- Agent 实际发送给模型的 prompt **也不含**该块——与预览严重不一致。

## 目标

| 目标 | 成功指标 |
|------|----------|
| 单一拼接路径 | `buildPromptLlmInput`、真实提示词预览、token 统计、CLI `prompt render` 共用同一 assembly 逻辑 |
| 任意 role 的 text 块进模型 | `user` / `assistant` text 块（宏已展开）按 block 顺序注入 LLM `history`，`system` 块仍走 `system` 字段 |
| Token 口径对齐 | hide 消息后 token 下降仅来自可见 chat 消息；worktree 宏块 token 不随 hide 消失 |
| 可验证 | Core 单测 + CLI `--tokens` 与 `render` 输出长度/内容一致性用例 |

## 用户与场景

| 角色 | 场景 |
|------|------|
| Mobile 对话用户 | 顶栏 token 与「真实提示词」一致；hide 历史后 worktree 占用仍可见 |
| Agent 作者 | 在 user 块放 `{{.worktree}}`，模型实际收到与预览相同上下文 |
| 运维 / 调试 | `nm prompt render --tokens` 与 stdout 渲染文本同一口径 |

## 范围

### 包含

1. **Core**：抽取 `buildPromptAssembly`；重构 `buildPromptLlmInput`、`buildPromptPreviewSegments`、`formatPromptLlmInputForCli`、`serializePromptLlmInput`。
2. **Token 计数链**：`countPromptLlmInput` 入参或序列化路径对齐 assembly（Core + NMTP drivers）。
3. **AgentRunner**：无需改调用方式，行为随 `buildPromptLlmInput` 自动修正。
4. **Mobile（小改）**：hide/show/压缩后刷新 token 顶栏（当前未调用 `refreshChatTokenLabel`）。
5. **文档 / 测试**：更新相关 SPEC 引用；补充回归用例。

### 不包含

- 宏刷新时机（agent 更新、目录规则 invalidate）——行为不变，另迭代可文档化。
- `chat` 块内消息宏替换（仍不做）。
- 多 `chat` 块（产品禁止；实现按至多一个 chat 块）。
- PromptBlock `when` 条件过滤（若未来恢复，assembly 层统一过滤）。

## 验收标准

### LLM 输入

- [ ] **Given** Agent 含 `role: user` text 块且 `content: "{{.worktree}}"`，**When** `buildPromptLlmInput`，**Then** `messages` 在对应 block 位置含一条 synthetic user 消息，正文为展开后的 worktree 文本。
- [ ] **Given** 同上配置，**When** AgentRunner 发 LLM 请求，**Then** adapter 收到的 history 含该 user 消息（OpenAI/Anthropic 协议单测或集成测锁定）。
- [ ] **Given** 仅 `role: system` text 块，**When** `buildPromptLlmInput`，**Then** 行为与现网等价（`system` 有值，`messages` 仅 chat 历史）。

### Token / 预览一致

- [ ] **Given** 任意 blocks + ctx，**When** 分别调用 `formatPromptLlmInputForCli` 与 `serializePromptLlmInput`（新签名），**Then** 输出字符串**完全一致**。
- [ ] **Given** user 块含 10K 字符 worktree、chat 仅 2 条短消息，**When** hide 其余消息后 token 计数，**Then** 计数仍包含 worktree 对应 token（显著高于仅消息之和）。
- [ ] **Given** Mobile 手动 hide 消息，**When** 操作完成，**Then** 顶栏 token 数字更新（非 stale）。

### 回归

- [ ] **Given** 仅 system + chat 的典型 Agent（如 examples/agents.yaml writer），**When** 对比改动前后 token 计数，**Then** 差异仅来自 system 段 `system:` 前缀统一（若有），消息部分不变。
- [ ] Core / CLI / Mobile 相关测试全绿。

## 风险

| 项 | 说明 |
|----|------|
| **行为变更** | 此前 user/assistant text 块不进模型；改动后**会进模型**，可能影响已有 Agent 对话效果与 token 阈值 |
| **Token 数值跳变** | 统一 `system:` 前缀后，纯 system Agent 的 token 计数可能略增 |
| **Synthetic 消息** | template 消息需稳定 id/结构，避免干扰 tool_result 配对逻辑 |
