# 模型上下文配置与 Provider 存储精简 PRD

> **边界**：产品需求（PRD）。技术方案见 [spec.md](./spec.md)。  
> **性质**：**破坏性更新** — 不保留旧存储路径、不迁移 suggestion/采样 KKV 存量、不要求向后兼容旧配置形态。

## 背景

1. **上下文预算**：顶栏/压缩运行时查 `context-window-map`，用户不可纠错；与 `settings_json` 应有配置分裂。
2. **压缩条件**：`tokenThreshold` / `-1` 冗余；应改为 `tokenRatio` × 模型 `contextWindowTokens`。
3. **存储债**：
   - `llm_model_suggestion` SQLite 表（应删除）
   - `nm-model-sampling` KKV（应删除 module）
   - 采样与 context 未统一在 `llm_saved_model`

## 目标

| 目标 | 成功指标 |
|------|----------|
| 配置唯一源 | context + sampling 均在 `llm_saved_model.settings_json` |
| 遗留清零 | `llm_model_suggestion` 表删除；`nm-model-sampling` KKV **全部 key 删除**；相关代码 **物理删除** |
| Suggestion 终态 | 仅 `nm-model-suggestions` KKV（新 module，替代旧表） |
| 压缩 v3 | 无 `tokenThreshold`；读写仅 v3（v2 读入一次性迁移后拒绝） |
| 运行时 | 顶栏/压缩 **不**调用 `resolveContextWindowTokens` 作分母 |
| NMTP | 计数分子不变 |

## 范围（必须做）

### 1. `settings_json` 统一 per-model 配置

- `contextWindowTokens`：save/create 由 map 种子（默认 128k）
- `sampling`：`{ enabled, params? }`，默认 `{ enabled: false }`
- 存量 saved model：bootstrap backfill 默认 settings
- **不迁移** `nm-model-sampling` 数据

### 2. 顶栏与压缩

- 分母 = `settings.contextWindowTokens`
- 未 save / 无行：无 %；token 压缩不触发；**不回退 map**

### 3. 压缩条件 v3

- 删除 `tokenThreshold`
- 保留 `tokenRatio`（默认 **0.8**）+ `visibleFloor`（OR）
- `schemaVersion: 3` only（新写入）；v2 读入迁移一次后拒绝

### 4. 删除 `llm_model_suggestion` + 清理 KKV

- `DROP TABLE llm_model_suggestion`
- bootstrap **强制** `DELETE` `nm-model-sampling` 下 **全部** key
- 新 suggestion 缓存：**仅** `nm-model-suggestions` KKV
- **不**迁移旧 suggestion 表数据；升级后用户 **必须** 重新 `fetch`

### 5. 删除采样 KKV 链路

- 删除 `ModelSamplingProfileService` 及全部相关文件
- `model-request` / Mobile / CLI 改读 `settings_json.sampling`
- Runtime 移除 `modelSamplingProfiles`

### 6. 语义与文档

- 修正 `max_tokens` 与 context window 混淆注释
- 更新 ARCHITECTURE.md、feature-inventory、Breaking 发布说明

## 不包含

- NMTP 计数规则变更
- 扩展 context-window-map 覆盖
- 事件配置 / hide-message 变更

## 破坏性变更（用户可见）

| 变更 | 影响 |
|------|------|
| 删除 `llm_model_suggestion` | 升级后须重新 `fetch` |
| 清空 `nm-model-sampling` | 自定义采样丢失，须在模型设置重配 |
| 删除 `tokenThreshold` | 旧 compaction YAML 须改为 v3 |
| 删除 `modelSamplingProfiles` API | 集成方改 `providerModels.updateSettings` |
| 删除 `resolveContextWindowTokensOrDefault` | 分母必须来自 saved settings |

## 验收标准

### Settings

- **Given** `save openai/claude-3-5-sonnet`  
  **Then** `settings_json.contextWindowTokens = 200_000`

- **Given** save 无 map 命中  
  **Then** `contextWindowTokens = 128_000`

- **Given** 用户改 `contextWindowTokens` 为 64k  
  **Then** 顶栏与压缩分母均为 64k，不读 map

### 遗留清零

- **Given** bootstrap 完成  
  **Then** `nm-model-sampling` key 数为 0；SQLite 无 `llm_model_suggestion` 表

- **Given** `rg nm-model-sampling` / `ModelSamplingProfile` / `tokenThreshold`（见 SPEC 门禁）  
  **Then** 零命中（迭代文档目录除外）

### 压缩 v3

- **Given** `tokenRatio: 0.8`，`contextWindowTokens: 100_000`，prompt 85_001 tokens  
  **Then** 触发

- **Given** 提交 v2 compaction JSON（含 `tokenThreshold`）  
  **Then** `set` **拒绝**

### Suggestion

- **Given** `fetch` 后 `suggest list`  
  **Then** 数据来自 `nm-model-suggestions` KKV

- **Given** `provider delete`  
  **Then** 清除对应 suggestion KKV key

### 回归

- `countPromptLlmInput` 数值不变
- `npm test` 全绿

## 数据终态

| 数据 | 存储 |
|------|------|
| Saved model 配置 | `llm_saved_model.settings_json` |
| Fetch 缓存 | `nm-model-suggestions` |
| 压缩条件 | `nm-compaction-conditions` |
| 工作区模型指针 | `nm-workspace-state` |

**不存在**：`llm_model_suggestion`、`nm-model-sampling`。

---

`.apm/kb/docs/Iterations/model-context-settings/prd.md`
