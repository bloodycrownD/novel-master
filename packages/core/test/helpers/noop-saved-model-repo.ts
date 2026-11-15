import { Result } from "../../src/errors/either.js";
import type { SavedModelRepository } from "../../src/domain/provider/repositories/saved-model.port.js";

/** Minimal stub for agent-runner tests (infer falls back when findById resolves null). */
export function noopSavedModelRepository(): SavedModelRepository {
  return {
    listByProvider: async () => Result.ok([]),
    findById: async () => Result.ok(null),
    insert: async () => undefined,
    updateById: async () => undefined,
    deleteById: async () => false,
    deleteByProvider: async () => undefined,
  };
}
