/**
 * Format-agnostic compaction policy parsing (JSON object truth source).
 *
 * @module domain/compaction/compaction-policy-from-json
 */

import { CompactionPolicyError } from "@/errors/compaction-policy-errors.js";
import type { CompactionPolicy } from "./compaction-policy.js";
import {
  compactionPolicyDocumentSchema,
  type CompactionPolicyDocument,
} from "./compaction-policy.schema.js";

function zodMessage(error: { message: string }): string {
  return error.message;
}

/**
 * Parses and validates a plain JSON object into {@link CompactionPolicy}.
 */
export function compactionPolicyFromJson(raw: unknown): CompactionPolicy {
  const parsed = compactionPolicyDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CompactionPolicyError("INVALID_SCHEMA", zodMessage(parsed.error));
  }
  return documentToPolicy(parsed.data);
}

/**
 * Serializes {@link CompactionPolicy} to a JSON-serializable document object.
 */
export function compactionPolicyToJson(
  policy: CompactionPolicy,
): CompactionPolicyDocument {
  return {
    schemaVersion: 1,
    enabled: policy.enabled,
    trigger: policy.trigger,
    action: policy.action,
  };
}

function documentToPolicy(doc: CompactionPolicyDocument): CompactionPolicy {
  return {
    schemaVersion: 1,
    enabled: doc.enabled,
    trigger: doc.trigger,
    action: doc.action,
  };
}
