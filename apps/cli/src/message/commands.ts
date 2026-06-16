/**
 * `nm message` subcommands.
 *
 * @module message/commands
 */

import { readFile } from "node:fs/promises";
import { assertMessageContent, formatMessageForCli, parseMessageContent, textBlocks } from "@novel-master/core/chat";
import { type ChatMessage } from "@novel-master/core/chat";
import type { NovelMasterRuntime } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";
import { applyActiveRegexChannel } from "../regex/apply-channel.js";
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
  messages: readonly ChatMessage[],
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

async function resolveAppendContent(
  flags: ReadonlyMap<string, string | true>,
): Promise<ReturnType<typeof textBlocks>> {
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
    return textBlocks(contentFlag);
  }
  if (typeof blocksJson === "string") {
    return parseMessageContent(blocksJson);
  }
  if (typeof blocksPath === "string") {
    const raw = await readFile(blocksPath, "utf8");
    return parseMessageContent(raw);
  }
  if (typeof fileFlag === "string") {
    const text = await readFile(fileFlag, "utf8");
    return textBlocks(text);
  }

  throw new Error(
    "Usage: nm message append [--session <id>] --role <role> [--content <text>|--blocks <path>|--blocks-json <json>|--file <path>]",
  );
}

export async function runMessage(
  rt: Pick<NovelMasterRuntime, "messages" | "scope" | "state" | "regexConfig">,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const sessionId = await rt.scope.resolveSessionId(flags);

  switch (subcommand) {
    case "list": {
      const all = await rt.messages.listBySession(sessionId);
      const activeGroupId = await rt.state.getCurrentRegexGroupId();
      const visible = all.filter((m) => !m.hidden);
      const displayVisible = await applyActiveRegexChannel(
        rt.regexConfig,
        activeGroupId,
        all,
        visible,
        "display",
      );
      const displayById = new Map(displayVisible.map((m) => [m.id, m]));
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
      return;
    }
    case "append": {
      const role = flags.get("role");
      if (typeof role !== "string") {
        throw new Error(
          "Usage: nm message append [--session <id>] --role <role> [--content <text>|--blocks <path>|--blocks-json <json>|--file <path>]",
        );
      }
      const content = await resolveAppendContent(flags);
      assertMessageContent(content);
      const msg = await rt.messages.append(sessionId, role, content);
      console.log(msg.id);
      return;
    }
    case "delete": {
      const messageId = flags.get("message");
      if (typeof messageId !== "string") {
        throw new Error(
          "Usage: nm message delete [--session <id>] --message <id>",
        );
      }
      await rt.messages.delete(messageId);
      return;
    }
    case "fork": {
      const upTo = flags.get("up-to");
      if (typeof upTo !== "string") {
        throw new Error(
          "Usage: nm message fork [--session <id>] --up-to <messageId>",
        );
      }
      const forked = await rt.messages.fork(sessionId, upTo);
      console.log(forked.id);
      return;
    }
    case "hide": {
      const messageId = flags.get("message");
      if (typeof messageId === "string") {
        await rt.messages.hide(messageId);
        return;
      }
      const list = await rt.messages.listBySession(sessionId);
      const { fromSeq, toSeq } = resolveSeqRange(flags, list);
      const count = await rt.messages.hideRange(sessionId, fromSeq, toSeq);
      console.log(`Hidden ${count} message(s)`);
      return;
    }
    case "show": {
      const messageId = flags.get("message");
      if (typeof messageId === "string") {
        await rt.messages.show(messageId);
        return;
      }
      const list = await rt.messages.listBySession(sessionId);
      const { fromSeq, toSeq } = resolveSeqRange(flags, list);
      const count = await rt.messages.showRange(sessionId, fromSeq, toSeq);
      console.log(`Shown ${count} message(s)`);
      return;
    }
    default:
      throw new Error("Usage: nm message <list|append|delete|fork|hide|show> ...");
  }
}
