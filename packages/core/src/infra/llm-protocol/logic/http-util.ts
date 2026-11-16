/**
 * Shared HTTP helpers for LLM adapters.
 *
 * @module infra/llm-protocol/logic/http-util
 */

import { truncateText } from "@/common/text.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { FetchFn } from "../ports/adapter.port.js";

/** Trims trailing slashes from base URL. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Joins base URL and path with a single slash. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/** 非 2xx 响应返回 `PROVIDER_HTTP_ERROR`（失败走返回值通道；名字保留自 throw 时代）。 */
export async function assertOk(response: Response, providerId?: string): Promise<Result<void, AppError>> {
  if (response.ok) {
    return Result.ok(undefined);
  }
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }
  const snippet = truncateText(body, 500);
  return Result.err(new AppError("PROVIDER_HTTP_ERROR", { detail: `HTTP ${response.status}: ${snippet}`, providerId }));
}

/** JSON fetch with error handling. */
export async function fetchJson(fetchFn: FetchFn, url: string, init: RequestInit, providerId?: string): Promise<Result<unknown, AppError>> {
  const response = await fetchFn(url, init);
  const checked = await assertOk(response, providerId);
  if (!checked.ok) return checked;
  return Result.ok((await response.json()) as unknown);
}
