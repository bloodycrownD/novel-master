/**
 * Shared HTTP helpers for LLM adapters.
 *
 * @module infra/llm-protocol/http-util
 */

import { ProviderError } from "@/errors/provider-errors.js";
import type { FetchFn } from "./adapter.port.js";

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

/** Throws ProviderError HTTP_ERROR on non-2xx responses. */
export async function assertOk(
  response: Response,
  providerId?: string,
): Promise<void> {
  if (response.ok) {
    return;
  }
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }
  const snippet = body.length > 500 ? `${body.slice(0, 500)}…` : body;
  throw new ProviderError(
    "HTTP_ERROR",
    `HTTP ${response.status}: ${snippet}`,
    { providerId },
  );
}

/** JSON fetch with error handling. */
export async function fetchJson(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  providerId?: string,
): Promise<unknown> {
  const response = await fetchFn(url, init);
  await assertOk(response, providerId);
  return response.json() as Promise<unknown>;
}
