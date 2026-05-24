#!/usr/bin/env node
import { TdbcError, VfsError } from "@novel-master/core";
import { ConfigError, MirrorError, PathMapError } from "./errors.js";
import { parseArgv } from "./config.js";
import { createSyncEngine } from "./sync-engine.js";
import { createVfsRuntime } from "./vfs-runtime.js";
import { runWatch } from "./watch.js";

function formatRuntimeError(err: unknown): string {
  if (!(err instanceof TdbcError)) {
    return err instanceof Error ? err.message : String(err);
  }
  const cause = err.cause;
  const causeMsg =
    cause instanceof Error ? cause.message : cause != null ? String(cause) : "";
  if (
    causeMsg.includes("NODE_MODULE_VERSION") ||
    causeMsg.includes("ERR_DLOPEN_FAILED")
  ) {
    return (
      `${err.message}: better-sqlite3 native module does not match this Node.js version.\n` +
      `Run from repo root: npm rebuild better-sqlite3\n` +
      `(Node ${process.version})`
    );
  }
  if (causeMsg.includes("Could not locate the bindings file")) {
    return (
      `${err.message}: better-sqlite3 native binary is missing.\n` +
      `From repo root with Node 22: nvm use 22.22.0 && npm rebuild better-sqlite3\n` +
      `(Node ${process.version})`
    );
  }
  return err.message;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }

  const { command, config, dbArgv } = parsed;
  let vfs;
  let conn;
  try {
    ({ vfs, conn } = await createVfsRuntime(dbArgv));
  } catch (err: unknown) {
    console.error(formatRuntimeError(err));
    return 1;
  }

  try {
    const engine = createSyncEngine(vfs, config);

    if (command === "push") {
      await engine.push();
    } else if (command === "pull") {
      await engine.pull();
    } else {
      const once = argv.includes("--once");
      await runWatch({ config, engine, vfs, once });
    }
  } catch (err: unknown) {
    // CLI boundary: runtime IO/VFS failures → exit 1; path-map misuse → exit 2.
    if (err instanceof VfsError || err instanceof MirrorError) {
      console.error(err.message);
      return 1;
    }
    if (err instanceof PathMapError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  } finally {
    await conn.close();
  }

  return 0;
}

const exitCode = await main();
process.exit(exitCode);
