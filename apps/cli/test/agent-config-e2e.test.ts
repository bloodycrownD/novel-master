import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readCliState, runNm, seedMockProviderModels } from "./helpers.js";

const MOCK_ENV = {
  NM_AGENT_MOCK_LLM: "1",
  NM_AGENT_MOCK_SCENARIO: "continue",
};

const MINIMAL_AGENT_YAML = `
schemaVersion: 1
name: e2e-agent
prompts:
  persist: {}
  dynamic: {}
`;

const MOCK_ENV_REPORT_MODEL = {
  ...MOCK_ENV,
  NM_AGENT_MOCK_REPORT_MODEL: "1",
};

function agentYamlWithPinnedModel(savedModelId: string): string {
  return `
schemaVersion: 1
name: e2e-pin
model: ${savedModelId}
prompts:
  persist: {}
  dynamic: {}
`;
}

function parseE2eRequestBody(stderr: string): Record<string, unknown> {
  const prefix = "NM_LLM_E2E_BODY:";
  const line = stderr.split(/\r?\n/).find((l) => l.includes(prefix));
  assert.ok(line, `expected ${prefix} in stderr`);
  const json = line!.slice(line!.indexOf(prefix) + prefix.length);
  return JSON.parse(json) as Record<string, unknown>;
}

describe("agent config CLI", () => {
  it("E1: --agent-config without model runs after model use", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-agent-cfg-"));
    const dbPath = join(dir, "novel.db");
    const agentPath = join(dir, "agent.yaml");
    try {
      await writeFile(agentPath, MINIMAL_AGENT_YAML, "utf8");

      const projectId = runNm(
        ["project", "create", "--name", "Cfg", "--db", dbPath],
        { env: MOCK_ENV },
      )
        .stdout.trim();
      runNm(["project", "use", "--project", projectId, "--db", dbPath], {
        env: MOCK_ENV,
      });
      const sessionId = runNm(
        ["session", "create", "--project", projectId, "--db", dbPath],
        { env: MOCK_ENV },
      )
        .stdout.trim();
      runNm(["session", "use", "--session", sessionId, "--db", dbPath], {
        env: MOCK_ENV,
      });
      const mockModels = seedMockProviderModels(dbPath, ["test"], MOCK_ENV);
      const savedModelId = mockModels.get("test")!;
      const modelUse = runNm(
        ["model", "use", "--modelId", savedModelId, "--db", dbPath],
        { env: MOCK_ENV },
      );
      assert.equal(modelUse.status, 0, modelUse.stderr);

      const agent = runNm(
        [
          "agent",
          "continue",
          "--content",
          "hello",
          "--agent-config",
          agentPath,
          "--db",
          dbPath,
        ],
        { env: MOCK_ENV },
      );
      assert.equal(agent.status, 0, agent.stderr);
      assert.match(agent.stdout, /Assistant reply \(single step\)/);

      const cfg = await readCliState(dbPath);
      assert.equal(cfg.currentSessionId, sessionId);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("C2: --prompt-path only still runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-prompt-path-"));
    const dbPath = join(dir, "novel.db");
    const promptPath = join(dir, "prompt.yaml");
    try {
      await writeFile(
        promptPath,
        `persist: {}\ndynamic: {}\n`,
        "utf8",
      );

      const projectId = runNm(
        ["project", "create", "--name", "Pp", "--db", dbPath],
        { env: MOCK_ENV },
      )
        .stdout.trim();
      runNm(["project", "use", "--project", projectId, "--db", dbPath], {
        env: MOCK_ENV,
      });
      const sessionId = runNm(
        ["session", "create", "--project", projectId, "--db", dbPath],
        { env: MOCK_ENV },
      )
        .stdout.trim();
      runNm(["session", "use", "--session", sessionId, "--db", dbPath], {
        env: MOCK_ENV,
      });
      const mockModels = seedMockProviderModels(dbPath, ["test"], MOCK_ENV);
      const savedModelId = mockModels.get("test")!;

      const agent = runNm(
        [
          "agent",
          "continue",
          "--content",
          "hi",
          "--prompt-path",
          promptPath,
          "--modelId",
          savedModelId,
          "--db",
          dbPath,
        ],
        { env: MOCK_ENV },
      );
      assert.equal(agent.status, 0, agent.stderr);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("E2: --modelId overrides agent model pin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-agent-e2-"));
    const dbPath = join(dir, "novel.db");
    const agentPath = join(dir, "agent.yaml");
    try {
      const mockModels = seedMockProviderModels(
        dbPath,
        ["pinned", "override", "workspace"],
        MOCK_ENV_REPORT_MODEL,
      );
      const pinnedId = mockModels.get("pinned")!;
      const overrideId = mockModels.get("override")!;
      const workspaceId = mockModels.get("workspace")!;

      await writeFile(agentPath, agentYamlWithPinnedModel(pinnedId), "utf8");

      const projectId = runNm(
        ["project", "create", "--name", "E2", "--db", dbPath],
        { env: MOCK_ENV_REPORT_MODEL },
      )
        .stdout.trim();
      runNm(["project", "use", "--project", projectId, "--db", dbPath], {
        env: MOCK_ENV_REPORT_MODEL,
      });
      const sessionId = runNm(
        ["session", "create", "--project", projectId, "--db", dbPath],
        { env: MOCK_ENV_REPORT_MODEL },
      )
        .stdout.trim();
      runNm(["session", "use", "--session", sessionId, "--db", dbPath], {
        env: MOCK_ENV_REPORT_MODEL,
      });
      runNm(
        ["model", "use", "--modelId", workspaceId, "--db", dbPath],
        { env: MOCK_ENV_REPORT_MODEL },
      );

      const agent = runNm(
        [
          "agent",
          "continue",
          "--content",
          "hello",
          "--agent-config",
          agentPath,
          "--modelId",
          overrideId,
          "--db",
          dbPath,
        ],
        { env: MOCK_ENV_REPORT_MODEL },
      );
      assert.equal(agent.status, 0, agent.stderr);
      assert.match(agent.stdout, new RegExp(`model: ${overrideId}`));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("C3: invalid agent yaml fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-bad-agent-"));
    const dbPath = join(dir, "novel.db");
    const agentPath = join(dir, "bad.yaml");
    try {
      await writeFile(
        agentPath,
        `schemaVersion: 1\nname: x\nmodel: {}\n`,
        "utf8",
      );

      const projectId = runNm(
        ["project", "create", "--name", "Bad", "--db", dbPath],
        { env: MOCK_ENV },
      )
        .stdout.trim();
      runNm(["project", "use", "--project", projectId, "--db", dbPath], {
        env: MOCK_ENV,
      });
      const sessionId = runNm(
        ["session", "create", "--project", projectId, "--db", dbPath],
        { env: MOCK_ENV },
      )
        .stdout.trim();
      runNm(["session", "use", "--session", sessionId, "--db", dbPath], {
        env: MOCK_ENV,
      });
      const mockModels = seedMockProviderModels(dbPath, ["test"], MOCK_ENV);
      const savedModelId = mockModels.get("test")!;

      const agent = runNm(
        [
          "agent",
          "continue",
          "--content",
          "x",
          "--agent-config",
          agentPath,
          "--modelId",
          savedModelId,
          "--db",
          dbPath,
        ],
        { env: MOCK_ENV },
      );
      assert.notEqual(agent.status, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
