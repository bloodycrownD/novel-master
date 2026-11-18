/**
 * SKSP 通用工厂：composite / env secret store（RN 安全，零 node 依赖）。
 *
 * Node 专属的 `SkspNodeFactory`（AES-GCM 策略与钥匙串主密钥，依赖
 * `node:crypto`）在 `./sksp-node-factory.js`，只经 `infra/sksp/node.ts`
 * 暴露，禁止进入本文件与 `infra/sksp/index.ts` 的依赖闭包。
 *
 * @module infra/sksp/impl/sksp-factory
 */

import type { SecretStore } from "../ports/secret-store.port.js";
import { refToEnvVar } from "../logic/ref-to-env.js";
import { resolveSkspEnvOverride } from "../logic/env-override.js";

/** Env-backed store: get/has only (no set/delete). */
// nm-style: keep-public — @novel-master/core/sksp 子入口再导出的公共类型契约（无生产直引）
export interface EnvSecretStoreLike {
  get(ref: string): Promise<string | null>;
  has(ref: string): Promise<boolean>;
}

/** 从 NOVEL_MASTER_PROVIDER_*_API_KEY 环境变量读取 provider API 密钥。 */
class EnvSecretStore {
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

export const SkspFactory = {
  /**
   * Combines env (read-only override) with a DB-backed store.
   * Read order: env hit →?DB; writes go to DB only.
   */
  createCompositeSecretStore(options: { db: SecretStore; env?: EnvSecretStoreLike }): SecretStore {
    const { db, env } = options;

    return {
      async get(ref: string): Promise<string | null> {
        if (env) {
          const fromEnv = await env.get(ref);
          // env 未命中：null（含空串/空白，见 EnvSecretStore）
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
  },

  /** 创建 env 只读 store 实例（CLI / Desktop 经 sksp barrel 消费）。 */
  createEnvSecretStore(): EnvSecretStoreLike {
    return new EnvSecretStore();
  },
} as const;
