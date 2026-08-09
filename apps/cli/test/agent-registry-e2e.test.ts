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
  it("E1 / AG3: import examples/agents.yaml then list contains writer, summarizer, general", async () => {
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
      assert.match(listed.stdout, /general/);
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
      assert.match(listed.stdout, /general/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("E4 / T-C3: tools + mode 导入导出闭环；mode 字段往返保留", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-agent-policy-"));
    const dbPath = join(dir, "novel.db");
    const bundlePath = join(dir, "policy-bundle.yaml");
    const exportPath = join(dir, "exported.yaml");
    const dbPath2 = join(dir, "novel-empty.db");
    try {
      await writeFile(
        bundlePath,
        [
          "schemaVersion: 1",
          "agents:",
          "  researcher:",
          "    prompts:",
          "      system: you are a researcher",
          "      persist: {}",
          "      dynamic: {}",
          "    tools:",
          "      allow:",
          "        - read",
          "        - grep",
          "    mode: subagent",
        ].join("\n"),
        "utf8",
      );

      const imported = runNm(["agent", "import", bundlePath, "--db", dbPath]);
      assert.equal(imported.status, 0, imported.stderr);

      // show 导入后的 agent，验证 tools 保留 + mode 字段导出
      const shown = runNm(["agent", "show", "researcher", "--db", dbPath]);
      assert.equal(shown.status, 0, shown.stderr);
      assert.match(shown.stdout, /mode"\s*:\s*"subagent"/);
      assert.match(shown.stdout, /"allow"\s*:\s*\[\s*"read"/);

      // 导出 → 空库重导入 → 字段仍在
      assert.equal(
        runNm(["agent", "export", exportPath, "--db", dbPath]).status,
        0,
      );
      const reimport = runNm(["agent", "import", exportPath, "--db", dbPath2]);
      assert.equal(reimport.status, 0, reimport.stderr);

      const shown2 = runNm(["agent", "show", "researcher", "--db", dbPath2]);
      assert.equal(shown2.status, 0, shown2.stderr);
      assert.match(shown2.stdout, /mode"\s*:\s*"subagent"/);
      assert.match(shown2.stdout, /"allow"\s*:\s*\[\s*"read"/);
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
      assert.match(show.stdout, /"tokenRatio":\s*0\.8/);
      assert.match(show.stdout, /"schemaVersion":\s*3/);
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
        ["schemaVersion: 2", "enabled: true", "tokenThreshold: 12000"].join("\n"),
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
        /schemaVersion|tokenRatio|visible-floor/i,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
