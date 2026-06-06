/**
 * Platform SKSP driver registration for the desktop main process.
 * Invariant: call once per process before opening the DB connection.
 */
import { registerSkspMacDriver } from "@novel-master/sksp-mac";
import { registerSkspWindowsDriver } from "@novel-master/sksp-windows";

export type PlatformSkspName = "windows" | "macos";

export function getPlatformSkspName(): PlatformSkspName {
  return process.platform === "darwin" ? "macos" : "windows";
}

/** Registers the OS-appropriate SKSP driver and returns its registry name. */
export function registerPlatformSkspDriver(): PlatformSkspName {
  const name = getPlatformSkspName();
  if (name === "macos") {
    registerSkspMacDriver();
  } else {
    registerSkspWindowsDriver();
  }
  return name;
}
