import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readCliState, runNm } from "./helpers.js";

const MOCK_ENV = {
  NM_AGENT_MOCK_LLM: "1",
  NM_AGENT_MOCK_SCENARIO: "continue",
};

describe("agent CLI smoke", () => {
  it("project → session → agent continue (mock LLM)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-agent-"));
    const dbPath = join(dir, "novel.db");
    try {
      const project = runNm(
        ["project", "create", "--name", "AgentSmoke", "--db", dbPath],
        { env: MOCK_ENV },
      );
      assert.equal(project.status, 0, project.stderr);
      const projectId = project.stdout.trim();

      runNm(["project", "use", "--project", projectId, "--db", dbPath], {
        env: MOCK_ENV,
      });

      const session = runNm(
        ["session", "create", "--project", projectId, "--db", dbPath],
        { env: MOCK_ENV },
      );
      assert.equal(session.status, 0, session.stderr);
      const sessionId = session.stdout.trim();
      runNm(["session", "use", "--session", sessionId, "--db", dbPath], {
        env: MOCK_ENV,
      });

      const agent = runNm(
        [
          "agent",
          "continue",
          "--content",
          "step one",
          "--modelId",
          "mock/test",
          "--db",
          dbPath,
        ],
        { env: MOCK_ENV },
      );
      assert.equal(agent.status, 0, agent.stderr);
      assert.match(agent.stdout, /Assistant reply \(single step\)/);

      const listed = runNm(["message", "list", "--db", dbPath], {
        env: MOCK_ENV,
      });
      assert.equal(listed.status, 0, listed.stderr);
      assert.match(listed.stdout, /assistant/);

      const cfg = await readCliState(dbPath);
      assert.equal(cfg.currentProjectId, projectId);
      assert.equal(cfg.currentSessionId, sessionId);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("agent doom_loop surfaces AgentError on stderr", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-agent-doom-"));
    const dbPath = join(dir, "novel.db");
    try {
      const projectId = runNm(
        ["project", "create", "--name", "Doom", "--db", dbPath],
        { env: { ...MOCK_ENV, NM_AGENT_MOCK_SCENARIO: "doom" } },
      )
        .stdout.trim();
      runNm(["project", "use", "--project", projectId, "--db", dbPath], {
        env: { ...MOCK_ENV, NM_AGENT_MOCK_SCENARIO: "doom" },
      });
      const sessionId = runNm(
        ["session", "create", "--project", projectId, "--db", dbPath],
        { env: { ...MOCK_ENV, NM_AGENT_MOCK_SCENARIO: "doom" } },
      )
        .stdout.trim();
      runNm(["session", "use", "--session", sessionId, "--db", dbPath], {
        env: { ...MOCK_ENV, NM_AGENT_MOCK_SCENARIO: "doom" },
      });

      const agent = runNm(
        [
          "agent",
          "continue",
          "--content",
          "trigger doom",
          "--modelId",
          "mock/test",
          "--db",
          dbPath,
        ],
        { env: { ...MOCK_ENV, NM_AGENT_MOCK_SCENARIO: "doom" } },
      );
      assert.notEqual(agent.status, 0);
      assert.match(agent.stderr, /Doom loop/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
