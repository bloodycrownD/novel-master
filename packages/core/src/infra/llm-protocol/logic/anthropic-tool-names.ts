/**
 * Tool name wire encoding for Anthropic-compatible gateways.
 *
 * DeepSeek and some proxies reject tool names outside `^[a-zA-Z0-9_-]+$`
 * while custom tools may still use dotted names.
 *
 * @module infra/llm-protocol/logic/anthropic-tool-names
 */

/** Pattern accepted by strict Anthropic-compatible gateways. */
export const ANTHROPIC_WIRE_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface AnthropicToolNameWire {
  readonly toWire: (canonical: string) => string;
  readonly fromWire: (wire: string) => string;
}

/** Maps canonical registry names to wire-safe names (`.` → `_`). */
export function toAnthropicWireToolName(canonical: string): string {
  if (ANTHROPIC_WIRE_TOOL_NAME_PATTERN.test(canonical)) {
    return canonical;
  }
  return canonical.replace(/\./g, "_");
}

/** Builds bidirectional mapping for a request's declared/historical tools. */
export function createAnthropicToolNameWire(
  canonicalNames: readonly string[],
): AnthropicToolNameWire {
  const wireToCanonical = new Map<string, string>();
  for (const canonical of canonicalNames) {
    wireToCanonical.set(toAnthropicWireToolName(canonical), canonical);
  }
  return {
    toWire: toAnthropicWireToolName,
    fromWire: (wire) => wireToCanonical.get(wire) ?? wire,
  };
}

/** True when any tool name would be rejected by strict wire validators. */
export function anthropicToolsNeedWireEncoding(
  canonicalNames: readonly string[],
): boolean {
  return canonicalNames.some(
    (name) => !ANTHROPIC_WIRE_TOOL_NAME_PATTERN.test(name),
  );
}
