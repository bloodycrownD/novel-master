/**
 * Orchestrates local vs remote version comparison for desktop update checks.
 */

import {
  compareAppVersions,
  excerptReleaseNotes,
} from "@novel-master/core/common";
import { resolveLatestRelease, type FetchFn } from "./resolve-latest-release.js";
import type { UpdateCheckData } from "./types.js";

export async function checkForUpdates(
  localVersion: string,
  fetchFn?: FetchFn,
): Promise<UpdateCheckData> {
  // e2e 专用 hook（与 NOVEL_MASTER_DB 同类先例）：桌面端 e2e 环境置此 env 让更新检查
  // 立即失败——砍掉每次启动 10s 的 GitHub fetch 超时等待与升级弹窗判定窗口。
  // 仅在编排入口短路，不改 UI 错误呈现路径：renderer 收到错误照常处理（s3-update
  // 的「检查更新」用例验证的就是错误态呈现）。
  if (process.env.NOVEL_MASTER_DISABLE_UPDATE_CHECK === "1") {
    throw new Error("更新检查已禁用（测试环境）");
  }
  const release = await resolveLatestRelease(fetchFn);
  const cmp = compareAppVersions(localVersion, release.version);
  const status = cmp < 0 ? "update-available" : "up-to-date";
  return {
    localVersion,
    remoteVersion: release.version,
    tagName: release.tagName,
    releaseUrl: release.htmlUrl,
    releaseNotesExcerpt: excerptReleaseNotes(release.body, "desktop"),
    status,
  };
}
