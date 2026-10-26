/**
 * Depth slice parse, validate, and match (tail-based 0 = newest).
 *
 * 校验失败走 `Result`（key `DEPTH_INVALID_SLICE`），本模块不抛；调用方按
 * `if (!r.ok)` 收窄后自行决定抛还是降级。
 *
 * @module domain/depth/logic/depth-slice
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

/** Depth interval parameters (at least one bound required). */
export interface DepthSlice {
  readonly startDepth?: number;
  readonly endDepth?: number;
}

/** 本模块的领域失败：depth 区间不合法。 */
type DepthLogicError = AppError<"DEPTH_INVALID_SLICE">;

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
export function validateDepthSlice(slice: DepthSlice): Result<void, DepthLogicError> {
  const details = { startDepth: slice.startDepth, endDepth: slice.endDepth };
  if (slice.startDepth == null && slice.endDepth == null) {
    return Result.err(new AppError("DEPTH_INVALID_SLICE", "depth slice requires at least startDepth or endDepth", details));
  }
  if (slice.startDepth != null && (!Number.isInteger(slice.startDepth) || slice.startDepth < 0)) {
    return Result.err(new AppError("DEPTH_INVALID_SLICE", "startDepth must be a non-negative integer", details));
  }
  if (slice.endDepth != null && (!Number.isInteger(slice.endDepth) || slice.endDepth < 0)) {
    return Result.err(new AppError("DEPTH_INVALID_SLICE", "endDepth must be a non-negative integer", details));
  }
  if (slice.startDepth != null && slice.endDepth != null && slice.startDepth > slice.endDepth) {
    return Result.err(new AppError("DEPTH_INVALID_SLICE", "startDepth must be <= endDepth", details));
  }
  return Result.ok(undefined);
}

/** Message ids whose tail depth matches the slice; invalid slice → `Err`. */
export function messageIdsInSlice(visibleMessages: readonly { readonly id: string }[], slice: DepthSlice): Result<string[], DepthLogicError> {
  const validated = validateDepthSlice(slice);
  if (!validated.ok) {
    return Result.err(validated.error);
  }
  const n = visibleMessages.length;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const depth = n - 1 - i;
    if (matchDepth(depth, slice)) {
      ids.push(visibleMessages[i]!.id);
    }
  }
  return Result.ok(ids);
}
