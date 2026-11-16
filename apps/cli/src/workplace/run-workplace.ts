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

import { assembleWorkplaceDisplay, type FillPolicy, type InclusionMode, type Outcome, type SortField, type SortOrder, type WorkplaceService } from "@novel-master/core/workplace";
import type { SessionKkvService } from "@novel-master/core/session-kkv";
import type { VfsService } from "@novel-master/core/vfs";
import { OUTCOME_COMPLETED } from "../cli-errors.js";
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

export async function runWorkplace(service: WorkplaceService, args: readonly string[], assemble?: WorkplaceDisplayAssembleContext): Promise<Outcome<void>> {
  const { positional, flags } = parseCliArgs(args);
  const sub = positional[0];
  const rest = positional.slice(1);

  switch (sub) {
    case "list": {
      const built = await service.buildListRows();
      if (!built.ok) return { kind: "failed", error: built.error };
      console.log("kind\tpath\trule_state\tinclusion_mode\tdisplay_state");
      for (const row of built.value) {
        if (row.kind === "dir") {
          console.log(`${row.kind}\t${row.path}\t${row.ruleState}\t\t`);
        } else {
          console.log(`${row.kind}\t${row.path}\t\t${row.inclusionMode}\t${row.displayState}`);
        }
      }
      return OUTCOME_COMPLETED;
    }
    case "display": {
      let displayText: string;
      if (assemble == null) {
        // 调试 live materialize：无 session kkv，与 Agent 常驻前缀不同源。
        const rendered = await service.renderDisplay();
        if (!rendered.ok) return { kind: "failed", error: rendered.error };
        displayText = rendered.value;
      } else {
        const scope = { kind: "session" as const, projectId: assemble.projectId, sessionId: assemble.sessionId };
        // CLI 显式要看常驻正文时强制开 workplace（与 Mobile assembleWorkplaceForMobile 一致）。
        const assembled = await assembleWorkplaceDisplay(scope, { sessionKkv: assemble.sessionKkv, workplace: service, vfs: assemble.vfs, layout: { workplace: "on" } });
        // failed 与 cancelled/replaced 同走 Outcome 通道：failed 交 main 边界 unwrap
        // 汇入 catch 统一出口，中断走 EXIT_CANCELLED（错误通道迁移三期）。
        if (assembled.kind !== "completed") return assembled;
        displayText = assembled.value.workplaceDisplay;
      }
      if (displayText.length > 0) {
        process.stdout.write(displayText);
        if (!displayText.endsWith("\n")) {
          process.stdout.write("\n");
        }
      }
      return OUTCOME_COMPLETED;
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
      const ruleEnabled = ruleRaw === "on" ? true : ruleRaw === "off" ? false : undefined;
      let sortField: SortField | undefined;
      if (typeof sortRaw === "string") {
        if (sortRaw === "name" || sortRaw === "created" || sortRaw === "updated" || sortRaw === "smart") {
          sortField = sortRaw;
        } else {
          throw new Error(`invalid --sort: ${sortRaw}`);
        }
      }
      let sortOrder: SortOrder | undefined;
      if (typeof orderRaw === "string") {
        if (orderRaw === "asc" || orderRaw === "desc") {
          sortOrder = orderRaw;
        } else {
          throw new Error(`invalid --order: ${orderRaw}`);
        }
      }
      const headCount = headRaw != null ? parseCount(headRaw, "head") : undefined;
      const tailCount = tailRaw != null ? parseCount(tailRaw, "tail") : undefined;
      let fillPolicy: FillPolicy | undefined;
      if (typeof fillRaw === "string") {
        if (fillRaw === "hidden" || fillRaw === "filename" || fillRaw === "header" || fillRaw === "full") {
          fillPolicy = fillRaw;
        } else {
          throw new Error(`invalid --fill: ${fillRaw}`);
        }
      }
      await service.setDirRule({ logicalPath, ruleEnabled, sortField, sortOrder, headCount, tailCount, fillPolicy });
      return OUTCOME_COMPLETED;
    }
    case "file": {
      const logicalPath = rest[0];
      const modeRaw = flags.get("mode");
      if (logicalPath == null || typeof modeRaw !== "string") {
        throw new Error("Usage: workplace file <logicalPath> --mode auto|show|hide");
      }
      let inclusionMode: InclusionMode;
      if (modeRaw === "auto" || modeRaw === "show" || modeRaw === "hide") {
        inclusionMode = modeRaw;
      } else {
        throw new Error(`invalid --mode: ${modeRaw}`);
      }
      await service.setFileRule({ logicalPath, inclusionMode });
      return OUTCOME_COMPLETED;
    }
    default:
      throw new Error("Usage: workplace <display|dir|file|list> ...");
  }
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
