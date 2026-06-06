/**
 * macOS Keychain master key storage and test passthrough.
 *
 * @module keychain
 */

import { randomBytes } from "node:crypto";
import { SkspError, type SkspErrorCode } from "@novel-master/core/sksp";

const SERVICE = "novel-master";
const USER = "sksp-master-v1";
const MASTER_KEY_BYTES = 32;

/** Test hook: bypass Keychain with a fixed in-memory master key. @internal */
let testPassthrough = false;
let testMasterKey: Uint8Array | undefined;

/** Enables passthrough mode for non-macOS unit tests. @internal */
export function setMacKeychainTestPassthrough(enabled: boolean): void {
  testPassthrough = enabled;
  if (enabled && !testMasterKey) {
    testMasterKey = randomBytes(MASTER_KEY_BYTES);
  }
}

function isDarwin(): boolean {
  return process.platform === "darwin";
}

function parseMasterKey(encoded: string, ref: string): Uint8Array {
  const buf = Buffer.from(encoded, "base64");
  if (buf.length !== MASTER_KEY_BYTES) {
    throw new SkspError(
      "DECRYPT_FAILED",
      `Invalid master key in Keychain for ${ref}. Re-run: nm provider edit --apiKey`,
      { ref },
    );
  }
  return new Uint8Array(buf);
}

function keychainError(
  code: SkspErrorCode,
  ref: string,
  cause: unknown,
): SkspError {
  const message =
    code === "ENCRYPT_FAILED"
      ? `Keychain access failed for ${ref}`
      : `Keychain access failed for ${ref}. Re-run: nm provider edit --apiKey`;
  return new SkspError(code, message, { ref, cause });
}

/**
 * Returns the 32-byte application master key from Keychain, creating it on first use.
 * @throws SkspError ENCRYPT_FAILED / DECRYPT_FAILED on failure
 */
export async function getOrCreateMasterKey(
  ref: string,
  operation: "encrypt" | "decrypt",
): Promise<Uint8Array> {
  if (testPassthrough) {
    if (!testMasterKey) {
      testMasterKey = randomBytes(MASTER_KEY_BYTES);
    }
    return testMasterKey;
  }
  if (!isDarwin()) {
    throw new SkspError(
      operation === "encrypt" ? "ENCRYPT_FAILED" : "DECRYPT_FAILED",
      operation === "encrypt"
        ? "macOS Keychain is only available on darwin"
        : `macOS Keychain decrypt failed for ${ref} (not on darwin). Re-run: nm provider edit --apiKey`,
      { ref },
    );
  }
  const code: SkspErrorCode =
    operation === "encrypt" ? "ENCRYPT_FAILED" : "DECRYPT_FAILED";
  try {
    const { Entry } = await import("@napi-rs/keyring");
    const entry = new Entry(SERVICE, USER);
    const existing = entry.getPassword();
    if (existing != null) {
      return parseMasterKey(existing, ref);
    }
    const key = randomBytes(MASTER_KEY_BYTES);
    entry.setPassword(Buffer.from(key).toString("base64"));
    return new Uint8Array(key);
  } catch (cause) {
    if (cause instanceof SkspError) {
      throw cause;
    }
    throw keychainError(code, ref, cause);
  }
}
