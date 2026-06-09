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
  if (fs.existsSync(debugApk)) {
    base['appium:app'] = debugApk;
  } else {
    // Use already-installed debug build (e.g. from npm run mobile:android).
    console.warn(
      `[e2e] Debug APK not found at ${debugApk} — launching installed app via appPackage.`,
    );
    base['appium:noReset'] = true;
  }
  return base;
}

/** Forward slashes — WDIO glob on Windows needs this for default specs discovery. */
const specGlob = path.join(e2eRoot, 'specs', '**', '*.e2e.ts').replace(/\\/g, '/');

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
