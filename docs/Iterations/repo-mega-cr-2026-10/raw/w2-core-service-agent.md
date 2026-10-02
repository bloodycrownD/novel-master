---
zone: core-service-agent
agent: domain-survey
files_scanned:
  - packages/core/src/service/agent/agent-abort-registry.port.ts (51)
  - packages/core/src/service/agent/agent-registry.port.ts (35)
  - packages/core/src/service/agent/agent-stream-registry.port.ts (94)
  - packages/core/src/service/agent/agent.port.ts (34)
  - packages/core/src/service/agent/create-agent-abort-registry.ts (37)
  - packages/core/src/service/agent/create-agent-registry-service.ts (25)
  - packages/core/src/service/agent/create-agent-runner.ts (69)
  - packages/core/src/service/agent/create-agent-stream-registry.ts (92)
  - packages/core/src/service/agent/default-subagent-definition.ts (32)
  - packages/core/src/service/agent/impl/agent-registry.service.ts (171)
  - packages/core/src/service/agent/impl/agent-runner.ts (1146)
  - packages/core/src/service/agent/impl/chat-agent-session.ts (60)
  - packages/core/src/service/agent/impl/ephemeral-overlay-agent-session.ts (91)
  - packages/core/src/service/agent/logic/agent-run-lifecycle-helpers.ts (76)
  - packages/core/src/service/agent/logic/agent-run-max-steps.ts (8)
  - packages/core/src/service/agent/logic/agent-run-shared.ts (126)
  - packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts (86)
  - packages/core/src/service/agent/logic/resolve-agent-for-project.ts (66)
  - packages/core/src/service/agent/logic/run-agent-turn.ts (1331)
  - packages/core/src/service/session-fs/create-session-fs-service.ts (84)
  - packages/core/src/service/session-fs/session-fs.port.ts (27)
  - packages/core/src/service/session-fs/impl/session-fs.service.ts (35)
  - packages/core/src/service/session-run-state/create-session-run-state-service.ts (23)
  - packages/core/src/service/session-run-state/index.ts (15)
  - packages/core/src/service/session-run-state/session-run-state.port.ts (61)
  - packages/core/src/service/session-run-state/impl/session-run-state.service.ts (54)
  - packages/core/src/service/coordinated-write.ts (159)
  - packages/core/src/service/integrity-repair.ts (203)
---

## 摘要

agent 对话回合的编排层与两个薄门面。`run-agent-turn.ts`（1331 行）负责「解析 agent/model → 校验 → backfill → append 用户消息 + capture checkpoint（CoordinatedWrite 补偿）→ 装配 toolCtx → 交给 runner」，并持有全部 abort/stream 注册与前奏终态事件收口；`agent-runner.ts`（1146 行）是真正的多步主循环（assemble → prepare → 压缩评估 → LLM → 工具并行 → checkpoint → 落库 → doom-loop → usage 回锚）。另有两个 registry 薄封装（abort / stream）、agent 定义注册表服务、两个纯门面（session-fs 回滚代理、session-run-state 委托），以及两个通用编排原语（CoordinatedWrite 补偿写、IntegrityRepairRegistry 修复调度）。

## 职责与边界

- **run-agent-turn.ts** — 一次「发送」的完整生命周期编排。不写库除 append/capture 外；不拼提示词（交给 runner）；不跑 LLM。持有 `AgentTurnRuntimePort`（三端 runtime 注入的宽口）。
- **agent-runner.ts** — 回合内多步循环。与 UI 无关，只经 eventBus 单向发事件。所有提示词拼装/协议映射/压缩执行都调 domain/service 层的既有函数，本文件只做编排。
- **registry 薄封装**（abort / stream）— 纯进程内 `Map`，所有权比对防并发误删。
- **agent-registry.service.ts** — agent 定义的 CRUD + 虚拟 `general` 注入 + 同名/保留名门。
- **session-fs / session-run-state** — 纯门面（回滚代理 / repo 委托），无业务逻辑。
- **coordinated-write / integrity-repair** — 与具体业务无关的通用编排原语，仅被 bootstrap、run-agent-turn、message-transcript-effects 等少量调用点使用。

不在本区：提示词拼装（`service/prompt/`、`domain/chat/logic/prepare-*`）、工具实现（`domain/tool/`）、工作区组装（`service/workplace/`）、压缩执行（`service/compaction-conditions/`）。

## 对外接口

| 符号 | 位置 | 说明 |
|---|---|---|
| `runAgentTurn(runtime, scope, userContent, options?)` | `logic/run-agent-turn.ts:319` | 三端共用的唯一发送入口；壳层建 controller 并注册 abort，实现体在 `:482` |
| `AgentTurnRuntimePort` / `RunAgentTurnOptions` | `logic/run-agent-turn.ts:96` / `:251` | runtime 宽口（26 个成员）与发送选项 |
| `AgentTurnError` | `logic/run-agent-turn.ts:167` | 面向用户的可读错误（空消息、未选模型等） |
| `assembleSkillsToolContext` / `assembleSearchToolContext` / `assembleAgentsToolContext` | `:184` / `:203` / `:225` | 主/子两个装配点共用的三个预算闭包 |
| `createAgentRunner(deps)` / `CreateAgentRunnerDeps` | `create-agent-runner.ts:68` / `:28` | runner 工厂（public 导出） |
| `assembleAgentRunnerDeps(input)` | `logic/assemble-agent-runner-deps.ts:47` | 对话轨/事件轨差异单点装配 |
| `DefaultAgentRunner` / `wrapStreamForBus` / `extractSubagentSessionIdFromOutcome` | `impl/agent-runner.ts:216` / `:1021` / `:191` | 主循环 + 流事件批处理 + task 回流提取 |
| `ChatAgentSession` / `EphemeralOverlayAgentSession` | `impl/*.ts` | `AgentSession` 的两个实现（持久 / 内存 overlay） |
| `createAgentAbortRegistry` / `createAgentStreamRegistry` | `create-agent-*.ts` | 进程内 registry 工厂 |
| `AgentRegistryService` + `createAgentRegistryService` | `agent-registry.port.ts` / `create-agent-registry-service.ts` | agent 定义注册表 |
| `DEFAULT_SUBAGENT_DEFINITION` | `default-subagent-definition.ts:19` | 虚拟 `general`（`prompts.workplace = "i have seen workplace"`，与 RULE 一致） |
| `resolveAgentForProject` / `resolveApplicationModelIdForRun` / `AgentRunResolveError` | `logic/resolve-agent-for-project.ts:45` / `agent-run-shared.ts:101` / `:32` | 解析链 |
| `PENDING_RUN_ID` / `shouldAcceptRunEvent` / `shouldApplyTranscriptReload` | `logic/agent-run-lifecycle-helpers.ts:21` / `:24` / `:61` | desktop `useAgentRunLifecycle` 消费的纯函数 |
| `DEFAULT_AGENT_MAX_STEPS = 20` | `logic/agent-run-max-steps.ts:8` | |
| `SessionFsService` / `createSessionFsService` / `deleteSessionFsData` | `session-fs/*` | 回滚门面 + 会话删除的 checkpoint/revision 打扫 |
| `SessionRunStateService` / `createSessionRunStateService` | `session-run-state/*` | `session_run_state` 单行 UPSERT 门面 |
| `CoordinatedWrite` / `runCoordinatedWrite` / `CoordinatedWriteRollbackError` | `coordinated-write.ts:92` / `:155` / `:42` | 补偿式跨资源写 |
| `IntegrityRepairRegistry` / `runIntegrityRepair` | `integrity-repair.ts:92` / `:171` | detect → repair 调度 |

全部经 `packages/core/src/public/agent.ts` 导出。

## 数据访问

| 资源 | 触点 | 证据 |
|---|---|---|
| `chat_message`（全量可见读，**每 step**） | `ChatAgentSession.list()` → `listBySession(sessionId, {includeHidden:false})` | `impl/chat-agent-session.ts:35` |
| `chat_message`（全量含 hidden，**每 step，仅 gemini**） | `deps.listAllSessionMessages()` → `messages.listBySession(toolCtx.sessionId)` | `impl/agent-runner.ts:587-588`；装配 `assemble-agent-runner-deps.ts:67` |
| `chat_message`（resume 末条单行读） | `listBySessionTail(sessionId, {limit:1})` | `logic/run-agent-turn.ts:637` |
| `chat_message`（append user / append tool_results / append assistant） | `session.append(...)` | `impl/agent-runner.ts:690`、`:894`、`:932`；`logic/run-agent-turn.ts:724` |
| `chat_message`（补偿删除） | `runtime.messages.delete(appendedId)` | `logic/run-agent-turn.ts:742` |
| `session_run_state` | `DefaultSessionRunStateService` 全部委托 repo | `session-run-state/impl/session-run-state.service.ts:23-53` |
| `message_checkpoint` / `message_checkpoint_file` | `backfillMissingBaselines` / `capture` / `release?` | `logic/run-agent-turn.ts:612`、`:755`、`:765` |
| `vfs_entry` / `vfs_revision` / `vfs_content_blob` | `deleteSessionFsData`（会话删除时递减 live ref + revision 前缀打扫） | `session-fs/create-session-fs-service.ts:71-80` |
| KKV 域 `prompt_tokens` | `writeSessionApiPromptTokenEntry` / `invalidateSessionApiPromptTokenEntry` | `impl/agent-runner.ts:374`、`:948`、`:987`、`:995` |
| KKV 域 `rule_snapshot` / `file_cache` | 经 `assembleWorkplaceDisplay` 间接 | `impl/agent-runner.ts:422-435`（`kkvSessionId: session.kkvScopeSessionId`） |
| KKV 域 `skills`（effective 清单） | `assembleSkillsToolContext` → `service.effectiveSkills(projectId)` | `logic/run-agent-turn.ts:192` |
| `agent`（定义表） | `repository.listIds/list/get/getRawWire/upsert/delete/exists` | `impl/agent-registry.service.ts:64-163` |
| `saved_model` / `provider` | `savedModels.findById`（run 入口一次 + 每 step 协议推断） | `impl/agent-runner.ts:301`、`:561-565` |

## 依赖关系

**import 谁**（按面）：
- domain 层：`domain/agent/{logic,model,repositories}`、`domain/chat/{logic,model,content}`、`domain/tool/{builtin,logic}`、`domain/vfs/logic`、`domain/events/model`、`domain/prompt/*`
- infra 层：`infra/llm-protocol/{logic,ports}`、`infra/events/simple-event-bus`、`infra/tokenizer/logic`
- service 层：`service/chat/{message,message-transcript-effects,session,project,user-vfs-turn}.port`、`service/compaction-conditions`、`service/workplace`、`service/message-checkpoint`、`service/persistent-preferences`、`service/vfs`
- 自身：`service/coordinated-write.js`

**被谁消费**：
- `runAgentTurn` → `apps/mobile/src/services/agent-run.service.ts:65`、`apps/desktop/src/main/services/agent-run.service.ts`、`apps/cli/src/runtime.ts`
- `createAgentRunner` / `assembleAgentRunnerDeps` / `resolveAgentForProject` / `AgentRunRuntimePort` → 同上三端 runtime 装配 + `apps/mobile/test-utils/core-shim.ts`
- `agent-run-lifecycle-helpers` → `apps/desktop/renderer/hooks/useAgentRunLifecycle`
- `IntegrityRepairRegistry` → `bootstrap/novel-master-bootstrap.ts:391`（**唯一**生产调用点）
- `CoordinatedWrite` → `run-agent-turn.ts:718`、`service/chat/impl/message-transcript-effects.service.ts:117`
- `SessionFsService` / `deleteSessionFsData` → `service/chat/impl/{session,project}.service.ts`、`service/template/*`
- `SessionRunStateService` → `apps/mobile/src/services/session-stream-unit-manager.service.ts`

**跨层纪律**：本区没有循环依赖迹象；`public/agent.ts` 是唯一对外 barrel；`apps/desktop/shared/logic/agent.ts:3` 显式禁止 `export *` 与工厂再导出（跨端边界纪律）。

---

## 发现清单

### F-core-service-agent-1 | P2 | packages/core/src/bootstrap/novel-master-bootstrap.ts:389

引文：
```ts
// 兜底修复分支，随 vfs-entry-id-redesign-v1 退役（最低支持 v1.4.27）一并移除。
const reports = await new IntegrityRepairRegistry()
  .register(createVfsEntrySequenceRepairOperation(conn))
  .runAll();
```

描述：`integrity-repair.ts` 的文件头宣称 S-8 把三类兜底（vfs `repairRefCounts` / chat-message `backfillBaselineCheckpoints` / provider 身份重写）收拢成一个统一接口（`integrity-repair.ts:6-11`），但**生产代码里只注册了 1 个 operation，而且那唯一一个自己挂着「随迁移退役一并移除」的注释**。实测全仓 grep：`createRevisionRefCountRepairOperation`（`domain/vfs/logic/revision-ref-count.ts:152`）、`createBaselineCheckpointBackfillOperation`（`domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts:220`）、`createProviderIdentityRepairOperation` / `createProviderSecretRenameOperation`（`domain/provider/logic/provider-identity-repair.ts:42`/`:105`）除定义文件与各自单测外**零生产引用**；`IntegrityRepairRegistry.detectAll`（`:123`）与 `runOnly`（`:149`）同样只有单测调用。也就是说 S-8 的「合一」目标实际未达成，且等 `vfs-entry-id-redesign-v1` 退役后整个 `integrity-repair.ts` 将变成零生产消费者的死模块。

建议：要么在 reduce 阶段把这一串登记为「已知未接线」（S-8 抽象只落地了 1/5），要么在迁移退役清单里把 `integrity-repair.ts` 本身与 4 个未接线 operation 工厂一并列入删除范围；不要让文件头的「三类兜底合一」叙述继续暗示已生效。

置信：confirmed

---

### F-core-service-agent-2 | P2 | packages/core/src/service/agent/logic/run-agent-turn.ts:1119

引文：
```ts
  let streamHandle: string | undefined;
  try {
    runtime.abortRegistry?.register(childSessionId, childController);
```

描述：`runChildAgent` 只有 `try/finally`、**没有 catch**，与主 run 的收口 try（`:585` try + `:993` catch 里 `publishPreludeRunFailed`）不对称。r3-run-1 立的不变式是「抛错 ⇒ 恰好一条 FAILED」，但该不变式只落在主 run 上。子 run 的前奏段有多个真实 IO 抛错点：`agentRegistry.list()`（`:1144`）、`assembleSkillsToolContext` 的 `effectiveSkills`（`:1154`）、`session.append(prompt)`（`:1194`）、`getSubagentStreamEnabled`（`:1298`，非 `PreferencesError` 时重抛）、`runner.run` 自身前奏。其中 `session.append(prompt)` 之后的抛错（偏好读、runner 前奏）会留下一条已落库的 user 消息（task prompt）却没有任何终态事件——子会话页从未收到 STARTED，所以不会卡在「运行中」，但那条 prompt 也没有任何失败标注。

建议：给 `runChildAgent` 补一个 catch，对齐主 run 的 `publishPreludeRunFailed`（payload 归属 `childScope`）；或者在文件里显式留注释说明「子 run 前奏抛错刻意不发终态（无 STARTED 即无在途态可收口）」，把这条不对称钉成 intentional。

置信：confirmed（代码不对称）/ suspected（用户可见影响有限）

---

### F-core-service-agent-3 | P2 | packages/core/src/domain/tool/builtin/builtin-tool-context.ts:174

引文：
```ts
  /** 列出会话消息（含 hidden，供 chat_grep）。 */
  readonly listSessionMessages: () => Promise<readonly ChatMessage[]>;
```

描述：**这就是 W1 记录的「run-agent-turn.ts:852 / :1201 两处全量 `listBySession` 残留」的准确语境——它们不是热路径，而是永不执行的死接线。** 全仓 grep（排除 node_modules/dist）显示 `listSessionMessages` 只出现在：类型声明（本行）、三个装配点（`run-agent-turn.ts:851`、`:1200`、`create-user-vfs-turn-service.ts:67`）、以及单测的 mock ctx。注释里点名的消费者 `chat_grep` 工具**在仓库中不存在**（`register-builtin-tools.ts:31-41` 注册的是 vfs 6 件 + task/skill/agent/curl/search；`domain/tool/logic/format-tool-output.ts:69` 的注释 "excludes chat_grep" 是另一处历史残留）。由于这些值是**惰性闭包**，`listBySession` 只在被调用时才执行，所以今天没有性能代价。

真正的风险在契约形状：字段是**必填非可选**，于是每个 toolCtx 装配点都必须提供一条「全会话含 hidden 全量解压」的读口。任何人未来补一个消费它的工具，会静默引入大会话秒级读（正是 2026-09-30 首字延迟排查刚清掉的那类问题）。另外 `subagent-tool.ts:219` 有一条**真实执行**的同类全量读（`messages.listBySession(childSessionId)` 取末条 assistant text），它在 domain/tool 区、不属本区，但同属这一族，建议 W3 一起收。

建议：把 `listSessionMessages` 从 `BuiltinToolContext` 删掉（三个装配点同步删），或在改成 `?:` 可选并标注「暂无消费者，chat_grep 已下线」；同时把 `subagent-tool.ts:219` 换成 `listBySessionTail` + 反向扫。

置信：confirmed

---

### F-core-service-agent-4 | P3 | packages/core/src/service/agent/logic/run-agent-turn.ts:655

引文：
```ts
    failureSavedModelId = savedModelId;

  await options?.onAfterResolveModel?.({
```

描述：收口 try 从 `:585` 开始，`:585-653` 的语句缩进 4 空格（try 体层级），但 `:655` 到 `:947` 整块（约 290 行）缩进只有 2 空格，`:949` 之后才回到 4 空格。语义上仍在 try 内（花括号闭合正确，`:993` 的 catch 配对无误，功能不受影响），但视觉上 try/catch 边界被抹掉，读者会误判这段不在 try 里——这正是 r3-run-1「为什么是一个 try 而不是两段」那段长注释想强调的结构。这类缩进断层通常是补丁/脚本改写留下的痕迹，也是后续 CR 最容易读错行的地方。

建议：把 `:655-947` 整块重新缩进到 4 空格（纯格式化，无行为变更），或至少在块首加一行 `// ↓ 以下仍在前奏收口 try 内（缩进未跟平，见 cr 报告）` 的显式标记。

置信：confirmed

---

### F-core-service-agent-5 | P3 | packages/core/src/service/agent/logic/run-agent-turn.ts:618

引文：
```ts
    stage = "resolve-agent";
    const definition = (await mapResolveError(() =>
      resolveAgentForProject(runtime, scope.projectId, scope.sessionId)
    )).definition;
```

描述：`stage` 紧接着在 `:646` 被同一字面量 `"resolve-agent"` 重新赋值（第二次对应 `resolveApplicationModelIdForRun`）。第一次赋值是死写。`stage` 只在 `runnerEntered` 为真时被 `onRunFailed` 读（`:1011`），而那时第二次赋值早已覆盖，所以第一次的值从来不会被观察到。

建议：把第一次改成 `"resolve-agent-definition"` 或直接删掉，让 `stage` 序列与实际阶段一一对应，便于 `onRunFailed` 的日志定位。

置信：confirmed

---

### F-core-service-agent-6 | P3 | packages/core/src/service/agent/logic/run-agent-turn.ts:123

引文：
```ts
  readonly projects: ProjectService;
```

描述：`AgentTurnRuntimePort.projects` 是必填成员，但本模块从不读它——`resolveAgentForProject` 拿到后立刻 `void runtime.projects;`（`resolve-agent-for-project.ts:51`），项目智能体下线后 `projectId` 参数同样被 `void projectId;` 丢弃（`:50`）。结果是三端 runtime 必须各自装配一个从未被读取的 `ProjectService`，且 port 声明让人误以为 agent 解析依赖 project。

建议：把 `projects` 改可选并注明「项目智能体下线后仅存于签名，无读取方」，或直接从 port 移除（同时清 `ResolveAgentForProjectRuntimePort`）；两个 `void` 语句保留与否在注释里说明是为签名兼容。

置信：confirmed

---

### F-core-service-agent-7 | P3 | packages/core/src/service/agent/impl/ephemeral-overlay-agent-session.ts:4

引文：
```ts
 * Used by {@link runRunAgentAction} so event-triggered agents do not persist turns.
```

描述：`runRunAgentAction` 在全仓不存在（唯一出现处就是这行注释）。`EphemeralOverlayAgentSession` 唯一的激活条件是 `AgentRunOptions.persistMessages === false`（`agent-runner.ts:225-230`），而实测**没有任何生产调用方传 `persistMessages: false`**：`runner.run` 的两个生产调用点（`run-agent-turn.ts:976` 不传、`:1306` 显式 `persistMessages: true`）都不走 overlay 分支。于是这个 91 行的类，以及 runner 里围绕它的 5 处分支（`:364-366`、`:504`、`:738-743`、`:923-930`、`:979-983`）在生产中全是死路径，只被单测覆盖。

建议：确认「事件轨 agent」是否已整体下线；若是，把 `EphemeralOverlayAgentSession`、`AgentRunOptions.persistMessages` 与 runner 内对应分支一并列入删除清单，并修掉这处指向不存在符号的 `{@link}`。

置信：confirmed

---

### F-core-service-agent-8 | P3 | packages/core/src/service/agent/impl/agent-runner.ts:394

引文：
```ts
      const wt = this.deps.workplace(wtScope);
      const turnFiletree = await resolveTurnFiletreeSnapshot(
        options.definition.prompts,
        wt
      );
      for (let step = 0; step < maxSteps; step++) {
        if (signal?.aborted) {
```

描述：回合快照的 `$filetree` 预取在 step 循环之外、且在循环内第一个 abort 检查（`:399`）**之前**执行。若 signal 在进入 runner 时已 aborted（或恰在这段窗口内被 abort），仍会付一次完整 `workplace.renderFileTree()`（`resolveTurnFiletreeSnapshot:1137-1145`）才在 `loop_start` 退出。窗口很窄（`run-agent-turn.ts:941` 的检查点②已先拦掉大部分），但成本不对称。

建议：把 `turnFiletree` 的预取挪到 `loop_start` 的 abort 检查之后（首个 step 内、循环外仍可保持「回合内复用」语义），或在预取前加一次 `signal?.aborted` 早退。

置信：confirmed

---

### F-core-service-agent-9 | P3 | packages/core/src/service/agent/impl/agent-runner.ts:844

引文：
```ts
        const vfsMutated = anyToolUseMutatesWorkspace(toolUses);
        vfsMutatedInRun = vfsMutatedInRun || vfsMutated;
```

描述：`vfsMutated` 完全由**工具名单**推导，与工具实际执行结果无关。`outcomes` 在 `:837-842` 才被填实，但 `vfsMutated` 在其之前就已算出。因此一次「write 全部参数非法 / 路径被拒 / 磁盘满」的 step 仍会以 `vfsMutated: true` 发 `STEP_COMMITTED` 与 `FINISHED`，desktop 的 `ShellNavProvider`（RULE 记载的旁路订阅）会白刷整棵工作区树，mobile 也会走一次无效的写通快照。

建议：改为 `outcomes.some(o => o.ok && anyToolUseMutatesWorkspace([对应 tu]))`，即只统计真正成功的 mutating 调用。

置信：confirmed

---

### F-core-service-agent-10 | P3 | packages/core/src/service/agent/logic/run-agent-turn.ts:625

引文：
```ts
    const hasInput =
      trimmed !== "" || composerAttachOnly.length > 0 || hasAnnotateDrafts;

    if (!hasInput && !allowResumeWithoutInput) {
      throw new AgentTurnError("消息不能为空");
    }
```

描述：空输入校验排在 `backfillMissingBaselines`（`:612`，RULE/注释均记载大会话上是秒级第一站）**之后**。用户在输入框敲了空白（或 App 误传空 payload）点发送，仍要付整轮全量 backfill 扫描才拿到「消息不能为空」。前置 abort 检查点⓪（`:600`）只拦已 abort 的情况，不拦空输入。

建议：把 `hasInput` 判定提到 `backfillMissingBaselines` 之前（resume 分支仍需 backfill，可保留在原位），让空发在零 IO 处就被拒。

置信：confirmed

---

### F-core-service-agent-11 | P3 | packages/core/src/service/agent/impl/agent-registry.service.ts:124

引文：
```ts
  private async assertUniqueDisplayName(
    agentId: string,
    name: string
  ): Promise<void> {
    const ids = await this.deps.repository.listIds();
    for (const otherId of ids) {
```

描述：每次 `upsert` 都做一次 listIds + **逐条串行 await `repository.get(otherId)`**（`:131`，含 try/catch 兜底）。agent 数量增长后这是 O(N) 次串行 IO；`agent` 工具可在对话中直接 create/update，频率不低。`list()`（`:68-76`）已经是一次全量拉取，upsert 完全可以复用同一形状批量取名后本地比对。

建议：改走 `repository.list()`（或新增一个只投影 name 的批量读）后内存比对，去掉 N+1。

置信：confirmed

---

### F-core-service-agent-12 | P3 | packages/core/src/service/session-fs/create-session-fs-service.ts:1

引文：
```ts
<文件首字节为 U+FEFF BOM，其后才是 /**  ... 文档注释 */
```

描述：实测该文件以 UTF-8 BOM（`EF BB BF`）开头。全 `packages/core/src` 只有 4 个文件带 BOM：本文件、`domain/vfs/logic/extract-mutating-paths.ts`、`infra/llm-protocol/logic/sse-parse-errors.ts`、`infra/llm-protocol/logic/tool-arguments-parse.ts`。tsc/tsx 能容忍，但 BOM 会让「文件第一行是 `/**`」的 grep/正则假设失效，也和 RULE 里那条编码纪律（改中文文件必须字节级安全）相邻——一旦有人用文本级工具重写这个文件，很容易踩到 BOM+中文的组合。

建议：剥掉 BOM（4 个文件一起），或至少在本文件顶部注释里记录「首字节含 BOM」。

置信：confirmed

---

### F-core-service-agent-13 | P3 | packages/core/src/service/agent/logic/run-agent-turn.ts:749

引文：
```ts
  coordinatedWrite.register({
    name: "capture-baseline-checkpoint",
    execute: async () => {
      const anchorId = checkpointAnchorMessageId;
      if (anchorId == null) return;
```

描述：`CoordinatedWrite.run()` 只对**成功执行完毕**的步骤调 rollback（`coordinated-write.ts:124-127` 先 `await execute()` 再 `executed.push(step)`）。因此 `capture` 步骤在写入过程中抛错时，它的 `rollback`（`:761-767` 的 `messageCheckpoint.release`）不会执行——尽管 `rollback` 已经写好、注释也声称「capture 的补偿是 release 刚写的 checkpoint」。同理 `append` 步骤在 `messages.append` 成功之后、`onUserMessageAppended()`（`:737`）抛错时，该步未进 `executed`，`:739-744` 的补偿删除也不会跑，会留下一条没有 checkpoint 的 user 消息（S-13 的 baseline 不变式被打破，要等下一轮 backfill 才补）。

建议：把「部分成功也需补偿」的诉求显式化——例如在 `execute` 内部自建 try/catch 做局部补偿，或把 `CoordinatedWrite` 的语义补一句「execute 抛错视为未完成，不补偿」并在调用点对齐（当前注释与行为相反，属文档-行为漂移）。

置信：confirmed

---

## 争议与存疑

1. **`listAllSessionMessages` 的 gemini 全量读（`agent-runner.ts:587`）是否算问题**：代码注释（`:582-586`）明确说明「Gemini 的 function-call 名字回查要含 hidden 的全量历史，openai/anthropic 适配器不消费它，别为它们每 step 白读一遍全会话正文」。按 PLAN 第 3 条（决策感知）标 **intentional**，不计入发现清单。但值得在 L3 记一笔：这是每 step 一次全会话解压（`listBySession` 默认含 hidden），大会话 × gemini 协议下仍是首字延迟的显著贡献项，spec 只做了协议分流没做缓存。

2. **`runnerEmittedTerminal` 观测窗的降级路径是否会双发 FAILED**：主 run 在 `runner.run` 前后装了 FINISHED/FAILED 订阅（`:962-971`），按 sessionId 过滤。文件注释（`:957-961`）承认「订阅装不上时退化成可能多补一条 FAILED('')」。我核对了 `SimpleEventBus.subscribe` 不会抛错，且 `runnerEmittedTerminal` 只在订阅窗口内为真——**在真实 bus 上不会双发**。标 intentional（为老 mock/CLI 占位 eventBus 留的兜底）。

3. **`EphemeralOverlayAgentSession` 是否真的死了**（F-7）：我只能证明「没有传 `persistMessages:false` 的生产调用方」。如果存在仓外的消费者通过 `public/agent.ts` 导出的 `createAgentRunner` 走事件轨，它就还活着。本仓三端（mobile/desktop/cli）都不走，故按 dead 报 P3；若 reduce 阶段有人能证明有外部消费者，此条应降级为「仅注释符号过期」。

4. **`projects` 必填未读**（F-6）是否属于「跨层签名兼容的故意冗余」：项目智能体下线是 RULE 明载的拍板（`resolve-agent-for-project.ts:4-6`），两个 `void` 语句是刻意的签名兼容残留。按纪律可以标 intentional，但它同时让 `AgentTurnRuntimePort` 多了一个必填依赖，仍按 P3 记（不记为问题、记为清理项）。

5. **主 run 前奏检查点的编号混乱**：文件里同时存在「检查点②（runner 起步前最后一道，`:941`）」与注释里「检查点分布：⓪/①/②（`:563-566`）」两套编号——`:566` 把 ② 描述成「agentRegistry.list() 之后 / skills 装配之后 / runner.run 之前」，而 `:796` 与 `:823` 又把这两处分别称作 ③ 与 ④。五个检查点实际存在（⓪ `:600`、① `:774`、③ `:800`、④ `:828`、② `:941`），编号 ② 被复用于两个含义。这不影响正确性（每个检查点的代码与注释语义自洽），但会让后续 CR 引用行号时对错号。**未单列为发现**，留给 L3 决策是否值得清一次编号。

6. **`coordinated-write` / `runCoordinatedWrite` 便捷函数**（`coordinated-write.ts:155`）实测零生产调用（只有 `test/service/coordinated-write.test.ts`）。因体量小、语义无害，未单列 finding，与 F-1 的「未接线抽象」同类，一并交 reduce 处置。

---

## 与本区相关的既有拍板（RULE 核对结果）

- **「controller 入口即注册」** — `run-agent-turn.ts:342` 在函数入口即 `abortRegistry.register`，`runChildAgent` 的 register 紧跟 `childController` 落地（`:1120`）且全程在 try 包络内。与 `docs/Iterations/context-usage-overhaul/cr-fix-spec-r3.md` 的 r3-run-3 方案一致，**标 intentional，不报**。
- **「回合快照」** — `turnNow`（`agent-runner.ts:290`）与 `turnFiletree`（`:394`）都在 step 循环外取一次，回合内复用；`$filetree` 走 `includes("$filetree")` 预检（`:1141`）。与 RULE 智能体层条目完全一致，**标 intentional，不报**。
- **「listVisibleSessionMessages」** — RULE 智能体层并未收录该条目（`docs/apm/RULE.md` 全文无此符号），全仓 grep 亦无该标识符。最接近的现行口径是 `ChatAgentSession.list()` 的 `includeHidden:false` SQL 层过滤（`chat-agent-session.ts:30-37`，2026-09-30 首字延迟排查落地）。**按现行实现口径核对，视为 intentional。**
- **常驻工作区「workplace 工厂每次 new」** — `agent-runner.ts:393` 已把 `wt` 提升到循环外（`:391-392` 有注释留痕），符合 RULE 的告警。
- **VFS write/edit 并发语义** — 本区不实现并发控制（`pathTail` 在 `domain/tool/logic/tool-runner.ts`），RULE 记载的两处拍板盲区与本区无关。
