/**
 * Registers all builtin agent tools (VFS + chat_grep).
 *
 * @module domain/tool/builtin/register-builtin-tools
 */

import type { ToolRegistry } from "../logic/tool-registry.js";
import type { BuiltinToolContext } from "./builtin-tool-context.js";
import { createChatGrepTool } from "./chat-grep-tool.js";
import { createVfsTools } from "./vfs-tools.js";

/** Registers the 7 V2 builtin tools into a registry. */
export function registerBuiltinTools(
  registry: ToolRegistry<BuiltinToolContext>,
): void {
  for (const tool of createVfsTools()) {
    registry.register(tool);
  }
  registry.register(createChatGrepTool());
}

/**
 * @deprecated Use {@link registerBuiltinTools}.
 */
export function registerVfsTools(
  registry: ToolRegistry<BuiltinToolContext>,
): void {
  registerBuiltinTools(registry);
}
