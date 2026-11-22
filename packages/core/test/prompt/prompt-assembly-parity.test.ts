import assert from "node:assert/strict";
import {  unwrap  } from "../helpers/result-unwrap.js";
import {  describe, it  } from "node:test";
import {  TextBlocks, type ChatMessageData  } from "@novel-master/core/chat";

import {  PromptBuilder, type AgentPromptLayout  } from "@novel-master/core/prompt";

import {  serializePromptLlmInput  } from "@novel-master/core/tokenizer";

const layout: AgentPromptLayout = {
    system: "ctx",
    persistEnabled: true,
    persist: [{ name: "u", type: "text", role: "user", content: "ask" }],
    dynamic: [],
};

function message(role: string, content: string, seq: number): ChatMessageData {
    return {
        id: `m${seq}`,
        sessionId: "s1",
        seq,
        role,
        content: TextBlocks.of(content),
        provider: null,
        raw: null,
        createdAtMs: seq,
        hidden: false,
    };
}

describe("prompt assembly parity", () => {
    it("T2: serializePromptLlmInput equals formatPromptLlmInputForCliFromLayout", async () => {
        const ctx = {
            workplaceDisplay: "WT",
            messages: [message("user", "hi", 1)],
        };
        const serialized = unwrap(await serializePromptLlmInput(layout, ctx));
        const formatted = unwrap(await PromptBuilder.cliText(layout, ctx));
        assert.equal(serialized, formatted);
    });

    it("hidden messages excluded from chat segment", async () => {
        const fullCtx = {
            workplaceDisplay: "",
            messages: [
                message("user", "visible", 1),
                { ...message("assistant", "hidden", 2), hidden: true },
            ],
        };
        const hiddenCtx = {
            workplaceDisplay: "",
            messages: [message("user", "visible", 1)],
        };
        const full = unwrap(await serializePromptLlmInput(layout, fullCtx));
        const hidden = unwrap(await serializePromptLlmInput(layout, hiddenCtx));
        assert.equal(full, hidden);
    });
});
