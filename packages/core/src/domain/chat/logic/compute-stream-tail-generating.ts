/**
 * 根据 uiRunning 与距上次 text/thinking delta 的间隔，判定是否显示 stream tail「生成中」。
 *
 * @module domain/chat/logic/compute-stream-tail-generating
 */

/** 默认 idle 阈值（毫秒）；与双端 `useStreamTailGenerating` 一致。 */
export const DEFAULT_STREAM_TAIL_IDLE_MS = 300;

export function computeStreamTailGenerating(input: {
  readonly uiRunning: boolean;
  readonly msSinceLastStreamDelta: number;
  readonly idleThresholdMs?: number;
}): boolean {
  if (!input.uiRunning) {
    return false;
  }
  return (
    input.msSinceLastStreamDelta >=
    (input.idleThresholdMs ?? DEFAULT_STREAM_TAIL_IDLE_MS)
  );
}
