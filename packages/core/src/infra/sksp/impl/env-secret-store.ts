/**
 * Environment-variable secret store (read-only).
 *
 * @module infra/sksp/impl/env-secret-store
 */

import { refToEnvVar } from "../logic/ref-to-env.js";

/** 从 NOVEL_MASTER_PROVIDER_*_API_KEY 环境变量读取 provider API 密钥。 */
export class EnvSecretStore {
  async get(ref: string): Promise<string | null> {
    const name = refToEnvVar(ref);
    if (!name) {
      return null;
    }
    const v = process.env[name];
    if (v === undefined || v === "" || v.trim() === "") {
      return null;
    }
    return v;
  }

  async has(ref: string): Promise<boolean> {
    return (await this.get(ref)) !== null;
  }
}

/** 创建 {@link EnvSecretStore} 实例。 */
export function createEnvSecretStore(): EnvSecretStore {
  return new EnvSecretStore();
}
