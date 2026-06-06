/**
 * AES-256-GCM encrypt/decrypt for macOS SKSP secrets.
 *
 * @module crypto
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SkspError } from "@novel-master/core/sksp";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Encrypts UTF-8 plaintext with AES-256-GCM. @throws SkspError ENCRYPT_FAILED */
export function encryptUtf8(
  plain: string,
  masterKey: Uint8Array,
  ref: string,
): { ciphertext: Uint8Array; iv: Uint8Array } {
  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([enc, tag]);
    return { ciphertext: new Uint8Array(ciphertext), iv: new Uint8Array(iv) };
  } catch (cause) {
    throw new SkspError("ENCRYPT_FAILED", `AES encrypt failed for ${ref}`, {
      ref,
      cause,
    });
  }
}

/** Decrypts AES-256-GCM ciphertext to UTF-8. @throws SkspError DECRYPT_FAILED */
export function decryptUtf8(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  masterKey: Uint8Array,
  ref: string,
): string {
  try {
    const buf = Buffer.from(ciphertext);
    if (buf.length < TAG_BYTES) {
      throw new Error("ciphertext too short");
    }
    const tag = buf.subarray(buf.length - TAG_BYTES);
    const enc = buf.subarray(0, buf.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
      "utf8",
    );
  } catch (cause) {
    throw new SkspError(
      "DECRYPT_FAILED",
      `AES decrypt failed for ${ref}. Re-run: nm provider edit --apiKey`,
      { ref, cause },
    );
  }
}
