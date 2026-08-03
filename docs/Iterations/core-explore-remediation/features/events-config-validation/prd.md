---
date: 2026-06-21
dependency:
  - Iterations/stored-config-validity/prd.md
  - Iterations/config-forms-merge-into-core/prd.md
---

# 事件配置校验一致性（events-config-validation）PRD

## 背景

`core-explore-remediation` Phase 2 代码审查发现 **events-config** 与 **config-forms** 在保存前校验上与 domain schema **不同源、易漂移**：

1. **hide-message depth 校验缺口（P1）** — `validate-event-config-blocks.ts` 调用 `validateDepthSlice` 时仅传入 `startDepth`，未转发 `endDepth`。Domain / wire schema 均支持「仅 `endDepth`」「仅 `startDepth`」或双边界 slice；经 YAML/CLI 写入 `{ endDepth: 2 }` 的合法配置，在 Desktop/Mobile 事件编辑器保存会被错误拒绝（*depth slice requires at least startDepth or endDepth*）。
2. **DAG 校验三处重复（P1）** — 同一 event 内 action DAG 规则（重复 type、未知 dependency、环检测）分别在 `events-config.schema.ts`、`validate-event-config-blocks.ts`、`event-orchestrator.service.ts` 各写一份；算法等价但文案与边界（如 UI 侧显式「自依赖」）不一致，规则变更需改多处。
3. **次要可维护性债** — `config-forms/events/default-events-config.ts` 与 `domain/events-config/logic/default-events.ts` 重复默认常量且无消费者；`normalizeHideMessageAction` 在 UI round-trip 中**有意**剥离 `endDepth`（产品：UI 仅编辑 `startDepth`），但缺少单测与加载提示。

**前置迭代关系：**

- [存储配置有效性 PRD](../../../stored-config-validity/prd.md) 已落地 `assessEventsConfigWire` / 失效面板；本迭代在 **有效配置进入编辑器后的保存路径** 补齐与 schema 对齐的校验，不改变失效判定语义。
- [config-forms 合并进 core PRD](../../../config-forms-merge-into-core/prd.md) 已将表单逻辑迁入 `packages/core/src/config-forms/`；本迭代在该目录内修复与去重，不新增独立包。

**参考材料：** [explore-events-config.md](./explore-events-config.md)、[explore-config-forms.md](./explore-config-forms.md)、[explore-depth.md](./explore-depth.md)、[迭代 readme](../../readme.md)

## 目标（含成功指标）

| 维度 | 目标 | 成功指标 |
|------|------|----------|
| **depth 校验对齐** | config-forms 保存校验与 domain `validateDepthSlice` / wire schema 一致 | 仅含 `endDepth` 的 hide-message 在 UI 保存路径 **通过** 校验；仍拒绝空 slice、`start > end`、负值 |
| **DAG 单源** | event action DAG 规则在 domain 层单一实现 | schema decode 与 `validateEventConfigBlocks` **共用**同一 domain 函数；删除 config-forms 内重复 `validateDag` |
| **回归防护** | 关键边界有单测 | 新增/扩展用例覆盖 `endDepth`-only、DAG 共享模块；现有 events-config / config-forms 相关测试 **全部通过** |
| **默认配置不漂移** | 移除重复 `DEFAULT_EVENTS_CONFIG` | config-forms 从 domain 再导出或删除副本；仓库内无第二份硬编码 event 默认 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 高级用户 / CLI 维护者 | 手动编辑 wire 或 YAML，为 hide-message 配置 `{ endDepth: N }`（隐藏最新 N+1 条可见消息），在 App 事件配置页打开后 **可保存**（不因校验 bug 被拒） |
| Desktop / Mobile 设置用户 | 编辑事件 DAG（hide-message + run-agent + dependency），保存时 DAG 错误提示与持久化后 runtime 行为一致 |
| 核心库维护者 | 调整 DAG 规则（如新增校验）时 **只改 domain 一处**，schema 与 UI 自动同步 |

## 范围

### 包含范围

1. **修复 hide-message depth 表单校验**
   - `validate-event-config-blocks.ts` 向 `validateDepthSlice` 传入完整 `DepthSlice`（`startDepth` 与 `endDepth`）。
2. **抽取共享 event action DAG 校验**
   - 在 `domain/events-config/logic/` 新增可复用校验函数（见 SPEC）。
   - `events-config.schema.ts` 的 `superRefine` 改调用共享实现。
   - `validate-event-config-blocks.ts` 改调用共享实现，并保留/映射中文用户面向错误。
3. **删除重复默认配置**
   - 移除 `config-forms/events/default-events-config.ts` 或改为从 domain 再导出；更新 barrel `index.ts`。
4. **测试**
   - `validate-event-config-blocks.test.ts`：仅 `endDepth`、双边界、非法 slice。
   - 共享 DAG 模块单测（或与 schema 测试合并）。
   - `event-config-state.test.ts`：`normalizeHideMessageAction` 剥离 `endDepth` 的行为（文档化有意设计）。
   - （推荐）`eventBlocksToConfig` 输出经 `decode(..., eventsConfigSchema)` 的 smoke 测试。
5. **Orchestrator 可选对齐**
   - `prevalidateDag` 可改为委托共享 domain 校验（defense-in-depth）；错误映射为 runtime 英文消息即可，**不**要求与 UI 中文一致。

### 不包含范围

- **事件配置 UI 新增 `endDepth` 输入** — 产品仍仅编辑 `startDepth`；`normalizeHideMessageAction` 继续丢弃 `endDepth`（本迭代加测 + 注释，不改为保留）。
- **加载含 `endDepth` wire 时的 UI 警告/只读展示** — 可后续单列 UX 迭代。
- **stored-config-validity 失效流程、Bootstrap migrate、事件 orchestrator 执行语义** 变更。
- **空 action 列表**（schema `min(0|1)`）产品决策与实现。
- **`eventBlocksToConfig` 重复 event 键 throw** — 属 defense-in-depth，非本迭代必做。
- **Mobile Agent 删除 Prompt 守卫** — 属 config-forms 其它项（explore-config-forms P1），不在本 feature。

## 核心需求

1. **DepthSlice 完整转发：** UI 保存校验须与 `validateDepthSlice` 契约一致，禁止仅校验 `startDepth`。
2. **DAG 规则单源：** 重复 action type、未知 dependency、自依赖（若单独检测）、有环 — 规则定义与检测逻辑仅存在于 domain 共享模块；schema 与 config-forms 为薄适配层。
3. **中文错误可理解：** `validateEventConfigBlocks` 继续返回本地化字符串（绑定 `eventTypeLabel` / `actionTypeLabel`），不得因抽取共享模块而退化 UX。
4. **有意 UI 裁剪可测：** `normalizeHideMessageAction` 剥离 `endDepth` 的行为须有单测，避免未来误删或误改。
5. **默认配置单一来源：** `DEFAULT_EVENTS_CONFIG` 仅以 `domain/events-config/logic/default-events.ts` 为权威。
6. **不破坏合法配置路径：** 合法 v2 事件配置在 assess → 编辑 → 保存 → runtime 全链路行为与迭代前一致（除修复 endDepth-only 误拒）。

## 验收标准

### Depth 校验

| ID | Given | When | Then |
|----|-------|------|------|
| D1 | 单 event block，hide-message 仅 `{ endDepth: 2 }` | `validateEventConfigBlocks` | 返回 `null`（通过） |
| D2 | hide-message `{ startDepth: 2, endDepth: 4 }` | 同上 | 通过 |
| D3 | hide-message 无 `startDepth` / `endDepth` | 同上 | 失败，消息含 depth slice 要求 |
| D4 | hide-message `{ startDepth: 5, endDepth: 2 }` | 同上 | 失败（start > end） |
| D5 | 仅 `endDepth` 的 wire 经 assess 为 valid，用户未改 depth 直接保存 | Desktop/Mobile 保存流程 | 成功持久化（不因 D1 bug 回归） |

### DAG 单源

| ID | Given | When | Then |
|----|-------|------|------|
| G1 | 重复 action type / 未知 dep / 自依赖 / 环 四类样例 | 分别经 schema decode 与 `validateEventConfigBlocks` | 均拒绝；规则与共享模块一致 |
| G2 | 合法 hide + run-agent + dependency DAG | 同上 | 均通过 |
| G3 | 修改共享 DAG 模块（测试用 mock 规则） | 仅改一处 | schema 与 UI 校验同步反映（人工/code review 验收） |
| G4 | `config-forms/events/validate-event-config-blocks.ts` | 代码审阅 | **无** 本地 `validateDag` 实现 |

### 默认配置与文档化裁剪

| ID | Given | When | Then |
|----|-------|------|------|
| C1 | 仓库搜索 `DEFAULT_EVENTS_CONFIG` 定义 | — | 仅 domain `default-events.ts` 一处定义（config-forms 可为 re-export） |
| C2 | wire 含 `endDepth` 的 hide-message | `configToEventBlocks` → `eventBlocksToConfig` | 输出 params **无** `endDepth`（单测断言） |

### 回归

| ID | Given | When | Then |
|----|-------|------|------|
| R1 | `packages/core` 测试套件 | `npm test -w @novel-master/core`（或项目既定 test:fast） | 无新增失败 |
| R2 | 现有 `events-config.schema.test.ts` DAG 用例 | 运行 | 仍通过 |
| R3 | 合法配置经 orchestrator emit | 现有 DAG 集成测试 | 行为不变 |

## 风险与待确认项

| 项 | 说明 |
|----|------|
| **UI 仍丢弃 endDepth** | 修复校验后，用户在 UI 打开仅 `endDepth` 配置并保存仍会丢失 `endDepth`（normalize 路径）。本迭代接受；若需保留须单列「Events UI 高级 depth」迭代。 |
| **Orchestrator 错误文案** | runtime `prevalidateDag` 若委托共享模块，英文 message 可能与 schema 抛错 wording 略有差异；以「同一拒绝集合」为准，不要求字符串完全一致。 |
| **自依赖检测** | UI 当前有专用中文「不能依赖自身」；共享模块应保留显式自依赖检测以便映射，而非仅依赖环检测的间接消息。 |
| **Phase 依赖** | 建议在 [ci-test-health](../ci-test-health/) Phase 0 全绿后实施，避免与 hide-message 测试修复并行冲突。 |

## 约束与依赖

- **依赖 PRD：** [stored-config-validity](../../../stored-config-validity/prd.md)、[config-forms-merge-into-core](../../../config-forms-merge-into-core/prd.md)
- **迭代位置：** `core-explore-remediation` Phase 2（readme 第 12 项：config-forms hide-message `endDepth` + DAG 单源）
- **文档后续：** 本 PRD 确认后编写 [spec.md](./spec.md)，再实施代码修改
