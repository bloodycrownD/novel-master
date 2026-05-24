/**
 * `nm project` subcommands.
 *
 * @module project/commands
 */

import type { ProjectService } from "@novel-master/core";
import { parseCliArgs } from "../vfs/parse-args.js";

function requireProjectFlag(flags: ReadonlyMap<string, string | true>): string {
  const id = flags.get("project");
  if (typeof id !== "string") {
    throw new Error("Missing --project <id>");
  }
  return id;
}

export async function runProject(
  projects: ProjectService,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);

  switch (subcommand) {
    case "list": {
      const list = await projects.list();
      for (const p of list) {
        console.log(`${p.id}\t${p.name}`);
      }
      return;
    }
    case "create": {
      const nameFlag = flags.get("name");
      const name = typeof nameFlag === "string" ? nameFlag : "project";
      const p = await projects.create(name);
      console.log(p.id);
      return;
    }
    case "delete": {
      const id = requireProjectFlag(flags);
      await projects.delete(id);
      return;
    }
    case "copy": {
      const id = requireProjectFlag(flags);
      const copy = await projects.copy(id);
      console.log(copy.id);
      return;
    }
    default:
      throw new Error("Usage: nm project <list|create|delete|copy> ...");
  }
}
