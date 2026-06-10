/** Shared update-check DTOs for main process orchestration and IPC. */

export type LatestRelease = {
  readonly tagName: string;
  readonly version: string;
  readonly htmlUrl: string;
  readonly body: string;
};

export type UpdateCheckStatus = "up-to-date" | "update-available";

export type UpdateCheckData = {
  readonly localVersion: string;
  readonly remoteVersion: string;
  readonly tagName: string;
  readonly releaseUrl: string;
  readonly releaseNotesExcerpt: string;
  readonly status: UpdateCheckStatus;
};
