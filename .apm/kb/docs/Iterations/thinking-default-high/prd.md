---
date: 2026-06-28
dependency:
  - Iterations/thinking-level/prd.md
  - Iterations/model-generation-params/prd.md
---

# 思考强度默认「高」（新模型）PRD

## 背景

Novel Master 已在 `main` 落地思考强度四档（关 / 低 / 中 / 高），持久化字段为 `generation.thinkingLevel`，**新建已保存模型**与 **读盘缺字段** 的默认值均为 **关**（`defaultSavedModelSettings`、`saved-model-settings.schema` 的 Zod default）。

产品方向调整：**新加入的已保存模型** 默认使用 **高** 档思考，以更好适配复杂创作场景；**已有用户与已有已保存模型** 不因本次变更而改变行为。

与前置迭代 `thinking-level` 的关系：

- **保留** 四档 UI、preset 映射、`ModelRequestService` 运行时解析等能力。
- **仅变更**「首次创建已保存模型」时的默认档位；**不** 修改 v1.2.7 升级读入、缺字段回填、用户已显式保存的档位。

用户已确认：**从 v1.2.7 升级、settings_json 中从未写入 `thinkingLevel` 的已保存模型，仍视为「关」**，不因本次默认值调整变为「高」。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 新模型默认高 | 用户首次将某 vendor 模型 **保存为已保存模型** 后，`generation.thinkingLevel === "high"`，无需手动改档 |
| 老模型零变化 | 升级前已存在且用户未改设置的模型，请求行为与改前一致（仍为「关」或用户曾保存的档位） |
| 显式配置尊重 | 已持久化 `off` / `low` / `medium` / `high` 的模型，升级后 **原值不变** |
| 双端一致 | Desktop `ModelSamplingView`、Mobile `ModelSamplingScreen` 打开 **新保存模型** 时显示「高」 |
| 可验证 | 新建模型后首次 Agent 请求（在模型支持 reasoning 时）走「高」档 preset；老模型仍为「关」时不写入 thinking 字段 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 新用户 | 添加第一个 Claude / GPT reasoning / Gemini 模型后，无需进设置页即可以「高」思考强度创作 |
| 老用户 | 从 v1.2.7 升级，原有已保存模型继续「关」或自设档位，token 与延迟无意外上升 |
| 配置者 | 新模型默认「高」后，仍可在模型设置页改为关 / 低 / 中 |
| 维护者 | 默认值变更集中在「新建路径」，读盘兼容逻辑与 v1 映射保持独立 |

## 范围

### 包含范围

1. **新建已保存模型默认档位**
   - 通过 `ProviderModelService.save` / `create` 首次 `insert` 时，使用的 `defaultSavedModelSettings(vendorModelId)` 中 `thinkingLevel` 由 `"off"` 改为 `"high"`。
   - 新模型首次持久化到 DB 的 JSON 含 `"thinkingLevel": "high"`。

2. **读盘与升级兼容（老用户保持原设置）**
   - **v1 文档**读入：继续映射为 `thinkingLevel: "off"`（不变）。
   - **v2 文档缺 `thinkingLevel` 字段**：Zod 读盘 default 继续为 `"off"`（**不**改为 `"high"`）。
   - **已持久化任意档位**的 v2 文档：原样读入，不做批量迁移。

3. **UI 展示**
   - 模型设置页从服务端加载已保存设置后展示真实档位；新模型加载后应显示「高」。
   - 「恢复默认采样参数」现有行为 **不** 强制重置思考档位（仅上下文/采样相关）；本迭代 **不** 扩展该按钮覆盖 thinking。

4. **文档与测试契约**
   - 更新与 `defaultSavedModelSettings` 相关的测试期望（新建默认应为 `high`）。
   - 保留「v1 / 缺字段 → off」类测试不变。

### 不包含范围

- 修改 `thinking-level-presets` 各档 preset 数值或三协议映射逻辑
- 修复 Anthropic 默认 `max_tokens` 下 low/medium/high 钳制相同的问题（另开迭代）
- 按模型能力禁用/隐藏「高」档（`capabilities.reasoning`）
- 对 **已有** 已保存模型批量迁移为「高」
- 修改 Agent 级默认或项目级默认（仍跟随 **已保存模型** settings）
- 变更 GLM 默认 thinking 关断等特殊协议逻辑

## 核心需求

1. **仅新建路径默认高**：只有「首次 insert 已保存模型」使用 `defaultSavedModelSettings` 的 `high`；读盘缺省逻辑与 v1 映射 **不得** 改为 `high`。
2. **老数据只读不改**：升级、启动、打开设置页 **不** 写回或迁移已有 `thinkingLevel`。
3. **用户可覆盖**：新模型默认「高」后，用户保存为其他档位即持久化新值，后续请求跟用户选择。
4. **行为可预期**：「关」仍不向 LLM 写入 thinking；「高」仍走现有 preset（与 `thinking-level` 一致）。
5. **双端与 Core 单源**：默认值以 Core `defaultSavedModelSettings` 为准，Desktop/Mobile 不另设冲突默认。

## 验收标准

### 新建模型

- **Given** 用户在某 Provider 下 **首次** 保存 vendor 模型 `M`（此前无对应 saved row）  
  **When** 保存完成并读取 `settings_json`  
  **Then** `generation.thinkingLevel === "high"`。

- **Given** 上述新模型，用户 **未** 修改思考档位  
  **When** 使用该模型发起 Agent 请求且模型支持 reasoning  
  **Then** 运行时解析为「高」档 preset（与手动选「高」一致）。

- **Given** 新模型已在设置页显示「高」  
  **When** 用户改为「关」并保存  
  **Then** 持久化为 `"off"`，后续请求不写入 thinking 字段。

### 老用户 / 已有模型

- **Given** 升级前已存在的已保存模型，settings 为 v1 或无 `thinkingLevel` 的 v2  
  **When** 升级后读盘  
  **Then** 内存中 `thinkingLevel === "off"`（与改前一致）。

- **Given** 已持久化 `thinkingLevel: "off"` 的模型  
  **When** 应用升级并发起请求  
  **Then** 仍为「关」，**不** 自动变为「高」。

- **Given** 已持久化 `thinkingLevel: "low" | "medium"` 的模型  
  **When** 升级后读盘与请求  
  **Then** 档位与改前一致。

### UI

- **Given** Desktop 或 Mobile 打开 **新创建** 已保存模型的设置页  
  **When** 加载完成  
  **Then** 思考档位控件显示 **高**。

- **Given** 打开 **升级前已有** 且从未配置 thinking 的模型设置页  
  **When** 加载完成  
  **Then** 思考档位控件显示 **关**。

### 回归

- **Given** 用户点击「恢复默认采样参数」  
  **When** 操作完成  
  **Then** 思考档位 **不变**（除非产品后续单独改该按钮语义）。

## 约束与依赖

- 依赖 `thinking-level` 已落地的四档持久化与请求链路。
- 新模型默认「高」可能增加 token 消耗与首包延迟；用户可在设置页改回「关」。
- 不支持 reasoning 的模型：「高」档可能无可见效果或请求失败；本迭代 **不** 新增能力检测，与 `thinking-level` 首版一致。

## 风险与待确认项

| 风险 | 说明 |
|------|------|
| 成本感知 | 新用户未意识到默认「高」可能多耗 token；可在设置页保留档位说明（非本迭代强制） |
| 非 reasoning 模型 | 默认「高」对 gpt-4o 等模型可能无效或被网关忽略；行为与手动选「高」相同 |
| PRD 与 thinking-level 默认表述不一致 | 本 PRD ** supersede ** 仅「新建模型默认」条款；`thinking-level` 中「默认关」仍适用于读盘/升级 |

## 非功能需求（业务/体验）

- 变更对用户可见差异应限于 **新添加的模型**；老用户无强制迁移步骤。
- 默认值调整应可透过单测与新建模型验收用例判定，不依赖手工全库扫描。
