/**
 * NMTP driver registry (mirrors SKSP / TDBC registry semantics).
 *
 * @module infra/nmtp/logic/registry
 */

import { createDriverRegistry } from "../../create-driver-registry.js";
import type { TokenizerDriver } from "../ports/tokenizer-driver.port.js";
import { TokenizerError } from "../nmtp-error.js";

const REGISTER_HINT = "Call registerTokenizerNodeDriver() (CLI/Electron) or registerTokenizerRnDriver() (React Native).";

/** NMTP driver registry. */
export const TokenizerRegistry = createDriverRegistry<TokenizerDriver>({
  notRegistered: (detail) => new TokenizerError("NOT_REGISTERED", `Tokenizer driver not registered: ${detail}. ${REGISTER_HINT}`),
  multiple: (names) =>
    names.length === 0
      ? new TokenizerError("NOT_REGISTERED", `No tokenizer driver registered. ${REGISTER_HINT}`)
      : new TokenizerError("MULTIPLE_DRIVERS", `Multiple tokenizer drivers registered (${names.join(", ")}); specify driver name. ${REGISTER_HINT}`),
});
