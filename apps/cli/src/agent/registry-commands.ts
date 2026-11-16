/**
 * `nm agent list|show|create|delete` commands.
 *
 * @module agent/registry-commands
 */

import { randomUUID } from "node:crypto";
import { encode, registerBuiltinTools, ToolRegistry } from "@novel-master/core";
import { type AppError, Result } from "@novel-master/core/errors";
import { RESULT_OK } from "../cli-errors.js";

import {
  agentDefinitionSchema,
  type AgentDefinition,
  type AgentRegistryService,
} from "@novel-master/core/agent";

import { assertSavedModelUuid } from "@novel-master/core/provider";
import type { NovelMasterRuntime } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

/**
 * 模型 pin 校验沿 `Result` 回传（错误通道迁移四期；core 回调契约已放宽为
 * void | Result 双通道，core 侧把 Err 收编为 `AGENT_INVALID_MODEL`）。
 */
async function assertSavedModel(
  rt: NovelMasterRuntime,
  savedModelId: string,
): Promise<Result<void, AppError>> {
  const saved = await assertSavedModelUuid(savedModelId, rt.savedModels);
  if (!saved.ok) return Result.err(saved.error);
  return Result.ok(undefined);
}

export async function runAgentRegistryCommand(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<Result<void, AppError>> {
  // ⚠️ 位置参数一律取 `positional`，**不许直接取 `args[0]`**（CR WA-P2-05）：
  // `args` 里 flag 本身也在第一层，`nm agent create --description "写手" smoke`
  // 会把 agent 命名成 `--description` 并静默成功（随后 `session create` 照样能
  // 开 ⇒ 不报错，只是名字离谱）。`parseCliArgs` 已经把 flag 剔干净了，直接用它的
  // 产出即可。`create` / `show` / `delete` 三个 case 已同批收口，避免只改新增的
  // 那一个造成行为不一致。
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
      const saved = await registry.upsert(
        agentId,
        {
          name: name.trim(),
          description: flagString(flags, "description") ?? "",
          prompts: { system, persist: [], dynamic: [] },
        } satisfies AgentDefinition,
        createRegistryValidateOptions(rt),
      );
      if (!saved.ok) return saved;
      // 顺带把 workspace 当前 agent 指过去：session create 优先读 state，
      // 这样即使 registry 里有别的 agent，用户新建的会话也用自己刚建的。
      await rt.state.setCurrentAgentId(agentId);
      console.log(agentId); // 与 `nm session create` 同口径：stdout 只出 id
      return RESULT_OK;
    }
    case "list": {
      const defs = await registry.list();
      if (!defs.ok) return Result.err(defs.error);
      if (defs.value.length === 0) {
        console.log(
          "No agents in registry. Run: nm agent create --name <name>",
        );
        return RESULT_OK;
      }
      for (const def of defs.value) {
        console.log(def.name);
      }
      return RESULT_OK;
    }
    case "show": {
      const agentId = flagString(flags, "id") ?? positional[0];
      if (agentId == null || agentId === "") {
        throw new Error("Usage: nm agent show <agent-id>");
      }
      const def = await registry.get(agentId);
      if (!def.ok) return Result.err(def.error);
      const wire = encode(def.value, agentDefinitionSchema);
      if (!wire.ok) return Result.err(wire.error);
      console.log(JSON.stringify(wire.value, null, 2));
      return RESULT_OK;
    }
    case "delete": {
      const agentId = flagString(flags, "id") ?? positional[0];
      if (agentId == null || agentId === "") {
        throw new Error("Usage: nm agent delete <agent-id>");
      }
      const deleted = await registry.delete(agentId);
      if (!deleted.ok) return Result.err(deleted.error);
      console.log(`Deleted agent: ${agentId}`);
      return RESULT_OK;
    }
    default:
      throw new Error(
        "Usage: nm agent <list|show|create|delete> ...",
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
