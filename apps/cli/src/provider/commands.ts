/**
 * `nm provider` subcommands.
 *
 * @module provider/commands
 */

import { ProviderError } from "@novel-master/core/provider";
import type { NovelMasterRuntime } from "../runtime.js";
import { requireProviderId } from "../config/resolve-provider-scope.js";
import { parseCliArgs } from "../vfs/parse-args.js";
import { runProviderModel } from "./model/commands.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

function parseHeaders(flags: ReadonlyMap<string, string | true>): Record<string, string> | undefined {
  const raw = flagString(flags, "headers");
  if (raw == null) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ProviderError("INVALID_ARGUMENT", "Invalid --headers JSON object");
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "string") {
        throw new ProviderError("INVALID_ARGUMENT", `Header ${k} must be a string`);
      }
      out[k] = v;
    }
    return out;
  } catch (e) {
    if (e instanceof ProviderError) {
      throw e;
    }
    throw new ProviderError("INVALID_ARGUMENT", "Invalid --headers JSON");
  }
}

export async function runProvider(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  if (subcommand === "model") {
    const modelSub = args[0];
    if (modelSub == null) {
      throw new Error("Usage: nm provider model <subcommand> ...");
    }
    await runProviderModel(rt, modelSub, args.slice(1));
    return;
  }

  const { flags } = parseCliArgs(args);

  switch (subcommand) {
    case "list": {
      const list = await rt.providers.list();
      for (const p of list) {
        console.log(
          `${p.id}\t${p.protocol}\t${p.baseUrl}\t${p.displayName ?? ""}\tapiKey: ${p.apiKeyStatus}`,
        );
      }
      return;
    }
    case "create": {
      const id = flagString(flags, "providerId");
      const protocol = flagString(flags, "protocol") as
        | "openai"
        | "anthropic"
        | "gemini"
        | undefined;
      const baseUrl = flagString(flags, "baseUrl");
      if (!id || !protocol || !baseUrl) {
        throw new Error(
          "Usage: nm provider create --providerId <id> --protocol <openai|anthropic|gemini> --baseUrl <url> [--displayName] [--headers] [--apiKey]",
        );
      }
      await rt.providers.create({
        id,
        protocol,
        baseUrl,
        displayName: flagString(flags, "displayName"),
        headers: parseHeaders(flags),
        apiKey: flagString(flags, "apiKey"),
      });
      return;
    }
    case "delete": {
      const id = requireProviderId(flags);
      await rt.providers.delete(id);
      // Clear current provider if it was deleted
      const currentProviderId = await rt.state.getCurrentProviderId();
      if (currentProviderId === id) {
        await rt.state.resetCurrentProviderId();
      }
      // Clear current model if it belongs to this provider
      const currentModelId = await rt.state.getCurrentModelId();
      if (currentModelId?.startsWith(`${id}/`)) {
        await rt.state.resetCurrentModelId();
      }
      return;
    }
    case "edit": {
      const id = requireProviderId(flags);
      const patch: {
        protocol?: "openai" | "anthropic" | "gemini";
        baseUrl?: string;
        displayName?: string | null;
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
      if (flags.has("displayName")) {
        patch.displayName = flagString(flags, "displayName") ?? null;
      }
      const headers = parseHeaders(flags);
      if (headers) {
        patch.headers = headers;
      }
      if (flags.has("clear-api-key")) {
        patch.apiKey = "";
      } else if (flags.has("apiKey")) {
        patch.apiKey = flagString(flags, "apiKey") ?? "";
      }
      if (Object.keys(patch).length === 0) {
        throw new Error(
          "Usage: nm provider edit --providerId <id> [--baseUrl] [--displayName] [--headers] [--apiKey] [--clear-api-key] [--protocol]",
        );
      }
      await rt.providers.edit(id, patch);
      return;
    }
    case "use": {
      const id = requireProviderId(flags);
      await rt.providers.get(id);
      await rt.state.setCurrentProviderId(id);
      return;
    }
    case "current": {
      const id = await rt.state.getCurrentProviderId();
      if (id == null || id === "") {
        throw new Error(
          "No current provider (run: nm provider use --providerId <id>)",
        );
      }
      await rt.providers.get(id);
      console.log(id);
      return;
    }
    default:
      throw new Error(
        "Usage: nm provider <list|create|delete|edit|use|current|model> ...",
      );
  }
}
