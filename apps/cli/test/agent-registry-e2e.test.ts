import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runNm, parseAgentId } from "./helpers.js";

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

  // N-P0-03 缺陷①：全新库上 CLI 没有任何创建 agent 的入口 ⇒ session create 必失败。
  it("N-P0-03-1: nm agent create 在空库上退出码 0，stdout 恰一行 UUID", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-agent-create-"));
    const dbPath = join(dir, "novel.db");
    try {
      const created = runNm([
        "agent",
        "create",
        "--name",
        "smoke",
        "--db",
        dbPath,
      ]);
      assert.equal(created.status, 0, created.stderr);

      // stdout 恰为 1 行（不调用 stripBootLogs：断言本身就是 stdout 洁净的牙齿）
      const lines = created.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      assert.equal(lines.length, 1, `stdout 不止一行: ${created.stdout}`);
      const agentId = parseAgentId(created.stdout);

      // 落在 registry 里：list 能看到名字，show 能按 UUID 取回定义
      const listed = runNm(["agent", "list", "--db", dbPath]);
      assert.equal(listed.status, 0, listed.stderr);
      assert.match(listed.stdout, /smoke/);

      const shown = runNm(["agent", "show", agentId, "--db", dbPath]);
      assert.equal(shown.status, 0, shown.stderr);
      assert.match(shown.stdout, /"name"\s*:\s*"smoke"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("N-P0-03-2: nm agent create 后 nm session create 不再失败（全新库第一个会话）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-first-session-"));
    const dbPath = join(dir, "novel.db");
    try {
      const proj = runNm(["project", "create", "--db", dbPath, "--name", "p"]);
      assert.equal(proj.status, 0, proj.stderr);
      const projectId = proj.stdout.trim();

      // 先建 agent（缺陷①的修法），再建会话
      const created = runNm(["agent", "create", "--name", "smoke", "--db", dbPath]);
      assert.equal(created.status, 0, created.stderr);
      assert.ok(parseAgentId(created.stdout));

      const sess = runNm([
        "session",
        "create",
        "--db",
        dbPath,
        "--project",
        projectId,
        "--title",
        "t1",
      ]);
      assert.equal(sess.status, 0, sess.stderr);
      assert.match(
        sess.stdout.trim(),
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      // stdout 洁净断言：直接 includes，**不**调 stripBootLogs（否则恒真）
      assert.equal(
        sess.stdout.includes("[nm-boot]"),
        false,
        `session create stdout 被 [nm-boot] 污染: ${sess.stdout}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("N-P0-03-3: 首次打开全新库的 stdout 不含 [nm-boot] 迁移日志", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-stdout-clean-"));
    const dbPath = join(dir, "novel.db");
    try {
      // 首个打开该 db 的命令会触发 6 条 schema migration —— 这才有牙齿
      const proj = runNm(["project", "create", "--db", dbPath, "--name", "p2"]);
      assert.equal(proj.status, 0, proj.stderr);
      assert.equal(
        proj.stdout.includes("[nm-boot]"),
        false,
        `project create stdout 被 [nm-boot] 污染: ${proj.stdout}`,
      );
      const lines = proj.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      assert.equal(lines.length, 1, `stdout 应恰 1 行 project UUID: ${proj.stdout}`);
      // 迁移日志改走 stderr 后仍应可见（内容一字未改）
      assert.match(proj.stderr, /\[nm-boot\] migration run:/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
