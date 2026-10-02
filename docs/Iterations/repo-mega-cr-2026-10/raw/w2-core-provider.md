---
zone: core-provider
agent: domain-survey
files_scanned: 33
---

# W2 按域测绘：packages/core/src/domain/provider/

## 摘要

LLM 服务商（provider）与已保存模型（saved model）领域的模型层 + 纯逻辑层 + 仓储层。定义
`LlmProvider` / `SavedModel` / `SavedModelSettings`（schema v2）三组实体，提供 5 条内置 provider
的固定 UUID 种子表、思考强度档位（off/low/medium/high）到各家协议思考参数的映射、采样默认值表、
settings_json 的 v1→v2 zod 迁移、以及 3 个 repository port + 3 个实现（provider/saved-model 走
SQLite，model-suggestion 走 KKV）。本域 33 文件共约 2.3k 行，测试覆盖较好（test/provider/ 下 28 个文件）。

## 职责与边界

- **model/**：领域类型 + zod schema + 派生视图。写盘一律 v2 文档，内存恒为 v2。
- **logic/**：无 IO 的纯函数（display name 派生、思考参数解析、application model id 归一、
  UUID 断言、删除前引用扫描）+ 一处带 SQL 的引用扫描（`find-saved-model-references.ts` 直接吃
  `TdbcConnection`，是本域唯一的越界点——它跨到 `chat_session` / `agent_definition` / `kkv_entry`）。
- **repositories/**：3 个 port 接口 + 3 个实现。`SqliteProviderRepository`、
  `SqliteSavedModelRepository`（llm_provider / llm_saved_model 两张表）、
  `KkvModelSuggestionRepository`（KKV module `nm-model-suggestions`，替代了原 SQLite 建议表）。
- **不在本域**：HTTP 调用、协议适配（`infra/llm-protocol`）、service 编排
  （`service/provider/`）、UI 选项的渲染。

## 对外接口

`packages/core/src/public/provider.ts` 转出的本域符号（部分）：

| 符号 | 位置 | 状态 |
|---|---|---|
| `parseApplicationModelId` / `formatApplicationModelId` / `normalizeVendorModelId` | `logic/application-model-id.ts` | 活 |
| `assertSavedModelUuid` / `isSavedModelUuidFormat` | `logic/assert-saved-model-uuid.ts` | 活 |
| `formatSavedModelDisplayName` | `logic/format-saved-model-display-name.ts` | 活 |
| `inferLlmProtocolFromSavedModelId` | `logic/infer-llm-protocol-from-model-id.ts` | 活 |
| `inferLlmProtocolFromApplicationModelId` | 同上 :55 | **死**（仅 barrel） |
| `providerApiKeyRef` | `model/provider.ts` | 活 |
| `resolveEffectiveMaxTokens` / `resolveThinkingParamsForLevel` | `logic/resolve-thinking-wire.ts` | 活 |
| `thinkingLevelToModelThinkingParams` | `logic/thinking-level-presets.ts` | 活 |
| `savedModelDisplayName` | `model/saved-model.ts` | 活 |
| `toSavedModelView` / `SavedModelView` | 同上 :33,:35 | **死**（仅 barrel） |
| `savedModelContextWindowTokens` / `savedModelTokenCounterMode` / `savedModelSampling` / `savedModelThinkingLevel` / `applySavedModelSettingsPatch` | `model/saved-model-settings.ts` | 活 |
| `savedModelSettingsFromJson` / `savedModelSettingsToJson` | `model/saved-model-settings-from-json.ts` | 活 |
| `defaultSavedModelSettings` | `model/default-saved-model-settings.ts` | 活 |
| `mergeSamplingWithDefaults` | `model/protocol-sampling-defaults.ts` | 活 |
| `maxOutputTokensFromSampling` | 同上 :70 | **死**（仅 barrel + 测试） |
| `samplingProtocol` | `model/model-sampling-params.ts:42` | **死**（仅 barrel） |
| `thinkingProtocol` | `model/model-thinking-params.ts:41` | **死**（仅 barrel） |
| `THINKING_LEVEL_SELECT_OPTIONS` | `model/thinking-level-options.ts:18` | 活（双端用） |
| `THINKING_LEVEL_OPTIONS` | 同上 :10 | **死**（仅 barrel） |
| `TOKEN_COUNTER_MODE_SELECT_OPTIONS` | `model/token-counter-mode-options.ts:20` | 活 |
| `TOKEN_COUNTER_MODE_OPTIONS` | 同上 :10 | **死**（生产无引用，仅 barrel + 1 测试） |

**未出 barrel 但有生产消费方**：`builtinDefaultApiKey`（被 `logic/resolve-provider-api-key.ts` 用）、
`resolveProviderApiKey` / `providerApiKeyIsConfigured`（`service/provider/impl/provider.service.ts`、
`model-request.service.ts`）、`findSavedModelReferences`（`provider-model.service.ts:173`）、
`deriveModelNameFromLegacy`（**仅测试**）、`BUILTIN_PROVIDER_PROTOCOLS` / `BUILTIN_PROVIDER_UUID_PROTOCOLS`
（`logic/infer-llm-protocol-from-model-id.ts`）。

## 数据访问

| 表 / KKV / 存储 | 位置 | 说明 |
|---|---|---|
| `llm_provider` | `repositories/impl/sqlite-provider.repository.ts:84,96,111,138,164` | list / findById / insert / update / delete |
| `llm_saved_model` | `repositories/impl/sqlite-saved-model.repository.ts:42,54,68,89,106,115` | listByProvider / findById / insert / updateById / deleteById / deleteByProvider |
| KKV module `nm-model-suggestions`，key = providerId | `repositories/impl/kkv-model-suggestion.repository.ts:16,96,107,121` | get / set / delete |
| `sksp_secrets`（经 `SecretStore`） | `logic/provider-identity-repair.ts:111,120,124,140,144`；`logic/resolve-provider-api-key.ts:26,52` | `provider/{id}/apiKey` ref 的读/写/删 |
| `chat_project.agent_config_json` | `logic/find-saved-model-references.ts:69` | **只读全表扫描**（引用检查） |
| `agent_definition.prompts_json` | 同上 :52 | 只读全表扫描 |
| `kkv_entry`（`WORKSPACE_STATE_MODULE` / `KEY_CURRENT_MODEL_ID`） | 同上 :41 | 读当前工作区模型指针 |
| `chat_session.agent_config_json` | — | **未扫描**，见 F-1 |

`SqliteProviderRepository.update`（:134-158）刻意不改 `builtin_key` / `is_builtin`——provider 的双身份
键是 migration 不变量，更新路径不能触碰。

## 依赖关系

**import 了谁**：
- `@/infra/llm-protocol/ports/adapter.port.js`（`LlmProtocolKind` = `"openai"|"anthropic"|"gemini"`）——`model/provider.ts:7`、`model/model-sampling-params.ts:7`、`model/model-thinking-params.ts:7`、`model/protocol-sampling-defaults.ts:10`、两个 logic 文件
- `@/infra/tokenizer/logic/resolve-tokenizer-family.js`（`TokenizerOverride`）——`model/saved-model-settings.ts:7`、`model/token-counter-mode-options.ts:7`
- `@/infra/tokenizer/logic/read-token-counter-mode-pref.js`——`model/saved-model-settings.schema.ts:8`
- `@/infra/tokenizer/logic/seed-context-window-tokens.js`——`model/default-saved-model-settings.ts:7`
- `@/infra/tdbc/*` + `@/infra/sql-template` + `@/infra/serialization/decode.js`——仓储实现
- `@/service/integrity-repair.js`（**domain → service 反向依赖**）——`logic/provider-identity-repair.ts:25`
- `@/service/persistent-state/impl/workspace-state-keys.js`——`logic/find-saved-model-references.ts:11`
- `zod`——4 个 schema 文件
- `@/errors/provider-errors.js`——`ProviderError`

**被谁消费**：`service/provider/impl/provider-model.service.ts`、`service/provider/impl/provider.service.ts`、
`service/provider/impl/model-request.service.ts`、`service/agent/impl/agent-runner.ts`、
`service/prompt/resolve-preview-thinking-context.ts`、apps 侧 mobile/desktop/cli 多个 provider/model 界面。

**域内循环依赖（1 处）**：`logic/resolve-thinking-wire.ts:15` ⇄ `logic/thinking-level-presets.ts:11`。

## 发现清单

### F-core-provider-1 | P1 | `logic/find-saved-model-references.ts:66-90`
```ts
  const projectRows = await queryTemplate<ChatProjectRow>(
    conn,
    parser,
    `SELECT id, agent_config_json FROM chat_project`,
```
`findSavedModelReferences` 的 doc 写「Empty when safe to delete」（:29-30），但它**没有扫
`chat_session.agent_config_json`**。会话级模型 pin 恰恰存在那里：`chat_session` 表**没有**
`model_id` 列（`bootstrap/chat/chat-schema.ts:16-24`），会话的 modelId 覆盖存于
`SessionAgentConfig = { agentId, modelId? }`（`domain/chat/model/session-agent-config.ts:18-21`），
经 `sqlite-session.repository.ts:185` 落 `agent_config_json` 列，并在
`service/agent/logic/agent-run-shared.ts:107-112` 真实生效（`sessionModelId` 覆盖 agent pin）。
因此：会话 A 选了模型 M → `provider-model.service.ts:173` 的 in-use 守卫放行 → M 被删 →
该会话下次开跑在 `assertSavedModelUuid` 处抛 `Saved model not found`。
**降级因素**：失败是显式报错而非静默损坏，且用户可改选模型，故不判 P0。
**建议**：在 `chat_project` 扫描旁补一段 `SELECT id, agent_config_json FROM chat_session`，命中记
`chat_session:{id}`。
**置信**：confirmed

### F-core-provider-2 | P2 | `logic/find-saved-model-references.ts:66-90`
同上这段扫的是 `chat_project.agent_config_json`。按 `docs/apm/RULE.md:38`「项目智能体（已下线）……
v1.4.26 起已移除 UI 入口和解析分支，DB 列置空保留」，且
`service/agent/logic/resolve-agent-for-project.ts:37` 明写「不再读取 `chat_project.agent_config_json`」，
`bootstrap/novel-master-bootstrap.ts:250-269` 的 `hasLegacyChatProjectShape` 甚至断言该列非 NULL 行数
必须为 0。也就是说这段扫描**结构上永远扫不到东西**，却每次删除都全表扫一遍
`chat_project` + 逐行 `JSON.parse`。
同文件 `:56` 的 `JSON.parse(String(row.prompts_json))` 无 try/catch：任一行 agent prompt JSON 损坏，
整次删除守卫直接抛 SyntaxError（且 `AgentDefinitionRow.prompts_json` 类型标成非空 string，实际列可空）。
**建议**：删掉 `chat_project` 分支（连同 `ChatProjectRow` 接口）；`prompts_json` 加 null/try 保护。
**置信**：confirmed

### F-core-provider-3 | P2 | `logic/resolve-thinking-wire.ts:15` ⇄ `logic/thinking-level-presets.ts:11`
```ts
// resolve-thinking-wire.ts:15
import { thinkingLevelToModelThinkingParams } from "./thinking-level-presets.js";
// thinking-level-presets.ts:11
import { resolveEffectiveMaxTokens } from "./resolve-thinking-wire.js";
```
两个文件互为对方的唯一消费者，形成硬环，且都被 `public/provider.ts:76-80` 转出。运行时安全
（两文件顶层只有 const/function 声明，调用点在函数体内，ESM 活绑定可解），但与
`docs/apm/RULE.md:92` 记录的「模块级 require-cycle 在依赖解析顺序变化时才暴露运行时错误」是同一类脆弱面。
**建议**：把 `resolveEffectiveMaxTokens` 挪到 `protocol-sampling-defaults.ts`（它本来就是采样默认值
的读取函数，且已 import 该文件的数据），单方向断开。
**置信**：confirmed（环的存在）/ suspected（是否已实际炸过——本轮未见事故记录）

### F-core-provider-4 | P2 | `logic/application-model-id.ts:49-67`
```ts
  const providerPrefix = `${providerId}/`;
  if (value.startsWith(providerPrefix)) {
    return value.slice(providerPrefix.length);
  }
  ...
  if (value.startsWith("models/")) {
    value = value.slice("models/".length);
  }
```
前缀早退**绕过了 `models/` 剥离**，两个语义等价的输入产出不同结果：
`normalizeVendorModelId("openai", "openai/models/gpt-4")` → `"models/gpt-4"`；
`normalizeVendorModelId("openai", "models/gpt-4")` → `"gpt-4"`。
doc（:36-38）声称「Strips `{providerId}/` prefix and OpenAI-style `models/` path segments」，但两者
不同时生效。`service/provider/impl/provider-model.service.ts:81` 的 fetch 主路径传的是远端返回的
裸 id（通常不带前缀），故线上未爆；但 `config-forms/shared/application-model-id.ts` 消费粘贴的完整
application id，会踩到早退分支。
**建议**：把 `models/` 剥离提到前缀早退之前（或早退后继续走剥离）。
**置信**：confirmed

### F-core-provider-5 | P2 | `logic/builtin-providers.ts:105-147`
`BUILTIN_PROVIDER_ROWS`（:39，单一数据源，注释明确写「禁止另维护第二套」）派生出 9 张表/函数，
其中 **6 个零生产消费方**，另 1 个仅测试用：

| 符号 | 行 | 生产引用 |
|---|---|---|
| `BUILTIN_KEY_TO_UUID` | :105 | 无（仅 test） |
| `BUILTIN_UUID_TO_KEY` | :111 | 无（仅 test） |
| `BUILTIN_PROVIDER_UUIDS` | :128 | 无（仅 test） |
| `BUILTIN_PROVIDER_IDS` | :125 | 无（@deprecated 别名，恒等于 `BUILTIN_PROVIDER_KEYS`） |
| `builtinProtocolByProviderKey` | :133 | 无 |
| `builtinProtocolByProviderId` | :140 | 无（@deprecated） |
| `BUILTIN_PROVIDER_KEYS` | :120 | 无（仅 test） |
| `BUILTIN_PROVIDER_PROTOCOLS` | :91 | `logic/infer-llm-protocol-from-model-id.ts:45` |
| `BUILTIN_PROVIDER_UUID_PROTOCOLS` | :98 | `logic/infer-llm-protocol-from-model-id.ts:30` |

即 9 份派生里只有 2 份是活的。每新增一行 seed 数据都要维护 9 处 `Object.fromEntries`。
**建议**：只留 `BUILTIN_PROVIDER_ROWS` + 上述 2 份 protocols map（seed 与协议护栏的真实需求），
其余连同 `BUILTIN_PROVIDER_IDS` / `builtinProtocolByProviderId` 一并删（它们是 `@deprecated`
却从未有调用方，说明兼容期早已过期）。
**置信**：confirmed

### F-core-provider-6 | P2 | `repositories/impl/kkv-model-suggestion.repository.ts:44-65`
```ts
  async upsert(suggestion: ModelSuggestion): Promise<void> {
    const cache = await this.readCache(suggestion.providerId);
    const models = [...cache.models];
    ...
    await this.writeCache(suggestion.providerId, { schemaVersion: 1, models });
```
每次 upsert 都是「读整份文档 → 改一个元素 → 写整份文档」。调用方
`service/provider/impl/provider-model.service.ts:80-90` 在 for 循环里对每个模型调一次，
N 个模型 = N 次整文档读 + N 次整文档写 = **O(N²)** 次序列化 + N 次 KKV 写事务。
OpenRouter / OpenCode Zen 这类 provider 一次返回数百个模型。
（语义上无 bug：`markStaleExcept` 在所有 upsert 之后调用且会保留 `existing?.displayName`，
`provider-model.service.ts:92`，所以 displayName 不会被抹掉。）
**建议**：port 加一个 `upsertMany(providerId, suggestions[])`，或 fetch 路径直接调
`markStaleExcept` + 一次批量写。
**置信**：confirmed（复杂度）/ suspected（实际耗时——未实测 500 模型场景）

### F-core-provider-7 | P3 | `logic/provider-identity-repair.ts:52-54, 76, 84-91`
本文件两个 `create*Operation` 工厂**都没有注册进 `IntegrityRepairRegistry`**——全仓唯一的注册点
`bootstrap/novel-master-bootstrap.ts:391-392` 只挂了 `createVfsEntrySequenceRepairOperation`。
其中 `createProviderIdentityRepairOperation` 是**有意的**，同文件 bootstrap 注释明写：
> 历史：这里曾另有 entry-id migration 刚跑完时的 ref_count / **provider 身份键**兜底修复分支，
> 随 vfs-entry-id-redesign-v1 退役（最低支持 v1.4.27）一并移除。
→ 标 `intentional`（出处：`novel-master-bootstrap.ts:388-389`），不整改。
但 `createProviderSecretRenameOperation`（:105-152）**没有这条出处**，它的 doc（:99-101）自陈用途是
「未来如果有『运行时 provider id 重写』场景……可以复用这条路径」——纯投机性死代码，149 行的一半。
**建议**：删掉 `createProviderSecretRenameOperation` 及其测试；`createProviderIdentityRepairOperation`
亦可一并退役（连同 149 行文件），把退役理由补进文件头注释。
**置信**：confirmed

### F-core-provider-8 | P3 | `logic/provider-identity-repair.ts:53, 76`
```ts
        if (p.displayName.trim() === "") {
          offenders.push(`${p.id}: 空 display_name`);
        }
```
该分支**结构上不可达**：`SqliteProviderRepository.rowToProvider`（`sqlite-provider.repository.ts:52-58`）
在读行时遇到空 display_name 直接 `throw new ProviderError`，所以 `detect()` 里的
`providerRepo.list()`（:50）会先炸、根本走不到检查。模块注释 :33-35 其实已经承认这点
（「display_name 的非空校验通常已在 `rowToProvider` 读取时强制……但某些路径可能绕过 repo」），
但没有任何这样的调用方——`IntegrityRepairRegistry` 拿到的就是 repo 接口。
另外 `repair()` 抛的错误码是 `"MIGRATION_ORPHAN_POINTER"`（:85），与「形态不变量被破坏」语义无关，
会误导排障。
**建议**：既然要退役（见 F-7），直接删；若保留则删掉 display_name 分支并换用语义正确的错误码。
**置信**：confirmed

### F-core-provider-9 | P3 | `model/resolve-provider-api-key.ts:27, 52`
```ts
// resolveProviderApiKey
  if (stored != null && stored !== "") { return stored; }
// providerApiKeyIsConfigured
  if (await secretStore.has(ref)) { return true; }
```
同一份密钥，两个函数对「空串」的判定相反：`resolveProviderApiKey` 把 `""` 当未配置（继续回落内置默认、
再抛 `API_KEY_NOT_SET`），`providerApiKeyIsConfigured` 视 `""` 为已配置（`has` 只查行存在，
`base-sqlite-secret-store.ts:58-67`）。后者喂给 `provider.service.ts:276-281` 的
`apiKeyStatus` → UI 显示「已配置」但一跑就报密钥未设置。
当前**不可经标准写路径触发**（`provider.service.ts:75` 只在 `input.apiKey` truthy 时 set；
:140-147 把 `""` 当删除），属结构性分歧而非现行 bug。
**建议**：`providerApiKeyIsConfigured` 改用 `get(ref)` 并复用同一非空判定，或抽一个共用的
`readConfiguredKey(provider, secretStore): Promise<string|null>` 让两者共用。
**置信**：confirmed

### F-core-provider-10 | P3 | `model/saved-model-settings.schema.ts:129`
`export const savedModelSettingsDocumentSchema = savedModelSettingsSchema;` —— 标了
`@deprecated ... 保留别名供旧引用`，但全仓**零引用**（只出现在自己的定义行）。
同族：`savedModelSettingsV2DocumentSchema`（:78）与 `thinkingLevelSchema`（:26）也仅在
本文件内自用/未用（`thinkingLevelSchema` 只被 :59 的 generation schema 用，`V2DocumentSchema`
只被 :113 的 `savedModelSettingsV2ToMemorySchema` 用，两者都未出 barrel）。
**建议**：删 `savedModelSettingsDocumentSchema`；另两个降为模块私有（去掉 `export`）。
**置信**：confirmed

### F-core-provider-11 | P3 | `model/saved-model.ts:33-43`
```ts
export type SavedModelView = SavedModel & { readonly displayName: string };
export function toSavedModelView(model, providerDisplayName) { ... }
```
`toSavedModelView` 与 `SavedModelView` 只出现在本文件 + `public/provider.ts:48` 的 barrel 转出，
**零消费方**。而实际在用的是 `savedModelDisplayName`（同文件 :25），desktop main IPC 三个 handler
都直接调它拼字符串（`apps/desktop/src/main/ipc/handlers/{agent,prompt,provider-models}.ts`）。
**建议**：删 `toSavedModelView` / `SavedModelView` 及 barrel 转出。
**置信**：confirmed

### F-core-provider-12 | P3 | `model/protocol-sampling-defaults.ts:70`
`maxOutputTokensFromSampling` 只在自身 + `public/provider.ts:42` + 一个测试里出现，零生产消费。
同理 `model/model-sampling-params.ts:42` 的 `samplingProtocol`、`model/model-thinking-params.ts:41`
的 `thinkingProtocol`（两个都是 `params?.protocol` 一行取属性）。
**建议**：三个一起删（含 barrel 行）。`params?.protocol` 想用直接写 `.protocol` 即可。
**置信**：confirmed

### F-core-provider-13 | P3 | `model/thinking-level-options.ts:10, 18` + `model/token-counter-mode-options.ts:10, 20`
两个文件各维护**两份同成员枚举**：一份裸值数组（`*_OPTIONS`），一份 value+中文 label 数组
（`*_SELECT_OPTIONS`）。双端 UI 全部用 SELECT 版；裸值版零生产消费
（`TOKEN_COUNTER_MODE_OPTIONS` 仅被 `test/infra/tokenizer/token-counter-mode-no-public-path.test.ts` 引）。
两处都是「同一个枚举写两遍、加档位要改两处」的形状。
**建议**：删裸值数组，或反过来让 SELECT 版从裸值数组 `map` 出来 + 单独的 label 字典，
保证单一数据源。
**置信**：confirmed

### F-core-provider-14 | P3 | `model/saved-model-settings.schema.ts:113-120` + `model/model-suggestion-cache.schema.ts:26-32`
```ts
const savedModelSettingsV2ToMemorySchema = savedModelSettingsV2DocumentSchema.transform(
  (doc): SavedModelSettings => ({ schemaVersion: 2, internal: doc.internal, generation: doc.generation })
);
```
两个 `.transform` 的输出与输入**结构完全相同**（纯 identity 搬运，零字段映射/零默认值填充），
只是换了个类型名。属于「以为在归一化、其实什么都没做」的噪音。
**建议**：`savedModelSettingsV2DocumentSchema` 的推导类型本就等于 `SavedModelSettings`，直接
`z.union([v1Schema, v2DocumentSchema])` 即可；suggestion cache 同理。
**置信**：confirmed

### F-core-provider-15 | P3 | `logic/resolve-thinking-wire.ts:76-88`
```ts
export function resolveThinkingParamsForLevel(level, protocol, sampling, vendorModelId) {
  return thinkingLevelToModelThinkingParams(level, protocol, vendorModelId, sampling);
}
```
零值透传：签名逐参数一致、只调一次并原样返回（注意参数顺序还被悄悄换成了
`vendorModelId, sampling`）。唯一消费方 `service/provider/impl/model-request.service.ts:12,195`
完全可以直接引 `thinkingLevelToModelThinkingParams`。它与本体分处两个文件还制造了 F-3 的环。
**建议**：删该函数，调用方改引 `thinkingLevelToModelThinkingParams`。
**置信**：confirmed

### F-core-provider-16 | P3 | `logic/thinking-level-presets.ts:28-31`
```ts
  const id = vendorModelId.toLowerCase();
  return id.includes("gemini-3") || id.startsWith("gemini-3.");
```
第二个条件被第一个完全包含（`"gemini-3.xxx".startsWith("gemini-3.")` 蕴含
`"gemini-3.xxx".includes("gemini-3")`），恒为冗余分支。
**建议**：删 `|| id.startsWith("gemini-3.")`。
**置信**：confirmed

### F-core-provider-17 | P3 | `model/model-thinking-params.ts:23` + `model/model-thinking-params.schema.ts:25`
```ts
  readonly thinkingLevel?: string;
  // schema
    thinkingLevel: z.string().optional(),
```
同一 union 里，anthropic 是 `type: "enabled"` 字面量、openai 是 `reasoning_effort: z.enum([...])`，
唯独 gemini 的 `thinkingLevel` 是**不受约束的 string**。拼错的档位（`"hgih"`）能过 schema 直接上线。
实际写入方 `thinking-level-presets.ts:72` 传的是受 `ThinkingLevel` 约束的值，所以目前无害——
但 schema 是持久化/校验边界，放宽类型等于放弃这一层的牙齿。
**建议**：改 `z.enum(["low","medium","high"])`（"off" 在上游 `level === "off"` 已早退，永不出现）。
**置信**：confirmed

### F-core-provider-18 | P3 | `repositories/impl/sqlite-provider.repository.ts:19-48`
`parseHeaders`（:19）与 `parseBodyParams`（:38）是近乎逐行重复的两个函数：同样的
`JSON.parse` → null/非对象/数组 → `{}` → try/catch 兜底 `{}`，唯一差别是 `parseHeaders` 多一层
`typeof v === "string"` 过滤。
**建议**：抽 `parseJsonObject(json): Record<string, unknown>` 单一入口，`parseHeaders` 在其上做
string 过滤。
**置信**：confirmed

### F-core-provider-19 | P3 | `repositories/impl/sqlite-saved-model.repository.ts:14-15`
```ts
import { savedModelSettingsFromJson } from "../../model/saved-model-settings-from-json.js";
import { savedModelSettingsToJson } from "../../model/saved-model-settings-from-json.js";
```
同一模块的两条 import 语句，可合并。纯格式问题。
另 `logic/find-saved-model-references.ts:16` 用**模块级共享** `new SqlTemplateParser()`，
而两个 SQLite repo 用的是**实例级**私有 parser（`sqlite-provider.repository.ts:76`）——
共享实例会被并发删除请求同时使用，与本仓其余 parser 用法不一致。
**建议**：合并 import；把 parser 改为函数内 new 或实例字段。
**置信**：confirmed

### F-core-provider-20 | P3 | `logic/assert-saved-model-uuid.ts:27-33`
```ts
  if (trimmed.includes("/")) {
    throw new ProviderError("INVALID_SAVED_MODEL_ID", `... (legacy path not accepted) ...`);
  }
  if (!isSavedModelUuidFormat(trimmed)) { ... }
```
第一个检查被第二个完全覆盖（合法 UUID 不可能含 `/`），唯一价值是错误文案更具体。
不算 bug，属可接受的诊断优化，仅登记为冗余。
**建议**：可保留（文案有诊断价值），但值得在注释里说明它只为错误信息存在。
**置信**：confirmed

### F-core-provider-21 | P3 | `model/default-saved-model-settings.ts:28` vs `model/saved-model-settings.schema.ts:59`
新建已保存模型默认 `thinkingLevel: "high"`，而读盘时缺失 `thinkingLevel` 的老行由 schema
`.default("off")` 回填为 `"off"`。同一个字段在「新建」与「读旧行」两条路径上是**两个相反的默认**
（一个默认开思考、一个默认关）。文件头注释只说明了后半句（:13）。
**建议**：至少在注释里点明「新建默认 high、legacy 回填 off」是有意差异；或统一口径。
**置信**：confirmed（差异存在）/ suspected（是否有意——无出处可引）

### F-core-provider-22 | P3 | `logic/derive-model-name-from-legacy.ts:8`
`deriveModelNameFromLegacy`（saved-model-identity-v1 的旧 display_name → model_name 推导规则）
只有自身 + `test/provider/derive-model-name-from-legacy.test.ts` 引用，**零生产消费方**。
按 RULE 的迁移退役节奏约定，该迁移早已退役（RULE「实现禁令与坑」条目提到退役迁移源文件与
专属测试**物理删除**），此处源文件与测试都还在。
**建议**：连同专属测试物理删除。
**置信**：confirmed

## 争议与存疑

1. **F-1 的定级（我给 P1，不排除 W5 降 P2）**。降级理由：后果是显式报错
   （`assertSavedModelUuid` 抛 `Saved model not found`），不是静默数据损坏，用户可自行改选模型恢复；
   且 `deleteSaved` 只是删除路径之一。升级理由：守卫函数的 doc 明确承诺「Empty when safe to delete」，
   而它在最主流的 pin 场景（会话级 modelId）下就是漏的，承诺与实现不符。**本轮未实测**
   「建会话→选模型→删模型→开跑」的真实复现链，只做了代码路径推导。

2. **F-6 的性能量级未实测**。O(N²) 的结构是从 `upsert` 实现 + 调用方循环推出来的，
   没有跑过 500 模型的 fetch，也没量过单次 KKV 写的耗时。若 provider 模型数普遍 <50，
   实际影响可能不值一次改造。

3. **F-5 里哪些派生该留，取决于域外调用方是否计划恢复**。我按「当前零引用」判死，
   但 `BUILTIN_UUID_TO_KEY` / `BUILTIN_KEY_TO_UUID` 这对双向映射看起来是给「跨库合并时撞 id」
   场景预留的（与 F-7 的 `createProviderSecretRenameOperation` 同一猜想）。若那条线确实在规划中，
   应标 intentional 而非直接删。我倾向删——RULE 的迁移退役节奏表明本仓偏好物理删除而非预留。

4. **`normalizeGenerationForRead`（`model/saved-model-settings.schema.ts:32-52`）我判为可接受，未列为发现**。
   它自称 dev-only（:28-31「不写入 v1.2.7 用户迁移义务；仅减轻本地 dev 库残留」），把未发布的
   `thinking.enabled` 形态映射成 `thinkingLevel`。写法上 `const generation = raw as Record<string, unknown>`
   这个别名有点误导（`raw` 本身就是 generation 子对象，变量名却像是要取 `raw.generation`），
   但读下来语义正确，不构成缺陷。**存疑点**：一个自称 dev-only 的兼容分支会长期留在生产
   schema 里，且它对 v1/v2 文档都生效（v2 canonical 若混入 `thinking` 键会被它静默吃掉而不是
   被 `.strict()` 拒掉）。这算不算「schema 校验与实现不一致」，我拿不准——判为遗留兼容、不报。

5. **F-9 的可达性我判为「当前不可触发」而非「结构性分歧」**。分歧本身 confirmed（两个函数读同一份
   数据判定不同），但要真正暴露需要有人往 SKSP 写入空串。`provider.service.ts` 的两条写路径都堵住了，
   唯一的缝是 `secretRef` 可被指向一个第三方 ref。我没有排查 `sksp` 是否有别的写入方（跨 zone）。

6. **跨 zone 观察（不计入本区发现，供 synth 阶段接线）**：
   `service/provider/impl/provider.service.ts:211-260` 的 `delete(provider)` 走
   `savedModels.deleteByProvider(id)` 批量删该 provider 的全部已保存模型，
   **完全不经过 `findSavedModelReferences` 的 in-use 守卫**。也就是说即便 F-1/F-2 的守卫补全了，
   「删服务商」这条路依然能静默抹掉被会话/agent 引用的模型。这条落在 service 区，但与 F-1 同源，
   建议 W5 合并处理。
