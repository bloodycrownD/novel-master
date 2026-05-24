/**
 * `nm message` subcommands.
 *
 * @module message/commands
 */

import { readFile } from "node:fs/promises";
import type { MessageService } from "@novel-master/core";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runMessage(
  messages: MessageService,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const sessionId = flags.get("session");
  if (typeof sessionId !== "string") {
    throw new Error("Missing --session <id>");
  }

  switch (subcommand) {
    case "list": {
      const list = await messages.listBySession(sessionId);
      for (const m of list) {
        const text = m.content.content ?? JSON.stringify(m.content);
        console.log(`${m.id}\t${m.seq}\t${m.role}\t${text}`);
      }
      return;
    }
    case "append": {
      const role = flags.get("role");
      const contentFlag = flags.get("content");
      const fileFlag = flags.get("file");
      if (typeof role !== "string") {
        throw new Error(
          "Usage: nm message append --session <id> --role <role> [--content <text>|--file <path>]",
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
          "Usage: nm message append --session <id> --role <role> [--content <text>|--file <path>]",
        );
      }
      const msg = await messages.append(sessionId, role, { content });
      console.log(msg.id);
      return;
    }
    case "delete": {
      const messageId = flags.get("message");
      if (typeof messageId !== "string") {
        throw new Error("Usage: nm message delete --session <id> --message <id>");
      }
      await messages.delete(messageId);
      return;
    }
    case "fork": {
      const upTo = flags.get("up-to");
      if (typeof upTo !== "string") {
        throw new Error("Usage: nm message fork --session <id> --up-to <messageId>");
      }
      const forked = await messages.fork(sessionId, upTo);
      console.log(forked.id);
      return;
    }
    default:
      throw new Error("Usage: nm message <list|append|delete|fork> ...");
  }
}
