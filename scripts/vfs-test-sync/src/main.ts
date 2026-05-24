#!/usr/bin/env node
import { VfsError } from "@novel-master/core";
import { ConfigError } from "./errors.js";
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
    if (err instanceof VfsError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  } finally {
    await conn.close();
  }

  return 0;
}

const exitCode = await main();
process.exit(exitCode);
