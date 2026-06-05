/**
 * Test helper: registers Node NMTP driver with optional custom assets root.
 *
 * @module register-for-tests
 */

import { clearTokenizerDrivers } from "@novel-master/core/nmtp";
import { registerTokenizerNodeDriver } from "./register.js";

/** Registers the Node driver for tests; clears any prior drivers first. */
export function registerTokenizerNodeDriverForTests(assetsRoot?: string): void {
  clearTokenizerDrivers();
  registerTokenizerNodeDriver(assetsRoot != null ? { assetsRoot } : undefined);
}
