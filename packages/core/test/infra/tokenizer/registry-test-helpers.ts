/**
 * Test helpers for token counter registry (mock repositories).
 *
 * @module test/infra/tokenizer/registry-test-helpers
 */

import type { LlmProvider } from "../../../src/domain/provider/model/provider.js";
import type { SavedModel } from "../../../src/domain/provider/model/saved-model.js";
import type { ProviderRepository } from "../../../src/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "../../../src/domain/provider/repositories/saved-model.port.js";
import type { LlmProtocolKind } from "../../../src/infra/llm-protocol/ports/adapter.port.js";

function stubProvider(
  id: string,
  protocol: LlmProtocolKind,
): LlmProvider {
  return {
    id,
    protocol,
    baseUrl: "https://example.com/v1",
    displayName: id,
    secretRef: null,
    headers: {},
    isBuiltin: true,
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}

const noopProviderRepo: ProviderRepository = {
  list: async () => [],
  findById: async () => null,
  insert: async () => {},
  update: async () => {},
  delete: async () => false,
};

const noopSavedModelRepo: SavedModelRepository = {
  listByProvider: async () => [],
  find: async () => null,
  insert: async () => {},
  update: async () => {},
  delete: async () => false,
  deleteByProvider: async () => {},
};

/** Provider repo that returns a fixed protocol per id (unknown id → null). */
export function mockProviderRepository(
  protocolById: Readonly<Record<string, LlmProtocolKind>>,
): ProviderRepository {
  return {
    ...noopProviderRepo,
    findById: async (id) =>
      protocolById[id] != null ? stubProvider(id, protocolById[id]!) : null,
  };
}

/** Mutable provider protocol for a single id (simulates provider edit without restart). */
export function mutableProviderRepository(
  providerId: string,
  initialProtocol: LlmProtocolKind,
): { repo: ProviderRepository; setProtocol: (p: LlmProtocolKind) => void } {
  let protocol = initialProtocol;
  return {
    setProtocol: (p) => {
      protocol = p;
    },
    repo: {
      ...noopProviderRepo,
      findById: async (id) =>
        id === providerId ? stubProvider(id, protocol) : null,
    },
  };
}

/** Saved-model repo: only keys in the set are considered saved. */
export function mockSavedModelRepository(
  savedKeys: ReadonlySet<string>,
): SavedModelRepository {
  return {
    ...noopSavedModelRepo,
    find: async (providerId, vendorModelId) => {
      const key = `${providerId}/${vendorModelId}`;
      if (!savedKeys.has(key)) {
        return null;
      }
      return {
        providerId,
        vendorModelId,
        displayName: null,
        createdAtMs: 0,
        updatedAtMs: 0,
      } satisfies SavedModel;
    },
  };
}

/** Empty registry deps (model-name routing needs no DB). */
export function emptyRegistryDeps(): Record<string, never> {
  return {};
}
