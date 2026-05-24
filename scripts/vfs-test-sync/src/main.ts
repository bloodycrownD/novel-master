#!/usr/bin/env node
import { VfsError } from "@novel-master/core";
import { ConfigError, MirrorError, PathMapError } from "./errors.js";
import { parseArgv } from "./config.js";
import { createSyncEngine } from "./sync-engine.js";
import { createVfsRuntime } from "./vfs-runtime.js";
import { runWatch } from "./watch.js";

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
  const { vfs, conn } = await createVfsRuntime(dbArgv);

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
