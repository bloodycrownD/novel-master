import { resolve } from "node:path";
import { ConfigError, PathMapError } from "./errors.js";
import { normalizePrefix } from "./path-map.js";

/** Resolved sync settings shared by push, pull, and watch. */
export interface SyncConfig {
  readonly mirrorRoot: string;
  readonly prefix: string;
  readonly verbose: boolean;
  readonly debounceMs: number;
  readonly pollMs: number;
}

const DEFAULT_PREFIX = "/";
const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_POLL_MS = 500;

/**
 * Minimal flag parser for vfs-test-sync (no external deps).
 */
export function parseFlags(args: readonly string[]): {
  positional: string[];
  flags: ReadonlyMap<string, string | true>;
} {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (token === "--verbose") {
      flags.set("verbose", true);
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = args[i + 1];
      if (next != null && !next.startsWith("-")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    if (token.startsWith("-") && token.length > 1) {
      for (const ch of token.slice(1)) {
        flags.set(ch, true);
      }
      continue;
    }
    positional.push(token);
  }

  return { positional, flags };
}

function parsePositiveInt(value: string, flag: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new ConfigError(`Invalid value for --${flag}: ${value}`);
  }
  return n;
}

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

/**
 * Parses argv into a subcommand and {@link SyncConfig}.
 *
 * @throws {ConfigError} when required options are missing or invalid.
 */
export function parseArgv(argv: readonly string[]): {
  command: "push" | "pull" | "watch";
  config: SyncConfig;
  dbArgv: readonly string[];
} {
  const { positional, flags } = parseFlags(argv);
  const command = positional[0];

  if (command !== "push" && command !== "pull" && command !== "watch") {
    throw new ConfigError(
      "Usage: vfs-test-sync <push|pull|watch> --mirror <dir> [options]",
    );
  }

  const mirrorRaw = flagString(flags, "mirror") ?? process.env.VFS_TEST_MIRROR;
  if (mirrorRaw == null || mirrorRaw.length === 0) {
    throw new ConfigError("--mirror or VFS_TEST_MIRROR is required");
  }

  // Normalize once so vfs.glob({ cwd }) matches path-map prefix semantics (C1).
  let prefix: string;
  try {
    prefix = normalizePrefix(flagString(flags, "prefix") ?? DEFAULT_PREFIX);
  } catch (err: unknown) {
    if (err instanceof PathMapError) {
      throw new ConfigError(err.message);
    }
    throw err;
  }
  const debounceMs = flagString(flags, "debounce-ms")
    ? parsePositiveInt(flagString(flags, "debounce-ms")!, "debounce-ms")
    : DEFAULT_DEBOUNCE_MS;
  const pollMs = flagString(flags, "poll-ms")
    ? parsePositiveInt(flagString(flags, "poll-ms")!, "poll-ms")
    : DEFAULT_POLL_MS;

  return {
    command,
    config: {
      mirrorRoot: resolve(mirrorRaw),
      prefix,
      verbose: flags.has("verbose"),
      debounceMs,
      pollMs,
    },
    dbArgv: argv,
  };
}
