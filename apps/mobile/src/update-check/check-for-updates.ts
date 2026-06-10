/**
 * Orchestrates local vs remote version comparison for mobile update checks.
 */

import {APP_VERSION} from './app-meta';
import {compareAppVersions} from './compare-app-versions';
import {resolveLatestRelease, type FetchFn} from './resolve-latest-release';
import type {UpdateCheckData} from './types';

const NOTES_EXCERPT_MAX = 300;

function excerptReleaseNotes(body: string): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_>`~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= NOTES_EXCERPT_MAX) {
    return plain;
  }
  return `${plain.slice(0, NOTES_EXCERPT_MAX)}…`;
}

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
    releaseNotesExcerpt: excerptReleaseNotes(release.body),
    status,
  };
}
