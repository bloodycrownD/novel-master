/**
 * Runs agent CLI scenarios 7–12 and prints cli-test blocks.
 *
 * Default DB: NOVEL_MASTER_DB → .novel-master/novel.db (if exists) → temp db.
 * Project DB: reuses existing zhipu provider (SKSP apiKey); capture projects only.
 *
 * Requires zhipu with apiKey in DB, or NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY.
 * Scenario 11 (doom_loop) always uses mock on a temp db.
 *
 * Usage:
 *   node apps/cli/scripts/capture-agent-scenarios.mjs [--db <path>]
 *   NM_AGENT_MOCK_LLM=1 node apps/cli/scripts/capture-agent-scenarios.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = resolve(CLI_ROOT, "../..");
const CLI_ENTRY = join(CLI_ROOT, "src", "index.ts");
const USE_MOCK = process.env.NM_AGENT_MOCK_LLM === "1";
const ZHIPU_BASE = "https://open.bigmodel.cn/api/coding/paas/v4";
const CAPTURE_PROJECT = "AgentCaptureZhipu";
const COMPACT_PROJECT = "CompactZhipu";

function parseArgv(argv) {
  let explicitDb = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--db" && argv[i + 1]) {
      explicitDb = resolve(argv[++i]);
      i++;
    }
  }
  return { explicitDb };
}

function resolveDbPath(explicitDb) {
  if (explicitDb) {
    return { dbPath: explicitDb, isTemp: false, tempDir: null };
  }
  if (process.env.NOVEL_MASTER_DB) {
    return {
      dbPath: resolve(process.env.NOVEL_MASTER_DB),
      isTemp: false,
      tempDir: null,
    };
  }
  const projectDb = resolve(REPO_ROOT, ".novel-master/novel.db");
  if (existsSync(projectDb)) {
    return { dbPath: projectDb, isTemp: false, tempDir: null };
  }
  const tempDir = mkdtempSync(join(tmpdir(), "nm-agent-capture-"));
  return { dbPath: join(tempDir, "novel.db"), isTemp: true, tempDir };
}

const { explicitDb } = parseArgv(process.argv);
const { dbPath, isTemp, tempDir } = resolveDbPath(explicitDb);

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

function ensureChatMessageHiddenColumn(targetDb) {
  const script = `
    const Database = require("better-sqlite3");
    const db = new Database(process.argv[1]);
    const cols = db.prepare("PRAGMA table_info(chat_message)").all().map((r) => r.name);
    if (!cols.includes("hidden")) {
      db.exec("ALTER TABLE chat_message ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
    }
    db.close();
  `;
  spawnSync(process.execPath, ["-e", script, targetDb], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

function assertZhipuReady(targetDb) {
  const envKey = process.env.NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY;
  const list = run(["provider", "list", "--db", targetDb]);
  const zhipuLine = list.stdout
    .split("\n")
    .find((line) => line.startsWith("zhipu\t"));
  if (!zhipuLine) {
    console.error(
      "capture-agent-scenarios: zhipu provider not found in database.\n" +
        `  db: ${targetDb}\n` +
        "  Fix: nm provider create --providerId zhipu --protocol openai " +
        `--baseUrl ${ZHIPU_BASE} --apiKey <key> --db <db>\n` +
        "  Or: set NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY",
    );
    process.exit(1);
  }
  if (!zhipuLine.includes("apiKey: set") && !envKey) {
    console.error(
      "capture-agent-scenarios: zhipu apiKey is not set and NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY is unset.\n" +
        `  db: ${targetDb}\n` +
        "  Fix: nm provider edit --providerId zhipu --apiKey <key> --db <db>\n" +
        "  Or: export NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY=<key>",
    );
    process.exit(1);
  }
}

function ensureZhipuProvider(targetDb) {
  const list = run(["provider", "list", "--db", targetDb]);
  if (list.stdout.split("\n").some((line) => line.startsWith("zhipu\t"))) {
    return;
  }
  const apiKey =
    process.env.NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY ??
    process.env.ZHIPU_API_KEY ??
    "";
  if (!apiKey) {
    return;
  }
  run([
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
    "--apiKey",
    apiKey,
    "--db",
    targetDb,
  ]);
}

function setupZhipuModel(targetDb, useProjectDb) {
  if (!useProjectDb) {
    run(["provider", "use", "--providerId", "zhipu", "--db", targetDb]);
    const hasKey = Boolean(process.env.NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY);
    if (hasKey) {
      run([
        "provider",
        "model",
        "fetch",
        "--providerId",
        "zhipu",
        "--db",
        targetDb,
      ]);
    }
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
  if (useProjectDb) {
    console.error(
      "capture-agent-scenarios: no zhipu application model in database.\n" +
        "  Fix: nm provider model save --vendorModelId glm-4-flash --providerId zhipu --db <db>",
    );
    process.exit(1);
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

function configGet(targetDb, key) {
  const r = run(["config", "get", "--key", key, "--db", targetDb]);
  if (r.status !== 0) {
    return null;
  }
  return r.stdout.trim();
}

function configSet(targetDb, key, value) {
  run(["config", "set", "--key", key, "--value", value, "--db", targetDb]);
}

function configReset(targetDb, key) {
  run(["config", "reset", "--key", key, "--db", targetDb]);
}

function createCaptureScope(targetDb, projectName) {
  const projectId = run([
    "project",
    "create",
    "--name",
    projectName,
    "--db",
    targetDb,
  ]).stdout.trim();
  run(["project", "use", "--project", projectId, "--db", targetDb]);
  const sessionId = run([
    "session",
    "create",
    "--project",
    projectId,
    "--db",
    targetDb,
  ]).stdout.trim();
  run(["session", "use", "--session", sessionId, "--db", targetDb]);
  return { projectId, sessionId };
}

const mockTempDir = mkdtempSync(join(tmpdir(), "nm-agent-mock-"));
const mockDbPath = join(mockTempDir, "novel.db");

try {
  if (USE_MOCK) {
    const modelFlag = ["--modelId", "mock/test", "--db", mockDbPath];
    createCaptureScope(mockDbPath, "AgentCapture");
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

  if (!isTemp) {
    ensureChatMessageHiddenColumn(dbPath);
  }
  assertZhipuReady(dbPath);
  if (isTemp) {
    ensureZhipuProvider(dbPath);
    assertZhipuReady(dbPath);
  }

  const useProjectDb = !isTemp;
  const modelId = setupZhipuModel(dbPath, useProjectDb);

  const modelFlag = ["--modelId", modelId, "--db", dbPath];
  const zhipuNote = `provider zhipu, baseUrl ${ZHIPU_BASE}, model ${modelId}, db ${dbPath}`;

  function runZhipuScenario(title, args) {
    createCaptureScope(dbPath, CAPTURE_PROJECT);
    block(title, run(args, {}), zhipuNote);
  }

  runZhipuScenario(
    "场景 7 — 单步 continue（zhipu 真机）",
    ["agent", "continue", "--content", "用一句话介绍你自己。", ...modelFlag],
  );

  runZhipuScenario("场景 8 — 多步 run（zhipu 真机）", [
    "agent",
    "run",
    "--content",
    "先说一句你好，然后结束。",
    "--max-steps",
    "3",
    ...modelFlag,
  ]);

  runZhipuScenario("场景 9 — vfs tool（zhipu 真机）", [
    "agent",
    "continue",
    "--content",
    "请用 vfs.write 在项目 VFS 写入文件 /agent-test.txt，内容为 hello-zhipu",
    ...modelFlag,
  ]);

  runZhipuScenario("场景 10 — streaming（zhipu 真机）", [
    "agent",
    "continue",
    "--content",
    "请流式回复：streaming ok",
    ...modelFlag,
  ]);

  createCaptureScope(mockDbPath, "AgentCaptureMock");
  block(
    "场景 11 — doom_loop（mock LLM，非 zhipu）",
    run(
      [
        "agent",
        "continue",
        "--content",
        "doom",
        "--modelId",
        "mock/test",
        "--db",
        mockDbPath,
      ],
      { NM_AGENT_MOCK_LLM: "1", NM_AGENT_MOCK_SCENARIO: "doom" },
    ),
    "显式 mock：NM_AGENT_MOCK_LLM=1 + NM_AGENT_MOCK_SCENARIO=doom（独立 temp db）",
  );

  const prevThreshold = configGet(dbPath, "agent.compaction.thresholdTokens");
  const prevKeepLastN = configGet(dbPath, "agent.compaction.keepLastN");

  createCaptureScope(dbPath, COMPACT_PROJECT);
  for (let i = 0; i < 10; i++) {
    run([
      "message",
      "append",
      "--role",
      "user",
      "--content",
      `long history line ${i} `.repeat(40),
      "--db",
      dbPath,
    ]);
  }
  configSet(dbPath, "agent.compaction.thresholdTokens", "10");
  configSet(dbPath, "agent.compaction.keepLastN", "2");

  const compactionRun = run([
    "agent",
    "continue",
    "--content",
    "请简短总结上文并回复 done",
    ...modelFlag,
  ]);
  const listAfter = run(["message", "list", "--db", dbPath]);

  if (prevThreshold != null && prevThreshold !== "") {
    configSet(dbPath, "agent.compaction.thresholdTokens", prevThreshold);
  } else {
    configReset(dbPath, "agent.compaction.thresholdTokens");
  }
  if (prevKeepLastN != null && prevKeepLastN !== "") {
    configSet(dbPath, "agent.compaction.keepLastN", prevKeepLastN);
  } else {
    configReset(dbPath, "agent.compaction.keepLastN");
  }

  block("场景 12 — compaction（zhipu 真机）", {
    ...compactionRun,
    stdout: [compactionRun.stdout, "", "--- message list ---", listAfter.stdout]
      .filter(Boolean)
      .join("\n"),
  }, zhipuNote);

  console.log(
    `备注: 场景 7–10、12 使用 zhipu 真机（db ${dbPath}）；场景 11 为 mock（temp）。` +
      ` API key 来自 SKSP/DB 或 NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY。`,
  );
} finally {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  rmSync(mockTempDir, { recursive: true, force: true });
}
