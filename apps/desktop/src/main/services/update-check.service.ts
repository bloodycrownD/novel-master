/**
 * Desktop update-check service — wraps main-process fetch + semver compare.
 */

import { app } from "electron";
import { type AppError, Result } from "@novel-master/core/errors";
import { checkForUpdates } from "../update-check/check-for-updates.js";
import type { UpdateCheckData } from "../update-check/types.js";

export async function runUpdateCheck(): Promise<Result<UpdateCheckData, AppError>> {
  const localVersion = app.getVersion();
  return checkForUpdates(localVersion);
}
