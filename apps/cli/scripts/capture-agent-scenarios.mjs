/**
 * Runs agent CLI scenarios 7–12 with NM_AGENT_MOCK_LLM and prints cli-test blocks.
 * Usage: node apps/cli/scripts/capture-agent-scenarios.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_ENTRY = join(CLI_ROOT, "src", "index.ts");
const dir = mkdtempSync(join(tmpdir(), "nm-agent-capture-"));
const dbPath = join(dir, "novel.db");

const MOCK_BASE = {
  NM_AGENT_MOCK_LLM: "1",
  NO_COLOR: "1",
};

function run(args, env = {}) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, ...args],
    {
      cwd: CLI_ROOT,
      encoding: "utf8",
      env: { ...process.env, ...MOCK_BASE, ...env },
    },
  );
  return {
    status: result.status,
    stdout: (result.stdout ?? "").trimEnd(),
    stderr: (result.stderr ?? "").trimEnd(),
    cmd: `node --import tsx apps/cli/src/index.ts ${args.join(" ")}`,
  };
}

function block(title, r) {
  console.log(`## ${title}\n`);
  console.log("```bash");
  console.log(`cd apps/cli`);
  console.log(r.cmd.replace("apps/cli/src/index.ts", "src/index.ts"));
  console.log("```\n");
  console.log(`退出码: ${r.status}\n`);
  if (r.stdout) {
    console.log("标准输出:");
    console.log("```");
    console.log(r.stdout);
    console.log("```\n");
  }
  if (r.stderr) {
    console.log("标准错误:");
    console.log("```");
    console.log(r.stderr);
    console.log("```\n");
  }
  console.log("---\n");
}

try {
  const projectId = run(["project", "create", "--name", "AgentCapture", "--db", dbPath]).stdout.trim();
  run(["project", "use", "--project", projectId, "--db", dbPath]);
  const sessionId = run([
    "session",
    "create",
    "--project",
    projectId,
    "--db",
    dbPath,
  ]).stdout.trim();
  run(["session", "use", "--session", sessionId, "--db", dbPath]);

  const modelFlag = ["--modelId", "mock/test", "--db", dbPath];

  block(
    "场景 7 — 单步 continue（mock LLM）",
    run(
      ["agent", "continue", "--content", "step one", ...modelFlag],
      { NM_AGENT_MOCK_SCENARIO: "continue" },
    ),
  );

  block(
    "场景 8 — 多步 run（mock LLM）",
    run(
      ["agent", "run", "--content", "multi", "--max-steps", "3", ...modelFlag],
      { NM_AGENT_MOCK_SCENARIO: "run" },
    ),
  );

  block(
    "场景 9 — vfs tool（mock LLM）",
    run(
      ["agent", "continue", "--content", "write file", ...modelFlag],
      { NM_AGENT_MOCK_SCENARIO: "vfs" },
    ),
  );

  block(
    "场景 10 — streaming（mock LLM）",
    run(
      ["agent", "continue", "--content", "stream please", ...modelFlag],
      { NM_AGENT_MOCK_SCENARIO: "stream" },
    ),
  );

  block(
    "场景 11 — doom_loop（mock LLM）",
    run(
      ["agent", "continue", "--content", "doom", ...modelFlag],
      { NM_AGENT_MOCK_SCENARIO: "doom" },
    ),
  );

  const compactDir = mkdtempSync(join(tmpdir(), "nm-agent-compact-"));
  const compactDb = join(compactDir, "novel.db");
  const compactProject = run([
    "project",
    "create",
    "--name",
    "CompactOnly",
    "--db",
    compactDb,
  ]).stdout.trim();
  run(["project", "use", "--project", compactProject, "--db", compactDb]);
  const compactSession = run([
    "session",
    "create",
    "--project",
    compactProject,
    "--db",
    compactDb,
  ]).stdout.trim();
  run(["session", "use", "--session", compactSession, "--db", compactDb]);
  for (let i = 0; i < 10; i++) {
    run([
      "message",
      "append",
      "--role",
      "user",
      "--content",
      `long history line ${i} `.repeat(40),
      "--db",
      compactDb,
    ]);
  }
  run([
    "config",
    "set",
    "--key",
    "agent.compaction.thresholdTokens",
    "--value",
    "10",
    "--db",
    compactDb,
  ]);
  run([
    "config",
    "set",
    "--key",
    "agent.compaction.keepLastN",
    "--value",
    "2",
    "--db",
    compactDb,
  ]);

  const compactionRun = run(
    ["agent", "continue", "--content", "compact me", "--modelId", "mock/test", "--db", compactDb],
    { NM_AGENT_MOCK_SCENARIO: "compaction" },
  );
  const listAfter = run(["message", "list", "--db", compactDb]);
  block("场景 12 — compaction（mock LLM）", {
    ...compactionRun,
    stdout: [compactionRun.stdout, "", "--- message list ---", listAfter.stdout]
      .filter(Boolean)
      .join("\n"),
  });

  const compactDbNote = compactDb;
  rmSync(compactDir, { recursive: true, force: true });

  console.log(
    `备注: mock 启用 NM_AGENT_MOCK_LLM=1；场景 7–11 库 ${dir}；场景 12 独立库 ${compactDbNote}`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
