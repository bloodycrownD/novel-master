/**
 * Shared `workplace` subcommand handler.
 *
 * ## display 双路径（A1）
 *
 * - **有 session 上下文**（`nm session workplace display`）：走
 *   {@link assembleWorkplaceDisplay}（session kkv `rule_snapshot` + `file_cache`），
 *   与 Agent 常驻前缀 / `prompt render` 同源，避免 CLI 与聊天漂移。
 * - **无 session**（`nm vfs|project workplace display`）：无 kkv 可写，只能走
 *   `WorkplaceService.renderDisplay` → `materializePersistBlock`（直读 VFS 的
 *   **调试 live materialize**）。此路径**不是**聊天前缀；规则改完后立刻反映盘面，
 *   但不写/不读 file_cache，也与 Agent 前缀可能不一致。
 *
 * @module workplace/run-workplace
 */

import {
  assembleWorkplaceDisplay,
  type FillPolicy,
  type InclusionMode,
  type SortField,
  type SortOrder,
  type WorkplaceService,
} from "@novel-master/core/workplace";
import type { SessionKkvService } from "@novel-master/core/session-kkv";
import type { VfsService } from "@novel-master/core/vfs";
import { parseCliArgs } from "../vfs/parse-args.js";

/**
 * Session 作用域下的 display 装配依赖（与聊天前缀同源）。
 * 仅 `nm session workplace display` 传入；global/project 不得传。
 */
export interface WorkplaceDisplayAssembleContext {
  readonly projectId: string;
  readonly sessionId: string;
  readonly sessionKkv: SessionKkvService;
  readonly vfs: VfsService;
}

export async function runWorkplace(
  service: WorkplaceService,
  args: readonly string[],
  assemble?: WorkplaceDisplayAssembleContext,
): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const sub = positional[0];
  const rest = positional.slice(1);

  switch (sub) {
    case "list": {
      const rows = await service.buildListRows();
      console.log("kind\tpath\trule_state\tinclusion_mode\tdisplay_state");
      for (const row of rows) {
        if (row.kind === "dir") {
          console.log(`${row.kind}\t${row.path}\t${row.ruleState}\t\t`);
        } else {
          console.log(
            `${row.kind}\t${row.path}\t\t${row.inclusionMode}\t${row.displayState}`,
          );
        }
      }
      return;
    }
    case "display": {
      const text = await resolveWorkplaceDisplay(service, assemble);
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
        throw new Error("Usage: workplace dir <logicalPath> [--rule on|off] ...");
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
          "Usage: workplace file <logicalPath> --mode auto|show|hide",
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
        "Usage: workplace <display|dir|file|list> ...",
      );
  }
}

/**
 * Session → assemble（聊天同源）；否则 → live materialize（调试盘面）。
 */
async function resolveWorkplaceDisplay(
  service: WorkplaceService,
  assemble: WorkplaceDisplayAssembleContext | undefined,
): Promise<string> {
  if (assemble == null) {
    // 调试 live materialize：无 session kkv，与 Agent 常驻前缀不同源。
    return service.renderDisplay();
  }
  const scope = {
    kind: "session" as const,
    projectId: assemble.projectId,
    sessionId: assemble.sessionId,
  };
  // CLI 显式要看常驻正文时强制开 workplace（与 Mobile assembleWorkplaceForMobile 一致）。
  const { workplaceDisplay } = await assembleWorkplaceDisplay(scope, {
    sessionKkv: assemble.sessionKkv,
    workplace: service,
    vfs: assemble.vfs,
    layout: { workplace: true },
  });
  return workplaceDisplay;
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
