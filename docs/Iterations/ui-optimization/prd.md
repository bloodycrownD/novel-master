# UI 优化 — Token 计数器随模型配置 PRD

## 背景

当前 Token 计数器为**全局**配置：

- Mobile「我的 → 工作区 → Token 计数器」（App UI KKV `tokenCounter.mode`）
- CLI / Core `nm-preferences` 同名键
- Runtime 经 `TokenCounterRegistry.getTokenizerOverride()` 注入

同一用户可能对不同模型需要不同计数策略（如 Gemini 用 `gemma`、OpenAI 用 `auto`），全局开关不合理。

与此同时，`llm_saved_model.settings_json` 已承载**按模型**的上下文上限与采样参数（`SavedModelSettings`），Token 计数器配置与之天然同域。

Chat 页 meta 栏已展示 LLM 模型与 token 占用；`countPromptLlmInput` 返回 `counterKind`，可在 token 统计旁展示实际计数实现。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 配置随模型 | 每个 saved model 独立 token 计数模式，默认 `auto` |
| 简化全局入口 | 移除「我的」页与 preferences 的全局 tokenCounter.mode |
| 可观测 | Chat token 行后缀展示 `counterKind` |
| 无 DDL | 复用 `settings_json`，不新增 SQLite 列 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 日常作者 | 切换工作区模型后，token 计数自动跟随该模型设置 |
| 进阶用户 | 在「模型设置」页为特定 vendor model 指定 tokenizer 族（如 `claude`） |
| 调试 | Chat 页确认当前数字由哪种 counter 产生 |

## 范围

### 包含范围

1. **`SavedModelSettings` 扩展**（见下节字段设计）
2. **Mobile UI**
   - 移除「我的 → Token 计数器」
   - 在 `ModelSamplingScreen`（模型设置）增加 Token 计数器选项
   - Chat meta：token 统计后缀 ` · {counterKind}`
3. **计数链路**
   - `countPromptLlmInput` 调用时传入当前 `applicationModelId` 对应 saved model 的 `tokenCounterMode`
   - 模型未保存或无字段时 fallback `auto`
4. **CLI**
   - 移除 `nm preferences set/get tokenCounter.mode`
   - `model` 相关命令可读写 per-model 设置（与 context window 同路径）
5. **废弃全局配置**
   - 忽略历史 KKV / preferences 中的 `tokenCounter.mode`，不迁移

### 不包含范围

- 修改 `resolveTokenizerFamily` / `auto` 解析规则
- 修改 token 统计公式或 prompt assembly
- 为未 saved 的 vendor model 持久化 token 模式（一律 `auto`）

## 字段设计（是否需要新字段）

**结论：需要新字段，不需要新 DDL 列。**

| 项 | 决定 |
|----|------|
| 存储位置 | `llm_saved_model.settings_json`（已有列） |
| 字段名 | `tokenCounterMode` |
| 类型 | `TokenizerOverride`（`auto` \| `heuristic` \| `TokenizerFamily`） |
| 默认值 | `"auto"`（JSON 缺省或旧文档无此键时） |
| schemaVersion | 保持 `1`，Zod 对缺省字段 `.default("auto")`；无需 bump 版本 |

示例 JSON：

```json
{
  "schemaVersion": 1,
  "contextWindowTokens": 1048576,
  "sampling": { "enabled": false },
  "tokenCounterMode": "auto"
}
```

**不采用**全局 KKV / preferences 键；**不采用**新 SQLite 列。

## 核心需求

1. **Per-model 配置**：`SavedModelSettings.tokenCounterMode`，新建 saved model 时默认 `auto`。
2. **设置 UI**：模型设置页提供与现 Profile 相同的选项列表（auto / heuristic / 各 TokenizerFamily）。
3. **计数读取**：Chat / CLI token 计数从 resolved `applicationModelId` → `getSaved` → `settings.tokenCounterMode` → `countPromptLlmInput({ tokenizerOverride })`。
4. **移除全局入口**：删除 Mobile Profile 项、App UI KKV 读写、CLI preferences 子命令；runtime 不再注册 `getTokenizerOverride` 读全局。
5. **Chat 展示**：token 标签 `{tokenLabel} · {counterKind}`；估算仅 `~` 前缀；fallback 路径后缀 ` · heuristic`。
6. **`SavedModelSettingsPatch`**：支持 patch / updateSettings 更新 `tokenCounterMode`。

## 验收标准

### 字段与存储

- [ ] **Given** 新建 saved model，**When** 读取 settings，**Then** `tokenCounterMode === "auto"`。
- [ ] **Given** 旧 `settings_json` 无 `tokenCounterMode` 键，**When** 解析，**Then** 视为 `"auto"` 且不报错。
- [ ] **Given** 在模型设置页设为 `gemma` 并保存，**When** 重启 App，**Then** 该模型 settings 仍为 `gemma`。

### 全局配置移除

- [ ] **Given** 打开「我的 → 工作区」，**Then** 无「Token 计数器」项。
- [ ] **Given** 历史 preferences 存有 `tokenCounter.mode=heuristic`，**When** 使用该模型（默认 auto），**Then** 计数按模型 settings 而非全局值。

### 计数与展示

- [ ] **Given** 模型 A 设 `heuristic`、模型 B 设 `auto`，**When** 切换工作区模型并查看 Chat token，**Then** counterKind 随模型变化。
- [ ] **Given** 精确计数成功，**When** 查看 meta，**Then** 形如 `12% • 24K/128K · gemma`。
- [ ] **Given** 估算计数，**When** 查看 meta，**Then** 形如 `~6% • 56.1K/1M · heuristic`。
- [ ] **Given** applicationModelId 未 saved，**When** 计数，**Then** 等价于 `auto` 且后缀反映实际 counterKind。

### CLI

- [ ] **Given** `nm preferences set tokenCounter.mode …`，**Then** 命令不可用或明确废弃。
- [ ] **Given** 通过 model settings 更新 API/命令修改 tokenCounterMode，**When** `prompt render --tokens`，**Then** 使用该模型 override。
