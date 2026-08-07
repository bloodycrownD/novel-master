/**
 * SSE chunk 共享分发逻辑（A-23）。
 *
 * fetch 与 XHR 两条传输路径都调用本函数：把解码后的文本 chunk 转发给各自的投递
 * sink（fetch 直投 onChunk，XHR 走 SseChunkEmitter 节流），并统一处理「首包日志
 * 只打一次」。pacing 差异由各自传入的 sink 决定，解码与转发语义在两边保持一致，
 * 从而保证下游 *-sse-parser 看到的输入序列一致——真正的 data: / \n\n / event 字段
 * 帧解析由 {@link ./sse-line-buffer.js} 的 feedSseLines 增量处理，本就跨路径一致。
 *
 * 历史上文件头曾明示「fetch 故意不走 SseChunkEmitter」：那是 v1.0.2 时期专给 RN
 * XHR burst 做的 32ms 整流，Desktop/CLI 的 fetch 因为异步 reader.read() 天然让步，
 * 不需要再节流。抽公共分发后两条路径共享 dispatch 语义，pacing 策略仍按传输介质
 * 区分（fetch 即时、XHR 节流），行为零回归。详见
 * `.apm/kb/docs/Iterations/mobile-sse-stream-resilience/spec.md`。
 *
 * @module infra/llm-protocol/logic/dispatch-sse-chunk
 */

/** 单次 SSE 响应的分发状态：首包标记需要跨 chunk 复用。 */
export interface SseDispatchState {
  /** 是否已投递过至少一个非空 chunk（首包日志只打一次）。 */
  firstChunkDelivered: boolean;
}

/** 创建一份新的分发状态，供一次 SSE 响应全程复用。 */
export function createSseDispatchState(): SseDispatchState {
  return { firstChunkDelivered: false };
}

/**
 * 把解码后的 chunk 文本转发给 `emit`；首个非空 chunk 会触发一次 `onFirstChunk`。
 *
 * 注意：首参命名为 `chunk` 而非 spec 字面意义的 `rawBytes`。因为 XHR 路径拿到的
 * `responseText` 已是 UTF-8 解码后的字符串，强行要求 bytes 会让 RN 那条精心调过
 * 的 responseText 链路改成 arraybuffer，风险与收益不匹配。两条路径在调用本函数前
 * 各自完成解码（fetch 用 TextDecoder，XHR 用 responseText），转发语义在此统一。
 *
 * @param chunk 解码后的文本片段，可能为空；空片段会被忽略
 * @param state 跨 chunk 的分发状态，用来记首包
 * @param emit 投递 sink：fetch 传 onChunk，XHR 传 emitter.append
 * @param onFirstChunk 首个非空 chunk 的回调，用来打日志
 */
export function dispatchSseChunk(
  chunk: string,
  state: SseDispatchState,
  emit: (text: string) => void,
  onFirstChunk?: (bytes: number) => void,
): void {
  if (chunk.length === 0) {
    return;
  }
  emit(chunk);
  if (!state.firstChunkDelivered) {
    state.firstChunkDelivered = true;
    onFirstChunk?.(chunk.length);
  }
}
