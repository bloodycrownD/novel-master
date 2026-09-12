/**
 * `nm sort-rule` subcommands (spec Step 9；agent 自测定位，从简).
 *
 * @module sort-rule/commands
 */

import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseText, stringifyText } from "@novel-master/core";
import {
  isBuiltinSmartSortRuleId,
  type SmartSortRuleMoveTarget,
  type UpdateSmartSortRuleInput,
} from "@novel-master/core/smart-sort-rule";
import type { NovelMasterRuntime } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

function formatFromPath(path: string): "yaml" | "json" {
  const ext = extname(path).toLowerCase();
  return ext === ".json" ? "json" : "yaml";
}

/** --to 取值：top/bottom/up/down 或绝对位次数字 N（1 基，与 list 的 order 列同口径）。 */
function parseMoveTarget(value: string): SmartSortRuleMoveTarget {
  if (value === "top" || value === "bottom" || value === "up" || value === "down") {
    return value;
  }
  // N 为 1 基位次（与 list 输出的 order 列一致）：仅接受 >= 1，0 及前导零形态
  // 直接报 invalid，不静默交给 core clamp（0 会被 clamp 到首位、口径对不上）。
  if (/^[1-9]\d*$/.test(value)) {
    return { index: Number.parseInt(value, 10) - 1 };
  }
  throw new Error(
    `invalid --to: ${value} (expected top|bottom|up|down|<N>，N 为 1 基位次)`,
  );
}

export async function runSortRule(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const svc = rt.smartSortRule;

  switch (subcommand) {
    case "list": {
      const rules = await svc.listRules();
      for (const r of rules) {
        const en = r.enabled ? 1 : 0;
        // 列序按 spec Step 9 钉死：order⇥id⇥enabled⇥flags⇥name⇥pattern。
        console.log(
          `${r.sortOrder}\t${r.ruleId}\t${en}\t${r.flags}\t${r.name}\t${r.pattern}`,
        );
      }
      return;
    }
    case "create": {
      const name = flagString(flags, "name");
      const pattern = flagString(flags, "pattern");
      if (!name || !pattern) {
        throw new Error(
          "Usage: nm sort-rule create --name <n> --pattern <p> [--description <d>] [--flags <f>]",
        );
      }
      const rule = await svc.createRule({
        name,
        pattern,
        ...(flags.has("description")
          ? { description: flagString(flags, "description") ?? null }
          : {}),
        ...(flags.has("flags") ? { flags: flagString(flags, "flags") } : {}),
      });
      console.log(rule.ruleId);
      return;
    }
    case "update": {
      const ruleId = flagString(flags, "id");
      if (!ruleId) {
        throw new Error(
          "Usage: nm sort-rule update --id <ruleId> [--name <n>] [--pattern <p>] [--description <d>] [--flags <f>]",
        );
      }
      const patch: UpdateSmartSortRuleInput = {};
      if (flags.has("name")) patch.name = flagString(flags, "name");
      if (flags.has("pattern")) patch.pattern = flagString(flags, "pattern");
      if (flags.has("description")) {
        patch.description = flagString(flags, "description") ?? null;
      }
      if (flags.has("flags")) patch.flags = flagString(flags, "flags");
      const rule = await svc.updateRule(ruleId, patch);
      console.log(rule.ruleId);
      return;
    }
    case "remove": {
      const ruleId = flagString(flags, "id");
      if (!ruleId) {
        throw new Error("Usage: nm sort-rule remove --id <ruleId>");
      }
      if (isBuiltinSmartSortRuleId(ruleId)) {
        throw new Error(
          `builtin- rule cannot be removed (disable it instead): ${ruleId}`,
        );
      }
      await svc.deleteRule(ruleId);
      return;
    }
    case "enable":
    case "disable": {
      const ruleId = flagString(flags, "id");
      if (!ruleId) {
        throw new Error(`Usage: nm sort-rule ${subcommand} --id <ruleId>`);
      }
      await svc.setEnabled(ruleId, subcommand === "enable");
      return;
    }
    case "move": {
      const ruleId = flagString(flags, "id");
      const to = flagString(flags, "to");
      if (!ruleId || !to) {
        throw new Error(
          "Usage: nm sort-rule move --id <ruleId> --to top|bottom|up|down|<N>（N 为 1 基位次）",
        );
      }
      const rules = await svc.moveRule(ruleId, parseMoveTarget(to));
      for (const r of rules) {
        console.log(`${r.sortOrder}\t${r.ruleId}`);
      }
      return;
    }
    case "export": {
      const file = flagString(flags, "file");
      if (!file) {
        throw new Error("Usage: nm sort-rule export --file <path>");
      }
      const doc = await svc.exportRules();
      const text = stringifyText(doc, formatFromPath(file));
      await writeFile(file, text, "utf8");
      console.log(doc.rules.length);
      return;
    }
    case "import": {
      const file = flagString(flags, "file");
      if (!file) {
        throw new Error("Usage: nm sort-rule import --file <path>");
      }
      const source = await readFile(file, "utf8");
      const raw = parseText(source, formatFromPath(file));
      const rules = await svc.importRules(raw);
      console.log(rules.length);
      return;
    }
    case "test": {
      if (positional.length === 0) {
        throw new Error("Usage: nm sort-rule test <name>...");
      }
      const result = await svc.previewSort(positional);
      for (const line of result.lines) {
        const nums = line.nums == null ? "-" : line.nums.join(",");
        console.log(`${line.name}\t${line.matchedRuleId ?? "-"}\t${nums}`);
      }
      console.log("");
      for (const name of result.sortedNames) {
        console.log(name);
      }
      console.log("# asc");
      return;
    }
    default:
      throw new Error(
        "Usage: nm sort-rule <list|create|update|remove|enable|disable|move|export|import|test> ...",
      );
  }
}
