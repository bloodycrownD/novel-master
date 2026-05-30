import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runNm } from "./helpers.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const EXAMPLES_AGENTS = join(REPO_ROOT, "examples", "agents.yaml");

describe("agent registry e2e", () => {
  it("E1 / AG3: import examples/agents.yaml then list contains writer and summarizer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-agent-reg-"));
    const dbPath = join(dir, "novel.db");
    try {
      const imported = runNm(
        ["agent", "import", EXAMPLES_AGENTS, "--db", dbPath],
      );
      assert.equal(imported.status, 0, imported.stderr);
      assert.match(imported.stdout, /Imported 2 agent/);

      const listed = runNm(["agent", "list", "--db", dbPath]);
      assert.equal(listed.status, 0, listed.stderr);
      assert.match(listed.stdout, /writer/);
      assert.match(listed.stdout, /summarizer/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("E2: export round-trip to empty database", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-agent-export-"));
    const dbPath = join(dir, "novel.db");
    const exportPath = join(dir, "exported.yaml");
    const dbPath2 = join(dir, "novel-empty.db");
    try {
      assert.equal(
        runNm(["agent", "import", EXAMPLES_AGENTS, "--db", dbPath]).status,
        0,
      );
      assert.equal(
        runNm(["agent", "export", exportPath, "--db", dbPath]).status,
        0,
      );

      const reimport = runNm(["agent", "import", exportPath, "--db", dbPath2]);
      assert.equal(reimport.status, 0, reimport.stderr);

      const listed = runNm(["agent", "list", "--db", dbPath2]);
      assert.equal(listed.status, 0, listed.stderr);
      assert.match(listed.stdout, /writer/);
      assert.match(listed.stdout, /summarizer/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("E3: compaction set and show after agent import", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-agent-compact-"));
    const dbPath = join(dir, "novel.db");
    const policyPath = join(dir, "policy.yaml");
    try {
      assert.equal(
        runNm(["agent", "import", EXAMPLES_AGENTS, "--db", dbPath]).status,
        0,
      );

      await writeFile(
        policyPath,
        [
          "schemaVersion: 1",
          "trigger:",
          "  tokenThreshold: 1000",
          "action:",
          "  keepLastN: 4",
          "  abstract:",
          "    type: agent",
          "    agentId: summarizer",
        ].join("\n"),
        "utf8",
      );

      const set = runNm(["compaction", "set", "--file", policyPath, "--db", dbPath]);
      assert.equal(set.status, 0, set.stderr);

      const show = runNm(["compaction", "show", "--db", dbPath]);
      assert.equal(show.status, 0, show.stderr);
      assert.match(show.stdout, /"enabled":\s*true/);
      assert.match(show.stdout, /summarizer/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("AG2: compaction set rejects unknown agentId", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-agent-compact-bad-"));
    const dbPath = join(dir, "novel.db");
    const policyPath = join(dir, "policy.yaml");
    try {
      await writeFile(
        policyPath,
        [
          "schemaVersion: 1",
          "trigger:",
          "  tokenThreshold: 10",
          "action:",
          "  keepLastN: 2",
          "  abstract:",
          "    type: agent",
          "    agentId: does-not-exist",
        ].join("\n"),
        "utf8",
      );

      const set = runNm(["compaction", "set", "--file", policyPath, "--db", dbPath]);
      assert.notEqual(set.status, 0);
      assert.match(
        set.stderr + set.stdout,
        /AGENT_NOT_FOUND|agent not found|CompactionPolicyError/i,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
