---
date: 2026-07-04
dependency:
  - Iterations/provider-model/prd.md
  - Iterations/agent-model-decouple/prd.md
  - Iterations/model-context-settings/spec.md
---

# saved-model-identity PRD

## 背景

Novel Master 的「已保存模型」当前以 `providerId/vendorModelId`（applicationModelId）同时承担 **存储主键、执行句柄、UI 展示** 三种角色。其后果包括：

- 同一厂商模型名（如 `zhipu/glm-4.6`）**只能保存一条**配置，无法并列「思考开 / 思考关」「写作 / 代码」等命名预设。
- 虽有 `displayName` 字段，但语义混乱（与 path 混用），Picker、工作区摘要、Agent hint 仍大量暴露 technical id，用户自定义别名价值低。
- 产品已具备 per-model 的采样、上下文、思考强度（`settings_json`），但粒度被 **vendor 级唯一性** 锁死。

用户已确认：迁移后 `currentModelId` 与 Agent `model` pin **一次性全量改为内部 UUID**；并扩展 bootstrap 政策，以 **正式登记的 schema migration** 承载表结构变更。

本迭代引入 **预设实例**（内部 UUID）与 **命名分离**：

| 概念 | 含义 |
|------|------|
| **`modelName`** | **持久化**、用户可自由起名（如 `快速回复`、`glm-4.6`）；添加/保存后可编辑 |
| **`displayName`** | **不落库**、运行时拼接：`{providerId}/{modelName}`；UI/CLI 默认主展示 |

`vendorModelId` 仍仅供厂商 API，不可改。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| **预设实例化** | 同一 `providerId + vendorModelId` 可保存 **≥2 条**独立预设（不同 settings / modelName） |
| **命名与展示分离** | UI 主展示 **displayName**（= provider/modelName）；technical id 不在默认列表主文案中出现 |
| **指针 UUID 化** | 升级后 `currentModelId`、Agent `model` pin **100%** 为 saved model UUID |
| **可编辑 modelName** | 添加与保存后均可修改 **modelName**（Mobile/Desktop/CLI 至少一条路径）；**不可**通过改名切换 provider 或 vendor |
| **可靠升级** | 既有数据库自动 migration；失败有明确错误与回滚 |
| **bootstrap 可演进** | migration 登记机制 + saved model 表重建 migration |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 日常聊天用户 | 同 GLM 保存「快速回复」「深度推理」两条预设，Picker 显示 `zhipu/快速回复` 与 `zhipu/深度推理` |
| 创作用户 | 未改 modelName 时仍显示 `zhipu/glm-4.6`（与 today 视觉一致）；改 modelName 后各处同步 |
| 配置管理员 | fetch 后多次 save 同 vendor，每次 **新建预设**（不同 modelName / settings） |
| CLI 用户 | `model list/current` 输出 displayName；脚本用 UUID 选中 |
| 升级用户 | 升级后旧库自动迁移，指针仍指向正确预设 |

## 范围

### 包含范围

- 已保存模型 **内部 UUID**；`vendorModelId` 仍为 API model 字段
- 同 provider + 同 vendorModelId **多条** saved（不同 `settings_json` / **modelName**）
- DB 存 **`model_name`**（非 displayName）；默认 **modelName = vendorModelId** → displayName 默认 `{providerId}/{vendorModelId}`
- 添加/保存后可编辑 **modelName**（自由文本）；**displayName 仅派生，不可直接编辑**
- UI（Mobile + Desktop）：列表、Picker、工作区、Agent **主展示 displayName**；默认隐藏 UUID / vendorModelId
- 指针 UUID 化 + 一次性 migration
- Bootstrap schema migration 登记
- CLI / Core 与三端一致

### 不包含范围

- 修改 `providerId` 或 `vendorModelId`
- fetch 建议缓存格式重写
- 云同步跨版本协议
- 用 displayName 或 modelName 替代 UUID 作持久化指针
- Provider 实体的 `displayName`（与 saved model 无关）

## 核心需求

1. **预设实例**：同 vendor 再次 save → **新建**预设（非 upsert）。
2. **displayName 派生**：`displayName = formatSavedModelDisplayName(providerId, modelName)`；UI/CLI 默认读派生值，**不**持久化 displayName。
3. **modelName 可维护**：添加时可填 modelName（留空 → vendorModelId）；保存后可 **editSaved(savedModelId, modelName?)**。
4. **指针 UUID 化**：工作区 / Agent pin 持久化 UUID；migration 一次性改写 legacy path。
5. **settings per 预设**：采样、上下文、thinking 等仍 per 行 `settings_json`。
6. **Schema migration 登记**：禁止未登记 migrate 脚本。
7. **引用完整性**：删除被 pin 的预设须阻止或引导改选。

## 验收标准

### 预设与展示

- [ ] **A1** Given 已在 `zhipu` 下保存 `glm-4.6` 且 modelName=`快速`、thinking=off，When 再次 save 同 vendor 且 modelName=`深度`、thinking=high，Then **两条**预设，settings 独立。
- [ ] **A2** Given 两条预设 modelName 不同，When 打开 Picker，Then 主文案为 **displayName**（`zhipu/快速` 等），非 UUID 或裸 vendorModelId。
- [ ] **A3** Given 用户编辑 modelName 为 `写作专用`，When 保存后查看列表/Picker/聊天摘要，Then 显示 **`zhipu/写作专用`**；API 仍用 vendorModelId `glm-4.6`。
- [ ] **A4** Given 未自定义 modelName（默认 = vendorModelId），When 查看 UI，Then displayName 为 **`{provider}/{vendorModelId}`**，与当前 `applicationModelId` 视觉一致。

### 指针与迁移

- [ ] **B1** Given 升级前 `currentModelId = openai/gpt-4o` 且存在对应 saved 行，When 升级 bootstrap，Then `currentModelId` 变为 **UUID**，对话仍可用同一 settings。
- [ ] **B2** Given Agent YAML 含 `model: zhipu/glm-4.6`，When migration 完成，Then `model` 为 **UUID**。
- [ ] **B3** Given migration **成功**，When 检查 KKV / Agent registry，Then 无 legacy `provider/vendor` 指针。
- [ ] **B4** Given 未 save 的 legacy vendor path 被 pin，When migration，Then **fail-fast** 并回滚。

### CLI

- [ ] **C1** `nm model list` / `nm provider model list`：含 **displayName**（派生）、UUID、vendor 摘要。
- [ ] **C2** `nm model use --modelId <uuid>`；UUID only。
- [ ] **C3** `nm model current` 输出 **displayName**。
- [ ] **C4** `nm provider model edit --modelId <uuid> [--modelName …]`；**无** `--displayName`。

### Migration 与 bootstrap

- [ ] **D1** 旧 schema 首次 open → migration 登记 + 多预设表结构；二次 bootstrap 幂等。
- [ ] **D2** migration 失败 → 回滚 / 可重试；用户可见原因。
- [ ] **D3** db-backup 旧包 rebootstrap 同样跑 migration 链。

### 引用完整性

- [ ] **E1** 工作区 pin 的预设不可删（须先切换）。
- [ ] **E2** Agent pin 的预设不可删（须改选）。

## 约束与依赖

- 依赖 [provider-model](../provider-model/prd.md)：配置域、save 后才可 request；vendorModelId 不可 rename。
- 依赖 [agent-model-decouple](../agent-model-decouple/prd.md)：模型解析优先级（CLI flag → Agent pin → 工作区 current）。
- settings 结构以 [model-context-settings](../model-context-settings/spec.md) 为准。
- **命名**：saved model 用 **modelName** + 派生 displayName；Provider 实体的 `displayName`、fetch suggest 的 `displayName` **不受**本迭代派生规则影响。
- Mobile/Desktop/CLI 共用 Core bootstrap；migration **Core 单点**。

## 非功能需求（业务/体验）

- 升级无手动步骤。
- 同 provider 下 **modelName 可重复**（少见）；Picker 副标题展示 vendorModelId 区分。
- 发版说明：CLI `model use` 改 UUID；旧 `display_name` 列迁移为 `model_name`。

## 风险与待确认项

| 项 | 决策 |
|----|------|
| modelName 重复 | 允许；副标题展示 vendorModelId |
| 旧库 display_name 迁移 | 见 SPEC 推导规则 |
| Fetch 再 save 同 vendor | 新建预设 |
| CLI / provider model * | UUID only（迁移后） |
| 孤儿 legacy 指针 | migration fail-fast |
