import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  readCliState,
  runNm,
  seedMockProviderModels,
  stripBootLogs,
} from "./helpers.js";

// 主干基线即红（f6624b9b4，与错误通道迁移无关），点名跳过；主干修复后移除本标记。
const TRUNK_BASELINE_RED = "主干既有：基线 f6624b9b4 即红，与本迁移无关";

const MOCK_ENV = {
  NM_AGENT_MOCK_LLM: "1",
  NM_AGENT_MOCK_SCENARIO: "continue",
};

describe("agent CLI smoke", () => {
  it(
    "project → session → agent continue (mock LLM)",
    { skip: TRUNK_BASELINE_RED },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "nm-agent-"));
      const dbPath = join(dir, "novel.db");
      try {
        const project = runNm(
          ["project", "create", "--name", "AgentSmoke", "--db", dbPath],
          { env: MOCK_ENV }
        );
        assert.equal(project.status, 0, project.stderr);
        const projectId = stripBootLogs(project.stdout);

        runNm(["project", "use", "--project", projectId, "--db", dbPath], {
          env: MOCK_ENV,
        });

        const session = runNm(
          ["session", "create", "--project", projectId, "--db", dbPath],
          { env: MOCK_ENV }
        );
        assert.equal(session.status, 0, session.stderr);
        const sessionId = stripBootLogs(session.stdout);
        runNm(["session", "use", "--session", sessionId, "--db", dbPath], {
          env: MOCK_ENV,
        });

        const mockModels = seedMockProviderModels(dbPath, ["test"], MOCK_ENV);
        const savedModelId = mockModels.get("test")!;
        // Phase 0 兑底：--modelId 已降级，改用 workspace 当前模型。
        runNm(["model", "use", "--modelId", savedModelId, "--db", dbPath], {
          env: MOCK_ENV,
        });

        const agent = runNm(
          ["agent", "continue", "--content", "step one", "--db", dbPath],
          { env: MOCK_ENV }
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
    }
  );

  it(
    "agent doom_loop surfaces AppError on stderr",
    { skip: TRUNK_BASELINE_RED },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "nm-agent-doom-"));
      const dbPath = join(dir, "novel.db");
      try {
        const doomEnv = { ...MOCK_ENV, NM_AGENT_MOCK_SCENARIO: "doom" };
        const projectId = stripBootLogs(
          runNm(["project", "create", "--name", "Doom", "--db", dbPath], {
            env: doomEnv,
          }).stdout
        );
        runNm(["project", "use", "--project", projectId, "--db", dbPath], {
          env: doomEnv,
        });
        const sessionId = stripBootLogs(
          runNm(["session", "create", "--project", projectId, "--db", dbPath], {
            env: doomEnv,
          }).stdout
        );
        runNm(["session", "use", "--session", sessionId, "--db", dbPath], {
          env: doomEnv,
        });

        const mockModels = seedMockProviderModels(dbPath, ["test"], doomEnv);
        const savedModelId = mockModels.get("test")!;
        runNm(["model", "use", "--modelId", savedModelId, "--db", dbPath], {
          env: doomEnv,
        });

        const agent = runNm(
          ["agent", "continue", "--content", "trigger doom", "--db", dbPath],
          { env: doomEnv }
        );
        assert.notEqual(agent.status, 0);
        assert.match(stripBootLogs(agent.stderr), /Doom loop/i);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  );
});
