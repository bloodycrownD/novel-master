---
date: 2026-08-21
dependency:
  [
    Iterations/agent-skills/prd.md,
    Iterations/agent-subagent/prd.md,
    Iterations/mermaid-fullscreen-viewer/prd.md,
  ]
---

# 三合一：协议层 user 合并与 done 桥移除、agent 管理工具、mermaid 全屏清晰度 PRD

## 背景

三项需求源自同一天的调研（apm 记忆 `20260820-tool-call-interrupt-research.md`、`20260821-done-barrier-and-agent-tool-research.md`、`20260821-mermaid-blur-research.md`）：

1. **done 桥**：目前项目唯一的"屏障消息"是 maxSteps 截断后、用户带文字续发时插入的 assistant 文本 `【done】`（`tool_turn_bridge`），需要弹窗让用户确认。对 opencode / claude-code 的调研结论：Claude API 的 user/assistant 交替是软约定（1P 自动合并连续 user turn），真正的硬约束是 tool_use↔tool_result 配对；OpenAI 协议 tool result 是独立 `tool` 角色，天然无此问题。因此**不插 done 消息也能合法**，前提是在协议适配层做发送时合并（Anthropic/Gemini 把 tool_result 消息与紧随的用户文本并进同一条消息；Bedrock 部署下合并是硬要求）。
2. **agent 管理工具**：skill 系统提供了完整样板（单工具多 action + ctx 闭包 + description lambda），`AgentRegistryService` 的 list/get/upsert（带校验）已就绪，只差以 tool 形态暴露。用户希望 agent 能创建/查看 agent。
3. **mermaid 全屏模糊**：全屏查看器用 `will-change: transform` + `transform: scale()` 缩放，合成层按 scale=1 栅格化后位图拉伸，矢量从不重绘——复杂图放大后模糊。PRD「可清晰阅读大图细节」的验收标准实际未达成。

## 目标（含成功指标）

- **A 协议合并 + 去桥**：三协议（anthropic/openai/gemini）下，maxSteps 截断后用户直接带文字续发，不插任何屏障消息，请求合法、模型可正确续接。成功指标：双端不再出现"插入【done】"弹窗；anthropic/gemini 出站 payload 中不存在连续同 role 的 user 消息；既有会话（含存量 tool_turn_bridge 消息）续聊不报错。
- **B agent 管理工具**：主 agent 可通过 `agent` 工具列出、查看、创建、更新 agent 定义。成功指标：创建的 agent 出现在三端 agent 列表并可被正常配置/调用；工具受 allow/deny 策略控制；坏定义被校验拒绝且错误信息可读。
- **C mermaid 全屏清晰度**：全屏态任意缩放档位下图表保持矢量清晰。成功指标：复杂图放大到 6x 文字边缘清晰（对照真机截图）；pinch 过程不掉帧（维持现有 transform 手势）；回归测试全绿。

## 范围

### 包含范围

- A：`anthropic-content-mapper` / `gemini-content-mapper` 的连续 user 合并；移除 `appendToolTurnBridge` 全链路（core 服务、IPC、desktop/mobile ChatComposer 弹窗与调用、相关测试）
- B：新内置工具 `agent`（action：list/get/create/update）；`BuiltinToolContext` 闭包注入；注册与策略门闩；三端工具目录/计数/渲染同步
- C：全屏查看器"手势中 transform、落定时烘焙进 SVG width/height"的缩放重构；手势纯函数换算与测试适配

### 不包含范围

- A：不迁移/清洗存量已落库的 `tool_turn_bridge` 消息（它们是合法 assistant 消息，出站无需特殊处理）；不补"截断提示"占位消息（如需 UI 上的轮次切断标记另开需求）；不新增 Bedrock 协议适配器（仅保证现有 anthropic 适配器输出满足严格交替，天然兼容）
- B：不给 AI 提供 delete 动作（照 `agent-skills` PRD L90 先例，删除仅用户 UI）；不改 agent 编辑器表单；不做工具与 `task` 候选名单的联动（D4 式同进退第一版不做）
- C：不改普通预览态（本来矢量，不糊）；不做超采样重渲染（fontSize 方案，仅在烘焙方案真机不达标时另议）；desktop 不涉及

## 核心需求

### A：协议合并与 done 桥移除

1. **Anthropic 发送时合并**：`chatMessagesToAnthropic` 输出前，把相邻的同 role user 消息合并为一条（content 块按序拼接，tool_result 块置于消息前部），保证出站序列严格 user/assistant 交替
2. **Gemini 发送时合并**：`chatMessagesToGeminiContents` 同款约束——相邻 user content 合并（functionResponse part 与 text part 可共存于同一 content），必要时保持既有合成 model turn 逻辑不受影响
3. **OpenAI 零改动**：tool result 走独立 `role:"tool"`，`tool → user` 天然合法，仅补回归用例锁定行为
4. **移除 done 桥链路**：删除双端"末条 user 含 tool_result 时的弹窗确认 + appendToolTurnBridge"路径，用户输入直接发送；`append-tool-turn-bridge.ts`、IPC handler、runtime 暴露一并移除

### B：agent 管理工具

5. **工具形态**：单工具多 action（照 `skill-tool.ts` 样板）——`agent` 工具，action 为 `list / get / create / update`，扁平显式字段，必填项在 run 内校验并报字段名
6. **可发现性**：description 为 lambda，从装配期 `agentRegistry.list()` 快照拼现有 agent 名单（name + description），模型不调 list 也知道可管理对象
7. **写入校验**：create/update 走 `AgentRegistryService.upsert`（`validateAgentDefinition`，registeredToolNames 以 probe 注册表提供）；agent id 规则与现有创建入口一致（`agent-` 前缀，非 UUID）
8. **虚拟 general 语义**：list 可见 seed `general`；get 支持按 name 查找（`get(id)` 查不到它），工具描述向模型说明该语义
9. **策略与门闩**：工具受 `tools.allow/deny` 控制；硬性摘除规则与 `task` 同款（`mode === "subagent"` 或 `depth >= 2` 摘除），第一版仅主 agent 可用

### C：mermaid 全屏清晰度

10. **落定烘焙**：pinch/双击手势落定后，把最终 scale 烘进克隆 SVG 的 `width`/`height`（以 fit 基准渲染尺寸 × scale 计 px 值，并内联解除 max-width/max-height 钳制，详见 SPEC D8）触发矢量重排重绘，同时归一手势状态（scale 回 1、pan 按比例换算），transform 复位
11. **手势中保帧率**：pinch 进行中维持现有 `style.transform` 直写（不 setState、不走重排），与现状一致
12. **边界数学适配**：`clampMermaidViewerPan` 等纯函数按新坐标系（烘焙后的基准尺寸）重算，配套 Jest 用例同步更新

## 验收标准

- Given maxSteps 截断后会话末条为含 tool_result 的 user 消息 When 用户直接输入文字发送 Then 不弹窗、不插桥，模型正常续接回复
- Given 同上场景 When 分别以 anthropic / gemini 模型发送 Then 出站 payload 无连续 user 消息（合并进单条），API 不报 400
- Given 历史会话含存量 `【done】`桥消息 When 续聊 Then 出站合法、显示无异常
- Given 主 agent 调 `agent` list Then 返回全部 agent（含 general）的 name/description/mode
- Given 主 agent 调 `agent` create 传入合法定义 Then agent 创建成功，三端列表可见、可被 `task` 调用（若 mode 合规）
- Given create 传入未注册工具名/缺 prompts When 执行 Then 校验失败，错误信息含具体字段与原因
- Given agent 被 `tools.deny` 含 `agent` When 运行 Then 工具不出现在该 agent 的注册表
- Given 全屏态复杂图 When 放大至 6x（pinch 或双击） Then 手势结束后文字与线条边缘清晰（真机截图对比）
- Given pinch 进行中 Then 缩放跟手不掉帧（体感与现状一致）
- Given 双击在原始/2.5x 间切换 Then 落定后同样清晰，边界 clamp 行为不回归

## 风险

- **A 的合并改出站序列**：缓存前缀（prompt cache）对消息边界的敏感——合并改变了 user 消息切分，可能导致首几轮缓存失效多消耗 token；可接受（一次性切换成本）
- **A 删除桥是行为变更**：`vfs-flush-insert-after-assistant` spec 已把"末条 user 含 tool_result 走 bridge 弹窗"写为既定语义，需同步更新该文档注记，避免后人按旧文档排查
- **B 的 AI 写定义**：AI 写入坏定义可能影响后续 run 装配——由 upsert 校验拦截；agent 定义是长存数据，不进消息 checkpoint（照 skill 先例 SPEC L25），消息回滚不波及
- **B 的三端同步遗漏**：工具计数硬编码文案（双端表单与测试）是历史上最易漏的同步点，spec 列 checklist 盯
- **C 的烘焙重排耗时**：超大图 6x 下矢量重排可能有可感延迟（百 ms 级）——落定后才发生，可接受；若真机不达标再评估超采样方案
- **C 的坐标系改造**：pan clamp 假设变更，回归面集中在 `mermaid-fullscreen.test.ts` T-MF2

## 依赖与关联迭代

- A 依赖本轮 apm 调研结论（外部参考 `.reference/opencode`、`.reference/claude-code`，仅本地参考不入库）
- B 的样板与同步清单来自 `Iterations/agent-skills`（spec L55-66）；agent 定义与注册表现状来自 `Iterations/agent-subagent`、`Iterations/agent-system`
- C 是 `Iterations/mermaid-fullscreen-viewer` 的清晰度补丁，复用其全部结构
