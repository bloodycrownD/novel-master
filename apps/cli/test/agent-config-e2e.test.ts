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

describe("agent config CLI", () => {
  // Phase 0 兑底后：transient --agent-config 覆盖已降级，run 走 workspace follow agent +
  // workspace 当前模型。这里验证「设了 workspace 模型后 continue 正常跑通」。
  it("E1: agent continue runs with workspace model", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-agent-cfg-"));
    const dbPath = join(dir, "novel.db");
    try {
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
        ["agent", "continue", "--content", "hello", "--db", dbPath],
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

  // Phase 0 兑底后：--modelId 不再覆盖，仅打印「不再支持」警告；run 仍走 workspace 模型。
  it("C2: --modelId flag degrades to warning and workspace model still runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-prompt-path-"));
    const dbPath = join(dir, "novel.db");
    try {
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
      runNm(["model", "use", "--modelId", savedModelId, "--db", dbPath], {
        env: MOCK_ENV,
      });

      const agent = runNm(
        [
          "agent",
          "continue",
          "--content",
          "hi",
          "--modelId",
          savedModelId,
          "--db",
          dbPath,
        ],
        { env: MOCK_ENV },
      );
      assert.equal(agent.status, 0, agent.stderr);
      assert.match(agent.stderr, /--modelId 不再支持/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Phase 0 兑底后：transient --agent-config 不再校验；--save 路径仍会校验 definition。
  // 这里走 --save，用非法 yaml 触发校验失败。
  it("C3: invalid agent yaml fails via --save", async () => {
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
      runNm(["model", "use", "--modelId", savedModelId, "--db", dbPath], {
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
          "--agent-id",
          "bad-agent",
          "--save",
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
