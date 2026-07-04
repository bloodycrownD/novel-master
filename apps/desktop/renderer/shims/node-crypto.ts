/** Browser shim for core dist modules that import node:crypto (randomUUID). */
export const randomUUID = (): string => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  throw new Error("crypto.randomUUID is unavailable in this environment");
};
