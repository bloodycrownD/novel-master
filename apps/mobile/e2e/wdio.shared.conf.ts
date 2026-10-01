import fs from 'node:fs';
import path from 'node:path';

const mobileRoot = path.resolve(process.cwd());
const e2eRoot = path.join(mobileRoot, 'e2e');
/** Project-local Appium extensions — must match ensure-appium-driver.mjs */
const appiumHome = path.join(mobileRoot, '.appium');
// @wdio/appium-service only forwards process.env to the Appium child (ignores service `env`).
process.env.APPIUM_HOME = appiumHome;
/**
 * Appium 监听端口。
 *
 * 默认 4723；并行跑第二轮（或别的会话正在占着 4723）时用 `APPIUM_PORT=4725 npm run e2e`
 * 换一个端口，避免两个 Appium 抢同一个端口把 session 搅乱。端口只影响服务监听，
 * 不需要 adb 反向端口映射。
 */
const appiumPort = Number(process.env.APPIUM_PORT ?? 4723);
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
  //
  // 与下一条 forceAppLaunch **不冲突**：红线禁的是「卸载 / 清数据」（不可逆、毁用户
  // 实际数据），而 forceAppLaunch 是 terminateApp + activateApp —— 只把进程杀掉再冷启，
  // 碰的是内存里的进程状态，不动沙盒里的任何文件/数据库。所以两者可以同时开。
  base['appium:noReset'] = true;
  // 2026-10-01 e2e 实跑实锤：app 进程跨 spec 存活时，UI 操作会间歇性「集体失效」
  // （Appium findElement 对一切新元素超时；渲染/输入本身正常——像素对比证实点击
  // 生效、a11y dump 偶尔回旧树；force-stop 冷启动后恢复）。失效不跟某条 spec 走，
  // 而是跟「存活进程」走。forceAppLaunch 让每个 spec 开工前都 terminateApp +
  // activateApp 冷启动，把失效态隔离在单条 spec 内（代价：每条 spec 多 ~20s）。
  base['appium:forceAppLaunch'] = true;
  // 专用设备绑定：同时连着多台（真机 + 模拟器 + 并行会话的 AVD）时，Appium 选设备是
  // 不确定的——用 `E2E_UDID`（或已有的 `ANDROID_SERIAL`）钉死一台，省得跑到别人机器上。
  // 不设就沿用 Appium 默认选择（单设备环境行为不变）。
  const udid = process.env.E2E_UDID ?? process.env.ANDROID_SERIAL;
  if (udid != null && udid !== '') {
    base['appium:udid'] = udid;
  }
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
          port: appiumPort,
          relaxedSecurity: true,
        },
      },
    ],
  ],
  /**
   * teardown 期的兜底（r6-ENV1）。
   *
   * 实跑里每条 spec 收尾会刷 `DeadObjectException` 断连噪音——它**不影响断言**，
   * 但会把绿 spec 的日志淹掉，排障时真假难辨。这里的原则是：**收尾期的任何异常都
   * 一律吞掉，绝不让它把绿 spec 标红**。
   *
   * 三处断连噪音的归属（查过源码，不重复包）：
   * 1. kill Appium 进程树 / 超时强杀 —— `@wdio/appium-service` 自己的 `onComplete`
   *    已经整体包了 try/catch（`node_modules/@wdio/appium-service/build/index.js`），
   *    **已内建处理，这里不再包第二层**。
   * 2. `browser.deleteSession()` —— `@wdio/runner` 的 `endSession()` 直接 await 它
   *    且**没有** try/catch（`node_modules/@wdio/runner/build/index.js`），但它跑在
   *    **worker 进程内、且在 `afterSession` 钩子之前**——config 层的 `onComplete`
   *    根本排在它之后，**够不着**，包了也拦不住，只能当噪音看待。
   * 3. 因此本钩子只做自己那点收尾记录（确认端口已释放，方便下一轮换端口并行时区分
   *    「端口被占」与「设备没连上」），并且自带 try/catch 兜底。
   */
  onComplete() {
    try {
      console.log(`[e2e] run finished, Appium port ${appiumPort} released.`);
    } catch (err) {
      // 收尾期任何异常都不允许影响 spec 结果。
      console.warn('[e2e] onComplete teardown warning (ignored):', err);
    }
  },
};
