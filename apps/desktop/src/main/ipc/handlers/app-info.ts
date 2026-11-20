/**
 * IPC handlers for app metadata and GitHub release update checks (main-process fetch).
 */

import { type AppError, type Result } from "@novel-master/core/errors";
import type { UpdateCheckData } from "@novel-master/core/common";
import { FormatIpcError } from "../format-ipc-error.js";
import type {
  AppCheckForUpdatesResponse,
  AppGetInfoResponse,
  AppOpenExternalRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";

type AppInfoSeams = {
  getVersion: () => string;
  getName: () => string;
  getPlatform: () => NodeJS.Platform;
  runUpdateCheck: () => Promise<Result<UpdateCheckData, AppError>>;
  openExternal: (url: string) => Promise<void>;
};

let seamsOverride: AppInfoSeams | null = null;
let defaultSeamsPromise: Promise<AppInfoSeams> | null = null;

export const AppInfo = {
  async getSeams(): Promise<AppInfoSeams> {
    if (seamsOverride) {
      return seamsOverride;
    }
    if (!defaultSeamsPromise) {
      defaultSeamsPromise = (async () => {
        const [{ app, shell }, { UpdateCheckService }] = await Promise.all([import("electron"), import("../../services/update-check.service.js")]);
        return {
          getVersion: () => app.getVersion(),
          getName: () => app.getName(),
          getPlatform: () => process.platform,
          runUpdateCheck: UpdateCheckService.run,
          openExternal: (url) => shell.openExternal(url),
        };
      })();
    }
    return defaultSeamsPromise;
  },

  /** @internal Test seam for handler unit tests. */
  __setSeamsForTests(overrides: Partial<AppInfoSeams> | null): void {
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
          // nm-throw: keep — 测试 seam 未配置属编程错误（用例忘了覆盖），必须显式炸掉而不是静默给默认值。
          throw new Error("runUpdateCheck not configured for tests");
        }),
      openExternal:
        overrides.openExternal ??
        (async () => {
          // nm-throw: keep — 测试 seam 未配置属编程错误（用例忘了覆盖），必须显式炸掉而不是静默给默认值。
          throw new Error("openExternal not configured for tests");
        }),
    };
  },

  async getInfo(): Promise<AppGetInfoResponse> {
    try {
      const seams = await AppInfo.getSeams();
      return {
        ok: true,
        data: {
          version: seams.getVersion(),
          platform: seams.getPlatform(),
          name: seams.getName(),
        },
      };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  },

  async checkForUpdates(): Promise<AppCheckForUpdatesResponse> {
    try {
      const seams = await AppInfo.getSeams();
      // 已知失败（版本比较非法）沿 Result 收口成 IPC 错误 payload；
      // 网络等未知异常仍走 catch（错误通道迁移六期）。
      const checked = await seams.runUpdateCheck();
      if (!checked.ok) return { ok: false, error: FormatIpcError.format(checked.error) };
      return { ok: true, data: checked.value };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  },

  async openExternal(req: AppOpenExternalRequest): Promise<IpcResult<void>> {
    try {
      const url = req.url?.trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        return { ok: false, error: { code: "IPC_INVALID_URL", message: "无效的链接" } };
      }
      const seams = await AppInfo.getSeams();
      await seams.openExternal(url);
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  },
} as const;
