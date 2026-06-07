const FIELD_LABELS: Record<string, string> = {
  endDepth: "结束深度",
  startDepth: "起始深度",
  pattern: "正则表达式",
  name: "名称",
  flags: "标志",
  groupId: "组 ID",
  ruleId: "规则 ID",
};

type ZodIssueLike = {
  path?: unknown[];
  message?: string;
};

function formatZodIssue(issue: ZodIssueLike): string {
  const pathKey = issue.path?.map(String).join(".") ?? "";
  const label = FIELD_LABELS[pathKey] ?? pathKey;
  const msg = issue.message ?? "无效输入";
  if (msg.includes("expected number") && msg.includes("null")) {
    return label ? `${label}须为非负整数或留空` : "须为非负整数或留空";
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
