/**
 * URL parsing and connection factory for TDBC.
 *
 * @module infra/tdbc/logic/open
 * @invariant Only `tdbc:sqlite:…` URLs are supported in v1.
 */

import { Result } from "@/errors/either.js";
import type { TdbcConnection } from "../ports/connection.port.js";
import { TdbcError } from "../errors.js";
import { TdbcRegistry } from "./registry.js";
import type { OpenOptions } from "../types.js";

const TDBC_SCHEME = "tdbc:";

/** Parsed SQLite URL components. */
// nm-style: keep-public — packages/core/src/index.ts 与 @novel-master/core/tdbc 再导出的公共类型契约（无生产直引）
export interface ParsedTdbcUrl {
    readonly filename: string;
}

/**
 * TDBC URL 解析与建连。
 */
export const TdbcOpen = {
    /**
   * Parses a TDBC connection URL.
   *
   * Supported forms:
   * - `tdbc:sqlite:./path/to.db`
   * - `tdbc:sqlite:file::memory:`
   *
   * URL 非法是调用方预期的配置失败，走 `Err`（`INVALID_URL`），本函数不抛；
   * {@link TdbcOpen.open} 作为建连边界把 `Err` 转成 throw。
   */
    parseUrl(url: string): Result<ParsedTdbcUrl, TdbcError> {
        if (!url.startsWith(TDBC_SCHEME)) {
            return Result.err(new TdbcError("INVALID_URL", `URL must start with ${TDBC_SCHEME}`));
        }

        const rest = url.slice(TDBC_SCHEME.length);
        const sqliteMatch = /^sqlite:(.+)$/s.exec(rest);
        if (!sqliteMatch) {
            return Result.err(new TdbcError("INVALID_URL", "Expected tdbc:sqlite:<path>"));
        }

        let filename = sqliteMatch[1]!;
        if (filename.startsWith("file:")) {
            filename = filename.slice("file:".length);
        }

        if (filename.length === 0) {
            return Result.err(new TdbcError("INVALID_URL", "Missing database path in URL"));
        }

        return Result.ok({ filename });
    },

    /**
   * Opens a connection using a registered driver.
   *
   * @param url - TDBC URL (e.g. `tdbc:sqlite:file::memory:`)
   * @param options - Optional filename override, read-only flag, explicit driver name
   */
    async open(url: string, options?: OpenOptions): Promise<TdbcConnection> {
        const parsed = TdbcOpen.parseUrl(url);
        if (!parsed.ok) {
            throw parsed.error;
        }
        const driver = TdbcRegistry.resolve(options?.driver);
        return driver.open({
            ...options,
            url,
            filename: options?.filename ?? parsed.value.filename,
        });
    },
} as const;
