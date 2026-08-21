# 调研：done 屏障去除的协议可行性 + agent 创建/查看 tool 设计摸底

日期：2026-08-21
前置：见 `20260820-tool-call-interrupt-research.md`（opencode/claude-code 中断衔接调研）

## 背景

基于中断调研结论，用户提出两件事：① novel-master 目前唯一的消息屏障是 tool result 后插入的 done 消息（tool_turn_bridge），想去掉，改为按 claude/openai/gemini 协议分别处理；② 参照 skill 系统，给 agent 提供"创建/查看 agent"的 tool。

## 结论摘要

### done 屏障（tool_turn_bridge）

- 实现：`packages/core/src/service/chat/impl/append-tool-turn-bridge.ts` 落库 assistant 文本 `"【done】"`（metadata kind=tool_turn_bridge）。触发：maxSteps 截断后末条 user 含 tool_result、用户带文字续发时，ChatComposer 弹窗确认后先插桥再发（desktop L449-452/603-612，mobile sendWithBridgeIfNeeded）。
- 去除后序列 `assistant(tool_use) → user(tool_result) → user(text)`：OpenAI mapper 输出 `tool → user` 天然合法；Anthropic/Gemini mapper 均输出连续两条 user 且无合并兜底——1P API 会自动合并（软行为），Bedrock 会拒收。
- 建议路径：在 adapter/mapper 层做**发送时合并**（Anthropic：tool_result 块与用户文本并进同一条 user 消息；Gemini：并进同一 user content 的 parts），落点是 `normalizeForLlmExport` 的 per-provider 后处理；合并不落库。
- 关键差异：`【done】`是**伪造的 assistant 落库消息**；参考项目（claude-code/opencode）从不伪造 assistant，补的都是 user 侧内容（合成 tool_result + 中断声明文本）。UI 呈现可改为 user 侧文本（如"[已达最大步数上限]"），弹窗可顺势移除。
- 另有一个同名 `"【done】"`：workplace/worktree 常驻区每步合成消息（render-prompt.ts，不落库），与屏障无关，不受影响。
- 测试与文档同步面：`user-vfs-turn.service.test.ts`、`normalize-for-llm-export.test.ts`、`docs/Iterations/agent-prompt-save-and-vfs-ua-bugfix/bugs/vfs-flush-insert-after-assistant/spec.md` 中"末条 user 含 tool_result 走 bridge 弹窗"的既定语义。

### agent 创建/查看 tool

- 底层全就绪：`AgentRegistryService`（list 含虚拟 seed general / get / upsert 带 validateAgentDefinition 校验钩子 / delete）；工具注册 probe 驱动无静态白名单（registerBuiltinTools → resolveAgentToolRegistry policy 过滤）。
- 施工图纸：`skill-tool.ts`（单工具多 action + 扁平字段 + ctx 闭包 + description lambda 装配期快照）+ `docs/Iterations/agent-skills/spec.md` L55-66 接入清单。
- 建议形态：`agent` 工具，action = list/get/create/update（delete 照 skill 先例 PRD L90 留给用户 UI）；get 需处理虚拟 general（get(id) 查不到，支持 by-name）。
- 注入点：BuiltinToolContext 加可选 `agents?` 闭包；两个装配点（run-agent-turn.ts 主 agent 区 + runChildAgent 区）都要注。
- 手工同步清单：register-builtin-tools.ts、BUILTIN_TOOL_CATALOG（config-forms/agent/agent-tool-catalog.ts）、双端工具计数硬编码文案、summarizeToolSuccess 分支、tool 卡片渲染、测试硬编码数字。
- 待拍板：子 agent 是否可创建 agent（若限，在 resolve-agent-tool-registry.ts 加硬性摘除，照 task 的 depth 门闩先例）。

## 状态

2026-08-21：两项已并入三合一迭代 `docs/Iterations/protocol-merge-agent-tool-mermaid-sharp/`（prd.md + spec.md 已落盘，待确认后走实现）。

## 未闭合

- Gemini 对连续 user content 的实际行为未实测（子代理"会被拒"是推断）；动手前建议实测或反正 mapper 合并。
- agent-subagent PRD 提到的 runRunAgentAction（事件旁路）现行位置未定位。
