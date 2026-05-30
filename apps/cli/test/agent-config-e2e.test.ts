import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readCliState, runNm } from "./helpers.js";

const MOCK_ENV = {
  NM_AGENT_MOCK_LLM: "1",
  NM_AGENT_MOCK_SCENARIO: "continue",
};

const MINIMAL_AGENT_YAML = `
schemaVersion: 1
name: e2e-agent
prompts:
  blocks:
    - name: c
      type: chat
`;

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
      const mockProvider = runNm(
        [
          "provider",
          "create",
          "--providerId",
          "mock",
          "--protocol",
          "openai",
          "--baseUrl",
          "http://127.0.0.1/v1",
          "--apiKey",
          "test",
          "--db",
          dbPath,
        ],
        { env: MOCK_ENV },
      );
      assert.equal(mockProvider.status, 0, mockProvider.stderr);
      runNm(
        [
          "provider",
          "model",
          "create",
          "--providerId",
          "mock",
          "--vendorModelId",
          "test",
          "--db",
          dbPath,
        ],
        { env: MOCK_ENV },
      );
      const modelUse = runNm(["model", "use", "--modelId", "mock/test", "--db", dbPath], {
        env: MOCK_ENV,
      });
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
        `blocks:\n  - name: c\n    type: chat\n`,
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

      const agent = runNm(
        [
          "agent",
          "continue",
          "--content",
          "hi",
          "--prompt-path",
          promptPath,
          "--modelId",
          "mock/test",
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

      const agent = runNm(
        [
          "agent",
          "continue",
          "--content",
          "x",
          "--agent-config",
          agentPath,
          "--modelId",
          "mock/test",
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
