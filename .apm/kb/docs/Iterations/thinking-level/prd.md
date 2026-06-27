---
date: 2026-06-24
dependency:
  - Iterations/model-generation-params/prd.md
  - Iterations/provider-model/prd.md
---

# 思考强度档位（关 / 低 / 中 / 高）PRD

## 背景

Novel Master **已发布版本（`v1.2.7`）** 的已保存模型设置中 **无思考（reasoning）配置**；用户无法在产品侧控制是否启用扩展思考。

`model-generation-params` 迭代已在 **未发版的 `main`** 上落地 schema v2（`internal` / `generation` 分层）、三协议 adapter 接线，以及模型设置页的 **思考开/关** Switch。该 Switch **尚未对用户发布**，可在实现层直接调整为更贴合需求的形态。

用户希望将思考配置 **统一为四档：关闭 / 低 / 中 / 高**，不向用户暴露思考 token 预算等高级参数；各服务商协议差异由系统在内部 preset 映射处理。

本迭代在 **已保存模型 → 生成参数** 域，将思考从 boolean 开关升级为 **档位选择**，并替换未发布的 Switch UI。与 `v1.2.7` 的兼容基线不变：**默认关闭，行为与现网一致**。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 统一产品语义 | 每个已保存模型可设置 **关 / 低 / 中 / 高** 四档之一；默认 **关** |
| 生效可验证 | 非「关」档位且模型支持 reasoning 时，Agent/模型请求启用对应强度的思考；流式与历史可呈现思考内容 |
| 简单可理解 | 用户 **无需** 理解 protocol、budget、`reasoning_effort` 等术语；无自定义预算输入 |
| 双端一致 | Desktop / Mobile 同一模型显示相同档位；保存后持久化并在下次请求生效 |
| 兼容已发布版 | 自 `v1.2.7` 升级且未改模型设置的用户：**零行为变化**（视为「关」） |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 配置者 | 为 Claude / GPT reasoning / Gemini 等模型选「中」或「高」，在复杂创作任务中获得更深推理，简单对话用「关」或「低」省 token |
| 日常用户 | 不修改设置时与 `v1.2.7` 相同；随时在模型设置页切换档位 |
| 调试者 | 同一模型对比关 / 低 / 中 / 高 的输出质量与延迟差异 |
| 维护者 | 新增协议或模型时，仅需维护内部 preset 表，不增加新的产品配置项 |

## 范围

### 包含范围

1. **模型配置 — 思考档位**
   - 在服务商 → 已保存模型设置页的 **生成参数** 区域，将「思考」从 Switch 改为 **关 / 低 / 中 / 高** 四选一（分段控件或等效单选）。
   - 默认：**关**（`v1.2.7` 读入、字段缺失均视为关）。
   - **关**：不向 LLM 请求写入任何 thinking / reasoning 字段，与 `v1.2.7` 一致。
   - **低 / 中 / 高**：按服务商协议映射到内部 preset（如 OpenAI `reasoning_effort`、Gemini `thinkingLevel` / `thinkingBudget`、Anthropic `budget_tokens`）；**用户不可编辑预算数字**。

2. **与 `model-generation-params` 的关系**
   - **保留**：schema v2 `internal` / `generation` 分层、三协议 adapter、`ModelRequestService` 接 thinking、`LlmChatRequest.thinking` 运行时类型。
   - **替换**：持久化形态由 `thinking: { enabled, params? }` 改为 **`generation.thinkingLevel`**（枚举）；未发布 Switch UI 改为四档控件。

3. **三协议**
   - 对已保存模型所属 protocol（`openai` / `anthropic` / `gemini`）分别映射；用户只操作统一四档。
   - 不支持 reasoning 的模型：控件禁用或仅可选「关」，并附简短说明。

4. **配置入口**
   - Desktop：`ModelSamplingView`（模型采样/设置页）。
   - Mobile：`ModelSamplingScreen`。
   - 配置随已保存模型 id 持久化；工作区切换模型后使用各自档位。

5. **与 Agent 的关系**
   - 思考档位 **以实际请求的已保存模型** 为准；不按 Agent、项目、会话单独覆盖（本迭代不做）。

### 不包含范围

- 用户自定义思考 token 预算、numeric effort、Claude adaptive thinking 专项 UI
- 按 Agent / 项目 / 会话覆盖思考档位
- 修改响应侧 thinking 块展示、transcript 存储格式
- CLI `nm provider model` 完整 parity（可 follow-up）
- 为非已保存模型配置思考
- OpenAI 兼容代理厂商差异的穷举文档（实现覆盖内置 seed 服务商；失败可理解即可）

## 核心需求

1. **默认关、兼容 `v1.2.7`**：未配置或「关」时请求与输出与已发布版无差异。
2. **四档持久化**：每个已保存模型独立保存 `thinkingLevel`（`off` | `low` | `medium` | `high`）。
3. **统一产品语义**：用户只面对关 / 低 / 中 / 高；系统按协议映射，不落盘 wire 细节。
4. **生成参数分区不变**：内部预算（上下文、计数）与生成参数（采样、思考档位）在设置页可区分。
5. **双端一致**：Desktop / Mobile 同一模型档位一致。
6. **未发布实现可原地重写**：因 Switch 未发布，允许在 `main` / 功能分支上直接改 schema 与 UI，**无需**面向真实用户的 thinking 专项迁移。

## 验收标准

### 默认与兼容（相对 `v1.2.7`）

- **Given** 用户自 `v1.2.7` 升级且从未修改该模型设置  
  **When** 发起 Agent 对话  
  **Then** 行为与 `v1.2.7` **一致**（无 thinking 请求字段、无回归）。

- **Given** 用户将思考设为 **关** 并保存  
  **When** 使用该模型请求  
  **Then** 与 `v1.2.7` 一致。

### 档位生效

- **Given** 用户为某 OpenAI reasoning 已保存模型设为 **高** 并保存  
  **When** 完成一次 Agent 往返  
  **Then** 请求含高强度 reasoning 配置（相对「关」可区分）；思考类输出可呈现（与现网展示能力一致）。

- **Given** 用户为某 Anthropic 已保存模型设为 **中** 并保存  
  **When** 完成一次 Agent 往返  
  **Then** 请求含 thinking 配置且 `budget_tokens` 小于有效 `max_tokens`；思考输出可呈现。

- **Given** 用户为某 Gemini 已保存模型设为 **低** 并保存  
  **When** 完成一次 Agent 往返  
  **Then** 请求含对应 thinking 配置；思考输出可呈现。

- **Given** 用户从 **高** 改回 **关**  
  **When** 再次请求  
  **Then** 无 thinking wire 字段。

### 持久化与双端

- **Given** 用户在 Desktop 将某模型设为 **中**  
  **When** 用户在 Mobile 打开同一已保存模型设置  
  **Then** 显示 **中**。

- **Given** 用户修改档位并保存  
  **When** 重启应用后打开该模型设置  
  **Then** 档位与保存时一致。

### 不支持 reasoning 的模型

- **Given** 某已保存模型不支持 reasoning  
  **When** 用户打开模型设置  
  **Then** 思考档位为 **关** 或控件禁用，并有可理解说明（非误导性「高」可选）。

- **Given** 不支持组合被误设为非关（仅开发/异常数据）  
  **When** 发起请求  
  **Then** 用户收到 **可理解** 错误提示（非挂起、非静默失败）。

### 生成参数分区

- **Given** 用户打开已保存模型设置页  
  **When** 查看页面结构  
  **Then** 可区分「内部预算」与「生成参数（采样、思考档位）」；思考档位位于生成参数区域。

## 约束与依赖

- 依赖 `model-generation-params` 已落地的 v2 框架与 adapter 接线（`main` 未发版部分）。
- 依赖 `provider-model` 已保存模型与 `ModelRequestService` 调用链。
- 与 `project-agent-config`、desktop polish **无** 功能依赖。

## 非功能需求（业务/体验）

- 档位文案统一为：**关闭 / 低 / 中 / 高**（或「关」与三档强度，双端一致即可）。
- 「关」不增加可感知延迟或额外 token；高档位允许更慢、更多 token（用户预期内）。
- 保存成功有明确反馈（与现网模型设置一致）。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 协议差异 | 部分 OpenAI 兼容代理不支持 `reasoning_effort: low` 等；失败应可理解 |
| Anthropic 无官方 low/medium/high | 产品四档映射为 **内部 budget 常数**，非厂商 API 枚举 |
| 未发布 dev 数据 | 本地若存在 `thinking.enabled` 形态 JSON，实现可选用 dev-only 映射（`true→medium`）；**无** 面向 `v1.2.7` 用户的迁移义务 |
