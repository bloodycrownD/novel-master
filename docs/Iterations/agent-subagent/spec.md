---
date: 2026-08-05
---

# Agent Subagent（子代理工具）技术规格（SPEC）

> 需求文档：`docs/Iterations/agent-subagent/prd.md`
> 依赖前置：`agent-system`、`tool-system-v2`

## 设计目标

实现 subagent 工具（命名为 `task`）：主 agent 在对话回合内通过工具调用派生子 agent 执行子任务，子 agent 跑完后把最后一条 assistant 文本回流主 agent 作为 `tool_result`；子 agent 对话持久化为独立子会话（`chat_session.parent_session_id`），UI 可只读浏览。支持并行派生、递归上限 2 层、abort 级联、出厂通用 subagent。

非目标：子会话可继续对话、子 agent 流式输出到主对话 UI、事件触发路径 `run-agent` 收编（详见 PRD 不包含范围）。

## 关键设计决策

| 决策点 | 结论 | 依据 |
|---|---|---|
| 工具命名 | `task` | PRD 已定稿 |
| 子 session id 协议传递 | 方案 B（P0-1 定稿）：`task` 工具 `outcome.output` 约定为 `{ text: string; subagentSessionId: string }`；`agent-runner.ts` L443 处的 `buildToolResultBlock(tu.id, outcome, meta)` 通过新增 `BuildToolResultBlockMeta.subagentSessionId` 透传；`format-tool-output.ts` 先剩掉 `subagentSessionId`，再提取 `text` 返回原始文本（不走 `JSON.stringify`）。最终 `ToolResultBlock.meta.subagentSessionId` 持久化供 UI 读，**不依赖 LLM adapter 显式剥离**（见下一行） | 方案 A 写的「在 agent-runner 拼 LLM messages 处剥离」找不到对应代码位置——content mapper 只读 `toolUseId + content`，天然忽略 `summary`/`ok`/`meta`。方案 B 把 UI-only 标记收敛到 build 阶段，更稳 |
| `meta` 与 `summary`/`ok` 的 LLM 可见性（P1-8 定稿） | `meta` 与 `summary`/`ok` 同语义：LLM adapter 的 content mapper（anthropic / openai / gemini）发请求时只读 `toolUseId + content`，**天然忽略** `meta`/`summary`/`ok`，**无需额外剥离代码改动** | 已核对三个 mapper：`blocksToAnthropicContent` 的 `tool_result` 分支只取 `tool_use_id`+`content`；`chatMessagesToOpenAi` 同；`toolResultToGeminiPart` 同。原 C15 / Step 14「剥离 meta」基于错误前提，已删除 |
| registry seed「不可移除」 | 运行时虚拟注入：仅 `list()` 合并虚拟 `general`（DB 同名优先）；`get(agentId)` **不合并**（保持现状，入参是 UUID）；`task` 工具只用 `list().find(name)`。虚拟 general「不可删」是自然结果（DB 不存在 → delete 报 `AGENT_NOT_FOUND`） | `get` 入参是 UUID id，虚拟 general 没有 id；强行让 `get` 合并需要额外的 name→id 映射，不划算 |
| 子 session 创建路径 | 新增 `SessionService.createSubSession`，**不复用** `create` | `create` 会复制项目模板、写 workspace agent 配置，子 session 不应触发 |
| 子 agent VFS scope（P0-4 定稿） | `createSubSession` **完全不碰 VFS**——不调 `initializeSessionWorkspace`、不创建 child scope、不调 `copyVfsTree`，仅 `insert`（带 `parentSessionId`）。子 agent run 的 `BuiltinToolContext.vfs` 在 `runChildAgent` 装配期指向**父 session 的 VFS**：`vfs = runtime.sessionVfs(projectId, parentSessionId)`。子 session delete 时的 `deleteVfsPrefix(session:{pid}:{childId})` 是无害空操作（child scope 根本没建过），不需要 special-case 跳过 | PRD 核心场景是「子 agent 帮忙查大纲设定」，空 scope 下 read/glob/grep 读不到任何文件，场景跑不通；VFS scope 按 `session:{projectId}:{sessionId}` 字面索引，child scope 不可能「复用」parent 视图——能复用的只有 `toolCtx.vfs` 指向 parent 的 `sessionVfs`。若建空 child scope 又用不上，反而会留孤儿数据 |
| 模型解析 | 子 agent `model` pin → 父 agent `savedModelId` → 报错（不走 workspace fallback） | `resolveSavedModelId` 已剥离 workspace 层；不走 `runRunAgentAction` 的 deviation 老路 |
| `BuiltinToolContext` 扩展 | 加可选 `subagent` 子对象（agentRegistry + createChildSession + runChildAgent + depth + parentSignal） | vfs-tools 完全不感知；只有 `task` 工具读它 |
| `AgentTurnRuntimePort` 扩展（P0-3 定稿） | **细化（narrow）** `agentRegistry` 的类型到 `AgentRegistryService`（含本次新增的 `list()`）；**细化** `sessions` 的类型到 `SessionService`（含本次新增的 `createSubSession`）。父接口 `AgentRunRuntimePort`（`agent-run-shared.ts` L18-28）已声明这两个字段（窄类型：`{ listAgentIds, get }` / `{ getSessionAgentConfig }`），子接口 `extends` 已继承，**字面「加字段」会触发 TS 重复标识符或类型覆盖歧义**，故本次只是在子接口重新声明同名字段以收窄类型。三端 runtime 工厂注入的实例本来就实现完整接口（CLI runtime 已注入完整 `agentRegistry` 见 `runtime.ts` L196/L230、`sessions` 见 L233），只是声明类型需要收窄 | `runChildAgent` 装配子 agent 时需要 `agentRegistry.list()` 拿可选 name、需要 `sessions.createSubSession` 建子 session；父接口的窄类型上没有这两个方法，子接口需要收窄后才能在 `runAgentTurn` 内合法调用 |
| 递归上限实现 | `resolveAgentToolRegistry(baseRegistry, definition, options?: { depth?: number })`，可选第三参数；`depth >= 2`（即孙 agent）时强制 deny `task`。调用点 `runAgentTurn`（depth=0）和 `runChildAgent`（depth=parentDepth+1）从闭包变量传 depth | 从 registry 层面拦截，比运行时检查更稳；depth 走显式参数而不是 ctx 推导，避免 vfs-tools 感知 |
| `task` 是否加进 `BUILTIN_TOOL_CATALOG` | UI catalog **不加**；但 `validateAgentToolPolicy` 内部把 `task` 加进一个内置已知名白名单（与 `FILE_TOOL_NAMES` 并列的常量），不依赖 probe 注册 | 工厂 `createSubagentTool(availableNames)` 只在 `runAgentTurn` 装配时注册，`validateAgentDefinition` 用的 probe（`new ToolRegistry(); registerBuiltinTools(probe)`）不含 `task`，否则用户配 `tools.allow: ["task"]` 会被 `INVALID_TOOL_POLICY` 拒掉 |
| abort 级联信号派生（P1-6 定稿） | `runChildAgent` 内部 `const childController = new AbortController(); parentSignal.addEventListener("abort", () => childController.abort(), { once: true })`，传 `childController.signal` 给 `runner.run` | 不能直接把 `parentSignal` 透传——子 agent 退出/完成时不应反向影响父信号 |
| CLI bundle schema 缺 `tools` | 本次顺手补 `tools` + `subagentCallable` | 历史欠账，否则导入导出闭环不全 |
| 删父 session 级联 | 级联删所有子 session（含 messages/fs/kkv/vfs） | 否则孤儿数据污染 VFS scope/kkv |
| `includeCompactionOrchestrator`（P0-2 定稿） | 装配期 `assembleAgentRunnerDeps({ ..., includeCompactionOrchestrator: false })` 传 false；`runner.run({ persistMessages, publishRunLifecycle, stream, signal })` **不带**它——该字段在 `AssembleAgentRunnerDepsInput`（装配期），不在 `AgentRunOptions`（run 期） | 已核对 `run-agent-turn.ts` L320-352：`includeCompactionOrchestrator` 是 `assembleAgentRunnerDeps` 入参 |
| 子 agent abort 后部分消息 | 已落库的消息保留，只读浏览页展示「半成品 + cancelled」状态 | `agent-runner.ts` abort 时仍写入 meaningful blocks |
| 子 agent 非正常结束 tool_result（P1-7 定稿） | `result.stopReason !== "completed"` 或末条 assistant 无 text block 时，`content` 返回形如 `[子代理未完成任务: stopReason=max_steps]` 的可读文本（仍带上 `subagentSessionId` 供 UI 跳转） | 让主 agent 能读懂失败原因；UI 仍可点进子会话看半成品 |
| `AgentRunResult` 不带文本 | `task` 工具跑完后自己 `messages.listBySession(childSessionId)` 拿末条 assistant text | `AgentRunResult` 只返回 round 摘要 |
| 子 session title 生成（P2-12 定稿） | `title = input.description`（非空时）否则 `prompt.slice(0, 40)` | 工具入参 `description` 已是 3-5 词任务描述，直接用最省事 |
| copy/fork 子 session 的 parentSessionId（P2-13 定稿） | `copy` 出的 session `parentSessionId` 置 `null`（fork 出来的就是独立主会话，不再挂原父） | 否则 copy 主会话会把一堆子 session 也挂到新主会话下，污染列表 |
| 并行派生并发模型（P2-15 定稿） | `task` 工具不计入 `extractMutatingPaths` 串行化（非突变工具）；并发上限沿用 `runParallel` 默认 8，当前不引入 per-task 单独调度 | 已核对 `tool-runner.ts`：`classifyMutatingToolCall` 只识别 vfs 写命令；task 并发跑多个子 agent 是预期行为 |

## 总体方案

### 数据流总览

```
主 agent run（sessionId = P）
  ├ 模型输出 tool_use(name="task", input={subagentName, prompt, description})
  ├ ToolRunner.runParallel → task.run(input, ctx)
  │    ├ ctx.subagent.depth 检查（>2 拦截）
  │    ├ agentRegistry.list() → find(name === subagentName) → AgentDefinition（校验 subagentCallable）
  │    ├ createSubSession(parentSessionId=P, projectId, title=description??prompt.slice(0,40)) → childSessionId=C
  │    ├ resolveChildModelId(definition) → savedModelId（pin → 父 → 报错）
  │    ├ const childController = new AbortController()
  │    │   parentSignal.addEventListener("abort", () => childController.abort(), { once: true })
  │    ├ assembleAgentRunnerDeps({
  │    │     session: new ChatAgentSession(messages, C),
  │    │     runtime,
  │    │     registry: resolveAgentToolRegistry(baseRegistry, def, { depth: parentDepth+1 }),
  │    │     toolCtx: { vfs: runtime.sessionVfs(projectId, P) /* 父 session VFS，见 P0-4 */,
  │    │                projectId, sessionId: C, subagent: { ..., depth: parentDepth+1, parentSignal: childController.signal } },
  │    │     includeCompactionOrchestrator: false,   // ← 装配期传，不是 run 期（P0-2）
  │    │   }) → createAgentRunner
  │    ├ runner.run({ definition, sessionId:C, projectId, savedModelId, workspaceModelId,
  │    │              persistMessages:true, publishRunLifecycle:false, stream:false,
  │    │              signal: childController.signal })   // ← 不带 includeCompactionOrchestrator（P0-2）
  │    ├ messages.listBySession(C) → 取末条 assistant text（fallback 见 P1-7）
  │    └ return { text, subagentSessionId: C }   // ← outcome.output 形式（P0-1 方案 B）
  └ agent-runner.ts L443 buildToolResultBlock(tu.id, outcome, {
         toolName: "task", vfsScope,
         subagentSessionId: outcome.output.subagentSessionId   // ← BuildToolResultBlockMeta 透传（P0-1）
       })
     → ToolResultBlock { content: text（format-tool-output 先剩 subagentSessionId 再提取 text 字段返回原始文本，不走 JSON.stringify）, meta: { subagentSessionId: C } }
     → 写回主 session P
```

### `task` 工具入参 schema

```ts
interface TaskToolInput {
  description: string;       // 3-5 词任务描述（用于子 session title）
  prompt: string;            // 给子 agent 的任务正文
  subagentName: string;      // ← 用 name 而非 UUID id；指向 registry 中 subagentCallable=true 的 agent
}
```

入参用 `subagentName` 而非 `agentId`，因为 id 是 UUID 不便模型使用，name 是人类可读且全局唯一的（registry upsert 时 `assertUniqueDisplayName` 强制校验）。

**`outputSchema` 定稿（P0-1 方案 B）**：`task` 工具的 `outputSchema` 不定为纯 string，而是对象 `{ text: string; subagentSessionId: string }`——`text` 是回流给主 agent LLM 的可读文本，`subagentSessionId` 是 UI-only 旁路字段，供 `buildToolResultBlock` 透传到 `ToolResultBlock.meta`。`format-tool-output.ts` 处理该对象输出时走**两步**（见 C33 改写）：先剩掉 `subagentSessionId`，若剩余对象只有一个 `text` 字段（string），直接返回 `out.text`（原始文本，不走 `JSON.stringify`）；否则才回落到默认 `JSON.stringify`。这样子代理末条 assistant 文本才能以原始字符串形式回流给主 agent LLM，而不是被包进 `{\n  "text": "..."\n}` 的 JSON 壳里。`subagentSessionId` 因此不会泄给 LLM。

工具描述（给 LLM 看的）里要列出当前可选的 subagent name，让模型知道有哪些子 agent 能调。由于 `Tool.description` 是静态 `readonly string`，采用**工厂函数**方案：`createSubagentTool(availableNames: string[])` 返回 Tool 实例，description 拼上可选 name 列表。装配点在 `runAgentTurn`——先查 registry 拿到 `subagentCallable=true` 的 name 列表，再 `createSubagentTool(names)` 注册。描述参考 opencode `task.txt`，教模型「single message with multiple tool uses 可并行」「return a single message back」。

### AgentRegistryService 按名查

现有端口只有 `get(agentId: UUID)`，没有按名查。新增：

```ts
interface AgentRegistryService {
  // 现有方法...
  /** 列出全部 agent 完整定义（含虚拟 seed）。task 工具按 name 查询用。 */
  list(): Promise<readonly AgentDefinition[]>;
}
```

`task` 工具内部：`const def = (await agentRegistry.list()).find(a => a.name === subagentName)`，找不到返回错误 tool_result。

### `BuiltinToolContext` 扩展

```ts
interface BuiltinToolContext {
  // 现有
  readonly vfs: VfsService;
  readonly projectId: string;
  readonly sessionId: string;          // 父 session id
  readonly listSessionMessages: ...;
  readonly sessionKkv?: ...;
  // 新增（可选，仅 task 工具读）
  readonly subagent?: {
    readonly agentRegistry: AgentRegistryService;  // 已含 list()（本次新增）
    readonly messages: MessageService;
    readonly sessions: SessionService;
    readonly createChildSession: (title: string) => Promise<string>;
    readonly runChildAgent: (def: AgentDefinition, childSessionId: string, opts: {
      readonly savedModelId: string;
      readonly workspaceModelId: string;
      readonly signal: AbortSignal;
      readonly maxSteps?: number;
    }) => Promise<AgentRunResult>;
    readonly resolveChildModelId: (def: AgentDefinition) => { savedModelId: string; workspaceModelId: string };
    readonly depth: number;             // 主 agent depth=0，子 depth=1，孙 depth=2
    readonly parentSignal: AbortSignal;
  };
}
```

**`AgentTurnRuntimePort` 扩展（P0-3 定稿）**：当前 `AgentTurnRuntimePort`（`run-agent-turn.ts` L74-94）继承自 `AgentRunRuntimePort`（`agent-run-shared.ts` L18-28）。父接口已经声明了 `agentRegistry`（窄类型 `{ listAgentIds, get }`）和 `sessions`（窄类型 `{ getSessionAgentConfig }`）两个字段，子接口 `extends` 已经继承。问题是父接口的窄类型上没有 `list()` / `createSubSession()`，`runChildAgent` 闭包拿不到这两个方法。本次不是「加字段」，而是**细化（narrow）已有字段的类型**到完整 service 接口（重新声明同名字段以收窄类型，TS 允许子接口 narrowing）：

```ts
export interface AgentTurnRuntimePort extends AgentRunRuntimePort {
  // ... 现有字段 ...
  /**
   * 工作区 agent 注册表。父接口已声明窄类型 `{ listAgentIds, get }`，
   * 这里重新声明收窄到完整 `AgentRegistryService`（含本次新增的 `list()`）。
   */
  readonly agentRegistry: AgentRegistryService;
  /**
   * 会话服务。父接口已声明窄类型 `{ getSessionAgentConfig }`，
   * 这里重新声明收窄到完整 `SessionService`（含本次新增的 `createSubSession`）。
   */
  readonly sessions: SessionService;
  sessionVfs(projectId: string, sessionId: string): VfsService;
  workplace(scope: VfsScope): WorkplaceService;
}
```

三端 runtime 工厂注入的实例本来就实现完整 service 接口，本次只是把子接口声明类型收窄——不需要新构造任何实例，只需补上类型声明对齐：
- `apps/cli/src/runtime.ts`：CLI runtime 顶层已导出 `agentRegistry`（L196/L230）和 `sessions`（L233），它们已是完整 `AgentRegistryService` / `SessionService` 实例；只需在构造 `AgentTurnRuntimePort` 时把它们传入（类型对齐，不需要重新造）；
- desktop runtime 装配（`apps/desktop/src/main/services/` 下 runtime 装配点）：同 CLI——实例已存在，补类型对齐；
- mobile runtime 装配（`apps/mobile/src/runtime/` 下）：同上。

装配点：`runAgentTurn`（`run-agent-turn.ts` L325-332 的 `toolCtx` 构造处）填充 `subagent` 闭包，捕获主 agent run 的 `savedModelId/workspaceModelId/signal`，`depth=0`。子 agent run 内部装配 toolCtx 时 `depth=parentDepth+1`。

### `ToolResultBlock.meta` 扩展

```ts
interface ToolResultBlock {
  // 现有
  type: "tool_result";
  toolUseId: string;
  content: string;
  ok?: boolean;
  summary?: string;            // UI-only 先例
  // 新增
  meta?: {
    readonly subagentSessionId?: string;
  };
}
```

**`meta` 与 `summary`/`ok` 同语义（P1-8 定稿）**：`meta` 是 UI-only 字段，持久化到 `chat_message.content_json`，但 **不需要** 在 LLM adapter 显式剥离——三端 content mapper（`anthropic-content-mapper.ts` 的 `tool_result` 分支只取 `tool_use_id`+`content`；`openai-content-mapper.ts` 同；`gemini-content-mapper.ts` 的 `toolResultToGeminiPart` 同）天然忽略 `meta`/`summary`/`ok`。原 C15 / Step 14「在 agent-runner 拼 LLM messages 处剥离 meta」基于错误前提（误以为 `summary` 是被显式剥离的），已删除。`subagentSessionId` 的「不泄给 LLM」由 `format-tool-output.ts` 处理 task 工具输出时先剩掉该字段再提取 `text` 返回原始文本来保证（P0-1 方案 B，见 C33）——不会落到默认 `JSON.stringify` 分支把 `{"text": "..."}` JSON 壳给 LLM。

### 递归上限实现

```
depth=0（主 agent）→ task 工具可用（subagent 闭包已注入，depth=0）
  └ depth=1（子 agent）→ task 工具可用（subagent 闭包 depth=1）
      └ depth=2（孙 agent）→ task 工具被 deny（resolveAgentToolRegistry 强制过滤）
```

**定稿（P1-10）**：`resolveAgentToolRegistry(baseRegistry, definition, options?: { depth?: number })`，可选第三参数；`depth >= 2`（即孙 agent）时强制从 registry 移除 `task`。调用点从闭包变量传 depth，不依赖 ctx 推导：
- `runAgentTurn`（`run-agent-turn.ts`）：`resolveAgentToolRegistry(toolProbe, definition, { depth: 0 })`；
- `runChildAgent` 内部装配子 agent registry：`resolveAgentToolRegistry(baseRegistry, def, { depth: parentDepth + 1 })`。

这样孙 agent 的 LLM 根本看不到 `task` 工具，不会尝试调用。

### 出厂通用 subagent（运行时虚拟注入）

```ts
const DEFAULT_SUBAGENT_DEFINITION: AgentDefinition = {
  name: "general",
  prompts: { system: "你是一个通用助手，可以读写文件、搜索内容，完成主代理委派的任务。", persist: [], dynamic: [] },
  // model 不 pin，跟随父 agent
  tools: undefined,              // 全部注册工具可用（read/write/edit/fs/glob/grep/task）
  subagentCallable: false,       // 禁止递归（递归基线）
};
```

`AgentRegistryService.list` 实现里合并：先查 DB，再把 `DEFAULT_SUBAGENT_DEFINITION` 合进去（如果 DB 里没有同名 `general`）。用户若 upsert 了同名 `general`，DB 版本优先（允许覆盖）。

**`get` / `delete` 语义（P1-5 定稿）**：
- `list()` 合并虚拟 `general`（DB 同名优先）；
- `get(agentId)` **不合并**虚拟——入参是 UUID id，虚拟 general 没有 id，保持现状（DB 不存在报 `AGENT_NOT_FOUND`）。`task` 工具只用 `list().find(name)`，不走 `get(id)`；
- `delete(agentId)` 传虚拟 general 的 name 当 id 查不到 DB 行，自然报 `AGENT_NOT_FOUND`——「不可删」是自然结果，非必须不转义友好错误（如需友好错误，可在 `delete` 里按 name 特判，但本次不做）。
- export 时排除虚拟 agent（虚拟 agent 不在 DB 里，走 DB 导出路径天然排除）。

`examples/agents.yaml` 同步加一份 `general` 模板作参考（非交付路径，因 PRD 已定 seed 注入）。

## 最终项目结构

### 新增文件

```
packages/core/src/
  domain/tool/builtin/
    subagent-tool.ts                    # task 工具定义
  domain/tool/logic/
    subagent-tool-session-id.ts         # resolveSubagentSessionId 纯函数（对称 vfs-tool-file-path）
  service/agent/
    default-subagent-definition.ts      # DEFAULT_SUBAGENT_DEFINITION
apps/mobile/src/
  screens/stack/
    SubagentSessionScreen.tsx           # 子会话只读浏览栈页
```

### 修改文件

```
packages/core/src/
  bootstrap/chat/chat-schema.ts                     # chat_session 加 parent_session_id 列
  bootstrap/schema-align/schema-column-alignments.ts # 追加 parent_session_id 对齐条目
  bootstrap/novel-master-bootstrap.ts               # SCHEMA_BOOT_VERSION 3→4
  domain/chat/model/session.ts                      # ChatSession 加 parentSessionId
  domain/chat/model/content-block.ts                # ToolResultBlock 加 meta
  domain/chat/content/parse-message-content.ts       # parseBlock tool_result 分支加 meta 可选解析（同 summary 模式）
  domain/chat/repositories/session.port.ts          # 加 listByParentSession / createSubSession 端口
  domain/chat/repositories/impl/sqlite-session.repository.ts # SESSION_COLUMNS / listByProject 过滤 / insert / rowToSession
  service/chat/session.port.ts                      # 加 createSubSession
  service/chat/impl/session.service.ts              # 实现 createSubSession + delete 级联
  domain/agent/model/agent-definition.ts            # 加 subagentCallable
  domain/agent/model/agent-definition.schema.ts     # wire schema 双向
  domain/agent/logic/resolve-agent-tool-registry.ts # 加可选 { depth } 参数，depth>=2 时 deny task（P1-10）
  domain/agent/logic/validate-agent-tool-policy.ts  # 内置 task 白名单（P1-9）
  domain/tool/builtin/builtin-tool-context.ts       # 扩展 subagent 子对象
  domain/tool/builtin/register-builtin-tools.ts     # 注册 task（工厂 createSubagentTool，仍本调用 point 注入）
  domain/tool/logic/build-tool-result-block.ts      # BuildToolResultBlockMeta 加 subagentSessionId；build 时写入 block.meta（P0-1）
  domain/tool/logic/format-tool-output.ts           # 先剩 subagentSessionId 再提取 text 返回原始文本（P0-1，P0-A）
  service/agent/logic/run-agent-turn.ts             # toolCtx 装配 subagent 闭包 + AgentTurnRuntimePort 扩展（P0-3）
  service/agent/agent-registry.port.ts              # 新增 list()（不改动 get/delete 语义，P1-5）
  service/agent/impl/agent-registry.service.ts      # list() 合并虚拟 general（仅 list 合并）
  service/agent/impl/agent-runner.ts                # L443 传 subagentSessionId 进 BuildToolResultBlockMeta（P0-1）
  config-forms/agent/agent-editor-state.ts          # AgentEditorFormInput 加 subagentCallable
  config-forms/agent/agent-tool-catalog.ts          # 不加 task（决策已定；validate 侧白名单替代，见 P1-9）
apps/cli/src/
  runtime.ts                                        # 同步注入 agentRegistry + sessions（P0-3）
  agent/schemas/agents-bundle.schema.ts             # 补 tools + subagentCallable
apps/mobile/src/
  runtime/                                          # 同步注入 agentRegistry + sessions（P0-3）
  components/chat/message-blocks.ts                 # ToolCallView 加 subagentSessionId
  components/chat/ToolCallCard.tsx                  # canOpen 扩展判定
  components/chat/ToolCallGroupCard.tsx             # 回调透传
  screens/tabs/chat-tab/ChatConversationPanel.tsx   # 消费 onOpenSubagentSession
  navigation/types.ts                               # RootStackParamList 加 SubagentSessionView
  navigation/RootNavigator.tsx                      # 注册栈页
  components/agent/AgentEditorForm.tsx              # 加 subagentCallable 开关
apps/desktop/src/
  main/services/                                    # 同步注入 agentRegistry + sessions（P0-3）
  main/ipc/handlers/sessions.ts                     # toDto 加 parentSessionId
  main/ipc/handlers/messages.ts                     # 第二份 toSessionDto 同步
apps/desktop/shared/
  ipc-types.ts                                      # SessionDto 加 parentSessionId
apps/desktop/renderer/
  features/chat/message-blocks.ts                   # 同步 mobile ToolCallView（含 buildTranscriptRows，P2-14）
  features/chat/ToolCallCard.tsx                    # canOpen 扩展判定
  features/chat/ConversationPanel.tsx               # 加 readOnly prop
  layout/ChatRail.tsx                               # subagent 态切换面板 + 返回
  state/nav-workspace.ts                            # NavViewId 加 subagent-conversation + NAV_TO_WORKSPACE 映射（P2-11）
  features/settings/AgentEditorView.tsx             # 加 subagentCallable 开关
examples/agents.yaml                                 # 加 general 模板参考
```

## 变更点清单

| # | 文件 | 改动 |
|---|---|---|
| C1 | `chat-schema.ts` | `chat_session` CREATE TABLE 加 `parent_session_id TEXT NULL` |
| C2 | `schema-column-alignments.ts` | 追加 `parent_session_id` 对齐条目 |
| C3 | `novel-master-bootstrap.ts` | `SCHEMA_BOOT_VERSION` 3→4 |
| C4 | `session.ts`（model） | `ChatSession` 加 `parentSessionId: string \| null` |
| C5 | `content-block.ts` + `parse-message-content.ts` | `ToolResultBlock` 加 `meta?: { subagentSessionId?: string }`（持久化字段）；`parse-message-content.ts` 的 `parseBlock` 在 `tool_result` 分支补 `meta` 可选解析（同 `summary`/`ok` 模式：`const meta = ...; ...(meta !== undefined ? { meta } : {})`），否则持久化重读消息时会丢 `meta.subagentSessionId`，UI 拿不到跳转入口 |
| C6 | `session.port.ts`（repo） | 加 `listByParentSession(parentSessionId)` |
| C7 | `sqlite-session.repository.ts` | `SESSION_COLUMNS` 加列；`listByProject` 加 `AND parent_session_id IS NULL`；`insert` 加列；`rowToSession` 映射；新增 `listByParentSession` |
| C8 | `session.port.ts`（service）+ `session.service.ts` | 加 `createSubSession(parentSessionId, projectId, title?)`；`copy`/`fork` 出的 session `parentSessionId` 置 null（P2-13）；`delete`/`deleteByProject` 级联删子 |
| C9 | `agent-definition.ts`（model） | 加 `subagentCallable?: boolean` |
| C10 | `agent-definition.schema.ts` | schema + `documentToDefinition` + `definitionToDocument` 双向 |
| C11 | `resolve-agent-tool-registry.ts` | 签名改为 `resolveAgentToolRegistry(baseRegistry, definition, options?: { depth?: number })`；`depth >= 2` 时强制 deny `task`（P1-10） |
| C12 | `builtin-tool-context.ts` | 扩展 `subagent?` 子对象 |
| C13 | `register-builtin-tools.ts` + `validate-agent-tool-policy.ts` | 工厂 `createSubagentTool(availableNames)` 独立于 `FILE_TOOL_NAMES`；`validate-agent-tool-policy.ts` 内置 `task` 白名单（与 `FILE_TOOL_NAMES` 并列常量），不依赖 probe 注册（P1-9） |
| C14 | `run-agent-turn.ts` | （1）`AgentTurnRuntimePort` 把继承自父接口的窄类型 `agentRegistry`/`sessions` **重新声明收窄**到 `AgentRegistryService`/`SessionService`（P0-3，P1-B：父接口已有该两字段，重新声明只为收窄类型，不是「加字段」）；（2）toolCtx 装配 `subagent` 闭包（depth=0）；（3）`resolveAgentToolRegistry` 调用传 `{ depth: 0 }` |
| ~~C15~~ | ~~`agent-runner.ts`~~ | **删除原 C15（剥离 meta）——P1-8 定稿：三端 content mapper 天然忽略 meta/summary/ok，无需额外剥离代码改动**。T-M1 断言保留（验证 mapper 不读 meta） |
| C16 | 新增 `subagent-tool.ts` | `task` 工具实现；`outputSchema` 为 `{ text, subagentSessionId }`（P0-1） |
| C17 | 新增 `subagent-tool-session-id.ts` | `resolveSubagentSessionId` 纯函数 |
| C18 | 新增 `default-subagent-definition.ts` | `DEFAULT_SUBAGENT_DEFINITION` |
| C19 | `agent-registry.service.ts` + `agent-registry.port.ts` | 新增 `list(): AgentDefinition[]`；**仅 `list` 合并虚拟 `general`**，`get`/`delete` 不改动（P1-5）；export 排除虚拟 |
| C20 | `agent-editor-state.ts` | `AgentEditorFormInput` 加 `subagentCallable`；`buildAgentDefinitionFromForm`/`definitionToForm` 双向 |
| C21 | `agents-bundle.schema.ts` | 补 `tools` + `subagentCallable` |
| C22 | mobile `message-blocks.ts` | `ToolCallView` 加 `subagentSessionId`；`toolCallViewFromUse` 从 `meta` 读；`buildTranscriptRows` 的 tools 映射同步加 `subagentSessionId`（P2-14） |
| C23 | mobile `ToolCallCard.tsx` | `canOpen` 扩展：`filePath \|\| subagentSessionId` |
| C24 | mobile `ToolCallGroupCard.tsx` + `ChatConversationPanel.tsx` | 回调 `onOpenSubagentSession` → `navigation.push` |
| C25 | 新增 mobile `SubagentSessionScreen.tsx` + 路由注册 | 只读栈页 |
| C26 | desktop `message-blocks.ts` | 同步 C22（含 `buildTranscriptRows`，P2-14）；webview bridge 协议字段同步加 `subagentSessionId` |
| C27 | desktop `ToolCallCard.tsx` | 同步 C23 |
| C28 | desktop `ConversationPanel.tsx` + `ChatRail.tsx` + `nav-workspace.ts` | `readOnly` prop + subagent 态切换 + 返回；`NavViewId` 加 `"subagent-conversation"`；`NAV_TO_WORKSPACE` 同步加 `subagent-conversation: "chat"`（P2-11） |
| C29 | desktop `SessionDto` + 两份 `toDto` | 加 `parentSessionId` |
| C30 | mobile `AgentEditorForm.tsx` + desktop `AgentEditorView.tsx` | 加 `subagentCallable` 开关 UI |
| C31 | `examples/agents.yaml` | 加 `general` 模板 |
| C32 | `build-tool-result-block.ts`（P0-1） | `BuildToolResultBlockMeta` 加 `subagentSessionId?: string`；`buildToolResultBlock` 在成功分支识别 `outcome.output.subagentSessionId`（或从 `meta.subagentSessionId` 读）并写入返回的 `ToolResultBlock.meta` |
| C33 | `format-tool-output.ts`（P0-1） | `formatToolOutputForLlm` 处理对象输出时，**两步**：（1）剩掉 `subagentSessionId` 字段；（2）若剩余对象只有一个 `text` 字段且类型为 string，直接返回 `out.text`（原始文本，不走 `JSON.stringify`）；否则才回落到默认 `JSON.stringify(out, null, 2)`。该识别分支对 `task` 工具输出形状 `{ text, subagentSessionId }` 生效，也兼容未来其他只有 `text` 的 task-output 形状 |
| C34 | `agent-runner.ts`（P0-1） | L443 `buildToolResultBlock(tu.id, outcome, meta)` 调用处补传 `subagentSessionId`：从 `outcome.output` 提取（`typeof outcome.output?.subagentSessionId === "string"` 时透传） |
| C35 | 三端 runtime 装配（P0-3） | `apps/cli/src/runtime.ts`、desktop `main/services/` 下 runtime 装配点、mobile `runtime/` 下装配点同步把已存在的 `agentRegistry` / `sessions` 实例交给 `AgentTurnRuntimePort`（类型对齐，不需新造实例）；同时收窄子接口声明类型（见 P1-B） |
| C36 | `parse-message-content.ts`（P1-A） | `parseBlock` 的 `tool_result` 分支新增 `meta` 可选解析：若 `"meta" in value && isRecord(value.meta)`，校验 `subagentSessionId` 为 string 后透传，其余未知字段静默忽略（向前兼容老消息）。与 C5 一同落地，避免「写进去读不出来」 |

## 详细实现步骤

- Step 1 — phase-schema-data — blocking: yes — qa: auto：数据模型三件套（C1-C3）：`chat_session` DDL 加 `parent_session_id TEXT NULL`；`SCHEMA_COLUMN_ALIGNMENTS` 追加对齐条目；`SCHEMA_BOOT_VERSION` 3→4。加复合索引 `idx_chat_session_parent` 加速按父查子。
- Step 2 — phase-schema-data — blocking: yes — qa: auto：ChatSession 模型 + 仓储（C4, C6, C7）：`ChatSession` 加 `parentSessionId`；`SESSION_COLUMNS`/`rowToSession`/`insert` 同步；`listByProject` 加 `AND parent_session_id IS NULL`；新增 `listByParentSession`。
- Step 3 — phase-schema-data — blocking: yes — qa: auto：SessionService（C8）：新增 `createSubSession(parentSessionId, projectId, title?)`——**仅 `insert`（带 parentSessionId），完全不碰 VFS**：不调 `initializeSessionWorkspace`、不创建 child scope、不调 `copyVfsTree`（子 agent 的 VFS 访问通过 `toolCtx.vfs = runtime.sessionVfs(projectId, parentSessionId)` 在 `runChildAgent` 装配期指向父 scope，见 Step 12 / P0-4）；不复制项目模板。`delete`/`deleteByProject` 级联删子（事务内先 `listByParentSession` → 递归 delete 子 → 再删自己）；子 session delete 时的 `deleteVfsPrefix(session:{pid}:{childId})` 是无害空操作（child scope 根本没建过），不需 special-case 跳过。`copy`/`fork` 出的 session `parentSessionId` 置 null（P2-13：fork 出来的就是独立主会话，不再挂原父）。
- Step 4 — phase-schema-data — blocking: yes — qa: auto：`ToolResultBlock.meta`（C5 + C36）：`content-block.ts` 加 `meta?: { subagentSessionId?: string }`；`parse-message-content.ts` 的 `parseBlock` 在 `tool_result` 分支同步加 `meta` 可选解析（同 `summary`/`ok` 模式，否则持久化重读会丢 `subagentSessionId`）；序列化/反序列化覆盖。
- Step 5 — phase-agent-config — blocking: yes — qa: auto：AgentDefinition 加 `subagentCallable`（C9, C10）：model 接口 + wire schema 双向（照 `customAttach` 模板，schemaVersion 不升）。
- Step 6 — phase-agent-config — blocking: yes — qa: auto：CLI bundle schema 补 `tools` + `subagentCallable`（C21）；更新 `agents-bundle.test.ts`、`agent-registry-e2e.test.ts` 适配。
- Step 7 — phase-agent-config — blocking: yes — qa: auto：registry seed 虚拟注入（C18, C19）：新增 `default-subagent-definition.ts`；`AgentRegistryService.list` 合并虚拟 `general`（DB 同名优先）；`get`/`delete` **不改动**（P1-5：虚拟 general 没有 id，自然报 AGENT_NOT_FOUND）；export 排除虚拟（走 DB 导出路径天然排除）。`examples/agents.yaml` 加 `general` 参考（C31）。
- Step 8 — phase-agent-config — blocking: no — qa: auto：config-forms + UI 开关（C20, C30）：`AgentEditorFormInput` 加 `subagentCallable`；mobile `AgentEditorForm` + desktop `AgentEditorView` 加开关控件。
- Step 9 — phase-core-tool — blocking: yes — qa: auto：`BuiltinToolContext` 扩展 + `AgentRegistryService.list()` 新增（C12, C19 前半）：加可选 `subagent` 子对象；registry 新增 `list(): AgentDefinition[]` 方法（DB + 虚拟 seed 合并）。
- Step 10 — phase-core-tool — blocking: yes — qa: auto：新增 `subagent-tool.ts` + 工厂函数（C13, C16, C32, C33）：`createSubagentTool(availableNames: string[])` 返回 Tool 实例，description 拼上可选 name；`task` 工具实现——入参校验、`ctx.subagent` 存在性检查、depth 拦截、`agentRegistry.list()` → `find(name === subagentName)` + `subagentCallable` 校验、`createChildSession(title = input.description?.trim() ? input.description : input.prompt.slice(0, 40))`（P2-12）、`resolveChildModelId`、`runChildAgent`、跑完 `messages.listBySession(childSessionId)` 取末条 assistant text。**`outputSchema` 定稿为对象 `{ text: string; subagentSessionId: string }`**（P0-1 方案 B）；`text` 取末条 assistant 文本，**fallback（P1-7）**：`result.stopReason !== "completed"` 或末条 assistant 无 text block 时，`text` 返回形如 `[子代理未完成任务: stopReason=max_steps]` 的可读文本，`subagentSessionId` 仍填上（供 UI 跳转看半成品）。返回值由 agent-runner.ts L443 处的 buildToolResultBlock 透传到 `ToolResultBlock.meta`（C32/C34），`format-tool-output` 先剩掉 `subagentSessionId` 再提取 `text` 返回原始文本（C33，不走 `JSON.stringify`）。
- Step 11 — phase-core-tool — blocking: yes — qa: auto：`runAgentTurn` 装配（C14）：（1）**先细化 `AgentTurnRuntimePort` 的类型声明**——把继承自父接口 `AgentRunRuntimePort` 的窄类型 `agentRegistry`/`sessions` 重新声明收窄到完整 `AgentRegistryService`/`SessionService`（P0-3，P1-B：**不是「加字段」，父接口已有，重新声明只为收窄类型**）；三端 runtime 装配点同步把已存在的实例交给接口（类型对齐，不需新造，C35）。（2）先查 `runtime.agentRegistry.list()` 过滤 `subagentCallable=true` 拿 availableNames → `createSubagentTool(availableNames)` → 注册到 registry；`resolveAgentToolRegistry(toolProbe, definition, { depth: 0 })`（P1-10）。（3）toolCtx 装配 `subagent` 闭包（depth=0）。
- Step 12 — phase-core-tool — blocking: yes — qa: auto：`runChildAgent` 内部装配（原 C14 runChildAgent 部分，含 P0-2 / P0-3 / P0-4 / P1-6）：
  - **VFS（P0-4）**：子 agent 的 `toolCtx.vfs = runtime.sessionVfs(projectId, parentSessionId)`——子 agent 用父 session 的 VFS 视图（查大纲设定场景需要能读到文件）；子 session 记录只用于落消息历史。
  - **abort 派生（P1-6）**：`const childController = new AbortController(); parentSignal.addEventListener("abort", () => childController.abort(), { once: true })`，传 `childController.signal` 给 `runner.run`。
  - **registry（P1-10）**：`resolveAgentToolRegistry(baseRegistry, def, { depth: parentDepth + 1 })`。
  - **装配期 vs run 期（P0-2）**：`assembleAgentRunnerDeps({ session: new ChatAgentSession(messages, childSessionId), runtime, registry, toolCtx, includeCompactionOrchestrator: false })`（**装配期**传 false）；`runner.run({ definition, sessionId, projectId, savedModelId, workspaceModelId, persistMessages: true, publishRunLifecycle: false, stream: false, signal: childController.signal })`（**不带** `includeCompactionOrchestrator`——它不在 `AgentRunOptions`）。
  - 子 agent run 内部装配 toolCtx 时 `depth = parentDepth + 1`，递归 `createSubagentTool` 注册（深度 >= 2 时被 resolveAgentToolRegistry deny，不注册）。
- Step 13 — phase-core-tool — blocking: yes — qa: auto：递归上限（C11，P1-10）：`resolveAgentToolRegistry(baseRegistry, definition, options?: { depth?: number })` 签名定稿，可选第三参数；`depth >= 2` 时强制移除 `task`。调用点从闭包变量传 depth（Step 11 的 depth=0、Step 12 的 parentDepth+1），不依赖 ctx 推导。
- Step 14 — phase-core-tool — blocking: yes — qa: auto：**原 Step 14 已删除（P1-8）**——三端 content mapper 天然忽略 `meta`/`summary`/`ok`，无需额外剩离代码改动。本步骤保留为占位（Step 编号不重排）；T-M1 断言保留，验证 mapper 不读 meta。
- Step 15 — phase-core-tool — blocking: yes — qa: auto：新增 `subagent-tool-session-id.ts`（C17）：`resolveSubagentSessionId(result | use)` 纯函数，对称 `vfs-tool-file-path.ts`。
- Step 15 — phase-ui-mobile — blocking: no — qa: auto：mobile message-blocks（C22）：`ToolCallView` 加 `subagentSessionId`；`toolCallViewFromUse` 从 `result.meta.subagentSessionId` 读；mobile/desktop 双份同步（C26）。
- Step 16 — phase-ui-mobile — blocking: no — qa: auto：mobile 工具卡片可点（C23, C24）：`ToolCallCard` `canOpen` 扩展 `filePath || subagentSessionId`；`ToolCallGroupCard` 加 `onOpenSubagentSession` 回调；`ChatConversationPanel` 消费并 `navigation.push('SubagentSessionView', { projectId, sessionId: subagentSessionId })`。desktop 同步（C27）。
- Step 17 — phase-ui-mobile — blocking: no — qa: manual_user：mobile 子会话只读栈页（C25）：新增 `SubagentSessionScreen.tsx`，参照 `SessionDetailScreen` 接 `{ projectId, sessionId }`，用 `runtime.messages.listBySession(sessionId)` 加载，渲染 header（标题 + 返回）+ `MessageList`/`ChatTranscriptWebView`（不传 streaming/agentRunning），无 composer；`navigation/types.ts` + `RootNavigator.tsx` 注册路由。
- Step 18 — phase-ui-desktop — blocking: no — qa: manual_user：desktop 子会话只读面板（C28）：`ConversationPanel` 加 `readOnly` prop（关 composer + 写 IPC）；`nav-workspace.ts` `NavViewId` 加 `"subagent-conversation"`；`ChatRail` subagent 态渲染只读面板 + 返回按钮回 `"conversation"`。
- Step 19 — phase-cli — blocking: no — qa: auto：CLI 支持：`nm message list --session <childSessionId>` 已能查子会话消息（现有能力，加文档说明）；`nm agent list` 展示 `general`（虚拟注入自动覆盖）。
- Step 20 — phase-test — blocking: yes — qa: auto：Core 单测/集成测（见测试策略）。
- Step 21 — phase-test — blocking: no — qa: manual_user：CLI 验收文档（4 场景）+ desktop/mobile 真机验收。

## 测试策略

### 自动化（Core）

- T-S1 — phase-schema-data — blocking: yes：升级后 `chat_session` 有 `parent_session_id` 列；新建库 + 老库升版（v3→v4）均正确建列。
- T-S2 — phase-schema-data — blocking: yes：`createSubSession` 创建的 session `parentSessionId` 正确；`listByProject` 不返回子 session；`listByParentSession` 返回子 session。
- T-S3 — phase-schema-data — blocking: yes：删父 session 级联删子（messages/fs/kkv/vfs 全清）；`deleteByProject` 同理。
- T-S4 — phase-schema-data — blocking: yes（P2-13）：`copy`/`fork` 一个带子 session 的主会话后，新主会话的 `parentSessionId` 为 null，且原父的子 session 不会挂到新主会话下（新会话不调 `listByParentSession` 返回任何东西）。
- T-S5 — phase-schema-data — blocking: yes（P1-A）：`ToolResultBlock.meta.subagentSessionId` 持久化闭环：写入主 session 的 `tool_result` 带上 `meta.subagentSessionId` 后，重读消息（走 `parseMessageContent` 反序列化）仍能拿到同一个 `subagentSessionId`（C5/C36 必须同时落地，缺 parse 改动则断言失败）。
- T-T1 — phase-core-tool — blocking: yes：`task` 工具基本闭环：调用后子 session 创建、子 agent run、末条 assistant text 回流主 agent 的 `tool_result.content`；`tool_result.meta.subagentSessionId` 正确（经 C32/C34 透传）；**`content === expectedText`（原始文本，不被包成 `{"text": "..."}` JSON 壳，C33 已加提取 text 步骤）**；`content` 中不含 `subagentSessionId` 字段；子 agent 中间 tool 调用不出现在主 session。
- T-T2 — phase-core-tool — blocking: yes：递归上限：主(depth=0)→子(depth=1)→孙(depth=2)，孙的 registry 不含 `task`（LLM 看不到）。
- T-T3 — phase-core-tool — blocking: yes：`subagentCallable=false` 的 agent 被 `task` 调用时返回错误 tool_result；不存在的 `subagentName` 同样报错。
- T-T7 — phase-core-tool — blocking: yes：工具描述含可选 subagent name 列表：`createSubagentTool(['general'])` 的 description 包含 `general`；registry 变化后重新装配反映最新列表。
- T-T4 — phase-core-tool — blocking: yes：并行派生：主 agent 单消息 2 个 `task` tool_use 并发执行，各自独立子 session，结果各自回流。
- T-T5 — phase-core-tool — blocking: yes：abort 级联：主 agent abort 后子 agent run 也被 abort（stopReason=cancelled）；已落库的 meaningful blocks 保留；`parentSignal.addEventListener("abort", ..., { once: true })` 被调且仅被调一次（P1-6）。
- T-T6 — phase-core-tool — blocking: yes：模型解析：子 agent pin → 父 savedModelId → 报错（不走 workspace fallback）。
- T-T8 — phase-core-tool — blocking: yes（P1-7）：子 agent 非正常结束 fallback：mock 子 agent `result.stopReason = "max_steps"`，`task` 工具返回的 `text` 形如 `[子代理未完成任务: stopReason=max_steps]`，`subagentSessionId` 仍存在；主 agent 的 `tool_result.content` 等于该文本，`tool_result.meta.subagentSessionId` 正确，UI 仍可跳转子会话。
- T-T9 — phase-core-tool — blocking: yes（P0-4）：子 agent VFS 可见性：子 agent run 的 `toolCtx.vfs` 与父 session 的 VFS 是同一视图；mock 父 session VFS 中预置文件 `/outline.md`，子 agent 调 `read`/`glob`/`grep` 能读到该文件（若 scope 独立空，读不到 → 场景破裂）。
- T-C1 — phase-agent-config — blocking: yes：wire schema 双向：`subagentCallable` 序列化/反序列化；旧文档（无该字段）兼容。
- T-C2 — phase-agent-config — blocking: yes（P1-5 改写）：registry seed：`list` 包含虚拟 `general`（`subagentCallable=false`）；`get("<不存在的 uuid>")` 报 `AGENT_NOT_FOUND`（`get` 不合并虚拟）；`delete("general")` 走 DB 路径报 `AGENT_NOT_FOUND`（自然不可删）；export 排除虚拟；upsert 同名 `general` 后 DB 版本优先于虚拟。
- T-C3 — phase-agent-config — blocking: yes：CLI bundle schema：`tools` + `subagentCallable` 导入导出闭环。
- T-C4 — phase-agent-config — blocking: yes（P1-9）：`validateAgentToolPolicy` 内置 task 白名单：用户配 `tools.allow: ["task"]` 或 `tools.deny: ["task"]` 不报 `INVALID_TOOL_POLICY`（白名单生效，不依赖 probe 注册）；但配 `tools.allow: ["unknown_tool"]` 仍报错。
- T-M1 — phase-core-tool — blocking: yes：LLM messages 不含 `meta`：直接调三个 mapper（`chatMessagesToAnthropic` / `chatMessagesToOpenAi` / `chatMessagesToGeminiContents`），入参含带 `meta.subagentSessionId` 的 `tool_result` 块，断言出参 wire 中**不含** `meta`/`summary`/`ok` 字段——验证 mapper 天然忽略（P1-8）。

### 手工（apps）

- 子会话只读浏览：主会话工具卡片点击 → mobile push 栈页 / desktop 替换面板 → 展示子 agent 完整消息历史 → 无 composer → 返回主会话。
- 子 agent 运行中状态：工具卡片显示「运行中」。
- 通用 subagent 开箱即用：新用户首次使用，`task` 工具可选 `general`。
- agent 配置开关：切换 `subagentCallable` 并保存，`task` 可选范围相应变化。

## 兼容性与迁移

- **非破坏性 schema 扩展**：`parent_session_id TEXT NULL`、`meta` 字段均向后兼容；老数据 `parent_session_id IS NULL` 自然满足。
- **`SCHEMA_BOOT_VERSION` 3→4**：已升版到 3 的老库升级时走完整 DDL + align 路径，补建 `parent_session_id`。
- **AgentDefinition 向后兼容**：`subagentCallable` optional，旧 agent 定义（无该字段）按 `false` 处理。
- **CLI bundle schema 补 `tools`**：旧 bundle（无 `tools`）仍可导入（optional）；新 bundle 导出含 `tools`。
- **registry seed 不影响存量数据**：虚拟注入是运行时合并，不写 DB；存量 DB 的 `general`（如有）优先于虚拟。

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|---|---|---|
| `parent_session_id` 列对齐失败（老库升级漏建） | `SCHEMA_BOOT_VERSION` 强制 +1，已升版库走完整路径 | 回退版本号 + 列对齐条目 |
| registry seed 虚拟注入影响现有 `list`/`get` 语义 | 虚拟 agent 仅合并到结果集，不改 DB；upsert/delete 仍走 DB | 移除 `default-subagent-definition.ts` 注入逻辑 |
| `task` 工具与事件触发的 `run-agent` 冲突 | 事件触发的 toolCtx 不注入 `subagent` 闭包；`resolveAgentToolRegistry` 按 ctx 能力过滤 `task` | 移除 `task` 注册 |
| 子 agent run 抛异常导致主 agent turn 失败 | `ToolRunner.runParallel` 已捕获错误为 `{ ok: false }`，不传播；`task` 工具内部 try-catch，异常转为错误 tool_result | — |
| abort 后子 session 半成品消息 | 只读浏览页展示 cancelled 状态；不做清理（归档保留） | — |
| mobile/desktop 双份 message-blocks 漏同步 | SPEC 明确标注双侧同步；PR review 检查 | — |

回滚总体方案：所有改动向后兼容（非破坏性），可安全回退。`parent_session_id` 列保留无害；`task` 工具移除注册即可；虚拟 agent 注入移除即可。

## 实现顺序与里程碑

| 阶段 | 交付 | 对应 Step |
|---|---|---|
| M1 — 数据模型 | schema + ChatSession + 仓储 + SessionService.createSubSession（含 copy/fork parentSessionId=null）+ 删除级联 + ToolResultBlock.meta | Step 1-4 |
| M2 — Agent 配置 | subagentCallable 字段 + CLI bundle + registry seed + config-forms/UI 开关 | Step 5-8 |
| M3 — Core 工具 | BuiltinToolContext 扩展 + AgentTurnRuntimePort 类型收窄（agentRegistry/sessions，P1-B）+ task 工具 + buildToolResultBlock/format-tool-output 透传与提取（P0-1，C33 提取 text）+ 递归上限（depth 参数）+ runAgentTurn 装配 | Step 9-14 |
| M4 — UI | mobile/desktop 工具卡片可点 + 子会话只读浏览页 | Step 15-18 |
| M5 — CLI + 测试 | CLI 文档 + Core 单测 + 验收 | Step 19-21 |
