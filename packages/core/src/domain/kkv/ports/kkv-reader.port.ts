/**
 * Minimal KKV read/write port for domain repositories.
 *
 * @module domain/kkv/ports/kkv-reader.port
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

/** Subset of application KKV service for domain persistence adapters. */
export interface KkvReaderPort {
    get(module: string, key: string): Promise<Result<string, AppError>>;
    set(module: string, key: string, value: string): Promise<void>;
    delete(module: string, key: string): Promise<Result<void, AppError>>;
}
