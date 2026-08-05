# D2-provider-llm：provider / llm-protocol / sksp 切片

## 元信息

- 模块：provider-llm（合并切片，对应 `domain/provider` + `infra/llm-protocol` + `service/provider`，并强耦合 `infra/sksp` 与三端 `sksp-*` driver 包）
- 文件范围（仅 core 内三块）：domain/provider 18 文件、service/provider 11 文件 / 875 行、infra/llm-protocol 29 文件 / 3 596 行、infra/sksp 7 文件 / 221 行；三端 sksp-{windows,mac,android} 与 adapter 实现（openai/anthropic/gemini）作为强耦合外围一并读
- 相关 Iterations：`provider-model`（v1 CRUD 基线）、`sksp`（协议 + windows/android v1）、`sksp-mac`（补 macOS）、`provider-identity`（UUID 主键 + `builtin_key` + `displayName` 必填）、`saved-model-identity`（saved model UUID + `modelName`）、`opencode-builtin-provider`（第 5 个内置）；间接相关：`llm-protocol-anthropic-gemini-parity`、`mobile-llm-streaming`、`mobile-sse-stream-resilience`、`model-context-settings`、`model-aware-token-counting`、`token-counting`
- lens 命中：L1✓（双身份键 + 多步写）、L2-（间接）、L3✓（`adapter.port` 36 引用判为 port 型正常）、L4✓（跨 secretStore 多步无事务 A 级）、L5✓（SQLite 串行挡住 DB 侧，sksp 侧无保护但读路径安全）、L6✓（CLI 硬编码 Windows SKSP / SSE fetch-XHR 不对齐 / SKSP registry 三端不统一 / Android SKSP `get()` 漏 version / tokenizer 三端不一致 / env override 三端不一致）、L7✓（跨 store 部分失败无测试）、L8✓（SKSP 实现质量高，env 覆盖层信任面偏宽，包发版 0.0.0）、L9/L10/L11 间接命中
- 轮次：第 2 轮（phase2-slice）

## 模块画像（叙述式）

这块切片实际上是把三个 bounded context 缝在一起的：`domain/provider` 是配置域（`llm_provider` + `llm_saved_model` + `nm-model-suggestions` KKV），`infra/sksp` 是密钥存储协议，`infra/llm-protocol` 是三协议 HTTP 适配层。把它们放一起评审是对的——provider 行的 `secret_ref` 是 SKSP 的 ref，model request 又得同时拿 provider 配置 + 解 SKSP + 选 adapter，三块在运行期是同一条数据通路。adapter.port 被 36 处引用是 port 型文件的正常密度（L3 已确认），真正宽的反而是 `public/provider.ts`，下面专门说。

数据流是这样的：用户在 UI/CLI 填的 apiKey，经 `DefaultProviderService.create/edit` 写到 `secretStore.set(provider/<uuid>/apiKey, plain)`，composite store 的 `set` 只下沉到 DB 驱动（env 是只读覆盖层），最后由各端 SKSP 驱动用平台密钥（DPAPI / Keychain / Keystore）加密成 `sksp_secrets.ciphertext`。请求路径反过来：`DefaultModelRequestService.request(savedModelId)` → `savedModels.findById` → `providers.findById` → `resolveProviderApiKey` 走 composite.get（**env 优先**，未命中再 DB），DB 也没有就回落到 `builtinDefaultApiKey(builtinKey)`（目前只有 opencode 的 `"public"`），最后把明文塞进 `adapter.chat({ apiKey, … })`。adapter 按 `provider.protocol` 在 registry 里取 openai/anthropic/gemini 实现，SSE 流式走 `postSse`，按 `shouldUseXhrForSse()` 分发到 fetch 或 XHR 两条路径。明文不出现在 DB 任何列、不出现在日志（debug-fetch 脱敏完备，L8 已认证）——这是仓库里安全实现质量最高的子系统之一。

被谁依赖：三端 runtime 都通过 `@novel-master/core/provider` 拿 service bundle 与类型（apps 累计 39 次subpath import），`@novel-master/core/sksp` 走独立 subpath 给 driver 包注册用（5 次），`@novel-master/core/tdbc` 给 SKSP/TDBC 驱动协议用。provider 的 `currentProviderId` / `currentModelId` 状态走 `service/persistent-state`（`nm-workspace-state` KKV），但清理责任落在了 app 层而不是 core，这是下面 S1 的核心。

## 功能正确性核对

逐条对了 `provider-model`、`provider-identity`、`saved-model-identity`、`opencode-builtin-provider`、`sksp` 的 PRD/SPEC 与当前代码：

**身份模型与 seed（provider-identity）——代码合规**。`builtin-providers.ts` 用单一数据源 `BUILTIN_PROVIDER_ROWS` 同时派生 `BUILTIN_PROVIDER_UUID_PROTOCOLS`、`BUILTIN_PROVIDER_KEYS`、`BUILTIN_DEFAULT_API_KEY_BY_KEY`，固定 UUID（`c0ffeeee-0001-…-005`）+ `builtin_key` 双身份与 spec §23-60 完全对齐；`seed-builtin-providers.ts` 用 `WHERE NOT EXISTS (… builtin_key = #{key})` 幂等插入、不覆盖用户改动，与 spec §85 一致；`sqlite-provider.repository.ts` 的 `insert` 写 `builtin_key` 而 `update` 故意不写，正是 spec §56 的「`builtin_key` 是不可变身份」语义（L1 已标过可读性建议）。

**协议推断（provider-identity §88-92）——代码合规但错误路径可疑**。`infer-llm-protocol-from-model-id.ts` 已不再用 `BUILTIN_PROVIDER_PROTOCOLS[saved.providerId]`，而是先查 `BUILTIN_PROVIDER_UUID_PROTOCOLS[saved.providerId]`，未命中再 `providers.findById` 取 `builtinKey`/`protocol`，符合 spec。**但**三处错误路径（saved 找不到、provider 找不到、`catch`）全部静默回落 `"anthropic"`——spec 没要求这个默认值，详见 A2。

**`savedModelDisplayName` 第二参必填（provider-identity §110-118）——合规**。`saved-model.ts` L25-30 的签名 `(model, providerDisplayName: string)` 是显式必填 string，没有用 `providerId ?? displayName` 这种糊弄过去的回退。

**`opencode` 内置——代码合规，PRD 文案过期**。`opencode-builtin-provider/prd.md` §59 与验收 §67 仍写「`id=opencode`」「`--providerId opencode`」，那是 provider-identity 之前的合同；当前代码 id 是固定 UUID、`builtin_key="opencode"`、`defaultApiKey="public"`，`providerApiKeyIsConfigured` 对内置默认 key 显示 `set`，与 PRD §51-55 的实际意图一致。属于文档漂移，不是代码偏离。

**`provider-model` PRD §76-77 删除清理 `currentProviderId`/`currentModelId`——core 不护，app 层各端不等价**。`DefaultProviderService.delete` 只清 suggestions/savedModels/providers/secretStore 四步，不动 `currentProviderId`/`currentModelId`；CLI（`apps/cli/src/provider/commands.ts` L94-112）和 Desktop IPC（`apps/desktop/src/main/ipc/handlers/providers.ts` L89-104）各自在 service 调用前后查 `getCurrentModelId` 并按归属 `resetCurrentModelId`，**mobile 完全没有 provider 删除入口**（`grep providers\.delete` 在 `apps/mobile/src` 零命中，`ProviderDetailScreen.tsx` 只做模型批量删）。这条单独看是 app 层分工，叠 L6/L4 就是 S1。

**SKSP env `get` 空串处理——代码比 spec 更严，spec 没同步**。`sksp/spec.md` L244-249 写的是 `v !== undefined ? v : null`（空串仍返回）；实际 `env-secret-store.ts` L17 把空串和 `trim()` 后空白都视为 null，composite 注释也明示「env 未命中：null（含空串/空白）」。方向是更安全的收紧，但 spec 没更新，留给后人改回 spec 字面语义时一颗雷——见 S2。

**SKSP 孤儿策略承诺未兑现**。`sksp/prd.md` §82 明确「SPEC 锁定孤儿行策略」，但 `sksp/spec.md` 全文没有任何「孤儿兜底」段落；当前 `provider.service.ts` delete/create/edit 跨 secretStore 多步无事务（L4 已 A 级命中），事实上孤儿策略是「无声累积」。**但** `provider-identity-v1` migration 里的 `renameSkspSecrets` 已经实现了「按 `provider/%/apiKey` 全表扫描 + 重命名」的能力——兜底机制是现成的，只是 service 层没用。见 A1。

**SKSP DDL `version` 列写入但 Android 不读**。三端 `set()` 的 INSERT 都写了 `version` 列，mac/windows 的 `get()` 都 SELECT 了 `version`，**Android `get()` 漏了**——L6 A-6 已命中。当前 `version` 硬编码 `1`，无影响；一旦未来 algo 升 v2，Android 这一端会读不到字段（依赖 TDBC 缺失列的 undefined 行为）。这条归 L6 不重复展开，本切片只确认它在 provider-llm 的强耦合外围里。

## 交叉发现（核心产出）

### S1 删除 provider 的 `currentProviderId`/`currentModelId` 清理责任散在 app 层，mobile 完全漏接

- 涉及角度：L4（错误处理——多步写无事务的 A 级发现）+ L6（跨端功能矩阵不对齐）+ L7（部分失败路径无测试）
- 位置：`packages/core/src/service/provider/impl/provider.service.ts:138-154`（core delete 不动 current*）；`apps/cli/src/provider/commands.ts:94-112`（CLI 自行清理）；`apps/desktop/src/main/ipc/handlers/providers.ts:89-104`（Desktop 自行清理）；`apps/mobile/src/**`（零 provider delete 入口）
- 矛盾点：L4 已经标过 provider delete 是跨 secretStore 的四步裸写无事务，单角度结论是「DB 侧可以包事务、secret 侧 best-effort」。叠上 L6 后冒出来的新问题是：`provider-model/prd.md` §76-77 这条「删 provider 时清 `currentProviderId`、若 `currentModelId` 属该 provider 一并清」的契约，core service 完全不护，落到 CLI 和 Desktop IPC 各写一份。两份实现长得几乎一样（都先 `getSavedById` 判归属、删后再 `resetCurrent*`），但任何一边的修复都不会同步到另一边。更糟的是 mobile 干脆没接入 provider 删除——这跟 L6 B-4（rollbackToMessage 只 mobile 有）是镜像的功能矩阵缺口，方向相反。再叠 L7：跨 store 部分失败本来就没测试，连「currentProviderId 是否被正确清」这种 app 层契约也没有 e2e 覆盖。
- 依据：grep `providers\.delete` 在 `apps/mobile/src` 零命中；`DefaultProviderService.delete` 全函数无 `state`/`currentProviderId` 引用；CLI/Desktop 两份清理逻辑字符级近似但物理分离。
- 建议：不改代码。整改方向是把 `currentProviderId`/`currentModelId` 的清理收进 core service（或者收进一个 `ProviderLifecycleService` 高层编排），让三端调同一个入口；DB 多步删 + current* 清理放进同一事务（L4 已经提过的整改一并做），secret 删除放事务外 best-effort。同时确认 mobile 是否应该有 provider 删除入口——如果产品上 mobile 故意不做，要在 iteration 文档里写明（目前没有任何文档说明 mobile 不支持删除 provider）。

### S2 SKSP env 覆盖层：spec 与实现漂移 + 信任面设计的叠加风险

- 涉及角度：L8（env 旁路 DB 是 B 级信任面问题）+ L6（三端 env 策略不一致）+ L11（spec drift）
- 位置：`packages/core/src/infra/sksp/impl/env-secret-store.ts:11-21`（实现把空串/trim 空白视为 null）；`docs/Iterations/sksp/spec.md:244-254`（spec 写 `v !== undefined ? v : null`）；`composite-secret-store.ts:26-35`（env 在 DB 之前）；`infra/sksp/index.ts:4-7`（文档化的「env > DB」+「Mobile 生产不传 env」）
- 矛盾点：L8 单看 env override 是「desktop 默认开 env、信任面偏宽」的 B 级观察；L6 单看是「三端策略不一致但 documented intentional」。叠起来加上 spec drift 才看出真正的风险：当前实现把 env 空串视为未命中，是**比 spec 更安全**的收紧——但 spec 没同步。如果未来有人按 spec 字面（「`v !== undefined` 即返回」）改回，那么用户 shell 里设了 `NOVEL_MASTER_PROVIDER_<UUID>_API_KEY=`（空串）会让 env 命中并返回空串，composite 把空串当 apiKey 透传给 adapter，HTTP 鉴权失败但根因被「env 覆盖」盖住。换句话说，当前安全行为完全靠代码偏离 spec 在撑，规范文档反而是不安全的那一版。
- 再叠 L8 已命中的信任面：desktop 默认开 env 意味着任何能改 `process.env` 的进程内代码都能让 UI 配的 apiKey 失效；这条风险 L8 已经独立提过，本切片不重复，只补充——「env 优先 + 空串语义不明确」叠加会让 L8 提的信任面问题更难诊断（用户看到的错误是 HTTP 401，不是「你的 env 覆盖了 DB」）。
- 依据：`env-secret-store.ts` L17 的 `v === "" || v.trim() === ""` 判定；`sksp/spec.md` L248 `return v !== undefined ? v : null`；composite L30 `if (fromEnv !== null) return fromEnv`——如果 env 改回 spec 语义，空串会穿透 composite。
- 建议：不改代码。把 `sksp/spec.md` 的 env `get` 段落改成与实现一致的「空串/纯空白视为未命中」，并解释为什么（避免空 env 变量意外覆盖 DB）；同时在 `infra/sksp/index.ts` 的 module 注释里加一句「env 空串 = 未命中」的硬契约声明。L8 提的「desktop 默认关 env」是另一个独立整改项，这里不重复。

### A1 SKSP 孤儿兜底机制已存在但 service 层不用

- 涉及角度：L4（跨 secretStore 无事务 A 级）+ L7（部分失败无测试）+ 历史包袱（migration 已写过等价扫描）
- 位置：`packages/core/src/bootstrap/schema-migrations/provider-identity-v1.ts:276-347`（`renameSkspSecrets` 已实现按 `provider/%/apiKey` 模式扫描 + 逐行 DELETE/UPDATE）；`packages/core/src/service/provider/impl/provider.service.ts:138-154`（delete 顺序：suggestions → savedModels → providers → secretStore，无事务、无兜底）
- 矛盾点：L4 已经把「跨 secretStore 多步无事务」标成 A 级，单角度建议是「DB 包事务 + secret best-effort + 失败记孤儿队列 + 启动时扫一次」。叠上代码考古会发现：`provider-identity-v1` 这条 migration 里的 `renameSkspSecrets` 已经实现了「`SELECT ref FROM sksp_secrets WHERE ref LIKE 'provider/%/apiKey'` + 逐行处理」的全表扫描能力，且这段代码在迁移路径上是生产验证过的。也就是说 L4 建议的「启动时扫一次孤儿」机制，仓库里已经有等价实现可以参考/复用，但 service 层的 delete 完全没往这个方向走——连个 `console.warn` 都没有。
- 顺带一个顺序问题（L4 没单独指出）：delete 是「先小后大」（先 suggestions、savedModels，再 providers，最后 secret）。最危险的中间态是 step 3 `providers.delete` 失败——suggestions 和 savedModels 已提交、provider 行还在、secret 还在，用户重新打开看到一个「残废 provider」（没有任何 model 可选）。如果倒过来「先 providers 再 cascade」，至少 FK `ON DELETE CASCADE` 会处理 savedModels，suggestions 的孤儿是可容忍的（只是 KKV 多一条 stale 数据）。当前顺序把不可逆的 savedModels 删放在最前，是不合理的。
- 依据：`provider-identity-v1.ts` L287-292 的 SELECT 模式；`provider.service.ts` L147-153 的四步顺序；`llm_saved_model` DDL 的 `FOREIGN KEY (provider_id) REFERENCES llm_provider(id) ON DELETE CASCADE`（provider-schema.ts L28）——cascade 已就绪但 service 不依赖它，反而手动 `savedModels.deleteByProvider` 先删。
- 建议：不改代码。整改方向是把 L4 的建议落地时，直接参考 `renameSkspSecrets` 的扫描模式做一个 `cleanupOrphanSecrets()` 启动钩子（甚至可以复用同一段 LIKE 模式）；同时把 delete 顺序改成「providers 先（依赖 FK CASCADE 清 savedModels）→ suggestions → secret best-effort」，让 DB 侧的 cascade 兜底而不是手动多步删。

### A2 `inferLlmProtocolFromSavedModelId` 错误路径静默回落 `"anthropic"`

- 涉及角度：L4（错误处理——静默吞错）+ 跨模块（chat/agent 用这个推断选 adapter）
- 位置：`packages/core/src/domain/provider/logic/infer-llm-protocol-from-model-id.ts:24-49`
- 矛盾点：单看 L4 这只是个「静默吞错」的小问题，但叠上消费方就严重了——这个函数被 agent 配置导出、prompt 渲染等路径用来决定走哪个协议 adapter。三处 fallback（saved 找不到 → `"anthropic"`、providers 传入但找不到 → `"anthropic"`、`catch` 任何异常 → `"anthropic"`）会把「配置缺失」「DB 查询失败」「schema 不一致」全部掩盖，然后用 anthropic 协议对一个可能是 openai/gemini 的 endpoint 发 HTTP，用户看到的错误是「401 / 400 / 网络错误」，根因（saved_model UUID 指向已不存在的 provider）完全隐藏。spec 没有要求这个默认值，是代码自己加的。
- 依据：L26-28、L40-42、L47-49 三处 `return "anthropic"`；spec `provider-identity/spec.md` §88-92 只要求「不再用 `BUILTIN_PROVIDER_PROTOCOLS[saved.providerId]`」，没说错误路径默认值。
- 建议：不改代码。整改方向是错误路径显式抛 `ProviderError("NOT_FOUND", …)` 或 `PROTOCOL_INFER_FAILED`，让调用方决定是退化还是报错；如果产品上确实需要静默默认（比如 agent export 容错），至少把默认值改成可配置或加 `console.warn`，并在 spec 里写明为什么默认 anthropic。

### B1 `BUILTIN_PROVIDER_IDS` deprecated 别名语义已变，存在误用风险

- 涉及角度：L7（dead code 嫌疑）+ L11（doc/naming drift）
- 位置：`packages/core/src/domain/provider/logic/builtin-providers.ts:120-125`（`BUILTIN_PROVIDER_KEYS` + `BUILTIN_PROVIDER_IDS = BUILTIN_PROVIDER_KEYS`）；同文件 L139-147（`builtinProtocolByProviderId` deprecated 双查 key 与 UUID）
- 矛盾点：`provider-identity` 把 `BUILTIN_PROVIDER_IDS` 的语义从「内置 UUID 列表」改成了「`builtin_key` 列表」（openai/anthropic/google/openrouter/opencode），保留旧名作为 deprecated 别名。问题在于：旧调用方如果按 pre-identity 语义用 `BUILTIN_PROVIDER_IDS` 当 UUID 列表，现在拿到的是 key 列表，类型还是 `readonly string[]` 编译器不会拦——典型的「改名不改类型」陷阱。`builtinProtocolByProviderId` 更糟，同时按 key 和 UUID 双查，调用方分不清自己传的是哪个域。
- 依据：注释 `@deprecated 请用 BUILTIN_PROVIDER_KEYS；现为 builtin_key 列表而非 UUID`；grep 确认 apps 层仍有少量引用（需 phase3 进一步确认是否真的在当 UUID 用）。
- 建议：不改代码。整改方向是给 deprecated 别名改类型（比如 `BUILTIN_PROVIDER_IDS: readonly BuiltinKey[]`）让旧用法编译失败，逼调用方显式选 `BUILTIN_PROVIDER_KEYS`（key 域）或 `BUILTIN_PROVIDER_UUIDS`（UUID 域）；`builtinProtocolByProviderId` 直接删，强制调用方选 `builtinProtocolByProviderKey` 或显式查 UUID 表。

### B2 `public/provider.ts` 把 `infra/tokenizer` 整个子系统一并 re-export

- 涉及角度：L8（公共面过宽）+ L6（tokenizer 三端不一致）+ L3（facade 边界）
- 位置：`packages/core/src/public/provider.ts:125-159`（35 个 tokenizer 符号 re-export）；对比 `public/chat.ts` L8 已被 L3/L8 标过同类问题
- 矛盾点：L8 单看是「public 面过宽」的 B 级；叠 L6（tokenizer 三端计数公式不一致、RN heuristic 回退时 `counterKind` 撒谎）就升级了——外部消费者通过 `@novel-master/core/provider` 拿到 `countPromptLlmInput` / `createDefaultTokenCounterRegistry`，会以为自己在用 provider 的稳定 API，实际上拿到的是个三端行为分叉的子系统。tokenizer 是独立的 infra capability（`infra/tokenizer`，747 行 16 文件），与 provider 配置域是不同 bounded context，把它整个塞进 provider 的 public face 是耦合泄漏。compaction 切片（D2-compaction S1）已经发现 compaction 也独立暴露 tokenizer，说明 tokenizer 在多个 public face 重复出口——这是跨切片的模式，建议 phase3 一起看。
- 依据：`public/provider.ts` L125-159 一整段 tokenizer re-export；L6 A-4 已确认三端 tokenizer 公式分叉。
- 建议：不改代码。tokenizer 应该有自己独立的 subpath（`@novel-master/core/tokenizer`）或只在顶层 facade 暴露，不应该挂在 provider 下；短期内至少在 `public/provider.ts` 加注释说明「这里的 tokenizer export 是历史便利性，新代码请走独立 subpath」。

## 债务清单

| 严重度 | 标题 | 涉及角度 | 位置 |
|--------|------|---------|------|
| **S** | 删除 provider 的 current* 清理散在 app 层，mobile 漏接 | L4+L6+L7 | provider.service.ts:138-154 + cli/desktop/mobile 各 runtime |
| **S** | SKSP env 空串语义 spec 与实现漂移，当前安全行为靠代码偏离 spec 撑 | L8+L6+L11 | env-secret-store.ts:17 vs sksp/spec.md:248 |
| **A** | SKSP 孤儿兜底机制已在 migration 写过但 service 不用；delete 顺序先小后大不合理 | L4+L7 | provider-identity-v1.ts:276 + provider.service.ts:147 |
| **A** | `inferLlmProtocolFromSavedModelId` 三处静默回落 anthropic，掩盖配置错误 | L4+跨模块 | infer-llm-protocol-from-model-id.ts:24-49 |
| **B** | `BUILTIN_PROVIDER_IDS` deprecated 别名语义已变（UUID→key），类型不变 | L7+L11 | builtin-providers.ts:120-125 |
| **B** | `public/provider.ts` 把整个 tokenizer 子系统 re-export，叠三端不一致 | L8+L6+L3 | public/provider.ts:125-159 |
| **C** | `opencode-builtin-provider` PRD 文案仍写 `id=opencode`（已 UUID 化） | L11 | opencode-builtin-provider/prd.md:59,67 |
| **C** | `provider-model` PRD §62 的 `defaultModelId` 字段在当前 model/DDL 已不存在 | L11 | provider-model/prd.md:62 vs provider.ts model |

注：L4 已 A 级命名的「跨 secretStore 多步无事务」本身不在本表重复，只在 A1 里引用；L1 的「双身份键 insert/update 字段集不一致」、L6 的「CLI 硬编码 Windows SKSP / SSE 不对齐 / registry 不统一 / Android 漏 version / tokenizer 不一致」均为单角度已认定，本切片不重复展开，仅在交叉发现里作为叠加项引用。

## 与其他模块的耦合点

- **`service/persistent-state`（`nm-workspace-state` KKV）**：`currentProviderId` / `currentModelId` 是 provider 生命周期的关键状态，但清理责任不在 core。任何改 provider CRUD 的迭代都要记得三端 app 层各有一份清理逻辑——S1。
- **`infra/tokenizer`**：通过 `public/provider.ts` 与 `public/compaction.ts` 两个 face 重复出口；`DefaultProviderModelService.getTokenCounterMode` 读 saved model 设置决定计数模式，与 compaction evaluator 共享同一套 token 计数结果。tokenizer 三端不一致（L6 A-4）会同时污染 compaction 判定和 provider model 配置——建议 phase3 把 tokenizer 作为独立切片或跨切片模式处理。
- **`infra/llm-protocol` × `domain/chat`**：`LlmChatRequest.history` / `toolUseLookupMessages` 直接吃 `ChatMessage[]`，adapter 内部用 openai/anthropic/gemini-content-mapper 把 chat content block 翻译成各协议 wire 格式。任何 chat content block 的字段调整都会同时影响三个 adapter——这是 chat 切片与本切片的强耦合点，phase3 重点核对。
- **`bootstrap/schema-migrations/provider-identity-v1` + `saved-model-identity-v1`**：这两条 migration 都改了 provider/saved-model 的主键形态并级联改写 sksp_secrets.ref 和 KKV key。`renameSkspSecrets` 的扫描模式（A1）是仓库里唯一一份「全表扫 sksp ref」的参考实现，未来任何 sksp ref 重构都需要。
- **三端 `sksp-{windows,mac,android}` driver 包**：通过 `@novel-master/core/sksp` 的 registry 注册；mobile 绕过 registry 直连 `createAndroidSecretStore`（L6 A-5）。driver 包内部实现（DPAPI / Keychain / Keystore）不在本切片文件范围内，已由 L8 §4.1 认证为正面。
- **`agent` / `prompt` 模块**：`inferLlmProtocolFromSavedModelId` 的错误默认值（A2）会通过 agent export / prompt 渲染路径传播；任何「协议选错」类的 bug 都要先排查这个静默默认。
- **`db-backup`**：`restoreProviderTableSnapshot` 依赖 provider 三表的 FK 顺序恢复，sksp_secrets 因为平台绑定密文在跨设备恢复时会 `DECRYPT_FAILED`（L6 B-1）——backup/restore 是 provider-llm 与 cloud-sync 的交叉面。

## 覆盖声明

**查了**：core 内 `domain/provider`（model + logic + repositories/impl 全部）、`service/provider`（4 个 service impl + 3 个 port + factory）、`infra/llm-protocol`（adapter.port + registry + sse-transport 全文 + impl/logic 目录结构）、`infra/sksp`（全部 7 文件）；三端 app 层的 provider delete / current* 清理 / mobile provider 删除入口；`bootstrap/provider` schema + seed；`bootstrap/schema-migrations/provider-identity-v1`（含 renameSkspSecrets 全段）；6 个核心 Iteration 的 PRD + 关键 SPEC 段落；全部 11 份 D1 lens 报告中 provider/sksp 相关命中段。

**没查**（留 phase3 或别的切片）：
- 三端 sksp driver 包（`sksp-windows` / `sksp-mac` / `sksp-android`）的内部加解密实现——L8 §4.1 已认证为正面，本切片只确认 core 侧合同面；
- `infra/tokenizer` 内部算法——L6 A-4 已详述，D2-compaction 切片已从 compaction 角度切入，建议作为独立切片或与 D2-prompt 合并；
- openai/anthropic/gemini 三个 adapter 的内容映射细节（content-mapper、sse-parser）——体量大（占 llm-protocol 3596 行大头），且与 chat content block 强耦合，建议留给 chat 切片或独立 adapter 切片；
- mobile/desktop 的 provider UI 表单层（创建/编辑表单字段）——provider-identity §203-214 要求的 UI 改造在 app 层，本切片只确认 core service 返回的 `provider.id` 是 UUID、`displayName` 必填，UI 是否真的「不展示 UUID」需要 app 层切片核对；
- agent / prompt 模块如何消费 `inferLlmProtocolFromSavedModelId` 的静默默认——A2 的下游影响范围留给 agent/prompt 切片或 phase3。

**为什么不查**：以上四项要么已被其他 lens/切片覆盖（避免重复），要么属于不同 bounded context（超出本切片 file scope），硬塞进来会稀释交叉发现的重点。
