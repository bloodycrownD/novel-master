/**
 * Orchestrates local vs remote version comparison for mobile update checks.
 */

import {APP_VERSION} from './app-meta';
import {compareAppVersions} from './compare-app-versions';
import {excerptReleaseNotes} from './excerpt-release-notes';
import {resolveLatestRelease, type FetchFn} from './resolve-latest-release';
import type {UpdateCheckData} from './types';

export async function checkForUpdates(
  localVersion: string = APP_VERSION,
  fetchFn?: FetchFn,
): Promise<UpdateCheckData> {
  const release = await resolveLatestRelease(fetchFn);
  const cmp = compareAppVersions(localVersion, release.version);
  const status = cmp < 0 ? 'update-available' : 'up-to-date';
  return {
    localVersion,
    remoteVersion: release.version,
    tagName: release.tagName,
    releaseUrl: release.htmlUrl,
    releaseNotesExcerpt: excerptReleaseNotes(release.body, 'mobile'),
    status,
  };
}
