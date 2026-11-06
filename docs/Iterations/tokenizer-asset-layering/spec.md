---
name: tokenizer-asset-layering
status: draft
created: 2026-11-06
branch: fix/tokenizer-switch-stall
supersedes: [nmtp/spec.md 中「tokenizerAssetPaths 留 core」的决策]
---

# 分词资产分层清理 SPEC

## 1. 背景

`packages/core/src/infra/tokenizer/logic/tokenizer-asset-paths.ts` 是一张**平台资产路径表**：13 个家族 → `assets/tokenizers/` 下的相对路径。它被挂在 `public/provider.ts` 的公共出口上，但全仓生产消费点只有两个，都在 `tokenizer-driver-node` 内部。

后果链：

1. core 说 `gemma → gemma.model`，那是 **node 平台的事实**，不是跨平台契约
2. 移动端资产不同（Android 无 SentencePiece native，改用转换后的 `gemma.json`），**没法复用**，只能抄一份 `TokenizerAssetPaths.kt`
3. 抄完开始漂移：`bare`（编码口径）字段只在 Android 侧有，core 那份没有
4. 漂移要靠 README、Kotlin KDoc、脚本头三处注释解释「这是有意分叉」
5. 于是出现「删掉一个没人读的 1MB 文件反而让逻辑更绕」——因为删文件会破坏「spec 必须指向存在的资产」这个**隐含不变量**

同一模块还挂着：45 个 provider 运行时导出（21 跨包 / 7 单包 / **17 零外部生产消费**）、4 个 FAKE_PUBLIC、18 个 DEAD、7 个 TEST_ONLY、11 个 INLINE_CANDIDATE，以及 `provider` 与 `nmtp` 的 4 个重复运行时导出。

**这不是迁移问题，是边界问题。** core 持有的是「跨平台事实」和「某一平台的实现细节」的混合物。

## 2. 目标与非目标

### 目标

- **G1** core 只保留跨平台事实：`TokenizerFamily`、`resolveTokenizerFamily`、计数端口、序列化/缓存等无平台假设的逻辑
- **G2** 资产路径归还给各自平台：node 驱动自持，RN 驱动已自持
- **G3** 平台能力显式声明，不再靠「文件存在性」或「构造异常类型」推断
- **G4** 编码口径（裸编码 / WEB 包装）从资产表中分离
- **G5** 按 nm-code-style 清掉本模块的 FAKE_PUBLIC / DEAD / TEST_ONLY 与重复出口
- **G6** 消除「删死资产会让逻辑变绕」——删掉 `yi.model` / `jamba.model`（2.1MB）后路径仍然清晰

### 非目标

- **不引入 codegen**：全仓无 Kotlin 代码生成先例，`generate-tokenizer-parity-goldens.mjs` 是手跑脚本；引入生成器要配套 `DO NOT EDIT` 约定、CI `--check` 步骤、`check-ci-gates.mjs` 登记。两份表**本来就有意不同**（`.model` vs `.json`、tiktoken 两表仅 Android），codegen 只会在“家族覆盖度”上有价值，而那用**表级守卫测试**更轻
- **不处理 `infra → service` 5 处上行依赖**（`ARCHITECTURE.md:28` 标 forbidden，但属既有架构债，与本需求正交）
- **不改 `bare`/`kind` 字符串为 enum**（Kotlin 侧改动面覆盖全部测试与错误消息，收益不抵风险；本轮只做**语义分离**，形态保留）
- **不动 desktop 的 SP WASM 资产策略**
- **不以 APK 体积为主要验收指标**（删死资产只省压缩后约 1.06MB；`gemma.json` 压缩后 5.59MB 才是大头）

## 3. 现状证据（探索结论摘要）

### 3.1 core 侧

| 事实 | 证据 |
|---|---|
| 资产表全仓生产消费仅 2 处，都在 node 驱动 | `tokenizer-driver-node/src/impl/sentencepiece-token-counter.ts:13,56`、`web-token-counter.ts:13,59` |
| 公共出口 + barrel 三处转出 | `public/provider.ts:165`、`infra/tokenizer/index.ts:119`、快照 `public-provider-allowlist.json:93` |
| 无任何测试直接测资产表 | `packages/core/test/infra/tokenizer/` 下无 `tokenizer-asset-paths.test.ts` |
| 历史决策明确「留 core」 | `docs/Iterations/nmtp/spec.md:28,181,283,351`（本 SPEC 推翻） |
| 4 个 FAKE_PUBLIC | `CHUNK_CACHE_MAX_TOTAL_ENTRIES`、`MAX_CHUNK_CHARS`、`PROMPT_WHOLE_CACHE_LRU_PER_SESSION`、`TOKEN_COUNTER_MODE_PREF_KEY`（均 0 生产消费者；其中 2 个仍被测试从模块文件直接 import——`MAX_CHUNK_CHARS`、`PROMPT_WHOLE_CACHE_LRU_PER_SESSION`，`TOKEN_COUNTER_MODE_PREF_KEY` 则被 `token-counter-mode-no-public-path.test.ts:60-64` 显式断言 provider 导出） |
| 18 个 DEAD（15 类型 + 3 变量） | 见任务 T3 清单；**均不影响运行时快照**（纯类型不进 `Object.keys`） |
| `provider` 与 `nmtp` 重复出口 | `getTokenizerDriver` / `resolveTokenizerDriver` / `clearTokenizerDrivers` / `TokenizerError` + `TokenizerDriver` / `TokenizerErrorCode`；`provider.ts:4-5` 自己写「驱动注册请走 nmtp」，与导出面矛盾 |
| `format-token-source-badge.ts` 是零逻辑 re-export wrapper | `logic/format-token-source-badge.ts:23-27` |

### 3.2 Android 侧

| 事实 | 证据 |
|---|---|
| `AssetPathSpec` 把「资产在哪」和「怎么编码」揉在一起 | `TokenizerAssetPaths.kt:13-21`；`bare` 优先于 `kind` 分派（`TokenizerEngine.kt:98-100`） |
| `bare` 是编码口径而非资产形态 | 同为 `kind="json"`，gemma/llama/mistral/tiktoken 是 `bare=true`，6 个 WEB 家族是 `false`；差 3~5 token（`TokenizerParityTest.kt:68-78`） |
| `yi.model` / `jamba.model` 是死资产 | 构造必失败（失败点在 `TokenizerEngine.kt:272-283` 的 DJL 静态初始化异常）；`:263-266` 的 `spUnavailable` 短路因永远记不进去而不可达 |
| **`spUnavailable` 的能力推断失效** | DJL 0.33.0 `SpProcessor` 的 static 初始化只 `catch (RuntimeException)`；native 资源缺失时 `LibUtils.copyJniLibraryFromClasspath` 抛 `IOException` → 包成 `IllegalStateException`。**当前 catch 的 `LinkageError` 捕不到**，`spUnavailable` 永不写入（`TokenizerEngine.kt:274-283`） |
| 守卫不完整 | `everyKnownFamilyPrimaryAssetExists` 用 `exists()` 非 `isFile()`（目录可假通过）、不查 `fallback`、不查 tiktoken 两表 |
| Kotlin 测试无任何 CI 入口 | `ci.yml:50-124` 无 Gradle test；`android-nightly.yml:60-77` 只 assembleDebug |

### 3.3 两端资产差异（有意分叉，必须保留）

- **Node 独有**：`llama.model`/`mistral.model`/`gemma.model`/`yi.model`/`jamba.model`（SP WASM 能跑）、`nerdstash*.model`（**2MB 无引用死文件**）
- **Android 独有**：`cl100k.json`/`o200k.json`（tiktoken 两表）、`gemma.json`/`llama.json`/`mistral.json`（SP→HF 转换版）
- **共享且字节相同**：`claude.json`、`llama3.json`、`web/*` 六份

## 4. 设计方案

### 4.1 分层

```
core（跨平台事实）
├── TokenizerFamily 联合类型
├── resolveTokenizerFamily(modelId)          纯字符串映射
├── TokenCounter / TokenizerDriver 端口
└── 计数/缓存/序列化逻辑（无平台假设）

node 驱动（node 平台事实）
├── tokenizer-asset-paths.ts                 资产表（.model / .json / fallback）
└── 表级守卫测试：遍历 family 断言资产存在

RN 驱动（Android 平台事实）
├── TokenizerAssetPaths.kt                   资产表
├── TokenizerCapabilities.kt                 能力位（新）
└── 表级守卫测试（已有，需加强）
```

**核心原则**：资产路径是平台事实，不跨平台共享；**家族清单**是跨平台事实，由 core 的 `TokenizerFamily` 单点定义。

### 4.2 能力位（修 `spUnavailable` 的根）

**现状**：运行时尝试构造 → 失败 → 记忆。问题：异常类型判断不可靠（见 3.2），且首次尝试白付拷贝 + JNI 失败。

**改为构建期事实**：

```kotlin
// TokenizerCapabilities.kt（新文件）
/**
 * 当前构建是否带 SentencePiece native。
 *
 * DJL 从未发布 Android 版 sentencepiece-native（官方 discussion #3742），
 * 当前 APK 里也没有 libsentencepiece_native.so，构造 SpTokenizer 必然失败。
 * 与其在运行时靠异常类型推断（DJL 抛的是 IllegalStateException 而非
 * LinkageError，catch 不住），不如把「有没有 SP native」钉成构建期常量。
 *
 * 恢复 SP 支持需要三件事同时做，本常量只负责能力声明：
 *   1. 自编译 arm64 libsentencepiece_native.so 并打进 jniLibs
 *   2. 重新引入 .model 资产到 assets/tokenizers/
 *   3. 恢复 countSpFamily / loadSpTokenizer 与 dispatch 的 model 分支
 */
internal const val SENTENCEPIECE_NATIVE_AVAILABLE = false
```

能力判定抽成**纯函数**，放在资产读取之前，便于单测：

```kotlin
// TokenizerCapabilities.kt（与常量同文件，internal，测试可见）
internal fun isSpUnavailableSpec(spec: AssetPathSpec): Boolean =
    spec.kind == "model" && !SENTENCEPIECE_NATIVE_AVAILABLE
```

**保留说明**：B 案删掉表中 yi/jamba 后，生产侧 `resolveAssetSpecFor` 只会返回 `kind="json"`，这个函数的 `model` 分支暂时没有生产入口，**保留它是作为未来 SP 恢复的锚点**（届时只需加回表条目 + `countSpFamily`），当前由 T10 的单测覆盖。

`TokenizerEngine.count()` 的 dispatch（**保持 `CountResult` 非空返回**）：

```kotlin
when {
    isSpUnavailableSpec(spec) ->
        throw IllegalStateException("SP native unavailable: ${spec.primary}")
    isBareCaliber(family) -> countBareJsonFamily(...)
    spec.kind == "json" -> countWebFamily(...)
    else -> throw IllegalStateException("家族 $family 的资产类型未知: ${spec.kind}")
}
```

**注意**：T9 会删掉 `countSpFamily`，因此样例里不再有 `kind == "model"` 分支；`else` 保留了原有的「资产类型未知」保护（对应 `TokenizerEngine.kt:102`）。未来恢复 SP 时，在 `else` 之前加回 `spec.kind == "model" -> countSpFamily(...)` 即可。

**行为差异要说清**：JS 侧与今天一致（reject → `countHeuristicViaNative` 回退）；**原生侧省掉了 `.model` 拷贝与一次必然失败的 JNI 构造**——今天会先拷贝再失败，新方案在 `resolveAssetSpecFor` 就抛错。

**为什么不返回 null**：`count()` 现签名返回非空 `CountResult`，`TokenizerModule` 直接读 `result.tokenCount`（`TokenizerModule.kt:70-74`），null 会 NPE。抛 `IllegalStateException` 走的是**现有失败通道**：JS 桥 catch → reject → `count-prompt-llm-input.ts` 的 `countHeuristicViaNative` 回退。行为与今天一致，且不需要给 Engine 引入 `Context` 注入缝或 Robolectric。

**收益**：
- `spUnavailable` 集合、`spCache`、`loadSpTokenizer`、`countSpFamily`、`SpTokenizer` import **全部删除**
- `.model` 条目从资产表移除后，`resolveAssetSpecFor("yi")` 在资产读取前就抛错
- **不需要新 `kind`**
- 能力判定是纯函数，可单测且不依赖 `Context`

**风险**：若判断错误（其实有 native）会静默降级。B 案删掉表中 model 条目后该路径没有生产入口，风险只在**未来恢复 SP 时误判**；缓解：`isSpUnavailableSpec` 单测覆盖 `kind=model` / `kind=json` 两种输入。

### 4.3 编码口径分离

`AssetPathSpec` 保留 `primary` / `fallback` / `kind`，**只移除 `bare`**（`kind` 仍被 dispatch 与静态校验使用，不能删）。口径改成独立的**家族→口径**判定，放在 `TokenizerEngine.kt` 顶层、`internal` 可见（生产 dispatch 与两个测试共用，满足 C2 的「单点定义」）：

```kotlin
// 裸编码家族：SP 转 HF 三族 + tiktoken 两表
// 这些家族必须整串直编码，不能做 WEB 的 system 包装——差 3~5 token
internal fun isBareCaliber(family: String): Boolean =
    family in setOf("gemma", "llama", "mistral", "tiktoken")
```

**连带改动**（T10 必须覆盖）：`TokenizerEngineTest` 有 5 处 `spec.bare` 断言（`:131,137,142,160,165`），`TokenizerParityTest` 有 2 处 `spec.bare` 分派（`:71,121`）——全部改为调用 `isBareCaliber(family)`。

**取舍说明**：探索建议改成 enum，但 enum 会波及全部测试与错误消息。本轮只做**语义归属分离**（从资产结构里拿出来），形态保留布尔。

### 4.4 nm-style 清理

按 nm-code-style 判据：

| 类别 | 数量 | 处置 |
|---|---|---|
| FAKE_PUBLIC | 4 | 撤 `provider` + `index` 导出，**模块内同时去掉 `export`** 降级为本地 `const`；同步删快照 4 条；`TOKEN_COUNTER_MODE_PREF_KEY` 模块内零使用，直接删符号 |
| DEAD（类型） | 11 + 4 | 11 个去 `export`（撤 `provider`/`index` 转出 + 声明处去 export，保留本地声明供同文件签名）。两个易漏项：`ChatTokenEstimateMemoEntry`（只在模块层导出）、`SessionApiPromptTokenEntry`（只在 `index.ts:60` 导出）。**另 4 个是 `countTokens` 的签名类型**（`ChatTokenEncoder` / `ChatTokenMessage` / `ChatTokenCountKind` / `CountTokensOptions`）→ 标 `keep-public` 保留，见下方「必须保留」 |
| DEAD（变量 `DEFAULT_*`） | 3 | 撤 `public/format.ts` 转出，**模块内去掉 `export`**。无快照保护，属静默收窄 |
| TEST_ONLY | 7 | 5 个规格常量/类型（`CJK_TOKENS_PER_CHAR`、`ENCODING_RETRY_TTL_MS`、`SENTENCE_END_CHARS`、`SOFT_BOUNDARY_CHARS`、`IncrementalTokenCounterDeps`）改为测试本地常量/本地类型，**模块内去掉 `export`**；`clearChatTokenEstimateMemo`、`setClockForTests` 保留导出（真测试钩子） |
| INLINE_CANDIDATE | 11 | 逐条判定，见 T5。其中 4 个 public 项**必须离开 provider**，否则 A3 的 82 不成立 |
| 重复出口 | 4 运行时 + 2 类型 | `provider` 撤出，统一走 `@novel-master/core/nmtp` |
| 纯 re-export wrapper | 1 | `format-token-source-badge.ts` 删除，`provider` 直接从 `common` 转出 |

**为什么必须「模块内也去 export」**：`find-fake-exports.mjs:220-237` 只统计带 `export` 的声明——只撤 barrel 转出而保留 `export type`，审计仍判 DEAD（FAKE_PUBLIC 判定同理）。要让 E1 的指标成立，必须在声明处去掉 `export`。

**必须保留（write `nm-style: keep-public — 理由`）**：

- `countPromptLlmInputHeuristicOnly`：desktop 跨包消费，依赖 core 序列化 + 家族解析 + registry
- `countWebTokenizerMessages` / `convertMessagesForWebTokenizer`：node 驱动跨包消费
- `ChatTokenEncoder` / `ChatTokenMessage` / `ChatTokenCountKind` / `CountTokensOptions`：`countTokens` 的完整签名，`countTokens` 已拍板 keep-public（开放问题 4）

## 5. 验收标准

### A. 分层正确性

- **A1** `grep tokenizerAssetPaths` 在 `packages/core/src` **零命中**
- **A2** `packages/core/src/public/provider.ts` 不再导出任何**资产路径**相关符号
- **A3** `@novel-master/core/provider` 的运行时导出数从 95 降到 ≤ 82：95 − 1（`tokenizerAssetPaths`）− 4（FAKE_PUBLIC）− 4（nmtp 重复运行时）− 4（public INLINE 项离开 provider）= 82
- **A4** node 驱动的资产表是 `src/logic/tokenizer-asset-paths.ts`，**不从 core 导入**

### B. 能力位

- **B1** `isSpUnavailableSpec(spec)` 对 `kind="model"` 返回 true、对 `kind="json"` 返回 false；`SENTENCEPIECE_NATIVE_AVAILABLE = false` 时 `count()` 对 yi/jamba 在**资产读取前**抛 `IllegalStateException`（`copyAssetToCache` 是 private，结构上不可达即可，无需 spy）
- **B2** `spUnavailable` / `spCache` / `loadSpTokenizer` / `countSpFamily` 全部删除，`SpTokenizer` import 消失
- **B3** 真机切到 yi/jamba，chip 走 `gpt ≈`，**不产生秒级阻塞**（复用上一轮 `nm-tok` 探针）

### C. 编码口径

- **C1** `TokenizerParityTest` 的 bare 家族精确断言仍全绿（gemma 160 = 160）
- **C2** `AssetPathSpec` 不再有 `bare` 字段；`isBareCaliber` 单点定义

### D. 死资产

- **D1** `android/src/main/assets/tokenizers/` 下不再有 `yi.model` / `jamba.model`
- **D2** node 侧 `nerdstash.model` / `nerdstash_v2.model` 删除（2MB 无引用）
- **D3** 两侧表级守卫测试都遍历**表中全部条目**断言 `primary`/`fallback` 是 **`isFile()`** 且扩展名与 `kind` 一致；Android 侧另覆盖 `forTiktokenEncoding`（`cl100k_base` / `o200k_base`）两张表。T9 删掉 yi/jamba 条目后表中不再有 `kind="model"`，全条目 `isFile()` 自然成立

### E. nm-style

- **E1** `node .agents/skills/nm-code-style/scripts/find-fake-exports.mjs packages/core/src/infra/tokenizer` 输出 `FAKE_PUBLIC=0`、`TEST_ONLY=2`（`clearChatTokenEstimateMemo`、`setClockForTests`）、`DEAD` 为 0、`INLINE_CANDIDATE` 为 0（或全部已写 `keep-local` / `keep-public` 注记）；若选择保留 `DEFAULT_*` 导出则 `DEAD=3`，须在 E3 表格逐条说明
- **E2** `check-style.mjs --changed` 对改动文件的三项子检查（`signatures` / `inline` / `methods`）PASS；**整体退出码不要求 0**——它还会带上 exports 审计（`--strict`），而 E3 允许部分 DEAD 登记在案
- **E3** 未处理的每一项在交付报告表格中列出（符号 / verdict / prod-test / 理由 / 证据）

### F. 测试

- **F1** core 全量测试绿（含 `public-subpath-allowlist` 快照同步）
- **F2** node 驱动测试绿；新增表级守卫测试
- **F3** Kotlin 单测绿（`TokenizerEngineTest` 的 family 清单移除 yi/jamba）
- **F4** Kotlin 单测接入 `android-nightly.yml`（新增 `testDebugUnitTest` step）。**不登记 `check-ci-gates.mjs`**——该脚本默认只解析 `ci.yml`，且 `EXPECTATIONS` 里的每个 step 必须存在于该文件（`check-ci-gates.mjs:48-51,213-221`），把 nightly step 登记进去会让 `ci.yml` 里的 `npm run check:ci-gates` 直接红。**定位是 nightly smoke，不承诺 PR 拦截**

## 6. 测试策略

| 层 | 新增/修改 | 覆盖目标 |
|---|---|---|
| core | 删 `tokenizer-asset-paths` 相关引用；快照同步 | 导出面收缩无遗漏 |
| node | **新增** `test/tokenizer-asset-paths.test.ts`：遍历家族 → 表非空 → `primary`/`fallback` 文件存在（`isFile()`）→ 扩展名与 `kind` 匹配 | G2 + D3 |
| node | 现有 `count-prompt-llm-input.test.ts` 的 claude/mistral 用例保留 | 真实资产加载 |
| Android | `everyKnownFamilyPrimaryAssetExists` 改 `isFile()`、补 `fallback` 与 tiktoken 两表、family 清单移除 yi/jamba | D3 |
| Android | **新增** `isSpUnavailableSpec` 纯函数用例（`kind="model"` → true、`kind="json"` → false）；另保留 gemma 走 HF 的回归用例；表中已无 yi/jamba，`resolveAssetSpecFor("yi")` 在资产读取前抛 `IllegalStateException` | B1 |
| Android | `TokenizerParityTest` 的 `countNative` 的 **bare 分支**与生产 dispatch 同构（生产已无 model 分支） | C1 |
| 真机 | 切 gemma 看 `nm-tok` 的 `kind=gemma est=false`；切 yi 看无秒级阻塞 | B3 |

## 7. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| **dist 构建顺序** | 只改 core src 不重建 dist，driver 会用旧 dist 编译通过、运行时炸 `does not provide an export` | 严格按 `RULE.md:71`：core src → 重建 core dist → 重建 driver → 跑测试 |
| **快照必红** | 删 `tokenizerAssetPaths` 不同步快照 → `public-subpath-allowlist.test.ts` 红 | T2 与 T1 同批改 |
| **node 驱动编译断裂** | 删 `CountOpenAiStyleMessageOptions` / `TokenEncoder` 会让 `tokenizer-driver-node/src/logic/count-openai-style-message.ts:22-26` 编译失败 | T3 同步改该文件 |
| **能力位判断错误** | 若实际有 SP native 却标 false → 静默降级 | 构建期常量 + 测试断言 + 真机探针 |
| **`fallback` 静默冒充精确值** | `loadWebTokenizer` fallback 成功仍报 `estimated=false`（w8-kt-4 既有问题） | 本轮不改；在开放问题登记 |
| **nm-style 脚本不扫 Kotlin** | Kotlin 侧清理无法用脚本验证 | 人工审查 + Kotlin 单测覆盖 |
| **`format` / `nmtp` 子路径无快照保护** | 对它们的收窄不会被测试发现 | 改完手动 `tsc` + 检查两 shell 入口 |
| **`check-ci-gates` 误登记** | 把 nightly step 登记进 `EXPECTATIONS` 会让 `ci.yml` 里的 `npm run check:ci-gates` 直接红（该脚本只解析 `ci.yml`） | T11 不碰 `check-ci-gates.mjs`；F4 已写明定位是 nightly smoke |

## 8. 任务拆解

| # | 任务 | 依赖 | 预估改动面 |
|---|---|---|---|
| **T1** | core 删除 `tokenizer-asset-paths.ts` + barrel 转出 + provider 导出 + 快照删 1 条（`public-provider-allowlist.json` 的 `tokenizerAssetPaths`） | — | 4 文件 |
| **T2** | node 驱动新增本地资产表 + 两个 counter 改 import | T1 | 3 文件 |
| **T3** | core 撤 4 FAKE_PUBLIC + **11** DEAD 类型（barrel 转出与声明处 `export` 一并去掉）；**4 个 `countTokens` 签名类型改标 `keep-public` 保留导出**；**同步改 6 个测试**（`token-counter-mode-no-public-path`、`chunk-splitter`、`prompt-whole-cache`、`estimate-tokens-cjk-aware`、`encoding-registry`、`incremental-token-counter`）与 node 的 re-export 文件（`count-openai-style-message.ts:22-26`）。`format-token-source-badge.test.ts` 归 T7，此处不重复 | — | ~18 文件 |
| **T4** | core 撤 3 `DEFAULT_*` 的 `public/format.ts` 转出与模块 `export` | — | 2 文件 |
| **T5** | core 11 个 INLINE_CANDIDATE 逐条处置。四个 public 项 `parseTokenChunkCachePayload` / `parseTokenCounterModePref` / `pickLastPromptUsage` / `seedContextWindowTokens` **只撤 `provider` 出口，模块内保留并写 `keep-local`**；`index.ts` 的内部 re-export 保留——`resolve-current-prompt-tokens.test.ts:23-31` 从 index 导入 `pickLastPromptUsage`。四个非 public 项：`parseSessionApiPromptTokenEntry`（21 处测试测解析边界）、`serializeSessionApiPromptTokenEntry`（14 处测试当 payload 工厂）、`stampMessagesForEstimateMemo`（`chat-token-estimate-memo.test.ts:29,115-116` 直接 import）→ **`keep-local`**；`stampToolsForEstimateMemo`（0 测试）→ **内联**。`countPromptLlmInputHeuristicOnly` / `countWebTokenizerMessages` / `convertMessagesForWebTokenizer` 写 `keep-public` 理由 | T3 | ~10 文件 |
| **T6** | 撤 `provider.ts` 的 nmtp 4 运行时 + 2 类型重复出口。**内部 barrel `index.ts:125-132` 的同名 re-export 保留**——`count-prompt-llm-input.test.ts:4-9` 从它导入 `clearTokenizerDrivers` / `TokenizerError`，撤了会编译失败 | — | 1 文件 + 快照 |
| **T7** | 删 `format-token-source-badge.ts` wrapper，`provider` 从 `common` 转出；**同步改 `core/test/infra/tokenizer/format-token-source-badge.test.ts`**（该测试从 wrapper 直接 import 并有同源断言） | T6 | 4 文件 |
| **T8** | node 新增表级守卫测试；删 `nerdstash.model` / `nerdstash_v2.model` | T2 | 3 文件 |
| **T9** | Android：新增 `TokenizerCapabilities.kt`（能力常量 + `isSpUnavailableSpec`）；删 SP 路径（`spCache` / `spUnavailable` / `loadSpTokenizer` / `countSpFamily` / `SpTokenizer` import）**及 `CountTimings.spUnavailable` 字段与对应日志字段（`TokenizerEngine.kt:48-49,332`）**；`bare` 移出 spec、改 `isBareCaliber`；**删表中 yi/jamba 两条**；删 `yi.model` / `jamba.model`；**评估退役 `ai.djl.sentencepiece:sentencepiece` 依赖（`android/build.gradle:47`）**；**同步更新注释**（`assets/tokenizers/README.md:15`、`TokenizerAssetPaths.kt:6-10`、`TokenizerEngine.kt:15,94-97,113`、`TokenizerModule.kt:14-16,20-28`、`tokenizer-driver-rn/README.md:3`、`convert-sp-to-hf.py:39-40`、`src/count-prompt-llm-input.ts:528-537`） | — | ~12 文件 |
| **T10** | Android 测试：`TokenizerEngineTest`（family 清单移除 yi/jamba、`resolveAsset` 改 `isFile()`、补 fallback 与 tiktoken 两表、5 处 `spec.bare` 改用 `isBareCaliber`、`:14-18` 头部注释与 `:56,158` 注释同步、新增 `isSpUnavailableSpec` 用例）；`TokenizerParityTest`（2 处 `spec.bare` 改用 `isBareCaliber`、**删除 `countSpNative`、`SpTokenizer` import 与 `:123` 的 `kind == "model"` 分支**、`:18-29` 头部注释同步） | T9 | 3 文件 |
| **T11** | Kotlin 单测接入 `android-nightly.yml`（加 `testDebugUnitTest` step）。**不碰 `check-ci-gates.mjs`**（理由见 F4） | — | 1 文件 |
| **T12** | 按 `RULE.md:71` 重建 dist 链（core → node driver → rn driver）、跑全量测试（core / node / Kotlin）、`check-style --all`、真机探针 | 全部 | — |

**提交切分**（避免混改）：`T1+T2`（分层）→ `T3+T4+T5+T6+T7`（nm-style）→ `T8`（守卫）→ `T9+T10`（Android）→ `T11`（CI）。

## 9. 开放问题

1. **`fallback` 冒充精确值**（w8-kt-4）：`loadWebTokenizer` 用 `llama3.json` 兜底后仍报 `estimated=false`。本轮不动，是否下一轮修？
2. **`infra → service` 5 处违规**：`ARCHITECTURE.md:28` 标 forbidden，但属既有架构债。登记还是本轮一起？
3. **`EncodingFactory` / `CreateDefaultTokenCounterRegistryDeps` 等类型**：探索报告标为「drift 后暂无人用但设计上该保留」的候选。本轮按 DEAD 撤 public（**`countTokens` 的 4 个签名类型除外，见第 4 条**）；若将来有仓外消费者需要回滚，成本是加回一行导出——可以接受吗？
4. **`countTokens` 整组** → **已拍板 keep-public**：它是文档写的「三端共用入口」，`ChatTokenEncoder` / `ChatTokenMessage` / `ChatTokenCountKind` / `CountTokensOptions` 是它的完整签名。A3 的 82 已按保留计算；同组 4 个类型从 DEAD 清单移出，改标 `keep-public`。
5. **`format` / `nmtp` 子路径无快照**：要不要补 `public-format-allowlist.json` / `public-nmtp-allowlist.json`？
6. **APK 体积**：删死资产省压缩后约 1.06MB。`gemma.json` 压缩后 5.59MB 是大头，是否另立题做紧凑格式（js-tiktoken 有先例）？
7. **旧文档标注与登记** → **已执行（2026-11-06）**：`nmtp/spec.md` 顶部加了「部分被取代」注记（只推翻 `tokenizerAssetPaths` 留 core 这一条）、`token-source-label/spec.md` 加了 wrapper 退化注记、`iterations.yaml` 加了 `tokenizer-asset-layering` 条目。
