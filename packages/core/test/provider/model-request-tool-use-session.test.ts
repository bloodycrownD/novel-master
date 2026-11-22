import {  outcomeValue  } from "../helpers/outcome-value.js";
import {  unwrap  } from "../helpers/result-unwrap.js";
import {  BUILTIN_PROVIDER_UUID_ANTHROPIC  } from "../../src/domain/provider/logic/builtin-providers.js";
import assert from "node:assert/strict";
import {  describe, it, mock  } from "node:test";
import {  TextBlocks  } from "@novel-master/core/chat";
import {  ProviderServiceFactory  } from "../../src/service/provider/provider-service-factory.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import {  Registry  } from "../../src/infra/llm-protocol/logic/registry.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../helpers/novel-master-fixture.js";
function memorySecretStore(): SecretStore {
    const map = new Map<string, string>();
    return {
        async get(ref) {
            return map.get(ref) ?? null;
        },
        async has(ref) {
            return map.has(ref);
        },
        async set(ref, plain) {
            map.set(ref, plain);
        },
        async delete(ref) {
            return map.delete(ref);
        },
    };
}


novelMasterTestFixture();

describe("ModelRequestService tool_use session round-trip", () => {
    it("persists tool_use block after request with history", async () => {
        Registry.clearProtocolAdapters();
        const fetchFn = mock.fn(async () => {
            return new Response(
                JSON.stringify({
                    content: [
                        {
                            type: "tool_use",
                            id: "tu_1",
                            name: "grep",
                            input: { pattern: "foo" },
                        },
                        { type: "text", text: "" },
                        { type: "text", text: "done" },
                    ],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            );
        });
        Registry.getProtocolAdapter("anthropic", fetchFn as typeof fetch);

        const ctx = getNovelMasterTestContext();
        const secrets = memorySecretStore();
        const bundle = ProviderServiceFactory.create(ctx.conn, secrets);
        await secrets.set(`provider/${BUILTIN_PROVIDER_UUID_ANTHROPIC}/apiKey`, "sk-ant-test");
        const model = unwrap(await bundle.providerModels.create(BUILTIN_PROVIDER_UUID_ANTHROPIC, "claude-3-5-sonnet"));

        const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
        const session = unwrap(await ctx.sessions.create(project.id));
        unwrap(await ctx.messages.append(session.id, "user", TextBlocks.of("find foo")));

        const history = (outcomeValue(await ctx.messages.listBySession(session.id))).filter(
            (m) => !m.hidden,
        );
        const result = unwrap(await bundle.modelRequests.request(
            model.id,
            "find foo",
            { history },
        ));

        const saved = unwrap(await ctx.messages.append(session.id, "assistant", {
            blocks: result.blocks,
        }));
        const reloaded = unwrap(await ctx.messages.get(saved.id));
        const toolUse = reloaded.content.blocks.find((b) => b.type === "tool_use");
        assert.ok(toolUse);
        assert.equal(toolUse.type === "tool_use" && toolUse.id, "tu_1");
        assert.equal(toolUse.type === "tool_use" && toolUse.name, "grep");
        assert.ok(
            !reloaded.content.blocks.some(
                (b) => b.type === "text" && b.text === "",
            ),
        );
        Registry.clearProtocolAdapters();
    });
});
