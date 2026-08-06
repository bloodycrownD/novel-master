/**
 * Registers V2 builtin workspace file tools.
 *
 * @module domain/tool/builtin/register-builtin-tools
 */

import type { ToolRegistry } from "../logic/tool-registry.js";
import type { BuiltinToolContext } from "./builtin-tool-context.js";
import { createVfsTools } from "./vfs-tools.js";

/** Registers the 6 V2 builtin file tools into a registry. */
export function registerBuiltinTools(
  registry: ToolRegistry<BuiltinToolContext>,
): void {
  for (const tool of createVfsTools()) {
    registry.register(tool);
  }
}

/**
 * @deprecated Use {@link registerBuiltinTools}.
 */
export function registerVfsTools(
  registry: ToolRegistry<BuiltinToolContext>,
): void {
  registerBuiltinTools(registry);
}
