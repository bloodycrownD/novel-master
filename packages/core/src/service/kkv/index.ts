/**
 * Internal KKV service factory — not part of the main `@novel-master/core` public API.
 *
 * @remarks App runtimes use this subpath for `AppUiPreferences` wiring only.
 * Product code should prefer `PersistentState` / `PersistentPreferences` ports.
 *
 * @module service/kkv
 */

export { createKkvService } from "./create-kkv-service.js";
export type { KkvService } from "./kkv.port.js";
export { KkvError, isKkvError } from "../../errors/kkv-errors.js";
export type { KkvErrorCode } from "../../errors/kkv-errors.js";
