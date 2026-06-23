---
date: 2026-06-21
dependency: []
---

# 事件可靠性（events-reliability）PRD

## 背景

`packages/core` 两轮代码审查（events 域 + 横切 infra）指出：事件子系统 **DAG 编排逻辑可靠**，但 **错误在 bus 路径上被静默丢弃**，生产环境难以发现配置的 hide-message / run-agent action 失败。

| 缺口 | 位置 | 现象 |
|------|------|------|
| Bus 订阅者吞掉异步 rejection | `event-orchestrator.service.ts` `attachToBus()` | `(p) => void handler(...)` 使 `emit()` 的 `EventRunResult` 无人消费；失败变为未处理 Promise rejection |
| Handler 异常中断同类型后续订阅者 | `simple-event-bus.ts` `publish()` | 某一 handler 同步抛错时，同 event 后续 handler 收不到 payload |
| 生命周期与 message-received 语义分裂 | `agent-runner.ts` | `publishRunLifecycle` 门控 `agent.run.*` 与流式 delta，但 `EVENT_SESSION_MESSAGE_RECEIVED` 仅受 `persistMessages` 门控；runner 成功返回 ≠ 下游 action 成功 |

**典型失败路径：** `AgentRunner.run()` 在持久化助手消息后 `bus.publish(EVENT_SESSION_MESSAGE_RECEIVED, …)`（`agent-runner.ts:377-378`）。若 events 配置在该 event 上挂载 hide-message / run-agent，orchestrator 经 bus 异步执行；action 失败时 runner 仍返回 `{ finished: true }`，UI/CLI 无结构化反馈。

**对比（已正确）：** Desktop 手动压缩经 **awaited** `eventOrchestrator.emit(...)`（`compaction.ts:23-30`），IPC 可返回 `{ ok: result.ok }`。

**参考材料：** [explore-events.md](./explore-events.md)、[explore-cross-cutting.md](./explore-cross-cutting.md)、[迭代 readme](../../readme.md)

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| Bus 路径 action 失败可观测 | orchestrator bus 订阅路径在 action 失败时 **不产生未处理 rejection**；至少 structured log（含 eventType、sessionId、failures） |
| SimpleEventBus 订阅者隔离 | 某一 handler 抛错 **不阻断** 同 event 其余 handler；错误被捕获并记录 |
| 生命周期与 message-received 契约清晰 | 文档 + 测试明确：`publishRunLifecycle` 与 `session.message.received` 的发布条件；消费者不将 `agent.run.finished` 等同于「events action 链成功」 |
| 回归防护 | 新增/扩展测试覆盖 bus → orchestrator 失败路径与 bus handler 隔离；`npm run test:fast` 全绿 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Desktop / Mobile 运行时维护者 | Agent 跑完后依赖 `session.message.received` 触发 hide-message；action 失败时需在日志或可选回调中可见，而非 silent success |
| 事件/compaction 配置开发者 | 调试 events YAML 时，bus 触发的 action 失败应有与手动 `emit` 一致的可诊断信息 |
| UI 订阅者（ChatComposer、MessageList 等） | 多个 handler 订阅同一 lifecycle event；某一 handler bug 不应拖垮其余订阅者 |
| 核心库贡献者 | rebootstrap / 测试时 bus 行为可预测，无 listener 泄漏与 ghost rejection |

## 范围

### 包含范围

1. **`SimpleEventBus.publish` handler 隔离**
   - 逐 handler try/catch；同步异常不向上抛出、不中断循环
   - 错误记录策略（见 SPEC）：至少 `console.error` 或注入 `onHandlerError`（可选，默认可观测）

2. **`DefaultEventOrchestrator.attachToBus` 异步错误处理**
   - 替换裸 `void handler(...)`：对 async handler 的 Promise 使用 `.catch()`，记录 `EventRunResult` 失败详情
   - 可选 runtime 级 `onActionFailure` 回调（Desktop/Mobile runtime 可接线 toast/telemetry，非本 feature 必须实现 UI）

3. **`publishRunLifecycle` 与 `EVENT_SESSION_MESSAGE_RECEIVED` 契约**
   - **不改动** 当前发布条件（message.received 仍由 `persistMessages && assistantAppendCount > 0` 触发；nested run-agent 仍 `publishRunLifecycle: false` + `persistMessages: false`）
   - 补充 JSDoc / port 注释与测试，固化「runner 成功 ≠ action 成功」语义
   - 评估并在 SPEC 中记录：是否在 AgentRunner 侧增加可选 `awaitBusActions` 开关（默认 false，保持 fire-and-forget 性能）；本 feature **默认不强制** runner await orchestrator

4. **测试**
   - SimpleEventBus：handler 抛错时后续 handler 仍执行
   - Orchestrator：bus publish → 失败 action → 无 unhandled rejection + 失败被记录/回调
   - AgentRunner：message.received 发布条件与 publishRunLifecycle 独立性（回归）

5. **小范围 API 卫生（仅当实现 touch 到对应文件）**
   - 从 public 或 factory 导出 `detachEventOrchestratorFromBus`（rebootstrap 测试友好）
   - `EventRunResult.partialFailure`：移除误导字段或 JSDoc 标明「当前恒为 false」— 择一，见 SPEC

### 不包含范围

- hide-message handler 测试修复与格式回归（**[ci-test-health](../ci-test-health/)** Phase 0）
- events 配置 schema / DAG 校验合并（**[events-config-validation](../events-config-validation/)**）
- `EventsError` 全面接入 orchestrator/handler（可后续迭代）
- Orchestrator 未使用 deps 移除（`createSession` / `worktree` 等，独立 refactor）
- `EventEmitContext.trigger` 消费逻辑（产品行为扩展）
- Bus 类型化 publish/subscribe（`NovelMasterEventType` 泛型化）
- Desktop/Mobile UI 层 toast 产品化（仅预留 callback 钩子）
- cloud-sync / db-backup 等横切模块其它 P1 项

## 核心需求

1. **SimpleEventBus 隔离：** `publish` 内对每个 handler 独立 try/catch；任一 handler 失败不影响同 event 其他 handler 被调用。
2. **Orchestrator bus 路径不吞错：** `attachToBus` 订阅回调须捕获 async rejection，将 `EventRunResult.failures` 转为可观测输出（log + 可选 `onActionFailure`），禁止 silent unhandled rejection。
3. **与手动 emit 行为一致的可诊断性：** bus 触发的失败日志至少包含 `eventType`、`projectId`、`sessionId`、`failures[].actionType`、`failures[].error`。
4. **生命周期门控文档化：** 明确 `publishRunLifecycle` 仅门控 `agent.run.*` 与 stream 事件；`session.message.received` 独立于 lifecycle，用于触发配置的 compaction actions。
5. **Nested run-agent 不污染 lifecycle：** 保持 `run-agent.handler` 中 `publishRunLifecycle: false`、`persistMessages: false`（已有行为，测试锁定）。
6. **向后兼容：** 不改变 `SimpleEventBus.publish` 同步签名；不改变默认 fire-and-forget bus 语义（除非调用方显式启用 await 类选项）。
7. **测试门禁：** 上述行为有自动化测试；不引入 `test:fast` 回归。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| R1 | SimpleEventBus 上同一 event 注册 handler A（抛错）、B（正常） | `publish` | B 仍被调用；进程无未捕获同步异常 |
| R2 | Orchestrator 已 attachToBus；events 配置使 `session.message.received` 的 hide-message 必然失败 | AgentRunner 完成一轮并 publish message.received | 无 unhandled rejection；失败被 log 或 `onActionFailure` 报告 |
| R3 | Desktop 手动压缩（awaited emit） | action 失败 | 行为与现网一致：`result.ok === false`（不回归） |
| R4 | run-agent action 执行 | nested runner.run | 不 publish `agent.run.*`；不 publish `session.message.received`（persistMessages false） |
| R5 | AgentRunner 正常完成且 persistMessages | run 结束 | 仍 publish `session.message.received`（即使 publishRunLifecycle false 的 hypotheticals 不适用默认路径） |
| R6 | `npm run test:fast` | 全量执行 | 退出码 0，无新增失败 |
| R7 | rebootstrap 测试调用 detach | createEventOrchestrator 两次 | 无 double-subscribe 导致的重复 action（attach guard + detach 可用） |

## 约束与依赖

- **前置迭代顺序：** readme Phase 2；建议 **ci-test-health（Phase 0）已合并**，保证 events 测试基线可信后再加 bus 集成测。
- **dependency：** 无硬依赖；与 `codebase-audit-remediation` 互补（后者侧重 thinking/ChatTab/CI lint），**不重复** SSE/debug-fetch 工作。
- **与 events-config-validation 边界：** 本 feature 不修改 events YAML schema；仅改善运行时失败可观测性与 bus 隔离。
- **文档后续：** 本 PRD 确认后进入 [spec.md](./spec.md)（design-proposal），再实施代码修改。
