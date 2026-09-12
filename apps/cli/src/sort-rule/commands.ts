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
  SMART_SORT_CAPTURE_KINDS,
  type SmartSortCaptureKind,
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

/** --capture-kind 取值校验（D13 三档，非法值报错而非静默缺省 smart）。 */
function parseCaptureKind(value: string): SmartSortCaptureKind {
  if ((SMART_SORT_CAPTURE_KINDS as readonly string[]).includes(value)) {
    return value as SmartSortCaptureKind;
  }
  throw new Error(
    `invalid --capture-kind: ${value} (expected ${SMART_SORT_CAPTURE_KINDS.join("|")})`,
  );
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
        // 列序钉死：order⇥id⇥enabled⇥capture⇥flags⇥name⇥pattern（D13 后
        // capture 列插在 enabled 后）。序号元组显示：固定档哨兵文案友好化，
        // smart 档保持数字（-Infinity/Infinity 不适合 TSV 直出）。
        console.log(
          `${r.sortOrder}\t${r.ruleId}\t${en}\t${r.captureKind}\t${r.flags}\t${r.name}\t${r.pattern}`,
        );
      }
      return;
    }
    case "create": {
      const name = flagString(flags, "name");
      const pattern = flagString(flags, "pattern");
      if (!name || !pattern) {
        throw new Error(
          "Usage: nm sort-rule create --name <n> --pattern <p> [--description <d>] [--flags <f>] [--capture-kind <smart|fixed_min|fixed_max>]",
        );
      }
      const rule = await svc.createRule({
        name,
        pattern,
        ...(flags.has("description")
          ? { description: flagString(flags, "description") ?? null }
          : {}),
        ...(flags.has("flags") ? { flags: flagString(flags, "flags") } : {}),
        ...(flags.has("capture-kind")
          ? {
              captureKind: parseCaptureKind(
                flagString(flags, "capture-kind") ?? "smart",
              ),
            }
          : {}),
      });
      console.log(rule.ruleId);
      return;
    }
    case "update": {
      const ruleId = flagString(flags, "id");
      if (!ruleId) {
        throw new Error(
          "Usage: nm sort-rule update --id <ruleId> [--name <n>] [--pattern <p>] [--description <d>] [--flags <f>] [--capture-kind <smart|fixed_min|fixed_max>]",
        );
      }
      const patch: UpdateSmartSortRuleInput = {};
      if (flags.has("name")) patch.name = flagString(flags, "name");
      if (flags.has("pattern")) patch.pattern = flagString(flags, "pattern");
      if (flags.has("description")) {
        patch.description = flagString(flags, "description") ?? null;
      }
      if (flags.has("flags")) patch.flags = flagString(flags, "flags");
      if (flags.has("capture-kind")) {
        patch.captureKind = parseCaptureKind(
          flagString(flags, "capture-kind") ?? "smart",
        );
      }
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
        // 序号元组显示：null → '-'；固定档哨兵 → 文案（D13）；smart → 逗号连接。
        const nums =
          line.nums == null
            ? "-"
            : line.nums[0] === -Infinity
              ? "固定最小"
              : line.nums[0] === Infinity
                ? "固定最大"
                : line.nums.join(",");
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
