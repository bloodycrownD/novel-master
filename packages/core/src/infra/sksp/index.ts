/**
 * SKSP (Secret Key Storage Protocol): async secret store port, registry, and helpers.
 *
 * Zero native dependencies in this module; platform drivers register via
 * {@link registerSkspDriver}. Env-backed reads ({@link EnvSecretStore}) live here
 * for CI/scripts (no native code).
 *
 * @module infra/sksp
 */

export type { SecretStore } from "./secret-store.port.js";
export { SkspError, assertValidRef } from "./sksp-error.js";
export type { SkspErrorCode } from "./sksp-error.js";
export {
  registerSkspDriver,
  getSkspDriver,
  resolveSkspDriver,
  clearSkspDrivers,
} from "./registry.js";
export type { SkspDriver } from "./registry.js";
export {
  createCompositeSecretStore,
} from "./composite-secret-store.js";
export type { EnvSecretStoreLike } from "./composite-secret-store.js";
export { refToEnvVar } from "./ref-to-env.js";
export { EnvSecretStore, createEnvSecretStore } from "./env-secret-store.js";
