/**
 * `ChatTranscriptWebViewHandle` 类型单源（chat-webview-unify Step 6 · r1-P0-11；
 * chat-streaming-projection Step 4 · C7 收到三方法面）。
 *
 * 方法面 = 流式投影协议的三条命令通道：
 * - `pushStream({streamId, segments, tools})`：unit 的 stream-batch 原样透传，
 *   streamId 由单元给出（宿主不猜「当前 id」），rAF 合流与 wire seq 分配在宿主内；
 * - `resetStream(streamIds?)`：消息操作（rollback/fork）清流，`streamIds` 原样透传；
 * - `forceSnapshot()`：直发全量快照（subagent 长任务/重挂后的控制消息消费面）。
 *
 * **`finishStream` 不进出口**：status 翻转由 `streamingRows` prop 的 effect 驱动，
 * 宿主内部函数即可（避免又一次假公开）。旧的七方法面（`pushStreamDelta` /
 * `pushStreamBatch` / `tryCommitStreamTail` / `commitAbortOverlaySnapshot` /
 * `commitSyntheticAssistantRow`）随流式投影协议删除——终态由 `streamStatus{row}`
 * 表达，不再有第二条提交通道。
 */
import type {TranscriptToolView} from './ChatTranscriptBridge';
import type {StreamWireChunk} from '@/services/stream-wire-queue';

export type ChatTranscriptWebViewHandle = {
  pushStream: (payload: {
    streamId: string;
    segments: readonly StreamWireChunk[];
    tools?: readonly TranscriptToolView[];
  }) => void;
  resetStream: (streamIds?: readonly string[]) => void;
  forceSnapshot: () => void;
};
