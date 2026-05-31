/**
 * Composite secret store: env overrides DB for reads.
 *
 * @module infra/sksp/impl/composite-secret-store
 */

import type { SecretStore } from "../ports/secret-store.port.js";

/** Env-backed store: get/has only (no set/delete). */
export interface EnvSecretStoreLike {
  get(ref: string): Promise<string | null>;
  has(ref: string): Promise<boolean>;
}

/**
 * Combines env (read-only override) with a DB-backed store.
 * Read order: env hit â†?DB; writes go to DB only.
 */
export function createCompositeSecretStore(options: {
  db: SecretStore;
  env?: EnvSecretStoreLike;
}): SecretStore {
  const { db, env } = options;

  return {
    async get(ref: string): Promise<string | null> {
      if (env) {
        const fromEnv = await env.get(ref);
        if (fromEnv !== null) {
          return fromEnv;
        }
      }
      return db.get(ref);
    },

    async has(ref: string): Promise<boolean> {
      if (env && (await env.has(ref))) {
        return true;
      }
      return db.has(ref);
    },

    async set(ref: string, plain: string): Promise<void> {
      await db.set(ref, plain);
    },

    async delete(ref: string): Promise<boolean> {
      return db.delete(ref);
    },
  };
}
