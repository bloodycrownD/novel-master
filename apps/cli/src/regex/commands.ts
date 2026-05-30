/**
 * `nm regex` subcommands.
 *
 * @module regex/commands
 */

import {
  applyRegexRules,
  compileRegexRule,
  type UpdateRegexRuleInput,
} from "@novel-master/core";
import type { NovelMasterRuntime } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

function flagBool(flags: ReadonlyMap<string, string | true>, key: string): boolean {
  return flags.get(key) === true;
}

function requireGroupId(flags: ReadonlyMap<string, string | true>): string {
  const groupId = flagString(flags, "regexGroup");
  if (!groupId) {
    throw new Error("Missing --regexGroup <id>");
  }
  return groupId;
}

export async function runRegex(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);

  switch (subcommand) {
    case "list": {
      const groupId = requireGroupId(flags);
      const rules = await rt.regexConfig.listRules(groupId);
      for (const r of rules) {
        const en = r.enabled ? 1 : 0;
        console.log(
          `${r.sortOrder}\t${r.ruleId}\t${en}\t${r.name}\t${r.pattern}`,
        );
      }
      return;
    }
    case "show": {
      const groupId = requireGroupId(flags);
      const ruleId = flagString(flags, "regexId");
      if (!ruleId) {
        throw new Error("Usage: nm regex show --regexGroup <id> --regexId <id>");
      }
      const r = await rt.regexConfig.getRule(groupId, ruleId);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case "create": {
      const groupId = requireGroupId(flags);
      const ruleId = flagString(flags, "regexId");
      const name = flagString(flags, "name");
      const pattern = flagString(flags, "pattern");
      const minDepth = flagString(flags, "minDepth");
      const maxDepth = flagString(flags, "maxDepth");
      if (!ruleId || !name || !pattern || !minDepth || !maxDepth) {
        throw new Error(
          "Usage: nm regex create --regexGroup <id> --regexId <id> --name <n> --pattern <p> --minDepth <a> --maxDepth <b> [--llmReplace] [--displayReplace] [--user] [--assistant]",
        );
      }
      const rule = await rt.regexConfig.createRule({
        groupId,
        ruleId,
        name,
        pattern,
        flags: flagString(flags, "flags"),
        llmReplace: flagString(flags, "llmReplace") ?? null,
        displayReplace: flagString(flags, "displayReplace") ?? null,
        minDepth: Number.parseInt(minDepth, 10),
        maxDepth: Number.parseInt(maxDepth, 10),
        scopeUser: flagBool(flags, "user"),
        scopeAssistant: flagBool(flags, "assistant"),
        enabled: flags.has("enabled")
          ? flagString(flags, "enabled") !== "0"
          : undefined,
      });
      console.log(rule.ruleId);
      return;
    }
    case "edit": {
      const groupId = requireGroupId(flags);
      const ruleId = flagString(flags, "regexId");
      if (!ruleId) {
        throw new Error("Usage: nm regex edit --regexGroup <id> --regexId <id> ...");
      }
      const patch: UpdateRegexRuleInput = {};
      if (flags.has("name")) patch.name = flagString(flags, "name");
      if (flags.has("pattern")) patch.pattern = flagString(flags, "pattern");
      if (flags.has("flags")) patch.flags = flagString(flags, "flags");
      if (flags.has("llmReplace")) {
        patch.llmReplace = flagString(flags, "llmReplace") ?? null;
      }
      if (flags.has("displayReplace")) {
        patch.displayReplace = flagString(flags, "displayReplace") ?? null;
      }
      if (flags.has("minDepth")) {
        patch.minDepth = Number.parseInt(flagString(flags, "minDepth")!, 10);
      }
      if (flags.has("maxDepth")) {
        patch.maxDepth = Number.parseInt(flagString(flags, "maxDepth")!, 10);
      }
      if (flagBool(flags, "user")) patch.scopeUser = true;
      if (flagBool(flags, "assistant")) patch.scopeAssistant = true;
      const rule = await rt.regexConfig.updateRule(groupId, ruleId, patch);
      console.log(rule.ruleId);
      return;
    }
    case "delete": {
      const groupId = requireGroupId(flags);
      const ruleId = flagString(flags, "regexId");
      if (!ruleId) {
        throw new Error(
          "Usage: nm regex delete --regexGroup <id> --regexId <id>",
        );
      }
      await rt.regexConfig.deleteRule(groupId, ruleId);
      return;
    }
    case "enable":
    case "disable": {
      const groupId = requireGroupId(flags);
      const ruleId = flagString(flags, "regexId");
      if (!ruleId) {
        throw new Error(
          `Usage: nm regex ${subcommand} --regexGroup <id> --regexId <id>`,
        );
      }
      await rt.regexConfig.setRuleEnabled(
        groupId,
        ruleId,
        subcommand === "enable",
      );
      return;
    }
    case "test": {
      const groupId = requireGroupId(flags);
      const ruleId = flagString(flags, "regexId");
      const channel = flagString(flags, "channel");
      const text = flagString(flags, "text") ?? "";
      const floorRaw = flagString(flags, "floor") ?? "1";
      const role = flagString(flags, "role") ?? "user";
      if (!ruleId) {
        throw new Error(
          "Usage: nm regex test --regexGroup <id> --regexId <id> --channel llm|display [--text <s>] [--floor <n>] [--role user|assistant]",
        );
      }
      if (channel !== "llm" && channel !== "display") {
        throw new Error("--channel is required: llm or display");
      }
      const rule = await rt.regexConfig.getRule(groupId, ruleId);
      const compiled = compileRegexRule(rule);
      const floor = Number.parseInt(floorRaw, 10);
      const out = applyRegexRules(text, [compiled], {
        channel,
        floor,
        role,
      });
      console.log(out);
      return;
    }
    default:
      throw new Error(
        "Usage: nm regex <create|list|show|edit|delete|enable|disable|test> ...",
      );
  }
}
