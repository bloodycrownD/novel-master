/**
 * Fetches the latest GitHub release. Future: swap to list + APK asset filter.
 */

import {githubLatestReleaseApiUrl, GITHUB_REPO} from './app-meta';
import {parseReleaseTag} from './parse-release-tag';
import type {LatestRelease} from './types';

const FETCH_TIMEOUT_MS = 10_000;

type GitHubLatestReleaseJson = {
  tag_name?: string;
  html_url?: string;
  body?: string | null;
};

export type FetchFn = typeof fetch;

function mapReleaseJson(json: GitHubLatestReleaseJson): LatestRelease {
  const tagName = json.tag_name;
  if (!tagName || typeof tagName !== 'string') {
    throw new Error('GitHub API 响应缺少 tag_name');
  }
  const htmlUrl = json.html_url;
  if (!htmlUrl || typeof htmlUrl !== 'string') {
    throw new Error('GitHub API 响应缺少 html_url');
  }
  const expectedPrefix = `https://github.com/${GITHUB_REPO.owner}/${GITHUB_REPO.name}/`;
  if (!htmlUrl.startsWith(expectedPrefix)) {
    throw new Error(
      `发行版链接域名校验失败（预期 ${expectedPrefix}，实际 ${htmlUrl}）`,
    );
  }
  const version = parseReleaseTag(tagName);
  return {
    tagName,
    version,
    htmlUrl,
    body: typeof json.body === 'string' ? json.body : '',
  };
}

export async function resolveLatestRelease(
  fetchFn: FetchFn = fetch,
): Promise<LatestRelease> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchFn(githubLatestReleaseApiUrl(), {
      signal: controller.signal,
      headers: {Accept: 'application/vnd.github+json'},
    });
    if (response.status === 404) {
      throw new Error('未找到任何发行版');
    }
    if (!response.ok) {
      throw new Error(`GitHub API 错误 (${response.status})`);
    }
    const json = (await response.json()) as GitHubLatestReleaseJson;
    return mapReleaseJson(json);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('检查更新超时，请稍后重试');
    }
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('网络不可用，无法检查更新');
  } finally {
    clearTimeout(timer);
  }
}
