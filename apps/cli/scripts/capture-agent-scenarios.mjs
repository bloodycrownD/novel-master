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
 *   node apps/cli/scripts/capture-agent-scenarios.mjs --scenario 9
 *   NM_AGENT_MOCK_LLM=1 node apps/cli/scripts/capture-agent-scenarios.mjs
 *
 * Scenario 9 sets OPENAI_TOOL_CHOICE_REQUIRED=1 to force tool_choice=required.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const ZHIPU_TOOL_MODEL_PREFERENCE = [
  "glm-4-flash",
  "glm-4-plus",
  "glm-4-air",
  "glm-4.6",
];
const VFS_TOOL_PROMPT =
  "You MUST call vfs.write with path /agent-test.txt and content hello-zhipu. " +
  "Do not describe or explain; invoke the tool now.";

function parseArgv(argv) {
  let explicitDb = null;
  const scenarios = new Set();
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--db" && argv[i + 1]) {
      explicitDb = resolve(argv[++i]);
    } else if (argv[i] === "--scenario" && argv[i + 1]) {
      scenarios.add(Number(argv[++i]));
    }
  }
  return {
    explicitDb,
    scenarios: scenarios.size > 0 ? scenarios : null,
  };
}

function shouldRunScenario(scenarios, n) {
  return scenarios == null || scenarios.has(n);
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

const { explicitDb, scenarios } = parseArgv(process.argv);
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

function findProviderByDisplayName(listStdout, displayName) {
  return listStdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, name, protocol, baseUrl, apiKeyStatus] = line.split("\t");
      return { id, name, protocol, baseUrl, apiKeyStatus };
    })
    .find((row) => row.name === displayName);
}

function assertZhipuReady(targetDb) {
  const envKey = process.env.NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY;
  const list = run(["provider", "list", "--db", targetDb]);
  const zhipu = findProviderByDisplayName(list.stdout, "Zhipu GLM");
  if (!zhipu) {
    console.error(
      "capture-agent-scenarios: Zhipu GLM provider not found in database.\n" +
        `  db: ${targetDb}\n` +
        "  Fix: nm provider create --name \"Zhipu GLM\" --protocol openai " +
        `--baseUrl ${ZHIPU_BASE} --apiKey <key> --db <db>\n` +
        "  Or: set NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY",
    );
    process.exit(1);
  }
  if (!zhipu.apiKeyStatus?.includes("apiKey: set") && !envKey) {
    console.error(
      "capture-agent-scenarios: zhipu apiKey is not set and NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY is unset.\n" +
        `  db: ${targetDb}\n` +
        `  Fix: nm provider edit --providerId ${zhipu.id} --apiKey <key> --db <db>\n` +
        "  Or: export NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY=<key>",
    );
    process.exit(1);
  }
  return zhipu.id;
}

function ensureZhipuProvider(targetDb) {
  const list = run(["provider", "list", "--db", targetDb]);
  if (findProviderByDisplayName(list.stdout, "Zhipu GLM")) {
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
    "--name",
    "Zhipu GLM",
    "--protocol",
    "openai",
    "--baseUrl",
    ZHIPU_BASE,
    "--apiKey",
    apiKey,
    "--db",
    targetDb,
  ]);
}

function setupZhipuModel(targetDb, useProjectDb, providerId) {
  if (!useProjectDb) {
    run(["provider", "use", "--providerId", providerId, "--db", targetDb]);
    const hasKey = Boolean(process.env.NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY);
    if (hasKey) {
      run([
        "provider",
        "model",
        "fetch",
        "--providerId",
        providerId,
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
    providerId,
    "--db",
    targetDb,
  ]);
  const firstLine = listed.stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine) {
    const savedId = firstLine.split("\t")[0];
    if (savedId) {
      return savedId;
    }
  }
  if (useProjectDb) {
    console.error(
      "capture-agent-scenarios: no zhipu saved model in database.\n" +
        `  Fix: nm provider model save --vendorModelId glm-4-flash --providerId ${providerId} --db <db>`,
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
    providerId,
    "--db",
    targetDb,
  ]);
  const after = run([
    "provider",
    "model",
    "list",
    "--providerId",
    providerId,
    "--db",
    targetDb,
  ]);
  const row = after.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [id, , vendorModelId] = l.split("\t");
      return { id, vendorModelId };
    })
    .find((r) => r.vendorModelId === vendor);
  if (!row?.id) {
    console.error("capture-agent-scenarios: failed to save glm-4-flash");
    process.exit(1);
  }
  return row.id;
}

function listZhipuSavedModels(targetDb, providerId) {
  const listed = run([
    "provider",
    "model",
    "list",
    "--providerId",
    providerId,
    "--db",
    targetDb,
  ]);
  return listed.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const [id, , vendorModelId] = l.split("\t");
      return { id, vendorModelId };
    })
    .filter((r) => r.id && r.vendorModelId);
}

function pickZhipuToolModel(targetDb, providerId, fallbackModelId) {
  const envModel = process.env.NM_CAPTURE_ZHIPU_MODEL;
  const rows = listZhipuSavedModels(targetDb, providerId);
  if (envModel) {
    const byId = rows.find((r) => r.id === envModel);
    if (byId) {
      return byId.id;
    }
    const byVendor = rows.find((r) => r.vendorModelId === envModel);
    if (byVendor) {
      return byVendor.id;
    }
  }
  for (const vendor of ZHIPU_TOOL_MODEL_PREFERENCE) {
    const found = rows.find((r) => r.vendorModelId === vendor);
    if (found) {
      return found.id;
    }
  }
  return fallbackModelId;
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
    const create = run([
      "provider",
      "create",
      "--name",
      "mock",
      "--protocol",
      "openai",
      "--baseUrl",
      "http://127.0.0.1/v1",
      "--apiKey",
      "test",
      "--db",
      mockDbPath,
    ]);
    const mockProviderId = create.stderr.trim().split(/\r?\n/).filter(Boolean).at(-1);
    run([
      "provider",
      "use",
      "--providerId",
      mockProviderId,
      "--db",
      mockDbPath,
    ]);
    run([
      "provider",
      "model",
      "create",
      "--vendorModelId",
      "test",
      "--db",
      mockDbPath,
    ]);
    const mockModels = run([
      "provider",
      "model",
      "list",
      "--db",
      mockDbPath,
    ]);
    const mockModelId = mockModels.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split("\t")[0])
      .find(Boolean);
    const modelFlag = ["--modelId", mockModelId, "--db", mockDbPath];
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
  let zhipuProviderId = assertZhipuReady(dbPath);
  if (isTemp) {
    ensureZhipuProvider(dbPath);
    zhipuProviderId = assertZhipuReady(dbPath);
  }

  const useProjectDb = !isTemp;
  const modelId = setupZhipuModel(dbPath, useProjectDb, zhipuProviderId);

  const modelFlag = ["--modelId", modelId, "--db", dbPath];
  const zhipuNote = `provider ${zhipuProviderId}, baseUrl ${ZHIPU_BASE}, model ${modelId}, db ${dbPath}`;

  function runZhipuScenario(title, args, extraEnv = {}) {
    createCaptureScope(dbPath, CAPTURE_PROJECT);
    block(title, run(args, extraEnv), zhipuNote);
  }

  function runZhipuVfsToolScenario() {
    createCaptureScope(dbPath, CAPTURE_PROJECT);
    const vfsModelId = pickZhipuToolModel(dbPath, zhipuProviderId, modelId);
    const vfsModelFlag = ["--modelId", vfsModelId, "--db", dbPath];
    const toolEnv = { OPENAI_TOOL_CHOICE_REQUIRED: "1" };

    const continueRun = run(
      ["agent", "continue", "--content", VFS_TOOL_PROMPT, ...vfsModelFlag],
      toolEnv,
    );
    const listAfter = run(["message", "list", "--db", dbPath]);
    const vfsRead = run([
      "session",
      "vfs",
      "read",
      "/agent-test.txt",
      "--db",
      dbPath,
    ]);

    const hasToolUse = /\[tool_use\]|tool_use/.test(listAfter.stdout);
    const hasToolResult = /\[tool_result\]|tool_result/.test(listAfter.stdout);
    const vfsOk =
      vfsRead.status === 0 && vfsRead.stdout.includes("hello-zhipu");

    let notes =
      `${zhipuNote}; vfs model ${vfsModelId}; OPENAI_TOOL_CHOICE_REQUIRED=1`;
    if (!hasToolUse || !hasToolResult) {
      notes += "; WARNING: message list missing tool_use/tool_result";
    }
    if (!vfsOk) {
      notes += "; WARNING: VFS /agent-test.txt missing or wrong content";
    }

    const cmdLines = [
      `node --import tsx apps/cli/src/index.ts agent continue --content "${VFS_TOOL_PROMPT}" ${vfsModelFlag.join(" ")}`,
      "# OPENAI_TOOL_CHOICE_REQUIRED=1",
      `node --import tsx apps/cli/src/index.ts message list --db ${dbPath}`,
      `node --import tsx apps/cli/src/index.ts session vfs read /agent-test.txt --db ${dbPath}`,
    ];

    block(
      "场景 9 — vfs tool（zhipu 真机）",
      {
        status: continueRun.status,
        stdout: [
          continueRun.stdout,
          "",
          "--- message list ---",
          listAfter.stdout,
          "",
          "--- session vfs read /agent-test.txt ---",
          vfsRead.status === 0
            ? vfsRead.stdout
            : `(exit ${vfsRead.status}) ${vfsRead.stderr || vfsRead.stdout || "not found"}`,
        ]
          .filter(Boolean)
          .join("\n"),
        stderr: continueRun.stderr,
        cmd: cmdLines.join("\n"),
      },
      notes,
    );
  }

  if (shouldRunScenario(scenarios, 7)) {
    runZhipuScenario(
      "场景 7 — 单步 continue（zhipu 真机）",
      ["agent", "continue", "--content", "用一句话介绍你自己。", ...modelFlag],
    );
  }

  if (shouldRunScenario(scenarios, 8)) {
    runZhipuScenario("场景 8 — 多步 run（zhipu 真机）", [
      "agent",
      "run",
      "--content",
      "先说一句你好，然后结束。",
      "--max-steps",
      "3",
      ...modelFlag,
    ]);
  }

  if (shouldRunScenario(scenarios, 9)) {
    runZhipuVfsToolScenario();
  }

  if (scenarios != null && scenarios.size === 1 && scenarios.has(9)) {
    process.exit(0);
  }

  if (shouldRunScenario(scenarios, 10)) {
    runZhipuScenario("场景 10 — streaming（zhipu 真机）", [
    "agent",
    "continue",
    "--content",
    "请流式回复：streaming ok",
      ...modelFlag,
    ]);
  }

  if (shouldRunScenario(scenarios, 11)) {
    const doomCreate = run([
      "provider",
      "create",
      "--name",
      "mock",
      "--protocol",
      "openai",
      "--baseUrl",
      "http://127.0.0.1/v1",
      "--apiKey",
      "test",
      "--db",
      mockDbPath,
    ]);
    const doomProviderId = doomCreate.stderr
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .at(-1);
    run([
      "provider",
      "use",
      "--providerId",
      doomProviderId,
      "--db",
      mockDbPath,
    ]);
    run([
      "provider",
      "model",
      "create",
      "--vendorModelId",
      "test",
      "--db",
      mockDbPath,
    ]);
    const doomModelId = run([
      "provider",
      "model",
      "list",
      "--db",
      mockDbPath,
    ])
      .stdout.split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split("\t")[0])
      .find(Boolean);
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
          doomModelId,
          "--db",
          mockDbPath,
        ],
        { NM_AGENT_MOCK_LLM: "1", NM_AGENT_MOCK_SCENARIO: "doom" },
      ),
      "显式 mock：NM_AGENT_MOCK_LLM=1 + NM_AGENT_MOCK_SCENARIO=doom（独立 temp db）",
    );
  }

  if (!shouldRunScenario(scenarios, 12)) {
    console.log(
      `备注: 场景 7–10、12 使用 zhipu 真机（db ${dbPath}）；场景 11 为 mock（temp）。` +
        ` API key 来自 SKSP/DB 或 NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY。`,
    );
    process.exit(0);
  }

  const compactAgentDir = mkdtempSync(join(tmpdir(), "nm-compact-agent-"));
  const compactAgentPath = join(compactAgentDir, "agent.yaml");
  const compactConditionsPath = join(compactAgentDir, "conditions.yaml");
  writeFileSync(
    compactAgentPath,
    [
      "schemaVersion: 1",
      "name: capture-compact",
      `model:`,
      `  savedModelId: ${modelId}`,
      "prompts:",
      "  blocks:",
      "    - name: c",
      "      type: chat",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    compactConditionsPath,
    [
      "schemaVersion: 3",
      "enabled: true",
      "visibleFloor: 2",
      "",
    ].join("\n"),
    "utf8",
  );

  createCaptureScope(dbPath, COMPACT_PROJECT);
  run([
    "compaction-conditions",
    "clear",
    "--db",
    dbPath,
  ]);
  run([
    "compaction-conditions",
    "set",
    "--file",
    compactConditionsPath,
    "--db",
    dbPath,
  ]);
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

  const compactionRun = run([
    "agent",
    "continue",
    "--content",
    "请简短总结上文并回复 done",
    "--agent-config",
    compactAgentPath,
    "--db",
    dbPath,
  ]);
  const listAfter = run(["message", "list", "--db", dbPath]);

  rmSync(compactAgentDir, { recursive: true, force: true });

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
