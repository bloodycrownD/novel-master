/**
 * Environment-variable secret store (read-only).
 *
 * @module env-secret-store
 */

import { refToEnvVar } from "./ref-to-env.js";

/** Reads provider API keys from `NOVEL_MASTER_PROVIDER_*_API_KEY` env vars. */
export class EnvSecretStore {
  async get(ref: string): Promise<string | null> {
    const name = refToEnvVar(ref);
    if (!name) {
      return null;
    }
    const v = process.env[name];
    return v !== undefined ? v : null;
  }

  async has(ref: string): Promise<boolean> {
    const v = await this.get(ref);
    return v !== null && v !== "";
  }
}

/** Creates an {@link EnvSecretStore} instance. */
export function createEnvSecretStore(): EnvSecretStore {
  return new EnvSecretStore();
}
