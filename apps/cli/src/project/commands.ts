/**
 * `nm project` subcommands.
 *
 * @module project/commands
 */

import type { NovelMasterRuntime } from "../runtime.js";
import { resolveProjectUseId } from "../config/resolve-entity.js";
import { runProjectTemplate } from "./template.js";
import { runProjectWorkplace } from "./workplace.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runProject(
  rt: NovelMasterRuntime,
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
      // Set current project and clear session
      await rt.state.setCurrentProjectId(p.id);
      await rt.state.resetCurrentSessionId();
      console.log(p.id);
      return;
    }
    case "use": {
      const id = await resolveProjectUseId(rt.projects, flags);
      // Set current project and clear session
      await rt.state.setCurrentProjectId(id);
      await rt.state.resetCurrentSessionId();
      return;
    }
    case "current": {
      const id = await rt.state.getCurrentProjectId();
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
      const id = await rt.scope.resolveProjectId(flags);
      await rt.projects.delete(id);
      // Clear current project if it was deleted
      const currentId = await rt.state.getCurrentProjectId();
      if (currentId === id) {
        await rt.state.resetCurrentProjectId();
        await rt.state.resetCurrentSessionId();
      }
      return;
    }
    case "copy": {
      const id = await rt.scope.resolveProjectId(flags);
      const copy = await rt.projects.copy(id);
      console.log(copy.id);
      return;
    }
    case "workplace":
      await runProjectWorkplace(rt, args);
      return;
    case "template": {
      const templateSub = args[0];
      if (templateSub == null) {
        throw new Error("Usage: nm project template pull ...");
      }
      await runProjectTemplate(rt, templateSub, args.slice(1));
      return;
    }
    default:
      throw new Error(
        "Usage: nm project <list|create|use|current|delete|copy|vfs|workplace|template> ...",
      );
  }
}
