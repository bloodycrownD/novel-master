/**
 * Stream tail「生成中」：与 uiRunning 同生命周期。
 */
export type StreamTailGenerating = {
  readonly streamTailGenerating: boolean;
};

export function useStreamTailGenerating(uiRunning: boolean): StreamTailGenerating {
  return { streamTailGenerating: uiRunning };
}
