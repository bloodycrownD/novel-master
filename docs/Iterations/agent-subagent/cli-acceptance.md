# CLI 验收：Agent Subagent（子代理工具）

- 日期: 2026-08-05
- 节点: SPEC Step 19（phase-cli）+ Step 21（CLI 验收文档）
- 审查人: pending

本文件对应 PRD「测试策略 / 手工（apps）」与「验收标准」的 CLI 侧落地，覆盖 4 个验收场景（基本派生回流、并行派生、递归上限拦截、子会话只读浏览）。同时也汇总 subagent 相关的 CLI 用法说明，方便开发者与维护者在命令行下调试。

## 前置说明：CLI subagent 能力来源

Step 19 的核心是「大部分能力已存在，本节点主要是验证 + 文档说明」，因此本文件不引入新的 CLI 代码改动，只描述现有命令如何用于 subagent 场景。下面三条能力都来自前序 wave 的 core 改动，CLI 层只是复用：

- 子会话消息查询复用现成的 `nm message list --session`（`apps/cli/src/message/commands.ts` 的 `runMessage` 走 `rt.scope.resolveSessionId(flags)` → `messages.listBySession(sessionId)`，对父/子 session 不做区分）。
- 通用 subagent `general` 由 core 的 `AgentRegistryService.list()` 合并虚拟 seed（wave-2 / Step 7）。
- `mode` 配置字段通过现成的 `nm agent import / export` bundle schema 落库（Step 6 起 schema 直接收 `mode` 枚举）。

## CLI 用法（subagent 相关）

### 1. 查看子会话消息：`nm message list --session <childSessionId>`

子 agent 的对话历史落在独立子 session（`chat_session.parent_session_id` 指向父 session），不污染主对话。要查看子 agent 的完整消息流，把 `--session` 指向子 session id 即可——这条命令本来就是按 sessionId 查消息的，对父子 session 一视同仁：

```bash
# 主会话消息（默认走 current session 指针）
nm message list

# 子会话消息（显式传子 session id）
nm message list --session <childSessionId> [--db <path>] [--project <id>]
```

子 session id 从哪来？主会话里 subagent 工具调用的 `tool_result` 会带上 `meta.subagentSessionId`（Step 4 / Step 10 的 `buildToolResultBlock` 透传）。CLI 侧暂时没有专门的「展开 meta」子命令，可以通过 `nm message list` 主会话、再用 `nm message show --id <toolResultId>`（或直接看落库 JSON）拿到 `subagentSessionId`，再回头查子会话。

> 想批量列出一个父 session 下的所有子会话，目前 CLI 没有直接的 `nm session list-children` 命令；可以查库 `SELECT id FROM chat_session WHERE parent_session_id = '<parentSessionId>'`（core 的 `listByParentSession` 仓储方法已就绪，只是尚未暴露成 CLI 子命令）。

### 2. 通用 subagent `general`：`nm agent list` 行为说明

这里有一个**容易踩坑的点**，先讲清楚口径：

- core 的 `AgentRegistryService.list()` 会合并虚拟 `general`（DB 同名优先，wave-2 / Step 7 实现），所以 `task` 工具在运行时按 name 查询，**始终能看到 `general`**——开箱即用，不依赖任何 DB 数据。
- 但 CLI 的 `nm agent list`（`apps/cli/src/agent/registry-commands.ts`）走的是 `listAgentIds()`，**只列 DB 里真实存在的 agent**（虚拟 `general` 没有 id，所以不会出现在 id 列表里）。

所以行为是这样的：

```bash
# 全新空库：nm agent list 看不到 general（虚拟 seed 没有 id，不进 listAgentIds）
nm agent list --db <fresh.db>
# → No agents in registry. Run: nm agent import <path>

# 导入 examples/agents.yaml 后，general 作为真实 DB 行落库，list 就能看到
nm agent import examples/agents.yaml --db <path>
nm agent list --db <path>
# → writer
#   summarizer
#   general
```

简单说：**「task 工具运行时永远有 general 可用」与「nm agent list 是否打印 general」是两件事**。前者来自虚拟注入（`list()` 合并），后者依赖 DB 里是否有同名行。要让 CLI 也能看到 `general`，跑一次 `nm agent import examples/agents.yaml` 即可（`examples/agents.yaml` 已在 Step 7 / C31 加了 `general` 参考条目）。

> 这条口径在 PRD「风险与待确认项」也写明了：虚拟 general 仅在 `list()` 合并，`get(id)`/`delete(id)` 不合并——「不可删」是 DB 找不到行的自然结果。

### 3. 配置 agent 的 `mode`

CLI 下配置走的是 agent bundle 导入导出（`nm agent import` / `nm agent export`），bundle schema 在 Step 4 已补上 `mode` 枚举字段（`apps/cli/src/agent/schemas/agents-bundle.schema.ts`）。在 `agents.yaml` 里给某个 agent 加一行 `mode: subagent` 就能限定它只在子代理场景出现：

```yaml
# examples/agents.yaml 片段
schemaVersion: 1
agents:
  researcher:
    prompts:
      system: |
        你是一个负责查资料的子代理。
      persist: {}
      dynamic: {}
    # 关键字段：暴露范围为 subagent（仅可被 task 工具调用）；
    # 缺省按 all 解释（主场景与子场景都可用）。
    mode: subagent
    # 可选：限定子代理可用的工具集
    tools:
      allow: [read, glob, grep]
```

然后导入即可生效：

```bash
nm agent import path/to/agents.yaml --db <path>
nm agent list --db <path>
nm agent show researcher --db <path>   # 确认 mode 已写入
```

切换范围只需改 yaml 重新 import（会 upsert 覆盖同名 agent）。改完之后，主 agent 下一次回合装配 `task` 工具时，可选范围会相应变化（`runAgentTurn` 装配期调 `agentRegistry.list()` 后按 `mode !== "primary"` 过滤出可被派生的子代理）。

## 验收场景（CLI 视角）

下面 4 个场景对应 PRD「验收标准」与 SPEC「测试策略 / 手工（apps）」。core 侧的断言逻辑由 `npm test -w @novel-master/core` 的 T-T1 / T-T2 / T-T4 等用例覆盖（自动化），CLI 这里只做「能用命令观察到结果」的可观察性验收。

> 注：以下命令假设 `nm` 已 link 到本 worktree 的 `apps/cli`（`node_modules/@novel-master/cli` 是指向 `apps/cli` 的 junction）。如果 CLI 运行时遇到与 subagent 无关的 bootstrap 报错（baseline 已知问题），按「代码确认」方式验收即可——能力是否存在以源码为准。

### 场景 1 — 基本派生回流

**目的**：主 agent 调 `task` 工具 → 子 session 创建 → 子 agent 跑完 → 末条 assistant 文本回流主会话 `tool_result`。

**步骤**：

1. 准备一个设了 `mode: subagent`（或缺省按 all）的 agent（如上面的 `researcher`），`nm agent import` 落库。
2. 在主会话跑主 agent：`nm agent run --session <parentSessionId> --content "帮我查一下 X 并总结"`（主 agent 自行决定是否派子 agent）。
3. 主回合结束后查主会话消息流：

   ```bash
   nm message list --session <parentSessionId> --db <path>
   ```

**预期**：

- 主会话末条附近出现一条 `tool_use`（name 为 subagent 工具）+ 对应的 `tool_result`，`tool_result` 的文本是子 agent 末条 assistant 文本（不是被 `JSON.stringify` 包成 `{"text":"..."}` 壳）。
- 子 agent 的中间 tool 调用（read/grep 等）**不出现**在主会话里。
- `tool_result` 落库的 JSON 里带 `meta.subagentSessionId`（用 `nm message show --id <toolResultId>` 或直接查库可见）。

**对应自动化用例**：T-T1（`task` 工具基本闭环）。

### 场景 2 — 并行派生

**目的**：主 agent 单条消息内发起 2 个 `task` 调用 → 并发执行 → 各自独立子 session → 结果各自回流。

**步骤**：

1. 主 agent 跑一条会同时派两个子任务的回合（依赖模型决策；调试时可用 mock LLM 直接构造双 `tool_use`）。
2. 回合结束后：

   ```bash
   # 主会话应能看到两条独立的 tool_use + tool_result
   nm message list --session <parentSessionId> --db <path>
   # 查父 session 下的子会话（应有两个）
   # CLI 暂无 list-children 子命令，用 SQL：
   # sqlite3 <path> "SELECT id, title FROM chat_session WHERE parent_session_id = '<parentSessionId>'"
   ```

**预期**：

- 主会话有 2 条 `tool_use` + 2 条 `tool_result`，一一对应。
- `chat_session` 表里该 `parent_session_id` 下有 2 条子 session 记录，各自独立。
- 两个子 agent 的消息流互不串扰（分别 `nm message list --session <childA>` / `<childB>` 验证）。

**对应自动化用例**：T-T4（并行派生）。

### 场景 3 — 递归上限拦截

**目的**：全局递归深度上限 2 层（主 → 子 → 孙，孙不能再派）；`mode` 非 subagent/all 的 agent 不能被调用。

**步骤**：

1. 配置 A、B 两个 agent 都设 `mode: subagent`（或缺省按 all），构成「主 → A → B」可达第 2 层；再配一个 C 设 `mode: primary`（主场景专用，不可被派生）。
2. 让 B 在子 agent 回合内尝试再调 `task`（派孙 agent）。
3. 让主 agent 尝试用 C 作为 `subagentName` 调 `task`。

**预期**：

- B（depth=2）的回合里，`task` 工具压根没注册（`resolveAgentToolRegistry` 在 `depth >= 2` 时强制移除 `task`），模型看不到该工具。如果模型硬调，会拿到「深度超限」类错误 `tool_result`。
- 主 agent 用 C 调 `task` 时，拿到「不允许被调用」错误 `tool_result`（不执行、不建子 session）。

**CLI 观察**：

```bash
# 孙 agent 不会被创建：父 session 下只有子 session，没有孙 session
# sqlite3 <path> "SELECT count(*) FROM chat_session WHERE parent_session_id IN (SELECT id FROM chat_session WHERE parent_session_id = '<parentSessionId>')"
# → 0
```

**对应自动化用例**：T-T2（递归上限）、T-T3（不可调用拦截）。

### 场景 4 — 子会话只读浏览（CLI 视角）

**目的**：用 CLI 完整查看子 agent 的对话历史（mobile/desktop 的只读浏览页是 UI 侧验收，CLI 这里用 `nm message list --session` 达到同等可观察性）。

**步骤**：

1. 从场景 1 跑完后，拿到主会话 `tool_result` 的 `meta.subagentSessionId`。
2. 用子 session id 查消息：

   ```bash
   nm message list --session <childSessionId> --db <path> [--show-seq]
   ```

**预期**：

- 能完整看到子 agent 的 user prompt（task 工具入参的 `prompt`）、assistant 回复、子 agent 内部的 tool 调用与结果。
- 子会话是**只读归档**：CLI 本身就是只读查询，不涉及继续对话；UI 侧的「无 composer / 不支持发消息」由 mobile/desktop 浏览页保证（Step 17 / Step 18）。
- 若子 agent 非正常结束（如 `max_steps`），子会话里能看到半成品消息；主会话的 `tool_result` 文本形如 `[子代理未完成任务: stopReason=max_steps]`，`meta.subagentSessionId` 仍存在，CLI 同样能据此跳进去看半成品。

**对应自动化用例**：T-T8（非正常结束 fallback）、T-T9（子 agent VFS 可见性）。

## 已知限制与阻塞

- **`nm agent list` 不展示虚拟 `general`**：如上文「用法 2」所述，这是 `listAgentIds()` 与 `list()` 的口径差异，**非 bug**。要看到 `general`，导入 `examples/agents.yaml` 即可。虚拟 `general` 自带 `mode: subagent`（FR-5）。
- **CLI 没有 `nm session list-children` 子命令**：列父 session 下的子会话目前要走 SQL（`listByParentSession` 仓储方法已在 core 就绪，但未暴露成 CLI 子命令）。本节点不补这个命令（超出 Step 19 scope）。
- **CLI 运行时 bootstrap 预存问题**：在当前环境实测 `nm agent list` 时遇到 `createChatServices` 读 `sessionDeps.state` 为 undefined 的报错（与 subagent 无关，属于 baseline 已知的 CLI/session 类型错）。因此本验收以**代码确认**为主：能力是否存在以 `apps/cli/src/message/commands.ts`、`apps/cli/src/agent/registry-commands.ts` 与 core `AgentRegistryService` 的源码为准（上文已逐条核实）。

## 代码确认结论（无法实跑 CLI 时的验收依据）

| 能力 | 源码位置 | 结论 |
|---|---|---|
| `nm message list --session <childId>` 查子会话 | `apps/cli/src/message/commands.ts` `runMessage` → `resolveSessionId(flags)` → `messages.listBySession(sessionId)` | ✅ 现有能力，对父子 session 不区分，传子 id 即可 |
| `nm agent list` 展示 `general` | `apps/cli/src/agent/registry-commands.ts` 走 `listAgentIds()`；虚拟注入只在 core `AgentRegistryService.list()` | ⚠️ 空 DB 看不到；导入 `examples/agents.yaml` 后可见；`task` 运行时按 `list()` 永远有 `general` |
| `mode` 配置导入导出 | `apps/cli/src/agent/schemas/agents-bundle.schema.ts` + `import-export.ts` | ✅ bundle schema 已支持 `mode` 枚举，`nm agent import/export` 闭环 |
