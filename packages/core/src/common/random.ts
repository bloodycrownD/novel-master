/**
 * Cross-platform RFC4122 v4 UUID generation (Node, RN Hermes, browsers).
 *
 * 放在 `common/` 而不是 `infra/`：它只认识 `globalThis.crypto`（标准 Web API），
 * 不认识任何基础设施（DB / fetch / fs / 平台分支）。
 *
 * @module common/random
 */

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const Random = {
    /**
     * RFC4122 version 4 UUID。
     *
     * 优先 `crypto.randomUUID`；缺失时用 `crypto.getRandomValues` 的纯 JS 生成器；
     * 都缺失时退回 `Math.random`（旧运行时，**非密码学强度**）。
     */
    uuid: (): string => {
        const cryptoObj = globalThis.crypto;
        if (cryptoObj != null && typeof cryptoObj.randomUUID === "function") {
            return cryptoObj.randomUUID();
        }
        const bytes = new Uint8Array(16);
        if (globalThis.crypto?.getRandomValues != null) {
            // Hermes/polyfilled environments may expose getRandomValues without randomUUID.
            globalThis.crypto.getRandomValues(bytes);
        } else {
            // Last resort for legacy runtimes — IDs are not cryptographically strong.
            for (let i = 0; i < 16; i++) {
                bytes[i] = Math.floor(Math.random() * 256);
            }
        }
        bytes[6] = (bytes[6]! & 0x0f) | 0x40;
        bytes[8] = (bytes[8]! & 0x3f) | 0x80;
        const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },

    /** RFC4122 v4 格式校验（测试与调用方共用同一正则单源）。 */
    isUuidV4: (value: string): boolean => UUID_V4_RE.test(value),
} as const;
