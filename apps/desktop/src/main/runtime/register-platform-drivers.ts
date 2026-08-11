/**
 * Platform SKSP driver registration for the desktop main process.
 * Invariant: call once per process before opening the DB connection.
 */
import { registerSkspMacDriver } from "@novel-master/sksp-mac";
import { registerSkspWindowsDriver } from "@novel-master/sksp-windows";
import { registerSkspLinuxDriver } from "@novel-master/sksp-linux";
import {
  resolveSkspNameFromPlatform,
  type PlatformSkspName,
} from "@novel-master/core/sksp";

export type { PlatformSkspName };

/**
 * 解析当前进程对应的 SKSP driver 名称。
 * 纯逻辑放在 core 的 `resolveSkspNameFromPlatform`，这里只负责把
 * Node 的 `process.platform` 显式注入进去——RN 下 `process.platform`
 * 没有 shim（见 apps/mobile/src/polyfills.ts），所以 core 端不做隐式读取。
 */
export function getPlatformSkspName(): PlatformSkspName {
  return resolveSkspNameFromPlatform(process.platform);
}

/** Registers the OS-appropriate SKSP driver and returns its registry name. */
export function registerPlatformSkspDriver(): PlatformSkspName {
  const name = getPlatformSkspName();
  if (name === "macos") {
    registerSkspMacDriver();
  } else if (name === "linux") {
    registerSkspLinuxDriver();
  } else {
    registerSkspWindowsDriver();
  }
  return name;
}
