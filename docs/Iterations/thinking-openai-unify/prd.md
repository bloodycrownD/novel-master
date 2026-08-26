---
date: 2026-08-25
dependency:
  - Iterations/thinking-level/prd.md
---

# 思考强度 openai 协议统一 PRD

## 背景

`thinking-level` 迭代已将思考强度统一为**关/低/中/高**四档（模型级设置）。openai 协议分支当前存在 **GLM 系列特判**：对 GLM-4.7/GLM-5* 型号额外发送 `thinking.type` 与 `enable_thinking` 字段。

对照智谱官方 OpenAPI（`docs/issues/tmp`）核实后发现该特判与官方口径有偏差：

- 官方 schema 中**不存在** `enable_thinking` 字段（出处不明）；
- GLM-4.5/4.6 不在特判名单内，用户选「关」时不会发送关闭字段，而智谱默认开启——**关不掉**；
- `reasoning_effort` 的档位语义在 GLM-5.2/5.3 上有映射失真（5.2 会把低档拉高、5.3 不支持中档）。

用户拍板：**保留四档设计不变；openai 协议下不做 GLM 特殊处理，统一只发 `reasoning_effort`**。协议差异交给服务商的 OpenAI 兼容层自行处理。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 字段统一 | openai 协议下所有模型、所有档位仅发送 `reasoning_effort` 一个思考字段；`thinking`/`enable_thinking` 字段不再出现 |
| 行为可预期 | 「关」档不发送任何思考字段（含 GLM 全系型号）；档位取值仍为 low/medium/high |
| 其他协议零回归 | anthropic / gemini 分支请求体与现状完全一致 |
| 测试同步 | GLM 特判相关测试移除或改写为统一行为断言，全量通过 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| GLM 用户 | 在模型采样页选择关/低/中/高，请求行为与任何其他 openai 协议模型一致，无需理解特例 |
| 维护者 | openai 协议思考字段只有一条路径，新增 GLM 型号零成本 |

## 范围
### 包含范围
- openai 协议思考字段统一为 `reasoning_effort`（关档不发送）
- 移除 GLM 型号特判及其附带字段（`thinking.type`、`enable_thinking`）
- 相关测试与文档同步

### 不包含范围
- anthropic / gemini 协议分支（保持现状）
- openai 协议的**模型能力门控**（非推理模型收到 `reasoning_effort` 可能被服务商拒绝的问题，见风险项）
- 思考档位取值域调整（不做 GLM-5.3 的 max 档等扩展）
- anthropic 新模型 `thinking.type:"enabled"` 将返回 400 的前瞻适配（独立议题，另行立项）

## 核心需求（3-7 条）

1. **统一字段**：openai 协议下，档位为低/中/高时请求体携带 `reasoning_effort`（值为档位名）；档位为关时不携带任何思考字段。
2. **移除特判**：不再按模型名识别 GLM 系列发送差异化字段；GLM 型号与其它 openai 协议模型行为完全一致。
3. **双端一致**：模型采样页的思考强度选择器与档位语义不变，用户无感知。
4. **回归保障**：anthropic（budget_tokens 钳制逻辑）与 gemini（thinkingConfig 分流逻辑）请求体与现状一致。

## 验收标准

- Given 任一 openai 协议模型（含 glm-4.7、glm-5.x、gpt-* 等）且档位为「中」，When 发起请求，Then 请求体含 `reasoning_effort:"medium"` 且不含 `thinking`、`enable_thinking` 字段。
- Given 任一 openai 协议模型且档位为「关」，When 发起请求，Then 请求体不含任何思考相关字段。
- Given anthropic 模型档位「高」，When 发起请求，Then 请求体与现状基线一致（`thinking.budget_tokens` 钳制逻辑不变）。
- Given gemini 模型档位「低」，When 发起请求，Then 请求体与现状基线一致。
- Given 全量 core 测试，When 执行，Then 通过（GLM 特判用例已改写为统一行为断言）。

## 风险与待确认项

- **非推理模型 400 风险（遗留）**：openai 协议对不支持思考的模型（如 gpt-4o）发送 `reasoning_effort` 可能被服务商拒绝。本期不解决，用户可通过将这类模型档位设「关」规避；是否加模型能力门控待后续评估。
- GLM-5.2/5.3 的档位映射失真（服务商侧拉高档位、不支持 medium）在统一后依然存在，属于服务商兼容层行为，产品侧不感知。
