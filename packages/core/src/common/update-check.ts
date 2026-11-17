/**
 * 更新检查：GitHub latest release 拉取、tag 解析、本地/远端版本比较与 DTO 组装。
 *
 * 本文件是 desktop / mobile 两端 update-check 链路的共享逻辑核：平台壳只负责
 * 取本地版本号（desktop `app.getVersion()`、mobile `APP_VERSION`）与错误呈现，
 * 网络与解析逻辑不再各端各抄一份。
 *
 * @module common/update-check
 */

import {AppError} from "@/errors/app-error.js";
import {Result} from "@/errors/either.js";
import {Release} from "./release.js";

/** 可注入的 fetch（测试与宿主可替换；缺省用全局 fetch）。 */
export type FetchFn = typeof fetch;

/** GitHub latest release 的归一形态。 */
export type LatestRelease = {
    readonly tagName: string;
    readonly version: string;
    readonly htmlUrl: string;
    readonly body: string;
};

export type UpdateCheckStatus = "up-to-date" | "update-available";

/** 更新检查结果 DTO（IPC / UI 共用）。 */
export type UpdateCheckData = {
    readonly localVersion: string;
    readonly remoteVersion: string;
    readonly tagName: string;
    readonly releaseUrl: string;
    readonly releaseNotesExcerpt: string;
    readonly status: UpdateCheckStatus;
};

const GITHUB_REPO = {
    owner: "bloodycrownD",
    name: "novel-master",
} as const;

const TAG_PATTERN = /^v?(\d+\.\d+\.\d+)(?:[-+].*)?$/;

const FETCH_TIMEOUT_MS = 10_000;

type GitHubLatestReleaseJson = {
    tag_name?: string;
    html_url?: string;
    body?: string | null;
};

function latestReleaseApiUrl(): string {
    return `https://api.github.com/repos/${GITHUB_REPO.owner}/${GITHUB_REPO.name}/releases/latest`;
}

/** GitHub release tag_name → semver（剥前导 `v`）；非法 tag 抛错。 */
function parseTag(tagName: string): string {
    const trimmed = tagName.trim();
    const match = TAG_PATTERN.exec(trimmed);
    if (!match) {
        // nm-throw: keep — 远端 tag 解析属版本号解析 infra 适配层（update-check 链路），不是本地参数校验。
        throw new Error(`无法解析版本标签: ${tagName}`);
    }
    return match[1]!;
}

/** 拉取 GitHub latest release；404 / 非 2xx / 字段缺失 / 超时均抛用户可读文案。 */
async function resolveLatest(fetchFn: FetchFn = fetch): Promise<LatestRelease> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetchFn(latestReleaseApiUrl(), {signal: controller.signal, headers: {Accept: "application/vnd.github+json"}});
        if (response.status === 404) {
            // nm-throw: keep — GitHub API 远端边界（infra 适配层）：404 是第三方服务状态，update-check 链路按未知异常上行。
            throw new Error("未找到任何发行版");
        }
        if (!response.ok) {
            // nm-throw: keep — HTTP 非 2xx 属 GitHub API 边界故障（infra 适配层），调用方无参数可纠正。
            throw new Error(`GitHub API 错误 (${response.status})`);
        }
        const json = (await response.json()) as GitHubLatestReleaseJson;
        const tagName = json.tag_name;
        if (!tagName || typeof tagName !== "string") {
            // nm-throw: keep — 第三方响应字段缺失属 API 契约破缺（infra 适配层），不是本地参数校验。
            throw new Error("GitHub API 响应缺少 tag_name");
        }
        const htmlUrl = json.html_url;
        if (!htmlUrl || typeof htmlUrl !== "string") {
            // nm-throw: keep — 第三方响应字段缺失属 API 契约破缺（infra 适配层），不是本地参数校验。
            throw new Error("GitHub API 响应缺少 html_url");
        }
        // 发行版链接域名白名单（mobile 侧安全小项 f2f15d0f5 的防线，并入共享实现后对
        // desktop 也是加固）：release 页必须落在本仓 GitHub 路径下，防止恶意/被篡改的
        // 响应把用户引到第三方域名。
        const expectedPrefix = `https://github.com/${GITHUB_REPO.owner}/${GITHUB_REPO.name}/`;
        if (!htmlUrl.startsWith(expectedPrefix)) {
            // nm-throw: keep — 发行版链接域名校验属 GitHub API 边界（infra 适配层），调用方无参数可纠正。
            throw new Error(`发行版链接域名校验失败（预期 ${expectedPrefix}，实际 ${htmlUrl}）`);
        }
        return {
            tagName,
            version: parseTag(tagName),
            htmlUrl,
            body: typeof json.body === "string" ? json.body : "",
        };
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            // nm-throw: keep — AbortController 超时是 fetch 平台边界（策略 §2 硬例外），在适配层转成用户文案。
            throw new Error("检查更新超时，请稍后重试");
        }
        if (err instanceof Error) {
            throw err;
        }
        // nm-throw: keep — 非 Error 抛出值来自注入的 fetchFn（网络边界），update-check 属 infra 适配层。
        throw new Error("网络不可用，无法检查更新");
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 本地 vs 远端版本比较，产出更新检查 DTO。
 *
 * 失败通道：版本号非法沿 `Result.err` 上行（IPC 边界经 formatIpcError 收口）；
 * 网络等未知异常仍走 reject。`releaseNotesFocus` 决定 release notes 摘要的
 * 回落平台文案（desktop / mobile）。
 */
async function checkForUpdates(localVersion: string, fetchFn?: FetchFn, releaseNotesFocus: "desktop" | "mobile" = "desktop"): Promise<Result<UpdateCheckData, AppError>> {
    // e2e 专用 hook（与 NOVEL_MASTER_DB 同类先例）：桌面端 e2e 环境置此 env 让更新检查
    // 立即失败——砍掉每次启动 10s 的 GitHub fetch 超时等待与升级弹窗判定窗口。
    // 仅在编排入口短路，不改 UI 错误呈现路径：renderer 收到错误照常处理（s3-update
    // 的「检查更新」用例验证的就是错误态呈现）。
    if (process.env.NOVEL_MASTER_DISABLE_UPDATE_CHECK === "1") {
        // nm-throw: keep — e2e 专用短路钩子，刻意走 reject 模拟「更新检查失败」错误态；update-check 属 infra 适配层。
        throw new Error("更新检查已禁用（测试环境）");
    }
    const release = await resolveLatest(fetchFn);
    const cmp = Release.compareVersions(localVersion, release.version);
    // 已知失败（版本号非法）沿 Result.err 上行，IPC 边界经 formatIpcError
    // 收口（错误通道迁移六期）；网络等未知异常仍走 reject。
    if (!cmp.ok) return Result.err(cmp.error);
    const status = cmp.value < 0 ? "update-available" : "up-to-date";
    return Result.ok({
        localVersion,
        remoteVersion: release.version,
        tagName: release.tagName,
        releaseUrl: release.htmlUrl,
        releaseNotesExcerpt: Release.excerptNotes(release.body, releaseNotesFocus),
        status,
    });
}

/** 更新检查的 object namespace（成员名去掉 `update-check` 冗余前缀）。 */
export const UpdateCheck = {
    latestReleaseApiUrl,
    parseTag,
    resolveLatest,
    check: checkForUpdates,
} as const;
