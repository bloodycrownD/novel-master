---
zone: core-agent
agent: domain-survey
files_scanned: 17
---

# W2 · core-agent 按域测绘

扫描范围：`packages/core/src/domain/agent/`（14 文件）+ `packages/core/src/domain/session-run-state/`（3 文件），共 17 文件 / 约 1,300 行生产代码，**全部逐行读完**（无抽样）。

## 摘要

两块小而硬的域。`domain/agent/` 是「智能体定义」的全生命周期：Zod wire schema（唯一序列化源）、写入门禁、patch 合并、tool policy 校验与装配过滤、doom-loop 检测、agent 会话端口。`domain/session-run-state/` 是「会话 run 状态」的每会话单行持久化契约。两者都是**纯数据/纯函数层**，不碰 LLM、不碰 IPC。

## 职责与边界

### `domain/agent/`

| 子目录 | 职责 | 边界 |
|---|---|---|
| `model/` | `AgentDefinition` 领域类型 + Zod wire schema（`agentDefinitionSchema`，自带 `toWire`） | `AgentPromptLayout` 本体在 `domain/prompt/`，此处只做 wire↔domain 转换 |
| `logic/` | 8 个纯函数：doom-loop 检测、runId 生成、patch 合并、tool registry 过滤、savedModelId 解析、定义校验、tool policy 校验 | 全部无 I/O、无 DB |
| `repositories/` | `agent_definition` 表的 port + SQLite 实现 | 6 个方法全部有生产调用方 |
| `session/` | `AgentSession` 端口 + `InMemoryAgentSession` | **端口在 domain，两个生产实现在 `service/agent/impl/`**（见 F-15） |

### `domain/session-run-state/`

`session_run_state` 表（每 sessionId 至多一行）的行模型 + 仓储 port + SQLite 实现。持久层只认三态 `starting | running | settled`；`interrupted/finished/failed` 三个终态子类型只存在于 runtime 内存状态机（`apps/mobile/src/services/session-stream-unit-manager.service.ts`），落库一律折叠成 `settled`（`session-run-state.service.ts:34`）。业务编排在 `service/session-run-state/`，本域只到仓储为止。

## 对外接口

### 经 `packages/core/src/public/agent.ts` 暴露

| 符号 | 位置 | 域外消费方 |
|---|---|---|
| `AgentDefinition` / `AgentToolPolicy` | `model/agent-definition.ts` | 双端 |
| `agentDefinitionSchema` | `model/agent-definition.schema.ts:277` | cli / desktop / mobile 的 YAML 服务、`assess-agent-definition-wire` |
| `promptsDocumentSchema` | `model/agent-definition.schema.ts:88` | `apps/cli/src/agent/schemas/agents-bundle.schema.ts:8`、`load-agent-prompt-layout.ts:10` |
| `validateAgentDefinition` | `logic/validate-agent-definition.ts:26` | `domain/tool/builtin/agent-tool.ts` |
| `resolveAgentToolRegistry` | `logic/resolve-agent-tool-registry.ts:57` | `service/agent/*` |
| `resolveSavedModelId` / `resolveSummarySavedModelId` | `logic/resolve-saved-model-id.ts:27,39` | 双端 IPC handler、prompt-token 服务、compaction |
| `AgentSession`（type）/ `ChatAgentSession` | `session/agent-session.port.ts:16` | `service/agent/*` |
| `InMemoryAgentSession` | `session/impl/in-memory-agent-session.ts:18` | **仅 core 自测**（见 F-14） |
| `DOOM_LOOP_THRESHOLD` / `CROSS_ROUND_WINDOW` / `assertNoDoomLoopInBlocks` / `assertNoCrossRoundDoomLoop` | `logic/doom-loop.ts` | **无域外消费方**（见 F-10） |
| `agentDefinitionDocumentSchema` | `model/agent-definition.schema.ts:136` | **全仓无消费方**（见 F-10） |
| `validateAgentToolPolicy` | `logic/validate-agent-tool-policy.ts:55` | **仅 core 内部**（见 F-10） |
| `AgentRunResult` / `ModelRoundSummary` | `model/agent-run-result.ts` | 双端 run 状态投影 |

### 未进 public 面（core 内部）

`mergeAgentDefinitionPatch`（唯一生产调用方 `domain/tool/builtin/agent-tool.ts:456`）、`generateAgentRunId`（唯一调用方 `service/agent/impl/agent-runner.ts`）、`assertNoDoomLoop`、`DoomLoopChecksConfig`、`AgentDefinitionRepository` 及其实现、`SessionRunStateRepository` 及其实现。

## 数据访问

| 表 | 访问点 | 备注 |
|---|---|---|
| `agent_definition` | `repositories/impl/sqlite-agent-definition.repository.ts:33-117` | 6 条语句全为单语句、`queryTemplate`/`executeTemplate`，**无事务、无 CoordinatedWrite**。`upsert`（:80）单行 `ON CONFLICT(agent_id) DO UPDATE`。`getRawWire`（:57）刻意不解码 `prompts_json`，让坏行也能删（`agent-registry.service.ts:150-152`）——**intentional**，设计正确。 |
| `session_run_state` | `repositories/impl/sqlite-session-run-state.repository.ts:61-156` | `upsert`（:78）单行 UPSERT；`listByStatuses`（:110）动态拼 `IN (...)`，空数组短路返回 `[]`（:114）防 `IN ()` 语法错，绑定名 `status0..N` 去重。删除方法供会话/项目删除事务内调用（`session.service.ts:222`、`project.service.ts`）。 |

DDL：`session_run_state` 建于 `packages/core/src/bootstrap/session-run-state/session-run-state-schema.ts:16`，`status TEXT NOT NULL CHECK (status IN ('starting','running','settled'))`（:20）。已核 `git show 0aaeacde`（建表首提 commit）：**CHECK 约束自建表起即存在**，非后补。

无 KKV 域触碰。无文件路径触碰。

## 依赖关系

**import（出）**

- `domain/agent` → `domain/chat/model/{content-block,message,message-usage}`（类型）、`domain/prompt/{model,logic}`、`domain/tool/{logic/tool-registry,builtin/vfs-tools}`、`infra/{random-uuid,serialization/{decode,encode},tdbc/*,sql-template/*,llm-protocol/ports/adapter.port}`、`errors/{agent-runtime-errors,agent-config-errors}`、`zod`
- `domain/session-run-state` → `infra/tdbc/*`、`infra/sql-template/*`

**被消费（入）**

- `service/agent/*`（registry / runner / turn 装配）、`domain/tool/builtin/{agent-tool,subagent-tool}`、`service/compaction-conditions/*`、`service/session-run-state/*`、`service/chat/impl/{session,project}.service`、`config-forms/{agent/agent-editor-state,stored-config-validity}`、`bootstrap/session-run-state`、`apps/cli`、`apps/desktop`、`apps/mobile`

**环**：无。`domain/agent` → `domain/tool` 单向；`domain/tool/builtin/agent-tool` → `domain/agent/logic`（`mergeAgentDefinitionPatch` + `ValidateAgentDefinitionOptions` 类型）构成 **domain 内部双向引用**（`domain/agent/logic/validate-agent-tool-policy` ↔ `domain/tool/builtin/vfs-tools` ↔ …）。当前是纯类型/纯函数双向，无运行时 require-cycle（`vfs-tools` 不 import `domain/agent`），但这是个**易碎平衡**——任何人给 `vfs-tools` 加一句 `import { resolveAgentToolRegistry }` 就会炸 RN 的 `Require cycle`（RULE「子代理与记忆」条目已记过同族坑）。

## 发现清单

### F-core-agent-1 | P1 | `model/agent-definition.schema.ts:222-229` + `logic/validate-agent-definition.ts:88-89` | 置信 confirmed

```ts
  for (const block of def.prompts.persist) {
    persist[block.name] = persistBlockToWire(block);
  }
```

域模型 `AgentPromptLayout.persist` 是**数组**（带 `name` 字段），wire 是 `Record<blockName, block>` —— 这是一个**非单射**映射。重名块被 `persist[block.name] = …` 静默覆盖（后写胜）。

关键在于**唯一的重名守卫没被写路径调用**：`domain/prompt/logic/validate-agent-prompt-layout.ts:335` 的 `assertUniqueBlockNames` 只在 `validateAgentPromptLayout(layout)` 里，它唯一的生产调用方是 UI 表单路径 `config-forms/agent/agent-editor-state.ts:590`。而 LLM 写路径走 `assertWritableAgentDefinitionShape`（`validate-agent-definition.ts:52-84`），它对 `prompts` 只做 `Array.isArray(prompts.persist)` 检查（:77-78），然后 `decode(agentDefinitionSchema.toWire(def), agentDefinitionSchema)`（:89）——**`toWire` 的折叠发生在 decode 之前**，decode 拿到的是已经塌缩的 map，因此这个「终极防线」结构上不可能发现重名。

可复现路径：`agent` 工具 update → `mergeAgentDefinitionPatch`（`prompts` 子键合并，`prompts.persist` 整数组替换）→ `upsert` → `validateAgentDefinition` → 校验通过 → `repository.upsert` 落盘时丢块。工具 description（`agent-tool.ts:285`）明确告诉 LLM「prompts.persist / prompts.dynamic 为块数组」，所以这是模型很容易产出的形状。

**建议**：`assertWritableAgentDefinitionShape` 在 decode 之前先调 `validateAgentPromptLayout(def.prompts)`（它已内含 `assertUniqueBlockNames` + 与读侧同源的 `validateAgentPromptLayoutFromMaps`），或在其后补一条 `new Set(persist.map(b=>b.name)).size === persist.length` 断言。

---

### F-core-agent-2 | P2 | `session/agent-session.port.ts:52` | 置信 confirmed

```ts
  /** Hides messages in a seq range (compaction). Returns affected count. */
  hideRange(fromSeq: number, toSeq: number): Promise<number>;
```

**`AgentSession.hideRange` 在生产代码中零调用方。** 全仓 `\.hideRange\(` 命中 17 处，逐条核过：`message-transcript-effects.service.ts:51,125,151` 与各处测试的接收者都是 `MessageService` / `MessageRepository`（`domain/chat/repositories/message.port.ts`）上的**同名不同接口**方法，与本端口无关。唯一在 `AgentSession` 类型链上的调用是 `service/agent/impl/ephemeral-overlay-agent-session.ts:72` 的 `this.base.hideRange(...)` 透传，而 `ephemeral` 自身也没有调用方。

真实压缩链路是 `service/compaction-conditions/run-compaction.ts:66` → `runHideMessageAction(params.projectId, params.sessionId, slice, …)`，全程按 sessionId 操作，**根本不经过 AgentSession**。

代价：三个实现（`in-memory-agent-session.ts:60`、`chat-agent-session.ts:54`、`ephemeral-overlay-agent-session.ts:72`）+ 一条 `test/agent/agent-session.test.ts:26` 断言在维护一个永不执行的契约。

**建议**：删端口方法与三个实现 + 该测试；或若判定「agent run 内压缩」是待接线能力，注释里写明接线计划与 owner，别让它以「已实现」的面目存在。

---

### F-core-agent-3 | P2 | `session/agent-session.port.ts:54-60` | 置信 confirmed

```ts
   * 用途：agent turn abort 时回滚到 turn 起点，避免残留 partial assistant 消息。
  truncateAfterMessage(afterMessageId: string | null): Promise<void>;
```

**零生产调用方，且注释描述的语义与现网行为相反。**

`service/agent/impl/agent-runner.ts:336-341` 的 `handleAbort` 统一 abort 处理，其 doc 明写「统一 abort 处理：置 stopReason，**保留已写入的 partial assistant**」，:680-683 的分支注释也写「abort 时仍写入 partial assistant（用户能看到模型刚吐出的内容），然后退出」。也就是说 abort 的产品口径已翻转为**保留** partial，而端口注释仍在说「避免残留 partial assistant 消息」。

唯一调用方是 `test/agent/agent-runner-abort-rollback.test.ts:584-599`，该用例自己声明「静态契约校验：ChatAgentSession 必须暴露 truncateAfterMessage」，断言是 `assert.equal(typeof cs.truncateAfterMessage, "function")` 加两次直调。这正是 RULE「验收断言的『牙齿』三条判据」第①条的教科书案例——**恒真的接口存在性断言**：把整个 abort 回滚实现删掉，这条用例照样绿。

**建议**：删端口方法 + 三个实现 + 该无牙断言；若保留则先修注释，并补一条走真实 abort 路径的行为断言。

---

### F-core-agent-4 | P2 | `session/impl/in-memory-agent-session.ts:78-83` | 置信 confirmed

```ts
    this.messages.splice(idx + 1);
```

假实现与生产在 **seq 发号**上分叉。RULE「seq（消息编号）」条目明写：「回滚是物理删尾（`DELETE WHERE seq > ?`），删后新消息会**复用旧 seq**（跨时间不唯一，剩余 seq 连续无空洞）」——生产按 `MAX(seq)+1` 发号，删尾后 `MAX` 回落，新消息复用空洞。

`InMemoryAgentSession.append`（:42）用 `this.seq += 1` 单调计数器，`truncateAfterMessage` 非空分支**不回退 `this.seq`**。结果：假实现删尾后下一个 seq 留**空洞**，生产不留。任何基于 `InMemoryAgentSession` 的测试对「回滚后新消息 seq」的口径都与现网相反。

**建议**：`truncateAfterMessage` 非空分支后重算 `this.seq = Math.max(0, ...this.messages.map(m => m.seq))`，与 `domain/chat/repositories/impl/sqlite-message.repository.ts` 的 `MAX(seq)+1` 对齐；并在 `agent-session.test.ts` 补一条口径锁定用例。

---

### F-core-agent-5 | P2 | `logic/doom-loop.ts:46-52` | 置信 confirmed

```ts
  const tail = toolUses.slice(-threshold);
  const first = tail[0]!;
  const allSame = tail.every(
    (t) => t.name === first.name && sameInput(t.input, first.input)
  );
```

`threshold` 来自 `options.definition.runtime?.doomLoopThreshold ?? DOOM_LOOP_THRESHOLD`（`agent-runner.ts:267-268`），**调用方不做任何 clamp**，而 schema 侧 `runtime.doomLoopThreshold: z.number().int().positive().optional()`（`agent-definition.schema.ts:147`）接受 **1**。

`threshold = 1` 时：`toolUses.length < 1` 不成立即进入；`tail` 长度 1；`[x].every(...)` **恒为 true**（空真）→ 第一次工具调用就抛 `DOOM_LOOP`。即一个完全合法、只差一个字（`int().positive()` 而非 `min(2)`）的 agent 定义会让该 agent 的**每一次 run 都在首个工具调用后终止**，且 LLM 侧只看到「doom loop」而看不到真实原因。

**建议**：schema 改 `z.number().int().min(2)`（跨端生效，存量 `1` 值在 decode 时即被拒并给出明确 zod 消息）；`doom-loop.ts` 内再加一道 `Math.max(2, threshold)` 兜底。

---

### F-core-agent-6 | P2 | `logic/validate-agent-tool-policy.ts:63-64` vs `logic/resolve-agent-tool-registry.ts:22` | 置信 confirmed

```ts
  const hasDeny = tools.deny != null;          // 校验层：只看 null
```
```ts
  if (policy.deny != null && policy.deny.length > 0) {   // 装配层：还看 length
```

allow/deny 互斥与空集语义在**两个文件各实现一遍**，且对空 `deny` 的判定不一致：校验层认为 `deny: []` 算「设了 deny」（因而 `deny: []` + `allow: [...]` 会抛互斥错），装配层认为 `deny: []` 算「没设 deny」（走全放行分支）。目前靠「校验一定先于装配跑」侥幸不炸，但这是**无编译期约束的隐式顺序耦合**——任何新增的装配调用点跳过 `validateAgentDefinition` 就会拿到相反语义。

`resolve-agent-tool-registry.ts:19-21` 的 allow 分支同样：allow 与 deny 同时存在时**静默以 allow 胜出**，不报错。

**建议**：把「allow/deny 归一化」抽成一个共享纯函数（返回 `{kind: "all"|"allow"|"deny", names}`），两个文件都调它；或至少让装配层在两者同时存在时也走 `validateAgentToolPolicy` 的互斥检查。

---

### F-core-agent-7 | P2 | `repositories/impl/sqlite-session-run-state.repository.ts:21-35` | 置信 confirmed

```ts
function tokenSource(value: unknown): SessionRunStateTokenSource {
  return value === "usage" ? "usage" : "heuristic";
}
...
    status: String(row.status) as SessionRunStatus,
```

同一个 `rowToState` 里两列两种防御风格：`token_source` 做了收窄函数（脏值/缺省回退），`status` 却是**无校验的 `as` 断言**。已核 DDL 自建表起就有 `CHECK (status IN ('starting','running','settled'))`（`git show 0aaeacde` 实测），所以现网不会脏——**但这是靠一条 SQL CHECK 兜着，代码层零防御**：任何绕过该表写入的路径（未来加列/align 改表、测试夹具直插、备份恢复跨版本）一旦落进脏值，`status` 会带着 union 外的字符串一路流到 `listByStatuses` 的 hydration 分支，而下游是按 `=== "running"` 之类做判定的。

**建议**：与 `tokenSource` 对称加一个 `runStatus(value): SessionRunStatus`，未知值回退 `"settled"`（最保守，不会被当成活 run 反复水合出幽灵单元）。

---

### F-core-agent-8 | P2 | `session/agent-session.port.ts:16` + `service/agent/impl/{chat-agent-session,ephemeral-overlay-agent-session}.ts` | 置信 confirmed

`AgentSession` 端口声明在 `domain/`，但**三个实现里有两个在 `service/agent/impl/`**。域层因此看不到自己端口的真实契约：唯一留在域内的实现是测试假件（见 F-14），而 `ChatAgentSession` / `EphemeralOverlayAgentSession` 的语义（hidden 过滤、seq 发号、事务边界、overlay 可见性叠加）完全不在 `domain/` 的视野内。

这直接导致 F-2 / F-3 这类死方法能长期存活：域层看着「端口有 3 个实现、都有测试」，实际生产一个都没调。

**建议**：要么把两个生产实现下沉到 `domain/agent/session/impl/`（它们目前并不碰 service 层的重依赖），要么在端口上加一行 `@see` 指向真实实现方，并接受「域层不保证实现完备」——但至少要让 F-2/F-3 这类死方法在下一次扫描里能被看见。

---

### F-core-agent-9 | P2 | `model/agent-definition.schema.ts:25` | 置信 confirmed

```ts
const persistBlockValueSchema = persistTextBlockValueSchema;
```

纯别名，无任何差异化意图。`persistBlockValueSchema` 与 `dynamicTextBlockValueSchema` 一起在文件末尾（:282-286）被具名导出，但全仓无消费方（`public/agent.ts` 只转出了 `agentDefinitionSchema` / `agentDefinitionDocumentSchema` / `promptsDocumentSchema`）。而 `agentDefinitionDocumentSchema` 本身（:136）虽是 strict root schema、有文档价值，却同样零消费方。

**建议**：删 `persistBlockValueSchema` 别名与三个无消费方的具名导出（`persistBlockValueSchema` / `dynamicTextBlockValueSchema` / `agentDefinitionDocumentSchema`），直接用内联名。

---

### F-core-agent-10 | P2 | `public/agent.ts:27-33` | 置信 confirmed

`@novel-master/core/agent` 的公开面里有一批**零域外消费方**的符号（逐个 `Select-String` 全仓核过，含 apps/ 下全部 ts/tsx）：

- `DOOM_LOOP_THRESHOLD`、`CROSS_ROUND_WINDOW`、`assertNoDoomLoopInBlocks`、`assertNoCrossRoundDoomLoop`（:27-32）——消费方只有 `service/agent/impl/agent-runner.ts`（core 内部）与 `test/agent/doom-loop.test.ts`
- `agentDefinitionDocumentSchema` —— 全仓零消费
- `validateAgentToolPolicy` —— 只有 `domain/agent/logic/validate-agent-definition.ts` 内部调
- `InMemoryAgentSession`（:33）—— 只有 core 自己的 14 个测试文件用

讽刺的是：doom-loop 的**基元** `assertNoDoomLoop` 没有导出，导出的是它的 wrapper `assertNoDoomLoopInBlocks`——公开面既冗余又不完整。

**建议**：删掉这批 re-export（core 内部走相对路径 import，不受 public 面影响）；doom-loop 四个符号若确实打算给宿主用，补一条真实消费方再留。

---

### F-core-agent-11 | P3 | `logic/doom-loop.ts:48-50` vs `:66-68` | 置信 confirmed

```ts
  const allSame = tail.every(
    (t) => t.name === first.name && sameInput(t.input, first.input)
  );
```
```ts
function sameToolUse(a: ToolUseBlock, b: ToolUseBlock): boolean {
  return a.name === b.name && sameInput(a.input, b.input);
}
```

`assertNoDoomLoop` 内联手写了 `sameToolUse` 的定义，而 `sameToolUse` 就在同文件 :66。同一个「同名 + 同 JSON input」的判定谓词在 96 行的文件里存在两份实现，改一处漏一处不会有任何编译期信号。

**建议**：`tail.every((t) => sameToolUse(t, first))`，并把 `sameToolUse` 上移到 `assertNoDoomLoop` 之前（`const` 函数声明提升不适用于此，改成 `function` 声明已可，但顺序上移更可读）。

---

### F-core-agent-12 | P3 | `logic/generate-agent-run-id.ts:10-12` | 置信 confirmed

```ts
export function generateAgentRunId(): string {
  return randomUUID();
}
```

零逻辑的透传包装，文件 doc 强调「仅 Core agent-runner 调用」——确实只有一个调用方（`agent-runner.ts`），而它**并未**被 `public/agent.ts` 导出。同时 `sqlite-message.repository.ts`、`message.service.ts`、`project.service.ts`、`session.service.ts`、`provider.service.ts` 等 8 处都直接调 `randomUUID`。也就是说 runId 是全仓唯一一个「用专属包装函数而不是直接调 `randomUUID`」的 id，规则不统一。

**建议**：删包装，`agent-runner.ts` 直接 `import { randomUUID } from "@/infra/random-uuid.js"`，与全仓其余 8 处一致。

---

### F-core-agent-13 | P3 | `logic/validate-agent-tool-policy.ts:23-26` + `:34` | 置信 confirmed

```ts
  for (const raw of names) {
    const name = normalizeAgentToolPolicyName(raw);
    if (!registryNames.has(name)) {
      const hint = migrationHint(raw);
```

`raw` 在 :34 已归一一次，`migrationHint`（:24）进来又 `normalizeAgentToolPolicyName(raw)` 归一一次。归一是幂等的（只剥 `vfs.` 前缀），所以当前无害，但对一个只做前缀剥离的函数重复调用是纯噪音，也让读者误以为两次归一语义不同。

**建议**：`migrationHint(name)` 收已归一的名字，函数内不再归一。

---

### F-core-agent-14 | P2 | `session/impl/in-memory-agent-session.ts`（整文件）+ `public/agent.ts:33` | 置信 confirmed

一个**测试假件住在生产树里**并被公开导出。文件头注释诚实写着 `In-memory agent session (tests).`，但物理位置是 `src/domain/agent/session/impl/`（与真实实现 `chat-agent-session.ts` 同级），且被 `public/agent.ts` 导出为 `@novel-master/core/agent` 的公开 API。

后果有三层：① 双端打包会带上这段永不执行的代码；② 消费方（cli / desktop / mobile）可以合法地 `new InMemoryAgentSession()` 造一个不落库的会话，且**没有任何类型层面的警告**；③ 它的行为与生产分叉（F-4 的 seq 口径、F-2/F-3 的死方法），却因住在 `domain/` 而被当成「生产契约的一部分」参与评审。

全仓核过：14 个消费方**全部是 `packages/core/test/**`**，`apps/**` 零引用。

**建议**：迁到 `packages/core/test/` 或 `src/testing/`（若 core 有此类目录），并从 `public/agent.ts` 摘掉。core 自测通过相对路径 import 即可，不受影响。

---

### F-core-agent-15 | P3 | `logic/validate-agent-definition.ts:52-84` vs `config-forms/stored-config-validity/assess-agent-definition-wire.ts:30-52` | 置信 confirmed

「这个值是不是**域形态**（而非 wire 形态）的 AgentDefinition」这个谓词被独立实现了两次：

```ts
// config-forms/stored-config-validity/assess-agent-definition-wire.ts:30
function isAgentDefinitionDomainShape(value: unknown): value is AgentDefinition {
  ...
  return Array.isArray(prompts.persist) && Array.isArray(prompts.dynamic);
}
```
```ts
// domain/agent/logic/validate-agent-definition.ts:73-79
  if (prompts == null || typeof prompts !== "object" || Array.isArray(prompts)
      || !Array.isArray(prompts.persist) || !Array.isArray(prompts.dynamic)) {
```

后者是前者的规范实现（含 `name` 非空校验），前者是它的复制品。域形态将来加字段（比如 `mode` 的新值、`runtime` 的新键），只有一边更新时，`resolveAgentDefinitionFromStorage` 会把合法的域对象误判为 wire 走 decode，或反之。

同文件 14-20 行的 `REMOVED_FEATURE_KEYWORDS` 又是另一层耦合：它用**子串匹配**去命中 `agent-definition.schema.ts` 里 `rejectLegacyPromptKeys`（:41-58）与 `assertNoLegacyAgentFields`（:161-179）写下的错误消息文本（`prompts.blocks` / `preferredModelId` / `prompts.regions` / `prompts.chat` / `legacy nested model`）。任何人润色这些报错文案，`assessAgentDefinitionWire` 的 `removed_feature` 分类就会静默退化成 `broken_wire`。

**建议**：把 `isAgentDefinitionDomainShape` 提到 `domain/agent/logic/` 与 `assertWritableAgentDefinitionShape` 共用一份实现；legacy keyword 表改为由 schema 侧导出常量（如 `LEGACY_REMOVED_PROMPT_KEYS`）而非散字面量。

---

### F-core-agent-16 | P3 | `logic/validate-agent-definition.ts:88-99` + `infra/serialization/decode.ts:20` | 置信 confirmed

```ts
      throw new ConfigDecodeError("INVALID_SCHEMA", zodMessage(parsed.error));
```
```ts
    if (error instanceof AgentConfigError) { throw error; }
```

同一次 `decode()` 调用会抛出**两个不同类、但 code 字符串相同**的错误：`AgentConfigError("INVALID_SCHEMA")`（来自 schema 的 `z.preprocess` 钩子，本文件 :91 正确地用了 `instanceof` 区分）和 `ConfigDecodeError("INVALID_SCHEMA")`（zod 失败包装）。本文件与 `assess-agent-definition-wire.ts:23` 都用了 `instanceof`，当前安全；但这是个**跨文件共享的 code 判别式陷阱**——任何新写的 `if (err.code === "INVALID_SCHEMA")` 都会把两类错误混为一谈。`ConfigDecodeError` 不在本域，但耦合由本域的 schema 抛点制造。

**建议**：不紧急（两处现存代码都正确）。在 `validate-agent-definition.ts` 的 `catch` 上加一行注释说明「此处只透传 AgentConfigError，zod 失败会以 ConfigDecodeError 到达」，防止后来者误加 `code` 比较。

---

### F-core-agent-17 | P3 | `logic/merge-agent-definition-patch.ts:62` | 置信 intentional

```ts
  return merged as unknown as AgentDefinition;
```

类型洞，但**文件 doc 已显式声明这是有意的**（:22-24「本函数不校验形状（如 prompts 传字符串会原样落进结果）——语义校验统一交 `validateAgentDefinition` 与 wire 往返，合并层只负责语义清晰的覆盖」）。设计正确：合并层保持无校验纯函数，校验单一收口在写入门禁。按协议标 intentional，不当问题报。

**残留**：`as unknown as` 意味着 `merged` 的形状错误在**编译期完全不可见**，全靠运行时的 `assertWritableAgentDefinitionShape` 兜。若将来新增一条不经 `validateAgentDefinition` 的 upsert 路径，类型系统不会报警。已在 F-6 中作为同一根因记录。

---

### F-core-agent-18 | P3 | `model/agent-definition.schema.ts:222-229` vs `domain/prompt/logic/validate-agent-prompt-layout.ts:345-351` | 置信 confirmed

「域数组 → wire map」的序列化循环在两处各写一遍：

```ts
// agent-definition.schema.ts:222-229
  const persist: ... = {};
  for (const block of def.prompts.persist) { persist[block.name] = persistBlockToWire(block); }
  const dynamic: ... = {};
  for (const block of def.prompts.dynamic) { dynamic[block.name] = dynamicBlockToWire(block); }
```
```ts
// validate-agent-prompt-layout.ts:345-351
  const persistMap: Record<string, unknown> = {};
  for (const block of layout.persist) { persistMap[block.name] = persistBlockToWire(block); }
  const dynamicMap: Record<string, unknown> = {};
  for (const block of layout.dynamic) { dynamicMap[block.name] = dynamicBlockToWire(block); }
```

前者漏了后者那道 `assertUniqueBlockNames`——正是 F-1 的直接成因。**同一个有损映射被复制成两份，其中一份丢了守卫。**

**建议**：`definitionToDocument` 改为调 `validateAgentPromptLayout(def.prompts)` 拿已归一布局再序列化（一次性消掉 F-1 与 F-18）。

---

### F-core-agent-19 | P3 | `logic/doom-loop.ts:78-84` | 置信 confirmed

```ts
  if (crossRoundWindow < 4 || crossRoundWindow % 2 !== 0 || toolUses.length < crossRoundWindow) {
    return;
  }
```

`runtime.doomLoopCrossRoundWindow` 的 schema 是 `z.number().int().positive()`（`agent-definition.schema.ts:149`），接受 1、2、3、5、7… 这些值会让跨轮检查**静默变成 no-op**，配置者看不出任何提示（与 F-5 的「静默变成误杀」是同一类病，方向相反）。合法配置 + 静默失效 = 最好的情况也是不可观测的行为。

**建议**：schema 改 `z.number().int().min(4).refine((n) => n % 2 === 0, { message: "doomLoopCrossRoundWindow 须为不小于 4 的偶数" })`；或在 guard 处 `console.warn` 一次降级。

---

### F-core-agent-20 | P3 | `model/session-run-state.ts:29` | 置信 intentional

```ts
export type SessionRunStateTokenSource = StreamTokenSource;
```

类型别名，与 `domain/format/sliding-token-rate.ts` 的 `StreamTokenSource` 同一份声明。文件 doc（:24-28）明写「展示层（双端 hook 的 `AgentStreamTokenSource`、mobile 单元的 `SessionStreamUnitTokenSource`）一律 alias 到本类型，新增来源只改一处」——**故意保留的历史命名**，正是 RULE「行模型字段名（历史命名…）」这类约定的意图。标 intentional。

**残留观察**：`StreamTokenSource` 定义在 `domain/format/`（滑动速率模块），却被 `domain/session-run-state/` 的持久化行模型反向引用——**持久层依赖表现层模块**。持久化层理应是更底层的位置。两处 alias 方向一致（都指向 `domain/format`），若要理顺应把中性声明下沉到更底层的模块，`domain/format/sliding-token-rate.ts` 反向引用它。P3，不阻塞。

---

### F-core-agent-21 | P3 | `docs/apm/RULE.md:13` | 置信 confirmed

RULE「hidden 消息」条目的指向是「过滤逻辑：`packages/core/src/domain/agent/session/`」。该目录下唯一做 hidden 过滤的是 `in-memory-agent-session.ts:29` 的**测试假件**（`this.messages.filter((m) => !m.hidden)`）。生产过滤在 `service/agent/impl/chat-agent-session.ts`。

指向本身不算错（domain 层的端口 doc 确实描述了「Visible messages in order (excludes `hidden`)」），但把「过滤逻辑」的实现地指到一个假件上，会让后续调查 hidden 行为的人跑偏——正如本次扫描里我自己先被它误导去找 domain 层的过滤实现。

**建议**：RULE 该条补一句生产实现路径 `packages/core/src/service/agent/impl/chat-agent-session.ts`。（**注**：本条为文档修正建议，`docs/apm/` 在本轮只读契约内，不由本代理执行。）

---

### F-core-agent-22 | P3 | `model/agent-definition.schema.ts:36-60` / `:161-179` | 置信 intentional

`rejectLegacyPromptKeys` 拒绝 `prompts.blocks` / `prompts.regions` / `prompts.chat`，`assertNoLegacyAgentFields` 拒绝 `preferredModelId` 与 legacy nested `model` 块。**故意设计的迁移兼容闸门**，每条都带具体迁移指引文案。按协议标 intentional。

**残留**：`stripLegacyWorktreeFromPromptsWire`（:62-86）先调 `rejectLegacyPromptKeys` 再 strip legacy worktree 块，而 `validateAgentPromptLayoutFromMaps`（`domain/prompt/logic/validate-agent-prompt-layout.ts:230`）**又调了一次** `stripLegacyWorktreeBlocksFromPersistMap`。同一份 strip 在同一趟 decode 里跑两遍——幂等故无害，但 legacy 键的拒绝逻辑与 strip 逻辑分居两文件两处，未来加一种 legacy 形态时容易只改一处。P3 观察，非问题。

---

### F-core-agent-23 | P3 | `repositories/impl/sqlite-session-run-state.repository.ts:110-123` | 置信 intentional

`listByStatuses` 手工拼 `IN (...)` + `status0..N` 命名绑定，并在空数组时短路返回 `[]`（:114-116）——避免 `IN ()` 语法错。RULE「双端 UI 输入需过滤非数字并归一空串/NaN，repo 层绑定值 `?? null`」的精神一致：**在 repo 层挡掉会打穿底层的输入**。刻意为之，非问题。记录以免 reduce 阶段被当重复实现合并掉。

## 争议与存疑

1. **F-5（`doomLoopThreshold: 1`）我判 P2 而非 P0。** 逻辑上「首次工具调用必 doom loop」是确定的，但触发前提是用户/模型主动把 `runtime.doomLoopThreshold` 写成 1——不是默认值、不是必现路径。若 reduce 阶段认为「配置型自伤」应整体降档，请按 P3 处理，我不坚持。

2. **F-1（重名块塌缩）我判 P1，但也可能是 P2。** 分歧点：这个静默丢块在实践中触发频率多高？LLM 产出两个同名 persist 块不是罕见（尤其块名是模型自拟的短词时）。但**后果可恢复**——用户下次 `get` 会看到块不见了，改配置补回即可，不涉及数据损坏或不可逆状态。我给 P1 是因为它发生在**唯一的主智能体自我改造路径**上（`agent` 工具），且失败是静默的。若 reduce 认为「可恢复 + 非默认路径」应降 P2，我接受。

3. **F-7（`status` 无防御断言）我可能高估了。** 已核 DDL 自建表起即带 `CHECK`（`git show 0aaeacde` 实测），现网不可能出现 union 外值。这条严格说不是活跃 bug，是**防御风格不一致**。若 reduce 阶段按「有 CHECK 兜底即非问题」剔除，我认可——但请保留在报告里，因为它是 `tokenSource` 就在旁边做了正确示范的反差点。

4. **F-8（端口与实现分层错位）我无法从本域单独判定该往哪边改。** 把 `chat-agent-session.ts` 下沉到 `domain/` 会引入对 `MessageService` 的反向依赖（它当前向上依赖 service 层），不是纯移动。需要看 `chat-agent-session.ts` 全文才能确定边界，本轮未读（超出 zone）。**移交 W3 分层扫描。**

5. **`domain/agent` ↔ `domain/tool` 的双向引用**（`validate-agent-tool-policy.ts` → `vfs-tools.ts`，反向 `agent-tool.ts` → `merge-agent-definition-patch.ts`）目前是纯类型 + 纯函数双向，无运行时 require-cycle。但这是**单向依赖图被打破后的平衡态**——`domain/tool/builtin` 与 `domain/agent/logic` 在概念上应是同层兄弟，现状是 `domain/agent/logic` 依赖 `domain/tool/builtin` 的 `FILE_TOOL_NAMES` / `normalizeAgentToolPolicyName`。RULE 已记过 RN 侧同族坑（模块级 import 的 require-cycle 在依赖解析顺序变化时才暴露）。**未构成问题，但列为结构性风险移交 W3。**

## 覆盖统计

- 文件：17 / 17 全读（`agent/` 14 + `session-run-state/` 3）
- 行数：约 1,300 行 100% 覆盖，无抽样
- 引用核验方式：全部用 `Select-String -List` 列文件名后定点读，未做全仓内容倾倒
- git 操作：仅只读（`git log --follow`、`git show 0aaeacde:...`），无任何 git 写
- `docs/apm/`：只读 RULE.md，**未创建/修改任何文件**（F-21 的修正建议留给主代理执行）
- 域外延伸读取（为判定死路径所必需，未计入 files_scanned）：`service/agent/impl/{agent-runner,agent-registry.service,chat-agent-session,ephemeral-overlay-agent-session}.ts`、`domain/tool/builtin/{agent-tool,vfs-tools}.ts`、`domain/prompt/logic/{validate-agent-prompt-layout,agent-prompt-layout-wire}.ts`、`domain/agent/model/agent-prompt-layout.ts`、`config-forms/stored-config-validity/assess-agent-definition-wire.ts`、`service/compaction-conditions/run-compaction.ts`、`bootstrap/session-run-state/session-run-state-schema.ts`、`infra/serialization/{decode,encode}.ts`、`public/agent.ts`
