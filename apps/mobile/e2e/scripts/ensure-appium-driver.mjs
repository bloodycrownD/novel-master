#!/usr/bin/env node
/**
 * Ensure UiAutomator2 is installed for the **project-local** Appium (APPIUM_HOME).
 * WDIO spawns node_modules/appium — drivers must live under the same APPIUM_HOME.
 */
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const mobileRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const appiumHome = path.join(mobileRoot, '.appium');

fs.mkdirSync(appiumHome, {recursive: true});

const env = {...process.env, APPIUM_HOME: appiumHome};

/**
 * 钉死的 UiAutomator2 版本（r6-ENV1）。
 *
 * 为什么必须钉：本仓 `package.json` 的 appium 是 `^2.18`、WDIO 是 9，而 uiautomator2
 * 的最新版要求 Appium 3——不钉的话 `npm i` 之后 `appium driver install uiautomator2`
 * 会随时间装到不同大版本，跑出「昨天能跑今天不能」的薛定谔环境。钉死一版、升级另开
 * 一次单独验证，别混在日常 e2e 里悄悄漂。
 *
 * 注意：这只在**安装**时用是不够的——已装目录存在 ≠ 版本对，所以下面的
 * {@link driverVersion} 要参与判断，否则「已装的是别的版本」会被静默放行。
 */
const UIAUTOMATOR2_VERSION = '3.9.4';

/** 已装驱动的版本号；没装返回 null。 */
function driverVersion() {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(
          appiumHome,
          'node_modules',
          'appium-uiautomator2-driver',
          'package.json',
        ),
        'utf8',
      ),
    ).version;
  } catch {
    return null;
  }
}

const installedVersion = driverVersion();
if (installedVersion === UIAUTOMATOR2_VERSION) {
  console.log(
    `[e2e] UiAutomator2 driver ready (${UIAUTOMATOR2_VERSION}) at ${appiumHome}`,
  );
  process.exit(0);
}
if (installedVersion != null) {
  console.log(
    `[e2e] UiAutomator2 driver version drift: installed ${installedVersion}, ` +
      `pinned ${UIAUTOMATOR2_VERSION} — reinstalling.`,
  );
}

console.log(
  `[e2e] Installing UiAutomator2@${UIAUTOMATOR2_VERSION} into ${appiumHome} ...`,
);
execSync(`npx appium driver install uiautomator2@${UIAUTOMATOR2_VERSION}`, {
  stdio: 'inherit',
  env,
  cwd: mobileRoot,
});

const actual = driverVersion();
if (actual !== UIAUTOMATOR2_VERSION) {
  throw new Error(
    `UiAutomator2 driver install failed (want ${UIAUTOMATOR2_VERSION}, ` +
      `got ${actual ?? 'none'}) — run: npm run mobile:e2e:prepare`,
  );
}

console.log(`[e2e] UiAutomator2 driver installed (${UIAUTOMATOR2_VERSION}).`);
