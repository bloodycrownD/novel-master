/**
 * NMTP (Novel Master Tokenizer Protocol): driver port, registry, and helpers.
 *
 * Zero platform dependencies in this module; drivers register via
 * {@link registerTokenizerDriver}.
 *
 * @module infra/nmtp
 */

export type { TokenizerDriver } from "./ports/tokenizer-driver.port.js";
export { TokenizerError } from "./nmtp-error.js";
export type { TokenizerErrorCode } from "./nmtp-error.js";
export {
  registerTokenizerDriver,
  getTokenizerDriver,
  resolveTokenizerDriver,
  clearTokenizerDrivers,
} from "./logic/registry.js";
