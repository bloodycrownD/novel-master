/**
 * `nm project` subcommands.
 *
 * @module project/commands
 */

import type { Outcome } from "@novel-master/core/workplace";
import type { NovelMasterRuntime } from "../runtime.js";
import { resolveProjectUseId } from "../config/resolve-entity.js";
import { OUTCOME_COMPLETED } from "../cli-errors.js";
import { runProjectWorkplace } from "./workplace.js";
import { parseCliArgs } from "../vfs/parse-args.js";

/**
 * 解包 throw 边界（错误通道迁移三期门⑦）：repo 写 / 删 / 复制的 `Result` 失败原样上抛（core Result → CLI 异常通道转码点），由 main.ts 两个边界 catch（exitCodeForError + formatCliError）收口。
 */
export async function runProject(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<Outcome<void>> {
  const { flags } = parseCliArgs(args);

  switch (subcommand) {
    case "list": {
      const list = await rt.projects.list();
      for (const p of list) {
        console.log(`${p.id}\t${p.name}`);
      }
      return OUTCOME_COMPLETED;
    }
    case "create": {
      const nameFlag = flags.get("name");
      const name = typeof nameFlag === "string" ? nameFlag : "project";
      const p = await rt.projects.create(name);
      if (!p.ok) throw p.error;
      // Set current project and clear session
      await rt.state.setCurrentProjectId(p.value.id);
      await rt.state.resetCurrentSessionId();
      console.log(p.value.id);
      return OUTCOME_COMPLETED;
    }
    case "use": {
      const id = await resolveProjectUseId(rt.projects, flags);
      // Set current project and clear session
      await rt.state.setCurrentProjectId(id);
      await rt.state.resetCurrentSessionId();
      return OUTCOME_COMPLETED;
    }
    case "current": {
      const id = await rt.state.getCurrentProjectId();
      if (id == null || id === "") {
        throw new Error(
          "No current project (run: nm project use --project <id> or --name <name>)",
        );
      }
      const p = await rt.projects.get(id);
      if (!p.ok) throw p.error;
      console.log(`${p.value.id}\t${p.value.name}`);
      return OUTCOME_COMPLETED;
    }
    case "delete": {
      const id = await rt.scope.resolveProjectId(flags);
      const deleted = await rt.projects.delete(id);
      if (!deleted.ok) throw deleted.error;
      // Clear current project if it was deleted
      const currentId = await rt.state.getCurrentProjectId();
      if (currentId === id) {
        await rt.state.resetCurrentProjectId();
        await rt.state.resetCurrentSessionId();
      }
      return OUTCOME_COMPLETED;
    }
    case "copy": {
      const id = await rt.scope.resolveProjectId(flags);
      const copy = await rt.projects.copy(id);
      if (!copy.ok) throw copy.error;
      console.log(copy.value.id);
      return OUTCOME_COMPLETED;
    }
    case "workplace":
      return runProjectWorkplace(rt, args);
    default:
      throw new Error(
        "Usage: nm project <list|create|use|current|delete|copy|vfs|workplace> ...",
      );
  }
}
