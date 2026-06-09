import path from 'node:path';

const mobileRoot = path.resolve(process.cwd());
const debugApk = path.join(
  mobileRoot,
  'android/app/build/outputs/apk/debug/app-debug.apk',
);

export const sharedConfig = {
  runner: 'local' as const,
  specs: ['./e2e/specs/**/*.e2e.ts'],
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
  capabilities: [
    {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'Android Emulator',
      'appium:appPackage': 'com.novelmaster',
      'appium:appActivity': 'com.novelmaster.MainActivity',
      'appium:app': debugApk,
      'appium:autoGrantPermissions': true,
      'appium:newCommandTimeout': 240,
    },
  ],
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
