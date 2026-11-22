/**
 * Verify verbose desktop diagnostics are enabled.
 *
 * Enable verbose LLM HTTP traces: `NM_DEBUG_LLM_FETCH=1`
 * Enable agent-run context logs: `NM_DEBUG_DESKTOP=1` (also on when NODE_ENV !== production)
 */
export const LlmDebugFlag = {
    /** 桌面 LLM debug 是否开启（谓词主语即 namespace 本身）。 */
    is(): boolean {
        if (process.env.NM_DEBUG_DESKTOP === "1") {
            return true;
        }
        if (process.env.NM_DEBUG_LLM_FETCH === "1") {
            return true;
        }
        return process.env.NODE_ENV !== "production";
    },
} as const;
