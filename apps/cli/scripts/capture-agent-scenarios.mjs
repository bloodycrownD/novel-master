/**
 * Runs agent CLI scenarios 7–12 and prints cli-test blocks.
 *
 * Default: zhipu real API (no NM_AGENT_MOCK_LLM). Requires
 * `NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY` or provider edit --apiKey.
 * Scenario 11 (doom_loop) always uses mock.
 *
 * Full mock path: NM_AGENT_MOCK_LLM=1 node apps/cli/scripts/capture-agent-scenarios.mjs
 *
 * Usage: node apps/cli/scripts/capture-agent-scenarios.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_ENTRY = join(CLI_ROOT, "src", "index.ts");
const USE_MOCK = process.env.NM_AGENT_MOCK_LLM === "1";
const ZHIPU_BASE = "https://open.bigmodel.cn/api/coding/paas/v4";

const dir = mkdtempSync(join(tmpdir(), "nm-agent-capture-"));
const dbPath = join(dir, "novel.db");

function run(args, env = {}) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, ...args],
    {
      cwd: CLI_ROOT,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
    },
  );
  return {
    status: result.status,
    stdout: (result.stdout ?? "").trimEnd(),
    stderr: (result.stderr ?? "").trimEnd(),
    cmd: `node --import tsx apps/cli/src/index.ts ${args.join(" ")}`,
  };
}

function block(title, r, notes = "") {
  console.log(`## ${title}\n`);
  console.log("```bash");
  console.log(`cd apps/cli`);
  if (!USE_MOCK && !title.includes("mock")) {
    console.log("# 未设置 NM_AGENT_MOCK_LLM");
  }
  if (title.includes("mock")) {
    console.log("set NM_AGENT_MOCK_LLM=1");
  }
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
  if (notes) {
    console.log(`备注: ${notes}\n`);
  }
  console.log("---\n");
}

function ensureZhipuProvider(targetDb = dbPath) {
  const list = run(["provider", "list", "--db", targetDb]);
  if (list.stdout.includes("zhipu\t")) {
    return;
  }
  const apiKey =
    process.env.NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY ??
    process.env.ZHIPU_API_KEY ??
    "";
  const createArgs = [
    "provider",
    "create",
    "--providerId",
    "zhipu",
    "--protocol",
    "openai",
    "--baseUrl",
    ZHIPU_BASE,
    "--displayName",
    "Zhipu GLM",
    "--db",
    targetDb,
  ];
  if (apiKey) {
    createArgs.push("--apiKey", apiKey);
  }
  run(createArgs);
}

function setupZhipuModel(targetDb = dbPath) {
  run(["provider", "use", "--providerId", "zhipu", "--db", targetDb]);
  const hasKey =
    Boolean(process.env.NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY) ||
    Boolean(process.env.ZHIPU_API_KEY);
  if (hasKey) {
    run(["provider", "model", "fetch", "--providerId", "zhipu", "--db", targetDb]);
  }
  const listed = run([
    "provider",
    "model",
    "list",
    "--providerId",
    "zhipu",
    "--db",
    targetDb,
  ]);
  const firstLine = listed.stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine) {
    const appId = firstLine.split(/\s+/)[0];
    if (appId?.includes("/")) {
      return appId;
    }
  }
  const vendor = "glm-4-flash";
  run([
    "provider",
    "model",
    "save",
    "--vendorModelId",
    vendor,
    "--providerId",
    "zhipu",
    "--db",
    targetDb,
  ]);
  return `zhipu/${vendor}`;
}

try {
  if (USE_MOCK) {
    const modelFlag = ["--modelId", "mock/test", "--db", dbPath];
    const projectId = run([
      "project",
      "create",
      "--name",
      "AgentCapture",
      "--db",
      dbPath,
    ]).stdout.trim();
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

    block(
      "场景 7 — 单步 continue（mock LLM）",
      run(
        ["agent", "continue", "--content", "step one", ...modelFlag],
        { NM_AGENT_MOCK_SCENARIO: "continue" },
      ),
      "NM_AGENT_MOCK_LLM=1",
    );
    process.exit(0);
  }

  ensureZhipuProvider();
  const modelId = setupZhipuModel();
  run(["model", "use", "--modelId", modelId, "--db", dbPath]);

  const projectId = run([
    "project",
    "create",
    "--name",
    "AgentCaptureZhipu",
    "--db",
    dbPath,
  ]).stdout.trim();
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

  const modelFlag = ["--modelId", modelId, "--db", dbPath];
  const zhipuNote = `provider zhipu, baseUrl ${ZHIPU_BASE}, model ${modelId}`;

  block(
    "场景 7 — 单步 continue（zhipu 真机）",
    run(["agent", "continue", "--content", "用一句话介绍你自己。", ...modelFlag]),
    zhipuNote,
  );

  block(
    "场景 8 — 多步 run（zhipu 真机）",
    run([
      "agent",
      "run",
      "--content",
      "先说一句你好，然后结束。",
      "--max-steps",
      "3",
      ...modelFlag,
    ]),
    zhipuNote,
  );

  block(
    "场景 9 — vfs tool（zhipu 真机）",
    run([
      "agent",
      "continue",
      "--content",
      "请用 vfs.write 在项目 VFS 写入文件 /agent-test.txt，内容为 hello-zhipu",
      ...modelFlag,
    ]),
    zhipuNote,
  );

  block(
    "场景 10 — streaming（zhipu 真机）",
    run([
      "agent",
      "continue",
      "--content",
      "请流式回复：streaming ok",
      ...modelFlag,
    ]),
    zhipuNote,
  );

  block(
    "场景 11 — doom_loop（mock LLM，非 zhipu）",
    run(
      ["agent", "continue", "--content", "doom", "--modelId", "mock/test", "--db", dbPath],
      { NM_AGENT_MOCK_LLM: "1", NM_AGENT_MOCK_SCENARIO: "doom" },
    ),
    "显式 mock：NM_AGENT_MOCK_LLM=1 + NM_AGENT_MOCK_SCENARIO=doom",
  );

  const compactDir = mkdtempSync(join(tmpdir(), "nm-agent-compact-"));
  const compactDb = join(compactDir, "novel.db");
  ensureZhipuProvider(compactDb);
  const compactModelId = setupZhipuModel(compactDb);
  run(["model", "use", "--modelId", compactModelId, "--db", compactDb]);
  const compactProject = run([
    "project",
    "create",
    "--name",
    "CompactZhipu",
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
    [
      "agent",
      "continue",
      "--content",
      "请简短总结上文并回复 done",
      "--modelId",
      compactModelId,
      "--db",
      compactDb,
    ],
  );
  const listAfter = run(["message", "list", "--db", compactDb]);
  block("场景 12 — compaction（zhipu 真机）", {
    ...compactionRun,
    stdout: [compactionRun.stdout, "", "--- message list ---", listAfter.stdout]
      .filter(Boolean)
      .join("\n"),
  }, zhipuNote);

  rmSync(compactDir, { recursive: true, force: true });

  console.log(
    `备注: 场景 7–10、12 使用 zhipu 真机（库 ${dir}）；场景 11 为 mock。` +
      ` API key 来源: NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY 或 provider create --apiKey。`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
