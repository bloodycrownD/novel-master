/**
 * Saved model settings wire 预处理：旧 thinking 形态迁移。
 *
 * @module domain/provider/model/saved-model-preprocess
 */

import type { ThinkingLevel } from "./saved-model-settings.js";

/** dev-only：将未发布的 `thinking.enabled` 形态映射为 `thinkingLevel`。 */
export function migrateLegacyThinkingShape(raw: unknown): unknown {
  if (typeof raw !== "object" || raw == null) {
    return raw;
  }
  const generation = raw as Record<string, unknown>;
  if ("thinkingLevel" in generation) {
    return raw;
  }
  const thinking = generation.thinking;
  if (typeof thinking !== "object" || thinking == null || !("enabled" in thinking)) {
    return raw;
  }
  const { thinking: _removed, ...rest } = generation;
  const thinkingLevel: ThinkingLevel = (thinking as { enabled: boolean }).enabled ? "medium" : "off";
  return { ...rest, thinkingLevel };
}
