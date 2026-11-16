/**
 * GitHub repo constants and URL builders for desktop update checks.
 * Kept in main process — renderer must not fetch releases directly (CORS).
 */

export const GITHUB_REPO = {
  owner: "bloodycrownD",
  name: "novel-master",
} as const;

const { owner, name } = GITHUB_REPO;

export function githubLatestReleaseApiUrl(): string {
  return `https://api.github.com/repos/${owner}/${name}/releases/latest`;
}
