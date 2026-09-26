package com.novelmaster.llmsse

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** 注册 {@link LlmSseModule}，供 JS 侧 {@code NativeModules.LlmSseNative} 访问。 */
class LlmSsePackage : ReactPackage {
  @Deprecated("Deprecated in RN bridgeless")
  @Suppress("DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(LlmSseModule(reactContext))
  }

  @Deprecated("Deprecated in RN bridgeless")
  @Suppress("DEPRECATION")
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
