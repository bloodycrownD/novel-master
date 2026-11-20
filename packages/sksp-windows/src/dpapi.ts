/**
 * Windows DPAPI encrypt/decrypt wrapper.
 *
 * @module dpapi
 */

import { SkspError } from "@novel-master/core/sksp";

/** DPAPI 旁路开关（模块内 holder，对象管理）：测试钩子状态。 */
const dpapiFlags = {
  /** Test hook: bypass DPAPI (UTF-8 passthrough as "ciphertext"). @internal */
  testPassthrough: false,
};

export namespace Dpapi {
  /** Enables passthrough mode for non-Windows unit tests. @internal */
  export function setTestPassthrough(enabled: boolean): void {
    dpapiFlags.testPassthrough = enabled;
  }

  function isWin32(): boolean {
    return process.platform === "win32";
  }

  /**
   * Protects UTF-8 plaintext with DPAPI (current user).
   * @throws SkspError ENCRYPT_FAILED on failure
   */
  export async function protect(plain: string, ref: string): Promise<Uint8Array> {
    const data = Buffer.from(plain, "utf8");
    if (dpapiFlags.testPassthrough) {
      return new Uint8Array(data);
    }
    if (!isWin32()) {
      throw new SkspError("ENCRYPT_FAILED", "DPAPI is only available on Windows", { ref },);
    }
    try {
      const { Dpapi, isPlatformSupported } = await import("@primno/dpapi");
      if (!isPlatformSupported) {
        // nm-throw: keep — OS 加密平台边界：DPAPI 能力探测失败，随即由 SkspError 收口。
        throw new Error("DPAPI platform not supported");
      }
      return Dpapi.protectData(data, null, "CurrentUser");
    } catch (cause) {
      throw new SkspError("ENCRYPT_FAILED", `DPAPI encrypt failed for ${ref}`, {
        ref,
        cause,
      });
    }
  }

  /**
   * Unprotects DPAPI ciphertext to UTF-8 string.
   * @throws SkspError DECRYPT_FAILED on failure
   */
  export async function unprotect(ciphertext: Uint8Array, ref: string,): Promise<string> {
    if (dpapiFlags.testPassthrough) {
      return Buffer.from(ciphertext).toString("utf8");
    }
    if (!isWin32()) {
      throw new SkspError("DECRYPT_FAILED", `DPAPI decrypt failed for ${ref} (not on Windows). Re-run: nm provider edit --apiKey`, { ref },);
    }
    try {
      const { Dpapi, isPlatformSupported } = await import("@primno/dpapi");
      if (!isPlatformSupported) {
        // nm-throw: keep — OS 加密平台边界：DPAPI 能力探测失败，随即由 SkspError 收口。
        throw new Error("DPAPI platform not supported");
      }
      const out = Dpapi.unprotectData(Buffer.from(ciphertext), null, "CurrentUser");
      return Buffer.from(out).toString("utf8");
    } catch (cause) {
      throw new SkspError("DECRYPT_FAILED", `DPAPI decrypt failed for ${ref}. Re-run: nm provider edit --apiKey`, { ref, cause },);
    }
  }
}
