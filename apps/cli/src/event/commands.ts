/**
 * `nm event emit` — 旧事件编排器入口。
 *
 * Step 8（本轮）已删除 eventOrchestrator 装配，该命令随之失效。
 * 文件与命令注册保留到 Step 17（phase-delete-cli）统一删除，
 * 此处仅保留占位实现让编译通过。
 *
 * @module event/commands
 */

import type { NovelMasterRuntime } from "../runtime.js";

export async function runEvent(
  _rt: NovelMasterRuntime,
  subcommand: string,
  _args: readonly string[],
): Promise<void> {
  if (subcommand !== "emit") {
    throw new Error("Usage: nm event emit <eventType> [--session <id>] [--project <id>]");
  }
  // eventOrchestrator 已在 Step 8 移除；该命令将在 Step 17（phase-delete-cli）正式删除。
  throw new Error(
    "nm event emit 已随事件编排器移除（Step 8），将在 Step 17 正式删除命令入口",
  );
}
