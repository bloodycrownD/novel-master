/**
 * 根据 uiRunning 判定是否显示 stream tail「生成中」。
 *
 * @module domain/chat/logic/compute-stream-tail-generating
 */

/** @deprecated 保留导出以兼容旧调用方；实现已忽略 idle 阈值。 */
export const DEFAULT_STREAM_TAIL_IDLE_MS = 300;

export function computeStreamTailGenerating(input: {
  readonly uiRunning: boolean;
  /** @deprecated 实现中忽略，保留签名以兼容旧调用方。 */
  readonly msSinceLastStreamDelta: number;
  /** @deprecated 实现中忽略，保留签名以兼容旧调用方。 */
  readonly idleThresholdMs?: number;
}): boolean {
  return input.uiRunning;
}
