---
date: 2026-06-21
dependency: Iterations/message-visibility/prd.md
---

# CI 测试健康恢复（ci-test-health）PRD

## 背景

`packages/core` 在两轮代码审查后执行 `npm run test:fast`，**893 用例中 891 通过、2 失败**，为当前唯一 CI 阻断项。失败均来自 `hide-message.handler` 集成测试：handler 已随 message-visibility 迭代改为通过 transcript effects 批量隐藏消息，测试仍沿用旧调用方式，运行时抛出 TypeError，无法验证 depth 锚点与 seq 范围隐藏行为。

生产路径（事件编排器触发 hide-message）已有 DAG 测试覆盖且通过；**本需求仅恢复测试与 handler 契约对齐，使自动化门禁重新可信**，不扩展 hide-message 产品能力。

**参考材料：** [explore.md](./explore.md)、[迭代 readme](../../readme.md)

## 目标

| 目标 | 成功指标 |
|------|----------|
| 恢复 core fast 测试全绿 | `npm run test:fast`（`packages/core`）**893/893 通过**，退出码 0 |
| hide-message 集成测试可信 | 两条 fixture 用例能稳定断言 depth 锚点与 seq 范围隐藏，不再因依赖缺失失败 |
| 不引入行为回归 | 现有事件编排 DAG 及 message transcript effects 相关用例保持通过 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 核心库维护者 / 贡献者 | 本地或 CI 跑 `test:fast` 作为合并前门禁，需可靠反映 hide-message + depth 行为 |
| 事件 / compaction 链路开发者 | 修改 hide-message 或 depth 解析后，依赖集成测试验证「按 depth slice 隐藏 seq 范围」不退化 |
| 发布 / 集成负责人 | 以全绿 fast 套件作为 Phase 1 正确性修复的前置条件 |

## 范围

### 包含

- 修复 `hide-message.handler` 集成测试，使其与当前 handler 契约一致
- 保留现有两条用例的业务断言（depth 锚点、含 endDepth 的 min~max seq 隐藏）
- 跑通并记录验收命令 `npm run test:fast`

### 不包含

- hide-message **产品行为**变更（depth 算法、锚点规则、事件配置 UI）
- handler 源码格式 / CRLF 大规模整理
- 新增 orchestrator 级集成测试（已有 DAG 测试覆盖委托路径）
- compaction、VFS、provider 等其他 CR 项
- CI workflow 或 `npm test` 与 `test:fast` 范围对齐

## 核心需求

1. **恢复 CI 门禁：** 修复后 `test:fast` 全量通过，无新增失败。
2. **测试与 handler 契约对齐：** 集成测试须按当前 handler 要求的参数与依赖调用，不得沿用已废弃的 session 对象首参或缺失 transcript effects 的 deps。
3. **保留 depth 回归价值：** 「startDepth=6、depth6 为 user 时锚定 assistant 起点」与「含 endDepth 的 min~max seq」两条场景继续作为验收用例，不得删改为无意义的 mock 通过。
4. **断言真实隐藏结果：** 调用后须能验证各 message 的 `hidden` 字段与预期 seq 区间一致。
5. **生产路径无静默破损：** 若审阅发现 orchestrator → handler 接线也缺依赖，纳入最小修复；若仅测试过时，则只修测试。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| T1 | `packages/core` 依赖已安装 | 执行 `npm run test:fast` | 退出码 0；汇总 **893 tests, 0 failures** |
| T2 | `hide-message.handler` 集成测试文件 | 单独或随 fast 套件运行 | 两条用例均通过，无 deps 缺失类 TypeError |
| T3 | 用例 1 fixture（10 条消息、`startDepth: 6`） | 执行 hide-message action 后查询 session 消息 | 仅预期 seq 区间内 `hidden === true`，区间外为 `false` |
| T4 | 用例 2 fixture（5 条消息、`startDepth: 2, endDepth: 4`） | 同上 | 隐藏 seq 范围与 depth 解析预期一致 |
| T5 | 现有 event orchestrator DAG 套件 | `test:fast` | hide-message 委托 effects 等用例仍通过 |
| T6 | 现有 MessageTranscriptEffectsService 单测 | `test:fast` | 仍通过 |

## 约束与依赖

- **前置能力：** [Message 可见性控制 PRD](../../../message-visibility/prd.md) 已提供 `hidden` 字段与批量隐藏能力；hide-message handler 在其之上按 depth slice 计算 seq 范围。
- **迭代位置：** `core-explore-remediation` Phase 0；完成后方可进入 Phase 1 正确性修复。
- **文档后续：** PRD 确认后进入 [spec.md](./spec.md) 设计与实现。
