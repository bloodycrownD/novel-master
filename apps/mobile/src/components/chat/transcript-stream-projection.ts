/**
 * 流式行纯投影（chat-streaming-projection Step 3 / C8）。
 *
 * 只做数据变换：不 import 宿主组件、不碰 React / WebView。三个入口——
 * - `buildStreamingRows`：unit 投影 → 宿主 props（`streamingRows`）；
 * - `applyStreamRowIds`：把 DB 行改写成流式行身份（id=streamId，messageId=DB id）；
 * - `buildStreamingTranscriptRow`：流式行 → wire 形状（快照末片 / streamStatus.row）。
 *
 * 引用稳定契约（spec P1-5）：`buildStreamingRows` 按输入 `streamRows` 数组引用
 * 缓存输出数组；相同输入返回**同一个**输出数组，内容变化才换新数组。unit 侧的
 * `streamRows` 本身 copy-on-write（只在内容变化时换引用），metric/usage tick
 * 不会打穿宿主 memo。
 */
import type {SessionStreamMessageProjection} from '@/services/session-stream-unit';
import type {SessionStreamUnitView} from '@/services/session-stream-unit';
import type {TranscriptRow} from './ChatTranscriptBridge';
import type {TranscriptStreamingMessage} from './ChatTranscriptBridge';
import type {TranscriptToolView} from './ChatTranscriptBridge';
import {prepareStreamTailHtml} from './prepare-stream-tail-html';

/** 无流式行时的稳定空数组（避免消费者拿到新引用）。 */
export const EMPTY_STREAMING_ROWS: readonly TranscriptStreamingMessage[] = [];

/** 无 DB 接管映射时的稳定空 Map（回滚开关关掉投影时也用它）。 */
export const EMPTY_STREAM_ROW_IDS: ReadonlyMap<string, string> = new Map();

/** host 投影入口的输入（`null` = 无单元）。 */
type UnitView = SessionStreamUnitView | null;

/** unit 侧流式投影数组（copy-on-write：只在内容变化时换引用）。 */
type ProjectionInput = readonly SessionStreamMessageProjection[];

/** 宿主 `streamingRows` 输出数组。 */
type StreamingRows = readonly TranscriptStreamingMessage[];

/** 可改写的 DB 行数组（只读入参、返回新数组或原引用）。 */
type Rows = readonly TranscriptRow[];

/** DB message id → streamId 接管映射。 */
type RowIds = ReadonlyMap<string, string>;

/** 流式行文本覆盖（宿主累加器更新的全量 text/thinking）。 */
type TextOverride = {text: string; thinking: string};

/** 输入数组引用 → 输出数组（unit 的 streamRows 只在内容变化时换引用）。 */
const streamingRowsCache = new WeakMap<ProjectionInput, StreamingRows>();

/** 上一次「数组引用变了但内容没变」的输入/输出（保持输出引用稳定）。 */
let lastProjectionInput: ProjectionInput | null = null;
let lastBridgeOutput: StreamingRows = EMPTY_STREAMING_ROWS;

/** service 层工具投影 → 桥层工具投影（同形结构，显式搬字段避免越层扩展）。 */
function toBridgeTool(tool: {
  readonly toolUseId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly status: string;
}): TranscriptToolView {
  return {
    toolUseId: tool.toolUseId,
    name: tool.name,
    input: tool.input,
    status: tool.status,
  };
}

/**
 * `unitView.streamRows` → 宿主 `streamingRows`（spec §2.1.2 投影规则由 unit 负责，
 * 本函数只做结构化映射 + 引用稳定）。`null` / 无投影返回稳定空数组。
 */
export function buildStreamingRows(unitView: UnitView): StreamingRows {
  const input = unitView?.streamRows ?? EMPTY_STREAMING_ROWS;
  const cached = streamingRowsCache.get(input);
  if (cached != null) {
    return cached;
  }
  // 字段级等价：数组引用变了但内容未变时复用上一次输出（引用稳定契约）。
  if (
    lastProjectionInput != null &&
    lastProjectionInput.length === input.length &&
    lastProjectionInput.every((row, index) => {
      const next = input[index]!;
      return (
        row.streamId === next.streamId &&
        row.status === next.status &&
        row.text === next.text &&
        row.thinking === next.thinking &&
        row.messageId === next.messageId &&
        row.tools === next.tools
      );
    })
  ) {
    streamingRowsCache.set(input, lastBridgeOutput);
    return lastBridgeOutput;
  }
  const output = input.map(message => ({
    streamId: message.streamId,
    status: message.status,
    text: message.text,
    thinking: message.thinking,
    tools: message.tools.map(toBridgeTool),
    messageId: message.messageId,
  }));
  streamingRowsCache.set(input, output);
  lastProjectionInput = input;
  lastBridgeOutput = output;
  return output;
}

/**
 * 把 DB 行改写成流式行身份（I5）：只处理**命中映射的 assistant 行**——
 * `id` 换成 streamId、补 `messageId`（DB id）、`status='finished'`。
 * 历史行、user 行与未命中的 assistant 行原样保留；空映射直接原样返回
 * （回滚开关等价面，T-SP33）。
 */
export function applyStreamRowIds(rows: Rows, ids: RowIds): Rows {
  if (ids.size === 0) {
    return rows;
  }
  let changed = false;
  const next = rows.map(row => {
    if (row.kind !== 'message' || row.role !== 'assistant') {
      return row;
    }
    const streamId = ids.get(row.id);
    if (streamId == null) {
      return row;
    }
    changed = true;
    return {
      ...row,
      id: streamId,
      messageId: row.id,
      status: 'finished' as const,
    };
  });
  return changed ? next : rows;
}

// nm style 要求签名单行；spec C8 的签名超过 prettier 默认宽度，用忽略标记保留单行。
// prettier-ignore
export function buildStreamingTranscriptRow(message: TranscriptStreamingMessage, richText: boolean, textOverride?: TextOverride): TranscriptRow {
  const text = textOverride?.text ?? message.text;
  const thinking = textOverride?.thinking ?? message.thinking;
  const textHtml = prepareStreamTailHtml(text, richText);
  const thinkingHtml = prepareStreamTailHtml(thinking, richText);
  return {
    kind: 'message',
    id: message.streamId,
    role: 'assistant',
    hidden: false,
    status: message.status,
    ...(message.messageId != null ? {messageId: message.messageId} : {}),
    text,
    thinking,
    ...(message.tools.length > 0
      ? {tools: message.tools.map(toBridgeTool)}
      : {}),
    ...(textHtml != null ? {textHtml} : {}),
    ...(thinkingHtml != null ? {thinkingHtml} : {}),
  };
}
