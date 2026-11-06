package com.novelmaster

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.novelmaster.sksp.SkspPackage
import com.novelmaster.tokenizer.TokenizerPackage
import com.novelmaster.log.NmLogCrashHandler
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Local monorepo packages: explicit add() mirrors @novel-master/sksp-android.
          // PackageList autolink may not always include workspace project packages reliably.
          add(SkspPackage())
          add(TokenizerPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // 崩溃钩子必须在 loadReactNative 之前装：JS 引擎起不来时的崩溃也要留痕。
    NmLogCrashHandler.install(this)
    loadReactNative(this)
  }
}
