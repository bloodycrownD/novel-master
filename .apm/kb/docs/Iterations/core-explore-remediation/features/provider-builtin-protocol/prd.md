---
date: 2026-06-21
dependency: Iterations/provider-model/prd.md
---

# 内置 Provider 协议推断修复（provider-builtin-protocol）PRD

## 背景

[provider-model PRD](../../../provider-model/prd.md) 已定义四类**内置 provider**（`openai`、`anthropic`、`google`、`openrouter`）及其 **protocol** 绑定：`google` → `gemini`，`openrouter` → `openai`。Bootstrap seed（`seed-builtin-providers.ts`）与 DB 中的 `llm_provider.protocol` 列已正确写入上述映射。

然而，用于 **LLM export 路径** 的轻量推断函数 `inferLlmProtocolFromApplicationModelId()` 仍维护一份**与 seed 不一致**的硬编码 map：键为 `gemini` 而非 `google`，且缺少 `openrouter`。对 `google/*`、`openrouter/*` 应用模型 id，函数错误回退为 **`anthropic`**。

**影响面：** `agent-runner.ts` 在构造 LLM 请求前调用该函数，将结果传入 `normalizeForLlmExport()`。Gemini / OpenRouter 模型会按 Anthropic 规则规范化消息块（zone、tool 形态等），导致 Agent 多轮对话 export 与真实 HTTP 协议不匹配。`ModelRequestService` 走 DB `provider.protocol`，**不受此 bug 影响**；问题集中在 **prompt export / agent 主路径**。

**参考材料：** [explore.md](./explore.md)、[迭代 readme](../../readme.md)

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 内置 provider id 协议推断正确 | `google/*` → `gemini`；`openrouter/*` → `openai`；`openai/*`、`anthropic/*` 不变 |
| Agent export 与协议一致 | 使用内置 Google / OpenRouter 已保存模型跑 agent turn 时，`normalizeForLlmExport` 收到正确 `LlmProtocolKind` |
| 回归防护 | 新增 `infer-llm-protocol-from-model-id` 表驱动单元测试；`npm run test:fast` 全绿 |
| 与 provider-model 契约对齐 | 推断结果与 [provider-model PRD 内置表](../../../provider-model/prd.md#内置服务商bootstrap-seed) 及 seed 数据一致 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Agent / Chat 开发者 | 配置 `applicationModelId` 为 `google/gemini-2.0-flash` 或 `openrouter/anthropic/claude-3.5-sonnet`，期望消息 export 按 gemini / openai 规则处理 |
| CLI / Desktop 用户 | 通过内置 Google Gemini 或 OpenRouter provider 发起 agent 对话，不出现 Anthropic 专属块形态误用 |
| 核心库维护者 | 新增内置 provider 或调整 seed 时，有单一可信来源与测试约束，避免 map 再次漂移 |

## 范围

### 包含范围

- 修复 `packages/core/src/domain/provider/logic/infer-llm-protocol-from-model-id.ts` 中 `PROTOCOL_BY_PROVIDER_ID`（或等价机制），覆盖全部当前内置 provider id
- 新增单元测试 `packages/core/test/provider/infer-llm-protocol-from-model-id.test.ts`（或并入现有 provider 测试文件），表驱动覆盖内置 id、未知 id、非法 model id
- 确认 `agent-runner.ts` 调用链无需额外改动（推断修复即生效）；若 SPEC 选定「从仓储解析」方案，则同步调整 deps 注入
- 文档化内置 id ↔ protocol 与 seed 的对齐关系（在 SPEC 中锁定）

### 不包含范围

- `provider-model` 已交付的 CRUD、fetch、request HTTP 路径重构
- explore 中其它 provider 中低优先级项：`updateSettings` sampling 校验、损坏 JSON 包装、`provider-model.service.ts` 格式化、未使用 deps 清理等（归入后续 feature / quality-backlog）
- 自定义 provider 的协议推断改为 DB 查表（可作为 SPEC 可选增强，非本 PRD 必交付 unless 实现成本极低）
- 修改 `inferLlmProtocolFromApplicationModelId` 的 unknown 回退策略（仍默认 `anthropic`，除非 SPEC 明确变更）
- RN / CLI 新产品能力

## 核心需求

1. **内置 id 完整映射：** 推断 map 必须包含 seed 中全部 `id` → `protocol`：`openai`→`openai`、`anthropic`→`anthropic`、`google`→`gemini`、`openrouter`→`openai`。
2. **移除错误键：** 不得以 `gemini` 作为 provider id 键（内置 provider id 为 `google`）。
3. **export 路径正确性：** 给定合法应用模型 id `{builtinProviderId}/{vendorModelId}`，推断结果等于该 provider 在 DB/seed 中的 `protocol`。
4. **测试覆盖：** 至少覆盖四条内置 provider、一个未知 provider id、一个非法 application model id（parse 失败）三类用例。
5. **无 request 路径回归：** `ModelRequestService` 仍使用 `provider.protocol`；本修复不得改变 HTTP adapter 选择逻辑。
6. **单一事实来源（推荐）：** SPEC 应优先采用与 `seed-builtin-providers.ts` / `BUILTIN_IDS` 共享常量或从仓储读取，避免第三份漂移列表。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| P1 | 应用模型 id `google/gemini-2.0-flash` | 调用 `inferLlmProtocolFromApplicationModelId` | 返回 `"gemini"`（非 `"anthropic"`） |
| P2 | 应用模型 id `openrouter/meta-llama/llama-3-70b-instruct` | 同上 | 返回 `"openai"` |
| P3 | 应用模型 id `openai/gpt-4o`、`anthropic/claude-3-5-sonnet-20241022` | 同上 | 分别返回 `"openai"`、`"anthropic"` |
| P4 | 应用模型 id `unknown-vendor/some-model` | 同上 | 返回 `"anthropic"`（保持现有回退语义） |
| P5 | 非法 application model id（无 `/` 等） | 同上 | 返回 `"anthropic"`（不抛错） |
| P6 | 新增单元测试文件 | 执行 `npm run test:fast` | 全绿；推断相关用例全部通过 |
| P7 | Agent fixture 使用 `google/*` 或 `openrouter/*`（若已有或 SPEC 新增最小集成测） | agent turn 构造 LLM export | `normalizeForLlmExport` 的 protocol 参数与 P1/P2 一致 |

## 约束与依赖

- **前置能力：** [provider-model PRD](../../../provider-model/prd.md) — 内置 seed、应用模型 id 格式、protocol 枚举已定义并实现。
- **迭代位置：** `core-explore-remediation` Phase 1（P0 正确性）；与 VFS、compaction 等并列，可在 CI 全绿后实施。
- **关联代码：** `seed-builtin-providers.ts`、`provider.service.ts`（`BUILTIN_IDS`）、`agent-runner.ts`、`infer-llm-protocol-from-model-id.ts`。
- **文档后续：** 本 PRD 确认后编写 [spec.md](./spec.md)，再实施代码修改。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 硬编码 map 长期漂移 | 若仅 patch map，未来新增内置 provider 可能再次遗漏；SPEC 需选定「共享常量」或「仓储解析」策略 |
| unknown 回退掩盖错误 | 非内置自定义 provider id 仍回退 `anthropic`；本迭代不改语义，自定义 provider 在 export 路径仍可能误判（已知限制） |
| 测试深度 | 单元测试为必交付；agent 集成测视 fixture 成本可选，由 SPEC 决定是否新增最小用例 |
