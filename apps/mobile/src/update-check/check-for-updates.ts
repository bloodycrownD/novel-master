/**
 * Orchestrates local vs remote version comparison for mobile update checks.
 */

import {APP_VERSION} from './app-meta';
import {compareAppVersions, excerptReleaseNotes} from '@novel-master/core/common';
import {type AppError, Result} from '@novel-master/core/errors';
import {resolveLatestRelease, type FetchFn} from './resolve-latest-release';
import type {UpdateCheckData} from './types';

export async function checkForUpdates(localVersion: string = APP_VERSION, fetchFn?: FetchFn): Promise<Result<UpdateCheckData, AppError>> {
  const release = await resolveLatestRelease(fetchFn);
  const cmp = compareAppVersions(localVersion, release.version);
  // 已知失败（版本号非法）沿 Result.err 上行（错误通道迁移六期）；
  // 网络等未知异常仍走 reject，由调用方 catch 收口。
  if (!cmp.ok) return Result.err(cmp.error);
  const status = cmp.value < 0 ? 'update-available' : 'up-to-date';
  return Result.ok({
    localVersion,
    remoteVersion: release.version,
    tagName: release.tagName,
    releaseUrl: release.htmlUrl,
    releaseNotesExcerpt: excerptReleaseNotes(release.body, 'mobile'),
    status,
  });
}
