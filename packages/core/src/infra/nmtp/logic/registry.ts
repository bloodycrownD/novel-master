/**
 * NMTP driver registry (mirrors SKSP / TDBC registry semantics).
 *
 * @module infra/nmtp/logic/registry
 */

import type { TokenizerDriver } from "@/infra/nmtp/index.js";
import { createDriverRegistry } from "../../create-driver-registry.js";

/** NMTP driver registry. */
export const TokenizerRegistry = createDriverRegistry<TokenizerDriver>({
  label: "Tokenizer",
  hint: "Call registerTokenizerNodeDriver() (CLI/Electron) or registerTokenizerRnDriver() (React Native).",
});
