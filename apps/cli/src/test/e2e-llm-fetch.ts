/**
 * OpenAI fetch stub for CLI e2e (sampling body capture on stderr).
 * Enable with `NM_LLM_E2E_FETCH=1` (do not combine with `NM_AGENT_MOCK_LLM`).
 *
 * @module test/e2e-llm-fetch
 */

import { clearProtocolAdapters, getProtocolAdapter } from "@novel-master/core";

const BODY_PREFIX = "NM_LLM_E2E_BODY:";

/** Registers a capture fetch and logs the request JSON body to stderr. */
export function installE2eLlmFetchCapture(): void {
  clearProtocolAdapters();
  getProtocolAdapter("openai", async (_input, init) => {
    console.error(`${BODY_PREFIX}${String(init?.body ?? "")}`);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "e2e ok" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

export { BODY_PREFIX };
