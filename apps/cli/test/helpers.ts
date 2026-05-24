import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CliConfig } from "../src/config/cli-config.js";
import { resolveConfigPath } from "../src/config/cli-config.js";

const CLI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_ENTRY = join(CLI_ROOT, "src", "index.ts");

export interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Spawns the CLI entry via tsx (same as other e2e tests). */
export function runNm(
  args: string[],
  env?: NodeJS.ProcessEnv,
): SpawnResult {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, ...args],
    {
      cwd: CLI_ROOT,
      encoding: "utf8",
      env: { ...process.env, ...env },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Reads `config.json` beside the given DB path. */
export async function readCliConfig(dbPath: string): Promise<CliConfig> {
  const configPath = resolveConfigPath(dbPath);
  const text = await readFile(configPath, "utf8");
  return JSON.parse(text) as CliConfig;
}

/** Directory containing the DB file (for custom `--db` layout tests). */
export function dbDir(dbPath: string): string {
  return dirname(dbPath);
}
