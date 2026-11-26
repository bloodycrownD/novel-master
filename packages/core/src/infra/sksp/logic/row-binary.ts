/**
 * `sksp_secrets` 行的 ciphertext / iv 列解码：BLOB（Uint8Array）或 binary 文本。
 *
 * Android 的 base64 文本形态不走这里（见 sksp-android 的 decodeBlob）。
 *
 * @module infra/sksp/logic/row-binary
 */

import type { Row } from "../../tdbc/types.js";
import { SkspError } from "../sksp-error.js";

export const SkspRowBinary = {
    /** ciphertext 列：BLOB 原样返回，binary 文本转字节。 */
    ciphertext: (row: Row): Uint8Array => {
        const raw = row.ciphertext;
        if (raw instanceof Uint8Array) {
            return raw;
        }
        if (typeof raw === "string") {
            return new Uint8Array(Buffer.from(raw, "binary"));
        }
        // nm-throw: keep — SKSP 的 SkspCryptoStrategy / SecretStore 端口是 Promise reject 契约（sksp-strategy.port.ts、secret-store.port.ts 签名都不是 Result），兄弟实现同口径；最终由桌面 provider IPC handler 的 catch 收口
        throw new SkspError("DB_ERROR", "Invalid ciphertext column type");
    },

    /** iv 列：null 视为缺 IV；BLOB 原样返回，binary 文本转字节。 */
    iv: (row: Row, ref: string): Uint8Array => {
        const raw = row.iv;
        if (raw == null) {
            // nm-throw: keep — SKSP 的 SkspCryptoStrategy / SecretStore 端口是 Promise reject 契约（sksp-strategy.port.ts、secret-store.port.ts 签名都不是 Result），兄弟实现同口径；最终由桌面 provider IPC handler 的 catch 收口
            throw new SkspError("DECRYPT_FAILED", `Missing IV for ${ref}`, { ref });
        }
        if (raw instanceof Uint8Array) {
            return raw;
        }
        if (typeof raw === "string") {
            return new Uint8Array(Buffer.from(raw, "binary"));
        }
        // nm-throw: keep — SKSP 的 SkspCryptoStrategy / SecretStore 端口是 Promise reject 契约（sksp-strategy.port.ts、secret-store.port.ts 签名都不是 Result），兄弟实现同口径；最终由桌面 provider IPC handler 的 catch 收口
        throw new SkspError("DB_ERROR", "Invalid iv column type");
    },
} as const;
