# Agent 与模型解耦 PRD

## 背景

当前 **AgentDefinition** 将 `model`（含 `applicationModelId` 与 `params`）作为必填字段，与 prompts、runtime 绑在同一份 YAML 中。实际上：

- **用哪个模型** 已由工作区体系管理：`nm model use` 写入的当前模型（PersistentState）、CLI `--modelId`、以及服务商侧的已保存模型（`providerId/vendorModelId` → `applicationModelId`）。
- Agent 再嵌套一整块 `model` 配置造成 **重复、冗余**，且与「Agent 管行为、模型管能力」的职责划分不符。
- `model.params`（temperature 等）仅存在于 Agent 文件中，应归属 **服务商-已保存模型** 域，由 Core 持久化、CLI/App 配置，执行时由 `ModelRequestService` 自动合并。

**前置依赖**：agent-system、agent-config-and-compaction、global-compaction-policy、provider-model 已落地。

本迭代目标：Agent 与模型 **选择**、模型 **采样档案** 解耦；执行时宿主解析 `applicationModelId` 并注入 Runner；采样从已保存模型档案读取。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| Agent 定义瘦身 | `AgentDefinition` **不再包含** `model`；可选 `preferredModelId` |
| 执行边界清晰 | `AgentRunner.run` 必须携带已解析的 `applicationModelId`（Core 不读 DB/state） |
| 解析链统一 | **`--modelId` → `preferredModelId` → `nm model use` → 报错**（不用 provider.`defaultModelId`） |
| 采样归模型域 | 已保存模型可配置 sampling；Core Service + CLI 可读写；`nm model request` / Agent 执行自动带上 |
| 示例与测试 | `examples/agent-writer.yaml` 无 `model:`；Core/CLI 单测与 e2e **全绿**；CLI 采样子命令有可复现验收记录 |
| 移动原型对齐 | `examples/mobile/` Agent 无 model/温度；**单例**工作区当前模型；聊天抽屉与全局设置双入口；模型档案可开关 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Agent 作者 | 只编辑 prompts、runtime；默认跟随工作区当前模型 |
| CLI 用户 | 临时 `--modelId` 覆盖一切；平时用 `nm model use` |
| 模型调参 | `nm provider model sampling set` 为某已保存模型设 temperature；Agent 跑时自动生效 |
| 摘要 Agent | 可选 `preferredModelId`；无 flag 时用 pin，否则跟工作区当前模型 |
| App 原型用户 | 聊天页左侧抽屉或「我的」改 **同一** 工作区当前模型；per-model 采样在模型配置侧 |

## 范围

### 包含范围

#### 1. AgentDefinition（Core）

- 移除 `model: { applicationModelId, params? }`。
- 新增可选 **`preferredModelId`**（须为已保存的 `applicationModelId`）。
- 含顶层 `model:` 的旧 YAML **校验失败**（breaking）。
- `AgentRunOptions` 增加 **`applicationModelId`**（语义必填）；Runner / Compaction 摘要 **不再**读 `definition.model`。
- `AgentRunOptions` 或 `ModelRequestService` 调用链：对给定 `applicationModelId` **自动加载**该已保存模型的 sampling 档案（若存在且 enabled）；无档案则用协议/API 默认。

#### 2. 模型采样档案（Core + CLI）

- **Core** 提供已保存模型维度的采样读写能力（具体表结构/KKV 由 SPEC 定），例如：
  - 读取：`getModelSampling(applicationModelId)` → `ModelSamplingParams | null`（及是否启用）
  - 写入：`setModelSampling` / `clearModelSampling`
  - 执行：`ModelRequestService.request` 在宿主未显式传 `sampling` 时合并档案。
- **CLI** 新增子命令（命名 SPEC 细化，示例）：
  - `nm provider model sampling show --providerId … --vendorModelId …`
  - `nm provider model sampling set …`（支持自文件或键值，须能设 temperature 等）
  - `nm provider model sampling clear …`
- **验证**：CLI 测试或 `apm` 用例文档可判定 set → `nm model request` / agent run 行为携带对应 sampling（可与 mock 适配器断言）。

#### 3. 宿主解析（CLI）

- 统一 **`resolveApplicationModelId`**：`--modelId` → `definition.preferredModelId` → `state.getCurrentModelId()` → 报错。
- 修正「有 `--agent-config` 则不读 state」。
- `buildMinimalDefinition` 等不再构造 `model` 块。

#### 4. 压缩

- `abstract.type: agent`：摘要 Agent 使用 **同一解析链**（宿主传入的 session 上下文 + 摘要 Agent 的 `preferredModelId`）；采样来自 **摘要所用 applicationModelId** 的模型档案，非 Agent YAML。

#### 5. 示例与仓库内样例

- 更新 `examples/agent-writer.yaml`、registry Agent 样例。

#### 6. 移动原型 `examples/mobile/`（本期必做）

| 项 | 要求 |
|----|------|
| Agent 数据与编辑器 | 内置/mock Agent **移除** `model`、`params`、温度等字段；保留 prompts、runtime、compact 相关（压缩已全局则按现网）；Agent 列表/编辑 **不再**展示模型与采样表单项 |
| **工作区当前模型**（单一配置） | 全应用仅一份「当前模型」状态（mock 等价 `nm model use` / `PersistentState.currentModelId`），与 Agent 配置分离；**不是**按会话/按页面各存一份 |
| 模型采样 | 在 **模型配置** 侧（非 Agent）支持 temperature 等；提供 **开关**（启用/禁用自定义采样，关则用 API 默认） |
| 聊天页会话操作抽屉 `#sessionActionsDrawer` | 进入会话后顶栏 ☰ 打开：**切换模型**（当前模型展示 + picker，写入工作区 current model）+ **真实提示词** + **会话日志**（模型切换是会话操作之一） |
| Agent 编辑器 | **启用 Agent 专属模型** 开关；开启后选服务商/模型（映射 `preferredModelId`）；**不含**温度等采样（采样在服务商-模型配置） |
| 全局「我的」/设置 | **当前模型** 配置项与聊天页抽屉 **同一字段**——仅为第二个入口；任一处修改，另一处立即一致 |
| 会话页 | **不**在本期增加独立的模型切换入口（会话列表/会话详情不设第二套 current model） |

### 不包含范围

| 项 | 说明 |
|----|------|
| Provider `defaultModelId` 参与 Agent 解析 | 仍不作为 Agent 执行回退；「默认模型」指工作区 current model（state / App 全局设置） |
| 旧 YAML 自动迁移 | 人工更新自有配置与示例 |
| RN 正式 App | 仅 `examples/mobile` 原型 |
| 完整 Agent 执行接真 API | 原型仍以 mock 为主，但结构与文案须与 PRD 一致 |

## 核心需求

1. **Agent 可无模型段**：YAML 仅 `name`、`prompts`、`runtime`（及可选 `preferredModelId`）可校验、可 `nm agent run`。
2. **解析优先级**：**`--modelId` 最高** → `preferredModelId` → `nm model use` → 失败并提示。
3. **执行注入 model id**：Core Runner 只认 `AgentRunOptions.applicationModelId`。
4. **采样在模型域**：Agent **不得**含 `params`；已保存模型通过 Core Service 存 sampling；CLI 可配置并验证。
5. **请求自动带采样**：`ModelRequestService`（及 AgentRunner）对已启用档案的模型合并 sampling，无需 Agent 传递。
6. **压缩摘要**：registry 摘要 Agent 同解析链 + 所用 model id 的采样档案。
7. **移动原型**：Agent UI 去 model；**工作区当前模型**单例；聊天页左侧抽屉与全局设置 **双入口改同一配置**；模型采样开关与表单在模型配置侧。

## 验收标准

### Agent 定义

- **Given** YAML 无 `model`、无 `params`，**When** 反序列化，**Then** 成功。
- **Given** YAML 含 `model:`，**When** 反序列化，**Then** 失败（可判定）。

### CLI 模型 id 解析

- **Given** Agent `preferredModelId: mock/test`，state 为 `zhipu/glm-4.6`，**When** `nm agent run --agent-config … --modelId zhipu/glm-4.6`，**Then** 使用 `zhipu/glm-4.6`（**flag 优先**）。
- **Given** 无 `--modelId`，Agent 有 `preferredModelId: mock/test`，**When** run，**Then** 使用 `mock/test`。
- **Given** 无 flag、无 `preferredModelId`，已 `nm model use zhipu/glm-4.6`，**When** run，**Then** 使用 `zhipu/glm-4.6`。
- **Given** 三者皆无，**When** run，**Then** 失败并提示 `nm model use`。

### CLI 模型采样

- **Given** 已对 `zhipu/glm-4.6` 执行 `sampling set`（如 temperature=0.3），**When** `nm model request` 或 agent run 使用该 id，**Then** 适配器/mock 收到的 body 含对应采样（或单测断言）。
- **Given** 已 `sampling clear` 或关闭 enable，**When** 同上，**Then** 不传自定义 sampling（API 默认）。

### 运行时（Core）

- **Given** `AgentRunner.run({ applicationModelId })`，**When** 该模型有 enabled 采样档案，**Then** `ModelRequestService.request` 带 `sampling`。
- **Given** 无档案，**When** run，**Then** 不崩溃，采样为默认。

### 压缩

- **Given** 摘要 Agent 有 `preferredModelId`，无 CLI flag，**When** 触发 agent 摘要，**Then** 使用 pin 的 id 及其采样档案。
- **Given** 无 pin，**When** 触发且对话 session 已解析为 `zhipu/glm-4.6`，**Then** 摘要使用同一 id。

### 移动原型

- **Given** 打开 Agent 编辑，**When** 查看表单，**Then** 无 model id / 温度 / top_p 字段。
- **Given** 工作区当前模型为 `zhipu/glm-4.6`，**When** 在聊天页左侧抽屉点「切换模型」并选 `mock/test`，**Then** 抽屉展示、`#chatPage` 顶栏（若有）及全局设置中的当前模型 **均为** `mock/test`。
- **Given** 上例已改为 `mock/test`，**When** 在全局设置将当前模型改回 `zhipu/glm-4.6`，**Then** 聊天页左侧抽屉展示的当前模型 **同步** 为 `zhipu/glm-4.6`（同一 mock 状态，无第二份配置）。
- **Given** 模型配置中关闭「自定义采样」开关，**When** 保存，**Then** 该模型不再应用 temperature 等（mock 行为与文案一致）。

### 回归

- **Given** 改编后的 Core/CLI 测试，**When** 标准 test 命令，**Then** 全绿。

## 约束与依赖

- 依赖 **provider-model** 的已保存模型与 `ModelRequestService`；采样类型复用现有 `ModelSamplingParams`（协议判别），存储位置由 SPEC 定（如扩展 `llm_saved_model` 或 KKV）。
- **Core 必须**暴露宿主可调用的 Service 方法（读/写/清采样档案），CLI 与未来 App 仅调用 Service，不直接拼 SQL。
- 移动原型与 CLI 语义对齐：**工作区当前模型** = `nm model use` / `getCurrentModelId()`；聊天页左侧抽屉与全局设置 **仅多入口读写同一值**，不得另建 session 级 current model。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 采样档案存储形态 | PRD 不限定表 vs KKV；SPEC 需与迁移策略一并给出 |
| 多会话与当前模型 | 所有会话共用 **同一** 工作区当前模型；本期不在会话上挂独立 model id |
| `preferredModelId` 与全局默认同时存在 | 已明确 flag > pin > state |

---

**生成路径**：`.apm/kb/docs/Iterations/agent-model-decouple/prd.md`

**迭代文件夹名**：`agent-model-decouple`（已确认）。

请确认更新后的 PRD；确认后进入 SPEC/实现（本文件不包含接口设计与任务拆分）。
