/**
 * Human-readable tool output for LLM history and prompt preview.
 *
 * @module domain/tool/logic/format-tool-output
 */

/** Compact tool success text for the model (e.g. vfs.write → `ok`). */
export function formatToolOutputForLlm(out: unknown): string {
  if (typeof out === "string") {
    return out;
  }
  if (out != null && typeof out === "object" && !Array.isArray(out)) {
    const rec = out as Record<string, unknown>;
    const keys = Object.keys(rec);
    if (keys.length === 1 && typeof rec.version === "number") {
      return "ok";
    }
    if (
      keys.length === 2 &&
      typeof rec.version === "number" &&
      typeof rec.replacements === "number"
    ) {
      const n = rec.replacements;
      return n === 1 ? "ok" : `ok (${n} replacements)`;
    }
    if (keys.length === 1 && rec.ok === true) {
      return "ok";
    }
  }
  return JSON.stringify(out, null, 2);
}

/** Prettify stored tool_result bodies (legacy rows may still be JSON). */
export function formatToolResultContentForDisplay(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("Error:")) {
    return content;
  }
  try {
    return formatToolOutputForLlm(JSON.parse(trimmed) as unknown);
  } catch {
    return content;
  }
}
