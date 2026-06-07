/** Shared IPC error formatting for handlers. */
import { ZodError } from "zod";

const FIELD_LABELS: Record<string, string> = {
  endDepth: "结束深度",
  startDepth: "起始深度",
  pattern: "正则表达式",
  name: "名称",
};

function formatZodIssues(err: ZodError): string {
  const parts = err.issues.map((issue) => {
    const pathKey = issue.path.map(String).join(".");
    const label = FIELD_LABELS[pathKey] ?? pathKey;
    const msg = issue.message;
    if (msg.includes("expected number") && msg.includes("null")) {
      return label ? `${label}须为非负整数或留空` : "须为非负整数或留空";
    }
    return label ? `${label}：${msg}` : msg;
  });
  return parts.filter(Boolean).join("；") || err.message;
}

export function formatIpcError(err: unknown): { code: string; message: string } {
  if (err instanceof ZodError) {
    return { code: "VALIDATION", message: formatZodIssues(err) };
  }
  if (err instanceof Error) {
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}
