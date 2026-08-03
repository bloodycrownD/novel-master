---
date: 2026-06-21
dependency: Iterations/global-compaction-policy/prd.md
---

# 压缩条件存储完整性（compaction-conditions-integrity）PRD

## 背景

`compaction-conditions` 域（v3 schema）持久化全局压缩**触发条件**于 KKV 模块 `nm-compaction-conditions` / key `policy`。`AgentRunner` 每步通过 `CompactionConditionEvaluator` 读取条件，满足 OR 触发器时 emit `session.compaction.requested`，由 events 配置执行 hide / refresh-macros 等动作。

代码审查（[explore-compaction-conditions.md](./explore-compaction-conditions.md)、[explore-kkv.md](./explore-kkv.md)）发现两处 **P0 正确性缺口**：

1. **损坏 KKV 静默禁用压缩：** `DefaultCompactionConditionsStore.getConditions()` 在 `JSON.parse` 或 Zod decode 失败时 `catch` 后返回 `null`（`compaction-conditions-store.service.ts:57–58`）。键存在但 wire 无效时，evaluator 与「未配置」无法区分，用户以为压缩已启用，实际永不触发。
2. **写入路径绕过 schema：** `setConditions()` 直接 `JSON.stringify` 持久化 domain 对象，未走 `compactionConditionsSchema`（`compaction-conditions-store.service.ts:62–64`）。仅 CLI `set --file` 在调用 store 前 decode；Desktop IPC、Mobile、测试或未来调用方可写入 `enabled: true` 且无 trigger 的非法文档，evaluator 静默返回 `false`。

`CompactionConditionsError`（含 `INVALID_SCHEMA`）已定义并导出，CLI `cli-errors.ts` 已映射，**store 从未抛出**。

本 feature 属 `core-explore-remediation` **Phase 1**，在 [global-compaction-policy PRD](../../../global-compaction-policy/prd.md) 所定义的「全局压缩策略 / 条件与 Agent 解耦」产品方向下，补齐 **KKV 读写边界** 的可观测性与 fail-fast 语义；**不**变更 trigger 算法、v2→v3 迁移规则或 events 编排。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 损坏数据 fail-fast | KKV 键存在且 wire 无法 parse/decode 时，`getConditions()` **抛出** `CompactionConditionsError("INVALID_SCHEMA", …)`，**不**返回 `null` |
| 写入前强制校验 | `setConditions()` 在 `kkv.set` 前经 `compactionConditionsSchema` 校验；非法 domain/wire 抛出 `INVALID_SCHEMA`，**不**落库 |
| 缺失键语义不变 | KKV `NOT_FOUND` 时 `getConditions()` 仍返回 `null`（表示未配置） |
| v2 迁移保持 | 合法 v2 文档读一次迁移写回 v3 的行为与现有迁移测试一致 |
| 错误可到达用户 | CLI `show`/`set`、Desktop IPC、agent run 路径可将 store 错误展示为可读消息（非未处理 rejection 或误报「未配置」） |
| 回归门禁 | 新增 store 错误路径单测；`npm run test:fast`（`packages/core`）全绿 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| CLI / Desktop 运维 | `nm compaction-conditions show` 发现 DB 中策略损坏时，应看到明确 schema 错误而非「No compaction conditions configured」 |
| 对话运行时 | Agent 步进读取条件时，若 KKV 损坏应 **中断并暴露错误**，避免「压缩看似启用、实际永不触发」 |
| 设置页开发者 | Desktop/Mobile 调用 `setConditions` 时，非法 payload 在 store 层被拒绝，不写入半合法 JSON |
| 核心库维护者 | 单测覆盖 corrupt read、invalid write，防止回归静默失败 |

## 范围

### 包含范围

- **`DefaultCompactionConditionsStore` 读路径：** 区分「键不存在」与「键存在但无效」；后者映射为 `CompactionConditionsError("INVALID_SCHEMA", …)`（含 `JSON.parse` 失败、v3 decode 失败；v2 迁移后写回前须保证产出可 decode）
- **`DefaultCompactionConditionsStore` 写路径：** `setConditions` 写入前 Zod 校验（复用 `compactionConditionsSchema` / 共享 assert 辅助）
- **错误辅助（可选最小）：** 如 `isCompactionConditionsError` 或 store 内私有 `toCompactionConditionsError`，将 `ConfigDecodeError` 转为 `CompactionConditionsError` 以统一对外类型
- **单测：** 新建 `compaction-conditions-store.service.test.ts`（或等价路径），覆盖 corrupt JSON、invalid v3、invalid set、`NOT_FOUND` → null
- **文档：** 本目录 `spec.md`（design-proposal）

### 不包含范围

- Trigger 逻辑变更（token ratio、visible floor、composite OR）
- v2 检测启发式收紧（`isV2Document` 仅凭 `tokenThreshold` 等 P2 项）
- Evaluator 每步 KKV 读 / trigger 重建缓存（P1-4）
- 死代码清理（`CompactionConditionsTrigger` 未使用类型、`workspaceModelId` 等）
- Schema 错误文案 polish（`visibleFloor` vs `visible-floor` 提示）
- KKV 层共享 `readKkvJsonDocument` 辅助（explore-kkv P6）
- `global-compaction-policy` 中 CompactionPolicy 聚合、Agent 移除 `compact` 等大重构（见 dependency PRD；与本 feature 正交，可并行但实现顺序以 spec 为准）
- stored-config-validity 统一 assess UI（events/agent 失效面板）

## 核心需求

1. **`getConditions()` 三分语义：**
   - KKV 无键 → `null`
   - KKV 有键，合法 v2 → 迁移为 v3、写回、返回 v3 domain 对象
   - KKV 有键，合法 v3 → decode 返回 domain 对象
   - KKV 有键，**无法** parse 或 decode（非 v2 可迁移形态）→ **throw** `CompactionConditionsError("INVALID_SCHEMA", message, details?)`

2. **`setConditions()` 写入门禁：** 任意调用方传入的对象必须在 `kkv.set` 前通过 `compactionConditionsSchema`（或等价的 domain 校验，须覆盖 `enabled: true` 至少一项 trigger 规则）；失败 throw `INVALID_SCHEMA`，**不**写入。

3. **`clearConditions()`：** 行为不变（幂等吞 `NOT_FOUND`）。

4. **对外契约：** `CompactionConditionsStore` port 签名不变；`null` 仅表示未配置。调用方（evaluator、CLI、IPC）无需改签名，但须能传播或展示 store 抛错（现有 try/catch 路径已存在处保持）。

5. **测试：** 至少覆盖 CR 两条 P0 + 迁移 happy path 不回归。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| R1 | KKV 无 `nm-compaction-conditions` / `policy` | `getConditions()` | 返回 `null` |
| R2 | KKV 值为 `{not-json` | `getConditions()` | 抛出 `CompactionConditionsError`，`code === "INVALID_SCHEMA"` |
| R3 | KKV 值为 v3 形但 `enabled: true` 且无 `tokenRatio`/`visibleFloor` | `getConditions()` | 抛出 `INVALID_SCHEMA`，**不**返回 `null` |
| R4 | KKV 值为合法 v2 文档 | `getConditions()` | 返回 v3 对象并写回（与现有迁移测试一致） |
| W1 | 调用 `setConditions({ schemaVersion: 3, enabled: true })`（无 trigger） | — | 抛出 `INVALID_SCHEMA`；KKV 中无更新或保持原值 |
| W2 | 调用 `setConditions` 合法 v3（如 `enabled: true, tokenRatio: 0.8`） | 再 `getConditions()` |  round-trip 一致 |
| W3 | CLI `nm compaction-conditions set --file` 合法 YAML | — | 行为与现网一致（CLI decode + store 校验双重通过） |
| E1 | Desktop `handleCompactionConditionsGet` | store 读 corrupt | IPC `{ ok: false, error: … }` 含 schema 信息 |
| T1 | `npm run test:fast` | 全量 | 0 failures |

## 约束与依赖

- **产品依赖：** [全局压缩策略 PRD](../../../global-compaction-policy/prd.md) — 压缩条件作为全局单例 KKV 文档的长期模型；本 feature 不改变 v3 字段语义，仅加固读写。
- **前置迭代：** [event-bus-compaction-conditions](../../../event-bus-compaction-conditions/spec.md) 已落地 v3 条件 + event emit 路径；本 feature 在其 store 实现上增量修复。
- **迭代位置：** `core-explore-remediation` Phase 1（与 ci-test-health Phase 0 完成后并行或紧随其后）。
- **文档后续：** 本 PRD 确认后编写 [spec.md](./spec.md)，再实施代码修改。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| Agent run 失败面 | corrupt KKV 将导致 agent 步进抛错而非静默跳过压缩；**有意为之**（fail-fast）。是否需在 CLI 增加 `compaction-conditions validate` 由 spec 可选 |
| 双次 decode | CLI `set` 已 decode，store 再校验 — 轻微重复，可接受以保证所有入口一致 |
| v2 迁移写回 | 迁移产物须满足 v3 schema（尤其 `enabled: true` 时 trigger 存在）；若 v2 `enabled: true` 且无 floor 则迁移默认 `tokenRatio: 0.8`，已满足 |

---

**路径：** `.apm/kb/docs/Iterations/core-explore-remediation/features/compaction-conditions-integrity/prd.md`
