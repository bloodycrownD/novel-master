/**
 * Context stack for foreach scopes and #{}/${} path resolution.
 */

/** Stack of scope frames (root params + foreach-injected locals). */
export type ContextStack = Record<string, unknown>[];

/**
 * Pushes a new scope frame onto the stack.
 */
export function pushScope(
  stack: ContextStack,
  frame: Record<string, unknown>,
): ContextStack {
  return [...stack, frame];
}

/**
 * Merges stack frames root-to-leaf; inner frames override top-level keys.
 */
function mergedContext(stack: ContextStack): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const frame of stack) {
    Object.assign(out, frame);
  }
  return out;
}

/**
 * Resolves a dot path (e.g. `user.id`) against the context stack.
 * Missing segments yield `undefined` (no throw).
 */
export function resolvePath(stack: ContextStack, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed) return undefined;

  const parts = trimmed.split(".");
  let current: unknown = mergedContext(stack);

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Reads a collection expression name from the root-ish context (attribute name).
 */
export function resolveCollectionName(
  stack: ContextStack,
  collectionAttr: string,
): unknown {
  return resolvePath(stack, collectionAttr);
}
