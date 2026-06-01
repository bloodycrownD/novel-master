import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runNm } from "./helpers.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const EXAMPLES_AGENTS = join(REPO_ROOT, "examples", "agents.yaml");
const EXAMPLES_CONDITIONS = join(
  REPO_ROOT,
  "examples",
  "compaction-conditions.yaml",
);

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

  it("E3: compaction-conditions set and show from examples file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-conditions-"));
    const dbPath = join(dir, "novel.db");
    try {
      const set = runNm([
        "compaction-conditions",
        "set",
        "--file",
        EXAMPLES_CONDITIONS,
        "--db",
        dbPath,
      ]);
      assert.equal(set.status, 0, set.stderr);

      const show = runNm(["compaction-conditions", "show", "--db", dbPath]);
      assert.equal(show.status, 0, show.stderr);
      assert.match(show.stdout, /"enabled":\s*true/);
      assert.match(show.stdout, /"tokenThreshold":\s*12000/);
      assert.match(show.stdout, /"visibleFloor":\s*20/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects enabled conditions with no triggers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-conditions-bad-"));
    const dbPath = join(dir, "novel.db");
    const conditionsPath = join(dir, "conditions.yaml");
    try {
      await writeFile(
        conditionsPath,
        ["schemaVersion: 2", "enabled: true"].join("\n"),
        "utf8",
      );

      const set = runNm([
        "compaction-conditions",
        "set",
        "--file",
        conditionsPath,
        "--db",
        dbPath,
      ]);
      assert.notEqual(set.status, 0);
      assert.match(
        set.stderr + set.stdout,
        /at least one of tokenThreshold|visible-floor/i,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
