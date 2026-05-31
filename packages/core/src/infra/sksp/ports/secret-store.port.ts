/**
 * Secret Key Storage Protocol â€?async secret store port.
 *
 * @module infra/sksp/ports/secret-store.port
 */

/** Async key-value secret storage (ciphertext at rest in DB drivers). */
export interface SecretStore {
  get(ref: string): Promise<string | null>;
  set(ref: string, plain: string): Promise<void>;
  delete(ref: string): Promise<boolean>;
  has(ref: string): Promise<boolean>;
}
