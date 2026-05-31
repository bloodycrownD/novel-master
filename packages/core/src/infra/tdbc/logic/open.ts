/**
 * URL parsing and connection factory for TDBC.
 *
 * @module infra/tdbc/logic/open
 * @invariant Only `tdbc:sqlite:…` URLs are supported in v1.
 */

import type { TdbcConnection } from "../ports/connection.port.js";
import { TdbcError } from "../errors.js";
import { resolveDriver } from "./registry.js";
import type { OpenOptions } from "../types.js";

const TDBC_SCHEME = "tdbc:";

/** Parsed SQLite URL components. */
export interface ParsedTdbcUrl {
  readonly filename: string;
}

/**
 * Parses a TDBC connection URL.
 *
 * Supported forms:
 * - `tdbc:sqlite:./path/to.db`
 * - `tdbc:sqlite:file::memory:`
 *
 * @throws {TdbcError} `INVALID_URL` when the URL is malformed
 */
export function parseUrl(url: string): ParsedTdbcUrl {
  if (!url.startsWith(TDBC_SCHEME)) {
    throw new TdbcError("INVALID_URL", `URL must start with ${TDBC_SCHEME}`);
  }

  const rest = url.slice(TDBC_SCHEME.length);
  const sqliteMatch = /^sqlite:(.+)$/s.exec(rest);
  if (!sqliteMatch) {
    throw new TdbcError("INVALID_URL", "Expected tdbc:sqlite:<path>");
  }

  let filename = sqliteMatch[1]!;
  if (filename.startsWith("file:")) {
    filename = filename.slice("file:".length);
  }

  if (filename.length === 0) {
    throw new TdbcError("INVALID_URL", "Missing database path in URL");
  }

  return { filename };
}

/**
 * Opens a connection using a registered driver.
 *
 * @param url - TDBC URL (e.g. `tdbc:sqlite:file::memory:`)
 * @param options - Optional filename override, read-only flag, explicit driver name
 */
export async function open(
  url: string,
  options?: OpenOptions,
): Promise<TdbcConnection> {
  const parsed = parseUrl(url);
  const driver = resolveDriver(options?.driver);
  return driver.open({
    ...options,
    url,
    filename: options?.filename ?? parsed.filename,
  });
}
