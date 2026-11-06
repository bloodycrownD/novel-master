/**
 * Verify verbose desktop diagnostics are enabled.
 *
 * Enable verbose LLM HTTP traces: `NM_DEBUG_LLM_FETCH=1`
 * Enable agent-run context logs: `NM_DEBUG_DESKTOP=1` (also on when NODE_ENV !== production)
 */
export function isDesktopLlmDebug(): boolean {
  if (process.env.NM_DEBUG_DESKTOP === "1") {
    return true;
  }
  if (process.env.NM_DEBUG_LLM_FETCH === "1") {
    return true;
  }
  return process.env.NODE_ENV !== "production";
}
