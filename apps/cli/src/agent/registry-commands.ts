/**
 * `nm agent list|show|create|import|export|migrate|delete` commands.
 *
 * @module agent/registry-commands
 */

import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { encode, registerBuiltinTools, ToolRegistry } from "@novel-master/core";

import {
  agentDefinitionSchema,
  type AgentDefinition,
  type AgentRegistryService,
} from "@novel-master/core/agent";

import { assertSavedModelUuid } from "@novel-master/core/provider";
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
  savedModelId: string,
): Promise<void> {
  await assertSavedModelUuid(savedModelId, rt.savedModels);
}

export async function runAgentRegistryCommand(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  // ⚠️ 位置参数一律取 `positional`，**不许直接取 `args[0]`**（CR WA-P2-05）：
  // `args` 里 flag 本身也在第一层，`nm agent create --description "写手" smoke`
  // 会把 agent 命名成 `--description` 并静默成功（随后 `session create` 照样能
  // 开 ⇒ 不报错，只是名字离谱）。`parseCliArgs` 已经把 flag 剔干净了，直接用它的
  // 产出即可。`create` / `show` / `import` / `export` / `delete` 五个 case 已同批
  // 收口，避免只改新增的那一个造成行为不一致。
  // 📌 坐标一律用 case 名、不用行号（同 CR WA-P2-02 的教训：行号必然再次腐烂）。
  const { positional, flags } = parseCliArgs(args);
  const registry = rt.agentRegistry;

  switch (subcommand) {
    case "create": {
      // 全新机器上开第一个会话的必要入口：registry 空 ⇒ session create 直接失败
      // （resolveWorkspaceAgentForNewSession 回落到 listAgentIds()[0]，而
      //  虚拟 general 没有 id、不可能出现在 listAgentIds 里）⇒ N-P0-03。
      const name = flagString(flags, "name") ?? positional[0];
      if (name == null || name.trim() === "") {
        throw new Error("Usage: nm agent create --name <name> [--system <prompt>]");
      }
      const system = flagString(flags, "system") ?? "你是一个写作助手。";
      const agentId = randomUUID();
      await registry.upsert(
        agentId,
        {
          name: name.trim(),
          description: flagString(flags, "description") ?? "",
          prompts: { system, persist: [], dynamic: [] },
        } satisfies AgentDefinition,
        createRegistryValidateOptions(rt),
      );
      // 顺带把 workspace 当前 agent 指过去：session create 优先读 state，
      // 这样即使 registry 里有别的 agent，用户新建的会话也用自己刚建的。
      await rt.state.setCurrentAgentId(agentId);
      console.log(agentId); // 与 `nm session create` 同口径：stdout 只出 id
      return;
    }
    case "list": {
      const defs = await registry.list();
      if (defs.length === 0) {
        console.log(
          "No agents in registry. Run: nm agent import <path>, or: nm agent create --name <name>",
        );
        return;
      }
      for (const def of defs) {
        console.log(def.name);
      }
      return;
    }
    case "show": {
      const agentId = flagString(flags, "id") ?? positional[0];
      if (agentId == null || agentId === "") {
        throw new Error("Usage: nm agent show <agent-id>");
      }
      const def = await registry.get(agentId);
      console.log(JSON.stringify(encode(def, agentDefinitionSchema), null, 2));
      return;
    }
    case "import": {
      const path = flagString(flags, "file") ?? positional[0];
      if (path == null || path === "") {
        throw new Error("Usage: nm agent import <path>");
      }
      const count = await importAgentsFromFile(
        registry,
        path,
        createRegistryValidateOptions(rt),
      );
      console.log(`Imported ${count} agent(s) from ${path}`);
      return;
    }
    case "export": {
      const path = flagString(flags, "file") ?? positional[0];
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
      const count = await importAgentsFromFile(
        registry,
        bundlePath,
        createRegistryValidateOptions(rt),
      );
      console.log(`Migrated ${count} agent(s) from ${bundlePath}`);
      return;
    }
    case "delete": {
      const agentId = flagString(flags, "id") ?? positional[0];
      if (agentId == null || agentId === "") {
        throw new Error("Usage: nm agent delete <agent-id>");
      }
      await registry.delete(agentId);
      console.log(`Deleted agent: ${agentId}`);
      return;
    }
    default:
      throw new Error(
        "Usage: nm agent <list|show|create|import|export|migrate|delete> ...",
      );
  }
}

/** Validation hook for registry upsert from CLI file loads. */
export function createRegistryValidateOptions(
  rt: NovelMasterRuntime,
): Parameters<AgentRegistryService["upsert"]>[2] {
  const probe = new ToolRegistry();
  registerBuiltinTools(probe);
  return {
    assertSavedModel: (id) => assertSavedModel(rt, id),
    registeredToolNames: probe.list(),
  };
}
