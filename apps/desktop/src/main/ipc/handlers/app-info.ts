/**
 * IPC handlers for app metadata and GitHub release update checks (main-process fetch).
 */

import { AppError, Result } from "@novel-master/core/errors";
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

/** app-info seam 装配槽（模块内 holder，对象管理）：测试覆盖位与默认实现懒初始化。 */
const seamsState = {
    /** 测试 seam 覆盖位（null = 未覆盖，走默认实现）。 */
    override: null as AppInfoSeams | null,
    /** 默认 seam 的懒初始化 Promise（双检：并发 getSeams 只建一次）。 */
    defaultPromise: null as Promise<AppInfoSeams> | null,
};

export const AppInfo = {
    async getSeams(): Promise<AppInfoSeams> {
        if (seamsState.override) {
            return seamsState.override;
        }
        if (!seamsState.defaultPromise) {
            seamsState.defaultPromise = (async () => {
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
        return seamsState.defaultPromise;
    },

    /** @internal Test seam for handler unit tests. */
    __setSeamsForTests(overrides: Partial<AppInfoSeams> | null): void {
        if (overrides === null) {
            seamsState.override = null;
            seamsState.defaultPromise = null;
            return;
        }
        seamsState.override = {
            getVersion: overrides.getVersion ?? (() => "0.0.0"),
            getName: overrides.getName ?? (() => "Novel Master"),
            getPlatform: overrides.getPlatform ?? (() => process.platform),
            runUpdateCheck:
                overrides.runUpdateCheck ??
                // 测试 seam 未配置属编程错误；契约是 Promise<Result>，已知失败沿 Result 上行（判据 1），
                // 由 checkForUpdates 收口成 IPC 错误 payload。
                (async () => Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: "runUpdateCheck not configured for tests" }))),
            openExternal:
                overrides.openExternal ??
                (async () => {
                    // nm-throw: keep — 测试 seam 未配置属编程错误（用例忘了覆盖），必须显式炸掉而不是静默给默认值；
                    // openExternal 契约是 Promise<void>，失败只有 reject 通道（平台强制 P3 家族）。
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
