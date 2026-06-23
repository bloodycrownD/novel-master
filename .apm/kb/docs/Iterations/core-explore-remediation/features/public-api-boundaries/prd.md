---
date: 2026-06-21
dependency: []
---

# Public API 边界收敛（public-api-boundaries）PRD

## 背景

`@novel-master/core` 采用**双层公开面**：主入口 `@novel-master/core` 承载 TDBC、bootstrap、序列化、Tool 运行时等跨端基础设施；10 个 `src/public/*.ts` 子入口承载各限界上下文的类型、逻辑与服务工厂；另有 `kkv`、`tdbc`、`sksp`、`nmtp`、`front-matter`、`config-forms/*` 等辅助子路径直连内部模块。

该分层方向正确，且 `package-exports-t0.test.ts` 已断言主入口不得泄漏 10 个领域工厂与 `createKkvService`。但 explore 审查发现三类缺口：

1. **边界泄漏** — `public/prompt` 直接 re-export `config-forms/agent`；`public/session-fs` 聚合 message-checkpoint；`public/agent` 暴露 `ChatAgentSession` 等实现类。
2. **多路径重复 export** — 同一符号可从 `./compaction`、`config-forms/events`、`config-forms/shared`（`matchDepth`）；tokenizer 驱动可从 `./nmtp` 与 `./provider`；TDBC 可从主入口与 `./tdbc`。
3. **契约守卫不足** — 现有测试仅覆盖主入口 **denylist**（11 项）与 T9 token-counter 禁令；无 allowlist 快照、无 `public/*` 架构约束、无重复路径一致性断言。

大量 domain 类型与 wire schema 已成为 CLI、desktop、mobile 的事实公共契约；任意收缩 export 面均可能引发跨端编译或运行时破坏。本 feature 属于 `core-explore-remediation` **Phase 4**，在 Phase 0–3 正确性与协议修复之后执行，**以增量、非破坏方式**先固化契约再逐步收敛。

**参考材料：** [explore.md](./explore.md)、[迭代 readme](../../readme.md)

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 固化 package export 契约 | 新增契约测试：`npm run test:fast` 全绿；主入口 allowlist 快照 + 子入口 export 快照纳入 CI |
| 明确 export 使用边界 | 产出 export 意图文档（主入口 / `public/*` / `config-forms` / infra 子路径），消费方可查 |
| 收敛重复公共路径（渐进） | 约定并文档化各能力的**唯一 canonical 路径**；旧路径保留 re-export，无消费方编译破坏 |
| 降低边界泄漏增量 | 新增 lint/测试：`public/*.ts` 不得新增对 `config-forms` 的 import；既有泄漏列入 backlog 分阶段迁移 |
| 零破坏性变更（本迭代） | 不删除 `package.json` exports 条目；不移除已公开符号；monorepo 三端 + CLI 无需改 import 即可通过构建 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| core 库维护者 | 重构 domain/service 内部结构时，契约测试阻止无意 export 泄漏或主入口污染 |
| CLI / desktop / mobile 开发者 | 查阅 export 意图文档，选择 canonical 子路径导入，避免同一能力多路径分叉 |
| 驱动包作者（tdbc / tokenizer） | 明确 `./nmtp`、`./sksp`、`./tdbc` 与主入口的职责划分 |
| 发布负责人 | 变更 public API 前对照 allowlist 快照与 changelog 流程 |

## 范围

### 包含范围

**P1 — 契约与文档（必做）**

- 主入口 `@novel-master/core` **allowlist 快照测试**（固定当前合法 export 集合）
- 10 个 `public/*.ts` 子入口 **export 快照测试**（各路径独立 allowlist）
- **架构守卫测试**：`public/*.ts` 源文件不得 `import` 自 `config-forms/`（对既有 3 处泄漏：先登记豁免清单，禁止新增）
- **重复 export 一致性测试**（首批）：`matchDepth`、`validateDepthSlice` 在 `./compaction` 与 `config-forms/*` 导出值引用同一实现；`registerTokenizerDriver` 在 `./nmtp` 与 `./provider` 一致
- Export 意图文档：`packages/core/docs/public-api.md`（或等价路径，见 SPEC）

**P2 — 路径收敛（渐进，re-export 过渡期）**

- 文档约定 canonical 路径：
  - depth 工具 → `@novel-master/core/compaction`（config-forms 改为 re-export，不新增独立公共语义）
  - tokenizer **驱动注册** → `@novel-master/core/nmtp`；`provider` 保留计数/registry，文档标明驱动注册去 `nmtp`
  - agent 编辑器块操作 → `@novel-master/core/config-forms/agent`；`public/prompt` 保留 re-export 并标注 `@deprecated` JSDoc（不删符号）
- `./front-matter`：若无 monorepo 消费方，从 exports 移除 **或** 在文档中标记 `@internal`/预留；决策见 SPEC 验收项

**P3 — 结构性拆分（本 PRD 仅规划，实现可拆子迭代）**

- `./session-fs` 与 message-checkpoint 分离（新 `./message-checkpoint` 或并入 `./chat`，旧路径 re-export）
- `./provider` infra 层分离（文档 + 长期 backlog，本迭代不强制拆包）
- `ChatAgentSession` 等实现类降权（CLI 改 runner 注入，长期）

### 不包含范围

- 修改 domain/service **内部实现**或 wire schema 字段
- 强制 monorepo 消费方批量改 import（除非 P2 移除零消费 export 且 SPEC 明确）
- 将 `config-forms` 合并回主 barrel 或删除 `config-forms` 子路径
- `NOVEL_MASTER_SCHEMA_STATEMENTS` DDL 变更
- 与 `events-config-validation`（depth form 校验）、`message-checkpoint-and-agent`（checkpoint 行为）重叠的**运行时语义**修复

## 核心需求

1. **Allowlist 快照：** 主入口与各 `public/*` 子入口的 named export 集合以测试固化；有意变更须同步更新快照并 PR 说明。
2. **Denylist 延续：** 保留并扩展 `package-exports-t0.test.ts` 策略——主入口不得导出领域工厂、`createKkvService`、T9 禁令符号。
3. **架构守卫：** `src/public/*.ts` 新增 import 不得来自 `config-forms/`；既有 3 处（`prompt.ts` → `agent-editor-state`）列入豁免至 P3 迁移完成。
4. **Canonical 路径文档化：** 重复 export 能力须写入 public-api 文档，标明推荐路径与过渡 re-export。
5. **增量收敛：** P2 路径收敛仅允许「文档 + JSDoc `@deprecated` + re-export 保留」；删除 export 条目须满足「零 grep 消费方 + SPEC 验收」。
6. **非破坏交付：** 本 feature 任一 PR 合并后，`apps/cli`、`apps/desktop`、`apps/mobile` 现有 import 无需修改即可 `build` 通过。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| A1 | `packages/core` 依赖已安装 | `npm run test:fast` | 退出码 0；含新增契约测试全部通过 |
| A2 | 主入口模块 | 运行 allowlist 快照测试 | 当前 export 集合与快照一致；故意新增 export 无更新快照则失败 |
| A3 | 各 `public/*.ts` 子入口 | 运行子入口快照测试 | 10 个子路径 export 与快照一致 |
| A4 | `src/public/*.ts` 源文件 | 架构守卫测试 | 除豁免清单外无 `config-forms` import；新增 import 触发失败 |
| A5 | `matchDepth` / `validateDepthSlice` | 一致性测试 | `./compaction` 与 `config-forms/events`、`config-forms/shared` 导出同一函数引用 |
| A6 | `registerTokenizerDriver` | 一致性测试 | `./nmtp` 与 `./provider` 导出同一函数引用 |
| A7 | Export 意图文档 | 维护者查阅 | 明确主入口 / 子入口 / config-forms / infra 子路径职责与 canonical 表 |
| A8 | monorepo 三端 + CLI | 全量 build（或 CI 等价） | 无 import 变更前提下构建通过 |
| A9 | `./front-matter` | grep 消费方 + SPEC 决策 | 零消费则移除 export 或文档标记；有决策记录 |
| A10 | P2 `@deprecated` 标注 | 审查 `public/prompt` re-export | `movePersistBlock` 等含 JSDoc 指向 `config-forms/agent` |

## 约束与依赖

- **前置迭代：** 无硬依赖（`dependency: []`）；建议在 Phase 0–3 全绿后启动，避免与 P0 修复并行冲突。
- **软关联：** `events-config-validation` 涉及 depth 消费路径；`message-checkpoint-and-agent` 涉及 `./session-fs` 拆分——协调 canonical 路径约定，但不阻塞 P1 契约测试。
- **破坏性变更策略：** 任何 export 删除或签名变更须单独 changelog + 消费方迁移 PR；本 feature 默认禁止。
- **文档后续：** 本 PRD 确认后进入 [spec.md](./spec.md)（design-proposal），再分 PR 实施（建议 P1 单 PR、P2 按路径拆分 PR）。
