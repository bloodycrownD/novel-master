/**
 * IPC handlers for app metadata and GitHub release update checks (main-process fetch).
 */

import { formatIpcError } from "../format-ipc-error.js";
import type {
  AppCheckForUpdatesResponse,
  AppGetInfoResponse,
  AppOpenExternalRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import type { UpdateCheckData } from "../../update-check/types.js";

type AppInfoSeams = {
  getVersion: () => string;
  getName: () => string;
  getPlatform: () => NodeJS.Platform;
  runUpdateCheck: () => Promise<UpdateCheckData>;
  openExternal: (url: string) => Promise<void>;
};

let seamsOverride: AppInfoSeams | null = null;
let defaultSeamsPromise: Promise<AppInfoSeams> | null = null;

async function loadDefaultSeams(): Promise<AppInfoSeams> {
  const [{ app, shell }, { runUpdateCheck }] = await Promise.all([
    import("electron"),
    import("../../services/update-check.service.js"),
  ]);
  return {
    getVersion: () => app.getVersion(),
    getName: () => app.getName(),
    getPlatform: () => process.platform,
    runUpdateCheck,
    openExternal: (url) => shell.openExternal(url),
  };
}

async function getSeams(): Promise<AppInfoSeams> {
  if (seamsOverride) {
    return seamsOverride;
  }
  if (!defaultSeamsPromise) {
    defaultSeamsPromise = loadDefaultSeams();
  }
  return defaultSeamsPromise;
}

/** @internal Test seam for handler unit tests. */
export function __setAppInfoSeamsForTests(
  overrides: Partial<AppInfoSeams> | null,
): void {
  if (overrides === null) {
    seamsOverride = null;
    defaultSeamsPromise = null;
    return;
  }
  seamsOverride = {
    getVersion: overrides.getVersion ?? (() => "0.0.0"),
    getName: overrides.getName ?? (() => "Novel Master"),
    getPlatform: overrides.getPlatform ?? (() => process.platform),
    runUpdateCheck:
      overrides.runUpdateCheck ??
      (async () => {
        throw new Error("runUpdateCheck not configured for tests");
      }),
    openExternal:
      overrides.openExternal ??
      (async () => {
        throw new Error("openExternal not configured for tests");
      }),
  };
}

export async function handleAppGetInfo(): Promise<AppGetInfoResponse> {
  try {
    const seams = await getSeams();
    return {
      ok: true,
      data: {
        version: seams.getVersion(),
        platform: seams.getPlatform(),
        name: seams.getName(),
      },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAppCheckForUpdates(): Promise<AppCheckForUpdatesResponse> {
  try {
    const seams = await getSeams();
    const data = await seams.runUpdateCheck();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAppOpenExternal(
  req: AppOpenExternalRequest,
): Promise<IpcResult<void>> {
  try {
    const url = req.url?.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return { ok: false, error: { code: "INVALID_URL", message: "无效的链接" } };
    }
    const seams = await getSeams();
    await seams.openExternal(url);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
