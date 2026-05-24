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
