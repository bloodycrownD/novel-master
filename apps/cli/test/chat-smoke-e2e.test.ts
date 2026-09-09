import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const CLI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_ENTRY = join(CLI_ROOT, "src", "index.ts");

function runCli(
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, ...args],
    {
      cwd: CLI_ROOT,
      encoding: "utf8",
      env: { ...process.env, ...options?.env },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** stdout 末行（fresh DB 首条命令会打 [nm-boot] migration 日志） */
function lastLine(stdout: string): string {
  const lines = stdout.trim().split("\n");
  return lines[lines.length - 1] ?? "";
}

describe("chat CLI smoke", () => {
  it("project → session → message → preferences happy path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-chat-"));
    const dbPath = join(dir, "novel.db");
    try {
      // fresh DB 的 agent registry 为空，session create 会因「workspace 未配置
      // Agent 且 registry 为空」失败——先种一个最小 agent（listAgentIds 回落语义）
      const bundlePath = join(dir, "agents.json");
      writeFileSync(
        bundlePath,
        JSON.stringify({
          schemaVersion: 1,
          agents: {
            "agent-smoke": { prompts: {}, description: "smoke seed", mode: "all" },
          },
        }),
      );
      const seeded = runCli(["agent", "import", bundlePath, "--db", dbPath]);
      assert.equal(seeded.status, 0, seeded.stderr);
      const project = runCli([
        "project",
        "create",
        "--name",
        "Smoke",
        "--db",
        dbPath,
      ]);
      assert.equal(project.status, 0, project.stderr);
      // [nm-boot] migration 日志会混入 stdout（本地基建已知问题）：id 取末行防污染
      const projectId = lastLine(project.stdout);

      const session = runCli([
        "session",
        "create",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(session.status, 0, session.stderr);
      const sessionId = lastLine(session.stdout);

      const msg = runCli([
        "message",
        "append",
        "--session",
        sessionId,
        "--role",
        "user",
        "--content",
        "hi",
        "--db",
        dbPath,
      ]);
      assert.equal(msg.status, 0, msg.stderr);

      const pref = runCli([
        "preferences",
        "get",
        "chat.llmStream",
        "--db",
        dbPath,
      ]);
      assert.equal(pref.status, 0, pref.stderr);
      assert.equal(lastLine(pref.stdout), "true");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
