/**
 * `nm provider` subcommands.
 *
 * @module provider/commands
 */

import { ProviderError } from "@novel-master/core";
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
          "Usage: nm provider create --providerId <id> --protocol <openai|anthropic|gemini> --baseUrl <url> [--displayName] [--headers] [--defaultModelId] [--apiKey]",
        );
      }
      await rt.providers.create({
        id,
        protocol,
        baseUrl,
        displayName: flagString(flags, "displayName"),
        headers: parseHeaders(flags),
        defaultModelId: flagString(flags, "defaultModelId"),
        apiKey: flagString(flags, "apiKey"),
      });
      return;
    }
    case "delete": {
      const id = requireProviderId(flags);
      await rt.providers.delete(id);
      const snap = rt.scope.getConfigSnapshot();
      const patch: {
        currentProviderId?: string;
        currentModelId?: string;
      } = {};
      if (snap.currentProviderId === id) {
        patch.currentProviderId = undefined;
      }
      if (snap.currentModelId?.startsWith(`${id}/`)) {
        patch.currentModelId = undefined;
      }
      if ("currentProviderId" in patch || "currentModelId" in patch) {
        await rt.setCliContext(patch);
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
        defaultModelId?: string | null;
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
      if (flags.has("defaultModelId")) {
        patch.defaultModelId = flagString(flags, "defaultModelId") ?? null;
      }
      const apiKey = flagString(flags, "apiKey");
      if (apiKey) {
        patch.apiKey = apiKey;
      }
      if (Object.keys(patch).length === 0) {
        throw new Error(
          "Usage: nm provider edit --providerId <id> [--baseUrl] [--displayName] [--headers] [--defaultModelId] [--apiKey] [--protocol]",
        );
      }
      await rt.providers.edit(id, patch);
      return;
    }
    case "use": {
      const id = requireProviderId(flags);
      await rt.providers.get(id);
      await rt.setCliContext({ currentProviderId: id });
      return;
    }
    case "current": {
      const id = rt.scope.getConfigSnapshot().currentProviderId;
      if (id == null || id === "") {
        throw new Error(
          "No current provider (run: nm provider use --providerId <id>)",
        );
      }
      const p = await rt.providers.get(id);
      console.log(`${p.id}\t${p.protocol}\t${p.baseUrl}`);
      return;
    }
    default:
      throw new Error(
        "Usage: nm provider <list|create|delete|edit|use|current|model> ...",
      );
  }
}
