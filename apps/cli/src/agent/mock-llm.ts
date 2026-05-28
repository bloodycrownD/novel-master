/**
 * Stub {@link ModelRequestService} for agent CLI capture / e2e without API keys.
 * Enable with `NM_AGENT_MOCK_LLM=1` and `NM_AGENT_MOCK_SCENARIO=<name>`.
 *
 * @module agent/mock-llm
 */

import type { LlmStreamEvent, ModelRequestService } from "@novel-master/core";

type LlmChatResult = Awaited<ReturnType<ModelRequestService["request"]>>;
type RequestOptions = NonNullable<
  Parameters<ModelRequestService["request"]>[2]
>;

const SCENARIOS = [
  "continue",
  "run",
  "vfs",
  "stream",
  "doom",
  "compaction",
] as const;

type MockScenario = (typeof SCENARIOS)[number];

function isCompactionRequest(options?: RequestOptions): boolean {
  return options?.tools == null || options.tools.length === 0;
}

async function emitStream(
  text: string,
  options?: RequestOptions,
): Promise<void> {
  if (!options?.stream || options.onStream == null) {
    return;
  }
  for (const ch of text.split("")) {
    const ev: LlmStreamEvent = { type: "text-delta", text: ch };
    options.onStream(ev);
  }
}

function textResult(text: string): LlmChatResult {
  return {
    assistantText: text,
    blocks: [{ type: "text", text }],
    raw: { mock: true },
  };
}

/**
 * Returns a deterministic mock LLM for the active `NM_AGENT_MOCK_SCENARIO`.
 */
export function createAgentMockModelRequests(): ModelRequestService {
  const scenario = (process.env.NM_AGENT_MOCK_SCENARIO ??
    "continue") as MockScenario;
  let callIndex = 0;

  return {
    async request(_applicationModelId, _userContent, options) {
      if (isCompactionRequest(options)) {
        return textResult("summary text");
      }

      callIndex += 1;

      switch (scenario) {
        case "continue": {
          const text = "Assistant reply (single step).";
          await emitStream(text, options);
          return textResult(text);
        }
        case "run": {
          if (callIndex === 1) {
            return {
              assistantText: "",
              blocks: [
                {
                  type: "tool_use",
                  id: "t1",
                  name: "vfs.list",
                  input: { dir: "/" },
                },
              ],
              raw: { mock: true },
            };
          }
          if (callIndex === 2) {
            return {
              assistantText: "",
              blocks: [
                {
                  type: "tool_use",
                  id: "t2",
                  name: "vfs.list",
                  input: { dir: "/" },
                },
              ],
              raw: { mock: true },
            };
          }
          const text = "Multi-step run finished.";
          await emitStream(text, options);
          return textResult(text);
        }
        case "vfs": {
          return {
            assistantText: "",
            blocks: [
              {
                type: "tool_use",
                id: "w1",
                name: "vfs.write",
                input: { path: "/agent-out.txt", content: "vfs tool ok" },
              },
            ],
            raw: { mock: true },
          };
        }
        case "stream": {
          const text = "streamed hello";
          await emitStream(text, options);
          return textResult(text);
        }
        case "doom": {
          const input = { path: "/x" };
          return {
            assistantText: "",
            blocks: [
              { type: "tool_use", id: "a", name: "vfs.read", input },
              { type: "tool_use", id: "b", name: "vfs.read", input },
              { type: "tool_use", id: "c", name: "vfs.read", input },
            ],
            raw: { mock: true },
          };
        }
        case "compaction": {
          const text = "After compaction.";
          await emitStream(text, options);
          return textResult(text);
        }
        default: {
          const text = `Unknown mock scenario: ${scenario}`;
          return textResult(text);
        }
      }
    },
  };
}
