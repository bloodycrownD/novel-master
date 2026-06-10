/**
 * Orchestrates local vs remote version comparison for desktop update checks.
 */

import { compareAppVersions } from "./compare-app-versions.js";
import { excerptReleaseNotes } from "./excerpt-release-notes.js";
import { resolveLatestRelease, type FetchFn } from "./resolve-latest-release.js";
import type { UpdateCheckData } from "./types.js";

export async function checkForUpdates(
  localVersion: string,
  fetchFn?: FetchFn,
): Promise<UpdateCheckData> {
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
