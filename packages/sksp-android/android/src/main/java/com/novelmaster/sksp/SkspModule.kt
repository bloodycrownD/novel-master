package com.novelmaster.sksp

import android.content.pm.ApplicationInfo
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.security.KeyStore
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.security.MessageDigest

class SkspModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SkspModule"

  /**
   * 全模块唯一的 KeyStore 实例（懒加载一次 `load(null)`）。
   *
   * 旧形态在 [getOrCreateKey] 与 `decrypt` 里各 `KeyStore.getInstance(...)` +
   * `load(null)` 一次——**每次调用都重新加载上下文**。改成字段后 encrypt/decrypt
   * 两条路共用它；⚠️ 只改字段声明而漏掉 [getOrCreateKey] 内部那一处，等于同一模块里
   * 存在两个 KeyStore 实例、每次 `encrypt` 仍重新 `load(null)`，优化落空。
   *
   * ⚠️ AndroidKeyStore 的 `KeyStore` 实例**非线程安全**——下方 executor 是单线程
   * ⇒ 安全。**若将来有人加第二个线程，此项必须回退。**
   */
  private val keyStore: KeyStore by lazy {
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  }

  /**
   * 加解密跑在模块自己的单线程 executor 上（2026-10-01，与 `TokenizerModule` 同款事故修法）：
   *
   * `@ReactMethod` 默认在 RN 的 NativeModules 队列上**内联**执行，而
   * `KeyStore.load(null)` / 冷路径 `KeyGenerator.generateKey()` 是**阻塞式系统调用**
   * （要跨 keystore2 守护进程，硬件支持时走 TEE/StrongBox，实测普遍百毫秒到秒级）
   * ⇒ 它把同队列上的其它原生调用一起堵住。
   *
   * 受害面写窄：主路径上 `model-request.service.ts` 在 `adapter.chat(...)`（sseConnect）
   * **之前** `await resolveProviderApiKey(...)`（内含 sksp `decrypt`）⇒ sksp 与本流的
   * sseConnect 是**串行前置、不是队列争用**；真正的受害面是**同队列上的并发原生调用**
   * ——①另一次 `sseAbort`（用户点「停止」失灵）、②另一条并发的 sseConnect、③tokenizer 计数。
   *
   * 单线程而非线程池：KeyStore 句柄按串行使用最稳。JS 侧本就 await Promise，
   * 换线程对调用方完全透明。
   *
   * 生命周期：与 `TokenizerModule` **完全同款**——依赖 daemon 线程随进程回收，
   * **不做** `invalidate()` 覆写、不调 `executor.shutdownNow()`（不是漏项）。
   */
  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "nm-sksp").apply { isDaemon = true }
  }

  /** 仅 debuggable 构建输出线程名日志，供真机 logcat 核对「不再内联」。 */
  private val debugLoggable: Boolean by lazy {
    (reactApplicationContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
  }

  private fun debugLog(message: String) {
    if (!debugLoggable) {
      return
    }
    try {
      Log.d(TAG, message)
    } catch (_: Throwable) {
    }
  }

  private fun aliasForRef(ref: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(ref.toByteArray(Charsets.UTF_8))
    val hex = digest.joinToString("") { "%02x".format(it) }.take(16)
    return "nm_sksp_$hex"
  }

  private fun getOrCreateKey(alias: String): SecretKey {
    val existing = keyStore.getKey(alias, null) as? SecretKey
    if (existing != null) {
      return existing
    }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    val spec = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .build()
    gen.init(spec)
    return gen.generateKey()
  }

  @ReactMethod
  fun encrypt(ref: String, plain: String, promise: Promise) {
    debugLog("thread=${Thread.currentThread().name} callerThread op=encrypt")
    executor.execute {
      // 线程名日志必须落在 executor 块内：`executor.execute { … }` 只是把工作**提交**
      // 出去就返回，字符串插值若在提交前求值，此刻仍在 RN NativeModules 队列线程上，
      // 打出来的永远是 mqt_native_modules / mqt_js，真机 logcat 永远拿不到 nm-sksp
      // ⇒ 「nm-sksp 线程名在位」这条验收牙齿会给出「修复没生效」的反向假信号。
      // 上一行的 callerThread= 只作对照，判据以本行的 thread=nm-sksp op=encrypt 为准。
      debugLog("thread=${Thread.currentThread().name} op=encrypt")
      try {
        val alias = aliasForRef(ref)
        val key = getOrCreateKey(alias)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val map = WritableNativeMap()
        map.putString("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
        map.putString("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
        promise.resolve(map)
      } catch (e: Exception) {
        promise.reject("ENCRYPT_FAILED", e.message, e)
      }
    }
  }

  @ReactMethod
  fun decrypt(ref: String, ciphertextB64: String, ivB64: String, promise: Promise) {
    debugLog("thread=${Thread.currentThread().name} callerThread op=decrypt")
    executor.execute {
      // 同 encrypt：判据行必须在 executor 块内，理由见上。
      debugLog("thread=${Thread.currentThread().name} op=decrypt")
      try {
        val alias = aliasForRef(ref)
        val key = keyStore.getKey(alias, null) as? SecretKey
          ?: throw IllegalStateException("Keystore key missing for ref")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val iv = Base64.decode(ivB64, Base64.NO_WRAP)
        val spec = GCMParameterSpec(128, iv)
        cipher.init(Cipher.DECRYPT_MODE, key, spec)
        val plainBytes = cipher.doFinal(Base64.decode(ciphertextB64, Base64.NO_WRAP))
        promise.resolve(String(plainBytes, Charsets.UTF_8))
      } catch (e: Exception) {
        promise.reject("DECRYPT_FAILED", e.message, e)
      }
    }
  }

  companion object {
    /** debugLog 的 logcat tag。 */
    const val TAG = "nm-sksp"
  }
}
