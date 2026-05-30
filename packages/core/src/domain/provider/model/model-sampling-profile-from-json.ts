/**
 * Format-agnostic model sampling profile parsing.
 *
 * @module domain/provider/model/model-sampling-profile-from-json
 */

import { ProviderError } from "@/errors/provider-errors.js";
import type { ModelSamplingProfile } from "./model-sampling-profile.js";
import {
  modelSamplingProfileDocumentSchema,
  type ModelSamplingProfileDocument,
} from "./model-sampling-profile.schema.js";

function zodMessage(error: { message: string }): string {
  return error.message;
}

/**
 * Parses and validates a plain JSON object into {@link ModelSamplingProfile}.
 */
export function modelSamplingProfileFromJson(raw: unknown): ModelSamplingProfile {
  const parsed = modelSamplingProfileDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProviderError("INVALID_ARGUMENT", zodMessage(parsed.error));
  }
  return documentToProfile(parsed.data);
}

/**
 * Serializes {@link ModelSamplingProfile} to a JSON-serializable document.
 */
export function modelSamplingProfileToJson(
  profile: ModelSamplingProfile,
): ModelSamplingProfileDocument {
  return {
    schemaVersion: 1,
    enabled: profile.enabled,
    ...(profile.params != null ? { params: profile.params } : {}),
  };
}

function documentToProfile(doc: ModelSamplingProfileDocument): ModelSamplingProfile {
  return {
    schemaVersion: 1,
    enabled: doc.enabled,
    params: doc.params,
  };
}
