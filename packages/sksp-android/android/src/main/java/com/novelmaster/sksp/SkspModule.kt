package com.novelmaster.sksp

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.security.MessageDigest

class SkspModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SkspModule"

  private fun aliasForRef(ref: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(ref.toByteArray(Charsets.UTF_8))
    val hex = digest.joinToString("") { "%02x".format(it) }.take(16)
    return "nm_sksp_$hex"
  }

  private fun getOrCreateKey(alias: String): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = ks.getKey(alias, null) as? SecretKey
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

  @ReactMethod
  fun decrypt(ref: String, ciphertextB64: String, ivB64: String, promise: Promise) {
    try {
      val alias = aliasForRef(ref)
      val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      val key = ks.getKey(alias, null) as? SecretKey
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
