/**
 * Main-process logging for desktop diagnostics (Electron terminal / log file).
 *
 * Enable verbose LLM HTTP traces: `NM_DEBUG_LLM_FETCH=1`
 * Enable agent-run context logs: `NM_DEBUG_DESKTOP=1` (also on when NODE_ENV !== production)
 */

const TAG = "[novel-master/desktop]";

/** Verbose agent/LLM context (provider protocol, model id). */
export function isDesktopLlmDebug(): boolean {
  if (process.env.NM_DEBUG_DESKTOP === "1") {
    return true;
  }
  if (process.env.NM_DEBUG_LLM_FETCH === "1") {
    return true;
  }
  return process.env.NODE_ENV !== "production";
}

export function desktopLog(
  message: string,
  detail?: Record<string, unknown>,
): void {
  if (detail != null) {
    console.log(TAG, message, detail);
  } else {
    console.log(TAG, message);
  }
}

export function desktopLogWarn(
  message: string,
  detail?: Record<string, unknown>,
): void {
  if (detail != null) {
    console.warn(TAG, message, detail);
  } else {
    console.warn(TAG, message);
  }
}

export function desktopLogError(
  message: string,
  detail?: Record<string, unknown>,
): void {
  if (detail != null) {
    console.error(TAG, message, detail);
  } else {
    console.error(TAG, message);
  }
}
