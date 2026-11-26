/**
 * SKSP Node 工厂：AES-GCM 策略与钥匙串主密钥（Linux Secret Service /
 * macOS Keychain 共用）。
 *
 * 只经 `infra/sksp/node.ts` 暴露——本文件及其依赖（`logic/aes-gcm`、
 * `logic/row-binary`）引用了 `node:crypto` 与 Node 全局 `Buffer`，禁止进入
 * `./sksp-factory.js` / `infra/sksp/index.ts` 的依赖闭包（RN bundle 会解析
 * 失败，见 `infra/sksp/node.ts` 头注释）。
 *
 * @module infra/sksp/impl/sksp-node-factory
 */

import { randomBytes } from "node:crypto";
import type { Row } from "../../tdbc/types.js";
import { AesGcm } from "../logic/aes-gcm.js";
import { SkspRowBinary } from "../logic/row-binary.js";
import { SkspError, type SkspErrorCode } from "../sksp-error.js";
import type { SkspCryptoStrategy } from "./sksp-strategy.port.js";

const USER = "sksp-master-v1";
const MASTER_KEY_BYTES = 32;

/** 平台主密钥来源：按操作取 32 字节主密钥。 */
type MasterKeySource = (ref: string, operation: "encrypt" | "decrypt") => Promise<Uint8Array>;

interface AesGcmStrategyOptions {
    /** 对应 `sksp_secrets.algo` 列（各平台自有的版本标识）。 */
    readonly algo: string;
    readonly masterKey: MasterKeySource;
}

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

export const SkspNodeFactory = {
    /** 拼装 AES-GCM 策略：取主密钥 → 加解密；ciphertext/iv 以 Uint8Array 存库。 */
    createAesGcmStrategy({ algo, masterKey }: AesGcmStrategyOptions): SkspCryptoStrategy {
        return {
            algo,
            async encrypt(ref, plain) {
                const key = await masterKey(ref, "encrypt");
                return AesGcm.encrypt(plain, key, ref);
            },
            async decrypt(ref, row: Row) {
                const key = await masterKey(ref, "decrypt");
                return AesGcm.decrypt(SkspRowBinary.ciphertext(row), SkspRowBinary.iv(row, ref), key, ref);
            },
        };
    },

    createKeyringMasterKey({ service, label, displayName, platform, open }: KeyringMasterKeyOptions): KeyringMasterKey {
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
                    // nm-throw: keep — SKSP 的 SkspCryptoStrategy / SecretStore 端口是 Promise reject 契约（sksp-strategy.port.ts、secret-store.port.ts 签名都不是 Result），兄弟实现同口径；最终由桌面 provider IPC handler 的 catch 收口
                    throw new SkspError(operation === "encrypt" ? "ENCRYPT_FAILED" : "DECRYPT_FAILED", operation === "encrypt" ? `${displayName} is only available on ${platform}` : `${displayName} decrypt failed for ${ref} (not on ${platform}). Re-run: nm provider edit --apiKey`, { ref });
                }
                const code: SkspErrorCode = operation === "encrypt" ? "ENCRYPT_FAILED" : "DECRYPT_FAILED";
                try {
                    const entry = await open(service, USER);
                    const existing = entry.getPassword();
                    if (existing != null) {
                        const buf = Buffer.from(existing, "base64");
                        if (buf.length !== MASTER_KEY_BYTES) {
                            // nm-throw: keep — SKSP 的 SkspCryptoStrategy / SecretStore 端口是 Promise reject 契约（sksp-strategy.port.ts、secret-store.port.ts 签名都不是 Result），兄弟实现同口径；最终由桌面 provider IPC handler 的 catch 收口
                            throw new SkspError("DECRYPT_FAILED", `Invalid master key in ${label} for ${ref}. Re-run: nm provider edit --apiKey`, { ref });
                        }
                        return new Uint8Array(buf);
                    }
                    const key = randomBytes(MASTER_KEY_BYTES);
                    entry.setPassword(Buffer.from(key).toString("base64"));
                    return new Uint8Array(key);
                } catch (cause) {
                    if (cause instanceof SkspError) {
                        // nm-throw: keep — SKSP 的 SkspCryptoStrategy / SecretStore 端口是 Promise reject 契约（sksp-strategy.port.ts、secret-store.port.ts 签名都不是 Result），兄弟实现同口径；最终由桌面 provider IPC handler 的 catch 收口
                        throw cause;
                    }
                    // nm-throw: keep — SKSP 的 SkspCryptoStrategy / SecretStore 端口是 Promise reject 契约（sksp-strategy.port.ts、secret-store.port.ts 签名都不是 Result），兄弟实现同口径；最终由桌面 provider IPC handler 的 catch 收口
                    throw new SkspError(code, code === "ENCRYPT_FAILED" ? `${label} access failed for ${ref}` : `${label} access failed for ${ref}. Re-run: nm provider edit --apiKey`, { ref, cause });
                }
            },
        };
    },
} as const;
