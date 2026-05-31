/**
 * Shared `worktree` subcommand handler.
 *
 * @module worktree/run-worktree
 */

import type {
  FillPolicy,
  InclusionMode,
  SortField,
  SortOrder,
  WorktreeService,
} from "@novel-master/core";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runWorktree(
  service: WorktreeService,
  args: readonly string[],
): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const sub = positional[0];
  const rest = positional.slice(1);

  switch (sub) {
    case "list": {
      const rows = await service.buildListRows();
      console.log("kind\tpath\trule_state\tinclusion_mode\tdisplay_state");
      for (const row of rows) {
        console.log(
          `${row.kind}\t${row.path}\t${row.ruleState}\t${row.inclusionMode}\t${row.displayState}`,
        );
      }
      return;
    }
    case "display": {
      const text = await service.renderDisplay();
      if (text.length > 0) {
        process.stdout.write(text);
        if (!text.endsWith("\n")) {
          process.stdout.write("\n");
        }
      }
      return;
    }
    case "dir": {
      const logicalPath = rest[0];
      if (logicalPath == null) {
        throw new Error("Usage: worktree dir <logicalPath> [--rule on|off] ...");
      }
      const ruleRaw = flags.get("rule");
      const sortRaw = flags.get("sort");
      const orderRaw = flags.get("order");
      const headRaw = flags.get("head");
      const tailRaw = flags.get("tail");
      const fillRaw = flags.get("fill");
      await service.setDirRule({
        logicalPath,
        ruleEnabled:
          ruleRaw === "on"
            ? true
            : ruleRaw === "off"
              ? false
              : undefined,
        sortField: parseSortField(sortRaw),
        sortOrder: parseSortOrder(orderRaw),
        headCount: headRaw != null ? parseCount(headRaw, "head") : undefined,
        tailCount: tailRaw != null ? parseCount(tailRaw, "tail") : undefined,
        fillPolicy: parseFillPolicy(fillRaw),
      });
      return;
    }
    case "file": {
      const logicalPath = rest[0];
      const modeRaw = flags.get("mode");
      if (logicalPath == null || typeof modeRaw !== "string") {
        throw new Error(
          "Usage: worktree file <logicalPath> --mode auto|show|hide",
        );
      }
      await service.setFileRule({
        logicalPath,
        inclusionMode: parseInclusionMode(modeRaw),
      });
      return;
    }
    default:
      throw new Error(
        "Usage: worktree <display|dir|file|list> ...",
      );
  }
}

function parseSortField(value: string | true | undefined): SortField | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value === "name" || value === "created" || value === "updated") {
    return value;
  }
  throw new Error(`invalid --sort: ${value}`);
}

function parseSortOrder(value: string | true | undefined): SortOrder | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value === "asc" || value === "desc") {
    return value;
  }
  throw new Error(`invalid --order: ${value}`);
}

function parseFillPolicy(
  value: string | true | undefined,
): FillPolicy | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value === "hidden" || value === "filename" || value === "header" || value === "full") {
    return value;
  }
  throw new Error(`invalid --fill: ${value}`);
}

function parseInclusionMode(value: string): InclusionMode {
  if (value === "auto" || value === "show" || value === "hide") {
    return value;
  }
  throw new Error(`invalid --mode: ${value}`);
}

function parseCount(value: string | true, label: string): number {
  if (typeof value !== "string") {
    throw new Error(`--${label} requires a number`);
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0 || n > 1000) {
    throw new Error(`--${label} must be 0..1000`);
  }
  return n;
}
