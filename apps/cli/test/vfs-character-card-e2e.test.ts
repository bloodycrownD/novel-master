import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { vfsListFilePaths } from "./helpers.js";

const CLI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_ENTRY = join(CLI_ROOT, "src", "index.ts");

const SAMPLE_V2 = {
  spec: "chara_card_v2",
  data: {
    description: "导入描述",
    first_mes: "开场一",
    character_book: {
      entries: [{ comment: "设定", keys: ["k1"], content: "世界书正文" }],
    },
  },
};

const EXPECTED_UNDER_ROLE = [
  "/角色/世界书/设定.md",
  "/角色/开场/开场001.md",
  "/角色/角色描述.md",
].sort();

function runCli(
  args: string[],
  options?: { input?: string },
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, ...args],
    {
      cwd: CLI_ROOT,
      encoding: "utf8",
      input: options?.input,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Drop `[nm-boot] …` lines that bootstrap prints to stdout. */
function withoutBootNoise(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => !line.startsWith("[nm-boot]"))
    .join("\n");
}

/** Last non-empty payload line (create 命令打印的 id). */
function lastPayloadLine(stdout: string): string {
  const lines = withoutBootNoise(stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

describe("vfs character-card CLI e2e", () => {
  it("T-C11: import-character-card without --yes fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-card-"));
    const dbPath = join(dir, "novel.db");
    const cardPath = join(dir, "card.json");
    try {
      await writeFile(cardPath, JSON.stringify(SAMPLE_V2), "utf8");
      const seed = runCli(
        ["vfs", "--db", dbPath, "write", "/角色/stay.md"],
        { input: "stay" },
      );
      assert.equal(seed.status, 0, seed.stderr);

      const imp = runCli([
        "vfs",
        "--db",
        dbPath,
        "import-character-card",
        "--file",
        cardPath,
        "--path",
        "/角色",
      ]);
      assert.notEqual(imp.status, 0);
      assert.match(
        imp.stderr,
        /import requires explicit confirmation \(CLI --yes or confirm dialog\)/,
      );

      const list = runCli(["vfs", "--db", dbPath, "list", "/角色", "-r"]);
      assert.equal(list.status, 0, list.stderr);
      assert.deepEqual(vfsListFilePaths(list.stdout), ["/角色/stay.md"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T-C11: import-character-card --yes writes expected subtree (global)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-card-"));
    const dbPath = join(dir, "novel.db");
    const cardPath = join(dir, "card.json");
    try {
      await writeFile(cardPath, JSON.stringify(SAMPLE_V2), "utf8");
      const seed = runCli(
        ["vfs", "--db", dbPath, "write", "/角色/旧文件.md"],
        { input: "old" },
      );
      assert.equal(seed.status, 0, seed.stderr);
      const sibling = runCli(
        ["vfs", "--db", dbPath, "write", "/大纲/保留.md"],
        { input: "outline" },
      );
      assert.equal(sibling.status, 0, sibling.stderr);

      const imp = runCli([
        "vfs",
        "--db",
        dbPath,
        "import-character-card",
        "--file",
        cardPath,
        "--path",
        "/角色",
        "--yes",
      ]);
      assert.equal(imp.status, 0, imp.stderr);

      const listRole = runCli(["vfs", "--db", dbPath, "list", "/角色", "-r"]);
      assert.equal(listRole.status, 0, listRole.stderr);
      assert.deepEqual(
        vfsListFilePaths(listRole.stdout).sort(),
        EXPECTED_UNDER_ROLE,
      );

      const readDesc = runCli([
        "vfs",
        "--db",
        dbPath,
        "read",
        "/角色/角色描述.md",
      ]);
      assert.equal(withoutBootNoise(readDesc.stdout).trimEnd(), "导入描述");

      const readSibling = runCli([
        "vfs",
        "--db",
        dbPath,
        "read",
        "/大纲/保留.md",
      ]);
      assert.equal(withoutBootNoise(readSibling.stdout).trimEnd(), "outline");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("project vfs import-character-card --yes matches expected paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-card-"));
    const dbPath = join(dir, "novel.db");
    const cardPath = join(dir, "card.json");
    try {
      await writeFile(cardPath, JSON.stringify(SAMPLE_V2), "utf8");
      const project = runCli([
        "project",
        "create",
        "--name",
        "P",
        "--db",
        dbPath,
      ]);
      assert.equal(project.status, 0, project.stderr);
      const projectId = lastPayloadLine(project.stdout);

      const imp = runCli([
        "project",
        "vfs",
        "import-character-card",
        "--file",
        cardPath,
        "--path",
        "/角色",
        "--yes",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(imp.status, 0, imp.stderr);

      const list = runCli([
        "project",
        "vfs",
        "list",
        "/角色",
        "-r",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(list.status, 0, list.stderr);
      assert.deepEqual(
        vfsListFilePaths(withoutBootNoise(list.stdout)).sort(),
        EXPECTED_UNDER_ROLE,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("session vfs import-character-card --yes matches expected paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-card-"));
    const dbPath = join(dir, "novel.db");
    const cardPath = join(dir, "card.json");
    try {
      await writeFile(cardPath, JSON.stringify(SAMPLE_V2), "utf8");
      const project = runCli([
        "project",
        "create",
        "--name",
        "P",
        "--db",
        dbPath,
      ]);
      assert.equal(project.status, 0, project.stderr);
      const projectId = lastPayloadLine(project.stdout);

      const session = runCli([
        "session",
        "create",
        "--title",
        "main",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(session.status, 0, session.stderr);

      const imp = runCli([
        "session",
        "vfs",
        "import-character-card",
        "--file",
        cardPath,
        "--path",
        "/角色",
        "--yes",
        "--db",
        dbPath,
      ]);
      assert.equal(imp.status, 0, imp.stderr);

      const list = runCli([
        "session",
        "vfs",
        "list",
        "/角色",
        "-r",
        "--db",
        dbPath,
      ]);
      assert.equal(list.status, 0, list.stderr);
      assert.deepEqual(
        vfsListFilePaths(withoutBootNoise(list.stdout)).sort(),
        EXPECTED_UNDER_ROLE,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bad card JSON surfaces CharacterCardError message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-card-"));
    const dbPath = join(dir, "novel.db");
    const cardPath = join(dir, "bad.json");
    try {
      await writeFile(cardPath, JSON.stringify({ foo: 1 }), "utf8");
      const imp = runCli([
        "vfs",
        "--db",
        dbPath,
        "import-character-card",
        "--file",
        cardPath,
        "--yes",
      ]);
      assert.notEqual(imp.status, 0);
      assert.match(imp.stderr, /无法识别为角色卡/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
