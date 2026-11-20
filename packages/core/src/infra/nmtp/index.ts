/**
 * NMTP (Novel Master Tokenizer Protocol): driver port, registry, and helpers.
 *
 * Zero platform dependencies in this module; drivers register via
 * {@link TokenizerRegistry.register}.
 *
 * @module infra/nmtp
 */

export type { TokenizerDriver } from "./ports/tokenizer-driver.port.js";
export { TokenizerRegistry } from "./logic/registry.js";
