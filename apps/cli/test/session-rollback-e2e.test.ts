import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runNm } from "./helpers.js";

type ListedMessage = {
  readonly id: string;
  readonly role: string;
  readonly text: string;
};

/** Parses `nm message list` TSV: id, order, role, hidden, text. */
function parseMessageList(stdout: string): ListedMessage[] {
  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split("\t");
      const id = parts[0];
      const role = parts[2];
      if (id == null || role == null) {
        throw new Error(`invalid message list line: ${line}`);
      }
      return {
        id,
        role,
        text: parts.slice(4).join("\t"),
      };
    });
}

function appendMessageId(
  dbPath: string,
  role: string,
  content: string,
): string {
  const append = runNm([
    "message",
    "append",
    "--role",
    role,
    "--content",
    content,
    "--db",
    dbPath,
  ]);
  assert.equal(append.status, 0, append.stderr);
  return append.stdout.trim();
}

function seedProjectSession(dbPath: string): void {
  const project = runNm(["project", "create", "--name", "Rollback", "--db", dbPath]);
  assert.equal(project.status, 0, project.stderr);
  const session = runNm(["session", "create", "--db", dbPath]);
  assert.equal(session.status, 0, session.stderr);
  const pref = runNm([
    "preferences",
    "set",
    "session-fs.versionCheck",
    "false",
    "--db",
    dbPath,
  ]);
  assert.equal(pref.status, 0, pref.stderr);
}

describe("session rollback CLI e2e", () => {
  it("T-CLI1: plain user rollback removes anchor message from DB", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-srb-"));
    const dbPath = join(dir, "novel.db");
    try {
      seedProjectSession(dbPath);

      const userAnchorId = appendMessageId(dbPath, "user", "hello anchor");
      appendMessageId(dbPath, "assistant", "assistant reply");
      appendMessageId(dbPath, "user", "tail user");

      const rollback = runNm([
        "session",
        "rollback",
        "--message",
        userAnchorId,
        "--db",
        dbPath,
      ]);
      assert.equal(rollback.status, 0, rollback.stderr);

      const list = runNm(["message", "list", "--db", dbPath]);
      assert.equal(list.status, 0, list.stderr);
      const messages = parseMessageList(list.stdout);
      assert.equal(messages.length, 0);
      assert.doesNotMatch(list.stdout, new RegExp(userAnchorId));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T-CLI2: assistant rollback keeps anchor message in DB", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-srb-"));
    const dbPath = join(dir, "novel.db");
    try {
      seedProjectSession(dbPath);

      appendMessageId(dbPath, "user", "setup user");
      const assistantAnchorId = appendMessageId(
        dbPath,
        "assistant",
        "assistant anchor",
      );
      appendMessageId(dbPath, "user", "tail user");
      appendMessageId(dbPath, "assistant", "tail assistant");

      const rollback = runNm([
        "session",
        "rollback",
        "--message",
        assistantAnchorId,
        "--db",
        dbPath,
      ]);
      assert.equal(rollback.status, 0, rollback.stderr);

      const list = runNm(["message", "list", "--db", dbPath]);
      assert.equal(list.status, 0, list.stderr);
      const messages = parseMessageList(list.stdout);
      assert.equal(messages.length, 2);
      assert.equal(messages[1]?.id, assistantAnchorId);
      assert.equal(messages[1]?.role, "assistant");
      assert.match(messages[1]?.text ?? "", /assistant anchor/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
