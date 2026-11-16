import { readFile } from "node:fs/promises";
import { type TdbcConnection } from "@novel-master/core";

import { createCharacterCardImportService, type VfsScope } from "@novel-master/core/vfs";
import { type AppError, type Result } from "@novel-master/core/errors";
import { parseCliArgs } from "../parse-args.js";

export async function runImportCharacterCard(conn: TdbcConnection, scope: VfsScope, args: readonly string[]): Promise<Result<void, AppError>> {
  const { flags } = parseCliArgs(args);
  const file = flags.get("file");
  if (typeof file !== "string" || file === "") {
    throw new Error("Usage: import-character-card --file <path> [--path <directoryPath>] [--yes]");
  }
  const confirmed = flags.get("yes") === true;
  const pathFlag = flags.get("path");
  const directoryPath = typeof pathFlag === "string" && pathFlag !== "" ? pathFlag : "/";

  const raw = await readFile(file);
  const cardSvc = createCharacterCardImportService(conn);
  // 错误通道迁移四期：解析失败走返回值（character-card port 四期契约），
  // confirmed / 体积闸门与导入事务链仍按边界抛出，由 main.ts 统一出口 catch 收口。
  return cardSvc.importFromBytes(scope, new Uint8Array(raw), {
    confirmed,
    directoryPath,
  });
}
