---
zone: w10-kt-sksp
agent: zone-scan (W10 Kotlin 专项 — 四端 SKSP 中最后一个未深审的原生面)
repo_head: fe79b781
files_scanned:
  - packages/sksp-android/android/src/main/java/com/novelmaster/sksp/SkspModule.kt (83 行，全读)
  - packages/sksp-android/android/src/main/java/com/novelmaster/sksp/SkspPackage.kt (16 行，全读)
  - packages/sksp-android/android/src/main/AndroidManifest.xml (1 行，全读)
  - packages/sksp-android/android/build.gradle (30 行，全读)
  - packages/sksp-android/package.json (41 行，全读)
  - packages/sksp-android/src/android-secret-store.ts (94 行，全读)
  - packages/sksp-android/src/native.ts (27 行，全读)
  - packages/sksp-android/src/register.ts (17 行，全读)
  - packages/sksp-android/src/index.ts (6 行，全读)
  - packages/sksp-android/test/android-secret-store.test.ts (154 行，全读)
  - packages/sksp-android/test/rn-mock-hook.mjs (20 行，全读)
  # 对齐面对账（只读，不在本区改动范围）
  - packages/sksp-mac/src/{crypto,keychain,sqlite-secret-store}.ts
  - packages/sksp-linux/src/{crypto,keychain,sqlite-secret-store}.ts
  - packages/sksp-windows/src/{dpapi,sqlite-secret-store}.ts
  - packages/core/src/infra/sksp/impl/base-sqlite-secret-store.ts
  - packages/core/src/infra/sksp/impl/sksp-strategy.port.ts
  - packages/core/src/infra/sksp/sksp-error.ts
  - packages/core/src/infra/sksp/ports/secret-store.port.ts
  - packages/core/src/bootstrap/sksp/sksp-schema.ts
  # 装配面 / 消费面
  - apps/mobile/android/app/src/main/java/com/novelmaster/MainApplication.kt
  - apps/mobile/android/settings.gradle / apps/mobile/android/gradle.properties
  - apps/mobile/android/app/src/main/AndroidManifest.xml
  - apps/mobile/src/runtime/mobile-sksp.ts
  - packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerModule.kt（同类模块的线程/异常处理基线）
  - docs/Iterations/sksp/test/sksp-android.md / docs/Iterations/sksp/spec.md
  - docs/Iterations/core-explore-remediation/features/sksp-key-lifecycle/spec.md
---

## 摘要

`packages/sksp-android` 是四端 SKSP（Secret Key Storage Protocol）里唯一的**原生实现面**，
也是全 CR 最后一个没被深审过的 Kotlin 原生模块。它只有两个 Kotlin 文件、83 行有效代码：
`SkspModule.kt` 暴露 `encrypt(ref, plain)` / `decrypt(ref, ciphertextB64, ivB64)` 两个
`@ReactMethod`，内部走 **AndroidKeyStore + AES-256-GCM**（`KeyGenParameterSpec` + `Cipher`），
把 `{ciphertext, iv}` 以 base64 文本过桥；`SkspPackage.kt` 是标准的 `ReactPackage` 空壳。
SQL 编排（`SELECT/INSERT/DELETE`、ref 校验、algo 版本比对）全部下沉到 core 的
`BaseSqliteSecretStore`，平台差异只剩一个 `SkspCryptoStrategy`。

**密钥在原生层的存储形态（本次区域重点，逐项核实）**：

| 关注点 | 结论 | 依据 |
|---|---|---|
| 是否明文落盘 | **否**。DB 里只有 AES-GCM 密文 + IV（base64 文本） | `SkspModule.kt:53-59`；`sksp-schema.ts:8-21` |
| 是否用 Keystore | **是**，且是每 ref 一把独立 key，硬件支持时落 TEE/StrongBox | `SkspModule.kt:29-46` |
| key 是否出 Keystore | **否**，`SecretKey` 对象全程只在进程内传给 `Cipher.init` | `SkspModule.kt:31,52,71` |
| IV 是否复用 | **否**，IV 由 AndroidKeyStore 在 `cipher.init` 时随机生成，每次不同 | `SkspModule.kt:54-55` |
| GCM tag | 正确，`doFinal` 产出已含 128-bit tag，解密用 `GCMParameterSpec(128, iv)` | `SkspModule.kt:56,75` |
| 明文是否可能出现在 ref/日志 | **否**，两条 reject 的 message 都不含 ref（ref 在 TS 侧拼） | `SkspModule.kt:62,80` |
| DB 文件权限 | app 私有目录 + `android:allowBackup="false"` | `apps/mobile/android/app/src/main/AndroidManifest.xml:15` |
| 跨端搬运密文 | 已被产品层排除（`.nmbackup` 与云同步都不含服务商三表） | `cross-device-cloud-sync/prd.md:14,90`；`sksp-key-lifecycle/spec.md` |

**安全基线是合格的**：没有明文、没有自研加密、没有 key 导出、IV/GCM 参数用法都对。
问题集中在**工程健壮性与契约对齐**上——本区共 17 条 findings，**P0 = 0**，
唯一的 P1 是同一个仓库在 1 天前（2026-09-30）刚犯过并修掉的那类「阻塞原生模块队列」问题。

## 职责与边界

- **只做**：AndroidKeyStore key 的 get-or-create、AES-256-GCM 加解密、base64 编解码、
  异常 → `promise.reject(code)`。
- **不做**：SQL 编排（core `BaseSqliteSecretStore`）、ref 合法性校验（core `assertValidRef`）、
  algo 版本比对（core `get`）、key 的删除/轮换（**根本没有这个能力，见 F-3**）。

## 对外接口（Kotlin）

| 方法 | 签名 | reject code |
|---|---|---|
| `encrypt` | `(ref: String, plain: String, promise: Promise)` → `{ciphertext, iv}`（均为 base64 文本） | `ENCRYPT_FAILED` |
| `decrypt` | `(ref: String, ciphertextB64: String, ivB64: String, promise: Promise)` → 明文 `String` | `DECRYPT_FAILED` |

`getName() = "SkspModule"`（`SkspModule.kt:21`），与 `native.ts:19` 的 `NativeModules.SkspModule` 对齐。
key alias 由 `SHA-256(ref)` 截断 16 位 hex 得 `nm_sksp_<hex>`（`SkspModule.kt:23-27`）。

## 与其他三端的对齐度总表

| 维度 | Android | mac / Linux | Windows |
|---|---|---|---|
| 密钥容器 | AndroidKeyStore（每 ref 一把 key） | Keychain / Secret Service（**全局一把** master key） | DPAPI（OS 托管） |
| 算法 | AES-256-GCM | AES-256-GCM | DPAPI |
| 密文列运行时形态 | base64 **字符串** | `Uint8Array`（BLOB） | `Uint8Array`（BLOB） |
| iv 列 | 必填（schema CHECK 强制） | 必填 | `NULL` |
| 错误包装 | **全包成新的 `SkspError`，`DB_ERROR` 会被吞掉**（F-5） | `SkspError` 原样透传 | 同 mac |
| 密钥删除 | **无能力**（F-3） | 无需（全局单 key） | 不适用 |
| 线程模型 | 内联原生队列（F-1） | 纯同步 TS，无此问题 | 不适用 |

> 注：「每 ref 一把 Keystore key」在安全性上**优于** mac/linux——mac/linux 的全局 master key
> 下密文没有和 `ref` 做 AAD 绑定，理论上可以在 DB 里跨 ref 换密文；Android 因为 key 由 ref 派生，
> 换密文必然换 key、必然 GCM 认证失败，等价地拿到了 ref 绑定。这一点是本模块的设计优势，记录在案。

---

## Findings

### F-w10-kt-sksp-1 | P1 | `SkspModule.kt:48-82`（无 executor）

**引文**：整个 `SkspModule` 没有引入任何 `Executor`——对比 `TokenizerModule.kt:30-32`：

```kotlin
  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "nm-tokenizer").apply { isDaemon = true }
  }
```

**描述**：`@ReactMethod` 默认**内联**跑在 RN 的原生模块调用队列上（legacy 模式下是全局唯一的
`mNativeModulesQueueThread`；bridgeless 模式下走 interop 的共享派发点），不是每个模块一条线程。
`SkspModule` 的两个方法在这条队列上做的全是**阻塞式系统调用**：
`KeyStore.getInstance("AndroidKeyStore").load(null)`（每次都重新 load 两次，`encrypt` 里一次
`getOrCreateKey`、一次 `Cipher.init`）、
以及冷路径上的 `KeyGenerator.generateKey()`（要过 keystore2 守护进程，硬件支持时进 TEE/StrongBox，
实测普遍在百毫秒到秒级）。

**这不是理论风险，是同仓库 1 天前刚踩过的坑**。`TokenizerModule.kt:18-24` 的注释是原始事故记录：

> **计数跑在模块自己的单线程 executor 上（2026-09-30）**：`@ReactMethod` 默认在 RN 的
> NativeModules 队列上**内联**执行……它会把同一条队列上的其它原生调用（含 llm-sse 的
> `sseConnect` 派发）一起堵住，表现为「发完消息很久才开始出字」「进会话偶发卡死」。

`sksp-android` 与 `llm-sse-native` / `tokenizer-driver-rn` 共用这一条队列。
`set()`（保存 API Key）是用户可见操作，`get()` 在每次模型请求解析 apiKey 时都会走到。

**建议**：`SkspModule` 加一个与 `TokenizerModule` 同款的单线程 executor，方法体整体包进去。
顺手把 `KeyStore` 实例提到字段上按需复用，避免每次 `load(null)`。

**置信**：confirmed（Kotlin 源码 + 同仓库在架注释双向印证；**未做真机耗时实测**，
但「KeyStore 操作落在共享队列上」这一点不依赖耗时——只要它是阻塞的就有风险。）

---

### F-w10-kt-sksp-2 | P2 | `SkspModule.kt:25`

**引文**：
```kotlin
    val hex = digest.joinToString("") { "%02x".format(it) }.take(16)
```

**描述**：`String.format` 不带 locale 参数时用 `Locale.getDefault(Locale.Category.FORMAT)`，
而 `java.util.Formatter` 的 `printInteger` 会取 `DecimalFormatSymbols.getZeroDigit()` 作为填充/字形基准。
在 zero-digit 不是 ASCII `'0'` 的 locale 下（印地语 `hi-IN-u-nu-deva`、阿拉伯语 `ar-EG`、
泰语、孟加拉语等），`%02x` 产出的是**本地化数字字形**而不是 `0-9a-f`。

`this` 是 **Keystore alias 的唯一来源**。若用户在设备 A（zh-CN）存了 key、把系统语言切到
`ar-EG`，同一 ref 派生出的是**另一个 alias** → `ks.getKey` 返回 null → `SkspModule.kt:72`
抛 `IllegalStateException("Keystore key missing for ref")` → 用户看到 `DECRYPT_FAILED.
Keystore decrypt failed for <ref>. Re-configure apiKey.`。

**后果链**：不只是这条 ref 读不出来——`edit --apiKey` 重写时会用新 locale 的 alias 生成新 key，
于是**同一个 ref 在系统里留下两把孤儿 key**，且旧密文永远无法恢复，用户必须逐个服务商重新录 API Key。
这是「密钥派生不稳定」类缺陷，一次发生就是全量密钥丢失。

**建议**：`"%02x".format(Locale.ROOT, it)`。一行的事。

**附带**（同处）：`.take(16)` 把 256-bit 摘要截成 64 bit。见 F-17。

**置信**：confirmed（`java.util.Formatter.printInteger` 的 locale 行为是 JDK 既定语义）。
zh-CN 默认 locale 下不触发，故列 P2 而非 P1。

---

### F-w10-kt-sksp-3 | P2 | `SkspModule.kt`（缺 `deleteKey`）+ `base-sqlite-secret-store.ts:95-104`

**描述**：`SkspModule` 只有 `encrypt`/`decrypt` 两个 `@ReactMethod`，**没有提供任何删除 Keystore key 的入口**。
而 `SecretStore.delete` 在 base class 里只删 DB 行：

```typescript
  async delete(ref: string): Promise<boolean> {
    ...
    `DELETE FROM sksp_secrets WHERE ref = ?`...
```

`provider.service.ts` 的删除路径（见 `sksp-key-lifecycle/spec.md` §1）确实会调 `secretStore.delete(ref)`，
`edit` 清空 apiKey 也走 delete。也就是说**每一次删服务商 / 清空 apiKey，都会在 AndroidKeyStore
里留下一把永久孤儿 key**。

mac/linux 没这个问题——它们是全局一把 master key，删 ref 不涉及 key 生命周期。
所以这是 Android 独有的、随「ref 数量 × 用户反复 edit」单调增长的系统资源泄漏：
系统级 keystore 里的条目越攒越多，既没有 API 可清，也没有 UI 提示，
`adb shell cmd keystore` 之外用户完全无感。

**附带**：同一条链路上**没有 key 轮换能力**。`getOrCreateKey` 永远复用旧 key，
一旦某把 key 被 Keystore 判为永久失效（见 F-7），该 ref 就再也回不来了。

**建议**：加 `@ReactMethod fun deleteKey(ref: String, promise: Promise)`（内部
`KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(aliasForRef(ref))`），
`SecretStore.delete` 在 Android strategy 侧补一次调用。注意**顺序**：应先删 DB 行再删 key
（与 `sksp-key-lifecycle/spec.md` 记的「先删 provider 再清 SKSP」保持同向）。

**置信**：confirmed（代码里确实没有这个方法；`sksp-key-lifecycle/spec.md` 确认 delete 路径在跑。）

---

### F-w10-kt-sksp-4 | P2 | `SkspModule.kt:61`、`SkspModule.kt:79`

**引文**：
```kotlin
    } catch (e: Exception) {
      promise.reject("ENCRYPT_FAILED", e.message, e)
    }
```

**描述**：两个方法都只捕 `Exception`。一旦抛的是 `Error`（`OutOfMemoryError`、
`NoClassDefFoundError`、厂商 ROM 上 Keystore provider 异常导致的 `UnsatisfiedLinkError`/`Error`），
`catch` 不进、异常抛回 RN 的调用循环，**Promise 既不 resolve 也不 reject**。
JS 侧 `await native.encrypt(...)` 就永远挂在那里——没有超时、没有兜底，
调用方的 `set()` / `get()` 一起悬停，表现就是「保存 apiKey 转圈不结束」。

**同仓库基线相反**。`TokenizerModule.kt:51` 明确选了 `catch (e: Throwable)`，
并且在注释里写了理由：「失败一律 reject」。这是全仓 Android 模块的既定纪律，sksp 没跟上。

**建议**：改成 `catch (e: Throwable)`。

**置信**：confirmed（两文件对照；`Error` 分支的确切触发概率未实测，但「Promise 不 settle」
这个后果在任何 `Error` 上都成立。）

---

### F-w10-kt-sksp-5 | P2 | `android-secret-store.ts:68-80`

**引文**：
```typescript
    try {
      return await native.decrypt(
        ref,
        bytesToBase64(decodeBlob(row.ciphertext)),
        bytesToBase64(decodeBlob(iv)),
      );
    } catch (cause) {
      throw new SkspError("DECRYPT_FAILED", `Keystore decrypt failed for ${ref}. Re-configure apiKey.`, { ref, cause });
    }
```

**描述**：`decodeBlob`（`:23-31`）在列类型不是 `Uint8Array`/`string` 时抛的是
`SkspError("DB_ERROR", "Invalid blob column")`——但这个调用**写在 try 里面**，
于是被 `catch` 重新包成 `DECRYPT_FAILED`，`DB_ERROR` 这个 code 当场丢失。

`ciphertext` 是 `BLOB NOT NULL` 列，但 SQLite 动态类型 + BLOB affinity 不做转换，
任何历史写入（或外部工具）都能塞进 INTEGER / REAL / 空 blob。
这类「DB 层数据损坏」的错误码被谎报成「解密失败，请重新配置 apiKey」，
把一个 schema/迁移问题误导成用户配置问题——排查方向直接跑偏。

**mac / windows 没有这个问题**，因为它们的列解码在 try **之外**（`sksp-mac/src/sqlite-secret-store.ts:54-57`、
`packages/sksp-windows/src/sqlite-secret-store.ts:40-42`）：`rowCiphertext(row)` 抛的 `DB_ERROR`
原样冒泡给调用方，只有真正进密码运算的失败才被 `decryptUtf8`（`crypto.ts:53-59`）包成 `DECRYPT_FAILED`。

`encrypt` 侧（`:50-60`）同理：`getSkspNativeModule()` 在 try 外抛的裸 `Error`、
以及 native 返回结构异常时包出来的 `ENCRYPT_FAILED`，语义都偏了（后者见 F-12）。

**建议**：把 `decodeBlob(row.ciphertext)` / `decodeBlob(iv)` 提到 `try` 之前
（与 mac/linux 逐字对齐），`try` 里只包 `native.decrypt`。

**置信**：confirmed（三端源码逐行对照。）

---

### F-w10-kt-sksp-6 | P2 | `packages/sksp-android/android/`（零测试）

**描述**：整个包**没有任何 Kotlin/JVM 测试**——
`android/src/test` 目录不存在，`android/build.gradle` 里没有 `testImplementation`、
没有 `testOptions`、没有 Robolectric。

同仓库的原生 Kotlin 包 `packages/tokenizer-driver-rn` 相反：
`android/src/test/java/com/novelmaster/tokenizer/` 下有 `TokenizerEngineTest.kt`、
`TokenizerParityTest.kt`、`TokenizerScalingProbeTest.kt` 三个测试类，
`build.gradle:43-46` 配了 `junit:4.13.2` 等测试依赖。

**后果**：本包最脆的两段逻辑**零回归保护**——
`aliasForRef`（key 派生的唯一真相，正是 F-2 的现场）和
base64 ↔ `ByteArray` ↔ GCM 的编解码边界（正好是 F-2/F-9 的现场）。
现在 TS 侧的 `android-secret-store.test.ts` 是拿一个**纯 base64 直通桩**（`:26-37`）
测的，Kotlin 里真实的 Keystore/AES-GCM 代码路径**一行都没被执行过**——
换句话说，现有测试证明的是「SQL 编排对」，不是「密钥加解密对」。

而验收文档 `docs/Iterations/sksp/test/sksp-android.md` 的 A2 章节标注「待执行」，
明确写着「本机未连接模拟器，未做 on-device 探针」——这条链路至今没有真实设备验证记录。

**建议**：加 `android/src/test`，用 Robolectric 或直接测纯函数部分
（`aliasForRef` 的稳定性/长度/字符集、GCM 密文长度 = 明文长度 + 16 的 tag、base64 往返）。
`aliasForRef` 目前是 `private`，测之前需要提为 `internal`。

**置信**：confirmed（`git ls-files` 全量确认无测试文件；两份 build.gradle 对照。）

---

### F-w10-kt-sksp-7 | P2 | `SkspModule.kt:29-34`

**引文**：
```kotlin
  private fun getOrCreateKey(alias: String): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = ks.getKey(alias, null) as? SecretKey
    if (existing != null) {
      return existing
    }
```

**描述**：`existing != null` 就直接返回，**不检查这把 key 是否已被 Keystore 标记为失效**。
如果系统 keystore 判定该条目 invalid（`KeyPermanentlyInvalidatedException` /
`UnrecoverableKeyException` 场景），`getOrCreateKey` 会永远把这把坏 key 返回出去，
`cipher.init` 在 `SkspModule.kt:54` 抛异常 → `ENCRYPT_FAILED`。
因为坏 key 一直在，`getOrCreateKey` 永远不会走「删除后重建」分支——**该 ref 永久不可写**。

mac/linux 的对应位置（`sksp-mac/src/keychain.ts:30-40`）虽然也只是抛 `DECRYPT_FAILED`，
但那里失效的 master key 是**全局一把**，用户重新配置任意一个 key 时会走
`entry.setPassword(...)` 覆盖写入，路径能自愈。Android 的 per-ref key 没有这个逃生口。

**诚实标注**：本 key 未绑定用户认证（没调 `setUserAuthenticationRequired`，见 F-8），
所以 Android 判定它失效的概率**很低**——这条主要是一条「没有自愈路径」的设计缺口，
而不是高频 bug。若将来加了 F-8 的加固，这条会立刻从 P3 升到 P1。

**建议**：`getOrCreateKey` 里对取回的 key 做一次 try-init 探测，
捕获 `KeyPermanentlyInvalidatedException` 后 `ks.deleteEntry(alias)` 再重建。

**置信**：likely（代码缺口 confirmed；Keystore 实际判失效的概率未在真机验证。）

---

### F-w10-kt-sksp-8 | P3 | `SkspModule.kt:36-43`

**引文**：
```kotlin
    val spec = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .build()
```

**描述**：没有 `setUnlockedDeviceRequired(true)`（API 28+），意味着这把 key 在设备处于
**锁屏状态**时也能被本进程拿来解密。本应用存的是 LLM 服务商 API Key，
属于高价值凭据。

`setUserAuthenticationRequired` 在这里**不该加**（应用要在后台发请求，生物认证会阻断正常使用），
但 `setUnlockedDeviceRequired` 不阻断应用自身调用，只要求设备至少解锁过一次——
正是这个场景想要的加固。

**注意**：`minSdkVersion = 26`（`apps/mobile/android/build.gradle:4`），
`setUnlockedDeviceRequired` 是 API 28 才有的，需要 `Build.VERSION.SDK_INT >= 28` 分支保护。

**建议**：加版本保护后设置。这是「加固建议」而非缺陷，不阻塞发版。

**置信**：confirmed。

---

### F-w10-kt-sksp-9 | P3 | `SkspModule.kt:74-77`

**引文**：
```kotlin
      val iv = Base64.decode(ivB64, Base64.NO_WRAP)
      val spec = GCMParameterSpec(128, iv)
      cipher.init(Cipher.DECRYPT_MODE, key, spec)
      val plainBytes = cipher.doFinal(Base64.decode(ciphertextB64, Base64.NO_WRAP))
```

**描述**：两处缺前置校验。

1. **IV 长度不校验**：`GCMParameterSpec` 接受任意长度 IV（GCM 规范允许经 GHASH 派生），
   所以一个 0 字节或 1 字节的 iv 列不会抛「参数非法」，而是安静地算出一个不同的 IV，
   最终以 `AEADBadTagException` 收场。schema 的 `CHECK (... OR iv IS NOT NULL)`
   （`sksp-schema.ts:20`）只挡 NULL，挡不住空串。
2. **密文最短长度不校验**：mac 端有显式守卫（`packages/sksp-mac/src/crypto.ts:43-45`）：

```typescript
    if (buf.length < TAG_BYTES) {
      throw new Error("ciphertext too short");
    }
```

Android 端没有。Conscrypt 最终也会因 tag 校验失败抛异常，所以**不会返回错误明文**，
但错误从「明确的 `ciphertext too short`」退化成 AEAD 认证失败，两者都映射到同一个
`DECRYPT_FAILED`，可诊断性下降。

**建议**：解密前校验 `iv.size` 与密文长度（`plain + 16` 字节 tag），
失败时给出区分于「认证失败」的错误信息。

**置信**：confirmed（无长度守卫是代码事实；Conscrypt 的具体异常类型未在真机复现，
但「不会返回错误明文」这一点由 GCM 语义保证。）

---

### F-w10-kt-sksp-10 | P3 | `SkspModule.kt:78`

**引文**：
```kotlin
      promise.resolve(String(plainBytes, Charsets.UTF_8))
```

**描述**：`String(ByteArray, UTF_8)` 对非法 UTF-8 字节序列是**静默替换**成 U+FFFD 的，
不抛异常。也就是说一条被外部损坏的密文（虽不太可能通过 GCM 认证）一旦解出非法字节序列，
apiKey 会变成一串 `�` 并被当成有效值返回给调用方。

mac/linux 走 `Buffer.toString("utf8")`，行为完全一致，所以这是**四端一致的既有约定**，
不算 Android 单端缺陷。记录在此是为了让「四端对齐」这条结论有据可查，
也提醒不要在这一处单独加严（会造成新的跨端行为分叉）。

**置信**：confirmed（四端一致）。

---

### F-w10-kt-sksp-11 | P3 | `SkspModule.kt:62`、`SkspModule.kt:80`

**引文**：
```kotlin
      promise.reject("ENCRYPT_FAILED", e.message, e)
```

**描述**：`e.message` 是平台类型 `String!`，可以是 `null`。RN 的
`reject(String code, @Nullable String message, Throwable)` 允许 null message，
但 JS 侧拿到的 `error.message` 会是 `undefined`，RedBox/日志里就只剩一个 code，
排查时完全没有线索。

**同仓库基线相反**。`TokenizerModule.kt:53` 写的是：

```kotlin
        promise.reject("TOKENIZER_COUNT_FAILED", e.message ?: "原生分词计数失败", e)
```

**建议**：补 `?: "Keystore encrypt/decrypt failed"` 兜底。

**置信**：confirmed。

---

### F-w10-kt-sksp-12 | P3 | `android-secret-store.ts:49`、`android-secret-store.ts:67`、`native.ts:22-27`

**引文**：
```typescript
  async encrypt(ref, plain) {
    const native = getSkspNativeModule();     // ← 在 try 外面
    try {
      const enc = await native.encrypt(ref, plain);
```
```typescript
export function getSkspNativeModule(): SkspNativeModule {
  if (!native.SkspModule) {
    throw new Error("SkspModule is not linked (Android only)");   // ← 裸 Error
  }
```

**描述**：`getSkspNativeModule()` 在 `try` 之前调用，抛的是**裸 `Error`**，没有 `.code`。
这直接违反 `SkspErrorCode`（`packages/core/src/infra/sksp/sksp-error.ts:8-13`）
建立的「SKSP 域内所有失败都是带 code 的 `SkspError`」契约。

mac/linux 没有这个问题：`getOrCreateMasterKey` 在非本平台时抛的是带 code 的 `SkspError`
（`sksp-mac/src/keychain.ts:69-76`）。

触发条件是真实存在的：`MainApplication.kt:19-23` 手工 `add(SkspPackage())`，
万一 autolinking 因 workspace 符号链接问题没生效（代码注释自己就担心了这件事，见 F-14），
模块就是「能编译、能启动、但调用时才炸」的形态。

**影响评估**：`git grep` 全仓确认**目前没有任何调用方按 `.code` 分支处理 SKSP 错误**
（provider service 只是 catch 后往上抛），所以当前不会造成错误路由。
列 P3 是因为这是契约层的破口，后续一旦有人按 code 分流就会踩。

**建议**：把 `getSkspNativeModule()` 调用挪进 `try`，或让它自己抛
`new SkspError("ENCRYPT_FAILED"/"DECRYPT_FAILED", "SkspModule is not linked", ...)`。

**置信**：confirmed。

---

### F-w10-kt-sksp-13 | P3 | `android-secret-store.ts:53`

**引文**：
```typescript
      const enc = await native.encrypt(ref, plain);
      // 存 base64 文本，不走 Uint8Array BLOB 绑定（quick-sqlite heap 损伤）。
      return { ciphertext: enc.ciphertext, iv: enc.iv };
```

**描述**：**写侧对 native 返回值零校验**。若桥上的模块是旧版本、或 `enc.ciphertext` /
`enc.iv` 因为任何原因为 `undefined`，这两个值会被原样绑进 INSERT：
`ciphertext` 撞上 `BLOB NOT NULL` 约束抛一个原始 sqlite 错误（不是 `SkspError`，
更不是 `ENCRYPT_FAILED`），`iv` 撞上 `CHECK ((algo = 'dpapi-v1') OR (iv IS NOT NULL))` 同理。

**读侧有守卫**（`decodeBlob`，`:23-31`），写侧没有——不对称。
注意这张表有 4 个 `algo` 取值 + 1 个 CHECK 约束（F-3、F-5 都栽在这张表上），
让数据库约束去做参数校验，错误信息会很poor。

**建议**：加一个对称的 `asBase64(v: unknown): string` 守卫，非法时抛
`SkspError("ENCRYPT_FAILED", ...)`。

**置信**：confirmed。

---

### F-w10-kt-sksp-14 | P3 | `MainApplication.kt:21` + `packages/sksp-android/package.json:31-35`

**引文**：
```kotlin
        packageList = PackageList(this).packages.apply {
          // Local monorepo packages: explicit add() mirrors @novel-master/sksp-android.
          // PackageList autolink may not always include workspace project packages reliably.
          add(SkspPackage())
```

**描述**：这两处是**重复注册**。
`packages/sksp-android/package.json:31-35` 声明了标准的 autolinking 字段：

```json
  "react-native": { "android": { "sourceDir": "./android" } }
```

且 `apps/mobile/package.json:39` 把它列为依赖 → `settings.gradle:6` 的
`autolinkLibrariesFromCommand()` 生成的 `PackageList` **本来就包含** `SkspPackage`，
再手动 `add()` 就是同一个包加两遍。

`NativeModuleRegistry` 按名字建 map，重复项不会崩，但会多创建一个 `SkspModule` 实例
（各自持有一个 executor/KeyStore 句柄，如果 F-1 修好之后），并且这份注释描述的
「autolink 不可靠」在 npm workspace 符号链接下并不成立——注释本身已经是过期信息。

同一模式在 `TokenizerPackage()` 上也存在（`MainApplication.kt:22`），
所以这是全 mobile 原生包的统一现状，不是 sksp 单点问题。

**建议**：与 tokenizer 一并评估——验证 autolink 确实生效后删掉显式 `add()` 与那段注释；
或者反过来关掉 autolink 只走手工 include。**不要只改一个包**，否则两套机制混用更难排查。

**置信**：likely（autolinking 会扫到 workspace 符号链接包是 RN 的既定行为，
但未实际跑 `npx react-native config` 验证 `PackageList.java` 的生成结果。）

---

### F-w10-kt-sksp-15 | P3 | `docs/Iterations/sksp/test/sksp-android.md`（全文）

**描述**：这份验收文档已与代码脱节，三处都不可复现：

1. **A1 表格**写着 `Dev UI | apps/mobile/src/screens/SkspDevScreen.tsx，ref provider/dev-probe/apiKey`。
   `git ls-files` 全仓搜索 `SkspDevScreen` **零命中**——这个文件已经被删了。
   A2 整章（跑 set/get、清除存储后验证失败提示）依赖它，因此**整个 A2 无法执行**。
2. **备注**写着「已将 `packages/sksp-android/android` 纳入 `settings.gradle`（`:sksp-android`），
   `app/build.gradle` 增加 `implementation project(':sksp-android')`」。
   实际两个文件里**都没有** `sksp` 字样（`Select-String` 零命中），走的是 autolinking。
3. 引用路径写的是 `.apm/kb/docs/Iterations/sksp/test/sksp-android.md`，仓库里没有 `.apm/kb`。

文档头部 `审查人: pending` 也印证了这轮验收从未真正跑完。

**建议**：要么按当前 autolink 方式重写 A0/A2 并补真机执行记录，
要么把文档标注为「已作废，见 F-6 的测试补齐计划」。A2 里「清除存储后应出现 DECRYPT_FAILED」
这一条是有价值的验收点，值得保留并重新设计一个不依赖已删除 DevScreen 的触发方式。

**置信**：confirmed。

---

### F-w10-kt-sksp-16 | P3 | `packages/sksp-android/`（缺 README.md）

**描述**：`packages/sksp-linux/README.md`、`packages/sksp-mac/README.md`、`packages/tokenizer-driver-rn/README.md`
都有 README（`packages/sksp-android/README.md` 不存在，`git ls-files` 零命中；
`packages/sksp-windows` 同样缺，是并列的第二个）。
README 在这个仓库里承载「怎么手工验证这个包」的职责
（另两份都写了 build / 验收命令），而本包恰恰最需要一份
（F-6 说的零测试 + F-15 说的验收文档作废，两者可以合并到这一份 README 里）。

**置信**：confirmed。

---

### F-w10-kt-sksp-17 | P3 | `SkspModule.kt:25`

**引文**：
```kotlin
    val hex = digest.joinToString("") { "%02x".format(it) }.take(16)
```

**描述**：SHA-256 出 64 个 hex 字符，这里只取前 16 个——**alias 空间被压到 64 bit**。
生日碰撞阈值约 2^32 个不同 ref。SKSP 的 ref 空间是 `provider/<id>/apiKey`
加云同步的 `cloud-sync/s3-secret-key` 这类，实际量级是几十到几千，
碰撞概率可以忽略。所以这不是一个现实的安全问题。

但它有一个不该被忽略的**副作用**：alias 碰撞意味着**两把不同的 ref 共用一把 key**，
此时跨 ref 替换密文就不再被 GCM 认证拦住了（见摘要里「per-ref key 提供 ref 绑定」那条优势）——
也就是说，本设计唯一的 ref 绑定保证，建立在这个被截断的 64 bit 上。
去掉 `.take(16)`（Keystore alias 上限 64 字符，64 个 hex 字符刚好放得下）成本为零。

**建议**：去掉 `.take(16)`，或至少在注释里写明为什么截断。
AndroidKeyStore alias 长度上限是 64，正好容得下完整摘要。

**置信**：confirmed（截断存在且无注释说明用途）。

---

## 汇总

| 级别 | 数量 | 编号 |
|---|---|---|
| P0 | 0 | — |
| P1 | 1 | F-1 |
| P2 | 6 | F-2, F-3, F-4, F-5, F-6, F-7 |
| P3 | 10 | F-8 … F-17 |

**结论**：密钥存储的**安全基线没有问题**——AndroidKeyStore + AES-256-GCM、
每 ref 一把 key、随机 IV、GCM tag 校验、base64 无换行、DB 在 app 私有目录且 `allowBackup=false`，
没有明文、没有自研加密、没有 key 导出。跨端搬运密文的风险已被产品层（`.nmbackup` 与云同步
排除服务商三表）挡住。

**唯一需要在发版前处理的是 F-1**：它不是新问题，是同仓库 1 天前刚修过的
「阻塞原生模块共享队列」问题在 sksp 上的复发，改法有现成范本可抄（`TokenizerModule.kt:30-32,43`）。
F-3（无 key 删除能力）与 F-6（零 Kotlin 测试）是本区最实质的两个工程缺口——
前者会让系统 keystore 随使用单调膨胀且无清理入口，后者让整条密钥链路至今没有自动化验证。

F-2 是一行修复（`Locale.ROOT`），建议顺手带上：它的发生概率低，但后果是全量 API Key 不可恢复。