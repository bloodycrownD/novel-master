# D2-agent-tool：agent-tool 切片

## 元信息

- 模块：agent-tool（`domain/agent` + `domain/tool` + `service/agent`）
- 文件范围：domain/agent 14 文件 / ~752 行；domain/tool 14 文件 / ~1 727 行；service/agent 15 文件 / ~1 684 行；合计 43 文件 / ~4 163 行（agent_definition 1 张表）
- 相关 Iterations：`agent-system`、`agent-config-and-compaction`、`agent-model-decouple`、`agent-config-shape`、`tool-system`、`tool-system-v2`、`agent-prompt-abstract-block`、`vfs-zip-io-agent-tool-policy`、`agent-vfs-tool-suite`、`agent-resilience-mobile-yaml`、`agent-chat-ux-bugfix`（abort-retain-partial）、`agent-subagent`（2026-08-05 新立，尚未实现）、`agent-prompt-save-and-vfs-ua-bugfix`、`agent-stream-tool-ux`、`agent-worktree-block-ui`、`chat-rollback-vfs-tool-fixes`、`chat-tool-turn-phase-ui`、`implementation-simplification`、`core-explore-remediation`（events-reliability / message-checkpoint-and-agent 两个 feature）
- lens 命中：L1✓（agent_definition 单表稳，created_at_ms 隐式不变式）、L2✓（regex / token-cache 热路径，agent-runner 是调用方）、L3✓（顶层 index 暴露 tool runtime，agent 走 subpath）、L4✓（append+capture+append 链无事务 A）、L5✓（abort 三分支 + sub-agent 脱离活动守卫 A）、L6✓（mobile agent-yaml 文名校验 + token 计数三端）、L7✓（capture 失败孤儿无测试 A）、L8✓（tool policy 缺白名单/配额 A）、L9✓（@deprecated alias + vfs-tools 输出类型外露）、L10-、L11✓（spec churn 间接命中）
- 轮次：第 2 轮（phase2-slice）

## 模块画像（叙述式）

这个切片管的是「LLM 怎么在会话里多轮跑工具」整条链——上游吃 `AgentDefinition`（YAML/JSON 反序列化成 zod 校验过的 wire 文档），下游写 `chat_message` / `message_checkpoint` / `vfs_revision`，侧门通过 `eventBus` 把流式 delta、step committed、run finished 这些信号甩给 events 模块的 DAG。`AgentRunner` 是整条链的核心异步状态机：每个 step 里先把可见消息 + workplace 前缀 + customAttach 拼成 prompt（`prepareUserMessagesForPrompt` + `assembleWorkplaceDisplay`），算要不要压缩，再调 `ModelRequestService.request` 拿 LLM 输出，落 assistant 消息，跑 `ToolRunner.runParallel`（同 path tail 串行 / 跨 path 并行，并发 8），把 tool_result 当 user 消息追加，循环到无 tool_use 或撞 maxSteps。abort 是显式 `signal?.aborted` 在循环内 7+ 处采样，不是统一的取消通道。整体依赖关系是：agent 依赖 chat（消息 + attachment）、prompt（layout 渲染）、provider（model 请求）、tool（registry/runner/builtin）、vfs（scoped service）、session-kkv（file_cache + rule snapshot）、message-checkpoint（capture）、events（orchestrator）、regex（channel 替换）、depth（可见切片）。

`domain/agent` 这边很薄：`AgentDefinition` 模型 + zod schema + 单表 sqlite 仓储 + 5 个纯逻辑（doom-loop、validate-definition、validate-tool-policy、resolve-saved/application-model-id、resolve-agent-tool-registry） + AgentSession port（InMemory / Chat / EphemeralOverlay 三实现）。`domain/tool` 这边也薄：Tool 模型 + registry + runner + fs-command 解析 + tool-output-limits + builtin（vfs-tools 6 个 + chat-grep-tool 已废） + builtin-tool-context。重的全在 `service/agent`：`agent-runner.ts` 单文件 22KB，是全仓库最复杂的异步状态机；`run-agent-turn.ts` 15KB，是聊天发送的编排入口；剩下的 service factory / shared / lifecycle helpers 都是给它打杂的。

被谁依赖呢——三端 runtime（CLI / desktop / mobile）经 `public/agent.ts` 这个 subpath facade 拿 runner 工厂、registry 服务、turn 编排、doom-loop 工具和错误类型；`ToolRegistry`/`ToolRunner`/`createVfsTools`/`registerBuiltinTools` 这几个 tool runtime 符号被顶层 `src/index.ts` 直接 re-export（是顶层唯一一个 domain/* 直通的例外，原因写在 D1-03：tool runtime 被当跨语境基础设施）。下面会专门讲：顶层 index 还顺手 re-export 了一堆 `@deprecated` alias，是切片发现的债务之一。

## 功能正确性核对

逐条对了一遍 `agent-system` / `agent-config-shape` / `agent-model-decouple` / `tool-system-v2` / `agent-prompt-abstract-block` / `vfs-zip-io-agent-tool-policy` 的 PRD 与当前代码——对得齐的是大头，但有几条偏离很显眼，单角度没人标过，是切片这次的核心交付。

**对得齐的（不展开）**：`agent-system` PRD 的 `maxSteps` 循环 / doom-loop / streaming / AgentSession 抽象 / chat 持久化适配，代码全部落地（`agent-runner.ts` L132-548、`doom-loop.ts`）；`agent-model-decouple` PRD 要求 AgentDefinition 不再嵌 `model.params`、加可选 `preferredModelId`，代码已更进一步——`agent-config-shape` 又把 `preferredModelId` 改名为 `model`，schema L148-160 显式拒绝 `preferredModelId` / 嵌套 `model` 块，验收「含旧字段校验失败」对齐；`vfs-zip-io-agent-tool-policy` PRD 的 allow/deny 互斥、空白名单 = 无工具、未知工具名报错，`validate-agent-tool-policy.ts` 全部覆盖。`agent-runner.ts` L462-470 的 capture 已经从 `void capture().catch(()=>undefined)`（探索报告 explore-agent P2 标过）改成 `try/catch + throw`，不再静默吞错——这条历史债务已经修了。

**偏离一：`chat_grep` 工具被废，但 `tool-system-v2` PRD 把它列为必须的第 7 个工具**（见 S1，下文）。这条没人标过，是切片首号新发现。

**偏离二：`prompts` 形态又改了一轮，超出列举的迭代**（见 S2）。`agent-prompt-abstract-block` PRD 定稿的 `type: abstract` 块在当前 schema 里完全不存在；`agent-config-shape` PRD 定稿的 `prompts.blocks` 数组/map 也不在了——`agent-definition.schema.ts` L84-113 的 `promptsDocumentSchema` 现在是 `system: string` + `persist: Record` + `dynamic: Record` + `persistEnabled` + `dynamicEnabled` + `workplace` + `customAttach`。`customAttach` 的来源能追到 `agent-config-extra-info-and-workplace-cleanup`（2026-08-04 spec L56-66），但 `system/persist/dynamic` 这套主体形状在所有列举的迭代里都没出现过——只能推测是更早某次没列入清单的迭代（候选：`agent-prompt-save-and-vfs-ua-bugfix` / `implementation-simplification` 之一）落地的。这不是 bug，是迭代清单和实际代码的漂移。

**偏离三：`EVENT_SESSION_MESSAGE_RECEIVED` 故意脱离 `publishRunLifecycle` 门控**（见 A1）。这条最早是 explore-agent P1 标过、后来 `events-reliability` SPEC L199-213 + L347 锁定为 intentional 并加了 R4/R5 测试。切片确认了它确实是「文档化的 intentional」，但叠上未实现的 `agent-subagent`（sub-agent 用 `persistMessages:true, publishRunLifecycle:false`）会产生新的相互作用，下文展开。

**偏离四：`runAgentTurn` 不透传 `persistMessages` / `publishRunLifecycle` 给 `runner.run`**（见 A2）。`run-agent-turn.ts` L341-352 的 `runner.run({...})` 调用只传 6 个字段，lifecycle 两个字段永远走 runner 内的默认值（`true`）。这意味着这个公共入口被硬编码为主对话用，事件 action 和未来的 subagent 工具必须自己构造 runner 调用——和 `agent-subagent` SPEC L346-351 一致，但公共面契约没把这件事说清楚。

## 交叉发现（核心产出）

### S1 `chat_grep` 工具已废，但 `tool-system-v2` PRD 把它列为必备工具

- 涉及角度：功能正确性核对（代码 vs spec）+ L9（@deprecated 残留）+ L8（公共面）
- 位置：`domain/tool/builtin/chat-grep-tool.ts:1-7`（`@deprecated 废弃。chat_grep 已从 registerBuiltinTools 移除`）；`domain/tool/builtin/register-builtin-tools.ts:18`（`// 废弃：chat_grep 不再注册（实现保留于 chat-grep-tool.ts）`）；`domain/tool/builtin/vfs-tools.ts:38-45`（`FILE_TOOL_NAMES` 只有 6 项）
- 矛盾点：单看 L9，`chat-grep-tool.ts` 是个被 `@deprecated` 标注的死实现，和 `MUTATING_VFS_TOOL_NAMES` 那批 alias 是同类残留，删了零风险——叠功能正确性核对会发现完全不是这么回事。`tool-system-v2/prd.md` 把 `chat_grep` 列为「内置工具从 10 个减至 **7 个**」目标里的第 7 个（L24），还专门写了 §5 整节描述（L100-110），验收标准 L233-243 列了 3 条 `Given/When/Then`（含「hidden 消息纳入搜索结果」这条硬断言）。当前代码把它废了，但**没有任何一个列举的迭代 PRD 提到要废掉 chat_grep**——既没有反悔说明，也没有 supersede 注记。
- 依据：`register-builtin-tools.ts` 文件头注释还写「Registers the 6 V2 builtin file tools」（注意是 6 不是 PRD 要求的 7）；`builtin-tool-context.ts:16-17` 注释还在说「列出会话消息（含 hidden，供 chat_grep）」，但消费方 chat_grep 已废，这条注释和 `listSessionMessages` 字段的语义都对不上了——`listSessionMessages` 现在唯一活的消费者是 `agent-runner.ts:293` 的 `toolUseLookupMessages`，跟 chat_grep 无关。
- 建议：phase3 之前必须先和产品确认 chat_grep 的去留——要么 PRD 漂移（产品已经反悔，需要补一份 supersede 迭代记录），要么代码漂移（实现侧误废，要恢复注册）。两种情况下公共面都要改：恢复的话要重新 `register`，并补 `FILE_TOOL_NAMES` 第 7 项；维持废弃的话要从 PRD/tool-system-v2 加 supersede 注记、清掉 `builtin-tool-context.ts` 的过时注释、把 `chat-grep-tool.ts` 像 L9 建议的那样彻底删掉。**不能停在当前「PRD 说有、代码说废、注释两头都不对」的状态**。

### S2 agent-definition 形态已超出列举迭代，`abstract` 块从未落地

- 涉及角度：功能正确性核对 + L11（doc-drift）+ L3（公共面 schema 暴露）
- 位置：`domain/agent/model/agent-definition.schema.ts:84-113`（现网 `promptsDocumentSchema`）；对照 `agent-prompt-abstract-block/prd.md` §「块类型（定稿后）」（L59-66）+ `agent-config-shape/prd.md` §「prompts.blocks」（L53-55）
- 矛盾点：L1 从 schema 健康度看 agent 这边是「极简单表 + A 级稳」，没问题。但叠上功能正确性核对——`agent-prompt-abstract-block` PRD 把 `type: abstract` 块当成本迭代的核心交付（L21「一句话目标」、L65 块类型表、L142-146 验收点 5 条），代码里 grep `type: abstract` / `abstractPromptBlockSchema` 全是零命中。`agent-config-shape` PRD 又把 `prompts.blocks` 数组→map 当成核心交付（L25「`prompts.blocks` 仅接受 YAML map」），代码里 `agent-definition.schema.ts:41-46` 直接拒绝 `blocks` 键（`"prompts.blocks is removed; use prompts.system / persist / dynamic"`）。两份 PRD 的定稿方案都被推翻了，但**推翻这两份的迭代不在列举清单里**。再叠 L3：`promptsDocumentSchema` 是从 `public/agent.ts:5` 对外导出的公共契约，外部解析 agent YAML 的代码（apps、潜在第三方）按 PRD 写的 `blocks` 形态构造输入会被现网 schema 一律 reject——公共面契约和文档完全不匹配。
- 依据：grep `abstractPromptBlockSchema` / `type.*abstract` / `prompts.blocks` 在 `packages/core/src` 下零命中；`agent-definition.schema.ts:36-60` 的 `rejectLegacyPromptKeys` 把 `blocks` / `regions` / `chat` 全部当 legacy 拒掉。变更来源能追到的最新一份是 `agent-config-extra-info-and-workplace-cleanup`（2026-08-04）SPEC L56-66，但它只是在已有 `system/persist/dynamic` 形状上加 `customAttach`，没解释主体形状哪来的。
- 建议：这条不是要改代码，而是要补迭代记录——找到那个把 `blocks` 改成 `system/persist/dynamic` 的迭代（很可能在 `agent-prompt-save-and-vfs-ua-bugfix` 或某次 trunk 直接提交里），给它补一份 PRD/spec 或在 `agent-prompt-abstract-block` / `agent-config-shape` 的 PRD 头部加 supersede 注记指向真正的现行形态。同时检查 `examples/` 下的 agent YAML 是不是已经被悄悄改成了新形态（如果是，就是「代码先行、文档没跟」的典型 churn）。

### A1 `EVENT_SESSION_MESSAGE_RECEIVED` 故意脱离 lifecycle 门控 × 未实现的 subagent 工具 = 事件路由未核对

- 涉及角度：L5（sub-agent 脱离活动守卫 A 级）+ 功能正确性核对（agent-subagent PRD 尚未实现）+ L4（事件链无事务兜底）
- 位置：`service/agent/impl/agent-runner.ts:517-519`（`persistMessages && assistantAppendCount > 0` 即发，不查 `publishRunLifecycle`）；对照 `core-explore-remediation/features/events-reliability/spec.md` L199-213（锁定为 intentional）；`Iterations/agent-subagent/spec.md` L63-67、L346-351（未来 sub-agent 用 `persistMessages:true, publishRunLifecycle:false`）
- 矛盾点：L5 A2 已经标过 sub-agent 脱离 `agentActiveRefCount` 守卫这条 A 级。切片这边的补充是另一条独立的问题——events-reliability SPEC 把「message.received 不受 publishRunLifecycle 门控」锁成 intentional 时，理由是「compaction actions 应在消息持久化后触发」（L210）。这个理由对**当前唯一的那条 sub-agent 路径**（`runRunAgentAction`，`persistMessages:false`）成立——它压根不发 message.received。但 `agent-subagent` PRD 要新增的 task 工具明确是 `persistMessages:true, publishRunLifecycle:false`（SPEC L67、L346）——也就是说，**未来的 sub-agent 子会话会发 message.received，触发父进程 events-config DAG 里挂的所有 action**。问题是 sub-agent 的子 session 是新建的 `chat_session`（PRD L56-58 要加 `parent_session_id` 列），而 events-config 的 hide-message / refresh-macros 这些 action 默认按 `sessionId` 路由——它们会作用到子 session 上，对子 session 做压缩/隐藏。这跟 sub-agent 「跑完就把最后一条 assistant 文本回流给主 agent」的语义是冲突的：子 session 可能正在被异步压缩，主 agent 却已经拿到回流继续跑了。
- 再叠一层：`assembleAgentRunnerDeps` L35-44 / `agent-subagent` SPEC L346 都说 sub-agent 装配期传 `includeCompactionOrchestrator: false`——sub-agent 自己的 step 里不会触发 compaction。但 message.received 是 runner.run 末尾发的，它会到达**进程级**的 EventOrchestrator（不区分父/子），绕过 `includeCompactionOrchestrator` 这道装配期开关。也就是说，装配期的 compaction 守卫挡不住 message.received 触发的 DAG。
- 依据：`agent-runner.ts:514` 注释自己写明「session.message.received 不受 publishRunLifecycle 门控；compaction 等 orchestrator action 经 bus 异步执行。本方法成功返回不表示下游 action 已成功」——注释承认了异步放出去，但没提 sub-agent 场景下事件路由会撞子 session。
- 建议：在 `agent-subagent` 进入实现前，phase3 拉一次 cross：明确 message.received 的 payload 要不要带 `parentSessionId`，让 events DAG 能识别「这是子 session 的 message.received，按配置选择性忽略」；或者在 orchestrator 那一层加「子 session 不触发 compaction/hide-message」的硬过滤。当前代码没 bug（subagent 还没实现），但 PRD 一旦落地就会直接撞上。

### A2 `runAgentTurn` 入口硬编码 lifecycle 语义，公共面契约没说

- 涉及角度：L3（公共面契约）+ 功能正确性核对 + L5（sub-agent 路径）
- 位置：`service/agent/logic/run-agent-turn.ts:341-352`（`runner.run` 调用）；对照 `service/agent/agent.port.ts:24-32`（`AgentRunOptions.persistMessages` / `publishRunLifecycle` 都有）；`public/agent.ts:63-72`（`runAgentTurn` 对外导出）
- 矛盾点：L3 从分层角度说 `runAgentTurn` 是 service 层编排入口、`AgentRunner.run` 是底层 runner，分层是对的。叠功能正确性核对会发现：`AgentRunOptions` 这两个字段从 port 层看是「调用方可控」，但 `runAgentTurn` 这个对 Apps 暴露的入口根本不把这两个字段透传下去——它直接调 `runner.run({ definition, sessionId, projectId, savedModelId, workspaceModelId, maxSteps, activeRegexGroupId, stream, signal, onStream })`，10 个字段里没有 lifecycle 那俩。后果是：Apps 经 `runAgentTurn` 进来的所有 run 都强制 `publishRunLifecycle:true` + `persistMessages:true`；任何想跑 sub-agent-style（不进 lifecycle 计数 / 不持久化）的调用方都不能用 `runAgentTurn`，必须自己装配 `assembleAgentRunnerDeps` + `createAgentRunner` + 直接 `runner.run(...)`——`agent-subagent` SPEC L346-351 正是这么规划的。这条规划本身没问题，但 `runAgentTurn` 的 JSDoc（L160-163「Appends a user message (optional) and runs the agent loop」）没说「本函数仅供主对话使用 / 不支持 lifecycle 关闭」，外部维护者读 port 会以为它是通用 entry。
- 依据：`run-agent-turn.ts` L341-352 调用 vs `agent.port.ts:24-32` 接口；`agent-subagent` SPEC L346 显式绕过 `runAgentTurn` 自己装配 runner。
- 建议：要么在 `runAgentTurn` 的 JSDoc 写清楚「lifecycle 硬编码为主对话模式，sub-agent/事件 action 请直接用 `createAgentRunner`」，要么把 `runAgentTurn` 的 options 加两个可选 lifecycle 字段并透传。前者成本低，后者统一性更好。phase3 决定。

### A3 zod schema 允许 `tools.allow` 与 `tools.deny` 同时存在，互斥只靠 service 层

- 涉及角度：L1（schema 健康度 A）+ L8（policy 校验）+ L4（绕过 upsert 的写入路径）
- 位置：`domain/agent/model/agent-definition.schema.ts:115-120`（`agentToolPolicyDocumentSchema` 用 `.strict()` 但 allow/deny 都 `optional`）；`domain/agent/logic/validate-agent-tool-policy.ts:60-67`（互斥校验只在 service 层做）；`domain/agent/logic/resolve-agent-tool-registry.ts:19-21`（运行时优先 allow，ignore deny）
- 矛盾点：L1 单看 agent_definition 表和 zod schema 是「极简单表 + A 级稳」，没毛病。L8 单看 `validateAgentToolPolicy` 也覆盖了 allow/deny 互斥。叠起来发现：互斥校验**只发生在 `DefaultAgentRegistryService.upsert` → `validateAgentDefinition` 那条路径**（`agent-registry.service.ts:47`），而 schema 本身（`agentToolPolicyDocumentSchema`）接受 `{allow: [...], deny: [...]}` 同时存在。`SqliteAgentDefinitionRepository` 的 `rowToDefinition`（L20-23）只用 `decode(wire, agentDefinitionSchema)`，不跑 `validateAgentDefinition`——也就是 db-backup import / 跨设备 cloud-sync pull / 任何绕过 service upsert 的写入路径，都能把同时含 allow+deny 的脏配置写进表，运行时读到不报错。读进运行时之后呢？`resolveAgentToolRegistry:19-21` 是「先看 allow，allow != null 就直接 return allow」——deny 被完全忽略。也就是说脏配置下，deny 名单形同虚设，用户以为禁掉的工具实际可用。
- 再叠 L8：L8 已经标过 tool policy 缺路径白名单 / 资源配额。这条是 L8 的补充——policy 校验**即使在已有的 allow/deny 维度上也不闭合**，schema 与 service 两层校验不对齐。
- 依据：`agentToolPolicyDocumentSchema` 没有 `.refine` 强制互斥；grep `validateAgentDefinition` 在 src 下，只有 `DefaultAgentRegistryService.upsert` 和 `run-agent-turn.ts:312` 两条调用，都不在 db import / cloud-sync pull 路径上。
- 建议：把互斥校验上移到 zod 层——`agentToolPolicyDocumentSchema` 加 `.refine(d => !(d.allow != null && d.deny != null), { message: "..." })`，让 schema 自身闭合；或者让 `SqliteAgentDefinitionRepository.rowToDefinition` / db import 入口都强制走一次 `validateAgentDefinition`。前者改一行，后者改面更大但更彻底。

### A4 `BuiltinToolContext` 不强制 path scope，policy 与 vfs scope 是两套正交机制

- 涉及角度：L8（tool policy 缺白名单 A 级）+ L3（接口契约）+ 功能正确性核对（vfs-zip-io-agent-tool-policy PRD 的 scope 假设）
- 位置：`domain/tool/builtin/builtin-tool-context.ts:12-23`（`BuiltinToolContext` 只有 `vfs: VfsService` + projectId + sessionId，无 path 限制字段）；`domain/tool/builtin/vfs-tools.ts` 各 tool handler（path 直接来自 LLM input，只走 `resolveLogicalPath`）；`service/agent/logic/run-agent-turn.ts:325-332`（`toolCtx.vfs = runtime.sessionVfs(...)`，scope 由注入的 VfsService 决定）
- 矛盾点：L8 已经标过 tool policy 缺 `allowedPaths` 维度，单角度问题。切片这边的补充是——L8 给的整改方向（加 path 白名单）落在哪一层现在是不清楚的。看代码会发现：path scope 的唯一守卫是「注入哪个 VfsService」——`runtime.sessionVfs(projectId, sessionId)` 给的是 session 域服务，所以工具写到 `/template/x` 会被 `vfs-path-mapper` 的 `assertLogicalPathAllowed` 拦掉。这条守卫是**配置在 service 装配期**的，不在 `BuiltinToolContext` 接口上，也不在 `Tool` 接口上——`Tool.inputSchema` 只能校验 path 是字符串、不能校验 path 属于哪个 scope。结果就是：(1) policy（allow/deny 工具名）和 scope（允许写哪个域）是两个完全正交的机制，前者在 `validateAgentToolPolicy`，后者在装配期 service 工厂；(2) 一旦未来有 agent 应该被限制在「project 域只读」或「session 域某个子树」这种细粒度场景，policy 维度加 `allowedPaths` 也无处挂——`BuiltinToolContext` 没字段、runner 不二次校验。
- 依据：`vfs-zip-io-agent-tool-policy/prd.md` §「包含范围 4. Agent 工具白名单 / 黑名单」只说工具名维度，未提 path 维度；`vfs-tools.ts` 的 write/edit handler 直接拿 LLM 给的 path 调 `ctx.vfs.write(...)`，不查 ctx 上的 scope 字段（也没字段可查）。
- 建议：phase3 决定 path 白名单挂哪一层。候选：(1) 扩 `BuiltinToolContext` 加 `allowedPathRoots?: string[]`，runner 在 call 之前查；(2) 在 `Tool` 接口加 `mutatingPathsFromInput` 钩子，runner 拿到后查 policy；(3) 维持现状，path scope 完全交给 VfsService 注入，agent policy 永远只管工具名。当前 L8 已经定 A 级，切片这边只确认「这条 A 级发现的整改落点目前完全没有架构占位」。

### B1 `try/catch + throw` capture 改造后，partial assistant 仍在历史里且 run 必中止

- 涉及角度：L4（append+capture+append 无事务 A 级）+ L5（abort 三分支不一致 A 级）+ L7（capture 失败无测试 A 级）
- 位置：`service/agent/impl/agent-runner.ts:456-471`（capture 现在是 `try { capture } catch (error) { console.error + throw }`）
- 矛盾点：L4 + L5 + L7 已经把 capture 无事务 + abort 不一致 + 无测试这条复合问题标得很重，单角度不重复。切片这边的增量信息是——探索报告 explore-agent P2 当年标过「`void messageCheckpoint.capture(...).catch(() => undefined)` 静默吞错」，现网代码已经改成 `try/catch + throw`（L462-470），吞错这条已经修了。但**改成 throw 之后产生了一个新的副作用**：capture 失败现在会让整个 run 进入 `catch (e)` 外层（L494-510），如果 signal 已 aborted 就走 cancelled 路径，否则 publish `RUN_FAILED` + throw。也就是说，「capture 失败」现在的可观察行为是 RUN_FAILED + run 中止，但**前一步 `session.append('assistant', ...)` 已经写入 chat_message 表**——这条 assistant 消息不会回滚。叠加 L4 已经标的「append + capture 无事务」，capture 失败留下的孤儿状态现在多了「run 被 throw 中止 + UI 看到 RUN_FAILED」这一层，但 partial assistant 仍然留在历史里、会被下一轮 prompt 拼装、会被 `MESSAGE_RECEIVED` 触发的 sub-agent 看到。如果 capture 失败时 `persistMessages=true && assistantAppendCount > 0`（L517），message.received 还会照发。
- 依据：L454-471 capture 在 `session.append('assistant')` 之后；L517-519 message.received 的触发条件只看 assistantAppendCount，不看 capture 是否成功。
- 建议：这条 L4 已经在管，切片只补一个测试缺口（L7 已经标过 capture 失败孤儿状态无测试，这条还是没测）：现在改了实现，对应测试断言应是「capture throw 时 run 走 RUN_FAILED，但 assistant 消息仍落库」——把这条变成可回归的契约测试，至少把现状的不变式钉死。

### B2 顶层 `index.ts` 仍在 re-export `@deprecated` alias，与 L9 建议冲突

- 涉及角度：L9（@deprecated alias + vfs-tools 类型外露 A 级）+ L3（公共面）
- 位置：`packages/core/src/index.ts:152-180`（re-export `MUTATING_VFS_TOOL_NAMES` / `isMutatingVfsToolName` / `registerVfsTools` / `VfsToolContext` 全部 @deprecated alias）；`public/agent.ts:17-23`（re-export `resolveApplicationModelId` / `resolveSummaryApplicationModelId` / `ResolveApplicationModelIdInput` / `ResolveSummaryApplicationModelIdInput` 这 4 个 @deprecated 模型解析 alias）
- 矛盾点：L9 已经标过这些 alias 应该清，apps + core test grep 零引用，删了零风险。切片确认 L9 的判断，但补一点 L9 没说的——这些 alias 不只是「文件内 export」，**顶层 `index.ts` 和 `public/agent.ts` 这两个公共面都还在主动 re-export 它们**。`tool-system-v2` PRD L161 明确写「破坏性变更，旧名**不保留别名**」，但 `MUTATING_VFS_TOOL_NAMES` / `isMutatingVfsToolName` 这两个 V1→V2 的过渡 alias 至今挂在顶层 export；`agent-model-decouple` → `agent-config-shape` 之后，`resolveApplicationModelId` 已经被 `resolveSavedModelId` 取代（public/agent.ts:11-16），但旧名仍 export。这条 L9 单角度已经标过，切片只确认它确实属于 agent-tool 模块而不是别的模块，并补一个证据：apps 的 grep 我没在切片里跑（L9 已经跑过），但 `packages/core/src/index.ts` 这一层 re-export 是面向**任何外部包**的，影响面比 L9 描述的「apps + core test」更宽——任何走 `@novel-master/core` 主入口的第三方消费方都能拿到这些 alias。
- 依据：`index.ts:152-180` 全文；`public/agent.ts:17-23`；L9 报告 L85-94 的 4 对 + 1 bonus alias 核实表。
- 建议：跟着 L9 的整改批次一起清。删除顺序：(1) `MUTATING_VFS_TOOL_NAMES` / `isMutatingVfsToolName` 从 `vfs-tools.ts:56-65` 删定义 + 从 `index.ts:158-159` 删 re-export；(2) `registerVfsTools` 从 `register-builtin-tools.ts:24-28` 删 + `index.ts:163` 删；(3) `VfsToolContext` 从 `builtin-tool-context.ts:25-26` 删 + `index.ts:179` 删；(4) `resolveApplicationModelId` 家族从 `public/agent.ts:17-23` 删。前 4 条 alias 是 tool V1→V2 残留，第 5 条是 agent 模型字段重命名残留，两类都是迭代完成后的尾巴。

## 债务清单

| 严重度 | 项 | 涉及角度 | 位置 |
|--------|----|----------|------|
| **S** | `chat_grep` 已废但 `tool-system-v2` PRD 把它列为必备第 7 个工具，无任何 supersede 迭代记录 | 功能正确性 + L9 + L8 | `domain/tool/builtin/chat-grep-tool.ts:1-7`、`register-builtin-tools.ts:18`、`vfs-tools.ts:38-45` |
| **S** | `prompts` 形态已超出列举迭代，`type: abstract` / `prompts.blocks` 都不在现网 schema 里，主体形状来源未在清单内迭代中 | 功能正确性 + L11 + L3 | `agent-definition.schema.ts:84-113` |
| **A** | 未来 `agent-subagent` 子 session 会发 `EVENT_SESSION_MESSAGE_RECEIVED` 触发父进程 events DAG，与 sub-agent「跑完回流」语义冲突，装配期 `includeCompactionOrchestrator:false` 挡不住 | L5 + 功能正确性 + L4 | `agent-runner.ts:517-519`、`agent-subagent/spec.md` L63-67/L346-351 |
| **A** | `runAgentTurn` 不透传 `persistMessages` / `publishRunLifecycle`，入口被硬编码为主对话用，JSDoc 未说明 | L3 + 功能正确性 | `run-agent-turn.ts:341-352` |
| **A** | zod schema 允许 `tools.allow` + `tools.deny` 同时存在，互斥只靠 service upsert；绕过 upsert 的写入路径（db import / cloud-sync pull）能写入脏配置，运行时优先 allow 让 deny 失效 | L1 + L8 + L4 | `agent-definition.schema.ts:115-120`、`validate-agent-tool-policy.ts:60-67`、`resolve-agent-tool-registry.ts:19-21` |
| **A** | `BuiltinToolContext` 不强制 path scope，policy（工具名）与 scope（vfs 域）正交，L8 建议的 `allowedPaths` 整改目前无架构占位 | L8 + L3 + 功能正确性 | `builtin-tool-context.ts:12-23`、`vfs-tools.ts`、`run-agent-turn.ts:325-332` |
| **B** | capture 改成 `try/catch + throw` 后，capture 失败 → RUN_FAILED + run 中止，但 partial assistant 不回滚、`MESSAGE_RECEIVED` 仍发，现状不变式无测试 | L4 + L5 + L7 | `agent-runner.ts:456-471`、`:517-519` |
| **B** | 顶层 `index.ts` + `public/agent.ts` 仍 re-export `@deprecated` alias（`MUTATING_VFS_TOOL_NAMES` / `isMutatingVfsToolName` / `registerVfsTools` / `VfsToolContext` / `resolveApplicationModelId` 家族），与 PRD「破坏性变更不保留别名」冲突 | L9 + L3 | `index.ts:152-180`、`public/agent.ts:17-23` |
| **C** | `agent_definition.upsert` 的 `created_at_ms` 在 conflict 时保留靠「不在 SET 子句里」隐式保证，无注释保护 | L1 | `sqlite-agent-definition.repository.ts:78-96` |
| **C** | `builtin-tool-context.ts:16-17` 注释还说「供 chat_grep」，但 chat_grep 已废，`listSessionMessages` 唯一活消费者是 agent-runner 的 `toolUseLookupMessages` | L11 | `builtin-tool-context.ts:16-17` |
| **C** | `MUTATING_FILE_TOOL_NAMES` 把 `fs` 整体当 mutating，但 `fs ls` 是只读子命令——`anyToolUseMutatesWorkspace` 在只读 fs 调用上也会触发 capture，粒度偏粗 | 功能正确性 + L1 | `vfs-tools.ts:50-54`、`tool-use-mutates-workspace.ts` |

## 与其他模块的耦合点

给 phase3 交叉用，以下点很可能被别的切片也命中：

- **`EVENT_SESSION_MESSAGE_RECEIVED` 路由**（S/A1）：sub-agent 子 session 的 message.received 会到达父进程 EventOrchestrator。这条会被 events 切片 / chat-message 切片也命中。phase3 要决定事件 payload 是否带 parentSessionId 维度。
- **`promptsDocumentSchema` 公共契约**（S2）：schema 与 PRD 漂移影响所有解析 agent YAML 的代码——chat-message 切片（attachment 解析）、prompt 切片（layout 渲染）、apps 三端 agent 编辑器。S2 的根因可能在某个未列入清单的迭代里。
- **`BuiltinToolContext.listSessionMessages`**（C + S1 注释漂移）：唯一活消费者是 agent-runner 的 `toolUseLookupMessages`，注释还指向已废的 chat_grep。chat-message 切片核对 message listing 时会撞上。
- **`messageCheckpoint.capture` 调用点**（B1）：agent-runner L457 是 capture 的唯一调用点之一，message-checkpoint 切片（D2-chat-message）已经在 L4 角度标过这条链。phase3 合并计分。
- **`VfsService` scope 注入**（A4）：agent 拿到的 vfs 是 `runtime.sessionVfs(projectId, sessionId)`，scope 守卫完全靠这条。vfs 切片（D2-vfs）核 path mapper / `assertLogicalPathAllowed` 时会撞上「agent 工具的 path 边界到底在哪一层定」这个相同问题。
- **`eventOrchestrator.includeCompactionOrchestrator` 装配期 flag**（A1）：装配期 vs run 期的边界（subagent SPEC P0-2 已经定稿）会影响 compaction 切片（D2-compaction）和 events 切片对触发源的理解。
- **顶层 `index.ts` 直通 `domain/tool/*`**（B2 + L3 已记）：是顶层 index 唯一直接走 domain 内容的例外。L3 切片标过这条，归 L3 整改批次。
- **3 个 `@deprecated` alias 在顶层 re-export**（B2）：与 provider 切片（D2-provider-llm，`BUILTIN_PROVIDER_IDS` alias 同类）属于同一波 V1→V2 残留清理，可一并处理。

## 覆盖声明

**查了**：`domain/agent` 全部 14 文件逐行或按段读（schema 全文 + model + 5 个 logic + repositories port/impl + session port + InMemory/Chat/EphemeralOverlay 三实现）；`domain/tool` 全部 14 文件按段读（vfs-tools 头部 + chat-grep-tool 头部 + register/tool-runner/tool-registry/builtin-tool-context 全文）；`service/agent` 全部 15 文件（agent-runner 全文 549 行 / run-agent-turn 全文 / agent-registry.service 全文 / agent.port / agent-registry.port / create-agent-runner / chat-agent-session / ephemeral-overlay-agent-session 全文，其余 assemble/resolve/shared 只读签名）；`public/agent.ts` 全文 + `src/index.ts` 全文；6 份 Iteration 的 PRD（agent-system / agent-config-shape / agent-model-decouple / tool-system-v2 / agent-prompt-abstract-block / vfs-zip-io-agent-tool-policy）+ `agent-subagent` PRD/SPEC 关键段 + `agent-config-extra-info-and-workplace-cleanup` SPEC 关键段 + `events-reliability` SPEC 关键段 + `explore-agent` 报告关键段；11 份 D1 报告里所有 agent/tool 命中段。

**没查**（及原因）：`agent-runner.ts` 的 prompt 装配 + compaction 触发细节（依赖 prompt/compaction 切片）；`vfs-tools.ts` 各 tool handler 内部实现（18000 行，只看 header + 注释，path scope 守卫交给 vfs 切片核）；`runRunAgentAction` 的实现细节（属于 events 模块切片）；`agent-subagent` SPEC 之外的实现（迭代 2026-08-05 新立、尚未在 trunk 落地，本切片只对当前代码负责，不对未实现 PRD 负责）；dist / node_modules 副本；mobile/desktop 的 agent 编辑器 UI（属于 apps 层，跨端切片核）。

**未宣布**：本报告不宣布 ready，不提议合入，只产出 readonly 评审发现。所有 S/A 级发现均给出依据 + 建议，但建议方向需 phase3 / 主代理收敛。
