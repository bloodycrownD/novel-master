/**
 * SKSP (Secret Key Storage Protocol): async secret store port, registry, and helpers.
 *
 * Zero native dependencies in this module; platform drivers register via
 * {@link registerSkspDriver}. Env-backed reads ({@link EnvSecretStore}) live here
 * for CI/scripts (no native code).
 *
 * @module infra/sksp
 */

export type { SecretStore } from "./ports/secret-store.port.js";
export { SkspError, assertValidRef } from "./sksp-error.js";
export type { SkspErrorCode } from "./sksp-error.js";
export {
  registerSkspDriver,
  getSkspDriver,
  resolveSkspDriver,
  clearSkspDrivers,
} from "./logic/registry.js";
export type { SkspDriver } from "./logic/registry.js";
export {
  createCompositeSecretStore,
} from "./impl/composite-secret-store.js";
export type { EnvSecretStoreLike } from "./impl/composite-secret-store.js";
export { refToEnvVar } from "./logic/ref-to-env.js";
export { EnvSecretStore, createEnvSecretStore } from "./impl/env-secret-store.js";
