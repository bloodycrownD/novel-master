/**
 * `nm project` subcommands.
 *
 * @module project/commands
 */

import type { NovelMasterRuntime } from "../runtime.js";
import { resolveProjectUseId } from "../config/resolve-entity.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runProject(
  rt: Pick<
    NovelMasterRuntime,
    "projects" | "scope" | "setCliContext"
  >,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);

  switch (subcommand) {
    case "list": {
      const list = await rt.projects.list();
      for (const p of list) {
        console.log(`${p.id}\t${p.name}`);
      }
      return;
    }
    case "create": {
      const nameFlag = flags.get("name");
      const name = typeof nameFlag === "string" ? nameFlag : "project";
      const p = await rt.projects.create(name);
      await rt.setCliContext({
        currentProjectId: p.id,
        currentSessionId: undefined,
      });
      console.log(p.id);
      return;
    }
    case "use": {
      const id = await resolveProjectUseId(rt.projects, flags);
      await rt.setCliContext({
        currentProjectId: id,
        currentSessionId: undefined,
      });
      return;
    }
    case "current": {
      const id = rt.scope.getConfigSnapshot().currentProjectId;
      if (id == null || id === "") {
        throw new Error(
          "No current project (run: nm project use --project <id> or --name <name>)",
        );
      }
      const p = await rt.projects.get(id);
      console.log(`${p.id}\t${p.name}`);
      return;
    }
    case "delete": {
      const id = rt.scope.resolveProjectId(flags);
      await rt.projects.delete(id);
      if (rt.scope.getConfigSnapshot().currentProjectId === id) {
        await rt.setCliContext({
          currentProjectId: undefined,
          currentSessionId: undefined,
        });
      }
      return;
    }
    case "copy": {
      const id = rt.scope.resolveProjectId(flags);
      const copy = await rt.projects.copy(id);
      console.log(copy.id);
      return;
    }
    default:
      throw new Error(
        "Usage: nm project <list|create|use|current|delete|copy|vfs> ...",
      );
  }
}
