/**
 * Desktop update-check service — wraps main-process fetch + semver compare.
 */

import { app } from "electron";
import { type AppError, Result } from "@novel-master/core/errors";
import { checkForUpdates } from "../update-check/check-for-updates.js";
import type { UpdateCheckData } from "../update-check/types.js";

// nm-style: keep-public — app-info.ts:32 经动态 import() 解构消费（检查器只解析静态 import）
export async function runUpdateCheck(): Promise<Result<UpdateCheckData, AppError>> {
  const localVersion = app.getVersion();
  return checkForUpdates(localVersion);
}
