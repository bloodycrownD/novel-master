import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildToolResultBlock } from "@/domain/tool/logic/build-tool-result-block.js";
import {
  formatToolOutputForLlm,
} from "@/domain/tool/logic/format-tool-output.js";
import { resolveSubagentSessionId } from "@/domain/tool/logic/subagent-tool-session-id.js";

describe("subagent meta 透传链路", () => {
  it("T-T1: formatToolOutputForLlm 对 task 输出返回结构化 JSON（主 agent 可读 stopped / failureReason / text）", () => {
    const text = "子代理已完成：角色档案已生成。";
    const out = formatToolOutputForLlm({ text, subagentSessionId: "child-1" });
    // task 工具输出统一走 JSON——主 agent 从 content 里能同时拿到所有字段
    // （subagentSessionId 也在里面，它是 UI-only meta 的来源，不单独剩掉）。
    const parsed = JSON.parse(out);
    assert.equal(parsed.text, text);
    assert.equal(parsed.subagentSessionId, "child-1");
  });

  it("C33: subagentSessionId 与其他字段共存时同样走 JSON.stringify", () => {
    const out = formatToolOutputForLlm({
      text: "x",
      subagentSessionId: "child-1",
      extra: "y",
    });
    const parsed = JSON.parse(out);
    assert.equal(parsed.text, "x");
    assert.equal(parsed.subagentSessionId, "child-1");
    assert.equal(parsed.extra, "y");
  });

  it("T-T1: buildToolResultBlock 从 outcome.output.subagentSessionId 透传到 meta", () => {
    const block = buildToolResultBlock("tu1", {
      ok: true,
      output: { text: "hello", subagentSessionId: "child-7" },
    });
    assert.equal(block.ok, true);
    // content 是 task 输出的 JSON 壳。
    const parsed = JSON.parse(block.content);
    assert.equal(parsed.text, "hello");
    assert.equal(parsed.subagentSessionId, "child-7");
    // meta.subagentSessionId 同样透传。
    assert.equal(block.meta?.subagentSessionId, "child-7");
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

  it("T-A2: output.stopped=true → ok=false + content=JSON(含 text + failureReason) + meta 带 subagentSessionId + failureReason", () => {
    const block = buildToolResultBlock("tu-stop", {
      ok: true,
      output: {
        text: "子代理被中断前的末条文本",
        subagentSessionId: "child-stop",
        stopped: true,
        failureReason: "用户停止",
      },
    });
    // 关键：outcome.ok=true 但 output.stopped=true 时 tool_result 要标 ok=false。
    assert.equal(block.ok, false);
    // content 是 task 输出的 JSON 壳——主 agent 能从中读到 text + stopped + failureReason。
    const parsed = JSON.parse(block.content);
    assert.equal(parsed.text, "子代理被中断前的末条文本");
    assert.equal(parsed.stopped, true);
    assert.equal(parsed.failureReason, "用户停止");
    assert.equal(parsed.subagentSessionId, "child-stop");
    // meta 两字段都透传。
    assert.equal(block.meta?.subagentSessionId, "child-stop");
    assert.equal(block.meta?.failureReason, "用户停止");
  });

  it("T-A3: stopReason=completed → stopped 字段不出现 → tool_result ok=true（回归）", () => {
    // 正常完成路径：output 不含 stopped，走原有 ok=true 分支。
    const block = buildToolResultBlock("tu-ok", {
      ok: true,
      output: { text: "done", subagentSessionId: "child-ok" },
    });
    assert.equal(block.ok, true);
    // content 是 JSON 壳。
    const parsed = JSON.parse(block.content);
    assert.equal(parsed.text, "done");
    assert.equal(parsed.subagentSessionId, "child-ok");
    assert.equal(parsed.stopped, undefined);
    assert.equal(block.meta?.subagentSessionId, "child-ok");
    // 正常完成不应出现 failureReason。
    assert.equal(block.meta?.failureReason, undefined);
  });
});
