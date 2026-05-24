package com.novelmaster

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.novelmaster.sksp.SkspPackage
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // SKSP native module (Keystore); also autolinked via @novel-master/sksp-android.
          add(SkspPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
