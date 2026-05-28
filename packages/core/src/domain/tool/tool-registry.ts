/**
 * Tool registry: store and resolve tools by unique name.
 *
 * @module domain/tool/tool-registry
 */

import type { Tool } from "./model/tool.js";
import { toolConflict } from "./tool-errors.js";

/**
 * In-memory registry for tools.
 *
 * @remarks
 * Names are unique. Duplicate registrations are rejected (safer than last-wins).
 */
export class ToolRegistry<Ctx = unknown> {
  private readonly tools = new Map<string, Tool<any, any, Ctx>>();

  /**
   * Registers a tool.
   *
   * @throws ToolError CONFLICT when name already registered
   */
  register(tool: Tool<any, any, Ctx>): void {
    if (this.tools.has(tool.name)) {
      throw toolConflict(tool.name);
    }
    this.tools.set(tool.name, tool);
  }

  /** Removes a tool by name. Returns true if removed. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Returns a tool by name or `undefined`. */
  get(name: string): Tool<any, any, Ctx> | undefined {
    return this.tools.get(name);
  }

  /** Returns all registered tool names (in insertion order). */
  list(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * Clears the registry (for tests only).
   * @internal
   */
  clear(): void {
    this.tools.clear();
  }
}

