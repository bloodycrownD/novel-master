/** Browser shim for core dist modules that import node:crypto (randomUUID). */
export const randomUUID = (): string => {
    if (typeof globalThis.crypto?.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    // nm-throw: keep — 浏览器 shim 的平台边界：宿主既无 node:crypto 也无 Web Crypto 时无法提供 randomUUID。
    throw new Error("crypto.randomUUID is unavailable in this environment");
};
