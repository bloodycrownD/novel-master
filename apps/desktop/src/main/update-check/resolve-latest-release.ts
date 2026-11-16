/**
 * Fetches the latest GitHub release. Future: swap to list + asset filter per platform.
 */

import { githubLatestReleaseApiUrl } from "./app-meta.js";
import { parseReleaseTag } from "./parse-release-tag.js";
import type { LatestRelease } from "./types.js";

const FETCH_TIMEOUT_MS = 10_000;

type GitHubLatestReleaseJson = {
  tag_name?: string;
  html_url?: string;
  body?: string | null;
};

export type FetchFn = typeof fetch;

export async function resolveLatestRelease(fetchFn: FetchFn = fetch): Promise<LatestRelease> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchFn(githubLatestReleaseApiUrl(), { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } });
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
    return {
      tagName,
      version: parseReleaseTag(tagName),
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
