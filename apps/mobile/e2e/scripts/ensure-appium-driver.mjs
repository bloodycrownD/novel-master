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

function driverInstalled() {
  return fs.existsSync(
    path.join(appiumHome, 'node_modules', 'appium-uiautomator2-driver', 'package.json'),
  );
}

if (driverInstalled()) {
  console.log(`[e2e] UiAutomator2 driver ready (${appiumHome})`);
  process.exit(0);
}

// Pin 3.9.x — latest uiautomator2 requires Appium 3; we stay on Appium 2.x for WDIO 9.
const UIAutomator2_VERSION = '3.9.4';
console.log(
  `[e2e] Installing UiAutomator2@${UIAutomator2_VERSION} into ${appiumHome} ...`,
);
execSync(`npx appium driver install uiautomator2@${UIAutomator2_VERSION}`, {
  stdio: 'inherit',
  env,
  cwd: mobileRoot,
});

if (!driverInstalled()) {
  throw new Error('UiAutomator2 driver install failed — run: npm run mobile:e2e:prepare');
}

console.log('[e2e] UiAutomator2 driver installed.');
