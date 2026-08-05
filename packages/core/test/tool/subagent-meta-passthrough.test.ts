import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildToolResultBlock } from "@/domain/tool/logic/build-tool-result-block.js";
import {
  formatToolOutputForLlm,
} from "@/domain/tool/logic/format-tool-output.js";
import { resolveSubagentSessionId } from "@/domain/tool/logic/subagent-tool-session-id.js";

describe("subagent meta 透传链路", () => {
  it("T-T1: formatToolOutputForLlm 对 task 输出对象先剩 subagentSessionId 再提取 text", () => {
    const text = "子代理已完成：角色档案已生成。";
    const out = formatToolOutputForLlm({ text, subagentSessionId: "child-1" });
    assert.equal(out, text);
    // 不应被包成 JSON 壳。
    assert.ok(!out.includes('"text"'));
    assert.ok(!out.includes("subagentSessionId"));
  });

  it("C33: subagentSessionId 与其他字段共存时不强行提取 text（回落 JSON.stringify）", () => {
    const out = formatToolOutputForLlm({
      text: "x",
      subagentSessionId: "child-1",
      extra: "y",
    });
    // 非纯 {text, subagentSessionId} 形状，回落 JSON.stringify。
    assert.ok(out.includes('"text"'));
    assert.ok(out.includes("extra"));
  });

  it("T-T1: buildToolResultBlock 从 outcome.output.subagentSessionId 透传到 meta", () => {
    const block = buildToolResultBlock("tu1", {
      ok: true,
      output: { text: "hello", subagentSessionId: "child-7" },
    });
    assert.equal(block.ok, true);
    // content 是原始文本，不是 JSON 壳。
    assert.equal(block.content, "hello");
    // meta.subagentSessionId 透传。
    assert.equal(block.meta?.subagentSessionId, "child-7");
    // content 里不能含 subagentSessionId 字段（已剩掉）。
    assert.ok(!block.content.includes("subagentSessionId"));
  });

  it("T-T1: buildToolResultBlock 显式 meta.subagentSessionId 也生效（无 output 字段时）", () => {
    const block = buildToolResultBlock(
      "tu2",
      { ok: true, output: { version: 1 } },
      { subagentSessionId: "child-9" },
    );
    assert.equal(block.meta?.subagentSessionId, "child-9");
  });

  it("T-T1: 无 subagentSessionId 输出时不写 meta", () => {
    const block = buildToolResultBlock("tu3", {
      ok: true,
      output: { version: 1 },
    });
    assert.equal(block.meta, undefined);
  });

  it("C17: resolveSubagentSessionId 从 meta 读取（对称 vfs-tool-file-path）", () => {
    assert.equal(
      resolveSubagentSessionId({ meta: { subagentSessionId: "c1" } }),
      "c1",
    );
    assert.equal(resolveSubagentSessionId({ meta: {} }), undefined);
    assert.equal(resolveSubagentSessionId(undefined), undefined);
    assert.equal(
      resolveSubagentSessionId({ meta: { subagentSessionId: "" } }),
      undefined,
    );
  });
});
