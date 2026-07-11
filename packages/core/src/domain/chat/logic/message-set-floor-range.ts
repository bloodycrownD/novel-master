/** 消息置位：按锚点 seq 计算 hide/show 区间。 */

export function isSetFloorAnchorRole(
  role: string,
): role is "user" | "assistant" {
  return role === "user" || role === "assistant";
}

export function computeSetFloorRanges(
  floorSeq: number,
  sessionMaxSeq: number,
): {
  readonly hidePrefix: { readonly fromSeq: 1; readonly toSeq: number } | null;
  readonly showSuffix: { readonly fromSeq: number; readonly toSeq: number } | null;
} {
  const hidePrefix =
    floorSeq > 1 ? { fromSeq: 1 as const, toSeq: floorSeq - 1 } : null;
  const showSuffix =
    floorSeq <= sessionMaxSeq && (floorSeq < sessionMaxSeq || floorSeq === 1)
      ? { fromSeq: floorSeq, toSeq: sessionMaxSeq }
      : null;
  return { hidePrefix, showSuffix };
}
