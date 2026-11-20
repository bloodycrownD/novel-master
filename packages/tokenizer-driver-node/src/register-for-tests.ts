/**
 * Test helper: registers Node NMTP driver with optional custom assets root.
 *
 * @module register-for-tests
 */

import { TokenizerRegistry } from "@novel-master/core/nmtp";
import { TokenizerNodeRegister } from "./register.js";

// nm-style 注记：文件名 register-for-tests 太泛，按成员主体起名（TokenizerNodeRegisterForTests）。
/** Registers the Node driver for tests; clears any prior drivers first. */
export namespace TokenizerNodeRegisterForTests {
  export function registerForTests(assetsRoot?: string): void {
    TokenizerRegistry.clear();
    TokenizerNodeRegister.register(assetsRoot != null ? { assetsRoot } : undefined);
  }
}
