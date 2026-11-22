import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  SerializationDecode  } from "../../src/infra/serialization/decode.js";
import {  AppErrorOps  } from "../../src/errors/app-error.js";
import {  sessionAgentConfigSchema  } from "../../src/domain/chat/model/session-agent-config.schema.js";
import type { ZodType } from "zod";

/** decode 已改返回 Result（四期签名）：测试内统一解包——Ok 取 value，Err 抛 error（assert.throws 的抛错契约保持不变）。 */
function decode<T>(raw: unknown, schema: ZodType<T>): T {
    const r = SerializationDecode.decode(raw, schema);
    if (!r.ok) throw r.error;
    return r.value;
}

describe("sessionAgentConfigSchema（v2 单形态）", () => {
    it("缺 agentId 报错", () => {
        assert.throws(
            () => decode({}, sessionAgentConfigSchema),
            (e: unknown) => AppErrorOps.is(e, "CONFIG_DECODE_INVALID_SCHEMA"),
        );
    });

    it("空 agentId 报错", () => {
        assert.throws(
            () => decode({ agentId: "" }, sessionAgentConfigSchema),
            (e: unknown) => AppErrorOps.is(e, "CONFIG_DECODE_INVALID_SCHEMA"),
        );
    });

    it("agentId 合法", () => {
        const config = decode({ agentId: "agent-a" }, sessionAgentConfigSchema);
        assert.equal(config.agentId, "agent-a");
        assert.equal(config.modelId, undefined);
    });

    it("agentId + modelId 合法", () => {
        const config = decode(
            { agentId: "agent-a", modelId: "gpt-4" },
            sessionAgentConfigSchema,
        );
        assert.equal(config.agentId, "agent-a");
        assert.equal(config.modelId, "gpt-4");
    });

    it("多余字段报错（.strict()）", () => {
        assert.throws(
            () =>
                decode(
                    { agentId: "a", extra: 1 } as Record<string, unknown>,
                    sessionAgentConfigSchema,
                ),
            (e: unknown) => AppErrorOps.is(e, "CONFIG_DECODE_INVALID_SCHEMA"),
        );
        // 老 mode 字段现在被 .strict() 拒绝
        assert.throws(
            () =>
                decode(
                    { mode: "bind", agentId: "a" } as Record<string, unknown>,
                    sessionAgentConfigSchema,
                ),
            (e: unknown) => AppErrorOps.is(e, "CONFIG_DECODE_INVALID_SCHEMA"),
        );
    });

    it("空 modelId 报错", () => {
        assert.throws(
            () =>
                decode(
                    { agentId: "a", modelId: "" },
                    sessionAgentConfigSchema,
                ),
            (e: unknown) => AppErrorOps.is(e, "CONFIG_DECODE_INVALID_SCHEMA"),
        );
    });

    it("toWire：不带 modelId 时只输出 agentId", () => {
        // toWire 已改返回 Result（五期门⑦）：恒成功路径解包 value 断言。
        const wire = sessionAgentConfigSchema.toWire({ agentId: "agent-b" });
        assert.ok(wire.ok);
        assert.deepEqual(wire.value, { agentId: "agent-b" });
    });

    it("toWire：带 modelId 时输出两个字段", () => {
        const wire = sessionAgentConfigSchema.toWire({
            agentId: "agent-b",
            modelId: "m1",
        });
        assert.ok(wire.ok);
        assert.deepEqual(wire.value, { agentId: "agent-b", modelId: "m1" });
    });
});
