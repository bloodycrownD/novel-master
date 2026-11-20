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
 * repo 写 / 删 / 复制的 `Result` 失败转 `Outcome.failed` 沿管线交回 main 边界
 * （错误通道迁移四期），由统一出口换算 exit code。
 */
export async function runProject(rt: NovelMasterRuntime, subcommand: string, args: readonly string[]): Promise<Outcome<void>> {
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
      if (!p.ok) return { kind: "failed", error: p.error };
      // Set current project and clear session
      await rt.state.setCurrentProjectId(p.value.id);
      await rt.state.resetCurrentSessionId();
      console.log(p.value.id);
      return OUTCOME_COMPLETED;
    }
    case "use": {
      const resolvedId = await resolveProjectUseId(rt.projects, flags);
      if (!resolvedId.ok) return { kind: "failed", error: resolvedId.error };
      const id = resolvedId.value;
      // Set current project and clear session
      await rt.state.setCurrentProjectId(id);
      await rt.state.resetCurrentSessionId();
      return OUTCOME_COMPLETED;
    }
    case "current": {
      const currentProject = await rt.state.getCurrentProjectId();
      if (!currentProject.ok) return { kind: "failed", error: currentProject.error };
      const id = currentProject.value;
      if (id == null || id === "") {
        throw new Error("No current project (run: nm project use --project <id> or --name <name>)");
      }
      const p = await rt.projects.get(id);
      if (!p.ok) return { kind: "failed", error: p.error };
      console.log(`${p.value.id}\t${p.value.name}`);
      return OUTCOME_COMPLETED;
    }
    case "delete": {
      const resolvedScope = await rt.scope.resolveProjectId(flags);
      if (!resolvedScope.ok) return { kind: "failed", error: resolvedScope.error };
      const id = resolvedScope.value;
      const deleted = await rt.projects.delete(id);
      if (!deleted.ok) return { kind: "failed", error: deleted.error };
      // Clear current project if it was deleted
      const currentProject = await rt.state.getCurrentProjectId();
      if (!currentProject.ok) return { kind: "failed", error: currentProject.error };
      const currentId = currentProject.value;
      if (currentId === id) {
        await rt.state.resetCurrentProjectId();
        await rt.state.resetCurrentSessionId();
      }
      return OUTCOME_COMPLETED;
    }
    case "copy": {
      const resolvedScope = await rt.scope.resolveProjectId(flags);
      if (!resolvedScope.ok) return { kind: "failed", error: resolvedScope.error };
      const copy = await rt.projects.copy(resolvedScope.value);
      if (!copy.ok) return { kind: "failed", error: copy.error };
      console.log(copy.value.id);
      return OUTCOME_COMPLETED;
    }
    case "workplace":
      return runProjectWorkplace(rt, args);
    default:
      throw new Error("Usage: nm project <list|create|use|current|delete|copy|vfs|workplace> ...");
  }
}
