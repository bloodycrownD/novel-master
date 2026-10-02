---
zone: w8-kt-infra
agent: domain-scan / 原生层（Kotlin + 驱动）首审
files_scanned: 16（Kotlin 生产 6 + Kotlin 测试 3 + op-sqlite 驱动 TS 11 + 判定文件 6；实测命令若干）
---

# W8 域报告：Android 原生层（tokenizer-driver-rn Kotlin + tdbc-driver-op-sqlite）

## 区域前提修正（重要）

派单描述里写的是「packages/tdbc-driver-op-sqlite 的 **android Kotlin**（事务、BLOB 绑参、AsyncMutex/队列）」。
**实测该包下没有任何 Kotlin、没有 android 目录**：

```
> dir /s /b packages\tdbc-driver-op-sqlite\*.kt   → （空）
> dir /b packages\tdbc-driver-op-sqlite\         → dist eslint.config.mjs package.json README.md src test tsconfig.json
```

全仓 Kotlin 只有 15 个文件（`apps/mobile` 2 + `llm-sse-native` 2 + `sksp-android` 2 + `tokenizer-driver-rn` 6 生产 + 3 测试）。
op-sqlite 驱动的「原生」是 npm 包 `@op-engineering/op-sqlite`（预编译 C++/JSI，仓外），仓内只有一层 TS 适配。

因此本报告的 Kotlin 结论只覆盖 `packages/tokenizer-driver-rn/android`；事务 / BLOB 绑参 / AsyncMutex 三条线
改在 `packages/tdbc-driver-op-sqlite/src/**`（TS）上按同样口径审，证据全部带 file:line。

## 摘要

tokenizer-driver-rn 的 Kotlin 是「DJL 词表 + RN 桥」：8 个 WEB(HF json) / 5 个 SP(.model) 家族按 family 查 LruCache(4)，
冷加载时把 APK 资产拷进 cacheDir 再 newInstance，`countPrompt` 挂在模块自有的单线程 daemon executor 上
（2026-09-30 从 @ReactMethod 内联改出）。op-sqlite 侧是 core 与 SQLite 之间的 TDBC 连接：整条 `transaction()` 跑在
不可重入的 `AsyncMutex` 里、事务内语句切同步 `executeSync` 并按 16ms 时间量子让步。本轮发现 3 条 P1（连接毒化 /
死锁 / 静默新建空库），核心问题是**原生资源没有确定性的释放路径**，以及**事务边界上 BEGIN 与互斥锁的收尾不完整**。

## 职责与边界

- `packages/tokenizer-driver-rn/android`（Kotlin）：Android 原生 prompt token 计数。输入是 core
  `serializePromptLlmInput` 产出的整串，WEB 家族包成单条 system 消息再 encode。失败一律 reject，
  JS 侧 `countPromptViaNative` catch 后返回 null 走 cl100k/heuristic 兜底。
- `packages/tdbc-driver-op-sqlite/src`（TS）：TDBC 驱动的 op-sqlite 实现。协议面（`TdbcConnection`）之下是
  `AsyncMutex` 串行化 + `executeSync` 分流 + 绑参归一 + 行映射。
- 不负责：core 侧的事务调用点（已由 `raw/w3-xc-txn.md` 覆盖）、@agnai/node 侧计数口径、assets 内容正确性。

## 对外接口

Kotlin：

- `TokenizerModule : ReactContextBaseJavaModule`，`getName() = "NovelMasterTokenizer"`
  （`TokenizerModule.kt:34`），注册于 `apps/mobile/android/.../MainApplication.kt:22`。
- `@ReactMethod fun countPrompt(serialized, family, vendorModelId, promise)`
  （`TokenizerModule.kt:36-56`）—— **只此一个方法**，`vendorModelId` 标注 `@Suppress("UNUSED_PARAMETER")`（Kotlin 端真不用，
  家族由 JS 解析后传入）。JS 契约：`packages/tokenizer-driver-rn/src/android-native-bridge.ts:19-24`。
- `TokenizerEngine.resolveAssetSpecFor(family)`（companion 静态纯函数，`TokenizerEngine.kt:146`）—— 无 Android 依赖，JVM 可直测。
- `TokenizerPackage.createNativeModules`（`TokenizerPackage.kt:10-12`）。

TS 驱动：

- `OpSqliteDriver.open()`（`driver.ts:38`）、`OpSqliteConnection`（`connection.ts:19`）实现 `TdbcConnection`
  的 `execute/query/batch/transaction/close`。
- `AsyncMutex`（`mutex.ts:7`）、`normalizeOpSqliteBindings`（`bindings.ts:16`）、`rowsFromResult`（`row-mapper.ts:77`）。

## 数据访问

- **文件路径（Kotlin）**：`context.cacheDir` 下 `nm_tok_<assetPath 中 '/' 换成 '_'>`
  （`TokenizerEngine.kt:120-139`）。资产源为 APK `assets/tokenizers/**`。实测资产体积（PowerShell 实测）：
  `command-a.json 8,961,533` / `command-r.json 8,960,966` / `glm.json 8,575,761` / `nemo.json 6,262,925` /
  `llama3.json 6,082,251` / `qwen2.json 4,754,645` / `deepseek.json 4,299,302` / `gemma.model 4,241,003` /
  `claude.json 1,774,213` / `jamba.model 1,124,714` / `yi.model 1,033,105` / `llama.model 499,723` /
  `mistral.model 493,443` → 合计约 54 MB 资产，按家族懒拷进 cacheDir。
- **数据库表**：本区不直接触表。op-sqlite 侧只经 `OpenOptions` 拿连接名/目录；`driver.ts:76-80` 开库时执行
  `PRAGMA foreign_keys = ON` / `PRAGMA temp_store = MEMORY`。实际表由 core bootstrap 建，驱动不感知。
- **KKV 域**：无。

## 依赖关系

- Kotlin 依赖：`com.facebook.react:react-android`、`org.jetbrains.kotlin:kotlin-stdlib`、`ai.djl`（BOM 0.33.0，
  `ai.djl:api` + `ai.djl.huggingface:tokenizers` + `ai.djl.android:core` + `ai.djl.android:tokenizer-native` +
  `ai.djl.sentencepiece:sentencepiece`，见 `android/build.gradle:31-44`）。
- 被谁消费：`packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts:290`（native 档**仅 L1 整串缓存，不切块**）
  → core `resolve-current-prompt-tokens.ts:462` → 唯一真实消费方是压缩阈值
  `packages/core/src/domain/compaction-conditions/triggers/token-ratio.trigger.ts:58`。
- TS 驱动依赖：`@op-engineering/op-sqlite`（peer，可选）+ `@novel-master/core`；被
  `apps/mobile/src/db/connection.ts` 消费。

---

## 发现清单

### F-w8-kt-1 | P2 | `packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerEngine.kt:30-31`（淘汰点 `:76`、`:114`） | 词表 LRU 淘汰不释放原生内存，峰值内存随家族切换数抬升

```kotlin
private val webCache = LruCache<String, HuggingFaceTokenizer>(4)
private val spCache = LruCache<String, SpTokenizer>(4)
...
if (loaded != null) { webCache.put(family, loaded) }
```

`android.util.LruCache` 没有覆写 `entryRemoved`，淘汰只是丢引用。实测 DJL 0.33.0 的两个词表类都是**可关闭且持有
native 内存**的（本机 gradle 缓存里的 jar 用 javap 实测）：

- `HuggingFaceTokenizer extends NativeResource<Long>`，有 `public void close()` 与 `protected void finalize()`；
- `SpTokenizer implements Tokenizer, java.io.AutoCloseable`，有 `public void close()`。

即：Rust/SentencePiece 的词表内存只能靠 finalizer 在 GC 时才归还。资产侧注释自己写着「WEB json 解析后内存可达数十 MB/家族」
（`TokenizerEngine.kt:26-29`），而缓存族有 8+5=13 个、容量 4×2。用户跨 5 个以上家族用模型时每次淘汰都留一份未释放的原生词表，
直到 GC 挑中它——低内存机型上是 OOM 的合理触发路径，而 OOM 又会被下面的 F-5 静默吞掉。

**建议**：`LruCache` 覆写 `entryRemoved`（`evicted` 为 true 时 `value.close()`），并在模块 `invalidate()` 里 `evictAll()`
（配合 F-2）。
**置信**：confirmed（API 面由 javap 实测，代码面逐行核对）

### F-w8-kt-2 | P2 | `packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerModule.kt:30-32` | 自有 executor 无生命周期回收，与同仓先例相悖

```kotlin
private val executor = Executors.newSingleThreadExecutor { runnable ->
  Thread(runnable, "nm-tokenizer").apply { isDaemon = true }
}
```

模块没有覆写 `invalidate()` / `onCatalystInstanceDestroy()`，线程与 `engine`（含两份 LruCache 与其 native 词表）随模块实例
一起成为孤儿，直到 Catalyst 实例销毁才靠 GC 回收；dev 下每次 reload 都多留一个 `nm-tokenizer` 线程。
同仓有现成先例：`packages/llm-sse-native/android/src/main/java/com/novelmaster/llmsse/LlmSseModule.kt:233-256`
（`invalidate()` → `shutdown()` → `flushScheduler.shutdownNow()` + `executor.shutdownNow()`）。

**建议**：照 LlmSseModule 抄一份 `invalidate()` → `executor.shutdownNow()` + `engine.dispose()`（evictAll + close）。
**置信**：confirmed

### F-w8-kt-3 | P2 | `packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerModule.kt:30,43` | 单线程 + 无界队列 + 无超时，队头一次冷加载可堵死后续全部计数

`Executors.newSingleThreadExecutor()` 底层是**无界** `LinkedBlockingQueue`，且没有 `RejectedExecutionHandler`、没有排队上限、
没有单次调用超时。模块注释自己说 WEB/SP 整串计数「冷词表时可达数秒」，同仓的规模探针
（`android/src/test/java/.../TokenizerScalingProbeTest.kt:9-14`）记录真机 **139KB ≈ 5.8s**。

于是 N 个并发计数请求 = N 次排队串行执行，**最后一个的延迟是 N × 秒级**，而 JS 侧
（`count-prompt-llm-input.ts:290`）是裸 `await`，没有任何超时或取消；上游压缩阈值
（`token-ratio.trigger.ts:58`）在 agent 每步都会触发一次，无法取消已入队的任务。
L1 整串缓存（`count-prompt-llm-input.ts:357`）只能挡「内容一字未改」的重复计数，压缩隐藏消息后内容必变、必重新入队。

**建议**：换 `ThreadPoolExecutor(1, 1, 0L, MILLISECONDS, ArrayBlockingQueue(N), 拒绝时走 heuristic 兜底并 resolve)`，
把「排不上队」变成一次快速降级而不是无限期挂起；或给 `countPrompt` 加 JS 侧超时。二选一即可，别让队头无限期占位。
**置信**：confirmed（无界队列与无取消为代码事实；触发频次为 suspected）

### F-w8-kt-4 | P2 | `packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerEngine.kt:71-77` 与 `:56` | 主词表加载失败时静默退到 llama3 词表，仍按家族名报「精确值」

```kotlin
val loaded =
  tryLoadWebTokenizer(primaryPath)
    ?: spec.fallback?.let { fallback -> ... tryLoadWebTokenizer(it) }
if (loaded != null) { webCache.put(family, loaded) }
...
return CountResult(count, family, estimated = false)
```

6 个家族（qwen2/command-r/command-a/nemo/deepseek/glm）的 fallback 都是 `llama3.json`（`TokenizerAssetPaths.kt:20-25`）。
只要主资产在 APK 里缺失/解析失败（打包漏 asset、assets 改名、DJL 版本不兼容），就会**用 llama3 的词表数出来的值**，
以 `counterKind = "glm"`、`estimated = false` 回给 JS。JS 侧对这两个字段不做任何再校验
（`count-prompt-llm-input.ts:251-257` 直接透传），压缩阈值因此会把它当家族级精确读数使用——这正是该字段存在的理由
（对照 `count-prompt-llm-input.ts:299-307` 的注释：近似值必须报 heuristic 才不会跳过 0.85 安全系数）。

**建议**：命中 fallback 时把 `estimated` 置 true（可另加一个 `fallbackFrom` 字段），或直接 reject 让 JS 走
cl100k 兜底——都比「冒充精确」安全。加载成功与否应该有可观测信号（至少一次性 warn）。
**置信**：confirmed（行为链逐行可证；「是否有意」见争议节）

### F-w8-kt-5 | P2 | `packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerModule.kt:51` + `packages/tokenizer-driver-rn/src/android-native-bridge.ts:53` | 任何 Throwable（含 OOM）都被折成一次静默的精度降级

```kotlin
} catch (e: Throwable) {
  promise.reject("TOKENIZER_COUNT_FAILED", e.message ?: "原生分词计数失败", e)
}
```
```ts
} catch {
  return null;
}
```

`catch (e: Throwable)` 把 `OutOfMemoryError`（F-1 的直接后果）、`InterruptedException`、`UnsatisfiedLinkError` 一视同仁；
JS 侧空 catch 之后**不打任何日志**就返回 null，上层按「原生不可用」处理，落到
`fallbackCount`（cl100k）并报 heuristic。用户看到的是「token 数莫名变了」，日志里什么都没有——
这与 RULE「数字类结论必须可追」的取向相反，也和本仓对 `ROLLBACK 失败` 至少 `console.warn` 的做法不一致
（`packages/tdbc-driver-op-sqlite/src/connection.ts:93-98`）。

**建议**：Kotlin 侧对 `Error` 类不吞（重抛），或至少 `Log.e`；JS 侧 catch 里加一次性 warn（不要每帧刷）。
**置信**：confirmed

### F-w8-kt-6 | P3 | `packages/tokenizer-driver-rn/android/src/test/java/com/novelmaster/tokenizer/TokenizerParityTest.kt:82`、`TokenizerEngineTest.kt:28,41` | 对拍用例没带 `truncation=false`，与生产路径口径不同

```kotlin
HuggingFaceTokenizer.newInstance(Paths.get(asset.absolutePath))   // 缺 mapOf("truncation" to "false")
```

生产路径 `TokenizerEngine.kt:85-88` 显式关掉了 truncation（DJL 默认 `truncation=true` + `maxLength=512`，长文本被截断）。
测试路径没带，所以**长文本用例在测试里数的是被截断到 512 token 的值、在生产里数的是完整值**——
而本区最痛的正是长文本（139KB 会话）。`TokenizerScalingProbeTest.kt:26` 是对的，只有这两个文件漏了。
另外 `countWebNative` / `claudeFamily*` 三处建的 `HuggingFaceTokenizer` 都没 close（同文件 `:102` 的 SP 分支用了 `.use {}`，
口径自相矛盾）。
**建议**：抽一个共用的 `newWebTokenizer(path)` 给生产与测试共用；测试侧补 `.use {}`（Kotlin 的 `use` 要求 `Closeable`，
`HuggingFaceTokenizer` 不是 `Closeable` 而是 `NativeResource`，需手写 try/finally 或包一层）。
**置信**：confirmed

### F-w8-kt-7 | P3 | `packages/tokenizer-driver-rn/package.json:26-32`、`.github/workflows/android-nightly.yml:77` | 三个 Kotlin 测试文件没有任何自动化入口

`package.json` 的 scripts 只有 build/typecheck/dev/clean/lint，**没有 `test`**；CI 的 gradle 调用只有
`./gradlew assembleDebug --no-daemon`，没有 `:tokenizer-driver-rn:test`。
（DJL 的 JVM jar 自带 win/linux/osx 原生库，本机 gradle 缓存实测 `native/lib/{linux-x86_64,osx-aarch64,win-x86_64}/tokenizers.*`
都在 jar 内，所以这些用例是真能跑的——只是没人跑。）
结合 F-6/F-9：唯一能守住口径的 JVM 用例既跑不起来、又与生产路径有偏差。
**建议**：加 `scripts.test: cd android && gradlew test`（或根级 npm test 串进去），CI 加一步。
**置信**：confirmed

### F-w8-kt-8 | P3 | `packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerConstants.kt:11` | 死常量 + 已失效的溯源注释

findstr 实测：`CHARACTERS_PER_TOKEN_RATIO` 在整个 `packages/tokenizer-driver-rn`（含 android 与 src）只出现在这个文件自己的
注释与定义里，**无任何引用方**；Kotlin 侧真正的 heuristic 在 JS（`count-prompt-llm-input.ts:69`），从
`@novel-master/core/provider` 导入。注释里指的核心路径 `packages/core/src/infra/tokenizer/impl/heuristic-token-counter.ts`
也不对：现在常量在 provider 导出面上。
**建议**：删掉这个文件（或改成真正的单一常量源并加一致性测试），否则下一个人会以为改这里能改 RN 兜底口径。
**置信**：confirmed（findstr 全量实测）

### F-w8-kt-9 | P3 | `packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerAssetPaths.kt:10-28` vs `packages/core/src/infra/tokenizer/logic/tokenizer-asset-paths.ts:10-65` | 两份手维护的资产表，无交叉校验

Kotlin 侧注释自称「mirrors core `tokenizerAssetPaths`」。逐行比对当前**是一致的**（13 个家族、primary/fallback/kind 全同），
但一致性靠人维护：JS 侧 `WEB_FAMILIES`/`SP_FAMILIES`（`count-prompt-llm-input.ts:48-66`）是**第三份**同族清单，
而 Kotlin 测试只断言了 3 个家族（`TokenizerEngineTest.kt:90-102`）。任一份漏一个家族，
症状是静默走 heuristic（无日志，见 F-5）。
**建议**：加一条 JVM 用例遍历 `TokenizerAssetPaths.forFamily`，对 `assets/tokenizers/<primary>` 做存在性断言
（目录清单是静态的，断言成本为零）。
**置信**：confirmed

### F-w8-kt-10 | P3 | `packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerEngine.kt:128-133` | 资产直写最终路径，无「临时文件 + rename」

```kotlin
val assetSize = input.available().toLong()
if (dest.exists() && dest.length() == assetSize) { return dest.absolutePath }
Files.copy(input, dest.toPath(), StandardCopyOption.REPLACE_EXISTING)
```

进程在 copy 中途被杀会留下截断文件。所幸长度校验能自愈（下次长度不等 → 重拷），所以只是「同一次运行内可能读到
半截文件」——但本类全部由单线程 executor 串行（`TokenizerModule.kt:43`），运行内不会并发读写同一 `dest`，实际风险很低。
`available()` 作长度来源对 `AssetManager` 流是可用的（返回解压后剩余字节，与 copy 写出的字节同口径）。
**建议**：保持现状亦可；若要收紧，写 `<dest>.tmp` 再 `Files.move(ATOMIC_MOVE)`。
**置信**：suspected（风险窗口极窄）

### F-w8-kt-11 | P3 | `packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/WebPromptConverter.kt:23` | 「Assistant:」子串判定是共享病灶（Kotlin 与 core 同款）

```kotlin
if (parts.none { it.contains("Assistant:") }) { parts.add("\n\nAssistant:") }
```

core 侧 `count-openai-style-message.ts:94` 是**逐字相同的实现**（`!parts.some((p) => p.includes("Assistant:"))`），
所以 Kotlin 这边**没有 parity 漂移**，但两边共享同一个缺陷：system 消息正文里只要出现字面量 `Assistant:`
（few-shot 示例、用户让模型模仿某种格式的提示词——本项目用户自己写角色卡/提示词，概率不低），
尾部的 `\n\nAssistant:` 就会被漏加，两端 token 数一起偏。
**建议**：改判「本次循环是否真的走过 `role == "assistant"` 分支」而非子串包含。**改动必须 Kotlin + TS 同步**，否则才制造漂移。
**置信**：confirmed（两处同款；是否有意见争议节）

---

### F-w8-kt-12 | P1 | `packages/tdbc-driver-op-sqlite/src/connection.ts:81` 与 `:104-106` | BEGIN 在 try 之外，失败则 `inTransaction` 永不复位，连接永久中毒

```ts
this.inTransaction = true;              // :69
this.lastYieldAt = Date.now();
const txConn = new TransactionalConnection(this);
await this.runAdapter("BEGIN", undefined);   // :81  ← 在 try 之外
try {
  const value = await fn(txConn);
  await this.runAdapter("COMMIT", undefined);
  return value;
} catch (cause) { ...ROLLBACK... } finally {
  this.inTransaction = false;           // :104-106
}
```

`finally` 挂在 `try` 上，**覆盖不到 BEGIN**。BEGIN 抛错（SQLITE_BUSY、库被另一进程锁、
或——正是本文件自己容忍的那种「事务已被自动中断」导致 `cannot start a transaction within a transaction`：
`:88-99` 的注释明说 ROLLBACK 失败会被吞掉）时，`inTransaction` 停在 `true` 且没人发过 ROLLBACK。后果是三重的：

1. 此后所有 `transaction()` 直接 `NESTED_TRANSACTION`（`:61-67`），整个连接永久不可写事务；
2. 所有 `batch()` 误判自己在事务内，走 SAVEPOINT 分支（`:178`）发 `SAVEPOINT tdbc_sp_1`，
   而外层根本没有事务 → SQLite 报 `cannot SAVEPOINT` → 一律折成 `BATCH_FAILED`（`:202`）；
3. 所有语句改走 `executeSync` 分流（`:257`），事务外也同步阻塞 JS 线程。

同一个连接不会自愈（`close()` 后重开才会）。
**建议**：把 `await this.runAdapter("BEGIN", ...)` 挪进 `try`，catch 里按「BEGIN 未成功」跳过 ROLLBACK；或在 BEGIN 外包一层
`try { BEGIN } catch { this.inTransaction = false; throw }`。
**置信**：confirmed（控制流逐行可证；BEGIN 失败的具体触发条件为 suspected）

### F-w8-kt-13 | P1 | `packages/tdbc-driver-op-sqlite/src/connection.ts:326-328` | `TransactionalConnection.close()` 重入父互斥锁 → 死锁

```ts
// :58-59  整条事务跑在 mutex 内
transaction<T>(fn) { return this.mutex.run(async () => { ... await fn(txConn) ... }); }
// :111    close() 也跑在 mutex 内
close() { return this.mutex.run(async () => { ... }); }
// :326-328  tx.close() 转发给 parent.close()
close(): Promise<void> { return this.parent.close(); }
```

`AsyncMutex` 是单链 FIFO、不可重入（`mutex.ts:11-16`）。事务回调里若经 `tx` 调到 `close()`，它排到**自己后面**，
而前面的 promise 要等它完成 → 循环等待 → 永久挂起，且这把锁从此对整条连接永久失效。
注意 `TransactionalConnection` 的其它三个方法都正确地走了 `*Direct` 旁路（`:295-314`，不进锁），
**只有 `close()` 漏了**——是这个类里唯一的不一致点。
RULE L72 已经拍板「事务回调里误用外层 conn 会撞 AsyncMutex 不可重入（死锁而非报错）」，
但那说的是**误用外层 conn**；这里是**合法的 tx 句柄自身**就不安全，属于新问题。
**建议**：`TransactionalConnection.close()` 改为直接调 `this.parent.assertOpenAndCloseNow()`（不进锁的内部方法），
或在持有锁时置一个 `lockedDepth`，检测到重入就抛 `TdbcError` 而不是静默死锁。
**置信**：confirmed（机制）；触发面 suspected —— 我没有在 core 侧找到事务回调内调 `tx.close()` 的现成调用点，
需要 W6 验证代理确认是否有 service 持有 tx 后把连接对象透传给会关连接的清理逻辑。

### F-w8-kt-14 | P1 | `packages/tdbc-driver-op-sqlite/src/driver.ts:50-58` | 存量库探测失败（任意原因）后 fallback 不带 `failOnCreate`，静默新建空库

```ts
try {
  await adapter.open({ name, location: legacyDir, failOnCreate: true });
  return await this.finishOpen(adapter);
} catch {
  // 旧文件不存在（新装用户）或绝对路径打开失败：落回默认布局。
}
await adapter.open({ name, location: options.location });   // ← 无 failOnCreate
```

注释把「新建空库会掩盖旧数据」列为**要防的事**，却只在第一次尝试上防了。第二次 `open` 没带
`failOnCreate: true`，于是只要旧库文件**存在但打不开**（库头损坏 / 权限 / 被另一进程独占 /
上次异常退出留下 WAL 不一致），就会在默认布局新建一个空库，bootstrap 再把全套表建出来——
用户侧表现是「升级后聊天记录全没了」，且没有任何告警。空 `catch {}` 还会把真实病因（损坏 vs 不存在）完全抹平。
**建议**：第二次 open 也带 `failOnCreate`（并在 legacy 目录与默认目录解析为同一路径时更严格）；
catch 里区分「文件不存在」与「打开失败」，后者必须原样抛出。
**置信**：suspected（代码路径确定；op-sqlite 对损坏库的确切行为未实测）

### F-w8-kt-15 | P2 | `packages/tdbc-driver-op-sqlite/src/bindings.ts:26-31` | 每个 BLOB 绑参都无条件整份拷贝，紧凑视图也拷

```ts
if (value instanceof Uint8Array) {
  return new Uint8Array(value).buffer;   // 恒拷贝
}
```

`new Uint8Array(u8)` 按元素重建一个紧凑数组——这正是修复「源视图带 byteOffset 会越界」的正确做法，
但它对**已经紧凑**的视图（`byteOffset === 0 && byteLength === buffer.byteLength`，VFS blob 写入路径的常态）
也照样整份拷一份。RULE 记载 `vfs_content_blob` / `chat_message.content_blob` 都是二进制大列，
一个 4 MB blob 的写入会瞬时多占 4 MB，`batch` 逐条绑参时峰值再叠。
注释自认这是保守口径（「保留拷贝也维持 quick-sqlite 时代的堆安全口径」）——是有意保留的，见争议节。
**建议**：加 `if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) return value.buffer;`
的前置快路径，其余情况仍拷贝。若采纳需配一条 subarray 用例（现有 `test/bindings.test.ts` 应已覆盖 offset 路径，补 tight 路径即可）。
**置信**：confirmed

### F-w8-kt-16 | P3 | `packages/tdbc-driver-op-sqlite/src/row-mapper.ts:30` | 未知类型静默 `String(value)` → `"[object Object]"`

```ts
return String(value);
```
任何非 null/number/string/bigint/Uint8Array/ArrayBuffer/Buffer 的值都被字符串化。op-sqlite 的标量域内不会命中，
但 JSI 侧若返回了 Date/对象/布尔扩展，值会被静默写成 `"[object Object]"` 或 `"true"` 而不报错——
与 F-5 是同一类「静默降级」。**建议**：至少对 `typeof value === "object"` 的非已知类型抛错。
**置信**：suspected（触发面依赖 op-sqlite 返回形态，仓内不可测）

### F-w8-kt-17 | intentional | `packages/tdbc-driver-op-sqlite/src/connection.ts:267-277` | 后台跳过让步时不更新 `lastYieldAt`

代码与注释一致（「跳过时不更新 lastYieldAt——回前台后下一条过窗语句立即恢复让步节奏」），
且 RULE L26 记着「事务内语句一律同步执行 + 16ms 时间量子让步」这条 quick-sqlite 时代实测结论，
属**有意设计**，不作为问题。同理 `AsyncMutex` 不可重入导致的「误用外层 conn 死锁」也是 RULE L72 明确拍板接受的盲区。
**置信**：intentional

---

## 争议与存疑

1. **F-w8-kt-4（fallback 词表冒充精确值）是不是有意的？** `AssetPathSpec.fallback` 是显式建模的字段、core 侧同款，
   所以「加载失败退到 llama3」大概率是有意的韧性设计。争的是**失败后仍然报 `estimated=false`**——
   这一点两边注释都没提，我倾向于是漏了（JS 侧对 heuristic 标记的用法在 `count-prompt-llm-input.ts:299-307` 有明确论述，
   说明作者知道这个字段的分量）。请裁决：改字段语义，还是接受现状并在文档里写明。
2. **F-w8-kt-15 的 BLOB 拷贝**：注释明说「维持 quick-sqlite 时代的堆安全口径，不因 op-sqlite 验证通过而放松」，
   也就是**有意保留**。我仍提为 P2，因为 2026-09-28 的 6 项真机探针已经证明直接绑 BLOB 无失真，
   而拷贝的收益只对 subarray 场景成立——但若裁决为「刻意保守」，请标 intentional 并说明保留理由。
3. **F-w8-kt-13 的触发面**：机制是确定的，但我没有穷举 core 侧事务回调里的所有服务调用（`raw/w3-xc-txn.md`
   列了 21 个调用点，我按抽样判断没有 tx.close，但不敢断言没有）。建议 W6 指派一个验证代理，
   用 `findstr /s "close()" packages\core\src` 逐个核对是否落在事务回调内。
4. **F-w8-kt-14 的严重性取决于 op-sqlite 对损坏库的行为**，我在无设备环境下无法实测。若「打不开」时 op-sqlite
   自身就抛且不带副作用，那影响面会小很多；但代码侧的防御缺口（第二次 open 不带 failOnCreate）仍然成立。
5. **区域前提**：派单要求的「op-sqlite 的 android Kotlin」在本仓不存在（见开头）。若上游台账里把这条记成了
   「Kotlin 事务层已审」，需要更正为「op-sqlite 原生在仓外（npm 预编译），仓内只有 TS 适配层」，
   以免覆盖矩阵出现假绿。