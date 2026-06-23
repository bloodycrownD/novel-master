# 内置 Provider 协议推断修复（provider-builtin-protocol）SPEC

## 设计目标

- 修复 `inferLlmProtocolFromApplicationModelId()` 对内置 provider id **`google`**、**`openrouter`** 的错误回退（当前 → `anthropic`）。
- 使 export 路径推断结果与 [provider-model PRD 内置表](../../../provider-model/prd.md#内置服务商bootstrap-seed)、`seed-builtin-providers.ts`、DB `llm_provider.protocol` **一致**。
- 以**最小 diff** 恢复 Agent `normalizeForLlmExport` 协议参数正确性；**不**改动 `ModelRequestService`（已用 DB protocol）。
- 新增表驱动单元测试，防止 map 与 seed 再次漂移。
- **不**在本 feature 内处理 explore 列出的 settings patch、格式化、死依赖等 P1/P2 项。

## 现状与根因

### 内置 seed（正确）

`packages/core/src/bootstrap/provider/seed-builtin-providers.ts`：

| providerId (`id`) | protocol | baseUrl（默认） |
|-------------------|----------|-----------------|
| `openai` | `openai` | `https://api.openai.com/v1` |
| `anthropic` | `anthropic` | `https://api.anthropic.com` |
| `google` | `gemini` | `https://generativelanguage.googleapis.com/v1beta` |
| `openrouter` | `openai` | `https://openrouter.ai/api/v1` |

`DefaultProviderService` 中 `BUILTIN_IDS = {"openai","anthropic","google","openrouter"}` 与上表 id 一致。

### 推断 map（错误）

`packages/core/src/domain/provider/logic/infer-llm-protocol-from-model-id.ts`：

```typescript
const PROTOCOL_BY_PROVIDER_ID = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",  // ← 键应为 provider id "google"，非 protocol 名
  // 缺少 openrouter → openai
};
// unknown → "anthropic"
```

**根因：** map 按 **protocol 名**误写 `gemini` 键，且未包含 `google`、`openrouter` 两个 **provider id**。

### 调用链

```mermaid
flowchart LR
  AR[agent-runner.ts]
  INF[inferLlmProtocolFromApplicationModelId]
  NORM[normalizeForLlmExport]
  AR --> INF
  INF --> NORM
```

- `ModelRequestService.request()`：**不经过** infer；`resolveAdapter(provider.protocol)` 正确。
- `public/provider.ts` 导出 infer 函数；修复后对外签名不变。

## 方案选型

| 方案 | 描述 | 本 feature |
|------|------|------------|
| **A. 修正硬编码 map** | 在 infer 文件内补全 `google`、`openrouter`；删除错误 `gemini` 键 | ✅ **采用**（最小修复） |
| **B. 抽取共享常量** | 从 seed 模块导出 `BUILTIN_PROVIDER_PROTOCOLS` readonly record，infer 与 seed 共用 | ✅ **推荐同步**（避免双源） |
| **C. 仓储解析** | infer 注入 `ProviderRepository`，按 `providerId` 读 `protocol` | ❌ 本 feature 不采用（需 async / deps 变更，export 路径现为 sync 纯函数） |

**锁定决策：** 实现 **A + B**：新增共享内置映射常量，seed 与 infer **均引用**（或 seed 数组 derive 出 map），消除第三份列表。

## 详细设计

### 1. 共享内置 provider ↔ protocol 常量

**新文件（推荐）：** `packages/core/src/domain/provider/logic/builtin-provider-protocols.ts`

```typescript
import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";

/** Bootstrap 内置 provider id → protocol；与 seed-builtin-providers 一致。 */
export const BUILTIN_PROVIDER_PROTOCOLS: Readonly<
  Record<string, LlmProtocolKind>
> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "gemini",
  openrouter: "openai",
} as const;

export const BUILTIN_PROVIDER_IDS = Object.freeze(
  Object.keys(BUILTIN_PROVIDER_PROTOCOLS),
) as readonly string[];
```

**或** 在 `bootstrap/provider/seed-builtin-providers.ts` 定义 `BUILTIN` 数组并 export helper：

```typescript
export function builtinProtocolByProviderId(id: string): LlmProtocolKind | undefined {
  return BUILTIN.find((r) => r.id === id)?.protocol;
}
```

**约束：** domain 层不得 import bootstrap；若常量放 bootstrap，infer（domain）不能反向依赖。**因此常量应放在 `domain/provider/logic/`**，seed 改为 import 该常量生成 INSERT 行（或 seed 保留数组、logic 从同一数组 re-export map——任选一种，但仅**一处**维护 id+protocol 对）。

**推荐结构：**

```
domain/provider/logic/builtin-providers.ts   ← 单一 BUILTIN_ROWS 数组
bootstrap/provider/seed-builtin-providers.ts ← import BUILTIN_ROWS，只负责 SQL
domain/provider/logic/infer-llm-protocol-from-model-id.ts ← import map derived from BUILTIN_ROWS
service/provider/impl/provider.service.ts    ← BUILTIN_IDS from keys(BUILTIN_ROWS)
```

### 2. 修复 infer 函数

`infer-llm-protocol-from-model-id.ts`：

```typescript
import { BUILTIN_PROVIDER_PROTOCOLS } from "./builtin-providers.js";

export function inferLlmProtocolFromApplicationModelId(
  applicationModelId: string,
): LlmProtocolKind {
  try {
    const { providerId } = parseApplicationModelId(applicationModelId);
    return BUILTIN_PROVIDER_PROTOCOLS[providerId] ?? "anthropic";
  } catch {
    return "anthropic";
  }
}
```

- **回退语义不变：** 未知 provider id、parse 失败 → `"anthropic"`。
- **JSDoc：** 统一为英文（与 provider 域其余文件一致）；说明仅覆盖**内置** id，自定义 provider 在 export 路径仍可能误判（已知限制，PRD 已记录）。

### 3. 对齐 seed 与 BUILTIN_IDS

| 文件 | 变更 |
|------|------|
| `seed-builtin-providers.ts` | `BUILTIN` 数组改为从 `builtin-providers.ts` 导入，或删除重复定义 |
| `provider.service.ts` | `BUILTIN_IDS` 改为 `new Set(BUILTIN_PROVIDER_IDS)` 或从共享模块导入 |

避免三处独立列表。

### 4. agent-runner

**无需改逻辑**；推断修复后 `normalizeForLlmExport(..., protocol, zones)` 自动获得正确 protocol。

可选（非必做）：在现有 agent 相关测试中加断言 stub，验证 infer 被调用时期望 protocol——通常单元测试已足够。

## 变更清单

| 路径 | 操作 |
|------|------|
| `domain/provider/logic/builtin-providers.ts` | **新增** — 内置 rows + protocol map + ids |
| `domain/provider/logic/infer-llm-protocol-from-model-id.ts` | **修改** — 使用共享 map |
| `bootstrap/provider/seed-builtin-providers.ts` | **修改** — 引用共享 rows |
| `service/provider/impl/provider.service.ts` | **修改** — `BUILTIN_IDS` 来自共享模块 |
| `test/provider/infer-llm-protocol-from-model-id.test.ts` | **新增** — 表驱动测试 |
| `test/provider/bootstrap-seed.test.ts` | **可选** — 断言 seed protocol 列与共享常量一致 |

**不修改：** `model-request.service.ts`、`agent-runner.ts`（除非集成测需要）、`public/provider.ts` 导出面。

## 测试计划

### 单元测试 `infer-llm-protocol-from-model-id.test.ts`

表驱动用例：

| applicationModelId | expected |
|--------------------|----------|
| `openai/gpt-4o` | `openai` |
| `anthropic/claude-3-5-sonnet-20241022` | `anthropic` |
| `google/gemini-2.0-flash` | `gemini` |
| `openrouter/meta-llama/llama-3-70b-instruct` | `openai` |
| `custom-gateway/some-model` | `anthropic` |
| `not-a-valid-id` | `anthropic` |

### 回归

```bash
cd packages/core && npm run test:fast
```

- 现有 `bootstrap-seed.test.ts`、`provider-service.test.ts` 保持通过。
- 全 suite 893+ 用例 0 失败。

### 可选集成测

若成本低，在 `agent-runner.test.ts` 或专用用例中：mock 下游 adapter，断言 `google/*` 模型 turn 时 export 路径使用 gemini 规范化（例如 spy `normalizeForLlmExport` 第二参数）。**非阻塞验收**；P1–P7 中 P7 可仅通过单元 + 代码审阅满足。

## 实施步骤

1. 新增 `builtin-providers.ts`，从当前 seed 复制四行 id/protocol/baseUrl/displayName（infer 仅需 id+protocol；seed 保留 baseUrl 等于 PRD）。
2. 重构 `seed-builtin-providers.ts` 使用共享 rows。
3. 重构 `provider.service.ts` 的 `BUILTIN_IDS`。
4. 更新 `infer-llm-protocol-from-model-id.ts`。
5. 新增单元测试文件。
6. 跑 `test:fast`；修复任何因 import 循环导致的构建问题（domain 不依赖 bootstrap/service）。

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| import 循环 | 常量仅放 `domain/provider/logic/`；bootstrap/service 向下依赖 domain |
| seed 行为变化 | seed 仍为 `INSERT … WHERE NOT EXISTS`；仅数据来源变，SQL 参数不变 |
| 自定义 provider export 仍错误 | PRD 已知限制；后续 feature 可引入 async `resolveProtocolForModelId(deps)` |

回滚：还原 infer map 与新增文件即可；无 schema 迁移。

## PRD 验收映射

| PRD ID | SPEC 对应 |
|--------|-----------|
| P1–P5 | 单元测试表 |
| P6 | `test:fast` 全绿 |
| P7 | infer 单元测试 + agent-runner 无改动审阅；可选集成 spy |

## 关联文档

- [prd.md](./prd.md)
- [explore.md](./explore.md)
- [provider-model PRD](../../../provider-model/prd.md)
- [provider-model SPEC](../../../provider-model/spec.md)
- [core-explore-remediation readme](../../readme.md)
