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

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

/** 平台对应的 SKSP driver 名称。 */
export type PlatformSkspName = "windows" | "macos" | "linux";

/**
 * 平台字符串 → SKSP driver 名称。
 */
export const SkspPlatform = {
    /**
   * 把 `process.platform` 风格的字符串解析成 SKSP driver 名称。
   *
   * - `darwin`  → `macos`
   * - `win32`   → `windows`
   * - `linux`   → `linux`
   * - 其它平台 → `Result.err`（INFRA_UNSUPPORTED_PLATFORM）
   */
    resolveName(platform: string): Result<PlatformSkspName, AppError> {
        switch (platform) {
            case "darwin":
                return Result.ok("macos");
            case "win32":
                return Result.ok("windows");
            case "linux":
                return Result.ok("linux");
            default:
                return Result.err(new AppError("INFRA_UNSUPPORTED_PLATFORM", { detail: `Unsupported SKSP platform: ${platform}（暂无对应的 driver）` }));
        }
    },
} as const;
