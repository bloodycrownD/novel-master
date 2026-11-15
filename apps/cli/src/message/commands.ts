/**
 * `nm message` subcommands.
 *
 * @module message/commands
 */

import { readFile } from "node:fs/promises";
import { formatMessageForCli, parseMessageContent, textBlocks } from "@novel-master/core/chat";
import { type ChatMessageData } from "@novel-master/core/chat";
import { type AppError, Result } from "@novel-master/core/errors";
import type { NovelMasterRuntime } from "../runtime.js";
import { RESULT_OK } from "../cli-errors.js";
import { parseCliArgs } from "../vfs/parse-args.js";
import { seqRangeFromFloors } from "./floor.js";

const BATCH_RANGE_USAGE =
  "--message <id> | --from-floor <n> --to-floor <n> | --from-seq <n> --to-seq <n>";

function parsePositiveInt(raw: string, label: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return n;
}

/** Resolves batch hide/show range: prefer floor (UI), allow seq (scripts). */
function resolveSeqRange(
  flags: ReadonlyMap<string, string | true>,
  messages: readonly ChatMessageData[],
): { fromSeq: number; toSeq: number } {
  const fromFloor = flags.get("from-floor");
  const toFloor = flags.get("to-floor");
  const fromSeqRaw = flags.get("from-seq");
  const toSeqRaw = flags.get("to-seq");

  const hasFloor = fromFloor !== undefined || toFloor !== undefined;
  const hasSeq = fromSeqRaw !== undefined || toSeqRaw !== undefined;

  if (hasFloor && hasSeq) {
    throw new Error("Use either --from-floor/--to-floor or --from-seq/--to-seq");
  }

  if (hasFloor) {
    if (typeof fromFloor !== "string" || typeof toFloor !== "string") {
      throw new Error("Both --from-floor and --to-floor are required");
    }
    return seqRangeFromFloors(
      messages,
      parsePositiveInt(fromFloor, "from-floor"),
      parsePositiveInt(toFloor, "to-floor"),
    );
  }

  if (hasSeq) {
    if (typeof fromSeqRaw !== "string" || typeof toSeqRaw !== "string") {
      throw new Error("Both --from-seq and --to-seq are required");
    }
    return {
      fromSeq: parsePositiveInt(fromSeqRaw, "from-seq"),
      toSeq: parsePositiveInt(toSeqRaw, "to-seq"),
    };
  }

  throw new Error(`Usage: ${BATCH_RANGE_USAGE}`);
}

/**
 * 解析的 `Result` 失败沿返回值交给上层（错误通道迁移四期），由 main.ts 统一出口收口。
 */
async function resolveAppendContent(
  flags: ReadonlyMap<string, string | true>,
): Promise<Result<ReturnType<typeof textBlocks>, AppError>> {
  const contentFlag = flags.get("content");
  const blocksPath = flags.get("blocks");
  const blocksJson = flags.get("blocks-json");
  const fileFlag = flags.get("file");

  const blockInputs = [
    contentFlag !== undefined,
    blocksPath !== undefined,
    blocksJson !== undefined,
    fileFlag !== undefined,
  ].filter(Boolean).length;

  if (blockInputs > 1) {
    throw new Error("Use only one of --content, --blocks, --blocks-json, or --file");
  }

  if (typeof contentFlag === "string") {
    return Result.ok(textBlocks(contentFlag));
  }
  if (typeof blocksJson === "string") {
    const parsed = parseMessageContent(blocksJson);
    if (!parsed.ok) return parsed;
    return Result.ok(parsed.value);
  }
  if (typeof blocksPath === "string") {
    const raw = await readFile(blocksPath, "utf8");
    const parsed = parseMessageContent(raw);
    if (!parsed.ok) return parsed;
    return Result.ok(parsed.value);
  }
  if (typeof fileFlag === "string") {
    const text = await readFile(fileFlag, "utf8");
    return Result.ok(textBlocks(text));
  }

  throw new Error(
    "Usage: nm message append [--session <id>] --role <role> [--content <text>|--blocks <path>|--blocks-json <json>|--file <path>]",
  );
}

export async function runMessage(
  rt: Pick<NovelMasterRuntime, "messages" | "scope" | "state">,
  subcommand: string,
  args: readonly string[],
): Promise<Result<void, AppError>> {
  const { flags } = parseCliArgs(args);
  const resolvedSession = await rt.scope.resolveSessionId(flags);
  if (!resolvedSession.ok) return Result.err(resolvedSession.error);
  const sessionId = resolvedSession.value;

  switch (subcommand) {
    case "list": {
      const all = await rt.messages.listBySession(sessionId);
      const visible = all.filter((m) => !m.hidden);
      const displayById = new Map(visible.map((m) => [m.id, m]));
      const showSeq = flags.get("show-seq") === true;
      let floor = 0;
      for (const m of all) {
        const shown = m.hidden ? m : (displayById.get(m.id) ?? m);
        if (!m.hidden) {
          floor += 1;
        }
        const text = formatMessageForCli(shown.content).replace(/\n/g, "⏎");
        const hiddenMark = m.hidden ? "[H]" : "";
        const orderCol = showSeq ? `${floor || ""}\t${m.seq}` : m.hidden ? "" : String(floor);
        console.log(`${m.id}\t${orderCol}\t${m.role}\t${hiddenMark}\t${text}`);
      }
      return RESULT_OK;
    }
    case "append": {
      const role = flags.get("role");
      if (typeof role !== "string") {
        throw new Error(
          "Usage: nm message append [--session <id>] --role <role> [--content <text>|--blocks <path>|--blocks-json <json>|--file <path>]",
        );
      }
      const content = await resolveAppendContent(flags);
      if (!content.ok) return Result.err(content.error);
      const msg = await rt.messages.append(sessionId, role, content.value);
      if (!msg.ok) return Result.err(msg.error);
      console.log(msg.value.id);
      return RESULT_OK;
    }
    case "delete": {
      const messageId = flags.get("message");
      if (typeof messageId !== "string") {
        throw new Error(
          "Usage: nm message delete [--session <id>] --message <id>",
        );
      }
      const deleted = await rt.messages.delete(messageId);
      if (!deleted.ok) return Result.err(deleted.error);
      return RESULT_OK;
    }
    case "fork": {
      const upTo = flags.get("up-to");
      if (typeof upTo !== "string") {
        throw new Error(
          "Usage: nm message fork [--session <id>] --up-to <messageId>",
        );
      }
      const forked = await rt.messages.fork(sessionId, upTo);
      if (!forked.ok) return Result.err(forked.error);
      console.log(forked.value.id);
      return RESULT_OK;
    }
    case "hide": {
      const messageId = flags.get("message");
      if (typeof messageId === "string") {
        const hidden = await rt.messages.hide(messageId);
        if (!hidden.ok) return hidden;
        return RESULT_OK;
      }
      const list = await rt.messages.listBySession(sessionId);
      const { fromSeq, toSeq } = resolveSeqRange(flags, list);
      const count = await rt.messages.hideRange(sessionId, fromSeq, toSeq);
      if (!count.ok) return Result.err(count.error);
      console.log(`Hidden ${count.value} message(s)`);
      return RESULT_OK;
    }
    case "show": {
      const messageId = flags.get("message");
      if (typeof messageId === "string") {
        const shown = await rt.messages.show(messageId);
        if (!shown.ok) return shown;
        return RESULT_OK;
      }
      const list = await rt.messages.listBySession(sessionId);
      const { fromSeq, toSeq } = resolveSeqRange(flags, list);
      const count = await rt.messages.showRange(sessionId, fromSeq, toSeq);
      if (!count.ok) return Result.err(count.error);
      console.log(`Shown ${count.value} message(s)`);
      return RESULT_OK;
    }
    default:
      throw new Error("Usage: nm message <list|append|delete|fork|hide|show> ...");
  }
}
