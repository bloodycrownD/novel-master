/**
 * `nm agent list|show|import|export|migrate|delete` commands.
 *
 * @module agent/registry-commands
 */

import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  encode,
  agentDefinitionSchema,
  parseApplicationModelId,
  type AgentRegistryService,
} from "@novel-master/core";
import type { NovelMasterRuntime } from "../runtime.js";
import { resolveNovelMasterHome } from "../compaction/novel-master-home.js";
import { parseCliArgs } from "../vfs/parse-args.js";
import { importAgentsFromFile, exportAgentsToFile } from "./import-export.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

async function assertSavedModel(
  rt: NovelMasterRuntime,
  applicationModelId: string,
): Promise<void> {
  const { providerId, vendorModelId } = parseApplicationModelId(applicationModelId);
  const list = await rt.providerModels.savedList(providerId);
  if (!list.some((m) => m.vendorModelId === vendorModelId)) {
    throw new Error(`unknown model: ${applicationModelId}`);
  }
}

export async function runAgentRegistryCommand(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const registry = rt.agentRegistry;

  switch (subcommand) {
    case "list": {
      const ids = await registry.listAgentIds();
      if (ids.length === 0) {
        console.log("No agents in registry. Run: nm agent import <path>");
        return;
      }
      for (const id of ids) {
        console.log(id);
      }
      return;
    }
    case "show": {
      const agentId = flagString(flags, "id") ?? args[0];
      if (agentId == null || agentId === "") {
        throw new Error("Usage: nm agent show <agent-id>");
      }
      const def = await registry.get(agentId);
      console.log(JSON.stringify(encode(def, agentDefinitionSchema), null, 2));
      return;
    }
    case "import": {
      const path = flagString(flags, "file") ?? args[0];
      if (path == null || path === "") {
        throw new Error("Usage: nm agent import <path>");
      }
      const count = await importAgentsFromFile(registry, path);
      console.log(`Imported ${count} agent(s) from ${path}`);
      return;
    }
    case "export": {
      const path = flagString(flags, "file") ?? args[0];
      if (path == null || path === "") {
        throw new Error("Usage: nm agent export <path>");
      }
      await exportAgentsToFile(registry, path);
      console.log(`Exported agents to ${path}`);
      return;
    }
    case "migrate": {
      const home = resolveNovelMasterHome(rt.dbPath);
      const bundlePath = join(home, "agents.yaml");
      try {
        await access(bundlePath);
      } catch {
        throw new Error(`No ${bundlePath} found to migrate`);
      }
      const ids = await registry.listAgentIds();
      if (ids.length > 0) {
        throw new Error(
          "Agent registry is not empty; migrate only when DB has no agents",
        );
      }
      const count = await importAgentsFromFile(registry, bundlePath);
      console.log(`Migrated ${count} agent(s) from ${bundlePath}`);
      return;
    }
    case "delete": {
      const agentId = flagString(flags, "id") ?? args[0];
      if (agentId == null || agentId === "") {
        throw new Error("Usage: nm agent delete <agent-id>");
      }
      await registry.delete(agentId);
      console.log(`Deleted agent: ${agentId}`);
      return;
    }
    default:
      throw new Error(
        "Usage: nm agent <list|show|import|export|migrate|delete> ...",
      );
  }
}

/** Validation hook for registry upsert from CLI file loads. */
export function createRegistryValidateOptions(
  rt: NovelMasterRuntime,
): Parameters<AgentRegistryService["upsert"]>[2] {
  return {
    assertSavedModel: (id) => assertSavedModel(rt, id),
  };
}
