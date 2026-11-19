/**
 * Context stack for foreach scopes and #{}/${} path resolution.
 */

/** Stack of scope frames (root params + foreach-injected locals). */
export type ContextStack = Record<string, unknown>[];

/**
 * Context stack 的入栈与点路径解析。
 */
export const SqlTemplateContext = {
  /**
   * Pushes a new scope frame onto the stack.
   */
  pushScope(stack: ContextStack, frame: Record<string, unknown>): ContextStack {
    return [...stack, frame];
  },

  /**
   * Resolves a dot path (e.g. `user.id`) against the context stack.
   * Missing segments yield `undefined` (no throw).
   */
  resolvePath(stack: ContextStack, path: string): unknown {
    const trimmed = path.trim();
    if (!trimmed) return undefined;

    const merged: Record<string, unknown> = {};
    for (const frame of stack) {
      Object.assign(merged, frame);
    }
    let current: unknown = merged;

    for (const part of trimmed.split(".")) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  },
} as const;
