# 代码审查：`events` 域

**日期：** 2026-06-21  
**范围：** `packages/core/src/domain/events/**`、`packages/core/src/service/events/**`、`packages/core/test/events/**`、`packages/core/src/public/events.ts`  
**审查者：** 自动化 CR（Cursor agent）

---

## 执行摘要

events 子系统结构良好：domain 类型薄而清晰，orchestrator 实现带并行批次与 fail-fast 语义的真正 DAG 执行器，`hide-message` 正确委托给 `MessageTranscriptEffectsService`（无重复 `markDirty`）。主要问题：**集成测试损坏**、**event bus 路径上静默异步失败**、**死 API 表面**（`partialFailure`、未使用依赖），以及 `hide-message.handler.ts` 的**格式回归**。

| 领域 | 评级 | 说明 |
|------|--------|-------|
| 代码风格 | ⚠️ 混合 | 一文件严重格式损坏；其余与 core 模式一致 |
| 可维护性 | ⚠️ 混合 | DAG 校验重复；未使用依赖；死导出 |
| 正确性 | ⚠️ 混合 | Bus 路径丢弃错误；测试失败；`trigger` 未使用 |
| 测试覆盖 | ❌ 薄弱 | 8 个 event 测试中 2 个失败；无 bus/run-agent  happy-path 测试 |

---

## 架构（简要）

```
AgentRunner / CLI / Mobile / Desktop
        │ emit (awaited)          │ bus.publish (sync)
        ▼                         ▼
   EventOrchestrator.emit ──► runDag ──► hide-message / run-agent handlers
        ▲
        │ attachToBus subscribes to
        │   session.compaction.requested
        │   session.message.received
   SimpleEventBus
```

- **配置：** `EventsConfig`（`events-config` 域）将 event 类型字符串映射为带可选 `dependency` 的 `EventActionNode[]`。
- **生命周期事件**（`agent.run.*`、`agent.stream.*`）仅用于 bus 可观测性；目前仅 compaction/message-received 触发 orchestrator action。
- **Compaction conditions** 单独评估；匹配时 `AgentRunner` 直接调用 `orchestrator.emit`（非 bus）。

---

## 严重（Critical）

### C1 — `hide-message.handler.test.ts` 以错误参数调用 handler（测试失败）

**文件：** `packages/core/test/events/hide-message.handler.test.ts:54-59`、`packages/core/test/events/hide-message.handler.test.ts:88-93`

Handler 签名为 `(projectId, sessionId, slice, deps)`（`hide-message.handler.ts:37-47`），但测试传入：

```ts
runHideMessageAction(chatSession, sessionRow.id, slice, { messages: ctx.messages })
```

问题：
1. `chatSession`（`ChatAgentSession`）作为 `projectId` 传入。
2. `deps` 缺少必需的 `messageTranscriptEffects`。

**已验证：** `npx tsx --test test/events/*.test.ts` → 两个 `runHideMessageAction` 用例在 `hide-message.handler.ts:71` 失败：`Cannot read properties of undefined (reading 'hideMessagesInRange')`。

**修复：** 传入 `project.id`、`sessionRow.id` 及完整 deps（如 `createMessageTranscriptEffectsService` + snapshot store，镜像 `message-transcript-effects.test.ts:19-20`）。

---

### C2 — `hide-message.handler.ts` 格式回归（未提交）

**文件：** `packages/core/src/service/events/impl/actions/hide-message.handler.ts:1-85`

工作树 diff 显示每行语句间有空行（语句间双换行）。非项目风格，无逻辑变更却将文件从约 43 行膨胀到约 85 行。可能为编辑器/换行符意外损坏。

**修复：** 恢复常规单行间距（对齐 `run-agent.handler.ts`）。

---

## 主要（Major）

### M1 — Bus 订阅者吞掉异步错误

**文件：** `packages/core/src/service/events/impl/event-orchestrator.service.ts:57-71`

```ts
const handler = async (eventType: string, payload: unknown) => { ... await this.emit(...) };
this.deps.eventBus.subscribe(EVENT_SESSION_COMPACTION_REQUESTED,
  (p) => void handler(EVENT_SESSION_COMPACTION_REQUESTED, p));
```

对 async handler 使用 `void` 意味着：
- Rejection 成为未处理的 promise rejection（无调用方可 catch）。
- `EventRunResult` 被丢弃 — `session.message.received` 上的失败不可见。

对比：手动 compaction 使用 awaited `emit`（`apps/desktop/src/main/ipc/handlers/compaction.ts:23-30`）并暴露 `result.ok`。

**影响：** `AgentRunner` 在持久化消息后发布 `EVENT_SESSION_MESSAGE_RECEIVED`（`agent-runner.ts:377-378`）。若配置的 action 失败，从 runner 视角运行仍「成功」。

**修复选项：** Log + 报告失败；可选 `onActionFailure` 回调；或在发布方经 awaited `emit` 路由 message-received。

---

### M2 — `partialFailure` 有文档但从未设置

**文件：** `packages/core/src/service/events/event-run-result.ts:15-20`、`packages/core/src/service/events/impl/event-orchestrator.service.ts:88,98,103,153,168`

注释称并行模式可产生部分成功，但每条返回路径都设 `partialFailure: false`。Mobile/desktop UI 仅检查 `result.ok`；该字段为误导性死 API。

**修复：** 实现 partial-failure 语义（继续成功并行节点的依赖方），或移除字段并更新文档。

---

### M3 — DAG 校验重复（schema + runtime）

**文件：**
- `packages/core/src/domain/events-config/model/events-config.schema.ts:150-196`（`validateDag`）
- `packages/core/src/service/events/impl/event-orchestrator.service.ts:171-227`（`prevalidateDag`）

两者均检查重复、未知 dep、环，错误字符串略有不同（`duplicate action type in one event` vs `duplicate action type in event DAG`）。经 schema 加载的配置应始终有效；runtime 检查为 defense-in-depth 但逻辑重复。

**风险：** 未来规则变更只更新一处。

**修复：** 从 domain/events-config 导出共享 `validateEventActionDag(nodes)`，schema 与 orchestrator 共用。

---

### M4 — Orchestrator 未使用的依赖

**文件：** `packages/core/src/service/events/impl/event-orchestrator.service.ts:35-44`

`createSession`、`worktreeSnapshot`、`worktree` 在 `DefaultEventOrchestratorDeps` 上为必需，但 orchestrator 内从未读取。`run-agent` 自建 `ChatAgentSession`（`run-agent.handler.ts:70`）。

**修复：** 从 orchestrator deps 移除；仅保留在 `CreateEventOrchestratorDeps` / `RunAgentHandlerDeps` 等实际使用处。

---

### M5 — `EventEmitContext.trigger` 提取但从未消费

**文件：**
- `packages/core/src/service/events/event-orchestrator.port.ts:15-16`
- `packages/core/src/service/events/impl/event-orchestrator.service.ts:268-276`
- action handler 中无引用

`trigger` 区分手动与条件 compaction（`SessionCompactionRequestedPayload.trigger`），但 `hide-message` 与 `run-agent` 忽略它。若 action 应按 trigger 不同（如不同 depth slice），该行为缺失。

---

### M6 — `EventsError` 已导出但 events 流程未使用

**文件：** `packages/core/src/errors/events-errors.ts:7-24`、`packages/core/src/public/events.ts:43`

Orchestrator 返回带字符串错误的 `EventRunResult`；handler 抛出 plain `Error`。带 code（`ACTION_FAILED` 等）的 `EventsError` 从未抛出或映射。

**修复：** 在 orchestrator/handler 中使用 `EventsError` 以统一 CLI/UI 错误码，或暂不需要则停止导出。

---

### M7 — `createEventOrchestrator` 总是 attach 到 bus

**文件：** `packages/core/src/service/events/create-event-orchestrator.ts:74-76`

工厂无条件调用 `orchestrator.attachToBus()`。需要干净 bus 的测试须调用 `detachEventOrchestratorFromBus`（未从 `public/events.ts:37-41` 导出）。无 detach 时工厂调用两次易 double-subscribe（`event-orchestrator.service.ts:53-55` 的 guard 防止同实例重复 attach，非跨实例）。

**建议：** `attachToBus?: boolean` 默认真，或从 public API 导出 `detachEventOrchestratorFromBus`。

---

## 次要（Minor）

### N1 — Public payload 导出不完整

**文件：** `packages/core/src/public/events.ts:14-24`

已导出：`AgentRunFinishedPayload`、stream payload、compaction payload。  
未导出：`AgentRunStartedPayload`、`AgentRunFailedPayload`、`SessionMessageReceivedPayload`、`NovelMasterEventPayload`、`NovelMasterEventType`（type union 已导出）。

使用 `@novel-master/core/events` 的订阅者无法一致地为所有 bus payload  typing。

---

### N2 — 集成边界处 event bus 未类型化

**文件：** `packages/core/src/infra/events/simple-event-bus.ts:7,18,36`（经 `public/events.ts:1-2` 引用）

`EventHandler<T = unknown>` 与字符串式 `eventType` 键。`event-types.ts` 的 payload 类型未与 bus 连接。`payloadToEmitContext`（`event-orchestrator.service.ts:260-277`）做最小 runtime 检查。

v1 可接受，但按 `NovelMasterEventType` 的类型化 publish/subscribe 可捕获装配错误。

---

### N3 — `runAction` 使用冗余 `as`  cast

**文件：** `packages/core/src/service/events/impl/event-orchestrator.service.ts:230-256`

`switch (action.type)` 已 narrow `EventAction`，但 params 仍 `as DepthSlice` / `as RunAgentActionParams`。配置有效时无害；略削弱类型安全。

---

### N4 — Domain 类型中中文注释

**文件：** `packages/core/src/domain/events/model/event-types.ts:42,75`

`vfsMutated` 字段为中文 JSDoc，core 大多用英文。跨团队可读性宜统一语言。

---

### N5 — config-forms 中重复 event 常量

**文件：** `packages/core/src/config-forms/events/default-events-config.ts:6`

本地 `const EVENT_SESSION_COMPACTION_REQUESTED = "session.compaction.requested"` 而非从 `domain/events/model/event-types.js` 导入（`default-events.ts:8` 已导入）。字符串变更时有漂移风险。

---

### N6 — `detachEventOrchestratorFromBus` 不在 public barrel

**文件：** `packages/core/src/service/events/create-event-orchestrator.ts:79-84`

对 rebootstrap/测试有用，但仅能通过 deep import 访问。若 runtime 需要 teardown，考虑加入 `public/events.ts`。

---

## 建议（非阻塞）

### S1 — 测试覆盖缺口

| 缺失测试 | 重要性 |
|--------------|----------------|
| `attachToBus` / `detachFromBus` 生命周期 | Rebootstrap 时 listener 泄漏 |
| Bus publish → orchestrator（集成） | 验证 M1 行为 |
| Orchestrator DAG 中 `run-agent` happy path | 仅测失败 prevalidation（`event-orchestrator.dag.test.ts`） |
| 并行 DAG 批次执行 | 两个无 dep 的独立 action 应在同批次（`event-orchestrator.service.ts:131-138`） |
| 未知 event 类型的 `emit` | 返回 ok（`event-orchestrator.service.ts:87-88`）— 文档化或测试 |

---

### S2 — `simple-event-bus.test.ts` 位置

**文件：** `packages/core/test/events/simple-event-bus.test.ts`

测试 `infra/events/simple-event-bus.ts`，非 domain/service events。作为 exported API 冒烟测试可接受，但可考虑 `test/infra/` 以清晰。

---

### S3 — `run-agent` 每个 action 创建临时 runner

**文件：** `packages/core/src/service/events/impl/actions/run-agent.handler.ts:42-104`

每个 `run-agent` action 构建完整 `ToolRegistry`、校验 definition、创建 runner。隔离正确；链式时可能重。当前小 action 集无问题。

---

## 逐文件说明

### `domain/events/model/event-types.ts`

| 行 | 说明 |
|-------|------|
| 7-20 | 清晰的 const event 名；良好的 `as const` 模式 |
| 22-31 | `NovelMasterEventType` 覆盖 orchestrator + 生命周期事件 |
| 33-50 | `AgentRunStartedPayload` / `AgentRunFailedPayload` 存在但未在 public API 再导出 |
| 42, 75-76 | 中文注释（N4） |
| 92-101 | `NovelMasterEventPayload` union 未按 event 名 discriminated — 消费者须知晓配对 |

**结论：** 类型定义扎实；若 bus typing 为目标可扩展 public 导出。

---

### `service/events/event-orchestrator.port.ts`

| 行 | 说明 |
|-------|------|
| 12-17 | `EventEmitContext` 范围恰当 |
| 24-30 | Port 文档化 bus vs 直接 emit 分离 — 准确 |

**结论：** 接口文档良好。

---

### `service/events/event-run-result.ts`

| 行 | 说明 |
|-------|------|
| 15-17 | `partialFailure` 文档描述未实现行为（M2） |
| 18-22 | 其余 `EventRunResult` 精简清晰 |

---

### `service/events/create-event-orchestrator.ts`

| 行 | 说明 |
|-------|------|
| 39-64 | `createRunAgentHandlerDeps` 干净桥接持久化状态 |
| 66-77 | 自动 `attachToBus`（M7） |
| 71 | `createSession` 已装配但 orchestrator 未用（M4） |
| 79-84 | `detachEventOrchestratorFromBus` — 考虑 public 导出（N6） |

---

### `service/events/impl/event-orchestrator.service.ts`

| 行 | 说明 |
|-------|------|
| 52-73 | Bus 附着；async void handler（M1） |
| 84-91 | 未知 event → 静默成功（有意 no-op） |
| 93-169 | DAG 执行器：并行 ready-set、fail-fast — 实现良好 |
| 131-138 | 并行批次 `Promise.allSettled` — 正确 |
| 151-154 | 任一失败则停止调度 — 符合「fail-fast」注释 |
| 171-227 | Runtime DAG prevalidation（M3 重复） |
| 230-256 | Action 分发；`as` cast（N3） |
| 260-277 | `payloadToEmitContext` — 安全忽略额外字段；提取 `trigger`（M5） |

**结论：** 核心编排逻辑可靠；bus 错误处理是主要正确性缺口。

---

### `service/events/impl/actions/hide-message.handler.ts`

| 行 | 说明 |
|-------|------|
| 1-85 | 格式损坏（C2） |
| 37-83 | 逻辑正确：list → visible → slice → range → `hideMessagesInRange` |
| 55-69 | 空 ids/range 早返回 — 良好 |

**结论：** 逻辑良好；修复格式与测试。

---

### `service/events/impl/actions/run-agent.handler.ts`

| 行 | 说明 |
|-------|------|
| 47-50 | 校验 `agentId` |
| 52-60 | 模型解析与清晰错误 |
| 62-66 | Tool registry 探测 + `validateAgentDefinition` |
| 90-103 | `persistMessages: false`、`publishRunLifecycle: false`、`stream: false` — 副作用 agent 正确 |
| 70 | 与 orchestrator `createSession` dep 重复 session 创建（M4） |

**结论：** 合理的隔离 agent 运行；范围内无测试。

---

### `public/events.ts`

| 行 | 说明 |
|-------|------|
| 1-2 | 再导出 infra bus（模糊 domain/infra 边界但实用） |
| 3-24 | 部分 payload 类型导出（N1） |
| 25-36 | 再导出 events-config（config 为独立域但在产品中耦合） |
| 37-41 | 工厂导出；无 detach helper（N6） |
| 43 | 流程中未用 `EventsError`（M6） |

---

### `test/events/simple-event-bus.test.ts`

| 行 | 说明 |
|-------|------|
| 5-25 | 基本 subscribe/publish/unsubscribe — 通过 |

---

### `test/events/hide-message.handler.test.ts`

| 行 | 说明 |
|-------|------|
| 1-3 | 中文文件注释 — 与多数测试不一致 |
| 29-67, 69-101 | 错误 handler 调用（C1）；内联重复 domain 逻辑（48-52、82-86 行） |
| 54-59, 88-93 | 缺少 `messageTranscriptEffects` |

**结论：** 需重写以正确调用 handler 并使用 effects service。

---

### `test/events/event-orchestrator.dag.test.ts`

| 行 | 说明 |
|-------|------|
| 7-81 | 良好的 `baseOrchestrator` 测试 harness 与 mock |
| 84-111 | 验证 hide 委托 effects，非 orchestrator `markDirty` — 重要回归测试 |
| 113-189 | DAG prevalidation 失败 — 覆盖良好 |
| — | 无 `run-agent` 成功路径；无并行批次测试（S1） |

---

## 积极亮点

1. **关注点分离：** Event 名/类型在 domain；编排在 service；配置在 `events-config`；bus 在 infra。
2. **DAG 执行：** 带并行批次的真实依赖调度（`event-orchestrator.service.ts:121-165`），非仅顺序。
3. **Fail-fast：** 失败 action 阻塞依赖方 — compression 管道可预测。
4. **Hide-message 路径：** Effects service 拥有 `markDirty`（`event-orchestrator.dag.test.ts:84-111`）。
5. **Defense in depth：** Schema 加载校验后 runtime 仍做 DAG 检查。
6. **Runtime 灵活性：** `runAgent` 可选 — 无完整 agent 栈的 mobile/desktop 仍可运行 hide-message（`event-orchestrator.service.ts:244-246`）。

---

## 建议行动顺序

1. **修复 C1 + C2** — 恢复 handler 格式；修复 hide-message 测试（解除 CI 阻塞）。
2. **处理 M1** — bus 异步错误处理（log、callback 或发布方 awaited emit）。
3. **清理 M2/M4/M6** — 移除或实现死 API/deps/errors。
4. **合并 M3** — 共享 DAG 校验器。
5. **扩展 S1 测试** — bus 集成、run-agent happy path、并行批次。

---

## 测试运行快照

```
npx tsx --test test/events/*.test.ts
# pass 6, fail 2 (both runHideMessageAction)
# event orchestrator (DAG): 4/4 pass
# SimpleEventBus: 2/2 pass
```
