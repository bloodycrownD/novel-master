/**
 * 平台 → SKSP driver 名称解析。
 *
 * 之所以抽成纯函数（caller 显式注入 platform 字符串），是因为 RN 下
 * `process.platform` 并没有被 shim（见 apps/mobile/src/polyfills.ts），
 * 在 mobile bundle 里直接读会拿到 undefined。各端调用方自己把
 * `process.platform`（Node 环境）或对应平台字符串传进来即可。
 *
 * @module infra/sksp/logic/platform
 */

/** 平台对应的 SKSP driver 名称。 */
export type PlatformSkspName = "windows" | "macos" | "linux";

/**
 * 把 `process.platform` 风格的字符串解析成 SKSP driver 名称。
 *
 * - `darwin`  → `macos`
 * - `win32`   → `windows`
 * - `linux`   → `linux`
 * - 其它平台 → 抛错
 *
 * @throws {Error} 传入的 platform 没有对应的 SKSP driver
 */
export function resolveSkspNameFromPlatform(
  platform: string,
): PlatformSkspName {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      throw new Error(
        `Unsupported SKSP platform: ${platform}（暂无对应的 driver）`,
      );
  }
}
