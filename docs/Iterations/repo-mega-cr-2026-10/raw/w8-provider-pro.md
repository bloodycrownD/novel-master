---
zone: w8-provider-pro
agent: 检察官（prosecutor / 猎杀冗余·死路径·竞态·契约不一致）
files_scanned: 44
---

# W8 · provider 域对抗机位报告（检察官）

## 摘要

本区是 LLM 服务商配置与模型调用的全链路：provider CRUD（跨 secretStore 的补偿式写）、已保存模型
（saved model UUID）与其 per-model 设置（上下文窗口 / token 计数模式 / 采样 / 思考档位）、
模型拉取（建议缓存，KKV 承载）、以及最终发往协议适配器的 `ModelRequestService`（含重试族）。
共 44 个文件 / 3237 行，全量逐行读完。

## 职责与边界

- **domain/provider/model** — 纯类型与纯函数：实体（`LlmProvider` / `SavedModel` / `SavedModelSettings`
  v2）、Zod schema、协议默认值表、思考档位 preset。
- **domain/provider/logic** — 领域纯逻辑：应用模型 id 归一、UUID 断言、API key 解析、思考参数解析、
  引用反查、provider 双身份键修复。
- **domain/provider/repositories** — 三个 port + 两个 SQLite 实现 + 一个 KKV 实现。
- **service/provider** — 四个 service（provider / provider-model / model-request / model-retry-policy）
  与两个工厂。跨资源写走 `CoordinatedWrite` 补偿，不开事务。

不在本区：`infra/llm-protocol/**`（适配器与传输）、`infra/sksp/**`（密钥库）、`infra/tokenizer/**`
（分词器）。本报告在需要确认契约时读了这些文件，但只作为**跨边界证据**引用。

## 对外接口

`packages/core/src/public/provider.ts` 是唯一出口。关键类型：
`LlmProvider` / `SavedModel` / `SavedModelSettings` / `SavedModelSettingsPatch` / `ThinkingLevel` /
`ModelSamplingParams` / `ModelThinkingParams` / `TokenizerOverride`；
服务面：`ProviderService` / `ProviderModelService` / `ModelRequestService` /
`ModelRetryPolicyService` / `createProviderServices` / `createModelRetryPolicyService`；
逻辑面：`normalizeVendorModelId` / `assertSavedModelUuid` / `resolveProviderApiKey` /
`resolveThinkingParamsForLevel` / `resolveEffectiveMaxTokens` /
`inferLlmProtocolFromSavedModelId` / `resolveTokenCounterModeForModel` /
`applySavedModelSettingsPatch` / `savedModelSettingsFromJson` / `savedModelSettingsToJson`。

## 数据访问

| 载体 | 位置 | 证据 |
|---|---|---|
| 表 `llm_provider` | 11 列 CRUD | `domain/provider/repositories/impl/sqlite-provider.repository.ts:84-86, 111-117, 138-146, 164` |
| 表 `llm_saved_model` | 7 列 CRUD | `repositories/impl/sqlite-saved-model.repository.ts:42-44, 54-55, 68-72, 89-93, 114-118` |
| 表 `chat_session` | **未被本区访问**（见 F-01） | `bootstrap/chat/chat-schema.ts:16-25` |
| 表 `chat_project` | 只读 `agent_config_json` | `logic/find-saved-model-references.ts:69` |
| 表 `agent_definition` | 只读 `agent_id, prompts_json` | `logic/find-saved-model-references.ts:52` |
| 表 `kkv_entry` | 只读 `nm-workspace-state` / `currentModelId` | `logic/find-saved-model-references.ts:41-43` |
| KKV `nm-model-suggestions` | per-provider 建议缓存整文档读写 | `repositories/impl/kkv-model-suggestion.repository.ts:16, 96, 107, 121` |
| KKV `nm-model-retry` | 重试策略 | `service/provider/impl/model-retry-policy.service.ts:17-18` |
| SKSP `provider/{id}/apiKey` | 密钥（跨 composite env/db 两层） | `domain/provider/model/provider.ts:27-29` |

## 依赖关系

- **入向**：`public/provider.ts` → 三端 runtime（`apps/cli` / `apps/desktop` / `apps/mobile` 累计 39 次
  subpath import）；`service/compaction-conditions/create-compaction-condition-evaluator.ts:58-62`
  消费 `getContextWindow` / `getTokenCounterMode`；`apps/desktop/src/main/services/chat-prompt-tokens.service.ts:312`
  与 `apps/mobile/src/services/chat-prompt-tokens.service.ts:178` 消费 `resolveTokenCounterModeForModel`。
- **出向**：`infra/llm-protocol`（适配器注册表）、`infra/sksp`（SecretStore）、`infra/tokenizer`
  （`seedContextWindowTokens` / `read-token-counter-mode-pref`）、`service/kkv`、`service/coordinated-write`、
  `service/persistent-state`（`workspace-state-keys`）、`service/integrity-repair`（类型）。

## 发现清单

### P1

**F-w8-01 | P1 | `packages/core/src/domain/provider/logic/find-saved-model-references.ts:32-93`**
```
const kkvRows = await queryTemplate(... `SELECT value FROM kkv_entry WHERE module = ... AND key = ...`)
const projectRows = await queryTemplate<ChatProjectRow>(conn, parser,
  `SELECT id, agent_config_json FROM chat_project`, {})
```
引用反查只覆盖三处：KKV `currentModelId`、`agent_definition.prompts_json.model`、
`chat_project.agent_config_json.definition.model`。**漏掉了唯一一处活的模型指针：
`chat_session.agent_config_json.modelId`**。`SessionAgentConfig` 明确写着「可选 `modelId` 覆盖
agent pin 的模型」（`domain/chat/model/session-agent-config.ts:18-21`），RULE 也把它列为常设能力
（`docs/apm/RULE.md:36`）。于是 `DefaultProviderModelService.deleteSaved`（`service/provider/impl/provider-model.service.ts:173-188`）
的守卫会对一个仍被会话引用的模型放行：模型行被物理删除，会话里留下悬空 UUID。表上没有外键，
`llm_saved_model` 也没有 `ON DELETE` 约束（`sqlite-saved-model.repository.ts:103-111` 是裸 DELETE）。
运行期表现是该会话下次发消息时在 `assertSavedModelUuid` 处报 `INVALID_SAVED_MODEL_ID`，
而 UI 上没有任何解释「模型被别的会话用着」。
**建议**：`findSavedModelReferences` 增加 `SELECT id, agent_config_json FROM chat_session` 一段，
读 `modelId` 字段；或更彻底地，考虑在 `llm_saved_model` 上加引用计数。
**置信**：confirmed（`chat_session` 无 `model_id` 列，模型指针只可能落在 `agent_config_json`，
`chat-schema.ts:16-25` 已确认）。

**F-w8-02 | P1 | `packages/core/src/service/provider/impl/model-request.service.ts:69-104, 211-243`**
```
if (error instanceof LlmStreamTimeoutError) { return error.phase === "first-chunk"; }
if (!(error instanceof ProviderError)) {
  // Unknown transport/runtime failures are treated as transient once.
  return true;
}
```
第 73-77 行的注释写死了意图：「流中断（idle，**已有部分输出**）不重试，避免重复输出/重复计费」。
但这条规则**只对 `LlmStreamTimeoutError` 生效**。适配器侧确实会把非 abort 的原始错误直接上抛
（`infra/llm-protocol/impl/openai.adapter.ts:224-228`：非 `isRequestAborted` 一律 rethrow），
而 `feedOpenAiSseChunk` 早已通过同一个 `req.onStream` 吐过 delta。于是一条流中 `TypeError`
（连接重置 / SSE 解析炸）会命中 `!(error instanceof ProviderError) → true`，重试循环拿
**同一个 `onStream`** 再调一次 `adapter.chat`（`model-request.service.ts:214-230`），
消费方收到第二段流。结果是重复输出 + 重复计费。
代码里没有任何「本次尝试是否已产出」的标志位。
**建议**：在重试判定里引入 `emittedAny` 状态（`onStream` 包一层计数），
或把 `isRetryableError` 的未知错误分支改为「仅当 `!options.stream` 或零产出才可重试」。
**置信**：confirmed（代码路径可逐行走通；实际用户可见损害程度取决于 `agent-runner` 的
累加语义，本机位未越界验证）。

### P2

**F-w8-03 | P2 | `service/provider/impl/provider-model.service.ts:80-92` + `domain/provider/repositories/impl/kkv-model-suggestion.repository.ts:44-65`**
```
for (const m of result.models) {
  ...
  await this.deps.suggestions.upsert({ providerId, vendorModelId, displayName, ... });
}
```
`upsert` 的实现是**整文档读-改-写**：`readCache` 全量 parse 整个 `models` 数组，改一个元素，
再 `JSON.stringify` 全量写回。N 个模型 ⇒ N 次读 + N 次全量写 = **O(N²)** 序列化。
一次 Gemini/OpenRouter 拉取（几十到上百个模型）意味着上百次 KKV 全量覆写，
每次都是一条新的 `kkv_entry` 行（KKV 无覆盖写优化）。
更严重的是**丢更新竞态**：两次并发 `fetch()` 同一 provider，各自基于自己读到的快照写回，
后写者覆盖先写者，整轮拉取结果可能部分丢失。`fetch` 也没有 in-flight 去重
（对比 RULE 里 workplace 的 `liveViewInFlight` 约定）。
**建议**：`ModelSuggestionRepository` 增加批量 `upsertMany(providerId, entries[])`，
单次读 + 单次写；`fetch` 加 provider 级 in-flight promise 去重。
**置信**：confirmed。

**F-w8-04 | P2 | `service/provider/impl/provider-model.service.ts:84-92`**
```
await this.deps.suggestions.upsert({ ..., stale: false, lastSeenAtMs: Date.now() });   // 循环内
...
await this.deps.suggestions.markStaleExcept(providerId, seen);                          // 循环后
```
`markStaleExcept` 的后半段（`kkv-model-suggestion.repository.ts:79-87`）把 `seen` 里的每个
id 重写成 `{stale:false, lastSeenAtMs: now}`——**这正是循环里 `upsert` 刚写过的内容**。
两次全量读写，只为让 `lastSeenAtMs` 从「循环内某时刻」变成「循环结束时」。
既冗余又让 F-03 的 O(N²) 再翻一倍。
**建议**：`fetch` 只调 `markStaleExcept`（让它承担 seen 的 upsert 语义），删掉循环内 upsert。
**置信**：confirmed。

**F-w8-05 | P2 | `domain/provider/logic/provider-identity-repair.ts:1-153`（整文件）**
```
const reports = await new IntegrityRepairRegistry()
  .register(createVfsEntrySequenceRepairOperation(conn))
  .runAll();
```
全仓扫描：`createProviderIdentityRepairOperation` 与 `createProviderSecretRenameOperation`
**只出现在本文件与它自己的测试里**，生产侧从未 `register`。
`bootstrap/novel-master-bootstrap.ts:388-389` 把这件事说得很明白：
「历史：这里曾另有 entry-id migration 刚跑完时的 ref_count / **provider 身份键兜底修复分支**，
随 vfs-entry-id-redesign-v1 退役（最低支持 v1.4.27）一并移除。」
也就是说这 153 行（含 62 行块注释、自述为「defense-in-depth」）是**退役后未清理的残留**，
还带着一个已被否定的承诺：读者会以为 provider 双身份键不变量有运行时兜底，实际没有。
文件头还把 `createRevisionRefCountRepairOperation` 列为对照方（「本模块只校验…不碰 vfs 的两套 ref_count」）。
**建议**：随 provider-identity-v1 迁移退役一并物理删除本文件 + `provider-identity-repair.test.ts`
（RULE 已有同款先例：「退役迁移的源文件与专属测试**物理删除**（非保留）」）。
若要保留「运行时镜像」语义，则必须在 bootstrap 注册。
**置信**：confirmed。

**F-w8-06 | P2 | `domain/provider/logic/resolve-provider-api-key.ts:26-28, 47-58`**
```
const stored = await secretStore.get(ref);
if (stored != null && stored !== "") { return stored; }        // 解析侧："" 视为未配置
...
if (await secretStore.has(ref)) { return true; }                // 状态侧：只看存在性
```
同一个 SKSP ref，两个判定口径不一致：`resolveProviderApiKey`（发请求用）把空串当未配置并回落
内置默认、最终可能抛 `API_KEY_NOT_SET`；`providerApiKeyIsConfigured`（`ProviderService.list`
的 `apiKeyStatus` 字段用，`service/provider/impl/provider.service.ts:56, 276-282`）
只看行是否存在，空串密钥照样显示 `set`。
`has` 是纯存在性检查（`infra/sksp/impl/base-sqlite-secret-store.ts:58`），
所以空串行确实能造成「UI 说配好了、一发请求就报没配 key」。
写入侧目前挡得住（`create` 的 `input.apiKey ? ... : null` 与 `edit` 的 `=== ""` → delete，
见 F-w8-16），但 SKSP 是共享存储，备份导入 / 其它写入方不受这两个门约束。
**建议**：`providerApiKeyIsConfigured` 改走 `get()` 并复用同一套「空串 = 未配置」判据，
或把判据抽成 `isUsableApiKeyValue(v)` 单一函数，两处共用。
**置信**：confirmed（不一致是确定的；空串可达性为 suspected）。

**F-w8-07 | P2 | `service/provider/impl/provider-model.service.ts:168-189`**
```
const existing = await assertSavedModelUuid(savedModelId, this.deps.savedModels);  // 内部 trim
...
const ok = await this.deps.savedModels.deleteById(savedModelId);                     // 用未 trim 的
```
`assertSavedModelUuid` 全程用 `savedModelId.trim()` 做校验与查询（`domain/provider/logic/assert-saved-model-uuid.ts:26, 41`），
但 `deleteSaved` 返回后拿**原始未 trim 的串**去 `deleteById`。
`" <uuid> "` 能通过 UUID 校验、查得到行（于是引用检查正常跑），删的时候 `WHERE id = ' <uuid> '` 匹配不到 →
`deleteById` 返回 false → 抛 `NOT_FOUND: Saved model not found: <带空格的 id>`。
对照同文件的 `updateSettings`（`provider-model.service.ts:229-235`）用的是
`{...existing, ...}` 展开的 `existing.id`，天然是 DB 里的规范值，所以没这个问题。
**建议**：`assertSavedModelUuid` 改返回 `{ id, model }`，或在 `deleteSaved` 里用 `existing.id`。
**置信**：confirmed。

**F-w8-08 | P2 | `domain/provider/logic/application-model-id.ts:40-68`**（实测）
```
if (value.startsWith(providerPrefix)) { return value.slice(providerPrefix.length); }
try {
  const parsed = parseApplicationModelId(value);
  if (parsed.providerId === providerId) { return parsed.vendorModelId; }   // ← 提前 return
} catch { }
if (value.startsWith("models/")) { value = value.slice("models/".length); } // ← 够不着
```
`models/` 前缀的剥离**只发生在 `models/` 既是裸前缀、又不是 application id 形态的分支**。
一旦值形如 `{providerId}/models/xxx`，第 56-57 行的 `return` 抢先跳出，`models/` 原样留在结果里。
实测（本机位跑了一遍同源逻辑）：
```
"models/gpt-4o"           -> "gpt-4o"
"openai/models/gpt-4o"    -> "models/gpt-4o"     ← 不一致
```
同一函数对同一厂商的同一模型产出两种 `vendorModelId`，会直接分裂 `llm_saved_model.vendor_model_id`
与 `llm_saved_model` 的展示名（`formatSavedModelDisplayName` 会渲染成 `OpenAI/models/gpt-4o`），
并让 `usage-stats.service.ts:83` 的 `SELECT DISTINCT vendor_model_id` 多出一行。
**建议**：把 `models/` 剥离提到 `parseApplicationModelId` 命中分支**之后**、所有 return 之前。
**置信**：confirmed（实测输出见上）。

**F-w8-09 | P2 | `domain/provider/logic/find-saved-model-references.ts:55-64, 72-90`**
```
const wire = JSON.parse(String(row.prompts_json)) as Record<string, unknown>;
...
const config = JSON.parse(String(raw)) as Record<string, unknown>;
```
两处 `JSON.parse` 都在全表循环里、无 try/catch。`prompts_json` 是 `TEXT NOT NULL` 但**没有
`json_valid()` CHECK**（`bootstrap/agent/agent-schema.ts:11` 只对 `chat_project`/`chat_session`
那两列加了 CHECK，`agent_definition` 没有）。仓库自己承认这种坏行存在——
`service/agent/impl/agent-registry.service.ts:151` 的注释写着「否则**非法 prompts_json 的 agent
永远卡在库里删不掉**」，并为此专门加了容错删除路径（配套测试
`test/agent/agent-registry-delete-invalid.test.ts` 就在构造这种行）。
同一个库里，一条坏 `prompts_json` 会让 `deleteSaved` 抛一个裸 `SyntaxError`
（不是 `ProviderError`，UI 侧多半显示成未知错误），且**每一条已保存模型都删不掉**。
对比同库的 `sqlite-provider.repository.ts:19-48`，`parseHeaders` / `parseBodyParams`
两个 JSON 列解析都写了容错——本区的容错口径不统一。
**建议**：两处 parse 包 `try/catch` 跳过坏行（引用检查是「尽量发现」，不是「必须全读」）。
**置信**：confirmed。

**F-w8-10 | P2 | `domain/provider/logic/resolve-thinking-wire.ts:11-15` ⇄ `logic/thinking-level-presets.ts:11`**
```
import { resolveEffectiveMaxTokens } from "./resolve-thinking-wire.js";   // presets → wire
...
import { thinkingLevelToModelThinkingParams } from "./thinking-level-presets.js";  // wire → presets
```
两个模块互相 import，构成环。`resolve-thinking-wire.ts:76-88` 的
`resolveThinkingParamsForLevel` 又是一个**零增值转发**——四参原样传给
`thinkingLevelToModelThinkingParams`，只多了一层函数壳（该函数被 public 面导出，
`public/provider.ts:78`，算是「对外 API 皮」，但皮下面就是环）。
RULE 里点名过这类风险：「模块级 import 的 require-cycle 在依赖解析顺序变化时才暴露运行时错误
（worktree 没炸主仓炸）」。
**建议**：把 `resolveEffectiveMaxTokens` 与 `ANTHROPIC_BODY_DEFAULT_MAX_TOKENS` 下沉到一个
无依赖的 `logic/thinking-budget.ts`，两个 preset 模块都从它取，环即消。
**置信**：confirmed。

**F-w8-11 | P2 | `domain/provider/logic/infer-llm-protocol-from-model-id.ts:19-52`**
```
const saved = await savedModels.findById(savedModelId.trim());
if (saved == null) { return "anthropic"; }
...
} catch { return "anthropic"; }
```
四条失败路径（模型不存在 / 没传 `providers` / provider 查不到 / 任何异常）全部静默回落
到硬编码的 `"anthropic"`，`catch` 是裸的，连原因都不留。
`providers` 是**可选参数**（第 22 行 `providers?`），意味着这个函数的正确性依赖调用方记得传——
而两处回落分支中「没传」和「传了但查不到」是同一个结果，调用方无从区分。
导出的名字是 `inferLlmProtocolFrom...`，实际语义是 `guessAnthropicUnlessConvincedOtherwise`。
用于导出/分享等路径时，猜错协议会让内容映射器用错线格式，且不报错。
**建议**：改为「查不到就抛 `ProviderError`」，或至少把 `providers` 提为必填；
默认值若是产品拍板，请在 JSDoc 里写明「默认 anthropic 是 XX 拍板」并引用出处。
**置信**：confirmed（行为）/ suspected（默认值是否为拍板，见「争议与存疑」）。

### P3

**F-w8-12 | P3 | `service/provider/impl/provider-model.service.ts:36, 53-60`**
```
readonly providerRepo: ProviderRepository;   // DefaultProviderModelServiceDeps
...
const providerModels = new DefaultProviderModelService({ providers, providerRepo, ... });
```
注入的 `providerRepo` 在 `DefaultProviderModelService` 全文件**零引用**（`this.deps.providerRepo`
一次都没出现）。类内所有 provider 访问都走 `this.deps.providers`（service 层的 `ProviderService`）。
`create-provider-services.ts:56` 还为此专门传了 `providerRepo`。
**建议**：删依赖字段与传参。
**置信**：confirmed。

**F-w8-13 | P3 | `service/provider/impl/provider-model.service.ts:123-125` + `provider-model.port.ts:14`**
```
async create(providerId: string, vendorModelId: string): Promise<SavedModel> {
  return this.save(providerId, vendorModelId);
}
```
`ProviderModelService.create` 是 `save(providerId, vendorModelId)` 的空壳别名。
全仓扫描：生产侧（cli / desktop / mobile / core src）**零调用**，只有 `packages/core/test/**`
在用（14 处 `providerModels.create`）。生产走的是 `save`（`apps/cli/src/provider/model/commands.ts:86`）。
两个名字留在 port 上会让调用方以为语义有别。
**建议**：删 `create`，测试改调 `save`。
**置信**：confirmed。

**F-w8-14 | P3 | 多处（本区 6 个文件）**
全仓 2307 文件符号扫描（排除本区自身目录），**生产侧零引用**的导出：
`builtinProtocolByProviderId`（`builtin-providers.ts:140`，还挂着 `@deprecated`）、
`BUILTIN_PROVIDER_IDS`（同文件 :125，`@deprecated` 别名）、
`inferLlmProtocolFromApplicationModelId`（`infer-llm-protocol-from-model-id.ts:55`，
经 `public/provider.ts:25` 出了 public 面但无人用）、
`samplingProtocol`（`model-sampling-params.ts:42`）、`thinkingProtocol`（`model-thinking-params.ts:41`）、
`toSavedModelView` + `SavedModelView`（`saved-model.ts:33-43`）、
`savedModelSettingsDocumentSchema`（`saved-model-settings.schema.ts:129`，
自己标了 `@deprecated` 保留别名）、`savedModelSettingsV2DocumentSchema`（同文件 :78，
只在同文件内部被用，导出无意义）、`thinkingLevelSchema`（同文件 :26，同上）、
`deriveModelNameFromLegacy`（`logic/derive-model-name-from-legacy.ts:8`，
只为已退役的 saved-model-identity 迁移而存在，生产零引用，只剩自测）、
`modelThinkingParamsSchema` 整个模块（`model-thinking-params.schema.ts:36`，
`ModelThinkingParams` 是从档位派生的、从不落库，所以这份 schema 从未被生产校验过）。
**建议**：走 knip / 一次性清理；至少把两个 `@deprecated` 别名和 `deriveModelNameFromLegacy`
按 RULE「10 个版本后清下一轮」的节奏登记退役。
**置信**：confirmed（扫描口径：packages + apps，排除本区目录；docs 另核）。

**F-w8-15 | P3 | `service/provider/impl/provider-model.service.ts:141-157`**
```
if (modelName === null) { throw new ProviderError("INVALID_MODEL_NAME", "modelName must not be empty", { modelId: savedModelId }); }
if (modelName !== undefined) { const trimmed = modelName.trim(); if (trimmed.length === 0) { throw new ProviderError(..., { modelId: savedModelId }); } ... }
```
两个问题叠在一起：
① 按 port 声明 `editSaved(savedModelId: string, modelName?: string)`（`provider-model.port.ts:17`），
`modelName === null` 在类型上不可达——它只在 IPC 边界未做类型收窄时才会命中，
而同一行的 `=== undefined` 分支已经覆盖了合法输入。半防御代码。
② 两个 throw 的 error 载荷不一致：`null` 分支带 `{ modelId }`，空串分支带 `{ modelId }` 但**少了
`providerId`**（对照同文件 `updateSettings:208` 三个校验分支全都带 `{ modelId, providerId }`）；
`save` 路径上的 `resolvePersistedModelName`（`provider-model.service.ts:53-57`）更干脆——**两个
payload 字段都不带**。三处同类校验三种载荷。
**建议**：抽一个 `assertModelName(name, { savedModelId, providerId })`；`null` 与空串合并为一条。
**置信**：confirmed。

**F-w8-16 | P3 | `service/provider/impl/provider.service.ts:75` vs `:141-143`**
```
const secretRef = input.apiKey ? providerApiKeyRef(id) : null;      // create："" 当「没传」
...
if (patch.apiKey === "") { secretOp = "delete"; secretRef = null; }  // edit："" 当「清除」
```
空串在两条路径上语义相反：create 视作未提供（不写密钥、`secretRef` 留 null），
edit 视作显式清除（删密钥、`secretRef` 置 null）。port 的 JSDoc 只在 `EditProviderPatch.apiKey`
上写了注释，`CreateProviderInput.apiKey` 无任何说明（`service/provider/provider.port.ts:12, 23`）。
严格说 create 侧「本来就没东西可清」不算错，但契约没写、且两个方法在同一个 port 上对同一个空串
给出不同反应，调用方很容易踩。
**建议**：在 `CreateProviderInput.apiKey` 上写明「空串等同未提供」，或让 create 也走显式三态。
**置信**：confirmed（行为）/ suspected（是否有意）。

**F-w8-17 | P3 | `service/provider/impl/provider.service.ts:51-59, 132-135`**
```
// list()
return Promise.all(rows.map(async (p) => ({ ...p, apiKeyStatus: await this.apiKeyStatus(p) })));
// edit()：无论 patch 是否碰 apiKey，都先读一次原始明文
const originalSecretValue = await this.deps.secretStore.get(originalSecretRef);
```
① `list()` 是 N+1 的 SKSP 访问（`providerApiKeyIsConfigured` 内部先 `has` 再可能 `get` 回退判定，
见 `resolve-provider-api-key.ts:47-58`），且任一 provider 的密钥库异常会让**整个列表**失败
（`Promise.all` 无隔离）。
② `edit()` 无条件把密钥明文读进内存，即使 patch 只改 `displayName`——`originalSecretValue`
只在 `secretOp !== "noop"` 时才被 rollback 用到。多一次明文解密读取，且扩大了明文在内存里的存活面。
**建议**：`edit` 把 `secretStore.get` 挪进 `if (patch.apiKey !== undefined)` 分支；
`list` 的 `apiKeyStatus` 加 try/catch 降级为 `"not set"`。
**置信**：confirmed。

**F-w8-18 | P3 | `service/provider/impl/provider-model.service.ts:239-248`**
```
const existing = await assertSavedModelUuid(savedModelId, this.deps.savedModels);
const defaults = defaultSavedModelSettings(existing.vendorModelId);
return this.updateSettings(savedModelId, { contextWindowTokens: defaults.internal.contextWindowTokens });
```
`updateSettings` 内部又 `assertSavedModelUuid` 一次（`:195-198`），于是「重置上下文窗口」
这一次操作做了**两次** `findById` 查询 + 两次 `updateById` 前的完整 settings 解析。
同文件 `editSaved`（`:136`）也有一份 `existing` 用于取值，但那条路径只查一次。
**建议**：`updateSettings` 拆一个 `updateSettingsInternal(existing, patch)` 供两处复用。
**置信**：confirmed。

**F-w8-19 | P3 | `service/provider/create-provider-services.ts:40, 51`**
```
const kkv = createKkvService(conn);            // 第 40 行
const retryPolicies = createModelRetryPolicyService(conn);   // 第 51 行，内部又 createKkvService(conn)
```
同一个 `conn` 上建了两个独立的 KKV service 实例。是否共享连接池取决于
`createKkvService` 实现，但语义上这是两份本该同源的句柄。
**建议**：`createModelRetryPolicyService` 改成接受 `KkvService`（或加一个
`createModelRetryPolicyServiceFromKkv(kkv)` 重载），由 `createProviderServices` 复用同一个实例。
**置信**：confirmed（构造重复）；实际代价 suspected。

**F-w8-20 | P3 | `domain/provider/repositories/impl/sqlite-saved-model.repository.ts:14-15, 26`**
```
import { savedModelSettingsFromJson } from "../../model/saved-model-settings-from-json.js";
import { savedModelSettingsToJson } from "../../model/saved-model-settings-from-json.js";
...
settings: savedModelSettingsFromJson(JSON.parse(settingsJson) as unknown),
```
① 同一个模块的两条 import 语句（应合并）。
② `JSON.parse(settingsJson)` 无保护：settings_json 坏掉时抛裸 `SyntaxError`，
而非 `ProviderError`。同区 `sqlite-provider.repository.ts:19-48` 的两个 JSON 列解析都有容错。
（`docs/Iterations/sql-cr-audit-2026-08/findings.md:919` 已把「settings_json 读路径无容错」
列为已知问题并建议加 `CHECK(json_valid())`，本机位确认**该修复尚未落地**。）
**建议**：合并 import；`JSON.parse` 包 try/catch 转 `ProviderError`。
**置信**：confirmed。

**F-w8-21 | P3 | `domain/provider/logic/resolve-thinking-wire.ts:18, 47, 60` vs `model/protocol-sampling-defaults.ts:25`**
```
const ANTHROPIC_BODY_DEFAULT_MAX_TOKENS = 4096;   // resolve-thinking-wire.ts:18
...
return ANTHROPIC_BODY_DEFAULT_MAX_TOKENS;         // 采样未启用时（:60）
...
export const ANTHROPIC_SAMPLING_DEFAULTS = { temperature: 1, top_p: 1, top_k: 256, max_tokens: 16_000 };
```
同一件事（Anthropic 的默认 max_tokens）有两个常量、两个值：`4096` 用于
`resolveEffectiveMaxTokens`，`16_000` 用于 UI 展示（`mergeSamplingWithDefaults` 会把它填进表单，
`apps/desktop/renderer/features/settings/SamplingForm.tsx` / `apps/mobile/src/components/provider/SamplingForm.tsx`）。
`resolveEffectiveMaxTokens` 的唯一生产消费方是 `thinkingLevelToModelThinkingParams` 的预算钳制
（`logic/thinking-level-presets.ts:58-62`：`Math.min(16384, Math.max(1, effectiveMax - 1))`）。
所以：用户没开采样时选「高」思考，Anthropic 实际下发的 `budget_tokens` 是 **4095**，
而 UI 上同屏显示的 max_tokens 是 **16000**。三个数（4095 / 16000 / 16384）互相矛盾。
注释说 4096 是「adapter 未指定 sampling max_tokens 时的 body 默认值」，即它描述的是**线上事实**；
那 16000 就只是一句对不齐的展示值。
**建议**：抽单一来源 `ANTHROPIC_DEFAULT_MAX_TOKENS`，展示默认与钳制默认同源；
若 4096 确实是线上事实，就把展示默认值改成 4096 并写清理由。
**置信**：confirmed（不一致）/ suspected（哪个是想要的）。

**F-w8-22 | P3 | `service/provider/impl/model-request.service.ts:90-97`**
```
if (error.code === "HTTP_ERROR" && error.message.toLowerCase().includes("abort")) { return false; }
if (error.code !== "HTTP_ERROR") { return false; }
```
第一个判断里的 `error.code === "HTTP_ERROR"` 是**冗余**的：第 96 行已经把非 HTTP_ERROR 全挡掉了。
读代码的人容易以为这两个分支针对不同 code。
**建议**：删掉第 90 行的 code 检查，只留 message 判据（与 `request-abort.ts:45` 对齐即可）。
**置信**：confirmed（纯冗余，无行为影响）。

**F-w8-23 | P3 | `service/provider/impl/model-request.service.ts:47-48, 206-209` + `create-provider-services.ts:51, 66`**
```
const policy = (await this.deps.retryPolicies?.getPolicy()) ?? this.deps.retryPolicy ?? DEFAULT_RETRY_POLICY;
```
① `retryPolicies` 是可选注（tests/callers without storage），`retryPolicy` 是显式覆盖（注释写
「tests / callers without storage」）——**两个注入点语义重叠**，且生产工厂恒传 `retryPolicies`，
`deps.retryPolicy` 分支在生产**永不生效**。
② `await` 写在 `??` 左侧：即使调用方显式传了 `deps.retryPolicy`，这一次 KKV 读**也会先发生**。
也就是说每次 LLM 请求都多一次 `nm-model-retry/policy` 的 KKV 读取，纯粹为一个走不到的分支买单。
**建议**：重构成「先判 `retryPolicy != null` 短路，再读 KKV」；或干脆收敛成一个注入口。
**置信**：confirmed。

**F-w8-24 | P3 | `domain/provider/model/default-saved-model-settings.ts:28` vs `saved-model-settings.schema.ts:59, 108`**
```
thinkingLevel: "high",                                  // default-saved-model-settings.ts:28（新建/回填）
thinkingLevel: thinkingLevelSchema.default("off"),       // saved-model-settings.schema.ts:59（读盘缺字段）
thinkingLevel: "off",                                    // saved-model-settings.schema.ts:108（v1 文档）
```
同一个字段有三个默认值。新建模型 = `high`；v1 老文档读上来 = `off`；v2 文档缺字段 = `off`。
后果很具体：v1 迁移上来的所有模型**思考是关的**，而迁移之后新建的模型**思考是开的**——
升级后用户看到自己的模型行为变了。`default-saved-model-settings.ts:13` 的注释解释了
「读盘缺 thinkingLevel 仍由 schema 回填为 off」，说明作者知道这条不一致但判为可接受。
**建议**：若「升级后思考从开到关」不是拍板，把 v1 的 `.transform` 改成 `"high"`；
若是，注释里补一句「v1→off 是有意为之（理由 X）」。
**置信**：confirmed（不一致）/ intentional? 见「争议与存疑」。

**F-w8-25 | P3 | `service/provider/impl/provider-model.service.ts:89`**
```
lastSeenAtMs: Date.now(),     // 在 for 循环体内，每个模型各取一次
```
一次 `fetch` 里 N 个模型的 `lastSeenAtMs` 取自 N 个不同时刻（跨毫秒边界时会不同）。
这是**语义**问题不只是噪音：若将来按 `lastSeenAtMs` 排序/判「最近一次拉取」，
「同一次拉取」的条目会散在多个时间桶里。
**建议**：在循环外取一次 `const now = Date.now()`。
**置信**：confirmed。

**F-w8-26 | P3 | `service/provider/impl/provider-model.service.ts:110-120` vs `:227`**
```
const model: SavedModel = { ..., settings: defaultSavedModelSettings(normalizedVendorModelId), ... };
await this.deps.savedModels.insert(model);          // 无 round-trip 校验
...
assertSavedModelSettingsPersistable(mergedSettings); // updateSettings 有
```
`updateSettings` 在写盘前会 `assertSavedModelSettingsPersistable`（`domain/provider/model/saved-model-settings-from-json.ts:53-57`，
走一次 zod round-trip），`save` 这条首次插入路径**没有**。
`defaultSavedModelSettings` 的 `contextWindowTokens` 来自 `seedContextWindowTokens(vendorModelId)`，
若那个 seed 表给了一个非正整数，写进去的就是一条日后读不出来的行（`rowToSaved` 会抛 ProviderError），
且**没有任何错误在插入时提示**。
**建议**：`save` 同样补一次 `assertSavedModelSettingsPersistable`（一次纯内存 round-trip，成本可忽略）。
**置信**：confirmed（校验缺失）；可达性 suspected（取决于 seed 表是否可能给脏值）。

**F-w8-27 | P3 | `service/provider/impl/model-request.service.ts:78-80`**
```
if (error instanceof LlmStreamTimeoutError) { return error.phase === "first-chunk"; }
```
`phase === "idle"` 这一支在生产**不可达**。`LlmStreamTimeoutError` 的 doc 说它由
「空闲看门狗或整调用兜底」产生（`infra/llm-protocol/logic/llm-stream-timeout-error.ts:2-4`），
而空闲看门狗 `stream-watchdog.ts` 全仓**零接入方**——`createStreamWatchdog` 的引用只出现在它自己的
定义行和 `test/infra/llm-protocol/stream-watchdog.test.ts`；`STREAM_IDLE_TIMEOUT_MS` 只在
`public/provider.ts` 被转出。RULE 也确认：「模块内已退役件：`stream-watchdog.ts`（idle 原语，
**无接入方**，导出保留）」。
所以这一支是给已退役机制留的墓碑代码。**注意**：这恰好反衬出 F-02 —— 真正在跑的
「已有部分输出后出错」路径根本不走 `LlmStreamTimeoutError`，走的是通用未知错误分支。
**建议**：随 stream-watchdog 一并退役；或反过来，若产品意图是保留 idle 语义（见「争议与存疑」）
则 watchdog 应当接上。
**置信**：confirmed（不可达）/ 见 RULE 拍板项。

## 争议与存疑

1. **F-01 是否算 P1**：另一种解释是「会话级模型指针本就不受删除保护约束」——若产品认为
   「会话换个模型就好」是有意的，那 F-01 只是「错误提示不够友好」而非数据缺陷。
   但 `deleteSaved` 的**既有设计意图**就是保护引用（它专门去查 KKV / agent pin，
   抛 `SAVED_MODEL_IN_USE` 并把引用位置回给用户），漏掉最大的引用源更像是漏了而不是有意。
   我按 P1 报出，但请主代理在裁决时确认「会话 modelId 覆盖」是否在删除保护范围内——
   这是产品问题，我无法从代码确定。**这一点未被任何 RULE 覆盖。**

2. **F-11 的「anthropic 默认值」**：`inferLlmProtocolFromSavedModelId` 全失败回落 anthropic，
   我找不到任何 RULE / 迭代文档拍板过这个默认值。可能是早期「默认按 Claude 导出」的历史遗留。
   若确有拍板，请补出处，我改标 `intentional`。

3. **F-21 的 4096 vs 16000**、**F-24 的 `high` vs `off`**：两处都读得出作者是**知情**的
   （注释写明了「读盘缺 thinkingLevel 仍由 schema 回填为 off」这类），但都没有引用拍板出处。
   我按「疑似 intentional 但缺留痕」处理，置信标 suspected，不建议当 bug 直接改。

4. **RULE 拍板项，标 intentional 不当问题**：
   - **流式不设空闲超时**（`docs/apm/RULE.md:95`）：本区的 `isRetryableError` / `computeBackoffMs` /
     `delayWithSignal` 全程**不设任何空闲阈值**，只有整调用预算，与 RULE 一致。F-27 说的是
     「idle 分支的**生产者**已退役」，不是「idle 阈值被加回来了」。
   - **实时 token 语义**（`docs/apm/RULE.md:96`）：本区只提供 per-model 的
     `tokenCounterMode` 覆盖（`saved-model-settings.ts:22`、`resolve-token-counter-mode-for-model.ts`），
     读到值就往上传，不做任何二次口径处理。与 RULE 的「只表示基线来源的 provenance」定位不冲突。
   - **跨资源写无事务、靠 CoordinatedWrite 补偿**（`service/coordinated-write.ts:14-16` 自述
     「这不是真正的 ACID 事务」）：`provider.service.ts` 的 create/edit/delete 三处补偿链我逐条
     走过，未发现漏注册或顺序错，按有意设计处理。
     唯一想提的是 `delete`（`:229-272`）的 rollback 逐条 `suggestions.upsert(s)` /
     `savedModels.insert(m)`，N 条回滚 = 2N 次全量文档重写（F-03 的同一病灶在回滚路径上再来一次），
     我把它并入 F-03 而非单列。

5. **未越界验证的部分**：F-02 的实际用户可见后果（重复文本在 transcript 里长什么样）取决于
   `service/agent/impl/agent-runner.ts` 的累加/重置语义，属其它机位辖区，我没有读它。
   F-26 的脏值可达性取决于 `infra/tokenizer/logic/seed-context-window-tokens.ts` 的 seed 表内容，
   同样未越界核实。

## 附：本机位实际执行的核实动作

- 44 个文件**全文逐行读完**（`packages/core/src/domain/provider/**` 27 个 +
  `packages/core/src/service/provider/**` 17 个，共 3237 行）。
- 跨边界只读（作证据，不评）：`public/provider.ts`、`service/coordinated-write.ts`、
  `service/integrity-repair.ts`、`bootstrap/chat/chat-schema.ts`、`bootstrap/agent/agent-schema.ts`、
  `bootstrap/novel-master-bootstrap.ts`（L385-404）、`domain/chat/model/session-agent-config.ts`、
  `infra/sksp/impl/base-sqlite-secret-store.ts`、`infra/llm-protocol/impl/openai.adapter.ts`、
  `infra/llm-protocol/logic/llm-stream-timeout-error.ts`。
- 符号扫描：自建脚本 `tmp/w8-usage.mjs`（packages + apps，2307 个 ts/tsx，跳过 node_modules/dist/build）
  与 `tmp/w8-grep.mjs`（packages + apps + docs，按行输出）。**F-14 的死导出结论即出自前者。**
- 实测：`tmp/w8-probe.mjs` 复刻 `normalizeVendorModelId` 跑 6 组输入，产出 F-08 的对照表。
- 未跑任何测试，未改任何非 `raw/` 文件，未做任何 git 写。
