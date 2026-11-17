/**
 * 钥匙串主密钥读写：Linux Secret Service / macOS Keychain 共用流程。
 *
 * 平台差异全部由配置注入——service 名、错误文案素材、平台名，以及钥匙串
 * 条目的打开方式（`open` 由各平台包注入，core 不直接依赖原生钥匙串模块）。
 * 错误文案按配置拼装，逐字继承各平台原文。
 *
 * @module infra/sksp/impl/keyring-master-key
 */

import { randomBytes } from "node:crypto";
import { SkspError, type SkspErrorCode } from "../sksp-error.js";

const USER = "sksp-master-v1";
const MASTER_KEY_BYTES = 32;

/** 平台钥匙串条目：只暴露主密钥流程用到的读写两件事。 */
interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
}

/** 打开（或创建）指定 service/user 的钥匙串条目。 */
type KeyringEntryOpener = (service: string, user: string) => Promise<KeyringEntry>;

/** 平台差异注入。 */
interface KeyringMasterKeyOptions {
  /** 钥匙串 service 名（Linux `novel-master-linux` / macOS `novel-master`）。 */
  readonly service: string;
  /** 文案里的钥匙串名（`Secret Service` / `Keychain`）。 */
  readonly label: string;
  /** 平台不可用错误里的完整称谓。 */
  readonly displayName: string;
  /** `process.platform` 取值（`linux` / `darwin`）。 */
  readonly platform: string;
  readonly open: KeyringEntryOpener;
}

/** 主密钥读写句柄。 */
interface KeyringMasterKey {
  /** Returns the 32-byte application master key from the keychain, creating it on first use. @throws SkspError ENCRYPT_FAILED / DECRYPT_FAILED on failure */
  getOrCreate(ref: string, operation: "encrypt" | "decrypt"): Promise<Uint8Array>;
  /** Test hook: bypass the keychain with a fixed in-memory master key. @internal */
  setTestPassthrough(enabled: boolean): void;
}

export function createKeyringMasterKey({ service, label, displayName, platform, open }: KeyringMasterKeyOptions): KeyringMasterKey {
  let testPassthrough = false;
  let testMasterKey: Uint8Array | undefined;

  return {
    setTestPassthrough(enabled) {
      testPassthrough = enabled;
      if (enabled && !testMasterKey) {
        testMasterKey = randomBytes(MASTER_KEY_BYTES);
      }
    },

    async getOrCreate(ref, operation) {
      if (testPassthrough) {
        if (!testMasterKey) {
          testMasterKey = randomBytes(MASTER_KEY_BYTES);
        }
        return testMasterKey;
      }
      if (process.platform !== platform) {
        throw new SkspError(operation === "encrypt" ? "ENCRYPT_FAILED" : "DECRYPT_FAILED", operation === "encrypt" ? `${displayName} is only available on ${platform}` : `${displayName} decrypt failed for ${ref} (not on ${platform}). Re-run: nm provider edit --apiKey`, { ref });
      }
      const code: SkspErrorCode = operation === "encrypt" ? "ENCRYPT_FAILED" : "DECRYPT_FAILED";
      try {
        const entry = await open(service, USER);
        const existing = entry.getPassword();
        if (existing != null) {
          const buf = Buffer.from(existing, "base64");
          if (buf.length !== MASTER_KEY_BYTES) {
            throw new SkspError("DECRYPT_FAILED", `Invalid master key in ${label} for ${ref}. Re-run: nm provider edit --apiKey`, { ref });
          }
          return new Uint8Array(buf);
        }
        const key = randomBytes(MASTER_KEY_BYTES);
        entry.setPassword(Buffer.from(key).toString("base64"));
        return new Uint8Array(key);
      } catch (cause) {
        if (cause instanceof SkspError) {
          throw cause;
        }
        throw new SkspError(code, code === "ENCRYPT_FAILED" ? `${label} access failed for ${ref}` : `${label} access failed for ${ref}. Re-run: nm provider edit --apiKey`, { ref, cause });
      }
    },
  };
}
