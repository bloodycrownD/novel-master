/**
 * Platform SKSP driver registration for the desktop main process.
 * Invariant: call once per process before opening the DB connection.
 */
import { SkspMacRegister } from "@novel-master/sksp-mac";
import { SkspWindowsRegister } from "@novel-master/sksp-windows";
import { SkspLinuxRegister } from "@novel-master/sksp-linux";
import { SkspPlatform, type PlatformSkspName } from "@novel-master/core/sksp";
import { type AppError, Result } from "@novel-master/core/errors";

export type { PlatformSkspName };

// nm-style 注记：文件名 register- 动词前缀，按内容主体起名（DesktopSksp，镜像 mobile mobile-sksp.ts 的 MobileSksp）。
export namespace DesktopSksp {
  /**
   * 解析当前进程对应的 SKSP driver 名称。
   * 纯逻辑放在 core 的 `SkspPlatform.resolveName`，这里只负责把
   * Node 的 `process.platform` 显式注入进去——RN 下 `process.platform`
   * 没有 shim（见 apps/mobile/src/polyfills.ts），所以 core 端不做隐式读取。
   */
  export function getName(): Result<PlatformSkspName, AppError> {
    return SkspPlatform.resolveName(process.platform);
  }

  /** Registers the OS-appropriate SKSP driver and returns its registry name. */
  // nm-style: keep-local — runtime.test 直引断言平台驱动注册（4 个调用点）；内联会破坏测试锁名。
  export function registerDriver(): Result<PlatformSkspName, AppError> {
    const name = getName();
    if (!name.ok) return name;
    if (name.value === "macos") {
      SkspMacRegister.register();
    } else if (name.value === "linux") {
      SkspLinuxRegister.register();
    } else {
      SkspWindowsRegister.register();
    }
    return name;
  }
}
