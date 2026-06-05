/**
 * NMTP driver registry (mirrors SKSP / TDBC registry semantics).
 *
 * @module infra/nmtp/logic/registry
 */

import type { TokenizerDriver } from "../ports/tokenizer-driver.port.js";
import { TokenizerError } from "../nmtp-error.js";

const drivers = new Map<string, TokenizerDriver>();

const REGISTER_HINT =
  "Call registerTokenizerNodeDriver() (CLI/Electron) or registerTokenizerRnDriver() (React Native).";

/** Registers a driver under {@link TokenizerDriver.name}. */
export function registerTokenizerDriver(driver: TokenizerDriver): void {
  drivers.set(driver.name, driver);
}

/** Returns a registered driver or `undefined`. */
export function getTokenizerDriver(name: string): TokenizerDriver | undefined {
  return drivers.get(name);
}

/** Clears the registry (for tests only). @internal */
export function clearTokenizerDrivers(): void {
  drivers.clear();
}

/**
 * Resolves the NMTP driver to use.
 * @throws TokenizerError when resolution fails
 */
export function resolveTokenizerDriver(explicit?: string): TokenizerDriver {
  if (explicit !== undefined) {
    const driver = getTokenizerDriver(explicit);
    if (!driver) {
      throw new TokenizerError(
        "NOT_REGISTERED",
        `Tokenizer driver not registered: ${explicit}. ${REGISTER_HINT}`,
      );
    }
    return driver;
  }

  const names = [...drivers.keys()];
  if (names.length === 1) {
    return getTokenizerDriver(names[0]!)!;
  }

  if (names.length === 0) {
    throw new TokenizerError(
      "NOT_REGISTERED",
      `No tokenizer driver registered. ${REGISTER_HINT}`,
    );
  }

  throw new TokenizerError(
    "MULTIPLE_DRIVERS",
    `Multiple tokenizer drivers registered (${names.join(", ")}); specify driver name. ${REGISTER_HINT}`,
  );
}
