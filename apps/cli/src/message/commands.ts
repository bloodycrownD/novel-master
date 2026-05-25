/**
 * `nm message` subcommands.
 *
 * @module message/commands
 */

import { readFile } from "node:fs/promises";
import type { NovelMasterRuntime } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runMessage(
  rt: Pick<NovelMasterRuntime, "messages" | "scope">,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const sessionId = await rt.scope.resolveSessionId(flags);

  switch (subcommand) {
    case "list": {
      const list = await rt.messages.listBySession(sessionId);
      for (const m of list) {
        const text = m.content.content ?? JSON.stringify(m.content);
        // Display [H] marker for hidden messages
        const hiddenMark = m.hidden ? "[H]" : "";
        console.log(`${m.id}\t${m.seq}\t${m.role}\t${hiddenMark}\t${text}`);
      }
      return;
    }
    case "append": {
      const role = flags.get("role");
      const contentFlag = flags.get("content");
      const fileFlag = flags.get("file");
      if (typeof role !== "string") {
        throw new Error(
          "Usage: nm message append [--session <id>] --role <role> [--content <text>|--file <path>]",
        );
      }
      if (typeof contentFlag === "string" && typeof fileFlag === "string") {
        throw new Error("Cannot use both --content and --file");
      }
      const content =
        typeof fileFlag === "string"
          ? await readFile(fileFlag, "utf8")
          : typeof contentFlag === "string"
            ? contentFlag
            : null;
      if (content == null) {
        throw new Error(
          "Usage: nm message append [--session <id>] --role <role> [--content <text>|--file <path>]",
        );
      }
      const msg = await rt.messages.append(sessionId, role, { content });
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
      // Single message hide
      if (typeof messageId === "string") {
        await rt.messages.hide(messageId);
        return;
      }
      // Batch hide by seq range
      const fromSeqRaw = flags.get("from-seq");
      const toSeqRaw = flags.get("to-seq");
      if (typeof fromSeqRaw !== "string" || typeof toSeqRaw !== "string") {
        throw new Error(
          "Usage: nm message hide --message <id> | --session <id> --from-seq <n> --to-seq <n>",
        );
      }
      const count = await rt.messages.hideRange(
        sessionId,
        Number.parseInt(fromSeqRaw, 10),
        Number.parseInt(toSeqRaw, 10),
      );
      console.log(`Hidden ${count} message(s)`);
      return;
    }
    case "show": {
      const messageId = flags.get("message");
      // Single message show
      if (typeof messageId === "string") {
        await rt.messages.show(messageId);
        return;
      }
      // Batch show by seq range
      const fromSeqRaw = flags.get("from-seq");
      const toSeqRaw = flags.get("to-seq");
      if (typeof fromSeqRaw !== "string" || typeof toSeqRaw !== "string") {
        throw new Error(
          "Usage: nm message show --message <id> | --session <id> --from-seq <n> --to-seq <n>",
        );
      }
      const count = await rt.messages.showRange(
        sessionId,
        Number.parseInt(fromSeqRaw, 10),
        Number.parseInt(toSeqRaw, 10),
      );
      console.log(`Shown ${count} message(s)`);
      return;
    }
    default:
      throw new Error("Usage: nm message <list|append|delete|fork|hide|show> ...");
  }
}
