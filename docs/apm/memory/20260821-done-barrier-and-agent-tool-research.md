---
date: 2026-08-22 00:10
title: 三合一迭代（协议合并+agent 工具+agent-config 技能）调研与实现
keywords: tool_turn_bridge, done 桥, 协议合并, agent 工具, agent-config, 内置技能, seed, 乐观锁
abstract: 调研并落地三件事——done 桥全链路移除（anthropic/gemini 出站合并相邻 user）、agent 内置工具 list/get/create/update、agent-config 内置技能（seed+删除拦截+中文报错+乐观锁修复）。含并行 worktree 显式路径 add、tdbc/core dist 重建、node:test 标题转义等经验。
---

user:
基于中断调研（见 `20260820-tool-call-interrupt-research.md`）提两件事：①去掉目前唯一的消息屏障——tool result 后插入的 done 消息（tool_turn_bridge），按 claude/openai/gemini 协议分别处理；②参照 skill 系统给 agent 提供「创建/查看 agent」的工具。

assistant:
调研结论：桥实现是 `packages/core/src/service/chat/impl/append-tool-turn-bridge.ts` 落库伪造 assistant 文本 "【done】"；参考项目（claude-code/opencode）从不伪造 assistant，补的都是 user 侧内容。去除后序列 `assistant(tool_use) → user(tool_result) → user(text)`：OpenAI mapper 输出 `tool → user` 天然合法；Anthropic/Gemini 均输出连续两条 user 且无合并兜底——1P API 软合并、Bedrock 会拒收，建议在 mapper 层做发送时合并（合并不落库）。另有一个同名 "【done】"：workplace 常驻区每步合成消息（render-prompt.ts，不落库），与屏障无关。
agent 工具底层全就绪：AgentRegistryService（list 含虚拟 seed general / get / upsert 带 validateAgentDefinition / delete），工具注册 probe 驱动无静态白名单。施工图纸照 `skill-tool.ts`（单工具多 action + 扁平字段 + ctx 闭包 + description lambda 装配期快照）；注入点是 BuiltinToolContext 加可选 agents 闭包，两个装配点（run-agent-turn 主 agent 区 + runChildAgent 区）都要注。手工同步清单：register-builtin-tools、BUILTIN_TOOL_CATALOG、双端工具计数硬编码文案、summarizeToolSuccess 分支、tool 卡片渲染、测试硬编码数字。两项并入三合一迭代 `docs/Iterations/protocol-merge-agent-tool-mermaid-sharp/`。

user:
继续干吧（确认按 spec 开工三合一实现）。

assistant:
A 线（出站合并 + 删桥）：anthropic `chatMessagesToAnthropic` 产出 wire 数组后用 `mergeAdjacentUserTurns` 纯函数压缩相邻 user（tool_result 块前置，既有 tool_result 拆分逻辑不动）；gemini 同款 `mergeAdjacentUserContents`（functionResponse part 前置，先合成 model turn 修补再合并相邻 user）；openai mapper 零改动仅追加锁定用例（23fe971/2593bad）。A4 删桥链路：core 删 append-tool-turn-bridge + bundle 字段 + port 类型 + public re-export，双端删 IPC 通道/handler/runtime 字段/ChatComposer 确认弹窗/lastMessageHasToolResult（939d69b/b8c7bdd/789df3a）；D3 不迁移存量桥消息、D4 截断后用户输入直发 runAgent。A5 收尾：存量测试 `TOOL_TURN_BRIDGE_TEXT` import 改内联 `"【done】"` 字面量（历史会话出站兼容靠字面量用例锁定；T-WP5b 原 assert.equal 常量改 notEqual 解耦语义）；public-chat-allowlist.json 移除常量；CHANGELOG Unreleased 补条目。
B 线（agent 工具）：BUILTIN_TOOL_CATALOG 8→9；`summarizeToolSuccess` 加 agent 分支（list 条数+truncated / get 定义名 / create+update「已保存 名」），须置于 generic matches/paths 分支之前——list 的 entries+total 会撞上，与 skill 同理；双端工具计数硬编码不止 spec 说的 mobile AgentEditorForm 一处，desktop AgentEditorView/AgentDefinitionEditorForm 也要，靠 grep 补齐（ToolPolicyPicker 走 catalog.length 自动适应）（28dd901/9396729）。测试 T-AG1~5 全落（含 policy：subagent/depth>=2 摘除、deny 摘除、allow 显式保留）。
经验：①同 worktree 有并行节点同时写入时，git add 必须显式路径——曾误把 A1-A3 半成品卷进提交后 reset 重做；②worktree 里 `@novel-master/tdbc-driver-better-sqlite3` 只有 src 没 dist 时，依赖它的测试（经 test/helpers/novel-master.ts）报 ERR_MODULE_NOT_FOUND，去包目录 `npm run build` 即好（core 的 dist 同理，跑测试前先 build）；③node:test 测试标题里写带双引号的代码片段要转义，esbuild transform 报错不指明是标题；④双端工具卡片摘要都消费 core 的 `block.summary`（toolCallSummary），core 加分支即双端生效，无需各自补渲染逻辑。

user:
agent 工具 description 写不下这么多对 agent 配置的描述，是不是有个内置 agent skill 更好些？——1 用户目录吧，但不允许删除，参考内置服务商；2 不用，agent 和 skill 工具不用连锁，过于复杂化了。另外直接禁止用户创建同名 skill，报错记得是中文。

assistant:
拍板：内置 `agent-config` 技能承载配置指南（索引常驻、正文按需，与 skill 系统哲学一致）；种到 global 域但不可删除，参考内置服务商三件套先例（BUILTIN_PROVIDER_ROWS 常量单源 + seed 幂等 WHERE NOT EXISTS + delete 按 isBuiltin 拦截）；不做工具-技能联动；新建/删除拦截限 global 域（project 域历史同名副本可删），中文报错。spec 探索要点：seed 挂 bootstrapNovelMaster 事务后公共路径（事务内会与 createSkillsService 外层 conn 嵌套冲突），通道走 writeSkillFile("global",...)，幂等=先 read 捕 NOT_FOUND；内置服务商真实 UI 先例是「入口保留+服务层拦截+toast」，删除入口从不隐藏，双端 UI 零改动；description 求值链单点 tool-definitions.ts L25，瘦身零测试锁定面但 z.describe 要同步精简。实现六笔：bd56cd9（seed）→ e209bbd（拦截，writeSkillFile 加 SkillWriteOptions——builtinSeed 特权通道解「seed 首次种入被自己的新建拦截挡死」的内在矛盾）→ af0d86d（description 瘦身+指路，四锚点保留）→ 5466495（T-AS1/2/6 用例）→ edadb49（存量乐观锁 bug）→ a0ebc57（empty-state 空态适配），cr-func func-ready。
测试节点经验：`openNovelMasterTestConnection` 跑的 bootstrap 已挂 seed，共享测试库天然有 agent-config，直接当「已 seed」态用；writeSkillFile 不透传 expectedVersion 时，对已存在 SKILL.md 的整文件覆盖必撞 vfs.write 乐观锁 CONFLICT（edadb49 修：core SkillWriteOptions 加 expectedVersion 透传，desktop SkillDetailView/NewSkillModal 带版本，mobile FileEditor 本就带）；empty-state.test.ts「全新库零技能」被 seed 打破属预期口径变化（a0ebc57 适配）。

user:
agent 配置怎么一进去就显示「未保存的变更」？全局技能中也没有我们的内置 agent skill。

assistant:
dirty 误报根因：mobile AgentEditorForm 的 formSnapshotJson 入参与 useMemo deps 漏传 skillsEnabled/skillsPrefixText——baseline 经展开带 prefix 非空默认值、快照侧序列化落 ""，一进编辑页即 dirty=true；连带潜伏 bug 是改技能开关/前缀不触发脏标记。7f096c4 修（desktop AgentEditorView 本就对，仅 mobile 漏）。插曲：7f096c4 提交时被用户编辑器旧缓冲把工具计数 9 覆盖回 8（hint 文案），f0c4ba1 恢复——主仓工作区有用户打开的编辑器时，提交前应对关键文件 git diff 复核（该事故本迭代共 3 次，防护规则已写入 RULE.md）。全局技能列表看不到当时是尚未实现（seed 未写），bd56cd9 落地后即现。
