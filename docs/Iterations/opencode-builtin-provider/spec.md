---
date: 2026-06-24
---

# OpenCode 内置服务商（opencode-builtin-provider）技术规格（SPEC）

## 设计目标

在**最小 diff** 前提下，将 OpenCode Zen 纳入与 OpenRouter 同级的内置 provider 种子数据；复用现有 openai 协议适配器、SKSP、CRUD 与 CLI，不新增服务类或 UI。

## 总体方案

单一数据源 `BUILTIN_PROVIDER_ROWS` 追加一行；`seedBuiltinProviders` 与 `inferLlmProtocolFromApplicationModelId` 已从该表派生，**无需改 seed 实现或 infer 逻辑**。

```text
BUILTIN_PROVIDER_ROWS (+ opencode)
        │
        ├─► seedBuiltinProviders()     → llm_provider INSERT … WHERE NOT EXISTS
        ├─► BUILTIN_PROVIDER_PROTOCOLS → inferLlmProtocolFromApplicationModelId
        └─► DefaultProviderService   → BUILTIN_IDS 禁止 create/delete/protocol edit
```

OpenCode 对外为 OpenAI Chat Completions 兼容：`baseUrl = https://opencode.ai/zen/v1`，鉴权 `Authorization: Bearer <apiKey>`（与 openai/openrouter 相同，见 `openai.adapter.ts`）。

## 最终项目结构

无新目录。变更限于：

| 路径 | 变更类型 |
|------|----------|
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | 追加 seed 行 |
| `packages/core/test/provider/bootstrap-seed.test.ts` | 断言 5 个内置 id |
| `packages/core/test/provider/infer-llm-protocol-from-model-id.test.ts` | 追加 `opencode/*` case |
| `apps/cli/test/provider-e2e.test.ts` | list e2e 含 `opencode` |

## 变更点清单

### 1. `builtin-providers.ts`

在 `BUILTIN_PROVIDER_ROWS` 末尾（建议 `openrouter` 之后）增加：

```ts
{
  id: "opencode",
  protocol: "openai",
  baseUrl: "https://opencode.ai/zen/v1",
  displayName: "OpenCode Zen",
  defaultApiKey: "public",
},
```

`defaultApiKey` 由 `resolveProviderApiKey()` 在 SKSP 无密钥时回退；`providerApiKeyIsConfigured()` 用于 list 的 `apiKeyStatus`。

### 2. `resolve-provider-api-key.ts`（新）

- `resolveProviderApiKey(provider, secretStore)`：`fetch` / `model request` 共用
- `providerApiKeyIsConfigured(provider, secretStore)`：list UI 状态

### 3. 错误文案

- Core：`providerApiKeyNotSetMessage` / `providerModelNotSavedMessage`（无 `nm …` CLI 提示）
- Mobile：`formatError` 对 `API_KEY_NOT_SET` / `MODEL_NOT_SAVED` 显示中文；`FetchModelsSheet` 使用 `formatError`

### 4. 测试更新

**`bootstrap-seed.test.ts`**

- 用例名：`seeds five built-in providers once`
- 期望 id 列表（字母序）：`["anthropic", "google", "openai", "opencode", "openrouter"]`
- `again.length` → `5`

**`infer-llm-protocol-from-model-id.test.ts`**

- 新增：`{ applicationModelId: "opencode/big-pickle", expected: "openai" }`

**`provider-e2e.test.ts`**

- 用例名：`lists five built-in providers on fresh db`
- `assert.match(list.stdout, /opencode/)`

### 3. 无需修改的文件（确认）

| 模块 | 原因 |
|------|------|
| `seed-builtin-providers.ts` | 已遍历 `BUILTIN_PROVIDER_ROWS` |
| `infer-llm-protocol-from-model-id.ts` | 已读 `BUILTIN_PROVIDER_PROTOCOLS` |
| `provider.service.ts` | `BUILTIN_PROVIDER_IDS` 自动更新 |
| `openai.adapter.ts` | OpenAI 兼容 endpoint 通用 |
| Desktop / Mobile provider UI | 读 DB 列表，bootstrap 后自动出现 |

## 详细实现步骤

1. 修改 `builtin-providers.ts` 追加 `opencode` 行。
2. 更新上述三个测试文件中的断言与用例名。
3. 运行 `npm run test:fast --workspace=@novel-master/core` 与 CLI provider 相关测试（或全量 `test:fast`）。
4. （可选）本地手工：`nm provider list` 确认新库含 `opencode`；`edit --apiKey public` + save 免费模型 + `model request` 冒烟。

## 兼容性与迁移

- **新库**：首次 `bootstrapNovelMaster` 插入 5 条内置行。
- **老库**：`seedBuiltinProviders` 使用 `WHERE NOT EXISTS (SELECT 1 FROM llm_provider WHERE id = #{id})`，仅补插缺失的 `opencode`；**不**更新已有行的 `base_url` / `protocol`（与现有四类行为一致）。
- **自定义 provider**：用户若已手动 `create --providerId opencode`（历史上理论上可能），将与内置冲突；本迭代不处理迁移，因当前内置 id 集合此前不包含 `opencode`。

## 测试策略

### 测试用例

| ID | 类型 | 描述 |
|----|------|------|
| T1 | unit | bootstrap 后 5 个内置 id，二次 bootstrap 不重复 |
| T2 | unit | 各行 `protocol` 与 `BUILTIN_PROVIDER_PROTOCOLS` 一致 |
| T3 | unit | `opencode/foo` → `openai` 协议推断 |
| T4 | e2e CLI | 新库 `provider list` stdout 含 `opencode` |
| T5 | manual | 配置 `public` key + 免费模型 request（依赖外网，不纳入 CI 硬性门禁） |

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| OpenCode endpoint 或模型名单变更 | 用户可 `provider edit --baseUrl`；与其它网关相同 |
| 用户 save 付费模型但未配 key → 401 | 沿用通用 HTTP 错误，本迭代不做专用提示（PRD 范围外） |
| 免费额度用尽 | 上游错误原文返回，无 Go 订阅引导 |

**回滚**：从 `BUILTIN_PROVIDER_ROWS` 移除 `opencode` 行并还原测试；已插入 DB 的 `opencode` 行可保留（`is_builtin=1` 仍不可删）或手工 SQL 删除——仅开发环境需要。
