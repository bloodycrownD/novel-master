/**
 * Cross-platform RFC4122 v4 UUID generation (Node, RN Hermes, browsers).
 *
 * @module infra/random-uuid
 */

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns an RFC4122 version 4 UUID string.
 *
 * Prefers {@link Crypto.randomUUID} when available; falls back to a pure-JS
 * generator using `crypto.getRandomValues` or, as a last resort, `Math.random`.
 */
export function randomUUID(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj != null && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return fallbackRandomUUID();
}

/** Validates RFC4122 v4 UUID format (for tests and callers). */
export function isRandomUuidV4(value: string): boolean {
  return UUID_V4_RE.test(value);
}

function fallbackRandomUUID(): string {
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
}
