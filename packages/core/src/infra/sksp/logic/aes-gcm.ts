/**
 * AES-256-GCM 加解密（Linux Secret Service / macOS Keychain 共用）。
 *
 * ciphertext 尾部固定附加 16 字节 GCM tag；iv 12 字节。
 *
 * @module infra/sksp/logic/aes-gcm
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SkspError } from "../sksp-error.js";

const IV_BYTES = 12;
const TAG_BYTES = 16;

export const AesGcm = {
    /** Encrypts UTF-8 plaintext with AES-256-GCM. @throws SkspError ENCRYPT_FAILED */
    encrypt: (plain: string, masterKey: Uint8Array, ref: string): { ciphertext: Uint8Array; iv: Uint8Array } => {
        try {
            const iv = randomBytes(IV_BYTES);
            const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
            const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
            const tag = cipher.getAuthTag();
            return { ciphertext: new Uint8Array(Buffer.concat([enc, tag])), iv: new Uint8Array(iv) };
        } catch (cause) {
            // nm-throw: keep — SKSP 的 SkspCryptoStrategy / SecretStore 端口是 Promise reject 契约（sksp-strategy.port.ts、secret-store.port.ts 签名都不是 Result），兄弟实现同口径；最终由桌面 provider IPC handler 的 catch 收口
            throw new SkspError("ENCRYPT_FAILED", `AES encrypt failed for ${ref}`, { ref, cause });
        }
    },

    /** Decrypts AES-256-GCM ciphertext to UTF-8. @throws SkspError DECRYPT_FAILED */
    decrypt: (ciphertext: Uint8Array, iv: Uint8Array, masterKey: Uint8Array, ref: string): string => {
        try {
            const buf = Buffer.from(ciphertext);
            if (buf.length < TAG_BYTES) {
                // nm-throw: keep — OS 加密解密边界：密文短于 GCM tag 属输入损坏检错，随即由 SkspError 收口。
                throw new Error("ciphertext too short");
            }
            const tag = buf.subarray(buf.length - TAG_BYTES);
            const enc = buf.subarray(0, buf.length - TAG_BYTES);
            const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
        } catch (cause) {
            // nm-throw: keep — SKSP 的 SkspCryptoStrategy / SecretStore 端口是 Promise reject 契约（sksp-strategy.port.ts、secret-store.port.ts 签名都不是 Result），兄弟实现同口径；最终由桌面 provider IPC handler 的 catch 收口
            throw new SkspError("DECRYPT_FAILED", `AES decrypt failed for ${ref}. Re-run: nm provider edit --apiKey`, { ref, cause });
        }
    },
} as const;
