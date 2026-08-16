---
date: 2026-08-05
dependency: [Iterations/agent-system/prd.md, Iterations/tool-system-v2/prd.md]
---

# Agent Subagent（子代理工具）PRD

> ⚠️ **部分描述已废弃（2026-08-16 核实）**：以下内容与当前代码不符，以代码为准，新增实现勿按本文档执行——
> 1. `subagentCallable` 字段已废弃（strict schema 拒绝该字段），「谁能被 task 调用」改由 agent `mode` 字段控制（`mode !== "primary"` 即可被调度）；
> 2. 「task 不进 `BUILTIN_TOOL_CATALOG`」已过时：task 现为 catalog 首条目；
> 3. 「validateAgentToolPolicy 的内置已知名白名单」不存在：校验是 probe 驱动（`registerBuiltinTools` 注册即合法），无静态白名单常量。
> 详见 `docs/Iterations/agent-skills/spec.md` 探索结论与「以代码为准」备注。

## 背景

Novel Master 已具备完整的 Agent 运行能力：`AgentDefinition` + `AgentRunner`（`maxSteps` 控制的多轮 model↔tool 循环）+ `AgentSession`（含 `EphemeralOverlayAgentSession` 不落库实现）+ `AgentToolPolicy`（allow/deny 工具策略）+ `AgentRegistryService`（工作区级 agent 注册表）+ 事件触发的嵌套 agent run（`run-agent` action / `runRunAgentAction`，跑在 `EphemeralOverlayAgentSession` 上、不持久化）。

尚缺 **subagent 工具**：主 agent 在对话回合内通过一个工具调用派生子 agent 执行子任务，子 agent 跑完后把结果（最后一条 assistant 文本）回流给主 agent 作为 `tool_result`，主 agent 据此继续推进。子 agent 的完整对话持久化为独立子会话，用户可在 UI 中查看。参考 opencode 的 `task` 工具与 claude-code 的 `Agent` 工具。

与已有 `run-agent` 事件的区别：`run-agent` 是事件总线被动触发、不持久化、产出丢弃的旁路执行；subagent 是模型在回合内主动调用、持久化、结果回流主 agent 的工具触发路径。两条链路并存，不互相替代。

## 目标（含成功指标）

- 主 agent 可通过 subagent 工具派生子 agent 执行子任务，子 agent 复用现有 `AgentRunner` 运行，结果回流主 agent。
- 子 agent 对话持久化为独立子会话（`chat_session` 带 `parent_session_id`），可在 UI 中只读浏览完整对话记录。
- 用户可在 agent 配置页控制哪些 agent 允许被 subagent 工具调用，并支持受控递归（最多 2 层）。
- 出厂默认提供一个通用 subagent（工具权限全开但禁止子 agent 调用）。
- 支持并行派生（主 agent 单条消息内多个 subagent 工具调用并发执行）。

成功指标（可量化）：

- Core 单测/集成测：subagent 相关用例 ≥ 10 个断言点（含工具注册、子 session 创建与 parent 关联、结果回流、递归层级拦截、并行执行、默认通用 agent）。
- CLI 验收文档：覆盖 ≥ 4 个场景（基本派生回流、并行派生、递归上限拦截、子会话只读浏览）。
- `npm test -w @novel-master/core` 与 `npm test -w @novel-master/cli` 通过；`npm run build` 通过。

## 用户与场景

- **写作用户**：主 agent 在创作过程中需要「先查一下大纲设定，再继续写正文」，主 agent 自行决定派一个子 agent 去查（带只读工具），自己等结果回来再继续。用户可以点工具卡片进去看子 agent 当时怎么查的。
- **开发者 / 维护者**：在 CLI 下调试 agent 行为，验证主 agent 能否正确决策「何时该派子 agent」「子 agent 选哪个」「结果是否正确回流」。
- **Agent 配置者**：在 agent 配置页为特定 agent 开启「允许子 agent 调用」开关，决定哪些 agent 可以被派生，以及是否允许它再派孙 agent。

## 范围

### 包含范围

**Core — 工具与运行**

- 新增 `subagent`（或 `task`，SPEC 定稿）工具：模型可调用，入参为 `{ description, prompt, subagentName }`，其中 `subagentName` 用 agent 名称（非 UUID id，因 id 不便模型使用）指向一个已注册且「允许子 agent 调用」的 agent。
- 工具内部创建独立子 session（`parent_session_id` 指向父 session）、构造 `AgentRunner`、`runner.run({ persistMessages: true, ... })`，跑完后取最后一条 assistant 文本作为 `tool_result` 回流主 agent。
- 子 agent 的 `AgentDefinition` 来自 registry（按 name 查询，复用现有 `AgentRegistryService`），工具策略、模型 pin、maxSteps 等均沿用该 agent 的定义。
- **递归控制**：子 agent 能否再派孙 agent，由该 agent 的「允许子 agent 调用」开关决定；全局递归深度上限为 2 层（主 → 子 → 孙，孙 agent 不允许再派）。超过上限时工具返回明确错误，不执行。
- **并行**：主 agent 单条消息内多个 subagent 工具调用并发执行，复用现有 `ToolRunner.runParallel` 的有界并发机制。

**Core — Agent 定义与配置**

- **`AgentDefinition` 新增布尔字段（如 `subagentCallable` 或等价，SPEC 定稿）：标识此 agent 是否允许被 subagent 工具调用。缺省 `false`。** ⚠️ 已废弃：改为 `mode` 字段控制，`subagentCallable` 字段被 strict schema 拒绝。
- 出厂默认提供一个通用 subagent（如 `general`）：工具权限全开（读写可用），`subagentCallable: false`（禁止递归，作为递归基线）。通过默认 registry seed 或 `examples/agents.yaml` 等方式交付。
- agent 配置 UI（mobile `AgentEditorForm` / desktop `AgentEditorView`）展示并允许编辑此开关。

**Core — 数据模型**

- `chat_session` 表新增 `parent_session_id TEXT NULL` 列（指向父 session）。`parent_session_id IS NULL` 表示普通主会话；非空表示 subagent 子会话。
- `ChatSession` 模型、`SessionRepository` 端口、`SqliteSessionRepository` 同步加字段。
- 会话列表查询（`listByProject`）默认过滤 `parent_session_id IS NULL`，子会话不混入主列表。

**Apps — UI 入口（mobile + desktop + CLI）**

- **工具卡片扩展**：当 `tool_use.name` 为 subagent 工具时，`ToolCallCard` 展示「查看子会话」入口（可点），点击进入子会话的只读浏览页。子 agent 还在运行中时，入口可显示「运行中」状态。
- **子会话只读浏览页**：渲染子 session 的完整消息历史，复用现有 `MessageList` / `ChatTranscriptWebView` 等消息渲染组件；不含 composer、不接 agent run 编排、不支持继续对话（只读归档）。
  - mobile：push 栈页（参照 `SessionDetail` 模式，路由参数 `{ projectId, sessionId }`）。
  - desktop：替换主 `ConversationPanel` 面板（传入子 sessionId），带「返回」按钮回到主会话。
- **CLI**：`nm message list` 或等价命令可按子 sessionId 查看子会话消息。

### 不包含范围

- **子会话可继续对话**：子会话页是只读归档，不支持用户向子 session 继续发消息或继续跑 agent（那是 agent team / 多 agent 协作范畴，当前不引入）。
- **事件触发路径收编**：现有 `run-agent` action（事件触发的、不持久化的旁路执行）保持不变，不与 subagent 工具合并。

## 已定稿（原待确认项）

| 项 | 决策 |
|----|------|
| 工具命名 | `task`（简短、与 opencode/claude-code 一致，模型认知成本低） |
| 通用 subagent 交付方式 | 默认 registry seed 注入（开箱即用、不可移除） |
| abort 级联 | 主 agent 中断时级联 kill 正在运行的子 agent |
- **子 agent 流式输出到主对话 UI**：主对话内不内嵌子 agent 的实时流式；子会话页仅展示已落库的完整对话，不展示运行中流式（SPEC 阶段可评估是否在子会话页展示 pending 状态）。
- **subagent 工具入参内联 agent 定义**：不支持主 agent 在工具入参里临时定义子 agent；子 agent 必须是 registry 中已注册的、开了开关的 agent。
- **孙 agent 以下递归**：硬上限 2 层，不提供配置更深的能力。
- **完整 tool 输出查看增强**：不在此迭代补齐「查看任意工具完整入参/出参」能力（独立迭代）。
- **subagent 成本 / token 预算控制**：不在此迭代引入按子 agent 的用量上限。

## 核心需求

1. **subagent 工具闭环**：模型调用工具 → 创建子 session（带 parent 关联）→ 复用 `AgentRunner` 跑子 agent → 取最后一条 assistant 文本回流主 agent 的 `tool_result`；子 agent 的中间 tool 调用不回流主 agent。
2. **子会话持久化与隔离**：子 agent 对话落独立 `chat_session`（`parent_session_id` 指向父），不污染主对话历史；主会话列表默认不展示子会话。
3. **可观察性**：用户可从主会话的工具卡片点击进入子会话只读浏览页，查看子 agent 完整对话记录（只读、不支持继续对话）。
4. **配置可控**：agent 配置页提供「允许子 agent 调用」开关；只有开启的 agent 才出现在 subagent 工具的可选范围；递归深度上限 2 层。 ⚠️ 已废弃：「开关」改为 `mode` 字段，非 primary 模式即可被调度。
5. **出厂通用 subagent**：默认 registry seed 注入一个工具全开、自身禁止递归的通用 agent，开箱即用。
6. **并行派生**：主 agent 单条消息内可并行派生多个子 agent。
7. **abort 级联**：主 agent 中断（abort）时，级联 kill 正在运行的子 agent。

## 验收标准

**subagent 工具基本闭环**

- **Given** 一个开了 `subagentCallable` 的 agent A（registry 中）
- When 主 agent 在对话中调用 subagent 工具，`subagentName: "A"`，`prompt: "查一下 X"`
- Then 工具执行后，主 agent 收到一条 `tool_result`，内容为子 agent 的最后一条 assistant 文本；子 agent 的中间 tool 调用不出现在主对话中。

**子会话持久化与隔离**

- Given 上述场景执行完毕
- When 查询 `chat_session` 表
- Then 存在一条子 session 记录，`parent_session_id` 等于主 session 的 id，且其消息历史（user prompt + assistant 回复 + tool 调用）完整落库。
- When 查询主会话列表（`listByProject`）
- Then 子会话不出现在列表中（被 `parent_session_id IS NULL` 过滤）。

**可观察性（UI）**

- Given 主会话消息流中存在一条 subagent 工具调用（已完成）
- When 用户点击该工具卡片
- Then 进入子会话只读浏览页，展示子 agent 的完整消息历史（user prompt、assistant 回复、tool 调用与结果）。
- Then 页面不含 composer / 输入框，不支持发送新消息。
- mobile：通过 push 栈页进入；desktop：替换主面板并带「返回」按钮回到主会话。

**并行派生**

- Given 主 agent 单条消息内发起 2 个 subagent 工具调用
- When 两个子 agent 执行
- Then 两个子 agent 并发运行（复用 `ToolRunner.runParallel`），各自独立子 session，结果各自回流为独立的 `tool_result`。

**递归上限**

- Given agent A 和 agent B 均开启 `subagentCallable`（允许递归），构成「主 → A → B」可达第 2 层
- When B 尝试再派子 agent
- Then 工具返回明确错误（深度超限），不执行。
- Given agent C 未开启 `subagentCallable`
- When 主 agent 尝试用 C 作为 subagentType 调用
- Then 工具返回明确错误（不允许被调用），不执行。

**配置开关**

- Given 用户在 agent 配置页编辑某个 agent
- When 切换「允许子 agent 调用」开关并保存
- Then 该 agent 在 subagent 工具的可选范围中相应出现 / 消失。
- When 主 agent 调用 subagent 工具时
- Then `subagentName` 只能选择已开启开关的 agent；未开启的不可选。

**出厂通用 subagent**

- Given 新用户首次使用（默认 registry seed 后）
- When 主 agent 调用 subagent 工具
- Then 可选范围中包含一个通用 agent（如 `general`），其工具权限包含 `read/write/edit/fs/glob/grep`，且自身 `subagentCallable: false`。

**子 agent 运行中状态**

- Given subagent 工具已调用、子 agent 尚在运行中
- When 用户在主会话中看到该工具卡片
- Then 卡片展示「运行中」状态（与现有工具执行中状态一致或等价标识）。
- （可选）When 用户点击进入子会话页
- Then 可展示子会话已落库的部分消息（SPEC 定稿是否支持渐进可见）。

## 约束与依赖

- 依赖已合并的 **agent-system**、**tool-system-v2**、**content-blocks**、**agent-config-shape**、**event-bus-compaction-conditions**（`run-agent` action 不受影响，并行存在）。
- subagent 工具实现位于 `@novel-master/core`；apps 层负责 UI 入口与子会话浏览页。
- 数据模型变更：`chat_session` 加 `parent_session_id` 列，`SCHEMA_BOOT_VERSION` 递增；走现有 `SCHEMA_COLUMN_ALIGNMENTS` 的 `ALTER TABLE ADD COLUMN` 路径。
- 工具白名单口径：`task` 不进 UI 的 `BUILTIN_TOOL_CATALOG`（「谁能被调」由 `subagentCallable` 单点控制，避免正交概念混淆）；但其名字需在 `validateAgentToolPolicy` 的内置已知名白名单中（不依赖 probe 注册），使用户配 `tools.allow/deny: ["task"]` 能正确生效。 ⚠️ 已废弃：task 现在就在 `BUILTIN_TOOL_CATALOG` 中；validateAgentToolPolicy 无静态白名单常量，probe 驱动（registerBuiltinTools 注册即合法）；subagentCallable 已由 mode 取代。

## 非功能需求（业务/体验）

- 子 agent 的执行对主对话用户可见但不打扰：主会话仅多一条工具调用卡片，不灌入子 agent 的 assistant 消息；想看细节才主动点进去。
- 子 agent 复用父 session 的 VFS 视图（而非独立空 scope），以保证「查大纲设定」这类核心场景能读到工作区文件；子 session 记录仅用于落消息历史。
- 递归超限、agent 不允许被调用、子 agent 非正常结束（如 `max_steps`）等错误，对主 agent 以可读的 `tool_result`（error/fallback 文本，仍携带 `subagentSessionId` 供 UI 跳转）呈现，便于模型理解失败原因并决定下一步。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 子 agent 运行中流式可见 | 子 agent 运行期间，子会话浏览页是否展示渐进落库的消息（半成品可见）？还是等子 agent 完成后才可浏览？影响 `persistMessages` 时序与 UI 刷新策略。 |
| 子会话的标题生成 | 子 session 的 `title` 如何生成？取工具入参的 `description`？还是跑完后由摘要 agent 生成？ |
| 并行子 agent 的 token / 成本 | 多个并行子 agent 同时跑可能放大 token 消耗；是否需要 per-run 的粗粒度上限提示（非硬限制）。 |
| registry seed 虚拟注入语义 | 虚拟 general 仅在 `list()` 合并，`get(id)`/`delete(id)` 不合并——「不可删」是 DB 找不到行的自然结果。需在 SPEC 明确这条口径，避免实施者误改 get/delete 语义。 |
| 子 agent VFS scope | 已定稿（SPEC P0-4）：子 agent 复用父 session 的 VFS 视图，不独立空 scope；原「独立空 scope」与「查大纲设定」场景矛盾。 |

## 里程碑（实现顺序建议）

| 阶段 | 交付 |
|------|------|
| M1 | 数据模型（`parent_session_id` + 列对齐 + 版本号）；subagent 工具 Core 实现（闭环、结果回流、复用 `AgentRunner`） |
| M2 | `subagentCallable` 配置字段 + UI 开关；递归上限（2 层）拦截；出厂通用 subagent |
| M3 | 子会话只读浏览页（mobile 栈页 + desktop 替换面板 + 返回）；工具卡片「查看子会话」入口 |
| M4 | 并行派生验证；abort 级联；测试与 CLI 验收文档 |
