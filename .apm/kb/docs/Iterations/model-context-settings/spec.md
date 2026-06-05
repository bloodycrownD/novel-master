# 模型上下文配置与 Provider 存储精简 技术规格（SPEC）

> **PRD**：[prd.md](./prd.md)  
> **性质**：**破坏性更新**（Breaking）。不保留旧存储读写路径、不保留兼容 shim、不保留孤儿 KKV key。  
> **不改变**：[nmtp/spec.md](../nmtp/spec.md) 计数口径。  
> **分支**：`feature/model-context-settings`

---

## 设计目标

1. **Per-model 配置唯一源**：`llm_saved_model.settings_json`（context window + sampling）。
2. **彻底删除遗留存储**：`llm_model_suggestion` 表、`nm-model-sampling` KKV module、相关 service/repository/测试 **物理删除**。
3. **Suggestion 新缓存**：仅 **`nm-model-suggestions`** KKV（替代 SQLite 表）；bootstrap **强制** DROP 旧表并 **强制** 清空旧 module。
4. **压缩 v3 only**：删除 `tokenThreshold` 及 v2 文档/schema 路径（读入时一次性迁移后仅 v3）。
5. **运行时零 map 分母**：顶栏/压缩只读 `settings.contextWindowTokens`；`resolveContextWindowTokensOrDefault` **删除**。

---

## 破坏性变更清单（必须全部完成）

| 删除项 | 要求 |
|--------|------|
| SQLite `llm_model_suggestion` | `DROP TABLE`；DDL/Repository/测试 **零残留** |
| KKV `nm-model-sampling` | bootstrap **删除 module 下全部 key**；代码 **零引用** |
| `ModelSamplingProfileService` 及 port/factory/测试 | **物理删除** |
| `domain/provider/model/model-sampling-profile*.ts` | **物理删除**（并入 `saved-model-settings`） |
| `SqliteModelSuggestionRepository` | **物理删除** |
| `token-threshold.trigger.ts` | **物理删除** → `token-ratio.trigger.ts` |
| `resolveContextWindowTokensOrDefault` | **物理删除** |
| `maxOutputTokensFromSampling` 误用注释/导出 | 修正或 **删除**（若无调用方） |
| Runtime `modelSamplingProfiles` | CLI/Mobile runtime **移除** |
| Compaction `tokenThreshold` / schema v2 写入 | **禁止**；仅 v3 |
| `provider-model.service` `clearProfile` KKV | **删除** |

**禁止**：`可选`、`noop`、`deprecated` 双路径、`@deprecated` 保留旧 API、孤儿 KKV 不清理。

---

## 存储分层（终态）

| 数据 | 介质 |
|------|------|
| Saved model 配置（context + sampling） | `llm_saved_model.settings_json` |
| Fetch 候选缓存 | KKV `nm-model-suggestions/{providerId}` |
| 全局压缩条件 | KKV `nm-compaction-conditions/policy` |
| 工作区指针 | KKV `nm-workspace-state` |

**不得存在**：`nm-model-sampling`、`llm_model_suggestion`、任何 `profile/` 采样 KKV key。

---

## 1. `SavedModelSettings`

```typescript
export interface SavedModelSamplingSettings {
  readonly enabled: boolean;
  readonly params?: ModelSamplingParams;
}

export interface SavedModelSettings {
  readonly schemaVersion: 1;
  readonly contextWindowTokens: number;
  readonly sampling: SavedModelSamplingSettings;
}

export interface SavedModel {
  readonly providerId: string;
  readonly vendorModelId: string;
  readonly displayName: string | null;
  readonly settings: SavedModelSettings;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}
```

```typescript
export function defaultSavedModelSettings(vendorModelId: string): SavedModelSettings {
  return {
    schemaVersion: 1,
    contextWindowTokens: seedContextWindowTokens(vendorModelId),
    sampling: { enabled: false },
  };
}
```

### DDL（`provider-schema.ts` 终态）

```sql
CREATE TABLE IF NOT EXISTS llm_provider ( ... );  -- 不变

CREATE TABLE IF NOT EXISTS llm_saved_model (
  provider_id TEXT NOT NULL,
  vendor_model_id TEXT NOT NULL,
  display_name TEXT,
  settings_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider_id, vendor_model_id),
  FOREIGN KEY (provider_id) REFERENCES llm_provider(id) ON DELETE CASCADE
);
```

**不得出现** `llm_model_suggestion` DDL。

---

## 2. Bootstrap 迁移（全部强制、同一事务）

在 `bootstrapNovelMaster` 内 **固定顺序**执行：

### 2.1 `migratePurgeNmModelSamplingKkv`

```typescript
const keys = await kkv.listKeys("nm-model-sampling");
for (const key of keys) {
  await kkv.delete("nm-model-sampling", key);
}
```

- 测试断言：迁移后 `listKeys("nm-model-sampling")` 长度为 **0**。

### 2.2 `migrateDropLlmModelSuggestionTable`

```sql
DROP TABLE IF EXISTS llm_model_suggestion;
```

- **不**导入、**不**备份。

### 2.3 `migrateAddSavedModelSettingsJson`

1. 若缺列：`ALTER TABLE llm_saved_model ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'`
2. 遍历所有行：`UPDATE settings_json = #{json}`，`json = defaultSavedModelSettings(vendor_model_id)`
3. **不读** `nm-model-sampling`（已在 2.1 清空）

### 2.4 `migrateCompactionConditionsV3`

在 `DefaultCompactionConditionsStore.getConditions` 首次读入时：

- 若 JSON 为 v2（含 `tokenThreshold`）：转为 v3 并 **立即写回** KKV（一次性）。
- v3 规则：删 `tokenThreshold`；无 `tokenRatio` 则设 `0.8`。
- `setConditions` / Zod **仅接受** v3；v2 YAML/JSON **拒绝**（`decode` 失败并提示升级）。

---

## 3. Suggestion：`nm-model-suggestions` KKV

### Wire

```typescript
export interface ModelSuggestionEntry {
  readonly vendorModelId: string;
  readonly displayName: string | null;
  readonly stale: boolean;
  readonly lastSeenAtMs: number;
}

export interface ModelSuggestionCache {
  readonly schemaVersion: 1;
  readonly models: readonly ModelSuggestionEntry[];
}
```

| Module | Key | Value |
|--------|-----|-------|
| `nm-model-suggestions` | `{providerId}` | `JSON.stringify(ModelSuggestionCache)` |

### `KkvModelSuggestionRepository`

唯一实现 `ModelSuggestionRepository` port；**禁止** SQLite 实现残留。

`provider delete` → `kkv.delete("nm-model-suggestions", providerId)`。

---

## 4. ProviderModelService

```typescript
interface ProviderModelService {
  suggestList(providerId: string): Promise<ModelSuggestion[]>;
  fetch(providerId: string): Promise<void>;
  save(providerId: string, vendorModelId: string, displayName?: string): Promise<SavedModel>;
  create(providerId: string, vendorModelId: string): Promise<SavedModel>;
  savedList(providerId: string): Promise<SavedModel[]>;
  deleteSaved(providerId: string, vendorModelId: string): Promise<void>;

  updateSettings(
    providerId: string,
    vendorModelId: string,
    patch: SavedModelSettingsPatch,
  ): Promise<SavedModel>;

  resetContextWindowToDefault(
    providerId: string,
    vendorModelId: string,
  ): Promise<SavedModel>;

  getSaved(applicationModelId: string): Promise<SavedModel | null>;
  getContextWindow(applicationModelId: string): Promise<number | null>;
}
```

- `save`/`create`：`settings = defaultSavedModelSettings(vendorModelId)`
- `deleteSaved`：**仅**删 SQLite 行（无 KKV 采样清理）

### `model-request.service.ts`

```typescript
const saved = await savedModels.find(providerId, vendorModelId);
let sampling: ModelSamplingParams | undefined;
if (saved?.settings.sampling.enabled && saved.settings.sampling.params != null) {
  sampling = saved.settings.sampling.params;
}
```

**禁止** `samplingProfiles` 依赖注入。

---

## 5. 压缩 v3

### 类型（仅 v3）

```typescript
export interface CompactionConditions {
  readonly schemaVersion: 3;
  readonly enabled: boolean;
  readonly tokenRatio?: number;
  readonly visibleFloor?: number;
}
```

### `TokenRatioConditionTrigger`

```typescript
effective = Math.floor(contextWindow * tokenRatio);
return tokenCount > effective;
```

`contextWindow` 来自 `getContextWindow(applicationModelId)`；`null` → **false**（不回退 map）。

### 删除

- `token-threshold.trigger.ts`
- `token-threshold-trigger.test.ts` → `token-ratio-trigger.test.ts`
- Zod 中 `tokenThreshold` 字段

---

## 6. 顶栏 / seed

- 顶栏：`getContextWindow(applicationModelId)`
- `seedContextWindowTokens`：仅 save/create/reset/backfill
- **`resolveContextWindowTokensOrDefault`：删除**（含 export、测试、文档）

---

## 7. Mobile / CLI

### 模型设置屏（`ModelSamplingScreen`）

编辑 `settings.contextWindowTokens` + `settings.sampling`；调用 `updateSettings` / `resetContextWindowToDefault`。

### `CompactionConditionsScreen`

- 删除 Token 阈值
- 默认 `tokenRatio: 0.8`

### CLI

```
nm provider model edit --modelId <id> [--displayName] [--contextWindowTokens N] [--resetContextWindow]
nm provider model sampling show|set|clear  # 读写 settings_json.sampling
nm compaction-conditions set  # 仅接受 schemaVersion: 3
```

`examples/compaction-conditions.yaml` → v3 only。

### Runtime

- 移除 `modelSamplingProfiles`
- `createProviderServices` 无 sampling profile factory

---

## 8. 物理删除文件清单

```
packages/core/src/service/provider/impl/model-sampling-profile.service.ts
packages/core/src/service/provider/create-model-sampling-profile-service.ts
packages/core/src/service/provider/model-sampling-profile.port.ts
packages/core/src/domain/provider/model/model-sampling-profile.ts
packages/core/src/domain/provider/model/model-sampling-profile-from-json.ts
packages/core/src/domain/provider/repositories/impl/sqlite-model-suggestion.repository.ts
packages/core/src/domain/compaction-conditions/triggers/token-threshold.trigger.ts
packages/core/test/provider/model-sampling-profile.service.test.ts
packages/core/test/compaction-conditions/token-threshold-trigger.test.ts
```

（`resolve-context-window.ts` 保留 `resolveContextWindowTokens`；**删除** `resolveContextWindowTokensOrDefault` 函数体。）

---

## 9. 实现阶段

### Phase 1 — 破坏性迁移 + settings_json

1. 四个 bootstrap migrate（2.1–2.3 + compaction store 2.4）
2. `SavedModelSettings` + repository + service
3. 删除 sampling profile 全链路；改 `model-request`
4. 单测：purge KKV、DROP 表、backfill settings

### Phase 2 — Suggestion KKV

1. `KkvModelSuggestionRepository`
2. 删 SQLite suggestion repo
3. 单测 fetch/stale/deleteByProvider

### Phase 3 — 压缩 v3 + 顶栏

1. `TokenRatioConditionTrigger`
2. 删 threshold trigger + `resolveContextWindowTokensOrDefault`
3. 顶栏 `getContextWindow`

### Phase 4 — App/CLI/docs + 清零验证

1. Mobile/CLI 接线
2. 全仓库 `rg` 清零（见下）
3. `npm test` 全绿

---

## 10. 完成定义（grep 门禁，必须为零）

```bash
# 遗留 module / 表
rg 'nm-model-sampling' packages apps --glob '!**/model-context-settings/**'
rg 'llm_model_suggestion' packages apps --glob '!**/model-context-settings/**'
rg 'ModelSamplingProfile' packages apps
rg 'model-sampling-profile' packages apps --glob '!**/saved-model-settings/**'
rg 'SqliteModelSuggestion' packages apps
rg 'tokenThreshold' packages/core/src/domain/compaction-conditions
rg 'token-threshold\.trigger' packages apps
rg 'resolveContextWindowTokensOrDefault' packages apps
rg 'maxOutputTokensFromSampling' packages apps  # 或仅保留在 protocol-sampling-defaults 且无 prompt-budget 注释

# 运行时误用 map 作分母
rg 'resolveContextWindowTokens' apps/
rg 'resolveContextWindowTokens' packages/core/src/service/compaction-conditions
```

允许 `resolveContextWindowTokens` 仅出现在：

- `infra/tokenizer/logic/resolve-context-window.ts`
- `infra/tokenizer/logic/seed-context-window-tokens.ts`
- `default-saved-model-settings.ts`
- bootstrap backfill / reset tests

---

## 11. 测试（必须）

| 项 | 断言 |
|----|------|
| bootstrap | `nm-model-sampling` keys 为空；无 `llm_model_suggestion` 表 |
| save claude-3-5 | `settings.contextWindowTokens === 200_000` |
| save unknown | `settings.contextWindowTokens === 128_000` |
| sampling | `enabled: true` + params → model-request 带 sampling |
| compaction | ratio 0.8 × 100k；85001 触发 |
| compaction v2 KKV | 读一次变 v3 写回 |
| compaction v2 set | **拒绝** |
| suggestion | fetch → KKV；provider delete 清 key |

---

## 12. 发布说明（Breaking）

1. 升级后须 **重新 `fetch` 模型列表**（suggestion 不迁移）。
2. 曾存于 `nm-model-sampling` 的自定义采样 **丢失**；须于模型设置页重配。
3. `tokenThreshold` 已移除；请用 `tokenRatio` + 模型 `contextWindowTokens`。
4. `nm compaction-conditions` 仅接受 `schemaVersion: 3`。
5. `NovelMasterRuntime.modelSamplingProfiles` 已移除。

---

`.apm/kb/docs/Iterations/model-context-settings/spec.md`
