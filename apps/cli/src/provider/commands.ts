/**
 * `nm provider` subcommands.
 *
 * @module provider/commands
 */

import { AppError } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";
import type { NovelMasterRuntime } from "../runtime.js";
import { RESULT_OK } from "../cli-errors.js";
import { requireProviderId } from "../config/resolve-provider-scope.js";
import { parseCliArgs } from "../vfs/parse-args.js";
import { runProviderModel } from "./model/commands.js";

function flagString(flags: ReadonlyMap<string, string | true>, key: string): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

function parseHeaders(flags: ReadonlyMap<string, string | true>): Result<Record<string, string> | undefined, AppError> {
  const raw = flagString(flags, "headers");
  if (raw == null) {
    return Result.ok(undefined);
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Result.err(new AppError("PROVIDER_INVALID_ARGUMENT", { detail: "Invalid --headers JSON object" }));
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "string") {
        return Result.err(new AppError("PROVIDER_INVALID_ARGUMENT", { detail: `Header ${k} must be a string` }));
      }
      out[k] = v;
    }
    return Result.ok(out);
  } catch {
    return Result.err(new AppError("PROVIDER_INVALID_ARGUMENT", { detail: "Invalid --headers JSON" }));
  }
}

// nm-style: keep-local — CLI 子命令分发 handler：main.ts 按 domain 单点分发，
// 内联会把 provider 域整个 subcommand switch 搬进分发器，破坏 main 的路由结构。
/**
 * repo 读的 `Result` 失败沿返回值交给上层（错误通道迁移四期），由 main.ts 统一出口收口。
 */
export async function runProvider(rt: NovelMasterRuntime, subcommand: string, args: readonly string[]): Promise<Result<void, AppError>> {
  if (subcommand === "model") {
    const modelSub = args[0];
    if (modelSub == null) {
      throw new Error("Usage: nm provider model <subcommand> ...");
    }
    return runProviderModel(rt, modelSub, args.slice(1));
  }

  const { flags } = parseCliArgs(args);

  switch (subcommand) {
    case "list": {
      const list = await rt.providers.list();
      if (!list.ok) return Result.err(list.error);
      for (const p of list.value) {
        console.log(`${p.id}\t${p.displayName}\t${p.protocol}\t${p.baseUrl}\tapiKey: ${p.apiKeyStatus}`);
      }
      return RESULT_OK;
    }
    case "create": {
      const name = flagString(flags, "name");
      const protocol = flagString(flags, "protocol") as "openai" | "anthropic" | "gemini" | undefined;
      const baseUrl = flagString(flags, "baseUrl");
      if (name == null || name.trim() === "" || !protocol || !baseUrl) {
        throw new Error("Usage: nm provider create --name <name> --protocol <openai|anthropic|gemini> --baseUrl <url> [--headers] [--apiKey]");
      }
      const headers = parseHeaders(flags);
      if (!headers.ok) return Result.err(headers.error);
      const created = await rt.providers.create({ protocol, baseUrl, displayName: name, headers: headers.value, apiKey: flagString(flags, "apiKey") });
      if (!created.ok) return Result.err(created.error);
      console.error(created.value.id);
      return RESULT_OK;
    }
    case "delete": {
      const id = requireProviderId(flags);
      // 须在 providers.delete（会级联删 saved model）之前查归属
      const currentModel = await rt.state.getCurrentModelId();
      if (!currentModel.ok) return Result.err(currentModel.error);
      const currentModelId = currentModel.value;
      let clearCurrentModel = false;
      if (currentModelId != null && currentModelId !== "") {
        const saved = await rt.providerModels.getSavedById(currentModelId);
        if (!saved.ok) return Result.err(saved.error);
        clearCurrentModel = saved.value?.providerId === id;
      }
      const deleted = await rt.providers.delete(id);
      if (!deleted.ok) return Result.err(deleted.error);
      const currentProvider = await rt.state.getCurrentProviderId();
      if (!currentProvider.ok) return Result.err(currentProvider.error);
      if (currentProvider.value === id) {
        await rt.state.resetCurrentProviderId();
      }
      if (clearCurrentModel) {
        await rt.state.resetCurrentModelId();
      }
      return RESULT_OK;
    }
    case "edit": {
      const id = requireProviderId(flags);
      const patch: {
        protocol?: "openai" | "anthropic" | "gemini";
        baseUrl?: string;
        displayName?: string;
        headers?: Record<string, string>;
        apiKey?: string;
      } = {};
      const protocol = flagString(flags, "protocol");
      if (protocol) {
        patch.protocol = protocol as "openai" | "anthropic" | "gemini";
      }
      const baseUrl = flagString(flags, "baseUrl");
      if (baseUrl) {
        patch.baseUrl = baseUrl;
      }
      if (flags.has("name")) {
        const name = flagString(flags, "name") ?? "";
        if (name.trim() === "") {
          return Result.err(new AppError("PROVIDER_INVALID_ARGUMENT", { detail: "displayName 不能为空" }));
        }
        patch.displayName = name;
      }
      const headers = parseHeaders(flags);
      if (!headers.ok) return Result.err(headers.error);
      if (headers.value) {
        patch.headers = headers.value;
      }
      if (flags.has("clear-api-key")) {
        patch.apiKey = "";
      } else if (flags.has("apiKey")) {
        patch.apiKey = flagString(flags, "apiKey") ?? "";
      }
      if (Object.keys(patch).length === 0) {
        throw new Error("Usage: nm provider edit --providerId <uuid> [--baseUrl] [--name] [--headers] [--apiKey] [--clear-api-key] [--protocol]");
      }
      const edited = await rt.providers.edit(id, patch);
      if (!edited.ok) return Result.err(edited.error);
      return RESULT_OK;
    }
    case "use": {
      const id = requireProviderId(flags);
      const got = await rt.providers.get(id);
      if (!got.ok) return Result.err(got.error);
      await rt.state.setCurrentProviderId(id);
      return RESULT_OK;
    }
    case "current": {
      const currentProvider = await rt.state.getCurrentProviderId();
      if (!currentProvider.ok) return Result.err(currentProvider.error);
      const id = currentProvider.value;
      if (id == null || id === "") {
        throw new Error("No current provider (run: nm provider use --providerId <uuid>)");
      }
      const provider = await rt.providers.get(id);
      if (!provider.ok) return Result.err(provider.error);
      console.log(`${provider.value.displayName}\t${provider.value.id}`);
      return RESULT_OK;
    }
    default:
      throw new Error("Usage: nm provider <list|create|delete|edit|use|current|model> ...");
  }
}
