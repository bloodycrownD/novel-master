---
date: 2026-06-21
dependency: Iterations/regex-system/prd.md
---

# 工作区指针生命周期对称性（persistent-state-lifecycle）PRD

## 背景

`PersistentState` 在 KKV 模块 `nm-workspace-state` 中持久化 6 个工作区指针（含 `currentRegexGroupId`、`currentAgentId`）。两轮代码审查确认：薄 typed port 设计合理、无 P0 数据损坏；**主要缺口为跨域删除时的指针生命周期不对称**。

| 指针 | 实体删除路径 | 删后清指针 | Stale 消费行为 |
|------|--------------|------------|----------------|
| `currentRegexGroupId` | `RegexConfigService.deleteGroup` | ✅ Core 已实现（注入 `state` 时 `reset`） | `resolveActiveCompiledRules` → 无规则 |
| `currentAgentId` | `AgentRegistryService.delete` | ❌ Core 未实现 | `resolveCurrentAgentDefinition` → `AgentRunResolveError` |

[regex-system PRD](../../../regex-system/prd.md) 已要求「删除当前生效组时自动清空指针」并在 Core `deleteGroup` 落地（测试 R8）。Agent 侧尚无对称 hook：**CLI `nm agent delete` 完全不维护指针**；Desktop IPC 在 host 层 `reset`；Mobile 在 host 层 `reset` 或 `setCurrentAgentId(remaining[0])`——三端策略分散，且 stale 指针在 Core 解析路径会抛错（比 regex 静默降级更显式，但仍属用户可触发的坏状态）。

本 feature 属 `core-explore-remediation` **Phase 4 / P2**，目标是在 **Core 服务层** 补齐 Agent 指针清理，与 regex 指针对齐，并收敛 host 重复逻辑。

**参考材料：** [explore.md](./explore.md)、[迭代 readme](../../readme.md)

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| Agent 删后指针与 regex 对称 | `AgentRegistryService.delete` 在注入 `PersistentState` 且删除 id 等于 `currentAgentId` 时调用 `resetCurrentAgentId` |
| 三端 runtime 均注入 state | Desktop / CLI / Mobile 的 `createAgentRegistryService(conn, state)` 与 regex 工厂模式一致 |
| CLI 删除当前 Agent 不再 stale | `nm agent delete <current>` 后 `getCurrentAgentId()` 为 `undefined`；`resolveCurrentAgentId` 可回退 registry 首项 |
| 无行为回归 | 现有 `persistent-state`（17 测）、`agent-registry`、regex R8、`agent-run-shared` 用例保持通过 |
| 键常量工程化（同批 P2） | 新增 `workspace-state-keys.ts` 并从 `@novel-master/core` 导出，与 `preference-keys.ts` 对称 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| CLI 用户 | `nm agent use writer` 后 `nm agent delete writer`，再 `nm agent run` 应回退到 registry 中首个 Agent，而非 `Agent 不存在` |
| Desktop 用户 | Agent 管理页删除当前 Agent 后，顶栏 / prompt / run 路径不再持有 stale id |
| Mobile 用户 | Agent 列表删除当前项后，run 与顶栏展示与 Core 回退语义一致 |
| 核心库维护者 | 新增 workspace 指针或删除实体时，有单一 Core 生命周期 hook，不必在三端 host 重复实现 |

## 范围

### 包含范围

#### 1. Core：Agent 删除清指针（主交付）

- 扩展 `createAgentRegistryService(conn, state?)`：`state` 可选；**生产 runtime 必须传入**（与 `createRegexConfigService` 一致）。
- `DefaultAgentRegistryService.delete`：删除成功后，若 `state.getCurrentAgentId() === agentId`，则 `state.resetCurrentAgentId()`。
- 未注入 `state` 时行为与现网相同（仅删 SQL 行，不清指针）——供单测 / 脚本；**文档注明 prod 必须注入**。
- 新增 Core 单测 **AG5**（mirror regex R8）：删当前 Agent 后指针为 `undefined`；删非当前 Agent 指针不变。

#### 2. Runtime / CLI 接线

- `apps/cli/src/runtime.ts`、`apps/desktop/.../create-desktop-runtime.ts`、`apps/mobile/.../create-mobile-runtime.ts`：`createAgentRegistryService(conn, state)`。
- `apps/cli/src/agent/registry-commands.ts`：`delete` 子命令依赖 Core 清指针，**移除**若存在的 host 层重复逻辑（当前 CLI 无清理，改后由 Core 负责）。
- Desktop / Mobile：删除 Agent 的 IPC / UI handler 中**移除**与 Core 重复的 `resetCurrentAgentId` / `setCurrentAgentId(remaining[0])` 块，避免双写；Mobile 删除后当前 Agent 展示依赖 `resolveCurrentAgentId` 回退（state 空 → registry 首项）。

#### 3. 工作区键 SSoT（同 feature 次要交付）

- 新增 `packages/core/src/service/persistent-state/impl/workspace-state-keys.ts`：导出 `WORKSPACE_STATE_MODULE` 与 6 个 `KEY_*` 常量。
- `persistent-state.service.ts` 引用该文件；从 `@novel-master/core` 主入口或 `persistent-state` 子路径导出（与 `PREF_KEY_*` 对齐，具体路径见 SPEC）。
- 测试 / CLI 新代码禁止硬编码 `"currentAgentId"` 等字符串（存量可渐进替换，本 feature 至少 service + 新测使用常量）。

#### 4. 文档

- `agent-registry.port.ts` / `create-agent-registry-service.ts` JSDoc：说明 `delete` 的指针副作用（对齐 regex 工厂注释）。

### 不包含范围

- **`PersistentPreferences`** 变更（布尔损坏、raw API、`llmStream` 单测补全等 explore P3 项）
- **空字符串指针** normalize（`set*` trim / 空串转 reset）— 另开 follow-up
- **project / session / model / provider** 指针在实体删除时的清理（无对称需求或已有 CLI 联动）
- **`resolveCurrentAgentId` 算法变更**（仍为 state 非空优先，否则 registry 首项；本 feature 仅保证删当前 Agent 后 state 被 reset）
- Mobile「删当前 Agent 后显式切到列表首项」的**额外 UX**（与 reset + 回退等价时可删 host 逻辑；若产品坚持显式 `set`，需在 SPEC 中标注为可选 host 增强，本 PRD 以 **reset-only** 与 regex 对齐为准）
- `public-api-boundaries` 范围内的 broad export 收敛
- KKV string store DRY 提取（explore P3）

## 核心需求

1. **对称生命周期：** Agent 实体删除与 regex 组删除一样，在 Core 层维护 `currentAgentId` 指针；条件为「被删 id === 当前指针」。
2. **reset-only 语义：** 清指针仅 `resetCurrentAgentId()`，**不**在 Core 内自动 `setCurrentAgentId(otherId)`（与 regex `deleteGroup` 一致）。
3. **工厂注入契约：** 三端 production runtime 创建 `agentRegistry` 时必须传入与 `regexConfig` 相同的 `state` 实例。
4. **Stale 防御仍保留：** `resolveCurrentAgentDefinition` 对「state 仍指向不存在 agent」的抛错路径保留；本 feature 消除主路径删 agent 后产生 stale 的来源。
5. **键常量 SSoT：** workspace 6 键集中定义并公开导出，降低 CLI/测试硬编码风险。
6. **向后兼容：** `createAgentRegistryService(conn)` 单参签名仍可用；不传 `state` 时不清指针（与 regex 现有行为一致）。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| L1 | `state` 已注入，`currentAgentId = A`，registry 含 A、B | `agentRegistry.delete(A)` | `getCurrentAgentId()` 为 `undefined`；`resolveCurrentAgentId` 返回 B（registry 首项，按现有 list 顺序） |
| L2 | `currentAgentId = A`，删除 B | `delete(B)` | `getCurrentAgentId()` 仍为 A |
| L3 | 未注入 `state` 的 registry | `delete(current)` | Agent 行已删；KKV 指针不变（回归现有单测场景） |
| L4 | CLI：`nm agent use A` 后 | `nm agent delete A` | 指针已 reset；后续 run 不抛 `Agent 不存在：A` |
| L5 | Desktop / Mobile runtime | 删除当前 Agent（UI 或 IPC） | 与 L1 一致；handler 无重复 reset 逻辑仍正确 |
| L6 | regex R8 + 本 feature AG5 | `npm run test:fast`（core） | 通过；无新增失败 |
| L7 | `workspace-state-keys` 已导出 | 新测 / service 引用常量 | 无 magic string `currentAgentId` 等于字面量在 service impl 内联 |

## 约束与依赖

- **前置能力：** [regex-system PRD](../../../regex-system/prd.md) 已定义 `currentRegexGroupId` 指针与 `deleteGroup` 清指针模式；本 feature **镜像** 该模式至 Agent。
- **迭代位置：** `core-explore-remediation` Phase 4；不阻塞 Phase 0–3 P0/P1 修复。
- **文档后续：** 本 PRD 确认后进入同目录 `spec.md`（design-proposal），再实施代码修改。
