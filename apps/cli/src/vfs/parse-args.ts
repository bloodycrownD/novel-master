export interface ParsedCliArgs {
  readonly positional: string[];
  readonly flags: ReadonlyMap<string, string | true>;
}

/**
 * Minimal argv parser for vfs subcommands (no external deps).
 */
export function parseCliArgs(args: readonly string[]): ParsedCliArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (token === "-r" || token === "--recursive") {
      flags.set("recursive", true);
      continue;
    }
    if (token === "--all") {
      flags.set("all", true);
      continue;
    }
    if (token === "--meta") {
      flags.set("meta", true);
      continue;
    }
    if (token === "--no-version-check") {
      flags.set("no-version-check", true);
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

export function extractDbPath(argv: readonly string[]): {
  dbPath?: string;
  rest: string[];
} {
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--db") {
      const value = argv[i + 1];
      if (value == null) {
        return { rest: argv as string[] };
      }
      return { dbPath: value, rest: [...argv.slice(0, i), ...argv.slice(i + 2)] };
    }
    rest.push(token);
  }
  return { rest };
}
