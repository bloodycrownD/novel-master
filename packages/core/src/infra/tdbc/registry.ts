/**
 * Driver registry: register and resolve TDBC drivers by name.
 *
 * @module infra/tdbc/registry
 * @invariant Driver names are unique; last registration wins.
 */

import type { TdbcDriver } from "./driver.js";
import { TdbcError } from "./errors.js";

const drivers = new Map<string, TdbcDriver>();

/**
 * Registers a driver under {@link TdbcDriver.name}.
 */
export function registerDriver(driver: TdbcDriver): void {
  drivers.set(driver.name, driver);
}

/**
 * Returns a registered driver or `undefined`.
 */
export function getDriver(name: string): TdbcDriver | undefined {
  return drivers.get(name);
}

/**
 * Returns all registered driver names (insertion order not guaranteed).
 */
export function listDrivers(): string[] {
  return [...drivers.keys()];
}

/**
 * Clears the registry (for tests only).
 * @internal
 */
export function clearDrivers(): void {
  drivers.clear();
}

/**
 * Resolves the driver to use for `open`.
 * @throws TdbcError UNKNOWN_DRIVER when resolution fails
 */
export function resolveDriver(explicit?: string): TdbcDriver {
  if (explicit !== undefined) {
    const driver = getDriver(explicit);
    if (!driver) {
      throw new TdbcError("UNKNOWN_DRIVER", `Driver not registered: ${explicit}`, {
        driver: explicit,
      });
    }
    return driver;
  }

  const names = listDrivers();
  if (names.length === 1) {
    return getDriver(names[0]!)!;
  }

  throw new TdbcError(
    "UNKNOWN_DRIVER",
    names.length === 0
      ? "No TDBC driver registered"
      : "Multiple drivers registered; specify options.driver",
  );
}
