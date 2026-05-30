/**
 * Parses compaction policy template files (no `enabled` field).
 *
 * @module domain/compaction/compaction-policy-template-from-json
 */

import { CompactionPolicyError } from "@/errors/compaction-policy-errors.js";
import type { CompactionPolicy } from "./compaction-policy.js";
import {
  compactionPolicyTemplateDocumentSchema,
  type CompactionPolicyTemplateDocument,
} from "./compaction-policy-template.schema.js";

function zodMessage(error: { message: string }): string {
  return error.message;
}

export type CompactionPolicyTemplate = Omit<CompactionPolicy, "enabled">;

/**
 * Parses a template object; rejects `enabled` (use runtime policy parser for store).
 */
export function compactionPolicyTemplateFromJson(
  raw: unknown,
): CompactionPolicyTemplate {
  const parsed = compactionPolicyTemplateDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CompactionPolicyError("INVALID_SCHEMA", zodMessage(parsed.error));
  }
  return documentToTemplate(parsed.data);
}

function documentToTemplate(
  doc: CompactionPolicyTemplateDocument,
): CompactionPolicyTemplate {
  return {
    schemaVersion: 1,
    trigger: doc.trigger,
    action: doc.action,
  };
}
