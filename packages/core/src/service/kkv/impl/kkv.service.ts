/**
 * Default KKV service implementation.
 *
 * @module service/kkv/impl/kkv.service
 */

import type { KkvRepository } from "@/domain/kkv/repositories/kkv.port.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { KkvService } from "../kkv.port.js";

/**
 * KKV service delegating to {@link KkvRepository}.
 */
export class DefaultKkvService implements KkvService {
    constructor(private readonly repo: KkvRepository) {}

    listKeys(module: string): Promise<string[]> {
        return this.repo.listKeys(module);
    }

    async get(module: string, key: string): Promise<Result<string, AppError>> {
        const entry = await this.repo.get(module, key);
        if (entry == null) {
            return Result.err(new AppError("KKV_NOT_FOUND", { detail: `KKV key not found: ${module}/${key}`, module, key }));
        }
        return Result.ok(entry.value);
    }

    set(module: string, key: string, value: string): Promise<void> {
        return this.repo.set(module, key, value);
    }

    async delete(module: string, key: string): Promise<Result<void, AppError>> {
        const deleted = await this.repo.delete(module, key);
        if (!deleted) {
            return Result.err(new AppError("KKV_NOT_FOUND", { detail: `KKV key not found: ${module}/${key}`, module, key }));
        }
        return Result.ok(undefined);
    }
}
