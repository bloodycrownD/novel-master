---
date: 2026-10-02
---

# 移动端原生计数可取消（tokenizer-native-cancel）技术规格（SPEC）

## 设计目标

用户真机实报（2026-10-02）：切换项目后进入会话，chip 上下文占用的**精确升级轮**（GLM 家族真分词器原生整串计数）resolve 耗时 14.2 秒，期间侧滑返回事件排队、UI「突然卡住」（logcat 实锤：`[nm-chip] resolve done +14234ms`，期间 ReactNativeJS 零输出）。此为 2026-10-01 卡顿攻坚挂账的已知残留「原生计数中段不可中断」的 dev 链放大案例（exit-jank-fix-playbook.md:61 明写根治方向「Kotlin 侧 cancel API，需出包」）。

本迭代目标：

1. **可取消**：用户侧滑切走会话/卸载时，向 Kotlin 侧下发取消指令——在途计数在检查点短路弃置、排队中任务跳过、结果不回写。方向拍板（用户）：从干净与耦合看改 Kotlin（能力内聚在驱动原生层，**core 仅增一个可选字段 + 一行透传**、桌面端零感知），不做 JS 分块（动 core 双端共享编排、牵连 node 驱动、首段词表冷载避不掉）。
2. **可观测**：TokenizerEngine 内分段计时（词表加载 vs encode），真机量化 14.2s 构成，为后续「是否分段 encode」的口径决策（涉及 parity/双端一致性，另立决策）提供数据。

需求来源：用户口述（记录于 docs/apm/memory/20261001-chat-webview-unify-spec.md 2026-10-02 晚轮次）；无独立 PRD。

### 范围外（明确不做，防止执行漂移）

- **分段 encode**：改变「整串一次 encode」的三端一致口径（parity 金标锁定、node/core 同款），是独立口径决策——待本迭代打点数据落地后另立（见 Step 10）。
- **core 驱动 port 大改不动**：唯一例外（r1-P0-2 裁决，2026-10-02）——`CountPromptLlmInputParams` 增**可选**字段 `sessionId?: string`、`resolveCurrentPromptTokens` 调用点（:462）一行透传，为 requestId 归属提供信息源（该字段在 params/驱动链路里此前不存在，纯驱动内聚拿不到归属；替代方案 begin/endScope 作用域包裹在同会话 chip 轮与压缩预热轮并发在途时归属错乱——可选字段的正确性 > 签名字面零改动）；`TokenizerDriver` 接口形状与其余 core 零改动，node 驱动忽略该字段。
- **desktop 对齐**：desktop 计数在主进程不卡 UI，同名 service 是独立实现，不动。
- **JS 侧 serialize/build 切片化**：playbook 另一条线（`serializePromptLlmInput` ~1.3s JS 纯逻辑段），与本迭代正交。
- **压缩预热轮取消**：`warmChatTokenLabelAfterCompaction` 与 chip 精确轮可同会话并发在途；本迭代取消语义按 sessionId 统一取消（含误杀预热轮的代价：下次进入 L1 miss 重算一次，可接受——统一语义换来零归属表穿透）。若实测证明预热轮被频繁误杀，后续再收窄。
- **`cancelPreciseUpgradeDelay` 语义变更**：cr2-E-2 硬约束（timer==null 即已起跑不收口、finally 是在途轮唯一清理点）**一行不动**，本迭代取消是**新函数**。

## 总体方案

取消链路四层，信号单向（JS→Kotlin 标记、Kotlin→JS 专属 reject code）：

```
[hook] useChatTabScope 换 key 分支/卸载（cancelPreciseUpgradeDelay 调用点旁）
   ↓ cancelPreciseUpgrade(sessionId)            [新导出，mobile service 层]
[service] chat-prompt-tokens.service：标记取消 + 调驱动取消口
   ↓ cancelSessionNativeCounts(sessionId)        [新导出，RN 驱动层]
[driver] tokenizer-driver-rn/count-prompt-llm-input：sessionId→requestId 在途登记表
   ↓ 逐个 cancelCount(requestId)                [JS 桥，独立能力探测]
[bridge] android-native-bridge：typeof 探测 cancelCount（不并入 isNativeTokenizerAvailable）
   ↓ @ReactMethod cancelCount(requestId)         [Kotlin，fire-and-forget 无 Promise]
[kotlin] TokenizerModule：ConcurrentHashMap<requestId,Boolean> 置标记
   → executor 任务在 ①出队时 ②词表加载后 ③encode 前检查，命中抛 TokenizerCountCancelledException
   → promise.reject("TOKENIZER_COUNT_CANCELLED")  [专属 code，区别于 TOKENIZER_COUNT_FAILED]
```

回程（取消结果的 JS 收口，**最大行为契约**）：

```
[kotlin] reject(TOKENIZER_COUNT_CANCELLED)
   ↓ countPromptViaNative 识别该 code → 抛 PromptCountCancelledError（不落 catch→null！）
[driver] countSerialized 识别 CancelledError → 原样上抛（不 fallbackCount、不写 L1）
   ↓ Promise 链透传（core 无 catch 拦截，零改动）
[service] loadChatTokenLabelWithFlag / runPreciseUpgrade 识别 CancelledError
   → 与 PromptTokenResolveBailedError 同款收口：空串哨兵、无回调、无 __DEV__ warn
   → finally 正常清 inflight / 排补跑槽（复用在途轮既有生命周期，楔死风险=0）
```

依据（探索报告，cache/ 不另存则此为全文引用）：E1/E2/E3 三路 readonly 探索，关键证据见文末「关键证据」节。

### 接口契约（新增）

| 层 | 契约 | 兼容性设计 |
|---|---|---|
| Kotlin `TokenizerModule` | **新增独立方法** `@ReactMethod fun countPromptCancelable(serialized, family, vendorModelId, requestId: String, promise)`（**requestId 非空**——r2-P0 裁决：bridgeless 桥对 String 参数传 null/undefined 硬抛 `JavaTurboModule.cpp:400-404`，可空口子会让缺失轮静默降级 cl100k，已封死；「不可取消」的轮**根本不走新方法**，由 JS 侧二分口径保证）；**既有 `countPrompt` 一行不动**；新增 `@ReactMethod fun cancelCount(requestId: String)`（无 Promise，fire-and-forget）；executor 任务体 `try { … } finally { cancelState.finish(requestId) }`（标记表不泄漏）；生命周期：override `invalidate()` 清标记表（RN 0.85 bridgeless 实际触发路径 = TurboModuleManager.invalidate → NativeModule.invalidate）；`onCatalystInstanceDestroy()` 仅旧架构无害兜底、不计入收益主张；executor 不 shutdownNow——daemon 线程随进程 | **禁改既有 countPrompt 签名**（r1-P0-1 实锤）：RN 0.85 双路径（legacy `JavaMethodWrapper.kt:191-195` 与 bridgeless `JavaTurboModule.cpp:299-308`）都在调用前做严格 arity 校验，加参 = 旧 JS 调新 Kotlin、新 JS 调旧 Kotlin **双向硬抛**（不是收 null、不是探测降级）。独立新方法下四象限全兼容：旧 JS + 新 Kotlin 调旧三参 `countPrompt` 签名匹配、行为=现状；新 JS + 旧 Kotlin 探测不到新方法 → 走旧三参 = 现状（取消 no-op） |
| Kotlin 取消信号 | 检查点命中抛 `TokenizerCountCancelledException` → `promise.reject("TOKENIZER_COUNT_CANCELLED", ...)`；**TOKENIZER_COUNT_FAILED 既有语义一行不动**（真失败仍一律 reject，T-FA 契约） | JS 按 code 区分取消与失败 |
| Kotlin 计时 | `TokenizerEngine` 分段计时（vocabLoadMs / encodeMs / totalMs + chars），`Log.i("nm-tok", ...)` 单条收尾输出——**不经 RN 桥回 JS**（RULE 122：dev 下 console.log 每条 100-400ms 放大耗时；词表加载在 Kotlin 侧，JS 打点测不出分段） | release 也可观测（logcat 常开） |
| JS 桥 `android-native-bridge.ts` | `NovelMasterTokenizerNative` 加 `cancelCount(requestId: string): void`；`cancelCountAvailable()` **独立探测** `typeof nativeModule?.cancelCount === 'function'`；`isNativeTokenizerAvailable()` **不并入** cancel 探测（并入会让旧 APK 整体退 heuristic 兜底——计数精度从家族精确掉 cl100k 近似，RULE L100 的「探测覆盖每个要用的方法」按「cancel 是优化项不是可用性前提」显式豁免，spec 即豁免依据） | 逐方法访问（现状形态合规，勿改 spread） |
| RN 驱动 `count-prompt-llm-input.ts` + 桥 `android-native-bridge.ts` | **签名与数据流钉死（r3-P0-1）**：①`NativeCountRequest` 扩两个可选字段 `sessionId?: string` / `requestId?: string`（桥函数签名不变）；②requestId 由**驱动层**生成（`${sessionId}:${seq}` 模块自增）并连同 sessionId 塞进 request；③**in-flight 登记表与 `cancelSessionNativeCounts` / `PromptCountCancelledError` 全部定义于 android-native-bridge.ts**（r3-P1-1 裁决下沉——count-prompt-llm-input 无子路径可导，service/测试若从包根导入会拖整个驱动 + js-tiktoken 进模块图并炸 chat-prompt-tokens.test.ts 的 4 符号 core/provider mock；bridge 子路径轻依赖单点导入）；**表结构钉死（r4-P1）**：`Map<requestId, {sessionId}>` 主表 + 按 sessionId 的次级索引（`Map<sessionId, Set<requestId>>`）——同会话双轮并发（chip 精确轮+压缩预热轮，R6 已知形态）时两轮各自登记互不覆盖，cancelSessionNativeCounts 按 sessionId 索引全量标记、finally 按 requestId 精确注销（不会误删同会话另一轮）；登记点=桥内过桥调用前（与 requestId 同处 request 传入）；④桥内二分判据 = `countPromptCancelableAvailable() && request.sessionId != null && request.requestId != null` → 四参新方法，否则旧三参（=现状）；⑤驱动侧 `countSerialized` 增可选 sessionId 透传位、`__test__.countSerialized` 同步（T-TC8② 的测试入口）；⑥取消 catch 判定先于 `return null`；⑦sessionId 来源 = `CountPromptLlmInputParams` 新增可选字段（core 读口 `:462` 一行透传，node 驱动忽略，见 r1-P0-2 裁决）；⑧L1 命中轮不过桥无登记→取消天然 no-op | 过桥断言「sessionId 在场时走新方法四参（serialized, family, vendorModelId, requestId）且旧 `countPrompt` 不再被调；sessionId 缺失时走旧三参」经 `__test__.countSerialized` 新增 sessionId 位表达 |
| mobile service | 新导出 `cancelPreciseUpgrade(sessionId: string | null | undefined)`（**参数类型钉死**——hook 侧两调用点传入的 `slot.sessionId` 就是 `string | null`（声明于 useChatTabScope.ts:159），null/undefined 早退返回，与 `cancelPreciseUpgradeDelay`（:271-276）同款）：调 `cancelSessionNativeCounts(sessionId)`（**从 `@novel-master/tokenizer-driver-rn/android-native-bridge` 子路径导入**，r3-P1-1）；入口在 `__DEV__` 下打 `console.log('[nm-chip] cancel dispatch ' + sessionId)`（r3-P1-2：R8 送达延迟观测的第一时间戳，ReactNativeJS 可见）；`loadChatTokenLabelWithFlag` 识别 `PromptCountCancelledError`（instanceof，与 `isChipBailError` 同款）→ 空串返回、无 warn；**取消收口只加在 resolve 段 catch（chat-prompt-tokens.service.ts:208）**——build 段（:128）不涉及（取消只可能从 resolve 链抛出），`runPreciseUpgrade` 的 catch（:386）**一行不动**（异常经 :208 已收口、永不外泄，finally 唯一清理点证明链保持） | `cancelPreciseUpgradeDelay`（cr2-E-2）零改动；**不做 service 侧标记表**（r3-P2-2 删除：无清理时点的只增集合=第二泄漏源，观测由日志承担） |
| hook `useChatTabScope.ts` | 两处现有调用点旁（换 key 分支 `:283-284`、卸载 cleanup `:361`）增调 `cancelPreciseUpgrade(stale)` | — |

## 最终项目结构

```
packages/tokenizer-driver-rn/
  android/src/main/java/com/novelmaster/tokenizer/
    TokenizerModule.kt        # +countPromptCancelable(独立新方法) +cancelCount +标记表 +invalidate +取消异常 +finally finish
    TokenizerEngine.kt        # +shouldCancel 参数 +分段计时(Log.i nm-tok)
    CountCancelState.kt       # 新：Context-free 取消状态机纯对象（ConcurrentHashMap 封装），JVM 可直测
  android/src/test/java/com/novelmaster/tokenizer/
    CountCancelStateTest.kt   # 新：取消状态机 JVM 测试（不依赖资产/Context）
  src/
    android-native-bridge.ts  # +countPromptCancelable/cancelCount 类型与独立探测 +NativeCountRequest.sessionId?/requestId? +in-flight 登记表 +cancelSessionNativeCounts +PromptCountCancelledError(均定义于此) +取消 code 识别 +二分口径
    count-prompt-llm-input.ts # +requestId 生成 +countSerialized sessionId 透传位 +取消不落兜底/L1
    index.ts                  # +新符号 re-export
packages/core/src/infra/tokenizer/
  logic/count-prompt-llm-input.ts        # CountPromptLlmInputParams 增可选 sessionId?（仅此一处类型改动）
  logic/resolve-current-prompt-tokens.ts # :462 调用点一行透传 options.sessionId
apps/mobile/src/services/chat-prompt-tokens.service.ts   # +cancelPreciseUpgrade(签名见契约表,null 容忍) +resolve 段 catch 取消收口(:208)
apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts # 两处调用点旁挂取消
apps/mobile/__tests__/                                  # 3 文件新增用例 + 必补 5 键(另 2 防御性可选)
```

## 变更点清单

**Kotlin（2 文件改 + 1 新 + 1 测试新）**
1. `TokenizerModule.kt`：**新增独立方法 `countPromptCancelable`（既有 `countPrompt` 一行不动——RN 0.85 双路径 arity 硬校验，加参双向炸，见契约表）**、cancelCount、标记表委托 CountCancelState、检查点接线（出队时/词表加载后/encode 前）、reject 专属 code、任务体 `finally { finish(requestId) }` 收口（标记表不泄漏）、override `invalidate()` 清表（onCatalystInstanceDestroy 仅旧架构无害兜底，不计收益）。
2. `TokenizerEngine.kt`：`count`/`countWebFamily`/`countSpFamily` 增 `shouldCancel: () -> Boolean` 参数（缺省 `{}->false` 保持 ParityTest 复制版兼容）；分段计时打点。
3. `CountCancelState.kt`（新）：`markCancelled(id)` / `isCancelled(id)` / `finish(id)` / `clearAll()`，ConcurrentHashMap 实现，无 Android 依赖。
4. `CountCancelStateTest.kt`（新）：JVM 直测（形态照抄 TokenizerEngineTest——不依赖 Context/资产）。

**JS（5 文件改 + core 2 行触点）**
5. `android-native-bridge.ts`（**r3-P1-1 裁决：in-flight 登记表 / cancelSessionNativeCounts / PromptCountCancelledError 全部定义于此**——count-prompt-llm-input 无子路径可导，service 从包根导入会拖整个驱动+js-tiktoken 进模块图并炸 chat-prompt-tokens.test.ts 的 4 符号 core/provider mock）：`NovelMasterTokenizerNative` 增 `countPromptCancelable`/`cancelCount` 成员、`cancelCountAvailable()` 与 `countPromptCancelableAvailable()` 独立探测、`NativeCountRequest` 扩可选 `sessionId?`/`requestId?` 字段（桥函数签名不变，r3-P0-1）、**in-flight 登记表（`Map<requestId,{sessionId}>` 主表 + sessionId 次级索引，r4-P1）与 `cancelSessionNativeCounts(sessionId)`（容忍 undefined 早退）**、桥内二分口径（新方法可用且 sessionId 与 requestId 均在场 → 过桥调用前登记 + 四参新方法；否则旧三参 = 现状，r2-P0）、取消 code 识别抛 `PromptCountCancelledError`；service 与测试从本文件子路径导入。
6. `count-prompt-llm-input.ts`：requestId 生成（`${sessionId}:${seq}` 模块自增）、`countSerialized` **追加第 5 位可选参 `sessionId?: string`**（前 4 位含 chunkScope 位不变，r4-P2；`__test__.countSerialized` 同步——T-TC8② 的测试入口，传参形态 `countSerialized(family, serialized, vendorModelId, undefined, 's-1')`）、request 连同 sessionId 塞进 NativeCountRequest 传桥、`finally` 按 requestId 注销 in-flight、取消不落 fallbackCount / 不写 promptWholeCache；`index.ts` re-export 新符号。
7. core 两行触点：`logic/count-prompt-llm-input.ts`（`CountPromptLlmInputParams` 增可选 `sessionId?`）+ `logic/resolve-current-prompt-tokens.ts:462`（一行透传）；node 驱动与其余 core 零改动。
8. `chat-prompt-tokens.service.ts`：`cancelPreciseUpgrade(sessionId: string | null | undefined)` 新导出（签名见契约表；不动 cancelPreciseUpgradeDelay；`__DEV__` 下入口打 `[nm-chip] cancel dispatch` 日志，r3-P1-2）；**取消收口只加在 resolve 段 catch（:208）**（runPreciseUpgrade 的 catch :386 一行不动）；必补 5 手写 mock 键（见变更点 13）。
9. `useChatTabScope.ts`：两处调用点旁挂 `cancelPreciseUpgrade`。

**测试/mock（3 文件改 + 补键按实测）**
10. `mobile-prompt-token-counter.test.ts`：NativeModules mock 补 `countPromptCancelable`/`cancelCount` 键；断言改「sessionId 在场时过桥走新方法四参（serialized, family, vendorModelId, requestId）且旧 `countPrompt` 不再被调；sessionId 缺失时走旧三参」；T-TC1 的 reject 载荷形态 = `({code: 'TOKENIZER_COUNT_CANCELLED', message: …})`（该套件 `{...actual}` 保留真实 `countPromptViaNative`，缝是通的）。
11. `chat-prompt-tokens.test.ts`：**追加 `jest.mock('@novel-master/tokenizer-driver-rn/android-native-bridge', …)`（r1-P1-2 硬要求）**——提供同构 `PromptCountCancelledError`（做法照抄文件头 `:44-49` 的 `PromptTokenResolveBailedError` 同构类）与 `cancelSessionNativeCounts: jest.fn()` 桩；T-TC4/T-TC5 用该同构类构造取消实例（否则 mock 拦截后 instanceof 不过）；新增在途轮取消用例（与 L568 cancel 收口回归**并存且语义相反**——那条锁「已起跑后仍能升级」，新条锁「取消后不回调不楔死」）。
12. `use-chat-tab-scope-token-debounce.test.ts`：hook 层取消下发断言（L448/L468 断言旁）。
13. 手写 mock 补键**按 r3 主代理 grep 实测定稿**（r2 的「实测」结论有误，已由 findstr 逐文件复核推翻）：**必补 5 个** = `use-chat-tab-scope-batch-delete.test.ts:42` / `use-chat-tab-scope-parallel-queries.test.ts:32` / `use-chat-tab-scope-token-debounce.test.ts:53`（归变更点 12）/ `chat-tab-screen.integration.test.tsx:278` / `composer-fullscreen.test.tsx:230`——这 5 个现状持有 `cancelPreciseUpgradeDelay` 键；**判据规则（可复用）**：凡已补 `cancelPreciseUpgradeDelay` 键的套件**必补** `cancelPreciseUpgrade` 键（新旧两调用点挂在完全相同的换 key 分支与卸载 cleanup，触发条件逐条等价）。**防御性可选 2 个**：`open-file-editor-refresh.test.ts` / `use-chat-tab-scope-forget-session.test.ts`（现状无 delay 键、hook 分支不触发）。

**core 触点收敛与零改动清单**：core 仅 6a 两行；其余 core（tokenizer-driver.port / nmtp / public 导出白名单——params 加可选字段不改导出面）、tokenizer-driver-node（忽略新可选字段）、desktop、parity 金标与 TokenizerParityTest（不改计数语义）、scripts/generate-tokenizer-parity-goldens.mjs、checkWebViewAssets、apps/mobile/android/app/build.gradle、ci.yml **零改动**。

## 详细实现步骤

- Step 1 — phase-kotlin-cancel — blocking: yes — qa: auto：CountCancelState 纯状态机 + TokenizerModule 接线（**新增独立方法 countPromptCancelable，既有 countPrompt 一行不动**；cancelCount；三检查点；TOKENIZER_COUNT_CANCELLED reject；任务体 finally finish 收口；override invalidate 清表）；TOKENIZER_COUNT_FAILED 与既有计数路径行为逐字节不变。
- Step 2 — phase-kotlin-observability — blocking: no — qa: auto：TokenizerEngine 分段计时（vocabLoadMs/encodeMs/totalMs/chars 单条 `Log.i("nm-tok", ...)`），shouldCancel 参数化；探针性质、不断言不门禁。
- Step 3 — phase-kotlin-tests — blocking: yes — qa: auto：CountCancelStateTest JVM 直测（标记命中/未命中/finish 后不可再取消/并发安全形态；不依赖资产与 cwd）。
- Step 4 — phase-js-bridge — blocking: yes — qa: auto：bridge 新方法/独立探测、**in-flight 登记表 + cancelSessionNativeCounts 创建（定义于 bridge，登记点=过桥调用前）**、取消 code 识别（先于 catch→null 判定）、PromptCountCancelledError 定死 bridge；`npm run build -w @novel-master/tokenizer-driver-rn` 重建 dist（mobile jest moduleNameMapper 吃 dist，不重建即假绿）。
- Step 5 — phase-rn-driver — blocking: yes — qa: auto：core 两行触点（CountPromptLlmInputParams.sessionId? + resolve 读口 :462 透传）、驱动侧 requestId 生成 + countSerialized 第 5 位透传 + finally 按 requestId 注销路径验证、取消不落 fallbackCount / 不写 promptWholeCache；core 定向测试确认可选字段零破坏，**并加一条透传保护断言（r2-P2-4）**：`resolve-current-prompt-tokens.test.ts` 的 driver 桩捕获 `params.sessionId`（现有桩 `:413/:445` 加一行捕获即可），断言读口真把 sessionId 传下去了——没有这条，把 :462 改回不透传所有测试仍绿（取消静默失效最难查）。
- Step 6 — phase-mobile-service — blocking: yes — qa: auto：cancelPreciseUpgrade 新导出（签名见契约表，null 容忍；不动 cancelPreciseUpgradeDelay；`__DEV__` 下 `[nm-chip] cancel dispatch` 日志）；resolve 段 catch（:208）取消收口 bail 同款（空串、无 warn、finally 生命周期复用；runPreciseUpgrade catch :386 一行不动）；必补 5 手写 mock 键（变更点 13 清单）。
- Step 7 — phase-hook-wiring — blocking: yes — qa: auto：useChatTabScope 两处调用点旁挂取消。
- Step 8 — phase-verify-auto — blocking: yes — qa: auto：定向 jest（mobile-prompt-token-counter / chat-prompt-tokens / use-chat-tab-scope-token-debounce）+ **全量跑 `apps/mobile/__tests__` 下引用 `chat-prompt-tokens.service` 的 7 个 mock 宿主套件**（必补 5 + 防御 2，防清单再漂移）+ `npx tsc --noEmit -p tsconfig.build.json`（apps/mobile）+ core `npm run typecheck`（params 可选字段零破坏）+ Kotlin JVM 测试 `gradlew :novel-master_tokenizer-driver-rn:testDebugUnitTest --tests "com.novelmaster.tokenizer.*"`（**执行轮勘误：`test` 聚合任务不收 `--tests`，必须用 `testDebugUnitTest` 变体任务**；工程名先 `gradlew projects` 复核，RULE「npm scope→下划线」坑；**CI 无此门禁，本地必跑**；core 侧目录定向用 `node scripts/run-tests.mjs --dir test/infra/tokenizer`——tsx 目录直跑报 ERR_MODULE_NOT_FOUND，同为执行轮勘误）。
- Step 9 — phase-device-verify — blocking: no — qa: manual_user：重打 debug APK（**Kotlin 不走 Metro 热更，必须出包**）+ `adb install -r -d` 真机（荣耀确认门需用户在场）。**两次量化的数字对比，非主观体感（r1-P1-3）**：①基线场景（正常进入会话、不侧滑）抓 `nm-tok` 记 `vocabLoadMs / encodeMs / totalMs / chars`；②取消场景（切项目→进大会话→约 2.5s 后侧滑）核对：logcat 出现 `TOKENIZER_COUNT_CANCELLED`（检查点真命中）、侧滑返回响应间隔（cancel 日志时间戳 vs ReactNativeJS 恢复输出时间戳）、**cancel 指令送达延迟**（`cancelPreciseUpgrade` 调用时间戳 vs `nm-tok` 取消命中时间戳——R8 的观测量）、无兜底重算与 chip 跳档；encode 已在途的轮次按 R4 口径记录尾延迟实测值。
- Step 10 — phase-decision-log — blocking: no — qa: manual_user：依据 Step 9 基线量测落「分段 encode 是否做」的决策记录（含 parity/双端口径影响评估），挂回 exit-jank playbook 残留账。**判定规则（写死，防体感收案）**：若 encodeMs/totalMs > 80%（词表常驻后的稳态读数），取消收益定性为「仅省排队轮 + 冷载检查点」、不作为 14.2s 卡顿的根治手段，分段 encode 决策**必须**立项评估；≤ 80% 时取消即为有效缓解，分段决策按优先级另排。

## 测试策略

自动（jest + JVM）：见变更点 10-13 与 Step 3/8。手写 mock 纪律：新导出 `cancelPreciseUpgrade` 必须同步**必补 5 文件**（判据规则见变更点 13——凡持有 `cancelPreciseUpgradeDelay` 键的套件必补，否则「is not a function」炸 meta 链，fix-cr2 全量门 20 红的同族坑）。
真机（Step 9）：观测走 logcat（nm-tok tag + ReactNativeJS），**不**用耗时断言进单测（RULE 103：性能护栏取数量级回归线/计数式断言）。

### 测试用例

- T-TC1 — blocking: yes — bridge 层：cancel reject（code=TOKENIZER_COUNT_CANCELLED，载荷 `{code, message}` 形态）被识别为 CancelledError 上抛，**不**落 catch→null（拔牙：若不识别，驱动落兜底重算即红）。
- T-TC2 — blocking: yes — 驱动层：取消路径不调 fallbackCount、不写 promptWholeCache（L1）。
- T-TC3 — blocking: yes — 驱动层：L1 命中轮（不过桥）调用 cancelSessionNativeCounts 为 no-op（无在途记录）；params.sessionId 缺失轮同样不登记、不可取消、计数结果不变。
- T-TC4 — blocking: yes — service 层：在途轮被取消 → onPreciseUpgrade 不回调、inflight 正常清、补跑槽不楔死（与 L568「cancel 收口回归」并存：随后新一轮刷新仍可正常升级）；用例用 chat-prompt-tokens.test.ts 内同构 `PromptCountCancelledError`（r1-P1-2，照抄 :44-49 同构类做法）构造。
- T-TC5 — blocking: yes — service 层：取消走 resolve 段 catch（:208）收口（返回空串、无 `[chat] prompt token … failed` warn；`runPreciseUpgrade` catch :386 零触碰）。
- T-TC6 — blocking: yes — hook 层：切会话（换 key 分支）与卸载均下发 cancelPreciseUpgrade(stale)。
- T-TC7 — blocking: yes — Kotlin：标记命中在 encode 前短路抛取消异常；未命中照常计数（CountCancelStateTest）；finish 后同 id 不可再判定为取消（防陈旧标记误杀下一轮）。
- T-TC8 — blocking: yes — 兼容矩阵（JS 可判定面）：①缺 `countPromptCancelable`（旧 Kotlin）时过桥走旧三参 `countPrompt`、计数结果与现状一致（cancelCount 缺失时 `cancelSessionNativeCounts` no-op 不抛）；②sessionId 缺失轮**走旧三参**（二分口径）、计数不变、cancelSessionNativeCounts 对其 no-op（与 T-TC3 合并可）。**注**：桥层 arity/类型转换链在手写 NativeModules mock 下不存在，③「旧 JS 形态（三参调旧方法）在新 Kotlin 上不炸」**降级为 Step 1 的 code-review 不变量**（git diff 证明 `countPrompt` 签名与函数体逐字节未动），由 Step 9 真机覆盖，不作 blocking 测试条目（r2-P1）。
- T-TC9 — blocking: yes — 实测触发面的 5 个 mock 宿主套件（token-debounce / batch-delete / parallel-queries / chat-tab-screen.integration / composer-fullscreen——现状均持 `cancelPreciseUpgradeDelay` 键，与新调用点同触发，r3 findstr 复核）补 `cancelPreciseUpgrade` 键后全绿；open-file-editor-refresh / forget-session 两套件现状无键、分支不触发，防御性补键可选、不设 blocking 断言。
- T-TC10 — blocking: no — Kotlin 分段计时探针（ScalingProbeTest 形态：println/Log 非断言）。
- T-TC11 — blocking: no — 桥层并发形态：同会话双轮在途（chip 精确轮 + 压缩预热轮，R6 语义）→ cancelSessionNativeCounts 后**两轮 requestId 均被标记**（主表按 requestId 登记、次级索引按 sessionId 全量命中——锁 r4-P1 表结构，防实现成 Map<sessionId, requestId> 单槽漏杀前一轮）；单轮场景下 finally 按 requestId 注销不误删他轮。

## 风险与回滚方案

**执行终态注记（2026-10-03 dev-ready）**：Step 1-8 已在 worktree `D:\Dev\nm-worktree\tnc`（分支 feat/tokenizer-native-cancel，f9574534→d6cd59c17 共 5 笔）全部落地——Kotlin 4 类 18 用例 JVM 全绿（含新增 CountCancelStateTest 9 条、ParityTest 真跑真过）、`countPrompt` 与 `cancelPreciseUpgradeDelay` 双零改动由 diff 实证（116+/0- 与 254+/0-）、core tokenizer 222/222 + 白名单 21/21、mobile 三定向 68/68（T-TC1..T-TC9 全落位含拔牙/变异验证）、tsc 双侧 exit 0。**已知边界**：mock 补键 7 个中 5 个被执行验证、2 个（chat-tab-screen.integration / forget-session）为已落盘但未执行的防御性改动（两套件为 mega-CR 遗留既有红/失效：runtime mock 缺 sessionStreamUnitManager、mock 指向已删模块 session-messages-loader——归因已实证，与本迭代无关，另行挂账）；batch-delete 5 红同为 mega-CR 遗留（mock 缺 forgetSession 键致删除链路断言红）。T-TC11 双表并发用例未落位（非阻塞，双表结构由 T-TC3 接力用例的次级索引断言间接覆盖）；T-TC8① 第二条牙口有限（per-requestId try/catch 吞 TypeError，已知边界）。Step 9/10 待真机（manual_user）。

| 风险 | 缓解 |
|---|---|
| R1 取消被 `catch { return null }` 吞成兜底全量重算（取消反而更贵——先占原生队列再烧 JS 线程） | T-TC1 锁死：取消 code 判定在 catch 之前；实现评审重点核对 |
| R2 在途轮外部清理踩掉 finally → 会话楔死估算档（cr2-E-2 同族） | 取消**不干预**在途轮生命周期（仅标记+下发指令），finally 仍是唯一清理点；T-TC4 锁「取消后新一轮仍可升级」 |
| R3 新旧 JS/Kotlin 混合态（Metro 热更 JS、旧 APK 壳等） | 兼容经**独立新方法**保证（既有 countPrompt 不动、双向 arity 匹配）：新 JS+旧壳=探测不到新方法走旧三参（现状）；旧 JS+新壳=调旧方法签名匹配（现状）；cancelCount 缺失即 no-op。四象限由 T-TC8 锁死（r1 实锤：RN 0.85 双路径 arity 硬校验，加参方案双向硬抛，已废弃） |
| R4 DJL encode 单次 JNI 不可中断 | 物理上限 + **可判定口径（Step 10 规则）**：取消收益 = 跳过排队轮 + 词表加载后检查点 + 结果弃置；encode 段（139KB 探针 ≈5.8s）最坏跑完。收益是否「根治」由 Step 9 基线量测的 encodeMs/totalMs 判定（>80% 须另立分段决策），不凭体感收案 |
| R5 Kotlin 无 CI 门禁、JVM 测试本地易漏 | Step 8 显式列 gradlew 命令 + 工程名复核；release 出包兜编译正确性 |
| R6 误杀同会话压缩预热轮 | 范围外节已记录取舍（重算一次可接受）；打点含 cancel 命中频次，实测频繁再收窄 |
| R7 `release.yml` gradle cache key 不含本包 android/**/*.gradle* | 本迭代不改该包 build.gradle 即无影响；若改，顺手补 cache key（既有缺口，E3 发现） |
| R8 cancel 指令本身在 JS 线程下发（r2-P2） | hook 的换 key 分支/卸载在 JS 线程触发，若 JS 恰被同一瓶颈堵着，指令送达有延迟；Step 9 取消场景带专属观测量（`cancelPreciseUpgrade` 调用时间戳 vs `nm-tok` 命中时间戳差值）；若实测送达延迟接近计数时长本身，说明 JS 线程堵点是主要矛盾，本迭代收益重估并记入 Step 10 决策记录 |
| 回滚 | Kotlin：还原 3 个 .kt 重出包；JS：还原 5 文件重建 dist。契约上取消是纯增量（新方法/新导出/新 code），无存量行为依赖，回滚无连锁 |

## 关键证据（探索报告锚点）

- 卡顿实锤：docs/apm/memory/20261001-chat-webview-unify-spec.md（2026-10-02 侧滑卡顿轮，logcat 时间线）；exit-jank-fix-playbook.md:61（挂账原文）。
- r1-P0-1 桥 arity 证据：`node_modules/react-native/ReactAndroid/.../JavaMethodWrapper.kt:191-195`（legacy 严格校验）、`ReactCommon/.../JavaTurboModule.cpp:299-308`（bridgeless 严格校验）、`TurboModuleInteropUtils.kt:204-226`（getJsArgCount）——**加参方案的死刑依据，勿再提议**。
- r2-P0 桥 String null 证据：`JavaTurboModule.cpp:400-404`（bridgeless 对 String 参数传 null/undefined 硬抛转换异常）+ `apps/mobile/android/gradle.properties:38 newArchEnabled=true`（bridgeless 是唯一活路径）——**requestId 必须非空、缺失轮走旧三参（二分口径）的依据**；`TurboModule.h:119-135`（未知方法返回 undefined，typeof 探测在 bridgeless 有效）。
- r2 实测修正（r3 复核再修正）：手写 mock 持有 `cancelPreciseUpgradeDelay` 键的为 batch-delete:42 / parallel-queries:32 / token-debounce:53 / chat-tab-screen.integration:278 / composer-fullscreen:230（r2「后两个无键」结论有误，r3+主代理 findstr 双复核推翻）；hook 参数 `slot.sessionId` 类型 `string | null`（声明于 useChatTabScope.ts:159，赋值点 :292/:307，r4 修正锚点）。
- r3-P0-1 签名证据：`android-native-bridge.ts:6-10`（NativeCountRequest 现仅 serialized/family/vendorModelId）、`:41-43`（countPromptViaNative(request)）、`count-prompt-llm-input.ts:259-264`（countSerialized 签名无 sessionId 位）、`:286-298`（过桥分支三参调用）、`:394-397`（__test__ 仅暴露 countSerialized）——「requestId/sessionId 通路」必须在 spec 钉死签名（本表 RN 驱动行已定稿）。
- r1-P0-2 sessionId 缺位证据：`core/logic/count-prompt-llm-input.ts:22-38`（params 无 sessionId）、`resolve-current-prompt-tokens.ts:436/:462`（sessionId 在外层不进 params）、`tokenizer-driver-rn/count-prompt-llm-input.ts:345-346`（「驱动不越层」注释）。
- r1-P1-1 exports 证据：tokenizer-driver-rn `package.json` exports 仅 `./native`/`./android-native-bridge`/`./encoding`（无 count-prompt-llm-input 子路径）；`apps/mobile/jest.config.js:181-185`（bridge 子路径已有 dist 映射）。
- Kotlin 现状：TokenizerModule.kt（单方法/单线程 executor nm-tokenizer/无生命周期清理）、TokenizerEngine.kt（encode 唯一调用点 :62-65、LruCache(4)）、WebPromptConverter.kt（整串一次 encode）。
- 取消先例：LlmSseModule.kt sseAbort（:215-224 先 remove 再 cancel、标记生命周期注释 :107-118、invalidate/shutdown、debugLog FLAG_DEBUGGABLE 门控）；llm-sse 无 Kotlin 测试基建（Kotlin 取消逻辑零单测先例 → 本迭代以 CountCancelState 纯类破局）。
- JS 咽喉：android-native-bridge.ts:53 `catch { return null }`；count-prompt-llm-input.ts:286-308 过桥分支、:377 L1 写；chat-prompt-tokens.service.ts:271 cancelPreciseUpgradeDelay（cr2-E-2 硬约束注释）、:359 runPreciseUpgrade（finally 唯一清理）、:208 resolve 段 catch（取消收口落点）；useChatTabScope.ts:283-284/:361 两调用点。
- 测试面：mobile-prompt-token-counter.test.ts（NativeModules 手写 mock :9-16、三参断言 :90/:111）、chat-prompt-tokens.test.ts（L568 cancel 收口回归、同构类先例 :44-49）、use-chat-tab-scope-token-debounce.test.ts（:448/:468 hook 断言）、手写 mock 持键实测（batch-delete:42 / parallel-queries:32 / token-debounce:53 / chat-tab-screen.integration:278 / composer-fullscreen:230，open-file-editor-refresh 与 forget-session 无键）；jest.config.js:177-193 dist 映射；apps/mobile pretest 不含 tokenizer-driver-rn（dist 须手动重建）。
- 构建链：autolinking.json（sourceDir/packageImportPath）；工程名推导链（settings.gradle:5 → ReactSettingsExtension.kt:207 → ModelAutolinkingDependenciesJson.kt:16-17）确认 `:novel-master_tokenizer-driver-rn:test` 可用；ci.yml 无 Android 步骤；release.yml 只 assembleRelease；RULE L83 出包配方/L107 debug Metro 铁律/L122 打点纪律/L100 bridgeless 禁 spread。
