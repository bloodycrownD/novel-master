/**
 * LLM fetch wiring for main process (must run before first chat request).
 *
 * Unpackaged dev enables {@link createLoggingFetch} automatically; production uses
 * default adapters unless `NM_DEBUG_LLM_FETCH=1`.
 */
import { configureLlmFetch, createLoggingFetch } from "@novel-master/core/provider";
import { desktopLog, isDesktopLlmDebug } from "../log/desktop-log.js";

let configured = false;

/** Registers logging fetch for protocol adapters once per main process. */
export function ensureLlmFetchConfigured(): void {
  if (configured) {
    return;
  }
  const debugLlm =
    process.env.NM_DEBUG_LLM_FETCH === "1" || isDesktopLlmDebug();
  if (debugLlm) {
    (globalThis as { __NM_DEBUG_LLM_FETCH__?: boolean }).__NM_DEBUG_LLM_FETCH__ =
      true;
    configureLlmFetch(createLoggingFetch(globalThis.fetch));
    desktopLog("LLM fetch debug enabled", {
      nmDebugLlmFetch: process.env.NM_DEBUG_LLM_FETCH === "1",
      nmDebugDesktop: process.env.NM_DEBUG_DESKTOP === "1",
    });
  }
  configured = true;
}
