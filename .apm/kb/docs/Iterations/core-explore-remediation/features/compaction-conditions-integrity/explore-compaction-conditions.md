# 代码审查：`compaction-conditions` 域（`packages/core`）

**日期：** 2026-06-21  
**审查者：** Agent（explore 阶段）  
**范围：** `packages/core/src/domain/compaction-conditions/**`、`packages/core/test/**/compaction*`、`packages/core/src/service/**/compaction*`、`packages/core/src/public/compaction.ts`

---

## 概述

`compaction-conditions` 域实现**全局压缩触发条件**（v3 schema）：在 agent 运行期间条件匹配时，调用方发出 `session.compaction.requested`，而非直接隐藏消息。触发条件采用 **OR 语义**组合：

| 触发器 | 条件 | 数据来源 |
|---------|-----------|-------------|
| `tokenRatio` | `tokenCount > floor(contextWindow × ratio)` | 通过 `countPromptLlmInput` 统计完整 prompt + 模型 `contextWindowTokens` |
| `visibleFloor` | `visibleMessageCount > floor` | `session.list()`（非隐藏消息） |

**清单**

| 层级 | 文件 | 职责 |
|-------|-------|------|
| Model | `model/compaction-conditions.ts`、`model/compaction-conditions.schema.ts` | v3 类型 + Zod wire schema |
| Port | `ports/compaction-condition-trigger.port.ts` | 触发器 + 评估上下文接口 |
| Logic | `logic/token-estimate.ts` | 遗留启发式封装（`estimateTokens`） |
| Triggers | `triggers/token-ratio.trigger.ts`、`triggers/visible-floor.trigger.ts`、`triggers/composite-trigger.ts` | 条件实现 |
| Service | `service/compaction-conditions/*` | KKV 存储 + 评估器工厂 |
| Public | `public/compaction.ts` | `@novel-master/core/compaction` 入口 |
| Tests | `test/compaction-conditions/*.test.ts`（2 个文件） | v3 迁移 + token-ratio 触发器 |

**结论：** 架构清晰，与 event-bus 压缩设计一致。触发器逻辑大体正确，token ratio 测试覆盖较好。缺口集中在**静默存储失败**、**未校验写入**、**测试覆盖薄弱**（visible floor、composite、evaluator、schema）、**死代码导出/类型**，以及**每步 KKV + token 计数开销**。

| 领域 | 评级 | 说明 |
|------|--------|-------|
| 架构与 DDD | 良好 | 清晰的 trigger port + composite；存在少量 infra 泄漏 |
| 代码风格 | 良好 | 与邻近域一致；命名略有漂移 |
| 可维护性 | 一般 | 死类型、未使用的 error 类、trigger 装配 DRY 不足 |
| 正确性 | 良好 / 部分 | token ratio 扎实；store + 配置边界情况较弱 |
| 测试覆盖 | 部分 | 仅 token ratio + 迁移 |

---

## 架构与 DDD

### 分层

```
public/compaction.ts
  → service/compaction-conditions/          (store port, evaluator factory, KKV impl)
    → domain/compaction-conditions/
        model/          (CompactionConditions, schema)
        ports/          (CompactionConditionTrigger)
        triggers/       (TokenRatio, VisibleFloor, Composite)
        logic/          (estimateTokens — legacy)
  → errors/compaction-conditions-errors.ts  (已导出但 store 未使用)

Consumer: service/agent/impl/agent-runner.ts:174–187
  → compactionConditionEvaluator.shouldRequestCompaction(session, evaluation)
  → on true: emit session.compaction.requested (agent-runner.ts:192–199)
```

**优点**

- Trigger port（`compaction-condition-trigger.port.ts:27–32`）清晰分离「是否应压缩？」与持久化、事件编排。
- `CompositeConditionTrigger`（`composite-trigger.ts:13–26`）实现 OR 逻辑，未将 composite 语义泄漏到 evaluator。
- Schema 位于 domain（`compaction-conditions.schema.ts`）；service store 委托 decode/迁移（`compaction-conditions-store.service.ts:44–59`）。
- Evaluator 工厂明确记录 event-bus 契约（`create-compaction-condition-evaluator.ts:20–24`）。

**DDD 关注点**

| 问题 | 位置 | 详情 |
|-------|----------|--------|
| Domain → infra | `token-estimate.ts:8–14` | Domain 从 infra 导入 `HeuristicTokenCounter` |
| Domain → infra | `token-ratio.trigger.ts:8–9` | Trigger 从 infra 导入 `countPromptLlmInput`、`TokenCounterRegistry` |
| 未使用的 model 类型 | `compaction-conditions.ts:8–11` | `CompactionConditionsTrigger` 从未被引用 |
| 未使用的上下文字段 | `compaction-condition-trigger.port.ts:14–17` | `CompactionConditionModelContext` 中的 `workspaceModelId` 未被任何 trigger 或 evaluator 读取 |
| 孤立的 error 类型 | `compaction-conditions-errors.ts:7–22` | 通过 `compaction.ts:12` 导出；store 从未抛出 `CompactionConditionsError` |
| 读取时迁移副作用 | `compaction-conditions-store.service.ts:51–54` | `getConditions()` 可能将迁移后的 v2 文档写回 KKV |

Domain 依赖 infra 做 token 计数与其他 core 模块（如 agent runner）一致，但意味着 trigger 并非纯 domain 策略——它们是**感知 infra 的适配器**。鉴于 token 计数是横切能力，此处可接受。

### Trigger 装配

`triggersFromConditions`（`create-compaction-condition-evaluator.ts:39–68`）从持久化配置构建 trigger，并内联注入 `ProviderModelService` 解析器。装配可读，但将 factory 与 provider-model 查找耦合；无 domain 级「策略对象」封装已装配的 trigger 图。

---

## 代码风格

| 检查项 | 状态 | 参考 |
|-------|--------|-----|
| 模块 JSDoc `@module` 标签 | 通过 | 所有 domain + service 文件 |
| Trigger 类命名 | 混合 | `TokenRatioConditionTrigger` vs `VisibleFloorTrigger`（`token-ratio.trigger.ts:28`、`visible-floor.trigger.ts:14`） |
| 三元 / 嵌套 | 可接受 | `migrateV2ToV3` 嵌套三元（`compaction-conditions-store.service.ts:26–31`）与其他处迁移风格一致 |
| 异步 trigger | 一致 | 所有 `shouldTrigger` 返回 `Promise<boolean>`，即使同步逻辑亦然（`visible-floor.trigger.ts:17–23`） |
| Strict Zod schema | 通过 | `compaction-conditions.schema.ts:18` |
| 注释 | 良好 | 阈值语义有文档（`token-ratio.trigger.ts:27`、`visible-floor.trigger.ts:13`） |

无严重的 lambda 滥用或注释噪音。v2 迁移三元表达式是本模块集中最密集的代码块。

**次要风格说明**

- Schema 校验消息引用 `visible-floor`，但未提及 camelCase `visibleFloor`（`compaction-conditions.schema.ts:29–30`）。
- `CompactionConditionsTrigger` 注释写「OR trigger fields」（`compaction-conditions.ts:7`），但接口未使用——注释有误导性。

---

## 可维护性

### 1. 死代码 / 未使用表面

| 项 | 位置 |
|------|----------|
| `CompactionConditionsTrigger` 接口 | `compaction-conditions.ts:8–11` |
| 评估上下文中的 `workspaceModelId` | `compaction-condition-trigger.port.ts:15` |
| `CompactionConditionsError`（store 从未抛出） | `compaction-conditions-errors.ts:11–22`，导出 `compaction.ts:12` |
| `estimateTokens` 作为 public API | `compaction.ts:19`、`token-estimate.ts:13–15` — trigger 路径已被 registry/`countPromptLlmInput` 取代 |

### 2. DRY / 每个 agent 步的重复工作

| 模式 | 位置 | 影响 |
|---------|----------|--------|
| 每次压缩检查都调用 `getConditions()` | `create-compaction-condition-evaluator.ts:76` | 每个 agent 步都读 KKV |
| `triggersFromConditions()` 重建 trigger 对象 | `create-compaction-condition-evaluator.ts:80` | 每次调用新建 `TokenRatioConditionTrigger` + lambda |
| visible floor 再次 `session.list()` | `visible-floor.trigger.ts:21` | Agent runner 已在 `agent-runner.ts:146` 列出可见消息（经 regex 变换的副本未传给 evaluator） |

### 3. Store 写入路径跳过校验

`setConditions`（`compaction-conditions-store.service.ts:62–64`）直接序列化 domain 对象。仅 CLI `set` 路径运行 `decode(raw, compactionConditionsSchema)`（`apps/cli/src/compaction-conditions/commands.ts:57`）。直接调用 store 的调用方可持久化 `enabled: true` 且无 trigger。

### 4. 读取时静默失败

`getConditions` 的 catch 块（`compaction-conditions-store.service.ts:57–58`）对任何 parse/decode 错误返回 `null`——无日志、无 `CompactionConditionsError`。损坏的 KKV 数据会禁用压缩且不暴露配置错误。

### 5. v2 检测启发式

`isV2Document`（`compaction-conditions-store.service.ts:17–22`）将任何含 `tokenThreshold != null` 的文档视为 v2，与 `schemaVersion` 无关。带 stray `tokenThreshold` 字段的畸形 v3 文档会走迁移而非校验失败。

### 6. 测试布局

`test/compaction-conditions/` 下仅两个测试文件。无 schema、visible floor、composite、evaluator 或 store 错误路径的共置测试。`estimateTokens` 等价性在 `test/infra/tokenizer/heuristic-token-counter.test.ts:29` 中间接测试。

---

## 正确性

### Token ratio trigger — 正确

| 行为 | 位置 | 测试 |
|----------|----------|------|
| 严格 `>`（非 `>=`） | `token-ratio.trigger.ts:53` | `token-ratio-trigger.test.ts:106–127` |
| 未知 context window → 不触发 | `token-ratio.trigger.ts:38–40` | `token-ratio-trigger.test.ts:64–74` |
| `floor(contextWindow × ratio)` | `token-ratio.trigger.ts:42` | `token-ratio-trigger.test.ts:77–104` |
| Tokenizer override 转发 | `token-ratio.trigger.ts:44–51` | `token-ratio-trigger.test.ts:130–162` |
| 统计完整 prompt（layout + ctx），非原始消息 | `token-ratio.trigger.ts:46–52` | 通过 `countPromptLlmInput` 隐含验证 |

### Visible floor trigger — 逻辑正确，集成未测

| 行为 | 位置 |
|----------|----------|
| `visible.length > visibleFloor`（严格） | `visible-floor.trigger.ts:22` |
| 通过 `session.list()` 排除隐藏消息 | `in-memory-agent-session.ts:20–22`（session port 契约） |
| 忽略 regex 内容变换 | 按设计——regex 不删除消息（`apply-regex-rules.ts:103–123`） |

可见计数与 agent runner 在 regex 前的 `session.list()`（`agent-runner.ts:146`）一致。Regex 仅变更内容，不改变成员——无计数不一致。

### OR composite — 正确，未测

`composite-trigger.ts:21–25` 在首个 `true` 时短路。空 composite 从不构建（`create-compaction-condition-evaluator.ts:65–67`）。

### Schema 校验 — 大体正确

| 规则 | 位置 |
|------|----------|
| decode 路径仅 v3 | `compaction-conditions.schema.ts:12` |
| `tokenRatio` 在 (0, 1] | `compaction-conditions.schema.ts:14` |
| `visibleFloor` / `visible-floor` 别名归一化 | `compaction-conditions.schema.ts:16, 40` |
| `enabled` 要求 ≥1 个 trigger | `compaction-conditions.schema.ts:19–32` |

`enabled: false` 且无 trigger 允许（superRefine 提前返回 `compaction-conditions.schema.ts:20–21`）——正确。

### v3 迁移 — 符合 spec，v2 阈值有损

| 行为 | 位置 | 测试 |
|----------|----------|------|
| v2 读一次迁移 + 写回 | `compaction-conditions-store.service.ts:51–54` | `compaction-conditions-v3-migration.test.ts:10–37` |
| 缺失时默认 `tokenRatio: 0.8` | `compaction-conditions-store.service.ts:35–36` | 迁移测试第 28 行 |
| schema decode 拒绝 v2 | `compaction-conditions-v3-migration.test.ts:40–46` |
| `tokenThreshold` 不携带到 v3 | 有意为之（model-context-settings spec） | 迁移测试第 35 行 |

### 正确性缺口

| 问题 | 严重度 | 位置 | 详情 |
|-------|----------|----------|--------|
| 损坏 KKV → 压缩关闭，无错误 | 高 | `compaction-conditions-store.service.ts:57–58` | 用户以为压缩已启用；evaluator 从不运行 trigger |
| `setConditions` 无 schema | 中 | `compaction-conditions-store.service.ts:62–64` | `enabled: true` + 无 trigger 可持久化；evaluator 在 `create-compaction-condition-evaluator.ts:81–82` 返回 `false` |
| `contextWindow == null` → 静默不触发 | 低 / 按设计 | `token-ratio.trigger.ts:38–40` | 模型缺失 `contextWindowTokens` 仅禁用 ratio trigger；visible floor 仍可能触发 |
| `tokenRatio: 1` | 边界 | `compaction-conditions.schema.ts:14` | `effective === contextWindow`；trigger 要求 `tokenCount > contextWindow`——实际上几乎不触发 |
| 仅当 `persistMessages` 时压缩 | 按设计 | `agent-runner.ts:174` | 临时运行跳过压缩检查 |
| 每步最多一次压缩 emit | 正确 | `agent-runner.ts:131, 192` | `stepCompactionEmitted` 守卫 |

---

## 积极模式

1. **Port + composite triggers** — 小且可测单元，显式 OR 组合（`composite-trigger.ts:13–26`、`compaction-condition-trigger.port.ts:27–32`）。
2. **Schema transform 归一化 wire 别名** — `visible-floor` → `visibleFloor` 集中一处（`compaction-conditions.schema.ts:35–41`）。
3. **Strict schema + enabled 守卫** — decode 路径防止「enabled 但 trigger 为空」（`compaction-conditions.schema.ts:19–32`）。
4. **Token ratio 使用与 chat/CLI 相同的计数栈** — `resolveTokenizerOverride` + `countPromptLlmInput`（`token-ratio.trigger.ts:44–52`，evaluator 装配 `create-compaction-condition-evaluator.ts:53–56`）。
5. **迁移端到端测试** — KKV v2→v3 往返（`compaction-conditions-v3-migration.test.ts:10–37`）。
6. **Token ratio 边界情况测试** — 阈值边界、null window、启发式 override（`token-ratio-trigger.test.ts`）。
7. **Evaluator 记录 event-bus 交接** — 与 hide/compact action 清晰分离（`create-compaction-condition-evaluator.ts:20–24`）。
8. **Store `clearConditions` 容忍 NOT_FOUND** — 幂等 clear（`compaction-conditions-store.service.ts:67–75`）。

---

## 建议

### P0 — 在生产边界场景依赖压缩前处理

| # | 问题 | 行动 | 参考 |
|---|-------|--------|-----|
| P0-1 | 损坏/无效 KKV 策略静默禁用压缩 | decode 失败时抛出 `CompactionConditionsError("INVALID_SCHEMA", …)` 或 log + 通过 CLI `show` 暴露；key 存在时 parse 错误勿返回 `null` | `compaction-conditions-store.service.ts:49–58` |
| P0-2 | `setConditions` 绕过 schema | `kkv.set` 前通过 `compactionConditionsSchema`（或共享 `assertValidConditions`）校验 | `compaction-conditions-store.service.ts:62–64` |

### P1 — 显著质量 / 可运维改进

| # | 问题 | 行动 | 参考 |
|---|-------|--------|-----|
| P1-1 | visible floor、composite、evaluator 无测试 | 添加单元测试：floor 边界（`N` vs `N+1`）、composite OR、带 mock store 的 evaluator | `visible-floor.trigger.ts:17–23`、`composite-trigger.ts:17–26`、`create-compaction-condition-evaluator.ts:74–85` |
| P1-2 | Schema 边界未测 | 测试：双别名、enabled+无 trigger 抛错、`tokenRatio` 边界、`visibleFloor: 0` | `compaction-conditions.schema.ts:10–41` |
| P1-3 | `CompactionConditionsError` 未使用 | 在 store 读/写失败时使用；在 CLI `cli-errors.ts` 映射 | `compaction-conditions-errors.ts`、`compaction-conditions-store.service.ts` |
| P1-4 | 每步 KKV 读 + trigger 重建 | 在 evaluator 中缓存 conditions 并可选 refresh hook，或 `setConditions` 前 memoize `triggersFromConditions` | `create-compaction-condition-evaluator.ts:76–80` |
| P1-5 | 死代码 `CompactionConditionsTrigger` 类型 | 删除或作为 trigger 字段的内部 builder 类型使用 | `compaction-conditions.ts:8–11` |
| P1-6 | 未使用的 `workspaceModelId` | 从 `CompactionConditionModelContext` 移除，或用于 workspace 级模型解析 | `compaction-condition-trigger.port.ts:14–17` |

### P2 — 打磨、性能、一致性

| # | 问题 | 行动 | 参考 |
|---|-------|--------|-----|
| P2-1 | Trigger 类命名漂移 | 重命名 `VisibleFloorTrigger` → `VisibleFloorConditionTrigger`（或从 token ratio 去掉 `Condition`） | `visible-floor.trigger.ts:14`、`token-ratio.trigger.ts:28` |
| P2-2 | `estimateTokens` public 遗留表面 | 添加 `@deprecated` JSDoc；在模块头文档化 registry 路径 | `token-estimate.ts:12–15`、`compaction.ts:19` |
| P2-3 | 冗余 `session.list()` | 从 agent runner 经 `CompactionEvaluationContext` 传入可见计数或消息列表 | `visible-floor.trigger.ts:21`、`agent-runner.ts:146` |
| P2-4 | 仅凭 `tokenThreshold` 检测 v2 | 优先 `schemaVersion === 2`；v3 上 stray `tokenThreshold` 视为 schema 违规 | `compaction-conditions-store.service.ts:17–22` |
| P2-5 | 每步昂贵 token 计数 | 仅消息增量变化时考虑按 prompt 快照缓存 token 计数 | `token-ratio.trigger.ts:46–52`、`agent-runner.ts:174` |
| P2-6 | Schema 错误消息不完整 | 与 `visible-floor` 一并提及 `visibleFloor` | `compaction-conditions.schema.ts:29–30` |
| P2-7 | 单子 composite 包装 | 可选：`triggersFromConditions` 直接返回唯一 trigger | `create-compaction-condition-evaluator.ts:65–68` |

---

## 附录：文件参考映射

### Domain

| 文件 | 行数（约） | 用途 |
|------|-----------------|---------|
| `domain/compaction-conditions/model/compaction-conditions.ts` | 1–18 | v3 domain 类型 |
| `domain/compaction-conditions/model/compaction-conditions.schema.ts` | 1–41 | Zod wire schema + transform |
| `domain/compaction-conditions/ports/compaction-condition-trigger.port.ts` | 1–32 | Trigger port + 评估上下文 |
| `domain/compaction-conditions/logic/token-estimate.ts` | 1–15 | 启发式 `estimateTokens` |
| `domain/compaction-conditions/triggers/token-ratio.trigger.ts` | 1–55 | Token ratio trigger |
| `domain/compaction-conditions/triggers/visible-floor.trigger.ts` | 1–24 | Visible floor trigger |
| `domain/compaction-conditions/triggers/composite-trigger.ts` | 1–27 | OR composite |

### Service

| 文件 | 用途 |
|------|---------|
| `service/compaction-conditions/compaction-conditions-store.port.ts` | Store port |
| `service/compaction-conditions/create-compaction-conditions-store.ts` | Store 工厂 |
| `service/compaction-conditions/impl/compaction-conditions-store.service.ts` | KKV 实现 + v2 迁移 |
| `service/compaction-conditions/create-compaction-condition-evaluator.ts` | Evaluator 工厂 |

### Tests

| 文件 | 覆盖 |
|------|----------|
| `test/compaction-conditions/compaction-conditions-v3-migration.test.ts` | v2→v3 KKV 迁移、v2 schema 拒绝 |
| `test/compaction-conditions/token-ratio-trigger.test.ts` | Token ratio 阈值、null window、override |

### Public + consumer

| 文件 | 职责 |
|------|------|
| `public/compaction.ts` | `@novel-master/core/compaction` 导出 |
| `service/agent/impl/agent-runner.ts:174–199` | 压缩检查 + 事件 emit |
| `apps/cli/src/compaction-conditions/commands.ts` | CLI show/set/clear |
