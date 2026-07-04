import type { SavedModelRepository } from "../../src/domain/provider/repositories/saved-model.port.js";

/** Minimal stub for agent-runner tests (infer falls back when findById returns null). */
export function noopSavedModelRepository(): SavedModelRepository {
  return {
    listByProvider: async () => [],
    findById: async () => null,
    insert: async () => undefined,
    updateById: async () => undefined,
    deleteById: async () => false,
    deleteByProvider: async () => undefined,
  };
}
