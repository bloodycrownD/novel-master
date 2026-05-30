import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

describe("chat CLI smoke", () => {
  it("project → session → message → preferences happy path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-chat-"));
    const dbPath = join(dir, "novel.db");
    try {
      const project = runCli([
        "project",
        "create",
        "--name",
        "Smoke",
        "--db",
        dbPath,
      ]);
      assert.equal(project.status, 0, project.stderr);
      const projectId = project.stdout.trim();

      const session = runCli([
        "session",
        "create",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(session.status, 0, session.stderr);
      const sessionId = session.stdout.trim();

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
        "set",
        "session-fs.versionCheck",
        "false",
        "--db",
        dbPath,
      ]);
      assert.equal(pref.status, 0, pref.stderr);
      const got = runCli([
        "preferences",
        "get",
        "session-fs.versionCheck",
        "--db",
        dbPath,
      ]);
      assert.equal(got.status, 0, got.stderr);
      assert.equal(got.stdout.trim(), "false");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
