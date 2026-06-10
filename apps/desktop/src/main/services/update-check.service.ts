/**
 * Desktop update-check service — wraps main-process fetch + semver compare.
 */

import { app } from "electron";
import { checkForUpdates } from "../update-check/check-for-updates.js";
import type { UpdateCheckData } from "../update-check/types.js";

export async function runUpdateCheck(): Promise<UpdateCheckData> {
  const localVersion = app.getVersion();
  return checkForUpdates(localVersion);
}
