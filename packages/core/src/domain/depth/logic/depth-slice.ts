/**
 * Depth slice parse, validate, and match (tail-based 0 = newest).
 *
 * @module domain/depth/logic/depth-slice
 */

/** Depth interval parameters (at least one bound required). */
export interface DepthSlice {
  readonly startDepth?: number;
  readonly endDepth?: number;
}

const INFINITY = Number.POSITIVE_INFINITY;

/** True when depth falls inside the slice (inclusive bounds; missing bound = infinity). */
export function matchDepth(depth: number, slice: DepthSlice): boolean {
  const start = slice.startDepth ?? 0;
  const end = slice.endDepth ?? INFINITY;
  if (slice.startDepth == null && slice.endDepth != null) {
    return depth <= end;
  }
  if (slice.startDepth != null && slice.endDepth == null) {
    return depth >= start;
  }
  return depth >= start && depth <= end;
}

/** Validates non-negative integers and start <= end when both set. */
export function validateDepthSlice(slice: DepthSlice): void {
  if (slice.startDepth == null && slice.endDepth == null) {
    throw new Error("depth slice requires at least startDepth or endDepth");
  }
  if (slice.startDepth != null) {
    if (!Number.isInteger(slice.startDepth) || slice.startDepth < 0) {
      throw new Error("startDepth must be a non-negative integer");
    }
  }
  if (slice.endDepth != null) {
    if (!Number.isInteger(slice.endDepth) || slice.endDepth < 0) {
      throw new Error("endDepth must be a non-negative integer");
    }
  }
  if (
    slice.startDepth != null &&
    slice.endDepth != null &&
    slice.startDepth > slice.endDepth
  ) {
    throw new Error("startDepth must be <= endDepth");
  }
}

/** Message ids whose tail depth matches the slice. */
export function messageIdsInSlice(
  visibleMessages: readonly { readonly id: string }[],
  slice: DepthSlice,
): string[] {
  validateDepthSlice(slice);
  const n = visibleMessages.length;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const depth = n - 1 - i;
    if (matchDepth(depth, slice)) {
      ids.push(visibleMessages[i]!.id);
    }
  }
  return ids;
}

/** Parses kebab or camel depth fields from a wire object. */
export function depthSliceFromWire(raw: Record<string, unknown>): DepthSlice {
  const start =
    raw.startDepth ?? raw["start-depth"];
  const end = raw.endDepth ?? raw["end-depth"];
  return {
    startDepth: typeof start === "number" ? start : undefined,
    endDepth: typeof end === "number" ? end : undefined,
  };
}
