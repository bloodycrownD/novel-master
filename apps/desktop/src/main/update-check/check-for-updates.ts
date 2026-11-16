/**
 * Orchestrates local vs remote version comparison for desktop update checks.
 */

import {
  compareAppVersions,
  excerptReleaseNotes,
} from "@novel-master/core/common";
import { type AppError, Result } from "@novel-master/core/errors";
import { resolveLatestRelease, type FetchFn } from "./resolve-latest-release.js";
import type { UpdateCheckData } from "./types.js";

export async function checkForUpdates(localVersion: string, fetchFn?: FetchFn): Promise<Result<UpdateCheckData, AppError>> {
  // e2e 专用 hook（与 NOVEL_MASTER_DB 同类先例）：桌面端 e2e 环境置此 env 让更新检查
  // 立即失败——砍掉每次启动 10s 的 GitHub fetch 超时等待与升级弹窗判定窗口。
  // 仅在编排入口短路，不改 UI 错误呈现路径：renderer 收到错误照常处理（s3-update
  // 的「检查更新」用例验证的就是错误态呈现）。
  if (process.env.NOVEL_MASTER_DISABLE_UPDATE_CHECK === "1") {
    // nm-throw: keep — e2e 专用短路钩子，刻意走 reject 模拟「更新检查失败」错误态；update-check 属 infra 适配层。
    throw new Error("更新检查已禁用（测试环境）");
  }
  const release = await resolveLatestRelease(fetchFn);
  const cmp = compareAppVersions(localVersion, release.version);
  // 已知失败（版本号非法）沿 Result.err 上行，IPC 边界经 formatIpcError
  // 收口（错误通道迁移六期）；网络等未知异常仍走 reject。
  if (!cmp.ok) return Result.err(cmp.error);
  const status = cmp.value < 0 ? "update-available" : "up-to-date";
  return Result.ok({
    localVersion,
    remoteVersion: release.version,
    tagName: release.tagName,
    releaseUrl: release.htmlUrl,
    releaseNotesExcerpt: excerptReleaseNotes(release.body, "desktop"),
    status,
  });
}
