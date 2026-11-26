/**
 * SKSP error types.
 *
 * @module infra/sksp/sksp-error
 */

/** Discriminant codes for {@link SkspError}. */
export type SkspErrorCode = "NOT_REGISTERED" | "ENCRYPT_FAILED" | "DECRYPT_FAILED" | "DB_ERROR" | "INVALID_REF";

/**
 * Unified error for SKSP driver and composite operations.
 */
export class SkspError extends Error {
    readonly code: SkspErrorCode;
    readonly ref?: string;
    readonly cause?: unknown;

    constructor(code: SkspErrorCode, message: string, options?: { ref?: string; cause?: unknown }) {
        super(message);
        this.name = "SkspError";
        this.code = code;
        this.ref = options?.ref;
        this.cause = options?.cause;
    }
}

const MAX_REF_LENGTH = 512;

/**
 * SKSP secret ref 校验（与 {@link SkspError} 同文件的轻量断言面）。
 */
export const SkspRefAssert = {
    /** Validates opaque secret ref before DB / crypto operations. */
    validRef(ref: string): void {
        if (ref.length === 0 || ref.length > MAX_REF_LENGTH || ref.includes("\0")) {
            // nm-throw: keep — SKSP 的 SkspCryptoStrategy / SecretStore 端口是 Promise reject 契约（sksp-strategy.port.ts、secret-store.port.ts 签名都不是 Result），兄弟实现同口径；最终由桌面 provider IPC handler 的 catch 收口
            throw new SkspError("INVALID_REF", `Invalid secret ref: ${ref}`, { ref });
        }
    },
} as const;
