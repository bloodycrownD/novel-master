import { coreT } from "@shared/logic/core-i18n";

const FIELD_LABELS: Record<string, string> = {
  endDepth: coreT({key: "ui.smart_sort.zod_end_depth"}),
  startDepth: coreT({key: "ui.smart_sort.zod_start_depth"}),
  pattern: coreT({key: "ui.smart_sort.regex_label"}),
  name: coreT({key: "ui.common.name"}),
  flags: coreT({key: "ui.smart_sort.zod_flags"}),
  groupId: coreT({key: "ui.smart_sort.zod_group_id"}),
  ruleId: coreT({key: "ui.smart_sort.zod_rule_id"}),
};

type ZodIssueLike = {
  path?: unknown[];
  message?: string;
};

function formatZodIssue(issue: ZodIssueLike): string {
  const pathKey = issue.path?.map(String).join(".") ?? "";
  const label = FIELD_LABELS[pathKey] ?? pathKey;
  const msg = issue.message ?? coreT({key: "ui.smart_sort.zod_invalid_input"});
  if (msg.includes("expected number") && msg.includes("null")) {
    return coreT({key: "ui.smart_sort.zod_nonneg_or_empty", params: {field: label}});
  }
  return label ? `${label}：${msg}` : msg;
}

/** Turns Zod JSON issue arrays and other raw errors into readable text. */
export function formatUserError(message: string): string {
  const trimmed = message.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .map((issue) => formatZodIssue(issue as ZodIssueLike))
          .filter(Boolean)
          .join("；");
      }
    } catch {
      // fall through
    }
  }
  return message;
}
