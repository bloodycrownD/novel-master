/**
 * SKSP driver registry (mirrors TDBC registry semantics).
 *
 * @module registry
 */

import type { SecretStore } from "./secret-store.port.js";
import { SkspError } from "./sksp-error.js";

/** Factory for platform-specific {@link SecretStore} instances. */
export interface SkspDriver {
  readonly name: string;
  createStore(connection: unknown): SecretStore;
}

const drivers = new Map<string, SkspDriver>();

/** Registers a driver under {@link SkspDriver.name}. */
export function registerSkspDriver(driver: SkspDriver): void {
  drivers.set(driver.name, driver);
}

/** Returns a registered driver or `undefined`. */
export function getSkspDriver(name: string): SkspDriver | undefined {
  return drivers.get(name);
}

/** Clears the registry (for tests only). @internal */
export function clearSkspDrivers(): void {
  drivers.clear();
}

/**
 * Resolves the SKSP driver to use.
 * @throws SkspError NOT_REGISTERED when resolution fails
 */
export function resolveSkspDriver(explicit?: string): SkspDriver {
  if (explicit !== undefined) {
    const driver = getSkspDriver(explicit);
    if (!driver) {
      throw new SkspError("NOT_REGISTERED", `SKSP driver not registered: ${explicit}`);
    }
    return driver;
  }

  const names = [...drivers.keys()];
  if (names.length === 1) {
    return getSkspDriver(names[0]!)!;
  }

  throw new SkspError(
    "NOT_REGISTERED",
    names.length === 0
      ? "No SKSP driver registered"
      : "Multiple SKSP drivers registered; specify driver name",
  );
}
