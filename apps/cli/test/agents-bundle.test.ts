import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { decode, parseText } from "@novel-master/core";
import { agentsBundleDocumentSchema } from "../src/agent/schemas/agents-bundle.schema.js";

const examplesAgentsYaml = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../examples/agents.yaml"
);

describe("agents bundle schema", () => {
  it("T-WT14: examples/agents.yaml writer 无 persist.canon", () => {
    const raw = readFileSync(examplesAgentsYaml, "utf8");
    const parsed = parseText(raw, "yaml");
    const doc = decode(parsed, agentsBundleDocumentSchema);
    assert.equal(doc.agents.writer!.prompts.persist.canon, undefined);
  });

  it("T-WT15: writer 无 worktree 块", () => {
    const doc = decode(
      {
        schemaVersion: 1,
        agents: {
          writer: {
            prompts: {
              system: "hi",
              persist: {},
              dynamic: {},
            },
          },
          summarizer: {
            prompts: { persist: {}, dynamic: {} },
          },
        },
      },
      agentsBundleDocumentSchema
    );
    assert.equal(Object.keys(doc.agents).length, 2);
    assert.equal(doc.agents.writer!.prompts.system, "hi");
    assert.equal(doc.agents.writer!.prompts.persist.canon, undefined);
    assert.deepEqual(doc.agents.summarizer!.prompts.persist, {});
  });

  it("T-C3a: bundle entry 含 tools + subagentCallable decode 保留字段", () => {
    const doc = decode(
      {
        schemaVersion: 1,
        agents: {
          researcher: {
            prompts: { persist: {}, dynamic: {}, system: "s" },
            tools: { allow: ["read", "grep", "task"] },
            subagentCallable: true,
          },
        },
      },
      agentsBundleDocumentSchema
    );
    const entry = doc.agents.researcher!;
    assert.deepEqual(entry.tools?.allow, ["read", "grep", "task"]);
    assert.equal(entry.tools?.deny, undefined);
    assert.equal(entry.subagentCallable, true);
  });

  it("T-C3b: 旧 bundle（无 tools / subagentCallable）仍可 decode（optional 兼容）", () => {
    const doc = decode(
      {
        schemaVersion: 1,
        agents: {
          legacy: {
            prompts: { persist: {}, dynamic: {} },
          },
        },
      },
      agentsBundleDocumentSchema
    );
    assert.equal(doc.agents.legacy!.tools, undefined);
    assert.equal(doc.agents.legacy!.subagentCallable, undefined);
  });

  it("T-C3c: bundle entry 对未声明字段返回失败（.strict() 验证）", () => {
    const parsed = agentsBundleDocumentSchema.safeParse({
      schemaVersion: 1,
      agents: {
        bad: {
          prompts: { persist: {}, dynamic: {} },
          unknownExtraField: 1,
        },
      },
    });
    assert.equal(parsed.success, false);
  });

  it("T-C3d: examples/agents.yaml 含 general 模板且 subagentCallable 缺省", () => {
    const raw = readFileSync(examplesAgentsYaml, "utf8");
    const parsed = parseText(raw, "yaml");
    const doc = decode(parsed, agentsBundleDocumentSchema);
    assert.equal(doc.agents.general?.prompts.system != null, true);
    // general 作为递归基线，subagentCallable 缺省（语义 false）
    assert.equal(doc.agents.general?.subagentCallable, undefined);
  });

  it("T-C3e: examples/agents.yaml general 模板含 description", () => {
    const raw = readFileSync(examplesAgentsYaml, "utf8");
    const parsed = parseText(raw, "yaml");
    const doc = decode(parsed, agentsBundleDocumentSchema);
    assert.equal(
      typeof doc.agents.general?.description,
      "string"
    );
    assert.ok((doc.agents.general?.description ?? "").length > 0);
  });

  it("T-C3f: bundle entry 含 description decode 保留字段", () => {
    const doc = decode(
      {
        schemaVersion: 1,
        agents: {
          researcher: {
            prompts: { persist: {}, dynamic: {}, system: "s" },
            description: "擅长代码检索。",
          },
        },
      },
      agentsBundleDocumentSchema
    );
    assert.equal(doc.agents.researcher?.description, "擅长代码检索。");
  });

  it("T-C3g: 旧 bundle（无 description）仍可 decode（optional 兼容）", () => {
    const doc = decode(
      {
        schemaVersion: 1,
        agents: {
          legacy: {
            prompts: { persist: {}, dynamic: {} },
          },
        },
      },
      agentsBundleDocumentSchema
    );
    assert.equal(doc.agents.legacy?.description, undefined);
  });
});
