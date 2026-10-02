# CR 报告 · cr1-kotlin（scope 模式 · 只读评审）

## ① 元信息

| 项 | 值 |
|---|---|
| 节点 | `cr-kotlin`（code-review-loop · scope 模式 · review_round 1 / dag_version 1） |
| 仓库 | `D:\Dev\nm-worktree\mcr`（分支 feat/repo-mega-cr） |
| base_sha / head_sha | `fe79b781` / `046f4d9c` |
| 被审 commit | `d68a848b`（Wave C Kotlin）。`c667be0f` 的 45 个改动文件**零 `.kt`**，Kotlin 侧配套改动为 0（已用 `git show c667be0f --stat` 逐条筛过） |
| 业务 spec | `docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-c1.md` 的 **C1-11**（§6 #11 callTimeout 静默吞掉）与 **C1-12**（§6 #12 SkspModule 无 Executor）；证据源 `raw/w8-kt-sse.md`、`raw/w10-kt-sksp.md` |
| 本 scope 域 | `packages/llm-sse-native/android/.../LlmSseModule.kt`、`packages/sksp-android/android/.../SkspModule.kt`；与 JS 侧的桥接契约（`packages/llm-sse-native/src/{types,transport}.ts`、`packages/sksp-android/src/{native,android-secret-store}.ts`、`packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts`）；线程模型；异常与资源释放路径 |
| 域外（不判） | JS/TS 侧实现本身（归 cr-c1/cr-c2/cr-tests） |
| 检查维度 | A（一致性：JS 桥接契约 ↔ Kotlin 方法签名/事件名/payload）+ B（正确性/边界：userAborted 时序、callTimeout 后 settle 恰一次、单线程 executor 排队/饥饿/重入、线程 confinement、catch 范围、close/cancel）+ C（回归：旧调用方兼容）+ G（守卫：nm-sksp 是否真照 TokenizerModule 范式、有无漏掉其防御） |
| 重点核对 | ① callTimeout「消 Promise 悬死」是否真的存在 settle 路径；② userAborted 与其它 abort 源并发的竞态与**残留**；③ 单线程 executor 是否可能死锁/饥饿 |
| 写入 | 禁改代码 / 禁改 spec / 禁 git 写。本报告为唯一落盘物（未产生临时探针脚本） |

**改动面**：`LlmSseModule.kt`（+160/-…）、`SkspModule.kt`（+123/-…），共 2 文件。

---

## ② Must-fix

### P1-1 ★top：`SkspModule` 的线程名日志打在 `executor.execute` **之前** ⇒ logcat 永远拿不到 `nm-sksp`，C1-12 的验收牙齿反向失效

**位置**：`packages/sksp-android/android/src/main/java/com/novelmaster/sksp/SkspModule.kt:105`、`:126`

```kotlin
103  @ReactMethod
104  fun encrypt(ref: String, plain: String, promise: Promise) {
105    debugLog("thread=${Thread.currentThread().name} op=encrypt")   // ← 在 RN 队列线程上求值
106    executor.execute {                                                // ← 工作这才被派发出去
107      try {
...
126    debugLog("thread=${Thread.currentThread().name} op=decrypt")    // ← 同一处问题
127    executor.execute {
```

**机理**：`@ReactMethod` 的方法体在 RN 的 NativeModules 队列线程上**同步执行**，`executor.execute { … }` 只是把工作**提交**出去、立刻返回。字符串插值 `${Thread.currentThread().name}` 在第 105 行就地求值，此刻还在 RN 队列线程上 ⇒ 打出来的**永远是 RN 队列线程名**（`mqt_native_modules` / `mqt_js` 之类），**永远不可能是 `nm-sksp`**。`decrypt` 同理。

**与 spec 的冲突点**（两处，都被打穿）：

- `wave-c1.md:1662`（C1-12 验收 I4）：「① `nm-sksp` 线程名在位；② **RN NativeModules 队列线程上看不到 sksp 的栈帧**（后者才是「不再内联」的牙齿，①单独看只是「起了个线程」）」。
- `wave-c1.md:1676-1679`（测试策略）：「在 `encrypt` / `decrypt` 两个入口各加一行 `BuildConfig.DEBUG` 门控的线程名日志（**形如 `[nm-sksp] thread=<name> op=encrypt|decrypt`**），供本条 I4 与 C1-11 的 I4 **共用同一次 logcat 核对**」。

⇒ I4 ① **必然判红**（`nm-sksp` 永远不出现）；更糟的是它会给出一个**反向假信号**：验证人按 logcat 看到 `thread=mqt_native_modules`，合理推断「sksp 还在内联 ⇒ 修复没生效」，而实际上工作**早已**在 `nm-sksp` 上跑。本仓最近刚在 `wave-e` 修过「零收集守卫同款假绿」（见 `3b4c8d9e` 提交说明），这类「假信号」正是 RULE 反复强调要治的对象；而 I4 ② 才是真正的牙齿，现在也没法用这行日志做交叉印证。

**修法**（一行挪动，两处）：

```kotlin
  @ReactMethod
  fun encrypt(ref: String, plain: String, promise: Promise) {
    executor.execute {
      debugLog("thread=${Thread.currentThread().name} op=encrypt")  // ← 挪进 executor 块首行
      try {
      …
```

入口那一行若想保留作对照（同时打 `callerThread=` 与 `workThread=`）也可以，但**必须**有一行落在 `executor.execute { … }` 块内。

**建议的真机验证步骤**（AGENTS.md 硬规则：Metro 走真实路径、`adb install -r -d`、**永不卸载**）：

1. `cd apps/mobile && npx react-native start`（**真实路径**，禁从 subst 盘起）。
2. `adb -s <serial> reverse tcp:8081 tcp:8081`；gradle 出 debug APK；`adb install -r -d <apk>`。
3. 打开 app → 设置页新增服务商 → 保存 API Key（触发 `encrypt`），随后重新进入设置页（触发 `decrypt`）。
4. `adb logcat -c && adb logcat -s nm-sksp:D`。
5. 判据：日志出现 `thread=nm-sksp op=encrypt|decrypt` ⇒ 修复后成立；**当前实现必现** `thread=mqt_native_modules …` ⇒ 复现本条。
6. 补 I4 ② 的牙齿：`adb shell kill -3 <pid>` 抓 ANR 线程栈，确认 `com.novelmaster.sksp.SkspModule` 的栈帧**不在** RN NativeModules 队列线程上，只在 `nm-sksp` 上。
7. 收尾：`adb install -r -d` 覆盖回正常包，全程禁止 `adb uninstall` / `pm clear`。

---

### P1-2：`finishStream` 的标记消费点被闸门早退挡住 ⇒ 注释声称覆盖的「abort 与正常收尾竞态」实际没覆盖，`userAborted` 永久残留

**位置**：`packages/llm-sse-native/android/src/main/java/com/novelmaster/llmsse/LlmSseModule.kt:465-478`（消费点在 `:475`，早退在 `:467-469`）

```kotlin
465  private fun finishStream(requestId: String, state: StreamState) {
466    synchronized(state) {
467      if (!streams.containsKey(requestId)) {
468        return                                   // ← 闸门已关 ⇒ 直接返回
469      }
470      // 读循环收尾已显式 flush 过一次；这里再兜一层（幂等），…
472      flushPending(state)
473      streams.remove(requestId)
474      // 正常收尾路径也要消费标记（abort 与正常收尾可能竞态同 requestId）。
475      userAborted.remove(requestId)             // ← 到达这里时，标记必已不存在
476      emitDone(requestId)
477    }
478  }
```

对读端 `sseAbort`（`:215-227`）：

```kotlin
218    userAborted[requestId] = true   // 先写标记
219    streams.remove(requestId)       // 再关闸
220    val call = calls.remove(requestId)
222    call?.cancel()
```

**机理（可达，非理论）**：流已把 body 读完（`pumpStream` 正常返回、`call.execute().use` 尚未退出），用户此刻点「停止」→ `sseAbort` 写入标记并 `streams.remove`。此后：

1. `call?.cancel()` 对一个**已经 execute 完成**的 `RealCall` 是 **no-op**，读循环**不会**抛异常；
2. 读循环继续走到 `finishStream`，命中 `:467` 的 `!streams.containsKey` → **`:468 return`** ⇒ `:475` 的消费**永远执行不到**；
3. 没有异常 ⇒ `handleStreamFailure`（唯一的另一处消费点）也不会被调用。

⇒ 标记**无人消费、永久留在 `ConcurrentHashMap` 里**。第 474 行那句注释（「abort 与正常收尾可能竞态同 requestId」）描述的正是这个窗口，而代码位置恰好把它挡在了外面。

**与 spec 的冲突点**：

- `wave-c1.md:1451-1453`：「⚠ **标记必须清理**：`handleStreamFailure` 开头的 `userAborted.remove` 是一次性消费；**正常收尾路径（`finishStream`）也要 `userAborted.remove(requestId)`**」。
- `wave-c1.md:1507`（验收 I4）：「连续 ①正常收尾 ②用户 abort ③callTimeout 三种各一次 → 三次之后 `userAborted` 为空（**用一条 debug 计数日志**核对）」。

⇒ 本条正是 spec 点名要防的那一类残留，且它让 I4 的断言变成**概率性红**（取决于是否卡在收尾窗口）。

**影响评估（不夸大）**：功能上**不致错**——`transport.ts:149` 的 requestId 是 `llm-sse-<6位实例前缀>-<单调计数器>`，`transport.ts:69-72` 的实例前缀每个 JS 模块实例随机 ⇒ requestId 永不复用 ⇒ 残留标记不会误吞后续流的错误。代价是：(a) map 无界增长（每次命中一条 `String→Boolean`，量级很小）；(b) I4 偶发红；(c) 注释与实现不符，会误导后来者以为已闭合。

**同族第二入口（顺带登记）**：`sseAbort` **无条件**写标记。当 abort 打在**已经终结**（正常收尾或已失败）的流上时，`calls.remove` 返回 `null`、`streams.remove` 空操作，而 `finishStream` / `handleStreamFailure` 都已跑完 ⇒ 同样残留。spec `wave-c1.md:1541-1551`（风险 R2）只登记了「消费 vs 写入」错位导致**多发一条 Error** 的那一半，**没有**登记「两端都已跑完 ⇒ 纯泄漏」这一类。

**修法**（对称化消费侧，与 `handleStreamFailure` 的「先消费、后判闸」口径对齐）：

```kotlin
  private fun finishStream(requestId: String, state: StreamState) {
    synchronized(state) {
      // 一次性消费必须早于闸门：abort 已先 streams.remove 时，
      // 若把 remove 放在 containsKey 的 return 之后，标记永远无人回收。
      userAborted.remove(requestId)
      if (!streams.containsKey(requestId)) {
        return
      }
      …
```

（`:474-475` 原地那两行随之删掉，避免同一 key 被消费两次的误导。）

`LlmSseModule.kt:307` 的 `shutdown()` 里已有 `userAborted.clear()`，覆盖「模块整体销毁」；本条补的是**单请求粒度**的兜底。

**建议的真机验证步骤**：

1. 同 P1-1 的装包流程（Metro 真实路径 + `adb install -r -d`，**禁止卸载**）。
2. 发一条消息，等到首字出现后**立刻**点「停止」，重复 **20 次**（尽量卡在流末尾；也可把模型换成短回复，让收尾窗口占比更高）。
3. `adb logcat -c && adb logcat -s nm-llm-sse:D`。
4. 判据：每条 `sse_abort requestId=… userAbortedPending=N` 之后，**下一条** `nm-llm-sse` 日志里的 `userAbortedPending` 应归 **0**；当前实现下命中竞态时会稳定 > 0 且永不回落 ⇒ 复现。
5. 附带核对 C1-11 的 I3：命中竞态的那几次**不应**产生 `LlmSseError`（用户 abort 必须仍静默）——这是 R2 已知残余窗口，抽 10 次以上观察。
6. 追加 I4 的完整三连：① 正常收尾 ② 用户 abort ③ callTimeout 各一次后，`userAbortedPending` 归 0（callTimeout 那次可临时把 `SSE_WHOLE_CALL_TIMEOUT_MS` 改小并对「本地 accept 后不 write 的 TCP 监听端口」发请求，**验收完立即 revert**）。

---

### P2-1：`SkspModule` 用 `catch (e: Exception)`，漏掉 `TokenizerModule` 的 `catch (e: Throwable)` 防御 ⇒ 改成后台线程后，`Error` 逃逸会让 Promise **静默**悬死

**位置**：`packages/sksp-android/…/SkspModule.kt:118-120`、`:138-140`（对照 `packages/tokenizer-driver-rn/…/TokenizerModule.kt:51`）

```kotlin
// SkspModule.kt（现状）
118      } catch (e: Exception) {
119        promise.reject("ENCRYPT_FAILED", e.message, e)
120      }

// TokenizerModule.kt:51（范式）
 51      } catch (e: Throwable) {
 52        // 失败一律 reject：不再折算 heuristic 值，由 JS 桥的 catch→null 分支走兜底路径。
 53        promise.reject("TOKENIZER_COUNT_FAILED", e.message ?: "原生分词计数失败", e)
 54      }
```

**机理（维度 G 的正面回答：范式照抄了，但抄漏了一处防御）**：`executor` 是 `ThreadPoolExecutor`，`runWorker` 会 `catch (Throwable)` 并把它交给默认 `UncaughtExceptionHandler`，然后**换一条 worker 线程继续跑**。⇒ 若任务体抛出的是 `Error`（或任何非 `Exception` 的 `Throwable`）：

- `promise.reject` 不会被调用 ⇒ **`post()` 永不 settle**；
- 异常发生在自建的 `nm-sksp` 线程上 ⇒ **绕过 RN 的 `NativeModuleCallExceptionHandler`** ⇒ 没有 redbox、没有 JS 侧可见信号；
- JS 侧 `android-secret-store.ts:51` / `:69` 的 `await native.encrypt/decrypt(...)` 永久挂起 ⇒ 上层 `resolveProviderApiKey` 一起挂 ⇒ 「发消息」按钮无反应且**无任何报错**。

**与旧行为对比（说明这是本 commit 引入的可见性回归）**：改前同样的 `Error` 是在 **RN NativeModules 队列线程**上冒泡的，RN 会把它交给 `NativeModuleCallExceptionHandler` ⇒ 至少弹一个 redbox。Promise 同样不 settle，但**故障可见**。改成后台线程后，**从「可见红屏」变成「静默挂起」**——而本 commit 的主题恰恰是「消 Promise 悬死」，这条在同一批改动里反向造出了一个新的悬死面。

现实概率不高（`KeyStore` / `Cipher` / `KeyGenerator` 的常规失败都是 `KeyStoreException` / `GeneralSecurityException`，都是 `Exception`；`Error` 更可能来自极端环境，如 `UnsatisfiedLinkError` / `NoClassDefFoundError` / `OutOfMemoryError`），但代价与修法都不成比例。

**与 spec 的关系**：`wave-c1.md:1628-1630`（修法 2）只要求「reject 的 code 与 message 一字不改」，没提 catch 范围——所以严格说**不算违反明文条目**；但 C1-12 的总纲是 `:1613`「**逐字照 `TokenizerModule.kt:30-32` 的形状**」+ `:1596-1606` 把范式的**防御部分**也一并列了出来（`:1651` 特别点名了 reject 的 code/message）。维度 G 问的正是「有没有漏掉 TokenizerModule 里存在的防御」——答案是：**有，就这一处**。

**修法**（两处各一个词，与范式对齐）：

```kotlin
      } catch (e: Throwable) {
        promise.reject("ENCRYPT_FAILED", e.message, e)
      }
```

（`TokenizerModule` 另有 `e.message ?:` 兜底；`SkspModule` 的 `e.message` 可为 null 属 raw `w10-kt-sksp` 已登记的 P3，**不在本条范围**，别顺手改。）

**验证说明**：该路径在真机上难以稳定构造（需要刻意制造 `Error`）。建议按**代码对照**验收（`grep -n "catch" SkspModule.kt` 两处均为 `Throwable`），并把「Kotlin 侧无 JVM 测试基建」这一既有限制（spec `:1521-1526` 已登记）写进验收记录，不假装有 e2e 牙齿。

---

### P2-2：`classifyError` 的两个新参数在两个调用点都是**死参数**，且注释暗示了一个并不存在的「锁内二次读标志」

**位置**：`LlmSseModule.kt:508-517`（注释）、`:544-551`（签名）、`:269-276`（非流式调用点）

```kotlin
508      // 分类与发事件同在 state 锁内：classifyError 要读的 userAborted 判定与
509      // 修法 1 那次消费是同一个标志，两处都不在锁内会留下额外窗口。
510      val (kind, message) = classifyError(
511        t, effectiveReadTimeoutMs, call, userAbortedHit,
514        state.startedAtNanos, state.effectiveCallTimeoutMs,
516      )
```

**机理**：

1. 流式调用点传的 `userAbortedHit` **可证恒为 `false`**——`handleStreamFailure:496` 的 `if (state == null || userAbortedHit) return` 已经把 `true` 的情形全部早退掉了，`:510` 只在 `false` 时可达。⇒ `classifyError:552` 的 `&& !userAbortedHit` 是恒真的死条件。
2. 非流式调用点 `:272-273` 直接传 `call = null`、字面量 `userAbortedHit = false`，`startedAtNanos = 0L`、`effectiveCallTimeoutMs = DEFAULT_CALL_TIMEOUT_MS` **全部未被使用**——`call == null` 使 `:552` 的短路条件永不成立。

⇒ **注释 508-509 描述的「`classifyError` 在锁内读一次 userAborted 标志」这件事在代码里并不存在**（它收到的是 `:494` 早已取出的局部布尔值，不再读 map）。这不是 bug，但它是一句**事实错误的安全论证**：后来者按它推理「标志的读写已同锁闭合」，而实际上 spec `wave-c1.md:1480-1484` 与风险 R2（`:1541-1551`）明确说**残余窗口未消除**、不得宣称闭合。注释口径比 spec 更乐观，是个复发风险。

**修法（二选一，都很轻）**：

- **订正注释**（推荐，保留签名以便将来非流式路径复用）：把 508-509 改成「`classifyError` 与发事件同在 state 锁内；注意 `userAbortedHit` 是 `:494` 在锁外取出的一次性消费结果，**锁内不再读 map** ⇒ R2 的错位窗口未被本锁消除」。
- 或**简化签名**：删掉 `userAbortedHit` 与 `startedAtNanos`/`effectiveCallTimeoutMs` 中的死项，把 callTimeout 判定整体挪到 `handleStreamFailure` 里做，`classifyError` 回到纯异常类型分类。

---

### P2-3：导入顺序被打乱 + `SkspModule.kt` 的**末尾换行被本 commit 删掉**

**位置**：`LlmSseModule.kt:20-21`；`SkspModule.kt` 文件末尾（`\ No newline at end of file`）

```kotlin
// LlmSseModule.kt:17-21 —— 新增的 android.* 插在 okio.* 之后
17  import okio.BufferedSource
20  import android.content.pm.ApplicationInfo
21  import android.util.Log
```

字节级实测（本轮用 PowerShell 直读）：

| 文件 | BOM | CRLF | 裸 LF | U+FFFD | 末字节 |
|---|---|---|---|---|---|
| `LlmSseModule.kt` | false | 637 | 0 | 0 | `0x0A`（有末尾换行） |
| `SkspModule.kt` | false | 147 | 0 | 0 | `0x7D` = `}`（**无末尾换行**） |

⇒ 两个文件的编码本身干净（无 BOM、无 U+FFFD、合法 UTF-8，CRLF 与 `LlmSseModule.kt` 改动前一致，diff 未整文件重写）；问题只有两点：① `SkspModule.kt` 的末尾换行是**本 commit 删掉的**（diff 尾部 `\ No newline at end of file`）；② `LlmSseModule.kt` 的 `android.*` 导入没按字典序插在 `com.facebook.*` 之前。

⚠ 门禁现状：`scripts/check-encoding.mjs:42` 的 `SKIP_DIRECTORIES` 含 `"android"`，而这两个文件的路径里都有 `android` 这一段 ⇒ **它们其实不在编码门禁的扫描面内**（`:8-12` 的注释解释了原因：`apps/mobile/android/app/build.gradle` 有 20 处 U+FFFD）。所以这条不会被 pre-commit 拦下，得手工修。

**修法**：① `SkspModule.kt` 末尾补一个换行；② 把 `LlmSseModule.kt:20-21` 两行上移到 `:1-10` 区间（`android.*` 排在 `com.facebook.*` 之前）。

---

## ③ Should-fix 与观察项

### Should-fix

1. **`sseConnect` 的 duplicate-requestId 分支丢了一个未取消的 `Call`**（`:178-182`）：
   ```kotlin
   val call = client.newCall(request)
   if (calls.putIfAbsent(requestId, call) != null) {
     emitError(requestId, "network", "duplicate requestId: $requestId")
     return          // ← 这个 call 既没被 cancel，也没进任何 map
   }
   ```
   `newCall` 只是构造对象、未 execute，所以**不会**占 socket，实际泄漏极小；但按 spec C1-12 的口径（「同款事故修法」「受害面写窄」），留一个永不 cancel 的 `Call` 在这种以「谁取消的」为核心不变量的模块里，是个容易误导后来者的小刺。建议补 `call.cancel()`（一行）。**属既有代码，非本 commit 引入**，故列 Should-fix 而非 Must-fix。
2. **非流式 `request()` 的 `emitError`/`classifyError` 注释提到「messageDone 路径可达」**（`:266-268`）——表述可以，但与 C1-11 类文档注释（`:527-543`）里「`timeoutExit()` 只在 `messageDone` 路径可达」的旧论断存在措辞张力。建议统一成「非流式 `execute()` 整体在超时窗内 ⇒ 到点时 OkHttp 抛 `InterruptedIOException("timeout")`，由 `:561-566` 分支归 timeout」。纯文档级。
3. **`SkspModule` 的 `companion object { const val TAG }` 放在文件末尾**（`:144-147`），而 `LlmSseModule` 的 `TAG` 在文件头的 companion 里（`:69`）。同一批改动两处风格不一致，建议对齐（都放文件头 companion）。

### 观察项（已核对通过 / 有意为之，不作缺陷）

- **✅ 主目标达成：「消 Promise 悬死」的 settle 路径确实存在**。逐跳核对 callTimeout 形态：OkHttp 到点 → `AsyncTimeout.timedOut()` 调 `RealCall.cancel()` → socket 关闭 → `pumpStream:368` 的 `source.read()` 抛**普通 `IOException`**（注意：`execute()` 的 `use{}` 体在 OkHttp 自己的 try 之外，所以拿不到 `InterruptedIOException("timeout")`）→ 我们自己的 `catch`（`:205`）→ `handleStreamFailure`：`userAborted.remove` 得 `null`（`userAbortedHit=false`）、`streams[requestId]` **非 null**（超时没有任何人关闸）→ 进锁 → `containsKey` 通过 → `classifyError:552-556`：`isCanceled()==true && !userAbortedHit && elapsed >= 600000` ⇒ 返回 `("timeout", "call timeout after 600000ms")` → `emitError` ⇒ JS `transport.ts:225-235` 的 `onError` → `finish(() => reject(NativeSseTransportError{kind:"timeout"}))` ⇒ **Promise settle** → core `llm-sse-transport.ts:249-254` 的 `isTransportTimeoutError` 命中 `e.kind === "timeout"` ⇒ 首字阶段可重试分支恢复。**改前这条路被 `:433` 的 `isCanceled()` 闸门整段吞掉**，对照成立。
- **✅ `effectiveCallTimeoutMs` 与 `clientWithCallTimeout` 的分支口径一致**（`:338-339` vs `:321-328`），注释也把「改一处要改两处」写死了，符合 spec `:1463-1473` 的要求。
- **✅ `startedAtNanos` 的取点方向安全**：`System.nanoTime()` 在 `:185` 取（`executor.execute` 之前），而 OkHttp 的 callTimeout 计时从 `call.execute()` 起算 ⇒ 本模块侧量到的 `elapsed` **恒 ≥** OkHttp 侧 ⇒ `elapsed >= effectiveCallTimeoutMs` 不会假阴性。用单调钟（`nanoTime`）而非墙钟，跨墙钟跳变安全。
- **✅ 维度 A 一致性逐项对齐**：`sseConnect`（6 参）/ `sseAbort`（1 参）/ `request`（5 参 + promise）与 `types.ts:59-76` 的 `LlmSseNativeModule` 一致；`headersKv: ReadableArray` ↔ `string[]`、`body: String?` ↔ `string | null`、`Int` ↔ `number` 全部对得上；四个事件名（`LlmSseHeaders/Chunk/Done/Error`，`:45-48`）与 `types.ts:33-36` 一字不差；四类 payload 的字段名（`requestId`/`status`/`contentType`/`text`/`kind`/`message`）与 `transport.ts:284-337` 的宽容解析器逐字段对得上；新增的 `kind:"timeout"` 已在 TS 联合类型（`types.ts:28`）内，无需改 TS。模块名 `LlmSseNative` / `SkspModule` 与 `native.ts:19` 的取用一致。
- **✅ 签名无变更 ⇒ 零回归面（C）**：`sseConnect`/`sseAbort`/`request` 的参数个数、顺序、类型全部保持；`StreamState` 新增的两个字段是**私有类**的内部字段，无外部可见性；`classifyError` 是 `private`。⇒ 旧调用方无需任何改动。
- **✅ Sksp 单线程 executor 不会死锁**（维度 B 的专项核对）：`encrypt`/`decrypt` 的任务体内**没有任何同步等待自身的调用**——`KeyStore`/`Cipher`/`KeyGenerator` 都是纯系统调用，不回调 RN；`promise.resolve/reject` 在 RN 里是「投递到 JS 线程」的异步投递，**不阻塞等待 JS**。⇒ 单线程队列里不存在自等待。饥饿面：无界 `LinkedBlockingQueue`，若某次 keystore 卡住则后续全部排队且**无上界**；但这**严格优于改前**（改前堵的是整条 NativeModules 队列，连 `sseAbort` 一起堵），属可接受的既有形态。
- **✅ `keyStore` 字段的线程安全论证成立**：Kotlin `by lazy` 默认 `LazyThreadSafetyMode.SYNCHRONIZED`（本身线程安全），且 `getOrCreateKey:86` 与 `decrypt:130` 两处**都**改用了该字段（spec `:1637-1643` 点名的「只改字段声明漏掉 `getOrCreateKey` 内部那一处」的坑**没有踩**）⇒ 全模块确实只有一个 `KeyStore` 实例，且只在 `nm-sksp` 单线程上访问。
- **✅ Sksp 范式其余部分对齐**：`Executors.newSingleThreadExecutor { Thread(runnable, "nm-sksp").apply { isDaemon = true } }` 与 `TokenizerModule.kt:30-32` **逐字同构**（只差线程名）；`promise.resolve/reject` 留在 executor 线程上调用；`invalidate()` **没有**被发明出来、`executor.shutdownNow()` **没有**被调用，且注释明写「与 `TokenizerModule` 完全同款、不是漏项」（spec 修法 4 选项 B `:1644-1653`）。`debugLoggable` 用 `ApplicationInfo.FLAG_DEBUGGABLE` 而非 `BuildConfig.DEBUG` 的理由（library 模块未开 `buildConfig` feature）成立。
- **⚠️ 但 `check-encoding.mjs` 扫不到这两个 `.kt`**（路径含 `android` 段，被 `SKIP_DIRECTORIES` 排除）——本轮已手工字节级核对（BOM/U+FFFD/UTF-8 合法性均干净），但这是**门禁盲区**，值得在 wave-e 后续里单独记一笔（要么把 `android` 排除改成只排 `apps/mobile/android/app/build` 之类的精确前缀，要么单列一条 `.kt` 扫描面）。
- **`debugLog` 的开销可忽略**：`by lazy` 求值一次，命中后是一次 `flags and` 与一次 `Log.d`；且 release 构建下 `debugLoggable` 为 false、字符串插值仍会先求值（`userAborted.size` / `System.nanoTime()` 是 O(1)，可接受）。
- **`shutdown()`（`:298-310`）幂等**：`invalidate()` 与 `onCatalystInstanceDestroy()` 都会调它，`shutdownNow()` 重复调用无害；`userAborted.clear()` 已在 `:307`。唯一残留小口：shutdown 与并发中的 `sseAbort` 交错时可能在 `clear()` 之后又写回一条——但 shutdown 之后本就不该再有 abort，且模块随即销毁，**不作为缺陷**。
- **`emitEvent` 的 `catch (_: Throwable)`（`:604`）静默吞事件**是既有的「bridge 已关停不 crash」设计。它同时意味着「事件发不出去 ⇒ JS Promise 悬死」在 bridge 关闭场景下**依然存在**，与本 commit 标题里的「消 Promise 悬死」形成口径差：本次消除的是 **callTimeout 这一条**具体悬死路径，不是全部。建议在 PR 描述里把措辞收窄到「消除 callTimeout 导致的悬死」，避免过度宣称。
- **`:418` 的 debugLog 在静默路径上打 `statePresent`**，对 P1-2 的定位很好用（能直接看出「标记被消费但 state 已 null vs state 非 null」），保留。

---

## ④ 结论

**verdict：changes-requested（P1 × 2 / P2 × 3）**

- 两个 P1 都不是「运行时错」，而是**把 spec 自己的验收断言变成了不可达/概率红**：
  - P1-1 让 C1-12 的 I4 ①（`nm-sksp` 线程名在位）**必然判红**，并且给出「sksp 仍在内联」的**反向假信号**——而 I4 ②（栈帧不在 RN 队列线程）才是本条真正的牙齿，现在也没法用日志交叉印证。修法是两行挪动，成本近乎为零，性价比最高，建议优先。
  - P1-2 让 C1-11 的 I4（`userAborted` 三次之后为空）**概率性红**，且代码注释（`:474`）描述的覆盖范围大于实现。功能上因 requestId 永不复用而**不致错**（不会误吞后续流的错误），但它把 spec 点名要防的残留类别留在了原地。
- P2-1 是**本 commit 引入的可见性回归**：把工作搬到后台线程后，`Error` 逃逸从「RN 队列线程冒泡 → redbox 可见」变成「worker 线程静默吞掉 → Promise 悬死且无信号」，与本 commit 的主题方向相反；修法是两个词。
- P2-2 / P2-3 是注释事实错误与文件末尾换行/导入序，量级小但会复发。
- **主目标本身判定为达成**：`callTimeout → cancel → 读循环抛普通 IOException → handleStreamFailure 命中新分支 → emitError(kind:"timeout") → JS `finish(reject)` → core `isTransportTimeoutError` 命中` 这条 settle 链逐跳核对无误，改前被吞的闸门确已删除。JS 侧桥接契约（方法签名、事件名、payload 字段、`kind` 联合类型）与 TS 声明逐项对齐，**无需任何 TS 改动**；三个 `@ReactMethod` 的公开签名零变更，**零回归面**。
- **真机/模拟器验证不在本机位范围**：C1-11 的 I1/I3/I4、C1-12 的 I1/I3/I4 需要 Metro dev server + `adb install -r -d` 的一次用户在场窗口（按 AGENTS.md 硬规则，**永不卸载**）。P1-1 / P1-2 的报告内已各附可直接执行的验证步骤与判据，请 `dev_leftovers` 在该窗口一次性跑完（含 C1-11 I4 与 C1-12 I4 的**共用 logcat 核对**）。
