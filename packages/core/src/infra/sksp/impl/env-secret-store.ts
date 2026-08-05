/**
 * Environment-variable secret store (read-only).
 *
 * @module infra/sksp/impl/env-secret-store
 */

import { refToEnvVar } from "../logic/ref-to-env.js";
import { resolveSkspEnvOverride } from "../logic/env-override.js";

/** 从 NOVEL_MASTER_PROVIDER_*_API_KEY 环境变量读取 provider API 密钥。 */
export class EnvSecretStore {
  async get(ref: string): Promise<string | null> {
    const name = refToEnvVar(ref);
    if (!name) {
      return null;
    }
    // 空串 / 空白 / undefined 一律视为不覆盖 DB（见 resolveSkspEnvOverride）
    return resolveSkspEnvOverride(name, process.env);
  }

  async has(ref: string): Promise<boolean> {
    return (await this.get(ref)) !== null;
  }
}

/** 创建 {@link EnvSecretStore} 实例。 */
export function createEnvSecretStore(): EnvSecretStore {
  return new EnvSecretStore();
}
