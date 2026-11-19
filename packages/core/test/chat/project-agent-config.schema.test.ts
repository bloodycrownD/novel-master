import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  SerializationDecode  } from "@novel-master/core";
import type { ZodType } from "zod";

/** decode 已改返回 Result（四期签名）：测试内统一解包——Ok 取 value，Err 抛 error（assert.throws 的抛错契约保持不变）。 */
function decode<T>(raw: unknown, schema: ZodType<T>): T {
  const r = SerializationDecode.decode(raw, schema);
  if (!r.ok) throw r.error;
  return r.value;
}
import {  projectAgentConfigSchema, projectAgentModeSchema  } from "../../src/domain/chat/model/project-agent-config.schema.js";
import {  agentDefinitionSchema  } from "@novel-master/core/agent";
import {  AppErrorOps  } from "@novel-master/core/errors";
import {  tCore  } from "../helpers/core-i18n.js";

function minimalDefinitionWire() {
  return {
    schemaVersion: 1 as const,
    name: "项目专属",
    prompts: { persist: {}, dynamic: {} },
  };
}

describe("projectAgentConfigSchema", () => {
  it("follow 无 definition 合法", () => {
    const config = decode({ mode: "follow" }, projectAgentConfigSchema);
    assert.equal(config.mode, "follow");
    assert.equal(config.definition, undefined);
  });

  it("follow 可保留 definition 草稿", () => {
    const config = decode({ mode: "follow", definition: minimalDefinitionWire() }, projectAgentConfigSchema);
    assert.equal(config.mode, "follow");
    assert.equal(config.definition?.name, "项目专属");
  });

  it("custom 含 definition 合法", () => {
    const config = decode({ mode: "custom", definition: minimalDefinitionWire() }, projectAgentConfigSchema);
    assert.equal(config.mode, "custom");
    assert.equal(config.definition?.name, "项目专属");
  });

  it("custom 缺 definition 拒绝", () => {
    assert.throws(() => decode({ mode: "custom" }, projectAgentConfigSchema), (e: unknown) => AppErrorOps.is(e, "CONFIG_DECODE_INVALID_SCHEMA"));
  });

  it("非法 mode 拒绝", () => {
    assert.throws(() => decode({ mode: "registry" }, projectAgentModeSchema), (e: unknown) => AppErrorOps.is(e, "CONFIG_DECODE_INVALID_SCHEMA"));
  });

  it("configToWire 对重名块 definition 返回 Err（第二份同款循环已被收敛点覆盖）", () => {
    // configToWire 转调 agentDefinitionSchema.toWire，两条塌缩循环的收敛点
    // 就是 definitionToDocument；这条钉住「即便绕过 AgentDefinitionValidator.validate
    // 直接走 projectAgentConfigSchema.toWire，收敛点仍能兜住」。
    // toWire 已改返回 Result（五期门⑦）：块名唯一性门禁失败沿 Result.err
    // 回传，不再抛——错误本体（key / messageKey）与旧 throw 契约一致。
    const base = decode(minimalDefinitionWire(), agentDefinitionSchema);
    const dup = {
      ...base,
      prompts: {
        ...base.prompts,
        persist: [
          {
            name: "persona",
            type: "text" as const,
            role: "user" as const,
            content: "人设甲",
          },
          {
            name: "persona",
            type: "text" as const,
            role: "user" as const,
            content: "人设乙",
          },
        ],
      },
    };
    const wire = projectAgentConfigSchema.toWire({
      mode: "custom",
      definition: dup,
    });
    assert.ok(!wire.ok, "重名块 toWire 必须失败（块名唯一性门禁 RT-04）");
    assert.ok(AppErrorOps.is(wire.error, "PROMPT_INVALID_LAYOUT") && wire.error.messageKey === "error.prompt.invalid_layout.duplicate_block_name");
  });
});

/** 错误用户可见文案：带 messageKey 时经 tCore 渲染（G1-G3 descriptor 契约），否则回退 message。 */
function renderError(error: unknown): string {
  const e = error as {message: string; messageKey?: string; messageParams?: Record<string, unknown>};
  return textOf(error);
}

/** 含 cause 链（ToolError 包装 AppError 时 messageKey 在 cause 上）。 */
function textOf(error: unknown): string {
  const e = error as {message: string; messageKey?: string; messageParams?: Record<string, unknown>; cause?: unknown};
  if (e.messageKey != null) return tCore({key: e.messageKey as never, params: e.messageParams as never});
  if (e.cause != null && typeof e.cause === "object") return textOf(e.cause);
  return e.message;
}
