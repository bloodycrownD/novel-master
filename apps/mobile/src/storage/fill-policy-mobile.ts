/**
 * Mobile directory-rule fill policy: legacy `full` maps to `hidden` in UI.
 */
import { type FillPolicy } from "@novel-master/core/worktree";

/** Maps deprecated `full` to `hidden`; coalesces unknown values to `hidden`. */
export function normalizeFillPolicyForMobile(
  fillPolicy: FillPolicy | undefined,
): FillPolicy {
  if (fillPolicy === 'full') {
    return 'hidden';
  }
  if (
    fillPolicy === 'filename' ||
    fillPolicy === 'header' ||
    fillPolicy === 'hidden'
  ) {
    return fillPolicy;
  }
  return 'hidden';
}
