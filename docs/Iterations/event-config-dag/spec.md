# 事件配置 DAG（dependency）技术规格（SPEC）

## 设计目标

1. 将事件动作执行方式从「全局 parallel / sequential」升级为 **DAG（有向无环图）**。
2. `dependency` 语义固定为：**下游仅在其依赖的上游全部成功完成后才执行**。
3. 任一 action 失败：**事件执行失败并终止**（不再执行任何后续 action）。
4. DAG 允许多个顶点：多个无依赖 action 可并发执行。
5. 依赖引用按 **action type**，并保持同一事件内 action type **唯一**（避免歧义，沿用 Mobile 保存期校验）。
6. 本次为**破坏性更新**：移除 `parallel` / `sequential` 配置形态，仅保留 DAG（schemaVersion=2）。

## 现状代码探索结论（关键约束）

### Core：配置形态与解析（现状）

- Core 的事件配置当前由 `eventsConfigSchema` 解析（旧形态）：
  - 每个事件值是 `executionModeSchema`：
    - `{ sequential: [ ...actions ] }`
    - `{ parallel: [ ...actions ] }`
- Action 的 wire 支持：
  - `refresh-macros` 字符串简写
  - `hide-message`：解析 depth slice 并校验
  - `run-agent`：需要 `agentId`（`agent-id` 或 `agentId`）

相关文件：
- `packages/core/src/domain/events-config/model/events-config.schema.ts`
- `packages/core/src/domain/events-config/model/events-config.ts`
- 默认配置：`packages/core/src/domain/events-config/logic/default-events.ts`
- KKV 存储：`packages/core/src/service/events-config/impl/events-config-store.service.ts`（模块 `nm-events` / key `config`）

### Core：执行器（Orchestrator）

- `DefaultEventOrchestrator.emit()` 读取 config 后：
  - `mode === "sequential"`：逐个 `await runAction`
  - `mode === "parallel"`：`Promise.allSettled`
- 当前失败语义：
  - sequential：某步失败则返回 `ok=false`
  - parallel：汇总失败并返回 `partialFailure`
- action 实现位于：
  - `hide-message` / `refresh-macros` / `run-agent`

相关文件：
- `packages/core/src/service/events/impl/event-orchestrator.service.ts`

### Mobile：编辑器形态

- 当前 UI 将每个事件抽象为 “block”，每个 block 仍含 `chain.mode`（并行/顺序）+ `actions[]`
- 保存期校验（Mobile-only）已保证同一事件内 action type 不重复（这与本需求「dependency 按 type 引用」完全一致）

相关文件：
- `apps/mobile/src/screens/stack/EventsConfigScreen.tsx`
- `apps/mobile/src/components/events/EventConfigBlocks.tsx`
- `apps/mobile/src/components/events/validate-event-config-blocks.ts`

### CLI：读写与 emit

- `nm events set --file`：`decode(raw, eventsConfigSchema)` 后写入 store
- `nm events show`：输出 `encode(config, eventsConfigSchema)`
- `nm event emit <eventType>`：直接 `eventOrchestrator.emit(eventType, ctx)`

相关文件：
- `apps/cli/src/events/commands.ts`
- `apps/cli/src/event/commands.ts`

## 总体方案

### 1) 破坏性升级：事件值改为 DAG action 列表（仅 schemaVersion=2）

新增 schemaVersion **2** 的 wire 形态（仅描述配置文档形状，不涉及 UI 细节）：

```yaml
schemaVersion: 2
events:
  session.compaction.requested:
    - run-agent:
        agent-id: xxx-agent
    - hide-message:
        dependency: ["run-agent"]
        start-depth: 6
    - refresh-macros
```

其中：
- 事件值为 **数组**（数组顺序仅用于展示/编辑默认排序；执行顺序由 dependency 决定）
- `dependency?: string[]` 可选；缺省表示无依赖顶点
- `dependency` 引用 **action type**（字符串）
- 同一事件内 **action type 唯一**（保持现有约束）

### 2) 破坏性策略与迁移

- `nm-events` 中若存在旧配置（v1：`parallel`/`sequential`），在本次升级后将 **无法 decode**：
  - CLI `nm events show/set` 将报错；
  - Mobile 事件配置页加载将失败（需要产品级提示与“恢复默认”能力）。
- 迁移策略（本期最小可行）：
  - 推荐升级时 **clear KKV**（删除 `nm-events/config`）以回退到新的默认 DAG 配置；
  - 或由用户手动导入 v2 配置文件（CLI `nm events set --file`）。

### 3) 调度执行：基于 DAG 的 ready 集合并发

执行算法（面向实现）：

1. 预校验（保存期校验 + 运行期兜底）：
   - `dependency` 引用必须存在
   - 不允许环（拓扑排序或 DFS 检测）
2. 初始化：
   - `pending`：尚未满足依赖的 action
   - `ready`：依赖为空或依赖全成功的 action
3. 执行循环：
   - 并发执行所有 `ready`（`Promise.allSettled`）
   - 若任一失败：立即标记事件失败并 **终止**（不再调度后续）
   - 否则将其标记 `success`，解锁新的 `ready`，继续
4. 返回 `EventRunResult`：
   - v2 中不再存在 `partialFailure`（失败即终止，`partialFailure=false`）
   - `failures` 记录首个失败 action（或可扩展为同批次失败的集合）

> 说明：由于 “失败即终止”，某些已完成的上游 action 可能已产生副作用（符合现有 parallel 不回滚的基调）；终止仅阻止后续继续执行。

## 最终项目结构

（在现有结构基础上最小增量）

```text
packages/core/src/
  domain/events-config/
    model/
      events-config.ts              # 新增 v2 DAG 类型（ActionNode）
      events-config.schema.ts       # 仅支持 v2 wire，并做保存期校验
  service/events/
    impl/event-orchestrator.service.ts  # 增加 runDag 执行路径
```

> Mobile / CLI 的 UI 与命令行参数不在本 SPEC 强制要求一次完成，但本次升级后 CLI/Mobile 只保证 v2 可用。

## 变更点清单

### Core

- `packages/core/src/domain/events-config/model/events-config.ts`
  - 新增 v2 DAG 结构：
    - `EventActionNode { type, params, dependency?: EventActionType[] }`
  - 事件值改为仅 v2：`Readonly<Record<string, readonly EventActionNode[]>>`
- `packages/core/src/domain/events-config/model/events-config.schema.ts`
  - 新增 v2 schema：
    - event value 为 array
    - 支持 `refresh-macros` 简写
    - `hide-message` / `run-agent` 在 params 内解析 `dependency`
  - 增加校验：
    - action type 唯一（可与 Mobile 一致）
    - dependency 引用存在
    - DAG 无环
- `packages/core/src/domain/events-config/logic/default-events.ts`
  - 将默认配置升级为 `schemaVersion: 2`：
    - `hide-message`（startDepth=6）与 `refresh-macros` 无依赖 → 并发顶点
- `packages/core/src/service/events/impl/event-orchestrator.service.ts`
  - `emit()`：
    - 仅 DAG：走 `runDag(nodes)`
  - `runDag` 失败语义：任一失败即终止

### CLI

- `apps/cli/src/events/commands.ts`
  - 仅接受 v2；旧配置文件将 decode 失败

### Mobile（本次破坏性更新的最小要求）

- `apps/mobile/src/screens/stack/EventsConfigScreen.tsx`
- `apps/mobile/src/components/events/*`

建议策略：
- 事件配置编辑器需升级为 DAG 编辑器（移除全局 mode，增加 dependency 选择），否则无法编辑 v2。
- 若本期不做 DAG 编辑器：则 Mobile 必须至少提供“恢复默认（清空配置）”的兜底入口，避免用户被旧配置卡死。

## 详细实现步骤

1. **Core 类型升级**
   - 在 `events-config.ts` 引入 v2 `EventActionNode`，并移除 v1 `EventExecutionMode`（或不再对外暴露）。
2. **Schema 支持 v2 wire**
   - `eventsConfigSchema` 仅解析 `schemaVersion: 2`：
     - `events[eventType]` 为 `z.array(actionNodeWire)`。
3. **保存期校验（Core）**
   - 在 v2 decode 时校验：
     - type 唯一
     - dependency 存在
     - 无环
4. **Orchestrator DAG 执行**
   - 实现 `runDag` 调度与失败终止
5. **默认配置升级**
   - `DEFAULT_EVENTS_CONFIG.schemaVersion=2`
   - 默认两个顶点：`hide-message` + `refresh-macros`
6. **测试补齐**
   - schema：v2 解析、未知依赖、环检测
   - orchestrator：依赖成功才执行、失败终止不执行下游
7. **apm 索引**
   - 更新后执行 `apm kb index rebuild`

## 测试策略

### 测试用例

1. **Schema-v2: 多顶点并发**
   - Given v2 事件含 `hide-message` 与 `refresh-macros` 且无 dependency
   - Then decode 成功，两个节点 dependency 为空
2. **Schema-v2: dependency 存在校验**
   - Given `hide-message.dependency=["run-agent"]` 但缺少 run-agent
   - Then decode/保存失败并提示
3. **Schema-v2: 环检测**
   - Given A 依赖 B，B 依赖 A
   - Then decode/保存失败并提示循环依赖
4. **Orchestrator: 成功依赖后才执行**
   - Given run-agent 成功，hide-message 依赖 run-agent
   - Then hide-message 在 run-agent 完成前不会执行
5. **Orchestrator: 失败终止**
   - Given run-agent 抛错
   - Then hide-message / refresh-macros 均不执行，emit 返回 ok=false

## 风险与回滚方案

- **风险：破坏性更新导致旧配置无法加载**
  - 已写入 KKV 的 v1 配置会导致 CLI/Mobile decode 失败。
  - 缓解：提供 clear/恢复默认能力；升级说明中明确提示需迁移或清空配置。
- **风险：失败终止导致行为变化**
  - v1 parallel 之前允许部分失败；v2 明确要求失败即终止。
  - 缓解：在文档与 UI 提示中明确失败语义；必要时提供 dry-run 或更详细失败信息（非本期必需）。
- **回滚**
  - 恢复 v1 schema 与 orchestrator 逻辑，并将默认配置回滚到 v1（需要代码回滚）。

---

编码前请你确认本 SPEC：本次为**破坏性升级**，只支持 v2 DAG；Mobile 侧需实现 DAG 编辑器或至少提供“清空/恢复默认”兜底入口，避免旧配置导致页面不可用。

