---
zone: w8-provider-adv
agent: advocate（辩护人 / 对抗对）
files_scanned:
  - packages/core/src/domain/provider/logic/application-model-id.ts
  - packages/core/src/domain/provider/logic/assert-saved-model-uuid.ts
  - packages/core/src/domain/provider/logic/builtin-providers.ts
  - packages/core/src/domain/provider/logic/derive-model-name-from-legacy.ts
  - packages/core/src/domain/provider/logic/find-saved-model-references.ts
  - packages/core/src/domain/provider/logic/format-saved-model-display-name.ts
  - packages/core/src/domain/provider/logic/infer-llm-protocol-from-model-id.ts
  - packages/core/src/domain/provider/logic/provider-identity-repair.ts
  - packages/core/src/domain/provider/logic/resolve-provider-api-key.ts
  - packages/core/src/domain/provider/logic/resolve-thinking-wire.ts
  - packages/core/src/domain/provider/logic/thinking-level-presets.ts
  - packages/core/src/domain/provider/model/default-saved-model-settings.ts
  - packages/core/src/domain/provider/model/model-sampling-params.ts
  - packages/core/src/domain/provider/model/model-sampling-params.schema.ts
  - packages/core/src/domain/provider/model/model-suggestion.ts
  - packages/core/src/domain/provider/model/model-suggestion-cache.ts
  - packages/core/src/domain/provider/model/model-suggestion-cache.schema.ts
  - packages/core/src/domain/provider/model/model-thinking-params.ts
  - packages/core/src/domain/provider/model/model-thinking-params.schema.ts
  - packages/core/src/domain/provider/model/protocol-sampling-defaults.ts
  - packages/core/src/domain/provider/model/provider.ts
  - packages/core/src/domain/provider/model/saved-model.ts
  - packages/core/src/domain/provider/model/saved-model-settings.ts
  - packages/core/src/domain/provider/model/saved-model-settings.schema.ts
  - packages/core/src/domain/provider/model/saved-model-settings-from-json.ts
  - packages/core/src/domain/provider/model/thinking-level-options.ts
  - packages/core/src/domain/provider/model/token-counter-mode-options.ts
  - packages/core/src/domain/provider/repositories/model-suggestion.port.ts
  - packages/core/src/domain/provider/repositories/provider.port.ts
  - packages/core/src/domain/provider/repositories/saved-model.port.ts
  - packages/core/src/domain/provider/repositories/impl/kkv-model-suggestion.repository.ts
  - packages/core/src/domain/provider/repositories/impl/sqlite-provider.repository.ts
  - packages/core/src/domain/provider/repositories/impl/sqlite-saved-model.repository.ts
  - packages/core/src/service/provider/create-model-retry-policy-service.ts
  - packages/core/src/service/provider/create-provider-services.ts
  - packages/core/src/service/provider/model-request.port.ts
  - packages/core/src/service/provider/model-retry-policy.port.ts
  - packages/core/src/service/provider/provider-model.port.ts
  - packages/core/src/service/provider/provider.port.ts
  - packages/core/src/service/provider/impl/model-request.service.ts
  - packages/core/src/service/provider/impl/model-retry-policy.service.ts
  - packages/core/src/service/provider/impl/provider-model.service.ts
  - packages/core/src/service/provider/impl/provider.service.ts
  - packages/core/src/service/provider/logic/resolve-token-counter-mode-for-model.ts
证据外溢文件（为举证读的相邻文件，非本 zone 认领范围）:
  - packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts
  - packages/core/src/infra/llm-protocol/logic/request-abort.ts
  - packages/core/src/infra/llm-protocol/logic/llm-stream-timeout-error.ts
  - packages/core/src/infra/llm-protocol/logic/apply-thinking-to-body.ts
  - packages/core/src/infra/llm-protocol/logic/registry.ts
  - packages/core/src/infra/llm-protocol/logic/http-util.ts
  - packages/core/src/infra/llm-protocol/impl/openai.adapter.ts
  - packages/core/src/infra/llm-protocol/impl/anthropic.adapter.ts
  - packages/core/src/infra/tokenizer/logic/resolve-tokenizer-family.ts
  - packages/core/src/infra/tokenizer/logic/read-token-counter-mode-pref.ts
  - packages/core/src/infra/tokenizer/logic/seed-context-window-tokens.ts
  - packages/core/src/infra/tokenizer/logic/context-window-map.ts
  - packages/core/src/infra/tokenizer/logic/resolve-context-window.ts
  - packages/core/src/infra/tokenizer/logic/resolve-current-prompt-tokens.ts
  - packages/core/src/bootstrap/provider/provider-schema.ts
  - packages/core/src/bootstrap/provider/seed-builtin-providers.ts
  - packages/core/src/service/coordinated-write.ts
  - packages/core/src/errors/provider-errors.ts
  - packages/core/src/public/provider.ts
  - apps/desktop/src/main/ipc/handlers/provider-models.ts
  - apps/desktop/shared/ipc-types.ts
  - packages/tdbc-driver-better-sqlite3/src/connection.ts
  - packages/tdbc-driver-op-sqlite/src/driver.ts
  - packages/core/test/provider/model-request-retry.test.ts
  - packages/core/test/provider/thinking-level-presets.test.ts
---

# W8 对抗机位 · 辩护人报告（zone: w8-provider-adv）

## 摘要

本 zone 是「LLM 服务商 + 已保存模型」的领域与服务层：把用户配置的服务商（provider）、
厂商模型清单（suggestion）、已保存模型（saved model）三件事落到 SQLite/KKV，
并把「模型级设置（上下文窗口 / tokenizer 家族 / 采样 / 思考档位）」解析成各协议的
HTTP 请求参数；唯一的出网请求入口在这里（`DefaultModelRequestService`），
重试与整调用兜底预算的**策略判定**也在这一层。辩护立场：这一层绝大部分看起来
"冗余"的东西（内置模板派生表、retry policy KKV、建议缓存的 stale 标记、
schema v1/v2 双读）都是**有据可查的刻意设计**，应标 intentional；
但确实有几处口径漂移与失效保护缺口，需要让步。

## 职责与边界

- **负责**：provider CRUD（跨 SKSP 密钥的补偿式写）、模型清单拉取与 stale 标记、
  已保存模型与其 settings 的读写/校验、内置 provider 模板与默认密钥、
  思考档位 → 协议参数解析、模型请求的唯一入口与重试策略判定、删除前的引用检查。
- **不负责**：协议 wire 细节与 SSE 传输（`infra/llm-protocol`）、tokenizer 家族
  驱动的具体实现（`infra/tokenizer` + NMTP driver）、SKSP 加解密（`infra/sksp`）、
  IPC 通道登记与双端 UI。
- **边界上的两个"半 owned"点**：① 整调用兜底预算常量在 `infra/llm-protocol`
  （`SSE_WHOLE_CALL_TIMEOUT_MS`），但**重试可重试性判定**在本 zone；
  ② tokenizer 家族映射表在 `infra/tokenizer`，但**用户可选枚举 + 持久化 + 校验**
  在本 zone。二者都是"策略在本、机制在外"的典型切法。

## 对外接口（`packages/core/src/public/provider.ts`）

- 实体/类型：`LlmProvider`（:27）、`SavedModel`（:43）、`SavedModelSettings` 及其
  internal/generation 两节（:49-56）、`ModelSamplingParams` 四协议分支（:29-34）、
  `ModelThinkingParams`（:65-69）、`ModelRequestService`/`ModelRequestOptions`（:105-108）、
  `ModelRetryPolicy`/`ModelRetryPolicyService`（:91-94）。
- 装配：`createProviderServices`（:96）、`createModelRetryPolicyService`（:95）。
- 纯函数出口：`resolveThinkingParamsForLevel`（:78）、`thinkingLevelToModelThinkingParams`（:80）、
  `resolveEffectiveMaxTokens`（:77）、`mergeSamplingWithDefaults` / `maxOutputTokensFromSampling`（:37-42）、
  `applySavedModelSettingsPatch`（:62）、`defaultSavedModelSettings`（:81）、
  `resolveTokenCounterModeForModel`（:90）、`assertSavedModelUuid`（:19）。
- 枚举出口（双端 UI 共用的单源）：`THINKING_LEVEL_SELECT_OPTIONS`（:65）、
  `TOKEN_COUNTER_MODE_SELECT_OPTIONS`（:87）。
- 超时常量出口：`SSE_WHOLE_CALL_TIMEOUT_MS`（:134）——预算由 core 单点下发，
  host 侧不得自写一份（transport 契约见 `llm-sse-transport.ts:80-83`）。

## 数据访问

| 资源 | 落点 | 证据 |
|---|---|---|
| `llm_provider` 表 | provider 实体（id / builtin_key / protocol / base_url / display_name / secret_ref / headers_json / body_params_json / is_builtin） | `sqlite-provider.repository.ts:80-168`；DDL `provider-schema.ts:8-20`（`builtin_key TEXT UNIQUE`、`protocol CHECK IN (...)`） |
| `llm_saved_model` 表 | 已保存模型 + `settings_json`（带 `json_valid` CHECK） | `sqlite-saved-model.repository.ts:19-120`；DDL `provider-schema.ts:21-30`（FK `provider_id → llm_provider(id) ON DELETE CASCADE`） |
| KKV `nm-model-suggestions` / `{providerId}` | 厂商模型清单缓存（含 `stale` / `lastSeenAtMs`） | `kkv-model-suggestion.repository.ts:16,94-122` |
| KKV `nm-model-retry` / `policy` | 全局重试策略 | `model-retry-policy.service.ts:17-18` |
| SKSP ref `provider/{id}/apiKey` | API Key 明文（密文落库由 SKSP 负责） | `provider.ts:27-36`、`resolve-provider-api-key.ts:25` |
| `kkv_entry`（workspace-state / currentModelId）、`agent_definition.prompts_json`、`chat_project.agent_config_json` | 仅**只读**扫描做删除前引用检查 | `find-saved-model-references.ts:38-90` |
| bootstrap seed | 内置 provider 按 `builtin_key` 幂等插入，不覆盖用户改动 | `seed-builtin-providers.ts:20-39` |

## 依赖关系

- **import 谁**：`infra/llm-protocol`（adapter registry / abort 判据 / 超时错误类）、
  `infra/sksp`（SecretStore port）、`infra/tokenizer`（家族映射 / 校验 / 上下文窗口 seed）、
  `infra/tdbc` + `infra/sql-template`、`service/kkv`、`service/coordinated-write`、
  `service/persistent-state`（引用检查的 key 常量）、`errors/provider-errors`。
- **被谁消费**：
  - `create-agent-runner.ts:…` / `agent-runner.ts:628`（每 step 一次 `modelRequests.request`）、
    `run-agent-turn.ts`；
  - `create-compaction-condition-evaluator.ts`（`getContextWindow` / `getTokenCounterMode`）；
  - desktop IPC：`handlers/provider-models.ts`（全套 saved model 操作）、
    `handlers/agent.ts` / `handlers/prompt.ts`（`savedModelDisplayName`）；
  - mobile / desktop `chat-prompt-tokens.service.ts`（`resolveTokenCounterModeForModel`）；
    CLI `apps/cli/src/prompt/commands.ts`（`getTokenCounterMode`）；
  - 双端设置 UI：`ModelSamplingView.tsx` / `ModelSamplingScreen.tsx`
    （枚举常量 + `ipcProviderModelsEditSaved`）。

---

## 一、辩护理由清单（Design Defense）

### D-1 内置 provider 模板是**单源派生**，不是重复维护 —— intentional

`BUILTIN_PROVIDER_ROWS`（`builtin-providers.ts:39-76`）是唯一数据源；
`BUILTIN_PROVIDER_PROTOCOLS` / `BUILTIN_PROVIDER_UUID_PROTOCOLS` /
`BUILTIN_KEY_TO_UUID` / `BUILTIN_UUID_TO_KEY` / `BUILTIN_PROVIDER_KEYS` /
`BUILTIN_PROVIDER_UUIDS` 全部 `Object.fromEntries(BUILTIN_PROVIDER_ROWS.map(...))`
派生（:91-130）。文件头注释 :97 明确写「固定 UUID → 协议（与 seed 同源，禁止另维护第二套）」。
反驳"派生表过多"的常见论据：这些派生表**只有测试消费**（实测 `findstr` 全仓：
`BUILTIN_PROVIDER_UUIDS`/`BUILTIN_UUID_TO_KEY` 只在 `test/provider/bootstrap-seed.test.ts`、
`BUILTIN_KEY_TO_UUID` 只在 `test/provider/infer-llm-protocol-from-model-id.test.ts`），
它们是**把 seed 幂等性写成断言**的手段（seed 插的行 id 必须等于固定 UUID、
`BUILTIN_UUID_TO_KEY[row.id] === row.builtin_key`），属于测试可观测面接线，不是生产死代码。
`BUILTIN_PROVIDER_IDS` 标 `@deprecated` 并注明语义已从 UUID 迁到 keys（:124-125），
是**刻意的兼容别名**而非忘记改名。

### D-2 seed 用「按 builtin_key 的 NOT EXISTS」而非「按 id upsert」—— intentional

`seed-builtin-providers.ts:29` 的 `WHERE NOT EXISTS (SELECT 1 FROM llm_provider WHERE builtin_key = #{builtinKey})`
保证：① 跨安装一致；② **用户改过 baseUrl/displayName 后重启不被覆盖**（文件头 :2 "不覆盖用户改动"）。
固定 UUID 只作为插入值而非幂等键，正是为了让"用户删除后重建"这类场景不会被 id 冲突卡住
（内置行另有 `isBuiltin` 守卫禁止删除/改协议，`provider.service.ts:122-128, 213-219`）。
`BUILTIN_PROVIDER_UUID_PROTOCOLS` 走 UUID 短路（`infer-llm-protocol-from-model-id.ts:30-33`）
也依赖这个"固定 id 一定会被 seed 出来"的性质。

### D-3 内置默认密钥的回落链是刻意的三级解析 —— intentional

`resolve-provider-api-key.ts:21-44`：SKSP 存的 → 空串视为未设 → `builtin_key` 的内置默认
（仅 `opencode` 有 `defaultApiKey: "public"`，`builtin-providers.ts:74`）→ 都没有才抛
`API_KEY_NOT_SET`。这是 `docs/Iterations/opencode-builtin-provider/prd.md:53` 写明的
产品口径（"SKSP 未配置时自动使用，用户仍可通过 provider edit 覆盖"）。
配套的 `providerApiKeyIsConfigured`（:47-59）与解析口径**故意不同构**：
前者用 `secretStore.has()`、后者用 `get()` 并显式排空串——这不是不一致，
而是"列表要立刻显示已配置"（避免 N 次解密）与"请求要拿到非空串"两种语义。
OpenCode Zen 免费档零配置可用是既定卖点，不应改。

### D-4 重试**只有一层**，且刻意集中在 provider 服务 —— intentional

实测：`isRetryableError` 与重试循环**仅存在于** `model-request.service.ts:69-104, 210-243`；
`agent-runner.ts` / `run-agent-turn.ts` / `infra/llm-protocol/impl/*.adapter.ts`
**零 retry 关键字**（`findstr /i "retry"` 全空）。
所以"重试分层"在本仓的答案是：**策略层单点、传输层零重试**——adapter 抛、provider 服务判、
runner 只接失败收尾。这条边界让"用户点停止不会被自动重发"成为可验证的不变量。
可重试性判定本身的防御深度也够：abort-like 先拦（:70）、流式超时分级先于"未知错误默认可重试"
（:78-84，注释写明"本分支必须置于下方非 ProviderError 默认 true 之前，否则 idle 超时会被误判可重试"）、
abort 形态的 ProviderError 单独拦截（:90-95，注释引用黑洞复现实验 r3 实锤）、
HTTP 状态码只放行 429/5xx（:103）。

### D-5 整调用兜底预算是**单点常量 + 分支表达触发 + 按有无数据分级** —— intentional

`SSE_WHOLE_CALL_TIMEOUT_MS = 600_000`（`llm-sse-transport.ts:129`）core 单点下发，
经 `public/provider.ts:134` 出到 host；port 契约要求实现以之覆盖自身 callTimeout
（`llm-sse-transport.ts:80-83`）。触发机制按传输分支表达而非"三处各写一个定时器"：
XHR `xhr.timeout`（:503）、fetch 公共层 JS 定时器（:374-379）、native 由 transport 内
callTimeout 抛错再映射（:438-447）。到点按 `processedLength > 0` 分 first-chunk / idle
（:354），与"流空闲看门狗已按产品拍板退役"（:329-334）是同一条决策链。
`XhrSseTransport` 侧还有 `Connection: close` 的**条件化**（:583-594，native 分支保留连接复用、
回落 XHR 才强制 close）——这是"同一语义、三种表达"的教科书写法，不是冗余分支。

### D-6 `LlmStreamTimeoutError` 的三级"不命中 abort 判据"是**依赖链契约**，必须保留

`llm-stream-timeout-error.ts` 的模块注释明写：本错误三条都不命中
`request-abort.ts:isRequestAborted` 的判据（signal 未 abort / name 非 AbortError /
非 ProviderError），因此 adapter 的 catch 会 rethrow 而**不会吞成 partial 正常完成**。
`model-request.service.ts:78-80` 又要求"必须置于未知错误默认 true 之前"。
这是一条三方（transport ↔ adapter ↔ retry 策略）互相咬合的不变量，
任何"简化"都会让流式超时被误当 abort 或被误当可重试。测试侧已锁：
`test/provider/model-request-retry.test.ts:248-300`（first-chunk 重试 3 次 / idle 只调 1 次）。

### D-7 跨 SKSP + SQLite 的写用 `CoordinatedWrite` 补偿，且**注册顺序即业务序**

`provider.service.ts` 的 create（:92-116，两步）/ edit（:170-207，secret→row）/
delete（:228-273，四域五步）是三处典型"无事务跨资源写"，由
`service/coordinated-write.ts:121-146` 按**逆序**补偿，回滚失败聚合进
`CoordinatedWriteRollbackError` 而不掩盖根因。delete 的注册顺序
（suggestions → savedModels → provider → secret）保证任一步失败后不留下
"provider 没了但密钥还在"这类半套状态。edit 里 `originalSecretValue` 先读旧明文
（:132-135）也是为了补偿——SKSP 没有事务，只能"读到旧值 → 失败写回"。

### D-8 删除 provider 时**显式**逐域清理，是对 FK pragma 不对称的补偿 —— intentional

DDL 写了 `ON DELETE CASCADE`（`provider-schema.ts:29`），但实测
`PRAGMA foreign_keys = ON` **只在 op-sqlite 驱动里执行**（`tdbc-driver-op-sqlite/src/driver.ts:76`），
better-sqlite3 连接层没有任何 pragma（`tdbc-driver-better-sqlite3/src/connection.ts` 全文无 PRAGMA）。
也就是说 desktop/CLI 上 cascade 实际不生效。`provider.service.ts:224-259` 因此显式
`suggestions.deleteByProvider` → `savedModels.deleteByProvider` → `providers.delete` →
secret 删除，**不依赖 cascade**。这条要写进台账当"设计正确"而非"冗余删除"——
否则有人照着 DDL 删掉这三行，desktop 端立刻出现孤儿 saved model。

### D-9 provider 实体的 `builtinKey` / `isBuiltin` 在 `update` 里**不可改** —— intentional

`sqlite-provider.repository.ts:138-146` 的 UPDATE 刻意不写 `builtin_key` / `is_builtin`。
配合 `provider.service.ts:122-128`（内置行禁改 protocol）与 :213-219（内置行禁删），
构成"内置身份不可伪造"的三重锁。`provider-identity-repair.ts:42-94` 是它的运行时镜像校验：
detect 报告、repair **抛错而不静默打补丁**（:73-92，注释"migration 不变量一旦在运行时被破坏，
说明数据层出了严重问题，应当 fail-fast"）——这是**有意的 fail-fast**，不是"修复逻辑没写完"。

### D-10 settings 的 v1/v2 双形态是**读兼容**且写口恒 v2 —— intentional

`saved-model-settings.schema.ts:91-126`：`z.union([v1Document, v2ToMemory])`，
v1 transform 到 v2 内存形态；写盘唯一出口 `savedModelSettingsToJson`（`saved-model-settings-from-json.ts:32-46`）
恒输出 `schemaVersion: 2`，仓库层 `sqlite-saved-model.repository.ts:78,95` 强制走它。
`normalizeGenerationForRead`（:32-52）还带一条 dev-only 的 `thinking.enabled → thinkingLevel`
兼容映射，注释明写"不写入 v1.2.7 用户迁移义务；仅减轻本地 dev 库残留"——
**明确的 dev-only 标注 + 明确的不承诺**，是负责任的兼容写法。
另：v1 映射把 `thinkingLevel` 定为 `"off"`（:108），而新建模型默认 `"high"`
（`default-saved-model-settings.ts:28`）——这个**刻意的分叉**由
`docs/Iterations/thinking-default-high/prd.md:52,74,78` 拍板（"v2 文档缺字段走 zod default 继续为 off，
不得改为 high"，"双端不另设冲突默认值"）。任何"两个默认值不一致"的报告都应按 intentional 关闭。

### D-11 tokenizer 家族计数器的**策略在 domain、机制在 infra** 的切法自洽

用户可选枚举（`token-counter-mode-options.ts:10-30`）→ 持久化校验
（`saved-model-settings.schema.ts:64-68` 用 `isValidTokenCounterModePref` refine +
`parseTokenCounterModePref` transform）→ 写路径二次校验
（`provider-model.service.ts:212-221`，拒绝非法 `tokenCounterMode`）→ 读口
（`resolve-token-counter-mode-for-model.ts` → `providerModels.getTokenCounterMode`）→
最终由 `infra/tokenizer/logic/resolve-tokenizer-family.ts:38-48` 落地。
**三层校验**（schema / service / 家族解析）是有意的纵深防御：
`read-token-counter-mode-pref.ts:43-54` 对未知值与历史 `"heuristic"` 统一归一为 `"auto"`
（注释注明"heuristic 已从用户可选列表移除，这里把旧数据归一化"），
保证**脏值永远降级到安全档而不是抛错卡死 UI**。`resolveTokenizerFamily` 对未知模型返回
`heuristic` 而非 ST 的默认 `gpt-3.5-turbo`（文件头 :5-6）——这是**有意的诚实降级**：
宁可标 heuristic 也不冒充精确，与 RULE「实时 token 指标语义」里 `tokenSource`
只表 provenance 的口径一致。

### D-12 上下文窗口 seed 只在 insert 时用，运行期不回落 —— intentional

`seed-context-window-tokens.ts:3-5` 的 WHY 写得很清楚："runtime bar/compaction read persisted
settings; map is not a runtime fallback"。即：substring 表（`context-window-map.ts:8-19`）
只在 `defaultSavedModelSettings` 首次 insert 时取一次（:23），此后一律读库。
避免了"改表就静默改变已保存模型的窗口"这种不可解释的行为。

### D-13 引用检查是**删除前的 fail-fast 护栏**，且错误可读

`deleteSaved` 先 `findSavedModelReferences` 再删（`provider-model.service.ts:168-189`），
返回 `SAVED_MODEL_IN_USE` 并把 `currentModelId` / `agent_definition:<id>` / `chat_project:<id>`
列进 message（`find-saved-model-references.ts:46,62,88`）——用户能直接看出"哪个 agent 在用"，
而不是一句"删除失败"。desktop IPC 层还额外做了一道 provider 归属校验
（`handlers/provider-models.ts:147-157`，防跨服务商误删）。

### D-14 应用 model id 的解析**按首个 `/`** 且拒绝 legacy 路径形态

`application-model-id.ts:14` 用 `indexOf("/")`（首个斜杠），`:15` 拒绝首尾斜杠；
`normalizeVendorModelId`（:40-68）依次处理 `{providerId}/` 前缀、完整 application id、
OpenAI 风格 `models/` 前缀——三种真实来源各有归属，不含糊。
`assert-saved-model-uuid.ts:27-40` 明确"含 `/` 即 legacy 路径，拒绝"并给两种不同 message
（legacy vs 非 UUID），迁移后的写路径零歧义。

---

## 二、让步清单（Concessions —— 我承认这些是真问题）

### C-1【P1】流中失败的重试会造成**重复输出**：idle 超时禁重试，但普通网络错误没禁

- 位置：`model-request.service.ts:210-243`（重试循环直接复用同一个 `options.onStream`）
  + `:81-84`（非 ProviderError 一律 `return true`）+ `:99-102`（无状态码 HTTP_ERROR 也 true）
  + `openai.adapter.ts:224-228`（非 abort 原样 rethrow）
  + `llm-sse-transport.ts:568-573`（XHR `onerror` → `ProviderError("HTTP_ERROR","XHR network error")`）
  与 `:673-682`（fetch 分支中途抛错原样 `rejectOnce`）
- 事实：流式请求已经通过 `onStream` 投递了 text-delta 之后，若发生 `XHR network error`
  或 fetch reader 中途异常，错误落到 `isRetryableError` 会被判为**可重试**（前者 HTTP_ERROR
  无状态码 → true；后者非 ProviderError → true），于是 `adapter.chat` 被**再次调用**，
  携带的是**同一个 `onStream`**，UI 侧会看到"前半段 + 重跑后的完整回答"叠在一起。
- 为什么这条是漏洞而不是设计：`LlmStreamTimeoutError("idle")` 分支（:78-80）已经明确
  表达了"已有部分输出不重试，避免重复输出/重复计费"的意图，注释也写了
  （`llm-stream-timeout-error.ts` 模块注释第 8 行）。**同一意图没有被覆盖到
  非超时类的流中错误**，是判据只挂在错误类型上、没挂在"本次尝试是否已产出数据"上。
- 建议（不改架构的最小修法）：在 `DefaultModelRequestService` 的重试循环里维护一个
  本次尝试的"已投递事件"标志（包一层 counting wrapper 即可，不必改 adapter），
  一旦投递过任何 `text-delta` / `thinking-delta` / tool 相关事件就整体不重试，
  与 timeout 分支的语义对齐。
- 置信：**confirmed**（代码路径逐层核对；触发条件是"流中断且非超时类错误"，
  概率低于超时但真实存在——弱网切换、代理断连都会命中）。

### C-2【P2】重试策略持久化整条链路**无生产写入方**，`setPolicy` / `clearPolicy` 只有 port 与 impl

- 位置：`model-retry-policy.service.ts:79-94`；`model-retry-policy.port.ts:23,28`
- 实测：全仓 `findstr "setPolicy|clearPolicy"` 只命中 impl 与 port 两个文件本身，
  `createModelRetryPolicyService` 只在 `create-provider-services.ts:51` 被调用（只读路径
  `getPolicy`）。`getPolicy` 永远返回 `null`（除非用户手工改 KKV），
  于是运行时恒用 `DEFAULT_RETRY_POLICY`（`model-request.service.ts:52-57`：2 次 / 200ms / 2s / 0.2）。
- 定性：**不是 bug，是"先落存储后接 UI"的半程态**。但它意味着
  `assertValidPolicy`（:20-43，6 条校验）与其 4 个分支在没有写入方的情况下**从未被生产执行**，
  属于"看起来有配置、实际改不动"的体验债。
- 建议：要么补一个设置入口（KKV 直写亦可），要么在 `ModelRetryPolicyService` 的
  JSDoc 上写明"当前无 UI 写入方，仅 CLI/未来设置页预留"，避免后续读者误判为已接线。
- 置信：**confirmed**（全仓 grep）。

### C-3【P2】Anthropic 的 4096 存在**两个真源**，且与展示默认 16000 冲突

- 位置：`resolve-thinking-wire.ts:18`（`ANTHROPIC_BODY_DEFAULT_MAX_TOKENS = 4096`）
  vs `anthropic.adapter.ts:134`（body 字面量 `max_tokens: 4096`）
  vs `protocol-sampling-defaults.ts:21-25`（`ANTHROPIC_SAMPLING_DEFAULTS.max_tokens = 16_000`）
- 后果 A（漂移风险）：思考预算钳制用前者（`thinking-level-presets.ts:58-62`，
  `budget = min(preset, max(1, effectiveMax - 1))`），body 用后者字面量。
  两处独立改会静默产出 `budget_tokens >= max_tokens` 的非法请求（Anthropic 会 400）。
  现状下 4096 → `budget_tokens=4095` 恰好合法（`test/provider/thinking-level-presets.test.ts:51-62` 锁住），
  是**巧合式正确**。
- 后果 B（用户可见偏差）：采样表单展示的默认 max_tokens 是 16000
  （`mergeSamplingWithDefaults`，双端 UI 消费），而用户不改采样时**实际发出去的是 4096**，
  思考档位还因此被压到 4095。新建的 Claude 模型默认档位是 `high`
  （`default-saved-model-settings.ts:28`），于是"高思考"实际只拿到 4095 的思考预算、
  4096 的总输出——**默认值组合起来几乎写不出正文**。这是本次 zone 里最像真 bug 的一处。
- 建议：① 把 4096 提成单一导出常量由 adapter 与 `resolve-thinking-wire` 共用；
  ② 明确 `ANTHROPIC_SAMPLING_DEFAULTS` 是"仅表单展示"还是在 `sampling.enabled=true`
  时也应当被写进 body（现在 `sampling.enabled=false` 时它完全不参与出网），
  并把展示值与实际值对齐或在 UI 上标注"未启用采样时按 4096 计"。
- 置信：**confirmed**（数值与调用链均已核对；"写不出正文"的严重度依赖模型与任务，
  标 **suspected** 的部分仅限体感描述）。

### C-4【P2】`fetch` 拉模型清单是 O(N²) 的读-改-写，且并发拉取会丢更新

- 位置：`provider-model.service.ts:81-92`（`for (const m of result.models) await upsert(...)`）
  + `kkv-model-suggestion.repository.ts:44-65`（每次 `upsert` 都 `readCache` 全量 JSON、
  改一个元素、再 `writeCache` 写回全量）
- 后果：一家服务商返回 N 个模型 → 2N 次 KKV 读写、累计写入量 O(N²)。
  N=300 的服务商约 900 次 KKV 操作；且整个过程无节流，用户点"拉取"后 UI 全程等待。
- 并发：两次 `fetch` 交错时后写者用自己读到的旧快照覆盖前者，
  清单会丢条目（无版本号/CAS）。
- 建议：给 `ModelSuggestionRepository` 加一个 `upsertMany(providerId, entries[])`
  批量口（`markStaleExcept` 已经有批量语义了），或至少在 service 层先聚合成一次写。
- 置信：**confirmed**（代码结构层面；具体耗时未实测，按数量级推断）。

### C-5【P2】删除 provider **不做** saved model 引用检查，与 `deleteSaved` 的口径不一致

- 位置：`provider.service.ts:211-274`（五步清理，全程无 `findSavedModelReferences`）
  vs `provider-model.service.ts:173`（单模型删除**有**引用检查）
- 后果：某个 saved model 被 agent pin（`agent_definition.prompts_json.model`）或被
  workspace-state `currentModelId` 指向时，删掉它的服务商 → agent 的 pin 变悬空 →
  下一次 run 在 `model-request.service.ts:157-170` 抛 `MODEL_NOT_SAVED`。
  用户侧表现为"删了个服务商，之后某个 agent 突然不能用了"，且没有事前提示。
- 辩护方立场：显式逐域清理（见 D-8）是对的，但**删除前的用户可读预警**缺失。
- 建议：`delete` 开头做一次批量引用扫描（按 providerId 聚合 `findSavedModelReferences`
  或新增 `findProviderModelReferences`），有引用时抛 `SAVED_MODEL_IN_USE` 并列出 agent 名。
  这属于**新增护栏**，不动现有清理顺序。
- 置信：**confirmed**（代码层）；"悬空 pin 造成 run 失败"的链路经
  `agent-runner.ts:301-303`（savedModelForAppend 查不到时降级不传）
  与 `model-request.service.ts:157` 交叉印证——注意 runner 侧是**容错降级**，
  真正硬失败发生在 request 入口。

### C-6【P2】`inferLlmProtocolFromSavedModelId` 五处静默回落 `"anthropic"`

- 位置：`infer-llm-protocol-from-model-id.ts:27,36,41,50`
- 事实：模型不存在、未传 `providers`、provider 不存在、**以及整个 try 体抛任何错**
  （:49-51 的裸 `catch`），一律返回 `"anthropic"`。
- 影响：该值在 `agent-runner.ts:561-579` 决定 `computeLlmExportZonesFromLayout` 的导出区、
  `applyThinkingContextForLlm` 的协议最小保留、以及 `:587` 是否读全量历史做
  Gemini tool_use 名回查。回落成 anthropic 意味着：Gemini 模型被当 anthropic 处理
  （导出区裁剪按错误协议、tool 名回查分支不触发）。
- 让步点：不要求改成抛错（该函数历史上就是"尽力推断"语义），但要求
  **至少把裸 catch 收窄到只吞 `KkvError`/IO**，并在回落时打一条 warn——
  静默的错误协议比显式失败更难排查。
- 置信：**confirmed**（五处回落逐行核对）。

### C-7【P3】`TOKEN_COUNTER_MODE_OPTIONS` 是 `VALID_FAMILIES`（16 项）的 6 项子集，且无编译期约束

- 位置：`token-counter-mode-options.ts:10-17` vs `read-token-counter-mode-pref.ts:15-32`
- 事实：`satisfies readonly TokenizerOverride[]` 只保证**子集合法**，不保证**全集覆盖**；
  `llama` / `yi` / `glm` / `qwen2` / `deepseek` / `jamba` / `command-r` / `command-a` /
  `nemo` / `gpt2` 全部可被 `resolveTokenizerFamily` 解析出来，却不在用户可选列表里。
  同时 `"heuristic"` 仍在 `VALID_FAMILIES` 中被 `isValidTokenCounterModePref` 接受，
  但 `parseTokenCounterModePref` 会把它归一成 `"auto"` —— 校验层与归一层对同一值给出不同语义。
- 让步点：子集本身可能是产品取舍（只暴露有把握的），但应当在枚举上方补一行注释说明
  "用户可选是家族全集的真子集，新增家族无需同步 UI"，否则下一个加家族的人会以为漏了。
  `"heuristic"` 的双重身份建议在 `isValidTokenCounterModePref` 侧注释点明（写入会被归一）。
- 置信：**confirmed**。

### C-8【P3】`findSavedModelReferences` 里的 `chat_project` 扫描是**已下线功能的遗留**

- 位置：`find-saved-model-references.ts:66-90`
- 事实：RULE 明确「项目智能体 v1.4.26 起已移除 UI 入口和解析分支，DB 列置空保留」，
  且 bootstrap 有 `hasLegacyChatProjectShape` 专门探测该列的非 NULL 残留
  （`novel-master-bootstrap.ts:253-270`）。也就是说这张表在升级完成的库上恒为空，
  这段扫描永远命中 0 行。
- 让步点：不是让它删（升级未完成的库上仍有意义，且删除会削弱兜底），
  而是加注释说明"仅服务未完成 project-agent-config-cleanup 的老库"，
  并考虑给 `chat_project.agent_config_json IS NOT NULL` 加进 WHERE（现在全表扫）。
- 另：该文件对 `prompts_json` / `agent_config_json` 的 `JSON.parse` **无 try 包裹**
  （:56、:77）——一行脏数据会让 `deleteSaved` 抛原生 `SyntaxError` 而非 `ProviderError`。
  这是独立的小缺陷（**confirmed**），修法是包一层 try/catch 跳过该行。
- 置信：**confirmed**。

### C-9【P3】`sqlite-provider.repository` 的 `parseHeaders` / `parseBodyParams` 静默降级 `{}`

- 位置：`sqlite-provider.repository.ts:19-48`
- 事实：`headers_json` 解析失败或根非对象一律返回 `{}`，不报错；
  `body_params_json` 同款（:37-47 注释写明"降级 {}，不抛错"）。
- 辩护面：这是**对的**（老库脏列不该让整个 provider 列表打不开），
  但代价是"用户配的自定义 header 静默消失"且无任何痕迹。
- 让步点：至少 `body_params_json`（用户可见的高级参数）解析失败时打一条 warn，
  `headers_json` 可保持静默。
- 置信：**confirmed**（代码层）；warn 的必要性属**建议**。

### C-10【P3】重试预算按**尝试**而非按**逻辑调用**计，最坏 3×600s

- 位置：`model-request.service.ts:210-243` + `llm-sse-transport.ts:129`
- 事实：`SSE_WHOLE_CALL_TIMEOUT_MS` 是每次 `postSse` 的预算，重试每次重新武装；
  `maxRetries=2` 时单次用户操作最坏 ≈ 3×600s + 退避 ≈ 30 分钟无反馈。
- 辩护面：产品已拍板"不设固定空闲超时，唯一自动兜底是整调用预算"，
  分级语义正确（first-chunk 可重试 / idle 不重试）；所以这条**不是要改语义**，
  是要承认"预算不是端到端 SLA"。建议在 `ModelRetryPolicy` 上补一条注释说明
  该乘积关系，避免将来有人把 `maxRetries` 调大而没算这笔账。
- 置信：**confirmed**（算术与代码路径已核对）。

### C-11【P3】`editSaved` 的 `modelName === null` 分支在当前类型下不可达

- 位置：`provider-model.service.ts:141-147`；`provider-model.port.ts:17` 签名是 `modelName?: string`
- 事实：`modelName === null` 在 TS 严格类型下与 `string | undefined` 无交集，
  该分支只在 IPC 传 `null` 时才可能命中（`ipc-types.ts:1253-1256` 声明为 `modelName?: string`，
  但 IPC 边界不保证运行时类型）。
- 让步点：**保留**（IPC 边界防御有其价值），但注释应说明"防御 IPC 传 null"，
  否则读者会以为是死代码想去掉。
- 置信：**suspected**（取决于 IPC 反序列化是否可能产出 null，未逐层追到 runtime 校验）。

### C-12【P3】`assertValidPolicy` 抛原生 `Error`，与本 zone 统一的 `ProviderError` 口径不一致

- 位置：`model-retry-policy.service.ts:20-43`
- 影响面很小（当前无写入方，见 C-2），但 `getPolicy` 的 catch 会把这类错误吞成 `null`，
  于是**校验失败与"未配置"不可区分**。若将来接 UI，用户写错 maxDelayMs 会得到
  "静默回落到默认值"而不是表单红字。
- 置信：**confirmed**（代码层）；用户可见性依赖 C-2 的接线进度，标 **suspected**。

---

## 争议与存疑（不抹平）

1. **C-3 的严重度我与主代理可能判断不同**：我把"新建 Claude 模型默认 high 思考
   却只有 4095 预算 / 4096 输出"列为 P2；如果主代理实测发现 Claude 在
   `budget_tokens=4095` 下仍能正常完成短回复，实际影响会降到 P3。
   我**没有实测**（需要真实 API Key 与网络），因此在 C-3 里把体感部分标 suspected。
   建议 W6 验证代理用 mock adapter 断言 `thinkingLevel:"high" + sampling 未启用`
   时出网 body 的 `max_tokens` 与 `budget_tokens` 组合，并核对 Anthropic 官方约束。
2. **C-1 是否已被别处兜住**：我只核对了 `agent-runner` / transport / adapter 三层，
   没有逐个平台核对 UI 侧是否在重试时重置了流式缓冲（desktop `useAgentStream`、
   mobile chat-transcript）。若宿主在收到第二次 attempt 的首个 delta 时会重建消息块，
   C-1 的用户可见性会减轻（但重复计费与 token 统计污染仍在）。**需要 W3 的 IPC/UI
   侧机位交叉确认**，我不替他们下结论。
3. **C-5 是否算本 zone 的账**：也可以主张"删服务商连带删模型"是产品期望的级联语义，
   悬空 pin 由 `MODEL_NOT_SAVED` 优雅兜底。我倾向"该有预警"，但这是**产品拍板项**，
   不是纯技术缺陷。
4. **`SSE_WHOLE_CALL_TIMEOUT_MS` 的归属**：它在本 zone 之外（`infra/llm-protocol`），
   我为 C-10 与 D-5 做了跨区举证。若 W8 的检察官机位同时覆盖 llm-scope，
   D-5/D-6 应以那里的版本为准，避免同一设计被两份报告给出不同结论。

## 结论

- 辩护成立、应标 intentional 的：**D-1、D-2、D-3、D-4、D-5、D-6、D-7、D-8、
  D-9、D-10、D-11、D-12、D-13、D-14**（14 条，全部带 file:line 与决策出处）。
- 需要修的：**C-1（P1，流中重试重复输出）、C-3（P2，Anthropic 4096 双真源 +
  展示/实际偏差）、C-4（P2，fetch 的 O(N²) 与丢更新）、C-5（P2，删服务商无引用预警）、
  C-6（P2，协议推断五处静默回落）**；其余 C-2 / C-7~C-12 为 P3 债（注释、
  接线、warn、小修）。
- 判决请求：主代理裁决 C-1 与 C-3 是否升 P1，并决定 C-5 走"加护栏"还是走
  "产品拍板接受级联"。