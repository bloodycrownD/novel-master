/**
 * 快照分片边界计算（无宿主纯模块）。
 *
 * 为什么独立成文件：这段逻辑原先住在 `ChatTranscriptWebView.tsx` 里，而统一宿主
 * `ChatConversationWebView.tsx` 也要用——新链挂在旧链宿主组件上，等于把新链的
 * 快照分片正确性绑死在旧组件的重构/删除上（r6-C4）。本模块不 import 任何宿主
 * 组件，两个宿主任意 import；旧组件保留 re-export 保兼容。
 */
import {type ChatMessage} from '@novel-master/core/chat';

/**
 * 快照分片大小（init-busy-yield Step 6）：每片最多承载的消息数。行由消息
 * 一对一派生（一条消息至多产出一行，tool_results-only 与空消息被跳过），
 * 故「按消息分片」与「按行分片」同界——单片行数 ≤ 本常量。
 */
const SNAPSHOT_CHUNK_SIZE = 50;

/**
 * 惰性持有的 UTF-8 编码器（RN/Hermes 无全局 Buffer，故走 TextEncoder 全局；
 * 与 packages/core 的 tool-output-limits 同款惯例）。模块求值期不构造，
 * 规避个别环境缺该全局时直接炸掉整个模块。
 */
let snapshotChunkEncoder: TextEncoder | undefined;

/** 字符串的 UTF-8 真实字节数（C-02 口径）；无 TextEncoder 全局时按 UTF-16 码元兜底。 */
function utf8ByteLength(text: string): number {
  if (typeof TextEncoder === 'undefined') {
    return text.length;
  }
  snapshotChunkEncoder ??= new TextEncoder();
  return snapshotChunkEncoder.encode(text).byteLength;
}

/**
 * 快照分片字节预算（rollback-large-jank Step 3）：单桶累计源 content JSON
 * 尺寸上限。大消息场景即使条数未到 {@link SNAPSHOT_CHUNK_SIZE} 也切多片，
 * 避免「40 条大消息挤单片 → 单次 rows 编码大包 → web 全量重建长任务」。
 * 度量口径（C-02）：源消息 content 的 JSON 序列化串的 **UTF-8 真实字节**
 * （`TextEncoder`，全仓字节惯例同 packages/core 的 tool-output-limits），
 * 即此处的 256KB 与线上真实字节预算同尺度。注意它与 rollback.plan.messages
 * 打点的 contentBytes **不同源**——core 侧那处是 `.length`（UTF-16 code unit）
 * 口径，中文正文下约为真字节的 1/3，两者不可直接对齐读数。
 */
const SNAPSHOT_CHUNK_BYTES = 256 * 1024;

/**
 * 按源尺寸贪心分桶（rollback-large-jank Step 3）：一遍量测一遍定桶边界
 * ——逐条累计源 content JSON 的 UTF-8 真实字节，条数到上限或累计字节超预算
 * 即封桶；单条自身超预算时独占一桶（无法再细分）。返回每桶 [start, end)
 * 边界；空列表返回单空桶（chunkTotal=1，与旧单包空快照逐字节等价）。
 */
export function planSnapshotChunkBounds(
  messages: readonly ChatMessage[],
): Array<readonly [number, number]> {
  const bounds: Array<readonly [number, number]> = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < messages.length; i += 1) {
    const messageBytes = utf8ByteLength(JSON.stringify(messages[i]!.content));
    const countInBucket = i - start + 1;
    if (
      countInBucket > SNAPSHOT_CHUNK_SIZE ||
      (bytes + messageBytes > SNAPSHOT_CHUNK_BYTES && countInBucket > 1)
    ) {
      bounds.push([start, i]);
      start = i;
      bytes = 0;
    }
    bytes += messageBytes;
  }
  bounds.push([start, messages.length]);
  return bounds;
}
