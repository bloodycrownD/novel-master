import fs from 'node:fs';
import path from 'node:path';

const mobileRoot = path.resolve(process.cwd());
const e2eRoot = path.join(mobileRoot, 'e2e');
/** Project-local Appium extensions — must match ensure-appium-driver.mjs */
const appiumHome = path.join(mobileRoot, '.appium');
// @wdio/appium-service only forwards process.env to the Appium child (ignores service `env`).
process.env.APPIUM_HOME = appiumHome;
const debugApk = path.join(
  mobileRoot,
  'android/app/build/outputs/apk/debug/app-debug.apk',
);

function androidCapabilities(): Record<string, unknown> {
  const base: Record<string, unknown> = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': 'Android Emulator',
    'appium:appPackage': 'com.novelmaster',
    'appium:appActivity': 'com.novelmaster.MainActivity',
    'appium:autoGrantPermissions': true,
    'appium:newCommandTimeout': 240,
  };
  // 协作红线（2026-09-29 用户拍板）：任何设备（真机/模拟器）一律禁止卸载或清除应用数据。
  // 一律 noReset:true——即使下方提供 appium:app 走安装，Appium 也不会卸载/清数据。
  // 代价：spec 间应用状态会残留（旧「每条 spec 重装清数据」的隔离手段随之失效），
  // 测试隔离改由 spec 自建自清（UI 内删除），与 wave-6b 的页对象更新一并处理。
  base['appium:noReset'] = true;
  if (fs.existsSync(debugApk)) {
    base['appium:app'] = debugApk;
  } else {
    // Use already-installed debug build (e.g. from npm run mobile:android).
    console.warn(
      `[e2e] Debug APK not found at ${debugApk} — launching installed app via appPackage.`,
    );
  }
  return base;
}

/** Forward slashes — WDIO glob on Windows needs this for default specs discovery. */
const specGlob = path
  .join(e2eRoot, 'specs', '**', '*.e2e.ts')
  .replace(/\\/g, '/');

export const sharedConfig = {
  runner: 'local' as const,
  specs: [specGlob],
  /** Relative to wdio.conf.ts (same e2e/ directory). */
  setupFilesAfterEnv: ['./setup.ts'],
  exclude: [],
  maxInstances: 1,
  logLevel: 'info' as const,
  bail: 0,
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  framework: 'mocha' as const,
  reporters: ['spec' as const],
  mochaOpts: {
    ui: 'bdd' as const,
    timeout: 180000,
  },
  capabilities: [androidCapabilities()],
  services: [
    [
      'appium',
      {
        args: {
          relaxedSecurity: true,
        },
      },
    ],
  ],
};
