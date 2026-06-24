---
date: 2026-06-24
dependency: Iterations/provider-model/prd.md
---

# OpenCode 内置服务商（opencode-builtin-provider）PRD

## 背景

[provider-model PRD](../provider-model/prd.md) 已交付四类内置 LLM 服务商（`openai`、`anthropic`、`google`、`openrouter`），用户通过 `nm provider edit` 配置 apiKey、`nm provider model fetch/save` 管理模型后发起调用。

[OpenCode Zen](https://opencode.ai) 提供 OpenAI 兼容的托管网关（`https://opencode.ai/zen/v1`）。免费档可使用 apiKey `public` 调用部分模型；付费模型需用户自备 `OPENCODE_API_KEY` 或账号 key。用户可自行 `fetch` 模型列表并选择免费模型，**无需**产品侧做免费额度专用提示或 OpenCode 账号 OAuth 集成。

本迭代将 OpenCode 作为**第五类普通内置 provider** 纳入 bootstrap seed，与 OpenRouter 同级，不引入额外 UX 或鉴权流程。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 开箱即用可见 OpenCode | 新库 bootstrap 后 `nm provider list` 含 `opencode` 行 |
| 协议与调用路径一致 | `opencode/*` 应用模型 id 走 `openai` 协议；`model request` 在配置 apiKey 且已 save 模型后可调用 |
| 与现有内置契约一致 | 不可 `create` 重复 id、不可 `delete`、不可改 `id`/`protocol`；可 `edit` baseUrl、apiKey、headers 等 |
| 老库可增量补齐 | 已存在数据库再次 bootstrap 时幂等插入 `opencode`（不覆盖用户已编辑字段） |
| 回归防护 | 相关单元测试与 CLI e2e 更新后 `npm run test:fast` 全绿 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| CLI / Desktop / Mobile 用户 | 在服务商列表中看到 OpenCode，配置 apiKey（如 `public` 或自有 key），fetch 并 save 目标模型后使用 |
| 试用用户 | 使用 OpenCode 免费模型（如 `big-pickle`），自行从 fetch 结果中挑选，不依赖产品内免费档引导文案 |
| 维护者 | 新增内置项仅改单一数据源 `BUILTIN_PROVIDER_ROWS`，seed 与协议推断自动对齐 |

## 范围

### 包含范围

- 在 `BUILTIN_PROVIDER_ROWS` 增加 `opencode`：`protocol=openai`，`baseUrl=https://opencode.ai/zen/v1`，`displayName=OpenCode Zen`（或等价展示名）
- 依赖现有 `seedBuiltinProviders` 幂等插入；现有 `provider edit` / `model fetch` / `model request` 流程不变
- 更新 bootstrap seed 测试、协议推断测试、CLI provider list e2e
- 本迭代 SPEC 锁定实现细节与测试用例

### 不包含范围

- OpenCode 免费额度、`FreeUsageLimitError` 等专用错误文案或订阅引导
- OpenCode 控制台 OAuth / device login 集成
- models.dev 目录同步、免费/付费模型自动过滤
- Desktop / Mobile 专属 UI（若仅读 DB provider 列表则随 seed 自动出现，不单独开发）
- 修改 [provider-model](../provider-model/prd.md) 已交付的 CRUD / HTTP 适配器行为

### 内置默认 apiKey（opencode）

- `opencode` 内置 `defaultApiKey: public`（OpenCode Zen 免费档）；SKSP 未配置时自动使用，用户仍可通过 `provider edit` 覆盖为自有 key
- 列表 `apiKeyStatus` 对存在内置默认的服务商显示 `set`
- 错误文案不含 CLI 命令；Mobile 对 `ProviderError` 显示中文提示

## 核心需求

1. **内置 seed**：bootstrap 后 `llm_provider` 存在 `id=opencode`、`protocol=openai`、`base_url=https://opencode.ai/zen/v1`、`is_builtin=1`、初始无 apiKey。
2. **内置保护**：与现有四类内置相同，禁止 `provider create --providerId opencode`、禁止 `provider delete`、禁止修改 `protocol`。
3. **用户配置**：用户通过 `provider edit --apiKey` 自行配置（免费档可填 `public`）；通过 `model fetch` / `save` 自行选择模型。
4. **协议推断**：`inferLlmProtocolFromApplicationModelId("opencode/…")` 返回 `openai`，与 agent export 路径一致。
5. **兼容性**：已有库在下次 bootstrap 时补插 `opencode` 行，不覆盖用户已对其它内置 provider 的编辑。

## 验收标准

- [ ] **Given** 新建数据库并执行 bootstrap，**When** 运行 `nm provider list`，**Then** 输出包含 `opencode`，且 `protocol=openai`、`baseUrl` 为 `https://opencode.ai/zen/v1`，`apiKey: not set`。
- [ ] **Given** 已 bootstrap 的库，**When** 再次执行 bootstrap，**Then** `llm_provider` 中 `opencode` 仍仅一条，且用户此前对 `opencode` 的 `edit`（如 apiKey、baseUrl）不被 seed 覆盖。
- [ ] **Given** 内置 `opencode`，**When** 执行 `nm provider create --providerId opencode …`，**Then** 失败并提示内置冲突（`BUILTIN_PROVIDER`）。
- [ ] **Given** 内置 `opencode`，**When** 执行 `nm provider delete --providerId opencode`，**Then** 失败（`BUILTIN_PROVIDER`）。
- [ ] **Given** `inferLlmProtocolFromApplicationModelId("opencode/big-pickle")`，**When** 单元测试调用，**Then** 返回 `openai`。
- [ ] **Given** 用户已 `provider edit --providerId opencode --apiKey public` 且 `model save --vendorModelId big-pickle`，**When** `nm model request --modelId opencode/big-pickle --content hello`（网络可达），**Then** 返回 assistant 文本或上游可识别的 HTTP 错误（非 `API_KEY_NOT_SET` / `MODEL_NOT_SAVED`）。
